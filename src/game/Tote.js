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
 * credits move in `Station.js`'s `stakeAtTote`/`payAtTote`, a dozen lines
 * beside the interact key, which are the only place the two doors are opened.
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
  runSpectacle, recordResult, readForm, announce, MOMENTS,
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
    word: 'race', runners: 'the field',
    crowd: { size: 60, temper: 0.55, says: 'sixty in the seats' },
    grounds: ['boonta', 'vinta', 'ord'],
    yard: 20, meets: [1, 2], hours: [12, 21], length: [2.5, 4], every: 0.5, runs: 0.3,
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
    word: 'bout', runners: 'the card',
    crowd: { size: 12, temper: 1, says: 'twelve at the rail' },
    grounds: ['pit-floor'],
    yard: 14, meets: [1, 1], hours: [19, 23], length: [2, 3.5], every: 0.5, runs: 0.3,
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
    word: 'bout', runners: 'the pair',
    crowd: { size: 12, temper: 0.7, says: 'twelve on the benches' },
    grounds: ['arena-sand'],
    yard: 12, meets: [1, 2], hours: [10, 20], length: [1.5, 3], every: 0.5, runs: 0.25,
    dark: 0.18,
    /* THE MARSHAL MATCHES THE PAIR — see `drawField`, which carries the
     * measurement. A refereed bout is made, not drawn out of a hat, and it is
     * the one venue where that is a betting decision as well as a fiction. */
    graded: true,
  },
].map((v) => Object.freeze({ ...v, crowd: Object.freeze(v.crowd) })));

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

/**
 * HOW FAR BACK THE PUBLIC FORM BOOK RUNS.
 *
 * A constant and not an option, for the reason in the header: a bout carries a
 * grudge out of the replay, so two readers running different windows are two
 * readers watching different races.
 *
 * Twelve days is eighteen to thirty-odd starts a runner at the Holo-theatre —
 * measured — which is well past what `Spectacle.readForm` needs to split a
 * form line on the going, and short of the sixty rows `LOG_KEEP` would hold.
 * A shorter book is a reading room with nothing in it and a longer one is a
 * fortnight of races run every time somebody opens a door.
 */
export const FORM_DAYS = 12;

/** How long the field is out before the first one goes off. */
export const PARADE = 0.4;

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
  let earliest = v.hours[0];
  for (let m = 0; m < n; m++) {
    const span = v.hours[1] - earliest;
    if (span <= 1) break;
    const from = round2(earliest + rng() * Math.max(0, span - 1));
    const length = round2(v.length[0] + rng() * (v.length[1] - v.length[0]));
    const to = round2(Math.min(v.hours[1] + 1, from + length));
    const races = [];
    /* THE PARADE. A meet OPENS before anything runs — the field is out, the
     * board is up and nothing has happened yet, which is the best twenty
     * minutes in the room and the only stretch in which every market on the
     * whole card is still open. A meet whose first race went off at the door
     * would have no such phase, and `watch` would carry a state the room could
     * never actually be in. */
    for (let k = 0, hour = from + PARADE; hour + v.runs <= to; k++, hour = round2(from + PARADE + k * v.every)) {
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
 * MEASURED, over 19,200 bouts across 24 independent yards, with an open draw:
 * one bout in five had a runner priced under a tenth, the board priced that
 * band at 0.055 and it won 0.072. A hundredth and a half of error reads as
 * nothing — at a price of 17.3 it is +25% to anybody who backs the underdog
 * every night, forever. The same table is excellent where the pair is close:
 * 0.452 priced against 0.447 won, 0.548 against 0.553. So the leak is not in
 * the model, it is in WHICH PART OF THE MODEL THE WINDOW SELLS.
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
        const result = resultOf(race);
        recordResult(race.card, race.ground, result);
        writeHeadToHead(race.card, result);
      }
    }
  }
  return stable;
}

