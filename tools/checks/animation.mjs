/**
 * Locomotion and posture checks — src/game/Rig.js.
 *
 * The complaint this suite exists to make impossible is "it looks like a hobby
 * project": feet that skate, a body that floats, limbs that rubber. Every one
 * of those is a number, and every number below was measured off the solver
 * before it was asserted. Where a bound looks arbitrary the comment says what
 * the old code scored on it.
 *
 * What was actually wrong, in the order it read worst:
 *
 *   · turning 120°/s on the spot dragged both feet 1.79m across the ground in
 *     four seconds and never took a step;
 *   · the duty factor was exactly 0.500 at every speed — never two feet down,
 *     never none, a sprint structurally identical to a stroll;
 *   · the gait asked for a stride the leg could not reach, and solveIK clamps
 *     rather than stretching, so the drawn foot left the point it was standing
 *     on by up to 22cm at a sprint;
 *   · a 25° slope buried the sole 74mm in the ground, because the ankle was
 *     rolled against world up rather than against the ground it was on;
 *   · the pelvis did not rotate, list or sway, the ribcage did not counter-
 *     rotate, the head was welded to the hips and a standing figure did not
 *     move at all. All of those were exactly zero.
 */

import { Rig, humanoidSkeleton, BipedAnimator } from '../../src/game/Rig.js';
import { buildJedi } from '../../src/game/Bodies.js';

let THREE = null;
const D = 180 / Math.PI;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const range = (a) => Math.max(...a) - Math.min(...a);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/**
 * Walk a bare skeleton through a scripted journey and record everything worth
 * measuring. No meshes and no GPU — the pose is the whole product here.
 */
function walk(opts = {}) {
  const {
    speed = 0, strafe = 0, turn = 0, seconds = 8, dt = 1 / 60,
    ground = () => 0, crouch = 0, grounded = () => true, vy = () => 0, warm = 2,
  } = opts;
  const rig = opts.rig || new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: rig.scale, hipHeight: 0.95 * rig.scale });
  const pos = V3(0, ground(0, 0), 0);
  let facing = 0, steps = 0;
  anim.onFootstep = () => steps++;
  const rec = [];
  const prev = [V3(), V3()], pg = [true, true];
  const N = Math.round(seconds / dt);
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    facing += turn * dt;
    const fwd = V3(Math.sin(facing), 0, Math.cos(facing));
    const left = V3(fwd.z, 0, -fwd.x);
    const g = grounded(t);
    const vel = V3().addScaledVector(fwd, speed).addScaledVector(left, strafe);
    vel.y = vy(t);
    pos.addScaledVector(vel, dt);
    if (g) pos.y = ground(pos.x, pos.z); else pos.y += vel.y * dt;
    anim.setFacing(facing);
    anim.update(dt, {
      position: pos, facing, velocity: vel, grounded: g, groundAt: ground, crouch,
      accelForward: Math.min(1, Math.hypot(vel.x, vel.z) / 8), accelStrafe: 0,
    });
    rig.updateMatrices();
    if (t >= warm) {
      rec.push({
        t, facing, pos: pos.clone(), grounded: [anim.feet[0].grounded, anim.feet[1].grounded],
        // a slide only counts if the foot claimed to be planted on both frames
        slide: [0, 1].map(k => (anim.feet[k].grounded && pg[k]) ? prev[k].distanceTo(anim.feet[k].pos) : 0),
        foot: [anim.feet[0].pos.clone(), anim.feet[1].pos.clone()],
        // The ankle target the solver built, and where the leg actually put it.
        // `ankleFwd` is part of that target: a rolling foot pivots on the end
        // of it that is still down, so the joint travels forward over the ball
        // at toe-off and back over the heel at strike instead of the whole
        // sole sweeping about a pinned ankle. Reconstructing the target
        // WITHOUT it scores a leg that reaches its goal to 0.000mm as 68mm of
        // detachment — a model mismatch, not a stretch. The 6mm bound this
        // feeds is unchanged.
        ankleWant: [0, 1].map(k => {
          const f = anim.feet[k];
          return V3().copy(f.pos).addScaledVector(f.normal, anim.ankleY).setY(
            f.pos.y + f.normal.y * anim.ankleY + f.ankleRise)
            .add(V3(Math.sin(f.yaw) * f.ankleFwd, 0, Math.cos(f.yaw) * f.ankleFwd));
        }),
        ankleGot: [rig.tipPos('shinL', V3()), rig.tipPos('shinR', V3())],
        hip: rig.worldPos('hips', V3()),
        hipQ: rig.worldQuat('hips', new THREE.Quaternion()),
        headQ: rig.worldQuat('head', new THREE.Quaternion()),
        hand: [rig.tipPos('foreL', V3()), rig.tipPos('foreR', V3())],
        legUse: [['thighL', 'shinL'], ['thighR', 'shinR']].map(([a, b]) =>
          rig.worldPos(a, V3()).distanceTo(rig.tipPos(b, V3())) / (rig.get(a).length + rig.get(b).length)),
      });
    }
    for (const k of [0, 1]) { prev[k].copy(anim.feet[k].pos); pg[k] = anim.feet[k].grounded; }
  }
  const n = rec.length || 1;
  return {
    rig, anim, rec, steps, seconds,
    stepsPerSec: steps / seconds,
    slideTotal: rec.reduce((a, s) => a + s.slide[0] + s.slide[1], 0),
    slideWorst: Math.max(0, ...rec.flatMap(s => s.slide)),
    ankleErr: Math.max(0, ...rec.flatMap(s => [0, 1].map(k => s.ankleWant[k].distanceTo(s.ankleGot[k])))),
    duty: [0, 1].map(k => rec.filter(s => s.grounded[k]).length / n),
    doubleSupport: rec.filter(s => s.grounded[0] && s.grounded[1]).length / n,
    flight: rec.filter(s => !s.grounded[0] && !s.grounded[1]).length / n,
    legUse: Math.max(0, ...rec.flatMap(s => s.legUse)),
    hipRange: range(rec.map(s => s.hip.y)),
  };
}

/** Yaw of a world quaternion relative to the body's facing. */
function relYaw(q, facing, e) {
  e.setFromQuaternion(q, 'YXZ');
  return wrap(e.y - facing);
}

/**
 * THE ATTACK BENCH, hoisted to module scope so every attack check below shares
 * ONE of it. A second copy of a bench is a second thing to keep in step with
 * the rig, which is HANDOFF 2.4's defect wearing a lab coat.
 *
 * `Player` is imported DYNAMICALLY, inside a function body — HANDOFF 2.1: a
 * static edge from a check into the Player/World/Engine graph links against
 * the other copy of three, and that failure REPORTS rather than crashing.
 */
/**
 * @param action  the bound action to press, or null for an idle baseline
 * @param frames  how long to watch
 * @param opts.hold   how many frames to HOLD the button down for. 1 is a tap,
 *                    which is what every caller before the sequence existed
 *                    wanted; the heavy is the one attack whose whole shape is
 *                    a hold, so it needs this and nothing else does.
 * @param opts.combo  where in `SLASH.chain`'s sequence the press lands. 1 puts
 *                    the next left-button press on the THIRD step — the held
 *                    heavy — without driving two live cuts through the ring
 *                    first, which would score their hits against this one.
 */
