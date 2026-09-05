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
/* One call, on one body — see `stepHandlers`. `Impact.js` imports Combat,
 * MathUtil and Audio and nothing that reaches back here, so this one is a
 * plain edge rather than a cycle. */
import { disarmKinetic } from './Impact.js';
/* THE ONE EXEMPTION FROM THE DAILY REROLL — see `occupant`. `Quests.js` holds
 * the ledger and answers in SEEDS, so this file still decides who stands where
 * and `StationCast.resident` still decides what a person looks like. */
import { pinnedAt } from './Quests.js';
/**
 * ══ THE FOLD, BECAUSE STANDING IS ONE NUMBER AND THIS IS IT ═══════════════
 *
 * §11: *"your station `standing` drops (ONE NUMBER in `Session`)"*. It was
 * two. `life.standing` was seeded off `world.run?.stationStanding`, `main.js`
 * builds a fresh run bag per world, and a deck is a world — so a lift ride put
 * the number the kiosks read back to zero while `Counter.markupFor`, which
 * defaults to the DURABLE fold, went on charging you for the brawl. Measured
 * before this, one cut on deck 40 and a ride to 44:
 *
 *     VISIT 1                      life.standing -10   fold -10   served no
 *     VISIT 2 (after a lift ride)  life.standing   0    fold -10   served YES
 *
 * The fold is the truth and `dressStationLife` hangs `life.standing` on it as
 * an accessor, so the three readers — the counters, the pits and the kiosk
 * door below — cannot disagree and `payForJob`'s +2 is felt inside the visit
 * it is earned in.
 */
import {
  standing, setStanding, stationDay, passStationHours,
  shutKiosks, kiosksShut, brigPending, setBrigPending,
} from './StationSave.js';

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
  /**
   * ══ SHIFT CHANGE, AND IT WAS FIRING TWELVE HOURS OUT ══════════════════
   *
   * `Math.abs(((hour - s + 36) % 24) - 12)` IS the circular distance from the
   * shift hour: it is 0 at `s` and 12 on the far side of the clock. Both
   * windows below tested it for being LARGE — `> 11.4` and `> 11.6` — which
   * selects the opposite of the hour they name. Measured against §3.4:
   *
   *     declared   06  14  22        fired   10  02  18
   *     meals      07  13  19        fired   19  01  07
   *
   * So the ring's *"three floods a day"* landed at two in the morning and the
   * food court's lunch rush landed at one. The corridors were at their thinnest
   * at exactly the three hours the design says a shift change floods them, and
   * nothing said so because the only bar on any of it — `station.mjs`'s
   * walkway clause — samples 13:00 and 03:00, neither of which is a shift and
   * neither of which is twelve hours from one.
   *
   * The window is an hour either side rather than the hour on the nose, because
   * a shift change is people leaving a place over a while and `st.hour` is a
   * continuous number that a player walks through.
   */
  for (const s of [6, 14, 22]) {
    const d = Math.abs(((hour - s + 36) % 24) - 12);
    if (d <= 1) k += place.id === 9 || place.band === 'ring' ? 0.55 : 0.18;
  }
  /* Meals, in the three places §3.2 says they happen in. */
  if (place.id === 15 || place.id === 16 || place.id === 17) {
    for (const m of [7, 13, 19]) if (Math.abs(((hour - m + 36) % 24) - 12) <= 1) k += 0.6;
  }
  return Math.max(0, Math.min(1.6, k));
}

/**
 * How many people are IN a place at an hour. Not how many are live — see the
 * header. `station.mjs` holds every place to being non-empty at its own busy
 * hour, which is what stops a room from being furniture.
 */
