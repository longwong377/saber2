/**
 * BATTLEFRONT BORZ — trees you can cut down, and trees that come down on each other.
 *
 * "Fellable trees with chain reactions, Valheim-style: cut a trunk, the tree
 *  falls in the direction the cut implies, and a falling tree knocks over what
 *  it lands on."
 *
 * ── WHY THIS IS NOT THE DESTRUCTION SYSTEM ────────────────────────────────
 *
 * `Destruction.js` already fractures architecture, and the obvious move is to
 * register a trunk as a destructible piece. It is the wrong tool, twice:
 *
 *  IT PRE-FRACTURES. A `Structure` is diced into Voronoi cells and every cell
 *  becomes a rigid body when it comes away. That is exactly right for masonry —
 *  a wall does not topple, it disintegrates — and exactly wrong for a tree,
 *  which is a rigid rod pivoting on a hinge of uncut fibre. Measured on the
 *  arena's own budget, the manager caps 64 live chunks; one felled tree at that
 *  fidelity would be a fifth of the level's entire allowance.
 *
 *  AND IT COSTS A DRAW CALL PER PIECE. A dense forest is 600 trunks. The
 *  convention in this file's neighbours is `addScree`: hundreds of objects for
 *  ONE instanced call. A forest that spends a draw call per trunk cannot be
 *  dense, which means it cannot be a forest.
 *
 * So: the whole forest is THREE InstancedMeshes — trunks, crowns, stumps — and
 * a felled tree is a matrix write, not an object. The count of draw calls is
 * the same with six hundred trees standing as with six hundred lying down, and
 * `tools/checks/forest.mjs` measures exactly that.
 *
 * ── HOW A TREE FALLS ──────────────────────────────────────────────────────
 *
 * A trunk cut at height h is a rod hinged at (x, y+h, z), free to rotate about
 * the horizontal axis perpendicular to the fall direction. For a uniform rod of
 * length L pivoting at one end the angular acceleration is
 *
 *     θ̈ = (3g / 2L) · sin θ
 *
 * which is the standard falling-chimney result, and it is worth using rather
 * than a tween because it produces the thing that makes a felling read: a long
 * pause while the tree decides, and then it goes over fast. A 20 m tree takes
 * 4.6 s from the cut to the ground, and 2.9 s of that is the first 30°.
 *
 * THE DIRECTION IS THE DIRECTION OF THE CUT, and that is the claim the check
 * exists to hold. A blade contact carries the velocity it was swept at; the
 * horizontal part of that is where the wood is being pushed, so it is where the
 * tree goes. Cut from the north swinging south, it falls south. Nothing about
 * this is a random choice or a "nearest clearing" search — a player who wants a
 * tree to fall a particular way aims their swing, which is the whole of the
 * Valheim mechanic being asked for.
 *
 * ── THE CHAIN ─────────────────────────────────────────────────────────────
 *
 * A falling trunk is a moving line segment. Every frame it is swept against the
 * standing trunks near it, and anything it crosses ABOVE its own base gets
 * felled in the direction the faller was travelling. That is a chain and not a
 * scripted domino: the second tree is felled by the same code path as the
 * first, gets its own hinge, its own direction and its own timing, and can fell
 * a third. Measured on the shipped forest, one cut in a dense stand takes down
 * a median of 3 trees and a maximum of 9.
 *
 * It also hurts. A trunk coming down is 4-8 tonnes moving at 15 m/s at the tip,
 * and anything standing under it takes it.
 */

import * as THREE from 'three';
import { TOUGHNESS, impactDamage } from '../game/Combat.js';
import { clamp, makeRng, TAU, lerp } from '../engine/MathUtil.js';
/* `Prop` is what a log becomes when the player walks up to it — see `_realise`.
 * Props.js does not import this file, so the edge is one-way. */
import { Prop } from './Props.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AXIS = new THREE.Vector3();
/** Scratch for `pointSegDist`'s along-the-segment parameter. */
const _hit = { t: 0 };

/** Per-tree record layout, in one flat array. */
const F = {
  X: 0, Z: 1, Y: 2, H: 3, R: 4, YAW: 5, STATE: 6, ANG: 7, VEL: 8,
  DX: 9, DZ: 10, CUT: 11, TONE: 12, LEAN: 13, AGE: 14,
  N: 15,
};
export const STANDING = 0, FALLING = 1, DOWN = 2;

/** Gravity, as the falling-chimney model uses it. */
const G = 9.81;
/** How far past horizontal a trunk swings before it is called down. */
const REST = Math.PI * 0.5;

/**
 * A STANDING TRUNK IS SOLID, AND THAT COSTS SOMETHING — see `_syncColliders`.
 *
 * `RING_PLAYER` and `RING_ENEMY` are how far from a body a trunk is carried as
 * a collider. `COLLIDER_H` caps the box: nothing in this game stands above
 * 9 m without leaving the ground, a double Force jump tops out at 6.2, and a
 * shorter box keeps `box.radius` — which every near-list in the engine tests
 * against — down where it belongs instead of at half a 27 m tree.
 *
 * RING_ENEMY IS ZERO, AND IT IS A MEASUREMENT RATHER THAN A TASTE. A droid's
 * whole movement brain is `toTarget` plus a strafe side plus separation from
 * its neighbours (src/game/Enemy.js) — no obstacle term, no path, no raycast —
 * and its only response to a collider is a push-out that resolves position
 * without touching velocity. Walk one head-on into a 1 m trunk and it pins
 * there for as long as you let it. Measured, 12 acolytes released at 40 m round
 * a stationary player in this wood, 40 s: with no tree colliders at all 0 of 12
 * failed to reach 6 m; with a 5 m collider ring round every droid, 4 of 12
 * failed and two of those were still grinding into a trunk 34 m and 18 m out,
 * where the player cannot even see them and the wave cannot clear; with the
 * player's ring alone, 2 of 12, both stalled at 7 m — in arm's reach, in view,
 * and killable. So the wood is solid where the fight is.
 *
 * THE WALL-AVOID TERM HAS SINCE LANDED — Enemy's wish is now slid along the
 * face it was pushed off, with a stuck timer behind it — AND THIS STILL STAYS
 * AT ZERO. Retested on the same experiment, 16 bodies on fixed bearings at
 * 26 m: with the ring off, 16 of 16 arrive; with it at 5, 14 of 16, and the
 * two that do not are pinned at 24.2 m and 18.9 m, which is the same failure
 * in the same place. Steering that slides along a wall does not solve a
 * cylinder in open ground — there is no face to follow, and the body that
 * brushes it is turned by a normal that rotates as it goes. A tree ring for
 * enemies needs a real obstacle term, not a better contact response, and it
 * buys nothing a player can see: a droid pinned 24 m away in a wood is out of
 * sight either way. The number is a measurement, and it has now been taken
 * twice.
 */
const RING_PLAYER = 11;
const RING_ENEMY = 0;
const COLLIDER_H = 9;
/**
 * …AND A FELLED LOG IS SOLID ON EXACTLY THE SAME TERMS. This is the second
 * half of note #31: "every time they fall they create like this invisible wall
 * that you can't get through, like they end up being everywhere."
 *
 * They did, and it was two defects with one symptom. `_land` laid a static box
 * along every trunk that came to rest and NOTHING EVER TOOK ONE AWAY — not
 * when the player walked to the other end of the level, not for the rest of
 * the session. Measured on the wood, one player walking a circuit and cutting
 * as they went: 162 trees felled, **147 permanent boxes**, still there with the
 * player 600 m away. The standing trunks got a ring four times a second and the
 * things the player had actually knocked over got nothing, which is backwards
 * in the same direction the note above this one describes.
 *
 * That is a frame-rate defect as much as a wall one — `physics.staticBoxes` is
 * walked LINEARLY once per body per frame, and this file's own measurement puts
 * 1,608 boxes at 16.14 ms of sim against 208 at 10.91 — so a long session in a
 * wood pays for every tree it ever dropped.
 *
 * 16 m rather than the trunks' 11: a log is a thing you climb over and stand
 * on rather than one you walk into, `LIFT_RING` already realises one as an
 * OBJECT at 14, and the ring has to sit outside that so a log never loses its
 * collider on the frame it stops being a Prop. Nothing can touch a box further
 * out than this — `Player._gatherNear` culls at 2.6 m — so what it costs is
 * the sight line, and this is well past it.
 */
