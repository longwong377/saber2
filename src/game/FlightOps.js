/**
 * ══════════════════════════════════════════════════════════════════════════
 *  FLIGHT OPS — SHARK §7, and the four rooms that are not the launch
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `StationPlan.js` has carried five flight-ops rooms since the gazetteer was
 * written and `StationKit.js` has stood all five of them up. Every one of them
 * has a verb in §3.2 and not one of those verbs did anything:
 *
 *   #2 Deck control tower   `cantilever`  "read the board: what is inbound"
 *   #3 Pilots' ready room   `lowroom`     "sign the Starfury cert"
 *   #4 Fighter maintenance  `deeppit`     "walk the gantries"
 *   #6 Fighter rack         `cellar`      "grip an engine bell and throw it"
 *
 * This file is those four. #5's launch is `Launch.js` and #55's outside is
 * `Outside.js`, both for the reason `Warp.js` is not in `Station.js`: a clock
 * and a room are different kinds of thing and a file that is both is a file
 * neither can be measured without.
 *
 * ── THE THREE OF THEM ARE ONE LADDER, WHICH IS THE POINT ──────────────────
 *
 * The brief is explicit that #3's cert *"is a gate and not a formality"*, and
 * a gate one press satisfies is a formality with a delay on it. So the cert is
 * three rungs and each rung is signed off something you did in a DIFFERENT
 * room:
 *
 *   FLIGHT MEDICAL   a signature and a pulse — the ready room's own
 *   TYPE RATING      all three levels of #4's gantries, walked
 *   DECK CHECK       #2's board, read with traffic actually on it
 *
 * That is what makes the other three rooms load-bearing rather than scenery:
 * a player who never goes down into the pit never flies, and a player who
 * reads the tower's board at 04:00 when nothing is moving has to come back.
 * `tools/checks/flightops.mjs` walks the ladder and counts the rooms it had
 * to enter — three, or the gate is not a gate.
 *
 * ── AND IT RUNS ON THE STATION CLOCK, WHICH NOBODY OWNS ───────────────────
 *
 * Every function here takes `(day, hour)` and reads no clock of its own —
 * the same bargain `Games.drumAt` struck and for its reason, written into
 * that file's header: *"a casino game a player can re-roll is a save-scum;
 * one that runs on a clock the player does not own is a thing that happens to
 * them."* A traffic board you could re-roll by walking out of the tower and
 * back in would be a random-number generator with consoles in front of it.
 * Two readers at the same `(day, hour)` get the same board, character for
 * character, and the check asserts it over a whole station week.
 *
 * ── WHAT IT IMPORTS, AND WHY IT IS ONE THING ──────────────────────────────
 *
 * `makeRng` from `../engine/MathUtil.js`, and nothing else. It is the tree's
 * one seeded stream and `determinism.mjs` refuses `Math.random` in `src/`;
 * a second copy of mulberry32 in here would be a second stream nobody could
 * seed from outside. No THREE, no world, no DOM, no store — the fold is
 * handed in and handed back, exactly as `Home.js`'s state is, so this file
 * can be driven ten thousand times in a second with no station at all.
 */

import { makeRng } from '../engine/MathUtil.js';

/** FNV-1a. `Pits.js` keeps its own four lines of this and says why: reaching
 *  into another game file for a hash is a dependency for nothing. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}
const seeded = (...parts) => makeRng(hashOf(parts.join('|')));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ══════════════════════════════════════════════════════════════════════════
 *  1. THE BOARD — #2, "read the board: what is inbound"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE RATE IS THE GAZETTEER'S AND IS NOT TYPED TWICE ────────────────────
 *
 * §3.2 #7 Arrivals hall: *"20 movements an hour"*. §3.2 #8 Docking throat:
 * *"a shuttle every 6 min"*. Those are the two numbers this station has
 * already published about its own traffic, so the board is built to hit them
 * rather than to look busy: the throat runs on its six minutes, and the three
 * gates together come to twenty an hour. `MOVEMENTS_AN_HOUR` is derived from
 * the table below and the check reads §3.2 #7's own `who` string and compares
 * — a rate that drifted from the row that promises it would otherwise be
 * invisible, which is exactly how the station ended up with fourteen
 * overlapping rooms on a plan nobody could see.
 *
 * ── A GATE IS A PLACE, AND ALL THREE ARE IN THE GAZETTEER ─────────────────
 *
 * The tower sequences the flight deck's mouth (#1), the docking throat (#8)
 * and the Cobra bay (#5). Nothing here invents a fourth door.
 */
