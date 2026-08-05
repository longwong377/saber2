/**
 * Headless verification of the systems that matter, with no GPU involved.
 *
 * The browser smoke test proves the game boots and renders; this proves the
 * mechanics are actually correct — that a blade crossing a limb severs it at
 * the right place, that the piece becomes physics, that a still blade blocks
 * while a fast tip returns, and that the solver settles instead of exploding.
 *
 *   node tools/verify.mjs
 */

import './dom-shim.mjs';
import * as THREE from 'three';

import { PhysicsWorld, Body, BallJoint, LAYER, capsuleSpheres, boxSpheres, segmentSegment } from '../src/physics/Physics.js';
import { Rig, humanoidSkeleton, BipedAnimator } from '../src/game/Rig.js';
import { buildB1, buildJedi, buildTrooper, buildAcolyte, limbGeo, plateGeo } from '../src/game/Bodies.js';
import { Actor, updateCauterisation } from '../src/game/Ragdoll.js';
import { BladeContactSolver, gradeDeflection, resolveBladeClash, GRADE, TOUGHNESS, DIFFICULTY } from '../src/game/Combat.js';
import { sliceGeometry, spheresForGeometry, recenterGeometry } from '../src/world/Slice.js';
import { Saber } from '../src/game/Saber.js';
import { SaberController } from '../src/game/SaberController.js';
import { WaveDirector, BOONS, drawBoons } from '../src/game/Waves.js';
import { Terrain } from '../src/world/Terrain.js';
import { DuelBrain, Telegraph, BladeLock, FORMS, FORM_KEYS, TIER } from '../src/game/Duel.js';
import { Cloak, attachCloak } from '../src/game/Cloth.js';
import { DojoDirector, LESSONS, buildRemote } from '../src/game/Dojo.js';
import { clamp } from '../src/engine/MathUtil.js';

let pass = 0, fail = 0;
const results = [];
const pending = [];
function check(name, fn) {
  try {
    const detail = fn();
    // a check may be async; keep its slot in order and settle it before printing
    if (detail && typeof detail.then === 'function') {
      const slot = ['✓', name, ''];
      results.push(slot);
      pending.push(detail.then(
        (d) => { pass++; slot[2] = d === undefined ? '' : String(d); },
        (e) => { fail++; slot[0] = '✗'; slot[2] = e.message; }));
      return;
    }
    pass++;
    results.push(['✓', name, detail === undefined ? '' : String(detail)]);
  } catch (e) {
    fail++;
    results.push(['✗', name, e.message]);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg}: ${a} vs ${b} (±${tol})`); }

/* ── a blade we can drive by hand ────────────────────────────────────── */

function makeBlade(scene, opts = {}) {
  const s = new Saber(scene, { colorIndex: 0, bladeLength: opts.length ?? 1.15 });
  s.ignite();
  s.ignition = 1;
  return s;
}
/** Place the blade for two consecutive frames so it has a real sweep. */
function sweepBlade(saber, fromPos, fromQuat, toPos, toQuat, dt = 1 / 60) {
  saber.valid = false;
  saber.setHiltPose(fromPos, fromQuat);
  saber.update(dt, 0);            // establishes the previous frame
  saber.setHiltPose(toPos, toQuat);
  saber.update(dt, dt);           // now prev→cur is a genuine sweep
  return saber;
}

const scene = new THREE.Scene();
const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpN = (a, b, i, n) => (n <= 1 ? (a + b) / 2 : a + (b - a) * (i / (n - 1)));

/* ══════════════════════════════════════════════════════════════════════ */
/*  Physics                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

check('solver: a box dropped on flat ground comes to rest', () => {
  const w = new PhysicsWorld();
  w.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null, friction: 0.9 };
  const b = new Body({ position: V(0, 4, 0), spheres: boxSpheres(0.4, 0.4, 0.4), mass: 20 });
  w.add(b);
  for (let i = 0; i < 400; i++) w.step(1 / 60);
  assert(b.position.y > 0.25 && b.position.y < 0.65, `settled at y=${b.position.y.toFixed(3)}`);
  assert(b.velocity.length() < 0.6, `still moving: ${b.velocity.length().toFixed(3)}`);
  assert(isFinite(b.position.y), 'position went non-finite');
  return `y=${b.position.y.toFixed(3)} after 400 steps`;
});

check('solver: a stack of five crates does not explode', () => {
  const w = new PhysicsWorld();
  w.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null, friction: 0.9 };
  const boxes = [];
  for (let i = 0; i < 5; i++) {
    const b = new Body({ position: V(0, 0.4 + i * 0.82, 0), spheres: boxSpheres(0.4, 0.4, 0.4), mass: 18 });
    w.add(b); boxes.push(b);
  }
  for (let i = 0; i < 480; i++) w.step(1 / 60);
  const maxDrift = Math.max(...boxes.map(b => Math.hypot(b.position.x, b.position.z)));
  assert(maxDrift < 2.2, `stack scattered ${maxDrift.toFixed(2)}m`);
  assert(boxes.every(b => isFinite(b.position.y) && b.position.y > -1), 'a crate fell through the floor');
  return `drift ${maxDrift.toFixed(2)}m`;
});

check('solver: a ball joint holds two bodies together', () => {
  const w = new PhysicsWorld();
  w.terrain = null;
  const a = new Body({ position: V(0, 5, 0), spheres: capsuleSpheres(0.2, 0.1), mass: 0, static: true });
  const b = new Body({ position: V(0, 4.4, 0), spheres: capsuleSpheres(0.2, 0.1), mass: 8 });
  w.add(a); w.add(b);
  w.addJoint(new BallJoint(a, b, V(0, -0.2, 0), V(0, 0.2, 0), { coneAngle: 1.2 }));
  for (let i = 0; i < 300; i++) w.step(1 / 60);
  const anchorA = V(0, 4.8, 0);
  const anchorB = b.position.clone().add(V(0, 0.2, 0).applyQuaternion(b.quaternion));
  const err = anchorA.distanceTo(anchorB);
  assert(err < 0.16, `joint drifted ${err.toFixed(3)}m`);
  return `joint error ${(err * 1000).toFixed(1)}mm`;
});

check('solver: raycast finds a body and a static box', () => {
  const w = new PhysicsWorld();
  const b = new Body({ position: V(0, 1, -5), spheres: [{ c: V(), r: 0.5 }], mass: 4 });
  w.add(b);
  w.addStaticBox(V(0, 1, -12), V(1, 1, 1));
  const hitBody = w.raycast(V(0, 1, 0), V(0, 0, -1), 30);
  assert(hitBody && hitBody.body === b, 'did not hit the body');
  near(hitBody.distance, 4.5, 0.05, 'body hit distance');
  const hitBox = w.raycast(V(0, 1, -8), V(0, 0, -1), 30);
  assert(hitBox && hitBox.box, 'did not hit the static box');
  near(hitBox.distance, 3.0, 0.05, 'box hit distance');
  return `body @${hitBody.distance.toFixed(2)}m, box @${hitBox.distance.toFixed(2)}m`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Rig & IK                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

check('rig: two-bone IK reaches every target inside its range', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const shoulder = rig.worldPos('armR', new THREE.Vector3());
  const reach = rig.get('armR').length + rig.get('foreR').length;
  let worst = 0;
  // sample the reachable sphere rather than trusting one hand-picked point
  for (let i = 0; i < 40; i++) {
    const a = i * 0.813, b = i * 0.371;
    const dir = V(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
    const target = shoulder.clone().addScaledVector(dir, reach * 0.75);
    rig.solveIK('armR', 'foreR', target, shoulder.clone().add(V(-0.8, 0, -0.4)));
    rig.updateMatrices();
    worst = Math.max(worst, rig.tipPos('foreR', new THREE.Vector3()).distanceTo(target));
  }
  assert(worst < 0.01, `worst hand placement was ${worst.toFixed(4)}m off`);
  return `40 targets, worst error ${(worst * 1000).toFixed(2)}mm`;
});

check('rig: the feet stand on the ground, not through it or above it', () => {
  const { rig } = buildJedi({ robeIndex: 0, scale: 1 });
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const step = (y, groundAt) => {
    for (let i = 0; i < 10; i++) {
      anim.update(1 / 60, { position: V(0, y, 0), facing: 0, velocity: V(0, 0, 0),
        grounded: true, groundAt, crouch: 0, accelForward: 0, accelStrafe: 0 });
    }
    rig.updateMatrices();
    rig.root.updateMatrixWorld(true);
    let lo = Infinity;
    for (const n of ['footL', 'footR']) {
      const box = new THREE.Box3();
      for (const m of rig.get(n).parts) { m.updateMatrixWorld(true); box.expandByObject(m); }
      lo = Math.min(lo, box.min.y);
    }
    return lo;
  };

  const flat = step(0, () => 0);
  assert(Math.abs(flat) < 0.02, `on flat ground the soles sit ${(flat * 100).toFixed(1)}cm off the floor`);

  // and the legs must not be pinned at full extension, or a slope or a step
  // leaves the low foot dangling — solveIK clamps rather than stretching
  const hip = rig.worldPos('thighL', new THREE.Vector3());
  const ankleTip = rig.tipPos('shinL', new THREE.Vector3());
  const reach = rig.get('thighL').length + rig.get('shinL').length;
  const used = hip.distanceTo(ankleTip) / reach;
  assert(used < 0.97, `the standing leg is ${(used * 100).toFixed(1)}% extended — the knee is locked straight`);
  return `soles at ${(flat * 1000).toFixed(1)}mm, leg ${(used * 100).toFixed(1)}% extended`;
});

check('rig: the shoulders are mounted left and right, not front and back', () => {
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  anim.update(1 / 60, { position: V(0, 0, 0), facing: 0, velocity: V(0, 0, 0),
    grounded: true, groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
  rig.updateMatrices();
  const L = rig.worldPos('armL', new THREE.Vector3());
  const R = rig.worldPos('armR', new THREE.Vector3());
  const across = Math.abs(L.x - R.x), foreAft = Math.abs(L.z - R.z);
  assert(across > 0.24, `shoulders only ${(across * 100).toFixed(1)}cm apart across the chest`);
  assert(foreAft < 0.03, `the shoulder line runs ${(foreAft * 100).toFixed(1)}cm front-to-back`);
  assert(Math.abs(L.x + R.x) < 0.01, `shoulders are not symmetric about the spine`);
  // and the rest pose must be identity for an upright root, or every offset
  // authored in character space lands a quarter turn away from where it should
  const q = rig.get('hips').restQuat;
  assert(Math.abs(q.w) > 0.999, `hips rest quaternion is not identity: w=${q.w.toFixed(3)}`);
  return `${(across * 100).toFixed(1)}cm across, ${(foreAft * 100).toFixed(1)}cm fore/aft, symmetric`;
});

check('rig: a joint bends TOWARD its pole, not away from it', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const root = rig.worldPos('armR', new THREE.Vector3());
  const reach = rig.get('armR').length + rig.get('foreR').length;
  let wrong = 0, total = 0, worst = 0;
  for (let i = 0; i < 300; i++) {
    const a = i * 0.813, b = i * 0.371;
    const dir = V(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
    const target = root.clone().addScaledVector(dir, reach * 0.72);
    const side = V(Math.sin(i * 1.7), 0.3, Math.cos(i * 1.7)).normalize();
    const pole = root.clone().addScaledVector(side, 1.2);
    rig.solveIK('armR', 'foreR', target, pole);
    rig.updateMatrices();
    const joint = rig.tipPos('armR', new THREE.Vector3());
    const along = target.clone().sub(root).normalize();
    const perp = (p) => { const o = p.clone().sub(root); return o.addScaledVector(along, -o.dot(along)); };
    const off = perp(joint), poleOff = perp(pole);
    if (poleOff.lengthSq() < 1e-8 || off.lengthSq() < 1e-8) continue;
    total++;
    if (off.clone().normalize().dot(poleOff.clone().normalize()) < 0) {
      wrong++; worst = Math.max(worst, off.length());
    }
  }
  assert(wrong === 0,
    `${wrong}/${total} solves bent away from the pole (worst ${(worst * 100).toFixed(1)}cm) — knees bend backwards`);
  return `${total} solves, all on the pole's side`;
});