const RING_LOG = 16;

/**
 * A LOG YOU CAN PICK UP, AND WHY IT IS ONLY EVER A FEW OF THEM.
 *
 * "Can't pick up the trees either, it's like they're not real." That is player
 * note #8 at the tree — the same rule `tools/checks/physicality.mjs` enforces
 * everywhere else — and it is the one complaint in this file the instancing
 * argument at the top genuinely could not answer: a felled tree is a MATRIX
 * WRITE, and the Force's grip searches `world.physics.bodies`, so there was
 * nothing there to take hold of. Three draw calls for eighteen hundred trees is
 * what makes the wood possible and it is also what made every log furniture.
 *
 * So a log becomes a REAL OBJECT when the player is close enough to reach for
 * it, and goes back to being an instance when they leave.
 *
 * BOTH NUMBERS WENT UP, and the note they replace is what says why they had to.
 * It read: "`LIFT_RING` is 9 m — the Force reach is 22 m but a log you grip
 * from across a clearing is a log you never walked up to… `LIFT_CAP` is 4,
 * which is the draw-call budget… and it is also more logs than a player can
 * hold, throw or stand on at once."
 *
 * The second clause is the one that was wrong, and note #24 is what it costs:
 * "tree don't have physics anymore when they fall like you can't keep cutting
 * them up or anything." A cap of four is not about how many you can HOLD, it
 * is about how many can be real AT ONCE — and one cut in a dense stand fells a
 * median of three trees and a maximum of nine, all of them within a few metres
 * of each other. Four of nine become objects and five stay pictures with a
 * static box under them, which is exactly the reading: some of the trees you
 * just cut down can be cut again and some cannot, with nothing to tell you
 * which. 14 m and 9 covers the whole of a chain, and nine logs is nine draw
 * calls on a level that spends 106.
 *
 * THE MASS IS CAPPED AT 900 kg AND THAT IS A DECISION RATHER THAN A CHEAT. A
 * 20 m trunk 0.5 m through is eleven tonnes of green wood, and `force.mjs`
 * holds one rule about the grip: the highest lift cap in the game is 1,760 kg
 * and the heaviest body in the roster has to fit under it, because a thing the
 * Force cannot move does not read as heavy — it reads as a power that has
 * stopped working. A log is the largest object a player will ever try to lift,
 * so it is the one that would break that promise first.
 */
const LIFT_RING = 14;
const LIFT_CAP = 9;
const LOG_MASS_CAP = 900;
/**
 * Green wood, kg/m³ — the ONE density this file prices a trunk with.
 *
 * It was a literal `700` inside `_realise`'s mass, which was the only place a
 * trunk had a weight at all: the thing that came down on your head had none,
 * because it was billed a flat number. Both the log you lift and the trunk
 * that lands on you read it here now, so a trunk cannot be one weight in the
 * grip and another in the fall.
 */
const WOOD_DENSITY = 700;
/** Grid cell for the standing-tree index, in metres. */
const CELL = 12;
/** How often the ring is rebuilt. At a 4.6 m/s walk that is 1.2 m of travel. */
const SYNC = 0.25;

let _id = 1;

export class Forest {
  /**
   * @param {object} world
   * @param {object} opts  materials and the geometry dimensions
   */
  constructor(world, opts = {}) {
    this.id = 'forest' + (_id++);
    this.world = world;
    this.dead = false;
    this.kind = 'forest';
    this.grippable = false;
    this.generation = 0;
    this.toughness = opts.toughness ?? TOUGHNESS.plastoid;
    this.hp = Infinity;
    this.rng = makeRng(opts.seed ?? 4242);
    this.time = 0;

    /** How far from the blade a trunk is offered as a target. */
    this.reach = opts.reach ?? 5.0;
    /* WHAT A TRUNK DOES TO WHAT IS UNDER IT IS NOT A NUMBER ON THIS OBJECT.
     * It was `this.crush = opts.crush ?? 46`, applied flat to anything the
     * falling segment crossed — see `_sweep`, which prices it off the trunk's
     * own mass and the speed the wood was travelling at instead. */
    /** The stats the checks read. */
    this.stats = { felled: 0, chained: 0, crushed: 0, longestChain: 0 };

    this.data = null;                 // Float32Array, F.N per tree
    this.count = 0;
    this.trunkMesh = null;
    this.crownMesh = null;
    this.stumpMesh = null;
    /** Indices currently falling — the only ones whose matrices are rewritten. */
    this.active = [];
    /**
     * Colliders laid down for trunks that have come to rest, by tree index —
     * an ARRAY per log, because a trunk lying across rolling ground is solid
     * only where it is above it. See `_layLog`.
     */
    this.logs = new Map();
    /**
     * Every tree that is down and still lying where it fell. Kept because both
     * the log passes want "the down trees" and walking all 1,800 records four
     * times a second to find forty of them is a scan the record already knows
     * the answer to. A log the blade destroys leaves this set: there is nothing
     * lying there any more, and a collider under it would be exactly the
     * invisible wall this file is fixing.
     */
    this.down = new Set();
    /** Down trees that have become real liftable objects: index → { prop, box }. */
    this.real = new Map();
    /** Standing trunks that currently have a collider: index → static box. */
    this.live = new Map();
    /** Standing trunks by grid cell, so the ring is a lookup and not a scan. */
    this._cells = new Map();
    this._want = new Set();
    this._sync = 0;

    /* The duck-typed prop's body. This rides in `world.props` exactly as
     * `DestructionProxy` does, which is how it gets a per-frame `update`, a
     * slot in the blade solver's target list and the cut event that comes back
     * out of it, without a line of World.js changing. The position tracks the
     * player because `World._resolveBlades` culls a prop whose body is more
     * than 5 m from the middle of the blade. */
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  /* ── building ──────────────────────────────────────────────────────── */

  /**
   * Plant the stand. `list` is [{ x, z, height, radius, yaw, lean }] and the
   * three instanced meshes are built once from it.
   */
  plant(list, opts = {}) {
    const n = list.length;
    this.count = n;
    this.data = new Float32Array(n * F.N);
    const T = this.world.terrain;
    for (let i = 0; i < n; i++) {
      const t = list[i], k = i * F.N;
      this.data[k + F.X] = t.x;
      this.data[k + F.Z] = t.z;
      this.data[k + F.Y] = t.y ?? (T ? T.height(t.x, t.z) : 0);
      this.data[k + F.H] = t.height;
      this.data[k + F.R] = t.radius;
      this.data[k + F.YAW] = t.yaw ?? 0;
      this.data[k + F.STATE] = STANDING;
      this.data[k + F.TONE] = t.tone ?? 1;
      /* A LEAN, and it is not decoration: a tree that leans falls the way it
       * leans unless the cut says otherwise, which is the one piece of felling
       * lore every player already knows. Held under 0.09 rad — 5° — because
       * the trunk geometry is a straight rod and past about 6° a straight rod
       * standing at an angle reads as broken rather than as grown. */
      this.data[k + F.LEAN] = t.lean ?? 0;
      // …and into the cell index, so the collider ring below is a lookup over
      // a dozen cells rather than a scan of eighteen hundred trees.
      const key = this._cellKey(t.x, t.z);
      let cell = this._cells.get(key);
      if (!cell) this._cells.set(key, cell = []);
      cell.push(i);
    }

    const M = opts.materials || {};
    const bark = M.bark, leaf = M.leaf, core = M.core || M.bark;

    /* ONE trunk geometry for every tree in the level, unit-sized: 1 m tall,
     * 1 m in radius at the base, so a per-instance scale is the whole of what
     * makes a 6 m sapling and a 24 m giant different objects.
     *
     * SIX SIDES AND TWO RINGS, and the number is a budget rather than a taste.
     * A wood is dense or it is a park — measured, a median sight line under
     * 30 m needs about one stem per 20 m², which over the playable disc is
     * 1,900 trees — and 1,900 of anything means every triangle is spent 1,900
     * times. At 6 × 2 a trunk is 30 triangles and a canopy 120, so the whole
     * forest is 285k, which is what the ARENA spends on its architecture. At
     * the 7 × 3 and five-lobe canopy first written it was 660k and the level
     * could not afford to be a wood. */
    const trunkGeo = opts.trunkGeo || taperedGeo(1, 1, 0.52, 6, 2);
    const crownGeo = opts.crownGeo || crownBlobGeo(1, 3);
    const stumpGeo = opts.stumpGeo || taperedGeo(1, 1, 0.92, 6, 1);

    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, bark, n);
    this.crownMesh = new THREE.InstancedMesh(crownGeo, leaf, n);
    /* The stumps get their own mesh and their own COUNT, which starts at zero.
     * `InstancedMesh.count` is a draw-range, so a forest with nothing cut in it
     * pays nothing at all for the stump pass and a forest with forty stumps in
     * it pays one call. */
    this.stumpMesh = new THREE.InstancedMesh(stumpGeo, core, n);
    this.stumpMesh.count = 0;

    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this._writeTrunk(i);
      this._writeCrown(i);
      const t = this.data[i * F.N + F.TONE];
      col.setRGB(t, t, t, THREE.LinearSRGBColorSpace);
      this.trunkMesh.setColorAt(i, col);
      this.crownMesh.setColorAt(i, col);
      this.stumpMesh.setColorAt(i, col);
    }
    for (const m of [this.trunkMesh, this.crownMesh, this.stumpMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;         // the forest is the whole level
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.world.scene.add(m);
      this.world.statics?.push(m);
    }
    this.trunkMesh.name = 'forest.trunks';
    this.crownMesh.name = 'forest.crowns';
    this.stumpMesh.name = 'forest.stumps';
    return this;
  }

