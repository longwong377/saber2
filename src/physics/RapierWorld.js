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
 * ── the two solvers, and why both are still here ──────────────────────────
 *
 * Ragdolls and severed limbs stay on the sphere solver, on purpose. Cutting a
 * limb rebuilds that limb's collider mid-flight, which is exactly the trade the
 * sphere solver was chosen for; porting it is a separate job. So a RapierWorld
 * OWNS a PhysicsWorld and forwards to it:
 *
 *   Rapier   terrain, static architecture, props, debris, thrown objects,
 *            the player's and enemies' kinematic capsules
 *   spheres  ragdoll bodies, severed limbs, and the ball joints between them
 *
 * Both see the same terrain and the same static boxes, so a ragdoll still lands
 * on the ground and still piles against a wall. What they do NOT do yet is see
 * each other: a corpse will not knock a crate over, and a hurled crate will
 * pass through a corpse. That is the price of the split, it is temporary, and
 * it is the one behaviour this file deliberately gives up.
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
import { PhysicsWorld, LAYER, boxSpheres, capsuleSpheres } from './Physics.js';

export { LAYER, boxSpheres, capsuleSpheres };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _box = new THREE.Box3();

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
    /** Distinguishes us from a sphere-solver Body in the shared body list. */
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
    this.userData = opts.userData || {};
    this.onContact = opts.onContact || null;

    this.allowSleep = opts.allowSleep !== false;
    this.awake = true;
    this.dead = false;

    // Blade targets. Explicit `spheres` still wins, so a caller that has a
    // better idea of where a prop's mass reads can say so.
    this.spheres = opts.spheres || bladeSpheresFor(this.shape);
    shapeExtent(this.shape, _v1);
    this.boundingRadius = Math.max(0.05, _v1.length());

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
    this.awake = true;
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
    if (!this.static && !this.kinematic) {
      desc.setLinvel(this.velocity.x, this.velocity.y, this.velocity.z)
        .setAngvel({ x: this.angularVelocity.x, y: this.angularVelocity.y, z: this.angularVelocity.z });
      if (this.ccd) desc.setCcdEnabled(true);
      if (this.softCcd > 0) desc.setSoftCcdPrediction(this.softCcd);
    }
    this.rb = world.world.createRigidBody(desc);

    const groups = collisionGroups(this.layer, this.mask);
    this.colliders = [];
    for (const cd of descsFor(R, this.shape)) {
      cd.setFriction(this.friction).setRestitution(this.restitution)
        .setCollisionGroups(groups).setDensity(1);
      this.colliders.push(world.world.createCollider(cd, this.rb));
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
    this._sp.copy(this.position); this._sq.copy(this.quaternion);
    this._sv.copy(this.velocity); this._sw.copy(this.angularVelocity);
    this._sg = this.gravityScale;
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

    /** Ragdolls and severed limbs — see the note at the top of this file. */
    this.legacy = new PhysicsWorld(opts);

    /** Every body in the level, both solvers, in the order they were added. */
    this.bodies = [];
    /** Shared with the sphere solver, so a ragdoll still hits a wall. */
    this.staticBoxes = this.legacy.staticBoxes;

    this._terrain = null;
    this._hf = null;                 // heightfield collider
    this._hfHeights = null;
    this._hfSeq = -1;
    this._hfTimer = 0;

    this._byCollider = new Map();    // Rapier collider handle → { body } | { box }
    this._legacyN = 0;

    this.maxBodies = opts.maxBodies ?? 1400;
    this.killY = opts.killY ?? -180;
    this.stats = { bodies: 0, contacts: 0, awake: 0, ms: 0, colliders: 0, rapier: 0 };

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
    this.legacy.terrain = t;
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
    if (this.bodies.length >= this.maxBodies) this._cullOldestDebris();
    this.bodies.push(body);
    if (body.isRapier) {
      body._bind(this);
      for (const c of body.colliders) this._byCollider.set(c.handle, { body });
    } else {
      // a sphere-solver Body (ragdoll, severed limb)
      this.legacy.add(body);
      this._legacyN = this.legacy.bodies.length;
    }
    return body;
  }

  remove(body) {
    body.dead = true;
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    if (body.isRapier) {
      if (body.colliders) for (const c of body.colliders) this._byCollider.delete(c.handle);
      body._unbind();
    } else {
      this.legacy.remove(body);
      this._legacyN = this.legacy.bodies.length;
    }
  }

  /* Joints are the ragdoll's, and the ragdoll is still the sphere solver's. */
  get joints() { return this.legacy.joints; }
  addJoint(j) { return this.legacy.addJoint(j); }
  removeJoint(j) { return this.legacy.removeJoint(j); }

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
    const t0 = performance.now();
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;

    this._refreshHeightfield(dt);

    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isRapier && b.rb) b._push();
    }

    this.world.timestep = dt;
    this.world.step();

    let awake = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.isRapier || !b.rb || b.static) continue;
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
      b.awake = true; awake++;
      b._pull();
    }

    // the kill plane
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (!b.isRapier || b.static || !b.rb) continue;
      if (b.position.y < this.killY) {
        if (b.userData.onCull) b.userData.onCull();
        this.remove(b);
      }
    }

    // ragdolls and severed limbs
    this.legacy.step(dt);
    if (this.legacy.bodies.length !== this._legacyN) this._reconcile();

    this.stats.bodies = this.bodies.length;
    this.stats.rapier = this.bodies.length - this.legacy.bodies.length;
    this.stats.contacts = this.legacy.stats.contacts;
    this.stats.colliders = this.world.colliders.len();
    this.stats.awake = awake + this.legacy.stats.awake;
    this.stats.ms = performance.now() - t0;
  }

  /** The sphere solver culls its own bodies; drop them from the shared list. */
  _reconcile() {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (!b.isRapier && b.dead) this.bodies.splice(i, 1);
    }
    this._legacyN = this.legacy.bodies.length;
  }

  /* ── queries ─────────────────────────────────────────────────────── */

  /**
   * Ray against everything: Rapier bodies, static boxes, the heightfield, and
   * the sphere solver's ragdolls. Same return shape as the old solver —
   * `{ body, box, terrain, point, normal, distance }` — and, as before, `filter`
   * applies only to bodies.
   */
  raycast(origin, dir, maxDist = 200, filter = null) {
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

    // ragdoll bodies still live in the sphere solver
    for (const b of this.legacy.bodies) {
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
        best = best || { body: null, box: null, terrain: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };
        best.body = b; best.box = null; best.terrain = false; best.distance = t;
        best.point.copy(origin).addScaledVector(d, t);
        best.normal.subVectors(best.point, _v2).normalize();
      }
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

  clear() {
    for (const b of this.bodies) {
      if (b.isRapier) { b.dead = true; b.rb = null; b.colliders = null; b._world = null; }
    }
    this.bodies.length = 0;
    this._byCollider.clear();
    this._hf = null;
    this._hfSeq = -1;
    this.legacy.clear();
    this._legacyN = 0;
    // A fresh Rapier world is cheaper and far safer than unpicking every
    // collider, joint and island by hand.
    this.world.free?.();
    this.world = new this.R.World({ x: 0, y: this.gravity.y, z: 0 });
    this.world.numSolverIterations = 4;
    this.staticBoxes = this.legacy.staticBoxes;
    this._terrain = null;
  }

  dispose() { this.clear(); }
}
