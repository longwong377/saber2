/**
 * BATTLEFRONT BORZ — destructible architecture.
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
import { TOUGHNESS, cutNeed } from '../game/Combat.js';
import { clamp, makeRng } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _box = new THREE.Box3();
const _boxA = new THREE.Box3(), _boxB = new THREE.Box3(), _cellBox = new THREE.Box3();
const IDENT = new THREE.Quaternion();

/**
 * Half the width of the slot a blade leaves behind, in metres.
 *
 * Two places need it and they need the same number. Deciding which cells a cut
 * event was IN, the point may fall this far outside one and still have been in
 * both — the blade is 5 cm of plasma and the samples the cells were built from
 * are about 2 cm apart. Deciding whether a neighbour still bridges a cut, it is
 * how much stone has to be left on this side of the plane to count: a fragment
 * the blade made on that very plane has its cut face exactly ON it, so a strict
 * "is it on the other side" came out 0 > 0 and was settled by the last bit of
 * the float, and half the kerfs on a column leaked.
 */
const KERF = 0.04;

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
  /* THE ONE SOFT THING IN THE TABLE, and every number in it is taken off the
   * loose crate `Props.makeCrate` already builds rather than picked to look
   * plausible beside the masonry above.
   *
   * A crate stack's lower courses are merged static geometry — that is the
   * whole point of the maker — and merged static geometry used to mean
   * untouchable, which is exactly the complaint `island()` was made
   * destructible to answer: "everything built as an island was a static box
   * with a picture on it". A pile of boxes you cannot cut is the same defect
   * wearing crates, and `sliceable` measures it the moment a pile is small
   * enough to fall inside its 3.2 m survey window: geonosis went from 4 of 41
   * reachable objects untouchable to 10 of 33 when its stacks shrank to the
   * two-to-five boxes their call sites ask for.
   *
   *   toughness  TOUGHNESS.plastoid — makeCrate's own, so a crate in a stack
   *              parts under the blade exactly as the loose one beside it does
   *   density    makeCrate is `mass: 22 * s` over a box of s × 0.9s × s, which
   *              at its default 0.7 m is 15.4 kg in 0.309 m³ = 50 kg/m³
   *   hpPerM2    chosen so `cellHp` of ONE crate comes out at makeCrate's own
   *              hp of 34: 34 / (4.8 · ∛(0.46²)) for the 0.8 m crate these
   *              stacks are built from = 11.9
   *   cell       0.9 — one chunk per crate, because a stack comes apart into
   *              the boxes it is made of and not into splinters */
  crate: { toughness: TOUGHNESS.plastoid, density: 50, hpPerM2: 11.9, cell: 0.9, chip: 0x9c8352 },
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
 * The thirteen axes of a 26-DOP: three faces, six edges, four corners of a
 * cube, each as a unit vector. Clipping a cell to the extent of its own
 * surface along all thirteen is what makes a fractured column round.
 *
 * Measured, on the column the player complained about: clipped to the AABB of
 * its samples the cells summed to 15.6 m³ against the mesh's 8.3 — a shaft
 * 1.10 m across became a post 1.32 m square, which is the "volume looked
 * larger than what it was" pop. The same cells clipped to this DOP sum to
 * 9.0 m³. Six planes cannot describe a cylinder; twenty-six nearly can, and
 * the error left is the 1.055 an octagon circumscribing a circle costs.
 */
const DOP_AXES = (() => {
  const r2 = Math.SQRT1_2, r3 = 1 / Math.sqrt(3);
  return [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(r2, r2, 0), new THREE.Vector3(r2, -r2, 0),
    new THREE.Vector3(r2, 0, r2), new THREE.Vector3(r2, 0, -r2),
    new THREE.Vector3(0, r2, r2), new THREE.Vector3(0, r2, -r2),
    new THREE.Vector3(r3, r3, r3), new THREE.Vector3(r3, r3, -r3),
    new THREE.Vector3(r3, -r3, r3), new THREE.Vector3(-r3, r3, r3),
  ];
})();
const DOP_N = DOP_AXES.length;

/**
 * Support intervals per axis, four numbers each:
 *
 *   [4a]   min over every sample          the plane, on the low side
 *   [4a+1] max over every sample          the plane, on the high side
 *   [4a+2] min over samples FACING -axis   is there a face capping the low side?
 *   [4a+3] max over samples FACING +axis   … and the high side?
 *
 * The second pair is what keeps a cell solid. A quarter of a column's shaft
 * has samples only on its arc, and the convex hull of an arc is the segment
 * behind its chord — so clipping to the samples alone cut the middle out of
 * the shaft and left four crescents around a hole. Measured on the column:
 * 90.6% of the intact solid covered, and 77% of what was missing sat within a
 * third of a radius of the axis, which is exactly the inscribed square the
 * four chords sliced off. The arc's normals all point outward from the axis,
 * so nothing on that arc caps the cell in the direction of the axis — the
 * Voronoi wall does, and the material runs right up to it.
 */
const FACE_COS = 0.35;      // ~70° — a face still counts as capping when oblique
const FACE_TOL = 0.05;      // the outermost sample must be front-facing to 5 cm
// flat copy of the axes: this is called a few hundred thousand times per
// fracture and the property loads off thirteen Vector3s were most of it
const DOP_F = (() => {
  const f = new Float64Array(DOP_N * 3);
  for (let a = 0; a < DOP_N; a++) { f[a * 3] = DOP_AXES[a].x; f[a * 3 + 1] = DOP_AXES[a].y; f[a * 3 + 2] = DOP_AXES[a].z; }
  return f;
})();
function newDop() {
  const d = new Float32Array(DOP_N * 4);
  for (let a = 0; a < DOP_N; a++) {
    d[a * 4] = Infinity; d[a * 4 + 1] = -Infinity;
    d[a * 4 + 2] = Infinity; d[a * 4 + 3] = -Infinity;
  }
  return d;
}
function dopAdd(d, x, y, z, nx, ny, nz) {
  for (let a = 0, o = 0; a < DOP_N; a++, o += 3) {
    const ax = DOP_F[o], ay = DOP_F[o + 1], az = DOP_F[o + 2];
    const t = ax * x + ay * y + az * z;
    const i = a * 4;
    if (t < d[i]) d[i] = t;
    if (t > d[i + 1]) d[i + 1] = t;
    const f = ax * nx + ay * ny + az * nz;
    if (f <= -FACE_COS && t < d[i + 2]) d[i + 2] = t;
    if (f >= FACE_COS && t > d[i + 3]) d[i + 3] = t;
  }
}
/**
 * Trim `poly` to the DOP, grown by `pad`. Returns null if nothing survives.
 *
 * The negated axes are kept rather than made per call: clipPoly clobbers _v1
 * and _v2 while it sorts the cap ring, so a normal handed to it out of module
 * scratch changes under its feet halfway through the call.
 */
const DOP_NEG = DOP_AXES.map((n) => n.clone().negate());

/**
 * Keep the half-space `s·(p[ax] − c) <= 0` of a polygon held flat as xyz triples.
 * Sutherland–Hodgman again, but against an axis-aligned plane, so the only work
 * per vertex is one subtraction and one lerp.
 */
function clipAxisPoly(src, n, ax, s, c, dst) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 3, b = ((i + 1) % n) * 3;
    const da = s * (src[a + ax] - c), db = s * (src[b + ax] - c);
    if (da <= 0) { dst[m * 3] = src[a]; dst[m * 3 + 1] = src[a + 1]; dst[m * 3 + 2] = src[a + 2]; m++; }
    if ((da > 0) !== (db > 0)) {
      const u = da / (da - db);
      dst[m * 3] = src[a] + (src[b] - src[a]) * u;
      dst[m * 3 + 1] = src[a + 1] + (src[b + 1] - src[a + 1]) * u;
      dst[m * 3 + 2] = src[a + 2] + (src[b + 2] - src[a + 2]) * u;
      m++;
    }
  }
  return m;
}

function dopClip(poly, d, pad) {
  for (let a = 0; a < DOP_N && poly; a++) {
    const lo = d[a * 4], hi = d[a * 4 + 1], loF = d[a * 4 + 2], hiF = d[a * 4 + 3];
    if (!isFinite(lo)) continue;
    if (hi - hiF <= FACE_TOL) {
      poly = clipPoly(poly, DOP_AXES[a], -(hi + pad));
      if (!poly) return null;
    }
    if (loF - lo <= FACE_TOL) poly = clipPoly(poly, DOP_NEG[a], lo - pad);
  }
  return poly;
}

/**
 * How far a site may wander off its lattice centre, as a fraction of the step.
 * Under one, so a cell is still built from its 26 lattice neighbours alone and
 * is still the exact Voronoi cell; and the half of it bounds how far a cell can
 * reach past its own lattice box, which is what the triangle support below is
 * clipped to.
 */
const GRID_JITTER = 0.62;

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
  const job = fractureJob(bounds, samples, opts);
  job.step(NEVER);
  return job.cells;
}

/** A deadline that never expires — what the eager callers pass. */
const NEVER = () => false;

/**
 * How many iterations of each of the four hot loops run between two looks at
 * the clock.
 *
 * Large enough that the `performance.now()` a look costs is amortised to
 * nothing — fracturing the temple's worst piece, 10,979 surface samples and
 * 10,897 triangles, reads the clock a few dozen times in total — and small
 * enough that the slice is not itself the hitch. Swept on the temple with a
 * player walking for 3000 frames: at 512/4/512/2 the worst frame the
 * approach-time path spends is 10.9 ms and at 64/1/64/1 it is 7.7 ms, against
 * 37-60 ms before any of this. The remaining floor is not the loop granularity
 * — it is the phase transitions and the geometry build that shares the same
 * budget — so the coarser numbers are kept and the eager path pays nothing for
 * them.
 */
const SLICE_SAMPLES = 512;
const SLICE_SITES = 4;
const SLICE_TRIS = 512;
const SLICE_CELLS = 2;
/* The fifth, and it was missing — see the note in `splitVoidsPhase`. Cells and
 * not iterations, like SLICE_SITES, because the unit here is one `findVoid`
 * over one cell's samples: four of them is 0.13 ms on the worst piece on the
 * colosseum where the whole sweep was 0.84. */
const SLICE_VOIDS = 4;

/**
 * THE SAME FRACTURE, HANDED BACK A SLICE AT A TIME.
 *
 * Why this is not one function any more. `Destruction._prepare` gives a piece
 * a whole frame to fracture — `return; // cells are a whole frame's work` — and
 * a whole frame is not enough. Every structure in the game, timed individually
 * through its own `prefracture()` on a freshly loaded level: 389 structures,
 * median 7.5 ms, p90 14.7, max 76 ms, and 27 to 41 of them (7-11%, the count
 * moves with contention) over a whole 16.7 ms frame — up to 4.6x the frame they
 * are allotted. In play it is worse: a player walking a 22 m circle on the
 * temple with the director off and no enemies at all, 3000 frames, had
 * `prefracture` fire on 57-92 of them with a maximum of 76 ms, 11 frames over
 * 16.7 ms and 2 over 50. That is a visible hitch about every four seconds of
 * walking, with nothing on screen to explain it — and it fires on APPROACH,
 * at `prefractureRange` 30 m, not on contact.
 *
 * Meanwhile the half that IS budgeted behaves perfectly: `prepareCell` fires
 * at a median 0.77 ms against its 1.2 ms budget and a worst case of 3.0. The
 * budget works. It was simply never applied to the expensive half.
 *
 * WHY A JOB OBJECT AND NOT A GENERATOR. A generator is the obvious shape for
 * this and it was tried first: the whole body converted to `function*` with a
 * `yield` every few hundred iterations, drained by the eager entry point.
 * Measured, four interleaved rounds over the temple's 126 structures, one
 * process each so contention hits both equally: eager 1360/1476/1446/1464 ms
 * total against 1958/1917/2197/2514 for the generator, and a median piece of
 * 8.4-9.1 ms against 10.6-12.9. V8 will not optimise these loops inside a
 * generator body, and paying 35-70% more total work to spread it is a bad
 * trade. So the loops stay exactly as they were, in plain functions, and only
 * the state they run over is hoisted into an object.
 *
 * The phases below are the ones that cost something, measured over all 389
 * structures: triangle clip 24%, sample assignment 19.5%, cell shrink 18%,
 * cell build 13%, void split 5%, grid and chunk construction under 1% between
 * them (the remaining ~20% is `_surfaceSamples`, which is sliced the same way).
 * Four of the five are flat index loops whose iterations touch only their own
 * accumulator, so cutting them at any index is exactly the same arithmetic in
 * the same order.
 *
 * `step(overBudget)` runs until `overBudget()` says stop and returns true when
 * the whole job is finished; `cells` is only populated then.
 */
