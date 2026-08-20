/**
 * BATTLEFRONT BORZ — physics
 *
 * A bespoke sequential-impulse rigid body solver.
 *
 * Every collider is decomposed into a small set of spheres in body-local space.
 * A capsule is two spheres, a crate is eight, a forearm is two. That single
 * choice buys us: one narrowphase routine instead of six, no SAT edge cases,
 * trivial cheap broadphase, and — the reason it was chosen — the ability to
 * rebuild a body's collider at runtime when a lightsaber takes part of it away.
 *
 * Full 6-DOF dynamics: impulses are applied at real contact points through a
 * real world-space inverse inertia tensor, so a severed arm tumbles correctly.
 */

import * as THREE from 'three';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m3 = new THREE.Matrix3(), _m3b = new THREE.Matrix3();

export const LAYER = {
  WORLD:    1 << 0,   // terrain, architecture
  PLAYER:   1 << 1,
  ENEMY:    1 << 2,
  DEBRIS:   1 << 3,   // cut chunks, gibs, rubble
  PROP:     1 << 4,   // crates, barrels — grippable
  RAGDOLL:  1 << 5,
  ALL:      0xffff,
};

/**
 * WHAT A LOOSE BODY MEETS — every layer there is, DERIVED from the table above
 * rather than typed out again beside it.
 *
 * Rapier pairs two colliders iff `(A.layer & B.mask) && (B.layer & A.mask)`, so
 * a mask that leaves a layer out is half a pair and the pair is dead. Five
 * places in the game make a loose body — a broken prop's fragments and a
 * wrecked chassis (`World.spawnDebris`/`spawnDebrisGroup`), a severed limb
 * (Ragdoll.js), a chunk of carved architecture (Destruction.js) and a crate
 * (Props.js) — carrying four DIFFERENT hand-written masks between them.
 * Measured, dropped from 4 m onto a standing player and onto a standing
 * Training Droid, resting height above the victim's feet against capsules
 * reaching 1.79 and 1.81:
 *
 *                              on the player      on a living body
 *     World.spawnDebris         -0.04  THROUGH      0.35  THROUGH
 *     World.spawnDebrisGroup    -0.06  THROUGH      0.26  THROUGH
 *     Ragdoll severed limb       2.09               -2.02  THROUGH
 *     Destruction chunk          1.99                2.01
 *     Props crate                2.14                2.16
 *
 * — a whole wrecked chassis and every fragment of every broken prop falling
 * through the person standing under it, and a severed arm passing through the
 * living body it was cut off next to. `spawnDebrisGroup` is the one that hurts:
 * `Enemy.js` hands it the ENTIRE destroyed machine.
 *
 * The rule a loose body wants is not a list, it is "everything", so this is
 * that and not a fifth list. A layer added tomorrow is in it the day it exists;
 * `LAYER.ALL` is deliberately not reused because it also spans the eight
 * self-exclusion bits above the table (see SELF_GROUPS in RapierWorld.js),
 * which are not layers and are not anybody's to name.
 */
export const LOOSE_MASK = Object.entries(LAYER)
  .reduce((m, [k, v]) => (k === 'ALL' ? m : m | v), 0);

let _bodyId = 1;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Body                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

export class Body {
  constructor(opts = {}) {
    this.id = _bodyId++;
    this.position = opts.position ? opts.position.clone() : new THREE.Vector3();
    this.quaternion = opts.quaternion ? opts.quaternion.clone() : new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();

    /** @type {{c:THREE.Vector3, r:number}[]} sphere decomposition, body-local */
    this.spheres = opts.spheres || [{ c: new THREE.Vector3(), r: opts.radius ?? 0.5 }];

    this.mass = opts.mass ?? 1;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.static = !!opts.static || this.mass <= 0;
    if (this.static) { this.invMass = 0; this.mass = 0; }
    this.kinematic = !!opts.kinematic;      // moved by gameplay, infinite mass to the solver

    this.friction = opts.friction ?? 0.55;
    this.restitution = opts.restitution ?? 0.05;
    this.linearDamping = opts.linearDamping ?? 0.02;
    this.angularDamping = opts.angularDamping ?? 0.06;
    this.gravityScale = opts.gravityScale ?? 1;

    this.layer = opts.layer ?? LAYER.DEBRIS;
    this.mask = opts.mask ?? LAYER.ALL;
    this.userData = opts.userData || {};
    this.onContact = opts.onContact || null;

    // Motion state
    this.awake = true;
    this.sleepTimer = 0;
    this.allowSleep = opts.allowSleep !== false;
    this.dead = false;

    // Derived
    this.invInertiaLocal = new THREE.Vector3(0, 0, 0);
    this.invInertiaWorld = new THREE.Matrix3();
    this.boundingRadius = 1;
    this.aabbMin = new THREE.Vector3();
    this.aabbMax = new THREE.Vector3();
    this.prevPosition = this.position.clone();

    this.computeMassProperties(opts.inertiaScale ?? 1);
    this.updateDerived();
  }

