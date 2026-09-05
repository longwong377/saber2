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
const who = world.enemies.filter((e) => e.stationName).slice(0, 4);
for (const e of who) {
  const t = e.target;
  console.log(`${e.stationName} (${e.type}) team ${e.team} keeper ${!!e.stationKeeper}`
    + `  target=${t ? (t === world.player ? 'THE PLAYER' : (t.stationName || t.type || 'something')) : 'null'}`
    + `  wish=${e.wish ? JSON.stringify(e.wish).slice(0, 70) : 'null'}`
    + `  compelled=${!!e.compelled}  duty=${e._cmpDuty || '-'}`);
}
console.log(`player team ${world.player.team}; enemies on other teams: `
  + world.enemies.filter((e) => e.team !== world.player.team).length);
console.log(`pickTarget for the first: `, (() => {
  try { return world._ctx?.pickTarget ? String(world._ctx.pickTarget(who[0])?.stationName ?? world._ctx.pickTarget(who[0])) : 'no ctx'; }
  catch (e) { return 'threw: ' + e.message; }
})());