export function fractureJob(bounds, samples, opts = {}) {
  const st = fractureSetup(bounds, samples, opts);
  const phases = [assignSamples, buildCells, clipTriangles, shrinkCells, splitVoidsPhase];
  const job = {
    cells: null,
    step(overBudget) {
      while (st.phase < phases.length) {
        if (!phases[st.phase](st, overBudget)) return false;
        st.phase++;
        if (st.phase < phases.length && overBudget()) return false;
      }
      job.cells = st.out;
      return true;
    },
  };
  return job;
}

function fractureSetup(bounds, samples, opts) {
  const target = Math.max(0.35, opts.cell ?? 1.35);
  const maxCells = opts.maxCells ?? 28;
  const rng = makeRng(opts.seed ?? 7);

  const size = bounds.getSize(new THREE.Vector3());
  const min = bounds.min;
  // Two cells across anything thicker than SPLIT_MIN, whatever the target
  // says. One cell spanning the piece on an axis means there is no such thing
  // as a partial cut across that axis: a 1.66 m column rounded to a single
  // 1.66 m cell, so the blade could only ever take the whole section at a
  // level, and a third of the way in dropped the top exactly as a clean cut
  // did. 0.7 m is the floor because half of that is a 0.35 m chunk, the
  // smallest lump worth a rigid body of its own. The cap below walks this
  // back down, so nothing gets more cells than it is allowed.
  const SPLIT_MIN = 0.7;
  const floorOf = (l) => (l > SPLIT_MIN ? 2 : 1);
  const fx = floorOf(size.x), fy = floorOf(size.y), fz = floorOf(size.z);
  const span = (l, f) => Math.max(f, Math.round(l / target));
  const nx = span(size.x, fx), ny = span(size.y, fy), nz = span(size.z, fz);
  let scale = 1;
  if (nx * ny * nz > maxCells) scale = Math.cbrt((nx * ny * nz) / maxCells);
  let gx = Math.max(fx, Math.round(nx / scale));
  let gy = Math.max(fy, Math.round(ny / scale));
  let gz = Math.max(fz, Math.round(nz / scale));
  // rounding three axes up can overshoot the cap by half again; walk the
  // longest axis down until it fits, so `maxCells` is a real ceiling. The
  // two-across floor survives the walk: 2×2×2 is eight, so a piece can always
  // afford to be carvable on every axis it is thick enough to carve.
  while (gx * gy * gz > maxCells) {
    if (gx >= gy && gx >= gz && gx > fx) gx--;
    else if (gy >= gz && gy > fy) gy--;
    else if (gz > fz) gz--;
    else if (gx > fx) gx--;
    else if (gy > fy) gy--;
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
          min.x + (i + 0.5 + (rng() - 0.5) * GRID_JITTER) * sx,
          min.y + (j + 0.5 + (rng() - 0.5) * GRID_JITTER) * sy,
          min.z + (k + 0.5 + (rng() - 0.5) * GRID_JITTER) * sz);
        P[idx * 3] = p.x; P[idx * 3 + 1] = p.y; P[idx * 3 + 2] = p.z;
        sites.push({ i, j, k, index: idx, p, n: 0, dop: null, mats: null, nbrs: null, list: null });
      }
    }
  }
  const matOf = opts.matOf;
  const nrm = opts.normals || null;
  const cnt = samples ? samples.length / 3 : 0;
  const siteOf = cnt ? new Int32Array(cnt).fill(-1) : null;
  const lo = [min.x, min.y, min.z], inv = [1 / sx, 1 / sy, 1 / sz];
  return {
    phase: 0, cursor: 0,
    bounds, samples, size, min, maxCells,
    gx, gy, gz, sx, sy, sz, sites, P, matOf, nrm, cnt, siteOf, lo, inv,
    // A cell that holds none of the piece's surface is empty space — the hole
    // in an arch, the air above a broken wall's jagged top — and must not
    // become a block of stone hanging in it.
    floor: cnt ? Math.max(1, Math.floor(cnt / (sites.length * 26))) : 0,
    kept: [], out: [], voids: null,
    corners: opts.corners, triAt: opts.triAt,
    A: new Float64Array(48), B: new Float64Array(48),
  };
}

/** Which cell does each surface sample belong to? (nearest site = Voronoi) */
function assignSamples(st, overBudget) {
  const { samples, gx, gy, gz, P, sites, matOf, nrm, cnt, siteOf, lo, inv } = st;
  let s = st.cursor;
  while (s < cnt) {
    const end = Math.min(cnt, s + SLICE_SAMPLES);
    for (; s < end; s++) {
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
      siteOf[s] = bestI;
      (best.list || (best.list = [])).push(s);
      dopAdd(best.dop || (best.dop = newDop()), x, y, z,
        nrm ? nrm[s * 3] : 0, nrm ? nrm[s * 3 + 1] : 0, nrm ? nrm[s * 3 + 2] : 0);
      if (matOf) {
        const m = matOf(s);
        (best.mats || (best.mats = new Map())).set(m, (best.mats.get(m) || 0) + 1);
      }
    }
    if (s < cnt && overBudget()) { st.cursor = s; return false; }
  }
  st.cursor = 0;
  return true;
}

/** One convex cell per site that holds any of the piece's surface. */
function buildCells(st, overBudget) {
  const { bounds, size, gx, gy, gz, sites, cnt, floor, kept } = st;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz)
    ? null : sites[(k * gy + j) * gx + i];
  let si = st.cursor;
  while (si < sites.length) {
    const end = Math.min(sites.length, si + SLICE_SITES);
    for (; si < end; si++) {
      const s = sites[si];
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
      s.poly = poly;
      s.keptNbrs = nbrs;
      s.aabb = polyBounds(poly, new THREE.Box3());
      kept.push(s);
    }
    if (si < sites.length && overBudget()) { st.cursor = si; return false; }
  }
  st.cursor = 0;
  return true;
}

/* Each triangle's own surface, clipped to the cell, as support — not its
 * corners.
 *
 * The corners were the obvious thing and they are wrong twice over. A corner
 * across the wall belongs to the neighbour: fed to this cell it pushes the
 * clip plane out past the wall, where it can never bite, and the cell goes
 * slack (measured on the column, 1.37 → 1.52 on the volume ratio). Dropped
 * instead — which is what this did — a triangle that spans two cells supports
 * NEITHER of them, so the only thing describing the surface across the middle
 * of a big face is the barycentric lattice, whose step is ~15 cm at this
 * budget. Measured on the lintel, whose beam is two triangles 6.4 m long: the
 * cells covered 91.2% of the intact solid, the missing 8.8% a 3 cm skin spread
 * evenly over every face of every cell, and the 2 cm pad covering none of it.
 *
 * What a cell wants is the extreme of (triangle ∩ cell), so that is what it
 * gets: the triangle clipped to the cell's own bounding box, which is why the
 * cells are built first and trimmed second. Every vertex of the clipped
 * polygon lies ON the triangle, so it can never claim material the surface
 * does not have, and inside the box, so it can never reach across the wall.
 * Measured, against dropping the corner: column 95.6 → 99.8% covered, lintel
 * 91.2 → 96.3%, wall 98.5 → 99.6%, and the volume ratio pays 1.25 → 1.33 on
 * the column, all of it the difference between the cell and its box. It costs
 * six axis-aligned plane tests on a polygon of three to nine points — 4.4 ms
 * on the 10274-triangle gate, and nothing at all on a piece that is mostly
 * bevels, whose triangles are all below the size cut-off.
 *
 * It is also the single most expensive phase of a fracture — 24% of the 3.3 s
 * the game's 389 structures cost between them — so it is the one that most
 * needs to be able to stop in the middle. Every iteration reads one triangle
 * and adds to one site's support hull, touching nothing another iteration
 * reads, so cutting it at any index is the same arithmetic in the same order.
 */
function clipTriangles(st, overBudget) {
  const { corners, triAt, nrm, sites, siteOf } = st;
  if (!corners || !triAt || !nrm) { st.cursor = 0; return true; }
  let A = st.A, B = st.B;
  let t = st.cursor;
  while (t < triAt.length) {
    const end = Math.min(triAt.length, t + SLICE_TRIS);
    for (; t < end; t++) {
      const s = triAt[t], si = siteOf[s];
      if (si < 0) continue;
      const site = sites[si];
      const d = site.dop, bb = site.aabb;
      if (!d || !bb) continue;
      const nx = nrm[s * 3], ny = nrm[s * 3 + 1], nz = nrm[s * 3 + 2], o = t * 9;
      let n = 3;
      for (let i = 0; i < 9; i++) A[i] = corners[o + i];
      for (let ax = 0; ax < 3 && n; ax++) {
        const c0 = ax === 0 ? bb.min.x : ax === 1 ? bb.min.y : bb.min.z;
        const c1 = ax === 0 ? bb.max.x : ax === 1 ? bb.max.y : bb.max.z;
        n = clipAxisPoly(A, n, ax, 1, c1, B); let tmp = A; A = B; B = tmp;
        if (!n) break;
        n = clipAxisPoly(A, n, ax, -1, c0, B); tmp = A; A = B; B = tmp;
      }
      for (let i = 0; i < n; i++) dopAdd(d, A[i * 3], A[i * 3 + 1], A[i * 3 + 2], nx, ny, nz);
    }
    // A and B are swapped inside the loop and which one ends up in `A` does
    // NOT have to survive a resumption: both are pure scratch, refilled from
    // `corners` at the top of every triangle. They live on the job only so the
    // job owns its own working memory rather than reallocating 96 doubles
    // every time it is resumed.
    st.A = A; st.B = B;
    if (t < triAt.length && overBudget()) { st.cursor = t; return false; }
  }
  st.cursor = 0;
  return true;
}

/** Shrink each cell onto the surface it actually holds. */
function shrinkCells(st, overBudget) {
  const { kept, cnt, out } = st;
  let ki = st.cursor;
  while (ki < kept.length) {
    const end = Math.min(kept.length, ki + SLICE_CELLS);
    for (; ki < end; ki++) {
      const s = kept[ki];
      const nbrs = s.keptNbrs;
      // Shrink the cell onto the surface it actually holds, so a chunk of arch
      // is arch-shaped rather than a brick from the bounding box — and so the
      // fractured piece occupies the space the intact mesh did and not the space
      // its bounding box did.
      //
      // `pad` is 2 cm and not a fraction of the cell, which is what it used to
      // be. It only has to cover the gap between the outermost support on a face
      // and the true edge of that face, and the triangle clip above makes that gap
      // zero for every triangle big enough to matter. Scaled to the cell it was
      // 16 cm on a stone column and grew a 1.10 m shaft into a 1.42 m one all by
      // itself. Swept with the clip in place: 0.5 cm leaves the column 99.7%
      // covered at 1.30× the mesh's volume, 2 cm 99.8% at 1.33×, 8 cm 100% at
      // 1.53× — and the silhouette 1.11× at two, 1.21× at eight. Two is where the
      // last of the shrinking has gone and none of the growing has started.
      let poly = s.poly;
      if (cnt && s.dop) poly = dopClip(poly, s.dop, 0.02);
      if (!poly) continue;
      const volume = polyVolume(poly);
      if (!(volume > 1e-5)) continue;
      const centre = polyCentroid(poly);
      if (!isFinite(centre.x) || !isFinite(centre.y) || !isFinite(centre.z)) continue;
      let mat = null, bestN = 0;
      if (s.mats) for (const [m, n] of s.mats) if (n > bestN) { bestN = n; mat = m; }
      out.push({ poly, centre, volume, bounds: polyBounds(poly), samples: s.n, mat,
        site: s.index, nbrs, list: s.list });
    }
    if (ki < kept.length && overBudget()) { st.cursor = ki; return false; }
  }
  st.cursor = 0;
  return true;
}

