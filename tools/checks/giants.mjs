/**
 * BATTLEFRONT BORZ — the giants, and whether they are five machines or one.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * The player, in full, because every clause of it is a check below:
 *
 *   "I want some vehicles and/or creatures that are truly large and giant like
 *    AT-AT or AT-M6 sized but obviously not those since they werent in the
 *    prequels, if needed come up with your own, they should be incredibly
 *    deadly and dangerous and difficult to take down, some piloted obvously;
 *    for example Republic's Self-Propelled Heavy Artillery (SPHA), a massive
 *    12-legged walker/gun platform measuring an immense 140.2 meters (460 feet)
 *    in length. also HAVw A6 Juggernaut, better known as the Clone Turbo Tank,
 *    is a massive 49.4-meter-long, 10-wheeled heavy assault vehicle used by the
 *    Galactic Republic during the Clone War; Octuptarra Magna Tri-Droid is a
 *    massive, super-heavy walking artillery and combat walker utilized by the
 *    Confederacy of Independent Systems (CIS), manufactured by the Skakoans of
 *    the Techno Union during the Clone Wars… (All Terrain Tactical Enforcer
 *    (AT-TE) is a rugged, six-legged assault walker… Built for extreme
 *    versatility, its magnetized footpads allow it to scale vertical cliffs…
 *    (might already be in the game idk)… also the NR-N99 Persuader-class droid
 *    enforcer, also known as the Corporate Alliance tank droid or snail tank…
 *    Look up other vehicles/mechs/monsters that we could be mssing. all of
 *    these need to be accurate and act/move/fire differently as canon"
 *
 * `tools/checks/vehicles.mjs` already holds the four line machines to a rule —
 * NO TWO OF THEM MAY SHARE A SILHOUETTE OR A CADENCE — which exists because of
 * an earlier note ("all your monsters look the same, sphere with some legs…
 * they all attack the same way"). This file holds the giants to that rule plus
 * the one the newer note adds, which is the one that is easy to fail without
 * noticing:
 *
 *   NO TWO OF THEM MAY MOVE ALIKE EITHER.
 *
 * A twelve-legged artillery platform that walks like the six-legged one and
 * fires like the tank is three reskins with different hulls on them, and until
 * the giants landed the two functions that move every big body in this game —
 * `Enemy._move` and `_poseWalker` — knew exactly two facts about a machine: how
 * fast it walks, and whether it is `big`. So the difference is FOUR NUMBERS on
 * the archetype (`plant`, `turnRate`, `grade`, `toppleAt`) and this file
 * measures all four off a DRIVEN BODY rather than reading them back out of the
 * table that declared them.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH IS THE HONEST FORM OF THE QUESTION ─────
 *
 *   CANON        every dimension the reference states, against the machine as
 *                built, through the scale divisor the builder claims. The
 *                divisor is the interesting part: 140.2 m at 1:1 is a third of
 *                the width of the playfield, so the SPHA is built at 1:4 and
 *                the check turns "built at 1:4" from a comment into a number.
 *   VERTICES     and the box is measured off actual TRANSFORMED VERTICES, not
 *                off `Box3.setFromObject`. Three inflates a rotated mesh's box
 *                to the box of its rotated local box: measured, that reads the
 *                SPHA 19.99 m tall against a true 16.75 and reports five legs
 *                through the floor that are not. A machine made of tilted legs
 *                cannot be measured any other way.
 *   CONTACTS     counted off the rig — leg chains and wheel chains — never read
 *                off a list. 12 / 10 / 3 / 3 / 6.
 *   MOVEMENT     five numbers a suite can read off a driven body: contacts, the
 *                share of a second in band spent moving, seconds to come about,
 *                the steepest slope it still makes half pace on, and top speed.
 *                Every pair must differ on at least three of the five.
 *   CADENCE      burst, cycle and volley, against each other AND against the
 *                five machines already on the roster, so a giant cannot be a
 *                heavier reskin of the hailfire.
 *   THE ANSWER   each one declares how it is meant to die (`GIANT_CANON.kill`),
 *                and the check is that the declaration matches the shipped
 *                `toppleAt`, that the number is reachable, that the thing it
 *                names is within a standing player's blade reach, and that
 *                there is a weak point on it.
 *   FACTION      the same word in Vehicles.js, the databank and the reference
 *                table, and a pool that can actually field it.
 *   COST         draw calls at both LODs. A 34.7 m machine is not allowed to
 *                cost 34.7 m of them.
 *
 * ── THE ONE THING THIS FILE DELIBERATELY DOES NOT DO ─────────────────────
 *
 * It does not re-derive `toppleAt`, `severanceOf`, the LOD keep rule or the
 * grade falloff. All four are imported or driven. HANDOFF §2.4: an instrument
 * that restates a rule will eventually disagree with it, and it fails in the
 * direction nobody checks — it MANUFACTURES defects. The `grade` measurement in
 * particular is a binary search over a real slope through the shipped `_move`,
 * which is why it recovers the declared number instead of asserting it.
 */

import * as THREE from 'three';
import { ARCHETYPES, enemyRng, toppleAt, severanceOf, AXIAL_ROLES } from '../../src/game/Enemy.js';
import { GIANT_TYPES, GIANT_CANON, VEHICLE_TYPES, VEHICLE_SIDE } from '../../src/game/Vehicles.js';
import { DATABANK, factionOf } from '../../src/game/Databank.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { TOUGHNESS } from '../../src/game/Combat.js';
import { clocked } from './_shared.mjs';

/**
 * A STANDING PLAYER'S BLADE, in metres off the floor.
 *
 * The number the "reachable" clause turns on, and it is deliberately generous:
 * a hilt held at chest height with a metre of blade above it reaches about
 * 2.6 m, and an overhead swing more. 2.6 is what a leg has to come down to for
 * "take its legs" to be advice rather than a slogan.
 */
const BLADE_REACH = 2.6;

/* ══════════════════════════════════════════════════════════════════════ */
/*  A live world, and one body of each kind in it                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * FLAT GROUND, IN BOUNDS EVERYWHERE — the same stub `vehicles.mjs` and
 * `beasts.mjs` stand their subjects on, and for the same reason: what is being
 * asked is about the body, and a real heightfield would make every number
 * depend on where the probe happened to stand.
 *
 * `slopeAt` is the one field that is not a constant here. See `sloped()`.
 */
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/**
 * A CONSTANT BANK, at a stated `slopeAt` reading.
 *
 * `Terrain.slopeAt` is `1 - clamp(n.y, 0, 1)`, so a plane whose normal is
 * (0, 1, -k) normalised reads `1 - 1/sqrt(1 + k^2)`. Inverting that gives the
 * gradient a bank has to have to read as slope `s`, which is what makes this
 * probe speak the same units as the `grade` field it is measuring: nothing here
 * restates the falloff, it only supplies ground of a known steepness and asks
 * the shipped `_move` how fast the machine gets up it.
 */
function sloped(s) {
  const inv = 1 - Math.min(0.999, s);
  const k = Math.sqrt(1 / (inv * inv) - 1);
  const ny = 1 / Math.sqrt(1 + k * k);
  return {
    height: (x, z) => k * z,
    normalAt: (x, z, o) => o.set(0, ny, -k * ny).normalize(),
    raycast: () => null,
    size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
    crater() {}, flush() {}, slopeAt: () => 1 - ny,
  };
}

const particles = {
  sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
  spatter() {}, plasma: { spawn() {} }, smoke: { spawn() {} },
};

let _phys = null;
async function physics() {
  if (_phys) return _phys;
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
  await initPhysics();
  return (_phys = { RapierWorld });
}

/**
 * One real `Enemy`, in a real Rapier world, on flat ground.
 *
 * `enemyRng` is seeded because building a body draws from it — determinism.mjs
 * holds every suite to that — and the world is wide enough for `update()` to
 * run end to end: a bolt pool that swallows, a particle bank that swallows, and
 * a `pickTarget` that hands back whatever the caller set.
 */
async function live(type, target = null) {
  const { RapierWorld } = await physics();
  enemyRng.seed(4711);
  const { Enemy } = await import('../../src/game/Enemy.js');
  const terrain = flat();
  const w = {
    scene: new THREE.Scene(),
    physics: new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 96 }),
    terrain, statics: [], settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [], particles,
    bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xa9764a, difficulty: null,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, addHitstop() {}, notifyFloating() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  w.physics.terrain = terrain;
  const e = new Enemy(w, type, new THREE.Vector3(0, 0, 0));
  w.enemies.push(e);
  e._probeTarget = target;
  return e;
}

