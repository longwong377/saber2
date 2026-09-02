/**
 * BATTLEFRONT BORZ — vehicles and mechs.
 *
 * Four machines, built from primitives like everything else in this game, and
 * registered onto `ARCHETYPES` from here rather than by editing Enemy.js — the
 * same seam `src/game/Levels.js` uses for the IG bodyguard and the command
 * units. Nothing in Enemy.js knows these exist; it only knows how to build,
 * pose, cut and kill whatever a `build` function hands back.
 *
 * ── WHAT THE PLATES ACTUALLY SAY ──────────────────────────────────────────
 *
 * `assets/reference/vehicles/` holds 23 images (22 distinct — two of the dwarf
 * spider plates are byte-identical), 2–3 per subject, and they were read as
 * SETS. A single plate of any of these gets you a wrong machine: the AAT's
 * front three-quarter movie still hides the fact that it has no wheels and no
 * tracks at all, and the hailfire's studio render hides that its body hangs
 * BELOW the axle line rather than on it. What follows is what survives across
 * every plate of each subject, which is the only part worth building.
 *
 *   AT-TE          six legs on large circular hip discs; a long, low, segmented
 *                  wedge hull with a tall boxy command cab at the FRONT and a
 *                  bulkier rear; a dorsal mass-driver on a ring turret behind a
 *                  triangular shield plate; four thin anti-personnel barrels in
 *                  spherical housings at the front and two more aft; broad
 *                  truncated-cone foot pads with claws. Bone plate, maroon
 *                  markings. The Geonosis plate is the scale: hull top at five
 *                  to six clone-troopers.
 *   AAT            REPULSORLIFT. No wheels, no tracks, no legs — a flat-bottomed
 *                  skirt with three oval intakes a side, and the hull hovers on
 *                  it. Strongly raked boat prow rising to a rear turret box with
 *                  a domed commander's cupola and a whip antenna. One long
 *                  stepped main barrel, two thin flanking barrels, three shell
 *                  tubes a side on the prow shoulders. Smooth uniform tan — the
 *                  one clean machine in this set.
 *   HAILFIRE       two enormous thin treaded hoops, much taller than the body,
 *                  with the pod slung low BETWEEN them on axle arms and a big
 *                  teardrop suspension plate inside each hoop's lower half. Two
 *                  banks of ~15 conical-tipped missile tubes raked up and back.
 *                  Weathered bronze.
 *   DWARF SPIDER   low and wide. A hemispherical domed head — two big round red
 *                  photoreceptors plus three small ones in a row — with a single
 *                  barrel on a trunnion under them, a whip antenna off the
 *                  crown, and four splayed legs whose thighs are flat angular
 *                  PLATES rather than tubes, ending in flat clawed pads.
 *
 * The homing spider droid's two plates were read as well and deliberately
 * produced nothing: the game already has it as the `walker` archetype, and a
 * second sphere on four tall legs is the exact defect the constraint below
 * exists to prevent.
 *
 * ── THE CONSTRAINT THAT SHAPED EVERY NUMBER IN THIS FILE ───────────────────
 *
 * Player notes 9 and 26: the big things in this game are all "a sphere with
 * some legs" and "they all attack the same way". `walker` IS a sphere on legs.
 * So these four are held to a property rather than to a taste, and
 * `tools/checks/vehicles.mjs` is where the property lives:
 *
 *   NO TWO OF THEM MAY SHARE A SILHOUETTE OR A CADENCE.
 *
 * As built and measured (`tools/_vehicle.mjs`), whole box then hull alone:
 *
 *                 legs   w × h × l (m)      hull L/H  clearance  volley  cycle
 *   Dwarf spider    4    3.9 × 3.1 ×  2.8     1.16      1.00 m      34   1.18 s
 *   AT-TE           6    7.9 × 5.7 × 13.5     4.14      2.34 m      58   5.90 s
 *   AAT             0    6.2 × 3.4 ×  8.6     4.45      0.65 m     104   3.88 s
 *   Hailfire        0    5.9 × 5.7 ×  5.7     1.20      1.89 m      77   4.69 s
 *
 * The hailfire's box is nearly cubical and that is not a failure of the rule —
 * a five-metre hoop is as long as it is tall. What separates it is that almost
 * none of that box is HULL: 1.1 × 1.1 × 1.3 of pod inside 5.9 × 5.7 × 5.7 of
 * wheel, where the AAT is 6.1 × 1.9 × 8.3 of hull inside 6.2 × 3.4 × 8.6. Their
 * flank outlines overlap by 0.22, against the 0.5 that `tools/_creature.mjs`
 * records for two things that share a body plan.
 *
 * Leg count, box aspect, ground clearance and shot cadence all differ, and they
 * differ AT LOD 1 — past thirty metres `Enemy._applyLod` hides every mesh that
 * is not a bone's primary or tagged `userData.silhouette`, which is precisely
 * how the old menagerie became five identical trunks with legs. Everything that
 * makes one of these recognisable at sixty metres is one or the other; measured,
 * every machine keeps at least 95% of every dimension through the cull.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * It does not give a vehicle a bigger collider than the game gives any heavy.
 * `Enemy` builds one movement proxy per body — `capsule(0.9, 1.1)` for anything
 * flagged `big` — and that number is in Enemy.js, which this workstream does
 * not own. Measured as a fraction of hull length, a player meets 100% of a dwarf
 * spider, 27% of an AAT and **0% of an AT-TE**: you walk under its belly, which
 * is correct, and through its prow and its stern, which is not.
 *
 * Every builder therefore publishes `built.proxy` — a sphere chain GENERATED off
 * the hull it just built, so it cannot drift from the geometry — and the gap is
 * MEASURED rather than claimed: `vehicles.mjs` prints what the shipped proxy
 * covers beside what the published one would (95/100/100/100%), every run. See
 * `hullProxy` for the three lines in Enemy.js that would close it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { Rig } from './Rig.js';
import { ARCHETYPES } from './Enemy.js';
import { TOUGHNESS } from './Combat.js';
import { BOLT_COLORS } from './Bolts.js';
import { plateGeo, bandGeo, limbGeo, platedSpan, weakSpot } from './Bodies.js';
import { armorMaps, metalMaps, MEAN_ALBEDO } from '../engine/Textures.js';
import { makeRng, lerp, clamp, TAU } from '../engine/MathUtil.js';

const rng = makeRng(70714);
/**
 * ── PUT THIS FILE'S STREAM BACK ─────────────────────────────────────────
 *
 * A module-level stream that no harness can reseed makes every check after it
 * depend on how many draws the checks before it happened to take. `verify.mjs`
 * runs every suite in one process and says so in its own note; five streams
 * were already restorable and this one was not.
 *
 * MEASURED, and it is not theoretical: building ONE crate before
 * `blast-door.mjs` — a single `makeCrate` on a throwaway scene, which touches
 * nothing but this stream — turned that suite from 9/9 into the gate's own
 * failure, "75 s of held blade burned 0 of the 515 texels". The breach slug's
 * launch vector comes off here, so a shifted phase throws the debris somewhere
 * else, the player takes the second impact instead of surviving it on five
 * points, and a dead player's blade never touches the plate again.
 *
 * The seed is the module's own, so `restoreShared` puts it back where the
 * module started rather than where a snapshot found it — the same statement
 * the other five make.
 */
export function seedVehicles(seed) { rng.seed(seed >>> 0); return rng; }


/* ══════════════════════════════════════════════════════════════════════ */
/*  Materials                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The same two-line bookkeeping Bodies.js does, and for the same reason.
 *
 * `MeshStandardMaterial` multiplies `color` by `map`, so the number typed here
 * is never the colour rendered — it is that colour times the bake's own mean
 * albedo. `lit` divides the bake back out for the families whose map is a
 * carrier (metal); `note` records without correcting for the families whose map
 * IS the paint (armour), because every tint below was picked looking at the
 * result. Both record `authored` and `mapMean` on the material so
 * tools/checks/materials.mjs can pin what a bake drifting under them would do.
 *
 * These are copies of two private helpers in Bodies.js rather than an import,
 * because they are private. Two identical four-line functions is a smell; it is
 * a much smaller one than a plate colour authored against a mean nobody
 * recorded, which is the failure the helpers exist to prevent.
 */
function lit(color, mean, mat) {
  const want = new THREE.Color(color);
  mat.color.setRGB(
    Math.min(1, want.r / mean[0]), Math.min(1, want.g / mean[1]), Math.min(1, want.b / mean[2]));
  mat.userData.authored = [want.r, want.g, want.b];
  mat.userData.mapMean = mean;
  return mat;
}
function note(color, mean, mat) {
  const c = new THREE.Color(color);
  mat.color.copy(c);
  mat.userData.authored = [c.r, c.g, c.b];
  mat.userData.mapMean = mean;
  return mat;
}

/** Painted plate. `repeat` is the scuff tiling — machinery wants it fine. */
function armorMat(color, metal = 0.1, rough = 0.5, repeat = 1.6) {
  const maps = armorMaps(repeat);
  return note(color, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: metal,
  }));
}
/** Machined metal: joints, barrels, frame members, tyre tread. */
function metalMat(color, rough = 0.42, metal = 0.92, repeat = 2.4) {
  const maps = metalMaps(repeat);
  return lit(color, MEAN_ALBEDO.metal, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: metal,
  }));
}
/** Viewports and photoreceptor lenses. */
function glassMat(color, rough = 0.16) {
  const maps = metalMaps(3.4);
  return lit(color, MEAN_ALBEDO.metal, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.6,
  }));
}
function emissiveMat(color, intensity = 3) {
  return new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2,
  });
}
/** Cauterised carbon over paint — a machine this old has been shot at. */
function scorchMat() {
  const maps = armorMaps(6.0);
  return note(0x14120f, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: 0.94, metalness: 0.04,
  }));
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Assembly — one merged mesh per material per bone                      */
/* ══════════════════════════════════════════════════════════════════════ */

const _kP = new THREE.Vector3(), _kQ = new THREE.Quaternion();
const _kE = new THREE.Euler(), _kS = new THREE.Vector3();
const _kM = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _kv = new THREE.Vector3();

/**
 * Concatenate a pile of transformed geometries into one.
 *
 * A vehicle is two hundred pieces of greeble and it has to be a handful of draw
 * calls, because `heavyLimit` will put three of them on the field at once. This
 * is a smaller sibling of `mergeGeos` in Bodies.js — position, normal, uv and
 * index only, no vertex-colour channel, because nothing here is AO-shaded.
 *
 * It reads each source geometry and then disposes it, so a geometry handed in
 * twice must be handed in as two `add` calls of the same object, which is what
 * the callers below do (they build a geometry per use).
 */
function concat(parts) {
  let vTotal = 0, iTotal = 0;
  for (const p of parts) {
    vTotal += p.geo.attributes.position.count;
    iTotal += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const uvs = new Float32Array(vTotal * 2);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geo;
    _nm.getNormalMatrix(p.matrix);
    const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
    for (let i = 0; i < gp.count; i++) {
      _kv.fromBufferAttribute(gp, i).applyMatrix4(p.matrix);
      pos[(vo + i) * 3] = _kv.x; pos[(vo + i) * 3 + 1] = _kv.y; pos[(vo + i) * 3 + 2] = _kv.z;
      if (gn) {
        _kv.fromBufferAttribute(gn, i).applyMatrix3(_nm);
        if (_kv.lengthSq() > 1e-12) _kv.normalize(); else _kv.set(0, 1, 0);
        nrm[(vo + i) * 3] = _kv.x; nrm[(vo + i) * 3 + 1] = _kv.y; nrm[(vo + i) * 3 + 2] = _kv.z;
      }
      if (gu) { uvs[(vo + i) * 2] = gu.getX(i); uvs[(vo + i) * 2 + 1] = gu.getY(i); }
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < gp.count; i++) idx[io + i] = vo + i; io += gp.count; }
    vo += gp.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** A per-material accumulator. `bake` hangs one merged mesh per material. */
class Kit {
  constructor() { this.buckets = new Map(); }

  add(mat, geo, pos, rot, scale) {
    _kP.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
    _kE.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    _kQ.setFromEuler(_kE);
    if (scale == null) _kS.set(1, 1, 1);
    else if (Array.isArray(scale)) _kS.set(scale[0], scale[1], scale[2]);
    else _kS.set(scale, scale, scale);
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, arr = []);
    arr.push({ geo, matrix: new THREE.Matrix4().compose(_kP, _kQ, _kS) });
    return this;
  }

  /** The same part on both sides. Authored per side, never mirrored by scale —
   *  a negative scale inverts the winding of every triangle in the merge. */
  pair(fn) { fn(1); fn(-1); return this; }

  /** n copies laid out by fn(i, t) with t running 0→1. */
  row(n, fn) { for (let i = 0; i < n; i++) fn(i, n === 1 ? 0.5 : i / (n - 1)); return this; }

  /** Take one bucket away as a single geometry. */
  merge(mat) {
    const parts = this.buckets.get(mat);
    this.buckets.delete(mat);
    return concat(parts || []);
  }

  /** Merge every bucket and hang the results on `parent`. */
  bake(parent, opts = {}) {
    const out = [];
    for (const [mat, parts] of this.buckets) {
      const m = new THREE.Mesh(concat(parts), mat);
      m.castShadow = true; m.receiveShadow = true;
      if (opts.silhouette) m.userData.silhouette = true;
      parent.add(m);
      out.push(m);
    }
    this.buckets.clear();
    return out;
  }
}

/** Merge a single-material part list — [geo, pos, rot, scale] tuples. */
const ONE = Symbol('assembly');
function assemble(list) {
  const k = new Kit();
  for (const t of list) k.add(ONE, t[0], t[1], t[2], t[3]);
  return k.merge(ONE);
}

function mesh(geo, mat, parent, pos, rot, scale) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) Array.isArray(scale) ? m.scale.set(scale[0], scale[1], scale[2]) : m.scale.setScalar(scale);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Give a bone its silhouette mesh and the radius the blade solver tests. */
function primary(bone, geo, mat, radius) {
  const m = mesh(geo, mat, bone.obj);
  bone.parts.push(m); bone.primary = m;
  bone.radius = radius;
  return m;
}

/**
 * The chassis frame on the `hips` bone.
 *
 * `hips` carries no geometry on any body Bodies.js builds, and for a humanoid
 * that is right — the pelvis is inside the abdomen. On a vehicle it costs two
 * things that matter. `Enemy.capsules()` skips a bone with no parts, so the
 * blade cannot touch the centre of the machine; and `Actor.goRagdoll` skips it
 * too, so every joint anchored to it is dropped and a destroyed vehicle
 * explodes into unconnected pieces instead of collapsing as a wreck.
 *
 * So every chassis here has a spine: a long shallow box down the centreline,
 * mostly buried inside the hull that hangs off it, which is what a vehicle's
 * frame actually is.
 */
function chassis(rig, mat, w, h, l, S) {
  const b = rig.get('hips');
  primary(b, plateGeo(w * S, h * S, l * S, h * S * 0.25, 1), mat, Math.max(w, h) * 0.5 * S);
  b.primary.position.y = b.length * 0.5;
  return b;
}

/* ── shared small geometry ───────────────────────────────────────────── */

/** A vent grille: n slots recessed into a plate. */
function ventGeo(w, h, d, n = 4) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    parts.push([plateGeo(w * 0.82, h / (n * 2.1), d, d * 0.3, 1), [0, lerp(-h * 0.4, h * 0.4, t), 0]]);
  }
  return assemble(parts);
}

/**
 * A truncated-cone foot pad with a flat base and claws — the AT-TE's foot, and
 * the single most recognisable thing about its legs after the count.
 */
function padGeo(r, h, claws = 4) {
  const parts = [
    [new THREE.CylinderGeometry(r * 0.52, r, h, 12), [0, h * 0.5, 0]],
    [new THREE.CylinderGeometry(r * 1.14, r * 1.14, h * 0.22, 12), [0, h * 0.11, 0]],
  ];
  for (let i = 0; i < claws; i++) {
    const a = (i / claws) * TAU + Math.PI / claws;
    parts.push([plateGeo(r * 0.34, h * 0.16, r * 0.72, r * 0.05, 1),
      [Math.sin(a) * r * 1.12, h * 0.08, Math.cos(a) * r * 1.12], [0, a, 0]]);
  }
  return assemble(parts);
}

/**
 * A flat angular limb plate — the dwarf spider's thigh, which is a PLATE and
 * not a tube, and is half of why it does not read as the homing spider droid.
 * Spans y ∈ [0, len], tapering in width, with a chamfered leading edge.
 */
function bladePlateGeo(len, w0, w1, thick) {
  return assemble([
    [plateGeo(thick, len, w0, thick * 0.4, 1), [0, len * 0.5, 0], null, [1, 1, 1]],
    [plateGeo(thick * 1.5, len * 0.42, w0 * 1.22, thick * 0.5, 1), [0, len * 0.24, w0 * 0.06]],
    [plateGeo(thick * 1.2, len * 0.34, w1 * 1.1, thick * 0.4, 1), [0, len * 0.82, -w1 * 0.04]],
  ]);
}

/**
 * LOFT A SLAB — rescale a rounded plate along one of its own axes so it is a
 * different shape at one end than at the other.
 *
 * THIS IS THE ANSWER TO "IT LOOKS LIKE PLANKS OF WOOD", second half. The first
 * half was the texture tiling; this is the geometry. `plateGeo` is the only
 * shape most of this file is built from and it makes exactly one thing: a box
 * with rounded corners, constant section end to end. Thirty-nine boxes with
 * constant section are still boxes — a wing with the same chord and the same
 * thickness at the tip as at the root IS a plank, in the strict sense, and no
 * amount of panel line on it will say otherwise. What a wing has instead is
 * taper, and taper is a lofted section, which is one loop over the vertices.
 *
 * `axis` is the axis to run along, `dir` says which end is t = 1 (so a paired
 * part can taper outboard on both sides without mirroring geometry), and
 * `f(t)` returns the scale of the OTHER two axes at that station plus any
 * offset — `{ a, b, da, db }`, where a/b are the two axes in x,y,z order
 * skipping `axis`.
 *
 * THE SLAB HAS TO BE SEGMENTED ALONG `axis` or this does nothing visible. A
 * `plateGeo(w, h, d, r, 1)` has vertices only at its two ends, so every one of
 * them lands at t = 0 or t = 1 and the whole plate is scaled uniformly by one
 * of the two — measured on the first wing, which came out simply smaller. Pass
 * seg 3 or more.
 */
