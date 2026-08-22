/**
 * BATTLEFRONT BORZ — HOW MUCH OF THE HORDE IS INSIDE THE FORCE'S REACH AT ALL.
 *
 *   node --import ./tools/register.mjs tools/_openreach.mjs [--seeds 3] [--engagements 1]
 *
 * The ceiling on FLAGSHIP §7's third verb, taken as a fact about the FIGHT
 * rather than about any mechanism. `tools/_openwin.mjs` measures what the verb
 * reaches; this measures what it COULD reach if every point of Force were
 * converted into open seconds at no loss.
 *
 * Every Force power that can open a body has a reach:
 *
 *     unleash   11 m, every direction        (`UNLEASH.radius`)
 *     push       9 m, a cone                 (`forcePush`)
 *     pull      17 m √forcePower, a cone     (`forcePull`)
 *     grip      `forceReach`, a ray          (about 36 m at the top slider)
 *
 * So the arithmetic ceiling of "share of enemy body-seconds spent open" is the
 * share of enemy body-seconds spent INSIDE one of those radii — a body forty
 * metres away cannot be opened by anything, however the bar is spent. This
 * counts that, per band, off the same shipped `dutyInput` the open-share bench
 * drives, with no Force spent on anything: the bands are a fact about where the
 * bodies stand, and a Jedi who spends his bar stands in the same place.
 *
 * The bands are read off the game's own constants (`UNLEASH.radius`, the
 * player's live `forceReach`) rather than typed here — HANDOFF §2.4.
 */

import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';
import { dutyInput } from './_flagship.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const STEP = 1 / 30;
const CAP = 220;

const seeds = String(flag('seeds', '3')).split(',').map(Number);
const engagements = Number(flag('engagements', '1'));
const { UNLEASH } = await import('../src/game/Player.js');

const rows = [];
for (const seed of seeds) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  const input = dutyInput(world);
  const p = world.player;
  /* THE BANDS, off the game's own numbers. `forceReach` is a live property of
   * the player (it rides the Force Power slider), so it is read here rather
   * than assumed. */
  const bands = [
    ['unleash 11 m', UNLEASH.radius],
    ['push 9 m', 9],
    ['pull 17 m', 17 * Math.sqrt(p.forceScale)],
    ['grip reach', p.forceReach],
  ];
  const inBand = bands.map(() => 0);
  let enemySeconds = 0, bodies = 0, frames = 0;
  const start = world.director.wave;
  const n = Math.round(CAP * engagements / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);          // HANDOFF §2.5c
    world.update(STEP, input);
    t += STEP;
    frames++;
    const mine = world.player ? world.player.team : (world.command?.commander?.team ?? 0);
    let live = 0;
    for (const e of world.enemies) {
      if (e.dead || e.team === mine) continue;
      live++;
      enemySeconds += STEP;
      if (!world.player?.alive) continue;
      const d = e.position.distanceTo(world.player.position);
      for (let b = 0; b < bands.length; b++) if (d <= bands[b][1]) inBand[b] += STEP;
    }
    bodies += live;
    if (world.director.wave > start + engagements - 1 || world.command.done) break;
  }
  const row = {
    seed, gameSeconds: +t.toFixed(1), enemySeconds: +enemySeconds.toFixed(1),
    liveBodies: +(bodies / Math.max(frames, 1)).toFixed(1),
    bands: Object.fromEntries(bands.map(([k], b) =>
      [k, +(inBand[b] / Math.max(enemySeconds, 1e-9)).toFixed(5)])),
    reach: Object.fromEntries(bands.map(([k, r]) => [k, +r.toFixed(1)])),
  };
  rows.push(row);
  console.log(`  seed ${seed}  ${row.gameSeconds}s  ${row.liveBodies} live hostiles  `
    + Object.entries(row.bands).map(([k, v]) => `${k} ${(v * 100).toFixed(2)}%`).join('  '));
  world.unload?.();
}
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
console.log(`\n  n=${rows.length}  mean live hostiles ${mean((r) => r.liveBodies).toFixed(1)}`);
for (const k of Object.keys(rows[0]?.bands || {})) {
  console.log(`    ${k.padEnd(14)} ${(mean((r) => r.bands[k]) * 100).toFixed(2)}% of enemy body-seconds`);
}
