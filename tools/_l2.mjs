/**
 * WHAT EVERY BODY COSTS PAST 62 METRES, BIN BY BIN — the iteration aid for the
 * L2 merged rigid skin (src/game/MergedSkin.js, FLAGSHIP §14 Step 4).
 *
 *   node --import ./tools/register.mjs tools/_l2.mjs
 *   node --import ./tools/register.mjs tools/_l2.mjs --bins trooper
 *
 * The BOUND lives in tools/checks/frame-budget.mjs and nothing is asserted
 * here. What this adds is the per-archetype table and, with `--bins`, the
 * reason two materials would not fold together — which is the only question
 * worth asking when a body's count suddenly goes up: the bin key is derived
 * from the material, so a new property on one mesh splits it off from the
 * twenty-five it used to share a call with, and the diff below names which.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES } from '../src/game/Enemy.js';
import { buildMergedSkin, mergeBinKey, refuseReason } from '../src/game/MergedSkin.js';
import '../src/game/Levels.js';          // the Command units and the IG general

await initPhysics();

const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
const terrain = {
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
};
physics.terrain = terrain;
const nothing = { sandPuff() {}, sparkBurst() {}, cutFlare() {}, slag() {}, plasma: { spawn() {} } };
const world = {
  scene: new THREE.Scene(), physics, terrain, statics: [], settings: { fov: 60 },
  players: [], enemies: [], props: [], particles: nothing, time: 0, groundColor: 0xcfae82,
  bolts: { fire() {} }, engine: { flash() {}, camera: new THREE.PerspectiveCamera() },
  report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
};

const wantBins = process.argv.includes('--bins');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
enemyRng.seed(20260821);

let kept = 0, merged = 0, bytes = 0;
for (const type of Object.keys(ARCHETYPES)) {
  if (only.length && !only.includes(type)) continue;
  const e = new Enemy(world, type, new THREE.Vector3(0, 0, 0));
  if (!e.rig) { console.log(`${type.padEnd(12)} baked group, no rig — the LOD does not touch it`); continue; }
  e._applyLod(1);                       // the shipped cull; what survives is what merges
  const skin = buildMergedSkin(e.rig);
  if (!skin) { console.log(`${type.padEnd(12)} nothing to gain`); continue; }
  kept += skin.from; merged += skin.to;
  let tri = 0, b = 0;
  for (const m of skin.meshes) {
    tri += m.geometry.index.count / 3;
    for (const a of Object.values(m.geometry.attributes)) b += a.array.byteLength;
    b += m.geometry.index.array.byteLength;
  }
  bytes += b;
  const out = [...skin.refused].map(([k, n]) => `${n} ${k}`).join(', ');
  console.log(`${type.padEnd(12)} ${String(skin.from).padStart(3)} -> ${String(skin.to).padStart(2)} calls  `
    + `${String(tri | 0).padStart(6)} tri  ${(b / 1024).toFixed(0).padStart(4)} kB` + (out ? `  left out: ${out}` : ''));

  if (wantBins) {
    const keys = [];
    e.rig.root.traverse((o) => {
      if (!o.isMesh || !o.visible || refuseReason(o)) return;
      let a = o.parent, hidden = false;
      while (a) { if (a.visible === false) hidden = true; a = a.parent; }
      if (!hidden) keys.push(mergeBinKey(o.material));
    });
    const uniq = [...new Set(keys)].map((k) => k.split('|'));
    const n = Math.max(...uniq.map((s) => s.length));
    for (let i = 0; i < n; i++) {
      const vals = new Set(uniq.map((s) => s[i]));
      if (vals.size > 1) console.log(`    splits on ${[...vals].join('   ')}`);
    }
  }
  e.dispose?.();
}
if (!only.length) {
  console.log(`\n${kept} kept meshes -> ${merged} draw calls (${(kept / merged).toFixed(1)}x) `
    + `for ${(bytes / 1048576).toFixed(1)} MB of baked geometry across the roster`);
}
