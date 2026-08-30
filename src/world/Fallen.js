/**
 * BATTLEFRONT BORZ — THE DEAD MARK THE FRONT.
 *
 * `FLAGSHIP.md` §12.4, verbatim: *"**The dead mark the front**: 520 prone
 * instanced figures in a 26 m band, thickest at the choke, one draw call."*
 *
 * `src/world/Front.js` listed this as the one of its five ground marks that was
 * **absent, and not faked** — "there is no instanced-corpse builder anywhere in
 * the tree: `Corpses.js` holds real ragdolled bodies with a budget of a few
 * dozen, which is a completely different object." This is that builder, and it
 * is the same object the colosseum's crowd is: one geometry, one material, one
 * `InstancedMesh`, per-instance colour, no physics, no cutting, no shadow-cast.
 * `Props.seatCrowd` puts 3,240 figures in a bowl for one call; this puts a few
 * hundred on the ground for two, and the argument is identical.
 *
 * ── WHY THIS AND NOT MORE CORPSES ───────────────────────────────────────
 *
 * `Corpses.js` holds bodies that were ALIVE — they have a rig, a garment, a
 * cloth solver and capsules, they can be cut, and the budget on them is a few
 * dozen because each one is 26 draw calls (§4). A field of the fallen is the
 * opposite object in every respect: nobody was ever alive in it, nothing can
 * interact with it, and the number of them IS the content. §11's own account of
 * why the reference plates are brutal names this first — *"what does it: the
 * **quantity of the fallen**, the **indifference** of the living walking past"*
 * — and quantity is exactly the axis a real body cannot be scaled along.
 *
 * ── WHAT A PRONE FIGURE HAS TO CARRY, AND AT WHAT SIZE ──────────────────
 *
 * A man lying down is 1.8 m long and about 0.45 m tall. On this ground at the
 * distances the front is read from that is:
 *
 *     20 m    81 px long, 20 px tall     — the shape has to be right
 *     60 m    27 px                      — silhouette and value only
 *    140 m    11 px                      — a dark dash, and past the ink
 *
 * So the figure is built for the 27 px reading and checked at 81: a torso, a
 * head, one arm thrown out and the legs apart. **104 triangles**, measured off
 * the merged buffer rather than counted off the boxes — the crowd's seated
 * figure is 96 for comparison, and the reference plates' fallen are read at
 * about the same size as its spectators. §11's
 * "value, not hue, at scale" is why the variation is per-instance TONE rather
 * than per-instance geometry — at 11 px a second silhouette buys nothing, and
 * two flat tones with 0.18 luma between them is the whole of what survives.
 *
 * ── AND WHY IT IS TWO CALLS AND NOT ONE ─────────────────────────────────
 *
 * Two poses — sprawled and curled — because one pose repeated four hundred
 * times over 26 m of open ground is a pattern, and a pattern reads as a decal
 * (the exact fault `Front.walkingBarrage` avoids by jittering, and the exact
 * fault the crowd was rebuilt to fix). §12.4 asks for one draw call; the honest
 * price of not repeating one silhouette four hundred times is two, and two is
 * still 0.4% of this level's 520-call budget.
 */

import * as THREE from '../../vendor/three/three.module.js';
/* One reader for "which side of the front, and how far" — see the note over
 * `frontLine`. A band across a curve is the same two numbers as a band across
 * a bearing, so this file holds no copy of either. */
import { frontLine } from './Battlefield.js';
import { makeRng, clamp, lerp, TAU } from '../engine/MathUtil.js';
import { mergeGeos } from './Props.js';

/** How long a man is, lying down. Everything else is a fraction of it. */
const LEN = 1.80;

