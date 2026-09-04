/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE TOTE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you can bet on podracing … these will be real races without pre-determined
 *  outcomes."*
 *
 * *"you should be able to bet on other people's companion battles too even if
 *  you're not involved, you don't have to bet to watch (applies to any casino
 *  game)."*
 *
 * V16 Lane D2. `Spectacle.js` is the sim and it is finished: a card, a ground,
 * a forward advance with no line in it that picks a winner, a form book and a
 * typed event stream. What it has no opinion about is WHEN any of that happens
 * or WHERE, and a spectacle nobody can walk in on is a screensaver. This file
 * is the four things a room needs on top of the engine and nothing else:
 *
 *   1. THE CARD    what is running at a place, at an hour, on a day
 *   2. THE BOARD   what each runner pays, off the public form and the cut
 *   3. THE BET     a ticket, priced when it was struck, settled on the result
 *   4. THE SPECTATOR  the free reading — who is ahead, how far in, the call
 *
 * ── THE RULE THIS FILE IS SHAPED AROUND ───────────────────────────────────
 *
 * **WATCHING IS FREE AND UNCONDITIONAL.** Not "free as in cheap" — free as in
 * there is no code path from the reading to a stake. `watch()` takes a place,
 * a day and an hour, and nothing else; it cannot be handed a ticket and has no
 * parameter a ticket could hide in. A player who never bets a credit gets the
 * board, the field, the running order, the announcer's lines and the call,
 * identical to the one who bet the room down. A check drives both and compares.
 *
 * The engine already makes this structurally true — `runSpectacle` takes no
 * wagers, so a card runs whether anybody turned up — and this file must not be
 * the place that quietly takes it back by putting a stake in front of the door.
 * A room that demands a bet at the door is the bug.
 *
 * ── WHY THE PAST IS RE-RUN RATHER THAN STORED ─────────────────────────────
 *
 * Every price on the board is a function of the public form, and the form book
 * is the last fortnight of results. So either the tote stores a history — a
 * durable record of races, which is a save file nobody asked for and a thing
 * two players would disagree about — or the history is DERIVABLE.
 *
 * It is derivable, because every seed here is a hash of `(place, day, index)`.
 * Yesterday's card is a pure function of yesterday, so `bookAt` replays the
 * last `FORM_DAYS` days and reads the results back out. Everybody on the
 * station replays the same fortnight and therefore reads the same form book,
 * the same board and the same field, with nothing written down anywhere. The
 * reading room is real, it is public, and it costs a Map.
 *
 * That is also why `FORM_DAYS` is a constant and not an option: a bout carries
 * a GRUDGE out of the engine's `recordResult`, so how far back you replay is
 * part of what the runners are. Two readers replaying different windows are
 * two readers watching different races, which is the one thing a station-wide
 * card may not be.
 *
 * ── AND IT HOLDS NO BALANCE ───────────────────────────────────────────────
 *
 * `Kennel.js`:22 — "that silence is a hazard, not a permission" — and both
 * `Spectacle.js` and `Pits.js` restate it on the commits that made them. A
 * tote is the strongest pull in the tree toward a stored purse: it takes money
 * at a window and pays it back at the same window, which is a wallet with a
 * grille in front of it.
 *
 * IT KEEPS NONE. `ticketFor` PRICES a bet and hands back a ticket; it does not
 * take the money. `settleTickets` says what is owed; it does not pay it. The
 * credits move in `Station.js`'s `stakeAtTote`/`payAtTote`, which are eight
 * lines beside the interact key and are the only place the two words appear.
 * That is what lets `tools/checks/tote.mjs` settle a hundred thousand tickets
 * without a store, and it is the reason this file names no wallet word — its
 * own suite runs the six-word currency scan over it rather than waiting to be
 * added to somebody else's list.
 *
 * ── PURE ──────────────────────────────────────────────────────────────────
 *
 * Two imports: the tree's generator and the engine. No THREE, no World, no
 * DOM, no store, no `Math.random`, and no mode named. The room that renders
 * this — the Holo-theatre's feed, the Pit's rail, the Arena's benches — is
 * somebody else's file reading `watch()`.
 */

import { makeRng } from '../engine/MathUtil.js';
import {
  SKINS, groundById, dressGround, makeCard, priceCard, favouriteOf,
  runSpectacle, recordResult, announce, MOMENTS,
} from './Spectacle.js';

/** A stable 32-bit hash. Same idiom `Quests.js` and `Counter.js` use. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}
const seeded = (s) => makeRng(hashOf(s));
const round2 = (n) => Math.round(n * 100) / 100;

/* ══════════════════════════════════════════════════════════════════════════
 *  THE THREE PLACES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A venue is a row: a room off `StationPlan.js`, one of the engine's three
 * skins, the grounds it may run on, how big its yard is, and a clock. Nothing
 * below is a fourth kind of thing — the Holo-theatre and the Arena are the
 * same eleven fields with different numbers in them, which is the same bargain
 * `SKINS` struck in the engine.
 */