function loftGeo(g, len, axis, dir, f) {
  const p = g.attributes.position;
  const at = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const v = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v[0] = p.getX(i); v[1] = p.getY(i); v[2] = p.getZ(i);
    const t = clamp((dir * v[at]) / len + 0.5, 0, 1);
    const s = f(t);
    const [ia, ib] = at === 0 ? [1, 2] : at === 1 ? [0, 2] : [0, 1];
    v[ia] = v[ia] * (s.a ?? 1) + (s.da ?? 0);
    v[ib] = v[ib] * (s.b ?? 1) + (s.db ?? 0);
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A WING, and not a board bolted to a box.
 *
 * `span` across, `chord` fore-and-aft at the root and `thick` at the root,
 * tapering to `tip` of the chord and `tipThick` of the thickness by the tip,
 * with the TRAILING edge held straight — which is what makes the leading edge
 * sweep, and a swept leading edge is most of what the eye reads as a wing.
 * `dir` is +1 or -1 for which way is outboard, so `Kit.pair` can author both
 * sides without mirroring a winding.
 *
 * Returns the plate; `wingEdge` below returns the line its leading edge now
 * runs along, because a leading-edge strip laid straight across a tapered wing
 * hangs off the front of it at the tip.
 */
function wingGeo(span, chord, thick, dir, { tip = 0.46, tipThick = 0.42, seg = 5 } = {}) {
  const k = 1 - tip;
  return loftGeo(plateGeo(span, thick, chord, thick * 0.42, seg), span, 'x', dir,
    (t) => ({ a: 1 + (tipThick - 1) * t, b: 1 - k * t, db: (chord / 2) * k * t }));
}

/** How far aft the leading edge of such a wing has moved by the tip. */
function wingSweep(chord, tip = 0.46) { return chord * (1 - tip); }

/* ══════════════════════════════════════════════════════════════════════ */
/*  Skeletons                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A chassis skeleton: a spine of hull segments plus n legs.
 *
 * The bone NAMES matter and are not free. `_poseWalker` solves `femur{i}` →
 * `tibia{i}` and aims `tarsus{i}`; `Enemy._boneToughness` plates `body` and
 * `hips` to durasteel for `custom: 'walker'`; `Ragdoll`'s joint table is keyed
 * on the prefixes. Everything else here — `prow`, `stern`, `wheelL`, `wheelR` —
 * is new, falls through to the default joint limits, and exists for one reason:
 * `Enemy.capsules()` emits ONE capsule per bone that has geometry on it, so a
 * twelve-metre hull carried on a single `body` bone is a twelve-metre hull the
 * blade can only touch in the middle. A hull segment is a bone.
 *
 * ── EVERY BONE HERE POINTS UP, AND THAT IS NOT LAZINESS ──────────────────
 *
 * The obvious way to write a fore-and-aft hull segment is `rest: [0, 0, 1]` —
 * a bone that points forward, whose capsule then runs the length of the piece.
 * It is wrong, and it fails SILENTLY. `Rig` builds each bone's rest frame with
 * `aimY(restDir, BACK)`, and `aimY` treats a reference within about ten degrees
 * of the direction as degenerate and swaps in a different one. `BACK` is
 * (0,0,−1). So a bone pointing along ±Z takes the fallback branch, comes out
 * rolled ninety degrees, and every piece of geometry authored "forward in z"
 * on it is built STRAIGHT UP instead.
 *
 * Measured before it was found: the AT-TE's prow — cab, four barrels, sensor
 * spheres — was standing vertically on top of the hull, and the machine read
 * 7.1 m tall against a hull 9 m long. It threw no error and nothing but a
 * bounding box could see it.
 *
 * So a hull segment is a SHORT, FAT, UPRIGHT bone placed by its offset, and its
 * capsule is a blob rather than a tube. Three overlapping blobs down the
 * centreline cover a twelve-metre hull perfectly well — `vehicles.mjs` measures
 * that coverage — and every piece of geometry on every one of them is authored
 * in the identity frame, where +Z is forward and stays forward.
 */
function chassisSkeleton(S, P) {
  const out = [
    { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.34 * S, rest: [0, 1, 0], role: 'core' },
    { name: 'body', parent: 'hips', offset: [0, P.body[0] * S, P.body[1] * S], length: P.body[2] * S, rest: [0, 1, 0], role: 'core' },
  ];
  /* `hull` AND NOT `core`, WHICH IS THE ONE INTERESTING ROLE ON A MACHINE.
   * A core cut is fatal wherever it lands, because it is the body. A hull
   * segment is not the body: an AT-TE with its prow off has lost the command
   * cab and is still nine metres of walker. So the hull shares one body's worth
   * of lethality between however many segments there are — half each here —
   * which makes taking BOTH ends off a kill and taking one off a wound, and
   * that is the shape a three-segment hull was built for in the first place. */
  if (P.prow) {
    out.push({ name: 'prow', parent: 'hips', offset: [0, P.prow[0] * S, P.prow[1] * S], length: P.prow[2] * S, rest: [0, 1, 0], role: 'hull' });
  }
  if (P.stern) {
    out.push({ name: 'stern', parent: 'hips', offset: [0, P.stern[0] * S, P.stern[1] * S], length: P.stern[2] * S, rest: [0, 1, 0], role: 'hull' });
  }
  out.push({ name: 'head', parent: 'body', offset: [0, P.head[0] * S, P.head[1] * S], length: P.head[2] * S, rest: P.head[3] || [0, 1, 0], role: 'head' });
  /**
   * ── A LEG THAT IS NOT ONE OF A PAIR IN A ROW ──────────────────────────
   *
   * Everything above lays legs out as `side = i % 2 ? -1 : 1` over rows of two,
   * which is every machine in this file up to the giants and is wrong for two
   * of the five that came after. A TRIPOD has no pairs and no rows: the
   * Octuptarra magna tri-droid's three legs are 120° apart around a hub, and
   * forcing them through the row arithmetic gives two legs on one axis and a
   * third one somewhere with no partner — a body plan that cannot stand.
   *
   * `legPlan` is the escape hatch and it is deliberately RAW: an array of
   * `{ x, z, rest }` in units of scale, one per leg, replacing the pair layout
   * and nothing else. The chain below it — femur → tibia → tarsus, the naming
   * `_poseWalker` solves on, the `leg` role `severanceOf` and `toppleAt` price
   * off — is identical either way, which is the point. A machine that lays its
   * hips out differently is still a machine this file's one pose path can walk.
   *
   * `stance.limbs` has to agree with it and is authored beside it in the
   * builder rather than derived here, for `chassisStance`'s own reason: where a
   * foot PLANTS is a fact about the gait and not about where the hip is.
   */
  const plan = P.legPlan || null;
  const nLegs = plan ? plan.length : (P.legs || 0);
  for (let i = 0; i < nLegs; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const z = plan ? plan[i].z * S : P.rows[row] * S;
    if (plan) {
      const L = plan[i];
      out.push({ name: `femur${i}`, parent: 'hips', offset: [L.x * S, (P.hipY ?? 0) * S, z], length: P.femur * S, rest: L.rest, role: 'leg' });
      out.push({ name: `tibia${i}`, parent: `femur${i}`, offset: [0, P.femur * S, 0], length: P.tibia * S, rest: [L.rest[0] * 0.14, -1, L.rest[2] * 0.14], role: 'leg' });
      out.push({ name: `tarsus${i}`, parent: `tibia${i}`, offset: [0, P.tibia * S, 0], length: P.tarsus * S, rest: [0, -0.45, 0.55], role: 'leg' });
      continue;
    }
    out.push({ name: `femur${i}`, parent: 'hips', offset: [side * P.hipX * S, P.hipY * S, z], length: P.femur * S, rest: [side * P.splay, P.rise, 0], role: 'leg' });
    out.push({ name: `tibia${i}`, parent: `femur${i}`, offset: [0, P.femur * S, 0], length: P.tibia * S, rest: [side * 0.12, -1, 0], role: 'leg' });
    out.push({ name: `tarsus${i}`, parent: `tibia${i}`, offset: [0, P.tibia * S, 0], length: P.tarsus * S, rest: [0, -0.45, 0.55], role: 'leg' });
  }
  for (const w of (P.wheels || [])) {
    /* A WHEEL IS A LEG. It carries the machine's weight, there are two of them,
     * and `severanceOf` divides a leg's worth by however many the body has — so
     * a hailfire's hoop is priced the way a biped's thigh is and not the way one
     * of an AT-TE's six is. Nothing else about the role fits: it is not a hull
     * segment and it is certainly not an arm. */
    out.push({ name: w.name, parent: 'hips', offset: [w.x * S, w.y * S, w.z * S], length: w.len * S, rest: [w.dir, 0.06, 0], role: 'leg' });
    /* The lower half of the hoop, as a bone that hangs from the hub down to the
     * ground. It exists because that is the part of a five-metre wheel a player
     * standing next to it can actually put a blade through, and `capsules()`
     * only offers the blade bones that carry geometry. */
    if (w.rim) out.push({ name: w.name.replace('wheel', 'rim'), parent: w.name, offset: [0, w.len * S, 0], length: w.rim * S, rest: [0, -1, 0], role: 'leg' });
  }
  /**
   * ── AND SOMETHING THAT CARRIES NOTHING, WHICH IS NOT A LEG ────────────
   *
   * The note over `wheels` says a wheel is a leg because it carries the
   * machine's weight. The converse has a body too: the NR-N99's outrigger
   * pylons hang off the flanks of a tank that runs on ONE central tread, and
   * they stabilise it rather than drive it. Priced as legs they would make a
   * snail tank a tripod — cut a pontoon and the machine falls over, which is
   * exactly backwards, because the whole design of the thing is that the tread
   * is the single point of failure and the outriggers are there to stop it
   * tipping while the tread does the work.
   *
   * `struts` are `hull`, and that one word is what makes `toppleAt` count the
   * tread alone: one chain, so the clamp asks for one, so severing the tread
   * beaches the tank and severing a pontoon does not.
   */
  for (const s of (P.struts || [])) {
    out.push({ name: s.name, parent: s.parent || 'hips', offset: [s.x * S, s.y * S, s.z * S], length: s.len * S, rest: s.rest, role: s.role || 'hull' });
  }
  return out;
}

/**
 * The stance a chassis stands in, in the shape `Enemy._stance()` reads.
 *
 * Published on the built object so nothing in Enemy.js has to know one machine
 * from another — which is the mechanism that stopped five creatures sharing one
 * skeleton, and is the same mechanism that keeps an AAT (no legs at all) and an
 * AT-TE (six) going through one pose function.
 */
function chassisStance(S, P) {
  const limbs = [];
  /* `plantPlan` is `legPlan`'s other half — see the note over it. Where a foot
   * plants is a fact about the GAIT rather than about where the hip is, so a
   * tripod says both, in the same two places every rowed machine says them. */
  if (P.plantPlan) {
    for (const L of P.plantPlan) {
      limbs.push({
        arm: false, x: L.x * S, z: L.z * S,
        ankle: P.ankle * S, toe: P.toe,
        pole: [L.pole[0] * S, L.pole[1] * S, L.pole[2] * S], hand: null,
      });
    }
    return {
      hipHeight: P.hipHeight * S, step: P.step * S, lift: P.lift * S,
      rear: P.rear * S, bob: P.bob * S, limbs,
    };
  }
  for (let i = 0; i < (P.legs || 0); i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    limbs.push({
      arm: false, x: side * P.plantX * S, z: P.plantZ[row] * S,
      ankle: P.ankle * S, toe: P.toe,
      pole: [side * P.poleX * S, P.poleY * S, P.poleZ * S], hand: null,
    });
  }
  return {
    hipHeight: P.hipHeight * S, step: P.step * S, lift: P.lift * S,
    rear: P.rear * S, bob: P.bob * S, limbs,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The collider a machine this size actually wants                       */
/* ══════════════════════════════════════════════════════════════════════ */

const _pb = new THREE.Box3(), _pc = new THREE.Vector3(), _ps = new THREE.Vector3();

/**
 * A sphere cluster covering the hull, DERIVED from the hull that was built.
 *
 * `Enemy` gives every body one movement proxy and sizes it from a single flag:
 * `capsule(0.9, 1.1)` if the archetype says `big`, `capsule(0.55, 0.36)` if it
 * does not. That is the right shape for a droideka and the wrong shape for a
 * thirteen-metre walker — measured, a player meets an AT-TE's hull across 0% of
 * its length, because the proxy is a 2.2 m column at its centre and the hull
 * starts 2.3 m off the ground and runs 6.4 m fore and aft of that column.
 *
 * Enemy.js is not this workstream's to edit, so this cannot fix it. What it can
 * do is make the fix a THREE-LINE change with the data already correct and
 * already checked, instead of a modelling job somebody has to redo:
 *
 *     const P = built.proxy;                                    // Enemy.js ~1296
 *     position: this.position.clone().setY(this.position.y + (P?.y ?? (A.big ? 1.4 : 0.9))),
 *     spheres:  P ? P.spheres : capsuleSpheres(A.big ? 0.9 : 0.55, r, 'y', 3),
 *
 * `Physics.Body` already takes an arbitrary sphere list — `opts.spheres` — and
 * the contact solver already walks it, so nothing else has to change.
 *
 * It is GENERATED off the posed rig rather than typed into the archetype table,
 * which is HANDOFF §2.3: a hand-written collider beside a procedural hull is a
 * table that drifts the first time somebody moves a plate, silently, in the
 * direction of a hull you can walk through.
 */
function hullProxy(rig, hipHeight, names) {
  rig.hipsBone.obj.position.set(0, hipHeight, 0);
  rig.updateMatrices();
  rig.root.updateMatrixWorld(true);
  const spheres = [];
  const box = new THREE.Box3().makeEmpty();
  for (const name of names) {
    const b = rig.get(name);
    if (!b || !b.primary) continue;
    _pb.setFromObject(b.primary);
    box.union(_pb);
    _pb.getCenter(_pc); _pb.getSize(_ps);
    /**
     * A GRID OVER THE SEGMENT'S FOOTPRINT, not a chain down its long axis.
     *
     * The chain was the first version and it left a hole exactly where it
     * mattered. An AT-TE's stern is 4.2 m across and 3.5 m deep, so the long
     * axis is the WIDTH: two spheres went to x = ±1.4 with radius 1.2, and the
     * centreline — the line a player walks up to the back of the machine along
     * — passed between them untouched. Measured coverage of the hull's own
     * length: 75%. A collider with a hole down the middle of it is the defect
     * being fixed, not a smaller version of it.
     *
     * The radius comes off the VERTICAL extent, so a sphere does not bulge
     * below a hull you are supposed to be able to walk under — an AT-TE's belly
     * is 2.34 m up and clones shelter under it in the reference plate — with a
     * floor at a quarter of the narrowest horizontal dimension so a wide flat
     * segment does not need a hundred spheres to cover itself.
     */
    const r = Math.max(0.12, _ps.y * 0.5, Math.min(_ps.x, _ps.z) * 0.25);
    /**
     * ODD COUNTS ONLY, AND THAT IS THE SAME BUG THE NOTE ABOVE IS ABOUT.
     *
     * The grid exists because a chain down the long axis left a hole exactly
     * where a player walks — and a grid of TWO columns does the identical
     * thing. The layout puts column i at `(i/(cols-1) - 0.5) * (extent - r)`,
     * so two columns are placed at the two edges and there is nothing between
     * them; on the NR-N99, 3.57 m of hull came out at cols 2, spheres at
     * x = +/-1.24 with r 1.10, and the centreline passed between them
     * untouched. Measured coverage of its own hull: 0%.
     *
     * An odd count always has a middle one. It costs at most one extra sphere a
     * row on a hull that was going to be two and the contact solver already
     * walks an arbitrary list.
     */
    const odd = (n) => (n % 2 === 0 ? n + 1 : n);
    const cols = clamp(odd(Math.round(_ps.x / (r * 1.4))), 1, 3);
    const rows = clamp(odd(Math.round(_ps.z / (r * 1.4))), 1, 5);
    for (let ix = 0; ix < cols; ix++) {
      for (let iz = 0; iz < rows; iz++) {
        const c = _pc.clone();
        if (cols > 1) c.x += (ix / (cols - 1) - 0.5) * Math.max(0, _ps.x - r);
        if (rows > 1) c.z += (iz / (rows - 1) - 0.5) * Math.max(0, _ps.z - r);
        spheres.push({ c, r });
      }
    }
  }
  if (!spheres.length) return null;
  box.getCenter(_pc);
  const y = _pc.y;
  for (const s of spheres) s.c.y -= y;
  box.getSize(_ps);
  /* The single capsule a caller that cannot take a sphere list would want: as
   * wide as the hull is NARROW, so it is inside the machine rather than a
   * cylinder circumscribing its length. */
  return {
    y, spheres,
    radius: Math.min(_ps.x, _ps.z) * 0.5,
    halfHeight: Math.max(0.2, _ps.y * 0.5 - Math.min(_ps.x, _ps.z) * 0.25),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Wheels that roll because the machine moved                            */
/* ══════════════════════════════════════════════════════════════════════ */

const _wp = new THREE.Vector3();

/**
 * Roll a hoop by ODOMETRY rather than by a clock.
 *
 * The hailfire is the one machine here whose motion is visible in a part rather
 * than in a gait, and nothing in Enemy.js calls back into a built body per
 * frame — there is no hook and this workstream may not add one. So the hoop
 * asks the only question it can answer for itself: how far has my hub moved
 * across the ground since I was last drawn? Distance over radius is the angle,
 * which is what rolling IS, so it is right at any frame rate and right when the
 * machine is standing still (a stationary hailfire's wheels do not turn).
 *
 * `onBeforeRender` fires for the shadow pass as well as the colour pass. That
 * is harmless here and not by luck: the second call in a frame measures a
 * displacement of zero and adds nothing. It also means the roll is one frame
 * behind the hub, which at 2.6 m of wheel nobody can see.
 *
 * There is no direction term. These roll forward; a hailfire reversing would
 * turn its wheels the wrong way, and that is a smaller lie than wheels that do
 * not turn at all.
 */
/**
 * …AND ONE DRIVER MAY TURN A WHOLE TRAIN OF THEM, which is the Juggernaut.
 *
 * `hoop` takes an array as readily as a single object. A ten-wheeled tank
 * cannot afford ten callbacks integrating the same displacement separately —
 * the note below about the tread coming off the tyre is the same failure at
 * five times the scale, and it would show as the near wheels turning while the
 * far ones stood still the moment one of the ten was culled. One reading of the
 * hub, one angle, ten wheels turning through it.
 */
function rollByOdometry(driver, hoop, radius) {
  const spun = Array.isArray(hoop) ? hoop : [hoop];
  let init = false;
  const last = new THREE.Vector3();
  driver.onBeforeRender = function () {
    this.getWorldPosition(_wp);
    const d = Math.hypot(_wp.x - last.x, _wp.z - last.z);
    /* Two guards, and both are about the callback NOT firing. A frustum-culled
     * mesh is never drawn, so it never asks; when it comes back the hub may
     * have crossed half the map and `d` is a jump rather than a roll. And the
     * first call has no previous position at all. Either way the reading is
     * discarded and the wheel picks up from where it is. */
    if (!init || d > 5) { last.copy(_wp); init = true; return; }
    if (d > 1e-5) { for (const h of spun) h.rotation.y += d / radius; last.copy(_wp); }
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  1. Dwarf spider droid — the common Separatist walker                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * LOW AND WIDE, and every number below is in service of that.
 *
 * The homing spider droid already in the game stands at 1.6 of its scale with
 * its feet 1.35 out; this one stands at 0.92 with its feet 1.52 out. That is a
 * stance ratio of 3.3 against 1.7 — it is twice as wide for its height, which
 * is the thing the two plates of it disagree with the homing droid about most.
 * The other half is the THIGH: a flat angular plate, not a tube, so the leg
 * reads as a folded blade even in outline.
 */
export function buildDwarfSpider(opts = {}) {
  const S = opts.scale ?? 1.5;
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.04, 0, 0.46], head: [0.10, 0.34, 0.24],
    legs: 4, rows: [0.44, -0.44], hipX: 0.40, hipY: 0.10,
    femur: 0.72, tibia: 0.86, tarsus: 0.20, splay: 0.92, rise: 0.46,
  }), { scale: S });

  const shell = armorMat(0x767d84, 0.14, 0.56, 2.6);
  const dark = metalMat(0x30343a, 0.5, 0.9, 3.0);
  const rust = armorMat(0x7a4a2c, 0.1, 0.72, 3.4);
  const eye = emissiveMat(0xff2418, 3.4);
  const glass = glassMat(0x191014, 0.14);
  const scorch = scorchMat();

  chassis(rig, dark, 0.44, 0.18, 0.70, S);

  /* ── the dome ──
   * A hemisphere, a heavy equator lip, a shallower machined underside and an
   * underslung drum. The plates show a head that is a smooth cap over an
   * exposed mechanism, so the top is one clean lathe and everything busy hangs
   * below the lip. */
  const body = rig.get('body');
  const dome = assemble([
    [new THREE.SphereGeometry(0.54 * S, 16, 9, 0, TAU, 0, Math.PI * 0.52), [0, 0.10 * S, 0], null, [1, 1.06, 1.02]],
    [bandGeo(0.50 * S, 0.56 * S, 0.50 * S, 0.555 * S, 0.09 * S, 16), [0, 0.02 * S, 0]],
    [new THREE.SphereGeometry(0.50 * S, 16, 6, 0, TAU, Math.PI * 0.52, Math.PI * 0.48), [0, 0.02 * S, 0], null, [1, 0.62, 1]],
  ]);
  primary(body, dome, shell, 0.56 * S);

  const kb = new Kit();
  // the underslung drum and its ventral barrel
  kb.add(dark, new THREE.CylinderGeometry(0.28 * S, 0.24 * S, 0.16 * S, 12), [0, -0.20 * S, 0]);
  kb.add(dark, new THREE.CylinderGeometry(0.07 * S, 0.055 * S, 0.34 * S, 8), [0, -0.30 * S, 0.10 * S], [0.5, 0, 0]);
  // the two big photoreceptors and the three small ones between them
  kb.pair((sx) => {
    kb.add(dark, new THREE.CylinderGeometry(0.16 * S, 0.155 * S, 0.07 * S, 12), [sx * 0.21 * S, 0.20 * S, 0.42 * S], [1.42, 0, 0]);
    kb.add(eye, new THREE.SphereGeometry(0.135 * S, 10, 7), [sx * 0.21 * S, 0.20 * S, 0.44 * S], null, [1, 1, 0.6]);
    // hull fasteners and a rust streak down each cheek
    kb.add(rust, plateGeo(0.05 * S, 0.20 * S, 0.02 * S, 0.005 * S, 1), [sx * 0.40 * S, 0.22 * S, 0.34 * S], [0, sx * 0.5, 0]);
    kb.add(dark, ventGeo(0.20 * S, 0.13 * S, 0.03 * S, 3), [sx * 0.44 * S, -0.02 * S, -0.16 * S], [0, sx * 1.35, 0]);
  });
  kb.row(3, (i, t) => kb.add(eye, new THREE.SphereGeometry(0.036 * S, 7, 5),
    [(t - 0.5) * 0.16 * S, 0.215 * S, 0.505 * S]));
  // the brow ridge over the eyes, and the jaw plate under them
  kb.add(shell, plateGeo(0.72 * S, 0.06 * S, 0.16 * S, 0.02 * S, 1), [0, 0.33 * S, 0.38 * S], [0.42, 0, 0]);
  kb.add(dark, plateGeo(0.60 * S, 0.12 * S, 0.14 * S, 0.03 * S, 1), [0, 0.02 * S, 0.44 * S], [-0.30, 0, 0]);
  kb.add(glass, plateGeo(0.30 * S, 0.05 * S, 0.03 * S, 0.008 * S, 1), [0, 0.02 * S, 0.50 * S], [-0.30, 0, 0]);
  // it has been shot at
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU;
    const w = (0.09 + rng() * 0.13) * S;
    kb.add(scorch, plateGeo(w, 0.006 * S, w * 0.7, 0.002 * S, 1),
      [Math.sin(a) * 0.50 * S, (0.06 + rng() * 0.22) * S, Math.cos(a) * 0.50 * S], [1.1, a, 0]);
  }
  kb.bake(body.obj);
  /* The whip antenna off the crown: thin, tall, and the one vertical line on an
   * otherwise entirely horizontal machine — so it goes in its own bucket and is
   * kept at every range. Merged into the dome's `dark` bucket it would have been
   * culled at thirty metres, and the machine loses a third of its height at
   * exactly the distance the silhouette has to do all the work. */
  new Kit().add(dark, new THREE.CylinderGeometry(0.008 * S, 0.016 * S, 1.05 * S, 5),
    [0, 0.66 * S, -0.08 * S], [0.10, 0, 0]).bake(body.obj, { silhouette: true });

  /* ── the gun ──
   * One barrel on a trunnion under the eyes. It is on the HEAD bone, which
   * `_poseWalker` tracks onto the target, so it elevates and traverses against
   * the dome exactly as the plates show it mounted. */
  const head = rig.get('head');
  const mount = assemble([
    [new THREE.CylinderGeometry(0.115 * S, 0.115 * S, 0.34 * S, 10), [0, 0, 0], [0, 0, 1.5708]],
    [plateGeo(0.26 * S, 0.17 * S, 0.20 * S, 0.04 * S, 1), [0, 0.02 * S, 0.10 * S]],
  ]);
  primary(head, mount, dark, 0.16 * S);
  const kh = new Kit();
  kh.add(dark, new THREE.CylinderGeometry(0.048 * S, 0.062 * S, 0.86 * S, 9), [0, 0.02 * S, 0.50 * S], [1.5708, 0, 0]);
  kh.row(3, (i, t) => kh.add(shell, new THREE.CylinderGeometry(0.075 * S, 0.075 * S, 0.035 * S, 9),
    [0, 0.02 * S, (0.22 + t * 0.42) * S], [1.5708, 0, 0]));
  kh.bake(head.obj, { silhouette: true });
  const muzzle = mesh(new THREE.CylinderGeometry(0.05 * S, 0.042 * S, 0.10 * S, 8), dark, head.obj,
    [0, 0.02 * S, 0.92 * S], [1.5708, 0, 0]);

  /* ── the legs ──
   * Plate thigh, tubular shin, flat clawed pad. The knee joint is a visible
   * hinge because a leg that folds has to look like it folds. */
  for (let i = 0; i < 4; i++) {
    const femur = rig.get(`femur${i}`);
    const tibia = rig.get(`tibia${i}`);
    const tarsus = rig.get(`tarsus${i}`);

    const L = femur.length;
    primary(femur, bladePlateGeo(L, 0.30 * S, 0.17 * S, 0.075 * S), shell, 0.16 * S);
    const kf = new Kit();
    kf.add(dark, new THREE.CylinderGeometry(0.10 * S, 0.10 * S, 0.19 * S, 10), [0, 0, 0], [0, 0, 1.5708]);
    kf.add(dark, new THREE.CylinderGeometry(0.085 * S, 0.085 * S, 0.22 * S, 10), [0, L, 0], [0, 0, 1.5708]);
    kf.add(dark, new THREE.CylinderGeometry(0.028 * S, 0.028 * S, L * 0.62, 6), [0, L * 0.46, -0.11 * S]);
    kf.bake(femur.obj);

    const T = tibia.length;
    const tm = primary(tibia, limbGeo(T, 0.082 * S, 0.048 * S, 8, true, { rings: 4, bulge: 0.10, bulgeAt: 0.24 }), dark, 0.085 * S);
    tm.userData.limb = { r0: 0.082 * S, r1: 0.048 * S, seg: 8 };
    const kt = new Kit();
    kt.add(shell, bladePlateGeo(T * 0.68, 0.17 * S, 0.11 * S, 0.05 * S), [0, T * 0.12, 0.02 * S]);
    kt.add(dark, new THREE.CylinderGeometry(0.055 * S, 0.055 * S, 0.13 * S, 8), [0, T, 0], [0, 0, 1.5708]);
    /* `bladePlateGeo` spans [0, len] in its own frame, so a 0.68T blade seated
     * at 0.12T reaches 0.80T and the ankle is bare. The femur above is one flat
     * blade over the whole bone and correctly has no gap. */
    platedSpan(tibia, T * 0.12, T * 0.80);
    kt.bake(tibia.obj);

    /* A FLAT CLAWED PAD, seated at the tarsus tip and flipped so it stands on
     * the ground rather than under it — see the same note on the AT-TE's foot,
     * and `ankle` in the stance below, which lifts the IK target by however far
     * the tarsus hangs past it. */
    const kp = new Kit();
    const P = tarsus.length;
    primary(tarsus, assemble([[plateGeo(0.30 * S, 0.07 * S, 0.36 * S, 0.03 * S, 1), [0, P, -0.03 * S], [Math.PI, 0, 0]]]), shell, 0.10 * S);
    kp.row(4, (j, t) => kp.add(shell, plateGeo(0.055 * S, 0.045 * S, 0.24 * S, 0.015 * S, 1),
      [(t - 0.5) * 0.24 * S, P - 0.01 * S, -0.20 * S], [0.16, (t - 0.5) * 0.5, 0]));
    kp.add(dark, plateGeo(0.20 * S, 0.05 * S, 0.14 * S, 0.02 * S, 1), [0, P - 0.01 * S, 0.16 * S], [-0.2, 0, 0]);
    kp.bake(tarsus.obj);
  }

  const stance = chassisStance(S, {
      legs: 4, hipHeight: 0.92, step: 0.72, lift: 0.20, rear: 0.26, bob: 0.030,
      plantX: 1.52, plantZ: [0.62, -0.62], ankle: 0.197, toe: 0.16,
      poleX: 1.75, poleY: 1.30, poleZ: 0,
  });
  return {
    rig, muzzles: [muzzle], scale: S, stance,
    palette: { shell, dark, mark: rust, scorch, eye },
    proxy: hullProxy(rig, stance.hipHeight, ['body']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  2. AT-TE — the Republic heavy                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * SIX LEGS AND A HULL FOUR TIMES ITS OWN HEIGHT.
 *
 * The hull is three bones — `prow`, `body`, `stern` — and that is not a
 * modelling convenience. `Enemy.capsules()` gives the blade one capsule per
 * bone, so a hull on one bone is a hull you can only cut in the middle; three
 * segments is three capsules end to end, and severing `prow` takes the command
 * cab and its four barrels off the front with it.
 *
 * The circular hip discs ride on the femur rather than on the chassis, so they
 * turn with the leg. That is what they look like they do in every plate, and it
 * costs nothing.
 */
export function buildATTE(opts = {}) {
  const S = opts.scale ?? 2.0;
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.34, 0, 0.62],
    prow: [0.30, 2.05, 0.55],
    stern: [0.38, -2.05, 0.60],
    head: [0.62, 0.30, 0.46],
    legs: 6, rows: [1.42, 0.02, -1.40], hipX: 1.00, hipY: 0.14,
    femur: 0.78, tibia: 0.92, tarsus: 0.26, splay: 0.86, rise: 0.62,
  }), { scale: S });

  const shell = armorMat(0xb6ab92, 0.08, 0.58, 1.5);
  const dark = metalMat(0x3b3a35, 0.48, 0.9, 2.2);
  const mark = armorMat(0x7c3226, 0.06, 0.62, 2.0);
  const glass = glassMat(0x141c22, 0.15);
  const hot = emissiveMat(0xff8a30, 1.3);
  const scorch = scorchMat();

  chassis(rig, dark, 0.9, 0.28, 4.4, S);

  /* ── mid hull ──
   * A long shallow wedge: a flat deck sloping down to the front, a slab belly
   * and heavy sponsons over the hip sockets. */
  const body = rig.get('body');
  const mid = assemble([
    [plateGeo(2.00 * S, 0.72 * S, 2.60 * S, 0.14 * S, 2), [0, 0.10 * S, 0]],
    [plateGeo(1.86 * S, 0.34 * S, 1.90 * S, 0.10 * S, 1), [0, 0.52 * S, 0.20 * S], [-0.12, 0, 0]],
    [plateGeo(2.24 * S, 0.30 * S, 1.70 * S, 0.10 * S, 1), [0, -0.06 * S, 0.05 * S]],
  ]);
  primary(body, mid, shell, 1.00 * S);

  const km = new Kit();
  km.pair((sx) => {
    km.add(dark, ventGeo(0.60 * S, 0.30 * S, 0.05 * S, 5), [sx * 1.02 * S, 0.16 * S, -0.55 * S], [0, sx * 1.5708, 0]);
    km.add(shell, plateGeo(0.16 * S, 0.36 * S, 1.30 * S, 0.06 * S, 1), [sx * 1.06 * S, -0.06 * S, 0.20 * S]);
    km.add(mark, plateGeo(0.02 * S, 0.22 * S, 0.44 * S, 0.006 * S, 1), [sx * 1.145 * S, 0.06 * S, 0.55 * S]);
    // the exhaust stacks behind the turret ring
    km.add(dark, new THREE.CylinderGeometry(0.09 * S, 0.10 * S, 0.34 * S, 8), [sx * 0.42 * S, 0.72 * S, -0.92 * S], [0.14, 0, 0]);
    km.add(hot, new THREE.CylinderGeometry(0.07 * S, 0.075 * S, 0.05 * S, 8), [sx * 0.42 * S, 0.88 * S, -0.90 * S], [0.14, 0, 0]);
  });
  // the turret ring the mass-driver sits on
  km.add(dark, new THREE.CylinderGeometry(0.46 * S, 0.52 * S, 0.22 * S, 14), [0, 0.66 * S, 0.38 * S]);
  km.add(shell, plateGeo(0.90 * S, 0.06 * S, 0.90 * S, 0.02 * S, 1), [0, 0.71 * S, 0.38 * S]);
  km.add(dark, ventGeo(1.10 * S, 0.34 * S, 0.06 * S, 5), [0, 0.34 * S, -1.28 * S], [0, Math.PI, 0]);
  for (let i = 0; i < 5; i++) {
    const sx = rng() < 0.5 ? -1 : 1;
    const w = (0.16 + rng() * 0.28) * S;
    km.add(scorch, plateGeo(0.006 * S, w, w * 0.7, 0.002 * S, 1),
      [sx * 1.15 * S, (-0.10 + rng() * 0.44) * S, (rng() - 0.5) * 2.2 * S]);
  }
  km.bake(body.obj);

  /* ── the prow: the tall command cab, four barrels, sensor spheres ──
   * Authored around the prow bone's own origin, which sits 2.05 of scale ahead
   * of the chassis centre. +Z is forward here and everywhere else. */
  const prow = rig.get('prow');
  const front = assemble([
    // the wedge that runs forward out of the chassis
    [plateGeo(1.86 * S, 0.62 * S, 1.50 * S, 0.12 * S, 2), [0, 0.10 * S, -0.10 * S]],
    // the cab: taller than anything else on the hull and square-shouldered
    [plateGeo(1.44 * S, 1.00 * S, 0.90 * S, 0.10 * S, 1), [0, 0.66 * S, 0.52 * S]],
    // the raked lower nose
    [plateGeo(1.20 * S, 0.42 * S, 0.66 * S, 0.10 * S, 1), [0, -0.16 * S, 0.92 * S], [0.42, 0, 0]],
  ]);
  primary(prow, front, shell, 0.86 * S);

  const kp = new Kit();
  // the maroon chevron and the viewport band across the cab face
  kp.add(mark, plateGeo(1.30 * S, 0.44 * S, 0.03 * S, 0.01 * S, 1), [0, 0.80 * S, 0.98 * S]);
  kp.add(dark, plateGeo(1.24 * S, 0.22 * S, 0.05 * S, 0.01 * S, 1), [0, 0.56 * S, 0.98 * S]);
  kp.add(glass, plateGeo(1.10 * S, 0.15 * S, 0.03 * S, 0.008 * S, 1), [0, 0.56 * S, 1.00 * S]);
  kp.pair((sx) => {
    // two spherical anti-personnel housings a side, each with a thin barrel
    for (const [y, z, r] of [[0.36, 0.10, 0.20], [-0.06, -0.24, 0.17]]) {
      kp.add(shell, new THREE.SphereGeometry(r * S, 10, 7), [sx * 0.82 * S, y * S, z * S]);
      kp.add(dark, new THREE.CylinderGeometry(0.035 * S, 0.042 * S, 0.96 * S, 7),
        [sx * 0.82 * S, y * S, (z + 0.50) * S], [1.5708, 0, 0]);
    }
    kp.add(dark, ventGeo(0.26 * S, 0.18 * S, 0.04 * S, 4), [sx * 0.94 * S, 0.06 * S, -0.42 * S], [0, sx * 1.5708, 0]);
    // the boarding ladder up the cab flank
    kp.row(4, (i, t) => kp.add(dark, plateGeo(0.03 * S, 0.03 * S, 0.22 * S, 0.008 * S, 1),
      [sx * 0.74 * S, (0.24 + t * 0.72) * S, 0.52 * S]));
  });
  kp.bake(prow.obj, { silhouette: true });

  /* ── the stern: the bulkier rear, the ramp and two rear-facing barrels ── */
  const stern = rig.get('stern');
  const back = assemble([
    [plateGeo(2.10 * S, 0.94 * S, 1.60 * S, 0.14 * S, 2), [0, 0.14 * S, 0.10 * S]],
    [plateGeo(1.80 * S, 0.80 * S, 0.60 * S, 0.12 * S, 1), [0, 0.06 * S, -0.72 * S], [0.30, 0, 0]],
    [plateGeo(1.90 * S, 0.26 * S, 1.20 * S, 0.08 * S, 1), [0, 0.62 * S, 0.20 * S], [-0.10, 0, 0]],
  ]);
  primary(stern, back, shell, 0.94 * S);

  const ks = new Kit();
  ks.pair((sx) => {
    ks.add(dark, new THREE.CylinderGeometry(0.032 * S, 0.040 * S, 0.84 * S, 7),
      [sx * 0.86 * S, 0.30 * S, -1.00 * S], [1.5708, 0, 0]);
    ks.add(dark, ventGeo(0.70 * S, 0.40 * S, 0.05 * S, 6), [sx * 1.06 * S, 0.16 * S, 0.10 * S], [0, sx * 1.5708, 0]);
    ks.add(mark, plateGeo(0.02 * S, 0.28 * S, 0.34 * S, 0.006 * S, 1), [sx * 1.06 * S, 0.42 * S, 0.44 * S]);
  });
  ks.add(dark, plateGeo(1.30 * S, 0.58 * S, 0.06 * S, 0.02 * S, 1), [0, 0.06 * S, -0.86 * S], [0.30, 0, 0]);
  ks.bake(stern.obj);

  /* ── the turret: a triangular shield plate and the mass driver ──
   * The barrel is very long, very thin, and canted up. It is tagged as
   * silhouette because at sixty metres it is half of what says AT-TE. */
  const head = rig.get('head');
  const turret = assemble([
    [new THREE.CylinderGeometry(0.40 * S, 0.44 * S, 0.20 * S, 12), [0, 0.06 * S, 0]],
    [plateGeo(0.66 * S, 0.36 * S, 0.72 * S, 0.08 * S, 1), [0, 0.28 * S, 0.04 * S]],
  ]);
  primary(head, turret, shell, 0.42 * S);

  const kt = new Kit();
  // the swept triangular shield plate behind the gunner
  kt.add(shell, new THREE.CylinderGeometry(0.02 * S, 0.02 * S, 1.30 * S, 3), [0, 0.56 * S, -0.30 * S], [1.5708, 0, 0], [1, 1, 22]);
  kt.add(mark, plateGeo(0.50 * S, 0.03 * S, 0.30 * S, 0.008 * S, 1), [0, 0.62 * S, -0.20 * S], [0.28, 0, 0]);
  // the gunner's open platform
  kt.add(dark, plateGeo(0.90 * S, 0.05 * S, 0.44 * S, 0.02 * S, 1), [0, 0.24 * S, 0.42 * S]);
  kt.pair((sx) => kt.add(dark, new THREE.CylinderGeometry(0.02 * S, 0.02 * S, 0.30 * S, 5), [sx * 0.40 * S, 0.38 * S, 0.50 * S]));
  // the trunnion, the jacketed breech, the long thin barrel and the brake
  kt.add(dark, new THREE.CylinderGeometry(0.14 * S, 0.14 * S, 0.44 * S, 10), [0, 0.42 * S, 0.10 * S], [0, 0, 1.5708]);
  kt.add(mark, new THREE.CylinderGeometry(0.115 * S, 0.115 * S, 0.52 * S, 10), [0, 0.50 * S, 0.42 * S], [1.36, 0, 0]);
  kt.add(dark, new THREE.CylinderGeometry(0.052 * S, 0.075 * S, 2.60 * S, 9), [0, 0.76 * S, 1.14 * S], [1.36, 0, 0]);
  kt.add(dark, new THREE.CylinderGeometry(0.078 * S, 0.070 * S, 0.24 * S, 9), [0, 1.02 * S, 1.76 * S], [1.36, 0, 0]);
  kt.bake(head.obj, { silhouette: true });
  const muzzle = mesh(new THREE.CylinderGeometry(0.06 * S, 0.05 * S, 0.10 * S, 8), dark, head.obj,
    [0, 1.08 * S, 1.90 * S], [1.36, 0, 0]);

  /* ── six legs ── */
  for (let i = 0; i < 6; i++) {
    const femur = rig.get(`femur${i}`);
    const tibia = rig.get(`tibia${i}`);
    const tarsus = rig.get(`tarsus${i}`);
    const sx = i % 2 === 0 ? 1 : -1;

    const F = femur.length;
    const fm = primary(femur, limbGeo(F, 0.16 * S, 0.12 * S, 8, true, { rings: 4, bulge: 0.10, bulgeAt: 0.3 }), dark, 0.17 * S);
    fm.userData.limb = { r0: 0.16 * S, r1: 0.12 * S, seg: 8 };
    const kf = new Kit();
    // THE HIP DISC — a large flat circular plate standing proud of the hull,
    // and the single most identifiable joint on this machine.
    kf.add(shell, new THREE.CylinderGeometry(0.40 * S, 0.40 * S, 0.13 * S, 14), [sx * 0.06 * S, 0, 0], [0, 0, 1.5708]);
    kf.add(dark, new THREE.CylinderGeometry(0.17 * S, 0.17 * S, 0.20 * S, 10), [sx * 0.09 * S, 0, 0], [0, 0, 1.5708]);
    kf.add(shell, plateGeo(0.16 * S, F * 0.72, 0.30 * S, 0.05 * S, 1), [0, F * 0.42, -0.06 * S]);
    kf.add(dark, new THREE.CylinderGeometry(0.30 * S, 0.30 * S, 0.16 * S, 12), [0, F, 0], [0, 0, 1.5708]);
    /* WHERE THE PLATE ACTUALLY REACHES, out of the two numbers that placed it —
     * a 0.72F plate centred at 0.42F spans 0.06F to 0.78F, so it stops short of
     * the hip disc and short of the knee housing. It stops short at both
     * because a leg has to SWING at both, which is why the derivation in
     * `weakSpotsOf` can take a plate's span and hand back two joints without
     * knowing anything about this machine. Player note #35. */
    platedSpan(femur, F * 0.06, F * 0.78);
    kf.bake(femur.obj);

    const T = tibia.length;
    const tm = primary(tibia, limbGeo(T, 0.125 * S, 0.085 * S, 8, true, { rings: 4, bulge: 0.08, bulgeAt: 0.26 }), dark, 0.135 * S);
    tm.userData.limb = { r0: 0.125 * S, r1: 0.085 * S, seg: 8 };
    const kt2 = new Kit();
    kt2.add(shell, plateGeo(0.14 * S, T * 0.66, 0.24 * S, 0.04 * S, 1), [0, T * 0.36, 0.05 * S]);
    kt2.add(dark, new THREE.CylinderGeometry(0.13 * S, 0.13 * S, 0.16 * S, 10), [0, T, 0], [0, 0, 1.5708]);
    platedSpan(tibia, T * 0.03, T * 0.69);            // 0.66T centred at 0.36T
    kt2.bake(tibia.obj);

    /* THE PAD STANDS ON THE GROUND, and getting that right is arithmetic
     * rather than taste. `_poseWalker` plants the TIBIA's tip at the foot
     * target; the tarsus hangs on below it, so the pad has to be built at the
     * tarsus TIP and flipped, and the stance's `ankle` has to lift the target
     * by however far the tarsus drops. The shipped spider walker sets `ankle:
     * 0` with a 0.3-of-scale tarsus, which buries its claws two thirds of a
     * metre; this is what that field is for.
     *
     * `toe` IS THE OTHER HALF, and it is not a cosmetic. `_poseWalker` aims the
     * tarsus along `fwd·toe + up·−(1−toe)`, so a big toe value leans the whole
     * ankle forward and a foot pad 1.6 m across, lying in the tarsus's own
     * plane, digs its front rim into the ground: measured at toe 0.32, four of
     * the six pads were 0.41 m under the floor while every tarsus TIP was
     * exactly on it. The tip landing correctly is what makes this invisible to
     * a check that only looks at the joint. An AT-TE's pads are flat and level
     * in every plate, so the ankle stands nearly upright and the pad lies flat
     * on it. */
    const P = tarsus.length;
    primary(tarsus, assemble([[padGeo(0.36 * S, 0.28 * S, 4), [0, P, 0], [Math.PI, 0, 0]]]), shell, 0.22 * S);
  }

  /**
   * ── THE STANCE IS 0.76 m WIDER A SIDE THAN IT WAS, AND THAT IS AN ACCURACY
   *    FIX RATHER THAN A TASTE ONE ───────────────────────────────────────
   *
   * The player gave the figures with the request: "13.2 meters long, 10.2
   * meters wide, and 5.02 meters tall". Measured against the shipped hull, two
   * of the three were already met and one was not:
   *
   *     canon 13.2 m long   built 13.5   +2%
   *     canon  5.02 m tall  built  5.7   +14%  (the mass driver is what is over)
   *     canon 10.2 m wide   built  7.9   -23%  ← this
   *
   * An AT-TE's width is its FOOT SPAN — the hull is narrow and the legs stand
   * well outboard of it, which is the whole reason clones shelter under one —
   * so the fix is `plantX` and nothing about the hull. 1.34 to 2.10 of scale
   * takes the pads to ±4.2 m and the machine to 10.0 m across, within 2% of
   * the figure, and `poleX` goes with it so the knee still breaks outward
   * instead of the leg going straight.
   *
   * It is not free: the leg now reaches 94% of its own length to plant, where
   * it reached 85%. That is checked rather than asserted — `giants.mjs` drives
   * the gait and measures where the pads land, and `vehicles.mjs` already held
   * the line that nothing sinks through the floor.
   */
  const stance = chassisStance(S, {
      legs: 6, hipHeight: 1.30, step: 0.86, lift: 0.26, rear: 0.22, bob: 0.018,
      plantX: 2.10, plantZ: [1.70, 0.02, -1.62], ankle: 0.259, toe: 0.08,
      poleX: 1.62, poleY: 1.45, poleZ: 0,
  });
  return {
    rig, muzzles: [muzzle], scale: S, stance,
    palette: { shell, dark, mark, scorch, eye: hot },
    proxy: hullProxy(rig, stance.hipHeight, ['body', 'prow', 'stern']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  3. AAT — the Separatist heavy                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * NO LEGS AT ALL, which is the whole point of it.
 *
 * It goes through the same `_poseWalker` every other chassis does, because a
 * stance with an EMPTY limb list is a legal stance: the solver's loop simply has
 * nothing to plant, `hipHeight` becomes ride height and `bob` becomes the drift
 * a repulsorlift has when it is holding station. It is a hovering wedge built
 * out of the same parts as a walker and it does not share one silhouette cue
 * with any of them.
 *
 * The skirt is the tell. Every plate shows a flat-bottomed pontoon wider than
 * the hull with three big oval intakes a side, and it is what makes the machine
 * read as floating rather than as a tank with its tracks left off.
 */
export function buildAAT(opts = {}) {
  const S = opts.scale ?? 1.7;
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.16, 0, 0.50],
    prow: [0.10, 1.75, 0.44],
    stern: [0.20, -1.60, 0.46],
    head: [0.34, -0.70, 0.42],
    legs: 0,
  }), { scale: S });

  // Smooth uniform desert tan. `repeat` deliberately coarse — the AAT is the
  // one machine in this set that is not battered, and a fine scuff tiling on a
  // flat panel reads as chipboard.
  const shell = armorMat(0xc0a577, 0.05, 0.62, 0.9);
  const dark = metalMat(0x4e4433, 0.5, 0.85, 2.0);
  const trim = armorMat(0x8f7a52, 0.06, 0.66, 1.2);
  const glass = glassMat(0x1a1c14, 0.15);
  const eye = emissiveMat(0xffb830, 2.2);

  chassis(rig, dark, 0.8, 0.24, 3.4, S);

  /* ── the skirt and the mid hull ── */
  const body = rig.get('body');
  const hull = assemble([
    // the flat-bottomed repulsorlift skirt, wider than the hull it carries
    [plateGeo(3.60 * S, 0.32 * S, 2.90 * S, 0.16 * S, 2), [0, -0.34 * S, 0.10 * S]],
    // the hull box, rising toward the rear
    [plateGeo(2.40 * S, 0.56 * S, 2.30 * S, 0.16 * S, 2), [0, 0.06 * S, 0]],
    [plateGeo(2.00 * S, 0.38 * S, 1.50 * S, 0.14 * S, 1), [0, 0.40 * S, -0.32 * S], [0.10, 0, 0]],
  ]);
  primary(body, hull, shell, 1.00 * S);

  const kb = new Kit();
  kb.pair((sx) => {
    // THREE OVAL INTAKES A SIDE, sunk into the skirt. Every plate has them and
    // they are what says "this floats" rather than "the tracks are missing".
    kb.row(3, (i, t) => kb.add(dark, new THREE.CylinderGeometry(0.14 * S, 0.14 * S, 0.09 * S, 12),
      [sx * 1.79 * S, -0.34 * S, (t - 0.5) * 1.70 * S], [0, 0, 1.5708], [1, 1, 2.0]));
    /* …AND THE INTAKES ARE THE ONLY SOFT PLACE ON A MACHINE WITH NO LIMBS.
     *
     * Player note #35 names this tank, and the derivation that gives every
     * other big body its weak points reads what a LIMB PLATE left uncovered —
     * an AAT has no limbs, so it would have had none at all. Six holes in a
     * repulsorlift skirt, on a hull that is otherwise durasteel the whole way
     * round, declared out of the same three numbers that place each one, so
     * the capsule cannot drift from the mesh.
     *
     * These sit on `body`, which is an AXIAL bone — so the guard still turns a
     * pass here (see `_turnCut`). That is deliberate and it is the honest
     * reading: an intake is thin metal, not an open joint, so what it buys is
     * SPEED through the material and a reason to get behind the thing. It is
     * not a shortcut past the hull. */
    kb.row(3, (i, t) => weakSpot(body, {
      key: `intake${sx > 0 ? 'L' : 'R'}${i}`, label: 'INTAKE',
      p0: [sx * 1.69 * S, -0.34 * S, (t - 0.5) * 1.70 * S],
      p1: [sx * 1.89 * S, -0.34 * S, (t - 0.5) * 1.70 * S],
      r: 0.17 * S,
      at0: 0, at1: 0,
    }));
    // the rounded sponson bulge along the flank
    kb.add(shell, new THREE.CylinderGeometry(0.22 * S, 0.22 * S, 2.10 * S, 8), [sx * 1.20 * S, 0.06 * S, 0.05 * S], [1.5708, 0, 0]);
    kb.add(trim, plateGeo(0.02 * S, 0.13 * S, 1.20 * S, 0.005 * S, 1), [sx * 1.225 * S, 0.24 * S, 0.05 * S]);
  });
  kb.add(dark, ventGeo(1.20 * S, 0.28 * S, 0.05 * S, 5), [0, 0.24 * S, -1.14 * S], [0, Math.PI, 0]);
  kb.bake(body.obj);

  /* ── the prow: raked nose, shell tubes, forward barrels ── */
  const prow = rig.get('prow');
  const nose = assemble([
    // a boat prow: the skirt runs forward flat, the hull above it rakes down
    [plateGeo(3.10 * S, 0.28 * S, 1.70 * S, 0.20 * S, 2), [0, -0.28 * S, -0.10 * S]],
    [plateGeo(2.10 * S, 0.44 * S, 1.60 * S, 0.16 * S, 2), [0, 0.10 * S, -0.20 * S], [-0.22, 0, 0]],
    [plateGeo(1.30 * S, 0.26 * S, 0.70 * S, 0.14 * S, 1), [0, -0.22 * S, 0.72 * S], [-0.36, 0, 0]],
  ]);
  primary(prow, nose, shell, 0.86 * S);

  const kp = new Kit();
  kp.pair((sx) => {
    // THREE SHELL TUBES A SIDE on the prow shoulder, in a housing
    kp.add(trim, plateGeo(0.30 * S, 0.22 * S, 0.66 * S, 0.05 * S, 1), [sx * 0.80 * S, 0.26 * S, -0.28 * S]);
    kp.row(3, (i, t) => kp.add(dark, new THREE.CylinderGeometry(0.055 * S, 0.055 * S, 0.34 * S, 8),
      [sx * 0.80 * S, 0.36 * S, -0.28 * S + (t - 0.5) * 0.44 * S], [0.24, 0, 0]));
    // the thin forward barrels under the shoulder
    kp.add(dark, new THREE.CylinderGeometry(0.036 * S, 0.044 * S, 1.10 * S, 7),
      [sx * 0.56 * S, 0.02 * S, 0.60 * S], [1.5708, 0, 0]);
    kp.add(trim, plateGeo(0.34 * S, 0.02 * S, 0.60 * S, 0.006 * S, 1), [sx * 1.30 * S, -0.13 * S, -0.10 * S]);
  });
  kp.add(glass, plateGeo(0.70 * S, 0.10 * S, 0.03 * S, 0.008 * S, 1), [0, 0.02 * S, 0.94 * S], [-0.36, 0, 0]);
  kp.bake(prow.obj);

  /* ── the stern skirt ── */
  const stern = rig.get('stern');
  primary(stern, assemble([
    [plateGeo(3.40 * S, 0.30 * S, 1.40 * S, 0.18 * S, 1), [0, -0.34 * S, 0.10 * S]],
    [plateGeo(2.20 * S, 0.52 * S, 1.10 * S, 0.14 * S, 1), [0, 0.14 * S, 0.10 * S]],
  ]), shell, 0.92 * S);
  const ks = new Kit();
  ks.add(dark, ventGeo(1.40 * S, 0.34 * S, 0.06 * S, 6), [0, 0.06 * S, -0.44 * S], [0, Math.PI, 0]);
  ks.bake(stern.obj);

  /* ── the turret: box, cupola, one long stepped barrel and two flankers ── */
  const head = rig.get('head');
  const turret = assemble([
    [plateGeo(1.34 * S, 0.66 * S, 1.10 * S, 0.10 * S, 1), [0, 0.16 * S, 0]],
    [plateGeo(1.10 * S, 0.30 * S, 0.86 * S, 0.08 * S, 1), [0, 0.54 * S, 0.06 * S], [-0.16, 0, 0]],
  ]);
  primary(head, turret, shell, 0.60 * S);

  const kt = new Kit();
  // the domed commander's cupola and its whip antenna
  kt.add(shell, new THREE.SphereGeometry(0.36 * S, 12, 7, 0, TAU, 0, Math.PI * 0.5), [0, 0.48 * S, -0.14 * S], null, [1, 0.70, 1]);
  kt.add(trim, bandGeo(0.32 * S, 0.38 * S, 0.32 * S, 0.375 * S, 0.07 * S, 12), [0, 0.46 * S, -0.14 * S]);
  kt.row(4, (i, t) => kt.add(dark, new THREE.CylinderGeometry(0.045 * S, 0.045 * S, 0.05 * S, 8),
    [Math.sin(t * TAU) * 0.30 * S, 0.56 * S, -0.14 * S + Math.cos(t * TAU) * 0.30 * S], [1.5708, 0, 0]));
  kt.add(dark, new THREE.CylinderGeometry(0.007 * S, 0.012 * S, 0.62 * S, 5), [0.24 * S, 0.86 * S, -0.30 * S], [0.06, 0, -0.10]);
  // the mantlet and the long stepped main gun
  kt.add(dark, new THREE.CylinderGeometry(0.19 * S, 0.19 * S, 0.36 * S, 10), [0, 0.26 * S, 0.44 * S], [1.5708, 0, 0]);
  kt.add(trim, new THREE.CylinderGeometry(0.115 * S, 0.135 * S, 0.85 * S, 10), [0, 0.26 * S, 1.00 * S], [1.5708, 0, 0]);
  kt.add(dark, new THREE.CylinderGeometry(0.080 * S, 0.100 * S, 1.00 * S, 9), [0, 0.26 * S, 1.92 * S], [1.5708, 0, 0]);
  kt.add(dark, new THREE.CylinderGeometry(0.052 * S, 0.070 * S, 1.00 * S, 9), [0, 0.26 * S, 2.90 * S], [1.5708, 0, 0]);
  kt.add(dark, new THREE.CylinderGeometry(0.072 * S, 0.072 * S, 0.20 * S, 9), [0, 0.26 * S, 3.46 * S], [1.5708, 0, 0]);
  // the two thin flanking barrels
  kt.pair((sx) => {
    kt.add(dark, new THREE.CylinderGeometry(0.038 * S, 0.048 * S, 1.40 * S, 7), [sx * 0.34 * S, 0.06 * S, 1.10 * S], [1.5708, 0, 0]);
    kt.add(trim, plateGeo(0.16 * S, 0.14 * S, 0.30 * S, 0.03 * S, 1), [sx * 0.34 * S, 0.06 * S, 0.46 * S]);
    kt.add(eye, new THREE.SphereGeometry(0.045 * S, 7, 5), [sx * 0.44 * S, 0.30 * S, 0.52 * S]);
  });
  kt.bake(head.obj, { silhouette: true });
  const muzzle = mesh(new THREE.CylinderGeometry(0.055 * S, 0.05 * S, 0.10 * S, 8), dark, head.obj,
    [0, 0.26 * S, 3.60 * S], [1.5708, 0, 0]);
  const flankL = mesh(new THREE.CylinderGeometry(0.04 * S, 0.036 * S, 0.08 * S, 7), dark, head.obj,
    [0.34 * S, 0.06 * S, 1.84 * S], [1.5708, 0, 0]);
  const flankR = mesh(new THREE.CylinderGeometry(0.04 * S, 0.036 * S, 0.08 * S, 7), dark, head.obj,
    [-0.34 * S, 0.06 * S, 1.84 * S], [1.5708, 0, 0]);

  const stance = chassisStance(S, {
      legs: 0, hipHeight: 0.72, step: 0, lift: 0, rear: 0.16, bob: 0.055,
      plantX: 0, plantZ: [], ankle: 0, toe: 0, poleX: 0, poleY: 0, poleZ: 0,
  });
  return {
    rig, muzzles: [muzzle, flankL, flankR], scale: S, stance,
    palette: { shell, dark, mark: trim, eye },
    proxy: hullProxy(rig, stance.hipHeight, ['body', 'prow', 'stern']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  4. Hailfire droid — two hoops and a salvo                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE HOOPS ARE THE MACHINE.
 *
 * They are 2.6 m across on a body a metre and a half long, they stand a metre
 * clear of the top of the pod, and the pod hangs BELOW the axle line rather than
 * sitting on it — which is what all three plates agree on and what the studio
 * render alone would not tell you. So the bounding box is tall, wide and thin,
 * which is a shape nothing else in this game has.
 *
 * The wheels roll from odometry (see `rollByOdometry`) because there is no
 * per-frame hook into a built body and this workstream may not add one to
 * Enemy.js. A hailfire that slides is worse than one whose wheels lag a frame.
 */
export function buildHailfire(opts = {}) {
  const S = opts.scale ?? 1.7;
  const WR = 1.50 * S;                    // hoop radius — the machine's whole scale
  const rig = new Rig(chassisSkeleton(S, {
    body: [-0.26, 0, 0.55], head: [0.55, -0.28, 0.62, [0, 0.80, -0.60]],
    legs: 0,
    wheels: [
      { name: 'wheelL', x: 0.30, y: 0.06, z: 0, len: 1.05, dir: 1, rim: 1.44 },
      { name: 'wheelR', x: -0.30, y: 0.06, z: 0, len: 1.05, dir: -1, rim: 1.44 },
    ],
  }), { scale: S });

  const shell = armorMat(0xa88b4e, 0.22, 0.6, 2.4);
  const dark = metalMat(0x4a3a26, 0.55, 0.92, 2.6);
  const tread = metalMat(0x35302a, 0.7, 0.85, 5.0);
  const eye = emissiveMat(0xff3010, 3.2);
  const scorch = scorchMat();

  chassis(rig, dark, 0.42, 0.20, 0.90, S);

  /* ── the pod ──
   * A faceted drum with a ribbed radiator band and a conical underside, slung
   * BELOW the axle line — which is what all three plates agree on and what the
   * studio render on its own does not tell you. */
  const body = rig.get('body');
  const pod = assemble([
    [plateGeo(0.62 * S, 0.40 * S, 0.86 * S, 0.09 * S, 1), [0, 0.30 * S, 0]],
    [new THREE.CylinderGeometry(0.30 * S, 0.34 * S, 0.24 * S, 10), [0, 0.14 * S, 0]],
    [new THREE.CylinderGeometry(0.16 * S, 0.30 * S, 0.26 * S, 10), [0, -0.06 * S, 0]],
  ]);
  primary(body, pod, shell, 0.40 * S);

  const kb = new Kit();
  // the radiator ribs around the drum
  kb.row(9, (i, t) => {
    const a = t * TAU;
    kb.add(dark, plateGeo(0.05 * S, 0.20 * S, 0.05 * S, 0.01 * S, 1),
      [Math.sin(a) * 0.32 * S, 0.14 * S, Math.cos(a) * 0.32 * S], [0, a, 0]);
  });
  // the head plate and its single photoreceptor, on the pod's leading face
  kb.add(dark, plateGeo(0.44 * S, 0.22 * S, 0.06 * S, 0.02 * S, 1), [0, 0.36 * S, 0.44 * S]);
  kb.add(eye, new THREE.SphereGeometry(0.06 * S, 8, 6), [0.10 * S, 0.36 * S, 0.47 * S]);
  kb.pair((sx) => {
    kb.add(shell, plateGeo(0.10 * S, 0.28 * S, 0.30 * S, 0.03 * S, 1), [sx * 0.28 * S, 0.40 * S, 0.30 * S], [0, sx * -0.4, 0]);
    // the thin forward laser barrels under the axle arms
    kb.add(dark, new THREE.CylinderGeometry(0.026 * S, 0.032 * S, 0.70 * S, 6), [sx * 0.22 * S, 0.14 * S, 0.50 * S], [1.5708, 0, 0]);
  });
  kb.add(scorch, plateGeo(0.24 * S, 0.006 * S, 0.20 * S, 0.002 * S, 1), [0.12 * S, 0.505 * S, 0.10 * S]);
  kb.bake(body.obj);

  /* ── the missile banks ──
   * Two clusters of fifteen tubes, raked up and back off the pod's spine, on
   * the HEAD bone so the whole battery traverses onto the target. Every tube
   * carries a conical missile nose, because that is what the plates show and it
   * is what tells this apart from a rack of pipes. */
  const head = rig.get('head');
  const spine = assemble([
    [plateGeo(0.44 * S, 0.50 * S, 0.30 * S, 0.06 * S, 1), [0, 0.16 * S, 0]],
  ]);
  primary(head, spine, dark, 0.28 * S);

  const kh = new Kit();
  const TUBE = 0.44 * S, TR = 0.052 * S;
  kh.pair((sx) => {
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 3; r++) {
        const x = sx * (0.16 + c * 0.115) * S;
        const y = (0.30 + r * 0.115) * S;
        const z = -c * 0.035 * S;
        kh.add(dark, new THREE.CylinderGeometry(TR, TR, TUBE, 7), [x, y, z], [1.5708, 0, 0]);
        kh.add(shell, new THREE.ConeGeometry(TR * 0.98, 0.14 * S, 7), [x, y, z + TUBE * 0.5 + 0.06 * S], [1.5708, 0, 0]);
      }
    }
    kh.add(shell, plateGeo(0.62 * S, 0.10 * S, 0.34 * S, 0.03 * S, 1), [sx * 0.40 * S, 0.22 * S, -0.08 * S], [0, 0, sx * 0.10]);
  });
  kh.bake(head.obj, { silhouette: true });
  const muzzles = [];
  for (const sx of [1, -1]) {
    muzzles.push(mesh(new THREE.CylinderGeometry(TR, TR * 0.8, 0.08 * S, 6), dark, head.obj,
      [sx * 0.38 * S, 0.42 * S, 0.40 * S], [1.5708, 0, 0]));
  }

  /* ── the hoops ──
   * The axle arm is the bone (so the blade meets something real between the pod
   * and the hub); the hoop, its spokes, its tread and the teardrop suspension
   * plate hang off the bone tip and are tagged silhouette, because they are the
   * silhouette and nothing else about this machine is. */
  const wheels = [];
  for (const name of ['wheelL', 'wheelR']) {
    const bone = rig.get(name);
    const A = bone.length;
    const arm = primary(bone, limbGeo(A, 0.13 * S, 0.10 * S, 8, true, { rings: 3, bulge: 0.14, bulgeAt: 0.3 }), dark, 0.14 * S);
    arm.userData.limb = { r0: 0.13 * S, r1: 0.10 * S, seg: 8 };

    // hub, at the bone's tip; the hoop spins about the bone's own +Y (the axle)
    const hub = new THREE.Object3D();
    hub.position.y = A;
    bone.obj.add(hub);

    /* THE HUB'S LOCAL +Y IS THE AXLE, which is the one thing to keep straight
     * in here. Everything flat on a wheel has to be thin along local Y and
     * broad in local X and Z. The teardrop plate was first authored the other
     * way round and the machine measured 7.8 m across instead of 4.9 — a plate
     * three metres wide standing out sideways from each wheel, which is not
     * something a static read of the file would have caught. */
    const kw = new Kit();
    kw.add(dark, new THREE.CylinderGeometry(0.26 * S, 0.22 * S, 0.22 * S, 12), [0, 0, 0]);
    // the teardrop suspension plate, riding the hoop's lower inner rim
    kw.add(shell, plateGeo(WR * 0.62, 0.09 * S, WR * 1.10, 0.05 * S, 1), [0, 0, -WR * 0.36], [0.42, 0, 0]);
    kw.add(shell, new THREE.CylinderGeometry(0.20 * S, 0.20 * S, 0.10 * S, 12), [0, 0, -WR * 0.66]);
    kw.bake(hub, { silhouette: true });

    const hoop = new THREE.Group();
    hub.add(hoop);
    const kr = new Kit();
    // the ring itself: thin in section and faceted, which is what the cel pass
    // wants — a smooth torus bands into mush under a two-tone terminator
    const ring = new THREE.TorusGeometry(WR, 0.075 * S, 5, 34);
    ring.rotateX(Math.PI / 2);
    kr.add(shell, ring);
    // tread blocks around the outer face — broad ACROSS the tyre (local Y),
    // shallow radially (local X), long tangentially (local Z after the yaw)
    kr.row(26, (i, t) => {
      const a = t * TAU;
      kr.add(tread, plateGeo(0.10 * S, 0.17 * S, 0.26 * S, 0.012 * S, 1),
        [Math.sin(a) * (WR + 0.055 * S), 0, Math.cos(a) * (WR + 0.055 * S)], [0, a, 0]);
    });
    // three structural spokes out of the hub
    kr.row(3, (i, t) => {
      const a = t * TAU * (2 / 3);
      kr.add(dark, plateGeo(0.05 * S, 0.04 * S, WR * 0.92, 0.01 * S, 1),
        [Math.sin(a) * WR * 0.48, 0, Math.cos(a) * WR * 0.48], [0, a, 0]);
    });
    /* ONE driver for the whole hoop. The bake returns a mesh per material —
     * ring, tread, spokes — and giving each its own callback would have three
     * of them integrating the same displacement separately, which is fine until
     * one is culled and the tyre and its tread come apart. */
    const rims = kr.bake(hoop, { silhouette: true });
    if (rims.length) rollByOdometry(rims[0], hoop, WR);

    /* The lower rim bone: the run of hoop between the hub and the ground, which
     * is the only part of a five-metre wheel a player can reach. It carries a
     * slim guide-rail so it has geometry — a bone without any is a bone the
     * blade solver never offers. */
    const rimBone = rig.get(name.replace('wheel', 'rim'));
    if (rimBone) {
      const RL = rimBone.length;
      const rm = primary(rimBone, limbGeo(RL, 0.11 * S, 0.13 * S, 7, false, { rings: 3 }), dark, 0.30 * S);
      rm.userData.limb = { r0: 0.11 * S, r1: 0.13 * S, seg: 7 };
      rm.userData.silhouette = true;
    }
    wheels.push({ bone, hub, hoop, radius: WR });
  }

  const stance = chassisStance(S, {
      legs: 0, hipHeight: 1.56, step: 0, lift: 0, rear: 0.20, bob: 0.022,
      plantX: 0, plantZ: [], ankle: 0, toe: 0, poleX: 0, poleY: 0, poleZ: 0,
  });
  return {
    rig, muzzles, wheels, scale: S, wheelRadius: WR, stance,
    palette: { shell, dark, mark: tread, scorch, eye },
    proxy: hullProxy(rig, stance.hipHeight, ['body', 'wheelL', 'wheelR', 'rimL', 'rimR']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  5. LAAT/i gunship — geometry for the arrivals dropship                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `src/game/Arrivals.js` flies a literal `new THREE.BoxGeometry(2.7, 1.55, 7.6)`
 * with a four-sided cone stuck on the front, on every level, on every wave. This
 * is the thing it is supposed to be, and the three plates of it agree on five
 * cues that a box has none of:
 *
 *   SWEPT-FORWARD WINGS with a wingtip pod on each and rocket racks underneath
 *   TWO DORSAL CONE NACELLES raked outward, with red bands near the mouth
 *   TWO CHIN BALL TURRETS under a bulbous forward hull
 *   SIDE GUNNER BUBBLES on outriggers amidships
 *   AN OPEN TROOP BAY between them — which is the whole reason it is here
 *
 * ── THE CONTRACT, because this crosses a file boundary ────────────────────
 *
 * Arrivals.js is not this workstream's to edit, so this is written to drop into
 * `_makeDropship` without changing one line of the flight path:
 *
 *   · the returned object is a `THREE.Group` at the ship's centre of mass;
 *   · the NOSE POINTS AT −Z, which is the direction the existing hull cone
 *     points and the direction `_updateDropship` flies;
 *   · it measures 7.4 m long and 10.9 m across, against the box's 7.6 by 10.0,
 *     so nothing about the ranges the flight path was tuned at moves — and it
 *     publishes those as `userData.span/length/height`, off its own bounding
 *     box rather than as literals, so they cannot drift from the ship;
 *   · `group.userData.engines` is the pair of Object3Ds the engine glow should
 *     be parented to, and `group.userData.lamp` the landing light, so the two
 *     meshes Arrivals already animates have somewhere to go.
 *
 * Every geometry and material is built ONCE and shared, exactly as Arrivals.js
 * does it, because a wave may put three of these in the sky at once — see the
 * template note below for how, and for the one thing cloning gets wrong.
 */
let _gunM = null;
function gunshipMaterials() {
  if (_gunM) return _gunM;
  return (_gunM = {
    shell: armorMat(0xc9c2ad, 0.08, 0.6, 0.8),
    mark: armorMat(0x7b2f2c, 0.06, 0.62, 1.0),
    dark: metalMat(0x3a3b3e, 0.5, 0.9, 2.0),
    glass: glassMat(0x1b2a30, 0.12),
    belly: armorMat(0x76794a, 0.05, 0.72, 1.4),
  });
}

/**
 * The one built ship, cloned for every arrival after the first.
 *
 * `Object3D.clone()` copies the tree and SHARES the geometry and material of
 * every mesh by reference, which is exactly what is wanted: three ships in the
 * sky are three transforms over one set of buffers. Without it, an arrival on
 * every wave would re-merge forty geometries and Arrivals.js's own promise —
 * "every geometry and every material below is built ONCE, at module scope, and
 * shared by every arrival that ever runs" — would stop being true the moment
 * this replaced its box.
 *
 * `userData` is copied SHALLOW by clone, so the anchors would still point at
 * the template's own Object3Ds and every ship in the sky would light its
 * engines in the same place. They are re-resolved by name below. That is the
 * whole reason the anchors are named at all.
 */
let _gunTemplate = null;

export function buildGunship(opts = {}) {
  const S = opts.scale ?? 1.0;
  if (S === 1 && _gunTemplate) {
    const c = _gunTemplate.clone(true);
    c.userData = {
      ..._gunTemplate.userData,
      engines: [c.getObjectByName('engineL'), c.getObjectByName('engineR')],
      lamp: c.getObjectByName('lamp'),
    };
    return c;
  }
  const M = gunshipMaterials();
  const g = new THREE.Group();
  g.name = 'gunship';

  /* ── fuselage: bulbous forward hull, boxy troop bay, tapered tail ── */
  const kf = new Kit();
  kf.add(M.shell, plateGeo(2.60 * S, 1.70 * S, 3.40 * S, 0.42 * S, 2), [0, 0, -1.30 * S]);
  kf.add(M.shell, plateGeo(2.90 * S, 1.86 * S, 3.20 * S, 0.22 * S, 2), [0, 0.02 * S, 1.10 * S]);
  kf.add(M.shell, plateGeo(2.30 * S, 1.30 * S, 1.40 * S, 0.30 * S, 1), [0, 0.06 * S, 3.20 * S], [0.16, 0, 0]);
  // the olive-weathered belly every plate has
  kf.add(M.belly, plateGeo(2.62 * S, 0.44 * S, 5.60 * S, 0.24 * S, 1), [0, -0.80 * S, 0.30 * S]);
  // the stepped twin canopies, painted maroon
  kf.add(M.mark, plateGeo(1.70 * S, 0.42 * S, 1.60 * S, 0.18 * S, 1), [0, 0.92 * S, -2.10 * S], [-0.10, 0, 0]);
  kf.add(M.glass, plateGeo(1.36 * S, 0.24 * S, 1.20 * S, 0.10 * S, 1), [0, 1.02 * S, -2.24 * S], [-0.10, 0, 0]);
  // the open troop bay: a recessed dark slot with a door rail above and below
  kf.pair((sx) => {
    kf.add(M.dark, plateGeo(0.10 * S, 1.00 * S, 2.60 * S, 0.03 * S, 1), [sx * 1.42 * S, -0.04 * S, 0.90 * S]);
    kf.add(M.shell, plateGeo(0.16 * S, 0.16 * S, 2.80 * S, 0.05 * S, 1), [sx * 1.46 * S, 0.54 * S, 0.90 * S]);
    kf.add(M.shell, plateGeo(0.16 * S, 0.16 * S, 2.80 * S, 0.05 * S, 1), [sx * 1.46 * S, -0.60 * S, 0.90 * S]);
  });
  kf.bake(g);

  /* ── chin turrets: two balls with twin barrels, under the nose ── */
  const kc = new Kit();
  kc.pair((sx) => {
    kc.add(M.shell, new THREE.SphereGeometry(0.60 * S, 10, 7), [sx * 0.74 * S, -0.62 * S, -2.30 * S]);
    kc.add(M.dark, new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 1.20 * S, 7), [sx * 0.74 * S, -0.66 * S, -3.00 * S], [1.5708, 0, 0]);
  });
  kc.bake(g);

  /* ── side gunner bubbles on outriggers ── */
  const kg = new Kit();
  kg.pair((sx) => {
    kg.add(M.dark, new THREE.CylinderGeometry(0.10 * S, 0.10 * S, 1.10 * S, 6), [sx * 2.00 * S, 0.06 * S, -0.30 * S], [0, 0, 1.5708]);
    kg.add(M.glass, new THREE.SphereGeometry(0.66 * S, 10, 8), [sx * 2.62 * S, 0.02 * S, -0.30 * S]);
    kg.add(M.dark, bandGeo(0.60 * S, 0.68 * S, 0.60 * S, 0.68 * S, 0.10 * S, 12), [sx * 2.62 * S, -0.66 * S, -0.30 * S]);
  });
  kg.bake(g);

  /* ── the wings ──
   * SWEPT FORWARD: the leading edge runs forward as it goes outboard, which is
   * the cue that separates this from every other gunship shape, plus a droop
   * and a wingtip pod. */
  const kw = new Kit();
  kw.pair((sx) => {
    kw.add(M.shell, plateGeo(4.10 * S, 0.22 * S, 1.90 * S, 0.10 * S, 1),
      [sx * 3.10 * S, 0.42 * S, 1.10 * S], [0, sx * -0.42, sx * -0.12]);
    kw.add(M.mark, plateGeo(3.60 * S, 0.05 * S, 0.44 * S, 0.02 * S, 1),
      [sx * 3.05 * S, 0.55 * S, 0.55 * S], [0, sx * -0.42, sx * -0.12]);
    // wingtip pod
    kw.add(M.shell, new THREE.SphereGeometry(0.42 * S, 9, 7), [sx * 5.06 * S, 0.36 * S, 0.28 * S], null, [1, 0.9, 1.9]);
    // the rocket rack under the wing — six tubes with visible red heads
    kw.row(6, (i, t) => {
      kw.add(M.dark, new THREE.CylinderGeometry(0.055 * S, 0.055 * S, 0.60 * S, 6),
        [sx * (2.30 + t * 1.80) * S, 0.24 * S, 1.20 * S - t * 0.80 * S], [1.5708, 0, 0]);
      kw.add(M.mark, new THREE.ConeGeometry(0.055 * S, 0.16 * S, 6),
        [sx * (2.30 + t * 1.80) * S, 0.24 * S, 0.86 * S - t * 0.80 * S], [-1.5708, 0, 0]);
    });
  });
  kw.bake(g);

  /* ── the two dorsal cone nacelles, raked out and back, red-banded ── */
  const engines = [];
  const kn = new Kit();
  kn.pair((sx) => {
    kn.add(M.shell, new THREE.CylinderGeometry(0.30 * S, 0.62 * S, 2.60 * S, 10),
      [sx * 0.78 * S, 1.34 * S, 1.50 * S], [1.28, 0, sx * -0.16]);
    kn.add(M.mark, new THREE.CylinderGeometry(0.44 * S, 0.48 * S, 0.34 * S, 10),
      [sx * 0.90 * S, 1.98 * S, 0.40 * S], [1.28, 0, sx * -0.16]);
    kn.add(M.dark, new THREE.CylinderGeometry(0.26 * S, 0.26 * S, 0.20 * S, 10),
      [sx * 0.96 * S, 2.20 * S, -0.05 * S], [1.28, 0, sx * -0.16]);
    // the pylon it stands on
    kn.add(M.shell, plateGeo(0.34 * S, 0.90 * S, 1.40 * S, 0.08 * S, 1), [sx * 0.72 * S, 0.80 * S, 1.70 * S]);
  });
  kn.bake(g);
  for (const sx of [1, -1]) {
    const e = new THREE.Object3D();
    e.name = sx > 0 ? 'engineL' : 'engineR';
    e.position.set(sx * 0.62 * S, 0.94 * S, 2.90 * S);
    g.add(e);
    engines.push(e);
  }
  const lamp = new THREE.Object3D();
  lamp.name = 'lamp';
  lamp.position.set(0, -0.90 * S, -3.10 * S);
  g.add(lamp);

  g.userData.engines = engines;
  g.userData.lamp = lamp;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  /* MEASURED, not typed. These two were literals — 8.4 and 10.4 — beside a ship
   * that actually measures 7.4 and 10.9, which is HANDOFF §2.3's defect in
   * miniature: a number kept by hand next to the thing it describes, wrong the
   * first time a plate moved and wrong silently. Arrivals sizes its flare and
   * its landing wash off them. */
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), bs = new THREE.Vector3();
  bb.getSize(bs);
  g.userData.span = bs.x;
  g.userData.length = bs.z;
  g.userData.height = bs.y;
  if (S === 1) _gunTemplate = g;
  return g;
}

let _hmpM = null;
function hmpMaterials() {
  if (_hmpM) return _hmpM;
  return (_hmpM = {
    /* A droid gunship is not painted, it is FINISHED — the Confederacy's
     * hardware wears the same bronze-grey alloy as its battle droids, because
     * the whole army was ordered out of one foundry. Read against the clone
     * gunship's bone-white shell and maroon flashes, which is a machine
     * somebody's air force keeps. */
    shell: armorMat(0x8f8271, 0.07, 0.62, 0.9),
    plate: armorMat(0x6f6455, 0.05, 0.68, 1.2),
    dark: metalMat(0x2f2c28, 0.5, 0.9, 2.0),
    lens: metalMat(0x8a1f16, 0.6, 0.4, 3.0),
  });
}

let _hmpTemplate = null;

/**
 * THE CONFEDERACY'S GUNSHIP — an HMP droid gunship, and why that one.
 *
 * The lane that gave the Sith their own TRANSPORT left this seam open and said
 * so: the ship that delivers ENEMIES was one hull for both sides, so a Jedi's
 * droid enemies came down out of a Republic gunship. That is the same defect
 * as "sith side still gets picked up by the same transports that belong to the
 * republic canonically", one scene over and pointed at the other player.
 *
 * The Heavy Missile Platform is the Confederacy's answer to a LAAT and it is
 * the right one for what this ship is asked to do here: it is a GUNSHIP that
 * carries droids, it deploys them off external racks rather than out of a bay,
 * and it is unmanned — which is the silhouette decision that matters. There is
 * no canopy on it anywhere, because there is nobody in it. A clone gunship has
 * two stepped canopies with a pilot behind each, and a player who has learned
 * that reads "crewed" and "not crewed" at three hundred metres without being
 * told.
 *
 * IT IS BUILT TO THE SAME CONTRACT and deliberately not to the same shape:
 * `engines`, `lamp`, `span`, `length`, `height`, so `ArrivalDirector` flies it
 * with no branch. Flat and wide against the clone ship's tall boxy fuselage —
 * a lifting body with two downturned wings and a chin turret, about 12 m across
 * and 2.4 m deep, against 10 × 4.3.
 */
export function buildDroidGunship(opts = {}) {
  const S = opts.scale ?? 1.0;
  if (S === 1 && !opts.fresh && _hmpTemplate) {
    const c = _hmpTemplate.clone(true);
    /* Re-resolve the anchors on the CLONE. `Object3D.clone` copies the tree and
     * shares geometry and materials, but `userData` is copied by reference — so
     * a clone that kept the template's `engines` and `lamp` would drive the
     * template's own Object3Ds and every ship in the sky would light the same
     * lamp. The same note sits over `buildGunship`. */
    c.userData = {
      ..._hmpTemplate.userData,
      engines: ['engineL', 'engineC', 'engineR'].map((n) => c.getObjectByName(n)),
      lamp: c.getObjectByName('lamp'),
      turret: c.getObjectByName('turret'),
    };
    return c;
  }
  const M = hmpMaterials();
  const g = new THREE.Group();
  g.name = 'hmp';

  /* ── the lifting body: a flat wedge, widest across the middle ─────── */
  const kf = new Kit();
  kf.add(M.shell, plateGeo(3.20 * S, 0.86 * S, 4.60 * S, 0.34 * S, 2), [0, 0, 0.20 * S]);
  // the nose tapers to the chin gun rather than to a cockpit
  kf.add(M.shell, plateGeo(2.10 * S, 0.66 * S, 2.20 * S, 0.26 * S, 2), [0, -0.06 * S, -2.60 * S], [0.13, 0, 0]);
  kf.add(M.plate, plateGeo(1.20 * S, 0.44 * S, 1.10 * S, 0.16 * S, 1), [0, -0.24 * S, -3.60 * S], [0.22, 0, 0]);
  /* THE SENSOR BAND where a canopy would be — a dark strip with two lenses in
   * it, which is what an unmanned machine has instead of a face. */
  kf.add(M.dark, plateGeo(1.44 * S, 0.16 * S, 0.30 * S, 0.05 * S, 1), [0, 0.30 * S, -3.20 * S], [0.20, 0, 0]);
  kf.pair((sx) => {
    kf.add(M.lens, plateGeo(0.20 * S, 0.12 * S, 0.16 * S, 0.04 * S, 1), [sx * 0.42 * S, 0.32 * S, -3.28 * S], [0.20, 0, 0]);
  });

  /* ── the two downturned wings, and the racks the droids ride ─────── */
  kf.pair((sx) => {
    kf.add(M.shell, plateGeo(2.90 * S, 0.42 * S, 3.10 * S, 0.22 * S, 2),
      [sx * 2.70 * S, -0.10 * S, 0.30 * S], [0, 0, sx * -0.22]);
    // the outboard tip, canted further down — the HMP's own profile
    kf.add(M.plate, plateGeo(1.30 * S, 0.34 * S, 2.10 * S, 0.18 * S, 1),
      [sx * 4.40 * S, -0.52 * S, 0.40 * S], [0, 0, sx * -0.46]);
    /* THE RACKS. A droid gunship does not have a troop bay: the infantry rides
     * OUTSIDE, folded onto the wing, which is why the Confederacy can put a
     * squad on a craft with no interior at all. Two rails and four clamps a
     * side, and they are the thing to look at when it flares. */
    kf.add(M.dark, plateGeo(0.14 * S, 0.14 * S, 2.60 * S, 0.04 * S, 1), [sx * 2.10 * S, -0.44 * S, 0.30 * S]);
    kf.add(M.dark, plateGeo(0.14 * S, 0.14 * S, 2.60 * S, 0.04 * S, 1), [sx * 3.30 * S, -0.52 * S, 0.30 * S]);
    for (let i = 0; i < 4; i++) {
      kf.add(M.plate, plateGeo(1.30 * S, 0.12 * S, 0.22 * S, 0.05 * S, 1),
        [sx * 2.70 * S, -0.48 * S, (-0.90 + i * 0.62) * S]);
    }
    // missile tubes under the wing root, which is what the thing is named for
    kf.add(M.dark, plateGeo(0.46 * S, 0.40 * S, 1.60 * S, 0.14 * S, 1), [sx * 1.70 * S, -0.46 * S, -1.30 * S]);
  });

  /* ── the chin turret, the one thing on it that traverses ─────────── */
  const turret = new THREE.Group();
  turret.name = 'turret';
  const kt = new Kit();
  kt.add(M.plate, plateGeo(0.70 * S, 0.44 * S, 0.70 * S, 0.16 * S, 1), [0, 0, 0]);
  kt.pair((sx) => {
    kt.add(M.dark, plateGeo(0.12 * S, 0.12 * S, 1.30 * S, 0.04 * S, 1), [sx * 0.20 * S, -0.06 * S, -0.80 * S]);
  });
  kt.bake(turret);
  turret.position.set(0, -0.52 * S, -3.30 * S);
  g.add(turret);

  kf.bake(g);

  /* ── the engines: three, in a row across the tail ────────────────── */
  const engines = [];
  const nacelle = (x) => {
    const e = new THREE.Object3D();
    e.name = engines.length === 0 ? 'engineL' : (engines.length === 1 ? 'engineC' : 'engineR');
    e.position.set(x, -0.02 * S, 2.70 * S);
    g.add(e);
    engines.push(e);
    return e;
  };
  const ke = new Kit();
  for (const x of [-1.70, 0, 1.70]) {
    ke.add(M.plate, plateGeo(1.06 * S, 0.72 * S, 1.30 * S, 0.24 * S, 1), [x * S, -0.02 * S, 2.40 * S]);
    ke.add(M.dark, plateGeo(0.78 * S, 0.52 * S, 0.22 * S, 0.08 * S, 1), [x * S, -0.02 * S, 3.06 * S]);
    nacelle(x * S);
  }
  ke.bake(g);

  /* THE LAMP is the same anchor the clone ship publishes and it is under the
   * nose for the same reason: it is what the ground is lit by on the way in. */
  const lamp = new THREE.Object3D();
  lamp.name = 'lamp';
  lamp.position.set(0, -0.70 * S, -3.20 * S);
  g.add(lamp);

  g.userData.engines = engines;
  g.userData.lamp = lamp;
  g.userData.turret = turret;
  g.userData.side = 'separatist';
  const bs = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  g.userData.span = bs.x;
  g.userData.length = bs.z;
  g.userData.height = bs.y;
  /* THE TEMPLATE IS NEVER HANDED OUT — see `buildRepublicTransport`, where the
   * same line cost eight permanent exhaust cones on every hull in the game. The
   * first caller gets a clone of it like everybody else. */
  if (S === 1 && !opts.fresh) { _hmpTemplate = g; return buildDroidGunship(opts); }
  return g;
}

/**
 * WHICH GUNSHIP AN ARMY SENDS. The same seam, the same table shape and the same
 * fallback as `TRANSPORT_BY_SIDE` — see the note there.
 */
export const GUNSHIP_BY_SIDE = {
  republic: buildGunship,
  separatist: buildDroidGunship,
};

/** The gunship the given army flies. Registered by `Levels.js`. */
export function buildSideGunship(opts = {}) { return hullFor(GUNSHIP_BY_SIDE, opts.side)(opts); }

/* ══════════════════════════════════════════════════════════════════════ */
/*  The transport — the one ship the player is INSIDE                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE TROOP TRANSPORT, REBUILT — and why the last one had to go.
 *
 * The player, on the fourth pass over this one object, and it is the whole of
 * the brief:
 *
 *   "I want you to redo the transport ships especially the jedi transport one
 *    as it still looks like it's made of paper mache and barely held together,
 *    like for something that you see so closely in landing and leaving scenes
 *    it should really be wayyyyyy more detailed and put together and less
 *    janky looking, like you have good image references. Nothing is
 *    connected, there are no pilots, no real functioning seat, like it looks
 *    like a wooden plank ship held together with rope that is more fitting to
 *    be used as a liferaft than an interstellar battle/transport ship… if you
 *    want to trash it build something new go ahead… it needs to be way more
 *    detailed and put together inside and out."
 *
 * Every clause of that was true of the previous hull, and each for a reason
 * that can be named:
 *
 *   "NOTHING IS CONNECTED." The side walls were two thin rails, one above and
 *     one below the door line, running the full length of the bay — so the
 *     wall was OPEN for a metre fore and a metre aft of the door on both
 *     sides, and the roof, the floor and the nose met only where their rounded
 *     corners happened to overlap. The wings were flat boards bolted to the
 *     roof edge; the nacelles hung under them on a single pylon; the cheek
 *     turrets were dark balls on nothing.
 *   "THERE ARE NO PILOTS." There were two, at z -3.10 — INSIDE the nose block,
 *     under an opaque canopy plate. Nothing on the outside could see them and
 *     nothing on the inside could either, so as far as the player is concerned
 *     they did not exist.
 *   "NO REAL FUNCTIONING SEAT." Six pans and six backs with no frame under
 *     them, floating 5 cm off the wall at the height `Extraction._seat` sits a
 *     body: the seat was where the table said, and the geometry was a
 *     suggestion of one.
 *
 * So this is a new hull, built against the LAAT/i references in
 * `assets/reference/vehicles/` — the cutaway with the troops inside, the flank
 * shot on Geonosis and the head-on — and it takes the reference's own answer
 * to every one of those lines:
 *
 *   A CONNECTED FUSELAGE. Floor, roof, full-height side walls FORE and AFT of
 *     the door aperture (the aperture is now exactly the door, 2.3 m, and
 *     nothing else is open), a forward bulkhead, an aft frame with a header,
 *     a tail roof over the closed ramp, and a nose that is one lofted block
 *     with a chin under it — each piece overlapping its neighbour by more than
 *     its own corner radius, so there is no seam the light gets through.
 *   A COCKPIT YOU CAN SEE INTO. The LAAT/i's tandem cockpit sits ON TOP of the
 *     nose under a maroon frame, and the glazing is a real transparent
 *     material (`canopy`, below) rather than a tinted plate — so the two
 *     pilots in it, one behind the other on the centreline, are visible from
 *     the pad, from the deck and from the bay door.
 *   THE TWO BUBBLE TURRETS, on outriggers off the forward bay wall, each a
 *     glass sphere with a gunner sitting in it and a composite-beam barrel out
 *     the front — the reference's most recognisable feature after the wings,
 *     and the last thing the player would look for.
 *   REAL SEATS. Six fold-down places on a continuous seat rail with legs to
 *     the deck, each with its own pan, back, headrest, divider and harness, AT
 *     the positions `userData.seats` publishes — the table and the geometry
 *     are derived from the same numbers, so a body sits on a pan rather than
 *     near one. Four standing places on the centreline under an overhead rail
 *     with straps, as the cutaway shows the stick riding.
 *   WINGS THAT CARRY THINGS. The wing is `wingGeo` (tapered, swept, with
 *     anhedral) rooted in a fairing that grows out of the roof, with the
 *     mass-driver pod on top of the root, a rocket rack under it, and a
 *     bubble turret at the tip — and the four engines are in two nacelles
 *     built INTO the wing root against the fuselage, with their intakes
 *     forward and four nozzles aft, rather than slung under the wing on a
 *     stick.
 *
 * ── THE CONTRACT DID NOT MOVE ──────────────────────────────────────────────
 *
 * `ExtractionDirector`, `DeckFlight` and `Arrivals` drive this ship through
 * `userData.{engines,lamp,ramp,doorL,doorR,bay,seats,span,length,height,side}`
 * and read nothing else. Every one of those is published with the same
 * meaning and comparable numbers: the bay is 2.6 m wide and 2.1 m tall with
 * the floor at -0.95 (the ramp's hinge, which `_hatch` and `hullFloorAt` both
 * derive their angle from); the ramp leaf is 2.6 m (the constant both of
 * them walk a body up); the doors slide 2.0 m aft on rails and clear the
 * aperture in that travel; the four engine anchors are at the stern; the
 * seat table is six benches and four standing places, in that order, so a
 * Sith's tenth trooper still boards when a Jedi's does. `tools/checks/
 * hulls.mjs` holds every one of those to the geometry, and
 * `tools/checks/transports.mjs` still holds the two hulls apart.
 */
let _transportTemplate = null;

function transportMaterials() {
  if (_transportM) return _transportM;
  return (_transportM = {
    /* THE PAINT IS THE REFERENCE'S: a bone-white shell that has been to
     * Geonosis, maroon on the cockpit cowl, the pods and the wing bands, an
     * olive wash low on the nose, and dark grey everywhere the machinery
     * shows. The shell is held cooler and darker than the sand it lands on
     * for the reason the last hull's note gave — it is the one thing that
     * separates a silhouette from the ground under an orange key. */
    shell: armorMat(0xa3a59d, 0.10, 0.58, 5.2),
    panel: armorMat(0x858a89, 0.12, 0.54, 5.8),
    mark: armorMat(0x7d2a25, 0.06, 0.62, 6.0),
    dark: metalMat(0x2b2d31, 0.5, 0.9, 5.4),
    deck: metalMat(0x44474c, 0.42, 0.85, 6.2),
    belly: armorMat(0x76784a, 0.05, 0.72, 4.8),
    cloth: armorMat(0x2c2f36, 0.04, 0.8, 6.0),
    skin: armorMat(0xb98d6a, 0.03, 0.85, 5.0),
    /* THE CANOPY IS TRANSPARENT, which `glassMat` is not — that is an opaque
     * dark metal with a gloss on it, right for a droid's photoreceptor and
     * wrong for a window you are meant to see two pilots through. One
     * material, so every pane and both bubble turrets are a single draw
     * call; `depthWrite` off so the pilots draw through it whatever the
     * order. */
    canopy: new THREE.MeshStandardMaterial({ color: 0x8fb4c4, transparent: true, opacity: 0.38,
      roughness: 0.08, metalness: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    lamp: emissiveMat(0xffd9a0, 1.5),
    greeble: metalMat(0x5b5348, 0.55, 0.7, 2.0),
    white: armorMat(0xd9d7cc, 0.05, 0.6, 5.0),
  });
}
let _transportM = null;

/**
 * One seated pilot: a clone in armour, seen through the canopy from the pad
 * and through the bay door. A torso, a helmet with a visor, two arms on the
 * stick, two thighs to the pedals — enough to read as a man in a seat at the
 * range he is seen from, and cheap enough to put four of them on the ship.
 */
function pilotBody(M, s = 1) {
  const g = new THREE.Group();
  const k = new Kit();
  k.add(M.white, plateGeo(0.44 * s, 0.50 * s, 0.30 * s, 0.06 * s, 1), [0, 0.30 * s, 0]);
  k.add(M.cloth, plateGeo(0.40 * s, 0.24 * s, 0.44 * s, 0.06 * s, 1), [0, 0.02 * s, 0.14 * s]);
  // thighs forward to the pedals
  k.pair((sx) => k.add(M.white, plateGeo(0.16 * s, 0.14 * s, 0.50 * s, 0.04 * s, 1), [sx * 0.12 * s, 0.02 * s, -0.20 * s]));
  // the helmet, with its visor and the fin
  k.add(M.white, new THREE.SphereGeometry(0.155 * s, 10, 8), [0, 0.66 * s, 0.01 * s]);
  k.add(M.dark, plateGeo(0.26 * s, 0.11 * s, 0.16 * s, 0.03 * s, 1), [0, 0.65 * s, -0.11 * s]);
  k.add(M.white, plateGeo(0.04 * s, 0.10 * s, 0.22 * s, 0.01 * s, 1), [0, 0.80 * s, 0.02 * s]);
  // both arms forward onto the stick
  k.pair((sx) => {
    k.add(M.white, new THREE.CylinderGeometry(0.055 * s, 0.05 * s, 0.40 * s, 6),
      [sx * 0.22 * s, 0.36 * s, -0.16 * s], [1.15, 0, 0]);
    k.add(M.dark, new THREE.SphereGeometry(0.055 * s, 7, 6), [sx * 0.22 * s, 0.30 * s, -0.34 * s]);
  });
  k.add(M.dark, new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.30 * s, 5), [0, 0.20 * s, -0.36 * s], [0.3, 0, 0]);
  k.bake(g);
  return g;
}

/**
 * A crew seat — the pilots' and the gunners'. A pan, a back canted a little,
 * a headrest, and a pedestal to the floor, so a body has something under it.
 */
function crewSeat(k, M, x, y, z, s = 1) {
  k.add(M.dark, plateGeo(0.50 * s, 0.08 * s, 0.48 * s, 0.03 * s, 1), [x, y, z]);
  k.add(M.dark, plateGeo(0.48 * s, 0.70 * s, 0.10 * s, 0.03 * s, 1), [x, y + 0.36 * s, z + 0.24 * s], [-0.12, 0, 0]);
  k.add(M.cloth, plateGeo(0.26 * s, 0.16 * s, 0.10 * s, 0.03 * s, 1), [x, y + 0.78 * s, z + 0.30 * s], [-0.12, 0, 0]);
  k.add(M.dark, plateGeo(0.22 * s, 0.30 * s, 0.22 * s, 0.03 * s, 1), [x, y - 0.18 * s, z]);
}

export function buildRepublicTransport(opts = {}) {
  const S = opts.scale ?? 1.0;
  if (S === 1 && _transportTemplate && !opts.fresh) {
    const c = _transportTemplate.clone(true);
    c.userData = {
      ..._transportTemplate.userData,
      engines: (_transportTemplate.userData.engines || []).map((e) => c.getObjectByName(e.name)),
      ramp: c.getObjectByName('ramp'),
      doorL: c.getObjectByName('doorL'),
      doorR: c.getObjectByName('doorR'),
      lamp: c.getObjectByName('lamp'),
    };
    return c;
  }
  const M = transportMaterials();
  const g = new THREE.Group();
  g.name = 'transport';

  /* THE BAY, in the ship's own space. −Z is FORWARD for every craft in this
   * file, so the ramp is at +Z and the cockpit at −Z. 2.6 m wide, 2.1 m tall,
   * floor at -0.95 — the hinge height `_hatch` and `hullFloorAt` derive the
   * ramp's angle from. */
  const BAY = { halfW: 1.30, floor: -0.95, roof: 1.15, front: -1.60, back: 3.30 };
  const WALL = 1.38;   // the side walls' centreline; the doors ride outboard of it

  /* ══ THE FUSELAGE — one connected shell ══════════════════════════════ */
  const kf = new Kit();
  const waist = (k, pow = 1.6) => (t) => ({ a: 1 - k * Math.abs(2 * t - 1) ** pow });
  // floor and roof slabs, the full length of the bay and a little beyond
  kf.add(M.deck, loftGeo(plateGeo(2.96 * S, 0.24 * S, 5.30 * S, 0.06 * S, 5), 5.30 * S, 'z', 1, waist(0.06)),
    [0, (BAY.floor - 0.12) * S, 0.85 * S]);
  kf.add(M.shell, loftGeo(plateGeo(3.04 * S, 0.30 * S, 5.30 * S, 0.08 * S, 5), 5.30 * S, 'z', 1, waist(0.08)),
    [0, (BAY.roof + 0.15) * S, 0.85 * S]);
  kf.pair((sx) => {
    /* THE SIDE WALLS, and they are walls now: full height forward of the door
     * and aft of it, and above and below the aperture between. The aperture
     * is the door's own 2.30 m at z -0.30..2.00 — nothing else is open. */
    kf.add(M.shell, plateGeo(0.18 * S, 2.30 * S, 1.50 * S, 0.05 * S, 1), [sx * WALL * S, 0.10 * S, -1.05 * S]);
    kf.add(M.shell, plateGeo(0.18 * S, 2.30 * S, 1.55 * S, 0.05 * S, 1), [sx * WALL * S, 0.10 * S, 2.78 * S]);
    kf.add(M.shell, plateGeo(0.18 * S, 0.36 * S, 2.50 * S, 0.05 * S, 1), [sx * WALL * S, (BAY.roof - 0.02) * S, 0.85 * S]);
    kf.add(M.shell, plateGeo(0.18 * S, 0.34 * S, 2.50 * S, 0.05 * S, 1), [sx * WALL * S, (BAY.floor + 0.02) * S, 0.85 * S]);
    // the door frame — a jamb each end and the sill, in the dark tone
    kf.add(M.dark, plateGeo(0.22 * S, 2.10 * S, 0.12 * S, 0.02 * S, 1), [sx * WALL * S, 0.10 * S, -0.36 * S]);
    kf.add(M.dark, plateGeo(0.22 * S, 2.10 * S, 0.12 * S, 0.02 * S, 1), [sx * WALL * S, 0.10 * S, 2.06 * S]);
    kf.add(M.dark, plateGeo(0.26 * S, 0.08 * S, 2.40 * S, 0.02 * S, 1), [sx * WALL * S, (BAY.floor + 0.14) * S, 0.85 * S]);
    // the rails the door rides, top and bottom, outboard of the wall
    kf.add(M.dark, plateGeo(0.10 * S, 0.10 * S, 4.70 * S, 0.02 * S, 1), [sx * 1.52 * S, (BAY.roof + 0.04) * S, 1.60 * S]);
    kf.add(M.dark, plateGeo(0.10 * S, 0.10 * S, 4.70 * S, 0.02 * S, 1), [sx * 1.52 * S, (BAY.floor - 0.04) * S, 1.60 * S]);
    // the belt line and the roof strake, which give the flank a scale
    kf.add(M.panel, plateGeo(0.06 * S, 0.24 * S, 5.10 * S, 0.02 * S, 1), [sx * 1.48 * S, 1.02 * S, 0.85 * S]);
    kf.add(M.panel, plateGeo(0.56 * S, 0.06 * S, 4.80 * S, 0.02 * S, 1), [sx * 0.90 * S, (BAY.roof + 0.32) * S, 0.85 * S]);
    // a Republic roundel aft of the door
    kf.add(M.mark, new THREE.CylinderGeometry(0.26 * S, 0.26 * S, 0.03 * S, 14), [sx * 1.48 * S, 0.30 * S, 2.80 * S], [0, 0, 1.5708]);
    kf.add(M.shell, new THREE.CylinderGeometry(0.16 * S, 0.16 * S, 0.02 * S, 12), [sx * 1.50 * S, 0.30 * S, 2.80 * S], [0, 0, 1.5708]);
  });
  // the roof spine in maroon, and the cross seams
  kf.add(M.mark, plateGeo(0.44 * S, 0.06 * S, 4.90 * S, 0.02 * S, 1), [0, (BAY.roof + 0.32) * S, 0.85 * S]);
  kf.row(6, (i, t) => kf.add(M.dark, plateGeo(2.80 * S, 0.03 * S, 0.06 * S, 0.01 * S, 1), [0, (BAY.roof + 0.31) * S, (-1.30 + t * 4.30) * S]));
  // the forward bulkhead — the wall between the bay and the cockpit
  kf.add(M.shell, plateGeo(2.94 * S, 2.34 * S, 0.18 * S, 0.05 * S, 1), [0, 0.10 * S, -1.70 * S]);
  // the aft frame: a header over the ramp opening and a post each side
  kf.add(M.shell, plateGeo(2.94 * S, 0.44 * S, 0.22 * S, 0.05 * S, 1), [0, 0.96 * S, 3.42 * S]);
  kf.pair((sx) => kf.add(M.shell, plateGeo(0.30 * S, 2.30 * S, 0.22 * S, 0.05 * S, 1), [sx * 1.32 * S, 0.10 * S, 3.42 * S]));

  /* THE TAIL: a roof over the closed ramp, tapering aft, so the leaf reads as
   * the floor of a tail section and not as a plank sticking out of a box.
   * The rear anti-personnel turret hangs under it. */
  kf.add(M.shell, loftGeo(plateGeo(2.96 * S, 1.00 * S, 2.40 * S, 0.12 * S, 4), 2.40 * S, 'z', 1,
    (t) => ({ a: 1 - 0.30 * t, b: 1 - 0.55 * t, db: 0.24 * t * S })), [0, 0.72 * S, 4.50 * S]);
  kf.pair((sx) => kf.add(M.panel, plateGeo(0.30 * S, 0.60 * S, 1.60 * S, 0.06 * S, 1), [sx * 1.30 * S, 0.30 * S, 4.10 * S]));
  kf.add(M.dark, new THREE.SphereGeometry(0.22 * S, 10, 8), [0, 0.02 * S, 5.30 * S]);
  kf.add(M.dark, new THREE.CylinderGeometry(0.04 * S, 0.05 * S, 0.70 * S, 6), [0, 0.02 * S, 5.70 * S], [1.5708, 0, 0]);

  /* THE NOSE — one block, lofted to a chisel, with the chin under it. The
   * LAAT/i's face is a wide blunt bow with the two anti-personnel cannon in
   * round sockets low on it; the cockpit sits on top. */
  const rake = (w, h, dy = 0) => (t) => ({ a: 1 - (1 - w) * (1 - t), b: 1 - (1 - h) * (1 - t), db: -dy * (1 - t) * S });
  kf.add(M.shell, loftGeo(plateGeo(2.96 * S, 2.10 * S, 3.10 * S, 0.24 * S, 4), 3.10 * S, 'z', 1, rake(0.80, 0.84, 0.10)),
    [0, 0.02 * S, -3.25 * S]);
  kf.add(M.belly, loftGeo(plateGeo(2.36 * S, 1.24 * S, 2.00 * S, 0.30 * S, 4), 2.00 * S, 'z', 1, rake(0.60, 0.64, 0.06)),
    [0, -0.52 * S, -5.50 * S]);
  kf.add(M.shell, loftGeo(plateGeo(2.00 * S, 0.70 * S, 1.60 * S, 0.24 * S, 4), 1.60 * S, 'z', 1, rake(0.70, 0.80)),
    [0, 0.44 * S, -5.10 * S]);
  // the two cannon sockets in the bow, and the barrels out of them
  kf.pair((sx) => {
    kf.add(M.dark, new THREE.CylinderGeometry(0.34 * S, 0.34 * S, 0.30 * S, 14), [sx * 0.70 * S, -0.48 * S, -6.32 * S], [1.5708, 0, 0]);
    kf.add(M.panel, new THREE.TorusGeometry(0.36 * S, 0.05 * S, 6, 16), [sx * 0.70 * S, -0.48 * S, -6.42 * S]);
    kf.add(M.dark, new THREE.SphereGeometry(0.22 * S, 10, 8), [sx * 0.70 * S, -0.48 * S, -6.40 * S]);
    kf.add(M.dark, new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 1.00 * S, 8), [sx * 0.70 * S, -0.48 * S, -7.00 * S], [1.5708, 0, 0]);
    kf.add(M.greeble, new THREE.CylinderGeometry(0.08 * S, 0.08 * S, 0.14 * S, 8), [sx * 0.70 * S, -0.48 * S, -7.44 * S], [1.5708, 0, 0]);
    // the nose cheek: a sensor blister and the olive wash panel
    kf.add(M.belly, plateGeo(0.10 * S, 0.60 * S, 1.30 * S, 0.06 * S, 2), [sx * 1.32 * S, -0.30 * S, -3.60 * S]);
    kf.add(M.dark, new THREE.SphereGeometry(0.12 * S, 8, 6), [sx * 1.12 * S, 0.66 * S, -3.90 * S]);
  });
  // a spotlight recess under the chin, where the landing lamp anchor sits
  kf.add(M.dark, new THREE.CylinderGeometry(0.16 * S, 0.16 * S, 0.10 * S, 10), [0, -1.06 * S, -4.90 * S]);

  /* THE COCKPIT HUMP, on top of the nose: a maroon cowl with the glazing let
   * into it, the LAAT/i's tandem cockpit. The frame is opaque, the panes are
   * `canopy`, and the two pilots sit under them one behind the other. */
  kf.add(M.mark, loftGeo(plateGeo(1.90 * S, 0.30 * S, 2.60 * S, 0.10 * S, 4), 2.60 * S, 'z', 1, rake(0.80, 1.0)),
    [0, 1.16 * S, -3.05 * S]);                                                            // the sill
  kf.pair((sx) => kf.add(M.mark, plateGeo(0.12 * S, 0.12 * S, 1.96 * S, 0.03 * S, 1), [sx * 0.82 * S, 2.00 * S, -2.92 * S]));  // roof rails
  kf.add(M.mark, plateGeo(1.70 * S, 0.10 * S, 0.10 * S, 0.03 * S, 1), [0, 2.00 * S, -2.98 * S]);   // the hoop between the seats
  kf.add(M.mark, plateGeo(1.86 * S, 0.80 * S, 0.16 * S, 0.05 * S, 1), [0, 1.62 * S, -1.98 * S]);   // the rear wall
  kf.pair((sx) => {
    kf.add(M.mark, plateGeo(0.10 * S, 0.70 * S, 0.14 * S, 0.03 * S, 1), [sx * 0.86 * S, 1.66 * S, -3.90 * S], [0.30, 0, 0]);  // A pillar
    kf.add(M.mark, plateGeo(0.10 * S, 0.74 * S, 0.12 * S, 0.03 * S, 1), [sx * 0.88 * S, 1.66 * S, -2.95 * S]);               // B pillar
  });
  kf.add(M.mark, plateGeo(1.60 * S, 0.10 * S, 0.10 * S, 0.03 * S, 1), [0, 1.98 * S, -3.86 * S]);   // windscreen header
  kf.bake(g, { silhouette: true });

  /* the panes, one transparent draw call for the whole ship */
  const kc = new Kit();
  kc.add(M.canopy, plateGeo(1.66 * S, 0.74 * S, 0.05 * S, 0.02 * S, 1), [0, 1.62 * S, -4.02 * S], [0.30, 0, 0]);
  kc.pair((sx) => kc.add(M.canopy, plateGeo(0.05 * S, 0.66 * S, 1.80 * S, 0.02 * S, 1), [sx * 0.90 * S, 1.64 * S, -2.98 * S]));
  kc.add(M.canopy, plateGeo(1.66 * S, 0.05 * S, 1.80 * S, 0.02 * S, 1), [0, 1.96 * S, -2.98 * S]);

  /* ══ THE BUBBLE TURRETS, on outriggers off the forward bay wall ══════ */
  const kt = new Kit();
  kt.pair((sx) => {
    const tx = sx * 2.10 * S, ty = -0.10 * S, tz = -1.10 * S;
    // the outrigger: a spar from the wall, a yoke, and the trunnions
    kt.add(M.panel, plateGeo(0.80 * S, 0.22 * S, 0.34 * S, 0.04 * S, 1), [sx * 1.72 * S, 0.34 * S, tz]);
    kt.add(M.dark, plateGeo(0.18 * S, 0.62 * S, 0.22 * S, 0.03 * S, 1), [sx * 2.10 * S, 0.14 * S, tz]);
    kt.add(M.dark, new THREE.TorusGeometry(0.58 * S, 0.045 * S, 6, 18), [tx, ty, tz], [0, 0, 0]);
    kt.add(M.dark, new THREE.TorusGeometry(0.58 * S, 0.045 * S, 6, 18), [tx, ty, tz], [0, 1.5708, 0]);
    kt.add(M.dark, new THREE.TorusGeometry(0.58 * S, 0.045 * S, 6, 18), [tx, ty, tz], [1.5708, 0, 0]);
    // the gun: a breech in the ball and the composite-beam barrel out the front
    kt.add(M.greeble, plateGeo(0.22 * S, 0.22 * S, 0.50 * S, 0.04 * S, 1), [tx, (ty - 0.10) * S, tz - 0.40 * S]);
    kt.add(M.dark, new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 1.40 * S, 8), [tx, ty - 0.10 * S, tz - 1.20 * S], [1.5708, 0, 0]);
    kt.add(M.greeble, new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 0.16 * S, 8), [tx, ty - 0.10 * S, tz - 1.84 * S], [1.5708, 0, 0]);
    // the gunner's seat, in the ball, and a floor plate under him
    crewSeat(kt, M, tx, ty - 0.40 * S, tz + 0.08 * S, 0.80);
    kc.add(M.canopy, new THREE.SphereGeometry(0.60 * S, 16, 12), [tx, ty, tz]);
  });
  kt.bake(g, { silhouette: true });
  for (const sx of [1, -1]) {
    const p = pilotBody(M, 0.78 * S);
    p.position.set(sx * 2.10 * S, -0.48 * S, -1.02 * S);
    p.name = sx > 0 ? 'gunnerL' : 'gunnerR';
    g.add(p);
  }

  /* ══ WINGS, PODS, NACELLES ═══════════════════════════════════════════ */
  const kw = new Kit();
  kw.pair((sx) => {
    /* THE WING is `wingGeo`: tapered to 46% at the tip, the trailing edge
     * straight so the leading edge sweeps, 0.14 rad of anhedral. It roots in
     * a fairing that grows out of the roof strake — a wing that meets the
     * hull through a fillet reads as bolted on; one that meets it through a
     * fairing reads as built. */
    const WCH = 3.00, WSP = 4.90, WSW = wingSweep(WCH);
    const WROOT = [sx * 3.50 * S, 1.26 * S, 0.95 * S];
    /* 0.30 rad of anhedral — the head-on plate has the tips well below the
     * roots, and it is also what keeps this wing out of the band the droid
     * shuttle's elytra rise through. */
    const wr = [0, sx * -0.22, sx * -0.30];
    const _wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(wr[0], wr[1], wr[2], 'XYZ'));
    const onWing = (u, v, w) => {
      const q = new THREE.Vector3(sx * u * S, v * S, w * S).applyQuaternion(_wq);
      return [WROOT[0] + q.x, WROOT[1] + q.y, WROOT[2] + q.z];
    };
    kw.add(M.shell, wingGeo(WSP * S, WCH * S, 0.36 * S, sx), WROOT, wr);
    // the root fairing, on the roof, and the wing's maroon band
    kw.add(M.shell, loftGeo(plateGeo(1.50 * S, 0.62 * S, 3.40 * S, 0.14 * S, 4), 1.50 * S, 'x', sx,
      (t) => ({ a: 1 - 0.30 * t, b: 1 - 0.20 * t })), [sx * 1.80 * S, 1.30 * S, 0.95 * S]);
    kw.add(M.mark, loftGeo(plateGeo(4.20 * S, 0.05 * S, 0.44 * S, 0.02 * S, 5), 4.20 * S, 'x', sx,
      (t) => ({ b: 1 - 0.35 * t, db: 0.70 * WSW * S * t })), onWing(0, 0.19, -0.55), wr);
    kw.add(M.dark, loftGeo(plateGeo(WSP * S, 0.10 * S, 0.24 * S, 0.04 * S, 5), WSP * S, 'x', sx,
      (t) => ({ a: 1 - 0.5 * t, b: 1 - 0.35 * t, db: WSW * S * t })), onWing(0, 0, -1.42), wr);
    kw.add(M.dark, plateGeo(0.13 * S, 0.16 * S, 1.30 * S, 0.03 * S, 1), onWing(1.50, 0.08, WSW * 0.40), wr);
    kw.add(M.mark, plateGeo(0.16 * S, 0.09 * S, 0.16 * S, 0.02 * S, 1), onWing(2.38, 0.02, WSW * 0.56), wr);
    // the wingtip bubble turret, rear-facing
    const tip = onWing(2.36, -0.06, WSW * 0.30 + 0.30);
    kw.add(M.dark, new THREE.SphereGeometry(0.26 * S, 10, 8), tip);
    kc.add(M.canopy, new THREE.SphereGeometry(0.34 * S, 12, 10), tip);
    kw.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.035 * S, 0.70 * S, 6), [tip[0], tip[1], tip[2] + 0.55 * S], [1.5708, 0, 0]);

    /* THE MASS-DRIVER POD, on top of the wing root: the reference's long
     * maroon-and-bone cylinder with the pointed nose forward. */
    const px = sx * 1.50 * S, py = 1.82 * S;
    kw.add(M.mark, new THREE.CylinderGeometry(0.36 * S, 0.36 * S, 5.20 * S, 14), [px, py, -0.40 * S], [1.5708, 0, 0]);
    kw.add(M.shell, new THREE.CylinderGeometry(0.37 * S, 0.37 * S, 0.60 * S, 14), [px, py, -1.40 * S], [1.5708, 0, 0]);
    kw.add(M.shell, new THREE.CylinderGeometry(0.37 * S, 0.37 * S, 0.40 * S, 14), [px, py, 1.20 * S], [1.5708, 0, 0]);
    kw.add(M.shell, new THREE.CylinderGeometry(0.10 * S, 0.36 * S, 1.50 * S, 14), [px, py, -3.75 * S], [1.5708, 0, 0]);
    kw.add(M.dark, new THREE.CylinderGeometry(0.30 * S, 0.34 * S, 0.30 * S, 14), [px, py, 2.30 * S], [1.5708, 0, 0]);
    kw.add(M.panel, plateGeo(0.44 * S, 0.30 * S, 2.60 * S, 0.06 * S, 1), [px, py - 0.34 * S, 0.60 * S]);   // its saddle onto the fairing
    kw.add(M.panel, plateGeo(0.30 * S, 0.40 * S, 0.50 * S, 0.05 * S, 1), [px, py - 0.40 * S, -2.60 * S]);  // and its strut onto the nose

    /* THE NACELLE, built into the wing root against the bay wall: the intake
     * forward, the housing under the wing, four nozzles aft in two pairs. This
     * is where "I don't see any engines working" is answered — the anchors
     * below sit in these holes, and the flare the director hangs on them
     * comes out of a shaped nozzle in a housing that is attached to the ship. */
    /* AT THE WING ROOT, above the bay's roof line — the cutaway puts the
     * turbines in the thick inner wing, over the bay, and a nacelle beside
     * the door would be a wall 30 cm outside the aperture the player is
     * meant to see out of. Its underside clears the door head. */
    const nx = sx * 2.05 * S, ny = 1.16 * S;
    kw.add(M.shell, loftGeo(plateGeo(1.20 * S, 0.96 * S, 2.80 * S, 0.18 * S, 4), 2.80 * S, 'z', 1,
      (t) => ({ a: 0.86 + 0.14 * t, b: 0.90 + 0.10 * t })), [nx, ny, 2.20 * S]);
    kw.add(M.dark, plateGeo(1.00 * S, 0.74 * S, 0.24 * S, 0.10 * S, 1), [nx, ny, 0.76 * S]);               // the intake
    kw.add(M.panel, plateGeo(1.06 * S, 0.10 * S, 0.30 * S, 0.03 * S, 1), [nx, ny, 0.76 * S]);               // its splitter
    kw.add(M.panel, plateGeo(1.24 * S, 1.00 * S, 0.14 * S, 0.06 * S, 1), [nx, ny, 3.54 * S]);               // the aft face
    for (const oy of [0.24, -0.24]) {
      kw.add(M.dark, new THREE.CylinderGeometry(0.21 * S, 0.25 * S, 0.40 * S, 10), [nx, ny + oy * S, 3.72 * S], [1.5708, 0, 0]);
      kw.add(M.greeble, new THREE.TorusGeometry(0.24 * S, 0.03 * S, 5, 12), [nx, ny + oy * S, 3.92 * S]);
    }
    kw.row(4, (i, t) => kw.add(M.dark, plateGeo(0.05 * S, 0.30 * S, 0.10 * S, 0.01 * S, 1),
      [sx * 2.67 * S, ny + 0.10 * S, (1.50 + t * 1.20) * S]));                                              // cooling louvres
    // the rocket rack under the wing, four tubes
    kw.add(M.panel, plateGeo(0.60 * S, 0.30 * S, 1.10 * S, 0.06 * S, 1), onWing(0.90, -0.30, -0.10), wr);
    kw.row(2, (i, t) => kw.add(M.dark, new THREE.CylinderGeometry(0.07 * S, 0.07 * S, 1.20 * S, 7),
      onWing(0.72 + t * 0.36, -0.40, -0.10), [1.5708 + wr[0], wr[1], wr[2]]));
  });
  // the landing gear: two struts a side with a fairing and a pad
  kw.pair((sx) => {
    for (const gz of [-2.80, 2.50]) {
      kw.add(M.panel, plateGeo(0.32 * S, 0.50 * S, 0.60 * S, 0.06 * S, 1), [sx * 1.10 * S, -1.30 * S, gz * S]);
      kw.add(M.dark, new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 0.80 * S, 7), [sx * 1.10 * S, -1.62 * S, gz * S]);
      kw.add(M.dark, plateGeo(0.50 * S, 0.12 * S, 0.66 * S, 0.03 * S, 1), [sx * 1.10 * S, -2.02 * S, gz * S]);
    }
  });
  kw.bake(g, { silhouette: true });
  kc.bake(g);

  /* ══ THE BAY YOU RIDE IN ═════════════════════════════════════════════ */
  const ki = new Kit();
  /* FRAMES: five hoops, header, posts and gussets. */
  /* FRAMES: six hoops — a header each, and posts on the four that stand
   * clear of the door aperture. A post across an open door is a bar across
   * the one view this ship exists for. */
  for (const [z0, posts] of [[-1.30, true], [-0.62, true], [0.30, false], [1.30, false], [2.35, true], [3.05, true]]) {
    const z = z0 * S;
    ki.add(M.dark, plateGeo(2.62 * S, 0.13 * S, 0.15 * S, 0.03 * S, 1), [0, (BAY.roof - 0.05) * S, z]);
    if (!posts) continue;
    ki.pair((sx) => {
      ki.add(M.dark, plateGeo(0.12 * S, 2.06 * S, 0.15 * S, 0.03 * S, 1), [sx * 1.28 * S, 0.08 * S, z]);
      ki.add(M.dark, plateGeo(0.11 * S, 0.26 * S, 0.26 * S, 0.02 * S, 1), [sx * 1.26 * S, (BAY.roof - 0.22) * S, z], [0, 0, sx * 0.5]);
    });
  }
  /* THE LIGHT: two strips either side of the spine in housings. */
  ki.pair((sx) => {
    ki.add(M.dark, plateGeo(0.30 * S, 0.10 * S, 4.20 * S, 0.02 * S, 1), [sx * 0.42 * S, (BAY.roof - 0.02) * S, 0.90 * S]);
    ki.add(M.lamp, plateGeo(0.20 * S, 0.05 * S, 4.00 * S, 0.01 * S, 1), [sx * 0.42 * S, (BAY.roof - 0.09) * S, 0.90 * S]);
  });
  /* THE WALLS: a conduit run at head height, avionics, a cell rack, a fire
   * bottle, and the inside of the door frame. */
  ki.pair((sx) => {
    ki.add(M.greeble, new THREE.CylinderGeometry(0.055 * S, 0.055 * S, 4.30 * S, 6), [sx * 1.22 * S, 0.66 * S, 0.90 * S], [1.5708, 0, 0]);
    ki.row(4, (i, t) => ki.add(M.dark, plateGeo(0.09 * S, 0.13 * S, 0.13 * S, 0.02 * S, 1), [sx * 1.22 * S, 0.66 * S, (-0.95 + t * 3.7) * S]));
    ki.add(M.greeble, plateGeo(0.16 * S, 0.34 * S, 0.52 * S, 0.03 * S, 1), [sx * 1.24 * S, 0.24 * S, -1.05 * S]);
    ki.add(M.mark, plateGeo(0.05 * S, 0.10 * S, 0.16 * S, 0.01 * S, 1), [sx * 1.32 * S, 0.32 * S, -1.05 * S]);
    ki.add(M.greeble, plateGeo(0.14 * S, 0.26 * S, 0.30 * S, 0.03 * S, 1), [sx * 1.25 * S, 0.30 * S, 2.55 * S]);
    ki.add(M.mark, new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 0.42 * S, 8), [sx * 1.20 * S, -0.05 * S, 2.95 * S], [0, 0, 1.5708]);
    // the grab bar beside the door, and the door's inner handle
    ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 1.40 * S, 6), [sx * 1.22 * S, 0.20 * S, -0.44 * S]);
    ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 1.40 * S, 6), [sx * 1.22 * S, 0.20 * S, 2.14 * S]);
  });

  /* THE SEATS — six, on a rail, at the published positions.
   *
   * `seatZ` is the one list both the table and the geometry are built from.
   * Each place is a pan and a canted back on a continuous rail with legs to
   * the deck, a headrest above, a divider between neighbours, and a harness
   * over the pan. A body `_seat` puts at (±0.86, floor + 0.55, z) sits ON the
   * pan, which is the whole of "no real functioning seat". */
  const seatZ = [-0.55, 0.80, 2.15];
  ki.pair((sx) => {
    ki.add(M.dark, plateGeo(0.08 * S, 0.08 * S, 4.10 * S, 0.02 * S, 1), [sx * 0.66 * S, -0.50 * S, 0.80 * S]);   // the front rail
    ki.add(M.dark, plateGeo(0.08 * S, 0.08 * S, 4.10 * S, 0.02 * S, 1), [sx * 1.12 * S, -0.50 * S, 0.80 * S]);   // the back rail
    for (const z0 of seatZ) {
      const z = z0 * S;
      ki.add(M.cloth, plateGeo(0.50 * S, 0.09 * S, 0.54 * S, 0.03 * S, 1), [sx * 0.89 * S, -0.44 * S, z]);            // pan
      ki.add(M.cloth, plateGeo(0.09 * S, 0.60 * S, 0.52 * S, 0.03 * S, 1), [sx * 1.18 * S, -0.10 * S, z], [0, 0, sx * 0.10]);  // back
      ki.add(M.dark, plateGeo(0.08 * S, 0.18 * S, 0.32 * S, 0.02 * S, 1), [sx * 1.22 * S, 0.30 * S, z]);             // headrest
      ki.add(M.dark, plateGeo(0.06 * S, 0.06 * S, 0.54 * S, 0.01 * S, 1), [sx * 0.66 * S, -0.40 * S, z]);            // pan lip
      ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.44 * S, 6), [sx * 0.68 * S, -0.72 * S, z]);   // leg
      ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.44 * S, 6), [sx * 1.12 * S, -0.72 * S, z]);   // leg
      ki.add(M.dark, plateGeo(0.44 * S, 0.30 * S, 0.04 * S, 0.01 * S, 1), [sx * 0.92 * S, -0.30 * S, z + 0.30 * S]);   // divider
      ki.add(M.cloth, plateGeo(0.03 * S, 0.46 * S, 0.05 * S, 0.005 * S, 1), [sx * 1.06 * S, -0.06 * S, z - 0.14 * S], [0.2, 0, sx * 0.12]);
      ki.add(M.cloth, plateGeo(0.03 * S, 0.46 * S, 0.05 * S, 0.005 * S, 1), [sx * 1.06 * S, -0.06 * S, z + 0.14 * S], [-0.2, 0, sx * 0.12]);
      ki.add(M.greeble, plateGeo(0.10 * S, 0.06 * S, 0.06 * S, 0.01 * S, 1), [sx * 1.06 * S, -0.30 * S, z]);          // the buckle
    }
    // the overhead rail a standing trooper holds, and the straps off it
    ki.add(M.dark, new THREE.CylinderGeometry(0.035 * S, 0.035 * S, 4.40 * S, 6), [sx * 0.50 * S, (BAY.roof - 0.18) * S, 0.90 * S], [1.5708, 0, 0]);
    ki.row(3, (i, t) => ki.add(M.dark, plateGeo(0.05 * S, 0.14 * S, 0.05 * S, 0.01 * S, 1), [sx * 0.50 * S, (BAY.roof - 0.10) * S, (-0.9 + t * 3.6) * S]));
    ki.row(5, (i, t) => ki.add(M.cloth, plateGeo(0.05 * S, 0.30 * S, 0.02 * S, 0.005 * S, 1), [sx * 0.50 * S, (BAY.roof - 0.36) * S, (-1.05 + t * 3.9) * S]));
  });
  /* THE FLOOR: tread strips and tie-down rings. */
  ki.row(9, (i, t) => ki.add(M.dark, plateGeo(1.20 * S, 0.02 * S, 0.07 * S, 0.005 * S, 1), [0, (BAY.floor + 0.02) * S, (-1.15 + t * 4.15) * S]));
  ki.pair((sx) => ki.row(4, (i, t) => ki.add(M.dark, new THREE.TorusGeometry(0.055 * S, 0.016 * S, 5, 8),
    [sx * 0.40 * S, (BAY.floor + 0.03) * S, (-0.85 + t * 3.5) * S], [1.5708, 0, 0])));
  /* THE FORWARD BULKHEAD, inside: a door to the cockpit, a console and a lamp. */
  ki.pair((sx) => ki.add(M.dark, plateGeo(0.34 * S, 1.42 * S, 0.10 * S, 0.03 * S, 1), [sx * 0.62 * S, -0.22 * S, -1.58 * S]));
  ki.add(M.dark, plateGeo(1.58 * S, 0.12 * S, 0.10 * S, 0.03 * S, 1), [0, 0.52 * S, -1.58 * S]);
  ki.add(M.panel, plateGeo(0.80 * S, 1.60 * S, 0.06 * S, 0.02 * S, 1), [0, -0.12 * S, -1.57 * S]);
  ki.add(M.greeble, plateGeo(0.50 * S, 0.30 * S, 0.10 * S, 0.02 * S, 1), [0.90 * S, 0.40 * S, -1.56 * S]);
  ki.add(M.lamp, plateGeo(0.10 * S, 0.10 * S, 0.03 * S, 0.01 * S, 1), [0.42 * S, 0.76 * S, -1.56 * S]);
  ki.add(M.lamp, plateGeo(0.10 * S, 0.10 * S, 0.03 * S, 0.01 * S, 1), [-0.42 * S, 0.76 * S, -1.56 * S]);
  ki.bake(g);

  /* ── the cockpit crew: two seats in tandem, two pilots in them ────── */
  const ks = new Kit();
  crewSeat(ks, M, 0, 1.08 * S, -3.50 * S, 0.92);
  crewSeat(ks, M, 0, 1.16 * S, -2.60 * S, 0.92);
  ks.add(M.dark, plateGeo(1.20 * S, 0.14 * S, 0.40 * S, 0.04 * S, 1), [0, 1.34 * S, -4.10 * S], [0.3, 0, 0]);   // the panel
  ks.add(M.dark, plateGeo(1.20 * S, 0.14 * S, 0.30 * S, 0.04 * S, 1), [0, 1.44 * S, -3.14 * S], [0.3, 0, 0]);
  ks.bake(g);
  /* THE NAMES ARE THE CONTRACT'S. `pilotL` is the front seat and `pilotR` the
   * rear — the LAAT/i seats its crew in tandem, and the two suites that look
   * for a crew ask for these two names. */
  for (const [name, z, y] of [['pilotL', -3.42, 1.10], ['pilotR', -2.52, 1.18]]) {
    const p = pilotBody(M, 0.92 * S);
    p.position.set(0, y * S, z * S);
    p.name = name;
    g.add(p);
  }

  /* ── the ramp. Its own group, hinged at the aft lip of the floor ───── */
  const ramp = new THREE.Group();
  ramp.name = 'ramp';
  ramp.position.set(0, (BAY.floor - 0.02) * S, BAY.back * S);
  {
    const kr = new Kit();
    kr.add(M.deck, plateGeo(2.60 * S, 0.16 * S, 2.60 * S, 0.05 * S, 1), [0, 0, 1.30 * S]);
    kr.row(6, (i, t) => kr.add(M.dark, plateGeo(2.30 * S, 0.05 * S, 0.10 * S, 0.01 * S, 1), [0, 0.10 * S, (0.32 + t * 2.0) * S]));
    kr.pair((sx) => {
      kr.add(M.dark, plateGeo(0.10 * S, 0.22 * S, 2.60 * S, 0.02 * S, 1), [sx * 1.25 * S, 0.10 * S, 1.30 * S]);
      kr.add(M.greeble, plateGeo(0.16 * S, 0.10 * S, 0.40 * S, 0.02 * S, 1), [sx * 1.10 * S, -0.10 * S, 0.30 * S]);   // hinge boss
    });
    kr.add(M.mark, plateGeo(2.20 * S, 0.02 * S, 0.12 * S, 0.005 * S, 1), [0, 0.09 * S, 2.50 * S]);
    kr.bake(ramp);
  }
  g.add(ramp);

  /* ── the two side doors, each its own group, sliding aft on the rails ─ */
  const doors = [];
  for (const sx of [1, -1]) {
    const d = new THREE.Group();
    d.name = sx > 0 ? 'doorL' : 'doorR';
    const kd = new Kit();
    const dx = sx * 1.50 * S;
    kd.add(M.shell, plateGeo(0.12 * S, 2.06 * S, 2.30 * S, 0.05 * S, 1), [dx, 0.10 * S, 0.85 * S]);
    kd.add(M.mark, plateGeo(0.05 * S, 0.30 * S, 1.60 * S, 0.02 * S, 1), [sx * 1.57 * S, 0.62 * S, 0.85 * S]);
    kd.add(M.dark, plateGeo(0.06 * S, 1.40 * S, 0.10 * S, 0.02 * S, 1), [sx * 1.57 * S, 0.10 * S, -0.20 * S]);
    kd.add(M.dark, plateGeo(0.06 * S, 1.40 * S, 0.10 * S, 0.02 * S, 1), [sx * 1.57 * S, 0.10 * S, 1.90 * S]);
    kd.add(M.dark, plateGeo(0.08 * S, 0.14 * S, 0.34 * S, 0.02 * S, 1), [sx * 1.58 * S, -0.20 * S, 1.70 * S]);
    kd.row(3, (i, t) => kd.add(M.dark, plateGeo(0.04 * S, 0.60 * S, 0.06 * S, 0.01 * S, 1), [sx * 1.57 * S, -0.30 * S, (0.20 + t * 1.30) * S]));
    // the door's carriers on the rails
    kd.add(M.dark, plateGeo(0.14 * S, 0.12 * S, 1.80 * S, 0.02 * S, 1), [sx * 1.52 * S, (BAY.roof + 0.04) * S, 0.85 * S]);
    kd.add(M.dark, plateGeo(0.14 * S, 0.12 * S, 1.80 * S, 0.02 * S, 1), [sx * 1.52 * S, (BAY.floor - 0.04) * S, 0.85 * S]);
    kd.bake(d);
    g.add(d);
    doors.push(d);
  }

  /* ── the engine anchors the director hangs its flares on ───────────── */
  const engines = [];
  for (const sx of [1, -1]) {
    for (const oy of [0.24, -0.24]) {
      const e = new THREE.Object3D();
      e.name = `engine${sx > 0 ? 'L' : 'R'}${oy > 0 ? 'U' : 'D'}`;
      e.position.set(sx * 2.05 * S, (1.16 + oy) * S, 3.94 * S);
      g.add(e);
      engines.push(e);
    }
  }
  const lamp = new THREE.Object3D();
  lamp.name = 'lamp';
  lamp.position.set(0, -1.12 * S, -4.90 * S);
  g.add(lamp);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), bs = new THREE.Vector3();
  bb.getSize(bs);
  g.userData.engines = engines;
  g.userData.lamp = lamp;
  g.userData.ramp = ramp;
  g.userData.doorL = doors[0];
  g.userData.doorR = doors[1];
  g.userData.bay = {
    halfW: BAY.halfW * S, floor: BAY.floor * S, roof: BAY.roof * S,
    front: BAY.front * S, back: BAY.back * S,
  };
  /* SEATS, BENCH FIRST AND THEN THE FLOOR — from the same `seatZ` the pans
   * were built at. Six on the benches facing inboard, four standing on the
   * centreline under the rail, in the order a real stick fills. */
  const seats = [];
  for (const z of seatZ) {
    for (const sx of [-1, 1]) {
      seats.push({ x: sx * 0.86 * S, y: (BAY.floor + 0.55) * S, z: z * S,
        yaw: sx < 0 ? Math.PI / 2 : -Math.PI / 2, sit: true });
    }
  }
  for (let i = 0; i < 4; i++) {
    seats.push({ x: (i % 2 ? 0.34 : -0.34) * S, y: (BAY.floor + 0.02) * S,
      z: (-0.9 + Math.floor(i / 2) * 1.5) * S, yaw: 0, sit: false });
  }
  g.userData.seats = seats;
  g.userData.span = bs.x;
  g.userData.length = bs.z;
  g.userData.height = bs.y;
  g.userData.side = 'republic';
  /* THE TEMPLATE IS NEVER HANDED OUT — see the note this replaced: the first
   * flight of a session was decorating the template's engine anchors, and
   * every hull after it cloned those cones. */
  if (S === 1 && !opts.fresh) { _transportTemplate = g; return buildRepublicTransport(opts); }
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The Confederacy's own hulls                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE DROID SHUTTLE — the Sheathipede-class, rebuilt to the same standard.
 *
 * The player's note above was aimed at "especially the jedi transport one",
 * and this ship had every one of the same faults one degree milder: five
 * arched plates with air between them for a roof, side walls open for a
 * metre either side of the door, and two droid pilots seated INSIDE the
 * snout's ellipsoid with the canopy pane buried in the same shell — nobody
 * could see them from anywhere.
 *
 * What it keeps is everything the last note argued for — see the silhouette
 * discussion `tools/checks/transports.mjs` still measures: the curved
 * carapace, the tall dorsal sail, the two elytra, the pincer legs and the
 * blind snout, because those are the five cues that keep this ship from
 * reading as the LAAT at four hundred metres. What changes is that each of
 * them is now BUILT rather than suggested:
 *
 *   THE CARAPACE IS ONE SHELL. A lofted elliptical arch (a real curved
 *     surface, tapering and tucking in over the tail) over a roof liner and
 *     the deck, with a matching belly arch under the floor — no plates, no
 *     gaps, and the inside of the hold is a liner you can stand under.
 *   THE WALLS ARE WALLS, full height fore and aft of the door, exactly as the
 *     Republic hull's, with the door riding outboard on rails.
 *   THE CANOPY IS A BLISTER, transparent, PROUD of the snout, and the two
 *     droid pilots sit up in it at a console where they can be seen — from
 *     the pad and through the forward bulkhead's port.
 *   THE HOLD IS A RACK. The six sitting places are cradles: a canted back
 *     plate, a pan, a shoulder clamp and a charging spine each, on a rail
 *     with legs, at the published seat positions. The stick this ship
 *     carries folds into them; the player sits in one.
 *
 * The contract is identical to the Republic hull's — the same eleven
 * `userData` names with the same meanings — for the reason the earlier note
 * gave: "functionally they should not be different".
 */
