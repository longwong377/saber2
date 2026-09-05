/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE STATION'S OWN FOLD — the clock, your standing, your name for it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `SHARK.md` §14: *"One `station` fold in `Session`: the clock, `standing`,
 * the home's state, which places have been visited. The kennel and the ledger
 * already persist. A return visit is the same station later in the day."*
 *
 * And V15 adds the first thing in it a player will actually notice: **you can
 * name your station.** A place with your name on it is a place you own, and
 * it is the cheapest thing on that whole list.
 *
 * ── WHY IT IS ITS OWN FILE AND ITS OWN KEY ────────────────────────────────
 *
 * `Progress.js` keeps runs, `Kennel.js` keeps animals, `Company.js` keeps men.
 * Each is one key, one shape, one reader — and the reason is written into
 * `Progress.js`'s own header: a blob that several systems share is a blob one
 * of them will migrate badly. The station is a fourth thing that outlives a
 * run, so it is a fourth key.
 *
 * ── AND A DEATH DOES NOT TOUCH IT ─────────────────────────────────────────
 *
 * V15 is explicit about the home: *"you would have the option of saving it so
 * you don't lose all the work if you die."* Nothing in this file is written
 * from a run's ending, and `clearStation()` exists only for a check.
 */

import { makeStore } from './Store.js';

const KEY = 'saber.station.v1';

/**
 * ── ONE STORAGE POLICY, AND THIS FOLD IS UNDER IT NOW ─────────────────────
 *
 * This file did its own `try { localStorage.setItem(...) } catch {}`, which is
 * exactly the shape `Store.js` was written to end: a refused write — private
 * browsing, a full quota — was swallowed and nothing anywhere knew. The name
 * on the board and the clock survive that badly enough; V15 §1.3 then puts the
 * PLAYER'S HOME in this same fold, with *"the option of saving it so you don't
 * lose all the work if you die"* as its whole point. A home that silently
 * stops saving is the failure `Store.js`'s header calls the worst this tree
 * can have.
 *
 * `makeStore` distinguishes the three cases this file could not: an absent key
 * on a working store is an EMPTY record, a refused write is remembered in
 * memory AND flagged, and a `drop()` is a real delete rather than something
 * the mirror undoes.
 */
const store = makeStore(KEY);

/** True once a write has been refused. A screen's cue to say the fold is not
 * reaching the disk — see `Store.js`. */
export function stationBroken() { return store.broken; }

/**
 * The default station, and it has a NAME rather than a blank.
 *
 * `Crossroads` is §10's own word for the place — *"the station is a crossroads
 * port. The Republic bolted a flight deck onto a hull nobody built, and people
 * from everywhere live here."* A blank name would read on the departures board
 * as a bug; a name you did not choose reads as an invitation to choose one.
 */
export const DEFAULT_NAME = 'Crossroads';

/** How long a station's name may be. It goes on a board, at a size. */
export const NAME_MAX = 18;