/**
 * WHO BEAT WHOM — the tote's own column, and the only thing here the engine's
 * log does not already carry.
 *
 * `Spectacle.recordResult` writes where a runner FINISHED; it does not write
 * who it finished behind, because a form line is `1-3-2-1-4-4` and that is what
 * a form line is. But the same function, on a bout, gives every beaten entrant
 * a hidden GRUDGE against the one that beat it — up to 0.55 on a scale where a
 * whole rating point is worth 1/22 — and the board cannot see it.
 *
 * That grudge is created by a PUBLIC event. Anybody at the rail last Tuesday
 * saw who put whom down, and the tote replays last Tuesday anyway. So the
 * head-to-head is published: a column on the card, exactly as a real fight
 * bill prints "their last meeting". It is the reason the Pit and the Arena
 * have a reading room at all — the going and the footing are nine tenths
 * unreadable there by the engine's own `leftBlind`, and this is not.
 *
 * It is a COUNT and not a strength. What a grudge is worth is the punter's
 * problem, and `tools/checks/tote.mjs` has one who prices it.
 */
function writeHeadToHead(card, result) {
  if (!result?.winner) return;
  /* ONLY WHERE THERE IS A GRUDGE TO PUBLISH. `recordResult` writes the hidden
   * term for a BOUT and nothing else, so a head-to-head column on a podrace
   * would be a printed number that predicts nothing — which is the same defect
   * as a form line the sim does not read, wearing a fight bill's clothes. Who
   * beat whom in a field of eight is already in the form line. */
  if (SKINS[card.skin]?.mode !== 'bout') return;
  for (const row of result.order) {
    if (row.position === 1) continue;
    const e = card.entrants.find((x) => x.id === row.id);
    if (!e) continue;
    e.form.beaten = e.form.beaten || {};
    e.form.beaten[result.winner] = (e.form.beaten[result.winner] || 0) + 1;
  }
}

/** How many times this one has been beaten by that one, in the public book. */
export const beatenBy = (e, id) => (e.form.beaten?.[id] || 0);

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

const CARDS = new Map();
const CARD_KEEP = 8;