let _droidM = null;
function droidTransportMaterials() {
  if (_droidM) return _droidM;
  return (_droidM = {
    shell: armorMat(0x78827f, 0.09, 0.58, 5.2),
    panel: armorMat(0x616b69, 0.11, 0.55, 5.8),
    mark: armorMat(0xb9a077, 0.06, 0.64, 6.0),
    dark: metalMat(0x2b2e31, 0.5, 0.9, 5.4),
    deck: metalMat(0x3f4347, 0.44, 0.86, 6.2),
    lamp: emissiveMat(0x9fd0e0, 1.3),
    greeble: metalMat(0x4d5450, 0.55, 0.72, 2.0),
    canopy: new THREE.MeshStandardMaterial({ color: 0x9fd0d8, transparent: true, opacity: 0.36,
      roughness: 0.08, metalness: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    belly: armorMat(0x4c5450, 0.05, 0.74, 4.8),
    droid: metalMat(0x9a8560, 0.46, 0.88, 2.2),
    eye: emissiveMat(0xd83a2a, 2.6),
  });
}

/**
 * ONE SEATED DROID PILOT. A narrow drum torso, a long forward-raked skull on
 * a stalk neck, thin rod arms onto the console, and a lit photoreceptor band
 * — a B1's bones, at the scale of a man in a seat.
 */
function droidPilotBody(M, s = 1) {
  const g = new THREE.Group();
  const k = new Kit();
  k.add(M.droid, new THREE.CylinderGeometry(0.17 * s, 0.20 * s, 0.52 * s, 8), [0, 0.30 * s, 0]);
  k.add(M.dark, plateGeo(0.34 * s, 0.24 * s, 0.40 * s, 0.05 * s, 1), [0, 0.02 * s, 0.12 * s]);
  k.pair((sx) => k.add(M.droid, new THREE.CylinderGeometry(0.05 * s, 0.045 * s, 0.50 * s, 6), [sx * 0.12 * s, 0.02 * s, -0.20 * s], [1.5708, 0, 0]));
  k.add(M.dark, new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.16 * s, 6), [0, 0.62 * s, 0]);
  k.add(M.droid, plateGeo(0.19 * s, 0.17 * s, 0.46 * s, 0.05 * s, 1), [0, 0.72 * s, -0.10 * s], [0.34, 0, 0]);
  k.add(M.eye, plateGeo(0.13 * s, 0.05 * s, 0.05 * s, 0.01 * s, 1), [0, 0.70 * s, -0.30 * s]);
  k.pair((sx) => {
    k.add(M.droid, new THREE.CylinderGeometry(0.035 * s, 0.030 * s, 0.44 * s, 6), [sx * 0.20 * s, 0.34 * s, -0.16 * s], [1.18, 0, 0]);
    k.add(M.dark, new THREE.SphereGeometry(0.045 * s, 6, 5), [sx * 0.20 * s, 0.27 * s, -0.36 * s]);
  });
  k.bake(g);
  return g;
}

/**
 * A curved hull shell: an open elliptical arch of `arc` radians about the top
 * (or the bottom, `flip`), running `len` along z, with `taper(t)` scaling the
 * section and `droop(t)` lowering it toward t = 1 — the one thing a carapace
 * is that a stack of plates is not. Single-sided, so it wants a liner behind
 * it wherever it can be seen from inside.
 */
function shellGeo(rx, ry, len, arc, flip, taper, droop, seg = 18) {
  const gg = new THREE.CylinderGeometry(1, 1, len, seg, 6, true, Math.PI - arc / 2, arc);
  gg.rotateX(flip ? -Math.PI / 2 : Math.PI / 2);
  if (flip) gg.rotateY(Math.PI);
  const p = gg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getZ(i) / len + 0.5, 0, 1);
    const s = taper(t);
    p.setXYZ(i, p.getX(i) * rx * s, p.getY(i) * ry * s + droop(t), p.getZ(i));
  }
  gg.computeVertexNormals();
  return gg;
}

