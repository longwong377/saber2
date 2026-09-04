/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE COMPANION PITS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "There should be area of the ship where either illegal or sanctioned
 *  companion duels/tournaments happen, not always available or offered, you
 *  fight against another inhabitant on the station who has a companion
 *  (definetly a rare thing like having a reliable companion should be a
 *  dofficult thing to have) … this is where palword/pokemon esque fighting
 *  comes into play … you should be able to watch the entire battle, has a
 *  crowd etc … losing should also have real consequences sometimem permanenet
 *  but the rewards should be good too … there needs to be a certain level of
 *  skill, a minigame in here … actual announcer, like imagine real event
 *  fights."
 *
 * ── THIS FILE IS THE ROOM AND THE PLAYER'S PART. IT IS NOT A SIMULATION ───
 *
 * `Spectacle.js` is the sim, and it already does every hard thing: a card of
 * entrants, a ground, a seeded FORWARD advance with no line in it that picks a
 * winner, a form book, a typed event stream and an announcer. Nothing below
 * rolls a die about who hit whom. What is here is the four things the engine
 * deliberately does not know:
 *
 *   1. THE CORNER — the control scheme (V16 §G2), which is the player's part
 *   2. THE CONSEQUENCE — scars, and the fallen roll, opt-in every time (§G3)
 *   3. THE RARITY — a handler is an EVENT, and the one you saw is the one you
 *      fight (§G1)
 *   4. THE TWO PLACES — `#20 The Arena` and `#61 The Underlift Pit` (§G5)
 *
 * ── WHY A BOUT IS ROUNDS OF THE ENGINE AND NOT ONE CALL OF IT ─────────────
 *
 * `runSpectacle` runs a whole spectacle end to end and hands back a result. A
 * bout with a corner in it has to STOP between rounds so the player can act,
 * which the engine has no seam for — and adding one would be reaching into a
 * pure library to make it stateful for one caller.
 *
 * So a round IS a call of `runSpectacle`, on a ground whose `segments` is one
 * round's worth, and the BOUT is this file carrying two numbers across those
 * calls: how much each animal has taken, and what the corner did to the next
 * round. Every exchange, every knockdown, every refusal and every wound is the
 * engine's. What this file decides is when the bell goes, when it is stopped,
 * and what the handler at the rail was able to change before it was.
 *
 * That is also why the round's card is REBUILT each round through
 * `makeEntrant`: the corner's effect is a rating and a temperament handed to
 * the sim before the round, clamped by the engine's own constructor, rather
 * than a multiplier applied to a number the sim produced. A corner that edited
 * the result would be the pre-drawn winner this whole lane is written against.
 *
 * ── A WAGER IS A RUN-SCOPED NUMBER, AND THIS FILE HOLDS NO BALANCE ────────
 *
 * `Kennel.js`:22 says of its own absence from the six-word scan that "that
 * silence is a hazard, not a permission", and `Spectacle.js` restates it. This
 * file is added to `tools/checks/companions.mjs`'s scanned list on the commit
 * that creates it, for that reason and not because anything here needs it.
 *
 * A purse is a number handed BACK to a caller. A wager is a number handed IN
 * and handed back through the engine's own `settle()`. There is no field below
 * that a session could accumulate into, and the only durable thing this file
 * writes is the one the design demands it write: a scar, a line of story, and
 * an epitaph. Rewards are the purse and a KEEPSAKE ID — never a stat. Nothing
 * here touches `xp`, `runs`, `kills`, `tempers` or a rung, and a check drives
 * a hundred bouts and reads the record afterwards to prove it.
 */

import { makeRng, clamp } from '../engine/MathUtil.js';
import {
  SKINS, groundById, dressGround, makeEntrant, entrantFromCompanion,
  priceCard, runSpectacle, runMeeting, makeCard, recordResult, settle, announce,
} from './Spectacle.js';
import {
  COMPANION_KINDS, COMPANION_ORDER, holdsCompanion, rungOf, maturityOf, careOf,
} from './CompanionKinds.js';
import { load as loadKennel, save as saveKennel, STORY_KEEP, FALLEN_KEEP } from './Kennel.js';
import { headcount, occupant } from './StationLife.js';
import { PLACES } from './StationPlan.js';

/* ══════════════════════════════════════════════════════════════════════════
 *  SEEDS — a pit is reproducible from one, and a stranger from their own
 * ══════════════════════════════════════════════════════════════════════════ */

/** FNV-1a over a string. `StationCast` has its own and does not export it; a
 *  second copy of a four-line hash is cheaper than reaching into that file. */
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const streamOf = (...parts) => makeRng(hash32(parts.join('|')) || 1);
const round2 = (n) => Math.round(n * 100) / 100;

/* ══════════════════════════════════════════════════════════════════════════
 *  1. THE RARITY — a stranger with a companion is an EVENT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's parenthesis is the design: *"definetly a rare thing like having
 * a reliable companion should be a dofficult thing to have"*, and *"you should
 * see a couple other people with companions of there own here and there at
 * times (rare) just milling about."*
 *
 * So being a handler is a property of the RESIDENT and of nothing else — not
 * of the place, not of the hour, not of the pit's card. `StationCast.resident`
 * is already keyed on a seed that `StationLife.occupant` derives from a place
 * and a slot, so the Wookiee in stall three of the Concourse is the same
 * Wookiee all day; hanging the handler roll off that same seed is what makes
 * the sentence "the handler you saw in the Concourse in the morning is the one
 * you meet in the pit that night" literally true rather than a story about a
 * coincidence. `pitCard()` draws from the DAY'S ROSTER, not from the pit's own
 * seats, and a check matches the night's field back to the morning's walk.
 */

/**
 * How many of the station's residents walk with an animal. One in twenty-nine.
 * Measured against a live population of sixty (§11's pool): that is one or two
 * handlers standing about on a given deck, which is the "here and there at
 * times (rare)" the brief asks for and not a kennel club.
 */
export const HANDLER_RARITY = 0.035;

/** The hour the roster is read at — the morning walk. */
export const ROSTER_HOUR = 9;

/** Is this resident one of the few? A pure function of who they are. */
export function isHandler(res) {
  if (!res || res.seed == null) return false;
  return streamOf('handler', String(res.seed))() < HANDLER_RARITY;
}

/**
 * WHICH ANIMAL A STRANGER WALKS WITH, and how good they are at the rail.
 *
 * Drawn from the resident's own seed, so it is stable for the life of that
 * resident exactly as their name and species are. `craft` is the handler's
 * skill and it is HIDDEN — it decides how often their telegraph is a feint,
 * which is the only thing about the opposing corner the player cannot read off
 * the form book and must learn by fighting them.
 */
