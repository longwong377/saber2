/**
 * SABER — skeletal rig and procedural animation.
 *
 * There are no animation clips in this game. Every pose is solved: feet are
 * planted by a gait solver against the actual terrain, arms are IK'd to
 * wherever the blade currently is, and the spine counter-rotates against the
 * blade's momentum. That is why the character always looks connected to the
 * weapon — because it is, structurally, downstream of it.
 *
 * Bones are plain Object3Ds so that severing a limb is a matter of reparenting
 * a subtree, not rebuilding a skinned mesh.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, TAU } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
// solveIK's own state — kept apart from everything else for the same reason.
const _ikRoot = new THREE.Vector3(), _ikDir = new THREE.Vector3(), _ikPole = new THREE.Vector3();
const _ikAxis = new THREE.Vector3(), _ikUpper = new THREE.Vector3();
const _ikElbow = new THREE.Vector3(), _ikLower = new THREE.Vector3();
const YAXIS = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);

// Private scratch — deliberately NOT shared with solveIK, which calls aimY
// while still holding live vectors of its own.
const _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3();
const _a3 = new THREE.Vector3(), _a4 = new THREE.Vector3();
const _am = new THREE.Matrix4();
const BACK = new THREE.Vector3(0, 0, -1);

/** Quaternion that points local +Y along `dir`, with `ref` biasing the roll. */
export function aimY(dir, ref, out = new THREE.Quaternion()) {
  _a1.copy(dir).normalize();
  // The reference must be normalised BEFORE the degeneracy test. solveIK passes
  // a pole vector 0.7-1.6m long, so an un-normalised dot cleared 0.985 for
  // references only 40 degrees off — firing the fallback on a third of all
  // upper-arm solves and snapping the bone's roll by 90 degrees as it did.
  _a2.copy(ref || XAXIS).normalize();
  if (Math.abs(_a1.dot(_a2)) > 0.985) _a2.set(0, 0, 1);
  _a3.crossVectors(_a2, _a1);
  if (_a3.lengthSq() < 1e-10) { _a2.set(0, 0, 1); _a3.crossVectors(_a2, _a1); }
  _a3.normalize();                              // x
  // z = x × y. Taking y × x instead yields a left-handed basis, and
  // setFromRotationMatrix silently returns a mirrored rotation for one.
  _a4.crossVectors(_a3, _a1).normalize();       // z
  _am.makeBasis(_a3, _a1, _a4);
  return out.setFromRotationMatrix(_am);
}

/* ── skeleton templates ──────────────────────────────────────────────── */

/**
 * offset  — position relative to the parent bone's tip frame
 * length  — bone length along local +Y
 * rest    — direction the bone points in the rest pose (world-ish, character space)
 */
export function humanoidSkeleton(scale = 1, opts = {}) {
  const s = scale;
  const armLen = opts.armLen ?? 1;
  const legLen = opts.legLen ?? 1;
  return [
    { name: 'hips',      parent: null,      offset: [0, 0, 0],                 length: 0.14 * s, rest: [0, 1, 0] },
    { name: 'spine',     parent: 'hips',    offset: [0, 0.10 * s, 0],          length: 0.19 * s, rest: [0, 1, 0.06] },
    { name: 'chest',     parent: 'spine',   offset: [0, 0.19 * s, 0],          length: 0.21 * s, rest: [0, 1, -0.04] },
    { name: 'neck',      parent: 'chest',   offset: [0, 0.21 * s, 0.005 * s],  length: 0.075 * s, rest: [0, 1, 0.05] },
    { name: 'head',      parent: 'neck',    offset: [0, 0.075 * s, 0],         length: 0.23 * s, rest: [0, 1, 0] },

    { name: 'clavL',     parent: 'chest',   offset: [0.035 * s, 0.185 * s, 0], length: 0.13 * s, rest: [1, 0.18, 0] },
    { name: 'armL',      parent: 'clavL',   offset: [0, 0.13 * s, 0],          length: 0.285 * s * armLen, rest: [0.30, -0.95, -0.05] },
    { name: 'foreL',     parent: 'armL',    offset: [0, 0.285 * s * armLen, 0], length: 0.265 * s * armLen, rest: [0.10, -0.99, 0.05] },
    { name: 'handL',     parent: 'foreL',   offset: [0, 0.265 * s * armLen, 0], length: 0.10 * s, rest: [0, -1, 0] },

    { name: 'clavR',     parent: 'chest',   offset: [-0.035 * s, 0.185 * s, 0], length: 0.13 * s, rest: [-1, 0.18, 0] },
    { name: 'armR',      parent: 'clavR',   offset: [0, 0.13 * s, 0],           length: 0.285 * s * armLen, rest: [-0.30, -0.95, -0.05] },
    { name: 'foreR',     parent: 'armR',    offset: [0, 0.285 * s * armLen, 0], length: 0.265 * s * armLen, rest: [-0.10, -0.99, 0.05] },
    { name: 'handR',     parent: 'foreR',   offset: [0, 0.265 * s * armLen, 0], length: 0.10 * s, rest: [0, -1, 0] },

    { name: 'thighL',    parent: 'hips',    offset: [0.095 * s, -0.02 * s, 0], length: 0.44 * s * legLen, rest: [0.04, -1, 0] },
    { name: 'shinL',     parent: 'thighL',  offset: [0, 0.44 * s * legLen, 0], length: 0.42 * s * legLen, rest: [0, -1, 0.02] },
    { name: 'footL',     parent: 'shinL',   offset: [0, 0.42 * s * legLen, 0], length: 0.20 * s, rest: [0, -0.2, 1] },

    { name: 'thighR',    parent: 'hips',    offset: [-0.095 * s, -0.02 * s, 0], length: 0.44 * s * legLen, rest: [-0.04, -1, 0] },
    { name: 'shinR',     parent: 'thighR',  offset: [0, 0.44 * s * legLen, 0],  length: 0.42 * s * legLen, rest: [0, -1, 0.02] },
    { name: 'footR',     parent: 'shinR',   offset: [0, 0.42 * s * legLen, 0],  length: 0.20 * s, rest: [0, -0.2, 1] },
  ];
}

