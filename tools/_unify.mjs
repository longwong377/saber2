/**
 * BATTLEFRONT BORZ — the anchor, measured from every end that constrains it.
 *
 *   node --import ./tools/register.mjs tools/_unify.mjs [MODE …]
 *
 * tools/_anchor.mjs already sweeps the first-person offset against the
 * third-person forearm, and its sweep is why the last attempt at unifying the
 * anchor concluded there was no window: it walked a FIXED 0.30 m offset round
 * an arc, so the one axis that turns out to matter — how far in front of the
 * body the weapon is — was held constant by construction. This one grids rise
 * and forward independently and reads every bound that moves, because unifying
 * the anchor touches six things that live in five different checks and moving
 * one of them blind is how the previous three attempts ended:
 *
 *   reach    tools/checks/first-person.mjs — how far the tip gets from the
 *            chest, from the FEET, and along the aim, in each view. Read off a
 *            9x9 grid of guards held STILL, because a swept measurement reads
 *            the spring's overshoot and a resting one reads the parking spot.
 *   framing  the same file's other clauses — the sword hand's angle below the
 *            view axis, the hilt's samples on screen, how much of it is behind
 *            the fist.
 *   arm      tools/checks/viewmodel.mjs — the third-person wrist's departure
 *            from rest and the forearm's worst angular velocity, which are two
 *            readings of ONE quantity and trade against each other.
 *   demand   tools/checks/stature.mjs — how much of its own arm the figure is
 *            asked for. (This reads about 0.10 HIGHER here than the check does;
 *            the check boots a real World and poses it differently. Use it to
 *            compare anchors, not to predict the bound.)
 *   attack   tools/checks/animation.mjs — how far the hand travels through an
 *            overhead and a stab, and, because travel and reach are different
 *            questions, where the hand ENDS UP.
 *   rose     the guard VOLUME's origin against the body the bolts are aimed at.
 *            Nothing checked this before: `_publishGuard` used to be handed the
 *            solve anchor, so in first person the sphere the rose was measured
 *            on sat 32 cm above the chest for every bolt of every fight and a
 *            shot at your gut read as a LOW one.
 *
 * MODES, all independent and all off by default except the summary line:
 *   --grid     the four constraints over a grid of anchors. --wide for more rows.
 *   --sweep    the summary line at a few anchors.
 *   --arm      the third-person arm alone, which is quick enough to sweep.
 *   --rate     FOREARM.rate against the wrist, at the anchors still in play.
 *   --robust   the arm over six mouse sweeps rather than the ratchet's one.
 *   --attack   the overhead's and the stab's hand travel, and where it ends.
 *   --radius   the blade's span off the chest at the four zone poses.
 *   --grip     the other end of the reach trade: GRIPS.two.handExtend against
 *              `demand` and the hand travel. Refuted — the anchor's own
 *              distance from the shoulder dominates and pulling the hands in
 *              along the guard cannot buy it back.
 *
 * Everything is driven through the real Player on the same benches the checks
 * use, so a number here and a number there are the same number — with the one
 * exception named under `demand` above, which is stated rather than hidden.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Player, HILT_ANCHOR, GRIP_AT, FOREARM } from '../src/game/Player.js';
import { GUARD, ZONE_ORDER, ZONE_ROSE, ZONE_POSE, GRIPS } from '../src/game/SaberController.js';
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

/**
 * HOW MUCH OF THE ARM THE GUARD ASKS FOR — `demand` in tools/checks/stature.mjs,
 * which bounds it at 0.95 of the arm's own reach because "an arm locked dead
 * straight is not a pose". Read here on the headless bench rather than through
 * a booted World, and over the same four poses.
 */
function demand() {
  let worst = 0;
  for (const pose of [{}, { dy: -70 }, { dx: 70 }, { dx: -70 }]) {
    const b = bench({ holdBlade: true, scheme: 'directional' });
    const armLen = b.p.rig.get('armR').length + b.p.rig.get('foreR').length;
    for (let i = 0; i < 90; i++) {
      b.input.mouse.dx = pose.dx ?? 0; b.input.mouse.dy = pose.dy ?? 0;
      b.step(i);
      if (i < 40) continue;
      const sh = b.p.rig.worldPos('armR', new THREE.Vector3());
      if (b.p.control._handTarget) worst = Math.max(worst, b.p.control._handTarget.distanceTo(sh) / armLen);
    }
  }
  return worst;
}

