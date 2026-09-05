/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE TOTE, PLAYED — one driver, three callers
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"in life a good better will probably make money over time."*
 *
 * This is the measurement that sentence is a claim about, and it is a shared
 * helper rather than a block inside `tote.mjs` because THREE things need to be
 * the same run: the suite's bounded assertion, `tools/_toteedge.mjs`'s long
 * run at a quarter of a million bets a window, and anybody re-deriving the
 * bands after moving a constant. A hand-maintained twin of a bettor is how a
 * band gets asserted against a simulation nobody is playing.
 *
 * ── IT PLAYS THE GAME, IT DOES NOT MODEL IT ──────────────────────────────
 *
 * Every number below comes out of the shipped path: `makeYard` draws the yard,
 * `walkVenue` runs the days, `boardFor` prices the race, `ticketFor` writes
 * the ticket at the window (with the clock, so a bet struck after the off is
 * refused by the same code that refuses the player), `resultOf` runs the race
 * and `settleTickets` pays. Nothing here re-derives a price, a probability or
 * a payout. `agreesWithBookAt` below proves the one piece that COULD have
 * drifted — the book the bettor reads — is the book the window hands over.
 *
 * ── AND THE BOOK IS THE ONE THE PLAYER GETS, WHICH IS THE HALF THAT WAS
 *    WRONG ────────────────────────────────────────────────────────────────
 *
 * The old measurement (`twoPunters`, `edgeOf`) walked ONE yard for thousands
 * of days and bet all the way down it. `Spectacle.LOG_KEEP` is 60, so after a
 * few hundred days every runner's form log is saturated at sixty starts — and
 * the player's is not. `Tote.bookAt` replays `FORM_DAYS` and hands over what
 * that fortnight wrote: measured, 27.9 starts a runner at the Holo-theatre,
 * 17.8 in the Pit, 8.1 at the Arena. A reader measured on sixty starts is a
 * reader nobody can be, and the gap is not cosmetic — the same reading is
 * worth a correlation of 0.41 against the truth on a saturated log and 0.34 on
 * the book the window actually prints.
 *
 * So a betting day here is exactly what `bookAt` is: a FRESH yard, the
 * fortnight replayed into it, and then one day bet on. That also makes every
 * day an independent sample of the yard as well as of the racing, which is the
 * error bar `tote.mjs` used to have to go looking for a dozen yards to get.
 */

import {
  makeYard, walkVenue, boardFor, resultOf, ticketFor, settleTickets,
  bookAt, venueById, FORM_DAYS, MAX_STAKE,
} from '../../src/game/Tote.js';
import { researchedProbabilities, winProbabilities } from '../../src/game/Spectacle.js';

/**
 * A STAKE A PLAYER MAY ACTUALLY STRIKE.
 *
 * `edgeOf` buys the book at a hundred thousand because at a stake of 1 the
 * `Math.round` in `settleTickets` IS the edge. A bettor is not a book: he is
 * measured at the window's own cap, because the rounding a real ticket carries
 * is part of what a real ticket returns. It is unbiased and washes out over
 * the hundreds of thousands of bets below.
 */
export const STAKE = MAX_STAKE;

/**
 * HOW MUCH BETTER THAN THE PRICE THE READING HAS TO SAY BEFORE HE BACKS IT.
 *
 * A reader who backs his own top pick whatever the price is not reading the
 * board, he is reading half the room; a reader who demands a huge overlay
 * finds four bets a year. Two points is the smallest margin that is not noise
 * at these field sizes, and the band is measured at it rather than fitted to
 * it — `tools/_toteedge.mjs` prints the whole ladder.
 */
export const MARGIN = 0.02;

/** The shortest chance he will take, on his own reading. */
export const FLOOR = 0.05;

export const pct = (n) => `${(n * 100).toFixed(2)}%`;

/** Mean and the standard error of the mean over independent days. */
export function spread(a) {
  const n = a.length || 1;
  const m = a.reduce((x, y) => x + y, 0) / n;
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, n - 1);
  return { mean: m, se: Math.sqrt(v / n), n };
}

/**
 * ONE DAY AT A WINDOW, WITH THE BOOK THE WINDOW WOULD HAND YOU.
 *
 * A fresh yard, `FORM_DAYS` replayed into it — which is `bookAt`, line for
 * line — and then the day itself yielded race by race, priced but not yet run,
 * exactly as `walkVenue` yields it to the room.
 */