  /** Recompute inertia from the current sphere set (parallel axis theorem). */
  computeMassProperties(scale = 1) {
    if (this.static) {
      this.invInertiaLocal.set(0, 0, 0);
      this.boundingRadius = this._computeBoundingRadius();
      return;
    }
    // Distribute mass across spheres proportional to volume.
    let totalVol = 0;
    for (const s of this.spheres) totalVol += s.r * s.r * s.r;
    if (totalVol <= 0) totalVol = 1;

    let Ixx = 0, Iyy = 0, Izz = 0;
    for (const s of this.spheres) {
      const m = this.mass * (s.r * s.r * s.r) / totalVol;
      const solid = 0.4 * m * s.r * s.r;             // 2/5 m r²
      const { x, y, z } = s.c;
      Ixx += solid + m * (y * y + z * z);
      Iyy += solid + m * (x * x + z * z);
      Izz += solid + m * (x * x + y * y);
    }
    Ixx *= scale; Iyy *= scale; Izz *= scale;
    const eps = 1e-6;
    this.invInertiaLocal.set(
      Ixx > eps ? 1 / Ixx : 0,
      Iyy > eps ? 1 / Iyy : 0,
      Izz > eps ? 1 / Izz : 0,
    );
    this.boundingRadius = this._computeBoundingRadius();
  }

  _computeBoundingRadius() {
    let r = 0;
    for (const s of this.spheres) r = Math.max(r, s.c.length() + s.r);
    return r;
  }

  updateDerived() {
    // I⁻¹_world = R · I⁻¹_local · Rᵀ
    if (this.invMass === 0 && this.invInertiaLocal.lengthSq() === 0) {
      this.invInertiaWorld.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    } else {
      _m3.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.quaternion));
      const e = _m3.elements;
      const ix = this.invInertiaLocal.x, iy = this.invInertiaLocal.y, iz = this.invInertiaLocal.z;
      // R * diag(i) * Rᵀ  (column-major elements)
      const a = e[0], b = e[3], c = e[6];
      const d = e[1], f = e[4], g = e[7];
      const h = e[2], k = e[5], l = e[8];
      const o = this.invInertiaWorld.elements;
      o[0] = a * a * ix + b * b * iy + c * c * iz;
      o[1] = d * a * ix + f * b * iy + g * c * iz;
      o[2] = h * a * ix + k * b * iy + l * c * iz;
      o[3] = o[1];
      o[4] = d * d * ix + f * f * iy + g * g * iz;
      o[5] = h * d * ix + k * f * iy + l * g * iz;
      o[6] = o[2];
      o[7] = o[5];
      o[8] = h * h * ix + k * k * iy + l * l * iz;
    }
    const r = this.boundingRadius;
    this.aabbMin.set(this.position.x - r, this.position.y - r, this.position.z - r);
    this.aabbMax.set(this.position.x + r, this.position.y + r, this.position.z + r);
  }

  /** World-space centre of sphere i. */
  sphereWorld(i, out) {
    return out.copy(this.spheres[i].c).applyQuaternion(this.quaternion).add(this.position);
  }

  applyImpulse(impulse, worldPoint) {
    if (this.invMass === 0) return;
    this.wake();
    this.velocity.addScaledVector(impulse, this.invMass);
    if (worldPoint) {
      _v1.subVectors(worldPoint, this.position).cross(impulse).applyMatrix3(this.invInertiaWorld);
      this.angularVelocity.add(_v1);
    }
  }

  applyForceImpulse(impulse) { this.applyImpulse(impulse, null); }

  applyTorqueImpulse(t) {
    if (this.invMass === 0) return;
    this.wake();
    this.angularVelocity.add(_v1.copy(t).applyMatrix3(this.invInertiaWorld));
  }

  velocityAt(worldPoint, out) {
    out.copy(this.angularVelocity).cross(_v1.subVectors(worldPoint, this.position)).add(this.velocity);
    return out;
  }

  wake() { this.awake = true; this.sleepTimer = 0; }
  sleep() { this.awake = false; this.velocity.set(0, 0, 0); this.angularVelocity.set(0, 0, 0); }

  setTransform(pos, quat) {
    if (pos) this.position.copy(pos);
    if (quat) this.quaternion.copy(quat);
    this.updateDerived();
    this.wake();
  }
}

/* ── shape helpers ───────────────────────────────────────────────────── */

export function capsuleSpheres(halfHeight, radius, axis = 'y', count = 2) {
  const out = [];
  const n = Math.max(2, count);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    const c = new THREE.Vector3();
    c[axis] = t * halfHeight;
    out.push({ c, r: radius });
  }
  return out;
}