export async function driveAttack(action, frames = 70, { hold = 1, combo = 0 } = {}) {
  const { Player } = await import('../../src/game/Player.js');
const stubWorld = () => ({
  scene: new THREE.Scene(),
  settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
  terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
    half: 200, crater() {}, surfaceAt: () => 'sand' },
  particles: null, bolts: null, time: 0, combatIntensity: 0,
  physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
  engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
  report() {},
});

  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0); p.velocity.set(0, 0, 0);
  p.saber.ignite(); p.saber.ignition = 1;
  const hit = new Set();
  const input = {
    keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
    accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
    act: () => false, actHit: (id) => hit.has(id),
  };
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  for (let i = 0; i < 120; i++) { ctx.time = world.time = i / 60; p.update(1 / 60, ctx); }

  // Everything relative to the BODY, so this measures the attack and not
  // the player drifting.
  const rel = (b) => p.rig.worldPos(b, V3()).sub(p.position);
  const shoulder = () => p.rig.tipPos('clavR', V3()).sub(p.position);
  if (combo) { p.control.comboStep = combo; p.control.comboTimer = 1; }
  const held = new Set();
  input.act = (id) => held.has(id);
  if (action) { hit.add(action); held.add(action); }
  const hand = [], joint = [], spine = [], clav = [];
  /* How high the tip stands while the heavy is CHAMBERED — the state between
   * the third press and letting go of it, which has no clock and therefore no
   * other way to be seen. */
  let chamberTip = -9, chamberFrames = 0;
  /**
   * A CROWD, AS EIGHTEEN CAPSULES ON A RING — the only honest way to ask
   * whether an attack is "effective for slashing down hordes", which is the
   * words the player used. One body every 20 degrees at 1.4 m, standing
   * 0.9 m to 1.7 m: a torso, at the distance a swing can reach.
   *
   * `front` counts the nine of them inside ±80 degrees of the sightline,
   * because a forward cut cannot be asked to reach behind the player and a
   * spin can.
   */
  const RING = [];
  for (let a = 0; a < 18; a++) {
    RING.push({ a, x: Math.sin(a * Math.PI / 9) * 1.4, z: Math.cos(a * Math.PI / 9) * 1.4, hit: false });
  }
  /** Closest approach between two segments — the blade and a body's axis. */
  const segSeg = (p1, p2, q1, q2) => {
    const d1 = p2.clone().sub(p1), d2 = q2.clone().sub(q1), r = p1.clone().sub(q1);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
    const den = a * e - b * b;
    let sN = den !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
    let tN = Math.max(0, Math.min(1, (b * sN + f) / e));
    sN = Math.max(0, Math.min(1, (b * tN - c) / a));
    return p1.clone().addScaledVector(d1, sN).distanceTo(q1.clone().addScaledVector(d2, tN));
  };
  let tip = 0, contact = 0, yawTurned = 0, bodyTurned = 0, lowest = 9;
  let prevYaw = p.camera.yaw;
  let gxLo = 9, gxHi = -9, gyLo = 9, gyHi = -9;
  for (let i = 0; i < frames; i++) {
    ctx.time = world.time = (120 + i) / 60;
    p.update(1 / 60, ctx);
    hit.clear();
    if (i >= hold - 1) held.clear();
    if (p.control.heavyArmed) {
      chamberFrames++;
      chamberTip = Math.max(chamberTip, p.saber.pointAt(1, V3()).y - p.position.y);
    }
    hand.push(rel('handR')); joint.push(shoulder());
    spine.push(p.rig.get('spine').obj.quaternion.clone());
    clav.push(p.rig.get('clavR').obj.quaternion.clone());
    tip = Math.max(tip, p.saber.speedAt(1));
    gxHi = Math.max(gxHi, p.control.gx); gxLo = Math.min(gxLo, p.control.gx);
    gyHi = Math.max(gyHi, p.control.gy); gyLo = Math.min(gyLo, p.control.gy);
    let d = p.camera.yaw - prevYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    yawTurned += Math.abs(d); prevYaw = p.camera.yaw;
    /* THE BODY'S OWN TURN, WHICH IS NOT THE CAMERA'S — and reading one for the
     * other is what made this bench say "the spin turned the body" about a
     * number that came off `camera.yaw`. `SaberController.bodyYaw` is the
     * frame's own delta for the trunk and `spinYaw` is the share of it that
     * reaches the view; the spin was deliberately rebuilt so those two are
     * different, because spending the whole revolution on the camera is the
     * thing the player called "it just moves your camera". */
    bodyTurned += Math.abs(p.control.bodyYaw ?? 0);
    const b0 = p.saber.base.clone(), b1 = p.saber.pointAt(1, V3());
    lowest = Math.min(lowest, b1.y - p.position.y);
    for (const cap of RING) {
      if (cap.hit) continue;
      const c0 = V3(p.position.x + cap.x, p.position.y + 0.9, p.position.z + cap.z);
      const c1 = V3(p.position.x + cap.x, p.position.y + 1.7, p.position.z + cap.z);
      if (segSeg(b0, b1, c0, c1) < 0.32) { cap.hit = true; contact = Math.max(contact, p.saber.speedAt(0.75)); }
    }
  }
  const spread = (a, f) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) m = Math.max(m, f(a[i], a[j]));
    return m;
  };
  const dist = (x, y) => x.distanceTo(y);
  const ang = (x, y) => x.angleTo(y) * D;
  return {
    hand: spread(hand, dist), joint: spread(joint, dist),
    spine: spread(spine, ang), clav: spread(clav, ang),
    /* HOW FAR THE HAND GETS, as well as how far it moved. See the stab's
     * clause: under a guard carried further forward those are different
     * questions and only one of them is what a lunge is for. */
    far: Math.max(...hand.map((h) => h.length())),
    /* THE BLADE'S OWN SIDE OF THE STORY. The body half above was already
     * healthy on the left button — it is these that were not. */
    tip, contact, yaw: yawTurned, body: bodyTurned, lowest,
    chamberTip, chamberFrames,
    across: gxHi - gxLo, up: gyHi - gyLo,
    ring: RING.filter((c) => c.hit).length,
    front: RING.filter((c) => c.hit && (c.a <= 4 || c.a >= 14)).length,
  };
}

