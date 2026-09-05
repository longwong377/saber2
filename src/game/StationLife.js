/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE LIFE — sixty real bodies, a day, a tram, and a consequence
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT THIS FILE IS FOR, IN THE PLAYER'S OWN WORDS ──────────────────────
 *
 * *"it really needs to feel like a functioning laid out station with anything
 * an actual station might have … everything actually modelled and with physics
 * and interactable like any other body in Battlefield Borz — the
 * space-physics/ragdoll sandbox feel."*
 *
 * `SHARK.md` §11 turns that into a rule with a number in it: **every resident
 * within ~40 m is a REAL body** — `world.spawnEnemy(archetype)` with
 * `team = player.team`, so it ragdolls, loses limbs, is gripped and thrown,
 * flinches and speaks exactly as a trooper does — and beyond that the baked
 * crowd fills the far end of a hall. A pool of about sixty live bodies
 * re-seats itself round the player.
 *
 * The basis is the frame ledger's own: 240 real bodies at ~31 ms. Sixty live
 * plus the crowd sits inside the budget a wave takes, and §12.2 makes it a
 * bound rather than a hope — the pool is the FIRST knob if a real machine
 * reads worse than the hangar, and the ink pass and the ragdoll are the two
 * things that are never the knob.
 *
 * ── AND WHY A POOL RATHER THAN A POPULATION ───────────────────────────────
 *
 * §12.3: "a place's headcount in §3.2 is who is THERE, not who is live at
 * once." The Concourse holds sixty to ninety at the busy hours and the whole
 * drum holds several hundred; spawning them would be the frame budget spent
 * on people standing in rooms nobody is in. So the plan's `heads` is a
 * DENSITY, the pool is a budget, and this file spends the second against the
 * first, nearest first.
 *
 * ── THE DAY ───────────────────────────────────────────────────────────────
 *
 * §3.4: one game hour per two real minutes, held on `world._station.hour` by
 * `Station.js` and read here and nowhere else. `schedule.py`'s rhythms and
 * nineteen roles are in `StationCast.js`; what this file adds is the join —
 * at hour H, which places are full, of whom, and doing what.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PLACES, PLACE, DECK_Y, DRUM, placesOn, floorOf, waysOn, junctionsOn } from './StationPlan.js';
import {
  SPECIES_KEYS, SPECIES_BY, RHYTHMS, ROLE_BY, resident, speciesFor, roleFor,
  residents, frictionBetween, BORZ_BY_PLACE, borzArchetype, nameFor,
} from './StationCast.js';
import { barman } from './Bars.js';
import { companyOf } from './StationBoards.js';
/**
 * ══ THE HANDLERS, AND WHY THIS IMPORT POINTS BACKWARDS ════════════════════
 *
 * `Pits.js` imports `headcount` and `occupant` from this file, so this is a
 * cycle — and it is the right way round anyway: `isHandler` is *"a pure
 * function of the resident"* and that rule belongs to the pit, which is the
 * only thing that cares who fights. What this file needs is to READ it, once
 * per body, so the person who walks the concourse with an animal at heel and
 * the person the pit fields that night cannot be two different rolls.
 *
 * ESM initialises function declarations at instantiation and both of these are
 * declarations, so whichever module is entered first the binding is there by
 * the time anything calls it. Nothing at module scope in either file calls
 * across; `station.mjs` imports both orders.
 */
import { handlerOf, handlersOn } from './Pits.js';
/* THE ONE EXEMPTION FROM THE DAILY REROLL — see `occupant`. `Quests.js` holds
 * the ledger and answers in SEEDS, so this file still decides who stands where
 * and `StationCast.resident` still decides what a person looks like. */
import { pinnedAt } from './Quests.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE BUDGET                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * §12.3: "Quality tiers apply. The existing low/medium/high/ultra settings
 * scale the station like the deck: the pool (30/45/60/60)."
 */
export const POOL = { low: 30, medium: 45, high: 60, ultra: 60 };

/** How near a body has to be to be REAL rather than baked (§11: ~40 m). */
export const LIVE_RADIUS = 40;
/** Hysteresis, so a body on the boundary is not spawned and despawned every
 * frame the player breathes. Measured the hard way in every crowd system ever
 * written: without it the pool churns and the frame cost is the churn. */
export const DROP_RADIUS = 52;

/**
 * Is there a `process.cpuUsage` to time with? Node has one and a browser does
 * not — and see the note at its first use for why the test must be `typeof`.
 */
const HAS_CPU = typeof process !== 'undefined' && typeof process.cpuUsage === 'function';

/** How often the pool re-seats itself. Not every frame: a spawn is a body. */
const RESEAT_EVERY = 0.5;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHO IS WHERE, AT WHICH HOUR                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/** A stable 0..1 from two integers. Nothing per frame allocates. */
function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Is `hour` inside the window that starts at `from` and runs `len` hours? */
function within(hour, from, len) {
  if (len <= 0) return false;
  if (len >= 24) return true;
  const d = (hour - from + 24) % 24;
  return d < len;
}

/**
 * ══ HOW FULL A PLACE IS AT AN HOUR ════════════════════════════════════════
 *
 * The gazetteer gives every place a `peak` hour and a headcount AT that hour.
 * The curve between is a cosine over the day rather than a step, because a
 * shift change should FLOOD a concourse and drain it, and a table of twenty-
 * four numbers per place would be fifty-five tables nobody could keep true.
 *
 * §3.4's three rhythms ride on top of it and each is a real feature of the
 * day rather than a multiplier chosen to look busy:
 *
 *   SHIFT CHANGE at 06/14/22 floods the ring and the concourse.
 *   MEALS at 07/13/19 fill the restaurant, the galley and the food court.
 *   THE CANTINA peaks at 21 and the quarters sleep by species rhythm.
 */
export function fullness(place, hour) {
  const peak = place.peak ?? 13;
  /* The day's own curve: 1 at the peak, 0.18 twelve hours away. */
  const off = Math.abs(((hour - peak + 36) % 24) - 12);
  let k = 0.18 + 0.82 * (1 - off / 12) ** 1.6;
  /* Shift change: three floods a day through anything on a route. */
  for (const s of [6, 14, 22]) {
    const d = Math.abs(((hour - s + 36) % 24) - 12);
    if (d > 11.4) k += place.id === 9 || place.band === 'ring' ? 0.55 : 0.18;
  }
  /* Meals, in the three places §3.2 says they happen in. */
  if (place.id === 15 || place.id === 16 || place.id === 17) {
    for (const m of [7, 13, 19]) if (Math.abs(((hour - m + 36) % 24) - 12) > 11.6) k += 0.6;
  }
  return Math.max(0, Math.min(1.6, k));
}

/**
 * How many people are IN a place at an hour. Not how many are live — see the
 * header. `station.mjs` holds every place to being non-empty at its own busy
 * hour, which is what stops a room from being furniture.
 */
export function headcount(place, hour) {
  const heads = place.heads || 0;
  /**
   * ══ A FIXED OCCUPANCY IS A FACT, NOT A RHYTHM ══════════════════════════
   *
   * §3.3: the Vorlon is *"one encounter suit, one place (#37), never walks"*.
   * `StationCast.speciesFor` says the same thing in a comment — *"there is
   * one, it is placed by hand at #37"* — and nothing ever placed him: the row
   * carried `heads: 0`, so the fifteenth species had no slot anywhere on the
   * station and the census read fourteen at every hour of every day.
   * `station.mjs` skipped him with a comment that named the hand-placement
   * that did not exist, which is why nothing ever said so.
   *
   * He cannot be on the curve either — it empties a one-head room for nine
   * hours a day, midday among them. `fixed` says the number is the number.
   */
  if (place.fixed) return heads;
  const n = Math.round(heads * fullness(place, hour));
  /* A place somebody LIVES in is never literally empty while the day is on
   * it. The mortician is one person in a room of drawers and the curve would
   * round him away at every hour but three, which reads as an abandoned
   * station rather than as a quiet one. */
  return (heads > 0 && n === 0 && fullness(place, hour) > 0.35) ? 1 : n;
}

/**
 * Where in a place a body stands. Deterministic on the slot index, so a
 * resident who is despawned and respawned comes back where they were rather
 * than teleporting across the room as you walk past its door.
 *
 * EXPORTED FOR THE CHECK THAT COUNTS WHAT THE WALKWAYS DECLARE. `station.mjs`
 * asks how many of a deck's walk slots fall inside `LIVE_RADIUS` of where the
 * player is standing, and that is exactly the question `reseat` asks of this
 * function — a check that re-derived the scatter would be measuring its own
 * copy of it.
 */
