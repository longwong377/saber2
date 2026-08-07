/**
 * SABER — destructible architecture.
 *
 * Props could always be cut; the building could not. A wall was a merged mesh
 * and a box collider, which meant the most solid-looking thing on screen was
 * the one thing in the level that could not be touched. This module makes the
 * architecture answer.
 *
 * ── how a piece dies ──────────────────────────────────────────────────────
 *
 *   1. REGISTER   a maker emits its merged meshes and its static boxes as
 *                 usual, then hands them here (Props.js `kitClose`). Nothing
 *                 changes: same draw calls, same colliders, no cost.
 *   2. PRE-FRACTURE  the first time a piece is threatened, its solid is split
 *                 into convex Voronoi cells — geometry AND hulls built once,
 *                 amortised a piece per frame for anything near the player.
 *                 Cells that hold none of the piece's surface are thrown away,
 *                 and each surviving cell is shrunk onto the geometry it does
 *                 hold, so an arch fractures into voussoirs and not into a
 *                 rectangle of bricks with a hole where the opening was.
 *   3. CONVERT    on the first real break the merged mesh is hidden and the
 *                 cells take its place — still static, still one box collider
 *                 each, so a wall you have chipped is still a wall.
 *   4. DETACH     cells inside the break become genuine Rapier dynamic bodies
 *                 with convex-hull colliders: they fall, roll, settle, and can
 *                 be pushed, gripped and hurled like anything else.
 *   5. SUPPORT    a flood fill from the cells that touch the ground runs after
 *                 every detach. Anything no longer connected to the ground
 *                 lets go — which is why cutting a column at the ankles drops
 *                 the whole shaft, and why an arch missing a voussoir falls in
 *                 rather than hanging there in the air.
 *   6. RETIRE     live chunks are capped. The oldest goes first: at rest and
 *                 far away it merges back to a static box (free), otherwise it
 *                 is despawned. A twenty-minute fight cannot grind the solver
 *                 to a halt no matter how much of the level is on the floor.
 *
 * ── how damage arrives ────────────────────────────────────────────────────
 *
 *   blade      through the existing BladeContactSolver. A piece publishes
 *              capsules like any other target, so TOUGHNESS already decides
 *              that a wooden crate parts instantly and a blast door takes
 *              twenty seconds — the same gradient, no second rule.
 *   explosion  `damageSphere`, wired to World.onExplosion.
 *   Force      `forceBlast`, a cone, from Player.forcePush.
 *   impact     anything heavy and fast that arrives at a piece, found by
 *              polling the solver's own body list.
 *
 * ── why the cells are built by hand and not by Slice.js ───────────────────
 *
 * Slice.js is the right tool for ONE cut through one mesh and it is what the
 * blade uses here too. It is the wrong tool for building forty cells: measured,
 * a single call costs ~85 µs of fixed overhead (non-indexed copy, ring sort,
 * attribute allocation) before it looks at a triangle, so the ~120 clips a
 * fracture needs cost ~11 ms — a dropped frame per piece. The same fracture
 * over convex polyhedra (below) is ~0.35 ms, because a cell is six to twelve
 * polygons rather than a triangle soup, and the result is exactly convex,
 * which is what the hull collider wanted anyway.
 */

import * as THREE from 'three';
import { Body, LAYER, box as boxShape, hullFromGeometry } from '../physics/RapierWorld.js';
import { sliceGeometry } from './Slice.js';
import { TOUGHNESS } from '../game/Combat.js';
import { clamp, makeRng } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _box = new THREE.Box3();
const IDENT = new THREE.Quaternion();

let _structId = 1;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Materials                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * What a piece is made of.
 *
 *   toughness  fed straight to the blade solver — the seconds·speed it takes
 *              the blade to part it. Sandstone gives way, durasteel does not.
 *   density    kg/m³ in GAME units, not real ones. A 0.7 m crate in this game
 *              is 22 kg (≈65 kg/m³); real stone at 2400 would make every chunk
 *              immovable by a Force push, which is the wrong game.
 *   hpPerM2    damage to break a square metre of fracture surface. Per AREA and
 *              not per volume on purpose: a chunk comes off when the material
 *              around it fails, so a chunk with eight times the volume should be
 *              four times as hard to remove, not eight. Volume-scaled health
 *              made big pieces immune to the same charge that shattered small
 *              ones, purely because the cell grid had put fewer cells in them.
 *   cell       target chunk edge in metres. Bigger = fewer, heavier chunks.
 */
export const PROFILES = {
  sandstone: { toughness: TOUGHNESS.heavy * 0.55, density: 75, hpPerM2: 8, cell: 1.25, chip: 0xbba077 },
  stone: { toughness: TOUGHNESS.heavy, density: 90, hpPerM2: 11, cell: 1.35, chip: 0x9c9186 },
  duracrete: { toughness: TOUGHNESS.heavy * 1.6, density: 100, hpPerM2: 15, cell: 1.5, chip: 0x8e8b84 },
  statue: { toughness: TOUGHNESS.heavy * 1.2, density: 95, hpPerM2: 13, cell: 1.8, chip: 0xa8987c },
  durasteel: { toughness: TOUGHNESS.durasteel, density: 180, hpPerM2: 42, cell: 1.1, chip: 0x8a94a0 },
  blastdoor: { toughness: TOUGHNESS.blastdoor, density: 220, hpPerM2: 95, cell: 1.0, chip: 0x8a94a0 },
  unbreakable: { toughness: Infinity, density: 200, hpPerM2: Infinity, cell: 2, chip: 0x888888 },
};

/** What it takes to break one chunk of `volume` m³ out of `profile`. */
export function cellHp(volume, profile) {
  if (profile.hpPerM2 === Infinity) return Infinity;
  return Math.max(5, profile.hpPerM2 * 4.8 * Math.cbrt(Math.max(1e-4, volume * volume)));
}

export function profileFor(p) {
  if (!p) return null;
  if (typeof p === 'string') return PROFILES[p] || null;
  if (typeof p === 'object') return { ...PROFILES.stone, ...p };
  return null;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Convex polyhedra                                                      */
/*                                                                        */
/*  A cell is a set of faces, each a convex polygon wound counter-clockwise*/
/*  about its outward normal. Clipping one is a Sutherland–Hodgman pass    */
/*  over polygons of four to eight points plus one new cap face — cheap    */
/*  enough to do a hundred times a frame, and exactly convex, so the hull  */
/*  collider is the shape and not an approximation of it.                  */
/* ══════════════════════════════════════════════════════════════════════ */

/** An axis-aligned box, centred at `c`, as a polyhedron. */
export function boxPoly(c, he) {
  const faces = [];
  const axes = [
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), he.y, he.z, he.x],
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), he.z, he.x, he.y],
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), he.x, he.y, he.z],
  ];
  for (const [n, u, v, a, b, d] of axes) {
    for (const s of [1, -1]) {
      const nn = n.clone().multiplyScalar(s);
      const uu = s > 0 ? u : u.clone().negate();
      const centre = c.clone().addScaledVector(n, s * d);
      faces.push({
        n: nn,
        pts: [
          centre.clone().addScaledVector(uu, -a).addScaledVector(v, -b),
          centre.clone().addScaledVector(uu, a).addScaledVector(v, -b),
          centre.clone().addScaledVector(uu, a).addScaledVector(v, b),
          centre.clone().addScaledVector(uu, -a).addScaledVector(v, b),
        ],
      });
    }
  }
  return { faces };
}

/**
 * Keep the half-space `n·p + d <= 0`. Returns a new polyhedron, the original
 * untouched, or null when nothing survives.
 */
export function clipPoly(poly, n, d, eps = 1e-6) {
  const faces = [];
  const ring = [];
  let cut = false;
  for (const f of poly.faces) {
    const src = f.pts, m = src.length;
    const out = [];
    for (let i = 0; i < m; i++) {
      const a = src[i], b = src[(i + 1) % m];
      const da = n.dot(a) + d, db = n.dot(b) + d;
      if (da <= eps) out.push(a);
      if ((da > eps) !== (db > eps)) {
        const t = da / (da - db);
        const p = a.clone().lerp(b, t);
        out.push(p);
        ring.push(p);
        cut = true;
      }
    }
    if (out.length >= 3) faces.push({ n: f.n, pts: out });
  }
  if (!faces.length) return null;
  if (!cut) return poly;

  // the new face, ordered around the cut plane
  if (ring.length >= 3) {
    const c = new THREE.Vector3();
    for (const p of ring) c.add(p);
    c.multiplyScalar(1 / ring.length);
    const ex = Math.abs(n.x) > 0.9 ? _v1.set(0, 1, 0) : _v1.set(1, 0, 0);
    const bx = new THREE.Vector3().crossVectors(n, ex).normalize();
    const by = new THREE.Vector3().crossVectors(n, bx).normalize();
    const sorted = ring
      .map((p) => ({ p, a: Math.atan2(_v2.subVectors(p, c).dot(by), _v2.dot(bx)) }))
      .sort((x, y) => x.a - y.a)
      .map((x) => x.p);
    const pts = [];
    for (const p of sorted) {
      if (!pts.length || pts[pts.length - 1].distanceToSquared(p) > 1e-9) pts.push(p);
    }
    if (pts.length >= 3 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-9) pts.pop();
    if (pts.length >= 3) faces.push({ n: n.clone(), pts });
  }
  return faces.length >= 4 ? { faces } : null;
}