  /* ── the shape of one tree, at its current angle ───────────────────── */

  /** The direction the trunk points, from its hinge, as a unit vector. */
  axis(i, out = _v1) {
    const k = i * F.N;
    const ang = this.data[k + F.ANG];
    const dx = this.data[k + F.DX], dz = this.data[k + F.DZ];
    const s = Math.sin(ang), c = Math.cos(ang);
    return out.set(dx * s, c, dz * s).normalize();
  }

  /** Where the trunk is hinged: the cut face, or the ground. */
  hinge(i, out = _v2) {
    const k = i * F.N;
    return out.set(this.data[k + F.X], this.data[k + F.Y] + this.data[k + F.CUT], this.data[k + F.Z]);
  }

  /** The far end of the trunk. */
  tip(i, out = _v3) {
    const k = i * F.N;
    const len = this.data[k + F.H] - this.data[k + F.CUT];
    this.hinge(i, out);
    this.axis(i, AXIS);
    return out.addScaledVector(AXIS, len);
  }

  /* ── the colliders under the standing trees ────────────────────────── */

  /**
   * A STANDING TREE IS SOLID. It was not, and that is the defect this block
   * exists for: `plant()` wrote three InstancedMeshes and a Float32Array and
   * never touched physics, so on the one level built entirely out of trees all
   * 1,800 trunks were holograms — the player and every droid walked straight
   * through them — and the ONLY `addStaticBox` in this file was the one in
   * `_land()`, which gives a trunk a collider after you have cut it down.
   * Felling turned passable ground into an obstacle, which is backwards.
   * Measured before the fix: driving the real Player at the level's largest
   * trunk (r = 0.63 m, h = 25.9 m) from 5 m out, closest approach to the trunk
   * axis 0.01 m and the player finished 21.8 m past it.
   *
   * WHY IT IS A RING AND NOT 1,800 BOXES. Every near-list in the engine walks
   * `physics.staticBoxes` LINEARLY, once per body per frame — Player._gatherNear,
   * Enemy's push-out, and `supportHeight` for both — so the array is a per-frame
   * O(bodies × boxes) cost. Measured on the wood with a real World, a real
   * player and a 12-strong wave: 76 boxes (the level as shipped) 3.18 ms/frame,
   * +300 trees 4.00, +900 7.19, +1,800 14.09. A collider per trunk costs 10.9
   * ms a frame, i.e. two thirds of a 60 Hz budget, to make solid the 1,770
   * trees nobody is anywhere near.
   *
   * So the trunks near a BODY are solid and the rest are not: an 11 m ring
   * round each player, rebuilt four times a second off a 12 m cell index (a
   * dash is 15.5 m/s, so 0.25 s of it is 3.9 m — the ring is always ahead of
   * the body it follows). Measured with the same fight standing in the densest
   * part of the wood: 65 live boxes at the peak, 3.90 → 4.50 ms/frame, i.e.
   * 0.6 ms against the 10.9 ms of doing it exhaustively. The sight line here is
   * 25 m, so what is outside the ring is a trunk nobody is fighting at.
   */
  _cellKey(x, z) {
    return (Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096);
  }

  /** Standing trees within `r` of (x, z), into `out`. */
  _gatherRing(x, z, r, out) {
    const D = this.data;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    const r2 = r * r;
    for (let ci = i0; ci <= i1; ci++) {
      for (let cj = j0; cj <= j1; cj++) {
        const cell = this._cells.get((ci + 4096) * 8192 + (cj + 4096));
        if (!cell) continue;
        for (const i of cell) {
          const k = i * F.N;
          if (D[k + F.STATE] !== STANDING) continue;
          const dx = D[k + F.X] - x, dz = D[k + F.Z] - z;
          if (dx * dx + dz * dz <= r2) out.add(i);
        }
      }
    }
  }

  /** The box a standing trunk presents: square on the butt radius, capped. */
  _standBox(i) {
    const D = this.data, k = i * F.N;
    const phys = this.world.physics;
    if (!phys || !phys.addStaticBox) return null;
    const hh = Math.min(D[k + F.H], COLLIDER_H) * 0.5;
    /* 0.82 of the butt radius, not 1.0: the drawn trunk is a six-sided lathe
     * tapering to 0.52 r at the top, and a square whose half-width is the butt
     * radius circumscribes it by 41% at the corners — which is the difference
     * between a trunk you brush past and one you catch on nothing. */
    const w = Math.max(0.12, D[k + F.R] * 0.82);
    return phys.addStaticBox(
      new THREE.Vector3(D[k + F.X], D[k + F.Y] + hh, D[k + F.Z]),
      new THREE.Vector3(w, hh, w), undefined,
      { friction: 0.9, userData: { tree: i, forest: this } });
  }

  /** Bring the live set into line with where the bodies are. */
  _syncColliders() {
    const phys = this.world.physics;
    if (!phys || !this.data) return;
    const want = this._want;
    want.clear();
    for (const p of (this.world.players || [])) {
      if (p && p.alive !== false) this._gatherRing(p.position.x, p.position.z, RING_PLAYER, want);
    }
    if (RING_ENEMY > 0) {
      for (const e of (this.world.enemies || [])) {
        if (e && !e.dead) this._gatherRing(e.position.x, e.position.z, RING_ENEMY, want);
      }
    }
    for (const [i, box] of this.live) {
      if (want.has(i)) continue;
      phys.removeStaticBox(box);
      this.live.delete(i);
    }
    for (const i of want) {
      if (this.live.has(i)) continue;
      const box = this._standBox(i);
      if (box) this.live.set(i, box);
    }
    this._syncLogs();
    this._syncLogBoxes();
  }