function blank() {
  return {
    v: 1,
    /** What you call it. Shown on every board, sign, readout and page. */
    name: DEFAULT_NAME,
    /** §3.4's clock, so a return visit is later in the same day. */
    hour: 9,
    /**
     * ── HOW MANY MIDNIGHTS THIS STATION HAS CROSSED ────────────────────────
     *
     * IT IS A STORED COUNTER AND NOT A DERIVATION, and that is the whole
     * repair. `stationDay` used to compute `Math.floor(hour / 24) +
     * seen.length` — and `hour` is the only thing this file stores, wrapped
     * into [0, 24) by `setStationHour` on every write, so `floor(h / 24)` was
     * structurally 0; `seen` has one writer, `markSeen`, which has no callers
     * anywhere in `src/` or `tools/`, so it was structurally 0 too. Measured
     * in node before this field existed: after +10, +24, +100, +500 and +1000
     * station hours — 41 in-game days, some 33 real hours of play at §3.4's
     * rate — `stationDay()` answered 0, 0, 0, 0, 0. In the live build, 80
     * station hours on deck 40 moved `st.day` 0 → 0 and the clothier's shelf
     * came back byte-identical.
     *
     * Everything V16 rerolls is seeded off that number: the shop shelves, the
     * keeper behind each counter, the residents' faces, the job board, the
     * pit's handler card, the tote programme, the casino seats, the bar's
     * leave roll. Six files thread `day` correctly and all six were being fed
     * a constant, so *"the shops don't always have the same things"* and
     * *"the same shop owner doesnt always look the same"* were false for every
     * player who has ever played it.
     *
     * A COUNTER, BECAUSE THE HOUR CANNOT CARRY IT. The wrap is not optional —
     * the clock is a 24-hour wall clock and every reader wants 0..24 — so the
     * midnight is an EVENT, and an event that is not recorded when it happens
     * is gone. `setStationHour` folds whole days out of what it is handed and
     * `Station.tickStationClock` routes its wrap through that same door, so
     * there is one place a day is counted.
     *
     * IT IS IN THIS FOLD AND NOT A KEY OF ITS OWN, for the reason written over
     * `flight` above: `session.mjs` counts the durable writers in this tree and
     * refuses a fourth. `saber.station.v1` already persists, which is also why
     * the day survives a reload — *"the same day for everyone, and it changes
     * tomorrow"* is worth nothing if closing the tab puts it back to Monday.
     *
     * AND IT ONLY EVER GOES UP. Every writer below is a `+=` behind a `> 0`
     * guard, so a negative hour, a NaN, a clock set backwards by a screen or a
     * fold written by an older build cannot un-happen a day the player lived.
     */
    day: 0,
    /** §11's consequence. Falls when you hurt a resident; the kiosks read it. */
    standing: 0,
    /** Which places you have walked into, for §14's "the first visit". */
    seen: [],
    /**
     * The home's state — V15 §1.3, and `Home.js` owns every field of it.
     *
     * NULL IS THE DEFAULT AND IT IS NOT AN EMPTY HOME: `Home.clean` reads a
     * missing record as the cabin §3.2 describes, furnished with
     * `DEFAULT_LAYOUT`, so a player who has never touched it walks into a room
     * rather than into a bare floor. What is stored is `{ v, place, surfaces,
     * pieces, store, pad }` — `v` is the migration hook, `place` is which door
     * the dressing was last behind (V16 Lane F assigns a different one per
     * co-op guest), and `store` is the food and the parcels the home holds
     * (V16 §2 B5, §3.2), empty until those lanes land.
     */
    home: null,
    /**
     * FLIGHT OPS — SHARK §7, and `FlightOps.js` owns every field of it.
     *
     * NULL IS THE DEFAULT AND IT IS AN UNCERTIFIED PILOT, not an empty object:
     * `FlightOps.cleanFlight` reads a missing record as somebody who has never
     * been down to the pit, never read the tower's board and cannot sign for a
     * Starfury — which is the state §7's whole ladder starts from. What is
     * stored is `{ v, cert, gantries, boards, bells, sorties }`.
     *
     * IT IS IN THIS FOLD AND NOT A KEY OF ITS OWN. `session.mjs` counts the
     * durable writers in this tree and refuses another; the cert is the
     * station's business exactly as the home and the clock are, and a sortie
     * is emphatically NOT a run — `saber.progress.v1` already refuses
     * `station` and nothing here goes near `recordRun`.
     */
    flight: null,
  };
}

let _cache = null;

function read() {
  if (_cache) return _cache;
  const v = store.read();
  /* A missing or unreadable fold is a NEW station, not an error and not a
   * half-populated object: every field is defaulted from `blank()` and only
   * the ones actually stored are laid over it, so a fold written by an older
   * version cannot leave a field undefined for a reader that expects one. */
  _cache = { ...blank(), ...(v && typeof v === 'object' ? v : {}) };
  if (typeof _cache.name !== 'string' || !_cache.name.trim()) _cache.name = DEFAULT_NAME;
  if (!Array.isArray(_cache.seen)) _cache.seen = [];
  return _cache;
}

function write(v) {
  _cache = v;
  store.write(v);
  return v;
}

/** The whole fold. Read-only for callers; use the setters below. */
export function loadStation() { return read(); }

/** What the player calls this station. Never blank. */
export function stationName() { return read().name; }

/**
 * Name it. Trimmed, capped, and a blank goes back to the default rather than
 * leaving the boards empty — a player who clears the field has not asked for
 * an unnamed station, they have asked to start again.
 */
export function setStationName(name) {
  const s = read();
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  s.name = clean || DEFAULT_NAME;
  return write(s).name;
}

/** The clock, so a return visit is later in the day (§3.4). */
export function stationHour() { return read().hour; }

/**
 * ── WHAT DAY IT IS ON THE STATION, AND THERE IS ONE ANSWER ───────────────
 *
 * The shelves, the job board, the pit's card, the tote's programme and the
 * bar's leave roll are every one of them seeded off it, so two readers who
 * disagreed about the day would put two different rooms on one station.
 *
 * It lived as a private in `main.js` and half of it is `seen.length`, which is
 * this file's own record and nothing outside could reach — so `StationLife`
 * could not answer the question at all, and the same third of the roll took
 * leave every single evening. It is here because this is the file that owns
 * both halves.
 */
