/**
 * Measure the pre-fractured proxy against the intact mesh it replaces.
 *
 *   node measure.mjs
 *
 * Volume of the intact solid is the generalised winding number over the merged
 * geometry (robust to the overlapping closed solids a Kit emits); volume of the
 * proxy is exact point-in-convex-polyhedron over the same voxel grid.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addColumn, addArch, addBrokenWall, addLintel, addButtress,
  addColossus, addRuinedGate, addWall } from '../src/world/Props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function destructionHost(physics, opts = {}) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], props: [], enemies: [], doors: [], levelLights: [], debris: [],
    physics, particles: null, bladeSolver: null,
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true, friction: 0.9, size: 400,
      normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null },
    player: { position: opts.player || V(0, 1, 0) },
    settings: { quality: 'medium' },
    addProp(p) { this.props.push(p); return p; },
    addLight(l) { return l; },
    onExplosion() {},
  };
}
const rapierGround = () => ({ size: 256, res: 33, heights: new Float32Array(33 * 33),
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), slopeAt: () => 0, inBounds: () => true,
  friction: 0.9, deformSeq: 0, raycast: () => null });

/* ── triangle soup, in piece-local space ─────────────────────────────── */
function soupOf(meshes) {
  const tris = [];
  for (const m of meshes) {
    const g = m.geometry;
    if (!g || !g.attributes.position) continue;
    const p = g.attributes.position.array;
    const idx = g.index ? g.index.array : null;
    const n = g.index ? g.index.count : g.attributes.position.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = (idx ? idx[i] : i) * 3, b = (idx ? idx[i + 1] : i + 1) * 3, c = (idx ? idx[i + 2] : i + 2) * 3;
      tris.push([p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]);
    }
  }
  return tris;
}

/**
 * Generalised winding number by signed ray crossings along +X.
 * A point inside k overlapping closed solids scores k; outside scores 0.
 */
function insideSolid(tris, x, y, z) {
  let wind = 0;
  for (let t = 0; t < tris.length; t++) {
    const T = tris[t];
    // project to YZ, point-in-triangle by barycentric
    const y0 = T[1], z0 = T[2], y1 = T[4], z1 = T[5], y2 = T[7], z2 = T[8];
    const d = (z1 - z2) * (y0 - y2) + (y2 - y1) * (z0 - z2);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((z1 - z2) * (y - y2) + (y2 - y1) * (z - z2)) / d;
    if (l0 < 0 || l0 > 1) continue;
    const l1 = ((z2 - z0) * (y - y2) + (y0 - y2) * (z - z2)) / d;
    if (l1 < 0 || l1 > 1) continue;
    const l2 = 1 - l0 - l1;
    if (l2 < 0 || l2 > 1) continue;
    const hx = l0 * T[0] + l1 * T[3] + l2 * T[6];
    if (hx <= x) continue;                     // only crossings ahead of the point
    // signed by the triangle's own normal x-component
    const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
    const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
    const nx = uy * vz - uz * vy;
    if (nx > 0) wind++; else if (nx < 0) wind--;
  }
  return wind > 0;
}

