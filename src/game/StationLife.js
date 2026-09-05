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
 */
function slotIn(place, i, out) {
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
 * ── AND THEY STAND ────────────────────────────────────────────────────────
 *
 * They are seated along the walk line, facing along it, at the places a person
 * stops: at a counter, on a bench, under a gantry, at the rail of an overlook,
 * waiting at a crossing. They do not yet WALK — locomotion belongs to `Enemy`'s
 * brain and there is no route hook on it to drive; a body here has
 * `stationWay` set so the hook, when it exists, knows which bodies are the
 * ones in transit. What this fixes is the corridor being empty, not the
 * corridor being still.
 */

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
    const r = w.band === 'spine' ? w.r : w.band === 'rim' ? DRUM.balcony + 2 : DRUM.ringR;
    if (w.band === 'spine' && deck === 40 && w.at === 0) continue;
    put(r, w.at, 6, 5, WAY_HEADS[w.kind] ?? 2, w.band === 'rim' ? 18 : 13, w.kind);
  }
  /* AND THE OPEN WALK ITSELF, between them: eight stretches of ring and the
   * middle of every spine, so the deck has people in transit and not only
   * people stopped. */
  for (let i = 0; i < 8; i++) put(DRUM.ringR, 22.5 + i * 45, 14, 6, 4, 14, 'walk');
  for (const deg of DRUM.spines) {
    if (deck === 40 && deg === 0) continue;
    put((DRUM.balcony + DRUM.roomR) / 2, deg, 5, 16, 4, 14, 'walk');
  }
  _ways.set(deck, out);
  return out;
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
  /* EVERYTHING BELOW IS THE CENSUS — anonymous people filling a room — and
   * every one of them is drawn on `daily`. The species bias of a quarter is
   * the room's and does not move; who is standing in it does. */
  const bias = QUARTER_OF[place.id];
  if (bias) return resident(daily, { species: bias });
  if (place.id === 9 && i < RARE.length * 5) {
    /* The RARE eight, five each, in the first forty stalls. Cycling all
     * fifteen here would make the market one human in fifteen, which is a
     * worse lie than the census's — 155 000 of 250 000 aboard are human. What
     * the market has to guarantee is that the whole cast is IN it, and the
     * eight that the census would otherwise round out of the room are the
     * eight that need guaranteeing. `stationlife.mjs` counts them. */
    return resident(daily, { species: RARE[i % RARE.length] });
  }
  if (place.id === 38) return resident(daily, { species: HOSTEL[i % HOSTEL.length] });
  /* The food court is the other place the tail is always in: a cheap counter
   * under a low ceiling at shift change is where transients and dock gangs
   * eat, and the census would otherwise leave the seven quarterless species
   * with one room between them. */
  if (place.id === 17 && i < HOSTEL.length * 2) return resident(daily, { species: HOSTEL[i % HOSTEL.length] });
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
    /** The walkways of this deck, as pseudo-places the pool can seat into.
     * See `wayPlacesOn`: before this the corridors held nobody at all. */
    ways: wayPlacesOn(st.deck),
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
   * ══ THE FIRST POPULATION HAPPENS NOW, NOT ON FRAME ONE ═════════════════
   *
   * Measured: an unbounded re-seat during play spends 100 ms on the frame the
   * player walks into a full hall, because a spawn BUILDS a body — a rig,
   * sixty meshes and a `MergedSkin` chain — and several land together. Every
   * re-seat after this one is capped at two, which at half-second intervals is
   * four bodies a second appearing just ahead of a walk.
   *
   * This one is uncapped and it is free, because `dressStation` runs inside
   * `World._loadSteps` — the player is looking at the loading plate, and §12.2
   * budgets the station's LOAD at the hangar's rather than its frames. It also
   * settles §13.2's contact sheet: a shot of the Concourse at 13:00 is of a
   * market, not of a market filling up.
   */
  const here = world._station;
  const p = world.player?.position;
  if (here) reseat(world, here, life, p ? p.x : 0, p ? p.z : 24);
  life.priming = false;
  return life;
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
  const want = _want;
  want.length = 0;
  const consider = (p) => {
    const n = headcount(p, hour);
    if (n <= 0) return;
    for (let i = 0; i < n; i++) {
      slotIn(p, i, _v);
      const dx = _v.x - px, dz = _v.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > DROP_RADIUS * DROP_RADIUS) continue;
      want.push({ key: `${p.id}:${i}`, place: p, i, d2 });
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
  /* The first re-seat runs inside the loading plate, so it may spend as long
   * as it needs; every one after it is a trickle. */
  const cap = life.priming ? life.budget : 1;
  let made = 0;
  for (const w of want) {
    if (n >= life.budget) break;
    keep.add(w.key);
    n++;
    if (life.live.has(w.key)) continue;
    if (made >= cap) continue;
    /* Only inside the live radius does a body actually appear — the wider
     * DROP_RADIUS above is the hysteresis, not the spawn line. */
    if (w.d2 > LIVE_RADIUS * LIVE_RADIUS) { keep.delete(w.key); n--; continue; }
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
const byNear = (a, b) => a.d2 - b.d2;

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
      body.wayAngle = Math.atan2(_v.x, _v.z);
      body.wayR = Math.hypot(_v.x, _v.z);
      body.wayDir = ((place.id + i) % 2) ? 1 : -1;
      body.wayPace = WALK_PACE * (0.86 + ((place.id * 7 + i * 13) % 29) / 100);
      /**
       * ── WHICH CORRIDOR HE IS IN, BECAUSE THEY ARE NOT THE SAME SHAPE ────
       *
       * The first cut walked every `walk` slot round a circle at its own
       * radius, and that is only safe on the RING. The eight ring stretches
       * sit at `ringR`, which is a clear annulus all the way round — but the
       * four SPINE stretches sit at `(balcony + roomR) / 2`, mid-band, and a
       * fifth of that circle is inside a room footprint. Measured live over
       * 240 samples on deck 40: a walker was inside #13 The Databank on 53 of
       * them, #9 The Concourse on 42, the Cantina on 15. #13 walls all but
       * 0.42 rad of itself, so that is a body walking through a wall; #14 is
       * sunk half a deck, so that is a body in mid-air over it.
       *
       * A SPINE IS RADIAL, so a spine walker travels along its own bearing
       * between the balcony and the rooms' inner face and turns round at the
       * ends. The property that made the ring version safe — you cannot leave
       * a corridor you are travelling the length of — is the same one, applied
       * to the axis the corridor actually runs on.
       */
      body.wayAxis = Math.abs(body.wayR - DRUM.ringR) < 2 ? 'ring' : 'spine';
      if (body.wayAxis === 'spine') {
        body.wayIn = DRUM.balcony + 2.5;
        body.wayOut = DRUM.roomR - 2.5;
      }
    }
  }
  /* A resident stands where they are put and does not hunt. There is no
   * enemy on this station and no objective for one to be given. */
  if (body.brain) body.brain.idle = true;
  return body;
}