export function run({ check, assert, near, THREE: T }) {
  THREE = T;
  const euler = new THREE.Euler();

  /* ── rule 1: a planted foot does not move ───────────────────────────── */

  check('gait: a planted foot does not move — not one millimetre, on any terrain', () => {
    // The single loudest thing wrong with the old solver. Stance did
    // `dampVec(f.planted, neutralStance, 4.5, dt)` — it dragged the contact
    // point toward a neutral stance that travels with the body — so standing
    // still while the body turned skated both feet across the ground without
    // ever taking a step.
    const bumpy = (x, z) => Math.sin(x * 0.4) * 0.55 + Math.cos(z * 0.31) * 0.4 + x * 0.06;
    const cases = [
      ['still', { speed: 0 }],
      ['turning 120°/s on the spot', { speed: 0, turn: 2.09 }],
      ['walking', { speed: 1.6 }],
      ['running', { speed: 4.6 }],
      ['sprinting', { speed: 7.45 }],
      ['running a 70°/s corner', { speed: 4.6, turn: 1.22 }],
      ['strafing', { strafe: 3 }],
      ['running over rolling ground', { speed: 4.2, ground: bumpy }],
      ['turning on rolling ground', { turn: 1.6, ground: bumpy }],
    ];
    const lines = [];
    for (const [name, o] of cases) {
      const r = walk({ seconds: 6, ...o });
      assert(r.slideWorst < 0.004,
        `${name}: a planted foot moved ${(r.slideWorst * 1000).toFixed(1)}mm in one frame`);
      assert(r.slideTotal < 0.02,
        `${name}: planted feet travelled ${(r.slideTotal * 100).toFixed(1)}cm in total`);
      lines.push(`${name} ${(r.slideTotal * 1000).toFixed(2)}mm`);
    }
    // and the turn is answered with STEPS, not with a pivot on locked soles
    const spin = walk({ speed: 0, turn: 2.09, seconds: 6 });
    assert(spin.stepsPerSec > 1.4,
      `turning on the spot took only ${spin.stepsPerSec.toFixed(2)} steps/s — the feet are pivoting`);
    return `${lines.join(', ')}; spinning on the spot takes ${spin.stepsPerSec.toFixed(2)} steps/s`;
  });

  /* ── rule 2: the leg reaches the foot the gait asked for ────────────── */

  check('gait: the leg REACHES the foot the gait planted — no stretch, no detach', () => {
    // solveIK clamps at 98.5% of the chain rather than stretching, so a target
    // beyond the leg silently leaves the drawn foot somewhere else entirely.
    // Measured before: 0.6mm of that at a walk, 218mm at a sprint, because the
    // pelvis was clamped on HEIGHT alone and only against the planted foot.
    const rows = [];
    for (const speed of [0, 1.2, 2.5, 4.6, 7.45]) {
      const r = walk({ speed, seconds: 7 });
      assert(r.ankleErr < 0.006,
        `at ${speed} m/s the drawn ankle is ${(r.ankleErr * 1000).toFixed(0)}mm from where the gait planted it`);
      assert(r.legUse < 0.985,
        `at ${speed} m/s the leg is ${(r.legUse * 100).toFixed(1)}% extended — it is at the solver's clamp`);
      rows.push(`${speed}m/s ${(r.ankleErr * 1000).toFixed(2)}mm/${(r.legUse * 100).toFixed(0)}%`);
    }
    // on a slope too, where the low foot used to dangle
    const ramp = walk({ speed: 3, seconds: 6, ground: (x, z) => z * 0.36 });
    assert(ramp.ankleErr < 0.006, `up a 20° ramp the ankle is ${(ramp.ankleErr * 1000).toFixed(0)}mm off`);
    // and sideways, which is the worst case: the stance line and the stride
    // line are the same line. Measured 88mm of detach at a 4.6 m/s strafe.
    for (const strafe of [1.5, 3, 4.6]) {
      const r = walk({ strafe, seconds: 6 });
      assert(r.ankleErr < 0.006,
        `strafing at ${strafe} m/s the ankle is ${(r.ankleErr * 1000).toFixed(0)}mm off its target`);
    }
    return `${rows.join(', ')}, 20° ramp ${(ramp.ankleErr * 1000).toFixed(2)}mm, strafes clean`;
  });

  check('gait: the legs pass each other, not through each other', () => {
    // A sidestep is the one direction where the stance line and the stride
    // line coincide, so the swing foot has to pass the planted one. It used to
    // pass THROUGH it: boot-to-boot 4.9cm at a 3 m/s strafe, with boots 10cm
    // across. The stance widens and the swing lifts higher for lateral travel
    // now, exactly as a person cross-steps.
    const seg = (p1, q1, p2, q2) => {
      const d1 = V3().subVectors(q1, p1), d2 = V3().subVectors(q2, p2), r = V3().subVectors(p1, p2);
      const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
      const den = a * e - b * b;
      let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      const t = Math.min(1, Math.max(0, (b * s + f) / (e || 1e-12)));
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * t - c) / a)) : 0;
      return V3().copy(p1).addScaledVector(d1, s).distanceTo(V3().copy(p2).addScaledVector(d2, t));
    };
    const rows = [];
    for (const [name, o] of [
      ['forward 4.6', { speed: 4.6 }], ['walk', { speed: 1.4 }],
      ['strafe 3', { strafe: 3 }], ['strafe 4.6', { strafe: 4.6 }],
      ['diagonal', { speed: 3.2, strafe: 3.2 }], ['circle-strafe', { strafe: 3.5, turn: 1.2 }],
      ['turn in place', { turn: 2.09 }],
    ]) {
      const r = walk({ seconds: 6, ...o });
      let worst = Infinity;
      // ankle-to-contact-point segments: the boot, as a line, both sides
      for (const s of r.rec) {
        worst = Math.min(worst, seg(s.ankleGot[0], s.foot[0], s.ankleGot[1], s.foot[1]));
      }
      assert(worst > 0.08,
        `${name}: the two boots came within ${(worst * 100).toFixed(1)}cm — they are drawn inside each other`);
      rows.push(`${name} ${(worst * 100).toFixed(0)}cm`);
    }
    return rows.join(', ');
  });

  /* ── rule 3: a walk and a run are different gaits ───────────────────── */

  check('gait: a walk has double support, a run has flight, and it used to have neither', () => {
    // Duty factor measured 0.500 at 1.2, 2.5, 4.5 AND 7.5 m/s — the two feet
    // handed off instantaneously at every speed, so nothing about the contact
    // pattern distinguished a stroll from a sprint.
    const walk12 = walk({ speed: 1.2, seconds: 8 });
    const walk25 = walk({ speed: 2.5, seconds: 8 });
    const run = walk({ speed: 4.6, seconds: 8 });
    const sprint = walk({ speed: 7.45, seconds: 8 });

    assert(walk12.doubleSupport > 0.15,
      `a 1.2 m/s walk spends only ${(walk12.doubleSupport * 100).toFixed(0)}% of the cycle on two feet`);
    assert(walk12.flight < 0.01, 'a walk must never leave the ground');
    assert(run.flight > 0.12, `a 4.6 m/s run is airborne only ${(run.flight * 100).toFixed(0)}% of the cycle`);
    assert(sprint.flight > run.flight - 0.02, 'a sprint must not be less airborne than a run');
    assert(run.doubleSupport < 0.02, 'a run must not have a double-support phase');
    // and the transition has to be monotone, not a switch
    const duty = [walk12, walk25, run, sprint].map(r => (r.duty[0] + r.duty[1]) / 2);
    for (let i = 1; i < duty.length; i++) {
      assert(duty[i] <= duty[i - 1] + 1e-3, `duty factor went UP from ${duty[i - 1].toFixed(3)} to ${duty[i].toFixed(3)}`);
    }
    assert(duty[0] - duty[3] > 0.2, `duty only moves ${(duty[0] - duty[3]).toFixed(3)} from walk to sprint`);
    // the pelvis rises over mid-stance walking and drops there running: the
    // two gaits are 180° out of phase vertically, which is why the sign flips
    assert(run.hipRange > walk12.hipRange * 1.6,
      `the run's pelvis only travels ${(run.hipRange * 100).toFixed(1)}cm against the walk's ${(walk12.hipRange * 100).toFixed(1)}cm`);
    return `duty ${duty.map(d => d.toFixed(2)).join(' → ')}, double support ${(walk12.doubleSupport * 100).toFixed(0)}% at a walk, `
      + `flight ${(run.flight * 100).toFixed(0)}%/${(sprint.flight * 100).toFixed(0)}% at run/sprint, `
      + `pelvis travel ${(walk12.hipRange * 100).toFixed(1)}→${(sprint.hipRange * 100).toFixed(1)}cm`;
  });

  check('gait: cadence is a human one at every speed, and never saturates', () => {
    // The old stride clamp pinned the step rate at 6.75 steps/s from 4.5 m/s
    // upward — a scurry — and ran 6.1 steps/s at 2.5 m/s, which is a sprint
    // cadence for a stroll.
    const rows = [];
    let last = 0;
    for (const speed of [1.2, 2.5, 4.6, 7.45]) {
      const r = walk({ speed, seconds: 8 });
      const stepLen = speed / r.stepsPerSec;
      assert(r.stepsPerSec > 1.5 && r.stepsPerSec < 6,
        `${speed} m/s runs at ${r.stepsPerSec.toFixed(2)} steps/s`);
      assert(stepLen > 0.35 && stepLen < 1.6,
        `${speed} m/s takes ${stepLen.toFixed(2)}m steps`);
      assert(r.stepsPerSec > last + 0.1, `cadence saturated at ${r.stepsPerSec.toFixed(2)} steps/s by ${speed} m/s`);
      last = r.stepsPerSec;
      rows.push(`${speed}m/s ${r.stepsPerSec.toFixed(2)}/s × ${stepLen.toFixed(2)}m`);
    }
    return rows.join(', ');
  });

  /* ── the foot against the ground it is actually on ──────────────────── */

  check('gait: the sole lies on the slope it is standing on, not level with the world', () => {
    // The ankle roll used world up as its reference, so on a hill the sole
    // stayed horizontal and the boot went into the ground: measured 74mm of a
    // Jedi's boot buried on a 25° uphill stance, 14mm across a 25° sidehill.
    const built = buildJedi({ robeIndex: 0, scale: 1 });
    const rig = built.rig;
    const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    const rows = [];
    let worstIn = 0, worstOut = 0;
    for (const deg of [0, 10, 20, 25]) {
      for (const [dir, ax] of [['fore/aft', 'z'], ['sidehill', 'x']]) {
        const k = Math.tan(deg / D);
        const ground = (x, z) => (ax === 'x' ? x : z) * k;
        const up = (ax === 'x' ? V3(-k, 1, 0) : V3(0, 1, -k)).normalize();
        const pos = V3(0, 0, 0);
        for (let i = 0; i < 200; i++) {
          anim.update(1 / 60, { position: pos, facing: 0, velocity: V3(), grounded: true,
            groundAt: ground, crouch: 0, accelForward: 0 });
        }
        rig.updateMatrices();
        rig.root.updateMatrixWorld(true);
        let lo = Infinity, hi = -Infinity;
        const w = V3();
        for (const bn of ['footL', 'footR']) {
          for (const m of rig.get(bn).parts) {
            m.updateMatrixWorld(true);
            const p = m.geometry.attributes.position;
            for (let v = 0; v < p.count; v++) {
              w.set(p.getX(v), p.getY(v), p.getZ(v)).applyMatrix4(m.matrixWorld);
              // perpendicular distance from the inclined ground plane
              const d = (w.y - ground(w.x, w.z)) * up.y;
              lo = Math.min(lo, d); hi = Math.max(hi, d);
            }
          }
        }
        assert(lo > -0.006, `on a ${deg}° ${dir} slope the boot is ${(-lo * 1000).toFixed(0)}mm into the ground`);
        assert(lo < 0.02, `on a ${deg}° ${dir} slope the boot hovers ${(lo * 1000).toFixed(0)}mm above it`);
        worstIn = Math.min(worstIn, lo); worstOut = Math.max(worstOut, lo);
        if (deg === 25) rows.push(`25° ${dir} ${(lo * 1000).toFixed(1)}mm`);
      }
    }
    return `8 stances to 25°, sole clearance ${(worstIn * 1000).toFixed(1)}..${(worstOut * 1000).toFixed(1)}mm — ${rows.join(', ')}`;
  });

  /* ── the body above the pelvis ──────────────────────────────────────── */

  check('posture: the pelvis rotates, lists and sways, and it used to do none of it', () => {
    // Transverse rotation toward the swing leg, frontal list toward the
    // unsupported side, and lateral sway over the stance foot. All three
    // measured exactly 0.0° before.
    const r = walk({ speed: 2.5, seconds: 8 });
    const yaw = r.rec.map(s => relYaw(s.hipQ, s.facing, euler));
    const yawDeg = range(yaw) * D;
    assert(yawDeg > 4, `the pelvis rotates ${yawDeg.toFixed(1)}° about the spine over a stride`);
    assert(yawDeg < 26, `the pelvis rotates ${yawDeg.toFixed(1)}° — that is a twist, not a walk`);

    // sway must be TOWARD the foot carrying the weight, or it reads as a limp:
    // correlate the pelvis's lateral offset with which foot is planted alone
    let agree = 0, total = 0;
    for (const s of r.rec) {
      if (s.grounded[0] === s.grounded[1]) continue;      // double support says nothing
      const fwd = V3(Math.sin(s.facing), 0, Math.cos(s.facing));
      const left = V3(fwd.z, 0, -fwd.x);
      const lateral = V3().subVectors(s.hip, s.pos).dot(left);
      const stanceSide = s.grounded[0] ? 1 : -1;          // foot 0 sits on +left
      if (Math.abs(lateral) > 1e-4) { total++; if (Math.sign(lateral) === stanceSide) agree++; }
    }
    assert(total > 40, 'not enough single-support frames to judge the sway');
    assert(agree / total > 0.85,
      `the pelvis leans over the stance foot in only ${(agree / total * 100).toFixed(0)}% of single-support frames`);

    // and a run sways less than a walk, because the feet are under the midline
    const swayOf = (rec) => range(rec.map(s => {
      const fwd = V3(Math.sin(s.facing), 0, Math.cos(s.facing));
      return V3().subVectors(s.hip, s.pos).dot(V3(fwd.z, 0, -fwd.x));
    }));
    const swayWalk = swayOf(walk({ speed: 1.5, seconds: 8 }).rec);
    assert(swayWalk > 0.02, `the pelvis sways only ${(swayWalk * 1000).toFixed(0)}mm at a walk`);
    return `pelvis ${yawDeg.toFixed(1)}° of transverse rotation, ${(swayWalk * 1000).toFixed(0)}mm of sway at a walk, `
      + `over the stance foot in ${(agree / total * 100).toFixed(0)}% of single-support frames`;
  });

  check('posture: the ribcage counters the pelvis and the head rides level', () => {
    // A head welded to the hips swings through the pelvis's whole excursion
    // and reads as a mannequin on a stick. Real gait spends the spine and the
    // neck cancelling it: the pelvis turns, the ribcage turns back, the head
    // barely moves. Before: pelvis 0.0°, chest 0.0°, head 0.0° — nothing moved
    // relative to anything, which is the same failure with the volume off.
    const rows = [];
    for (const speed of [1.5, 4.6]) {
      const r = walk({ speed, seconds: 8 });
      const hipYaw = range(r.rec.map(s => relYaw(s.hipQ, s.facing, euler))) * D;
      const headYaw = range(r.rec.map(s => relYaw(s.headQ, s.facing, euler))) * D;
      assert(hipYaw > 4, `the pelvis barely turns at ${speed} m/s (${hipYaw.toFixed(1)}°)`);
      assert(headYaw < hipYaw * 0.35,
        `the head swings ${headYaw.toFixed(1)}° against the pelvis's ${hipYaw.toFixed(1)}° — it is welded to the hips`);
      rows.push(`${speed}m/s pelvis ${hipYaw.toFixed(1)}° → head ${headYaw.toFixed(1)}°`);
    }
    return rows.join(', ');
  });

  check('posture: the body banks into a corner and leans into its own speed', () => {
    // Bank was fed from `accelStrafe`, which Player, Enemy and Net all pass as
    // 0 or not at all — so it was dead code and cornering was perfectly
    // upright. The turn rate is derived here from the facing the caller hands
    // over, which nobody has to remember to supply.
    const bankOf = (o) => {
      const r = walk({ seconds: 6, ...o });
      let sum = 0, lean = 0;
      for (const s of r.rec) {
        const fwd = V3(Math.sin(s.facing), 0, Math.cos(s.facing));
        const up = V3(0, 1, 0).applyQuaternion(s.hipQ);
        sum += up.dot(V3(fwd.z, 0, -fwd.x));
        lean += up.dot(fwd);
      }
      return { bank: Math.asin(sum / r.rec.length) * D, lean: Math.asin(lean / r.rec.length) * D };
    };
    const straight = bankOf({ speed: 4.6 });
    const leftTurn = bankOf({ speed: 4.6, turn: 1.22 });
    const rightTurn = bankOf({ speed: 4.6, turn: -1.22 });
    const spin = bankOf({ speed: 0, turn: 2.09 });

    assert(Math.abs(straight.bank) < 0.5, `running straight banks ${straight.bank.toFixed(2)}°`);
    assert(leftTurn.bank > 2, `a 70°/s corner at 4.6 m/s banks only ${leftTurn.bank.toFixed(2)}°`);
    assert(leftTurn.bank < 15, `that corner banks ${leftTurn.bank.toFixed(2)}° — it is falling over`);
    near(leftTurn.bank, -rightTurn.bank, 0.2, 'banking is not symmetric left and right');
    assert(Math.abs(spin.bank) < 1, `turning on the spot banks ${spin.bank.toFixed(2)}° with no speed to bank against`);

    // and a run carries a forward set that standing still does not
    const still = bankOf({ speed: 0 });
    assert(straight.lean > 1.5, `a 4.6 m/s run leans only ${straight.lean.toFixed(2)}° forward`);
    assert(straight.lean < 12, `a 4.6 m/s run leans ${straight.lean.toFixed(2)}° forward`);
    assert(Math.abs(still.lean) < 0.6, `standing still leans ${still.lean.toFixed(2)}°`);
    return `corner ±${leftTurn.bank.toFixed(2)}°, straight ${straight.bank.toFixed(2)}°, spin ${spin.bank.toFixed(2)}°; `
      + `forward lean ${still.lean.toFixed(2)}° standing → ${straight.lean.toFixed(2)}° running`;
  });

  check('posture: a figure standing still is breathing, not switched off', () => {
    // Idle measured hip travel 0.0mm and head travel 0.0mm over six seconds: a
    // statue. It also has to stay a small effect — this is the knob that turns
    // a standing character into a bobblehead.
    const r = walk({ speed: 0, seconds: 12, warm: 1 });
    const hip = range(r.rec.map(s => s.hip.y));
    const lat = range(r.rec.map(s => {
      const left = V3(Math.cos(s.facing), 0, -Math.sin(s.facing));
      return V3().subVectors(s.hip, s.pos).dot(left);
    }));
    assert(hip > 0.004, `a standing figure's pelvis moves ${(hip * 1000).toFixed(1)}mm vertically — it is a statue`);
    assert(hip < 0.03, `a standing figure's pelvis moves ${(hip * 1000).toFixed(0)}mm vertically — it is bobbing`);
    assert(lat > 0.008, `a standing figure never shifts its weight (${(lat * 1000).toFixed(1)}mm)`);
    assert(lat < 0.06, `a standing figure sways ${(lat * 1000).toFixed(0)}mm — it is swaying drunk`);
    assert(r.slideTotal < 0.002, `and it does all of it without moving its feet: ${(r.slideTotal * 1000).toFixed(2)}mm`);
    return `${(hip * 1000).toFixed(1)}mm of breath, ${(lat * 1000).toFixed(1)}mm of weight shift, feet dead still`;
  });

  check('gait: a landing is absorbed by the knees instead of being snapped out of', () => {
    const r = walk({
      speed: 3, seconds: 4, warm: 0,
      grounded: (t) => t < 1 || t > 1.55,
      vy: (t) => (t < 1 ? 0 : -9 * Math.min(t - 1, 0.55)),
    });
    const before = r.rec.filter(s => s.t > 0.6 && s.t < 0.95).map(s => s.hip.y - s.pos.y);
    const after = r.rec.filter(s => s.t > 1.56 && s.t < 1.75).map(s => s.hip.y - s.pos.y);
    const settled = r.rec.filter(s => s.t > 2.6).map(s => s.hip.y - s.pos.y);
    const stand = before.reduce((a, b) => a + b) / before.length;
    const dip = Math.min(...after);
    const back = settled.reduce((a, b) => a + b) / settled.length;
    assert(stand - dip > 0.05, `the pelvis only dipped ${((stand - dip) * 100).toFixed(1)}cm on landing`);
    assert(stand - dip < 0.35, `the pelvis dropped ${((stand - dip) * 100).toFixed(0)}cm — that is a collapse`);
    near(back, stand, 0.05, 'the pelvis never came back up after landing');
    assert(r.rec.every(s => isFinite(s.hip.y)), 'the landing produced a non-finite pose');
    return `hips ${(stand * 100).toFixed(1)}cm → ${(dip * 100).toFixed(1)}cm on impact → ${(back * 100).toFixed(1)}cm settled`;
  });

  check('gait: the arms swing against the legs, the way a body balances itself', () => {
    const rig = new Rig(humanoidSkeleton(1));
    const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    anim.setFacing(0);
    const pos = V3(0, 0, 0);
    let agree = 0, total = 0, swing = 0;
    for (let i = 0; i < 480; i++) {
      pos.z += 3 / 60;
      anim.update(1 / 60, { position: pos, facing: 0, velocity: V3(0, 0, 3), grounded: true,
        groundAt: () => 0, crouch: 0, accelForward: 0.4 });
      anim.swingArms(1 / 60, 3, 1);
      rig.updateMatrices();
      if (i < 120) continue;
      const footLead = anim.feet[0].pos.z - anim.feet[1].pos.z;     // + = left foot forward
      const handLead = rig.tipPos('foreR', V3()).z - rig.tipPos('foreL', V3()).z;  // + = right hand forward
      swing = Math.max(swing, Math.abs(handLead));
      // near a crossing "which one is in front" is not a question, so gate on
      // both sides having actually committed
      if (Math.abs(footLead) > 0.12 && Math.abs(handLead) > 0.03) {
        total++; if (Math.sign(footLead) === Math.sign(handLead)) agree++;
      }
    }
    assert(swing > 0.12, `the arms only swing ${(swing * 100).toFixed(1)}cm apart at a 3 m/s jog`);
    assert(total > 100, 'not enough frames with a clear leading foot');
    assert(agree / total > 0.9,
      `the right hand leads with the left foot in only ${(agree / total * 100).toFixed(0)}% of frames — the swing is ipsilateral`);
    return `${(swing * 100).toFixed(0)}cm of arm swing, contralateral in ${(agree / total * 100).toFixed(0)}% of frames`;
  });

  check('gait: the same run at 30, 60 and 144 Hz is the same run', () => {
    // Everything in the solver integrates dt — the swing clock, the phase, the
    // damping — so a slow frame must cost timing, not geometry.
    const rows = [];
    let base = null;
    for (const hz of [30, 60, 144]) {
      const r = walk({ speed: 4.6, seconds: 8, dt: 1 / hz });
      const feetSpread = Math.max(...r.rec.map(s =>
        Math.max(s.foot[0].distanceTo(s.pos), s.foot[1].distanceTo(s.pos))));
      assert(r.ankleErr < 0.008, `at ${hz}Hz the ankle is ${(r.ankleErr * 1000).toFixed(0)}mm off its target`);
      assert(r.slideWorst < 0.02, `at ${hz}Hz a planted foot moved ${(r.slideWorst * 1000).toFixed(1)}mm in a frame`);
      assert(feetSpread < 1.4, `at ${hz}Hz a foot got ${feetSpread.toFixed(2)}m from the body`);
      if (base === null) base = r.stepsPerSec;
      else near(r.stepsPerSec, base, base * 0.2, `cadence at ${hz}Hz`);
      rows.push(`${hz}Hz ${r.stepsPerSec.toFixed(2)} steps/s, foot ≤${feetSpread.toFixed(2)}m out`);
    }
    return rows.join('; ');
  });

  check('gait: nothing in the solver can produce a NaN, at any scale', () => {
    // Scales run 1.00 (Jedi) to 1.18 (B2) and the beast frames go further; a
    // zero dt, a zero-length velocity and a vertical wall of ground are all
    // things the game hands this thing in practice.
    const cliff = (x, z) => (z > 3 ? 40 : 0);
    let checked = 0;
    for (const scale of [0.7, 1, 1.18, 2.4]) {
      const rig = new Rig(humanoidSkeleton(scale), { scale });
      const anim = new BipedAnimator(rig, { scale, hipHeight: 0.95 * scale });
      const pos = V3(0, 0, 0);
      let facing = 0;
      for (let i = 0; i < 600; i++) {
        const dt = i % 97 === 0 ? 0 : (i % 53 === 0 ? 0.9 : 1 / 60);
        const speed = i < 100 ? 0 : (i < 300 ? 5.5 : (i < 400 ? 0 : 9));
        facing += (i % 7 ? 1.9 : -3.4) * dt;
        const fwd = V3(Math.sin(facing), 0, Math.cos(facing));
        pos.addScaledVector(fwd, speed * dt);
        pos.y = cliff(pos.x, pos.z);
        anim.setFacing(facing);
        anim.update(dt, { position: pos, facing, velocity: fwd.clone().multiplyScalar(speed),
          grounded: i % 71 !== 0, groundAt: cliff, crouch: (i % 200) / 200, accelForward: 1 });
        anim.swingArms(dt, speed, 1);
        rig.updateMatrices();
        for (const b of rig.list) {
          const p = rig.worldPos(b.name, V3());
          assert(isFinite(p.x) && isFinite(p.y) && isFinite(p.z),
            `bone ${b.name} went non-finite at scale ${scale}, frame ${i}`);
          checked++;
        }
      }
    }
    return `4 scales × 600 frames of zero-dt, 0.9s-dt, cliffs and mid-air, ${checked} bone transforms all finite`;
  });

  check('gait: a sidestep turns the legs into it — the crab walk', () => {
    /**
     * THE CRAB WALK, reported and reported again.
     *
     * `p.facing` is where the body is AIMED, and with a lit blade the player
     * holds the camera's yaw whatever way they are travelling. Everything below
     * the belt was built off that facing — the stance line, the step
     * separation, the hip sway, the pelvis quaternion — so a sidestep was the
     * whole body sliding across the ground still square to the front, feet
     * paddling underneath it. A crab is the only thing that walks with its
     * stance line across its travel.
     *
     * Three numbers say it is fixed, and they have to be read together or a
     * body that simply turned to run away would pass:
     *
     *   the PELVIS comes round into the travel — it did not move at all;
     *   the SHOULDERS do not, because the player is aiming;
     *   and the feet still land on the stride, which is what the existing
     *   "leg REACHES the foot" and "legs pass each other" checks hold.
     */
    const rows = [];
    for (const [name, o, wantPelvis] of [
      ['straight', { speed: 4.6 }, 0],
      ['sidestep', { strafe: 3.0 }, 40],
      ['fast sidestep', { strafe: 4.6 }, 40],
      ['diagonal', { speed: 3.2, strafe: 3.2 }, 20],
    ]) {
      const r = walk({ ...o, seconds: 6 });
      const e = new THREE.Euler();
      // mean, not peak: the gait's own transverse rotation swings ±7° a stride
      // and would otherwise be mistaken for the turn being measured.
      const mean = (sel) => r.rec.reduce((a, s) => a + relYaw(s[sel], s.facing, e), 0) / r.rec.length;
      const pelvis = Math.abs(mean('hipQ')) * 180 / Math.PI;
      const head = Math.abs(mean('headQ')) * 180 / Math.PI;
      assert(pelvis >= wantPelvis,
        `${name}: the pelvis is ${pelvis.toFixed(0)}° off the aim where it needs at least ${wantPelvis}° — `
        + 'the legs are being carried sideways');
      assert(head < 22,
        `${name}: the head is ${head.toFixed(0)}° off the aim — the strafe is dragging the player's gaze round with it`);
      rows.push(`${name} pelvis ${pelvis.toFixed(0)}° head ${head.toFixed(0)}°`);
    }
    return rows.join(', ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  An attack is a body, not an elbow — player note 23               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('attack: the THIRD press comes down through a man, and holds a real chamber', async () => {
    /**
     * THE PAYOFF OF THE SEQUENCE, AND THE ONE PRESS OF IT NOTHING MEASURED.
     *
     *   "obviously pressing it closely in succession will do like an attack
     *    sequence of some sort, maybe like three clicks will be two light
     *    attacks and then a heavy slash you can hold and release for more
     *    power idk"
     *
     * `tools/checks/directional.mjs` drives the sequence's STATE MACHINE — the
     * step counter, the chamber, the release, the window closing — and that is
     * all anything drove. Nothing had ever asked where the third press puts the
     * blade, and the answer was: over their heads.
     *
     * `HEAVY.lift/fall` was `0.44 → 0.52`, which is the arc SLASH's own note
     * measured and abandoned ONE PRESS EARLIER in the same combination: the
     * ready guard points the blade up, so a stroke carried near the middle of
     * the guard box passes above a standing man. Measured on this bench, the
     * lowest the TIP reaches through the whole attack:
     *
     *     light cut (presses 1 and 2)   1.19 m      ← bounded below at 1.55
     *     heavy      0.44 / 0.52        1.62 m      ← nothing bounded it
     *     heavy      0.30 / 0.75        1.18 m
     *
     * and against a real acolyte's capsules in a real World, one tapped heavy
     * at seven ranges from 1.0 m to 2.2 m reached the body at two of them
     * against the light cut's six.
     *
     * So the heavy is held to the SAME FLOOR as the light cut it is the third
     * press of — not to a number of its own, because the thing being asserted
     * is that they land on the same bodies.
     *
     * AND THE CHAMBER IS A REAL POSE. The state between the third press and
     * letting go has no clock on it, so the only way to see it is to look at
     * the blade: it must be genuinely up, and it must still be up several
     * seconds later. That second half is the bind for a defect that was not a
     * pose problem at all — see the guard-box clause in
     * tools/checks/sequence.mjs, which drives it through a real World.
     */
    const { HEAVY, GX_MAX, GY_MAX } = await import('../../src/game/SaberController.js');
    const light = await driveAttack('thrust');
    const tap = await driveAttack('thrust', 120, { hold: 2, combo: 1 });
    const charged = await driveAttack('thrust', 200, { hold: 70, combo: 1 });

    assert(tap.chamberFrames > 0 && charged.chamberFrames > 40,
      `the third press chambered for ${tap.chamberFrames} and ${charged.chamberFrames} frames — the bench `
      + 'is not reaching the held heavy at all, so nothing below means anything');
    assert(charged.chamberTip > 2.0,
      `the blade stood at ${charged.chamberTip.toFixed(2)} m while the heavy was chambered — a chamber the `
      + 'player cannot see is not a wind-up, it is a pause');
    assert(tap.lowest < light.lowest + 0.05,
      `the heavy's tip bottoms at ${tap.lowest.toFixed(2)} m against the light cut's ${light.lowest.toFixed(2)} — `
      + 'the third press of the sequence passes over the bodies the first two go through');
    assert(charged.lowest < light.lowest + 0.05,
      `a CHARGED heavy bottoms at ${charged.lowest.toFixed(2)} m against the light cut's `
      + `${light.lowest.toFixed(2)} — the more you commit, the further over their heads it goes`);
    /* IT IS STILL A LATERAL CUT AND NOT A CHOP: the whole guard box across,
     * against a descent of well under it. `HEAVY.rise/drop` is the width and
     * this reads what the guard actually travelled, after the clamp. */
    assert(tap.across > GX_MAX * 1.8,
      `the heavy travelled ${tap.across.toFixed(2)} units across a ${(GX_MAX * 2).toFixed(1)}-unit guard box`);
    assert(tap.across > tap.up * 1.6,
      `the heavy moved ${tap.across.toFixed(2)} across and ${tap.up.toFixed(2)} down — that is a chop, and `
      + 'the heavy is the lateral cut with a different envelope');
    /* AND IT IS THE HEAVIEST OF THE THREE. Damage in this game is blade speed;
     * a third press slower than the first two is a sequence with no payoff. */
    assert(tap.tip > light.tip && charged.tip > tap.tip,
      `light ${light.tip.toFixed(1)} → heavy ${tap.tip.toFixed(1)} → charged ${charged.tip.toFixed(1)} m/s — `
      + 'the sequence does not get heavier as it goes');
    assert(HEAVY.lift < GY_MAX && HEAVY.lift > 0,
      `HEAVY.lift is ${HEAVY.lift} — the chamber has to be ABOVE the ready guard to read as one`);
    return `light ${light.lowest.toFixed(2)} m / ${light.tip.toFixed(1)} m/s; heavy ${tap.lowest.toFixed(2)} m / `
      + `${tap.tip.toFixed(1)} m/s; charged ${charged.lowest.toFixed(2)} m / ${charged.tip.toFixed(1)} m/s; `
      + `chamber holds the tip at ${charged.chamberTip.toFixed(2)} m for ${charged.chamberFrames} frames`;
  });

  check('attack: the left button CUTS, and the spin turns the whole body through a crowd', async () => {
    /**
     * THE PLAYER, HAVING PLAYED IT:
     *
     *   "the left click attacks barely do anything like it's the slightest
     *    movement of the saber same with the spin attack like I need something
     *    violent but graceful and effective for slashing down hordes of enemies
     *    and it's almost like both attacks do nothing"
     *
     *   "the spin attack needs to be like a whole body spin/directional force
     *    spin thing you know what I mean? you should be able to direct it as
     *    well for the short time you're spinning"
     *
     *   "The overhead attack is a lot better like good job it feels real"
     *
     * So the OVERHEAD IS THE REFERENCE and this check is the comparison, run on
     * one bench, in one pass. What it found is not what the words suggest:
     *
     *                 tip peak  guard across  ring  front  body turn  spine
     *     overhead      10.8      0.00 units  2/18   2/9        0°     37.9°
     *     left button    5.9      0.00        1/18   1/9        0°     21.7°
     *     spin          11.0      1.98        2/18   1/9       35°      7.1°
     *
     *   · the left button had no ARC AT ALL — it was a pure thrust, 0.00 units
     *     of lateral guard travel — and 5.9 m/s is under the 8 m/s this game's
     *     own cutting model calls the speed at which a swing outworks a press.
     *     Its BODY was fine. Its blade did nothing.
     *   · the spin had the fastest blade in the game and no body: less trunk
     *     than the overhead, zero shoulder girdle, and 35 degrees of turn.
     *   · and standing in the middle of eighteen bodies, the attack that exists
     *     to answer being surrounded reached exactly as many of them as a
     *     downward chop: two.
     *
     * The bounds below are the floor of what reads as a cut rather than the
     * numbers that ship, so re-tuning does not break them and deleting does.
     */
    const over = await driveAttack('attackOver');
    const cut = await driveAttack('thrust');
    const spin = await driveAttack('attackSpin', 90);

    /* THE REFERENCE IS STILL THE REFERENCE. If the overhead ever stops being
     * the thing the player named as good, every bound below is measured
     * against a moved goalpost. */
    assert(over.tip > 8 && over.spine > 30,
      `the overhead — the attack this check is calibrated against — came out at ${over.tip.toFixed(1)} m/s `
      + `and ${over.spine.toFixed(1)}° of spine; it is no longer the reference`);

    // ── 1. THE LEFT BUTTON IS A CUT.
    assert(cut.across > 0.9,
      `the left button moved the guard ${cut.across.toFixed(2)} units across — it was 0.00, a pure `
      + 'thrust, and that is what "the slightest movement of the saber" is');
    assert(cut.tip > 8,
      `the left button peaked the blade at ${cut.tip.toFixed(1)} m/s, under the 8 m/s at which this `
      + "game's own cutting model says a swing outworks a press");
    assert(cut.lowest < 1.55,
      `the cut never brought the tip below ${cut.lowest.toFixed(2)} m — the ready guard points the blade `
      + 'UP, so a stroke that leaves the pitch alone passes over a standing man');
    assert(cut.front >= 3,
      `one pass of the left button crossed ${cut.front} of the 9 bodies in front of the player — it was 1, `
      + 'and a cut that reaches one body is not an answer to a horde');
    assert(cut.spine > 20 && cut.clav > 15,
      `the cut turns ${cut.spine.toFixed(1)}° of spine and ${cut.clav.toFixed(1)}° of shoulder girdle`);

    /**
     * ── 2. THE SPIN IS A WHOLE BODY, AND IT GOES ALL THE WAY ROUND.
     *
     * THIS CLAUSE'S PREMISE EXPIRED AND THAT IS THE ONLY REASON IT IS EDITED.
     * It read `spin.yaw > 6.0` off a counter that accumulates `camera.yaw`,
     * and called the result "the body" — fair when it was written, because
     * every radian of the turn went to the view. The spin has since been
     * rebuilt against the player's other sentence about it, "it just moves
     * your camera": the BODY takes the whole revolution and `SPIN.viewShare`
     * decides how much of it the view is allowed to have.
     *
     * Measured on the rebuilt move: 16.33 rad of body against 5.55 of camera,
     * which is 2.6 turns of trunk and 0.88 of view. The old bound, read off
     * the camera, therefore failed on a spin that turns nearly three times —
     * the check would have been demanding the defect back.
     *
     * So it is asserted where it belongs: the BODY goes all the way round, and
     * the camera is held to a minority of it.
     */
    assert(spin.body > 6.0,
      `the spin turned the body ${spin.body.toFixed(2)} rad — it was 0.62, which is a glance, not a spin`);
    assert(spin.yaw < spin.body * 0.5,
      `${spin.yaw.toFixed(2)} of the spin's ${spin.body.toFixed(2)} rad went to the CAMERA — that is `
      + 'the "it just moves your camera" this move was rebuilt to stop being');
    assert(spin.ring >= 12,
      `one spin crossed ${spin.ring} of the 18 bodies standing round the player — it was 2, exactly what a `
      + 'downward chop reaches');
    assert(spin.spine > 15,
      `the spin turns ${spin.spine.toFixed(1)}° of trunk — it was 7.1, LESS than the overhead, which is a `
      + 'wrist on a turntable');
    assert(spin.clav > 10,
      `the spin turns ${spin.clav.toFixed(1)}° of shoulder girdle — it was 0.0, exactly zero`);
    assert(spin.joint > 0.15,
      `the spin's shoulder JOINT travels ${(spin.joint * 1000).toFixed(0)} mm against the overhead's `
      + `${(over.joint * 1000).toFixed(0)} mm — the girdle is turning in place`);

    // ── 3. AND NEITHER OUTRUNS THE ATTACK THE PLAYER SAID WAS GOOD BY SO MUCH
    //       THAT IT REPLACES IT. Damage in this game is blade speed, so a light
    //       attack faster than a CHARGED overhead would make the heavy a
    //       decoration. CHARGE.cut buys the overhead about 1.6x its tap speed.
    assert(cut.tip < over.tip * 1.6,
      `the left button peaks at ${cut.tip.toFixed(1)} m/s against the overhead's ${over.tip.toFixed(1)} — `
      + 'the light attack is now faster than the charged heavy and the heavy is decoration');

    return `cut ${cut.tip.toFixed(1)} m/s over ${cut.across.toFixed(2)} units, ${cut.front}/9 in front, `
      + `spine ${cut.spine.toFixed(0)}°; spin ${spin.yaw.toFixed(2)} rad, ${spin.ring}/18 of the ring, `
      + `spine ${spin.spine.toFixed(0)}° girdle ${spin.clav.toFixed(0)}°, `
      + `body ${spin.body.toFixed(1)} rad / view ${spin.yaw.toFixed(1)}; `
      + `overhead reference ${over.tip.toFixed(1)} m/s, ${over.front}/9`;
  });

  check('attack: the overhead and the stab move the whole body, not just the arm', async () => {
    /**
     * "I want the arm movement for the overhead attack to be more pronounced,
     * right now it feels kind of weak like it's only a small movement that
     * happens at the elbows rather than a whole body overhead down attack. Same
     * for the stab — it's like a small wrist movement and the blade only goes a
     * little further out. Imagine how graceful and cool a fencing stab looks."
     *
     * WHAT WAS THERE, measured on the real Player with the real controller,
     * third person, over the whole attack — spine and shoulder are the total
     * range the joint turns through, `joint` is how far the shoulder itself
     * travelled:
     *
     *                  hand      tip     spine   shoulder   joint
     *      overhead    22 cm    113 cm    1.0°     0.0°      9 mm
     *      stab        32 cm     57 cm    1.6°     0.0°     22 mm
     *
     * Nine millimetres is what an IDLE body breathes, and zero degrees of
     * clavicle is exactly zero: nothing in the game wrote one. The 113 cm of tip
     * on the overhead is the blade's own length acting as a lever on a wrist,
     * which is precisely what "only a small movement at the elbows" means and
     * why the tip number looked respectable while the attack did not.
     *
     * The bounds below are the floor of what reads as a body doing it: fifteen
     * degrees of trunk, ten of shoulder girdle, eight centimetres of shoulder
     * travel, and a hand that goes half again as far as it used to. They are
     * not the shipped numbers — those are roughly double each — so this is a
     * property, not a snapshot, and re-tuning the drive does not break it while
     * deleting it does.
     *
     * FIRST PERSON IS DELIBERATELY EXCLUDED from the shoulder half. There the
     * clavicles are the viewmodel's weld to the camera (Player._anchorViewArms)
     * and moving them would put the swim back; first person gets the body
     * through the anchor instead, and `tools/checks/viewmodel.mjs` owns that.
     */

    // The reference arm: the same seventy frames with nothing pressed, so
    // "moving" is measured against a body that is merely standing there rather
    // than against zero.
    const idle = await driveAttack(null);
    assert(idle.hand < 0.03 && idle.spine < 1 && idle.joint < 0.03,
      `a standing player is already moving ${(idle.hand * 100).toFixed(0)} cm of hand and ${idle.spine.toFixed(1)}° `
      + 'of spine — this bench cannot tell an attack from an idle');

    /**
     * …AND A STAB IS JUDGED ON WHERE THE HAND GETS TO, NOT ON HOW FAR IT WENT.
     *
     * Travel was the right proxy while the guard sat 20 cm below the sternum:
     * the hand started near the body, so a long lunge and a long reach were
     * the same number. Unifying the first- and third-person hilt anchor moved
     * the resting guard forward, and the two came apart — measured across that
     * change, the stab's hand ENDS 74.1 cm from the chest before and 74.8 cm
     * after, which is the same lunge arriving in the same place, while its
     * START moved 34.9 → 55.4 cm. A fencer already in a forward guard has a
     * shorter lunge to make, and holding them to the travel of a fencer who
     * was not would be asking for a worse guard.
     *
     * So the stab asserts REACH and the overhead still asserts travel, because
     * an overhead is an arc and the distance the hand covers through it IS the
     * thing. The reference figures are the same measurement taken on the tree
     * that raised the complaint.
     */
    const rows = [];
    for (const [name, action, wasHand, wasSpine, reach] of [
      ['overhead', 'attackOver', 0.22, 1.0, null],
      ['stab', 'attackStab', 0.32, 1.6, 0.70],
    ]) {
      const r = await driveAttack(action);
      assert(r.spine > 15,
        `${name}: the spine turns ${r.spine.toFixed(1)}° through the attack, against the ${wasSpine}° it had `
        + 'when the complaint was made — this is still an elbow');
      assert(r.clav > 10,
        `${name}: the shoulder girdle turns ${r.clav.toFixed(1)}° — it used to be 0.0°, and a shoulder is most `
        + 'of what reads as commitment');
      assert(r.joint > 0.08,
        `${name}: the shoulder JOINT travels ${(r.joint * 1000).toFixed(0)} mm, against the 9 mm an idle body `
        + 'breathes — the girdle is turning in place');
      if (reach === null) {
        assert(r.hand > wasHand * 1.4,
          `${name}: the hand travels ${(r.hand * 100).toFixed(0)} cm against the `
          + `${(wasHand * 100).toFixed(0)} cm it travelled before the body was put behind it`);
      } else {
        assert(r.far > reach,
          `${name}: the hand reaches ${(r.far * 100).toFixed(0)} cm from the chest against the `
          + `${(reach * 100).toFixed(0)} cm it reached before — the lunge arrives short`);
        assert(r.hand > 0.12,
          `${name}: the hand travels only ${(r.hand * 100).toFixed(0)} cm — a stab that arrives `
          + 'without moving is a pose, however far forward the guard already was');
      }
      rows.push(`${name} hand ${(wasHand * 100).toFixed(0)}→${(r.hand * 100).toFixed(0)} cm`
        + `${reach === null ? '' : ` (reach ${(r.far * 100).toFixed(0)} cm)`}, `
        + `spine ${wasSpine}→${r.spine.toFixed(0)}°, shoulder 0→${r.clav.toFixed(0)}° / ${(r.joint * 1000).toFixed(0)} mm`);
    }
    return rows.join('; ');
  });
}
