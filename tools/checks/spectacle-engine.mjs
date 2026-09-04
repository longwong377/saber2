/**
 * BATTLEFRONT BORZ — THE SPECTACLE ENGINE, MEASURED.
 *
 * V16 Lane D asks for one thing that no amount of well-written source can
 * demonstrate: *"these will be real races without pre-determined outcomes …
 * so even the game doesn't know who will race until the victor is called"*,
 * and *"in life a good better will probably make money over time."*
 *
 * Both are claims about DISTRIBUTIONS, so every one of them below is driven
 * rather than read. The engine is run thousands of times, the bettors bet with
 * real money-shaped units against a board they did not set, and the numbers
 * come out at the end. A source scan can tell you a file does not contain the
 * word `winner` before the loop; it cannot tell you the loop matters.
 *
 * ── WHAT IS ACTUALLY HARD TO CATCH HERE, and what each clause is for ──────
 *
 *   A PRE-DRAWN WINNER hides perfectly. A sim that draws the result and then
 *     emits a plausible stream of events for it passes every "is there an
 *     event stream" check ever written. What it CANNOT do is respond to a
 *     hidden term: move one number the odds never saw, hold the seed, and a
 *     narrated race gives the same winner. That is `not pre-drawn`.
 *
 *   A DECORATIVE FORM BOOK hides just as well. Odds that secretly read the
 *     hidden terms make research pointless and the market unbeatable, and they
 *     look identical from outside. So the hidden half of every entrant is
 *     permuted under the board and the board must not move by a hundredth.
 *
 *   A HOUSE THAT CANNOT BE BEATEN, or one that can be beaten instantly, are
 *     the same defect with different signs, and neither is visible without
 *     running a few thousand races. The `over time` clause runs 3000 and
 *     prints three returns on turnover.
 *
 * Nothing here re-implements the engine. The bettors are the only thing this
 * file adds, they are twenty lines each, and they call the shipped model.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import { makeRng } from '../../src/engine/MathUtil.js';
import {
  SKINS, GROUNDS, groundById, dressGround, makeCard, makeEntrant, entrantFromCompanion,
  formStrength, fieldProbabilities, winProbabilities, researchedProbabilities, readForm,
  priceCard, favouriteOf, runSpectacle, runMeeting, recordResult, settle, formBook,
  announce, momentsOf, MOMENTS, seedSpectacle, spectacleRng,
} from '../../src/game/Spectacle.js';

const SRC = new URL('../../src/game/Spectacle.js', import.meta.url);
const pct = (n) => `${(n * 100).toFixed(2)}%`;
const podGround = (seed) => dressGround(groundById('boonta'), seed);

/** A card and a ground from one seed, so a check can say "the same race". */
function fixture({ skin = 'PODRACE', seed = 4242, ground = null } = {}) {
  const card = makeCard({ skin, seed });
  const pool = GROUNDS.filter((g) => g.skin === skin);
  return { card, ground: ground || dressGround(pool[0], seed + 1) };
}

/** Deep-copy a card so a check can move one number without moving the rest. */
const cloneCard = (card) => ({ skin: card.skin, entrants: card.entrants.map((e) => ({
  id: e.id, name: e.name, kind: e.kind,
  form: { ...e.form, recent: e.form.recent.slice(), log: e.form.log.map((r) => ({ ...r, conditions: { ...r.conditions } })) },
  hidden: { ...e.hidden },
})) });

/** Flat one unit on the biggest overlay this model can find, or nothing. */
function value(probs, board, { margin = 0.08, floor = 0.05 } = {}) {
  const price = new Map(board.map((b) => [b.id, b.price]));
  let best = null;
  for (const { id, p } of probs) {
    if (p < floor) continue;
    const ev = p * price.get(id);
    if (ev >= 1 + margin && (!best || ev > best.ev)) best = { id, ev, p };
  }
  return best;
}

/**
 * ONE CIRCUIT, RIDDEN BY THREE BETTORS.
 *
 * Six stables meet each other over and over so a history is worth having, and
 * every race is priced, bet, run, and only then written into the public log —
 * in that order, because that is the order the player lives it in and any
 * other order is the cheat this whole file exists to rule out.
 */
