/* scratch probe — hangar bay geometry. Not a check. */
import './dom-shim.mjs';
import * as THREE from 'three';
import * as P from '../src/world/Props.js';
import { Terrain } from '../src/world/Terrain.js';
import { LEVELS } from '../src/game/Levels.js';

const T = new Terrain(new THREE.Scene(), 'hangar', 0.5);
console.log('terrain height along x (z=0):');
for (const x of [0, 40, 56, 62, 66, 68, 74, 80, 84, 90, 96, 100, 110, 120, 132]) {
  console.log('   x=' + String(x).padStart(4), 'h=' + T.height(x, 0).toFixed(2),
    ' h(x,40)=' + T.height(x, 40).toFixed(2), ' inBounds=' + T.inBounds(x, 0, 4));
}
// where does the wall reach 5, 7, 8, 10 m?
for (const target of [1, 3, 5, 7, 8, 10, 15, 20]) {
  let lo = 74, hi = 149;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (T.height(m, 0) < target) lo = m; else hi = m; }
  console.log(`   wall reaches ${target} m at |x| = ${lo.toFixed(2)}`);
}

// gantry axis: build one standalone at each yaw and measure its deck extent
const stub = () => {
  const scene = new THREE.Scene();
  return { scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() { return {}; }, removeStaticBox() {}, staticBoxes: [], add() {}, remove() {}, bodies: [], raycast: () => null },
    addLight(l) { scene.add(l); return l; }, addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} }, notify() {}, report() {},
    spawnEnemy: () => null, spawnDebris() {}, time: 0, addProp(p) { this.props.push(p); return p; },
    terrain: T, settings: { quality: 'medium' } };
};
P.propMaterials();
for (const yaw of [0, Math.PI / 2]) {
  const w = stub();
  const res = P.addGantry(w, new THREE.Vector3(0, 0, 0), { length: 34, height: 5.2, yaw, seed: 9401, lights: true });
  const box = new THREE.Box3();
  for (const m of res.meshes) { m.updateMatrixWorld(true); box.expandByObject(m); }
  const s = box.getSize(new THREE.Vector3());
  console.log(`gantry yaw=${yaw.toFixed(3)}  extent x=${s.x.toFixed(2)}  y=${s.y.toFixed(2)}  z=${s.z.toFixed(2)}  long axis = ${s.x > s.z ? 'X' : 'Z'}`);
}