/**
 * HOW FAR THE HAND TRAVELS THROUGH AN OVERHEAD — the ratchet in
 * tools/checks/animation.mjs, which wants more than 1.4x the 22 cm the attack
 * managed before the body was put behind it, i.e. 30.8 cm. An anchor that puts
 * the arm at its own clamp eats this, which is the same fault `demand` reads.
 */
function handTravel(action = 'attackOver') {
  const b = bench({ terrain: true });
  const hit = new Set();
  b.input.actHit = (id) => hit.has(id);
  for (let i = 0; i < 120; i++) b.step(i);
  hit.add(action);
  const pts = [];
  for (let i = 120; i < 190; i++) {
    b.step(i);
    hit.clear();
    pts.push(b.p.rig.worldPos('handR', new THREE.Vector3()).sub(b.p.position));
  }
  let m = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.max(m, pts[i].distanceTo(pts[j]));
  // …and where the hand ENDS UP, off the chest, which is what the attack
  // actually reaches. Travel and reach are different questions and an anchor
  // that starts the hands further out shortens the first without touching the
  // second.
  let far = 0, start = 0;
  const chest = new THREE.Vector3(0, 1.34, 0);
  for (const q of pts) far = Math.max(far, q.distanceTo(chest));
  start = pts[0].distanceTo(chest);
  return { travel: m, far, start };
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

/**
 * The third-person arm pair, the way tools/checks/viewmodel.mjs reads them —
 * plus the quantity that turns out to drive both of them.
 *
 * `handPoseOnHilt` builds the hand's frame from `toward`, the direction from the
 * shoulder to the grip, with the blade's own component taken out. When the arm
 * arrives ALONG the blade that residue vanishes and the frame spins about the
 * shaft; `sep` is the smallest angle between the two over the run, and it is the
 * distance from that singularity.
 */
function arm({ ax = -34, ay = -22, px = 22, py = 22 } = {}) {
  const b = bench({ terrain: false, holdBlade: true });
  b.ctx.terrain = null; b.ctx.physics = null;
  let worstWrist = 0, worstFore = 0, prev = null, sep = 180, atWorst = 0;
  let worstSwing = 0, atSwing = 0;
  const qf = new THREE.Quaternion();
  const dir = new THREE.Vector3(), prevDir = new THREE.Vector3();
  const bore = new THREE.Vector3(), toward = new THREE.Vector3();
  for (let i = 0; i < 260; i++) {
    b.input.mouse.dx = Math.cos(i / px) * ax;
    b.input.mouse.dy = Math.sin(i / py) * ay;
    b.step(i);
    if (i < 90) continue;
    const h = b.p.rig.get('handR');
    worstWrist = Math.max(worstWrist, h.obj.quaternion.angleTo(h.restQuat));
    b.p.rig.worldQuat('foreR', qf);
    dir.copy(b.p.rig.tipPos('foreR', new THREE.Vector3()))
      .sub(b.p.rig.worldPos('foreR', new THREE.Vector3())).normalize();
    b.p.saber.root.updateMatrixWorld(true);
    bore.set(0, 1, 0).applyQuaternion(b.p.saber.root.getWorldQuaternion(new THREE.Quaternion()));
    toward.copy(b.p.saber.root.localToWorld(new THREE.Vector3(0, GRIP_AT.R, 0)))
      .sub(b.p.rig.worldPos('armR', new THREE.Vector3())).normalize();
    const a = Math.acos(Math.min(1, Math.abs(toward.dot(bore)))) * DEG;
    sep = Math.min(sep, a);
    if (prev) {
      const w = qf.angleTo(prev);
      if (w > worstFore) { worstFore = w; atWorst = a; atSwing = dir.angleTo(prevDir); }
      worstSwing = Math.max(worstSwing, dir.angleTo(prevDir));
    }
    prev = qf.clone(); prevDir.copy(dir);
  }
  return { wrist: worstWrist * DEG, fore: worstFore * DEG * 60, sep, atWorst,
    swing: worstSwing * DEG * 60, atSwing: atSwing * DEG * 60 };
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
    + `   wrist ${a.wrist.toFixed(1)}°  fore ${a.fore.toFixed(0)}°/s (bend ${a.atSwing.toFixed(0)}°/s of it, worst bend ${a.swing.toFixed(0)})  arm-off-blade min ${a.sep.toFixed(1)}°`);
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

/**
 * `--arm` — the third-person arm alone, swept over the anchor, which is the
 * only measurement that is quick enough to sweep.
 */
if (process.argv.includes('--arm')) {
  console.log('\nrise  fwd    wrist    fore   arm-off-blade');
  for (const [rise, fwd] of [[0, 0], [0.08, 0.04], [0.16, 0.08], [0.24, 0.12],
    [0.28, 0.14], [0.32, 0.16], [0.32, 0.08], [0.32, 0.24], [0.24, 0.24], [0.40, 0.16]]) {
    HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
    const a = arm();
    console.log(`${rise.toFixed(2)}  ${fwd.toFixed(2)}   ${a.wrist.toFixed(1)}   ${a.fore.toFixed(0).padStart(6)}   `
      + `${a.sep.toFixed(1)}° min, ${a.atWorst.toFixed(1)}° at the worst frame, bend ${a.atSwing.toFixed(0)}/${a.swing.toFixed(0)}°/s`);
  }
  HILT_ANCHOR.rise = 0.32; HILT_ANCHOR.fwd = 0.16;
}

/**
 * `--grid` — the four constraints at once over a grid of unified anchors. The
 * three that fight are the first-person framing (the hand must be inside the
 * half-field and the whole hilt on screen), the third-person arm (the ratchet
 * in tools/checks/viewmodel.mjs), and the reach the anchor buys the player in
 * BOTH views, which is now one number because there is one anchor.
 */
if (process.argv.includes('--grid')) {
  const SHIP = { ...HILT_ANCHOR };
  const GRID = process.argv.includes('--wide')
    ? [[0, 0], [0.32, 0.10], [0.32, 0.13], [0.32, 0.16], [0.32, 0.19], [0.32, 0.22], [0.32, 0.24],
      [0.28, 0.16], [0.28, 0.20], [0.36, 0.16], [0.24, 0.20], [0.20, 0.20]]
    : [[0, 0], [0.32, 0.13], [0.32, 0.16], [0.32, 0.20], [0.32, 0.24]];
  console.log('\nrise  fwd   hand   hilt  occ  frame    wrist   fore   demand  hand-cm   horiz3/1  ratio');
  console.log('             <26°  31/31 <35%  >10%     <145  <2700   <0.95    >30.8');
  for (const [rise, fwd] of GRID) {
    HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
    const f = framing(0), a = arm(), e3 = envelope(false), e1 = envelope(true);
    const d = demand(), h = handTravel().travel;
    console.log(`${rise.toFixed(2)}  ${fwd.toFixed(2)}  ${f.handDown.toFixed(1).padStart(5)}  `
      + `${f.seen}/${f.n}  ${f.occ.toFixed(0).padStart(3)}%  ${f.frame.toFixed(0).padStart(3)}%   `
      + `${a.wrist.toFixed(1).padStart(6)}  ${a.fore.toFixed(0).padStart(5)}   `
      + `${d.toFixed(2)}    ${(h * 100).toFixed(1).padStart(5)}    `
      + `${e3.horiz.toFixed(2)}/${e1.horiz.toFixed(2)}  ${(e1.horiz / e3.horiz).toFixed(3)}`);
  }
  Object.assign(HILT_ANCHOR, SHIP);
}

/**
 * `--robust` — the arm ratchet is one mouse sweep, and one sweep can miss a
 * singularity by phase alone. Six sweeps, worst of each, with the repair on and
 * off: if the repair only ever matters on one of them it is not a repair.
 */
if (process.argv.includes('--robust')) {
  const base = { ...FOREARM };
  const SWEEPS = [{}, { px: 17, py: 29 }, { ax: -52, ay: -34 }, { ax: -20, ay: -40, px: 31, py: 13 },
    { ax: 34, ay: 22 }, { ax: -44, ay: -12, px: 11, py: 37 }];
  console.log('\nanchor        cone+rate          rate only          neither   (worst fore / wrist of six)');
  for (const [rise, fwd] of [[0, 0], [0.32, 0.16], [0.32, 0.24]]) {
    HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
    const run = () => {
      let f = 0, w = 0;
      for (const sw of SWEEPS) { const a = arm(sw); f = Math.max(f, a.fore); w = Math.max(w, a.wrist); }
      return `${f.toFixed(0).padStart(5)} / ${w.toFixed(1)}`;
    };
    Object.assign(FOREARM, base);
    const on = run();
    FOREARM.cone = 0;
    const rate = run();
    FOREARM.rate = 1e9;
    const off = run();
    console.log(`${rise.toFixed(2)} ${fwd.toFixed(2)}      ${on}      ${rate}      ${off}`);
  }
  Object.assign(FOREARM, base);
  HILT_ANCHOR.rise = 0.32; HILT_ANCHOR.fwd = 0.16;
}

/**
 * `--radius` — GUARD.radius says the sphere is where the blade is. Now that the
 * sphere is centred on the chest and the blade hangs off an anchor 0.32 m above
 * it, that claim has to be re-read: the blade's span FROM THE CHEST at each of
 * the four zone poses, against the 1.4 m the rule fires at.
 */
if (process.argv.includes('--radius')) {
  const SHIP = { ...HILT_ANCHOR };
  for (const [fp, anchor] of [[false, SHIP], [true, SHIP], [false, { rise: 0, fwd: 0 }]]) {
    Object.assign(HILT_ANCHOR, anchor);
    const b = bench({ fp, holdBlade: true });
    for (let i = 0; i < 120; i++) b.step(i);
    let i = 120, lo = Infinity, hi = 0;
    const rows = [];
    for (const z of ZONE_ORDER) {
      const pose = ZONE_POSE[z];
      for (let k = 0; k < 40; k++) { b.p.control.gx = pose.x; b.p.control.gy = pose.y; b.step(i++); }
      const base = b.p.saber.pointAt(0, new THREE.Vector3()).distanceTo(b.p.chest);
      const tip = b.p.saber.pointAt(1, new THREE.Vector3()).distanceTo(b.p.chest);
      const mid = b.p.saber.pointAt(0.5, new THREE.Vector3()).distanceTo(b.p.chest);
      lo = Math.min(lo, base, tip); hi = Math.max(hi, base, tip);
      rows.push(`${z} ${base.toFixed(2)}–${mid.toFixed(2)}–${tip.toFixed(2)}`);
    }
    console.log(`\n${fp ? 'first' : 'third'} person, anchor ${HILT_ANCHOR.rise}/${HILT_ANCHOR.fwd}, `
      + 'blade base–mid–tip off the CHEST at the four zone poses:');
    console.log(`   ${rows.join('   ')}   → the weapon spans ${lo.toFixed(2)}–${hi.toFixed(2)} m`);
  }
  Object.assign(HILT_ANCHOR, SHIP);
}

/**
 * `--grip` — the other end of the trade. `demand` is the hand TARGET's distance
 * from the shoulder, and the guard puts the hands `handExtend` out along the
 * guard direction from an anchor that has just moved 0.24 m in front of the
 * chest. Pulling that in is the obvious way to give the arm its reach back; the
 * hand-travel ratchet in tools/checks/animation.mjs is what it costs.
 */
if (process.argv.includes('--grip')) {
  const base = GRIPS.two.handExtend, baseG = GRIPS.two.guardR;
  console.log('\nhandExtend guardR   demand  hand-cm   wrist   fore    hand°  hilt   occ');
  console.log('                     <0.95    >30.8    <145   <2700    <26°  31/31 <35%');
  for (const [he, gr] of [[base, baseG], [0.26, baseG], [0.23, baseG], [0.20, baseG],
    [0.23, 0.56], [0.20, 0.52], [0.26, 0.57]]) {
    GRIPS.two.handExtend = he; GRIPS.two.guardR = gr;
    const d = demand(), h = handTravel().travel, a = arm(), f = framing(0);
    console.log(`   ${he.toFixed(2)}     ${gr.toFixed(2)}     ${d.toFixed(2)}    ${(h * 100).toFixed(1)}   `
      + `${a.wrist.toFixed(1).padStart(6)}  ${a.fore.toFixed(0).padStart(5)}   ${f.handDown.toFixed(1).padStart(5)}  `
      + `${f.seen}/${f.n}  ${f.occ.toFixed(0)}%`);
  }
  GRIPS.two.handExtend = base; GRIPS.two.guardR = baseG;
}

/**
 * `--fore` — the second degeneracy, before and after, at both anchors and over
 * the six sweeps rather than the one the ratchet runs.
 */
if (process.argv.includes('--fore')) {
  const SHIP = { ...HILT_ANCHOR }, base = { ...FOREARM };
  const SWEEPS = [{}, { px: 17, py: 29 }, { ax: -52, ay: -34 }, { ax: -20, ay: -40, px: 31, py: 13 },
    { ax: 34, ay: 22 }, { ax: -44, ay: -12, px: 11, py: 37 }];
  const six = () => {
    let f = 0, w = 0;
    for (const sw of SWEEPS) { const a = arm(sw); f = Math.max(f, a.fore); w = Math.max(w, a.wrist); }
    return `${f.toFixed(0).padStart(5)} / ${w.toFixed(1)}`;
  };
  console.log('\nforeCone foreRate   anchor      ratchet sweep     worst of six');
  for (const [cone, rate] of [[0, 1e9], [12, 1e9], [25, 1e9], [12, 60], [12, 30], [12, 18]]) {
    FOREARM.cone = Math.sin(cone * Math.PI / 180); FOREARM.rate = rate;
    for (const [rise, fwd] of [[0, 0], [0.32, 0.16]]) {
      HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
      const one = arm();
      console.log(`   ${cone === 0 ? 'off' : `${cone}\u00b0`.padStart(3)}   ${rate > 1e8 ? '  off' : `${rate}`.padStart(5)}     `
        + `${rise.toFixed(2)}/${fwd.toFixed(2)}    ${one.fore.toFixed(0).padStart(5)} / ${one.wrist.toFixed(1)}      ${six()}`);
    }
  }
  Object.assign(HILT_ANCHOR, SHIP); Object.assign(FOREARM, base);
}

/**
 * `--rate` — the forearm's pronation ceiling against the wrist, at the anchors
 * still in play. These two are ONE quantity read from both ends: the twist the
 * blade demands has to sit in the forearm or in the wrist, so every rad/s taken
 * off the first appears in the second. This looks for a rate where both of the
 * ratchets in tools/checks/viewmodel.mjs hold.
 */
if (process.argv.includes('--rate')) {
  const SHIP = { ...HILT_ANCHOR }, base = { ...FOREARM };
  console.log('\nfwd    rate      fore / wrist     (<2700 / <145)');
  for (const fwd of [0.16, 0.19, 0.20, 0.22]) {
    HILT_ANCHOR.rise = 0.32; HILT_ANCHOR.fwd = fwd;
    for (const rate of [1e9, 60, 50, 45, 40, 30]) {
      FOREARM.rate = rate;
      const a = arm();
      const ok = a.fore < 2700 && a.wrist < 145 ? '  <- both' : '';
      console.log(`${fwd.toFixed(2)}   ${rate > 1e8 ? ' off' : `${rate}`.padStart(4)}    `
        + `${a.fore.toFixed(0).padStart(5)} / ${a.wrist.toFixed(1)}${ok}`);
    }
  }
  Object.assign(HILT_ANCHOR, SHIP); Object.assign(FOREARM, base);
}

/**
 * `--attack` — the two attacks' hand travel, which is the ratchet in
 * tools/checks/animation.mjs: the overhead has to beat 30.8 cm and the stab
 * 44.8 cm, being 1.4x what each managed before the body was put behind it.
 */
if (process.argv.includes('--attack')) {
  const SHIP = { ...HILT_ANCHOR };
  console.log('\nanchor      overhead travel   stab travel   stab hand start→furthest, off the chest');
  console.log('                    >30.8          >44.8 cm');
  for (const [rise, fwd] of [[0, 0], [0.32, 0.16], [0.32, 0.20], [0.32, 0.24]]) {
    HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
    const o = handTravel('attackOver'), t = handTravel('attackStab');
    console.log(`${rise.toFixed(2)} ${fwd.toFixed(2)}       ${(o.travel * 100).toFixed(1).padStart(5)}          `
      + `${(t.travel * 100).toFixed(1).padStart(5)}        ${(t.start * 100).toFixed(1)} → ${(t.far * 100).toFixed(1)} cm`);
  }
  Object.assign(HILT_ANCHOR, SHIP);
}
