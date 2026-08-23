/**
 * M5 — DOES `lineIsUp` CHANGE HOW THE MODE IS PLAYED?
 *
 *   node --import ./tools/register.mjs tools/_m5.mjs [--seeds 6] [--minutes 6]
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE GATE PLAN.md PUT ON THE WHOLE OF §4, AND WHY IT IS NOT OBVIOUS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `NEXT.md` proves the rule EXISTS: `MODES.theline.lineAdvances` is true,
 * `CommandDirector.lineIsUp` is a quorum of half the living inside
 * `MORALE.NEAR`, `_areaClear` will not credit ground without it, and
 * `theline.mjs` drives both directions of that. The paragraph immediately after
 * that proof is the one this file is about:
 *
 *     "Not proven: that it changes how the mode is PLAYED."
 *
 * A rule that refuses a thing nobody was going to do is a rule with a check and
 * no consequence. FLAGSHIP §6 states the intended consequence in one sentence —
 * *"You can sprint 200 m into their rear; the line does not come with you.
 * Killing stays fast and fun and advances nothing."* — and the whole of §4
 * (delegation, objectives, downed-not-dead, the company, the checkable order)
 * is built on top of it being true.
 *
 * ── WHY ONE ARM CANNOT ANSWER IT ──────────────────────────────────────────
 *
 * The repository's scripted Jedi HOLDS STATION on its own line, which is what
 * makes it a usable control everywhere else and useless here: a player who
 * never leaves never meets the rule. Run that script against the rule on and
 * off and both arms report the same run, and the honest reading of that is not
 * "the rule does nothing" — it is "this script cannot see it".
 *
 * So there are FOUR arms, two scripts by two rule states:
 *
 *     near × on      the shipped game for a player who fights with their men
 *     near × off     the same player in a game where the kill count takes ground
 *     far  × on      FLAGSHIP §6's sentence, exactly: a Jedi 100 m from the line
 *     far  × off     the same sprint in a game that rewards it
 *
 * `standOff` is `_flagship.mjs`'s own fourth arm and is imported rather than
 * rewritten — a Jedi alive, armed, fighting whatever reaches him, and a hundred
 * metres away. The rule is proven to change PLAY if and only if the far pair
 * differ and the near pair do not by much: the first says leaving costs you
 * something, the second says fighting with your men costs you nothing, and it
 * takes both to make the rule a decision rather than a tax.
 *
 * ── WHAT IS MEASURED ──────────────────────────────────────────────────────
 *
 * `areasTaken` per game-minute is the headline, because taking ground is what
 * the rule gates. Beside it: the kills, so a run that killed just as much and
 * advanced less is visible as exactly that; the roster, because the cost of
 * standing with your men is that they are standing next to you; and
 * `awaitingLine`, the seconds the run spent refusing to credit ground, which is
 * the rule's own footprint and is zero in every `off` arm by construction.
 *
 * ── AND IT HAS NO OPINION ─────────────────────────────────────────────────
 *
 * No bars. It prints the four cells and their spreads and stops. Whether a 30%
 * gap is "changes how the mode is played" is a judgement, and the point of
 * running this is to make that judgement against numbers instead of against a
 * reading of the source.
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { loadavg } from 'node:os';

if ((await import('three')) !== THREE) {
  console.error('\n  _m5.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/_m5.mjs\n');
  process.exit(2);
}

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const SEEDS = arg('seeds', 6);
const MINUTES = arg('minutes', 6);
const STEP = 1 / 30;
/** `_flagship.mjs`'s own number, imported in spirit and stated here once. */
const STAND_OFF = 100;

const { bootWorld } = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');

/**
 * One arm.
 *
 * `lineAdvances` is written on the DIRECTOR after it is built rather than
 * through a settings key, and that is deliberate: the field's one writer is
 * `this.lineAdvances = !!MODES[this.mode]?.lineAdvances`, so a settings door
 * for it would be a second way to say the same thing — and `theline.mjs`
 * asserts Command does NOT have the rule, which a settings key could break.
 * What is under test is the rule, and this is the field the rule is.
 */
