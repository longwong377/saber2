/**
 * BATTLEFRONT BORZ — the anchor, measured from both ends at once.
 *
 *   node --import ./tools/register.mjs tools/_unify.mjs [--sweep]
 *
 * tools/_anchor.mjs already sweeps the first-person offset against the
 * third-person forearm. This one exists because unifying the anchor touches
 * four things that live in four different checks, and moving one of them
 * blind is how the last three attempts at this ended:
 *
 *   reach     tools/checks/first-person.mjs — how far the tip gets from the
 *             chest in each view. 1.00 is one weapon.
 *   framing   the same file's other five clauses — the sword hand's angle below
 *             the view axis, the hilt's samples on screen, how much of it is
 *             behind the fist.
 *   arm       tools/checks/viewmodel.mjs — the third-person wrist's departure
 *             from rest and the forearm's worst angular velocity. This is the
 *             pair the note over HILT calls the blocker.
 *   rose      the guard VOLUME's origin against the body the bolts are aimed
 *             at. Nothing checked this before: `_publishGuard` is handed the
 *             solve anchor, so in first person the sphere the rose is measured
 *             on has been sitting 32 cm above the chest every bolt of every
 *             fight, and a shot at your sternum reads as a LOW one.
 *
 * Everything is driven through the real Player on the same benches the checks
 * use, so a number here and a number there are the same number.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Player, HILT_ANCHOR } from '../src/game/Player.js';
import { GUARD, ZONE_ORDER, ZONE_ROSE } from '../src/game/SaberController.js';
import { guardIntercept } from '../src/game/Bolts.js';

const DEG = 180 / Math.PI;

function stubWorld(terrain = true) {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: terrain ? {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
      half: 200, crater() {}, surfaceAt: () => 'sand', raycast: () => null,
    } : null,
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    notify() {}, report() {},
  };
}

/** See the note over stubInput in tools/_anchor.mjs: `blade` must answer. */
function stubInput(holdBlade = false) {
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    act: (id) => (holdBlade && id === 'blade'), actHit: () => false,
  };
}

function bench({ fp = false, terrain = true, holdBlade = false, scheme } = {}) {
  const world = stubWorld(terrain);
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.velocity.set(0, 0, 0);
  if (scheme) p.control.setScheme(scheme);
  if (fp) { p.camera.firstPerson = true; p._applyViewMode(); }
  p.saber.ignite(); p.saber.ignition = 1;
  const input = stubInput(holdBlade);
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  const step = (i) => { ctx.time = world.time = i / 60; p.update(1 / 60, ctx); };
  return { world, p, input, ctx, step };
}

/**
 * REACH, exactly as tools/checks/first-person.mjs measures it — the guard left
 * at rest while the camera is swept, which is what that stub's `act: () => false`
 * actually produces.
 */
function reachRest(fp) {
  const b = bench({ fp });
  let far = 0, near = Infinity;
  const tip = new THREE.Vector3();
  for (let i = 0; i < 420; i++) {
    b.input.mouse.dx = Math.cos(i / 19) * -38;
    b.input.mouse.dy = Math.sin(i / 13) * -26;
    b.input.buttons[0] = (i % 130) < 80;
    b.step(i);
    if (i < 120) continue;
    b.p.saber.pointAt(1, tip);
    const d = tip.distanceTo(b.p.chest);
    far = Math.max(far, d); near = Math.min(near, d);
  }
  return { far, near };
}

/**
 * REACH with the guard actually driven over its whole travel — `blade` held in
 * the `hold` scheme, so the mouse IS the guard and the sweep walks the corners
 * of the reachable sphere. This is the envelope the first clause's own note
 * describes ("sweep the blade through its whole guard range in each view"),
 * which the rest-guard version above does not reach.
 */