export const VENUES = Object.freeze([
  /**
   * #19 THE HOLO-THEATRE — sixty seats facing a stage, and the podracing feed
   * is what is on it when your last run is not. *"maybe the scenes you
   * sometimes see play out on the screens are actually real scenes from that
   * podrace you're watching"* — they are: the screen is `result.events`.
   *
   * An afternoon and an evening card, eight pods a race, and the widest yard,
   * because a form book is only worth reading if the field turns over.
   */
  {
    id: 'holo-theatre', place: 19, name: 'Holo-theatre', skin: 'PODRACE',
    word: 'race', runners: 'the field', crowd: 'sixty in the seats',
    grounds: ['boonta', 'vinta', 'ord'],
    yard: 20, meets: [1, 2], window: [12, 21], length: [2.5, 4], every: 0.5, runs: 0.3,
    /* Six days in seven. A card every single day is a timetable, not an event. */
    dark: 0.14,
  },
  /**
   * #18 THE PIT — the gazetteer's own verb for this room is already "watch and
   * bet", which is this whole lane in three words. Six in, sentients and
   * beasts and somebody's droid, and the house takes eight because the room is
   * small and the bar is expensive.
   */
  {
    id: 'the-pit', place: 18, name: 'The Pit', skin: 'PIT',
    word: 'bout', runners: 'the card', crowd: 'twelve at the rail',
    grounds: ['pit-floor'],
    yard: 14, meets: [1, 1], window: [19, 23], length: [2, 3.5], every: 0.5, runs: 0.3,
    dark: 0.22,
  },
  /**
   * #20 THE ARENA — *"you should be able to bet on other people's companion
   * battles too even if you're not involved."* That sentence is this row. The
   * Arena is where Lane G puts YOUR animal in the sand; on every other night
   * of the week it is two of somebody else's, refereed, and you are in the
   * benches with a card in your hand and no dog in the fight.
   *
   * Two in the ring, so it is the one venue with a single market — see
   * `placesPaid`. A place bet on a two-horse race pays everybody.
   */
  {
    id: 'the-arena', place: 20, name: 'The Arena', skin: 'ARENA',
    word: 'bout', runners: 'the pair', crowd: 'twelve on the benches',
    grounds: ['arena-sand'],
    yard: 12, meets: [1, 2], window: [10, 20], length: [1.5, 3], every: 0.5, runs: 0.25,
    dark: 0.18,
    /* THE MARSHAL MATCHES THE PAIR — see `drawField`, which carries the
     * measurement. A refereed bout is made, not drawn out of a hat, and it is
     * the one venue where that is a betting decision as well as a fiction. */
    graded: true,
  },
].map(Object.freeze));

export const venueById = (id) => VENUES.find((v) => v.id === id) || null;
export const venueAtPlace = (place) => VENUES.find((v) => v.place === (place | 0)) || null;

/**
 * ── AND #61 THE UNDERLIFT PIT IS NOT ON THIS LIST, DELIBERATELY ───────────
 *
 * It is a `PIT` ground in the engine and a venue in `Pits.js`, so putting a
 * tote board on it would cost four lines. It does not get one. #61 is the
 * unsanctioned room — a deck plate up, chain-link over the gap, "a man taking
 * the book" — and the man taking the book is not the house. A tote window in
 * that room would be the station standing behind a card the station pretends
 * not to know about, which is the one thing the room is FOR.
 *
 * So the Underlift is Lane G's: you go down there to fight, and the money at
 * the rail is between whoever is holding it.
 */

/* ══════════════════════════════════════════════════════════════════════════
 *  1. THE CARD — what is on, when
 * ══════════════════════════════════════════════════════════════════════════ */

/** How far back the public form book runs. See the header: it is a constant
 * because two readers replaying different windows are watching different
 * races. Twelve days is sixty-odd starts a runner, which is `LOG_KEEP`. */
export const FORM_DAYS = 12;

/**
 * THE DAY'S PROGRAMME, AND IT KNOWS NOTHING ABOUT THE RUNNERS' FORM.
 *
 * Hours, grounds, seeds and which stalls are drawn — all of it a hash of
 * `(place, day)`, so it is the same for everybody on the station on that day
 * and different tomorrow, exactly as `Counter.js` draws a shelf and `Quests.js`
 * draws a giver.
 *
 * It is separated from the form book on purpose: the book is built by REPLAYING
 * old programmes, so a programme that needed a book to exist could not be
 * built without one. This one is a skeleton of indices and seeds, which is all
 * the replay needs.
 */