let _droidTemplate = null;

export function buildDroidTransport(opts = {}) {
  const S = opts.scale ?? 1.0;
  if (S === 1 && _droidTemplate && !opts.fresh) {
    const c = _droidTemplate.clone(true);
    c.userData = {
      ..._droidTemplate.userData,
      engines: (_droidTemplate.userData.engines || []).map((e) => c.getObjectByName(e.name)),
      ramp: c.getObjectByName('ramp'),
      doorL: c.getObjectByName('doorL'),
      doorR: c.getObjectByName('doorR'),
      lamp: c.getObjectByName('lamp'),
    };
    return c;
  }
  const M = droidTransportMaterials();
  const g = new THREE.Group();
  g.name = 'transport';

  const BAY = { halfW: 1.22, floor: -0.92, roof: 1.16, front: -2.30, back: 3.30 };
  const WALL = 1.34;
  const aft = (t, at = 0.64) => clamp((t - at) / (1 - at), 0, 1);

  /* ══ THE CARAPACE ════════════════════════════════════════════════════ */
  const kf = new Kit();
  // the upper shell, over the roof liner; it narrows toward both ends and
  // tucks in over the tail
  kf.add(M.shell, shellGeo(1.52 * S, 0.62 * S, 6.30 * S, 2.70, false,
    (t) => 1 - 0.14 * Math.abs(2 * t - 1) ** 1.6 - 0.22 * aft(t) ** 1.4,
    (t) => -0.30 * aft(t) ** 1.4 * S), [0, (BAY.roof + 0.02) * S, 0.50 * S]);
  kf.add(M.panel, plateGeo(2.74 * S, 0.14 * S, 6.10 * S, 0.05 * S, 4), [0, (BAY.roof + 0.07) * S, 0.50 * S]);   // the roof liner
  // the belly arch under the deck, lifting into a boat tail
  kf.add(M.belly, shellGeo(1.46 * S, 0.70 * S, 7.00 * S, 2.40, true,
    (t) => 1 - 0.22 * aft(t, 0.58) ** 1.3 - 0.12 * clamp((0.22 - t) / 0.22, 0, 1) ** 1.3,
    (t) => (0.44 * aft(t, 0.58) ** 1.5 + 0.16 * clamp((0.22 - t) / 0.22, 0, 1) ** 1.5) * S), [0, (BAY.floor - 0.10) * S, -0.10 * S]);
  kf.add(M.deck, loftGeo(plateGeo(2.90 * S, 0.22 * S, 5.90 * S, 0.06 * S, 5), 5.90 * S, 'z', 1,
    (t) => ({ a: 1 - 0.10 * Math.abs(2 * t - 1) ** 1.6 })), [0, (BAY.floor - 0.11) * S, 0.48 * S]);
  kf.pair((sx) => {
    // the shoulder rail the arch sits on, the full length
    kf.add(M.shell, new THREE.CylinderGeometry(0.20 * S, 0.20 * S, 6.30 * S, 8), [sx * 1.46 * S, (BAY.roof + 0.06) * S, 0.50 * S], [1.5708, 0, 0]);
    // THE WALLS: full height fore and aft of the door, above and below it between
    kf.add(M.shell, plateGeo(0.16 * S, 2.34 * S, 2.10 * S, 0.05 * S, 1), [sx * WALL * S, 0.12 * S, -1.42 * S]);
    kf.add(M.shell, plateGeo(0.16 * S, 2.34 * S, 1.50 * S, 0.05 * S, 1), [sx * WALL * S, 0.12 * S, 2.68 * S]);
    kf.add(M.shell, plateGeo(0.16 * S, 0.34 * S, 2.50 * S, 0.05 * S, 1), [sx * WALL * S, (BAY.roof - 0.02) * S, 0.72 * S]);
    kf.add(M.shell, plateGeo(0.16 * S, 0.34 * S, 2.50 * S, 0.05 * S, 1), [sx * WALL * S, (BAY.floor + 0.02) * S, 0.72 * S]);
    kf.add(M.dark, plateGeo(0.22 * S, 2.14 * S, 0.12 * S, 0.02 * S, 2), [sx * WALL * S, 0.12 * S, -0.48 * S]);
    kf.add(M.dark, plateGeo(0.22 * S, 2.14 * S, 0.12 * S, 0.02 * S, 2), [sx * WALL * S, 0.12 * S, 1.92 * S]);
    kf.add(M.dark, plateGeo(0.10 * S, 0.10 * S, 4.70 * S, 0.02 * S, 1), [sx * 1.48 * S, (BAY.roof + 0.04) * S, 1.50 * S]);
    kf.add(M.dark, plateGeo(0.10 * S, 0.10 * S, 4.70 * S, 0.02 * S, 1), [sx * 1.48 * S, (BAY.floor - 0.04) * S, 1.50 * S]);
    // the tan chevron the Confederacy paints on a flank
    kf.add(M.mark, plateGeo(0.05 * S, 0.30 * S, 1.20 * S, 0.02 * S, 1), [sx * 1.43 * S, 0.70 * S, -1.40 * S], [0, 0, 0]);
  });
  // the bulkheads: forward, with a port through to the cockpit; aft, over the hatchway
  kf.add(M.shell, plateGeo(2.86 * S, 2.34 * S, 0.18 * S, 0.05 * S, 2), [0, 0.12 * S, -2.40 * S]);
  kf.add(M.shell, plateGeo(2.86 * S, 0.50 * S, 0.22 * S, 0.06 * S, 2), [0, 0.96 * S, 3.42 * S]);
  kf.pair((sx) => kf.add(M.shell, plateGeo(0.30 * S, 2.34 * S, 0.22 * S, 0.05 * S, 2), [sx * 1.28 * S, 0.12 * S, 3.42 * S]));
  // the tail cowl over the closed hatch leaf
  kf.add(M.shell, loftGeo(plateGeo(2.80 * S, 0.96 * S, 2.30 * S, 0.16 * S, 4), 2.30 * S, 'z', 1,
    (t) => ({ a: 1 - 0.36 * t, b: 1 - 0.55 * t, db: 0.22 * t * S })), [0, 0.72 * S, 4.45 * S]);

  /* ── the snout: nested ellipsoids, a mandible band, and the canopy blister
   * PROUD of the shell with the crew visible in it ─────────────────────── */
  kf.add(M.shell, new THREE.SphereGeometry(1.10 * S, 14, 10), [0, -0.20 * S, -3.40 * S], null, [1.42, 0.74, 1.55]);
  kf.add(M.shell, new THREE.SphereGeometry(0.80 * S, 12, 9), [0, -0.30 * S, -5.10 * S], null, [1.08, 0.74, 1.45]);
  kf.add(M.shell, new THREE.SphereGeometry(0.50 * S, 10, 8), [0, -0.40 * S, -6.10 * S], null, [0.94, 0.62, 1.40]);
  kf.add(M.mark, bandGeo(0.62 * S, 0.78 * S, 0.54 * S, 0.70 * S, 0.16 * S, 12), [0, -0.82 * S, -4.90 * S], [1.5708, 0, 0]);
  kf.add(M.dark, plateGeo(2.20 * S, 0.16 * S, 0.30 * S, 0.04 * S, 2), [0, 0.30 * S, -2.70 * S]);           // the cockpit sill
  kf.add(M.dark, new THREE.CylinderGeometry(0.14 * S, 0.14 * S, 0.10 * S, 10), [0, -1.06 * S, -4.20 * S]);  // the lamp recess
  kf.pair((sx) => {
    kf.add(M.dark, new THREE.SphereGeometry(0.11 * S, 8, 6), [sx * 0.92 * S, -0.42 * S, -5.62 * S]);           // sensor eyes
    kf.add(M.mark, new THREE.TorusGeometry(0.42 * S, 0.035 * S, 5, 12, Math.PI), [sx * 0.34 * S, 0.62 * S, -3.30 * S], [0, 1.5708, 0]);  // canopy ribs
  });

  /* ── THE DORSAL SAIL, the ship's defining feature, and the elytra ────── */
  /* AFT of amidships, where the plates put it, and taller than the last cut
   * by the height the carapace lost — it is the ship's skyline. */
  kf.add(M.shell, loftGeo(plateGeo(0.24 * S, 3.40 * S, 3.20 * S, 0.08 * S, 5), 3.40 * S, 'y', 1,
    (t) => ({ a: 1 - 0.34 * t, b: 1 - 0.34 * t, db: 0.62 * S * t })), [0, 3.30 * S, 1.70 * S], [-0.13, 0, 0]);
  kf.add(M.mark, loftGeo(plateGeo(0.28 * S, 0.32 * S, 2.24 * S, 0.04 * S, 3), 0.32 * S, 'y', 1,
    (t) => ({ b: 1 - 0.24 * t, db: 0.34 * S * t })), [0, 4.76 * S, 1.76 * S], [-0.13, 0, 0]);
  kf.add(M.panel, plateGeo(0.44 * S, 0.60 * S, 2.30 * S, 0.08 * S, 2), [0, 1.76 * S, 1.70 * S]);           // the sail's root fairing
  kf.add(M.dark, new THREE.CylinderGeometry(0.035 * S, 0.02 * S, 0.50 * S, 5), [0, 5.08 * S, 2.44 * S], [-0.30, 0, 0]);
  kf.pair((sx) => {
    /* canted 1.12 rad — steeper than the last cut's 0.92, so the blade
     * rises out of the band the LAAT's wing lies in and the two hulls read
     * apart head-on; the root stays on the flank at (1.85, -0.5) */
    const er = [0, sx * -0.42, sx * 1.12];
    kf.add(M.shell, wingGeo(4.40 * S, 2.60 * S, 0.26 * S, sx, { tip: 0.40, tipThick: 0.44 }), [sx * 2.81 * S, 1.48 * S, 3.10 * S], er);
    kf.add(M.mark, loftGeo(plateGeo(3.00 * S, 0.06 * S, 0.42 * S, 0.02 * S, 5), 3.00 * S, 'x', sx,
      (t) => ({ b: 1 - 0.5 * t, db: wingSweep(2.20, 0.28) * 0.82 * S * t })), [sx * 2.58 * S, 1.52 * S, 2.60 * S], er);
    // the elytron's root, a hinge boss on the shoulder rail
    kf.add(M.dark, plateGeo(0.60 * S, 0.50 * S, 0.90 * S, 0.08 * S, 2), [sx * 1.60 * S, 1.10 * S, 3.00 * S]);
  });
  kf.bake(g, { silhouette: true });

  /* the canopy blister, and the elytra's tip lamps */
  const kc = new Kit();
  kc.add(M.canopy, new THREE.SphereGeometry(1.0 * S, 16, 12), [0, 0.58 * S, -3.30 * S], null, [0.96, 0.52, 0.98]);
  kc.bake(g);

  /* ══ THE HOLD ════════════════════════════════════════════════════════ */
  const ki = new Kit();
  /* FRAMES, angular where the Republic's are square, and — as there — with
   * no post standing in the door aperture. */
  for (const [z0, posts] of [[-1.95, true], [-0.85, true], [0.25, false], [1.25, false], [2.20, true], [2.95, true]]) {
    const z = z0 * S;
    ki.add(M.dark, plateGeo(2.46 * S, 0.14 * S, 0.16 * S, 0.05 * S, 2), [0, (BAY.roof - 0.06) * S, z]);
    if (!posts) continue;
    ki.pair((sx) => {
      ki.add(M.dark, plateGeo(0.13 * S, 2.06 * S, 0.16 * S, 0.05 * S, 2), [sx * 1.24 * S, 0.06 * S, z]);
      ki.add(M.dark, plateGeo(0.12 * S, 0.30 * S, 0.30 * S, 0.03 * S, 2), [sx * 1.22 * S, (BAY.roof - 0.24) * S, z], [0, 0, sx * 0.62]);
    });
  }
  ki.add(M.dark, plateGeo(0.34 * S, 0.10 * S, 4.60 * S, 0.02 * S, 1), [0, (BAY.roof - 0.02) * S, 0.60 * S]);
  ki.add(M.lamp, plateGeo(0.22 * S, 0.05 * S, 4.40 * S, 0.01 * S, 1), [0, (BAY.roof - 0.09) * S, 0.60 * S]);
  /* THE CRADLES — six, at the published positions. A canted back plate, a pan
   * on a rail with legs, a shoulder clamp and a charging spine each; between
   * them the rack's spine at head height with a contact lamp per place. */
  const seatZ = [-0.70, 0.70, 2.10];
  ki.pair((sx) => {
    ki.add(M.greeble, new THREE.CylinderGeometry(0.05 * S, 0.05 * S, 4.60 * S, 6), [sx * 1.16 * S, 0.62 * S, 0.60 * S], [1.5708, 0, 0]);
    ki.add(M.dark, plateGeo(0.08 * S, 0.08 * S, 4.30 * S, 0.02 * S, 1), [sx * 0.66 * S, -0.48 * S, 0.70 * S]);
    ki.add(M.dark, plateGeo(0.08 * S, 0.08 * S, 4.30 * S, 0.02 * S, 1), [sx * 1.12 * S, -0.48 * S, 0.70 * S]);
    for (const z0 of seatZ) {
      const z = z0 * S;
      ki.add(M.dark, plateGeo(0.50 * S, 0.08 * S, 0.56 * S, 0.03 * S, 2), [sx * 0.89 * S, -0.42 * S, z]);
      ki.add(M.dark, plateGeo(0.08 * S, 0.80 * S, 0.54 * S, 0.03 * S, 2), [sx * 1.16 * S, 0.00 * S, z], [0, 0, sx * 0.16]);
      ki.add(M.mark, plateGeo(0.06 * S, 0.50 * S, 0.10 * S, 0.02 * S, 1), [sx * 1.20 * S, 0.00 * S, z]);            // the charging spine
      ki.add(M.dark, plateGeo(0.30 * S, 0.06 * S, 0.10 * S, 0.02 * S, 1), [sx * 0.98 * S, 0.34 * S, z], [0, 0, sx * -0.4]);  // the shoulder clamp
      ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.44 * S, 6), [sx * 0.68 * S, -0.70 * S, z]);
      ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.44 * S, 6), [sx * 1.12 * S, -0.70 * S, z]);
      ki.add(M.lamp, plateGeo(0.05 * S, 0.05 * S, 0.03 * S, 0.005 * S, 1), [sx * 1.10 * S, 0.62 * S, z]);
      ki.add(M.dark, plateGeo(0.44 * S, 0.26 * S, 0.04 * S, 0.01 * S, 1), [sx * 0.92 * S, -0.30 * S, z + 0.32 * S]);
    }
    ki.add(M.dark, new THREE.CylinderGeometry(0.035 * S, 0.035 * S, 4.60 * S, 6), [sx * 0.54 * S, (BAY.roof - 0.18) * S, 0.60 * S], [1.5708, 0, 0]);
    ki.row(5, (i, t) => ki.add(M.mark, plateGeo(0.07 * S, 0.26 * S, 0.05 * S, 0.01 * S, 1), [sx * 0.54 * S, (BAY.roof - 0.34) * S, (-1.30 + t * 3.9) * S]));
    ki.add(M.greeble, plateGeo(0.15 * S, 0.40 * S, 0.60 * S, 0.04 * S, 2), [sx * 1.22 * S, -0.10 * S, -1.60 * S]);
    ki.add(M.greeble, new THREE.CylinderGeometry(0.10 * S, 0.10 * S, 0.46 * S, 8), [sx * 1.18 * S, -0.10 * S, 2.80 * S], [0, 0, 1.5708]);
    ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 1.40 * S, 6), [sx * 1.22 * S, 0.20 * S, -0.56 * S]);
    ki.add(M.dark, new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 1.40 * S, 6), [sx * 1.22 * S, 0.20 * S, 2.00 * S]);
  });
  ki.pair((sx) => ki.add(M.dark, plateGeo(0.09 * S, 0.05 * S, 4.60 * S, 0.01 * S, 1), [sx * 0.40 * S, (BAY.floor + 0.03) * S, 0.60 * S]));
  ki.row(8, (i, t) => ki.add(M.dark, plateGeo(1.50 * S, 0.02 * S, 0.06 * S, 0.005 * S, 1), [0, (BAY.floor + 0.02) * S, (-1.60 + t * 4.5) * S]));
  // the forward bulkhead, inside: the brain housing, a port to the cockpit, three lamps
  ki.add(M.greeble, plateGeo(0.80 * S, 0.86 * S, 0.14 * S, 0.06 * S, 2), [0.80 * S, 0.10 * S, -2.30 * S]);
  ki.add(M.dark, plateGeo(0.90 * S, 1.60 * S, 0.10 * S, 0.03 * S, 2), [-0.50 * S, -0.10 * S, -2.30 * S]);
  ki.row(3, (i, t) => ki.add(M.lamp, plateGeo(0.07 * S, 0.07 * S, 0.03 * S, 0.005 * S, 1), [(0.58 + t * 0.44) * S, 0.40 * S, -2.22 * S]));
  ki.bake(g);

  /* ── the cockpit: a console and two droid pilots, side by side, up in the
   * blister where they can be seen ────────────────────────────────────── */
  const ks = new Kit();
  ks.add(M.dark, plateGeo(1.90 * S, 0.30 * S, 0.60 * S, 0.05 * S, 2), [0, 0.22 * S, -3.86 * S], [0.30, 0, 0]);
  ks.add(M.panel, plateGeo(1.90 * S, 0.24 * S, 1.30 * S, 0.05 * S, 1), [0, -0.02 * S, -3.20 * S]);   // the cockpit floor
  for (const sx of [1, -1]) {
    ks.add(M.dark, plateGeo(0.46 * S, 0.62 * S, 0.14 * S, 0.04 * S, 1), [sx * 0.46 * S, 0.44 * S, -2.86 * S], [-0.1, 0, 0]);
    ks.add(M.dark, plateGeo(0.46 * S, 0.08 * S, 0.44 * S, 0.03 * S, 1), [sx * 0.46 * S, 0.12 * S, -3.06 * S]);
    ks.row(3, (i, t) => ks.add(M.lamp, plateGeo(0.05 * S, 0.05 * S, 0.03 * S, 0.005 * S, 1), [sx * (0.26 + t * 0.40) * S, 0.42 * S, -4.10 * S], [0.3, 0, 0]));
  }
  ks.bake(g);
  for (const sx of [1, -1]) {
    const p = droidPilotBody(M, 0.94 * S);
    p.position.set(sx * 0.46 * S, 0.16 * S, -3.10 * S);
    p.name = sx > 0 ? 'pilotL' : 'pilotR';
    g.add(p);
  }

  /* ── the hatchway ramp: 2.58 m, the Republic leaf to the centimetre ── */
  const ramp = new THREE.Group();
  ramp.name = 'ramp';
  ramp.position.set(0, (BAY.floor - 0.02) * S, BAY.back * S);
  {
    const kr = new Kit();
    kr.add(M.deck, plateGeo(2.44 * S, 0.16 * S, 2.58 * S, 0.05 * S, 1), [0, 0, 1.29 * S]);
    kr.row(6, (i, t) => kr.add(M.dark, plateGeo(2.20 * S, 0.05 * S, 0.10 * S, 0.01 * S, 1), [0, 0.10 * S, (0.32 + t * 1.96) * S]));
    kr.pair((sx) => {
      kr.add(M.mark, plateGeo(0.09 * S, 0.22 * S, 2.58 * S, 0.02 * S, 1), [sx * 1.18 * S, 0.10 * S, 1.29 * S]);
      kr.add(M.greeble, plateGeo(0.16 * S, 0.10 * S, 0.40 * S, 0.02 * S, 1), [sx * 1.02 * S, -0.10 * S, 0.30 * S]);
    });
    kr.bake(ramp);
  }
  g.add(ramp);

  /* ── the two side doors, sliding aft on the rails, outboard of the wall ─ */
  const doors = [];
  for (const sx of [1, -1]) {
    const d = new THREE.Group();
    d.name = sx > 0 ? 'doorL' : 'doorR';
    const kd = new Kit();
    kd.add(M.shell, plateGeo(0.12 * S, 2.10 * S, 2.30 * S, 0.06 * S, 2), [sx * 1.46 * S, 0.12 * S, 0.72 * S]);
    kd.add(M.mark, plateGeo(0.05 * S, 0.34 * S, 1.30 * S, 0.02 * S, 1), [sx * 1.53 * S, 0.66 * S, 0.72 * S]);
    kd.add(M.dark, plateGeo(0.06 * S, 1.50 * S, 0.10 * S, 0.02 * S, 1), [sx * 1.53 * S, 0.10 * S, -0.34 * S]);
    kd.add(M.dark, plateGeo(0.06 * S, 1.50 * S, 0.10 * S, 0.02 * S, 1), [sx * 1.53 * S, 0.10 * S, 1.78 * S]);
    kd.add(M.dark, plateGeo(0.08 * S, 0.14 * S, 0.36 * S, 0.02 * S, 1), [sx * 1.54 * S, -0.18 * S, 1.58 * S]);
    kd.add(M.dark, plateGeo(0.14 * S, 0.12 * S, 1.80 * S, 0.02 * S, 1), [sx * 1.48 * S, (BAY.roof + 0.04) * S, 0.72 * S]);
    kd.add(M.dark, plateGeo(0.14 * S, 0.12 * S, 1.80 * S, 0.02 * S, 1), [sx * 1.48 * S, (BAY.floor - 0.04) * S, 0.72 * S]);
    kd.bake(d);
    g.add(d);
    doors.push(d);
  }

  /* ── two engine pods on pylons off the shoulders, four nozzles, the pincer
   * legs ─────────────────────────────────────────────────────────────── */
  const kw = new Kit();
  kw.pair((sx) => {
    /* AFT OF THE DOOR — the pod's pylon used to stand beside the aperture */
    const ex = sx * 1.72 * S, ez = 2.50 * S;
    kw.add(M.shell, new THREE.CylinderGeometry(0.42 * S, 0.50 * S, 2.40 * S, 12), [ex, -0.30 * S, ez], [1.5708, 0, 0]);
    kw.add(M.mark, new THREE.CylinderGeometry(0.52 * S, 0.52 * S, 0.24 * S, 12), [ex, -0.30 * S, ez - 0.90 * S], [1.5708, 0, 0]);
    kw.add(M.dark, new THREE.CylinderGeometry(0.38 * S, 0.38 * S, 0.26 * S, 12), [ex, -0.30 * S, ez - 1.14 * S], [1.5708, 0, 0]);
    kw.add(M.panel, new THREE.CylinderGeometry(0.50 * S, 0.50 * S, 0.20 * S, 12), [ex, -0.30 * S, ez + 1.00 * S], [1.5708, 0, 0]);
    // the pylon: from the shoulder rail down and out to the pod, two members
    kw.add(M.shell, plateGeo(0.30 * S, 0.90 * S, 1.30 * S, 0.08 * S, 1), [sx * 1.52 * S, 0.30 * S, ez], [0, 0, sx * 0.24]);
    kw.add(M.dark, plateGeo(0.44 * S, 0.24 * S, 1.60 * S, 0.04 * S, 1), [sx * 1.62 * S, 0.02 * S, ez]);
    for (const oy of [0.20, -0.20]) {
      kw.add(M.dark, new THREE.CylinderGeometry(0.19 * S, 0.24 * S, 0.44 * S, 8), [ex, (-0.30 + oy) * S, ez + 1.20 * S], [1.5708, 0, 0]);
      kw.add(M.greeble, new THREE.TorusGeometry(0.22 * S, 0.03 * S, 5, 12), [ex, (-0.30 + oy) * S, ez + 1.40 * S]);
    }
    for (const gz of [-2.30, 2.20]) {
      kw.add(M.panel, plateGeo(0.34 * S, 0.40 * S, 0.60 * S, 0.06 * S, 1), [sx * 1.16 * S, -1.30 * S, gz * S]);
      kw.add(M.dark, new THREE.CylinderGeometry(0.12 * S, 0.10 * S, 0.86 * S, 7), [sx * 1.22 * S, -1.50 * S, gz * S], [0, 0, sx * 0.42]);
      kw.add(M.dark, new THREE.CylinderGeometry(0.09 * S, 0.07 * S, 0.62 * S, 6), [sx * 1.60 * S, -1.94 * S, gz * S], [0, 0, sx * -0.62]);
      kw.add(M.dark, plateGeo(0.44 * S, 0.11 * S, 0.52 * S, 0.03 * S, 1), [sx * 1.42 * S, -2.16 * S, gz * S]);
    }
  });
  kw.bake(g, { silhouette: true });

  const engines = [];
  for (const sx of [1, -1]) {
    for (const oy of [0.20, -0.20]) {
      const e = new THREE.Object3D();
      e.name = `engine${sx > 0 ? 'L' : 'R'}${oy > 0 ? 'U' : 'D'}`;
      e.position.set(sx * 1.72 * S, (-0.30 + oy) * S, 3.92 * S);
      g.add(e);
      engines.push(e);
    }
  }
  const lamp = new THREE.Object3D();
  lamp.name = 'lamp';
  lamp.position.set(0, -1.12 * S, -4.20 * S);
  g.add(lamp);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), bs = new THREE.Vector3();
  bb.getSize(bs);
  g.userData.engines = engines;
  g.userData.lamp = lamp;
  g.userData.ramp = ramp;
  g.userData.doorL = doors[0];
  g.userData.doorR = doors[1];
  g.userData.bay = {
    halfW: BAY.halfW * S, floor: BAY.floor * S, roof: BAY.roof * S,
    front: BAY.front * S, back: BAY.back * S,
  };
  const seats = [];
  for (const z of seatZ) {
    for (const sx of [-1, 1]) {
      seats.push({ x: sx * 0.87 * S, y: (BAY.floor + 0.56) * S, z: z * S,
        yaw: sx < 0 ? Math.PI / 2 : -Math.PI / 2, sit: true });
    }
  }
  for (let i = 0; i < 4; i++) {
    seats.push({ x: (i % 2 ? 0.34 : -0.34) * S, y: (BAY.floor + 0.02) * S,
      z: (-1.0 + Math.floor(i / 2) * 1.5) * S, yaw: 0, sit: false });
  }
  g.userData.seats = seats;
  g.userData.span = bs.x;
  g.userData.length = bs.z;
  g.userData.height = bs.y;
  g.userData.side = 'separatist';
  if (S === 1 && !opts.fresh) { _droidTemplate = g; return buildDroidTransport(opts); }
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The capital ships — the hull the hangar is one bay of                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE CAPITAL SHIPS, and why they stopped being a silhouette.
 *
 * The player, after flying out through the field and turning round:
 *
 *   "when you look back you don't see any detailed capital ship model or
 *    mothership model at all… all I see is a large rectangle getting smaller
 *    and smaller… the actual size of the ship should DWARF the size of the
 *    force field entrance, this ship should be massive and it should be just
 *    one hangar of many. (a classic Republic Cruiser and the Separatist
 *    Battlecruiser, classic donut shaped one)"
 *
 * The previous pair were built for one shot — astern, receding, against
 * black — and said so: "nothing on it is smaller than about four metres,
 * because at four hundred metres four metres is a pixel." That was true and
 * it is no longer the shot. `DeckExterior` now stands the hull ROUND THE
 * HANGAR at real scale, with one of its bays on the deck's aperture, so the
 * flanks are seen from a hundred metres as the transport leaves — and from
 * a hundred metres a 900-triangle wedge is a rectangle.
 *
 * ── WHAT EACH HULL NOW PUBLISHES, beyond the shape ─────────────────────────
 *
 *   `length`   the real ship in metres — 752 for the Acclamator, 3,170 across
 *              for the Lucrehulk — so a director can say how far away it is
 *              in a unit that means something.
 *   `scale`    model units per metre, 0.01: the builders stay at the 1/100
 *              convention `Extraction._placeCapital` scales DISTANCE around,
 *              and `DeckExterior` multiplies by the inverse.
 *   `hangars`  every real hangar mouth on the hull, `{ pos, normal, size }` in
 *              model units, the mouth's centre and its outward normal, with
 *              the FIRST one being the bay a deck should be — on a flank the
 *              transport can fly straight out of, with the rest of the ship
 *              in view behind it. Each mouth is drawn the way the deck's own
 *              aperture is drawn in `Hangar.js`: a dark recessed rounded
 *              rectangle with a bright rim.
 *
 * Both are seen from 100 m to 5 km now, so the triangle budget is loose
 * (tens of thousands) and the size floor is tight: nothing on either is
 * smaller than about 2 m real, because that is what a rim or a window strip
 * needs to be to read at all at a hundred metres.
 */

