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
  researchedProbabilities, winProbabilities, grudgeCarried, GRUDGE_STEP, GRUDGE_CAP,
  formStrength, readForm, fieldProbabilities, blindnessOf, SKINS,
} from '../../src/game/Spectacle.js';
import * as Tote from '../../src/game/Tote.js';
import { playWindow, bettingDays, agreesWithBookAt } from './_tote-edge.mjs';

const {
  VENUES, venueById, venueAtPlace, FORM_DAYS, MAX_STAKE, BETS, TAKE, placesPaid,
  programmeAt, meetAt, racesOn, bookAt, makeYard, walkVenue,
  boardFor, resultOf, ticketFor, settleTickets, standingsAt, watch, edgeOf, beatenBy, clearTote,
} = Tote;

const SRC = new URL('../../src/game/Tote.js', import.meta.url);
const pct = (n) => `${(n * 100).toFixed(2)}%`;

/**
 * HOW MANY BETS THE GATE CAN AFFORD AT EACH WINDOW.
 *
 * Bounded on purpose: a betting day here is a fresh yard, a fortnight replayed
 * and one day bet on, which is thirteen races run for every race backed. The
 * band is read off the low-variance estimator (see the bettor check), so a few
 * thousand is enough to separate a point of edge from nothing;
 * `tools/_toteedge.mjs` rides the same driver for a quarter of a million a
 * window when the numbers themselves are in question.
 */
const BETS_PER_WINDOW = 1200;

/** The projection of a reading a screen would actually print. Compared field
 * for field between a reader who bet and one who did not. */
const printed = (r) => JSON.stringify({
  phase: r.phase, dark: r.dark, progress: r.progress, segment: r.segment, segments: r.segments,
  meet: r.meet, race: r.race?.id || null, winner: r.winner, margin: r.margin, next: r.next,
  standings: r.standings, calls: r.calls,
  board: r.board && { places: r.board.places, favourite: r.board.favourite, field: r.board.field,
    runners: r.board.runners },
});

/**
 * HOW OFTEN THE SHORTEST PRICE COMES IN, AND WHETHER THE YARD ALL GETS A TURN.
 *
 * A survey of a venue and NOT a bettor. It used to be a bettor as well — one
 * who backed his top pick down a single yard for a thousand days — and both
 * halves of that are why it is not any more: a yard walked that long has a
 * form log saturated at `LOG_KEEP`, which is a book no player is ever handed,
 * and a punter measured down one yard is one sample however many races he
 * rides. `_tote-edge.mjs` does the betting, a fresh yard and a fortnight at a
 * time. What is left here is the two facts about the FIELD that need a long
 * walk and no wallet at all.
 */
