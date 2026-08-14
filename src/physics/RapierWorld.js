/**
 * SABER — the world, on Rapier.
 *
 * The bespoke solver in Physics.js approximates every collider as a cluster of
 * spheres. That bought one narrowphase routine and — the reason it was chosen —
 * the ability to rebuild a body's collider at runtime when a lightsaber takes
 * part of it away. It cost everything else: a crate is eight spheres, so it
 * rolls when it should tip, stacks slide apart, a wall is a lumpy approximation
 * of a wall, an arbitrary mesh cannot be a collider at all, and nothing has
 * continuous collision detection so anything fast tunnels.
 *
 * This module puts the WORLD — terrain, architecture, props, debris, anything
 * you throw — onto Rapier, with colliders that are the shape the thing looks
 * like: cuboids for boxes, cylinders for drums and columns, convex hulls built
 * from the actual vertex data for irregular meshes, and compound colliders for
 * props made of several parts.
 *
 * ── one solver ────────────────────────────────────────────────────────────
 *
 * Ragdolls and severed limbs used to stay on the sphere solver, because cutting
 * a limb rebuilds that limb's collider mid-flight and spheres made that
 * trivial. The cost was that the two solvers could not see each other: a corpse
 * would not knock a crate over and a hurled crate went straight through a
 * corpse. They are on Rapier now — capsule colliders per bone, a spherical
 * joint per articulation (see RagdollJoint) — and a limb's collider is rebuilt
 * with `Body.setShape`, which swaps the capsule for a shorter one in place.
 * There is one world, one broadphase, and everything collides with everything.
 *
 * ── the API ───────────────────────────────────────────────────────────────
 *
 * Deliberately the same as PhysicsWorld's: add / remove / step / raycast /
 * addStaticBox / bodies / staticBoxes / terrain, and a Body whose .position,
 * .quaternion, .velocity and .angularVelocity read and write the way they
 * always did. Call sites changed one import line and gained a `shape:`.
 *
 * Reads and writes are cached on the JS side and reconciled once per step —
 * pushed into Rapier before it runs, pulled back after — so gameplay code can
 * keep doing `b.angularVelocity.y += x` in place, and so we cross the WASM
 * boundary a bounded number of times per body per frame rather than once per
 * property access.
 */

import * as THREE from 'three';
import { rapier } from './Rapier.js';
import { LAYER, boxSpheres, capsuleSpheres } from './Physics.js';

export { LAYER, boxSpheres, capsuleSpheres };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _box = new THREE.Box3();
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _js = new THREE.Vector3();

let _bodyId = 1;

/**
 * LAYER/mask → Rapier collision groups. Rapier packs a 16-bit membership in the
 * high half and a 16-bit filter in the low half, and two colliders interact iff
 * `(A.memberships & B.filter) && (B.memberships & A.filter)` — which is exactly
 * `(A.layer & B.mask) && (B.layer & A.mask)`, the rule the sphere solver used.
 */
export function collisionGroups(layer, mask) {
  return ((layer & 0xffff) << 16 >>> 0) | (mask & 0xffff);
}

/**
 * Self-exclusion groups — the spare bits above LAYER.
 *
 * A body may take one of these eight bits. Two bodies holding the SAME bit
 * never touch, and taking a bit also means the body stops seeing LAYER.RAGDOLL
 * wholesale: it sees the other seven bits instead.
 *
 * That is how one corpse ignores its own bones while two corpses still pile up
 * on each other. A ragdoll's bones overlap by a whole radius wherever they
 * share a socket, and the two thighs or the two clavicles overlap nearly as
 * much without sharing a joint at all, so left colliding a corpse spends
 * forever shoving itself apart — measured on a B1 face down on flat ground:
 * 3.0 rad/s of residual spin that never decays, against 0.55 with this on.
 * `layer` itself stays exactly LAYER.RAGDOLL, because gameplay compares
 * against it by equality.
 */
export const SELF_GROUPS = 8;
const SELF_BIT0 = 6;
const SELF_ALL = (((1 << SELF_GROUPS) - 1) << SELF_BIT0) >>> 0;
/** The i-th self-exclusion bit; callers just count up. */
export const selfGroup = (i) => 1 << (SELF_BIT0 + (((i % SELF_GROUPS) + SELF_GROUPS) % SELF_GROUPS));

/* ══════════════════════════════════════════════════════════════════════ */
/*  Shapes                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

export const box = (hx, hy, hz) => ({ type: 'box', hx, hy, hz });
export const ball = (radius) => ({ type: 'ball', radius });
export const cylinder = (halfHeight, radius) => ({ type: 'cylinder', halfHeight, radius });
export const capsule = (halfHeight, radius) => ({ type: 'capsule', halfHeight, radius });
export const hull = (points) => ({ type: 'hull', points });
/** parts: [{ ...shape, at?:Vector3|[x,y,z], quat?:Quaternion }] */
export const compound = (parts) => ({ type: 'compound', parts });

/**
 * A convex hull from real geometry. Vertices are quantised to a millimetre to
 * collapse the duplicates a merged, per-face-normal geometry is full of, then
 * capped — a hull is decided by its extreme points, so a stride through the
 * survivors plus the six axis extremes describes the same solid as all 4000 of
 * them and builds in microseconds instead of milliseconds.
 */
export function hullFromGeometry(geo, opts = {}) {
  const pos = geo?.attributes?.position;
  if (!pos || pos.count < 4) return null;
  const q = opts.quantise ?? 0.001, inv = 1 / q;
  const seen = new Set();
  const xs = [];
  // extremes, so the cap can never shrink the shape
  let ext = null;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    const kx = Math.round(x * inv), ky = Math.round(y * inv), kz = Math.round(z * inv);
    const key = kx + ',' + ky + ',' + kz;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = [kx * q, ky * q, kz * q];
    xs.push(p);
    if (!ext) ext = [p, p, p, p, p, p];
    else {
      if (p[0] < ext[0][0]) ext[0] = p; if (p[0] > ext[1][0]) ext[1] = p;
      if (p[1] < ext[2][1]) ext[2] = p; if (p[1] > ext[3][1]) ext[3] = p;
      if (p[2] < ext[4][2]) ext[4] = p; if (p[2] > ext[5][2]) ext[5] = p;
    }
  }
  if (xs.length < 4) return null;

  const cap = opts.maxPoints ?? 600;
  let keep = xs;
  if (xs.length > cap) {
    const stride = Math.ceil(xs.length / cap);
    keep = [];
    for (let i = 0; i < xs.length; i += stride) keep.push(xs[i]);
    for (const e of ext) keep.push(e);
  }
  const out = new Float32Array(keep.length * 3);
  for (let i = 0; i < keep.length; i++) {
    out[i * 3] = keep[i][0]; out[i * 3 + 1] = keep[i][1]; out[i * 3 + 2] = keep[i][2];
  }
  return { type: 'hull', points: out };
}

