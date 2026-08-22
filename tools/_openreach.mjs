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
    /* THE FORCE POWER SLIDER IS IN THIS MEASUREMENT ON PURPOSE. `forceReach`
     * and the pull's range both ride it as √power, so the ceiling below is not
     * a constant of the game — it is a function of a setting the player
     * already owns. `--power 4` is the top of the slider. */
    /**
     * `runSeed`, NOT `settings.seed` — AND THE SEED LIST WAS DECORATIVE UNTIL
     * THIS LINE.
     *
     * `settings.seed` has exactly two readers in the tree (`main.js`, which
     * assigns `world.runSeed` from it, and a display field in Command.js).
     * `bootWorld` sets `world.runSeed` only from its OWN `runSeed` argument,
     * and `CommandDirector` takes `opts.seed ?? world?.runSeed ?? null` — so a
     * probe that passed the seed in `settings` and nowhere else booted a world
     * with `runSeed` undefined and `director.seed` NULL, which is the branch
     * that never calls `seedWaves`, `enemyRng.seed`, `duelRng.seed` or
     * `seedArrivals`. Every run was a fresh `Math.random()` fight and the
     * `--seeds` flag named nothing.
     *
     * Measured before this line, one quantity, seed 3 quoted three times:
     * the share of enemy body-seconds inside the grip's reach read **11.18%,
     * 14.52% and 23.85%** on the same tree at the same slider setting. That
     * spread is the whole of the difference two published ceiling figures were
     * being asked to explain.
     */
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight',
      forcePower: Number(flag('power', '1')) },
    runSeed: seed,
  });
  world.director.start(1);
  const input = dutyInput(world);
  const p = world.player;
  /* THE BANDS, off the game's own numbers. `forceReach` is a live property of
   * the player (it rides the Force Power slider), so it is read here rather
   * than assumed. */
  /**
   * EVERY RADIUS OFF THE GAME'S OWN EXPRESSION — HANDOFF §2.4.
   *
   * The first version of this list carried `push 9` as a literal, taken from a
   * sentence in `forceUnleash`'s header ("Push reaches 9 m in a cone"). The
   * shipped line is `const range = 13 * Math.sqrt(P)` in `Player.forcePush`,
   * so the probe under-counted the push band by four metres at the default
   * slider and by eight at the top — an instrument restating a rule and
   * disagreeing with it, which is the one thing this repository has a section
   * about. `UNLEASH.radius` is passed to `_shockwave` with NO `P` term, so
   * that band genuinely does not ride the slider and is the only one here that
   * does not.
   */
  const P = Math.sqrt(p.forceScale);
  const bands = [
    ['push', 13 * P],              // Player.forcePush: `13 * Math.sqrt(P)`
    ['unleash', UNLEASH.radius],   // Player.forceUnleash: no P term — a constant
    ['pull', 17 * P],              // Player.forcePull: `17 * Math.sqrt(P)`
    ['grip reach', p.forceReach],  // Player.forceReach: `18 * Math.sqrt(P)`
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
  console.log(`  seed ${seed}  power ${Number(flag('power', '1'))}  ${row.gameSeconds}s  `
    + `${row.liveBodies} live hostiles  `
    + Object.entries(row.bands).map(([k, v]) =>
        `${k}@${row.reach[k]}m ${(v * 100).toFixed(2)}%`).join('  '));
  world.unload?.();
}
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
console.log(`\n  n=${rows.length}  mean live hostiles ${mean((r) => r.liveBodies).toFixed(1)}`);
console.log(`  mean game-seconds ${mean((r) => r.gameSeconds).toFixed(1)}`);
for (const k of Object.keys(rows[0]?.bands || {})) {
  /* THE RADIUS IS PRINTED BESIDE THE SHARE because two of these four bands
   * RIDE THE FORCE POWER SLIDER and two do not: `forceReach` is
   * `18 * sqrt(forcePower)` and the pull is `17 * sqrt(forcePower)`, while
   * `UNLEASH.radius` and the push's 9 m are constants. A ceiling quoted
   * without the radius it was taken at cannot be compared with another one. */
  const sd = rows.length > 1
    ? Math.sqrt(rows.reduce((a, r) => a + (r.bands[k] - mean((x) => x.bands[k])) ** 2, 0) / (rows.length - 1))
    : 0;
  console.log(`    ${k.padEnd(14)} r ${rows[0].reach[k].toFixed(1)} m   `
    + `${(mean((r) => r.bands[k]) * 100).toFixed(2)}% of enemy body-seconds`
    + (rows.length > 1 ? `  ±${(sd * 100 / Math.sqrt(rows.length)).toFixed(2)}` : ''));
}
