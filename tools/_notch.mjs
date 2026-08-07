import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addColumn, addBrokenWall } from '../src/world/Props.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mkHost(physics, p) {
  const scene = new THREE.Scene();
  return { scene, statics: [], props: [], enemies: [], doors: [], levelLights: [], debris: [],
    physics, particles: null, bladeSolver: null,
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true, friction: 0.9, size: 400,
      normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null },
    player: { position: p || V(0, 1, 0) }, settings: { quality: 'medium' },
    addProp(q) { this.props.push(q); return q; }, addLight(l) { return l; }, onExplosion() {} };
}
const rg = () => ({ size: 256, res: 33, heights: new Float32Array(33 * 33), height: () => 0,
  normalAt: (x, z, o) => o.set(0, 1, 0), slopeAt: () => 0, inBounds: () => true, friction: 0.9,
  deformSeq: 0, raycast: () => null });
await initPhysics();
propMaterials();

function notch(make, from, dir, depth, cells) {
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rg();
  const h = mkHost(w, from);
  make(h);
  const D = h.destruction;
  if (cells) D.maxCellsPerPiece = cells;
  const s = D.structures[0];
  s.prepareAll();
  const n0 = s.chunks.length;
  // walk a small sphere in from the face to `depth` — a slot, not a bite
  const step = 0.18, R = 0.5;
  for (let t = 0; t <= depth; t += step) {
    const p = from.clone().addScaledVector(dir, t);
    s.damageSphere(p, R, 4e4);
  }
  for (let i = 0; i < 300; i++) { w.step(1 / 60); D.update(1 / 60); }
  let top = -Infinity, att = 0;
  for (const c of s.chunks) if (c.state === 'attached') { att++; top = Math.max(top, c.bounds.max.y + s.position.y); }
  return { n0, att, top, state: s.state };
}

console.log('\nnotching a stone column (1.10 m across the shaft) at y = 3.4\n');
console.log('cells  depth   cells left standing   top of what stands');
for (const cells of [null]) {
  for (const d of [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]) {
    const r = notch((h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false }),
      V(-0.72, 3.4, 0), V(1, 0, 0), d, cells);
    console.log(`${String(r.n0).padStart(4)}  ${d.toFixed(2)}m  ${String(r.att).padStart(14)}/${r.n0}   `
      + `${(r.top === -Infinity ? 'nothing' : r.top.toFixed(2) + ' m').padStart(16)}  ${r.state}`);
  }
  console.log('');
}