/** Signed volume, via the divergence theorem over the (closed, convex) faces. */
export function polyVolume(poly) {
  let v = 0;
  const o = poly.faces[0].pts[0];
  for (const f of poly.faces) {
    const p = f.pts;
    for (let i = 1; i + 1 < p.length; i++) {
      _v1.subVectors(p[0], o); _v2.subVectors(p[i], o); _v3.subVectors(p[i + 1], o);
      v += _v1.dot(_v2.cross(_v3));
    }
  }
  return Math.abs(v) / 6;
}

/** Volume-weighted centroid. */
export function polyCentroid(poly, out = new THREE.Vector3()) {
  const o = poly.faces[0].pts[0];
  let vol = 0;
  out.set(0, 0, 0);
  for (const f of poly.faces) {
    const p = f.pts;
    for (let i = 1; i + 1 < p.length; i++) {
      _v1.subVectors(p[0], o); _v2.subVectors(p[i], o); _v3.subVectors(p[i + 1], o);
      const dv = _v1.dot(_v4.copy(_v2).cross(_v3)) / 6;
      vol += dv;
      out.x += (p[0].x + p[i].x + p[i + 1].x + o.x) * 0.25 * dv;
      out.y += (p[0].y + p[i].y + p[i + 1].y + o.y) * 0.25 * dv;
      out.z += (p[0].z + p[i].z + p[i + 1].z + o.z) * 0.25 * dv;
    }
  }
  if (Math.abs(vol) < 1e-12) return out.copy(o);
  return out.multiplyScalar(1 / vol);
}

export function polyBounds(poly, out = new THREE.Box3()) {
  out.makeEmpty();
  for (const f of poly.faces) for (const p of f.pts) out.expandByPoint(p);
  return out;
}

/** Distance from `c` to the furthest vertex — the cell's reach. */
export function polyRadius(poly, c) {
  let r2 = 0;
  for (const f of poly.faces) for (const p of f.pts) r2 = Math.max(r2, p.distanceToSquared(c));
  return Math.sqrt(r2);
}

/**
 * Points for a Rapier convex hull, straight off the faces.
 *
 * hullFromGeometry would do the same job from the triangles, but it quantises
 * every vertex into a string-keyed Set to collapse the duplicates a merged
 * geometry is full of — 67 µs a cell, measured, and pure waste here: a convex
 * cell already IS its hull, and Rapier does not mind the shared corners.
 */
export function polyHullPoints(poly, origin) {
  let n = 0;
  for (const f of poly.faces) n += f.pts.length;
  const out = new Float32Array(n * 3);
  let i = 0;
  for (const f of poly.faces) {
    for (const p of f.pts) {
      out[i++] = p.x - origin.x; out[i++] = p.y - origin.y; out[i++] = p.z - origin.z;
    }
  }
  return out;
}

