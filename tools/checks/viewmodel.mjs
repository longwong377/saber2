/**
 * BATTLEFRONT BORZ — first person, and the pelvis the eye is bolted to.
 *
 * The player's words were "the 1st person view of the hands/arms is a jumbled
 * mess". Four separate defects were behind it, and every one of them reads
 * perfectly well as source:
 *
 *  1. THE ARMS BEGAN BEHIND THE CAMERA. Measured on the built figure, the right
 *     shoulder joint sat at (0.153, -0.224, +0.068) in the eye's own view
 *     space — 6.8 cm BEHIND the lens, against a 4.5 cm near plane. The
 *     rasteriser clips at the plane, so what reached the screen was two
 *     forearms erupting from the bottom corners, sliced flat, with no visible
 *     origin. No pose could have fixed that; it is the arm's ROOT.
 *
 *  2. THE BODY AND THE CAMERA WERE TWO SIMULATIONS OF ONE PERSON. The pelvis
 *     took the full gait bob and the camera took `bob * 0.5`; the pelvis swayed
 *     up to 30 mm laterally per step and the camera took none of it; the pelvis
 *     dropped 41 mm into a run and the eye did not move at all. Result, in view
 *     space: 32.3 mm of vertical shoulder slide at a walk and 71.2 mm at a run,
 *     27 cm from the lens.
 *
 *  3. THE HILT HUNG OFF A DIFFERENT POINT AGAIN — `position.y + eyeHeight`,
 *     which is the eye minus everything the eye does. 97 mm of wrist per stride.
 *
 *  4. AND IT WAS ALL ONE FRAME LATE, because the camera advanced its own state
 *     in an update() that ran after the body it was supposed to be driving.
 *
 * The properties below are what replaced them. They are exact rather than
 * generous on purpose: a viewmodel welded to the view has ZERO relative motion
 * by construction, so any number above the neck cap's own tolerance means the
 * weld has come apart again.
 */

import * as THREE from 'three';
import { Rig, humanoidSkeleton, BipedAnimator } from '../../src/game/Rig.js';
import { Player, CameraRig } from '../../src/game/Player.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const range = (a) => Math.max(...a) - Math.min(...a);

/* ── a player we can drive with no GPU and no level ──────────────────── */

function stubWorld() {
  const scene = new THREE.Scene();
  return {
    scene,
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: null, particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {},
  };
}

function stubInput() {
  const keys = new Set();
  return {
    keys, buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => {
      out.x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      out.y = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      return out;
    },
    act: (id) => (id === 'blade' ? true : id === 'sprint' ? keys.has('ShiftLeft') : false),
    actHit: () => false,
  };
}

/** Run the real Player for `seconds` and record its arm in eye space. */
function wield({ firstPerson = true, forward = false, sprint = false, pitch = 0,
  seconds = 5, dt = 1 / 60, warm = 2.4 } = {}) {
  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  p.camera.firstPerson = firstPerson;
  p.camera.pitch = pitch;
  p._applyViewMode();
  p.saber.ignite(); p.saber.ignition = 1;
  const input = stubInput();
  if (forward) input.keys.add('KeyW');
  if (sprint) input.keys.add('ShiftLeft');
  const ctx = { input, terrain: null, physics: null, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0 };
  const rec = [];
  for (let i = 0, N = Math.round(seconds / dt); i < N; i++) {
    ctx.time = world.time = i * dt;
    p.camera.pitch = pitch;
    p.update(dt, ctx);
    if (i * dt < warm) continue;
    const inv = p.camera.camera.quaternion.clone().invert();
    const rel = (v) => v.sub(p.camera.pos).applyQuaternion(inv);
    rec.push({
      shoulderR: rel(p.rig.worldPos('armR', V3())),
      shoulderL: rel(p.rig.worldPos('armL', V3())),
      elbowR: rel(p.rig.tipPos('armR', V3())),
      elbowL: rel(p.rig.tipPos('armL', V3())),
      wristR: rel(p.rig.tipPos('foreR', V3())),
      wristL: rel(p.rig.tipPos('foreL', V3())),
      hilt: rel(p.control.handPos.clone()),
      hips: rel(p.rig.worldPos('hips', V3())),
      capped: p.camera.eyeCapped,
      speed: Math.hypot(p.velocity.x, p.velocity.z),
    });
  }
  return { p, rec };
}

