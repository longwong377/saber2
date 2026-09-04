/**
 * THE SPECTACLE LAB — the bench the engine's three temperatures were fitted on.
 *
 *   node --import ./tools/register.mjs tools/_spectacle-lab.mjs [races] [skin]
 *
 * Two questions, neither of which can be answered by reading source:
 *
 *   1. IS EACH READER'S MODEL A MODEL OF THIS SIM? `winProbabilities` is a
 *      softmax and the sim is a tick loop, so every temperature is a FIT and
 *      not a derivation — and there are three of them, because the board, the
 *      researcher and the insider know three different amounts and a reader who
 *      knows less should be FLATTER. This grid-searches all three against
 *      thousands of real races on the same circuit the bettors ride, and it is
 *      where `SKINS[*].temp`, `.boardTemp` and `.researchTemp` came from.
 *
 *   2. DOES A GOOD BETTOR WIN? Three bettors over one long circuit — the
 *      favourite-backer who reads the board, the researcher who reads the
 *      public log, and the insider who is simply told the hidden terms. The
 *      middle one is the interesting number: it is handed nothing the player
 *      could not read in the room.
 *
 * `_`-prefixed, so `verify.mjs` and `determinism.mjs` both leave it alone by
 * the convention they already use for shared helpers.
 */

import { makeRng } from '../src/engine/MathUtil.js';
import {
  SKINS, GROUNDS, makeCard, dressGround, priceCard, runSpectacle, recordResult,
  formStrength, readForm, winProbabilities, researchedProbabilities, favouriteOf, settle, seedSpectacle,
  fieldProbabilities,
} from '../src/game/Spectacle.js';

const RACES = Number(process.argv[2]) || 4000;
const SKIN = process.argv[3] || 'PODRACE';
const pct = (n) => `${(n * 100).toFixed(2)}%`;

seedSpectacle(20260904);

/** Grid-search the σ that best predicts the winners we actually saw. */
function fit(rows, key) {
  let best = null;
  for (let sd = 0.20; sd <= 1.60; sd += 0.02) {
    let ll = 0, n = 0;
    for (const row of rows) {
      if (row.won < 0) continue;
      ll -= Math.log(Math.max(fieldProbabilities(row[key], sd)[row.won], 1e-9));
      n++;
    }
    ll /= (n || 1);
    if (!best || ll < best.ll) best = { sd: Math.round(sd * 100) / 100, ll };
  }
  return best;
}

/** Flat 1 unit, bet only where the model says the price is wrong enough. */
function value(probs, board, { margin = 0.08, floor = 0.05 } = {}) {
  const price = new Map(board.map((b) => [b.id, b.price]));
  let best = null;
  for (const { id, p } of probs) {
    if (p < floor) continue;
    const ev = p * price.get(id);
    if (ev < 1 + margin) continue;
    if (!best || ev > best.ev) best = { id, ev, p };
  }
  return best;
}

/**
 * ONE CIRCUIT: six stables meeting each other over and over, so a history is
 * worth having and a researcher has something to read. Every race is priced,
 * bet, run and then written into the public log — in that order, because that
 * is the order the player lives it in.
 */
function circuit(skin, races) {
  const rng = makeRng(Number(process.argv[4]) || 90210);
  const pool = GROUNDS.filter((g) => g.skin === skin);
  const stables = [];
  for (let i = 0; i < 6; i++) stables.push(makeCard({ skin, size: SKINS[skin].field, seed: rng.int(1, 1e9) }));

  const books = {
    'favourite-backer': { staked: 0, net: 0, bets: 0, hits: 0 },
    'form-reader': { staked: 0, net: 0, bets: 0, hits: 0 },
    insider: { staked: 0, net: 0, bets: 0, hits: 0 },
  };
  const rows = [];
  const warm = Math.floor(races * 0.15);
  let favWins = 0, run = 0;

  for (let i = 0; i < races; i++) {
    const card = stables[i % stables.length];
    const ground = dressGround(rng.pick(pool), rng.int(1, 1e9));
    const board = priceCard(card, ground);

    const picks = [];
    const fav = favouriteOf(board);
    picks.push(['favourite-backer', fav.id]);
    const f = value(researchedProbabilities(card, ground), board);
    if (f) picks.push(['form-reader', f.id]);
    const ins = value(winProbabilities(card, ground, { hidden: true }), board);
    if (ins) picks.push(['insider', ins.id]);

    const pub = card.entrants.map((e) => formStrength(e, ground, { hidden: false }).total);
    const hid = card.entrants.map((e) => formStrength(e, ground, { hidden: true }).total);
    const raw = card.entrants.map((e) => readForm(e, ground).bonus);
    const res = card.entrants.map((e, k) => pub[k] + raw[k]);

    const result = runSpectacle({ card, ground, seed: rng.int(1, 1e9) });

    if (i >= warm) {
      run++;
      rows.push({ pub, hid, res, raw, won: card.entrants.findIndex((e) => e.id === result.winner) });
      if (result.winner === fav.id) favWins++;
      for (const [who, id] of picks) {
        const led = settle([{ entrant: id, stake: 1 }], result, board);
        books[who].staked += led.staked;
        books[who].net += led.net;
        books[who].bets++;
        if (led.net > 0) books[who].hits++;
      }
    }
    recordResult(card, ground, result);
  }
  return { books, rows, favStrike: run ? favWins / run : 0, run };
}