async function arm({ seed, station, rule }) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi', seed,
      difficulty: 'knight', instantSpawn: true, quality: 'low' },
    runSeed: seed,
  });
  world.beginCampaign?.();
  if (!world.director.active) world.director.start(1);
  const d = world.command;
  d.lineAdvances = rule;

  const input = dutyInput(world, station === 'far' ? { standOff: STAND_OFF } : {});
  /* THE RULE'S OWN FOOTPRINT, counted in frames and reported in seconds:
   * `awaitingLine` is set by `_awaitLine` and is the state "the ground is won
   * and the line is not on it yet". It is zero in every `off` arm by
   * construction, which is the control. */
  let waiting = 0;
  const frames = Math.round(MINUTES * 60 / STEP);
  for (let i = 0; i < frames; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    if (d.awaitingLine) waiting++;
    if (world.over) break;
  }
  const r = d.roster;
  return {
    seed, station, rule,
    played: +world.time.toFixed(1),
    areas: d.areasTaken | 0,
    wave: world.director.wave | 0,
    kills: world.players.reduce((a, p) => a + (p.kills || 0), 0),
    living: r ? r.living.length : 0,
    fallen: r ? r.fallen.length : 0,
    waiting: +(waiting * STEP).toFixed(1),
    over: !!world.over,
  };
}

/* ── the drive ─────────────────────────────────────────────────────────── */

const CELLS = [
  { station: 'near', rule: true }, { station: 'near', rule: false },
  { station: 'far', rule: true }, { station: 'far', rule: false },
];
const rows = [];
const t0 = process.cpuUsage();
for (let s = 0; s < SEEDS; s++) {
  for (const c of CELLS) {
    rows.push(await arm({ seed: 400 + s, ...c }));
    process.stderr.write('.');
  }
}
const cpu = process.cpuUsage(t0);
process.stderr.write('\n');

/* ── the report ────────────────────────────────────────────────────────── */

const cell = (station, rule) => rows.filter((r) => r.station === station && r.rule === rule);
const mean = (a, k) => (a.length ? a.reduce((x, r) => x + r[k], 0) / a.length : 0);
const spread = (a, k) => (a.length ? `${Math.min(...a.map((r) => r[k]))}–${Math.max(...a.map((r) => r[k]))}` : '–');

console.log(`\n  M5 — does lineIsUp change how the mode is played?`);
console.log(`  ${SEEDS} seeds × ${MINUTES} min × 4 cells · ${((cpu.user + cpu.system) / 1e6).toFixed(0)} s CPU `
  + `at load ${loadavg()[0].toFixed(2)}\n`);
console.log('  station  rule   areas/min    kills   living  fallen  waiting(s)   areas (spread)');
const table = {};
for (const station of ['near', 'far']) {
  for (const rule of [true, false]) {
    const a = cell(station, rule);
    const perMin = mean(a, 'areas') / (mean(a, 'played') / 60 || 1);
    table[`${station}/${rule}`] = perMin;
    console.log(`  ${station.padEnd(8)} ${String(rule).padEnd(6)} ${perMin.toFixed(3).padStart(9)} `
      + `${mean(a, 'kills').toFixed(1).padStart(8)} ${mean(a, 'living').toFixed(1).padStart(8)} `
      + `${mean(a, 'fallen').toFixed(1).padStart(7)} ${mean(a, 'waiting').toFixed(1).padStart(11)}   `
      + `${spread(a, 'areas')}`);
  }
}

/**
 * THE TWO GAPS, AND BOTH OF THEM ARE THE ANSWER.
 *
 * The FAR gap is FLAGSHIP §6's sentence as a number: how much less ground a
 * player who sprints away takes under the rule than without it. The NEAR gap is
 * the control that keeps it from being a tax — if fighting alongside your own
 * men also costs you ground, the rule is not a decision, it is a slowdown.
 */
const gap = (on, off) => (off > 1e-9 ? (1 - on / off) : 0);
const farGap = gap(table['far/true'], table['far/false']);
const nearGap = gap(table['near/true'], table['near/false']);
console.log(`\n  the rule costs a player who LEAVES  ${(farGap * 100).toFixed(1)}% of their ground`);
console.log(`  …and a player who STAYS             ${(nearGap * 100).toFixed(1)}%`);
console.log(`  seconds the run spent waiting for the line: `
  + `near ${mean(cell('near', true), 'waiting').toFixed(1)}, far ${mean(cell('far', true), 'waiting').toFixed(1)} `
  + `(0.0 in both off arms by construction — the control)`);
console.log('\n  No bar is applied. Whether that is "it changes how the mode is played" is');
console.log('  a judgement, and the point of the numbers is to make it against them.\n');
