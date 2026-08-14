/**
 * SABER — trees you can cut down, and trees that come down on each other.
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
import { TOUGHNESS } from '../game/Combat.js';
import { clamp, makeRng, TAU, lerp } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AXIS = new THREE.Vector3();

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
 * and killable. So the wood is solid where the fight is, and the rest of the
 * answer is a wall-avoid term in Enemy's steering, which is not this file's to
 * write. When that lands, this goes back to 5.
 */
const RING_PLAYER = 11;
const RING_ENEMY = 0;
const COLLIDER_H = 9;
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
    /** Damage a trunk does to anything it lands on. */
    this.crush = opts.crush ?? 46;
    /** The stats the checks read. */
    this.stats = { felled: 0, chained: 0, crushed: 0, longestChain: 0 };

    this.data = null;                 // Float32Array, F.N per tree
    this.count = 0;
    this.trunkMesh = null;
    this.crownMesh = null;
    this.stumpMesh = null;
    /** Indices currently falling — the only ones whose matrices are rewritten. */
    this.active = [];
    /** Colliders laid down for trunks that have come to rest. */
    this.logs = [];
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

  _writeCrown(i) {
    const k = i * F.N;
    const h = this.data[k + F.H], r = this.data[k + F.R];
    const len = Math.max(0.2, h - this.data[k + F.CUT]);
    this.hinge(i, _p);
    this.axis(i, AXIS);
    // the canopy sits at 0.78 of the surviving trunk and rides it over
    _p.addScaledVector(AXIS, len * 0.78);
    _q.setFromUnitVectors(UP, AXIS);
    const spread = r * (this.data[k + F.STATE] === DOWN ? 7.0 : 8.5);
    _s.set(spread, spread * 0.62, spread);
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
      /* THE CAPSULE STOPS AT 3.2 m, and that is the mechanic rather than an
       * optimisation. A blade can only reach the bottom of a tree, so that is
       * the only part of it that may be offered as a target — a capsule up the
       * whole trunk would let a player standing on a rock cut a tree through
       * its canopy, and would put the CUT HEIGHT, which decides how tall the
       * stump is, wherever the blade happened to be. */
      const y0 = D[k + F.Y] + 0.15;
      const y1 = D[k + F.Y] + Math.min(3.2, D[k + F.H] * 0.6);
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
    D[k + F.CUT] = clamp(cutH, 0.25, Math.max(0.3, h * 0.6));
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
    const focus = this.world.player?.position;
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

    // and anything standing under it
    const world = this.world;
    const hitList = world.enemies;
    if (hitList) {
      for (let e = 0; e < hitList.length; e++) {
        const en = hitList[e];
        if (!en || en.dead || en._treeHit === this.stats.felled) continue;
        const d = pointSegDist(en.position.x, en.position.y + 0.9, en.position.z, _v1, _v2);
        if (d > rad + 1.0) continue;
        en._treeHit = this.stats.felled;
        en.damage?.(this.crush, en.position, null, 'crush');
        this.stats.crushed++;
      }
    }
  }

  /**
   * A trunk has come to rest. Give it a collider, so a felled tree is a thing
   * you can be stopped by and stand on rather than a picture of one.
   *
   * ONE STATIC BOX FOR THE WHOLE TRUNK. `supportHeight` reads static boxes for
   * the player, the enemies and the gait solver alike, so this is the same
   * query that answers a crate — and one box per log is what keeps the cost of
   * clearing a forest proportional to what the player actually cut down rather
   * than to how many trees there were.
   */
  _land(i) {
    const D = this.data;
    const k = i * F.N;
    const phys = this.world.physics;
    this._writeTrunk(i);
    this._writeCrown(i);
    if (phys && phys.addStaticBox) {
      this.hinge(i, _v1);
      this.tip(i, _v2);
      const mid = _v3.copy(_v1).add(_v2).multiplyScalar(0.5);
      const len = _v1.distanceTo(_v2);
      const yaw = Math.atan2(D[k + F.DX], D[k + F.DZ]);
      const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      const r = D[k + F.R];
      const box = phys.addStaticBox(mid.clone(), new THREE.Vector3(r, r, len * 0.5), q,
        { friction: 0.86 });
      if (box) this.logs.push(box);
    }
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
function taperedGeo(h, r0, top, sides = 7, rings = 3) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let ry = 0; ry <= rings; ry++) {
    const t = ry / rings;
    const y = t * h, r = lerp(r0, r0 * top, t);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      pos.push(cx * r, y, cz * r);
      nrm.push(cx, 0.18, cz);
      uv.push(s / sides * 2.4, t * 2.2);
    }
  }
  const row = sides + 1;
  for (let ry = 0; ry < rings; ry++) {
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

/** Distance from a point to a segment. */
function pointSegDist(x, y, z, a, b) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const L = ux * ux + uy * uy + uz * uz;
  const t = L > 1e-9 ? clamp(((x - a.x) * ux + (y - a.y) * uy + (z - a.z) * uz) / L, 0, 1) : 0;
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