export function programmeAt(venueId, day = 0) {
  const v = venueById(venueId);
  if (!v) throw new Error(`no such venue: ${venueId}`);
  const d = day | 0;
  const rng = seeded(`tote:card:${v.id}:${d}`);
  /* SOME NIGHTS IT DOES NOT RUN. A room with a card on it every day of the
   * year is a timetable; a room that is dark tonight is a reason to have
   * checked. `#61`'s gazetteer line — "on the nights it runs at all" — is the
   * house voice for exactly this. */
  if (rng() < v.dark) return { venue: v, day: d, dark: true, meets: [] };
  const n = v.meets[0] + (rng() < 0.5 ? 0 : v.meets[1] - v.meets[0]);
  const meets = [];
  let earliest = v.window[0];
  for (let m = 0; m < n; m++) {
    const span = v.window[1] - earliest;
    if (span <= 1) break;
    const from = round2(earliest + rng() * Math.max(0, span - 1));
    const length = round2(v.length[0] + rng() * (v.length[1] - v.length[0]));
    const to = round2(Math.min(v.window[1] + 1, from + length));
    const races = [];
    for (let k = 0, hour = from; hour + v.runs <= to; k++, hour = round2(from + k * v.every)) {
      races.push({
        id: `${v.id}:${d}:${m}:${k}`,
        venue: v.id, day: d, meet: m, index: k, hour: round2(hour), runs: v.runs,
        ground: rng.pick(v.grounds),
        /* THE TWO SEEDS ARE NOT ONE SEED. The going is drawn BEFORE the board
         * goes up (the engine's rule, so the house may price the rain and not
         * the pilot who likes it) and the race is run from its own. Sharing a
         * stream would make the weather a function of the dice. */
        goingSeed: hashOf(`tote:going:${v.id}:${d}:${m}:${k}`),
        runSeed: hashOf(`tote:run:${v.id}:${d}:${m}:${k}`),
        drawSeed: hashOf(`tote:draw:${v.id}:${d}:${m}:${k}`),
      });
    }
    if (races.length) meets.push({ index: m, from, to: round2(races[races.length - 1].hour + v.runs), races });
    earliest = to + 0.5;
  }
  return { venue: v, day: d, dark: !meets.length, meets };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE YARD AND THE BOOK
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE STABLE OF RUNNERS A VENUE DRAWS ITS FIELDS FROM.
 *
 * Deterministic and the same every session — a form book over a field that
 * changed under it would be a form book about nobody.
 *
 * `seed` is for measurement and for nothing else. A venue has ONE yard, and a
 * yard is one sample however many races you run it through: the hidden terms
 * that make a pod good in the wet are drawn once and never redrawn, so twelve
 * thousand races down one yard are twelve thousand correlated races and an
 * error bar computed off them is a fiction. `tools/checks/tote.mjs` measures
 * across a dozen independent yards for exactly that reason — it cost a
 * favourite-backer reading +14.6% on one yard, which is not possible in
 * expectation and was the tell.
 */
export function makeYard(venueId, seed = null) {
  const v = typeof venueId === 'string' ? venueById(venueId) : venueId;
  if (!v) throw new Error(`no such venue: ${venueId}`);
  return makeCard({ skin: v.skin, size: v.yard, seed: seed == null ? hashOf(`tote:yard:${v.id}`) : (seed >>> 0) || 1 });
}
const yardFor = (v) => makeYard(v);

/**
 * THE `S.field` RUNNERS DRAWN FOR ONE RACE, BY THE RACE'S OWN SEED.
 *
 * ── AND THE ARENA'S PAIR IS MATCHED, WHICH IS NOT DECORATION ─────────────
 *
 * An open draw from the yard is right for a field of eight: a handicap has a
 * favourite and a rag and the interest is in between. A field of TWO drawn the
 * same way is a 94 against a 46 one night in ten, which prices at about 0.95
 * against 0.05 — and the tail of a probability model is the part you can least
 * afford to sell at face value.
 *
 * MEASURED, on 96,000 bouts across 24 independent yards: the board prices its
 * two-runner outsiders at 0.055 and they win 0.072, which is a hundredth and a
 * half of an error and reads as nothing. At a price of 17.3 it is +25% to
 * anybody who backs the underdog every night, forever. The same table is
 * excellent where the pair is close — 0.452 priced against 0.447 won, 0.548
 * against 0.553 — so the leak is not in the model, it is in WHICH PART OF THE
 * MODEL THE WINDOW SELLS.
 *
 * A promoter does not put a 94 in with a 46. `graded` is the marshal making
 * the match: the pair comes out of a window of the yard's own rating order, so
 * the Arena sells the middle of its model and never the tail. That is the fix
 * a room would actually make, it costs four lines, and it needs nothing from
 * the engine.
 */
function drawField(race, book) {
  const S = SKINS[book.skin];
  const v = venueById(race.venue);
  const n = Math.min(S.field, book.entrants.length);
  const rng = makeRng(race.drawSeed);
  let idx = book.entrants.map((_, i) => i);
  if (v?.graded) {
    idx.sort((a, b) => book.entrants[b].form.rating - book.entrants[a].form.rating);
    const at = rng.int(0, idx.length - n);
    idx = idx.slice(at, at + n);
  }
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return { skin: book.skin, entrants: idx.slice(0, n).map((i) => book.entrants[i]) };
}

/** Bind a programme row to a book: its field, its ground, and the two memos a
 * board and a result live in. */
function bind(race, book) {
  const v = venueById(race.venue);
  const card = drawField(race, book);
  return {
    ...race, card,
    ground: dressGround(groundById(race.ground), race.goingSeed),
    word: v.word, _board: null, _result: null,
  };
}

/**
 * WALK A VENUE FORWARD, RACE BY RACE, IN THE ORDER THE PLAYER LIVES IT.
 *
 * Priced, bet, run, and only then written into the public log — the same order
 * `tools/checks/spectacle-engine.mjs`'s circuit uses, and any other order is
 * the cheat this whole lane is written against. The result is computed before
 * the yield because it is a pure function of a seed nobody can move; what the
 * yield guarantees is that the caller sees the book as it stood BEFORE this
 * race, which is the book that priced it.
 *
 * One function, three callers: the form book replays it, the edge measurement
 * drives it for thousands of races, and the check's bettors ride it. A second
 * loop over the same days would be the hand-maintained twin this tree keeps
 * removing.
 */
export function* walkVenue(venueId, { from = 0, days = 1, book = null } = {}) {
  const v = venueById(venueId);
  if (!v) throw new Error(`no such venue: ${venueId}`);
  const stable = book || yardFor(v);
  for (let d = from; d < from + days; d++) {
    const prog = programmeAt(venueId, d);
    for (const meet of prog.meets) {
      for (const row of meet.races) {
        const race = bind(row, stable);
        yield { day: d, venue: v, meet, race, book: stable };
        recordResult(race.card, race.ground, resultOf(race));
      }
    }
  }
  return stable;
}

/* A small cache, because a room the player walks back into must not replay a
 * fortnight every time the prompt is raised. Bounded, and keyed by the two
 * things the book is a function of. */
const BOOKS = new Map();
const BOOK_KEEP = 8;

/**
 * THE PUBLIC FORM BOOK AT A PLACE, ON A DAY.
 *
 * The last `FORM_DAYS` days of that venue's own cards, run and recorded. No
 * storage, no save file, no synchronisation: it is a pure function of the
 * place and the date, so the punter beside you at the rail has read the same
 * fortnight you have.
 */
export function bookAt(venueId, day = 0) {
  const key = `${venueId}:${day | 0}`;
  const hit = BOOKS.get(key);
  if (hit) return hit;
  const v = venueById(venueId);
  if (!v) throw new Error(`no such venue: ${venueId}`);
  const stable = yardFor(v);
  const walk = walkVenue(venueId, { from: (day | 0) - FORM_DAYS, days: FORM_DAYS, book: stable });
  /* Drained rather than read: the replay's job is the side effect the engine's
   * `recordResult` writes into `form.log`, which is the reading room. */
  for (const _ of walk) { /* the past, run */ }
  if (BOOKS.size >= BOOK_KEEP) BOOKS.delete(BOOKS.keys().next().value);
  BOOKS.set(key, stable);
  return stable;
}

/** Forget the replayed books. Only a check calls this. */
export function clearTote() { BOOKS.clear(); RESULTS.clear(); }

const CARDS = new Map();
const CARD_KEEP = 8;

/**
 * THE CARD AT A PLACE TODAY — the programme with the runners in it.
 *
 * Cached with the book, so two reads of the same day are the same objects and
 * therefore the same memoised boards and results. That is what makes "two
 * people in the room see one race" cheap as well as true.
 */
export function cardAt(venueId, day = 0) {
  const key = `${venueId}:${day | 0}`;
  const hit = CARDS.get(key);
  if (hit) return hit;
  const prog = programmeAt(venueId, day);
  const book = bookAt(venueId, day);
  const card = {
    venue: prog.venue, day: day | 0, dark: prog.dark, book,
    meets: prog.meets.map((m) => ({ ...m, races: m.races.map((r) => bind(r, book)) })),
  };
  if (CARDS.size >= CARD_KEEP) CARDS.delete(CARDS.keys().next().value);
  CARDS.set(key, card);
  return card;
}

/** Every race on the day, in order. */
export const racesOn = (venueId, day = 0) => cardAt(venueId, day).meets.flatMap((m) => m.races);

/** The meet running at this hour, or null — between meets the room is a room. */
export function meetAt(venueId, day = 0, hour = 0) {
  for (const m of cardAt(venueId, day).meets) if (hour >= m.from && hour < m.to) return m;
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  2. THE BOARD
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The engine prices a WIN and nothing else, and it prices it off the public
 * form alone — `tools/checks/spectacle-engine.mjs` permutes every hidden term
 * on the card and demands the board does not move by a hundredth. Everything
 * below is derived from that one set of probabilities, so a market this file
 * invents cannot see anything the engine's board could not.
 *
 * THE WINDOW'S OWN CUT IS ITS OWN NUMBER. The win price already carries the
 * skin's take (6% on the pods, 8% in the Pit, 5% in the Arena). A derived
 * market is a second product with a second margin, and folding the skin's take
 * into it twice would be a 14% place market nobody would back. Both are
 * MEASURED by `edgeOf` rather than declared, because a payout table is easy to
 * get wrong by a factor of two and impossible to eyeball — which is exactly
 * how `drumEdge` caught the Drum paying the player 63%.
 */
export const TAKE = Object.freeze({ place: 0.075, field: 0.055 });

/**
 * HOW MANY GET PAID A PLACE, AND SOMETIMES IT IS NOBODY.
 *
 * Three from eight, two from five or six, and NO PLACE MARKET AT ALL under
 * five — a place bet on a two-runner bout pays everybody who turns up, which
 * is not a bet, it is a queue. The Arena has two in the sand, so the Arena has
 * one market, and a room saying "win only tonight" is a room that knows what
 * it is doing.
 */
export const placesPaid = (n) => (n >= 8 ? 3 : n >= 5 ? 2 : 0);

/**
 * P(this runner is in the first k), from the win probabilities and nothing
 * else — Harville, which is the standard reading and is what a real board
 * does: the chance j wins and then i wins what is left of the field.
 *
 * It is an APPROXIMATION of this simulation rather than a derivation of it,
 * and it is known to be a touch generous to the favourite. That is why the
 * place market's cut is measured against the sim's actual finishing positions
 * in `edgeOf('place')` and not assumed to be `TAKE.place`.
 */
function topK(p, i, k) {
  if (k <= 1) return p[i];
  let acc = p[i];
  for (let j = 0; j < p.length; j++) {
    if (j === i) continue;
    const rest = 1 - p[j];
    if (rest <= 1e-6) continue;
    acc += p[j] * (p[i] / rest);
    if (k <= 2) continue;
    for (let m = 0; m < p.length; m++) {
      if (m === i || m === j) continue;
      const rest2 = 1 - p[j] - p[m];
      if (rest2 <= 1e-6) continue;
      acc += p[j] * (p[m] / rest) * (p[i] / rest2);
    }
  }
  return Math.min(acc, 0.999);
}

/**
 * THE BOARD FOR ONE RACE.
 *
 * A row per runner with the win and (where there is one) the place price, plus
 * the one market that is not a runner: the FIELD, which is everybody except
 * the favourite. Memoised on the race, so the board a player reads at 19:10 is
 * the board they read at 19:11 — a price that moved while nobody bet would be
 * a slot machine wearing a board's clothes.
 */
export function boardFor(race) {
  if (race._board) return race._board;
  const rows = priceCard(race.card, race.ground);
  /* `priceCard` rounds `marketP` to three figures for printing, so the column
   * no longer sums to one. Renormalised before anything is derived from it:
   * a place market built on a book that adds to 0.997 is 0.3% long on every
   * row and the house finds out before the player does. */
  const sum = rows.reduce((a, r) => a + r.marketP, 0) || 1;
  const p = rows.map((r) => r.marketP / sum);
  const k = placesPaid(race.card.entrants.length);
  const runners = rows.map((r, i) => {
    const e = race.card.entrants[i];
    const row = {
      id: r.id, name: e.name, kind: e.kind, rating: e.form.rating,
      recent: e.form.recent.slice(), marketP: Math.round(p[i] * 1000) / 1000,
      win: r.price, place: null, placeP: null,
    };
    if (k) {
      const pk = topK(p, i, k);
      row.placeP = Math.round(pk * 1000) / 1000;
      row.place = round2(Math.max(1.05, (1 / pk) * (1 - TAKE.place)));
    }
    return row;
  });
  const fav = favouriteOf(rows);
  const against = 1 - (p[rows.findIndex((r) => r.id === fav.id)] || 0);
  const board = {
    race: race.id, ground: race.ground.name, conditions: race.ground.conditions,
    places: k, favourite: fav.id, runners,
    /* THE FIELD BET, and it needs three runners to mean anything: laying the
     * favourite in a two-horse race is backing the other one, which is already
     * on the board at a better price. */
    field: race.card.entrants.length >= 3
      ? { p: Math.round(against * 1000) / 1000, price: round2(Math.max(1.05, (1 / Math.max(against, 1e-3)) * (1 - TAKE.field))), against: fav.id }
      : null,
  };
  race._board = board;
  return board;
}

/** The three markets, as data, so a room can list them without knowing them. */
export const BETS = Object.freeze([
  { id: 'win', label: 'win', line: 'first past the post' },
  { id: 'place', label: 'place', line: 'in the frame' },
  { id: 'field', label: 'the field', line: 'anybody but the favourite' },
].map(Object.freeze));

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE BET
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE MOST ANYONE MAY HAVE ON ONE RACE.
 *
 * The same number as `Credits.PER_RUN_CAP`, and it is written here rather than
 * imported because this file may not reach the wallet — `tools/checks/tote.mjs`
 * reads both files and fails if the two ever drift apart, which is the cheap
 * half of the guarantee a shared import would have given for free. A cap at a
 * run's whole earnings is the line between a bet and a way to lose the game at
 * a window.
 */
export const MAX_STAKE = 900;

/**
 * PRICE A BET AND HAND BACK A TICKET. NO MONEY MOVES HERE.
 *
 * Refuses rather than defaulting, and says why in the shape `Credits.spend`
 * answers in — a window that says "no" without saying which no is the shape of
 * thing this tree keeps removing.
 *
 * ── AND BETTING CLOSES WHEN THE RACE GOES OFF ────────────────────────────
 *
 * `at` is the station clock and it is not optional. A ticket struck on a race
 * that has already run is not a bet, it is a withdrawal, and it is the same
 * defect the Drum's clock exists to prevent: *"a player cannot re-take a roll
 * by walking out and back in."* The engine cannot help here — its result is a
 * pure function of a seed anybody may call — so the refusal has to be at this
 * window, and the check drives it.
 *
 * The ticket carries its own price and everything settlement needs. A board
 * that moves after you have struck cannot touch a ticket already written,
 * which is what a price is FOR.
 */
export function ticketFor(race, { on = null, kind = 'win', stake = 0, at = null } = {}) {
  const no = (why) => ({ ok: false, why, ticket: null });
  if (!race || !race.card) return no('there is no race there');
  if (!BETS.some((b) => b.id === kind)) return no(`there is no ${kind} market`);
  const amount = Math.round(Number(stake) || 0);
  if (!(amount > 0)) return no('that is not a stake');
  if (amount > MAX_STAKE) return no(`the window takes ${MAX_STAKE} on a race and no more`);
  if (at == null) return no('the window needs the time');
  if (at >= race.hour) return no(`the ${race.word} is off — the book is closed`);
  const board = boardFor(race);
  if (kind === 'field') {
    if (!board.field) return no('there is no field market on a card this small');
    return {
      ok: true, why: null,
      ticket: { race: race.id, venue: race.venue, day: race.day, kind, on: board.field.against,
        price: board.field.price, places: 0, stake: amount, at },
    };
  }
  const row = board.runners.find((r) => r.id === (on?.id || on));
  if (!row) return no('that one is not on this card');
  if (kind === 'place' && !board.places) return no('win only on this one');
  return {
    ok: true, why: null,
    ticket: { race: race.id, venue: race.venue, day: race.day, kind, on: row.id,
      price: kind === 'place' ? row.place : row.win, places: board.places, stake: amount, at },
  };
}

/**
 * WHAT A LIST OF TICKETS IS WORTH AGAINST A RESULT THIS FUNCTION DID NOT
 * PRODUCE.
 *
 * A ledger out, and nothing stored. `Spectacle.settle` does this for a win and
 * only a win; settlement lives in one place rather than two, so a place bet
 * cannot quietly grow a second definition of what "won" means.
 *
 * ── THE PAYOUT IS ROUNDED, AND THAT IS WHERE A DAY WENT ──────────────────
 *
 * `Math.round(stake * price)` — a credit is a credit. Which means that at a
 * stake of 1, a price of 2.95 and a price of 3.40 pay the same three credits
 * and every measurement of the cut reads the ROUNDING instead of the price.
 * `drumEdge` names the same trap. `edgeOf` measures at a thousand.
 */
export function settleTickets(tickets = [], result = null) {
  const place = new Map((result?.order || []).map((r) => [r.id, r.position]));
  const lines = [];
  let staked = 0, returned = 0;
  for (const t of tickets) {
    const stake = Math.max(0, Math.round(Number(t.stake) || 0));
    /* A ticket on somebody who is not in this race is REFUSED rather than
     * quietly losing, the way `Spectacle.settle` refuses one — a missing thing
     * answered with a plausible default is how this tree has lost afternoons.
     * The field bet names the favourite it was laid against, who is on the
     * card by construction, so it goes through the same door. */
    if (result && !place.has(t.on)) throw new Error(`a ticket was struck on ${t.on}, who is not on this card`);
    let won = false;
    if (!result) won = false;
    else if (t.kind === 'win') won = result.winner === t.on;
    else if (t.kind === 'field') won = result.winner != null && result.winner !== t.on;
    else if (t.kind === 'place') won = place.get(t.on) <= (t.places || 0);
    const back = won ? Math.round(stake * t.price) : 0;
    staked += stake;
    returned += back;
    lines.push({ ...t, won, returned: back });
  }
  return { staked, returned, net: returned - staked, lines };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE RESULT — the engine's, run forward, from a seed nobody can move
 * ══════════════════════════════════════════════════════════════════════════ */

const RESULTS = new Map();
const RESULT_KEEP = 512;

/**
 * RUN THE RACE, OR HAND BACK THE ONE THAT WAS ALREADY RUN.
 *
 * The seed is a hash of the place, the day and the index, so every reader gets
 * the same race and no reader can ask twice for a different one — the Drum's
 * property, on a bigger machine. Nothing here chooses a winner; `runSpectacle`
 * advances a state and the order falls out of the distances, which is the one
 * implementation in which *"even the game doesn't know"* is true.
 *
 * IT DOES NOT TAKE WAGERS, and it cannot: the parameter list is a race. That
 * is the same structural guarantee the engine has and this file must not be
 * the place that gives it back.
 */
export function resultOf(race) {
  if (race._result) return race._result;
  const hit = RESULTS.get(race.id);
  if (hit) { race._result = hit; return hit; }
  const out = runSpectacle({ card: race.card, ground: race.ground, seed: race.runSeed });
  if (RESULTS.size >= RESULT_KEEP) RESULTS.delete(RESULTS.keys().next().value);
  RESULTS.set(race.id, out);
  race._result = out;
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  4. THE SPECTATOR — and this is the half the player actually asked for
 * ══════════════════════════════════════════════════════════════════════════ */

/** How much of the race has run by this hour. */
function progressOf(race, hour) {
  if (hour < race.hour) return 0;
  return Math.min(1, (hour - race.hour) / race.runs);
}

/**
 * THE RUNNING ORDER, RECONSTRUCTED FROM THE FEED AND FROM NOTHING ELSE.
 *
 * The engine emits `lead` when the front changes and `overtake` when a pair
 * swaps, which is exactly what a rail-side spectator is told, so the order on
 * the screen is built by replaying those two events up to the gate the clock
 * has reached. A runner who is out is pulled to the bottom with what happened
 * to it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO IS INVENT A GAP ─────────────────────
 *
 * The natural next field is "two lengths up", and the sim's distances are
 * right there on the runners. They are NOT in the event stream, and a screen
 * that prints a gap the feed never carried is a screen that knows the result
 * early — which on a card with a betting window open is the whole defect this
 * lane exists to rule out. Positions while it runs, distances at the call, and
 * `margin` is the engine's own.
 */
export function standingsAt(race, hour) {
  const result = resultOf(race);
  const at = progressOf(race, hour);
  const segments = race.ground.segments;
  const seg = Math.floor(at * segments);
  const name = new Map(race.card.entrants.map((e) => [e.id, e.name]));
  if (at >= 1) {
    return result.order.map((r) => ({
      id: r.id, name: r.name, position: r.position, status: r.status,
      dist: r.dist, condition: r.condition,
    }));
  }
  let order = race.card.entrants.map((e) => e.id);
  const status = new Map();
  const move = (id, before) => {
    const i = order.indexOf(id);
    if (i < 0) return;
    order.splice(i, 1);
    const j = before == null ? order.length : order.indexOf(before);
    order.splice(j < 0 ? order.length : j, 0, id);
  };
  for (const ev of result.events) {
    if (ev.t > seg) break;
    if (ev.type === 'lead') { const first = order[0]; if (first !== ev.who) move(ev.who, first); }
    else if (ev.type === 'overtake') move(ev.who, ev.past);
    else if (ev.type === 'retire') status.set(ev.who, 'retired');
    else if (ev.type === 'beaten') status.set(ev.who, 'beaten');
    else if (ev.type === 'refusal') status.set(ev.who, 'refused');
  }
  const live = order.filter((id) => !status.has(id));
  const out = order.filter((id) => status.has(id));
  return [...live, ...out].map((id, i) => ({
    id, name: name.get(id), position: i + 1,
    status: status.get(id) || 'running', dist: null, condition: null,
  }));
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WATCH. NO STAKE, NO TICKET, NO PARAMETER ONE COULD HIDE IN.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you don't have to bet to watch (applies to any casino game)."*
 *
 * A place, a day and an hour, and back comes everything the room contains: the
 * board, the field, the going, how far in it is, who is ahead, every line the
 * announcer has said so far, and — once it is over — the call. There is no
 * argument for a ticket and no field that changes if one exists, so a player
 * who never bets a credit is reading the identical screen. The check drives
 * the same hour with a hundred tickets against it and compares the two
 * readings field for field.
 *
 * Between races it says between races; on a dark night it says the room is a
 * room and when the next card is. That is not a failure state, it is the
 * station having a timetable.
 */
export function watch(venueId, day = 0, hour = 0) {
  const v = venueById(venueId);
  if (!v) throw new Error(`no such venue: ${venueId}`);
  const card = cardAt(venueId, day);
  const all = card.meets.flatMap((m) => m.races);
  const reading = {
    venue: v.id, place: v.place, name: v.name, word: v.word, crowd: v.crowd,
    day: day | 0, hour, dark: card.dark,
    meet: null, phase: 'dark', race: null, board: null,
    progress: 0, segment: 0, segments: 0,
    standings: [], calls: [], winner: null, margin: 0,
    /* The next one off, as a LINE ON A BOARD rather than a whole race — a
     * reading is a thing a screen prints, and handing back the card's runners
     * and their form for a race that has not been dressed yet is a page
     * nobody asked for. */
    next: (() => { const r = all.find((x) => x.hour > hour); return r ? { id: r.id, hour: r.hour, ground: r.ground.name } : null; })(),
    /* THE ONE FIELD THAT IS A STATEMENT. Nothing below this line was gated on
     * a stake, and nothing above it can be. */
    free: true,
  };
  if (card.dark) return reading;
  const meet = meetAt(venueId, day, hour);
  if (!meet) { reading.phase = reading.next ? 'closed' : 'over'; return reading; }
  reading.meet = { index: meet.index, from: meet.from, to: meet.to, races: meet.races.length };
  const race = [...meet.races].reverse().find((r) => hour >= r.hour) || null;
  if (!race) {
    /* The field is out and the board is up and nothing has run yet — which is
     * the best half hour in the room and is a phase of its own. */
    reading.phase = 'parading';
    reading.race = meet.races[0];
    reading.board = boardFor(meet.races[0]);
    return reading;
  }
  const result = resultOf(race);
  const at = progressOf(race, hour);
  reading.race = race;
  reading.board = boardFor(race);
  reading.progress = round2(at);
  reading.segments = race.ground.segments;
  reading.segment = Math.min(race.ground.segments, Math.floor(at * race.ground.segments));
  reading.standings = standingsAt(race, hour);
  reading.phase = at >= 1 ? 'called' : 'running';
  reading.calls = result.events
    .filter((ev) => ev.t <= reading.segment && (MOMENTS.includes(ev.type) || ev.type === 'off'))
    .filter((ev) => at >= 1 || (ev.type !== 'result' && ev.type !== 'placed'))
    .map((ev) => announce(ev, race.card))
    .filter(Boolean);
  if (at >= 1) {
    reading.winner = result.winner;
    reading.margin = result.events.find((ev) => ev.type === 'result')?.margin || 0;
  }
  return reading;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE CUT, MEASURED
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT ACTUALLY COMES BACK, OVER THOUSANDS OF SETTLED RACES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Not the take in the table — what the settlement pays. `drumEdge` exists
 * because the Drum's first payout table handed the PLAYER 63% and read as
 * perfectly sensible on the page, and this is the same function for a market
 * whose prices are derived three deep: a quadrature, then Harville, then a cut,
 * then a rounding.
 *
 * ── IT BUYS THE WHOLE BOOK, IN PROPORTION TO THE PRICES ──────────────────
 *
 * The house's cut is the amount by which the book is OVER-ROUND, and the only
 * stake with no opinion in it is one spread across every row in proportion to
 * what that row is quoted at. Back the whole book that way and exactly one row
 * pays; what comes back is `1 − take` however wrong the model behind the prices
 * happens to be, so this measurement is of the ARITHMETIC — the renormalising,
 * Harville's sum, the 1.05 floor, the rounding — and not of the quadrature.
 *
 * THE FIRST VERSION STAKED ONE UNIT ON EVERY RUNNER INSTEAD, and it read
 * 23.7% in the Pit on a declared take of 8%. That number is real and it is not
 * the house's cut: the board is deliberately FLATTER than the truth (it cannot
 * see the hidden terms, so from where it stands the race really is less
 * predictable), which prices outsiders shorter than they deserve, and a bettor
 * spreading his money evenly is mostly buying outsiders. That is the
 * favourite–longshot bias, it is what makes reading the form pay, and it
 * belongs in the check that measures bettors — `randomReturn` below — rather
 * than in the one that measures the window's cut.
 *
 * THE BOOK IS BOUGHT AT A HUNDRED THOUSAND, for `settleTickets`'s reason: at a
 * stake of 1 the rounding IS the edge and every price change measures as no
 * change at all. No player may stake that — `MAX_STAKE` is 900 — which is the
 * point: a measurement is not a bet.
 */
const BOOK_UNIT = 100000;

export function edgeOf(kind = 'win', { venue = 'holo-theatre', races = 3000, from = 0 } = {}) {
  let staked = 0, back = 0, n = 0;
  for (const step of walkVenue(venue, { from, days: races })) {
    if (n >= races) break;
    const board = boardFor(step.race);
    const tickets = [];
    if (kind === 'field') {
      if (!board.field) continue;
      tickets.push({ kind, on: board.field.against, price: board.field.price, stake: BOOK_UNIT, places: 0 });
    } else {
      if (kind === 'place' && !board.places) continue;
      for (const r of board.runners) {
        const p = kind === 'place' ? r.placeP : r.marketP;
        tickets.push({
          kind, on: r.id, price: kind === 'place' ? r.place : r.win,
          stake: Math.round(BOOK_UNIT * p), places: board.places,
        });
      }
    }
    const led = settleTickets(tickets, resultOf(step.race));
    staked += led.staked;
    back += led.returned;
    n++;
  }
  return { edge: staked ? 1 - back / staked : 0, races: n, staked, returned: back };
}

/**
 * WHAT A BETTOR WITH NO OPINION AT ALL GETS BACK — one unit on a runner picked
 * off the card with a pin, over thousands of races.
 *
 * It is NOT the house's cut and it is always worse than it, for the reason
 * `edgeOf` records. It is here because it is the floor every other bettor is
 * measured against: *"a good better will probably make money over time"* is a
 * claim about beating THIS number, and a claim about a number nobody computed
 * is a decoration.
 *
 * Averaged over every runner the pin could have landed on rather than sampled
 * by an actual coin — the same measurement with the picking noise taken out,
 * which is how a 7% edge is read in three thousand races instead of three
 * hundred thousand.
 */
export function randomReturn({ venue = 'holo-theatre', kind = 'win', races = 3000, from = 0 } = {}) {
  let staked = 0, back = 0, n = 0;
  for (const step of walkVenue(venue, { from, days: races })) {
    if (n >= races) break;
    const board = boardFor(step.race);
    if (kind === 'place' && !board.places) continue;
    const tickets = board.runners.map((r) => ({
      kind, on: r.id, price: kind === 'place' ? r.place : r.win,
      stake: BOOK_UNIT, places: board.places,
    }));
    const led = settleTickets(tickets, resultOf(step.race));
    staked += led.staked;
    back += led.returned;
    n++;
  }
  return { roi: staked ? back / staked - 1 : 0, races: n };
}
