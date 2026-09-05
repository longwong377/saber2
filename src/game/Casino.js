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
  SABACC, playSabacc, sabaccScore, sabaccBot, sabaccPot, sabaccPays,
  DEJARIK, dejarikMoves, dejarikBot, playDejarik,
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
 * Seeding the SLOT CHOICE on the day means this file asks a different question
 * tomorrow; a seat seeded on the place alone would have been a permanent
 * house, which is the opposite of what was asked for.
 *
 * ── AND THE DAY HAS TO REACH `occupant` TOO, NOT JUST THE SLOT CHOICE ─────
 *
 * This called `occupant(place, slot)` with no day at all while its neighbour
 * `Pits.handlersOn` was repaired to pass `{ day }` — the same fix, landed in
 * one file and not the other. `occupant` defaults a missing day to 0, so the
 * slot was chosen on today and the PERSON in it was read out of day 0's
 * roster. That makes the sentence three lines up — "an opponent is somebody
 * you can also walk up to" — false on every day but the first. Measured on the
 * shipped build with the day made real: day 1 seated *Mateo Silva* at sabacc
 * while the body standing in that slot was *Nadia Cole*; day 2 was *Jeffrey
 * Chowdhury* against *Susan Franklin*. It did not bite only because the day
 * was stuck at 0 for everybody; the moment `StationSave.stationDay` started
 * counting midnights it would have.
 *
 * NOTHING ELSE OF THE POOL'S `opts` IS HANDED IN, deliberately: `hour`, `heads`
 * and `company` exist for `Bars.barman`, which answers null for every room
 * that is not one of the three bars, and the wheelhouse is not one. The seat
 * has to be stable for a whole day — you can leave the panel and come back —
 * so an hour in this seed would reroll the table under the player.
 */
export function opponentAt(placeId, day = 0, seat = 0) {
  const place = PLACE.get(placeId);
  if (!place) return null;
  /* Out of who is actually IN the room at its own busy hour — the same
   * `headcount` the pool seats bodies from, so an opponent is somebody you
   * can also walk up to. Never zero: a table needs a dealer even at noon. */
  const n = Math.max(1, headcount(place, place.peak ?? 13));
  const slot = hashOf(`seat:${placeId}:${day | 0}:${seat | 0}`) % n;
  const res = occupant(place, slot, { day: day | 0 });
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
 *
 * ── AND THE HAND IS PLAYED FOR A POT ─────────────────────────────────────
 *
 * *"you can bet your real money."* `ante` is what each of the four seats puts
 * in the middle before the deal, and it is a PARAMETER rather than a constant
 * read in here so that the panel's live stake — the one that outlives the door
 * — is the single authority on what this hand is being played for. A hand
 * dealt for nothing prices at nothing and says so (`pot: 0`, `pay: 0`), which
 * is what the room shows before you are in.
 *
 * The arithmetic is `Games.sabaccPot` and `Games.sabaccPays` and it is all of
 * it. NO CREDIT MOVES HERE — see this file's header: a file that both deals
 * the cards and moves the purse is the one shape the economy doctrine refuses,
 * so what comes back is a number the panel owes you, and the panel pays it.
 */
export function sabaccTable(placeId, day = 0, index = 0, acts = [], foes = 3, ante = 0) {
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
  const seats = who.length + 1;
  const stake = Math.max(0, Math.round(Number(ante) || 0));
  const pot = sabaccPot(stake, seats);
  const asked = views.length;
  const done = acts.length >= asked;
  const view = done ? null : views[acts.length];
  const scores = r.hands.map((h, i) => ({ ...sabaccScore(h), out: r.out[i] }));
  return {
    game: 'sabacc', place: placeId, day: day | 0, index: index | 0,
    seed, acts: acts.slice(), seats: who,
    /* WHAT IS ON THE TABLE. `ante` is what each seat put in, `pot` is the
     * middle, and `staked` is the one a panel branches on: a hand nobody has
     * paid for is a hand nobody may act on. */
    ante: stake, pot, staked: stake > 0,
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
      /* WHAT THE PANEL OWES YOU, in whole credits: the middle less the house's
       * cut if you took it, your ante back if nobody did, nothing otherwise. */
      pay: sabaccPays(r.winner, stake, seats),
      pot,
      /* WHAT HAPPENED, and not what it paid. The number is `pay` one line up;
       * the panel is the thing that knows whether the wallet took it. */
      line: r.winner < 0 ? (stake ? 'nobody takes it — the antes come back' : 'nobody takes it')
        : r.winner === 0 ? (r.pure ? 'pure sabacc — you take the middle' : 'you take the middle')
          : `${who[r.winner - 1]?.name || 'the house'} takes the middle`,
    } : null,
    /* Every shift that landed, so the panel can say WHY a made hand died —
     * the shift is the game and a hand that changed under you in silence is
     * the one thing that would read as a bug. */
    shifts: r.events.filter((e) => e.t === 'shift' && e.who === 0).length,
  };
}