/** Materials both warships share the recipe for; the colours are each's own. */
function capitalMaterials(hull, panel, trim) {
  return {
    hull: armorMat(hull, 0.06, 0.72, 0.6),
    panel: armorMat(panel, 0.06, 0.70, 0.9),
    trim: armorMat(trim, 0.05, 0.8, 0.9),
    dark: metalMat(0x2a2c30, 0.55, 0.9, 1.2),
    mouth: metalMat(0x0c0d10, 0.9, 0.3, 1.0),
    rim: emissiveMat(0xf4f8ff, 2.4),
    window: emissiveMat(0xbfe0ff, 2.0),
    glow: new THREE.MeshBasicMaterial({ color: 0x86d8ff, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending }),
  };
}

/**
 * A HANGAR MOUTH on a surface: a bright rim flush with the plate and a black
 * slab proud of it by a centimetre inside the rim, which at any distance
 * reads as a lit frame round a dark hole — `DECK.aperture`'s own look. `pos`
 * is a point ON the surface and `normal` its outward direction; the record
 * returned is what `userData.hangars` carries.
 */
function hangarMouth(k, M, pos, normal, w, h) {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const e = new THREE.Euler().setFromQuaternion(q);
  const rot = [e.x, e.y, e.z];
  const at = (d) => [pos[0] + n.x * d, pos[1] + n.y * d, pos[2] + n.z * d];
  k.add(M.rim, plateGeo(w + 0.10, h + 0.10, 0.04, 0.015, 1), at(0.02), rot);
  k.add(M.mouth, plateGeo(w, h, 0.06, 0.02, 1), at(0.035), rot);
  return { pos: [pos[0], pos[1], pos[2]], normal: [n.x, n.y, n.z], size: [w, h] };
}

