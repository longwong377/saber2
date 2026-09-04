/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE WHEELHOUSE — the seam between three rules engines and one room
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you should be able to play some of the casino games these should be actual
 * games within games really put time in … in certain games you play against
 * actual npcs like it could be anyone on the ship on any day."*
 *
 * ── THE DEFECT THIS FILE EXISTS FOR, AND IT IS THE WORST KIND ─────────────
 *
 * `Games.js` was finished, commented, and 4/4 green — and it was in NO BUILD.
 * `tools/pack.mjs` walks the module graph from `main.js`; the only occurrence
 * of the string "Games.js" anywhere under `src/` was a sentence inside a
 * comment in `Bars.js`, so the packed file's manifest listed 96 `src/game`
 * modules and Games.js was not one of them. The suite was green because
 * `tools/checks/games.mjs` reaches it with a direct `import()` — a check that
 * imports a module is not evidence that a player can reach it, and this is
 * what that looks like when it goes wrong.
 *
 * That is the same shape as the seven counters that existed before `#58` had
 * a room: a system with no door. The room is the door (`StationPlan` #60,
 * `StationKit.wheelhall`); THIS is the wiring, and it is the thing that makes
 * `Games.js` a dependency of the shipped bundle rather than of the tests.
 *
 * ── WHAT IS HERE AND WHAT IS DELIBERATELY NOT ─────────────────────────────
 *
 * `Games.js` stays pure — one import, no world, no wallet, no DOM, which is
 * what lets `games.mjs` play ten thousand hands in a second and is measured
 * there. So the three things a table needs that a rule engine must not know
 * live here instead:
 *
 *   WHO IS ACROSS IT   drawn out of `StationLife.occupant`, which is the
 *                      station's own roster, so the opponent is a resident
 *                      with a name and a species and not a bot.
 *   HOW THEY PLAY      off that resident's species and temper, so a Drazi
 *                      pushes and a Minbari does not (§D1: "whose play style
 *                      comes from their species and temper").
 *   WHERE A HAND IS UP TO   a hand is `{seed, acts}` and nothing else — see
 *                      `sabaccTable` for why that is a replay and not a
 *                      state machine.
 *
 * And what is NOT here is money. `Credits.js` has one spend door and one pay
 * door and `Station.js` owns both, exactly as it does for the tote — see "THE
 * WINDOW" there. A file that both deals the cards and moves the purse is the
 * one shape the economy doctrine refuses.
 *
 * NO `Math.random` ANYWHERE. `determinism.mjs` refuses it in `src/` and the
 * whole point of a table is that two people at it agree about the cards.
 */

import { PLACE } from './StationPlan.js';
import { occupant, headcount } from './StationLife.js';
import {
  SABACC, playSabacc, sabaccScore, sabaccBot,
  DEJARIK, dejarikBoard, dejarikMoves, dejarikStep, dejarikWinner, dejarikBot,
  DRUM, drumAt, drumPays, bandOf,
} from './Games.js';

/** The room. One id, because the gazetteer is the one authority on where. */
export const WHEELHOUSE = 60;

/** The three tables, in the order the panel lists them. */
export const TABLES = [
  { id: 'sabacc', name: 'Sabacc', line: 'nearest 23 on either side; the cards shift under you' },
  { id: 'dejarik', name: 'The Dejarik Column', line: 'five pieces, a ring that shrinks, no hidden state' },
  { id: 'drum', name: 'The Drum', line: 'the house wheel, spun on the station clock, once an hour' },
];

/** The same 32-bit hash `Quests.js` and `Counter.js` use, for the same reason. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  1. WHO IS ACROSS THE TABLE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ "IT COULD BE ANYONE ON THE SHIP ON ANY DAY" ═══════════════════════════
 *
 * `Pits.handlersOn` is the precedent: draw a named person out of the roster
 * rather than inventing one, because a station that already spawns sixty real
 * bodies with names and species does not need a second population of bots.
 * `StationLife.occupant(place, i)` IS that roster — it is what puts a body in
 * slot `i` of a room — so an opponent is a slot index and nothing more.
 *
 * SEEDED ON (place, day, seat), and the middle term is the one that matters.
 * `occupant` is seeded on `p{id}s{i}` alone today, so the same slot is the
 * same person every day — the audit found that residents do NOT reroll by the
 * day and it is being fixed elsewhere. Seeding the SLOT CHOICE on the day
 * means this file is already asking a different question tomorrow, so the
 * three faces at the table start turning over the moment that fix lands and
 * nothing here has to change. A seat seeded on the place alone would have
 * been a permanent house, which is the opposite of what was asked for.
 */
export function opponentAt(placeId, day = 0, seat = 0) {
  const place = PLACE.get(placeId);
  if (!place) return null;
  /* Out of who is actually IN the room at its own busy hour — the same
   * `headcount` the pool seats bodies from, so an opponent is somebody you
   * can also walk up to. Never zero: a table needs a dealer even at noon. */
  const n = Math.max(1, headcount(place, place.peak ?? 13));
  const slot = hashOf(`seat:${placeId}:${day | 0}:${seat | 0}`) % n;
  const res = occupant(place, slot);
  if (!res) return null;
  return {
    seat: seat | 0, slot,
    seed: res.seed,
    name: res.name,
    species: res.species,
    role: res.role,
    ...temperOf(res),
  };
}

/**
 * HOW A PERSON PLAYS, off their species and their own seed.
 *
 * §D1 asks for "NPCs whose play style comes from their species and temper",
 * and two numbers carry all of it because sabacc only ever asks two questions:
 *
 *   `push`   how far off the target they will still stand pat. High is a
 *            gambler who sits on a bad hand; low is a player who keeps
 *            drawing.
 *   `nerve`  how deep a bomb-out they will try to draw out of before they
 *            throw the hand in.
 *
 * The species term is a real bias and the seed term is the individual, so two
 * Drazi at one table are both pushy and not the same player.
 */
const SPECIES_PUSH = {
  drazi: 2.4, narn: 1.6, human: 0, centauri: -0.8, minbari: -1.8,
  vorlon: -2.2, brakiri: 1.1, gaim: -1.2, pakmara: 0.6, llort: 1.8,
};
function temperOf(res) {
  const bias = SPECIES_PUSH[res.species] ?? 0;
  const own = (hashOf(`temper:${res.seed}`) % 1000) / 1000 - 0.5;
  return {
    push: Math.max(1, Math.min(9, 4 + bias + own * 3)),
    nerve: Math.max(2, Math.min(16, 9 + bias * 1.4 + own * 5)),
  };
}

/**
 * That temper, as the function `playSabacc` actually takes.
 *
 * IT IS `sabaccBot` WITH THE DIALS MOVED, not a second bot. `games.mjs`
 * measures that a player who knows the rules beats one who does not, over
 * three thousand hands, against `sabaccBot` — a table full of hand-written
 * opponents would be three strategies nobody has ever measured sitting at the
 * one table that check believes in.
 */
export function botFor(who) {
  const push = who?.push ?? 4, nerve = who?.nerve ?? 9;
  return (view) => {
    const s = sabaccScore(view.hand);
    if (s.bomb) return (Math.abs(s.sum) - SABACC.TARGET) > nerve ? 'fold' : 'draw';
    if (s.off <= push) return 'hold';
    return sabaccBot(view);
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  2. SABACC — a hand is a seed and a list of verbs
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY A HAND IS A REPLAY AND NOT A STATE MACHINE ────────────────────────
 *
 * `playSabacc` deals, shifts and shows down in one synchronous pass over
 * player FUNCTIONS. A panel needs the hand to stop and wait for a person, and
 * there are two ways to get that: cut the engine open and expose the deck, or
 * re-run the whole hand from the seed every time the person decides.
 *
 * The second, and it is not a compromise. The hand is three decisions long and
 * the engine is pure, so a replay is free — and it means the ONLY state the
 * panel holds is `{seed, acts}`, which cannot drift out of step with the
 * rules, cannot be half-written, and can be re-read from a save or handed to a
 * check verbatim. Cutting the engine open would have put a second copy of the
 * shift in this file, which is the defect `StationPlan.js`'s header is about.
 *
 * The player is always seat 0.
 */
export function sabaccTable(placeId, day = 0, index = 0, acts = [], foes = 3) {
  /* THREE, because §D1 says three: *"against 3 station NPCs whose play style
   * comes from their species and temper."* Seat 0 is you. */
  const who = [];
  for (let i = 1; i <= Math.max(1, foes); i++) who.push(opponentAt(placeId, day, i));
  const seed = hashOf(`sabacc:${placeId}:${day | 0}:${index | 0}`);
  const views = [];
  const me = (view) => {
    views.push(view);
    /* Past what the person has actually said, HOLD — so the replay always
     * finishes and `views.length` is exactly how many times they will be
     * asked. Nothing downstream reads the outcome until they have said it. */
    return acts[views.length - 1] ?? 'hold';
  };
  const r = playSabacc([me, ...who.map(botFor)], seed);
  const asked = views.length;
  const done = acts.length >= asked;
  const view = done ? null : views[acts.length];
  const scores = r.hands.map((h, i) => ({ ...sabaccScore(h), out: r.out[i] }));
  return {
    game: 'sabacc', place: placeId, day: day | 0, index: index | 0,
    seed, acts: acts.slice(), seats: who,
    /* WHAT THE PLAYER MAY SEE. Their own cards and how many everyone else
     * holds — never the deck and never a face-down hand, which is the same
     * view `playSabacc` hands a bot and for the same reason. */
    hand: view ? view.hand : r.hands[0],
    round: view ? view.round : SABACC.ROUNDS,
    rounds: SABACC.ROUNDS, target: SABACC.TARGET, shift: SABACC.SHIFT,
    others: view ? view.others : r.hands.map((h, k) => (k === 0 ? null : (r.out[k] ? 0 : h.length))),
    score: sabaccScore(view ? view.hand : r.hands[0]),
    can: done ? [] : ['hold', 'draw', 'fold'],
    done,
    /* Only once the hand is over. A panel cannot show a showdown it has not
     * played to, because there is nothing here that knows one. */
    result: done ? {
      winner: r.winner, pure: r.pure, hands: r.hands, scores,
      won: r.winner === 0,
      line: r.winner < 0 ? 'nobody takes it'
        : r.winner === 0 ? (r.pure ? 'pure sabacc — you take it' : 'you take it')
          : `${who[r.winner - 1]?.name || 'the house'} takes it`,
    } : null,
    /* Every shift that landed, so the panel can say WHY a made hand died —
     * the shift is the game and a hand that changed under you in silence is
     * the one thing that would read as a bug. */
    shifts: r.events.filter((e) => e.t === 'shift' && e.who === 0).length,
  };
}

/** The next hand at this table. A hand is an index, so nothing is stored. */
export function nextHand(table) { return { index: (table?.index | 0) + 1, acts: [] }; }

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE DEJARIK COLUMN — perfect information, so the state IS the board
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The opposite of sabacc on purpose: nothing hidden, so there is nothing to
 * replay and the board itself is the whole state. The player is side 0.
 */
export function dejarikTable(placeId, day = 0) {
  return {
    game: 'dejarik', place: placeId, day: day | 0,
    board: dejarikBoard(),
    ring: DEJARIK.RING, shrink: DEJARIK.SHRINK_EVERY, maxTurns: DEJARIK.MAX_TURNS,
    against: opponentAt(placeId, day, 1),
    moves: dejarikMoves(dejarikBoard()),
    winner: null, last: null,
  };
}

/**
 * One turn: your move, then theirs.
 *
 * BOTH IN ONE CALL, because a board handed back with the opponent still to
 * move is a board the panel would have to remember to poke. The reply is
 * named in what comes back so the room can show what they did.
 */
export function dejarikTurn(table, mv) {
  const legal = dejarikMoves(table.board);
  const pick = legal.find((m) => m.from === mv?.from && m.to === mv?.to);
  if (!pick) return { ...table, why: 'that piece cannot go there' };
  let b = dejarikStep(table.board, pick);
  let w = dejarikWinner(b);
  let reply = null;
  if (w === null) {
    /* Seeded on the board's own turn count, so the same position always draws
     * the same reply and a player can study it. `dejarikBot` takes a seed for
     * exactly this reason. */
    reply = dejarikBot(b, hashOf(`dejarik:${table.place}:${table.day}:${b.turn}`));
    if (!reply) w = 0;
    else { b = dejarikStep(b, reply); w = dejarikWinner(b); }
  }
  return {
    ...table, board: b, winner: w, why: null,
    moves: w === null ? dejarikMoves(b) : [],
    last: { mine: pick, theirs: reply },
    line: w === null ? null : w === 0 ? 'you take the column' : w === 1 ? `${table.against?.name || 'the house'} takes the column` : 'the ring closes on both of you',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  4. THE DRUM — the one you cannot re-take
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"it runs once an hour whether you are there or not."* `drumAt` is a pure
 * function of `(hour, day)` and the hour is the station's own clock, so this
 * file adds nothing to it but the reading: where it stands, what that segment
 * is, and what a bet on it would have been worth. Walking out and back in
 * gets you the same spin, which is the entire reason the game exists.
 */
export function drumTable(hour = 0, day = 0) {
  const h = ((hour | 0) % 24 + 24) % 24;
  const at = drumAt(h, day);
  const seg = DRUM.SEGMENTS[at];
  const prev = [];
  for (let k = 1; k <= 6; k++) {
    /* The last six hours, which is the form book: a wheel with no history is
     * a wheel nobody can be wrong about. */
    const ph = (h - k + 24) % 24, pd = h - k < 0 ? (day | 0) - 1 : (day | 0);
    const pa = drumAt(ph, pd);
    prev.push({ hour: ph, at: pa, deck: DRUM.SEGMENTS[pa] });
  }
  return {
    game: 'drum', hour: h, day: day | 0,
    at, deck: seg, house: seg === null,
    band: seg === null ? -1 : bandOf(seg),
    spine: at % 2,
    segments: DRUM.SEGMENTS.slice(),
    bands: DRUM.BANDS.map((b) => b.slice()),
    pays: { deck: DRUM.DECK_PAYS, band: DRUM.BAND_PAYS, spine: DRUM.SPINE_PAYS },
    prev,
  };
}

/** What a bet would return against a stop. Pricing only — see the header. */
export function drumQuote(bet, at) { return drumPays(bet, at); }

/** Every bet the room will take, so a panel does not have to know the wheel. */
export function drumBets() {
  const out = [];
  for (const d of DRUM.BANDS.flat()) out.push({ kind: 'deck', on: d, label: `deck ${d}`, pays: DRUM.DECK_PAYS });
  for (let i = 0; i < DRUM.BANDS.length; i++) {
    out.push({ kind: 'band', on: i, label: `${['the low decks', 'the living decks', 'the high decks'][i]}`, pays: DRUM.BAND_PAYS });
  }
  out.push({ kind: 'spine', on: 0, label: 'the even spine', pays: DRUM.SPINE_PAYS });
  out.push({ kind: 'spine', on: 1, label: 'the odd spine', pays: DRUM.SPINE_PAYS });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  5. THE ROOM — one call, so the door has one line
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the Wheelhouse needs to open: the three tables, dealt, with the
 * people at them.
 *
 * `Station.js`'s key branch calls this and hands the result to `world.onCasino`
 * — so a panel that has not been written yet still gets a real hand, a real
 * board and a real spin, and the room says something true through `notify`
 * rather than nothing. That is deliberate: the last two systems that shipped
 * with no door shipped green.
 */
export function openWheelhouse(hour = 0, day = 0, placeId = WHEELHOUSE) {
  const sabacc = sabaccTable(placeId, day, 0, []);
  return {
    place: placeId, name: PLACE.get(placeId)?.name || 'The Wheelhouse',
    hour: ((hour | 0) % 24 + 24) % 24, day: day | 0,
    tables: TABLES.map((t) => ({ ...t })),
    sabacc,
    dejarik: dejarikTable(placeId, day),
    drum: drumTable(hour, day),
  };
}

/** One line for the banner, when nothing has opened a panel over the room. */
export function wheelhouseLine(room) {
  const s = room.drum;
  const where = s.house ? 'the house segment' : `deck ${s.deck}`;
  const face = room.sabacc.seats[0];
  return `the Drum stands on ${where}; ${face ? `${face.name} the ${face.species}` : 'the house'} is dealt in`;
}