export const GATES = Object.freeze([
  {
    id: 'MOUTH', place: 1, name: "the flight deck's mouth", short: 'MOUTH',
    /** Minutes between slots. 7.5 → eight movements an hour. */
    every: 7.5,
    /** How much of its traffic is going the other way. Fighters leave as often
     *  as they come back; the war is symmetrical and the deck is not a port. */
    outward: 0.5,
    craft: ['Aurora Starfury', 'Thunderbolt', 'Nial fighter', 'Sentinel', 'gunship', 'medevac skiff'],
  },
  {
    id: 'THROAT', place: 8, name: 'the docking throat', short: 'THROAT',
    /** §3.2 #8's own number: a shuttle every 6 min. */
    every: 6,
    /** A port breathes in more than out on a station taking refugees. */
    outward: 0.42,
    craft: ['shuttle', 'liner tender', 'ore lighter', 'mail packet', 'Drazi trader', 'yard tug'],
  },
  {
    id: 'COBRA', place: 5, name: 'the Cobra bay', short: 'COBRA',
    /** The well cycles twice an hour and mostly outward: it is a catapult. */
    every: 30, outward: 0.72,
    craft: ['Aurora Starfury'],
  },
]);

/** Twenty, and §3.2 #7 is where that number comes from. */
export const MOVEMENTS_AN_HOUR = GATES.reduce((a, g) => a + 60 / g.every, 0);

/**
 * What the glass shows. Twelve minutes of history so a movement you watched
 * land is still on the board when you get up the stair, and three quarters of
 * an hour ahead so there is something to wait for. Eight rows because the
 * board `StationKit.cantilever` builds is 5.0 × 1.8 m and eight lines is what
 * fits on it at a size somebody could read from the consoles.
 */
export const BOARD = Object.freeze({ rows: 8, back: 12 / 60, fore: 45 / 60 });

/** One inbound in seven is stacked. A tower that never holds anybody is a
 *  timetable; holding is the whole of what the room is for. */
export const HOLD_RATE = 1 / 7;

/** Where the shuttles come from when they are not coming from the war. */
const PORTS = ['Ganymede', 'Io Station', 'Proxima', 'Beta Durani', 'the Rim', 'Epsilon III'];
/** Wings, for a movement that belongs to the deck rather than to a port. */
const WINGS = ['Zeta', 'Delta', 'Bravo', 'Alpha', 'Echo'];

/**
 * ONE MOVEMENT, from its slot and nothing else.
 *
 * `k` is the slot index on an ABSOLUTE clock — `day * 24 + hour` in that
 * gate's own units — rather than an index into a day. A board indexed within
 * the day empties at 23:50 and refills at 00:00, which is a bug the player
 * watches happen; an absolute index rolls through midnight with the traffic
 * still on it.
 */
function movement(g, k, theatre) {
  const rng = seeded('move', g.id, k);
  const due = (k * g.every) / 60;
  const kind = rng() < g.outward ? 'out' : 'in';
  const craft = g.craft[Math.floor(rng() * g.craft.length) % g.craft.length];
  const wing = WINGS[Math.floor(rng() * WINGS.length) % WINGS.length];
  const port = PORTS[Math.floor(rng() * PORTS.length) % PORTS.length];
  /* A held movement is one the tower has stacked: it sits six to fourteen
   * minutes over the station and comes down late. `due` is when it was
   * expected and `at` is when it will actually be there, and the board shows
   * both — which is what a controller's board is FOR. */
  const held = kind === 'in' && rng() < HOLD_RATE;
  const hold = held ? 0.1 + rng() * 0.133 : 0;
  return {
    n: k, gate: g.id, craft,
    call: `${wing} ${1 + (Math.abs(k) % 9)}`,
    kind, due, at: due + hold, held, hold,
    /* The war is where the fighters come from and the theatre is the one the
     * window is already showing — `Hangar.outsideLevel`'s record, handed in.
     * Two answers to "which war is this" would put a different battle on the
     * board than in the glass. */
    from: g.id === 'THROAT' ? port : theatre,
    mine: false,
  };
}

/**
 * A movement's state on the board, against the clock. Minutes, signed: past
 * is negative.
 *
 * The five words a controller actually uses, and a held movement keeps its own
 * word until its slot comes round — a stack is not an ETA.
 */