/** Concatenate non-indexed position/normal/uv geometries into one. */
function mergeFlat(list, offsets) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  if (!n) return null;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (let k = 0; k < list.length; k++) {
    const g = list[k], off = offsets[k];
    const p = g.attributes.position.array, na = g.attributes.normal?.array, ua = g.attributes.uv?.array;
    const c = g.attributes.position.count;
    for (let i = 0; i < c; i++) {
      pos[(o + i) * 3] = p[i * 3] + off.x;
      pos[(o + i) * 3 + 1] = p[i * 3 + 1] + off.y;
      pos[(o + i) * 3 + 2] = p[i * 3 + 2] + off.z;
      if (na) { nrm[(o + i) * 3] = na[i * 3]; nrm[(o + i) * 3 + 1] = na[i * 3 + 1]; nrm[(o + i) * 3 + 2] = na[i * 3 + 2]; }
      if (ua) { uv[(o + i) * 2] = ua[i * 2]; uv[(o + i) * 2 + 1] = ua[i * 2 + 1]; }
    }
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Triangulate. Flat-shaded (a fractured face is flat), planar-projected UVs at
 * the same texel density the architecture uses, and translated so the chunk's
 * own centroid is its origin — a rigid body wants its mesh centred on it.
 */
export function polyGeometry(poly, origin, uvScale = 0.22) {
  const pos = [], nrm = [], uv = [];
  for (const f of poly.faces) {
    const p = f.pts, n = f.n;
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const u = ax >= ay && ax >= az ? 'z' : 'x';
    const v = ay >= az && ay >= ax ? 'z' : 'y';
    for (let i = 1; i + 1 < p.length; i++) {
      for (const q of [p[0], p[i], p[i + 1]]) {
        pos.push(q.x - origin.x, q.y - origin.y, q.z - origin.z);
        nrm.push(n.x, n.y, n.z);
        uv.push(q[u] * uvScale, q[v] * uvScale);
      }
    }
  }
  if (pos.length < 9) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Fracture                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Split a solid into convex cells.
 *
 * Sites are a jittered lattice, so cells come out roughly the size asked for
 * instead of the wild range a uniform-random Voronoi produces — a chunk the
 * size of a fist next to one the size of a car reads as a bug. Jitter stays
 * under half a lattice step, which is what lets a cell be built from its 26
 * lattice neighbours alone and still be the exact Voronoi cell.
 *
 * @param bounds   THREE.Box3, the solid's extent in piece-local space
 * @param samples  Float32Array of surface points (xyz) in the same space
 * @param opts     { cell, seed, maxCells, matOf }
 * @returns [{ poly, centre, volume, bounds, samples, mat }]
 */
export function fractureSolid(bounds, samples, opts = {}) {
  const target = Math.max(0.35, opts.cell ?? 1.35);
  const maxCells = opts.maxCells ?? 28;
  const rng = makeRng(opts.seed ?? 7);

  const size = bounds.getSize(new THREE.Vector3());
  const min = bounds.min;
  const nx = Math.max(1, Math.round(size.x / target));
  const ny = Math.max(1, Math.round(size.y / target));
  const nz = Math.max(1, Math.round(size.z / target));
  let scale = 1;
  if (nx * ny * nz > maxCells) scale = Math.cbrt((nx * ny * nz) / maxCells);
  let gx = Math.max(1, Math.round(nx / scale));
  let gy = Math.max(1, Math.round(ny / scale));
  let gz = Math.max(1, Math.round(nz / scale));
  // rounding three axes up can overshoot the cap by half again; walk the
  // longest axis down until it fits, so `maxCells` is a real ceiling
  while (gx * gy * gz > maxCells) {
    if (gx >= gy && gx >= gz && gx > 1) gx--;
    else if (gy >= gz && gy > 1) gy--;
    else if (gz > 1) gz--;
    else break;
  }
  const sx = size.x / gx, sy = size.y / gy, sz = size.z / gz;

  const sites = [];
  const P = new Float32Array(gx * gy * gz * 3);       // flat, for the hot loop
  for (let k = 0; k < gz; k++) {
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const idx = (k * gy + j) * gx + i;
        const p = new THREE.Vector3(
          min.x + (i + 0.5 + (rng() - 0.5) * 0.62) * sx,
          min.y + (j + 0.5 + (rng() - 0.5) * 0.62) * sy,
          min.z + (k + 0.5 + (rng() - 0.5) * 0.62) * sz);
        P[idx * 3] = p.x; P[idx * 3 + 1] = p.y; P[idx * 3 + 2] = p.z;
        sites.push({ i, j, k, index: idx, p, n: 0, box: new THREE.Box3(), mats: null, nbrs: null });
      }
    }
  }
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz)
    ? null : sites[(k * gy + j) * gx + i];

  // ── which cell does each surface sample belong to? (nearest site = Voronoi)
  const matOf = opts.matOf;
  const cnt = samples ? samples.length / 3 : 0;
  const lo = [min.x, min.y, min.z], inv = [1 / sx, 1 / sy, 1 / sz];
  for (let s = 0; s < cnt; s++) {
    const x = samples[s * 3], y = samples[s * 3 + 1], z = samples[s * 3 + 2];
    const i0 = clamp(Math.floor((x - lo[0]) * inv[0]), 0, gx - 1);
    const j0 = clamp(Math.floor((y - lo[1]) * inv[1]), 0, gy - 1);
    const k0 = clamp(Math.floor((z - lo[2]) * inv[2]), 0, gz - 1);
    let bestI = -1, bestD = Infinity;
    const ki = Math.max(0, k0 - 1), ke = Math.min(gz - 1, k0 + 1);
    const ji = Math.max(0, j0 - 1), je = Math.min(gy - 1, j0 + 1);
    const ii = Math.max(0, i0 - 1), ie = Math.min(gx - 1, i0 + 1);
    for (let k = ki; k <= ke; k++) for (let j = ji; j <= je; j++) for (let i = ii; i <= ie; i++) {
      const o = ((k * gy + j) * gx + i) * 3;
      const dx = P[o] - x, dy = P[o + 1] - y, dz = P[o + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestI = (k * gy + j) * gx + i; }
    }
    if (bestI < 0) continue;
    const best = sites[bestI];
    best.n++;
    best.box.expandByPoint(_v1.set(x, y, z));
    if (matOf) {
      const m = matOf(s);
      (best.mats || (best.mats = new Map())).set(m, (best.mats.get(m) || 0) + 1);
    }
  }

  // A cell that holds none of the piece's surface is empty space — the hole in
  // an arch, the air above a broken wall's jagged top — and must not become a
  // block of stone hanging in it.
  const floor = cnt ? Math.max(1, Math.floor(cnt / (sites.length * 26))) : 0;
  const out = [];
  for (const s of sites) {
    if (cnt && s.n < floor) continue;
    let poly = boxPoly(bounds.getCenter(new THREE.Vector3()), size.clone().multiplyScalar(0.5));
    // furthest point of the cell from its site: a bisector further than that
    // cannot reach the cell, which is what keeps this to the six or eight
    // neighbours that matter instead of all twenty-six
    let far = polyRadius(poly, s.p);
    const nbrs = [];
    for (let dk = -1; dk <= 1 && poly; dk++) for (let dj = -1; dj <= 1 && poly; dj++) for (let di = -1; di <= 1 && poly; di++) {
      if (!di && !dj && !dk) continue;
      const o = at(s.i + di, s.j + dj, s.k + dk);
      if (!o) continue;
      const n = new THREE.Vector3().subVectors(o.p, s.p);
      const len = n.length();
      if (len < 1e-5 || len * 0.5 > far) continue;
      n.multiplyScalar(1 / len);
      const mid = _v1.addVectors(o.p, s.p).multiplyScalar(0.5);
      const next = clipPoly(poly, n, -n.dot(mid));
      // a bisector that actually trimmed the cell is a shared face, which is
      // the exact Voronoi adjacency — and therefore the support graph
      if (next !== poly) { poly = next; nbrs.push(o.index); if (poly) far = polyRadius(poly, s.p); }
    }
    if (!poly) continue;
    // Shrink the cell onto the surface it actually holds, so a chunk of arch
    // is arch-shaped rather than a brick from the bounding box.
    if (cnt && s.n > 0) {
      const pad = Math.max(0.05, Math.min(sx, sy, sz) * 0.12);
      const lo = s.box.min, hi = s.box.max;
      // keep n·p + d <= 0, so d = -n·(a point on the plane)
      const planes = [
        [new THREE.Vector3(-1, 0, 0), lo.x - pad], [new THREE.Vector3(1, 0, 0), hi.x + pad],
        [new THREE.Vector3(0, -1, 0), lo.y - pad], [new THREE.Vector3(0, 1, 0), hi.y + pad],
        [new THREE.Vector3(0, 0, -1), lo.z - pad], [new THREE.Vector3(0, 0, 1), hi.z + pad],
      ];
      for (const [n, cut] of planes) {
        if (!poly) break;
        // n is a signed unit axis: n·P where P lies on the plane is ±cut
        poly = clipPoly(poly, n, -(n.x + n.y + n.z) * cut);
      }
    }
    if (!poly) continue;
    const volume = polyVolume(poly);
    if (!(volume > 1e-5)) continue;
    const centre = polyCentroid(poly);
    if (!isFinite(centre.x) || !isFinite(centre.y) || !isFinite(centre.z)) continue;
    let mat = null, bestN = 0;
    if (s.mats) for (const [m, n] of s.mats) if (n > bestN) { bestN = n; mat = m; }
    out.push({ poly, centre, volume, bounds: polyBounds(poly), samples: s.n, mat, site: s.index, nbrs });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Chunk                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/** One cell of a fractured piece: shell → attached → live → settled → gone. */
class Chunk {
  constructor(structure, cell, index) {
    this.structure = structure;
    this.index = index;
    this.cell = cell;
    this.bounds = cell.bounds.clone();        // piece-local
    // The body's origin is the cell's AABB centre, not its centroid: the mesh,
    // the hull and the static box the settled chunk gets are then all the same
    // frame, and Rapier works out the real centre of mass from the collider.
    this.centre = cell.bounds.getCenter(new THREE.Vector3());
    this.volume = cell.volume;
    this.half = cell.bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    this.material = cell.mat || structure.material;
    this.state = 'shell';
    this.damage = 0;
    this.hp = cellHp(cell.volume, structure.profile);
    this.mass = clamp(cell.volume * structure.profile.density, 1.5, 900);
    this.neighbours = [];
    this.grounded = false;
    this.geo = null;
    this.hull = null;
    this.mesh = null;
    this.body = null;
    this.staticBox = null;
    this.age = 0;
    this.rest = 0;
  }

  /** World position of the cell while it is still part of the piece. */
  worldCentre(out = new THREE.Vector3()) {
    return out.copy(this.centre).applyQuaternion(this.structure.quaternion).add(this.structure.position);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Structure                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * One destructible piece of architecture: the merged meshes a maker emitted,
 * the static boxes it registered, and — once anything threatens it — the cells
 * it will come apart into.
 */
export class Structure {
  constructor(manager, spec) {
    this.id = 's' + (_structId++);
    this.manager = manager;
    this.world = manager.world;
    this.kind = spec.kind || 'piece';
    this.profile = profileFor(spec.profile) || PROFILES.stone;
    this.seed = spec.seed ?? 1;

    this.meshes = spec.meshes || [];
    this.boxes = (spec.boxes || []).filter(Boolean);
    this.position = (spec.position || new THREE.Vector3()).clone();
    this.quaternion = (spec.quaternion || IDENT).clone();
    this._invQ = this.quaternion.clone().invert();

    // local bounds, from the geometry the maker actually emitted
    this.local = new THREE.Box3();
    for (const m of this.meshes) {
      const g = m.geometry;
      if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) this.local.union(g.boundingBox);
    }
    if (this.local.isEmpty()) {
      for (const b of this.boxes) {
        _v1.copy(b.center).sub(this.position).applyQuaternion(this._invQ);
        this.local.expandByPoint(_v2.copy(_v1).sub(b.halfExtents));
        this.local.expandByPoint(_v2.copy(_v1).add(b.halfExtents));
      }
    }
    this.size = this.local.getSize(new THREE.Vector3());
    this.centre = this.local.getCenter(new THREE.Vector3()).applyQuaternion(this.quaternion).add(this.position);
    this.radius = this.size.length() * 0.5;
    this.baseY = this.position.y + this.local.min.y;
    this.volume = Math.max(0.01, this.size.x * this.size.y * this.size.z * 0.55);

    this.material = this.meshes.length ? this.meshes[0].material : null;
    this.maxHp = cellHp(this.volume, this.profile) * 2;
    this.hp = this.maxHp;
    this.stress = 0;                 // 0..1, how close to failure — drives the shake
    this.state = 'intact';           // intact → broken → collapsed → gone
    this.chunks = null;
    this.attached = 0;
    this.restsOn = [];
    this.carries = [];
    this._linked = false;
    this._shakeBase = null;
    this.shell = null;            // the standing remainder, merged
    this.shellDirty = false;
  }

  get fractured() { return !!this.chunks; }
  get intact() { return this.state === 'intact'; }

  /* ── capsules for the blade solver ─────────────────────────────────── */

  /**
   * The piece as capsules, so the existing blade solver grades contact with a
   * wall exactly the way it grades contact with a limb or a blast door. Only
   * what is close to the blade is published — a level is fifty of these.
   */
  bladeCapsules(near, reach, out) {
    if (this.state === 'gone') return out;
    const r2 = reach * reach;
    // NB: `chunks` existing does NOT mean the piece has come apart — it is
    // pre-fractured long before it is touched. Until it converts, the blade
    // meets the solid the maker registered.
    if (this.chunks && this.state !== 'intact') {
      for (const c of this.chunks) {
        if (c.state !== 'attached') continue;
        c.worldCentre(_v1);
        if (_v1.distanceToSquared(near) > r2 + c.half.lengthSq()) continue;
        const rad = Math.max(0.18, Math.min(c.half.x, c.half.y, c.half.z));
        out.push({
          name: this.id + 'c' + c.index, p0: _v1.clone(), p1: _v1.clone(), r: rad * 1.15,
          toughness: this.profile.toughness, structure: this, chunk: c,
        });
      }
      return out;
    }
    const src = this.boxes.length ? this.boxes : [this._selfBox()];
    for (let bi = 0; bi < src.length; bi++) {
      const b = src[bi];
      if (!b) continue;
      const he = b.halfExtents;
      if (b.center.distanceToSquared(near) > r2 + he.lengthSq() * 4) continue;
      // capsules run along the box's longest axis, stacked across the second —
      // the same shape the blast door publishes, generalised
      const dims = [he.x, he.y, he.z];
      const order = [0, 1, 2].sort((a, b) => dims[b] - dims[a]);
      const ax = order[0], sec = order[1], rad = dims[order[2]];
      const axisV = _v3.set(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0).applyQuaternion(b.quat);
      const secV = _v4.set(sec === 0 ? 1 : 0, sec === 1 ? 1 : 0, sec === 2 ? 1 : 0).applyQuaternion(b.quat);
      const half = dims[ax], span = dims[sec];
      const step = Math.max(0.5, rad * 1.25);
      const rows = clamp(Math.round((span * 2) / step), 1, 8);
      for (let i = 0; i < rows; i++) {
        const t = rows === 1 ? 0 : (i / (rows - 1)) * 2 - 1;
        _v1.copy(b.center).addScaledVector(secV, t * Math.max(0, span - rad * 0.5));
        if (_v1.distanceToSquared(near) > r2 + half * half) continue;
        out.push({
          name: this.id + 'b' + bi + 'r' + i,
          p0: _v1.clone().addScaledVector(axisV, -Math.max(0, half - rad * 0.4)),
          p1: _v1.clone().addScaledVector(axisV, Math.max(0, half - rad * 0.4)),
          r: rad * 1.05, toughness: this.profile.toughness, structure: this, box: bi,
        });
      }
    }
    return out;
  }

  _selfBox() {
    if (!this._fallbackBox) {
      this._fallbackBox = {
        center: this.centre.clone(),
        halfExtents: this.size.clone().multiplyScalar(0.5),
        quat: this.quaternion.clone(),
      };
    }
    return this._fallbackBox;
  }

  /* ── pre-fracture ──────────────────────────────────────────────────── */

  /**
   * Build the cells. Idempotent, and deliberately NOT done at level build: a
   * level is fifty pieces and most of them are never touched, so this is
   * amortised one per frame over whatever is near the player.
   */
  prefracture() {
    if (this.chunks || this.state === 'gone') return this.chunks;
    const t0 = now();

    const { samples, mats } = this._surfaceSamples();
    const bounds = this.local.clone();
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const cells = fractureSolid(bounds, samples, {
      cell: this.profile.cell,
      seed: this.seed * 131 + 7,
      maxCells: this.manager.maxCellsPerPiece,
      matOf: (i) => mats[i],
    });

    this.chunks = [];
    for (let i = 0; i < cells.length; i++) this.chunks.push(new Chunk(this, cells[i], i));
    this._link();
    // The cells know the real solid; the bounding-box guess the piece was born
    // with does not. Rescale the piece's health to what it is actually made of,
    // keeping whatever fraction of it is already gone.
    if (this.chunks.length) {
      let v = 0, hp = 0;
      for (const c of this.chunks) { v += c.volume; hp += c.hp; }
      const frac = this.hp / Math.max(1e-6, this.maxHp);
      this.volume = v;
      this.maxHp = Math.max(1, hp);
      this.hp = this.maxHp * frac;
    }
    this.buildMs = now() - t0;
    this.manager.stats.prefractured++;
    this.manager.stats.prefractureMs += this.buildMs;
    return this.chunks;
  }

  /**
   * Where the piece's surface actually is, sampled by AREA rather than by
   * vertex.
   *
   * Vertices alone are a trap here: a column shaft is a lathe of five rings, so
   * its vertices live at six heights and nowhere in between. Cells built from
   * those thought the two metres between rings were empty air and shrank to
   * nothing, leaving a column of floating discs. Triangles are sampled on a
   * barycentric lattice sized by area, so a two-triangle wall face is described
   * as well as a two-hundred-triangle one, for a bounded number of points.
   */
  _surfaceSamples(budget = 1600) {
    const bins = [];
    for (const m of this.meshes) {
      const g = m.geometry;
      if (!g || !g.attributes.position) continue;
      bins.push({
        pos: g.attributes.position.array,
        idx: g.index ? g.index.array : null,
        n: g.index ? g.index.count : g.attributes.position.count,
        mat: m.material,
      });
    }
    let area = 0, count = 0;
    for (const b of bins) {
      const { pos, idx, n } = b;
      for (let i = 0; i + 2 < n; i += 3) {
        const a0 = (idx ? idx[i] : i) * 3, b0 = (idx ? idx[i + 1] : i + 1) * 3, c0 = (idx ? idx[i + 2] : i + 2) * 3;
        const ux = pos[b0] - pos[a0], uy = pos[b0 + 1] - pos[a0 + 1], uz = pos[b0 + 2] - pos[a0 + 2];
        const vx = pos[c0] - pos[a0], vy = pos[c0 + 1] - pos[a0 + 1], vz = pos[c0 + 2] - pos[a0 + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        const t = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
        if (t > 0) { area += t; count++; }
      }
    }
    if (!count) return { samples: new Float32Array(0), mats: [] };
    // one extra sample per `per` m² of face, on top of one centroid per triangle
    const per = Math.max(1e-6, area) / Math.max(1, budget - Math.min(count, budget * 0.6));

    const pts = [], mats = [];
    for (const b of bins) {
      const { pos, idx, n, mat } = b;
      for (let i = 0; i + 2 < n; i += 3) {
        const a0 = (idx ? idx[i] : i) * 3, b0 = (idx ? idx[i + 1] : i + 1) * 3, c0 = (idx ? idx[i + 2] : i + 2) * 3;
        const ax = pos[a0], ay = pos[a0 + 1], az = pos[a0 + 2];
        const bx = pos[b0], by = pos[b0 + 1], bz = pos[b0 + 2];
        const cx0 = pos[c0], cy0 = pos[c0 + 1], cz0 = pos[c0 + 2];
        if (!isFinite(ax) || !isFinite(bx) || !isFinite(cx0)) continue;
        pts.push((ax + bx + cx0) / 3, (ay + by + cy0) / 3, (az + bz + cz0) / 3);
        mats.push(mat);
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx0 - ax, vy = cy0 - ay, vz = cz0 - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const t = Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
        const k = clamp(Math.round(Math.sqrt(t / per)), 1, 6);
        if (k < 2) continue;
        for (let u = 0; u < k; u++) {
          for (let v = 0; v + u < k; v++) {
            const bu = (u + 0.333) / k, bv = (v + 0.333) / k, bw = 1 - bu - bv;
            if (bw <= 0) continue;
            pts.push(ax * bw + bx * bu + cx0 * bv, ay * bw + by * bu + cy0 * bv, az * bw + bz * bu + cz0 * bv);
            mats.push(mat);
          }
        }
      }
    }
    return { samples: new Float32Array(pts), mats };
  }

  /**
   * The support graph: who holds up whom.
   *
   * Two cells are linked when they share a Voronoi face AND their solids are
   * actually close. The first test alone would connect the two sides of a
   * doorway across the opening; the second alone would connect a cell to
   * whatever happened to be near it in the bounding box. Both together is what
   * makes an arch collapse when a voussoir is taken and a wall with a hole in it
   * stay standing.
   */
  _link() {
    const cs = this.chunks;
    const bySite = new Map();
    for (const c of cs) bySite.set(c.cell.site, c);
    const groundTol = Math.max(0.22, this.size.y * 0.06);
    const gap = Math.max(0.12, this.profile.cell * 0.55);
    for (const a of cs) {
      a.grounded = a.bounds.min.y <= this.local.min.y + groundTol;
      for (const site of (a.cell.nbrs || [])) {
        const b = bySite.get(site);
        if (!b || b === a || a.neighbours.includes(b)) continue;
        if (a.bounds.max.x + gap < b.bounds.min.x || b.bounds.max.x + gap < a.bounds.min.x) continue;
        if (a.bounds.max.y + gap < b.bounds.min.y || b.bounds.max.y + gap < a.bounds.min.y) continue;
        if (a.bounds.max.z + gap < b.bounds.min.z || b.bounds.max.z + gap < a.bounds.min.z) continue;
        a.neighbours.push(b);
        b.neighbours.push(a);
      }
    }
  }

  /* ── preparing ─────────────────────────────────────────────────────── */

  /**
   * Build the geometry and the hull for one cell. Measured at ~90 µs, so an
   * eighteen-cell piece is a two-millisecond job that must not land in one
   * frame — the manager spends it a few cells at a time.
   */
  prepareCell(c) {
    if (!c || c.geo || c.state === 'gone') return false;
    const uv = 1 / Math.max(0.6, this.profile.cell * 1.6);
    c.geo = polyGeometry(c.cell.poly, c.centre, uv);
    if (!c.geo) { c.state = 'gone'; return false; }
    c.hull = { type: 'hull', points: polyHullPoints(c.cell.poly, c.centre) };
    c.tris = c.geo.attributes.position.count / 3;
    this.manager.stats.chunkTris += c.tris;
    return true;
  }

  /** True once every cell has its geometry. */
  get prepared() {
    if (!this.chunks) return false;
    for (const c of this.chunks) if (!c.geo && c.state !== 'gone') return false;
    return true;
  }

  prepareAll() {
    this.prefracture();
    if (!this.chunks) return;
    for (const c of this.chunks) this.prepareCell(c);
  }

  /* ── conversion ────────────────────────────────────────────────────── */

  /** Merged mesh out, cells in. Still static, still solid — just breakable. */
  convert() {
    if (this.chunks && this.state !== 'intact') return;
    this.prepareAll();
    if (!this.chunks || !this.chunks.length) { this.state = 'broken'; return; }

    for (const m of this.meshes) m.visible = false;
    for (const b of this.boxes) this.world.physics?.removeStaticBox?.(b);

    for (const c of this.chunks) {
      if (c.state === 'gone') continue;
      c.state = 'attached';
      c.staticBox = this.world.physics?.addStaticBox?.(
        c.worldCentre(new THREE.Vector3()), c.half.clone().max(_v1.set(0.03, 0.03, 0.03)),
        this.quaternion.clone(), { friction: 0.85 }) || null;
      this.attached++;
    }
    this.state = 'broken';
    this.shellDirty = true;
    this.rebuildShell();
    this.manager._linkSupports();
  }

  /**
   * What is left standing, as ONE mesh per material.
   *
   * A cell needs its own draw call only once it is loose. Keeping the standing
   * remainder merged is the difference between a levelled arena costing 968
   * draw calls and costing the couple of hundred its loose rubble is worth —
   * measured on the arena, which fractures into 968 cells.
   */
  rebuildShell() {
    this.shellDirty = false;
    if (this.shell) {
      for (const m of this.shell) { this.world.scene?.remove(m); m.geometry.dispose(); }
      this.shell = null;
    }
    if (!this.chunks) return;
    const byMat = new Map();
    for (const c of this.chunks) {
      if (c.state !== 'attached' || !c.geo) continue;
      const mat = c.material || this.material;
      let e = byMat.get(mat);
      if (!e) byMat.set(mat, e = { geos: [], offs: [] });
      e.geos.push(c.geo); e.offs.push(c.centre);
    }
    if (!byMat.size) return;
    this.shell = [];
    for (const [mat, e] of byMat) {
      const geo = mergeFlat(e.geos, e.offs);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.copy(this.position);
      mesh.quaternion.copy(this.quaternion);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.world.scene?.add(mesh);
      this.shell.push(mesh);
    }
  }

  /* ── damage ────────────────────────────────────────────────────────── */

  /**
   * Damage spread over a sphere. Cells inside it take the hit; the piece keeps
   * a whole-piece total too, which is what drives the shake and the dust before
   * anything actually lets go.
   */
  damageSphere(centre, radius, amount, dir = null) {
    if (this.state === 'gone' || this.profile.hpPerM2 === Infinity) return false;
    if (!(amount > 0)) return false;
    this.prefracture();
    if (!this.chunks) return false;
    this.hp -= amount;
    this.stress = clamp(1 - this.hp / Math.max(1e-3, this.maxHp), 0, 1);

    const hits = [];
    const r2 = radius * radius;
    for (const c of this.chunks) {
      if (c.state === 'live' || c.state === 'settled' || c.state === 'gone') continue;
      const d2 = c.worldCentre(_v1).distanceToSquared(centre);
      if (d2 > r2) continue;
      const k = 1 - Math.sqrt(d2) / radius;
      c.damage += amount * k;
      if (c.damage >= c.hp) hits.push(c);
    }
    if (!hits.length) {
      this.manager._dust(centre, 0.35 + this.stress * 0.5, this.profile.chip);
      return false;
    }
    if (this.state === 'intact') this.convert();
    for (const c of hits) this.detach(c, dir, centre);
    this.settleSupport();
    this.manager._breakFx(centre, hits.length, this.profile);
    return true;
  }

  /** A straight blade cut: everything the plane parted lets go, and then some. */
  cutBy(point, normal, impulse) {
    if (this.state === 'gone') return false;
    this.prefracture();
    if (!this.chunks || !this.chunks.length) return false;
    if (this.state === 'intact') this.convert();
    // a real vector, not module scratch: this call reaches deep enough that
    // shared temporaries get clobbered under it
    const n = new THREE.Vector3().copy(normal).normalize();
    const d = -n.dot(point);
    const band = Math.max(0.35, this.profile.cell * 0.75);
    const reach = Math.max(2.2, this.profile.cell * 2.4);
    const hits = [];
    for (const c of this.chunks) {
      if (c.state !== 'attached') continue;
      c.worldCentre(_v1);
      if (_v1.distanceTo(point) > reach) continue;
      const dist = Math.abs(n.dot(_v1) + d);
      if (dist > band + Math.max(c.half.x, c.half.y, c.half.z)) continue;
      hits.push(c);
    }
    if (!hits.length) {
      // the blade parted a face the cells do not straddle — take the nearest
      let best = null, bestD = Infinity;
      for (const c of this.chunks) {
        if (c.state !== 'attached') continue;
        const dd = c.worldCentre(_v1).distanceToSquared(point);
        if (dd < bestD) { bestD = dd; best = c; }
      }
      if (best) hits.push(best);
    }
    // The cells the plane runs through are parted ON the plane rather than
    // knocked out whole — this is the one place a runtime slice earns its cost,
    // and it is the difference between a column that was cut and a column that
    // had a lump taken out of it. Bounded, because it is not cheap.
    let parted = 0;
    for (const c of hits) {
      if (parted < 3 && this._partChunk(c, point, n, impulse)) { parted++; continue; }
      this.detach(c, impulse, point);
    }
    this.settleSupport();
    this.manager._breakFx(point, hits.length, this.profile, true);
    return hits.length > 0;
  }

  /**
   * Slice one attached cell on the blade's plane and let both halves go. Falls
   * back to the caller's plain detach when the plane misses the cell's solid.
   */
  _partChunk(chunk, point, normal, impulse) {
    if (!chunk || chunk.state !== 'attached' || !chunk.geo) return false;
    const q = this.quaternion;
    const inv = _q1.copy(q).invert();
    const origin = chunk.worldCentre(new THREE.Vector3());
    const lp = new THREE.Vector3().subVectors(point, origin).applyQuaternion(inv);
    const ln = new THREE.Vector3().copy(normal).applyQuaternion(inv).normalize();
    let res = null;
    try { res = sliceGeometry(chunk.geo, lp, ln); } catch (e) { res = null; }
    if (!res) return false;

    const localCentre = chunk.centre.clone();
    const volume = chunk.volume;
    const halfLen = chunk.half.length();
    const mat = chunk.material || this.material;
    this.manager._forget(chunk, true);            // the whole cell is spent

    const scratch = new THREE.Vector3();
    let made = 0;
    for (const [geo, sign] of [[res.front, 1], [res.back, -1]]) {
      const off = new THREE.Vector3();
      geo.computeBoundingBox();
      geo.boundingBox.getCenter(off);
      geo.translate(-off.x, -off.y, -off.z);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const bb = geo.boundingBox.clone().translate(scratch.copy(localCentre).add(off));
      const share = clamp(bb.getSize(scratch).length() / Math.max(1e-3, halfLen * 2), 0.1, 1);
      const frag = new Chunk(this, {
        bounds: bb, centre: bb.getCenter(new THREE.Vector3()),
        volume: volume * share, mat, poly: null,
      }, this.chunks.length);
      frag.geo = geo;
      frag.hull = hullFromGeometry(geo)
        || boxShape(Math.max(0.02, frag.half.x), Math.max(0.02, frag.half.y), Math.max(0.02, frag.half.z));
      frag.tris = geo.attributes.position.count / 3;
      this.manager.stats.chunkTris += frag.tris;
      frag.mesh = new THREE.Mesh(geo, mat);
      frag.mesh.castShadow = true; frag.mesh.receiveShadow = true;
      frag.mesh.matrixAutoUpdate = false;
      frag.mesh.position.copy(off).applyQuaternion(q).add(origin);
      frag.mesh.quaternion.copy(q);
      frag.mesh.updateMatrix();
      this.world.scene?.add(frag.mesh);
      frag.state = 'attached';
      this.chunks.push(frag);
      this.attached++;
      this.detach(frag, impulse, new THREE.Vector3().copy(point).addScaledVector(normal, -sign * 0.35));
      made++;
    }
    return made > 0;
  }

  /**
   * Blade grinding. The solver's own accumulated work is the damage — hold the
   * blade against a wall long enough and it fails where you were holding it,
   * even if you never pushed hard enough for a clean cut.
   */
  wear(work, point) {
    if (this.state === 'gone' || this.profile.hpPerM2 === Infinity) return false;
    this.hp -= work;
    this.stress = clamp(1 - this.hp / Math.max(1e-3, this.maxHp), 0, 1);
    if (this.hp > 0) return false;
    const p = point ? point.clone() : this.centre.clone();
    const r = Math.max(1.4, this.profile.cell * 1.3);
    // enough to part the cells under the blade, not the whole piece
    let amount = 0;
    for (const c of this.chunks || []) amount = Math.max(amount, c.hp);
    amount = Math.max(amount, cellHp(this.profile.cell ** 3, this.profile)) * 2.2;
    this.hp = this.maxHp * 0.35;
    return this.damageSphere(p, r, amount);
  }

  /* ── detaching ─────────────────────────────────────────────────────── */

  /** A cell becomes a real body — and, at that moment, its own mesh. */
  detach(chunk, impulse, point) {
    if (!chunk || chunk.state !== 'attached') return null;
    if (chunk.staticBox) { this.world.physics?.removeStaticBox?.(chunk.staticBox); chunk.staticBox = null; }
    chunk.state = 'live';
    this.attached--;
    this.shellDirty = true;

    if (!chunk.mesh && chunk.geo) {
      chunk.mesh = new THREE.Mesh(chunk.geo, chunk.material || this.material);
      chunk.mesh.castShadow = true; chunk.mesh.receiveShadow = true;
      chunk.mesh.matrixAutoUpdate = false;
      chunk.worldCentre(chunk.mesh.position);
      chunk.mesh.quaternion.copy(this.quaternion);
      chunk.mesh.updateMatrix();
      this.world.scene?.add(chunk.mesh);
    }
    const pos = chunk.mesh ? chunk.mesh.position.clone() : chunk.worldCentre();
    const body = new Body({
      position: pos, quaternion: this.quaternion,
      shape: chunk.hull || boxShape(chunk.half.x, chunk.half.y, chunk.half.z),
      mass: chunk.mass, friction: 0.86, restitution: 0.03,
      layer: LAYER.DEBRIS,
      mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.PROP | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER,
      linearDamping: 0.02, angularDamping: 0.12,
    });
    body.userData.chunk = chunk;
    body.userData.onCull = () => this.manager._forget(chunk, true);
    chunk.body = body;
    this.world.physics?.add?.(body);

    // a shove away from where the damage came from, plus a little spin
    if (point) {
      _v1.subVectors(pos, point);
      const d = _v1.length();
      _v1.multiplyScalar(1 / Math.max(0.15, d));
      const push = clamp(3.2 / Math.max(0.5, d), 0.4, 4.5);
      _v1.multiplyScalar(chunk.mass * push);
      _v1.y += chunk.mass * 0.5;
      if (impulse) _v1.addScaledVector(impulse, chunk.mass * 0.06);
      body.applyImpulse(_v1, pos);
    }
    body.angularVelocity.set(
      (this.manager.rng() - 0.5) * 3.2, (this.manager.rng() - 0.5) * 3.2, (this.manager.rng() - 0.5) * 3.2);

    chunk.age = 0; chunk.rest = 0;
    this.manager.live.push(chunk);
    this.manager.stats.detached++;
    return chunk;
  }

  /**
   * Support, by flood fill from the ground. Anything still attached that can no
   * longer reach a grounded cell through its neighbours is not standing on
   * anything, so it falls — which is the whole difference between a column that
   * loses its base and one that keeps floating above the hole.
   */
  settleSupport() {
    if (!this.chunks) return 0;
    const grounded = this.groundedByCarrier();
    const seen = new Set();
    const queue = [];
    for (const c of this.chunks) {
      if (c.state !== 'attached') continue;
      if (grounded && c.grounded) { seen.add(c); queue.push(c); }
    }
    while (queue.length) {
      const c = queue.pop();
      for (const n of c.neighbours) {
        if (n.state !== 'attached' || seen.has(n)) continue;
        seen.add(n); queue.push(n);
      }
    }
    let dropped = 0;
    for (const c of this.chunks) {
      if (c.state !== 'attached' || seen.has(c)) continue;
      this.detach(c, null, null);
      if (c.body) c.body.velocity.y -= 0.4;
      dropped++;
    }
    if (this.attached <= 0 && this.state !== 'collapsed') {
      this.state = 'collapsed';
      for (const s of this.carries) s.collapse();
    }
    return dropped;
  }

  /** Whether this piece still has ground to stand on at all. */
  groundedByCarrier() {
    for (const s of this.restsOn) if (s.state === 'collapsed') return false;
    return true;
  }

  /** Everything lets go — used when whatever was holding this piece up is gone. */
  collapse(dir = null) {
    if (this.state === 'gone' || this.state === 'collapsed') return;
    this.prefracture();
    if (this.state === 'intact') this.convert();
    if (!this.chunks) return;
    for (const c of this.chunks) if (c.state === 'attached') this.detach(c, dir, this.centre);
    this.state = 'collapsed';
    for (const s of this.carries) s.collapse();
    this.manager._breakFx(this.centre, 6, this.profile);
  }

  /** The piece nudges and sheds dust when it is close to letting go. */
  updateStress(dt) {
    if (this.stress <= 0.05 || this.state !== 'intact') {
      if (this._shakeBase) this._unshake();
      return;
    }
    const k = this.stress;
    if (!this._shakeBase) {
      this._shakeBase = this.meshes.map((m) => m.position.clone());
    }
    const a = k * k * 0.035;
    const t = this.manager.time * 34;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i], b = this._shakeBase[i];
      m.position.set(b.x + Math.sin(t + i) * a, b.y + Math.sin(t * 1.7 + i) * a * 0.5, b.z + Math.cos(t * 1.3 + i) * a);
      m.updateMatrix();
    }
    this.stress = Math.max(0, this.stress - dt * 0.12);
  }

  _unshake() {
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].position.copy(this._shakeBase[i]);
      this.meshes[i].updateMatrix();
    }
    this._shakeBase = null;
  }

  dispose() {
    this.state = 'gone';
    if (this._shakeBase) this._unshake();
    if (this.shell) {
      for (const m of this.shell) { this.world.scene?.remove(m); m.geometry.dispose(); }
      this.shell = null;
    }
    if (!this.chunks) return;
    for (const c of this.chunks) this.manager._forget(c, true);
    this.chunks = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The manager                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Owns every destructible piece, every loose chunk, and the budget that stops
 * a long fight from turning into a slideshow.
 *
 * It rides in `world.props` as one duck-typed prop, which is how it gets a
 * per-frame update, a slot in the blade solver's target list and the cut event
 * that comes back out of it, without a line of World.js changing.
 */
export class Destruction {
  constructor(world, opts = {}) {
    this.world = world;
    this.structures = [];
    this.live = [];                  // dynamic chunks
    this.settled = [];               // chunks that came to rest and went static
    this.time = 0;

    /**
     * The budget, measured rather than guessed. On the arena, with every piece
     * in the level collapsed at once, the Rapier step costs:
     *
     *   nothing broken   0.78 ms      64 live   3.2 ms
     *   32 live          1.8 ms       96 live   4.6 ms
     *                                160 live   7.5 ms
     *
     * Sixty-four is the most that leaves room for the rest of the frame, and it
     * is only ever reached by a player who has levelled half the arena.
     */
    const q = world.settings?.quality;
    this.maxLive = opts.maxLive ?? (q === 'low' ? 36 : q === 'high' ? 96 : 64);
    this.maxChunks = opts.maxChunks ?? this.maxLive * 3;
    this.maxCellsPerPiece = opts.maxCellsPerPiece ?? 18;
    this.prepareBudgetMs = opts.prepareBudgetMs ?? 1.2;
    this.settleSpeed = opts.settleSpeed ?? 0.4;
    this.settleTime = opts.settleTime ?? 1.4;
    this.settleDist = opts.settleDist ?? 24;
    this.chunkLife = opts.chunkLife ?? 34;
    this.bladeReach = opts.bladeReach ?? 3.4;
    this.prefractureRange = opts.prefractureRange ?? 30;
    this.impactSpeed = opts.impactSpeed ?? 7.5;

    this.rng = makeRng(opts.seed ?? 90210);
    this.stats = {
      prefractured: 0, prefractureMs: 0, detached: 0, settledCount: 0,
      despawned: 0, chunkTris: 0, breaks: 0,
    };

    this._impactCd = new Map();
    this._bladeSeen = new Map();
    this._bladeMark = new Map();
    this._caps = new Map();
    this._linked = false;
    this._pfCursor = 0;

    this.proxy = new DestructionProxy(this);
    if (world.addProp) world.addProp(this.proxy);
    else if (world.props) world.props.push(this.proxy);

    // Warm the fracture path. Measured in call order on the arena, the first
    // piece cost 9 ms and the thirtieth cost 1.4 — all of it V8 tiering up
    // through code that only runs once per piece. A throwaway fracture at load
    // buys most of that back before the player can see it.
    warmFracture();

    // Explosions already exist and already know how to shake the world; all
    // they were missing was somewhere to send the damage.
    const prev = world.onExplosion;
    if (typeof prev === 'function' && !prev.__destruction) {
      const wrapped = (centre, size = 1) => {
        prev.call(world, centre, size);
        this.explosion(centre, size);
      };
      wrapped.__destruction = true;
      world.onExplosion = wrapped;
      this._unwrap = () => { if (world.onExplosion === wrapped) world.onExplosion = prev; };
    }
  }

  /* ── registration ──────────────────────────────────────────────────── */

  register(spec) {
    if (!spec || !spec.profile) return null;
    const s = new Structure(this, spec);
    if (!(s.radius > 0.15)) return null;
    this.structures.push(s);
    this._linked = false;
    return s;
  }

  /**
   * Which pieces rest on which. Bounds-based and cheap — a piece whose base
   * sits at the top of another, overlapping it in plan, is being carried by it.
   * Run once, lazily, the first time anything breaks.
   */
  _linkSupports() {
    if (this._linked) return;
    this._linked = true;
    const n = this.structures.length;
    const world = [];
    for (const s of this.structures) {
      // a piece registered since the last pass invalidates the whole graph, so
      // rebuild it rather than appending the same links twice
      s.restsOn.length = 0;
      s.carries.length = 0;
      world.push(_worldBox(s, new THREE.Box3()));
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const a = world[i], b = world[j];
        if (a.min.y < b.max.y - 0.9 || a.min.y > b.max.y + 0.7) continue;
        if (a.min.x > b.max.x || b.min.x > a.max.x) continue;
        if (a.min.z > b.max.z || b.min.z > a.max.z) continue;
        this.structures[i].restsOn.push(this.structures[j]);
        this.structures[j].carries.push(this.structures[i]);
      }
    }
  }

  /* ── damage entry points ───────────────────────────────────────────── */

  /** Anything within `radius` of `centre` takes `amount`, falling off with distance. */
  damageSphere(centre, radius, amount, dir = null) {
    let hit = 0;
    for (const s of this.structures) {
      if (s.state === 'gone') continue;
      if (s.centre.distanceTo(centre) > radius + s.radius) continue;
      if (s.damageSphere(centre, radius, amount, dir)) hit++;
    }
    if (hit) this.stats.breaks++;
    return hit;
  }

  explosion(centre, size = 1) {
    const radius = 5.5 * size;
    // A fuel drum going off against a wall takes a bite out of the wall. The
    // same charge only chips a blast door, because that is what toughness is.
    this.damageSphere(centre, radius, 340 * size * size);
    // and the rubble that had already settled gets up again
    for (let i = this.settled.length - 1; i >= 0; i--) {
      const c = this.settled[i];
      if (!c.mesh || c.mesh.position.distanceTo(centre) > radius) continue;
      this._wake(c, centre, 12 * size);
    }
  }

  /** The Force, in a cone. Called from Player.forcePush. */
  forceBlast(origin, dir, range = 13, power = 1) {
    const cos = Math.cos(0.72);
    let hit = 0;
    for (const s of this.structures) {
      if (s.state === 'gone') continue;
      _v1.subVectors(s.centre, origin);
      const d = _v1.length();
      if (d > range + s.radius) continue;
      _v1.multiplyScalar(1 / Math.max(1e-4, d));
      if (_v1.dot(dir) < cos) continue;
      const k = clamp(1 - (d - s.radius) / range, 0.15, 1);
      // the push lands where the cone meets the piece, not at its centre
      _v2.copy(origin).addScaledVector(dir, Math.max(0.5, d - s.radius * 0.6));
      if (s.damageSphere(_v2, Math.max(2.2, s.radius * 0.7), 150 * power * k, dir)) hit++;
    }
    return hit;
  }

  /** Something heavy arrived fast. Polled, because Rapier contacts are not ours. */
  _impactScan(dt) {
    const bodies = this.world.physics?.bodies;
    if (!bodies || !this.structures.length) return;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b.static || b.invMass === 0 || !b.velocity) continue;
      const v2 = b.velocity.lengthSq();
      if (v2 < this.impactSpeed * this.impactSpeed) continue;
      if (b.mass < 6) continue;
      const last = this._impactCd.get(b.id) || 0;
      if (last > this.time) continue;
      const speed = Math.sqrt(v2);
      const reach = (b.boundingRadius || 0.4) + speed * dt * 1.5;
      for (const s of this.structures) {
        if (s.state === 'gone' || s.profile.hpPerM2 === Infinity) continue;
        if (s.centre.distanceToSquared(b.position) > (s.radius + reach + 1) ** 2) continue;
        if (_worldBox(s, _box).distanceToPoint(b.position) > reach) continue;
        this._impactCd.set(b.id, this.time + 0.3);
        const energy = 0.5 * b.mass * v2 * 0.02;
        s.damageSphere(b.position, Math.max(1.4, reach), energy, b.velocity);
        break;
      }
    }
    if (this._impactCd.size > 128) {
      for (const [k, t] of this._impactCd) if (t < this.time) this._impactCd.delete(k);
    }
  }

  /* ── the blade ─────────────────────────────────────────────────────── */

  /** Capsules for everything near the blade, published through the proxy prop. */
  bladeCapsules(near, out = []) {
    out.length = 0;
    this._caps.clear();
    const reach = this.bladeReach;
    for (const s of this.structures) {
      if (s.state === 'gone') continue;
      if (s.centre.distanceToSquared(near) > (s.radius + reach + 1) ** 2) continue;
      const n0 = out.length;
      s.bladeCapsules(near, reach, out);
      for (let i = n0; i < out.length; i++) this._caps.set(out[i].name, out[i]);
    }
    return out;
  }

  /**
   * The blade solver keeps its own book of how much work has gone into each
   * capsule; reading it is how a piece knows it is being cut before it parts,
   * which is what the crack, the dust and the shake are driven by.
   */
  _readBladeWork(dt) {
    const solver = this.world.bladeSolver;
    if (!solver || !solver.progress || !solver.progress.size) return;
    const pre = this.proxy.id + ':';
    for (const [key, work] of solver.progress) {
      if (!key.startsWith(pre)) continue;
      const cap = this._caps.get(key.slice(pre.length));
      if (!cap || !cap.structure) continue;
      const prev = this._bladeSeen.get(key) || 0;
      const delta = Math.max(0, work - prev);
      this._bladeSeen.set(key, work);
      if (delta <= 0) continue;
      const s = cap.structure;
      const at = _v2.lerpVectors(cap.p0, cap.p1, 0.5);
      s.wear(delta * 2.2, at);
      const frac = clamp(work / Math.max(1e-3, cap.toughness), 0, 1);
      s.stress = Math.max(s.stress, frac);
      if (this.rng() < 0.35) this._dust(at, 0.3 + s.stress * 0.5, s.profile.chip);
      // the kerf, widening: one mark when the blade has bitten, a bigger one
      // when the piece is nearly through. The same DecalField the blade already
      // scorches ground and armour with.
      const step = frac > 0.75 ? 2 : frac > 0.35 ? 1 : 0;
      if (step > (this._bladeMark.get(key) || 0)) {
        this._bladeMark.set(key, step);
        const P = this.world.particles;
        if (P && P.scorch) {
          _v3.subVectors(this.proxy.body.position, at);
          _v3.y = 0;
          if (_v3.lengthSq() < 1e-6) _v3.set(0, 1, 0); else _v3.normalize();
          P.scorch(at, _v3, 0.1 + step * 0.11, { heat: 1, life: 20, alpha: 0.8 });
        }
      }
    }
    if (this._bladeSeen.size > 256) {
      for (const k of this._bladeSeen.keys()) {
        if (!solver.progress.has(k)) { this._bladeSeen.delete(k); this._bladeMark.delete(k); }
      }
    }
  }

  /** The piece the blade actually parted. */
  structureAt(point, reach = 3) {
    let best = null, bestD = reach;
    for (const s of this.structures) {
      if (s.state === 'gone') continue;
      if (s.centre.distanceToSquared(point) > (s.radius + reach) ** 2) continue;
      const d = _worldBox(s, _box).distanceToPoint(point);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /* ── chunks ────────────────────────────────────────────────────────── */

  _updateChunks(dt, focus) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      const b = c.body;
      if (!b || b.dead || c.state !== 'live') { this.live.splice(i, 1); continue; }
      if (c.mesh) {
        c.mesh.position.copy(b.position);
        c.mesh.quaternion.copy(b.quaternion);
        c.mesh.updateMatrix();
      }
      c.age += dt;
      const still = b.velocity.lengthSq() < this.settleSpeed * this.settleSpeed
        && b.angularVelocity.lengthSq() < 0.6;
      c.rest = still ? c.rest + dt : 0;
      const far = !focus || b.position.distanceToSquared(focus) > this.settleDist * this.settleDist;
      if (c.rest > this.settleTime && (far || c.age > this.chunkLife * 0.5)) {
        this.live.splice(i, 1);
        this._settle(c);
      } else if (c.age > this.chunkLife) {
        this.live.splice(i, 1);
        if (still) this._settle(c); else this._forget(c, true);
      }
    }

    // the hard cap: oldest out first
    while (this.live.length > this.maxLive) {
      let oldest = 0;
      for (let i = 1; i < this.live.length; i++) if (this.live[i].age > this.live[oldest].age) oldest = i;
      const c = this.live[oldest];
      this.live.splice(oldest, 1);
      const still = c.body && c.body.velocity.lengthSq() < 1;
      const far = !focus || !c.body || c.body.position.distanceToSquared(focus) > 144;
      if (still && far) this._settle(c); else this._forget(c, true);
    }
    while (this.live.length + this.settled.length > this.maxChunks && this.settled.length) {
      this._forget(this.settled.shift(), true);
    }
  }

  /** At rest and out of the way: give the solver its body back. */
  _settle(chunk) {
    if (chunk.state !== 'live') return;
    const b = chunk.body;
    if (b) {
      if (chunk.mesh) { chunk.mesh.position.copy(b.position); chunk.mesh.quaternion.copy(b.quaternion); chunk.mesh.updateMatrix(); }
      this.world.physics?.remove?.(b);
      chunk.body = null;
    }
    chunk.state = 'settled';
    chunk.staticBox = this.world.physics?.addStaticBox?.(
      chunk.mesh ? chunk.mesh.position.clone() : chunk.worldCentre(),
      chunk.half.clone().max(_v1.set(0.03, 0.03, 0.03)),
      chunk.mesh ? chunk.mesh.quaternion.clone() : IDENT.clone(),
      { friction: 0.9 }) || null;
    this.settled.push(chunk);
    this.stats.settledCount++;
  }

  /** Settled rubble, kicked back into life by an explosion. */
  _wake(chunk, from, power) {
    const i = this.settled.indexOf(chunk);
    if (i >= 0) this.settled.splice(i, 1);
    if (chunk.staticBox) { this.world.physics?.removeStaticBox?.(chunk.staticBox); chunk.staticBox = null; }
    chunk.state = 'attached';                       // so detach() will take it
    chunk.structure.attached++;
    chunk.structure.detach(chunk, null, from);
    if (chunk.body) {
      _v1.subVectors(chunk.body.position, from).normalize().multiplyScalar(chunk.mass * power);
      _v1.y += chunk.mass * power * 0.5;
      chunk.body.applyImpulse(_v1, chunk.body.position);
    }
  }

  /** Gone for good. `hard` also drops the mesh; otherwise the level owns it. */
  _forget(chunk, hard = true) {
    if (!chunk || chunk.state === 'gone') return;
    const li = this.live.indexOf(chunk);
    if (li >= 0) this.live.splice(li, 1);
    const si = this.settled.indexOf(chunk);
    if (si >= 0) this.settled.splice(si, 1);
    if (chunk.body) { this.world.physics?.remove?.(chunk.body); chunk.body = null; }
    if (chunk.staticBox) { this.world.physics?.removeStaticBox?.(chunk.staticBox); chunk.staticBox = null; }
    if (chunk.mesh) { this.world.scene?.remove(chunk.mesh); chunk.mesh = null; }
    // an attached cell has geometry but no mesh of its own — it lives in the
    // merged shell — so the geometry has to be released here either way
    if (hard && chunk.geo) chunk.geo.dispose();
    if (chunk.state === 'attached' && chunk.structure) {
      chunk.structure.attached--;
      chunk.structure.shellDirty = true;
    }
    chunk.state = 'gone';
    chunk.geo = null;
    this.stats.despawned++;
  }

  /* ── frame ─────────────────────────────────────────────────────────── */

  update(dt) {
    if (!(dt > 0)) dt = 0;
    this.time += dt;
    const focus = this.world.player?.position || null;
    if (focus) this.proxy.body.position.copy(focus);

    this._readBladeWork(dt);
    this._updateChunks(dt, focus);
    if (focus) this._impactScan(dt);
    for (const s of this.structures) {
      if (s._shakeBase || s.stress > 0.05) s.updateStress(dt);
      if (s.shellDirty) s.rebuildShell();
    }
    if (focus) this._prepare(focus);
  }

  /**
   * Getting a piece ready to break, a slice of a millisecond at a time.
   *
   * Doing it when the piece is hit costs five milliseconds in the one frame
   * that can least afford it. Doing it at level build costs half a second of
   * load for fifty pieces most of which are never touched. So it is done here:
   * nearest first, inside a frame budget, cells for one piece and then its
   * geometry a few cells at a time.
   */
  _prepare(focus) {
    const n = this.structures.length;
    if (!n) return;
    const range2 = this.prefractureRange * this.prefractureRange;
    const t0 = now();
    let did = false;
    for (let i = 0; i < n && now() - t0 < this.prepareBudgetMs; i++) {
      const s = this.structures[(this._pfCursor + i) % n];
      if (s.state === 'gone' || s.prepared) continue;
      if (s.centre.distanceToSquared(focus) > range2) continue;
      if (!s.chunks) {
        s.prefracture();
        this._pfCursor = (this._pfCursor + i) % n;
        return;                                  // cells are a whole frame's work
      }
      for (const c of s.chunks) {
        if (c.geo || c.state === 'gone') continue;
        s.prepareCell(c);
        did = true;
        if (now() - t0 >= this.prepareBudgetMs) break;
      }
      this._pfCursor = (this._pfCursor + i) % n;
      if (did) return;
    }
  }

  /* ── feedback ──────────────────────────────────────────────────────── */

  _dust(pos, power, color) {
    const P = this.world.particles;
    if (!P) return;
    if (P.dust) {
      for (let i = 0; i < Math.max(1, Math.round(3 * power)); i++) {
        _v1.set((this.rng() - 0.5) * 1.2, -0.4 - this.rng() * 1.2, (this.rng() - 0.5) * 1.2);
        P.dust.spawn(pos, _v1, { life: 0.9 + this.rng(), size: 0.16 + this.rng() * 0.2 * power,
          drag: 2.4, gravity: 0.7, color, alpha: 0.12 + 0.1 * this.rng() });
      }
    }
    if (P.chipBurst && this.rng() < 0.3) P.chipBurst(pos, null, 2, { speed: 2.6, size: 0.035, color });
  }

  _breakFx(pos, count, profile, cut = false) {
    const P = this.world.particles;
    const power = clamp(0.5 + count * 0.25, 0.5, 3);
    if (P) {
      P.sandPuff?.(pos.clone(), power, pos.y, profile.chip, { dir: null });
      P.chipBurst?.(pos, null, Math.round(4 + count * 2), { speed: 4 + count, size: 0.06, color: profile.chip });
      if (P.smoke) {
        for (let i = 0; i < Math.round(2 + count); i++) {
          _v1.set((this.rng() - 0.5) * 2.4, 0.6 + this.rng(), (this.rng() - 0.5) * 2.4);
          P.smoke.spawn(pos, _v1, { life: 1.6 + this.rng(), size: 0.5 + 0.2 * power, drag: 1.9,
            gravity: -0.7, color: 0x6a6358, alpha: 0.26 });
        }
      }
    }
    audio.thud?.(pos, clamp(power * 0.7, 0.3, 1.4));
    if (!cut) {
      audio.noise?.({ dur: 0.45, gain: 0.16 * clamp(power, 0.4, 1.4), type: 'lowpass',
        freq: 900, freqEnd: 120, q: 0.8, pos, pink: true });
    }
  }

  /* ── bookkeeping ───────────────────────────────────────────────────── */

  report() {
    let cells = 0, attached = 0, broken = 0;
    for (const s of this.structures) {
      if (s.chunks) cells += s.chunks.length;
      attached += s.attached;
      if (s.state !== 'intact') broken++;
    }
    return {
      structures: this.structures.length, broken, cells, attached,
      live: this.live.length, settled: this.settled.length,
      ...this.stats,
    };
  }

  dispose() {
    for (const c of this.live.slice()) this._forget(c, true);
    for (const c of this.settled.slice()) this._forget(c, true);
    for (const s of this.structures) s.dispose();
    this.structures.length = 0;
    this.live.length = 0;
    this.settled.length = 0;
    this._caps.clear();
    this._bladeSeen.clear();
    this._bladeMark.clear();
    this._impactCd.clear();
    this._unwrap?.();
    if (this.world.destruction === this) this.world.destruction = null;
    const props = this.world.props;
    if (props) {
      const i = props.indexOf(this.proxy);
      if (i >= 0) props.splice(i, 1);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The proxy prop                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A Prop as far as World is concerned, and nothing like one underneath.
 *
 * World already walks `props` every frame to update them, to build the blade
 * solver's target list, and to route the cut event that comes back. Riding in
 * that list is what lets all of this exist without World.js knowing about it.
 * The body is a stub: `boundingRadius` is zero so the bolt sweep can never
 * select it, and `position` tracks the player so the solver's 5 m target cull
 * never drops us.
 */
class DestructionProxy {
  constructor(manager) {
    this.id = 'destr' + (_structId++);
    this.manager = manager;
    this.dead = false;
    this.kind = 'destruction';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;
    this.body = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  capsules(out = []) {
    return this.manager.bladeCapsules(this.body.position, out);
  }

  /** The blade got through. Returns [] — there are no halves to hand back. */
  cut(planePoint, planeNormal, impulse) {
    const s = this.manager.structureAt(planePoint, 3.2);
    if (s) s.cutBy(planePoint, planeNormal, impulse);
    return [];
  }

  shatter(dir, point) {
    if (!point) return;
    const s = this.manager.structureAt(point, 3.2);
    if (s) s.damageSphere(point, Math.max(2, s.profile.cell * 1.6), s.maxHp * 2, dir);
  }

  damage() { return false; }
  update(dt) { this.manager.update(dt); }
  destroy() { this.dead = true; this.manager.dispose(); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Entry points                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/** The world's manager, made on demand. */
export function attachDestruction(world, opts = {}) {
  if (!world) return null;
  if (world.destruction) return world.destruction;
  if (!world.props && !world.addProp) return null;
  world.destruction = new Destruction(world, opts);
  return world.destruction;
}

/**
 * Register a piece of architecture as destructible. Called by Props.js when a
 * maker finishes emitting; levels can call it directly for anything bespoke.
 */
export function registerDestructible(world, spec) {
  if (!spec || !spec.profile) return null;
  if (!spec.meshes || !spec.meshes.length) return null;
  const m = attachDestruction(world);
  return m ? m.register(spec) : null;
}

/* ── small helpers ───────────────────────────────────────────────────── */

let _warmed = false;
/** Run the fracture path once on a throwaway solid so it is compiled hot. */
function warmFracture() {
  if (_warmed) return;
  _warmed = true;
  const b = new THREE.Box3(new THREE.Vector3(-1, 0, -0.4), new THREE.Vector3(1, 3, 0.4));
  const pts = [];
  for (let i = 0; i < 240; i++) {
    pts.push(-1 + (i % 7) / 3, (i % 13) * 0.23, -0.4 + ((i * 3) % 5) * 0.2);
  }
  const cells = fractureSolid(b, new Float32Array(pts), { cell: 0.7, seed: 3, maxCells: 12 });
  for (const c of cells) {
    const g = polyGeometry(c.poly, c.centre, 0.3);
    polyHullPoints(c.poly, c.centre);
    g?.dispose();
  }
}

const _m4 = new THREE.Matrix4();
const _ONE = new THREE.Vector3(1, 1, 1);
function _m4From(p, q) { return _m4.compose(p, q, _ONE); }
function _worldBox(s, out) { return out.copy(s.local).applyMatrix4(_m4From(s.position, s.quaternion)); }
function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