export function stationDay(hour = null) {
  const s = read();
  /* THE HOUR ARGUMENT IS NOT PART OF THE ANSWER ANY MORE, and it is still in
   * the signature on purpose: six call sites hand in `st.hour` so that the
   * room they are dressing and the fold agree to the digit, and the way to
   * keep that promise is for every one of them to get the SAME number back.
   * The old body derived the day FROM the hour — `Math.floor(h / 24)` — which
   * is why it never moved: the hour it was handed had already been wrapped
   * into [0, 24) by the two writers below, so the quotient was always 0. The
   * day is now counted where midnight actually happens; see `day` in
   * `blank()`. A caller that passes an hour gets today, which is what it
   * wanted and what it never got. */
  void hour;
  return s.day | 0;
}

/**
 * ── THE HOUR, AND THE MIDNIGHTS IT WAS THROWING AWAY ──────────────────────
 *
 * This wrapped and stored, full stop, so `passStationHours(30)` — a long
 * mission — moved the clock from 09:00 to 15:00 and lost the night in between.
 * The fold is the only thing that knows how many whole days went past, because
 * it is the only thing that sees the unwrapped number, so this is where they
 * are counted.
 *
 * ONE DOOR, AND ONLY THIS ONE. `tickStationClock` is the frame writer and it
 * wraps `st.hour` in place, so it hands its unwrapped hour through HERE rather
 * than getting a midnight-counter of its own — a second writer of the day is
 * two answers to what day it is, which is the failure the day was centralised
 * to end, and `markSeen` is this file's own standing reminder of what an
 * export with no callers is worth.
 *
 * WHOLE DAYS ONLY, AND ONLY FORWARD. `Math.floor(raw / 24)` on a negative is
 * negative, and a screen that set the clock back — `medbay.mjs` drives 23:00
 * then 01:00 to test the night — must not un-count a day either. Both are the
 * one `rolled > 0` guard.
 */
export function setStationHour(h) {
  const s = read();
  const raw = Number(h) || 0;
  const rolled = Math.floor(raw / 24);
  if (rolled > 0) s.day = (s.day | 0) + rolled;
  s.hour = ((raw % 24) + 24) % 24;
  return write(s).hour;
}


/**
 * ══ TIME PASSES WHILE YOU ARE AWAY ════════════════════════════════════════
 *
 * V16 §C1's promise for the ward is *"you go and do something else and come
 * back and he's on his feet"* — and a hostile pass measured what "something
 * else" actually meant. `stepStation` is the only writer of `st.hour`, and it
 * runs on the STATION world alone. So the clock stopped during a run and
 * stopped at the menu, and the only way to mend a man was to idle in the drum:
 * a tank is twelve station hours, which at §3.4's rate is twenty-four real
 * minutes of walking in circles, and untended is eighty.
 *
 * A RUN IS THE SOMETHING ELSE. This is the door an ending calls with the
 * seconds it took, so coming home from a mission has moved the wall clock by
 * what the mission cost — five to ten hours for a real run, which is most of a
 * tank and exactly the sentence.
 *
 * AND IT IS WHERE A DAY ACTUALLY TURNS OVER, which is the other half of the
 * repair. A run is five to ten station hours, so two or three of them cross a
 * midnight; `setStationHour` is handed the UNWRAPPED sum and folds the whole
 * days out of it, so coming home from a long mission is coming home tomorrow —
 * new shelves, new faces behind the counters, a new job board. Before this the
 * sum was wrapped and the midnight discarded, and the day was 0 for ever.
 *
 * IT IS HOURS AND NOT A WALL CLOCK, deliberately. Reading `Date.now()` would
 * let a player mend a company by closing the tab for a week, and would put a
 * second, ungoverned clock in a tree whose whole timekeeping is `st.hour` at
 * §3.4's rate. What passes here is time the player SPENT.
 */
export function passStationHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return read().hour;
  return setStationHour(read().hour + h);
}

/** Seconds of play, at §3.4's one game hour per two real minutes. */
export const HOURS_PER_SECOND = 1 / 120;

/** §11's standing: it falls when you hurt a resident and the kiosks read it. */
export function standing() { return read().standing; }
export function setStanding(n) {
  const s = read();
  s.standing = Math.max(-40, Math.min(40, Math.round(Number(n) || 0)));
  return write(s).standing;
}

/** Have you been here before? §14's guide walks a fresh player once, and once. */
export function hasSeen(id) { return read().seen.includes(id); }
export function markSeen(id) {
  const s = read();
  if (!s.seen.includes(id)) { s.seen.push(id); write(s); }
  return s.seen.length;
}

/** The home's state. Opaque here: `Home.js` owns its shape (V15 §1.3). */
export function homeState() { return read().home; }
export function setHomeState(v) { const s = read(); s.home = v; return write(s).home; }

/** The flight-ops fold. Opaque here too: `FlightOps.js` owns its shape (§7). */
export function flightState() { return read().flight; }
export function setFlightState(v) { const s = read(); s.flight = v; return write(s).flight; }

/** Start again. Only a check calls this. */
export function clearStation() { store.drop(); _cache = null; return read(); }