function insideCells(cells, x, y, z, eps = 1e-6) {
  for (const cell of cells) {
    const poly = cell.poly || cell.cell?.poly;
    if (!poly) continue;
    let ok = true;
    for (const f of poly.faces) {
      const p0 = f.pts[0], n = f.n;
      if (n.x * (x - p0.x) + n.y * (y - p0.y) + n.z * (z - p0.z) > eps) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function polyVol(poly) {
  let v = 0;
  const o = poly.faces[0].pts[0];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const f of poly.faces) {
    const p = f.pts;
    for (let i = 1; i + 1 < p.length; i++) {
      a.subVectors(p[0], o); b.subVectors(p[i], o); c.subVectors(p[i + 1], o);
      v += a.dot(b.cross(c));
    }
  }
  return Math.abs(v) / 6;
}

/* ── the measurement ─────────────────────────────────────────────────── */
function measure(name, build, res = 46) {
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  build(host);
  const D = host.destruction;
  if (!D || !D.structures.length) { console.log(`${name}: NOT REGISTERED`); return null; }
  const s = D.structures[0];
  s.prefracture();
  const tris = soupOf(s.meshes);

  const bb = s.local.clone();
  const size = bb.getSize(new THREE.Vector3());
  const pad = 0.02;
  const n = res;
  const dx = (size.x + pad * 2) / n, dy = (size.y + pad * 2) / n, dz = (size.z + pad * 2) / n;
  const cellVol = dx * dy * dz;
  let vIn = 0, vCells = 0, vBoth = 0, vOnlyCells = 0, vOnlyMesh = 0;
  // silhouettes: XY (front), XZ (plan)
  const silA = new Uint8Array(n * n), silB = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const x = bb.min.x - pad + (i + 0.5) * dx;
    for (let j = 0; j < n; j++) {
      const y = bb.min.y - pad + (j + 0.5) * dy;
      for (let k = 0; k < n; k++) {
        const z = bb.min.z - pad + (k + 0.5) * dz;
        const a = insideSolid(tris, x, y, z);
        const b = insideCells(s.chunks, x, y, z);
        if (a) vIn++;
        if (b) vCells++;
        if (a && b) vBoth++;
        if (b && !a) { vOnlyCells++; silA[i * n + j] |= 2; silB[i * n + k] |= 2; }
        if (a && !b) { vOnlyMesh++; silA[i * n + j] |= 1; silB[i * n + k] |= 1; }
        if (a) { silA[i * n + j] |= 4; silB[i * n + k] |= 4; }
        if (b) { silA[i * n + j] |= 8; silB[i * n + k] |= 8; }
      }
    }
  }
  let sMesh = 0, sCell = 0;
  for (let i = 0; i < n * n; i++) { if (silA[i] & 4) sMesh++; if (silA[i] & 8) sCell++; }

  if (process.env.DIAG) {
    // where does the missed material live? band it by height and by radius
    const bandsY = new Array(8).fill(0), bandsR = new Array(6).fill(0);
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const x = bb.min.x - pad + (i + 0.5) * dx;
      for (let j = 0; j < n; j++) {
        const y = bb.min.y - pad + (j + 0.5) * dy;
        for (let k = 0; k < n; k++) {
          const z = bb.min.z - pad + (k + 0.5) * dz;
          if (!insideSolid(tris, x, y, z) || insideCells(s.chunks, x, y, z)) continue;
          tot++;
          bandsY[Math.min(7, Math.floor((y - bb.min.y) / size.y * 8))]++;
          const c = bb.getCenter(new THREE.Vector3());
          const r = Math.hypot(x - c.x, z - c.z) / (0.5 * Math.hypot(size.x, size.z));
          bandsR[Math.min(5, Math.floor(r * 6))]++;
        }
      }
    }
    console.log(`   missed ${tot} vox  byY[${bandsY.join(',')}]  byR[${bandsR.join(',')}]`);
    console.log(`   cells: ` + s.chunks.map(c => `${c.volume.toFixed(2)}@${c.centre.y.toFixed(1)}`).join(' '));
  }

  let analytic = 0;
  for (const c of s.chunks) analytic += polyVol(c.cell.poly);

  const Vmesh = vIn * cellVol, Vcells = vCells * cellVol;
  const out = {
    name,
    cells: s.chunks.length,
    Vmesh, Vcells, ratio: Vcells / Math.max(1e-9, Vmesh),
    analytic,
    covered: vBoth / Math.max(1, vIn),
    bloat: vOnlyCells * cellVol,
    missed: vOnlyMesh * cellVol,
    silRatio: sCell / Math.max(1, sMesh),
    bbox: `${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`,
    bboxVol: size.x * size.y * size.z,
  };
  const ss = s._surfaceSamples();
  console.log(`${name.padEnd(16)} cells=${String(out.cells).padStart(2)}  `
    + `Vmesh=${Vmesh.toFixed(2)}  Vcells=${Vcells.toFixed(2)}  ratio=${out.ratio.toFixed(3)}  `
    + `analytic=${analytic.toFixed(2)}  covered=${(out.covered * 100).toFixed(1)}%  `
    + `bloat=${out.bloat.toFixed(2)}  missed=${out.missed.toFixed(2)}  `
    + `sil=${out.silRatio.toFixed(3)}  bbox=${out.bbox} (${out.bboxVol.toFixed(1)})  `
    + `samples=${ss.samples.length / 3} tri=${ss.triAt.length} ms=${s.buildMs.toFixed(1)}`);
  return out;
}

await initPhysics();
propMaterials();
console.log('\nintact mesh volume vs pre-fractured proxy volume, voxelised\n');
measure('column', (h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false }));
measure('column-narrow', (h) => addColumn(h, V(0, 0, 0), { height: 6, radius: 0.35, seed: 3, drift: false }));
measure('brokenWall', (h) => addBrokenWall(h, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 }));
measure('lintel', (h) => addLintel(h, V(0, 6.2, 0), { length: 6.4, height: 0.62, depth: 0.72, seed: 3 }));
measure('arch', (h) => addArch(h, V(0, 0, 0), { span: 5, seed: 33 }));
measure('buttress', (h) => addButtress(h, V(0, 0, 0), { seed: 55 }));
measure('ruinedGate', (h) => addRuinedGate(h, V(0, 0, 0), { seed: 303 }));
measure('colossus', (h) => addColossus(h, V(0, 0, 0), { seed: 202 }));
console.log('');
