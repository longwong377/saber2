/**
 * Dress one level headlessly and report draw calls, objects, tallest thing and
 * the barrenness survey. Iteration aid only — the real assertions live in
 * tools/checks.
 *
 *   node dress.mjs <levelKey>
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Terrain } from '../src/world/Terrain.js';
import { LEVELS } from '../src/game/Levels.js';
import { GrassField, ground } from '../src/world/Scenery.js';

const key = process.argv[2];
const L = LEVELS[key];
if (!L) { console.error('no such level', key); process.exit(1); }

function stubWorld(terrain) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() {}, staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null,
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    level: L,
    settings: { quality: 'medium' },
  };
}

const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
const world = stubWorld(terrain);
ground.terrain = terrain;
if (L.grass > 0) {
  world.grass = ground.grass = new GrassField(world.scene, terrain, {
    density: L.grass, tint: L.grassTint, seed: 4,
  });
}
L.dress(world);

let meshes = 0, instances = 0, tallest = 0, tallestName = '';
const b = new THREE.Box3(), s = new THREE.Vector3();
const tall = [];
world.scene.traverse((o) => {
  if (!o.isMesh || !o.geometry?.attributes?.position) return;
  meshes++;
  o.updateMatrixWorld(true);
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
  b.getSize(s);
  instances += o.isInstancedMesh ? o.count : 1;
  if (s.x > 150 || s.z > 150) return;
  if (s.y > tallest) { tallest = s.y; tallestName = o.userData.__maker || o.name || 'mesh'; }
  tall.push([s.y, o.userData.__maker || o.name || 'mesh', Math.max(s.x, s.z)]);
});
tall.sort((a, c) => c[0] - a[0]);
let tris = 0;
world.scene.traverse((o) => { if (!o.isMesh || !o.geometry?.attributes?.position) return;
  const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
  tris += n * (o.isInstancedMesh ? o.count : 1); });
console.log(`${key}: ${meshes} draw calls, ${instances} instances, ${world.props.length} props, ${(tris/1000)|0}k tris`);
console.log(`tallest: ${tallest.toFixed(1)} m (${tallestName})`);
console.log('top 12 by height:');
for (const [h, n, w] of tall.slice(0, 12)) console.log(`   ${h.toFixed(1)} m  ${w.toFixed(1)} m wide  ${n}`);
console.log(`over 20 m: ${tall.filter(t => t[0] >= 20).length}, over 12 m: ${tall.filter(t => t[0] >= 12).length}`);
const byMaker = new Map();
world.scene.traverse((o) => { if (!o.isMesh || !o.geometry?.attributes?.position) return;
  const k = o.userData.__maker || 'loose'; byMaker.set(k, (byMaker.get(k)||0)+1); });
let propCalls = 0;
for (const pr of world.props) pr.mesh?.traverse?.((o)=>{ if(o.isMesh) propCalls++; });
const triByMaker = new Map();
world.scene.traverse((o) => { if (!o.isMesh || !o.geometry?.attributes?.position) return;
  const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
  const k = o.userData.__maker || 'loose'; triByMaker.set(k, (triByMaker.get(k)||0)+n); });
{const big=[];world.scene.traverse((o)=>{if(!o.isMesh||!o.geometry?.attributes?.position)return;
 const g=o.geometry;const n=(g.index?g.index.count:g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);
 big.push([n, o.userData.__maker||o.name||o.material?.name||'?', o.isInstancedMesh?o.count:1]);});
 big.sort((a,b)=>b[0]-a[0]);console.log('biggest meshes:',big.slice(0,10).map(([n,k,c])=>`${k}x${c}=${(n/1000).toFixed(0)}k`).join(' '));}
{const M = (await import('../src/world/Props.js')).propMaterials();
 const name = new Map(); for (const [k,v] of Object.entries(M)) if (v) name.set(v, k);
 const byMat=new Map();
 world.scene.traverse((o)=>{if(!o.isMesh||!o.geometry?.attributes?.position)return;
  const g=o.geometry;const n=(g.index?g.index.count:g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);
  const k=name.get(o.material)||o.material?.type||'?';byMat.set(k,(byMat.get(k)||0)+n);});
 console.log('tris by material:',[...byMat.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}=${(v/1000)|0}k`).join(' '));}
console.log('tris by maker:', [...triByMaker.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${(v/1000)|0}k`).join(' '));
console.log('draw calls by maker:', [...byMaker.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join(' '));
console.log('prop meshes (not in scene traverse):', propCalls);