/**
 * The bounding box of an Object3D subtree as a cuboid, expressed relative to
 * `origin` (the body's position) so it can be attached to a rigid body there.
 */
export function boxFromObject(obj, origin = null) {
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  if (!isFinite(_box.min.x) || _box.isEmpty()) return null;
  _box.getSize(_v1);
  _box.getCenter(_v2);
  if (origin) _v2.sub(origin);
  const s = box(Math.max(0.02, _v1.x / 2), Math.max(0.02, _v1.y / 2), Math.max(0.02, _v1.z / 2));
  if (_v2.lengthSq() > 1e-8) s.at = _v2.clone();
  return s;
}

/** Half-extents of a shape's local AABB — used for blade proxies and culling. */
function shapeExtent(s, out = new THREE.Vector3()) {
  switch (s.type) {
    case 'box': return out.set(s.hx, s.hy, s.hz);
    case 'ball': return out.set(s.radius, s.radius, s.radius);
    case 'cylinder': return out.set(s.radius, s.halfHeight, s.radius);
    case 'capsule': return out.set(s.radius, s.halfHeight + s.radius, s.radius);
    case 'hull': {
      let mx = 0, my = 0, mz = 0;
      const p = s.points;
      for (let i = 0; i < p.length; i += 3) {
        mx = Math.max(mx, Math.abs(p[i])); my = Math.max(my, Math.abs(p[i + 1])); mz = Math.max(mz, Math.abs(p[i + 2]));
      }
      return out.set(mx, my, mz);
    }
    case 'compound': {
      let mx = 0, my = 0, mz = 0;
      for (const part of s.parts) {
        shapeExtent(part, _v3);
        const at = part.at ? (Array.isArray(part.at) ? part.at : [part.at.x, part.at.y, part.at.z]) : [0, 0, 0];
        mx = Math.max(mx, Math.abs(at[0]) + _v3.x);
        my = Math.max(my, Math.abs(at[1]) + _v3.y);
        mz = Math.max(mz, Math.abs(at[2]) + _v3.z);
      }
      return out.set(mx, my, mz);
    }
    default: return out.set(0.5, 0.5, 0.5);
  }
}

/**
 * Spheres the BLADE tests against. Since Rapier owns collision, these no longer
 * decide how anything bounces — they are only the target proxy the blade
 * contact solver walks, which still speaks in capsules. Laid along the longest
 * axis of the shape's box, the same way Slice.js does it for a mesh.
 */
function bladeSpheresFor(shape, max = 8) {
  const e = shapeExtent(shape, new THREE.Vector3());
  const r = Math.max(0.02, Math.min(e.x, e.y, e.z));
  if (max <= 1 || (e.x < r * 1.2 && e.y < r * 1.2 && e.z < r * 1.2)) {
    return [{ c: new THREE.Vector3(), r: Math.max(r, e.length() * 0.56) }];
  }
  const axis = e.x > e.y && e.x > e.z ? 'x' : (e.y > e.z ? 'y' : 'z');
  const half = e[axis];
  const n = Math.max(2, Math.min(max, Math.round(half * 2 / (r * 1.5))));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const c = new THREE.Vector3();
    c[axis] = -half + r + t * Math.max(0, half * 2 - r * 2);
    out.push({ c, r });
  }
  return out;
}

/* ── shape → Rapier collider descriptors ─────────────────────────────── */

function descFor(R, s) {
  switch (s.type) {
    case 'box': return R.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
    case 'ball': return R.ColliderDesc.ball(s.radius);
    case 'cylinder': return R.ColliderDesc.cylinder(s.halfHeight, s.radius);
    case 'capsule': return R.ColliderDesc.capsule(s.halfHeight, s.radius);
    case 'hull': {
      const d = R.ColliderDesc.convexHull(s.points);
      if (d) return d;
      // A degenerate point cloud (coplanar slice, a sliver of a sliver) has no
      // hull. Fall back to its box rather than dropping the collider, which
      // would leave a visible chunk of debris with nothing under it.
      shapeExtent(s, _v1);
      return R.ColliderDesc.cuboid(Math.max(0.02, _v1.x), Math.max(0.02, _v1.y), Math.max(0.02, _v1.z));
    }
    default: return R.ColliderDesc.ball(0.3);
  }
}

const _dp = new THREE.Vector3(), _dq = new THREE.Quaternion();

/**
 * Flatten a (possibly nested) compound into collider descriptors, composing the
 * offsets on the way down — Rapier attaches every collider straight to the body,
 * so a part two levels deep has to arrive with its parent's transform baked in.
 */
