/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ECONOMY, MEASURED — what a run pays against what the shelf costs
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   node --import ./tools/register.mjs tools/_econ.mjs
 *
 * (the `--import` is not optional: `tools/balance.mjs` imports `three`
 * statically and only `register.mjs` gets in front of that resolution.)
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * "The dearest thing costs N runs" was, until this file, answered by dividing
 * a price by `Credits.PER_RUN_CAP`. The cap is the MOST a run can pay and no
 * run has ever paid it, so that quotient understated every price on the shelf
 * by about six and a 3200-credit plate read as "3.6 runs" when it was really
 * twenty-three. `tools/checks/counter.mjs` shipped that arithmetic and was
 * green over the whole top of the shelf being unreachable.
 *
 * So the denominator is measured here, and every part of the measurement is
 * something the game already owns:
 *
 *   THE RUNS are `balance.mjs`'s `simulateRun` at `MODEL.skillLadder`'s three
 *     guard-error settings — this repository's one statement of what weak,
 *     average and strong play are. Seeded; the same on every box.
 *   THE PAY is the SHIPPED ENDING. `main.js`'s `record()` is lifted out of the
 *     source and compiled with the real `payForRun` behind it, so what settles
 *     a run here is the funnel every mode in the game goes through. If
 *     `record()` stops paying, this prints zeros.
 *   THE PRICES are `Counter.offerFrom` over the real `Vendors.COUNTERS` for
 *     four station weeks — the tier weighting, the standing markup and the
 *     black market's shut days all applied, which is the shelf as a player
 *     meets it rather than a flat read of the stock tables.
 *
 * The bounded version of this lives in `tools/checks/balance.mjs`; this is the
 * whole table, for a person.
 */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

const B = await import('./balance.mjs');
const C = await import('../src/game/Credits.js');
const K = await import('../src/game/Counter.js');
const V = await import('../src/game/Vendors.js');
const { LEVEL_ORDER } = await import('../src/game/Levels.js');
const { isRun } = await import('../src/game/Progress.js');

/* ── THE SHIPPED ENDING, LIFTED ─────────────────────────────────────────── */
const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const at = src.indexOf('\nfunction record(stats = null) {');
const end = src.indexOf('\n}\n', at);
if (!(at > 0 && end > at)) throw new Error('main.js no longer declares a delimitable record()');
const stub = { players: [], director: { wave: 0 }, manifest: null, runStats: () => ({}), notify() {} };
// eslint-disable-next-line no-new-func
const make = new Function('scope', 'recordRun', 'sessionOr', 'settings', 'foldCompanion', 'emptyLarder',
  'payForRun', 'clearTuning', 'holdLessons', 'awayFor', 'HOURS_PER_SECOND', 'settleRun', 'isRun',
  `const world = scope.world;\n${src.slice(at + 1, end + 2)}\nreturn record;`);
const record = make({ world: stub }, () => {}, () => 'roguelite', { order: 'jedi', species: 'human' },
  () => {}, () => {}, C.payForRun, () => {}, () => {}, () => {}, 1 / 120, () => [], isRun);
/** Pay one run's summary through the funnel and read the purse it left. */
const settle = (stats) => { C.clearCredits(); stub._recorded = false; record(stats); return C.purse(); };

/* ── THE LADDER ─────────────────────────────────────────────────────────── */
const SEEDS = Number(process.env.SEEDS || 24);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pad = (s, n) => String(s).padStart(n);
const rows = B.MODEL.skillLadder.map((skill) => {
  const paid = [], secs = [], waves = [], kills = [];
  for (let s = 0; s < SEEDS; s++) {
    const r = B.simulateRun({ difficulty: 'knight', level: LEVEL_ORDER[0], seed: 1000 + s, sigma: skill.sigma });
    const k = r.waveLog.reduce((a, w) => a + w.killed, 0);
    waves.push(r.died); kills.push(k);
    secs.push(r.waveLog.reduce((a, w) => a + w.t, 0));
    paid.push(settle({ wave: r.died, won: !!r.survived, kills: k, saves: 0 }));
  }
  return { name: skill.name, sigma: skill.sigma, pay: mean(paid), worst: Math.min(...paid),
    secs: mean(secs), wave: mean(waves), kills: mean(kills) };
});
C.clearCredits();

