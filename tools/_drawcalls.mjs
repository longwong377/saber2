/**
 * WHO IS SPENDING THE DRAW CALLS. Iteration aid for the bound
 * `world-immersion` puts on a dressed level ("filling the ground did not cost
 * a draw call per pebble"): dress one level headlessly and attribute every
 * mesh that reached the scene to the maker that created it, the material it
 * was binned under, and how many instances it carries.
 *
 *   node --import ./tools/register.mjs tools/_drawcalls.mjs geonosis [--sites]
 *
 * The attribution is the same stack walk `prop-seating` uses — never call it a
 * measurement of anything but a label; `--sites` adds the Levels.js line the
 * maker was called from, which is what tells a merged kit apart from a maker
 * a level called forty times in a loop.
 *
 * NOTHING IS ASSERTED HERE. The bound lives in tools/checks/world-immersion.mjs.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Terrain } from '../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { GrassField } from '../src/world/Scenery.js';
import * as P from '../src/world/Props.js';

const EXPORTED = new Set(Object.keys(P));
function frames(stack) {
  const out = [];
  for (const line of String(stack).split('\n')) {
    const m = /at (?:new )?([A-Za-z0-9_$.<>]+) \((.*\/src\/(?:world|game)\/[A-Za-z]+\.js):(\d+):/.exec(line);
    if (m) out.push({ name: m[1].split('.').pop(), file: m[2].replace(/^.*\/src\//, 'src/'), line: +m[3] });
  }
  return out;
}
/** The outermost Props/Scenery frame — the maker the level asked for. */
function makerOf(fr) {
  let best = null;
  for (const f of fr) if (EXPORTED.has(f.name) || /^(add|make|strew|scatter)[A-Z]/.test(f.name)) best = f.name;
  return best || '?';
}
/** The Levels.js line that asked for it. */
function siteOf(fr) {
  for (const f of fr) if (f.file.startsWith('src/game/Levels.js')) return f.file + ':' + f.line;
  return '';
}

function stubWorld(terrain, level) {
  const scene = new THREE.Scene();
  const realAdd = scene.add.bind(scene);
  scene.add = (...objs) => {
    for (const o of objs) {
      if (!o || !o.userData || o.userData.__maker) continue;
      const fr = frames(new Error().stack);
      o.userData.__maker = makerOf(fr);
      o.userData.__site = siteOf(fr);
    }
    return realAdd(...objs);
  };
  return {
    scene, level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() { return {}; }, removeStaticBox() {}, staticBoxes: [], add() {}, remove() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null, spawnDebris() {},
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    settings: { quality: 'medium' },
  };
}

const wantSites = process.argv.includes('--sites');
const keys = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = keys.length ? keys : LEVEL_ORDER;

P.propMaterials();
const matName = new Map();
for (const [k, v] of Object.entries(P.propMaterials())) if (v) matName.set(v, k);

for (const key of list) {
  const L = LEVELS[key];
  if (!L || typeof L.dress !== 'function') { console.log(`${key}: no dress()`); continue; }
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const world = stubWorld(terrain, L);
  const grass = L.grass ? new GrassField(new THREE.Scene(), terrain, { count: 3000, density: L.grass, radius: 46 }) : null;
  L.dress(world);

  let meshes = 0, instanced = 0, instances = 0, tris = 0;
  const byMaker = new Map();
  const bySite = new Map();
  const seen = new Set();
  const take = (o, fromProp) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    // a Prop's mesh is on world.scene AND on world.props; one mesh is one call
    if (seen.has(o)) return;
    seen.add(o);
    meshes++;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const c = o.isInstancedMesh ? o.count : 1;
    if (o.isInstancedMesh) { instanced++; instances += o.count; }
    tris += n * c;
    let root = o;
    while (root.parent && !root.userData.__maker && root.parent.userData) root = root.parent;
    const maker = (fromProp ? 'prop:' : '') + (root.userData.__maker || (fromProp ? 'prop' : 'loose'));
    const site = root.userData.__site || '';
    const bm = byMaker.get(maker) || { calls: 0, inst: 0, tris: 0, mats: new Map(), sites: new Map() };
    bm.calls++; bm.inst += c; bm.tris += n * c;
    const mn = matName.get(o.material) || o.material?.name || o.material?.type || '?';
    bm.mats.set(mn, (bm.mats.get(mn) || 0) + 1);
    if (site) bm.sites.set(site, (bm.sites.get(site) || 0) + 1);
    byMaker.set(maker, bm);
    if (site) {
      const bs = bySite.get(site) || { calls: 0, maker };
      bs.calls++; bySite.set(site, bs);
    }
  };
  world.scene.traverse((o) => take(o, false));
  for (const p of world.props) if (p.mesh) p.mesh.traverse((o) => take(o, true));

  console.log(`\n══ ${key}: ${meshes} draw calls, ${instanced} of them instanced (${instances} instances), ${(tris / 1000) | 0}k tris`);
  const rows = [...byMaker.entries()].sort((a, b) => b[1].calls - a[1].calls);
  for (const [maker, r] of rows) {
    if (r.calls < 2 && rows.length > 30) continue;
    const mats = [...r.mats.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}×${n}`).join(' ');
    console.log(`  ${String(r.calls).padStart(4)} calls  ${String(r.inst).padStart(6)} inst  ${String((r.tris / 1000) | 0).padStart(5)}k  ${maker.padEnd(22)} ${mats}`);
  }
  if (wantSites) {
    console.log('  ── by call site ──');
    for (const [site, r] of [...bySite.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 30)) {
      console.log(`  ${String(r.calls).padStart(4)} calls  ${r.maker.padEnd(22)} ${site}`);
    }
  }
  grass?.dispose();
  terrain.dispose();
}
