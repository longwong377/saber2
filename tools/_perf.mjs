import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addColumn, addBrokenWall, addArch } from '../src/world/Props.js';
import { Destruction as Dnew } from '../src/world/Destruction.js';
import { Destruction as Dold } from '../src/world/_DestructionOld.js';

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

function run(Manager, build, reps) {
  let fractureMs = 0, prepMs = 0, cells = 0, tris = 0;
  for (let r = 0; r < reps; r++) {
    const w = new RapierWorld({ gravity: -22 });
    w.terrain = rg();
    const host = mkHost(w);
    // register through the manager class under test
    host.destruction = new Manager(host, {});
    build(host);
    const s = host.destruction.structures[0];
    let t = performance.now();
    s.prefracture();
    fractureMs += performance.now() - t;
    t = performance.now();
    for (const c of s.chunks) s.prepareCell(c);
    prepMs += performance.now() - t;
    cells += s.chunks.length;
    for (const c of s.chunks) tris += c.tris || 0;
    host.destruction.dispose();
  }
  return { fractureMs: fractureMs / reps, prepMs: prepMs / reps, cells: cells / reps, tris: tris / reps };
}

const cases = [
  ['column', (h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500 })],
  ['wall', (h) => addBrokenWall(h, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 })],
  ['arch', (h) => addArch(h, V(0, 0, 0), { span: 5, seed: 33 })],
];
const REPS = 10;
console.log('\nprefracture + prepareCell cost, mean of ' + REPS + ' builds (warm)\n');
console.log('piece    version   cells   fracture ms   geometry ms   total ms   tris');
for (const [name, build] of cases) {
  run(Dold, build, 3); run(Dnew, build, 3);                 // warm both paths
  const o = run(Dold, build, REPS), n = run(Dnew, build, REPS);
  for (const [tag, r] of [['before', o], ['after', n]]) {
    console.log(`${name.padEnd(8)} ${tag.padEnd(8)} ${r.cells.toFixed(1).padStart(5)}   `
      + `${r.fractureMs.toFixed(2).padStart(10)}   ${r.prepMs.toFixed(2).padStart(10)}   `
      + `${(r.fractureMs + r.prepMs).toFixed(2).padStart(7)}   ${r.tris.toFixed(0)}`);
  }
}
console.log('');