function reachSwept(fp) {
  const b = bench({ fp, holdBlade: true });
  let far = 0, near = Infinity;
  const tip = new THREE.Vector3();
  for (let i = 0; i < 600; i++) {
    b.input.mouse.dx = Math.cos(i / 19) * 46;
    b.input.mouse.dy = Math.sin(i / 13) * 34;
    b.step(i);
    if (i < 120) continue;
    b.p.saber.pointAt(1, tip);
    const d = tip.distanceTo(b.p.chest);
    far = Math.max(far, d); near = Math.min(near, d);
  }
  return { far, near };
}

/**
 * THE STATIC ENVELOPE — the honest one.
 *
 * Both sweeps above read a blade that is being thrown about, so what they
 * report is partly the spring's overshoot and partly where the sweep's phase
 * happened to land. This holds the guard STILL at each point of a grid over its
 * whole travel, lets the hands and the blade settle there, and reads the tip.
 * That is "how far can this weapon reach from the body", with no dynamics in it.
 */
function envelope(fp) {
  const b = bench({ fp, holdBlade: true });
  for (let i = 0; i < 120; i++) b.step(i);               // settle
  let far = 0, near = Infinity, hand = 0, at = null, farA = 0, horiz = 0, fwd = 0;
  const tip = new THREE.Vector3(), aim = new THREE.Vector3();
  let i = 120;
  for (let gx = -1; gx <= 1.001; gx += 0.25) {
    for (let gy = -1; gy <= 1.05; gy += 0.25) {
      for (let k = 0; k < 26; k++) { b.p.control.gx = gx; b.p.control.gy = gy; b.step(i++); }
      b.p.saber.pointAt(1, tip);
      const d = tip.distanceTo(b.p.chest);
      if (d > far) { far = d; at = [gx, gy]; }
      near = Math.min(near, d);
      farA = Math.max(farA, tip.distanceTo(b.p.gripAnchor));
      hand = Math.max(hand, b.p.control.handPos.distanceTo(b.p.chest));
      // WHAT REACH ACTUALLY MEANS AGAINST A BODY STANDING IN FRONT OF YOU: how
      // far the tip gets from the player's own FEET on the ground plane, and
      // how far it gets along the aim. A tip a metre over your head is 1.8 m
      // from the chest and cannot touch anything.
      horiz = Math.max(horiz, Math.hypot(tip.x - b.p.position.x, tip.z - b.p.position.z));
      b.p.camera.aimDirection(aim);
      fwd = Math.max(fwd, tip.clone().sub(b.p.chest).dot(aim));
    }
  }
  return { far, near, hand, at, farA, horiz, fwd };
}

/**
 * THE LONGEST THING THE PLAYER CAN DO — a standing stab, which is the one move
 * whose whole point is reach (THRUST_REACH.standing is 1.55). Read on the
 * ground plane, from the feet, because that is the distance an enemy has to
 * close to.
 */
function stab(fp) {
  const b = bench({ fp, holdBlade: false });
  let hit = false;
  b.input.actHit = (id) => (id === 'thrust' && hit);
  for (let i = 0; i < 90; i++) b.step(i);
  let horiz = 0, far = 0;
  const tip = new THREE.Vector3();
  for (let i = 90; i < 210; i++) {
    hit = (i === 100);
    b.step(i);
    b.p.saber.pointAt(1, tip);
    horiz = Math.max(horiz, Math.hypot(tip.x - b.p.position.x, tip.z - b.p.position.z));
    far = Math.max(far, tip.distanceTo(b.p.chest));
  }
  return { horiz, far };
}