/** Forget the replayed books and the day's cards. Only a check calls this. */
export function clearTote() { BOOKS.clear(); CARDS.clear(); }

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
  /* `priceCard` rounds `marketP` for printing, so the column no longer sums to
   * exactly one. Renormalised before anything is derived from it: a place
   * market built on a book that adds to 0.997 is 0.3% long on every row, and
   * the house would find that out before the player did. */
  const sum = rows.reduce((a, r) => a + r.marketP, 0) || 1;
  const p = rows.map((r) => r.marketP / sum);
  const k = placesPaid(race.card.entrants.length);
  const runners = rows.map((r, i) => {
    const e = race.card.entrants[i];
    /* THE FORM, ON THE CARD, BECAUSE A CARD WITH NO FORM ON IT IS A PRICE LIST.
     *
     * Everything below is public by construction — the rating and the last six
     * finishes the engine's log already carries, the going line `readForm`
     * recovers from that log, and this file's own head-to-head column against
     * THE RUNNERS IN THIS RACE. Nothing here is a hidden term and the check
     * that rotates the hidden half under the board proves it: none of these
     * move when it does.
     *
     * It is on the board row rather than in a second call because the room
     * that renders this must be able to print a form line without knowing what
     * a form line is — the same bargain the price is on this row for. */
    const read = readForm(e, race.ground);
    let beaten = 0, beat = 0;
    for (const f of race.card.entrants) {
      if (f === e) continue;
      beaten += beatenBy(e, f.id);
      beat += beatenBy(f, e.id);
    }
    const row = {
      id: r.id, name: e.name, kind: e.kind, rating: e.form.rating,
      recent: e.form.recent.slice(), marketP: Math.round(p[i] * 1000) / 1000,
      starts: e.form.starts, wins: e.form.wins,
      /* What the reading room could recover about tonight's going, and how
       * many starts it had to read to say it. */
      going: round2(read.going), standing: round2(read.standing), read: read.starts,
      /* Their last meetings, both ways round, exactly as a fight bill prints
       * them. `beaten` is what this one CARRIES into tonight. */
      beaten, beat,
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
     * on the board at a better price.
     *
     * IT IS THE ONE MARKET WHOSE MEASURED CUT IS NOT ITS DECLARED ONE, and
     * that is structural rather than a miss. Win and place are books — every
     * runner has a price and buying all of them returns `1 − take` whatever the
     * model thinks. The field is a SINGLE outcome with no complement quoted
     * beside it, so nothing forces the arithmetic and only the measurement can
     * say what the cut is: 5.5% declared, 7.0–7.7% measured, because the board
     * is flatter than the truth and therefore understates its own favourite. */
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
export const MAX_STAKE = 2200;

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
 * `drumEdge` names the same trap. `edgeOf` buys the book at a hundred thousand
 * for exactly that reason, which is a size no player may stake — `MAX_STAKE`
 * is 2200 — and that is the point: a measurement is not a bet.
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
 *
 * ── AND THE MEMO IS ON THE RACE AND NOT IN A MAP BESIDE IT ───────────────
 *
 * The first cut kept a module-level cache keyed by `race.id` — the place, the
 * day and the index — which is unique for the station, because a venue has one
 * yard. It is NOT unique for a measurement: `tools/checks/tote.mjs` rides a
 * dozen INDEPENDENT yards through the same days, and every one of them after
 * the first was handed the first yard's results for its own runners. Measured,
 * that read a pin losing 23.8% at the Arena against a true 5.5%, and it read
 * as a balance problem rather than as a cache.
 *
 * A memo on the bound race cannot collide, because the bound race IS the
 * field. It lives exactly as long as `cardAt` holds the day, which is what the
 * cache was for.
 */
export function resultOf(race) {
  if (race._result) return race._result;
  race._result = runSpectacle({ card: race.card, ground: race.ground, seed: race.runSeed });
  return race._result;
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
 * THE RUNNING ORDER, READ OFF THE FEED AND OVER THE CARD IN YOUR HAND.
 *
 * The engine emits `lead` when the front changes and `overtake` when a pair
 * swaps, which is exactly what a rail-side spectator is told, so the order on
 * the screen is built by replaying those two events up to the gate the clock
 * has reached. A runner who is out is pulled to the bottom with what happened
 * to it.
 *
 * ── WHAT IS EXACT AND WHAT IS THE FEED'S OWN ACCOUNT ─────────────────────
 *
 * EXACT, and the check holds it: who is in FRONT at every gate, and who is out
 * and why. The engine names the leader on every change and every retirement,
 * refusal and beating as it happens, so those are not reconstructions.
 *
 * THE FEED'S ACCOUNT, and not claimed to be more: the places behind the
 * leader. The stream carries overtakes between adjacent pairs and nothing
 * else, so the rest of the order starts from the board — the card in your hand
 * — and is shuffled by the swaps as they are called. A screen shows the front
 * of the race and a running list, which is what a screen at a racetrack shows.
 *
 * ── AND IT DELIBERATELY DOES NOT INVENT A GAP ────────────────────────────
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
  /* THE GATE UNDER WAY, not the last one completed. A screen showing gate 15
   * while the field is coming out of 16 is a screen a second behind, and the
   * gate the crowd is watching is the one being run. It also makes the reading
   * at the line agree with the judge: the last lead change of a race happens
   * ON the last gate, and a floor here had the feed calling Boleskin while
   * Arkroo took it — which is how this was caught. */
  const seg = Math.min(segments, Math.max(0, Math.ceil(at * segments)));
  const name = new Map(race.card.entrants.map((e) => [e.id, e.name]));
  if (at >= 1) {
    return result.order.map((r) => ({
      id: r.id, name: r.name, position: r.position, status: r.status,
      dist: r.dist, condition: r.condition,
    }));
  }
  /**
   * ── WHO WAS IN FRONT BEFORE ANYBODY WAS ANNOUNCED ──────────────────────
   *
   * The engine emits `lead` on a CHANGE, so the first runner to hold the front
   * is never named — and a screen seeded with the card's own order then has
   * the wrong pod in front for as long as that one keeps it, which is how this
   * was caught: the feed had Cleggano and the judge called Arkdon.
   *
   * It is recoverable exactly and without touching the result: the first
   * `lead` event carries `from`, which IS whoever was in front until then. A
   * race with no lead change at all was led wire to wire by whoever came home
   * first. Neither reads a distance and neither knows anything a spectator at
   * the rail does not.
   */
  const firstLead = result.events.find((ev) => ev.type === 'lead');
  const front = firstLead ? firstLead.from
    : (result.order.find((o) => o.status === 'finished')?.id ?? result.order[0]?.id ?? null);
  /* Behind the leader, the screen starts from the BOARD — which is what the
   * card in the spectator's hand says and the only ordering of a field that
   * anybody has before the tapes go up. It is not the running order and it is
   * not claimed to be; see the note above for exactly which line is. */
  let order = boardFor(race).runners.map((r) => r.id);
  if (front) order = [front, ...order.filter((id) => id !== front)];
  const status = new Map();
  /**
   * ── AN OVERTAKE IS A SWAP AND A LEAD IS THE LAST WORD ──────────────────
   *
   * Two things had to be got right here and the first cut got both wrong.
   *
   * An overtake was applied as "lift this one out and put it in front of that
   * one", which MOVES EVERYBODY IN BETWEEN. The engine emits it for a pair
   * that were adjacent and swapped, so it is a swap; an insertion re-sorted
   * runners the event says nothing about.
   *
   * And a gate's events arrive lead-first, so applying them in the order they
   * were emitted let a following overtake undo the lead the same gate had just
   * announced — the feed had Arkano in front of a race Teemkin won by a length
   * and a quarter. Within a gate the overtakes are applied and THEN the lead,
   * because the lead event is the announcement of where the front finished up.
   */
  const swap = (a, b) => {
    const i = order.indexOf(a), j = order.indexOf(b);
    if (i < 0 || j < 0) return;
    order[i] = b; order[j] = a;
  };
  const toFront = (id) => {
    const i = order.indexOf(id);
    if (i <= 0) return;
    order.splice(i, 1);
    order.unshift(id);
  };
  const gates = new Map();
  for (const ev of result.events) {
    if (ev.t > seg) break;
    if (!gates.has(ev.t)) gates.set(ev.t, []);
    gates.get(ev.t).push(ev);
  }
  for (const [, evs] of gates) {
    for (const ev of evs) {
      if (ev.type === 'overtake') swap(ev.who, ev.past);
      else if (ev.type === 'retire') status.set(ev.who, 'retired');
      else if (ev.type === 'beaten') status.set(ev.who, 'beaten');
      else if (ev.type === 'refusal') status.set(ev.who, 'refused');
    }
    for (const ev of evs) if (ev.type === 'lead') toFront(ev.who);
  }
  const live = order.filter((id) => !status.has(id));
  const out = order.filter((id) => status.has(id));
  return [...live, ...out].map((id, i) => ({
    id, name: name.get(id), position: i + 1,
    status: status.get(id) || 'running', dist: null, condition: null,
  }));
}


/* ══════════════════════════════════════════════════════════════════════════
 *  THE CROWD — §G4, and the reason this section exists at all
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"a crowd that reacts to what happens in the pit/arena/race."*
 *
 * `crowd` was a STRING on every venue row — "sixty in the seats" — and an
 * audit found what a string is worth: `grep -rn crowd src/` turned up the
 * declaration and NO READER anywhere in the tree. The row promised a room
 * full of people and the game had twelve words about them. The announcer was
 * DOM text and nothing else; a race could be won by a nose, by a 40/1 shot,
 * with the whole card turned over on the last gate, and the room made exactly
 * the same amount of noise as a walkover.
 *
 * So the row is now `{ size, temper, says }` and this is the model that reads
 * it. `says` keeps the prose the row always had; `size` is how many are in
 * when the room is full, and `temper` is how loud one of them is — twelve at
 * the Pit's rail are LOUDER than sixty in the Holo-theatre's seats, which is
 * the whole difference between the two rooms and cannot be said with a
 * headcount alone.
 *
 * ── WHAT A CROWD IS ACTUALLY REACTING TO ─────────────────────────────────
 *
 * Not "an event happened". Three things, and they are the three a rail
 * actually shouts at:
 *
 *   A NEAR FINISH  — `margin` off the engine's own `result` event.
 *   AN UPSET       — the winner's price on the board this file already prints.
 *   THE MONEY HOME — the favourite winning is a smaller, flatter cheer, and it
 *                    is not silence: half the room backed it.
 *
 * A longshot by a nose is the loudest thing that can happen in any of these
 * rooms and a favourite strolling in is the quietest thing that is still a
 * result, and the two must not measure the same. Everything mid-race — a lead
 * change, an overtake, a knockdown, a retirement — is weighted by WHEN, because
 * a lead change on the last gate is a race and one on the first is a start.
 *
 * ── AND IT IS DERIVED, NOT STORED ────────────────────────────────────────
 *
 * Same bargain as the rest of the file: the reaction at an hour is a pure
 * function of `(venue, day, hour)`, so two players standing in the same room
 * hear the same roar with nothing written down. The only stochastic term is
 * the night's attendance, seeded off `(venue, day)` exactly as the card is.
 */

/**
 * WHAT EACH MOMENT IS WORTH BEFORE ANY OF THE ABOVE IS APPLIED.
 *
 * The engine's `MOMENTS` plus `off`, which is not a moment but is the noise a
 * room makes when the tapes go up. A result is 1 because the call is the
 * loudest thing in any race; an overtake is 0.24 because at the Holo-theatre
 * there are eighty of them in an afternoon.
 */
export const CROWD_WEIGHT = Object.freeze({
  result: 1, beaten: 0.74, knockdown: 0.6, retire: 0.55, wall: 0.5,
  mechanical: 0.44, refusal: 0.36, lead: 0.34, overtake: 0.24, off: 0.3,
});

/**
 * HOW LONG A ROAR TAKES TO DIE BACK TO THE MURMUR, IN STATION HOURS.
 *
 * §3.4 is one station hour per two real minutes, so 0.035 h is about four and
 * a quarter real seconds — a cheer, not a chant, and long enough that the
 * panel's four-a-second beat sees it rise and fall rather than blink.
 *
 * IN HOURS AND NOT IN GATES, which is what it was first written as and is
 * wrong: a Pit bout is 54 gates in the same 0.3 h a Holo-theatre race spends
 * on 16, so "1.6 gates" was 3.6 real seconds in one room and 1.1 in another.
 * A crowd does not shorten its cheer because the sim ticks faster. The floor
 * below keeps it at least a gate wide wherever a gate is longer than this.
 */
export const CROWD_FADE = 0.035;

/** A margin (in the engine's own distance units) that is a photograph. */
export const CROWD_NOSE = 1.2;

/**
 * HOW BIG A MOMENT IS, 0..1, WITH NOTHING ABOUT THE ROOM IN IT.
 *
 * Deliberately separate from `crowdVoice`: this is what HAPPENED and that is
 * who is watching, and mixing the two would make a quiet room's photo-finish
 * indistinguishable from a loud room's walkover.
 *
 * It reads the board, which is the public price and not the hidden model — a
 * crowd is surprised by what it was TOLD was unlikely, which is the same
 * information the punter beside it had.
 */
export function dramaOf(ev, race, board) {
  if (!ev) return 0;
  const base = CROWD_WEIGHT[ev.type] ?? 0.2;
  const segments = race?.ground?.segments || 1;
  if (ev.type === 'result') {
    const p = board?.runners?.find((r) => r.id === ev.who)?.marketP ?? 0.25;
    /* A photograph, and a length and a bit is not one. */
    const nose = Math.max(0, Math.min(1, 1 - Math.abs(ev.margin || 0) / CROWD_NOSE));
    /* What the board said could not happen. A 2/1 favourite is 0.17 of this;
     * a 30/1 outsider is 0.95. */
    const upset = Math.max(0, Math.min(1, 1 - p / 0.6));
    const home = ev.who && board && ev.who === board.favourite ? 1 : 0;
    /**
     * THE FAVOURITE'S OWN TERM IS SMALLER THAN THE UPSET IT REPLACES, and the
     * first cut had it the other way round at 0.22. Measured over 900 Arena
     * bouts, where there are only two in the ring and the favourite is quoted
     * around 0.6: `upset` is structurally 0 for the favourite and about 0.21
     * for the other one, so a 0.22 bonus made THE FAVOURITE WINNING the
     * loudest thing that could happen in the room. A tote whose crowd cheers
     * loudest for the short price is a room that has never been to a track.
     * 0.12 is the money coming home and it is under the smallest upset a
     * two-horse bout can produce.
     */
    return Math.max(0, Math.min(1, 0.08 + 0.42 * nose + 0.62 * upset + 0.12 * home));
  }
  /* Everything else: WHEN it happened is most of what it is worth. */
  const late = segments > 0 ? Math.max(0, Math.min(1, (ev.t || 0) / segments)) : 0;
  const fav = board && ev.who === board.favourite ? 1.25 : 1;
  return Math.max(0, Math.min(1, base * (0.55 + 0.45 * late) * fav));
}

/**
 * THE ROOM'S OWN VOICE — the venue's `crowd` row, made into numbers a room
 * can spend.
 *
 * `crowd` is the row verbatim, which is what makes this the READER the field
 * was missing: every observable below moves with `size` and with `temper`, and
 * `tote.mjs` drives this function with each venue's row and perturbations of
 * it to hold that it does.
 *
 *   `voices`  how many are in the room right now — the density a room dresses.
 *   `level`   the sustained murmur, 0..1.
 *   `swell`   the reaction on top of it, 0..1.
 */
export function crowdVoice(crowd, { drama = 0, fill = 0 } = {}) {
  const size = Math.max(0, crowd?.size || 0);
  const temper = Math.max(0, Math.min(1, crowd?.temper ?? 0.5));
  const f = Math.max(0, Math.min(1.2, fill));
  const voices = Math.round(size * f);
  /* THE MURMUR is mostly how many are in; a full room is never silent. */
  const level = Math.max(0, Math.min(1, (0.1 + 0.6 * f) * (0.55 + 0.45 * temper)));
  /* THE ROAR is what happened × how hot they are × how many throats there are.
   * Forty-eight and not sixty: a Pit at the rail is packed at twelve, and a
   * bowl that only got loud at sixty would mean the two small rooms never
   * reacted at all. The floor is 0.45 for the same reason — twelve men at a
   * rail two metres from the sand are not a fifth of sixty in a raked bowl,
   * they are most of it, and the difference the headcount is allowed to make
   * is the rest. */
  const body = Math.min(1, voices / 48);
  const swell = Math.max(0, Math.min(1,
    Math.max(0, Math.min(1, drama)) * (0.45 + 0.55 * temper) * (0.45 + 0.55 * body)));
  return { voices, level: Math.round(level * 1000) / 1000, swell: Math.round(swell * 1000) / 1000, temper, size };
}

/** How full the room is in each phase. A dark room has nobody in it. */
function fillFor(phase, progress, day, venueId) {
  /* The night's own turnout, seeded off (venue, day) like everything else
   * here, so two people in the room count the same heads. */
  const turn = 0.86 + 0.28 * seeded(`${venueId}|${day}|crowd`)();
  switch (phase) {
    case 'dark': return 0;
    case 'closed': case 'over': return 0.16 * turn;
    case 'parading': return 0.72 * turn;
    case 'running': return (0.72 + 0.28 * progress) * turn;
    case 'called': return 0.9 * turn;
    default: return 0.16 * turn;
  }
}

/**
 * THE CROWD AT AN HOUR — the reading `watch()` hands back and the thing the
 * room in `Station.js` actually spends.
 *
 * Its `swell` decays in GATES rather than in hours, so a roar lasts the same
 * fraction of a race at every venue however long that venue's races are, and
 * it goes on decaying after the call — which is why the elapsed gate count is
 * taken off the clock and not off `progress`, which is clamped at 1.
 */
function crowdIn(v, reading) {
  const fill = fillFor(reading.phase, reading.progress, reading.day, v.id);
  const race = reading.race;
  let moment = null, drama = 0, since = 0;
  if (race && reading.board && reading.phase !== 'parading') {
    const result = resultOf(race);
    const perGate = race.runs / (race.ground.segments || 1);
    const fadeH = Math.max(CROWD_FADE, perGate * 1.2);
    for (const ev of result.events) {
      if (!(CROWD_WEIGHT[ev.type] >= 0)) continue;
      /* Nothing the feed has not reached. A room that roared at a result the
       * screen has not printed is the whole defect this lane rules out. */
      if (ev.t > reading.segment) continue;
      if (ev.type === 'result' && reading.phase !== 'called') continue;
      const d = dramaOf(ev, race, reading.board);
      /* ── WHEN THE ROOM ACTUALLY HEARD IT ────────────────────────────────
       * Not `ev.t`, for the one event where the two differ. A BOUT ends when
       * one of them is done — `runSpectacle` breaks out of the gate loop — so
       * the Pit's `result` carries the gate the fight stopped on while the
       * room's window runs to `runs` hours regardless. Measured: a Pit bout
       * ended on gate 10 of 54, the call landed 44 gates in the past, and the
       * crowd's roar at the result faded to ZERO before the result was ever
       * printed. The call is heard when the feed prints it, which is the end
       * of the window; everything else is heard at its own gate. */
      const heard = ev.type === 'result' ? (race.ground.segments || 1) : (ev.t || 0);
      const g = Math.max(0, reading.hour - (race.hour + heard * perGate));
      const fade = Math.max(0, 1 - g / fadeH);
      if (d * fade > drama) { drama = d * fade; moment = ev.type; since = g; }
    }
  }
  const voice = crowdVoice(v.crowd, { drama, fill });
  return {
    says: v.crowd.says, size: v.crowd.size, temper: v.crowd.temper,
    /* THE TWO INPUTS, HANDED BACK BESIDE THE THREE OUTPUTS. `fill` and `drama`
     * are what `crowdVoice` was given and the rest is what it answered, so a
     * reader — or a check — can recompute the room from the venue's own row
     * and prove the row is what it was built from. A reading whose derivation
     * cannot be re-run is the same thing as a field with no reader. */
    fill: Math.round(fill * 10000) / 10000,
    in: voice.voices, level: voice.level, swell: voice.swell,
    moment, drama: Math.round(drama * 1000) / 1000, since: Math.round(since * 10000) / 10000,
  };
}

/**
 * THE CROWD, AS A READING OF ITS OWN — for a caller that wants the room and
 * not the card. It is `watch().crowd` and nothing else, so there is one
 * derivation and the panel and the room can never disagree about the noise.
 */
export function crowdAt(venueId, day = 0, hour = 0) {
  return watch(venueId, day, hour).crowd;
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
  const reading = readVenue(v, day, hour);
  /* ── AND THE ROOM IS FULL OF PEOPLE, WHO ARE LISTENING ─────────────────
   * The last field on the reading, and the only one that is about the people
   * in the seats rather than the card. It is computed HERE, once, off the
   * finished reading, so the panel, the noise and the bodies in the room can
   * never be reading three different crowds. It is not gated on a stake and
   * cannot be: `readVenue` never saw one. */
  reading.crowd = crowdIn(v, reading);
  return reading;
}

/** The card half of a reading — everything above the crowd. */
function readVenue(v, day, hour) {
  const venueId = v.id;
  const card = cardAt(venueId, day);
  const all = card.meets.flatMap((m) => m.races);
  const reading = {
    venue: v.id, place: v.place, name: v.name, word: v.word, crowd: null,
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
  reading.segment = Math.min(race.ground.segments, Math.max(0, Math.ceil(at * race.ground.segments)));
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
 * spreading his money evenly is mostly buying outsiders. That was read as the
 * favourite–longshot bias and it was not one: `sigma` was mis-fitted, so the
 * board's own market leader won oftener than any price on the board said he
 * would, and the money on the floor was a broken model rather than a margin
 * the house had chosen. Refitted — see `Spectacle.SKINS` — a bettor with no
 * opinion now gets back `1 − take` whichever runner he picks, which is what an
 * honest board means. Either way it belongs in the check that measures
 * BETTORS and not in the one that measures the window's arithmetic.
 *
 * THE PIN USED TO BE MEASURED HERE TOO, by a `randomReturn` that walked one
 * yard for thousands of days — long enough that every form log had saturated
 * at `LOG_KEEP` and the punter being measured held a book no player is ever
 * handed. `tools/checks/_tote-edge.mjs` does it on `bookAt`'s own fortnight,
 * through `ticketFor` and `settleTickets`, and this file no longer keeps a
 * second, kinder answer to the same question.
 *
 * THE BOOK IS BOUGHT AT A HUNDRED THOUSAND, for `settleTickets`'s reason: at a
 * stake of 1 the rounding IS the edge and every price change measures as no
 * change at all. No player may stake that — `MAX_STAKE` is 2200 — which is the
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
