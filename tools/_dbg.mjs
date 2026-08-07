import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addColumn, addLintel } from '../src/world/Props.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mkHost(physics) {
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

await initPhysics();
propMaterials();
const w = new RapierWorld({ gravity: -22 });
w.terrain = rg();
const host = mkHost(w);
addColumn(host, V(-2.2, 0, 0), { height: 6, radius: 0.45, seed: 1 });
addColumn(host, V(2.2, 0, 0), { height: 6, radius: 0.45, seed: 2 });
addLintel(host, V(0, 6.2, 0), { length: 6.4, height: 0.62, depth: 0.72, seed: 3 });
const D = host.destruction;
D._linkSupports();
const [left, right, lintel] = D.structures;
const y0 = lintel.centre.y;
left.damageSphere(V(-2.2, 0.5, 0), 1.6, 4000, V(1, 0, 0));
console.log('left', left.state, 'right', right.state, 'lintel', lintel.state,
  'lintel live', lintel.chunks.filter(c => c.state === 'live').length, '/', lintel.chunks.length);
for (let i = 0; i < 360; i++) { w.step(1 / 60); D.update(1 / 60); }
const hi = lintel.chunks.filter(c => c.mesh).sort((a, b) => b.mesh.position.y - a.mesh.position.y);
console.log('y0', y0.toFixed(2));
for (const c of hi.slice(0, 4)) {
  console.log(` chunk ${c.index} state=${c.state} pos=(${c.mesh.position.x.toFixed(2)},`
    + `${c.mesh.position.y.toFixed(2)},${c.mesh.position.z.toFixed(2)}) `
    + `start=(${c.centre.x.toFixed(2)},${(c.centre.y + lintel.position.y).toFixed(2)}) `
    + `half=${c.half.x.toFixed(2)},${c.half.y.toFixed(2)},${c.half.z.toFixed(2)} v=${c.body ? c.body.velocity.length().toFixed(2) : 'none'}`);
}
console.log('right column collider top:', w.staticBoxes.filter(b => b && b.center && b.center.x > 1.5)
  .map(b => (b.center.y + b.halfExtents.y).toFixed(2)).join(','));
