/**
 * BATTLEFRONT BORZ — the world, on Rapier.
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
import { LAYER, LOOSE_MASK, boxSpheres, capsuleSpheres } from './Physics.js';
import { BoxIndex } from './BoxIndex.js';

export { LAYER, LOOSE_MASK, boxSpheres, capsuleSpheres };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _box = new THREE.Box3();
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _js = new THREE.Vector3();
const _ZERO = new THREE.Vector3();
const _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
const _na = new THREE.Vector3();

/**
 * The point on `body` closest to `to` — its axis projection for a capsule or a
 * cylinder, its centre for anything else.
 *
 * A capsule IS a segment with a radius, so this is exact for the three things
 * in this game that are long: a living body, a severed limb and a falling
 * trunk. A box or a hull gets its centre, which is what the old reading used
 * everywhere and is right for a compact shape.
 */
function _nearestOn(body, to, out) {
  const sh = body.shape;
  const half = sh && (sh.type === 'capsule' || sh.type === 'cylinder') ? sh.halfHeight : 0;
  if (!(half > 0)) return out.copy(body.position);
  // the capsule's own axis is +Y, carried into world space by its rotation
  _na.set(0, 1, 0).applyQuaternion(body.quaternion);
  const t = clampNum(out.copy(to).sub(body.position).dot(_na), -half, half);
  return out.copy(body.position).addScaledVector(_na, t);
}

/** The velocity of `body` at world point `p`: `v + ω × r`. */
function _pointVel(body, p, out) {
  out.copy(body.kinematic ? body.kinVel : body.velocity);
  const w = body.angularVelocity;
  if (!w || (w.x === 0 && w.y === 0 && w.z === 0)) return out;
  _na.copy(p).sub(body.position);
  return out.set(
    out.x + (w.y * _na.z - w.z * _na.y),
    out.y + (w.z * _na.x - w.x * _na.z),
    out.z + (w.x * _na.y - w.y * _na.x),
  );
}

const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** The scratch contact handed to every `Body.onContact`. See _dispatchContacts. */
const _contact = {
  self: null, other: null, speed: 0, mass: 0, impulse: 0, world: false, approach: false, time: 0,
  normal: new THREE.Vector3(), point: new THREE.Vector3(),
};

let _bodyId = 1;

/**
 * WHAT A FINITE WORLD IS, AND WHY EVERY BOUNDARY HAS TO SAY SO.
 *
 * Rapier REJECTS NaN on the way in — a NaN translation or impulse is refused
 * and the body carries on. `Infinity` is not refused: it is arithmetic, and
 * `Infinity − Infinity` inside the solver turns the body's whole transform to
 * NaN permanently. From there the body is unreachable by either of the two
 * things that would have taken it away, because both are `<` comparisons and
 * every comparison against NaN is false: the kill plane (`y < killY`) and the
 * sleep test (`distanceToSquared(_rp) < SLEEP_MOVE²`). Measured — one
 * `applyImpulse(V(Infinity,0,0))`, then 3 000 steps:
 *
 *     pos = NaN,NaN,NaN   awake = true   inWorld = true   stats.awake = 1
 *
 * — a body that costs a full island solve for the rest of the session and
 * drags its mesh to a NaN matrix. The only guard `applyImpulse` had tested the
 * world POINT, and only because NaN is its "no point given" sentinel.
 *
 * So: nothing non-finite crosses into the solver on the UPDATE path, and
 * anything that is already non-finite is culled by a test that is true for NaN
 * rather than false. The one path deliberately left open is BIRTH — a body
 * constructed at a non-finite position reaches `createRigidBody` with it,
 * because `_push` compares against `_sp` and `_sp` was copied from the same bad
 * value, so nothing there ever fires. Driven, that body goes to NaN on the
 * first step and the kill plane below takes it away on the same step, calling
 * its `onCull` and freeing its mesh, so the world is not poisoned and nothing
 * leaks. It is left that way on purpose: refusing at the door would strand the
 * caller's mesh, because `onCull` is the only thing that removes it and only a
 * body that got INTO the world can be culled out of it.
 * `MAX_SPEED` is the other half — Rapier traps out of wasm at about 1e12, and
 * a value that large is a defect on this side of the boundary whatever it is.
 * 1e4 m/s is four hundred times the fastest thing the game fires.
 *
 * ── AND A BOUND IS ONLY A BOUND IN ITS OWN CURRENCY ────────────────────
 *
 * `MAX_SPEED` is metres per second. It was applied to `applyImpulse` as if an
 * impulse were one, and an impulse is N·s — it carries the body's MASS, so the
 * same guard means something different for every object it is asked about.
 * `Player.forcePush` hands a body `mass · 15 · k · P · heft`; for the 900 kg
 * pillar at forcePower 4 that is ~28 000 N·s, 2.8x a bound sized for a
 * velocity, and the push was DROPPED ENTIRELY. Measured by `force.mjs`:
 *
 *     before   4x: crate 49.1 m/s   pillar 31.3
 *     after    4x: crate 49.1 m/s   pillar  0.40   ← one step of gravity
 *
 * The crate is 22 kg and stayed under the bound, so the defect was invisible on
 * every light prop and bit only the payoff case: turning Force Power UP made
 * the two heaviest things in the game stop moving.
 *
 * So the bound is converted rather than re-tuned. What the solver integrates,
 * and what wasm traps on, is the SPEED an impulse buys — |J|·invMass — and the
 * torque's is |τ|/I. Stated that way one number covers every body: the largest
 * thing the game can legitimately ask for is that pillar's 31.3 m/s, against
 * 1e4, and a 22 kg crate and a 3 600 kg walker are finally being asked the same
 * question. `Infinity` still fails it (Infinity·anything is Infinity) and so
 * does the 1e12 that traps the solver, which is what the guard is for.
 */