/** The first-person framing numbers, the way tools/checks/first-person.mjs reads them. */
function framing(pitch = 0) {
  const b = bench({ fp: true });
  for (let i = 0; i < 90; i++) { b.p.camera.pitch = pitch; b.step(i); }
  const cam = b.world.engine.camera;
  cam.updateMatrixWorld(true);
  b.p.rig.updateMatrices(); b.p.rig.root.updateMatrixWorld(true);
  const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const inv = cam.getWorldQuaternion(new THREE.Quaternion()).invert();
  const at = (name) => {
    const bone = b.p.rig.get(name);
    const l = new THREE.Vector3().setFromMatrixPosition(bone.obj.matrixWorld).sub(eye).applyQuaternion(inv);
    const ndc = new THREE.Vector3().setFromMatrixPosition(bone.obj.matrixWorld).project(cam);
    return { down: Math.atan2(-l.y, Math.max(1e-6, -l.z)) * DEG, fwd: -l.z, ndc: ndc.y };
  };
  // the hilt, sampled and occlusion-tested exactly as the check does
  const S = b.p.saber;
  S.root.updateMatrixWorld(true);
  const occluders = [];
  for (const n of ['handR', 'handL', 'foreR', 'foreL']) {
    const bone = b.p.rig.get(n);
    if (bone) bone.obj.traverse((o) => { if (o.isMesh && o.visible) occluders.push(o); });
  }
  const rc = new THREE.Raycaster(); rc.near = 0.02; rc.far = 3;
  let n = 0, seen = 0, blocked = 0, lo = 1, hi = -1;
  for (let t = -0.5; t <= 1.001; t += 0.05) {
    n++;
    const w = S.root.localToWorld(new THREE.Vector3(0, t * S.emitterY, 0));
    const ndc = w.clone().project(cam);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
    lo = Math.min(lo, ndc.y); hi = Math.max(hi, ndc.y); seen++;
    rc.setFromCamera({ x: ndc.x, y: ndc.y }, cam);
    if (rc.intersectObjects(occluders, true).some((h) => h.distance < w.distanceTo(eye) - 0.004)) blocked++;
  }
  const r = at('handR');
  return { handDown: r.down, handNdc: r.ndc, offDown: at('handL').down,
    seen, n, occ: seen ? 100 * blocked / seen : 100, frame: (hi - lo) / 2 * 100 };
}

/** The third-person arm pair, the way tools/checks/viewmodel.mjs reads them. */
function arm() {
  const b = bench({ terrain: false, holdBlade: true });
  b.ctx.terrain = null; b.ctx.physics = null;
  let worstWrist = 0, worstFore = 0, prev = null;
  const qf = new THREE.Quaternion();
  for (let i = 0; i < 260; i++) {
    b.input.mouse.dx = Math.cos(i / 22) * -34;
    b.input.mouse.dy = Math.sin(i / 22) * -22;
    b.step(i);
    if (i < 90) continue;
    const h = b.p.rig.get('handR');
    worstWrist = Math.max(worstWrist, h.obj.quaternion.angleTo(h.restQuat));
    b.p.rig.worldQuat('foreR', qf);
    if (prev) worstFore = Math.max(worstFore, qf.angleTo(prev));
    prev = qf.clone();
  }
  return { wrist: worstWrist * DEG, fore: worstFore * DEG * 60 };
}

/**
 * WHERE THE ROSE IS CENTRED, and what that does to a shot at the body.
 *
 * Fires a level line at a point `h` metres up the standing figure and asks the
 * player's own published guard, zone by zone, whether it answers — the same
 * question tools/checks/directional.mjs asks, but through the guard the real
 * Player publishes rather than one built by hand at the chest.
 */
function rose(fp) {
  const b = bench({ fp, holdBlade: true, scheme: 'directional' });
  for (let i = 0; i < 120; i++) b.step(i);
  const p = b.p;
  const g = p.control.guard;
  const off = g.origin.clone().sub(p.chest);
  const rows = [];
  for (const h of [1.62, 1.45, 1.34, 1.15, 1.00]) {
    const answered = [];
    for (const z of ZONE_ORDER) {
      const probe = { ...g, zone: z, rose: ZONE_ROSE[z], half: GUARD.sector,
        origin: g.origin.clone(), inv: g.inv.clone() };
      const target = new THREE.Vector3(0, h, 0);
      // The player's default aim is +Z (measured, not assumed: `aimDirection`
      // reads (0, -0.06, 0.998) on this bench), so the shooter stands at +Z and
      // the bolt travels -Z.
      const dir = new THREE.Vector3(0, 0, -1);
      const from = target.clone().addScaledVector(dir, -24);
      const step = dir.clone().multiplyScalar(40 / 60);
      const cur = from.clone(), prev = from.clone();
      let hit = false;
      for (let f = 0; f < 200 && !hit; f++) {
        prev.copy(cur); cur.add(step);
        if (guardIntercept(prev, cur, probe, new THREE.Vector3())) hit = true;
        if (cur.z < -2) break;
      }
      if (hit) answered.push(z);
    }
    rows.push({ h, answered });
  }
  return { off, rows, chest: p.chest.clone(), origin: g.origin.clone() };
}