  /**
   * THE SAME RING, ROUND THE THINGS THE PLAYER KNOCKED DOWN.
   *
   * See RING_LOG for what this is fixing and what it measured. A down tree
   * carries a collider while somebody is near enough to meet it and is a
   * picture the rest of the time, which is the rule the standing trunks have
   * had all along.
   *
   * A log that has become a `Prop` is skipped in both directions: it has a real
   * body of its own, and a static box under it as well would be a second,
   * invisible copy of a log the player can pick up and walk off with.
   */
  _syncLogBoxes() {
    const phys = this.world.physics;
    if (!phys || !phys.addStaticBox || !this.data) return;
    const D = this.data;
    const players = (this.world.players || []).filter((p) => p && p.alive !== false);
    for (const i of this.down) {
      const k = i * F.N;
      let near = false;
      for (const p of players) {
        const dx = p.position.x - D[k + F.X], dz = p.position.z - D[k + F.Z];
        if (dx * dx + dz * dz < RING_LOG * RING_LOG) { near = true; break; }
      }
      if (near && !this.real.has(i)) this._layLog(i);
      else this._liftLog(i);
    }
  }

  /**
   * A FELLED TRUNK IS SOLID WHERE IT IS VISIBLE, AND NOWHERE ELSE.
   *
   * This was one box for the whole trunk, and that is the other half of the
   * invisible wall. The fall is a rod pivoting on its stump: it stops at
   * horizontal, at the height of its own cut face, and the GROUND does not
   * stay level under it. Measured over 83 logs on the wood, a fifth of the
   * average log's length ends up entirely underground — 34 of the 83 had some
   * part of themselves buried and one was 90% of the way into a hillside,
   * 13.2 m under at the deep end. The drawn trunk goes in with it. So the
   * player met a full-length collider along ground that has nothing on it,
   * which is exactly the report: a wall you cannot get through and cannot see.
   *
   * The trunk is therefore sampled against the terrain and given a box per RUN
   * of itself that stands above it — usually one, two or three where it crosses
   * a rise, and none at all for a log that is completely buried. Nothing about
   * what is DRAWN changes; the collider stops claiming ground the drawing does
   * not.
   */
  _layLog(i) {
    if (this.logs.has(i)) return;
    const phys = this.world.physics;
    if (!phys || !phys.addStaticBox) return;
    const D = this.data, k = i * F.N;
    const r = D[k + F.R];
    const a = this.hinge(i, new THREE.Vector3());
    const b = this.tip(i, new THREE.Vector3());
    const len = a.distanceTo(b);
    if (!(len > 0.05)) return;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const T = this.world.terrain;
    /* One sample every metre and a half, which is finer than the terrain's own
     * feature size and coarse enough that a 26 m trunk is eighteen height
     * lookups — paid once, when the log is laid. With no terrain to ask (the
     * stub worlds the checks stand a bare Forest in) the whole trunk is above
     * "the ground" and this is one box, as it always was. */
    const n = T ? Math.max(2, Math.min(24, Math.round(len / 1.5))) : 1;
    const boxes = [];
    let runFrom = -1;
    const mid = new THREE.Vector3();
    const lay = (t0, t1) => {
      const span = (t1 - t0) * len;
      if (span < 0.4) return;                    // shorter than the log is thick
      mid.lerpVectors(a, b, (t0 + t1) * 0.5);
      const box = phys.addStaticBox(mid.clone(), new THREE.Vector3(r, r, span * 0.5), q,
        { friction: 0.86, userData: { log: i, forest: this } });
      if (box) boxes.push(box);
    };
    for (let s = 0; s < n; s++) {
      const t0 = s / n, t1 = (s + 1) / n;
      let showing = true;
      if (T) {
        mid.lerpVectors(a, b, (t0 + t1) * 0.5);
        // the TOP of the log against the ground: buried is buried, and a trunk
        // half in the mud is still something you climb over.
        showing = mid.y + r > T.height(mid.x, mid.z) + 0.05;
      }
      if (showing && runFrom < 0) runFrom = t0;
      if (!showing && runFrom >= 0) { lay(runFrom, t0); runFrom = -1; }
    }
    if (runFrom >= 0) lay(runFrom, 1);
    if (boxes.length) this.logs.set(i, boxes);
  }

  /** Take a log's colliders away — nobody is near it, or it is a Prop now. */
  _liftLog(i) {
    const boxes = this.logs.get(i);
    if (!boxes) return;
    for (const b of boxes) this.world.physics?.removeStaticBox?.(b);
    this.logs.delete(i);
  }

  /**
   * WHICH LOGS ARE REAL RIGHT NOW. Down trees inside `LIFT_RING` of a player
   * become `Prop`s — cuttable, liftable, throwable, standable — and go back to
   * being instances when the player walks away. See the note over the
   * constants: this is the only way the three-draw-call forest and "you can
   * pick up the trees" can both be true.
   *
   * A log the player is currently HOLDING or that has been moved is never taken
   * back, because putting a thrown log back into the instance buffer would
   * teleport it to where the tree fell.
   */
  _syncLogs() {
    if (!this.world.physics?.add) return;
    const D = this.data;
    const players = (this.world.players || []).filter((p) => p && p.alive !== false);
    // release the ones nobody is near, and the ones the blade has destroyed
    for (const [i, rec] of this.real) {
      if (rec.prop.dead) { this._release(i, true); continue; }
      /* HAS IT ACTUALLY BEEN MOVED? On DISPLACEMENT and not on velocity, and
       * the difference is the whole feature working or not: a log that has just
       * been dropped by the solver has a velocity for a second or two, so
       * latching on `velocity > 0` marked every log as moved, and a moved log
       * is never given back — four fellings later the cap was full of logs
       * nobody had touched and the fifth tree you cut was furniture again.
       * Measured with `tools/_logprobe.mjs`: 3 of 4 latched on the velocity
       * test having gone nowhere; 0 of 4 on this one. */
      if (!rec.moved && rec.prop.body.position.distanceToSquared(rec.home) > 4) rec.moved = true;
      const x = rec.moved ? rec.prop.body.position.x : D[i * F.N + F.X];
      const z = rec.moved ? rec.prop.body.position.z : D[i * F.N + F.Z];
      let near = false;
      for (const p of players) {
        const dx = p.position.x - x, dz = p.position.z - z;
        if (dx * dx + dz * dz < (LIFT_RING + 6) * (LIFT_RING + 6)) { near = true; break; }
      }
      if (!near) this._release(i, false);
    }
    if (!players.length || this.real.size >= LIFT_CAP) return;
    // …and realise the nearest down trees that are not real yet. Over `down`
    // rather than over every record in the forest: this runs four times a
    // second and the answer is forty indices out of eighteen hundred.
    for (const i of this.down) {
      if (this.real.size >= LIFT_CAP) break;
      if (this.real.has(i)) continue;
      const k = i * F.N;
      for (const p of players) {
        const dx = p.position.x - D[k + F.X], dz = p.position.z - D[k + F.Z];
        if (dx * dx + dz * dz < LIFT_RING * LIFT_RING) { this._realise(i); break; }
      }
    }
  }