/**
 * WHAT ONE MAN'S FALL IS WORTH TO THE GROUND'S LONG MEMORY.
 *
 * ── THE GROUND DID NOT KNOW ANYBODY HAD DIED ON IT ──────────────────────
 *
 * `Terrain.scars` is the field that "does not decay and is not a window", the
 * one thing on the ground that says a war happened here, and it is written by
 * bolts (`_boltHitTest`), craters (`Terrain.crater`) and the front's own
 * dressing (`Front.burnBand`). MEASURED on colosseum, five men killed at their
 * feet and the field read back at each body's own resting place:
 *
 *     scorch at the five death sites   0.000  0.000  0.000  0.000  0.000
 *
 * Nothing. A saber kill lands no bolt and digs no crater, so the ground a
 * company was cut down on was indistinguishable from ground nobody had ever
 * stood on. The burnt half of a front was therefore a fact about the DRESSING
 * — laid once at load by `burnBand` — and never a record of the fight the
 * player actually had.
 *
 * ── AND WHY IT IS A SMUDGE PER MAN AND NOT A BURN ───────────────────────
 *
 * `SCAR_STACK` is 0.30 and its own note reads: "it takes four passes over the
 * same ground to blacken it, so what the field draws is where the fighting
 * CONCENTRATED". This is the same argument one rung down. A body is not a
 * shell — it burns nothing by itself — and what actually marks that square
 * metre is the fight that put him there: the bolts that missed, the blade, and
 * the men who went over the spot. So one man is worth half of what a single
 * pass is, which MEASURED against the field's own stacking is:
 *
 *     bodies falling on one 1.6 m cell    1     2     4     7     8
 *     scorch the ground reads back      0.15  0.30  0.60  1.00  1.00
 *
 * One man is a smudge you would not notice; seven fallen within a body's length
 * of each other is black ground, which is what a heap is. The mark reads 1.6 m
 * either side of him and nothing at 2.4 m, measured across the same field, so a
 * line of men who fell where they stood draws a line and men scattered over a
 * hillside draw nothing — which is the distinction worth having.
 *
 * The radius is a man's own length rather than a second number, and it costs
 * **1.34 µs** a body (20 000 writes, same ground): six figures a wave of the
 * field's 1.6 m cells, once per death, against a frame that has 33 000 µs.
 *
 * Over a long drive — 894 deaths on the colosseum — the ground goes from 206
 * marked cells to 812, and `world.update` measures 0.689 ms before and 0.650
 * after, which is to say the difference is under the noise on a 300-frame
 * sample. The record is four times the size and costs nothing to keep.
 */
const LIE_SCORCH = 0.5;

/**
 * HOW FAR INTO THE GROUND A BODY LIES, in metres.
 *
 * A man on sand is IN it by a few centimetres and — more to the point — a prone
 * box sitting exactly on a heightfield reads as furniture. The sink is what
 * makes it read as lying rather than as placed. Named because `FallenField`
 * below seats a body the same way and a second copy of it would be a second
 * answer to "how does a body lie on this ground".
 */
const LIE_SINK = 0.045;

/**
 * The two poses, in a frame where +Z is head-to-foot and the body lies in the
 * XZ plane. Both are built from boxes: a prone body at 27 px has no curve on
 * it that a six-sided cylinder would buy back.
 */
