import './dom-shim.mjs';
/* WHO IS HURTING THE RESIDENTS? An idle player on deck 40. */
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';
import { readFile } from 'node:fs/promises';

globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), new URL('../', import.meta.url)));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
await prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});

const { Enemy } = await import('../src/game/Enemy.js');
const tally = new Map();
const orig = Enemy.prototype.damage;
Enemy.prototype.damage = function (amount, point, source, kind, pre) {
  if (this.stationName) {
    const who = source === world.player ? 'PLAYER'
      : source ? (source.constructor?.name + (source.stationName ? ':resident' : '')) : 'NO SOURCE';
    const st = new Error().stack.split('\n').slice(2, 7)
      .map((l) => l.trim().replace(/^at /, '').replace(/ \(.*$/, '').replace(/file:.*\//, ''))
      .filter((l) => l && !l.startsWith('Enemy.damage')).slice(0, 4).join(' < ');
    const k = `${who} / kind=${kind}\n        ${st}`;
    const r = tally.get(k) || { n: 0, amt: 0 };
    r.n++; r.amt += amount;
    tally.set(k, r);
  }
  return orig.call(this, amount, point, source, kind, pre);
};

const input = idleInput();
const life = () => world._stationLife;
for (let f = 0; f < 60 * 45; f++) {
  world.update(1 / 60, input);
  if (f % (60 * 5) === 0) {
    const L = life();
    const res = world.enemies.filter((e) => e.stationName);
    const hurt = res.filter((e) => e.hp < e.maxHp).length;
    console.log(`t=${(f / 60).toFixed(0).padStart(2)}s  residents ${res.length}`
      + `  hurt ${hurt}  standing ${L ? L.standing : '-'}  alarm ${L ? L.alarm.toFixed(1) : '-'}`
      + `  guards ${L ? L.guards.length : '-'}  player hp ${world.player.hp.toFixed(0)}`);
  }
}
console.log('\n── who did the damage ──');
for (const [k, v] of [...tally].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${v.n.toString().padStart(5)} calls  ${v.amt.toFixed(1).padStart(9)} dmg   ${k}`);
}
