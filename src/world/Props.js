/**
 * SABER — props, architecture and the blast door.
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
import { sliceGeometry, recenterGeometry, spheresForGeometry } from './Slice.js';
import { metalMaps, duracreteMaps, rockMaps, armorMaps, clothMaps } from '../engine/Textures.js';
import { plateGeo, limbGeo } from '../game/Bodies.js';
import { makeCapMaterial } from '../game/Ragdoll.js';
import { TOUGHNESS } from '../game/Combat.js';
import { clamp, lerp, makeRng, fbm2, noise2, TAU } from '../engine/MathUtil.js';

const rng = makeRng(9091);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
// kit-only scratch: the builders nest, so they may not share the above
const _km = new THREE.Matrix4(), _ke = new THREE.Euler(), _kq = new THREE.Quaternion();
const _kv = new THREE.Vector3();
const IDENT = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

let _propId = 1;

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

let MATS = null;
export function propMaterials() {
  if (MATS) return MATS;
  const metal = metalMaps(2);
  const crete = duracreteMaps(2);
  const rock = rockMaps(2);
  const armor = armorMaps(2);
  const mk = (maps, color, rough, metalness) => new THREE.MeshStandardMaterial({
    color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness,
  });
  const cloth = clothMaps(2);
  MATS = {
    crate: mk(metal, lit(0.86, 0.68, 0.40), 0.62, 0.35),        // olive drab
    crateDark: mk(metal, lit(0.41, 0.37, 0.29), 0.55, 0.7),
    barrel: mk(metal, lit(0.96, 0.49, 0.22), 0.5, 0.75),        // oxide red
    duracrete: mk(crete, lit(0.90, 0.79, 0.62), 0.94, 0.02),
    stone: mk(rock, lit(1.90, 2.10, 2.20), 0.92, 0.02),
    steel: mk(metal, lit(1.50, 1.42, 1.30), 0.34, 0.98),
    darkSteel: mk(metal, lit(0.64, 0.60, 0.56), 0.42, 0.95),
    hull: mk(armor, lit(0.63, 0.68, 0.76), 0.42, 0.85),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.32 }),
    emissive: new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0x60d8ff, emissiveIntensity: 2.2,
      roughness: 0.4, metalness: 0.3 }),
    wood: mk(crete, lit(0.49, 0.32, 0.17), 0.88, 0.02),

    /* ── the environment vocabulary ───────────────────────────────────
     * A place needs more than one grey. Facing stone, its shadowed core,
     * the rust that runs out of every fixing, and the paint somebody put on
     * it before the war are four different materials to the eye even when
     * they share one baked map. */
    duracreteWarm: mk(crete, lit(1.12, 0.94, 0.68), 0.93, 0.02),  // sun-bleached facing
    duracreteDark: mk(crete, lit(0.40, 0.37, 0.34), 0.96, 0.02),  // wall core, undersides
    sandstone: mk(rock, lit(2.70, 2.40, 1.70), 0.95, 0.0),        // carved stone, plinths
    stoneDark: mk(rock, lit(0.95, 1.10, 1.25), 0.94, 0.02),       // shadowed masonry
    strata: null,                                                 // filled in below
    rust: mk(metal, lit(0.51, 0.26, 0.12), 0.88, 0.55),
    rebar: mk(metal, lit(0.45, 0.26, 0.15), 0.8, 0.72),
    bronze: mk(metal, lit(1.97, 1.29, 0.49), 0.44, 0.95),
    patina: mk(metal, lit(0.70, 1.00, 0.68), 0.74, 0.3),
    paint: mk(armor, lit(0.36, 0.14, 0.11), 0.6, 0.35),           // faded hull paint
    paintPale: mk(armor, lit(0.69, 0.68, 0.61), 0.62, 0.3),
    panel: mk(armor, lit(0.36, 0.40, 0.47), 0.46, 0.85),
    grating: mk(metal, lit(0.32, 0.29, 0.27), 0.66, 0.9),
    tarp: new THREE.MeshStandardMaterial({
      color: lit(0.42, 0.33, 0.19), map: cloth.map, normalMap: cloth.normalMap, roughnessMap: cloth.roughnessMap,
      roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
    tarpBlue: new THREE.MeshStandardMaterial({
      color: lit(0.15, 0.20, 0.28), map: cloth.map, normalMap: cloth.normalMap, roughnessMap: cloth.roughnessMap,
      roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
    cable: new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.86, metalness: 0.1 }),
    glowAmber: new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffa838, emissiveIntensity: 2.6, roughness: 0.5 }),
    glowRed: new THREE.MeshStandardMaterial({ color: 0x180808, emissive: 0xff3418, emissiveIntensity: 2.4, roughness: 0.5 }),
    glowCold: new THREE.MeshStandardMaterial({ color: 0x0d1218, emissive: 0xbcd8ff, emissiveIntensity: 3.0, roughness: 0.4 }),
  };
  // Sedimentary banding is painted into the vertices: it survives distance,
  // survives fog, and costs nothing. The map only supplies the grain, and the
  // vertex colour carries the whole brightness budget (see STRATA).
  MATS.strata = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: rock.map, normalMap: rock.normalMap, roughnessMap: rock.roughnessMap,
    roughness: 0.95, metalness: 0.0, vertexColors: true,
  });
  return MATS;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Geometry plumbing — texel density, merging, bevelled extrusion        */
/* ══════════════════════════════════════════════════════════════════════ */

/** Every shared map in propMaterials() is built at repeat 2 across 0..1. */
const TEX_REPEAT = 2;

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

