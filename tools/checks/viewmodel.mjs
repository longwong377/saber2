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
import { Player, CameraRig, EYE_FOLLOW, EYE_MAX_SPEED, handPoseOnHilt } from '../../src/game/Player.js';

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

/**
 * `oneHand` HOLDS THE ONE-HAND KEY. There is no other way to ask for one hand:
 * `Player.handsOnHilt` reads the body, and `grip2` is what a player presses.
 * The `fpHands` option that used to stand in for it is gone, and it was never
 * the same thing — it moved the ARMS and left the blade on `GRIPS.two`, so
 * every bench that reached for it measured a guard nobody can hold.
 */
function stubInput(oneHand = false) {
  const keys = new Set();
  return {
    keys, buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => {
      out.x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      out.y = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      return out;
    },
    act: (id) => (id === 'blade' ? true
      : id === 'grip2' ? oneHand
        : id === 'sprint' ? keys.has('ShiftLeft') : false),
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

  check('first person: the neck cap is silent through the whole gait, and still bites', () => {
    /**
     * THE PELVIS GOT SMOOTH, WHICH IS THE OUTCOME THE OLD CLAUSE NAMED AND
     * COULD NOT SURVIVE.
     *
     * The cap is a statement about necks — `EYE_MAX_SPEED`, 2.8 m/s — and it
     * exists because the pelvis was not smooth: the swing foot arrived at a
     * measured 5.3 m/s with the reach clamp welded to it, so the eye had spikes
     * to be protected from. This clause used to assert the cap TRIMS more than
     * 5 mm at a sprint, and that was a proxy: it was really measuring how rough
     * the pelvis was, through the cap.
     *
     * The gait fixes then landed — the swing aim (`SWING_LAND`) and the boot
     * sole the animator now reads off the mesh — and single-frame pelvis travel
     * went 23.7/40.1/69.6/88.3 mm to 8.4/11.3/32.4/28.4 mm at 1.6/3.0/4.6/7.4
     * m/s, against a cap of 46.7 mm/frame. So at a sprint the cap now trims
     * 0.23 mm, the proxy went red, and the thing it was a proxy FOR got better.
     * A clause that fails when the game improves is measuring the wrong
     * quantity.
     *
     * Both halves are asserted directly now, and neither is a proxy:
     *
     *   THE GAIT is under the cap at every speed the game has, sprint
     *   included, so nothing the player does during play is being filtered.
     *   That was always the important half — every millimetre the cap trims is
     *   a millimetre of body sliding under the eye — and it is now true of the
     *   sprint as well as the walk. The bound is the headroom, so a pelvis that
     *   regresses to its old spikes fails here rather than passing quietly.
     *
     *   THE LIMIT still bites, proven on the limit itself rather than on
     *   whatever the gait happens to hand it: a pelvis stepped past `maxStep`
     *   is trimmed to exactly `maxStep` and the excess is reported in
     *   `eyeCapped`. That cannot be smoothed away by a better gait, so it is a
     *   claim about the neck and it stays true whatever the legs do.
     */
    const { rec } = wield({ forward: true });
    const worstRun = Math.max(...rec.map((s2) => s2.capped));
    const sprint = wield({ forward: true, sprint: true });
    const worstSprint = Math.max(...sprint.rec.map((s2) => s2.capped));
    // 4.6 m/s is the ONLY forward speed the game has without the sprint key.
    assert(worstRun < 0.0005,
      `the neck cap trims ${(worstRun * 1000).toFixed(2)} mm at the game's ordinary forward speed `
      + '— that is a filter running during normal play, not a limit');
    /* 1 mm in a frame is 60 mm/s of eye the body is not carrying. The sprint
     * measured 0.23 mm when this was written; a pelvis back at its old 88 mm
     * spikes would trim 41 mm and fail by a factor of forty. */
    assert(worstSprint < 0.001,
      `the neck cap trims ${(worstSprint * 1000).toFixed(2)} mm at a sprint — the pelvis has spikes in `
      + 'it again and the eye is being filtered to hide them (check the swing aim and the sole in Rig.js)');

    /* AND THE LIMIT, on its own terms. A pelvis that jumps four times the
     * frame's allowance must move the eye by the allowance and no more. */
    const solo = new Player(stubWorld(), { isLocal: true });
    solo.camera.firstPerson = true;
    solo._applyViewMode();
    const dt = 1 / 60, allow = EYE_MAX_SPEED * dt;
    const before = solo.camera.eyeOffset.y;
    solo.camera.advanceEye(dt, V3(0, allow * 4 / EYE_FOLLOW, 0));
    const moved = solo.camera.eyeOffset.y - before;
    assert(Math.abs(moved - allow) < 1e-9,
      `a pelvis four times past the limit moved the eye ${(moved * 1000).toFixed(2)} mm in one frame, `
      + `against an allowance of ${(allow * 1000).toFixed(2)} mm — the cap is not wired`);
    assert(solo.camera.eyeCapped > allow * 2.5,
      `the cap moved the eye correctly but reported ${(solo.camera.eyeCapped * 1000).toFixed(2)} mm of `
      + 'excess — eyeCapped is what every one of these measurements reads');
    return `cap refuses ${(worstRun * 1000).toFixed(2)} mm at 4.6 m/s and `
      + `${(worstSprint * 1000).toFixed(2)} mm at a sprint, against an allowance of `
      + `${(allow * 1000).toFixed(1)} mm/frame — the gait no longer needs it, and it still bites`;
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

  check('arms: two hands on one hilt hold it the SAME way round', () => {
    /**
     * THE FOURTH REPORT OF THE SAME THING, AND THE FIRST NUMBER AGAINST IT:
     *
     *   "the orientation is still janky af like i think the knuckles are facing
     *    out on both like that's not how you would hold a saber in 1 or even 2
     *    hands like you keep missing this over and over that's not how human
     *    hands contort"
     *
     * `buildHand` settles which axis a palm is without a guess — the finger
     * roots carry `rotation.x = 1.24`, a positive turn about X takes +Y toward
     * +Z, so the fingers close toward +Z and the palm faces the hand's +Z. Two
     * hands closed on ONE shaft therefore have a law: whatever else they do,
     * their palms cannot face opposite ways round it. There is no grip a body
     * can make that does that.
     *
     * Measured on the shipped tree with `tools/_palm.mjs`, palm·palm:
     *
     *     third person, two hands on the hilt      −1.00
     *     first person, two hands on the hilt      −0.96
     *
     * −1.00 is not "a bit off". It is the two palms pointing exactly away from
     * each other, and it is what "the knuckles are facing out on both" means:
     * whichever hand you look at, you are looking at the back of it.
     *
     * THE CAUSE was a constant bias, and a bias is invisible on one hand and
     * fatal on two. `handPoseOnHilt` documents `toward` as the direction the
     * arm arrives from and places the wrist one BORE offset back — but that
     * offset is `-(0.065·Y + 0.030·Z)`, which is not `-Y`: it leans 24.8°
     * toward the back of the hand. Compose it with `GRIP_TWIST`'s 35° and the
     * wrist lands 59.8° round the shaft from where the caller asked. Both
     * turns were taken about the hand's X — the THUMB axis, which points
     * opposite ways on a left and a right hand — so the bias rolled one hand
     * one way and the other hand the other, 119.6° apart.
     *
     * This check is on `handPoseOnHilt` itself rather than on a posed Player,
     * because the law belongs to the function: hand it one hilt and two arms
     * coming in from their own sides and the two palms have to come round onto
     * the metal together.
     */
    const hilt = new THREE.Quaternion();          // blade along +Y
    const blade = new THREE.Vector3(0, 1, 0);
    // Two arms, each arriving from its own side of the shaft — which is where
    // a pair of shoulders is, and the only place they can be.
    const towardR = new THREE.Vector3(-1, 0, 0).normalize();
    const towardL = new THREE.Vector3(1, 0, 0).normalize();
    const qR = new THREE.Quaternion(), qL = new THREE.Quaternion();
    const wR = new THREE.Vector3(), wL = new THREE.Vector3();
    handPoseOnHilt('R', hilt, towardR, qR, wR);
    handPoseOnHilt('L', hilt, towardL, qL, wL);

    const palmR = new THREE.Vector3(0, 0, 1).applyQuaternion(qR);
    const palmL = new THREE.Vector3(0, 0, 1).applyQuaternion(qL);
    const thumbR = new THREE.Vector3(-1, 0, 0).applyQuaternion(qR);
    const thumbL = new THREE.Vector3(1, 0, 0).applyQuaternion(qL);
    const agree = palmR.dot(palmL);

    /* 0.5 and not 0.99: two hands on a shaft are not parallel, they are a
     * hand's thickness apart round it. Worked out from GRIP_BORE alone — the
     * wrist leans `atan2(0.030, 0.065)` off the hand's own axis on each side —
     * the pair comes out at cos(2 · 24.8°) = 0.65 with the arms exactly
     * opposite, which is what this measures. The bound is the floor of "the
     * same way round", not the shipped figure. */
    assert(agree > 0.5,
      `the two palms agree to ${agree.toFixed(2)} — it was 0.34 on this bench and −1.00 on a posed `
      + 'player, two hands on one shaft with their palms pointing away from each other, which is '
      + 'not a grip a body can make');
    // …and the thumbs must still run up the blade, which is the half that was
    // never wrong and is the easiest thing to break while fixing the other.
    assert(thumbR.dot(blade) > 0.9 && thumbL.dot(blade) > 0.9,
      `the thumbs read ${thumbR.dot(blade).toFixed(2)} / ${thumbL.dot(blade).toFixed(2)} along the blade — `
      + 'a sabre grip has both thumbs toward the emitter');
    /**
     * AND THE TWO HANDS TAKE THE SAME ROLL, which is the property the fix is
     * actually made of.
     *
     * `handPoseOnHilt` carries a comfort turn (`GRIP_TWIST`) and the bore's own
     * lean, and together they hold the wrist a fixed angle round the shaft from
     * straight opposite `toward`. A fixed angle is fine and is what the
     * wrist-strain sweep chose. What is NOT fine is that angle having opposite
     * SIGNS on the two hands, which is what taking it about the thumb axis did:
     * measured on the shipped tree, +59.8° on the right and −59.8° on the left,
     * 119.6° apart on one shaft.
     */
    const roll = (w, t) => {
      const want = t.clone().negate();
      const d = w.clone().addScaledVector(blade, -w.dot(blade)).normalize();
      const a = want.clone().addScaledVector(blade, -want.dot(blade)).normalize();
      return Math.atan2(a.clone().cross(d).dot(blade), a.dot(d)) * 180 / Math.PI;
    };
    const rollR = roll(wR, towardR), rollL = roll(wL, towardL);
    let split = Math.abs(rollR - rollL);
    if (split > 180) split = 360 - split;
    assert(split < 10,
      `the two hands sit ${split.toFixed(0)}° apart round the shaft — the right wrist rolls `
      + `${rollR.toFixed(0)}° off its arm's side and the left ${rollL.toFixed(0)}°, so one hand `
      + 'wraps the hilt one way and the other wraps it the other');

    return `palms agree ${agree.toFixed(2)} (was −1.00), thumbs ${thumbR.dot(blade).toFixed(2)}/`
      + `${thumbL.dot(blade).toFixed(2)} up the blade, both wrists rolled `
      + `${rollR.toFixed(0)}°/${rollL.toFixed(0)}° off their own arm's side (was +60/−60)`;
  });

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
    // THE BEND IS THE OTHER HALF AND IT IS NOW MOSTLY FIXED — by the ELBOW, of
    // all things, which is not where either this note or `_rollForearm`'s
    // expected to find it. Both said the cure had to be the CONTROLLER putting
    // the hands somewhere a wrist could hold that blade. It was not: once the
    // shoulder and the wrist are both fixed by the hilt, a two-bone solve still
    // has exactly ONE free parameter — the elbow's swivel about the line
    // between them — and the pole that chose it was built entirely out of where
    // the hand sits relative to the CHEST, with nothing in it about the wrist.
    // `Player._wristPole` bends that pole toward the elbow a straight wrist
    // implies, capped by `ELBOW.swivel` and rate-limited by `ELBOW.rate`, and
    // both of those numbers are the output of `tools/_wristsweep.mjs`:
    //
    //                        worst        median       forearm
    //     third person    114.4 → 89.4   83.6 → 36.7   2487 → 2476 deg/s
    //     first person    124.2 → 115.8  82.5 → 64.1
    //
    // Nothing the player has approved moves: the hand does not move, the hilt
    // does not move and the blade's envelope does not move. Only the elbow
    // does, and it moves to where a real elbow goes, since in a real arm the
    // elbow's swivel IS driven by the hand's orientation.
    //
    // WHAT IS LEFT IS GEOMETRY AND IS MEASURED AS SUCH. `handPoseOnHilt` pins
    // the hand's long axis exactly perpendicular to the blade — 90.0 degrees on
    // every frame of every bench — so the smallest wrist ANY elbow can reach is
    // |90 - theta|, theta being the angle between the forearm and the blade.
    // The worst frame here is theta = 3.1 degrees: the guard lying along the
    // arm, which is a thrust, and no hammer grip points down its own forearm.
    // So 89.4 is that frame's floor and not slack. A real wrist reaches about
    // 80 degrees of flexion and 70 of extension and WORKS in half of that; the
    // median is inside the working arc now and the worst is at the anatomical
    // end of the range. The ceiling below is ratcheted to it.
    //
    // The attractive wrong answer — that the tunnel a fist makes is oblique, so
    // tilting GRIP_BORE's axis 25-35 degrees would move the floor — is refuted
    // by `tools/_bore.mjs` against buildHand's own fingers: 2.9 degrees.
    //
    // ── AND IT IS RATCHETED ON FOUR ARMS, NOT ONE ─────────────────────────
    //
    // This bench ran one condition — third person, both hands — for its whole
    // life, and the other three were not merely unratcheted, they were
    // unreachable: the only way anything asked for one hand was an `fpHands`
    // option that moved the arms and left the blade's grip model alone. So the
    // first time a bench actually held the one-hand key, first person read
    // 167.6° and 3002°/s, both past the bounds below, and had been shipping
    // that way. `FP_TUNE.roll` is a pair now (see Player.js) and the four
    // conditions come out:
    //
    //                              worst   median   forearm °/s
    //     third person, two hands   89.4    36.7      2476
    //     third person, one hand    79.0    14.7      1112
    //     first person, two hands  115.1    65.8      1605
    //     first person, one hand   102.3    76.7      2429
    //
    // The bounds are each condition's own measurement with the margin this
    // check has always carried — about 6% on the wrist (95 against 89.4) and
    // 9% on the forearm (2700 against 2476) — rather than one number that
    // would be slack for two of the four and unreachable for the others.
    // FIRST PERSON IS THE WORST ARM IN THE TABLE and that is geometry rather
    // than a defect left standing: the hilt is held out in the eyeline, the arm
    // is nearly straight, and a straight arm's elbow swivel cone collapses, so
    // `_wristPole` has almost nothing to bend. One hand is the strongest lever
    // available on it and it is worth 115.1 → 102.3 on the worst frame while
    // the MEDIAN goes the other way, 65.8 → 76.7. It does not close the gap.
    const D = 180 / Math.PI;
    const rows = [];
    for (const [name, firstPerson, oneHand, wristMax, foreMax] of [
      ['third person, two hands', false, false, 95, 2700],
      ['third person, one hand', false, true, 84, 1250],
      ['first person, two hands', true, false, 122, 1800],
      ['first person, one hand', true, true, 109, 2700],
    ]) {
      const world = stubWorld();
      const p = new Player(world, { isLocal: true });
      if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
      const input = stubInput(oneHand);
      const ctx = { input, terrain: null, physics: null, particles: null,
        camera: world.engine.camera, time: 0, groundColor: 0 };
      p.saber.ignite(); p.saber.ignition = 1;
      input.buttons[0] = true;
      let worstWrist = 0, worstFore = 0, hands = 0;
      let prev = null;
      const qf = new THREE.Quaternion();
      for (let i = 0; i < 260; i++) {
        ctx.time = world.time = i / 60;
        input.mouse.dx = Math.cos(i / 22) * -34;
        input.mouse.dy = Math.sin(i / 22) * -22;
        p.update(1 / 60, ctx);
        if (i < 90) continue;
        hands = Math.max(hands, p.handsOnHilt());
        const b = p.rig.get('handR');
        worstWrist = Math.max(worstWrist, b.obj.quaternion.angleTo(b.restQuat));
        p.rig.worldQuat('foreR', qf);
        if (prev) worstFore = Math.max(worstFore, qf.angleTo(prev));
        prev = qf.clone();
      }
      // …and the run says which arm it measured, or a column can quietly be
      // the wrong one — the whole reason the one-handed grip went unmeasured.
      assert(hands === (oneHand ? 1 : 2),
        `${name}: the bench meant ${oneHand ? 1 : 2} hands on the hilt and the body read ${hands}`);
      assert(worstWrist * D < wristMax,
        `${name}: the wrist reaches ${(worstWrist * D).toFixed(1)}° from rest against a ${wristMax}° bound — `
        + 'past what a wrist can do at all');
      assert(worstFore * D * 60 < foreMax,
        `${name}: the forearm turns at ${(worstFore * D * 60).toFixed(0)}°/s against a ${foreMax}°/s bound`);
      rows.push(`${name} ${(worstWrist * D).toFixed(1)}° / ${(worstFore * D * 60).toFixed(0)}°/s`);
    }
    return `${rows.join(', ')} — the first was 179.7° and 7052°/s`;
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
