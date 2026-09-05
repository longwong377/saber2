import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
globalThis.fetch = async (url) => {
  const b = await readFile(new URL(String(url), new URL('../', import.meta.url)));
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';
await prepareStation();
const { world } = await bootWorld({
  level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const input = idleInput();
for (let f = 0; f < 60 * 5; f++) world.update(1 / 60, input);
const track = new Map();
for (const e of world.enemies) if (e.stationName) track.set(e, { at: e.position.clone(), path: 0, jump: 0, steps: 0 });
for (let f = 0; f < 60 * 5; f++) {
  world.update(1 / 60, input);
  for (const [e, r] of track) {
    if (!world.enemies.includes(e)) continue;
    const d = e.position.distanceTo(r.at);
    /* A WALK IS MANY SMALL STEPS; A RESEAT IS ONE BIG ONE. 1/60 s at a run is
     * under 0.1 m, so anything over 0.5 m in a frame is a teleport, not a
     * stride, and `reseat` runs twice a second re-pooling bodies. */
    if (d > 0.5) r.jump += d; else { r.path += d; if (d > 0.002) r.steps++; }
    r.at.copy(e.position);
  }
}
const keep = [], res = [];
for (const [e, r] of track) {
  if (!world.enemies.includes(e)) continue;
  (e.stationKeeper ? keep : res).push(r);
}
const med = (a) => a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 0;
const say = (n, a) => {
  if (!a.length) return console.log(`${n}: none`);
  console.log(`${n}: ${a.length} bodies over 5 s — WALKED median ${med(a.map((r) => r.path)).toFixed(2)} m`
    + ` (worst ${Math.max(...a.map((r) => r.path)).toFixed(2)}), on ${med(a.map((r) => r.steps)).toFixed(0)} of 300 frames;`
    + ` TELEPORTED median ${med(a.map((r) => r.jump)).toFixed(2)} m`);
};
say('keepers  ', keep);
say('residents', res);