export function headcount(place, hour, ev = _event) {
  const heads = place.heads || 0;
  /**
   * ── AND §3.4'S EVENT IS PART OF WHO IS THERE ──────────────────────────
   *
   * *"MARKET DAY — the Concourse is at its fullest"* added nobody to the
   * Concourse: `headcount` took no event, so the row was a banner and the
   * room held its ordinary eighty. The extra people are ADDED PAST THE CURVE
   * rather than folded into `heads`, so a row that says "fourteen more in
   * Arrivals" puts fourteen more in Arrivals at whatever hour it fires and
   * not fourteen times whatever the cosine happens to be — a shuttle on the
   * collar at 03:00 is still a shuttle on the collar.
   *
   * `ev` DEFAULTS TO THE RUNNING ROW and is not passed by the pool's
   * re-seat, the walker's desire lines or the pit's roster — see the note
   * over `_event` for why the now is a default rather than an argument.
   * `headcount(p, h, null)` is the plain gazetteer number.
   */
  const extra = (ev && ev.fill && ev.fill[place.id]) || 0;
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
  if (place.fixed) return heads + extra;
  const n = Math.round(heads * fullness(place, hour));
  /* A place somebody LIVES in is never literally empty while the day is on
   * it. The mortician is one person in a room of drawers and the curve would
   * round him away at every hour but three, which reads as an abandoned
   * station rather than as a quiet one. */
  return extra + ((heads > 0 && n === 0 && fullness(place, hour) > 0.35) ? 1 : n);
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
  /**
   * ══ A CORRIDOR IS AN ARC, AND A RECTANGLE LAID OVER ONE MISSES ═════════
   *
   * A room is a box and the scatter above is the box's. A stretch of the ring
   * or the balcony is not a box: it is a band of an annulus, and laying a
   * straight rectangle over it puts the ends of the rectangle INSIDE the
   * circle by the sagitta. Measured on the ring stretches as they stood —
   * 58 m wide at r = 85.5 — the ends of a stretch sat **5.1 m inboard of the
   * ring**, which is past `roomR` and inside whatever room is at that bearing.
   * On the balcony it is worse and it is fatal: 26 m of chord at r = 24 is
   * 3.8 m in, and the balcony has 6 m of floor before the atrium void.
   *
   * So a way place may declare `arc` — the radius its band runs at — and its
   * `w` is then read as ARC LENGTH along that band and its `d` as the radial
   * spread across it. Nothing else changes: the same two hashes, the same
   * `0.72`, the same determinism, and a place without `arc` is placed exactly
   * as it was.
   */
  if (place.arc) {
    const a = place.yaw + (u * place.w * 0.72) / place.arc;
    const r = place.arc + v * place.d * 0.72;
    out.set(r * Math.sin(a), floorOf(place), r * Math.cos(a));
    return out;
  }
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
 * ══ AND THE BALCONY, WHICH IS THE CORRIDOR THE PLAYER ARRIVES ON ══════════
 *
 * §3.1 rule 1 gives every deck a balcony onto the atrium void, `planRoute`
 * has always treated it as one of the drum's THREE walkable surfaces, and
 * `wayPlacesOn` declared not one person on it. Every open stretch this file
 * made was on the ring at r = 85.5 or on a spine.
 *
 * MEASURED, and it is the whole of the arrival defect. `STATION_LEVEL.start`
 * is `[-24, 2]` — r = 24.1, which is the balcony walk itself, three metres
 * inside the lip. Standing there on deck 40 and running a minute of frames at
 * every hour of the day:
 *
 *     08:00   20 bodies, 0 walkers, 0 of them moved a millimetre
 *     13:00   31 bodies, 0 walkers, 0 moved
 *     22:00   21 bodies, 0 walkers, 0 moved
 *
 * and the nearest slot on any open stretch the deck declared was **44.6 m**,
 * which is outside `LIVE_RADIUS` — so it was not that the lobby was unlucky,
 * it was that no walker could ever be built there however long you stood.
 * The first thing a player sees when the lift doors open was a still frame.
 *
 * Eight stretches of 26 m of arc round 150.8 m of balcony is 0.72 × 26 =
 * 18.7 m of scatter against an 18.85 m spacing — continuous, by the same
 * arithmetic `RING_WALKS` is sized by. The bearings are 22.5° + 45°k, which
 * puts a stretch's CENTRE off each of the four spines rather than on it.
 *
 * `d` IS 3 AND NOT 6. The balcony is 8 m of floor between the void at r = 18
 * and the lip at 26; ±1.08 m about r = 24 keeps every slot on it, and `arc`
 * above is what makes that a radial spread rather than a chord.
 */
const BALC_WALKS = 8;
const BALC_WALK_W = 26;
const BALC_WALK_D = 3;

/**
 * A SPINE STRETCH IS NARROW AND LONG, and the width is load-bearing rather
 * than cosmetic. `slotIn`'s scatter is TANGENTIAL in `w`, and a spine walker's
 * first leg is a radial along ITS OWN bearing — so a seat 2 m off the spine's
 * centreline at r = 53 is 3.2 m off it by the time the walk reaches the ring
 * at r = 85.5, and the spine is 7 m wide. Four metres of scatter keeps the
 * worst case inside the corridor at both ends; `spanAt` holds the same bound
 * from the other side.
 */
const SPINE_WALK_W = 4;

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
  /* `arc` is the radius a BAND runs at — see `slotIn`. A fixture is 6 m of
   * counter and is a box; a stretch of corridor is an arc and says so. */
  const put = (r, deg, w, d, heads, peak, what, arc = 0) => {
    const a = deg * Math.PI / 180;
    out.push({
      id: id++, deck, band: 'ring', way: what,
      x: r * Math.sin(a), z: r * Math.cos(a), yaw: a, w, d,
      heads, peak, arc,
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
    put(DRUM.ringR, 15 + i * (360 / RING_WALKS), RING_WALK_W, 6, WALK_HEADS, 14, 'walk',
      DRUM.ringR);
  }
  /* AND THE BALCONY ROUND THE VOID — the corridor the lift lobby opens onto,
   * and the one this file left empty. See `BALC_WALKS`. */
  for (let i = 0; i < BALC_WALKS; i++) {
    put(BALC_WALK, 22.5 + i * (360 / BALC_WALKS), BALC_WALK_W, BALC_WALK_D, WALK_HEADS, 13,
      'walk', BALC_WALK);
  }
  /**
   * ── AND THE SPINES, ON THE PART OF THEM THAT IS ACTUALLY CLEAR ────────
   *
   * This used to seat six people at the midpoint of every spine and walk them
   * its whole length. Nine of the twelve spines have a room across them (see
   * `spineSpansOn` for the table), so that was people walking through walls on
   * every deck — never caught, because the trespass clause puts its player on
   * a RING stretch and never had a spine walker in the sample.
   *
   * The stretch is now the span, and its length is the span's: a spine with a
   * forty-metre clear stub carries people down forty metres of it, and one
   * with nothing but eleven metres between two rooms carries nobody, because
   * there is nowhere for them to be going.
   */
  for (const sp of spineSpansOn(deck)) {
    /* Deck 40's fourth spine IS #9 The Concourse — a hall with its own census,
     * not a corridor with people passing through it. It is still ROUTED
     * through (`throughSpines` finds it clear, which it is); what it does not
     * get is a stretch of its own. */
    if (deck === 40 && sp.deg === 0) continue;
    const len = sp.hi - sp.lo;
    put((sp.lo + sp.hi) / 2, sp.deg, SPINE_WALK_W, Math.max(4, len - 3),
      WALK_HEADS, 14, 'walk');
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

/**
 * ══ AND A SPINE IS NOT A CLEAR CORRIDOR, WHICH THE PLAN DOES NOT SAY ══════
 *
 * §3.1 rule 3 declares four radial spines at 0/90/180/270 on every deck, and
 * `wayPlacesOn` used to seat people on all of them and walk them the length.
 * MEASURED against the room rectangles — the same yawed boxes `station.mjs`
 * tests overlap and trespass with — the spines are not clear. A SNAPSHOT of
 * it, on the gazetteer as it stood when this was written; the derivation below
 * is live, so the table moves the day a bearing in `PLACES` does and nothing
 * here has to be kept in step by hand:
 *
 *     deck 40 spine  90  #59 The Ascendant [26.6..38.4], #60 The Wheelhouse [65.1..81.0]
 *     deck 40 spine 180  #7  Arrivals hall [61.2..81.1]
 *     deck 40 spine 270  #21 Gym [27.0..38.6], #20 The Arena [54.7..62.0]
 *     deck 44 spine   0  #27 Your cabin [26.0..36.9], #61 Underlift Pit [67.4..76.5]
 *     deck 44 spine 180  #34 Minbari quarter [60.6..81.7]
 *     deck 48 spine   0  #51 Droid pool [26.0..37.9], #48 Reactor hall [49.0..81.0]
 *     deck 48 spine  90  #52 Cargo hold [58.8..70.2]
 *     deck 48 spine 180  #41 Command / CIC [68.0..81.0]
 *     deck 48 spine 270  #45 Morgue & memorial [69.2..81.1]
 *
 * A room declares a bearing and a width and `layout()` builds it a BOX, and a
 * wide box at 176° has a corner over 180°. So most of the twelve spines are
 * blocked somewhere along their length, and the old spine walkers paced
 * straight through those rooms — silently, because the trespass clause seats
 * its bodies on a RING stretch and never had a spine walker in the sample.
 *
 * NOT FIXED HERE, because the fix is a bearing in `StationPlan.PLACES` and
 * that table is the gazetteer. What is done here is to stop walking through
 * it: this derives the part of each spine that IS clear, and nothing walks
 * anywhere else. A blocked spine keeps the stub that reaches an annulus and
 * carries people up and down it; a deck with no spine clear END TO END has no
 * walk between its balcony and its ring at all, which is a true thing about
 * that deck's plan and is why `pickDest` will not offer one.
 *
 * THE SAME RECTANGLES AND THE SAME EXCLUSION `station.mjs` USES: a room the
 * ring runs THROUGH is a hall you walk down rather than a room you walk into,
 * so #9 The Concourse — deck 40's fourth spine — is not an obstruction, and
 * bearing 0 on deck 40 comes out clear because that is what it is.
 */
function boxHas(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  return Math.abs(dx * c - dz * sn) <= p.w / 2 && Math.abs(dx * sn + dz * c) <= p.d / 2;
}

/**
 * FETCH THE COMPANION MACHINERY, AND NOT AT DRESS TIME.
 *
 * The first cut fired this from `dressStationLife` and MEASURED `cmp: false`
 * for ever, with four bodies waiting for an animal and none built. The reason
 * is the cycle this import exists to get round: `dressStation` runs inside
 * `World.loadLevel`, which runs inside `Levels.js`'s own graph, and asking for
 * `Companions.js` from in there asks for a module that is still being
 * evaluated — so the promise rejects and the `catch` swallowed it silently.
 *
 * Asked from module scope instead, every module in the graph finishes on its
 * own time and this one picks the answer up whenever it lands. A failure is
 * retried rather than latched, on a slow clock, because the one thing worse
 * than an animal that arrives a second late is a station that decided on frame
 * one it would never have any.
 */
let _cmp = null;
let _cmpIn = 0;
function companionsNow() {
  if (_cmp) return _cmp;
  if (_cmpIn > 0) { _cmpIn--; return null; }
  _cmpIn = 60;
  import('./Companions.js').then((m) => { _cmp = m; }).catch(() => {});
  return null;
}
/* STARTED AT MODULE SCOPE, which is the earliest moment there is and the one
 * that matters. A promise only settles at an `await`, and `stepStationLife` is
 * called from a SYNCHRONOUS frame loop — so a fetch begun on the first frame
 * cannot possibly have landed by the second, and in a headless check that
 * drives ten thousand frames in a row without awaiting anything it never lands
 * at all. Measured with the fetch begun from the step: `cmp: false` after
 * 1 800 frames, four bodies waiting for an animal, none built. Begun here, it
 * has the whole of the station's build — every room file read, every await in
 * `loadLevel` — to finish in. */
companionsNow();

/** A stub shorter than this is not a corridor anybody walks. */
const SPAN_MIN = 8;

const _spans = new Map();
function spineSpansOn(deck) {
  const hit = _spans.get(deck);
  if (hit) return hit;
  const rooms = PLACES.filter((p) => p.deck === deck && !p.external && p.band !== 'ring' && p.w
    && !(p.rIn <= DRUM.ringR && p.rOut >= DRUM.ringR));
  const out = [];
  for (const deg of DRUM.spines) {
    const a = deg * Math.PI / 180;
    const sn = Math.sin(a), cs = Math.cos(a);
    /* The clear runs along this spine, at a quarter-metre. */
    const runs = [];
    let lo = null;
    for (let r = BALC_WALK; r <= RING_WALK + 1e-9; r += 0.25) {
      let blocked = false;
      for (const p of rooms) if (boxHas(p, r * sn, r * cs)) { blocked = true; break; }
      if (!blocked) { if (lo === null) lo = r; continue; }
      if (lo !== null) { runs.push([lo, r - 0.25]); lo = null; }
    }
    if (lo !== null) runs.push([lo, RING_WALK]);
    /* ONLY A RUN THAT REACHES AN ANNULUS IS A WAY ANYWHERE. A clear stretch
     * in the middle of a spine with a room at each end is a room with no
     * door: people could stand in it and never leave. */
    let best = null;
    for (const [l, h] of runs) {
      const touchIn = l <= BALC_WALK + 0.3, touchOut = h >= RING_WALK - 0.3;
      if (!touchIn && !touchOut) continue;
      if (h - l < SPAN_MIN) continue;
      const ends = touchIn && touchOut ? 'both' : touchIn ? 'in' : 'out';
      if (!best || (ends === 'both' && best.ends !== 'both') || (h - l > best.hi - best.lo && best.ends !== 'both')) {
        best = { a, deg, lo: l, hi: h, ends };
      }
    }
    if (best) out.push(best);
  }
  _spans.set(deck, out);
  return out;
}

/** The spines of a deck that join the balcony to the ring. */
const _through = new Map();
function throughSpines(deck) {
  let hit = _through.get(deck);
  if (!hit) {
    hit = spineSpansOn(deck).filter((s) => s.ends === 'both');
    _through.set(deck, hit);
  }
  return hit;
}

/**
 * The walkable span this position is standing in, or null for a body already
 * on one of the two annuli.
 *
 * THE BEARING TEST IS IN METRES AT THE WIDE END. A radial line `d` radians off
 * a spine is `d × r` from its centre and that grows with r, so the worst case
 * is the ring mouth: `d × RING_WALK ≤ spineW/2 − 0.5`. That is what sizes
 * `SPINE_WALK_W` from the other side — the scatter a seat is given has to
 * still be inside the corridor when the walk reaches the far end of it.
 */
function spanAt(deck, a, r) {
  const lim = (DRUM.spineW / 2 - 0.5) / RING_WALK;
  for (const s of spineSpansOn(deck)) {
    if (Math.abs(wrapPi(a - s.a)) > lim) continue;
    if (r >= s.lo - 0.5 && r <= s.hi + 0.5) return s;
  }
  return null;
}

/** Which through-spine makes the shortest crossing between two bearings. */
function bestSpine(deck, a0, a1) {
  let best = null, cost = Infinity;
  for (const s of throughSpines(deck)) {
    const c = Math.abs(wrapPi(s.a - a0)) + Math.abs(wrapPi(a1 - s.a));
    if (c < cost) { cost = c; best = s.a; }
  }
  return best;
}

/** Which annuli a walker standing here can actually reach. */
function reachFrom(deck, r, a) {
  const sp = spanAt(deck, a, r);
  const through = throughSpines(deck).length > 0;
  if (sp) {
    if (sp.ends === 'both' || through) return 'both';
    return sp.ends === 'in' ? 'balcony' : 'ring';
  }
  if (through) return 'both';
  return r > (BALC_WALK + RING_WALK) / 2 ? 'ring' : 'balcony';
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
  const destLvl = dest.on === 'ring' ? RING_WALK : BALC_WALK;
  /* WHICH ANNULUS THIS WALK STARTS FROM. A walker on a spine stub is mid-band,
   * so "which annulus is it on" has no answer — what it has is an END, and it
   * walks to that one. A stub clear at both ends can go straight to whichever
   * the destination is on; without that a spine walker bound for the ring
   * walked INWARD to the balcony first and back out along the same spine. */
  const sp = spanAt(deck, a0, r0);
  const lvl0 = sp
    ? (sp.ends === 'both' ? destLvl : (sp.ends === 'in' ? BALC_WALK : RING_WALK))
    : (r0 > (BALC_WALK + RING_WALK) / 2 ? RING_WALK : BALC_WALK);
  let a = a0;
  radLeg(legs, a0, r0, lvl0);
  if (lvl0 !== destLvl) {
    const cross = bestSpine(deck, a0, dest.a);
    /* NO WAY ACROSS ON THIS DECK. `pickDest` does not offer a destination on
     * the far annulus when there is no through-spine, so this is the belt to
     * that brace rather than a case that happens — and it refuses to invent a
     * route rather than emitting a radial through a room. */
    if (cross === null) { legs.length = 0; return legs; }
    a = arcLeg(legs, lvl0, a, cross);
    radLeg(legs, cross, lvl0, destLvl);
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
    out.push({ p, id: p.id, on, a: Math.atan2(p.door[0], p.door[1]), r: STAND_R[on], w: 0 });
  }
  /**
   * ── AND THE WALKWAY'S OWN FIXTURES, WHICH ARE THE OTHER HALF OF IT ────
   *
   * MEASURED WITHOUT THEM. Deck 40's gazetteer gives about thirty doors over
   * 537 m of ring, which is one every eighteen metres ON AVERAGE and nothing
   * at all across some arcs — so a walker standing at bearing 15° had no room
   * inside the trip cap, fell through to "the nearest thing there is", and
   * drew a route of 52 to 73 m to the far side of the balcony. Eight of eight
   * tracked walkers were on one of those, and not one of them ever arrived.
   *
   * A CONCOURSE IS NOT ONLY DOORS. `wayPlacesOn` already declares the stalls,
   * the kiosks, the benches, the planters, the shopfronts, the overlooks and
   * the crossings — the places its own comment calls *"where a person has
   * STOPPED on purpose"* — and those are exactly what somebody crossing a
   * concourse is crossing it TO. Adding them roughly triples the density of
   * places to go on the ring, which is what makes a short crossing possible at
   * all.
   *
   * `walk` STRETCHES ARE NOT DESTINATIONS: they are the corridor, not a place
   * in it, and a walker whose errand was "a patch of open floor" is the pace
   * this whole section replaced. SPINE fixtures are left out too — reaching
   * one means stopping part-way along a radial, and whether that part is on
   * the clear span is a second question `spineSpansOn` would have to be asked
   * per fixture; the ring and the rim are the two surfaces this needs.
   */
  for (const p of wayPlacesOn(deck)) {
    if (p.way === 'walk') continue;
    const r = Math.hypot(p.x, p.z);
    const on = Math.abs(r - RING_WALK) < 3 ? 'ring'
      : Math.abs(r - BALC_WALK) < 3 ? 'balcony' : null;
    if (!on) continue;
    /* STOPPED AT THE FIXTURE and not at a door: the stand radius is the
     * fixture's own, which is on the corridor by construction. */
    out.push({ p, id: p.id, on, a: Math.atan2(p.x, p.z), r, w: 0 });
  }
  _dests.set(deck, out);
  return out;
}

/**
 * ══ HOW FAR A WALK MAY BE, AND THE CULL RADIUS IS WHAT DECIDES IT ═════════
 *
 * The ring is 537 m round and a walk is 1.35 m/s, so a destination on the far
 * side is six and a half minutes away. The first cut allowed up to 130 m and
 * MEASURED as a walk nobody ever finished: deck 40, sixty seconds, median path
 * 40.4 m and **zero arrivals**, because a body is dropped once it is
 * `DROP_RADIUS` from the player and a walker starting inside the live radius
 * has about forty metres of walking before that happens. Every journey was cut
 * off in the middle.
 *
 * So a trip is sized against the radius the pool pays for and not against the
 * ring. THE ARITHMETIC THAT PICKS THE NUMBER: a walker is seated inside 40 m
 * of the player and dropped at 52, so the ground it has left is twelve metres
 * at worst and about twenty-seven at the median — measured, with a 45 m cap:
 * a median 41 m of path walked and **still zero arrivals**, every journey cut
 * off a few metres short of its door. Eight to thirty metres fits inside that,
 * and it is a crossing from one place to the next one along — what the
 * between-space is FOR, and what most walking on a concourse actually is. A
 * walker arrives, stands at the door a few seconds, and sets off somewhere
 * else: two or three journeys inside the window a player is looking at it,
 * rather than one third of one.
 */
const TRIP = { near: 8, far: 35 };

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
/**
 * HOW FAR A WALK BETWEEN TWO POLAR POINTS ACTUALLY IS.
 *
 * The arc leg is walked at the radius the route turns on, and this read
 * `RING_WALK` flat for every walker on the deck. On the ring that is the truth;
 * on the balcony it is three and a half times it — an eight-metre stroll along
 * the rail priced at twenty-nine — so with `TRIP` capped at thirty-five metres
 * a balcony walker's own neighbours were all "too far" and every trip fell
 * through to the nearest-thing fallback. `max` rather than the destination's
 * own radius because a cross-annulus trip turns on the wider of the two.
 */
function tripLen(r0, a0, d) {
  return Math.abs(wrapPi(d.a - a0)) * Math.max(r0, d.r) + Math.abs(d.r - r0);
}

function pickDest(deck, hour, body) {
  const list = destsOn(deck);
  if (!list.length) return null;
  const r0 = body.wayR, a0 = body.wayAngle;
  /* AND ONLY WHERE THIS BODY CAN ACTUALLY GET TO. On a deck whose plan gives
   * no clear radial between the balcony and the ring — deck 48 is one — the
   * two annuli are two separate walks, and offering a destination across the
   * gap would be a route that has to go through a room to exist. */
  const reach = reachFrom(deck, r0, a0);
  let total = 0;
  for (const d of list) {
    const far = tripLen(r0, a0, d);
    d.w = (far >= TRIP.near && far <= TRIP.far && d.id !== body.wayTo
      && (reach === 'both' || reach === d.on))
      ? headcount(d.p, hour) + 1 : 0;
    total += d.w;
  }
  /* NOTHING IN RANGE — take the nearest reachable thing that is not where we
   * are. A walker with no destination is the defect this whole section is
   * about, so the fallback is another destination and never `null`. */
  if (total <= 0) {
    let best = null, cost = Infinity;
    for (const d of list) {
      if (d.id === body.wayTo || (reach !== 'both' && reach !== d.on)) continue;
      const far = tripLen(r0, a0, d);
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
const DWELL = { min: 2, span: 5 };

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
    wantPets: [],
    reseatIn: 0,
    /** True until the first re-seat has run — see `dressStationLife`. */
    priming: true,
    /** The tram: four stops, ninety seconds apart (§3.2 #40). */
    tram: { t: 0, at: 0, car: null, faulted: false },
    /**
     * THE PLAYER'S OWN ROLL, read ONCE (V16 §C2). `StationBoards.companyOf`
     * is the one authority on which of the armies' manifests is "the"
     * company from the station's point of view — the departures board and
     * the cantina must not disagree about who is aboard. Null is a legal
     * answer and means the bars fill with the station's own garrison
     * instead; see `Bars.js`'s header.
     */
    company: (() => { try { return companyOf(); } catch { return null; } })(),
    /**
     * The event table's cursor and what is running (§3.4).
     *
     * `event` IS NOT IN THIS LITERAL EITHER — it is hung on this object below
     * as an accessor onto the module's own `_event`, exactly as `standing` is
     * hung on the durable fold, and for the same reason: `headcount` has no
     * world and two copies of one fact drift. `eventFor` is how many real
     * seconds the row has left to run.
     */
    eventIn: 20, eventFor: 0,
    /** How far the drum's lights are down (§3.4's REACTOR SURGE). `stepDip`
     *  is the reader; it was never in this literal at all, so the number the
     *  surge set started life as `undefined`. */
    dip: 0,
    /**
     * §11's consequence: the guards who come and the arrest they make.
     *
     * `standing` IS NOT IN THIS LITERAL. It is the station's own fold and it
     * is hung on this object below — see the import note at the head of the
     * file for the two numbers that used to be here.
     */
    alarm: 0, guards: [], arrest: null, guardNear: Infinity, guardHold: 0,
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
  /**
   * ── AND THE ONE NUMBER IS THE FOLD'S, THROUGH THIS PROPERTY ─────────────
   *
   * An accessor and not a copy, because a copy is exactly what was wrong: two
   * fields called standing, one of them the one the shops read. Everything
   * that already writes `life.standing` — `witness` below — now writes the
   * durable number, and everything that reads it, including `payForJob`'s
   * rise through `StationSave.setStanding`, reads the same one back inside
   * the same visit. `setStanding` still clamps to [-40, +40] and rounds, so
   * the accessor adds no rule of its own.
   */
  Object.defineProperty(life, 'standing', {
    get: () => standing(),
    set: (v) => { setStanding(v); },
    enumerable: true, configurable: true,
  });
  /* AND §3.4'S RUNNING ROW IS THE MODULE'S, THROUGH THIS ONE. See `_event`. */
  Object.defineProperty(life, 'event', {
    get: () => _event,
    set: (v) => { _event = v || null; },
    enumerable: true, configurable: true,
  });
  world._stationLife = life;
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
  const before = life.spawned;
  const p = world.player?.position;
  reseat(world, here, life, p ? p.x : 0, p ? p.z : 24);
  /**
   * A re-seat that BUILT nobody has nobody left to build: every candidate
   * inside the radius is already standing, or the budget is spent. Either way
   * the prime is over and the pool goes on the walk's own trickle.
   *
   * `life.spawned` and not `life.live.size`, because the same call can drop as
   * many as it makes — `reseat` culls in the same pass — and a pool that
   * churned four bodies for four would read as finished when it had not
   * started. The counter only goes up.
   */
  if (life.spawned <= before) { life.priming = false; return false; }
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
      /**
       * ── WHAT THE POOL BUYS FIRST, WHEN IT CANNOT BUY EVERYTHING ────────
       *
       * The sort below is nearest-first and the budget is spent down it, and
       * on a busy deck there are more candidates inside the live radius than
       * the pool can pay for — so what is at the top of that queue IS the
       * station the player sees. Two things are moved up it, and both are
       * measured rather than felt:
       *
       * THE OPEN WALK. §2.5 asks for the between-space to read busy, and the
       * between-space is the one part of the station the player is always
       * standing IN. Measured without this, on deck 40 at 13:00 with the pool
       * full at sixty: 42 bodies in rooms, 14 at fixtures and **4 of the 9
       * declared walk slots inside the radius**. A room's people are behind a
       * door and read as a room being occupied; a corridor's people ARE the
       * corridor.
       *
       * A ROOM WITH AN ANIMAL IN IT. `handlerRooms` is `handlersOn().where`,
       * and one handler in twenty-nine residents means the room with a dog in
       * it is usually the one just outside the radius. See `handlerRooms`.
       *
       * BOTH ARE METRES OFF A DISTANCE and neither is a free pass: they move
       * a place up the queue and `LIVE_RADIUS` below still decides whether
       * anybody in it is built at all, so nothing is ever seated further away
       * than the pool would otherwise reach.
       */
      const lift = (p.way === 'walk' ? SEAT_LIFT.walk : 0)
        + (life.handlerRooms.has(p.id) ? SEAT_LIFT.handler : 0);
      const near = lift ? Math.max(0, Math.sqrt(d2) - lift) ** 2 : d2;
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
  /**
   * ══ AND A SHARE OF THE BUDGET IS THE CORRIDOR'S, HELD BACK FROM THE ROOMS ══
   *
   * `SEAT_LIFT.walk` moves an open stretch twelve metres up a nearest-first
   * queue, and twelve metres is nothing against a hall. MEASURED, standing in
   * #9 The Concourse on deck 40 at 13:00, quality `high`: the room declares
   * eighty heads over sixty-seven metres, sixty of them are inside the live
   * radius, and the pool is sixty — so the concourse spent the WHOLE budget on
   * itself and the deck had **zero walkers at the hour it is busiest**. §3.3
   * calls that room *"where the game's whole cast is seen at once"* and what
   * was seen was sixty people standing still in it.
   *
   * A lift is an ordering and cannot fix that, because the queue never reaches
   * the corridor at all. A RESERVE can: a fifth of the pool is counted out for
   * the open stretches inside the live radius before the rooms are allowed to
   * spend down to the bottom of the budget. It is not a floor on walkers — a
   * deck with three walk slots in reach reserves three — and it is given back
   * the moment a walk slot turns out to be unbuildable, so a quiet corridor
   * never costs a room a body.
   */
  let reserve = 0;
  {
    const want2 = Math.round(life.budget * WALK_SHARE);
    for (const w of want) {
      if (reserve >= want2) break;
      if (w.place.way === 'walk' && w.d2 <= LIVE_RADIUS * LIVE_RADIUS) reserve++;
    }
  }
  let made = 0;
  for (const w of want) {
    if (n >= life.budget) break;
    const isWalk = w.place.way === 'walk';
    /* The rooms stop at the reserve; the stretches spend it. */
    if (!isWalk && n >= life.budget - reserve) continue;
    keep.add(w.key);
    n++;
    if (isWalk && reserve > 0) reserve--;
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
    if (w.d2 > LIVE_RADIUS * LIVE_RADIUS) {
      keep.delete(w.key); n--;
      if (isWalk) reserve++;
      continue;
    }
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
/** How many metres nearer than it is a candidate is treated as being. See
 *  `consider`. Both are smaller than the live radius by a wide margin, so
 *  neither can pull in a body from outside it. */
const SEAT_LIFT = { walk: 12, handler: 16 };

/** What share of the pool is counted out for the open stretches before the
 *  rooms may spend the rest of it. See the note in `reseat`. */
const WALK_SHARE = 0.2;

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
  /* See `Impact.kineticContact`'s `noAmbientHarm`. */
  body.noAmbientHarm = true;
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
   * ── AND EVERYBODY ELSE IS AT SOMETHING ──────────────────────────────────
   *
   * Every body in the pool that is not on an open stretch: the people in the
   * rooms, and the people at the counters, benches, rails and crossings a
   * walkway declares. See `stepStanding` for what "at something" is and for
   * the sixty statues that were there before it.
   */
  if (!body.wayR) standHere(body, place, _v);
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
 * It is built on the machinery the station already has and adds no new one: a
 * guard is the resident chassis in the ARC kit — armour and two holstered
 * sidearms, which is §11's "armed" — driven at you by `stepGuards` exactly as
 * `stepWalkers` drives everybody else in the drum, and gone again the moment
 * the alarm clears. The station has no army and does not gain one, and it no
 * longer answers a shoplifting with a 1050 hp boss droid.
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
   * a minute. The hub was punishing you for walking into it, durably, on the
   * station's own durable fold. Two decks never fired at all,
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
    /* A NEW OFFENCE IS A NEW ARREST. `arrest` refuses to fire twice on one
     * record — the transfer would be asked for on every frame otherwise — so
     * the record is dropped once you have been put in the cell and served. */
    if (life.arrest?.woke) life.arrest = null;
    life.alarm = Math.max(life.alarm, ALARM);
    /* The DURABLE number — see the accessor in `dressStationLife`. */
    life.standing -= hurt * 2;
    world.notify?.('SECURITY CALLED', 'the nearest patrol is on its way');
  }
  if (life.alarm > 0) {
    life.alarm -= dt;
    /* Two guards, which is the patrol unit `faction.py` states — "a patrol
     * unit is two, always". A pair that has been cut down is replaced while
     * the alarm runs, which is the same sentence: the NEAREST guards come. */
    if (life.guards.length === 0 && life.alarm > ALARM - GUARD_REACH) dispatch(world, st, life);
    stepGuards(world, st, life, dt);
    if (life.alarm <= 0) standDown(world, life);
  }
  /* AND THE CELL, WHICH IS A DIFFERENT WORLD FROM MOST DECKS — see below. */
  deliverToBrig(world, st, life);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PATROL — §11's "come", which is a verb of arrival                      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THEY WERE DELETED BEFORE THEY COULD REACH YOU ═════════════════════════
 *
 * The guards were spawned at the security post (#24) and removed the frame a
 * hard-coded 12 s alarm expired. Measured, cutting a resident in the Concourse
 * — the SAME DECK as the post, which is the best case this code had:
 *
 *     0s   guards 2  alarm 12.0  nearest 47.4 m
 *     10s  guards 2  alarm  2.4  nearest 45.0 m
 *     15s  guards 0  alarm    0   (deleted)
 *     closest approach over the whole alarm: 43.1 m
 *
 * They spawn 47 m off and are given 12 s. At any pace a person walks that is
 * not slow, it is IMPOSSIBLE — and §5.3's own gate is "attacking a resident
 * summons a guard within 10 s". Off deck 40 it was worse than impossible: the
 * post is a deck-40 room, so `floorOf(PLACE.get(24))` is `DECK_Y[40] = 0`
 * unconditionally, and a player who cut somebody in the Reactor hall (deck 48,
 * y = 25) got two guards standing 25 m BELOW HIS FEET on another deck, where
 * they stayed until they were deleted.
 *
 * ── SO THE PATROL IS GIVEN A DISTANCE IT CAN CROSS, AND IT CROSSES IT ─────
 *
 * `GUARD_FROM` is 22 m and `GUARD_PACE` is 3.6 m/s: 6.1 s from the doorway to
 * your collar, inside §5.3's ten. They come onto the PLAYER'S deck, from a
 * piece of that deck's own floor — the door of the room you are in, or the
 * walkway you are standing on, a fixed distance round it on the side the
 * nearest junction is; see `patrolFrom`, which is where the geometry is
 * argued. The alternative was a longer alarm, which is a patrol that is still
 * not coming, only for longer.
 *
 * THEY ARE DRIVEN AND NOT BRAINED, exactly as the residents on the walkways
 * are driven by `stepWalkers`: `Enemy` has no `brain` field at all (see
 * `World.pickTarget`'s note), and what the old code was actually relying on
 * was a duel brain circling at its archetype's `preferred` band — which is
 * why the two bodies it spawned closed four metres in twelve seconds. A march
 * on the player at a fixed pace is the behaviour §11 describes, it is
 * measurable to the metre, and `consequence.mjs` measures it.
 */
const ALARM = 20;
/** How long the dispatch window stays open inside the alarm, in seconds. */
const GUARD_REACH = 12;
/** Metres they come in from. */
const GUARD_FROM = 22;
/** A duty jog. 22 m at this is 6.1 s — §5.3 allows ten. */
const GUARD_PACE = 3.6;
/** Hands on you — and, when a crowd is in the way, boxed in for this long. */
const GUARD_GRAB = 2.2, GUARD_HOLD = 5, GUARD_HOLD_FOR = 1.5;
/** How far apart the pair walks. */
const GUARD_ABREAST = 0.9;
/**
 * WHAT A STATION GUARD IS. `res_human` is the resident chassis every body in
 * the drum is built on, and the ARC kit is the one armour row in `Bodies.js`
 * that carries TWIN HOLSTERED SIDEARMS on the belt — so §11's "real, armed
 * bodies" is a body you can walk up to with the weapons visible on it, and
 * not the 1050 hp IG bodyguard BOSS this used to spawn, whose arrival ran the
 * boss cinematic ("IT HAS COME FOR YOU") over a shoplifting.
 */
const GUARD_KIT = { id: 'arc', helmet: true, plate: 'slate', accent: 'sun', visor: 'char' };
/** §11's cell, the deck it is on, and how long you are in it. */
const BRIG = 47, BRIG_DECK = 48, BRIG_HOURS = 6;

/**
 * The floor a patrol stands on: this deck's, unless the player is well off it
 * — see `stepGuards`. One rule, so the pair is never put down on a plane the
 * march then has to correct.
 */
function guardY(st, p) {
  const deckY = DECK_Y[st.deck] ?? 0;
  return Math.abs((p?.y ?? deckY) - deckY) > 3 ? p.y : deckY;
}

/** Is this position inside a place's footprint? `Station.placeUnder`'s own two
 * lines, on one room rather than on all of them. */
function inRoom(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(-p.yaw), sn = Math.sin(-p.yaw);
  const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
  return Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2;
}

/** The room a position is standing IN, or null for a corridor. */
function roomAt(deck, x, z) {
  for (const p of placesOn(deck)) if (inRoom(p, x, z)) return p;
  return null;
}

/**
 * Where a patrol comes onto this deck from. Writes `out`, returns the metres.
 *
 * ── AND A STRAIGHT LINE TO YOU IS NOT A PLACE A BODY CAN STAND ───────────
 *
 * The first cut of this took the nearest patrol door — the security post, or
 * a ring junction — and slid the spawn along the line to the player until it
 * was inside `GUARD_FROM`. Measured on deck 40, player on the balcony at
 * r = 24: the post is at bearing 62° on the ATRIUM band, so the line to it
 * crossed the middle of the deck and the pair was put down at r ≈ 10 —
 * INSIDE THE ATRIUM VOID, an 18 m hole through three decks. They then walked
 * outward and stopped dead at r = 17.6 against the lip:
 *
 *     t=2s nearest 8.4 m   t=3s 6.5 m   t=16s 6.5 m   (never arrived)
 *
 * A spawn point is not a distance, it is a piece of floor. So the origin is
 * taken from the drum's own geometry instead, and there are exactly two cases
 * because the drum has exactly two kinds of standing place:
 *
 *   IN A ROOM — they come from the corridor OUTSIDE ITS DOOR, and `stepGuards`
 *     walks them to the door before it walks them to you. Every room on the
 *     station opens onto a walkway (§3.1's "every place reachable on foot"),
 *     so that point is floor by construction.
 *   ON A WALKWAY — they come along the player's OWN annulus: same radius, an
 *     arc of `GUARD_FROM` away, on the side the nearest junction is. The ring,
 *     the balcony and the spines are all annuli and a body on one of them can
 *     always walk along it, which is the property the straight line did not
 *     have.
 */
function patrolFrom(st, px, pz, y, out) {
  const room = roomAt(st.deck, px, pz);
  if (room) {
    /**
     * AT THE ROOM'S OWN DOOR, and not a step past it. `door` is the
     * gazetteer's world-space threshold (see `Station.placeUnder`), and a
     * threshold is floor; two and a half metres BEYOND it is whatever is on
     * the other side, which on #9 The Concourse — whose door faces inboard at
     * r = 19.4 — is the atrium void, and the pair stood on the lip at r = 17.6
     * for the whole alarm.
     *
     * A room is a rectangle and the player is inside it, so the segment from
     * the door to the player is inside it too: a long room (the Concourse is
     * 35 m deep) starts the march part-way along that segment rather than
     * giving the patrol more ground than §5.3's ten seconds can cover.
     */
    let ox = room.door[0], oz = room.door[1];
    const dx = px - ox, dz = pz - oz;
    const d = Math.hypot(dx, dz) || 1;
    if (d > GUARD_FROM) { const k = (d - GUARD_FROM) / d; ox += dx * k; oz += dz * k; }
    out.set(ox, y + 0.1, oz);
    return Math.min(d, GUARD_FROM);
  }
  const r = Math.hypot(px, pz);
  if (r < 1) { out.set(px + GUARD_FROM, y + 0.1, pz); return GUARD_FROM; }
  const a = Math.atan2(px, pz);
  /* WHICH SIDE THEY COME FROM: the nearest junction's, so a patrol arrives
   * from a crossing rather than out of the wall behind you. */
  let side = 1, best = Infinity;
  for (const j of junctionsOn(st.deck)) {
    let d = (j.at * Math.PI / 180) - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < best) { best = Math.abs(d); side = d < 0 ? -1 : 1; }
  }
  const swept = Math.min(GUARD_FROM / r, Math.PI / 3) * side;
  out.set(r * Math.sin(a + swept), y + 0.1, r * Math.cos(a + swept));
  return Math.min(GUARD_FROM, Math.abs(swept) * r);
}

/** Two guards, put down on the player's own deck. */
function dispatch(world, st, life) {
  const p = world.player?.position;
  if (!p || !world.spawnEnemy) return;
  const at = patrolFrom(st, p.x, p.z, guardY(st, p), _v2);
  for (let g = 0; g < 2; g++) {
    /* Abreast across the line they are walking in on. */
    const s2 = g ? GUARD_ABREAST : -GUARD_ABREAST;
    const dx = p.x - _v2.x, dz = p.z - _v2.z;
    const d = Math.hypot(dx, dz) || 1;
    _v.set(_v2.x - (dz / d) * s2, _v2.y, _v2.z + (dx / d) * s2);
    let b = null;
    try {
      b = world.spawnEnemy('res_human', _v.clone(), {
        team: world.player?.team ?? 0, armour: GUARD_KIT,
      });
    } catch {}
    if (!b) continue;
    b.stationGuard = true;
    /* THE SAME TWO MARKS EVERY BODY IN THE DRUM CARRIES. `stationResident` is
     * what `World.pickTarget` reads to refuse a target — a guard that opened
     * fire would be a firefight, and §11's sentence is an ARREST — and
     * `noAmbientHarm` is what stops a crowd billing the player for the pair
     * shouldering through it. `stationName` is deliberately NOT set: the
     * witness loop above blames the player for hurt RESIDENTS, and a patrol
     * that counted as one would call itself. */
    b.stationResident = true;
    b.noAmbientHarm = true;
    life.guards.push(b);
  }
  life.guardNear = at;
}

/** One frame of the march, and the frame it ends in an arrest. */
function stepGuards(world, st, life, dt) {
  const p = world.player?.position;
  if (!p || !life.guards.length) return;
  /**
   * THE FLOOR THEY WALK ON IS THIS DECK'S — the whole of the second half of
   * the old defect, which took `floorOf(PLACE.get(24))` and therefore deck
   * 40's zero on every deck. `guardY` follows the PLAYER when the player is
   * well off the deck plane (a catwalk in the Reactor hall): a patrol that
   * walks the floor while you are twenty metres over it is the same "they
   * never arrive" wearing a different hat.
   */
  const y = guardY(st, p);
  const room = roomAt(st.deck, p.x, p.z);
  let near = Infinity;
  for (let i = 0; i < life.guards.length; i++) {
    const g = life.guards[i];
    if (!g?.position) continue;
    if (g.dead || g.alive === false) continue;
    const s2 = i ? GUARD_ABREAST : -GUARD_ABREAST;
    const dx = p.x - g.position.x, dz = p.z - g.position.z;
    const d = Math.hypot(dx, dz) || 1;
    /* The point a stride to one side of you, so the pair arrives as a pair
     * rather than as two bodies inside one another. */
    let tx = p.x - (dz / d) * s2, tz = p.z + (dx / d) * s2;
    /* THE DOOR FIRST, IF YOU ARE IN A ROOM. A guard walking at the player
     * through the wall of a shop is stopped by the wall — measured, at the
     * atrium's lip, 6.5 m short for the whole alarm — so the march has two
     * legs whenever the player is inside a footprint and the guard is not. */
    if (room && !inRoom(room, g.position.x, g.position.z)
        && Math.hypot(g.position.x - room.door[0], g.position.z - room.door[1]) > 1.2) {
      tx = room.door[0]; tz = room.door[1];
    }
    const mx = tx - g.position.x, mz = tz - g.position.z;
    const md = Math.hypot(mx, mz);
    if (md > 1e-4) {
      /**
       * THE VELOCITY IS THE MARCH, and the engine walks them.
       *
       * `Enemy.update` ends in `position.addScaledVector(this.velocity, dt)`
       * and then resolves the step against the world — so a hand-written
       * position step AND a velocity for the gait is the same metre walked
       * twice: measured, the pair closed 18.9 m in 2.8 s against a declared
       * 3.6 m/s. Handing over the velocity alone is one metre per metre, it
       * animates (the gait reads the same field), and it is the engine's own
       * collision that decides what happens when a body meets a wall rather
       * than an assignment that ignores one.
       */
      const want = Math.min(GUARD_PACE, md / Math.max(dt, 1e-3));
      if (g.velocity) g.velocity.set((mx / md) * want, g.velocity.y, (mz / md) * want);
      g.facing = Math.atan2(mx, mz);
    }
    /* AND THEY WALK ON THE PLAYER'S DECK. This is the line the old code could
     * not have: it took the post's floor, which is deck 40's, always — 25 m
     * under the feet of anyone on the working deck. */
    if (Math.abs(g.position.y - (y + 0.1)) > 0.4) g.position.y = y + 0.1;
    g.body?.setTransform?.(g.position, null);
    near = Math.min(near, Math.hypot(p.x - g.position.x, p.z - g.position.z));
  }
  life.guardNear = near;
  /**
   * ── HANDS ON YOU, OR CORNERED ────────────────────────────────────────
   *
   * Two metres is arm's length and it is not always reachable: bodies have
   * capsules, a busy room has thirty of them, and measured in the Reactor
   * hall the pair closed to 3.4 m through the shift and could get no nearer.
   * A consequence that a crowd can cancel is not a consequence, so being
   * BOXED IN — both of them inside `GUARD_HOLD` for a second and a half — is
   * the same arrest. It cannot fire at range: 5 m is close enough that the
   * player can see who has them.
   */
  life.guardHold = near <= GUARD_HOLD ? (life.guardHold || 0) + dt : 0;
  if (near <= GUARD_GRAB || life.guardHold >= GUARD_HOLD_FOR) arrest(world, st, life);
}

/** The patrol stands down and goes away again. */
function standDown(world, life) {
  for (const g of life.guards) removeBody(world, g);
  life.guards.length = 0;
  life.guardNear = Infinity;
  life.guardHold = 0;
}

/**
 * ══ "YOU WAKE IN THE BRIG (#47)" ══════════════════════════════════════════
 *
 * It was not implemented at all: `grep -rni brig src/` answered with the plan
 * row that builds the room and a comment quoting §11. The guards arriving had
 * no consequence, so the sentence stopped at a body walking up to you.
 *
 * WHAT AN ARREST IS, in order: the patrol lets go of the deck, six station
 * hours pass in the cell (`passStationHours`, the same door a run comes home
 * through, so the clock and the day both move), the counters shut for the day
 * after the one you were taken on, and you are put in #47.
 *
 * ── AND THE CELL IS ON ANOTHER DECK, WHICH IS ANOTHER WORLD ───────────────
 *
 * The Brig is on deck 48 and `main.js` builds one world per deck, so an arrest
 * made on the Concourse cannot simply move the player: the room is not in the
 * scene. The transfer therefore goes through `world.onDeckLift` — the SHIPPED
 * door, the one the lift's own button column calls, which tears the world down
 * and builds deck 48 — and `StationSave.brig` carries the arrest across it,
 * because the run bag does not survive a deck change (that is the same fact
 * that made standing two numbers). `deliverToBrig` is the far side.
 */
function arrest(world, st, life) {
  if (life.arrest) return;
  life.arrest = { deck: st.deck, hour: st.hour, at: st.deck === BRIG_DECK ? 'here' : 'transfer' };
  life.alarm = 0;
  standDown(world, life);
  /* A GUEST'S CLOCK IS NOT A GUEST'S SAVE — `tickStationClock` argues this at
   * length for the same fold. A joined player's hour is the host's. */
  if (world.netMode !== 'client') {
    st.hour = passStationHours(BRIG_HOURS);
    st._savedHour = st.hour | 0;
    st.day = stationDay(st.hour);
    /* AFTER the hours, so sleeping through a midnight does not serve the ban
     * out: the shutter comes up on the day after the one you woke on. */
    shutKiosks(1);
    setBrigPending(true);
  }
  world.notify?.('ARRESTED', 'the patrol has you — you wake in the Brig');
  if (st.deck !== BRIG_DECK) {
    try {
      world.onDeckLift?.({ n: BRIG_DECK, label: 'BRIG', level: 'station', deck: BRIG_DECK, shaft: 'atrium' });
    } catch {}
  }
}

/** Put the player on the bench in #47. True if they were moved. */
function putInCell(world, st) {
  const cell = PLACE.get(BRIG);
  const p = world.player;
  if (!cell || !p?.position) return false;
  /* A slot in the cell ring, off `slotIn` — the same deterministic scatter
   * every body in every room on the station is placed by. */
  slotIn(cell, 3, _v);
  _v.y = floorOf(cell) + 0.1;
  p.position.copy(_v);
  p.actor?.setPosition?.(_v);
  if (p.velocity) p.velocity.set(0, 0, 0);
  p.fallSpeed = 0;
  p._sweepFromY = _v.y;
  /* Facing the guard desk in the middle of the ring, which is what you wake
   * looking at. */
  if (p.camera) p.camera.yaw = Math.atan2(cell.x - _v.x, cell.z - _v.z);
  return true;
}

/** The far side of the transfer, and of an arrest made on deck 48 itself. */
function deliverToBrig(world, st, life) {
  if (st.deck !== BRIG_DECK || !brigPending()) return;
  /* NOT UNTIL THE DECK IS BUILT. `dressStation` leaves the heavy half of the
   * build on `st.pending` and `drainStationBuild` spends it over the frames
   * after the world is live — putting the player down in a room that has no
   * floor yet is a fall through the drum. */
  if (st.pending?.length) return;
  if (!putInCell(world, st)) return;
  setBrigPending(false);
  life.arrest = life.arrest || { deck: st.deck, hour: st.hour, at: 'woke' };
  life.arrest.woke = true;
  world.notify?.('THE BRIG', 'you wake in the cell block — the counters are shut');
}

/**
 * Do the kiosks serve you? §11: *"the kiosks refuse you for a day"*, and both
 * halves of that are now real. The standing gate is the old one — a number
 * this station can actually reach, which `reachable.mjs` drives — and the DAY
 * is `StationSave.shut`, set by the arrest and read against the stored
 * midnight counter. Before this, "for a day" meant "until you collect three
 * jobs", which is not a duration.
 */
export function servedHere(world) {
  const life = world?._stationLife;
  if (!life) return true;
  if (!(life.standing > -6)) return false;
  return !kiosksShut();
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE TRAM — §3.1 rule 3, and it carries people                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The four stops, in the order the loop passes them. §3.2 #40 and its three. */
export const STOPS = [40, 40.2, 40.3, 40.4];
/** Seconds between stops. §3.2: "trams every 90 s". */
const TRAM_LEG = 22.5;
/** How far along a leg a faulted car stands — far enough out of the platform
 *  it just left that nobody can step onto it. See `stepTram`. */
const STALL_AT = TRAM_LEG * 0.3;

function stepTram(world, st, life, dt) {
  const t = life.tram;
  /**
   * ══ §3.4'S TRAM FAULT, AND IT IS THE LOOP THAT STOPS ══════════════════
   *
   * *"TRAM FAULT — the loop is down"* stopped nothing: the row set a field
   * with no reader anywhere in `src/`, and the car went on running its
   * ninety-second circuit past the promenade glass while the banner said the
   * loop was down. This is the reader — the clock stops, `at` stops advancing,
   * and the crowds the row sends walking (`stir`) are walking because there
   * is no tram.
   *
   * TWO THINGS THE FAULT MAY NOT DO, AND BOTH ARE SOMEBODY ELSE'S PROPERTY.
   *
   * It may not throw a passenger off between platforms. §3.1 rule 3's *"cars
   * you can ride"* is a ride that ENDS, and `Station.stepTramRide` sets a
   * rider down when the car reaches the next stop — so a car stopped mid-leg
   * with somebody aboard is a player standing on a box 97 m outside the drum
   * for as long as the fault runs. A car that is carrying somebody finishes
   * its leg, and the loop goes down behind it.
   *
   * And it may not stall INSIDE the window `Station.tramAtStop` counts as
   * standing at a platform. A car nobody can board is what "the loop is down"
   * means: what the fault leaves on the guideway is a stalled car a short way
   * out of the stop it last left, not a car sitting at a platform with its
   * doors open that never leaves.
   */
  const halt = !!life.event?.halt && !world._tramRide;
  if (!(halt && t.faulted)) {
    t.t += dt;
    while (t.t >= TRAM_LEG) { t.t -= TRAM_LEG; t.at = (t.at + 1) % STOPS.length; }
    if (halt && t.t >= STALL_AT) t.faulted = true;
  }
  if (!life.event?.halt) t.faulted = false;
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
 * ══ TEN ROWS THAT WERE TEN BANNER LINES ═══════════════════════════════════
 *
 * §3.4 asks for events "a player can go and look at", and the comment over
 * this table has claimed since it was written that *"every row is something a
 * player can go and look at rather than a line of text on its own."* It was
 * not true of a single one of them. Measured by grep across `src/`:
 *
 *     life.event   written by `stepEvents`, READ NOWHERE
 *     life.dip     written by `stepEvents`, decayed by the step, READ NOWHERE
 *     headcount(place, hour)   took no event, so MARKET DAY added nobody
 *
 * "REACTOR SURGE — the lights dip across the drum" dipped no light, because
 * the number it set had no reader in any file; "MARKET DAY — the Concourse is
 * at its fullest" left the Concourse at exactly the headcount it holds on any
 * other Tuesday; "the crowds are walking" moved nobody. Ten `world.notify`
 * calls and a table of prose.
 *
 * ── WHAT A ROW IS NOW ────────────────────────────────────────────────────
 *
 * The row IS the effect. Four fields, and each is read by a system that was
 * already in this file rather than by a parallel one built for the table:
 *
 *   `mins`  how long it runs, in STATION minutes. The clock is one game hour
 *           per two real minutes (`Station.tickStationClock`), so a station
 *           minute is `MINUTE` real seconds and "ten minutes" in a row means
 *           ten minutes of the station's day.
 *   `fill`  place id → how many extra people are IN that place while it runs.
 *           `headcount` adds it, so the re-seat that spends the pool and the
 *           desire lines a walker picks a destination on BOTH see it — see
 *           `runningEvent` for why it is read there rather than passed.
 *   `stir`  how many people who are standing get up and walk, and `stirIn`
 *           says out of where. It is `setOut` — the walker this file already
 *           has — handed a body that was standing; `stepWalkers` then drives
 *           it exactly as it drives a body that spawned on an open stretch.
 *   `dim`   how far the drum's lights go down, 0..1. `stepDip` is the reader
 *           and it drives the deck's OWN three-light rig and the deck's own
 *           emissive materials (§9.1: no eleventh material for an event).
 *   `halt`  the tram loop stops. `stepTram` is the reader.
 *
 * ── AND THREE ROWS PROMISED SOMETHING THE STATION CANNOT DO ──────────────
 *
 * A table that lies is worse than a shorter table, so those three say what
 * they deliver now:
 *
 *   CRASH CART. It said *"running for the flight deck"*. The flight deck is
 *   #1/#5 on decks 32 and 12; the Medbay is #43 on deck 48. A walker's route
 *   is `planRoute`, which is arcs and radials on ONE deck's annuli — there is
 *   no route between decks for anybody but the player and his lift. The ward
 *   getting up and going is real; the destination was not.
 *
 *   THE BRAWL. It said *"the guards are already moving"*. The only guards on
 *   this station are §11's arrest patrol, and `dispatch`/`stepGuards` march
 *   them at the PLAYER and put him in the cell block when they reach him.
 *   Sending them to a bar fight would either arrest a bystander for it or be
 *   a second guard system beside the one that means something. The cantina
 *   coming off its stools is real; the guards were not.
 *
 *   THE MEMORIAL. It said *"is being read"*. Nothing on this station reads
 *   anything aloud — there is no speech for a resident anywhere in the file.
 *   The chapel filling is real; the reading was not.
 *
 *   THE LAUNCH CYCLE. It said the three flight rooms *"all move at once"*, and
 *   this one was measured rather than reasoned about: on deck 12, standing at
 *   the Cobra bay at 11:00 with the pool full, **45 bodies, 38 of them seated
 *   on the deck's own walk slots, and 0 with a planned route**; deck 32 reads
 *   23 of 37 and the same nought. `destsOn`/`planRoute` are the drum's ring,
 *   balcony and spines, and the two flight decks have none of the three — so
 *   NOBODY WALKS ON A FLIGHT DECK, event or no event. That is the walkway
 *   lane's to answer and not this table's; what this row may honestly say is
 *   that the three rooms are crewed, which is what the fill does.
 */
export const EVENTS = [
  {
    id: 'shuttle', at: 8, place: 8, mins: 25,
    /* #7 Arrivals hall (24 heads) is the hall that fills; #8 is the collar it
     * comes off. Both, because the row names the collar and the say names the
     * hall, and a player standing in either should see it. */
    fill: { 7: 14, 8: 6 },
    say: ['ARRIVALS', 'a shuttle is on the collar — the hall fills'],
  },
  {
    id: 'crashcart', at: null, place: 43, mins: 12,
    fill: { 43: 4 }, stir: 4, stirIn: [43, 44],
    say: ['MEDBAY', 'a crash cart is out — the ward is up and moving'],
  },
  {
    id: 'brawl', at: 21, place: 14, mins: 15,
    fill: { 14: 8 }, stir: 5, stirIn: [14],
    say: ['THE LONG NIGHT', 'a brawl — the cantina is off its stools'],
  },
  {
    id: 'market', at: 10, place: 9, mins: 55,
    /* §3.2 #9 declares 80 heads and §3.3 calls it *"where the game's whole
     * cast is seen at once"*. Twenty-six more is a third again on the fullest
     * room on the station, and the ring outside it fills with the walk to it
     * through `pickDest`, which weights a destination by its headcount. */
    fill: { 9: 26, 7: 6 }, stir: 4, stirIn: 'deck',
    say: ['MARKET DAY', 'the Concourse is at its fullest'],
  },
  {
    id: 'memorial', at: 17, place: 22, mins: 45,
    fill: { 22: 10 },
    say: ['THE CHAPEL', 'a memorial — the mats are filling'],
  },
  {
    id: 'drill', at: 11, place: null, mins: 10,
    /* Place null: it is *"every deck"*, so the stir is the whole deck the
     * player is on rather than one room's doorway. */
    stir: 14, stirIn: 'deck',
    say: ['FIRE DRILL', 'every deck, ten minutes — the halls empty into the corridors'],
  },
  {
    id: 'surge', at: null, place: 48, mins: 6,
    dim: 0.55,
    say: ['REACTOR SURGE', 'the lights dip across the drum'],
  },
  {
    id: 'tramfault', at: null, place: 40.2, mins: 30,
    halt: true, stir: 10, stirIn: 'deck', fill: { 40.2: 8 },
    say: ['TRAM FAULT', 'the loop is down — the crowds are walking'],
  },
  {
    id: 'drazifight', at: 15, place: 35, mins: 20,
    fill: { 35: 8 }, stir: 4, stirIn: [35],
    say: ['THE DRAZI QUARTER', 'green and purple, again — the quarter is out watching'],
  },
  {
    id: 'launch', at: 9, place: 5, mins: 40,
    /* #5 Cobra bay, #2 Deck control tower, #3 Pilots' ready room — the three
     * rooms the say names, and they are on two DIFFERENT decks, which is
     * exactly why the fill is a place table and not a place.
     *
     * AND NO STIR. See the fourth entry in the note above: nobody walks on
     * decks 12 or 32 at all, so a row promising movement there would be a row
     * promising a thing the deck cannot do. */
    fill: { 5: 4, 2: 4, 3: 6 },
    say: ['LAUNCH CYCLE', 'the Cobra bay, the tower and the ready room are all crewed at once'],
  },
];

/**
 * ══ WHAT IS HAPPENING ON THE STATION RIGHT NOW ════════════════════════════
 *
 * The running row, held at module scope, and `life.event` is an ACCESSOR onto
 * it — the same shape `life.standing` has, and for the same reason: two copies
 * of one fact is how the two `standing`s got out of step.
 *
 * IT IS MODULE STATE BECAUSE `headcount` HAS NO WORLD. The row's `fill` has to
 * reach the pool's re-seat (which seats bodies), the walker's `pickDest`
 * (which weights a destination by how busy it is) and the pit's roster — three
 * callers in two files, none of which is handed a `life`, and one of which is
 * a loop over the whole gazetteer. Growing an argument on forty call sites to
 * carry one fact about the station's clock is how a table like this ends up
 * with a parallel copy of the census. `hour` is passed because a caller may
 * legitimately ask about a different hour; nobody may legitimately ask about a
 * different NOW, so the now is a default and never a parameter a caller has to
 * remember. `headcount(p, h, null)` is the plain gazetteer number for anything
 * that wants it — `census` is one, and `stationlife.mjs` reads both.
 */
let _event = null;

/** The event row running this minute, or null. Exported for the check. */
export function runningEvent() { return _event; }

/** One station minute, in real seconds: the clock is one game hour per two
 *  real minutes (§3.4, `Station.tickStationClock`). */
const MINUTE = 2;

/** The gap between one event ending and the next beginning, in real seconds.
 *  `stationlife.mjs` reads it and holds the table to the rate it implies. */
export const EVENT_GAP = { min: 45, span: 60 };

/**
 * ══ THE LIGHTS, AND THE ONE NUMBER THAT MOVES THEM ════════════════════════
 *
 * `life.dip` had no reader in any file. This is it, and what it drives is the
 * rig `Station.lightStation` already built — the deck's key, its ambient and
 * its hemisphere fill — plus the three EMISSIVE materials out of `st.mats`,
 * because on a station lit largely by its own strip lighting a dip that left
 * every strip at full brightness would not read as a dip at all.
 *
 * §9.1 HOLDS DURING A SURGE. Nothing here makes a material or a light; it
 * scales the ones the deck was built with and puts them back, which is the
 * same argument `orderJump`'s transit amber makes one function along.
 *
 * ONE COMPARE A FRAME when nothing is dipping, which is nearly always.
 */
const DIP_MATS = ['strip', 'status', 'screen'];
function stepDip(st, life) {
  const rig = st.rig;
  if (!rig) return;
  const k = 1 - Math.max(0, Math.min(1, life.dip));
  if (rig.lit === k) return;
  rig.lit = k;
  rig.key.intensity = rig.base[0] * k;
  /* The ambient and the fill keep a floor: a drum at a dead stop with no
   * ambient at all is a black screen, and §3.4 asks for a dip. */
  rig.amb.intensity = rig.base[1] * (0.3 + 0.7 * k);
  rig.fill.intensity = rig.base[2] * (0.3 + 0.7 * k);
  const M = st.mats;
  if (!M) return;
  for (let i = 0; i < DIP_MATS.length; i++) {
    const m = M[DIP_MATS[i]];
    if (!m) continue;
    if (m.userData.dip0 === undefined) m.userData.dip0 = m.emissiveIntensity;
    m.emissiveIntensity = m.userData.dip0 * (0.2 + 0.8 * k);
  }
}

/** Does this row move the people standing in `id`? */
function stirsIn(e, id) {
  const where = e.stirIn;
  if (!where || where === 'deck') return true;
  for (let i = 0; i < where.length; i++) if (where[i] === id) return true;
  return false;
}

/**
 * ══ PEOPLE GET UP AND GO ══════════════════════════════════════════════════
 *
 * *"the crowds are walking"*, *"the halls empty into the corridors"*, *"the
 * ward is up and moving"*. All three are ONE thing: a body that was standing
 * at a counter becomes a body with somewhere to be.
 *
 * AND IT IS `setOut`, NOT A SECOND WALKER. The fields written here are the
 * eight `spawnResident` writes on a body seated on an open stretch, and the
 * last line is the same `setOut` call it makes. From the next frame the body
 * is driven by `stepWalkers`, culled by `WALK_DROP` and re-planned by
 * `pickDest` like every other walker in the drum — there is no second step, no
 * second route and no second cull.
 *
 * ONE PASS OVER THE POOL, ONCE, on the frame the event fires. Sixty bodies and
 * a `setOut` each for at most `stir` of them; it is not a per-frame cost and
 * it is not in the steady step the budget is measured on.
 */
function stir(st, life, e) {
  const n = e.stir | 0;
  if (!n) return 0;
  let done = 0;
  for (const body of life.live.values()) {
    if (done >= n) break;
    /* Already walking, never walks (§3.3's Vorlon), or not a body that is
     * standing at all — a ragdoll, a corpse or a witness the player made. */
    if (!body || body.wayR || body.standX === undefined || body.standStill) continue;
    if (body.__stationTouched || body.alive === false || body.dead) continue;
    if (!stirsIn(e, body.stationPlace)) continue;
    const x = body.position?.x ?? 0, z = body.position?.z ?? 0;
    const r = Math.hypot(x, z);
    if (!(r > 1)) continue;
    body.wayAngle = Math.atan2(x, z);
    body.wayR = r;
    body.wayPace = 0.86 + ((body.stationPlace * 7 + body.stationSlot * 13) % 29) / 100;
    body.waySeedA = Math.round((body.stationPlace | 0) * 10);
    body.waySeedB = (body.stationSlot | 0) * 7 + 3;
    body.wayLegs = null;
    body.wayAt = 0; body.wayT = 0; body.wayTo = 0; body.wayTrips = 0; body.wayDwell = 0;
    if (setOut(life.deck, st.hour, body)) { body.stationStir = true; done++; }
    else { body.wayR = 0; body.wayLegs = null; }
  }
  return done;
}

/**
 * The event is over: the row is put down, and everybody it moved goes back to
 * standing where the gazetteer says they stand. `standHere` is the same
 * function `spawnResident` seats a resident with — what is overridden after it
 * is only where the body IS, so a man who walked forty metres walks back
 * rather than snapping to his slot on the frame the drill ends.
 */
function calm(life) {
  const was = _event;
  life.event = null;
  life.eventFor = 0;
  if (!was?.stir) return;
  for (const body of life.live.values()) {
    if (!body?.stationStir) continue;
    body.stationStir = false;
    if (body.__stationTouched || body.alive === false || body.dead) continue;
    const p = PLACE.get(body.stationPlace);
    if (!p) continue;
    body.wayR = 0; body.wayLegs = null; body.wayDwell = 0;
    /* `standHere` reads x and z off this and nothing else — a body's height is
     * the deck's and a walker never changed it. */
    slotIn(p, body.stationSlot | 0, _v);
    standHere(body, p, _v);
    /* Where he actually is, so the walk home is a walk. */
    if (body.position) { body.standCx = body.position.x; body.standCz = body.position.z; }
  }
}

function stepEvents(world, st, life, dt) {
  /* ── THE ONE THAT IS RUNNING, AND THE MINUTE IT STOPS ─────────────────── */
  if (life.eventFor > 0) {
    life.eventFor -= dt;
    /* A surge is not a level: the drum browns out and comes back and goes
     * again. Seeded on the event's own clock rather than on `Math.random`,
     * which `determinism.mjs` forbids in `src/` and which would put two
     * machines in a co-op session in two different rooms. */
    const dim = _event?.dim;
    if (dim) life.dip = dim * (0.72 + 0.28 * Math.sin(life.eventFor * 7.3));
    if (life.eventFor <= 0) calm(life);
    return;
  }
  life.eventIn -= dt;
  if (life.eventIn > 0) return;
  life.eventIn = EVENT_GAP.min + h2(Math.floor(st.hour * 4), 11) * EVENT_GAP.span;
  const hour = Math.floor(st.hour);
  /* An event whose hour has come, else one of the hourless ones. */
  const timed = EVENTS.filter((e) => e.at === hour);
  const pool = timed.length ? timed : EVENTS.filter((e) => e.at === null);
  if (!pool.length) return;
  const e = pool[Math.floor(h2(hour, life.spawned) * pool.length) % pool.length];
  life.event = e;
  life.eventFor = (e.mins || 20) * MINUTE;
  if (e.dim) life.dip = e.dim;
  stir(st, life, e);
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

/**
 * How far a walker may get from the player before the pool stops paying for
 * it — `DROP_RADIUS`, the same distance every other resident is dropped at,
 * measured against where the BODY is rather than where its slot is.
 *
 * There is no hysteresis on it and there must not be: the whole point of the
 * wider drop radius is that a body on the boundary is not spawned and
 * despawned every frame, and a walker cannot oscillate across a boundary it is
 * walking away from. What it does instead is RECYCLE — the slot it left is
 * inside the live radius, so the next re-seat puts a fresh walker in it, and
 * the corridor is a flow rather than a fixed cast.
 */
const WALK_DROP = DROP_RADIUS;

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
  if (!life.wantPets.length) return false;
  const m = companionsNow();
  if (!m) return false;
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
    /* THE SAME EXEMPTION ITS HANDLER HAS. `Impact.kineticContact`'s
     * `noAmbientHarm` is the station's rule that an unauthored contact — a
     * crowd, a door, a passing droid — does not hurt anybody; an animal at
     * heel in that crowd is in exactly the position the rule was written for.
     * Without it a dog walked through a market is worn down by the market. */
    pet.noAmbientHarm = true;
    /**
     * ══ AND IT DOES NOT BILL THE CONCOURSE FOR WALKING INTO IT ════════════
     *
     * `noAmbientHarm` above is the VICTIM's half of the station's rule —
     * `Impact.kineticContact`'s own note, "the station is not a battlefield".
     * This is the STRIKER's half, and the animal is the only body on the drum
     * that needs it: `Enemy` arms every body with `KINETIC_BODY`, whose
     * `jostle` floor of 1.5 refuses anything under a real blow, and a resident
     * at `WALK_PACE` prices at 0.11 — while a massiff at heel was MEASURED at
     * 5.07 m/s keeping up with its handler, which is twenty-five times the
     * energy and clears the floor. A dog trotting after somebody through a
     * market is not a charge.
     *
     * IT ALSO ROUTES ROUND A LIVE CRASH, and that is worth writing down rather
     * than quietly enjoying. `Impact.kineticContact` reads
     * `victim.noAmbientHarm` THREE LINES ABOVE its own `if (!victim)` guard —
     * `Impact.js:349` — so any armed body that clears the jostle floor against
     * ARCHITECTURE (victim null: a wall, the ground) throws
     * `TypeError: Cannot read properties of null`. Measured on deck 40 at
     * high quality: the world died on frame 98 the moment the first animal was
     * fielded. The fix is one line in that file — the `noAmbientHarm` test
     * belongs BELOW the null guard, not above it — and it is not this lane's
     * to make. Nor is it only this file's problem: `Player` and `DeckCast` arm
     * their bodies with the same tune, so anything of theirs that clears the
     * jostle floor against architecture takes the same throw. Disarming the
     * animal is right on its own terms and is NOT a fix for that.
     */
    disarmKinetic(pet.body);
    pet.stationName = H.animal;
    /* An animal at heel is a resident too. */
    pet.noAmbientHarm = true;
    pet.stationRole = `${H.kind} — ${H.who}'s`;
    pet.stationPlace = body.stationPlace;
    body._stationAnimal = pet;
    return true;
  } catch { /* no animal is a quieter failure than no resident */ }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PEOPLE WHO ARE NOT GOING ANYWHERE                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ A ROOM FULL OF PEOPLE MUST NOT BE A ROOM FULL OF STATUES ══════════════
 *
 * Every resident on this station used to have a target and walk at the player
 * at 2.7 m/s, because `friendlyFire` is on for §11's *"cut or throw one"* and
 * `canHarm` is symmetric. `World.pickTarget` now refuses a `stationResident`
 * outright, which is right — residents chasing you is not life — but it left
 * the other half of the sentence unwritten: the only thing in this file with a
 * budget of motion was `stepWalkers`, and a resident who is not a walker
 * became COMPLETELY MOTIONLESS.
 *
 * MEASURED on deck 40, quality `high`, pool primed, sixty simulated seconds,
 * standing in #9 The Concourse — §3.3's *"where the game's whole cast is seen
 * at once, and that is the point of the station"*:
 *
 *     08:00   60 bodies,  4 walkers,  4 moved,  195 m of ground
 *     13:00   60 bodies,  0 walkers,  0 moved,    0 m      ← sixty statues
 *     22:00   44 bodies,  2 walkers,  2 moved,   92 m
 *
 * ── AND THE ANSWER IS NOT TO SET THEM WALKING ────────────────────────────
 *
 * The people in a room are not in transit; they are AT something — a counter,
 * a bench, a rail, a stall, a table. A fix that gave them routes would empty
 * every room in the gazetteer into the corridor, which is the defect the
 * walkway clause's last assertion already exists to catch.
 *
 * So what they get is the other kind of life, the one a body standing in a
 * place actually has: it turns, it shifts its weight, it takes a step along
 * the counter to the thing it is working at, and it comes back. Two poses,
 * held a few seconds each and rolled off the same `(place, slot)` seed as
 * everything else in this file, so a person you look away from and back is
 * doing the same thing they were.
 *
 * ── WHAT IT IS DELIBERATELY NOT ──────────────────────────────────────────
 *
 * SITTING is the obvious third pose and it is NOT here. `Rig.poseMeditation`
 * is a real solver for a body on the floor and would do it, but it writes
 * BONES and the pelvis in world coordinates, and `Enemy._pose` has two
 * different conventions for where a resident's hips live depending on which
 * branch posed it. Driving it from this file would be a guess that only a
 * screenshot could check, and rAF does not fire in this tree's headless
 * browser. `Props.seatCrowd` is the baked crowd's and puts down figures, not
 * bodies. The honest thing is to move what can be measured and to say so.
 *
 * ── THE COST ─────────────────────────────────────────────────────────────
 *
 * One countdown, one lerp and one `atan2` per live body per frame, over a pool
 * bounded at sixty. It is the same shape and the same order as `stepWalkers`,
 * which is already inside the 2.5 ms bound with the whole file at 0.16 ms.
 */
const STAND = {
  /** How far from their own slot a body will drift. A step, not a walk. */
  reach: 1.15,
  /** Metres a second of a shuffle — under half of `WALK_PACE`. */
  pace: 0.6,
  /** How fast the shoulders come round to a new bearing. */
  turn: 2.2,
  /** How long one pose is held. */
  hold: { min: 1.8, span: 4.4 },
};

/**
 * Give a body standing in a slot its post: where its feet belong, which way
 * the room faces, and the first thing it is doing.
 */
function standHere(body, place, at) {
  body.standX = at.x; body.standZ = at.z;
  body.standCx = at.x; body.standCz = at.z;
  body.standTx = at.x; body.standTz = at.z;
  body.standYaw = place.yaw || 0;
  body.standFace = body.facing ?? body.standYaw;
  /* §3.3's Vorlon is *"one encounter suit, one place (#37), NEVER WALKS"*, and
   * `fixed` is the gazetteer's own word for a place whose occupancy is a fact
   * rather than a rhythm. A body in one turns and breathes and does not take
   * a step, which is what the row says about him. */
  body.standStill = !!place.fixed;
  body.standN = 0;
  body.standIn = 0;
}

/**
 * The next thing this body is doing, seeded on its slot and on how many poses
 * it has already held — never on the clock and never on `Math.random`, so two
 * machines watching the same room see the same person do the same thing.
 */
function posture(body) {
  const a = (body.stationPlace | 0) * 97 + (body.stationSlot | 0) * 7 + 11;
  const n = body.standN = (body.standN | 0) + 1;
  const roll = h2(a, n * 5 + 1);
  body.standIn = STAND.hold.min + h2(a, n * 5 + 2) * STAND.hold.span;
  body.standPace = 0.7 + h2(a, n * 5 + 3) * 0.6;
  if (roll < 0.44 || body.standStill) {
    /* TURN — the commonest thing anybody standing in a room does, and the one
     * that costs no ground at all. About the ROOM's axis, so a hall of people
     * reads as a hall of people attending to it rather than as a scatter. */
    body.standTx = body.standCx; body.standTz = body.standCz;
    body.standFace = body.standYaw + (h2(a, n * 5 + 4) - 0.5) * 2.6;
    return;
  }
  /* SHIFT THE WEIGHT, or step along to what is being worked at — the short
   * one four times as often as the long one. Always measured off the SLOT and
   * not off where the body has got to, so nobody wanders out of their room. */
  const t = h2(a, n * 5 + 5) * Math.PI * 2;
  const far = roll > 0.86 ? 1 : 0.3;
  const rad = STAND.reach * far * (0.35 + 0.65 * h2(a, n * 5 + 6));
  body.standTx = body.standX + Math.sin(t) * rad;
  body.standTz = body.standZ + Math.cos(t) * rad;
  const dx = body.standTx - body.standCx, dz = body.standTz - body.standCz;
  body.standFace = (dx * dx + dz * dz) > 1e-6 ? Math.atan2(dx, dz) : body.standFace;
}

/**
 * ONE FRAME OF EVERYBODY WHO IS STAYING WHERE THEY ARE.
 *
 * `standCx/standCz` is the authority on where the body is, exactly as
 * `wayR/wayAngle` is for a walker, and `position` is written from it every
 * frame rather than added to — so nothing `Enemy._move` does with the velocity
 * this hands the animator can accumulate into a drift out of the room.
 */
function stepStanding(world, life, dt) {
  for (const body of life.live.values()) {
    /* A walker has `stepWalkers`; a body the player has hurt is a ragdoll, a
     * corpse or a witness and is not shuffling at a counter. */
    if (!body || body.wayR || body.standX === undefined) continue;
    if (body.__stationTouched || body.alive === false || body.dead) continue;
    const p = body.position;
    if (!p) continue;
    body.standIn -= dt;
    if (body.standIn <= 0) posture(body);
    let mx = 0, mz = 0;
    const dx = body.standTx - body.standCx, dz = body.standTz - body.standCz;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) {
      const step = Math.min(d, STAND.pace * (body.standPace || 1) * dt);
      mx = dx / d * step; mz = dz / d * step;
      body.standCx += mx; body.standCz += mz;
    }
    p.x = body.standCx; p.z = body.standCz;
    body.body?.setTransform?.(p, null);
    /* THE GAIT READS THE VELOCITY, so a step is a step and a pause is the
     * rig's own idle sway rather than a slide. */
    if (body.velocity && dt > 0) body.velocity.set(mx / dt, 0, mz / dt);
    /* Facing: along the step while there is one, on the pose's bearing when
     * there is not. `Enemy._pose` leaves a resident's `facing` alone — its
     * `want` is the body's own — so this is the one writer. */
    const want = (mx * mx + mz * mz) > 1e-9 ? Math.atan2(mx, mz) : body.standFace;
    body.facing += wrapPi(want - body.facing) * Math.min(1, dt * STAND.turn);
  }
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
      /**
       * ── AND IT IS HELD THERE, NOT MERELY LEFT THERE ───────────────────
       *
       * This branch wrote the velocity and nothing else, so for the two to
       * seven seconds a walker stands at the door it arrived at, `position`
       * was whatever the contact solver last did to it — and a corridor with
       * people in it pushes. It never showed while four walkers were alive on
       * a deck; MEASURED with the corridor properly populated, deck 40 at
       * 13:00 with thirty-seven of them: a dwelling body **1.9 m off the
       * ring**, and `setOut` then planned its next route from the polar state
       * it still thought it was in — so the walk opened with a two-metre
       * sidestep onto its own first leg, eight times in seventy seconds.
       * `station.mjs`'s "off the leg the route says they are on" clause reads
       * exactly that, and this is what it was reading.
       *
       * `wayR`/`wayAngle` is the authority for a walker exactly as
       * `standCx`/`standCz` is for everybody else, so it is written out on
       * every frame — the ones where the body is standing included.
       */
      const sx = body.wayR * Math.sin(body.wayAngle);
      const sz = body.wayR * Math.cos(body.wayAngle);
      if (body.position) {
        body.position.x = sx; body.position.z = sz;
        body.body?.setTransform?.(body.position, null);
      }
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
  stepStanding(world, life, dt);
  stepWalkers(world, life, dt);
  stepTram(world, st, life, dt);
  stepEvents(world, st, life, dt);
  /* The reactor's dip, decaying once the surge is over — one number, and
   * `stepDip` below is the reader it did not have. */
  if (!life.event && life.dip > 0) life.dip = Math.max(0, life.dip - dt * 0.9);
  stepDip(st, life);

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
  /* THE MODULE'S ROW GOES DOWN WITH THE WORLD. It is what `headcount`
   * defaults to, and a station left running an event nobody is standing in
   * would go on adding fourteen people to Arrivals for the rest of the
   * process — including inside the next world a check boots. */
  life.event = null;
  life.eventFor = 0;
  life.dip = 0;
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