/**
 * A SWEEP: a section profile of (r, y) points carried round the y axis from
 * angle `a0` to `a1`, with +Z at angle 0 — a ring, or a band round one. Flat
 * shaded, because a warship's plating has edges. `closed` joins the last
 * profile point back to the first.
 */
function sweepGeo(profile, a0, a1, seg, closed = true) {
  const n = profile.length, m = closed ? n : n - 1;
  const pos = [], uv = [];
  const P = (i, j) => {
    const a = lerp(a0, a1, i / seg);
    const [r, y] = profile[j % n];
    return [r * Math.sin(a), y, r * Math.cos(a)];
  };
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < m; j++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j), d = P(i + 1, j + 1);
      /* wound so a profile walked inner-top → rim → inner-bottom faces OUT —
       * measured on the first cut, which faced in */
      pos.push(...a, ...b, ...c, ...b, ...d, ...c);
      const u0 = i / seg, u1 = (i + 1) / seg, v0 = j / m, v1 = (j + 1) / m;
      uv.push(u0, v0, u0, v1, u1, v0, u0, v1, u1, v1, u1, v0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * THE ACCLAMATOR-CLASS ASSAULT SHIP — the Republic's, per the three plates in
 * `assets/reference/vehicles/`. 752 m, a flat-bellied wedge with the long
 * dark-red dorsal spine down the centreline, the bridge tower on its raked
 * neck over the stern third, the diagonal red stripes and the roundels on the
 * upper surfaces aft, the belly and the flanks lined with machinery, hangar
 * bays let into both flanks, and a bank of engines across the flat stern.
 */
let _capitalTemplate = null;
export function buildRepublicCapital(opts = {}) {
  if (_capitalTemplate && !opts.fresh) return _capitalTemplate.clone(true);
  const g = new THREE.Group();
  g.name = 'capital';
  const M = capitalMaterials(0x9a9890, 0x7b7a74, 0x5d5a52);
  M.spine = armorMat(0x5a2126, 0.05, 0.75, 0.8);
  M.mark = armorMat(0x8b2f2c, 0.05, 0.7, 0.8);
  M.gold = armorMat(0xc7a44e, 0.05, 0.6, 0.8);

  const L = 7.52, W = 4.60;                       // 752 m by 460 m, at 1/100
  const belly = -0.46;
  /* the hull's half-width and top height at a station z, the two functions
   * everything on the surface is placed with */
  const tAt = (z) => clamp((z + L / 2) / L, 0, 1);
  const halfW = (z) => (W / 2) * (0.04 + 0.96 * tAt(z));
  const thick = (z) => 0.30 + 0.66 * tAt(z);
  const topAt = (z) => belly + thick(z);
  const flankN = (sx) => {                        // outward normal of a flank face
    const v = new THREE.Vector3(sx * L, 0, -(W / 2) * 0.96).normalize();
    return [v.x, v.y, v.z];
  };

  const k = new Kit();
  /* THE WEDGE: one lofted slab, plan a triangle, belly flat, top sloping down
   * to the bow. */
  k.add(M.hull, loftGeo(plateGeo(W, 1.0, L, 0.06, 12), L, 'z', 1,
    (t) => ({ a: 0.04 + 0.96 * t, b: 0.30 + 0.66 * t, db: belly + (0.30 + 0.66 * t) / 2 })), [0, 0, 0]);
  /* THE UPPER TIER: the raised middle third, the length of the hull, its top
   * following the wedge's slope. */
  const T2 = 6.6;
  k.add(M.panel, loftGeo(plateGeo(1.80, 0.30, T2, 0.04, 10), T2, 'z', 1,
    (t) => ({ a: 0.10 + 0.90 * t, db: topAt((t - 0.5) * T2 + 0.20) + 0.10 })), [0, 0, 0.20]);
  /* THE DORSAL SPINE, dark red, bow to tower. */
  const SP = 5.8;
  k.add(M.spine, loftGeo(plateGeo(0.62, 0.20, SP, 0.03, 8), SP, 'z', 1,
    (t) => ({ a: 0.30 + 0.70 * t, db: topAt((t - 0.5) * SP - 0.60) + 0.30 })), [0, 0, -0.60]);
  k.row(7, (i, t) => k.add(M.dark, plateGeo(0.42 * (0.4 + 0.6 * t), 0.04, 0.05, 0.01, 1),
    [0, topAt(-3.2 + t * 5.0) + 0.42, -3.2 + t * 5.0]));
  /* THE TOWER: a base block, the raked neck, the bridge across the top with
   * its two sensor domes, and the mast. */
  const TZ = 2.40, TY = topAt(TZ) + 0.10;
  k.add(M.trim, plateGeo(1.50, 0.44, 1.50, 0.05, 2), [0, TY + 0.22, TZ]);
  k.add(M.panel, plateGeo(1.00, 0.30, 0.90, 0.04, 2), [0, TY + 0.56, TZ + 0.10]);
  k.add(M.trim, plateGeo(0.34, 0.74, 0.52, 0.04, 3), [0, TY + 0.98, TZ - 0.08], [-0.28, 0, 0]);
  k.add(M.panel, plateGeo(1.10, 0.24, 0.60, 0.05, 2), [0, TY + 1.36, TZ - 0.30]);
  k.add(M.trim, plateGeo(0.54, 0.14, 0.36, 0.04, 1), [0, TY + 1.54, TZ - 0.28]);
  k.pair((sx) => k.add(M.dark, new THREE.SphereGeometry(0.10, 10, 8), [sx * 0.46, TY + 1.52, TZ - 0.30]));
  k.add(M.dark, new THREE.CylinderGeometry(0.02, 0.03, 0.44, 6), [0, TY + 1.82, TZ - 0.28]);
  k.add(M.window, plateGeo(0.90, 0.04, 0.04, 0.01, 1), [0, TY + 1.38, TZ - 0.61]);
  /* THE MARKINGS: three red stripes a side across the upper surface aft, and
   * a roundel a side amidships. */
  k.pair((sx) => {
    k.row(3, (i, t) => {
      const z = 1.30 + t * 0.90;
      k.add(M.mark, plateGeo(0.14, 0.02, 1.00, 0.005, 1), [sx * (halfW(z) - 0.75), topAt(z) + 0.01, z], [0, sx * 0.30, 0]);
    });
    k.add(M.mark, new THREE.CylinderGeometry(0.30, 0.30, 0.02, 18), [sx * 1.15, topAt(0.30) + 0.01, 0.30]);
    k.add(M.gold, new THREE.CylinderGeometry(0.20, 0.20, 0.025, 16), [sx * 1.15, topAt(0.30) + 0.01, 0.30]);
  });
  /* THE FLANKS: a trench of machinery along each edge, window strips, and the
   * hangar bays. THE BELLY: rows of blocks, and the ventral bay. */
  const hangars = [];
  k.pair((sx) => {
    const n = flankN(sx);
    k.row(14, (i, t) => {
      const z = -2.4 + t * 5.8;
      const x = sx * (halfW(z) - 0.05);
      k.add(M.dark, plateGeo(0.22, 0.10 + 0.10 * t, 0.26, 0.02, 1), [x, topAt(z) - 0.10, z], [0, sx * -0.28, 0]);
      k.add(M.trim, plateGeo(0.16, 0.14, 0.12, 0.02, 1), [x, belly + 0.16, z], [0, sx * -0.28, 0]);
    });
    k.row(4, (i, t) => {
      const z = -1.2 + t * 4.2, x = sx * halfW(z);
      k.add(M.window, plateGeo(0.03, 0.03, 0.70, 0.01, 1), [x + n[0] * 0.01, belly + 0.34 + 0.24 * t, z + n[2] * 0.01], [0, sx * -0.28, 0]);
    });
  });
  k.row(11, (i, t) => {
    const z = -2.6 + t * 6.0;
    k.add(M.dark, plateGeo(halfW(z) * 1.4, 0.06, 0.20, 0.01, 1), [0, belly - 0.02, z]);
  });
  k.pair((sx) => k.row(6, (i, t) => {
    const z = -1.0 + t * 4.2;
    k.add(M.trim, plateGeo(0.30, 0.12, 0.40, 0.02, 1), [sx * halfW(z) * 0.55, belly - 0.05, z]);
  }));
  /* THE HANGARS. The FIRST is the deck: a big bay in the stern third of the
   * starboard flank, where the flank is tallest. Two smaller a side forward
   * of it, and the ventral bay under the bow third. */
  for (const sx of [1, -1]) {
    const n = flankN(sx);
    for (const [z, w, h] of [[2.30, 1.20, 0.62], [0.90, 0.60, 0.40], [-0.30, 0.50, 0.34]]) {
      const x = sx * halfW(z);
      hangars.push(hangarMouth(k, M, [x, belly + thick(z) * 0.48, z], n, w, h));
    }
  }
  hangars.push(hangarMouth(k, M, [0, belly, -0.60], [0, -1, 0], 0.90, 0.60));
  k.bake(g, { silhouette: true });

  /* THE ENGINE BANK across the flat stern: four main and four secondary. */
  const ke = new Kit();
  const stern = L / 2;
  for (const [x, y, r] of [[-1.40, 0.02, 0.30], [-0.50, 0.02, 0.30], [0.50, 0.02, 0.30], [1.40, 0.02, 0.30],
    [-0.95, -0.28, 0.13], [0.95, -0.28, 0.13], [-1.85, -0.20, 0.11], [1.85, -0.20, 0.11]]) {
    ke.add(M.dark, new THREE.CylinderGeometry(r, r * 1.15, 0.36, 14), [x, y, stern + 0.14], [1.5708, 0, 0]);
    ke.add(M.trim, new THREE.TorusGeometry(r * 1.12, 0.03, 6, 16), [x, y, stern + 0.30]);
    ke.add(M.glow, new THREE.CircleGeometry(r * 0.86, 16), [x, y, stern + 0.33]);
  }
  ke.add(M.panel, plateGeo(W * 0.96, 0.90, 0.10, 0.04, 2), [0, belly + 0.48, stern - 0.04]);
  ke.bake(g, { silhouette: true });

  g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; } });
  g.userData.side = 'republic';
  g.userData.length = 752;
  g.userData.scale = 0.01;
  g.userData.hangars = hangars;
  if (!opts.fresh) { _capitalTemplate = g; return _capitalTemplate.clone(true); }
  return g;
}

/**
 * THE LUCREHULK-CLASS BATTLESHIP — the Confederacy's, "the classic donut
 * shaped one". 3,170 m across: a huge flat ring with a gap at the bow, the
 * spherical core ship set at the centre on a spine to the ring's stern, the
 * ring's inner and outer faces studded with hangar bays and lit strips, the
 * section thicker at the rim than at the hub, and the engines in a bank
 * across the rear of the ring. Built from knowledge — there is no plate for
 * it on disk.
 *
 * `hangars[0]` is on the OUTER face of the starboard-aft quarter, so a deck
 * placed on it looks out into space with three kilometres of ring curving
 * away on either hand. A bay on the inner face would look at the core ship
 * 900 m ahead, which is a wall the flight would fly into.
 */
let _droidCapitalTemplate = null;
export function buildDroidCapital(opts = {}) {
  if (_droidCapitalTemplate && !opts.fresh) return _droidCapitalTemplate.clone(true);
  const g = new THREE.Group();
  g.name = 'capital';
  const M = capitalMaterials(0x8a8778, 0x5f6266, 0x6d5e4c);
  M.glow.color.set(0xaef0ff);

  const R1 = 15.85, R0 = 9.80;                     // outer and inner radii, 1/100
  const GAP = 0.34;                                 // half the bow gap, radians
  const A0 = GAP - Math.PI, A1 = Math.PI - GAP;     // the sweep, +Z (aft) at 0
  const SEG = 72;

  const k = new Kit();
  /* THE RING: one sweep of a chamfered section, taller at the rim. */
  const section = [[R0, 0.95], [R0 + 0.9, 1.45], [R1 - 1.4, 1.80], [R1 - 0.3, 1.55], [R1, 1.05],
    [R1, -1.05], [R1 - 0.3, -1.55], [R1 - 1.4, -1.80], [R0 + 0.9, -1.45], [R0, -0.95]];
  k.add(M.hull, sweepGeo(section, A0, A1, SEG), [0, 0, 0]);
  /* the plating: raised panel bands round the top and bottom faces, the
   * dark equatorial trench on both faces, and radial seams */
  for (const sy of [1, -1]) {
    k.add(M.panel, sweepGeo([[R0 + 1.6, sy * 1.66], [R0 + 3.2, sy * 1.86], [R1 - 2.6, sy * 1.86], [R1 - 1.7, sy * 1.68]], A0, A1, SEG, false), [0, 0, 0]);
    k.add(M.panel, sweepGeo([[R0 + 1.6, sy * 1.62], [R0 + 1.6, sy * 1.66], [R0 + 3.2, sy * 1.86], [R0 + 3.2, sy * 1.80]], A0, A1, SEG, false), [0, 0, 0]);
  }
  k.add(M.dark, sweepGeo([[R1 + 0.02, 0.30], [R1 + 0.02, -0.30]], A0, A1, SEG, false), [0, 0, 0]);
  k.add(M.dark, sweepGeo([[R0 - 0.02, -0.26], [R0 - 0.02, 0.26]], A0, A1, SEG, false), [0, 0, 0]);
  k.add(M.window, sweepGeo([[R1 + 0.03, 0.66], [R1 + 0.03, 0.60]], A0, A1, SEG, false), [0, 0, 0]);
  k.add(M.window, sweepGeo([[R1 + 0.03, -0.60], [R1 + 0.03, -0.66]], A0, A1, SEG, false), [0, 0, 0]);
  k.add(M.window, sweepGeo([[R0 - 0.03, 0.52], [R0 - 0.03, 0.58]], A0, A1, SEG, false), [0, 0, 0]);
  const NS = 40;
  for (let i = 0; i <= NS; i++) {
    const a = lerp(A0, A1, i / NS), rm = (R0 + R1) / 2;
    for (const sy of [1, -1]) {
      k.add(M.dark, plateGeo(0.06, 0.04, R1 - R0 - 1.2, 0.01, 1), [rm * Math.sin(a), sy * 1.86, rm * Math.cos(a)], [0, a, 0]);
    }
    if (i % 2 === 0) {
      // machinery blocks on the rim's shoulder, both faces
      const rb = R1 - 0.9;
      for (const sy of [1, -1]) {
        k.add(M.trim, plateGeo(0.50, 0.28, 0.80, 0.03, 1), [rb * Math.sin(a), sy * 1.80, rb * Math.cos(a)], [0, a, 0]);
      }
    }
  }
  /* THE PRONGS: the two blunt ends of the ring at the bow gap, each a block
   * with a docking bay in its face. */
  const hangars = [];
  for (const sx of [1, -1]) {
    const a = sx > 0 ? A1 : A0, rm = (R0 + R1) / 2;
    const cx = rm * Math.sin(a), cz = rm * Math.cos(a);
    /* a plate yawed by `a` has its z along the RADIAL and its x along the
     * tangent, so the block is long in z */
    k.add(M.trim, plateGeo(1.2, 3.3, R1 - R0 + 0.2, 0.10, 2), [cx, 0, cz], [0, a, 0]);
    // the face normal: along the ring's tangent, out of the gap
    const nx = Math.cos(a), nz = -Math.sin(a);
    const fn = sx > 0 ? [nx, 0, nz] : [-nx, 0, -nz];
    k.add(M.dark, plateGeo(0.10, 2.6, R1 - R0 - 0.6, 0.04, 1), [cx + fn[0] * 0.62, 0, cz + fn[2] * 0.62], [0, a, 0]);
  }
  /* THE CORE SHIP: a sphere at the centre, flattened a little, with its
   * equatorial band, the command tower on top, the spine aft to the ring. */
  k.add(M.hull, new THREE.SphereGeometry(3.6, 36, 26), [0, 0, 0.6], null, [1, 0.84, 1]);
  k.add(M.dark, new THREE.CylinderGeometry(3.72, 3.72, 0.44, 40), [0, 0, 0.6]);
  k.add(M.window, new THREE.CylinderGeometry(3.66, 3.66, 0.05, 40), [0, 0.70, 0.6]);
  k.add(M.window, new THREE.CylinderGeometry(3.66, 3.66, 0.05, 40), [0, -0.70, 0.6]);
  k.add(M.panel, new THREE.CylinderGeometry(1.20, 1.60, 0.60, 20), [0, 3.12, 0.6]);
  k.add(M.trim, plateGeo(1.10, 0.70, 1.40, 0.06, 2), [0, 3.70, 0.7]);
  k.add(M.panel, plateGeo(0.50, 0.60, 0.60, 0.05, 2), [0, 4.30, 0.5]);
  k.add(M.window, plateGeo(0.90, 0.05, 0.05, 0.01, 1), [0, 3.80, 0.02]);
  k.add(M.dark, new THREE.CylinderGeometry(0.03, 0.05, 1.20, 6), [0, 5.10, 0.5]);
  k.add(M.panel, new THREE.CylinderGeometry(1.40, 0.90, 0.70, 20), [0, -3.20, 0.6]);
  k.add(M.hull, plateGeo(2.20, 1.60, 7.20, 0.10, 4), [0, 0, 6.60]);
  k.add(M.dark, plateGeo(2.30, 0.30, 6.80, 0.04, 2), [0, 0.86, 6.60]);
  k.add(M.window, plateGeo(2.26, 0.04, 6.00, 0.01, 1), [0, 0.40, 6.60]);
  k.add(M.window, plateGeo(2.26, 0.04, 6.00, 0.01, 1), [0, -0.40, 6.60]);
  k.pair((sx) => k.add(M.trim, plateGeo(0.40, 1.20, 6.40, 0.05, 2), [sx * 1.30, 0, 6.60]));
  /* THE HANGARS on both faces of the ring: the deck's own on the outer face
   * of the starboard-aft quarter first, then the rest — bays every few
   * hundred metres, the way the ring is in every plate of it. */
  const onRing = (a, r, y, w, h, out) => {
    const nx = Math.sin(a) * (out ? 1 : -1), nz = Math.cos(a) * (out ? 1 : -1);
    return hangarMouth(k, M, [r * Math.sin(a), y, r * Math.cos(a)], [nx, 0, nz], w, h);
  };
  hangars.push(onRing(0.95, R1, -0.10, 1.60, 0.90, true));
  for (const a of [-0.95, 1.55, -1.55, 2.15, -2.15, 0.45, -0.45]) hangars.push(onRing(a, R1, -0.10, 1.20, 0.72, true));
  for (const a of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) hangars.push(onRing(a, R0, -0.05, 1.30, 0.78, false));
  for (const sx of [1, -1]) {
    const a = sx > 0 ? A1 : A0, rm = (R0 + R1) / 2;
    const nx = Math.cos(a), nz = -Math.sin(a);
    const fn = sx > 0 ? [nx, 0, nz] : [-nx, 0, -nz];
    hangars.push(hangarMouth(k, M, [rm * Math.sin(a) + fn[0] * 0.66, 0, rm * Math.cos(a) + fn[2] * 0.66], fn, 2.60, 1.60));
  }
  k.bake(g, { silhouette: true });

  /* THE ENGINE BANK across the rear of the ring: three clusters of three on
   * the outer face astern, the core's own pair under the spine's root. */
  const ke = new Kit();
  for (const a of [-0.34, 0, 0.34]) {
    for (const y of [-0.95, 0, 0.95]) {
      const x = R1 * Math.sin(a), z = R1 * Math.cos(a);
      const nx = Math.sin(a), nz = Math.cos(a);
      /* the nozzle's axis is turned onto +z in the GEOMETRY, so the yaw `a`
       * then carries it radial — a Kit rotation of [π/2, a, 0] applies the
       * yaw first and the roll after, and every nozzle pointed dead aft */
      ke.add(M.dark, new THREE.CylinderGeometry(0.40, 0.46, 0.70, 16).rotateX(1.5708), [x + nx * 0.30, y, z + nz * 0.30], [0, a, 0]);
      ke.add(M.trim, new THREE.TorusGeometry(0.45, 0.04, 6, 18), [x + nx * 0.64, y, z + nz * 0.64], [0, a, 0]);
      ke.add(M.glow, new THREE.CircleGeometry(0.34, 18), [x + nx * 0.68, y, z + nz * 0.68], [0, a, 0]);
    }
  }
  for (const x of [-0.70, 0.70]) {
    ke.add(M.dark, new THREE.CylinderGeometry(0.30, 0.34, 0.50, 14), [x, -1.10, 3.60], [1.5708, 0, 0]);
    ke.add(M.glow, new THREE.CircleGeometry(0.24, 16), [x, -1.10, 3.88]);
  }
  ke.bake(g, { silhouette: true });

  g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; } });
  g.userData.side = 'separatist';
  g.userData.length = 3170;
  g.userData.scale = 0.01;
  g.userData.hangars = hangars;
  if (!opts.fresh) { _droidCapitalTemplate = g; return _droidCapitalTemplate.clone(true); }
  return g;
}
/* ══════════════════════════════════════════════════════════════════════ */
/*  Which army rides which hull — ONE table, and the only place it is asked */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE SINGLE DECISION, AND WHY IT IS HERE RATHER THAN AT THE CALL SITES.
 *
 * There are two places in the game that put the player inside a hull —
 * `ExtractionDirector._makeShip` and `_makeSpace` — and both of them reach a
 * builder through `Arrivals.js`'s injection seam, which `Levels.js` registers
 * exactly once with `setTransportModel(buildTransport)`. The obvious way to
 * add a second hull is `side === 'separatist' ? a : b` at each of those, which
 * is two copies of one rule and is the ninth instance of HANDOFF §2.3 waiting
 * to happen: the day a third army or a second capital ship arrives, one of the
 * two branches is updated and the other is not, and nothing says so.
 *
 * So the branch is a TABLE, it is here beside the hulls it names, and the
 * registration in `Levels.js` does not change: `buildTransport` is still the
 * one exported builder and still takes one options object. It gained a `side`.
 * A caller that does not pass one gets the Republic hull, which is what every
 * headless check and every unaligned mode got before this existed and is the
 * same fallback `Command.sideForOrder` documents for a Grey — "somebody has to
 * be at the head of the column".
 *
 * The other end of the decision — WHICH army the player is leading — is
 * likewise one place: `ExtractionDirector._side`. See its note for why it
 * reads `Databank.armyForOrder` rather than `Command.sideForOrder`, which is
 * the same mapping on the same field with an import cycle in front of it.
 */
export const TRANSPORT_BY_SIDE = {
  republic: buildRepublicTransport,
  separatist: buildDroidTransport,
};

export const CAPITAL_BY_SIDE = {
  republic: buildRepublicCapital,
  separatist: buildDroidCapital,
};

/** The hull an unaligned caller gets. See the note above `TRANSPORT_BY_SIDE`. */
export const DEFAULT_HULL_SIDE = 'republic';

/** One lookup, one fallback, both tables — so neither can drift from the other. */
function hullFor(table, side) { return table[side] || table[DEFAULT_HULL_SIDE]; }

/** The troop transport the given army rides. Registered by `Levels.js`. */
export function buildTransport(opts = {}) { return hullFor(TRANSPORT_BY_SIDE, opts.side)(opts); }

/** The warship it falls away from. Same seam, same table, same fallback. */
export function buildCapitalShip(opts = {}) { return hullFor(CAPITAL_BY_SIDE, opts.side)(opts); }

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE GIANTS                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * "I WANT SOME VEHICLES AND/OR CREATURES THAT ARE TRULY LARGE AND GIANT."
 *
 * The player, in full, because every decision in the six hundred lines below
 * answers one clause of it:
 *
 *   "I want some vehicles and/or creatures that are truly large and giant like
 *    AT-AT or AT-M6 sized but obviously not those since they werent in the
 *    prequels, if needed come up with your own, they should be incredibly
 *    deadly and dangerous and difficult to take down, some piloted obvously…
 *    all of these need to be accurate and act/move/fire differently as canon"
 *
 * ── WHAT "AT-AT SIZED" ACTUALLY ASKS FOR, WHICH IS NOT WHAT THE NUMBERS SAY ─
 *
 * An AT-AT is 20 m long and 22.5 m tall and an AT-M6 is 35 m tall, so the
 * player's own yardstick is a machine somewhere between twenty and thirty-five
 * metres. Four of the five subjects they named come in under that at 1:1 and
 * ONE of them is 140.2 m, which is 35% of the width of every playfield in this
 * game, four times the shadow cascade and twice the far edge of the widest
 * spawn ring. Built at 1:1 it would not be a machine, it would be the map.
 *
 * The reference is not unanimous about that figure either, and the disagreement
 * is the way out. 140.2 m is the databank length; a scaling analysis taken off
 * the Geonosis footage puts the SPHA at 34-38 m long and about 20 m tall, which
 * is a factor of four out and is also exactly the size the player asked for. So
 * the SPHA is built at 1:4 of the databank figure — 35.0 m — where those two
 * readings agree, and `tools/checks/giants.mjs` states the ratio in its output
 * every run rather than leaving it as a decision somebody has to find.
 *
 * The Juggernaut gets the same treatment for the same reason at half the depth:
 * 49.4 m at 1:1 is longer than the Colosseum's floor is wide, so it is built at
 * 1:2. The other three are built at 1:1, because at 1:1 they are already the
 * size the note asks for:
 *
 *   MACHINE            CANON                       BUILT      SCALE
 *   SPHA               140.2 m long, 12 legs       35.0 m     1:4
 *   HAVw A6 Juggernaut 49.4 × 19.6 × 30.4, 10 wh   24.7 m     1:2
 *   Octuptarra magna   14.59 m tall, 3 legs        14.6 m     1:1
 *   NR-N99 Persuader   10.96 × 6.2, one tread      11.0 m     1:1
 *   AT-TE              13.2 × 10.2 × 5.02, 6 legs  13.5 m     1:1  (already here)
 *
 * ── THE AT-TE WAS ALREADY HERE AND IT WAS RIGHT ABOUT TWO THINGS IN THREE ──
 *
 * "(might already be in the game idk)". It is, and the audit is worth recording
 * because two of the three numbers the player quoted were already met and the
 * third was not:
 *
 *     canon 13.2 m long   built 13.5   +2%
 *     canon  5.02 m tall  built  5.7   +14%   (the mass driver is what is over)
 *     canon 10.2 m wide   built  7.9   -23%   ← wrong, and fixed below
 *
 * Its six laser turrets were already right (four in spherical housings on the
 * prow, two aft), and so was the dorsal mass driver on a ring behind a
 * triangular shield plate. What it had never had is the machine's single most
 * quoted property: MAGNETISED FOOTPADS, which is why an AT-TE climbs a cliff
 * and drives up the outside of a Venator. That is `grade: 1` now, and it is
 * the only body in the game that declares it.
 *
 * The 13.2 / 5.02 figures come from the Cross-Sections, which measures the hull
 * at 12.4 and the machine at 13.2 with the guns. A later databank entry gives
 * 22.02 × 9.7 instead — a genuinely disputed machine — and the pair the player
 * quoted is the pair this file builds to, both because they asked for it and
 * because the shipped hull was already within 2% of the length.
 *
 * ── EACH ONE MOVES DIFFERENTLY, AND THE DIFFERENCE IS FOUR NUMBERS ────────
 *
 * This is the clause the whole item turns on, and "a twelve-legged artillery
 * platform that walks like the six-legged one" is a real risk rather than a
 * rhetorical one: every big body in this game goes through one `_poseWalker`
 * and one `_move`, and until the giants landed those two functions knew exactly
 * two facts about a machine — how fast it walks, and whether it is `big`.
 *
 * Four fields in `Enemy.js` carry the rest, and every one of them is a NUMBER a
 * suite can read off a driven body rather than a state name:
 *
 *   CONTACTS   what the machine stands on. 12 legs / 10 wheels / 3 legs / a
 *              tread and two pontoons / 6 legs. Counted off the rig, never off
 *              a list.
 *   plant      the SPHA banks 1.6 s of stillness before it may fire and holds
 *              station through the whole 2.6 s charge, so the fraction of its
 *              life spent moving inside its own band is near zero where every
 *              other machine's is near one.
 *   turnRate   seconds to come about. 0.45 for a tank on one tread (11.6 s),
 *              9.0 for a tri-droid on a rotating hub (0.58 s) — the reference
 *              says "almost instantly" and that is the number that means it.
 *   grade      the steepest ground it is built for. 1.0 for magnetised
 *              footpads, 0.22 for ten wheels, which is the difference between
 *              climbing the crate in front of you and going round it.
 *
 * ── AND HOW EACH ONE DIES, WHICH IS THE OTHER HALF OF "DIFFICULT" ─────────
 *
 * "Deadly and dangerous and difficult to take down" is easy to build badly:
 * multiply the health pool and the player learns nothing. Every one of these
 * has a STATED answer, it is written in the builder's own header, and
 * `giants.mjs` asserts that the answer is reachable — that the bone it names is
 * a bone a standing player's blade can meet, and that the number of them the
 * chassis needs to lose is under the number it has.
 *
 *     SPHA        five legs of twelve, and the window is its own charge: it
 *                 cannot move for 2.6 s and its gun cannot depress.
 *     Juggernaut  four wheels of ten. It cannot climb and cannot come about, so
 *                 anything you can put between you and it is cover it has to
 *                 drive the long way round.
 *     Tri-droid   ONE leg. Straight out of the reference — "if one was damaged,
 *                 the entire droid would topple over" — and it is the fastest
 *                 kill on the roster against a body 14.6 m tall.
 *     Snail tank  the tread. One chain, so one cut beaches it; the outriggers
 *                 are `hull` and cutting one buys nothing.
 *     AT-TE       three legs of six, unchanged.
 *
 * ── WHAT THEY COST, BECAUSE A 35 m MACHINE IS NOT ALLOWED TO COST 35 m ────
 *
 * Everything below goes through `Kit`, which merges one mesh per material per
 * bone, exactly like every other hull in this file. The draw calls that remain
 * are the ones `Enemy.capsules()` needs: it emits ONE capsule per bone that
 * carries geometry, so merging the SPHA's twelve legs into the hull would
 * delete the only way the machine can be killed. That is why the artillery is
 * the most expensive body in the game and why nothing else here is near it —
 * `giants.mjs` prints the count for all five every run, and `heavyLimit` is
 * what bounds how many are on the field at once.
 *
 * ── WHAT WAS LOOKED AT AND DELIBERATELY NOT BUILT ────────────────────────
 *
 * "Look up other vehicles/mechs/monsters that we could be mssing." Four came
 * close and each was refused for a reason rather than for a budget:
 *
 *   AT-AP     a three-legged Republic gun platform with a retractable third leg
 *             it plants to fire. It is the SPHA's mechanic at a tenth of the
 *             size and the tri-droid's silhouette at half of it, which makes it
 *             the one addition that would have been a reskin of two machines at
 *             once.
 *   AT-OT     an eight-legged open troop transport. It is an AT-TE with the
 *             guns off and no mechanic of its own.
 *   Zillo     a hundred-metre armoured reptile off Malastare, and the one
 *             CREATURE at this scale in the era. It is a genuine gap and it is
 *             not a vehicle: it belongs with the menagerie in Bodies.js and
 *             `BEAST_MOVES`, not in a file about chassis, and half of what
 *             makes it interesting is that it cannot be hurt from the front.
 *   Core ship a Trade Federation sphere. It is scenery, and this game already
 *             learned what happens when a level is an interior.
 */

/* ══════════════════════════════════════════════════════════════════════ */
/*  5. SPHA — the Republic's siege gun                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A GUN WITH A CHASSIS UNDER IT, AND THE CHASSIS IS THE SMALL PART.
 *
 * Everything else in this file is a vehicle carrying a weapon. The SPHA is the
 * other way round: the turbolaser is the machine and the twelve legs are, in
 * the reference's own words, "mobile support structures" — they exist to walk
 * the gun between firing positions and to hold it still while it shoots. So
 * the proportions are decided by that and not by taste:
 *
 *   THE LEGS ARE TINY. Twelve of them, in six rows a side, each 3.2 m of a
 *     35 m machine — under a tenth of its length, where an AT-TE's are a
 *     quarter of its. They read as a centipede's rather than as a walker's,
 *     which is the only silhouette in this game that could not be mistaken for
 *     the six-legged one at any distance.
 *   THE BELLY IS WALKABLE. 3.1 m of clearance under a hull 11.6 m wide, which
 *     is the counter-play: the one place a siege gun cannot shoot is directly
 *     under itself, and twelve legs at ground level is what you find there.
 *   THE GUN ASSEMBLY IS A THIRD OF THE HEIGHT. A deep cradle, a ribbed
 *     accelerator running most of the hull's length, and the emitter bell out
 *     over the prow. Nothing on this machine is a turret: a turbolaser this
 *     size traverses by walking, which is why `turnRate` is 0.62 — the slowest
 *     thing on the roster except a tank on one tread — and why
 *     getting behind it is worth doing.
 *
 * IT IS PILOTED, and the plates say so in the one way this file can build: a
 * glazed gunnery house sits on the deck behind the cradle with a lit interior.
 * The reference puts "no less than 30 clone troopers" inside one.
 */