export function handlerOf(res) {
  if (!isHandler(res)) return null;
  const rng = streamOf('kennel', String(res.seed));
  const kind = rng.pick(COMPANION_ORDER);
  return {
    id: `h${res.seed}`,
    seed: res.seed,
    who: res.name,
    species: res.species,
    role: res.role,
    kind,
    /* The animal's own name, off the same stream, so a handler met twice is
     * the same pair of names both times. */
    animal: `${rng.pick(BEAST_HEAD)}${rng.pick(BEAST_TAIL)}`,
    /* PUBLIC: what the form book prints. HIDDEN: what the pit teaches. */
    record: { starts: rng.int(0, 24), wins: 0 },
    craft: round2(clamp(0.18 + rng() * 0.62, 0, 1)),
  };
}

const BEAST_HEAD = ['Grask', 'Vorn', 'Hulth', 'Kez', 'Ramm', 'Ogrun', 'Sil', 'Tarn', 'Dross', 'Yavk', 'Morr', 'Bex'];
const BEAST_TAIL = [' the Red', ' of Nar Shu', ' Ninefingers', ' the Quiet', ' Ironjaw', ' Blacktooth', ' the Long', ' Halfmask'];

/**
 * EVERY HANDLER ON THE STATION AT AN HOUR, and where they are standing.
 *
 * The census is walked rather than sampled: `headcount` says how many are in a
 * place and `occupant` says who each of them is, which is the same pair of
 * readers `stationlife.mjs` holds the day to. Nothing here invents a resident.
 */