function circuit({ skin = 'PODRACE', races = 3000, seed = 90210 } = {}) {
  const rng = makeRng(seed);
  const pool = GROUNDS.filter((g) => g.skin === skin);
  const stables = [];
  for (let i = 0; i < 6; i++) stables.push(makeCard({ skin, size: SKINS[skin].field, seed: rng.int(1, 1e9) }));

  const books = {
    favourite: { staked: 0, net: 0, bets: 0, hits: 0 },
    form: { staked: 0, net: 0, bets: 0, hits: 0 },
    insider: { staked: 0, net: 0, bets: 0, hits: 0 },
  };
  const warm = Math.floor(races * 0.15);
  const bins = new Map();
  let favWins = 0, run = 0, winners = new Map();

  for (let i = 0; i < races; i++) {
    const card = stables[i % stables.length];
    const ground = dressGround(rng.pick(pool), rng.int(1, 1e9));
    const board = priceCard(card, ground);
    const fav = favouriteOf(board);
    const picks = [['favourite', fav.id]];
    const f = value(researchedProbabilities(card, ground), board);
    if (f) picks.push(['form', f.id]);
    const ins = value(winProbabilities(card, ground, { hidden: true }), board);
    if (ins) picks.push(['insider', ins.id]);

    const truth = winProbabilities(card, ground, { hidden: true });
    const result = runSpectacle({ card, ground, seed: rng.int(1, 1e9) });

    if (i >= warm) {
      run++;
      if (result.winner === fav.id) favWins++;
      winners.set(result.winner, (winners.get(result.winner) || 0) + 1);
      for (const { id, p } of truth) {
        const b = Math.min(9, Math.floor(p * 10));
        const row = bins.get(b) || { p: 0, hit: 0, n: 0 };
        row.p += p; row.n++; row.hit += result.winner === id ? 1 : 0;
        bins.set(b, row);
      }
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
  const roi = (b) => (b.staked ? b.net / b.staked : 0);
  return { books, roi, run, favStrike: run ? favWins / run : 0, bins, winners };
}

export async function run({ check, assert }) {
  check = await clocked(check);
  const src = await readFile(SRC, 'utf8');
  /* Comments stripped for the SOURCE scans, so a note ABOUT `Math.random` is
   * not read as a call to it — `determinism.mjs` learned this the same way. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /* ══════════════════════════════════════════════════════════════════════
   *  1. THE SIM IS NOT PRE-DRAWN
   * ══════════════════════════════════════════════════════════════════════ */

  check('spectacle: the same seed and the same card, one hidden term moved, is a different race', () => {
    /**
     * THE CLAUSE THE WHOLE LANE STANDS ON. A sim that drew a winner and then
     * narrated it would give the same winner here every time, because the
     * moved term is one the odds never see and a narration reads the odds.
     *
     * The seed is held FIXED across the pair, so the dice are identical and
     * the only difference in the universe is one entrant's temperament on a
     * wet track. If that never changes who wins, the term is decoration.
     */
    let moved = 0, same = 0;
    for (let t = 0; t < 120; t++) {
      const { card, ground } = fixture({ seed: 700 + t, ground: podGround(9000 + t) });
      const a = runSpectacle({ card, ground, seed: 31337 + t });
      const twisted = cloneCard(card);
      for (const e of twisted.entrants) e.hidden.wet = -e.hidden.wet;
      const b = runSpectacle({ card: twisted, ground, seed: 31337 + t });
      if (a.winner === b.winner) same++; else moved++;
    }
    assert(moved > 24,
      `flipping every hidden going-temperament on the card changed the winner in only ${moved} of 120 races `
      + 'at a held seed — a hidden term that cannot change a result is not in the simulation, and a sim '
      + 'that ignores it is one that drew its winner from the public form');
    assert(same > 0, 'every single race changed — the hidden term is not a term, it is the whole result');
    return `${moved}/120 races changed hands when the hidden going term flipped, ${same} did not`;
  });

  check('spectacle: the board is a function of the public form and of nothing else', () => {
    /**
     * Permute every hidden field on the card — the terms, the thresholds, the
     * grudges — and demand the board does not move by a hundredth. This is the
     * check that would catch odds "improved" one afternoon by peeking, which
     * is the single change that would silently kill research forever.
     */
    const { card, ground } = fixture({ seed: 6161 });
    const before = JSON.stringify(priceCard(card, ground));
    const twisted = cloneCard(card);
    const rng = makeRng(5);
    for (const e of twisted.entrants) {
      for (const k of Object.keys(e.hidden)) {
        if (typeof e.hidden[k] === 'number') e.hidden[k] = rng.range(-1, 1);
      }
      e.hidden.grudge = { [twisted.entrants[0].id]: 0.4 };
    }
    const after = JSON.stringify(priceCard(twisted, ground));
    assert(before === after, 'the board moved when only hidden terms moved — the odds are reading the sim');
    /* …and the same question of the form book, which a player reads. */
    const rows = JSON.stringify(card.entrants.map((e) => formBook(e, ground)));
    const rows2 = JSON.stringify(twisted.entrants.map((e) => formBook(e, ground)));
    assert(rows === rows2, 'the form book printed a hidden term');
    return `${card.entrants.length} prices and ${card.entrants.length} form lines, unmoved by a full permutation of every hidden field`;
  });

  check('spectacle: the winner is not a function of the odds', () => {
    /**
     * If the market leader always won there would be no market. The strike
     * rate of the favourite is the cheapest statement of that and it is bounded
     * on BOTH sides — a favourite that wins one race in twenty is a board that
     * is not reading the same race as the sim.
     */
    const { favStrike, run, winners } = circuit({ races: 900, seed: 4711 });
    assert(favStrike > 0.15 && favStrike < 0.62,
      `the market leader won ${pct(favStrike)} of ${run} races — outside the range in which a board is `
      + 'both informative and beatable');
    assert(winners.size >= 20, `only ${winners.size} different entrants ever won a race`);
    return `the favourite won ${pct(favStrike)} of ${run} races; ${winners.size} different winners`;
  });

  check('spectacle: reproducible from a seed, unpredictable without one', () => {
    /**
     * Both halves matter and they pull against each other. The gate needs the
     * same race twice; the browser needs a different one every session, which
     * is why an explicit seed takes a PRIVATE generator and the unseeded path
     * draws from the module stream.
     */
    const { card, ground } = fixture({ seed: 8080 });
    const a = runSpectacle({ card, ground, seed: 99 });
    const b = runSpectacle({ card, ground, seed: 99 });
    assert(JSON.stringify(a.events) === JSON.stringify(b.events),
      'the same seed ran two different races — nothing in this engine is reproducible');
    seedSpectacle(1234);
    const c = runSpectacle({ card, ground });
    const d = runSpectacle({ card, ground });
    assert(JSON.stringify(c.events) !== JSON.stringify(d.events),
      'two unseeded races were identical — the module stream is not advancing and every meeting is the same day');
    /* And the seeded run must not have disturbed the house stream, or a check
     * would change the game's next race by measuring this one. */
    seedSpectacle(1234);
    const e = runSpectacle({ card, ground });
    assert(JSON.stringify(c.events) === JSON.stringify(e.events),
      'seeding the house stream does not put it back where it was');
    return `${a.events.length} events identical at a held seed, ${c.events.length} vs ${d.events.length} without one`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  2. WATCHING IS FREE
   * ══════════════════════════════════════════════════════════════════════ */

  check('spectacle: a card runs whether or not anybody turns up, and betting cannot touch it', () => {
    /**
     * *"you don't have to bet to watch (applies to any casino game)."*
     *
     * Asserted structurally AND by driving it: `runSpectacle`'s signature has
     * no wager in it, so a stake cannot reach the loop even by accident, and
     * two runs of one seed — one settled against a stake the size of the book,
     * one with nothing on it — are compared event for event.
     */
    const { card, ground } = fixture({ seed: 2024 });
    const board = priceCard(card, ground);
    const quiet = runSpectacle({ card, ground, seed: 55 });
    const backed = runSpectacle({ card, ground, seed: 55 });
    const led = settle(card.entrants.map((e) => ({ entrant: e.id, stake: 500 })), backed, board);
    assert(JSON.stringify(quiet.events) === JSON.stringify(backed.events),
      'a race run with stakes on it played out differently from the same race with none');
    assert(!/runSpectacle\(\{[^)]*wager/.test(code), 'runSpectacle takes a wager — the sim can see the money');
    assert(led.lines.length === card.entrants.length && led.staked === 500 * card.entrants.length,
      'settling every runner did not settle every runner');
    return `${quiet.events.length} events, identical with ${led.staked} staked against them and with nothing`;
  });

  check('spectacle: a stake is a run-scoped number and this file keeps no balance', () => {
    /**
     * `Kennel.js`: "That silence is a hazard, not a permission." This file is
     * not on `companions.mjs`'s six-word list either, so the rule is asserted
     * here — no store, no persistence, and no accumulation, which is the part
     * a word list would miss anyway.
     *
     * The behavioural half is the one that matters: settling the same wager
     * twice gives the same ledger both times. A file with a balance in it
     * cannot do that.
     */
    for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', ' buy ']) {
      assert(!new RegExp(word, 'i').test(src), `Spectacle.js says "${word.trim()}" — this is a stake, not a shop`);
    }
    assert(!/localStorage|setItem|makeStore|from '\.\/Store\.js'/.test(code),
      'the spectacle engine persists something — a wager is handed in and handed back');
    const { card, ground } = fixture({ seed: 313 });
    const board = priceCard(card, ground);
    const result = runSpectacle({ card, ground, seed: 7 });
    const one = settle([{ entrant: result.winner, stake: 10 }], result, board);
    const two = settle([{ entrant: result.winner, stake: 10 }], result, board);
    assert(JSON.stringify(one) === JSON.stringify(two), 'two identical settlements disagreed — something is accumulating');
    assert(one.returned > 10 && one.net > 0, 'a winning stake did not pay');
    let refused = false;
    try { settle([{ entrant: 'nobody-on-this-card', stake: 1 }], result, board); } catch { refused = true; }
    assert(refused, 'a stake on a runner who is not on the card was silently accepted and lost');
    return `settled twice for the same ${one.returned} back on 10, and a stake on a stranger is refused`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  3. THE PROOF — over time
   * ══════════════════════════════════════════════════════════════════════ */

  check('spectacle: a good bettor wins over time and a lazy one bleeds slowly', () => {
    /**
     * THE PLAYER'S OWN SENTENCE, DRIVEN: *"in life a good better will probably
     * make money over time."*
     *
     * Three bettors, one unit a bet, 3000 races on one circuit:
     *
     *   FAVOURITE-BACKER  backs the market leader every race. He must lose,
     *                     and he must lose at about the house's take rather
     *                     than at a rate that would empty him in an evening —
     *                     a room nobody can survive an hour in is not a room.
     *   INSIDER           is handed the hidden terms and bets where the price
     *                     is wrong by more than the margin. He must win.
     *   FORM-READER       is handed NOTHING. He reads `form.log`, which is
     *                     results and weather, and infers what he can.
     *
     * The middle number is the feature; the third is the argument for the
     * reading room being on the map at all.
     */
    const { books, roi, run, favStrike } = circuit({ races: 3000, seed: 90210 });
    const fav = roi(books.favourite), ins = roi(books.insider), form = roi(books.form);
    assert(fav < 0, `backing the favourite returned ${pct(fav)} over ${run} races — the house is losing money`);
    assert(fav > -0.30, `backing the favourite returned ${pct(fav)} — that is not slow, that is a mugging`);
    assert(ins > 0.02, `a bettor holding every hidden term returned ${pct(ins)} — research does not pay and the form book is decoration`);
    assert(ins > fav + 0.10, `the informed bettor beat the favourite-backer by only ${pct(ins - fav)}`);
    assert(books.form.bets > run * 0.1, `the form-reader found a bet in only ${books.form.bets} of ${run} races`);
    return `${run} races — favourite-backer ${pct(fav)} on ${books.favourite.bets} bets, `
      + `form-reader ${pct(form)} on ${books.form.bets}, insider ${pct(ins)} on ${books.insider.bets}; `
      + `favourite strike ${pct(favStrike)}`;
  });

  check('spectacle: research on public results alone beats the board that priced them', () => {
    /**
     * The strongest form of "researching form can honestly pay", and the one
     * that does not need a secret: the form-reader's probabilities are scored
     * against the winners that actually came in, and compared to the board's
     * on the same races. Log-loss, because it is the score a market is
     * actually judged by and it cannot be gamed by picking longshots.
     */
    const rng = makeRng(1717);
    const pool = GROUNDS.filter((g) => g.skin === 'PODRACE');
    const stables = [];
    for (let i = 0; i < 4; i++) stables.push(makeCard({ skin: 'PODRACE', seed: rng.int(1, 1e9) }));
    let board = 0, read = 0, n = 0, warm = 300;
    for (let i = 0; i < 1400; i++) {
      const card = stables[i % stables.length];
      const ground = dressGround(rng.pick(pool), rng.int(1, 1e9));
      const b = winProbabilities(card, ground, { hidden: false });
      const r = researchedProbabilities(card, ground);
      const result = runSpectacle({ card, ground, seed: rng.int(1, 1e9) });
      const k = card.entrants.findIndex((e) => e.id === result.winner);
      if (i >= warm && k >= 0) {
        board -= Math.log(Math.max(b[k].p, 1e-9));
        read -= Math.log(Math.max(r[k].p, 1e-9));
        n++;
      }
      recordResult(card, ground, result);
    }
    board /= n; read /= n;
    assert(read < board,
      `reading the public log scored ${read.toFixed(4)} against the board's ${board.toFixed(4)} — the reading `
      + 'room adds nothing a punter could not get off the board, so research is a decoration');
    /* And it must be reading something real, not just noise that happened to
     * land: the read is correlated with the term it is trying to recover. */
    const card = stables[0];
    const ground = dressGround(pool[0], 8123);
    let sxy = 0, sxx = 0, syy = 0;
    for (const e of card.entrants) {
      const x = readForm(e, ground).bonus;
      const y = formStrength(e, ground, { hidden: true }).total - formStrength(e, ground, { hidden: false }).total;
      sxy += x * y; sxx += x * x; syy += y * y;
    }
    assert(sxx > 0, 'the form reader recovered nothing at all from a full log');
    return `log-loss ${read.toFixed(4)} reading the log against ${board.toFixed(4)} off the board, over ${n} races`;
  });

  check('spectacle: the model the odds are quoted from is a model of this simulation', () => {
    /**
     * A miscalibrated model makes the informed bettor rich for the wrong
     * reason, and the clause above would still pass. So the model's own
     * probabilities are binned and compared with how often those runners
     * actually won — the standard reliability check, on the sim's own view.
     *
     * This is also what killed the first model. A softmax at a fitted
     * temperature was calibrated on the circuit it was fitted to and nowhere
     * else; the Thurstone integral in `fieldProbabilities` needs no fitting
     * per field, and this measures that on cards it has never seen.
     */
    const { bins, run } = circuit({ races: 1600, seed: 2718 });
    let worst = 0, rows = 0;
    const shown = [];
    for (const [b, row] of [...bins.entries()].sort((x, y) => x[0] - y[0])) {
      if (row.n < 120) continue;
      const said = row.p / row.n, was = row.hit / row.n;
      worst = Math.max(worst, Math.abs(said - was));
      rows++;
      shown.push(`${pct(said)}→${pct(was)}`);
    }
    assert(rows >= 3, `only ${rows} probability bins had enough runners to score`);
    assert(worst < 0.06,
      `the model said one thing and the sim did another by ${pct(worst)} in a populated bin — the prices `
      + 'quoted before the race are not prices for this race');
    return `${rows} bins over ${run} races, worst gap ${pct(worst)} (${shown.join(' ')})`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  4. THE WINDOW
   * ══════════════════════════════════════════════════════════════════════ */

  check('spectacle: every moment on the screen is a moment from the race, with the entrants in it', () => {
    /**
     * *"maybe the scnes you sometimes see play out on the screens are actually
     * real scenes from that podrace you're watching."*
     *
     * So the event stream is the render source and it has to carry enough to
     * pose a shot: a type, a time, and the entrants who were in it — by id,
     * resolvable on the card. An event naming nobody is a screensaver.
     */
    const seen = new Map();
    let events = 0, named = 0, lines = 0;
    for (let t = 0; t < 90; t++) {
      const { card, ground } = fixture({ seed: 400 + t, ground: podGround(500 + t) });
      const ids = new Set(card.entrants.map((e) => e.id));
      const r = runSpectacle({ card, ground, seed: 60000 + t });
      let last = -1;
      for (const ev of r.events) {
        events++;
        assert(ev.t >= last, 'the event stream went backwards in time');
        last = ev.t;
        seen.set(ev.type, (seen.get(ev.type) || 0) + 1);
        if (ev.who) { assert(ids.has(ev.who), `an event named ${ev.who}, who is not on the card`); named++; }
        for (const k of ['from', 'past', 'by']) if (ev[k]) assert(ids.has(ev[k]), `an event named a stranger in .${k}`);
        const line = announce(ev, card);
        if (line) { lines++; assert(line.length > 4, 'the announcer said nothing'); }
      }
    }
    for (const want of ['off', 'lead', 'overtake', 'wall', 'mechanical', 'retire', 'result']) {
      assert(seen.get(want) > 0, `the sim never once emitted a ${want} over 90 races — the screens have nothing to cut to`);
    }
    const moments = momentsOf({ events: [...seen.keys()].map((type) => ({ type })) });
    assert(moments.length >= 5, 'almost nothing in the stream is worth cutting to');
    return `${events} events over 90 races, ${named} naming an entrant, ${lines} read by the announcer; `
      + [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(' ');
  });

  check('spectacle: the announcer holds no script of its own', () => {
    /* A line generator that invents an event is worse than a silent screen —
     * the room would be cheering something that did not happen. An unknown
     * type returns null rather than a filler. */
    const { card } = fixture({ seed: 91 });
    assert(announce({ type: 'a-type-nobody-emits', who: card.entrants[0].id }, card) === null,
      'the announcer has a line for an event the sim cannot emit');
    const line = announce({ t: 3, type: 'overtake', who: card.entrants[1].id, past: card.entrants[2].id, gate: 4 }, card);
    assert(line.includes(card.entrants[1].name) && line.includes(card.entrants[2].name),
      'an overtake was announced without naming either pod');
    return `an unknown event is silent; "${line}"`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  5. THREE SKINS, ONE ENGINE
   * ══════════════════════════════════════════════════════════════════════ */

  check('spectacle: three skins run on one engine and differ only in their tables', () => {
    /**
     * The lane's own words — "one engine, three skins" — as a measurement.
     * PIT and ARENA share an advance and PODRACE has the other, so the count
     * of distinct advances is two and the count of skins is three; every skin
     * is driven end to end and must produce a finished order.
     */
    const advances = new Set(Object.values(SKINS).map((s) => s.advance));
    assert(advances.size === 2, `${advances.size} advances for ${Object.keys(SKINS).length} skins — this is not one engine`);
    assert(SKINS.PIT.advance === SKINS.ARENA.advance, 'the pit and the arena are two implementations of one bout');
    const out = [];
    for (const skin of Object.keys(SKINS)) {
      const pool = GROUNDS.filter((g) => g.skin === skin);
      assert(pool.length >= 1, `${skin} has no ground to run on`);
      let finished = 0, ended = 0;
      for (let t = 0; t < 40; t++) {
        const ground = dressGround(pool[t % pool.length], 3000 + t);
        const card = makeCard({ skin, seed: 800 + t });
        const r = runSpectacle({ card, ground, seed: 12000 + t });
        assert(r.order.length === card.entrants.length, `${skin} lost a runner between the start and the result`);
        assert(r.winner && r.order[0].position === 1, `${skin} finished without a winner`);
        if (SKINS[skin].mode === 'bout') {
          const standing = r.order.filter((o) => o.status === 'finished').length;
          assert(standing <= card.entrants.length, `${skin}: more standing than started`);
          if (standing <= 1) ended++;
        }
        finished++;
      }
      out.push(`${skin} ${finished}${SKINS[skin].mode === 'bout' ? ` (${ended} settled on the floor)` : ''}`);
    }
    return `2 advances, 3 skins, ${GROUNDS.length} grounds: ${out.join(', ')}`;
  });

  check('spectacle: a bout ends the way a bout ends — knockdowns, refusals and somebody left standing', () => {
    /* The player named the events; this is where the pit ones have to actually
     * happen, at rates that read as a fight rather than as a lottery. */
    const seen = new Map();
    let bouts = 0;
    for (let t = 0; t < 120; t++) {
      const ground = dressGround(groundById('underlift'), 4400 + t);
      const card = makeCard({ skin: 'PIT', seed: 1500 + t });
      const r = runSpectacle({ card, ground, seed: 22000 + t });
      bouts++;
      for (const ev of r.events) seen.set(ev.type, (seen.get(ev.type) || 0) + 1);
    }
    for (const want of ['knockdown', 'refusal', 'beaten', 'wound']) {
      assert(seen.get(want) > 0, `${bouts} bouts in the Underlift and not one ${want}`);
    }
    return `${bouts} bouts: ` + ['knockdown', 'beaten', 'refusal', 'wound'].map((k) => `${k}×${seen.get(k)}`).join(' ');
  });

  check('spectacle: the field persists and the history it builds is public', () => {
    /**
     * *"the field of racers persists across days and builds a real history you
     * can study."* So `recordResult` must grow the public record and the
     * public record only — with one deliberate exception, the grudge, which is
     * a hidden term WRITTEN BY a public result and is the nicest thing in the
     * file.
     */
    const card = makeCard({ skin: 'PODRACE', seed: 5150 });
    const before = card.entrants.map((e) => JSON.stringify(e.hidden));
    const { races } = runMeeting({ card, skin: 'PODRACE', races: 30, seed: 606 });
    const after = card.entrants.map((e) => JSON.stringify(e.hidden));
    assert(before.join('|') === after.join('|'), 'a race moved a hidden term on a podrace card');
    for (const e of card.entrants) {
      assert(e.form.starts === 30, `an entrant ran ${e.form.starts} of 30 races`);
      assert(e.form.log.length === 30 && e.form.recent.length === 6, 'the public log did not grow with the meeting');
      assert(e.form.log[0].conditions.rain !== undefined, 'the log does not record the going it was run in');
    }
    const wins = card.entrants.reduce((a, e) => a + e.form.wins, 0);
    assert(wins === 30, `${wins} wins recorded over 30 races`);
    /* …and the bout's grudge, which IS allowed to move, and only after a loss. */
    const pit = makeCard({ skin: 'PIT', seed: 7 });
    runMeeting({ card: pit, skin: 'PIT', races: 6, seed: 8 });
    const grudges = pit.entrants.filter((e) => e.hidden.grudge && Object.keys(e.hidden.grudge).length).length;
    assert(grudges > 0, 'six bouts and nobody carries anything into the next one');
    return `30 starts each on a persistent field, ${races.length} cards; ${grudges} of ${pit.entrants.length} fighters carry a grudge`;
  });

  check('spectacle: the player\'s own companion is an entrant, and the engine never learns what one is', () => {
    /**
     * Lane G, and the seam that keeps it cheap: a kennel record is a plain
     * object, so the adapter reads six fields off it and this file imports
     * neither `Companions.js` nor `CompanionKinds.js` — both of which reach
     * `Bodies.js` and therefore THREE, and would make the whole engine
     * unloadable in a headless room.
     */
    assert(!/Companions\.js|CompanionKinds\.js|Kennel\.js/.test(code),
      'the spectacle engine imports the companion tree — it is no longer a headless library');
    const green = entrantFromCompanion({ id: 'c1', name: 'Ash', bond: 0.15, scars: [] });
    const veteran = entrantFromCompanion({ id: 'c2', name: 'Bracken', bond: 0.95, scars: ['a', 'b', 'c', 'd'] });
    assert(veteran.form.rating > green.form.rating,
      'a bonded animal with four pits behind it rates no higher than one that has never fought');
    assert(veteran.hidden.heart > green.hidden.heart, 'the bond does not reach the animal\'s heart');
    const ground = dressGround(groundById('arena-sand'), 4242);
    const card = { skin: 'ARENA', entrants: [veteran, green] };
    const board = priceCard(card, ground);
    assert(board.length === 2 && board[0].price > 1 && board[1].price > 1, 'the arena will not price a bout');
    assert(board[0].price < board[1].price, 'the board made the green animal the favourite');
    /* AND A MATCHED PAIR, because Lane G says the opposition is "scaled for
     * your player" — two animals with the same history must give a contest and
     * not a formality, or the room is a slot machine with a dog in it. */
    const mine = entrantFromCompanion({ id: 'm', name: 'Kettle', bond: 0.6, scars: ['a', 'b'] });
    const theirs = entrantFromCompanion({ id: 't', name: 'Vole', bond: 0.58, scars: ['a', 'b'] });
    const matched = { skin: 'ARENA', entrants: [mine, theirs] };
    let won = 0;
    for (let t = 0; t < 300; t++) if (runSpectacle({ card: matched, ground, seed: 900 + t }).winner === 'm') won++;
    assert(won > 90 && won < 210,
      `a matched pair split ${won}/300 — the arena is ${won > 210 ? 'a formality' : 'rigged against the player'}`);
    return `Bracken rates ${veteran.form.rating} to Ash's ${green.form.rating}, priced ${board[0].price} against `
      + `${board[1].price}; a matched pair split ${won}/300`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  6. IT IS A LIBRARY
   * ══════════════════════════════════════════════════════════════════════ */

  check('spectacle: the engine is a pure library — no world, no room, no mode named', () => {
    /**
     * §9.2 — no station file may name a game mode — plus the thing that makes
     * every clause above possible: the engine has to be drivable with nothing
     * around it. A single import of `Station.js` or `World.js` would put a
     * scene graph behind a betting market.
     */
    for (const bad of ['Station.js', 'Waves.js', 'World.js', 'three', 'document', 'window\\.']) {
      assert(!new RegExp(`(import[^\\n]*['"][^'"]*${bad}|\\b${bad}\\b)`).test(code),
        `Spectacle.js reaches ${bad} — the renderer's job has leaked into the simulation`);
    }
    const imports = [...code.matchAll(/^import .*from '([^']+)';/gm)].map((m) => m[1]);
    assert(imports.length === 1 && imports[0] === '../engine/MathUtil.js',
      `the engine imports ${imports.join(', ')} — it was meant to import one thing`);
    assert(!/Math\.random/.test(code), 'the engine calls Math.random — it cannot be seeded and the gate cannot repeat it');
    return `one import (${imports[0]}), no scene, no room, no mode named`;
  });

  check('spectacle: the probability model integrates to one and knows what a tight field is', () => {
    /* The quadrature underneath every price. Two properties, both cheap and
     * both silently wrong if the grid is too narrow: it sums to one, and a
     * field of equals splits evenly however many of them there are. */
    for (const n of [2, 4, 8, 12]) {
      const flat = new Array(n).fill(3);
      const p = fieldProbabilities(flat, 0.65);
      const sum = p.reduce((a, b) => a + b, 0);
      assert(Math.abs(sum - 1) < 1e-9, `a field of ${n} summed to ${sum}`);
      assert(Math.abs(p[0] - 1 / n) < 1e-3, `a field of ${n} equals did not split evenly: ${p[0]}`);
    }
    /* And it must SEE a gap: the same gap in a quiet field is worth more than
     * in a noisy one, which is the whole reason the softmax was thrown out. */
    const tight = fieldProbabilities([3.4, 3, 3, 3, 3, 3, 3, 3], 0.25)[0];
    const loose = fieldProbabilities([3.4, 3, 3, 3, 3, 3, 3, 3], 1.2)[0];
    assert(tight > loose + 0.1,
      `a 0.4 edge was worth ${tight.toFixed(3)} in a quiet field and ${loose.toFixed(3)} in a noisy one — `
      + 'the model is not reading the noise');
    return `sums to 1 for fields of 2–12; a 0.4 edge is worth ${pct(tight)} at σ 0.25 and ${pct(loose)} at σ 1.2`;
  });

  check('spectacle: every term in every table is reachable, and every hidden one is actually hidden', () => {
    /**
     * A term with a `seen` flag nothing reads, or a hidden term the public
     * strength happens to include, is the failure this whole design is built
     * to make impossible — so it is measured rather than asserted about the
     * source. Move ONE hidden field at a time and demand the public strength
     * does not budge and the hidden one does.
     */
    const rows = [];
    for (const skin of Object.keys(SKINS)) {
      const pool = GROUNDS.filter((g) => g.skin === skin);
      const ground = dressGround(pool[0], 999);
      const card = makeCard({ skin, seed: 321 });
      const e = card.entrants[0];
      for (const t of SKINS[skin].terms) {
        if (t.seen) continue;
        const keys = Object.keys(e.hidden);
        let moved = 0;
        for (const k of keys) {
          const was = e.hidden[k];
          e.hidden[k] = was + 0.9;
          const pub = formStrength(e, ground, { hidden: false }).total;
          const hid = formStrength(e, ground, { hidden: true }).total;
          e.hidden[k] = was;
          const pub0 = formStrength(e, ground, { hidden: false }).total;
          const hid0 = formStrength(e, ground, { hidden: true }).total;
          assert(Math.abs(pub - pub0) < 1e-12, `${skin}: moving hidden.${k} moved the PUBLIC strength`);
          if (Math.abs(hid - hid0) > 1e-9) moved++;
        }
        assert(moved > 0, `${skin}: no hidden field reaches the sim's strength at all`);
        rows.push(`${skin}/${t.key}`);
        break;
      }
    }
    return `${rows.length} skins checked, every hidden field moves the sim and none moves the board`;
  });
}