/** The next hand at this table. A hand is an index, so nothing is stored. */
export function nextHand(table) { return { index: (table?.index | 0) + 1, acts: [] }; }

/* ── A LIVE HAND IS A TICKET, AND IT IS THE DRUM'S SHAPE ──────────────────
 *
 * `Games.drumTicket` is the worked example: a stake that has been paid for is
 * a VALUE the panel holds, so it survives the card being taken down and the
 * player walking out of the room. A hand is the same problem with one more
 * field — the verbs said so far — because a person who antes, draws, and then
 * walks out mid-hand has money in a middle that has not been decided yet.
 *
 * DROPPING IT AT THE DOOR WOULD BE THE HOUSE KEEPING THE ANTE FOR THE CRIME OF
 * WALKING OUT, which is the sentence `main.js`'s `drumHeld` was written under
 * and it is no less true with cards in it. So the ticket carries everything
 * `sabaccTable` needs to deal the SAME hand again — the place, the day it was
 * dealt on, the hand index and the ante — and `sabaccHand` is the one reading
 * that turns it back into a table. The day is on the ticket rather than read
 * fresh because the station clock keeps running while the panel is shut: come
 * back after midnight and it must still be YOUR hand, not today's deal.
 */

/** Strike a hand: the ante is paid, the cards are dealt, nothing is said yet. */
export function sabaccAnte(placeId, day = 0, index = 0, ante = SABACC.ANTE) {
  return {
    game: 'sabacc', place: placeId, day: day | 0, index: index | 0,
    ante: Math.max(0, Math.round(Number(ante) || 0)), acts: [],
  };
}

/** The table a live stake is sitting at. The one reading that settles it. */
export function sabaccHand(stake, foes = 3) {
  if (!stake) return null;
  return sabaccTable(stake.place, stake.day, stake.index, stake.acts || [], foes, stake.ante);
}

