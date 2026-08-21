/**
 * BATTLEFRONT BORZ — THE OPEN-SECONDS SHARE. FLAGSHIP §7's third verb, priced.
 *
 *   node --import ./tools/register.mjs tools/_open.mjs [--seeds 3,5,7] [--arms blade,none]
 *
 * ── WHY THIS NUMBER AND NOT ANOTHER ─────────────────────────────────────
 *
 * `World._boltHitTest` multiplies incoming fire by `openness(e)` — measured at
 * 3.00x on a held body (`tools/checks/force.mjs`), which is the mechanism doing
 * exactly what §7 says it does. And a controlled five-seed pair over four arms
 * moved nothing at battle scale: no arm improved beyond noise.
 *
 * NEXT.md states the one measurement that separates the two readings, and it
 * had not been taken: **what share of enemy-seconds is spent in an open state?**
 * A 3x multiplier on 2% of the fight is worth 6% and §7 needs a different verb;
 * on 20% it is worth having and something else is eating it.
 *
 * So this probe counts SECONDS, not events. Every frame, every living hostile
 * body contributes `dt` to the denominator and, if `openState()` answers,
 * `dt` to that state's numerator. The states are read through Combat.js's own
 * `openState` rather than by testing `gripped`/`yankT`/`toppled` here, because
 * an instrument that restates a rule eventually disagrees with it (HANDOFF
 * §2.4) — and this one would disagree in the direction that flatters the verb.
 *
 * IT ALSO WEIGHS THE SECONDS BY THE FIRE THEY DREW. A body that is open while
 * nobody is shooting at it is worth nothing to the line whatever the share
 * says, so `openHits` / `hits` counts the bolts that actually LANDED on an
 * open body against every bolt that landed on anybody — the same quantity one
 * layer closer to the damage. `_boltHitTest` is wrapped, not restated.
 *
 * The arms are `_flagship.mjs`'s, driven by its own scripted Jedi, so this
 * number is taken on the same fight the Dead Jedi table was taken on.
 */

import './dom-shim.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { dutyInput } from './_flagship.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(ROOT, '.flagship');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

/** `_flagship.mjs`'s step, for the reason its own note gives. */
const STEP = 1 / 30;
const CAP = 220;

async function commandWorld(seed, opts = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    spawn: opts.player !== false,
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  return world;
}

async function runArm(arm, seed, engagements) {
  const { openState, OPEN_STATES } = await import('../src/game/Combat.js');
  const world = await commandWorld(seed, { player: arm !== 'none' });
  const input = arm === 'none' ? idleInput() : dutyInput(world);

  const tally = { enemySeconds: 0, open: {}, bodies: 0, hits: 0, openHits: 0, openHitStates: {} };
  for (const s of OPEN_STATES) { tally.open[s.key] = 0; tally.openHitStates[s.key] = 0; }

  /* EVERY BOLT THAT LANDED ON A BODY, ASKED WHAT STATE THAT BODY WAS IN — off
   * the shipped hit test rather than off a second copy of it. Variadic past
   * the arguments it reads, so a signature change downstream is not silently
   * dropped (HANDOFF §6.1a). */
  const hitTest = world._boltHitTest.bind(world);
  world._boltHitTest = (...a) => {
    const res = hitTest(...a);
    const victim = res && res.victim;
    if (victim && victim.capsules) {
      tally.hits++;
      const s = openState(victim);
      if (s) { tally.openHits++; tally.openHitStates[s.key]++; }
    }
    return res;
  };

  const start = world.director.wave;
  const n = Math.round(CAP * engagements / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    t += STEP;
    /* THE DENOMINATOR IS HOSTILE BODIES ONLY. In Command your own troopers
     * stand in `world.enemies` on your team, and they are open all battle —
     * §7's claim is about the guns of YOUR line pointed at THEIR bodies, so
     * counting your own would answer a different question with a bigger
     * number. With no player on the field there is no `p.team` to compare
     * against, so the commander's own side is the reference instead. */
    const mine = world.player ? world.player.team : (world.command?.commander?.team ?? 0);
    for (const e of world.enemies) {
      if (e.dead || e.team === mine) continue;
      tally.enemySeconds += STEP;
      const s = openState(e);
      if (s) tally.open[s.key] += STEP;
    }
    if (world.director.wave > start + engagements - 1 || world.command.done) break;
  }

  const openSeconds = Object.values(tally.open).reduce((a, b) => a + b, 0);
  const out = {
    arm, seed, gameSeconds: +t.toFixed(1),
    waveClears: world.director.wave - start,
    enemySeconds: +tally.enemySeconds.toFixed(1),
    openSeconds: +openSeconds.toFixed(2),
    openShare: tally.enemySeconds > 0 ? +(openSeconds / tally.enemySeconds).toFixed(5) : 0,
    byState: Object.fromEntries(Object.entries(tally.open).map(([k, v]) =>
      [k, tally.enemySeconds > 0 ? +(v / tally.enemySeconds).toFixed(5) : 0])),
    hits: tally.hits, openHits: tally.openHits,
    openHitShare: tally.hits > 0 ? +(tally.openHits / tally.hits).toFixed(5) : 0,
    /* WHAT THE VERB IS WORTH IF THE SHARE IS ALL THERE IS TO IT: the extra
     * damage the multiplier bought, as a share of what an un-opened field
     * would have taken. Derived from the hit shares this run measured, and
     * from `OPEN_STATES`' own multipliers, so no number here is typed twice. */
    worthOnHits: tally.hits > 0
      ? +(Object.entries(tally.openHitStates).reduce((sum, [k, c]) =>
          sum + c * ((OPEN_STATES.find((s) => s.key === k)?.mul ?? 1) - 1), 0) / tally.hits).toFixed(5)
      : 0,
  };
  world.unload?.();
  return out;
}

const seeds = String(flag('seeds', '3,5,7')).split(',').map(Number);
const arms = String(flag('arms', 'blade,none')).split(',');
const engagements = Number(flag('engagements', '3'));
const rows = [];
for (const seed of seeds) {
  for (const arm of arms) {
    const r = await runArm(arm, seed, engagements);
    rows.push(r);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, 'open-share.json'), JSON.stringify({ rows }, null, 2));
    console.log(`  seed ${String(seed).padStart(3)}  ${arm.padEnd(5)}  `
      + `enemy-s ${String(r.enemySeconds).padStart(7)}  open-s ${String(r.openSeconds).padStart(6)}  `
      + `share ${(r.openShare * 100).toFixed(2)}%  `
      + `hits ${String(r.hits).padStart(4)} of which open ${(r.openHitShare * 100).toFixed(2)}%  `
      + `worth +${(r.worthOnHits * 100).toFixed(2)}%  waves ${r.waveClears}`);
  }
}
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
console.log(`\n  MEAN open share ${(mean((r) => r.openShare) * 100).toFixed(2)}%  `
  + `· of bolts landing on an open body ${(mean((r) => r.openHitShare) * 100).toFixed(2)}%  `
  + `· extra damage the multiplier bought +${(mean((r) => r.worthOnHits) * 100).toFixed(2)}%`);
for (const k of Object.keys(rows[0]?.byState || {})) {
  console.log(`    ${k.padEnd(7)} ${(mean((r) => r.byState[k]) * 100).toFixed(3)}%`);
}