export function handlersOn(hour = ROSTER_HOUR) {
  const out = [];
  const seen = new Set();
  for (const p of PLACES) {
    if (p.external || !p.heads) continue;
    const n = headcount(p, hour);
    for (let i = 0; i < n; i++) {
      const res = occupant(p, i);
      /* A Borz row is a named character with a job, not a stranger with an
       * animal — the cast is somebody else's table and it is left alone. */
      if (!res || res.borz || seen.has(res.seed)) continue;
      const h = handlerOf(res);
      if (!h) continue;
      seen.add(res.seed);
      out.push({ ...h, where: p.id, place: p.name });
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  2. THE TWO PLACES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * §G5. `#20 The Arena` is the sanctioned one and its gazetteer verb has always
 * been "fight a bout"; `#61 The Underlift Pit` is the illegal one, off the
 * ring's service gap on deck 44.
 *
 * THE DIFFERENCE BETWEEN THEM IS FOUR BOOLEANS AND A GROUND, and every one of
 * those is a consequence rather than a flavour word:
 *
 *   `doctor`  a doctor at the rail is the whole of why the Arena cannot kill.
 *             `foldPit` refuses a death in any venue that has one, before it
 *             ever asks whether a stake was accepted.
 *   `mortal`  whether a permanent stake may even be OFFERED. False in the
 *             Arena, so the opt-in cannot be reached there at all.
 *   `rounds`  the Arena is refereed and short, so it goes the distance and is
 *             decided on condition. The Underlift is long and is not.
 *   `shut`    the standing above which the wrong people stop trusting you.
 */
export const PITS = Object.freeze([
  Object.freeze({
    id: 'arena', place: 20, deck: 40, name: 'The Arena',
    groundId: 'arena-sand',
    refereed: true, doctor: true, mortal: false,
    rounds: 3, perRound: 9,
    /* A card posted a day ahead — the Arena is open through the station's own
     * waking hours and never a surprise. */
    hours: [10, 22], always: true, shut: 1.01,
    purse: 40, hazardPurse: 0,
    words: 'A marshal at the rail and a doctor behind it. Whatever it takes in there, '
      + 'it walks out with you.',
  }),
  Object.freeze({
    id: 'underlift', place: 61, deck: 44, name: 'The Underlift Pit',
    groundId: 'underlift',
    refereed: false, doctor: false, mortal: true,
    rounds: 5, perRound: 6,
    /* The small hours only, and NOT EVERY NIGHT — "not always available or
     * offered". `venueOpen` rolls the day, so a player who walks down there
     * on the wrong night finds a service gap with nobody in it. */
    hours: [22, 4], always: false, shut: 0.62,
    purse: 140, hazardPurse: 340,
    words: 'No referee, no doctor, and nobody stops it. If it goes past saving down '
      + 'there it does not come back.',
  }),
]);

export const pitById = (id) => PITS.find((v) => v.id === id) || null;
export const pitAtPlace = (place) => PITS.find((v) => v.place === place) || null;

/**
 * IS IT ON TONIGHT? One reader, so a door that is offered and a door that
 * opens cannot disagree — `WEARS`' rule, one deck across.
 *
 * `standing` is the caller's number and this file neither reads nor stores it:
 * Lane B owns what standing is. Passed as 0 by anything that has none, which
 * is the honest default — nobody trusts a stranger and nobody distrusts one.
 */
export function venueOpen(venue, hour = 0, { standing = 0, day = 0 } = {}) {
  if (!venue) return { open: false, why: 'no such place' };
  const [a, b] = venue.hours;
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const within = a <= b ? (h >= a && h < b) : (h >= a || h < b);
  if (!within) return { open: false, why: `nothing here until ${String(a).padStart(2, '0')}:00` };
  if (standing >= venue.shut) {
    return { open: false, why: 'the wrong people have stopped trusting you — the door does not open' };
  }
  if (!venue.always && streamOf('night', venue.id, String(day | 0))() < 0.34) {
    return { open: false, why: 'not tonight — the gap is dark and the grating is down' };
  }
  return { open: true, why: 'it is on' };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE ANIMAL AS AN ENTRANT
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * `Spectacle.entrantFromCompanion` takes a PLAIN RECORD and a row carrying a
 * `heft` and a `foot`, and it says in its own header why: reading the kind
 * table would make it import `Bodies.js` and therefore THREE, and the engine
 * would stop being loadable headless. So the adapter from a kind row to those
 * two numbers lives HERE, where importing the tree is already the point.
 *
 * Neither number is new. `frag` is the kind's own fragility (0.7 on the rancor
 * pup, 2.4 on the tooka kit) and `ward` and `pace` are its reach and its
 * speed — so heft is "how much of a beating this shape is built for" and foot
 * is "how sure it is underfoot", both read off rows that already exist and
 * neither one a stat anybody chose.
 */
export function heftOf(kind) {
  const K = COMPANION_KINDS[kind];
  if (!K) return 0;
  return round2(clamp((1.3 - (Number(K.frag) || 1)) * 0.6, -0.8, 0.8));
}
export function footOf(kind) {
  const K = COMPANION_KINDS[kind];
  if (!K) return 0;
  /* A heavy warder is surer in deep sand than a sprinter is. `ward` is metres
   * and `pace` is a fraction of the player's, so both are normalised first. */
  return round2(clamp(((Number(K.ward) || 0) / 15 - (Number(K.pace) || 0.6) / 0.85) * 0.6, -0.9, 0.9));
}

/**
 * THE BOND, AND IT IS DERIVED — never stored, for `Kennel.readOne`'s reason.
 *
 * `entrantFromCompanion` reads `rec.bond` and a kennel record has no such
 * field, so without this it would read `undefined` and every companion on
 * every card would have a bond of zero. It is the growth ladder said as one
 * number: how far up `GROWTH_STAGES` the animal has come (which is runs AND
 * care, both), and how far up the rung ladder its deeds have carried it.
 */
export function bondOf(rec) {
  if (!rec) return 0;
  const grown = maturityOf(rec);
  const xp = clamp((Number(rec.xp) || 0) / 20, 0, 1);
  const looked = clamp(careOf(rec) / 14, 0, 1);
  return round2(clamp(grown * 0.45 + xp * 0.35 + looked * 0.20, 0, 1));
}

/** The player's own animal, as a thing a card can hold and a board can price. */
export function entrantForRecord(rec) {
  if (!rec) return null;
  return entrantFromCompanion(
    { ...rec, bond: bondOf(rec) },
    { heft: heftOf(rec.kind), foot: footOf(rec.kind) },
  );
}

/**
 * THE OTHER CORNER, SCALED TO YOURS.
 *
 * *"The enemies will be scaled for your player/stats so they will always be
 * risk in doing it."* So the match is drawn AROUND the player's own rating
 * rather than off a fixed ladder — but with a real spread on it, because a
 * matchmaker that hands you your own mirror every night is a coin flip with
 * extra steps, and the player asked for risk rather than for parity.
 *
 * The Underlift's `edge` is what a bigger purse is buying: down there the
 * other animal is better than yours on average, and the form book says so
 * before you accept anything.
 */
/**
 * A STRANGER'S PUBLIC RECORD, in the shape `makeEntrant` keeps one.
 *
 * `starts` and `wins` are the handler's own, drawn off their seed with
 * everything else about them, so the form book reads the same on the morning
 * board as it does at the rail that night. `log` is empty because a log is
 * something the field EARNS — `recordResult` fills it bout by bout, and
 * inventing one here would be handing `readForm` a history nobody ran.
 */
function formOf(handler, rating) {
  const starts = Math.max(0, handler?.record?.starts | 0);
  const wins = Math.min(starts, Math.round(starts * clamp(handler?.craft ?? 0.3, 0, 1) * 0.6));
  return { rating: clamp(rating, 20, 100), starts, wins, places: wins, recent: [], log: [] };
}

export function matchFor(mine, handler, venue, seed = null) {
  const rng = seed == null ? streamOf('match', handler.id, venue.id) : makeRng((seed >>> 0) || 1);
  const edge = venue.mortal ? 4.5 : 0;
  const rating = clamp(mine.form.rating + edge + rng.gauss() * 7, 20, 100);
  const K = COMPANION_KINDS[handler.kind] ? handler.kind : 'massiff';
  return makeEntrant({
    id: handler.id,
    name: handler.animal,
    kind: 'companion',
    rating,
    /* THE FORM BOOK HAS SOMETHING TO PRINT. A stranger who has fought
     * twenty times is a stranger the board and the player can both read
     * BEFORE anything is accepted, which is the whole of §G4's "a card posted
     * a day ahead" — the record is the handler's own and not a decoration
     * drawn fresh at the door. */
    form: formOf(handler, rating),
    hidden: {
      heart: round2(clamp(handler.craft * 0.7 + rng.gauss() * 0.3, -1, 1)),
      vice: round2(clamp(rng.gauss() * 0.5, -1.5, 1.5)),
      footing: footOf(K),
      nerve: round2(clamp(rng.gauss() * 0.5, -1.5, 1.5)),
      heatLimit: 1.2,
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 *  4. THE CORNER — V16 §G2, the control question answered
 * ══════════════════════════════════════════════════════════════════════════
 *
 * You are the HANDLER AT THE RAIL, not the animal. Three things are yours and
 * the animal owns everything else — and the reason is written out in §G2:
 * driving a massiff directly is the shooting game with a bad camera, and a
 * cutscene with a purse on it is a slot machine with animation.
 *
 * THE ORDER, THE READ, THE CORNER. In that order below.
 */

/**
 * ── THE ORDER ─────────────────────────────────────────────────────────────
 *
 * Five, and every one of them is LICENSED BY THE LADDER THAT ALREADY EXISTS.
 * `holds` names a row of `COMPANION_ORDERS` and the gate is
 * `holdsCompanion(rec, holds)` — the same reader the wheel uses in the field,
 * so an animal that cannot be told to hold ground on Geonosis cannot be told
 * to hold ground in the Arena either, and a rung the player climbed out there
 * is felt in here without a second table saying so.
 *
 * BREAK OFF IS UNREFUSABLE AT EVERY RUNG, on `COMPANION_ORDERS`' own stated
 * rule: "the two orders that make a companion SAFER must never be ones a fresh
 * companion cannot take. Protection that needs a licence is not protection."
 * It is also the only order that answers no intent — it is the safety valve
 * and not a play, and what it does is take the round off.
 *
 * `counters` is the whole minigame: an order lands against ONE intent, and the
 * intent is what the other corner telegraphed a second before it happened.
 */
export const PIT_ORDERS = Object.freeze([
  Object.freeze({
    id: 'break', label: 'BREAK OFF', holds: 'away', counters: null,
    caption: 'Off him. Give ground and stay off him.',
    note: 'Takes the round off — half the exchanges, both ways. Always available.',
  }),
  Object.freeze({
    id: 'guard', label: 'GUARD', holds: 'ward', counters: 'commit',
    caption: 'Meet it. Do not give him the first bite.',
  }),
  Object.freeze({
    id: 'press', label: 'PRESS', holds: 'seek', counters: 'set',
    caption: 'Go at him now, before he is set.',
  }),
  Object.freeze({
    id: 'flank', label: 'FLANK', holds: 'verb', counters: 'break',
    caption: 'Round him. Take the angle he is giving you.',
  }),
  Object.freeze({
    id: 'hold', label: 'HOLD', holds: 'hold', counters: 'circle',
    caption: 'That ground is yours. Do not chase him off it.',
  }),
]);
export const orderById = (id) => PIT_ORDERS.find((o) => o.id === id) || null;

/**
 * ── THE READ ──────────────────────────────────────────────────────────────
 *
 * *"before each round, the opponent's handler tells you what they are going to
 * do, in their body and their animal's stance, for about a second."*
 *
 * Four intents. Each carries `at` — the moment in the round window that corner
 * actually COMMITS — so reading the tell tells you two things at once, WHICH
 * order and WHEN, and a player who has read it properly has both. That is what
 * makes this the form book moved inside the fight rather than a quiz: the tell
 * is a fact about the coming second, not a multiple choice.
 *
 * A tell can be a FEINT, at a rate set by the other handler's hidden `craft`.
 * A good handler lies to you about one round in three, which is exactly why
 * reading them across a card is worth more than reading them once.
 */
export const READ_WINDOW = 1.0;
export const ORDER_WINDOW = 2.0;

export const INTENTS = Object.freeze([
  Object.freeze({
    id: 'commit', label: 'COMING IN', at: 1.05,
    tell: 'his weight goes forward and the animal\'s head drops',
  }),
  Object.freeze({
    id: 'circle', label: 'WORKING ROUND', at: 1.45,
    tell: 'he steps off the rail and the animal\'s shoulders turn with him',
  }),
  Object.freeze({
    id: 'set', label: 'SETTING', at: 0.75,
    tell: 'he plants his feet and the animal stops moving them',
  }),
  Object.freeze({
    id: 'break', label: 'BREAKING OFF', at: 1.30,
    tell: 'a hand low and back, and the animal gives a half step',
  }),
]);
export const intentById = (id) => INTENTS.find((i) => i.id === id) || null;

/**
 * ── THE PRICES, AND WHY SPAMMING IS WORSE THAN DOING NOTHING ──────────────
 *
 * *"an order landed as the opponent commits is worth three landed at random,
 * and the wheel has a real cost — an animal listening is an animal not
 * watching."*
 *
 * That sentence is these four numbers and nothing else:
 *
 *   `LISTEN`  is charged on EVERY order, landed or not. It is the second the
 *             animal spends with its ears on you.
 *   `WRONG`   is what an order that answers the wrong intent is worth — the
 *             animal did the thing, and the thing was the wrong thing.
 *   `TOL`     how close to the commit "as the opponent commits" is.
 *   `SWING`   converts the corner's score into the one number the sim reads,
 *             which is the entrant's rating for the coming round.
 *
 * A player who orders at a random moment with a random order therefore scores
 * NEGATIVE on average and would have done better keeping quiet, and a player
 * who reads the tell scores well above both. `tools/checks/pits.mjs` drives
 * three hundred bouts of each and prints the win rates rather than trusting
 * this paragraph.
 */
export const LISTEN = 0.18;
export const WRONG = -0.6;
export const TOL = 0.6;
export const SWING = 10;
/** How many orders one round will carry. Spamming is possible — it has to be,
 *  or "there is a real cost" is a rule with nothing to bite. */
export const ORDERS_PER_ROUND = 3;

/** What one order was worth: timing × correctness, less what listening cost. */
export function scoreOrder({ order, intent, at, commitAt }) {
  const timing = Math.max(0, 1 - Math.abs(at - commitAt) / TOL);
  const right = !!order.counters && order.counters === intent;
  const value = order.counters == null
    /* BREAK OFF answers nothing and is scored as nothing. It buys its safety
     * in the round's own length, below, and paying it a swing as well would
     * make the safe order the strong order. */
    ? -LISTEN
    : timing * (right ? 1 : WRONG) - LISTEN;
  return { timing: round2(timing), right, value: round2(value) };
}

/**
 * ── THE CORNER ITSELF ─────────────────────────────────────────────────────
 *
 * *"between rounds you get one action: water, a word, a wound bound. Which one
 * you spend is a real decision because you only get one and the animal's state
 * is visible."*
 *
 * ONE. Not one of each and not one per round accumulated — one for the bout,
 * which is what makes the three of them a decision instead of a checklist.
 * Each answers a different number on `pitState()`, and the three numbers are
 * all visible before you choose: what it has taken, what it is bleeding, and
 * what the last round did to it.
 */
export const CORNER_ACTS = Object.freeze([
  Object.freeze({ id: 'water', label: 'WATER', caption: 'Get its head down and let it drink.',
    answers: 'taken', note: 'Gives back a tenth of what it has taken.' }),
  Object.freeze({ id: 'word', label: 'A WORD', caption: 'Get down to it and say the thing it knows.',
    answers: 'nerve', note: 'It goes back out steadier — worth a round of good orders.' }),
  Object.freeze({ id: 'bind', label: 'BIND IT', caption: 'Pack the cut and strap it.',
    answers: 'bleed', note: 'Stops what an opened wound is taking every round.' }),
]);
export const cornerActById = (id) => CORNER_ACTS.find((a) => a.id === id) || null;

/** What water gives back, what a word is worth, what a bleed costs a round. */
export const WATER_BACK = 0.10;
export const WORD_SWING = 0.55;
export const BLEED_RATING = 3.0;

/* ══════════════════════════════════════════════════════════════════════════
 *  5. THE BOUT — the state machine over the engine
 * ══════════════════════════════════════════════════════════════════════════ */

/** The phases, in the order a bout passes through them. */
export const PHASES = Object.freeze(['offered', 'read', 'fight', 'corner', 'over']);

/**
 * THE OFFER, AND THE STAKE STATED BEFORE ANYTHING IS ACCEPTED.
 *
 * §G3: *"it must be opt-in every single time, with the stake stated before you
 * accept."* So the offer is a separate object from the bout, it carries the
 * stake IN WORDS as well as in numbers, and the only way to accept the
 * permanent one is to hand back a token derived from the very stake you were
 * shown. A caller that accepts a stake it never rendered cannot produce that
 * token; a caller that renders one stake and accepts another produces the
 * wrong one and gets the safe bout.
 */
export function offerBout({ venue, rec, handler, hour = 0, day = 0, seed = null, standing = 0 } = {}) {
  const V = typeof venue === 'string' ? pitById(venue) : venue;
  if (!V) throw new Error('a bout was offered at no pit');
  if (!rec) throw new Error('a bout was offered with no animal');
  if (!handler) throw new Error('a bout was offered against nobody');
  const state = venueOpen(V, hour, { standing, day });
  const mine = entrantForRecord(rec);
  const boutSeed = seed == null ? hash32(`${V.id}|${handler.id}|${rec.id}|${day}`) : (seed >>> 0);
  const theirs = matchFor(mine, handler, V, boutSeed ^ 0x9e37);
  const ground = dressGround(groundById(V.groundId), boutSeed ^ 0x5bd1);
  const card = { skin: ground.skin, entrants: [mine, theirs] };
  const board = priceCard(card, ground);

  /* A MORTAL STAKE IS ONLY EVEN ON THE TABLE WHERE THERE IS NO DOCTOR. The
   * Arena cannot offer one, so the opt-in below is unreachable there and the
   * check drives that rather than reading it. */
  const mortal = !!V.mortal && !V.doctor;
  const stake = {
    mortal,
    purse: mortal ? V.hazardPurse : V.purse,
    safePurse: V.purse,
    /* THE SENTENCE THE PLAYER READS BEFORE THEY ACCEPT. It names the animal,
     * because "your companion may die" and "Borz may die" are not the same
     * sentence to read. */
    words: mortal
      ? `${V.words} ${rec.name || 'It'} is what you are putting up. ${V.hazardPurse} if you take it, `
        + `${V.purse} if you fight for the smaller purse and they pull it off you.`
      : `${V.words} The purse is ${V.purse}.`,
    token: mortal ? `stake:${hash32(`${V.id}|${handler.id}|${rec.id}|${V.hazardPurse}|${day}`)}` : null,
  };

  return {
    venue: V, handler, rec, mine, theirs, ground, card, board,
    seed: boutSeed,
    rounds: V.rounds,
    open: state.open, why: state.why,
    stake,
  };
}

/**
 * OPEN IT. `accept` must be the token off the offer you were shown, and it is
 * the ONLY route by which `bout.stake.mortal` is ever true.
 *
 * A player who declines still fights — for the smaller purse, with the doctor
 * they do not have and the referee they do not have, and their animal comes
 * home scarred. That is the design: declining the stake is a real choice with
 * a real price, not a cancel button.
 */
export function openBout(offer, { accept = null, wager = 0 } = {}) {
  if (!offer) throw new Error('no offer');
  if (!offer.open) throw new Error(`the pit is shut: ${offer.why}`);
  const mortal = !!(offer.stake.mortal && offer.stake.token && accept === offer.stake.token);
  const S = SKINS[offer.ground.skin];
  return {
    venue: offer.venue,
    handler: offer.handler,
    /* THE RECORD'S ID AND NOT THE RECORD. `foldPit` re-reads the disk and
     * refuses a record that is not the one that fought — `keepCompanion`'s own
     * foreign-manifest refusal, in the shape this file needs it. */
    recId: offer.rec.id,
    recName: offer.rec.name || null,
    recKind: offer.rec.kind,
    mine: offer.mine, theirs: offer.theirs,
    ground: offer.ground, card: offer.card, board: offer.board,
    pool: S.pool || 100,
    rounds: offer.rounds,
    round: 0,
    phase: 'offered',
    rng: makeRng((offer.seed ^ 0x4a17) >>> 0 || 1),
    read: null, intent: null, tell: null,
    orders: [], swing: 0, carried: 0,
    taken: { mine: 0, theirs: 0 },
    dealt: { mine: 0, theirs: 0 },
    bleed: 0,
    corner: null,
    events: [],
    history: [],
    stake: {
      mortal,
      /* A NUMBER HANDED IN AND HANDED BACK. Nothing accumulates it, nothing
       * reads a balance to fill it, and `settle()` is the engine's. */
      wager: Math.max(0, Number(wager) || 0),
      purse: mortal ? offer.stake.purse : offer.stake.safePurse,
      words: offer.stake.words,
      declined: !!(offer.stake.mortal && !mortal),
    },
    over: false,
    outcome: null,
  };
}

/**
 * THE BELL, AND THE SECOND YOU GET TO LOOK AT HIM.
 *
 * Returns what the player SEES — a tell and a window — and never the intent.
 * The intent is on the bout, hidden, exactly as `Spectacle`'s hidden terms are
 * on the entrant: one table, two readers, and no way for the surface to leak
 * what the sim is about to run.
 */
export function beginRound(bout) {
  if (!bout || bout.over) return null;
  if (bout.phase === 'read' || bout.phase === 'fight') throw new Error('that round is already open');
  bout.round++;
  bout.phase = 'read';
  bout.orders = [];
  bout.swing = bout.carried;
  bout.carried = 0;
  const rng = bout.rng;
  const truth = INTENTS[rng.int(0, INTENTS.length - 1)];
  /* THE FEINT. A better handler lies more often — `craft` is hidden and is the
   * one thing about the other corner the form book cannot print. */
  const feints = rng() < (bout.handler?.craft ?? 0.3) * 0.5;
  const shown = feints ? INTENTS[rng.int(0, INTENTS.length - 1)] : truth;
  bout.intent = truth.id;
  bout.tell = shown;
  bout.read = {
    round: bout.round,
    of: bout.rounds,
    /* WHAT HIS BODY IS DOING, which is the whole of the minigame's input. */
    tell: shown.tell,
    reads: shown.id,
    label: shown.label,
    /* The window, so a surface knows how long to show it for. */
    window: READ_WINDOW,
    closes: ORDER_WINDOW,
    /* WHEN HE WILL COMMIT IF THE TELL IS HONEST. A player who has read him
     * has the moment as well as the answer; a player who has not is guessing
     * at both, which is why one order at the right time beats three. */
    commitAt: shown.at,
  };
  return bout.read;
}

/**
 * GIVE THE ORDER. `at` is seconds into the round window.
 *
 * Refusals are SENTENCES and not booleans, on `refuseOrder`'s precedent: a
 * cold slot that cannot say why it is cold is the thing `CompanionWheel` was
 * written against.
 */
export function callOrder(bout, orderId, at, rec = null) {
  if (!bout || bout.over) return { refused: 'the bout is over' };
  if (bout.phase !== 'read') return { refused: 'there is no round open' };
  const O = orderById(orderId);
  if (!O) return { refused: `no such order: ${orderId}` };
  if (bout.orders.length >= ORDERS_PER_ROUND) {
    return { refused: 'it has stopped listening to you this round' };
  }
  /* THE LICENCE, FROM THE LADDER THAT ALREADY EXISTS. `rec` is optional
   * because a bout that was opened from a record has already been matched to
   * one; a caller that has the live record hands it in and gets the gate. */
  if (rec && !holdsCompanion(rec, O.holds)) {
    return { refused: `${rungOf(rec).label} does not hold ${O.label} yet` };
  }
  const t = Math.max(0, Math.min(ORDER_WINDOW, Number(at) || 0));
  const commitAt = intentById(bout.intent).at;
  const s = scoreOrder({ order: O, intent: bout.intent, at: t, commitAt });
  bout.orders.push({ id: O.id, at: round2(t), ...s });
  bout.swing += s.value;
  return { order: O.id, at: round2(t), ...s, landed: s.right && s.timing > 0 };
}

/**
 * RUN THE ROUND — and this is the line that hands the fight back to the sim.
 *
 * The round's card is BUILT and then given away. Everything after
 * `runSpectacle` returns is arithmetic on numbers this file did not choose.
 */
export function runRound(bout) {
  if (!bout || bout.over) return null;
  if (bout.phase !== 'read') throw new Error('no round is open');
  bout.phase = 'fight';
  const broke = bout.orders.some((o) => o.id === 'break');
  const per = broke ? Math.max(2, Math.ceil(bout.venue.perRound / 2)) : bout.venue.perRound;

  /* WHAT THE CORNER IS WORTH THIS ROUND, as a rating and nothing else — no
   * multiplier reaches the sim and no die of ours is rolled inside it. */
  const swing = bout.swing * SWING - bout.bleed * BLEED_RATING;
  const mine = makeEntrant({
    id: bout.mine.id, name: bout.mine.name, kind: bout.mine.kind,
    rating: clamp(bout.mine.form.rating + swing, 20, 100),
    hidden: bout.mine.hidden,
  });
  /* THE OTHER CORNER WORKS TOO. Their handler's craft is worth a smaller,
   * steadier swing than a good player's — they are competent and they are not
   * reading YOU, which is the asymmetry the player is being paid for. */
  const theirs = makeEntrant({
    id: bout.theirs.id, name: bout.theirs.name, kind: bout.theirs.kind,
    rating: clamp(bout.theirs.form.rating + (bout.handler?.craft ?? 0.3) * 3.2, 20, 100),
    hidden: bout.theirs.hidden,
  });

  const ground = { ...bout.ground, segments: per };
  const card = { skin: bout.ground.skin, entrants: [mine, theirs] };
  const seed = ((bout.rng.int(1, 1e9)) >>> 0) || 1;
  const result = runSpectacle({ card, ground, seed });

  /* WHAT THE ROUND DID, read off the engine's own result rows. `condition` is
   * the pool less what the entrant took in this round, so the difference is
   * the damage — and the bout carries it because the sim, correctly, does
   * not: every call of it starts a fresh fight. */
  const row = (id) => result.order.find((r) => r.id === id) || { condition: bout.pool, dist: 0 };
  const mineRow = row(mine.id), theirsRow = row(theirs.id);
  const tookMine = Math.max(0, bout.pool - mineRow.condition);
  const tookTheirs = Math.max(0, bout.pool - theirsRow.condition);
  bout.taken.mine += tookMine;
  bout.taken.theirs += tookTheirs;
  bout.dealt.mine += mineRow.dist;
  bout.dealt.theirs += theirsRow.dist;

  /* A WOUND OPENED IS A THING THAT KEEPS COSTING until somebody packs it —
   * which is what makes BIND a real corner choice and not a third flavour of
   * water. The event is the engine's hazard, not ours. */
  for (const ev of result.events) {
    if (ev.type === 'wound' && ev.who === mine.id) bout.bleed++;
  }
  const tagged = result.events.map((ev) => ({ ...ev, round: bout.round }));
  bout.events.push(...tagged);
  bout.history.push({
    round: bout.round,
    intent: bout.intent, tell: bout.tell.id, feint: bout.tell.id !== bout.intent,
    orders: bout.orders.slice(),
    swing: round2(swing),
    took: { mine: round2(tookMine), theirs: round2(tookTheirs) },
    broke,
    segments: per,
    events: tagged,
  });

  /* HOW IT STOPS. A refusal or a beating INSIDE a round is the engine's word
   * and is taken as it stands; otherwise the bout stops when what one animal
   * has taken across the whole fight passes the pool, which is the round
   * structure doing the only job this file gave it. */
  let stop = null;
  for (const ev of tagged) {
    if (ev.type === 'refusal') stop = { by: ev.who === mine.id ? 'theirs' : 'mine', how: 'refusal' };
    else if (ev.type === 'beaten') stop = { by: ev.who === mine.id ? 'theirs' : 'mine', how: 'stoppage' };
  }
  if (!stop && bout.taken.mine >= bout.pool) stop = { by: 'theirs', how: 'stoppage' };
  if (!stop && bout.taken.theirs >= bout.pool) stop = { by: 'mine', how: 'stoppage' };

  if (stop) return finishBout(bout, stop);
  if (bout.round >= bout.rounds) {
    /* THE DISTANCE. Refereed and short, so it is decided on condition — which
     * is `SKINS.ARENA`'s own stated reason for having a hard round limit. */
    const by = bout.taken.mine <= bout.taken.theirs ? 'mine' : 'theirs';
    return finishBout(bout, { by, how: 'decision' });
  }
  bout.phase = 'corner';
  return { round: bout.round, over: false, state: pitState(bout), events: tagged };
}

/**
 * THE ONE ACTION. Refused after the first, refused outside the corner, and
 * refused when it would do nothing — a control that is offered and then
 * silently does nothing is the dead control this tree keeps deleting.
 */
export function cornerAct(bout, actId) {
  if (!bout || bout.over) return { refused: 'the bout is over' };
  if (bout.phase !== 'corner') return { refused: 'you are not in the corner' };
  if (bout.corner) return { refused: `you have already spent it on ${bout.corner}` };
  const A = cornerActById(actId);
  if (!A) return { refused: `no such thing to do: ${actId}` };
  if (A.id === 'bind' && !bout.bleed) return { refused: 'nothing is open on it' };
  bout.corner = A.id;
  let did = '';
  if (A.id === 'water') {
    const back = Math.min(bout.taken.mine, bout.pool * WATER_BACK);
    bout.taken.mine -= back;
    did = `gave back ${Math.round(back)}`;
  } else if (A.id === 'word') {
    bout.carried += WORD_SWING;
    did = 'it goes back out steadier';
  } else {
    const was = bout.bleed;
    bout.bleed = 0;
    did = `${was} closed`;
  }
  return { act: A.id, did, state: pitState(bout) };
}

/**
 * WHAT THE PLAYER CAN SEE OF THEIR OWN ANIMAL, which §G2 requires: "the
 * animal's state is visible so the choice is informed". Every number here is
 * one the corner acts answer, and there is nothing on it a surface would have
 * to compute for itself.
 */
export function pitState(bout) {
  if (!bout) return null;
  return {
    round: bout.round, of: bout.rounds,
    phase: bout.phase,
    condition: round2(Math.max(0, bout.pool - bout.taken.mine)),
    theirCondition: round2(Math.max(0, bout.pool - bout.taken.theirs)),
    pool: bout.pool,
    bleed: bout.bleed,
    /* WHAT THE LAST ROUND'S ORDERS WERE WORTH, in the corner's own units, so a
     * player can see that shouting cost them something. */
    corner: round2(bout.swing),
    carried: round2(bout.carried),
    spent: bout.corner,
    orders: bout.orders.slice(),
    mortal: bout.stake.mortal,
  };
}

/** Wrap it up: an outcome, and a result in the engine's own shape. */
function finishBout(bout, stop) {
  bout.phase = 'over';
  bout.over = true;
  const won = stop.by === 'mine';
  const severity = round2(bout.taken.mine / bout.pool);
  /* THE BOUT AS A RESULT ROW, so the form book, the announcer and `settle()`
   * read a bout exactly as they read a race. Every number in it came out of
   * the rounds; nothing here is a second opinion about who won. */
  const order = [
    { id: won ? bout.mine.id : bout.theirs.id, name: won ? bout.mine.name : bout.theirs.name,
      position: 1, status: 'finished',
      dist: round2(won ? bout.dealt.mine : bout.dealt.theirs),
      condition: round2(Math.max(0, bout.pool - (won ? bout.taken.mine : bout.taken.theirs))) },
    { id: won ? bout.theirs.id : bout.mine.id, name: won ? bout.theirs.name : bout.mine.name,
      position: 2, status: stop.how === 'refusal' ? 'refused' : (stop.how === 'stoppage' ? 'beaten' : 'finished'),
      dist: round2(won ? bout.dealt.theirs : bout.dealt.mine),
      condition: round2(Math.max(0, bout.pool - (won ? bout.taken.theirs : bout.taken.mine))) },
  ];
  bout.events.push({ t: bout.round, type: 'result', who: order[0].id, margin: round2(Math.abs(bout.taken.mine - bout.taken.theirs)) });
  bout.result = {
    skin: bout.ground.skin, ground: bout.ground.id, conditions: bout.ground.conditions,
    seed: null, ticks: bout.round, winner: order[0].id, order, events: bout.events,
  };
  bout.outcome = {
    winner: stop.by, how: stop.how, won,
    rounds: bout.round,
    severity,
    taken: round2(bout.taken.mine), gave: round2(bout.taken.theirs),
    /* THE PURSE, HANDED BACK. Not stored, not added to anything. */
    purse: won ? bout.stake.purse : 0,
    /* A CHAMPION'S COLLAR IS A THING OTHER HANDLERS CAN SEE (§G3, Lane B3's
     * keepsakes). An ID, for the shelf that owns them — never a stat. */
    keepsake: won && bout.stake.mortal ? `collar-${bout.venue.id}` : (won ? `token-${bout.venue.id}` : null),
    state: pitState(bout),
  };
  /* The form book grows on a bout exactly as it grows on a race, so a handler
   * you have fought before reads differently on the board next time. */
  recordResult(bout.card, bout.ground, bout.result);
  return { round: bout.round, over: true, outcome: bout.outcome, events: bout.events };
}

/** Settle a wager against the bout, through the engine's own ledger. */
export function settleBout(bout, wagers = null) {
  if (!bout?.result) return null;
  const list = wagers || (bout.stake.wager
    ? [{ entrant: bout.mine.id, stake: bout.stake.wager }] : []);
  return settle(list, bout.result, bout.board);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  6. CONSEQUENCE — the scar writer the kennel never had
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * §G3, and it is the point.
 *
 * `Kennel.readOne` has carried `scars` since the day it was written — "not
 * chosen, no door removes one" — with NO WRITER ANYWHERE. This is that writer,
 * and it is the only one: a scar is what a pit did to your animal, and nothing
 * reachable from a room can add or remove one.
 *
 * ── THE THREE REFUSALS, IN THE ORDER THEY ARE ASKED ───────────────────────
 *
 *   1. A DOCTOR AT THE RAIL. `venue.doctor` ends it before anything else is
 *      considered, so the Arena cannot kill by any route including a bug.
 *   2. THE STAKE WAS ACCEPTED. `bout.stake.mortal` is only ever true through
 *      `openBout`'s token, which can only come from an offer that stated the
 *      stake in words.
 *   3. IT WAS BAD ENOUGH. A loss is a scar; a KILLING is a loss where the
 *      animal took half again what it takes to stop a fight. A refusal never
 *      kills — an animal that said it was done is an animal that stopped.
 *
 * All three, or the animal comes home.
 */
export const KILL_AT = 1.32;

/** The marks a pit leaves. Not chosen, and the pit names which. */
const SCAR_MARKS = ['a torn ear', 'a raked shoulder', 'a white seam over one eye',
  'a shortened tail', 'a stiff foreleg', 'a jaw that sets wrong', 'a bald stripe along the ribs'];

export function scarFor(bout) {
  const rng = streamOf('scar', bout.venue.id, String(bout.handler?.id), String(bout.round));
  const mark = rng.pick(SCAR_MARKS);
  return `${mark} — ${bout.venue.name}, ${bout.theirs.name}`;
}

/**
 * FOLD THE BOUT INTO THE RECORD THAT FOUGHT IT.
 *
 * Into the SAME record, never a parallel one: `Kennel.save`'s whitelist is the
 * only door, `scars` and `story` are two of its eighteen fields, and this
 * function writes those two and the fallen roll and nothing else. It does not
 * touch `xp`, `runs`, `meals`, `grooms`, `kills`, `tempers` or a rung — the
 * growth ladder is `careFor` and the run fold and this is neither.
 *
 * The disk wins over the bout, on `keepCompanion`'s stated terms: a player who
 * deleted the animal from the Kennel page mid-bout, or adopted a different
 * one, does not get the one they got rid of written back over the top.
 */
export function foldPit(bout) {
  const out = { scar: null, died: false, epitaph: null, story: null, kept: true };
  if (!bout?.over || !bout.outcome) return out;
  const k = loadKennel();
  if (!k.live || k.live.id !== bout.recId) return { ...out, kept: false };
  const rec = k.live;
  const O = bout.outcome;

  const line = O.won
    ? `Beat ${bout.theirs.name} at ${bout.venue.name}, round ${O.rounds}.`
    : `Lost to ${bout.theirs.name} at ${bout.venue.name} — ${O.how}.`;
  rec.story = [...(rec.story || []), line].slice(-STORY_KEEP);
  out.story = line;

  if (!O.won) {
    const scar = scarFor(bout);
    /* NEWEST FIRST and capped where `readOne` caps it, so the sixth scar
     * pushes the first off rather than being silently dropped on the next
     * load — a write that survives in memory and not on disk is the worst
     * shape a durable record has. */
    rec.scars = [scar, ...(rec.scars || [])].slice(0, 6);
    out.scar = scar;

    const killing = !bout.venue.doctor
      && bout.stake.mortal
      && O.how === 'stoppage'
      && O.severity >= KILL_AT;
    if (killing) {
      out.died = true;
      out.kept = false;
      /* THE FALLEN ROLL, WITH THE FIGHT NAMED BESIDE IT. `saneEpitaph` reads
       * these seven fields on the way back in; `where` is the pit and `killer`
       * is the animal that did it, which is what makes the wall readable a
       * month later. */
      out.epitaph = {
        kind: rec.kind,
        name: rec.name,
        where: `${bout.venue.name} — ${bout.handler?.who || 'a stranger'}'s ${bout.theirs.name}`,
        killer: bout.theirs.name,
        at: O.rounds,
        runs: rec.runs | 0,
        fate: 'kia',
      };
      k.fallen.unshift(out.epitaph);
      k.fallen = k.fallen.filter(Boolean).slice(0, FALLEN_KEEP);
      k.lost = (k.lost | 0) + 1;
      k.live = null;
    }
  }
  saveKennel(k);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  7. WATCHING IS FREE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you should be able to bet on other people's companion battles too even if
 * you're not involved, you don't have to bet to watch."*
 *
 * This is the engine's existing property and it is USED rather than rebuilt:
 * `runMeeting` runs a card of strangers whether or not anybody turned up, and
 * `settle` reads a finished result it did not produce. There is no argument on
 * either that a spectator could pass, which is what makes "watching is free"
 * structural instead of polite.
 *
 * The FIELD is the day's handlers — the same roster the player's own opponent
 * comes out of — so the two people fighting on tonight's card at the Underlift
 * are two people who were walking the Concourse this morning.
 */
export function pitCard(venue, { hour = ROSTER_HOUR, day = 0, size = 0, roster = null } = {}) {
  const V = typeof venue === 'string' ? pitById(venue) : venue;
  if (!V) throw new Error('no such pit');
  const pool = roster || handlersOn(hour);
  const ground = dressGround(groundById(V.groundId), hash32(`card|${V.id}|${day}`));
  const n = Math.max(2, size || SKINS[ground.skin].field);
  const rng = streamOf('field', V.id, String(day));
  const entrants = [];
  const taken = new Set();
  for (let i = 0; i < n && pool.length; i++) {
    let h = null;
    for (let tries = 0; tries < 12 && !h; tries++) {
      const c = pool[rng.int(0, pool.length - 1)];
      if (!taken.has(c.id)) h = c;
    }
    if (!h) break;
    taken.add(h.id);
    const rating = Math.round(clamp(46 + streamOf('rate', h.id)() * 46, 20, 100));
    entrants.push(makeEntrant({
      id: h.id, name: h.animal, kind: 'companion',
      rating,
      form: formOf(h, rating),
      hidden: {
        heart: round2(clamp(h.craft * 0.8 - 0.2, -1, 1)),
        vice: round2(clamp(streamOf('vice', h.id).gauss() * 0.5, -1.5, 1.5)),
        footing: footOf(h.kind),
        nerve: round2(clamp(streamOf('nerve', h.id).gauss() * 0.5, -1.5, 1.5)),
        heatLimit: 1.2,
      },
    }));
  }
  /* If the day dealt too few handlers to make a card, the pit runs the fight
   * it CAN run rather than inventing residents — a stranger with an animal is
   * an event and a card that manufactured six of them would undo §G1. */
  if (entrants.length < 2) return { venue: V, ground, card: null, handlers: [], why: 'nobody brought one tonight' };
  const card = makeCard({ skin: ground.skin, entrants });
  return {
    venue: V, ground, card,
    handlers: [...taken].map((id) => pool.find((h) => h.id === id)),
    board: priceCard(card, ground),
    why: 'the card is up',
  };
}

/**
 * TONIGHT'S CARD, RUN. Takes no wagers, exactly as `runSpectacle` takes none:
 * a spectator, a punter and an empty room get the identical fight.
 */
export function runPitCard(venue, opts = {}) {
  const c = pitCard(venue, opts);
  if (!c.card) return { ...c, races: [] };
  const meeting = runMeeting({
    card: c.card, skin: c.ground.skin, races: opts.bouts || 1,
    seed: hash32(`meet|${c.venue.id}|${opts.day | 0}`),
  });
  return { ...c, ...meeting };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  8. THE ANNOUNCER — the room's voice over the engine's stream
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"actual announcer, like imagine real event fights."*
 *
 * `Spectacle.announce` is the announcer and it stays the announcer. What this
 * adds is lines for the four events the ENGINE DOES NOT EMIT because they are
 * the room's and not the fight's — a bell, a corner, a stake read out, a
 * stoppage. `announce` is asked FIRST for every event, and it wins every time
 * it has an answer, so nothing here can shadow a line the engine already
 * speaks. A check drives every event type the engine names and demands both
 * functions say the same words.
 */
const PIT_LINES = {
  bell: (n, ev) => `Round ${ev.round}. ${ev.of === ev.round ? 'Last one.' : ''}`.trim(),
  stake: (n, ev) => (ev.mortal
    ? 'And they have taken the long odds. Nobody is stopping this one.'
    : 'Straight purse, and the doctor stays where she is.'),
  corner: (n, ev) => `In the corner: ${ev.did}.`,
  order: (n, ev) => (ev.right
    ? `That was called off the rail — ${n} answers it.`
    : `${n} is listening to the wrong thing.`),
  stoppage: (n) => `That's it — they're pulling ${n} off.`,
  decision: (n) => `It goes the distance, and it goes to ${n}.`,
};

export function pitCall(ev, card) {
  if (!ev) return null;
  /* THE ENGINE FIRST, ALWAYS. */
  const said = announce(ev, card);
  if (said) return said;
  const fn = PIT_LINES[ev.type];
  if (!fn) return null;
  const name = (id) => card?.entrants?.find((e) => e.id === id)?.name || 'the animal';
  return fn(ev.who ? name(ev.who) : 'the field', ev, name);
}

/** Every moment of a bout worth cutting to, the engine's list plus the bell. */
export const PIT_MOMENTS = Object.freeze(['bell', 'stake', 'corner', 'stoppage', 'decision']);