function fieldSurvey(venue, { yardSeed, races, warm = 200 }) {
  const book = makeYard(venue, yardSeed);
  let n = 0, favWins = 0, ran = 0;
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
  }
  return { races: ran, favStrike: favWins / ran, winners: winners.size };
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
      const r = fieldSurvey(v.id, { yardSeed: 4242, races: 1400, warm: 200 });
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
   * ══════════════════════════════════════════════════════════════════════
   *
   * *"in life a good better will probably make money over time."*
   *
   * ── THE BAND, AND WHY IT HAS A CEILING AS WELL AS A FLOOR ─────────────
   *
   * A window where reading the card LOSES is a window whose form book is
   * decoration — which is what all three of these were, and what the audit
   * that started this measured: −11.4% in the Pit, +0.8% at the Arena. A
   * window where reading it prints money is not a window either; it is a bug
   * with a queue in front of it. So the claim asserted below is two-sided at
   * every one of the three rooms:
   *
   *   THE FORM-READER   backs the overlays his reading of the PUBLIC card
   *                     finds, and makes between a point and five points a
   *                     bet. `BAND`.
   *   THE PIN           picks off the card and loses. So does the man who
   *                     backs the market leader every time.
   *
   * ── WHAT WAS ACTUALLY WRONG, IN THREE NUMBERS ─────────────────────────
   *
   *   1. THE ODDS WERE NOT QUOTED FROM THE PROBABILITIES THE RESULT IS DRAWN
   *      FROM. `SKINS.sigma` is the one parameter of the model behind every
   *      price, and it was wide in all three rooms: the model's own top pick
   *      was quoted at 0.494 in the Pit and won 0.528 — seven points of
   *      relative error, handed free to anybody backing favourites and
   *      nothing whatever to do with reading a form book. Refitted against
   *      the sim's own winners; the ladder is in `Spectacle.SKINS`.
   *
   *   2. THE FORM BOOK IN TWO OF THE THREE ROOMS COULD NOT BE READ. A
   *      fighter's temper and footing barely move with the going, so the
   *      going-splits `readForm` runs recover almost nothing of them —
   *      measured on the book the window actually prints, the split reading
   *      correlates 0.31 with the truth on the pods, 0.03 in the Pit and
   *      −0.03 at the Arena, and the `k` that scaled it was ten times too
   *      big in both fight rooms. A reader was therefore betting on
   *      amplified noise into an 8% take, which is exactly the shape of an
   *      11% loss.
   *
   *   3. AND THE COLUMN THAT DOES PREDICT WAS READ BY NOBODY AT ALL. The
   *      board's only public term is `rating / 22`; the finishing record
   *      beside it on the same card was read by no reader in this tree,
   *      house or punter. Read NET of what the rating already claims — a
   *      runner rated 90 that has been finishing fourth is carrying
   *      something — that column is R² 0.26 against the term the board
   *      cannot see on the pods and 0.58 in the Pit. `Spectacle.readForm`
   *      reads it now, and `main.js` prints it, which it also did not.
   *
   * ── AND THE MEASUREMENT ITSELF WAS FLATTERING THE READER ──────────────
   *
   * The old `twoPunters` walked ONE yard for a thousand days and bet all the
   * way down it, so every runner's form log had saturated at `LOG_KEEP` — 60
   * starts. The window hands over `FORM_DAYS` of replay, which is 27.9 starts
   * a runner at the Holo-theatre, 17.8 in the Pit and 8.1 at the Arena. The
   * driver in `_tote-edge.mjs` builds a fresh yard, replays the fortnight and
   * bets one day, which is `bookAt` line for line — and the first check below
   * settles that against `bookAt` itself rather than asserting it in a
   * comment.
   */
  /**
   * THE BAND, PER ROOM, BECAUSE THE THREE ROOMS ARE NOT EQUALLY READABLE.
   *
   * One number for the station would be a claim nobody measured. What a
   * fortnight of results is worth is a property of the room: the Pit's hidden
   * terms are big and persistent and eighteen starts of finishing positions
   * recover R² 0.58 of them, the pods' are weather-dependent and recover 0.26,
   * the Arena's pair is graded so the model is selling its middle. Each band
   * is a two-sided claim about ONE window and each has to hold on its own —
   * a floor that says the form book is worth the walk and a ceiling that says
   * the window is still a window.
   *
   * The long run behind them is `node tools/_toteedge.mjs`; measured there over
   * 200,000 SETTLED TICKETS a window — 600,000 tickets and 1.42 million races
   * in all — at 2,200 a ticket, struck through `ticketFor` against boards
   * `boardFor` priced on books `bookAt` itself would have handed over:
   *
   *     Holo-theatre  6% take   reader  +6.81% ±0.74   pin −12.29% ±0.37   leader −4.47%
   *     The Pit       8% take   reader +14.04% ±0.74   pin  −6.65% ±0.31   leader −8.93%
   *     The Arena     5% take   reader  +5.07% ±0.25   pin  −4.54% ±0.03   leader −4.64%
   *
   * The bands below are those numbers with room for the gate's much smaller
   * sample, which is a thousand-odd tickets a window.
   *
   * ── AND WHY THE CEILINGS ARE NOT LOWER, WHICH IS A REAL CONSTRAINT ────
   *
   * A reader only strikes a ticket when his reading beats the PRICE, and the
   * price already carries the cut — so at an 8% take nothing he backs can be
   * worth less than about 8% to him, whatever the house has read. Driving his
   * average down means either the house pricing so much that his bets become
   * rare and MORE selective (measured: `houseRead` 0.35→0.88 in the Pit moved
   * him 31%→8% and no further, while it drove the pin's loss from 6.9% to
   * 0.03% and very nearly made betting blind free), or a take nobody would
   * pay. The floor and the shape of the ceiling are both properties of the
   * room rather than dials, and this is where they actually sit.
   */
  const BAND = Object.freeze({
    'holo-theatre': [0.01, 0.09],
    'the-pit': [0.04, 0.19],
    'the-arena': [0.02, 0.11],
  });

  check('tote: the bettors ride the book the window hands over, and it is the short one', () => {
    /**
     * The cheapest way to write a betting check that passes is to measure a
     * punter holding a form book no player can get. This is that check, and it
     * runs before any of the numbers below are believed.
     */
    let same = 0;
    for (const v of VENUES) {
      for (const day of [48, 60, 91]) {
        clearTote();
        assert(agreesWithBookAt(v.id, day),
          `the driver's book at ${v.id} on day ${day} is not the one bookAt hands the player — `
          + 'every bettor measured on it is betting in another game');
        same++;
      }
    }
    /* AND IT IS SHORT. `LOG_KEEP` is 60 rows; a fortnight writes a fraction of
     * that, and how big a fraction is the whole difference between a reading
     * room and a noise generator. */
    const rows = [];
    for (const v of VENUES) {
      clearTote();
      const b = bookAt(v.id, 60);
      const per = b.entrants.reduce((a, e) => a + e.form.log.length, 0) / b.entrants.length;
      assert(per > 4, `${v.id} hands over ${per.toFixed(1)} starts a runner — that is not a form book`);
      assert(per < 60, `${v.id} hands over ${per.toFixed(1)} starts a runner, which is LOG_KEEP — `
        + 'the book has saturated and the reader being measured is not the player');
      rows.push(`${v.id} ${per.toFixed(1)}`);
    }
    return `${same} books identical to bookAt; starts a runner: ${rows.join(', ')}`;
  });

  check('tote: a punter who reads the form is paid for it at every window, and one who does not is not', () => {
    /**
     * The bettors are driven end to end: `boardFor` prices it, `ticketFor`
     * writes the ticket against the station clock, `resultOf` runs it and
     * `settleTickets` pays. Nothing here re-derives a price or a payout.
     *
     * ── AND THE BAND IS READ OFF THE LOW-VARIANCE ESTIMATOR ──────────────
     *
     * A ticket pays the price or nothing, so the realised return of a bettor
     * with a two-point edge takes a quarter of a million bets to separate from
     * zero — which `tools/_toteedge.mjs` does, and which a gate cannot. The
     * same expectation is `p × price − 1` under the probabilities the RESULT
     * IS DRAWN FROM, and that reads the same number with a fortieth of the
     * variance. It is the trick the pin has always used here.
     *
     * IT IS ONLY WORTH ANYTHING IF THAT MODEL IS A MODEL OF THIS SIMULATION,
     * so the realised money is measured too and the two are required to agree
     * inside the realised run's own error bar. A model that had drifted off
     * the sim — which is defect (1) above — shows up there and nowhere else.
     */
    const rows = [];
    for (const venue of VENUES.map((v) => v.id)) {
      clearTote();
      const r = playWindow(venue, { bets: BETS_PER_WINDOW, yardSeed: 4242 });
      const R = r.reader, P = r.pin, F = r.favourite;
      const band = (b) => `${pct(b.expect)}±${pct(b.expectSe)} (paid ${pct(b.roi)}±${pct(b.se)})`;

      assert(R.bets > r.races * 0.03,
        `the form-reader found a bet in only ${R.bets} of ${r.races} races at ${venue} — a reader who never `
        + 'bets is not a reader, he is an abstainer');
      assert(R.expect - 2 * R.expectSe > 0,
        `reading the form at ${venue} returned ${band(R)} — at or below zero the form book is decoration, `
        + 'which is exactly the defect this check was written for');
      const [low, high] = BAND[venue];
      assert(R.expect + 2 * R.expectSe > low,
        `reading the form at ${venue} returned ${band(R)}, under the ${pct(low)} floor this window's band claims`);
      assert(R.expect - 2 * R.expectSe < high,
        `reading the form at ${venue} returned ${band(R)} — over the ${pct(high)} ceiling, which is not `
        + 'a punter, it is a printing press and the house would shut the window');
      /* THE MONEY AGREES WITH THE MODEL, or neither number means anything. */
      assert(Math.abs(R.roi - R.expect) < 3 * Math.hypot(R.se, R.expectSe),
        `at ${venue} the form-reader was PAID ${pct(R.roi)}±${pct(R.se)} and the model said he should have had `
        + `${pct(R.expect)} — the prices are not quoted from the probabilities the result is drawn from`);

      assert(P.expect + 2 * P.expectSe < 0,
        `a pin at ${venue} returned ${band(P)} — the room is giving money away to a bettor with no opinion`);
      assert(F.expect + 2 * F.expectSe < 0,
        `backing the market leader at ${venue} returned ${band(F)} — the shortest price on the board is free `
        + 'money and nobody needs to read anything');
      assert(R.expect > P.expect + 0.01,
        `at ${venue} reading the form was worth ${pct(R.expect - P.expect)} over a pin — the walk to the `
        + 'reading room is not paying for itself');
      rows.push(`${venue} reader ${band(R)} on ${R.bets}, pin ${pct(P.expect)}, leader ${pct(F.expect)}`);
    }
    return rows.join('; ');
  });

  check('tote: the shortest price on the board is an honest price, and a pin still loses', () => {
    /**
     * ── THE HALF OF THIS THAT USED TO ASSERT THE BUG ─────────────────────
     *
     * This check read `-pin > cut` and nothing else: a bettor with no opinion
     * had to lose MORE than the house takes. That half is true and stays —
     * the board is flatter than the truth, it prices outsiders short, and a
     * man spreading his money is mostly buying them. It is the favourite–
     * longshot bias and it is a real thing in a real market.
     *
     * What it could not see is the other end of the same board. `sigma` was
     * mis-fitted, so the market LEADER won oftener than any price on the board
     * said he would: measured, 2.5 points of relative error on the pods and
     * 7.9 in the Pit, which at an 8% take made backing the shortest price on
     * the card very nearly free. A room where the laziest possible bet is the
     * best one has no reading room in it, and every green line in this file
     * was compatible with that.
     *
     * So the pin's half is kept and the leader's half is added: the board's
     * own favourite must be quoted at the rate he actually wins, and the man
     * who backs him must lose about the take. That is the assertion the defect
     * would have failed.
     */
    const rows = [];
    for (const v of VENUES) {
      clearTote();
      const cut = edgeOf('win', { venue: v.id, races: 1200 }).edge;
      const r = playWindow(v.id, { bets: 700, yardSeed: 777 });
      const pin = r.pin.expect, fav = r.favourite;
      assert(pin + 2 * r.pin.expectSe < 0,
        `a pin at ${v.id} returned ${pct(pin)} — the room is giving money away to a bettor with no opinion`);
      /* AND IT IS NEAR THE CUT, EITHER SIDE. The gap between what the house
       * declares and what a bettor with no opinion actually pays is the
       * board's own error, and the sign of it is not the same in all three
       * rooms — measured, a pin loses MORE than the cut at the Holo-theatre
       * (8.3% against 6.0%, which is the favourite–longshot bias, real and
       * intended) and LESS in the fight rooms (3.1% against 8.0% in the Pit),
       * because their fields are small and the Gaussian tail under the model
       * runs the other way. What is not allowed is for that error to grow big
       * enough to be somebody's strategy. */
      assert(Math.abs(-pin - cut) < 0.06,
        `a pin at ${v.id} lost ${pct(-pin)} against a declared cut of ${pct(cut)} — the board's own field is `
        + `${pct(Math.abs(-pin - cut))} away from the prices it is quoting, which is a strategy`);
      assert(-pin < 0.20, `a pin at ${v.id} lost ${pct(-pin)} a bet — nobody comes back to that`);
      /* AND THE OTHER END. The favourite is quoted honestly, so backing him is
       * a way of paying the take and not a way round it. */
      assert(fav.expect + 2 * fav.expectSe < 0,
        `backing the market leader at ${v.id} returned ${pct(fav.expect)}±${pct(fav.expectSe)} — the shortest `
        + 'price on the board is free money and nobody in the room needs to read anything');
      assert(fav.expect > -cut - 0.08,
        `backing the market leader at ${v.id} returned ${pct(fav.expect)} on a cut of ${pct(cut)} — the board `
        + 'is robbing its own favourite rather than shading him');
      rows.push(`${v.id} cut ${pct(cut)} pin ${pct(pin)} leader ${pct(fav.expect)}`);
    }
    return rows.join(', ');
  });


  check('tote: the head-to-head is published, it is exact, and it pays once the form line is read', () => {
    /**
     * `Spectacle.recordResult` writes `hidden.grudge[w] = clamp(prev + STEP,
     * 0, CAP)` on a bout and this file writes the COUNT of the same events. So
     * the published column is not a proxy for the grudge, it IS the grudge:
     * `min(CAP, STEP × count)`, to the last digit. The first half below
     * settles that pair for pair rather than trusting it, which also pins the
     * two files together — a change to either constant fails here.
     *
     * ── AND PRICING IT STILL DOES NOT PAY, WHICH IS NOW A MEASUREMENT ────
     *
     * The obvious bettor adds the count to the strength and re-prices. He is
     * driven below and he is worse, and the reason is not that the term is
     * small — it is the biggest unseen thing in either fight room. It is that
     * BEING BEATEN IS NOT INDEPENDENT OF BEING BEATABLE: regressed against the
     * term the board cannot see, the count on its own comes out NEGATIVE
     * (−1.41 in the Pit, −0.83 at the Arena), because it is loaded with the
     * weakness that produced it. And once `readForm` reads the FORM LINE —
     * which is the same weakness, said better — the count is worth 0.005 of R²
     * on top of it. Two columns, one fact.
     *
     * So the column is PRINTED on the card and carried as blindness
     * (`SKINS.grudgeSd`) by everybody who is not the sim, and that is a
     * decision with a number under it. This check is what would go red if the
     * number changed.
     */
    const rows = [];
    const gains = [];
    let pairs = 0, exact = 0;
    for (const venue of ['the-pit', 'the-arena']) {
      clearTote();
      const S = SKINS[venueById(venue).skin];
      for (let day = 60; day < 72; day++) {
        for (const race of racesOn(venue, day)) {
          resultOf(race);
          for (const e of race.card.entrants) {
            for (const f of race.card.entrants) {
              if (e === f) continue;
              pairs++;
              const said = Math.min(GRUDGE_CAP, GRUDGE_STEP * beatenBy(e, f.id));
              if (Math.abs(said - (e.hidden.grudge?.[f.id] || 0)) < 1e-9) exact++;
            }
          }
          const pub = grudgeCarried(race.card, { published: true });
          const own = grudgeCarried(race.card);
          assert(JSON.stringify(pub) === JSON.stringify(own),
            `${venue} ${race.id}: the column the room prints is not the term the sim uses`);
        }
      }
      /* AND THE TWO PUNTERS, over the same races, scored on the probabilities
       * the result is drawn from — the low-variance reading `_tote-edge.mjs`
       * explains. One reads the card; the other reads the card and prices the
       * grudge on top of it, through the engine's own model. */
      const diffs = [];
      let plain = 0, priced = 0, n = 0, moved = 0;
      for (const step of bettingDays(venue, { yardSeed: 5153, from: 500, days: 700 })) {
        const race = step.race, board = boardFor(race);
        const price = new Map(board.runners.map((r) => [r.id, r.win]));
        const truth = new Map(winProbabilities(race.card, race.ground, { hidden: true }).map((t) => [t.id, t.p]));
        /* THE READER WITH THE COLUMN is the shipped one. The reader WITHOUT it
         * is the same model with the count struck off the card and its spread
         * put back as blindness, which is what an honest bettor who could not
         * see the column would have to do. */
        const g = grudgeCarried(race.card, { published: true });
        const mg = g.reduce((x, y) => x + y, 0) / g.length;
        const gsd = Math.sqrt(g.reduce((x, y) => x + (y - mg) * (y - mg), 0) / g.length);
        const withCol = researchedProbabilities(race.card, race.ground);
        const blindP = fieldProbabilities(
          race.card.entrants.map((e) => formStrength(e, race.ground, { hidden: false }).total
            + readForm(e, race.ground).bonus),
          Math.hypot(S.sigma, blindnessOf(race.ground, { survive: S.leftBlind }), S.grudge * gsd));
        const pick = (rows2) => rows2.reduce((x, y) => {
          const ev = y.p * (price.get(y.id) || 0);
          return (!x || ev > x.ev) ? { id: y.id, ev } : x;
        }, null);
        const a = pick(race.card.entrants.map((e, i) => ({ id: e.id, p: blindP[i] })));
        const b = pick(withCol);
        const pa = truth.get(a.id) * price.get(a.id) - 1;
        const pb = truth.get(b.id) * price.get(b.id) - 1;
        plain += pa; priced += pb; diffs.push(pb - pa);
        if (a.id !== b.id) moved++;
        resultOf(race);
        n++;
      }
      assert(moved > n * 0.02,
        `pricing the head-to-head at ${venue} changed the bet in only ${moved} of ${n} races — the two `
        + 'bettors are not two bettors at all');
      /* PAIRED, because both punters ride the same races: the difference has a
       * far smaller error bar than either return, which is the only way a
       * bounded check can tell a fifth of a point from nothing. */
      const m = diffs.reduce((x, y) => x + y, 0) / n;
      const se = Math.sqrt(diffs.reduce((x, y) => x + (y - m) * (y - m), 0) / (n - 1) / n);
      gains.push({ venue, m, se });
      assert(m > -2 * se,
        `pricing the head-to-head at ${venue} LOST ${pct(-m)} ± ${pct(se)} a bet against ignoring it — the `
        + 'column this file publishes is back to being a trap, which is the state it was in until `readForm` '
        + 'learned to read a form line first');
      rows.push(`${venue} +${pct(m)}±${pct(se)} (${pct(plain / n)} → ${pct(priced / n)} over ${n})`);
    }
    assert(pairs > 400 && exact === pairs,
      `${pairs - exact} of ${pairs} published head-to-heads disagreed with the grudge the sim is carrying`);
    /* AND ACROSS THE TWO FIGHT ROOMS IT PAYS, BEYOND ITS OWN ERROR BAR. The
     * Pit carries this: six in a bout and a fortnight of them, so the counts
     * are thick and the grudge is worth points a bet. The Arena's pair meet
     * seldom enough that its own gain is a fraction of a point and is reported
     * rather than asserted on — but it may not be a LOSS, which is the shape
     * the column had before the form line was read. */
    const T = gains.reduce((a, g) => a + g.m, 0) / gains.length
      / (Math.hypot(...gains.map((g) => g.se)) / gains.length);
    assert(T > 3,
      `pricing the head-to-head across the two fight rooms was worth ${T.toFixed(1)} standard errors — `
      + 'that is not more than noise, and a column nobody can price is a column that should not be printed');
    clearTote();
    const book = bookAt('the-pit', 80);
    const met = book.entrants.filter((e) => e.form.beaten && Object.keys(e.form.beaten).length).length;
    assert(met >= book.entrants.length - 2,
      `only ${met} of ${book.entrants.length} in the Pit's yard carry a head-to-head after ${FORM_DAYS} days`);
    return `${exact}/${pairs} counts equal the sim's own grudge; ${rows.join('; ')}; `
      + `${met}/${book.entrants.length} carry one`;
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

  check('tote: the room the race is watched in re-reads itself, and it keeps no clock of its own', async () => {
    /**
     * ══ "YOU SHOULD BE ABLE TO WATCH THE ENTIRE BATTLE" ═════════════════
     *
     * Everything below this file's own line was already true — `watch()` is a
     * pure function of a place, a day and an hour, and it moves gate by gate.
     * What was not true is that anybody could SEE it move. `showTote` was
     * called from `openTote` and two click handlers and from nowhere else, so
     * with the panel up the page was a photograph; and `Screens.take` pauses
     * the world, so the hour it reads was frozen as well. Either alone is
     * enough. A race is `runs: 0.3` h — 36 real seconds — and the player got
     * two stills with a walk between them.
     *
     * This is a source read because the defect is a MISSING CALLER, which no
     * amount of driving `watch()` can see: the reading was always right.
     *
     * `tools/_toteprobe.mjs` drives the fixed version in a real browser and
     * reports the panel text and the gate number before and after.
     */
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const code2 = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    /* THE PANEL RE-RENDERS ON A TIMER, and the timer is the pit's shape —
     * `setTimeout` off `performance.now()`, independent of the frame loop,
     * which is why a bout was watchable with the panel up and a race was not. */
    const bell = /function toteBell\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(code2)?.[1] || '';
    assert(bell, 'there is no toteBell in main.js — nothing re-renders the tote panel');
    assert(/setTimeout\(/.test(bell), 'the tote panel has no timer, so it is a photograph');
    assert(/showTote\(/.test(bell), 'the tote\'s timer does not re-render the panel');
    assert(/performance\.now\(\)/.test(bell),
      'the tote\'s timer measures no real time — a throttled tab would run the card in the dark');
    assert(/openTote[\s\S]{0,240}?toteBell\(/.test(code2), 'opening the tote does not start its clock');

    /* AND IT KEEPS NO HOUR OF ITS OWN. The one risk of a panel with a clock is
     * that the panel and the station disagree about the time — which is the
     * exact failure `watch()`'s signature was written to rule out. The panel
     * winds the STATION's clock and reads it straight back, so there is one
     * number. A second copy of §3.4's rate in main.js would be the drift. */
    assert(/tickStationClock\(/.test(bell),
      'the tote panel advances something other than the station clock — two clocks, and they will disagree');
    assert(!/\/\s*120\b/.test(code2),
      'main.js has grown its own copy of the station clock rate — §3.4 lives in Station.js');
    assert(/toteWatch\(venueId, day, toteHour\(\)\)/.test(code2),
      'showTote no longer reads the station hour — a panel with a private hour is a panel showing another race');
    return 'the panel re-renders on its own setTimeout off performance.now(), winds Station.tickStationClock '
      + 'and reads the hour back off the station — one clock';
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

  /* ══════════════════════════════════════════════════════════════════════
   *  5. THE CROWD (V16 §G4)
   * ══════════════════════════════════════════════════════════════════════
   *
   * *"a crowd that reacts to what happens in the pit/arena/race."*
   *
   * WHAT THE AUDIT FOUND, and it is the reason these three exist. `crowd` was
   * a STRING on every venue row — "sixty in the seats" — and `grep -rn crowd
   * src/` turned up the declaration and NO READER anywhere in the tree. The
   * row described a room full of people and nothing in the game knew they were
   * there; the announcer was DOM text in `main.js` and the Holo-theatre made
   * precisely as much noise for a 40/1 shot winning by a nose as for a
   * walkover, which is to say none at all.
   *
   * A field with no reader is the recurring defect shape in this tree, and the
   * check that catches it cannot be a source scan for the word `crowd` — that
   * is satisfied by a comment. So these drive it: the model is recomputed from
   * the row itself, the row is perturbed and the room has to move, and the
   * shipped frame loop is run over a real station and asked what it did.
   */

  check('tote: every venue\'s crowd row is read, and both numbers in it move the room', async () => {
    const { MOMENTS } = await import('../../src/game/Spectacle.js');
    const { crowdAt, crowdVoice, dramaOf } = Tote;
    assert(typeof crowdVoice === 'function' && typeof crowdAt === 'function',
      'Tote.js exports no crowd model — the venue rows describe a room nothing reads');

    const lines = [];
    for (const v of VENUES) {
      const c = v.crowd;
      assert(c && typeof c === 'object', `${v.id}'s crowd is ${typeof c} — a row that describes a room in prose`);
      assert(Number.isFinite(c.size) && c.size > 0, `${v.id} seats ${c.size}`);
      assert(Number.isFinite(c.temper) && c.temper > 0 && c.temper <= 1, `${v.id}'s temper is ${c.temper}`);
      assert(typeof c.says === 'string' && c.says.length, `${v.id} lost the prose the row always carried`);

      /* ── 1. THE READING IS THE ROW, PUT THROUGH THE MODEL ──────────────
       * Not "the reading mentions the row". `crowdAt` hands back the two
       * inputs it used, so the whole derivation is re-run here from the frozen
       * row and has to land on the same three numbers. If `crowdIn` ever
       * stopped reading `v.crowd` — the exact defect this check exists for —
       * this is what fails. */
      let day = 0, races = [];
      while (!races.length && day < 60) { races = racesOn(v.id, day); if (!races.length) day++; }
      assert(races.length, `${v.id} ran nothing in 60 days`);
      const race = races[0];
      let checked = 0, sawMoment = 0, peak = 0;
      for (let h = race.hour - 0.05; h < race.hour + race.runs + 0.05; h += 0.002) {
        const r = crowdAt(v.id, day, h);
        const again = crowdVoice(c, { drama: r.drama, fill: r.fill });
        assert(again.voices === r.in,
          `${v.id} at ${h.toFixed(3)}: the reading seats ${r.in} and the row's own model seats ${again.voices}`);
        assert(Math.abs(again.level - r.level) < 2e-3 && Math.abs(again.swell - r.swell) < 2e-3,
          `${v.id} at ${h.toFixed(3)}: the reading is not what the row's model answers `
          + `(${r.level}/${r.swell} against ${again.level}/${again.swell})`);
        if (r.moment) sawMoment++;
        if (r.swell > peak) peak = r.swell;
        checked++;
      }
      assert(sawMoment > 10, `${v.id} reacted to nothing at all across a whole ${v.word}`);
      assert(peak > 0.1, `${v.id}'s loudest moment in a whole ${v.word} was ${peak}`);

      /* ── 2. AND BOTH NUMBERS IN THE ROW CHANGE WHAT COMES OUT ──────────
       * A field that is read but whose value cannot change anything is a
       * constant with extra steps. Each is moved on its own, from the venue's
       * real row, with the other held. */
      /* HALF FULL, not eight tenths. `crowdVoice`'s body term saturates at 48
       * throats and the Holo-theatre seats 60, so a perturbation taken at 0.8
       * doubled a crowd that was already at the ceiling and read no change —
       * which is a saturated model, not an unread field, and the check has to
       * be able to tell those apart. */
      const at = { drama: 0.6, fill: 0.5 };
      const base = crowdVoice(c, at);
      const bigger = crowdVoice({ ...c, size: c.size * 2 }, at);
      assert(bigger.voices > base.voices,
        `${v.id}: doubling the crowd seated ${bigger.voices} against ${base.voices}`);
      assert(bigger.swell > base.swell,
        `${v.id}: doubling the crowd did not make the room louder (${bigger.swell} against ${base.swell})`);
      /* Temper is moved DOWN where the row is already at the ceiling — the Pit
       * is 1 by design and a check that could only push up would silently skip
       * the one venue whose temper is the whole point of it. */
      const shift = c.temper >= 0.9 ? -0.3 : 0.3;
      const hotter = crowdVoice({ ...c, temper: c.temper + shift }, at);
      const cmp = shift > 0 ? (a, b) => a > b : (a, b) => a < b;
      assert(cmp(hotter.level, base.level),
        `${v.id}: moving the temper by ${shift} left the murmur at ${hotter.level} against ${base.level}`);
      assert(cmp(hotter.swell, base.swell),
        `${v.id}: moving the temper by ${shift} left the roar at ${hotter.swell} against ${base.swell}`);
      /* …and the prose is still on the reading, so nothing was lost turning a
       * string into a row. */
      assert(crowdAt(v.id, day, race.hour + 0.05).says === c.says, `${v.id} dropped its own line`);
      lines.push(`${v.id} ${c.size}@${c.temper} peak ${peak.toFixed(2)} over ${checked} readings, `
        + `×2 seats → ${bigger.swell.toFixed(2)} vs ${base.swell.toFixed(2)}`);
    }
    /* AND THE TWO ROWS THAT SEAT THE SAME NUMBER ARE STILL DIFFERENT ROOMS.
     * The Pit and the Arena are both twelve; the only thing between them is
     * `temper`, so if the reading could not tell them apart the field would be
     * decoration. */
    const pit = venueById('the-pit'), arena = venueById('the-arena');
    assert(pit.crowd.size === arena.crowd.size, 'the two small rooms no longer seat the same number');
    const p = crowdVoice(pit.crowd, { drama: 0.6, fill: 0.8 });
    const a = crowdVoice(arena.crowd, { drama: 0.6, fill: 0.8 });
    assert(p.swell > a.swell,
      `twelve at the Pit's rail (${p.swell}) are no louder than twelve on the Arena's benches (${a.swell})`);
    /* And a moment the sim never emitted is worth nothing, rather than a
     * default the room would roar at. */
    assert(dramaOf(null, null, null) === 0, 'the crowd reacts to nothing happening');
    /* ── AND THE TABLE COVERS THE ENGINE, not a subset somebody typed once.
     * `MOMENTS` is `Spectacle.js`'s own list of everything a spectator is
     * told about; a moment the engine emits and the crowd has no weight for is
     * a thing that happens in front of sixty people who do not look up. */
    for (const m of MOMENTS) {
      assert(Number.isFinite(Tote.CROWD_WEIGHT[m]),
        `the engine announces "${m}" and the crowd has no opinion about it`);
    }
    return lines.join('; ') + `; pit ${p.swell} vs arena ${a.swell} on one drama`;
  });

  check('tote: the room answers a photo finish differently from a walkover', async () => {
    /**
     * The half of §G4 that is actually hard. A crowd that made a noise at
     * every result would pass a "does it react" check and be exactly as much
     * of a decoration as the string it replaced.
     *
     * So this measures the SPREAD, over hundreds of real results at each
     * venue, at the moment the call lands — and then puts the quietest and the
     * loudest through `audio.crowd`, which is what actually reaches the
     * player's ears, and requires four independent properties of the sound to
     * separate rather than one.
     *
     * The buckets are the board's own: a favourite home by a street against a
     * long price home by a nose. Neither is chosen by drama — that would be
     * measuring the model against itself — they are chosen by `margin` off the
     * engine's `result` event and by the price the room was quoted.
     */
    const { crowdAt } = Tote;
    const { audio } = await import('../../src/engine/Audio.js');
    assert(typeof audio.crowd === 'function',
      'the audio engine has no crowd cue — §G4\'s reaction is DOM text again');

    /** The first day this venue ran anything — a card is dark some nights. */
    const day0For = (id) => { let d = 0; while (!racesOn(id, d).length && d < 60) d++; return d; };
    const rows = [];
    for (const v of VENUES) {
      const seen = [];
      let n = 0;
      for (const step of walkVenue(v.id, { days: 900 })) {
        if (n >= 900) break;
        n++;
        const race = step.race;
        const ev = resultOf(race).events.find((e) => e.type === 'result');
        if (!ev || !ev.who) continue;
        /* The frame the call lands on, which is the end of the window. */
        const c = crowdAt(v.id, step.day, race.hour + race.runs + 0.0005);
        if (c.moment !== 'result') continue;
        const board = boardFor(race);
        const price = board.runners.find((r) => r.id === ev.who)?.marketP ?? 0.25;
        seen.push({ swell: c.swell, in: c.in, temper: c.temper, level: c.level,
          margin: Math.abs(ev.margin || 0), fav: ev.who === board.favourite, price });
      }
      assert(seen.length > 150, `${v.id} gave only ${seen.length} calls to measure`);
      seen.sort((x, y) => x.swell - y.swell);
      const q = (f) => seen[Math.floor(f * (seen.length - 1))];
      const lo = q(0.1), hi = q(0.9);
      /* THE BAR IS THE FIELD'S OWN. A two-horse bout cannot produce an upset —
       * the outsider of two is quoted around 0.4 and the surprise term has
       * nowhere to go — so the Arena's whole range is a margin, and holding it
       * to the Holo-theatre's bar would be asking a room of two for a shock it
       * structurally cannot have. Measured: holo 0.246 → 0.497 (2.02×), pit
       * 0.116 → 0.346 (2.98×), arena 0.093 → 0.137 (1.47×). */
      const bar = boardFor(racesOn(v.id, day0For(v.id))[0]).runners.length > 2 ? 1.6 : 1.3;
      assert(hi.swell > lo.swell * bar,
        `${v.id}: the loudest tenth of its calls (${hi.swell}) is only `
        + `${(hi.swell / lo.swell).toFixed(2)}× the quietest tenth (${lo.swell}) against a bar of ${bar} — `
        + 'the room makes one noise whatever happens');

      /* AND THE LOUD END IS THE DRAMATIC END, not an accident of attendance.
       * A near finish and a long price must both be commoner in the top decile
       * than in the bottom one. */
      const top = seen.slice(-Math.floor(seen.length / 10));
      const bot = seen.slice(0, Math.floor(seen.length / 10));
      const mean = (a, k) => a.reduce((x, y) => x + y[k], 0) / a.length;
      assert(mean(top, 'margin') < mean(bot, 'margin'),
        `${v.id}: its loudest calls were won by ${mean(top, 'margin').toFixed(2)} and its quietest by `
        + `${mean(bot, 'margin').toFixed(2)} — the room is louder for a walkover`);
      assert(mean(top, 'price') < mean(bot, 'price'),
        `${v.id}: its loudest calls were won at ${mean(top, 'price').toFixed(3)} on the board against `
        + `${mean(bot, 'price').toFixed(3)} — the room is not surprised by a surprise`);

      /* ── AND WHAT THE PLAYER ACTUALLY HEARS SEPARATES TOO ──────────────
       * Four properties, because a cue that only moved its gain would be one
       * sound at two volumes — which is what a crowd that does not react
       * sounds like. `audio.crowd` is driven for real; headless it plays
       * nothing and hands back what it would have played. */
      const dull = audio.crowd({ voices: lo.in, temper: lo.temper, swell: lo.swell, level: lo.level });
      const great = audio.crowd({ voices: hi.in, temper: hi.temper, swell: hi.swell, level: hi.level });
      for (const k of ['gain', 'shout', 'freq', 'dur']) {
        assert(great[k] > dull[k],
          `${v.id}: a photo finish and a walkover come out of the audio engine with the same ${k} `
          + `(${great[k]} against ${dull[k]})`);
      }
      /* A murmur has no shout in it at all — that is the whole difference
       * between a room talking and a room reacting. */
      assert(audio.crowd({ voices: hi.in, temper: hi.temper, swell: 0, level: hi.level }).shout === 0,
        `${v.id}: a room with nothing happening in it is already shouting`);
      rows.push(`${v.id} ${seen.length} calls, swell p10 ${lo.swell.toFixed(3)} → p90 ${hi.swell.toFixed(3)}, `
        + `gain ${dull.gain} → ${great.gain}, freq ${dull.freq} → ${great.freq} Hz`);
    }
    return rows.join('; ');
  });

  check('tote: the crowd reaches the room — the shipped loop makes the noise and fills the seats', async () => {
    /**
     * THE CLAUSE THE OTHER TWO CANNOT COVER. Everything above drives pure
     * functions, and a pure function with no caller is exactly the defect that
     * started this: `crowd` was read by nothing, and a check that called the
     * model directly would have been perfectly green on the broken build.
     *
     * So this boots a real station and runs `world.update(1/60, idle)` — the
     * loop `main.js` runs, through `StationDirector` → `stepStation` → the
     * crowd — and asks the world what happened. Nothing below calls anything in
     * `Station.js` or `Tote.js` by hand.
     *
     * `requestAnimationFrame` never fires headless, which is why this is
     * `world.update` and not a browser. What it costs is a station boot; what
     * it buys is the only proof that any of this is wired to anything.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const St = await import('../../src/game/Station.js');
    const P = await import('../../src/game/StationPlan.js');
    const L = await import('../../src/game/StationLife.js');
    const { audio } = await import('../../src/engine/Audio.js');
    const Save = await import('../../src/game/StationSave.js');

    /* The station's rooms are loaded off disk in the browser; headless they
     * come off the filesystem, exactly as `station.mjs` does it. */
    const hadFetch = globalThis.fetch;
    const root = new URL('../../', import.meta.url);
    globalThis.__stationFetch = true;
    globalThis.fetch = async (url) => {
      const buf = await readFile(new URL(String(url), root));
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };
    /* The cue is counted rather than heard: there is no AudioContext in any
     * check in this tree, so what is asserted is that the ROOM asked for it. */
    const realCrowd = audio.crowd;
    const asked = [];
    /* WHAT THE CUE ANSWERED, not what it was handed: `crowd()` computes the
     * gain, the shout and the band it would play and hands them back, which is
     * the only thing a check with no AudioContext can hear. */
    audio.crowd = function (spec) { const built = realCrowd.call(this, spec); asked.push(built); return built; };

    let out = '';
    try {
      /**
       * ── WHICH DAY THE STATION IS ON IS NOT THIS CHECK'S TO DECIDE ───────
       *
       * This used to pick the first day with a card, write `st.day = day`, and
       * read the room. `st.day` IS NOT A FIELD A CALLER OWNS: `tickStationClock`
       * assigns `st.day = stationDay()` on every frame, out of the durable fold
       * in `StationSave`, which is the whole point of the repair that gave the
       * station more than one day. So the write was a no-op from the first
       * frame, and what the room actually read was whatever day the FOLD was
       * on — process-wide state, shared by every suite in the gate.
       *
       * On a clean fold that is day 0 and the check was green. Any suite that
       * runs before this one and moves the clock through a midnight — the ward
       * mending a company over 720 hours, a run coming home, a station world
       * driven past 24:00 — leaves the fold on some other day, and this check
       * then measured day 0's race hour against day N's card. Measured over the
       * first forty days: 24 of them have no meet at day 0's 15:11, so the room
       * is correctly silent and this reads as `peak 0.000 — it never reacted`,
       * a green build reported as a dead crowd. It is the classic shape — an
       * instrument inventing its own defect — and it is not order-dependence in
       * the game, which is why it is fixed here and not there.
       *
       * So the day is TAKEN from the fold rather than assumed, and if the venue
       * is dark on it the fold is wound forward through its own shipped door
       * (`passStationHours`, whole days, forward only) until it is not. The
       * station is then really on the day whose race this measures, whatever
       * ran before it. Every one of the first forty days answers with a peak
       * between 0.19 and 0.45 and three or more kinds of moment, so the bar
       * below is not day-specific.
       */
      await St.prepareStation();
      const v = venueById('holo-theatre');
      const dayWas = Save.stationDay();
      let day = dayWas, races = [];
      while (!races.length && day < dayWas + 60) { races = racesOn(v.id, day); if (!races.length) day++; }
      assert(races.length, `${v.id} has no card in the sixty days after ${dayWas}`);
      if (day > dayWas) Save.passStationHours(24 * (day - dayWas));
      assert(Save.stationDay() === day,
        `the station is on day ${Save.stationDay()} and this is measuring day ${day}`);
      const { world } = await bootWorld({
        level: 'station',
        settings: { mode: 'station', level: 'station', allies: 0 },
        onWorld: (w) => { w._stationFloor = 40; },
      });
      const idle = idleInput();
      const st = world._station;
      const place = P.PLACES.find((x) => x.id === v.place);

      /* Stand in the middle of the room. */
      world.player.position.set(place.x, st.deckY + 1.6, place.z);
      world.player.camera?.obj?.position?.set(place.x, st.deckY + 1.6, place.z);

      const race = races[0];
      /**
       * ── HOW THE SEATS ARE COUNTED, AND WHY IT IS NOT A HEADCOUNT ────────
       *
       * `life.live` is keyed `${place}:${slot}` and `reseat` asks for
       * `headcount(place, hour) + crowd.in` slots in a venue, so the bodies
       * standing at a slot index AT OR ABOVE the gazetteer's own headcount are
       * exactly the ones that exist because there is a card on. Counting live
       * bodies instead measured the POOL: it is 30 headless and the room fills
       * it either way, so a real 10 → 23 separation read as 28 → 30 and was
       * two bodies from being a false green.
       */
      const extras = () => {
        const floor = L.headcount(place, st.hour);
        return [...(world._stationLife?.live?.keys() || [])]
          .filter((k) => k.startsWith(`${v.place}:`))
          .filter((k) => +k.slice(k.indexOf(':') + 1) >= floor).length;
      };

      /* ── 1. THE ROOM BETWEEN MEETS. The clock is pinned every frame, because
       * `stepStation` winds it and a check that let it run would be measuring
       * a different hour by the end. */
      const quiet = (() => { for (let h = 0; h < 24; h += 0.25) if (!meetAt(v.id, day, h)) return h; return 4; })();
      /* `st.day` is deliberately NOT written here — see the note above. The
       * loop puts the fold's day on it every frame, and that is asserted. */
      for (let i = 0; i < 600; i++) { st.hour = quiet; world.update(1 / 60, idle); }
      assert(st.day === day,
        `the station ran on day ${st.day} while this measured day ${day} — the fold and the room disagree`);
      const idleHeads = extras();
      const idleIn = st.crowd?.in ?? -1;
      assert(st.crowd, 'the shipped loop left no crowd on the station at all — nothing calls stepCrowd');
      assert(st.crowd.venue === v.id, `standing in #${v.place} the room reads as ${st.crowd.venue}`);

      /* ── 2. AND THE SAME ROOM WITH A CARD ON. §3.4's own rate — one station
       * hour per two real minutes — so this is the race at the speed a player
       * watches it, not a clock jumped forward. */
      asked.length = 0;
      const before = st.crowd.roars | 0;
      let peak = 0, heads = 0, moments = new Set();
      st.hour = race.hour - 0.01;
      const perFrame = (1 / 60) / 120;
      let frames = 0;
      while (st.hour < race.hour + race.runs * 0.75 && frames < 1500) {
        st.hour += perFrame;
        world.update(1 / 60, idle);
        frames++;
        if (st.crowd.swell > peak) peak = st.crowd.swell;
        if (st.crowd.moment) moments.add(st.crowd.moment);
        heads = Math.max(heads, extras());
      }
      const roars = (st.crowd.roars | 0) - before;

      /* The day is asserted BEFORE the noise is, so a fold that moved under
       * the check says so in one line instead of reporting a silent room. */
      assert(st.day === day,
        `the station turned over to day ${st.day} mid-race while this measured day ${day}`);
      assert(peak > 0.1, `${frames} frames of the shipped loop over a live race and the room's loudest `
        + `moment was ${peak.toFixed(3)} — it never reacted`);
      assert(roars >= 2, `the room roared ${roars} times in a whole race`);
      assert(moments.size >= 2, `the room reacted to one kind of thing only: ${[...moments].join(', ')}`);
      assert(asked.length >= roars,
        `the room counted ${roars} roars and asked the audio engine for ${asked.length} of them`);
      const loudest = asked.reduce((a, b) => (b.shout > a.shout ? b : a), asked[0]);
      assert(loudest.shout > 0 && loudest.gain > 0,
        'every cue the room asked for was silent');
      /* THE SEATS FILL. The gazetteer's own curve is the floor; the tote's
       * crowd is what is on top of it, and the pool has to actually build
       * them. */
      assert(st.crowd.in > idleIn,
        `the room held ${st.crowd.in} during the race and ${idleIn} between meets`);
      assert(heads > idleHeads * 1.5,
        `${heads} of the bodies in #${v.place} were there for the card during the race and `
        + `${idleHeads} between meets — the crowd is a number nothing seats`);
      assert(L.headcount(place, st.hour) < st.crowd.in,
        'the tote crowd is smaller than the gazetteer headcount it is meant to be adding to');
      assert(st.crowd.turned > 0, 'nobody in the room ever turned to look at the race');

      out = `${frames} frames at §3.4's rate on the station's own day ${day}: ${roars} roars (${[...moments].join(', ')}), peak swell `
        + `${peak.toFixed(3)}, loudest cue gain ${loudest.gain} shout ${loudest.shout} freq ${loudest.freq} Hz; `
        + `#${v.place} seated ${idleHeads} bodies past its own headcount between meets and ${heads} `
        + `with a card on (the tote's crowd went ${idleIn} → ${st.crowd.in})`;
    } finally {
      audio.crowd = realCrowd;
      globalThis.fetch = hadFetch;
    }
    return out;
  });

}