/** Four-legged / multi-legged frames for walkers and beasts. */
export function walkerSkeleton(scale = 1, legs = 4) {
  const s = scale;
  const out = [
    { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.5 * s, rest: [0, 1, 0] },
    { name: 'body', parent: 'hips', offset: [0, 0.25 * s, 0], length: 0.7 * s, rest: [0, 1, 0] },
    { name: 'head', parent: 'body', offset: [0, 0.1 * s, -0.6 * s], length: 0.4 * s, rest: [0, 1, 0] },
  ];
  for (let i = 0; i < legs; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const z = (row - (legs / 2 - 1) / 2) * 0.55 * s;
    out.push({ name: `hipL${i}`, parent: 'hips', offset: [0.34 * s * side, 0.1 * s, z], length: 0.16 * s, rest: [side, 0.2, 0] });
    out.push({ name: `femur${i}`, parent: `hipL${i}`, offset: [0, 0.16 * s, 0], length: 0.62 * s, rest: [side * 0.5, 0.72, 0] });
    out.push({ name: `tibia${i}`, parent: `femur${i}`, offset: [0, 0.62 * s, 0], length: 0.74 * s, rest: [side * 0.15, -1, 0] });
    out.push({ name: `tarsus${i}`, parent: `tibia${i}`, offset: [0, 0.74 * s, 0], length: 0.3 * s, rest: [0, -0.4, 0.6] });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */

export class Bone {
  constructor(def, scale = 1) {
    this.name = def.name;
    this.length = def.length;
    this.obj = new THREE.Object3D();
    this.obj.name = def.name;
    this.offset = new THREE.Vector3().fromArray(def.offset);
    this.restDir = new THREE.Vector3().fromArray(def.rest).normalize();
    this.restQuat = new THREE.Quaternion();
    this.children = [];
    this.parent = null;
    this.severed = false;
    this.parts = [];        // visual meshes attached to this bone
    this.radius = def.radius ?? 0.06;
    this.cutT = 1;          // fraction of the bone still attached (1 = intact)
    this.hp = def.hp ?? 1;
  }
}

export class Rig {
  constructor(defs, opts = {}) {
    this.root = new THREE.Group();
    this.bones = new Map();
    this.list = [];
    this.scale = opts.scale ?? 1;

    for (const def of defs) {
      const b = new Bone(def, this.scale);
      this.bones.set(def.name, b);
      this.list.push(b);
    }
    for (const def of defs) {
      const b = this.bones.get(def.name);
      // Marked so that dismemberment can tell "a child bone" apart from
      // "a piece of geometry hanging on this bone".
      b.obj.userData.boneChild = true;
      b.obj.userData.bone = b;
      if (def.parent) {
        const p = this.bones.get(def.parent);
        b.parent = p; p.children.push(b);
        p.obj.add(b.obj);
      } else {
        this.root.add(b.obj);
      }
      b.obj.position.copy(b.offset);
    }

    // rest pose: point each bone's +Y along its rest direction, expressed in
    // its parent's rest frame
    const worldRest = new Map();
    for (const def of defs) {
      const b = this.bones.get(def.name);
      // Reference is -Z (the character's back), NOT the default +X. aimY's
      // default gives an upright bone a basis of X->+Z, Z->-X — a -90 degree
      // yaw — so the whole skeleton was built a quarter turn off. The animator
      // overwrites hips with a pure yaw, which accidentally undid it for bones
      // pointing up, but the clavicles' rest direction is sideways, so they
      // kept the error: the shoulder line ran 25.6cm front-to-back and 7cm
      // across, and the left arm reached round the spine to a hilt held in
      // front. aimY((0,1,0), (0,0,-1)) is identity, which is what it should
      // always have been.
      const wq = aimY(b.restDir, BACK, new THREE.Quaternion());
      worldRest.set(b.name, wq);
      const pq = b.parent ? worldRest.get(b.parent.name) : new THREE.Quaternion();
      b.restQuat.copy(pq).invert().multiply(wq);
      b.obj.quaternion.copy(b.restQuat);
    }

    this.hipsBone = this.bones.get('hips');
    this.pose = {};
    for (const b of this.list) this.pose[b.name] = b.restQuat.clone();
  }

  get(name) { return this.bones.get(name); }
  obj(name) { const b = this.bones.get(name); return b ? b.obj : null; }

  worldPos(name, out = new THREE.Vector3()) {
    const b = this.bones.get(name);
    if (!b) return out.set(0, 0, 0);
    return out.setFromMatrixPosition(b.obj.matrixWorld);
  }

  /** World position of the far end of a bone. */
  tipPos(name, out = new THREE.Vector3()) {
    const b = this.bones.get(name);
    if (!b) return out.set(0, 0, 0);
    return out.set(0, b.length * b.cutT, 0).applyMatrix4(b.obj.matrixWorld);
  }

  worldQuat(name, out = new THREE.Quaternion()) {
    const b = this.bones.get(name);
    if (!b) return out.identity();
    b.obj.getWorldQuaternion(out);
    return out;
  }

  /** Set a bone's local rotation so its +Y points along a world direction. */
  aimBoneWorld(name, worldDir, ref) {
    const b = this.bones.get(name);
    if (!b || !b.obj.parent) return;
    aimY(worldDir, ref, _q1);
    b.obj.parent.getWorldQuaternion(_q2);
    b.obj.quaternion.copy(_q2.invert()).multiply(_q1);
  }

  updateMatrices() { this.root.updateMatrixWorld(true); }

  /* ── two-bone IK ───────────────────────────────────────────────────── */

  /**
   * Solve a two-bone chain so the tip of `lower` reaches `target`.
   * `pole` biases the direction the joint bends toward.
   */
  solveIK(upperName, lowerName, target, pole, softness = 0.985) {
    const upper = this.bones.get(upperName);
    const lower = this.bones.get(lowerName);
    if (!upper || !lower || !upper.obj.parent) return;

    upper.obj.parent.updateMatrixWorld(true);
    const rootPos = _ikRoot.setFromMatrixPosition(upper.obj.matrixWorld);
    const l1 = upper.length * upper.cutT;
    const l2 = lower.length * lower.cutT;

    const toTarget = _ikDir.subVectors(target, rootPos);
    let dist = toTarget.length();
    const maxD = (l1 + l2) * softness;
    const minD = Math.abs(l1 - l2) * 1.02 + 1e-4;
    dist = clamp(dist, minD, maxD);
    if (toTarget.lengthSq() < 1e-8) toTarget.set(0, -1, 0);
    toTarget.normalize();

    // law of cosines for the elbow/knee bend
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const a = Math.acos(cosA);

    // rotation axis from the pole vector — this is what decides which way the
    // joint bends, so it has to survive the aimY calls below
    const poleDir = _ikPole.subVectors(pole, rootPos);
    const axis = _ikAxis.crossVectors(toTarget, poleDir);
    if (axis.lengthSq() < 1e-7) { axis.crossVectors(toTarget, XAXIS); if (axis.lengthSq() < 1e-7) axis.crossVectors(toTarget, YAXIS); }
    axis.normalize();

    // +a, not -a. axis = toTarget x poleDir, so a POSITIVE rotation about it
    // swings the upper bone toward the pole. Negated, every joint in the game
    // bent away from its own pole hint: knees backwards, elbows folded across
    // the chest. Measured 300/300 solves on the wrong side before this.
    _q1.setFromAxisAngle(axis, a);
    const upperDir = _ikUpper.copy(toTarget).applyQuaternion(_q1);

    // place the upper bone
    upper.obj.parent.getWorldQuaternion(_q2);
    aimY(upperDir, poleDir, _q1);
    upper.obj.quaternion.copy(_q2.invert()).multiply(_q1);
    upper.obj.updateMatrixWorld(true);

    // the lower bone points from the elbow to the target
    const elbow = _ikElbow.copy(rootPos).addScaledVector(upperDir, l1);
    const lowerDir = _ikLower.subVectors(target, elbow);
    if (lowerDir.lengthSq() < 1e-8) lowerDir.set(0, -1, 0);
    lowerDir.normalize();
    upper.obj.getWorldQuaternion(_q2);
    aimY(lowerDir, poleDir, _q1);
    lower.obj.quaternion.copy(_q2.invert()).multiply(_q1);
    lower.obj.updateMatrixWorld(true);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose(); }
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Biped locomotion solver                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/*
 * Gait, weight and posture, solved rather than played back. Four rules, in the
 * order they matter — every one of them is a measurement that read wrong:
 *
 *  1. A PLANTED FOOT DOES NOT MOVE. Not a millimetre, not while the body spins
 *     on the spot, not while it settles out of a run. `f.planted` is a world
 *     point and stance copies it verbatim; there is no damping toward a moving
 *     neutral stance anywhere in here any more. Turning 120°/s used to drag
 *     both feet 1.79m across the ground in four seconds without taking a
 *     single step. Steps are triggered by error as well as by rhythm now, so
 *     the character steps round a turn instead of skating round it.
 *
 *  2. THE LEG HAS TO REACH THE FOOT THE GAIT ASKED FOR. The pelvis is clamped
 *     against the true 3D distance to each planted ankle, not against its
 *     height alone, and the cadence is raised until the ground a foot has to
 *     cover during stance fits inside that reach. Sprinting used to ask for a
 *     plant 22cm beyond the leg; solveIK clamps rather than stretching, so the
 *     drawn foot simply left the point the gait believed it was standing on.
 *
 *  3. A WALK AND A RUN ARE DIFFERENT GAITS, not one gait played faster. Duty
 *     factor runs from 0.63 (a quarter of the cycle in double support) down to
 *     0.30 (a third of it airborne); the pelvis rises over mid-stance at a
 *     walk and drops at a run; the ankle plantarflexes to lift the heel
 *     through toe-off, which is also what buys the reach in rule 2. It used to
 *     sit at exactly 0.50 at every speed: never two feet down, never none, a
 *     sprint structurally identical to a stroll.
 *
 *  4. EVERYTHING ABOVE THE PELVIS ANSWERS TO IT. The pelvis rotates toward the
 *     swing leg, lists toward the unsupported side and sways over the stance
 *     foot; the ribcage counter-rotates against all three and lags a turn; the
 *     neck takes most of that back out again so the head stays level and leads
 *     the body round the corner. All of it was previously exactly zero.
 *
 * The layering is deliberate. This owns hips, spine, chest, neck, legs and
 * feet. Player.js overwrites `spine` and `head` with blade-driven values and
 * Enemy.js overwrites `head`; both compose on top of what is written here
 * rather than fighting it, which is why the counter-rotation lives on `chest`
 * and the head stabilisation on `neck`.
 */

// Private scratch for the animator. It calls solveIK and aimBoneWorld, both of
// which hold live vectors of their own, so it may not borrow theirs.
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3();
const _b4 = new THREE.Vector3(), _b5 = new THREE.Vector3(), _b6 = new THREE.Vector3();
const _b7 = new THREE.Vector3();
const _bq = new THREE.Quaternion(), _bq2 = new THREE.Quaternion();
const _be = new THREE.Euler();

const wrapPi = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

/**
 * Swing ease: near-constant speed for most of the swing, then a cosine taper
 * to a dead stop at touchdown.
 *
 * A symmetric smoothstep is the obvious choice and it is the wrong one: it
 * front-loads the travel, putting the foot 98% of the way to its target with
 * 15% of the swing still to run. The body has not caught up yet, so the foot
 * sits further in front of the hip than the leg is long — measured 64cm of
 * reach against a 44cm budget at a 4.6 m/s run — and the pelvis then has to
 * drop 15cm to reach it. Travelling at a steady rate keeps the foot's offset
 * from the hip monotonic and bounded by the plant offset itself, which is the
 * one number the stride was sized against. The taper is what still leaves the
 * foot motionless at the instant it lands.
 */
const SWING_A = 0.86;
const SWING_V = 2 / (1 + SWING_A);
function swingEase(t) {
  if (t <= SWING_A) return SWING_V * t;
  const u = (t - SWING_A) / (1 - SWING_A);
  return SWING_V * (SWING_A + (1 - SWING_A) * (u * 0.5 + Math.sin(Math.PI * u) / TAU));
}

/**
 * Neutral toe-down bias, radians. The boot is authored around the bone, and a
 * bone 3.05° below the contact plane is what puts the sole flat on it —
 * measured off the boot mesh's world AABB in a stance pose, not chosen.
 */
const SOLE_BIAS = 0.0532;

export class BipedAnimator {
  constructor(rig, opts = {}) {
    this.rig = rig;
    const s = this.scale = opts.scale ?? 1;

    // Measured off the skeleton it was handed, never assumed: every archetype
    // scales its legs differently and everything below is a function of them.
    this.legLen = (rig.get('thighL')?.length ?? 0.44 * s) + (rig.get('shinL')?.length ?? 0.42 * s);
    this.ankleY = 0.072 * s;                 // ankle above the contact point
    this.footLen = 0.19 * s;
    this.legRef = this.legLen / (0.86 * s);  // these legs against a reference adult's

    // A hip height the legs can actually hold. `hipHeight: 0.95` is what every
    // caller asks for and 0.880 is what the reach clamp silently served, which
    // pinned the standing knee at 94% extension and clipped the whole upward
    // half of the walk bob away. Ask for what is reachable and bob about that.
    this.standHip = Math.min((opts.hipHeight ?? 0.95) * s, this.ankleY + this.legLen * 0.94);
    this.hipHeight = this.standHip;
    this.stanceWidth = 0.115 * s;
    this.stepTrigger = 0.105 * s;            // stance error that provokes a step

    this.phase = 0;
    this.duty = 0.63;
    this.feet = [this._mkFoot('L', 1, 0), this._mkFoot('R', -1, 0.5)];
    this.initialised = false;
    this.hipLean = new THREE.Vector3();
    this.spineTwist = 0;
    this.spineLean = 0;
    this.bob = 0;
    this.sway = 0;
    this.airTime = 0;
    this.turnRate = 0;
    this.landDip = 0;
    this.breathPhase = 0;
    this.idlePhase = 0;
    this.onFootstep = null;
    this._prevVel = new THREE.Vector3();
    this._moveDir = new THREE.Vector3(0, 0, 1);
    this._accelF = 0; this._accelS = 0;
    this._lastFacing = null;
    this._wasMoving = false;
    this._fallV = 0;
    this._chestLag = 0;
    this._facing = 0;
    // per-frame gait constants, held as fields so the swing solver can read
    // them without an allocation per foot per frame
    this._gMoving = false; this._gSep = this.stanceWidth; this._gToeOut = 0.1;
    this._gStance = 0; this._gFront = 0.5; this._gLift = 1;
  }

  _mkFoot(name, side, offset) {
    return {
      name, side, offset,
      planted: new THREE.Vector3(), pos: new THREE.Vector3(),
      from: new THREE.Vector3(), to: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0), toN: new THREE.Vector3(0, 1, 0),
      yaw: 0, fromYaw: 0, toYaw: 0,
      lift: 0, pitch: 0, ankleRise: 0,
      grounded: true, air: false, t: 1, dur: 0.3, sinceStep: 9,
    };
  }

  /** Ground normal by central difference — groundAt is all we are handed. */
  _normalAt(groundAt, x, z, out) {
    const h = 0.17 * this.scale;
    const dx = groundAt(x + h, z) - groundAt(x - h, z);
    const dz = groundAt(x, z + h) - groundAt(x, z - h);
    out.set(-dx, 2 * h, -dz);
    if (!isFinite(out.x) || !isFinite(out.z) || out.lengthSq() < 1e-9) return out.set(0, 1, 0);
    return out.normalize();
  }

  /**
   * @param p.position   character world position (feet level)
   * @param p.facing     yaw radians
   * @param p.velocity   world velocity
   * @param p.grounded   bool
   * @param p.groundAt   (x,z) => height
   * @param p.crouch     0..1
   */
  update(dt, p) {
    const rig = this.rig, s = this.scale;
    // A dropped frame or a returning tab must not teleport a foot across the
    // level: every integrator below is driven by dt.
    dt = clamp(dt, 0, 0.1);
    const groundAt = p.groundAt || (() => 0);
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const crouch = clamp(p.crouch || 0, 0, 1);
    const vn = speed / this.legRef;

    const fwd = _b1.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    const left = _b2.set(fwd.z, 0, -fwd.x);
    const moveDir = _b3.set(p.velocity.x, 0, p.velocity.z);
    if (moveDir.lengthSq() > 1e-4) moveDir.normalize(); else moveDir.copy(fwd);
    this._moveDir.copy(moveDir);
    const moving = speed > 0.35 * this.legRef && p.grounded;

    if (!this.initialised) {
      for (const f of this.feet) {
        f.planted.copy(p.position).addScaledVector(left, f.side * this.stanceWidth);
        f.planted.y = groundAt(f.planted.x, f.planted.z);
        f.pos.copy(f.planted); f.to.copy(f.planted); f.from.copy(f.planted);
        f.yaw = f.toYaw = f.fromYaw = p.facing + f.side * 0.1;
        this._normalAt(groundAt, f.planted.x, f.planted.z, f.normal);
        f.toN.copy(f.normal);
      }
      this._lastFacing = p.facing;
      this._prevVel.copy(p.velocity);
      this.initialised = true;
    }

    /* ── how fast the world is turning under us ───────────────────────── */
    const rawTurn = wrapPi(p.facing - this._lastFacing) / Math.max(dt, 1e-4);
    this._lastFacing = p.facing;
    this.turnRate = damp(this.turnRate, clamp(rawTurn, -9, 9), 10, dt);

    /* ── acceleration, for the lean ───────────────────────────────────── */
    _b4.subVectors(p.velocity, this._prevVel).divideScalar(Math.max(dt, 1e-4));
    this._prevVel.copy(p.velocity);
    this._accelF = damp(this._accelF, clamp(_b4.dot(fwd) / 16, -1, 1), 9, dt);
    this._accelS = damp(this._accelS, clamp(_b4.dot(left) / 16, -1, 1), 9, dt);

    /* ── the gait itself ──────────────────────────────────────────────── */
    const runness = smoothstep(1.9, 3.4, vn);
    const sprint = smoothstep(5.4, 8.0, vn);
    const duty = clamp(lerp(0.63, 0.34, runness) - 0.04 * sprint, 0.28, 0.72);
    this.duty = duty;
    const moveGate = smoothstep(0.2, 1.1, vn);

    // Hips ride lower the faster you go. A runner's pelvis genuinely drops, and
    // it is also what buys the horizontal reach a long stride needs.
    const hipStand = this.standHip * lerp(1, 0.955, runness) * lerp(1, 0.68, crouch);

    // How much ground one stance can actually cover, solved rather than
    // guessed. Heel-off is worth more of it than anything else in here: at
    // toe-off the ankle is a hand's width clear of the floor and the leg gets
    // every centimetre of that back as horizontal travel. Both lifts come
    // straight out of the same ankle-pitch model the feet are posed with, so
    // the budget cannot drift away from the pose it is budgeting for.
    const pitchStrike = 0.10 + 0.20 * runness;
    const pitchOff = 0.40 + 0.36 * runness;
    const strikeLift = this.ankleY + this.footLen * Math.sin(pitchStrike) * 0.4;
    const toeOffLift = this.ankleY + this.footLen * Math.sin(pitchOff) * 0.85;
    const R = this.legLen * 0.975;
    const bobAmp = lerp(0.018, 0.048, runness) * s * moveGate;
    const bobSign = lerp(1, -1, runness);
    // strike and toe-off sit symmetrically about mid-stance, so the pelvis is
    // at the same height at both of them
    const bobEdge = bobAmp * bobSign * Math.cos(TAU * duty);
    const thighY = Math.max(0.05 * s, hipStand + bobEdge - 0.02 * s);
    // A walk splits its stance evenly about the hip; a run lands much closer
    // to underneath itself and pushes further off the back. Measured: at 0.5
    // the sprint pelvis was dragged down to 0.69m to reach the front foot, at
    // 0.38 it holds 0.77m.
    const frontFrac = lerp(0.5, 0.38, runness);
    const budgetF = Math.sqrt(Math.max(0, R * R - (thighY - strikeLift) ** 2));
    const budgetR = Math.sqrt(Math.max(0, R * R - (thighY - toeOffLift) ** 2));
    const spanMax = Math.max(0.05 * s,
      Math.min(budgetF / frontFrac, budgetR / (1 - frontFrac)) * 0.95);

    // Cadence: the natural law for a body this size, raised to whatever the
    // legs need so that a stance never asks for more ground than they span.
    let freq = (1.55 + 0.42 * vn) * 0.5 / this.legRef;
    if (speed > 0.05) freq = Math.max(freq, duty * speed / spanMax);
    freq = clamp(freq, 0.3, 4.4);
    const stanceTime = duty / freq;
    // how much of the travel is across the body rather than through it
    const lateral = Math.abs(moveDir.dot(left));
    this._gStance = moving ? speed * stanceTime : 0;
    this._gFront = frontFrac;
    this._gMoving = moving;
    // Sidestepping is the one case where the stance line and the stride line
    // are the same line, so the swing foot has to pass the planted one. Widen
    // the stance and lift the swing higher for it, exactly as a person does
    // when they cross-step: measured shin-to-shin 0.0cm at a 3 m/s strafe
    // without it, one leg drawn inside the other.
    this._gSep = this.stanceWidth * lerp(1, 0.55, runness) * lerp(1, 1.7, lateral);
    this._gLift = lerp(1, 2.0, lateral);
    this._gToeOut = lerp(0.13, 0.03, runness);

    // Starting to walk should start on the foot a person would start on — the
    // one already furthest behind — not wherever the frozen phase left off.
    if (moving && !this._wasMoving) {
      const b0 = _b5.subVectors(this.feet[0].planted, p.position).dot(moveDir);
      const b1 = _b5.subVectors(this.feet[1].planted, p.position).dot(moveDir);
      this.phase = (duty + 1e-3 - this.feet[b0 <= b1 ? 0 : 1].offset + 1) % 1;
    }
    this._wasMoving = moving;
    if (moving) this.phase = (this.phase + freq * dt) % 1;

    /* ── air time and the landing it ends in ──────────────────────────── */
    // The FASTEST the fall got, not the speed on the last airborne frame — a
    // character controller normally zeroes velocity.y the instant it touches,
    // and reading it there scores every landing as a step off a kerb.
    if (!p.grounded) { this.airTime += dt; this._fallV = Math.min(this._fallV, p.velocity.y); }
    else {
      // knees absorb a landing: the pelvis dips under it and springs back
      if (this.airTime > 0.11) this.landDip = -clamp(-this._fallV / 11, 0.12, 1) * 0.26 * s;
      this.airTime = 0; this._fallV = 0;
    }
    this.landDip = damp(this.landDip, 0, 5.5, dt);

    this.breathPhase = (this.breathPhase + dt * (0.23 + 0.55 * clamp(vn / 5, 0, 1))) % 1;
    this.idlePhase = (this.idlePhase + dt * 0.115) % 1;
    const breath = Math.sin(this.breathPhase * TAU);
    const idleGate = 1 - moveGate;

    /* ── feet ─────────────────────────────────────────────────────────── */
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const side = f.side;
      f.sinceStep += dt;

      if (!p.grounded) {
        // Airborne: the legs trail on the way up and reach for the ground on
        // the way down, so a landing is anticipated rather than snapped into.
        const tuck = clamp(this.airTime * 4, 0, 1);
        const fall = clamp(-p.velocity.y / 9, 0, 1);
        f.pos.copy(p.position)
          .addScaledVector(left, side * this._gSep)
          .addScaledVector(fwd, lerp(0, side > 0 ? 0.20 : -0.14, tuck) * s * (1 - fall * 0.6));
        f.pos.y = p.position.y + lerp(0.40, 0.10, fall) * tuck * s;
        f.planted.copy(f.pos);
        f.normal.set(0, 1, 0); f.toN.set(0, 1, 0);
        f.yaw = p.facing + side * this._gToeOut;
        f.pitch = damp(f.pitch, lerp(-0.34, 0.20, fall), 8, dt);
        f.ankleRise = 0; f.lift = 1;
        f.grounded = false; f.air = true;
        continue;
      }

      // first frame back on the ground: plant where the foot actually is
      if (f.air) {
        f.air = false; f.grounded = true; f.t = 1;
        f.planted.copy(f.pos);
        f.planted.y = groundAt(f.planted.x, f.planted.z);
        f.pos.copy(f.planted);
        this._normalAt(groundAt, f.planted.x, f.planted.z, f.normal);
        f.toN.copy(f.normal); f.sinceStep = 0;
        if (this.onFootstep) this.onFootstep(f.planted, speed);
      }

      const ph = (this.phase + f.offset) % 1;

      if (f.grounded) {
        // Where this foot would like to be standing, right now.
        _b5.copy(p.position).addScaledVector(left, side * this._gSep)
          .addScaledVector(fwd, side * 0.028 * s);
        const err = Math.hypot(f.planted.x - _b5.x, f.planted.z - _b5.z);
        // Rhythm while moving, error while standing. Never both, or a foot
        // lifts twice in a cycle and the walk picks up a stutter.
        const rhythm = moving && ph >= duty && ph < duty + 0.4
          && f.sinceStep > 0.3 * stanceTime;
        const settle = !moving && err > this.stepTrigger
          && f.sinceStep > 0.2 && this.feet[1 - i].grounded;
        if (rhythm || settle) {
          f.from.copy(f.planted); f.fromYaw = f.yaw; f.t = 0; f.grounded = false;
          f.dur = Math.max(0.08, moving ? (1 - duty) / freq
            : clamp(0.30 / this.legRef, 0.18, 0.45));
          this._aimSwing(f, p, groundAt, f.dur);
        }
      }

      if (!f.grounded) {
        // Re-aim while the foot is still on its way up: a direction change in
        // the first 45% of a swing is honoured, after which the target is
        // locked so the plant lands on a fixed world point with zero foot
        // velocity. Chasing the body all the way down is what makes a foot
        // arrive already travelling — which is exactly what a slide is.
        if (f.t < 0.45) this._aimSwing(f, p, groundAt, (1 - f.t) * f.dur);
        f.t = Math.min(1, f.t + dt / Math.max(f.dur, 1e-3));
        // The swing finishes BEFORE the phase does — the foot is down and
        // still for the last few percent of it. Landing straight off the end
        // of the arc left 25mm of lift on the final frame, and the plant then
        // snapped it to the floor: a 20mm pop on every single footfall.
        const e = swingEase(clamp(f.t / 0.97, 0, 1));
        f.pos.lerpVectors(f.from, f.to, e);
        // The foot is still HIGH while it is at its furthest in front of the
        // hip — that is what a flexed knee is for — and comes down over the
        // last fifth of the swing.
        const u = clamp(f.t / 0.97, 0, 1);
        const arc = Math.sin(Math.PI * Math.pow(u, 1.3)) * (1 - smoothstep(0.80, 1, u));
        f.lift = arc * clamp(0.055 + 0.05 * vn, 0.05, 0.30) * s * this._gLift;
        f.pos.y = lerp(f.from.y, f.to.y, e) + f.lift;
        f.yaw = f.fromYaw + wrapPi(f.toYaw - f.fromYaw) * e;
        f.normal.lerp(f.toN, clamp(dt * 12, 0, 1)).normalize();
        // Plantarflexed off the toe, dorsiflexed to clear, heel first coming
        // in — and starting from exactly the angle stance left it at, or the
        // ankle snaps 19° at every toe-off.
        f.pitch = -(0.40 + 0.36 * runness) * (1 - smoothstep(0, 0.32, f.t))
          + smoothstep(0.3, 0.92, f.t) * (0.13 + 0.14 * runness);
        if (f.t >= 1) {
          f.grounded = true;
          f.planted.copy(f.to);
          f.planted.y = groundAt(f.planted.x, f.planted.z);
          f.pos.copy(f.planted);
          f.normal.copy(f.toN); f.yaw = f.toYaw; f.sinceStep = 0; f.lift = 0;
          if (this.onFootstep) this.onFootstep(f.planted, speed);
        }
      } else {
        // Stance. The contact point is COPIED, never damped: this is rule 1.
        // Only its height tracks the ground, so a crater opening under a
        // standing figure still takes it down with it.
        f.planted.y = damp(f.planted.y, groundAt(f.planted.x, f.planted.z), 9, dt);
        // and the surface it is lying ON is re-read too. Sampling the normal
        // only at the moment of the plant leaves a standing figure's soles
        // aligned to ground that a crater or a landslide has since removed.
        this._normalAt(groundAt, f.planted.x, f.planted.z, _b7);
        f.normal.lerp(_b7, clamp(dt * 8, 0, 1)).normalize();
        f.pos.copy(f.planted);
        f.lift = damp(f.lift, 0, 24, dt);
        const u = moving ? clamp(ph / duty, 0, 1) : 0;
        const strike = (1 - smoothstep(0, 0.20, u)) * (0.10 + 0.20 * runness);
        const off = smoothstep(0.52, 1, u) * (0.40 + 0.36 * runness);
        f.pitch = damp(f.pitch, moving ? strike - off : 0, 20, dt);
      }

      // The ankle rides above the contact point, and rides HIGHER as the foot
      // rolls: pitch the sole and the ankle lifts by the length of whichever
      // end of it is still down. That is where a long stride finds its reach.
      f.ankleRise = this.footLen * Math.sin(Math.abs(f.pitch)) * (f.pitch < 0 ? 0.85 : 0.4);
    }

    /* ── pelvis ───────────────────────────────────────────────────────── */
    // A walk vaults over a straight leg and is highest at mid-stance; a run
    // compresses one and is lowest there, and is highest in mid-flight
    // instead. Same clock, opposite sign.
    this.bob = bobAmp * bobSign * Math.cos((this.phase - duty * 0.5) * TAU * 2)
      + breath * 0.006 * s * (0.35 + 0.65 * idleGate);

    // Weight goes over the stance foot; at idle it drifts slowly from one foot
    // to the other, which is the cheapest thing there is that stops a standing
    // figure reading as a statue.
    const swayPh = Math.cos((this.phase - duty * 0.5) * TAU);
    this.sway = lerp(0.030, 0.014, runness) * s * moveGate * swayPh
      + Math.sin(this.idlePhase * TAU) * 0.018 * s * idleGate;

    const hips = rig.hipsBone.obj;
    const hipX = p.position.x + left.x * this.sway;
    const hipZ = p.position.z + left.z * this.sway;
    let hipY = p.position.y + hipStand + this.bob + this.landDip;
    if (!p.grounded) hipY -= clamp(this.airTime * 0.4, 0, 0.12) * s;

    // THE reach clamp, and it is a 3D one over BOTH legs. A foot 0.63m ahead
    // of the hip has spent 0.63m of the leg before a centimetre of it goes
    // downward; clamping on height alone — which is what this did — and only
    // against the planted foot is what left the drawn foot up to 22cm from
    // the point the gait believed it was standing on. A swinging foot near the
    // ground constrains the pelvis exactly as hard as a planted one does.
    if (p.grounded) {
      for (const f of this.feet) {
        const ax = hipX + left.x * f.side * 0.095 * s - f.pos.x;
        const az = hipZ + left.z * f.side * 0.095 * s - f.pos.z;
        const vmax = Math.sqrt(Math.max(0, R * R - (ax * ax + az * az)));
        hipY = Math.min(hipY, f.pos.y + this.ankleY + f.ankleRise + vmax + 0.02 * s);
      }
      hipY = Math.max(hipY, p.position.y + 0.30 * s);
    }
    hips.position.set(hipX, hipY, hipZ);

    // Lean into what the body is doing: real acceleration, plus the caller's
    // own speed proxy so a steady run still carries a forward set. The proxy
    // every caller passes is unsigned — clamp(speed/8) — so it is signed here
    // against the direction of travel, or backing away leans into it.
    const along = clamp(_b3.dot(fwd), -1, 1);
    this.spineLean = damp(this.spineLean,
      clamp((p.accelForward ?? 0) * 0.17 * along + this._accelF * 0.13, -0.30, 0.30), 8, dt);
    // Bank into a turn. Cornering at speed is the whole reason this term
    // exists, and it was fed from accelStrafe, which every caller passes as 0.
    const turnBank = clamp(this.turnRate * Math.min(speed, 8) * 0.017, -0.24, 0.24);
    const bank = damp(this.hipLean.z,
      clamp((p.accelStrafe ?? 0) * 0.10 + this._accelS * 0.11, -0.26, 0.26) + turnBank, 8, dt);
    this.hipLean.z = bank;

    // Transverse pelvis rotation: the swing leg's hip leads. Frontal list: the
    // unsupported side drops. Between them they are most of what makes a walk
    // read as weight being carried rather than two legs on a rail.
    const pelvisYaw = -lerp(0.055, 0.12, runness) * moveGate * Math.cos(this.phase * TAU);
    const pelvisList = lerp(0.055, 0.030, runness) * moveGate * swayPh
      + Math.sin(this.idlePhase * TAU) * 0.022 * idleGate;
    this.spineTwist = pelvisYaw;

    _be.set(this.spineLean * 0.55 + crouch * 0.28 - this.landDip * 1.5,
      pelvisYaw, pelvisList - bank * 0.55, 'XYZ');
    hips.quaternion.setFromAxisAngle(YAXIS, p.facing).multiply(_bq2.setFromEuler(_be));

    /* ── spine, ribcage, neck ─────────────────────────────────────────── */
    // Player.js overwrites `spine` with its own blade-driven twist; this is
    // what every other biped in the game gets from the gait, and the chest and
    // neck below survive that overwrite because they are separate bones.
    const spineYaw = -pelvisYaw * 0.35;
    const spine = rig.get('spine');
    if (spine) {
      spine.obj.quaternion.copy(spine.restQuat).multiply(
        _bq.setFromEuler(_be.set(this.spineLean * 0.30, spineYaw, -bank * 0.25, 'XYZ')));
    }

    // The ribcage counter-rotates against the pelvis — that is what an arm
    // swing hangs off — and lags a turn, so a corner starts at the hips.
    this._chestLag = damp(this._chestLag, clamp(this.turnRate * 0.085, -0.30, 0.30), 7, dt);
    const chestYaw = -pelvisYaw * 1.15 - this._chestLag;
    const chestRoll = -pelvisList * 0.6;
    const chest = rig.get('chest');
    if (chest) {
      chest.obj.quaternion.copy(chest.restQuat).multiply(
        _bq.setFromEuler(_be.set(breath * 0.016 * (0.4 + 0.6 * idleGate) - this.spineLean * 0.18,
          chestYaw, chestRoll, 'XYZ')));
    }

    // The head is the last thing in a body to move and the first to be held
    // still: take three quarters of the accumulated twist back out, all of the
    // list, and let the gaze lead the turn the torso is lagging behind.
    const neck = rig.get('neck');
    if (neck) {
      neck.obj.quaternion.copy(neck.restQuat).multiply(
        _bq.setFromEuler(_be.set(-this.spineLean * 0.22 + this.landDip * 0.9,
          -(pelvisYaw + spineYaw + chestYaw) * 0.75 + clamp(this.turnRate * 0.055, -0.22, 0.22),
          -chestRoll * 0.8 - pelvisList * 0.25, 'XYZ')));
    }

    rig.updateMatrices();

    /* ── legs ─────────────────────────────────────────────────────────── */
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const upper = i === 0 ? 'thighL' : 'thighR';
      const lower = i === 0 ? 'shinL' : 'shinR';
      const foot = i === 0 ? 'footL' : 'footR';

      // Knee poled along the foot's OWN heading, so on a turn the knee tracks
      // the foot instead of the chest.
      _b5.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
      _b6.copy(f.pos).addScaledVector(_b5, 0.34 * s)
        .addScaledVector(left, f.side * 0.10 * s).setY(f.pos.y + 0.46 * s);
      const ankle = _b7.copy(f.pos).addScaledVector(f.normal, this.ankleY);
      ankle.y += f.ankleRise;
      rig.solveIK(upper, lower, ankle, _b6);

      if (rig.get(foot)) {
        // Toe direction laid into the CONTACT plane, so a plant on a slope
        // tilts the whole foot with the ground instead of hovering level to
        // the world; then the ankle's own pitch on top of that.
        _b5.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
        _b5.addScaledVector(f.normal, -_b5.dot(f.normal));
        if (_b5.lengthSq() < 1e-8) _b5.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
        _b5.normalize();
        _b6.crossVectors(f.normal, _b5);
        if (_b6.lengthSq() > 1e-10) _b5.applyAxisAngle(_b6.normalize(), SOLE_BIAS - f.pitch);
        rig.aimBoneWorld(foot, _b5, f.normal);
      }
    }
    rig.updateMatrices();
  }

  /**
   * Where a swinging foot is going. Aimed at where the BODY will be when it
   * lands rather than where the body is now, and at the facing it will have
   * turned to by then.
   */
  _aimSwing(f, p, groundAt, remain) {
    const s = this.scale;
    const t = Math.max(0, remain);
    const yawAtLand = p.facing + this.turnRate * t * 0.6;
    const fwdL = _b4.set(Math.sin(yawAtLand), 0, Math.cos(yawAtLand));
    const leftL = _b5.set(fwdL.z, 0, -fwdL.x);
    f.to.set(p.position.x + p.velocity.x * t, 0, p.position.z + p.velocity.z * t);
    f.to.addScaledVector(leftL, f.side * this._gSep);
    if (this._gMoving) f.to.addScaledVector(this._moveDir, this._gStance * this._gFront);
    else f.to.addScaledVector(fwdL, f.side * 0.028 * s);
    f.to.y = groundAt(f.to.x, f.to.z);
    this._normalAt(groundAt, f.to.x, f.to.z, f.toN);
    f.toYaw = yawAtLand + f.side * this._gToeOut;
  }

  /**
   * Neutral arm swing for characters not holding anything up. Contralateral —
   * the right arm goes forward with the left leg — with the elbow folding
   * further the faster the body goes, which is most of the difference between
   * a walk and a run in the upper body.
   */
  swingArms(dt, speed, amount = 1) {
    const rig = this.rig;
    const vn = speed / this.legRef;
    const face = this._facing || 0;
    // Driven off where the FEET actually are, not off the gait clock. That
    // makes the swing contralateral by construction at any duty factor, and it
    // needs no re-tuning when the walk/run blend moves. Off the clock, the
    // hands crossed over a tenth of a cycle away from the feet — the two
    // halves of the body reading as two different animations.
    const lead = (this.feet[0].pos.x - this.feet[1].pos.x) * Math.sin(face)
      + (this.feet[0].pos.z - this.feet[1].pos.z) * Math.cos(face);
    const drive = clamp(lead / (this.legLen * 0.9), -1, 1);
    const amp = clamp(0.55 + vn * 0.10, 0, 1) * amount;
    const breath = Math.sin(this.breathPhase * TAU) * 0.022;
    for (const [arm, fore, sign] of [['armL', 'foreL', 1], ['armR', 'foreR', -1]]) {
      if (!rig.get(arm)) continue;
      const sw = (sign > 0 ? -drive : drive) * amp + breath * sign;
      // the arm hangs, and clears the ribs a little further at speed
      _b1.set(sign * (0.20 + 0.06 * clamp(vn / 4, 0, 1)), -0.96, sw * 0.62)
        .normalize().applyAxisAngle(YAXIS, face);
      rig.aimBoneWorld(arm, _b1, null);
      if (!rig.get(fore)) continue;
      const flex = 0.20 + 0.55 * clamp(vn / 4.5, 0, 1) + Math.max(0, sw) * 0.42;
      _b2.set(sign * 0.11, -1, flex).normalize().applyAxisAngle(YAXIS, face);
      rig.aimBoneWorld(fore, _b2, null);
    }
  }

  setFacing(f) { this._facing = f; }
}
