import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
globalThis.__stationFetch = true;
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), root));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const t0 = Date.now();
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
await prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
console.log('booted in', Date.now() - t0, 'ms');
const st = world._station;
console.log('counters:', [...(st.counters || new Map()).entries()].map(([k, v]) => `${k}:${v.length}`).join(' '));
console.log('keepers:', (st.keepers || []).map((k) => `${k.id}@${k.x.toFixed(1)},${k.z.toFixed(1)} body=${!!k.body} rig=${!!k.body?.rig}`).join('\n  '));