/**
 * Cutting the cells that straddle a hole, one cut per slice.
 *
 * 5% of a fracture in the aggregate and a median of 0.27 ms, so it looks at
 * first like the one phase that could safely run whole — but the tail says
 * otherwise: p99 2.27 ms and a worst piece at 20.66 ms, over a whole frame by
 * itself. Two of the game's 390 structures are over 5 ms here. Each turn of the
 * loop finds the widest void across the cells built so far and splits ONE cell,
 * so the loop's own boundary is the seam, and everything it carries between
 * turns — the split counter, the per-cell void cache, the guard — moves onto
 * the job.
 */
function splitVoidsPhase(st, overBudget) {
  const { out, samples, nrm, matOf, sites, maxCells } = st;
  if (nrm && st.cnt) {
    const vs = st.voids || (st.voids = { nextSite: sites.length, seen: new Map(), guard: 0 });
    while (out.length < maxCells && vs.guard < maxCells) {
      /* THE SURVEY IS THE EXPENSIVE HALF AND IT USED TO RUN WHOLE.
       *
       * `findVoid` reads every sample a cell holds, six times — three axes, a
       * span pass and a histogram pass each — and this loop calls it for every
       * cell that has not been surveyed yet before it looks at the clock once.
       * On the first pass that is EVERY cell. Measured on the colosseum, the
       * minimum over five repeats so a stalled box cannot flatter it: the
       * pulvinar (s6, 12 848 samples) spends 0.84 ms in one unbroken run of 26
       * `findVoid` calls, against a `prepareBudgetMs` of 1.2. That was the
       * largest indivisible unit of work left anywhere in the approach-time
       * build — bigger than any of the four sliced loops, bigger than
       * `splitCell` (0.25 ms) which is the part that already had a stopping
       * point after it — and it was the only loop in this file with no slice
       * constant, which is exactly why it was the one left.
       *
       * `SLICE_VOIDS` cells between two looks now, like the other four. The
       * survey is resumable for free because `vs.seen` already memoises it:
       * stopping and coming back re-enters the loop and skips everything
       * already surveyed, so no cell is ever measured twice and the pick is
       * made over the same set of voids it always was. */
      let surveyed = 0;
      for (const c of out) {
        if (vs.seen.has(c)) continue;
        vs.seen.set(c, findVoid(c, samples, nrm));
        if (++surveyed % SLICE_VOIDS === 0 && overBudget()) return false;
      }
      let pick = null, pickV = null;
      for (const c of out) {
        const v = vs.seen.get(c);
        if (v && (!pickV || v.width > pickV.width)) { pick = c; pickV = v; }
      }
      if (!pick) break;
      const halves = splitCell(pick, pickV, samples, nrm, matOf, vs.nextSite);
      vs.seen.set(pick, null);                    // do not try this one again
      vs.guard++;
      if (halves) {
        vs.nextSite++;
        out[out.indexOf(pick)] = halves[0];
        out.push(halves[1]);
        vs.seen.delete(pick);
      }
      if (overBudget()) return false;
    }
  }
  for (const c of out) c.list = null;             // the sample lists are scratch
  return true;
}

/**
 * The surface sampling above, a slice at a time — see `fractureJob` for why
 * the whole of pre-fracture had to learn to stop in the middle.
 *
 * It is two passes over the same triangles: the first only measures total area
 * (which decides the sampling density), the second emits the points. Both are
 * flat loops over spans and triangle indices, both append to their own
 * accumulators in order, so a cursor through them is exactly the same work in
 * exactly the same order. It is ~20% of a fracture in the aggregate and up to
 * 74% of the worst pieces — the colosseum's pulvinar spends 57 of its 76 ms
 * here — so it cannot be the one part that runs whole.
 */
export function surfaceJob(structure, budget = 1600) {
  const bins = [];
  for (const s of structure.spans) {
    const g = s.mesh.geometry;
    if (!g || !g.attributes.position) continue;
    bins.push({
      pos: g.attributes.position.array,
      idx: g.index ? g.index.array : null,
      i0: s.i0, n: s.i1,
      mat: s.mesh.material,
    });
  }
  const st = { stage: 0, bin: 0, i: 0, area: 0, count: 0, per: 0,
    pts: null, mats: null, nrm: null, corn: null, triAt: null, nTri: 0 };
  const job = {
    result: null,
    step(overBudget) {
      if (st.stage === 0) {
        if (!measureArea(bins, st, overBudget)) return false;
        if (!st.count) {
          job.result = { samples: new Float32Array(0), mats: [] };
          st.stage = 2;
          return true;
        }
        // one extra sample per `per` m² of face, on top of one centroid per triangle
        st.per = Math.max(1e-6, st.area) / Math.max(1, budget - Math.min(st.count, budget * 0.6));
        // pre-sized: the corner stream is nine floats a triangle and pushing
        // them onto a plain array was most of the GC this path produced
        st.pts = []; st.mats = []; st.nrm = [];
        st.corn = new Float32Array(st.count * 9);
        st.triAt = new Int32Array(st.count);
        st.bin = 0; st.i = -1;
        st.stage = 1;
      }
      if (st.stage === 1) {
        if (!emitSamples(bins, st, overBudget)) return false;
        job.result = { samples: new Float32Array(st.pts), mats: st.mats,
          normals: new Float32Array(st.nrm), corners: st.corn,
          triAt: st.triAt.subarray(0, st.nTri) };
        st.stage = 2;
      }
      return true;
    },
  };
  return job;
}

/** Pass one: total triangle area, which sets the sampling density. */
function measureArea(bins, st, overBudget) {
  while (st.bin < bins.length) {
    const b = bins[st.bin];
    const { pos, idx, n } = b;
    let i = st.i > 0 ? st.i : b.i0;
    while (i + 2 < n) {
      const end = Math.min(n, i + SLICE_TRIS * 3);
      for (; i + 2 < end; i += 3) {
        const a0 = (idx ? idx[i] : i) * 3, b0 = (idx ? idx[i + 1] : i + 1) * 3, c0 = (idx ? idx[i + 2] : i + 2) * 3;
        const ux = pos[b0] - pos[a0], uy = pos[b0 + 1] - pos[a0 + 1], uz = pos[b0 + 2] - pos[a0 + 2];
        const vx = pos[c0] - pos[a0], vy = pos[c0 + 1] - pos[a0 + 1], vz = pos[c0 + 2] - pos[a0 + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        const t = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
        if (t > 0) { st.area += t; st.count++; }
      }
      if (i + 2 < n && overBudget()) { st.i = i; return false; }
    }
    st.bin++; st.i = -1;
  }
  st.bin = 0; st.i = -1;
  return true;
}

/** Pass two: the points themselves, and the corner stream that supports them. */
function emitSamples(bins, st, overBudget) {
  const pts = st.pts, mats = st.mats, nrm = st.nrm, corn = st.corn, triAt = st.triAt;
  while (st.bin < bins.length) {
    const b = bins[st.bin];
    const { pos, idx, n, mat } = b;
    const per = st.per;
    let i = st.i > 0 ? st.i : b.i0;
    while (i + 2 < n) {
      const end = Math.min(n, i + SLICE_TRIS * 3);
      for (; i + 2 < end; i += 3) {
        const a0 = (idx ? idx[i] : i) * 3, b0 = (idx ? idx[i + 1] : i + 1) * 3, c0 = (idx ? idx[i + 2] : i + 2) * 3;
        const ax = pos[a0], ay = pos[a0 + 1], az = pos[a0 + 2];
        const bx = pos[b0], by = pos[b0 + 1], bz = pos[b0 + 2];
        const cx0 = pos[c0], cy0 = pos[c0 + 1], cz0 = pos[c0 + 2];
        if (!isFinite(ax) || !isFinite(bx) || !isFinite(cx0)) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx0 - ax, vy = cy0 - ay, vz = cz0 - az;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const t2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const t = t2 * 0.5;
        if (t2 > 1e-12) { nx /= t2; ny /= t2; nz /= t2; } else { nx = 0; ny = 1; nz = 0; }
        const put = (x, y, z) => { pts.push(x, y, z); nrm.push(nx, ny, nz); mats.push(mat); };
        // The three corners ride along as SUPPORT for whichever cell the
        // centroid lands in, not as samples of their own. The lattice below
        // never reaches a corner — its innermost barycentric is a third of a
        // step in from every edge — so a cell clipped to its samples alone
        // stopped short of the true edge of every face it held, and the pad
        // that covered that was what inflated the piece. Run through the
        // Voronoi search as ordinary samples they quadrupled the sample count
        // and took the wall's fracture from 4.4 ms to 21.9; hung off the
        // centroid they cost three support updates and no search at all.
        // …and only for a triangle big enough for its corners to matter: below
        // a 9 cm edge no corner can move a clip plane further than the 3 cm pad
        // already allows, and skipping those is half the triangles on a wall.
        const e2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz);
        if (e2 > 0.008) {
          const o = st.nTri * 9;
          corn[o] = ax; corn[o + 1] = ay; corn[o + 2] = az;
          corn[o + 3] = bx; corn[o + 4] = by; corn[o + 5] = bz;
          corn[o + 6] = cx0; corn[o + 7] = cy0; corn[o + 8] = cz0;
          triAt[st.nTri++] = pts.length / 3;
        }
        put((ax + bx + cx0) / 3, (ay + by + cy0) / 3, (az + bz + cz0) / 3);
        const k = clamp(Math.round(Math.sqrt(t / per)), 1, 6);
        if (k < 2) continue;
        for (let u = 0; u < k; u++) {
          for (let v = 0; v + u < k; v++) {
            const bu = (u + 0.333) / k, bv = (v + 0.333) / k, bw = 1 - bu - bv;
            if (bw <= 0) continue;
            put(ax * bw + bx * bu + cx0 * bv, ay * bw + by * bu + cy0 * bv, az * bw + bz * bu + cz0 * bv);
          }
        }
      }
      if (i + 2 < n && overBudget()) { st.i = i; return false; }
    }
    st.bin++; st.i = -1;
  }
  return true;
}

/* ── voids ───────────────────────────────────────────────────────────────
 *
 * A convex cell that straddles a doorway fills the doorway in. That is the
 * whole of the remaining error on the big pieces: measured, a ruined gate's
 * cells summed to 3.4× the volume of the mesh they replace and its front
 * silhouette to 2.4×, almost all of it the archway packed solid.
 *
 * The gap is found from the samples themselves. Project a cell's surface
 * samples onto an axis and bin them: a run of empty bins in the middle is
 * either a hole or the inside of a solid slab, and the sample NORMALS say
 * which. Crossing a hole you leave material (a face pointing along +axis) and
 * then enter it again (a face pointing along −axis); crossing solid stone you
 * see the opposite pair. Only the first is a void, and the cell is cut in two
 * at the middle of it. Each half is then re-clipped to its own samples, so
 * neither half reaches back across the gap.
 */