/** Say a verb into a live hand. The stake is a value, so this answers a new one. */
export function sabaccAct(stake, act) {
  if (!stake) return stake;
  return { ...stake, acts: [...(stake.acts || []), act] };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE DEJARIK COLUMN — one loop, and the room plays through it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT THIS SECTION WAS REWRITTEN FOR ────────────────────────────
 *
 * This section used to hold its own game loop: `dejarikTurn` stepped the board
 * itself, asked `dejarikWinner`, and handled exactly one of the two ways a side
 * can be stuck — the house's. `Games.playDejarik` held the OTHER half of the
 * rule ("a side with no legal move has lost") and had no caller anywhere under
 * `src/`. Two implementations of one game, and the defect was in the one a
 * player could reach: driven 400 columns through this file with legal moves
 * chosen at random, **112 of 400 ended with `winner: null`, no legal move and
 * no result line** — 28% — and `main.js` printed `g.line || 'the column is
 * done'` over the hole, so the missing result read as an ending.
 *
 * The rule now lives in `dejarikWinner`, which every path asks, and this
 * section no longer has a loop at all: a column is `{seed, acts}` and
 * `playDejarik` replays it, exactly as `sabaccTable` replays a hand.
 *
 * ── AND THAT REVERSES WHAT THIS FILE USED TO SAY, ON PURPOSE ─────────────
 *
 * The old note here argued the opposite — perfect information, so the board IS
 * the state and there is nothing to replay. That was true and it was not the
 * point. The question is not whether a replay is NECESSARY, it is whether the
 * room and the checks play the same game, and the answer was no. A 60-ply
 * replay against a one-ply bot on twenty squares costs microseconds; what it
 * buys is one loop, one stalemate rule, and a column that is a value — so it
 * can be written down, handed to a check verbatim, and survive the door.
 */

/**
 * THE HOUSE'S SIDE, seeded on the board's own turn count so the same position
 * always draws the same reply and a player can study it — and on the column's
 * `round` as well, so racking them up is a NEW game rather than the same one
 * back again.
 */
function houseSide(placeId, day, round) {
  return (b) => dejarikBot(b, hashOf(`dejarik:${placeId}:${day | 0}:${round | 0}:${b.turn}`));
}

/**
 * THE PLAYER'S SIDE, which is a list of moves already made and nothing else.
 *
 * Answering `null` means THE NEXT MOVE IS NOT KNOWN YET, and `playDejarik`
 * reads it that way — see its note on the two ways to stop. It cannot mean
 * "no legal move", because `dejarikWinner` ends the game before a side with
 * nothing to play is ever asked.
 *
 * A scripted move that is not legal on the board it arrives at also stops the
 * replay rather than being played anyway. Nothing can put one there —
 * `dejarikTurn` checks legality before it appends — and if something ever did,
 * a column that stands still is a visible fault and a column that teleports a
 * piece is not.
 */
function scriptSide(acts) {
  let i = 0;
  return (b) => {
    const want = acts[i++];
    if (!want) return null;
    return dejarikMoves(b).find((m) => m.from === want.from && m.to === want.to) || null;
  };
}

/**
 * WHAT HAPPENED, IN A SENTENCE, AND THERE IS ONE FOR EVERY ENDING.
 *
 * Every branch of a decided game answers, so no caller ever needs a `||` on
 * the way to the screen — the fallback string in the panel is what hid the
 * deadlock for the whole life of this room. A live game answers `null`, which
 * is not a missing line: it is the honest answer to "who won" mid-game, and
 * the panel is showing the board rather than a result at that point.
 */
function columnLine(w, b, name) {
  if (w === null) return null;
  const n = [0, 0];
  for (let i = 0; i < b.ring.length; i++) {
    const p = b.ring[i];
    if (p && !b.gone[i]) n[p.side]++;
  }
  if (w < 0) {
    return (!n[0] && !n[1]) ? 'the ring closes on both of you'
      : `time on the column — ${n[0]} against ${n[1]}, and it stands`;
  }
  const won = w === 0;
  const loser = won ? 1 : 0;
  if (!n[loser]) return won ? 'you sweep the column' : `${name} sweeps the column`;
  if (b.turn >= DEJARIK.MAX_TURNS) {
    return won ? `time on the column — you are ahead ${n[0]} to ${n[1]}`
      : `time on the column — ${name} is ahead ${n[1]} to ${n[0]}`;
  }
  /* THE STALEMATE, said out loud rather than left as a blank screen. It is a
   * quarter of all columns; a player who is never told why the game stopped
   * would be right to call it a bug, because for the whole life of this room
   * it was one. */
  return won ? `${name} has nowhere left to go — you take the column`
    : `you have nowhere left to go — ${name} takes the column`;
}

/**
 * A column, dealt from its seed and the moves you have made in it.
 *
 * The player is side 0. `round` is which column this is at the table, the same
 * way `index` is which hand — so "rack them up" is a number and nothing is
 * stored anywhere.
 */
export function dejarikTable(placeId, day = 0, acts = [], round = 0) {
  const against = opponentAt(placeId, day, 1);
  const seed = hashOf(`dejarik:${placeId}:${day | 0}:${round | 0}`);
  const r = playDejarik([scriptSide(acts), houseSide(placeId, day, round)], seed);
  const w = r.winner;
  const name = against?.name || 'the house';
  let mine = null, theirs = null;
  for (const m of r.moves) { if (m.side === 0) mine = m; else theirs = m; }
  return {
    game: 'dejarik', place: placeId, day: day | 0, round: round | 0,
    seed, acts: acts.map((a) => ({ from: a.from, to: a.to })),
    board: r.board,
    ring: DEJARIK.RING, shrink: DEJARIK.SHRINK_EVERY, maxTurns: DEJARIK.MAX_TURNS,
    against,
    /* A LIVE GAME HAS MOVES AND A DECIDED ONE HAS NONE. With the stalemate
     * rule in `dejarikWinner` those two are now the same statement, which is
     * exactly what was not true before: an empty list with a null winner was
     * the deadlock, and it was 28% of columns. */
    moves: w === null ? dejarikMoves(r.board) : [],
    winner: w, why: null,
    last: r.moves.length ? { mine, theirs } : null,
    line: columnLine(w, r.board, name),
  };
}

/**
 * One turn: your move, then theirs.
 *
 * BOTH IN ONE CALL still, because a board handed back with the opponent to
 * move is a board the panel would have to remember to poke — but it is now one
 * line, because appending your move to the script and replaying is the whole
 * of it. The reply is named in what comes back so the room can show what they
 * did.
 */
export function dejarikTurn(table, mv) {
  if (!table || table.winner !== null) return { ...table, why: 'the column is finished' };
  const pick = dejarikMoves(table.board).find((m) => m.from === mv?.from && m.to === mv?.to);
  if (!pick) return { ...table, why: 'that piece cannot go there' };
  return dejarikTable(table.place, table.day,
    [...table.acts, { from: pick.from, to: pick.to }], table.round);
}

/** The next column at this table, the way `nextHand` is the next hand. */
export function nextColumn(table) { return { round: (table?.round | 0) + 1, acts: [] }; }

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
  /* DEALT FOR NOTHING, because nobody has anted. `openWheelhouse` is what the
   * door hands the panel and what the room's own banner reads; the stake is
   * struck at the table, by a person, and lives in the panel. */
  const sabacc = sabaccTable(placeId, day, 0, [], 3, 0);
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
