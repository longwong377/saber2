/**
 * Where does a fractured piece LOSE material? For every voxel inside the intact
 * mesh but inside no cell, find the cell that comes closest to containing it and
 * name the face that rejects it. Histogram by face normal.
 *
 *   node tools/_miss.mjs <name>
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addColumn, addArch, addBrokenWall, addLintel, addButtress,
  addRuinedGate, addColossus } from '../src/world/Props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function destructionHost(physics) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], props: [], enemies: [], doors: [], levelLights: [], debris: [],
    physics, particles: null, bladeSolver: null,
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true, friction: 0.9, size: 400,
      normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null },
    player: { position: V(0, 1, 0) }, settings: { quality: 'medium' },
    addProp(p) { this.props.push(p); return p; }, addLight(l) { return l; }, onExplosion() {},
  };
}
const rg = () => ({ size: 256, res: 33, heights: new Float32Array(33 * 33), height: () => 0,
  normalAt: (x, z, o) => o.set(0, 1, 0), slopeAt: () => 0, inBounds: () => true, friction: 0.9,
  deformSeq: 0, raycast: () => null });

function soup(s) {
  const tris = [];
  for (const sp of s.spans) {
    const g = sp.mesh.geometry;
    const p = g.attributes.position.array;
    const idx = g.index ? g.index.array : null;
    for (let i = sp.i0; i + 2 < sp.i1; i += 3) {
      const a = (idx ? idx[i] : i) * 3, b = (idx ? idx[i + 1] : i + 1) * 3, c = (idx ? idx[i + 2] : i + 2) * 3;
      tris.push([p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]);
    }
  }
  return tris;
}
function insideSolid(tris, x, y, z) {
  let wind = 0;
  for (let t = 0; t < tris.length; t++) {
    const T = tris[t];
    const y0 = T[1], z0 = T[2], y1 = T[4], z1 = T[5], y2 = T[7], z2 = T[8];
    const d = (z1 - z2) * (y0 - y2) + (y2 - y1) * (z0 - z2);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((z1 - z2) * (y - y2) + (y2 - y1) * (z - z2)) / d;
    if (l0 < 0 || l0 > 1) continue;
    const l1 = ((z2 - z0) * (y - y2) + (y0 - y2) * (z - z2)) / d;
    if (l1 < 0 || l1 > 1) continue;
    const l2 = 1 - l0 - l1;
    if (l2 < 0 || l2 > 1) continue;
    if (l0 * T[0] + l1 * T[3] + l2 * T[6] <= x) continue;
    const nx = (T[4] - T[1]) * (T[8] - T[2]) - (T[5] - T[2]) * (T[7] - T[1]);
    if (nx > 0) wind++; else if (nx < 0) wind--;
  }
  return wind > 0;
}
/** worst face violation for this poly, and which face */
function reject(poly, x, y, z) {
  let worst = -Infinity, wf = null;
  for (const f of poly.faces) {
    const p = f.pts[0];
    const d = f.n.x * (x - p.x) + f.n.y * (y - p.y) + f.n.z * (z - p.z);
    if (d > worst) { worst = d; wf = f; }
  }
  return { d: worst, f: wf };
}

const MAKERS = {
  column: (h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false }),
  wall: (h) => addBrokenWall(h, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 }),
  lintel: (h) => addLintel(h, V(0, 6.2, 0), { length: 6.4, height: 0.62, depth: 0.72, seed: 3 }),
  buttress: (h) => addButtress(h, V(0, 0, 0), { seed: 55 }),
  arch: (h) => addArch(h, V(0, 0, 0), { span: 5, seed: 33 }),
  gate: (h) => addRuinedGate(h, V(0, 0, 0), { seed: 303 }),
  colossus: (h) => addColossus(h, V(0, 0, 0), { seed: 202 }),
};

await initPhysics();
propMaterials();
const which = process.argv[2] || 'lintel';
const res = +(process.argv[3] || 40);
const w = new RapierWorld({ gravity: -22 });
w.terrain = rg();
const host = destructionHost(w);
MAKERS[which](host);
const s = host.destruction.structures[0];
s.prefracture();
const tris = soup(s);
const bb = s.local, size = bb.getSize(new THREE.Vector3());
const pad = 0.02, n = res;
const dx = (size.x + pad * 2) / n, dy = (size.y + pad * 2) / n, dz = (size.z + pad * 2) / n;
const vox = dx * dy * dz;

const byFace = new Map();
let mesh = 0, miss = 0;
const bbMiss = new THREE.Box3();
for (let i = 0; i < n; i++) {
  const x = bb.min.x - pad + (i + 0.5) * dx;
  for (let j = 0; j < n; j++) {
    const y = bb.min.y - pad + (j + 0.5) * dy;
    for (let k = 0; k < n; k++) {
      const z = bb.min.z - pad + (k + 0.5) * dz;
      if (!insideSolid(tris, x, y, z)) continue;
      mesh++;
      let best = null;
      for (const c of s.chunks) {
        const r = reject(c.cell.poly, x, y, z);
        if (r.d <= 1e-6) { best = null; break; }
        if (!best || r.d < best.d) best = r;
      }
      if (!best) continue;
      miss++;
      bbMiss.expandByPoint(new THREE.Vector3(x, y, z));
      const nn = best.f.n;
      const key = `${nn.x.toFixed(2)},${nn.y.toFixed(2)},${nn.z.toFixed(2)}`;
      const e = byFace.get(key) || { n: 0, dsum: 0, dmax: 0 };
      e.n++; e.dsum += best.d; e.dmax = Math.max(e.dmax, best.d);
      byFace.set(key, e);
    }
  }
}
console.log(`${which}: mesh ${(mesh * vox).toFixed(2)} m³, missed ${(miss * vox).toFixed(3)} m³ `
  + `(${(100 * miss / mesh).toFixed(1)}%) over ${s.chunks.length} cells`);
console.log(`missed bounds ${bbMiss.min.toArray().map(v => v.toFixed(2))} .. ${bbMiss.max.toArray().map(v => v.toFixed(2))}`);
const rows = [...byFace.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 14);
for (const [k, e] of rows) {
  console.log(`  normal ${k.padEnd(20)} ${String(e.n).padStart(6)} vox  ${(e.n * vox).toFixed(3)} m³  `
    + `mean depth ${(e.dsum / e.n).toFixed(3)} m  max ${e.dmax.toFixed(3)}`);
}