const MAX_SPEED = 1e4;
const finite3 = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finite4 = (q) => finite3(q) && Number.isFinite(q.w);
/** A velocity: already in MAX_SPEED's currency. */
const sane3 = (v) => finite3(v) && v.lengthSq() < MAX_SPEED * MAX_SPEED;
/** An impulse or a torque impulse, priced through `inv` (1/mass, or 1/inertia). */
const sanePer = (v, inv) => finite3(v) && v.lengthSq() * inv * inv < MAX_SPEED * MAX_SPEED;

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
    /**
     * WHAT THIS BODY HITS — and it is an ACCESSOR, not a field, because the
     * opt-in has to reach the collider.
     *
     * Rapier only reports a contact for a pair where at least one collider was
     * built asking for it, so "does anyone care about this body's contacts" is
     * a question the physics engine has to be told the answer to rather than
     * one the game can keep to itself. Measured on the vendored build: a
     * flagged box falling onto an UNFLAGGED ground still reports its contact,
     * so one side is enough — which is the whole reason this can be an opt-in
     * at all. Architecture and terrain never carry the flag and a level's
     * thousands of static colliders therefore cost nothing.
     */
    this._onContact = null;
    /** Whether the colliders currently carry the event flag. See _syncContactArm. */
    this._armed = false;
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
    /**
     * The velocity this body carried INTO the current step.
     *
     * Contact damage is a question about the exchange, and the exchange is
     * exactly `mass × (v_after − v_before)`. See RapierWorld._dispatchContacts
     * for why the closing speed on its own is not good enough.
     */
    this._pv = new THREE.Vector3();
    /**
     * HOW FAST A KINEMATIC BODY IS BEING CARRIED, which is not its `velocity`.
     *
     * A kinematic body is moved by `setTransform`, so Rapier neither reads nor
     * writes its linear velocity and `.velocity` is free for other things to
     * use — which they do: the co-op netcode stages a remote Force impulse
     * there and reads it back on the next tick. Writing the walk speed into
     * `.velocity` so the contact dispatcher could see it wiped that impulse
     * every frame, and `coop.mjs` said so: "a guest's throw moved the host's
     * body 0.150 m — the impulse is not on the wire". It was on the wire. It
     * was being overwritten on arrival.
     *
     * So the carried speed lives here instead and `.velocity` is left alone.
     */
    this.kinVel = new THREE.Vector3();
    this._impulses = null;
  }

  /* ── contacts ────────────────────────────────────────────────────── */

  get onContact() { return this._onContact; }

  /**
   * Setting a handler arms the body; clearing it disarms. The flag is pushed
   * down to the live colliders, so a handler attached after the body is in the
   * world takes effect on the next step rather than on the next rebuild.
   */
  set onContact(fn) {
    const had = !!this._onContact;
    this._onContact = fn || null;
    if (!!this._onContact !== had) this._syncContactEvents();
  }

  /**
   * Join this body to a self-exclusion group, or change which one, live.
   *
   * `selfGroup` was a constructor-only field because the only thing that used
   * it was a ragdoll, and a ragdoll knows its group before it builds a bone.
   * A LIVING body does not: its capsule is built in `Enemy`'s constructor and
   * its `Actor` — which owns the group — comes later. Being able to say so
   * afterwards is what lets a corpse and the capsule it came out of stop
   * colliding with each other.
   */
  setSelfGroup(g) {
    this.selfGroup = g | 0;
    if (!this.colliders || !this._world || this._world.dead) return this;
    const groups = this.groups();
    for (const c of this.colliders) c.setCollisionGroups(groups);
    return this;
  }

  _syncContactEvents() {
    const w = this._world;
    if (!w || w.dead) return;
    if (this._onContact) {
      w._armContacts();
      /* A handler attached after the colliders were built: widen them now, for
       * the reason `_buildColliders` gives. */
      const T = w.R.ActiveCollisionTypes;
      const types = T.ALL & ~T.FIXED_FIXED;
      if (this.colliders) for (const c of this.colliders) c.setActiveCollisionTypes(types);
    }
    // The FLAG is not set here. See `_syncContactArm` — a handler says this
    // body is interested, and its speed says whether it is interesting yet.
    this._syncContactArm();
  }

  /**
   * ARMED ONLY WHILE IT COULD ACTUALLY HIT SOMETHING, and this is the
   * difference between a channel that is free and one that is not.
   *
   * A prop lying still cannot deliver a hit, so it does not need the flag. The
   * flag follows the body's SPEED instead, and because one side of a pair is
   * enough to raise an event, nothing is lost by a resting body being dark: the
   * thing that hits it is the thing that is moving, and that one is armed.
   *
   * ── WHAT IT IS WORTH: NOTHING YET MEASURABLE, and the road to saying so
   *    honestly is worth more than the conclusion ─────────────────────────
   *
   * The first reading said arming Geonosis' 50 props cost 0.671 ms a frame,
   * +12.6%. It was an artefact. It compared two freshly booted worlds, so most
   * of it was JIT warmup — visible in the raw blocks, which start at 3.4 ms
   * and settle at 1.0. §2.5's rule about an instrument that reports
   * catastrophe, wearing its benchmark hat.
   *
   * Measured properly — ONE world, alternating blocks, physics time only, so
   * boot, render and AI are all out of the reading — off, gated and
   * always-armed are the same number, and stay the same number on settled
   * piles of 200 and 500 plain boxes at nine repeats of 200 frames:
   *
   *     bodies   no flag    gated      always armed
   *     200      0.107 ms   0.113 ms   0.107 ms
   *     500      0.311 ms   0.326 ms   0.323 ms
   *
   * The ordering of those three flips between runs, which is the tell: the
   * differences are at the noise floor and none of them is real. So the claim
   * this gate is entitled to make is NOT "it made the channel free" — the
   * channel was already free at every scale that has been measured.
   *
   * It is kept for the case that has not been: hundreds of bodies genuinely IN
   * MOTION at once, where the flag count stops being ~2 and the event traffic
   * stops being 90-in-600-frames. A collapse does that, and
   * `prefracture-budget.mjs` is where it would show. Insurance bought at a
   * price that cannot be measured is worth holding; do not go looking for the
   * saving it did not make.
   *
   * `contactArmSpeed` sits below the speed at which a contact is worth any
   * damage at all, so a body is always armed before it is dangerous.
   */
  _syncContactArm() {
    const w = this._world;
    if (!w || w.dead || !this.colliders) return;
    /**
     * A KINEMATIC BODY IS ARMED WHENEVER IT HAS A HANDLER, WITH NO SPEED GATE.
     *
     * The gate exists so that a level's hundreds of SETTLED DEBRIS cost
     * nothing — that is a dynamic-body problem and the measurements behind the
     * gate are all dynamic bodies. Kinematic bodies are the living ones: fifty
     * or so, plus whatever trunks are in the air, and every one of them is
     * relevant the whole time it exists.
     *
     * And gating them is not merely wasteful, it is WRONG. A kinematic pair
     * needs BOTH sides flagged before Rapier will report it — one side is
     * enough for a dynamic pair and is not enough here. Gated on speed, a
     * trunk coming down on somebody STANDING STILL raised nothing at all,
     * because the victim was stationary, therefore disarmed, therefore unable
     * to be hit by anything. Took a falling tree to find; it was equally true
     * of a charging beast and a man who had stopped to aim.
     */
    const want = !!this._onContact && !this.static
      && (this.kinematic || this.velocity.lengthSq() >= w._armSpeed2);
    if (want === this._armed) return;
    this._armed = want;
    const R = w.R;
    const f = want ? R.ActiveEvents.COLLISION_EVENTS : R.ActiveEvents.NONE;
    /**
     * AND THE COLLISION TYPES, WITHOUT WHICH ARMING A BODY DOES NOTHING.
     *
     * Rapier's default `ActiveCollisionTypes` is DYNAMIC_DYNAMIC |
     * DYNAMIC_KINEMATIC | DYNAMIC_FIXED. KINEMATIC_KINEMATIC is not in it.
     * Every living body in this game — every droid, every walker, the player —
     * is a KINEMATIC capsule, so a pair of them generates no contact at all and
     * no amount of arming, masking or event-flagging changes that.
     *
     * Measured on the vendored build, two kinematic boxes driven together over
     * 120 steps: **0 start events at the default, 1 with ALL**. Without this
     * line the whole "everything with mass is a striker" change is inert, and
     * every check that looks at flags rather than at damage passes anyway.
     *
     * FIXED_FIXED is left out: two static boxes cannot begin to touch, and
     * paying the narrowphase for every pair of them in a level's architecture
     * is the one part of ALL that buys nothing.
     */
    for (const c of this.colliders) c.setActiveEvents(f);
  }

  /* ── impulses ────────────────────────────────────────────────────── */

  /**
   * Queued rather than applied straight through: gameplay may also write
   * `.velocity` in the same frame, and the write has to land first or the
   * impulse is silently overwritten by a stale cached velocity.
   */
  applyImpulse(impulse, worldPoint) {
    if (this.invMass === 0 || this.static) return;
    // The IMPULSE, which is what nothing checked. See `finite3` above for what
    // one Infinity here costs, and note the point's NaN is a sentinel for "no
    // point", so it is checked for range but never for being a number. The
    // bound is on the SPEED this buys and not on the impulse itself — see
    // `sanePer`, and the pillar the first version of this refused outright.
    if (!sanePer(impulse, this.invMass)) return;
    if (worldPoint && !finite3(worldPoint)) worldPoint = null;
    this.wake();
    if (!this.rb) { this.velocity.addScaledVector(impulse, this.invMass); return; }
    (this._impulses || (this._impulses = [])).push(
      impulse.x, impulse.y, impulse.z,
      worldPoint ? worldPoint.x : NaN, worldPoint ? worldPoint.y : 0, worldPoint ? worldPoint.z : 0);
  }

  applyForceImpulse(impulse) { this.applyImpulse(impulse, null); }

  applyTorqueImpulse(t) {
    if (this.invMass === 0 || this.static || !this.rb) return;
    /* Same currency problem as `applyImpulse`, one derivative round: a torque
     * impulse is N·m·s and what it buys is |τ|/I of spin, so it is priced
     * through the SMALLEST principal moment — the axis that spins up hardest.
     * A body whose collider has no inertia at all falls back to the raw
     * finiteness test rather than dividing by zero. */
    const I = this.rb.principalInertia();
    const Imin = Math.min(I.x, I.y, I.z);
    if (!(Imin > 0) ? !finite3(t) : !sanePer(t, 1 / Imin)) return;
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
    // Fresh colliders carry no event flag; `_syncContactArm` puts it back on
    // the next step if this body is moving fast enough to want it.
    this._armed = false;
    for (const cd of descsFor(R, this.shape)) {
      cd.setFriction(this.friction).setRestitution(this.restitution)
        .setCollisionGroups(groups).setDensity(1);
      /**
       * THE COLLISION TYPES ARE A PROPERTY OF BEING ARMED, NOT OF MOVING.
       *
       * Rapier's default omits KINEMATIC_KINEMATIC and every living body here
       * is a kinematic capsule, so the flag has to be on for the pair to exist
       * at all. It was set alongside the EVENT flag at first, which is
       * speed-gated — and that is wrong in a way that took a falling tree to
       * show: a trunk coming down on somebody STANDING STILL raised nothing,
       * because the victim was stationary, therefore disarmed, therefore back
       * on the default types, and a kinematic pair needs BOTH sides to allow
       * it. One side is enough for the EVENT; it is not enough for the PAIR.
       *
       * So the types are set once, here, for anything with a handler, and only
       * the event flag follows the speed. A pair that exists and raises no
       * event costs a narrowphase test; a pair that does not exist cannot be
       * hit by anything, ever.
       */
      if (this._onContact) {
        const T = R.ActiveCollisionTypes;
        cd.setActiveCollisionTypes(T.ALL & ~T.FIXED_FIXED);
      }
      const c = world.world.createCollider(cd, this.rb);
      this.colliders.push(c);
      world._byCollider.set(c.handle, { body: this });
    }
    /**
     * Rapier derives mass from collider density; scale the density so the total
     * lands on the mass the caller asked for, which keeps the real inertia
     * tensor of the real shape rather than flattening it to a lump.
     *
     * AND `m0` HAS TO BE THE NEW COLLIDERS' MASS, WHICH ON A REBUILD IT WAS
     * NOT. `setShape` drops the old colliders and calls this again, and
     * `rb.mass()` still reported the mass the OLD ones had been scaled to —
     * the body's own `this.mass` — so `k = mass / m0` came out at 1, the new
     * colliders kept density 1, and the `recomputeMassPropertiesFromColliders`
     * below then replaced the body's mass with the raw volume of the new
     * shape. Driven through the game's own cut, on a B1 corpse:
     *
     *     bone      asked   Rapier before   asked after the cut   Rapier after
     *     armL      0.905   0.905           0.453                 0.000
     *     thighR    2.998   2.998           1.499                 0.001
     *     head     11.146  11.146           5.573                 0.003
     *
     * — every stump 0.0004x of the mass it asked for. `Ragdoll.cutRagdoll` is
     * the only caller and it runs on every limb the blade takes off, so a
     * corpse that has been cut is a chain of near-weightless links: the joint
     * solve shares its correction by `invMass`, so the stump takes essentially
     * all of every correction, and `inertiaScale` — the whole reason a corpse
     * lies still — is left at zero because it is applied to an inertia that no
     * longer exists. Measured over 20 s of settling, three bones cut on one
     * B1, against the same B1 uncut as the control:
     *
     *     uncut      193.4 m of bone travel, peak 13.7 m/s   (both, unchanged)
     *     cut, was   269.1 m,                peak 37.1 m/s
     *     cut, now   102.1 m,                peak 12.5 m/s
     *
     * One recompute before the reading makes `m0` the question it was always
     * meant to be — what do these colliders weigh at density 1 — at both call
     * sites, and it is a no-op at birth, where nothing has been scaled yet.
     */
    if (!this.static && this.mass > 0) {
      this.rb.recomputeMassPropertiesFromColliders();
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
      // Gameplay wrote a transform. If it is not a transform, keep the last one
      // that was: a body left where it was is a visible defect somebody can
      // chase, a body at NaN is an immortal island solve nobody can see.
      if (!finite3(this.position) || !finite4(this.quaternion)) {
        this.position.copy(this._sp); this.quaternion.copy(this._sq);
      }
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
        if (!sane3(this.velocity)) this.velocity.copy(this._sv);
        rb.setLinvel({ x: this.velocity.x, y: this.velocity.y, z: this.velocity.z }, true);
        this._sv.copy(this.velocity);
      }
      if (this.angularVelocity.distanceToSquared(this._sw) > eps) {
        if (!sane3(this.angularVelocity)) this.angularVelocity.copy(this._sw);
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

/**
 * The largest step this solver stays stable over, the largest frame it will
 * simulate, and the cap on how many of the former it will spend on one of the
 * latter. See `step` for the measurement that separated the first two.
 */
const MAX_STEP = 1 / 30, MAX_FRAME = 0.1, MAX_SUBSTEPS = 4;

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
    /**
     * WHAT CHANGED IN `staticBoxes`, AS A NUMBER RATHER THAN AS A LENGTH.
     *
     * Every consumer of the array that wants to cache anything about it needs
     * to know when it has moved, and `length` cannot say: a `removeStaticBox`
     * and an `addStaticBox` in one frame — a door that swings, a wall that
     * breaks into chunks — leaves the length identical and the contents
     * different. §2.3's "a missing thing answered with a plausible default"
     * wearing its cache hat. Bumped by add, remove and clear, and by nothing
     * else, because nothing else changes which records are in the array.
     */
    this.boxVersion = 0;
    /**
     * The broad phase over it. Built lazily on the first query and rebuilt only
     * when `boxVersion` moves; see src/physics/BoxIndex.js for the correctness
     * argument, which is the reason that file is longer than this line.
     */
    this.boxIndex = new BoxIndex();

    this._terrain = null;
    this._hf = null;                 // heightfield collider
    this._hfHeights = null;
    this._hfSeq = -1;
    this._hfTimer = 0;

    this._byCollider = new Map();    // Rapier collider handle → { body } | { box }

    /**
     * CONTACT DISPATCH — the channel the Rapier migration dropped.
     *
     * `Body.onContact` has been stored on this class since the migration and
     * delivered nowhere: the retired sphere solver in Physics.js dispatched it
     * at five sites and its consumers went with it, so for as long as Rapier
     * has been the engine, NOTHING in the game has learned that two things
     * touched. Every system that needed the fact built its own sweep instead —
     * the thrower's in Player, the forest's raycast, the blast sphere in World
     * — which is why only the player's own throws ever hurt anything.
     *
     * ── why STARTED events and not contact forces ──────────────────────
     *
     * Rapier offers both. Measured on the vendored build, one 20 kg box
     * dropped onto flat ground:
     *
     *     CONTACT_FORCE_EVENTS, threshold 1 N     85 events in 120 steps
     *     COLLISION_EVENTS, started only           1 event  in 300 steps
     *
     * A resting body presses on the ground with its own weight forever, so a
     * force threshold cannot tell "landed on a droid" from "sitting on sand"
     * without being tuned per mass — and every settled crate in a level would
     * bill a callback a frame. A contact START fires once, when two things
     * that were apart become touching, which is exactly the event the game
     * means by "hit". This is the difference between a channel that costs
     * nothing at rest and the frame-budget disaster ROADMAP item 4 warns about.
     *
     * The queue is built only when something first opts in, so a level that
     * wants no contacts allocates nothing.
     */
    this._events = null;
    /**
     * Pairs that BEGAN touching in the previous step, flat as [h1, h2, …].
     *
     * Rapier reports a contact start one step before it resolves it: measured
     * on the vendored build, a 22 kg crate driven into an 80 kg body reports
     * the start at frame 13 and changes velocity at frame 14, at 30 m/s and at
     * 90 m/s alike. So the pair is held for a step and priced on the next one,
     * when the impulse has actually landed. See _dispatchContacts.
     */
    this._contactPending = [];
    /**
     * How fast the two have to be closing before anyone is told, in m/s.
     *
     * Debris settling against debris generates real contact starts at a
     * hundredth of a metre a second, and waking gameplay code for those is
     * paying for an event nothing can act on. The floor is on the RELATIVE
     * speed, so two things drifting together at the same velocity are silent
     * however fast the pair is travelling.
     */
    this.contactFloor = opts.contactFloor ?? 1.0;
    /**
     * How fast an armed body has to be moving to carry the event flag, in m/s.
     *
     * Below `Impact.KINETIC_MIN_SPEED` (6) by a margin, so a body is always
     * listening before it can do harm. Squared once here because the step loop
     * asks the question of every armed body every step.
     */
    /**
     * Seconds of simulated time, handed to every contact as `c.time`.
     *
     * A consumer that needs "not again for a while" has nowhere else to get a
     * clock: the physics world is stepped from gameplay but does not carry
     * gameplay's time, and `performance.now()` is wall time, which runs on
     * through a pause and does not run at all in a headless replay.
     */
    this.simTime = 0;
    this.contactArmSpeed = opts.contactArmSpeed ?? 4;
    this._armSpeed2 = this.contactArmSpeed * this.contactArmSpeed;

    this.maxBodies = opts.maxBodies ?? 1400;
    this.killY = opts.killY ?? -180;
    this.stats = { bodies: 0, contacts: 0, awake: 0, ms: 0, colliders: 0, rapier: 0, joints: 0, substeps: 1, overBudget: 0 };

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
    // Same terminal contract as `add` and `addStaticBox`: remember what was
    // asked for, build nothing. `_buildHeightfield` ends in a `createCollider`
    // on a world that is null once `dispose()` has run.
    if (this.dead) { this._terrain = t; return; }
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

  /**
   * …AND A BODY THAT IS IN THE WORLD IS NOT DEAD.
   *
   * `remove` sets `body.dead = true` and this never cleared it, so the flag
   * meant "has been removed at least once" rather than "is not simulated" —
   * and every reader believes the second sentence. A body can come back:
   * `Enemy._tickGetUp` takes the walking capsule out when a droid is knocked
   * flat (`bodyRemoved = true`) and calls `add` again when it stands up.
   *
   * Measured with `tools/_deadflag.mjs`, one B1, knocked down and recovered:
   *
   *     standing   dead=false  inWorld=true   forceSeen=true
   *     knocked    dead=true   inWorld=false
   *     back up    dead=true   inWorld=true   forceSeen=FALSE
   *
   * `Player._grippableBody` opens `if (!b || b === this.body || b.dead) return
   * false`, and `_forceSeen` is what the aim ray asks. So a droid the player
   * had already put on its back could never be gripped, pulled or thrown
   * again: the ray passed straight through it to whatever stood behind, for
   * the rest of that body's life. Every enemy in the game becomes one of these
   * the first time a push lands.
   *
   * One line, and it belongs here rather than at the call site — `add` is the
   * only place that knows the body is now simulated, and a caller that has to
   * remember to clear a flag the world set is the same defect waiting for the
   * next caller.
   */
  /** Build the event queue the first time anything asks for contacts. */
  _armContacts() {
    if (this._events || this.dead || !this.world) return;
    this._events = new this.R.EventQueue(true);
  }

  add(body) {
    if (this.dead) { if (body) body.dead = true; return body; }
    if (!body.isRapier) throw new Error('RapierWorld.add: not a Rapier body — pass a `shape:`.');
    if (this.bodies.length >= this.maxBodies) this._cullOldestDebris();
    this.bodies.push(body);
    body.dead = false;
    body._bind(this);
    if (body._onContact) this._armContacts();
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

  /**
   * THE BODY BUDGET SPENDS DEBRIS, AND NOTHING ELSE.
   *
   * This had a second pass under the debris one that took the first non-static
   * body in insertion order, guarded only by `b.userData.keep` — a flag READ
   * here and in the sphere solver's twin and WRITTEN NOWHERE in src/, so the
   * guard was vacuous and the pass was unfiltered. (The vacuous read is gone
   * from this line too, and from the twin: a flag with no writer is a promise
   * of protection that nothing can claim, and the protection below is
   * structural instead. Both were the last two reads of it in the tree.)
   * Measured at `maxBodies: 300`
   * (the settings slider's MINIMUM — what a player on a weak machine sets),
   * twelve acolytes killed per round over six rounds, no debris on the field:
   *
   *     711 fallback culls — victims PLAYER×1, PROP×2, RAGDOLL×708
   *
   * Every one of those is a live object with no way back. The player's proxy is
   * added exactly once, in the Player constructor, so after its cull `rb` is
   * null forever: nothing collides with the player and `_push` writes into
   * nothing. A prop's mesh stays in the scene without its collider — a wall you
   * now walk through, created at runtime. And a corpse's bone taken out from
   * under it drops every joint that touched it while `syncRagdoll` keeps
   * copying a transform off a null `rb`.
   *
   * The trigger is a batch death: `goRagdoll` adds ~10-17 bodies for ONE corpse
   * in ONE frame, so twelve simultaneous deaths clear the cap in a single frame
   * with no debris in the world to absorb it.
   *
   * So the rule is now structural rather than flag-based, and it is the whole
   * of the fix rather than a guard on kinematic proxies:
   *
   *   · DEBRIS is the only unbounded producer in the game — cut chunks, gibs,
   *     rubble, all made at runtime with nothing counting them. It is what the
   *     budget exists for and it is all the budget may spend.
   *   · Everything else already has an owner that knows how to take it away
   *     WHOLE: `Corpses` retires a corpse by worth, fades it and disposes it
   *     (and takes its bodies out of the world 0.75 s after it stops moving);
   *     props and architecture belong to the level. A budget that evicts one
   *     bone of a live corpse is not enforcing a bound, it is corrupting an
   *     object that another system still holds — and it is the same defect a
   *     second time, so both halves are closed here.
   *   · When there is no debris left, the budget is not met. That is honest and
   *     it is bounded: the overshoot is a batch of deaths, and `Corpses` drains
   *     it within a second at every tier (low is 6 corpses ≈ 100 bodies against
   *     a 300 floor). `stats.overBudget` counts the refusals so the pressure is
   *     visible instead of silent.
   */
  _cullOldestDebris() {
    for (const b of this.bodies) {
      if (b.layer === LAYER.DEBRIS && !b.static) {
        if (b.userData.onCull) b.userData.onCull();
        this.remove(b);
        return true;
      }
    }
    this.stats.overBudget++;
    return false;
  }

  /* ── statics ─────────────────────────────────────────────────────── */

  /**
   * …and the same terminal contract `add()` has. A dead world has no
   * `this.world`, so the `createCollider` at the end of this used to throw
   * `Cannot read properties of null` where `add()` refuses cleanly and
   * `removeStaticBox`, `step`, `raycast` and `querySphere` all return without
   * incident. It is not reachable from the shipping game — every caller in
   * src/ (Props.js, Trees.js, Destruction.js) runs during level dressing on a
   * live world — but a terminal state that refuses six of its eight entry
   * points and throws on the other two is not a contract, it is a coincidence.
   */
  addStaticBox(center, halfExtents, quat = new THREE.Quaternion(), opts = {}) {
    if (this.dead) return null;
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
      /* `disabled` is installed as a property below, once the collider exists —
       * it has to be able to reach it. */
      onContact: opts.onContact || null,
    };
    const desc = R.ColliderDesc.cuboid(Math.max(1e-3, halfExtents.x), Math.max(1e-3, halfExtents.y), Math.max(1e-3, halfExtents.z))
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setFriction(rec.friction)
      .setRestitution(rec.restitution)
      .setCollisionGroups(collisionGroups(LAYER.WORLD, LAYER.ALL));
    rec.collider = this.world.createCollider(desc);
    /**
     * `disabled` IS A PROPERTY NOW, BECAUSE AS A FIELD IT WAS A LIE.
     *
     * Six hand-rolled queries honour it — `Support.supportHeight` and
     * `ceilingHeight`, `Player._gatherNear` and `_collide`, and both of
     * `Enemy`'s sweeps — and Rapier honoured none of it: `createCollider`
     * leaves a live cuboid in the solver whatever this field says. So a box
     * switched off was passable to the player and to every droid, and solid to
     * everything that goes through the solver.
     *
     * MEASURED by the lane that found it, on a breached blast door — a 0.8 m
     * crate shoved at 9 m/s from 0.90 m out: with the flag alone it ends
     * 0.92 m in front of the doorway and never moves; with the collider gone
     * it ends 1.28 m inside. That is the player's own "there are invisible
     * walls or objects for example on geonosis that block you", and it was
     * reachable by any future caller who trusted the field.
     *
     * That lane fixed its own call site by removing the collider outright,
     * which is right for a door that is GONE. This is the other half: a caller
     * who wants the box back — a shield that drops, a bridge that swings —
     * writes the flag and Rapier now agrees with the six readers above.
     * `setEnabled` is the vendored engine's own verb for exactly this and
     * costs nothing while nobody writes the flag.
     */
    let off = false;
    Object.defineProperty(rec, 'disabled', {
      enumerable: true,
      get() { return off; },
      set(v) {
        const want = !!v;
        if (want === off) return;
        off = want;
        try { rec.collider?.setEnabled?.(!want); } catch { /* a collider already removed */ }
      },
    });
    this._byCollider.set(rec.collider.handle, { box: rec });
    // One array, shared with the sphere solver, so a ragdoll still piles up
    // against architecture and removeStaticBox still reaches both.
    this.staticBoxes.push(rec);
    this.boxVersion++;
    return rec;
  }

  /**
   * Every static box whose own circle could reach within `reach` of (x, z),
   * appended to `out`. A SUPERSET — the caller keeps its own distance test.
   *
   * This is the one place `staticBoxes` is meant to be searched from. Sweeping
   * the array by hand still works and still gives the same answer; it costs
   * O(every box in the level) per body per frame, which is what the three notes
   * quoted in BoxIndex.js are each a local workaround for.
   */
  nearBoxes(x, z, reach, out) {
    return this.boxIndex.query(this.staticBoxes, this.boxVersion, x, z, reach, out);
  }

  removeStaticBox(box) {
    const i = this.staticBoxes.indexOf(box);
    if (i >= 0) { this.staticBoxes.splice(i, 1); this.boxVersion++; }
    if (box && box.collider) {
      this._byCollider.delete(box.collider.handle);
      this.world.removeCollider(box.collider, false);
      box.collider = null;
    }
  }

  /* ── step ────────────────────────────────────────────────────────── */

  /**
   * THE FRAME'S WORTH OF SIMULATION, IN STEPS THE SOLVER CAN ACTUALLY TAKE.
   *
   * This used to open `dt = Math.min(dt, 1/30)` and hand that to Rapier once.
   * 1/30 is a stability bound on ONE integration step; used as a bound on the
   * FRAME it silently throws the rest of the frame away, and `main.js` clamps
   * at 0.1 s and hands that whole value to every player, enemy, blade and bolt.
   * So below 30 fps the rigid-body world ran slow while everything the player
   * drives ran at full speed. Measured, a 20 m free fall at g=22 whose true
   * answer is 1.35 s:
   *
   *     dt=1/240 → 1.34 s    dt=1/30 → 1.37 s    dt=0.1 → 4.10 s
   *     dt=1/60  → 1.35 s    dt=1/15 → 2.73 s
   *
   * At main.js's own clamp a crate, a corpse or a severed limb fell at a THIRD
   * of the rate a character walks at, and `Destruction._impactScan`, which
   * gates on `b.velocity`, stopped seeing heavy impacts at low framerates
   * because the velocity it reads was a third of what gameplay believed.
   *
   * Substepping keeps the bound where it belongs — on the step — and advances
   * the world by the whole frame. The substep count is capped so a frame that
   * is already slow cannot buy itself three more physics steps and spiral;
   * main.js's 0.1 clamp means the cap is not reachable from the game loop, and
   * it is here for the callers that are not the game loop.
   */
  step(dt) {
    if (this.dead) return;
    if (!(dt > 0)) return;
    dt = Math.min(dt, MAX_FRAME);
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_STEP)));
    const h = dt / n;
    let ms = 0, contacts = 0;
    for (let s = 0; s < n; s++) { this._stepOnce(h); ms += this.stats.ms; contacts += this.stats.contacts; }
    this.stats.ms = ms;
    this.stats.contacts = contacts;
    this.stats.substeps = n;
  }

  /** ONE integration step, of at most MAX_STEP. See `step`. */
  _stepOnce(dt) {
    const t0 = performance.now();
    this.simTime += dt;

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
      // What it was doing before Rapier touched it — one copy per body per
      // step, and the only thing that makes a contact's impulse knowable.
      b._pv.copy(b.velocity);
      /* …and whether it is moving fast enough to be worth listening to.
       * The guard is the cheap half of the question asked inline: a body that
       * is asleep and not currently armed can neither hit anything nor need
       * disarming, and a settled pile is almost entirely that. */
      if (b._onContact && (b.awake || b._armed)) b._syncContactArm();
      b._push();
    }

    this.world.timestep = dt;
    this.world.step(this._events || undefined);

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

    /**
     * DISPATCHED HERE, AFTER THE PULL, SO HANDLERS SEE A COHERENT WORLD.
     *
     * Every body's `.position` and `.velocity` are the post-step values a
     * handler would expect to read, and `._pv` still holds what it was doing
     * on the way in — which is the pair the impulse is computed from.
     */
    if (this._events) this._dispatchContacts();

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
      // the kill plane — and it is written so that NaN falls through it rather
      // than past it. `y < killY` is false for NaN, which is how a body that
      // had already gone non-finite stayed in the world forever; `!(y >= killY)`
      // is the same test for every real number and true for NaN.
      if (!(b.position.y >= this.killY) || !finite3(b.position)) {
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

  /**
   * Tell both sides of every new contact, once.
   *
   * WHAT THIS CANNOT GIVE YOU, said plainly rather than guessed at: a contact
   * START carries only the two collider handles. Rapier's manifold — the true
   * normal and the true contact point — is not populated for the pair at the
   * moment the start is reported (probed on the vendored build: the
   * `contactPair` callback does not fire), so `normal` here is the direction
   * of the RELATIVE VELOCITY and `point` is the midpoint between the two
   * bodies. That is an approximation, and it is the same approximation the
   * three hand-rolled sweeps this replaces were already making — Player's
   * hurl sweep drives its knockback off the thrown thing's velocity and places
   * its effects at the thrown thing's position. Nothing loses fidelity by
   * coming through here; several things gain a contact they never had.
   *
   * The payload is a SCRATCH object, reused for every contact in the frame.
   * Handlers run synchronously inside the drain and must not keep it.
   */
  _dispatchContacts() {
    const q = this._events;
    /**
     * COLLECTED FIRST, PRICED A STEP LATER, DISPATCHED AFTER THE DRAIN.
     *
     * Two separate reasons, and they compose into one buffer.
     *
     * The drain callback runs inside Rapier's own iteration over its event
     * buffer, on the WASM side. A handler is game code, and game code kills
     * things: `Enemy.die` removes bodies, a shattering prop replaces its own
     * collider. Calling `removeRigidBody` from inside that callback mutates
     * the world Rust is mid-way through walking. So the drain does nothing but
     * copy handles into a flat list, and every handler runs after it has
     * returned — by which time removing a body is the ordinary, safe act it is
     * everywhere else in this file.
     *
     * And the pair is priced one step after it is reported, because that is
     * when Rapier resolves it — see `_contactPending`. A start whose impulse
     * never arrives (a speculative contact that separated again, a graze) then
     * prices at zero and is dropped by `contactFloor`, which is the graze
     * rejection working rather than a case being missed.
     *
     * Handles are safe to hold across the gap because `remove` deletes a
     * body's colliders from `_byCollider`: a pair whose body died earlier in
     * the same frame resolves to nothing and is skipped, rather than
     * resolving to a stale body through a handle Rapier has reissued.
     */
    const pairs = this._contactPending;
    let n = 0;
    for (let i = 0; i < pairs.length; i += 2) {
      const r1 = this._byCollider.get(pairs[i]), r2 = this._byCollider.get(pairs[i + 1]);
      const a = r1 ? r1.body : null, b = r2 ? r2.body : null;
      // Neither side is a body — two static boxes cannot begin to touch, but a
      // handle we have no record of is a collider somebody else owns.
      if (!a && !b) continue;
      if (a && a.dead) continue;
      if (b && b.dead) continue;
      const ah = a && a._onContact, bh = b && b._onContact;
      if (!ah && !bh) continue;

      /**
       * THE MASS THAT MEETS THE OTHER THING — the reduced mass.
       *
       * Two free bodies share the exchange, so a 22 kg crate hitting an 80 kg
       * trooper delivers as 17.3 kg and not as 22; a body meeting the
       * architecture, a wall or the ground meets something that cannot recoil,
       * so it delivers all of itself. Standard two-body result, computed here
       * rather than in the consumers so every consumer prices a hit the same.
       */
      /* KINEMATIC COUNTS AS IMMOVABLE, and that is not a shortcut. A
       * kinematic body — the player's capsule is one — goes exactly where
       * gameplay puts it and never recoils from a contact, so its effective
       * mass in the exchange is infinite, the same as a wall's. Reading its
       * declared mass instead would halve every hit the player takes from a
       * crate and, worse, would let its gameplay-driven `Δv` be mistaken for
       * an impact below. */
      const ma = a && !a.static && !a.kinematic ? a.mass : 0;
      const mb = b && !b.static && !b.kinematic ? b.mass : 0;
      const mass = (ma > 0 && mb > 0) ? (ma * mb) / (ma + mb) : (ma > 0 ? ma : mb);

      /**
       * TWO THINGS THAT CANNOT RECOIL — the regime Δv cannot price at all, and
       * the one that covers every LIVING body in the game.
       *
       * `Enemy` and `Player` carry KINEMATIC capsules: they go exactly where
       * gameplay puts them and a contact never changes their velocity. So the
       * whole trick this dispatcher rests on — read the impulse off `mass ×
       * (v_after − v_before)` — reads zero for both sides of a droid walking
       * into a droid, a beast charging a line, or an AT-TE stepping through
       * infantry. `mass` above is 0 for such a pair and everything below it
       * would divide by nothing.
       *
       * Those are not edge cases. A crewed machine in this game IS an `Enemy`
       * with a vehicle archetype (see `Driving.isCrewed`), so this branch is
       * what makes a walker running you over a physical event rather than
       * scenery walking through you.
       *
       * With no recoil to measure, the honest quantity is the CLOSING SPEED
       * along the line between them, which is the same thing the retired sweep
       * used and rejects a graze the same way Δv does: a walker striding PAST
       * you closes at almost nothing, and one striding INTO you closes at its
       * full pace.
       */
      let approach = 0;
      if (!(mass > 0)) {
        const da = a && a.mass > 0 ? a.mass : 0, db = b && b.mass > 0 ? b.mass : 0;
        // a static box or the heightfield: there is no exchange to price
        if (!(da > 0 && db > 0)) continue;
        _v4.copy(b.position).sub(a.position);
        const d = _v4.length();
        if (d < 1e-4) continue;
        _v4.multiplyScalar(1 / d);
        /**
         * MEASURED WHERE THEY MEET, NOT AT THEIR CENTRES.
         *
         * The carried speed is a property of the body's centre, and for a
         * compact thing that is the whole story. For a LONG one it is not: a
         * twenty-metre trunk sweeping down about its stump has a centre that is
         * travelling almost straight down while the man it is about to land on
         * is six metres off to the side, so the closing speed along the line
         * between the two centres came out at nearly zero and the contact was
         * dropped under `contactFloor`. A tree fell through a man three times
         * with three real start events to show for it.
         *
         * So each side contributes the velocity at the point of ITS OWN body
         * nearest the other — `v + ω × r`, the standard rigid-body result —
         * and for a capsule "nearest point" is a projection onto its axis,
         * which is exactly what a trunk, a limb and a living body all are.
         */
        _nearestOn(a, b.position, _v6);
        _nearestOn(b, a.position, _v7);
        _pointVel(a, _v6, _v8);
        _pointVel(b, _v7, _v9);
        /* …and the line between those two points rather than between the
         * centres, for the same reason. */
        _v4.copy(_v7).sub(_v6);
        const dd = _v4.length();
        if (dd > 1e-4) _v4.multiplyScalar(1 / dd);
        approach = _v5.copy(_v8).sub(_v9).dot(_v4);
        if (approach < this.contactFloor) continue;
        const c2 = _contact;
        c2.speed = approach;
        c2.impulse = 0;
        c2.approach = true;
        c2.time = this.simTime;
        c2.normal.copy(_v4);
        /* BETWEEN THE POINTS THAT MEET, not between the centres. A consumer
         * that asks WHERE it was hit — `Forest._priceTrunk` reads this back to
         * find how far along the trunk the blow landed — gets the answer the
         * geometry gives rather than one biased toward the middle of a
         * twenty-metre rod. Measured: the giant's stump end priced at 82
         * against a bound of 60, because the midpoint of the two CENTRES sits
         * most of the way up the trunk from where it actually struck. */
        c2.point.copy(_v6).add(_v7).multiplyScalar(0.5);
        c2.world = false;
        n++;
        /* THE MASS IS THE STRIKER'S OWN, set per handler rather than once.
         * A 900 kg walker meeting a 52 kg B1 is not one number: the walker
         * delivers a walker's worth and the droid delivers a droid's worth,
         * and handing both sides the same reduced mass would have the B1
         * hitting back like a walker. */
        const ah2 = a._onContact, bh2 = b._onContact;
        if (ah2) { c2.self = a; c2.other = b; c2.mass = a.mass; ah2.call(a, b, c2); }
        if (bh2 && !b.dead) {
          c2.self = b; c2.other = a; c2.mass = b.mass;
          c2.normal.negate(); bh2.call(b, a, c2); c2.normal.negate();
        }
        continue;
      }

      /**
       * HOW HARD, AND WHY IT IS NOT THE CLOSING SPEED.
       *
       * The obvious reading — how fast were these two approaching — is wrong
       * in a way a sandbox notices immediately: it cannot tell a hit from a
       * GRAZE. Measured with the first version of this dispatcher, a crate
       * skidding along flat ground at 30 m/s reported a 30 m/s impact with the
       * world every time the contact restarted, because almost all of that
       * speed was tangential and none of it was being exchanged.
       *
       * Rapier already knows the true answer and states it as a change of
       * velocity: the impulse it applied to resolve the contact is
       * `mass × (v_after − v_before)`, which is zero for a graze and maximal
       * for a head-on hit, with every angle in between handled for free and no
       * contact normal required — which matters, because a contact START does
       * not carry a usable manifold (see the note above).
       *
       * `speed` is then that impulse expressed back as a closing speed,
       * `J / μ`, so it is in the same units the hand-rolled sweeps used and
       * `impactDamage(mass, speed)` prices a contact identically to the throw
       * it replaces. Sanity: two equal masses meeting head-on at ±15 m/s each
       * take Δv = 15, giving J/μ = 30 — the closing speed, as it should be.
       *
       * Two residues, stated rather than hidden. About `g·dt` of the reading
       * is gravity rather than the other body — 0.5 m/s at a 1/60 s step,
       * which is what `contactFloor` sits above. And a very fast hit is
       * resolved over more than one step: measured at 90 m/s the exchange came
       * as Δv of 60 and then 10.65, so a single step's reading is 85% of it.
       * Only the first step is counted, so the number is a FLOOR on the hit
       * and never an over-read — which is the safe direction for a thing that
       * decides damage.
       */
      /**
       * BOTH SIDES ARE READ AND THE LARGER IS BELIEVED — and it was written
       * the other way round first, for a reason that sounded better than it
       * was.
       *
       * The argument for the SMALLER reading: Newton's third law says the two
       * impulses are equal, so a disagreement means one side was moved by
       * something that is not this contact, and the smaller number is the one
       * the contact can account for. That is true of a free pair and wrong
       * about the commonest case in the game. `contacts.mjs`'s first check
       * caught it: a crate dropped nine metres onto a body resting on the
       * ground priced at ZERO, because the struck body is BRACED — the impulse
       * it receives goes through it into the floor, its net change of velocity
       * over the step is nearly nothing, and the third law does not apply
       * pairwise when a third constraint is taking the load.
       *
       * The side that was moving freely and got stopped is the one whose Δv is
       * a real measure of this contact, and it is always the larger of the two.
       * A body being driven by its own locomotion changes velocity by very
       * little per step, so it does not win this comparison; a crate arriving
       * at 18 m/s does.
       */
      let J = 0;
      if (ma > 0) J = ma * _v4.copy(a.velocity).sub(a._pv).length();
      if (mb > 0) {
        const Jb = mb * _v5.copy(b.velocity).sub(b._pv).length();
        J = ma > 0 ? Math.max(J, Jb) : Jb;
      }
      const speed = J / mass;
      if (speed < this.contactFloor) continue;

      const c = _contact;
      c.speed = speed;
      c.mass = mass;
      c.impulse = J;
      c.approach = false;
      c.time = this.simTime;
      /**
       * The direction the exchange pushed, which is the direction a consumer
       * wants for knockback. It is the Δv of whichever side was measured —
       * for the struck body that is the way it was shoved, and for the
       * striking body it is the reverse, so it is flipped per handler below.
       */
      /* The direction the exchange pushed, taken from the side that was
       * believed above. `_v4` holds A's Δv, `_v5` holds B's — which points the
       * other way, so it is negated to keep `normal` meaning "the way A was
       * shoved" whichever side supplied it. */
      const fromA = ma > 0 && (mb <= 0 || ma * _v4.length() >= mb * _v5.length());
      if (fromA) c.normal.copy(_v4);
      else c.normal.copy(_v5).negate();
      c.normal.multiplyScalar(1 / Math.max(1e-6, c.normal.length()));
      if (a && b) c.point.copy(a.position).add(b.position).multiplyScalar(0.5);
      else c.point.copy(a ? a.position : b.position);
      // Neither side is a body: the other party is the world — a static box,
      // a wall, the heightfield. `null` is what the retired solver passed for
      // exactly this and the contract is kept.
      c.world = !a || !b;

      n++;
      /* `normal` means "the way A was shoved", so B sees it reversed. */
      if (ah) { c.other = b; c.self = a; ah.call(a, b, c); }
      // The second handler is re-checked: the first may have killed the body.
      if (bh && !b.dead) {
        c.other = a; c.self = b;
        c.normal.negate();
        bh.call(b, a, c);
        c.normal.negate();
      }
    }

    /**
     * Only now are this step's new starts collected, to be priced on the next
     * one. Processing the old list before refilling it is what makes the
     * one-step deferral a single buffer rather than two.
     */
    pairs.length = 0;
    q.drainCollisionEvents((h1, h2, started) => {
      if (started) pairs.push(h1, h2);
    });
    this.stats.contacts = n;
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
   *
   * AND ONCE IT IS DEAD IT STAYS DEAD, whoever asks. `dispose()` is guarded —
   * `if (this.dead) return;` — but this was not, so a second teardown walked
   * straight past that guard and allocated a whole Rapier world here: broad
   * phase, narrow phase, island manager, every pipeline, inside WASM linear
   * memory, which is monotonic and never handed back. Nothing could then reach
   * it, and `dispose()` would decline to free it because `dead` was already
   * true. Driven: after `World.dispose()` twice, `physics.dead` is true and
   * `physics.world` is a live `RAPIER.World` with freshly constructed
   * physicsPipeline, serializationPipeline and debugRenderPipeline; a third
   * dispose strands another.
   *
   * The path that reaches it is `deploy()`'s own recovery in main.js:
   * `buildWorld` opens with `if (world) { world.dispose(); world = null; }`,
   * and if that dispose throws, the module-level `world` is still the old one
   * and the catch block disposes it a second time. One stranded Rapier world
   * per occurrence — the order of magnitude tools/checks/session.mjs measured
   * for the earlier always-reallocate form of this same bug was 28.2 KB a
   * cycle. One line, and the terminal state is actually terminal.
   */
  clear(realloc = true) {
    if (this.dead) realloc = false;
    for (const b of this.bodies) { b.dead = true; b.rb = null; b.colliders = null; b._world = null; }
    for (const j of this.joints) { j.broken = true; j.joint = null; j._world = null; }
    this.bodies.length = 0;
    this.joints.length = 0;
    this.staticBoxes.length = 0;
    this.boxVersion++;
    this.boxIndex.reset();
    this._byCollider.clear();
    this._hf = null;
    this._hfSeq = -1;
    // A fresh Rapier world is cheaper and far safer than unpicking every
    // collider, joint and island by hand.
    this._events?.free?.();
    this._events = null;
    this._contactPending.length = 0;
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