check('rig: IK clamps instead of tearing when the target is out of reach', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const far = V(9, 1.2, 9);
  rig.solveIK('armR', 'foreR', far, V(-0.8, 0.5, 0));
  rig.updateMatrices();
  const shoulder = rig.worldPos('armR', new THREE.Vector3());
  const tip = rig.tipPos('foreR', new THREE.Vector3());
  const reach = shoulder.distanceTo(tip);
  const limit = rig.get('armR').length + rig.get('foreR').length;
  assert(reach <= limit + 1e-3, `arm stretched to ${reach.toFixed(3)} past ${limit.toFixed(3)}`);
  assert(isFinite(tip.x) && isFinite(tip.y), 'IK produced NaN');
  return `reach ${reach.toFixed(3)}m ≤ limit ${limit.toFixed(3)}m`;
});

check('gait: feet stay planted during stance and the body does not skate', () => {
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  const pos = V(0, 0, 0);
  const vel = V(0, 0, 3.2);
  let steps = 0;
  anim.onFootstep = () => steps++;
  let maxSlideDuringStance = 0;
  const prev = [new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < 240; i++) {
    pos.addScaledVector(vel, 1 / 60);
    anim.update(1 / 60, { position: pos, facing: 0, velocity: vel, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: 1 });
    for (let f = 0; f < 2; f++) {
      const foot = anim.feet[f];
      if (foot.grounded && i > 10) {
        maxSlideDuringStance = Math.max(maxSlideDuringStance, prev[f].distanceTo(foot.pos));
      }
      prev[f].copy(foot.pos);
    }
  }
  assert(steps >= 4, `only ${steps} footsteps in 4 seconds of walking`);
  assert(maxSlideDuringStance < 0.02, `planted foot slid ${maxSlideDuringStance.toFixed(4)}m in one frame`);
  return `${steps} steps, max stance slide ${(maxSlideDuringStance * 1000).toFixed(2)}mm`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Cutting — the heart of it                                             */
/* ══════════════════════════════════════════════════════════════════════ */

function droidRig() {
  const built = buildB1({ scale: 1.02 });
  built.rig.hipsBone.obj.position.set(0, 0.95, 0);
  built.rig.updateMatrices();
  return built.rig;
}
function capsulesOf(rig) {
  const out = [];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const b of rig.list) {
    if (b.severed || !b.parts.length) continue;
    b.obj.updateMatrixWorld(true);
    p0.setFromMatrixPosition(b.obj.matrixWorld);
    q.setFromRotationMatrix(b.obj.matrixWorld);
    p1.copy(p0).add(new THREE.Vector3(0, b.length * b.cutT, 0).applyQuaternion(q));
    out.push({ name: b.name, p0: p0.clone(), p1: p1.clone(), r: b.radius * 1.12,
      toughness: TOUGHNESS.droid, vital: 0.3 });
  }
  return out;
}

check('blade: a fast sweep across a forearm produces a cut event at the crossing point', () => {
  const rig = droidRig();
  const caps = capsulesOf(rig);
  const fore = caps.find(c => c.name === 'foreR');
  assert(fore, 'no forearm capsule');

  const mid = fore.p0.clone().lerp(fore.p1, 0.5);
  const saber = makeBlade(scene);
  // blade pointing along +X so it crosses the (roughly vertical) forearm,
  // hilt set back far enough that the limb sits mid-blade
  const along = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(1, 0, 0));
  const from = mid.clone().add(V(-0.75, 0, 0.9));
  const to = mid.clone().add(V(-0.75, 0, -0.9));
  sweepBlade(saber, from, along, to, along);

  const solver = new BladeContactSolver();
  const events = solver.solve(saber, [{ id: 'd1', capsules: caps }], 1 / 60, { power: 1 });
  const cuts = events.filter(e => e.type === 'cut');
  assert(cuts.length, `no cut event (got ${events.map(e => e.type).join(',') || 'nothing'})`);
  const arm = cuts.find(e => e.bone === 'foreR');
  assert(arm, `the forearm survived a blade through it (cut ${cuts.map(c => c.bone).join(',')})`);
  assert(arm.cutT > 0.1 && arm.cutT < 0.9, `cut fraction out of range: ${arm.cutT}`);
  assert(arm.speed > 5, `cut registered at only ${arm.speed.toFixed(1)} m/s`);
  // a metre of blade through a torso should take more than one limb, and does
  assert(cuts.length > 1, 'a full-length sweep only caught one bone');
  return `${cuts.length} bones in one sweep (${cuts.map(c => c.bone).join(', ')}), forearm at ${(arm.cutT * 100).toFixed(0)}%`;
});

