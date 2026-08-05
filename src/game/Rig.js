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
import { clamp, lerp, damp, smoothstep, dampVec, TAU } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const YAXIS = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);

/** Quaternion that points local +Y along `dir`, with `ref` biasing the roll. */
export function aimY(dir, ref, out = new THREE.Quaternion()) {
  _v1.copy(dir).normalize();
  _v2.copy(ref || XAXIS);
  if (Math.abs(_v1.dot(_v2)) > 0.985) _v2.set(0, 0, 1);
  _v3.crossVectors(_v2, _v1).normalize();      // x
  _v4.crossVectors(_v1, _v3).normalize();      // z
  _m1.makeBasis(_v3, _v1, _v4);
  return out.setFromRotationMatrix(_m1);
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
    { name: 'armL',      parent: 'clavL',   offset: [0.13 * s, 0, 0],          length: 0.285 * s * armLen, rest: [0.30, -0.95, -0.05] },
    { name: 'foreL',     parent: 'armL',    offset: [0, 0.285 * s * armLen, 0], length: 0.265 * s * armLen, rest: [0.10, -0.99, 0.05] },
    { name: 'handL',     parent: 'foreL',   offset: [0, 0.265 * s * armLen, 0], length: 0.10 * s, rest: [0, -1, 0] },

    { name: 'clavR',     parent: 'chest',   offset: [-0.035 * s, 0.185 * s, 0], length: 0.13 * s, rest: [-1, 0.18, 0] },
    { name: 'armR',      parent: 'clavR',   offset: [-0.13 * s, 0, 0],          length: 0.285 * s * armLen, rest: [-0.30, -0.95, -0.05] },
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
    { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.5 * s, rest: [0, 0, -1] },
    { name: 'body', parent: 'hips', offset: [0, 0.25 * s, 0], length: 0.7 * s, rest: [0, 0, -1] },
    { name: 'head', parent: 'body', offset: [0, 0.1 * s, -0.6 * s], length: 0.4 * s, rest: [0, 0, -1] },
  ];
  for (let i = 0; i < legs; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const z = (row - (legs / 2 - 1) / 2) * 0.55 * s;
    out.push({ name: `hipL${i}`, parent: 'hips', offset: [0.34 * s * side, 0.1 * s, z], length: 0.16 * s, rest: [side, 0.2, 0] });
    out.push({ name: `femur${i}`, parent: `hipL${i}`, offset: [0.16 * s * side, 0, 0], length: 0.62 * s, rest: [side * 0.5, 0.72, 0] });
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
      const wq = aimY(b.restDir, null, new THREE.Quaternion());
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
    const rootPos = _v1.setFromMatrixPosition(upper.obj.matrixWorld);
    const l1 = upper.length * upper.cutT;
    const l2 = lower.length * lower.cutT;

    _v2.subVectors(target, rootPos);
    let dist = _v2.length();
    const maxD = (l1 + l2) * softness;
    const minD = Math.abs(l1 - l2) * 1.02 + 1e-4;
    dist = clamp(dist, minD, maxD);
    if (_v2.lengthSq() < 1e-8) _v2.set(0, -1, 0);
    _v2.normalize();

    // law of cosines for the elbow/knee bend
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const a = Math.acos(cosA);

    // build a frame: forward toward target, side from the pole vector
    _v3.subVectors(pole, rootPos);
    _v4.crossVectors(_v2, _v3);
    if (_v4.lengthSq() < 1e-7) { _v4.crossVectors(_v2, XAXIS); if (_v4.lengthSq() < 1e-7) _v4.crossVectors(_v2, YAXIS); }
    _v4.normalize();                       // rotation axis

    _q1.setFromAxisAngle(_v4, -a);
    _v5.copy(_v2).applyQuaternion(_q1);    // upper bone direction

    // place the upper bone
    upper.obj.parent.getWorldQuaternion(_q2);
    aimY(_v5, _v3, _q1);
    upper.obj.quaternion.copy(_q2.clone().invert()).multiply(_q1);
    upper.obj.updateMatrixWorld(true);

    // lower bone points from the elbow to the target
    _v6.copy(rootPos).addScaledVector(_v5, l1);
    _v5.copy(target).sub(_v6);
    if (_v5.lengthSq() < 1e-8) _v5.set(0, -1, 0);
    _v5.normalize();
    upper.obj.getWorldQuaternion(_q2);
    aimY(_v5, _v3, _q1);
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

export class BipedAnimator {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.scale = opts.scale ?? 1;
    this.strideLength = (opts.stride ?? 0.86) * this.scale;
    this.hipHeight = (opts.hipHeight ?? 0.94) * this.scale;
    this.phase = 0;
    this.feet = [
      { name: 'L', planted: new THREE.Vector3(), next: new THREE.Vector3(), pos: new THREE.Vector3(), lift: 0, offset: 0.0, grounded: true },
      { name: 'R', planted: new THREE.Vector3(), next: new THREE.Vector3(), pos: new THREE.Vector3(), lift: 0, offset: 0.5, grounded: true },
    ];
    this.initialised = false;
    this.hipOffset = new THREE.Vector3();
    this.hipLean = new THREE.Vector3();
    this.spineTwist = 0;
    this.spineLean = 0;
    this.headLook = new THREE.Vector3();
    this.bob = 0;
    this.airTime = 0;
    this.onFootstep = null;
    this._lastPhaseFloor = [0, 0];
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
    const rig = this.rig;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const moving = speed > 0.25 && p.grounded;

    if (!this.initialised) {
      for (const f of this.feet) {
        f.planted.copy(p.position); f.pos.copy(p.position); f.next.copy(p.position);
      }
      this.initialised = true;
    }

    // stride frequency scales with speed the way real gait does
    const stride = this.strideLength * lerp(0.72, 1.25, clamp(speed / 6, 0, 1));
    const freq = moving ? clamp(speed / stride, 0.3, 3.4) : 0;
    this.phase = (this.phase + freq * dt) % 1;
    if (!moving) this.phase = damp(this.phase, this.phase < 0.5 ? 0.25 : 0.75, 6, dt);

    const fwd = _v1.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    const right = _v2.set(fwd.z, 0, -fwd.x);
    const moveDir = _v3.set(p.velocity.x, 0, p.velocity.z);
    if (moveDir.lengthSq() > 0.01) moveDir.normalize(); else moveDir.copy(fwd);

    const legSep = 0.115 * this.scale;
    const hipY = this.hipHeight * lerp(1, 0.68, p.crouch || 0);

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const ph = (this.phase + f.offset) % 1;
      const side = i === 0 ? 1 : -1;

      // where this foot wants to be planted next
      const lead = moving ? stride * 0.5 : 0;
      f.next.copy(p.position)
        .addScaledVector(moveDir, lead)
        .addScaledVector(right, side * legSep);
      f.next.y = p.groundAt(f.next.x, f.next.z);

      if (!p.grounded) {
        // tuck in the air
        const tuck = clamp(this.airTime * 3, 0, 1);
        f.pos.copy(p.position)
          .addScaledVector(right, side * legSep)
          .addScaledVector(fwd, lerp(0, side > 0 ? 0.18 : -0.12, tuck));
        f.pos.y = p.position.y + lerp(0, 0.42 * this.scale, tuck);
        f.lift = 1;
        f.grounded = false;
        continue;
      }

      if (ph < 0.5 || !moving) {
        // stance: the foot stays exactly where it was put
        if (!f.grounded) {
          f.grounded = true;
          f.planted.copy(f.pos);
          if (this.onFootstep) this.onFootstep(f.planted, speed);
        }
        if (!moving) {
          // drift slowly to a neutral stance when idle
          _v4.copy(p.position).addScaledVector(right, side * legSep).addScaledVector(fwd, side * 0.03);
          _v4.y = p.groundAt(_v4.x, _v4.z);
          dampVec(f.planted, _v4, 4.5, dt);
        }
        f.pos.copy(f.planted);
        f.lift = damp(f.lift, 0, 22, dt);
      } else {
        // swing: arc from the plant to the next plant
        const t = (ph - 0.5) * 2;
        const ease = t * t * (3 - 2 * t);
        f.pos.lerpVectors(f.planted, f.next, ease);
        const h = Math.sin(t * Math.PI);
        f.lift = h * clamp(0.10 + speed * 0.035, 0.08, 0.3) * this.scale;
        f.pos.y = lerp(f.planted.y, f.next.y, ease) + f.lift;
        f.grounded = false;
      }
    }

    if (!p.grounded) this.airTime += dt; else this.airTime = 0;

    // ── hips
    const bobAmt = moving ? clamp(speed * 0.012, 0, 0.05) * this.scale : 0;
    this.bob = Math.sin(this.phase * TAU * 2) * bobAmt;
    const sway = Math.sin(this.phase * TAU) * clamp(speed * 0.012, 0, 0.045) * this.scale;

    const hips = rig.hipsBone.obj;
    const targetHipY = p.position.y + hipY + this.bob
      - (p.grounded ? 0 : clamp(this.airTime * 0.4, 0, 0.12) * this.scale);
    hips.position.set(
      p.position.x + right.x * sway,
      targetHipY,
      p.position.z + right.z * sway,
    );

    // lean into acceleration and turn
    const leanF = clamp(p.accelForward ?? 0, -1, 1) * 0.16;
    const leanS = clamp(p.accelStrafe ?? 0, -1, 1) * 0.14;
    this.spineLean = damp(this.spineLean, leanF, 8, dt);
    const bank = damp(this.hipLean.z, leanS, 8, dt);
    this.hipLean.z = bank;

    _q1.setFromAxisAngle(YAXIS, p.facing);
    _q2.setFromEuler(new THREE.Euler(this.spineLean * 0.5 + (p.crouch || 0) * 0.28, 0, -bank * 0.5, 'XYZ'));
    hips.quaternion.copy(_q1).multiply(_q2);

    rig.updateMatrices();

    // ── legs by IK, with the knee poled forward
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const side = i === 0 ? 1 : -1;
      const upper = i === 0 ? 'thighL' : 'thighR';
      const lower = i === 0 ? 'shinL' : 'shinR';
      const foot = i === 0 ? 'footL' : 'footR';
      _v4.copy(f.pos).addScaledVector(fwd, 0.30 * this.scale)
        .addScaledVector(right, side * 0.12 * this.scale).setY(f.pos.y + 0.42 * this.scale);
      const ankle = _v5.copy(f.pos).setY(f.pos.y + 0.075 * this.scale);
      rig.solveIK(upper, lower, ankle, _v4);

      // roll the foot: flat on the ground in stance, toe-off in swing
      const fb = rig.get(foot);
      if (fb) {
        const ph = (this.phase + f.offset) % 1;
        const toe = moving ? smoothstep(0.32, 0.5, ph) * 0.7 - smoothstep(0.5, 0.8, ph) * 0.55 : 0;
        _v6.copy(fwd).multiplyScalar(0.94).setY(-0.24 + toe * 0.7 - f.lift * 1.2);
        rig.aimBoneWorld(foot, _v6.normalize(), YAXIS);
      }
    }
    rig.updateMatrices();
  }

  /** Neutral arm swing for characters not holding anything up. */
  swingArms(dt, speed, amount = 1) {
    const rig = this.rig;
    const a = Math.sin(this.phase * TAU) * clamp(speed * 0.09, 0, 0.72) * amount;
    for (const [clav, arm, fore, sign] of [['clavL', 'armL', 'foreL', 1], ['clavR', 'armR', 'foreR', -1]]) {
      const b = rig.get(arm);
      if (!b) continue;
      const swing = sign > 0 ? a : -a;
      _v1.set(sign * 0.24, -0.96, swing * 0.55).normalize();
      rig.aimBoneWorld(arm, _v1.applyAxisAngle(YAXIS, this._facing || 0), null);
      const fb = rig.get(fore);
      if (fb) {
        _v2.set(sign * 0.14, -0.94, 0.30 + Math.abs(swing) * 0.3).normalize();
        rig.aimBoneWorld(fore, _v2.applyAxisAngle(YAXIS, this._facing || 0), null);
      }
    }
  }

  setFacing(f) { this._facing = f; }
}