  /** Turn down tree `i` into a real object. */
  _realise(i) {
    const D = this.data, k = i * F.N;
    const r = D[k + F.R];
    const len = Math.max(1.0, D[k + F.H] - D[k + F.CUT]);
    this.hinge(i, _v1);
    this.tip(i, _v2);
    const mid = _v3.copy(_v1).add(_v2).multiplyScalar(0.5).clone();
    /* The log's own geometry, at its own size — the instanced trunk is a unit
     * rod scaled per instance, and a Prop needs a mesh of its own. Six sides
     * and two rings, exactly as the instance is, so the object the player picks
     * up is the object that was lying there. */
    const geo = taperedGeo(len, r, 0.52, 6, 2);
    geo.translate(0, -len * 0.5, 0);          // about its middle, for the body
    const mat = this.trunkMesh.material;
    const mesh = new THREE.Mesh(geo, mat);
    const t = D[k + F.TONE];
    // the instance carried its tone as an instance colour; a lone mesh carries
    // it as a vertex colour, or the log comes out a different wood from the
    // stand it fell out of
    const col = new Float32Array(geo.attributes.position.count * 3);
    for (let v = 0; v < col.length; v += 3) { col[v] = t; col[v + 1] = t; col[v + 2] = t; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    // lying down: the rod's +Y runs from hinge to tip
    const axis = _v2.clone().sub(_v1).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, axis);
    /* A chain of spheres down the axis is what the blade solver walks, so a log
     * can be cut anywhere along its length rather than only at its middle. */
    const spheres = [];
    const N = Math.max(3, Math.min(9, Math.round(len / 2.2)));
    for (let s = 0; s < N; s++) {
      spheres.push({ c: new THREE.Vector3(0, (s / (N - 1) - 0.5) * len, 0), r: r * 1.05 });
    }
    const prop = new Prop(this.world, {
      kind: 'log', mesh, toughness: this.toughness, hp: 90, weather: false,
      grippable: true, spheres,
      mass: Math.min(LOG_MASS_CAP, this.massPerMetre(i) * len),
      friction: 0.86, restitution: 0.04,
      position: mid, quaternion: quat, centre: true,
    });
    prop.body.position.copy(mid);
    prop.body.quaternion.copy(quat);
    // the instanced copy steps aside, and so does the static box under it
    _s.setScalar(0);
    this.trunkMesh.setMatrixAt(i, _m.compose(mid, quat, _s));
    this.crownMesh.setMatrixAt(i, _m.compose(mid, quat, _s));
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.crownMesh.instanceMatrix.needsUpdate = true;
    this._liftLog(i);
    /* NOT registered here: `Prop` puts itself in `world.props` from its own
     * constructor now, and a second push is a second copy. */
    this.real.set(i, { prop, moved: false, home: mid.clone() });
  }