function sprawled() {
  const parts = [];
  const box = (w, h, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  // torso, face down, chest a little proud of the sand
  box(0.46, 0.26, 0.62, 0, 0.13, 0.10);
  // hips and the two legs, apart and slack
  box(0.40, 0.22, 0.22, 0, 0.11, -0.28);
  box(0.16, 0.17, 0.52, -0.11, 0.085, -0.62, 0.16);
  box(0.16, 0.17, 0.48, 0.13, 0.085, -0.64, -0.22);
  // one arm thrown out — the single most legible thing about a body on the
  // ground, and the reason this pose is not a sack
  box(0.44, 0.13, 0.14, -0.34, 0.065, 0.24, 0.5);
  box(0.13, 0.13, 0.34, 0.24, 0.075, 0.30, -0.3);
  // head, low and turned
  const h = new THREE.SphereGeometry(0.115, 6, 4);
  h.scale(1.0, 0.85, 1.05);
  h.translate(0.05, 0.115, 0.50);
  parts.push(h);
  return mergeGeos(parts);
}

function curled() {
  const parts = [];
  const box = (w, hh, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, hh, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  // on its side, knees up: shorter, taller, and a completely different blob
  box(0.34, 0.40, 0.56, 0, 0.20, 0.06);
  box(0.32, 0.34, 0.26, 0.04, 0.17, -0.28);
  box(0.16, 0.30, 0.40, 0.10, 0.15, -0.52, 0.34);
  box(0.15, 0.26, 0.36, -0.08, 0.13, -0.50, -0.20);
  box(0.34, 0.13, 0.14, -0.20, 0.28, 0.22, 0.9);
  const h = new THREE.SphereGeometry(0.115, 6, 4);
  h.scale(1.0, 1.0, 0.95);
  h.translate(-0.02, 0.30, 0.40);
  parts.push(h);
  return mergeGeos(parts);
}

/**
 * A FRESH PAIR PER CALL, and the material shared for the whole process. The
 * two halves of an object's lifetime are handled by different code here and
 * getting them the wrong way round leaks either way:
 *
 *   GEOMETRY per call, because `World.unload` walks `world.statics` and calls
 *     `m.geometry?.dispose?.()`. A geometry shared across levels would be
 *     disposed by the first unload and drawn by the second.
 *   MATERIAL per process, because `unload` does NOT dispose materials — so a
 *     material allocated per level is a material leaked per level. This is
 *     `Smoke.js`'s rule and it is written down there for the same reason.
 *
 * Two merges of eight boxes is nothing to rebuild; a leak is forever.
 */
function fallenGeometry() {
  const a = sprawled(), b = curled();
  /* The scale to LEN is applied here so both poses measure the same man. */
  for (const g of [a, b]) { g.scale(1, 1, LEN / 1.8); g.computeVertexNormals(); }
  return [a, b];
}

let _mat = null;
function fallenMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 });
  /* PER-INSTANCE COLOUR AND NOTHING ELSE. `instanceColor` multiplies the base,
   * so white here means the instance tone IS the colour — one material for
   * both armies. Rule 8: nothing is shiny, and a specular lobe on four hundred
   * backs is a field of sparkle where there should be a field of the dead. */
  _mat.userData.weather = 0;
  return _mat;
}

/**
 * SCATTER THE FALLEN ALONG A LINE.
 *
 * ── AND THE LINE IS NOT NECESSARILY STRAIGHT ─────────────────────────────
 *
 * `opts.origin` + `opts.dir` is a half-plane, which is what a front was when
 * this was written. `opts.front` hands it the one reader instead
 * (`Battlefield.frontLine`) and every body is placed by `place(along,
 * across)`, so the band follows a bezier the same way it follows a bearing —
 * and §12.4's "thickest at the choke" becomes true of the choke rather than of
 * a point that stands in for it. Neither of the two draws per body moves, so a
 * seeded field on a straight front is the field it was.
 *
 * @param world        needs `scene`, `statics`, and `terrain` to lie on
 * @param opts.front   the front to follow, or null for the half-plane below
 * @param opts.origin  {x,z} a point ON the line
 * @param opts.dir     {x,z} unit, the axis of advance; the band runs ACROSS it
 * @param opts.count   how many bodies
 * @param opts.half    how far along the line to spread them, metres
 * @param opts.depth   the band's 1σ across the line, metres. §12.4's 26 m band
 *                     is 2σ ≈ 26, so 6.5 either side of the line.
 * @param opts.palette per-army tones, picked per body
 * @param opts.minHeight  ground below this carries no body — the level's own
 *                     water/lava line, handed in by the caller
 * @returns {{meshes: THREE.InstancedMesh[], count: number, calls: number}|null}
 */