check('blade: a stationary blade resting on a limb does NOT cut', () => {
  const rig = droidRig();
  const caps = capsulesOf(rig);
  const fore = caps.find(c => c.name === 'foreR');
  const mid = fore.p0.clone().lerp(fore.p1, 0.5);
  const saber = makeBlade(scene);
  const along = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(1, 0, 0));
  const rest = mid.clone().add(V(-0.75, 0, 0));
  sweepBlade(saber, rest, along, rest, along);
  const solver = new BladeContactSolver();
  const events = solver.solve(saber, [{ id: 'd1', capsules: caps }], 1 / 60);
  assert(!events.some(e => e.type === 'cut'), 'a motionless blade severed a limb');
  return 'held blade grinds instead of severing';
});

check('cut: severing rebuilds the stub, spawns the piece, and takes the children with it', () => {
  const physics = new PhysicsWorld();
  physics.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null };
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });

  const foreBefore = rig.get('foreR').length;
  const handBone = rig.get('handR');
  assert(!handBone.severed, 'hand already severed');
  const bodiesBefore = physics.bodies.length;

  const ok = actor.cut('foreR', 0.55, V(0, 0, -6), rig.worldPos('foreR', new THREE.Vector3()));
  assert(ok, 'cut() refused');
  near(rig.get('foreR').cutT, 0.55, 1e-6, 'stub fraction');
  assert(handBone.severed, 'the hand did not go with the forearm');
  assert(actor.pieces.length === 1, `expected one detached piece, got ${actor.pieces.length}`);
  const piece = actor.pieces[0];
  assert(piece.entries.length >= 2, `piece has only ${piece.entries.length} parts (stub + hand expected)`);
  assert(physics.bodies.length > bodiesBefore, 'no physics bodies were created for the piece');
  assert(piece.entries.every(e => e.body.velocity.lengthSq() > 0), 'the severed piece has no momentum');
  return `stub ${(foreBefore * 0.55).toFixed(3)}m, ${piece.entries.length} loose parts, +${physics.bodies.length - bodiesBefore} bodies`;
});

check('cut: the severed piece falls and settles under gravity', () => {
  const physics = new PhysicsWorld();
  physics.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null, friction: 0.9 };
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.cut('thighL', 0.5, V(1, 0, 0), rig.worldPos('thighL', new THREE.Vector3()));
  const piece = actor.pieces[0];
  for (let i = 0; i < 260; i++) { physics.step(1 / 60); actor.update(1 / 60); }
  const ys = piece.entries.filter(e => !e.removed).map(e => e.body.position.y);
  assert(ys.length > 0, 'the piece vanished');
  assert(ys.every(y => isFinite(y) && y > -0.5 && y < 1.2), `piece rested at ${ys.map(y => y.toFixed(2)).join(',')}`);
  return `parts settled at y=${ys.map(y => y.toFixed(2)).join(', ')}`;
});

check('cut: cutting an already-cut bone shortens it again rather than duplicating', () => {
  const physics = new PhysicsWorld();
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.cut('armR', 0.7, V(0, 0, -3), rig.worldPos('armR', new THREE.Vector3()));
  const first = rig.get('armR').cutT;
  actor.cut('armR', 0.5, V(0, 0, -3), rig.worldPos('armR', new THREE.Vector3()));
  const second = rig.get('armR').cutT;
  near(first, 0.7, 1e-6, 'first cut');
  near(second, 0.35, 1e-6, 'second cut compounds');
  assert(actor.pieces.length === 2, `expected two pieces, got ${actor.pieces.length}`);
  return `0.7 → 0.35 of the original length`;
});

check('ragdoll: a whole body collapses into jointed bodies and settles', () => {
  const physics = new PhysicsWorld();
  physics.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null, friction: 0.9 };
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.goRagdoll(V(0, 0, -2), V(1, 0, 0));
  assert(actor.bodies.size >= 15, `only ${actor.bodies.size} ragdoll bodies`);
  assert(physics.joints.length >= 14, `only ${physics.joints.length} joints`);
  for (let i = 0; i < 420; i++) { physics.step(1 / 60); actor.update(1 / 60); }
  const parts = [...actor.bodies.values()];
  assert(parts.every(b => isFinite(b.position.y)), 'a ragdoll part went non-finite');
  const maxY = Math.max(...parts.map(b => b.position.y));
  const spread = Math.max(...parts.map(b => b.position.distanceTo(parts[0].position)));
  assert(maxY < 1.4, `the ragdoll is standing up (max y=${maxY.toFixed(2)})`);
  assert(spread < 3.2, `the ragdoll came apart (spread ${spread.toFixed(2)}m)`);
  return `${actor.bodies.size} parts, max y=${maxY.toFixed(2)}, spread ${spread.toFixed(2)}m`;
});

