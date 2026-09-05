import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
globalThis.fetch = async (url) => {
  const b = await readFile(new URL(String(url), new URL('../', import.meta.url)));
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';
import { canHarm, teamOf, harmRules } from '../src/game/Player.js';
await prepareStation();
const { world } = await bootWorld({
  level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const input = idleInput();
for (let f = 0; f < 60 * 5; f++) world.update(1 / 60, input);
const e = world.enemies.find((x) => x.stationName);
const p = world.player;
console.log('world.rules      =', JSON.stringify(world.rules));
console.log('harmRules(world) =', JSON.stringify(harmRules(world)));
console.log(`teamOf(resident) = ${teamOf(e)}   teamOf(player) = ${teamOf(p)}`);
console.log(`canHarm(resident -> player, world.rules) = ${canHarm(e, p, world.rules)}`);
console.log(`canHarm(resident -> player, harmRules)   = ${canHarm(e, p, harmRules(world))}`);
console.log(`world.players holds ${world.players.length}; player in it: ${world.players.includes(p)}`);
console.log(`pickTarget(resident) = ${world.pickTarget(e) === p ? 'THE PLAYER' : String(world.pickTarget(e))}`);
console.log(`resident.trooper = ${!!e.trooper}   world.command = ${!!world.command}`);