export function boxSpheres(hx, hy, hz) {
  // Eight rounded corners: stable stacking, cheap, and visually indistinguishable
  // from a hard box once the object is tumbling.
  const r = Math.min(hx, hy, hz) * 0.62;
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push({
      c: new THREE.Vector3(
        (i & 1 ? 1 : -1) * Math.max(0.001, hx - r),
        (i & 2 ? 1 : -1) * Math.max(0.001, hy - r),
        (i & 4 ? 1 : -1) * Math.max(0.001, hz - r),
      ), r,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Joints                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

export class BallJoint {
  /**
   * Point-to-point constraint with an optional cone/twist limit and an angular
   * motor that drives the relative orientation toward a rest pose. Severing a
   * limb is just `joint.broken = true`.
   */
  constructor(a, b, anchorA, anchorB, opts = {}) {
    this.a = a; this.b = b;
    this.anchorA = anchorA.clone();      // local to a
    this.anchorB = anchorB.clone();      // local to b
    this.broken = false;
    this.coneAxis = (opts.coneAxis || new THREE.Vector3(0, -1, 0)).clone().normalize(); // local to a
    this.coneAngle = opts.coneAngle ?? Math.PI * 0.45;
    this.twistLimit = opts.twistLimit ?? Math.PI * 0.4;
    this.stiffness = opts.stiffness ?? 0;   // angular motor strength (0 = rag)
    this.damping = opts.damping ?? 0.25;
    this.restQuat = (opts.restQuat || new THREE.Quaternion()).clone(); // b relative to a
    this.breakImpulse = opts.breakImpulse ?? Infinity;
    this.accum = new THREE.Vector3();
    this.softness = opts.softness ?? 0.0;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Contact pool                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

class Contact {
  constructor() {
    this.a = null; this.b = null;
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3();   // from a → b
    this.depth = 0;
    this.rA = new THREE.Vector3();
    this.rB = new THREE.Vector3();
    this.normalMass = 0;
    this.tangentMass1 = 0; this.tangentMass2 = 0;
    this.t1 = new THREE.Vector3(); this.t2 = new THREE.Vector3();
    this.normalImpulse = 0; this.tangent1Impulse = 0; this.tangent2Impulse = 0;
    this.bias = 0;
    this.friction = 0.5;
    this.restitution = 0;
    this.key = 0;
    this.staticNormal = null;   // when b is null (world geometry)
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  World                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

export class PhysicsWorld {
  constructor(opts = {}) {
    this.gravity = new THREE.Vector3(0, opts.gravity ?? -22, 0);
    this.bodies = [];
    this.joints = [];
    this.terrain = null;             // { height(x,z), normalAt(x,z,out) }
    this.staticBoxes = [];           // { center, halfExtents, quat, invQuat, friction, restitution, userData }
    this.iterations = opts.iterations ?? 8;
    this.relaxIterations = opts.relaxIterations ?? 2;
    this.slop = 0.006;
    this.baumgarte = 0.22;
    this.maxCorrection = 4.0;
    this.sleepLinear = 0.12;
    this.sleepAngular = 0.22;
    this.sleepTime = 0.75;
    this.contacts = [];
    this._contactPool = [];
    this._poolIdx = 0;
    this._warm = new Map();          // contact key → cached impulses
    this._grid = new Map();
    this.cellSize = opts.cellSize ?? 2.4;
    this.maxBodies = opts.maxBodies ?? 1400;
    this.stats = { bodies: 0, contacts: 0, awake: 0, ms: 0, overBudget: 0 };
    this.killY = opts.killY ?? -180;
  }

  add(body) {
    if (this.bodies.length >= this.maxBodies) this._cullOldestDebris();
    this.bodies.push(body);
    return body;
  }

  remove(body) {
    body.dead = true;
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    for (let j = this.joints.length - 1; j >= 0; j--) {
      const jt = this.joints[j];
      if (jt.a === body || jt.b === body) this.joints.splice(j, 1);
    }
  }

  addJoint(j) { this.joints.push(j); return j; }
  removeJoint(j) { const i = this.joints.indexOf(j); if (i >= 0) this.joints.splice(i, 1); }

  /**
   * THE BODY BUDGET SPENDS DEBRIS, AND NOTHING ELSE — the same rule as the
   * Rapier twin's `_cullOldestDebris`, and here for the same reason.
   *
   * This had a second pass under the debris one that took the first non-static
   * body in insertion order, guarded only by `b.userData.keep` — a flag read
   * on both these lines and WRITTEN NOWHERE IN src/, so the guard was vacuous
   * and the pass was unfiltered. Driven at `maxBodies: 12` with a player proxy
   * and twenty ragdoll bones and no debris at all in the world:
   *
   *     RapierWorld   0 culled, 9 refusals counted
   *     PhysicsWorld  9 culled → the player proxy, bone 0 … bone 7
   *
   * The player's proxy is added exactly once, in the Player constructor, so
   * after its cull nothing collides with the player for the rest of the
   * session; a bone taken out from under a corpse drops every joint that
   * touched it. DEBRIS is the only thing the game makes without counting, so
   * it is the only thing the budget may spend; everything else has an owner
   * that knows how to take it away whole. When there is no debris left the
   * budget is not met, which is honest and bounded — `stats.overBudget` counts
   * the refusals so the pressure is visible instead of silent.
   */
  _cullOldestDebris() {
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (b.layer === LAYER.DEBRIS && !b.static) {
        if (b.userData.onCull) b.userData.onCull();
        this.remove(b);
        return true;
      }
    }
    this.stats.overBudget++;
    return false;
  }

  _contact() {
    if (this._poolIdx < this._contactPool.length) return this._contactPool[this._poolIdx++];
    const c = new Contact();
    this._contactPool.push(c); this._poolIdx++;
    return c;
  }

  /* ── main step ─────────────────────────────────────────────────────── */

  step(dt) {
    const t0 = performance.now();
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;
    const invDt = 1 / dt;

    // 1 — integrate velocities
    let awakeCount = 0;
    for (const b of this.bodies) {
      if (b.static) continue;
      if (!b.awake) continue;
      awakeCount++;
      if (!b.kinematic) {
        b.velocity.addScaledVector(this.gravity, dt * b.gravityScale);
        const ld = Math.max(0, 1 - b.linearDamping * dt * 60 * 0.016);
        const ad = Math.max(0, 1 - b.angularDamping * dt * 60 * 0.016);
        b.velocity.multiplyScalar(ld);
        b.angularVelocity.multiplyScalar(ad);
        // clamp for stability
        const maxV = 90, maxW = 34;
        if (b.velocity.lengthSq() > maxV * maxV) b.velocity.setLength(maxV);
        if (b.angularVelocity.lengthSq() > maxW * maxW) b.angularVelocity.setLength(maxW);
      }
      b.prevPosition.copy(b.position);
    }

    // 2 — broadphase + narrowphase
    this._poolIdx = 0;
    this.contacts.length = 0;
    this._buildGrid();
    this._collectContacts(invDt);

    // 3 — warm start
    for (const c of this.contacts) {
      const cached = this._warm.get(c.key);
      if (cached) {
        c.normalImpulse = cached.n * 0.85;
        c.tangent1Impulse = cached.t1 * 0.85;
        c.tangent2Impulse = cached.t2 * 0.85;
        _v1.copy(c.normal).multiplyScalar(c.normalImpulse)
          .addScaledVector(c.t1, c.tangent1Impulse)
          .addScaledVector(c.t2, c.tangent2Impulse);
        this._applyPair(c, _v1);
      }
    }

    // 4 — solve
    for (let it = 0; it < this.iterations; it++) {
      this._solveJoints(dt, invDt, it === 0);
      this._solveContacts(true);
    }
    for (let it = 0; it < this.relaxIterations; it++) this._solveContacts(false);

    // 5 — cache impulses
    this._warm.clear();
    for (const c of this.contacts) {
      this._warm.set(c.key, { n: c.normalImpulse, t1: c.tangent1Impulse, t2: c.tangent2Impulse });
    }

    // 6 — integrate positions
    for (const b of this.bodies) {
      if (b.static || !b.awake) continue;
      b.position.addScaledVector(b.velocity, dt);
      const w = b.angularVelocity;
      if (w.lengthSq() > 1e-10) {
        _q1.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(b.quaternion);
        b.quaternion.x += _q1.x; b.quaternion.y += _q1.y;
        b.quaternion.z += _q1.z; b.quaternion.w += _q1.w;
        b.quaternion.normalize();
      }
      b.updateDerived();
    }

    // 7 — sleeping & culling
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.static) continue;
      if (b.position.y < this.killY) {
        if (b.userData.onCull) b.userData.onCull();
        this.remove(b);
        continue;
      }
      if (!b.allowSleep || b.kinematic) continue;
      if (b.velocity.lengthSq() < this.sleepLinear * this.sleepLinear &&
          b.angularVelocity.lengthSq() < this.sleepAngular * this.sleepAngular) {
        b.sleepTimer += dt;
        if (b.sleepTimer > this.sleepTime && b.awake) b.sleep();
      } else b.sleepTimer = 0;
    }

    this.stats.bodies = this.bodies.length;
    this.stats.contacts = this.contacts.length;
    this.stats.awake = awakeCount;
    this.stats.ms = performance.now() - t0;
  }

  /* ── broadphase ────────────────────────────────────────────────────── */

  _hash(ix, iy, iz) { return ix * 73856093 ^ iy * 19349663 ^ iz * 83492791; }

  _buildGrid() {
    this._grid.clear();
    const cs = this.cellSize;
    for (const b of this.bodies) {
      if (b.static) continue;
      const x0 = Math.floor(b.aabbMin.x / cs), x1 = Math.floor(b.aabbMax.x / cs);
      const y0 = Math.floor(b.aabbMin.y / cs), y1 = Math.floor(b.aabbMax.y / cs);
      const z0 = Math.floor(b.aabbMin.z / cs), z1 = Math.floor(b.aabbMax.z / cs);
      // A body that has been flung somewhere absurd would otherwise ask for
      // billions of cells and hang the frame it is about to be culled on.
      if (!((x1 - x0) < 64 && (y1 - y0) < 64 && (z1 - z0) < 64)) continue;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const h = this._hash(x, y, z);
        let arr = this._grid.get(h);
        if (!arr) { arr = []; this._grid.set(h, arr); }
        arr.push(b);
      }
    }
  }

  /* ── narrowphase ───────────────────────────────────────────────────── */

  _collectContacts(invDt) {
    const seen = new Set();
    for (const cell of this._grid.values()) {
      const n = cell.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const A = cell[i], B = cell[j];
          if (!A.awake && !B.awake) continue;
          if (A.invMass === 0 && B.invMass === 0) continue;
          if (!(A.layer & B.mask) || !(B.layer & A.mask)) continue;
          const pk = A.id < B.id ? A.id * 100000 + B.id : B.id * 100000 + A.id;
          if (seen.has(pk)) continue;
          seen.add(pk);
          const dsq = A.position.distanceToSquared(B.position);
          const rr = A.boundingRadius + B.boundingRadius;
          if (dsq > rr * rr) continue;
          this._pairContacts(A, B, invDt);
        }
      }
    }
    // world geometry
    for (const b of this.bodies) {
      if (b.static || !b.awake) continue;
      if (!(b.mask & LAYER.WORLD)) continue;
      this._worldContacts(b, invDt);
    }
  }

  _pairContacts(A, B, invDt) {
    const sa = A.spheres, sb = B.spheres;
    for (let i = 0; i < sa.length; i++) {
      A.sphereWorld(i, _v1);
      const ra = sa[i].r;
      for (let j = 0; j < sb.length; j++) {
        B.sphereWorld(j, _v2);
        const rb = sb[j].r;
        const sum = ra + rb;
        _v3.subVectors(_v2, _v1);
        const d2 = _v3.lengthSq();
        if (d2 >= sum * sum || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        _v3.multiplyScalar(1 / d);
        const depth = sum - d;
        // contact point on the mid-surface
        _v4.copy(_v1).addScaledVector(_v3, ra - depth * 0.5);
        const c = this._contact();
        c.a = A; c.b = B; c.staticNormal = null;
        c.normal.copy(_v3);
        c.point.copy(_v4);
        c.depth = depth;
        c.friction = Math.sqrt(A.friction * B.friction);
        c.restitution = Math.max(A.restitution, B.restitution);
        c.key = (A.id * 1000003 + B.id) * 64 + i * 8 + j;
        this._prepare(c, invDt);
        this.contacts.push(c);
        A.wake(); B.wake();
        if (A.onContact) A.onContact(B, c);
        if (B.onContact) B.onContact(A, c);
      }
    }
  }

  _worldContacts(b, invDt) {
    const terrain = this.terrain;
    for (let i = 0; i < b.spheres.length; i++) {
      b.sphereWorld(i, _v1);
      const r = b.spheres[i].r;

      if (terrain) {
        const h = terrain.height(_v1.x, _v1.z);
        if (_v1.y - r < h) {
          terrain.normalAt(_v1.x, _v1.z, _v2);
          const depth = h + r - _v1.y;
          const c = this._contact();
          c.a = b; c.b = null;
          c.normal.copy(_v2).negate();          // normal from body → world
          c.point.copy(_v1).addScaledVector(_v2, -r);
          c.depth = depth * Math.max(0.35, _v2.y);
          c.friction = b.friction * (terrain.friction ?? 0.9);
          c.restitution = b.restitution * 0.5;
          c.key = b.id * 991 + i * 7 + 3;
          this._prepare(c, invDt);
          this.contacts.push(c);
          if (b.onContact) b.onContact(null, c);
        }
      }

      for (let k = 0; k < this.staticBoxes.length; k++) {
        const box = this.staticBoxes[k];
        if (box.disabled) continue;
        if (_v1.distanceToSquared(box.center) > (box.radius + r) * (box.radius + r)) continue;
        // closest point on OBB
        _v2.subVectors(_v1, box.center).applyQuaternion(box.invQuat);
        const cx = Math.max(-box.halfExtents.x, Math.min(box.halfExtents.x, _v2.x));
        const cy = Math.max(-box.halfExtents.y, Math.min(box.halfExtents.y, _v2.y));
        const cz = Math.max(-box.halfExtents.z, Math.min(box.halfExtents.z, _v2.z));
        _v3.set(cx, cy, cz);
        _v4.subVectors(_v2, _v3);
        let d2 = _v4.lengthSq();
        let inside = false;
        if (d2 < 1e-10) {
          // centre inside: push out along the least-penetrating axis
          inside = true;
          const dx = box.halfExtents.x - Math.abs(_v2.x);
          const dy = box.halfExtents.y - Math.abs(_v2.y);
          const dz = box.halfExtents.z - Math.abs(_v2.z);
          if (dx <= dy && dx <= dz) _v4.set(Math.sign(_v2.x) || 1, 0, 0), d2 = dx * dx;
          else if (dy <= dz) _v4.set(0, Math.sign(_v2.y) || 1, 0), d2 = dy * dy;
          else _v4.set(0, 0, Math.sign(_v2.z) || 1), d2 = dz * dz;
        } else if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        const depth = inside ? r + d : r - d;
        // Only the outside case needs normalising: in the inside case _v4 is
        // ALREADY a unit axis, and d is the distance to the nearest face — so
        // dividing by it scaled the contact normal by up to 1e6 and turned a
        // body that had ended up inside a wall into a 1e23 m/s projectile.
        if (!inside) _v4.multiplyScalar(1 / Math.max(d, 1e-6));   // local outward normal
        _v5.copy(_v4).applyQuaternion(box.quat);      // world outward normal
        const c = this._contact();
        c.a = b; c.b = null;
        c.normal.copy(_v5).negate();
        c.point.copy(_v1).addScaledVector(_v5, -r);
        c.depth = depth;
        c.friction = Math.sqrt(b.friction * (box.friction ?? 0.6));
        c.restitution = Math.max(b.restitution, box.restitution ?? 0.02);
        c.key = b.id * 7919 + k * 31 + i;
        this._prepare(c, invDt);
        this.contacts.push(c);
        if (b.onContact) b.onContact(null, c);
        if (box.onContact) box.onContact(b, c);
      }
    }
  }

  _prepare(c, invDt) {
    const A = c.a, B = c.b;
    c.rA.subVectors(c.point, A.position);
    if (B) c.rB.subVectors(c.point, B.position);

    const n = c.normal;
    // normal effective mass
    let k = A.invMass + (B ? B.invMass : 0);
    _v5.copy(c.rA).cross(n).applyMatrix3(A.invInertiaWorld).cross(c.rA);
    k += _v5.dot(n);
    if (B) { _v5.copy(c.rB).cross(n).applyMatrix3(B.invInertiaWorld).cross(c.rB); k += _v5.dot(n); }
    c.normalMass = k > 1e-9 ? 1 / k : 0;

    // tangent basis
    if (Math.abs(n.x) > 0.57735) _v6.set(n.y, -n.x, 0); else _v6.set(0, n.z, -n.y);
    c.t1.copy(_v6).normalize();
    c.t2.crossVectors(n, c.t1).normalize();

    for (const [t, key] of [[c.t1, 't1'], [c.t2, 't2']]) {
      let kt = A.invMass + (B ? B.invMass : 0);
      _v5.copy(c.rA).cross(t).applyMatrix3(A.invInertiaWorld).cross(c.rA);
      kt += _v5.dot(t);
      if (B) { _v5.copy(c.rB).cross(t).applyMatrix3(B.invInertiaWorld).cross(c.rB); kt += _v5.dot(t); }
      if (key === 't1') c.tangentMass1 = kt > 1e-9 ? 1 / kt : 0;
      else c.tangentMass2 = kt > 1e-9 ? 1 / kt : 0;
    }

    // positional bias (Baumgarte) + restitution target
    const pen = Math.max(0, c.depth - this.slop);
    c.bias = -this.baumgarte * invDt * Math.min(pen, this.maxCorrection);

    // relative normal velocity for restitution
    A.velocityAt(c.point, _v5);
    if (B) { B.velocityAt(c.point, _v6); _v5.subVectors(_v6, _v5); } else _v5.negate();
    const vn = _v5.dot(n);
    if (vn < -1.4 && c.restitution > 0.001) c.bias += c.restitution * vn;

    c.normalImpulse = 0; c.tangent1Impulse = 0; c.tangent2Impulse = 0;
  }

  _applyPair(c, impulse) {
    const A = c.a, B = c.b;
    if (A.invMass > 0) {
      A.velocity.addScaledVector(impulse, -A.invMass);
      _v2.copy(c.rA).cross(impulse).applyMatrix3(A.invInertiaWorld);
      A.angularVelocity.sub(_v2);
    }
    if (B && B.invMass > 0) {
      B.velocity.addScaledVector(impulse, B.invMass);
      _v2.copy(c.rB).cross(impulse).applyMatrix3(B.invInertiaWorld);
      B.angularVelocity.add(_v2);
    }
  }

  _solveContacts(useBias) {
    for (let i = 0; i < this.contacts.length; i++) {
      const c = this.contacts[i];
      const A = c.a, B = c.b;

      // normal
      A.velocityAt(c.point, _v1);
      if (B) { B.velocityAt(c.point, _v2); _v3.subVectors(_v2, _v1); } else _v3.copy(_v1).negate();
      let vn = _v3.dot(c.normal);
      let lambda = -c.normalMass * (vn + (useBias ? c.bias : 0));
      const oldN = c.normalImpulse;
      c.normalImpulse = Math.max(0, oldN + lambda);
      lambda = c.normalImpulse - oldN;
      if (lambda !== 0) { _v4.copy(c.normal).multiplyScalar(lambda); this._applyPair(c, _v4); }

      // friction
      const maxF = c.friction * c.normalImpulse;
      A.velocityAt(c.point, _v1);
      if (B) { B.velocityAt(c.point, _v2); _v3.subVectors(_v2, _v1); } else _v3.copy(_v1).negate();

      let l1 = -c.tangentMass1 * _v3.dot(c.t1);
      const o1 = c.tangent1Impulse;
      c.tangent1Impulse = Math.max(-maxF, Math.min(maxF, o1 + l1));
      l1 = c.tangent1Impulse - o1;

      let l2 = -c.tangentMass2 * _v3.dot(c.t2);
      const o2 = c.tangent2Impulse;
      c.tangent2Impulse = Math.max(-maxF, Math.min(maxF, o2 + l2));
      l2 = c.tangent2Impulse - o2;

      if (l1 !== 0 || l2 !== 0) {
        _v4.copy(c.t1).multiplyScalar(l1).addScaledVector(c.t2, l2);
        this._applyPair(c, _v4);
      }
    }
  }

  /* ── joints ────────────────────────────────────────────────────────── */

  _solveJoints(dt, invDt, first) {
    for (let i = this.joints.length - 1; i >= 0; i--) {
      const j = this.joints[i];
      if (j.broken) { this.joints.splice(i, 1); continue; }
      const A = j.a, B = j.b;
      if (A.dead || B.dead) { this.joints.splice(i, 1); continue; }
      if (!A.awake && !B.awake) continue;
      A.wake(); B.wake();

      // --- point-to-point ---
      _v1.copy(j.anchorA).applyQuaternion(A.quaternion);
      _v2.copy(j.anchorB).applyQuaternion(B.quaternion);
      _v3.copy(A.position).add(_v1);      // world anchor A
      _v4.copy(B.position).add(_v2);      // world anchor B
      _v5.subVectors(_v4, _v3);           // error
      const errLen = _v5.length();

      // relative velocity at anchors
      _v6.copy(B.angularVelocity).cross(_v2).add(B.velocity);
      const relx = _v6.x, rely = _v6.y, relz = _v6.z;
      _v6.copy(A.angularVelocity).cross(_v1).add(A.velocity);
      _v6.set(relx - _v6.x, rely - _v6.y, relz - _v6.z);

      // effective mass along each axis (diagonal approximation is stable enough
      // at 8 iterations and far cheaper than the full 3×3 inverse)
      for (let axis = 0; axis < 3; axis++) {
        _v2.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
        _v3.copy(j.anchorA).applyQuaternion(A.quaternion);
        _v4.copy(j.anchorB).applyQuaternion(B.quaternion);
        let k = A.invMass + B.invMass;
        _v1.copy(_v3).cross(_v2).applyMatrix3(A.invInertiaWorld).cross(_v3); k += _v1.dot(_v2);
        _v1.copy(_v4).cross(_v2).applyMatrix3(B.invInertiaWorld).cross(_v4); k += _v1.dot(_v2);
        if (k < 1e-9) continue;
        // The error points from anchorA to anchorB, so the bias must be
        // POSITIVE: solving relVel → -bias drives B back toward A. Negating it
        // here feeds the error back on itself and the joint flies apart.
        const bias = 0.32 * invDt * _v5.getComponent(axis) * (j.softness > 0 ? (1 - j.softness) : 1);
        const lambda = -(_v6.getComponent(axis) + bias) / k;
        _v1.copy(_v2).multiplyScalar(lambda);
        if (A.invMass > 0) {
          A.velocity.addScaledVector(_v1, -A.invMass);
          _v2.copy(_v3).cross(_v1).applyMatrix3(A.invInertiaWorld);
          A.angularVelocity.sub(_v2);
        }
        if (B.invMass > 0) {
          B.velocity.addScaledVector(_v1, B.invMass);
          _v2.copy(_v4).cross(_v1).applyMatrix3(B.invInertiaWorld);
          B.angularVelocity.add(_v2);
        }
        _v6.setComponent(axis, _v6.getComponent(axis) + lambda * k);
      }

      if (errLen > 0.6 && j.breakImpulse !== Infinity) j.broken = true;

      // --- angular: cone limit + motor ---
      this._solveJointAngular(j, dt, invDt);
    }
  }

  _solveJointAngular(j, dt, invDt) {
    const A = j.a, B = j.b;

    // cone limit: B's local -Y (its bone direction) must stay inside a cone
    // around coneAxis expressed in A's frame.
    _v1.copy(j.coneAxis).applyQuaternion(A.quaternion).normalize();   // world cone axis
    _v2.set(0, -1, 0).applyQuaternion(B.quaternion).normalize();      // world bone dir
    const cosLimit = Math.cos(j.coneAngle);
    const dot = _v1.dot(_v2);
    if (dot < cosLimit) {
      // rotate B back toward the cone surface
      _v3.crossVectors(_v2, _v1);
      const s = _v3.length();
      if (s > 1e-5) {
        _v3.multiplyScalar(1 / s);
        const excess = Math.acos(Math.max(-1, Math.min(1, dot))) - j.coneAngle;
        // angular velocity error along the correction axis
        _v4.subVectors(B.angularVelocity, A.angularVelocity);
        const wErr = _v4.dot(_v3);
        let k = 0;
        _v5.copy(_v3).applyMatrix3(A.invInertiaWorld); k += _v5.dot(_v3);
        _v5.copy(_v3).applyMatrix3(B.invInertiaWorld); k += _v5.dot(_v3);
        if (k > 1e-9) {
          const bias = -0.4 * invDt * excess;
          const lambda = -(wErr + bias) / k;
          if (lambda > 0) {
            _v5.copy(_v3).multiplyScalar(lambda);
            if (A.invMass > 0) A.angularVelocity.sub(_v6.copy(_v5).applyMatrix3(A.invInertiaWorld));
            if (B.invMass > 0) B.angularVelocity.add(_v6.copy(_v5).applyMatrix3(B.invInertiaWorld));
          }
        }
      }
    }

    // motor: drive B's orientation toward restQuat relative to A
    if (j.stiffness > 0) {
      _q1.copy(A.quaternion).multiply(j.restQuat);          // desired world quat of B
      const cur = B.quaternion;
      let dq = _q1.clone().multiply(new THREE.Quaternion(-cur.x, -cur.y, -cur.z, cur.w));
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const sLen = Math.sqrt(dq.x * dq.x + dq.y * dq.y + dq.z * dq.z);
      if (sLen > 1e-6) {
        const angle = 2 * Math.atan2(sLen, dq.w);
        _v1.set(dq.x / sLen, dq.y / sLen, dq.z / sLen);
        _v2.subVectors(B.angularVelocity, A.angularVelocity);
        const target = _v1.clone().multiplyScalar(angle * j.stiffness);
        _v3.subVectors(target, _v2).multiplyScalar(j.damping);
        if (B.invMass > 0) B.angularVelocity.add(_v3);
        if (A.invMass > 0) A.angularVelocity.addScaledVector(_v3, -0.35);
      }
    }
  }

  /* ── queries ───────────────────────────────────────────────────────── */

  /**
   * Ray query against bodies, static boxes and terrain.
   * @returns {{body:Body|null, point:THREE.Vector3, normal:THREE.Vector3, distance:number, box:object|null}|null}
   */
  raycast(origin, dir, maxDist = 200, filter = null) {
    let best = null, bestT = maxDist;
    const d = _v1.copy(dir).normalize();

    for (const b of this.bodies) {
      if (filter && !filter(b)) continue;
      for (let i = 0; i < b.spheres.length; i++) {
        b.sphereWorld(i, _v2);
        const r = b.spheres[i].r;
        _v3.subVectors(_v2, origin);
        const tca = _v3.dot(d);
        if (tca < -r) continue;
        const d2 = _v3.lengthSq() - tca * tca;
        if (d2 > r * r) continue;
        const thc = Math.sqrt(r * r - d2);
        let t = tca - thc;
        if (t < 0) t = tca + thc;
        if (t < 0 || t >= bestT) continue;
        bestT = t;
        best = best || { body: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, box: null };
        best.body = b; best.box = null; best.distance = t;
        best.point.copy(origin).addScaledVector(d, t);
        best.normal.subVectors(best.point, _v2).normalize();
      }
    }

    for (const box of this.staticBoxes) {
      if (box.disabled) continue;
      const t = rayOBB(origin, d, box, _v4, _v5);
      if (t !== null && t < bestT && t >= 0) {
        bestT = t;
        best = best || { body: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, box: null };
        best.body = null; best.box = box; best.distance = t;
        best.point.copy(_v4); best.normal.copy(_v5);
      }
    }

    if (this.terrain) {
      const t = this.terrain.raycast(origin, d, Math.min(bestT, maxDist), _v4, _v5);
      if (t !== null && t < bestT) {
        bestT = t;
        best = best || { body: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, box: null };
        best.body = null; best.box = null; best.terrain = true; best.distance = t;
        best.point.copy(_v4); best.normal.copy(_v5);
      }
    }
    return best;
  }

  /** All bodies whose bounding sphere overlaps a world sphere. */
  querySphere(center, radius, out = []) {
    out.length = 0;
    for (const b of this.bodies) {
      if (b.static) continue;
      const rr = radius + b.boundingRadius;
      if (b.position.distanceToSquared(center) <= rr * rr) out.push(b);
    }
    return out;
  }

  addStaticBox(center, halfExtents, quat = new THREE.Quaternion(), opts = {}) {
    const box = {
      center: center.clone(),
      halfExtents: halfExtents.clone(),
      quat: quat.clone(),
      invQuat: quat.clone().invert(),
      radius: halfExtents.length(),
      friction: opts.friction ?? 0.7,
      restitution: opts.restitution ?? 0.02,
      userData: opts.userData || {},
      disabled: false,
      onContact: opts.onContact || null,
    };
    this.staticBoxes.push(box);
    return box;
  }

  removeStaticBox(box) {
    const i = this.staticBoxes.indexOf(box);
    if (i >= 0) this.staticBoxes.splice(i, 1);
  }

  clear() {
    this.bodies.length = 0;
    this.joints.length = 0;
    this.staticBoxes.length = 0;
    this._warm.clear();
    this._grid.clear();
  }
}

/* ── ray vs oriented box ─────────────────────────────────────────────── */
const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
export function rayOBB(origin, dir, box, outPoint, outNormal) {
  _ro.subVectors(origin, box.center).applyQuaternion(box.invQuat);
  _rd.copy(dir).applyQuaternion(box.invQuat);
  let tmin = -Infinity, tmax = Infinity, hitAxis = 0, hitSign = 1;
  const h = box.halfExtents;
  for (let a = 0; a < 3; a++) {
    const o = _ro.getComponent(a), dcomp = _rd.getComponent(a), he = h.getComponent(a);
    if (Math.abs(dcomp) < 1e-8) { if (o < -he || o > he) return null; continue; }
    const inv = 1 / dcomp;
    let t1 = (-he - o) * inv, t2 = (he - o) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; hitAxis = a; hitSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  const t = tmin >= 0 ? tmin : tmax;
  if (t < 0) return null;
  outPoint.copy(origin).addScaledVector(dir, t);
  outNormal.set(0, 0, 0).setComponent(hitAxis, hitSign).applyQuaternion(box.quat);
  return t;
}

/** Closest points between two segments — used by the blade sweep tests. */
export function segmentSegment(p1, q1, p2, q2, outA, outB) {
  const d1 = _v1.subVectors(q1, p1);
  const d2 = _v2.subVectors(q2, p2);
  const r = _v3.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  outA.copy(p1).addScaledVector(d1, s);
  outB.copy(p2).addScaledVector(d2, t);
  return { s, t, distSq: outA.distanceToSquared(outB) };
}
