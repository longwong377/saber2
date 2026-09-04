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
export function setStationHour(h) {
  const s = read();
  s.hour = ((Number(h) || 0) % 24 + 24) % 24;
  return write(s).hour;
}

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

/** Start again. Only a check calls this. */
export function clearStation() { store.drop(); _cache = null; return read(); }