/** A tube swept along world-space points — cables, conduit, guy wires. */
export function tubeAlong(points, radius, radial = 6, tile = 1.2) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const len = curve.getLength();
  const seg = clamp(Math.round(len * 2.2), 6, 96);
  const g = new THREE.TubeGeometry(curve, seg, radius, radial, false);
  return tubeUv(g, TAU * radius, len, tile);
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
export function brokenEdge(x0, x1, yLow, yHigh, r, steps = 9) {
  const pts = [];
  let y = lerp(yLow, yHigh, 0.55 + r() * 0.4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(x0, x1, t);
    y = clamp(y + (r() - 0.5) * (yHigh - yLow) * 0.5, yLow, yHigh);
    if (r() < 0.22) y = lerp(yLow, y, 0.35);          // a course has fallen away
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
const STRATA = [[2.9, 2.3, 1.6], [3.4, 3.0, 2.3], [2.2, 1.9, 1.6],
                [3.1, 2.5, 1.7], [1.9, 1.8, 1.7], [3.6, 3.3, 2.7]];
export function strataTint(y, seed = 0, scale = 1.1, out = [1, 1, 1]) {
  const wob = noise2(y * 0.7 + seed, seed * 0.37) * 0.35;
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
    this.rng = makeRng(seed);
    this.tris = 0;
    this._pm = new THREE.Matrix4();
    this._yaw = 0;
    this._placed = false;
    this._stack = [];
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

  /** Bin a geometry that is already in this frame's local coordinates. */
  add(geo, mat) {
    if (!geo) return geo;
    if (this._placed) geo.applyMatrix4(this._pm);
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
   * Merge, place and register. Returns { meshes, triangles, draws } so a
   * level (or a measuring script) can see what it just paid for.
   */
  emit(world, position, quaternion = new THREE.Quaternion(), opts = {}) {
    const meshes = [];
    let triangles = 0;
    for (const [mat, geos] of this.bins) {
      const geo = mergeGeos(geos);
      if (!geo) continue;
      triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const mesh = new THREE.Mesh(geo, mat);
      addStatic(world, mesh, position, quaternion);
      if (opts.receiveShadow === false) mesh.receiveShadow = false;
      if (opts.castShadow === false) mesh.castShadow = false;
      meshes.push(mesh);
    }
    this.bins.clear();
    if (opts.collide !== false) {
      for (const b of this.boxes) {
        const c = b.c.clone().applyQuaternion(quaternion).add(position);
        world.physics.addStaticBox(c, b.he, quaternion.clone().multiply(b.q), { friction: b.friction });
      }
    }
    this.boxes.length = 0;
    for (const l of this.lights) {
      const light = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
      light.position.copy(l.p).applyQuaternion(quaternion).add(position);
      world.scene.add(light);
      world.levelLights?.push(light);
    }
    this.lights.length = 0;
    this.tris += triangles;
    return { meshes, triangles, draws: meshes.length };
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
    world.scene.add(this.mesh);

    // The collider is the real shape: whatever the factory declared, or failing
    // that a convex hull of the mesh the player is actually looking at. The
    // sphere set is now only the proxy the BLADE solver walks — it decides
    // where a cut lands, not how the prop behaves when it falls over.
    const spheres = opts.spheres || spheresForGeometry(this.mesh.geometry, 8);
    const shape = opts.shape || hullFromGeometry(this.mesh.geometry);
    this.body = new Body({
      position: opts.position, quaternion: opts.quaternion,
      spheres, shape, mass: opts.mass ?? 24,
      friction: opts.friction ?? 0.72, restitution: opts.restitution ?? 0.08,
      layer: LAYER.PROP,
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER,
      linearDamping: 0.05, angularDamping: 0.1,
    });
    this.body.userData.prop = this;
    world.physics.add(this.body);
    this._syncMesh();
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
    if (this.explosive && this.world.onExplosion) {
      this.world.onExplosion(centre, 1.35);
    } else if (this.world.particles) {
      this.world.particles.sparkBurst(centre, null, 16, { speed: 7 });
      this.world.particles.smoke.spawn(centre, _v1.set(0, 1.2, 0), { life: 1.4, size: 0.6, drag: 1.6, gravity: -1, color: 0x4a4a4e, alpha: 0.4 });
    }
    const n = this.generation >= 1 ? 3 : 6;
    const geo = this.mesh.geometry;
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
    if (disposeGeo) this.mesh.geometry.dispose();
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
  const M = propMaterials();
  const s = size * (0.85 + rng() * 0.35);
  const h = s * 0.9;
  // the body carries a shallow recessed panel on each face, modelled in, so
  // the silhouette is not a rectangle from any angle
  const body = [slabGeo(s, h, s, { bevel: s * 0.07, seg: 3, tile: 0.55 })];
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const g = slabGeo(ax ? s * 0.06 : s * 0.62, h * 0.6, az ? s * 0.06 : s * 0.62,
      { bevel: s * 0.02, seg: 2, tile: 0.4 });
    g.translate(ax * s * 0.5, 0, az * s * 0.5);
    body.push(g);
  }
  const geo = mergeGeos(body);
  const mesh = new THREE.Mesh(geo, rng() < 0.35 ? M.crateDark : M.crate);
  const trim = [];
  for (const sy of [1, -1]) {
    const band = slabGeo(s * 1.03, h * 0.09, s * 1.03, { bevel: s * 0.018, seg: 2, tile: 0.35 });
    band.translate(0, sy * h * 0.33, 0);
    trim.push(band);
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = slabGeo(s * 0.16, h * 1.01, s * 0.16, { bevel: s * 0.02, seg: 2, tile: 0.3 });
    c.translate(sx * s * 0.45, 0, sz * s * 0.45);
    trim.push(c);
  }
  const latch = slabGeo(s * 0.2, h * 0.16, s * 0.06, { bevel: s * 0.015, seg: 2, tile: 0.25 });
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
  const M = propMaterials();
  const r = 0.32, h = 0.92;
  // a real drum bulges at the belly and rolls in at the chimes
  const geo = revolveGeo([
    [0, -h / 2], [r * 0.72, -h / 2], [r * 0.86, -h / 2 + 0.03], [r * 0.93, -h / 2 + 0.09],
    [r, -h * 0.16], [r, h * 0.16], [r * 0.93, h / 2 - 0.09], [r * 0.86, h / 2 - 0.03],
    [r * 0.72, h / 2], [0, h / 2],
  ], { seg: 16, tile: 0.7 });
  const mesh = new THREE.Mesh(geo, M.barrel);
  const trim = [];
  for (const y of [-0.26, 0.26]) {
    const ring = cylGeo(r * 1.05, r * 1.05, 0.055, 16, 1.2);
    ring.translate(0, y, 0);
    trim.push(ring);
  }
  const bung = cylGeo(0.055, 0.06, 0.035, 8, 1.2);
  bung.translate(r * 0.42, h / 2 + 0.005, 0);
  trim.push(bung);
  mesh.add(new THREE.Mesh(mergeGeos(trim), M.darkSteel));
  const hazard = new THREE.Mesh(cylGeo(r * 1.015, r * 1.015, 0.16, 16, 1.2, true),
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
  const ech = new THREE.LatheGeometry([
    new THREE.Vector2(r * 0.88, 0), new THREE.Vector2(r * 1.1, 0.12), new THREE.Vector2(r * 1.22, 0.25),
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
  const M = propMaterials();
  const geo = revolveGeo([
    [0, -1.2], [0.24, -1.2], [0.24, -1.1], [0.19, -1.02], [0.185, -0.2], [0.2, -0.1],
    [0.2, 0.5], [0.17, 0.6], [0.17, 1.0], [0.22, 1.06], [0.22, 1.12],
  ], { seg: 14, folds: 10, foldDepth: 0.06, tile: 1.0 });
  const mesh = new THREE.Mesh(geo, M.steel);
  const dark = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = slabGeo(0.075, 1.45, 0.46, { bevel: 0.02, seg: 3, tile: 0.8 });
    fin.applyMatrix4(_km.makeRotationY(a));
    fin.translate(Math.sin(a) * 0.3, 0.55, Math.cos(a) * 0.3);
    dark.push(fin);
    const stay = pipeBetween(new THREE.Vector3(Math.sin(a) * 0.19, -0.3, Math.cos(a) * 0.19),
      new THREE.Vector3(Math.sin(a) * 0.42, 0.05, Math.cos(a) * 0.42), 0.018, 4);
    dark.push(stay);
  }
  const panel = slabGeo(0.24, 0.36, 0.05, { bevel: 0.015, seg: 2, tile: 0.4 });
  panel.translate(0, -0.55, 0.2); dark.push(panel);
  mesh.add(new THREE.Mesh(mergeGeos(dark), M.darkSteel));
  const head = revolveGeo([
    [0, 1.12], [0.16, 1.14], [0.29, 1.24], [0.31, 1.4], [0.22, 1.52], [0.09, 1.57], [0, 1.58],
  ], { seg: 14, tile: 0.9 });
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
export function makeSpire(world, pos, height = 6, opts = {}) {
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
  const mesh = new THREE.Mesh(geo, M.stone);
  return new Prop(world, {
    kind: 'spire', mesh, position: pos, mass: 500,
    toughness: TOUGHNESS.armour, hp: 200, grippable: false,
    spheres: capsuleSpheres(height / 2 - 0.6, 0.55, 'y', 4),
    // no `shape`: the Prop falls back to a convex hull of this exact bent,
    // wasp-waisted lathe — which is the whole reason for the migration
    ...opts,
  });
}

/**
 * A field console: a raked desk on a plinth with a screen, a keypad and a
 * cable run into the floor. 1.1 m across.
 */
export function makeConsole(world, pos, opts = {}) {
  const M = propMaterials();
  const parts = [slabGeo(1.1, 0.62, 0.6, { bevel: 0.05, seg: 3, tile: 0.9 })];
  const desk = extrudeBeveled([[-0.55, -0.05], [0.55, -0.05], [0.55, 0.16], [-0.55, 0.3]], 0.62,
    { bevel: 0.035, tile: 0.8 });
  desk.rotateY(Math.PI / 2);
  desk.translate(0, 0.38, 0);
  parts.push(desk);
  for (const sx of [-1, 1]) {
    const foot = slabGeo(0.14, 0.12, 0.66, { bevel: 0.03, seg: 2, tile: 0.4 });
    foot.translate(sx * 0.46, -0.36, 0);
    parts.push(foot);
  }
  const hood = slabGeo(1.06, 0.34, 0.1, { bevel: 0.03, seg: 3, tile: 0.7 });
  hood.applyMatrix4(_km.makeRotationX(-0.34));
  hood.translate(0, 0.56, -0.16);
  parts.push(hood);
  const mesh = new THREE.Mesh(mergeGeos(parts), M.hull);
  const screen = new THREE.Mesh(slabGeo(0.78, 0.3, 0.04, { bevel: 0.012, seg: 2, tile: 0.5 }), M.emissive);
  screen.position.set(0, 0.46, 0.14); screen.rotation.x = -0.42;
  mesh.add(screen);
  const dark = [];
  const keys = slabGeo(0.62, 0.03, 0.2, { bevel: 0.008, seg: 2, tile: 0.3 });
  keys.applyMatrix4(_km.makeRotationX(-0.16));
  keys.translate(0, 0.42, 0.2);
  dark.push(keys);
  dark.push(tubeAlong([new THREE.Vector3(0.3, -0.28, -0.3), new THREE.Vector3(0.5, -0.4, -0.5),
    new THREE.Vector3(0.62, -0.48, -0.4)], 0.035, 5, 0.4));
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
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){ vUv = uv; vN = normalize(normalMatrix*normal);
    vW = (modelMatrix*vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
const KERF_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uKerf; uniform vec3 uBase; uniform vec3 uHot; uniform float uTime;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){
    vec4 k = texture2D(uKerf, vUv);
    float cut = k.r;              // 1 = fully melted through
    float heat = k.g;             // residual glow
    if(cut > 0.86) discard;       // the hole is a hole
    vec3 base = uBase * (0.72 + 0.4*vN.y);
    float rim = smoothstep(0.18, 0.86, cut);
    vec3 glow = mix(vec3(1.4,0.35,0.05), vec3(2.4,1.9,1.2), heat);
    vec3 c = mix(base, glow, clamp(rim*0.9 + heat*0.75, 0.0, 1.0));
    c += glow * heat * 0.6 * (0.85 + 0.15*sin(uTime*23.0 + vW.y*9.0));
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class BlastDoor {
  constructor(world, opts = {}) {
    this.world = world;
    this.width = opts.width ?? 4.4;
    this.height = opts.height ?? 5.0;
    this.thickness = opts.thickness ?? 0.55;
    this.toughness = opts.toughness ?? TOUGHNESS.blastdoor;
    this.opened = false;
    this.onBreach = opts.onBreach || null;
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
      uniforms: {
        uKerf: { value: this.kerfTex },
        uBase: { value: new THREE.Color(opts.color ?? 0x6e747e) },
        uHot: { value: new THREE.Color(0xff8020) },
        uTime: { value: 0 },
      },
      vertexShader: KERF_VERT, fragmentShader: KERF_FRAG, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.copy(opts.position);
    if (opts.quaternion) this.mesh.quaternion.copy(opts.quaternion);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    world.scene.add(this.mesh);

    // frame
    const M = propMaterials();
    const frame = new THREE.Group();
    const t = 0.4;
    for (const [w, h, x, y] of [[this.width + t * 2, t, 0, this.height / 2 + t / 2],
                                [this.width + t * 2, t, 0, -this.height / 2 - t / 2],
                                [t, this.height + t * 2, this.width / 2 + t / 2, 0],
                                [t, this.height + t * 2, -this.width / 2 - t / 2, 0]]) {
      const b = new THREE.Mesh(plateGeo(w, h, this.thickness * 1.6, 0.05, 1), M.darkSteel);
      b.position.set(x, y, 0);
      b.castShadow = true; b.receiveShadow = true;
      frame.add(b);
    }
    frame.position.copy(this.mesh.position);
    frame.quaternion.copy(this.mesh.quaternion);
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

  /** World-space capsules so the blade solver treats it like anything else. */
  capsules(out = []) {
    out.length = 0;
    const hw = this.width / 2, hh = this.height / 2;
    const step = 0.55;
    for (let y = -hh + step / 2; y < hh; y += step) {
      _v1.set(-hw, y, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      _v2.set(hw, y, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      out.push({ name: 'd' + y.toFixed(2), p0: _v1.clone(), p1: _v2.clone(),
        r: this.thickness * 0.62, toughness: Infinity, door: this });
    }
    return out;
  }

  /** Burn the kerf where the blade is touching. Returns true when breached. */
  burn(worldPoint, power, dt) {
    if (this.opened) return false;
    this._inv.copy(this.mesh.matrixWorld).invert();
    _v1.copy(worldPoint).applyMatrix4(this._inv);
    const u = (_v1.x / this.width + 0.5);
    const v = (_v1.y / this.height + 0.5);
    if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return false;

    const RES = this.res;
    const px = u * RES, py = (1 - v) * RES;
    const radius = RES * 0.030;
    const rate = clamp(power * dt * 0.55, 0, 1.0) * 255;

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

    const total = RES * RES;
    if (this.cutArea / total > (this.breachFraction ?? 0.055)) { this.breach(); return true; }
    return false;
  }

  breach() {
    if (this.opened) return;
    this.opened = true;
    this.collider.disabled = true;
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
  const mesh = new THREE.Mesh(geo, material || M.duracrete);
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
  const nb = Math.max(2, Math.round(size.y * 2 / (opts.bed ?? 0.55)));
  // three rings per bed — base, body, undercut — or the steps smooth away into
  // the pillow shape that makes procedural rock look like bread
  const seg = opts.seg ?? 13, rings = opts.rings ?? Math.min(48, Math.max(6, nb * 3));
  const hard = [];
  for (let b = 0; b <= nb + 1; b++) hard.push(r());
  const plan = [];
  for (let i = 0; i < seg; i++) plan.push(0.8 + fbm2(Math.cos(i / seg * TAU) * 1.7 + seed, Math.sin(i / seg * TAU) * 1.7, 3) * 0.4);
  const amp = opts.bandAmp ?? 0.13;
  const bandMul = (y01) => {
    const f = clamp(y01, 0, 0.9999) * nb;
    const i = Math.floor(f), frac = f - i;
    // each bed stands proud at its base and is undercut at its top
    return 1 + amp * (hard[i] - 0.45) * 2 * (0.62 + 0.5 * (1 - frac)) - amp * 0.35 * frac;
  };
  // near-vertical sides with a hard break to a flat top: rock erodes into
  // cliffs and benches, not into ellipsoids
  const prof = (y) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(y), opts.shoulder ?? 10)), 0.25);

  const pos = new Float32Array((rings + 1) * (seg + 1) * 3), uv = new Float32Array((rings + 1) * (seg + 1) * 2);
  const bottom = [], top = [];
  const k = uvm(opts.tile ?? 2.4);
  for (let j = 0; j <= rings; j++) {
    const y = lerp(-0.96, 0.985, j / rings);
    const base = prof(y) * bandMul((y + 1) / 2);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      // the plan shape barely changes with height — a crag is a prism the
      // weather has bitten, not a potato; the beds do the vertical work
      const wob = 1 + fbm2(Math.cos(a) * 2.2 + seed * 3, Math.sin(a) * 2.2, 3) * 0.19
                    + fbm2(Math.cos(a) * 4.1, y * 3.4 + seed, 2) * 0.05;
      const rr = base * plan[i % seg] * wob;
      const o = (j * (seg + 1) + i) * 3, o2 = (j * (seg + 1) + i) * 2;
      const x = Math.cos(a) * rr * size.x, z = Math.sin(a) * rr * size.z, yy = y * size.y;
      pos[o] = x; pos[o + 1] = yy; pos[o + 2] = z;
      uv[o2] = a * Math.max(size.x, size.z) * k; uv[o2 + 1] = yy * k;
      if (i < seg) {
        if (j === 0) bottom.push(new THREE.Vector3(x, yy, z));
        if (j === rings) top.push(new THREE.Vector3(x, yy, z));
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
  const geo = mergeGeos([side, fanCap(top, size.y * 1.02, true, 2.4), fanCap(bottom, -size.y * 1.06, false, 2.4)]);
  if (opts.dip) geo.applyMatrix4(_km.makeRotationZ(opts.dip));
  return paintGeo(geo, (x, y, z, out) => strataTint(y + (opts.bedOffset || 0), seed, 1 / (opts.bed ?? 0.55), out));
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
  const kit = kitOpen(pos, opts, 606);
  const M = propMaterials();
  const S = opts.size ?? 7;
  const H = opts.height ?? S * 1.25;
  const rr = kit.rng;
  const seed = opts.seed ?? 606;
  const mat = opts.mat || M.strata;

  const main = rockGeo(new THREE.Vector3(S * 0.72, H / 2, S * 0.58), seed, {
    seg: 15, bed: 0.55, bandAmp: 0.17, dip: (rr() - 0.5) * 0.13,
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
      seg: 11, bed: 0.5, bandAmp: 0.16, dip: (rr() - 0.35) * 0.5, bedOffset: 0,
    });
    g.rotateY(rr() * TAU);
    kit.put(g, mat, Math.cos(a) * d, sh / 2 - sh * 0.12, Math.sin(a) * d);
    kit.collider(Math.cos(a) * d, sh / 2, Math.sin(a) * d, sw * 0.7, sh / 2, sw * 0.55, a, 0.92);
  }
  // a harder cap that has protected the beds under it
  if (opts.cap !== false) {
    const ch = H * 0.16;
    const g = rockGeo(new THREE.Vector3(S * 0.5, ch / 2, S * 0.42), seed + 91, {
      seg: 13, bed: 0.4, bandAmp: 0.1, shoulder: 14, bedOffset: H,
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
  for (let j = 0; j < N; j++) for (let i = 0; i < SIDES; i++) {
    const a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
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
function boulderGeo(variant, seed) {
  const r = makeRng(seed * 131 + variant * 977);
  const ph = [r() * 9, r() * 9, r() * 9];
  const v = new THREE.Vector3();
  // variant 0 starts from a bevelled block: rock that has split along joints
  // keeps its corners, and a field of ellipsoids is a field of bread rolls
  const g = variant === 0 ? plateGeo(1.7, 1.4, 1.5, 0.18, 4)
    : new THREE.IcosahedronGeometry(1, variant === 2 ? 2 : 1);
  const p = g.attributes.position;
  const flat = variant === 1 ? 0.6 : 0.9;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n1 = Math.sin(v.x * 2.3 + ph[0]) * Math.sin(v.y * 2.9 + ph[1]) * Math.sin(v.z * 2.1 + ph[2]);
    const n2 = Math.sin(v.x * 5.1 + ph[1]) * Math.sin(v.z * 4.4 + ph[0]);
    const bed = Math.sin(v.y * 4.2 + ph[2]) * (variant === 0 ? 0.05 : 0.12);
    const kk = 1 + n1 * (variant === 0 ? 0.14 : 0.3) + n2 * 0.1 + bed;
    p.setXYZ(i, v.x * kk, v.y * flat * kk, v.z * kk);
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
  const M = propMaterials();
  const n = opts.count ?? 12;
  const R = opts.radius ?? 6;
  const size = opts.size ?? 1.1;
  const seed = opts.seed ?? 808;
  const r = makeRng(seed * 31 + 5);
  const lists = [[], [], []], cols = [[], [], []];
  const c = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, rad = R * Math.pow(r(), 0.62);
    const sc = size * lerp(1.25, 0.35, rad / R) * (0.6 + r() * 0.9);
    p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    p.y = groundY(world, centre.x + p.x, centre.z + p.z) - groundY(world, centre.x, centre.z) + sc * 0.2;
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5));
    s.set(sc * (0.8 + r() * 0.5), sc * (0.6 + r() * 0.5), sc * (0.8 + r() * 0.5));
    const v = i % 3;
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
  for (let v = 0; v < 3; v++) {
    if (!lists[v].length) continue;
    out.push(addInstanced(world, boulderGeo(v, seed), opts.mat || M.stone, lists[v], centre, { colors: cols[v] }));
  }
  return out;
}

/**
 * Scree: the chips a rock face sheds. One instanced draw, no physics, density
 * falling off with radius — the cheapest way to stop a rock from meeting the
 * ground along a hard line.
 */
export function addScree(world, centre, opts = {}) {
  const M = propMaterials();
  const n = opts.count ?? 140;
  const R = opts.radius ?? 8, inner = opts.inner ?? 0;
  const size = opts.size ?? 0.22;
  const r = makeRng((opts.seed ?? 909) * 17 + 3);
  // The chip is authored at unit size and shrunk per instance, so its UVs have
  // to be pre-divided by the size it will actually be seen at — otherwise the
  // rock grain on a 15 cm chip is fifty times finer than on the cliff it fell
  // off, and the field sparkles.
  const chip = triplanarUv(new THREE.IcosahedronGeometry(0.5, 0), 1 / (3 * clamp(size, 0.05, 3)));
  chip.scale(1, 0.52, 1);
  const list = [], cols = [];
  const c = new THREE.Color();
  const onGround = !opts.kit;          // composing: the parent frame owns the height
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const rad = lerp(inner, R, Math.pow(r(), 0.5));
    const sc = size * lerp(1.5, 0.45, rad / R) * (0.5 + r());
    p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    p.y = sc * 0.16 + (onGround ? groundY(world, centre.x + p.x, centre.z + p.z) - groundY(world, centre.x, centre.z) : 0);
    q.setFromEuler(new THREE.Euler(r() * TAU, r() * TAU, r() * TAU));
    s.set(sc * (0.7 + r() * 0.7), sc * (0.45 + r() * 0.4), sc * (0.7 + r() * 0.7));
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
  return addInstanced(world, chip, opts.mat || M.stone, list, centre, { colors: cols, castShadow: false });
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
  if (opts.kit) kit.push(pos.x, pos.y, pos.z, opts.yaw || 0);
  else kit.push(0, 0, 0, opts.yaw || 0);
  return kit;
}
/** Close a maker: emit unless the caller is composing. */
function kitClose(world, kit, pos, opts) {
  kit.pop();
  if (opts.kit) return kit;
  return kit.emit(world, pos, opts.quaternion || IDENT, opts);
}

/** Triangle fan closing a ring of points — broken tops, open shell ends. */
function fanCap(pts, cy, up = true, tile = 1.6) {
  const n = pts.length;
  const k = uvm(tile);
  const pos = new Float32Array((n + 1) * 3), uv = new Float32Array((n + 1) * 2);
  pos[1] = cy;
  for (let i = 0; i < n; i++) {
    const p = pts[i], o = (i + 1) * 3;
    pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
    uv[(i + 1) * 2] = p.x * k; uv[(i + 1) * 2 + 1] = p.z * k;
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % n);
    if (up) idx.push(0, a, b); else idx.push(0, b, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
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

  const nv = (rings + 1) * (seg + 1);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const rim = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const rr = lerp(rBot, rTop, t) * (1 + entasis * Math.sin(t * Math.PI));
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

  // stepped plinth
  const pw = r * 2.9, ph = r * 0.34;
  kit.slab(trim, pw, ph, pw, 0, ph / 2, 0, { tile: 2.2, collide: false });
  kit.slab(trim, pw * 0.86, ph * 0.8, pw * 0.86, 0, ph * 1.4, 0, { tile: 2.2, collide: false });
  const y0 = ph * 1.8;
  // torus base moulding
  const base = torusGeo(r * 1.02, r * 0.2, 6, 16, TAU, 1.0);
  base.rotateX(Math.PI / 2);
  kit.put(base, trim, 0, y0 + r * 0.14, 0);

  const capH = broken ? 0 : r * 1.5;
  const shaftH = Math.max(0.4, h * standing - y0 - capH);
  const sh = shaftGeo(r, r * (broken ? lerp(1, 0.86, standing) : 0.84), shaftH, {
    seg: opts.seg ?? 18, rings: broken ? 4 : 5, flutes: opts.flutes ?? (rr() < 0.5 ? 16 : 0),
    entasis: 0.03, topJitter: broken ? r * 0.9 : 0, rng: rr, tile: 1.9,
  });
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
      kit.put(tubeAlong(pts, 0.022, 4, 0.6), M.rebar);
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
  return kitClose(world, kit, pos, opts);
}

/**
 * A semicircular (or segmental) voussoir arch on two piers. `span` is the
 * clear opening, `springing` where the curve starts, `broken` drops that
 * fraction of the ring from one side. Standard spans: 3, 5, 8 m.
 */
export function addArch(world, pos, opts = {}) {
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
    kit.put(g, key ? trim : mat, 0, spring, 0);
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
      kit.slab(trim, t * 1.34, 0.22, d * 1.2, x, spring - 0.11, 0, { tile: 1.8, collide: false });   // impost
      kit.slab(trim, t * 1.4, 0.3, d * 1.28, x, 0.15, 0, { tile: 1.8, collide: false });             // footing
      kit.collider(x, spring / 2, 0, t / 2 + 0.02, spring / 2, d / 2);
    }
  }
  if (opts.collideArch !== false && missing === 0) {
    kit.collider(0, spring + rIn * yScale * 0.72, 0, rIn * 0.9, t * 0.7, d / 2);
  }
  return kitClose(world, kit, pos, opts);
}

/**
 * A lintel or architrave spanning `length`, with corbel brackets under each
 * end and a chamfered soffit. Sits at `y` = its own mid-height.
 */
export function addLintel(world, pos, opts = {}) {
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
  return kitClose(world, kit, pos, opts);
}

/**
 * A buttress leaning against a wall: a battered mass that steps back twice on
 * its way up, with a weathering slope on each set-off. Sizes: 3 m (a pier),
 * 5 m (one course of wall), 9 m (two).
 */
export function addButtress(world, pos, opts = {}) {
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
  return kitClose(world, kit, pos, opts);
}

/**
 * A wall that has been broken rather than built: two faces with different
 * jagged tops, a darker core showing between them, rebar out of the break and
 * optional door/window openings. size = (length, full height, thickness).
 */
export function addBrokenWall(world, pos, size, opts = {}) {
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

  const panel = (depth, zOff, top, mat, tile) => {
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
    kit.put(g, mat, 0, 0, 0);
  };

  const tA = brokenEdge(w / 2, -w / 2, lowest, h, rr, Math.max(4, Math.round(w / 1.6)));
  const tB = brokenEdge(w / 2, -w / 2, lowest * 0.94, h * 0.98, rr, Math.max(4, Math.round(w / 1.6)));
  const tC = brokenEdge(w / 2, -w / 2, lowest * 1.02, h * 0.9, rr, Math.max(3, Math.round(w / 2.2)));
  panel(t * 0.3, t * 0.35, tA, face, 2.4);
  panel(t * 0.42, 0, tC, core, 2.0);
  panel(t * 0.3, -t * 0.35, tB, face, 2.4);

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
    ], 0.021, 4, 0.6), M.rebar);
  }
  // a base course so it meets the ground with an edge, not a seam
  if (opts.plinth !== false) kit.slab(opts.trimMat || M.duracreteWarm, w * 1.02, 0.3, t * 1.2, 0, 0.15, 0, { tile: 2.4, collide: false });

  const solid = lowest * 0.9;
  const nc = Math.max(1, Math.round(w / 6));
  for (let i = 0; i < nc; i++) {
    const cw = w / nc;
    kit.collider(-w / 2 + cw * (i + 0.5), solid / 2, 0, cw / 2, solid / 2, t / 2);
  }
  return kitClose(world, kit, pos, opts);
}

/**
 * A staircase. `steps` × (rise, run) from the ARCH table by default, with
 * nosed treads, two stringers and an optional balustrade. The collider is one
 * ramp rather than a stack of boxes, so walking up it is smooth.
 */
export function addStair(world, pos, opts = {}) {
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
        pitch: Math.atan2(H, D), lift: 0, yaw: Math.PI / 2,
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
  const kit = kitOpen(pos, opts, 88);
  const M = propMaterials();
  const L = opts.length ?? 4, h = opts.height ?? 1.05;
  const posts = opts.posts ?? Math.max(2, Math.round(L / 1.4));
  const mat = opts.mat || M.darkSteel;
  const pitch = opts.pitch ?? 0;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  for (let i = 0; i <= posts; i++) {
    const t = i / posts, s = (t - 0.5) * L;
    kit.post(mat, 0.032, 0.038, h, s * cp, s * sp + h / 2, 0, { radial: 6, tile: 0.9 });
  }
  for (const yy of [h, h * 0.52]) {
    const a = new THREE.Vector3(-L / 2 * cp, -L / 2 * sp + yy, 0);
    const b = new THREE.Vector3(L / 2 * cp, L / 2 * sp + yy, 0);
    kit.put(pipeBetween(a, b, yy === h ? 0.042 : 0.028, 6), mat);
  }
  return kitClose(world, kit, pos, opts);
}

/** A stepped plinth — what a monument stands on. Sizes: 2, 4, 8 m across. */
export function addPlinth(world, pos, opts = {}) {
  const kit = kitOpen(pos, opts, 99);
  const M = propMaterials();
  const w = opts.width ?? 4, d = opts.depth ?? w, h = opts.height ?? 1.2;
  const mat = opts.mat || M.sandstone;
  const steps = opts.steps ?? 3;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const sw = lerp(w, w * 0.78, t), sd = lerp(d, d * 0.78, t);
    const sh = h / steps;
    kit.slab(mat, sw, sh, sd, 0, sh * (i + 0.5), 0, { tile: 2.4, seg: 3, collide: false });
  }
  // recessed inscription band
  kit.slab(opts.bandMat || M.stoneDark, w * 0.72, h * 0.26, d * 0.79, 0, h * 0.52, 0, { tile: 1.4, collide: false });
  kit.slab(opts.bandMat || M.stoneDark, w * 0.79, h * 0.26, d * 0.72, 0, h * 0.52, 0, { tile: 1.4, collide: false });
  kit.collider(0, h / 2, 0, w / 2, h / 2, d / 2);
  return kitClose(world, kit, pos, opts);
}

/**
 * A cantilevered balcony: slab, corbels underneath, railing on three sides.
 * Sizes: 2×1.4, 4×2, 6×2.6.
 */
export function addBalcony(world, pos, opts = {}) {
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
 */
function revolveGeo(profile, opts = {}) {
  const seg = opts.seg ?? 20;
  const folds = opts.folds ?? 0, fd = opts.foldDepth ?? 0.05;
  const k = uvm(opts.tile ?? 2.2);
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
      ], armR * 0.09, 4, 0.5), M.rebar);
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
  return kitClose(world, kit, pos, opts);
}

/**
 * A ruined ceremonial gateway: two battered pylons, a broken arch between
 * them, chains, a rotted banner and the rubble it all shed. Spans 8–20 m.
 */
export function addRuinedGate(world, pos, opts = {}) {
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
      ], lerp(pd, pd * 0.78, t), { bevel: 0.06, tile: 3.0 }), mat, x + lean * y * 8, y, 0);
      kit.slab(trim, w1 * 1.12, 0.24, lerp(pd, pd * 0.78, t1) * 1.1, x, y + h, 0, { tile: 2.6, collide: false });
      y += h + 0.24;
    }
    // a recessed panel down each face gives the mass a scale reference
    for (const sz of [-1, 1]) {
      kit.slab(M.duracreteDark, pw * 0.5, H * 0.5, 0.1, x, H * 0.34, sz * pd * 0.5, { tile: 2.2, collide: false });
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
    kit.put(tubeAlong(catenaryPoints(a, b, 0.3, 10), 0.045, 4, 0.5), M.rust);
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
  return kitClose(world, kit, pos, opts);
}

/**
 * A section of capital-ship hull, down on its side: a torn cylindrical shell
 * with real plate thickness, internal frames showing through the tear, hull
 * plating and greebles outside. Default 34 m long × 8 m radius — big enough to
 * fight inside, and a horizon line from anywhere on the map.
 */
export function addHullSection(world, pos, opts = {}) {
  const kit = kitOpen(pos, opts, 404);
  const M = propMaterials();
  const L = opts.length ?? 34, R = opts.radius ?? 8;
  const t = opts.plate ?? 0.28;
  const hull = opts.mat || M.hull;
  const inner = opts.innerMat || M.darkSteel;
  const trimM = opts.trimMat || M.panel;
  const rr = kit.rng;
  const na = opts.arcSeg ?? 22, nz = opts.lenSeg ?? 18;

  // the tear line: where the shell stops, as a function of length
  const tear = [];
  let hi = 0.62, lo = -0.62;
  for (let j = 0; j <= nz; j++) {
    hi = clamp(hi + (rr() - 0.5) * 0.16, 0.34, 0.86);
    lo = clamp(lo + (rr() - 0.5) * 0.16, -0.86, -0.34);
    tear.push([lo * Math.PI, hi * Math.PI]);
  }
  const k = uvm(3.2);
  const build = (radius, flip) => {
    const pos3 = new Float32Array((nz + 1) * (na + 1) * 3), uv = new Float32Array((nz + 1) * (na + 1) * 2);
    for (let j = 0; j <= nz; j++) {
      const z = (j / nz - 0.5) * L;
      const [a0, a1] = tear[j];
      for (let i = 0; i <= na; i++) {
        const a = lerp(a0, a1, i / na);
        // shallow dents so the shell is not a perfect extrusion
        const dent = 1 + Math.sin(a * 3.1 + j * 0.7) * 0.012 + Math.sin(z * 0.4 + a * 1.7) * 0.016;
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
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const outerG = build(R, false), innerG = build(R - t, true);
  kit.add(outerG, hull);
  kit.add(innerG, inner);
  // close the torn edges so the plate has thickness you can see
  const edge = (side) => {
    const pos3 = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) {
      const z = (j / nz - 0.5) * L, a = tear[j][side];
      for (const r of [R, R - t]) {
        pos3.push(Math.sin(a) * r, -Math.cos(a) * r, z);
        uv.push(z * k * 2, r * k * 2);
      }
    }
    for (let j = 0; j < nz; j++) {
      const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
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
    kit.put(slabGeo(w, 0.14, h, { tile: 1.4, seg: 3 }), rr() < 0.3 ? M.rust : trimM,
      Math.sin(a) * (R + 0.06), -Math.cos(a) * (R + 0.06), z, 0, 0, -a);
  }
  for (let i = 0; i < 3; i++) {
    const z = (rr() - 0.5) * L * 0.7;
    const a = lerp(-1.2, 1.2, rr());
    kit.put(tubeAlong([
      new THREE.Vector3(Math.sin(a) * (R - t - 0.3), -Math.cos(a) * (R - t - 0.3), z),
      new THREE.Vector3(Math.sin(a) * (R + 0.6), -Math.cos(a) * (R + 0.4), z + 1.2 + rr()),
      new THREE.Vector3(Math.sin(a) * (R + 1.4), -Math.cos(a) * (R + 0.2) - 1.2, z + 2.4 + rr() * 2),
    ], 0.11, 5, 1.0), M.cable);
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
  return kitClose(world, kit, pos, opts);
}

/**
 * A hangar gantry: lattice legs, a plated walkway, railings, a ladder and a
 * crane trolley on a rail. Default 22 m long, 7 m to the deck.
 */
export function addGantry(world, pos, opts = {}) {
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
      kit.slab(steel, 0.5, 0.16, 0.5, foot, 0.08, z, { tile: 1.0, collide: false });
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
  kit.slab(deckM, W, 0.14, L, 0, H, 0, { tile: 1.2, seg: 3 });
  for (const sx of [-1, 1]) kit.slab(steel, 0.16, 0.34, L, sx * (W / 2 - 0.08), H + 0.1, 0, { tile: 1.6, collide: false });
  addRailing(world, new THREE.Vector3(0, H + 0.07, W / 2), { kit, length: L, height: 1.05, posts: bays * 2, yaw: Math.PI / 2 });
  addRailing(world, new THREE.Vector3(0, H + 0.07, -W / 2), { kit, length: L, height: 1.05, posts: bays * 2, yaw: Math.PI / 2 });

  // ladder up the near end
  const lz = -L / 2 + 0.4;
  for (const sx of [-1, 1]) kit.put(pipeBetween(new THREE.Vector3(sx * 0.26, 0, lz - 0.5), new THREE.Vector3(sx * 0.26, H + 0.9, lz - 0.5), 0.038, 5), steel);
  for (let i = 0; i * 0.3 < H + 0.6; i++) {
    kit.put(pipeBetween(new THREE.Vector3(-0.26, i * 0.3 + 0.25, lz - 0.5), new THREE.Vector3(0.26, i * 0.3 + 0.25, lz - 0.5), 0.022, 4), steel);
  }
  // crane trolley on a rail under the deck, hook swinging on a cable
  const tz = (rr() - 0.5) * L * 0.5;
  kit.slab(steel, 0.34, 0.22, L * 0.94, 0, H - 0.22, 0, { tile: 1.4, collide: false });
  kit.slab(M.panel, 0.8, 0.5, 1.3, 0, H - 0.6, tz, { tile: 1.2, collide: false });
  kit.put(pipeBetween(new THREE.Vector3(0, H - 0.85, tz), new THREE.Vector3(0.1, H - 3.4, tz + 0.2), 0.028, 4), M.cable);
  kit.put(torusGeo(0.28, 0.06, 5, 10, Math.PI * 1.5, 1.0), M.rust, 0.1, H - 3.7, tz + 0.2, Math.PI / 2, 0, 0.4);
  if (opts.lights !== false) {
    for (let i = 0; i < 3; i++) {
      const z = (i / 2 - 0.5) * L * 0.7;
      kit.slab(M.glowCold, 0.5, 0.1, 0.24, 0, H - 0.24, z, { tile: 0.6, collide: false, seg: 2 });
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
  const kit = kitOpen(a, opts, 1111);
  const M = propMaterials();
  const n = opts.count ?? 3;
  const rad = opts.radius ?? 0.035;
  const rr = kit.rng;
  const la = new THREE.Vector3(), lb = new THREE.Vector3().subVectors(b, a);
  const side = new THREE.Vector3().subVectors(lb, la).cross(UP).normalize();
  if (!isFinite(side.x) || side.lengthSq() < 0.1) side.set(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const off = side.clone().multiplyScalar((i - (n - 1) / 2) * (opts.spread ?? 0.32));
    const drop = (opts.stagger ?? 0.18) * i;
    const p0 = la.clone().add(off).setY(la.y - drop);
    const p1 = lb.clone().add(off).setY(lb.y - drop);
    const slack = (opts.slack ?? 0.09) * (0.7 + rr() * 0.8);
    kit.add(tubeAlong(catenaryPoints(p0, p1, slack, opts.segments ?? 16), rad * (0.8 + rr() * 0.5), 5, 0.8), opts.mat || M.cable);
  }
  if (opts.brackets !== false) {
    for (const p of [la, lb]) {
      kit.put(slabGeo(0.3, 0.22, 0.3, { tile: 0.8, seg: 3 }), M.darkSteel, p.x, p.y, p.z);
    }
  }
  return kitClose(world, kit, a, opts);
}

/**
 * A stack of crates: the base courses static and merged, the top one or two
 * live Props you can cut and shove off. Sizes: 'small' (4-6), 'medium' (8-12),
 * 'large' (14-20 crates).
 */
export function addCrateStack(world, pos, opts = {}) {
  const M = propMaterials();
  const seed = opts.seed ?? 1212;
  const rr = makeRng(seed * 7 + 1);
  const kit = new Kit(seed);
  const size = opts.size ?? 0.8;
  const tiers = opts.tiers ?? (2 + Math.floor(rr() * 3));
  const cols = opts.columns ?? (2 + Math.floor(rr() * 2));
  const dyn = [];
  const yaw = opts.yaw || 0;
  kit.push(0, 0, 0, yaw);

  const cell = size * 1.06;
  let y = 0;
  for (let t = 0; t < tiers; t++) {
    const w = Math.max(1, cols - Math.floor(t * 0.7));
    const d = Math.max(1, cols - 1 - Math.floor(t * 0.5));
    const s = size * lerp(1, 0.82, t / Math.max(1, tiers));
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      if (t > 0 && rr() < 0.18) continue;                     // gaps, not a wall
      const x = (i - (w - 1) / 2) * cell, z = (j - (d - 1) / 2) * cell;
      const jitter = (rr() - 0.5) * 0.12;
      if (t === tiers - 1 && rr() < 0.5 && dyn.length < (opts.dynamic ?? 2)) {
        dyn.push([x, y + s * 0.5, z, s]);                     // this one is a live prop
        continue;
      }
      const box = slabGeo(s, s * 0.88, s, { bevel: s * 0.055, seg: 3, tile: 0.5 });
      kit.put(box, rr() < 0.32 ? M.crateDark : M.crate, x, y + s * 0.44, z, 0, jitter, 0);
      for (const ry of [s * 0.28, -s * 0.28]) {               // banding ribs
        kit.put(slabGeo(s * 1.03, s * 0.07, s * 1.03, { bevel: s * 0.02, seg: 2, tile: 0.4 }),
          M.crateDark, x, y + s * 0.44 + ry, z, 0, jitter, 0);
      }
      kit.collider(x, y + s * 0.44, z, s / 2, s * 0.44, s / 2, jitter, 0.85);
    }
    y += size * lerp(1, 0.82, t / Math.max(1, tiers)) * 0.9;
  }
  kit.pop();
  const stats = kit.emit(world, pos, opts.quaternion || IDENT, opts);
  for (const [x, yy, z, s] of dyn) {
    const p = new THREE.Vector3(x, yy, z).applyAxisAngle(UP, yaw).add(pos);
    world.addProp(makeCrate(world, p, s / 0.85, { toughness: TOUGHNESS.plastoid }));
  }
  return stats;
}

/**
 * A tarpaulin thrown over something and lashed down: sags between its tie
 * points, wrinkles, and a ragged edge. Covers a 2–4 m pile.
 */
export function addTarp(world, pos, opts = {}) {
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
      kit.add(tubeAlong(catenaryPoints(a, b, 0.02, 5), 0.018, 4, 0.4), M.cable);
      kit.put(cylGeo(0.03, 0.02, 0.3, 5, 1.2), M.rust, b.x, 0.1, b.z, 0.2, 0, 0.15);
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
      kit.put(slabGeo(W * 0.98, 0.05, D / nb * 0.9, { bevel: 0.012, seg: 3, tile: 0.9 }), board, 0, y + 0.05, z, 0, (rr() - 0.5) * 0.02, 0);
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
  // ladder up the end bay
  const lx = xs[0] + 0.25;
  for (const dz of [-0.2, 0.2]) kit.put(pipeBetween(new THREE.Vector3(lx, 0, dz), new THREE.Vector3(lx, H + 0.6, dz), 0.028, 5), steel);
  for (let i = 0; i * 0.32 < H + 0.4; i++) {
    kit.put(pipeBetween(new THREE.Vector3(lx, 0.3 + i * 0.32, -0.2), new THREE.Vector3(lx, 0.3 + i * 0.32, 0.2), 0.018, 4), steel);
  }
  kit.collider(-W / 2, H / 2, 0, 0.12, H / 2, D / 2);
  kit.collider(W / 2, H / 2, 0, 0.12, H / 2, D / 2);
  return kitClose(world, kit, pos, opts);
}

/**
 * A comms mast: a lattice tower, a dish, a whip aerial, guy wires down to
 * ground anchors and a warning lamp. Heights 6–24 m.
 */
export function addAntenna(world, pos, opts = {}) {
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
  kit.put(tubeUv(new THREE.SphereGeometry(0.12, 8, 6), TAU * 0.12, Math.PI * 0.12, 0.5), M.glowRed, 0, H * 1.23, 0);
  // guy wires
  if (opts.guys !== false) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.6;
      const anchor = new THREE.Vector3(Math.cos(a) * H * 0.55, 0.1, Math.sin(a) * H * 0.55);
      kit.add(tubeAlong(catenaryPoints(leg(i, 0.82), anchor, 0.012, 8), 0.022, 4, 0.6), M.cable);
      kit.put(cylGeo(0.09, 0.13, 0.4, 6, 1.2), M.duracreteDark, anchor.x, 0.2, anchor.z);
    }
  }
  kit.slab(M.duracrete, base * 3, 0.32, base * 3, 0, 0.16, 0, { tile: 1.6 });
  kit.collider(0, H * 0.4, 0, base * 0.8, H * 0.4, base * 0.8);
  return kitClose(world, kit, pos, opts);
}

/**
 * A lamp standard with a cowl and an emissive lens. Pass `light: true` to hang
 * a real PointLight off it (registered with the level so it unloads cleanly).
 * Heights 3 m (path), 6 m (yard), 9 m (apron).
 */
export function addLamp(world, pos, opts = {}) {
  const kit = kitOpen(pos, opts, 1616);
  const M = propMaterials();
  const H = opts.height ?? 6;
  const reach = opts.reach ?? H * 0.22;
  const steel = opts.mat || M.darkSteel;
  const glow = opts.glowMat || M.glowAmber;
  kit.slab(M.duracrete, 0.6, 0.26, 0.6, 0, 0.13, 0, { tile: 1.2 });
  kit.put(cylGeo(0.075, 0.11, H, 8, 1.2), steel, 0, H / 2 + 0.2, 0);
  // the head cranes over
  kit.add(tubeAlong([
    new THREE.Vector3(0, H * 0.86, 0), new THREE.Vector3(0, H + 0.16, 0),
    new THREE.Vector3(reach * 0.7, H + 0.24, 0), new THREE.Vector3(reach, H + 0.14, 0),
  ], 0.062, 6, 1.0), steel);
  const cowl = revolveGeo([
    [0.05, 0.3], [0.2, 0.22], [0.3, 0.06], [0.31, 0], [0.28, -0.02],
  ], { seg: 14, tile: 1.0 });
  kit.put(cowl, steel, reach, H + 0.02, 0);
  kit.put(cylGeo(0.26, 0.2, 0.09, 12, 1.2), glow, reach, H - 0.03, 0);
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
  kit.put(slabGeo(w * 0.98, 0.05, 0.04, { bevel: 0.012, seg: 2, tile: 0.5 }),
    rr() < 0.5 ? M.glowAmber : M.glowCold, 0, y - h / 2 - 0.03, 0.08);
  if (opts.post !== false) {
    for (const sx of [-1, 1]) {
      kit.put(cylGeo(0.05, 0.06, y + h / 2, 6, 1.2), M.darkSteel, sx * w * 0.35, (y + h / 2) / 2, 0);
    }
    kit.collider(0, (y + h / 2) / 2, 0, w * 0.4, (y + h / 2) / 2, 0.12);
  } else {
    for (const sx of [-1, 1]) {
      kit.put(slabGeo(0.06, 0.06, 0.34, { bevel: 0.015, seg: 2, tile: 0.4 }), M.darkSteel, sx * w * 0.35, y, -0.2);
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
  return triplanarUv(g, 1.1);
}

/**
 * The rubble a ruin actually sheds: big blocks close in, chips far out, all
 * instanced. Three draw calls plus one for the bent reinforcement, and a
 * handful of colliders on the pieces big enough to trip over.
 *
 * radius 5 m = a collapsed wall, 12 m = a collapsed building.
 */
export function addDebrisField(world, centre, opts = {}) {
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
    const g = rubbleGeo(v, seed);
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
      ], 0.024 * scale, 4, 0.6));
    }
    const merged = mergeGeos(bars);
    if (merged) {
      if (composing) opts.kit.put(merged, M.rebar, 0, 0, 0);
      else out.push(addStatic(world, new THREE.Mesh(merged, M.rebar), centre, IDENT));
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
  const SZ = { small: [12, 9, 4.5], medium: [18, 13, 5.5], large: [26, 18, 7] };
  const [W, D, H] = SZ[opts.size || 'medium'] || SZ.medium;
  const kit = opts.kit || new Kit(opts.seed ?? 2020);
  kit.push(opts.kit ? pos.x : 0, opts.kit ? pos.y : 0, opts.kit ? pos.z : 0, opts.yaw || 0);
  const M = propMaterials();
  const rr = kit.rng;
  const seed = opts.seed ?? 2020;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const stone = opts.mat || M.duracreteWarm;
  const sub = { kit, mat: stone, trimMat: opts.trimMat || M.sandstone, coreMat: M.duracreteDark };
  // the hall stands on a stylobate, and the stair outside climbs exactly onto
  // it — a building sitting flush on the dirt is the thing that reads as a box
  const steps = 4;
  const podium = ARCH.step.rise * steps;

  addFloorSlab(world, V(0, podium - ARCH.slabT * 0.5, 0), V(W, D),
    { ...sub, ruin: 0.3, cell: 2.2, seed: seed + 1, mat: M.duracrete });
  // back and side walls, each broken to a different height
  addBrokenWall(world, V(0, podium, -D / 2), V(W, H, ARCH.wallT), {
    ...sub, ruin: 0.42, seed: seed + 2,
    openings: [{ x: -W * 0.26, y: 0.2, w: 1.4, h: 2.6, arched: true }, { x: W * 0.26, y: 1.6, w: 1.6, h: 1.6 }],
  });
  for (const sx of [-1, 1]) {
    addBrokenWall(world, V(sx * W / 2, podium, 0), V(D, H * 0.86, ARCH.wallT), {
      ...sub, ruin: 0.62 + rr() * 0.2, yaw: Math.PI / 2, seed: seed + 3 + sx,
      openings: [{ x: sx * D * 0.2, y: 0.2, w: 1.3, h: 2.4, arched: rr() < 0.5 }],
    });
  }
  // the front: a doorway arch, and the stair up to it
  const doorW = Math.min(5, W * 0.3);
  addArch(world, V(0, podium, D / 2), {
    ...sub, span: doorW, springing: H * 0.5, depth: ARCH.wallT * 1.4,
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
        ...sub, size: H > 6 ? 'L' : 'M', height: H * 0.92,
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
  kit.slab(M.hull, sw * 1.12, 0.18, sd * 1.18, 0, sh + 0.2, 0.1, { tile: 2.8, seg: 3, rx: -0.09, collide: false });
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
    p.y = groundY(world, p.x, p.z) + 0.5;
    world.addProp(rr() < 0.4 ? makeBarrel(world, p) : makeCrate(world, p, 0.8));
  }
  return stats;
}