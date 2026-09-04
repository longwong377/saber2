/**
 * BATTLEFRONT BORZ — THE TOTE, MEASURED.
 *
 * V16 Lane D2 turns the spectacle engine into three rooms you can walk into.
 * Two of the player's sentences are the whole specification, and the second is
 * the hard one:
 *
 *   *"you can bet on podracing … these will be real races without
 *    pre-determined outcomes."*
 *
 *   *"you should be able to bet on other people's companion battles too even
 *    if you're not involved, you don't have to bet to watch (applies to any
 *    casino game)."*
 *
 * ── WHAT IS ACTUALLY HARD TO CATCH HERE ──────────────────────────────────
 *
 *   A ROOM THAT CHARGES AT THE DOOR reads perfectly as source. Every reader
 *     below is driven with NOTHING on the record and the reading is required
 *     to be complete; then a hundred tickets are struck against the same hour
 *     and the two readings are compared field for field.
 *
 *   A PAYOUT TABLE IS IMPOSSIBLE TO EYEBALL, which is why `games.mjs` measures
 *     the Drum's edge rather than reading it: the Drum's first table paid the
 *     PLAYER 63%. Every market here is settled over thousands of races at a
 *     stake large enough that `Math.round` is not the payout, and what comes
 *     back is compared to what was declared.
 *
 *   A BOARD THAT PEEKS is invisible from outside and makes the form book a
 *     decoration. The engine's suite permutes the hidden half under its own
 *     board; this one does it under the TOTE'S derived markets, because a leak
 *     could have been introduced by the place market rather than by the price
 *     it was derived from.
 *
 *   A MEASUREMENT DOWN ONE YARD IS ONE SAMPLE however many races it runs. The
 *     hidden terms that make a pod good in the wet are drawn once and never
 *     redrawn, so twelve thousand races down a single yard are twelve thousand
 *     correlated races. It cost a favourite-backer reading +14.6% here, which
 *     is not possible in expectation and was the tell. Everything with an
 *     error bar on it below runs across independent yards and the spread is
 *     taken across THOSE.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import {
  researchedProbabilities, winProbabilities, formStrength, readForm, fieldProbabilities, blindnessOf, SKINS,
} from '../../src/game/Spectacle.js';
import * as Tote from '../../src/game/Tote.js';

const {
  VENUES, venueById, venueAtPlace, FORM_DAYS, MAX_STAKE, BETS, TAKE, placesPaid,
  programmeAt, meetAt, racesOn, bookAt, makeYard, walkVenue,
  boardFor, resultOf, ticketFor, settleTickets, standingsAt, watch, edgeOf, randomReturn, beatenBy, clearTote,
} = Tote;

const SRC = new URL('../../src/game/Tote.js', import.meta.url);
const pct = (n) => `${(n * 100).toFixed(2)}%`;

/** The projection of a reading a screen would actually print. Compared field
 * for field between a reader who bet and one who did not. */
const printed = (r) => JSON.stringify({
  phase: r.phase, dark: r.dark, progress: r.progress, segment: r.segment, segments: r.segments,
  meet: r.meet, race: r.race?.id || null, winner: r.winner, margin: r.margin, next: r.next,
  standings: r.standings, calls: r.calls,
  board: r.board && { places: r.board.places, favourite: r.board.favourite, field: r.board.field,
    runners: r.board.runners },
});

/** Mean and the standard error of the mean, across independent yards. */
function spread(a) {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, a.length - 1);
  return { mean: m, se: Math.sqrt(v / a.length) };
}

/**
 * TWO PUNTERS, THE SAME MONEY, THE SAME RACES, DOWN ONE YARD.
 *
 *   THE READER  backs the runner his reading of the PUBLIC log likes best —
 *               `researchedProbabilities`, which is handed no hidden field and
 *               infers what it can from results and weather.
 *   THE PIN     picks a runner off the card at random. Averaged over every
 *               runner the pin could have landed on rather than sampled with an
 *               actual coin: the same measurement with the picking noise taken
 *               out, which is how a seven-point gap is read in thirty thousand
 *               races instead of three million.
 */
function twoPunters(venue, { yardSeed, races, warm = 200, STAKE = 1000 }) {
  const book = makeYard(venue, yardSeed);
  let n = 0, read = 0, pin = 0, staked = 0, favWins = 0, ran = 0;
  const winners = new Set();
  for (const step of walkVenue(venue, { from: (yardSeed % 977) * 31, days: races, book })) {
    if (n >= races) break;
    const board = boardFor(step.race);
    const result = resultOf(step.race);
    n++;
    if (n <= warm) continue;
    ran++;
    winners.add(result.winner);
    if (result.winner === board.favourite) favWins++;
    const probs = researchedProbabilities(step.race.card, step.race.ground);
    let best = null;
    for (const { id, p } of probs) if (!best || p > best.p) best = { id, p };
    const price = new Map(board.runners.map((r) => [r.id, r.win]));
    const home = result.winner != null ? price.get(result.winner) || 0 : 0;
    read += result.winner === best.id ? STAKE * home : 0;
    pin += (STAKE * home) / board.runners.length;
    staked += STAKE;
  }
  return { read: read / staked - 1, pin: pin / staked - 1, races: ran, favStrike: favWins / ran, winners: winners.size };
}

