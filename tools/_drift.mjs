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
const mark = new Map();
for (const e of world.enemies) if (e.stationName) mark.set(e, e.position.clone());
const p0 = world.player.position.clone();
for (let f = 0; f < 60 * 5; f++) world.update(1 / 60, input);
let keep = [], res = [];
for (const [e, at] of mark) {
  if (!world.enemies.includes(e)) continue;
  const d = e.position.distanceTo(at);
  const toP = e.position.distanceTo(world.player.position);
  const wasP = at.distanceTo(p0);
  (e.stationKeeper ? keep : res).push({ d, closed: wasP - toP });
}
const say = (n, a) => {
  if (!a.length) return console.log(`${n}: none`);
  const d = a.map((x) => x.d).sort((x, y) => x - y);
  const c = a.map((x) => x.closed).sort((x, y) => x - y);
  console.log(`${n}: ${a.length} bodies — drift over 5 s median ${d[d.length >> 1].toFixed(2)} m,`
    + ` worst ${d[d.length - 1].toFixed(2)} m; closed on the player median ${c[c.length >> 1].toFixed(2)} m,`
    + ` worst ${c[c.length - 1].toFixed(2)} m`);
};
say('keepers ', keep);
say('residents', res);