/* ── the bench ──────────────────────────────────────────────────────────── */

console.log(`\nSPECTACLE LAB — ${SKIN}, ${RACES} races\n`);

const { books, rows, favStrike, run } = circuit(SKIN, RACES);
const S = SKINS[SKIN];
for (const [key, name, shipped] of [
  ['hid', 'sim view     ', S.sigma.sim],
  ['pub', 'board        ', S.sigma.board],
  ['res', 'reading room ', S.sigma.read]]) {
  const b = fit(rows, key);
  console.log(`  ${name}   best sigma ${String(b.sd).padEnd(5)} (log-loss ${b.ll.toFixed(4)})   shipped ${shipped}`);
}
{
  /* WHAT THE BOARD IS ACTUALLY BLIND TO, measured: the spread of the terms it
   * may not see. `blind` in the skin table is this number and nothing else. */
  let n = 0, s1 = 0, s2 = 0;
  for (const r of rows) for (let i = 0; i < r.pub.length; i++) { const d = r.hid[i] - r.pub[i]; n++; s1 += d; s2 += d * d; }
  console.log(`  hidden spread        sd ${Math.sqrt(s2 / n - (s1 / n) ** 2).toFixed(3)} of strength the board cannot see`);
}
{
  /* HOW MUCH OF THE HIDDEN TERM DID THE READING ROOM ACTUALLY RECOVER?
   * Correlation of the read against the truth, and the scale the read would
   * need to be right. A near-zero slope means the form book is decoration. */
  let sxy = 0, sxx = 0, syy = 0, n = 0;
  for (const r of rows) for (let i = 0; i < r.raw.length; i++) {
    const x = r.raw[i], y = r.hid[i] - r.pub[i];
    sxy += x * y; sxx += x * x; syy += y * y; n++;
  }
  const corr = sxy / Math.sqrt((sxx * syy) || 1);
  console.log(`\n  form read vs truth   r ${corr.toFixed(3)}, slope ${(sxy / (sxx || 1)).toFixed(3)} over ${n} readings`);
  let best = null;
  for (let a = 0; a <= 3.01; a += 0.1) for (let sd = 0.30; sd <= 1.2; sd += 0.02) {
    let ll = 0, m = 0;
    for (const r of rows) {
      if (r.won < 0) continue;
      const s2 = r.pub.map((v, i) => v + a * r.raw[i]);
      ll -= Math.log(Math.max(fieldProbabilities(s2, sd)[r.won], 1e-9)); m++;
    }
    ll /= (m || 1);
    if (!best || ll < best.ll) best = { a: Math.round(a * 10) / 10, T: Math.round(sd * 100) / 100, ll };
  }
  console.log(`  best research model  scale ${best.a}, sigma ${best.T} (log-loss ${best.ll.toFixed(4)})`);
}
console.log(`\n  favourite strike     ${pct(favStrike)} over ${run} settled races\n`);
for (const [name, b] of Object.entries(books)) {
  const roi = b.staked ? b.net / b.staked : 0;
  console.log(`  ${name.padEnd(18)} ${String(b.bets).padStart(5)} bets  strike ${pct(b.bets ? b.hits / b.bets : 0).padStart(7)}  net ${b.net.toFixed(1).padStart(9)}  ROI ${pct(roi).padStart(8)}`);
}
console.log('');