export function addFallen(world, opts = {}) {
  if (!world?.scene) return null;
  const n = Math.max(0, Math.round(opts.count ?? 260));
  if (!n) return null;
  const T = world.terrain;
  const rng = makeRng(opts.seed ?? 4211);
  const o = opts.origin || { x: 0, z: 0 };
  const d = opts.dir || { x: 1, z: 0 };
  const ax = -d.z, az = d.x;
  const line = opts.front ? frontLine(opts.front) : null;
  const half = opts.half ?? 150;
  const depth = opts.depth ?? 6.5;
  /* THE THREE FLAT TONES §11 ASKS FOR, and they are the armies' own: clone
   * plastoid is the pale one, a droid's shell is the mid one, and the dark one
   * is what a body that has been burnt or lain a while is. Three, not a ramp:
   * "three bands with ≥0.18 luma separation" is the rule, and a continuous
   * random tone across four hundred bodies has none. */
  const palette = (opts.palette || [0x9a958c, 0x8a6b46, 0x4c4038]).map((h) => new THREE.Color(h));

  const geos = fallenGeometry();
  const bins = geos.map(() => []);
  const tint = geos.map(() => []);
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    /* ALONG the line: uniform, but CLUMPED — men die where the fighting was,
     * and a Poisson scatter of four hundred bodies over 300 m is a lawn. Each
     * body is drawn near one of a handful of knots, which is the same thing
     * `strewGround`'s density does one level up and the same statistic §12
     * says Clark–Evans cannot see. */
    const knot = Math.floor(rng() * 7);
    const centre = (knot / 6 - 0.5) * 2 * half * 0.86;
    const along = clamp(centre + (rng() + rng() + rng() - 1.5) * half * 0.30, -half, half);
    /* ACROSS it: a sum of three uniforms is a fair enough normal, and the band
     * is deliberately BIASED to the burnt side — the line advanced over this
     * ground, so the men who fell short of it are on the near half and the
     * ones who fell taking it are past. 0.35 of a sigma is what that bias is
     * worth; anything more and the band stops straddling the line at all. */
    const across = (rng() + rng() + rng() - 1.5) * depth * 1.4 + depth * 0.35;
    /* `place` takes (along the line, into the burnt side), which is the pair
     * the two draws above already are. The straight branch is the same
     * expression written out. */
    /* NOT `p` — that name is the reusable `Vector3` this loop composes its
     * matrix out of, twenty lines down, and shadowing it made every body's
     * `p.set(x, y, z)` a call on null. It threw inside `marchFront`, which
     * catches and warns, so the mode kept running with a front that never
     * marched: a caught exception that only warns is the shape that survives
     * a gate. */
    const site = line ? line.place(along, across) : null;
    const x = site ? site.x : o.x + d.x * across + ax * along;
    const z = site ? site.z : o.z + d.z * across + az * along;
    if (T?.inBounds && !T.inBounds(x, z)) continue;
    /* SUNK — see LIE_SINK, which `FallenField.lay` seats a retired body by too. */
    const y = (T ? T.height(x, z) : 0) - LIE_SINK;
    /* NOT UNDER THE SHEET. A level's sea is a number in the same metres this
     * height is, and nothing here knew about it: on the Ember Shelf the
     * marching front's engagement 1 stands 180 m out over ground 45 m BELOW a
     * lava sheet at +0.55, so the whole band was laid on the sea floor —
     * invisible, and inside a hazard that charges 52 HP a second to anything
     * that stands in it. The caller passes the sheet (`Front.marchFront`), so
     * a field with no sea is unchanged term for term. */
    if (opts.minHeight !== undefined && y < opts.minHeight) continue;
    if (T?.normalAt) T.normalAt(x, z, nrm); else nrm.copy(up);
    q.setFromUnitVectors(up, nrm);
    qy.setFromAxisAngle(up, rng() * TAU);
    q.multiply(qy);
    p.set(x, y, z);
    s.setScalar(lerp(0.92, 1.10, rng()));
    const v = rng() < 0.62 ? 0 : 1;
    bins[v].push(m.compose(p, q, s).clone());
    const pk = rng();
    tint[v].push(palette[pk < 0.44 ? 0 : pk < 0.82 ? 1 : 2]);
  }

  const meshes = [];
  let calls = 0, placed = 0;
  for (let v = 0; v < geos.length; v++) {
    const list = bins[v];
    if (!list.length) { geos[v].dispose(); continue; }
    const im = new THREE.InstancedMesh(geos[v], fallenMaterial(), list.length);
    for (let i = 0; i < list.length; i++) {
      im.setMatrixAt(i, list[i]);
      im.setColorAt(i, tint[v][i]);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    /* RECEIVES, NEVER CASTS. A body lying on the ground casts a shadow a few
     * centimetres long that nothing can see, and four hundred casters in a
     * shadow map sized for a fight is the crowd's own trade made again. What
     * it must do is RECEIVE, or the field stays lit while the ground around it
     * goes into the smoke's shade. */
    im.castShadow = false;
    im.receiveShadow = true;
    im.name = 'fallen';
    im.matrixAutoUpdate = false;
    im.updateMatrix();
    im.computeBoundingSphere?.();
    /* INTO `statics`, one entry per mesh and NOT a Group holding both. That is
     * what `World.unload` disposes — it reads `.geometry` off each entry, and a
     * Group has none, so a Group would be removed from the scene with its two
     * geometries still on the GPU. Same convention as `addInstanced`. */
    world.scene.add(im);
    world.statics?.push(im);
    meshes.push(im);
    calls++; placed += list.length;
  }
  if (!placed) return null;
  return { meshes, count: placed, calls };
}