export function stateOf(m, now) {
  const mins = (m.at - now) * 60;
  if (m.held && mins > 0) return 'holding';
  if (mins > 12) return 'expected';
  if (mins > 4) return m.kind === 'in' ? 'inbound' : 'to the line';
  if (mins > 0) return m.kind === 'in' ? 'on final' : 'rolling';
  if (mins > -3) return m.kind === 'in' ? 'down' : 'away';
  return 'clear';
}

/**
 * Every movement in the board's window, in time order.
 *
 * `now` is `day * 24 + hour` — absolute, so the caller hands the station's own
 * two numbers and this does the addition once.
 */
export function movementsIn(day, hour, opts = {}) {
  const now = (day | 0) * 24 + (Number(hour) || 0);
  const theatre = opts.theatre || 'the line';
  const back = opts.back ?? BOARD.back, fore = opts.fore ?? BOARD.fore;
  const out = [];
  for (const g of GATES) {
    const per = g.every / 60;
    for (let k = Math.ceil((now - back) / per); k <= Math.floor((now + fore) / per); k++) {
      out.push(movement(g, k, theatre));
    }
  }
  /* YOUR OWN SORTIE IS ON THE BOARD. `Launch.js` hands its movement record to
   * whoever is holding the sequence and the tower is holding it: a launch you
   * made that the tower never called is a launch that happened to nobody. */
  if (opts.mine) out.push({ ...opts.mine, mine: true });
  out.sort((a, b) => a.at - b.at || a.n - b.n);
  return out;
}

/**
 * The board as it is shown: the window, capped at `BOARD.rows`, each row
 * carrying its state and the minutes against it.
 */
export function boardAt(day, hour, opts = {}) {
  const now = (day | 0) * 24 + (Number(hour) || 0);
  const all = movementsIn(day, hour, opts);
  const rows = all.map((m) => ({ ...m, state: stateOf(m, now), mins: Math.round((m.at - now) * 60) }));
  /* Nearest to now, in both directions, then back into time order — a board
   * capped by taking the first eight would drop everything ahead of you at a
   * busy minute and show nothing but history. */
  const near = rows.slice().sort((a, b) => Math.abs(a.mins) - Math.abs(b.mins)).slice(0, opts.rows ?? BOARD.rows);
  near.sort((a, b) => a.at - b.at);
  return near;
}

/** What is actually happening right now, which is what #2's verb asks. */
export function traffic(day, hour, opts = {}) {
  const rows = boardAt(day, hour, opts);
  let inbound = 0, final = 0, holding = 0, away = 0;
  for (const r of rows) {
    if (r.state === 'inbound') inbound++;
    else if (r.state === 'on final') final++;
    else if (r.state === 'holding') holding++;
    else if (r.state === 'rolling' || r.state === 'away') away++;
  }
  return { rows: rows.length, inbound, final, holding, away, live: inbound + final + holding };
}