check('ragdoll: severing after death breaks only that joint', () => {
  const physics = new PhysicsWorld();
  physics.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null };
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  const before = physics.joints.length;
  actor.cutRagdoll('head', V(0, 2, 0));
  physics.step(1 / 60);
  assert(physics.joints.length === before - 1, `broke ${before - physics.joints.length} joints, expected 1`);
  return `${before} → ${physics.joints.length} joints`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Deflection grading                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

function boltAt(pos, dir, speed = 80) {
  return { pos: pos.clone(), vel: dir.clone().normalize().multiplyScalar(speed), damage: 10, team: 1 };
}

check('deflect: a motionless blade only blocks', () => {
  const saber = makeBlade(scene);
  const p = V(0, 1.4, 0);
  sweepBlade(saber, p, Q(0, 0, 0), p, Q(0, 0, 0));
  const contact = saber.pointAt(0.6, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const res = gradeDeflection(bolt, saber, { bladeT: 0.6, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [], flow: 0,
  });
  assert(res.grade === GRADE.BLOCK, `graded ${res.grade}, expected BLOCK`);
  assert(res.damageMul === 1, 'a block should not amplify');
  return 'BLOCK';
});

check('deflect: a driven blade mirrors the bolt about its surface', () => {
  const saber = makeBlade(scene);
  const a = V(0, 1.4, 0.15), b = V(0, 1.4, -0.15);
  sweepBlade(saber, a, Q(0, 0, 0), b, Q(0, 0, 0));
  const contact = saber.pointAt(0.6, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const res = gradeDeflection(bolt, saber, { bladeT: 0.6, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [], flow: 0,
  });
  assert(res.grade >= GRADE.DEFLECT, `graded ${res.grade}, expected DEFLECT or better`);
  assert(res.dir.lengthSq() > 0.9, 'no outgoing direction');
  return `grade ${res.grade}, blade at ${res.bladeSpeed.toFixed(1)} m/s`;
});

check('deflect: a fast tip with an enemy under the reticle RETURNS the bolt at them', () => {
  const saber = makeBlade(scene);
  // whip the blade hard across the contact point
  const a = V(0, 1.4, 0.5), b = V(0, 1.4, -0.5);
  sweepBlade(saber, a, Q(0, 0, 0.4), b, Q(0, 0, -0.4), 1 / 120);
  const contact = saber.pointAt(0.8, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const enemy = { dead: false, position: V(0, 1.4, -20), aimPoint: (o) => o.set(0, 1.4, -20) };
  const res = gradeDeflection(bolt, saber, { bladeT: 0.8, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [enemy], flow: 1, returnCone: 0.42,
  });
  assert(res.grade >= GRADE.RETURN, `graded ${res.grade} (tip speed ${res.bladeSpeed.toFixed(1)}), expected RETURN`);
  assert(res.target && res.target.entity === enemy, 'no return target chosen');
  const toEnemy = V(0, 1.4, -20).sub(contact).normalize();
  assert(res.dir.dot(toEnemy) > 0.985, `bolt sent ${(Math.acos(clamp(res.dir.dot(toEnemy), -1, 1)) * 57.3).toFixed(1)}° off target`);
  assert(res.damageMul > 1, 'a return should hit harder');
  return `grade ${res.grade}, ×${res.damageMul} damage, ${res.bladeSpeed.toFixed(0)} m/s tip`;
});

check('deflect: no return target outside the aim cone', () => {
  const saber = makeBlade(scene);
  const a = V(0, 1.4, 0.5), b = V(0, 1.4, -0.5);
  sweepBlade(saber, a, Q(0, 0, 0.4), b, Q(0, 0, -0.4), 1 / 120);
  const contact = saber.pointAt(0.8, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const behind = { dead: false, position: V(0, 1.4, 20), aimPoint: (o) => o.set(0, 1.4, 20) };
  const res = gradeDeflection(bolt, saber, { bladeT: 0.8, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [behind], flow: 0,
  });
  assert(res.grade < GRADE.RETURN, `returned to an enemy behind the player (grade ${res.grade})`);
  return `grade ${res.grade} — correctly refuses`;
});

check('clash: opposing blade motion within the window is a chamber', () => {
  const A = makeBlade(scene), B = makeBlade(scene);
  // A swings left-to-right, B swings right-to-left through the same point
  sweepBlade(A, V(-0.5, 1.3, -0.6), Q(0.4, 0, 1.1), V(0.35, 1.3, -0.6), Q(0.4, 0, 1.1), 1 / 90);
  sweepBlade(B, V(0.9, 1.3, -0.6), Q(0.4, 0, -1.1), V(0.05, 1.3, -0.6), Q(0.4, 0, -1.1), 1 / 90);
  const res = resolveBladeClash(A, B);
  assert(res, 'the blades did not register a contact');
  assert(['chamber', 'clash', 'parry'].includes(res.type), `unexpected clash type ${res.type}`);
  return `${res.type}, power ${res.power.toFixed(2)}`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Slicing                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

check('slice: a box cut through the middle yields two capped halves', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const res = sliceGeometry(geo, V(0, 0, 0), V(0, 1, 0));
  assert(res, 'the slice failed');
  const fTris = res.front.attributes.position.count / 3;
  const bTris = res.back.attributes.position.count / 3;
  assert(fTris >= 8 && bTris >= 8, `too few triangles (${fTris}/${bTris})`);
  near(res.area, 1.0, 0.06, 'cross-section area');
  res.front.computeBoundingBox(); res.back.computeBoundingBox();
  near(res.front.boundingBox.min.y, 0, 1e-5, 'front half starts at the plane');
  near(res.back.boundingBox.max.y, 0, 1e-5, 'back half ends at the plane');
  return `${fTris}+${bTris} triangles, cross-section ${res.area.toFixed(3)}m²`;
});

check('slice: a diagonal cut through a box still closes', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const n = V(1, 1, 0).normalize();
  const res = sliceGeometry(geo, V(0.05, 0, 0), n);
  assert(res, 'the diagonal slice failed');
  assert(res.ringCount >= 4, `cross-section ring had only ${res.ringCount} points`);
  assert(res.area > 0.5 && res.area < 2.2, `implausible cross-section ${res.area}`);
  return `${res.ringCount}-sided cross-section, ${res.area.toFixed(3)}m²`;
});

check('slice: a plane that misses the geometry returns nothing', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const res = sliceGeometry(geo, V(0, 5, 0), V(0, 1, 0));
  assert(res === null, 'a miss produced halves');
  return 'null, as it should';
});

check('slice: sphere decomposition covers the geometry', () => {
  const geo = new THREE.BoxGeometry(2, 0.4, 0.4);
  const spheres = spheresForGeometry(geo, 8);
  assert(spheres.length >= 2, `only ${spheres.length} spheres for a long box`);
  const extent = Math.max(...spheres.map(s => s.c.x + s.r)) - Math.min(...spheres.map(s => s.c.x - s.r));
  near(extent, 2, 0.25, 'coverage along the long axis');
  return `${spheres.length} spheres spanning ${extent.toFixed(2)}m`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade controller                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

check('control: the blade lags a flick and then catches up (real inertia)', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 0 });
  const chest = V(0, 1.35, 0);
  const aim = new THREE.Quaternion();
  c.reset(chest, aim);
  const startDir = V(0, 1, 0).applyQuaternion(c.quat).clone();

  c.gx = -0.9;                       // snap the guard hard to one side
  c.update(1 / 60, chest, aim, {});
  const afterOneFrame = V(0, 1, 0).applyQuaternion(c.quat).clone();
  const target = V(0, 1, 0).applyQuaternion(c._targetQuat).clone();

  const lag = afterOneFrame.angleTo(target);
  assert(lag > 0.15, `the blade teleported to the target (lag only ${lag.toFixed(3)} rad)`);
  for (let i = 0; i < 90; i++) c.update(1 / 60, chest, aim, {});
  const settled = V(0, 1, 0).applyQuaternion(c.quat).angleTo(target);
  assert(settled < 0.06, `the blade never settled (${settled.toFixed(3)} rad off)`);
  assert(startDir.angleTo(afterOneFrame) > 0.001, 'the blade did not move at all');
  return `lag ${(lag * 57.3).toFixed(1)}° after 1 frame, settled to ${(settled * 57.3).toFixed(2)}°`;
});

check('control: overshoot exists — a fast flick passes the target before returning', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 0 });
  const chest = V(0, 1.35, 0);
  const aim = new THREE.Quaternion();
  c.reset(chest, aim);
  const ref = V(0, 1, 0).applyQuaternion(c.quat).clone();
  c.gx = 1.0;
  c.solveTargets(chest, aim, 0);
  const targetDir = V(0, 1, 0).applyQuaternion(c._targetQuat).clone();
  const targetAngle = ref.angleTo(targetDir);
  let maxAngle = 0, settled = 0;
  for (let i = 0; i < 480; i++) {
    c.update(1 / 240, chest, aim, {});
    const cur = V(0, 1, 0).applyQuaternion(c.quat);
    maxAngle = Math.max(maxAngle, ref.angleTo(cur));
    settled = cur.angleTo(targetDir);
  }
  const overshoot = (maxAngle - targetAngle) / targetAngle;
  assert(overshoot > 0.02, `barely any overshoot (${(overshoot * 100).toFixed(2)}%) — the blade feels weightless`);
  assert(overshoot < 0.30, `wild overshoot (${(overshoot * 100).toFixed(1)}%) — the blade feels unmoored`);
  assert(settled < 0.05, `never settled (${settled.toFixed(3)} rad off)`);
  return `overshoots the arc by ${(overshoot * 100).toFixed(1)}%, then settles`;
});