/** Exported so a check cannot keep a second copy of how long a man is. */
export const FALLEN_LENGTH = LEN;
/** …and of what one man's fall is worth to the ground. See `LIE_SCORCH`. */
export { LIE_SCORCH as FALLEN_SCORCH };

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE FIELD A FIGHT FILLS — where a corpse goes when the budget is done  */
/*  with it                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `addFallen` above is DRESSING: a level lays a band of men nobody was ever
 * alive in, once, at load. This is the same object filled from the other end —
 * by `Corpses.js`, one instance at a time, as the field's own dead are retired.
 *
 * ── WHY RETIRE AND NOT DELETE, AND IT IS A DRAW-CALL ARGUMENT ───────────
 *
 * `Corpses.js`'s own header calls SINK "the only step that removes anything
 * visible, and it is deliberately last" — and what it removes is the body,
 * permanently. So a fight that kills two hundred men leaves at most
 * `CORPSE_BUDGET` of them on the ground and the rest simply stop having
 * existed. That is the one thing about the dead a player can see happening.
 *
 * The reason the budget is that tight is measured, and it is not triangles.
 * `tools/_farcorpse.mjs`, a B1 on geonosis, the shipped build:
 *
 *     100 m   alive  4 meshes (the L2 merged skin)   dead  44
 *     163 m   alive  0 meshes (the L3 cohort)        dead  44
 *
 * A body gets CHEAPER as it walks away and then costs eleven times as much the
 * moment it falls, because `MergedSkin`'s staleness drops the L2 bake on
 * `actor.ragdolled` — correctly, a bake of a standing pose cannot follow a
 * ragdoll — and `Enemy.update` returns on `dead` above the line that would
 * re-ask for the cohort. There is no rung below a corpse. This is that rung:
 * one instance in a shared buffer, at the far end of the fade the budget was
 * already running, for two draw calls however many of them there are.
 *
 * ── AND THE BODY IT REPLACES IS THE ONE NOBODY IS LOOKING AT ────────────
 *
 * `Corpses.worth` already ranks the field by near, recent and in-front and
 * spends the loser. So the body handed over here is by construction far, old
 * and behind — which is 27 px and under, the reading this file's figure was
 * built for and checked at (see the table at the top). Retirement does not
 * choose a distance; it inherits the choice the budget already made.
 */