function descsFor(R, s, out = [], pos = null, quat = null) {
  const at = s.at ? (Array.isArray(s.at) ? _dp.set(s.at[0], s.at[1], s.at[2]) : _dp.copy(s.at)) : _dp.set(0, 0, 0);
  const rot = s.quat ? _dq.copy(s.quat) : _dq.identity();
  if (quat) at.applyQuaternion(quat);
  if (pos) at.add(pos);
  if (quat) rot.premultiply(quat);
  const p = at.clone(), q = rot.clone();

  if (s.type === 'compound') {
    for (const part of s.parts) descsFor(R, part, out, p, q);
    return out;
  }
  const d = descFor(R, s);
  if (p.lengthSq() > 1e-12) d.setTranslation(p.x, p.y, p.z);
  if (Math.abs(q.w) < 0.999999) d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  out.push(d);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Body                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A rigid body. Constructed free-standing — no Rapier objects exist until the
 * world adopts it — so a call site can still write `const b = new Body({...});
 * world.physics.add(b)`, and so the headless tests that stub `physics` out
 * entirely keep working.
 */
export class Body {
  constructor(opts = {}) {
    this.id = _bodyId++;
    /** Tells a Physics.js Body apart from this one, so add() can refuse it. */
    this.isRapier = true;
    this.position = opts.position ? opts.position.clone() : new THREE.Vector3();
    this.quaternion = opts.quaternion ? opts.quaternion.clone() : new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();

    this.shape = opts.shape || shapeFromSpheres(opts.spheres) || box(0.3, 0.3, 0.3);

    this.mass = opts.mass ?? 1;
    this.static = !!opts.static || this.mass <= 0;
    this.kinematic = !!opts.kinematic && !this.static;
    if (this.static) this.mass = 0;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;

    this.friction = opts.friction ?? 0.55;
    this.restitution = opts.restitution ?? 0.05;
    this.linearDamping = opts.linearDamping ?? 0.02;
    this.angularDamping = opts.angularDamping ?? 0.06;
    this.gravityScale = opts.gravityScale ?? 1;
    /**
     * Rolling friction about a round collider's own axis, per second.
     *
     * Measured in Rapier 0.14: a capsule resting on flat ground spins UP to
     * ~1.08 rad/s about its axis of symmetry from a standing start and stays
     * there — with any friction, any restitution, either solver, warm-started
     * or not, and any amount of angular damping. A cylinder and a ball do the
     * same; a cuboid or a round cuboid in the same test is asleep by step 130.
     * The spin is nearly invisible on an axisymmetric limb but it is loud in
     * the profile, because an island holding one spinning capsule never sleeps
     * — which is a whole corpse, forever.
     *
     * So a capsule loses spin about its own length. That is rolling friction,
     * which a real limb has and a mathematical capsule does not, and it is not
     * applied to anything that ought to roll: a drum is a cylinder, and its own
     * axis is exactly the axis it rolls on.
     */
    this.spinFriction = opts.spinFriction ?? (this.shape.type === 'capsule' ? 6 : 0);
    this.ccd = opts.ccd !== false;
    /**
     * Soft CCD prediction distance, in metres.
     *
     * Rapier's ordinary CCD sweeps a body against convex colliders and stops it
     * dead — measured: a 12 cm box at 360 m/s is caught by a 4 cm wall. It does
     * NOT do that against a heightfield. Measured on a flat heightfield, a body
     * arriving faster than about 12 m/s — a three metre fall — goes straight
     * through with CCD on, and 45% of a level's debris ends up under the map.
     * Soft CCD (speculative contacts extended along the velocity) does catch it,
     * at 4 m covering 240 m/s per 1/60 s frame, and it costs nothing at rest
     * because the prediction is capped by how far the body is actually going.
     */
    this.softCcd = opts.softCcd ?? 4;

    this.layer = opts.layer ?? LAYER.DEBRIS;
    this.mask = opts.mask ?? LAYER.ALL;
    /** One bit from `selfGroup(i)`, or 0. See SELF_GROUPS. */
    this.selfGroup = opts.selfGroup ?? 0;
    this.userData = opts.userData || {};
    this.onContact = opts.onContact || null;

    /**
     * Solver passes this body asks for on top of the world's.
     *
     * A crate needs four; a ragdoll is nineteen capsules in one island, joined
     * end to end and lying on each other, and four is not enough to get it to
     * rest — measured over 21 drops of a B1 from 1–3m, four extra passes on the
     * bones take the number that settle inside thirty seconds from 12/21 to
     * 17/21 and the median from 24.2s to 19.8s. Rapier charges it per island,
     * so nothing else in the level pays for it.
     */
    this.solverIterations = opts.solverIterations ?? 0;
    /**
     * Multiplier on the inertia the collider implies, mass unchanged.
     *
     * A limb is not the uniform capsule its collider is, and a corpse made of
     * uniform capsules will not lie still: measured over eleven drops of a
     * 52 kg B1, one settles inside thirty seconds at the collider's own
     * inertia and NINE do at three times it, with the median falling from
     * beyond fifty seconds to 13.2. Rotational inertia is what a jointed chain
     * has to resist the contact solve with, and a capsule 6cm across has almost
     * none of it.
     */
    this.inertiaScale = opts.inertiaScale ?? 1;

    this.allowSleep = opts.allowSleep !== false;
    this.awake = true;
    this.dead = false;
    this._still = 0;
    this._rp = this.position.clone();     // where it was when it went still
    this._rq = this.quaternion.clone();

    // Blade targets. Explicit `spheres` still wins, so a caller that has a
    // better idea of where a prop's mass reads can say so.
    this._ownSpheres = !opts.spheres;
    this.spheres = opts.spheres || bladeSpheresFor(this.shape);
    shapeExtent(this.shape, _v1);
    this.boundingRadius = Math.max(0.05, _v1.length());
    /**
     * The half-extents themselves, not just their length. Both call sites used
     * to compute this and keep only `boundingRadius`, which is the HALF-DIAGONAL
     * — 1.73x the half-height of a cube. Anything that wants to know where the
     * top of a crate is (standing on one, for instance) needs the box, and
     * guessing it back out of the diagonal either floats you or sinks you.
     */
    this.extent = _v1.clone();

    // Rapier handles, filled in by RapierWorld.add
    this._world = null;      // the RapierWorld that adopted us
    this.rb = null;
    this.colliders = null;

    // shadows of what Rapier last told us, so a push only fires on a real write
    this._sp = this.position.clone();
    this._sq = this.quaternion.clone();
    this._sv = new THREE.Vector3();
    this._sw = new THREE.Vector3();
    this._sg = this.gravityScale;
    this._impulses = null;
  }

  /* ── impulses ────────────────────────────────────────────────────── */

  /**
   * Queued rather than applied straight through: gameplay may also write
   * `.velocity` in the same frame, and the write has to land first or the
   * impulse is silently overwritten by a stale cached velocity.
   */
  applyImpulse(impulse, worldPoint) {
    if (this.invMass === 0 || this.static) return;
    this.wake();
    if (!this.rb) { this.velocity.addScaledVector(impulse, this.invMass); return; }
    (this._impulses || (this._impulses = [])).push(
      impulse.x, impulse.y, impulse.z,
      worldPoint ? worldPoint.x : NaN, worldPoint ? worldPoint.y : 0, worldPoint ? worldPoint.z : 0);
  }

  applyForceImpulse(impulse) { this.applyImpulse(impulse, null); }

  applyTorqueImpulse(t) {
    if (this.invMass === 0 || this.static || !this.rb) return;
    this.wake();
    this.rb.applyTorqueImpulse({ x: t.x, y: t.y, z: t.z }, true);
  }

  velocityAt(worldPoint, out) {
    return out.copy(this.angularVelocity).cross(_v1.subVectors(worldPoint, this.position)).add(this.velocity);
  }

  wake() {
    this.awake = true;
    this._still = 0;
    this._rp.copy(this.position); this._rq.copy(this.quaternion);
    if (this.rb) this.rb.wakeUp();
  }

  sleep() {
    this.awake = false;
    this.velocity.set(0, 0, 0); this.angularVelocity.set(0, 0, 0);
    this._sv.set(0, 0, 0); this._sw.set(0, 0, 0);
    if (this.rb) this.rb.sleep();
  }

  setTransform(pos, quat) {
    if (pos) this.position.copy(pos);
    if (quat) this.quaternion.copy(quat);
    this.wake();
  }

  /* ── Rapier plumbing ─────────────────────────────────────────────── */

  _bind(world) {
    const R = world.R;
    this._world = world;
    const desc = this.static ? R.RigidBodyDesc.fixed()
      : this.kinematic ? R.RigidBodyDesc.kinematicPositionBased()
        : R.RigidBodyDesc.dynamic();
    desc.setTranslation(this.position.x, this.position.y, this.position.z)
      .setRotation({ x: this.quaternion.x, y: this.quaternion.y, z: this.quaternion.z, w: this.quaternion.w })
      .setLinearDamping(this.linearDamping)
      .setAngularDamping(this.angularDamping)
      .setGravityScale(this.gravityScale)
      .setCanSleep(this.allowSleep);
    if (this.solverIterations > 0) desc.setAdditionalSolverIterations(this.solverIterations);
    if (!this.static && !this.kinematic) {
      desc.setLinvel(this.velocity.x, this.velocity.y, this.velocity.z)
        .setAngvel({ x: this.angularVelocity.x, y: this.angularVelocity.y, z: this.angularVelocity.z });
      if (this.ccd) desc.setCcdEnabled(true);
      if (this.softCcd > 0) desc.setSoftCcdPrediction(this.softCcd);
    }
    this.rb = world.world.createRigidBody(desc);
    this._buildColliders();

    this._sp.copy(this.position); this._sq.copy(this.quaternion);
    this._sv.copy(this.velocity); this._sw.copy(this.angularVelocity);
    this._sg = this.gravityScale;
    return this;
  }

  /** Membership/filter as Rapier wants them, self-exclusion folded in. */
  groups() {
    if (!this.selfGroup) return collisionGroups(this.layer, this.mask);
    return collisionGroups(this.layer | this.selfGroup,
      (this.mask & ~LAYER.RAGDOLL) | (SELF_ALL & ~this.selfGroup));
  }

  _buildColliders() {
    const world = this._world, R = world.R;
    const groups = this.groups();
    this.colliders = [];
    for (const cd of descsFor(R, this.shape)) {
      cd.setFriction(this.friction).setRestitution(this.restitution)
        .setCollisionGroups(groups).setDensity(1);
      const c = world.world.createCollider(cd, this.rb);
      this.colliders.push(c);
      world._byCollider.set(c.handle, { body: this });
    }
    // Rapier derives mass from collider density; scale the density so the total
    // lands on the mass the caller asked for, which keeps the real inertia
    // tensor of the real shape rather than flattening it to a lump.
    if (!this.static && this.mass > 0) {
      const m0 = this.rb.mass();
      if (m0 > 1e-9) {
        const k = this.mass / m0;
        for (const c of this.colliders) c.setDensity(k);
        this.rb.recomputeMassPropertiesFromColliders();
      } else {
        this.rb.setAdditionalMass(this.mass, true);
      }
    }
    if (this.inertiaScale !== 1 && !this.static && this.mass > 0) {
      const k = this.inertiaScale - 1;
      const I = this.rb.principalInertia(), f = this.rb.principalInertiaLocalFrame();
      this.rb.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 },
        { x: I.x * k, y: I.y * k, z: I.z * k }, f, false);
    }
  }

  /**
   * Swap the collider for a different shape, in place.
   *
   * This is what the sphere solver was originally chosen for: a lightsaber
   * takes part of a limb away, and the limb's collider has to become a shorter
   * limb mid-flight. On Rapier that is "drop the old colliders, attach new
   * ones to the same rigid body" — the body keeps its handle, its velocity,
   * its joints and its place in the island, so a limb that was already falling
   * carries on falling as a shorter limb.
   */
  setShape(shape, opts = {}) {
    this.shape = shape;
    shapeExtent(shape, _v1);
    this.boundingRadius = Math.max(0.05, _v1.length());
    this.extent.copy(_v1);
    if (opts.mass > 0) { this.mass = opts.mass; this.invMass = 1 / opts.mass; }
    if (opts.spheres) this.spheres = opts.spheres;
    else if (this._ownSpheres) this.spheres = bladeSpheresFor(shape);
    if (!this.rb || !this._world) return this;
    for (const c of this.colliders) {
      this._world._byCollider.delete(c.handle);
      this._world.world.removeCollider(c, false);
    }
    // wipe the inflated inertia before the new collider adds its own share
    if (this.inertiaScale !== 1) {
      this.rb.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 }, false);
    }
    this._buildColliders();
    return this;
  }

  _unbind() {
    if (this.rb && this._world) this._world.world.removeRigidBody(this.rb);
    this.rb = null; this.colliders = null; this._world = null;
  }

  /** Cached writes → Rapier. Only fields gameplay actually touched. */
  _push() {
    const rb = this.rb;
    if (!rb) return;
    const eps = 1e-9;

    if (!this.position.equals(this._sp) || !this.quaternion.equals(this._sq)) {
      const p = this.position, q = this.quaternion;
      if (this.kinematic) {
        rb.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
        rb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      } else {
        rb.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
        rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
      this._sp.copy(p); this._sq.copy(q);
    }

    if (!this.static && !this.kinematic) {
      if (this.velocity.distanceToSquared(this._sv) > eps) {
        rb.setLinvel({ x: this.velocity.x, y: this.velocity.y, z: this.velocity.z }, true);
        this._sv.copy(this.velocity);
      }
      if (this.angularVelocity.distanceToSquared(this._sw) > eps) {
        rb.setAngvel({ x: this.angularVelocity.x, y: this.angularVelocity.y, z: this.angularVelocity.z }, true);
        this._sw.copy(this.angularVelocity);
      }
      if (this.gravityScale !== this._sg) {
        rb.setGravityScale(this.gravityScale, true);
        this._sg = this.gravityScale;
      }
      const imp = this._impulses;
      if (imp) {
        for (let i = 0; i < imp.length; i += 6) {
          if (isFinite(imp[i + 3])) {
            rb.applyImpulseAtPoint({ x: imp[i], y: imp[i + 1], z: imp[i + 2] },
              { x: imp[i + 3], y: imp[i + 4], z: imp[i + 5] }, true);
          } else {
            rb.applyImpulse({ x: imp[i], y: imp[i + 1], z: imp[i + 2] }, true);
          }
        }
        this._impulses = null;
      }
    } else if (this._impulses) this._impulses = null;
  }

  /** Rapier → cached reads. */
  _pull() {
    const rb = this.rb;
    if (!rb) return;
    const p = rb.translation(), q = rb.rotation();
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(q.x, q.y, q.z, q.w);
    this._sp.copy(this.position); this._sq.copy(this.quaternion);
    if (!this.static) {
      const v = rb.linvel(), w = rb.angvel();
      this.velocity.set(v.x, v.y, v.z);
      this.angularVelocity.set(w.x, w.y, w.z);
      this._sv.copy(this.velocity); this._sw.copy(this.angularVelocity);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Joints                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A ragdoll articulation: ball-and-socket, with a cone limit, a twist limit and
 * a motor that drives the child back toward its rest pose.
 *
 * The point-to-point half is Rapier's own spherical joint. It holds: measured
 * on a nine-link chain hit hard enough to swing it, the sockets stay 10.6 mm
 * from each other at worst, against 328 mm for the diagonal-approximation
 * sequential-impulse ball joint it replaces. On a single unloaded link both
 * score zero, which is why the old test never caught anything.
 *
 * The angular half is solved here, and that is a deliberate choice made after
 * measuring the alternative. Rapier's per-axis angular limits (a generic joint
 * with LinX|LinY|LinZ locked, `jointSetLimits` on AngX/AngY/AngZ) measure the
 * relative rotation between the two bodies' JOINT FRAMES, and `JointData` can
 * only give both bodies the SAME local frame — one `axis`, completed to a basis
 * the same way in each body. A skeleton's rest pose is not the identity: a
 * clavicle sits 90° off its chest and a thigh sits 180° off its hips, so a
 * limit centred on zero fights the pose the corpse is supposed to hold. Built
 * that way and measured on a B1: 5.25 mm anchor drift and 49.2 of residual
 * Σ|v|+|ω| after eight seconds, against 1.2 mm and 10.8 for the version below.
 * So Rapier holds the anchors and we hold the pose.
 *
 * Cone and twist are separated by a swing/twist decomposition of the child's
 * deviation from rest, which is what JOINT_LIMITS in Ragdoll.js has always
 * meant: `cone` is how far the bone may swing away from where it should point,
 * `twist` is how far it may rotate about its own length, `stiffness` is how
 * hard the joint pulls back toward the rest pose (0 = a limp severed piece).
 */
export class RagdollJoint {
  constructor(a, b, anchorA, anchorB, opts = {}) {
    this.a = a; this.b = b;
    this.anchorA = anchorA.clone();      // local to a
    this.anchorB = anchorB.clone();      // local to b
    this.broken = false;
    this.coneAngle = opts.coneAngle ?? Math.PI * 0.45;
    this.twistLimit = opts.twistLimit ?? Math.PI * 0.4;
    this.stiffness = opts.stiffness ?? 0;   // angular motor strength (0 = rag)
    this.damping = opts.damping ?? 0.25;
    /**
     * Seconds of muscle tone. The motor is what makes a body FALL like a body
     * rather than like a bag of bones, and it has to be gone by the time the
     * body has landed — a motor still pulling toward a standing pose under a
     * corpse lying on the ground is a permanent energy source, and the corpse
     * never gets under Rapier's sleep threshold. The cone and twist limits are
     * one-sided and go quiet once satisfied, so they keep holding the shape
     * long after the tone has gone.
     */
    this.relax = opts.relax ?? 2.5;
    this.age = 0;
    /** b's orientation relative to a when the skeleton is in its bind pose. */
    this.restQuat = (opts.restQuat || new THREE.Quaternion()).clone();
    this._world = null;
    this.joint = null;                      // the Rapier impulse joint
  }

  /** Motor strength right now: full at first, gone once the body has landed. */
  tone() {
    if (this.stiffness <= 0) return 0;
    if (!(this.relax > 0)) return this.stiffness;
    return this.stiffness * Math.max(0, 1 - this.age / this.relax);
  }

  _bind(world) {
    this._world = world;
    const a = this.a.rb, b = this.b.rb;
    if (!a || !b) return this;
    const data = world.R.JointData.spherical(
      { x: this.anchorA.x, y: this.anchorA.y, z: this.anchorA.z },
      { x: this.anchorB.x, y: this.anchorB.y, z: this.anchorB.z });
    this.joint = world.world.createImpulseJoint(data, a, b, true);
    // Two bones that share a socket overlap by a whole radius by construction.
    // Left colliding, that permanent penetration is a permanent contact
    // impulse, and the corpse buzzes forever instead of settling: measured
    // Σ|v|+|ω| of 176 with the pair colliding against 9.3 without.
    this.joint.setContactsEnabled(false);
    return this;
  }

  _unbind() {
    if (this.joint && this._world) this._world.world.removeImpulseJoint(this.joint, true);
    this.joint = null; this._world = null;
  }
}

/**
 * How hard a limit pulls a joint back once it is past it, in units of "close
 * the excess angle in one second", and the most it may ask for in rad/s.
 *
 * Softer than a hard stop on purpose, and softer than it needs to be: because
 * the correction is a rotation about the socket (see _spin) rather than about
 * the centre of mass, the joint keeps a limb well inside its cone at any rate
 * from 1 to 5 — measured on a shoved pendulum, peak swing is 0.21–0.44 of the
 * limit throughout, and a corpse settles about as readily (9/11 drops inside
 * thirty seconds at rate 1, 10/11 at rate 5 — but the ones that do not settle
 * at rate 5 are still moving at 4 m/s five seconds after landing, so the low
 * rate it is). Rotating about the centre
 * instead moves the socket, which the spherical joint then has to undo, and
 * THAT is what used to make the rate the difference between a corpse settling
 * in half a minute and never settling at all.
 */
const LIMIT_RATE = 1, LIMIT_MAX = 2;
/**
 * Internal friction, per second, on the RELATIVE spin across a joint.
 *
 * A ragdoll's joints are the only place its internal energy can go. Without
 * this the corpse keeps trading spin between limbs forever: measured, a B1
 * face down on flat ground still had 1.07 rad/s of residual spin after fifteen
 * seconds and never once dropped under Rapier's sleep threshold. It damps
 * limb-against-limb only — the corpse as a whole still flies when something
 * hits it, because a rigid corpse has no relative spin to damp.
 */
const JOINT_FRICTION = 8;
/**
 * Below this correction, in rad/s, the motor lets go. Without it the motor
 * injects velocity into a corpse that has already stopped, the island never
 * drops under Rapier's sleep threshold, and eight ragdolls buzz forever —
 * which is exactly what the old solver did (measured: 152/152 bodies still
 * awake, 11 m/s peak, after ten seconds face down on flat ground).
 */
const MOTOR_DEADBAND = 0.4;

/**
 * When a body counts as stopped: it has neither moved nor turned by more than
 * this in SLEEP_TIME seconds — 2 cm/s and 14°/s, which is nothing.
 *
 * Deliberately measured as DISPLACEMENT rather than velocity, which is what
 * "settled" actually means and what Rapier's own test cannot see. Measured on a
 * B1 lying still on flat ground: its bones move 0.2–4.9 mm and turn 0.1–6.6° in
 * three quarters of a second, while reporting 0.1–0.8 rad/s of angular velocity
 * — a hand that turned 0.3° in that time reads 0.80 rad/s. The velocity is
 * mostly sign-flipping solver noise, and judging rest by it means a corpse is
 * never at rest.
 */
const SLEEP_MOVE = 0.015, SLEEP_TURN = 0.18, SLEEP_TIME = 0.75;

/** Legacy `spheres:` with no `shape:` — a compound of balls, honestly labelled. */
function shapeFromSpheres(spheres) {
  if (!spheres || !spheres.length) return null;
  if (spheres.length === 1 && spheres[0].c.lengthSq() < 1e-9) return ball(spheres[0].r);
  return compound(spheres.map(s => ({ type: 'ball', radius: s.r, at: s.c.clone() })));
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  World                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

export class RapierWorld {
  constructor(opts = {}) {
    const R = rapier();
    if (!R) throw new Error('RapierWorld: Rapier is not initialised — await initPhysics() first.');
    this.R = R;

    this.gravity = new THREE.Vector3(0, opts.gravity ?? -22, 0);
    this.world = new R.World({ x: 0, y: this.gravity.y, z: 0 });
    this.world.numSolverIterations = opts.iterations ?? 4;
    this._iterations = this.world.numSolverIterations;
    /** Terminal. Set by dispose(); every entry point refuses once it is true. */
    this.dead = false;

    /** Every body in the level, in the order it was added. */
    this.bodies = [];
    /** Ragdoll articulations. @type {RagdollJoint[]} */
    this.joints = [];
    /**
     * Architecture, as records the player's and enemies' own capsule sweeps
     * walk directly — see addStaticBox.
     */
    this.staticBoxes = [];

    this._terrain = null;
    this._hf = null;                 // heightfield collider
    this._hfHeights = null;
    this._hfSeq = -1;
    this._hfTimer = 0;

    this._byCollider = new Map();    // Rapier collider handle → { body } | { box }

    this.maxBodies = opts.maxBodies ?? 1400;
    this.killY = opts.killY ?? -180;
    this.stats = { bodies: 0, contacts: 0, awake: 0, ms: 0, colliders: 0, rapier: 0, joints: 0 };

    this._ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._rayFilter = null;
    this._rayPredicate = (collider) => {
      const rec = this._byCollider.get(collider.handle);
      // Statics and terrain were never filtered by the sphere solver's raycast —
      // only bodies were — and the camera and line-of-sight code depends on it.
      if (!rec || !rec.body) return true;
      return this._rayFilter ? !!this._rayFilter(rec.body) : true;
    };
  }

  /* ── terrain ─────────────────────────────────────────────────────── */

  get terrain() { return this._terrain; }

  set terrain(t) {
    this._terrain = t;
    this._dropHeightfield();
    if (t) this._buildHeightfield();
  }

  _dropHeightfield() {
    if (this._hf) {
      this._byCollider.delete(this._hf.handle);
      this.world.removeCollider(this._hf, false);
      this._hf = null;
    }
  }

  /**
   * Rapier's heightfield is a column-major matrix whose COLUMNS run along x and
   * whose ROWS run along z — verified by ray, not by reading the docs. Terrain
   * stores `heights[j * res + i]` with i along x, so the grid is transposed on
   * the way in.
   */
  _buildHeightfield() {
    const t = this._terrain;
    if (!t) return;
    const R = this.R;
    let res, size, src;

    if (t.heights && t.res) {
      res = t.res; size = t.size; src = t.heights;
    } else if (typeof t.height === 'function') {
      // A stubbed or analytic terrain: sample it onto a grid of our own.
      res = 65; size = t.size ?? 512;
      src = new Float32Array(res * res);
      const half = size / 2, step = size / (res - 1);
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) src[j * res + i] = t.height(-half + i * step, -half + j * step);
      }
    } else return;

    if (!this._hfHeights || this._hfHeights.length !== res * res) this._hfHeights = new Float32Array(res * res);
    const H = this._hfHeights;
    for (let j = 0; j < res; j++) {
      const row = j * res;
      for (let i = 0; i < res; i++) H[i * res + j] = src[row + i];
    }

    const desc = R.ColliderDesc.heightfield(res - 1, res - 1, H, { x: size, y: 1, z: size })
      .setFriction(t.friction ?? 0.9)
      .setRestitution(0)
      .setCollisionGroups(collisionGroups(LAYER.WORLD, LAYER.ALL));
    this._hf = this.world.createCollider(desc);
    this._byCollider.set(this._hf.handle, { terrain: true });
    this._hfSeq = t.deformSeq ?? 0;
  }

  /** A crater changed the ground; rebuild the collider, but not every frame. */
  _refreshHeightfield(dt) {
    const t = this._terrain;
    if (!t || !t.heights || !this._hf) return;
    this._hfTimer -= dt;
    if ((t.deformSeq ?? 0) === this._hfSeq || this._hfTimer > 0) return;
    this._hfTimer = 0.25;
    this._dropHeightfield();
    this._buildHeightfield();
  }

  /* ── bodies ──────────────────────────────────────────────────────── */

  add(body) {
    if (this.dead) { if (body) body.dead = true; return body; }
    if (!body.isRapier) throw new Error('RapierWorld.add: not a Rapier body — pass a `shape:`.');
    if (this.bodies.length >= this.maxBodies) this._cullOldestDebris();
    this.bodies.push(body);
    body._bind(this);
    return body;
  }

  remove(body) {
    body.dead = true;
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    // A joint outliving one of its bodies is a dangling Rapier handle, so it
    // goes with the body rather than waiting to be noticed next step.
    for (let j = this.joints.length - 1; j >= 0; j--) {
      const jt = this.joints[j];
      if (jt.a === body || jt.b === body) this.removeJoint(jt);
    }
    if (body.colliders) for (const c of body.colliders) this._byCollider.delete(c.handle);
    body._unbind();
  }

  /* ── joints ──────────────────────────────────────────────────────── */

  addJoint(j) {
    if (this.dead) { if (j) j.broken = true; return j; }
    this.joints.push(j); j._bind(this); return j;
  }

  removeJoint(j) {
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
    j.broken = true;
    j._unbind();
    return j;
  }

  /**
   * Cone, twist and the rest-pose motor, in velocity space, just before Rapier
   * runs. Corrections land on the cached `angularVelocity`, which `_push` then
   * hands to Rapier along with everything else gameplay wrote this frame, so
   * this crosses the WASM boundary no extra times.
   *
   * A sleeping pair is skipped entirely — that, and MOTOR_DEADBAND, are what
   * let a corpse actually go still. Joints and their bodies share one Rapier
   * island, so a ragdoll sleeps as a whole or not at all.
   */
  _solveJoints(dt) {
    const fr = 1 - Math.exp(-JOINT_FRICTION * dt);
    for (let i = this.joints.length - 1; i >= 0; i--) {
      const j = this.joints[i];
      if (j.broken || j.a.dead || j.b.dead) { this.removeJoint(j); continue; }
      const A = j.a, B = j.b;
      if (!A.awake && !B.awake) continue;
      j.age += dt;
      // Share the correction the way the two bodies would share an impulse.
      const s = A.invMass + B.invMass;
      if (s <= 0) continue;
      const wA = A.invMass / s, wB = B.invMass / s;

      // Where each body's socket sits relative to its own centre of mass. Every
      // correction below is a rotation ABOUT THE SOCKET, not about the centre.
      _ra.copy(j.anchorA).applyQuaternion(A.quaternion);
      _rb.copy(j.anchorB).applyQuaternion(B.quaternion);

      // Where the bone should be pointing, and where it actually is.
      _q1.copy(A.quaternion).multiply(j.restQuat);            // rest orientation of b, world
      _q2.copy(_q1).invert().multiply(B.quaternion);          // deviation from rest, rest frame
      if (_q2.w < 0) { _q2.x = -_q2.x; _q2.y = -_q2.y; _q2.z = -_q2.z; _q2.w = -_q2.w; }
      _v4.subVectors(B.angularVelocity, A.angularVelocity);   // relative angular velocity, world

      // Internal friction, before anything else adds energy.
      _v5.copy(_v4).multiplyScalar(-fr);
      this._spin(B, _v5, wB, _rb);
      this._spin(A, _v5, -wA, _ra);
      _v4.add(_v5);

      // Twist first: the part of the deviation that is a rotation about the
      // bone's own length (+Y runs base → tip on every bone in the rig).
      const tw = Math.hypot(_q2.y, _q2.w);
      if (tw > 1e-9) {
        const twistAngle = 2 * Math.atan2(_q2.y, _q2.w);
        const over = Math.abs(twistAngle) - j.twistLimit;
        if (over > 0) {
          _v1.set(0, 1, 0).applyQuaternion(_q1).multiplyScalar(twistAngle > 0 ? -1 : 1);
          this._limit(A, B, wA, wB, _v1, over, _v4, _ra, _rb);
        }
        _q3.set(0, _q2.y / tw, 0, _q2.w / tw);                // the twist itself
        _q2.multiply(_q3.conjugate());                        // what is left is the swing
        if (_q2.w < 0) { _q2.x = -_q2.x; _q2.y = -_q2.y; _q2.z = -_q2.z; _q2.w = -_q2.w; }
      }

      // Then the cone: how far the bone has swung off where it should point.
      const sw = Math.hypot(_q2.x, _q2.y, _q2.z);
      if (sw > 1e-9) {
        const over = 2 * Math.atan2(sw, _q2.w) - j.coneAngle;
        if (over > 0) {
          _v1.set(_q2.x / sw, _q2.y / sw, _q2.z / sw).applyQuaternion(_q1).negate();
          this._limit(A, B, wA, wB, _v1, over, _v4, _ra, _rb);
        }
      }

      // The motor drives b's whole orientation back toward rest. Split the way
      // the sphere solver split it — the child takes the correction and the
      // parent takes a third of it back — so a stiff spine still holds a torso
      // up while a slack shoulder lets an arm hang.
      const tone = j.tone();
      if (tone > 0) {
        _q3.copy(_q1).multiply(_q2.copy(B.quaternion).conjugate());   // b → rest, world
        if (_q3.w < 0) { _q3.x = -_q3.x; _q3.y = -_q3.y; _q3.z = -_q3.z; _q3.w = -_q3.w; }
        const len = Math.hypot(_q3.x, _q3.y, _q3.z);
        if (len > 1e-6) {
          const angle = 2 * Math.atan2(len, _q3.w);
          _v1.set(_q3.x / len, _q3.y / len, _q3.z / len).multiplyScalar(angle * tone);
          _v1.sub(_v4).multiplyScalar(j.damping);
          if (_v1.lengthSq() > MOTOR_DEADBAND * MOTOR_DEADBAND) {
            if (_v1.lengthSq() > 900) _v1.setLength(30);
            this._spin(B, _v1, 1, _rb);
            this._spin(A, _v1, -0.35, _ra);
          }
        }
      }
    }
  }

  /**
   * Add `k·dw` to a body's angular velocity as a rotation ABOUT ITS SOCKET.
   *
   * Spinning a body about its centre of mass moves the socket, and Rapier's
   * spherical joint then has to undo that with a linear impulse — so every cone
   * correction hands the joint something to fight, and the fight is energy the
   * corpse then has to get rid of. Taking the socket's own motion straight back
   * out of the linear velocity leaves a correction the joint has no opinion
   * about at all: measured over eleven drops of a B1, 9/11 come to rest inside
   * thirty seconds with this and 7/11 without, median 13.2s against 24.5s.
   */
  _spin(b, dw, k, r) {
    if (k === 0 || b.invMass === 0) return;
    _js.copy(dw).multiplyScalar(k);
    b.angularVelocity.add(_js);
    b.velocity.sub(_js.cross(r));
  }

  /** One limit: bring the relative spin about `axis` up to what closes `excess`. */
  _limit(A, B, wA, wB, axis, excess, relW, ra, rb) {
    const lambda = Math.min(excess * LIMIT_RATE, LIMIT_MAX) - relW.dot(axis);
    if (lambda <= 0) return;
    _v5.copy(axis).multiplyScalar(lambda);
    this._spin(B, _v5, wB, rb);
    this._spin(A, _v5, -wA, ra);
    relW.add(_v5);
  }

  _cullOldestDebris() {
    for (const b of this.bodies) {
      if (b.layer === LAYER.DEBRIS && !b.userData.keep) {
        if (b.userData.onCull) b.userData.onCull();
        this.remove(b);
        return;
      }
    }
    for (const b of this.bodies) {
      if (!b.static && !b.userData.keep) { if (b.userData.onCull) b.userData.onCull(); this.remove(b); return; }
    }
  }

  /* ── statics ─────────────────────────────────────────────────────── */

  addStaticBox(center, halfExtents, quat = new THREE.Quaternion(), opts = {}) {
    const R = this.R;
    // The record is exactly the shape the sphere solver's was, because the
    // player's and enemies' own capsule sweeps walk `physics.staticBoxes`
    // directly and read `.center`, `.halfExtents`, `.quat`, `.invQuat`,
    // `.radius` and `.disabled` off it.
    const rec = {
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
    const desc = R.ColliderDesc.cuboid(Math.max(1e-3, halfExtents.x), Math.max(1e-3, halfExtents.y), Math.max(1e-3, halfExtents.z))
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setFriction(rec.friction)
      .setRestitution(rec.restitution)
      .setCollisionGroups(collisionGroups(LAYER.WORLD, LAYER.ALL));
    rec.collider = this.world.createCollider(desc);
    this._byCollider.set(rec.collider.handle, { box: rec });
    // One array, shared with the sphere solver, so a ragdoll still piles up
    // against architecture and removeStaticBox still reaches both.
    this.staticBoxes.push(rec);
    return rec;
  }

  removeStaticBox(box) {
    const i = this.staticBoxes.indexOf(box);
    if (i >= 0) this.staticBoxes.splice(i, 1);
    if (box && box.collider) {
      this._byCollider.delete(box.collider.handle);
      this.world.removeCollider(box.collider, false);
      box.collider = null;
    }
  }

  /* ── step ────────────────────────────────────────────────────────── */

  step(dt) {
    if (this.dead) return;
    const t0 = performance.now();
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;

    this._refreshHeightfield(dt);
    if (this.joints.length) this._solveJoints(dt);

    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.rb) continue;
      if (b.spinFriction > 0 && b.awake && !b.static && !b.kinematic) {
        _v1.set(0, 1, 0).applyQuaternion(b.quaternion);       // the capsule's own axis
        b.angularVelocity.addScaledVector(_v1, -b.angularVelocity.dot(_v1) * (1 - Math.exp(-b.spinFriction * dt)));
      }
      b._push();
    }

    this.world.timestep = dt;
    this.world.step();

    let awake = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.rb || b.static) continue;
      if (b.rb.isSleeping()) {
        // Take one last reading on the way down so a sleeping body reports the
        // transform it actually stopped at, and a velocity of zero.
        if (b.awake) {
          b._pull();
          b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
          b._sv.set(0, 0, 0); b._sw.set(0, 0, 0);
          b.awake = false;
        }
        continue;
      }
      const justWoke = !b.awake;
      b.awake = true; awake++;
      b._pull();

      // Rapier only sleeps an island once EVERY body in it is under both its
      // linear AND its angular threshold, and a capsule at rest never gets
      // under the angular one (see Body.spinFriction) — so a corpse that has
      // visibly stopped would cost a full solve forever. How long a body has
      // gone WITHOUT MOVING is therefore tracked here and it is put down by
      // hand below. Rapier wakes it again on the first new contact or impulse.
      if (!justWoke && b.allowSleep && !b.kinematic
        && b.position.distanceToSquared(b._rp) < SLEEP_MOVE * SLEEP_MOVE
        && b.quaternion.angleTo(b._rq) < SLEEP_TURN) {
        b._still += dt;
      } else {
        b._still = 0;
        b._rp.copy(b.position); b._rq.copy(b.quaternion);
      }
    }

    // A jointed body may only go down with the rest of its ragdoll: sleeping
    // one limb of a corpse whose other arm is still moving just gets it woken
    // straight back up by the joint solve. Ragdoll joints are built parents
    // first, so one pass down the list and one back up carries the smallest
    // still-time in a limb chain to every body in it.
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      const s = Math.min(j.a._still, j.b._still);
      j.a._still = s; j.b._still = s;
    }
    for (let i = this.joints.length - 1; i >= 0; i--) {
      const j = this.joints[i];
      const s = Math.min(j.a._still, j.b._still);
      j.a._still = s; j.b._still = s;
    }

    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (b.static || !b.rb) continue;
      // the kill plane
      if (b.position.y < this.killY) {
        if (b.userData.onCull) b.userData.onCull();
        this.remove(b);
        continue;
      }
      if (b.awake && b._still > SLEEP_TIME) { b.sleep(); awake--; }
    }

    this.stats.bodies = this.bodies.length;
    this.stats.rapier = this.bodies.length;
    this.stats.joints = this.joints.length;
    this.stats.colliders = this.world.colliders.len();
    this.stats.awake = awake;
    this.stats.ms = performance.now() - t0;
  }

  /* ── queries ─────────────────────────────────────────────────────── */

  /**
   * Ray against everything: bodies, static boxes and the heightfield. Same
   * return shape as the solver this replaced — `{ body, box, terrain, point,
   * normal, distance }` — and, as before, `filter` applies only to bodies.
   */
  raycast(origin, dir, maxDist = 200, filter = null) {
    if (this.dead) return null;
    if (!(maxDist > 0)) return null;
    const d = _v1.copy(dir);
    const len = d.length();
    if (len < 1e-9) return null;
    d.multiplyScalar(1 / len);

    this._ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this._ray.dir = { x: d.x, y: d.y, z: d.z };
    this._rayFilter = filter;
    let best = null, bestT = maxDist;

    const hit = this.world.castRayAndGetNormal(this._ray, maxDist, true,
      undefined, undefined, undefined, undefined, this._rayPredicate);
    this._rayFilter = null;

    if (hit && hit.timeOfImpact <= bestT) {
      const rec = this._byCollider.get(hit.collider.handle) || {};
      bestT = hit.timeOfImpact;
      best = {
        body: rec.body || null,
        box: rec.box || null,
        terrain: !!rec.terrain,
        distance: bestT,
        point: new THREE.Vector3(origin.x + d.x * bestT, origin.y + d.y * bestT, origin.z + d.z * bestT),
        normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      };
    }
    return best;
  }

  querySphere(center, radius, out = []) {
    out.length = 0;
    for (const b of this.bodies) {
      if (b.static) continue;
      const rr = radius + b.boundingRadius;
      if (b.position.distanceToSquared(center) <= rr * rr) out.push(b);
    }
    return out;
  }

  /* ── lifecycle ───────────────────────────────────────────────────── */

  /**
   * Empty the world and start a fresh one — a LEVEL CHANGE.
   *
   * `realloc: false` is the terminal form and belongs only to `dispose()`;
   * everything else wants a world to carry on with.
   */
  clear(realloc = true) {
    for (const b of this.bodies) { b.dead = true; b.rb = null; b.colliders = null; b._world = null; }
    for (const j of this.joints) { j.broken = true; j.joint = null; j._world = null; }
    this.bodies.length = 0;
    this.joints.length = 0;
    this.staticBoxes.length = 0;
    this._byCollider.clear();
    this._hf = null;
    this._hfSeq = -1;
    // A fresh Rapier world is cheaper and far safer than unpicking every
    // collider, joint and island by hand.
    this.world?.free?.();
    this.world = realloc ? new this.R.World({ x: 0, y: this.gravity.y, z: 0 }) : null;
    if (this.world) this.world.numSolverIterations = this._iterations;
    this._terrain = null;
  }

  /**
   * TERMINAL. The last thing teardown does is not allocate.
   *
   * `dispose()` was `{ this.clear(); }` — and `clear()` ends by constructing a
   * fresh Rapier world, so the final act of tearing a World down was to
   * allocate the one thing tearing it down exists to release, and nothing
   * would ever free that one.
   *
   * AND NOTHING MAY BIND INTO IT AFTERWARDS. Freeing the world for real
   * exposed a use-after-teardown the reallocation had been quietly absorbing:
   * `Player.die()` builds its ragdoll from a DYNAMIC import, so an Actor can
   * land a tick or two after the world it belongs to has gone, and
   * `Body._bind` reaches straight into `world.world`. With the old reset it
   * bound into a fresh world nobody steps — invisible, and part of what was
   * leaking. Refusing is the honest version of the same outcome: the body is
   * marked dead and handed back, exactly as `remove` leaves one.
   */
  dispose() {
    if (this.dead) return;
    this.clear(false);
    this.dead = true;
  }
}