function removeBody(world, body) {
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
  /* Anything that has been hurt this frame is the trigger. `world.enemies` is
   * the only list a resident is in and the flag is set by the damage path. */
  let hurt = 0;
  for (const e of world.enemies) {
    if (!e.stationName) continue;
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
 * §2.5's third standing rule: *"People are going somewhere … the walkways must
 * carry people MOVING along desire lines."*
 *
 * ── WHAT WAS MEASURED, AND IT IS WHY THIS EXISTS ─────────────────────────
 *
 * A hostile pass tracked 46 residents over sixty simulated seconds on deck 40:
 * median displacement 3.02 m, worst 6.49 m, and the eighteen in the
 * between-space no different at 2.96 m. The ring is two hundred metres round.
 * Three metres a minute is a shuffle on the spot, and the source said why —
 * `spawnResident` set `brain.idle = true` under a note reading "a resident
 * stands where they are put and does not hunt", and `stationWay`, the field
 * whose own comment called it "the hook a route would drive", had one writer
 * and no readers anywhere in the tree.
 *
 * ── AND THE ROUTE IS THE RING, WHICH IS THE WHOLE TRICK ──────────────────
 *
 * A walker advances its BEARING at a fixed radius. The corridor is an annulus,
 * so staying on it is arithmetic rather than navigation: no path to solve, no
 * collision to query, nothing to get stuck on, and a body that walks for a
 * minute is exactly as safe as one that walks for an hour.
 *
 * IT COSTS ONE TRIG PAIR PER WALKING BODY and the population is small — the
 * eight ring stretches carry four heads each — so this is well inside the
 * 2.5 ms §12.2 gives the whole file. The velocity is set as well as the
 * position because that is what the body's own animator reads: a body moved by
 * assignment alone would slide along the deck in its idle pose.
 */
const WALK_PACE = 1.35;

function stepWalkers(world, life, dt) {
  for (const body of life.live.values()) {
    const R = body?.wayR;
    if (!R) continue;
    const was = body.position ? { x: body.position.x, z: body.position.z } : null;
    let x, z;
    if (body.wayAxis === 'spine') {
      /* ALONG THE SPINE AND BACK. The bearing is fixed; the RADIUS is what
       * moves, and it turns round at each end rather than running out into
       * the atrium at one and through the skin at the other. */
      body.wayR = R + body.wayPace * body.wayDir * dt;
      if (body.wayR >= body.wayOut) { body.wayR = body.wayOut; body.wayDir = -1; }
      else if (body.wayR <= body.wayIn) { body.wayR = body.wayIn; body.wayDir = 1; }
      x = body.wayR * Math.sin(body.wayAngle);
      z = body.wayR * Math.cos(body.wayAngle);
      /* Facing along the radius — outward when walking out, inward coming back. */
      body.facing = body.wayDir > 0 ? body.wayAngle : body.wayAngle + Math.PI;
    } else {
      body.wayAngle += (body.wayPace / R) * body.wayDir * dt;
      x = R * Math.sin(body.wayAngle);
      z = R * Math.cos(body.wayAngle);
      /* FACING ALONG THE WALK, which is the tangent — a person walking the
       * ring backwards is the thing this is here to avoid. */
      body.facing = body.wayAngle + (body.wayDir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    if (body.position) {
      body.position.x = x; body.position.z = z;
      body.body?.setTransform?.(body.position, null);
    }
    if (was && body.velocity && dt > 0) {
      body.velocity.set((x - was.x) / dt, 0, (z - was.z) / dt);
    }
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
    life.priming = false;
  }
  witness(world, st, life, dt);
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
    if (life.spawned === spawnBefore && life.despawned === dropBefore) life.stepMs = ms;
  }
}

/** Everything the life made, put down. */
export function undressStationLife(world) {
  const life = world?._stationLife;
  if (!life) return;
  for (const b of life.live.values()) removeBody(world, b);
  for (const g of life.guards) removeBody(world, g);
  life.live.clear();
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
export function census(hour) {
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
      const r = p.id === 36 ? { species: METHANE[i % 2] } : occupant(p, i);
      if (r.borz) { byBorz.set(r.borz.id, (byBorz.get(r.borz.id) || 0) + 1); continue; }
      bySpecies.set(r.species, (bySpecies.get(r.species) || 0) + 1);
    }
  }
  return { byPlace, bySpecies, byBorz };
}