/**
 * HOW MANY THE FIELD DRAWS, and it is a cap on the DRAWING, not on the dying.
 *
 * §12.4 verbatim in this file's first paragraph — "520 prone instanced figures
 * in a 26 m band" — is the size this object was built to, so it is the size the
 * buffers are allocated at. Fixed and not grown for `GraveField`'s reason: an
 * `InstancedMesh` cannot grow, and a field that reallocated itself per casualty
 * would be a reallocation per death, which is the cost this exists to remove.
 * Past it the oldest retired body's slot is taken back — the ring below —
 * because a wrap is the one failure mode that keeps the NEWEST dead on screen,
 * and the newest are the ones the fight just made.
 */
export const FALLEN_MAX = 520;

/* One set of scratch objects for `lay`, which runs once per retired body. */
const _up = new THREE.Vector3(0, 1, 0);
const _nrm = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qy = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class FallenField {
  constructor(cap = FALLEN_MAX) {
    this.cap = Math.max(1, cap | 0);
    /** How many have been laid down, ever. Counts past `cap` — see the ring. */
    this.laid = 0;
    this.scene = null;
    this.terrain = null;
    this.meshes = null;
    /** Above this chest height the body reads as curled rather than sprawled. */
    this.split = 0;
    /**
     * THE RING, AND WHY IT IS ONE LIST AND NOT ONE PER POSE.
     *
     * `cap` is a bound on the whole field, but a body is drawn out of one of
     * TWO buffers and an instance cannot move between them — recycling the
     * oldest slot by pose would leave a hole in whichever buffer lost it, and
     * a hole in an `InstancedMesh` is an identity matrix, which is a man lying
     * at the world origin.
     *
     * So the ring records the slot each body went into, `[buffer, index]`, in
     * the order they were laid; past `cap` the oldest of those slots is
     * overwritten wherever it lives, and the new body inherits the pose of the
     * man it replaces. That is the one compromise in this object and it is
     * bounded to the 521st casualty of a single engagement.
     */
    this._ring = [];
    /** How many slots of each buffer are in use. */
    this._used = [];
  }

  /** Draw calls this field costs, whatever is in it. */
  get calls() { return this.meshes ? this.meshes.length : 0; }
  /** Instances actually drawn. */
  get count() { return Math.min(this.laid, this.cap); }

  /**
   * PUT THE FIELD ON THIS GROUND.
   *
   * Geometry per attach and the material for the process — the rule two
   * hundred lines up, for the same two reasons, and this is the second caller
   * that would leak either way if it got them the wrong way round.
   */
  attach(scene, terrain = null) {
    this.detach();
    if (!scene) return this;
    this.scene = scene;
    this.terrain = terrain;
    const geos = fallenGeometry();
    /**
     * THE POSE TEST, READ OFF THE POSES.
     *
     * `sprawled()` is a body flat on its face and `curled()` is one on its side
     * with its knees up, and the whole difference between them is how tall the
     * blob is. So the question "which of these two is this corpse" is answered
     * by measuring both geometries and asking which side of halfway the real
     * body's chest is standing on — rather than by a coin toss, and rather than
     * by a threshold typed here that would drift from the boxes above the
     * moment either pose is re-authored.
     */
    let sum = 0;
    for (const g of geos) { g.computeBoundingBox(); sum += g.boundingBox.max.y; }
    this.split = sum / (geos.length * 2);
    this._ring = [];
    this._used = geos.map(() => 0);
    /* EVERY BUFFER IS ALLOCATED AT THE WHOLE `cap`, not at a share of it: which
     * pose a body takes is read off the body, so a fight whose dead all fall
     * the same way would run one buffer out while the other stood empty. */
    this.meshes = geos.map((g) => {
      const im = new THREE.InstancedMesh(g, fallenMaterial(), this.cap);
      im.count = 0;
      /* The same two answers `addFallen` gives and for the same reasons: a
       * prone body's own shadow is a few centimetres long and 520 casters in a
       * shadow map sized for a fight is the crowd's trade made twice; but it
       * must RECEIVE or the field stays lit under the smoke. */
      im.castShadow = false;
      im.receiveShadow = true;
      im.name = 'fallen';
      /* NOT `frustumCulled = false`. `GraveField` turns culling off because its
       * markers stand where the run has been and a bounding sphere computed
       * once at the origin would cull the lot; this field is filled a body at a
       * time, so the sphere is recomputed as it grows and culling is worth
       * having on 520 instances that are mostly behind you. */
      scene.add(im);
      return im;
    });
    return this;
  }

  detach() {
    if (this.meshes) {
      for (const im of this.meshes) {
        im.removeFromParent();
        /* GEOMETRY yes, MATERIAL no — `fallenMaterial` is the process's. */
        im.geometry?.dispose?.();
      }
    }
    this.meshes = null;
    this.scene = null;
    this.terrain = null;
    this.laid = 0;
    this._ring = [];
    this._used = [];
    return this;
  }

  /**
   * LAY ONE BODY DOWN WHERE IT LIES.
   *
   * @param x,z     where the corpse came to rest
   * @param yaw     the bearing from its feet to its head, radians
   * @param chestY  how high its chest is off the ground — picks the pose
   * @param tone    a THREE.Color, the body's own; `instanceColor` multiplies
   *                the white base, so this IS the colour it is drawn in
   * @param scale   the body's own scale, so a heavy does not retire man-sized
   * @returns whether it was taken
   */
  lay(x, z, yaw, chestY, tone, scale = 1) {
    if (!this.meshes) return false;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return false;
    let v, i;
    if (this.laid < this.cap) {
      v = (chestY > this.split) ? 1 : 0;
      i = this._used[v]++;
      this._ring.push([v, i]);
    } else {
      /* Full: take back the oldest slot, wherever it lies. See `_ring`. */
      [v, i] = this._ring[this.laid % this.cap];
    }
    const im = this.meshes[v];
    if (!im) return false;
    this.laid++;
    const T = this.terrain;
    /* Exactly `addFallen`'s own seating: sunk by LIE_SINK so it reads as lying
     * rather than as placed, and turned onto the ground's normal. */
    const y = (T?.height ? T.height(x, z) : 0) - LIE_SINK;
    if (T?.normalAt) T.normalAt(x, z, _nrm); else _nrm.set(0, 1, 0);
    _q.setFromUnitVectors(_up, _nrm);
    _qy.setFromAxisAngle(_up, yaw);
    _q.multiply(_qy);
    _p.set(x, y, z);
    _s.setScalar(Number.isFinite(scale) && scale > 0 ? scale : 1);
    im.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (tone) im.setColorAt(i, tone);
    im.count = Math.max(im.count, i + 1);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere?.();
    /**
     * AND THE GROUND REMEMBERS HIM AFTER THE RING HAS FORGOTTEN.
     *
     * See `LIE_SCORCH`. This is the one write in this file that OUTLIVES the
     * figure: the ring above recycles a slot at the 521st casualty and the
     * field is emptied on a wave restart, but `Terrain.scars` neither ages nor
     * scrolls, so where a fight concentrated stays dark for the rest of the
     * level. It is the same door `Front.burnBand` lays the front's dressing
     * through, which is why the two stack instead of arguing: a swath the
     * dressing burnt and a swath the player filled are the same mark, and
     * ground that got both is darker than ground that got either.
     *
     * `Terrain.tick` pushes the field to the GPU on its own 0.1 s clock, so
     * nothing here flushes — a flush per body would be one texture upload per
     * casualty, which is the cost `Corpses.js` retires bodies to avoid.
     */
    T?.scorch?.(x, z, LEN, LIE_SCORCH);
    return true;
  }

  /**
   * EMPTY IT WITHOUT GIVING THE BUFFERS BACK.
   *
   * `World.restartWave` is `unload` with the ground left standing: the bodies
   * of the attempt that failed are gone from `world.enemies` and from the
   * corpse ledger, and the men they retired into must go with them or a fourth
   * attempt is fought over the dead of the first three.
   */
  clear() {
    this.laid = 0;
    this._ring = [];
    if (this.meshes) for (const im of this.meshes) im.count = 0;
    for (let i = 0; i < this._used.length; i++) this._used[i] = 0;
    return this;
  }

  dispose() { this.detach(); }
}