const VOID_MIN = 0.55;      // narrower than this is sampling noise, not a hole
function findVoid(cell, samples, nrm) {
  const list = cell.list;
  if (!list || list.length < 24) return null;
  let best = null;
  for (let a = 0; a < 3; a++) {                    // holes in architecture are
    const n = DOP_AXES[a];                         // square to the piece
    let lo = Infinity, hi = -Infinity;
    for (const s of list) {
      const t = n.x * samples[s * 3] + n.y * samples[s * 3 + 1] + n.z * samples[s * 3 + 2];
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    const span = hi - lo;
    if (!(span > VOID_MIN * 3)) continue;
    const B = clamp(Math.round(span / 0.3), 6, 32);
    const w = span / B;
    const cntB = new Int32Array(B), face = new Float32Array(B);
    for (const s of list) {
      const t = n.x * samples[s * 3] + n.y * samples[s * 3 + 1] + n.z * samples[s * 3 + 2];
      const b = clamp(Math.floor((t - lo) / w), 0, B - 1);
      cntB[b]++;
      face[b] += n.x * nrm[s * 3] + n.y * nrm[s * 3 + 1] + n.z * nrm[s * 3 + 2];
    }
    let i = 1;
    while (i < B - 1) {
      if (cntB[i]) { i++; continue; }
      let j = i;
      while (j < B - 1 && !cntB[j]) j++;
      const width = (j - i) * w;
      // the bin below must be material ending (+axis faces) and the bin above
      // material beginning (−axis faces), or this is the inside of a slab
      const below = face[i - 1] / Math.max(1, cntB[i - 1]);
      const above = face[j] / Math.max(1, cntB[j]);
      if (width >= VOID_MIN && below > 0.12 && above < -0.12
        && (!best || width > best.width)) {
        best = { axis: a, at: lo + (i + (j - i) * 0.5) * w, width };
      }
      i = j + 1;
    }
  }
  return best;
}

/** Cut `cell` in two at `v`, each half re-clipped to the samples it keeps. */
function splitCell(cell, v, samples, nrm, matOf, newSite) {
  const n = DOP_AXES[v.axis];
  const lists = [[], []];
  for (const s of cell.list) {
    const t = n.x * samples[s * 3] + n.y * samples[s * 3 + 1] + n.z * samples[s * 3 + 2];
    lists[t <= v.at ? 0 : 1].push(s);
  }
  if (lists[0].length < 8 || lists[1].length < 8) return null;
  const halves = [];
  for (let h = 0; h < 2; h++) {
    let poly = h === 0 ? clipPoly(cell.poly, n, -v.at) : clipPoly(cell.poly, DOP_NEG[v.axis], v.at);
    if (!poly) return null;
    const dop = newDop();
    const mats = matOf ? new Map() : null;
    for (const s of lists[h]) {
      dopAdd(dop, samples[s * 3], samples[s * 3 + 1], samples[s * 3 + 2],
        nrm[s * 3], nrm[s * 3 + 1], nrm[s * 3 + 2]);
      if (mats) { const m = matOf(s); mats.set(m, (mats.get(m) || 0) + 1); }
    }
    poly = dopClip(poly, dop, 0.02);
    if (!poly) return null;
    const volume = polyVolume(poly);
    if (!(volume > 1e-5)) return null;
    const centre = polyCentroid(poly);
    if (!isFinite(centre.x) || !isFinite(centre.y) || !isFinite(centre.z)) return null;
    let mat = null, bestN = 0;
    if (mats) for (const [m, c] of mats) if (c > bestN) { bestN = c; mat = m; }
    halves.push({ poly, centre, volume, bounds: polyBounds(poly), samples: lists[h].length,
      mat, site: h === 0 ? cell.site : newSite, nbrs: cell.nbrs.slice(), list: lists[h] });
  }
  // the halves share a face, and each inherits whatever the parent touched
  halves[0].nbrs.push(halves[1].site);
  halves[1].nbrs.push(halves[0].site);
  return halves;
}

/** Split the hollowest cell, over and over, while there is cell budget left. */

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
    /**
     * The geometry this piece owns, as runs of the meshes it is drawn in.
     *
     * A maker that emits on its own owns its meshes whole. One composed into
     * somebody else's Kit owns a contiguous run of vertices and indices in a
     * mesh full of other pieces — `whole` is false for those, and everything
     * downstream (the bounds, the surface samples, the hide on conversion)
     * works off the run instead of the mesh. It is the same code either way,
     * which is what makes a column in a colonnade behave exactly like a column
     * a level placed itself.
     */
    this.spans = (spec.spans || []).filter((s) => s && s.mesh && s.mesh.geometry);
    if (!this.spans.length) {
      for (const m of this.meshes) {
        const g = m && m.geometry;
        if (!g || !g.attributes.position) continue;
        this.spans.push({ mesh: m, v0: 0, v1: g.attributes.position.count,
          i0: 0, i1: g.index ? g.index.count : g.attributes.position.count, whole: true });
      }
    }
    if (!this.meshes.length) this.meshes = [...new Set(this.spans.map((s) => s.mesh))];
    this.boxes = (spec.boxes || []).filter(Boolean);
    this.position = (spec.position || new THREE.Vector3()).clone();
    this.quaternion = (spec.quaternion || IDENT).clone();
    this._invQ = this.quaternion.clone().invert();

    // local bounds, over the vertices this piece actually owns
    this.local = new THREE.Box3();
    for (const s of this.spans) {
      const p = s.mesh.geometry.attributes.position;
      if (!p) continue;
      const a = p.array;
      for (let i = s.v0; i < s.v1; i++) this.local.expandByPoint(_v1.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
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

    this.material = this.spans.length ? this.spans[0].mesh.material : null;
    // a piece that only owns part of a shared mesh must never move or hide it
    this.owns = this.spans.every((s) => s.whole);
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
    /* NB: `chunks` existing does NOT mean the piece has come apart — it is
     * pre-fractured before it is touched, and the cells stand in for the solid
     * while it is still whole.
     *
     * It used to publish the maker's collider until the piece CONVERTED, and
     * that cost the blade everything it had done. The solver books its work per
     * capsule name; conversion renames every capsule; so a blade that had spent
     * 2.6 s grinding a column started again from zero the instant it got
     * through, and in the four seconds the grind test allows it managed two cut
     * events out of a column sixteen cells thick. It also meant the one cut
     * that decides how deep a notch is was measured against a proxy two fat
     * sausages wide — 1.55× the width of the column — instead of against the
     * cells the piece is actually going to break into. */
    if (this.chunks) {
      for (const c of this.chunks) {
        if (c.state !== 'attached' && c.state !== 'shell') continue;
        c.worldCentre(_v1);
        if (_v1.distanceToSquared(near) > r2 + c.half.lengthSq()) continue;
        /* A capsule down the cell's longest axis, not a ball at its centre.
         * As a ball, the blade had to pass within 20 cm of a cell's CENTRE to
         * touch it — so carving into a broken wall worked at some heights and
         * did nothing at others, and a notch stopped getting deeper the moment
         * the cells behind it happened to sit between blade passes. Measured on
         * a column: the notch plateaued at 10 of 22 cells however long the
         * blade was held there. */
        /* …and the capsule has to hold the cell's OWN stone, not the cylinder
         * round its bounding box.
         *
         * The radius was the smaller of the two cross half-extents of the AABB,
         * plus 15%. A Voronoi cell out of a round column is a wedge, and its
         * box is most of the section, so that capsule was 5.0× the volume of
         * the stone it stood for — the same complaint as the cells being 1.88×
         * the mesh, one level further out. Measured on the column this test
         * carves: with the blade held 0.46 m into a 1.10 m section, the cell on
         * the FAR side reported 49 frames of contact across the sweep while the
         * blade was never once inside its stone, so a notch the blade could not
         * physically reach the back of still cut the back off. Same stone, same
         * length, as a cylinder: the blade is in the cell when it is in the
         * cell, and the far cell now bridges a shallow notch and does not
         * bridge a deep one. */
        const { ax, rad, arm } = cellCapsule(c);
        _v3.set(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0).applyQuaternion(this.quaternion);
        out.push({
          name: this.id + 'c' + c.index,
          p0: _v1.clone().addScaledVector(_v3, -arm), p1: _v1.clone().addScaledVector(_v3, arm),
          r: rad,
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
      /* The long axis is cut into segments rather than published as one
       * capsule, because the solver books its cut work PER CAPSULE and hands
       * the wear back at the capsule's midpoint. One capsule the height of a
       * column meant grinding at the plinth and grinding at the capital went
       * into the same counter, and the damage it eventually produced always
       * landed at y = half the column, wherever the blade actually was —
       * measured, the wear point never moved off the box centre by more than
       * the row offset. A segment is one cell long, so the piece fails where
       * the blade is holding it. */
      const segLen = Math.max(0.8, this.profile.cell);
      const segs = clamp(Math.round((half * 2) / segLen), 1, 8);
      const segH = half / segs;                      // half-length of one segment
      for (let i = 0; i < rows; i++) {
        const t = rows === 1 ? 0 : (i / (rows - 1)) * 2 - 1;
        _v2.copy(b.center).addScaledVector(secV, t * Math.max(0, span - rad * 0.5));
        if (_v2.distanceToSquared(near) > r2 + half * half) continue;
        for (let sgi = 0; sgi < segs; sgi++) {
          const c0 = -half + (sgi * 2 + 1) * segH;
          _v1.copy(_v2).addScaledVector(axisV, c0);
          if (_v1.distanceToSquared(near) > r2 + segH * segH * 4) continue;
          out.push({
            name: this.id + 'b' + bi + 'r' + i + 's' + sgi,
            p0: _v1.clone().addScaledVector(axisV, -Math.max(0, segH - rad * 0.4)),
            p1: _v1.clone().addScaledVector(axisV, Math.max(0, segH - rad * 0.4)),
            r: rad * 1.05, toughness: this.profile.toughness, structure: this, box: bi,
          });
        }
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
   * amortised over whatever is near the player.
   *
   * This is the WHOLE job in one call, which is what a piece being hit needs:
   * `cutBy`, `damageSphere`, `collapse` and the blade's own `_impactScan` all
   * open with it and cannot proceed without cells. It resumes a job the
   * manager has already started, so a piece hit halfway through its unhurried
   * approach-time build pays only for the part that is left.
   */
  prefracture() {
    if (this.chunks || this.state === 'gone') return this.chunks;
    while (!this.stepPrefracture(NEVER));
    return this.chunks;
  }

  /**
   * The same build, a slice at a time.
   *
   * `overBudget()` is asked between slices and the job stops the moment it says
   * so, resuming next call exactly where it left off. Returns true when the
   * piece is fully fractured.
   *
   * Nothing about the piece is observably different until the last slice:
   * `this.chunks` — the flag every other method in this file reads as "is this
   * fractured yet" — is assigned once, at the end, after `_link` has run. A
   * half-built piece is therefore indistinguishable from an untouched one to
   * every caller, which is what makes it safe to leave one lying between
   * frames.
   */
  stepPrefracture(overBudget) {
    if (this.chunks) return true;
    if (this.state === 'gone') { this._pf = null; return true; }
    let pf = this._pf;
    if (!pf) {
      pf = this._pf = { ms: 0, stage: 0, surface: null, src: null, job: null,
        cells: null, built: null, i: 0 };
    }
    const t = now();
    try {
      while (pf.stage < 4) {
        if (pf.stage > 0 && overBudget()) return false;
        if (pf.stage === 0) {
          if (!pf.surface) pf.surface = surfaceJob(this);
          if (!pf.surface.step(overBudget)) return false;
          pf.src = pf.surface.result;
          pf.surface = null;
          pf.stage = 1;
        } else if (pf.stage === 1) {
          if (!pf.job) {
            const bounds = this.local.clone();
            if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
            const mats = pf.src.mats;
            pf.job = fractureJob(bounds, pf.src.samples, {
              cell: this.profile.cell,
              seed: this.seed * 131 + 7,
              maxCells: this.manager.maxCellsPerPiece,
              matOf: (i) => mats[i],
              normals: pf.src.normals, corners: pf.src.corners, triAt: pf.src.triAt,
            });
          }
          if (!pf.job.step(overBudget)) return false;
          pf.cells = pf.job.cells;
          pf.job = null;
          pf.built = [];
          pf.stage = 2;
        } else if (pf.stage === 2) {
          // Chunk construction is 0.4% of a fracture, but it allocates a hull
          // and a bounds per cell and there is no reason for it to be the one
          // thing that cannot stop.
          const cells = pf.cells;
          while (pf.i < cells.length) {
            pf.built.push(new Chunk(this, cells[pf.i], pf.i));
            pf.i++;
            if (pf.i < cells.length && overBudget()) return false;
          }
          pf.stage = 3;
        } else {
          this.chunks = pf.built;
          this._link();
          // The cells know the real solid; the bounding-box guess the piece was
          // born with does not. Rescale the piece's health to what it is
          // actually made of, keeping whatever fraction of it is already gone.
          if (this.chunks.length) {
            let v = 0, hp = 0;
            for (const c of this.chunks) { v += c.volume; hp += c.hp; }
            const frac = this.hp / Math.max(1e-6, this.maxHp);
            this.volume = v;
            this.maxHp = Math.max(1, hp);
            this.hp = this.maxHp * frac;
          }
          pf.stage = 4;
        }
      }
    } finally {
      pf.ms += now() - t;
    }
    // The piece's own cost is the sum of every slice it took, not the wall
    // clock across the frames it was spread over.
    this.buildMs = pf.ms;
    this.manager.stats.prefractured++;
    this.manager.stats.prefractureMs += this.buildMs;
    this._pf = null;
    return true;
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
    const job = surfaceJob(this, budget);
    while (!job.step(NEVER));
    return job.result;
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
    /* How much air two cells may have between them and still be holding each
     * other up. It was 0.55 of a cell — 74 cm on stone, over half the width of
     * the chunks it is judging — because the cells it was judging were the
     * bounding box's, not the stone's, and their bounds had to be that loose.
     * Measured on a column carved through at mid height: two cells 48 cm apart
     * with nothing between them counted as neighbours, so the flood fill still
     * found a path to the ground and the severed top stayed up. Now that a cell
     * is clipped to the geometry it holds, adjacent cells that really share
     * stone have bounds that touch, and the slack only has to cover the 2 cm
     * pad and the sampling. */
    const gap = Math.max(0.08, this.profile.cell * 0.30);
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

    this._hide();
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
   * The intact geometry goes away — the whole mesh when this piece is the only
   * thing in it, otherwise just the vertices it owns.
   *
   * Collapsing a run onto a single point makes every triangle in it degenerate,
   * so it covers no pixels and costs no fill, while the stones either side of
   * it in the same buffer are untouched. One position upload of the run, once,
   * on the frame the piece first breaks. It is one-way: the cells have been
   * built from these vertices by now and are what gets drawn from here on.
   */
  _hide() {
    if (this.owns) { for (const m of this.meshes) m.visible = false; return; }
    for (const s of this.spans) {
      const p = s.mesh.geometry.attributes.position;
      if (!p || s.v1 <= s.v0) continue;
      const a = p.array;
      const x = a[s.v0 * 3], y = a[s.v0 * 3 + 1], z = a[s.v0 * 3 + 2];
      for (let i = s.v0; i < s.v1; i++) { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; }
      p.needsUpdate = true;
      p.addUpdateRange?.(s.v0 * 3, (s.v1 - s.v0) * 3);
    }
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

  /**
   * A straight blade cut: what the blade was actually in was parted on the
   * plane it swept, and nothing else.
   *
   * This used to take every attached cell within 3.24 m of the hit whose
   * centre was within a metre of the plane, which on a column was two or three
   * whole layers — so the shallowest touch severed the shaft and there was no
   * such thing as carving into something. A cut event is per capsule and, once
   * a piece has converted, a capsule IS a cell, so the blade names the cell it
   * parted; on the first cut, before conversion, the capsule is a segment of
   * the maker's collider and the cut point is all there is to go on. Either way
   * a swing takes what it reached, holding the blade there takes more, and what
   * is left standing is decided downstream by settleSupport rather than here.
   *
   * What was still missing is the TIP. Measured: a blade held 0.30 m into a
   * 1.10 m column — 27% of the section — produced one cut event in 8.3 s, and
   * that single event parted three of the four cells across the waist and
   * knocked the fourth out whole, because the selection radius was
   * `0.47 + the cell's own half-diagonal`, which on a stone cell is 1.3 m: a
   * sphere wider than the column. The blade severed a section it had reached a
   * quarter of the way into, and a 68% cut looked exactly the same.
   *
   * A blade IS long, so the set of cells is right — every cell the swept plane
   * crosses, not just the one the event named. What bounds it is not a radius
   * round the hit but the plane the blade swept ENDING at the tip: see
   * bladeAxis() for where that direction comes from and `reach` below for how
   * far along it the cut is known to have got. Stone past that is stone the
   * blade has not been shown to reach; it stays whole, and it is the ligament
   * that makes 27% of a section behave differently from 68%.
   */
  cutBy(point, normal, impulse, chunk = null) {
    if (this.state === 'gone') return false;
    this.prefracture();
    if (!this.chunks || !this.chunks.length) return false;
    if (this.state === 'intact') this.convert();
    // a real vector, not module scratch: this call reaches deep enough that
    // shared temporaries get clobbered under it
    const n = new THREE.Vector3().copy(normal).normalize();
    const axis = bladeAxis(n, impulse, new THREE.Vector3());
    /* How far along the blade the cut got — the NEAR wall of the capsule it
     * parted.
     *
     * The cut point is on that capsule's axis: the solver puts it there so a
     * limb severs at the bone, and it carries no news of how deep the tip was.
     * What a cut event does establish is contact, and contact means the blade
     * came within the capsule's radius of its axis. So the blade is known to
     * have got to the near wall, and is not known to have got past it.
     *
     * All three readings were measured on the two columns these tests carve,
     * and only this one behaves. Reaching to the AXIS, or to the FAR wall,
     * marches: each cut hands back a ligament whose own axis is deeper still,
     * so the kerf walks past the tip and a 27% notch takes the section off in a
     * few events. The near wall converges instead — cut the ligament again and
     * its capsule's near wall is back where the last one was, which is where
     * the tip is. Measured: 27% leaves the column standing at 7.45 m and 68%
     * leaves nothing above the cut.
     *
     * THE THIRD READING THIS NOTE USED TO CARRY WAS PAID FOR BY THE DEBRIS
     * LOOP. It said "a blade ground 55% through a different column still drops
     * everything above it", about the fixture in `tools/verify.mjs`'s core, and
     * that was true only while `_impactScan` billed a structure for its own
     * chips — see the note there. With that closed, four seconds of grinding at
     * 55.5% removes 0.1% of the section and leaves 9 of 10 cells standing; the
     * blade brings the top down on its own at THIRTEEN seconds. Sliding the tip
     * from 55.5% to 105.5% of the section changes nothing in those four
     * seconds, because what bounds that fixture is total work and not reach.
     * The depth response is `destruction: carve a column and how deep decides
     * whether the top falls`, which measures it over five depths and five
     * jitters; this paragraph is about which reading of `reach` converges, and
     * the two columns above are what settle that.
     */
    let reach = axis ? axis.dot(point) : 0;
    if (axis && chunk && chunk.structure === this) reach -= cellCapsule(chunk).rad;
    else if (axis) reach -= Math.max(0.12, this.profile.cell * 0.25);
    const axisL = axis ? new THREE.Vector3().copy(axis).applyQuaternion(this._invQ) : null;
    const beyond = (c) => {
      if (!axisL) return false;
      const ext = Math.abs(axisL.x) * c.half.x + Math.abs(axisL.y) * c.half.y + Math.abs(axisL.z) * c.half.z;
      return axis.dot(c.worldCentre(_v1)) - ext > reach;
    };
    /* A blade is 1.3 m of plasma, so what it parts is a SWATHE — every cell the
     * swept plane runs through that is not past the tip, not just the one cell
     * the event happened to name. Taking only the named cell was measured on a
     * blade ground into a column for four seconds: two cut events, two cells
     * parted out of the sixteen across the shaft, and the column stood. The
     * bound that was missing all along is the tip, not the length. */
    const nl = new THREE.Vector3().copy(n).applyQuaternion(this._invQ);
    const d = -n.dot(point);
    const hits = [];
    if (chunk && chunk.structure === this && chunk.state === 'attached' && !beyond(chunk)) {
      hits.push(chunk);
    }
    for (const c of this.chunks) {
      if (c.state !== 'attached' || hits.includes(c)) continue;
      if (beyond(c)) continue;                       // the blade never got here
      // does the plane actually pass through this cell? the cell's box is
      // axis-aligned in piece space, so its extent along n is exact
      const proj = Math.abs(nl.x) * c.half.x + Math.abs(nl.y) * c.half.y + Math.abs(nl.z) * c.half.z;
      if (Math.abs(n.dot(c.worldCentre(_v1)) + d) > proj) continue;
      hits.push(c);
    }
    if (!hits.length) {
      // the cut point landed in the air between cells, or in one that has
      // already gone — take the nearest stone the blade could have reached
      let best = null, bestD = -Infinity;
      for (const c of this.chunks) {
        if (c.state !== 'attached' || beyond(c)) continue;
        const dd = this._cellDepth(c, point);
        if (dd > bestD) { bestD = dd; best = c; }
      }
      if (best) hits.push(best);
    }
    /* The cells the plane runs through are parted ON the plane rather than
     * knocked out whole — this is the one place a runtime slice earns its cost,
     * and it is the difference between a column that was cut and a column that
     * had a lump taken out of it. Bounded to three a swing, because it is not
     * cheap; the fourth is LEFT ALONE rather than detached, because detaching
     * it takes the whole cell including the part beyond the tip, which is the
     * bite this is here to stop. The blade is still on it — the next event
     * parts it properly. Only a cell the slice itself refuses (too small to
     * halve, or the piece is already carved past its budget) comes off whole. */
    let parted = 0;
    for (const c of hits) {
      if (parted >= 3) break;
      if (this._partChunk(c, point, n, impulse, axis, reach)) { parted++; continue; }
      this.detach(c, impulse, point);
    }
    this.settleSupport();
    this.manager._breakFx(point, hits.length, this.profile, true);
    return hits.length > 0;
  }

  /**
   * How deep inside cell `c` a world point lies: positive within the stone,
   * negative outside it, in metres, and exact — a cell is a convex polyhedron
   * and the cells are a partition of the piece, so this is the whole of what
   * "the blade was in this one" means.
   *
   * Not the AABB, which is what the old selection effectively used. A Voronoi
   * cell out of a round column is a wedge, and its axis-aligned box is most of
   * the section: four cells across the waist of a 1.10 m column have boxes
   * 0.9–1.1 m wide that all overlap the axis, so a point anywhere near the
   * middle is "in" every one of them.
   */
  _cellDepth(c, point) {
    const p = _v4.copy(point).sub(this.position).applyQuaternion(this._invQ);   // piece-local
    const poly = c.cell && c.cell.poly;
    if (poly && poly.faces && poly.faces.length) {
      let outside = -Infinity;
      for (const f of poly.faces) {
        const q = f.pts[0];
        const d = f.n.x * (p.x - q.x) + f.n.y * (p.y - q.y) + f.n.z * (p.z - q.z);
        if (d > outside) outside = d;
      }
      return -outside;
    }
    // a fragment the blade already parted keeps no polyhedron — its own box,
    // which is tight around the sliced geometry, is the best it has
    const b = c.bounds;
    return Math.min(
      Math.min(p.x - b.min.x, b.max.x - p.x),
      Math.min(p.y - b.min.y, b.max.y - p.y),
      Math.min(p.z - b.min.z, b.max.z - p.z));
  }

  /**
   * Slice one attached cell on the blade's plane and let the halves go. Falls
   * back to the caller's plain detach when the plane misses the cell's solid.
   *
   * Up to THREE pieces come out, not two, because the swept plane stops at the
   * tip. The stone past the cut point along the blade's own axis was never
   * reached: it is left as one piece straddling the plane, and that piece is
   * the ligament — uncut stone joining what is above the cut to what is below
   * it, which is exactly what the flood fill walks and what the overturning
   * test measures the bearing of. Without it every cut was a full-section cut
   * however far in the blade actually was, so a 27% notch and a 68% one left
   * the identical column: measured, both dropped everything above y=3.4.
   */
  _partChunk(chunk, point, normal, impulse, axis = null, reach = 0) {
    if (!chunk || chunk.state !== 'attached' || !chunk.geo) return false;
    // Two floors on how far carving may subdivide a piece. Halves stay attached
    // now, so the blade can keep working on them, and without these a player
    // grinding at one spot for a minute turns one cell into a hundred: each of
    // them a static box and a run of the standing shell. Below 12 cm a chunk is
    // rubble rather than a block, and two and a half times the piece's own cell
    // budget is more carving than anything in the game asks for.
    if (Math.min(chunk.half.x, chunk.half.y, chunk.half.z) < 0.12) return false;
    if (this.chunks.length >= this.manager.maxCellsPerPiece * 2.5) return false;
    const q = this.quaternion;
    const inv = _q1.copy(q).invert();
    const origin = chunk.worldCentre(new THREE.Vector3());
    const lp = new THREE.Vector3().subVectors(point, origin).applyQuaternion(inv);
    const ln = new THREE.Vector3().copy(normal).applyQuaternion(inv).normalize();
    /* The tip first. `parts` collects [geometry, which side of the cut plane]
     * where 0 means "neither — this is the stone the blade did not reach". */
    const parts = [];
    let toCut = chunk.geo;
    if (axis) {
      const la = new THREE.Vector3().copy(axis).applyQuaternion(inv).normalize();
      // the tip's plane, not the cut point's: `reach` is measured along the
      // blade in world space, so slide the point up the axis to meet it
      const lt = new THREE.Vector3().copy(lp).addScaledVector(la, reach - axis.dot(point));
      let far = null;
      try { far = sliceGeometry(chunk.geo, lt, la); } catch (e) { far = null; }
      if (far) {
        // front is the +axis side: past the tip, and it stays in one piece
        parts.push([far.front, 0]);
        toCut = far.back;
      }
    }
    /* And the kerf has a WIDTH — a blade does not part stone, it takes a slot
     * of it away. Cut on one plane and the two halves are coincident, which is
     * wrong twice: the stump of a column cut at 3.40 m measured 3.40 m tall, so
     * "nothing survives above the cut" could not be asked as a question about
     * height; and every "is this neighbour across the kerf" test came out
     * exactly 0 and was settled by the last bit of the float. Two planes a kerf
     * apart, and the slab between them is gone the way the blade took it. */
    let hi = null, lo = null;
    const pHi = new THREE.Vector3().copy(lp).addScaledVector(ln, KERF);
    const pLo = new THREE.Vector3().copy(lp).addScaledVector(ln, -KERF);
    try { hi = sliceGeometry(toCut, pHi, ln); } catch (e) { hi = null; }
    try { lo = sliceGeometry(toCut, pLo, ln); } catch (e) { lo = null; }
    if (!hi && !lo) {
      // the blade's plane misses what is left of the cell — the whole of it is
      // on one side, so there is nothing to part and nothing has been spent
      for (const [g] of parts) g.dispose();
      if (toCut !== chunk.geo) toCut.dispose();
      parts.length = 0;
      return false;
    }
    if (hi) parts.push([hi.front, 1]);
    if (lo) parts.push([lo.back, -1]);
    // the halves on the wrong side of each plane, and the offcut the reach
    // slice left behind, are the slot the blade took — nobody is going to draw
    // them, so hand their buffers back rather than waiting for a GC that only
    // runs on the JS side of them
    if (hi) hi.back.dispose();
    if (lo) lo.front.dispose();
    if (toCut !== chunk.geo) toCut.dispose();

    const localCentre = chunk.centre.clone();
    const volume = chunk.volume;
    const halfLen = chunk.half.length();
    const mat = chunk.material || this.material;
    this.manager._forget(chunk, true);            // the whole cell is spent

    const scratch = new THREE.Vector3();
    const gap = Math.max(0.08, this.profile.cell * 0.30);
    const kin = chunk.neighbours.filter((n) => n.state === 'attached');
    const made = [];
    for (const [geo, sign] of parts) {
      const off = new THREE.Vector3();
      geo.computeBoundingBox();
      geo.boundingBox.getCenter(off);
      geo.translate(-off.x, -off.y, -off.z);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const bb = geo.boundingBox.clone().translate(scratch.copy(localCentre).add(off));
      const share = clamp(bb.getSize(scratch).length() / Math.max(1e-3, halfLen * 2), 0.1, 1)
        / parts.length * 2;                          // the pieces share one cell
      const frag = new Chunk(this, {
        bounds: bb, centre: bb.getCenter(new THREE.Vector3()),
        volume: volume * share, mat, poly: null,
      }, this.chunks.length);
      frag.geo = geo;
      frag.hull = hullFromGeometry(geo)
        || boxShape(Math.max(0.02, frag.half.x), Math.max(0.02, frag.half.y), Math.max(0.02, frag.half.z));
      frag.tris = geo.attributes.position.count / 3;
      this.manager.stats.chunkTris += frag.tris;
      /* Every piece stays ATTACHED, and support decides what happens to them.
       *
       * They used to be flung apart the instant the blade parted the cell, and
       * that is what made a partial cut impossible: whatever the blade actually
       * reached, the whole cell left the piece, so the shallowest touch that
       * produced a cut event severed the section. Measured on a column carved
       * at mid height, every depth from a graze to right through gave the
       * identical result. Left standing, the near half is joined to whatever it
       * still touches and the far half to whatever IT still touches, the two of
       * them are joined to nothing — that is the kerf — and settleSupport is
       * what works out whether there is still a way to the ground. */
      frag.neighbours = kin.filter((n) => {
        if (bb.max.x + gap < n.bounds.min.x || n.bounds.max.x + gap < bb.min.x
          || bb.max.y + gap < n.bounds.min.y || n.bounds.max.y + gap < bb.min.y
          || bb.max.z + gap < n.bounds.min.z || n.bounds.max.z + gap < bb.min.z) return false;
        if (!sign) return true;                      // past the tip: uncut, so it bridges
        /* …and the blade did not pass between them.
         *
         * The slack above is 0.41 m on stone — it has to be, because it is
         * judging the bounding boxes of Voronoi wedges that really do share
         * stone. But it is far wider than a kerf, so it happily re-joined a
         * fragment above the cut to a fragment below it: measured on a column
         * carved right through at mid height, every cell across the section
         * parted and the top still had a path to the ground through the halves
         * of its NEIGHBOURS, and stood. A neighbour that straddles the plane is
         * uncut stone and is exactly the ligament the overturning test wants to
         * find; a neighbour wholly on the other side of it is across the kerf.
         *
         * "Wholly" has to be a kerf's worth and not a strict inequality: a
         * fragment the blade made on THIS plane has its cut face exactly on it,
         * so the strict test came out 0 > 0 and was decided by the last bit of
         * the float. Bridging means stone a kerf deep on this side of the cut. */
        const dc = ln.dot(scratch.copy(n.centre).sub(localCentre).sub(lp));
        const proj = Math.abs(ln.x) * n.half.x + Math.abs(ln.y) * n.half.y + Math.abs(ln.z) * n.half.z;
        return sign > 0 ? dc + proj > KERF : dc - proj < -KERF;
      });
      for (const n of frag.neighbours) n.neighbours.push(frag);
      frag.grounded = bb.min.y <= this.local.min.y + Math.max(0.22, this.size.y * 0.06);
      frag.state = 'attached';
      frag.staticBox = this.world.physics?.addStaticBox?.(
        frag.worldCentre(new THREE.Vector3()), frag.half.clone().max(_v1.set(0.03, 0.03, 0.03)),
        this.quaternion.clone(), { friction: 0.85 }) || null;
      this.chunks.push(frag);
      this.attached++;
      // a shove, so whichever half is loose already goes the right way. The
      // ligament has not been shoved by anything — it was never touched.
      if (sign) frag._kick = new THREE.Vector3().copy(point).addScaledVector(normal, -sign * 0.35);
      frag._side = sign;
      made.push(frag);
    }
    /* The ligament joins the two halves it stopped short of. The blade's tip
     * ends inside the stone, so the material at the tip is continuous: the near
     * half above the kerf rests on it and the near half below it holds it up,
     * and taking that link out would sever a section the blade only notched. */
    const lig = made.find((f) => !f._side);
    if (lig) {
      for (const f of made) {
        if (f === lig) continue;
        lig.neighbours.push(f); f.neighbours.push(lig);
      }
    }
    this.shellDirty = true;
    return made.length > 0;
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
    // Enough to part the cells under the blade and no more. This was 1.75 m on
    // stone, a sphere wider than a column, so a piece that failed under
    // grinding lost everything within nearly two metres of the blade in one
    // frame — a bite, not a cut. Half a cell across is one or two cells.
    const r = Math.max(0.40, this.profile.cell * 0.3);
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
    // a half the blade parted remembers which way the blade was going, so it
    // still falls away from the kerf when it is support that lets it go
    if (!point && chunk._kick) { point = chunk._kick; chunk._kick = null; }
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
    let dropped = 0;
    // Connectivity first, then statics, then connectivity again: dropping the
    // overhanging half of a piece can disconnect what was hanging off IT, and
    // an arch that loses a voussoir has to be allowed to unzip.
    for (let pass = 0; pass < 4; pass++) {
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
      let n = 0;
      for (const c of this.chunks) {
        if (c.state !== 'attached' || seen.has(c)) continue;
        this.detach(c, null, null);
        if (c.body) c.body.velocity.y -= 0.4;
        n++;
      }
      n += this._toppleScan();
      dropped += n;
      if (!n) break;
    }
    this._afterSupport();
    return dropped;
  }

  /**
   * Overturning: the stone that is left has to be UNDER what is standing on it.
   *
   * Connectivity alone says a piece stands while one grain of it still touches
   * the ground, which is why carving a column three-quarters through used to
   * leave the shaft balanced on a slice a hand wide. This is the other half of
   * the statics and it is the ordinary rigid-body one: take a horizontal joint,
   * work out everything the joint carries, and ask whether that mass's centre
   * of gravity falls inside the convex hull of the contacts still bearing on
   * it. Outside, and it topples. That is why a shallow notch changes nothing
   * and a deeper one drops the top — no rule anywhere says "column".
   *
   * The hull is drawn in (planInset) because stone crushes at the toe well
   * before the resultant reaches the literal edge of the bearing.
   */
  _toppleScan() {
    const att = [];
    for (const c of this.chunks) if (c.state === 'attached') att.push(c);
    if (att.length < 2) return 0;
    const levels = [];
    for (const c of att) {
      const y = c.bounds.min.y;
      let near = false;
      for (const l of levels) if (Math.abs(l - y) < 0.05) { near = true; break; }
      if (!near) levels.push(y);
    }
    levels.sort((a, b) => a - b);

    const pts = [];
    for (let li = 1; li < levels.length; li++) {
      const y = levels[li] - 0.02;
      const low = new Set();
      let above = 0;
      for (const c of att) { if (c.centre.y < y) low.add(c); else above++; }
      if (!low.size || !above) continue;

      // what still reaches the ground WITHOUT crossing this joint
      const base = new Set(), q = [];
      for (const c of low) if (c.grounded) { base.add(c); q.push(c); }
      while (q.length) {
        const c = q.pop();
        for (const n of c.neighbours) {
          if (!low.has(n) || base.has(n)) continue;
          base.add(n); q.push(n);
        }
      }
      if (!base.size) continue;                     // nothing below is standing
      const carried = att.filter((c) => !base.has(c));
      if (!carried.length) continue;

      // the joint: wherever a bearing cell touches a carried one
      pts.length = 0;
      let mass = 0, cx = 0, cz = 0;
      for (const c of carried) {
        mass += c.mass; cx += c.mass * c.centre.x; cz += c.mass * c.centre.z;
        for (const n of c.neighbours) {
          if (!base.has(n)) continue;
          const x0 = Math.max(c.bounds.min.x, n.bounds.min.x), x1 = Math.min(c.bounds.max.x, n.bounds.max.x);
          const z0 = Math.max(c.bounds.min.z, n.bounds.min.z), z1 = Math.min(c.bounds.max.z, n.bounds.max.z);
          if (x1 < x0 || z1 < z0) continue;
          pts.push(x0, z0, x1, z0, x1, z1, x0, z1);
        }
      }
      if (pts.length < 6 || mass <= 0) continue;
      if (planInside(pts, cx / mass, cz / mass, planInset(pts))) continue;

      for (const c of carried) {
        this.detach(c, null, null);
        // the overturning it just failed, made visible: a shove off the hull
        if (c.body) {
          _v1.set(c.centre.x - cx / mass, 0, c.centre.z - cz / mass);
          if (_v1.lengthSq() < 1e-4) _v1.set(0, 0, 0); else _v1.normalize();
          c.body.velocity.addScaledVector(_v1, 0.8).y -= 0.3;
        }
      }
      return carried.length;
    }
    return 0;
  }

  /** State bookkeeping after anything let go, and the pieces this one carries. */
  _afterSupport() {
    if (this._settling) return;
    this._settling = true;
    // Collapsed is about the silhouette, not the census. A column ground away
    // to two wedges of drift round its ankles has collapsed even though two of
    // its cells are exactly where they always were; a quarter of the original
    // height is where a piece stops reading as standing and starts reading as
    // a heap, and it is the height the pieces it used to carry care about.
    if (this.state !== 'collapsed' && this.state !== 'gone') {
      let top = -Infinity;
      for (const c of this.chunks || []) if (c.state === 'attached') top = Math.max(top, c.bounds.max.y);
      if (this.attached <= 0 || top < this.local.min.y + this.size.y * 0.25) this.state = 'collapsed';
    }
    // Everything above is re-checked, not just told to fall: a piece carried on
    // two columns survives losing one only if it is still over the other.
    for (const s of this.carries) {
      if (s.state === 'gone' || s.state === 'collapsed') continue;
      if (s.groundedByCarrier()) { if (s.chunks) s.settleSupport(); continue; }
      s.collapse();
    }
    this._settling = false;
  }

  /**
   * Whether this piece still has something under it — and still sits over it.
   *
   * "Has my carrier collapsed entirely" was the old test, and it is not the
   * physics. A column ground away to two wedges of drift at its ankles is not
   * holding up a lintel six metres over its head, and a lintel that has lost
   * one of its two columns is not standing just because the other one is fine:
   * its weight is now a metre and a half off the stone that is left.
   */
  groundedByCarrier() {
    if (!this.restsOn.length) return true;         // it stands on the ground
    const pts = [];
    for (const s of this.restsOn) s.bearingPlan(this, pts);
    if (pts.length < 6) return false;
    return planInside(pts, this.centre.x, this.centre.z, planInset(pts));
  }

  /**
   * The plan patch this piece still offers `carried` to stand on: the overlap
   * of the two footprints, but only where material is still standing high
   * enough to reach it. 0.9 m of slack is the same slack _linkSupports used to
   * decide the two were touching in the first place.
   */
  bearingPlan(carried, out) {
    if (this.state === 'gone' || this.state === 'collapsed') return out;
    const a = _worldBox(this, _boxA);
    const b = _worldBox(carried, _boxB);
    const x0 = Math.max(a.min.x, b.min.x), x1 = Math.min(a.max.x, b.max.x);
    const z0 = Math.max(a.min.z, b.min.z), z1 = Math.min(a.max.z, b.max.z);
    if (x1 < x0 || z1 < z0) return out;
    const need = b.min.y - 0.9;                    // how high the stone must reach
    if (this.state === 'intact' || !this.chunks) {
      if (a.max.y >= need) out.push(x0, z0, x1, z0, x1, z1, x0, z1);
      return out;
    }
    for (const c of this.chunks) {
      if (c.state !== 'attached') continue;
      _cellBox.copy(c.bounds).applyMatrix4(_m4From(this.position, this.quaternion));
      if (_cellBox.max.y < need) continue;
      const u0 = Math.max(x0, _cellBox.min.x), u1 = Math.min(x1, _cellBox.max.x);
      const v0 = Math.max(z0, _cellBox.min.z), v1 = Math.min(z1, _cellBox.max.z);
      if (u1 < u0 || v1 < v0) continue;
      out.push(u0, v0, u1, v0, u1, v1, u0, v1);
    }
    return out;
  }

  /**
   * Everything lets go — used when whatever was holding this piece up is gone.
   *
   * It goes over the bearing it has LEFT, not away from its own middle. A
   * lintel that has lost its left column is pivoting about its right one, so
   * every part of it moves away from that column; shoved from the lintel's own
   * centre instead, the stone nearest the surviving column moved TOWARDS it and
   * came to rest on the capital, still six metres up, which is the one place
   * the collapse must not leave anything.
   */
  collapse(dir = null) {
    if (this.state === 'gone' || this.state === 'collapsed') return;
    this.prefracture();
    if (this.state === 'intact') this.convert();
    if (!this.chunks) return;
    const from = this._bearingCentre() || this.centre;
    for (const c of this.chunks) if (c.state === 'attached') this.detach(c, dir, from);
    this.state = 'collapsed';
    for (const s of this.carries) s.collapse();
    this.manager._breakFx(this.centre, 6, this.profile);
  }

  /** Plan centre of whatever is still bearing under this piece, at its base. */
  _bearingCentre() {
    if (!this.restsOn.length) return null;
    const pts = [];
    for (const s of this.restsOn) s.bearingPlan(this, pts);
    if (!pts.length) return null;
    let x = 0, z = 0;
    for (let i = 0; i < pts.length; i += 2) { x += pts[i]; z += pts[i + 1]; }
    const n = pts.length / 2;
    return new THREE.Vector3(x / n, this.position.y + this.local.min.y, z / n);
  }

  /** The piece nudges and sheds dust when it is close to letting go. */
  updateStress(dt) {
    // a piece sharing a mesh with the rest of a building cannot shake: moving
    // the mesh would shake the building
    if (this.stress <= 0.05 || this.state !== 'intact' || !this.owns) {
      if (this._shakeBase) this._unshake();
      this.stress = Math.max(0, this.stress - dt * 0.12);
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
    this.maxCellsPerPiece = opts.maxCellsPerPiece ?? (q === 'low' ? 18 : q === 'high' ? 28 : 22);
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
    /** The one structure allowed to hold a half-finished fracture. See _prepare. */
    this._pfActive = null;

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
      /* Variadic past the two it reads, for the reason `World._recordFires`
       * states: a wrapper that names the whole argument list has taken a
       * position on a signature it does not own. `onExplosion` grew a third
       * `opts` — the ghost flag a co-op client's blast carries — and this
       * wrapper is on the property, so dropping it would have made every
       * networked blast bill damage on the client after all. */
      const wrapped = (centre, size = 1, ...rest) => {
        prev.call(world, centre, size, ...rest);
        /* The structural half runs on BOTH ends: no wall is in the snapshot,
         * so a client that skipped this would keep standing behind cover the
         * host had already blown apart. */
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
        /**
         * A PIECE OF A STRUCTURE DOES NOT DAMAGE THE STRUCTURE IT CAME FROM,
         * and that loop is what made a shallow notch demolish a column.
         *
         * Everything below this line is written for something ARRIVING — a
         * thrown body, a rolling barrel, a chunk of somebody else's wall — and
         * it bills `0.5 m v²` over a sphere at least 1.4 m across. A cell the
         * blade has just cut off is not an arrival: the energy that freed it
         * has already been paid, by the blade, through `wear` and `cutBy`, and
         * charging the stone a second time for the flight of its own chip is
         * the same double-billing `Enemy._turnCut` refuses when it declines to
         * charge a Force rend to the blade's guard as well.
         *
         * It is also a runaway rather than a mechanic. Measured on the fixture
         * `destruction: carve a column and how deep decides whether the top
         * falls` drives — a 1.10 m stone column, notched 0.30 m: the blade
         * parts two cells, one 57.3 kg cell comes away, and six frames later
         * it is travelling at 16.4 m/s (see below) and lands back through the
         * shaft. `_impactScan` billed the column 154.5 damage over a 1.454 m
         * radius — wider than the column — which took every cell across the
         * section, and the flood fill dropped the seven above it. 27 attached
         * cells to 8, everything above the notch on the floor, from a notch
         * that had removed 23% of the section.
         *
         * That is what made the check's response NOT MONOTONE in depth and a
         * coin flip on ±3 mm of hilt position: whether the chip happened to
         * re-enter the shaft above `impactSpeed` decided the fight, not the
         * depth. Standing samples out of seven jitters, before and after:
         *
         *     0.15 m  7/7 → 7/7      section gone at the kerf    5% →   5%
         *     0.30 m  3/7 → 7/7                            23%/100% → 16-23%
         *     0.45 m  7/7 → 7/7                            20%/33%  → 19-31%
         *     0.60 m  1/7 → 7/7                            36%/100% →   36%
         *     0.75 m  0/7 → 0/7                                100% →  100%
         *
         * AND THE 16.4 m/s IS ITS OWN DEFECT, NOT FIXED HERE. Measured frame by
         * frame, the freed cell sits at 0.1–1.6 m/s for six frames and then
         * jumps to 16.4 in one — Rapier resolving a penetration, because an
         * attached cell's static collider is its AXIS-ALIGNED BOX and a Voronoi
         * wedge out of a round column has a box most of the section wide (this
         * file's own note on `_cellDepth` measures four such boxes all
         * overlapping the axis). So a cell made dynamic in place starts inside
         * three of its neighbours' colliders and is blown out of them. A player
         * sees a 57 kg block rocket off a column they notched. The fix is hulls
         * rather than boxes for attached cells, which is a change to every
         * static collider in the destructible world and wants its own pass.
         *
         * Scoped to the structure the chunk belongs to, not to debris in
         * general: a chunk of one column landing on another is a real impact
         * and still bills.
         */
        if (b.userData && b.userData.chunk && b.userData.chunk.structure === s) continue;
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
      // The blade is on it, so from the next frame it meets the cells rather
      // than the maker's collider. This is the one moment worth spending the
      // fracture on: the piece is being cut and it is going to need them, and
      // paying for it here rather than at the first cut means the work the
      // solver has banked against the capsule names survives.
      s.prefracture();
      const at = _v2.lerpVectors(cap.p0, cap.p1, 0.5);
      s.wear(delta * 2.2, at);
      const frac = clamp(work / Math.max(1e-3, cutNeed(cap)), 0, 1);
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

  /**
   * The capsule a cut event came out of, recovered from its point.
   *
   * World hands `cut` only (point, normal, impulse) — the event's own capsule
   * never reaches the prop. It does not have to: the solver puts the cut point
   * exactly ON the capsule segment it crossed, so the segment through the point
   * is the capsule, and for a cell capsule (p0 === p1 === the cell's centre)
   * that is an exact identification of the cell the blade was in.
   */
  capsuleAt(point) {
    let best = null, bestD = 1e-4;
    for (const cap of this._caps.values()) {
      _v1.subVectors(cap.p1, cap.p0);
      const len2 = _v1.lengthSq();
      let t = 0;
      if (len2 > 1e-12) t = clamp(_v2.subVectors(point, cap.p0).dot(_v1) / len2, 0, 1);
      const d = _v2.copy(cap.p0).addScaledVector(_v1, t).distanceToSquared(point);
      if (d < bestD) { bestD = d; best = cap; }
    }
    return best;
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
   *
   * THE CELLS USED TO BE OUTSIDE THE BUDGET, AND ONE FRAME WAS NOT ENOUGH.
   *
   * The line below used to read `s.prefracture(); return; // cells are a whole
   * frame's work` — a deliberate, documented decision to give the cell build a
   * whole frame instead of a slice of one. The trouble is that a whole frame
   * is not enough either. Every structure in the game, timed individually
   * through its own `prefracture()`: 389 of them, median 7.5 ms, p90 14.7, max
   * 76, and 27-41 of them over a whole 16.7 ms frame — up to 4.6x the frame
   * they were being given. In play, with the director off and no enemies at
   * all, a player simply walking a 22 m circle on the temple for 3000 frames
   * had this fire on 57-92 of them, 11 frames over 16.7 ms, 2 over 50, and half
   * a second of stall in fifty seconds of walking. It fires on APPROACH — the
   * range is 30 m — so the hitch has nothing on screen to explain it.
   *
   * Meanwhile the half that WAS budgeted behaved perfectly: `prepareCell` fires
   * at a median 0.77 ms against the 1.2 ms budget with a worst case of 3.0. The
   * budget worked. It was simply never applied to the expensive half.
   *
   * So both halves are under the same clock now. `stepPrefracture` does as much
   * of the cell build as fits and leaves the rest for next frame — see the note
   * over `fractureJob` for how the work is cut and why not with a generator.
   */
  _prepare(focus) {
    const n = this.structures.length;
    if (!n) return;
    const range2 = this.prefractureRange * this.prefractureRange;
    const t0 = now();
    const budget = this.prepareBudgetMs;
    const overBudget = () => now() - t0 >= budget;
    let did = false;
    for (let i = 0; i < n && !overBudget(); i++) {
      const s = this.structures[(this._pfCursor + i) % n];
      if (s.state === 'gone' || s.prepared) continue;
      if (s.centre.distanceToSquared(focus) > range2) continue;
      if (!s.chunks) {
        /**
         * ONE HALF-BUILT PIECE AT A TIME, AND NEVER MORE.
         *
         * A job that has stopped mid-way is holding its surface sample stream —
         * up to 26,000 points with their normals and a nine-float corner per
         * triangle, ~600 KB on the warship's biggest piece. The player walking
         * away moves the cursor to a different structure and the old one would
         * sit there holding that for the rest of the session; over a level of
         * 126 pieces that is tens of megabytes of scratch nobody is going to
         * ask for again. So exactly one piece is ever mid-build: picking up a
         * new one throws the previous one's working set away, and it starts
         * again from the beginning if the player comes back. Losing that work
         * is the cheap side of the trade — it only happens when the player has
         * walked out of range of the piece.
         */
        if (this._pfActive && this._pfActive !== s) this._pfActive._pf = null;
        this._pfActive = s;
        if (s.stepPrefracture(overBudget)) this._pfActive = null;
        this._pfCursor = (this._pfCursor + i) % n;
        return;
      }
      for (const c of s.chunks) {
        if (c.geo || c.state === 'gone') continue;
        s.prepareCell(c);
        did = true;
        if (overBudget()) break;
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
    const cap = this.manager.capsuleAt(planePoint);
    const s = (cap && cap.structure) || this.manager.structureAt(planePoint, 3.2);
    if (s) s.cutBy(planePoint, planeNormal, impulse, cap ? cap.chunk : null);
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
  // either whole meshes, or runs of somebody else's (a piece composed into a Kit)
  if (!(spec.meshes && spec.meshes.length) && !(spec.spans && spec.spans.length)) return null;
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

/**
 * How far inside the support polygon the weight has to be, on ONE edge.
 *
 * Not a fixed margin, because the criterion is not about a fixed margin: an
 * unreinforced masonry joint opens as soon as the resultant leaves the middle
 * third of it, and once it opens the remaining bearing is a fraction of the
 * stone and crushes. So the effective support is the geometric one pulled in by
 * roughly a sixth of its own size — measured on a stone column carved at mid
 * height, that is what tells 27% of the section cut away (the weight is still
 * a quarter of a metre inside what is left, and it stands) from 41% (a hand's
 * width outside, and the top goes over).
 *
 * "Its own size" has to be read PER EDGE — the depth of the bearing behind that
 * edge — and not off the polygon's diagonal, which is what this was. Read off
 * the diagonal, a lintel resting on two columns 5.2 m apart got a 0.60 m margin
 * applied to a bearing 0.72 m deep, so a lintel sitting square on two untouched
 * columns was already falling: its weight is 0.36 m from the long edge, and 0.36
 * is less than 0.60. Per edge it is 0.11 m against the 0.72 m depth, and the
 * same lintel with one column shot out from under it still goes over, because
 * across the span the depth is 5.2 m and the margin 0.6.
 */
/**
 * The capsule one cell publishes to the blade: which of its axes it runs along,
 * the radius of the cylinder that holds its stone, and the half-length of the
 * straight part. Two callers need exactly the same shape — the one that offers
 * it to the solver and the one that has to work out, from a cut event, how far
 * into the piece the blade was when it parted it.
 */
function cellCapsule(c) {
  const h = c.half;
  const ax = h.x >= h.y && h.x >= h.z ? 0 : (h.y >= h.z ? 1 : 2);
  const halfLen = Math.max(0.02, ax === 0 ? h.x : ax === 1 ? h.y : h.z);
  // never fatter than the box it came out of, and never so thin the blade has
  // to thread it — 12 cm is about the width of the kerf a blade leaves
  const fat = Math.max(0.02, ax === 0 ? Math.min(h.y, h.z) : ax === 1 ? Math.min(h.x, h.z) : Math.min(h.x, h.y));
  const rad = clamp(Math.sqrt(Math.max(1e-4, c.volume) / (Math.PI * 2 * halfLen)), 0.12, fat);
  /* The straight part spans the whole cell, so the round caps stand `rad` proud
   * of each end. That is deliberately the one place the proxy is allowed to be
   * bigger than the stone: erring ACROSS the cell is what let a blade cut a
   * column it had not reached the back of, while erring ALONG it only lets the
   * blade catch a cell a little before it reaches it — and the next cell up is
   * there anyway. Ending the capsule short instead cost the game a measured
   * bug: the caps narrow to nothing, so a blade held at the very bottom of a
   * 2.3 m cell had to thread its axis to touch it at all, and a grind that
   * should have parted a column produced two cut events in four seconds. */
  return { ax, rad, halfLen, arm: halfLen };
}

/**
 * The blade's own axis, hilt to tip, out of a cut event — with its SIGN.
 *
 * A cut event carries the plane the blade swept and the velocity it swept it
 * at, and nothing that says "the tip was here". It does not have to: Saber
 * builds that plane's normal as (tip − base) × (tip − prevTip), which is the
 * axis crossed with the travel, and for two perpendicular unit vectors
 * v̂ × (â × v̂) = â exactly. So crossing the travel back into the normal returns
 * the axis pointing the way the blade points.
 *
 * The sign is the whole reason to bother. Without it, "stone past the cut point
 * is untouched" is a coin flip between leaving the ligament the blade stopped
 * short of and leaving the stone behind the hilt, which is the half it went
 * clean through — and getting it backwards puts the bearing on the wrong side
 * of the section and drops a column a notch should not have moved.
 *
 * Returns null for a thrust, where there is no sweep and so no plane worth the
 * name; the caller falls back to a cut with no reach limit, which is what a
 * blade driven straight in actually does.
 *
 * It leans on one thing about the saber: the event's velocity is taken at the
 * contact, and the normal is built from the TIP's travel, so the two only agree
 * while every point of the blade is moving the same way. They are, because a
 * saber pivots at the hand and the hand is 15.5 cm behind the emitter — the
 * pivot is never between base and tip. Were it ever otherwise the axis would
 * come out reversed, and a cut would take the far side of a cell and leave the
 * near one.
 */
function bladeAxis(normal, impulse, out) {
  if (!impulse || !out) return null;
  out.copy(impulse);
  out.addScaledVector(normal, -out.dot(normal));    // travel, in the swept plane
  if (out.lengthSq() < 1e-8) return null;
  return out.normalize().cross(normal).normalize();
}

const PLAN_KERN = 0.156;
function edgeInset(depth) { return clamp(PLAN_KERN * depth, 0.04, 0.6); }
/**
 * The same kern, for a bearing given as a flat [x,z,x,z,…] contact list rather
 * than as a depth. planInside() can only shrink a hull by one scalar, so the
 * depth handed over is the patch's NARROW plan extent, not its widest: a toe
 * crushes across the short way first, and kerning a 5.2 m lintel bearing by the
 * span rather than by the 1.1 m the columns are actually deep ate the whole
 * seat and dropped a lintel standing on two intact columns.
 */
function planInset(pts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], z = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!(maxX >= minX)) return 0;
  return edgeInset(Math.min(maxX - minX, maxZ - minZ));
}
export function planInside(pts, px, pz, inset = 0) {
  const n = pts.length / 2;
  if (n < 3) {
    // a line or a point: stable only if the weight is essentially on it
    for (let i = 0; i < n; i++) {
      if (Math.hypot(pts[i * 2] - px, pts[i * 2 + 1] - pz) <= inset) return true;
    }
    return false;
  }
  // monotone chain, on indices so the coordinates stay in the flat array
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => (pts[a * 2] - pts[b * 2]) || (pts[a * 2 + 1] - pts[b * 2 + 1]));
  const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1])
    - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const hull = [];
  for (let pass = 0; pass < 2; pass++) {
    const start = hull.length;
    const src = pass ? idx.slice().reverse() : idx;
    for (const i of src) {
      while (hull.length >= start + 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
      hull.push(i);
    }
    hull.pop();
  }
  if (hull.length < 3) {
    // degenerate — every point collinear; fall back to the segment test
    let lo = Infinity, hi = -Infinity, dx = 0, dz = 0;
    const a = idx[0], b = idx[idx.length - 1];
    dx = pts[b * 2] - pts[a * 2]; dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return Math.hypot(pts[a * 2] - px, pts[a * 2 + 1] - pz) <= inset;
    dx /= len; dz /= len;
    for (let i = 0; i < n; i++) {
      const t = (pts[i * 2] - pts[a * 2]) * dx + (pts[i * 2 + 1] - pts[a * 2 + 1]) * dz;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    const t = (px - pts[a * 2]) * dx + (pz - pts[a * 2 + 1]) * dz;
    const off = Math.abs((px - pts[a * 2]) * -dz + (pz - pts[a * 2 + 1]) * dx);
    return off <= inset && t >= lo + inset && t <= hi - inset;
  }
  // inside every edge, pulled in by `inset`
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = pts[b * 2] - pts[a * 2], ez = pts[b * 2 + 1] - pts[a * 2 + 1];
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    // counter-clockwise hull: inside is to the left, so this is +ve inside
    const d = ((px - pts[a * 2]) * ez - (pz - pts[a * 2 + 1]) * ex) / len;
    if (-d < inset) return false;
  }
  return true;
}
function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