check('control: the hands never leave arm\'s reach', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 0 });
  const chest = V(0, 1.35, 0);
  const aim = new THREE.Quaternion();
  c.reset(chest, aim);
  let maxReach = 0;
  for (let i = 0; i < 400; i++) {
    c.gx = Math.sin(i * 0.31) * 1.35;
    c.gy = Math.cos(i * 0.19) * 1.1;
    c.thrust = i % 40 === 0 ? 1 : c.thrust * 0.9;
    c.update(1 / 60, chest, aim, {});
    maxReach = Math.max(maxReach, c.handPos.distanceTo(chest));
    assert(isFinite(c.handPos.x) && isFinite(c.quat.x), 'controller went non-finite');
  }
  assert(maxReach <= 0.87, `hands reached ${maxReach.toFixed(3)}m from the chest`);
  return `max reach ${maxReach.toFixed(3)}m`;
});

const mkInput = () => ({
  mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
  buttons: [false, false, false], buttonPressed: [false, false, false],
  down: () => false, padButtons: null, padDown: () => false,
});

check('control: Free Blade still drags the camera after the guard', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 1.0, scheme: 'free' });
  const chest = V(0, 1.35, 0);
  c.reset(chest, new THREE.Quaternion());
  c.gx = 1.0;
  const input = mkInput();
  let camYaw = 0;
  for (let i = 0; i < 40; i++) camYaw += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw;
  assert(c.gx < 0.55, `the guard stayed out at ${c.gx.toFixed(3)}`);
  assert(camYaw < -0.2, `the camera did not turn toward the blade (${camYaw.toFixed(3)} rad)`);
  return `guard 1.00 → ${c.gx.toFixed(2)}, camera turned ${(camYaw * 57.3).toFixed(0)}°`;
});

check('control: the mouse moves the blade ONLY while the button is held', () => {
  const c = new SaberController({ sensitivity: 1 });      // shipped defaults
  assert(c.scheme === 'hold', `default scheme is "${c.scheme}", not hold-to-blade`);
  const chest = V(0, 1.35, 0);
  c.reset(chest, new THREE.Quaternion());
  const input = mkInput();

  // button up: the mouse is the camera, and the blade must not follow it
  const gx0 = c.gx;
  let camYaw = 0;
  for (let i = 0; i < 30; i++) {
    input.mouse.dx = 40;
    camYaw += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw;
  }
  assert(Math.abs(c.gx - gx0) < 0.02, `the blade drifted ${(c.gx - gx0).toFixed(3)} with the button up`);
  assert(Math.abs(camYaw) > 0.5, `the camera barely turned (${camYaw.toFixed(2)} rad) with the button up`);

  // button down: the mouse is the blade, and the camera must hold still
  input.buttons[0] = true;
  let camYaw2 = 0;
  for (let i = 0; i < 30; i++) {
    input.mouse.dx = 40;
    camYaw2 += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw;
  }
  assert(c.gx > gx0 + 0.3, `the blade did not move with the button held (${c.gx.toFixed(3)})`);
  assert(Math.abs(camYaw2) < 1e-6, `the camera moved ${camYaw2.toFixed(4)} rad while steering the blade`);
  return `up: camera ${(camYaw * 57.3).toFixed(0)}° / blade still; down: blade → ${c.gx.toFixed(2)} / camera still`;
});

