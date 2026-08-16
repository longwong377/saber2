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

import * as THREE from 'three';
import { Rig } from './Rig.js';
import { ARCHETYPES } from './Enemy.js';
import { TOUGHNESS } from './Combat.js';
import { BOLT_COLORS } from './Bolts.js';
import { plateGeo, bandGeo, limbGeo } from './Bodies.js';
import { armorMaps, metalMaps, MEAN_ALBEDO } from '../engine/Textures.js';
import { makeRng, lerp, clamp, TAU } from '../engine/MathUtil.js';

const rng = makeRng(70714);

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
    { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.34 * S, rest: [0, 1, 0] },
    { name: 'body', parent: 'hips', offset: [0, P.body[0] * S, P.body[1] * S], length: P.body[2] * S, rest: [0, 1, 0] },
  ];
  if (P.prow) {
    out.push({ name: 'prow', parent: 'hips', offset: [0, P.prow[0] * S, P.prow[1] * S], length: P.prow[2] * S, rest: [0, 1, 0] });
  }
  if (P.stern) {
    out.push({ name: 'stern', parent: 'hips', offset: [0, P.stern[0] * S, P.stern[1] * S], length: P.stern[2] * S, rest: [0, 1, 0] });
  }
  out.push({ name: 'head', parent: 'body', offset: [0, P.head[0] * S, P.head[1] * S], length: P.head[2] * S, rest: P.head[3] || [0, 1, 0] });
  for (let i = 0; i < (P.legs || 0); i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const z = P.rows[row] * S;
    out.push({ name: `femur${i}`, parent: 'hips', offset: [side * P.hipX * S, P.hipY * S, z], length: P.femur * S, rest: [side * P.splay, P.rise, 0] });
    out.push({ name: `tibia${i}`, parent: `femur${i}`, offset: [0, P.femur * S, 0], length: P.tibia * S, rest: [side * 0.12, -1, 0] });
    out.push({ name: `tarsus${i}`, parent: `tibia${i}`, offset: [0, P.tibia * S, 0], length: P.tarsus * S, rest: [0, -0.45, 0.55] });
  }
  for (const w of (P.wheels || [])) {
    out.push({ name: w.name, parent: 'hips', offset: [w.x * S, w.y * S, w.z * S], length: w.len * S, rest: [w.dir, 0.06, 0] });
    /* The lower half of the hoop, as a bone that hangs from the hub down to the
     * ground. It exists because that is the part of a five-metre wheel a player
     * standing next to it can actually put a blade through, and `capsules()`
     * only offers the blade bones that carry geometry. */
    if (w.rim) out.push({ name: w.name.replace('wheel', 'rim'), parent: w.name, offset: [0, w.len * S, 0], length: w.rim * S, rest: [0, -1, 0] });
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
    const cols = clamp(Math.round(_ps.x / (r * 1.4)), 1, 3);
    const rows = clamp(Math.round(_ps.z / (r * 1.4)), 1, 4);
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
function rollByOdometry(driver, hoop, radius) {
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
    if (d > 1e-5) { hoop.rotation.y += d / radius; last.copy(_wp); }
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
    legs: 6, rows: [1.42, 0.02, -1.40], hipX: 0.86, hipY: 0.14,
    femur: 0.78, tibia: 0.92, tarsus: 0.26, splay: 0.70, rise: 0.62,
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
    kf.bake(femur.obj);

    const T = tibia.length;
    const tm = primary(tibia, limbGeo(T, 0.125 * S, 0.085 * S, 8, true, { rings: 4, bulge: 0.08, bulgeAt: 0.26 }), dark, 0.135 * S);
    tm.userData.limb = { r0: 0.125 * S, r1: 0.085 * S, seg: 8 };
    const kt2 = new Kit();
    kt2.add(shell, plateGeo(0.14 * S, T * 0.66, 0.24 * S, 0.04 * S, 1), [0, T * 0.36, 0.05 * S]);
    kt2.add(dark, new THREE.CylinderGeometry(0.13 * S, 0.13 * S, 0.16 * S, 10), [0, T, 0], [0, 0, 1.5708]);
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

  const stance = chassisStance(S, {
      legs: 6, hipHeight: 1.30, step: 0.86, lift: 0.26, rear: 0.22, bob: 0.018,
      plantX: 1.34, plantZ: [1.70, 0.02, -1.62], ankle: 0.259, toe: 0.08,
      poleX: 1.05, poleY: 1.45, poleZ: 0,
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
    label: 'AT-TE Walker', build: buildATTE, scale: 2.0,
    hp: 1500, mass: 3600, speed: 1.6, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    fireRate: 4.6, burst: 1, burstGap: 0.2, spread: 0.012, damage: 58, telegraph: 1.1,
    preferred: [20, 52], boltColor: BOLT_COLORS.blue,
    score: 3400, threat: 17, big: true, armored: true, unlockAt: 8,
  },
  aat: {
    label: 'Armoured Assault Tank', build: buildAAT, scale: 1.7,
    hp: 1050, mass: 2400, speed: 3.6, toughness: TOUGHNESS.heavy,
    ranged: true, custom: 'walker', weapon: null,
    fireRate: 3.0, burst: 2, burstGap: 0.44, spread: 0.022, damage: 52,
    preferred: [15, 40], boltColor: BOLT_COLORS.red,
    score: 2400, threat: 13, big: true, armored: true, unlockAt: 7,
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

/** The keys this module registers, for anything that wants to name them all. */
export const VEHICLE_TYPES = ['dwarfspider', 'atte', 'aat', 'hailfire'];

/** Which army each belongs to, for Command mode's muster and fill. */
export const VEHICLE_SIDE = {
  dwarfspider: 'separatist',
  atte: 'republic',
  aat: 'separatist',
  hailfire: 'separatist',
};