/** The ctx an `Enemy.update` wants, with a target it will actually pick. */
const ctxFor = (e, terrain) => ({
  enemies: e.world.enemies, particles, terrain: terrain || e.world.terrain,
  physics: e.world.physics, bolts: e.world.bolts, time: 0,
  pickTarget: () => e._probeTarget, camera: e.world.engine.camera,
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Measuring the shape                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

const _v = new THREE.Vector3();

/**
 * THE BOX, OFF ACTUAL VERTICES, of a body that has been POSED.
 *
 * Two decisions, and both were wrong the first time round.
 *
 * POSED AND NOT AT REST. `vehicles.mjs` measures a rest pose because that is
 * the only pose reproducible without an Enemy, a World and a terrain, and for a
 * machine 3 m across the difference is small. It is not small here: an AT-TE's
 * width is its FOOT SPAN, and where a foot plants is `stance.plantX`, which the
 * rest pose does not use at all — measured, the same hull reads 8.6 m wide at
 * rest and 10.0 m posed, and the canon figure is 10.2. A rest-pose check would
 * have called the fix a regression.
 *
 * VERTICES AND NOT `Box3.setFromObject`. Three computes a mesh's world box by
 * transforming the eight corners of its LOCAL box, which for a rotated mesh is
 * strictly larger than the mesh. On a machine made of tilted legs that is not a
 * rounding error: the SPHA reads 19.99 m tall against a true 16.75, and five of
 * its twelve legs report 0.23 m of themselves through the floor when nothing is
 * below zero at all. Every number in this file that a player could see is taken
 * off the vertices.
 */
function boxOfPosed(e, opts = {}) {
  /**
   * `onlyRoles` IS HOW "THE HULL" IS SAID WITHOUT NAMING A BONE.
   *
   * A machine's stated height and its belly clearance are both facts about the
   * HULL and not about the whole silhouette: the legs come down to the floor
   * and are supposed to, and the turret goes up and is supposed to. `core` and
   * `hull` are exactly the two roles a chassis segment carries in
   * `chassisSkeleton` — the spine, the mid hull, the prow, the stern and the
   * Juggernaut's observation tower — so the filter is the rig's own vocabulary
   * rather than a list of names that would go stale the first time a builder
   * renamed a segment.
   */
  const only = opts.onlyRoles ? new Set() : null;
  if (only) {
    for (const b of e.rig.list) {
      if (!opts.onlyRoles.includes(b.role)) continue;
      /* Direct MESH children of the bone, which is every mesh `primary` and
       * `Kit.bake` hang on it. A child BONE is an Object3D and is skipped by
       * the same test, so a hull segment does not drag its legs in with it. */
      for (const c of b.obj.children) {
        if (c.isMesh) c.traverse((o) => { if (o.isMesh) only.add(o); });
      }
    }
  }
  const keep = new Set();
  for (const b of e.rig.list) if (b.primary) keep.add(b.primary);
  const out = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity, meshes: 0, kept: 0, tris: 0, deepest: 0, deepAt: '',
  };
  const owner = new Map();
  for (const b of e.rig.list) for (const m of b.parts) owner.set(m, b.name);
  e.rig.root.updateMatrixWorld(true);
  e.rig.root.traverse((o) => {
    if (!o.isMesh) return;
    out.meshes++;
    if (keep.has(o) || o.userData.silhouette) out.kept++;
    const g = o.geometry;
    out.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (only && !only.has(o)) return;
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      _v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      if (_v.x < out.minX) out.minX = _v.x;
      if (_v.x > out.maxX) out.maxX = _v.x;
      if (_v.y < out.minY) out.minY = _v.y;
      if (_v.y > out.maxY) out.maxY = _v.y;
      if (_v.z < out.minZ) out.minZ = _v.z;
      if (_v.z > out.maxZ) out.maxZ = _v.z;
      if (_v.y < out.deepest) { out.deepest = _v.y; out.deepAt = owner.get(o) || '?'; }
    }
  });
  out.w = out.maxX - out.minX;
  out.l = out.maxZ - out.minZ;
  /* HEIGHT IS OFF THE FLOOR AND NOT OFF THE BOX. These bodies stand on the
   * ground; the top of the machine above the ground is the number a reference
   * states and the number a player sees. */
  out.h = out.maxY;
  out.tris = Math.round(out.tris);
  return out;
}

/** How many independent leg chains a rig has — the shipped rule, not a list. */
function chainsOf(rig) {
  let n = 0;
  for (const b of rig.list) if (b.role === 'leg' && b.parent?.role !== 'leg') n++;
  return n;
}

/** Build, pose for 40 frames against a target dead ahead, and measure. Cached. */
const _shape = new Map();
async function shapeOf(type) {
  if (_shape.has(type)) return _shape.get(type);
  const e = await live(type);
  e.facing = 0;
  const tgt = new THREE.Vector3(0, 1.6, 30);
  e.target = { position: tgt, chest: tgt };
  const ctx = { terrain: e.world.terrain, time: 0 };
  for (let i = 0; i < 40; i++) { ctx.time += 1 / 60; e._poseWalker(1 / 60, ctx); }
  const full = boxOfPosed(e);
  /* The hull alone — the chassis segments and nothing else. It is what a
   * walker's stated HEIGHT usually means (a mass driver elevated onto a target
   * is not part of a machine's height in any reference anybody writes), it is
   * what the belly clearance is measured off, and it is what the blade has to
   * reach end to end. */
  const hull = boxOfPosed(e, { onlyRoles: ['core', 'hull'] });
  /**
   * …AND THE CORE ALONE, WHICH IS THE HEIGHT ANYTHING IS SAMPLED AT.
   *
   * `hull` is the right box for LENGTH and for the belly, and it is the wrong
   * one for HEIGHT the moment a machine carries a mast: the Juggernaut's
   * observation tower is a `hull` bone standing 15 m up, so the hull box's
   * middle is 8.3 m — three metres above the top of the tank. Sampling the
   * blade's reach at that height found the prow and stern capsules just barely,
   * and reported 67% of a hull the blade can actually reach 92% of; the
   * published proxy came out at 0% of itself for the same reason. Nothing was
   * wrong with either. The probe was measuring the air over the roof.
   *
   * `core` is the chassis spine and the mid hull and nothing else, which is
   * where a hull's own middle is on every machine in this file.
   */
  const core = boxOfPosed(e, { onlyRoles: ['core'] });
  const caps = e.capsules().map((c) => ({ ...c, enemy: null }));
  const roles = new Map();
  for (const b of e.rig.list) roles.set(b.name, b.role);
  const v = {
    type, A: ARCHETYPES[type], full, hull, core, caps, roles,
    chains: chainsOf(e.rig), topple: toppleAt(ARCHETYPES[type], e.rig),
    bones: e.rig.list.length,
    /* The lowest point of any capsule the blade is offered on a LEG chain —
     * how far a standing player has to reach to touch what the machine stands
     * on. Off the shipped `capsules()`, which is the list the solver tests. */
    legLow: Math.min(...caps
      .filter((c) => roles.get(c.covers ?? c.name) === 'leg')
      .map((c) => Math.min(c.p0.y, c.p1.y) - c.r), Infinity),
    legGaps: caps.filter((c) => c.covers && roles.get(c.covers) === 'leg').length,
  };
  e.dispose?.();
  _shape.set(type, v);
  return v;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Measuring the movement                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * METRES COVERED IN THE SECOND HALF OF A DRIVE, up a bank of a stated slope.
 *
 * The shipped `_move` end to end, with a wish that points straight uphill and
 * nothing else touching the body. The first half of the drive is thrown away
 * because velocity is damped toward the wish rather than snapped to it, so the
 * first second is acceleration and the second is pace.
 */
function driveUp(e, slope, seconds = 2.0) {
  const terr = slope > 0 ? sloped(slope) : flat();
  e.position.set(0, terr.height(0, 0), 0);
  e.velocity.set(0, 0, 0);
  e.grounded = true;
  e.facing = 0;
  e.toTarget = null;
  e.stunTimer = 0; e.knockTimer = 0; e.gripped = false; e.toppled = false;
  e._stuckT = 0; e._wallT = 0; e._wallN.set(0, 0, 0);
  const ctx = { terrain: terr, physics: e.world.physics, particles, time: 0 };
  const frames = Math.round(seconds * 60);
  let z0 = 0;
  for (let i = 0; i < frames; i++) {
    e.wish = new THREE.Vector3(0, 0, 1);
    e._move(1 / 60, ctx);
    if (i === (frames >> 1)) z0 = e.position.z;
  }
  return e.position.z - z0;
}

/**
 * THE STEEPEST GROUND THIS MACHINE STILL MAKES HALF PACE ON.
 *
 * A binary search over real banks, driven through the real `_move`, which is
 * why the number that comes back is a property of the game rather than a
 * restatement of `grade`. `Enemy` fades pace over the top 45% of the field, so
 * a machine declaring `grade: g` crosses half pace at about 0.775g — that
 * arithmetic is NOT asserted anywhere here, it is only the reason the numbers
 * come out ordered the way the declarations are.
 */
const _slope = new Map();
async function halfPaceSlope(type) {
  if (_slope.has(type)) return _slope.get(type);
  const e = await live(type);
  const flatRun = driveUp(e, 0);
  let lo = 0, hi = 1.0;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (driveUp(e, mid) >= flatRun * 0.5) lo = mid; else hi = mid;
  }
  e.dispose?.();
  const v = { slope: (lo + hi) / 2, flatRun };
  _slope.set(type, v);
  return v;
}

