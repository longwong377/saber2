/**
 * BATTLEFRONT BORZ — props, architecture and the blast door.
 *
 * Anything you can see, you can hit; most of it you can cut. Props carry a
 * toughness and a cut budget, so a fruit crate parts instantly, a durasteel
 * pillar takes a deliberate push, and a blast door takes twenty seconds of
 * held blade and a river of slag.
 *
 * This file is also the environment art vocabulary — everything a level has to
 * build a PLACE out of, since there are no art assets and never will be:
 *
 *   Kit + mergeGeos     bin geometry by material, merge on emit. A ruin made
 *                       of forty stones costs five draw calls, not forty.
 *   uvm / boxUv / …     texel density from world size. A 9 m wall and a 0.7 m
 *                       crate can not share one `repeat` and both read right.
 *   Architecture kit    columns, arches, lintels, buttresses, broken walls,
 *                       stairs, railings, plinths, balconies, floor slabs — all
 *                       sized off ARCH so they butt together.
 *   Monuments           addColossus, addRuinedGate, addHullSection, addGantry:
 *                       the thing a level is navigated by.
 *   Rock                rockGeo and friends — bedded, undercut, vertex-coloured
 *                       by stratum so the layering survives distance.
 *   Clutter             pipe runs, catenary cables, crate stacks, tarps,
 *                       scaffolding, masts, lamps, signage.
 *   addDebrisField      the rubble a ruin sheds — big near, small far, one
 *                       instanced draw per shape.
 *   addRuin/addOutpost  a whole place in one call.
 *
 * The convention throughout: `make*` returns a live Prop for the caller to
 * hand to world.addProp; `add*` builds static scenery and registers it itself.
 * Pass `{ kit }` to any `add*` to compose it into a larger merge.
 */

import * as THREE from 'three';
import { Body, LAYER, boxSpheres, capsuleSpheres, box, cylinder, compound, hullFromGeometry } from '../physics/RapierWorld.js';
import { armKinetic } from '../game/Impact.js';
import { sliceGeometry, recenterGeometry, spheresForGeometry } from './Slice.js';
import { registerDestructible } from './Destruction.js';
import { metalMaps, duracreteMaps, rockMaps, armorMaps, clothMaps, sandMaps, MEAN_ALBEDO } from '../engine/Textures.js';
import { plateGeo, limbGeo } from '../game/Bodies.js';
import { makeCapMaterial } from '../game/Ragdoll.js';
import { TOUGHNESS } from '../game/Combat.js';
import { clamp, lerp, smoothstep, makeRng, fbm2, noise2, TAU } from '../engine/MathUtil.js';
/* Thunder. Audio is a module singleton with a no-op path when there is no
 * context, so this is safe headless and costs nothing on a level with no
 * storm over it. */
import { audio } from '../engine/Audio.js';

const rng = makeRng(9091);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
// kit-only scratch: the builders nest, so they may not share the above
const _km = new THREE.Matrix4(), _ke = new THREE.Euler(), _kq = new THREE.Quaternion();
const _kv = new THREE.Vector3();
const IDENT = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
// addScree bedding scratch: it runs inside the instance loop, so it may not
// share the scratch above with the makers that call it
const _plate = new THREE.Vector3(), _tan = new THREE.Vector3(), _q2 = new THREE.Quaternion();

let _propId = 1;

/* ══════════════════════════════════════════════════════════════════════ */
/*  An option a builder does not understand                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A BUILDER REFUSES AN OPTION IT DOES NOT READ, and it finds out what it reads
 * BY READING ITSELF.
 *
 * Four call sites in Levels.js asked `addCrateStack` for `{ count: 2 + … }`.
 * The builder reads `size`, `tiers`, `columns`, `seed`, `yaw`, `dynamic` and
 * `quaternion`; it had never read `count`, so four stacks in the shipped game
 * were not the size their call site said and nothing anywhere said so. A fifth
 * site handed the same builder `{ kit }` — the whole file's composition
 * convention, documented at the top of this file — and got a stack emitted at
 * kit-space coordinates in world space, metres from where it was asked for.
 * Both are the same defect: an object handed over, read for the keys the
 * callee happens to know, and silently short of the rest.
 *
 * The cure has to be cheaper than remembering, or it decays. So the accepted
 * set is not written down anywhere: `optionKeys` scans the builder's OWN
 * SOURCE (`Function.prototype.toString`, exact for every function in this
 * tree — there is no build step and nothing is minified) for `opts.x`,
 * `opts?.x` and `const { x } = opts`, and unions in the same reading of every
 * helper the builder hands its whole `opts` to. Change what a builder reads
 * and the accepted set changes with it, in the same edit, with nothing to keep
 * in step. That is HANDOFF §2.3 and §2.4 applied to an argument list.
 *
 * MEASURED, so the cost is on the record rather than assumed: the derivation
 * runs once per function and is cached behind a Map. Dressing all nine levels
 * — every prop in the game, built — makes 1017 guarded builder calls against
 * 41 cached derivations, so the whole of what the guard adds to a level load
 * is 1017 `Object.keys` walks of a handful of keys each. The dressing pass it
 * sits in takes 4.5 s.
 *
 * IT THROWS. A warning would be read by nobody: the four `count` sites sat in
 * the game through two adversarial audits and a judging pass. The failure mode
 * of the derivation itself is the same throw — a helper that starts consuming
 * options without being listed in `OPT_SINKS` below makes every builder that
 * uses it refuse a key it really does honour — and that is deliberate too: it
 * fails on the first dressed level, in the gate, with the key named, rather
 * than quietly widening what a builder will swallow.
 */
const _OPT_KEYS = new Map();

/** Every `opts.x` a function's own source reads, including its destructurings. */
function readsOfSource(src) {
  const keys = new Set();
  for (const m of src.matchAll(/\bopts\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*opts\b/g)) {
    for (const part of m[1].split(',')) {
      const k = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
      if (k) keys.add(k[1]);
    }
  }
  return keys;
}

/**
 * The helpers a builder can hand its whole `opts` to, and which therefore read
 * options on its behalf. Held as the FUNCTIONS, not as their key lists — what
 * each one accepts is read off its own source by the same scan, so this table
 * cannot fall out of step with them; only a new helper has to be added.
 */
let _SINKS = null;
function sinkTable() {
  return (_SINKS ||= [
    ['kitOpen', kitOpen], ['kitClose', kitClose],
    ['emit', Kit.prototype.emit], ['light', Kit.prototype.light],
    ['Prop', Prop], ['Crowd', Crowd], ['Storm', Storm],
  ]);
}

/**
 * Does this source hand its whole `opts` to somebody — `f(a, opts)`,
 * `{ ...opts }`? The guard call every builder opens with is `assertOpts(fn,
 * opts)`, which is that shape and is not that thing, so it comes out first:
 * without it every builder looks like it forwards, and the four that forward
 * to nothing else — addScree, addInstanced, addBoulderCluster, addDebrisField
 * — would have been marked unanswerable and left unguarded by their own guard.
 */
function forwardsOpts(src) {
  const s = src.replace(/assertOpts\([^)]*\)/g, '');
  return /\bopts\s*[,)]/.test(s) || /\.\.\.opts\b/.test(s);
}

/** Which of those a function's source actually forwards `opts` into. */
export function optionSinks(fn) {
  const src = fn.toString();
  if (!forwardsOpts(src)) return [];
  const out = [];
  for (const [name] of sinkTable()) if (new RegExp('\\b' + name + '\\b').test(src)) out.push(name);
  return out;
}

/**
 * The option keys a builder understands: what it reads itself, plus what the
 * helpers it forwards to read — RECURSIVELY, because the chain is two deep
 * already. A maker calls `kitClose`, which calls `Kit.emit`, which is where
 * `collide`, `castShadow` and `receiveShadow` are read; a derivation that
 * stopped at the first hop would have every kit-based maker in the file
 * refusing three options it honours.
 *
 * `null` means "cannot be answered" — see the note on the guard above.
 */
function collectKeys(fn, seen) {
  if (seen.has(fn)) return new Set();
  seen.add(fn);
  const src = fn.toString();
  const keys = readsOfSource(src);
  const sinks = optionSinks(fn);
  const table = new Map(sinkTable());
  for (const name of sinks) {
    const sub = collectKeys(table.get(name), seen);
    if (!sub) return null;
    for (const k of sub) keys.add(k);
  }
  /* HANDED ON TO SOMETHING THIS FILE DOES NOT KNOW — the answer is `null`, not
   * an empty set, and the difference is the whole safety of the guard. A
   * builder that forwards its options wholesale to an unlisted helper reads
   * almost nothing itself, so an empty set would make it refuse every option
   * it really does honour: `addStorm` is four lines around `new Storm(world,
   * opts)` and would have rejected all six of Storm's. Unanswerable is
   * therefore unguarded, and `builder-options` prints the unguarded ones by
   * name so they are a visible list rather than a silent hole. */
  if (forwardsOpts(src) && !sinks.length) return null;
  return keys;
}

export function optionKeys(fn) {
  let keys = _OPT_KEYS.get(fn);
  if (keys === undefined) _OPT_KEYS.set(fn, keys = collectKeys(fn, new Set()));
  return keys;
}

/**
 * Refuse anything `fn` does not read. Called by every builder in this file as
 * its first statement, with ITSELF as the first argument — which is the whole
 * mechanism: the guard has the function, so it can read what the function
 * reads, and there is no second copy of the answer to maintain.
 */
export function assertOpts(fn, opts) {
  if (!opts) return opts;
  const known = optionKeys(fn);
  if (!known) return opts;
  let bad = null;
  for (const k of Object.keys(opts)) if (!known.has(k)) (bad ||= []).push(k);
  if (bad) {
    throw new Error(`${fn.name}: handed ${bad.length > 1 ? 'options' : 'an option'} it does not read — `
      + `${bad.join(', ')}. It reads: ${[...known].sort().join(', ')}.`);
  }
  return opts;
}

/* ── shared materials ────────────────────────────────────────────────── */

/**
 * Mean linear albedo of the baked maps, measured off the samplers in
 * Textures.js rather than guessed:
 *
 *   rock       0.109 0.078 0.058        duracrete  0.328 0.314 0.286
 *   metal      0.314 0.349 0.411        armor      0.664 0.650 0.620
 *   cloth      0.937 0.937 0.937        sand       0.578 0.398 0.190  (ground)
 *
 * The rock map is dark, so `mk(rock, 0x7d6f5c)` — an innocent-looking mid
 * brown — landed at 0.022 linear. That is charcoal: twenty-six times darker
 * than the sand it sits on, which is why every boulder in this game read as a
 * black hole cut out of the desert. Colours below are therefore written as
 * LINEAR MULTIPLIERS on the map (lit(), which happily goes above 1), chosen so
 * each surface lands on a real-world albedo:
 *
 *   concrete 0.25-0.32 · sandstone 0.30 · weathered stone 0.20 · wood 0.15
 *   painted metal 0.25-0.35 · bare steel F0 0.55 · rust 0.15
 */
const lit = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

/**
 * Every surface a maker builds carries per-vertex weathering (see weatherGeo),
 * so its material has to read vertex colours — and that is a loaded gun.
 *
 * MEASURED, not assumed: a MeshStandardMaterial with vertexColors:true drawn
 * over a geometry that has no `color` attribute renders (0,0,0). Pure black.
 * Destruction.js rebuilds a fractured chunk with position/normal/uv only, and
 * so does Slice.js when the blade cuts a prop — so the first time anything in
 * this file was broken, the pieces would have turned into holes in the world.
 *
 * defaultAttributeValues is three's escape hatch: the renderer feeds it to
 * gl.vertexAttrib3fv for any attribute the geometry is missing. With white in
 * there an unpainted geometry falls back to exactly the unweathered material.
 */
const WHITE_ATTR = { color: [1, 1, 1] };
function readsVertexColour(m) { m.vertexColors = true; m.defaultAttributeValues = WHITE_ATTR; return m; }

let MATS = null;
export function propMaterials() {
  if (MATS) return MATS;
  const metal = metalMaps(2);
  const crete = duracreteMaps(2);
  const rock = rockMaps(2);
  const armor = armorMaps(2);
  const cloth = clothMaps(2);
  // The one map in this file that is not a stand-in for something else: the
  // drift IS the ground, so it gets the ground's own bake (see `drift` below).
  const sandy = sandMaps(2);
  /**
   * Which bake each material stands on, so mk() can record the product.
   *
   * Every colour in this table is a LINEAR MULTIPLIER on a map mean, which
   * makes the numbers unreadable on their own: lit(4.90,4.70,3.20) and
   * lit(0.90,0.90,0.90) are the same surface on two different maps, and there
   * is no way to see that from the source. So each material carries its
   * PRODUCT — the linear albedo it actually renders at — on userData, and
   * tools/checks/environment.mjs holds surfaces against each other with it
   * instead of re-deriving the multiplication and getting the map wrong.
   */
  const MEAN = new Map([[metal, MEAN_ALBEDO.metal], [crete, MEAN_ALBEDO.duracrete],
    [rock, MEAN_ALBEDO.rock], [armor, MEAN_ALBEDO.armor], [cloth, MEAN_ALBEDO.cloth],
    [sandy, MEAN_ALBEDO.sand]]);
  const mk = (maps, color, rough, metalness) => {
    const m = readsVertexColour(new THREE.MeshStandardMaterial({
      color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
      roughness: rough, metalness,
    }));
    const u = MEAN.get(maps);
    if (u) m.userData.albedo = [m.color.r * u[0], m.color.g * u[1], m.color.b * u[2]];
    return m;
  };
  MATS = {
    crate: mk(metal, lit(0.86, 0.68, 0.40), 0.62, 0.35),        // olive drab
    crateDark: mk(metal, lit(0.41, 0.37, 0.29), 0.55, 0.7),
    barrel: mk(metal, lit(0.96, 0.49, 0.22), 0.5, 0.75),        // oxide red
    // grey structural concrete — deliberately NOT the same tan as the
    // sun-bleached facing below: at lit(0.90,0.79,0.62) the two were 17% apart
    // in luminance and 0.027 apart in chroma, which is one material with a
    // rounding error, not two.
    duracrete: mk(crete, lit(0.68, 0.65, 0.59), 0.94, 0.02),
    /* Loose boulder rock. The old lit(1.90,2.10,2.20) was BLUE-biased — b > r
     * on a map that is warm — so every boulder read cold grey against the
     * ochre outcrop it had supposedly fallen off, and against ochre sand.
     * This is warm but DARKER and less saturated than the carved sandstone
     * below: desert varnish is exactly what happens to a block that has sat
     * out in the sun for a few thousand years, and it also keeps the two
     * apart, which at 8% luminance and 0.043 chroma they were not. */
    stone: mk(rock, lit(1.98, 1.80, 1.55), 0.92, 0.02),
    steel: mk(metal, lit(1.50, 1.42, 1.30), 0.34, 0.98),
    darkSteel: mk(metal, lit(0.64, 0.60, 0.56), 0.42, 0.95),
    hull: mk(armor, lit(0.42, 0.45, 0.51), 0.42, 0.85),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.32 }),
    emissive: new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0x60d8ff, emissiveIntensity: 2.2,
      roughness: 0.4, metalness: 0.3 }),
    wood: mk(crete, lit(0.49, 0.32, 0.17), 0.88, 0.02),
    /* ── THE SWAMP FLOOR'S THREE MATERIALS ────────────────────────────────
     *
     * Read off `assets/reference/maps/drowned-wood/dagobah.jpeg`, which is the
     * plate that settled what a bog floor is: standing water, banks of matted
     * litter, buttress roots, and tangles of bare dead branches. There is no
     * grass in it and there is no green in it either — the whole frame lives
     * between a blue-grey and a very dark umber, and the ONLY bright thing is
     * the water, because the water is what is holding the sky.
     *
     * So all three of these are darker than anything else in this table, and
     * that is the point rather than an accident: the ground has to be the
     * value the water is read AGAINST. A litter bank painted at the value the
     * old fern field used would put the brightest thing in the frame on the
     * floor and the water would stop being water.
     *
     * `rootWet` is barely rough, because wet wood is not matte — the specular
     * roll-off along a root is most of what says it is soaked. `litterMat` is
     * the opposite: matted leaf debris is the roughest surface on the level.
     */
    rootWet: mk(crete, lit(0.30, 0.255, 0.205), 0.62, 0.04),
    litterMat: mk(crete, lit(0.315, 0.285, 0.175), 0.97, 0.0),
    /* Moss is the one saturated note and there is very little of it, which is
     * why it is allowed to be as green as it is: it is the accent in rule 5's
     * sense — one hue family, one accent, and the accent IS the subject where
     * it lands. Caps on roots and the tops of fallen logs only. */
    mossWet: mk(crete, lit(0.235, 0.335, 0.175), 0.90, 0.0),

    /* ── the environment vocabulary ───────────────────────────────────
     * A place needs more than one grey. Facing stone, its shadowed core,
     * the rust that runs out of every fixing, and the paint somebody put on
     * it before the war are four different materials to the eye even when
     * they share one baked map. */
    duracreteWarm: mk(crete, lit(0.90, 0.76, 0.55), 0.93, 0.02),  // sun-bleached facing
    /* The CORE of a broken wall — and, because ashlarFace beds every stone on
     * it, every mortar joint and every empty socket in the game.
     *
     * It used to be NEUTRAL grey, on the argument that fresh aggregate is
     * grey. That is true of the aggregate and false of the picture: a neutral
     * 0.20-chroma surface sitting in a hundred metres of joint line, lit by a
     * blue sky and shaded from a warm sun, comes back BLUE — measured off a
     * close shot of the gate pier, the joints read visibly cold against warm
     * ashlar and turned the wall into grey-grouted blockwork.
     *
     * So it is warmed into the stone's own family AND taken down, because a
     * joint is a RECESS and the old value was bright enough to read as grout:
     * crete's mean is 0.332/0.318/0.290, so lit(0.44,0.365,0.27) lands at
     * 0.146/0.116/0.078 — mean 0.113 against the old 0.138, 18% darker, with
     * chroma 0.46 against the old 0.20. The darkening is not optional once the
     * hue moves: warm alone put it 9% in value and 0.067 in chroma from
     * `stone`, which the palette check calls one material spelled twice. At
     * this value the closest neighbour is 23% away. */
    duracreteDark: mk(crete, lit(0.44, 0.365, 0.27), 0.96, 0.02),  // wall core, joints, undersides
    sandstone: mk(rock, lit(2.70, 2.40, 1.70), 0.95, 0.0),        // carved stone, plinths
    /* Shadowed masonry — recessed bands, the void inside a cowl. The old
     * lit(0.95,1.10,1.25) baked a BLUE cast into the albedo, which is
     * double-counting: this surface is already lit by sky, and the renderer
     * does that part. It is the same warm stone as everything else, just
     * darker — 0.105 luminance rather than 0.090, because a shadow is a
     * shadow and not a hole cut in the world. */
    stoneDark: mk(rock, lit(1.35, 1.15, 0.92), 0.94, 0.02),
    /**
     * SNOW-BLANKETED ROCK — for the one level where warm stone is wrong.
     *
     * Reported: "the snow map shouldnt have the same stones/spires as the
     * desert, feels out of place… sometimes it feels like the desert map but
     * with the sand being white. The brown rocks just take you out of it."
     * Exactly right, and it was one line: the White Pass strewed `M.stone`,
     * which is the DESERT's stone and whose own comment above explains at
     * length why it is warm — desert varnish on a block that has sat in the
     * sun for a few thousand years.
     *
     * The reference the player supplied (assets/reference/maps/alpine) settles
     * what it should be instead, and the answer is not "grey": in it there is
     * no bare rock at all. Every outcrop is under snow, and what separates one
     * from the drift beside it is VALUE and a blue shadow, not hue. Rock on
     * that planet reads as a cold shadow in a white field.
     *
     * So: bright, barely saturated, and tilted BLUE rather than neutral — a
     * neutral grey against snow lit by a blue sky comes back looking brown by
     * simultaneous contrast, which is the same trap `duracreteDark`'s comment
     * records from the other direction. It keeps the rock map, because the
     * crack network is still the right pattern for a snow-covered crag; it is
     * the tint that was wrong.
     */
    stoneSnow: mk(rock, lit(2.45, 2.62, 2.95), 0.95, 0.0),
    /* WIND-PACKED SNOW, and it is a different material from the stone above
     * rather than a paler tint of it. `assets/reference/maps/alpine/hoth.jpeg`
     * has NO ROCK IN IT — not a stone, not a spire, not a chip — and every
     * form in the frame is snow: sastrugi combed by the wind, drift humps,
     * and one big rounded massif in the mid-ground. So the White Pass's
     * ground furniture is made of this and the stone is gone from that level
     * entirely.
     *
     * Brighter than anything else in the table and tilted BLUE, which is not
     * decoration: snow is bright because its albedo is high, and its shadows
     * are blue because the only thing lighting them is the dome. The level's
     * own atmosphere block makes the same argument about its ambient. */
    snowPack: mk(sandy, lit(3.15, 3.32, 3.62), 0.93, 0.0),
    /* Wind-blown sand banked against anything that has stood still in a desert
     * long enough to matter. It is built on the SAND map, and the reason is a
     * textbook case of a mean hiding a distribution.
     *
     * The first version of this ran the ROCK map at lit(4.90,4.70,3.20),
     * chosen so the products of the two means came out on MEAN_ALBEDO.sand.
     * The means matched to two decimal places and it still rendered as a
     * ribbon of white marble with orange veins in it: MEASURED off a
     * close-range shot, the drift came back luminance 0.704 / saturation 0.341
     * against open sand at 0.619 / 0.506 — 14% brighter and a third less
     * saturated than the ground it is made of. Two things did it. The rock map
     * has three times sand's tonal contrast, so a 4.9x multiplier that lands
     * the MEAN on target sends the top of the histogram past 1.0 and clips it
     * to white; and the rock map's pattern is a crack network, which is the
     * one thing a sand bank does not have.
     *
     * On the sand map both problems are gone, the ripples on the bank match
     * the ripples on the ground because they are the same ripples, and the
     * multiplier becomes a single readable number: 0.9, i.e. one tenth darker
     * than open desert, because sand piled in a wall's lee is packed, damp at
     * depth and half in shadow. `albedo` is the product, recorded so a check
     * can hold this against the ground without knowing which map it came off. */
    drift: mk(sandy, lit(0.90, 0.90, 0.90), 0.97, 0.0),
    strata: null,                                                 // filled in below
    rust: mk(metal, lit(0.51, 0.26, 0.12), 0.88, 0.55),
    rebar: mk(metal, lit(0.45, 0.26, 0.15), 0.8, 0.72),
    bronze: mk(metal, lit(1.97, 1.29, 0.49), 0.44, 0.95),
    patina: mk(metal, lit(0.70, 1.00, 0.68), 0.74, 0.3),
    paint: mk(armor, lit(0.36, 0.14, 0.11), 0.6, 0.35),           // faded hull paint
    paintPale: mk(armor, lit(0.50, 0.49, 0.44), 0.62, 0.3),
    panel: mk(armor, lit(0.36, 0.40, 0.47), 0.46, 0.85),
    grating: mk(metal, lit(0.32, 0.29, 0.27), 0.66, 0.9),
    tarp: readsVertexColour(new THREE.MeshStandardMaterial({
      color: lit(0.42, 0.33, 0.19), map: cloth.map, normalMap: cloth.normalMap, roughnessMap: cloth.roughnessMap,
      roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide })),
    tarpBlue: readsVertexColour(new THREE.MeshStandardMaterial({
      color: lit(0.15, 0.20, 0.28), map: cloth.map, normalMap: cloth.normalMap, roughnessMap: cloth.roughnessMap,
      roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide })),
    cable: readsVertexColour(new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.86, metalness: 0.1 })),
    glowAmber: new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffa838, emissiveIntensity: 2.6, roughness: 0.5 }),
    glowRed: new THREE.MeshStandardMaterial({ color: 0x180808, emissive: 0xff3418, emissiveIntensity: 2.4, roughness: 0.5 }),
    glowCold: new THREE.MeshStandardMaterial({ color: 0x0d1218, emissive: 0xbcd8ff, emissiveIntensity: 3.0, roughness: 0.4 }),
  };
  // Sedimentary banding is painted into the vertices: it survives distance,
  // survives fog, and costs nothing. The map only supplies the grain, and the
  // vertex colour carries the whole brightness budget (see STRATA).
  MATS.strata = readsVertexColour(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: rock.map, normalMap: rock.normalMap, roughnessMap: rock.roughnessMap,
    roughness: 0.95, metalness: 0.0,
  }));

  /**
   * DRESSED stone is not the same surface as a boulder, and the file only had
   * one rock bake to build both out of. That is still true, and the knob that
   * used to answer it is GONE rather than retuned.
   *
   * What stood here was `MATS[n].normalScale.set(0.45, 0.45)` on sandstone and
   * stoneDark — measured off the baked bytes, the rock normal carries 14.3° of
   * mean texel tilt against duracrete's 6.3°, and halving it put a dressed
   * column at the same relief as the concrete beside it instead of reading as
   * tree bark. The measurement was right and the line is now inert: under the
   * cel model `materialFrom` binds `normalMap: null` on every prop material in
   * the game (src/engine/Textures.js — a detail normal under a two-tone
   * terminator reads as speckle, not as relief), and three multiplies
   * `normalScale` into a map that is not there. Verified on the built
   * materials: sandstone.normalMap and stoneDark.normalMap are both null.
   *
   * The difference the measurement is about now has to be carried by the
   * albedo and the vertex colours, which is where every other surface
   * distinction in this file lives.
   */

  /**
   * How hard each surface weathers, as a multiplier on WEAR (below).
   *
   * Not every material wears the same way and none of them wear at zero. Stone
   * and concrete take the full treatment — soil at the foot, dust on the flats,
   * dirt running down every vertical. Painted and plated metal takes less
   * because it sheds water; a lamp lens takes none at all, because a light
   * fitting with mud on it is a light fitting nobody can find.
   */
  // Drift is at 0.5 because sand does not stain and does not run: what it wants
  // off WEAR is the up-face dust term and the per-piece tone, not a mud line at
  // the foot of a thing that IS the mud line.
  const wear = { 1: ['duracrete', 'duracreteWarm', 'duracreteDark', 'sandstone', 'stone', 'stoneDark',
                     'strata', 'wood', 'rust', 'rebar', 'patina'],
                 0.5: ['drift'],
                 0.72: ['hull', 'panel', 'paint', 'paintPale', 'grating', 'darkSteel', 'crate', 'crateDark',
                        'barrel', 'bronze', 'tarp', 'tarpBlue'],
                 0.45: ['steel', 'cable'] };
  for (const [k, names] of Object.entries(wear)) {
    for (const n of names) if (MATS[n]) MATS[n].userData.weather = +k;
  }
  return MATS;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Geometry plumbing — texel density, merging, bevelled extrusion        */
/* ══════════════════════════════════════════════════════════════════════ */

/** Every shared map in propMaterials() is built at repeat 2 across 0..1. */
const TEX_REPEAT = 2;

/**
 * Texel density, in metres per texture repeat.
 *
 * The maps are shared, so the only thing that sets how big the grain LOOKS is
 * the number a maker passes as `tile`. Left to per-maker taste this file had
 * spread over 15:1 between its coarsest and finest surface — a fuel drum whose
 * plate grain was eight times finer than the gantry beside it, and rock chips
 * twelve times finer than the cliff they fell off. That reads as objects from
 * different games standing in the same room, and it is the single thing a
 * shipped environment is most disciplined about.
 *
 * These are the whole vocabulary. Small hand-held things sit at FINE because
 * they are looked at from a metre away; everything a level is built out of
 * sits within a factor of two of ARCH_TILE.
 */
export const ROCK_TILE = 2.4;      // rock, scree, boulders, rubble
const ARCH_TILE = 2.4;             // walls, columns, floors, big plate
const TRIM_TILE = 1.7;             // mouldings, kerbs, nosings, stringers
const FINE_TILE = 1.1;             // crates, drums, consoles, fittings, pipes
/**
 * Nothing may be authored outside this band, in metres per repeat.
 * tools/checks/environment.mjs measures every maker against it. Measured
 * spread when the band was introduced: 5.0:1 across every material bin in
 * every maker, down from 15:1.
 */
export const TEXEL_BAND = [0.7, 3.1];

/**
 * UV multiplier that makes one texture tile span `metres` of surface, for
 * geometry whose UVs are already measured in metres — ExtrudeGeometry's
 * default generator, or anything run through boxUv/tubeUv/triplanarUv.
 *
 * This is the whole reason a 9 m wall stops looking like a smear: texel
 * density has to come from the geometry, because the maps are shared.
 */
export function uvm(metres) { return 1 / (Math.max(0.05, metres) * TEX_REPEAT); }

/** Multiply an existing UV set (metres → tiles). */
export function scaleUv(geo, s, t = s) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * t);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Re-UV a box-derived slab so all six faces share one texel density. Box UVs
 * run 0..1 per face regardless of how big the face is, which is exactly the
 * bug that makes a big wall and a small crate look like different materials.
 */
export function boxUv(geo, w, h, d, tile = 2.5) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  const k = uvm(tile);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const groups = geo.groups && geo.groups.length === 6 ? geo.groups : null;
  if (!groups) return scaleUv(geo, w * k, h * k);
  const idx = geo.index;
  const seen = new Uint8Array(uv.count);
  for (const grp of groups) {
    const [su, sv] = dims[grp.materialIndex ?? 0];
    for (let i = grp.start, e = grp.start + grp.count; i < e; i++) {
      const vi = idx ? idx.getX(i) : i;
      if (seen[vi]) continue;
      seen[vi] = 1;
      uv.setXY(vi, uv.getX(vi) * su * k, uv.getY(vi) * sv * k);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** Re-UV a cylinder/lathe/tube: u wraps the girth, v runs the length. */
export function tubeUv(geo, girth, length, tile = 2.5) {
  const k = uvm(tile);
  return scaleUv(geo, girth * k, length * k);
}

/**
 * Per-triangle planar projection by dominant face normal — the fallback for
 * rock, torn plate and anything else with no natural parameterisation. Needs
 * non-indexed geometry, so it may return a new geometry and dispose the old.
 */
export function triplanarUv(geo, tile = 3) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const k = uvm(tile);
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t + 2 < p.count; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
    b.sub(a); c.sub(a); b.cross(c);
    const ax = Math.abs(b.x), ay = Math.abs(b.y), az = Math.abs(b.z);
    const axis = ax >= ay && ax >= az ? 0 : (ay >= az ? 1 : 2);
    for (let i = 0; i < 3; i++) {
      const x = p.getX(t + i), y = p.getY(t + i), z = p.getZ(t + i);
      const u = axis === 0 ? z : x;
      const v = axis === 1 ? z : y;
      uv[(t + i) * 2] = u * k; uv[(t + i) * 2 + 1] = v * k;
    }
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (g !== geo) geo.dispose();
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Weathering — the difference between a building and a box              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The single measurable thing that separated this environment from a shipped
 * one: EVERY architectural surface had exactly zero low-frequency albedo
 * variation. The baked maps tile every 2.5 m, so a 9 m wall is the same 2.5 m
 * of noise four times, and at any distance past a few metres the eye integrates
 * that to one flat value. A real wall is never one flat value — it is dirty at
 * the foot, bleached and dusty on every up-face, black under every overhang,
 * streaked below every ledge, and quarried a course at a time out of stone that
 * was never the same colour twice.
 *
 * All of that is low frequency, so all of it fits in vertex colours: no shader,
 * no extra texture, no extra draw call, and it survives distance and fog when a
 * normal map has long since averaged itself away.
 *
 * The terms, all multiplicative on the base albedo:
 *
 *   tone     one scalar per PIECE. A colonnade of eight identical columns is
 *            eight copies of a column; ±10% of tone makes it eight columns.
 *   patch    fbm at ~6 m — render, damp, a different batch of concrete.
 *   streak   dirt runs: high frequency around the girth, smeared 12:1 down the
 *            face, and only on verticals. This is THE cue that says "outside,
 *            for a long time" and nothing else in the file was doing it.
 *   soil     the splash zone: the bottom SOIL_H metres take mud back off the
 *            ground, darker and browner.
 *   sky/AO   up-faces catch dust and sun (lighter, desaturated); down-faces are
 *            in permanent shade (darker, cooler).
 *
 * Calibrated so the AREA-WEIGHTED MEAN stays near 1.0 — the trap this file has
 * fallen into before is a plausible-looking tweak that quietly halves the
 * albedo of everything, so weatherStats() below exists to be measured.
 */
export const WEAR = {
  tone: 0.125,       // ± per-piece quarry tone
  patch: 0.115,      // ± large-scale blotching
  streak: 0.24,      // depth of the dirt runs on verticals
  soil: 0.36,        // how much darker the splash zone gets
  soilH: 1.15,       // metres of splash zone above the piece's base
  sky: 0.13,         // up-face dust/bleach
  cavity: 0.20,      // down-face shade
  warm: 0.55,        // how much of soil/shade is a hue shift rather than value
  lift: 1.111,       // put the mean back on 1.0 after all of the above
  cell: 1.15,        // metres: the vertex spacing all of the above needs to read
};

/**
 * Split every triangle whose longest edge exceeds `maxEdge`, by bisecting that
 * edge. Position, normal, uv and colour are interpolated; the result is
 * indexed, so the vertex count grows only by the midpoints actually needed.
 *
 * This exists because weathering is a vertex colour and MEASURED vertex
 * density on exactly the surfaces that read as cardboard was:
 *
 *   a 92 m hangar wall      0.10 verts/m², median triangle edge 30.7 m
 *   a 10 m broken wall      2.85 verts/m², median edge 10.0 m
 *   a 34 m hull shell       0.39 verts/m², median edge  2.4 m
 *   an 18 m colossus        1.58 verts/m²
 *
 * A 16 × 7 m wall face is one polygon with about twenty vertices round its
 * outline and NOTHING in the middle, so any amount of per-vertex variation
 * painted onto it is linearly interpolated across the whole wall and vanishes.
 * That is why every previous attempt at breaking up these surfaces failed.
 *
 * The split is longest-edge bisection rather than 1→4, so the cost tracks the
 * surface that actually needs it — and a triangle is only split if it is BROAD
 * as well as long. Without that second test a 32 m stringer 26 cm wide gets
 * chopped into thirty slivers that can never show a metre-scale dirt run:
 * measured, the naive version took the whole prop kit from 118k triangles to
 * 297k, and nine tenths of the new ones were on pipework nobody can see.
 */
export function tessellate(geo, maxEdge, maxTris = 40000) {
  const pos = geo.attributes.position;
  if (!pos || !(maxEdge > 0)) return geo;
  const m2 = maxEdge * maxEdge;
  // A face narrower than a third of a metre cannot show a metre-scale dirt run,
  // so it is never worth splitting: that one test is what separates a 4 m wall
  // face (split) from a 32 m stringer 26 cm wide and a 5 cm pipe (both left
  // alone), and it is the difference between +13% triangles and +150%.
  const minWidth = maxEdge * 0.28;      // altitude to the edge being split
  const idx0 = geo.index;
  const n0 = idx0 ? idx0.count : pos.count;
  const pa = pos.array;
  // a triangle is worth splitting only if it is both long and broad
  const worth = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const e0 = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
    const e1 = (bx - cx) ** 2 + (by - cy) ** 2 + (bz - cz) ** 2;
    const e2 = (cx - ax) ** 2 + (cy - ay) ** 2 + (cz - az) ** 2;
    const bl = Math.max(e0, e1, e2);
    if (bl <= m2) return -1;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);           // = 2·area
    if (area2 / Math.sqrt(bl) < minWidth) return -1;
    return bl === e0 ? 0 : (bl === e1 ? 1 : 2);
  };
  let need = false;
  for (let i = 0; i + 2 < n0 && !need; i += 3) {
    const a = (idx0 ? idx0.getX(i) : i) * 3, b = (idx0 ? idx0.getX(i + 1) : i + 1) * 3, c = (idx0 ? idx0.getX(i + 2) : i + 2) * 3;
    if (worth(pa[a], pa[a + 1], pa[a + 2], pa[b], pa[b + 1], pa[b + 2], pa[c], pa[c + 1], pa[c + 2]) >= 0) need = true;
  }
  if (!need) return geo;

  const names = ['position', 'normal', 'uv', 'color'].filter((k) => geo.attributes[k]);
  const sizes = names.map((k) => geo.attributes[k].itemSize);
  const stride = sizes.reduce((a, b) => a + b, 0);
  const nrmAt = names.indexOf('normal') >= 0 ? sizes.slice(0, names.indexOf('normal')).reduce((a, b) => a + b, 0) : -1;
  const data = [];
  for (let i = 0; i < pos.count; i++) {
    for (let k = 0; k < names.length; k++) {
      const a = geo.attributes[names[k]];
      for (let c = 0; c < sizes[k]; c++) data.push(a.array[i * sizes[k] + c]);
    }
  }
  let tris = [];
  for (let i = 0; i + 2 < n0; i += 3) {
    tris.push(idx0 ? [idx0.getX(i), idx0.getX(i + 1), idx0.getX(i + 2)] : [i, i + 1, i + 2]);
  }
  const mid = (a, b) => {
    const k = data.length / stride;
    for (let c = 0; c < stride; c++) data.push((data[a * stride + c] + data[b * stride + c]) * 0.5);
    if (nrmAt >= 0) {                       // a lerped normal is not unit length
      const o = k * stride + nrmAt;
      const l = Math.hypot(data[o], data[o + 1], data[o + 2]) || 1;
      data[o] /= l; data[o + 1] /= l; data[o + 2] /= l;
    }
    return k;
  };
  for (let pass = 0; pass < 12 && tris.length < maxTris; pass++) {
    let any = false;
    const next = [];
    for (const t of tris) {
      const o0 = t[0] * stride, o1 = t[1] * stride, o2 = t[2] * stride;
      const best = worth(data[o0], data[o0 + 1], data[o0 + 2], data[o1], data[o1 + 1], data[o1 + 2],
        data[o2], data[o2 + 1], data[o2 + 2]);
      if (best < 0) { next.push(t); continue; }
      any = true;
      const a = t[best], b = t[(best + 1) % 3], c = t[(best + 2) % 3];
      const m = mid(a, b);
      next.push([a, m, c], [m, b, c]);
    }
    tris = next;
    if (!any) break;
  }

  const nv = data.length / stride;
  const out = new THREE.BufferGeometry();
  let off = 0;
  for (let k = 0; k < names.length; k++) {
    const s = sizes[k], arr = new Float32Array(nv * s);
    for (let i = 0; i < nv; i++) for (let c = 0; c < s; c++) arr[i * s + c] = data[i * stride + off + c];
    out.setAttribute(names[k], new THREE.Float32BufferAttribute(arr, s));
    off += s;
  }
  const ia = nv > 65535 ? new Uint32Array(tris.length * 3) : new Uint16Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) { ia[i * 3] = tris[i][0]; ia[i * 3 + 1] = tris[i][1]; ia[i * 3 + 2] = tris[i][2]; }
  out.setIndex(new THREE.BufferAttribute(ia, 1));
  geo.dispose();
  return out;
}

/**
 * Paint weathering into `geo`, in the frame it is already in — so y must be
 * height above the structure's own base, which is exactly what Kit space is.
 * Multiplies into an existing colour attribute (strata rock) or creates one.
 */
export function weatherGeo(geo, opts = {}) {
  const W = WEAR;
  const k = opts.strength ?? 1;
  if (k <= 0) return geo;
  const p = geo.attributes.position;
  if (!p) return geo;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const seed = opts.seed ?? 0;
  const tone = 1 + (opts.tone ?? 0) * W.tone * k;
  const y0 = opts.y0 ?? 0;
  const soilH = Math.max(0.2, opts.soilH ?? W.soilH);
  const prev = geo.attributes.color;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = n ? n.getY(i) : 0;

    // large-scale blotching, and the runs down every vertical face
    let v = tone * (1 + W.patch * k * fbm2(x * 0.17 + seed * 0.7, z * 0.17 - y * 0.05 + seed * 1.3, 3));
    const vert = 1 - Math.min(1, Math.abs(ny));
    /* The runs are SKEWED, not symmetric: mostly clean stone with occasional
     * deep dirt, which is both what a weathered wall looks like and what
     * survives an ACES shoulder. A symmetric ±12% wobble on a sun-facing wall
     * sitting at 4.5 scene-linear comes out the far side as 0.6% — measured —
     * because half of it is spent brightening a surface that is already flat
     * out. Spending the whole budget downward is worth three times as much. */
    const run = clamp(fbm2((x * 1.05 + z * 0.85) + seed * 2.9, y * 0.085 + seed * 0.4, 3) * 0.62 + 0.5, 0, 1);
    v *= 1 - W.streak * 1.9 * k * vert * Math.pow(run, 2.2);

    // Splash zone at the foot, dust on the flats, shade underneath. Splash-back
    // is thrown ONTO verticals by rain and boots, so it is gated on verticality:
    // ungated it painted a 16×12 m paved floor uniformly 25% darker, which is
    // not weathering, it is a dimmer switch.
    const s = clamp(1 - (y - y0) / soilH, 0, 1);
    const soil = W.soil * k * s * s * (0.28 + 0.72 * vert);
    const sky = W.sky * k * Math.max(0, ny) * Math.max(0, ny);
    const cav = W.cavity * k * Math.max(0, -ny);
    const val = v * (1 - soil * (1 - W.warm * 0.35) + sky - cav) * W.lift;

    // hue: mud and dust are warm, shade is the sky, so they pull opposite ways
    const warm = (soil * W.warm + sky * 0.35 - cav * W.warm * 0.7);
    const o = i * 3;
    let r = val * (1 + warm * 0.30), g = val * (1 + warm * 0.02), b = val * (1 - warm * 0.34);
    if (prev) { r *= prev.getX(i); g *= prev.getY(i); b *= prev.getZ(i); }
    col[o] = r; col[o + 1] = g; col[o + 2] = b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * Area-weighted mean and spread of a geometry's vertex colours. The mean is
 * the number that must not drift: weathering is meant to add variation, not to
 * dim the world by a third and call it mood.
 */
export function weatherStats(geo) {
  const c = geo.attributes.color, p = geo.attributes.position;
  if (!c) return null;
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < c.count; i++) { sr += c.getX(i); sg += c.getY(i); sb += c.getZ(i); }
  const N = c.count;
  const mean = [sr / N, sg / N, sb / N];
  const m = (mean[0] + mean[1] + mean[2]) / 3;
  let vv = 0;
  for (let i = 0; i < c.count; i++) {
    const l = (c.getX(i) + c.getY(i) + c.getZ(i)) / 3;
    vv += (l - m) ** 2;
  }
  return { mean, lum: m, sd: Math.sqrt(vv / N), count: N, verts: p ? p.count : 0 };
}

/** Paint a per-vertex colour from a callback (x,y,z) → [r,g,b] in 0..1. */
export function paintGeo(geo, fn) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const out = [1, 1, 1];
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), out);
    col[i * 3] = out[0]; col[i * 3 + 1] = out[1]; col[i * 3 + 2] = out[2];
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * Merge geometries into one buffer. Sources are disposed — the builder owns
 * them and they never reach the GPU. Anything missing normals gets them;
 * anything missing UVs or colours gets neutral ones so the merge stays square.
 */
export function mergeGeos(geos) {
  const list = geos.filter((g) => g && g.attributes && g.attributes.position);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  let nv = 0, ni = 0, anyColor = false;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
    if (g.attributes.color) anyColor = true;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = anyColor ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const o3 = (vo + i) * 3, o2 = (vo + i) * 2;
      pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
      nrm[o3] = n.getX(i); nrm[o3 + 1] = n.getY(i); nrm[o3 + 2] = n.getZ(i);
      if (u) { uv[o2] = u.getX(i); uv[o2 + 1] = u.getY(i); }
      if (col) {
        if (c) { col[o3] = c.getX(i); col[o3 + 1] = c.getY(i); col[o3 + 2] = c.getZ(i); }
        else { col[o3] = col[o3 + 1] = col[o3 + 2] = 1; }
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
    vo += p.count; io += g.index ? g.index.count : p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * A convex slab from a 2-D outline, extruded and bevelled on every edge.
 * This is the workhorse for architecture: voussoirs, corbels, buttresses,
 * broken wall profiles, stair stringers, brackets. Points are [x,y] pairs or
 * Vector2s in metres; the result is centred on z and UV'd in metres.
 */
export function extrudeBeveled(points, depth, opts = {}) {
  const b = Math.min(opts.bevel ?? 0.035, depth * 0.4);
  const shape = new THREE.Shape(points.map((p) => (p.isVector2 ? p : new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.005, depth - b * 2),
    bevelEnabled: b > 0.0005, bevelThickness: b, bevelSize: b, bevelOffset: 0,
    bevelSegments: opts.bevelSegments ?? 2,
    steps: opts.steps ?? 1, curveSegments: opts.curveSegments ?? 6,
  });
  g.translate(0, 0, -(depth / 2 - b));
  scaleUv(g, uvm(opts.tile ?? 2.5));
  g.computeVertexNormals();
  return g;
}

/** Shorthand: a bevelled box with honest texel density. seg≥3, always. */
export function slabGeo(w, h, d, opts = {}) {
  const r = opts.bevel ?? Math.min(0.06, Math.min(w, h, d) * 0.12);
  const g = plateGeo(w, h, d, r, opts.seg ?? 3);
  return boxUv(g, w, h, d, opts.tile ?? 2.5);
}

/**
 * A hanging cable between two points, as a real catenary rather than a sagging
 * parabola: `slack` is the extra length as a fraction of the straight run.
 */
export function catenaryPoints(a, b, slack = 0.1, n = 14) {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const V = b.y - a.y;
  const straight = Math.hypot(L, V);
  const S = straight * (1 + Math.max(0.001, slack));
  const out = [];
  if (L < 1e-3) {                                     // vertical drop: a straight line
    for (let i = 0; i <= n; i++) out.push(new THREE.Vector3().lerpVectors(a, b, i / n));
    return out;
  }
  const target = Math.sqrt(Math.max(1e-6, S * S - V * V));
  // 2c·sinh(L/2c) falls monotonically to L as c grows; bisect for the c that
  // reproduces the requested arc length.
  let lo = 1e-4, hi = 1e5;
  for (let i = 0; i < 60; i++) {
    const c = (lo + hi) * 0.5;
    (2 * c * Math.sinh(L / (2 * c)) > target) ? (lo = c) : (hi = c);
  }
  const c = (lo + hi) * 0.5;
  const x0 = L / 2 - c * Math.asinh(V / (2 * c * Math.sinh(L / (2 * c))));
  const y0 = -c * Math.cosh(x0 / c);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = t * L;
    out.push(new THREE.Vector3(
      lerp(a.x, b.x, t),
      a.y + c * Math.cosh((x - x0) / c) + y0,
      lerp(a.z, b.z, t)));
  }
  return out;
}

/**
 * A capped cylinder with world-scaled UVs. The raw CylinderGeometry maps 0..1
 * over the whole object no matter how big it is, so a 0.05 m bolt and a 3 m
 * drum get the same texture — which is the small-scale version of the mushy
 * wall problem. `tile` is metres per texture repeat.
 */
export function cylGeo(r0, r1, h, radial = 8, tile = 1.2, open = false) {
  const g = new THREE.CylinderGeometry(r0, r1, h, radial, 1, open);
  return tubeUv(g, TAU * Math.max(r0, r1), h, tile);
}

/** A torus with world-scaled UVs — hoops, mouldings, hooks, valve wheels. */
export function torusGeo(r, tube, radial = 6, tubular = 12, arc = TAU, tile = 1.0) {
  const g = new THREE.TorusGeometry(r, tube, radial, tubular, arc);
  return tubeUv(g, TAU * r, TAU * tube, tile);
}

/**
 * A triangle fan closing one end of a swept tube, facing along `dir`.
 * `dir` is the way OUT of the tube at that end, so the winding does not depend
 * on which end it is or which way the curve was drawn.
 */
function endCap(ring, dir, k) {
  const n = ring.length;
  const c = new THREE.Vector3();
  for (const p of ring) c.add(p);
  c.multiplyScalar(1 / n);
  const pos = new Float32Array((n + 1) * 3), uv = new Float32Array((n + 1) * 2);
  pos[0] = c.x; pos[1] = c.y; pos[2] = c.z;
  // a frame in the cap's own plane, so the UVs carry the tube's texel density
  const u = new THREE.Vector3(0, 1, 0).cross(dir);
  if (u.lengthSq() < 1e-8) u.set(1, 0, 0);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  for (let i = 0; i < n; i++) {
    const p = ring[i], o = (i + 1) * 3;
    pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
    _v1.subVectors(p, c);
    uv[(i + 1) * 2] = _v1.dot(u) * k; uv[(i + 1) * 2 + 1] = _v1.dot(v) * k;
  }
  // orientation from the first triangle, flipped if it disagrees with `dir`
  _v1.subVectors(ring[0], c); _v2.subVectors(ring[1 % n], c);
  const flip = _v1.cross(_v2).dot(dir) < 0;
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % n);
    if (flip) idx.push(0, b, a); else idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A tube swept along world-space points — cables, conduit, guy wires.
 *
 * CLOSED AT BOTH ENDS, because THREE.TubeGeometry is not. Every cable, guy
 * wire, conduit and reinforcing bar in the file is one of these, and an
 * uncapped one is a pipe you can see down: measured with the downward-ray
 * survey, the rebar bursting out of a broken column's crown put a hole through
 * the cap under it that fell 6.6 m down the shaft, and a console's floor cable
 * did the same at its foot. Two fans of `radial` triangles each. Pass
 * `open: true` for a tube whose ends are buried in something anyway.
 */
export function tubeAlong(points, radius, radial = 6, tile = 1.2, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const len = curve.getLength();
  const seg = clamp(Math.round(len * 2.2), 6, 96);
  const g = tubeUv(new THREE.TubeGeometry(curve, seg, radius, radial, false), TAU * radius, len, tile);
  if (opts.open) return g;
  // TubeGeometry lays out (seg + 1) rings of (radial + 1) vertices, the last
  // of each ring a seam duplicate of the first
  const pos = g.attributes.position;
  const ring = (base) => {
    const out = [];
    for (let j = 0; j < radial; j++) out.push(new THREE.Vector3().fromBufferAttribute(pos, base + j));
    return out;
  };
  const k = uvm(tile);
  const caps = [
    endCap(ring(0), curve.getTangent(0).negate(), k),
    endCap(ring(seg * (radial + 1)), curve.getTangent(1), k),
  ];
  return mergeGeos([g, ...caps]);
}

/** A straight run of pipe between two points, capped, cheap. */
export function pipeBetween(a, b, radius, radial = 8) {
  const len = a.distanceTo(b);
  const g = cylGeo(radius, radius, len, radial, 1.6);
  const m = new THREE.Matrix4();
  const dir = _v1.subVectors(b, a).normalize();
  m.makeRotationFromQuaternion(_q1.setFromUnitVectors(_v2.set(0, 1, 0), dir));
  m.setPosition(_v3.addVectors(a, b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/**
 * A broken masonry edge: a random walk along x with occasional deep notches,
 * returned as [x,y] points ready to close a 2-D outline. Ruins live or die on
 * this silhouette — a straight top edge reads as "unfinished box".
 */
export function brokenEdge(x0, x1, yLow, yHigh, r, steps = 9, snap = null) {
  const pts = [];
  /* Masonry FAILS ALONG ITS BED JOINTS. A free random walk gave a top edge
   * that sliced through the middle of stones at arbitrary heights, which is
   * the silhouette of a torn card and not of a wall — and once the face is
   * coursed (see ashlarFace) an unsnapped edge also puts the facing and the
   * silhouette permanently out of register. `snap` is the course height, and
   * `snap.y0` its origin, so every notch lands on a bed. */
  const q = snap && snap.h > 0.05
    ? (v) => snap.y0 + Math.round((clamp(v, yLow, yHigh) - snap.y0) / snap.h) * snap.h
    : (v) => clamp(v, yLow, yHigh);
  let y = q(lerp(yLow, yHigh, 0.55 + r() * 0.4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(x0, x1, t);
    y = q(y + (r() - 0.5) * (yHigh - yLow) * 0.5);
    if (r() < 0.22) y = q(lerp(yLow, y, 0.35));       // a course has fallen away
    pts.push([x, y]);
    if (i < steps && r() < 0.45) pts.push([lerp(x0, x1, t + 0.5 / steps), y]);   // a flat course
  }
  return pts;
}

/**
 * Sedimentary banding as a vertex colour — warm ochre through pale marl.
 *
 * These are linear multipliers on the (dark) rock map, not colours: the map
 * averages 0.11 linear, so a bed at 2.8 lands on 0.30 albedo — sandstone in
 * sun. Anything under about 1.5 here reads as a hole in the ground.
 */
const STRATA = [[2.89, 2.39, 1.70], [3.20, 2.75, 2.10], [2.57, 2.15, 1.63],
                [3.05, 2.47, 1.68], [2.47, 2.21, 1.89], [3.26, 2.89, 2.36]];
export function strataTint(y, seed = 0, scale = 1.1, out = [1, 1, 1]) {
  /* Bed THICKNESS is the whole game. The old version advanced the band index
   * at a constant rate with a ±0.35 wobble, so a 9 m outcrop was sixteen
   * equal stripes cycling a six-colour palette in order — a zebra, and the
   * single biggest reason these rocks read as a stack of pancakes rather than
   * as a cliff. The warp below is low-frequency and large: df/dy ranges about
   * 0.4× to 1.7×, so beds run from a third of nominal to nearly twice it, and
   * the palette never repeats at a findable pitch.
   *
   * The palette itself was 1.78:1 in luminance between its lightest and
   * darkest bed. Real sequences differ by hue far more than by value; this one
   * is 1.34:1 with the same mean (2.43), so the layering still reads across the
   * map without turning the cliff into a barcode. */
  const inv = 1 / Math.max(0.35, scale);
  const wob = fbm2(y * 0.26 + seed, seed * 0.37, 2) * (0.70 * inv)
            + noise2(y * 0.68 + seed * 2.1, seed) * (0.13 * inv);
  const f = (y + wob) * scale + seed * 3.1;
  const i = Math.floor(f);
  const band = STRATA[((i % STRATA.length) + STRATA.length) % STRATA.length];
  const next = STRATA[(((i + 1) % STRATA.length) + STRATA.length) % STRATA.length];
  // hard-ish contacts, soft within a band
  const k = clamp((f - i - 0.82) / 0.18, 0, 1);
  const grit = 0.92 + noise2(y * 9.1 + seed, seed) * 0.12;
  for (let c = 0; c < 3; c++) out[c] = lerp(band[c], next[c], k) * grit;
  return out;
}

/* ── static placement ────────────────────────────────────────────────── */

function groundY(world, x, z) {
  return world.terrain ? world.terrain.height(x, z) : 0;
}

/**
 * WHERE A PROP'S BODY HAS TO SIT FOR THE THING TO REST ON WHAT IS UNDER IT —
 * measured off the assembly's own underside, which is the only place that
 * number exists.
 *
 * THE BUG THIS EXISTS TO KILL. Every `addX` in this file builds from its
 * footprint UP, so its `pos` is the point on the ground and a level can hand
 * it a terrain sample straight. Every `makeX` builds around its CENTRE, so its
 * `pos` was half a prop too low — and the levels compensated by hand, with a
 * constant per prop type:
 *
 *     makeCrate(world, pos.setY(pos.y + 0.45), 0.7)
 *     makeBarrel(world, pos.setY(pos.y + 0.55))
 *     makeVaporator(world, pos.setY(pos.y + 1.3))
 *     makeSpire(world, V(x, y + 3, z), 5 + rng() * 4)
 *
 * A constant cannot be right, because the maker RANDOMISES its own size:
 * makeCrate takes `size` and builds at size·(0.85…1.20), so a "0.7 m" crate is
 * 0.54–0.76 m tall and the one offset the level knew about was wrong by up to
 * 11 cm in either direction. Measured over the dressed levels, lowest vertex
 * minus terrain directly beneath it:
 *
 *     makeCrate      median +0.08 m, 90th +0.15, worst +0.58   (hovering)
 *     makeBarrel     +0.09 m on every single one
 *     makeVaporator  +0.10 m on every single one
 *     makeSpire      −0.41 median, +0.27 worst  (half of them buried instead)
 *
 * Nine to fifteen centimetres of daylight under a crate is exactly what
 * "objects floating in the air on every map" looks like from eye level, and it
 * was on every crate, drum and vaporator in the game.
 *
 * So `pos` means the same thing for every maker in this file now: THE POINT ON
 * THE GROUND THE PROP STANDS ON. The lift comes from the geometry.
 *
 * @param mesh        the assembled prop, still at the origin
 * @param quaternion  the body's rotation — the underside turns with it
 * @param ground      the point it stands on
 * @param opts.bed    how far to sink it in, metres (default 1.5 cm)
 * @param opts.centre pass true for the old meaning: `ground` IS the centre
 */
export function seatOnGround(world, mesh, quaternion, ground, opts = {}) {
  /* NO GROUND, NO SEATING. `world.terrain` IS the ground in this game — every
   * level builds one — so a host without a heightfield is a physics rig, not a
   * place, and the only thing `pos` can mean there is where to put the body.
   * That is what the solver harnesses want: they drop a crate from y = 3 and
   * watch it land, or fire one at a corpse's chest height. */
  if (opts.centre || !world || !world.terrain) return ground.clone();
  mesh.updateMatrixWorld(true);
  const q = quaternion || IDENT;
  const verts = [];
  let minY = Infinity, maxY = -Infinity;
  mesh.traverse((o) => {
    const p = o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!p) return;
    for (let i = 0; i < p.count; i++) {
      _v1.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyQuaternion(q);
      verts.push(_v1.x, _v1.y, _v1.z);
      if (_v1.y < minY) minY = _v1.y;
      if (_v1.y > maxY) maxY = _v1.y;
    }
  });
  if (!isFinite(minY)) return ground.clone();
  /* THE CONTACT PATCH, not the bounding box. What decides how high a thing has
   * to sit is the ground under the part of it that TOUCHES the ground — and
   * makeSpire leans its crown up to 1.1 m sideways, so a footprint taken off
   * the full bounds went looking for terrain two metres away from anything the
   * spire rests on and hoisted it onto that. The bottom eighth of the height
   * is the part doing the standing. */
  const band = minY + Math.max(0.04, (maxY - minY) * 0.12);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    if (verts[i + 1] > band) continue;
    if (verts[i] < x0) x0 = verts[i];
    if (verts[i] > x1) x1 = verts[i];
    if (verts[i + 2] < z0) z0 = verts[i + 2];
    if (verts[i + 2] > z1) z1 = verts[i + 2];
  }
  /* The ground under a prop is not one number: a crate is 70 cm across and the
   * dunes roll. Never below the y the caller asked for, so a crate on top of a
   * stack seats on the stack and not on the sand four metres under it — and
   * then BEDDED into whatever the contact patch is standing on, by half the
   * relief across it. A rigid box perched on its uphill contact hangs its
   * downhill corner in the air by the full relief, which on canyon's slopes
   * measured 0.89 m under a 0.8 m crate; sitting it on the middle of the
   * relief halves the daylight and buries the uphill edge instead, which is
   * what every rock in this file already does deliberately. */
  /* IS IT ON THE GROUND AT ALL? — and until this line that was assumed.
   *
   * `ground.y` is the caller's answer to "what is under this". For everything
   * scattered across a level that answer IS the terrain: `findSite` fills it in
   * from `terrain.height` at the very point it hands over, so `lift` is exactly
   * zero and the loop below measures the ground the prop is standing on.
   *
   * For a crate on top of a crate stack it is nothing of the kind. The lid it
   * stands on is 1.37 m up and the sand is at zero, so `low` came back as the
   * SAND and the "relief across the contact patch" came out as the whole height
   * of the stack — which then saturated the 30% cap and bedded the crate 30% of
   * itself into the box underneath it. Measured on dead flat ground, no terrain
   * involved: `addCrateStack`'s live top crate asks for y 1.370 and is seated at
   * 1.165, **0.205 m inside the tier below it**, and it is a dynamic rigid body,
   * so it is spawned interpenetrating a static collider by 20 cm. That is every
   * stack in the game that carries a live crate, on every level, not one site.
   * It surfaced as `prop-seating`'s "alpine: addCrateStack stands on nothing",
   * which found the right crate and described it upside down.
   *
   * So the terrain is this prop's floor only where the prop is actually on it.
   * The bar is the prop's own bed-in cap: if the caller's point stands further
   * above the ground than this prop could ever legitimately be bedded, the prop
   * is standing on something else and the ground below is not its business.
   * Derived from the prop rather than picked, and the two cases are nowhere
   * near it — 0 m for anything seated on terrain against 0.19 m for a 0.64 m
   * crate, and 1.37 m for the same crate on a stack.
   *
   * `base` still reads the terrain either way: "never below the y the caller
   * asked for" is a floor, not a substitute, and a rock the terrain throws up
   * inside the contact patch still has to be stood on. */
  const bedCap = (maxY - minY) * (opts.bedMax ?? 0.3);
  const lift = ground.y - world.terrain.height(ground.x, ground.z);
  const onGround = lift <= bedCap;
  let base = ground.y, low = ground.y;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
    const h = world.terrain.height(ground.x + lerp(x0, x1, i / 2), ground.z + lerp(z0, z1, j / 2));
    if (h > base) base = h;
    if (onGround && h < low) low = h;
  }
  /* Capped at 30% of the prop's own height, because half the relief is the
   * right instinct and an unbounded one is not: the dunes let a crate sit on a
   * 47° face, where the sand falls 0.75 m across the 0.7 m the crate covers,
   * and half of that put 53% of the crate underground. A crate more than a
   * third buried is a lid lying on the sand. The cap costs nothing on the
   * float side — the seat is exactly −bed either way — it only decides how
   * much of the thing you can still see. */
  const bed = (opts.bed ?? 0.015) + Math.min((base - low) * (opts.bedSlope ?? 0.5), bedCap);
  return new THREE.Vector3(ground.x, base - minY - bed, ground.z);
}

/** Park a finished mesh in the world as level scenery. */
export function addStatic(world, mesh, position, quaternion) {
  if (position) mesh.position.copy(position);
  if (quaternion) mesh.quaternion.copy(quaternion);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  world.scene.add(mesh);
  world.statics.push(mesh);
  return mesh;
}

/**
 * The builder every static set piece is assembled with.
 *
 * Pieces are modelled in kit space (origin at the structure's footprint
 * centre, +Y up), binned by material, and merged on emit — so a ruined hall
 * with two hundred stones in it costs three draw calls, not two hundred.
 * Colliders are collected in kit space too and transformed with the rest.
 */
export class Kit {
  constructor(seed = 1) {
    this.bins = new Map();
    this.boxes = [];
    this.lights = [];
    /* Sub-assemblies that keep their own identity through the merge.
     *
     * A kit bins by material and comes out as one mesh per material, which is
     * the whole point of it — a ruined hall costs six draw calls and not two
     * hundred. A destructible piece composed into one used to be given up on
     * for that reason: "half a merged mesh cannot be hidden when it breaks", so
     * a hall was one indestructible object, colonnade and all, while the
     * identical column a level placed on its own could be cut down.
     *
     * Half a merged mesh CAN be hidden. Every geometry a maker contributes
     * occupies one contiguous run of vertices and one of indices in the merge,
     * so a part only has to remember where its run starts and ends; breaking it
     * collapses those vertices onto a point and the triangles rasterise to
     * nothing, leaving every other stone in the mesh alone. Measured on
     * addRuin: 9 separately destructible pieces for the same 6 draw calls and
     * the same 30598 triangles it always cost. Lifting them into meshes of
     * their own instead cost 53. */
    this.parts = [];
    this._part = null;
    /* WHAT ONLY THE EMIT KNOWS. A maker composed into somebody else's kit is
     * building in KIT SPACE and has no idea where the assembly will stand —
     * `kit.emit(world, position, quaternion)` decides that, later, and the
     * caller of the composed maker never sees it. That is fine for geometry
     * and colliders, which are transformed here, and fatal for anything that
     * has to be created at a WORLD point: `addCrateStack`'s live top crates
     * are rigid bodies, and a body has no kit space to live in.
     *
     * So a maker can leave a callback instead of a position. It is handed
     * (world, position, quaternion) at the end of the emit and places its own
     * bodies then — which is exactly when a bare call would have placed them,
     * so the two forms do the same thing in the same order. */
    this.deferred = [];
    this.rng = makeRng(seed);
    this.tris = 0;
    this._pm = new THREE.Matrix4();
    this._yaw = 0;
    this._placed = false;
    this._stack = [];
    // Weathering draws from its OWN stream. Sharing this.rng would shift every
    // maker's shape decisions by however many pieces it happens to emit, and
    // every seeded layout in every level would move.
    this._wrng = makeRng(seed * 7919 + 104729);
    this.weather = true;
    // Kit-space y of the ground the assembly stands on. Zero for everything
    // built up from its own footprint; addHullSection sets it to -R because its
    // origin is the cylinder axis, and without that the splash zone lands
    // halfway up an eight-metre shell instead of where it is buried.
    this.groundY = 0;
  }

  /**
   * Push a sub-assembly origin. Everything put() until the matching pop lands
   * rotated by `yaw` about Y and offset to (x,y,z), composed with whatever
   * frame is already on the stack — which is what lets one maker be called
   * either standalone or as a part of a larger composition, at any depth.
   */
  push(x = 0, y = 0, z = 0, yaw = 0) {
    this._stack.push({ m: this._pm.clone(), yaw: this._yaw, placed: this._placed });
    this._pm = this._pm.clone().multiply(_km.makeRotationY(yaw).setPosition(x, y, z));
    this._yaw += yaw;
    this._placed = true;
    return this;
  }

  pop() {
    const s = this._stack.pop();
    if (s) { this._pm = s.m; this._yaw = s.yaw; this._placed = s.placed; }
    return this;
  }

  /**
   * Bin a geometry that is already in this frame's local coordinates.
   *
   * This is the single funnel every static surface in the file goes through,
   * so it is also where weathering is applied — after the frame transform, so
   * the y a piece is painted by is its height above the STRUCTURE's base and a
   * balcony four metres up does not get mud on it.
   */
  add(geo, mat) {
    if (!geo) return geo;
    if (this._placed) geo.applyMatrix4(this._pm);
    const w = this.weather && mat && mat.userData ? mat.userData.weather : 0;
    if (w) {
      const r = this._wrng;
      geo = tessellate(geo, WEAR.cell);
      weatherGeo(geo, { strength: w, tone: r() * 2 - 1, seed: r() * 40, y0: this.groundY });
    }
    let b = this.bins.get(mat);
    if (!b) this.bins.set(mat, b = []);
    b.push(geo);
    return geo;
  }

  /** Place a geometry: rotate (XYZ euler), translate, then bin it. */
  put(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (rx || ry || rz) geo.applyMatrix4(_km.makeRotationFromEuler(_ke.set(rx, ry, rz)));
    if (x || y || z) geo.translate(x, y, z);
    return this.add(geo, mat);
  }

  /**
   * A point light belonging to this assembly. Held in kit space and created —
   * at the right place, and registered with the level so it unloads — when the
   * kit is emitted. A lamp composed into a building has no other way to know
   * where in the world it ended up.
   */
  light(x, y, z, opts = {}) {
    const p = new THREE.Vector3(x, y, z);
    if (this._placed) p.applyMatrix4(this._pm);
    this.lights.push({ p, color: opts.color ?? 0xffb060, intensity: opts.intensity ?? 16, distance: opts.distance ?? 22 });
    return this;
  }

  /** A bevelled slab, placed. opts: { bevel, seg, tile, rx, ry, rz, collide } */
  slab(mat, w, h, d, x, y, z, opts = {}) {
    const g = slabGeo(w, h, d, opts);
    this.put(g, mat, x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    if (opts.collide !== false) this.collider(x, y, z, w / 2, h / 2, d / 2, opts.ry || 0);
    return g;
  }

  /** A cylinder, placed upright unless rotated. opts: { radial, tile, collide } */
  post(mat, r0, r1, h, x, y, z, opts = {}) {
    const g = cylGeo(r0, r1, h, opts.radial ?? 12, opts.tile ?? 1.8, !!opts.open);
    this.put(g, mat, x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    if (opts.collide) this.collider(x, y, z, Math.max(r0, r1), h / 2, Math.max(r0, r1), opts.ry || 0);
    return g;
  }

  /**
   * Run `fn(world, position, quaternion)` when this kit is emitted — the hook
   * a composed maker uses for anything that needs a world point. `p` is a
   * kit-space position, handed back already transformed into the world, so
   * the maker does not have to know whether it was composed or not.
   */
  after(p, fn) {
    const c = p.clone();
    if (this._placed) c.applyMatrix4(this._pm);
    this.deferred.push({ c, yaw: this._yaw, fn });
    return this;
  }

  /** A kit-space box collider, yawed about Y. */
  collider(x, y, z, hx, hy, hz, ry = 0, friction = 0.8) {
    return this.colliderQ(x, y, z, hx, hy, hz, _kq.setFromEuler(_ke.set(0, ry, 0)), friction);
  }

  /** A kit-space box collider with an arbitrary local rotation (ramps). */
  colliderQ(x, y, z, hx, hy, hz, q, friction = 0.8) {
    const c = new THREE.Vector3(x, y, z);
    if (this._placed) c.applyMatrix4(this._pm);
    const qq = new THREE.Quaternion().setFromAxisAngle(UP, this._yaw).multiply(q);
    this.boxes.push({ c, he: new THREE.Vector3(hx, hy, hz), q: qq, friction });
    return this;
  }

  /**
   * Where the bins and the collider list stand right now — or null if a part
   * is already open, in which case a destructible maker nested inside another
   * one is simply part of it. Marks cannot nest: closing the inner part
   * splices the arrays the outer mark is counting from.
   */
  partOpen() {
    if (this._part) return null;
    const at = new Map();
    for (const [mat, arr] of this.bins) at.set(mat, arr.length);
    return (this._part = { at, boxes: this.boxes.length });
  }

  /**
   * Note everything binned since `mark` as a part of its own. Nothing moves —
   * the geometry stays in the shared bins and merges with the rest; what is
   * recorded is which of each material's geometries belong to this part, which
   * is enough to work out its vertex run once the merge has happened.
   * `spec` is whatever registerDestructible wants beyond meshes and boxes.
   */
  partClose(mark, spec) {
    if (this._part === mark) this._part = null;
    const ranges = [];
    for (const [mat, arr] of this.bins) {
      const from = mark.at.get(mat) || 0;
      if (arr.length > from) ranges.push({ mat, from, to: arr.length });
    }
    if (ranges.length) {
      this.parts.push({ spec, ranges, boxFrom: mark.boxes, boxTo: this.boxes.length });
    }
    return this;
  }

  /**
   * Merge, place and register. Returns { meshes, triangles, draws, boxes } so
   * a level (or a measuring script) can see what it just paid for — and so a
   * destructible piece can be handed the colliders it will have to give back
   * when it comes apart.
   */
  emit(world, position, quaternion = new THREE.Quaternion(), opts = {}) {
    const meshes = [];
    const madeBoxes = [];
    let triangles = 0;
    // Where every contributed geometry will land in its material's merge.
    // mergeGeos concatenates in array order, so the k'th geometry owns vertices
    // [v[k], v[k+1]) and indices [i[k], i[k+1]) — computed here because the
    // merge disposes the sources as it goes.
    const cum = this.parts.length ? new Map() : null;
    if (cum) {
      for (const [mat, geos] of this.bins) {
        const v = [0], ix = [0];
        for (const g of geos) {
          const ok = g && g.attributes && g.attributes.position;
          const nv = ok ? g.attributes.position.count : 0;
          v.push(v[v.length - 1] + nv);
          ix.push(ix[ix.length - 1] + (ok ? (g.index ? g.index.count : nv) : 0));
        }
        cum.set(mat, { v, ix });
      }
    }
    const meshOf = cum ? new Map() : null;
    for (const [mat, geos] of this.bins) {
      const geo = mergeGeos(geos);
      if (!geo) continue;
      triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const mesh = new THREE.Mesh(geo, mat);
      addStatic(world, mesh, position, quaternion);
      if (opts.receiveShadow === false) mesh.receiveShadow = false;
      if (opts.castShadow === false) mesh.castShadow = false;
      meshes.push(mesh);
      meshOf?.set(mat, mesh);
    }
    this.bins.clear();
    const recOf = [];
    if (opts.collide !== false) {
      for (const b of this.boxes) {
        const c = b.c.clone().applyQuaternion(quaternion).add(position);
        const rec = world.physics.addStaticBox(c, b.he, quaternion.clone().multiply(b.q), { friction: b.friction });
        recOf.push(rec || null);
        if (rec) madeBoxes.push(rec);
      }
    }
    // each destructible part, as the runs of the merged meshes it owns
    const pending = [];
    for (const part of this.parts) {
      const spans = [];
      for (const r of part.ranges) {
        const mesh = meshOf.get(r.mat), c = cum.get(r.mat);
        if (!mesh || !c || c.v[r.to] <= c.v[r.from]) continue;
        spans.push({ mesh, v0: c.v[r.from], v1: c.v[r.to], i0: c.ix[r.from], i1: c.ix[r.to] });
      }
      if (!spans.length) continue;
      const pb = [];
      for (let i = part.boxFrom; i < part.boxTo && i < recOf.length; i++) if (recOf[i]) pb.push(recOf[i]);
      pending.push({ ...part.spec, spans, boxes: pb, position, quaternion: quaternion.clone() });
    }
    this.parts.length = 0;
    this.boxes.length = 0;
    for (const l of this.lights) {
      const light = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
      light.position.copy(l.p).applyQuaternion(quaternion).add(position);
      world.scene.add(light);
      world.levelLights?.push(light);
    }
    this.lights.length = 0;
    this.tris += triangles;
    // registered last, so every piece's colliders exist before anything works
    // out which piece rests on which
    let parts = 0;
    for (const spec of pending) if (registerDestructible(world, spec)) parts++;
    // and last of all, whatever could only be placed once the world position
    // was known — see `after`. Last, so a body spawned here lands on colliders
    // that already exist.
    const deferred = this.deferred;
    this.deferred = [];
    for (const d of deferred) {
      d.fn(world, d.c.clone().applyQuaternion(quaternion).add(position),
        new THREE.Quaternion().setFromAxisAngle(UP, d.yaw).premultiply(quaternion));
    }
    return { meshes, triangles, draws: meshes.length, boxes: madeBoxes, parts };
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Prop                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

export class Prop {
  constructor(world, opts) {
    this.id = 'p' + (_propId++);
    this.world = world;
    this.kind = opts.kind || 'crate';
    this.toughness = opts.toughness ?? TOUGHNESS.plastoid;
    this.hp = opts.hp ?? 40;
    this.maxHp = this.hp;
    this.explosive = !!opts.explosive;
    this.generation = opts.generation ?? 0;
    this.dead = false;
    this.grippable = opts.grippable !== false;
    this.bladeColor = opts.bladeColor ?? 0x57c9ff;

    this.mesh = opts.mesh;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // A level scatters forty crates. Without this they are forty copies of one
    // crate; with it they are forty crates. Painted in the prop's own frame, so
    // the grimy end stays the grimy end after the player kicks it over.
    if (opts.weather !== false) {
      // its own stream, keyed off the prop id: drawing from the shared module
      // rng here would shift every size, material pick and yaw of every prop
      // made after it, and every seeded layout in every level with them
      const wr = makeRng(_propId * 92083 + 4441);
      const t = wr() * 2 - 1, sd = wr() * 40;
      this.mesh.traverse((o) => {
        const w = o.isMesh && o.material && o.material.userData ? o.material.userData.weather : 0;
        if (!w || !o.geometry || o.geometry.attributes.color) return;
        o.geometry.computeBoundingBox();
        weatherGeo(o.geometry, { strength: w * 0.8, tone: t, seed: sd,
          y0: o.geometry.boundingBox.min.y, soilH: opts.soilH ?? 0.55 });
      });
    }
    world.scene.add(this.mesh);

    // The collider is the real shape: whatever the factory declared, or failing
    // that a convex hull of the mesh the player is actually looking at. The
    // sphere set is now only the proxy the BLADE solver walks — it decides
    // where a cut lands, not how the prop behaves when it falls over.
    const spheres = opts.spheres || spheresForGeometry(this.mesh.geometry, 8);
    const shape = opts.shape || hullFromGeometry(this.mesh.geometry);
    /* `position` is the point on the ground this prop STANDS on — see
     * seatOnGround. `centre: true` is the escape hatch for the two callers
     * that genuinely hand in a body centre: a cut half, which is placed at the
     * centroid the slice left it at, and anything spawned in mid-air. */
    const position = opts.position
      ? seatOnGround(world, this.mesh, opts.quaternion, opts.position, opts)
      : opts.position;
    this.body = new Body({
      position, quaternion: opts.quaternion,
      spheres, shape, mass: opts.mass ?? 24,
      friction: opts.friction ?? 0.72, restitution: opts.restitution ?? 0.08,
      layer: LAYER.PROP,
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER,
      linearDamping: 0.05, angularDamping: 0.1,
    });
    this.body.userData.prop = this;
    /**
     * ARMED, so that what this prop hits finds out about it.
     *
     * A prop is the archetypal striker: it is the thing a collapse drops, a
     * blast throws and the Force picks up, and until the contact channel came
     * back the ONLY way one of them ever hurt anything was the player's own
     * hand-rolled sweep in `Player._updateHurled`. `opts.kinetic: false` is
     * for a prop that should stay inert — scenery that happens to be dynamic.
     * See src/game/Impact.js for the rule and for why only strikers are armed.
     */
    if (opts.kinetic !== false) armKinetic(this.body, opts.kinetic || null);
    world.physics.add(this.body);
    this._syncMesh();
    /**
     * AND IT PUTS ITSELF IN THE WORLD'S LIST, which used to be the caller's
     * job and was missed exactly once — with consequences that read as a
     * different bug entirely.
     *
     * "there are invisible walls or objects for example on geonosis that block
     * you." Geonosis's twenty needle spires were built with a bare
     * `makeSpire(world, p, …)` and the return value dropped. A `Prop` puts its
     * MESH in the scene and its BODY in the physics world from right here, but
     * only `world.props` gets it `update()`d — and `update` is what copies the
     * body's pose onto the mesh. So the spires were dynamic 500 kg bodies that
     * nobody synced: the collider settled, slid and toppled under gravity while
     * the drawn rock stayed exactly where it was placed. What the player walks
     * into is a 26 m convex hull standing several metres from anything visible.
     *
     * Three more things went with it, all silent: an unlisted prop is never
     * offered to the blade solver (so those spires could not be cut), never
     * disposed by `World.unload` (so it leaks across every level change), and
     * never weathered or slept.
     *
     * The header of this file has said "hand to world.addProp" since it was
     * written. A rule stated in a comment is a rule that gets missed; this is
     * the same rule, CALLED (HANDOFF §2.4). `World.addProp` is idempotent, so
     * every existing caller that still hands its prop over is unaffected.
     */
    if (world.addProp) world.addProp(this);
    else if (world.props && !world.props.includes(this)) world.props.push(this);
  }

  _syncMesh() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  /** World-space capsules the blade solver tests against. */
  capsules(out = []) {
    out.length = 0;
    const s = this.body.spheres;
    for (let i = 0; i < s.length; i++) {
      _v1.copy(s[i].c).applyQuaternion(this.body.quaternion).add(this.body.position);
      out.push({
        name: 'c' + i, p0: _v1.clone(), p1: _v1.clone(), r: s[i].r * 1.05,
        toughness: this.toughness, prop: this,
      });
    }
    return out;
  }

  update(dt) { this._syncMesh(); }

  /**
   * Cut the prop on a world-space plane. Returns the two halves, or null when
   * the geometry could not be split (in which case the caller shatters it).
   */
  cut(planePoint, planeNormal, impulse) {
    if (this.generation >= 2 || this.dead) return null;

    // move the plane into geometry space
    _m1.copy(this.mesh.matrixWorld).invert();
    const lp = _v1.copy(planePoint).applyMatrix4(_m1);
    _q1.copy(this.body.quaternion).invert();
    const ln = _v2.copy(planeNormal).applyQuaternion(_q1).normalize();

    const res = sliceGeometry(this.mesh.geometry, lp, ln);
    if (!res) return null;

    const halves = [];
    for (const [geo, sign] of [[res.front, 1], [res.back, -1]]) {
      const off = recenterGeometry(geo);
      const worldOff = off.clone().applyQuaternion(this.body.quaternion).add(this.body.position);
      const mesh = new THREE.Mesh(geo, this.mesh.material);
      const spheres = spheresForGeometry(geo, 6);
      const volScale = clamp(geo.boundingSphere.radius / (this.mesh.geometry.boundingSphere?.radius || 1), 0.12, 1);
      const half = new Prop(this.world, {
        kind: this.kind, mesh, position: worldOff, quaternion: this.body.quaternion,
        // a severed half belongs exactly where the cut left it, in mid-air
        centre: true,
        spheres, mass: Math.max(1.2, this.body.mass * volScale),
        toughness: this.toughness, hp: this.hp * volScale,
        explosive: false, generation: this.generation + 1, bladeColor: this.bladeColor,
      });
      half.body.velocity.copy(this.body.velocity);
      half.body.angularVelocity.copy(this.body.angularVelocity);
      if (impulse) {
        half.body.applyImpulse(_v3.copy(impulse).multiplyScalar(half.body.mass * 0.22 * sign), planePoint);
        half.body.applyImpulse(_v3.copy(planeNormal).multiplyScalar(half.body.mass * 1.1 * sign), planePoint);
      }
      // molten face
      const cap = new THREE.Mesh(new THREE.CircleGeometry(Math.sqrt(res.area / Math.PI) * 0.98, 16),
        makeCapMaterial(this.bladeColor));
      cap.position.copy(res.centroid).sub(off);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ln.clone().multiplyScalar(sign));
      cap.renderOrder = 2;
      mesh.add(cap);
      halves.push(half);
    }

    this.destroy(false);
    return halves;
  }

  damage(amount, point, dir) {
    this.hp -= amount;
    if (this.hp <= 0) { this.shatter(dir, point); return true; }
    return false;
  }

  /** Break into chunks — used when the prop can't be cleanly sliced. */
  shatter(dir, point) {
    if (this.dead) return;
    const centre = this.body.position.clone();
    /* SOMETHING WAS BROKEN — the one door, so a rule about breaking things has
     * one place to listen. PLAN.md §4.6's Salvage is the first caller and it
     * pays Insight for it; the prop does not know that and must not. */
    this.world?.onPropBroken?.(this, centre);
    if (this.explosive && this.world.onExplosion) {
      this.world.onExplosion(centre, 1.35);
    } else if (this.world.particles) {
      this.world.particles.sparkBurst(centre, null, 16, { speed: 7 });
      this.world.particles.smoke.spawn(centre, _v1.set(0, 1.2, 0), { life: 1.4, size: 0.6, drag: 1.6, gravity: -1, color: 0x4a4a4e, alpha: 0.4 });
    }
    const n = this.generation >= 1 ? 3 : 6;
    /**
     * A PROP WITH NO GEOMETRY CANNOT BE BROKEN INTO PIECES OF ITSELF.
     *
     * `this.mesh.geometry` was read straight, and there is a whole family of
     * props whose `mesh` is a GROUP rather than a mesh — a dropped lightsaber
     * is one, which is a hilt, an emitter and a blade. `shatter` threw on them.
     *
     * It was unreachable for as long as the only things that broke props were
     * the blade and a deliberate throw, neither of which is aimed at a dropped
     * weapon. Making every body a striker made it reachable at once: a droid
     * walking into a fallen saber, and `dropped.mjs` — a suite with nothing to
     * do with contacts — threw inside `World.update`.
     *
     * The prop still DIES, because something just destroyed it and pretending
     * otherwise would leave an indestructible object lying on the floor. It
     * simply leaves no chunks, which is the honest answer for a thing whose
     * shape the chunk-maker cannot read.
     */
    const geo = this.mesh?.geometry;
    if (!geo) { this.destroy(true); return; }
    geo.computeBoundingBox();
    const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
    for (let i = 0; i < n; i++) {
      const s = size.clone().multiplyScalar(0.24 + rng() * 0.22);
      const g = plateGeo(s.x, s.y, s.z, Math.min(s.x, s.y, s.z) * 0.18);
      const m = new THREE.Mesh(g, this.mesh.material);
      m.castShadow = true;
      const pos = centre.clone().add(_v1.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiply(size).multiplyScalar(0.6));
      this.world.spawnDebris(m, pos, new THREE.Vector3(
        (rng() - 0.5) * 6 + (dir ? dir.x * 4 : 0),
        rng() * 5 + 2,
        (rng() - 0.5) * 6 + (dir ? dir.z * 4 : 0)), s);
    }
    this.destroy(false);
  }

  destroy(disposeGeo = true) {
    if (this.dead) return;
    this.dead = true;
    this.world.physics.remove(this.body);
    this.world.scene.remove(this.mesh);
    /* TRAVERSE, because a prop's mesh is not always a Mesh. `mesh.geometry` is
     * undefined on a Group — a dropped lightsaber hilt is nineteen to
     * thirty-six separate pieces — so this threw outright on one and silently
     * leaked the children of every group-shaped prop that ever came through. */
    if (disposeGeo) this.mesh.traverse((o) => o.geometry?.dispose?.());
    /**
     * …AND THE MATERIALS, BUT ONLY WHERE THIS PROP OWNS THEM.
     *
     * Geometry is safe to free unconditionally — a prop's mesh is built for it
     * — and a material is NOT: most of the catalogue draws from shared tables,
     * and freeing one of those takes the paint off every other prop in the
     * level that is still standing. That is exactly the "enforced by corrupting
     * something another system still holds" failure `RapierWorld`'s debris
     * budget refuses to commit, one file over.
     *
     * So the flag is set by the builder that KNOWS. `Dropped.dropSaber` is the
     * one today: `buildHiltGroup` machines five fresh `MeshStandardMaterial`s
     * per hilt from the weapon's own metals, so a hilt that goes takes exactly
     * its own five with it. Everything else keeps the old behaviour and the
     * shared tables are untouched.
     */
    if (disposeGeo && this.ownsMaterials) {
      this.mesh.traverse((o) => {
        if (!o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m?.dispose?.();
      });
    }
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Factories                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A cargo crate. 0.7 m is the standard; makeCrate is what a level scatters,
 * addCrateStack is what a level should place. Two meshes: the box (which is
 * the geometry the blade slices) and one merged trim mesh — corner brackets,
 * banding and a latch, because a bare cube with a stripe on it is a cube.
 */
export function makeCrate(world, pos, size = 0.7, opts = {}) {
  assertOpts(makeCrate, opts);
  const M = propMaterials();
  /* A scattered crate varies ±18% around the size it was asked for, because
   * forty identical boxes are forty copies of one box. A crate in a STACK does
   * not: it has to be the size of the crates it is stacked with. The draw is
   * still made either way so that every seeded layout downstream lands exactly
   * where it did. */
  const vary = 0.85 + rng() * 0.35;
  const s = size * (opts.exactSize ? 1 : vary);
  const h = s * 0.9;
  // the body carries a shallow recessed panel on each face, modelled in, so
  // the silhouette is not a rectangle from any angle
  const body = [slabGeo(s, h, s, { bevel: s * 0.07, seg: 3, tile: FINE_TILE })];
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const g = slabGeo(ax ? s * 0.06 : s * 0.62, h * 0.6, az ? s * 0.06 : s * 0.62,
      { bevel: s * 0.02, seg: 2, tile: FINE_TILE });
    g.translate(ax * s * 0.5, 0, az * s * 0.5);
    body.push(g);
  }
  const geo = mergeGeos(body);
  const mesh = new THREE.Mesh(geo, rng() < 0.35 ? M.crateDark : M.crate);
  const trim = [];
  for (const sy of [1, -1]) {
    const band = slabGeo(s * 1.03, h * 0.09, s * 1.03, { bevel: s * 0.018, seg: 2, tile: FINE_TILE });
    band.translate(0, sy * h * 0.33, 0);
    trim.push(band);
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = slabGeo(s * 0.16, h * 1.01, s * 0.16, { bevel: s * 0.02, seg: 2, tile: FINE_TILE });
    c.translate(sx * s * 0.45, 0, sz * s * 0.45);
    trim.push(c);
  }
  const latch = slabGeo(s * 0.2, h * 0.16, s * 0.06, { bevel: s * 0.015, seg: 2, tile: FINE_TILE });
  latch.translate(0, 0, s * 0.52);
  trim.push(latch);
  mesh.add(new THREE.Mesh(mergeGeos(trim), M.crateDark));
  return new Prop(world, {
    kind: 'crate', mesh, position: pos,
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28),
    mass: 22 * s, toughness: TOUGHNESS.plastoid, hp: 34,
    spheres: boxSpheres(s / 2, s * 0.45, s / 2),
    shape: box(s / 2, s * 0.45, s / 2), ...opts,
  });
}

/**
 * A fuel drum: bellied, with rolled rims and hoops, a bung on top and a
 * hazard band. Explosive. One size, 0.92 m tall.
 */
export function makeBarrel(world, pos, opts = {}) {
  assertOpts(makeBarrel, opts);
  const M = propMaterials();
  const r = 0.32, h = 0.92;
  // a real drum bulges at the belly and rolls in at the chimes
  const geo = revolveGeo([
    [0, -h / 2], [r * 0.72, -h / 2], [r * 0.86, -h / 2 + 0.03], [r * 0.93, -h / 2 + 0.09],
    [r, -h * 0.16], [r, h * 0.16], [r * 0.93, h / 2 - 0.09], [r * 0.86, h / 2 - 0.03],
    [r * 0.72, h / 2], [0, h / 2],
  ], { seg: 16, tile: FINE_TILE });
  const mesh = new THREE.Mesh(geo, M.barrel);
  const trim = [];
  for (const y of [-0.26, 0.26]) {
    const ring = cylGeo(r * 1.05, r * 1.05, 0.055, 16, FINE_TILE);
    ring.translate(0, y, 0);
    trim.push(ring);
  }
  const bung = cylGeo(0.055, 0.06, 0.035, 8, FINE_TILE);
  bung.translate(r * 0.42, h / 2 + 0.005, 0);
  trim.push(bung);
  mesh.add(new THREE.Mesh(mergeGeos(trim), M.darkSteel));
  const hazard = new THREE.Mesh(cylGeo(r * 1.015, r * 1.015, 0.16, 16, FINE_TILE, true),
    new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x552200, emissiveIntensity: 0.5, roughness: 0.6 }));
  mesh.add(hazard);
  return new Prop(world, {
    kind: 'barrel', mesh, position: pos, mass: 30,
    toughness: TOUGHNESS.plastoid, hp: 22, explosive: true,
    spheres: capsuleSpheres(h / 2 - r * 0.6, r, 'y', 2),
    // a drum is a drum: it rolls on its side and stands on its chime
    shape: cylinder(h / 2, r), ...opts,
  });
}

/**
 * A free-standing pillar you can knock over. Fluted, with entasis, a moulded
 * base and a capital — the static version of the same thing is addColumn.
 */
export function makePillar(world, pos, height = 4.2, opts = {}) {
  assertOpts(makePillar, opts);
  const M = propMaterials();
  const r = 0.42;
  const sh = shaftGeo(r, r * 0.84, height - 0.5, {
    seg: 16, rings: 4, flutes: 14, fluteDepth: 0.06, entasis: 0.035, tile: 1.9,
  });
  sh.side.translate(0, -height / 2 + 0.25, 0);
  const parts = [sh.side];
  const necking = cylGeo(r * 0.9, r * 0.82, 0.16, 16, 1.2);
  necking.translate(0, height / 2 - 0.33, 0);
  parts.push(necking);
  const geo = mergeGeos(parts);
  const mesh = new THREE.Mesh(geo, M.duracrete);
  const trim = [];
  const cap = slabGeo(r * 2.5, 0.26, r * 2.5, { bevel: 0.05, seg: 3, tile: 1.6 });
  cap.translate(0, height / 2 - 0.12, 0); trim.push(cap);
  /* The echinus flares to r·1.12 and NOT to the r·1.22 it used to, because the
   * abacus above it is 2.5r across with a 5 cm bevel and therefore only flat
   * out to r·1.131. At 1.22 the flare stood proud of the lid over it, and since
   * a lathe is a single sheet with nothing behind it, the ring of plan area
   * between the two — 8 columns out of 676 in the downward-ray survey — looked
   * straight past the culled underside of the flare and down onto the pillar's
   * own BASE four metres below. A capital's abacus overhangs its echinus; this
   * one is now the right way round. */
  const ech = new THREE.LatheGeometry([
    new THREE.Vector2(r * 0.88, 0), new THREE.Vector2(r * 1.04, 0.12), new THREE.Vector2(r * 1.12, 0.25),
  ], 16);
  tubeUv(ech, TAU * r, 0.25, 1.0);
  ech.translate(0, height / 2 - 0.25, 0); trim.push(ech);
  const base = slabGeo(r * 2.6, 0.3, r * 2.6, { bevel: 0.05, seg: 3, tile: 1.6 });
  base.translate(0, -height / 2 + 0.15, 0); trim.push(base);
  const torus = torusGeo(r * 1.02, r * 0.17, 6, 16, TAU, 1.0);
  torus.rotateX(Math.PI / 2);
  torus.translate(0, -height / 2 + 0.38, 0); trim.push(torus);
  mesh.add(new THREE.Mesh(mergeGeos(trim), M.stone));
  return new Prop(world, {
    kind: 'pillar', mesh, position: pos, mass: 900,
    toughness: TOUGHNESS.armour, hp: 320, grippable: false,
    spheres: capsuleSpheres(height / 2 - r, r, 'y', Math.max(2, Math.round(height / 1.1))),
    // shaft, capital and plinth — three colliders on one body, so a toppled
    // column lies on its flutes and its base catches on the ground
    shape: compound([
      { ...cylinder(height / 2 - 0.28, r) },
      { ...box(r * 1.25, 0.13, r * 1.25), at: [0, height / 2 - 0.12, 0] },
      { ...box(r * 1.3, 0.15, r * 1.3), at: [0, -height / 2 + 0.15, 0] },
    ]), ...opts,
  });
}

/**
 * A moisture vaporator: a ribbed column with condenser fins, a cap, a service
 * panel and a valve cluster. 2.4 m of stem.
 */
export function makeVaporator(world, pos, opts = {}) {
  assertOpts(makeVaporator, opts);
  const M = propMaterials();
  const geo = revolveGeo([
    [0, -1.2], [0.24, -1.2], [0.24, -1.1], [0.19, -1.02], [0.185, -0.2], [0.2, -0.1],
    [0.2, 0.5], [0.17, 0.6], [0.17, 1.0], [0.22, 1.06], [0.22, 1.12],
  ], { seg: 14, folds: 10, foldDepth: 0.06, tile: FINE_TILE });
  const mesh = new THREE.Mesh(geo, M.steel);
  const dark = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = slabGeo(0.075, 1.45, 0.46, { bevel: 0.02, seg: 3, tile: TRIM_TILE });
    fin.applyMatrix4(_km.makeRotationY(a));
    fin.translate(Math.sin(a) * 0.3, 0.55, Math.cos(a) * 0.3);
    dark.push(fin);
    const stay = pipeBetween(new THREE.Vector3(Math.sin(a) * 0.19, -0.3, Math.cos(a) * 0.19),
      new THREE.Vector3(Math.sin(a) * 0.42, 0.05, Math.cos(a) * 0.42), 0.018, 4);
    dark.push(stay);
  }
  const panel = slabGeo(0.24, 0.36, 0.05, { bevel: 0.015, seg: 2, tile: FINE_TILE });
  panel.translate(0, -0.55, 0.2); dark.push(panel);
  mesh.add(new THREE.Mesh(mergeGeos(dark), M.darkSteel));
  const head = revolveGeo([
    [0, 1.12], [0.16, 1.14], [0.29, 1.24], [0.31, 1.4], [0.22, 1.52], [0.09, 1.57], [0, 1.58],
  ], { seg: 14, tile: FINE_TILE });
  mesh.add(new THREE.Mesh(head, M.hull));
  return new Prop(world, {
    kind: 'vaporator', mesh, position: pos, mass: 180,
    toughness: TOUGHNESS.armour, hp: 120,
    spheres: capsuleSpheres(1.1, 0.26, 'y', 3),
    // stem, head and the three condenser fins, each a collider of its own
    shape: compound([
      { ...cylinder(1.16, 0.24), at: [0, -0.04, 0] },
      { ...cylinder(0.23, 0.30), at: [0, 1.35, 0] },
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * TAU;
        return {
          ...box(0.0375, 0.725, 0.23),
          at: [Math.sin(a) * 0.3, 0.55, Math.cos(a) * 0.3],
          quat: new THREE.Quaternion().setFromAxisAngle(UP, a),
        };
      }),
    ]), ...opts,
  });
}

/**
 * A wind-carved rock spire: bedded, leaning, undercut at the base. 4–10 m.
 * Cuttable, so it stays on one material rather than vertex-coloured strata.
 */
/**
 * A STACK OF CYLINDERS THAT FOLLOWS THE SHAPE, instead of a convex hull that
 * swallows it.
 *
 * A hull is the right default for a crate and the wrong one for anything with
 * a WAIST or a LEAN, and the difference is not cosmetic. Measured on Geonosis's
 * needle spires — wasp-waisted, eroded, bent by up to a quarter of their own
 * height — the hull stands as much as 2.68 m outside the drawn rock at the
 * height a player walks at, with a mean of 0.30 m over twenty-one of them. A
 * hull cannot do better: it is by definition the smallest shape containing all
 * of the geometry, so every concavity in the silhouette becomes solid.
 *
 * That is the physical half of "there are invisible walls or objects for
 * example on geonosis that block you", and the arithmetic says why it is
 * WORST on the tallest props: the hull runs a straight line from the widest
 * ring at the bottom to the widest at the top, so the further apart those two
 * are, the more of the middle it fills in.
 *
 * The shape here is exact for anything lathe-like, which is most eroded rock:
 * slice the mesh into `n` horizontal bands, take each band's own centre in
 * plan and its own maximum radius about that centre, and emit one cylinder per
 * band. A lean is carried for free because each band is centred on itself.
 *
 * `n` is a real cost — Rapier attaches every part as its own collider — so it
 * is chosen against the height rather than fixed: a 5 m spire gets 6 and a
 * 40 m one gets 16, which is a band every metre and a half either way.
 */
export function slabCompound(geo, opts = {}) {
  const pos = geo.attributes.position;
  if (!pos || pos.count < 8) return null;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const lo = bb.min.y, hi = bb.max.y, span = hi - lo;
  if (!(span > 1e-4)) return null;
  const n = clamp(Math.round(opts.slabs ?? (span / 2.6 + 4)), 3, 20);
  const sx = new Float64Array(n), sz = new Float64Array(n), cnt = new Float64Array(n);
  const band = (y) => Math.min(n - 1, Math.max(0, Math.floor(((y - lo) / span) * n)));
  for (let i = 0; i < pos.count; i++) {
    const b = band(pos.getY(i));
    sx[b] += pos.getX(i); sz[b] += pos.getZ(i); cnt[b]++;
  }
  for (let b = 0; b < n; b++) { if (cnt[b]) { sx[b] /= cnt[b]; sz[b] /= cnt[b]; } }
  /* A band with no vertices in it borrows its neighbour's centre, so a mesh
   * whose rings do not divide evenly into `n` does not emit a cylinder at the
   * origin — which on a leaning spire is metres away from the rock. */
  for (let b = 0; b < n; b++) {
    if (cnt[b]) continue;
    let k = b; while (k > 0 && !cnt[k]) k--;
    if (!cnt[k]) { k = b; while (k < n - 1 && !cnt[k]) k++; }
    sx[b] = sx[k]; sz[b] = sz[k];
  }
  const rad = new Float64Array(n);
  for (let i = 0; i < pos.count; i++) {
    const b = band(pos.getY(i));
    const d = Math.hypot(pos.getX(i) - sx[b], pos.getZ(i) - sz[b]);
    if (d > rad[b]) rad[b] = d;
  }
  const h = span / n;
  const parts = [];
  for (let b = 0; b < n; b++) {
    if (!(rad[b] > 1e-3)) continue;
    /* A CYLINDER PER BAND UNDERSHOOTS AT THE SEAMS, because a band's radius is
     * its own maximum and the surface between two bands is a ramp. Half a band
     * of overlap in height costs nothing and closes the steps; the radius is
     * left exact, because overshooting it is the whole defect being fixed. */
    parts.push({ type: 'cylinder', radius: rad[b], halfHeight: h * 0.62,
      at: [sx[b], lo + (b + 0.5) * h, sz[b]] });
  }
  if (parts.length < 2) return null;
  return { type: 'compound', parts };
}

export function makeSpire(world, pos, height = 6, opts = {}) {
  assertOpts(makeSpire, opts);
  const M = propMaterials();
  const r = makeRng(Math.floor(rng() * 1e6) + 3);
  const seg = 11, rings = Math.max(5, Math.round(height / 0.9));
  const prof = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    // wasp-waisted: eroded soft beds pinch the middle, a cap rock sits on top
    const taper = Math.pow(1 - t, 0.62) * (1 + 0.28 * Math.sin(t * 7.3 + r()));
    const cap = t > 0.86 ? 1.5 - (t - 0.86) * 6 : 1;
    prof.push([Math.max(0.02, 0.72 * taper * cap), -height / 2 + t * height]);
  }
  prof.unshift([0, -height / 2]);
  prof.push([0, height / 2]);
  const geo = revolveGeo(prof, { seg, folds: 5, foldDepth: 0.14, tile: 1.8 });
  // lean, so a field of them does not look like a row of traffic cones
  const p3 = geo.attributes.position;
  const bendX = (r() - 0.5) * 0.5, bendZ = (r() - 0.5) * 0.5;
  for (let i = 0; i < p3.count; i++) {
    const t = (p3.getY(i) + height / 2) / height;
    p3.setX(i, p3.getX(i) + bendX * t * t * height * 0.5);
    p3.setZ(i, p3.getZ(i) + bendZ * t * t * height * 0.5);
  }
  geo.computeVertexNormals();
  // `mat`, like every other maker in this file: the one call site that wanted
  // a level's own stone passed it and was ignored, and the default it landed
  // on happened to be the same material — which is the only reason nobody saw.
  const mesh = new THREE.Mesh(geo, opts.mat || M.stone);
  return new Prop(world, {
    kind: 'spire', mesh, position: pos, mass: 500,
    toughness: TOUGHNESS.armour, hp: 200, grippable: false,
    spheres: capsuleSpheres(height / 2 - 0.6, 0.55, 'y', 4),
    /* THE SHAPE IS A SLAB STACK AND NOT A HULL, and this prop is the reason
     * `slabCompound` exists — see its note. A convex hull of a bent,
     * wasp-waisted needle stood up to 2.68 m outside the drawn rock at the
     * height a player walks at. The stack measures 0.11 m worst over the same
     * twenty-one spires, which is a collider you can feel the edge of rather
     * than one you walk into from three metres away. */
    shape: slabCompound(geo) || undefined,
    ...opts,
  });
}

/**
 * A field console: a raked desk on a plinth with a screen, a keypad and a
 * cable run into the floor. 1.1 m across.
 */
export function makeConsole(world, pos, opts = {}) {
  assertOpts(makeConsole, opts);
  const M = propMaterials();
  const parts = [slabGeo(1.1, 0.62, 0.6, { bevel: 0.05, seg: 3, tile: TRIM_TILE })];
  const desk = extrudeBeveled([[-0.55, -0.05], [0.55, -0.05], [0.55, 0.16], [-0.55, 0.3]], 0.62,
    { bevel: 0.035, tile: TRIM_TILE });
  desk.rotateY(Math.PI / 2);
  desk.translate(0, 0.38, 0);
  parts.push(desk);
  for (const sx of [-1, 1]) {
    const foot = slabGeo(0.14, 0.12, 0.66, { bevel: 0.03, seg: 2, tile: FINE_TILE });
    foot.translate(sx * 0.46, -0.36, 0);
    parts.push(foot);
  }
  const hood = slabGeo(1.06, 0.34, 0.1, { bevel: 0.03, seg: 3, tile: TRIM_TILE });
  hood.applyMatrix4(_km.makeRotationX(-0.34));
  hood.translate(0, 0.56, -0.16);
  parts.push(hood);
  const mesh = new THREE.Mesh(mergeGeos(parts), M.hull);
  const screen = new THREE.Mesh(slabGeo(0.78, 0.3, 0.04, { bevel: 0.012, seg: 2, tile: FINE_TILE }), M.emissive);
  screen.position.set(0, 0.46, 0.14); screen.rotation.x = -0.42;
  mesh.add(screen);
  const dark = [];
  const keys = slabGeo(0.62, 0.03, 0.2, { bevel: 0.008, seg: 2, tile: FINE_TILE });
  keys.applyMatrix4(_km.makeRotationX(-0.16));
  keys.translate(0, 0.42, 0.2);
  dark.push(keys);
  // The cable starts INSIDE the plinth (which spans ±0.3 in z and ±0.31 in y),
  // not on its corner. A tube is open at both ends, so an end left in the air
  // is a hole you can see down: it was the last see-through surface in the
  // maker survey, 1 downward ray in 1443 falling clean through the console.
  dark.push(tubeAlong([new THREE.Vector3(0.28, -0.22, -0.22), new THREE.Vector3(0.5, -0.4, -0.5),
    new THREE.Vector3(0.62, -0.48, -0.4)], 0.035, 5, FINE_TILE));
  mesh.add(new THREE.Mesh(mergeGeos(dark), M.darkSteel));
  return new Prop(world, {
    kind: 'console', mesh, position: pos, mass: 90,
    toughness: TOUGHNESS.heavy, hp: 90,
    spheres: boxSpheres(0.55, 0.5, 0.3),
    shape: compound([
      { ...box(0.55, 0.31, 0.3) },                                        // plinth
      { ...box(0.55, 0.12, 0.31), at: [0, 0.4, 0] },                      // raked desk
      { ...box(0.53, 0.17, 0.05), at: [0, 0.56, -0.16],                   // hood
        quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.34) },
    ]), ...opts,
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blast door — the twenty-second cut                                    */
/* ══════════════════════════════════════════════════════════════════════ */

const KERF_VERT = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vW = worldPosition.xyz;
    vec3 transformedNormal = vN;
    #include <shadowmap_vertex>
    vec4 mvPosition = viewMatrix * worldPosition;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;
/**
 * AND IT IS LIT BY THE LEVEL IT IS STANDING IN.
 *
 * The first version of this shader was `uBase * (0.72 + 0.4*vN.y)` — no sun, no
 * shadow, no ambient, no exposure. A door is a two-metre flat plate at eye
 * height, so that is one of the largest single-colour areas a level can put in
 * front of the player, and it was the same brightness on the Foundry's black
 * floor at 2.4 of key as on the arena at 6.6: measured, a 2.59x exposure swing
 * between the two rooms, on a surface that never changes. It read as a decal.
 *
 * It is on the game's own two-tone model now, which is the same one the ground,
 * the grass and every character use — one lit tone, one shadow tone at the
 * authored band, the cast shadow carried in as a MASK rather than multiplied
 * (saberCelCast), and only light 0 shaped, because a second shaped light gives
 * a flat plate four tones. The hot kerf stays outside all of it: melt is an
 * emitter, and an emitter is not lit by anything.
 */
const KERF_FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <packing>
  #include <fog_pars_fragment>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  uniform sampler2D uKerf; uniform vec3 uBase; uniform float uTime;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){
    vec4 k = texture2D(uKerf, vUv);
    float cut = k.r;              // 1 = fully melted through
    float heat = k.g;             // residual glow
    if(cut > 0.86) discard;       // the hole is a hole
    vec3 N = normalize(vN);

    // the flat half of the light: ambient plus the hemisphere, looked up along
    // world up like every other lit material in the game (saberCelFlatDir)
    vec3 irradiance = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
      #pragma unroll_loop_start
      for(int i = 0; i < NUM_HEMI_LIGHTS; i++){
        irradiance += saberCelAmbient(getHemisphereLightIrradiance(hemisphereLights[i], saberCelFlatDir(N)));
      }
      #pragma unroll_loop_end
    #endif

    vec3 direct = vec3(0.0);
    float shadow = getShadowMask();
    #if NUM_DIR_LIGHTS > 0
      #pragma unroll_loop_start
      for(int i = 0; i < NUM_DIR_LIGHTS; i++){
        {
          #if UNROLLED_LOOP_INDEX == 0
            saberCelShape = 1.0;
            saberCelCast = shadow;
          #else
            saberCelShape = 0.0;
            saberCelCast = 1.0;
          #endif
          vec3 L = inverseTransformDirection(directionalLights[i].direction, viewMatrix);
          saberCelKey = saberCelLightKey(directionalLights[i].direction);
          vec3 lc = mix(saberCelAmbient(directionalLights[i].color),
                        directionalLights[i].color, saberCelShape);
          direct += lc * saberCelTone(dot(N, L));
        }
      }
      #pragma unroll_loop_end
    #endif

    vec3 base = saberCelAlbedo(uBase) * (irradiance + direct);
    float rim = smoothstep(0.18, 0.86, cut);
    vec3 glow = mix(vec3(1.4,0.35,0.05), vec3(2.4,1.9,1.2), heat);
    vec3 c = mix(base, glow, clamp(rim*0.9 + heat*0.75, 0.0, 1.0));
    c += glow * heat * 0.6 * (0.85 + 0.15*sin(uTime*23.0 + vW.y*9.0));
    gl_FragColor = vec4(c, 1.0);
    #include <fog_fragment>
  }
`;

/**
 * THE MELT RATE EVERY BLAST DOOR SHIPS WITH, AND IT IS THE TWENTY SECONDS.
 *
 * Kerf units a second of contact at the centre of the kerf, out of the 220 of
 * 255 a texel must reach to be melted through. At a resting press — the speed
 * term in `burn` is 0.667 there — that is 4 × 0.667 × 255 = 680 units a
 * second, so ONE texel of plate opens in 0.32 s of dwell, and the twenty
 * seconds is that dwell times the metal `MELT_AREA` asks for.
 *
 * MEASURED, not chosen. A real Player on the shipped magazine, `free` scheme,
 * blade laid on the plate and the guard walked round a circle, three loop
 * sizes, one per door of the rank (tools/checks/blast-door.mjs drives exactly
 * these three), against `MELT_AREA` 0.34 m²:
 *
 *     MELT_RATE      tight loop     natural loop    wide loop    median
 *       3.6            20.1 s          21.6 s        25.0 s      21.6
 *       3.9            19.3 s          19.1 s        22.0 s      19.3
 *       4.0            17.6 s          18.8 s        21.7 s      18.8   ← ships
 *       4.2            12.0 s          21.1 s        21.3 s      21.1
 *
 * DESIGN.md prices the door at "twenty seconds of held blade". Four puts the
 * median at 18.8 with the whole band inside 17–22, and a player who traces a
 * tidier loop is rewarded with a faster breach, which is the "entirely
 * player-driven" half of the same sentence. The sweep above drives the three
 * doors of one build in one process; the shipped suite runs its other six
 * checks first, which moves the module streams under it, and reads 19.1 · 18.8
 * · 21.7 s, median 19.1. Either way the answer is twenty seconds.
 *
 * ── AND EVERY NUMBER ABOVE THIS LINE USED TO BE FICTION, which is worth a
 * paragraph because it is the reason to distrust a measured comment. The table
 * that stood here read 4 → 34.2 s and 6 → 14.9 s and was taken on a bench that
 * gave a different answer on every run of identical code: the pre-fracture
 * scheduler in src/world/Destruction.js does as much work as fits in
 * `prepareBudgetMs` of REAL TIME per frame, and a structure's cells are what it
 * publishes to the blade solver, so the frame the revetment finished
 * pre-fracturing — a fact about the machine — changed the blade's contact set
 * and moved every seconds figure this file quotes. Four consecutive runs of the
 * suite on one commit: 7/9, 7/9, 9/9, 9/9, with the same natural loop reading
 * 465 texels and never opening on one run and 16.3 s on the next. The bench
 * pins that scheduler now (see `field` in tools/checks/blast-door.mjs) and the
 * suite has been bit-identical since.
 */
const MELT_RATE = 4.0;

/**
 * HOW MUCH METAL HAS TO BE GONE BEFORE THE PLATE GIVES, in square metres.
 *
 * 0.34 m² is a panel about 58 cm on a side. A body's shoulders are 45 cm, so it
 * is a hole you get through rather than a hole you look through. In SQUARE
 * METRES and not in a share of the plate, which is the one part of the previous
 * lane's rewrite that was right and stays: `breachFraction` 0.055 of a 128² map
 * is 901 texels whatever the door measures, so resizing a door silently
 * repriced the mechanic — that is what forced the magazine's doors down from
 * 4.0 × 4.4 m to 3.3 × 3.4 to get two of nine runs over the line. A number in
 * metal cannot do that. `breachFraction` is still honoured for any caller that
 * passes one, and nothing in src/ does.
 *
 * ── WHY 0.34 AND NOT 0.55, WHICH IS THE WHOLE OF WHY THIS MECHANIC KEPT
 *    ARRIVING ON A KNIFE EDGE ──────────────────────────────────────────
 *
 * A texel already melted through cannot be melted twice, so a standing player
 * does not melt metal at a constant rate: they saturate the patch their blade
 * can reach and then creep. Measured on the shipped door, fresh World per case,
 * `free` scheme, breach suppressed so the curve can be read past the point it
 * would have opened and the melt left at the 6.0 it shipped with so that two
 * minutes is enough to see the top — the melted area against time:
 *
 *     loop radius      20 s      39 s      59 s      119 s
 *       0.25          0.242     0.536     0.547     0.550 m²
 *       0.35          0.371     0.431     0.457     0.468 m²
 *       0.50          0.552     0.552     0.553     0.560 m²
 *
 * Every drive levels off between 0.46 and 0.56 m², because that is the patch
 * the blade can reach from one standing position and no drive reaches further.
 * A quota of 0.55 m² therefore sat ON that knee: the 0.50 loop cleared it with
 * 1% to spare, the 0.35 loop SATURATES 17% SHORT AND NEVER OPENS THE DOOR AT
 * ALL, and the 0.25 loop needs a hundred and nineteen seconds. That is the
 * exact defect the metres rewrite was meant to cure — a tidy loop that plateaus
 * below the bar — moved from 901 texels to 833 and left there.
 *
 * 0.34 m² is 62–74% of the tightest of those plateaus, so every loop measured
 * opens the door and the time answers to how the player traced it rather than
 * to whether they cleared a knee. The shipped pair, fresh World per case:
 *
 *     loop radius   0.25    0.35    0.50    0.70    0.85    1.00
 *     breach       32.4 s  22.0 s  17.6 s  23.9 s  33.9 s  46.4 s
 *
 * — a bowl with its floor at the loop a standing body traces most easily, a
 * tidier loop faster than a sloppy one either side of it, and no radius that
 * cannot finish. The default control scheme, which has no loop at all and works
 * four guard zones instead, comes in at 53.0 s. `MELT_RATE` is what puts that
 * band on twenty seconds; this is what keeps a tidier player from being
 * punished for being tidy.
 */
const MELT_AREA = 0.34;

export class BlastDoor {
  constructor(world, opts = {}) {
    this.world = world;
    this.width = opts.width ?? 4.4;
    this.height = opts.height ?? 5.0;
    this.thickness = opts.thickness ?? 0.55;
    this.toughness = opts.toughness ?? TOUGHNESS.blastdoor;
    this.opened = false;
    this.onBreach = opts.onBreach || null;
    /**
     * WARDED — a plate a blade cannot start on.
     *
     * Set by whatever stands in front of this door and cleared by whatever
     * takes that thing down; `GunPit` in src/game/Emplacement.js is the one
     * writer today and its deflector is the one thing that sets it. It is NOT
     * armour and NOT a second health bar: `burn` refuses outright while it is
     * true, so no amount of blade opens a warded door and the answer is
     * elsewhere on the field. A door nobody has warded is every door that has
     * ever been in this game, which is why it defaults false.
     */
    this.warded = false;
    /**
     * HOW MUCH OF THE PLATE HAS TO BE MELTED THROUGH BEFORE THE SLUG DROPS —
     * AND IT WAS AN OPTION NOTHING COULD SET.
     *
     * `burn()` has always read `this.breachFraction ?? 0.055`, and no line in
     * this class ever assigned the field: `opts.breachFraction` was dropped on
     * the floor by the constructor, so every door in the game was pinned at the
     * default whatever its caller asked for. That is the same defect shape as
     * `addCrateStack`'s dropped `count` two thousand lines down — an option a
     * call site can write, that reads correctly, and that does nothing.
     *
     * It matters because a number like this one IS the twenty seconds — see
     * `MELT_RATE` above, which is the other half of it. A caller that wants a
     * heavier door says so here rather than editing this file.
     *
     * It is no longer the DEFAULT rule, only the override: a share of the plate
     * makes a bigger door a proportionally longer job while the patch a
     * standing player can reach stays the same size, and `MELT_AREA` carries
     * the measurement of what that cost. Nothing in src/ passes one.
     */
    /* `null` unless a caller names one — see `burn`, where the default rule is
     * melted metal in square metres and this one is the override. */
    this.breachFraction = opts.breachFraction ?? null;
    this.meltArea = opts.meltArea ?? MELT_AREA;
    /** Kerf units burned per second of contact, out of the 220 of 255 a texel
     *  must reach to be melted through. See the long note in `burn`. */
    this.meltRate = opts.meltRate ?? MELT_RATE;
    this.id = 'door' + (_propId++);

    const RES = 128;
    this.res = RES;
    this.kerfData = new Uint8Array(RES * RES * 4);
    this.kerfTex = new THREE.DataTexture(this.kerfData, RES, RES, THREE.RGBAFormat);
    this.kerfTex.needsUpdate = true;
    this.kerfTex.minFilter = THREE.LinearFilter;
    this.kerfTex.magFilter = THREE.LinearFilter;

    const geo = new THREE.BoxGeometry(this.width, this.height, this.thickness, 1, 1, 1);
    this.mat = new THREE.ShaderMaterial({
      // `UniformsLib.lights` and `lights: true` are what make the light rig
      // reach a ShaderMaterial at all; without them `directionalLights` is not
      // declared and the shader above does not compile.
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
        uKerf: { value: null },
        uBase: { value: new THREE.Color() },
        uTime: { value: 0 },
      }]),
      vertexShader: KERF_VERT, fragmentShader: KERF_FRAG, side: THREE.DoubleSide,
      lights: true, fog: true,
    });
    // …after the merge, which deep-clones every uniform value it is given.
    this.mat.uniforms.uKerf.value = this.kerfTex;
    this.mat.uniforms.uBase.value.set(opts.color ?? 0x6e747e);
    /**
     * AND IT GETS AN OUTLINE. Both ink passes hide any material whose fragment
     * shader contains the word `discard`, on the reasonable grounds that a
     * material which cuts its own silhouette cannot be drawn into a normal
     * pre-pass as its geometry. That is right for a leaf card and wrong here:
     * a blast door's silhouette IS its geometry until the player has burned a
     * hole through it, and a two-metre unlined plate at eye height in a game
     * that draws a line round everything reads as a sprite. Both passes cache
     * the answer on the material, so seeding the cache is the only lever this
     * side of the boundary; a public opt-in belongs in src/toon/.
     */
    this.mat.userData._inkCut = false;
    this.mat.userData._toonCut = false;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.copy(opts.position);
    if (opts.quaternion) this.mesh.quaternion.copy(opts.quaternion);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    /**
     * AND ITS WORLD MATRIX IS ITS OWN BUSINESS.
     *
     * `burn()` inverts `this.mesh.matrixWorld` to find where on the plate the
     * blade is touching, and nothing in this class ever composed it: the only
     * thing that walks a scene graph and composes matrices is
     * `WebGLRenderer.render`. In the game that happens to run first, so the
     * door works; anywhere without a renderer — every headless harness, and
     * therefore every check that could have caught any of the other faults
     * fixed in this class — `matrixWorld` is the IDENTITY, every contact
     * projects to a `u, v` far outside the plate, and `burn` returns false on
     * its own bounds test forever. Measured before this line existed: a real
     * Player holding a real blade on this door for 60 s raised 410 grind
     * contacts and burned 0 texels.
     *
     * A door does not move, so the matrix is composed once here and
     * `matrixAutoUpdate` goes off — which also takes it out of the renderer's
     * per-frame traversal. The frame below is set the same way for the same
     * reason.
     */
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
    world.scene.add(this.mesh);

    /**
     * THE JAMB — ONE MESH, AND IT WAS FOUR.
     *
     * The four plates round the plate are one material, one shape family and
     * one rigid frame, and they were four separate `THREE.Mesh` children of a
     * Group: FOUR DRAW CALLS PER DOOR before the door itself. This file's own
     * `Kit` exists to stop exactly that — "a machine that uses six materials is
     * six draw calls however small it is, and `world-immersion` caps a level at
     * 520" — and the one object in the tree that ignored the rule is the one
     * that ships in a rank of three. Merged, the magazine's three doors cost
     * 3 jambs + 3 plates = 6 calls instead of 15.
     *
     * It also had four geometries and `dispose()` freed none of them. See the
     * note there: `lifecycle` counts what a level hands back on unload, and a
     * door leaked its whole jamb every time you left the ground.
     */
    const M = propMaterials();
    const t = 0.4;
    const jamb = [];
    for (const [w, h, x, y] of [[this.width + t * 2, t, 0, this.height / 2 + t / 2],
                                [this.width + t * 2, t, 0, -this.height / 2 - t / 2],
                                [t, this.height + t * 2, this.width / 2 + t / 2, 0],
                                [t, this.height + t * 2, -this.width / 2 - t / 2, 0]]) {
      jamb.push(plateGeo(w, h, this.thickness * 1.6, 0.05, 1).translate(x, y, 0));
    }
    const frame = new THREE.Mesh(mergeGeos(jamb), M.darkSteel);
    frame.castShadow = true; frame.receiveShadow = true;
    frame.position.copy(this.mesh.position);
    frame.quaternion.copy(this.mesh.quaternion);
    frame.matrixAutoUpdate = false;
    frame.updateMatrix();
    frame.updateMatrixWorld(true);
    world.scene.add(frame);
    this.frame = frame;

    this.collider = world.physics.addStaticBox(
      this.mesh.position.clone(),
      new THREE.Vector3(this.width / 2, this.height / 2, this.thickness / 2),
      this.mesh.quaternion.clone(),
      { friction: 0.5, userData: { door: this } });

    this.cutArea = 0;
    this.needsUpload = false;
    this._inv = new THREE.Matrix4();
  }

  /**
   * World-space capsules so the blade solver treats it like anything else.
   *
   * ── AND `toughness: Infinity` MEANT THE WHOLE MECHANIC WAS UNREACHABLE ──
   *
   * `BladeSolver.solve` opens its per-capsule work with
   *
   *     if (tough === Infinity) { events.push({ type: 'clang', … }); continue; }
   *
   * so every one of these capsules answered a lit blade with a spark, a clash
   * and a camera shake, and NOTHING ELSE. `World._applyBladeEvent`'s grind
   * branch is the only caller of `burn()` in the game —
   * `if (ev.target.door) … door.burn(ev.point, …)` — and a door that can only
   * raise a `clang` can never raise a `grind`. So `burn`, `breach`, the kerf
   * texture, the discard-through hole, the slag, the falling slug and
   * `onBreach` were 130 lines of finished, unreachable code, and holding a
   * blade against the only blast door in the game did exactly what holding it
   * against a mountain does. DESIGN.md's "a blast door takes twenty seconds of
   * held blade and a shower of molten slag" was never once true in play.
   *
   * Three things in the tree already said what the number should be and all
   * three were ignored by this line:
   *
   *   · `TOUGHNESS.blastdoor = 110` (src/game/Combat.js) — a real entry in the
   *     material table with NO reader anywhere. The constructor stores it as
   *     `this.toughness` and then handed the solver a different number.
   *   · the solver's own worked table, twelve lines above the branch that
   *     bit: "droid torso 16 m/s CUT · blastdoor 40 m/s grinds".
   *   · `SLASH_CAP = 8  // ceiling: no speed may slash through a blast door` —
   *     a cap written for a contact that could not occur.
   *
   * `structure: true` is the second half of it, and it is the flag that says
   * this is ARCHITECTURE. It buys three things the solver already gives a wall
   * and a column: the press is not multiplied by swing speed (a blast door is
   * not something you can go faster at), the frame's advance is the raw press
   * rather than a chord through a limb, and accumulated work never fades —
   * "a kerf cut into stone does not heal", which is precisely what the molten
   * kerf on this plate is.
   */
  capsules(out = []) {
    out.length = 0;
    const hw = this.width / 2, hh = this.height / 2;
    const step = 0.55;
    for (let y = -hh + step / 2; y < hh; y += step) {
      _v1.set(-hw, y, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      _v2.set(hw, y, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      out.push({ name: 'd' + y.toFixed(2), p0: _v1.clone(), p1: _v2.clone(),
        r: this.thickness * 0.62, toughness: this.toughness, structure: true, door: this });
    }
    return out;
  }

  /** Burn the kerf where the blade is touching. Returns true when breached. */
  burn(worldPoint, power, dt) {
    if (this.opened) return false;
    /* Nothing starts while the plate is warded — see the field's own note. The
     * refusal is here, at the top of the one method that removes metal, rather
     * than at each of `burn`'s callers, because a gate a caller can forget to
     * ask about is a gate. */
    if (this.warded) return false;
    this._inv.copy(this.mesh.matrixWorld).invert();
    _v1.copy(worldPoint).applyMatrix4(this._inv);
    const u = (_v1.x / this.width + 0.5);
    const v = (_v1.y / this.height + 0.5);
    if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return false;

    const RES = this.res;
    const px = u * RES, py = (1 - v) * RES;
    const radius = RES * 0.030;
    /**
     * HOW FAST THE PLATE MELTS — AND IT WAS `power * dt * 0.55`, WHICH IS A
     * NUMBER NOBODY HAD EVER BEEN ABLE TO MEASURE.
     *
     * `power` is `ev.speed`, the blade's speed at the contact, so the old line
     * made the melt rate strictly PROPORTIONAL TO HOW FAST YOU WAVE THE BLADE.
     * Two things follow and both are wrong.
     *
     * ONE: A HELD BLADE BARELY CUT. Measured on a real Player, real World,
     * shipped solver, blade laid on the plate and traced in a slow loop —
     * contact on 99% of frames, blade speed 0.7 to 1.5 m/s — twenty seconds
     * burned EIGHT of the 901 texels a breach wanted then. Extrapolated, the door
     * DESIGN.md prices at twenty seconds of held blade came out at about five
     * minutes. Nobody had ever seen that, because until the capsule fix above
     * no blade had ever raised a contact on a door at all.
     *
     * TWO: THE ONE THING THAT DID CUT WAS A FAST SWING, and that is the exact
     * opposite of the design. `SLASH_CAP`'s comment in Combat.js — "no speed
     * may slash through a blast door" — and DESIGN.md's "twenty seconds of
     * tension, entirely player-driven" both say the hold is the mechanic. A
     * lightsaber is a torch, not an axe: it melts by CONTACT TIME, and how fast
     * you drag it decides how much PATH you trace, not how deep each point
     * goes.
     *
     * So the rate is per second of contact, with a mild speed term that
     * saturates: a swing at 6 m/s and over melts half again as fast per second
     * as a resting press, and no faster. A swing still cuts — it simply spends
     * a fiftieth of a second on each texel where opening one takes a fifth, so
     * it scores the plate and does not open it, which is what a blast door is
     * for. Measured on the shipped magazine: 60 overhead attacks over thirty
     * seconds burn 262 of the 515 texels a breach needs and the plate holds —
     * half a breach for half a minute of mashing, and the second half is not
     * coming, because a swing lands its dose on metal it has already scored.
     *
     * `meltRate` is the number the twenty seconds is set by, and it is measured
     * rather than guessed: see tools/checks/blast-door.mjs, which drives the
     * shipped door with a real Player and reports the seconds.
     */
    const rate = clamp(dt * this.meltRate * (0.6 + 0.4 * clamp(power / 6, 0, 1)), 0, 1.0) * 255;

    const x0 = Math.max(0, Math.floor(px - radius)), x1 = Math.min(RES - 1, Math.ceil(px + radius));
    const y0 = Math.max(0, Math.floor(py - radius)), y1 = Math.min(RES - 1, Math.ceil(py + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - px, y - py) / radius;
        if (d > 1) continue;
        const i = (y * RES + x) * 4;
        const add = rate * (1 - d * d);
        const prev = this.kerfData[i];
        this.kerfData[i] = Math.min(255, prev + add);
        this.kerfData[i + 1] = 255;
        if (prev < 220 && this.kerfData[i] >= 220) this.cutArea++;
      }
    }
    this.needsUpload = true;

    // slag and sparks at the contact
    if (this.world.particles) {
      _v2.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
      if (_v2.dot(_v3.subVectors(worldPoint, this.mesh.position)) < 0) _v2.negate();
      this.world.particles.slag(worldPoint, _v2, 0xffa030);
    }

    /**
     * ── WHEN THE SLUG FALLS OUT, AND WHY IT IS METAL AND NOT A SHARE ──────
     *
     * This read `cutArea / total > breachFraction`: melt 5.5% of the plate,
     * anywhere, and the door opens. Two things were wrong with that and only
     * one of them has been fixed twice.
     *
     * WHAT WAS RIGHT TO CHANGE: the rule was a SHARE OF THE PLATE, so a bigger
     * door was a proportionally longer job while the patch a standing player
     * can reach stayed the same size. That is what forced the magazine's doors
     * down from 4.0 × 4.4 m to 3.3 × 3.4 to get two of nine runs over the line
     * — a mechanic held up by a plate dimension. The rule is in SQUARE METRES
     * now (`MELT_AREA`), so resizing a door does not reprice it.
     *
     * WHAT THE FIRST REWRITE GOT WRONG, and it cost a whole lane: it decided
     * the quota itself was the defect and replaced it with a CLOSED LOOP —
     * `_slug()` flooded the uncut metal in from the rim and opened the door on
     * whatever the flood could not reach, on the reading that DESIGN.md's "when
     * your traced loop closes the slug falls out" is a rule rather than a
     * description of what a breach looks like. It never once fired. Measured on
     * the shipped magazine with the flood sampled every five seconds — three
     * `free`-scheme loops held for seventy-five seconds each and the default
     * scheme's four guard zones held for ninety — the enclosed area was ZERO on
     * all twenty-four samples, and the reason is in the kerf itself: the blade
     * lies ACROSS the plate, so a contact does not draw a line, it lays a bar.
     * A picture of the kerf after twenty seconds of the natural loop is five
     * horizontal bars stacked up the plate, spanning u 0.10–0.87 and v
     * 0.25–0.91 — a ladder, with nothing enclosed anywhere in it. A rule that
     * cannot fire is the same fault as `toughness: Infinity` up in `capsules`,
     * one layer further in, so the flood is gone and the quota is the rule.
     *
     * WHAT OPENS IT IS MELTED METAL, in square metres, and `MELT_AREA` carries
     * the measurement that says why 0.34 rather than the 0.55 this arrived at.
     * `breachFraction` stays as the override for a caller that genuinely wants
     * a share of a plate; nothing in src/ passes one.
     */
    const total = RES * RES;
    const cellArea = (this.width * this.height) / total;
    const melted = this.cutArea * cellArea;
    if (this.breachFraction != null
      ? this.cutArea / total > this.breachFraction
      : melted >= this.meltArea) { this.breach(); return true; }
    return false;
  }

  breach() {
    if (this.opened) return;
    this.opened = true;
    /**
     * AND THE DOORWAY HAS TO BE A DOORWAY, WHICH `disabled` ALONE DOES NOT BUY.
     *
     * This was one line — `this.collider.disabled = true` — and the flag is
     * read by exactly the queries that walk `physics.staticBoxes` by hand:
     * `Player._gatherNear`, the enemy sweeps, `Support.js`, the sphere solver.
     * The player therefore walked through a breached door and everything else
     * in the game did not, because `RapierWorld.addStaticBox` also creates a
     * real Rapier cuboid and NOTHING in `disabled` touches it.
     *
     * MEASURED on the shipped magazine (tools/checks/blast-door.mjs), a 0.8 m
     * crate shoved at 9 m/s from 0.90 m in front of a BREACHED door:
     *
     *     flag only          ends 0.92 m in front of it — it never moves
     *     collider removed   ends 1.28 m INSIDE the cell
     *
     * With the flag alone the crate bounces off the plane of the door it just
     * watched fall out, and so does the slug this method drops.
     *
     * That is the exact complaint the player has already made about this game
     * once ("there are invisible walls or objects for example on geonosis that
     * block you"), and it would have arrived on the same ground. The collider
     * is REMOVED, which is what "the door is gone" means to every consumer at
     * once; the flag is set as well so any near-list already built this frame
     * drops it before it is rebuilt. `dispose()` calls `removeStaticBox` again
     * and that is idempotent — it splices on `indexOf` and null-guards the
     * handle.
     */
    if (this.collider) {
      this.collider.disabled = true;
      this.world.physics.removeStaticBox(this.collider);
    }
    if (this.world.particles) {
      this.world.particles.explosion(this.mesh.position.clone(), 0.7);
    }
    // the slug falls out
    const M = propMaterials();
    const slug = new THREE.Mesh(plateGeo(this.width * 0.5, this.height * 0.45, this.thickness * 0.9, 0.05, 1), M.darkSteel);
    this.world.spawnDebris(slug, this.mesh.position.clone(),
      new THREE.Vector3((rng() - 0.5) * 2, 1, (rng() - 0.5) * 2 - 2),
      new THREE.Vector3(this.width * 0.5, this.height * 0.45, this.thickness));
    if (this.onBreach) this.onBreach(this);
  }

  update(dt) {
    this.mat.uniforms.uTime.value += dt;
    // heat bleeds away
    if (this.needsUpload) {
      const d = this.kerfData;
      for (let i = 1; i < d.length; i += 4) if (d[i] > 0) d[i] = Math.max(0, d[i] - 255 * dt * 0.55);
      this.kerfTex.needsUpdate = true;
      this.needsUpload = false;
    } else {
      const d = this.kerfData;
      let any = false;
      for (let i = 1; i < d.length; i += 4) if (d[i] > 0) { d[i] = Math.max(0, d[i] - 255 * dt * 0.55); any = true; }
      if (any) this.kerfTex.needsUpdate = true;
    }
  }

  dispose() {
    this.world.scene.remove(this.mesh, this.frame);
    this.mesh.geometry.dispose(); this.mat.dispose();
    /* THE JAMB WAS NEVER FREED. It was four meshes and four `plateGeo`
     * geometries and this method named none of them, so every level unload
     * leaked four buffer geometries per door — `lifecycle.mjs` counts exactly
     * this and would have said so the first time a level shipped a rank of
     * them. One mesh now, one geometry, one dispose. The material is
     * `propMaterials().darkSteel`, which is shared by half the level and is
     * correctly NOT disposed here. */
    this.frame.geometry.dispose();
    this.kerfTex.dispose();
    this.world.physics.removeStaticBox(this.collider);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Static architecture                                                   */
/* ══════════════════════════════════════════════════════════════════════ */


/**
 * A plain wall block. Still the cheapest way to fence something off, but it
 * now bevels its edges (seg 3, so the rounding is not a no-op) and scales its
 * UVs by world size — a 9 m wall and a 0.7 m crate used to share `repeat: 2`,
 * which is why the wall read as a grey smear and the crate read as metal.
 */
export function addWall(world, centre, size, quat = new THREE.Quaternion(), material = null) {
  const M = propMaterials();
  const geo = slabGeo(size.x, size.y, size.z, {
    bevel: Math.min(0.09, Math.min(size.x, size.y, size.z) * 0.06), seg: 3, tile: 2.6,
  });
  const mat = material || M.duracrete;
  // A wall is the single flattest thing a level places — a 92 m hangar wall was
  // 32 triangles — so it has to be tessellated before there is anywhere to put
  // the weathering. Painted in the frame it will stand in, so the splash zone
  // lands at its foot and not at its waist.
  let g2 = geo;
  if (mat.userData && mat.userData.weather) {
    g2 = tessellate(geo, WEAR.cell);
    weatherGeo(g2, { strength: mat.userData.weather, y0: -size.y / 2,
      tone: noise2(centre.x * 0.31, centre.z * 0.31), seed: (centre.x * 3.7 + centre.z * 1.9) % 40 });
  }
  const mesh = new THREE.Mesh(g2, mat);
  mesh.position.copy(centre);
  mesh.quaternion.copy(quat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  world.scene.add(mesh);
  world.physics.addStaticBox(centre, size.clone().multiplyScalar(0.5), quat, { friction: 0.8 });
  world.statics.push(mesh);
  return mesh;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Organic rock                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A stratified rock mass: bedding planes that step in and out, an undercut
 * inside each bed, an irregular plan, and a flat base so it sits on the
 * ground instead of hovering. Vertex-coloured by bed, so the layering reads
 * from across the map where a normal map has long since given up.
 *
 * `size` is half-extents. Bands are ~0.55 m of real rock regardless of scale.
 */
export function rockGeo(size, seed = 1, opts = {}) {
  const r = makeRng(seed * 7919 + 13);
  const bedT = opts.bed ?? 0.55;
  const seg = opts.seg ?? 15;
  const nb = Math.max(2, Math.round(size.y * 2 / bedT));
  const rings = opts.rings ?? clamp(Math.round(nb * 2.6), 10, 56);

  /* ── bedding ───────────────────────────────────────────────────────────
   * The old version put a bed boundary every `bed` metres exactly and stepped
   * the radius by ±13% across it with a Math.floor, three rings apart. That is
   * a stack of discs — a wedding cake — and it is precisely what every one of
   * these rocks read as. Two changes fix it:
   *
   *   · bed THICKNESS varies 0.6–2.3× the nominal, so the eye never finds the
   *     rhythm. Real sequences are 0.2 m shales under 2 m of sandstone.
   *   · relief drops to ~6% and the contact is a chamfer over the first tenth
   *     of the bed, not a cliff. Differential erosion on a real face is a few
   *     per cent of the radius; the LAYERING is carried by colour (strataTint),
   *     which survives distance where a 15% ledge just reads as a machined step.
   */
  const edges = [0];
  while (edges[edges.length - 1] < 1) {
    edges.push(edges[edges.length - 1] + (bedT / Math.max(0.4, size.y * 2)) * (0.6 + r() * 1.7));
  }
  const hard = edges.map(() => r());
  const amp = opts.bandAmp ?? 0.042;
  /** The bed's radius offset, as a fraction of `amp`, at height y01. */
  const bandRelief = (y01) => {
    let i = 0;
    while (i + 1 < edges.length && edges[i + 1] <= y01) i++;
    const lo = edges[i], hi = edges[i + 1] ?? 1;
    const f = clamp((y01 - lo) / Math.max(1e-4, hi - lo), 0, 1);
    const h = (hard[i] - 0.5) * 2;
    const chamfer = smoothstep(0, 0.22, f);             // the contact, softened
    const proud = h * (0.55 + 0.45 * chamfer) * (1 - 0.3 * f);
    // a soft bed is eaten back under the hard one above it
    const under = -0.7 * Math.pow(f, 3) * Math.max(0, (hard[i + 1] ?? 0.5) - hard[i]);
    return proud + under;
  };

  /* ── vertical jointing ─────────────────────────────────────────────────
   * What actually makes a crag read as a crag, and what was missing entirely:
   * the plan shape was a function of azimuth alone, so every rock was one
   * extruded prism. Rock parts along near-vertical joints into buttresses and
   * re-entrants; these are narrow, deep, and they drift a little with height.
   */
  const nJ = opts.joints ?? Math.max(3, Math.round(seg * 0.5));
  const jd = opts.jointDepth ?? 0.16, jPhase = r() * TAU;
  const jointMul = (a, y01) => {
    const t = a * nJ + jPhase
      + fbm2(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3, 2) * 2.4
      + noise2(y01 * 1.7 + seed * 0.5, seed) * 0.55;
    return 1 - jd * Math.pow(0.5 + 0.5 * Math.cos(t), 7);
  };

  const plan = [], crest = [];
  const tiltA = (r() - 0.5) * (opts.crestTilt ?? 0.30), tiltB = (r() - 0.5) * (opts.crestTilt ?? 0.30);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    plan.push(0.8 + fbm2(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7, 3) * 0.4);
    /* The CREST offset, per azimuth — the other half of why every one of these
     * read as a drum. prof() below gives near-vertical sides and the top ring
     * sat at one constant height all the way round, so the silhouette was a
     * cylinder capped by a disc from every angle. A real mass is taller on the
     * side the weather came from and broken down on the other.
     *
     * It has to be very nearly LINEAR in azimuth — a tilted plane — because
     * the top is closed by a triangle fan to a single apex, and a fan over a
     * rim that undulates by more than the cap is tall folds into something
     * that reads as a tied sack. Three variants were tried and all three
     * looked like laundry: scaling y per azimuth pinches the rim in while the
     * radius stays full; tapering the radius above a per-azimuth crest turns
     * the low side into a tent pole; and offsetting y on a ramp COMPRESSES
     * every ring the ramp covers, piling the whole dome onto the low side.
     * A plane tilt shears cleanly, and its centre — where the fan apex sits —
     * is still exactly on the plane. */
    const tilt = tiltA * Math.cos(a) + tiltB * Math.sin(a);
    crest.push(tilt + fbm2(Math.cos(a) * 1.15 + seed * 5, Math.sin(a) * 1.15 - seed, 3) * 0.055);
  }
  // near-vertical sides with a hard break to a bench on top: rock erodes into
  // cliffs and benches, not into ellipsoids
  const prof = (y) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(y), opts.shoulder ?? 9)), 0.25);

  const pos = new Float32Array((rings + 1) * (seg + 1) * 3), uv = new Float32Array((rings + 1) * (seg + 1) * 2);
  const bottom = [], top = [];
  const k = uvm(opts.tile ?? 2.4);
  let topSum = 0;
  for (let j = 0; j <= rings; j++) {
    const y = lerp(-0.96, 0.985, j / rings);
    const y01 = (y + 1) / 2;
    // a talus flare where it meets the ground: a rock that hits the dirt along
    // a hard vertical line is a cylinder somebody dropped, not a landform
    const flare = 1 + (opts.flare ?? 0.17) * Math.pow(clamp(1 - y01 / 0.2, 0, 1), 1.8);
    const relief = bandRelief(y01);
    const base = prof(y) * flare;
    const cw = smoothstep(0.34, 1, y01);              // the crest only bites up top
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      // A ledge that runs unbroken all the way round the mass is a lathe
      // feature. On a real face the bench is cut by the joints: it stands out a
      // metre on one buttress and has weathered flush on the next.
      const band = 1 + amp * relief * (0.3 + 1.15 * (0.5 + 0.5 * fbm2(
        Math.cos(a) * 1.9 + seed * 7, Math.sin(a) * 1.9 - seed, 2)));
      // the plan shape barely changes with height — a crag is a prism the
      // weather has bitten, not a potato; the beds do the vertical work
      const wob = 1 + fbm2(Math.cos(a) * 2.2 + seed * 3, Math.sin(a) * 2.2, 3) * 0.19
                    + fbm2(Math.cos(a) * 4.1, y * 3.4 + seed, 2) * 0.05;
      const rr = base * band * plan[i % seg] * wob * jointMul(a, y01);
      const o = (j * (seg + 1) + i) * 3, o2 = (j * (seg + 1) + i) * 2;
      const x = Math.cos(a) * rr * size.x, z = Math.sin(a) * rr * size.z;
      const yy = (y + crest[i % seg] * cw) * size.y;
      pos[o] = x; pos[o + 1] = yy; pos[o + 2] = z;
      uv[o2] = a * Math.max(size.x, size.z) * k; uv[o2 + 1] = yy * k;
      if (i < seg) {
        if (j === 0) bottom.push(new THREE.Vector3(x, yy, z));
        if (j === rings) { top.push(new THREE.Vector3(x, yy, z)); topSum += yy; }
      }
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  side.setIndex(idx);
  side.computeVertexNormals();
  // the cap closes on the MEAN of the rim, not on a fixed apex — with a ragged
  // crest a fixed apex is a spike sticking out of the low side
  const capY = topSum / Math.max(1, top.length) + size.y * 0.07;
  const geo = mergeGeos([side, fanCap(top, capY, true, 2.4),
    fanCap(bottom, -size.y * 1.06, false, 2.4)]);
  if (opts.dip) geo.applyMatrix4(_km.makeRotationZ(opts.dip));
  // Beds pinch, swell and undulate across a face; a contact that is a dead
  // horizontal line all the way round is a machined groove. Perturbing the
  // sample height by a metre-scale function of x and z costs one fbm and buys
  // every contact a bit of geology.
  return paintGeo(geo, (x, y, z, out) => strataTint(
    y + (opts.bedOffset || 0) + fbm2(x * 0.11 + seed, z * 0.11, 2) * (opts.bed ?? 0.55) * 0.9,
    seed, 1 / (opts.bed ?? 0.55), out));
}

/**
 * An irregular rock. Same call as before — `size` is half-extents, `seed`
 * picks the shape — but it is now bedded rock rather than a lumpy potato:
 * layered, undercut, tilted a few degrees off level, and coloured by bed.
 */
export function addRock(world, centre, size, seed = 1) {
  const M = propMaterials();
  const r = makeRng(seed * 7919 + 13);
  const geo = rockGeo(size, seed, { dip: (r() - 0.5) * 0.16 });
  weatherGeo(geo, { strength: 1, y0: -size.y, soilH: Math.min(1.2, size.y * 0.8),
    tone: r() * 2 - 1, seed: r() * 40 });
  const mesh = new THREE.Mesh(geo, M.strata);
  mesh.position.copy(centre);
  mesh.rotation.set(0, r() * Math.PI * 2, 0);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  world.scene.add(mesh);
  world.statics.push(mesh);

  world.physics.addStaticBox(centre,
    new THREE.Vector3(size.x * 0.62, size.y * 0.6, size.z * 0.62),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, mesh.rotation.y, 0)),
    { friction: 0.9 });
  return mesh;
}

/** Place `list` of local Matrix4 as one InstancedMesh centred on `centre`. */
export function addInstanced(world, geo, mat, list, centre, opts = {}) {
  assertOpts(addInstanced, opts);
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const c = opts.colors;
  for (let i = 0; i < list.length; i++) {
    im.setMatrixAt(i, list[i]);
    if (c) im.setColorAt(i, c[i]);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = opts.castShadow !== false;
  im.receiveShadow = true;
  // Name it. Hunting one stray polygon through a frame cost a round of this
  // project, and an anonymous "Mesh:IcosahedronGeometry" in the scene graph is
  // exactly what made it expensive.
  if (opts.name) im.name = opts.name;
  im.position.copy(centre);
  if (opts.quaternion) im.quaternion.copy(opts.quaternion);
  im.matrixAutoUpdate = false; im.updateMatrix();
  im.computeBoundingSphere?.();
  world.scene.add(im);
  world.statics.push(im);
  return im;
}

/**
 * A sedimentary outcrop: one tall bedded mass — the beds are cut into the mass
 * itself, not stacked as separate discs, which is the difference between a
 * crag and a pile of plates — plus buttress spurs at its foot, a cap rock, and
 * the scree it has shed.
 *
 * `size` is the footprint radius: 4 m is a bit of cover, 8 m is a place to
 * fight around, 12 m is a landmark you can lose a squad behind.
 */
export function addOutcrop(world, pos, opts = {}) {
  assertOpts(addOutcrop, opts);
  const kit = kitOpen(pos, opts, 606);
  const M = propMaterials();
  const S = opts.size ?? 7;
  const H = opts.height ?? S * 1.25;
  const rr = kit.rng;
  const seed = opts.seed ?? 606;
  const mat = opts.mat || M.strata;

  const main = rockGeo(new THREE.Vector3(S * 0.72, H / 2, S * 0.58), seed, {
    seg: 17, bed: 0.55, dip: (rr() - 0.5) * 0.13, joints: 8, jointDepth: 0.2,
  });
  main.rotateY(rr() * TAU);
  kit.put(main, mat, 0, H / 2, 0);
  kit.collider(0, H / 2, 0, S * 0.5, H / 2, S * 0.42, rr() * TAU, 0.92);

  // spurs at the foot, leaning out of the mass — these are what stop the
  // silhouette being a single extruded blob
  const spurs = opts.spurs ?? (2 + Math.floor(rr() * 3));
  for (let i = 0; i < spurs; i++) {
    const a = (i / spurs) * TAU + rr() * 0.9;
    const sh = H * (0.22 + rr() * 0.4);
    const sw = S * (0.3 + rr() * 0.3);
    const d = S * (0.45 + rr() * 0.4);
    const g = rockGeo(new THREE.Vector3(sw, sh / 2, sw * (0.6 + rr() * 0.5)), seed + 31 + i * 7, {
      seg: 11, bed: 0.5, dip: (rr() - 0.35) * 0.5, bedOffset: 0, jointDepth: 0.19,
    });
    g.rotateY(rr() * TAU);
    kit.put(g, mat, Math.cos(a) * d, sh / 2 - sh * 0.12, Math.sin(a) * d);
    kit.collider(Math.cos(a) * d, sh / 2, Math.sin(a) * d, sw * 0.7, sh / 2, sw * 0.55, a, 0.92);
  }
  // a harder cap that has protected the beds under it
  if (opts.cap !== false) {
    const ch = H * 0.16;
    const g = rockGeo(new THREE.Vector3(S * 0.5, ch / 2, S * 0.42), seed + 91, {
      seg: 13, bed: 0.4, bandAmp: 0.05, shoulder: 14, bedOffset: H,
      crestTilt: 0.12, flare: 0.05, jointDepth: 0.1,
    });
    kit.put(g, mat, (rr() - 0.5) * S * 0.2, H - ch * 0.2, (rr() - 0.5) * S * 0.2);
  }
  if (opts.scree !== false) {
    addScree(world, new THREE.Vector3(0, 0, 0), {
      kit, radius: S * 1.7, count: opts.screeCount ?? Math.round(S * 14), seed: (opts.seed ?? 606) + 91,
      inner: S * 0.5, size: 0.16 + S * 0.02,
    });
  }
  return kitClose(world, kit, pos, opts);
}

/**
 * A natural rock arch — two legs and a bedded span, swept as one tube so the
 * strata run continuously over the top. Spans 8–24 m.
 */
export function addRockArch(world, pos, opts = {}) {
  assertOpts(addRockArch, opts);
  const kit = kitOpen(pos, opts, 707);
  const M = propMaterials();
  const span = opts.span ?? 14;
  const H = opts.height ?? span * 0.75;
  const th = opts.thickness ?? span * 0.16;
  const seed = opts.seed ?? 707;
  const rr = kit.rng;
  const N = opts.stations ?? 20, SIDES = opts.sides ?? 10;
  const k = uvm(2.6);

  const pos3 = [], uv = [], col = [], idx = [];
  const ends = [[], []];
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    const a = Math.PI * (1 - t);                       // left leg → over → right leg
    const cx = Math.cos(a) * span / 2;
    const cy = Math.sin(a * 0.94 + 0.06) * H;
    // legs are fat and buried, the span is thin
    const fat = th * lerp(1.75, 0.85, Math.sin(t * Math.PI));
    for (let i = 0; i <= SIDES; i++) {
      const ang = (i / SIDES) * TAU;
      const wob = 1 + fbm2(Math.cos(ang) * 1.9 + seed, Math.sin(ang) * 1.9 + t * 5, 3) * 0.24;
      const bed = 1 + Math.sin((cy + Math.sin(ang) * fat) * 3.4 + seed) * 0.15
                    + Math.sin((cy + Math.sin(ang) * fat) * 9.1 + seed * 2) * 0.05;
      const rr2 = fat * wob * bed;
      const nx = Math.cos(a), ny = Math.sin(a);        // the arch's local frame
      const px = cx + Math.cos(ang) * rr2 * nx * 0.55 + 0;
      const py = cy + Math.cos(ang) * rr2 * ny * 0.9;
      const pz = Math.sin(ang) * rr2 * (0.85 + 0.4 * Math.sin(t * Math.PI));
      pos3.push(px, py, pz);
      uv.push(ang * fat * k, (t * span * 1.6) * k);
      const c = strataTint(py, seed, 1.9);
      col.push(c[0], c[1], c[2]);
      if (i < SIDES && (j === 0 || j === N)) ends[j === 0 ? 0 : 1].push(new THREE.Vector3(px, py, pz));
    }
  }
  /* The sweep runs LEFT LEG → OVER → RIGHT LEG, so its tangent points along
   * +x over the crown while the section is walked anticlockwise about it; for
   * that pair (a, c, b) has its normal pointing back down the radius, i.e. the
   * entire span was inside out. It is the biggest single see-through surface
   * in the file — 81% of the arch's plan area had a back face on top — and it
   * hides well, because a tube inverted along its whole length still shades
   * plausibly from underneath, where an arch is usually looked at. */
  for (let j = 0; j < N; j++) for (let i = 0; i < SIDES; i++) {
    const a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  kit.add(g, opts.mat || M.strata);

  // the legs need mass where they meet the ground, or the arch looks pasted on
  for (const sx of [-1, 1]) {
    const foot = rockGeo(new THREE.Vector3(th * 1.9, th * 1.5, th * 1.7), seed + (sx > 0 ? 3 : 8), {
      seg: 11, rings: 5, bed: 0.5, dip: sx * 0.1,
    });
    kit.put(foot, opts.mat || M.strata, sx * span / 2, th * 0.5, 0);
    kit.collider(sx * span / 2, th * 1.1, 0, th * 1.3, th * 1.6, th * 1.3, 0, 0.92);
  }
  if (opts.scree !== false) {
    addScree(world, new THREE.Vector3(0, 0, 0), {
      kit, radius: span * 0.8, count: opts.screeCount ?? Math.round(span * 9),
      seed: seed + 41, inner: 0, size: 0.14 + span * 0.012,
    });
  }
  return kitClose(world, kit, pos, opts);
}

/**
 * Three boulder shapes, so a cluster is never the same rock twice: a blocky
 * one that has split along its beds, a slabby one lying on its side, and a
 * rounder weathered one. All are squashed and half-buried by the caller — a
 * boulder resting exactly on the ground plane reads as a prop, not a rock.
 */
const BOULDER_VARIANTS = 5;
function boulderGeo(variant, seed) {
  const r = makeRng(seed * 131 + variant * 977);
  const ph = [r() * 9, r() * 9, r() * 9];
  const v = new THREE.Vector3();
  // variant 0 starts from a bevelled block: rock that has split along joints
  // keeps its corners, and a field of ellipsoids is a field of bread rolls
  const g = variant === 0 ? plateGeo(1.7, 1.4, 1.5, 0.18, 4)
    : new THREE.IcosahedronGeometry(1, variant === 2 ? 2 : 1);
  const p = g.attributes.position;
  // aspect per variant: a blocky joint block, a slab on its side, a weathered
  // round one, an upended wedge, a low flake. Three shapes, all roughly
  // spherical, is why a cluster read as seven copies of one muffin.
  const ASPECT = [[1, 0.9, 1], [1.25, 0.5, 1.05], [1, 0.86, 1], [0.78, 1.15, 0.9], [1.3, 0.42, 1.15]];
  const AMP = [0.16, 0.3, 0.24, 0.28, 0.26];
  const asp = ASPECT[variant % ASPECT.length], amp = AMP[variant % AMP.length];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n1 = Math.sin(v.x * 2.3 + ph[0]) * Math.sin(v.y * 2.9 + ph[1]) * Math.sin(v.z * 2.1 + ph[2]);
    const n2 = Math.sin(v.x * 5.1 + ph[1]) * Math.sin(v.z * 4.4 + ph[0]);
    const bed = Math.sin(v.y * 4.2 + ph[2]) * (variant === 0 ? 0.05 : 0.12);
    const kk = 1 + n1 * amp + n2 * 0.1 + bed;
    p.setXYZ(i, v.x * asp[0] * kk, v.y * asp[1] * kk, v.z * asp[2] * kk);
  }
  /* Rock BREAKS. Any amount of smooth noise on a sphere converges on a potato,
   * which is what these were; what a broken boulder actually has is a handful
   * of flat conchoidal faces meeting at edges. Flattening every vertex that
   * pokes through a random half-space costs one dot product each and turns the
   * potato into something with facets that catch the sun differently. One of
   * the planes is always the bedding plane it is lying on, so it also sits. */
  const nPlanes = variant === 2 ? 2 : 3;
  const n = new THREE.Vector3();
  for (let f = 0; f < nPlanes; f++) {
    if (f === 0) n.set((r() - 0.5) * 0.5, -1, (r() - 0.5) * 0.5).normalize();
    else n.set(r() * 2 - 1, (r() - 0.5) * 1.2, r() * 2 - 1).normalize();
    let hi = -Infinity;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); hi = Math.max(hi, v.dot(n)); }
    const d = hi * (f === 0 ? 0.86 : 0.7 + r() * 0.2);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const t = v.dot(n) - d;
      if (t > 0) { v.addScaledVector(n, -t); p.setXYZ(i, v.x, v.y, v.z); }
    }
  }
  g.computeVertexNormals();
  return triplanarUv(g, 2.4);
}

/**
 * A cluster of boulders: `count` of them, biggest in the middle, all
 * instanced off three shapes so a fifty-boulder field is three draw calls.
 * Only the ones you could hide behind get colliders.
 */
export function addBoulderCluster(world, centre, opts = {}) {
  assertOpts(addBoulderCluster, opts);
  const M = propMaterials();
  const n = opts.count ?? 12;
  const R = opts.radius ?? 6;
  const size = opts.size ?? 1.1;
  const seed = opts.seed ?? 808;
  const r = makeRng(seed * 31 + 5);
  // one instanced draw per shape, so ask for shapes in proportion to boulders:
  // five variants over seven rocks is four draw calls of two instances each
  const NV = clamp(Math.round(n / 4), 2, BOULDER_VARIANTS);
  const lists = [], cols = [];
  for (let i = 0; i < NV; i++) { lists.push([]); cols.push([]); }
  const c = new THREE.Color();
  /* WHERE the stones gathered, as a field. Without it a "cluster" of fifty
   * boulders over a 120 m radius is a uniform sprinkle with a fancy name — and
   * measured on the shipped levels, that is exactly what it was: Clark–Evans
   * 0.80-0.89 against a Poisson control's 1.0. Rejection against a bimodal
   * mask turns the same fifty stones into three or four talus fields with real
   * bare ground between them, for a handful of extra tries. */
  const field = opts.field || null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  // each variant's corners, so a tumbled boulder can be asked where its lowest
  // one lands and follow the ground THERE — see CHIP_HULL
  const hull = [];
  for (let v = 0; v < NV; v++) {
    const g = boulderGeo(v, seed), pa = g.attributes.position, out = [];
    for (let i = 0; i < pa.count; i++) out.push(pa.getX(i), pa.getY(i), pa.getZ(i));
    g.dispose();
    hull.push(out);
  }
  for (let i = 0; i < n; i++) {
    let a = 0, rad = 0, ok = !field;
    for (let attempt = 0; attempt < (field ? 7 : 1); attempt++) {
      a = r() * TAU; rad = R * Math.pow(r(), opts.crowd ?? 0.62);
      if (!field) break;
      if (r() <= field(centre.x + Math.cos(a) * rad, centre.z + Math.sin(a) * rad)) { ok = true; break; }
    }
    if (!ok) continue;
    // a much wider size ladder: a cluster of near-identical boulders reads as
    // set dressing, one with a 4:1 range between its biggest and its chips
    // reads as a rockfall
    const sc = size * lerp(1.35, 0.3, rad / R) * (0.4 + r() * r() * 1.6);
    p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    // how deep it is bedded VARIES: some sit proud, some are nearly swallowed.
    // A row all buried to the same depth is a row, however good the shapes are.
    p.y = groundY(world, centre.x + p.x, centre.z + p.z) - groundY(world, centre.x, centre.z) + sc * (0.16 - r() * 0.2);
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.7, r() * TAU, (r() - 0.5) * 0.7));
    s.set(sc * (0.8 + r() * 0.5), sc * (0.6 + r() * 0.5), sc * (0.8 + r() * 0.5));
    const v = i % NV;
    // and the ground under its LOW SIDE, not just under its middle: a boulder
    // that sits proud by 0.16·sc across a break of slope hangs otherwise. One
    // in 2646 canyon objects did, by 0.11 m. Never lifts, only beds.
    {
      const hv = hull[v];
      let lowY = Infinity, lowX = 0, lowZ = 0;
      for (let k = 0; k < hv.length; k += 3) {
        _cv.set(hv[k] * s.x, hv[k + 1] * s.y, hv[k + 2] * s.z).applyQuaternion(q);
        if (_cv.y < lowY) { lowY = _cv.y; lowX = _cv.x; lowZ = _cv.z; }
      }
      p.y += Math.min(0, groundY(world, centre.x + p.x + lowX, centre.z + p.z + lowZ)
        - groundY(world, centre.x + p.x, centre.z + p.z));
    }
    lists[v].push(m.clone().compose(p, q, s));
    const t = 0.78 + r() * 0.42;
    cols[v].push(c.clone().setRGB(t, t * (0.96 + r() * 0.08), t * (0.9 + r() * 0.1)));
    if (sc > size * 0.85) {
      world.physics.addStaticBox(
        new THREE.Vector3(centre.x + p.x, centre.y + p.y, centre.z + p.z),
        new THREE.Vector3(s.x * 0.6, s.y * 0.62, s.z * 0.6),
        q.clone(), { friction: 0.9 });
    }
  }
  const out = [];
  for (let v = 0; v < NV; v++) {
    if (!lists[v].length) continue;
    let ms = 0;
    for (const mtx of lists[v]) { mtx.decompose(_v1, _q1, _v2); ms += (_v2.x + _v2.y + _v2.z) / 3; }
    ms = Math.max(0.05, ms / lists[v].length);   // texel density off the size it is SEEN at
    out.push(addInstanced(world, scaleUv(boulderGeo(v, seed), ms), opts.mat || M.stone,
      lists[v], centre, { colors: cols[v] }));
  }
  return out;
}

/* How a chip is allowed to sit. CHIP_LEAN is the wobble off the ground's own
 * normal — enough that a field of them does not read as tiles, small enough
 * that none of them reads as standing. CHIP_REPOSE is the hard ceiling on the
 * result: 0.62 rad is 36°, the angle of repose of loose rock, which is the
 * steepest a chip can rest at before it slides instead of perching. Past that
 * the chip is leaned back toward vertical rather than dropped, so scree still
 * covers a steep bank — it just lies on it. */
const CHIP_LEAN = 0.30;      // rad, ±17° off the ground normal
const CHIP_REPOSE = 0.62;    // rad, 36° from vertical, whatever the ground does
/* And how big a chip is allowed to get. 1.5 m is not a new number: it is the
 * one Levels.js already names as where a chip stops reading as a stone lying on
 * the ground and starts reading as a shard. Nothing was enforcing it. */
/* Tightened from 1.5 to 1.35, and the number that decides it is not the
 * "shard" heuristic — it is the measured one next door. The check on the worst
 * two-tone plate (a face square to the sun with an equally big one in shade)
 * gates at 0.22 m², and area goes as the span squared: at 1.5 the dune sea's
 * worst chip measured 0.225 m² once the drift field re-drew which chip was
 * worst, and there is no reason for the ceiling on a chip's SIZE to be set by
 * anything softer than the thing that ceiling exists to prevent. */
const CHIP_SPAN = 1.35;      // metres across, the long axis
/* The unit chip's corners, so a chip can be asked where its LOWEST one lands
 * once it has been turned and scaled. An icosahedron flattened to 0.52 in y;
 * built once, because addScree places three thousand of them a level. */
const CHIP_HULL = (() => {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position, out = [], seen = new Set();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) * 0.52, z = p.getZ(i);
    const k = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
    if (seen.has(k)) continue;
    seen.add(k); out.push(x, y, z);
  }
  g.dispose();
  return out;
})();
const _cv = new THREE.Vector3();

/**
 * Scree: the chips a rock face sheds. One instanced draw, no physics, density
 * falling off with radius — the cheapest way to stop a rock from meeting the
 * ground along a hard line.
 */
export function addScree(world, centre, opts = {}) {
  assertOpts(addScree, opts);
  const M = propMaterials();
  const n = opts.count ?? 140;
  const R = opts.radius ?? 8, inner = opts.inner ?? 0;
  const size = opts.size ?? 0.22;
  const r = makeRng((opts.seed ?? 909) * 17 + 3);
  /* The chip is authored at unit size and shrunk per instance, so its LOCAL
   * tile has to be multiplied by the scale it will be seen at — a piece shrunk
   * 5× needs a 5× coarser local tile to land on the same world texel density.
   *
   * The previous line divided instead of multiplying (`1/(3*size)`), which put
   * a 20 cm chip at 0.21 m per repeat against the 2.4 m of the cliff it fell
   * off: TWELVE times finer, measured. That is the sparkle it was written to
   * prevent. `chipScale` below is the mean of the distribution generated just
   * under it, so the two cannot drift apart again.
   */
  const chipScale = Math.max(0.02, size * 0.975 * 1.0);   // mean of lerp(1.5,0.45)·(0.5+r)
  const chip = triplanarUv(new THREE.IcosahedronGeometry(0.5, 0), ROCK_TILE / chipScale);
  chip.scale(1, 0.52, 1);
  const list = [], cols = [];
  const c = new THREE.Color();
  const onGround = !opts.kit;          // composing: the parent frame owns the height
  // Chips gather where the ground gathered them — see addBoulderCluster.
  const field = opts.field || null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    let a = 0, rad = 0, ok = !field;
    for (let attempt = 0; attempt < (field ? 7 : 1); attempt++) {
      a = r() * TAU; rad = lerp(inner, R, Math.pow(r(), 0.5));
      if (!field) break;
      if (r() <= field(centre.x + Math.cos(a) * rad, centre.z + Math.sin(a) * rad)) { ok = true; break; }
    }
    if (!ok) continue;
    const sc = size * lerp(1.5, 0.45, rad / R) * (0.5 + r());
    p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    /* A CHIP LIES ON THE GROUND. It used to be turned by three unbounded Euler
     * angles, which is the same generator Levels.js already had to abandon for
     * the landmark grade: the chip is an icosahedron flattened to 0.52, so a
     * uniformly random orientation stands it on edge as often as it lays it
     * flat, and an edge-on chip is a PLATE — measured across the three outdoor
     * levels, 179 / 447 / 894 chips stood past 55° with a face over 0.6 m, up
     * to a full 90°, and 12 / 15 / 18 of them touched the ground at no point at
     * all — hence "no ground contact". That is the "unlit polygon" the
     * art director kept shooting, and it is unlit-looking for a second reason
     * the tilt causes on its own: a plate square to a low sun returns up to
     * 4.13× the radiance the flat ground does (canyon, sun at 14°), so it
     * clips to flat white on the lit side and to bare sky-ambient blue on the
     * back. Both faces are lit correctly. Neither has anything to be lit BY.
     *
     * So the plate axis is now the ground's own normal, leaned by a little, and
     * then pulled back to the angle loose rock can actually rest at. Yaw stays
     * free — that is where the variety was worth having. Exactly three randoms,
     * in the same order as the three Euler angles they replace, so every seed
     * downstream lands where it did. */
    const yaw = r() * TAU, lean = (r() * 2 - 1) * CHIP_LEAN, leanDir = r() * TAU;
    if (onGround && world.terrain?.normalAt) world.terrain.normalAt(centre.x + p.x, centre.z + p.z, _plate);
    else _plate.set(0, 1, 0);
    // lean off that normal in a random compass direction, staying on the sphere
    _tan.set(Math.cos(leanDir), 0, Math.sin(leanDir));
    _tan.addScaledVector(_plate, -_tan.dot(_plate));
    if (_tan.lengthSq() > 1e-8) _plate.applyAxisAngle(_tan.normalize(), lean);
    // and no steeper than loose rock rests: past this it slides, it does not perch
    const lie = Math.acos(clamp(_plate.y, -1, 1));
    if (lie > CHIP_REPOSE) {
      _tan.crossVectors(_plate, UP);
      if (_tan.lengthSq() > 1e-8) _plate.applyAxisAngle(_tan.normalize(), lie - CHIP_REPOSE);
    }
    q.setFromUnitVectors(UP, _plate).multiply(_q2.setFromAxisAngle(UP, yaw));
    s.set(sc * (0.7 + r() * 0.7), sc * (0.45 + r() * 0.4), sc * (0.7 + r() * 0.7));
    /* And it is a CHIP. Levels.js already names the threshold — "past about
     * 1.5 m across, a scree chip stops reading as a stone lying on the ground
     * and starts reading as a shard" — but nothing enforced it, and the tail of
     * this distribution runs to 3.15× the caller's `size`, which is 3.0 m for
     * the boulder grade. Lying flat, such a piece still presents most of a
     * square metre square to the sun: measured in the canyon, where the sun is
     * at 14° and the ground returns only 0.242, one chip came back with 0.795 m²
     * of EXCESS sunlit area after the tilt was fixed. Clamped proportionally,
     * so the shape and the random stream are both untouched. */
    const span = Math.max(s.x, s.z);
    if (span > CHIP_SPAN) s.multiplyScalar(CHIP_SPAN / span);
    /* Settled INTO the ground rather than balanced on it. The flat `sc·0.16`
     * this replaces was written for a chip standing at any angle; now that
     * every chip lies down, its own half-thickness is the only length that
     * matters, and 0.16·sc left the thinnest of them hovering clear of the
     * sand. A fifth of the half-thickness is enough to close the gap without
     * swallowing the chip. */
    /* And it follows the ground under its LOW CORNER as well as under its
     * middle. The height is sampled at the chip's origin and its plate axis is
     * the terrain normal — but that normal is a central difference over a
     * terrain cell, so on ground that curves inside one cell the chip's
     * downhill corner hangs. Measured on the arena, 22 chips of 3610 objects
     * stood clear of the ground by up to 0.34 m, which on a 0.6 m chip is most
     * of its own thickness. This term only ever pushes DOWN — it is the drop
     * from the middle of the chip to the ground beneath its lowest vertex — so
     * on flat ground nothing moves at all. */
    let drop = 0;
    if (onGround) {
      let lowY = Infinity, lowX = 0, lowZ = 0;
      for (let k = 0; k < CHIP_HULL.length; k += 3) {
        _cv.set(CHIP_HULL[k] * s.x, CHIP_HULL[k + 1] * s.y, CHIP_HULL[k + 2] * s.z).applyQuaternion(q);
        if (_cv.y < lowY) { lowY = _cv.y; lowX = _cv.x; lowZ = _cv.z; }
      }
      drop = Math.min(0, groundY(world, centre.x + p.x + lowX, centre.z + p.z + lowZ)
        - groundY(world, centre.x + p.x, centre.z + p.z));
    }
    p.y += -0.2 * (0.5 * 0.52 * s.y) + drop
      + (onGround ? groundY(world, centre.x + p.x, centre.z + p.z) - groundY(world, centre.x, centre.z) : 0);
    list.push(m.clone().compose(p, q, s));
    const t = 0.72 + r() * 0.5;
    cols.push(c.clone().setRGB(t, t * 0.95, t * 0.88));
  }
  if (opts.kit) {                       // composing: bake to geometry instead
    const geos = [];
    for (let i = 0; i < list.length; i++) {
      const g = chip.clone(); g.applyMatrix4(list[i]);
      geos.push(g);
    }
    chip.dispose();
    const merged = mergeGeos(geos);
    if (merged) opts.kit.put(merged, opts.mat || M.stone, 0, 0, 0);
    return opts.kit;
  }
  return addInstanced(world, chip, opts.mat || M.stone, list, centre,
    { colors: cols, castShadow: false, name: 'scree' });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Architecture kit                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How every `add*` maker below composes.
 *
 *   addColumn(world, worldPos, opts)            → builds and emits on its own,
 *                                                 returns { meshes, triangles, draws }
 *   addColumn(world, kitPos, { kit, ... })      → adds itself to your Kit in kit
 *                                                 space and returns the Kit
 *
 * The second form is the point of the whole file: a ruin made of forty stones
 * merges into three draw calls instead of forty. `opts.yaw` turns a piece about
 * its own footprint, `opts.seed` picks its random variation, and every maker
 * registers its own coarse box colliders unless you pass `collide: false`.
 *
 * Everything is sized off ARCH so pieces butt together without measuring:
 * columns come in whole courses, a bay is two units, a 4 m arch springs at
 * one course, and a stair of 22 steps climbs exactly one course.
 */
export const ARCH = {
  unit: 2.0,                                   // the module everything snaps to
  course: 4.0,                                 // one storey — 2 units
  bay: 4.0,                                    // column-to-column spacing
  wallT: 0.62,                                 // standard wall thickness
  slabT: 0.34,                                 // floor / balcony slab
  step: { rise: 0.1818, run: 0.30 },           // 22 steps = one 4 m course
  column: {                                    // heights in whole courses
    S: { h: 4.0, r: 0.32 },                    // 1 course
    M: { h: 6.0, r: 0.46 },                    // 1½ — a colonnade
    L: { h: 8.0, r: 0.72 },                    // 2
    XL: { h: 12.0, r: 1.05 },                  // 3 — a temple front
  },
};

/** Open a maker: returns the Kit to build into, with its frame pushed. */
function kitOpen(pos, opts, seed) {
  const kit = opts.kit || new Kit(opts.seed ?? seed);
  if (opts.kit) { kit.push(pos.x, pos.y, pos.z, opts.yaw || 0); opts._mark = kit.partOpen(); }
  else kit.push(0, 0, 0, opts.yaw || 0);
  return kit;
}
/**
 * Close a maker: emit unless the caller is composing.
 *
 * This is also the one place destructibility is wired in. A maker names what it
 * is made of (`destructible: 'stone'`); the piece is registered with the
 * world's Destruction manager, which pre-fractures it only if something ever
 * threatens it. Registration costs a bounds computation and nothing else — the
 * meshes, the draw calls and the colliders are exactly what they were.
 *
 * A maker composed into a PARENT kit (`opts.kit`) used to be dropped on the
 * floor here: its geometry had been merged into somebody else's mesh by then,
 * and half a merged mesh cannot be hidden when it breaks. So a ruined hall was
 * one indestructible object, colonnade and all, while the identical column
 * placed by a level on its own could be cut down. It is now lifted back out of
 * the shared bins as its own part (Kit.partClose) and registered at emit, at a
 * cost of one draw call per material it uses — which is why only the makers
 * that NAME a material get one, and the stair, the railing and the debris field
 * stay merged into the hall the way they always were.
 */
function kitClose(world, kit, pos, opts, destructible = null) {
  kit.pop();
  const profile = opts.destructible ?? destructible;
  if (opts.kit) {
    if (opts._mark) {
      if (profile) kit.partClose(opts._mark, { kind: opts.kind || 'piece', profile, seed: opts.seed ?? 1 });
      else if (kit._part === opts._mark) kit._part = null;      // nothing to lift out
    }
    opts._mark = null;
    return kit;
  }
  // This maker owns the whole kit. If IT is the destructible piece, then any
  // parts its own sub-makers recorded are parts of it, not pieces beside it —
  // an arch registered its two piers and then itself, so the same stone was in
  // three structures at once and each of them removed the others' colliders.
  if (profile) { kit.parts.length = 0; kit._part = null; }
  const res = kit.emit(world, pos, opts.quaternion || IDENT, opts);
  if (profile && res && res.meshes.length) {
    registerDestructible(world, {
      kind: opts.kind || 'piece', profile, seed: opts.seed ?? 1,
      meshes: res.meshes, boxes: res.boxes,
      position: pos, quaternion: opts.quaternion || IDENT,
    });
  }
  return res;
}

/**
 * Triangle fan closing a ring of points — broken tops, open shell ends.
 *
 * THE `up` FLAG USED TO DO THE OPPOSITE OF WHAT IT SAYS, and that is the whole
 * of "you can see through the tops of things".
 *
 * A fan of (apex, pts[i], pts[i+1]) over a rim walked with increasing azimuth
 * — which is how every caller here builds one — has geometric normal
 * (0, -r²·dθ, 0): it faces DOWN. So `up: true` emitted a cap that pointed at
 * the floor, the rasteriser culled it as a back face, and a vertical ray onto
 * the object passed straight through the lid into the hollow underneath.
 * Measured with a grid of downward rays over each maker, counting columns
 * whose topmost surface crossing is back-facing: addRock 36.4%, addOutcrop
 * 24.7%, addRockArch 81.6%, a broken addColumn 9.1%. 36.4% is not a rounding
 * error either — rockGeo's top ring sits at 0.606 of its widest radius, and
 * 0.606² = 0.367 is exactly the plan area the lid covers.
 *
 * The fix is not "swap the two branches", because that would only be right for
 * a caller that happens to walk its rim the same way. The RING'S OWN signed
 * area in plan decides: positive means it was walked anticlockwise seen from
 * +Y, and for that winding (apex, a, b) faces down. So a caller may hand this
 * a rim in either direction and still get the face it asked for.
 */
function fanCap(pts, cy, up = true, tile = 1.6, jog = 0) {
  const n = pts.length;
  const k = uvm(tile);
  const pos = new Float32Array((n + 1) * 3), uv = new Float32Array((n + 1) * 2);
  /* THE APEX SITS OVER THE RING, not over the maker's origin. It used to be
   * hard-wired to (0, cy, 0), which is invisible while every caller happens to
   * hand in a rim centred on its own axis — and addColossus does not: it caps
   * the break where an arm tore off, four and a half metres out to the side, so
   * the "cap" was a five-metre funnel sweeping from the statue's centre line
   * out to the stump. */
  let mx = 0, mz = 0;
  for (const p of pts) { mx += p.x; mz += p.z; }
  pos[0] = mx / n; pos[1] = cy + jog; pos[2] = mz / n;   // the apex is off-level too
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], o = (i + 1) * 3;
    pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
    uv[(i + 1) * 2] = p.x * k; uv[(i + 1) * 2 + 1] = p.z * k;
    area2 += (p.x - pos[0]) * (q.z - pos[2]) - (q.x - pos[0]) * (p.z - pos[2]);
  }
  uv[0] = pos[0] * k; uv[1] = pos[2] * k;
  // (apex, a, b) faces down for an anticlockwise ring, up for a clockwise one
  const reverse = (area2 > 0) === !!up;
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % n);
    if (reverse) idx.push(0, b, a); else idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Masonry — the difference between a wall and a panel                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The stone a wall is actually built out of, as LINEAR MULTIPLIERS on whatever
 * albedo the caller's material already has.
 *
 * MEASURED, and the whole reason this table exists. Six arena bays, rasterised
 * at 2 cm/px over the surfaces a camera in front of them can actually see, put
 * 80% of that area into TWO luminance bins out of sixteen and 46% of it into a
 * single bin — relative spread 11.5%, chroma 0.247. That is not a lighting
 * problem. A wall built as one extruded polygon has, by construction, exactly
 * one albedo, and the per-PIECE weathering tone that was supposed to break it
 * up is by definition constant across the piece it is a tone for.
 *
 * A quarry never cut two stones the same colour, so the variation belongs at
 * BLOCK scale: 1.1 × 0.7 m, which at fifty metres is about 12 × 8 pixels and
 * therefore reads. Five tones, 2.33:1 in luminance from the bleached course at
 * the top to the stained one at the foot, spanning hue as well as value
 * because real stone differs by iron content far more than by brightness.
 *
 * The WEIGHTED MEAN of the three channels has to stay on 1.0: these land in
 * the same vertex-colour attribute weathering uses, and
 * tools/checks/environment.mjs measures that attribute against 1.0 precisely so
 * that nobody can dim the world by a third and call it mood. So this table
 * carries the wall's HUE and its SPREAD, and not one stop of its exposure.
 */
const ASHLAR = [
  { w: 0.22, c: [1.62, 1.42, 1.16] },   // sun-bleached — the courses near the top
  { w: 0.35, c: [1.24, 1.00, 0.76] },   // the common bed
  { w: 0.17, c: [1.38, 0.97, 0.60] },   // ferruginous: same value, much redder
  { w: 0.17, c: [0.74, 0.60, 0.44] },   // stained — damp, lichen, the splash zone
  /* A later repair, in a paler stock. It used to be [1.06,1.00,0.90] at 0.11 —
   * r/b 1.18 against the common bed's 1.63 — and on a wall lit by a warm sun
   * and shaded by a blue sky that is not a neutral stone, it is a BLUE one:
   * measured off a close shot, a fifth of the arena's facing read cold against
   * the rest, in a level whose ground is 3.0:1 warm. Pulled to r/b 1.32 and
   * down to one stone in eleven, which is what a patched wall shows and is
   * still the least saturated thing on the face — which is the point of it. */
  { w: 0.09, c: [1.08, 0.99, 0.82] },
];
/**
 * Puts the emitted mean back on 1.0. The weighted channel mean of the table
 * above is 1.0127 — measured, not guessed — and 1.3% is well inside the ±5%
 * the weathering check allows, but the whole point of writing it down is that
 * nobody has to wonder which way the table drifted when they edit it.
 *
 * The mean is [1.248, 1.018, 0.772]: r/b of 1.62, which on the grey duracrete
 * the arena passes in lands the facing at 0.52 chroma against the sand's 0.67.
 * That gap is the point — stone quarried out of a desert is the same rock as
 * the desert, a little less saturated for having been cut and dressed. At the
 * material's own 0.24 it was a different planet.
 */
const ASHLAR_LIFT = 0.9874;

/**
 * Pick a quarry tone for a block at height fraction `t` (0 at the footing,
 * 1 at the wallhead).
 *
 * Bleaching climbs and staining sinks — that is the gradient the brief for this
 * pass asked for and it is what every photograph of an old wall shows. The two
 * bias factors are deliberately mirror images about t = 0.5, so the bias moves
 * stone around the wall without moving the wall's mean.
 */
function ashlarTone(t, r, out = [1, 1, 1]) {
  const bias = [0.5 + 1.0 * t, 1, 1, 1.5 - 1.0 * t, 1];
  let total = 0;
  for (let i = 0; i < ASHLAR.length; i++) total += ASHLAR[i].w * bias[i];
  let pick = r() * total, k = ASHLAR.length - 1;
  for (let i = 0; i < ASHLAR.length; i++) {
    pick -= ASHLAR[i].w * bias[i];
    if (pick <= 0) { k = i; break; }
  }
  // one stone is never quite the next stone even out of the same bed
  const jit = (0.90 + r() * 0.20) * ASHLAR_LIFT;
  for (let c = 0; c < 3; c++) out[c] = ASHLAR[k].c[c] * jit;
  return out;
}

/**
 * Give a whole piece one flat quarry tone.
 *
 * For masonry that is already modelled a stone at a time — voussoirs, drums,
 * fallen blocks — the block IS the piece, so it wants one ASHLAR tone rather
 * than a facing. weatherGeo multiplies into whatever colour attribute it finds,
 * so this composes with the dirt runs instead of replacing them.
 */
function tintGeo(geo, rgb) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * Sample a broken-edge polyline (see brokenEdge) at x. The points run from
 * +x to -x, so this walks them backwards; between points it takes the LOWER
 * of the two, because a stone is either still up there or it is not.
 */
function edgeSampler(pts) {
  return (x) => {
    let best = pts[0][1];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
      if (x >= lo - 1e-6 && x <= hi + 1e-6) return Math.min(a[1], b[1]);
      best = b[1];
    }
    return best;
  };
}

/**
 * A coursed ashlar facing — the visible skin of a masonry wall.
 *
 * Lays stones in equal beds across a face, clipped to the wall's broken top,
 * and emits them as two flat-shaded non-indexed geometries: the stones that
 * are still there, and the sockets where stones are not. Each block gets
 *
 *   · a quarry tone from ASHLAR, biased by height;
 *   · relief of its own, from 1 cm back inside the wall to 8 cm proud of it,
 *     so the chamfer round it catches sky along its top edge and shade along
 *     its bottom one — that, and not a drawn line, is what a course reads as
 *     at distance, and the SPREAD is what stops the face being a flat card
 *     with a grid scored into it;
 *   · a one-in-six chance of a knocked-off arris, because nothing that has
 *     stood for two thousand years has a sharp corner left on it;
 *   · a one-in-seven chance of being a bonder, two courses high, which is what
 *     breaks the wall out of a brick rhythm;
 *   · a chance of being gone, rising sharply in the two courses under the
 *     break, which emits a recessed socket in the core material instead.
 *
 * About seventy stones and 850 triangles for a 9 × 8 m face, in two bins the
 * kit is already merging — so facing every wall in a thirty-six bay ring costs
 * no extra draw calls whatsoever.
 */
function ashlarFace(w, opts = {}) {
  const r = opts.rng || rng;
  const course = Math.max(0.28, opts.course ?? 0.7);
  const zf = opts.z ?? 0;                            // the wall surface plane
  const nz = opts.nz ?? 1;                           // +1 or -1: which way is out
  const base = opts.base ?? 0;                       // y of the lowest bed joint
  const hTop = opts.height ?? 4;                     // full height above `base`
  const joint = opts.joint ?? 0.03;
  /* 3.8 cm of chamfer, down from 5. The chamfer is the only lit edge a stone
   * has, so it is also the whole reason a course reads at fifty metres — but
   * at 5 cm on a 0.7 m bed it is 7% of the stone's height, every one of them
   * catches the sun square on, and MEASURED on a close shot the wall came back
   * as a grid of cream-rimmed rectangles: cinder block with white grout. The
   * rim has to be thin enough to be a line and not a border. */
  const cham = opts.cham ?? 0.038;
  const ruin = clamp(opts.ruin ?? 0.3, 0, 1);
  const k = uvm(opts.tile ?? ARCH_TILE);
  const ledges = opts.ledges || [];
  const openings = opts.openings || [];
  const topAt = opts.topAt || (() => base + hTop);
  const tone = [1, 1, 1];
  // Mortar is a VERTEX tone of about 1.0 on purpose: its darkness comes from
  // being emitted in the core material (0.141 albedo against the facing's
  // 0.22), which is a real material difference. Carrying it as a dim vertex
  // colour instead would put a hundred square metres per wall at 0.85 into the
  // attribute the weathering check meters, and quietly darken the world.
  const MORTAR = [1.04, 0.99, 0.92];

  // 11 floats per vertex: position, normal, uv, colour. Flat-shaded and
  // non-indexed — a chamfer whose normals have been averaged with the face it
  // meets is a soft blur, which is the one thing it must not be.
  const bins = [[], []];                             // 0 = stone, 1 = socket

  const tri = (B, a, b, c, col) => {
    const A = [a[0], a[1], zf + nz * a[2]];
    const Bv = [b[0], b[1], zf + nz * b[2]];
    const Cv = [c[0], c[1], zf + nz * c[2]];
    // flipping z reverses the winding, so the far face swaps two corners back
    const p1 = nz > 0 ? Bv : Cv, p2 = nz > 0 ? Cv : Bv;
    const ux = p1[0] - A[0], uy = p1[1] - A[1], uz = p1[2] - A[2];
    const vx = p2[0] - A[0], vy = p2[1] - A[1], vz = p2[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nn = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nn) || 1;
    nx /= l; ny /= l; nn /= l;
    for (const p of [A, p1, p2]) {
      B.push(p[0], p[1], p[2], nx, ny, nn, p[0] * k, p[1] * k, col[0], col[1], col[2]);
    }
  };
  const quad = (B, a, b, c, d, col) => { tri(B, a, b, c, col); tri(B, a, c, d, col); };

  /** One dressed stone: a chamfered face standing proud of the wall plane. */
  const stone = (x0, x1, y0, y1, col, proud, chip, sunk) => {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let o = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];   // CCW seen from outside
    if (chip >= 0) {
      // knock the arris off: the corner is replaced by the two points the
      // chip cuts back to, which turns the stone into a pentagon
      const n = o.length, p = o[chip], a = o[(chip + n - 1) % n], b = o[(chip + 1) % n];
      const f = 0.12 + r() * 0.24;      // 12–36% of the edge, not half the stone
      o = o.slice(0, chip)
        .concat([[lerp(p[0], a[0], f), lerp(p[1], a[1], f)], [lerp(p[0], b[0], f), lerp(p[1], b[1], f)]])
        .concat(o.slice(chip + 1));
    }
    const inner = o.map(([x, y]) => [
      x + Math.sign(cx - x) * Math.min(cham, Math.abs(cx - x) * 0.45),
      y + Math.sign(cy - y) * Math.min(cham, Math.abs(cy - y) * 0.45),
    ]);
    const B = bins[sunk ? 1 : 0];
    /* The MORTAR BED. Without it the gap between two stones shows the panel
     * behind, which is the wall's own face material at the wall's own tone —
     * so the joints came out LIGHTER than the stones and the coursing read as
     * white grouting on bathroom tile. One quad per stone, oversized by a
     * joint so neighbours overlap and there is no gap anywhere, sitting 1.5 cm
     * behind the chamfer feet in the darker core material. */
    if (!sunk) {
      const j = cham * 0.9;
      const mx0 = Math.max(-w / 2, x0 - j), mx1 = Math.min(w / 2, x1 + j);
      const my0 = y0 - j, my1 = y1 + j * 0.4;
      // The bed sits 2.2 cm behind whatever face it is bedding, not at a fixed
      // depth: `proud` may be NEGATIVE for a stone the weather has eaten back
      // into the wall, and a bed at a fixed -1.5 cm would then be in front of
      // the stone it is supposed to be behind — a mortar joint standing proud
      // of the masonry, z-fighting the face it bounds.
      const mz = Math.min(-0.015, proud - 0.022);
      quad(bins[1], [mx0, my0, mz], [mx1, my0, mz], [mx1, my1, mz], [mx0, my1, mz], MORTAR);
    }
    for (let i = 1; i + 1 < inner.length; i++) {
      tri(B, [inner[0][0], inner[0][1], proud], [inner[i][0], inner[i][1], proud],
        [inner[i + 1][0], inner[i + 1][1], proud], col);
    }
    /* THE CHAMFER OF A RECESSED STONE FACES THE OTHER WAY, and the one winding
     * this used to emit was only right for a stone standing proud. A raised
     * block's chamfer is the outside of a plinth — normals away from the
     * block. An eroded one's is the inside of a socket — normals toward it.
     * `relief` above is negative for every empty socket and for one facing
     * stone in eight, so about an eighth of every ashlar surface in the game
     * was culled, showing the mortar bed behind it instead of the chamfer, and
     * on a ruined wallhead where nothing covers it that is a hole: measured on
     * a 10 × 6 m broken wall, 9 of 1221 downward rays fell through the crown
     * and landed up to 1.34 m inside the wall. */
    for (let i = 0; i < o.length; i++) {
      const j = (i + 1) % o.length;
      if (proud < 0) {
        quad(B, [o[j][0], o[j][1], 0], [o[i][0], o[i][1], 0],
          [inner[i][0], inner[i][1], proud], [inner[j][0], inner[j][1], proud], col);
      } else {
        quad(B, [o[i][0], o[i][1], 0], [o[j][0], o[j][1], 0],
          [inner[j][0], inner[j][1], proud], [inner[i][0], inner[i][1], proud], col);
      }
    }
  };

  const blocked = (x0, x1, y0, y1) => {
    for (const op of openings) {
      const ow = (op.w ?? 1.2) / 2 + 0.2, oh = op.h ?? 2.2, ox = op.x ?? 0, oy = (op.y ?? 0) - 0.2;
      if (x1 > ox - ow && x0 < ox + ow && y1 > oy && y0 < oy + oh + 0.3) return true;
    }
    return false;
  };

  const nCourse = Math.max(1, Math.floor(hTop / course + 0.5));
  /* Which x-ranges of the CURRENT course are already filled from below.
   *
   * A wall of equal beds all the way up is a brick wall, and the arena's read
   * as one: MEASURED off a close shot, every stone in the ring was one course
   * high and 1.3-2.6 courses long, so the eye found the rhythm instantly and
   * the whole ring became a texture. Real ashlar is not laid that way. Every
   * few stones the mason sets a BONDER — a block turned on end that ties two
   * courses together and goes right through the wall — and the courses either
   * side of it have to work round it. One in seven here, which is about what a
   * surviving Roman face shows, and it is the cheapest possible break in the
   * grid: no extra stones, no extra triangles, just two beds' worth of face on
   * one block and a gap left in the course above. */
  let taken = [];
  for (let j = 0; j < nCourse; j++) {
    const y0 = base + j * course;
    const y1 = y0 + course - joint;
    const t = clamp(j / Math.max(1, nCourse - 1), 0, 1);
    const nextTaken = [];
    let x = -w / 2;
    // Break joint. Every course starts on a different phase, or the wall is a
    // grid — and a grid of joints running straight up a wall is the one thing
    // no mason has ever built, because it falls down.
    let len0 = course * (0.6 + r() * 1.4);
    while (x < w / 2 - 1e-3) {
      let x1b = Math.min(w / 2, x + (len0 || course * (1.3 + r() * 1.3)));
      len0 = 0;
      if (w / 2 - x1b < course * 0.55) x1b = w / 2;      // no slivers at the reveal
      // a bonder from the course below already fills this run
      if (taken.some(([a, b]) => x1b > a + 1e-3 && x < b - 1e-3)) { x = x1b + joint; continue; }
      const tp = Math.min(topAt(x + 0.02), topAt(x1b - 0.02), topAt((x + x1b) / 2));
      // A bonder is TALL, so it is also shortish — a two-course block a metre
      // and a half long is not something four men lift. It only goes in where
      // the wall is still two full courses high at that x.
      const tall = j + 1 < nCourse && x1b - x < course * 2.1 && r() < 0.145
        && tp >= y0 + course * 2 - joint - 1e-3;
      const yb = Math.min(tall ? y0 + 2 * course - joint : y1, tp);
      if (yb - y0 > course * 0.34 && !blocked(x, x1b, y0, yb)) {
        if (tall) nextTaken.push([x - joint, x1b + joint]);
        // how exposed this stone is: the two courses under a break lose stones
        // fast, because that is where the wall was actually failing
        const bare = clamp(1 - (tp - yb) / (course * 2.2), 0, 1);
        const sunk = r() < 0.012 + ruin * 0.06 + bare * ruin * 0.34;
        ashlarTone(t, r, tone);
        // Stain: the splash zone at the foot, and the run under every ledge.
        // A projecting band throws water clear of the wall, so what is under it
        // is wet for a week after every storm and what is above it is not.
        let s = clamp(1 - (y0 - base) / 1.7, 0, 1) * 0.55;
        for (const ly of ledges) {
          const d = ly - yb;
          if (d > 0 && d < 2.3) s = Math.max(s, (1 - d / 2.3) * (0.2 + r() * 0.8) * 0.7);
        }
        if (s > 0) for (let c = 0; c < 3; c++) tone[c] *= lerp(1, [0.78, 0.72, 0.64][c], s);
        if (sunk) for (let c = 0; c < 3; c++) tone[c] = 0.9 + r() * 0.16;
        /* How far the stone stands out of the wall plane, and the second
         * reason the old face read as tile: every stone sat 3-6.5 cm proud, so
         * the surface was DEAD FLAT with a grid scored into it. A wall that has
         * weathered for two thousand years is not flat — the hard beds stand
         * out, the soft ones have gone back into the wall, and the line of
         * light along the top of a course wanders in and out because of it.
         * The distribution is squared so most stones sit near flush and the
         * few that stand right out are the ones the eye picks up; one in eight
         * has eroded BACK behind the plane, which is what the mortar bed's
         * depth had to be made to follow. */
        const relief = sunk ? -(0.05 + r() * 0.06)
          : (r() < 0.12 ? -(0.008 + r() * 0.026) : 0.014 + r() * r() * 0.07);
        stone(x + joint * 0.5, x1b - joint * 0.5, y0, yb,
          tone, relief, r() < 0.17 ? Math.floor(r() * 4) : -1, sunk);
      }
      x = x1b + joint;
    }
    taken = nextTaken;
  }

  const build = (B) => {
    if (B.length < 33) return null;
    const nv = B.length / 11;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const o = i * 11;
      pos[i * 3] = B[o]; pos[i * 3 + 1] = B[o + 1]; pos[i * 3 + 2] = B[o + 2];
      nrm[i * 3] = B[o + 3]; nrm[i * 3 + 1] = B[o + 4]; nrm[i * 3 + 2] = B[o + 5];
      uv[i * 2] = B[o + 6]; uv[i * 2 + 1] = B[o + 7];
      col[i * 3] = B[o + 8]; col[i * 3 + 1] = B[o + 9]; col[i * 3 + 2] = B[o + 10];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  };
  return { face: build(bins[0]), socket: build(bins[1]) };
}

/**
 * Where a wall meets the ground.
 *
 * The single clearest tell that nothing in this level was designed: every
 * standing structure's lowest polygon sat exactly on y = 0, so a rectangular
 * slab appeared to have been dropped onto the sand rather than built up out
 * of it. Real architecture arrives at grade in three moves, and all three are
 * here because on rolling terrain any one of them alone still shows a seam
 * (the fourth, the sand banked against it, is sandDrift below):
 *
 *   buried course   0.7 m of masonry below grade. Nobody ever sees it, which
 *                   is exactly the point — the terrain can fall away by half a
 *                   metre and there is still wall down there.
 *   stylobate       two set-back steps. This is what gives the eye the base of
 *                   the building, and it is why a temple reads as heavier at
 *                   the bottom than at the top.
 *   damp course     a thin projecting drip band. Water leaves the wall here
 *                   instead of running on down it, so everything above it is
 *                   clean and everything below it is not: that band IS the
 *                   dark line at the foot of every old building.
 *
 * Returns the y the first ashlar course beds onto.
 */
function footing(kit, w, t, opts = {}) {
  const M = propMaterials();
  const trim = opts.trim || M.duracreteWarm;
  // The damp band defaults to the wall's own CORE material, not to a fifth
  // stone: it is a 5 cm strip, and a 5 cm strip is not worth a draw call on
  // every wall in a thirty-six bay ring.
  const band = opts.band || M.duracreteDark;
  /* MEASURED, on the shot this pass exists to fix: a stylobate cut in the same
   * duracreteWarm as the wall's dressings put a band 19% BRIGHTER than the
   * facing along the foot of every wall in the ring — a white skirting board,
   * which is the exact opposite of what a base is for. The two lower courses
   * therefore go in the darker core stone: the bottom of a building is the
   * part that is wet for a week after every storm and has had boots against
   * it for two thousand years, and it is supposed to weigh the wall down. Only
   * the top step keeps the pale dressing stone, so there is one lit nosing to
   * read the profile by. */
  kit.slab(band, w * 1.03, 0.70, t * 1.08, 0, -0.32, 0, { tile: ARCH_TILE, seg: 2, bevel: 0.05, collide: false });
  kit.slab(band, w * 1.09, 0.24, t * 1.36, 0, 0.12, 0, { tile: ARCH_TILE, seg: 3, bevel: 0.055, collide: false });
  kit.slab(trim, w * 1.04, 0.20, t * 1.17, 0, 0.34, 0, { tile: ARCH_TILE, seg: 3, bevel: 0.05, collide: false });
  kit.slab(band, w * 1.015, 0.055, t * 1.05, 0, 0.472, 0, { tile: TRIM_TILE, seg: 2, bevel: 0.02, collide: false });
  return 0.5;
}

/**
 * The sand that has banked against the windward face of anything standing
 * still in a desert.
 *
 * This is the other half of ground contact, and the half nothing in the file
 * was doing: a wall can have the finest stylobate ever cut and it still reads
 * as furniture if the desert stops dead at its edge. Sand does not stop; it
 * piles at its angle of repose — about 34°, so the toe of the drift is
 * roughly 1.5 heights out — and it buries the bottom course.
 *
 * Emitted as one triangle strip along the face: eleven columns, four triangles
 * each, forty triangles for a nine-metre wall.
 */
function sandDrift(kit, w, t, opts = {}) {
  const M = propMaterials();
  const mat = opts.mat || M.drift;
  const r = opts.rng || rng;
  const nz = opts.nz ?? 1;
  const H = opts.height ?? 0.8;
  const seed = opts.seed ?? 0;
  const n = Math.max(4, Math.min(16, Math.round(w / 0.95)));
  const k = uvm(ROCK_TILE);
  const P = [], U = [];
  const z0 = nz * (t * 0.5 + 0.02);
  const rows = [];
  for (let i = 0; i <= n; i++) {
    const x = lerp(-w * 0.54, w * 0.54, i / n);
    // low frequency along the wall, so the drift has dunes in it rather than
    // a constant fillet — a constant fillet reads as a moulding, not as sand
    const f = 0.5 + 0.5 * fbm2(x * 0.42 + seed * 1.7, seed * 0.9, 2);
    const end = Math.min(1, (1 - Math.abs(i / n - 0.5) * 2) * 3.2 + 0.16);
    /* The swing along the wall runs 0.06..1.00 of H, not 0.26..1.00, and the
     * reason is composition rather than geology.
     *
     * MEASURED off a close shot of the arena ring: a 1.3 m drift whose lowest
     * point was still 0.34 m had buried the entire stylobate — the buried
     * course, both steps and the damp band, all of it — under an unbroken
     * ribbon of sand, so the one thing the footing exists to show, that this
     * wall was BUILT up out of the ground, was hidden by the one thing meant
     * to bed it into the ground. A drift has to scour as well as pile. Down at
     * 6% the sand thins to nothing every few metres and the base course reads
     * through the gaps, which is what a wall standing in a desert looks like
     * and is also the only way both details survive in the same frame. */
    rows.push([x, H * (0.06 + 0.94 * f * f) * end, 0]);
  }
  /* Avalanche. A heap of sand cannot hold a step, and the crest line built
   * above has plenty: the end taper alone dropped from full height to 16% of
   * it between two columns 46 cm apart on a column's drift, which is a 52°
   * wall of sand standing unsupported. Two relaxation sweeps, forward and
   * back, clamping the rise between neighbours to dx·tan(34°) — which is
   * literally the settling a real pile does, and is why a drift's crest is a
   * long shallow curve and not a row of spikes. Doing it here rather than by
   * hand-tuning the taper means the repose angle holds for any width, any
   * column count and any height a caller asks for. */
  /* The clamp is NOT tan(34°), and that is the whole point.
   *
   * A face's steepest slope is the VECTOR SUM of its along-wall and its
   * cross-wall gradient, not whichever is larger. Clamping the crest line to
   * tan(34°) while the section independently sits just under 34° gives a
   * quad whose true gradient is sqrt(0.674² + 0.643²) = 0.93 — a 43° wall of
   * sand, built out of two separately correct clamps. Measured at 39° on a
   * column, which is where this was caught.
   *
   * So the crest gets only the headroom the section leaves it:
   * sqrt(tan²34° − cross²). With the toe reach below at 2.6 heights the
   * steepest section face is 1.286·h/r ≈ 0.495, leaving 0.45 for the crest —
   * about 24°, still ample to read as dunes rather than a fillet. */
  const step = (w * 1.08 / n) * 0.45;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i <= n; i++) rows[i][1] = Math.min(rows[i][1], rows[i - 1][1] + step);
    for (let i = n - 1; i >= 0; i--) rows[i][1] = Math.min(rows[i][1], rows[i + 1][1] + step);
  }
  // 2.6-3.4 heights of toe, up from 2.0-2.8, and measured off the SETTLED
  // height. See the section below: at the old reach the face above the slack
  // came out at 44°, and sand does not stand at 44° either.
  for (const row of rows) row[2] = row[1] * (2.6 + r() * 0.8) + 0.15;
  const push = (x, y, z, u, v) => { P.push(x, y, z); U.push(u, v); };
  for (let i = 0; i < n; i++) {
    const [xa, ha, ra] = rows[i], [xb, hb, rb] = rows[i + 1];
    /* Four-point section: crest against the wall, a slack, a long feather, and
     * a toe that runs 0.22 m BELOW grade — not 0.06, because the levels place
     * these on rolling terrain and a drift whose edge is a knife on the
     * nominal ground plane lifts clear of it the moment the ground drops two
     * centimetres. A straight ramp is a wedge; a drift is concave.
     *
     * The breakpoints exist to hold the ANGLE OF REPOSE. Dry sand stands at
     * about 34° and not one degree more — pile it steeper and it avalanches
     * until it is 34° again — and the old three-point section put the face
     * above the slack at 44°, which is a heap of gravel, not a drift. At these
     * fractions of a 2.0-2.8 height reach the three visible faces come out at
     * 31°, 26° and 22° on a metre-high bank: under repose everywhere, which is
     * also why the drift now reaches half again as far out from the wall as it
     * used to. The buried toe gets a fixed 28 cm of extra run so that a bank
     * only eight centimetres high still arrives at -0.22 down a 33° face
     * rather than falling off a cliff. */
    const secA = [[0, ha], [ra * 0.42, ha * 0.46], [ra * 0.80, ha * 0.06], [ra + 0.28, -0.22]];
    const secB = [[0, hb], [rb * 0.42, hb * 0.46], [rb * 0.80, hb * 0.06], [rb + 0.28, -0.22]];
    for (let s = 0; s < 3; s++) {
      const a0 = secA[s], a1 = secA[s + 1], b0 = secB[s], b1 = secB[s + 1];
      const va = [xa, a0[1], z0 + nz * a0[0]], vb = [xb, b0[1], z0 + nz * b0[0]];
      const vc = [xb, b1[1], z0 + nz * b1[0]], vd = [xa, a1[1], z0 + nz * a1[0]];
      // Wound so the normal comes out UP AND AWAY from the wall. Get this
      // backwards and the drift is back-facing — invisible, and invisible in a
      // way that still measures as geometry, which is the exact failure mode
      // this file's header warns about.
      for (const [p, q, o] of nz > 0 ? [[va, vd, vc], [va, vc, vb]] : [[va, vc, vd], [va, vb, vc]]) {
        push(p[0], p[1], p[2], p[0] * k, p[2] * k);
        push(q[0], q[1], q[2], q[0] * k, q[2] * k);
        push(o[0], o[1], o[2], o[0] * k, o[2] * k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(U), 2));
  g.computeVertexNormals();
  /* Undo the weathering model's up-face terms, which are written for masonry.
   *
   * WEAR.sky lightens and desaturates anything pointing at the sky, because a
   * flat ledge on a building collects dust and gets bleached. A sand bank does
   * not collect dust: it IS the dust, and it does not bleach because there is
   * nothing on it to bleach. But it is almost entirely up-facing, so it took
   * the term at full strength — MEASURED with weatherStats on a wall's own
   * drift, mean vertex colour 1.090, i.e. the one surface in the file that is
   * supposed to match the ground exactly was emitted 9% brighter than its own
   * albedo before a single photon was traced. Pre-dividing puts the emitted
   * mean back on 1.0, where the weathering check meters it and where the
   * material's stated albedo is actually what renders. */
  tintGeo(g, [1 / 1.090, 1 / 1.090, 1 / 1.090]);
  kit.put(g, mat, 0, 0, 0);
  return g;
}

/**
 * The stones a broken wall shed. A ruin with a clean floor at the foot of it
 * is the tell that nothing ever actually fell down: the masonry went
 * somewhere, and it went about a third of a wall-height out from the base,
 * biggest pieces nearest.
 */
function talus(kit, w, t, h, opts = {}) {
  const M = propMaterials();
  const r = opts.rng || rng;
  const mat = opts.mat || M.duracrete;
  const n = Math.min(15, Math.round(w * (opts.amount ?? 0.5) * 1.4));
  const geos = [];
  // own scratch: kit.put reaches for the shared kit matrices, and this runs
  // between building a piece and handing it over
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const sz = (0.24 + r() * 0.42) * (opts.scale ?? 1);
    // Icosahedral lumps are 80 triangles and tetrahedral ones are 4, so the
    // mix is what keeps a whole arena ring's worth of rubble affordable.
    const g = scaleUv(rubbleGeo(r() < 0.35 ? 1 : 2, Math.floor(r() * 9999)), sz);
    const nzs = r() < 0.5 ? 1 : -1;
    const out = t * 0.5 + 0.15 + r() * r() * h * 0.42;
    // bedded, not balanced: a fallen block sits about a third into the sand it
    // landed in, and a composed kit cannot ask the terrain where that is
    g.applyMatrix4(m.compose(
      p.set((r() - 0.5) * w * 1.06, sz * 0.18, nzs * out),
      q.setFromEuler(e.set((r() - 0.5) * 1.1, r() * TAU, (r() - 0.5) * 1.1)),
      s.set(sz * (0.85 + r() * 0.5), sz * (0.6 + r() * 0.5), sz * (0.85 + r() * 0.5))));
    geos.push(g);
  }
  const merged = mergeGeos(geos);
  if (merged) kit.put(merged, mat, 0, 0, 0);
  return merged;
}

/**
 * A tapered shaft with entasis (the classical swell — a straight taper reads
 * as a pipe), optional fluting, and an optional jagged top for a snapped
 * column. Returns { side, cap, rim } where rim is the top ring in local space.
 */
function shaftGeo(rBot, rTop, h, opts = {}) {
  const seg = opts.seg ?? 18, rings = opts.rings ?? 5;
  const flutes = opts.flutes ?? 0, fd = opts.fluteDepth ?? 0.07;
  const entasis = opts.entasis ?? 0.03;
  const jitter = opts.topJitter ?? 0;
  const r = opts.rng || rng;
  const k = uvm(opts.tile ?? 1.9);

  const jit = [];
  for (let i = 0; i < seg; i++) jit.push(jitter * (0.15 + r() * 0.85));
  for (let i = 0; i < seg; i++) jit[i] = (jit[i] * 2 + jit[(i + 1) % seg] + jit[(i + seg - 1) % seg]) * 0.25;
  jit.push(jit[0]);

  /* A column is not a pipe: it is a STACK OF DRUMS, and every joint between
   * two of them has been open to the weather for two thousand years. `drums`
   * nicks the radius in by 1.8% at each joint — enough to catch a shadow line
   * at ten metres, not enough to read as a corset. It costs nothing: the rings
   * are already there, this only moves them. */
  const drums = opts.drums ?? 0;
  const every = drums > 0 ? Math.max(2, Math.round(rings / drums)) : 0;

  const nv = (rings + 1) * (seg + 1);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const rim = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    let rr = lerp(rBot, rTop, t) * (1 + entasis * Math.sin(t * Math.PI));
    if (every && j > 0 && j < rings && j % every === 0) rr *= 0.982;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const f = flutes ? (1 - fd * (0.5 - 0.5 * Math.cos(a * flutes))) : 1;
      const y = t * h - (j === rings ? jit[i] : 0);
      const o = (j * (seg + 1) + i) * 3;
      pos[o] = Math.cos(a) * rr * f; pos[o + 1] = y; pos[o + 2] = Math.sin(a) * rr * f;
      const o2 = (j * (seg + 1) + i) * 2;
      uv[o2] = (i / seg) * TAU * rBot * k; uv[o2 + 1] = y * k;
      if (j === rings && i < seg) rim.push(new THREE.Vector3(pos[o], y, pos[o + 2]));
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { side: g, rim, drop: jitter };
}

/**
 * A column: stepped plinth, torus base, fluted shaft with entasis, and a
 * necking-echinus-abacus capital with corner volutes. Sizes S (4 m, one
 * course), M (6 m), L (8 m), XL (12 m), or pass height/radius.
 *
 * `standing < 1` snaps it off at that fraction of its height and leaves a
 * broken crown with reinforcement bursting out of it — which is the version a
 * ruin actually wants three of for every intact one.
 */
export function addColumn(world, pos, opts = {}) {
  assertOpts(addColumn, opts);
  const kit = kitOpen(pos, opts, 21);
  const M = propMaterials();
  const S = ARCH.column[opts.size || 'M'] || ARCH.column.M;
  const h = opts.height ?? S.h;
  const r = opts.radius ?? S.r;
  const mat = opts.mat || M.duracreteWarm;
  const trim = opts.trimMat || M.sandstone;
  const core = opts.coreMat || M.duracreteDark;
  const rr = kit.rng;
  const standing = clamp(opts.standing ?? 1, 0.12, 1);
  const broken = standing < 0.999;

  // Stepped plinth — and, under it, the part nobody sees. A column standing
  // with its lowest polygon exactly on grade shows daylight under one edge the
  // moment the ground rolls, and it is the reason a colonnade reads as pins
  // pushed into sand rather than as stone set into it.
  const pw = r * 2.9, ph = r * 0.34;
  if (opts.footing !== false) {
    kit.slab(trim, pw * 1.04, 0.62, pw * 1.04, 0, -0.28, 0, { tile: ARCH_TILE, seg: 2, bevel: 0.05, collide: false });
  }
  kit.slab(trim, pw, ph, pw, 0, ph / 2, 0, { tile: 2.2, collide: false });
  kit.slab(trim, pw * 0.86, ph * 0.8, pw * 0.86, 0, ph * 1.4, 0, { tile: 2.2, collide: false });
  const y0 = ph * 1.8;
  // and the sand that has drifted round it. Four short runs rather than a
  // revolved skirt: a perfect cone of sand round a column is a lampshade.
  if (opts.drift !== false) {
    for (let i = 0; i < 4; i++) {
      kit.push(0, 0, 0, i * Math.PI / 2);
      // 2.6-4.4 plinth-steps of peak, which after sandDrift's squared profile
      // means a mean of about a third of that: two faces of the plinth banked
      // over and two scoured back to the stone, rather than a even skirt all
      // the way round, which is a lampshade by another route
      sandDrift(kit, pw * 1.15, pw, {
        rng: rr, nz: 1, height: ph * (2.6 + rr() * 1.8) * (opts.drift ?? 1),
        seed: (opts.seed ?? 21) + i * 3.7,
      });
      kit.pop();
    }
  }
  // torus base moulding
  const base = torusGeo(r * 1.02, r * 0.2, 6, 16, TAU, 1.0);
  base.rotateX(Math.PI / 2);
  kit.put(base, trim, 0, y0 + r * 0.14, 0);

  const capH = broken ? 0 : r * 1.5;
  const shaftH = Math.max(0.4, h * standing - y0 - capH);
  // one drum per 1.5 m of shaft — about the biggest lump two people and a
  // sheer-legs can set, which is why real drums are that tall
  const nDrum = clamp(Math.round(shaftH / 1.5), 1, 8);
  const sh = shaftGeo(r, r * (broken ? lerp(1, 0.86, standing) : 0.84), shaftH, {
    seg: opts.seg ?? 18, rings: Math.max(broken ? 4 : 5, nDrum * 2), drums: nDrum,
    flutes: opts.flutes ?? (rr() < 0.5 ? 16 : 0),
    entasis: 0.03, topJitter: broken ? r * 0.9 : 0, rng: rr, tile: 1.9,
  });
  /* Every drum came off a different bed, so every drum is a different colour.
   *
   * The joint nick in shaftGeo gives the shaft its horizontal shadow lines and
   * nothing else, so a colonnade still came out as painted pipes: one flat
   * tone from base to capital on a piece four metres tall, which is the exact
   * complaint the ashlar facing exists to answer, unanswered on the one
   * element of the arena the player walks between. Painting the quarry tone in
   * by drum costs a colour attribute the material already reads and no
   * triangles at all; weatherGeo multiplies its dirt runs INTO this rather
   * than over it, so the two compose. The tone stream is its own, for the same
   * reason addArch's is: a colour must not move a layout. */
  {
    const tr = makeRng((opts.seed ?? 21) * 37 + 11);
    const dh = shaftH / nDrum, ton = [1, 1, 1];
    const tones = [];
    for (let i = 0; i < nDrum; i++) tones.push(ashlarTone(i / Math.max(1, nDrum - 1), tr, ton).slice());
    paintGeo(sh.side, (x, y, z, out) => {
      const c = tones[clamp(Math.floor(y / dh), 0, nDrum - 1)];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
  }
  kit.put(sh.side, mat, 0, y0, 0);
  if (broken) {
    const rimPts = sh.rim.map((p) => p.clone().setY(p.y + y0));
    kit.put(fanCap(rimPts, y0 + shaftH - sh.drop * 1.1, true, 1.2), core);
    // reinforcement bursting out of the break
    const nBar = 3 + Math.floor(rr() * 4);
    for (let i = 0; i < nBar; i++) {
      const a = rr() * TAU, rad = r * (0.25 + rr() * 0.55);
      const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
      const top = y0 + shaftH + r * (0.5 + rr() * 1.4);
      const pts = [
        new THREE.Vector3(bx, y0 + shaftH - r * 0.6, bz),
        new THREE.Vector3(bx * 1.2, lerp(y0 + shaftH, top, 0.5), bz * 1.2),
        new THREE.Vector3(bx * (1.4 + rr()), top, bz * (1.4 + rr())),
      ];
      kit.put(tubeAlong(pts, 0.022, 4, FINE_TILE), M.rebar);
    }
  } else {
    // capital: necking, echinus, abacus
    const nk = cylGeo(r * 0.92, r * 0.84, r * 0.22, 16, 1.2);
    kit.put(nk, trim, 0, y0 + shaftH + r * 0.11, 0);
    const ech = new THREE.LatheGeometry([
      new THREE.Vector2(r * 0.9, 0), new THREE.Vector2(r * 1.12, r * 0.3),
      new THREE.Vector2(r * 1.3, r * 0.62), new THREE.Vector2(r * 1.34, r * 0.78),
    ], 16);
    tubeUv(ech, TAU * r * 1.2, r * 0.78, 1.3);
    kit.put(ech, trim, 0, y0 + shaftH + r * 0.22, 0);
    kit.slab(trim, r * 2.8, r * 0.4, r * 2.8, 0, y0 + shaftH + r * 1.2, 0, { tile: 2.0, collide: false });
    if (opts.volutes !== false && r > 0.35) {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const v = torusGeo(r * 0.34, r * 0.11, 5, 10, Math.PI * 1.6, 1.0);
        kit.put(v, trim, Math.cos(a) * r * 1.05, y0 + shaftH + r * 0.72, Math.sin(a) * r * 1.05, 0, -a, 0);
      }
    }
  }
  kit.collider(0, (y0 + shaftH) / 2, 0, r * 1.06, (y0 + shaftH) / 2, r * 1.06);
  return kitClose(world, kit, pos, opts, 'stone');
}

/**
 * A semicircular (or segmental) voussoir arch on two piers. `span` is the
 * clear opening, `springing` where the curve starts, `broken` drops that
 * fraction of the ring from one side. Standard spans: 3, 5, 8 m.
 */
export function addArch(world, pos, opts = {}) {
  assertOpts(addArch, opts);
  const kit = kitOpen(pos, opts, 33);
  const M = propMaterials();
  const span = opts.span ?? 5;
  const spring = opts.springing ?? span * 0.62;
  const t = opts.thickness ?? Math.max(0.36, span * 0.13);
  const d = opts.depth ?? Math.max(0.5, span * 0.16);
  const n = opts.voussoirs ?? (Math.round(span * 1.8) | 1);
  const rIn = span / 2, rOut = rIn + t;
  const yScale = (opts.rise ?? rIn) / rIn;
  const mat = opts.mat || M.duracreteWarm;
  const trim = opts.trimMat || M.sandstone;
  const rr = kit.rng;
  const missing = Math.round(n * clamp(opts.broken ?? 0, 0, 0.55));
  /* Quarry tones draw from their OWN stream, exactly as weathering does: this
   * maker's shape decisions come off kit.rng, and a colour that pulled from
   * the same stream would move every voussoir and every wing in every level
   * the day somebody adds one more tone to the table. */
  const tr = makeRng((opts.seed ?? 33) * 31 + 7);
  const ton = [1, 1, 1];

  const arcPt = (a, rad) => [Math.cos(a) * rad, Math.sin(a) * rad * yScale];
  for (let i = 0; i < n; i++) {
    if (i < missing) continue;                       // that side has come down
    const a0 = (i / n) * Math.PI, a1 = ((i + 1) / n) * Math.PI;
    const key = Math.abs(i - (n - 1) / 2) < 0.5;
    const ro = rOut + (key ? t * 0.22 : 0);
    const pts = [];
    for (let s = 0; s <= 3; s++) pts.push(arcPt(lerp(a0, a1, s / 3), rIn));
    for (let s = 3; s >= 0; s--) pts.push(arcPt(lerp(a0, a1, s / 3), ro));
    const g = extrudeBeveled(pts, d * (key ? 1.06 : 1), { bevel: Math.min(0.045, d * 0.14), tile: 2.2 });
    /* A voussoir IS a stone, so it takes a stone's tone. Left untinted beside
     * a wall that has been faced in ashlar the ring came out flat grey against
     * warm masonry — measured on the arena gate, 0.30 chroma against the
     * facing's 0.51 — which reads as an arch cast in concrete and dropped next
     * to a stone wall. The high tones sit at the crown where the sun gets at
     * it and the dark ones near the springing. */
    kit.put(tintGeo(g, ashlarTone(0.35 + Math.sin((i + 0.5) / n * Math.PI) * 0.6, tr, ton)),
      key ? trim : mat, 0, spring, 0);
  }
  if (missing > 0) {                                  // a stub where the ring tore
    const a = (missing / n) * Math.PI;
    const pts = [arcPt(a, rIn), arcPt(a + 0.14, rIn * 1.02), arcPt(a + 0.05, rOut * 0.96), arcPt(a, rOut)];
    kit.put(extrudeBeveled(pts, d * 0.96, { bevel: 0.03, tile: 1.6 }), M.duracreteDark, 0, spring, 0);
  }

  if (opts.piers !== false) {
    for (const sx of [-1, 1]) {
      const x = sx * (rIn + t / 2);
      kit.slab(mat, t, spring, d, x, spring / 2, 0, { tile: 2.4, seg: 3, collide: false });
      // and the pier is coursed masonry too, on both faces the gate is seen
      // from — a plain slab under a stone ring is where the eye goes first
      if (opts.ashlar !== false) {
        kit.push(x, 0, 0, 0);
        for (const nz of [1, -1]) {
          const { face: fg, socket: sg } = ashlarFace(t, {
            rng: tr, course: spring / Math.max(3, Math.round(spring / 0.72)),
            base: 0.16, height: spring - 0.16, ruin: 0.12,
            z: nz * (d * 0.5 + 0.02), nz, tile: ARCH_TILE,
            topAt: () => spring - 0.14,
          });
          if (fg) kit.put(fg, mat, 0, 0, 0);
          if (sg) kit.put(sg, M.duracreteDark, 0, 0, 0);
        }
        kit.pop();
      }
      kit.slab(trim, t * 1.34, 0.22, d * 1.2, x, spring - 0.11, 0, { tile: 1.8, collide: false });   // impost
      kit.slab(trim, t * 1.4, 0.3, d * 1.28, x, 0.15, 0, { tile: 1.8, collide: false });             // footing
      // the pier goes into the ground, and sand banks against it
      kit.slab(trim, t * 1.3, 0.66, d * 1.2, x, -0.3, 0, { tile: ARCH_TILE, seg: 2, bevel: 0.05, collide: false });
      kit.collider(x, spring / 2, 0, t / 2 + 0.02, spring / 2, d / 2);
      if (opts.drift !== false) {
        // MEASURED the hard way: sandDrift builds about its own origin, and
        // without this frame both piers' drifts landed at x = 0 — a bank of
        // sand hanging in the middle of the gateway, in mid-air, which is
        // precisely the kind of geometry-inside-geometry this file keeps
        // being bitten by. The wall and the column wrap theirs; this did not.
        kit.push(x, 0, 0, 0);
        for (const nz of [1, -1]) {
          sandDrift(kit, t * 1.5, d, { rng: rr, nz, height: 0.6 * (opts.drift ?? 1), seed: (opts.seed ?? 33) + sx * 5 });
        }
        kit.pop();
      }
    }

    /* ── what the arch belongs to ─────────────────────────────────────
     * An arch standing alone in a field is a folly. An arch is a HOLE, and a
     * hole is only a hole if there is something round it — so unless the
     * caller has already given it something (addRuinedGate has its pylons),
     * each pier grows a torn-off return of the wall the arch was cut through.
     * Short and broken, so it reads as the surviving haunch of a wall rather
     * than as more building; it also gives the gateway a genuine reveal, which
     * is what makes a gateway look thick enough to walk through. */
    if (opts.wings !== false) {
      const wl = opts.wingLength ?? span * 0.34;
      for (const sx of [-1, 1]) {
        addBrokenWall(world, new THREE.Vector3(sx * (rIn + t + wl / 2), 0, 0),
          new THREE.Vector3(wl, spring * (0.72 + rr() * 0.2), d * 0.92), {
            kit, seed: (opts.seed ?? 33) * 3 + 17 + sx, mat, trimMat: trim,
            // the caller's own broken-face colour if it has one: a wing is a
            // torn-off piece of the wall the arch was cut through, so it shows
            // the same core as the wall does
            coreMat: opts.coreMat || M.duracreteDark,
            ruin: 0.62 + rr() * 0.2, course: opts.course, stringCourse: false,
          });
      }
    }
  }
  if (opts.collideArch !== false && missing === 0) {
    kit.collider(0, spring + rIn * yScale * 0.72, 0, rIn * 0.9, t * 0.7, d / 2);
  }
  return kitClose(world, kit, pos, opts, 'stone');
}

/**
 * A lintel or architrave spanning `length`, with corbel brackets under each
 * end and a chamfered soffit. Sits at `y` = its own mid-height.
 */
export function addLintel(world, pos, opts = {}) {
  assertOpts(addLintel, opts);
  const kit = kitOpen(pos, opts, 44);
  const M = propMaterials();
  const L = opts.length ?? 6, h = opts.height ?? 0.62, d = opts.depth ?? 0.72;
  const mat = opts.mat || M.duracreteWarm;
  const trim = opts.trimMat || M.sandstone;
  const beam = extrudeBeveled([
    [-L / 2, -h / 2], [L / 2, -h / 2], [L / 2, h / 2], [-L / 2, h / 2],
  ], d, { bevel: 0.05, tile: 2.6 });
  kit.put(beam, mat, 0, 0, 0);
  kit.slab(trim, L * 1.02, h * 0.24, d * 1.14, 0, h / 2 + h * 0.12, 0, { tile: 2.2, collide: false });
  if (opts.corbels !== false) {
    for (const sx of [-1, 1]) {
      const c = extrudeBeveled([
        [0, 0], [h * 1.1, 0], [h * 1.1, -h * 0.5], [h * 0.35, -h * 0.95], [0, -h * 0.95],
      ], d * 0.8, { bevel: 0.035, tile: 1.8 });
      kit.put(c, trim, sx * (L / 2 - h * 1.1), -h / 2, 0, 0, sx > 0 ? 0 : Math.PI, 0);
    }
  }
  kit.collider(0, 0, 0, L / 2, h / 2, d / 2);
  return kitClose(world, kit, pos, opts, 'stone');
}

/**
 * A buttress leaning against a wall: a battered mass that steps back twice on
 * its way up, with a weathering slope on each set-off. Sizes: 3 m (a pier),
 * 5 m (one course of wall), 9 m (two).
 */
export function addButtress(world, pos, opts = {}) {
  assertOpts(addButtress, opts);
  const kit = kitOpen(pos, opts, 55);
  const M = propMaterials();
  const h = opts.height ?? 5, t = opts.depth ?? 1.5, w = opts.width ?? 1.2;
  const mat = opts.mat || M.duracreteWarm;
  const g = extrudeBeveled([
    [0, 0], [t, 0], [t * 0.72, h * 0.42], [t * 0.5, h * 0.46],
    [t * 0.42, h * 0.78], [t * 0.26, h * 0.82], [t * 0.22, h], [0, h],
  ], w, { bevel: 0.05, tile: 2.4 });
  kit.put(g, mat, 0, 0, 0);
  kit.slab(opts.trimMat || M.sandstone, t * 1.1, 0.26, w * 1.15, t * 0.55, 0.13, 0, { tile: 2.0, collide: false });
  kit.collider(t * 0.38, h * 0.34, 0, t * 0.42, h * 0.34, w / 2);
  return kitClose(world, kit, pos, opts, 'stone');
}

/**
 * A wall that has been broken rather than built: two faces with different
 * jagged tops, a darker core showing between them, rebar out of the break and
 * optional door/window openings. size = (length, full height, thickness).
 */
export function addBrokenWall(world, pos, size, opts = {}) {
  assertOpts(addBrokenWall, opts);
  const kit = kitOpen(pos, opts, 66);
  const M = propMaterials();
  const w = size.x, h = size.y, t = size.z;
  const rr = kit.rng;
  const face = opts.mat || M.duracrete;
  const core = opts.coreMat || M.duracreteDark;
  const ruin = clamp(opts.ruin ?? 0.5, 0, 1);        // 0 = intact top, 1 = mostly gone
  const lowest = h * lerp(0.95, 0.28, ruin);

  const openings = opts.openings || [];
  const holesFor = (topPts) => {
    const holes = [];
    for (const o of openings) {
      const ow = o.w ?? 1.2, oh = o.h ?? 2.2, ox = o.x ?? 0, oy = o.y ?? 0;
      if (oy + oh > lowest * 0.96) continue;         // the break already ate it
      const p = [];
      p.push(new THREE.Vector2(ox - ow / 2, oy), new THREE.Vector2(ox + ow / 2, oy));
      if (o.arched) {
        for (let s = 0; s <= 6; s++) {
          const a = (s / 6) * Math.PI;
          p.push(new THREE.Vector2(ox + Math.cos(a) * ow / 2, oy + oh - ow / 2 + Math.sin(a) * ow / 2));
        }
      } else {
        p.push(new THREE.Vector2(ox + ow / 2, oy + oh), new THREE.Vector2(ox - ow / 2, oy + oh));
      }
      holes.push(new THREE.Path(p));
    }
    return holes;
  };

  const panel = (depth, zOff, top, mat, tile, hidden = false) => {
    const pts = [new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0)];
    for (const [x, y] of top) pts.push(new THREE.Vector2(x, y));
    const shape = new THREE.Shape(pts);
    shape.holes = holesFor(top);
    const b = Math.min(0.05, depth * 0.35);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.01, depth - b * 2), bevelEnabled: true, bevelThickness: b,
      bevelSize: b, bevelOffset: 0, bevelSegments: 1, steps: 1, curveSegments: 4,
    });
    g.translate(0, 0, zOff - (depth / 2 - b));
    scaleUv(g, uvm(tile));
    g.computeVertexNormals();
    /* Once a face is covered in ashlar the panel behind it is BACKING: nothing
     * but its edges is ever seen. Weathering it means tessellating a 9 x 8 m
     * polygon down to 1.15 m cells to paint dirt runs on a surface that is
     * two centimetres behind a hundred stones — measured, 1.4k triangles per
     * wall, 45k across the arena's ring, all of it invisible. */
    const was = kit.weather;
    if (hidden) kit.weather = false;
    kit.put(g, mat, 0, 0, 0);
    kit.weather = was;
  };

  /* ── the courses ──────────────────────────────────────────────────────
   * Everything about this wall is decided by its bed height, because that is
   * how a real one is decided. The stone comes out of the quarry in a bed of a
   * given thickness, the wall is laid in courses of that thickness, and when
   * it falls down it falls down ALONG those courses. So the course is picked
   * first, the broken tops snap to it, and the facing lands in register with
   * the silhouette instead of fighting it. 0.68 m is a big building stone —
   * about what a two-man block weighs out of soft sandstone. */
  const bed = clamp(opts.course ?? 0.68, 0.3, Math.max(0.3, h * 0.34));
  // A 0.5 m stylobate under a 0.9 m parapet is a plinth with a lid on it, so
  // anything under about a metre and a half is built straight off the ground.
  const y0 = opts.footing === false || h < 1.6 ? 0
    : footing(kit, w, t, { trim: opts.trimMat || M.duracreteWarm, band: opts.bandMat || core });
  const nCourse = Math.max(1, Math.round((h - y0) / bed));
  const course = Math.max(0.25, (h - y0) / nCourse);
  const snap = { y0, h: course };

  const tA = brokenEdge(w / 2, -w / 2, lowest, h, rr, Math.max(4, Math.round(w / 1.6)), snap);
  const tB = brokenEdge(w / 2, -w / 2, lowest * 0.94, h * 0.98, rr, Math.max(4, Math.round(w / 1.6)), snap);
  const tC = brokenEdge(w / 2, -w / 2, lowest * 1.02, h * 0.9, rr, Math.max(3, Math.round(w / 2.2)), snap);
  const faced = opts.ashlar !== false;
  panel(t * 0.3, t * 0.35, tA, face, 2.4, faced);
  panel(t * 0.42, 0, tC, core, 2.0);
  panel(t * 0.3, -t * 0.35, tB, face, 2.4, faced);

  /* ── the facing ───────────────────────────────────────────────────────
   * The three panels above are the wall's MASS and its silhouette. They are
   * not its surface: an extruded polygon has one albedo and reads at any
   * distance as one flat card, which is exactly what the arena's ring did.
   * ashlarFace lays real stones over both outward faces — 2.33:1 in tone
   * block to block, chamfered so each course catches its own light, chipped,
   * and with the odd stone missing to a socket in the darker core. */
  const ledges = [];
  if (opts.stringCourse !== false && h - y0 > 3.4 && ruin < 0.66) {
    // A drip mould two thirds of the way up. Every horizontal projection on a
    // building throws water clear of the wall, and every one of them therefore
    // has a stain under it — which the facing below reads off `ledges`.
    const ly = y0 + course * Math.max(2, Math.round(nCourse * 0.62));
    if (ly < lowest * 0.92) {
      kit.slab(opts.trimMat || M.duracreteWarm, w * 1.005, 0.16, t * 1.14, 0, ly + 0.08, 0,
        { tile: TRIM_TILE, seg: 3, bevel: 0.035, collide: false });
      ledges.push(ly);
    }
  }
  if (opts.ashlar !== false) {
    for (const [top, nz] of [[tA, 1], [tB, -1]]) {
      const { face: fg, socket: sg } = ashlarFace(w, {
        rng: rr, course, base: y0, height: h - y0, ruin, ledges, openings,
        // 2 cm proud of the panel, so the mortar bed has somewhere to be
        z: nz * (t * 0.5 + 0.02), nz, topAt: edgeSampler(top), tile: ARCH_TILE,
      });
      if (fg) kit.put(fg, face, 0, 0, 0);
      if (sg) kit.put(sg, core, 0, 0, 0);
    }
  }

  /* ── openings are HOLES IN A WALL, not holes in a sheet ────────────────
   * The three panels above cut every opening straight through with a 5 cm
   * bevel, so a 1.4 m doorway in a 62 cm wall had no jamb, no sill and no head
   * — the wall read as card with rectangles punched out of it, which is the
   * single most cardboard thing in the arch shot. Real masonry dresses an
   * opening: the jambs are a different stone from the field, the sill throws
   * water clear of the wall below, and the head is either a lintel or a
   * relieving arch. Six small merged pieces per opening, no draw calls. */
  if (opts.dressings !== false) {
    const dressMat = opts.trimMat || M.duracreteWarm;
    for (const o of openings) {
      const ow = o.w ?? 1.2, oh = o.h ?? 2.2, ox = o.x ?? 0, oy = o.y ?? 0;
      if (oy + oh > lowest * 0.96) continue;            // the break already ate it
      const jw = clamp(ow * 0.13, 0.1, 0.24);
      const headY = oy + oh - (o.arched ? ow / 2 : 0);
      for (const sx of [-1, 1]) {                       // jambs, proud of the face
        kit.slab(dressMat, jw, headY - oy, t * 1.06, ox + sx * (ow / 2 + jw / 2 - 0.01),
          oy + (headY - oy) / 2, 0, { tile: TRIM_TILE, seg: 3, bevel: 0.035, collide: false });
      }
      if (o.arched) {                                   // voussoirs over the head
        const nV = Math.max(5, Math.round(ow * 3) | 1);
        for (let i = 0; i < nV; i++) {
          const a0 = (i / nV) * Math.PI, a1 = ((i + 1) / nV) * Math.PI;
          const rI = ow / 2, rO = ow / 2 + jw * 1.5;
          const pts = [];
          for (let s = 0; s <= 2; s++) { const a = lerp(a0, a1, s / 2); pts.push([Math.cos(a) * rI, Math.sin(a) * rI]); }
          for (let s = 2; s >= 0; s--) { const a = lerp(a0, a1, s / 2); pts.push([Math.cos(a) * rO, Math.sin(a) * rO]); }
          kit.put(extrudeBeveled(pts, t * 1.04, { bevel: 0.03, tile: TRIM_TILE }), dressMat, ox, headY, 0);
        }
      } else {                                          // a lintel over the head
        kit.slab(dressMat, ow + jw * 2.6, jw * 1.7, t * 1.1, ox, headY + jw * 0.85, 0,
          { tile: TRIM_TILE, seg: 3, bevel: 0.035, collide: false });
      }
      if (oy > 0.35) {                                  // a window sill, throated
        kit.slab(dressMat, ow + jw * 2.2, 0.13, t * 1.24, ox, oy - 0.05, 0,
          { tile: TRIM_TILE, seg: 3, bevel: 0.03, rx: 0.05, collide: false });
      }
    }
  }

  // rebar out of the top of the core
  const nBar = Math.round(clamp(w * 0.5, 2, 9) * ruin);
  for (let i = 0; i < nBar; i++) {
    const x = (rr() - 0.5) * w * 0.9;
    let y = lowest;
    for (const [tx, ty] of tC) if (Math.abs(tx - x) < w / 6) y = Math.min(y, ty);
    const z = (rr() - 0.5) * t * 0.4;
    const up = 0.3 + rr() * 0.8;
    kit.put(tubeAlong([
      new THREE.Vector3(x, y - 0.35, z),
      new THREE.Vector3(x + (rr() - 0.5) * 0.2, y + up * 0.6, z + (rr() - 0.5) * 0.2),
      new THREE.Vector3(x + (rr() - 0.5) * 0.9, y + up, z + (rr() - 0.5) * 0.7),
    ], 0.021, 4, FINE_TILE), M.rebar);
  }
  /* ── the ground ───────────────────────────────────────────────────────
   * A stylobate is only half of meeting the desert. Sand piles against a
   * windward face and buries the bottom course; the leeward face gets an eddy
   * drift about half the size. Both are always emitted, because a wall with
   * sand banked on one side and a knife-edge on the other reads as a bug from
   * every angle but the one it was authored from. */
  if (opts.drift !== false) {
    const dr = opts.drift ?? 1;
    const lee = rr() < 0.5 ? 1 : -1;
    // 1.3 m windward. Measured off the first shot with a drift on it: at 0.9 m
    // against an 8.4 m wall the bank was four pixels tall at fifty metres and
    // read as a kerb. A drift that does not bury the bottom COURSE is not a
    // drift, it is a fillet.
    sandDrift(kit, w, t, { rng: rr, nz: lee, height: Math.min(h * 0.3, 1.3) * dr, seed: (opts.seed ?? 66) * 0.37, mat: opts.driftMat });
    sandDrift(kit, w, t, { rng: rr, nz: -lee, height: Math.min(h * 0.18, 0.72) * dr, seed: (opts.seed ?? 66) * 0.91 + 4, mat: opts.driftMat });
  }
  // and what came off it when it broke
  if (opts.talus !== false && ruin > 0.22) {
    talus(kit, w, t, h, { rng: rr, mat: face, amount: ruin });
  }

  /**
   * THE COLLIDER, AND THE DOORWAYS IN IT.
   *
   * This used to be one unbroken run of boxes across the full length of the
   * wall, openings and all — so every doorway this maker cuts was a hole you
   * could see through and could not walk through. The temple's aisles, the
   * ruins on the meadow and the works' own blast-door recesses were all drawn
   * with a way through and built without one, and a droid steering straight at
   * a player on the far side of a 3.6 m doorway ground into the gap for as long
   * as you let it.
   *
   * Only a doorway cuts the run: an opening whose sill is off the floor is a
   * WINDOW, and a window in a wall is still a wall to anything walking. The
   * lintel over a doorway keeps no collider, which is the ordinary trade — the
   * only body that could reach it is one already standing in the opening.
   */
  const solid = lowest * 0.9;
  const gaps = [];
  for (const o of openings) {
    const ow = o.w ?? 1.2, oh = o.h ?? 2.2, ox = o.x ?? 0, oy = o.y ?? 0;
    if (oy > 0.6) continue;                          // a window, not a doorway
    if (oy + oh > lowest * 0.96) continue;           // the break already ate it
    gaps.push([ox - ow / 2, ox + ow / 2]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const spans = [];
  let cursor = -w / 2;
  for (const [g0, g1] of gaps) {
    if (g0 > cursor) spans.push([cursor, Math.min(g0, w / 2)]);
    cursor = Math.max(cursor, g1);
  }
  if (cursor < w / 2) spans.push([cursor, w / 2]);
  for (const [s0, s1] of spans) {
    const len = s1 - s0;
    if (len < 0.05) continue;
    const nc = Math.max(1, Math.round(len / 6));
    const cw = len / nc;
    for (let i = 0; i < nc; i++) {
      kit.collider(s0 + cw * (i + 0.5), solid / 2, 0, cw / 2, solid / 2, t / 2);
    }
  }
  return kitClose(world, kit, pos, opts, 'duracrete');
}

/**
 * A staircase. `steps` × (rise, run) from the ARCH table by default, with
 * nosed treads, two stringers and an optional balustrade. The collider is one
 * ramp rather than a stack of boxes, so walking up it is smooth.
 */
export function addStair(world, pos, opts = {}) {
  assertOpts(addStair, opts);
  const kit = kitOpen(pos, opts, 77);
  const M = propMaterials();
  const steps = opts.steps ?? 8;
  const rise = opts.rise ?? ARCH.step.rise, run = opts.run ?? ARCH.step.run;
  const w = opts.width ?? 3;
  const mat = opts.mat || M.duracreteWarm;
  const trim = opts.trimMat || M.sandstone;
  const H = steps * rise, D = steps * run;
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * rise, z = -D / 2 + (i + 0.5) * run;
    kit.slab(mat, w, rise, run * 1.06, 0, y - rise / 2, z, { bevel: 0.022, seg: 3, tile: 1.4, collide: false });
    // nosing catches the light along the front edge of every tread
    kit.slab(trim, w, rise * 0.24, run * 0.16, 0, y - rise * 0.14, z - run * 0.52, { bevel: 0.012, seg: 3, tile: 1.0, collide: false });
  }
  for (const sx of [-1, 1]) {
    const g = extrudeBeveled([
      [-D / 2, 0], [D / 2, 0], [D / 2, H], [D / 2 - run, H], [D / 2 - run, H - rise],
      [-D / 2 + run * 0.5, rise * 0.5],
    ], 0.26, { bevel: 0.03, tile: 2.0 });
    g.rotateY(Math.PI / 2);
    kit.put(g, trim, sx * (w / 2 + 0.1), 0, 0);
  }
  if (opts.railing) {
    for (const sx of [-1, 1]) {
      addRailing(world, new THREE.Vector3(sx * (w / 2 + 0.1), 0, 0), {
        kit, length: Math.hypot(D, H), height: 1.05, posts: steps > 5 ? 5 : 3,
        pitch: Math.atan2(H, D), yaw: Math.PI / 2,
      });
    }
  }
  // one ramp instead of a stack of boxes: walking up a staircase of colliders
  // is a sequence of small collisions, and it feels like one
  const slope = Math.atan2(H, D);
  kit.colliderQ(0, H / 2 - 0.14, 0, w / 2, 0.14, Math.hypot(D, H) / 2,
    _kq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slope), 0.85);
  return kitClose(world, kit, pos, opts);
}

/**
 * Posts, a top rail and a mid rail. `pitch` rakes it to follow a stair.
 * Lengths 2-24 m; one post every 1.4 m unless you say otherwise.
 */
export function addRailing(world, pos, opts = {}) {
  assertOpts(addRailing, opts);
  const kit = kitOpen(pos, opts, 88);
  const M = propMaterials();
  const L = opts.length ?? 4, h = opts.height ?? 1.05;
  const posts = opts.posts ?? Math.max(2, Math.round(L / 1.4));
  const mat = opts.mat || M.darkSteel;
  const pitch = opts.pitch ?? 0;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  /**
   * EVERY POST STANDS ON THE GROUND UNDER IT — and until this line the whole
   * run stood on ONE terrain sample, the one the level happened to take.
   *
   * The Providence's bridge rail is what found it: `addRailing(world,
   * at(-26, -40), { length: 52, yaw: π/2 })` took the deck height at one point
   * and ran 52 m of rail off it. Measured along its own line, 17 of 27 samples
   * had the deck ABOVE the rail's top and 8 had it more than 0.3 m below the
   * rail's foot, up to 2.0 m of daylight — 63% of the run buried, 30% in the
   * air — because the line crosses the bridge ramp (5.4 m over 26 m) and a
   * 9.0 m bulkhead pier. And the collider is one box at that same y, so the
   * barrier was a wall standing where no rail is drawn and no barrier at all
   * where the rail is. `prop-seating` could not see any of it: its seat is a
   * single `max` over the footprint and its float bound is one-sided, so a run
   * 3.55 m inside a pier reads as seated.
   *
   * So the run is sampled per post — the posts and the rails between them
   * follow the terrain, and the collider is one box PER BAY rather than one
   * for the whole run, each spanning its own two feet. A rail is still a
   * barrier and not a row of bollards (that argument is below and unchanged);
   * what changes is that the barrier is where the rail is.
   *
   * Three cases keep the flat run they had. A rail composed into another kit
   * (`opts.kit` — the stair's, the balcony's, the gantry's) rides the
   * structure and not the heightfield; a PITCHED rail is already following a
   * stair by construction; and `follow: false` is the way to ask for a
   * dead-level rail on rolling ground. In all three `gy` is zero everywhere
   * and every line below reduces to what it was.
   */
  const T = (!opts.kit && !pitch && !opts.quaternion && opts.follow !== false
    && world && world.terrain) ? world.terrain : null;
  const cy = Math.cos(opts.yaw || 0), sy = Math.sin(opts.yaw || 0);
  const gy = (sx) => (T ? T.height(pos.x + sx * cy, pos.z - sx * sy) - pos.y : 0);
  const feet = [];
  for (let i = 0; i <= posts; i++) feet.push(((i / posts) - 0.5) * L);
  const drop = feet.map(gy);
  for (let i = 0; i <= posts; i++) {
    const s = feet[i];
    kit.post(mat, 0.032, 0.038, h, s * cp, s * sp + drop[i] + h / 2, 0, { radial: 6, tile: 0.9 });
  }
  for (const yy of [h, h * 0.52]) {
    for (let i = 0; i < posts; i++) {
      const a = new THREE.Vector3(feet[i] * cp, feet[i] * sp + drop[i] + yy, 0);
      const b = new THREE.Vector3(feet[i + 1] * cp, feet[i + 1] * sp + drop[i + 1] + yy, 0);
      kit.put(pipeBetween(a, b, yy === h ? 0.042 : 0.028, 6), mat);
    }
  }
  /**
   * AND YOU CANNOT WALK THROUGH IT, which until now you could.
   *
   * This maker had NO COLLIDER AT ALL — neither the posts (`Kit.post` only
   * builds one when the caller passes `collide`, and this never did) nor the
   * rails (`kit.put` never builds one). Kamino's own dressing pass calls the
   * ring of rail round its deck "the level's most important prop because it is
   * the only thing between the fight and a nine-metre drop into the sea", and
   * it was a picture: 28 rail segments you and every enemy walked straight
   * through into the water. That is player note #8 exactly — "the majority of
   * objects are still not physical, like you just fall through them" — and
   * `tools/checks/physicality.mjs` is the rule it became.
   *
   * ONE box for the whole run rather than one per post, because a rail is a
   * barrier and not a row of bollards: 0.09 m of thickness (the top rail is
   * 0.084 through) by the run's own length, standing from the ground to the
   * top rail, pitched with the run so a ramped rail is a ramped box. Sixteen
   * boxes on Kamino instead of a hundred and twelve.
   */
  if (opts.collide !== false) {
    if (T) {
      /* One box per bay, each from the lower of its two feet to the top of the
       * higher one, so the barrier climbs with the rail. 52 m of bridge rail
       * costs 37 boxes instead of 1 and is the only version that is where the
       * player can see it. */
      for (let i = 0; i < posts; i++) {
        const mid = (feet[i] + feet[i + 1]) * 0.5;
        const lo = Math.min(drop[i], drop[i + 1]), hi = Math.max(drop[i], drop[i + 1]) + h;
        kit.collider(mid, (lo + hi) * 0.5, 0, (feet[i + 1] - feet[i]) * 0.5, (hi - lo) * 0.5, 0.09);
      }
    } else {
      kit.collider(0, h * 0.5, 0, L * 0.5, h * 0.5 + Math.abs(sp) * L * 0.5, 0.09);
    }
  }
  return kitClose(world, kit, pos, opts);
}

/** A stepped plinth — what a monument stands on. Sizes: 2, 4, 8 m across. */
export function addPlinth(world, pos, opts = {}) {
  assertOpts(addPlinth, opts);
  const kit = kitOpen(pos, opts, 99);
  const M = propMaterials();
  const w = opts.width ?? 4, d = opts.depth ?? w, h = opts.height ?? 1.2;
  const mat = opts.mat || M.sandstone;
  const band = opts.bandMat || M.stoneDark;
  const steps = opts.steps ?? 3;
  const rr = kit.rng;
  const tr = makeRng((opts.seed ?? 99) * 41 + 3);
  const ton = [1, 1, 1];
  /* The buried course. A plinth is the thing a monument's WEIGHT goes into,
   * and the arena's colossus stood on one whose lowest polygon was exactly on
   * grade — a stepped box laid on the sand with a straight dark line under it,
   * which is the single clearest way to say "this was placed, not built". Two
   * thirds of a metre of masonry below grade costs four hundred triangles
   * across the whole game and means the terrain can roll under it. */
  if (opts.footing !== false) {
    kit.slab(band, w * 1.05, 0.66, d * 1.05, 0, -0.30, 0, { tile: ARCH_TILE, seg: 2, bevel: 0.05, collide: false });
  }
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const sw = lerp(w, w * 0.78, t), sd = lerp(d, d * 0.78, t);
    const sh = h / steps;
    // one quarry tone per step, low at the foot and bleached at the top: three
    // identical slabs are one slab three times, and the eye reads the stack as
    // a single extruded mass rather than as courses of stone
    const g = slabGeo(sw, sh, sd, { tile: 2.4, seg: 3 });
    kit.put(tintGeo(g, ashlarTone(t, tr, ton)), mat, 0, sh * (i + 0.5), 0);
  }
  // recessed inscription band
  kit.slab(band, w * 0.72, h * 0.26, d * 0.79, 0, h * 0.52, 0, { tile: 1.4, collide: false });
  kit.slab(band, w * 0.79, h * 0.26, d * 0.72, 0, h * 0.52, 0, { tile: 1.4, collide: false });
  // and the desert against all four faces, so the sand does not stop dead at
  // the bottom step
  if (opts.drift !== false) {
    for (let i = 0; i < 4; i++) {
      const along = i % 2 ? d : w, thick = i % 2 ? w : d;
      kit.push(0, 0, 0, i * Math.PI / 2);
      sandDrift(kit, along * 1.02, thick, {
        rng: rr, nz: 1, height: Math.min(h * 0.5, 0.44) * (opts.drift ?? 1),
        seed: (opts.seed ?? 99) + i * 5.1,
      });
      kit.pop();
    }
  }
  kit.collider(0, h / 2, 0, w / 2, h / 2, d / 2);
  return kitClose(world, kit, pos, opts);
}

/**
 * A cantilevered balcony: slab, corbels underneath, railing on three sides.
 * Sizes: 2×1.4, 4×2, 6×2.6.
 */
export function addBalcony(world, pos, opts = {}) {
  assertOpts(addBalcony, opts);
  const kit = kitOpen(pos, opts, 111);
  const M = propMaterials();
  const w = opts.width ?? 4, d = opts.depth ?? 2, t = opts.thickness ?? ARCH.slabT;
  const mat = opts.mat || M.duracreteWarm;
  kit.slab(mat, w, t, d, 0, 0, d / 2, { tile: 2.6, seg: 3 });
  for (let i = 0; i < 3; i++) {
    const x = lerp(-w / 2 + 0.4, w / 2 - 0.4, i / 2);
    const c = extrudeBeveled([[0, 0], [d * 0.85, 0], [0, -d * 0.55]], 0.24, { bevel: 0.03, tile: 1.6 });
    c.rotateY(-Math.PI / 2);
    kit.put(c, opts.trimMat || M.sandstone, x, -t / 2, 0.02);
  }
  if (opts.railing !== false) {
    addRailing(world, new THREE.Vector3(0, t / 2, d), { kit, length: w, height: 1.02 });
    for (const sx of [-1, 1]) {
      addRailing(world, new THREE.Vector3(sx * w / 2, t / 2, d / 2), { kit, length: d, height: 1.02, yaw: Math.PI / 2 });
    }
  }
  return kitClose(world, kit, pos, opts);
}

/**
 * A paved floor: a grid of slabs with joints, a kerb, and — because a perfect
 * grid reads as a texture, not a place — a few slabs cracked, tilted or gone.
 * size = (x extent, z extent).
 */
export function addFloorSlab(world, pos, size, opts = {}) {
  assertOpts(addFloorSlab, opts);
  const kit = kitOpen(pos, opts, 122);
  const M = propMaterials();
  const w = size.x, d = size.y ?? size.z;
  const t = opts.thickness ?? ARCH.slabT;
  const cell = opts.cell ?? 2.0;
  const nx = Math.max(1, Math.round(w / cell)), nz = Math.max(1, Math.round(d / cell));
  const cw = w / nx, cd = d / nz;
  const rr = kit.rng;
  const mat = opts.mat || M.duracrete;
  const ruin = clamp(opts.ruin ?? 0.25, 0, 1);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const r0 = rr();
    if (r0 < ruin * 0.35) continue;                                  // gone
    const x = -w / 2 + (i + 0.5) * cw, z = -d / 2 + (j + 0.5) * cd;
    const tilt = r0 < ruin * 0.75 ? (rr() - 0.5) * 0.11 : 0;
    const drop = tilt ? -rr() * 0.09 : 0;
    kit.slab(mat, cw * 0.97, t, cd * 0.97, x, drop, z, {
      tile: 2.2, seg: 3, bevel: 0.03, collide: false, rx: tilt, rz: tilt * 0.6,
    });
  }
  if (opts.kerb !== false) {
    const km = opts.trimMat || M.duracreteWarm;
    for (const [sx, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const lw = sx ? 0.4 : w + 0.8, ld = sz ? 0.4 : d + 0.8;
      kit.slab(km, lw, t * 1.5, ld, sx * (w / 2 + 0.2), t * 0.2, sz * (d / 2 + 0.2), { tile: 2.4, seg: 3, collide: false });
    }
  }
  kit.collider(0, -t * 0.1, 0, w / 2 + 0.4, t * 0.6, d / 2 + 0.4);
  return kitClose(world, kit, pos, opts);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Monumental set pieces — the thing you navigate by                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A surface of revolution from a [radius, y] profile, with optional vertical
 * folds (robes, drapery, fluting) and a jagged top (broken statuary). The
 * profile is walked for arc length so UVs do not stretch at the flares.
 *
 * THE SWEEP'S WINDING FOLLOWS THE DIRECTION THE PROFILE IS WRITTEN IN, which
 * is the second half of "you can see through the tops of things". Sweeping
 * (r, y) → (r+dr, y+dy) gives a face normal proportional to (dy, -dr) in the
 * profile plane, so a profile written BOTTOM-UP faces out of the solid and one
 * written TOP-DOWN faces into it — the whole shell inside out, culled from
 * every angle it should be visible from. Two callers wrote theirs top-down,
 * because that is the order the shape reads in: addLamp's cowl (0.3 m down to
 * -0.02) and addColossus's mantle (0.625H down to 0.40H). Measured with the
 * downward-ray survey, 36.5% of the lamp's plan area and 13.5% of the
 * colossus's had a back face on top.
 *
 * So the direction is NORMALISED here rather than left as a rule nobody can
 * see. An open profile is swept low-to-high; a closed one (a shell with a
 * thickness, like the antenna dish) is swept so its cross-section runs
 * anticlockwise in (r, y), which is the same statement for a loop. Pass
 * `inward: true` for the rare surface that genuinely wants to face its own
 * axis; nothing in the file does yet.
 */
function revolveGeo(profile, opts = {}) {
  const seg = opts.seg ?? 20;
  const folds = opts.folds ?? 0, fd = opts.foldDepth ?? 0.05;
  const k = uvm(opts.tile ?? 2.2);
  {
    const f = profile[0], l = profile[profile.length - 1];
    const span = profile.reduce((a, p) => Math.max(a, Math.abs(p[1] - f[1])), 0);
    const closed = Math.hypot(l[0] - f[0], l[1] - f[1]) < Math.max(1e-6, span * 0.02);
    let orient;
    if (closed) {                       // signed area of the cross-section in (r, y)
      let a2 = 0;
      for (let j = 0; j < profile.length; j++) {
        const p = profile[j], q = profile[(j + 1) % profile.length];
        a2 += p[0] * q[1] - q[0] * p[1];
      }
      orient = a2;
    } else {
      orient = l[1] - f[1];             // net climb: written bottom-up or top-down
    }
    if ((orient < 0) !== !!opts.inward) profile = profile.slice().reverse();
  }
  const n = profile.length;
  const vArc = [0];
  for (let j = 1; j < n; j++) {
    vArc.push(vArc[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  }
  const rMax = profile.reduce((a, p) => Math.max(a, p[0]), 0);
  const pos = new Float32Array(n * (seg + 1) * 3), uv = new Float32Array(n * (seg + 1) * 2);
  for (let j = 0; j < n; j++) {
    const [r, y] = profile[j];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const f = folds ? (1 - fd * (0.5 - 0.5 * Math.cos(a * folds + (opts.twist || 0) * (y)))) : 1;
      const o = (j * (seg + 1) + i) * 3, o2 = (j * (seg + 1) + i) * 2;
      pos[o] = Math.cos(a) * r * f; pos[o + 1] = y; pos[o + 2] = Math.sin(a) * r * f;
      uv[o2] = (i / seg) * TAU * rMax * k; uv[o2 + 1] = vArc[j] * k;
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hanging sheet: banners, tattered flags. Sags, folds, frays at the hem. */
function drapeGeo(w, h, opts = {}) {
  const nx = opts.nx ?? 10, ny = opts.ny ?? 10;
  const r = opts.rng || rng;
  const amp = opts.fold ?? 0.09, freq = opts.folds ?? 3;
  const k = uvm(opts.tile ?? 1.6);
  const hem = [];
  for (let i = 0; i <= nx; i++) hem.push(1 - (opts.tatter ?? 0.25) * Math.pow(r(), 1.6));
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), uv = new Float32Array((nx + 1) * (ny + 1) * 2);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny;
    const y = -h * v * lerp(1, hem[i], v);
    const x = (u - 0.5) * w * lerp(1, 0.94, v);
    const z = Math.sin(u * Math.PI * freq * 2) * amp * (0.35 + v) + Math.sin(v * 5.1 + i) * amp * 0.25;
    const o = (j * (nx + 1) + i) * 3, o2 = (j * (nx + 1) + i) * 2;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    uv[o2] = x * k; uv[o2 + 1] = y * k;
  }
  const idx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A colossal statue — the landmark a level is navigated by. Default 18 m to
 * the crown; 10 m reads as a shrine, 30 m as a wonder. `ruined` snaps one arm
 * off at the elbow and leaves the armature showing, which is the whole reason
 * the silhouette is interesting from across the map.
 */
export function addColossus(world, pos, opts = {}) {
  assertOpts(addColossus, opts);
  const kit = kitOpen(pos, opts, 202);
  const M = propMaterials();
  const H = opts.height ?? 18;
  const stone = opts.mat || M.sandstone;
  const dark = opts.coreMat || M.stoneDark;
  const metal = opts.metalMat || M.bronze;
  const rr = kit.rng;
  const ruined = opts.ruined !== false;
  const seg = opts.seg ?? 20;

  addPlinth(world, new THREE.Vector3(0, 0, 0), {
    kit, width: H * 0.44, depth: H * 0.44, height: H * 0.15, steps: 3, mat: stone, bandMat: dark,
  });
  const y0 = H * 0.15;
  const S = (f) => H * f;

  // robe: hem on the plinth, waist at 0.46, folds all the way up
  kit.put(revolveGeo([
    [S(0.215), y0], [S(0.205), y0 + S(0.04)], [S(0.185), y0 + S(0.14)],
    [S(0.155), y0 + S(0.26)], [S(0.128), y0 + S(0.36)], [S(0.108), y0 + S(0.44)],
  ], { seg, folds: 14, foldDepth: 0.1, tile: 2.6 }), stone, 0, 0, 0);
  // torso and shoulders
  kit.put(revolveGeo([
    [S(0.108), y0 + S(0.44)], [S(0.126), y0 + S(0.5)], [S(0.132), y0 + S(0.56)],
    [S(0.126), y0 + S(0.6)], [S(0.1), y0 + S(0.63)],
  ], { seg, folds: 9, foldDepth: 0.05, tile: 2.6 }), stone, 0, 0, 0);
  // mantle falling off the shoulders
  kit.put(revolveGeo([
    [S(0.104), y0 + S(0.625)], [S(0.15), y0 + S(0.6)], [S(0.168), y0 + S(0.52)],
    [S(0.17), y0 + S(0.44)], [S(0.163), y0 + S(0.40)],
  ], { seg, folds: 11, foldDepth: 0.09, tile: 2.6 }), stone, 0, 0, 0);
  // hood: a cowl with a dark, empty face
  const hy = y0 + S(0.63);
  kit.put(revolveGeo([
    [S(0.052), hy], [S(0.082), hy + S(0.03)], [S(0.088), hy + S(0.08)],
    [S(0.07), hy + S(0.125)], [S(0.028), hy + S(0.15)], [0, hy + S(0.158)],
  ], { seg, folds: 7, foldDepth: 0.06, tile: 2.0 }), stone, 0, 0, 0);
  const face = new THREE.CircleGeometry(S(0.055), 14);
  scaleUv(face, uvm(1.4));
  kit.put(face, dark, 0, hy + S(0.075), S(0.055), -0.25, 0, 0);

  // Arms. The right is RAISED holding a snapped blade — a horizontal arm reads
  // as a T-pose from any distance, and the raised one is what makes this thing
  // findable across a map. The left is gone at the elbow.
  const armR = S(0.045), armL = S(0.30);
  const shoulderY = y0 + S(0.6), shoulderX = S(0.115);
  const upper = (sx, pitch, roll) => {
    const g = limbGeo(armL * 0.52, armR, armR * 0.86, 10, true, { rings: 4, bulge: 0.08, bulgeAt: 0.35 });
    tubeUv(g, TAU * armR, armL * 0.52, 1.6);
    g.applyMatrix4(_km.makeRotationFromEuler(_ke.set(pitch, 0, roll)));
    g.translate(sx * shoulderX, shoulderY, 0);
    return g;
  };
  const upRoll = 0.62, foreRoll = 0.26;
  kit.add(upper(1, 0.08, -upRoll), stone);
  const elbowX = shoulderX + Math.sin(upRoll) * armL * 0.52;
  const elbowY = shoulderY + Math.cos(upRoll) * armL * 0.52;
  const fore = limbGeo(armL * 0.5, armR * 0.86, armR * 0.72, 10, true, { rings: 3, bulge: 0.05 });
  tubeUv(fore, TAU * armR, armL * 0.5, 1.6);
  fore.applyMatrix4(_km.makeRotationFromEuler(_ke.set(0.1, 0, -foreRoll)));
  fore.translate(elbowX, elbowY, 0);
  kit.add(fore, stone);
  const handX = elbowX + Math.sin(foreRoll) * armL * 0.5;
  const handY = elbowY + Math.cos(foreRoll) * armL * 0.5;
  // a fist, so the blade is held rather than balanced
  const fist = new THREE.SphereGeometry(armR * 1.15, 8, 6);
  tubeUv(fist, TAU * armR, Math.PI * armR, 1.4);
  kit.put(fist, stone, handX, handY, 0);
  // the blade it holds, snapped short
  const bl = S(0.5) * (ruined ? 0.45 : 1);
  const blade = extrudeBeveled([
    [-S(0.03), 0], [S(0.03), 0], [S(0.022), bl * 0.86],
    [ruined ? S(0.03) : 0, bl], [ruined ? -S(0.016) : 0, bl * 0.97], [-S(0.022), bl * 0.86],
  ], S(0.02), { bevel: S(0.006), tile: 1.4 });
  blade.rotateZ(-0.16);
  blade.translate(handX + S(0.01), handY - S(0.03), S(0.02));
  kit.add(blade, metal);

  if (ruined) {
    const stub = upper(-1, -0.15, 1.15);
    kit.add(stub, stone);
    const bx = -shoulderX - Math.sin(1.15) * armL * 0.5, by = shoulderY + Math.cos(1.15) * armL * 0.48;
    const ring = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ring.push(new THREE.Vector3(bx + Math.cos(a) * armR * 0.86, by + (rr() - 0.5) * armR * 0.5, Math.sin(a) * armR * 0.86));
    }
    kit.put(fanCap(ring, by, true, 0.9), dark);
    for (let i = 0; i < 4; i++) {                            // armature bars in the break
      const a = rr() * TAU, rad = armR * (0.2 + rr() * 0.5);
      kit.put(tubeAlong([
        new THREE.Vector3(bx + Math.cos(a) * rad, by - armR * 0.4, Math.sin(a) * rad),
        new THREE.Vector3(bx + Math.cos(a) * rad * 1.3, by + armR * (0.8 + rr()), Math.sin(a) * rad * 1.3),
      ], armR * 0.09, 4, FINE_TILE), M.rebar);
    }
    // a wound in the shoulder where the arm tore away
    const wound = new THREE.SphereGeometry(S(0.05), 8, 6);
    tubeUv(wound, TAU * S(0.05), Math.PI * S(0.05), 1.2);
    kit.put(wound, dark, -S(0.11), y0 + S(0.595), 0);
  } else {
    kit.add(upper(-1, -0.15, 1.15), stone);
  }

  kit.collider(0, y0 + S(0.3) / 2, 0, S(0.19), S(0.3) / 2 + y0 * 0.5, S(0.19));
  kit.collider(0, y0 + S(0.5), 0, S(0.14), S(0.16), S(0.14));
  return kitClose(world, kit, pos, opts, 'statue');
}

/**
 * A ruined ceremonial gateway: two battered pylons, a broken arch between
 * them, chains, a rotted banner and the rubble it all shed. Spans 8–20 m.
 */
export function addRuinedGate(world, pos, opts = {}) {
  assertOpts(addRuinedGate, opts);
  const kit = kitOpen(pos, opts, 303);
  const M = propMaterials();
  const span = opts.span ?? 12;
  const H = opts.height ?? span * 1.15;
  const mat = opts.mat || M.duracreteWarm;
  const trim = opts.trimMat || M.sandstone;
  const rr = kit.rng;
  const pw = span * 0.26, pd = span * 0.3;

  for (const sx of [-1, 1]) {
    const x = sx * (span / 2 + pw / 2);
    const lean = sx * (opts.lean ?? 0.012);
    // battered pylon: four diminishing drums so the silhouette steps
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const t = i / 4, t1 = (i + 1) / 4;
      const h = H * 0.25 * (i === 3 ? 0.86 : 1);
      const w0 = lerp(pw, pw * 0.72, t), w1 = lerp(pw, pw * 0.72, t1);
      kit.put(extrudeBeveled([
        [-w0 / 2, 0], [w0 / 2, 0], [w1 / 2, h], [-w1 / 2, h],
      ], lerp(pd, pd * 0.78, t), { bevel: 0.06, tile: ARCH_TILE }), mat, x + lean * y * 8, y, 0);
      kit.slab(trim, w1 * 1.12, 0.24, lerp(pd, pd * 0.78, t1) * 1.1, x, y + h, 0, { tile: 2.6, collide: false });
      y += h + 0.24;
    }
    // a recessed panel down each face gives the mass a scale reference
    for (const sz of [-1, 1]) {
      kit.slab(M.duracreteDark, pw * 0.5, H * 0.5, 0.1, x, H * 0.34, sz * pd * 0.5, { tile: 2.2, collide: false });
    }
    /* Where the pylon meets the ground. A battered mass is the one shape that
     * makes the omission unmissable — the taper says the eye is looking at
     * something that carries load, and then it arrives at grade on a knife
     * edge with a shadow under it. A buried course, a projecting damp band
     * that throws the water clear, and sand banked on all four faces. */
    if (opts.footing !== false) {
      kit.slab(M.duracreteDark, pw * 1.06, 0.72, pd * 1.06, x, -0.33, 0, { tile: ARCH_TILE, seg: 2, bevel: 0.06, collide: false });
      kit.slab(trim, pw * 1.1, 0.22, pd * 1.1, x, 0.11, 0, { tile: TRIM_TILE, seg: 3, bevel: 0.04, collide: false });
    }
    if (opts.drift !== false) {
      // pushed into the PYLON's frame: sandDrift builds about its own origin,
      // and both pylons' banks would otherwise land on the gate's centreline —
      // in mid-air, in the middle of the opening
      kit.push(x, 0, 0, 0);
      for (let i = 0; i < 4; i++) {
        const along = i % 2 ? pd : pw, thick = i % 2 ? pw : pd;
        kit.push(0, 0, 0, i * Math.PI / 2);
        sandDrift(kit, along * 1.05, thick, {
          rng: rr, nz: 1, height: 0.62 * (opts.drift ?? 1), seed: (opts.seed ?? 303) + sx * 7 + i * 2.3,
        });
        kit.pop();
      }
      kit.pop();
    }
    kit.collider(x, y / 2, 0, pw * 0.52, y / 2, pd * 0.52);
  }

  addArch(world, new THREE.Vector3(0, 0, 0), {
    kit, span, springing: H * 0.62, rise: span * 0.34, depth: pd * 0.8,
    thickness: span * 0.11, piers: false, broken: opts.broken ?? 0.28,
    mat, trimMat: trim, collideArch: false, seed: 3031,
  });

  // chains off the surviving side of the ring
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Vector3(span * 0.2 + i * 0.5, H * 0.62 + span * 0.3, (rr() - 0.5) * pd * 0.4);
    const b = new THREE.Vector3(a.x + 1.2 + rr(), H * 0.62 - 1 - rr() * 2, a.z + (rr() - 0.5));
    kit.put(tubeAlong(catenaryPoints(a, b, 0.3, 10), 0.045, 4, FINE_TILE), M.rust);
  }
  // a banner nobody took down
  const bw = span * 0.22;
  const ban = drapeGeo(bw, H * 0.4, { rng: rr, folds: 3, fold: 0.14, tatter: 0.4, nx: 8, ny: 8 });
  kit.put(ban, opts.banner || M.tarp, -span * 0.28, H * 0.6, pd * 0.42);

  // fallen voussoirs
  for (let i = 0; i < 3; i++) {
    const s = span * 0.09;
    kit.put(extrudeBeveled([[-s, -s * 0.6], [s, -s * 0.5], [s * 0.8, s * 0.6], [-s * 0.9, s * 0.5]],
      pd * 0.55, { bevel: 0.05, tile: 2.0 }), mat,
      (rr() - 0.5) * span * 0.8, s * 0.5, (rr() - 0.5) * span * 0.6,
      rr() * 0.4, rr() * TAU, rr() * 0.5);
  }
  if (opts.debris !== false) {
    addDebrisField(world, new THREE.Vector3(0, 0, 0), {
      kit, radius: span * 0.8, seed: (opts.seed ?? 303) + 7, density: 0.8, mat, chipMat: M.duracreteDark,
    });
  }
  return kitClose(world, kit, pos, opts, 'stone');
}

/**
 * A section of capital-ship hull, down on its side: a torn cylindrical shell
 * with real plate thickness, internal frames showing through the tear, hull
 * plating and greebles outside. Default 34 m long × 8 m radius — big enough to
 * fight inside, and a horizon line from anywhere on the map.
 */
export function addHullSection(world, pos, opts = {}) {
  assertOpts(addHullSection, opts);
  const kit = kitOpen(pos, opts, 404);
  const M = propMaterials();
  const L = opts.length ?? 34, R = opts.radius ?? 8;
  const t = opts.plate ?? 0.28;
  const hull = opts.mat || M.hull;
  const inner = opts.innerMat || M.darkSteel;
  const trimM = opts.trimMat || M.panel;
  const rr = kit.rng;
  const na = opts.arcSeg ?? 22, nz = opts.lenSeg ?? 18;
  const g0 = kit.groundY;
  kit.groundY = -R;                       // the origin is the axis, not the keel

  // the tear line: where the shell stops, as a function of length
  const tear = [];
  let hi = 0.62, lo = -0.62;
  for (let j = 0; j <= nz; j++) {
    hi = clamp(hi + (rr() - 0.5) * 0.16, 0.34, 0.86);
    lo = clamp(lo + (rr() - 0.5) * 0.16, -0.86, -0.34);
    tear.push([lo * Math.PI, hi * Math.PI]);
  }
  const k = uvm(ARCH_TILE);
  // shallow dents so the shell is not a perfect extrusion — SHARED with the
  // torn edges below, because a lip built off the undented radius stands up to
  // 22 cm away from the sheet it is supposed to be closing
  const dentAt = (a, j, z) => 1 + Math.sin(a * 3.1 + j * 0.7) * 0.012 + Math.sin(z * 0.4 + a * 1.7) * 0.016;
  /* EVERY SURFACE IN THIS MAKER USED TO FACE THE WRONG WAY. The shell is swept
   * with i running along the arc and j along the length, and (a, c, b) for that
   * parameterisation gives a normal pointing at the CYLINDER AXIS — so the
   * outer plate faced inwards, the inner plate (built with the reversed index)
   * faced outwards, and both torn edges pointed back into the metal. The wreck
   * is a trough lying open side up, so what the player looks down into is the
   * inner face: measured with a grid of downward rays, 91.6% of its plan area
   * had a back face on top, and with those culled you saw the far side of the
   * hull through the near side.
   *
   * `faceAxis` now says which way a sheet is meant to look, instead of `flip`
   * saying which of two windings to use and neither of them being right. */
  const build = (radius, faceAxis) => {
    const pos3 = new Float32Array((nz + 1) * (na + 1) * 3), uv = new Float32Array((nz + 1) * (na + 1) * 2);
    for (let j = 0; j <= nz; j++) {
      const z = (j / nz - 0.5) * L;
      const [a0, a1] = tear[j];
      for (let i = 0; i <= na; i++) {
        const a = lerp(a0, a1, i / na);
        const dent = dentAt(a, j, z);
        const o = (j * (na + 1) + i) * 3, o2 = (j * (na + 1) + i) * 2;
        pos3[o] = Math.sin(a) * radius * dent;
        pos3[o + 1] = -Math.cos(a) * radius * dent;
        pos3[o + 2] = z;
        uv[o2] = a * radius * k; uv[o2 + 1] = z * k;
      }
    }
    const idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
      const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
      if (faceAxis) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const outerG = build(R, false), innerG = build(R - t, true);
  // outer plate looks away from the axis, inner plate looks into the trough
  kit.add(outerG, hull);
  kit.add(innerG, inner);
  // close the torn edges so the plate has thickness you can see
  const edge = (side) => {
    const pos3 = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) {
      const z = (j / nz - 0.5) * L, a = tear[j][side];
      const dent = dentAt(a, j, z);
      for (const r of [R, R - t]) {
        pos3.push(Math.sin(a) * r * dent, -Math.cos(a) * r * dent, z);
        uv.push(z * k * 2, r * k * 2);
      }
    }
    // the strip looks ALONG the tear, out of the metal, on whichever lip it is
    for (let j = 0; j < nz; j++) {
      const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  kit.add(edge(0), trimM); kit.add(edge(1), trimM);

  // internal frames — the ribs you see through the tear
  const nRib = opts.ribs ?? Math.max(3, Math.round(L / 5));
  for (let i = 0; i < nRib; i++) {
    const z = (i / (nRib - 1) - 0.5) * L * 0.94;
    const jj = Math.round(((z / L) + 0.5) * nz);
    const [a0, a1] = tear[clamp(jj, 0, nz)];
    const rIn = R - t - 0.42, rOut = R - t - 0.02;
    const pts = [];
    const steps = 14;
    for (let s = 0; s <= steps; s++) { const a = lerp(a0 + 0.08, a1 - 0.08, s / steps); pts.push([Math.sin(a) * rOut, -Math.cos(a) * rOut]); }
    for (let s = steps; s >= 0; s--) { const a = lerp(a0 + 0.08, a1 - 0.08, s / steps); pts.push([Math.sin(a) * rIn, -Math.cos(a) * rIn]); }
    kit.put(extrudeBeveled(pts, 0.3, { bevel: 0.04, tile: 1.8 }), inner, 0, 0, z);
  }
  // longitudinal stringers inside
  for (let i = 0; i < 5; i++) {
    const a = lerp(-1.5, 1.5, i / 4);
    kit.put(slabGeo(0.26, 0.2, L * 0.96, { tile: 2.0, seg: 3 }), inner,
      Math.sin(a) * (R - t - 0.2), -Math.cos(a) * (R - t - 0.2), 0, 0, 0, -a);
  }
  // hull plating outside: raised strakes and belly bands
  for (let i = 0; i < 4; i++) {
    const z = (i / 3 - 0.5) * L * 0.8;
    const pts = [];
    const steps = 16;
    for (let s = 0; s <= steps; s++) { const a = lerp(-2.6, 2.6, s / steps); pts.push([Math.sin(a) * (R + 0.07), -Math.cos(a) * (R + 0.07)]); }
    for (let s = steps; s >= 0; s--) { const a = lerp(-2.6, 2.6, s / steps); pts.push([Math.sin(a) * R, -Math.cos(a) * R]); }
    kit.put(extrudeBeveled(pts, 0.5, { bevel: 0.03, tile: 2.6 }), trimM, 0, 0, z);
  }
  // greebles: vents, hatches, a snapped conduit
  for (let i = 0; i < 9; i++) {
    const a = lerp(-2.3, 2.3, rr()), z = (rr() - 0.5) * L * 0.9;
    const w = 0.5 + rr() * 1.6, h = 0.4 + rr() * 1.1;
    kit.put(slabGeo(w, 0.14, h, { tile: TRIM_TILE, seg: 3 }), rr() < 0.3 ? M.rust : trimM,
      Math.sin(a) * (R + 0.06), -Math.cos(a) * (R + 0.06), z, 0, 0, -a);
  }
  for (let i = 0; i < 3; i++) {
    const z = (rr() - 0.5) * L * 0.7;
    const a = lerp(-1.2, 1.2, rr());
    kit.put(tubeAlong([
      new THREE.Vector3(Math.sin(a) * (R - t - 0.3), -Math.cos(a) * (R - t - 0.3), z),
      new THREE.Vector3(Math.sin(a) * (R + 0.6), -Math.cos(a) * (R + 0.4), z + 1.2 + rr()),
      new THREE.Vector3(Math.sin(a) * (R + 1.4), -Math.cos(a) * (R + 0.2) - 1.2, z + 2.4 + rr() * 2),
    ], 0.11, 5, FINE_TILE), M.cable);
  }

  // coarse colliders: the shell reads as a wall on both flanks and a floor
  const nCol = Math.max(3, Math.round(L / 8));
  for (let i = 0; i < nCol; i++) {
    const z = (i / nCol - 0.5 + 0.5 / nCol) * L;
    for (const sx of [-1, 1]) {
      kit.colliderQ(sx * R * 0.72, -R * 0.42, z, 0.4, R * 0.5, L / nCol / 2,
        _kq.setFromAxisAngle(new THREE.Vector3(0, 0, 1), sx * 0.7));
    }
    kit.collider(0, -R * 0.94, z, R * 0.5, 0.5, L / nCol / 2);
  }
  kit.groundY = g0;
  return kitClose(world, kit, pos, opts);
}

/**
 * A hangar gantry: lattice legs, a plated walkway, railings, a ladder and a
 * crane trolley on a rail. Default 22 m long, 7 m to the deck.
 */
export function addGantry(world, pos, opts = {}) {
  assertOpts(addGantry, opts);
  const kit = kitOpen(pos, opts, 505);
  const M = propMaterials();
  const L = opts.length ?? 22, H = opts.height ?? 7, W = opts.width ?? 2.6;
  const bays = opts.bays ?? Math.max(2, Math.round(L / 7));
  const steel = opts.mat || M.darkSteel;
  const deckM = opts.deckMat || M.grating;
  const rr = kit.rng;

  for (let b = 0; b <= bays; b++) {
    const z = (b / bays - 0.5) * L;
    if (b < bays) {
      // lattice bracing along the deck edge
      const z1 = ((b + 1) / bays - 0.5) * L;
      for (const sx of [-1, 1]) {
        kit.put(pipeBetween(new THREE.Vector3(sx * W / 2, H - 1.1, z), new THREE.Vector3(sx * W / 2, H - 0.15, z1), 0.05, 5), steel);
        kit.put(pipeBetween(new THREE.Vector3(sx * W / 2, H - 0.15, z), new THREE.Vector3(sx * W / 2, H - 1.1, z1), 0.05, 5), steel);
      }
    }
    if (b % 2 !== 0 && b !== bays) continue;
    // a trestle: two splayed legs cross-braced
    for (const sx of [-1, 1]) {
      const foot = sx * (W / 2 + H * 0.16);
      kit.put(pipeBetween(new THREE.Vector3(foot, 0, z), new THREE.Vector3(sx * W / 2, H - 0.2, z), 0.1, 7), steel);
      kit.slab(steel, 0.5, 0.16, 0.5, foot, 0.08, z, { tile: FINE_TILE, collide: false });
    }
    for (let i = 0; i < 3; i++) {
      const y0 = H * (0.2 + i * 0.26), y1 = H * (0.2 + (i + 1) * 0.26);
      const w0 = W / 2 + H * 0.16 * (1 - y0 / H), w1 = W / 2 + H * 0.16 * (1 - y1 / H);
      kit.put(pipeBetween(new THREE.Vector3(-w0, y0, z), new THREE.Vector3(w1, y1, z), 0.045, 5), steel);
      kit.put(pipeBetween(new THREE.Vector3(w0, y0, z), new THREE.Vector3(-w1, y1, z), 0.045, 5), steel);
      kit.put(pipeBetween(new THREE.Vector3(-w0, y0, z), new THREE.Vector3(w0, y0, z), 0.04, 5), steel);
    }
    kit.collider(0, H / 2, z, W / 2 + H * 0.16, H / 2, 0.3);
  }
  // deck and its stiffeners
  kit.slab(deckM, W, 0.14, L, 0, H, 0, { tile: ARCH_TILE, seg: 3 });
  for (const sx of [-1, 1]) kit.slab(steel, 0.16, 0.34, L, sx * (W / 2 - 0.08), H + 0.1, 0, { tile: TRIM_TILE, collide: false });
  addRailing(world, new THREE.Vector3(0, H + 0.07, W / 2), { kit, length: L, height: 1.05, posts: bays * 2, yaw: Math.PI / 2 });
  addRailing(world, new THREE.Vector3(0, H + 0.07, -W / 2), { kit, length: L, height: 1.05, posts: bays * 2, yaw: Math.PI / 2 });

  /* Ladder up the near end.
   *
   * AND IT IS SOLID NOW. `kit.put` bins geometry and emits nothing else, so
   * every stile and every rung of every ladder in this file — this one, the
   * scaffold's and the tank's — was something the player and the droids walked
   * straight through. One box on the ladder's own plane, stopping flush with
   * the deck so there is no invisible perch above it. It is still not
   * CLIMBABLE: the support query answers "what is the top of this at (x, z)",
   * which is a floor question, and a rung is not a floor. What gets you onto a
   * deck in this game is the Force jump, and the decks are placed inside its
   * measured 6.18 m — see the gantry heights in Levels.js. A real climb
   * belongs in Player, next to the vault it would share a button with. */
  const lz = -L / 2 + 0.4;
  for (const sx of [-1, 1]) kit.put(pipeBetween(new THREE.Vector3(sx * 0.26, 0, lz - 0.5), new THREE.Vector3(sx * 0.26, H + 0.9, lz - 0.5), 0.038, 5), steel);
  for (let i = 0; i * 0.3 < H + 0.6; i++) {
    kit.put(pipeBetween(new THREE.Vector3(-0.26, i * 0.3 + 0.25, lz - 0.5), new THREE.Vector3(0.26, i * 0.3 + 0.25, lz - 0.5), 0.022, 4), steel);
  }
  kit.collider(0, H / 2, lz - 0.5, 0.32, H / 2, 0.08);
  // crane trolley on a rail under the deck, hook swinging on a cable
  const tz = (rr() - 0.5) * L * 0.5;
  kit.slab(steel, 0.34, 0.22, L * 0.94, 0, H - 0.22, 0, { tile: TRIM_TILE, collide: false });
  kit.slab(M.panel, 0.8, 0.5, 1.3, 0, H - 0.6, tz, { tile: TRIM_TILE, collide: false });
  kit.put(pipeBetween(new THREE.Vector3(0, H - 0.85, tz), new THREE.Vector3(0.1, H - 3.4, tz + 0.2), 0.028, 4), M.cable);
  kit.put(torusGeo(0.28, 0.06, 5, 10, Math.PI * 1.5, FINE_TILE), M.rust, 0.1, H - 3.7, tz + 0.2, Math.PI / 2, 0, 0.4);
  if (opts.lights !== false) {
    for (let i = 0; i < 3; i++) {
      const z = (i / 2 - 0.5) * L * 0.7;
      kit.slab(M.glowCold, 0.5, 0.1, 0.24, 0, H - 0.24, z, { tile: FINE_TILE, collide: false, seg: 2 });
    }
  }
  kit.collider(0, H, 0, W / 2, 0.16, L / 2);
  return kitClose(world, kit, pos, opts);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Machinery and clutter — evidence that somebody lived here             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A run of pipe or conduit through a set of world-space (or kit-space) points:
 * `count` parallel lines, flanges at the bends, valve wheels, and stanchions
 * down to the floor. Radius 0.06 reads as conduit, 0.3 as a main.
 */
export function addPipeRun(world, points, opts = {}) {
  assertOpts(addPipeRun, opts);
  const first = points[0];
  const kit = kitOpen(first, opts, 1010);
  const M = propMaterials();
  const rad = opts.radius ?? 0.14;
  const count = opts.count ?? 1;
  const mat = opts.mat || M.steel;
  const trim = opts.trimMat || M.rust;
  const rr = kit.rng;
  const local = points.map((p) => p.clone().sub(first));
  const spread = opts.spread ?? rad * 2.7;
  const upDir = new THREE.Vector3(0, 1, 0);
  // a lateral offset perpendicular to the run, so the bundle stays a bundle
  const side = new THREE.Vector3().subVectors(local[local.length - 1], local[0]).cross(upDir).normalize();
  if (!isFinite(side.x) || side.lengthSq() < 0.1) side.set(1, 0, 0);

  for (let c = 0; c < count; c++) {
    const off = side.clone().multiplyScalar((c - (count - 1) / 2) * spread);
    const rc = rad * (opts.vary === false ? 1 : (0.7 + rr() * 0.6));
    const path = local.map((p) => p.clone().add(off).add(_kv.set(0, (c - (count - 1) / 2) * spread * 0.12, 0)));
    kit.add(tubeAlong(path, rc, opts.radial ?? 8, 1.4), c % 3 === 1 ? trim : mat);
    for (let i = 1; i < path.length - 1; i++) {          // flange at every bend
      const t = torusGeo(rc * 1.25, rc * 0.4, 5, 10, TAU, 1.0);
      const dir = new THREE.Vector3().subVectors(path[i + 1], path[i - 1]).normalize();
      t.applyMatrix4(_km.makeRotationFromQuaternion(_kq.setFromUnitVectors(upDir, dir).multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))));
      kit.put(t, trim, path[i].x, path[i].y, path[i].z);
    }
    if (opts.valves !== false && c === 0) {
      for (let i = 0; i < Math.max(1, Math.round(local.length / 2)); i++) {
        const p = path[Math.min(path.length - 1, 1 + i * 2)];
        const v = torusGeo(rc * 1.9, rc * 0.22, 5, 12, TAU, 1.0);
        kit.put(v, M.paint, p.x, p.y + rc * 2.1, p.z, 0, 0, 0.3);
        kit.put(cylGeo(rc * 0.3, rc * 0.3, rc * 2.2, 6, 1.2), mat, p.x, p.y + rc * 1.1, p.z);
      }
    }
  }
  if (opts.supports !== false) {
    for (let i = 0; i < local.length; i++) {
      const p = local[i];
      const drop = opts.supportDrop ?? (p.y + (first.y - (opts.floorY ?? 0)));
      if (drop < 0.3) continue;
      kit.put(slabGeo(spread * count + rad * 3, 0.1, rad * 2.4, { tile: 1.2, seg: 3 }), M.darkSteel,
        p.x, p.y - rad * 1.5, p.z);
      for (const sx of [-1, 1]) {
        kit.put(cylGeo(0.05, 0.06, drop, 6, 1.2), M.darkSteel,
          p.x + side.x * sx * (spread * count * 0.4), p.y - rad * 1.6 - drop / 2, p.z + side.z * sx * (spread * count * 0.4));
      }
    }
  }
  return kitClose(world, kit, first, opts);
}

/**
 * Cables strung between two points, hanging as true catenaries. `count` lines
 * with slightly different slack so they never read as a copy-paste, plus an
 * insulator bracket at each end.
 */
export function addCableRun(world, a, b, opts = {}) {
  assertOpts(addCableRun, opts);
  const kit = kitOpen(a, opts, 1111);
  const M = propMaterials();
  const n = opts.count ?? 3;
  const rad = opts.radius ?? 0.035;
  const rr = kit.rng;
  const la = new THREE.Vector3(), lb = new THREE.Vector3().subVectors(b, a);
  /* HOW FAR IT DIPS, IN METRES — and until now the two levels that asked for
   * that were ignored and got a swag through the floor.
   *
   * `catenaryPoints` takes SLACK: the fraction of extra arc length over the
   * straight line, which is the right thing to default because it is
   * dimensionless and reads the same on a 6 m run and a 90 m one. It is not
   * what a level knows. Both call sites in Levels.js wrote `sag: 1.5` and
   * `sag: 1.6` — "the cable dips about a metre and a half" — and `sag` was not
   * a key this maker read, so both fell back to the 9% default. MEASURED on
   * the hangar's own run (80 m wall to wall, anchored at 8.0 and 7.0 m): the
   * cable bottoms out 26 m below its low anchor, i.e. eighteen metres under
   * the deck it is strung over. The deck level's 56 m run drops 20.6 m.
   *
   * So `sag` is read, in metres, and converted with the shallow-cable identity
   * — a parabola of dip d over span L is (8/3)(d/L)² longer than its chord —
   * rather than with a fitted number. MEASURED against the curve it feeds, over
   * spans of 6 to 120 m: within 0.6% of the dip asked for while d/L is under a
   * tenth, 2.1% at d/L = 0.15, and useless past that — which is fine, because
   * a caller who wants a third of the span in droop wants `slack` and the deep
   * catenary it describes. The one edge worth knowing is at the other end:
   * `catenaryPoints` floors its own slack at 0.001, so no cable can dip less
   * than L·0.0194 however small a sag is asked for — 1.55 m across the
   * hangar's 80 m wall, which is under the 1.6 it asks for and over a 1.0 it
   * might have. The per-cable jitter stays on top, because a bundle does not
   * hang as one line: dip runs 0.84× to 1.22× the number asked for. */
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const slack0 = opts.sag != null && span > 1e-3
    ? (8 / 3) * (opts.sag / span) ** 2
    : (opts.slack ?? 0.09);
  const side = new THREE.Vector3().subVectors(lb, la).cross(UP).normalize();
  if (!isFinite(side.x) || side.lengthSq() < 0.1) side.set(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const off = side.clone().multiplyScalar((i - (n - 1) / 2) * (opts.spread ?? 0.32));
    const drop = (opts.stagger ?? 0.18) * i;
    const p0 = la.clone().add(off).setY(la.y - drop);
    const p1 = lb.clone().add(off).setY(lb.y - drop);
    const slack = slack0 * (0.7 + rr() * 0.8);
    kit.add(tubeAlong(catenaryPoints(p0, p1, slack, opts.segments ?? 16), rad * (0.8 + rr() * 0.5), 5, FINE_TILE), opts.mat || M.cable);
  }
  if (opts.brackets !== false) {
    for (const p of [la, lb]) {
      kit.put(slabGeo(0.3, 0.22, 0.3, { tile: FINE_TILE, seg: 3 }), M.darkSteel, p.x, p.y, p.z);
    }
  }
  return kitClose(world, kit, a, opts);
}

/**
 * A stack of crates: the base courses static and merged, the top one or two
 * live Props you can cut and shove off.
 *
 * `count` is how many boxes the pile is made of; `tiers` and `columns` set the
 * lattice directly if a caller would rather say it that way. Without either it
 * is a medium pile of eight to twelve.
 */
export function addCrateStack(world, pos, opts = {}) {
  assertOpts(addCrateStack, opts);
  const M = propMaterials();
  const seed = opts.seed ?? 1212;
  const rr = makeRng(seed * 7 + 1);
  /* COMPOSABLE, like every other `add*` in this file — and it was the one that
   * was not. The header of this file says "pass `{ kit }` to any `add*` to
   * compose it into a larger merge"; this maker built a `new Kit` of its own
   * and emitted it, so `{ kit }` was accepted and dropped. That is not only a
   * draw call: a composed maker is handed a KIT-SPACE position, so the one
   * call site that tried it (the derelict cell in the Cut's dressing pass,
   * since deleted for having had no caller) put its stack at world (3.4, 1.8) —
   * beside the level origin, twenty to a hundred metres from the machine it was
   * meant to be stacked against. */
  const kit = kitOpen(pos, opts, seed);
  const size = opts.size ?? 0.8;
  /* HOW BIG IS THE PILE, in the vocabulary the caller used.
   *
   * Four call sites in Levels.js asked for `{ count: 2 + (rng() * 4 | 0) }` —
   * two to five boxes, the spill off a wreck — and got the default eight to
   * twelve, because `count` was not read. It is the word the rest of this file
   * already uses for how many of a thing to make (addScree, addBoulderCluster,
   * addDebrisField, addPipeRun, addCableRun), so it is the word this maker
   * should have taken.
   *
   * It is derived into the lattice rather than being a third way of describing
   * one: `columns` comes out of the count as √count — a pile is about as wide
   * as it is deep and grows upward from there — and the tier loop below stops
   * the moment the last box is laid, so an explicit `tiers` or `columns` still
   * overrides either half of that.
   */
  const want = opts.count ?? Infinity;
  /* The two default draws stay in this order and are skipped rather than
   * overwritten when the count decides them, because `rr` also rolls every
   * gap and every jitter below: a draw taken and thrown away moves the whole
   * pile. */
  const byCount = opts.count != null;
  let tiers = opts.tiers ?? (byCount ? 0 : 2 + Math.floor(rr() * 3));
  const cols = opts.columns ?? (byCount
    ? Math.max(1, Math.round(Math.sqrt(opts.count)))
    : 2 + Math.floor(rr() * 2));
  // cells in tier t of this lattice, which is what says how tall the pile has
  // to be to hold `count` of them
  const cellsIn = (t) => Math.max(1, cols - Math.floor(t * 0.7)) * Math.max(1, cols - 1 - Math.floor(t * 0.5));
  if (byCount && !tiers) for (let held = 0; held < want; tiers++) held += cellsIn(tiers);
  const dyn = [];
  const yaw = opts.yaw || 0;

  const cell = size * 1.06;
  /* EVERY CRATE SITS ON WHAT IS ACTUALLY UNDER IT, not on its tier's nominal
   * height. The tiers used to advance by a fixed 0.9·size and lay each one out
   * on its own lattice as the stack narrows — so a tier that lost its only cell
   * to the 18% "gaps, not a wall" roll left the crate above it standing on
   * nothing. Measured on the arena: a live top crate hanging 0.86 m over the
   * tier below, and the tiers never quite touched anyway — 0.88·s of box under
   * a 0.9·s advance is a 2 cm gap under every crate in the game.
   *
   * `restOn` returns the top of the highest crate this one OVERLAPS, so a tier
   * laid on a different lattice rests across the joint below it the way a real
   * stack does, and a skipped crate makes the one above it drop instead of
   * hover. */
  const placed = [];
  const restOn = (x, z, s) => {
    let h = 0;
    for (const p of placed) {
      if (Math.abs(p.x - x) >= (p.s + s) * 0.5 || Math.abs(p.z - z) >= (p.s + s) * 0.5) continue;
      if (p.top > h) h = p.top;
    }
    return h;
  };
  let laid = 0;
  /* The gap roll skips a CELL, not a crate: `laid` is what stops the loop, so
   * a pile asked for five boxes is five boxes with a gap in it rather than
   * four. The headroom above the lattice estimate is what absorbs the skips,
   * and it costs nothing when it is not needed because the loop stops on the
   * last box. MEASURED over 30 000 piles — every count from 1 to 30, a
   * thousand seeds each: with three tiers of headroom 1% of piles came up
   * short, worst by two; with six, none of them do. */
  const top = tiers + (byCount && opts.tiers == null ? 6 : 0);
  for (let t = 0; t < top && laid < want; t++) {
    const w = Math.max(1, cols - Math.floor(t * 0.7));
    const d = Math.max(1, cols - 1 - Math.floor(t * 0.5));
    const s = size * lerp(1, 0.82, Math.min(1, t / Math.max(1, tiers)));
    for (let i = 0; i < w && laid < want; i++) for (let j = 0; j < d && laid < want; j++) {
      if (t > 0 && rr() < 0.18) continue;                     // gaps, not a wall
      const x = (i - (w - 1) / 2) * cell, z = (j - (d - 1) / 2) * cell;
      const jitter = (rr() - 0.5) * 0.12;
      const y = restOn(x, z, s);
      laid++;
      if ((t === tiers - 1 || laid === want) && rr() < 0.5 && dyn.length < (opts.dynamic ?? 2)) {
        // this one is a live prop, and it stands on the tier — `y`, not the
        // tier's mid-height, because makeCrate seats itself on what it is given
        dyn.push([x, y, z, s]);
        placed.push({ x, z, s, top: y + s * 0.88 });
        continue;
      }
      const box = slabGeo(s, s * 0.88, s, { bevel: s * 0.055, seg: 3, tile: FINE_TILE });
      kit.put(box, rr() < 0.32 ? M.crateDark : M.crate, x, y + s * 0.44, z, 0, jitter, 0);
      for (const ry of [s * 0.28, -s * 0.28]) {               // banding ribs
        kit.put(slabGeo(s * 1.03, s * 0.07, s * 1.03, { bevel: s * 0.02, seg: 2, tile: FINE_TILE }),
          M.crateDark, x, y + s * 0.44 + ry, z, 0, jitter, 0);
      }
      kit.collider(x, y + s * 0.44, z, s / 2, s * 0.44, s / 2, jitter, 0.85);
      placed.push({ x, z, s, top: y + s * 0.88 });
    }
  }
  for (const [x, yy, z, s] of dyn) {
    /* EXACTLY the size of the crates it is stacked with. `s / 0.85` asked for
     * a crate between 1.00 and 1.41 times its own slot — 24% oversized on
     * average — so the live crate on top of a stack overlapped the static ones
     * beside it by up to 12 cm and stood on their lids instead of on the tier.
     *
     * Placed through `kit.after` rather than here, because a body needs a
     * WORLD point and a composed maker does not have one until the kit it was
     * built into is emitted. Bare, that is this same instant.
     */
    kit.after(_kv.set(x, yy, z), (w2, p) => {
      makeCrate(w2, p, s, { exactSize: true, toughness: TOUGHNESS.plastoid });
    });
  }
  /* AND THE STACK ITSELF CAN BE CUT. Its lower courses are merged into the
   * kit, and merged used to mean untouchable — the `crate` profile and the
   * measurement that put it there are in Destruction.js. Registration costs a
   * bounds computation; the manager pre-fractures only what is threatened, so
   * a stack nobody swings at costs exactly what it cost before. */
  return kitClose(world, kit, pos, opts, 'crate');
}

/**
 * A tarpaulin thrown over something and lashed down: sags between its tie
 * points, wrinkles, and a ragged edge. Covers a 2–4 m pile.
 */
export function addTarp(world, pos, opts = {}) {
  assertOpts(addTarp, opts);
  const kit = kitOpen(pos, opts, 1313);
  const M = propMaterials();
  const w = opts.width ?? 3, d = opts.depth ?? 2.4, h = opts.height ?? 1.3;
  const rr = kit.rng;
  const nx = opts.nx ?? 12, nz = opts.nz ?? 10;
  const k = uvm(1.8);
  const pos3 = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const ph = rr() * 10;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / nz;
    const x = (u - 0.5) * w, z = (v - 0.5) * d;
    // A tarp over a pile is flat on top and creased down the sides, not a
    // cone: the load holds the middle up and the fabric breaks over its edges.
    const du = Math.abs(u - 0.5) * 2, dv = Math.abs(v - 0.5) * 2;
    const load = clamp(1 - Math.pow(Math.max(du, dv), 3.2), 0, 1);
    const dome = Math.pow(load, 0.42);
    // creases run down the slope from the high points and gather at the hem
    const slope = 1 - dome;
    const crease = (Math.sin(Math.atan2(z, x) * 7 + ph) * 0.5 + 0.5) * slope * slope * 0.22
                 + Math.sin(u * 13.7 + ph) * Math.sin(v * 11.3 + ph * 1.7) * 0.035
                 + fbm2(u * 5 + ph, v * 5, 3) * 0.05;
    const y = h * (dome - crease * 0.9) + 0.02;
    const o = (j * (nx + 1) + i) * 3, o2 = (j * (nx + 1) + i) * 2;
    // the hem kicks outward where the fabric bunches on the ground
    const flare = 1 + Math.pow(Math.max(du, dv), 4) * 0.12;
    pos3[o] = x * flare; pos3[o + 1] = Math.max(0.01, y); pos3[o + 2] = z * flare;
    uv[o2] = x * k; uv[o2 + 1] = z * k;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, dd = c + 1;
    idx.push(a, c, b, b, c, dd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  kit.add(g, opts.mat || (rr() < 0.4 ? M.tarpBlue : M.tarp));
  // guy ropes to pegs
  if (opts.ropes !== false) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const a = new THREE.Vector3(sx * w * 0.46, h * 0.16, sz * d * 0.46);
      const b = new THREE.Vector3(sx * (w * 0.5 + 0.5 + rr() * 0.4), 0.02, sz * (d * 0.5 + 0.5 + rr() * 0.4));
      kit.add(tubeAlong(catenaryPoints(a, b, 0.02, 5), 0.018, 4, FINE_TILE), M.cable);
      kit.put(cylGeo(0.03, 0.02, 0.3, 5, FINE_TILE), M.rust, b.x, 0.1, b.z, 0.2, 0, 0.15);
    }
  }
  kit.collider(0, h * 0.35, 0, w * 0.42, h * 0.35, d * 0.42);
  return kitClose(world, kit, pos, opts);
}

/**
 * Scaffolding: standards, ledgers, diagonal braces, board decks and a ladder.
 * Sizes: 2×2 m footprint per bay, 2 m per lift. Default 4 m × 2 m × 3 lifts.
 */
export function addScaffold(world, pos, opts = {}) {
  assertOpts(addScaffold, opts);
  const kit = kitOpen(pos, opts, 1414);
  const M = propMaterials();
  const W = opts.width ?? 4, D = opts.depth ?? 2, lifts = opts.lifts ?? 3;
  const lift = opts.lift ?? 2.0;
  const bays = Math.max(1, Math.round(W / 2));
  const steel = opts.mat || M.rust;
  const board = opts.boardMat || M.wood;
  const rr = kit.rng;
  const H = lifts * lift;
  const xs = [], zs = [-D / 2, D / 2];
  for (let i = 0; i <= bays; i++) xs.push(-W / 2 + (i * W) / bays);

  for (const x of xs) for (const z of zs) {
    kit.put(cylGeo(0.045, 0.045, H + 0.3, 6, 1.2), steel, x, (H + 0.3) / 2, z);
    kit.put(cylGeo(0.07, 0.09, 0.1, 6, 1.2), M.darkSteel, x, 0.05, z);
  }
  for (let l = 1; l <= lifts; l++) {
    const y = l * lift;
    for (const z of zs) kit.put(pipeBetween(new THREE.Vector3(-W / 2, y, z), new THREE.Vector3(W / 2, y, z), 0.035, 5), steel);
    for (const x of xs) kit.put(pipeBetween(new THREE.Vector3(x, y, -D / 2), new THREE.Vector3(x, y, D / 2), 0.035, 5), steel);
    // guard rail one lift up, on the outside
    if (l < lifts) kit.put(pipeBetween(new THREE.Vector3(-W / 2, y + 1.0, zs[1]), new THREE.Vector3(W / 2, y + 1.0, zs[1]), 0.03, 5), steel);
    // boards
    const nb = Math.max(2, Math.round(D / 0.35));
    for (let b = 0; b < nb; b++) {
      if (l === lifts && rr() < 0.25) continue;              // a plank has been taken
      const z = -D / 2 + (b + 0.5) * (D / nb);
      kit.put(slabGeo(W * 0.98, 0.05, D / nb * 0.9, { bevel: 0.012, seg: 3, tile: TRIM_TILE }), board, 0, y + 0.05, z, 0, (rr() - 0.5) * 0.02, 0);
    }
    kit.collider(0, y + 0.05, 0, W / 2, 0.09, D / 2);
  }
  for (let i = 0; i < bays; i++) {                            // face bracing
    const x0 = xs[i], x1 = xs[i + 1];
    for (let l = 0; l < lifts; l++) {
      const up = l % 2 === 0;
      kit.put(pipeBetween(new THREE.Vector3(x0, l * lift + (up ? 0.1 : lift), zs[1]),
        new THREE.Vector3(x1, l * lift + (up ? lift : 0.1), zs[1]), 0.028, 5), steel);
    }
  }
  // ladder up the end bay — solid, for the reason the gantry's ladder states.
  // The lifts themselves are 2 m apart and each one is a collider, so a
  // scaffold is climbable the way this game climbs: one jump per lift.
  const lx = xs[0] + 0.25;
  for (const dz of [-0.2, 0.2]) kit.put(pipeBetween(new THREE.Vector3(lx, 0, dz), new THREE.Vector3(lx, H + 0.6, dz), 0.028, 5), steel);
  for (let i = 0; i * 0.32 < H + 0.4; i++) {
    kit.put(pipeBetween(new THREE.Vector3(lx, 0.3 + i * 0.32, -0.2), new THREE.Vector3(lx, 0.3 + i * 0.32, 0.2), 0.018, 4), steel);
  }
  kit.collider(lx, H / 2, 0, 0.08, H / 2, 0.26);
  kit.collider(-W / 2, H / 2, 0, 0.12, H / 2, D / 2);
  kit.collider(W / 2, H / 2, 0, 0.12, H / 2, D / 2);
  return kitClose(world, kit, pos, opts);
}

/**
 * A comms mast: a lattice tower, a dish, a whip aerial, guy wires down to
 * ground anchors and a warning lamp. Heights 6–24 m.
 */
export function addAntenna(world, pos, opts = {}) {
  assertOpts(addAntenna, opts);
  const kit = kitOpen(pos, opts, 1515);
  const M = propMaterials();
  const H = opts.height ?? 12;
  const base = opts.base ?? H * 0.075;
  const steel = opts.mat || M.darkSteel;
  const rr = kit.rng;
  const legs = 3, segs = Math.max(4, Math.round(H / 2));
  const leg = (i, t) => {
    const a = (i / legs) * TAU + Math.PI / 6;
    const r = lerp(base, base * 0.34, t);
    return new THREE.Vector3(Math.cos(a) * r, t * H, Math.sin(a) * r);
  };
  for (let i = 0; i < legs; i++) {
    const pts = [];
    for (let s = 0; s <= 4; s++) pts.push(leg(i, s / 4));
    kit.add(tubeAlong(pts, 0.06, 5, 1.2), steel);
  }
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs, t1 = (s + 1) / segs;
    for (let i = 0; i < legs; i++) {
      const j = (i + 1) % legs;
      kit.put(pipeBetween(leg(i, t0), leg(j, t0), 0.026, 4), steel);
      kit.put(pipeBetween(leg(i, t0), leg(j, t1), 0.024, 4), steel);
    }
  }
  // dish
  const dr = opts.dish ?? H * 0.16;
  if (dr > 0.2) {
    const prof = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push([dr * t, dr * 0.34 * t * t]); }
    for (let i = 6; i >= 0; i--) { const t = i / 6; prof.push([dr * t, dr * 0.34 * t * t + dr * 0.035]); }
    const dish = revolveGeo(prof, { seg: 16, tile: 1.4 });
    dish.applyMatrix4(_km.makeRotationX(-1.15));
    kit.put(dish, M.paintPale, base * 0.5, H * 0.78, 0, 0, rr() * TAU, 0);
    kit.put(cylGeo(0.05, 0.05, dr * 0.9, 6, 1.2), steel, base * 0.5, H * 0.78 + dr * 0.3, 0, 1.15, 0, 0);
  }
  // whip and lamp
  kit.put(cylGeo(0.015, 0.035, H * 0.24, 5, 1.2), steel, 0, H * 1.1, 0);
  kit.put(tubeUv(new THREE.SphereGeometry(0.12, 8, 6), TAU * 0.12, Math.PI * 0.12, FINE_TILE), M.glowRed, 0, H * 1.23, 0);
  /* Guy wires, anchored on the GROUND rather than on the mast's own datum.
   * The anchors sit six or seven metres out, and a kit is flat: on the dunes
   * that put a 40 cm anchor block 0.72 m in the air with its wire running to
   * nothing — measured, on both of the level's masts. `dy` is the drop from
   * the mast's foot to the ground under each anchor, so the block follows the
   * dune and the catenary lengthens to meet it. Only when this maker owns the
   * kit: composed into a parent (an outpost) the kit frame is not world. */
  if (opts.guys !== false) {
    const onGround = !opts.kit && world && world.terrain;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.6;
      const ax = Math.cos(a) * H * 0.55, az = Math.sin(a) * H * 0.55;
      const dy = onGround ? Math.min(0, groundY(world, pos.x + ax, pos.z + az) - pos.y) : 0;
      const anchor = new THREE.Vector3(ax, dy + 0.1, az);
      kit.add(tubeAlong(catenaryPoints(leg(i, 0.82), anchor, 0.012, 8), 0.022, 4, FINE_TILE), M.cable);
      kit.put(cylGeo(0.09, 0.13, 0.4, 6, FINE_TILE), M.duracreteDark, anchor.x, dy + 0.2, anchor.z);
    }
  }
  kit.slab(M.duracrete, base * 3, 0.32, base * 3, 0, 0.16, 0, { tile: 1.6 });
  kit.collider(0, H * 0.4, 0, base * 0.8, H * 0.4, base * 0.8);
  return kitClose(world, kit, pos, opts);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Plant — the three shapes an interior is actually made of              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHY THREE NEW MAKERS AND NOT THIRTY.
 *
 * The descent, the temple and any ship interior all have the same problem the
 * hangar had and solved by hand: an interior is DENSE, and the surveys hold it
 * to that — `world-immersion` asks a level with no ground cover for a median
 * gap to the nearest object under 6.5 m over a 160 m room, and `f.sil` wants
 * something over 1.2 m across within 25 m of everywhere. Answering that with
 * `addWall` boxes costs a draw call apiece and the mesh budget is 520.
 *
 * These three are the shapes that answer it, and between them they are most of
 * what stands on a factory floor:
 *
 *   addMachine     the mid-size block. A plinth, a body, a cowl, a control
 *                  face. This is the density.
 *   addTank        the vertical. A skirt, a shell, hoops, a domed head — the
 *                  thing that reads on the skyline of a room.
 *   addStanchion   the structure. What is holding the roof up, and the only
 *                  one of the three that is allowed to be repeated on a grid,
 *                  because structure IS repeated on a grid.
 *
 * All three merge through `Kit`, so a machine is two or three draw calls
 * whatever it is made of, and all three are built from `slab`, `post`,
 * `cylGeo` and `pipeBetween` — the primitives the see-through survey has
 * already proven closed. Nothing here revolves a hand-written profile, which
 * is where every winding bug in this file has come from.
 */

/**
 * A machine block. `size` is the body: width × height × depth in metres.
 *
 * Everything about it is authored for the cel pass — big flat faces, a hard
 * change of plane rather than a bevel you have to shade to see, and the panel
 * seams the ink pass draws for free because they are real geometry. There is
 * exactly one saturated thing on it, the control face, and it is 20 cm wide.
 */
export function addMachine(world, pos, opts = {}) {
  assertOpts(addMachine, opts);
  const kit = kitOpen(pos, opts, 1818);
  const M = propMaterials();
  const W = opts.width ?? 3.4, H = opts.height ?? 2.8, D = opts.depth ?? 2.2;
  const body = opts.mat || M.panel;
  const trim = opts.trimMat || M.darkSteel;
  const glow = opts.glowMat || M.glowAmber;
  const rr = kit.rng;

  // The plinth. A machine is bolted to a pad, and the pad is what makes it
  // read as installed rather than as set down — and it is what beds the whole
  // assembly, so the seating survey measures concrete on the floor.
  kit.slab(M.duracrete, W + 0.5, 0.22, D + 0.5, 0, 0.11, 0, { tile: ARCH_TILE, seg: 3 });
  // The body, in two courses so the silhouette has a shoulder.
  const hLow = H * 0.62;
  kit.slab(body, W, hLow, D, 0, 0.22 + hLow / 2, 0, { tile: ARCH_TILE, seg: 3, bevel: 0.05 });
  kit.slab(body, W * 0.82, H - hLow, D * 0.86, 0, 0.22 + hLow + (H - hLow) / 2, 0,
    { tile: ARCH_TILE, seg: 3, bevel: 0.05 });
  // Ribs down the long faces: the seams the outline pass draws.
  const ribs = Math.max(2, Math.round(W / 0.9));
  for (let i = 0; i < ribs; i++) {
    const x = (i / (ribs - 1) - 0.5) * (W - 0.5);
    for (const sz of [-1, 1]) {
      kit.slab(trim, 0.13, hLow * 0.86, 0.09, x, 0.22 + hLow / 2, sz * (D / 2 + 0.04),
        { tile: FINE_TILE, seg: 2, collide: false });
    }
  }
  // The cowl and its duct — the vertical that stops a machine being a crate.
  const ch = opts.cowl ?? (0.5 + rr() * 0.9);
  kit.post(trim, W * 0.16, W * 0.13, ch, W * 0.22, 0.22 + H + ch / 2, 0, { radial: 10, tile: TRIM_TILE });
  kit.put(torusGeo(W * 0.17, 0.055, 5, 12, TAU, FINE_TILE), M.rust, W * 0.22, 0.22 + H + ch * 0.82, 0);
  // A run of conduit off the back, dropping to the floor.
  kit.put(pipeBetween(new THREE.Vector3(-W * 0.3, 0.22 + H * 0.9, -D / 2 - 0.05),
    new THREE.Vector3(-W * 0.3, 0.28, -D / 2 - 0.3), 0.055, 6), M.cable);
  // The control face. One accent, on the side a player walks up to.
  kit.slab(trim, W * 0.34, 0.5, 0.1, W * 0.2, 0.22 + hLow * 0.78, D / 2 + 0.06,
    { tile: FINE_TILE, seg: 2, collide: false });
  kit.slab(glow, W * 0.2, 0.11, 0.05, W * 0.2, 0.22 + hLow * 0.86, D / 2 + 0.11,
    { tile: FINE_TILE, seg: 2, collide: false });
  if (opts.light) kit.light(W * 0.2, 0.22 + hLow * 0.86, D / 2 + 0.4, opts);
  kit.collider(0, 0.22 + H / 2, 0, W / 2, (H + 0.22) / 2, D / 2);
  return kitClose(world, kit, pos, opts);
}

/**
 * A vertical tank on a skirt: shell, hoops, a domed head and a ladder.
 *
 * The head is a SPHERE scaled down in y, not a revolved profile, and that is
 * the whole reason this maker exists in this form: every see-through top this
 * file has ever had came from a hand-wound profile or a fan cap, and a sphere
 * is closed by construction. Its lower half sits inside the shell where it is
 * never seen, which costs a few hundred triangles and cannot be wrong.
 */
export function addTank(world, pos, opts = {}) {
  assertOpts(addTank, opts);
  const kit = kitOpen(pos, opts, 1919);
  const M = propMaterials();
  const R = opts.radius ?? 2.0, H = opts.height ?? 6.0;
  const shell = opts.mat || M.steel;
  const trim = opts.trimMat || M.rust;
  const skirt = opts.skirtHeight ?? Math.min(1.2, H * 0.16);

  // skirt and its base ring
  kit.slab(M.duracrete, R * 2.5, 0.24, R * 2.5, 0, 0.12, 0, { tile: ARCH_TILE, seg: 3 });
  kit.post(M.darkSteel, R * 0.92, R * 0.92, skirt, 0, 0.24 + skirt / 2, 0, { radial: 14, tile: ARCH_TILE });
  // the shell
  const sy = 0.24 + skirt;
  kit.post(shell, R, R, H, 0, sy + H / 2, 0, { radial: 18, tile: ARCH_TILE });
  // hoops — drawn marks, in geometry, which is what the ink pass wants
  const hoops = Math.max(2, Math.round(H / 1.8));
  for (let i = 1; i < hoops; i++) {
    kit.put(torusGeo(R * 1.02, 0.055, 5, 18, TAU, TRIM_TILE), trim, 0, sy + (i / hoops) * H, 0);
  }
  // the head
  const dome = tubeUv(new THREE.SphereGeometry(R, 18, 10), TAU * R, Math.PI * R, ARCH_TILE);
  dome.scale(1, (opts.domeRise ?? 0.42), 1);
  kit.put(dome, shell, 0, sy + H, 0);
  kit.put(cylGeo(R * 0.12, R * 0.1, R * 0.5, 8, TRIM_TILE), trim, 0, sy + H + R * 0.42 + R * 0.2, 0);
  // the ladder, on the side, with its cage hoops
  const lx = R + 0.12;
  for (const sx of [-1, 1]) {
    kit.put(pipeBetween(new THREE.Vector3(lx, 0.24, sx * 0.24),
      new THREE.Vector3(lx, sy + H + 0.5, sx * 0.24), 0.038, 5), M.darkSteel);
  }
  for (let i = 0; i * 0.32 < sy + H + 0.3; i++) {
    kit.put(pipeBetween(new THREE.Vector3(lx, 0.4 + i * 0.32, -0.24),
      new THREE.Vector3(lx, 0.4 + i * 0.32, 0.24), 0.02, 4), M.darkSteel);
  }
  // an outlet main leaving the skirt
  kit.put(pipeBetween(new THREE.Vector3(0, 0.24 + skirt * 0.5, -R * 0.7),
    new THREE.Vector3(0, 0.24 + skirt * 0.5, -R * 2.1), 0.13, 8), trim);
  kit.collider(0, (sy + H) / 2, 0, R, (sy + H) / 2, R);
  return kitClose(world, kit, pos, opts);
}

/**
 * A structural steel column: base plate, box shaft with flanges, and a haunch
 * bracket at the head. The one maker in this file that is MEANT to be placed
 * on a grid — a bay grid is what an industrial roof is, and breaking it up
 * would be a lie about how the room stands up.
 */
export function addStanchion(world, pos, opts = {}) {
  assertOpts(addStanchion, opts);
  const kit = kitOpen(pos, opts, 2020);
  const M = propMaterials();
  const H = opts.height ?? 9, W = opts.width ?? 0.62;
  const steel = opts.mat || M.darkSteel;
  kit.slab(M.duracrete, W * 2.6, 0.26, W * 2.6, 0, 0.13, 0, { tile: ARCH_TILE, seg: 3 });
  kit.slab(steel, W * 1.7, 0.1, W * 1.7, 0, 0.31, 0, { tile: TRIM_TILE, seg: 2, collide: false });
  // the shaft, as a web with two flanges: three slabs, one I-section
  kit.slab(steel, W * 0.34, H, W, 0, 0.36 + H / 2, 0, { tile: ARCH_TILE, seg: 3 });
  for (const sx of [-1, 1]) {
    kit.slab(steel, W * 0.22, H, W * 0.28, sx * W * 0.36, 0.36 + H / 2, 0,
      { tile: ARCH_TILE, seg: 3, collide: false });
  }
  // the head: a cap plate and two gusset braces reaching out to the roof
  kit.slab(steel, W * 2.0, 0.16, W * 1.5, 0, 0.36 + H + 0.08, 0, { tile: TRIM_TILE, seg: 2, collide: false });
  for (const sx of [-1, 1]) {
    kit.put(pipeBetween(new THREE.Vector3(sx * W * 0.2, 0.36 + H - 1.5, 0),
      new THREE.Vector3(sx * W * 1.5, 0.36 + H + 0.1, 0), 0.075, 6), steel);
  }
  if (opts.lamp) {
    // a hazard lamp bracketed to the shaft, at head height for whatever walks
    // past it. Not a light unless asked: a dark level is dark on purpose.
    kit.slab(M.glowAmber, 0.28, 0.4, 0.1, 0, 0.36 + H * 0.62, W * 0.6,
      { tile: FINE_TILE, seg: 2, collide: false });
    if (opts.light) kit.light(0, 0.36 + H * 0.62, W * 0.9, opts);
  }
  kit.collider(0, 0.36 + H / 2, 0, W * 0.6, H / 2, W * 0.6);
  return kitClose(world, kit, pos, opts);
}

/**
 * A lamp standard with a cowl and an emissive lens. Pass `light: true` to hang
 * a real PointLight off it (registered with the level so it unloads cleanly).
 * Heights 3 m (path), 6 m (yard), 9 m (apron).
 */
export function addLamp(world, pos, opts = {}) {
  assertOpts(addLamp, opts);
  const kit = kitOpen(pos, opts, 1616);
  const M = propMaterials();
  const H = opts.height ?? 6;
  const reach = opts.reach ?? H * 0.22;
  const steel = opts.mat || M.darkSteel;
  const glow = opts.glowMat || M.glowAmber;
  kit.slab(M.duracrete, 0.6, 0.26, 0.6, 0, 0.13, 0, { tile: TRIM_TILE });
  kit.put(cylGeo(0.075, 0.11, H, 8, TRIM_TILE), steel, 0, H / 2 + 0.2, 0);
  // the head cranes over
  kit.add(tubeAlong([
    new THREE.Vector3(0, H * 0.86, 0), new THREE.Vector3(0, H + 0.16, 0),
    new THREE.Vector3(reach * 0.7, H + 0.24, 0), new THREE.Vector3(reach, H + 0.14, 0),
  ], 0.062, 6, FINE_TILE), steel);
  const cowl = revolveGeo([
    [0.05, 0.3], [0.2, 0.22], [0.3, 0.06], [0.31, 0], [0.28, -0.02],
  ], { seg: 14, tile: FINE_TILE });
  kit.put(cowl, steel, reach, H + 0.02, 0);
  kit.put(cylGeo(0.26, 0.2, 0.09, 12, FINE_TILE), glow, reach, H - 0.03, 0);
  if (opts.light) kit.light(reach, H - 0.2, 0, opts);
  kit.collider(0, H / 2, 0, 0.14, H / 2, 0.14);
  return kitClose(world, kit, pos, opts);
}

/** Procedural block-glyph signage — a language you cannot read, which is the point. */
let SIGN_TEX = null;
function signTexture() {
  if (SIGN_TEX) return SIGN_TEX;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const r = makeRng(4242);
  ctx.fillStyle = '#191c22'; ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 4; row++) {
    let x = 12 + r() * 20;
    const y = 18 + row * 60;
    const h = 26 + r() * 10;
    ctx.fillStyle = row === 0 ? '#ffb648' : '#cfd8e6';
    while (x < size - 30) {
      const w = 10 + r() * 22;
      ctx.fillRect(x, y, w, h * (0.5 + r() * 0.5));
      if (r() < 0.4) ctx.fillRect(x, y + h * 0.6, w * 0.6, h * 0.25);
      x += w + 6 + r() * 10;
    }
  }
  SIGN_TEX = new THREE.CanvasTexture(c);
  SIGN_TEX.colorSpace = THREE.SRGBColorSpace;
  SIGN_TEX.wrapS = SIGN_TEX.wrapT = THREE.ClampToEdgeWrapping;
  return SIGN_TEX;
}
let SIGN_MAT = null;

/**
 * Signage: a board of glyphs with an emissive strip, either on a post
 * (`post: true`) or bracketed off a wall. Widths 1.2–4 m.
 */
export function addSign(world, pos, opts = {}) {
  assertOpts(addSign, opts);
  const kit = kitOpen(pos, opts, 1717);
  const M = propMaterials();
  const w = opts.width ?? 2.2, h = opts.height ?? w * 0.42;
  const y = opts.mount ?? 2.6;
  const rr = kit.rng;
  if (!SIGN_MAT) {
    SIGN_MAT = new THREE.MeshStandardMaterial({
      map: signTexture(), color: 0xffffff, roughness: 0.62, metalness: 0.1,
      emissive: 0x223044, emissiveIntensity: 0.7, emissiveMap: signTexture(),
    });
  }
  const back = slabGeo(w, h, 0.12, { bevel: 0.03, seg: 3, tile: 1.2 });
  kit.put(back, M.panel, 0, y, 0);
  const faceG = new THREE.PlaneGeometry(w * 0.94, h * 0.86);
  kit.put(faceG, SIGN_MAT, 0, y, 0.065);
  kit.put(slabGeo(w * 0.98, 0.05, 0.04, { bevel: 0.012, seg: 2, tile: FINE_TILE }),
    rr() < 0.5 ? M.glowAmber : M.glowCold, 0, y - h / 2 - 0.03, 0.08);
  if (opts.post !== false) {
    for (const sx of [-1, 1]) {
      kit.put(cylGeo(0.05, 0.06, y + h / 2, 6, 1.2), M.darkSteel, sx * w * 0.35, (y + h / 2) / 2, 0);
    }
    kit.collider(0, (y + h / 2) / 2, 0, w * 0.4, (y + h / 2) / 2, 0.12);
  } else {
    for (const sx of [-1, 1]) {
      kit.put(slabGeo(0.06, 0.06, 0.34, { bevel: 0.015, seg: 2, tile: FINE_TILE }), M.darkSteel, sx * w * 0.35, y, -0.2);
    }
  }
  return kitClose(world, kit, pos, opts);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Debris fields                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/** Three rubble shapes: a broken slab, a chipped block, a shard. */
function rubbleGeo(variant, seed) {
  const r = makeRng(seed * 71 + variant * 313);
  let g;
  if (variant === 0) {
    // a slab, then knock the corners about — a bevelled box at this size is
    // exactly the shape that reads as a game asset rather than as concrete
    g = plateGeo(1.0, 0.34, 0.78, 0.05, 3);
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + Math.sin(v.x * 5.1 + r() * 0.4) * 0.13 + Math.sin(v.z * 4.3) * 0.11;
      p.setXYZ(i, v.x * k, v.y * (1 + Math.sin(v.x * 3.7) * 0.14), v.z * k);
    }
    g.computeVertexNormals();
  } else if (variant === 1) {
    g = new THREE.IcosahedronGeometry(0.55, 1);
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + Math.sin(v.x * 4 + r()) * 0.1 + Math.sin(v.z * 3.4) * 0.12;
      p.setXYZ(i, v.x * k * 1.3, Math.max(-0.5, v.y * k * 0.8), v.z * k);
    }
    g.computeVertexNormals();
  } else {
    g = new THREE.TetrahedronGeometry(0.62, 0);
    g.scale(1.1, 0.7, 0.9);
  }
  // authored at ~1 m; addDebrisField re-scales the UVs by the mean instance
  // scale so a chip and the slab it broke off share one texel density
  return triplanarUv(g, ARCH_TILE);
}

/**
 * The rubble a ruin actually sheds: big blocks close in, chips far out, all
 * instanced. Three draw calls plus one for the bent reinforcement, and a
 * handful of colliders on the pieces big enough to trip over.
 *
 * radius 5 m = a collapsed wall, 12 m = a collapsed building.
 */
export function addDebrisField(world, centre, opts = {}) {
  assertOpts(addDebrisField, opts);
  const M = propMaterials();
  const R = opts.radius ?? 8;
  const seed = opts.seed ?? 1818;
  const r = makeRng(seed * 13 + 7);
  const density = opts.density ?? 1;
  const n = Math.round((opts.count ?? R * R * 0.55) * density);
  const scale = opts.scale ?? 1;
  const mat = opts.mat || M.duracrete;
  const chipMat = opts.chipMat || M.duracreteDark;
  const composing = !!opts.kit;
  const lists = [[], [], []], cols = [[], [], []];
  const c = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  // the three rubble shapes' corners, so a piece can be asked where its lowest
  // one lands once it has been turned and scaled — same reason as CHIP_HULL
  const hull = composing ? null : [0, 1, 2].map((v) => {
    const g = rubbleGeo(v, seed), a = g.attributes.position, out = [];
    for (let i = 0; i < a.count; i++) out.push(a.getX(i), a.getY(i), a.getZ(i));
    g.dispose();
    return out;
  });
  let big = 0;
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const rad = R * Math.pow(r(), 0.42);
    // size falls off hard with distance: the heavy stuff did not travel
    const near = 1 - rad / R;
    const sc = scale * lerp(0.22, 1.5, Math.pow(near, 1.5)) * (0.55 + r() * 0.9);
    p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    p.y = sc * 0.16 + (composing ? 0 : groundY(world, centre.x + p.x, centre.z + p.z) - groundY(world, centre.x, centre.z));
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.9, r() * TAU, (r() - 0.5) * 0.9));
    s.set(sc * (0.8 + r() * 0.6), sc * (0.6 + r() * 0.7), sc * (0.8 + r() * 0.6));
    const v = sc > scale * 0.85 ? 0 : (r() < 0.55 ? 1 : 2);
    /* A block tumbled by three Euler angles lands on a CORNER, and where that
     * corner falls is nothing like where its middle is: the height was sampled
     * at the middle only, so a slab lying across a break of slope hung its low
     * end in the air. Measured on the arena, 4 pieces of 3610 objects, up to
     * 0.27 m clear. Only ever pushes down, so flat ground is untouched. */
    if (hull) {
      const hv = hull[v];
      let lowY = Infinity, lowX = 0, lowZ = 0;
      for (let k = 0; k < hv.length; k += 3) {
        _cv.set(hv[k] * s.x, hv[k + 1] * s.y, hv[k + 2] * s.z).applyQuaternion(q);
        if (_cv.y < lowY) { lowY = _cv.y; lowX = _cv.x; lowZ = _cv.z; }
      }
      p.y += Math.min(0, groundY(world, centre.x + p.x + lowX, centre.z + p.z + lowZ)
        - groundY(world, centre.x + p.x, centre.z + p.z));
    }
    lists[v].push(m.clone().compose(p, q, s));
    const t = 0.74 + r() * 0.44;
    cols[v].push(c.clone().setRGB(t, t * (0.97 + r() * 0.06), t * (0.93 + r() * 0.08)));
    if (!composing && sc > scale * 1.0 && big < (opts.colliders ?? 5)) {
      big++;
      world.physics.addStaticBox(
        new THREE.Vector3(centre.x + p.x, centre.y + p.y, centre.z + p.z),
        new THREE.Vector3(s.x * 0.5, s.y * 0.4, s.z * 0.5), q.clone(), { friction: 0.85 });
    }
  }
  const out = [];
  for (let v = 0; v < 3; v++) {
    if (!lists[v].length) continue;
    // Same trap as addScree: the three rubble shapes are authored at ~1 m and
    // then scaled per instance, and the small chips end up 3× finer than the
    // slabs beside them. Re-UV each variant by the mean scale it ACTUALLY got,
    // read off the matrices that were just generated.
    let ms = 0;
    for (const mtx of lists[v]) { mtx.decompose(_v1, _q1, _v2); ms += (_v2.x + _v2.y + _v2.z) / 3; }
    ms = Math.max(0.05, ms / lists[v].length);
    // shrunk by `ms`, so its LOCAL uv has to be multiplied by ms to land on the
    // same world density — divide here and the chips get finer, not coarser
    const g = scaleUv(rubbleGeo(v, seed), ms);
    const mm = v === 0 ? mat : chipMat;
    if (composing) {
      const geos = [];
      for (const mtx of lists[v]) { const gg = g.clone(); gg.applyMatrix4(mtx); geos.push(gg); }
      g.dispose();
      const merged = mergeGeos(geos);
      if (merged) opts.kit.put(merged, mm, 0, 0, 0);
    } else {
      out.push(addInstanced(world, g, mm, lists[v], centre, { colors: cols[v], castShadow: v === 0 }));
    }
  }
  // bent reinforcement sticking out of the pile
  if (opts.rebar !== false) {
    const bars = [];
    for (let i = 0; i < Math.round(4 * density); i++) {
      const a = r() * TAU, rad = R * 0.55 * r();
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const yy = composing ? 0 : groundY(world, centre.x + x, centre.z + z) - groundY(world, centre.x, centre.z);
      bars.push(tubeAlong([
        new THREE.Vector3(x, yy, z),
        new THREE.Vector3(x + (r() - 0.5) * 1.2, yy + 0.3 + r() * 0.5, z + (r() - 0.5) * 1.2),
        new THREE.Vector3(x + (r() - 0.5) * 2.4, yy + 0.2 + r() * 0.9, z + (r() - 0.5) * 2.4),
      ], 0.024 * scale, 4, FINE_TILE / Math.max(0.2, scale)));
    }
    const merged = mergeGeos(bars);
    if (merged) {
      if (composing) opts.kit.put(merged, M.rebar, 0, 0, 0);
      else {
        weatherGeo(merged, { strength: M.rebar.userData.weather, tone: r() * 2 - 1, seed: r() * 40, soilH: 0.7 });
        out.push(addStatic(world, new THREE.Mesh(merged, M.rebar), centre, IDENT));
      }
    }
  }
  return composing ? opts.kit : out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Composites — one call, one place                                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A ruined hall: floor, three broken walls with openings, a colonnade with
 * columns in every state from standing to lying in pieces, a doorway arch, a
 * stair, and the rubble all of it shed. The whole thing merges into about
 * half a dozen draw calls.
 *
 * Sizes: 'small' 12×9 m, 'medium' 18×13 m, 'large' 26×18 m.
 */
export function addRuin(world, pos, opts = {}) {
  assertOpts(addRuin, opts);
  const SZ = { small: [12, 9, 4.5], medium: [18, 13, 5.5], large: [26, 18, 7] };
  const [W, D, H] = SZ[opts.size || 'medium'] || SZ.medium;
  const kit = opts.kit || new Kit(opts.seed ?? 2020);
  kit.push(opts.kit ? pos.x : 0, opts.kit ? pos.y : 0, opts.kit ? pos.z : 0, opts.yaw || 0);
  const M = propMaterials();
  const rr = kit.rng;
  const seed = opts.seed ?? 2020;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const stone = opts.mat || M.duracreteWarm;
  const sub = { kit, mat: stone, trimMat: opts.trimMat || M.sandstone };
  /* WHAT A BROKEN FACE SHOWS, and only to the makers that break. `coreMat` was
   * in the bag every sub-maker got, and a floor slab and a stair have no core
   * to show — they dropped it silently, which is the defect this file's option
   * guard exists to refuse. Two bags rather than one is the honest shape: the
   * masonry that can be broken open carries a core colour, the rest does not. */
  const masonry = { ...sub, coreMat: M.duracreteDark };
  // the hall stands on a stylobate, and the stair outside climbs exactly onto
  // it — a building sitting flush on the dirt is the thing that reads as a box
  const steps = 4;
  const podium = ARCH.step.rise * steps;

  addFloorSlab(world, V(0, podium - ARCH.slabT * 0.5, 0), V(W, D),
    { ...sub, ruin: 0.3, cell: 2.2, seed: seed + 1, mat: M.duracrete });
  // back and side walls, each broken to a different height
  addBrokenWall(world, V(0, podium, -D / 2), V(W, H, ARCH.wallT), {
    ...masonry, ruin: 0.42, seed: seed + 2,
    openings: [{ x: -W * 0.26, y: 0.2, w: 1.4, h: 2.6, arched: true }, { x: W * 0.26, y: 1.6, w: 1.6, h: 1.6 }],
  });
  for (const sx of [-1, 1]) {
    addBrokenWall(world, V(sx * W / 2, podium, 0), V(D, H * 0.86, ARCH.wallT), {
      ...masonry, ruin: 0.62 + rr() * 0.2, yaw: Math.PI / 2, seed: seed + 3 + sx,
      openings: [{ x: sx * D * 0.2, y: 0.2, w: 1.3, h: 2.4, arched: rr() < 0.5 }],
    });
  }
  // the front: a doorway arch, and the stair up to it
  const doorW = Math.min(5, W * 0.3);
  addArch(world, V(0, podium, D / 2), {
    ...masonry, span: doorW, springing: H * 0.5, depth: ARCH.wallT * 1.4,
    broken: rr() < 0.5 ? 0.25 : 0, seed: seed + 5, collideArch: false,
  });
  addStair(world, V(0, 0, D / 2 + steps * ARCH.step.run * 0.5), {
    ...sub, steps, width: doorW + 1, yaw: Math.PI, seed: seed + 6,
  });

  // the colonnade — this is what makes it a hall and not a yard
  const cols = Math.max(2, Math.round(W / 5));
  for (let i = 0; i < cols; i++) {
    for (const sz of [-1, 1]) {
      const x = lerp(-W * 0.34, W * 0.34, cols === 1 ? 0.5 : i / (cols - 1));
      const z = sz * D * 0.26;
      const roll = rr();
      if (roll < 0.2) continue;                            // gone entirely
      addColumn(world, V(x, podium, z), {
        ...masonry, size: H > 6 ? 'L' : 'M', height: H * 0.92,
        standing: roll < 0.55 ? 0.3 + rr() * 0.45 : 1, seed: seed + 20 + i * 3 + sz,
      });
      if (roll < 0.42) {                                    // and its drum lying beside it
        const r = (H > 6 ? ARCH.column.L.r : ARCH.column.M.r);
        const len = H * (0.3 + rr() * 0.4);
        const drum = cylGeo(r * 0.92, r, len, 12, 1.2);
        kit.put(drum, stone, x + (rr() - 0.5) * 2.4, podium + r, z + sz * (1.2 + rr()), Math.PI / 2, rr() * TAU, 0);
        kit.collider(x, podium + r, z + sz * 1.4, len / 2, r, r, rr() * TAU);
      }
    }
  }
  // a fallen lintel across the floor
  if (rr() < 0.7) {
    const L = W * 0.28;
    kit.put(extrudeBeveled([[-L / 2, -0.3], [L / 2, -0.26], [L / 2, 0.3], [-L / 2, 0.28]], 0.66,
      { bevel: 0.05, tile: 2.4 }), stone,
      (rr() - 0.5) * W * 0.4, podium + 0.34, (rr() - 0.5) * D * 0.4, 0.1, rr() * TAU, 0.06);
  }
  addDebrisField(world, V(0, 0, 0), {
    kit, radius: Math.max(W, D) * 0.62, seed: seed + 40, density: opts.debris ?? 1,
    mat: stone, chipMat: M.duracreteDark, scale: 1.1,
  });
  if (opts.pipes) {
    addPipeRun(world, [V(-W * 0.4, podium + 1.8, -D / 2 + 0.9), V(0, podium + 2.1, -D / 2 + 0.9), V(W * 0.4, podium + 1.7, -D / 2 + 0.9)],
      { kit, count: 3, radius: 0.11, supports: false, seed: seed + 60 });
  }
  kit.pop();
  if (opts.kit) return kit;
  return kit.emit(world, pos, opts.quaternion || IDENT, opts);
}

/**
 * A working outpost: blast walls, crate stacks under a tarp, scaffolding
 * against a shed, a pipe run, lamps, a mast and signage. Radius 8–16 m.
 * Returns the static stats; the crate stacks add live Props of their own.
 */
export function addOutpost(world, pos, opts = {}) {
  assertOpts(addOutpost, opts);
  const M = propMaterials();
  const R = opts.radius ?? 11;
  const seed = opts.seed ?? 2121;
  const rr = makeRng(seed * 3 + 11);
  const kit = new Kit(seed);
  const yaw = opts.yaw || 0;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  kit.push(0, 0, 0, yaw);

  // a shed: three walls, a lean-to roof
  const sw = R * 0.55, sd = R * 0.42, sh = 3.2;
  kit.slab(M.panel, sw, sh, 0.3, 0, sh / 2, -sd / 2, { tile: 2.4, seg: 3 });
  for (const sx of [-1, 1]) kit.slab(M.panel, 0.3, sh, sd, sx * sw / 2, sh / 2, 0, { tile: 2.4, seg: 3 });
  kit.slab(M.hull, sw * 1.12, 0.18, sd * 1.18, 0, sh + 0.2, 0.1, { tile: ARCH_TILE, seg: 3, rx: -0.09, collide: false });
  for (let i = 0; i < 4; i++) {
    kit.slab(M.rust, sw * 1.1, 0.06, 0.1, 0, sh + 0.3, -sd / 2 + i * sd * 0.32, { tile: 1.0, seg: 2, collide: false });
  }
  addScaffold(world, V(sw * 0.1, 0, sd * 0.62), { kit, width: sw * 0.8, depth: 1.4, lifts: 2, seed: seed + 3 });
  addPipeRun(world, [V(-sw / 2, 2.6, -sd / 2 - 0.4), V(sw * 0.1, 2.9, -sd / 2 - 0.4), V(sw * 0.7, 1.2, -sd * 1.2)],
    { kit, count: 2, radius: 0.1, supports: false, seed: seed + 4 });

  // blast walls in an arc, the way people actually stack cover
  const nW = opts.walls ?? 5;
  for (let i = 0; i < nW; i++) {
    const a = lerp(0.5, 2.5, i / (nW - 1));
    const x = Math.cos(a) * R * 0.92, z = Math.sin(a) * R * 0.92;
    kit.push(x, 0, z, -a + Math.PI / 2);
    const w = 2.6 + rr() * 1.4;
    kit.put(extrudeBeveled([[-w / 2, 0], [w / 2, 0], [w / 2 * 0.72, 2.4], [-w / 2 * 0.72, 2.4]], 0.42,
      { bevel: 0.05, tile: 2.4 }), M.duracrete, 0, 0, 0);
    kit.slab(M.duracreteWarm, w * 1.06, 0.18, 0.62, 0, 2.46, 0, { tile: 1.8, collide: false });
    kit.collider(0, 1.2, 0, w / 2, 1.2, 0.24);
    kit.pop();
  }
  // lamps and a mast
  for (let i = 0; i < 2; i++) {
    const a = 0.9 + i * 1.3;
    addLamp(world, V(Math.cos(a) * R * 0.7, 0, Math.sin(a) * R * 0.7), {
      kit, height: 5.5, light: opts.lights !== false, yaw: -a, seed: seed + 10 + i,
    });
  }
  addAntenna(world, V(-R * 0.62, 0, -R * 0.3), { kit, height: R * 0.95, seed: seed + 20 });
  addSign(world, V(0, 0, sd * 0.6 + 0.3), { kit, width: 2.0, mount: 2.4, seed: seed + 30 });
  addScree(world, V(0, 0, 0), { kit, radius: R * 1.1, inner: R * 0.3, count: Math.round(R * 8), seed: seed + 40, size: 0.15, mat: M.duracreteDark });
  kit.pop();
  const stats = kit.emit(world, pos, opts.quaternion || IDENT, opts);

  // the loose stuff, as live props
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const at = (x, z) => new THREE.Vector3(x, 0, z).applyQuaternion(q).add(pos);
  addCrateStack(world, at(R * 0.22, sd * 0.9), { seed: seed + 50, tiers: 3, columns: 3, yaw: yaw + rr() });
  addCrateStack(world, at(-R * 0.4, sd * 1.3), { seed: seed + 51, tiers: 2, columns: 2, yaw: yaw + rr() });
  addTarp(world, at(-R * 0.4, sd * 1.3 + 0.1), { width: 3.2, depth: 2.6, height: 1.5, seed: seed + 52, quaternion: q });
  for (let i = 0; i < (opts.barrels ?? 5); i++) {
    const a = rr() * TAU, rad = R * (0.35 + rr() * 0.5);
    const p = at(Math.cos(a) * rad, Math.sin(a) * rad);
    p.y = groundY(world, p.x, p.z);          // the ground, not the ground plus a guess
    if (rr() < 0.4) makeBarrel(world, p); else makeCrate(world, p, 0.8);
  }
  return stats;
}
/* ══════════════════════════════════════════════════════════════════════ */
/*  Crowd                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A CROWD, and the only interesting thing about it is the draw-call budget.
 *
 * The brief for the colosseum is "360° crowds", and the number that makes a
 * crowd a crowd rather than a decorated wall is somewhere north of two
 * thousand — measured on the finished tiers, 3,240 figures fill a 60 m bowl at
 * the density of a full house. At one draw call each that is six times the
 * whole level's budget, so the crowd is ONE InstancedMesh and one geometry, in
 * exactly the way `addScree` puts six hundred stones on the ground for one
 * call. `world-immersion` measures the ratio; this is 3240:1.
 *
 * The figure is deliberately crude — a wedge for a seated body and a ball for
 * a head, 96 triangles — and that is not a saving, it is the right drawing. At
 * 40 to 90 m a spectator is between four and nine pixels tall, so what carries
 * is the SILHOUETTE and the COLOUR, and per-instance colour is free: the
 * material reads `instanceColor`, so three thousand figures in six garment
 * families cost nothing over three thousand figures in one. Rule 6 of the art
 * direction — texture is drawn, not shaded — is why the variation is in flat
 * per-figure tone rather than in a noise field on the material.
 *
 * MOTION: a crowd that does not move is a terracotta army, and animating
 * three thousand instance matrices every frame costs 3,240 matrix composes and
 * a full 51 KB buffer upload at 60 Hz. So it is a ROLLING update — `stride`
 * figures a frame, cycling through the whole crowd about twice a second — and
 * what it writes is a small vertical bob and lean on a per-figure phase, plus
 * a travelling wave whose crest sweeps the bowl. At 240 a frame that is 7% of
 * the buffer touched per frame, which the driver uploads as one partial range,
 * and the eye cannot tell it from every figure moving because every figure IS
 * moving — just not on this frame.
 */
class Crowd {
  constructor(world, mesh, seats, opts = {}) {
    this.id = 'crowd' + (_propId++);
    this.world = world;
    this.mesh = mesh;
    this.seats = seats;                 // Float32Array, 6 per seat: x y z yaw scale phase
    this.n = seats.length / 6;
    this.time = 0;
    this.cursor = 0;
    this.stride = opts.stride ?? 240;
    this.excite = opts.excite ?? 1;
    this.dead = false;
    this.kind = 'crowd';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;
    /* The duck-typed prop's body, exactly as `DestructionProxy` does it: this
     * rides in `world.props` so that it gets a per-frame `update` without a
     * line of World.js changing. `capsules()` returns nothing, so the blade
     * solver never offers it a contact and nothing here can be cut — a
     * spectator sixty metres up a bank is scenery, and making three thousand of
     * them cuttable would put three thousand capsules in the solver's list. */
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  update(dt) {
    if (!(dt > 0) || !this.mesh) return;
    this.time += dt;
    const S = this.seats, n = this.n;
    const end = Math.min(this.cursor + this.stride, n);
    for (let i = this.cursor; i < end; i++) {
      const k = i * 6;
      const phase = S[k + 5];
      /* Two motions, and they do different jobs. The per-figure bob at 1.9 Hz
       * is what makes a still frame read as a crowd rather than as a pattern;
       * the travelling wave — one crest going round the bowl every eleven
       * seconds — is what makes a MOVING frame read as a crowd, because a
       * field of independent oscillators averages out to noise at range and a
       * coherent wave does not. */
      const wave = Math.sin(this.time * 0.56 - phase * 2.0);
      const lift = (Math.sin(this.time * 1.9 + phase * 7.3) * 0.045
        + Math.max(0, wave) * 0.30 * this.excite) * S[k + 4];
      const lean = Math.sin(this.time * 1.3 + phase * 4.1) * 0.06;
      this._p.set(S[k], S[k + 1] + lift, S[k + 2]);
      this._q.setFromEuler(_ke.set(lean, S[k + 3], lean * 0.5));
      this._s.setScalar(S[k + 4]);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.cursor = end >= n ? 0 : end;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.world.scene.remove(this.mesh);
    /* TRAVERSE, because a prop's mesh is not always a Mesh.
     *
     * This was `this.mesh.geometry.dispose()`, which throws outright on a prop
     * built as a Group — a dropped lightsaber hilt is nineteen to thirty-six
     * separate pieces — and silently leaks the children of every group-shaped
     * prop that ever passed through here. One line, and it now disposes what it
     * removes whatever shape it is.
     */
    this.mesh.traverse?.((o) => { o.geometry?.dispose?.(); }) ?? this.mesh.geometry?.dispose?.();
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
}

/**
 * Seat a crowd on tiers around an oval.
 *
 * `rows` bands of seating between `rmin` and `rmax`, each row lifted by `rise`
 * per row, every figure facing the middle. `aspect` squashes the ring into the
 * oval a real amphitheatre is.
 *
 * `gaps` are angular spans, in radians as [from, to] pairs, that stay empty —
 * the gates the fight walks out of, and the lords' box, which has its own
 * occupants and does not want a crowd sitting on top of them.
 */
export function addCrowd(world, centre, opts = {}) {
  assertOpts(addCrowd, opts);
  const rng2 = makeRng(opts.seed ?? 5150);
  const rows = opts.rows ?? 18;
  const rmin = opts.rmin ?? 58, rmax = opts.rmax ?? 96;
  const rise = opts.rise ?? 1.35;
  const y0 = opts.y0 ?? 2.0;
  const aspect = opts.aspect ?? 1.0;
  const gaps = opts.gaps || [];
  const fill = clamp(opts.fill ?? 0.88, 0, 1);
  const pitch = opts.pitch ?? 1.15;              // metres of bench per figure
  /* A multiplier on every figure. It exists for one caller — the lords in the
   * box — and it is the whole of what tells them apart from the house: from
   * the sand, at ninety metres, a figure is four pixels tall and NOTHING about
   * a costume survives that. Scale does. */
  const size = opts.scale ?? 1;

  /* THE SEATED BODY, built once and shared by every variant. A seated body is
   * a wedge — shoulders back, knees forward — because a box reads as a box and
   * a wedge reads as somebody leaning.
   *
   * THE KNEES ARE NOT DECORATION. A seated person occupies about 0.5 m of
   * bench and 0.8 m of depth, and the depth is all legs — so a figure built as
   * a torso alone is 0.48 × 0.46 in plan, which is a 0.24 m footprint. That
   * matters because `world-immersion`'s barrenness survey only counts an
   * object with a silhouette of 0.35 m or more, and without the legs a bank
   * with three thousand people sitting on it measured as bare ground: 34% of
   * the level's walkable area with "nothing within twelve metres" on it. With
   * them the plan is 0.48 × 0.79 and a spectator is what a spectator is. */
  const body = () => {
    const bodyG = extrudeBeveled([[-0.21, -0.42], [0.21, -0.42], [0.24, 0.30], [-0.24, 0.30]],
      0.46, { bevel: 0.05, tile: FINE_TILE });
    bodyG.translate(0, 0.42, -0.04);
    const thighG = plateGeo(0.40, 0.20, 0.44, 0.05, 1);
    thighG.translate(0, 0.30, 0.30);
    const shinG = plateGeo(0.36, 0.34, 0.20, 0.05, 1);
    shinG.translate(0, 0.12, 0.46);
    return [bodyG, thighG, shinG];
  };

  /**
   * FIVE HEADS AND FIVE SETS OF SHOULDERS, and this is the whole of note #16's
   * second half.
   *
   * "I like the colosseum map just increase the detail for the crowd — right
   *  now it looks okay in the distance but anytime you're near the edge you see
   *  how crude they are, make them either alien species or mixes of aliens."
   *
   * The diagnosis was exact and it was in the handoff before it was in the
   * code: this maker built ONE figure — a wedge and a 6×5 sphere — and
   * instanced it three thousand times, so variation was scale, garment colour
   * and animation phase only. At ninety metres that is a crowd; at the rail it
   * is the same person three thousand times, and no amount of colour fixes a
   * repeated SILHOUETTE.
   *
   * The references (`colosseum/detailed arena view.webp`,
   * `arena from above with crowd.jpeg`, `units/creatures/Geonosian*.png`) all
   * say the same thing about the near tier: what reads is the PROFILE against
   * the sky — a domed crest swept back, a pair of horns, antennae, a hooded
   * bulk with no neck. So there are five of them, and the head is where the
   * variety is spent because the head is the only part of a seated figure whose
   * outline is not hidden by the row in front.
   *
   * IT COSTS FOUR EXTRA DRAW CALLS. A variant is a separate InstancedMesh, and
   * the seats are partitioned across them — see `variants` below. On a level
   * already spending 167 calls, four is under 3% and it is the cheapest
   * possible way to buy a silhouette that is not a repeat.
   */
  const HEADS = [
    // 0 — BALD. The baseline, and still the commonest: a crowd where everybody
    // is exotic has no ordinary to be exotic against.
    () => {
      const g = new THREE.SphereGeometry(0.115, 6, 5);
      g.translate(0, 0.90, 0.02);
      scaleUv(g, uvm(0.6));
      const sh = plateGeo(0.44, 0.16, 0.30, 0.05, 1);
      sh.translate(0, 0.70, -0.02);
      return [g, sh];
    },
    // 1 — CRESTED. A domed skull swept back and up over the shoulders. The
    // single most recognisable alien profile in the reference plate, and the
    // one that reads furthest because it breaks the round-head silhouette in
    // the vertical.
    () => {
      const g = new THREE.SphereGeometry(0.105, 6, 5);
      g.scale(1.0, 1.35, 1.15);
      g.translate(0, 0.93, 0.01);
      scaleUv(g, uvm(0.6));
      const crest = new THREE.SphereGeometry(0.085, 5, 4);
      crest.scale(0.55, 1.05, 1.9);
      crest.translate(0, 1.02, -0.10);
      scaleUv(crest, uvm(0.5));
      const sh = plateGeo(0.42, 0.15, 0.28, 0.05, 1);
      sh.translate(0, 0.70, -0.02);
      return [g, crest, sh];
    },
    // 2 — HORNED. Two tapered horns curving up and out of a heavier skull.
    () => {
      const g = new THREE.SphereGeometry(0.125, 6, 5);
      g.scale(1.05, 0.92, 1.0);
      g.translate(0, 0.885, 0.02);
      scaleUv(g, uvm(0.6));
      const parts = [g];
      for (const sx of [-1, 1]) {
        const h = cylGeo(0.012, 0.042, 0.19, 5, 0.5);
        h.rotateZ(sx * 0.55);
        h.translate(sx * 0.085, 1.00, 0.0);
        parts.push(h);
      }
      const sh = plateGeo(0.50, 0.18, 0.32, 0.05, 1);
      sh.translate(0, 0.69, -0.02);
      parts.push(sh);
      return parts;
    },
    // 3 — ANTENNAED. A narrow head with two thin stalks. Almost nothing in
    // triangles and it changes the whole profile, which is the point.
    () => {
      const g = new THREE.SphereGeometry(0.100, 6, 5);
      g.scale(0.9, 1.15, 1.0);
      g.translate(0, 0.90, 0.02);
      scaleUv(g, uvm(0.6));
      const parts = [g];
      for (const sx of [-1, 1]) {
        const a = cylGeo(0.008, 0.014, 0.24, 4, 0.4);
        a.rotateZ(sx * 0.30);
        a.translate(sx * 0.055, 1.09, -0.01);
        parts.push(a);
      }
      const sh = plateGeo(0.38, 0.14, 0.26, 0.05, 1);
      sh.translate(0, 0.71, -0.02);
      parts.push(sh);
      return parts;
    },
    // 4 — HOODED. No neck and no visible skull: a cowl running straight off a
    // heavy set of shoulders, which is the bulk in the reference's middle rows.
    () => {
      const g = cylGeo(0.075, 0.185, 0.28, 6, 0.6);
      g.translate(0, 0.86, 0.0);
      const sh = plateGeo(0.56, 0.20, 0.36, 0.05, 1);
      sh.translate(0, 0.68, -0.02);
      return [g, sh];
    },
  ];
  /* HOW MANY OF THEM THIS CALL WANTS. One by default, because most callers of
   * this maker are not a thirty-thousand-seat house — the lords' box is
   * sixteen figures and the Temple's crèche is a class of younglings, and a
   * variant mesh with nine instances in it is a draw call for nothing. */
  const nVar = clamp(Math.round(opts.variants ?? 1), 1, HEADS.length);
  const geos = [];
  for (let v = 0; v < nVar; v++) geos.push(mergeGeos([...body(), ...HEADS[v]()]));

  /* The material reads vertex colour AND instance colour, so the garment
   * families are free. Held ROUGH and matte: rule 8 — nothing is shiny — and a
   * specular lobe on three thousand heads is a field of sparkle. */
  const mat = readsVertexColour(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.96, metalness: 0.0,
  }));
  mat.userData.weather = 0;

  /* SIX GARMENT FAMILIES, and no more. Rule 5 of the art direction is one hue
   * family plus an accent; a crowd painted from a continuous random hue is the
   * single fastest way to put six competing hues in a frame. These are one
   * ochre-to-umber family with a single cool note and one saturated accent
   * that appears in about a twentieth of the seats — which reads, from the
   * floor, as banners and finery scattered through a drab house. */
  const FAMILY = opts.palette || [0x6b5a44, 0x7d6a4e, 0x574a3a, 0x8a7358, 0x4a4a52, 0xa8452a];
  const WEIGHT = [0.26, 0.24, 0.20, 0.16, 0.09, 0.05];
  const fam = FAMILY.map((h) => new THREE.Color(h));

  const inGap = (a) => gaps.some(([f, t]) => {
    const d = ((a - f) % TAU + TAU) % TAU;
    return d <= ((t - f) % TAU + TAU) % TAU;
  });

  /* SEATED ON THE GROUND, not on a ladder of numbers.
   *
   * The first version stacked the rows at `y0 + r·rise` in absolute world
   * space, which is a second, independent model of a landform the terrain
   * already has — and the two disagreed. Measured by `prop-seating.mjs`: 246
   * of the bowl's figures stood on nothing, the worst of them 5.47 m in the
   * air, because the cavea's seating courses are quantised by `strata` and a
   * straight ladder cannot follow that.
   *
   * So the row PITCH is still the level's, because that is the thing an author
   * is choosing, and the HEIGHT is asked of the heightfield. `rise` survives
   * as the fallback for a caller with no terrain under it — the lords in the
   * box are seated on a prop, not on the ground.
   */
  const T = world.terrain;
  /* One bucket per variant. The seats are partitioned rather than shuffled
   * because an InstancedMesh draws ONE geometry: which figure a spectator is
   * decides which mesh they live in, and nothing else about them changes. */
  const seats = [], colors = [];
  for (let v = 0; v < nVar; v++) { seats.push([]); colors.push([]); }
  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0 : r / (rows - 1);
    const rad = lerp(rmin, rmax, t);
    const y = y0 + r * rise;
    // one figure per `pitch` of bench, so the outer rows genuinely hold more
    const count = Math.max(8, Math.round((TAU * rad * (0.5 + 0.5 * aspect)) / pitch));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + (r % 2) * (Math.PI / count);
      if (inGap(a)) continue;
      if (rng2() > fill) continue;                 // the empty seats
      const x = centre.x + Math.cos(a) * rad;
      const z = centre.z + Math.sin(a) * rad * aspect;
      // a little shuffle along the bench, so the rows are not a comb
      const jx = (rng2() - 0.5) * 0.34, jz = (rng2() - 0.5) * 0.34;
      const gy = opts.onGround === false || !T ? y
        : T.height(x + jx, z + jz) + (opts.sit ?? 0.05);
      /* WHICH SPECIES. Drawn from the stream like everything else about a
       * seat, and BIASED TOWARD THE RAIL: the near third of the bank takes
       * all five, the back rows take the two cheapest. That is not thrift —
       * it is the note's own observation ("it looks okay in the distance but
       * anytime you're near the edge you see how crude they are"). At sixty
       * metres a horn is under a pixel and a crest is under two; what carries
       * up there is the speckle, and what carries at the rail is the profile.
       * Spending the variety where it can be seen is the whole trade. */
      const pool = t < 0.34 ? nVar : Math.max(1, Math.min(nVar, 2));
      const v = Math.min(nVar - 1, (rng2() * pool) | 0);
      seats[v].push(x + jx, gy, z + jz, -a + Math.PI / 2 + (rng2() - 0.5) * 0.5,
        (0.92 + rng2() * 0.22) * size, rng2() * TAU + a);
      let pick = rng2(), k = 0, acc = 0;
      while (k < WEIGHT.length - 1 && (acc += WEIGHT[k]) < pick) k++;
      colors[v].push(fam[k]);
    }
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  let first = null;
  for (let v = 0; v < nVar; v++) {
    const n = seats[v].length / 6;
    if (!n) continue;
    const im = new THREE.InstancedMesh(geos[v], mat, n);
    for (let i = 0; i < n; i++) {
      const k = i * 6;
      p.set(seats[v][k], seats[v][k + 1], seats[v][k + 2]);
      q.setFromAxisAngle(UP, seats[v][k + 3]);
      s.setScalar(seats[v][k + 4]);
      im.setMatrixAt(i, m.compose(p, q, s));
      im.setColorAt(i, colors[v][i]);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    /* NO SHADOWS FROM THE CROWD. Three thousand casters in a shadow map that is
     * sized for a fight on the floor buys nothing — every one of them is a
     * four-pixel figure on a bank that is already in its own shade — and it
     * costs the whole crowd a second pass. They RECEIVE, so the bowl's own
     * shadow falls across them, which is the half that reads. */
    im.castShadow = false;
    im.receiveShadow = true;
    im.name = 'crowd';
    im.frustumCulled = true;
    im.computeBoundingSphere?.();
    world.scene.add(im);
    world.statics.push(im);

    /* The animation budget is the WHOLE crowd's, not each variant's: `stride`
     * is how many figures are re-posed per frame, and five buckets each doing
     * 240 would be five times the per-frame cost of the crowd this replaces.
     * Divided, so a five-species house animates at exactly the price the
     * one-species house did. */
    const crowd = new Crowd(world, im, new Float32Array(seats[v]),
      { ...opts, stride: Math.max(16, Math.round((opts.stride ?? 240) / nVar)) });
    if (world.addProp) world.addProp(crowd);
    else if (world.props) world.props.push(crowd);
    if (!first) first = crowd;
  }
  return first;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Storm                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * LIGHTNING, and the two things that make it read as lightning rather than as
 * a screen flash.
 *
 * IT COMES FROM SOMEWHERE. A full-screen white frame is a camera artefact; a
 * strike is a light with a POSITION, and everything standing between the
 * player and it goes to a hard-edged silhouette for two frames. So a strike is
 * a directional light placed on a bearing, at an elevation, with the level's
 * own key briefly replaced — which is what puts the cast shadow of a railing
 * across a wet deck in a direction it has never been in before.
 *
 * AND THE THUNDER IS LATE. Sound travels 343 m/s, so a strike two kilometres
 * out is heard six seconds after it is seen, and that delay is most of what
 * makes a storm feel like it is happening to a landscape rather than to a
 * camera. The distance is drawn per strike and the delay derived from it.
 *
 * It rides in `world.props` for a per-frame tick, exactly as `Crowd` and the
 * destruction proxy do, and it publishes nothing the blade can touch.
 */
class Storm {
  constructor(world, opts = {}) {
    this.id = 'storm' + (_propId++);
    this.world = world;
    this.dead = false;
    this.kind = 'storm';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;
    this.rng = makeRng(opts.seed ?? 8801);
    /** Mean seconds between strikes, and how much that varies. */
    this.period = opts.period ?? 9;
    this.jitter = opts.jitter ?? 0.7;
    this.color = new THREE.Color(opts.color ?? 0xdfe8ff);
    this.intensity = opts.intensity ?? 26;
    /** How far out the storm is, in metres — thunder is derived from it. */
    this.range = opts.range ?? [700, 3400];
    this.next = 1.5 + this.rng() * this.period;
    this.time = 0;
    /** Strikes in flight: [t, dur] pairs on the one light. */
    this.flash = 0;
    this.flashFor = 0;
    this.pending = [];
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;

    /* ONE light, reused. It is a DirectionalLight rather than a point light
     * because a strike two kilometres away is a parallel source, and because a
     * point light at that distance needs an intensity that overflows the
     * tone curve before it reaches the deck. It casts nothing: the level's own
     * key owns the shadow map, and a second caster would cost a whole extra
     * pass for two frames of use. */
    this.light = new THREE.DirectionalLight(this.color, 0);
    this.light.castShadow = false;
    world.scene.add(this.light);
    world.levelLights?.push(this.light);
  }

  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  strike() {
    const r = this.rng;
    const a = r() * TAU;
    const el = 0.35 + r() * 0.5;                 // 20-49° above the horizon
    const d = lerp(this.range[0], this.range[1], r() * r());
    this.light.position.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el))
      .multiplyScalar(400);
    /* A near strike is brighter, and it is brighter by the inverse square of
     * how far out it is rather than by a random draw: the reason a storm reads
     * as having WEATHER in it is that the strikes are at different distances,
     * and every other cue for that follows from this one number. */
    const k = clamp(Math.pow(this.range[0] / d, 1.4), 0.18, 1);
    this.flash = this.intensity * k;
    /* Two frames of full brightness and then a fast decay — 0.16 s, which is
     * about the persistence of a real return stroke and is long enough for the
     * eye to catch the silhouette it drew. */
    this.flashFor = 0.16 + r() * 0.10;
    this.world.engine?.flash?.(0.25 * k);
    // and the thunder, at 343 m/s
    this.pending.push({ t: d / 343, k });
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = this.period * (1 - this.jitter + this.rng() * this.jitter * 2);
      this.strike();
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - (this.intensity / this.flashFor) * dt);
      this.light.intensity = this.flash;
    } else if (this.light.intensity !== 0) this.light.intensity = 0;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      const at = this.world.player?.position;
      if (at) audio.explosion(at, 0.7 + p.k * 1.6);
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.world.scene.remove(this.light);
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
}

/** Put a storm over the level. */
export function addStorm(world, opts = {}) {
  assertOpts(addStorm, opts);
  const s = new Storm(world, opts);
  if (world.addProp) world.addProp(s);
  else if (world.props) world.props.push(s);
  return s;
}