export function buildSPHA(opts = {}) {
  const S = opts.scale ?? 4.0;
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.34, 0, 0.62],
    prow: [0.30, 2.30, 0.55],
    stern: [0.30, -2.30, 0.55],
    head: [1.00, 0.10, 0.90],
    legs: 12, rows: [4.05, 2.50, 0.95, -0.60, -2.15, -3.70],
    hipX: 0.74, hipY: 0.06,
    /* No tarsus worth the name, and that is a draw-call decision stated out
     * loud. Twelve legs is twenty-four bones with geometry on them already; a
     * third bone a leg would be thirty-six meshes of foot on a body that has
     * to share a frame with a wave. The pad is merged into the SHANK instead,
     * at the tip where the tarsus would have been, so the blade still meets a
     * foot and the stance plants the tibia on the floor (`ankle: 0`). */
    femur: 0.36, tibia: 0.44, tarsus: 0.02, splay: 0.90, rise: 0.28,
  }), { scale: S });

  const shell = armorMat(0xb2a892, 0.08, 0.60, 1.1);
  const dark = metalMat(0x3a3934, 0.46, 0.9, 1.8);
  const mark = armorMat(0x7c3226, 0.06, 0.62, 1.4);
  const glass = glassMat(0x16202a, 0.14);
  const hot = emissiveMat(0x6fd0ff, 2.2);
  const scorch = scorchMat();

  chassis(rig, dark, 1.1, 0.24, 7.4, S);

  /* ── the mid hull: a long flat weapons deck ── */
  const body = rig.get('body');
  const mid = assemble([
    [plateGeo(2.90 * S, 0.86 * S, 2.60 * S, 0.16 * S, 2), [0, 0.14 * S, 0]],
    // the raised spine the accelerator lies in
    [plateGeo(1.30 * S, 0.44 * S, 2.40 * S, 0.10 * S, 1), [0, 0.72 * S, 0.10 * S]],
    // the belly, deliberately flat and high — this is the part you walk under
    [plateGeo(2.50 * S, 0.26 * S, 2.20 * S, 0.10 * S, 1), [0, -0.34 * S, 0]],
  ]);
  primary(body, mid, shell, 1.55 * S);

  const km = new Kit();
  km.pair((sx) => {
    // the six radiator stacks a side that a machine drawing this much power has
    km.row(6, (i, t) => km.add(dark, ventGeo(0.36 * S, 0.42 * S, 0.06 * S, 4),
      [sx * 1.47 * S, 0.18 * S, (t - 0.5) * 2.20 * S], [0, sx * 1.5708, 0]));
    km.add(mark, plateGeo(0.02 * S, 0.26 * S, 0.90 * S, 0.006 * S, 1), [sx * 1.48 * S, 0.52 * S, 0.90 * S]);
    // the walkway rail down each flank, which is what says "thirty crew"
    km.add(dark, new THREE.CylinderGeometry(0.025 * S, 0.025 * S, 4.60 * S, 5), [sx * 1.46 * S, 0.74 * S, 0], [1.5708, 0, 0]);
  });
  for (let i = 0; i < 5; i++) {
    const sx = rng() < 0.5 ? -1 : 1;
    const w = (0.20 + rng() * 0.34) * S;
    km.add(scorch, plateGeo(0.006 * S, w, w * 0.8, 0.002 * S, 1),
      [sx * 1.46 * S, (0.02 + rng() * 0.50) * S, (rng() - 0.5) * 2.4 * S]);
  }
  km.bake(body.obj);

  /* ── the prow: the emitter end, and the gunnery house ── */
  const prow = rig.get('prow');
  const front = assemble([
    [plateGeo(2.70 * S, 0.78 * S, 2.60 * S, 0.16 * S, 2), [0, 0.10 * S, -0.10 * S]],
    [plateGeo(2.10 * S, 0.50 * S, 1.10 * S, 0.14 * S, 1), [0, -0.06 * S, 1.60 * S], [0.20, 0, 0]],
    [plateGeo(2.40 * S, 0.24 * S, 2.20 * S, 0.10 * S, 1), [0, -0.34 * S, -0.10 * S]],
  ]);
  primary(prow, front, shell, 1.45 * S);

  const kp = new Kit();
  // THE GUNNERY HOUSE — the piloted part, glazed on three sides
  kp.add(shell, plateGeo(1.40 * S, 0.62 * S, 1.10 * S, 0.12 * S, 1), [0, 0.78 * S, -0.50 * S]);
  kp.add(glass, plateGeo(1.24 * S, 0.26 * S, 0.96 * S, 0.05 * S, 1), [0, 0.86 * S, -0.50 * S]);
  kp.add(mark, plateGeo(1.30 * S, 0.10 * S, 0.04 * S, 0.01 * S, 1), [0, 1.06 * S, 0.06 * S]);
  kp.pair((sx) => {
    // the two anti-personnel barbettes that keep infantry off the legs
    kp.add(dark, new THREE.SphereGeometry(0.22 * S, 10, 7), [sx * 1.10 * S, 0.30 * S, 1.10 * S]);
    kp.add(dark, new THREE.CylinderGeometry(0.045 * S, 0.055 * S, 0.90 * S, 7), [sx * 1.10 * S, 0.30 * S, 1.52 * S], [1.5708, 0, 0]);
    kp.add(shell, plateGeo(0.30 * S, 0.44 * S, 1.60 * S, 0.08 * S, 1), [sx * 1.16 * S, 0.24 * S, -0.30 * S]);
  });
  /* NOT tagged silhouette, and that is a budget decision with a reason. The
   * gunnery house, the barbettes and the flank sponsons are 1.4 m of detail on
   * a 35 m machine — at the range this thing is fought at (its own band opens
   * at 45 m) they are four draw calls of nothing. The GUN is the outline and
   * it is the only thing here that is kept. */
  kp.bake(prow.obj);

  /* ── the stern: the reactor block ── */
  const stern = rig.get('stern');
  primary(stern, assemble([
    [plateGeo(2.80 * S, 0.92 * S, 2.50 * S, 0.16 * S, 2), [0, 0.16 * S, 0.10 * S]],
    [plateGeo(2.30 * S, 0.70 * S, 0.80 * S, 0.12 * S, 1), [0, 0.10 * S, -1.30 * S], [0.24, 0, 0]],
    [plateGeo(2.40 * S, 0.24 * S, 2.10 * S, 0.10 * S, 1), [0, -0.34 * S, 0.10 * S]],
  ]), shell, 1.50 * S);
  const ks = new Kit();
  ks.add(dark, ventGeo(2.00 * S, 0.60 * S, 0.08 * S, 7), [0, 0.28 * S, -1.60 * S], [0.24, Math.PI, 0]);
  ks.pair((sx) => {
    ks.add(dark, new THREE.CylinderGeometry(0.20 * S, 0.22 * S, 0.60 * S, 10), [sx * 0.90 * S, 0.86 * S, -0.90 * S], [0.24, 0, 0]);
    ks.add(hot, new THREE.CylinderGeometry(0.16 * S, 0.17 * S, 0.06 * S, 10), [sx * 0.90 * S, 1.14 * S, -0.98 * S], [0.24, 0, 0]);
  });
  ks.bake(stern.obj);

  /* ── the gun ──
   * A deep cradle on the head bone, a ribbed accelerator lying along the spine,
   * and the emitter bell out over the prow. It is tagged silhouette entire,
   * because at a hundred and fifteen metres — which is where this machine
   * fights — the gun IS the machine and the hull under it is a smudge. */
  const head = rig.get('head');
  const cradle = assemble([
    [plateGeo(1.70 * S, 1.00 * S, 1.50 * S, 0.14 * S, 1), [0, 0.42 * S, 0]],
    [new THREE.CylinderGeometry(0.52 * S, 0.58 * S, 1.20 * S, 12), [0, 0.42 * S, 0], [0, 0, 1.5708]],
  ]);
  primary(head, cradle, shell, 0.90 * S);

  const kg = new Kit();
  // the accelerator: a long ribbed tube running forward out of the cradle
  kg.add(dark, new THREE.CylinderGeometry(0.34 * S, 0.40 * S, 3.40 * S, 12), [0, 0.62 * S, 1.90 * S], [1.5708, 0, 0]);
  kg.row(9, (i, t) => kg.add(shell, new THREE.CylinderGeometry(0.46 * S, 0.46 * S, 0.10 * S, 12),
    [0, 0.62 * S, (0.55 + t * 2.70) * S], [1.5708, 0, 0]));
  // the emitter bell
  kg.add(dark, new THREE.CylinderGeometry(0.62 * S, 0.36 * S, 0.62 * S, 12), [0, 0.62 * S, 3.90 * S], [1.5708, 0, 0]);
  kg.add(hot, new THREE.CylinderGeometry(0.40 * S, 0.40 * S, 0.06 * S, 12), [0, 0.62 * S, 4.20 * S], [1.5708, 0, 0]);
  // the two capacitor banks flanking the cradle, and the rangefinder mast that
  // is the tallest thing on the machine
  kg.pair((sx) => {
    kg.add(shell, plateGeo(0.44 * S, 0.90 * S, 2.20 * S, 0.10 * S, 1), [sx * 1.00 * S, 0.44 * S, 0.70 * S]);
    kg.add(hot, plateGeo(0.06 * S, 0.50 * S, 0.10 * S, 0.02 * S, 1), [sx * 1.23 * S, 0.44 * S, 0.30 * S]);
  });
  kg.add(dark, new THREE.CylinderGeometry(0.03 * S, 0.05 * S, 1.30 * S, 6), [0, 1.42 * S, -0.60 * S]);
  kg.add(dark, plateGeo(0.60 * S, 0.06 * S, 0.24 * S, 0.02 * S, 1), [0, 2.02 * S, -0.60 * S]);
  kg.bake(head.obj, { silhouette: true });
  const muzzle = mesh(new THREE.CylinderGeometry(0.30 * S, 0.26 * S, 0.14 * S, 10), dark, head.obj,
    [0, 0.62 * S, 4.42 * S], [1.5708, 0, 0]);

  /* ── twelve legs ──
   * One merged mesh per bone, plus ONE more on the shank for the armour plate
   * that has to be a different colour from what it covers. That is 36 draw
   * calls of leg instead of the sixty a Kit per bone would have cost, and it is
   * why the largest machine in the game is cheaper to draw than the AT-TE. The
   * knee housing, the hip yoke, the hydraulic ram and the foot are all inside
   * the merges rather than beside them. */
  for (let i = 0; i < 12; i++) {
    const femur = rig.get(`femur${i}`);
    const tibia = rig.get(`tibia${i}`);
    const sx = i % 2 === 0 ? 1 : -1;
    const F = femur.length, T = tibia.length;

    /* THE THIGH IS ONE MERGED STRUT AND CARRIES NO WEAK POINT, which is a
     * budget decision taken deliberately and in one direction. A weak point has
     * to be VISIBLE — `weakpoints.mjs` holds every spot to being at least half
     * an albedo band away from the tube it is a hole in, or a five-band
     * posterise renders the gap and the plate as one flat field and there is
     * nothing on screen to aim at — and two colours on a bone means two meshes
     * on it. Twelve thighs plated is twelve more draw calls for a joint three
     * metres up under the hull's own shadow. The SHANK is the part a player
     * standing beside this machine is actually looking at, and it is where the
     * twelve go instead. */
    primary(femur, assemble([
      // the hip yoke, standing proud of the hull like a rowlock
      [new THREE.CylinderGeometry(0.20 * S, 0.20 * S, 0.22 * S, 10), [sx * 0.04 * S, 0, 0], [0, 0, 1.5708]],
      [plateGeo(0.16 * S, F * 0.92, 0.24 * S, 0.05 * S, 1), [0, F * 0.48, 0]],
      [new THREE.CylinderGeometry(0.15 * S, 0.15 * S, 0.20 * S, 10), [0, F, 0], [0, 0, 1.5708]],
    ]), dark, 0.19 * S);

    const tm = primary(tibia, assemble([
      // the bare shank itself — this is the tube the plate is cover OVER
      [new THREE.CylinderGeometry(0.17 * S, 0.14 * S, T, 8), [0, T * 0.5, 0]],
      // the hydraulic ram down the back of the shank
      [new THREE.CylinderGeometry(0.06 * S, 0.06 * S, T * 0.62, 6), [0, T * 0.40, -0.13 * S]],
      /* THE PAD, merged in BELOW the shank's tip where a tarsus would have
       * been. A machine that weighs what this one does spreads its load, so it
       * is a rectangular shoe rather than a claw — and it hangs off the end of
       * the bone rather than sitting up it, which is the half that decides
       * whether it goes through the floor.
       *
       * IT IS A BALL AND NOT A PLATE, and that is arithmetic rather than
       * taste. A flat pad on a leg that is not vertical dips its downhill
       * corner by half its own width times the sine of the lean, and these legs
       * lean about 25° to reach their plant radius: measured, a 1.8 m plate put
       * 0.23 m of itself through the sand on five legs of twelve, and lifting
       * the whole foot to clear that left the pad visibly floating on the legs
       * that were NOT leaning. A sphere's lowest point does not move when you
       * tilt it, so the ball is what touches the ground and the shoe above it
       * never reaches. `ankle` in the stance below is the ball's own drop. */
      [new THREE.CylinderGeometry(0.20 * S, 0.15 * S, 0.10 * S, 10), [0, T - 0.01 * S, 0]],
      [new THREE.SphereGeometry(0.13 * S, 10, 8), [0, T + 0.05 * S, 0]],
    ]), dark, 0.22 * S);
    tm.userData.limb = { r0: 0.17 * S, r1: 0.14 * S, seg: 8 };
    /* THE PLATE IS ITS OWN MESH IN ITS OWN COLOUR, and that is the whole cost
     * of the twelve joints this machine's counter-play runs through: bone-white
     * armour over a dark shank, so the two ends the plate does not reach read
     * as gaps rather than as more leg. A 0.80T plate centred at 0.46T spans
     * 0.06T to 0.86T — short of the knee housing and short of the ankle,
     * because a leg swings at both. */
    const kl = new Kit();
    kl.add(shell, plateGeo(0.42 * S, T * 0.80, 0.30 * S, 0.05 * S, 1), [0, T * 0.46, 0]);
    kl.bake(tibia.obj);
    platedSpan(tibia, T * 0.06, T * 0.86);
  }

  const stance = chassisStance(S, {
    legs: 12, hipHeight: 0.72, step: 0.24, lift: 0.08, rear: 0.30, bob: 0.006,
    plantX: 1.00, plantZ: [4.20, 2.60, 0.98, -0.62, -2.24, -3.86],
    /* `ankle` LIFTS THE TARGET BY HOWEVER FAR THE SOLE HANGS BELOW THE TIP, and
     * on this machine there is no tarsus to hang — the pad is inside the
     * shank's own merge, seated 0.11 of scale past the end of the bone. So the
     * number is the pad's own reach plus the margin the lean costs it (see the
     * note on the pad), and it is the same field the AT-TE uses for the same
     * arithmetic on a bone that does exist. */
    ankle: 0.18, toe: 0.04,
    poleX: 1.45, poleY: 0.55, poleZ: 0,
  });
  return {
    rig, muzzles: [muzzle], scale: S, stance,
    palette: { shell, dark, mark, scorch, eye: hot },
    proxy: hullProxy(rig, stance.hipHeight, ['body', 'prow', 'stern']),
  };
}


/* ══════════════════════════════════════════════════════════════════════ */
/*  6. HAVw A6 Juggernaut — the Clone Turbo Tank                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * TEN WHEELS, TWO COCKPITS AND A TOWER — AND IT IS THE FASTEST THING ON THE
 * FIELD THAT WEIGHS ANYTHING.
 *
 * Canon: 49.4 m long, 19.6 m wide, 30.4 m tall, ten wheels, 160 km/h, twelve
 * crew, three hundred passengers. Built at 1:2 for the reason the header gives
 * — 49.4 m is longer than the Colosseum's floor — so 24.7 × 9.8 × 15.2, and
 * every one of those three ratios is held rather than just the length. The
 * tower being 62% of the machine's own length is the proportion that reads
 * from a kilometre away and it is the first thing to go if only the footprint
 * is checked, so `giants.mjs` checks all three.
 *
 * ── THE FOUR CUES, AND WHY EACH IS A CUE AND NOT A DETAIL ────────────────
 *
 *   TEN WHEELS IN FIVE ROWS, all the same diameter, all outboard of the hull
 *     and all TALLER than the belly is high. That is the whole reason a Turbo
 *     Tank does not read as a box on tracks: you can see the ground through it
 *     between the axles.
 *   TWO COCKPITS, one at each end, both glazed, both facing outward. The
 *     machine drives either way without turning round, which is the design's
 *     own answer to a 25 m wheelbase that cannot come about — and it is why
 *     `turnRate` is 0.90 and why the hull is symmetric fore and aft where the
 *     AT-TE's very deliberately is not.
 *   THE OBSERVATION TOWER, a boxed mast off the spine with a glazed cab on top
 *     and a dish above that. It is the tallest thing in the game and it is a
 *     `hull` bone, so a blade can take it off.
 *   THE DORSAL TURRET, the one thing on it that traverses, and the only weapon
 *     of the several it carries that this file gives a barrel to.
 *
 * ── HOW A PLAYER KILLS IT ────────────────────────────────────────────────
 *
 * FOUR WHEELS OF TEN, and the way you get to them is that it cannot climb and
 * cannot turn. `grade: 0.22` refuses it any prop taller than a step, so a crate,
 * a spire or a felled trunk is cover it has to drive the long way round; while
 * it is doing that it is presenting a flank of five wheels at knee height, and
 * every one of them is a `leg` chain. It is the only machine on the roster
 * whose counter-play is the LEVEL rather than the body.
 */