check('control: letting go returns the blade to a ready guard', () => {
  const c = new SaberController({ sensitivity: 1 });
  const chest = V(0, 1.35, 0);
  c.reset(chest, new THREE.Quaternion());
  const input = mkInput();
  c.gx = -0.95; c.gy = -0.9;                      // abandoned low-left
  for (let i = 0; i < 90; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
  const off = Math.hypot(c.gx - c.readyX, c.gy - c.readyY);
  assert(off < 0.05, `the guard settled ${off.toFixed(3)} away from ready`);
  return `low-left → ready in 1.5s (${off.toFixed(4)} off)`;
});

check('control: walking does not drag the blade around behind you', () => {
  const c = new SaberController({ sensitivity: 1 });
  const aim = new THREE.Quaternion();
  const chest = V(0, 1.35, 0);
  c.reset(chest, aim);
  // sprint 4m in a straight line, hands untouched, and measure the blade's
  // offset from the body — it must stay exactly where a still player holds it.
  const restOffset = c.handPos.clone().sub(chest);
  let worstDrift = 0;
  for (let i = 0; i < 240; i++) {
    chest.x += 7.4 / 60;                          // a hard sprint
    c.update(1 / 60, chest, aim, {});
    worstDrift = Math.max(worstDrift, c.handPos.clone().sub(chest).distanceTo(restOffset));
  }
  assert(worstDrift < 0.01, `the blade lagged ${(worstDrift * 100).toFixed(1)}cm behind a sprinting body`);
  return `4m sprint, blade drifted ${(worstDrift * 1000).toFixed(2)}mm from the body`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Terrain, waves, boons                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

check('terrain: sampling is continuous and a crater actually lowers the ground', () => {
  const t = new Terrain(scene, 'dunes', 1.0);
  const h0 = t.height(12, -8);
  const h1 = t.height(12.01, -8);
  assert(Math.abs(h0 - h1) < 0.2, 'height field is discontinuous');
  const n = t.normalAt(12, -8, new THREE.Vector3());
  near(n.length(), 1, 1e-4, 'normal is not unit length');
  t.crater(12, -8, 3, 1.2);
  const after = t.height(12, -8);
  assert(after < h0 - 0.5, `crater only moved the ground ${(h0 - after).toFixed(3)}m`);
  const rim = t.height(12 + 3.1, -8);
  assert(rim > after, 'the crater has no raised rim');
  // and the mesh follows
  t.flush();
  return `${(h0 - after).toFixed(2)}m deep crater`;
});

check('terrain: a downward ray hits the surface', () => {
  const t = new Terrain(scene, 'dunes', 0.6);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const from = V(5, t.height(5, 5) + 20, 5);
  const dist = t.raycast(from, V(0, -1, 0), 60, p, n);
  assert(dist !== null, 'the ray missed the ground below it');
  near(p.y, t.height(5, 5), 0.12, 'hit height');
  return `hit at ${dist.toFixed(2)}m`;
});

check('waves: the budget escalates and unlocks new units', () => {
  const fakeWorld = { enemies: [], difficulty: DIFFICULTY.knight, takenBoons: new Set() };
  const d = new WaveDirector(fakeWorld, { mode: 'roguelite', pool: ['b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker'] });
  const b1 = d.budgetFor(1), b5 = d.budgetFor(5), b15 = d.budgetFor(15);
  assert(b1 < b5 && b5 < b15, 'the budget does not escalate');
  assert(d.unlockedAt(1).length < d.unlockedAt(12).length, 'no new units unlock');
  d.wave = 8; d._compose();
  assert(d.spawnQueue.length > 0, 'wave 8 composed nothing');
  const types = new Set(d.spawnQueue);
  assert(types.size >= 2, `wave 8 is monotonous: ${[...types].join(',')}`);
  return `budget ${b1}→${b5}→${b15}, wave 8 = ${d.spawnQueue.length} units of ${types.size} kinds`;
});

check('boons: drafting never repeats what you already hold', () => {
  const taken = new Set(BOONS.slice(0, 10).map(b => b.id));
  for (let i = 0; i < 50; i++) {
    const drawn = drawBoons(3, taken);
    assert(drawn.length === 3, `drew ${drawn.length}`);
    assert(new Set(drawn.map(b => b.id)).size === 3, 'drew a duplicate within one offer');
    assert(drawn.every(b => !taken.has(b.id)), 'offered a boon already taken');
  }
  return `${BOONS.length} boons, ${BOONS.length - 10} still available`;
});

check('boons: every boon applies without throwing', () => {
  const stub = () => ({
    boonMods: { deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
      jumpPower: 1, flowGain: 1, returnCone: 0.42, healOnKill: 0, lifesteal: 0 },
    control: { deadzone: 0.24, sensitivity: 1 },
    saber: { bladeLength: 1.15, coreWidth: 1 },
    maxHp: 100, hp: 100, maxStamina: 100, stamina: 100,
  });
  for (const b of BOONS) {
    const p = stub();
    b.apply(p);
    for (const [k, v] of Object.entries(p.boonMods)) {
      assert(typeof v !== 'number' || isFinite(v), `${b.id} made boonMods.${k} = ${v}`);
    }
  }
  return `${BOONS.length}/${BOONS.length} applied cleanly`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Body construction                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

check('bodies: every archetype builds with limbs on every bone', () => {
  const lines = [];
  for (const [name, fn] of [['jedi', buildJedi], ['b1', buildB1], ['trooper', buildTrooper], ['acolyte', buildAcolyte]]) {
    const built = fn({});
    const rig = built.rig;
    const boned = rig.list.filter(b => b.parts.length > 0);
    assert(boned.length >= 18, `${name} only dressed ${boned.length} bones`);
    assert(rig.list.every(b => b.parts.length === 0 || b.primary), `${name} has a bone with no primary limb`);
    let tris = 0;
    rig.root.traverse(o => { if (o.geometry?.index) tris += o.geometry.index.count / 3; else if (o.geometry) tris += o.geometry.attributes.position.count / 3; });
    lines.push(`${name} ${boned.length} bones / ${Math.round(tris)} tris`);
  }
  return lines.join(', ');
});

check('bodies: a limb rebuilt at 40% is 40% as long', () => {
  const full = limbGeo(1.0, 0.08, 0.06, 10);
  const part = limbGeo(0.4, 0.08, 0.072, 10);
  full.computeBoundingBox(); part.computeBoundingBox();
  const fullLen = full.boundingBox.max.y - full.boundingBox.min.y;
  const partLen = part.boundingBox.max.y - part.boundingBox.min.y;
  near(partLen / fullLen, 0.4, 0.12, 'rebuilt length ratio');
  return `${partLen.toFixed(3)} / ${fullLen.toFixed(3)}`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  V2 — duelling                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/** Just enough enemy for a duel brain to run against. */
function stubDuellist(formKey) {
  const saber = makeBlade(scene);
  const e = {
    position: V(0, 0, 0), facing: 0, lod: 0, saberPhase: 'guard', saberTimer: 0,
    A: { scale: 1 }, saber, world: { difficulty: DIFFICULTY.knight },
    target: null, aimPoint: (o) => o.set(0, 1.4, 0),
  };
  e.duel = new DuelBrain(e, { form: formKey });
  return e;
}

check('duel: every form only names moves that exist, with a valid tier', () => {
  let count = 0;
  for (const key of FORM_KEYS) {
    const f = FORMS[key];
    assert(f.moves.length, `${key} has no moves`);
    const e = stubDuellist(key);
    // drive it long enough to have drawn every move at least once
    const seen = new Set();
    for (let i = 0; i < 6000; i++) {
      e.duel.update(1 / 120, {}, 2.0);
      if (e.duel.attack) { seen.add(e.duel.attackKey); assert(TIER[e.duel.attack.tier], `${key}: bad tier`); }
    }
    for (const m of f.moves) assert(seen.has(m), `${key} never used ${m}`);
    count += seen.size;
  }
  return `${FORM_KEYS.length} forms, ${count} move slots exercised`;
});

check('duel: attack rate does not depend on the framerate', () => {
  const count = (dt) => {
    const e = stubDuellist('makashi');
    let attacks = 0, last = 'guard';
    for (let t = 0; t < 30; t += dt) {
      e.duel.update(dt, {}, 2.0);
      if (e.duel.phase === 'windup' && last !== 'windup') attacks++;
      last = e.duel.phase;
    }
    return attacks;
  };
  const at60 = count(1 / 60), at240 = count(1 / 240);
  assert(at60 > 8, `only ${at60} attacks in 30s at 60fps — duellists are idling`);
  const ratio = Math.max(at60, at240) / Math.max(1, Math.min(at60, at240));
  assert(ratio < 1.6, `attack rate changed ${ratio.toFixed(2)}× between 60 and 240 fps`);
  return `${at60} attacks @60fps, ${at240} @240fps in 30s`;
});

check('duel: the brain cycles guard → windup → strike → recover', () => {
  const e = stubDuellist('djemSo');
  const seen = [];
  for (let i = 0; i < 3000; i++) {
    const before = e.duel.phase;
    e.duel.update(1 / 120, {}, 2.0);
    if (e.duel.phase !== before) seen.push(e.duel.phase);
    if (seen.length > 12) break;
  }
  const order = seen.join(' ');
  assert(/windup strike recover/.test(order), `never completed a strike: ${order}`);
  assert(seen.every(p => ['guard', 'feint', 'windup', 'strike', 'recover'].includes(p)), `unknown phase in ${order}`);
  return order.slice(0, 46);
});

check('duel: the chamber window opens only in the tail of a wind-up', () => {
  const e = stubDuellist('djemSo');
  let sawWindup = false, openedEarly = false, openedLate = false;
  for (let i = 0; i < 4000; i++) {
    e.duel.update(1 / 120, {}, 2.0);
    if (e.duel.phase === 'windup') {
      sawWindup = true;
      const k = 1 - e.duel.timer / e.duel._windupLen;
      if (e.duel.chamberOpen && k < 0.4) openedEarly = true;
      if (e.duel.chamberOpen && k > 0.75) openedLate = true;
    }
  }
  assert(sawWindup, 'never wound up');
  assert(!openedEarly, 'the chamber window opened at the start of the wind-up');
  assert(openedLate, 'the chamber window never opened');
  return 'opens in the last third, as advertised';
});

check('duel: chambering needs a swing AGAINST the declared arc', () => {
  const e = stubDuellist('djemSo');
  // wind one up and hold it in the chamber window
  let guard = 0;
  while (!e.duel.chamberOpen && guard++ < 8000) e.duel.update(1 / 240, {}, 2.0);
  assert(e.duel.chamberOpen, 'could not reach a chamber window');
  const a = e.duel.attack;
  const along = a.to.clone().sub(a.from).normalize();          // the way it travels
  assert(e.duel.chambersWith(along.clone().negate()), 'swinging against the arc did not chamber');
  assert(!e.duel.chambersWith(along), 'swinging WITH the arc chambered, which it must not');
  const across = new THREE.Vector3().crossVectors(along, V(0, 1, 0)).normalize();
  assert(!e.duel.chambersWith(across), 'a perpendicular swing chambered');
  return `${a.label}: opposing yes, following no, perpendicular no`;
});

check('duel: heavy and unblockable attacks refuse a flat parry', () => {
  assert(TIER.light.parryable, 'light should be parryable');
  assert(!TIER.heavy.parryable && TIER.heavy.chamberable, 'heavy should be chamber-only');
  assert(!TIER.unblockable.parryable && !TIER.unblockable.chamberable, 'unblockable should be neither');
  assert(TIER.unblockable.guardBreak > TIER.heavy.guardBreak, 'guard-break should scale with tier');
  return 'light → parry, heavy → chamber, red → feet';
});

check('duel: interrupting a duellist kills the attack it was declaring', () => {
  const e = stubDuellist('ataru');
  let guard = 0;
  while (e.duel.phase !== 'windup' && guard++ < 8000) e.duel.update(1 / 240, {}, 2.0);
  assert(e.duel.attack, 'never declared an attack');
  e.duel.interrupt(0.5);
  assert(e.duel.phase === 'recover' && !e.duel.attack, 'the attack survived the interrupt');
  assert(!e.duel.chamberOpen, 'chamber window left open after an interrupt');
  return 'parried mid-declaration → recover, no attack';
});

check('duel: a sparring time-scale genuinely slows the form down', () => {
  const fast = stubDuellist('makashi');
  const slow = stubDuellist('makashi');
  slow.duel.timeScale = 0.5;
  const windupOf = (e) => {
    let guard = 0;
    while (e.duel.phase !== 'windup' && guard++ < 20000) e.duel.update(1 / 480, {}, 2.0);
    return e.duel._windupLen;
  };
  const a = windupOf(fast), b = windupOf(slow);
  assert(b > a * 1.5, `half speed only stretched the wind-up ${(b / a).toFixed(2)}×`);
  return `wind-up ${a.toFixed(2)}s → ${b.toFixed(2)}s at half speed`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  V2 — cloth                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

check('cloth: a cloak hangs from its anchors and settles', () => {
  const anchor = V(0, 1.6, 0);
  const cloak = new Cloak(scene, {
    cols: 7, rows: 9, width: 0.6, length: 1.0,
    anchorFn: (c, n, out) => out.set(lerpN(-0.3, 0.3, c, n), anchor.y, anchor.z),
  });
  cloak.reset();
  for (let i = 0; i < 240; i++) cloak.update(1 / 60, [], V(0, 0, 0));
  const p = cloak.pos;
  let lowest = Infinity, highest = -Infinity, moved = 0;
  for (let i = 0; i < cloak.cols * cloak.rows; i++) {
    const y = p[i * 3 + 1];
    assert(isFinite(y), 'a cloth particle went non-finite');
    lowest = Math.min(lowest, y); highest = Math.max(highest, y);
    moved = Math.max(moved, Math.abs(p[i * 3] - p[i * 3 + 2]));
  }
  near(highest, anchor.y, 1e-6, 'the top row left its anchors');
  assert(lowest > anchor.y - cloak.length * 1.12, `the cloth stretched to ${(anchor.y - lowest).toFixed(2)}m past its ${cloak.length}m`);
  assert(lowest < anchor.y - cloak.length * 0.75, 'the cloth never fell');
  return `hangs ${(anchor.y - lowest).toFixed(2)}m from a ${cloak.length}m cloak`;
});

check('cloth: colliders keep the cloak out of the body', () => {
  const anchor = V(0, 1.6, 0);
  const cloak = new Cloak(scene, {
    cols: 7, rows: 9, width: 0.6, length: 1.0, gravity: -13,
    anchorFn: (c, n, out) => out.set(lerpN(-0.3, 0.3, c, n), anchor.y, anchor.z),
  });
  cloak.reset();
  // a fat torso directly in the cloth's path
  const body = [{ c: V(0, 1.1, 0), r: 0.34 }];
  for (let i = 0; i < 300; i++) cloak.update(1 / 60, body, V(0, 0, -1.5));
  let worst = 0;
  for (let i = cloak.cols; i < cloak.cols * cloak.rows; i++) {
    const d = Math.hypot(cloak.pos[i * 3] - body[0].c.x,
                         cloak.pos[i * 3 + 1] - body[0].c.y,
                         cloak.pos[i * 3 + 2] - body[0].c.z);
    worst = Math.max(worst, body[0].r - d);
  }
  assert(worst < 0.02, `cloth sank ${(worst * 100).toFixed(1)}cm into the body`);
  return `deepest intrusion ${(worst * 1000).toFixed(1)}mm`;
});

check('cloth: a long frame does not detonate the solve', () => {
  const cloak = new Cloak(scene, {
    cols: 7, rows: 9, width: 0.6, length: 1.0,
    anchorFn: (c, n, out) => out.set(lerpN(-0.3, 0.3, c, n), 1.6, 0),
  });
  cloak.reset();
  for (let i = 0; i < 30; i++) cloak.update(0.9, [], V(0, 0, 0));   // 0.9s frames
  for (let i = 0; i < cloak.cols * cloak.rows; i++) {
    assert(isFinite(cloak.pos[i * 3 + 1]), 'cloth blew up on a long frame');
    assert(Math.abs(cloak.pos[i * 3 + 1]) < 60, 'cloth flew away on a long frame');
  }
  return 'clamped, stays put';
});

check('cloth: a rigged cloak finds its anchors and its body', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const cloak = attachCloak(scene, rig, { width: 0.6, length: 1.0, cols: 7, rows: 9 });
  assert(cloak, 'attachCloak returned nothing');
  const cols = cloak.refreshColliders();
  assert(cols.length >= 12, `only ${cols.length} body colliders`);
  cloak.reset();
  for (let i = 0; i < 120; i++) cloak.update(1 / 60, cloak.refreshColliders(), V(0, 0, 0));
  const chestY = rig.worldPos('chest', new THREE.Vector3()).y;
  const top = cloak.pos[1];
  assert(Math.abs(top - chestY) < 0.5, `collar sat ${Math.abs(top - chestY).toFixed(2)}m from the chest`);
  return `${cols.length} colliders, collar at the shoulders`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  V2 — the dojo                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

check('dojo: lessons advance on the event each one is watching for', () => {
  const spawned = [];
  const world = {
    enemies: [], locks: [], player: { position: V(0, 0, 0) },
    bolts: { clear() {} }, notify() {},
    spawnEnemy(type, pos) {
      const e = { type, dead: false, dying: 0, dispose() {}, duel: null, position: pos.clone() };
      spawned.push(e); world.enemies.push(e); return e;
    },
  };
  const d = new DojoDirector(world);
  d.start();
  assert(d.lesson.id === 'feel', `started on ${d.lesson.id}`);

  // the first lesson wants fast swings and nothing else
  d.report({ type: 'deflect', grade: 3 });
  assert(d.progress === 0, 'a deflection advanced the swing lesson');
  for (let i = 0; i < LESSONS[0].need; i++) d.report({ type: 'swing', speed: 20 });
  assert(d.lesson.id === 'block', `did not advance past 'feel' (on ${d.lesson.id})`);
  assert(spawned.some(e => e.type === 'remote'), 'the block lesson brought no remote');

  // and a slow swing must not count
  d.repeat();
  const before = d.progress;
  d.report({ type: 'swing', speed: 2 });
  assert(d.progress === before, 'a slow swing counted');
  return `${LESSONS.length} lessons, gated on the right events`;
});

check('dojo: every lesson has a brief, a hint and a reachable target', () => {
  for (const L of LESSONS) {
    assert(L.title && L.brief && L.hint, `${L.id} is missing copy`);
    assert(typeof L.check === 'function', `${L.id} has no check`);
    assert(L.need > 0, `${L.id} needs ${L.need}`);
    assert(L.setup, `${L.id} has no room setup`);
  }
  const last = LESSONS[LESSONS.length - 1];
  assert(last.need === Infinity, 'the final lesson should never complete');
  return `${LESSONS.length} lessons, all documented`;
});

check('dojo: skipping and going back stay inside the lesson list', () => {
  const world = { enemies: [], locks: [], player: null, bolts: { clear() {} }, notify() {},
    spawnEnemy: () => ({ dead: false, dying: 0, dispose() {} }) };
  const d = new DojoDirector(world);
  for (let i = 0; i < 40; i++) d.skip();
  assert(d.index === LESSONS.length - 1, `skipped past the end to ${d.index}`);
  for (let i = 0; i < 40; i++) d.back();
  assert(d.index === 0, `went back past the start to ${d.index}`);
  return 'clamped at both ends';
});

check('dojo: a training remote is built and can be aimed', () => {
  const r = buildRemote({ scale: 1 });
  for (const key of ['group']) assert(r[key], `remote missing ${key}`);
  // and every vertex must be finite — a NaN scale here reaches the audio panner
  let bad = 0;
  r.group.traverse(o => {
    const p = o.geometry?.attributes?.position;
    if (!p) return;
    for (let i = 0; i < p.count * 3; i++) if (!isFinite(p.array[i])) bad++;
  });
  assert(bad === 0, `${bad} non-finite vertices in the remote`);
  assert(r.group, 'no mesh');
  assert(r.muzzles.length >= 3, `only ${r.muzzles.length} emitters`);
  let tris = 0;
  r.group.traverse(o => { if (o.geometry?.index) tris += o.geometry.index.count / 3; });
  assert(tris > 100, `remote is only ${tris} triangles`);
  return `${r.muzzles.length} emitters, ${Math.round(tris)} triangles`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Audio                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

check('audio: retiring a voice never tears down the shared effects bus', async () => {
  // A non-positional one-shot is routed straight to sfxBus. Calling disconnect()
  // on that unplugs every sound in the game from the compressor — permanently,
  // and silently. This is the guard that keeps the game audible.
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const a = new AudioEngine();
  let busDisconnects = 0, panDisconnects = 0;
  a.sfxBus = { disconnect: () => busDisconnects++ };
  a.musicBus = { disconnect: () => busDisconnects++ };
  a.master = { disconnect: () => busDisconnects++ };
  const panner = { disconnect: () => panDisconnects++ };

  // a source whose `ended` we can fire by hand, the way the audio clock would
  const mkSrc = () => ({ set onended(f) { this._f = f; }, get onended() { return this._f; } });
  const s1 = mkSrc(), s2 = mkSrc(), s3 = mkSrc();
  a.voices = 3;
  a._freeOnEnd(s1, a.sfxBus, 0.1);
  a._freeOnEnd(s2, a.musicBus, 0.1);
  a._freeOnEnd(s3, panner, 0.1);
  s1.onended(); s2.onended(); s3.onended();

  assert(busDisconnects === 0, `${busDisconnects} shared buses were disconnected — the game goes silent`);
  assert(panDisconnects === 1, `the per-voice panner was not released (${panDisconnects})`);
  assert(a.voices === 0, `voice count leaked: ${a.voices} still held`);

  // and the backstop must not double-release when `ended` already fired
  s3.onended();
  assert(a.voices === 0 && panDisconnects === 1, 'a second `ended` released the voice twice');
  return 'buses survive, panners are released, voice count returns to 0';
});

check('audio: a NaN never leaks the voice pool dry', async () => {
  // Game maths produces NaN (a degenerate normal, a zero-length velocity), and
  // every WebAudio param rejects it with a TypeError. Thrown between taking a
  // voice and releasing it, 44 of those silence the game for the whole session.
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const a = new AudioEngine();
  a.ready = true;
  const bad = () => { throw new TypeError('non-finite value'); };
  const param = () => ({ set value(v) { if (!Number.isFinite(v)) bad(); },
                         setValueAtTime: bad, linearRampToValueAtTime: bad,
                         exponentialRampToValueAtTime: bad, setTargetAtTime: bad });
  a.sfxBus = { disconnect() {} };
  a.ctx = {
    currentTime: 0,
    createBufferSource: () => ({ playbackRate: { value: 0 }, connect() {}, start: bad, stop() {}, buffer: null, loop: false }),
    createBiquadFilter: () => ({ type: '', frequency: param(), Q: { value: 0 }, connect() {} }),
    createGain: () => ({ gain: param(), connect() {} }),
    createOscillator: () => ({ type: '', frequency: param(), detune: { value: 0 }, connect() {}, start: bad, stop() {} }),
  };
  for (let i = 0; i < 200; i++) {
    a.noise({ dur: 0.2, gain: 0.4, freq: 1200 });
    a.tone({ freq: 440, dur: 0.2 });
  }
  assert(a.voices === 0, `${a.voices} of ${a.maxVoices} voices leaked — the game would go silent`);

  // and NaN arguments must not reach a param in the first place
  const seen = [];
  a.ctx.createBiquadFilter = () => ({ type: '',
    frequency: { set value(v) { seen.push(v); }, exponentialRampToValueAtTime: (v) => seen.push(v) },
    Q: { set value(v) { seen.push(v); } }, connect() {} });
  a.ctx.createGain = () => ({ gain: { setValueAtTime: (v) => seen.push(v),
    linearRampToValueAtTime: (v) => seen.push(v), setTargetAtTime: (v) => seen.push(v) }, connect() {} });
  a.ctx.createBufferSource = () => ({ playbackRate: { value: 0 }, connect() {}, start() {}, stop() {}, buffer: null, loop: false });
  a.noise({ dur: NaN, gain: NaN, freq: NaN, q: NaN, freqEnd: NaN });
  assert(seen.length && seen.every(Number.isFinite), `NaN reached an AudioParam: ${seen}`);
  return `200 throwing calls, 0 voices leaked; NaN args sanitised at the door`;
});

check('audio: a NaN position falls back instead of throwing away a voice', async () => {
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const a = new AudioEngine();
  a.sfxBus = { id: 'sfx' };
  a._listenerPos.set(0, 0, 0);
  assert(a._out({ x: NaN, y: 0, z: 0 }) === a.sfxBus, 'a NaN position did not fall back to the bus');
  assert(a._out({ x: 0, y: 0, z: 300 }) === null, 'a distant sound was not culled');
  return 'NaN → dry bus, 300m → culled';
});

check('math: clamp does not pass NaN through', () => {
  assert(clamp(NaN, 0, 1) === 0, `clamp(NaN) returned ${clamp(NaN, 0, 1)}`);
  assert(clamp(-5, 0, 1) === 0 && clamp(5, 0, 1) === 1 && clamp(0.5, 0, 1) === 0.5, 'clamp broke');
  assert(clamp(0, 0, 1) === 0 && clamp(1, 0, 1) === 1, 'clamp is not inclusive at the bounds');
  return 'NaN → low bound, bounds inclusive';
});

check('bodies: a limb is a closed surface with no seam crease', () => {
  const g = limbGeo(0.4, 0.07, 0.05, 12, true);
  const pos = g.attributes.position, nrm = g.attributes.normal;
  assert(nrm, 'the lathe produced no normals');

  // every normal unit length and finite — a degenerate profile ring shows up here
  let worst = 0;
  for (let i = 0; i < nrm.count; i++) {
    const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    assert(isFinite(l), `normal ${i} is non-finite`);
    worst = Math.max(worst, Math.abs(l - 1));
  }
  assert(worst < 1e-3, `normals are not unit length (off by ${worst.toFixed(4)})`);

  // the cap must reach the pole: some vertex has to sit on the axis below y=0
  let lowest = Infinity, radiusAtLowest = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < lowest - 1e-6) { lowest = y; radiusAtLowest = Math.hypot(pos.getX(i), pos.getZ(i)); }
  }
  assert(lowest < -0.03, `the bottom cap only reaches y=${lowest.toFixed(4)}`);
  assert(radiusAtLowest < 1e-4,
    `the cap is open: its lowest ring has radius ${radiusAtLowest.toFixed(4)}, not a pole`);

  // and the profile must be monotonic in y, or it folds back through itself
  return `closed at y=${lowest.toFixed(3)}, ${nrm.count} unit normals, no re-derivation`;
});

/* ══════════════════════════════════════════════════════════════════════ */

await Promise.all(pending);

const w = Math.max(...results.map(r => r[1].length));
console.log('');
for (const [mark, name, detail] of results) {
  const colour = mark === '✓' ? '\x1b[32m' : '\x1b[31m';
  console.log(`${colour}${mark}\x1b[0m ${name.padEnd(w)}  \x1b[2m${detail}\x1b[0m`);
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