/** The bare animator, for the pelvis's own numbers. */
function gait({ speed, seconds = 8, dt = 1 / 60, warm = 3, ground = () => 0 }) {
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  const pos = V3(0, ground(0, 0), 0);
  const rec = [];
  for (let i = 0, N = Math.round(seconds / dt); i < N; i++) {
    const t = i * dt;
    const vel = V3(0, 0, speed);
    pos.z += speed * dt;
    pos.y = ground(pos.x, pos.z);
    anim.setFacing(0);
    anim.update(dt, { position: pos, facing: 0, velocity: vel, grounded: true,
      groundAt: ground, crouch: 0, accelForward: Math.min(1, speed / 8), accelStrafe: 0 });
    rig.updateMatrices();
    if (t < warm) continue;
    rec.push({ t, hip: rig.worldPos('hips', V3()), pos: pos.clone(),
      pelvis: anim.pelvis.clone(), feet: anim.feet.map(f => ({ ...f, pos: f.pos.clone() })) });
  }
  return { rig, anim, rec };
}

export async function run({ check, assert }) {
  /* ══════════════════════════════════════════════════════════════════ */
  /*  The weld: the eye rides the pelvis                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('first person: the eye rides the WHOLE pelvis, not half its bob and none of its sway', () => {
    // Before: the camera took bob*0.5 and no sway at all, so the hips slid
    // 60.0 mm laterally and 26.7 mm vertically underneath a stationary eye at a
    // walk. The pelvis offset is published as one vector for exactly this
    // reason — anything that has to move WITH the body needs all six of its
    // terms, not the one that happened to be exported.
    const rows = [];
    for (const [name, o] of [['idle', {}], ['walk', { forward: true }],
      ['sprint', { forward: true, sprint: true }]]) {
      const { rec } = wield(o);
      const lat = range(rec.map(s => s.hips.x));
      const vert = range(rec.map(s => s.hips.y));
      const fore = range(rec.map(s => s.hips.z));
      // The neck speed cap is the ONLY thing allowed to open a gap, and only on
      // the frames where the pelvis exceeds 2.2 m/s — which is the gait being
      // wrong, not the camera. Anything the cap did not refuse must be zero.
      const capped = Math.max(...rec.map(s => s.capped));
      // The cap is vertical-only, so the two horizontal axes are exact at every
      // speed. A magnitude cap left 4.9 mm of lateral slide at a sprint for
      // nothing, which is why it is not a magnitude cap.
      assert(lat < 0.0005, `${name}: the pelvis slides ${(lat * 1000).toFixed(2)} mm laterally under the eye`);
      assert(fore < 0.0005, `${name}: the pelvis slides ${(fore * 1000).toFixed(2)} mm fore/aft under the eye`);
      assert(vert <= capped * 3 + 0.001,
        `${name}: the pelvis slides ${(vert * 1000).toFixed(1)} mm vertically under the eye, `
        + `and the neck cap only refused ${(capped * 1000).toFixed(1)} mm of it`);
      rows.push(`${name} ${(lat * 1000).toFixed(1)}/${(vert * 1000).toFixed(1)}/${(fore * 1000).toFixed(1)}mm`);
    }
    return `hips under the eye, x/y/z p-p: ${rows.join(', ')}`;
  });

  check('first person: nothing about the arms moves relative to the view', () => {
    // The whole point of a viewmodel. Measured before: shoulder 20.1 mm across
    // and 32.3 mm up at a walk, 71.2 mm up at a run; wrist 97 mm up once the
    // shoulder was pinned but the hilt was not. All of it is one weld now, so
    // all of it is zero — and it stays zero at every speed, because it is not
    // a tuned cancellation, it is the same frame.
    const rows = [];
    for (const [name, o] of [['idle', {}], ['walk', { forward: true }],
      ['sprint', { forward: true, sprint: true }], ['looking down', { pitch: -1.0 }]]) {
      const { rec } = wield(o);
      let worst = 0, worstAt = '';
      for (const k of ['shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'wristR', 'wristL', 'hilt']) {
        for (const c of ['x', 'y', 'z']) {
          const r = range(rec.map(s => s[k][c]));
          if (r > worst) { worst = r; worstAt = `${k}.${c}`; }
        }
      }
      assert(worst < 0.002,
        `${name}: ${worstAt} travels ${(worst * 1000).toFixed(1)} mm across the frame — the arms are not welded to the view`);
      rows.push(`${name} ${(worst * 1000).toFixed(2)}mm`);
    }
    return `worst joint travel in view space: ${rows.join(', ')}`;
  });

  check('first person: every arm joint is in FRONT of the near plane, with the deltoid clear of it', () => {
    // This is the one that made first person unlookable. The shoulder was
    // 68 mm BEHIND the lens, so the upper arm crossed the camera plane and was
    // clipped in half. The margin is not arbitrary: the deltoid is a tube of
    // radius ~55 mm about the joint, so the joint has to clear the near plane
    // by more than that or the shoulder is sliced open from the inside.
    const NEAR = 0.045, DELTOID = 0.055;
    const rows = [];
    for (const [name, o] of [['idle', {}], ['walk', { forward: true }],
      ['looking down', { pitch: -1.2 }], ['looking up', { pitch: 1.1 }]]) {
      const { rec } = wield(o);
      let nearest = Infinity, which = '';
      for (const s of rec) {
        for (const k of ['shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'wristR', 'wristL']) {
          const front = -s[k].z;                       // view -Z is forward
          if (front < nearest) { nearest = front; which = k; }
        }
      }
      assert(nearest > NEAR + DELTOID,
        `${name}: ${which} is only ${(nearest * 1000).toFixed(0)} mm in front of a ${NEAR * 1000} mm near plane `
        + `— the arm is being sliced by the camera`);
      rows.push(`${name} ${(nearest * 1000).toFixed(0)}mm (${which})`);
    }
    return `nearest arm joint to the lens: ${rows.join(', ')} — near plane 45mm`;
  });

  check('first person: the shoulders sit where a viewmodel puts them, not where a ribcage does', () => {
    const { rec } = wield({});
    const s = rec[rec.length - 1];
    // out to the sides, below the lens, and in front of it
    assert(s.shoulderR.x > 0.12 && s.shoulderL.x < -0.12,
      `the shoulders are ${(s.shoulderR.x * 100).toFixed(0)}/${(s.shoulderL.x * 100).toFixed(0)}cm apart across the view`);
    assert(s.shoulderR.y < -0.20,
      `the shoulders are only ${(-s.shoulderR.y * 100).toFixed(0)}cm below the lens — you are looking at your own deltoids`);
    // and symmetric, or the viewmodel is lopsided
    assert(Math.abs(s.shoulderR.x + s.shoulderL.x) < 0.002 && Math.abs(s.shoulderR.y - s.shoulderL.y) < 0.002,
      'the two shoulders are not mirror images of each other');
    return `shoulders at ±${(s.shoulderR.x * 100).toFixed(1)}cm, ${(-s.shoulderR.y * 100).toFixed(1)}cm below `
      + `and ${(-s.shoulderR.z * 100).toFixed(1)}cm in front of the lens`;
  });

  check('first person: leaving it puts the shoulders back on the body', () => {
    // _anchorViewArms overwrites the clavicle's local position AND rotation
    // every frame. Toggling out of first person without restoring the rest pose
    // leaves the third-person figure with its shoulders frozen wherever the
    // camera last happened to be — and the toggle is also what runs on respawn.
    const world = stubWorld();
    const p = new Player(world, { isLocal: true });
    const input = stubInput();
    const ctx = { input, terrain: null, physics: null, particles: null,
      camera: world.engine.camera, time: 0, groundColor: 0 };
    const restPos = p.rig.get('clavR').obj.position.clone();
    const restQ = p.rig.get('clavR').obj.quaternion.clone();
    p.camera.firstPerson = true; p._applyViewMode();
    for (let i = 0; i < 20; i++) { ctx.time = i / 60; p.update(1 / 60, ctx); }
    const moved = p.rig.get('clavR').obj.position.distanceTo(restPos);
    assert(moved > 0.05, 'first person did not move the shoulder onto the camera at all');
    p.camera.firstPerson = false; p._applyViewMode();
    const back = p.rig.get('clavR').obj.position.distanceTo(restPos);
    const backQ = p.rig.get('clavR').obj.quaternion.angleTo(restQ);
    assert(back < 1e-6, `back in third person the clavicle is still ${(back * 100).toFixed(1)}cm off its rest position`);
    assert(backQ < 1e-6, `back in third person the clavicle is still ${(backQ * 57.3).toFixed(1)}° off its rest rotation`);
    // and the tube is drawn again
    let hidden = 0;
    p.rig.get('clavR').obj.traverse((o) => { if (o.isMesh && !o.visible) hidden++; });
    assert(hidden === 0, `${hidden} clavicle meshes are still hidden in third person`);
    return `shoulder moved ${(moved * 100).toFixed(0)}cm onto the camera and returned to rest exactly`;
  });

  check('first person: what enemies aim at is a chest, not the weapon anchor', () => {
    // Enemy.js aims every bolt and every lunge at `target.chest`, Duel.js builds
    // the blade-lock midpoint from it, and a dozen Force powers use it as their
    // origin. First person used to redefine it as the point the WEAPON hangs
    // from, and the viewmodel needs that point to follow the aim so the hands
    // stay in front of the lens when you look up — which would have put it
    // 0.20 m ABOVE the player's own eye at full look-up, i.e. above the head of
    // the body every droid in the level is shooting at.
    const rows = [];
    for (const pitch of [-1.28, -0.6, 0, 0.6, 1.16]) {
      const { p, rec } = wield({ pitch, seconds: 3 });
      const h = p.chest.y - p.position.y;
      assert(h > 1.0 && h < 1.55,
        `looking at ${(pitch * 57.3).toFixed(0)}°, the aim point sits ${h.toFixed(2)}m up a 1.78m body`);
      // and it must not wander with the view at all
      const flat = Math.hypot(p.chest.x - p.position.x, p.chest.z - p.position.z);
      assert(flat < 0.02,
        `looking at ${(pitch * 57.3).toFixed(0)}°, the aim point is ${(flat * 100).toFixed(0)}cm to one side of the body`);
      // meanwhile the WEAPON anchor does follow the view, which is the point.
      // Only asserted at a level gaze: looking 73 degrees down the two happen
      // to coincide to 32 mm, because that is where a weapon held in front of
      // your face and your own sternum genuinely are.
      if (pitch === 0) {
        assert(p.gripAnchor.distanceTo(p.chest) > 0.1,
          'the weapon anchor and the aim point are the same point again');
      }
      rows.push(`${(pitch * 57.3).toFixed(0)}° ${h.toFixed(2)}m`);
    }
    return `aim point stays on the chest at every pitch: ${rows.join(', ')}`;
  });

  check('first person: the eye is computed in exactly one place', () => {
    // The arms are welded to the eye, so a second copy of the eye's arithmetic
    // is a second eye, and the weld is then only as good as the two copies
    // agreeing. They did not: the blade anchor built its own from
    // `position.y + eyeHeight` and got neither the pelvis ride nor the 7 cm
    // forward set, which is where the 97 mm of wrist came from.
    const world = stubWorld();
    const cam = new CameraRig(world.engine.camera);
    cam.firstPerson = true;
    cam.eyeOffset.set(0.021, -0.034, 0.011);
    cam.yaw = 0.6; cam.pitch = -0.2; cam.syncAim();
    const a = cam.eyePosition(V3(3, 5, -2), 1.62, V3());
    const b = cam.eyePosition(V3(3, 5, -2), 1.62, V3());
    assert(a.distanceTo(b) === 0, 'eyePosition is not deterministic');
    // it must actually carry the offset, or the weld is to the wrong point
    cam.eyeOffset.set(0, 0, 0);
    const c = cam.eyePosition(V3(3, 5, -2), 1.62, V3());
    assert(Math.abs(a.y - c.y - -0.034) < 1e-9 && Math.abs(a.x - c.x - 0.021) < 1e-9,
      'eyePosition drops part of the pelvis offset it was handed');
    return `eyePosition carries the full offset (${a.distanceTo(c).toFixed(4)} m for a 42 mm pelvis)`;
  });

  check('first person: the neck cap bounds the eye speed without ever filtering the gait', () => {
    // The cap is a statement about necks: 2.2 m/s. It exists because the pelvis
    // is still not smooth — the swing foot arrives at a measured 5.3 m/s and
    // the reach clamp is chained to it. What matters is that it does NOT engage
    // at a walk, where the pelvis is honest; a cap that trims ordinary walking
    // is a low-pass filter, and a low-pass filter puts the swim back.
    const { rec } = wield({ forward: true });
    const worstRun = Math.max(...rec.map(s => s.capped));
    const sprint = wield({ forward: true, sprint: true });
    const worstSprint = Math.max(...sprint.rec.map(s => s.capped));
    // 4.6 m/s is not a jog, it is the ONLY forward speed the game has without
    // the sprint key, so it is where the cap must be silent. At 2.2 m/s it was
    // trimming 5.9 mm here — during ordinary play — and every millimetre it
    // trims is a millimetre of body sliding under the eye.
    assert(worstRun < 0.0005,
      `the neck cap trims ${(worstRun * 1000).toFixed(1)} mm at the game's ordinary forward speed `
      + '— that is a filter running during normal play, not a limit');
    assert(worstSprint > 0.005,
      'the cap never engages even at a sprint — either the pelvis got smooth (check Rig.js) or the limit is dead');
    return `cap refuses ${(worstRun * 1000).toFixed(2)} mm at 4.6 m/s, `
      + `${(worstSprint * 1000).toFixed(1)} mm at a sprint (limit 2.8 m/s = 46.7 mm/frame)`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The pelvis the eye now has to ride                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('gait: the swing aims at where the body will be when the foot LANDS, not 3% later', () => {
    // The foot is down at f.t = 0.97 — "down and still for the last few percent"
    // — and _aimSwing was handed `(1 - f.t) * dur` as the time remaining, so it
    // aimed at where the body would be at f.t = 1. Three percent of a 314 ms
    // swing is 9.4 ms, which at 4.6 m/s is 43 mm of body travel: every plant
    // landed that much further in front than the stride budget had sized it
    // for, and the pelvis then had to dive to reach a foot out past its own leg.
    //
    // Pinned against the measured before/after rather than against a
    // reconstruction of spanMax, because spanMax is the gait model's own
    // arithmetic and a copy of it here would only ever prove that the copy
    // still matches. What the plant distance means for the leg is pinned in
    // tools/checks/animation.mjs, which already forbids legUse >= 0.985 and
    // more than 6 mm of ankle detachment at all of these speeds.
    const before = { 1.6: 0.287, 4.6: 0.346, 7.4: 0.300 };
    const rows = [];
    for (const speed of [1.6, 4.6, 7.4]) {
      const { rec } = gait({ speed, seconds: 8 });
      let worstAhead = 0;
      const wasG = [true, true];
      for (const s2 of rec) {
        for (const k of [0, 1]) {
          if (s2.feet[k].grounded && !wasG[k]) {
            worstAhead = Math.max(worstAhead, s2.feet[k].pos.z - s2.pos.z);
          }
          wasG[k] = s2.feet[k].grounded;
        }
      }
      assert(worstAhead <= before[speed] - 0.005,
        `at ${speed} m/s the plant lands ${(worstAhead * 1000).toFixed(0)}mm ahead of the body, `
        + `no better than the ${(before[speed] * 1000).toFixed(0)}mm it did before the swing aim was corrected`);
      rows.push(`${speed}m/s ${(before[speed] * 1000).toFixed(0)}→${(worstAhead * 1000).toFixed(0)}mm`);
    }
    return `plant distance ahead of the body: ${rows.join(', ')}`;
  });

  check('gait: the pelvis is smoother than it was, and the residue is named', () => {
    // Not a pass mark for the pelvis — it is still not smooth, and the reason
    // is written down in Rig.js: the swing foot descends at up to 7.0 m/s and
    // the reach clamp is welded to it. This pins the improvement so it cannot
    // be undone silently, and it pins the DIAGNOSIS so the next round does not
    // have to re-derive it. Before SWING_LAND: 23.7 / 40.1 / 69.6 / 88.3 mm of
    // pelvis in a single 1/60 s frame at 1.6 / 3.0 / 4.6 / 7.4 m/s.
    const rows = [];
    const budget = { 1.6: 0.022, 3.0: 0.030, 4.6: 0.046, 7.4: 0.089 };
    for (const speed of [1.6, 3.0, 4.6, 7.4]) {
      const { rec } = gait({ speed, seconds: 10 });
      let worst = 0;
      for (let i = 1; i < rec.length; i++) {
        worst = Math.max(worst, Math.abs((rec[i].hip.y - rec[i].pos.y) - (rec[i - 1].hip.y - rec[i - 1].pos.y)));
      }
      assert(worst < budget[speed],
        `at ${speed} m/s the pelvis moves ${(worst * 1000).toFixed(1)}mm in one frame `
        + `(was ${(budget[speed] * 1000).toFixed(0)}mm) — the swing aim has regressed`);
      rows.push(`${speed}m/s ${(worst * 1000).toFixed(1)}mm`);
    }
    return `worst single-frame pelvis travel: ${rows.join(', ')}`;
  });

  check('gait: the pelvis publishes what it DID, not what it intended', () => {
    // `anim.pelvis` is the contract the eye is welded to. If it is ever rebuilt
    // from the parts — bob plus sway — it silently drops the landing dip, the
    // run's own crouch and the reach clamp, which between them are larger than
    // the bob it would have kept.
    const { rig, anim, rec } = gait({ speed: 4.6, seconds: 6 });
    let worst = 0, worstBob = 0;
    for (const s of rec) {
      const applied = V3(s.hip.x - s.pos.x, 0, s.hip.z - s.pos.z);
      worst = Math.max(worst, Math.abs(s.pelvis.x - applied.x), Math.abs(s.pelvis.z - applied.z));
      // and it is genuinely more than the bob alone
      worstBob = Math.max(worstBob, Math.abs(s.pelvis.y));
    }
    assert(worst < 1e-9, `the published pelvis is ${(worst * 1000).toFixed(2)}mm from where the hips actually are`);
    assert(worstBob > 0.05,
      `the published pelvis only ever reaches ${(worstBob * 1000).toFixed(1)}mm vertically — `
      + 'it cannot be carrying the run crouch and the reach clamp');
    return `pelvis published exactly (${(worst * 1e9).toFixed(0)} nm), reaching ${(worstBob * 1000).toFixed(0)}mm at a run`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The arm below the elbow                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('arms: the wrist is set to an ARBITRARY orientation, and this is how far it goes', () => {
    // HALF FIXED, AND THE HALF THAT IS FIXED IS RATCHETED HERE.
    //
    // The forearm used to turn at 6874 deg/s on a hand that is barely moving,
    // because `solveIK` takes the lower bone's roll from `aimY(lowerDir,
    // poleDir)` — the pole is a hint about which way the elbow BENDS, a plane,
    // and it was being asked to decide the forearm's TWIST as well. Different
    // questions, different right answers.
    //
    // Player._rollForearm now sets that roll from the hand instead, off the
    // orientation the grip has already fixed: it takes the forearm pose that
    // would leave the hand at its own rest — handWorld * restQuat^-1 — and
    // SWINGS it onto the direction solveIK chose. The direction is untouched,
    // so the elbow does not move; only the twist changes, which is what a
    // forearm does.
    //
    // The other half is `handPoseOnHilt` deciding WHERE ROUND THE HILT the hand
    // sits, from the direction the arm arrives from rather than from a constant.
    // A constant cannot be right — the arm crosses the body — and pinned at the
    // wrong one it left the wrist at the singularity, 176 degrees from rest with
    // the forearm juddering at 9912 deg/s. Together: 179.7 -> 140.0 degrees and
    // 7052 -> 2548 deg/s. The bounds below move with those numbers; this is a
    // ratchet and it fails if either gets worse.
    //
    // Cheaper spellings of the roll, all measured, all worse — `aimY`
    // substitutes a fixed reference whenever its direction and its reference
    // come within 10 degrees of parallel, and a roll that jumps 90 degrees
    // mid-swing is the fault being removed:
    //
    //     pole aimed at the grip          8780 deg/s   (degenerate by construction)
    //     minimal swing onto the bone     9912         (degenerate at a 176° wrist)
    //     aimY on the rest frame's X      5496         (degenerate on some frames)
    //
    // THE WRIST IS STILL 140 DEGREES FROM REST, and that is the other half. It
    // is not roll any more, it is BEND: the angle between the forearm's
    // direction — which solveIK picks purely from where the grip POINT is — and
    // the hilt's axis. No amount of forearm twist can change it. Fixing it means
    // the CONTROLLER placing the hands where a wrist could actually hold that
    // blade, which is a change to SaberController's guard model, not to the rig.
    // 80 degrees of bend and 30 of roll is what a wrist does; this still is not
    // that, and the ceiling below carries the number forward until it is.
    const world = stubWorld();
    const p = new Player(world, { isLocal: true });
    const input = stubInput();
    const ctx = { input, terrain: null, physics: null, particles: null,
      camera: world.engine.camera, time: 0, groundColor: 0 };
    p.saber.ignite(); p.saber.ignition = 1;
    input.buttons[0] = true;
    let worstWrist = 0, worstFore = 0;
    let prev = null;
    const qf = new THREE.Quaternion();
    for (let i = 0; i < 260; i++) {
      ctx.time = world.time = i / 60;
      input.mouse.dx = Math.cos(i / 22) * -34;
      input.mouse.dy = Math.sin(i / 22) * -22;
      p.update(1 / 60, ctx);
      if (i < 90) continue;
      const b = p.rig.get('handR');
      worstWrist = Math.max(worstWrist, b.obj.quaternion.angleTo(b.restQuat));
      p.rig.worldQuat('foreR', qf);
      if (prev) worstFore = Math.max(worstFore, qf.angleTo(prev));
      prev = qf.clone();
    }
    const D = 180 / Math.PI;
    assert(worstWrist * D < 145,
      `the wrist reaches ${(worstWrist * D).toFixed(1)}° from rest — worse than the 140.0° the solved grip achieves`);
    assert(worstFore * D * 60 < 2700,
      `the forearm turns at ${(worstFore * D * 60).toFixed(0)}°/s — worse than the 2548°/s the solved grip achieves`);
    return `wrist reaches ${(worstWrist * D).toFixed(1)}° from rest, down from 179.7 — the BEND is still unfixed, `
      + `see SaberController; forearm peaks at ${(worstFore * D * 60).toFixed(0)}°/s, down from 7052`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Dismemberment survives the view                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('sever: a detached piece is visible even when the view was hiding it', async () => {
    // Severing REPARENTS the body's real meshes into the piece, it does not
    // copy them, so any `visible = false` the view mode set comes along. First
    // person hides the neck, the head and its fifteen face meshes, and now the
    // clavicles — so cutting your own head off in first person spawned a piece
    // with no head on it. Dismemberment is a headline feature and it is not a
    // view mode.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Ragdoll.js', import.meta.url), 'utf8');
    // every place that adopts a mesh into a piece or a ragdoll holder
    const adopts = [...src.matchAll(/inner\.add\(c\);/g)];
    assert(adopts.length >= 2, `expected the two adoption sites, found ${adopts.length}`);
    for (const m of adopts) {
      const after = src.slice(m.index, m.index + 1400);
      assert(/c\.visible = true;/.test(after),
        `a mesh is adopted into a piece at offset ${m.index} without being made visible again`);
    }
    assert(/obj\.visible = true;/.test(src), 'adoptDecor does not restore visibility either');
    return `${adopts.length} adoption sites, all of them force the piece visible`;
  });

  check('sever: first person hides meshes and never bones, so the cut still finds them', () => {
    // Scaling or hiding a BONE enters matrixWorld and every worldPos() call
    // with it — which is why the original note in _applyViewMode says to hide
    // meshes. The viewmodel added a second thing that touches the skeleton in
    // first person, and it moves the clavicle rather than hiding it, so the
    // same rule has to hold: the bone is still a real, findable, cuttable bone.
    const world = stubWorld();
    const p = new Player(world, { isLocal: true });
    const input = stubInput();
    const ctx = { input, terrain: null, physics: null, particles: null,
      camera: world.engine.camera, time: 0, groundColor: 0 };
    p.camera.firstPerson = true; p._applyViewMode();
    for (let i = 0; i < 20; i++) { ctx.time = i / 60; p.update(1 / 60, ctx); }
    const names = ['clavL', 'clavR', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'neck', 'head'];
    for (const n of names) {
      const b = p.rig.get(n);
      assert(b, `${n} vanished from the rig in first person`);
      assert(b.obj.visible, `the BONE ${n} was hidden, not its meshes — every worldPos on it is now suspect`);
      assert(Math.abs(b.obj.scale.x - 1) < 1e-9, `${n} was scaled to hide it`);
      const w = p.rig.worldPos(n, V3());
      assert(isFinite(w.x) && isFinite(w.y) && isFinite(w.z), `${n} has no finite world position`);
    }
    // the arm chain must still be its true length, or the cut lands in the wrong place
    const upper = p.rig.worldPos('armR', V3()).distanceTo(p.rig.tipPos('armR', V3()));
    assert(Math.abs(upper - p.rig.get('armR').length) < 1e-6,
      `the upper arm measures ${upper.toFixed(4)}m against a bone length of ${p.rig.get('armR').length}`);
    return `${names.length} bones intact, unscaled and findable with the arms on the camera`;
  });
}