export function* bettingDays(venueId, { yardSeed = 1, from = 400, days = 1 } = {}) {
  for (let d = from; d < from + days; d++) {
    const book = makeYard(venueId, (yardSeed + d * 7717) >>> 0);
    for (const _ of walkVenue(venueId, { from: d - FORM_DAYS, days: FORM_DAYS, book })) { /* the fortnight, run */ }
    for (const step of walkVenue(venueId, { from: d, days: 1, book })) yield { ...step, book };
  }
}

/**
 * THE PROOF THAT THE BOOK ABOVE IS THE BOOK THE ROOM PRINTS.
 *
 * `bettingDays` builds its own yard so the days can be independent; `bookAt`
 * builds the station's. Handed the station's own seed they must agree row for
 * row, or every number in this file is about a form book nobody can read. The
 * suite drives this before it drives anything else.
 */
export function agreesWithBookAt(venueId, day) {
  const mine = makeYard(venueId);
  for (const _ of walkVenue(venueId, { from: day - FORM_DAYS, days: FORM_DAYS, book: mine })) { /* the past, run */ }
  const theirs = bookAt(venueId, day);
  const shape = (b) => JSON.stringify(b.entrants.map((e) => [
    e.id, e.form.rating, e.form.starts, e.form.wins, e.form.recent, e.form.beaten || null,
    e.form.log.map((r) => [r.ground, r.position, r.field, r.status]),
  ]));
  return shape(mine) === shape(theirs);
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  AND THE SAME BET, WITH THE SETTLING NOISE TAKEN OUT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A ticket returns the price or nothing, so a two-point edge needs a quarter
 * of a million bets to be read off the settlements — which is what
 * `tools/_toteedge.mjs` is for and is far more than a gate can afford. The
 * same expectation is also `p × price − 1` under the probabilities the RESULT
 * IS DRAWN FROM, which is the sim's own view of the ticket the punter just
 * struck, and it reads the same number with about a fortieth of the variance.
 * It is the identical trick this file's pin already uses — average over every
 * runner the pin could have landed on rather than tossing for one.
 *
 * BOTH ARE CARRIED, and they are not interchangeable. `roi` is money that
 * actually changed hands and is what the long run reports. `expect` is the
 * low-variance reading a bounded check can assert a band on — and it is only
 * worth anything if the model behind it is a model of this simulation, which
 * is why `tote.mjs` asserts the two agree within the realised run's own error
 * bar before it believes either. A model that had drifted off the sim would
 * show up exactly there.
 */

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  TWO PUNTERS AT ONE WINDOW
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   THE FORM-READER  reads what the window prints — the board, the form line,
 *                    the going the log can be split on and this room's own
 *                    head-to-head column — through `researchedProbabilities`,
 *                    which is handed no hidden field. He backs the runner his
 *                    reading says is the best PRICE, not the one it says is
 *                    the best runner, and he does not bet at all when nothing
 *                    on the board is worth `MARGIN` more than it is quoted at.
 *
 *   THE PIN          picks a runner off the card at random. Averaged over
 *                    every runner the pin could have landed on rather than
 *                    sampled with a coin — the same expectation with the
 *                    picking noise taken out, which is how a point of edge is
 *                    read in thirty thousand bets instead of three million.
 *
 * Both go through `ticketFor` and `settleTickets`, so both are subject to the
 * window's refusals, its price rounding and its payout rounding.
 */
export function playWindow(venueId, { bets = 20000, yardSeed = 4242, from = 400, margin = MARGIN } = {}) {
  const v = venueById(venueId);
  if (!v) throw new Error(`no such venue: ${venueId}`);
  const readDays = [], pinDays = [], favDays = [];
  let read = { staked: 0, back: 0, bets: 0, hits: 0, ev: 0 };
  let pin = { staked: 0, back: 0, bets: 0, ev: 0 };
  let fav = { staked: 0, back: 0, bets: 0, ev: 0 };
  const readEv = [], pinEv = [], favEv = [];
  let races = 0, day = from, refused = 0;
  while (read.bets < bets) {
    const dRead = { staked: 0, back: 0 }, dPin = { staked: 0, back: 0 }, dFav = { staked: 0, back: 0 };
    for (const step of bettingDays(venueId, { yardSeed, from: day, days: 1 })) {
      const race = step.race;
      const board = boardFor(race);
      /* THE CLOCK. A ticket is struck while the field is still parading, which
       * is the only stretch in which the book is open — and it is `ticketFor`
       * that says so, not this file. */
      const at = race.hour - 0.01;
      const price = new Map(board.runners.map((r) => [r.id, r.win]));
      const probs = researchedProbabilities(race.card, race.ground);
      /* THE SIM'S OWN VIEW OF THE TICKET, for the low-variance reading. It is
       * never shown to either bettor and never chooses anything. */
      const truth = new Map(winProbabilities(race.card, race.ground, { hidden: true }).map((t) => [t.id, t.p]));
      let best = null;
      for (const { id, p } of probs) {
        /* HE DOES NOT BACK WHAT HIS OWN READING PUTS UNDER ONE IN TWENTY. A
         * model edge of a few per cent on a runner priced at 400 is worth more
         * in expectation than anything else on the board and is not a bet a
         * man makes; without this line the measured return is a handful of
         * enormous prices and reads as +20% one run and −5% the next. The
         * engine's own `value()` in `spectacle-engine.mjs` has always had the
         * same floor. */
        if (p < FLOOR) continue;
        const ev = p * (price.get(id) || 0);
        if (ev >= 1 + margin && (!best || ev > best.ev)) best = { id, ev };
      }
      const tickets = [];
      if (best) {
        const q = ticketFor(race, { on: best.id, kind: 'win', stake: STAKE, at });
        if (!q.ok) { refused++; } else tickets.push(q.ticket);
      }
      const result = resultOf(race);
      if (tickets.length) {
        const led = settleTickets(tickets, result);
        dRead.staked += led.staked; dRead.back += led.returned;
        read.bets++; if (led.returned > 0) read.hits++;
        const e = truth.get(best.id) * price.get(best.id) - 1;
        read.ev += e; readEv.push(e);
      }
      /* The pin, as an expectation over the card, and the favourite beside it
       * because "back the market leader" is the other thing a player who does
       * not read the form actually does. */
      const all = board.runners.map((r) => ticketFor(race, { on: r.id, kind: 'win', stake: STAKE, at }))
        .filter((q) => q.ok).map((q) => q.ticket);
      const spread0 = settleTickets(all, result);
      dPin.staked += spread0.staked / all.length; dPin.back += spread0.returned / all.length;
      pin.bets++;
      let pe = 0;
      for (const r of board.runners) pe += (truth.get(r.id) * r.win - 1) / board.runners.length;
      pin.ev += pe; pinEv.push(pe);
      const f = ticketFor(race, { on: board.favourite, kind: 'win', stake: STAKE, at });
      if (f.ok) {
        const led = settleTickets([f.ticket], result);
        dFav.staked += led.staked; dFav.back += led.returned;
        fav.bets++;
        const e = truth.get(board.favourite) * price.get(board.favourite) - 1;
        fav.ev += e; favEv.push(e);
      }
      races++;
    }
    day++;
    if (dRead.staked) { read.staked += dRead.staked; read.back += dRead.back; readDays.push(dRead.back / dRead.staked - 1); }
    if (dPin.staked) { pin.staked += dPin.staked; pin.back += dPin.back; pinDays.push(dPin.back / dPin.staked - 1); }
    if (dFav.staked) { fav.staked += dFav.staked; fav.back += dFav.back; favDays.push(dFav.back / dFav.staked - 1); }
    /* A room that is dark for a fortnight is a room, not a hang. */
    if (day - from > bets * 40 + 4000) break;
  }
  const roi = (b) => (b.staked ? b.back / b.staked - 1 : NaN);
  const line = (b, days, evs, extra = {}) => {
    const s = spread(days), e = spread(evs);
    return { roi: roi(b), bets: b.bets, mean: s.mean, se: s.se, days: s.n,
      expect: e.mean, expectSe: e.se, ...extra };
  };
  return {
    venue: venueId, races, days: day - from, refused,
    reader: line(read, readDays, readEv, { strike: read.bets ? read.hits / read.bets : 0 }),
    pin: line(pin, pinDays, pinEv),
    favourite: line(fav, favDays, favEv),
  };
}