/**
 * SECONDS TO COME ABOUT — half a turn, to within five degrees.
 *
 * `_move` closes `dt * turnRate` of the remaining error per frame, so this is
 * an exponential approach and the honest way to state it is a time. Driven
 * rather than computed: `Math.min(1, dt * rate)` is a clamp as well as a gain
 * and a rate over 60 would turn instantly, which no arithmetic in a check would
 * have noticed.
 */
function comeAbout(e) {
  e.position.set(0, 0, 0);
  e.velocity.set(0, 0, 0);
  e.grounded = true;
  e.facing = 0;
  e.stunTimer = 0; e.toppled = false; e.gripped = false;
  e.toTarget = new THREE.Vector3(0, 0, -1);
  e.wish = null;
  const ctx = { terrain: e.world.terrain, physics: e.world.physics, particles, time: 0 };
  const want = Math.PI;
  for (let i = 0; i < 60 * 40; i++) {
    e._move(1 / 60, ctx);
    let d = want - e.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.087) return (i + 1) / 60;      // five degrees
  }
  return Infinity;
}

/**
 * THE SHARE OF A DRIVEN MINUTE SPENT MOVING, with a target standing in the
 * machine's own band and in plain sight.
 *
 * This is the `plant` measurement and it is the one number that separates a
 * siege gun from everything else on the roster. It is taken off `velocity`
 * through a full `update()` — brain, move, pose, gun — rather than off the
 * field that declares it, because what is being asked is whether the machine
 * actually stops.
 */
const _duty = new Map();
async function dutyCycle(type, seconds = 14) {
  if (_duty.has(type)) return _duty.get(type);
  const A = ARCHETYPES[type];
  const stand = (A.preferred[0] + A.preferred[1]) / 2;
  const tgt = { position: new THREE.Vector3(0, 0, stand), chest: new THREE.Vector3(0, 1.6, stand),
    dead: false, hp: 100, maxHp: 100, radius: 0.4, velocity: new THREE.Vector3() };
  const e = await live(type, tgt);
  const ctx = ctxFor(e);
  let moving = 0, frames = 0, shots = 0, lowest = Infinity, highest = -Infinity;
  const realShoot = e._shoot.bind(e);
  e._shoot = (c) => { shots++; return realShoot(c); };
  for (let i = 0; i < seconds * 60; i++) {
    ctx.time += 1 / 60;
    e.world.time = ctx.time;
    e.update(1 / 60, ctx);
    frames++;
    if (Math.hypot(e.velocity.x, e.velocity.z) > e.speed * 0.2) moving++;
    const hy = e.rig?.hipsBone?.obj?.position?.y;
    if (hy != null) { lowest = Math.min(lowest, hy); highest = Math.max(highest, hy); }
  }
  const out = { duty: moving / frames, shots, hipDrop: highest - lowest, planted: e.planted ?? 0 };
  e.dispose?.();
  _duty.set(type, out);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The flank, rasterised — the same measurement at giant scale           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ONE ABSOLUTE WORLD FRAME, 44 m WIDE AND 24 m TALL.
 *
 * `vehicles.mjs` rasterises its four into a 20 x 12 m frame, shared rather than
 * normalised so that two machines with the same proportions at different sizes
 * are not called identical. That frame is exactly why the giants are not on its
 * list: a 34.7 m artillery piece clips to the full raster, so does a 25.4 m
 * transport, and every pair involving one of them would come out overlapping
 * near 1.0 — a suite failing on four machines that could not look less alike.
 *
 * So this is the same measurement with the frame sized for its subjects, and
 * the view is along X for the same reason: the flank is what carries contact
 * count, ground clearance and where the mass sits. Head-on, everything wide is
 * "a wide thing".
 */
const RW = 176, RH = 96, RSPAN = 44, RTALL = 24;

function silhouette(root, lodOnly, keep) {
  const bits = new Uint8Array(RW * RH);
  const sx = (RW - 1) / RSPAN, sy = (RH - 1) / RTALL;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (lodOnly && !keep.has(o) && !o.userData.silhouette) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
      const P = [a, b, c].map((q) => [(q.z + RSPAN / 2) * sx, (RTALL - q.y) * sy]);
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
      const x1 = Math.min(RW - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
      const y1 = Math.min(RH - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const d0 = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(d0) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / d0;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / d0;
        if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) bits[y * RW + x] = 1;
      }
    }
  });
  return bits;
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) uni++; if (a[i] && b[i]) inter++; }
  return uni ? inter / uni : 0;
}

/* ── small helpers shared by the cadence and movement rules ──────────── */

const rel = (a, b) => (Math.max(a, b) === 0 ? 0 : Math.abs(a - b) / Math.max(a, b));
const cycleOf = (A) => A.fireRate + A.burst * (A.burstGap ?? 0.12) + (A.telegraph ?? 0);
const volleyOf = (A) => A.burst * A.damage;
const pct = (v, c) => (c == null ? null : (v / c - 1) * 100);

/* ══════════════════════════════════════════════════════════════════════ */