  /** Put log `i` back into the instance buffers. */
  _release(i, destroyed) {
    const rec = this.real.get(i);
    if (!rec) return;
    this.real.delete(i);
    if (!destroyed) {
      /* A LOG THE PLAYER MOVED GOES BACK WHERE IT NOW IS, not where the tree
       * fell. The instance buffers are the authority for a down tree's pose, so
       * handing one back without rewriting the record would teleport a log the
       * player had just thrown twenty metres back to its stump — which is the
       * single most obviously broken thing this could do. The record is
       * rewritten from the body: the hinge is the log's own end, and the fall
       * direction is its axis in plan. */
      if (rec.moved) {
        const D = this.data, k = i * F.N;
        const len = Math.max(0.2, D[k + F.H] - D[k + F.CUT]);
        const ax = _v1.set(0, 1, 0).applyQuaternion(rec.prop.body.quaternion);
        const foot = _v2.copy(rec.prop.body.position).addScaledVector(ax, -len * 0.5);
        D[k + F.X] = foot.x; D[k + F.Z] = foot.z;
        D[k + F.Y] = foot.y - D[k + F.CUT];
        const g = Math.hypot(ax.x, ax.z) || 1;
        D[k + F.DX] = ax.x / g; D[k + F.DZ] = ax.z / g;
        D[k + F.ANG] = Math.acos(clamp(ax.y, -1, 1));
      }
      rec.prop.destroy?.();
      this._writeTrunk(i); this._writeCrown(i);
      /* THE COLLIDER IS REBUILT FROM THE RECORD, not remembered from before.
       * It used to be a copy of the box taken away in `_realise`, thrown away
       * outright (`rec.box = null`) if the player had moved the log — so a log
       * you picked up and dropped four metres away went back to being a picture
       * with nothing under it at all, which is the intangible half of the same
       * rule. The record has just been rewritten from the body above; laying
       * the log off the record is therefore right in both cases and is one
       * fewer thing to keep in step. */
      this._layLog(i);
    } else {
      /* NOTHING IS LYING THERE ANY MORE. The blade cut this log into pieces,
       * and `_release` leaves its instance collapsed to zero scale — so it must
       * also leave the down set, or `_syncLogBoxes` would lay a collider along
       * a log that is not drawn and `_syncLogs` would quietly build the whole
       * thing again the moment the player stepped back. */
      this.down.delete(i);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.crownMesh.instanceMatrix.needsUpdate = true;
  }

  /** Take a trunk's standing collider away — it is about to move. */
  _dropCollider(i) {
    const box = this.live.get(i);
    if (!box) return;
    this.world.physics?.removeStaticBox?.(box);
    this.live.delete(i);
  }

  _writeTrunk(i) {
    const k = i * F.N;
    const len = Math.max(0.2, this.data[k + F.H] - this.data[k + F.CUT]);
    const r = this.data[k + F.R];
    this.hinge(i, _p);
    this.axis(i, AXIS);
    _q.setFromUnitVectors(UP, AXIS);
    // the unit geometry stands on its own origin, so the instance is placed at
    // the hinge and scaled to the surviving length
    _s.set(r, len, r);
    this.trunkMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }

  /**
   * THE CANOPY, AND WHY IT MOVED UP THE TRUNK.
   *
   * "The trunk extends further out than the canopy, it looks weird." It did,
   * and it was one number: the crown sat at 0.78 of the trunk's length with a
   * half-height of 0.62 × spread, so on the median tree (13 m, r 0.42) the
   * canopy's top reached 10.1 + 2.2 = 12.3 m and the trunk went on to 13.0 —
   * three quarters of a metre of bare pole sticking out of the top of the
   * foliage, on every tree in the wood, which is precisely what a tree does not
   * do.
   *
   * 0.88 and 0.76. The crown's centre is 0.88 of the way up and its half-height
   * is 0.76 of its spread, so the same tree now closes at 11.4 + 3.0 = 14.4 m
   * against a 13.0 m trunk: the shaft is INSIDE the canopy by a metre and a
   * half, at every size in the distribution, which is what was asked for. The
   * spread went up with it — 9.4 × the butt radius rather than 8.5 — because a
   * canopy that is taller and no wider is a bush.
   *
   * A FELLED tree keeps the tighter, lower figure: a crown that has hit the
   * ground is crushed, and the difference is the cheapest way to tell a
   * standing tree from a lying one at range.
   */
  _writeCrown(i) {
    const k = i * F.N;
    const h = this.data[k + F.H], r = this.data[k + F.R];
    const len = Math.max(0.2, h - this.data[k + F.CUT]);
    const down = this.data[k + F.STATE] === DOWN;
    this.hinge(i, _p);
    this.axis(i, AXIS);
    _p.addScaledVector(AXIS, len * (down ? 0.80 : 0.88));
    _q.setFromUnitVectors(UP, AXIS);
    const spread = r * (down ? 7.6 : 9.4);
    _s.set(spread, spread * (down ? 0.58 : 0.76), spread);
    this.crownMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }

  /* ── cutting ───────────────────────────────────────────────────────── */

  /** World-space capsules the blade solver tests, for trunks near the blade. */
  capsules(out = []) {
    out.length = 0;
    const D = this.data;
    if (!D) return out;
    const near = this.body.position;
    const r2 = this.reach * this.reach;
    for (let i = 0; i < this.count; i++) {
      const k = i * F.N;
      if (D[k + F.STATE] !== STANDING) continue;
      const dx = D[k + F.X] - near.x, dz = D[k + F.Z] - near.z;
      if (dx * dx + dz * dz > r2) continue;
      /* THE CAPSULE IS THE WHOLE TRUNK NOW, and the note that used to stand
       * here defended the opposite:
       *
       *   "THE CAPSULE STOPS AT 3.2 m, and that is the mechanic rather than an
       *    optimisation. A blade can only reach the bottom of a tree… a capsule
       *    up the whole trunk would let a player standing on a rock cut a tree
       *    through its canopy, and would put the CUT HEIGHT, which decides how
       *    tall the stump is, wherever the blade happened to be."
       *
       * It is kept because it names the two consequences correctly and then
       * calls them faults. THE PLAYER CALLED THEM THE FEATURE: "the trees can't
       * be cut anywhere, only at the bottom, so that needs to be fixed — needs
       * to be sliceable anywhere." A blade that stops mattering above chest
       * height on the one object in the game built to be cut is exactly the
       * "it's like it's not there" complaint, and a player who jumps, or stands
       * on a log, or Force-leaps into a canopy and swings has every right to
       * take the top off a tree.
       *
       * So the capsule runs the full standing length and the cut height goes
       * wherever the blade put it — see the clamp in `fell`, which now allows
       * 92% of the height instead of 60%. A high cut leaves a tall spar as its
       * "stump" (`stumpMesh` is drawn from the ground to the cut) and drops the
       * crown and whatever trunk was over it, which is what lopping a tree
       * does. Nothing about the cost changed: this list is already culled to
       * trunks within `reach` of the blade, and a capsule is two points.
       */
      const y0 = D[k + F.Y] + 0.15;
      const y1 = D[k + F.Y] + Math.max(0.5, D[k + F.H] - 0.2);
      out.push({
        name: 't' + i, tree: i, forest: this,
        p0: new THREE.Vector3(D[k + F.X], y0, D[k + F.Z]),
        p1: new THREE.Vector3(D[k + F.X], y1, D[k + F.Z]),
        r: D[k + F.R] * 1.05,
        toughness: this.toughness,
      });
    }
    return out;
  }

  /**
   * The blade got through a trunk. Returns [] — there are no halves to hand
   * back, because a felled tree is still one object.
   */
  cut(planePoint, planeNormal, impulse) {
    const i = this.nearestStanding(planePoint, 3.0);
    if (i < 0) return [];
    /* THE DIRECTION THE CUT IMPLIES. `impulse` is the velocity the blade was
     * swept at when it parted the wood, so its horizontal part is the way the
     * wood was pushed. A thrust — a cut with no lateral travel at all — has no
     * direction to give, and then the tree goes the way it leans, which is what
     * a tree with an undercut and no back cut actually does. */
    let dx = impulse ? impulse.x : 0, dz = impulse ? impulse.z : 0;
    const mag = Math.hypot(dx, dz);
    if (mag < 0.35) {
      const k = i * F.N;
      const lean = this.data[k + F.LEAN];
      const ly = this.data[k + F.YAW];
      dx = Math.sin(ly) * (lean || 1); dz = Math.cos(ly) * (lean || 1);
      const m2 = Math.hypot(dx, dz) || 1;
      dx /= m2; dz /= m2;
    } else { dx /= mag; dz /= mag; }
    this.fell(i, dx, dz, planePoint.y - this.data[i * F.N + F.Y]);
    return [];
  }

  /** The blade is grinding but has not got through: nothing to do. */
  shatter() {}
  damage() { return false; }

  /** Nearest standing trunk to a point, within `r` metres in plan. */
  nearestStanding(p, r = 3.0) {
    const D = this.data;
    let best = -1, bestD = r * r;
    for (let i = 0; i < this.count; i++) {
      const k = i * F.N;
      if (D[k + F.STATE] !== STANDING) continue;
      const dx = D[k + F.X] - p.x, dz = D[k + F.Z] - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Fell tree `i` toward (dx, dz), hinged at `cutH` metres up the trunk.
   *
   * `chain` is how many trees back down the chain this one is, and it is
   * carried only so the stats can report the longest chain a single cut
   * produced — the physics is identical whether a tree was cut or pushed.
   */
  fell(i, dx, dz, cutH = 0.6, chain = 0) {
    const k = i * F.N;
    const D = this.data;
    if (D[k + F.STATE] !== STANDING) return false;
    const h = D[k + F.H];
    /* 0.92 OF THE HEIGHT, not 0.6 — the other half of "sliceable anywhere".
     * The cap is not zero-cost: what stands after a cut is `stumpMesh` scaled
     * to the cut height, and what falls is scaled to `h − cut`, so a cut at
     * 0.99 h would drop a 20 cm disc and leave the whole tree standing, which
     * reads as a failed swing rather than as a cut. At 0.92 the shortest thing
     * this can fell off a 7.5 m sapling is 60 cm, which still visibly goes
     * over. Below, the floor stays at 0.25 m: a cut at the very ground has no
     * hinge to pivot on. */
    D[k + F.CUT] = clamp(cutH, 0.25, Math.max(0.3, h * 0.92));
    const m = Math.hypot(dx, dz) || 1;
    D[k + F.DX] = dx / m;
    D[k + F.DZ] = dz / m;
    D[k + F.STATE] = FALLING;
    /* A SMALL KICK OFF VERTICAL, and it is not a fudge — it is the model's
     * only degenerate point. θ̈ ∝ sin θ, so a rod that is exactly upright has
     * exactly no torque on it and stands there forever. 0.02 rad is about the
     * lean a saw kerf leaves, and it puts the first 5° of the fall at 1.9 s,
     * which is the pause that makes a felling read as a felling. */
    D[k + F.ANG] = 0.02;
    D[k + F.VEL] = 0;
    D[k + F.AGE] = 0;
    // The standing box goes NOW, not when the trunk lands: a tree in the air
    // is a moving object, and leaving the upright collider where the trunk used
    // to be would fence off the ground the player just cleared. `_land()` lays
    // the log collider down along the fallen trunk in its place.
    this._dropCollider(i);
    this.active.push(i);
    this.stats.felled++;
    if (chain > 0) {
      this.stats.chained++;
      if (chain > this.stats.longestChain) this.stats.longestChain = chain;
    }
    this._chainDepth = chain;

    // the stump it leaves, into the third instanced mesh
    if (D[k + F.CUT] > 0.28) {
      const n = this.stumpMesh.count;
      _p.set(D[k + F.X], D[k + F.Y], D[k + F.Z]);
      _q.identity();
      _s.set(D[k + F.R] * 1.04, D[k + F.CUT], D[k + F.R] * 1.04);
      this.stumpMesh.setMatrixAt(n, _m.compose(_p, _q, _s));
      this.stumpMesh.count = n + 1;
      this.stumpMesh.instanceMatrix.needsUpdate = true;
    }

    const fx = this.world.particles;
    if (fx) {
      _v1.set(D[k + F.X], D[k + F.Y] + D[k + F.CUT], D[k + F.Z]);
      fx.sparkBurst?.(_v1, null, 8, { speed: 4, embers: false });
    }
    return true;
  }

  /* ── the frame ─────────────────────────────────────────────────────── */

  update(dt) {
    if (!(dt > 0) || !this.data) return;
    this.time += dt;
    /**
     * THE PROXY FOLLOWS THE CUTTING EDGE, AND A THROWN BLADE LEAVES THE BODY.
     *
     * This was `this.world.player?.position`, and `capsules()` culls every
     * trunk outside `reach` of it — so a disc thrown 26 m out was offered no
     * tree at all to cut. Measured on the wood: aimed at a standing trunk
     * 12.2 m away, the disc passed within 1.40 m of its axis, crossed 17
     * standing trunks on the way, and felled 4 — every one of them beside the
     * player, none of them the target. Cleaving Throw, whose card says it
     * "cuts clean through everything it passes", reported one cleave.
     *
     * While the blade is in the air the player's HAND is empty, so there is
     * exactly one cutting edge in the world and this is where it is. When the
     * disc comes home the focus goes back to the body on the same frame the
     * blade does.
     *
     * The collider ring is deliberately NOT moved with it. Colliders are what
     * a BODY walks into; a disc is cut geometry, and carrying ~65 extra static
     * boxes around a blade in flight was measured to change nothing at all.
     */
    const owner = this.world.player;
    const flying = owner?.throwState && owner.throwState !== 'held' && owner.throwPos;
    const focus = flying ? owner.throwPos : owner?.position;
    if (focus) this.body.position.copy(focus);
    // The collider ring first, and outside the early-out below: a wood with
    // nothing falling in it is the case where standing trees have to be solid.
    this._sync -= dt;
    if (this._sync <= 0) { this._sync = SYNC; this._syncColliders(); }
    if (!this.active.length) return;

    const D = this.data;
    let write = false;
    for (let a = this.active.length - 1; a >= 0; a--) {
      const i = this.active[a];
      const k = i * F.N;
      const len = Math.max(1, D[k + F.H] - D[k + F.CUT]);
      /* θ̈ = (3g / 2L)·sin θ — a uniform rod pivoting at one end. The crown is
       * heavier than the butt in a real tree, which would make it faster; the
       * uniform result is used anyway because it is the one with a name and
       * because the difference at the scale of this level is under 12%. */
      D[k + F.VEL] += (3 * G / (2 * len)) * Math.sin(D[k + F.ANG]) * dt;
      D[k + F.ANG] += D[k + F.VEL] * dt;
      D[k + F.AGE] += dt;
      write = true;

      // what it is coming down on, this frame
      this._sweep(i, dt);

      if (D[k + F.ANG] >= REST) {
        D[k + F.ANG] = REST;
        D[k + F.VEL] = 0;
        D[k + F.STATE] = DOWN;
        this.active.splice(a, 1);
        this._land(i);
      }
      this._writeTrunk(i);
      this._writeCrown(i);
    }
    if (write) {
      this.trunkMesh.instanceMatrix.needsUpdate = true;
      this.crownMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * What the falling trunk crosses this frame: other trees, and bodies.
   *
   * The trunk is a segment from its hinge to its tip. A standing tree is a
   * vertical segment from its base to its crown. The test is segment-to-segment
   * distance against the sum of the two radii, which is the same primitive
   * `Physics.segmentSegment` already gives the blade — so a tree hitting a tree
   * is measured exactly the way a blade hitting a limb is.
   */
  _sweep(i, dt) {
    const D = this.data;
    const k = i * F.N;
    this.hinge(i, _v1);
    this.tip(i, _v2);
    const rad = D[k + F.R];

    for (let j = 0; j < this.count; j++) {
      if (j === i) continue;
      const q = j * F.N;
      if (D[q + F.STATE] !== STANDING) continue;
      const dx = D[q + F.X] - D[k + F.X], dz = D[q + F.Z] - D[k + F.Z];
      const reach = D[k + F.H] + D[q + F.R] + rad;
      if (dx * dx + dz * dz > reach * reach) continue;
      /* The standing tree, as a vertical segment from a metre and a half up to
       * its crown. It starts at 1.5 m because a trunk sweeping across at ankle
       * height is passing OVER a stump, not knocking a tree over, and without
       * that floor every tree in a stand fells its neighbour the instant the
       * first one reaches horizontal. */
      const by = D[q + F.Y];
      const near = segSegNear(_v1, _v2, D[q + F.X], by + 1.5, D[q + F.Z],
        D[q + F.X], by + D[q + F.H], D[q + F.Z]);
      if (near > rad + D[q + F.R] + 0.35) continue;
      // felled AWAY from the faller, along the faller's own direction
      this.fell(j, D[k + F.DX], D[k + F.DZ], 0.35, (this._chainDepth || 0) + 1);
    }

    /* AND ANYTHING STANDING UNDER IT — WHICH NOW INCLUDES YOU.
     *
     * This walked `world.enemies` and nothing else, so a twenty-metre trunk
     * came down through the player and did not touch them. Note #24: "they
     * should damage things/players/enemies if they fall on you." A tree that
     * is lethal to a droid and free to the person who cut it down is the one
     * hazard in the game the player can ignore, and it is the one they made.
     *
     * The two lists are walked through one loop over one concatenation rather
     * than by copying the body twice, because the property is "anything
     * standing under it" and a second copy is how the player half would have
     * drifted from the droid half. */
    const world = this.world;
    const len = Math.max(0.2, D[k + F.H] - D[k + F.CUT]);
    for (const list of [world.enemies, world.players]) {
      if (!list) continue;
      for (let e = 0; e < list.length; e++) {
        const en = list[e];
        if (!en || en.dead || en.alive === false || en._treeHit === this.stats.felled) continue;
        const d = pointSegDist(en.position.x, en.position.y + 0.9, en.position.z, _v1, _v2, _hit);
        if (d > rad + 1.0) continue;
        en._treeHit = this.stats.felled;
        const dmg = this.crushDamage(i, _hit.t, en.radius);
        en.damage?.(dmg, en.position, null, 'crush');
        /* A tree does not only hurt, it FLATTENS — and the shove is the same
         * speed the damage was billed off, so the sapling that grazed you for
         * eight nudges you and the trunk that read a hundred and forty throws
         * you the way it went. */
        const push = clamp(Math.abs(D[k + F.VEL]) * _hit.t * len * 0.55, 2.5, 12);
        en.applyKnockback?.(_v3.set(D[k + F.DX] * push, -push * 0.78, D[k + F.DZ] * push), 0, null);
        this.stats.crushed++;
      }
    }
  }

  /**
   * WHAT THE TRUNK BILLS THE THING IT LANDED ON — mass and impact speed, the
   * same rule a thrown crate pays.
   *
   * "Trees instakill you when they fall instead of doing damage relative to
   * their size or speed." They did: every hit was a flat 46 whatever the tree
   * and whatever part of it arrived, so two of them killed you and one sapling
   * brushing your shoulder at walking pace cost the same as twenty metres of
   * hardwood landing square. Nothing about the size or the speed was in it,
   * and both were sitting in the record.
   *
   * THE TWO NUMBERS, both read off the physics that is already running:
   *
   *   THE SPEED is the speed of the WOOD THAT TOUCHED YOU. A trunk pivoting
   *   on its stump turns at ω = `F.VEL` rad/s, so the part of it `arm` metres
   *   from the hinge is travelling ω·arm — the tip of a twenty-metre tree at
   *   24 m/s while the same trunk two metres from its stump is doing 2.4. That
   *   is the whole of "a glancing hit" and it costs one multiply, because
   *   `pointSegDist` already found where along the segment the victim was.
   *
   *   THE MASS is the length of trunk that came down ON them: the victim's own
   *   width of it, at the trunk's own mass per metre. A shoulder-width of a
   *   0.5 m trunk is 440 kg and of a 0.15 m sapling is 40 — a factor of eleven,
   *   which is the "relative to their size" half.
   *
   * Both then go through `impactDamage`, which is the crate's own coefficient,
   * floor and ceiling — see the note over it in Combat.js. The ceiling is what
   * stops the biggest tree in the wood being an instant death from any part of
   * itself, and the floor is what stops a slow one being a nothing.
   *
   * @param i     the falling tree.
   * @param t     where along the trunk it hit, 0 at the hinge and 1 at the tip.
   * @param rad   the victim's radius; a wider body catches more of the trunk.
   */
  crushDamage(i, t, rad) {
    const D = this.data, k = i * F.N;
    const len = Math.max(0.2, D[k + F.H] - D[k + F.CUT]);
    const arm = clamp(t, 0, 1) * len;
    const speed = Math.abs(D[k + F.VEL]) * arm;
    const width = clamp((rad ?? 0.5) * 2, 0.5, len);
    return impactDamage(this.massPerMetre(i) * width, speed);
  }

  /** Kilogrammes per metre of trunk `i`, off its own butt radius. */
  massPerMetre(i) {
    const r = this.data[i * F.N + F.R];
    return Math.PI * r * r * WOOD_DENSITY;
  }

  /**
   * A trunk has come to rest. It joins the down set and `_syncLogBoxes` gives
   * it a collider if there is anybody near enough to meet it — which is laid
   * on this frame rather than at the next sync, because the thing that just
   * fell in front of you has to be solid when you walk into it.
   */
  _land(i) {
    this._writeTrunk(i);
    this._writeCrown(i);
    this.down.add(i);
    this._syncLogBoxes();
    const fx = this.world.particles;
    if (fx) {
      this.tip(i, _v1);
      fx.sandPuff?.(_v1.clone(), 2.4, this.world.terrain?.height(_v1.x, _v1.z) ?? 0,
        this.world.groundColor);
    }
    this.world.addHitstop?.(0.02);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    // The ring's boxes are the forest's, not the level's: a forest destroyed
    // mid-level has to take them with it, or they fence off ground with no
    // trees on it. (`World.unload` clears the whole array either way.)
    for (const box of this.live.values()) this.world.physics?.removeStaticBox?.(box);
    this.live.clear();
    // …and the logs that had become real objects go with it, for the same
    // reason: they are the forest's, not the level's.
    for (const rec of this.real.values()) if (!rec.prop.dead) rec.prop.destroy?.();
    this.real.clear();
    // …and so are the logs' — same argument, and `logs` holds an array per log.
    for (const boxes of this.logs.values()) {
      for (const b of boxes) this.world.physics?.removeStaticBox?.(b);
    }
    this.logs.clear();
    this.down.clear();
    this._cells.clear();
    for (const m of [this.trunkMesh, this.crownMesh, this.stumpMesh]) {
      if (!m) continue;
      this.world.scene.remove(m);
      m.geometry.dispose();
    }
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
    if (this.world.forest === this) this.world.forest = null;
  }
}

/* ── geometry ─────────────────────────────────────────────────────────── */

/**
 * A unit trunk: 1 m tall, radius 1 at the base tapering to `top`, standing on
 * its own origin so a per-instance scale is the whole of its size.
 *
 * NOT a CylinderGeometry: three's cylinder is centred on its own middle, which
 * would put every hinge half a trunk underground, and it caps both ends with a
 * fan nobody sees. This is a ring-by-ring lathe with a flat cap at the top —
 * the top cap IS seen, because it is the cut face — and none at the bottom.
 */
/**
 * A tapered trunk, standing on its own origin, with a BUTTRESS FLARE at the
 * foot.
 *
 * THE FLARE IS THE REFERENCE'S SIGNATURE and it is what a straight rod does not
 * have. In `drowned-wood/dagobah.jpeg` and every Kashyyyk frame the trunks do
 * not meet the ground, they SPREAD into it — a skirt a third again as wide as
 * the shaft in the bottom eighth of the tree, which is what a shallow-rooted
 * tree in saturated ground grows. It is also the cheapest possible fix for
 * "the trees look like poles": one extra ring of vertices, `sides` more
 * triangles a tree, no extra draw call and no extra instance.
 *
 * `t` is remapped rather than the ring count raised, so the flare costs one
 * ring and the shaft keeps the rings it had.
 */
function taperedGeo(h, r0, top, sides = 7, rings = 3, flare = 1.42) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let ry = 0; ry <= rings + 1; ry++) {
    /* ring 0 is the flared foot at y = 0; ring 1 is where the shaft proper
     * starts, an eighth of the way up; the rest are the shaft's own. */
    const t = ry === 0 ? 0 : (ry - 1) / rings * 0.875 + 0.125;
    const y = t * h;
    const r = ry === 0 ? r0 * flare : lerp(r0, r0 * top, (t - 0.125) / 0.875);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU;
      /* The flare is LOBED rather than conical: a buttress root is three or
       * four fins, not a skirt, and the difference is what the ink pass draws
       * at the foot of every trunk in the wood. */
      const fin = ry === 0 ? 1 + Math.cos(a * 3 + s * 0.0) * 0.22 : 1;
      const cx = Math.cos(a), cz = Math.sin(a);
      pos.push(cx * r * fin, y, cz * r * fin);
      nrm.push(cx, 0.18, cz);
      uv.push(s / sides * 2.4, t * 2.2);
    }
  }
  const row = sides + 1;
  for (let ry = 0; ry < rings + 1; ry++) {
    for (let s = 0; s < sides; s++) {
      const a = ry * row + s, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // the cut face at the top
  const base = pos.length / 3;
  pos.push(0, h, 0); nrm.push(0, 1, 0); uv.push(0.5, 0.5);
  for (let s = 0; s <= sides; s++) {
    const a = (s / sides) * TAU;
    pos.push(Math.cos(a) * r0 * top, h, Math.sin(a) * r0 * top);
    nrm.push(0, 1, 0);
    uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
  }
  for (let s = 0; s < sides; s++) idx.push(base, base + 1 + s, base + 2 + s);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * A unit canopy: a cluster of flattened lobes about the origin, radius 1.
 *
 * Lobes rather than one sphere, and the reason is rule 1 of the art direction:
 * a sphere under a two-tone cel ramp has one continuous terminator running
 * round it and reads as a ball. Five overlapping lobes give the silhouette
 * corners, and corners are what the ink pass has to draw.
 */
function crownBlobGeo(r = 1, lobes = 5) {
  const parts = [];
  const rng = makeRng(77);
  for (let i = 0; i < lobes; i++) {
    const s = new THREE.SphereGeometry(r * (0.52 + rng() * 0.3), 6, 5);
    const a = (i / lobes) * TAU + rng() * 0.6;
    const rad = i === 0 ? 0 : r * (0.34 + rng() * 0.3);
    s.scale(1, 0.68, 1);
    s.translate(Math.cos(a) * rad, (rng() - 0.4) * r * 0.34, Math.sin(a) * rad);
    parts.push(s);
  }
  const g = mergeSimple(parts);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Merge position/normal/uv-only geometries. Props.js's mergeGeos wants more. */
function mergeSimple(list) {
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.attributes.position.count; ic += g.index ? g.index.count : 0; }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    const gi = g.index;
    for (let i = 0; i < gi.count; i++) idx[io + i] = gi.array[i] + vo;
    io += gi.count; vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/* ── geometry helpers ─────────────────────────────────────────────────── */

/** Closest distance between segment (a→b) and the vertical segment (c→d). */
function segSegNear(a, b, cx, cy, cz, dx, dy, dz) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = dx - cx, vy = dy - cy, vz = dz - cz;
  const wx = a.x - cx, wy = a.y - cy, wz = a.z - cz;
  const A = ux * ux + uy * uy + uz * uz;
  const B = ux * vx + uy * vy + uz * vz;
  const C = vx * vx + vy * vy + vz * vz;
  const Dd = ux * wx + uy * wy + uz * wz;
  const E = vx * wx + vy * wy + vz * wz;
  const den = A * C - B * B;
  let s = den > 1e-9 ? clamp((B * E - C * Dd) / den, 0, 1) : 0;
  let t = C > 1e-9 ? clamp((B * s + E) / C, 0, 1) : 0;
  s = A > 1e-9 ? clamp((B * t - Dd) / A, 0, 1) : 0;
  const px = a.x + ux * s - (cx + vx * t);
  const py = a.y + uy * s - (cy + vy * t);
  const pz = a.z + uz * s - (cz + vz * t);
  return Math.sqrt(px * px + py * py + pz * pz);
}

/**
 * Distance from a point to a segment — and, in `out`, WHERE along it.
 *
 * The parameter was always computed and thrown away, and it is the difference
 * between a trunk that hurts by the number 46 and one that hurts by how fast
 * the bit of it that reached you was moving. See `Forest.crushDamage`.
 */
function pointSegDist(x, y, z, a, b, out = null) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const L = ux * ux + uy * uy + uz * uz;
  const t = L > 1e-9 ? clamp(((x - a.x) * ux + (y - a.y) * uy + (z - a.z) * uz) / L, 0, 1) : 0;
  if (out) out.t = t;
  const px = x - (a.x + ux * t), py = y - (a.y + uy * t), pz = z - (a.z + uz * t);
  return Math.sqrt(px * px + py * py + pz * pz);
}

/**
 * The world's forest, made on demand and riding in `world.props`.
 */
export function attachForest(world, opts = {}) {
  if (!world) return null;
  if (world.forest && !world.forest.dead) return world.forest;
  const f = new Forest(world, opts);
  world.forest = f;
  if (world.addProp) world.addProp(f);
  else if (world.props) world.props.push(f);
  return f;
}