export function slotIn(place, i, out) {
  const u = h2(place.id * 1000, i * 7 + 1) - 0.5;
  const v = h2(place.id * 1000 + 3, i * 7 + 2) - 0.5;
  const lx = u * place.w * 0.72, lz = v * place.d * 0.72;
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  out.set(place.x + lx * c + lz * s, floorOf(place), place.z - lx * s + lz * c);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PEOPLE ON THE WALKWAYS                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ NOBODY WAS EVER IN THE CORRIDOR ═══════════════════════════════════════
 *
 * `reseat` walked `st.places` and nothing else, and `dressStation` skips the
 * ring band entirely — so the pool only ever seated bodies INSIDE rooms. Every
 * walkway in the drum, on every deck, at every hour, held exactly zero people.
 * The player's word for the result was *"a series of connected rooms"*, and on
 * this one point the code agreed with him literally.
 *
 * A walkway is not a room, so it does not get a `PLACES` row; what it gets is
 * a derived one. Each junction, each fixture on `WAYS`, and each open stretch
 * between them becomes a pseudo-place with a footprint, a headcount and a
 * peak, and from there the existing pool machinery does the rest — the same
 * census, the same species, the same stable seed, the same live radius.
 *
 * Their `band` is `'ring'`, which is not decoration: `fullness` already gives
 * the ring a 0.55 flood at each of the three shift changes against 0.18
 * elsewhere, because §3.4 says a shift change floods the ring. Now there is
 * something for it to flood.
 *
 * ── AND THEY STAND, EXCEPT THE ONES ON THE OPEN STRETCHES ────────────────
 *
 * Most of them are seated at the places a person STOPS: at a counter, on a
 * bench, under a gantry, at the rail of an overlook, waiting at a crossing.
 * The `walk` stretches are the other thing — people in transit — and those
 * are handed to `planRoute` below, which gives each of them somewhere to be
 * going.
 */

/**
 * ══ HOW MANY OPEN STRETCHES, AND HOW WIDE ═════════════════════════════════
 *
 * MEASURED, and it is why these three numbers moved. Eight stretches at 45°
 * is a 14 m blob of people every 67 m of ring, and the pool only ever makes a
 * body real inside `LIVE_RADIUS` — 40 m, which is ±27° of a 537 m ring. So
 * wherever the player stood, ONE stretch was in range and four of the deck's
 * forty-four declared walk slots were ever alive at once. The ring read empty
 * because it was empty everywhere except one 14 m patch you were probably not
 * standing in.
 *
 * Twelve stretches at 30°, each 58 m of arc wide, is the fix and it is one
 * fact: `slotIn` scatters a slot across `0.72 × w`, which is 42 m against a
 * 45 m spacing, so the ring is populated CONTINUOUSLY rather than in blobs.
 * The bearings are 15° + 30°k, which misses all four junctions (0/90/180/270)
 * — a crossing is its own pseudo-place and already has people waiting at it.
 *
 * WHAT IT COSTS is bounded by the pool and not by this table: `reseat` seats
 * nearest-first up to `POOL[quality]`, so more declared heads on the ring means
 * the budget is spent on the corridor the player is standing in rather than on
 * rooms forty metres away. The frame cost is the budget's, unchanged.
 */
const RING_WALKS = 12;
const RING_WALK_W = 58;
const WALK_HEADS = 6;

/**
 * A SPINE STRETCH IS NARROW AND LONG, and the width is load-bearing rather
 * than cosmetic. `slotIn`'s scatter is TANGENTIAL in `w`, and a spine walker's
 * first leg is a radial along ITS OWN bearing — so a seat 2 m off the spine's
 * centreline at r = 53 is 3.2 m off it by the time the walk reaches the ring
 * at r = 85.5, and the spine is 7 m wide. Four metres of scatter keeps the
 * worst case inside the corridor at both ends; `spineAt` holds the same bound
 * from the other side.
 */
const SPINE_WALK_W = 4;
const SPINE_WALK_D = 46;

/** How many people are found at each kind of fixture at its busy hour. */
const WAY_HEADS = {
  market: 8, shopfront: 5, kiosk: 3, planter: 3, bench: 4, alcove: 3,
  stair: 3, bay: 3, gantry: 2, service: 1,
  niche: 2, ducts: 1, portal: 1, overlook: 4, stairhead: 2, shrine: 2,
};

const _ways = new Map();

/**
 * The walkways of a deck, as pseudo-places. Cached, because the derivation is
 * pure and `reseat` runs twice a second.
 *
 * Ids run from 9000 up and are NOT gazetteer ids: nothing else may address one
 * (§3.2's rule is that a place not in the table is not built, and these are not
 * places — they are where the people between places are).
 */
export function wayPlacesOn(deck) {
  const hit = _ways.get(deck);
  if (hit) return hit;
  const out = [];
  let id = 9000 + deck * 10;
  const put = (r, deg, w, d, heads, peak, what) => {
    const a = deg * Math.PI / 180;
    out.push({
      id: id++, deck, band: 'ring', way: what,
      x: r * Math.sin(a), z: r * Math.cos(a), yaw: a, w, d,
      heads, peak,
    });
  };
  /* THE CROSSINGS, which is where a person waits for somebody. */
  for (const j of junctionsOn(deck)) put(DRUM.ringR, j.at, 11, 7, 6, 14, 'junction');
  /* EVERY FIXTURE — at the counter, on the bench, at the rail. */
  for (const w of waysOn(deck)) {
    /**
     * ── AND THE RIM'S PEOPLE STAND ON THE RIM, NOT BEHIND IT ────────────
     *
     * This read `DRUM.balcony + 2`, which is 2 m OUTBOARD of the lip — and
     * `rIn` of every `inner` place is `DRUM.balcony` exactly, so the people
     * at every overlook, shrine and stairhead on the drum were standing two
     * metres inside the wall of whatever room was at that bearing. The
     * fixture itself is built at `DRUM.balcony` (`StationKit`:3125, the rail
     * line); the people belong on the VOID side of it, which is where you
     * stand to look over a rail.
     */
    const r = w.band === 'spine' ? w.r : w.band === 'rim' ? DRUM.balcony - 1.5 : DRUM.ringR;
    if (w.band === 'spine' && deck === 40 && w.at === 0) continue;
    put(r, w.at, 6, 5, WAY_HEADS[w.kind] ?? 2, w.band === 'rim' ? 18 : 13, w.kind);
  }
  /* AND THE OPEN WALK ITSELF, between them: twelve stretches of ring and the
   * length of every spine, so the deck has people in transit and not only
   * people stopped. See `RING_WALKS` for the three numbers. */
  for (let i = 0; i < RING_WALKS; i++) {
    put(DRUM.ringR, 15 + i * (360 / RING_WALKS), RING_WALK_W, 6, WALK_HEADS, 14, 'walk');
  }
  for (const deg of DRUM.spines) {
    /* Deck 40's fourth spine IS #9 The Concourse — a hall with its own census,
     * not a corridor with people passing through it. It is still ROUTED
     * through (see `spinesOn`); what it does not get is a stretch of its own. */
    if (deck === 40 && deg === 0) continue;
    put((DRUM.balcony + DRUM.roomR) / 2, deg, SPINE_WALK_W, SPINE_WALK_D, WALK_HEADS, 14, 'walk');
  }
  _ways.set(deck, out);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHERE A WALKER IS GOING                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE DRUM HAS THREE CORRIDORS AND THAT IS THE WHOLE NAVIGATION ═════════
 *
 * §2.5: *"places whose organization and arragement make sense in relation to
 * each other"*, and the design note under it — *"People are going somewhere …
 * along desire lines between them."*
 *
 * There is no nav mesh here and there does not need to be one. §3.1 builds the
 * drum out of exactly three walkable surfaces, and every one of them is a
 * shape you can stay inside by arithmetic:
 *
 *   THE RING     a clear annulus at `ringR`, the full turn, every deck.
 *   THE BALCONY  a clear annulus inside the lip at `balcony`, round the void.
 *   THE SPINES   four radial corridors joining the two, at 0/90/180/270.
 *
 * So a route is a POLYLINE IN POLAR, and every leg is one of two kinds: an ARC
 * at a fixed radius (only ever `RING_WALK` or `BALC_WALK`, both clear all the
 * way round) or a RADIAL at a fixed bearing (only ever a spine's, or the last
 * two metres from a corridor to a door, which stays inside the corridor's own
 * band). Nothing else is ever emitted, so "the walker did not go through a
 * wall" is a property of the ROUTE rather than something to check for at
 * runtime and correct.
 *
 * ── AND THE TRAP THIS FILE ALREADY FELL INTO ONCE ────────────────────────
 *
 * The previous walker advanced a BEARING at a fixed radius and its own comment
 * said "no pathfinding". On the ring that is safe; on a spine it is a body
 * walking a circle through the room footprints the spine runs between — 53 of
 * 240 samples inside #13 The Databank. The guard written to catch it asserted
 * `|hypot − wayR| ≤ 0.05`, which is precisely the defect: staying exactly on
 * that circle is what carried them through the rooms.
 *
 * The lesson is in the leg kinds above and not in a bigger tolerance: A RADIAL
 * MOVE MAY ONLY HAPPEN ON A BEARING THAT IS A CORRIDOR, and `planRoute` is the
 * only thing that emits one.
 */

/** The two annuli a walk turns on. The balcony walk is INSIDE the lip, which
 *  is the side of it you can stand on — `rIn` of every `inner` place is the
 *  lip itself. */
const RING_WALK = DRUM.ringR;
const BALC_WALK = DRUM.balcony - 2;

/**
 * How far off a door a walker stops. Outward on the ring, inward on the
 * balcony — either way OUTSIDE the room's own footprint, which is what makes
 * an arrival an arrival and not the trespass `station.mjs` is watching for:
 * `layout()` puts an outer door at `roomR − 0.4`, four tenths INSIDE the room
 * it belongs to.
 */
const DOOR_STAND = 1.4;

/** Where a walker stands when it has arrived at a place on each corridor. */
const STAND_R = {
  ring: DRUM.roomR + DOOR_STAND,
  balcony: DRUM.balcony - DOOR_STAND,
};

/** Signed shortest way round, in radians. */
function wrapPi(a) { return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; }

/** The four spines of a deck, in radians. */
const _spines = new Map();
function spinesOn(deck) {
  let hit = _spines.get(deck);
  if (!hit) {
    hit = DRUM.spines.map((d) => d * Math.PI / 180);
    _spines.set(deck, hit);
  }
  return hit;
}

/**
 * Is this bearing ON a spine — near enough that a radial walk along it stays
 * inside the corridor for its whole length?
 *
 * The bound is METRES AT THE WIDE END. A radial line at a bearing `d` off a
 * spine is `d × r` from its centre, which grows with r, so the worst case is
 * at the ring mouth: `d × RING_WALK ≤ spineW/2 − 0.5`. That is what sizes
 * `SPINE_WALK_W` from the other side.
 */
function spineAt(deck, a) {
  const lim = (DRUM.spineW / 2 - 0.5) / RING_WALK;
  for (const s of spinesOn(deck)) if (Math.abs(wrapPi(a - s)) <= lim) return s;
  return null;
}

/** Which spine makes the shortest crossing between two bearings. */
function bestSpine(deck, a0, a1) {
  let best = null, cost = Infinity;
  for (const s of spinesOn(deck)) {
    const c = Math.abs(wrapPi(s - a0)) + Math.abs(wrapPi(a1 - s));
    if (c < cost) { cost = c; best = s; }
  }
  return best ?? 0;
}

/* A leg is `{ arc, r|a, from, to, len }` and nothing else. Pushed only when it
 * is worth walking: a zero-length leg would divide by its own length. */
function arcLeg(legs, r, a0, a1) {
  const d = wrapPi(a1 - a0);
  if (Math.abs(d) * r < 0.05) return a0;
  legs.push({ arc: true, r, from: a0, to: a0 + d, len: Math.abs(d) * r });
  return a0 + d;
}
function radLeg(legs, a, r0, r1) {
  if (Math.abs(r1 - r0) < 0.05) return r0;
  legs.push({ arc: false, a, from: r0, to: r1, len: Math.abs(r1 - r0) });
  return r1;
}

/**
 * THE ROUTE FROM WHERE SOMEBODY IS STANDING TO THE DOOR THEY ARE GOING TO.
 *
 * Five legs at the very worst — out to the corridor, round to a spine, along
 * the spine, round to the bearing, in to the door — and two in the common
 * case of two rooms on the same ring.
 */
function planRoute(deck, r0, a0, dest, legs) {
  legs.length = 0;
  const destLvl = STAND_R[dest.on] === STAND_R.ring ? RING_WALK : BALC_WALK;
  /* STANDING ON A SPINE IS ITSELF A CROSSING. A walker seated on a spine
   * stretch is mid-band, so "which annulus is it on" has no answer — but its
   * bearing IS a corridor, so it can simply walk to whichever annulus its
   * destination is on. Without this a spine walker bound for the ring walked
   * INWARD to the balcony first and then back out along the same spine. */
  const mine = spineAt(deck, a0);
  const lvl0 = mine !== null ? destLvl
    : (r0 > (BALC_WALK + RING_WALK) / 2 ? RING_WALK : BALC_WALK);
  let a = a0;
  radLeg(legs, a0, r0, lvl0);
  if (lvl0 !== destLvl) {
    const sp = bestSpine(deck, a0, dest.a);
    a = arcLeg(legs, lvl0, a, sp);
    radLeg(legs, sp, lvl0, destLvl);
    a = arcLeg(legs, destLvl, a, dest.a);
  } else {
    a = arcLeg(legs, destLvl, a, dest.a);
  }
  radLeg(legs, dest.a, destLvl, dest.r);
  return legs;
}

/**
 * ══ WHERE THERE IS A REASON TO GO ═════════════════════════════════════════
 *
 * A destination is a PLACE with a door on one of the two corridors — which is
 * to say every room in the gazetteer that a person walks into. The bands that
 * are not here are the ones you do not walk to across a deck: the tram
 * platforms and the docking throat are through the skin, the atrium bridge is
 * over the void, the Concourse's own alcoves open off a hall rather than off
 * the ring, and the hangar's two decks are in another frame entirely.
 */
const _dests = new Map();
function destsOn(deck) {
  const hit = _dests.get(deck);
  if (hit) return hit;
  const out = [];
  for (const p of placesOn(deck)) {
    if (!p.heads || !p.door) continue;
    if (p.band !== 'outer' && p.band !== 'inner' && p.band !== 'radial') continue;
    const dr = Math.hypot(p.door[0], p.door[1]);
    const on = dr > DRUM.roomR - 2 ? 'ring' : dr < DRUM.balcony + 2 ? 'balcony' : null;
    if (!on) continue;
    out.push({
      p, id: p.id, on,
      a: Math.atan2(p.door[0], p.door[1]),
      r: STAND_R[on],
      w: 0,
    });
  }
  _dests.set(deck, out);
  return out;
}

/**
 * HOW FAR A WALK MAY BE. The ring is 537 m round and a walk is 1.35 m/s, so a
 * destination on the far side is six and a half minutes away — which is a
 * walker who never arrives anywhere the player can see it arrive. Between
 * fifteen and a hundred and thirty metres is thirty seconds to a minute and a
 * half, which is a crossing rather than an errand or a hike.
 */
const TRIP = { near: 15, far: 130 };

/**
 * WHICH PLACE, AND THE WEIGHT IS THE DESIRE LINE.
 *
 * `headcount` at this hour is already the gazetteer's answer to how busy a
 * room is, curve, shift change, meals and all — so weighting by it means the
 * concourse pulls at 06/14/22, the food court pulls at 07/13/19 and the
 * cantina pulls at 21, with no second table to keep true. That is the whole of
 * "desire lines between rooms that have a reason to be connected": people walk
 * towards where people are, at the hour they are there.
 *
 * SEEDED ON THE SLOT AND THE TRIP NUMBER. No `Math.random` — the same walker
 * makes the same journeys in the same order on every run of the same day.
 */
function pickDest(deck, hour, body) {
  const list = destsOn(deck);
  if (!list.length) return null;
  const r0 = body.wayR, a0 = body.wayAngle;
  let total = 0;
  for (const d of list) {
    const far = Math.abs(wrapPi(d.a - a0)) * RING_WALK + Math.abs(d.r - r0);
    d.w = (far >= TRIP.near && far <= TRIP.far && d.id !== body.wayTo)
      ? headcount(d.p, hour) + 1 : 0;
    total += d.w;
  }
  /* NOTHING IN RANGE — take the nearest thing that is not where we are. A
   * walker with no destination is the defect this whole section is about, so
   * the fallback is another destination and never `null`. */
  if (total <= 0) {
    let best = null, cost = Infinity;
    for (const d of list) {
      if (d.id === body.wayTo) continue;
      const far = Math.abs(wrapPi(d.a - a0)) * RING_WALK + Math.abs(d.r - r0);
      if (far > 1 && far < cost) { cost = far; best = d; }
    }
    return best;
  }
  let pick = h2(body.waySeedA, body.waySeedB + body.wayTrips) * total;
  for (const d of list) { pick -= d.w; if (pick <= 0) return d; }
  return list[list.length - 1];
}

/** How long somebody stands at the door they arrived at before setting off
 *  again. Long enough to read as an arrival, short enough that the corridor
 *  does not drain into the doorways over a minute. */
const DWELL = { min: 3, span: 9 };

/** Give a walker somewhere to be going, and the polyline to get there. */
function setOut(deck, hour, body) {
  const dest = pickDest(deck, hour, body);
  if (!dest) { body.wayDwell = DWELL.min; return false; }
  body.wayLegs = planRoute(deck, body.wayR, body.wayAngle, dest, []);
  body.wayTo = dest.id;
  body.wayAt = 0;
  body.wayT = 0;
  if (!body.wayLegs.length) { body.wayDwell = DWELL.min; return false; }
  return true;
}

/**
 * Who stands in slot `i` of a place at all — species, name, job and rhythm.
 *
 * The seed is the PLACE and the SLOT, never the clock, so the person at a
 * table is the same person when you look away and back, and the same person
 * on a return visit later in the same day (§14's persistence line).
 *
 * ── `opts` IS THE EVENING, AND IT IS OPTIONAL ─────────────────────────────
 *
 * V16 §C2 puts troops on leave in the three bars, and unlike everything else
 * in this function that is a fact about the HOUR rather than about the room:
 * the same seat at #14 holds a soldier at 22:00 and a merchant at 06:00. So
 * `{ hour, day, heads, company }` is handed in by `spawnResident`, which has
 * all four, and every existing caller that does not pass it — `Pits.js` and
 * `pits.mjs` — gets exactly the census it got before.
 */
export function occupant(place, i, opts = {}) {
  /**
   * ══ THE FACE CHANGES BETWEEN DAYS AND NOT BETWEEN GLANCES ══════════════
   *
   * *"the same shop owner doesnt always look the same like between runs …
   *  otherwise it would get stale seeing the same people always doing the
   *  same things."*
   *
   * The seed was `p{place}s{slot}` and nothing else, so a hostile pass read
   * the Concourse's slot 0 on day 0, day 1, day 5 and day 40 and got Vesbar
   * Kolbar the brakiri financier every single time. The shelves rerolled on
   * `(counter, day)`, the job board rerolled, the leave roll rerolled — and
   * the faces did not, because the day never reached this line. A station
   * where every shelf changes and no person does is worse than one where
   * neither does: it says the day is passing and shows you it is not.
   *
   * SO THE DAY IS IN THE SEED, AND ONLY HERE. Stable for a whole day —
   * `spawnResident`'s own note is that a slot index is what makes a resident
   * survive a despawn, and a face that changed while you crossed the room
   * would be a worse failure than a face that never changes at all. Different
   * tomorrow. Same shape as `Counter.shelfFor`, for the same reason.
   *
   * AND THE NAMED CAST IS EXEMPT, which is the branch below this one: the
   * Forge's Wookiee smith is a person, not a slot, and a person who is
   * somebody else on Tuesday is not a person. `BORZ_BY_PLACE` returns before
   * the day is ever consulted.
   */
  const day = Number.isFinite(opts.day) ? (opts.day | 0) : 0;
  const seed = `p${place.id}s${i}`;
  const daily = `${seed}d${day}`;
  /**
   * A place's own bias, and there are three kinds.
   *
   * THE QUARTERS are one species each — §3.3's "quarters by people".
   *
   * THE CONCOURSE IS THE WHOLE CAST, and that is not a nicety: §3.3 ends
   * *"the concourse is where the game's whole cast is seen at once, and that
   * is the point of the station."* Drawn from the census shares alone it
   * would be four humans in five and a Grome once an hour — which is a true
   * census and a bad room. So the first fifteen stalls are one of each, in
   * order, and the census takes over after that.
   *
   * THE HOSTEL is the tail (§3.2 #38): the species with no quarter of their
   * own live there, so it cycles them rather than drawing.
   */
  /**
   * ══ THE BORZ CAST GETS THE FIRST SLOTS (V15 §1.4) ═══════════════════════
   *
   * *"all the cute droids and stuff we have in our hangar mixed in with the
   * species."* A Borz row names a home and a haunt, and those are the two
   * places it is found in — so it takes a slot there rather than competing
   * with a census that would round a single Wookiee smith out of existence.
   *
   * FIRST, not scattered, because a slot index is what makes a resident
   * stable across a despawn: the Forge's smith has to be the same Wookiee
   * every time you look at the Forge.
   */
  const borz = BORZ_BY_PLACE.get(place.id);
  if (borz && i < borz.length) {
    const R = borz[i];
    return {
      seed, borz: R, archetype: borzArchetype(R),
      species: R.species || 'borz',
      name: nameFor(R.species || 'human', seed),
      role: R.job || 'visitor',
      stature: 1.75, scale: 1,
      rhythm: RHYTHMS.human,
      faction: 'merchants',
      home: R.home,
    };
  }
  /**
   * ══ AND THEN THE LEAVE SEATS (V16 §C2) ═════════════════════════════════
   *
   * AFTER the Borz cast and BEFORE the census, and the order is the whole
   * decision. The Drazi barkeep at #14 is a named body who works there and
   * has to still be there on the evening the soldiers arrive; the census is
   * everybody else and is exactly who a soldier displaces. `Bars.barman`
   * answers null for every place that is not one of the three and for every
   * slot past the ones liberty actually filled, so this costs one Map lookup
   * on all fifty-odd other rooms.
   */
  const off = barman(place, i, opts);
  if (off) return { ...off, seed };
  /**
   * ══ AND THE PEOPLE WHO DO NOT REROLL, WHICH IS THE WHOLE OF LANE C3 ═════
   *
   * *"when you complete a certain quest it is recorded and you go back to that
   * npc who will be there since you compelted the quest."*
   *
   * Everyone below this line is drawn on `daily` and is therefore somebody
   * else tomorrow. A person who is holding a job of yours, or who owes you
   * money for one you finished, is the exception — and it is the only one in
   * the file, because it is the only one the player asked for. `Quests.js`'s
   * own comment has said "`StationLife`'s census asks this before it rerolls a
   * body" since it was written, and until this branch nothing did: the giver
   * you took a 300-credit job from was a different species by the next
   * morning, and the money was owed to a room rather than to a man.
   *
   * AFTER the Borz cast and the leave seats, and OFFSET BY THE BORZ SLOTS,
   * because those two own the low slots at the places they claim: a giver
   * seated at `i = 0` in the Forge would be standing where the Wookiee smith
   * stands and would simply never be drawn. What is displaced instead is an
   * anonymous stranger, which is exactly what a pinned giver is — one of the
   * census, standing still.
   *
   * A SEED AND NOT A BODY. `resident(seed)` is the same function `Notices.js`
   * calls to print who is offering what on the wall, so the name on the notice
   * and the person in the room cannot disagree.
   */
  const owed = pinnedAt(place.id);
  if (owed.length) {
    const k = i - (borz ? borz.length : 0);
    /* The resident and nothing added to it: a `pinned: true` flag here would be
     * a field with no reader, and what a caller actually needs to recognise
     * this person by is the seed, which is on the record already and is the
     * same number `Quests` and `Notices` name them by. */
    if (k >= 0 && k < owed.length) return resident(owed[k]);
  }
  /* EVERYTHING BELOW IS THE CENSUS — anonymous people filling a room — and
   * every one of them is drawn on `daily`. The species bias of a quarter is
   * the room's and does not move; who is standing in it does.
   *
   * `j` IS THE CENSUS ORDINAL AND NOT THE SLOT. The named cast owns the low
   * slots of the rooms it lives in, and the blocks below used to count from
   * the raw slot index — so the hostel, which seats five at midday and has
   * three Borz in it, handed HOSTEL[0..2] to three people who are not census
   * at all and started its cycle at `hyach`. Brakiri, Vree and Abbai were
   * never in their own hostel, and Grome and "other" were never anywhere. */
  const j = i - (borz ? borz.length : 0);
  const bias = planBias(place, j);
  if (bias) return resident(daily, { species: bias });
  /**
   * ══ AND THEN THE FLOOR (§5.3) ══════════════════════════════════════════
   *
   * The blocks above are the PLAN's guarantee and it is a fixed one: five of
   * each rare kind in the market, two in the food court, the hostel's cycle.
   * Everything else is a free draw from the shares, and a share of 750 in
   * 250 000 draws nobody most days — so Grome and "other" stood at seven on
   * 222 days of a year against §5.3's eight, and the Minbari, whose quarter
   * seats three at midday, fell to six.
   *
   * `floorFill` is the top-up: it takes the day's OWN draw, sees who it
   * shorted, and re-rolls that many otherwise-free slots into them. It cannot
   * make the census uniform because it only ever moves a species that is
   * already over the floor into one that is under it — a kind the day drew
   * twelve of stays at twelve.
   */
  const top = floorFill(day).get(`${place.id}:${i}`);
  if (top) return resident(daily, { species: top });
  return resident(daily);
}

/** §3.2 #38: the species with no quarter of their own live at the hostel. */
const HOSTEL = ['brakiri', 'vree', 'abbai', 'hyach', 'llort', 'grome', 'other'];
/** The eight the census would round out of a room. See the Concourse above. */
const RARE = ['brakiri', 'pakmara', 'vree', 'abbai', 'gaim', 'hyach', 'llort', 'grome', 'other'];

/** §3.3: quarters by people. A row here is a place that is one species'. */
const QUARTER_OF = {
  31: 'human', 32: 'narn', 33: 'centauri', 34: 'minbari', 35: 'drazi',
  37: 'vorlon',
};
/* The methane quarter is two species behind one airlock, so it alternates. */
const METHANE = ['gaim', 'pakmara'];

/**
 * Which species the PLAN pins a census slot to, or null for a free draw.
 *
 * ── AND #36 IS IN HERE BECAUSE IT WAS ONLY EVER IN THE TALLY ──────────────
 *
 * `census()` carried its own `p.id === 36 ? METHANE[i % 2] : occupant(...)`
 * line and `occupant` knew nothing about it, so the methane quarter READ as
 * five Gaim and five pak'ma'ra and SPAWNED ten residents drawn from the
 * shares — which is to say eight humans behind an airlock nobody else can
 * breathe. An instrument that answers a question the world does not is worse
 * than no instrument: §5.3's eight-of-every-species was green on a number the
 * game never produced. One table, read by both.
 *
 * `j` is the census ordinal — see `occupant`.
 */
function planBias(place, j) {
  if (j < 0) return null;
  const q = QUARTER_OF[place.id];
  if (q) return q;
  /* §3.2 #36: two species behind one airlock, alternating. */
  if (place.id === 36) return METHANE[j % METHANE.length];
  /* The RARE nine, five each, in the first forty-five stalls. Cycling all
   * fifteen here would make the market one human in fifteen, which is a worse
   * lie than the census's — 155 000 of 250 000 aboard are human. What the
   * market has to guarantee is that the whole cast is IN it, and the nine that
   * the census would otherwise round out of the room are the nine that need
   * guaranteeing. Because they lead the cycle, they are also the nine that
   * survive the market's quietest hour, when it seats fourteen. */
  if (place.id === 9 && j < RARE.length * 5) return RARE[j % RARE.length];
  if (place.id === 38) return HOSTEL[j % HOSTEL.length];
  /* The food court is the other place the tail is always in: a cheap counter
   * under a low ceiling at shift change is where transients and dock gangs
   * eat, and the census would otherwise leave the seven quarterless species
   * with one room between them. */
  if (place.id === 17 && j < HOSTEL.length * 2) return HOSTEL[j % HOSTEL.length];
  return null;
}

/**
 * ══ THE FLOOR — EIGHT OF EVERY SPECIES, ON EVERY DAY (§5.3) ═══════════════
 *
 * "≥ 8 residents placed per species." The Vorlon is the one exception and it
 * is the roster's, not this file's: `SPECIES.vorlon` carries `singleton`, and
 * §3.3 is explicit — *"one encounter suit, one place (#37), never walks."*
 * There is one, and one is his floor.
 */
export const FLOOR = 8;

/**
 * The hour the census is taken at. §3.4's midday meal, and the hour
 * `station.mjs` has always counted at. It has to be ONE hour and it has to be
 * fixed, because `occupant` may not read the clock: a face that changed
 * between 12:00 and 14:00 would be a worse failure than a thin census — see
 * the note at the top of `occupant`. So the top-up is sized against midday
 * and simply rides along at every other hour.
 */
const CENSUS_HOUR = 13;

/** day → (`placeId:slot` → species). Small, because only today is ever asked. */
const _floor = new Map();

/**
 * Who the day's own draw shorted, and which free slots pay for it.
 *
 * Deterministic in `day` alone: the natural species of every census slot is
 * `speciesFor` on the same `(place, slot, day)` seed `occupant` uses, the
 * order the slots are offered in is a hash of `(place, slot, day)`, and no
 * clock, quest or player state reaches any of it. `determinism.mjs` holds the
 * no-`Math.random` half of that.
 *
 * A DONOR IS NEVER TAKEN BELOW THE FLOOR. The loop refuses a slot whose own
 * species is at eight or fewer, so topping up the Grome cannot be what pushes
 * the Llort under — which is exactly the shape a naive top-up has.
 */
function floorFill(day) {
  const hit = _floor.get(day);
  if (hit) return hit;
  const have = new Map(SPECIES_KEYS.map((k) => [k, 0]));
  const free = [];
  for (const p of PLACES) {
    if (p.external || !p.heads) continue;
    const n = headcount(p, CENSUS_HOUR);
    const borz = BORZ_BY_PLACE.get(p.id);
    const b = borz ? borz.length : 0;
    /* A place id can be fractional (#40.2), so it is scaled to an integer
     * before it goes anywhere near `h2`'s integer arithmetic. */
    const pid = Math.round(p.id * 10);
    for (let i = b; i < n; i++) {
      const bias = planBias(p, i - b);
      if (bias) { have.set(bias, (have.get(bias) || 0) + 1); continue; }
      const k = speciesFor(`p${p.id}s${i}d${day}`);
      have.set(k, (have.get(k) || 0) + 1);
      free.push({ key: `${p.id}:${i}`, k, r: h2(pid * 1024 + i, day) });
    }
  }
  /* One deterministic order for the whole day, so which rooms pay is a
   * different set tomorrow and the top-up does not wear a groove in one room. */
  free.sort((a, b2) => (a.r - b2.r) || (a.key < b2.key ? -1 : 1));
  const out = new Map();
  let at = 0;
  for (const k of SPECIES_KEYS) {
    if (SPECIES_BY.get(k)?.singleton) continue;
    while ((have.get(k) || 0) < FLOOR) {
      let took = false;
      for (let m = 0; m < free.length; m++) {
        const s = free[(at + m) % free.length];
        if (s.k === k || out.has(s.key)) continue;
        if ((have.get(s.k) || 0) <= FLOOR) continue;
        out.set(s.key, k);
        have.set(s.k, have.get(s.k) - 1);
        have.set(k, (have.get(k) || 0) + 1);
        at = (at + m + 1) % free.length;
        took = true;
        break;
      }
      /* Nothing left that can spare a body. The station is too small for the
       * floor and that is a fact about the gazetteer, not something to paper
       * over here — `station.mjs` sweeps the year and says so. */
      if (!took) break;
    }
  }
  _floor.set(day, out);
  if (_floor.size > 8) _floor.delete(_floor.keys().next().value);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE POOL                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Start the life. Called by `dressStation` once the rooms are standing.
 */
export function dressStationLife(world, st) {
  const quality = world.settings?.quality || 'high';
  const life = {
    /** slot key → the live Enemy standing in it. */
    live: new Map(),
    budget: POOL[quality] ?? POOL.high,
    /** Which deck this is, so `stepWalkers` can ask for its corridors and its
     *  destinations without going back through `st` every frame. */
    deck: st.deck,
    /** The walkways of this deck, as pseudo-places the pool can seat into.
     * See `wayPlacesOn`: before this the corridors held nobody at all. */
    ways: wayPlacesOn(st.deck),
    /**
     * ══ WHICH ROOMS ON THIS DECK HOLD SOMEBODY WITH AN ANIMAL ═════════════
     *
     * `handlersOn().where` — the place id a handler is standing in — is a
     * field the pit's roster has always carried and nothing has ever read. It
     * gets its reader here, and the reader is the reason the field is worth
     * having: the pool seats nearest-first up to a budget, so on a deck with
     * three hundred census slots and eleven handlers the one room with an
     * animal in it is usually just outside the radius. Promoted, it is not.
     *
     * A SET OF PLACE IDS AND NOT A SET OF PEOPLE, because that is exactly what
     * `where` answers. `spawnResident` still asks `handlerOf` about the
     * resident it actually drew — this only decides what order the pool is
     * spent in, so a promotion that is wrong costs an ordering and never a
     * body that is not there.
     *
     * REBUILT ON THE HOUR AND NOT PER FRAME. `handlersOn` walks the whole
     * gazetteer through `occupant`, which is milliseconds; the hour turns once
     * every two real minutes. See `reseat`.
     */
    handlerRooms: new Set(), rosterHour: null,
    /**
     * ══ AND THE ANIMALS ARE FIELDED A FRAME AT A TIME ═════════════════════
     *
     * Two reasons, and the first is not a preference.
     *
     * `Companions.js` REACHES THIS FILE BACK ROUND A CYCLE. It imports
     * `Command.js` and `Player.js`, which reach `Levels.js`, which builds the
     * station level — and a static import here put `StationLife` on that
     * circle. Measured: `ReferenceError: Cannot access 'STATION_LEVEL' before
     * initialization` at `Levels.js:5053`, on any process that entered the
     * graph through this file. A dynamic import is not a workaround for that;
     * it is the correct shape, because what this file needs from the companion
     * machinery is a RUNTIME call and not a link-time symbol.
     *
     * AND A COMPANION IS A BODY. `fieldCompanion` builds a rig, a mesh chain
     * and a physics capsule exactly as `spawnResident` does, and `reseat`
     * already caps itself at one of those a frame for the reason written on
     * the cap. Draining one animal a frame puts the two under the same rule.
     */
    cmp: null, wantPets: [],
    reseatIn: 0,
    /** True until the first re-seat has run — see `dressStationLife`. */
    priming: true,
    /** The tram: four stops, ninety seconds apart (§3.2 #40). */
    tram: { t: 0, at: 0, car: null },
    /**
     * THE PLAYER'S OWN ROLL, read ONCE (V16 §C2). `StationBoards.companyOf`
     * is the one authority on which of the armies' manifests is "the"
     * company from the station's point of view — the departures board and
     * the cantina must not disagree about who is aboard. Null is a legal
     * answer and means the bars fill with the station's own garrison
     * instead; see `Bars.js`'s header.
     */
    company: (() => { try { return companyOf(); } catch { return null; } })(),
    /** The event table's cursor and what is running (§3.4). */
    event: null, eventIn: 20,
    /** §11's consequence: your standing, and the guards who come. */
    standing: world.run?.stationStanding ?? 0,
    alarm: 0, guards: [],
    /** For the ledger line: how much of a frame this file took. */
    /**
     * TWO NUMBERS AND NOT ONE, because they have two budgets.
     *
     * `stepMs` is the STEADY step — the re-seat's arithmetic, the witness, the
     * tram and the event clock — and §12.2 bounds it at 2.5 ms, the same bound
     * `decklife.mjs` holds the deck to. `spawnMs` is what BUILDING a body
     * costs, which is a rig, sixty meshes and a `MergedSkin` chain, and folding
     * it into the first number would make a bound that is either unmeetable or
     * meaningless depending on whether a body happened to appear that frame.
     *
     * The spawn budget is the CAP instead: one body per re-seat during play,
     * two a second, so whatever a body costs on a given machine, the station
     * spends at most that twice a second.
     */
    stepMs: 0, spawnMs: 0,
    spawned: 0, despawned: 0,
  };
  world._stationLife = life;
  /* The companion machinery, fetched off the import cycle. Resolved long
   * before the first handler is drawn — the prime takes seven frames. */
  import('./Companions.js').then((m) => { life.cmp = m; }).catch(() => {});
  /**
   * ══ FRIENDLY FIRE IS ON, AND IT IS THE WHOLE SANDBOX ═══════════════════
   *
   * §11 puts every resident on `team = player.team` so nothing hunts them and
   * no director ever composes one. `canHarm` then refuses the player's own
   * blade against them — same side, friendly fire off — and the station's
   * central promise ("it ragdolls, loses limbs, is gripped and thrown") would
   * be quietly false, with no error anywhere to say so.
   *
   * So the station's rules turn it on. There is no army here and no ally to
   * shoot by accident: the only thing the flag reaches is you and the people
   * you are choosing to throw, which is exactly what it is for. The
   * consequence is `Security` (below) and not a refusal.
   */
  world.rules = { pvp: false, friendlyFire: true };
  /**
   * ══ THE FIRST POPULATION IS SEATED IN SLICES, OFF THE SEAM ═════════════
   *
   * Measured: an unbounded re-seat during play spends 100 ms on the frame the
   * player walks into a full hall, because a spawn BUILDS a body — a rig,
   * sixty meshes and a `MergedSkin` chain — and several land together. Every
   * re-seat after this one is capped at two, which at half-second intervals is
   * four bodies a second appearing just ahead of a walk.
   *
   * THIS ONE USED TO BE UNCAPPED AND HAPPEN HERE, on the grounds that
   * `dressStation` runs inside `World._loadSteps` and "the player is looking
   * at the loading plate". That sentence stopped being true when V15 §1.5
   * took the plate away: between the flight deck and the station there is no
   * plate, there is a still of the lift car the player is standing in, and
   * every millisecond spent here is a millisecond of photograph. Metered with
   * the deck already built, the station's whole build is about 2.1 s of CPU
   * and this call was 1.14 s of it — twenty-eight bodies, over half the seam.
   *
   * So the pool is filled by `primeStationLife`, a few bodies a frame, on the
   * frames after the world is live. `life.priming` stays TRUE for the whole of
   * it, so it is the same seating with the same budget — not the walk's
   * trickle — and it has 1.1 s of door animation (`RIDE.doors`, about 66
   * frames) to finish in, which it does with room to spare. §13.2's contact
   * sheet still gets a market rather than a market filling up: a screenshot
   * either steps the world or calls `Station.finishStationBuild`, which drains
   * the slices in one go.
   */
  return life;
}

/**
 * HOW MANY BODIES ONE SLICE OF THE PRIME MAY BUILD.
 *
 * A body costs about 40 ms of CPU the first time its archetype is built and
 * about 23 ms after, so four is a frame of roughly a sixth of a second at
 * worst — a stutter under a closing pair of lift doors, not a freeze, and
 * seven slices is the whole pool. One a frame would be smoother and would
 * take twenty-eight frames of the sixty-six available, which is a thinner
 * margin than this is worth.
 */
export const PRIME_SLICE = 4;

/**
 * Seat one slice of the first population. Returns true while there is more.
 *
 * Queued by `dressStation` and drained by `drainStationBuild`; see the note
 * above for why the prime is not done inside the dress any more. It is safe
 * to call directly and safe to call after the pool is full — the second is
 * how it says it is finished.
 */
export function primeStationLife(world) {
  const life = world?._stationLife;
  const here = world?._station;
  if (!life || !here || !life.priming) return false;
  const before = life.live.size;
  const p = world.player?.position;
  reseat(world, here, life, p ? p.x : 0, p ? p.z : 24);
  /* A re-seat that added nobody has nobody left to add: every candidate
   * inside the radius is already standing, or the budget is spent. Either way
   * the prime is over and the pool goes on the walk's own trickle. */
  if (life.live.size <= before) { life.priming = false; return false; }
  return true;
}

/** Which archetype builds a given resident row — a species, or a Borz row. */
function archetypeOf(r) { return r.archetype || `res_${r.species}`; }

/**
 * ══ RE-SEAT THE POOL ══════════════════════════════════════════════════════
 *
 * Every place inside the cull radius offers its occupants; the nearest are
 * made real up to the budget and everything else stays baked. Nothing here
 * allocates per frame: the candidate list is reused, the vectors are scratch,
 * and the loop closes over nothing.
 */
function reseat(world, st, life, px, pz) {
  const hour = st.hour;
  /* THE HANDLER ROOMS OF THIS DECK, once an hour. See `handlerRooms`. */
  const stamp = `${Math.floor(hour)}:${st.day ?? 0}`;
  if (life.rosterHour !== stamp) {
    life.rosterHour = stamp;
    life.handlerRooms.clear();
    try {
      for (const h of handlersOn(hour, st.day ?? 0)) {
        if (PLACE.get(h.where)?.deck === st.deck) life.handlerRooms.add(h.where);
      }
    } catch {}
    life.rosterBuilt = true;
  }
  const want = _want;
  want.length = 0;
  const consider = (p) => {
    /**
     * ── AND A ROOM WITH A CARD ON IS FULLER THAN THE GAZETTEER SAYS ──────
     *
     * V16 §G4. `Station.stepCrowd` writes `life.crowd` — how many the tote
     * says are in one of the three venues at this hour — and this is the one
     * line that reads it.
     *
     * ADDED to the gazetteer's own curve rather than replacing it, and the
     * first cut had it the other way round. `Math.max` measured as a NO-OP at
     * two of the three venues: the Pit's row is `heads: 14` and its crowd is
     * twelve at the rail, so the larger of the two was the room's ordinary
     * headcount at every hour and the card changed nothing you could see. The
     * two counts are two different populations — the sabacc floor is there
     * whether or not there is a bout on, and the crowd came for the bout — so
     * they add.
     *
     * It cannot overrun the frame budget: `life.budget` caps what is actually
     * built and `want` is sorted nearest-first, so a packed Holo-theatre
     * spends the pool on the sixty people the player is standing among, which
     * is exactly where it should go.
     */
    const n = headcount(p, hour) + (life.crowd?.get(p.id) || 0);
    if (n <= 0) return;
    for (let i = 0; i < n; i++) {
      slotIn(p, i, _v);
      const dx = _v.x - px, dz = _v.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > DROP_RADIUS * DROP_RADIUS) continue;
      /* A ROOM WITH AN ANIMAL IN IT IS SEATED AS THOUGH IT WERE NEARER. The
       * sort below is nearest-first and the budget is spent down it, so this
       * is the whole of the promotion: `handlerRooms` moves a place up the
       * queue and `LIVE_RADIUS` below still decides whether anybody in it is
       * built at all. Sixteen metres, so it beats a room across a hall and
       * never a body the player is standing next to. */
      const near = life.handlerRooms.has(p.id) ? Math.max(0, Math.sqrt(d2) - 16) ** 2 : d2;
      want.push({ key: `${p.id}:${i}`, place: p, i, d2, near });
    }
  };
  for (const rec of st.places.values()) {
    if (!rec.group.visible) continue;
    consider(rec.place);
  }
  /* AND THE WALKWAYS. A pseudo-place has no group to cull by, so it is culled
   * by distance alone — which is what `DROP_RADIUS` above already does. */
  for (const p of life.ways) consider(p);
  want.sort(byNear);

  /* Spawn the nearest up to the budget. */
  const keep = _keep;
  keep.clear();
  let n = 0;
  /**
   * ══ AT MOST FOUR NEW BODIES A RE-SEAT ══════════════════════════════════
   *
   * Measured walking the ring: an unbounded re-seat spent **20.9 ms** on the
   * frame the player crossed into a full hall, because a spawn builds a body —
   * a rig, sixty meshes and a `MergedSkin` LOD chain — and thirty of them land
   * on one frame. §12.2 bounds this file at 2.5 ms and a hitch is worse than a
   * bound anyway: it is the one thing a player actually feels.
   *
   * So the budget fills over about a second and a half rather than instantly,
   * which at a walk is a room populating just ahead of you. The DROP radius is
   * wider than the LIVE one for the same reason — see the constants.
   */
  /* The prime fills the pool in slices of `PRIME_SLICE` over the frames after
   * the world comes up — see `primeStationLife` — and every re-seat after it
   * is a trickle of one. */
  const cap = life.priming ? PRIME_SLICE : 1;
  let made = 0;
  for (const w of want) {
    if (n >= life.budget) break;
    keep.add(w.key);
    n++;
    if (life.live.has(w.key)) continue;
    /**
     * Only inside the live radius does a body actually appear — the wider
     * DROP_RADIUS above is the hysteresis, not the spawn line.
     *
     * ── AND IT IS TESTED BEFORE THE CAP, WHICH IT WAS NOT ────────────────
     *
     * These two lines were the other way round, and the order decided how
     * many people the station held. `n` is what the budget is spent down, and
     * a slot outside the live radius is supposed to give its count back — but
     * with the cap tested first, every slot past the cap kept its `n++` and
     * its place in `keep` whether or not it was anywhere near the player. `n`
     * then reached `life.budget` on slots that could never have been built,
     * the loop broke, and the pool stopped filling.
     *
     * It was invisible while the FIRST re-seat was uncapped, because `made`
     * never reached `life.budget` and the radius test therefore always ran.
     * The trickle that runs during play was carrying it the whole time: with
     * `cap` of 1, every re-seat after the first put one body in the room and
     * then padded `n` to thirty with slots on the far side of the drum.
     * Measured on deck 40 the moment the prime was sliced — the pool settled
     * at 8 residents where an uncapped prime seats 25, and 40 frames of walk
     * added one.
     *
     * The radius has nothing to do with the cap: a slot too far to build is
     * not a slot the budget was going to be spent on, whether or not there is
     * any budget left. So it is asked first, and `n` means the same thing at
     * every cap.
     */
    if (w.d2 > LIVE_RADIUS * LIVE_RADIUS) { keep.delete(w.key); n--; continue; }
    if (made >= cap) continue;
    /* `process?.cpuUsage` still THROWS on an undeclared identifier — optional
     * chaining guards a null, not a missing binding — so a browser met
     * `ReferenceError: process is not defined` on the first re-seat and the
     * station never dressed at all. `typeof` is the only safe test, and it is
     * the one the step below already used. Every headless check stayed green
     * throughout, because node has a `process`. */
    const t = HAS_CPU ? process.cpuUsage() : null;
    const body = spawnResident(world, st, w.place, w.i);
    if (t) { const d = process.cpuUsage(t); life.spawnMs = (d.user + d.system) / 1000; }
    if (body) { life.live.set(w.key, body); life.spawned++; made++; }
  }
  /* And put back everything that fell out of it. */
  for (const [key, body] of life.live) {
    /**
     * A WALKER IS CULLED ON WHERE IT IS, NOT ON WHERE IT STARTED.
     *
     * Every other body in the pool stands in its slot for ever, so the slot's
     * distance IS the body's. A walker's is not: `keep` is built from
     * `slotIn`, which is the doorway it set off from, so a body that walked
     * a hundred and fifty metres down the ring stayed real on the strength of
     * a stretch the player happens to be standing on. Measured before this:
     * bodies live at 190 m.
     */
    if (body.wayR && !body.__stationTouched && body.alive !== false) {
      const dx = body.position.x - px, dz = body.position.z - pz;
      if (dx * dx + dz * dz > WALK_DROP * WALK_DROP) {
        removeBody(world, body);
        life.live.delete(key);
        life.despawned++;
        continue;
      }
    }
    if (keep.has(key)) continue;
    /* A body the player has HURT is never despawned — it is a corpse, a
     * ragdoll or a witness, and making one vanish because you walked away is
     * the sandbox quietly undoing what you just did. */
    if (body.__stationTouched || body.alive === false) continue;
    removeBody(world, body);
    life.live.delete(key);
    life.despawned++;
  }
}
const _want = [];
const _keep = new Set();
const byNear = (a, b) => a.near - b.near;

/** One resident, made real. */
function spawnResident(world, st, place, i) {
  /**
   * THE EVENING, handed to `occupant` (V16 §C2). Everything in it is already
   * on the world: the clock is `st.hour`, the room's own headcount is the
   * curve this file owns, and the company was read once at dress time rather
   * than twice a second — `Company.loadAll` is a `localStorage` read and the
   * pool re-seats every 0.5 s.
   *
   * `st.day` IS NOT SET BY ANYBODY YET, and the reason is worth writing down
   * rather than defaulting past. There IS a derivation — `main.js`'s private
   * `stationDay()`, which the shelves, the job board and the pit's card are
   * all seeded off — but it is private to that file and half of it is
   * `loadStation().seen.length`, which this one cannot see. Copying half of it
   * here would give the station two answers to what day it is, in the same
   * room, at the same moment: the counter's board would roll over and the
   * cantina's leave roll would not.
   *
   * So this reads `st.day` and takes 0 until somebody sets it, which means
   * every evening is the same third of the roll. The fix is one line — lift
   * `stationDay()` out of `main.js` and have `Station.js` put it on `st` — and
   * leave starts rotating with no other change anywhere. That is the whole
   * reason `day` is a parameter in `Bars.js` and not an assumption.
   */
  const life = world?._stationLife;
  let r = occupant(place, i, {
    hour: st.hour, day: st.day ?? 0,
    heads: headcount(place, st.hour),
    company: life?.company || null,
  });
  if (place.id === 36) r = resident(`p36s${i}`, { species: METHANE[i % 2] });
  const type = archetypeOf(r);
  slotIn(place, i, _v);
  _v.y = floorOf(place) + 0.1;
  let body = null;
  try {
    body = world.spawnEnemy(type, _v.clone(), {
      /* §11: `team = player.team`, so nothing in the game hunts a resident
       * and no director can ever be handed one as an objective. */
      team: world.player?.team ?? 0,
    });
  } catch { return null; }
  if (!body) return null;
  /**
   * ══ THE TEAM IS SET AFTER THE SPAWN, AND IT HAS TO BE ═════════════════
   *
   * `Enemy`'s constructor writes `this.team = 1` outright — the game has
   * never had a body on the player's side that was not a companion — so an
   * `opts.team` handed to `spawnEnemy` is accepted and then overwritten.
   * Measured: every resident came out on team 1, which is the hostile side,
   * so §11's "nothing hunts a resident" was false and a companion would have
   * gone for the market.
   *
   * Set here rather than patched into `Enemy` because that constructor line
   * is load-bearing for every other body in the game and this is one field on
   * one kind of body. `station.mjs` asserts it.
   */
  body.team = world.player?.team ?? 0;
  /**
   * PINNED TO THE MERGED RUNG. Four draws for a complete figure rather than
   * sixty — see the note on `stationResident` in `Enemy.update`. Measured in a
   * browser without it: 3 452 draw calls on deck 40 against §12.2's 400.
   */
  body.stationResident = true;
  /* What the nameplate says when you look at them (§14). */
  body.stationName = r.name;
  body.stationRole = r.role;
  body.stationSpecies = r.species;
  body.stationFaction = r.faction;
  body.stationPlace = place.id;
  /* WHICH SLOT, so a check can ask `occupant` the same question this line
   * asked and get the same person back. The place id alone cannot: a room
   * holds a dozen and only one of them has a dog. */
  body.stationSlot = i;
  /* A body on a walkway rather than in a room. `stepWalkers` below is the
   * route this was set for; `wayPlacesOn` says why the corridors have to be
   * tellable from the rooms in the first place. */
  if (place.way) {
    body.stationWay = place.way;
    body.rotation && (body.rotation.y = place.yaw);
    /**
     * ── AND THE OPEN STRETCHES ARE THE ONES THAT GO SOMEWHERE ───────────
     *
     * `walk` is the eight stretches of ring and the middle of every spine —
     * the pseudo-places `wayPlacesOn` calls "people in transit and not only
     * people stopped". Everything else on a walkway is somebody who has
     * STOPPED there on purpose: at a counter, on a bench, at the rail, waiting
     * at a crossing. Making those walk would delete the fixtures.
     *
     * The bearing is the ring's own angle and the radius never changes, so a
     * walker cannot leave the corridor by construction — no pathfinding, no
     * collision query, and nothing to get stuck on. The direction is seeded on
     * the slot so half the ring walks each way and it is the same half every
     * time you look.
     */
    if (place.way === 'walk') {
      /**
       * ── AND A WALKER IS GIVEN SOMEWHERE TO BE GOING ─────────────────────
       *
       * The route itself is `planRoute`'s and the destination is `pickDest`'s;
       * what is set here is the person. `wayPace` is a MULTIPLIER now rather
       * than a speed, because the speed is `WALK_PACE` and one number should
       * be in one place.
       *
       * THE FIRST TRIP IS PLANNED HERE and not on the first step, so a body
       * on an open stretch is never a body with nowhere to go — not even for
       * the one frame between the spawn and the step. `setOut` is a pass over
       * forty destinations and a five-leg polyline; the body it is hung on
       * cost a rig and sixty meshes to build.
       */
      body.wayAngle = Math.atan2(_v.x, _v.z);
      body.wayR = Math.hypot(_v.x, _v.z);
      body.wayPace = 0.86 + ((place.id * 7 + i * 13) % 29) / 100;
      body.waySeedA = Math.round(place.id * 10);
      body.waySeedB = i * 7 + 3;
      body.wayLegs = null;
      body.wayAt = 0;
      body.wayT = 0;
      body.wayTo = 0;
      body.wayTrips = 0;
      body.wayDwell = 0;
      setOut(st.deck, st.hour, body);
    }
  }
  /**
   * ══ AND SOME OF THEM HAVE AN ANIMAL WITH THEM (V16 §G1) ═════════════════
   *
   * *"see a couple other people with companions of there own … just milling
   * about."*
   *
   * `isHandler` and `handlerOf` have been in `Pits.js` since the pit was
   * written and had **no caller outside `handlersOn`**: the roster knew which
   * residents walked with an animal, the card knew what the animal was, and no
   * body on the station ever carried one. This is the line that makes it true.
   *
   * `handlerOf(r)` AND NOT A SECOND ROLL. It is a pure function of the
   * resident record `occupant` just returned — the same record `handlersOn`
   * walks — so the stranger you pass on the concourse in the morning with a
   * tuk'ata at heel is the one the pit fields that night, which is the whole
   * of §G4's sentence and was until now a story about a coincidence.
   *
   * `mine: false` IS LOAD-BEARING. Every animal in the world lives in one
   * `CompanionPack`, and `adopt` writes `pack.mine`, `pack.rec` and
   * `pack.rung0` for anything that does not say otherwise — those three are
   * what `keepCompanion` folds into the player's kennel at the end of a run.
   * A stranger's dog claiming them would file the player's epitaph for an
   * animal that was never theirs. It is the same flag the co-op host passes
   * for a peer's animal and for the same reason.
   */
  const H = r.borz ? null : handlerOf(r);
  if (H) { body.stationHandler = H; life?.wantPets.push(body); }
  /* A resident stands where they are put and does not hunt. There is no
   * enemy on this station and no objective for one to be given. */
  if (body.brain) body.brain.idle = true;
  return body;
}

function removeBody(world, body) {
  /* AND THE ANIMAL GOES WITH THE PERSON. It is not in `life.live` — it is a
   * body of the handler's, not of a slot's — so nothing else would ever put it
   * down, and the pool would leak one companion per handler per re-seat. */
  const pet = body?._stationAnimal;
  if (pet) { body._stationAnimal = null; removeBody(world, pet); }
  try { body.dispose?.(); } catch {}
  const i = world.enemies.indexOf(body);
  if (i >= 0) world.enemies.splice(i, 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  CONSEQUENCE — §11, so a sandbox is not a griefing box                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ "RESIDENTS NEVER FIGHT UNLESS ATTACKED" ═══════════════════════════════
 *
 * §11's whole paragraph, and every clause of it is here:
 *
 *   "Cut or throw one and the nearest guards — real, armed bodies — come. You
 *    wake in the Brig (#47), your station `standing` drops (one number in
 *    `Session`), the kiosks refuse you for a day."
 *
 * It is built on the existing team/`canHarm` machinery and adds no new one:
 * a guard is a `bodyguard` archetype on the OTHER side, which is the only
 * thing on the station that is, and the moment the alarm clears it goes away
 * again. The station has no army and does not gain one.
 */
function witness(world, st, life, dt) {
  /**
   * ══ WHO DID IT — AND THIS CLAUSE IS THE WHOLE RULE ════════════════════
   *
   * §11 says *"CUT OR THROW ONE and the nearest guards come"*. What this
   * asked was whether a resident was hurt AT ALL, which is a different
   * question with a different answer, and on a crowded deck the answer is
   * yes within two seconds of arrival — because a crowd bills itself.
   * `Impact.kineticContact` priced a shoulder brush at 0.21 damage (see
   * `KINETIC_BODY.jostle`, which now refuses it), residents never heal, and
   * `hp < maxHp` is a latch that only ever grows.
   *
   * Measured on deck 40, player standing still, no input, before either
   * half of the fix:
   *
   *     t= 5s  hurt  3   standing  -6   guards 2
   *     t=20s  hurt 26   standing -52   SHOPS SHUT
   *     t=40s  hurt 31   standing -62   IG BODYGUARD DROID: it has come for you
   *
   * and on decks 44 and 48 the two guards killed the player outright inside
   * a minute. The hub was punishing you for walking into it, durably, on a
   * number `persistStanding` mirrors to disk. Two decks never fired at all,
   * which is the tell: it scaled with population, not with anything anyone
   * did.
   *
   * `hurtByPlayer` is set at the one line in `Enemy.damage` where hit points
   * are actually lost, on the same test `World.onEnemyKilled` credits a kill
   * with — so "you hurt them" and "you killed them" cannot drift apart. The
   * ambient half is fixed at its own source rather than papered over here,
   * because a crowd wearing itself down to nothing over an evening was wrong
   * whether or not anybody was blamed for it.
   */
  let hurt = 0;
  for (const e of world.enemies) {
    if (!e.stationName) continue;
    if (!e.hurtByPlayer) continue;
    if (e.hp < e.maxHp || e.alive === false) {
      if (!e.__stationTouched) {
        e.__stationTouched = true;
        hurt++;
      }
    }
  }
  if (hurt) {
    life.alarm = Math.max(life.alarm, 12);
    life.standing -= hurt * 2;
    if (world.run) world.run.stationStanding = life.standing;
    world.notify?.('SECURITY CALLED', 'the nearest patrol is on its way');
  }
  if (life.alarm > 0) {
    life.alarm -= dt;
    /* Two guards, which is the patrol unit `faction.py` states — "a patrol
     * unit is two, always" — and they come from the security post (#24). */
    if (life.guards.length === 0 && life.alarm > 6) {
      const post = PLACE.get(24);
      for (let g = 0; g < 2; g++) {
        _v.set(post.x + (g ? 1.4 : -1.4), floorOf(post) + 0.1, post.z);
        let b = null;
        try { b = world.spawnEnemy('bodyguard', _v.clone(), { team: 1 }); } catch {}
        if (b) { b.stationGuard = true; life.guards.push(b); }
      }
    }
    if (life.alarm <= 0) {
      for (const g of life.guards) removeBody(world, g);
      life.guards.length = 0;
    }
  }
}

/** Do the kiosks serve you? §11: not for a day, once you are known for it. */
export function servedHere(world) {
  const life = world?._stationLife;
  return !life || life.standing > -6;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE TRAM — §3.1 rule 3, and it carries people                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The four stops, in the order the loop passes them. §3.2 #40 and its three. */
export const STOPS = [40, 40.2, 40.3, 40.4];
/** Seconds between stops. §3.2: "trams every 90 s". */
const TRAM_LEG = 22.5;

function stepTram(world, st, life, dt) {
  const t = life.tram;
  t.t += dt;
  while (t.t >= TRAM_LEG) { t.t -= TRAM_LEG; t.at = (t.at + 1) % STOPS.length; }
  if (!t.car) return;
  /* The car runs the guideway between two stops — a great-circle arc at the
   * tram radius, so it passes the promenade's glass where §3.1 says it does. */
  const a0 = angleOf(STOPS[t.at]);
  const a1 = angleOf(STOPS[(t.at + 1) % STOPS.length]);
  let d = a1 - a0;
  while (d < 0) d += Math.PI * 2;
  const k = smooth(Math.min(1, t.t / (TRAM_LEG * 0.7)));
  const a = a0 + d * k;
  t.car.position.set(DRUM.tramR * Math.sin(a), DECK_Y[44] + 1.2, DRUM.tramR * Math.cos(a));
  t.car.rotation.y = a + Math.PI / 2;
}
const angleOf = (id) => { const p = PLACE.get(id); return Math.atan2(p.x, p.z); };
const smooth = (x) => x * x * (3 - 2 * x);

/** Build the car. One box with a lit band — it is seen through glass at range,
 * which is the one place §9.1 allows an uninked material, and this is not even
 * that: it takes the deck's own materials like everything else. */
export function dressTram(world, st, M) {
  const g = new THREE.Group();
  g.name = 'station-tram';
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.0, 16), M.wing);
  const band = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.5, 13), M.strip);
  band.position.y = 0.6;
  g.add(body, band);
  world.scene.add(g);
  world.statics.push(g);
  if (world._stationLife) world._stationLife.tram.car = g;
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE EVENT TABLE — §3.4, "events on the clock, one table"                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ten events, each with the place it happens in and the sentence it says.
 * One table, exactly as §3.4 asks, and every row is something a player can go
 * and look at rather than a line of text on its own.
 */
export const EVENTS = [
  { id: 'shuttle', at: 8, place: 8, say: ['ARRIVALS', 'a shuttle is on the collar — the hall fills'] },
  { id: 'crashcart', at: null, place: 43, say: ['MEDBAY', 'a crash cart is running for the flight deck'] },
  { id: 'brawl', at: 21, place: 14, say: ['THE LONG NIGHT', 'a brawl, and the guards are already moving'] },
  { id: 'market', at: 10, place: 9, say: ['MARKET DAY', 'the Concourse is at its fullest'] },
  { id: 'memorial', at: 17, place: 22, say: ['THE CHAPEL', 'a memorial is being read'] },
  { id: 'drill', at: 11, place: null, say: ['FIRE DRILL', 'every deck, ten minutes'] },
  { id: 'surge', at: null, place: 48, say: ['REACTOR SURGE', 'the lights dip across the drum'] },
  { id: 'tramfault', at: null, place: 40.2, say: ['TRAM FAULT', 'the loop is down — the crowds are walking'] },
  { id: 'drazifight', at: 15, place: 35, say: ['THE DRAZI QUARTER', 'green and purple, again'] },
  { id: 'launch', at: 9, place: 5, say: ['LAUNCH CYCLE', 'the Cobra bay, the tower and the ready room all move at once'] },
];

function stepEvents(world, st, life, dt) {
  life.eventIn -= dt;
  if (life.eventIn > 0) return;
  life.eventIn = 45 + h2(Math.floor(st.hour * 4), 11) * 60;
  const hour = Math.floor(st.hour);
  /* An event whose hour has come, else one of the hourless ones. */
  const timed = EVENTS.filter((e) => e.at === hour);
  const pool = timed.length ? timed : EVENTS.filter((e) => e.at === null);
  if (!pool.length) return;
  const e = pool[Math.floor(h2(hour, life.spawned) * pool.length) % pool.length];
  life.event = e;
  /* The reactor surge dips every light on the deck, which is the one event
   * that is a picture rather than a sentence. */
  if (e.id === 'surge') life.dip = 1.4;
  world.notify?.(e.say[0], e.say[1]);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE FRAME                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * One frame of the station's life.
 *
 * §12.2 bounds this at 2.5 ms on the shared box — the same bound
 * `decklife.mjs` holds the deck's step to — and `stationlife.mjs` times it
 * exactly as `deckcast.mjs` times `stepDeckLife`. Nothing here allocates: the
 * candidate list and the keep-set are module scratch, the vectors are reused,
 * and the only `new` in the whole step is a spawn.
 */
/**
 * ══ THE PEOPLE IN THE CORRIDORS ARE GOING SOMEWHERE ═══════════════════════
 *
 * §2.5's third standing rule: *"in between places, the walkways … a real
 * shmorgesborg of activity"*, and the design note under it — *"People are
 * going somewhere … along desire lines between them."*
 *
 * ── WHAT WAS MEASURED, TWICE ─────────────────────────────────────────────
 *
 * The first pass found the corridors EMPTY: `reseat` walked `st.places` and
 * nothing else, so every walkway in the drum held zero people. `wayPlacesOn`
 * fixed that half.
 *
 * The second pass found that nobody in them was going anywhere, and that the
 * fix for the first half had hidden it. Deck 40, 13:00, twenty seconds of
 * `world.update`: 46 bodies, 18 on walkways — and **4 on an open walk stretch
 * out of the 44 slots the deck declares**. Those four then advanced A BEARING
 * AT A FIXED RADIUS, which is a circular pace on a 537 m ring: the walker's
 * own comment said "no pathfinding", and it was right. Nobody had a
 * destination, nobody arrived anywhere, and a minute of walking put a body
 * back where a minute of walking had started.
 *
 * ── WHAT A WALKER DOES NOW ───────────────────────────────────────────────
 *
 * It picks a PLACE — weighted by how busy that place is at this hour, which is
 * the desire line — it walks there along the ring, the balcony and the spines
 * (`planRoute`, which is where the geometry is argued), it STOPS at the door,
 * it stands there a few seconds, and then it picks another one. The whole
 * route is decided once per journey and the step is a walk along a polyline:
 * one interpolation and one trig pair per walking body, per frame.
 *
 * IT COSTS WHAT THE OLD ONE COST. The population is the pool's, unchanged and
 * capped by `POOL[quality]`; what changed is where in the drum the pool is
 * spent and what the bodies do with the frame. §12.2 gives this file 2.5 ms
 * and the step is arithmetic on at most sixty bodies.
 *
 * THE VELOCITY IS SET AS WELL AS THE POSITION because that is what the body's
 * own animator reads: a body moved by assignment alone slides along the deck
 * in its idle pose.
 */
const WALK_PACE = 1.35;

/** How far past a walker the player may be before the pool stops paying for
 *  it. A walker's slot key is where it STARTED, so without this a body that
 *  walked a hundred metres away stayed real on the strength of a doorway the
 *  player is standing next to. `DROP_RADIUS`'s own hysteresis, applied to
 *  where the body actually is. */
const WALK_DROP = DROP_RADIUS + 12;

/**
 * ══ AND SOME OF THEM HAVE AN ANIMAL WITH THEM (V16 §G1) ═══════════════════
 *
 * *"see a couple other people with companions of there own … just milling
 * about."*
 *
 * `Pits.isHandler` and `Pits.handlerOf` — the two functions that decide which
 * residents walk with an animal and which animal it is — had **no caller
 * outside `handlersOn`**, which is a roster the pit reads to fill a card. No
 * body on the station had ever carried a companion, on any deck, at any hour:
 * the roster knew, the card knew, and the drum was empty of animals.
 *
 * `handlerOf(r)` AND NOT A SECOND ROLL. It is a pure function of the resident
 * record `occupant` returned — the same record `handlersOn` walks — so the
 * stranger you pass on the concourse with a tuk'ata at heel is the one the pit
 * fields that night. That is §G4's sentence, and until this it was a story
 * about a coincidence.
 *
 * `fieldCompanion` AND NOTHING COPIED FROM IT. The kennel, the deck and every
 * check field an animal through that one function; a second spawn path here
 * would be a second answer to what a companion is.
 *
 * `mine: false` IS LOAD-BEARING. Every animal in the world lives in one
 * `CompanionPack`, and `adopt` writes `pack.mine`, `pack.rec` and `pack.rung0`
 * for anything that does not say otherwise — the three fields `keepCompanion`
 * folds into the player's kennel at the end of a run. A stranger's dog
 * claiming them would file the player's epitaph for an animal that was never
 * theirs. It is the flag the co-op host passes for a peer's animal, for
 * exactly the same reason.
 */
function stepHandlers(world, life) {
  const m = life.cmp;
  if (!m || !life.wantPets.length) return false;
  /* ONE A FRAME. See `wantPets`. */
  const body = life.wantPets.shift();
  if (!body || body.disposed || body._stationAnimal || !life.live.has(`${body.stationPlace}:${body.stationSlot}`)) return false;
  const H = body.stationHandler;
  if (!H) return false;
  try {
    const pet = m.fieldCompanion(world, body, H.kind, { mine: false, side: (body.stationSlot % 2) ? 1 : -1 });
    if (!pet) return;
    /**
     * ON THE DECK IT IS ACTUALLY ON. `fieldCompanion` drops the heel point to
     * `terrain.height`, which is the planet's ground and not the drum's floor
     * — decks 44 and 48 stand 12.5 m and 25 m above it, so the animal arrived
     * a storey or two under the person holding its lead.
     */
    pet.position.y = body.position.y;
    pet.body?.setTransform?.(pet.position, null);
    /* WHAT THE NAMEPLATE SAYS (§14). `handlerOf` names the animal off the
     * handler's own seed, so it is the same name in the corridor and on the
     * pit's card. */
    pet.stationName = H.animal;
    pet.stationRole = `${H.kind} — ${H.who}'s`;
    pet.stationPlace = body.stationPlace;
    body._stationAnimal = pet;
    return true;
  } catch { /* no animal is a quieter failure than no resident */ }
  return false;
}

function stepWalkers(world, life, dt) {
  const deck = life.deck;
  const hour = world._station?.hour ?? 13;
  for (const body of life.live.values()) {
    if (!body?.wayR) continue;
    /* STANDING AT THE DOOR IT ARRIVED AT. */
    if (body.wayDwell > 0) {
      body.wayDwell -= dt;
      if (body.velocity) body.velocity.set(0, 0, 0);
      if (body.wayDwell <= 0) setOut(deck, hour, body);
      continue;
    }
    if (!body.wayLegs) { setOut(deck, hour, body); continue; }
    const wasX = body.position ? body.position.x : 0;
    const wasZ = body.position ? body.position.z : 0;

    /* ── ALONG THE POLYLINE, CARRYING THE REMAINDER OVER A CORNER ───────── */
    let move = WALK_PACE * body.wayPace * dt;
    const legs = body.wayLegs;
    while (move > 0 && body.wayAt < legs.length) {
      const left = legs[body.wayAt].len - body.wayT;
      if (move < left) { body.wayT += move; break; }
      move -= left;
      body.wayAt++;
      body.wayT = 0;
    }

    /* ── AND WHERE THAT PUTS IT ─────────────────────────────────────────── */
    const L = legs[body.wayAt];
    if (L) {
      const f = L.len > 0 ? body.wayT / L.len : 1;
      if (L.arc) { body.wayAngle = L.from + (L.to - L.from) * f; body.wayR = L.r; }
      else { body.wayR = L.from + (L.to - L.from) * f; body.wayAngle = L.a; }
    } else {
      /* THE END OF THE LAST LEG — it has arrived. */
      const E = legs[legs.length - 1];
      if (E) {
        if (E.arc) { body.wayAngle = E.to; body.wayR = E.r; }
        else { body.wayR = E.to; body.wayAngle = E.a; }
      }
      /**
       * AND IT STOPS BEING A WALKER, which is the point of the whole section.
       * `wayLegs` is dropped, the trip is counted — `station.mjs` reads that
       * number, because "somebody arrived" is the property and "somebody moved"
       * is only its symptom — and after a few seconds at the door it picks
       * somewhere else. It does not simply stop for good: a corridor whose
       * every walker had reached a doorway would be an EMPTY corridor a minute
       * after you walked into it, which is the defect this is here to fix
       * wearing a different hat.
       */
      body.wayLegs = null;
      body.wayTrips = (body.wayTrips | 0) + 1;
      body.wayDwell = DWELL.min + h2(body.waySeedA, body.waySeedB + body.wayTrips) * DWELL.span;
    }

    const x = body.wayR * Math.sin(body.wayAngle);
    const z = body.wayR * Math.cos(body.wayAngle);
    if (body.position) {
      body.position.x = x; body.position.z = z;
      body.body?.setTransform?.(body.position, null);
    }
    /* FACING ALONG THE WALK — off the step actually taken, so an arc, a radial
     * and a corner between them are all one line rather than three cases. */
    const dx = x - wasX, dz = z - wasZ;
    if (dx * dx + dz * dz > 1e-8) body.facing = Math.atan2(dx, dz);
    if (body.velocity && dt > 0) body.velocity.set(dx / dt, 0, dz / dt);
  }
}

export function stepStationLife(world, dt) {
  const st = world._station;
  const life = world._stationLife;
  if (!st || !life || !(dt > 0)) return;
  const t0 = HAS_CPU ? process.cpuUsage() : null;
  const spawnBefore = life.spawned, dropBefore = life.despawned;

  const cam = world.player?.position;
  const px = cam ? cam.x : 0, pz = cam ? cam.z : 0;

  life.reseatIn -= dt;
  if (life.reseatIn <= 0) {
    life.reseatIn = RESEAT_EVERY;
    reseat(world, st, life, px, pz);
    /**
     * THE PRIME OWNS THIS FLAG UNTIL IT IS FINISHED.
     *
     * This line used to be unconditional, and it was harmless for as long as
     * the first population was seated inside `dressStation` — the flag was
     * already false by the time any frame ran. It is not harmless now that the
     * prime is sliced across the frames after the world comes up: the first
     * step cleared it, `reseat`'s cap fell to the walk's one-a-time on the
     * second frame, and the pool settled at eight residents where the prime
     * seats twenty-five. Measured, on deck 40, with forty frames of walk
     * adding one person.
     *
     * So the flag is cleared HERE only when there is no prime left on the
     * station's queue to clear it — a world that is stepped without ever
     * being drained, which play never is and a check might be.
     */
    if (!world._station?.pending?.some((j) => j.prime)) life.priming = false;
  }
  witness(world, st, life, dt);
  const built = stepHandlers(world, life);
  stepWalkers(world, life, dt);
  stepTram(world, st, life, dt);
  stepEvents(world, st, life, dt);
  /* The reactor's dip, decaying — one number the lights read. */
  if (life.dip > 0) life.dip = Math.max(0, life.dip - dt * 0.6);

  if (t0) {
    const t1 = process.cpuUsage(t0);
    const ms = (t1.user + t1.system) / 1000;
    /**
     * The steady step is a frame on which no body was BUILT and none was
     * DISPOSED. Both are expensive — a dispose frees sixty meshes and their
     * geometries — and both are bounded by their cap rather than by a
     * millisecond, so folding either into this number makes it measure the
     * pool's churn instead of the station's work. Measured with the dispose
     * folded in: 171 ms against a 2.5 ms bound, on a frame that did nothing
     * but put four people away.
     */
    /* AND THE FRAME THE HANDLER ROSTER WAS BUILT ON IS NOT A STEADY ONE
     * EITHER. `handlersOn` walks the whole gazetteer through `occupant` and
     * costs milliseconds; it happens once a game hour, which is once every two
     * real minutes, and folding it in would make this number measure a sweep
     * of the census rather than the station's work — the same argument the
     * spawn and the dispose are excluded on. */
    const steady = life.spawned === spawnBefore && life.despawned === dropBefore
      && !life.rosterBuilt && !built;
    life.rosterBuilt = false;
    if (steady) life.stepMs = ms;
  }
}

/** Everything the life made, put down. */
export function undressStationLife(world) {
  const life = world?._stationLife;
  if (!life) return;
  for (const b of life.live.values()) removeBody(world, b);
  for (const g of life.guards) removeBody(world, g);
  life.live.clear();
  life.wantPets.length = 0;
  life.guards.length = 0;
  if (life.tram.car) {
    life.tram.car.parent?.remove(life.tram.car);
    life.tram.car.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  world._stationLife = null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHAT A CHECK ASKS                                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The census at an hour: how many people are in each place, and of what.
 * `stationlife.mjs` holds two things with it — every place's job table is
 * non-empty at its busy hour, and at least eight residents of every species
 * are placed somewhere (§5.3).
 */
export function census(hour, day = 0) {
  const byPlace = new Map();
  const bySpecies = new Map(SPECIES_KEYS.map((k) => [k, 0]));
  /* The Borz cast is counted separately: §3.3 asks for both — every humanoid
   * kind in Borz AND all fifteen species — and one tally of "residents" would
   * let either hide the other's absence. */
  const byBorz = new Map();
  for (const p of PLACES) {
    if (p.external || !p.heads) continue;
    const n = headcount(p, hour);
    byPlace.set(p.id, n);
    for (let i = 0; i < n; i++) {
      /* THE DAY REACHES `occupant` HERE TOO. It is the third caller of the
       * three, and it was the third one handing in no day — so a tally taken
       * on day 40 was a tally of day 0's people. The default keeps every
       * existing caller reading exactly what it read; what it buys is a check
       * that can sweep the days and see whether §5.3's eight-of-every-species
       * still holds when the faces reroll, which is the only way to know that
       * the reroll has not quietly emptied a room of a species. */
      /* `occupant` AND NOTHING ELSE. This line used to answer the methane
       * quarter itself — `p.id === 36 ? { species: METHANE[i % 2] }` — while
       * `occupant` drew #36 from the shares like any other room, so the tally
       * reported ten methane-breathers the game never spawned. The rule lives
       * in `planBias` now and both readers go through it. */
      const r = occupant(p, i, { day: day | 0 });
      if (r.borz) { byBorz.set(r.borz.id, (byBorz.get(r.borz.id) || 0) + 1); continue; }
      bySpecies.set(r.species, (bySpecies.get(r.species) || 0) + 1);
    }
  }
  return { byPlace, bySpecies, byBorz };
}
