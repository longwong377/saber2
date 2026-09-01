import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld } = await import('./checks/_coop.mjs');
const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
const life = world._deckLife;
const own = new Set();
const walk = (o) => { if (o.isMesh || o.isInstancedMesh) own.add(o); o.children.forEach(walk); };
for (const k of ['haze']) if (life[k]) own.add(life[k]);
for (const r of life.rings || []) own.add(r.mesh);
if (life.crew) own.add(life.crew.mesh);
for (const d of life.droids || []) { walk(d.turret); }
if (life.trolley) walk(life.trolley.body);
if (life.tech) walk(life.tech.group);
if (life.sled) walk(life.sled.group);
let all = 0, tris = 0, ownTris = 0;
world.scene.traverse((o) => {
  if (!(o.isMesh || o.isInstancedMesh)) return;
  all++;
  const g = o.geometry; const t = g && g.index ? g.index.count / 3 : (g && g.attributes.position ? g.attributes.position.count / 3 : 0);
  const n = o.isInstancedMesh ? o.count : 1;
  tris += t * n;
  if (own.has(o)) ownTris += t * n;
});
console.log('scene meshes', all, 'tris', Math.round(tris));
console.log('decklife meshes (movers+crew+haze+rings)', own.size, 'tris', Math.round(ownTris));
// droid chassis kit is emitted separately: count meshes with propMaterials
console.log('statics', world.statics.length);
world.unload();
process.exit(0);
