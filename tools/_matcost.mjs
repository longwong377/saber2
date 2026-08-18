/** Per-material triangle cost of one maker, built standalone. Iteration aid. */
import './dom-shim.mjs';
import * as THREE from 'three';
import * as P from '../src/world/Props.js';

const M = P.propMaterials();
const name = new Map();
for (const [k, v] of Object.entries(M)) if (v) name.set(v, k);

function stub() {
  const scene = new THREE.Scene();
  return { scene, statics: [], levelLights: [], props: [], doors: [], enemies: [],
    physics: { addStaticBox() { return {}; }, removeStaticBox() {}, staticBoxes: [], add() {}, remove() {}, bodies: [], raycast: () => null },
    addLight(l) { scene.add(l); return l; }, addDoor(d) { return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} }, notify() {}, report() {},
    spawnEnemy: () => null, spawnDebris() {}, time: 0, addProp(p) { this.props.push(p); return p; },
    terrain: null, settings: { quality: 'medium' } };
}
const specs = JSON.parse(process.argv[2] || '[["addMachine",{"width":3.8,"height":2.4,"depth":2.8,"seed":1}]]');
for (const [maker, opts] of specs) {
  const w = stub();
  const res = P[maker](w, new THREE.Vector3(0, 0, 0), opts);
  const rows = [];
  let tot = 0;
  for (const m of (res.meshes || [])) {
    const g = m.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tot += n;
    rows.push([name.get(m.material) || m.material?.name || '?', n]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log(`${maker}: ${res.draws} draws, ${tot} tris — ` +
    rows.map(([k, n]) => `${k} ${n} (${(n / tot * 100).toFixed(1)}%)`).join(', '));
}