export async function run({ check, assert }) {
  /* Every check here drives real bodies through the real `_move` and the real
   * `update`, which draws from `enemyRng`. What that shared state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated. */
  check = await clocked(check);

  /* ──────────────────────────────────────────────────────────────────
   * THE ROSTER
   * ────────────────────────────────────────────────────────────────── */

  check('giants: five machines, every one flagged, sided and named', () => {
    assert(GIANT_TYPES.length === 5, `GIANT_TYPES holds ${GIANT_TYPES.length}, not five`);
    const rows = [];
    for (const t of GIANT_TYPES) {
      const A = ARCHETYPES[t];
      assert(A, `${t} is in GIANT_TYPES and not in ARCHETYPES — the Object.assign did not run`);
      assert(typeof A.build === 'function', `${t} has no builder`);
      assert(A.big === true, `${t} is not flagged big — Arrivals would fly it in on a dropship`);
      assert(A.custom === 'walker', `${t} declares custom '${A.custom}'; it would run the biped animator`);
      assert(A.ranged, `${t} is not ranged, and nothing else here gives a chassis an attack`);
      assert(!A.weapon, `${t} carries hand weapon '${A.weapon}' — it has no hands`);
      assert(A.toughness >= TOUGHNESS.heavy, `${t} is ${A.toughness} tough, softer than TOUGHNESS.heavy`);
      const C = GIANT_CANON[t];
      assert(C, `${t} has no entry in GIANT_CANON — nothing can measure it against its own plates`);
      assert(C.built >= 1, `${t} claims a scale divisor of ${C.built}`);
      rows.push(`${t} 1:${C.built}`);
    }
    /* The AT-TE is on both lists and that is deliberate — it is a line vehicle
     * by size and a giant by the player's own request to check it. What may not
     * happen is a machine on the giants' list that nothing else knows about. */
    const shared = GIANT_TYPES.filter((t) => VEHICLE_TYPES.includes(t));
    assert(shared.length === 1 && shared[0] === 'atte',
      `${shared.join(', ') || 'nothing'} appears on both VEHICLE_TYPES and GIANT_TYPES; only the `
      + 'AT-TE is supposed to, because it is the one machine that is both');
    return rows.join(', ');
  });

  check('giants: the side each fights for is the same word in three places', () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const C = GIANT_CANON[t];
      assert(DATABANK[t], `${t} has no databank entry — WaveDirector.sideFor cannot place it and `
        + 'the composer will not field it');
      assert(factionOf(t) === C.side,
        `${t}: the databank says ${factionOf(t)} and the reference table says ${C.side}`);
      assert(VEHICLE_SIDE[t] === C.side,
        `${t}: VEHICLE_SIDE says ${VEHICLE_SIDE[t]} and the reference table says ${C.side}`);
      rows.push(`${t}/${C.side}`);
    }
    /* AND SOMEBODY CAN ACTUALLY FIELD THEM. A machine no pool names is content
     * that shipped and cannot be met, which is `roster.mjs`'s rule — this is
     * the narrower one it cannot ask: the level that names them has to declare
     * BOTH armies, or two of the five can never appear against a player who is
     * leading the other one. */
    const homes = LEVEL_ORDER.filter((k) => GIANT_TYPES.every((t) => (LEVELS[k].pool || []).includes(t)));
    assert(homes.length >= 1,
      'no single level fields all five giants; they were placed together on purpose because the '
      + 'artillery band is 40-90 m and only one ground has a spawn ring wide enough for it');
    for (const k of homes) {
      assert((LEVELS[k].armies || []).length === 2,
        `${k} fields all five giants and does not declare two armies, so the faction rotation `
        + 'never runs there and a Jedi meets a Republic siege gun');
    }
    const sides = new Set(GIANT_TYPES.map((t) => GIANT_CANON[t].side));
    assert(sides.size === 2, `all five giants are ${[...sides].join('/')} — one side gets nothing`);
    return `${rows.join(', ')} — all five on ${homes.join(', ')}`;
  });

  /* ──────────────────────────────────────────────────────────────────
   * THE PLATES
   * ────────────────────────────────────────────────────────────────── */

  /**
   * ACCURACY, AND THE TOLERANCES ARE NOT THE SAME IN EVERY AXIS.
   *
   * Length and width are ±6%. A reference states them off a plan view and the
   * builders are held to that.
   *
   * HEIGHT IS ±12% AND IS MEASURED OFF THE HULL, and both halves of that need
   * saying. A stated height excludes whatever is on a ring on top — an AT-TE
   * with its mass driver elevated onto a target 30 m away measures 7.17 m
   * against a canon 5.02, and the difference is entirely the gun. And the
   * height figure is the one the references disagree about most: the same
   * AT-TE is 5.32 m in the Cross-Sections and 9.7 m in the databank, and the
   * Juggernaut's 30.4 m is a hull 49.4 m long standing taller than an AT-AT.
   */
  check('giants: measured against the plates, at the scale each claims', async () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const S = await shapeOf(t);
      const C = GIANT_CANON[t];
      const wants = (v, canon, tol, axis, from) => {
        if (canon == null) return `${axis} ${v.toFixed(2)}`;
        const target = canon / C.built;
        const off = pct(v, target);
        assert(Math.abs(off) <= tol,
          `${t} is ${v.toFixed(2)} m ${axis} against ${target.toFixed(2)} — ${canon} m at 1:${C.built} — `
          + `which is ${off.toFixed(1)}% out, past the ${tol}% this axis allows (measured off ${from})`);
        return `${axis} ${v.toFixed(2)} ${off >= 0 ? '+' : ''}${off.toFixed(1)}%`;
      };
      const tall = C.hFrom === 'all' ? S.full.h : S.hull.h;
      const parts = [
        wants(S.full.l, C.l, 6, 'l', 'every vertex'),
        wants(S.full.w, C.w, 6, 'w', 'every vertex'),
        wants(tall, C.h, 12, 'h', C.hFrom === 'all' ? 'the whole machine' : 'the hull, no turret'),
      ];
      /* NOTHING SINKS. Off the vertices, because the transformed-local-box
       * reading calls five of the SPHA's legs 0.23 m under the sand when the
       * lowest vertex on the machine is exactly on it. */
      assert(S.full.deepest > -0.10,
        `${t} puts ${(-S.full.deepest).toFixed(2)} m of '${S.full.deepAt}' through the floor`);
      rows.push(`${t} ${parts.join(' ')}`);
    }
    /* AND THEY ARE THE SIZE THE PLAYER ASKED FOR. "AT-AT or AT-M6 sized" is
     * 20 m long and 22.5 to 35 m tall, so the floor is a machine bigger than
     * anything the roster had: the AT-TE at 13.5 m was the largest body in the
     * game and three of these are half as big again or more. */
    const shapes = await Promise.all(GIANT_TYPES.map(shapeOf));
    const longest = Math.max(...shapes.map((s) => s.full.l));
    assert(longest > 30, `the biggest machine on the field is ${longest.toFixed(1)} m long; the note `
      + 'asks for AT-AT scale and an AT-AT is 20 m long and 22.5 m tall');
    /* …AND ONE OF THEM IS A DIFFERENT SHAPE ENTIRELY. Four of the five are
     * hulls: half again to twice as long as they are tall. The Octuptarra magna
     * is a head on three eleven-metre legs and is the only body in the game
     * TALLER THAN IT IS LONG, by a factor of nearly three over the next. That
     * is the cue that reads at any distance and it is the first thing a
     * rebalance would quietly take away. */
    const upright = shapes.filter((s) => s.full.h > s.full.l);
    assert(upright.length === 1 && upright[0].type === 'tridroid',
      `${upright.map((s) => s.type).join(', ') || 'nothing'} is taller than it is long; the tri-droid `
      + 'is supposed to be the only one, and the only one is supposed to be the tri-droid — '
      + shapes.map((s) => `${s.type} ${(s.full.h / s.full.l).toFixed(2)}`).join(', '));
    return `${rows.join(' · ')} — h/l ` + shapes.map((s) => `${s.type} ${(s.full.h / s.full.l).toFixed(2)}`).join('/');
  });

  /* ──────────────────────────────────────────────────────────────────
   * THE MOVEMENT — the clause the whole item turns on
   * ────────────────────────────────────────────────────────────────── */

  check('giants: what each one stands on, counted off the rig', async () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const S = await shapeOf(t);
      const C = GIANT_CANON[t];
      assert(S.chains === C.contacts,
        `${t} stands on ${S.chains} ${C.contactKind} and the reference gives it ${C.contacts}`);
      rows.push(`${t} ${S.chains} ${C.contactKind}`);
    }
    const counts = GIANT_TYPES.map((t) => GIANT_CANON[t].contacts);
    assert(new Set(counts).size >= 4,
      `${counts.join('/')} — only ${new Set(counts).size} distinct contact counts across five machines`);
    assert(counts.includes(12), 'nothing here has twelve legs, which is the whole of what an SPHA is');
    assert(counts.includes(10), 'nothing here has ten wheels');
    assert(counts.includes(3), 'nothing here is a tripod');
    return rows.join(', ');
  });

  /**
   * THE SIGNATURE, AND IT IS FIVE NUMBERS OFF A DRIVEN BODY.
   *
   * "Each one moves and fights differently. This is the clause that makes or
   * breaks the item." So it is not a state name and it is not a field read back
   * out of the table that declared it — every one of these is measured by
   * driving the shipped `_move` or the shipped `update`:
   *
   *   contacts  counted off the rig
   *   duty      share of a driven fourteen seconds spent above a fifth of top
   *             pace, with a target standing in the machine's own band
   *   turn      seconds for `facing` to close half a turn to within five degrees
   *   slope     the steepest bank it still makes half pace on, binary-searched
   *   speed     the archetype's pace, which is the one number that was already
   *             per-machine and is here so the rule is not blind to it
   *
   * THREE OF FIVE, at 25%. Two is not enough — two machines that differ only in
   * how fast they walk and how many legs they have are one machine at two
   * settings, which is the note's own complaint about the creatures.
   */
  check('giants: no two of them move alike, measured', async () => {
    const M = [];
    for (const t of GIANT_TYPES) {
      const S = await shapeOf(t);
      const e = await live(t);
      const turn = comeAbout(e);
      e.dispose?.();
      const g = await halfPaceSlope(t);
      const d = await dutyCycle(t);
      M.push({ t, contacts: S.chains, duty: d.duty, turn, slope: g.slope,
        speed: ARCHETYPES[t].speed, shots: d.shots, hipDrop: d.hipDrop, flatRun: g.flatRun });
    }
    const rows = M.map((m) => `${m.t} ${m.contacts}c duty ${m.duty.toFixed(2)} turn ${m.turn.toFixed(1)}s `
      + `slope ${m.slope.toFixed(2)} pace ${m.speed}`);
    const AXES = ['contacts', 'duty', 'turn', 'slope', 'speed'];
    for (let i = 0; i < M.length; i++) {
      for (let j = i + 1; j < M.length; j++) {
        const a = M[i], b = M[j];
        const d = AXES.map((k) => rel(a[k], b[k]));
        const differ = AXES.filter((k, n) => d[n] >= 0.25);
        assert(differ.length >= 3,
          `${a.t} and ${b.t} are separated only by [${differ.join(',')}] — `
          + AXES.map((k, n) => `${k} ${typeof a[k] === 'number' ? a[k].toFixed(2) : a[k]}/`
            + `${typeof b[k] === 'number' ? b[k].toFixed(2) : b[k]} (${(d[n] * 100).toFixed(0)}%)`).join(', ')
          + '. Two giants that share three of five axes are one machine with a different hull on it.');
      }
    }
    /* Every one of them actually got somewhere on the flat, or the whole
     * measurement above is comparing five zeroes. */
    for (const m of M) {
      assert(m.flatRun > 0.2,
        `${m.t} covered ${m.flatRun.toFixed(2)} m in a second of level ground at a declared `
        + `${m.speed} m/s — nothing about this signature means anything if the body does not move`);
      assert(Number.isFinite(m.turn),
        `${m.t} never came about at all in forty seconds — turnRate ${ARCHETYPES[m.t].turnRate}`);
    }
    return rows.join(' · ');
  });

  /**
   * THE SIEGE GUN PLANTS, AND EVERYTHING ELSE DOES NOT.
   *
   * The single most specific thing the reference says about an SPHA: "it only
   * used its twelve legs when maneuvering between firing positions; when
   * attacking an enemy target, a SPHA-T remained motionless to give its gunners
   * added precision". Three properties, all driven:
   *
   *   IT STOPS — a duty cycle near zero with a target in band, where every
   *     other machine on the list is near one.
   *   IT SITS DOWN — the hips drop while it is planted, through `rear`, which
   *     is the same channel every wind-up in `_poseWalker` uses. That is the
   *     TELL: without it a machine holding station for two and a half seconds
   *     is indistinguishable at ninety metres from one that has lost its target.
   *   IT STILL FIRES — which is the half that a first attempt got wrong. The
   *     brain hands every ranged body a lateral wish inside its own band, so a
   *     machine that must be still to shoot would stroll sideways at full pace
   *     resetting its own tally forever. Measured that way: zero shells in
   *     sixty seconds against a stationary target.
   */
  check('giants: the artillery plants to fire, and nothing else does', async () => {
    const planters = GIANT_TYPES.filter((t) => ARCHETYPES[t].plant);
    assert(planters.length >= 1, 'no giant declares `plant`, so the siege behaviour is unreachable code');
    const rows = [];
    for (const t of GIANT_TYPES) {
      const d = await dutyCycle(t);
      const A = ARCHETYPES[t];
      if (A.plant) {
        assert(d.duty < 0.15,
          `${t} declares plant ${A.plant} and spent ${(d.duty * 100).toFixed(0)}% of fourteen seconds `
          + 'moving with a target in its own band — it is not planting, it is strolling');
        assert(d.shots >= 1,
          `${t} planted and fired NOTHING in fourteen seconds against a stationary target in band. `
          + 'A gun that stops to shoot and then never shoots is a gun that has been switched off.');
        assert(d.hipDrop > 0.05,
          `${t} settled without its hips moving (${d.hipDrop.toFixed(3)} m of travel across the whole `
          + 'drive) — `planted` is supposed to drop the chassis onto its legs through `rear`, and '
          + 'without that tell a planted machine reads as a stopped one');
      } else {
        assert(d.duty > 0.4,
          `${t} does not declare plant and spent only ${(d.duty * 100).toFixed(0)}% of the drive `
          + 'moving — something else has stopped it and the plant measurement above means nothing');
      }
      rows.push(`${t} duty ${d.duty.toFixed(2)} shots ${d.shots} hips ${d.hipDrop.toFixed(2)} m`);
    }
    return rows.join(' · ');
  });

  /**
   * MAGNETISED FOOTPADS, AND TEN WHEELS THAT DO NOT HAVE THEM.
   *
   * "Built for extreme versatility, its magnetized footpads allow it to scale
   * vertical cliffs and operate even in the vacuum of space." Until the giants
   * landed nothing that MOVES a body in this game had ever read the slope under
   * it, so the machine famous for climbing rock took a bank at exactly the pace
   * a ten-wheeled transport did. Two clauses, both driven through `_move`:
   *
   *   the machine with pads has to out-climb every machine on wheels;
   *   and a machine under grade 1 has to refuse a PROP outright, which is the
   *     half a slope term cannot express — it meets the crate and goes round
   *     rather than walking up it.
   */
  check('giants: the one with magnetised pads climbs, and the wheels do not', async () => {
    const rows = [];
    const climb = new Map();
    for (const t of GIANT_TYPES) {
      const g = await halfPaceSlope(t);
      climb.set(t, g.slope);
      rows.push(`${t} ${g.slope.toFixed(2)}`);
    }
    const best = [...climb.entries()].sort((a, b) => b[1] - a[1])[0];
    assert(best[0] === 'atte',
      `${best[0]} out-climbs the AT-TE (${best[1].toFixed(2)} against ${climb.get('atte').toFixed(2)}); `
      + 'the magnetised footpads are the one thing everybody quotes about that machine');
    const wheeled = GIANT_TYPES.filter((t) => GIANT_CANON[t].contactKind !== 'legs');
    assert(wheeled.length >= 1, 'nothing here runs on wheels or a tread');
    for (const t of wheeled) {
      assert(climb.get(t) < climb.get('atte') * 0.6,
        `${t} runs on ${GIANT_CANON[t].contactKind} and climbs ${climb.get(t).toFixed(2)} against the `
        + `AT-TE's ${climb.get('atte').toFixed(2)} — a wheel is not supposed to keep up with a footpad`);
    }

    /* …AND THE STEP. `_move` refuses to climb a PROP for any body declaring a
     * grade under 1, which is the rule the level becomes cover under. Driven
     * against a real static box rather than asserted about the branch. */
    const { RapierWorld } = await physics();
    /**
     * A BOX THE ENGINE ALLOWS ANYBODY TO CLIMB, which is not the same as a tall
     * box. `supportHeight` refuses a box top more than `STEP_UP` (0.45 m) above
     * the feet unless the box declares `userData.climb` — that is how a felled
     * trunk in the wood is climbable and a wall is not — so a 1.8 m crate with
     * no declaration is a crate NOBODY climbs, and the first version of this
     * probe reported the AT-TE failing to climb something the game does not let
     * anything climb. The bar has to be a thing the AT-TE could get up, or the
     * measurement is of `supportHeight` rather than of `grade`.
     */
    const stepFor = async (t) => {
      const e = await live(t);
      const box = {
        center: new THREE.Vector3(0, 0.7, 6), halfExtents: new THREE.Vector3(6, 0.7, 1.4),
        quat: new THREE.Quaternion(), invQuat: new THREE.Quaternion(), radius: 6.2, disabled: false,
        userData: { climb: 1.4 },
      };
      const ctx = { terrain: flat(), physics: { staticBoxes: [box], raycast: () => null },
        particles, time: 0 };
      e.position.set(0, 0, 0); e.velocity.set(0, 0, 0); e.grounded = true;
      e.facing = 0; e.toTarget = null; e.stunTimer = 0;
      e._stuckT = 0; e._wallT = 0; e._wallN.set(0, 0, 0);
      let top = 0;
      for (let i = 0; i < 300; i++) {
        e.wish = new THREE.Vector3(0, 0, 1);
        e._move(1 / 60, ctx);
        top = Math.max(top, e.position.y);
      }
      e.dispose?.();
      return top;
    };
    const attep = await stepFor('atte');
    const jug = await stepFor('juggernaut');
    assert(attep > 1.0,
      `the AT-TE got ${attep.toFixed(2)} m up a 1.4 m climbable step in five seconds; magnetised `
      + 'pads climb, and this is the one body in the game that declares grade 1');
    assert(jug < 0.2,
      `the Juggernaut climbed ${jug.toFixed(2)} m of a 1.4 m step — ten wheels do not climb, they `
      + 'go round, and that is what makes a crate cover against it');
    return `${rows.join(', ')} · a 1.4 m step: AT-TE ${attep.toFixed(2)} m up, Juggernaut ${jug.toFixed(2)}`;
  });

  /* ──────────────────────────────────────────────────────────────────
   * THE CADENCE
   * ────────────────────────────────────────────────────────────────── */

  /**
   * "THEY ALL ATTACK THE SAME WAY", measured against each other AND against the
   * machines that were already here.
   *
   * Three axes — how many shots, how long the cycle, what one volley costs —
   * and two of the three have to differ. Between giants the bar is 25%; against
   * a machine already on the roster it is 15%, which is looser on purpose: the
   * older rows were priced against each other and this is asking the narrower
   * question of whether a giant is a HEAVIER REPAINT of one of them.
   */
  check('giants: no two of them shoot alike, and none of them is a reskin', () => {
    const all = [...new Set([...GIANT_TYPES, ...VEHICLE_TYPES, 'walker'])];
    const row = (t) => ({ t, giant: GIANT_TYPES.includes(t), burst: ARCHETYPES[t].burst ?? 1,
      cycle: cycleOf(ARCHETYPES[t]), volley: volleyOf(ARCHETYPES[t]) });
    const M = all.map(row);
    for (let i = 0; i < M.length; i++) {
      for (let j = i + 1; j < M.length; j++) {
        const a = M[i], b = M[j];
        if (!a.giant && !b.giant) continue;
        const bar = a.giant && b.giant ? 0.25 : 0.15;
        const d = [rel(a.burst, b.burst), rel(a.cycle, b.cycle), rel(a.volley, b.volley)];
        const n = d.filter((v) => v >= bar).length;
        assert(n >= 2,
          `${a.t} and ${b.t} fire alike — burst ${a.burst}/${b.burst}, cycle ${a.cycle.toFixed(2)}/`
          + `${b.cycle.toFixed(2)} s, volley ${a.volley}/${b.volley} — differing on ${n} of three `
          + `axes against a bar of ${(bar * 100).toFixed(0)}%`);
      }
    }
    /* AND THE BANDS SPREAD. A giant you meet at four metres and one you cannot
     * reach at ninety are different fights; five that all stand at twenty
     * metres are one fight five times. */
    const mids = GIANT_TYPES.map((t) => (ARCHETYPES[t].preferred[0] + ARCHETYPES[t].preferred[1]) / 2);
    assert(Math.max(...mids) > Math.min(...mids) * 4,
      `the giants' bands run ${mids.map((v) => v.toFixed(0)).join('/')} m — they all want the same distance`);
    assert(Math.min(...GIANT_TYPES.map((t) => ARCHETYPES[t].preferred[0])) <= 6,
      'not one of the five closes to blade range; a giant you can never touch is a turret');
    return GIANT_TYPES.map((t) => {
      const A = ARCHETYPES[t];
      return `${t} ${A.burst}x${A.damage} in ${cycleOf(A).toFixed(1)}s @ ${A.preferred.join('-')} m`;
    }).join(' · ');
  });

  /**
   * IT FIRES DOWN AT YOU — the tri-droid's own firing signature, and the one
   * that is a fact about the GEOMETRY rather than about the table.
   *
   * The cannons are twelve metres up and its band opens at ten, so a player
   * standing under one is shot at from steeply above. Nothing else on the
   * roster does that, and no field says so: it falls out of where the muzzles
   * are, which is why it is measured off the shipped `_muzzleWorld` against a
   * target at the near edge of each machine's own band.
   */
  check('giants: the close ones stand over you and the far ones shoot flat', async () => {
    const rows = [];
    let steepest = -1, steepAt = '', shallowest = 91, shallowAt = '';
    const heights = [];
    const angles = new Map();
    for (const t of GIANT_TYPES) {
      const e = await live(t);
      const near = ARCHETYPES[t].preferred[0];
      const tgt = new THREE.Vector3(0, 1.6, near);
      e.facing = 0;
      e.target = { position: tgt, chest: tgt };
      const ctx = { terrain: e.world.terrain, time: 0 };
      for (let i = 0; i < 40; i++) { ctx.time += 1 / 60; e._poseWalker(1 / 60, ctx); }
      const from = e._muzzleWorld(new THREE.Vector3());
      assert(Number.isFinite(from.y) && from.y > 0.5,
        `${t} fires from ${from.y.toFixed(2)} m, which is the floor`);
      const drop = from.y - tgt.y;
      const run = Math.hypot(tgt.x - from.x, tgt.z - from.z);
      const deg = Math.atan2(drop, run) * 180 / Math.PI;
      if (deg > steepest) { steepest = deg; steepAt = t; }
      if (deg < shallowest) { shallowest = deg; shallowAt = t; }
      heights.push({ t, y: from.y });
      angles.set(t, deg);
      rows.push(`${t} ${deg.toFixed(0)}° from ${from.y.toFixed(1)} m at ${near} m`);
      e.dispose?.();
    }
    /**
     * THE RULE IS DERIVED FROM THE BAND, WHICH IS THE ONLY FORM OF IT THAT IS
     * ACTUALLY TRUE.
     *
     * The first cut of this asserted that the tri-droid plunges hardest, which
     * is a plausible sentence and a false one: a plunge angle is two facts
     * multiplied together — how high the gun is and how close the machine lets
     * you get — and the NR-N99 carries its blasters five metres up and opens
     * fire at FOUR, so it looks down at you harder than a machine three times
     * its height does at ten. Both readings are correct and neither is a
     * property anybody designed.
     *
     * What IS designed is the pairing: a giant that fights close carries its
     * guns above you and a giant that fights at range reaches out flat. So the
     * rule reads the band off the archetype and holds each machine to the half
     * it is on, and the tri-droid is covered by it without being named.
     *
     * The muzzle heights are asserted separately and are a fact about geometry
     * alone: five machines firing from one height would be five machines with
     * the same gun mount at different sizes.
     */
    /* METRES AND NOT A RATIO. Every gun on this list is already six metres up,
     * so a ratio flatters the low ones and punishes the tall ones for the same
     * gap: 6.7 m to 13.6 m is 2.0x and is seven metres, which is four storeys
     * and is what a player sees. The floor is five, which is more than the
     * whole height of the AT-TE. */
    const hs = heights.map((h) => h.y);
    assert(Math.max(...hs) - Math.min(...hs) > 5,
      `every muzzle on the field sits between ${Math.min(...hs).toFixed(1)} and `
      + `${Math.max(...hs).toFixed(1)} m — five machines firing from one height`);
    /**
     * …AND THE PAIRING IS A RANK CORRELATION, because a threshold on either
     * side of it kept being a sentence about one machine rather than a property
     * of the set.
     *
     * Measured, plunge at each machine's own near edge:
     *
     *     snailtank  72° from  6.7 m at  4 m
     *     juggernaut 39° from  8.1 m at 14 m
     *     tridroid   32° from 10.1 m at 10 m
     *     spha       28° from 13.6 m at 40 m
     *     atte       19° from  7.2 m at 20 m
     *
     * A pair of thresholds across that puts the SPHA at 28 and the tri-droid at
     * 32 on opposite sides of a bar four degrees wide, which is not a rule, it
     * is a coincidence with an assertion round it. What the numbers actually
     * say is an ORDER: the closer a giant fights, the more steeply it looks
     * down at you, across all five. Spearman's rho on the two rankings is the
     * whole of that sentence and it does not care which machine is which — a
     * sixth giant is measured by it the day it is written.
     */
    const order = [...GIANT_TYPES];
    const byNear = [...order].sort((a, b) => ARCHETYPES[a].preferred[0] - ARCHETYPES[b].preferred[0]);
    const byPlunge = [...order].sort((a, b) => angles.get(b) - angles.get(a));
    let d2 = 0;
    for (const t of order) {
      const d = byNear.indexOf(t) - byPlunge.indexOf(t);
      d2 += d * d;
    }
    const n = order.length;
    const rho = 1 - (6 * d2) / (n * (n * n - 1));
    assert(rho > 0.6,
      `the order the giants fight at and the order they plunge at agree only to rho ${rho.toFixed(2)} `
      + `— by range ${byNear.join('<')}, by plunge ${byPlunge.join('>')}. A giant that lets you `
      + `close is supposed to be standing over you. All five: ${rows.join(', ')}`);
    assert(steepest > 55,
      `the steepest plunge on the roster is ${steepest.toFixed(0)}° — nothing is actually shooting down`);
    assert(shallowest < 22,
      `the flattest gun on the roster still looks ${shallowest.toFixed(0)}° down at the near edge of `
      + 'its own band — nothing here reaches out level');
    return `${rows.join(', ')} — steepest ${steepAt}, flattest ${shallowAt}, guns from `
      + `${Math.min(...hs).toFixed(1)} to ${Math.max(...hs).toFixed(1)} m, rho ${rho.toFixed(2)}`;
  });

  /* ──────────────────────────────────────────────────────────────────
   * THE ANSWER
   * ────────────────────────────────────────────────────────────────── */

  /**
   * "DEADLY AND HARD TO KILL, WITHOUT BEING UNFAIR. A PLAYER MUST BE ABLE TO
   * SEE HOW TO TAKE ONE DOWN."
   *
   * So each machine DECLARES its answer, in `GIANT_CANON.kill`, and this is
   * where the declaration is held against the game. A claim checked against the
   * derivation is the shape this repository keeps — it is what the databank's
   * quoted-claims clause does with prose — and it is the opposite of HANDOFF
   * §2.3's hand-maintained twin: the number here is never READ by the game, it
   * is only ever compared against what the game computes.
   *
   * Four things have to be true of an answer for it to be one:
   *
   *   IT IS THE SHIPPED RULE. `toppleAt(A, rig)` is imported, never restated.
   *   IT IS REACHABLE. Fewer legs to take than the machine has.
   *   IT IS IN REACH. The lowest capsule on a leg chain has to come down to
   *     within a standing player's blade, or "take its legs" is advice about a
   *     part of the machine nobody can touch.
   *   IT IS FASTER THAN HITTING IT ANYWHERE ELSE. Every one carries at least
   *     one weak point on a leg chain — a joint, an axle housing, a drive
   *     sprocket — so the route in is a route rather than a slog.
   */
  check('giants: each one states how it dies, and the game agrees', async () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const S = await shapeOf(t);
      const K = GIANT_CANON[t].kill;
      assert(K, `${t} states no answer in GIANT_CANON.kill — "difficult to take down" with no way down`);
      assert(S.chains === K.chains,
        `${t} claims ${K.chains} ${K.at} and the rig has ${S.chains} leg chains`);
      assert(S.topple === K.lose,
        `${t} claims it goes down on ${K.lose} of ${K.chains} and toppleAt() says ${S.topple}`);
      assert(K.lose >= 1 && K.lose <= K.chains,
        `${t} needs ${K.lose} of ${K.chains} lost, which it can never reach`);
      assert(S.legLow < BLADE_REACH,
        `${t}: the lowest thing it stands on is ${S.legLow.toFixed(2)} m off the floor, past a `
        + `standing blade's ${BLADE_REACH} m — its own answer names a part nobody can touch`);
      assert(S.legGaps >= 1,
        `${t} has ${S.legGaps} weak points on its ${S.chains} leg chains — the answer is a slog `
        + 'through armour rather than a place to aim at (player note 35)');
      /* …and the machine's own page says so, because the answer being true is
       * only half of "a player must be able to SEE how to take one down". */
      const page = DATABANK[t].text.toLowerCase();
      assert(K.says.some((w) => page.includes(w)),
        `${t}'s databank page never mentions ${K.says.join(' or ')} — the one thing a player has to `
        + 'be told about this machine is the thing its page does not say');
      rows.push(`${t} ${K.lose}/${K.chains} ${K.at}, lowest ${S.legLow.toFixed(2)} m, ${S.legGaps} gaps`);
    }
    /* AND NO TWO OF THEM ARE THE SAME ANSWER. Five machines that all go down on
     * three legs of six is one encounter five times. */
    const shapes = new Set(GIANT_TYPES.map((t) => {
      const K = GIANT_CANON[t].kill;
      return `${K.lose}/${K.chains}`;
    }));
    assert(shapes.size >= 4,
      `only ${shapes.size} distinct answers across five machines: ${[...shapes].join(', ')}`);
    return rows.join(' · ');
  });

  /**
   * …AND THE ARTILLERY'S ANSWER IS ITS OWN CHARGE.
   *
   * The SPHA's counter-play is not only its legs, it is WHEN. It plants, and
   * while it is planted it cannot walk and cannot come about — so the window is
   * the length of the charge plus the settling, and a player who is under the
   * hull when it starts one is under a machine that cannot answer. That is a
   * claim about two numbers agreeing and it is measured as one: the belly has
   * to be high enough to walk under, and the wind-up long enough to cross the
   * band.
   */
  check('giants: you can get under the siege gun, and the charge is long enough to', async () => {
    const t = GIANT_TYPES.find((k) => ARCHETYPES[k].plant);
    const S = await shapeOf(t);
    const A = ARCHETYPES[t];
    /* The belly, as the lowest point of the HULL rather than of the machine —
     * the legs come to the floor and are supposed to. */
    const belly = S.hull.minY;
    assert(belly > 1.9,
      `${t}'s hull hangs ${belly.toFixed(2)} m off the ground; a player is 1.8 m tall and the whole `
      + 'counter-play is that the one place a siege gun cannot shoot is under itself');
    const window = A.telegraph + A.plant;
    assert(window > 3.5,
      `${t} is motionless for only ${window.toFixed(1)} s a cycle (plant ${A.plant} + telegraph `
      + `${A.telegraph}) — that is not a window, it is a pause`);
    /* The longest warning anything gives, which is what makes a 96-damage shell
     * fair rather than a coin toss. Derived off the roster, not typed. */
    const loudest = Object.entries(ARCHETYPES)
      .filter(([k]) => k !== t).reduce((m, [, a]) => Math.max(m, a.telegraph ?? 0), 0);
    assert(A.telegraph > loudest,
      `${t} charges for ${A.telegraph} s and something else on the roster telegraphs for ${loudest} — `
      + 'the heaviest hit in the game has to give the longest warning in it');
    return `${t}: ${belly.toFixed(2)} m of belly, ${window.toFixed(1)} s planted a cycle, `
      + `${A.telegraph} s of charge against the roster's next-longest ${loudest}`;
  });

  /* ──────────────────────────────────────────────────────────────────
   * THE SILHOUETTE
   * ────────────────────────────────────────────────────────────────── */

  check('giants: their outlines do not overlap, at any range', async () => {
    const sils = new Map(), lods = new Map();
    for (const t of GIANT_TYPES) {
      const e = await live(t);
      e.facing = 0;
      const tgt = new THREE.Vector3(0, 1.6, 30);
      e.target = { position: tgt, chest: tgt };
      const ctx = { terrain: e.world.terrain, time: 0 };
      for (let i = 0; i < 40; i++) { ctx.time += 1 / 60; e._poseWalker(1 / 60, ctx); }
      e.rig.root.updateMatrixWorld(true);
      const keep = new Set();
      for (const b of e.rig.list) if (b.primary) keep.add(b.primary);
      sils.set(t, silhouette(e.rig.root, false, keep));
      lods.set(t, silhouette(e.rig.root, true, keep));
      e.dispose?.();
    }
    let worst = 0, worstPair = '', worstLod = 0, worstLodPair = '';
    for (let i = 0; i < GIANT_TYPES.length; i++) {
      for (let j = i + 1; j < GIANT_TYPES.length; j++) {
        const a = GIANT_TYPES[i], b = GIANT_TYPES[j];
        const v = iou(sils.get(a), sils.get(b));
        const w = iou(lods.get(a), lods.get(b));
        if (v > worst) { worst = v; worstPair = `${a}|${b}`; }
        if (w > worstLod) { worstLod = w; worstLodPair = `${a}|${b}`; }
      }
    }
    assert(worst < 0.42,
      `${worstPair} overlap ${(worst * 100).toFixed(0)}% of their combined flank. Two machines that `
      + 'share a body plan land above 0.5 — that is what tools/_creature.mjs records for the '
      + 'menagerie the player was describing when he wrote "sphere with some legs".');
    assert(worstLod < 0.42,
      `${worstLodPair} overlap ${(worstLod * 100).toFixed(0)}% at LOD 1, which is the only range that `
      + 'matters — past thirty metres the culled meshes are not there to tell them apart');
    return `worst ${worstPair} ${worst.toFixed(2)}, at LOD 1 ${worstLodPair} ${worstLod.toFixed(2)}`;
  });

  /* ──────────────────────────────────────────────────────────────────
   * THE COST
   * ────────────────────────────────────────────────────────────────── */

  /**
   * A 34.7 m MACHINE IS NOT ALLOWED TO COST 34.7 m OF DRAW CALLS.
   *
   * Everything goes through `Kit`, which merges one mesh per material per bone,
   * so a machine's cost is decided by its BONE COUNT and not by its size. What
   * cannot be merged away is the reason the bones are there: `Enemy.capsules()`
   * emits one capsule per bone that carries geometry, so merging the SPHA's
   * twelve legs into the hull would delete the only way the machine can be
   * killed. That trade is the whole content of this check, and it is stated as
   * two numbers rather than as a paragraph:
   *
   *   MESHES PER BONE has to stay near one. Above about 1.6 the builder has
   *     stopped merging and is hanging a Kit on everything.
   *   WHAT SURVIVES THE LOD CULL is what the frame actually pays past thirty
   *     metres, and it is capped ABSOLUTELY rather than as a fraction — an
   *     acklay is 20 and `vehicles.mjs` caps a line machine at 32.
   *
   * Measured the day this was written, and the headline is that the largest
   * machine in the game is not the most expensive one:
   *
   *     atte        13.5 m   62 meshes   30 at range   4.6 a metre
   *     spha        34.7 m   54 meshes   32 at range   1.6 a metre
   *     juggernaut  25.4 m   45 meshes   30 at range   1.8 a metre
   *     tridroid     8.7 m   34 meshes   14 at range   3.9 a metre
   *     snailtank   11.0 m   22 meshes   13 at range   2.0 a metre
   */
  check('giants: what each one costs to draw', async () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const S = await shapeOf(t);
      /**
       * DRAW CALLS PER METRE, which is the form the requirement is actually
       * written in: "a 140 m machine is not allowed to cost 140 m of draw
       * calls". Meshes per BONE was the first metric and it is the wrong one —
       * a hull segment legitimately carries four materials and a road wheel
       * carries two, so the ratio says more about how many colours a part is
       * painted in than about whether anything was merged.
       */
      const perMetre = S.full.meshes / S.full.l;
      assert(perMetre < 5,
        `${t} draws ${S.full.meshes} meshes across ${S.full.l.toFixed(1)} m `
        + `(${perMetre.toFixed(2)} a metre) — Kit merges one mesh per material per bone, so this is `
        + 'a builder that has stopped merging');
      assert(S.full.meshes <= 70,
        `${t} draws ${S.full.meshes} meshes; heavyLimit puts up to five heavies on a field at once`);
      assert(S.full.kept <= 42,
        `${t} still draws ${S.full.kept} meshes past thirty metres; an acklay is 20 and `
        + 'tools/checks/vehicles.mjs caps a line machine at 32');
      assert(S.full.kept < S.full.meshes,
        `${t} culls nothing at range — all ${S.full.meshes} of its meshes are silhouette or primary`);
      rows.push(`${t} ${S.full.l.toFixed(1)} m ${S.full.meshes}/${S.full.kept} `
        + `${(S.full.tris / 1000).toFixed(1)}k tris ${perMetre.toFixed(1)}/m`);
    }
    /* THE HEADLINE, AND IT IS AN ASSERTION RATHER THAN A REMARK: the longest
     * machine on the field must not be the most expensive one. If it ever
     * becomes so, the merging has stopped scaling and the next giant will be
     * worse. */
    const shapes = await Promise.all(GIANT_TYPES.map(shapeOf));
    const longest = shapes.reduce((m, s) => (s.full.l > m.full.l ? s : m));
    const priciest = shapes.reduce((m, s) => (s.full.meshes > m.full.meshes ? s : m));
    const densest = shapes.reduce((m, s) => (s.full.meshes / s.full.l > m.full.meshes / m.full.l ? s : m));
    assert(longest.type !== priciest.type,
      `${longest.type} is both the longest machine (${longest.full.l.toFixed(1)} m) and the most `
      + `expensive (${longest.full.meshes} meshes) — size has started buying draw calls`);
    assert(longest.type !== densest.type,
      `${longest.type} is the longest machine AND the densest in draw calls per metre — merging has `
      + 'stopped scaling and the next giant will be worse');
    return `${rows.join(' · ')} — longest ${longest.type}, priciest ${priciest.type} `
      + `at ${priciest.full.meshes}, densest ${densest.type}`;
  });

  /**
   * AND THE BLADE REACHES ALL OF THEM.
   *
   * `Enemy.capsules()` gives the solver one capsule per bone that carries
   * geometry, so a 34.7 m hull on one bone is a hull you can only cut in the
   * middle. Sampled down the centreline at hull height, exactly as
   * `vehicles.mjs` does it for the smaller machines — the question is the same
   * one and the answer is allowed to be worse for a body five times as long,
   * which is why it is measured rather than assumed.
   */
  check('giants: the blade reaches the whole hull, not just its middle', async () => {
    const rows = [];
    const s = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
    for (const t of GIANT_TYPES) {
      const S = await shapeOf(t);
      const midY = (S.core.minY + S.core.maxY) / 2;
      const N = 64;
      let hit = 0;
      for (let i = 0; i < N; i++) {
        s.set(0, midY, S.hull.minZ + (i + 0.5) / N * S.hull.l);
        for (const c of S.caps) {
          ab.subVectors(c.p1, c.p0);
          const u = Math.max(0, Math.min(1, ap.subVectors(s, c.p0).dot(ab) / Math.max(1e-9, ab.lengthSq())));
          if (ap.copy(c.p0).addScaledVector(ab, u).distanceTo(s) <= c.r) { hit++; break; }
        }
      }
      const frac = hit / N;
      assert(frac > 0.85,
        `${t}: the blade can reach only ${(frac * 100).toFixed(0)}% of its ${S.hull.l.toFixed(1)} m `
        + 'hull — split the hull across more bones; capsules() emits one per bone with geometry');
      rows.push(`${t} ${(frac * 100).toFixed(0)}% of ${S.hull.l.toFixed(1)} m`);
    }
    return rows.join(', ');
  });

  /**
   * AND EVERY ONE OF THEM IS A PHYSICAL OBJECT WITH A HULL PROXY.
   *
   * Same three questions `vehicles.mjs` asks of the line machines — can I walk
   * into it, can I cut it, can I break it — plus the one that only matters at
   * this size: the published `built.proxy` has to cover the hull it was
   * generated from, because the shipped movement collider is a 2.2 m column and
   * a 34.7 m machine is 94% air as far as a player walking into it is
   * concerned. That gap is Enemy.js's to close and the number is printed here
   * every run so it closes against something measured.
   */
  check('giants: a live one is a physical object, and it publishes the hull it built', async () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const e = await live(t);
      assert(e.body, `${t} has no movement proxy body — the player would walk through it`);
      const caps = e.capsules();
      assert(caps.length >= 6,
        `${t} offers the blade only ${caps.length} capsules for a machine this size`);
      assert(caps.some((c) => c.toughness >= TOUGHNESS.durasteel),
        `${t} has no durasteel anywhere; custom:'walker' plates its body and hips`);
      const before = e.hp;
      e.damage(40, new THREE.Vector3(0, 2, 0), null, 'blaster');
      assert(e.hp < before, `${t} took no damage from a 40-point hit`);
      const P = e.built.proxy;
      assert(P && Array.isArray(P.spheres) && P.spheres.length,
        `${t} publishes no hull proxy — nothing can widen its collider without remodelling it`);
      const S = await shapeOf(t);
      const N = 48;
      let shipped = 0, published = 0;
      const midY = (S.core.minY + S.core.maxY) / 2;
      for (let i = 0; i < N; i++) {
        const z = S.hull.minZ + (i + 0.5) / N * S.hull.l;
        const dy = Math.max(0, Math.abs(midY - 1.4) - 0.9);
        if (Math.hypot(z, dy) <= 1.1) shipped++;
        for (const sp of P.spheres) {
          if (Math.hypot(sp.c.x, sp.c.y + P.y - midY, sp.c.z - z) <= sp.r) { published++; break; }
        }
      }
      assert(published / N > 0.8,
        `${t}'s published proxy covers only ${(published / N * 100).toFixed(0)}% of its own hull — `
        + 'hullProxy() is generated off the hull, so this failing means the hull moved and the '
        + 'generator did not follow');
      rows.push(`${t} ${caps.length} caps, proxy ${(shipped / N * 100).toFixed(0)}%→`
        + `${(published / N * 100).toFixed(0)}%`);
      e.dispose?.();
    }
    return `${rows.join(' · ')} (shipped collider → what the builder publishes)`;
  });

  /**
   * SEVERANCE IS NOT A ONE-PASS KILL ON ANY OF THEM.
   *
   * `severance` prices a leg at `1.10 x share / of` where `of` is how many leg
   * BONES the body has, and `takeCut` kills outright at 0.9 — so a machine with
   * a single leg bone is a machine that dies to one pass through it. That is
   * exactly what happened to the NR-N99 the first time it was built with its
   * outriggers as `hull`, and the suite printed it as "one pass, no legs lost,
   * no topple" because there was no body left to topple. It is not a hypothesis
   * about future builders; it is a defect that shipped for one commit.
   */
  check('giants: no giant dies to a single pass through what it stands on', async () => {
    const rows = [];
    for (const t of GIANT_TYPES) {
      const e = await live(t);
      let worst = 0, worstAt = '';
      for (const b of e.rig.list) {
        if (b.role !== 'leg' || !b.parts.length) continue;
        const v = severanceOf(b);
        if (v > worst) { worst = v; worstAt = b.name; }
      }
      assert(worst > 0,
        `${t} has no leg bone carrying geometry, so nothing it stands on can be cut at all`);
      assert(worst < 0.9,
        `${t}'s '${worstAt}' is worth ${worst.toFixed(2)} of the body and takeCut kills outright at `
        + '0.9 — one pass through a ground contact deletes the machine. Give it more chains.');
      /* …and the trunk still is fatal wherever it lands, which is what makes
       * the legs the interesting route rather than the only one. */
      const core = e.rig.list.find((b) => AXIAL_ROLES.includes(b.role) && b.parts.length);
      assert(core && severanceOf(core) >= 0.9,
        `${t}'s core is worth ${core ? severanceOf(core).toFixed(2) : 'nothing'} — a core cut is `
        + 'supposed to be fatal wherever it lands');
      rows.push(`${t} worst leg ${worstAt} ${worst.toFixed(2)}`);
      e.dispose?.();
    }
    return rows.join(', ');
  });
}