/** One row, as the glass prints it. */
export function boardLine(r) {
  /* One reduction into 0..24 and then split, rather than taking the hour off
   * `at` and the minutes off `at % 1`: at day 0 a slot inside the board's
   * twelve-minute history window has a NEGATIVE absolute hour, and the two
   * expressions then disagree by an hour on the one row a player would be
   * looking at hardest. */
  const abs = ((r.at % 24) + 24) % 24;
  const hh = Math.floor(abs);
  const mm = Math.floor((abs - hh) * 60 + 1e-6);
  const t = `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
  return `${t} ${r.gate.padEnd(6)} ${String(r.craft).slice(0, 14).padEnd(14)} ${r.state}`;
}

/**
 * The banner #2's verb raises, in one line. The verb is *"what is inbound"*,
 * so what it answers is what is inbound — not a count of rows.
 */
export function inboundLine(day, hour, opts = {}) {
  const now = (day | 0) * 24 + (Number(hour) || 0);
  /* STILL COMING, which is what "inbound" means. A movement already on the
   * deck is history and the row under it is the answer to the question. */
  const rows = boardAt(day, hour, opts)
    .filter((r) => r.kind === 'in' && (r.state === 'holding' || r.state === 'on final'
      || r.state === 'inbound' || r.state === 'expected'));
  if (!rows.length) return 'nothing inbound; the board is clear';
  const first = rows[0];
  const rest = rows.length - 1;
  const out = Math.max(1, Math.round((first.at - now) * 60));
  const when = first.state === 'holding' ? `holding, ${out} out`
    : first.state === 'on final' ? 'on final'
      : `${out} ${out === 1 ? 'minute' : 'minutes'}`;
  return `${first.craft}, ${first.call} — ${when}${rest > 0 ? `, and ${rest} behind` : ''}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  2. THE CERT — #3, "sign the Starfury cert", and it is the gate
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The three rungs, in the order they are signed. `needs` names what the rung
 * reads out of the fold, and every one of those is written in a different
 * room — which is the whole design and the thing the check counts.
 */
export const CERT = Object.freeze([
  {
    id: 'medical', name: 'Flight medical', room: 3,
    asks: 'a signature and a pulse', needs: null,
    line: 'the flight surgeon signs it without looking up',
  },
  {
    id: 'type', name: 'Type rating — Aurora', room: 4,
    asks: 'the airframe, all three levels of it', needs: 'gantries',
    line: 'you have seen one with its panels off, which is the whole of a type rating',
  },
  {
    id: 'deck', name: 'Deck check', room: 2,
    asks: 'the tower board, with traffic on it', needs: 'board',
    line: 'the launch officer wants to know you can read a board with something on it',
  },
]);

/** How many levels of #4's pit there are. `StationKit.deeppit` builds three. */
export const GANTRY_LEVELS = 3;

/**
 * THE READY ROOM BRIEFS BEFORE EVERY LAUNCH CYCLE and nobody signs anything
 * during a briefing. §3.2 #3: *"briefings before a launch cycle"*. Four cycles
 * a day, twenty minutes of briefing before each — so a player who walks in at
 * the wrong twenty minutes is told to wait, which is a room with a rhythm
 * rather than a counter that is always open.
 */
export const CYCLES = Object.freeze([5, 11, 17, 23]);
export const BRIEF_MINUTES = 20;

/** Is the room briefing, and how long is left of it? */
export function briefing(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  for (const c of CYCLES) {
    const from = c - BRIEF_MINUTES / 60;
    if (h >= from && h < c) return { on: true, cycle: c, left: Math.ceil((c - h) * 60) };
  }
  return { on: false, cycle: null, left: 0 };
}

/**
 * The fold this file reads and writes. `StationSave.js` keeps it beside the
 * home's, under the station's own key — a fifth durable key is what
 * `session.mjs` refuses and `Progress.js`'s header argues against.
 *
 * NOTHING IN HERE IS A RUN. `saber.progress.v1` has `station` on its refusal
 * list already and a visit is not a run; a sortie flown off the station files
 * nothing, which `flightops.mjs` asserts against a live store.
 */
export function blankFlight() {
  return { v: 1, cert: [], gantries: [], boards: 0, bells: [], sorties: 0 };
}

/** A fold from anywhere, defaulted field by field — an older fold may be
 *  missing a field a reader expects, which is `StationSave.read`'s own rule. */
export function cleanFlight(f) {
  const b = blankFlight();
  const v = (f && typeof f === 'object') ? f : {};
  return {
    ...b, ...v,
    cert: Array.isArray(v.cert) ? v.cert.filter((id) => CERT.some((c) => c.id === id)) : [],
    gantries: Array.isArray(v.gantries) ? [...new Set(v.gantries.filter((n) => n >= 0 && n < GANTRY_LEVELS))] : [],
    bells: Array.isArray(v.bells) ? v.bells : [],
    boards: Number(v.boards) || 0,
    sorties: Number(v.sorties) || 0,
  };
}

/** The next rung to sign, or null when the cert is complete. */
export function nextCert(fold) {
  const f = cleanFlight(fold);
  return CERT.find((c) => !f.cert.includes(c.id)) || null;
}

/** May you fly? The one question #5 asks this file. */
export function certified(fold) {
  const f = cleanFlight(fold);
  return CERT.every((c) => f.cert.includes(c.id));
}

/** What a rung is still waiting on, or null when it is ready to sign. */
export function certShort(fold, rung) {
  const f = cleanFlight(fold);
  if (rung.needs === 'gantries') {
    const left = GANTRY_LEVELS - f.gantries.length;
    return left > 0 ? `${left} of ${GANTRY_LEVELS} gantry levels unwalked — the pit is #4` : null;
  }
  if (rung.needs === 'board' && f.boards < 1) {
    return 'you have not read the tower board with traffic on it — the tower is #2';
  }
  return null;
}

/**
 * Sign the next rung. Returns the NEW FOLD rather than mutating the old one,
 * so a refusal cannot half-write and a caller can decide whether to persist.
 */
export function signCert(fold, ctx = {}) {
  const f = cleanFlight(fold);
  const rung = nextCert(f);
  if (!rung) return { ok: false, why: 'the cert is signed; the bay is expecting you', fold: f, rung: null };
  const brief = briefing(ctx.hour ?? 12);
  if (brief.on) {
    return {
      ok: false, rung, fold: f,
      why: `the room is briefing the ${String(brief.cycle).padStart(2, '0')}00 cycle — ${brief.left} minutes`,
    };
  }
  const short = certShort(f, rung);
  if (short) return { ok: false, rung, fold: f, why: short };
  return {
    ok: true, rung, why: null,
    fold: { ...f, cert: [...f.cert, rung.id] },
    line: rung.line,
  };
}

/** The three rows, for a banner or a page. */
export function certLines(fold) {
  const f = cleanFlight(fold);
  return CERT.map((c) => ({
    id: c.id, name: c.name, signed: f.cert.includes(c.id),
    short: f.cert.includes(c.id) ? null : certShort(f, c),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE GANTRIES — #4, "walk the gantries"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §3.2 #4: *"a fighter stripped and rebuilt across the day"*. So the pit has a
 * state and the state is the clock's, not the player's: walk in at 03:00 and
 * the airframe is open, walk in at 21:00 and it is nearly a fighter again.
 * The same argument as the board — a workshop that resets when you leave is a
 * diorama.
 *
 * THE THREE LEVELS ARE A HEIGHT AND NOT A MENU. `StationKit.deeppit` hangs
 * catwalks at −5.4, −2.8 and −0.2 metres off the pit's floor, and `Station.js`
 * decides which one you are on from where your feet are. A player who never
 * goes down the stair has walked one level and holds one third of a rating.
 */
export const STRIP = Object.freeze([
  { from: 0, id: 'cowls', what: 'cowls off, the port engine on the crane' },
  { from: 5, id: 'engines', what: 'both engines out, the bay smells of coolant' },
  { from: 10, id: 'bare', what: 'a bare frame on the lift — you can see straight through it' },
  { from: 15, id: 'refit', what: 'engines going back in, two techs on the torque wrench' },
  { from: 20, id: 'panels', what: 'panels on, and somebody is signing for it' },
]);

/** Where the airframe is in its day. Pure in the hour, so everybody in the pit
 *  is looking at the same aeroplane. */
export function gantryStage(day, hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  let best = STRIP[0];
  for (const s of STRIP) if (h >= s.from) best = s;
  /* Which airframe it is turns over with the day — the pit rebuilds a
   * different one tomorrow, off the same seed everything else on this station
   * reads the day from. */
  const rng = seeded('pit', day | 0);
  return { ...best, tail: `${1200 + Math.floor(rng() * 700)}`, day: day | 0 };
}

/** What each of the three levels shows you, at this stage. */
export const GANTRY_VIEW = Object.freeze([
  'the underside: the gun bays open and the shell casings still in the trays',
  'the spine: the cockpit tub with the seat out of it',
  'the top rail: you are looking down on the whole airframe',
]);

/**
 * Walk one level. New fold out; `seen` is how many of the three you now hold,
 * which is the number the type rating reads.
 */
export function walkGantry(fold, level, ctx = {}) {
  const f = cleanFlight(fold);
  const n = level | 0;
  if (!(n >= 0 && n < GANTRY_LEVELS)) return { ok: false, why: 'that is not a gantry', fold: f, seen: f.gantries.length };
  const stage = gantryStage(ctx.day ?? 0, ctx.hour ?? 12);
  const had = f.gantries.includes(n);
  const gantries = had ? f.gantries : [...f.gantries, n].sort();
  return {
    ok: true, why: null, level: n, had, stage,
    seen: gantries.length, left: GANTRY_LEVELS - gantries.length,
    line: `${GANTRY_VIEW[n]} — ${stage.what}`,
    fold: had ? f : { ...f, gantries },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  4. THE ENGINE BELL — #6, "grip an engine bell and throw it"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The verb the gazetteer gives this room is one the game already has: the four
 * bells `StationKit.cellar` puts on their stands are `Props.Prop` bodies like
 * every other loose thing on the station, and the Force already grips and
 * throws them. What was missing is what a thrown one MEANS.
 *
 * It means what it means to a fitter, which is the only reading that is worth
 * having: **you throw a bell to hear it.** A sound bell rings on one note. A
 * cracked one has a second partial a few hertz off the first and beats against
 * itself, and no amount of looking at it will tell you — which is why nobody
 * looks at them and everybody throws them.
 *
 *   WHETHER A BELL IS CRACKED IS THE BELL'S PROPERTY, not the throw's. The
 *   throw only reveals it, and a soft one reveals nothing. A verb whose
 *   outcome depended on how hard you threw would be a strength meter; this is
 *   a test, and the answer was already true before you picked it up.
 *
 * A sound bell is a spare the Cobra bay can fit, which is `spares()` and is
 * the one thing this room hands the launch.
 */
export const BELL = Object.freeze({
  /** How many are on stands. `StationKit.cellar` builds four. */
  count: 4,
  /** Impact speed, m/s, under which it is a nudge and not a strike. */
  ring: 5.0,
  /** How many of them are cracked, on average. A rack with none is a prop. */
  cracked: 0.35,
});

/** Is this bell sound? A property of the day's rack and of the bell. */
export function bellSound(day, index) {
  return seeded('bell', day | 0, index | 0)() >= BELL.cracked;
}

/**
 * Throw one. `speed` is the impact speed the physics actually produced, so a
 * lobbed bell says so — the room does not grade your throw, it just cannot
 * hear a quiet one.
 */
export function ringBell(day, index, speed) {
  const i = index | 0;
  const v = Math.max(0, Number(speed) || 0);
  const sound = bellSound(day, i);
  /* The note: a 60 cm bell on a Starfury's number two runs around 210 Hz, and
   * the cracked one's second partial is what you are listening for. */
  const rng = seeded('note', day | 0, i);
  const hz = Math.round(196 + rng() * 34);
  if (v < BELL.ring) {
    return { ok: false, heard: false, sound: null, hz, beat: 0, index: i, speed: v,
      line: 'it lands flat and says nothing — you have to actually throw it' };
  }
  const beat = sound ? 0 : Math.round(3 + rng() * 6);
  return {
    ok: true, heard: true, sound, hz, beat, index: i, speed: v,
    line: sound
      ? `${hz} hertz and it holds — that one is good`
      : `${hz} and a beat of ${beat} under it — cracked, and it was never going to look it`,
  };
}

/** Throw it and remember the answer. New fold out. */
export function throwBell(fold, index, speed, ctx = {}) {
  const f = cleanFlight(fold);
  const rung = ringBell(ctx.day ?? 0, index, speed);
  if (!rung.heard) return { ...rung, fold: f, spares: spares(f, ctx.day ?? 0) };
  const key = `${ctx.day ?? 0}:${rung.index}`;
  const bells = f.bells.includes(key) ? f.bells : [...f.bells, key];
  const next = { ...f, bells };
  return { ...rung, fold: next, spares: spares(next, ctx.day ?? 0) };
}

/**
 * How many sound bells the rack has FOUND — not how many it has. An untested
 * bell is not a spare, which is the difference between a store and a rack.
 */
export function spares(fold, day) {
  const f = cleanFlight(fold);
  let n = 0;
  for (const key of f.bells) {
    const [d, i] = String(key).split(':');
    if ((d | 0) === (day | 0) && bellSound(d | 0, i | 0)) n++;
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  AND THE ONE THING THE FOUR ROOMS HAND THE FIFTH
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything #5's door needs, in one call, so `Station.js` asks one question
 * rather than four and there is one answer to "may this player launch".
 */
export function readiness(fold, day, hour) {
  const f = cleanFlight(fold);
  const rung = nextCert(f);
  return {
    cert: certified(f),
    next: rung, short: rung ? certShort(f, rung) : null,
    signed: f.cert.length, rungs: CERT.length,
    spares: spares(f, day),
    sorties: f.sorties,
    briefing: briefing(hour).on,
    /* The board is a live thing and the bay reads it too: you do not launch
     * into a recovery. */
    traffic: traffic(day, hour),
  };
}

/** The refusal line #5 says when the cert is short, in the player's words. */
export function shortLine(fold) {
  const f = cleanFlight(fold);
  const rung = nextCert(f);
  if (!rung) return null;
  return `${f.cert.length} of ${CERT.length} signed — ${rung.name.toLowerCase()} next: ${rung.asks}`;
}

/** A sortie flown, recorded on the fold and nowhere else. */
export function flew(fold) {
  const f = cleanFlight(fold);
  return { ...f, sorties: (f.sorties | 0) + 1 };
}

/** The clamp, exported because `Launch.js` has none of its own and the two
 *  files agree about what 0..1 means. */
export const unit = clamp01;