export function buildJuggernaut(opts = {}) {
  const S = opts.scale ?? 2.6;
  const WR = 0.80 * S;                     // road-wheel radius — 2.08 m at 1:2
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.34, 0, 0.70],
    prow: [0.30, 2.78, 0.62],
    stern: [0.30, -2.78, 0.62],
    head: [1.05, 0.30, 0.55],
    legs: 0,
    struts: [
      /* THE OBSERVATION TOWER IS A BONE, not a decoration on the hull, and the
       * reason is `Enemy.capsules()`: a bone with geometry gets a capsule, and
       * a fifteen-metre mast that no blade can touch is fifteen metres of lie.
       * `hull` rather than `leg` — losing the tower blinds the tank, it does
       * not drop it. */
      { name: 'tower', parent: 'body', x: 0, y: 1.02, z: -1.10, len: 2.40, rest: [0, 1, 0] },
    ],
    wheels: [
      { name: 'wheel0', x: 1.28, y: 0.05, z: 2.45, len: 0.34, dir: 1 },
      { name: 'wheel1', x: -1.28, y: 0.05, z: 2.45, len: 0.34, dir: -1 },
      { name: 'wheel2', x: 1.28, y: 0.05, z: 1.25, len: 0.34, dir: 1 },
      { name: 'wheel3', x: -1.28, y: 0.05, z: 1.25, len: 0.34, dir: -1 },
      { name: 'wheel4', x: 1.28, y: 0.05, z: 0.05, len: 0.34, dir: 1 },
      { name: 'wheel5', x: -1.28, y: 0.05, z: 0.05, len: 0.34, dir: -1 },
      { name: 'wheel6', x: 1.28, y: 0.05, z: -1.15, len: 0.34, dir: 1 },
      { name: 'wheel7', x: -1.28, y: 0.05, z: -1.15, len: 0.34, dir: -1 },
      { name: 'wheel8', x: 1.28, y: 0.05, z: -2.35, len: 0.34, dir: 1 },
      { name: 'wheel9', x: -1.28, y: 0.05, z: -2.35, len: 0.34, dir: -1 },
    ],
  }), { scale: S });

  const shell = armorMat(0xb8ad95, 0.08, 0.58, 1.2);
  const dark = metalMat(0x3b3a35, 0.48, 0.9, 2.0);
  const mark = armorMat(0x7c3226, 0.06, 0.62, 1.6);
  const glass = glassMat(0x141c22, 0.15);
  const tread = metalMat(0x2c2924, 0.72, 0.86, 4.4);
  const hot = emissiveMat(0xff8a30, 1.3);

  chassis(rig, dark, 1.0, 0.26, 5.6, S);

  /* ── the mid hull: a deep slab-sided box with a stepped deck ── */
  const body = rig.get('body');
  primary(body, assemble([
    [plateGeo(3.00 * S, 1.50 * S, 2.40 * S, 0.18 * S, 2), [0, 0.30 * S, 0]],
    [plateGeo(2.50 * S, 0.34 * S, 2.20 * S, 0.10 * S, 1), [0, 1.16 * S, -0.10 * S]],
    [plateGeo(3.20 * S, 0.30 * S, 2.00 * S, 0.12 * S, 1), [0, -0.30 * S, 0]],
  ]), shell, 1.70 * S);

  const km = new Kit();
  km.pair((sx) => {
    // the mudguard shelf over the wheel bays — the line that makes ten wheels
    // read as ten wheels rather than as a skirt
    km.add(shell, plateGeo(0.70 * S, 0.16 * S, 2.40 * S, 0.05 * S, 1), [sx * 1.52 * S, 0.62 * S, 0]);
    km.add(mark, plateGeo(0.02 * S, 0.22 * S, 0.80 * S, 0.006 * S, 1), [sx * 1.51 * S, 0.90 * S, 0.60 * S]);
    km.add(dark, ventGeo(0.80 * S, 0.44 * S, 0.06 * S, 5), [sx * 1.51 * S, 0.24 * S, -0.90 * S], [0, sx * 1.5708, 0]);
    // the anti-personnel repeaters along the flank, which is what a tank
    // carrying three hundred troopers actually spends its ammunition on
    km.row(3, (i, t) => km.add(dark, new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 0.50 * S, 6),
      [sx * 1.56 * S, 0.86 * S, (t - 0.5) * 1.80 * S], [0, sx * 1.5708, 0]));
  });
  km.bake(body.obj);

  /* ── the two cockpits: prow and stern, and they are the SAME ──
   * A Juggernaut drives either way. The forward and aft ends differ only in
   * what is bolted on behind the glass, which is the opposite of every other
   * hull in this file and is the cue that says which machine this is. */
  const cab = (bone, sign) => {
    primary(bone, assemble([
      [plateGeo(2.80 * S, 1.34 * S, 2.40 * S, 0.20 * S, 2), [0, 0.26 * S, 0]],
      [plateGeo(2.20 * S, 0.90 * S, 1.00 * S, 0.18 * S, 1), [0, 0.34 * S, sign * 1.25 * S], [sign * -0.24, 0, 0]],
    ]), shell, 1.55 * S);
    const k = new Kit();
    k.add(glass, plateGeo(1.90 * S, 0.40 * S, 0.06 * S, 0.02 * S, 1), [0, 0.56 * S, sign * 1.70 * S], [sign * -0.24, 0, 0]);
    k.add(mark, plateGeo(2.00 * S, 0.16 * S, 0.05 * S, 0.015 * S, 1), [0, 0.92 * S, sign * 1.62 * S], [sign * -0.24, 0, 0]);
    k.add(dark, plateGeo(1.20 * S, 0.26 * S, 0.30 * S, 0.06 * S, 1), [0, -0.30 * S, sign * 1.60 * S], [sign * 0.30, 0, 0]);
    k.pair((sx) => {
      k.add(dark, new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 0.80 * S, 6),
        [sx * 0.86 * S, -0.16 * S, sign * 1.70 * S], [sign * 1.5708, 0, 0]);
      k.add(shell, plateGeo(0.26 * S, 0.70 * S, 1.90 * S, 0.06 * S, 1), [sx * 1.44 * S, 0.30 * S, 0]);
    });
    k.bake(bone.obj, { silhouette: true });
  };
  cab(rig.get('prow'), 1);
  cab(rig.get('stern'), -1);

  /* ── the dorsal heavy laser turret ── */
  const head = rig.get('head');
  primary(head, assemble([
    [new THREE.CylinderGeometry(0.62 * S, 0.70 * S, 0.24 * S, 14), [0, 0.04 * S, 0]],
    [plateGeo(1.00 * S, 0.56 * S, 1.10 * S, 0.14 * S, 1), [0, 0.36 * S, 0]],
  ]), shell, 0.72 * S);
  const kt = new Kit();
  kt.add(dark, new THREE.CylinderGeometry(0.20 * S, 0.20 * S, 0.50 * S, 10), [0, 0.40 * S, 0.44 * S], [1.5708, 0, 0]);
  kt.pair((sx) => {
    kt.add(dark, new THREE.CylinderGeometry(0.07 * S, 0.085 * S, 1.60 * S, 8), [sx * 0.20 * S, 0.40 * S, 1.32 * S], [1.5708, 0, 0]);
    kt.add(mark, new THREE.CylinderGeometry(0.10 * S, 0.10 * S, 0.14 * S, 8), [sx * 0.20 * S, 0.40 * S, 0.86 * S], [1.5708, 0, 0]);
  });
  kt.add(glass, plateGeo(0.60 * S, 0.16 * S, 0.05 * S, 0.015 * S, 1), [0, 0.52 * S, -0.56 * S]);
  kt.bake(head.obj, { silhouette: true });
  const muzzles = [1, -1].map((sx) => mesh(new THREE.CylinderGeometry(0.075 * S, 0.065 * S, 0.12 * S, 8), dark, head.obj,
    [sx * 0.20 * S, 0.40 * S, 2.16 * S], [1.5708, 0, 0]));

  /* ── the tower ── */
  const tower = rig.get('tower');
  const TW = tower.length;
  primary(tower, assemble([
    [plateGeo(0.62 * S, TW, 0.62 * S, 0.08 * S, 1), [0, TW * 0.5, 0]],
    // the glazed cab on top, wider than the mast under it
    [plateGeo(1.10 * S, 0.60 * S, 1.10 * S, 0.14 * S, 1), [0, TW + 0.28 * S, 0]],
  ]), shell, 0.44 * S);
  const kw = new Kit();
  kw.row(4, (i, t) => kw.add(dark, plateGeo(0.68 * S, 0.07 * S, 0.68 * S, 0.02 * S, 1), [0, TW * (0.14 + t * 0.62), 0]));
  kw.pair((sx) => kw.add(glass, plateGeo(0.05 * S, 0.28 * S, 0.90 * S, 0.02 * S, 1), [sx * 0.55 * S, TW + 0.30 * S, 0]));
  kw.add(glass, plateGeo(0.90 * S, 0.28 * S, 0.05 * S, 0.02 * S, 1), [0, TW + 0.30 * S, 0.55 * S]);
  // the dish above the cab, which is the top of the tallest body in the game
  kw.add(dark, new THREE.CylinderGeometry(0.035 * S, 0.05 * S, 0.50 * S, 6), [0, TW + 0.80 * S, 0]);
  kw.add(shell, new THREE.SphereGeometry(0.34 * S, 12, 6, 0, TAU, 0, Math.PI * 0.5), [0, TW + 1.02 * S, 0], [0.5, 0, 0], [1, 0.5, 1]);
  kw.bake(tower.obj, { silhouette: true });

  /* ── ten road wheels ──
   * ONE MESH EACH, and the mesh is the bone's own primary rather than a hoop in
   * a child group. That is what keeps a ten-wheeled machine at ten draw calls
   * of wheel instead of twenty, and it works because a road wheel's axle IS the
   * bone's local +Y: the bone points outboard, a cylinder's axis is +Y, so
   * turning the mesh about its own y is exactly rolling.
   *
   * ONE DRIVER for all ten (see `rollByOdometry`). Ten callbacks integrating
   * the same displacement separately would come apart the first time one of
   * them was culled, and on a machine this long several of them always are. */
  const wheels = [];
  for (let i = 0; i < 10; i++) {
    const bone = rig.get(`wheel${i}`);
    const A = bone.length;
    const tyre = primary(bone, assemble([
      [new THREE.CylinderGeometry(WR, WR, 0.44 * S, 14), [0, 0, 0]],
      [new THREE.CylinderGeometry(WR * 0.42, WR * 0.42, 0.50 * S, 10), [0, 0, 0]],
      ...Array.from({ length: 12 }, (_, j) => {
        const a = (j / 12) * TAU;
        /* 0.92 and not 0.99. A 0.10-of-scale block centred on the rim reaches
         * half its own thickness PAST it, and at 0.99 that put 11 cm of every
         * tyre through the floor — a machine on ten wheels sunk into the sand
         * by the width of a tread block, on every wheel, forever. */
        return [plateGeo(0.30 * S, 0.46 * S, 0.10 * S, 0.02 * S, 1),
          [Math.sin(a) * WR * 0.92, 0, Math.cos(a) * WR * 0.92], [0, a, 0]];
      }),
      ...Array.from({ length: 5 }, (_, j) => {
        const a = (j / 5) * TAU;
        return [plateGeo(0.06 * S, 0.30 * S, WR * 0.90, 0.02 * S, 1),
          [Math.sin(a) * WR * 0.48, 0, Math.cos(a) * WR * 0.48], [0, a, 0]];
      }),
    ]), tread, WR);
    tyre.position.y = A;
    /**
     * THE AXLE IS THE SOFT PART, and it is declared rather than derived because
     * there is no limb plate here to leave a gap: a road wheel is not a limb
     * with armour strapped to it, it is a wheel on a stub.
     *
     * The bone runs OUTBOARD from the hull and the tyre is a single mesh at its
     * tip, so the whole run between the two — the axle housing, the hub carrier,
     * the brake — is bare metal a player standing beside the tank is looking
     * straight at. Declared out of the same `A` that positions the tyre, so it
     * cannot drift from the geometry (`weakSpotsOf` and player note 35).
     *
     * It is on a `leg` bone, so `_turnCut` does not turn a pass that lands in
     * it — unlike the AAT's intakes, which sit on an axial bone and only buy
     * speed. This is a real opening, and it is the one the Juggernaut's own
     * counter-play depends on: four wheels of ten, and each of them is a
     * one-pass job at the axle instead of a five-pass job through the tyre.
     */
    weakSpot(bone, {
      key: 'axle', label: 'AXLE',
      p0: [0, 0.10 * A, 0], p1: [0, 0.74 * A, 0],
      r: 0.26 * S, at0: 0.10, at1: 0.74,
    });
    /* …AND IT IS PAINTED SO THE PLAYER CAN FIND IT. `weakpoints.mjs` holds
     * every spot to being at least half an albedo band away from the surface it
     * is a hole in, because the cel pass quantises to five flat fields and two
     * near colours posterise into one. A dark axle against a dark tyre is a
     * weak point nobody can see; a bone-white hub carrier in the wheel bay is
     * the same part, visible, and it is one merged mesh a wheel. */
    const ka = new Kit();
    ka.add(shell, new THREE.CylinderGeometry(0.26 * S, 0.21 * S, 0.52 * A, 10), [0, 0.42 * A, 0]);
    ka.bake(bone.obj);
    wheels.push({ bone, hoop: tyre, radius: WR });
  }
  rollByOdometry(wheels[0].hoop, wheels.map((w) => w.hoop), WR);

  const stance = chassisStance(S, {
    legs: 0, hipHeight: 0.75, step: 0, lift: 0, rear: 0.22, bob: 0.014,
    plantX: 0, plantZ: [], ankle: 0, toe: 0, poleX: 0, poleY: 0, poleZ: 0,
  });
  return {
    rig, muzzles, wheels, scale: S, wheelRadius: WR, stance,
    palette: { shell, dark, mark, scorch: tread, eye: hot },
    proxy: hullProxy(rig, stance.hipHeight, ['body', 'prow', 'stern']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  7. Octuptarra magna tri-droid — the Techno Union's artillery          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THREE LEGS, AND THAT IS THE MACHINE AND ALSO THE WAY TO KILL IT.
 *
 * 14.59 m tall, built at 1:1, and the only body in this game whose height is
 * three times its own width. Everything about it is decided by the fact that
 * almost all of that height is EMPTY: a bulbous head on three enormously long
 * thin legs, with nothing in between. Read against the hailfire, which is the
 * other machine here made mostly of air — that one is 5.7 m of wheel with the
 * pod slung low, this is 11 m of leg with the mass at the very top.
 *
 *   THE HEAD IS A SPHERE AND IT IS FULL. Cognitive modules and the ammunition
 *     for the launchers both live inside it, which is why a magna tri-droid's
 *     head is fat where the small combat tri-droid's is a ball on a stalk.
 *   THREE PHOTORECEPTORS, 120° apart around the equator. The reference is
 *     explicit about what they buy: "no blind spots… almost impossible for
 *     enemy troopers to attack by surprise from behind."
 *   THREE CANNONS, likewise 120° apart, likewise pointing everywhere at once,
 *     so the machine never needs to face you — which is why `turnRate` is 9.0
 *     and not because it is nimble. It is a hub that rotates, on legs that
 *     never have to reposition.
 *   IT FIRES DOWN. The cannons are 12 m up and its band opens at 10 m, so a
 *     player standing under one is shot at from 50° above the horizontal. It
 *     is the only body in the game whose bolts arrive from overhead, and
 *     `giants.mjs` measures the angle rather than asserting the intent.
 *
 * ── HOW A PLAYER KILLS IT: ONE LEG ───────────────────────────────────────
 *
 * Straight out of the reference — "its three-legged design was its primary
 * weakness, as if one was damaged, the entire droid would topple over" — and
 * it is `toppleAt: 1`, which is a number nothing else on the roster carries
 * with more than one leg. Fourteen and a half metres of artillery goes down to
 * a single pass through a shin, and the shins are 0.30 m thick and standing on
 * the floor. It is the fastest kill in the game against anything this size and
 * it is meant to be: the machine's answer is that it fires at you from ten
 * metres up while you walk to it.
 */
export function buildTriDroid(opts = {}) {
  const S = opts.scale ?? 2.2;
  const HIP_R = 0.34, PLANT_R = 1.75;
  const legAt = (i) => (i / 3) * TAU;                      // 0°, 120°, 240°
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.85, 0, 0.90],
    head: [0.02, 0, 0.62],
    legPlan: [0, 1, 2].map((i) => {
      const a = legAt(i);
      return {
        x: Math.sin(a) * HIP_R, z: Math.cos(a) * HIP_R,
        rest: [Math.sin(a) * 0.86, 0.50, Math.cos(a) * 0.86],
      };
    }),
    hipY: 0.02, femur: 2.45, tibia: 2.70, tarsus: 0.26,
  }), { scale: S });

  /* Techno Union hardware is finished rather than painted — the same argument
   * `hmpMaterials` makes one hull along — but a shade cooler and greener than
   * the Confederacy's foundry bronze, because the Skakoans built this one and
   * the plates of a magna tri-droid are a pale grey-green over bare alloy. */
  const shell = armorMat(0x8e9385, 0.10, 0.60, 1.4);
  const dark = metalMat(0x33352f, 0.52, 0.9, 2.6);
  const alloy = metalMat(0x6d6f63, 0.44, 0.88, 2.2);
  const eye = emissiveMat(0xff2418, 3.6);
  const scorch = scorchMat();

  chassis(rig, dark, 0.50, 0.20, 0.50, S);

  /* ── the head ──
   * A sphere with a heavy equatorial band, a flattened crown and a machined
   * underside where the three legs socket in. */
  const body = rig.get('body');
  primary(body, assemble([
    [new THREE.SphereGeometry(0.95 * S, 18, 12), [0, 0, 0], null, [1, 1.02, 1]],
    [bandGeo(0.90 * S, 1.00 * S, 0.90 * S, 1.00 * S, 0.22 * S, 18), [0, -0.10 * S, 0]],
    [new THREE.CylinderGeometry(0.52 * S, 0.62 * S, 0.26 * S, 14), [0, -0.90 * S, 0]],
  ]), shell, 1.00 * S);

  const kb = new Kit();
  for (let i = 0; i < 3; i++) {
    const a = legAt(i) + Math.PI / 3;      // between the legs, not over them
    const sx = Math.sin(a), cz = Math.cos(a);
    // THE PHOTORECEPTOR — housing, lens, and a hood over it
    kb.add(dark, new THREE.CylinderGeometry(0.30 * S, 0.28 * S, 0.10 * S, 14),
      [sx * 0.90 * S, 0.10 * S, cz * 0.90 * S], [1.5708, a, 0]);
    kb.add(eye, new THREE.SphereGeometry(0.24 * S, 12, 9),
      [sx * 0.95 * S, 0.10 * S, cz * 0.95 * S], null, [1, 1, 0.55]);
    kb.add(shell, plateGeo(0.60 * S, 0.10 * S, 0.26 * S, 0.03 * S, 1),
      [sx * 0.92 * S, 0.32 * S, cz * 0.92 * S], [0.42, a, 0]);
    // the hip socket each leg comes out of
    const b = legAt(i);
    kb.add(alloy, new THREE.SphereGeometry(0.26 * S, 10, 8),
      [Math.sin(b) * 0.62 * S, -0.72 * S, Math.cos(b) * 0.62 * S]);
  }
  kb.add(alloy, new THREE.CylinderGeometry(0.40 * S, 0.46 * S, 0.16 * S, 14), [0, 0.92 * S, 0]);
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU, w = (0.16 + rng() * 0.18) * S;
    kb.add(scorch, plateGeo(w, 0.006 * S, w * 0.8, 0.002 * S, 1),
      [Math.sin(a) * 0.92 * S, (rng() - 0.4) * 0.9 * S, Math.cos(a) * 0.92 * S], [1.1, a, 0]);
  }
  kb.bake(body.obj);

  /* ── the three cannons ──
   * On the HEAD bone, which `_poseWalker` yaws onto the target — so the whole
   * ring turns and whichever barrel is nearest the line is the one facing you.
   * That is the reference's "rotating multi-jointed assemblies" built out of
   * the one mechanism this file has, and it is why the machine reads as having
   * no front. */
  const head = rig.get('head');
  primary(head, assemble([
    [new THREE.CylinderGeometry(0.56 * S, 0.62 * S, 0.30 * S, 16), [0, 0, 0]],
  ]), alloy, 0.62 * S);
  const kh = new Kit();
  const muzzles = [];
  for (let i = 0; i < 3; i++) {
    const a = legAt(i) + Math.PI / 3;
    const sx = Math.sin(a), cz = Math.cos(a);
    kh.add(dark, plateGeo(0.34 * S, 0.30 * S, 0.44 * S, 0.06 * S, 1),
      [sx * 0.62 * S, 0, cz * 0.62 * S], [0, a, 0]);
    kh.add(dark, new THREE.CylinderGeometry(0.09 * S, 0.11 * S, 1.20 * S, 8),
      [sx * 1.30 * S, -0.10 * S, cz * 1.30 * S], [1.5708, a, 0]);
    kh.add(alloy, new THREE.CylinderGeometry(0.15 * S, 0.15 * S, 0.14 * S, 8),
      [sx * 0.92 * S, -0.10 * S, cz * 0.92 * S], [1.5708, a, 0]);
    muzzles.push(mesh(new THREE.CylinderGeometry(0.095 * S, 0.085 * S, 0.12 * S, 8), dark, head.obj,
      [sx * 1.92 * S, -0.10 * S, cz * 1.92 * S], [1.5708, a, 0]));
  }
  kh.bake(head.obj, { silhouette: true });

  /* ── the three legs ──
   * Long, thin, and made of two tubes with a visible knee. They are 0.30 m
   * across on a machine 14.6 m tall — the thinnest load-bearing thing in the
   * game — and that is both why the silhouette reads as legs-and-a-ball and
   * why one pass takes one off. */
  for (let i = 0; i < 3; i++) {
    const femur = rig.get(`femur${i}`);
    const tibia = rig.get(`tibia${i}`);
    const tarsus = rig.get(`tarsus${i}`);
    const F = femur.length, T = tibia.length, P = tarsus.length;

    const fm = primary(femur, limbGeo(F, 0.15 * S, 0.12 * S, 8, true, { rings: 5, bulge: 0.08, bulgeAt: 0.16 }), alloy, 0.16 * S);
    fm.userData.limb = { r0: 0.15 * S, r1: 0.12 * S, seg: 8 };
    const kf = new Kit();
    kf.add(dark, new THREE.CylinderGeometry(0.17 * S, 0.17 * S, 0.20 * S, 10), [0, F, 0], [0, 0, 1.5708]);
    // the plate strapped down the outside of the thigh, and the two joints it
    // deliberately leaves bare — see `platedSpan` and player note 35
    kf.add(shell, plateGeo(0.13 * S, F * 0.70, 0.20 * S, 0.04 * S, 1), [0, F * 0.46, 0.05 * S]);
    platedSpan(femur, F * 0.11, F * 0.81);
    kf.bake(femur.obj);

    const tm = primary(tibia, limbGeo(T, 0.12 * S, 0.09 * S, 8, true, { rings: 5, bulge: 0.07, bulgeAt: 0.20 }), dark, 0.13 * S);
    tm.userData.limb = { r0: 0.12 * S, r1: 0.09 * S, seg: 8 };
    const kt2 = new Kit();
    kt2.add(alloy, new THREE.CylinderGeometry(0.028 * S, 0.028 * S, T * 0.70, 6), [0, T * 0.44, -0.10 * S]);
    kt2.add(shell, plateGeo(0.11 * S, T * 0.56, 0.16 * S, 0.03 * S, 1), [0, T * 0.40, 0.04 * S]);
    platedSpan(tibia, T * 0.12, T * 0.68);
    kt2.bake(tibia.obj);

    /* A NARROW SPIKED FOOT — this machine does not spread its load, it stands
     * on three points. Built at the tarsus tip and flipped, with the stance's
     * `ankle` lifting the target by however far the tarsus drops, exactly as
     * the AT-TE's pad is. */
    primary(tarsus, assemble([
      [new THREE.CylinderGeometry(0.22 * S, 0.07 * S, 0.30 * S, 8), [0, P - 0.15 * S, 0]],
      [plateGeo(0.34 * S, 0.05 * S, 0.34 * S, 0.02 * S, 1), [0, P - 0.28 * S, 0]],
    ]), alloy, 0.16 * S);
  }

  const stance = chassisStance(S, {
    hipHeight: 4.75, step: 1.20, lift: 0.52, rear: 0.40, bob: 0.030,
    ankle: 0.26, toe: 0.10,
    plantPlan: [0, 1, 2].map((i) => {
      const a = legAt(i);
      return {
        x: Math.sin(a) * PLANT_R, z: Math.cos(a) * PLANT_R,
        pole: [Math.sin(a) * 2.4, 1.9, Math.cos(a) * 2.4],
      };
    }),
  });
  return {
    rig, muzzles, scale: S, stance,
    palette: { shell, dark, mark: alloy, scorch, eye },
    proxy: hullProxy(rig, stance.hipHeight, ['body']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  8. NR-N99 Persuader-class droid enforcer — the snail tank             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ONE TREAD, AND EVERYTHING ELSE IS AN OUTRIGGER.
 *
 * 10.96 m long, 6.2 m tall, 60 km/h, built at 1:1. The Corporate Alliance's
 * droid tank is the only ground machine in either army that runs on a SINGLE
 * high-traction tread down its own centreline, with two outrigger pylons
 * carrying small pontoon treads to stop it tipping over. Everything
 * interesting about how it fights follows from that:
 *
 *   IT CANNOT TURN. One tread means it pivots by dragging, and `turnRate: 0.45`
 *     is the slowest number in the game — half a turn takes 11.6 s, where a
 *     man does it in 0.65. So it commits: it picks a line, it drives it at
 *     5 m/s, and a player who steps off that line has several seconds before
 *     it can do anything about it. The AAT hovers and can face any way it
 *     likes; this is the opposite machine at the same job.
 *   IT COMES TO YOU. Its band is 4-18 m, the closest of any Confederate
 *     machine except the dwarf spider droid, because heavy repeating blasters
 *     and concussion launchers are short-ranged and because a tank that cannot
 *     turn has to be pointed at something.
 *   IT IS TALL FOR ITS LENGTH. 6.2 m on 10.96 — the tread alone is over half
 *     the height, which is what makes the silhouette a wheel with a hull
 *     balanced on it rather than a tank.
 *
 * ── HOW A PLAYER KILLS IT: ANY ONE OF ITS THREE GROUND CONTACTS ─────────
 *
 * `toppleAt: 1` against three chains — the tread and the two outrigger
 * pontoons — so the FIRST one lost puts the machine on its side, permanently,
 * because `Enemy.recover` will not stand a walker back up that has lost a leg.
 * That is the whole design of a single-tread vehicle stated as a rule: the
 * pontoons exist to stop it tipping, so taking one is how you tip it, and the
 * two out on arms are lower and closer than the tread is. The two drive
 * sprockets are the fast way through the tread itself if you would rather have
 * that one — they are the only place the belt is not lying flat against
 * armour, and a pass there is one swing where the belt is four.
 *
 * See the note on `struts` below for what this cost to get right and for the
 * measurement that changed it.
 */
export function buildSnailTank(opts = {}) {
  const S = opts.scale ?? 1.55;
  const rig = new Rig(chassisSkeleton(S, {
    body: [0.30, 0, 0.55],
    head: [0.88, 0.10, 0.50],
    legs: 0,
    struts: [
      /* THE TREAD, and it is the one `leg` on the machine. It hangs from the
       * hull to the floor as an UPRIGHT bone placed by its offset — see the
       * long note over `chassisSkeleton` about why nothing here points along
       * ±Z — so the track geometry is authored in the identity frame with +Z
       * forward, which is what a fore-and-aft track needs. */
      { name: 'wheelC', parent: 'hips', x: 0, y: -2.28, z: 0, len: 2.28, rest: [0, 1, 0], role: 'leg' },
      /**
       * ── AND THE OUTRIGGERS ARE `leg` TOO, WHICH IS THE OPPOSITE OF WHAT
       *    THIS FILE FIRST WROTE AND IS WHAT MEASURING IT SETTLED ─────────
       *
       * They were `hull` on the argument that a pontoon carries nothing and
       * only the tread does the work, so the tank should have exactly one leg
       * chain and one cut should beach it. Driven, that is not what one chain
       * buys: `severance` prices a leg at `1.10 x share / of`, `of` is the
       * number of leg BONES on the body, and one bone makes the tread worth
       * 1.10 — over the 0.9 at which `takeCut` kills outright. So the machine
       * the header called "difficult to take down" died to a single pass, and
       * `weakpoints.mjs` printed it: `snailtank joint 1p/0t/0L`, one pass, no
       * legs lost, no topple, because there was no body left to topple.
       *
       * Three chains prices the tread at 0.367 — a wound rather than a kill —
       * and `toppleAt: 1` still clamps the chassis to going down on the FIRST
       * one lost. That is both the better fight and the better reading of the
       * machine: an outrigger on a single-tread vehicle is there to stop it
       * tipping over, so taking one is exactly how you tip it over. The tank
       * has three points on the ground, any one of them ends it, and the two
       * out on arms are the ones a blade reaches first.
       */
      /* THE ARMS REACH DOWN AND NOT OUT, and that is an accuracy fix as well as
       * a reachability one. Every plate of an NR-N99 has the outrigger pontoons
       * running on the GROUND beside the tread — they are a third and fourth
       * contact patch, not sponsons — and the first cut of this hung them at
       * 2.7 m on short arms angled slightly down. Measured through
       * `tools/balance.mjs`, which filters every capsule to what a standing
       * player's blade can actually reach: at 2.7 m they were above the
       * ceiling, so the ONLY thing on the machine a player could touch was the
       * tread, worth 0.37 of it, and the model reported the tank as unkillable
       * over its own plate. The databank page had already promised the
       * opposite in as many words — "the pontoons are the low ones". */
      { name: 'outL', parent: 'hips', x: 0.72, y: -0.30, z: 0.55, len: 2.00, rest: [0.62, -0.78, 0], role: 'leg' },
      { name: 'outR', parent: 'hips', x: -0.72, y: -0.30, z: 0.55, len: 2.00, rest: [-0.62, -0.78, 0], role: 'leg' },
    ],
  }), { scale: S });

  const shell = armorMat(0x8a7f6c, 0.18, 0.62, 2.0);
  const dark = metalMat(0x3c352b, 0.52, 0.9, 2.6);
  const rust = armorMat(0x76432a, 0.10, 0.74, 3.2);
  const track = metalMat(0x2b2823, 0.74, 0.86, 5.2);
  const eye = emissiveMat(0xff3010, 3.2);
  const scorch = scorchMat();

  chassis(rig, dark, 0.60, 0.22, 2.60, S);

  /* ── the hull: a hunched shell riding the tread ── */
  const body = rig.get('body');
  primary(body, assemble([
    [plateGeo(2.30 * S, 1.10 * S, 3.00 * S, 0.30 * S, 2), [0, 0.14 * S, 0]],
    [plateGeo(1.70 * S, 0.50 * S, 2.20 * S, 0.22 * S, 1), [0, 0.76 * S, -0.10 * S], [-0.10, 0, 0]],
    [plateGeo(1.90 * S, 0.40 * S, 1.20 * S, 0.20 * S, 1), [0, -0.06 * S, 1.60 * S], [0.34, 0, 0]],
  ]), shell, 1.30 * S);

  const kb = new Kit();
  kb.pair((sx) => {
    kb.add(dark, ventGeo(0.70 * S, 0.44 * S, 0.06 * S, 4), [sx * 1.16 * S, 0.16 * S, -0.80 * S], [0, sx * 1.5708, 0]);
    kb.add(rust, plateGeo(0.02 * S, 0.34 * S, 0.90 * S, 0.006 * S, 1), [sx * 1.17 * S, 0.44 * S, 0.50 * S]);
    // the concussion missile box on each shoulder, four tubes visible
    kb.add(dark, plateGeo(0.40 * S, 0.44 * S, 0.80 * S, 0.08 * S, 1), [sx * 0.94 * S, 0.72 * S, -0.60 * S]);
    kb.row(2, (i, t) => kb.add(track, new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 0.30 * S, 7),
      [sx * (0.84 + t * 0.20) * S, 0.80 * S, -0.28 * S], [1.5708, 0, 0]));
  });
  for (let i = 0; i < 3; i++) {
    const sx = rng() < 0.5 ? -1 : 1, w = (0.14 + rng() * 0.22) * S;
    kb.add(scorch, plateGeo(0.006 * S, w, w * 0.8, 0.002 * S, 1),
      [sx * 1.17 * S, (rng() - 0.2) * 0.8 * S, (rng() - 0.5) * 2.4 * S]);
  }
  kb.bake(body.obj);

  /* ── the gun mount: twin heavy repeaters and the droid's own eye ── */
  const head = rig.get('head');
  primary(head, assemble([
    [plateGeo(1.10 * S, 0.60 * S, 0.90 * S, 0.16 * S, 1), [0, 0.10 * S, 0]],
    [new THREE.CylinderGeometry(0.34 * S, 0.38 * S, 0.24 * S, 12), [0, -0.16 * S, 0]],
  ]), shell, 0.58 * S);
  const kh = new Kit();
  const muzzles = [];
  kh.pair((sx) => {
    kh.add(dark, new THREE.CylinderGeometry(0.07 * S, 0.085 * S, 1.50 * S, 8), [sx * 0.30 * S, 0.06 * S, 0.90 * S], [1.5708, 0, 0]);
    kh.add(dark, new THREE.CylinderGeometry(0.13 * S, 0.13 * S, 0.26 * S, 8), [sx * 0.30 * S, 0.06 * S, 0.30 * S], [1.5708, 0, 0]);
    muzzles.push(mesh(new THREE.CylinderGeometry(0.075 * S, 0.065 * S, 0.10 * S, 8), dark, head.obj,
      [sx * 0.30 * S, 0.06 * S, 1.70 * S], [1.5708, 0, 0]));
  });
  kh.add(eye, new THREE.SphereGeometry(0.12 * S, 9, 7), [0, 0.30 * S, 0.42 * S]);
  kh.add(shell, plateGeo(0.50 * S, 0.14 * S, 0.20 * S, 0.04 * S, 1), [0, 0.44 * S, 0.36 * S], [0.4, 0, 0]);
  kh.bake(head.obj, { silhouette: true });

  /* ── the tread ──
   * A long lozenge: two drive sprockets at the ends, a flat run between them,
   * and the track belt wrapped round the outside. The belt is one merged mesh;
   * the sprockets spin off the same odometry the Juggernaut's wheels do, so a
   * tank that is moving looks like one and a beached tank does not. */
  const tread = rig.get('wheelC');
  const TH = tread.length;                       // hull height above the floor
  const RR = TH * 0.48;                          // sprocket radius
  primary(tread, assemble([
    [plateGeo(1.10 * S, RR * 1.60, 6.20 * S, 0.20 * S, 1), [0, RR, 0]],
    ...Array.from({ length: 22 }, (_, i) => {
      /* the belt: shoes laid round a lozenge — a half circle at each end and a
       * straight run top and bottom. Authored as one merge, so the whole track
       * is one draw call. */
      const t = i / 22, a = t * TAU;
      const z = Math.sin(a) * 3.42 * S;
      /* The y radius is short by half a shoe, because a shoe lying flat at the
       * BOTTOM of the belt spans its own thickness either side of the line it
       * is centred on — laid on the radius itself, every track on the machine
       * cuts 10 cm into the ground. */
      const y = RR + Math.cos(a) * (RR - 0.09 * S);
      return [plateGeo(1.24 * S, 0.16 * S, 0.42 * S, 0.03 * S, 1), [0, y, z], [-a, 0, 0]];
    }),
  ]), track, 1.10 * S);

  const kc = new Kit();
  /* The track guard down each side of the belt, in HULL colour rather than
   * track colour — it is what the sprocket weak point is read against, and a
   * dark guard over a dark belt is a spot the cel pass posterises away. */
  kc.pair((sx) => kc.add(shell, plateGeo(0.10 * S, RR * 1.30, 5.90 * S, 0.05 * S, 1), [sx * 0.58 * S, RR, 0]));
  kc.bake(tread.obj);

  /* The two sprockets, each in a group laid over by a quarter turn so the
   * group's local +Y lies along the machine's X — which makes the mesh inside
   * roll about its own y and lets `rollByOdometry` drive it with no second
   * code path. */
  const sprockets = [];
  /* THE SPROCKETS ARE WHERE THE BELT IS THIN, and they are the tank's only
   * weak point because they are the only place the track is not lying flat
   * against armour. Declared here, off the same z the sprocket group is placed
   * at, so the capsule cannot drift from the wheel it is a hole in — and on
   * the `leg` bone, so a pass through one is not turned. Cutting the tread is
   * what beaches this machine (`toppleAt: 1`); this is where you do it. */
  for (const z of [2.545, -2.545]) {
    const g = new THREE.Group();
    g.position.set(0, RR, z * S);
    g.rotation.z = Math.PI / 2;
    tread.obj.add(g);
    const spin = new THREE.Group();
    g.add(spin);
    const ks = new Kit();
    ks.add(dark, new THREE.CylinderGeometry(RR * 0.80, RR * 0.80, 0.92 * S, 12));
    // six teeth, so a turning sprocket reads as turning rather than as a disc
    ks.row(6, (i, t) => ks.add(track, plateGeo(0.10 * S, 0.96 * S, RR * 0.34, 0.02 * S, 1),
      [Math.sin(t * TAU) * RR * 0.82, 0, Math.cos(t * TAU) * RR * 0.82], [0, t * TAU, 0]));
    ks.bake(spin, { silhouette: true });
    weakSpot(tread, {
      key: z > 0 ? 'sprocketF' : 'sprocketA', label: 'SPROCKET',
      p0: [-0.50 * S, RR, z * S], p1: [0.50 * S, RR, z * S],
      r: RR * 0.62, at0: RR / TH, at1: RR / TH,
    });
    sprockets.push(spin);
  }
  rollByOdometry(sprockets[0].children[0], sprockets, RR * 0.80);

  /* ── the two outrigger pylons ── */
  for (const name of ['outL', 'outR']) {
    const bone = rig.get(name);
    const L = bone.length;
    const sx = name === 'outL' ? 1 : -1;
    primary(bone, assemble([
      [plateGeo(0.22 * S, L * 0.94, 0.44 * S, 0.06 * S, 1), [0, L * 0.47, 0]],
      // the pontoon track at the tip: a small lozenge lying fore and aft
      [plateGeo(0.44 * S, 0.50 * S, 1.60 * S, 0.16 * S, 1), [0, L + 0.10 * S, -0.55 * S]],
      [new THREE.CylinderGeometry(0.25 * S, 0.25 * S, 0.46 * S, 10), [0, L + 0.10 * S, 0.25 * S], [0, 0, 1.5708]],
    ]), track, 0.30 * S);
    const ko = new Kit();
    ko.add(rust, plateGeo(0.26 * S, 0.30 * S, 0.30 * S, 0.05 * S, 1), [sx * 0.02 * S, L * 0.12, 0]);
    ko.bake(bone.obj);
  }

  const stance = chassisStance(S, {
    legs: 0, hipHeight: 2.28, step: 0, lift: 0, rear: 0.18, bob: 0.020,
    plantX: 0, plantZ: [], ankle: 0, toe: 0, poleX: 0, poleY: 0, poleZ: 0,
  });
  return {
    rig, muzzles, scale: S, stance, sprockets, wheelRadius: RR * 0.80,
    palette: { shell, dark, mark: rust, scorch, eye },
    proxy: hullProxy(rig, stance.hipHeight, ['body']),
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Registration                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE FOUR ROWS, AND WHY NO TWO OF THEM READ ALIKE.
 *
 * `custom: 'walker'` on all four is not a description of how they move — it is
 * the flag `Enemy` reads to (a) route them through `_poseWalker` instead of the
 * biped animator, (b) plate `body` and `hips` to durasteel, and (c) require
 * THREE legs lost before the chassis goes down instead of one. All three are
 * what a vehicle wants; the differences between the four live in the stance each
 * builder publishes and in the cadence rows below.
 *
 * The cadences were chosen so that hearing one is enough to know which is
 * shooting at you, and so that the counter-play differs:
 *
 *   dwarfspider  a fast close pair. Preferred band 5–14 m, so it comes to YOU,
 *                and the answer is that it is the one you can actually reach.
 *   atte         one shot every 4.6 s with a 1.1 s telegraph and 58 damage —
 *                the heaviest single hit in the game, and the only one you are
 *                shown a second in advance. The answer is to not be there.
 *   aat          a two-shell ripple 0.44 s apart. The gap is the point: it is
 *                long enough to be two events rather than a burst, which is what
 *                separates it by ear from the hailfire.
 *   hailfire     seven missiles in half a second at 11 apiece, then 4.2 s of
 *                reload. The biggest volley on the roster and the loosest, at
 *                0.085 of spread, so what it actually costs depends on whether
 *                you were standing still. The answer is the reload, and it is
 *                the only window it gives.
 *
 * Threat and score are priced against `walker` (620 hp, threat 12, score 1600),
 * which is the roster's existing heavy.
 *
 * `grippable: false` ON TWO OF THE FOUR, AND WHY IT IS NOT A SIZE RULE.
 *
 * The Force's lift cap is a mass gate and nothing else — deliberately, because
 * the flat `!A.big && !A.boss` it replaced was a size limit no setting could
 * reach and it was exactly the wall the player complained about. A spider
 * walker at 900 kg, an Acklay at 1400 and a hailfire droid at 1500 all come off
 * the ground at a high enough Force Power, and they should: picking a walker up
 * and putting it down on its back is the payoff the slider is for.
 *
 * An AT-TE is a different kind of object. It is thirteen metres of six-legged
 * siege armour at 3600 kg, and the AAT is a tank at 2400. Neither is a heavy
 * enemy — they are terrain that shoots, the thing the encounter is built to
 * make you move AROUND, and a Force grip that lifts one deletes the encounter
 * rather than winning it. Raising the cap to 3600 kg to satisfy "the slider
 * clears the heaviest body" would have made every other body in the game
 * weightless on the way past.
 *
 * So it is authored rather than derived, and it is read: `Enemy.grippable`
 * takes it, `Player._grippableBody` reads THAT, and the grip answers out loud
 * (`Player.toggleGrip` → 'TOO BIG TO GRIP') instead of doing nothing. The
 * counter-play the refusal names is the one these already have — `custom:
 * 'walker'` drops the chassis at `legsLost >= 3`, so the legs are the answer.
 *
 * `force.mjs` holds the line that keeps this honest: every archetype excluded
 * here must be HEAVIER than the top of the slider, so the flag can never become
 * a way to hide a body the cap ought to have cleared.
 */
/**
 * ── `crew`, AND WHAT DECLARING IT COSTS YOU ──────────────────────────────
 *
 * The player: *"I think we should be able to drive the vehicles it makes sense
 * to drive."* `crew` is the canon number of bodies inside a machine, and its
 * PRESENCE is the whole of the rule — `Driving.isCrewed` reads it and nothing
 * else decides. There is no second list of drivable things to fall out of step
 * with this one, which is the HANDOFF §2.3 trap in its usual clothes.
 *
 * Declared here: the AT-TE (six, plus a spotter's cupola), the AAT (four battle
 * droids in a hull with a hatch — which is why the films are full of droids
 * riding on top of one), the Juggernaut (twelve, in a driver's cabin at EACH
 * end so it never has to turn round) and the SPHA (twenty-five gunners walking
 * a gun the length of a street).
 *
 * Not declared, and this is the interesting half: the dwarf spider, the
 * hailfire, the Octuptarra tri-droid and the Persuader snail tank have NOBODY
 * IN THEM. There is no seat to take and nobody to displace — the brain is the
 * machine. A game rule that let you drive one would contradict the thing the
 * model is of, and "it makes sense" has to mean the player can tell which is
 * which by looking at it.
 */
Object.assign(ARCHETYPES, {
  dwarfspider: {
    label: 'Dwarf Spider Droid', build: buildDwarfSpider, scale: 1.5,
    hp: 340, mass: 520, speed: 3.2, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    fireRate: 1.0, burst: 2, burstGap: 0.09, spread: 0.05, damage: 17,
    preferred: [5, 14], boltColor: BOLT_COLORS.red,
    score: 900, threat: 7, big: true, unlockAt: 3,
  },
  atte: {
    label: 'AT-TE Walker', build: buildATTE, scale: 2.0, crew: 6,
    hp: 1500, mass: 3600, speed: 1.6, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    fireRate: 4.6, burst: 1, burstGap: 0.2, spread: 0.012, damage: 58, telegraph: 1.1,
    preferred: [20, 52], boltColor: BOLT_COLORS.blue,
    score: 3400, threat: 17, big: true, armored: true, grippable: false, unlockAt: 8,
  },
  aat: {
    label: 'Armoured Assault Tank', build: buildAAT, scale: 1.7, crew: 4,
    hp: 1050, mass: 2400, speed: 3.6, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    fireRate: 3.0, burst: 2, burstGap: 0.44, spread: 0.022, damage: 52,
    preferred: [15, 40], boltColor: BOLT_COLORS.red,
    score: 2400, threat: 13, big: true, armored: true, grippable: false, unlockAt: 7,
  },
  hailfire: {
    label: 'Hailfire Droid', build: buildHailfire, scale: 1.7,
    hp: 760, mass: 1500, speed: 5.8, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    fireRate: 4.2, burst: 7, burstGap: 0.07, spread: 0.085, damage: 11,
    preferred: [22, 55], boltColor: BOLT_COLORS.gold,
    score: 1900, threat: 11, big: true, unlockAt: 5,
  },
});


/**
 * ── THE FIVE GIANTS, AND WHY NO TWO OF THEM ARE THE SAME FIGHT ───────────
 *
 * The four rows above are the line vehicles; these are the machines the player
 * asked for by name, and the rule they are held to is the same one plus a
 * clause. `vehicles.mjs` says no two of the four may share a silhouette or a
 * cadence; `tools/checks/giants.mjs` says no two of the FIVE may share a
 * silhouette, a cadence OR A MOVEMENT SIGNATURE, and it measures the third one
 * as four numbers off a driven body rather than as a state name:
 *
 * As `tools/checks/giants.mjs` measures them — spha / juggernaut / tridroid /
 * snailtank / atte, every one off a driven body and none of them read back out
 * of the table that declared it:
 *
 *   contacts   leg chains counted off the rig       12 / 10 / 3 / 3 / 6
 *   duty       share of a driven 14 s in band spent
 *              above a fifth of top pace         0.00 / 0.98 / 0.98 / 0.98 / 0.98
 *   turn       seconds to close half a turn to
 *              within five degrees                 5.8 / 4.0 / 0.4 / 8.0 / 1.1
 *   slope      steepest bank it still makes half
 *              pace on, binary-searched           0.26 / 0.17 / 0.58 / 0.26 / 1.00
 *   pace       metres a second                      1.1 / 7.6 / 3.4 / 5.0 / 1.6
 *
 * ── WHY NONE OF THEM DECLARES `armored` ──────────────────────────────────
 *
 * The AAT and the AT-TE do and it costs them. `_boneToughness` tests
 * `A.armored` BEFORE `A.custom === 'walker'`, and the walker rule is the
 * stronger one — durasteel on `body` and `hips` against the armour flag's
 * heavy — so a `walker` that also says `armored` downgrades its own hips one
 * rung. That is a defect in two rows this workstream did not write and is not
 * going to fix from inside a new one; what it can do is not repeat it. Every
 * giant here is `custom: 'walker'` and nothing else, which is the durasteel
 * hull, `_poseWalker`, and a chassis that needs legs taken off it.
 *
 * ── AND EVERY ONE IS `grippable: false`, WHICH IS A MASS TEST AND NOT A SIZE
 *
 * `force.mjs` holds the line the flag could otherwise be used to dodge: an
 * excluded body must be HEAVIER than the top of the Force slider, so nothing
 * the cap ought to have cleared can hide behind it. The lightest thing here is
 * the tri-droid at 2 600 kg against an AAT's 2 400, which is already excluded,
 * and the SPHA is 9 800. A spider walker at 900 kg and a hailfire at 1 500 are
 * still liftable and still should be — picking a walker up and putting it down
 * on its back is what the slider is for. Nine tonnes of siege artillery is not
 * a heavy enemy, it is terrain that shoots.
 */
Object.assign(ARCHETYPES, {
  spha: {
    /* Its real name, and the variant matters: SPHA-T is the turbolaser, which
     * is the one that shot down core ships over Geonosis. The M, C, I, R and V
     * carried missiles, concussion, ion, rail and a variable mount on the same
     * twelve-legged chassis. */
    label: 'SPHA-T Siege Artillery', build: buildSPHA, scale: 4.0, crew: 25,
    hp: 3200, mass: 9800, speed: 1.1, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    /* ONE SHELL EVERY FOURTEEN SECONDS AT 96, behind a 2.6 s telegraph. 96 and
     * not 100: a player at full health survives a direct hit with four points
     * left, learns exactly what happened, and is given a reason to respect the
     * next one. An instant kill from ninety metres teaches nothing, and this is
     * the longest warning in the game. Spread 0.004 is the tightest on the
     * roster — a gun that has stopped moving to aim does not miss. */
    fireRate: 11.0, burst: 1, burstGap: 0.20, spread: 0.004, damage: 96, telegraph: 2.6,
    preferred: [40, 90], boltColor: BOLT_COLORS.blue,
    plant: 1.6, turnRate: 0.62, grade: 0.34, toppleAt: 5,
    score: 7600, threat: 30, big: true, grippable: false, unlockAt: 14,
  },
  juggernaut: {
    label: 'HAVw A6 Juggernaut', build: buildJuggernaut, scale: 2.6, crew: 12,
    /* 160 km/h in the reference, and the fastest heavy in this game by a wide
     * margin — 7.6 m/s against an AAT's 3.6 and an AT-TE's 1.6. A player cannot
     * outrun it in the open, which is the entire reason `grade: 0.22` matters:
     * the answer is not distance, it is anything it has to drive round. */
    hp: 2400, mass: 6200, speed: 7.6, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    /* TEN BOLTS IN SIX HUNDREDTHS OF A SECOND EACH at 9 apiece. The longest
     * burst on the roster against the hailfire's seven, and it is a stream
     * rather than a salvo — the tank rakes as it drives past, so what it costs
     * depends on how long you are in the beam and not on being hit once. */
    fireRate: 2.6, burst: 10, burstGap: 0.06, spread: 0.05, damage: 9,
    preferred: [14, 38], boltColor: BOLT_COLORS.blue,
    turnRate: 0.90, grade: 0.22, toppleAt: 4,
    score: 5200, threat: 22, big: true, grippable: false, unlockAt: 10,
  },
  tridroid: {
    label: 'Octuptarra Magna Tri-Droid', build: buildTriDroid, scale: 2.2,
    /* THE THINNEST HEALTH POOL OF THE FIVE, deliberately. Its defence is not
     * armour, it is fourteen metres of altitude and three legs a blade has to
     * walk to; once you are at one it comes apart, and that is the trade the
     * reference describes. */
    hp: 1300, mass: 2600, speed: 3.4, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    /* THREE ROUNDS, ONE PER CANNON, 0.28 s apart. The gap is what tells it from
     * everything else by ear: slow enough to hear three separate reports from
     * three separate barrels going round the hub, where the Juggernaut's ten
     * are one noise and the AAT's two are one event repeated. */
    fireRate: 1.9, burst: 3, burstGap: 0.28, spread: 0.035, damage: 22,
    preferred: [10, 46], boltColor: BOLT_COLORS.red,
    turnRate: 9.0, grade: 0.75, toppleAt: 1,
    score: 3200, threat: 16, big: true, grippable: false, unlockAt: 8,
  },
  snailtank: {
    label: 'NR-N99 Persuader Droid Enforcer', build: buildSnailTank, scale: 1.55,
    hp: 1150, mass: 2900, speed: 5.0, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    /* FOUR ROUNDS AT 12, close in. It is the Confederate machine you can
     * actually reach — its band opens at 4 m, inside a blade's walk — and the
     * whole exchange is that it cannot turn to keep you in front of it. */
    fireRate: 1.7, burst: 4, burstGap: 0.14, spread: 0.03, damage: 12,
    preferred: [4, 18], boltColor: BOLT_COLORS.red,
    /* 0.34 OF GRADE AND NOT 0.26, and it is the one number here where a tread
     * beats a wheel: the reference calls it "a high-traction huge central
     * tread", which is what a single wide belt buys and what ten hard road
     * wheels do not have. It is still half of what magnetised footpads take. */
    turnRate: 0.45, grade: 0.34, toppleAt: 1,
    score: 2600, threat: 14, big: true, grippable: false, unlockAt: 6,
  },
});

/**
 * THE FIVE, FOR ANYTHING THAT WANTS TO NAME THEM ALL — and it is a SECOND list
 * rather than four more entries on `VEHICLE_TYPES`, which is a measurement
 * decision and not a taxonomy one.
 *
 * `vehicles.mjs` rasterises every machine on that list into ONE ABSOLUTE WORLD
 * FRAME, 20 m wide by 12 m tall, deliberately shared rather than normalised so
 * that a 2.8 m dwarf spider and a 13.5 m AT-TE are not called identical for
 * having the same proportions. A 34 m SPHA does not fit in that frame: it
 * clips to the full raster, so does the Juggernaut, and every pair involving
 * one of them comes out at an overlap near 1.0 — the suite would fail on four
 * machines that could not look less alike. Widening the frame to hold the SPHA
 * shrinks the four small ones to a handful of pixels and breaks the reading it
 * was built for at the other end.
 *
 * So the giants get their own list and their own suite with its own frame, and
 * the AT-TE appears on BOTH: it is a line vehicle by size and a giant by the
 * player's own request to check it. Nothing is duplicated by that — both lists
 * are read, never written, and `ARCHETYPES` is the single table underneath.
 */
export const GIANT_TYPES = ['spha', 'juggernaut', 'tridroid', 'snailtank', 'atte'];

/**
 * WHAT EACH ONE IS BUILT TO, AND WHAT IT IS BUILT AT — the canon figures in one
 * place, read by `giants.mjs` and by nothing else.
 *
 * It is here rather than in the check for HANDOFF §2.3's reason turned round: a
 * table of reference dimensions kept in a test file is a table the builder
 * cannot be measured against by anything else, and the first person to change
 * a scale would change it in one of the two places. The `scale` column is the
 * claim — "this hull is 1:4 of the databank length" — and the check is what
 * turns the claim into a measurement.
 *
 * `l/w/h` are METRES AT 1:1, exactly as the reference states them, and `built`
 * is the divisor. Where a source disagrees with itself the note says so and
 * says which reading this file took; `null` means the reference does not give
 * that dimension and nothing is asserted about it.
 */
export const GIANT_CANON = {
  spha: {
    name: 'Self-Propelled Heavy Artillery (turbolaser)', side: 'republic',
    l: 140.2, w: null, h: null, built: 4, contacts: 12, contactKind: 'legs',
    /* HOW IT IS MEANT TO DIE, stated so it can be held against the game rather
     * than against a comment. `chains` and `lose` are compared to what the rig
     * has and to what `toppleAt` computes — they are never READ by anything,
     * which is what keeps this from being HANDOFF §2.3's twin — and `says` is
     * the phrase the machine's own databank page has to contain, because an
     * answer the player is never told is not an answer. */
    kill: { chains: 12, lose: 5, at: 'legs', says: ['five', 'legs'] },
    /* 140.2 m is the databank length. A scaling analysis off the Geonosis
     * footage puts the same machine at 34-38 m long and about 20 m tall, which
     * is where 1:4 comes from: the two readings agree there, and 35 m is the
     * size the player's own yardstick ("AT-AT or AT-M6 sized") asks for. */
    ratio: 38 / 20, note: '140.2 m databank; 34-38 m long by 20 m tall on screen',
  },
  juggernaut: {
    name: 'HAVw A6 Juggernaut', side: 'republic',
    l: 49.4, w: 19.6, h: 30.4, built: 2, contacts: 10, contactKind: 'wheels',
    kill: { chains: 10, lose: 4, at: 'wheels', says: ['wheel'] },
    ratio: 49.4 / 30.4, note: 'ten wheels, 160 km/h, two cockpits, 300 troops',
  },
  tridroid: {
    name: 'Octuptarra magna tri-droid', side: 'separatist',
    l: null, w: null, h: 14.59, built: 1, contacts: 3, contactKind: 'legs',
    kill: { chains: 3, lose: 1, at: 'legs', says: ['one leg'] },
    ratio: null, note: 'three legs, three photoreceptors, no blind spot',
  },
  snailtank: {
    name: 'NR-N99 Persuader-class droid enforcer', side: 'separatist',
    /* THREE GROUND CONTACTS AND NOT ONE, which is what the reference actually
     * describes: "a high-traction huge central tread, augmented on either side
     * by forward-mounted outrigger wheels on a pontoon tread for additional
     * stability". One of the three drives and all three carry, and the builder
     * prices all three as `leg` for the reason its own `struts` note gives. */
    l: 10.96, w: null, h: 6.2, built: 1, contacts: 3, contactKind: 'tread and outriggers',
    /* AND THE HEIGHT IS OVER THE GUN. 6.2 m is the whole machine including the
     * blaster mount on top, where an AT-TE's 5.02 m is a hull with a mass
     * driver on a ring above it. `hFrom` is which of the two a check compares
     * against, and it is stated per machine because the references are. */
    hFrom: 'all',
    kill: { chains: 3, lose: 1, at: 'ground contacts', says: ['pontoon', 'tread'] },
    ratio: 10.96 / 6.2, note: 'one central tread, outriggers, 60 km/h',
  },
  atte: {
    name: 'All Terrain Tactical Enforcer', side: 'republic',
    l: 13.2, w: 10.2, h: 5.02, built: 1, contacts: 6, contactKind: 'legs',
    kill: { chains: 6, lose: 3, at: 'legs', says: ['three of the six'] },
    /* The figures the player quoted, which are the Cross-Sections' (12.4 m of
     * hull, 13.2 m over the guns, 5.32 m tall). A later databank entry gives
     * 22.02 x 9.7 for the same machine — genuinely disputed — and this file
     * builds to the pair that was asked for. */
    ratio: 13.2 / 5.02, note: 'six legs, magnetised footpads, dorsal mass driver',
  },
};

/** The keys this module registers, for anything that wants to name them all. */
export const VEHICLE_TYPES = ['dwarfspider', 'atte', 'aat', 'hailfire'];

/** Which army each belongs to, for Command mode's muster and fill. */
export const VEHICLE_SIDE = {
  dwarfspider: 'separatist',
  atte: 'republic',
  aat: 'separatist',
  hailfire: 'separatist',
  /* THE GIANTS ARE IN THE SAME TABLE and not in a second one, deliberately.
   * `factions.mjs` walks `Object.entries(VEHICLE_SIDE)` and fails on any entry
   * whose side disagrees with the databank, so a machine that is in here is a
   * machine whose faction is pinned in two files at once — which is the whole
   * of what item 4.1 bought and the reason the giants were ordered after it. */
  spha: 'republic',
  juggernaut: 'republic',
  tridroid: 'separatist',
  snailtank: 'separatist',
};