console.log(`\n══ WHAT A RUN PAYS — knight, ${SEEDS} seeds a tier, level "${LEVEL_ORDER[0]}" ══\n`);
console.log('  skill        σ    wave   kills   seconds   credits   cr/min   worst');
for (const r of rows) {
  console.log(`  ${r.name.padEnd(11)} ${pad(r.sigma, 4)} ${pad(r.wave.toFixed(1), 6)} ${pad(r.kills.toFixed(1), 7)} `
    + `${pad(r.secs.toFixed(0), 9)} ${pad(r.pay.toFixed(0), 9)} ${pad((r.pay / (r.secs / 60)).toFixed(0), 8)} ${pad(r.worst, 7)}`);
}
const weak = rows[0], avg = rows[Math.floor(rows.length / 2)], strong = rows[rows.length - 1];
console.log(`\n  strong / weak = ${(strong.pay / weak.pay).toFixed(2)}x   (the floor is 3)`);
console.log(`  EARN ${JSON.stringify(C.EARN)}  ramp ${C.DEPTH_RAMP}  cap ${C.PER_RUN_CAP}`);
console.log('\n  wave reached →  ' + [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16].map((w) => `${w}:${Math.round(C.depthPay(w))}`).join('  '));

/* ── THE SHELF ──────────────────────────────────────────────────────────── */
const seen = [];
for (const counter of V.COUNTERS) {
  for (let day = 0; day < 28; day++) {
    const offer = K.offerFrom(counter, { day, order: null, standing: 0 });
    if (!offer.open) continue;
    for (const row of offer.rows) seen.push({ ...row, counter: counter.id });
  }
}
const prices = seen.map((r) => r.price).sort((a, b) => a - b);
const q = (p) => prices[Math.floor(p * (prices.length - 1))];
console.log(`\n══ THE SHELF — ${prices.length} rows put out over 28 days at ${V.COUNTERS.length} counters ══\n`);
console.log(`  min ${prices[0]}   p25 ${q(0.25)}   MEDIAN ${q(0.5)}   p75 ${q(0.75)}   p90 ${q(0.9)}   max ${prices[prices.length - 1]}`);

console.log('\n  by counter:');
for (const counter of V.COUNTERS) {
  const p = counter.stock.map((r) => K.priceOf(r)).sort((a, b) => a - b);
  console.log(`    ${counter.id.padEnd(12)} ${pad(p.length, 3)} rows   ${pad(p[0], 5)} – ${pad(p[p.length - 1], 5)}   median ${pad(p[Math.floor(p.length / 2)], 5)}`);
}
console.log('\n  by kind and tier:');
for (const kind of ['provision', 'keepsake']) {
  for (const tier of Object.keys(K.TIERS)) {
    const p = V.everyRow().filter((r) => r.kind === kind && r.tier === tier).map((r) => K.priceOf(r)).sort((a, b) => a - b);
    if (!p.length) continue;
    console.log(`    ${kind.padEnd(10)} ${tier.padEnd(9)} ${pad(p.length, 3)} rows   ${pad(p[0], 5)} – ${pad(p[p.length - 1], 5)}   median ${pad(p[Math.floor(p.length / 2)], 5)}`);
  }
}

/* ── RUNS TO AFFORD ─────────────────────────────────────────────────────── */
const dearest = Math.max(...V.everyRow().map((r) => K.priceOf(r)));
const marks = [
  ['cheapest shelf row', prices[0]],
  ['p25', q(0.25)],
  ['MEDIAN shelf row', q(0.5)],
  ['p75', q(0.75)],
  ['p90', q(0.9)],
  ['dearest row', dearest],
];
console.log('\n══ RUNS TO AFFORD ══\n');
console.log('  ' + 'item'.padEnd(20) + 'price' + rows.map((r) => pad(r.name, 12)).join(''));
for (const [name, price] of marks) {
  console.log('  ' + name.padEnd(20) + pad(price, 5) + rows.map((r) => pad((price / r.pay).toFixed(1), 12)).join(''));
}
console.log(`\n  the average column is "${avg.name}"; the bands the suite holds are`);
console.log('  median 0.1–1.5 runs, dearest 3–7 runs, strong/weak ≥ 3.\n');
