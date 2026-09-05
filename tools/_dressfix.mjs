/* THROWAWAY PROBE — off-duty silhouettes, per Borz role, off the live station. */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
globalThis.THREE = THREE;

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** Every mesh under a root, as "geometryType:parameterFingerprint" — no colours. */
function meshTypes(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const p = g.parameters || {};
    const keys = Object.keys(p).sort();
    const sig = keys.map((k) => `${k}=${typeof p[k] === 'number' ? p[k].toFixed(4) : p[k]}`).join(',');
    const pos = g.getAttribute('position');
    out.push(`${g.type}[${pos ? pos.count : 0}]${sig ? '{' + sig + '}' : ''}`);
  });
  return out.sort();
}

const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
diskFetch();
await prepareStation();

const { BORZ_RESIDENTS, borzArchetype } = await import('../src/game/StationCast.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { buildJedi } = await import('../src/game/Bodies.js');

// The auditor's reference: a default buildJedi.
const ref = buildJedi({});
const refTypes = meshTypes(ref.rig.root);
console.log(`REFERENCE default buildJedi: ${refTypes.length} meshes, ${new Set(refTypes).size} distinct, robeSkirt=${!!(ref.robeSkirt && ref.robeSkirt.length)}`);

const rows = [];
for (const R of BORZ_RESIDENTS) {
  if (R.resident === false) continue;
  const key = borzArchetype(R);
  const A = ARCHETYPES[key];
  if (!A) { rows.push([R.id, key, 'NO ARCHETYPE', '', '', '']); continue; }
  const built = A.build({});
  const root = built.rig ? built.rig.root : built.group;
  const t = meshTypes(root);
  const same = t.length === refTypes.length && t.every((x, i) => x === refTypes[i]);
  rows.push([R.id, key, String(t.length), String(new Set(t).size),
             String(!!(built.robeSkirt && built.robeSkirt.length)), same ? 'IDENTICAL-TO-JEDI' : 'differs']);
}
console.log('\nrole            archetype             meshes distinct robeSkirt  vs default buildJedi');
for (const r of rows) {
  console.log(`${r[0].padEnd(15)} ${r[1].padEnd(21)} ${r[2].padStart(6)} ${r[3].padStart(8)} ${r[4].padStart(9)}  ${r[5]}`);
}

// The station itself, so this is measured on bodies that actually stand there.
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const seen = new Map();
for (const e of world.enemies || []) {
  const k = e.type || e.archetype || '?';
  if (!seen.has(k)) seen.set(k, e);
}
console.log(`\nstation: ${world.enemies?.length ?? 0} bodies standing, ${seen.size} distinct archetypes`);
for (const [k, e] of seen) {
  const root = e.rig ? e.rig.root : (e.group || e.mesh);
  if (!root) { console.log(`  ${k}: no root`); continue; }
  const t = meshTypes(root);
  const same = t.length === refTypes.length && t.every((x, i) => x === refTypes[i]);
  console.log(`  ${k.padEnd(22)} ${String(t.length).padStart(4)} meshes ${String(new Set(t).size).padStart(4)} distinct  ${same ? 'IDENTICAL-TO-JEDI' : 'differs'}`);
}
process.exit(0);
