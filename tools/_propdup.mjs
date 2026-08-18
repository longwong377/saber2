/** Is a Prop's mesh in world.scene as well as in world.props? One question. */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Terrain } from '../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { GrassField } from '../src/world/Scenery.js';
import * as P from '../src/world/Props.js';
function stub(terrain, level) {
  const scene = new THREE.Scene();
  return { scene, level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() { return {}; }, removeStaticBox() {}, staticBoxes: [], add() {}, remove() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; }, addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} }, notify() {}, report() {}, spawnEnemy: () => null,
    spawnDebris() {}, time: 0, addProp(p) { this.props.push(p); return p; }, terrain, settings: { quality: 'medium' } };
}
P.propMaterials();
for (const key of (process.argv.slice(2).length ? process.argv.slice(2) : LEVEL_ORDER)) {
  const L = LEVELS[key];
  if (!L || typeof L.dress !== 'function') continue;
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const world = stub(terrain, L);
  const grass = L.grass ? new GrassField(new THREE.Scene(), terrain, { count: 3000, density: L.grass, radius: 46 }) : null;
  L.dress(world);
  const inScene = new Set();
  world.scene.traverse((o) => { if (o.isMesh && o.geometry) inScene.add(o); });
  let propMeshes = 0, alsoInScene = 0;
  for (const p of world.props) if (p.mesh) p.mesh.traverse((o) => {
    if (!o.isMesh || !o.geometry) return; propMeshes++; if (inScene.has(o)) alsoInScene++;
  });
  console.log(`${key}: scene meshes ${inScene.size}, prop meshes ${propMeshes}, of which already in the scene ${alsoInScene} — check counts ${inScene.size + propMeshes},真 ${inScene.size + propMeshes - alsoInScene}`);
  grass?.dispose(); terrain.dispose();
}