/* ── report ──────────────────────────────────────────────────────────── */

function line(tag) {
  const rr3 = reachRest(false), rr1 = reachRest(true);
  const rs3 = reachSwept(false), rs1 = reachSwept(true);
  const e3 = envelope(false), e1 = envelope(true);
  const t3 = stab(false), t1 = stab(true);
  const f = framing(0);
  const a = arm();
  console.log(`${tag}  rest ${rr3.far.toFixed(2)}/${rr1.far.toFixed(2)} = ${(rr1.far / rr3.far).toFixed(3)}`
    + `   swept ${rs3.far.toFixed(2)}/${rs1.far.toFixed(2)} = ${(rs1.far / rs3.far).toFixed(3)}`
    + `   still ${e3.far.toFixed(2)}/${e1.far.toFixed(2)} = ${(e1.far / e3.far).toFixed(3)}`
    + ` [anchor ${e3.farA.toFixed(2)}/${e1.farA.toFixed(2)}, hand ${e3.hand.toFixed(2)}/${e1.hand.toFixed(2)}]`
    + `   horiz ${e3.horiz.toFixed(2)}/${e1.horiz.toFixed(2)} = ${(e1.horiz / e3.horiz).toFixed(3)}`
    + `   fwd ${e3.fwd.toFixed(2)}/${e1.fwd.toFixed(2)} = ${(e1.fwd / e3.fwd).toFixed(3)}`
    + `   stab ${t3.horiz.toFixed(2)}/${t1.horiz.toFixed(2)} = ${(t1.horiz / t3.horiz).toFixed(3)}`
    + `   hand ${f.handDown.toFixed(1)}°  hilt ${f.seen}/${f.n} ${f.occ.toFixed(0)}% ${f.frame.toFixed(0)}%`
    + `   wrist ${a.wrist.toFixed(1)}°  fore ${a.fore.toFixed(0)}°/s`);
}

const sweep = process.argv.includes('--sweep');
console.log(`anchor rise ${HILT_ANCHOR.rise} fwd ${HILT_ANCHOR.fwd}`);
console.log('                 third/first far, ratio       framing            third arm');
line('as it stands ');

if (sweep) {
  for (const [rise, fwd] of [[0.32, 0.16], [0.30, 0.16], [0.28, 0.16], [0.26, 0.16],
    [0.32, 0.12], [0.32, 0.20], [0.28, 0.20], [0.24, 0.24]]) {
    HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
    line(`${rise.toFixed(2)} ${fwd.toFixed(2)}   `);
  }
  HILT_ANCHOR.rise = 0.32; HILT_ANCHOR.fwd = 0.16;
}

for (const fp of [false, true]) {
  const r = rose(fp);
  console.log(`\n${fp ? 'first' : 'third'} person: guard sphere origin is `
    + `(${r.off.toArray().map((v) => (v * 100).toFixed(1)).join(', ')}) cm off the chest`);
  for (const row of r.rows) {
    console.log(`   a level shot at ${row.h.toFixed(2)} m answered by `
      + `${row.answered.length}/4 zones${row.answered.length === 4 ? ' (the centre disc)' : `: ${row.answered.join(', ') || 'none'}`}`);
  }
}
