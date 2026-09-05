import './dom-shim.mjs';
/* Does §11 still fire when you ACTUALLY cut one? And does a long, peaceful
 * evening on the concourse leave anybody dying of being walked into? */
import { readFile } from 'node:fs/promises';
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), new URL('../', import.meta.url)));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';

async function deck(n) {
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = n; },
  });
  return world;
}

/* ── 1. an assault must still bring the guards ─────────────────────────── */
{
  const world = await deck(40);
  const input = idleInput();
  for (let f = 0; f < 60 * 6; f++) world.update(1 / 60, input);
  const victim = world.enemies.find((e) => e.stationName);
  console.log(`victim: ${victim?.stationName} hp ${victim?.hp}/${victim?.maxHp}`);
  /* the player's own hand, through the shipped damage door */
  victim.damage(25, victim.position.clone(), world.player, 'saber');
  console.log(`after the cut: hp ${victim.hp}  hurtByPlayer ${victim.hurtByPlayer}`);
  for (let f = 0; f < 60 * 3; f++) world.update(1 / 60, input);
  const L = world._stationLife;
  console.log(`ASSAULT → standing ${L.standing}  alarm ${L.alarm.toFixed(1)}  guards ${L.guards.length}`);
  console.log(L.standing < 0 && L.guards.length === 2
    ? '  ✓ §11 still fires on a real assault' : '  ✗ THE GUARD IS DEAD');
}

/* ── 2. three decks, five minutes, nobody touching anybody ─────────────── */
for (const n of [40, 44, 48]) {
  const world = await deck(n);
  const input = idleInput();
  for (let f = 0; f < 60 * 300; f++) world.update(1 / 60, input);
  const res = world.enemies.filter((e) => e.stationName);
  const worst = res.reduce((a, e) => Math.min(a, e.hp / e.maxHp), 1);
  const L = world._stationLife;
  console.log(`deck ${n}: 300 s idle — residents ${res.length}`
    + `  worst hp ${(worst * 100).toFixed(0)}%  standing ${L.standing}`
    + `  guards ${L.guards.length}  player hp ${world.player.hp.toFixed(0)}`);
}