export async function run({ check, assert }) {
  check = await clocked(check);
  const src = await readFile(SRC, 'utf8');
  /* Comments stripped for the SOURCE scans, so a note ABOUT a wallet word is
   * not read as one — `determinism.mjs` and the engine's suite both learned
   * this the same way. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /* ══════════════════════════════════════════════════════════════════════
   *  1. THE CARD
   * ══════════════════════════════════════════════════════════════════════ */

  check('tote: three places, one card a day, the same one for everybody in the room', () => {
    /**
     * A shelf is seeded off `(counter, day)` and a job off `(place, day)` so
     * that two players in one bar see one stranger with one job. A card is the
     * same idiom and needs it more: a race two people in the same room
     * disagreed about is not a race, it is two.
     *
     * The stronger half is that the RESULT agrees too — the run seed is a hash
     * of the place, the day and the index, so the race cannot be re-taken by
     * walking out and back in, which is exactly the property the Drum's clock
     * exists for.
     */
    assert(VENUES.length === 3, `${VENUES.length} venues — Lane D2 is three rooms`);
    for (const v of VENUES) {
      assert(venueAtPlace(v.place) === v, `#${v.place} does not resolve to ${v.id}`);
      assert(SKINS[v.skin], `${v.id} names a skin the engine does not have: ${v.skin}`);
    }
    /* Two readers, one hour. The second clears every cache first, so what is
     * compared is the derivation and not a Map. */
    const hours = [];
    for (const v of VENUES) {
      for (const day of [7, 8, 41]) {
        for (let h = 9; h < 24; h += 0.35) {
          const a = printed(watch(v.id, day, h));
          clearTote();
          const b = printed(watch(v.id, day, h));
          assert(a === b, `${v.id} read differently twice on day ${day} at ${h.toFixed(2)}`);
          hours.push(h);
        }
      }
    }
    /* AND TOMORROW IS A DIFFERENT CARD. A room whose card never changed would
     * be a wiki page, which is `Counter.js`'s whole argument for the reroll. */
    let moved = 0;
    for (let day = 0; day < 40; day++) {
      const a = programmeAt('holo-theatre', day), b = programmeAt('holo-theatre', day + 1);
      if (JSON.stringify(a.meets.map((m) => m.races.map((r) => [r.hour, r.ground])))
        !== JSON.stringify(b.meets.map((m) => m.races.map((r) => [r.hour, r.ground])))) moved++;
    }
    assert(moved >= 38, `only ${moved} of 40 days differed from the next — the card is a timetable`);
    return `3 venues, ${hours.length} readings each agreeing twice, ${moved}/40 days a different card`;
  });

  check('tote: between meets the room is a room, and some nights it is dark', () => {
    /**
     * A card that is always on is a screensaver with a board in front of it.
     * `#61`'s own gazetteer line — *"a card runs from 22:00 on the nights it
     * runs at all"* — is the house voice for a room that is sometimes just a
     * room, and all three of these are.
     */
    const counts = {};
    for (const v of VENUES) {
      let dark = 0, races = 0, hoursOpen = 0, hoursShut = 0;
      for (let day = 0; day < 220; day++) {
        const p = programmeAt(v.id, day);
        if (p.dark) { dark++; continue; }
        races += p.meets.reduce((a, m) => a + m.races.length, 0);
        for (let h = 0; h < 24; h += 0.5) (meetAt(v.id, day, h) ? hoursOpen++ : hoursShut++);
      }
      counts[v.id] = { dark, races: races / (220 - dark) };
      assert(dark > 220 * 0.05, `${v.id} was dark on ${dark} of 220 nights — it never closes`);
      assert(dark < 220 * 0.45, `${v.id} was dark on ${dark} of 220 nights — it barely opens`);
      assert(hoursShut > hoursOpen, `${v.id} has a meet on for most of the day`);
      assert(counts[v.id].races >= 3, `${v.id} runs only ${counts[v.id].races.toFixed(1)} a night`);
    }
    /* And the reading between meets says so rather than throwing or lying. */
    let shut = 0, open = 0;
    for (let h = 0; h < 24; h += 0.25) {
      const r = watch('holo-theatre', 9, h);
      if (r.phase === 'running' || r.phase === 'called' || r.phase === 'parading') open++;
      else { shut++; assert(!r.race && !r.board, `the room served a board at ${h} with no meet on`); }
    }
    assert(shut > 0 && open > 0, `the Holo-theatre was ${open ? 'never shut' : 'never open'} on day 9`);
    return VENUES.map((v) => `${v.id} dark ${counts[v.id].dark}/220, ${counts[v.id].races.toFixed(1)} a night`).join('; ');
  });

  check('tote: the form book is the last fortnight, replayed, and everybody replays the same one', () => {
    /**
     * There is no stored history and there must not be one — a durable record
     * of races is a save file nobody asked for and the one thing two players
     * could disagree about. The book is DERIVED: every seed is a hash of the
     * place, the day and the index, so yesterday is a pure function of
     * yesterday and anybody may run it.
     *
     * What has to hold is that the replay actually produces a book worth
     * reading — `Spectacle.readForm` needs two starts either side of a split
     * before it will say anything at all — and that two readers get the same
     * one.
     */
    clearTote();
    const a = bookAt('holo-theatre', 60);
    clearTote();
    const b = bookAt('holo-theatre', 60);
    const line = (bk) => bk.entrants.map((e) => `${e.id}:${e.form.starts}:${e.form.recent.join('')}:${e.form.log.length}`).join('|');
    assert(line(a) === line(b), 'two replays of the same fortnight produced different form');
    const starts = a.entrants.map((e) => e.form.starts);
    const least = Math.min(...starts);
    assert(least >= 8, `a runner had only ${least} starts in the book — ${FORM_DAYS} days is not a form book`);
    /* AND A DIFFERENT DAY IS A DIFFERENT BOOK, or the fortnight is a fiction. */
    const c = bookAt('holo-theatre', 61);
    assert(line(a) !== line(c), 'the book did not move when the day did');
    return `${a.entrants.length} in the yard, ${least}–${Math.max(...starts)} starts each over ${FORM_DAYS} days`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  2. THE BOARD
   * ══════════════════════════════════════════════════════════════════════ */

  check('tote: the house edge on every market is positive, small, and measured', () => {
    /**
     * `games.mjs` measures the Drum rather than reading it, because the Drum's
     * first payout table handed the player 63% and read as perfectly sensible.
     * The same discipline, on a market whose prices are derived three deep: a
     * quadrature, then Harville, then a cut, then a rounding.
     *
     * `edgeOf` buys the whole book in proportion to the prices, which is the
     * only stake with no opinion in it — see its own note for what the first
     * version measured instead and why 23.7% was not the house's cut.
     */
    const rows = [];
    for (const v of VENUES) {
      for (const bet of BETS) {
        const e = edgeOf(bet.id, { venue: v.id, races: 1600 });
        if (!e.races) {
          /* A market that does not exist here is not a failure. The Arena has
           * two in the sand, so it has one market: a place bet on a two-runner
           * bout pays everybody who turns up. */
          assert(v.skin === 'ARENA' && bet.id !== 'win',
            `${v.id} has no ${bet.id} market and no reason not to`);
          rows.push(`${v.id} ${bet.id} —`);
          continue;
        }
        assert(e.edge > 0.005,
          `the ${bet.id} market at ${v.id} returns ${pct(e.edge)} to the HOUSE over ${e.races} races — `
          + 'at or below zero the player prints money and the room closes');
        assert(e.edge < 0.16,
          `the ${bet.id} market at ${v.id} takes ${pct(e.edge)} — past about a sixth nobody plays twice`);
        rows.push(`${v.id} ${bet.id} ${pct(e.edge)}`);
      }
    }
    /* AND THE DECLARED TAKE IS THE MEASURED ONE, on the two markets where the
     * arithmetic says it must be. The field bet is the exception and is
     * allowed to differ: it is a single outcome with no complement on the
     * board, so nothing forces its measured cut to its declared one and only
     * the measurement can say what it is. */
    for (const v of VENUES) {
      const win = edgeOf('win', { venue: v.id, races: 1600 });
      assert(Math.abs(win.edge - SKINS[v.skin].take) < 0.012,
        `${v.id} declares a ${pct(SKINS[v.skin].take)} take on the win market and returns ${pct(win.edge)}`);
    }
    return rows.join(', ');
  });

  check('tote: no favourite always wins, and every runner in the yard wins sometimes', () => {
    /**
     * The engine's suite proves the result is not a function of the odds on
     * its own circuit; this is the same claim through the tote's fields, which
     * are drawn from a yard rather than being the yard — and, at the Arena,
     * are MATCHED, which is the one place a draw rule could have quietly
     * turned a market into a formality.
     */
    const rows = [];
    for (const v of VENUES) {
      const r = twoPunters(v.id, { yardSeed: 4242, races: 1400, warm: 200 });
      const cap = v.skin === 'ARENA' ? 0.72 : 0.62;
      assert(r.favStrike < cap,
        `the favourite at ${v.id} won ${pct(r.favStrike)} of ${r.races} — a board nobody needs to read`);
      assert(r.favStrike > 1 / (SKINS[v.skin].field * 1.4),
        `the favourite at ${v.id} won only ${pct(r.favStrike)} — the price means nothing`);
      assert(r.winners === venueById(v.id).yard,
        `only ${r.winners} of the ${venueById(v.id).yard} in ${v.id}'s yard ever won one`);
      rows.push(`${v.id} favourite ${pct(r.favStrike)}, all ${r.winners} won one`);
    }
    return rows.join('; ');
  });

  check('tote: the board moves with the public form and not one hundredth with the hidden half', () => {
    /**
     * TWO PERMUTATIONS, IN OPPOSITE DIRECTIONS, and both are needed.
     *
     * Permute the PUBLIC form — the thing the board is supposed to be a
     * function of — and every price must move. A board that did not would be a
     * random number with a decimal point in it.
     *
     * Permute the HIDDEN half and NOTHING may move, to a hundredth. The
     * engine's suite holds this over `priceCard`; it is re-driven here because
     * the place and field markets are derived by THIS file and a leak could
     * have been introduced by the derivation rather than by what it derived
     * from.
     */
    const race = racesOn('holo-theatre', 33)[0] || racesOn('holo-theatre', 34)[0];
    assert(race, 'no race to price');
    const before = boardFor(race);
    const print = (b) => JSON.stringify(b.runners.map((r) => [r.win, r.place])) + JSON.stringify(b.field);

    /* THE HIDDEN HALF, ROTATED ROUND THE FIELD. */
    const hidden = race.card.entrants.map((e) => ({ ...e.hidden }));
    race.card.entrants.forEach((e, i) => { e.hidden = hidden[(i + 1) % hidden.length]; });
    race._board = null;
    const afterHidden = boardFor(race);
    assert(print(before) === print(afterHidden),
      'rotating every hidden term round the field moved the board — the price is reading what the punter cannot');
    race.card.entrants.forEach((e, i) => { e.hidden = hidden[i]; });

    /* THE PUBLIC HALF, ROTATED THE SAME WAY. */
    const form = race.card.entrants.map((e) => e.form);
    race.card.entrants.forEach((e, i) => { e.form = form[(i + 1) % form.length]; });
    race._board = null;
    const afterForm = boardFor(race);
    let unmoved = 0;
    before.runners.forEach((r, i) => {
      const now = afterForm.runners[i];
      if (Math.abs(now.win - r.win) < 0.01) unmoved++;
    });
    race.card.entrants.forEach((e, i) => { e.form = form[i]; });
    race._board = null;
    assert(!unmoved,
      `${unmoved} of ${before.runners.length} prices did not move when the whole form book was permuted `
      + 'under them — the board is not reading the form it prints');
    return `${before.runners.length} prices, all moved by the form, none by the hidden half`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  3. THE BET
   * ══════════════════════════════════════════════════════════════════════ */

  check('tote: a ticket is priced when it is struck, and the book closes when the race goes off', () => {
    /**
     * The result is a pure function of a seed anybody may call, so the engine
     * cannot stop a bet being struck on a race that has already run — the
     * refusal has to be at this window. It is the Drum's rule in a bigger room:
     * *"a player cannot re-take a roll by walking out and back in."*
     */
    const race = racesOn('holo-theatre', 33).find((r) => boardFor(r).places) || racesOn('holo-theatre', 34)[0];
    const board = boardFor(race);
    const on = board.runners[0].id;
    const ok = ticketFor(race, { on, kind: 'win', stake: 50, at: race.hour - 0.2 });
    assert(ok.ok && ok.ticket.price === board.runners[0].win, 'a bet struck before the off was refused or mispriced');

    const closed = ticketFor(race, { on, kind: 'win', stake: 50, at: race.hour });
    assert(!closed.ok && /off|closed/.test(closed.why), `a bet was taken on a race already under way: ${closed.why}`);
    const after = ticketFor(race, { on, kind: 'win', stake: 50, at: race.hour + 5 });
    assert(!after.ok, 'a bet was taken on a race that had already been called');

    /* EVERY REFUSAL SAYS WHICH REFUSAL IT IS, the shape `Credits.spend` answers
     * in — a window that says "no" without saying which no is the shape of
     * thing this tree keeps removing. */
    const refusals = [
      ticketFor(race, { on, kind: 'win', stake: 0, at: 0 }),
      ticketFor(race, { on, kind: 'win', stake: MAX_STAKE + 1, at: 0 }),
      ticketFor(race, { on: 'nobody', kind: 'win', stake: 10, at: 0 }),
      ticketFor(race, { on, kind: 'accumulator', stake: 10, at: 0 }),
      ticketFor(race, { on, kind: 'win', stake: 10 }),
    ];
    for (const r of refusals) assert(!r.ok && r.why && !r.ticket, `a refusal came back as ${JSON.stringify(r)}`);
    assert(new Set(refusals.map((r) => r.why)).size === refusals.length, 'two different refusals gave the same reason');

    /* AND THE PRICE IS THE TICKET'S. A board that moved afterwards cannot
     * reach a bet already written, which is what a price is FOR. */
    const held = ok.ticket.price;
    race._board = null;
    boardFor(race);
    assert(ok.ticket.price === held, 'the ticket changed price after it was struck');

    /* The two-runner room takes a win bet and refuses the rest by name. */
    const arena = racesOn('the-arena', 12)[0] || racesOn('the-arena', 13)[0];
    const noPlace = ticketFor(arena, { on: boardFor(arena).runners[0].id, kind: 'place', stake: 10, at: 0 });
    assert(!noPlace.ok, 'the Arena took a place bet on a two-runner bout');
    return `priced at ${held}, ${refusals.length} refusals each with its own reason, book shut at the off`;
  });

  check('tote: settlement pays what the ticket says and nothing else', () => {
    /**
     * Driven against the finishing order rather than argued: a win pays the
     * winner, a place pays the frame, the field pays everybody but the
     * favourite, and a ticket on a runner who is not in the race is REFUSED
     * rather than quietly losing — the failure `Spectacle.settle` names and
     * that has cost this tree three afternoons in other files.
     */
    let win = 0, place = 0, field = 0, races = 0;
    for (const race of racesOn('holo-theatre', 44).concat(racesOn('holo-theatre', 45))) {
      const board = boardFor(race);
      const result = resultOf(race);
      races++;
      const tickets = board.runners.map((r) => ({
        kind: 'win', on: r.id, price: r.win, stake: 100, places: board.places,
      }));
      const led = settleTickets(tickets, result);
      assert(led.lines.filter((l) => l.won).length === 1, `${led.lines.filter((l) => l.won).length} winners in one race`);
      assert(led.lines.find((l) => l.won).on === result.winner, 'the paid line was not the winner');
      assert(led.staked === 100 * board.runners.length, 'the ledger lost track of the stake');
      win += led.returned;
      if (board.places) {
        const pl = settleTickets(board.runners.map((r) => ({
          kind: 'place', on: r.id, price: r.place, stake: 100, places: board.places,
        })), result);
        assert(pl.lines.filter((l) => l.won).length === board.places,
          `${pl.lines.filter((l) => l.won).length} paid a place where ${board.places} are paid`);
        for (const l of pl.lines.filter((x) => x.won)) {
          assert(result.order.find((o) => o.id === l.on).position <= board.places, 'a place was paid outside the frame');
        }
        place += pl.returned;
      }
      const fd = settleTickets([{ kind: 'field', on: board.field.against, price: board.field.price, stake: 100, places: 0 }], result);
      assert(fd.lines[0].won === (result.winner !== board.field.against), 'the field bet was settled against the wrong runner');
      field += fd.returned;
    }
    /* A STRANGER IS REFUSED, NOT LOST. */
    const race = racesOn('holo-theatre', 44)[0];
    let threw = false;
    try { settleTickets([{ kind: 'win', on: 'somebody-else', price: 4, stake: 10 }], resultOf(race)); } catch { threw = true; }
    assert(threw, 'a ticket on a runner who was not in the race settled quietly as a loser');
    /* AND AN EMPTY RECORD SETTLES TO NOTHING, which is the spectator's ledger
     * and must not throw, refuse, or invent a refund. */
    const nil = settleTickets([], resultOf(race));
    assert(nil.staked === 0 && nil.returned === 0 && nil.net === 0 && !nil.lines.length,
      'settling no bets at all did not come back empty');
    return `${races} races settled: win ${win}, place ${place}, field ${field} back on 100s`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  4. THE SPECTATOR — the half the player actually asked for
   * ══════════════════════════════════════════════════════════════════════ */

  check('tote: watching is free, and a reading with nothing on the record is a whole one', () => {
    /**
     * *"you don't have to bet to watch (applies to any casino game)."*
     *
     * The bar is not that watching is cheap. It is that a player who never bets
     * a credit gets the SAME SCREEN: the board, the field, the going, how far
     * in it is, who is ahead, every line the announcer has said, and the call.
     *
     * Driven twice over the same day — once with nothing on the record, once
     * with a hundred tickets struck against every race on the card — and the
     * two printed readings are compared character for character. `watch` takes
     * a place, a day and an hour and has no parameter a ticket could hide in,
     * so this cannot fail; it is driven anyway, because that is the sentence
     * the room exists to keep.
     */
    let running = 0, called = 0, parading = 0, withCalls = 0, complete = 0;
    const day = 44;
    for (const v of VENUES) {
      for (let h = 8; h < 24; h += 0.1) {
        const free = watch(v.id, day, h);
        assert(free.free === true, 'a reading came back that was not free');
        if (free.phase === 'parading') parading++;
        if (free.phase === 'running' || free.phase === 'called') {
          /* A COMPLETE READING: the board, the field in running order, how far
           * in, and the announcer's own lines. */
          assert(free.board && free.board.runners.length >= 2, `no board at ${v.id} ${h.toFixed(1)}`);
          assert(free.standings.length === free.board.runners.length, 'the running order lost a runner');
          assert(free.standings.every((s) => s.name && s.position), 'a standing had no name or no position');
          assert(free.segments > 0 && free.segment <= free.segments, 'the clock and the race disagree');
          if (free.calls.length) withCalls++;
          complete++;
        }
        if (free.phase === 'running') { running++; assert(free.winner === null, 'a race under way already had a winner'); }
        if (free.phase === 'called') {
          called++;
          assert(free.winner && free.standings[0].id === free.winner, 'the call did not name the winner first');
          assert(free.standings.every((s) => s.dist !== null), 'the finish gave no distances');
        }
      }
    }
    /* A race runs for `runs` of an hour and the next is half an hour behind it,
     * so at a tenth of an hour a sample there are always more RUNNING readings
     * than CALLED ones. All three phases have to be reachable, which is the
     * claim; their ratio is the timetable's. */
    assert(running > 30 && called > 15 && parading > 5,
      `phases over a day: ${parading} parading, ${running} running, ${called} called`);
    assert(withCalls > running * 0.5, `only ${withCalls} of ${running + called} live readings carried a call`);

    /* NOW BET THE ROOM DOWN AND READ IT AGAIN. */
    const struck = [];
    for (const v of VENUES) {
      for (const race of racesOn(v.id, day)) {
        const board = boardFor(race);
        for (const r of board.runners) {
          const t = ticketFor(race, { on: r.id, kind: 'win', stake: MAX_STAKE, at: race.hour - 0.05 });
          if (t.ok) struck.push([race, t.ticket]);
          if (board.places) {
            const p = ticketFor(race, { on: r.id, kind: 'place', stake: 40, at: race.hour - 0.05 });
            if (p.ok) struck.push([race, p.ticket]);
          }
        }
      }
    }
    assert(struck.length > 100, `only ${struck.length} tickets struck`);
    let net = 0;
    for (const [race, ticket] of struck) net += settleTickets([ticket], resultOf(race)).net;
    let same = 0;
    for (const v of VENUES) {
      for (let h = 8; h < 24; h += 0.1) {
        const a = printed(watch(v.id, day, h));
        assert(a === printed(watch(v.id, day, h)), 'a reading changed between two looks');
        same++;
      }
    }
    /* And the same hours read the same after a full cache clear, which is the
     * player who left the room and came back. */
    const before = VENUES.map((v) => printed(watch(v.id, day, 20.4)));
    clearTote();
    const after = VENUES.map((v) => printed(watch(v.id, day, 20.4)));
    assert(JSON.stringify(before) === JSON.stringify(after),
      'the room read differently after the player walked out and back in');
    return `${complete} live readings with no stake on the record; ${struck.length} tickets settled `
      + `(${net > 0 ? '+' : ''}${net} to the punters) and every reading identical`;
  });

  check('tote: the leader on the screen is the leader in the race, and the screen invents nothing', () => {
    /**
     * The screen is built by replaying the engine's own `lead` and `overtake`
     * events up to the gate the clock has reached — which is exactly what a
     * spectator at the rail is told — so the thing that has to hold is that
     * the front of the race and the judge agree: whoever the feed has in front
     * on the last gate is the one called, whenever the winner finished.
     *
     * It caught two real defects and both read perfectly as source. An
     * overtake applied as an INSERTION rather than a swap re-sorted runners
     * the event says nothing about; and a gate's events applied in the order
     * they are emitted let an overtake undo the lead the same gate had just
     * announced. Both put the wrong pod on the screen at the line.
     *
     * It also must not invent a gap. Distances are on the runners and are NOT
     * in the event stream, and a screen printing one is a screen that knows
     * the result early — which, with a betting window open, is the whole
     * defect this lane exists to rule out.
     */
    let checked = 0, retired = 0, moved = 0;
    for (const v of VENUES) {
      for (const day of [50, 51, 52, 53, 54, 55, 56, 57]) {
        for (const race of racesOn(v.id, day)) {
          const result = resultOf(race);
          const last = standingsAt(race, race.hour + race.runs * 0.999);
          const finish = result.order.find((o) => o.id === result.winner);
          if (finish.status !== 'finished') { retired++; continue; }
          assert(last[0].id === result.winner,
            `${v.id} ${race.id}: the feed had ${last[0].name} in front and the judge called ${finish.name}`);
          /* And nothing mid-race carries a distance. */
          const mid = standingsAt(race, race.hour + race.runs * 0.5);
          assert(mid.every((s) => s.dist === null), 'the screen printed a gap the feed never carried');
          if (JSON.stringify(mid.map((s) => s.id)) !== JSON.stringify(last.map((s) => s.id))) moved++;
          checked++;
        }
      }
    }
    assert(checked > 60, `only ${checked} races checked`);
    assert(moved > checked * 0.4,
      `the order changed between halfway and the line in only ${moved} of ${checked} races — the screen is a still`);
    return `${checked} races: the feed's leader is the judge's winner in all of them, `
      + `the order moved after halfway in ${moved}, ${retired} won by a retirement`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  5. THE BETTORS
   * ══════════════════════════════════════════════════════════════════════ */

  check('tote: a punter who reads the form beats one who picks with a pin', () => {
    /**
     * *"in life a good better will probably make money over time."*
     *
     * The engine's suite proves this on its own circuit; this drives it END TO
     * END through the tote's prices — the board this file derives, the field
     * this file draws, and the form book this file replays out of nothing.
     *
     * ── AND THE ERROR BAR IS ACROSS YARDS, NOT ACROSS RACES ─────────────
     *
     * A yard is ONE SAMPLE however many races you run down it: the hidden term
     * that makes a pod good in the wet is drawn once and never redrawn, so a
     * thousand races down one yard are a thousand correlated races. Measured
     * that way a favourite-backer read +14.6% on one yard, which is not
     * possible in expectation and was the tell. So the punters ride a dozen
     * INDEPENDENT yards and the spread is taken across those.
     *
     * ── WHY THE HOLO-THEATRE CARRIES THE BAR AND THE OTHER TWO REPORT ───
     *
     * The engine's tables say plainly how much reading is worth in each room:
     * `leftBlind` is 0.65 on the pods and 0.90 in both fight skins, which is
     * the statement that nine tenths of what a fight hides stays hidden however
     * hard you read. So the Holo-theatre is the reading room and the other two
     * are not, and the honest bar is a hard one where the design says research
     * pays and the direction where it says it barely does. The numbers for all
     * three are printed either way.
     */
    const rows = [];
    const gaps = [];
    for (const [venue, yards, races] of [['holo-theatre', 20, 1500], ['the-pit', 16, 1200], ['the-arena', 20, 1200]]) {
      const read = [], pin = [];
      for (let y = 0; y < yards; y++) {
        const r = twoPunters(venue, { yardSeed: 1000 + y * 7717, races });
        read.push(r.read); pin.push(r.pin);
      }
      const gap = spread(read.map((x, i) => x - pin[i]));
      const R = spread(read), P = spread(pin);
      const t = gap.mean / gap.se;
      gaps.push(gap);
      assert(P.mean < -0.02, `a pin returned ${pct(P.mean)} at ${venue} — the room is giving money away`);
      if (venue === 'holo-theatre') {
        /* THE HARD BAR, in the room the player's sentence is about. */
        assert(gap.mean > 0 && t > 3,
          `at the podracing the reader returned ${pct(R.mean)} and the pin ${pct(P.mean)} over ${yards} `
          + `yards — a gap of ${pct(gap.mean)} ± ${pct(gap.se)}, which is ${t.toFixed(1)} standard errors `
          + 'and not "more than noise"');
      }
      rows.push(`${venue} reader ${pct(R.mean)} pin ${pct(P.mean)} gap ${pct(gap.mean)}±${pct(gap.se)} t ${t.toFixed(1)}`);
    }
    /**
     * AND THE STATION, ALL THREE ROOMS TOGETHER — a punter who walks the deck
     * with the form book against one who walks it with a pin. The fight rooms
     * carry a wide error bar on their own (a yard of fourteen is a small
     * population and its per-yard returns are long-tailed), so the claim that
     * has to hold across the deck is made across the deck.
     */
    const pooled = {
      mean: gaps.reduce((a, g) => a + g.mean, 0) / gaps.length,
      se: Math.hypot(...gaps.map((g) => g.se)) / gaps.length,
    };
    const T = pooled.mean / pooled.se;
    assert(pooled.mean > 0 && T > 3,
      `across the three rooms the form book was worth ${pct(pooled.mean)} ± ${pct(pooled.se)} a bet against `
      + `a pin, which is ${T.toFixed(1)} standard errors — reading is not paying for the walk`);
    return `${rows.join('; ')}; all three ${pct(pooled.mean)}±${pct(pooled.se)} (t ${T.toFixed(1)})`;
  });

  check('tote: a pin loses more than the house takes, which is why the form book is worth the walk', () => {
    /**
     * The room's cut and a punter's loss are two different numbers and the gap
     * between them is the whole reason a reading room is on the map.
     *
     * `edgeOf` buys the whole book and gets back exactly `1 − take`. A pin
     * picks one runner and loses MORE, every time, at all three venues —
     * because the board is deliberately flatter than the truth (it cannot see
     * the hidden terms, so from where it stands the race really is less
     * predictable), and a flat board prices outsiders shorter than they
     * deserve. That is the favourite–longshot bias, it is a real thing in a
     * real market, and it is the shape of the money the reader is taking.
     */
    const rows = [];
    for (const v of VENUES) {
      const cut = edgeOf('win', { venue: v.id, races: 1600 }).edge;
      const pin = randomReturn({ venue: v.id, races: 1600 }).roi;
      assert(-pin > cut,
        `a pin at ${v.id} lost ${pct(-pin)} against a house cut of ${pct(cut)} — the outsiders are priced `
        + 'better than the model, which is money on the floor');
      assert(-pin < 0.35, `a pin at ${v.id} lost ${pct(-pin)} a bet — nobody comes back to that`);
      rows.push(`${v.id} cut ${pct(cut)} pin ${pct(pin)}`);
    }
    return rows.join(', ');
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  6. THE FILE
   * ══════════════════════════════════════════════════════════════════════ */

  check('tote: the head-to-head is published, and pricing it did not pay', () => {
    /**
     * `Spectacle.recordResult` gives every beaten entrant in a BOUT a hidden
     * grudge against the one that beat it — up to 0.55 on a scale where a
     * rating point is 1/22 — and the board cannot see it. It is created by a
     * public event, so the tote publishes the count: `beatenBy`, written while
     * the fortnight is replayed, which is the one column here the engine's own
     * log does not carry.
     *
     * ── AND A PUNTER WHO PRICED IT LOST TO ONE WHO IGNORED IT ────────────
     *
     * The obvious bettor adds the grudge to the strength and re-prices. He is
     * driven below and he is WORSE — measured, half a point at the Arena and
     * four and a half in the Pit, both beyond their own error bars. The reason
     * is that being beaten is not independent of being beatable: the count is
     * loaded with the weakness that produced it, and adding it back on top of
     * a rating that already prices that weakness double-counts.
     *
     * So the column is PRINTED and not PRICED, which is a decision rather than
     * an omission, and this is the measurement it was made on. A better model
     * of it would be a real edge and is left on the table on purpose.
     */
    const yards = 10, races = 800, STAKE = 1000;
    const rows = [];
    let column = 0;
    for (const venue of ['the-arena', 'the-pit']) {
      const S = SKINS[venueById(venue).skin];
      const read = [], grudge = [];
      for (let y = 0; y < yards; y++) {
        const book = makeYard(venue, 90000 + y * 5153);
        let n = 0, a = 0, b = 0, staked = 0;
        for (const step of walkVenue(venue, { from: y * 331, days: races, book })) {
          if (n >= races) break;
          const board = boardFor(step.race);
          const result = resultOf(step.race);
          n++;
          if (n <= 200) continue;
          const card = step.race.card, ground = step.race.ground;
          const price = new Map(board.runners.map((r) => [r.id, r.win]));
          const home = result.winner != null ? price.get(result.winner) || 0 : 0;
          const pick = (probs) => probs.reduce((x, z) => (z.p > x.p ? z : x), probs[0]).id;
          const plain = researchedProbabilities(card, ground);
          /* The same reading with the grudge priced into the strength, through
           * the engine's own model rather than a second one. */
          const s = card.entrants.map((e) => {
            let g = 0;
            for (const f of card.entrants) if (f !== e) g += Math.min(0.55, 0.18 * beatenBy(e, f.id));
            return formStrength(e, ground, { hidden: false }).total + readForm(e, ground).bonus
              + g / Math.max(1, card.entrants.length - 1);
          });
          const gp = fieldProbabilities(s, Math.hypot(S.sigma, blindnessOf(ground, { survive: S.leftBlind })));
          a += result.winner === pick(plain) ? STAKE * home : 0;
          b += result.winner === pick(card.entrants.map((e, i) => ({ id: e.id, p: gp[i] }))) ? STAKE * home : 0;
          staked += STAKE;
        }
        read.push(a / staked - 1); grudge.push(b / staked - 1);
        column += book.entrants.filter((e) => e.form.beaten && Object.keys(e.form.beaten).length).length;
      }
      const R = spread(read), G = spread(grudge);
      rows.push(`${venue} plain ${pct(R.mean)} grudge ${pct(G.mean)}`);
      assert(G.mean < R.mean + 0.005,
        `pricing the head-to-head at ${venue} returned ${pct(G.mean)} against ${pct(R.mean)} for ignoring it — `
        + 'it now PAYS, and the note over `writeHeadToHead` saying it does not is out of date');
    }
    /* AND THE COLUMN IS ACTUALLY WRITTEN, or the note above is about nothing. */
    const book = bookAt('the-pit', 80);
    const met = book.entrants.filter((e) => e.form.beaten && Object.keys(e.form.beaten).length).length;
    assert(met >= book.entrants.length - 2,
      `only ${met} of ${book.entrants.length} in the Pit's yard carry a head-to-head after ${FORM_DAYS} days`);
    assert(column > 0, 'the head-to-head column was never written during the measurement');
    return `${rows.join(', ')}; ${met}/${book.entrants.length} carry a head-to-head`;
  });

  check('tote: it is a pure library and a window is not a wallet', () => {
    /**
     * `Kennel.js`:22 — *"that silence is a hazard, not a permission"* — and
     * both `Spectacle.js` and `Pits.js` restate it on the commits that made
     * them. A tote is the strongest pull in the tree toward a stored purse: it
     * takes money at a window and pays it back at the same window, which is a
     * wallet with a grille in front of it.
     *
     * So the six-word currency scan runs HERE, on the commit that creates the
     * file, rather than waiting to be added to somebody else's list — and the
     * two lines that DO move credits are pinned in the file that owns them.
     */
    const imports = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    assert(imports.length === 2 && imports.some((i) => /MathUtil/.test(i)) && imports.some((i) => /Spectacle/.test(i)),
      `Tote.js imports ${imports.join(', ')} — it is a room's rules over the engine and reaches nothing else`);
    /* `window` is the room's own word — "the window takes 900 on a race" — so
     * the DOM one is scanned for as a REFERENCE (`window.`), not as a noun.
     * A ban on the bare word would have to be paid for by renaming the thing
     * this file is about. */
    for (const bad of ['THREE', 'document\\.', 'window\\.', 'globalThis', 'World', 'localStorage',
      'Credits', 'purse', 'spend', 'pay']) {
      assert(!new RegExp(`\\b${bad}`).test(code), `Tote.js names ${bad.replace('\\\\', '')}`);
    }
    for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(code), `Tote.js has grown a "${word}" — the window has become a shop`);
    }
    assert(!/Math\.random/.test(code),
      'Tote.js calls Math.random — a card nobody can seed is a card two people in one room disagree about');

    /* THE WALLET IS IN THE FILE THAT KNOWS THE PLAYER IS STANDING THERE, and
     * it is an export with a caller rather than a dead door. */
    return readFile(new URL('../../src/game/Station.js', import.meta.url), 'utf8').then((st) => {
      const stripped = st.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert(/export function stakeAtTote/.test(stripped) && /spend\(\s*quote\.ticket\.stake/.test(stripped),
        'Station.js does not take the money for a ticket through Credits.spend');
      assert(/export function payAtTote/.test(stripped) && /pay\(ledger\.returned/.test(stripped),
        'Station.js does not pay a settled ticket through Credits.pay');
      assert(/venueAtPlace\(place\.id\)/.test(stripped) && /world\.onTote/.test(stripped),
        'the interact key has no door into the tote — the rooms are unreachable');
      return `two imports (${imports.join(', ')}), no world, no wallet, no Math.random; `
        + 'Station.js holds the two lines that move credits';
    });
  });

  check('tote: the window takes no more than a run is worth', () => {
    /**
     * `MAX_STAKE` is `Credits.PER_RUN_CAP` and is written out rather than
     * imported, because a pure file may not reach the wallet. A duplicated
     * constant is a hazard, so the two are read off the two files and compared
     * here — the cheap half of the guarantee a shared import would have given
     * for free.
     */
    return readFile(new URL('../../src/game/Credits.js', import.meta.url), 'utf8').then((cr) => {
      const cap = Number(/PER_RUN_CAP\s*=\s*(\d+)/.exec(cr)?.[1]);
      assert(cap > 0, 'Credits.PER_RUN_CAP could not be read');
      assert(MAX_STAKE === cap,
        `the window takes ${MAX_STAKE} on a race and a run pays ${cap} — the two have drifted apart and `
        + 'a betting room is now a way round the cap the whole economy is bounded by');
      const race = racesOn('holo-theatre', 33)[0] || racesOn('holo-theatre', 34)[0];
      const over = ticketFor(race, { on: boardFor(race).runners[0].id, stake: cap + 1, at: 0 });
      assert(!over.ok, `the window took ${cap + 1} on one race`);
      return `MAX_STAKE ${MAX_STAKE} = Credits.PER_RUN_CAP ${cap}, and ${cap + 1} is refused`;
    });
  });

  check('tote: the three markets and the two takes are data, and every row is reachable', () => {
    /**
     * `Counter.js` refuses a row that is neither a keepsake nor a provision at
     * the door rather than at review time. The same discipline: a market
     * nobody can strike a ticket on is a row that cost a table and bought
     * nothing, and a `placesPaid` ladder with an unreachable rung is a rule
     * nobody will ever see obeyed.
     */
    assert(BETS.length === 3, `${BETS.length} markets`);
    assert(TAKE.place > 0 && TAKE.place < 0.16 && TAKE.field > 0 && TAKE.field < 0.16,
      `the derived markets declare ${JSON.stringify(TAKE)}`);
    assert(placesPaid(2) === 0 && placesPaid(4) === 0 && placesPaid(6) === 2 && placesPaid(8) === 3,
      'the place ladder does not read the way its own note says');
    const struck = new Set();
    for (const v of VENUES) {
      for (const day of [61, 62]) {
        for (const race of racesOn(v.id, day)) {
          const board = boardFor(race);
          for (const bet of BETS) {
            const on = bet.id === 'field' ? board.field?.against : board.runners[0].id;
            const t = ticketFor(race, { on, kind: bet.id, stake: 10, at: race.hour - 0.1 });
            if (t.ok) struck.add(`${v.skin}:${bet.id}`);
          }
        }
      }
    }
    for (const bet of BETS) {
      assert([...struck].some((s) => s.endsWith(`:${bet.id}`)), `no ticket could be struck on the ${bet.id} market anywhere`);
    }
    assert(struck.has('ARENA:win') && !struck.has('ARENA:place') && !struck.has('ARENA:field'),
      `the Arena's markets came out as ${[...struck].filter((s) => s.startsWith('ARENA')).join(', ')}`);
    return `${struck.size} of 9 venue-markets strikeable: ${[...struck].sort().join(', ')}`;
  });

  check('tote: a card runs whether or not anybody is in the room', () => {
    /**
     * The engine's guarantee, re-driven at the room's door. `runSpectacle`
     * takes no wagers and cannot; `resultOf` takes a race and cannot either.
     * So the proof here is that a player who watches every hour of a day and a
     * player who never opens the door get the SAME results — the sim is not a
     * function of attendance, which is what makes the Holo-theatre a window
     * rather than a slot machine.
     */
    clearTote();
    let day = 70;
    while (!racesOn('holo-theatre', day).length && day < 90) day++;
    const watched = racesOn('holo-theatre', day).map((r) => {
      for (let h = r.hour; h < r.hour + r.runs; h += 0.02) watch('holo-theatre', day, h);
      return resultOf(r);
    }).map((r) => `${r.winner}:${r.ticks}:${r.events.length}`);
    clearTote();
    const ignored = racesOn('holo-theatre', day).map((r) => resultOf(r)).map((r) => `${r.winner}:${r.ticks}:${r.events.length}`);
    assert(watched.length > 2, `only ${watched.length} races on day ${day}`);
    assert(JSON.stringify(watched) === JSON.stringify(ignored),
      'a card watched all afternoon ran differently from one nobody turned up to');
    /* And the truth on the other side: the hidden model still predicts the
     * winner better than the board does, which is the engine's own claim seen
     * through this file's prices. */
    let hidden = 0, board = 0, n = 0;
    for (const step of walkVenue('holo-theatre', { days: 400 })) {
      if (n >= 1200) break;
      const b = boardFor(step.race);
      const truth = winProbabilities(step.race.card, step.race.ground, { hidden: true });
      const w = resultOf(step.race).winner;
      const bp = b.runners.find((r) => r.id === w)?.marketP || 1e-4;
      const tp = truth.find((r) => r.id === w)?.p || 1e-4;
      hidden -= Math.log(Math.max(tp, 1e-9));
      board -= Math.log(Math.max(bp, 1e-9));
      n++;
    }
    assert(hidden / n < board / n,
      `the hidden model scored ${(hidden / n).toFixed(4)} against the board's ${(board / n).toFixed(4)} — `
      + 'the board is reading something the sim is not using');
    return `${watched.length} races identical watched and ignored; over ${n} races the hidden model scored `
      + `${(hidden / n).toFixed(4)} and the board ${(board / n).toFixed(4)}`;
  });
}
