import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addRuin, addOutpost } from '../src/world/Props.js';
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
for (const [name, build] of [
  ['addRuin', (h) => addRuin(h, V(0, 0, 0), { size: 'medium', seed: 2020 })],
  ['addOutpost', (h) => addOutpost(h, V(0, 0, 0), { radius: 10, seed: 1500 })],
]) {
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rg();
  const host = mkHost(w);
  const t0 = performance.now();
  const res = build(host);
  const ms = performance.now() - t0;
  const D = host.destruction;
  console.log(`${name}: ${host.statics.length} meshes (draw calls), ${res.triangles | 0} tris, `
    + `${w.staticBoxes.length} colliders, ${D ? D.structures.length : 0} destructible pieces, ${ms.toFixed(0)}ms`);
  if (D) {
    const kinds = {};
    for (const s of D.structures) {
      const k = `${s.size.x.toFixed(1)}x${s.size.y.toFixed(1)}x${s.size.z.toFixed(1)}`;
      kinds[k] = (kinds[k] || 0) + 1;
    }
    console.log('   pieces: ' + Object.entries(kinds).map(([k, n]) => `${n}x ${k}`).join(', '));
    // and each one can be broken on its own
    let broke = 0;
    for (const s of D.structures) {
      s.damageSphere(s.centre, Math.max(2, s.radius * 0.6), 1e5);
      if (s.state !== 'intact') broke++;
    }
    console.log(`   ${broke}/${D.structures.length} broke independently`);
  }
}
