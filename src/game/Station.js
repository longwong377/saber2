/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE STATION — a drum round a void, and the hub of the whole game
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `SHARK.md` is the plan and this is the room. Read §3.1 before changing
 * anything here: it is six anti-box rules written against `HANGAR.md`'s
 * record of six interiors deleted for being *"a roof plus four walls at the
 * draw budget this engine has"*. Every one of them is answered by structure
 * in this file and by a check in `tools/checks/station.mjs`.
 *
 *   1. A DRUM ROUND A VOID.  `buildDrum` — three decks, an atrium through all
 *      three, a balcony onto it from each, so from anywhere near the middle
 *      you see two other decks and the people on them.
 *   2. THREE DECKS, THREE CHARACTERS.  `DECK_PALETTE` and `CORRIDOR`. Deck 40
 *      is warm, 44 is cool, 48 is dark, and no two share a corridor type.
 *   3. A RING, A SPINE AND A TRAM.  `ringWalk`, `spines`, `Tram` in
 *      `StationLife.js`.
 *   4. NO TWO PLACES THE SAME SHAPE.  `StationKit.js`, one builder per place,
 *      measured pairwise by `station.mjs`.
 *   5. EVERY PLACE HAS A WINDOW ONTO ANOTHER PLACE.  A room's outer face is
 *      the skin (space), its inner face is the ring, and an inner-band room
 *      looks across the void.
 *   6. EVERYTHING IS A BODY.  §11 — `StationLife.js` and `Props.Prop`.
 *
 * ── IT IS A LEVEL IN SANDBOX MODE, WHICH IS THE WHOLE OF §11 ──────────────
 *
 * `MODES.sandbox` already builds a full `World` + `Player` with zero enemies,
 * so `LEVELS.station` on that path simply HAS every system the battlefield
 * has: `spawnEnemy`, `Ragdoll`, dismemberment, `Destruction`, `Props` bodies,
 * Force grip and hurl on everything, `Reactions`, `Corpses`, voice. The
 * hangar deliberately has none of that — its own header says "past thirty
 * metres no bodies is the honest trade" — and the player's bar for this place
 * is the opposite: *"everything actually modelled and with physics and
 * interactable like any other body in Battlefield Borz"*. So the station is
 * not a second hangar and nothing here reaches into `Hangar.js`.
 *
 * ── AND IT IS ADDITIVE, BEHIND ONE SWITCH (§9.2) ──────────────────────────
 *
 * Every file this feature has is a new file. The existing tree changes in
 * exactly the places §9.2 lists, each behind `STATION_ENABLED`. With the
 * switch off the lift has one floor and the game is precisely today's, and
 * `station.mjs` proves it against a recorded trace the way `saberforms.mjs`
 * proves the single blade.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { Kit, propMaterials, makeCrate } from '../world/Props.js';
import { deckMats, factionOf } from './DeckKit.js';
import { loadRoom, materialKeyFor } from './StationMesh.js';
import { PLACES, PLACE, DECK_Y, DRUM, CORRIDOR, SHAFTS, placesOn, floorOf, sectorAt } from './StationPlan.js';
import { buildPlace, SHAPES, buildWays, dressWayfinding } from './StationKit.js';
import { dressDeckLift, stepDeckLift, undressDeckLift, liftKey, liftFloors } from './DeckLift.js';
import { dressStationLife, primeStationLife, stepStationLife, undressStationLife, dressTram } from './StationLife.js';
import { dressObelisk, dressBoards, stepBoards, standingReading, companyOf } from './StationBoards.js';
/* What a man on the roll is CALLED — one rule, `Company.js`'s own, so the job
 * board names him exactly as the company tab does. See `questContext`. */
import { nameOf } from './Company.js';
import { dressNotices, stepNotices, noticeReading } from './Notices.js';
import { stationHour, setStationHour, stationName, setStationName, standing, setStanding, stationDay, DEFAULT_NAME, NAME_MAX } from './StationSave.js';
import { outsideLevel } from './Hangar.js';
import { dressDeckBattle, stepDeckBattle, undressDeckBattle } from './DeckBattle.js';
import { dressHome, stepHome, leaveHome, undressHome, homeKey, inHome } from './Home.js';
import { myApartment } from './Coop.js';
import { TERRAIN_PRESETS } from '../world/Terrain.js';
import { Warp, canJump } from './Warp.js';
import { countersAt, counterById, COUNTERS } from './Vendors.js';
/* THE KEEPERS' BODIES come off the same census every other resident does — see
 * `dressKeepers`. One import, no new archetype. */
import { resident } from './StationCast.js';
import { stepMedbay } from './Medbay.js';
/* THE LEAVE LEDGER. `isBar` names the rooms a soldier drinks in and `stepLeave`
 * is what pays him for standing in one — see the branch at the bottom of
 * `stationKey` and the call beside `stepMedbay` in `stepStation`. */
import { isBar, stepLeave } from './Bars.js';
import { pitAtPlace } from './Pits.js';
/* THE ROOM'S OWN NOISE — see `stepCrowd`. The same singleton sixteen other
 * game files reach for; §G4's crowd is a cue on the engine, not a new path. */
import { audio } from '../engine/Audio.js';
import { venueAtPlace, ticketFor, settleTickets, crowdAt } from './Tote.js';
import { openWheelhouse, wheelhouseLine, drumQuote, WHEELHOUSE } from './Casino.js';
/* THE JOB BOARD'S DOOR. `takeJob` is NOT here: a panel takes a job straight
 * off `Quests.js`, and a pass-through in this file would be a second name for
 * the same call and one more thing to keep true. What this file owns is the
 * two things `Quests.js` must not — where a giver is standing, and the purse. */
import { offersAt, openJobs, owedJobs, collect } from './Quests.js';
import { pay, spend } from './Credits.js';
import {
  boardAt, traffic, inboundLine, walkGantry, signCert, certified, readiness,
  shortLine, throwBell, spares, cleanFlight, flew, gantryStage, BELL, CERT,
  GANTRY_LEVELS,
} from './FlightOps.js';
import { Sortie, canLaunch } from './Launch.js';
import { sample as orbitSample, sightLine, CIRCUIT_LENGTH } from './Outside.js';
import { CircuitPilot, TOP_SPEED } from './Pilot.js';
import { GANTRY_Y, stepCook } from './StationKit.js';
import { flightState, setFlightState } from './StationSave.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE THREE DECKS' PALETTES — §3.1 rule 2                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHY THERE ARE THREE PALETTES AND NOT ONE ══════════════════════════════
 *
 * §9.1 says every mesh in a walkable room takes the engine's own materials so
 * it takes the cel bands and the ink pass exactly as the hangar's kit does.
 * §3.1 rule 2 says the three decks must be three different rooms to stand in —
 * "warm: brass, terracotta, amber", "cool: white, timber, blue-white",
 * "dark: steel, red-orange service light" — so that **you always know where
 * you are**. A single monochrome set cannot do both.
 *
 * They are not in tension once you notice what `deckMats` already is: eleven
 * `MeshStandardMaterial`s built from ONE table of eleven colours, keyed by
 * army, so that "the materials, the six ship silhouettes and the deck insignia
 * all follow from one value going in at the top". A third and fourth and fifth
 * palette is that mechanism used again, not a second mechanism.
 *
 * So these rows have the same eleven keys as `FACTION_PALETTE`, the materials
 * are built with the same properties by the same code shape, and every one of
 * them is a `MeshStandardMaterial` the cel pass shades and the ink pass draws.
 * What is NOT copied is the four `MeshBasicMaterial` keys — `glow`, `lamp`,
 * `glowDim`, `smear` — because all four carry `userData.saberNoInk` and §9.1
 * forbids an uninked material inside a room. The station's lights are `strip`,
 * which is emissive AND inked, and the check holds that.
 */
export const DECK_PALETTE = {
  /**
   * DECK 40 — the Concourse deck. Warm: brass, terracotta, amber light.
   * The Zocalo's own architecture is a market hall and this is the palette
   * that reads as one: the structure is warm grey, the market furniture is
   * terracotta, and the light is amber rather than white.
   */
  40: {
    hull: 0xb9a894, dark: 0x6c5f52, deep: 0x8a5b42,
    strip: 0xffd9a0, status: 0xff5a2a, wing: 0xc9bda9, mark: 0xe4d3b4,
    screen: 0xffbe6a, glass: 0xa8c6d8,
    key: 0xffe4bc, fill: 0xd8b48a, ambient: 0xcbb59a,
    fog: 0x2b2118, bg: 0x0d0a07,
  },
  /**
   * DECK 44 — the Living deck. Cool: white, timber, blue-white, quieter.
   * The promenade's window wall is the deck's whole character, so the light
   * is the colour of the star outside and the surfaces are pale.
   */
  44: {
    hull: 0xd6dbe2, dark: 0x7e6a54, deep: 0x9aa4b0,
    strip: 0xd8ecff, status: 0xff5a2a, wing: 0xe6ebf1, mark: 0xb9c6d4,
    screen: 0x9fd0ff, glass: 0xbfd8ea,
    key: 0xeaf3ff, fill: 0x9fb6d0, ambient: 0xc4d2e0,
    fog: 0x1d2732, bg: 0x070b10,
  },
  /**
   * DECK 48 — the Working deck. Dark: steel, red-orange service light,
   * exposed pipe. The one deck where the light is the accent and not the fill.
   */
  48: {
    hull: 0x5d646c, dark: 0x33383e, deep: 0x454b52,
    strip: 0xffa053, status: 0xff3a1a, wing: 0x7b838c, mark: 0xa8664a,
    screen: 0xff8a4a, glass: 0x8fa4b4,
    key: 0xffc79a, fill: 0x6a7f96, ambient: 0x6e737a,
    fog: 0x14181d, bg: 0x05070a,
  },
  /** DECK 60 — the dome. The room is the view; the surfaces get out of the way. */
  60: {
    hull: 0x8e97a2, dark: 0x3a4048, deep: 0x5b636c,
    strip: 0xcfe6ff, status: 0xff5a2a, wing: 0xa9b3bd, mark: 0x8ea2b4,
    screen: 0x9fd0ff, glass: 0xcfe4f4,
    key: 0xe8f2ff, fill: 0x7d94ad, ambient: 0x9aa8b6,
    fog: 0x0d1218, bg: 0x02040a,
  },
  /** DECK 32 and DECK 12 — flight ops. The hangar's own steel, unwarmed. */
  32: {
    hull: 0x8d949c, dark: 0x4a5058, deep: 0x5f666e,
    strip: 0xdfeaff, status: 0xff3a1a, wing: 0xa4acb6, mark: 0xc3ccd6,
    screen: 0x9fd0ff, glass: 0xa8bccc,
    key: 0xfff6ea, fill: 0x93b2dc, ambient: 0xcfcac2,
    fog: 0x1b2636, bg: 0x05070c,
  },
};
DECK_PALETTE[12] = DECK_PALETTE[32];

/**
 * The eleven materials of one deck, cached by deck.
 *
 * Keyed by deck and never by a module-level "current deck", for exactly the
 * reason `deckMats` is keyed by faction: two Worlds alive at once (which
 * `_coop.mjs` makes routinely, and which the menu's preview does) would share
 * one set, and the first room built in a process would decide the palette of
 * every room after it.
 */
const _stationMats = new Map();

export function stationMats(deck) {
  const key = DECK_PALETTE[deck] ? deck : 40;
  const hit = _stationMats.get(key);
  if (hit) return hit;
  const P = DECK_PALETTE[key];
  const M = { deck: key };
  const std = (k, opts) => {
    const m = new THREE.MeshStandardMaterial(opts);
    m.name = `station-${key}-${k}`;
    m.userData.key = k;
    /* NO `saberNoInk` ON ANY OF THEM. §9.1: inside a room, nothing. The one
     * emissive material here is `strip`, and it is inked like the rest. */
    return (M[k] = m);
  };
  std('hull', { color: P.hull, roughness: 0.66, metalness: 0.28 });
  std('dark', { color: P.dark, roughness: 0.74, metalness: 0.24 });
  std('deep', { color: P.deep, roughness: 0.82, metalness: 0.14 });
  std('wing', { color: P.wing, roughness: 0.55, metalness: 0.42 });
  std('mark', { color: P.mark, roughness: 0.9, metalness: 0.04 });
  /* The light. Emissive and shaded, which is what lets the ink pass draw its
   * edge and the cel pass band the surface it is set into. */
  std('strip', { color: P.dark, emissive: P.strip, emissiveIntensity: 3.0, roughness: 0.4 });
  std('status', { color: 0x1a0c0c, emissive: P.status, emissiveIntensity: 2.4, roughness: 0.5 });
  std('screen', { color: 0x0d1116, emissive: P.screen, emissiveIntensity: 1.5, roughness: 0.35 });
  /* Glass: a window is a surface you see THROUGH and the ink still finds its
   * frame. Transparent rather than `saberNoInk`, so it obeys §9.1. */
  const glass = std('glass', {
    color: P.glass, roughness: 0.08, metalness: 0.1,
    transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide,
  });
  glass.envMapIntensity = 0;
  _stationMats.set(key, M);
  return M;
}

/** Drop the cached sets. Only a check calls this. */
export function forgetStationMats() {
  for (const M of _stationMats.values()) {
    for (const k of Object.keys(M)) if (M[k]?.isMaterial) M[k].dispose();
  }
  _stationMats.clear();
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ROOMS, LOADED BEFORE THE LEVEL IS                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The five imported rooms, by the name a `PLACES` row gives in `room`.
 *
 * PLAIN STRING LITERALS, never interpolated. `tools/pack.mjs` rewrites an
 * `assets/…` literal into a `data:` URL so the single file carries the
 * geometry and fetches nothing (§12.1); a path built by template would still
 * be a path at pack time and would 404 in the packed page — which is the
 * exact defect `pack.mjs`'s own header records against the level screenshots.
 */
export const ROOM_FILES = {
  zocalo: 'assets/station/zocalo.smesh',
  corridor: 'assets/station/corridor.smesh',
  cnc: 'assets/station/cnc.smesh',
  rotunda: 'assets/station/rotunda.smesh',
  starfury: 'assets/station/starfury.smesh',
};

const _rooms = new Map();

/**
 * Load every imported room. **Call and await this before `buildWorld`.**
 *
 * `World._loadSteps` runs `L.dress(this)` synchronously and nothing in this
 * feature may add a stage to it (§9.2: the existing files change in exactly
 * the listed places). So the asynchronous part happens on the far side of the
 * door, in `main.js`'s station hook, and `dressStation` finds the geometry
 * already decoded. That also puts the decode inside the loading plate the
 * player is already looking at rather than inside the first frame.
 */
export async function prepareStation() {
  const want = Object.entries(ROOM_FILES);
  await Promise.all(want.map(async ([name, url]) => {
    if (_rooms.has(name)) return;
    _rooms.set(name, await loadRoom(url));
  }));
  return _rooms;
}

/** A decoded room, or null if `prepareStation` has not run. */
export function roomOf(name) { return _rooms.get(name) || null; }

/**
 * Forget the decoded rooms.
 *
 * The cache is session-lived on purpose — `StationMesh.loadRoom` keeps the
 * decoded geometry so a second visit to the station is not a second 1.5 MB
 * decode — and nothing in normal play drops it. This exists so a check can
 * build the station as it looks when the meshes DID NOT ARRIVE, which is the
 * case `SHAPES.vault`, `.daispit` and `.glassdome` are there for and the only
 * way to reach it without breaking the network.
 */
export function forgetRooms() { _rooms.clear(); }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DRUM                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;
/* Scratch for the jump's transit-amber lerp — see `orderJump`. */
const _warpC = new THREE.Color(), _warpA = new THREE.Color();

/**
 * A ring of slabs approximating an annulus: `n` segments, each a box.
 *
 * `opts.omit` is a POLAR RECTANGLE the ring is not laid in — `{ a0, a1, r0,
 * r1 }` in bearing and radius. A segment whose bearing falls inside it is laid
 * as its inner and outer REMAINDERS instead of one full-depth chord, which is
 * how a hole is cut in a merged floor without a boolean: the plate is still
 * one mesh per material, so a well costs a few boxes and NO extra draw call.
 * See `standingWell` for the one thing that asks for it and why.
 *
 * ── AND IT RETURNS THE HOLE IT ACTUALLY MADE, WHICH IS NOT THE ONE ASKED ──
 *
 * A segment is either laid or it is not, so the bearings are quantised OUT to
 * whole segments; and `lay` refuses a remainder thinner than 0.25 m, so a cut
 * that comes within that of either edge takes the edge with it. Asked for
 * 8.13°..18.70° at n=72, this cuts 10.0°..20.0° — 180.4 m² against #56's
 * 132 m² footprint. `railWell` used to fence the FOOTPRINT, which is how
 * 149.8 m² of the deck-48 well came to have no rail on it. So the hole is
 * returned and the rail is laid on the RETURN VALUE: there is one region,
 * this function decides it, and nothing else repeats the arithmetic.
 */
function annulus(kit, mat, y, h, r0, r1, n, opts = {}) {
  const from = opts.from ?? 0, to = opts.to ?? TAU;
  const span = to - from;
  const seg = Math.max(3, Math.round(n * (span / TAU)));
  const collide = opts.collide !== false;
  /**
   * Each segment is a chord, so it is made slightly long: a box whose ends
   * meet its neighbours' on the OUTER radius leaves a wedge of gap on the
   * inner one, and a floor with gaps in it is a floor a capsule falls through.
   *
   * ── AND IT IS SIZED AT `rB`, NOT AT THE MIDDLE ──────────────────────────
   *
   * It was sized at the chord's own MIDDLE radius, which is the same sentence
   * with the wrong number in it: a sector is wider the further out you go, so
   * a box that spans it at the middle falls short of it at the outer end, and
   * every pair of neighbours left a wedge between them. Measured at the well's
   * lip on deck 44, where two cut segments put their inner remainders side by
   * side: 35.4 m² of plate missing over a 12.5 m drop, in a wedge 1.85 m wide
   * at the inner rail — reachable, unfenced, and nothing to do with the well.
   * Sized at `rB` the ends meet where the sector is widest and OVERLAP inward,
   * which is free: the segments merge into one mesh per material either way.
   */
  const lay = (rA, rB, a) => {
    if (rB - rA < 0.25) return;
    const rMid = (rA + rB) / 2;
    kit.slab(mat, 2 * rB * Math.tan(span / seg / 2) * 1.06, h, rB - rA,
      rMid * Math.sin(a), y, rMid * Math.cos(a), { ry: a, collide, bevel: 0 });
  };
  const cut = opts.omit || null;
  /* The hole as MADE: the bearings of the segments actually skipped, and the
   * radii the remainders actually left. */
  let c0 = Infinity, c1 = -Infinity, hr0 = cut ? cut.r0 : 0, hr1 = cut ? cut.r1 : 0;
  for (let i = 0; i < seg; i++) {
    const a = from + span * ((i + 0.5) / seg);
    if (cut && a > cut.a0 && a < cut.a1) {
      if (a < c0) c0 = a;
      if (a > c1) c1 = a;
      /* `lay`'s own 0.25 m floor, read back: a remainder it refused is plate
       * that is not there, so the hole runs out to the ring's edge. */
      if (cut.r0 - r0 < 0.25) hr0 = r0;
      if (r1 - cut.r1 < 0.25) hr1 = r1;
      lay(r0, cut.r0, a); lay(cut.r1, r1, a); continue;
    }
    lay(r0, r1, a);
  }
  if (!cut || c1 < c0) return null;
  /* A skipped segment's centre is half a segment from each of its own edges. */
  const half = span / seg / 2;
  return { a0: c0 - half, a1: c1 + half, r0: hr0, r1: hr1 };
}

/**
 * ══ THE WELL THE STANDING RISES THROUGH — V15 §1.2 ════════════════════════
 *
 * *"a black obelisk three decks high, running up through a cut in the soffit
 * so you see the top of it from the Living deck's balcony and the whole of it
 * from the Concourse floor."*
 *
 * Measured before this existed: `deck 44: st.obelisk NULL, 0 'station-obelisk'
 * nodes`, and the same on 48. #56's own builder raises four corner piers up
 * through the hall's 26 m — but the drum's SOFFIT is a full annulus laid over
 * the whole turn, so on deck 40 the column vanished into the ceiling 8.6 m up,
 * and on the two decks above it there was no column at all. The landmark you
 * can see from two other decks, which is the entire argument for an obelisk
 * over a screen, did not exist on any deck.
 *
 * So the plate and the soffit are CUT round #56's footprint, on the decks the
 * shaft passes, and the cut is railed. Nothing else changes: the cut is an
 * `omit` on the two annuli that were already being laid, so the deck is still
 * nine merged meshes and the well costs no draw call at all.
 *
 * ── AND THE RAIL IS WHAT STOPS YOU ────────────────────────────────────────
 *
 * `activeFloorAt` answers the deck's height at every (x, z) — it is a flat
 * plane per deck by design — so a hole in the plate does not become a hole a
 * walker falls down; it becomes a place a walker stands on air. The rail is
 * therefore not a nicety: it is the collider that keeps anything from being
 * over the void in the first place, drawn rather than invisible, which is the
 * balcony rail's own rule six lines down ("you can see what stops you").
 *
 * ── AND THAT SENTENCE WAS FALSE FOR A THIRD OF THE HOLE ───────────────────
 *
 * It was, from the day it was written. This function handed back the polar
 * bounding box of a YAWED rectangle, `annulus` quantised that out to whole
 * 5° segments, and `railWell` then laid its rail on the ORIGINAL rectangle —
 * two derivations of one region, so the hole was bigger than the fence by
 * construction. Measured with a raycast grid over the whole cut, flooding in
 * at knee height from the plate outside it: 93.8 m² of deck 44 and 149.8 m² of
 * deck 48 were walkable with nothing under them, reaching 2.61 m and 3.13 m
 * clear of the last solid floor over drops of 12.5 m and 25.0 m. Standing on
 * air over the void, which is worse than falling, because falling ends.
 *
 * So this returns the REQUEST — the region the cut is asked for — and
 * `annulus` returns the region it actually cut, and the rail is laid on that.
 * The two cannot disagree because there is only one of them.
 */
function standingWell() {
  const p = PLACE.get(56);
  if (!p) return null;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  /* The four corners, in the drum's polar frame. #56 stands at bearing 13°,
   * nowhere near the ±π seam, so a min/max over four bearings is the whole
   * arithmetic and there is no wrap to handle — `station.mjs` pins that. */
  const C = [[-p.w / 2, -p.d / 2], [p.w / 2, -p.d / 2], [p.w / 2, p.d / 2], [-p.w / 2, p.d / 2]]
    .map(([lx, lz]) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
  let r1 = -Infinity, a0 = Infinity, a1 = -Infinity;
  for (const [x, z] of C) {
    const r = Math.hypot(x, z), a = Math.atan2(x, z);
    if (r > r1) r1 = r;
    if (a < a0) a0 = a;
    if (a > a1) a1 = a;
  }
  /* THE INNER RADIUS IS THE NEAREST POINT OF THE RECTANGLE, NOT OF ITS
   * CORNERS. The near face is a chord, so its midpoint is 0.55 m closer to
   * the axis here than either end of it, and a cut that starts at the corners
   * leaves a crescent of plate inside the hall — a lip the column stands
   * behind, at the one place the player walks up to it. Four point-to-segment
   * distances, which is the same arithmetic the corner loop is. */
  let r0 = Infinity;
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = C[i], [x1, z1] = C[(i + 1) % 4];
    const dx = x1 - x0, dz = z1 - z0;
    const t = Math.max(0, Math.min(1, -(x0 * dx + z0 * dz) / (dx * dx + dz * dz)));
    r0 = Math.min(r0, Math.hypot(x0 + t * dx, z0 + t * dz));
  }
  return { r0, r1, a0, a1 };
}

/**
 * The rail round the well, on the deck the shaft passes through. At the
 * balcony rail's own height, and it COLLIDES — see the note over
 * `standingWell` about why the rail is the safety and not the floor.
 *
 * ── IT IS LAID ON THE HOLE, IN THE HOLE'S OWN FRAME ───────────────────────
 *
 * `cut` is `annulus`'s return: the polar region the plate is actually missing,
 * quantised bearings and all. So the fence is two ARCS and two RADIAL runs
 * rather than the four sides of a rectangle — the hole is a polar shape and a
 * rectangle laid over it is the defect this replaces. The runs are inset
 * `PAD` onto the SOLID side of every edge, so the post's own footprint stands
 * on plate and the walkable floor stops before the drop does.
 *
 * ── AND IT DOES NOT STOP AT ANOTHER ROOM'S WALL ANY MORE ─────────────────
 *
 * #56's hall is 12 x 11 m and three decks tall, and the two rooms its shaft
 * passes are not clear of it: measured with `station.mjs`'s own separating-axis
 * test, the footprint overlaps `#61 The Underlift Pit` on deck 44 by 5.1 m and
 * `#48 Reactor hall` on deck 48 by 5.0 m. That predates this lane — the
 * gazetteer's overlap check compares places on the SAME deck, and a 26 m hall
 * on 40 is nobody's neighbour by that test.
 *
 * This used to skip any run whose middle stood inside one of those, on the
 * argument that both build their own floor at this deck's height, so a cut
 * under a room is a hole with a floor over it and a balustrade in the reactor
 * hall is a thing you walk into for no reason. HALF OF THAT IS TRUE. The
 * reactor hall's floor covers 29 m² of the cut and no more — the cut runs out
 * past its east wall — so skipping the runs left 149.8 m² of the deck-48 well
 * with no rail on it at all, measured by raycast, worse than the rectangle it
 * replaced. A room's wall is not evidence of a floor.
 *
 * So the fence is the WHOLE cut, every run, and where it crosses a room it is
 * the rail round a shaft that passes through that room, which is what it is.
 * The patch of reactor-hall floor left on the far side of it is 29 m² a player
 * can no longer reach, and that is the trade: unreachable is safe, and the
 * alternative is standing on air over 25 m. `station.mjs` raycasts a grid over
 * the whole cut and holds the unfenced leftover to zero square metres.
 */
function railWell(kit, M, deck, y, cut) {
  /* 0.12 m out from every edge, which is two thirds of the rail's own 0.18 m
   * thickness: the post then overhangs the hole by 0.03 and stands on 0.15 of
   * plate, so the fence reads as being ON the lip rather than floating over
   * it, and a capsule stopped by it is stopped on solid floor. */
  const PAD = 0.12;
  const r0 = cut.r0 - PAD, r1 = cut.r1 + PAD;
  const a0 = cut.a0 - PAD / r1, a1 = cut.a1 + PAD / r1;
  /* And each run is overlapped into its neighbours at the four corners by the
   * same PAD, because a 0.12 m slot at knee height is a slot a body fits. */
  const post = (x, z, w, d, ry) => {
    kit.slab(M.dark, w, 1.05, d, x, y + 0.52, z, { ry, collide: true, bevel: 0 });
    kit.slab(M.strip, w, 0.1, d, x, y + 1.08, z, { ry, collide: false, bevel: 0 });
  };
  /* RUNS OF ABOUT TWO METRES. A run is one box, so the arcs are chords and
   * the number is how far a chord may sag inside the circle it fences: 2 m at
   * r = 66 is 8 mm, which is nothing, and a single 15 m box would be 0.4 m
   * and would fence the wrong line. */
  const RUN = 2;
  for (const r of [r0, r1]) {
    const A0 = a0 - PAD / r, A1 = a1 + PAD / r;
    const n = Math.max(2, Math.ceil((r * (A1 - A0)) / RUN));
    const step = (A1 - A0) / n;
    for (let i = 0; i < n; i++) {
      const a = A0 + step * (i + 0.5);
      post(r * Math.sin(a), r * Math.cos(a), 2 * r * Math.tan(step / 2) * 1.06, 0.18, a);
    }
  }
  for (const a of [a0, a1]) {
    const R0 = r0 - PAD, R1 = r1 + PAD;
    const n = Math.max(2, Math.ceil((R1 - R0) / RUN));
    const step = (R1 - R0) / n;
    for (let i = 0; i < n; i++) {
      const r = R0 + step * (i + 0.5);
      post(r * Math.sin(a), r * Math.cos(a), 0.18, step + 0.02, a);
    }
  }
}

/**
 * ══ THE DECK PLATE, AND WHY IT IS AN ANNULUS AND NOT A DISC ═══════════════
 *
 * The atrium is a hole, so every deck is a ring. The plate runs from the
 * balcony's inner edge to the skin, and the balcony's inner edge IS the void's
 * lip — which is the one edge of this station a player will stand on and look
 * over, so it gets a rail, and the rail is drawn rather than a collider on its
 * own (`Props.addRailing`'s pattern: you can see what stops you).
 */
function buildDeckPlate(kit, M, deck) {
  const y = DECK_Y[deck];
  /**
   * THE STANDING'S SHAFT, PER DECK — see `standingWell`.
   *
   *   40  the column stands here, so the SOFFIT is cut and the plate is whole
   *   44  the shaft passes through: both are cut, and the well is railed
   *   48  the column's cap arrives at this floor, so the PLATE is cut and the
   *       soffit above it is left whole — there is nothing over it to see
   */
  const well = standingWell();
  const cutPlate = well && (deck === 44 || deck === 48) ? well : null;
  const cutSoffit = well && (deck === 40 || deck === 44) ? well : null;
  /* The floor: balcony lip out to the skin, in one merged annulus. THE HOLE
   * IT REPORTS is what gets railed — not `well`, which is only the request.
   * See `standingWell`: a second derivation of this region is precisely the
   * defect, so there is not one. */
  const hole = annulus(kit, M.deep, y - 0.3, 0.6, DRUM.atrium, DRUM.R, 72, { omit: cutPlate });
  /* The soffit over it — the next deck's underside, so a player on 40 looking
   * up sees a ceiling and not the sky. The top deck gets one too. It quantises
   * on its own 48 segments and is NOT railed: nothing stands on a ceiling. */
  annulus(kit, M.dark, y + DRUM.storey + 0.4, 0.8, DRUM.atrium, DRUM.R, 48, { collide: false, omit: cutSoffit });
  if (hole) railWell(kit, M, deck, y, hole);
  /* The balcony rail round the void, and the light under its lip: §3.1 rule 1
   * wants the void READ as the station's landmark, and an unlit edge at
   * twelve metres reads as a wall. */
  const n = 64;
  for (let i = 0; i < n; i++) {
    const a = TAU * (i / n);
    const x = DRUM.atrium * Math.sin(a), z = DRUM.atrium * Math.cos(a);
    const wide = 2 * DRUM.atrium * Math.tan(Math.PI / n) * 1.06;
    kit.slab(M.dark, wide, 1.05, 0.16, x, y + 0.52, z, { ry: a, collide: true, bevel: 0 });
    kit.slab(M.strip, wide, 0.1, 0.1, x, y + 0.02, z, { ry: a, collide: false, bevel: 0 });
  }
  /* THE SKIN. One wall, the full turn, floor to soffit — the thing that makes
   * the drum a drum from inside. Deck 44's is glass (the promenade, §3.1) and
   * the other two are plate with a window band. */
  const skinMat = deck === 44 ? M.glass : M.hull;
  const m = 96;
  for (let i = 0; i < m; i++) {
    const a = TAU * (i / m);
    const x = (DRUM.R + 0.3) * Math.sin(a), z = (DRUM.R + 0.3) * Math.cos(a);
    const wide = 2 * DRUM.R * Math.tan(Math.PI / m) * 1.06;
    kit.slab(skinMat, wide, DRUM.storey + 1.2, 0.7, x, y + (DRUM.storey + 1.2) / 2 - 0.3, z,
      { ry: a, collide: true, bevel: 0 });
    /* A pilaster every fourth bay, and a strip light on it — the wall of
     * `hangar 1`, `3` and `6` translated to a curve. Density, not absence:
     * `HANGAR.md`'s counter to the box is that a wall must have things ON it. */
    const P = sectorAt(deck, i * 360 / m)?.pilaster || 4;
    if (i % P === 0) {
      kit.slab(M.dark, 0.9, DRUM.storey, 1.1, (DRUM.R - 0.6) * Math.sin(a), y + DRUM.storey / 2, (DRUM.R - 0.6) * Math.cos(a),
        { ry: a, collide: false, bevel: 0 });
      kit.slab(M.strip, 0.24, DRUM.storey - 1.6, 0.12, (DRUM.R - 1.15) * Math.sin(a), y + DRUM.storey / 2, (DRUM.R - 1.15) * Math.cos(a),
        { ry: a, collide: false, bevel: 0 });
    }
  }
}

/**
 * THE LIT FLOOR CHANNEL, and which line of the walk it runs down. A sector's
 * own — a person navigating by the light in the floor is reading the arc they
 * are in, which is what a wayfinding system is.
 */
function channel(kit, M, S, a, sx, sz, wide, y) {
  const at = { centre: [0], outer: [3.2], inner: [-3.2], both: [-3.2, 3.2] }[S.channel] || [0];
  for (const dr of at) {
    const r = DRUM.ringR + dr;
    kit.slab(M.strip, wide * 0.9, 0.06, dr ? 0.28 : 0.5, r * sx, y + 0.04, r * sz, { ry: a, collide: false, bevel: 0 });
  }
}

/** The soffit's coffers, if this sector has any: one, two, or a flat ceiling. */
function coffer(kit, M, S, i, a, sx, sz, wide, y) {
  if (!S.coffer) return;
  for (let k = 0; k < S.coffer; k++) {
    const r = DRUM.ringR + (S.coffer === 1 ? 0 : (k ? 2.4 : -2.4));
    kit.slab(M.dark, wide * 0.86, 0.42, S.coffer === 1 ? 5.2 : 3.2, r * sx, y + DRUM.storey + 0.02, r * sz,
      { ry: a, collide: false, bevel: 0 });
  }
}

/**
 * The RING walk (§3.1 rule 3) — an outer walk on every deck, against the skin,
 * and on deck 44 it is the Promenade (#26) itself. What distinguishes the
 * three is the CORRIDOR TYPE (`CORRIDOR`), which is rule 2's whole point.
 */
function buildRing(kit, M, deck) {
  const y = DECK_Y[deck];
  const type = CORRIDOR[deck];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = TAU * (i / n);
    const sx = Math.sin(a), sz = Math.cos(a);
    const wide = 2 * DRUM.ringR * Math.tan(Math.PI / n) * 1.06;
    /**
     * ══ WHICH SECTOR THIS BAY IS IN ═══════════════════════════════════════
     *
     * `i % 2` was the only thing that varied along this loop, and a loop with
     * that as its only input has the drum's rotational symmetry: the walkway
     * probe measured the view at bearing 0 and the view at bearing 90 as the
     * SAME PICTURE, IoU 1.000, on every deck. The four junctions cut the ring
     * into four arcs and `sectorAt` hands back that arc's rhythm — the rib
     * spacing, where the lit floor channel runs, whether the soffit is
     * coffered. Four arcs with four rhythms have no rotational symmetry left
     * to find, which is the whole of the fix.
     */
    const S = sectorAt(deck, i * 360 / n) || { rib: 2, channel: 'centre', coffer: 0, pilaster: 4 };
    const rib = i % S.rib === 0;
    if (type === 'transit') {
      /* DECK 40 — the imported ribbed corridor's language: a rib every two
       * bays, signage frames between them, and the lit floor channel. The
       * imported module itself stands on the spines (`buildSpine`); the ring
       * carries its ribs so the deck reads as one corridor system. */
      if (rib) {
        kit.slab(M.hull, wide, 0.5, DRUM.ringW, DRUM.ringR * sx, y + DRUM.storey - 0.3, DRUM.ringR * sz, { ry: a, collide: false, bevel: 0 });
        kit.slab(M.dark, 0.5, DRUM.storey, 0.6, (DRUM.ringR - DRUM.ringW / 2) * sx, y + DRUM.storey / 2, (DRUM.ringR - DRUM.ringW / 2) * sz, { ry: a, collide: false, bevel: 0 });
      }
      channel(kit, M, S, a, sx, sz, wide, y);
      coffer(kit, M, S, i, a, sx, sz, wide, y);
    } else if (type === 'promenade') {
      /* DECK 44 — a continuous window wall outboard, doors inboard, and the
       * tram guideway visible through the glass. The skin is already glass on
       * this deck; what the ring adds is the mullion rhythm and the handrail
       * you stand at to watch the tram go past. */
      kit.slab(M.dark, 0.22, DRUM.storey, 0.3, (DRUM.R - 0.9) * sx, y + DRUM.storey / 2, (DRUM.R - 0.9) * sz, { ry: a, collide: false, bevel: 0 });
      if (rib) {
        kit.slab(M.wing, wide * 0.92, 0.09, 0.14, (DRUM.R - 1.6) * sx, y + 1.02, (DRUM.R - 1.6) * sz, { ry: a, collide: false, bevel: 0 });
        kit.slab(M.dark, 0.1, 1.0, 0.1, (DRUM.R - 1.6) * sx, y + 0.5, (DRUM.R - 1.6) * sz, { ry: a, collide: false, bevel: 0 });
      }
      channel(kit, M, S, a, sx, sz, wide, y);
      coffer(kit, M, S, i, a, sx, sz, wide, y);
    } else {
      /* DECK 48 — the service way: grating underfoot, conduit overhead, and a
       * cutaway into machinery every few bays. */
      kit.slab(M.dark, wide, 0.08, DRUM.ringW * 0.9, DRUM.ringR * sx, y + 0.34, DRUM.ringR * sz, { ry: a, collide: false, bevel: 0 });
      channel(kit, M, S, a, sx, sz, wide, y);
      coffer(kit, M, S, i, a, sx, sz, wide, y);
      if (rib) {
        for (const dr of [-1.1, -0.5, 0.1]) {
          kit.post(M.wing, 0.16, 0.16, wide, (DRUM.ringR + dr) * sx, y + DRUM.storey - 0.6, (DRUM.ringR + dr) * sz,
            { rx: Math.PI / 2, ry: a, radial: 6 });
        }
        kit.slab(M.status, 0.3, 0.3, 0.3, (DRUM.ringR - 2.4) * sx, y + DRUM.storey - 1.1, (DRUM.ringR - 2.4) * sz, { ry: a, collide: false, bevel: 0 });
      }
    }
  }
}

/**
 * The four SPINE corridors: radial, balcony to ring, on every deck. On deck 40
 * the +Z spine is the Concourse itself (§3.2 #9), so it is skipped there —
 * a corridor down the middle of a market hall would be the hall drawn twice.
 */
function buildSpines(kit, M, deck) {
  const y = DECK_Y[deck];
  const hw = DRUM.spineW / 2;
  for (const deg of DRUM.spines) {
    if (deck === 40 && deg === 0) continue;
    const a = deg * Math.PI / 180;
    const sx = Math.sin(a), sz = Math.cos(a);
    const r0 = DRUM.balcony, r1 = DRUM.roomR;
    const len = r1 - r0, rMid = (r0 + r1) / 2;
    kit.push(rMid * sx, y, rMid * sz, a);
    /* Two walls and a soffit. The floor is the deck plate, already there. */
    for (const s of [-1, 1]) {
      kit.slab(M.hull, 0.5, DRUM.storey, len, s * (hw + 0.25), DRUM.storey / 2, 0, { collide: true, bevel: 0 });
      kit.slab(M.strip, 0.1, 0.12, len * 0.9, s * hw, DRUM.storey - 0.9, 0, { collide: false, bevel: 0 });
    }
    kit.slab(M.dark, DRUM.spineW + 1, 0.4, len, 0, DRUM.storey + 0.2, 0, { collide: false, bevel: 0 });
    kit.pop();
  }
}

/**
 * The three lift lobbies (§3.1 rule 3). The car is `DeckLift`'s — the same
 * one the hangar uses, with the readout's numbers now naming real floors —
 * so the lobby here is built from the same `LIFT` constants the hangar's
 * bulkhead recess is, and `dressDeckLift` puts the car in it.
 */
function buildLobbies(kit, M, deck) {
  const y = DECK_Y[deck];
  for (const s of SHAFTS) {
    if (!s.decks.includes(deck)) continue;
    const a = Math.atan2(s.x, s.z);
    kit.push(s.x, y, s.z, a);
    /* A recess in a wall, 16 m wide and 8.4 tall — `LIFT.lobby`'s numbers,
     * which `DeckLift.DOOR` derives its opening from. Both jambs, a header,
     * and a shaft box behind so the car is not floating in the deck. */
    kit.slab(M.hull, 16, DRUM.storey, 0.8, 0, DRUM.storey / 2, 3.2, { collide: true, bevel: 0 });
    for (const j of [-1, 1]) kit.slab(M.dark, 1.4, 8.4, 3.0, j * 4.6, 4.2, 1.6, { collide: true, bevel: 0 });
    kit.slab(M.dark, 10, DRUM.storey - 8.4, 3.0, 0, 8.4 + (DRUM.storey - 8.4) / 2, 1.6, { collide: true, bevel: 0 });
    kit.slab(M.strip, 8.4, 0.14, 0.3, 0, 8.5, 0.2, { collide: false, bevel: 0 });
    kit.pop();
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  AN IMPORTED ROOM, PLACED                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Stand one decoded room at a place, with the engine's materials on it.
 *
 * ONE MESH PER MATERIAL, not one per part. Forty-four parts standing on their
 * own would be forty-four draw calls for one room against a 400-call budget
 * for the whole view (§12.2); merged by material they are nine. `hangar.mjs`'s
 * method is exactly this and the number it holds the deck to comes from it.
 *
 * `drop` is the parts NOT to draw — the Zocalo's end bulkheads, because the
 * hall opens onto the atrium at one end and onto the ring at the other, and
 * a sealed room would break §3.1 rule 5.
 */
/** Which rooms have already reported themselves missing. See `dressStation`. */
const _warnedRoom = new Set();

function placeRoom(world, group, place, opts = {}) {
  const room = roomOf(place.room);
  /* The caller checks `roomOf` first and builds from the kit when it is empty;
   * reaching here with no room means somebody called this directly. */
  if (!room) throw new Error(`Station: room '${place.room}' was not prepared — call prepareStation() first`);
  const M = stationMats(place.deck);
  const drop = new Set(opts.drop || []);
  const bins = new Map();
  for (const [name, geo] of room.parts) {
    if (drop.has(name)) continue;
    const key = materialKeyFor(name);
    if (!key) throw new Error(`Station: part '${name}' of ${place.room} has no row in PART_MATERIAL`);
    const mat = M[key];
    if (!mat) throw new Error(`Station: part '${name}' wants material '${key}', which no deck palette has`);
    let b = bins.get(mat);
    if (!b) bins.set(mat, b = []);
    b.push(geo);
  }
  const y = floorOf(place);
  let tris = 0;
  for (const [mat, geos] of bins) {
    /* The source geometries are the cache's and are reused on the next visit,
     * so the merge COPIES rather than consuming: `mergeGeos` in Props disposes
     * its inputs, which is right for a kit and fatal for a cache. */
    const merged = mergeShared(geos);
    tris += merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `station-room-${place.room}-${mat.userData.key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    /**
     * ══ A ROOM'S ORIGIN IS NOT ITS CENTRE ═══════════════════════════════
     *
     * The plan gives every place the CENTRE of its floor, because that is
     * what a footprint, an overlap test and a cull radius are all about. An
     * imported room's origin is wherever its exporter left it — the Zocalo's
     * is 2.19 m off one end of a 67.4 m hall — so setting the mesh's position
     * to the place's centre stands the room a half-length out of position.
     *
     * Measured before this line existed: the Concourse ran from z = 50.5 to
     * 117.9 against a drum whose skin is at 90, so a third of the hall was
     * outside the station and its door was thirty metres from where the plan
     * said it was. Nothing went red — the room stood up, the materials bound,
     * the colliders were built. It was `station.mjs`'s bounding boxes that
     * said so.
     */
    const b = room.bounds;
    const lcx = (b.min[0] + b.max[0]) / 2, lcz = (b.min[2] + b.max[2]) / 2;
    const cy = Math.cos(place.yaw), sy = Math.sin(place.yaw);
    mesh.position.set(
      place.x - (lcx * cy + lcz * sy),
      y,
      place.z - (-lcx * sy + lcz * cy),
    );
    mesh.rotation.y = place.yaw;
    mesh.updateMatrix();
    group.add(mesh);
    world.statics.push(mesh);
  }
  return tris;
}

/** Merge without disposing the sources — see `placeRoom`. */
function mergeShared(geos) {
  let verts = 0;
  for (const g of geos) verts += g.attributes.position.count;
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * The imported rooms are VISUAL (§2: "colliders are ours"). A trimesh is never
 * built from one — the corridor's floor has a 66 mm lit channel a capsule
 * wedges on, which is the exact failure `Props.seatOnGround` exists to avoid —
 * so a room gets a flat floor at its own level and boxes from its bounds.
 */
function roomColliders(world, place, opts = {}) {
  const P = world.physics;
  if (!P?.addStaticBox) return 0;
  const room = roomOf(place.room);
  const b = room.bounds;
  const y = floorOf(place);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw);
  const put = (lx, ly, lz, hx, hy, hz) => {
    const c = new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(place.x, y, place.z));
    P.addStaticBox(c, new THREE.Vector3(hx, hy, hz), q, { friction: 0.7 });
  };
  const hw = (b.max[0] - b.min[0]) / 2, hd = (b.max[2] - b.min[2]) / 2;
  /* The room is now CENTRED on the place — see `placeRoom` — so the collider
   * shell is too, and this used to add the room's own origin offset on top of
   * the place's position and put the walls a half-length away from the room. */
  const cx = 0, cz = 0;
  const h = b.max[1] - b.min[1];
  let n = 0;
  /* The floor, flat and one box. */
  put(cx, -0.3, cz, hw, 0.3, hd); n++;
  /* Two side walls the full length. */
  for (const s of [-1, 1]) { put(cx + s * (hw + 0.4), h / 2, cz, 0.4, h / 2, hd); n++; }
  /* The soffit. */
  put(cx, h + 0.3, cz, hw, 0.3, hd); n++;
  /* The ends, unless this room opens at one — the Concourse opens at both. */
  for (const s of [-1, 1]) {
    if (opts.openEnds) continue;
    put(cx, h / 2, cz + s * (hd + 0.4), hw, h / 2, 0.4); n++;
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LIGHT — the deck's rig, per deck, never a loader's (§9.1)             */
/* ══════════════════════════════════════════════════════════════════════════ */

function lightStation(world, deck) {
  const P = DECK_PALETTE[deck] || DECK_PALETTE[40];
  /**
   * ONE KEY DOWN THE ATRIUM, because the void is the station's own light
   * shaft and the thing every deck is read against. `lightDeck`'s pattern:
   * a directional key, a flat ambient that IS the colour of every shadow
   * under the cel model, and a fill from the opposite side.
   */
  const key = new THREE.DirectionalLight(P.key, 1.45);
  key.position.set(30, 120, -40);
  key.target.position.set(0, DECK_Y[deck], 0);
  world.scene.add(key); world.scene.add(key.target);
  world.levelLights.push(key, key.target);

  const amb = new THREE.AmbientLight(P.ambient, 0.42);
  world.scene.add(amb); world.levelLights.push(amb);

  const fill = new THREE.HemisphereLight(P.fill, P.fog, 0.34);
  world.scene.add(fill); world.levelLights.push(fill);
  return 3;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DRESS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHICH DECK IS "THE" DECK, AND WHY THERE IS ONE ════════════════════════
 *
 * Three decks 12.5 m apart are three floors at one (x, z), and `world.floorAt`
 * takes only (x, z) — it is the hook `Shovable`, every walker's step and every
 * dropped body ask "what is under me", and it has no way to say "the one you
 * are standing on". §5.2 says "flat `world.floorAt` per room", which is this
 * answered honestly: the ACTIVE deck is the one the player is on, it is the
 * only one whose residents are live (§11's pool re-seats round the player),
 * and everything else is on the far side of a floor.
 *
 * The player's own collision is not this: the deck plates are real static
 * boxes and Rapier holds him up. `floorAt` is for the things that walk.
 */
function activeFloorAt(world, x, z) {
  const deck = world._station?.deck ?? 40;
  const y = DECK_Y[deck] ?? 0;
  /* A place may sink its own floor — the cantina is half a deck down (§3.2
   * #14), the arena is a sunken ring. The plan's builders record it here so
   * one lookup answers for the whole station. */
  const sunk = world._station?.sunk;
  if (sunk) {
    for (let i = 0; i < sunk.length; i++) {
      const s = sunk[i];
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return y + s.dy;
    }
  }
  return y;
}

/**
 * Build the station. Called by `World._loadSteps`' dressing stage, which is
 * synchronous — `prepareStation()` has already run on the far side of the
 * door and the rooms are decoded.
 */
export function dressStation(world) {
  /**
   * WHICH DECK. `main.js` writes `_stationFloor` through `buildWorld`'s
   * `onWorld` before the level is built — the same door the deck's own
   * `_pickedLevel` comes through, and for the same reason: it is read by the
   * dressing, which runs after.
   *
   * ── AND IT IS NOT A SETTING ───────────────────────────────────────────
   *
   * It was `settings.stationDeck` for one commit, so that a check could pick a
   * deck without an `onWorld`. `controls.mjs` is right to refuse that: a key on
   * `settings` that `Settings.js` does not default is invisible to every guard
   * in that file — no control, no reader declaration, and nothing complains.
   * A deck is a property of THIS world, like `_pickedLevel`, so it lives where
   * `_pickedLevel` lives and a check writes it the same way.
   */
  const deck = world._stationFloor ?? 40;
  const M = stationMats(deck);
  const st = {
    deck,
    /* The deck's nine materials, published so anything that needs to TINT the
     * station has the same nine and cannot make a tenth — §9.1's whole rule.
     * `orderJump`'s transit amber is the first reader. */
    mats: M,
    /** Per-place groups, so §12.3's "places are drawn by their doors" is a
     * `.visible` flag and not a rebuild. */
    places: new Map(),
    sunk: [],
    draws: 0,
    /** Which place the arrival prompt last named. */
    promptedAt: undefined,
    /**
     * ══ WORK THE SEAM DOES NOT HAVE TO STAND STILL FOR ═════════════════════
     *
     * `dressStation` runs inside `World._loadSteps`, which is synchronous, and
     * every millisecond it spends is a millisecond the player is looking at a
     * photograph of a lift car (V15 §1.5). Profiled headless with the flight
     * deck already built — which is the only way a player ever reaches this
     * function — the dress is about 2.8 s, and `dressDeckBattle` is 477 ms of
     * it: fourteen instanced hulls, two hundred fighters and five engagements
     * in real geometry, OUTSIDE the glass.
     *
     * The car arrives with its doors SHUT (`dressDeckLift({arrive:true})`
     * starts in `STATE.OPENING`), so for the first 1.1 s of the new world
     * there is no line of sight out of it at all, let alone through a window
     * on the far side of a room. Work that cannot be seen for a second does
     * not belong in the interval the player is frozen for.
     *
     * So it goes on this queue and `drainStationBuild` — called first thing in
     * `stepStation` — spends it on the frames after the world is live, while
     * the doors are running their animation. Each entry is `{name, run}`, and
     * a `run` that returns `true` is asking to be called again next frame,
     * which is how a job too big for one frame slices itself (the people do).
     * `finishStationBuild` drains the lot at once for a caller that needs the
     * station whole and is not going to step it.
     */
    pending: [],
    tris: 0,
    solids: 0,
    /**
     * The station clock (§3.4). One game hour per two real minutes, and it
     * comes out of the station's own fold rather than the run's — §14: "a
     * return visit is the same station later in the day", and a run's bag
     * does not survive one.
     */
    hour: world.run?.stationHour ?? stationHour(),
    /**
     * WHICH DAY IT IS, ON THE STATION FROM THE FRAME IT IS DRESSED.
     *
     * `tickStationClock` republishes this every frame, but the pool primes on
     * the DRESS frame — `dressStationLife` seats residents before any update
     * has run — and `spawnResident` reads `st.day ?? 0`. Without this line the
     * first bodies in the room are day 0's people and the rest of the station
     * is today's, which is the two-answers-in-one-room failure the day was
     * centralised to end.
     */
    day: stationDay(),
    /** What the player calls this place (V15 §1.1). Read by every board. */
    name: stationName(),
    /** The height of this deck, for anything placing itself against it. */
    deckY: DECK_Y[deck] ?? 0,
    /**
     * WHICH WAR IS OUTSIDE, resolved once, here, and read by the tower's
     * traffic board so the fighters coming home on it are coming home from the
     * battle in the window. `outsideLevel` is the one resolver — see the note
     * over `configureOrbit` below about two skies that agree by coincidence.
     */
    theatre: outsideLevel(world)?.name || 'the line',
  };
  world._station = st;
  world._deckFaction = factionOf(world);
  world.floorAt = (x, z) => activeFloorAt(world, x, z);

  /* ── THE SHELL. One kit for the whole drum: the plate, the balcony, the
   * skin, the ring, the spines and the lobbies come out as one merged mesh
   * per material, which is nine draws for the room a player is standing in. */
  const shell = new Kit(4021);
  shell.weather = false;
  buildDeckPlate(shell, M, deck);
  buildRing(shell, M, deck);
  buildSpines(shell, M, deck);
  buildLobbies(shell, M, deck);
  /* ── AND WHAT IS ON THE WALKWAYS. `StationPlan.WAYS` is the ring's address
   * table and `JUNCTIONS` is what happens where a spine meets it; both are
   * read here so the between-space merges into the SAME nine meshes the shell
   * does — forty fixtures for no extra draw call. See `StationKit`'s own note
   * for the measurement that made this necessary. */
  st.ways = buildWays(shell, M, deck);
  const shellOut = shell.emit(world, new THREE.Vector3(0, 0, 0));
  /**
   * THE BETWEEN-SPACE, NAMED. Rule 4 measures the places from their doors and
   * the walkway rule measures the corridor between them from standing points
   * in it; the second needs to be able to say WHICH meshes are the corridor,
   * and a traverse of the scene cannot — the shell's merged meshes and a
   * crate's are both children of the scene root. Kept as the shell's own
   * draws so `station.mjs` can raster the drum without the crowd in it.
   */
  st.shell = shellOut.meshes;
  st.shellDraws = shellOut.meshes.length;
  st.shellTris = shellOut.triangles;
  st.draws += shellOut.meshes.length;
  st.tris += shellOut.triangles;
  st.solids += shellOut.boxes?.length || 0;

  /* ── THE PLACES ON THIS DECK. One group each, so a place is culled whole. */
  for (const place of placesOn(deck)) {
    if (place.band === 'ring') continue;
    const group = new THREE.Group();
    group.name = `station-place-${place.id}`;
    world.scene.add(group);
    st.places.set(place.id, { place, group, lit: true });
    if (place.room && roomOf(place.room)) {
      st.tris += placeRoom(world, group, place, {
        /* The Zocalo's end bulkheads come off: the hall opens onto the atrium
         * at its inner end and onto the ring at its outer, and §3.1 rule 5
         * says no room is sealed. */
        drop: place.room === 'zocalo' ? ['zoc_bulkhead'] : [],
      });
      st.solids += roomColliders(world, place, { openEnds: place.room === 'zocalo' });
      st.draws += group.children.length;
    } else if (place.room) {
      /**
       * ── THE MESH DID NOT ARRIVE, AND THE STATION STILL STANDS ───────────
       *
       * The three imported rooms are 1.5 MB of `.smesh` fetched at the door.
       * This branch used to be a `throw` inside `placeRoom` — correct for a
       * typo in the gazetteer, catastrophic for the way it actually happens: a
       * 404, a truncated download, a cold cache, a harness that boots the
       * level without `prepareStation()`. One missing file took the whole
       * world down, on the biggest space in the station.
       *
       * So the kit builds it instead (`SHAPES.vault`, `.daispit`, `.glassdome`),
       * and the player walks through a plainer room rather than into a stack
       * trace. Said ONCE per room per session, because a warning per place per
       * visit is a warning nobody reads.
       */
      if (!_warnedRoom.has(place.room)) {
        _warnedRoom.add(place.room);
        console.warn(`Station: room '${place.room}' did not load — #${place.id} `
          + `${place.name} is built from the kit instead.`);
      }
      const built = buildPlace(world, group, place, M, st);
      st.draws += built.draws;
      st.tris += built.triangles;
      st.solids += built.boxes;
    } else {
      const built = buildPlace(world, group, place, M, st);
      st.draws += built.draws;
      st.tris += built.triangles;
      st.solids += built.boxes;
    }
  }

  /**
   * ══ THE CAR YOU CAME UP IN ════════════════════════════════════════════
   *
   * SHARK §5.2: "the station dresses its own lift lobby from the same `LIFT`
   * constants and calls `dressDeckLift(world, { arrive: true })`." The same
   * car, the same shaft scene, the same doors — the only difference is that
   * it is standing in one of THIS place's three shafts rather than in the
   * flight deck's bulkhead, which is what `dressDeckLift`'s `at` is for.
   *
   * The car faces the drum's centre, because the doors open on lift-space +Z
   * and a player who steps out of a lift into a wall has been given a bug.
   */
  /**
   * WHICH OF THE THREE, and the answer is asked of the FLOOR ROW when the
   * world was not told.
   *
   * `main.enterStation` copies the row's `shaft` onto `world._stationShaft`,
   * so in the shipped game this is that row. It used to fall to the literal
   * `'arrivals'` when nothing had been set — which is every check, every
   * probe, and every deck whose row named no shaft — so the instrument and
   * the game could disagree about where the car was without either of them
   * being wrong on its own terms. Asking `liftFloors()` makes the default the
   * same table the door reads, and the literal below is only what is left
   * when a deck has no floor row at all.
   */
  const rowShaft = liftFloors().find((f) => f.deck === deck)?.shaft || null;
  const shaft = SHAFTS.find((sh) => sh.id === (world._stationShaft || rowShaft || 'arrivals') && sh.decks.includes(deck))
    || SHAFTS.find((sh) => sh.decks.includes(deck));
  if (shaft) {
    const r = Math.hypot(shaft.x, shaft.z) || 1;
    const k = (r + 3.2) / r;
    st.shaft = shaft;
    dressDeckLift(world, {
      arrive: true,
      /* WHICH FLOOR THE CAR IS STANDING ON. The button column starts on it,
       * so a player stepping out on 48 reads `48 <NAME> · WORKING DECK` and
       * not `07 BRIDGE` — see the note over `DeckLift`'s `pick`. */
      floor: deck,
      at: { x: shaft.x * k, y: DECK_Y[deck], z: shaft.z * k, yaw: Math.atan2(shaft.x, shaft.z) + Math.PI },
    });
  }

  lightStation(world, deck);

  /* ── AND THE PEOPLE (§11). The pool re-seats itself round the player on the
   * first frame, so a player who arrives at the Concourse at 13:00 walks into
   * a market rather than into an empty hall. */
  dressStationLife(world, st);
  /**
   * ── AND SEATING THEM IS SLICED, BECAUSE IT IS HALF THE SEAM ────────────
   *
   * Metered on this box with the flight deck already built: the station's
   * build costs about 2.1 s of CPU and 1.14 s of that is twenty-eight
   * humanoid bodies — a rig, sixty meshes and a `MergedSkin` chain each. It
   * was ONE uncapped re-seat inside `dressStationLife`, on the grounds that
   * the player was looking at a loading plate anyway. He is not: V15 §1.5
   * says there is no plate between the deck and the station, and what he is
   * actually looking at is a still of the car he is standing in.
   *
   * So the pool fills over the frames AFTER the world is live, a few bodies
   * at a time, and it has the whole of the door animation to do it in —
   * `dressDeckLift({arrive:true})` starts in `STATE.OPENING` and takes
   * `RIDE.doors` (1.1 s, about 66 frames) to part the leaves. The pool is
   * full long before the player can see a room, and `life.priming` stays true
   * until it is, so the seating is the same seating with the same budget
   * rather than the trickle a walk gets.
   */
  st.pending.push({ name: 'the people', run: () => primeStationLife(world) });
  if (deck === 44) dressTram(world, st, M);

  /* ── AND THE THINGS WITH WORDS ON THEM (V15 §1.1, §1.2). The obelisk is a
   * landmark before it is a leaderboard, so it is dressed with the room; the
   * boards are what make the station's name worth having. */
  dressObelisk(world, st, M);
  dressBoards(world, st, M);
  dressWayfinding(world, st, M);
  /* ── AND #25'S WALL, which is forty blank rectangles until something writes
   * on it. Measured before this line: `{"meshes":7,"texts":0}` in a room whose
   * verb is "read the notices". `Notices.js` reads the day's stores; nothing
   * here knows what a notice says. No-op on the two decks the room is not on. */
  dressNotices(world, st, M);
  /* ── AND THE PEOPLE BEHIND THE COUNTERS (V16 Lane B) ───────────────────
   *
   * AFTER `dressStationLife`, so the pool has already claimed its budget and
   * a keeper is an extra body rather than one taken off the crowd; and after
   * the places, because a keeper stands behind a desk the room's own shape
   * recorded. See `dressKeepers` for why they are not in the pool. */
  st.keeperCount = dressKeepers(world, st);

  /* ── AND THE ONE ROOM THAT IS YOURS (V15 §1.3) ─────────────────────────
   *
   * `SHAPES.twinroom` hands `#27` back on `st.home` and until now nothing read
   * it. `Home.js` is what reads it: the placement grid, the catalogue of real
   * bodies, the surfaces, the address on the door and the mirror. It is handed
   * this deck's `M` rather than importing `stationMats` for itself, which is
   * what keeps the two files acyclic — `StationKit` is imported by both.
   *
   * A no-op on every deck but 44, because only one place declares a home.
   *
   * ── AND IN CO-OP IT IS NOT ALWAYS `#27` ──────────────────────────────
   *
   * `V16.md` Lane F assigns every player a door and the host keeps `#27`, so
   * on a GUEST's machine their own dressing goes up behind whichever residence
   * the host gave them — `Coop.myApartment` is that lookup and it answers null
   * when there is no session, which is every solo game, so this line is what it
   * was off the wire. The friends' apartments follow on the first station step
   * rather than here, because a dressing arrives when its owner sends it and
   * that is after the level is built. See `Coop.dressApartments`. */
  dressHome(world, st, M, { place: myApartment(world) ?? st.home?.id });

  /* ── AND WHAT IS OUTSIDE THE GLASS ─────────────────────────────────────
   *
   * V15 §1.3: the home's *"windows that look out on the same space battle the
   * hangar sees."* §1.6 asks for the same thing from a Starfury. It is not two
   * features and it is not new art: it is the two calls the flight deck
   * already makes, made from here.
   *
   * `main.js` ALREADY resolves the theatre onto the station's world — it sets
   * `_pickedLevel` on the way in, through the same resolver the deck uses — so
   * `outsideLevel` answers the same record on both sides of the lift and the
   * planet outside deck 32's aperture is the planet outside #27's window. That
   * is the whole point of doing it this way rather than giving the station a
   * sky of its own: two skies that agree by coincidence do not stay agreeing.
   *
   * TWO LAYERS, BOTH THE DECK'S:
   *   `configureOrbit` is the shader window — planet, star, limb, starfield,
   *     at no draw calls at all.
   *   `dressDeckBattle` is the fleet action in real geometry: fourteen
   *     instanced draws, `fog:false`, stepped by `stepStation`.
   *
   * `forward` is +Z because that is the axis every glazed wall in the drum
   * faces: `walls(..., {glaze:true})` puts its glass on +Z in the place's own
   * frame, and a place's frame faces out of the drum. So the disc sits in the
   * window from inside the room, which is where somebody is standing.
   */
  const shown = outsideLevel(world);
  world.engine?.skyDome?.configureOrbit?.({
    level: shown,
    terrain: TERRAIN_PRESETS[shown?.terrain],
    faction: world._deckFaction,
    forward: [0, 0, 1],
    /* Lower than the deck's 0.22: the drum's windows are tall and start at
     * waist height, so the disc wants to sit ON the horizon of the glass
     * rather than 13° up where the soffit would cut it. */
    rise: 0.10,
  });
  /* NOT NOW — see `pending`. The fleet is outside a window the player cannot
   * see for at least the 1.1 s his doors take to open, and it is the single
   * biggest thing in this function that is true of. */
  if (shown) st.pending.push({ name: 'the fleet outside', run: () => dressDeckBattle(world) });

  /* ── AND SOMETHING TO THROW, from the first frame (§6 step 1). The station
   * is a sandbox and the cheapest proof of it is a crate in your hands. */
  const y = DECK_Y[deck];
  for (const [x, z] of [[3, 24], [-4, 26], [5, 30], [-6, 33], [2, 38], [-2, 42]]) {
    makeCrate(world, new THREE.Vector3(x, y + 0.5, z), 0.85);
  }
  return st;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  ORDER THE JUMP — V16 Lane A1's other half
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Warp` is a clock and a state machine that imports nothing; this is the
 * three things it drives, wired to the station that owns them. Keeping the
 * sequence ignorant of all of this is what makes it drivable in a check with
 * no world at all, and what makes "there should absolutely not be a loading
 * screen" a property a check can hold rather than a claim.
 */
export function orderJump(world, to) {
  const gate = canJump(world, to);
  if (!gate.ok) { world?.notify?.('COMMAND / CIC', gate.why); return false; }
  const st = world._station;
  world._warp = new Warp(to, {
    /* THE SHADER WINDOW. The same call `dressStation` makes, with the new
     * record — and `outsideLevel` answers it on the far side because
     * `arrived` below is what moves `_pickedLevel`. */
    orbit: (level) => {
      world.engine?.skyDome?.configureOrbit?.({
        level,
        terrain: TERRAIN_PRESETS[level?.terrain],
        faction: world._deckFaction,
        forward: [0, 0, 1],
        rise: 0.10,
      });
    },
    /* THE FLEET, struck and re-dressed. `dressDeckBattle` returns early on a
     * group that is already parented, so the undress is what makes the second
     * call build the new theatre's ships rather than keeping the old ones. */
    fleet: (on) => {
      if (!on) { try { undressDeckBattle(world); } catch {} return; }
      try { dressDeckBattle(world); } catch {}
    },
    /* TRANSIT AMBER, on every deck at once, and it is the deck palette's own
     * `strip` and `screen` rather than a new material — §9.1 holds during a
     * jump exactly as it holds standing still. */
    lights: (k) => {
      if (!st?.mats) return;
      const amber = 0xff9a30;
      for (const key of ['strip', 'screen']) {
        const m = st.mats[key];
        if (!m?.color) continue;
        if (!m.userData.warp0) m.userData.warp0 = m.color.getHex();
        _warpC.setHex(m.userData.warp0).lerp(_warpA.setHex(amber), k);
        m.color.copy(_warpC);
      }
    },
    /* THE STARFIELD: how far it is drawn into lines, and how far round the
     * bearing has swung. Both are uniforms the dome already carries. */
    stars: (k, swing) => {
      const u = world.engine?.skyDome?.mat?.uniforms;
      if (!u) return;
      if (u.uWarp) u.uWarp.value = k;
      if (u.uOrbitSpin) u.uOrbitSpin.value = swing;
    },
    /* THE DRUM GOES QUIET. `StationAudio` owns the bed; this is how far it is
     * ducked, and a station at transit stations has stopped talking. */
    quiet: (k) => { if (st) st.duck = k; },
    say: (line) => world.notify?.('COMMAND / CIC', line),
    arrived: (level) => {
      world._pickedLevel = level;
      /* AND THE BOARDS SAY IT. The departures board and the four platforms
       * name the station; where the station IS belongs beside that. */
      if (st) st.stamp = -1;
    },
  });
  return true;
}

/** Everything the station made, put down. `StationDirector.dispose` calls it. */
export function undressStation(world) {
  const st = world._station;
  if (!st) return;
  /* Anything still queued is not going to be built now — see `pending`. A job
   * closes over this world, and running one against a scene being taken down
   * is how a disposed room comes back as a leak. */
  st.pending.length = 0;
  /* THE HOME IS SAVED BEFORE ANYTHING IS TAKEN DOWN, which is V15 §1.3.5's
   * "saved on leaving" and `DeckEdit.leaveDeck`'s pattern: the record is
   * authored in memory across a visit and committed once, here, on the way
   * out. `leaveHome` reads the bodies' real positions, so it has to run while
   * they are still bodies. */
  leaveHome(world);
  undressHome(world);
  for (const rec of st.places.values()) {
    rec.group.parent?.remove(rec.group);
    rec.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  st.places.clear();
  /* WHAT IS OUTSIDE GOES DOWN TOO, and the shader window is CLEARED rather
   * than left set: `configureOrbit(null)` is what stops a ground deployed
   * after a station visit finding a planet still published on the broker and
   * lighting itself off it. `SkyDome.configureOrbit` says so in as many words
   * at its own null branch, and the deck learned it the hard way. */
  undressDeckBattle(world);
  world.engine?.skyDome?.configureOrbit?.(null);
  /**
   * A SORTIE IN THE AIR IS LANDED, NOT ABANDONED (§7). `Sortie.finish` exists
   * for exactly this — a save, a teardown, a disconnect — and a launch dropped
   * halfway would leave `_flying` set on a world being disposed and the fold
   * unwritten. The fold is committed here for `leaveHome`'s reason two
   * paragraphs up: authored across a visit, written once on the way out.
   */
  if (world._sortie && !world._sortie.done) world._sortie.finish();
  world._sortie = null;
  world._flying = false;
  world._orbitU = 0;
  /* …and the craft that was flying it. One `Starfury` and its throttle map,
   * which is the whole of what a sortie allocates. */
  world._pilot = null;
  if (world._flight) { try { setFlightState(world._flight); } catch {} }
  world._flight = null;
  st.bells = [];
  /* AND THE PEOPLE BEHIND THE COUNTERS. They are NOT in `StationLife`'s pool —
   * see `dressKeepers` — so nothing else takes them down, and a body left in
   * `world.enemies` pointing at a disposed room is the leak this file's own
   * teardown exists to prevent. */
  for (const k of st.keepers || []) {
    try { k.body?.dispose?.(); } catch { /* already gone */ }
    const i = world.enemies?.indexOf(k.body) ?? -1;
    if (i >= 0) world.enemies.splice(i, 1);
  }
  st.keepers = [];
  world._station = null;
  world.floorAt = null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LEVEL RECORD                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * In the shape of `HANGAR_LEVEL` and registered from `Levels.js` the same way
 * the deck is — from there, and behind `STATION_ENABLED`, so this file imports
 * no levels and cannot be half of a cycle. See `Levels.js`'s note on why the
 * dependency points that way.
 */
export const STATION_LEVEL = {
  name: 'The Station',
  blurb: 'A crossroads port. The whole cast lives here, and the lift is the only door.',
  terrain: 'hangardeck',
  /* Where the lift puts you down on deck 40: in the atrium lobby, facing the
   * Concourse. `_playerSpawn`'s literal default is [0, 8] and the deck's own
   * header records what landing 56 m from where the room means costs. */
  start: [-24, 2],
  pool: [],
  groundColor: 0x2b2118,
  spawnRadius: [6, 10],
  grass: 0,
  atmosphere: {
    sky: false, bgColor: 0x0d0a07, fog: true, fogColor: 0x2b2118, fogDensity: 0.009,
    sunColor: 0xffe4bc, sunIntensity: 2.6, ambient: 0.26,
    skyColor: 0x3a2e22, groundColor: 0x1a1410, elevation: 62, azimuth: 0,
    fillColor: 0xd8b48a, fillIntensity: 0.28,
    exposure: 1.2, bloom: 0.30, saturation: 1.03,
    lift: [0.006, 0.005, 0.004], gain: [1.04, 1.0, 0.96],
  },
  /* A station is not silent and it has no wind (§14: "a silent room is a box
   * with the lights on"). The bed is the drum: air handling, a low hum, and
   * the crowd. `StationAudio` gives each deck its own; this is the floor. */
  ambience: { wind: 0.0, windFreq: 90, drone: 0.24 },
  dust: { count: 260, color: 0xd8c2a0, opacity: 0.09, size: 11 },
  dress: dressStation,
};

/**
 * A director that directs nothing, for `HUD.update`'s four unguarded fields —
 * the same four `HangarDirector` exists for, and the same reason it is not a
 * `WaveDirector` subclass: a spawn queue and a liveness watchdog in a place
 * whose whole promise is that nothing happens unless you ask.
 */
export class StationDirector {
  constructor(world) {
    this.world = world;
    this.wave = 0;
    this.active = false;
    this.intermission = 1e9;
    this.done = false;
    this.roster = null;
  }

  state() { return { progress: 0, need: Infinity }; }

  dispose() {
    try { undressDeckLift(this.world); } catch {}
    try { undressStationLife(this.world); } catch {}
    undressStation(this.world);
  }

  update(dt, ctx = null) {
    this.world._deckInput = ctx?.input || null;
    stepStation(this.world, dt);
    /* AFTER the places have been culled, because the pool only offers bodies
     * out of places that are drawn — and before the lift, which is the one
     * thing on the station that moves the player. */
    stepStationLife(this.world, dt);
    stepDeckLift(this.world, dt);
  }

  /**
   * ══ WHAT A JOINING PLAYER RUNS, AND IT IS ALL OF IT ═══════════════════════
   *
   * `World.update` gates `director.update` off on a client and that gate is
   * right for every OTHER director in the game: a wave director owns a spawn
   * queue, and two machines composing their own waves out of the same level is
   * two games in one room. This director owns no queue. So the question is not
   * "how much of the station may a guest run" but "which parts of it are
   * anybody else's", and gone through one call at a time the answer is: none.
   *
   *   THE CLOCK is the one shared fact, and it is corrected rather than owned
   *   — `tickStationClock` runs here so the hour moves every frame instead of
   *   eighteen times a second, and `World.applySnapshot` snaps it to the
   *   host's `sh`. It does NOT persist on a guest; see that function.
   *
   *   THE RESIDENTS are seeded, not simulated: `occupant(place, i, {hour,
   *   day})` and `slotIn` are pure, so two machines that agree about the clock
   *   seat the same people in the same chairs with nothing on the wire. That
   *   is why `packSnapshot` now skips them — see the note there for the
   *   measurement (host 37 bodies, guest 72) and for what it costs.
   *
   *   THE LIFT IS YOURS. Two players are in two cars on two decks; a lift
   *   driven from somebody else's press is a floor you did not choose.
   *
   *   AND SO IS EVERYTHING ELSE `stepStation` calls: your ward mending
   *   (`stepMedbay` reads YOUR company), the piece in your hands (`stepHome`),
   *   your own jump (`_warp`), your own sortie, your own bells, and the cull
   *   and the arrival prompt, which are both about where your camera is. The
   *   boards and the notices reroll off the day alone, so with the clock
   *   agreed they agree too.
   *
   * Which leaves this method as one call, and that is the finding stated as
   * code: there was never anything here to gate.
   */
  guest(dt, ctx = null) { this.update(dt, ctx); }
}

/**
 * ══ THE CULL: A PLACE IS DRAWN BY ITS DOOR (§12.3) ════════════════════════
 *
 * Fifty places on one level would be fifty groups drawn every frame and the
 * 400-call bound blown by the shell alone. The plan table gives every place
 * its door, so a place is visible when its door is inside `CULL` metres — and
 * the atrium is the one long sightline, so anything whose door is ON the
 * balcony stays drawn as far as the void reaches.
 *
 * Nothing is allocated here and nothing closes over the loop: the rule every
 * deck file already keeps (§12.3), and what makes this affordable at all.
 */


/* ══════════════════════════════════════════════════════════════════════════ */
/*  NAMING IT (V15 §1.1)                                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHERE YOU TYPE IT, AND IT IS NOT AT #56 ═══════════════════════════════
 *
 * V15 §1.1 says exactly where: *"the Databank terminal (#13) and the plan
 * table in your own cabin."* It was at #56 and only #56 — under a prompt
 * reading *"read the rolls — find your own row"*, which is a different
 * sentence about a different feature. Two defects in one key: the obelisk's
 * verb did not do what it said, and naming was hidden in one hall a player may
 * never press a key in, so the whole of §1.1 could go unfound in a session.
 *
 * Both doors are physical, which is §14's rule and the obelisk's own argument:
 *
 *   #13  `StationBoards.dressRegister` puts a REGISTER panel over the reading
 *        room's nearest terminal. Stand at it and the key names the station;
 *        stand anywhere else in the rotunda and it opens the codex, which is
 *        what #13's gazetteer verb has always said.
 *   #27  the MAP TABLE in your own cabin — `Home.DEFAULT_LAYOUT`'s `table`,
 *        the piece §1.1 calls the plan table. `atPlanTable` claims the key
 *        within 1.6 m of it, ahead of `homeKey`; step back and the same press
 *        picks the table up as it always did. That is the same bargain the
 *        mirror and the galley already make in `Home.js`, one fixture further
 *        on, and it is why the reach is short.
 *
 * AND THE PA IS THE ONE §1.1 ASKS FOR THAT IS REFUSED, WITH A REASON. The
 * list ends *"…the Databank's station page, and the PA."* There IS a PA —
 * `DeckAudio`'s tannoy — and its own header spends a page arguing that it must
 * never say words: *"A PA that says a sentence is a NARRATOR. The player looks
 * up, listens, decodes it, finds it says nothing that matters, and never
 * listens again."* It is a formant synthesiser with the consonants left out,
 * on purpose, and it has no text input to give a name to. Making it say
 * `CROSSROADS` means giving it speech, which is the one thing that file is
 * built not to have. So four of the five places are built and the fifth is
 * declined here rather than faked with a caption nobody hears.
 *
 * The mechanism is `DeckEdit`'s, which is this game's own idiom for typing a
 * name in the world — a document keydown listener, a text buffer, the banner
 * as the field, Enter to commit and Escape to drop it. It is written again
 * here rather than generalised out of that file because `DeckEdit`'s is bound
 * to a HELD MAN at every line (`st.held.rec.designation`, `applyEdit`), and
 * pulling a shared naming widget out of it would be a refactor of the deck's
 * editor to buy sixty lines — which is the trade §2.4 warns about in the
 * other direction.
 *
 * THE SUPPRESSION IS THE SAME `return` DeckEdit uses, and for its reason: the
 * letters a player is typing into a station name are also W, A, S and D.
 */
export function namingStation(world) { return !!world?._station?.naming; }

/** How close you stand to a naming fixture. 2.0 m at the register, which is a
 * desk you walk up to; 1.6 m at the map table, which is short deliberately —
 * see the note over `beginStationName` about what the key does further back. */
const REGISTER_REACH = 2.0;
const TABLE_REACH = 1.6;

/** Standing at #13's register terminal? `dressBoards` put the panel there. */
export function atRegister(world) {
  const r = world?._station?.register;
  const p = world?.player?.position;
  if (!r || !p) return false;
  const dx = p.x - r.x, dz = p.z - r.z;
  return dx * dx + dz * dz < REGISTER_REACH * REGISTER_REACH;
}

/**
 * Standing at the plan table in YOUR OWN cabin? (V15 §1.1)
 *
 * The map table is a piece of furniture rather than a fixture — `Home.js`
 * makes the cabin's floor a placement grid and `DEFAULT_LAYOUT` puts a `table`
 * on it — so where it is is wherever the player last set it down, which is why
 * this reads the record's row rather than a built position. Never while a
 * piece is held: that press is `dropPiece`'s and `homeKey` claims it one line
 * below.
 */
export function atPlanTable(world) {
  const h = world?._home;
  const p = world?.player?.position;
  if (!h || !p || h.held || !h.mine || !inHome(world)) return false;
  for (const row of h.state?.pieces || []) {
    if (row.k !== 'table') continue;
    const x = h.spot.x + row.x * h.cos + row.z * h.sin;
    const z = h.spot.z - row.x * h.sin + row.z * h.cos;
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz < TABLE_REACH * TABLE_REACH) return true;
  }
  return false;
}

/**
 * ══ WHERE THE SHOP IS, AND IT IS NOT A CIRCLE ═════════════════════════════
 *
 * How far in front of a desk's face you can stand and still be at it, and how
 * far past its ends. 2.0 m is one pace back from the counter plus the arm you
 * reach over it with; 0.7 m at the ends is standing at the corner of it.
 *
 * ── A RADIUS WAS TRIED FIRST AND A BROWSER KILLED IT TWICE ───────────────
 *
 * The first cut was 2.4 m round the desk's middle. Driven with the real key:
 *
 *   #10 The Forge      the desk is 0.4 m off the middle of a 13 × 10 room, so
 *                      the circle covered the whole middle of it and the room
 *                      centre answered `onCounter:armourer` — the hilt bench
 *                      was unreachable, which is the SAME defect one branch
 *                      over from the one being fixed.
 *   #11 Quartermaster  the hatch is in the front wall, so the customer stands
 *                      OUTSIDE the cage in the Concourse; `placeUnder` there
 *                      answers #9, and the branch offered the CLOTHIER at the
 *                      quartermaster's hatch.
 *
 * A desk has a front, a back and a width. A circle has none of those, and the
 * second failure is worse than the first: which room you are technically
 * inside is not the same question as which counter you are standing at, and
 * for a hatch in a wall the two answers are always different.
 *
 * So the test is in the DESK'S own frame — `StationKit.counter` records the
 * middle, a point one metre out on the customer's side and the keeper's spot,
 * all in world coordinates, and `front − at` is the unit vector that
 * reconstructs the frame — and it is run over EVERY desk on the deck rather
 * than over the ones belonging to the room `placeUnder` named.
 */
const COUNTER_REACH = 2.0;
const COUNTER_SIDE = 0.7;

/**
 * WHICH SHOP YOU ARE STANDING AT, OR NULL.
 *
 * Three steps, in this order, and the order is the whole of it:
 *
 *   1. EVERY DESK ON THE DECK. You are at a counter if you are in front of its
 *      face, within `COUNTER_REACH` of it and no more than `COUNTER_SIDE` past
 *      either end. Deck-wide and not room-scoped, because #11's hatch is
 *      served from outside its own room.
 *   2. THE ROOM ITSELF, but only if that room's shape built NO desk. Three of
 *      the seven are in that state and all three are honest: `#9 The
 *      Concourse` is an imported mesh (`zocalo.smesh`) with no kit desk in it,
 *      `#32 Narn quarter` is a stone floor with braziers, and `#58 The
 *      Underlift` sells over a plank across a container — its own shape says
 *      so in as many words. None of the three carries a kiosk, so the room
 *      being the counter shadows nothing.
 *   3. Otherwise nothing, and the press falls through to the kiosk. That is
 *      what makes the Forge's bench and the cage's paint racks reachable.
 *
 * A room with several desks (the food court has three) answers on whichever
 * one you are at, and one counter serves them all — a row of stalls is one
 * vendor's frontage.
 */
export function counterHere(world, place) {
  const p = world?.player?.position;
  const st = world?._station;
  if (p && st?.counters) {
    let best = null, bestD = Infinity;
    for (const [placeId, desks] of st.counters) {
      const shops = countersAt(placeId);
      if (!shops.length) continue;
      for (const d of desks) {
        if (!d.front) continue;
        /* The desk's own frame, from two points: `f` is the unit vector from
         * the middle of the desk to a metre out on the customer's side, so
         * `along` is how far in front of it you are and `side` is how far off
         * its centre line. No yaw, no push stack, no room. */
        const fx = d.front.x - d.at.x, fz = d.front.z - d.at.z;
        const dx = p.x - d.at.x, dz = p.z - d.at.z;
        const along = dx * fx + dz * fz;
        const side = dx * fz - dz * fx;
        if (along < 0 || along > d.d / 2 + COUNTER_REACH) continue;
        if (Math.abs(side) > d.w / 2 + COUNTER_SIDE) continue;
        if (along < bestD) { bestD = along; best = shops[0]; }
      }
    }
    if (best) return best;
  }
  const shops = countersAt(place?.id);
  if (!shops.length) return null;
  const desks = world?._station?.counters?.get(place.id);
  return (desks && desks.length) ? null : shops[0];
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE KEEPERS — `Vendors.keeper` gets its first reader
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every counter in `Vendors.js` has carried a `keeper` since the table was
 * written — `ARMOURER.keeper` is `{role:'smith', species:'human', helm:true}`
 * — and until now `offerFrom` returned it and NOBODY read it. No body was
 * built, no species, no helmet; #10's gazetteer row still said the smith was a
 * Wookiee, and V16 §A4 asked for a Mandalorian. A field declared and never
 * read is the dead control this tree keeps deleting, and this one had a
 * player's sentence behind it.
 *
 * So a keeper is a BODY, standing behind the desk `StationKit.counter()`
 * recorded, drawn from the station's own census exactly as every other
 * resident is: `StationCast.resident(seed)` picks the species, the name and
 * the frame, and `spawnEnemy(res_<species>)` builds it. Nothing new is
 * modelled and no new archetype exists — the whole of this is a seed and a
 * position.
 *
 * ── THE SEED IS THE COUNTER AND THE DAY, WHICH IS THE SHELF'S OWN ────────
 *
 * *"the same shop owner doesnt always look the same like between runs or maybe
 * deaths idk everything other than your apartment/companion should be
 * refreshed/randomized."* So the keeper rerolls on the day, off the same
 * `(counter, day)` shape the shelf uses and for the same reason: everyone on
 * the station meets the same trader on the same day, and walking out and back
 * in does not fetch a different one. `Math.random` is refused in `src/`.
 *
 * ── AND THEY ARE ON YOUR SIDE, LIKE EVERY OTHER RESIDENT ────────────────
 *
 * §11: `team = player.team`, so nothing in the game hunts a shopkeeper and no
 * director can be handed one as an objective. Set after the spawn because
 * `Enemy`'s constructor writes `team = 1` outright — `StationLife.spawnResident`
 * hit the same edge and its note is the authority.
 *
 * They are NOT in `StationLife`'s pool and must not be: that pool re-seats on
 * distance and would despawn the one person in the room you came to see. Five
 * bodies on deck 40, one on 44, one on 48 — measured at 4 draws each on the
 * merged rung, against §12.2's 400.
 */
function keeperSeed(counter, day) { return `keep:${counter.id}:${day | 0}`; }

/**
 * ══ WHAT A KEEPER'S ROW PUTS ON HIM ═══════════════════════════════════════
 *
 * `Vendors.keeper` has carried two APPEARANCE fields since the table was
 * written — `helm` and `mando` — and until now the only thing either of them
 * reached was `keeperOf`, which handed them straight back out again to a
 * check. The Forge's row said `{helm: true, mando: true}`, #10's gazetteer row
 * said *"Bo Vhett, a Mandalorian smith"*, V16 §A4 asked for *"maybe a
 * mandalorian"* — and the man actually standing behind that counter was a
 * human in robes, measured: `res_human`, 62 meshes, no plate and no bucket.
 * A field that only a check can see is the dead control this tree keeps
 * deleting, and these two had a player's sentence behind them, so they get a
 * reader instead.
 *
 * TWO FIELDS, TWO INDEPENDENT ANSWERS, because they are two different facts:
 *
 *   `mando`  WHICH KIT. Beskar — the shop is called "Bo Vhett, beskar and
 *            blade" — over the `jet` rig, which is the one set in
 *            `ARMOUR_KITS` whose whole read is the pack between the shoulder
 *            bells. A Mandalorian is a jet pack and a T-visor at any range,
 *            and both of those are geometry `buildTrooper` has always had.
 *            The plate is `ice`, which is the paint the armourer's own
 *            1900-credit `beskar` row sells: "It is not paint. It is the
 *            metal." A rust flash and a gold visor off the same rack.
 *   `helm`   WHETHER THE BUCKET IS ON, and there is NO DEFAULT. `armourOf`
 *            reads an absent `helmet` as a bucket, which is right for a
 *            player's saved wardrobe — an old save must not strip a man's
 *            helmet off — and wrong for a table where the field IS the
 *            declaration: written that way, deleting `helm: true` from the
 *            Forge's row changed nothing, which is a field that reads as
 *            load-bearing and is not. So `!!want.helm`, and a row that wants
 *            the bucket says so. `buildTrooper` builds the same head
 *            `buildJedi` does when it is off, so a keeper with the helmet
 *            down has his own face, his own species and his own hair —
 *            exactly what the shop's own `helm-off` row sells the player.
 *
 * A row with neither is the seven other counters and gets `null`, which is
 * `armourOf`'s own "no armour" and returns `buildPlayerBody` to `buildJedi`
 * untouched. A row with `helm` and no `mando` is a keeper in line plate with
 * the bucket on, because a helmet has to sit on a set of plates.
 *
 * Pure and exported so a check can hold a row against the body it produces
 * without booting a world — and so nothing has to restate the table.
 */
export function keeperArmour(want) {
  if (!want || (!want.mando && !want.helm)) return null;
  return want.mando
    ? { id: 'jet', helmet: !!want.helm, plate: 'ice', accent: 'rust', visor: 'sun' }
    : { id: 'line', helmet: true, plate: 'bone', accent: 'ash', visor: null };
}

export function dressKeepers(world, st) {
  if (!world?.spawnEnemy) return 0;
  const day = stationDay();
  let made = 0;
  st.keepers = [];
  for (const c of COUNTERS) {
    const rec = st.places.get(c.place);
    if (!rec) continue;
    const desks = st.counters?.get(c.place);
    const p = rec.place;
    /* Behind the desk if the room built one; otherwise in the middle of the
     * room, which is where the two rooms without a desk put their trader —
     * see `counterHere` for why those two have none. */
    const spot = desks?.[0]?.behind
      || { x: p.x, y: floorOf(p), z: p.z };
    const yaw = desks?.[0]?.yaw ?? (p.yaw + Math.PI);
    /* The keeper's own row decides the species and the job; the seed decides
     * everything the row leaves open, which is most of a person. */
    const seed = keeperSeed(c, day);
    const want = c.keeper || {};
    let who = null;
    try {
      who = resident(seed, {
        species: want.species && want.species !== 'any' ? want.species : undefined,
        role: want.role || undefined,
      });
    } catch { who = null; }
    if (!who) continue;
    /* WHAT THE ROW PUTS ON HIM — see `keeperArmour`. It rides on the SPAWN
     * because plate is geometry and the builder runs inside `Enemy`'s
     * constructor; `Enemy`'s own note on `look` argues this for the whole
     * family and this is the fourth member of it. */
    const armour = keeperArmour(want);
    let body = null;
    try {
      body = world.spawnEnemy(`res_${who.species}`, new THREE.Vector3(spot.x, spot.y + 0.1, spot.z),
        { team: world.player?.team ?? 0, ...(armour ? { armour } : {}) });
    } catch { body = null; }
    if (!body) continue;
    body.team = world.player?.team ?? 0;
    body.stationResident = true;
    body.stationName = want.name || who.name;
    body.stationRole = want.role || who.role;
    body.stationSpecies = who.species;
    body.stationFaction = who.faction;
    body.stationPlace = c.place;
    /** What makes this one a shopkeeper rather than a passer-by. Read by the
     *  counter panel, so the shop can say who is behind it. */
    body.stationKeeper = c.id;
    if (body.brain) body.brain.idle = true;
    if (body.rotation) body.rotation.y = yaw;
    body.position?.set(spot.x, spot.y + 0.1, spot.z);
    /** What he has on, so the panel and the checks read the SAME answer the
     *  builder was given rather than a second opinion about the row. */
    body.stationArmour = armour;
    st.keepers.push({ id: c.id, body, who: { ...who, name: want.name || who.name },
      helm: !!want.helm, mando: !!want.mando, armour, x: spot.x, z: spot.z });
    made++;
  }
  return made;
}

/**
 * WHO IS BEHIND A GIVEN COUNTER, as a plain row. The panel's reader.
 *
 * It answers off the dressed body when there is one and off the seed when
 * there is not — a check with no world still gets a name, a species and
 * whether the man is helmed, which is the whole of what the shop says about
 * him and is what makes the Mandalorian at #10 a fact rather than a field.
 *
 * ── AND IT NOW HAS A CALLER THAT IS NOT A CHECK ───────────────────────────
 *
 * "The panel's reader" was a description of a function nothing in `src/`
 * called: `tools/checks/counter.mjs` invoked it directly and the counter
 * panel printed the shop's NAME and the purse and nothing about the man over
 * the counter at all. `main.showCounter` reads it now and prints `said` under
 * the shop sign, so the Mandalorian at #10 is something a player is told as
 * well as something a body shows. A function whose only caller is the check
 * that tests it is the same defect as a field nothing reads.
 */
export function keeperOf(counterOrId, world = null, day = null) {
  const c = typeof counterOrId === 'string' ? counterById(counterOrId) : counterOrId;
  if (!c) return null;
  const want = c.keeper || {};
  const live = day == null ? world?._station?.keepers?.find((k) => k.id === c.id) : null;
  const who = live?.who || resident(keeperSeed(c, day == null ? stationDay() : day), {
    species: want.species && want.species !== 'any' ? want.species : undefined,
    role: want.role || undefined,
  });
  return {
    counter: c.id,
    /* A ROW MAY NAME ITS KEEPER, and one does: the Forge's shop sign and #10's
     * gazetteer line both read "Bo Vhett", so that man does not reroll. Every
     * other counter's keeper is a seed and turns over with the day. */
    name: want.name || who.name,
    species: who.species,
    role: want.role || who.role,
    helm: !!want.helm,
    /** V16 §A4: the Forge's smith is a Mandalorian and keeps the bucket on. */
    mando: !!want.mando,
    /** The plate the row puts on him — `keeperArmour`'s answer, so the panel
     *  and the body cannot disagree about what he is wearing. Null for the
     *  six keepers who stand behind their counters in their own clothes. */
    armour: live?.armour ?? keeperArmour(want),
    /** ONE LINE FOR THE PANEL, built from the same four facts. */
    said: describeKeeper(want.name || who.name, who.species, want.role || who.role, want),
    built: !!live?.body,
  };
}

/**
 * A keeper in one sentence — the shop's own line under its sign.
 *
 * The species and the job are what every resident on the station has; the
 * bucket and the beskar are what the row adds, and they are named ONLY when
 * the row declares them, so six counters read "Thulith, a drazi clothier" and
 * #10 reads "Bo Vhett, a helmed Mandalorian smith". Written here rather than
 * in `main.js` because the sentence is a fact about the row and this is the
 * file that owns the row's meaning.
 */
function describeKeeper(name, species, role, want) {
  const bits = [];
  if (want?.helm) bits.push('helmed');
  bits.push(want?.mando ? 'Mandalorian' : String(species));
  bits.push(String(role));
  return `${name}, a ${bits.join(' ')}`;
}

export function beginStationName(world) {
  const st = world?._station;
  if (!st) return false;
  if (st.naming) { endStationName(world); return false; }
  st.naming = { text: st.name === DEFAULT_NAME ? '' : st.name };
  const d = globalThis.document;
  if (d?.addEventListener) {
    st._keys = (e) => {
      if (!st.naming) return;
      e.preventDefault?.();
      typeStationName(world, e.key);
    };
    d.addEventListener('keydown', st._keys);
  }
  world.notify?.('NAME THE STATION', `${st.naming.text}_  —  enter to set, escape to leave it`);
  return true;
}

/** One keystroke. Published so a check can drive it with no DOM. */
export function typeStationName(world, key) {
  const st = world?._station;
  if (!st?.naming) return false;
  if (key === 'Enter') { commitStationName(world); return true; }
  if (key === 'Escape') { endStationName(world); return true; }
  if (key === 'Backspace') st.naming.text = st.naming.text.slice(0, -1);
  /* One printable character at a time. `key` is 'Shift', 'ArrowLeft' and forty
   * other words for a keystroke that is not a letter, and a length test is the
   * whole filter — the same one `DeckEdit.typeName` uses. */
  else if (key && key.length === 1 && st.naming.text.length < NAME_MAX) st.naming.text += key;
  else return false;
  world.notify?.('NAME THE STATION', `${st.naming.text}_  —  enter to set, escape to leave it`);
  return true;
}

export function commitStationName(world) {
  const st = world?._station;
  if (!st?.naming) return null;
  const text = st.naming.text;
  endStationName(world);
  st.name = setStationName(text);
  /* Every board reads the name at dress, so they are re-cut here rather than
   * polled — a sign that changes once a session does not want a per-frame
   * comparison against a string. */
  for (const b of st.boards || []) {
    const rows = b.panel._rows;
    if (rows) b.panel.draw([st.name, ...rows.slice(1)]);
  }
  /* AND THE REGISTER YOU ARE STANDING AT, which is the one panel in the game
   * a player is looking straight at while they type. */
  if (st.register) st.register.panel.draw([st.name, 'STATION REGISTER', 'press to rename']);
  world.notify?.(st.name.toUpperCase(), 'the boards say so now');
  return st.name;
}

function endStationName(world) {
  const st = world?._station;
  if (!st) return;
  st.naming = null;
  const d = globalThis.document;
  if (st._keys && d?.removeEventListener) d.removeEventListener('keydown', st._keys);
  st._keys = null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ONE KEY — §14's interact prompt, and §3.2's verb column               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ EVERY VERB ROW IN §3.2 IS A PROMPT STRING ═════════════════════════════
 *
 * §14: "One key, one prompt style, on every verb in §3.2 — the deck's
 * `liftKey`/inspect pattern — so a player never wonders what is usable."
 *
 * So there is no table of interactions here. The gazetteer already says what
 * you do in each of the fifty-five places, and `place.verb` IS the prompt.
 * A second list would be the hand-maintained twin beside its generated
 * original that HANDOFF §2.3 calls this project's signature defect.
 */

/** Which place the player is standing in, or at the door of. Null outdoors. */
export function placeUnder(world, x, z) {
  const st = world?._station;
  if (!st) return null;
  let best = null, bestD = 4 * 4;
  for (const rec of st.places.values()) {
    const p = rec.place;
    /* Inside its footprint wins outright — you are IN the room. */
    const dx = x - p.x, dz = z - p.z;
    const c = Math.cos(-p.yaw), sn = Math.sin(-p.yaw);
    const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    if (Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2) return p;
    /* Otherwise the nearest door within arm's reach of it. */
    const ex = x - p.door[0], ez = z - p.door[1];
    const d2 = ex * ex + ez * ez;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}

/**
 * The interact key, on the station. `Player._readInput` calls it on `focus`.
 *
 * The lift first, exactly as `DeckEdit.focusKey` does it and for the same
 * reason: `liftKey` answers true only when it spent the press, so one key at
 * the lobby doors cannot both call the car and open a shop.
 */
export function stationKey(world) {
  /* Typing a name eats every key until it is committed or dropped — see the
   * suppression note over `beginStationName`. */
  if (namingStation(world)) return true;
  if (liftKey(world)) return true;
  /* THE PLAN TABLE, BEFORE THE HOME AND ONLY WITHIN ARM'S REACH OF IT — V15
   * §1.1's second naming door. See the note over `beginStationName`. */
  if (atPlanTable(world)) return beginStationName(world);
  /* AND THE HOME, which claims the key only inside its own four walls — it
   * answers false anywhere else, so #27's verb still reaches the prompt. See
   * `Home.homeKey` for the four things one press can mean in there. */
  if (homeKey(world)) return true;
  const p = world.player?.position;
  if (!p) return false;
  const place = placeUnder(world, p.x, p.z);
  if (!place || !place.verb) return false;
  /* THE REGISTER IN #13, ahead of the kiosk branch below it: the rotunda is a
   * kiosk place and one of its eight terminals is the station's own register
   * (V15 §1.1). Standing at that one names the station; the other seven — and
   * the rest of the room — open the codex on the next line. */
  if (place.id === 13 && atRegister(world)) return beginStationName(world);
  /**
   * ── A COUNTER, IF YOU ARE STANDING AT ONE — V16 Lane B ──────────────────
   *
   * ══ THE DEFECT THIS REPLACES, AND IT MADE TWO SHOPS UNREACHABLE ═══════
   *
   * This branch used to sit BELOW the kiosk branch and read:
   *
   *     const shops = countersAt(place.id);
   *     if (shops.length && world.onCounter) return world.onCounter(shops[0].id) !== false;
   *
   * with a comment over it claiming it was "raised before the kiosk branch …
   * and the one you are standing at is the one that answers". Both halves were
   * false. It was raised AFTER, so the kiosk always won; and `countersAt`
   * takes a ROOM ID and the code took `shops[0]`, so there was no standing-at
   * test of any kind. Driven with the real key — `Input.touchHitSet.add
   * ('focus')`, one tap on one frame, through `Player._readInput` — for 45 s
   * in each deck-40 room:
   *
   *     #9  The Concourse        onCounter:clothier
   *     #10 The Forge            onKiosk:hilt     the armourer never reached
   *     #11 Quartermaster's cage onKiosk:kit      the QM never reached
   *     #15 The Fresh Air        onCounter:freshair
   *     #17 Food court           onCounter:foodcourt
   *
   * The Quartermaster is the ONLY counter carrying stims and stratagem
   * charges, so no provision in the game could be bought at all — the whole of
   * `Progress.js`'s second amended category, behind a branch that never ran.
   * `tools/_doorprobe.mjs` was green throughout because it calls
   * `world.onCounter('armourer')` directly, which is the instrument that
   * cannot see this class of defect.
   *
   * ── SO THE PROMISE IN THAT COMMENT IS BUILT ───────────────────────────
   *
   * `counterHere` is a reach test on the DESK — `StationKit.counter()` records
   * where every one of them ended up, in world coordinates, off the kit's own
   * emit. That is `atRegister`'s exact shape one file over: the dressing puts
   * a fixture somewhere and the key measures the distance to it, so #13's
   * eight terminals can mean two different things and so can #10's bench and
   * its counter.
   *
   * FIRST, now, and it has to be: a shop and a kiosk in one room is a choice
   * between two things and the shop is the one with a person behind it. Step
   * back from the desk and the press falls through to the kiosk on the next
   * line, which is how the Forge's hilt bench and the cage's paint rack stay
   * reachable — measured after the fix, at the door of #10 and at its counter,
   * and the two presses raise different panels.
   */
  const shop = counterHere(world, place);
  if (shop && world.onCounter) {
    if (world.onCounter(shop.id) !== false) return true;
  }
  /**
   * ── #29 COMPANY BARRACKS: THE LIBERTY BOARD — V16 Lane C2 ──────────────
   *
   * *"you can assign troops to go on leave."* There was no control anywhere:
   * leave was `hashF(designation, day)` and the player could not choose who
   * went, could not see who was out, and got nothing back for it.
   *
   * THE BARRACKS AND NOT A BAR, because the choice is about the COMPANY and
   * not about the room — who you can spare, not where he drinks. It is the
   * same argument `#43`'s branch makes about the ward: the clock decides the
   * healing and the door decides the thing the clock cannot, which here is
   * which third of your men is standing down tonight.
   *
   * ── ABOVE THE KIOSK, AND THE SLATE IS ON THE BOARD ────────────────────
   *
   * `#29` carries `kiosk: 'muster'` and the kiosk branch below would take
   * every press in this room, so this has to sit above it. What that would
   * ordinarily cost is the room's own gazetteer verb — *"read the Muster
   * slate"* — so `main.js`'s board carries the slate as a row on it and hands
   * the press straight on to `onKiosk('muster')`. Nothing is lost and the two
   * things a player does in their own barracks are on one page, which is what
   * the room is.
   *
   * IT MAY REFUSE. A player with no roll at all has nobody to send anywhere,
   * and `main.js` answers false for that — the press falls through to the
   * kiosk on the next line and the slate opens exactly as it always did.
   */
  if (place.id === 29 && world.onLeave) {
    if (world.onLeave(place.id) !== false) return true;
  }
  /* A counter opens the panel it names; everything else answers with its own
   * verb, which is the prompt and, until its system lands, the whole of it. */
  if (place.kiosk && world.onKiosk) { world.onKiosk(place.kiosk); return true; }
  /**
   * ── #56 THE STANDING: THE KEY READS THE ROLLS ─────────────────────────
   *
   * The gazetteer's verb is *"read the rolls — find your own row"* and this
   * branch used to answer NAME THE STATION, which is neither of those things.
   * `StationBoards.myRow` is the reading: which run filed last, where it
   * stands on each of the two faces that rank your runs, and what the company
   * looks like on the other two. The naming moved to the two places §1.1 asks
   * for it — see the note over `beginStationName`.
   */
  if (place.id === 56) {
    const [head, line] = standingReading();
    world.notify?.(head, line);
    return true;
  }
  /**
   * ── #28 THE KENNEL HABITAT — V15 §4's *"only reachable at the habitat"* ──
   *
   * Raised like the kiosks and NOT as one: a kiosk opens a page of the menu
   * (`KIOSK_TAB`), and the habitat's page is not on the menu — it is where you
   * feed and groom, which the Jedi tab's kennel page does not do and must not
   * grow. `main.js` answers this the way it answers meditation: its own
   * overlay with its own root, which is also the only shape that is safe
   * against `Screens.clear()` running every card's hide on every clear.
   */
  if (place.id === 28 && world.onHabitat) return world.onHabitat() !== false;
  /**
   * ── #41 COMMAND / CIC — V16 Lane A1 ─────────────────────────────────────
   *
   * *"maybe the command deck or somewhere like that … so you've chosen a
   * different map for the next mission, before starting a game you have to fly
   * there."* The plot table is where an order is given, so it is where the
   * theatre is chosen and where the jump is ordered.
   *
   * A KIOSK STILL, and deliberately: #41 already carries `kiosk: 'campaign'`
   * and the campaign page is the right page — what changes is that choosing a
   * theatre there now has a consequence in the room. `main.js` answers the
   * kiosk and hangs the jump off what the player picked, which keeps the
   * decision on the panel that already presents it and the CONSEQUENCE here.
   *
   * While a jump is running the plot table says so rather than reopening: an
   * order taken twice is the one thing a bridge does not do.
   */
  /* ── THE BENCH, at #42 and #50 — V16 Lane A3. You make the thing at
   * Fabrication and you tune the call at Comms, which is where a fire mission
   * is called from and which has had no job at all until now. */
  if ((place.id === 42 || place.id === 50) && world.onBench) {
    return world.onBench(place.id === 50 ? 'make' : 'tune') !== false;
  }
  /**
   * ── #43 AND #44, THE MEDBAY — V16 Lane B3 ───────────────────────────────
   *
   * *"you should have a med bay that actually does something."* The ward
   * heals on the station's clock whether you come or not (`stepMedbay`, in
   * `stepStation` above), so what the DOOR is for is the thing the clock
   * cannot decide: which five of your wounded are in the tanks.
   *
   * TWO ROOMS, ONE PAGE, and that is the honest shape rather than a tidy one:
   * #43 is where the wounded are triaged and #44 is the glass they are behind,
   * and a player standing at either is asking the same question. `Medbay.js`
   * gives the page its rows; `main.js` owns the overlay, on `openMeditation`'s
   * own-root shape for `Screens.clear()`'s reason.
   */
  if ((place.id === 43 || place.id === 44) && world.onMedbay) {
    return world.onMedbay(place.id) !== false;
  }
  /**
   * ── #51 THE DROID POOL — V16 Lane B5's *"instead of"* ───────────────────
   *
   * *"droids charge instead of eating."* `Food.eat`'s refusal to a droid names
   * this room in as many words — *"a droid has no stomach; there is a rack of
   * posts at the droid pool"* — and there was no door here, so a separatist
   * roll could buy food, watch it cooked, carry it home, be refused at the
   * cupboard and be sent to a room with nothing in it. `Food.CHARGES` and
   * `Food.offeredTo` had zero callers outside their own file for the same
   * reason: the only room they were written for was not asking.
   *
   * IT ANSWERS ONLY A DROID, and that is why it is a fall-through rather than
   * a `return`. `main.js` hands back false for anybody with a stomach and the
   * press carries on to the room's own verb, which is the rule #20's pit
   * branch below states at length: a branch that claims a press it did not use
   * is the defect. Nothing here knows what a droid is — the kind is
   * `Attributes.kindOfArmy`'s and the panel is `main.js`'s.
   */
  if (place.id === 51 && world.onCharge && world.onCharge(place.id) !== false) return true;
  /**
   * ── #20 AND #61, THE PITS — V16 Lane G ─────────────────────────────────
   *
   * *"there could be an area of the ship where you can duel with your
   * companions … either sanctioned or illegal."* Both, and they are the same
   * door: `#20 The Arena` has a marshal and a doctor, `#61 The Underlift Pit`
   * has neither and is not on every night.
   *
   * AFTER the counter branch, matching #42 and #50: a room that sells
   * something sells it first, and neither of these two rooms does.
   *
   * ── AND #20 HAS TWO DOORS, SO THIS ONE DOES NOT EAT THE PRESS ─────────
   *
   * `#20 The Arena` is a pit AND a book. This branch used to `return` on the
   * pit's answer whatever it was, so the tote branch below was unreachable at
   * #20 and the room was a one-line refusal at every hour of every day on a
   * profile with no animal — driven: #18 at 22:00 raised [tote], #19 at 14:45
   * raised [tote], #20 at 18:15 raised [pit] "you have nothing to put in
   * there". A player who wanted to back somebody else's could not get to the
   * card at all, which is exactly the sentence Lane D2 was written for.
   *
   * So the pit KEEPS the press only when it took it. `main.js`'s `openPit`
   * returns false when there is no bout for you and a book shares the room,
   * and the press falls through to the tote below. #61 has no book, so its
   * refusal still answers there and nothing about the Underlift moves.
   */
  if (pitAtPlace(place.id) && world.onPit && world.onPit(place.id) !== false) return true;
  /**
   * ── #57 THE REPEATING ROOM — V16 Lane A2 ───────────────────────────────
   *
   * *"a holodeck/dojo that replaces the training and sandbox menus — you walk
   * into a room and program it rather than picking a tab."*
   *
   * A ROOM AND NOT A KIOSK, which is the same distinction `#28`'s note draws
   * one branch up. A kiosk raises a page of the MENU (`KIOSK_TAB`), and the
   * whole point of this room is that the pages it replaces are gone from the
   * menu — routing it through the kiosk door would put the tab back in a
   * costume. `main.js` answers this with its own overlay on its own root, for
   * `openMeditation`'s reason: `Screens.clear()` runs every card's hide on
   * every clear, and a rack that vanishes when the world changes screens is a
   * rack you cannot use.
   *
   * NOTHING HERE NAMES A MODE. §9.2 forbids a station file branching on one,
   * and this branch does not have to: `Holodeck.programSettings` is what turns
   * a program into a mode, and it is not a station file. The room raises its
   * own id and stops.
   */
  if (place.id === 57 && world.onHolodeck) return world.onHolodeck(place.id) !== false;
  /**
   * ── #18, #19 AND #20, THE TOTE — V16 Lane D2 ───────────────────────────
   *
   * A room with a card on it. AFTER the pits, so `#20`'s own verb — "fight a
   * bout" — still reaches Lane G's door when one is wired; the Arena's card is
   * a reading that panel can ask for by name. `#18 The Pit`'s gazetteer verb
   * has said "watch and bet" since the plan was written, and `#19` is where
   * the podracing feed plays.
   *
   * ONE CALL AND NO STAKE IN IT. Whatever opens is a room you can stand in for
   * nothing — `Tote.watch` takes a place, a day and an hour and has no
   * parameter a ticket could hide in.
   */
  const tote = venueAtPlace(place.id);
  if (tote && world.onTote) return world.onTote(tote.id) !== false;
  /**
   * ── #14, #54 AND #59, THE BARS — V16 Lane C2's OTHER HALF ──────────────
   *
   * *"a casino/nightclub with troops on leave … you will actually see your
   * real troops relaxing there."*
   *
   * You could already see them — `StationLife.occupant` has been asking
   * `Bars.barman` for the first n seats of these rooms since Lane C2 landed —
   * and there was nothing you could DO about it, or even read. Every line in
   * `Bars.BARS` (*"the band is loud enough that nobody has to talk"*) was
   * reachable only through a function no file under `src/` called, so no
   * player has ever seen one. This branch is the door those lines come
   * through, and it is where a man's own name in a room full of strangers
   * gets said out loud.
   *
   * AFTER THE TOTE, WHICH IS WHY `#18` IS NOT IN THIS LIST IN PRACTICE. The
   * Pit is a bar AND a book, its own gazetteer verb is "watch and bet", and
   * `venueAtPlace` claims that press one line up. `isBar` still answers true
   * for it — the leave ledger seats men there and pays them for it exactly as
   * it does anywhere else — what it does not get is the panel, because the
   * room already had a better one. The rule is the pit branch's rule stated
   * again: a branch that claims a press it did not use is the defect.
   *
   * BEFORE the flight rooms and the job board, neither of which names 14, 54
   * or 59; and `main.js` may still refuse, in which case the press falls
   * through to the room's own verb.
   */
  if (isBar(place.id) && world.onBar) {
    if (world.onBar(place.id) !== false) return true;
  }
  if (place.id === 41 && world._warp && !world._warp.done) {
    world.notify?.('COMMAND / CIC', 'the jump is under way');
    return true;
  }
  /**
   * ── #60 THE WHEELHOUSE — V16 Lane D1 ───────────────────────────────────
   *
   * *"you should be able to play some of the casino games these should be
   * actual games within games … in certain games you play against actual npcs
   * like it could be anyone on the ship on any day."*
   *
   * `Games.js` — three finished games, 4/4 green — was in no shipped build
   * until this line: `pack.mjs` walks the module graph from `main.js` and the
   * only mention of the file under `src/` was a sentence in a comment. This
   * branch and `StationKit.wheelhall` are what make it a dependency of the
   * game rather than of the tests. `Casino.js` deals; nothing here knows a
   * card.
   *
   * ── WHERE IT SITS, AND WHAT IT CANNOT SHADOW ──────────────────────────
   *
   * AFTER the counter, the bench, the medbay, the pits, the Repeating Room
   * and the tote, and BEFORE the flight dispatcher. It names ONE id and every
   * branch above it names ids that are not 60, so this cannot eat a press
   * that belonged to anything: #60 has no counter in `Vendors`, no kiosk on
   * its row, no venue in `Tote` and no pit in `Pits`. And it is not the last
   * branch, so it cannot swallow the fallback either — the two doors below
   * are the five flight rooms and the job board, and 60 is in neither.
   *
   * That position is the lesson of the branch three above: the pit's door
   * used to `return` on the pit's own refusal and #20's betting card was
   * unreachable for it. A branch that claims a press it did not use is the
   * defect, so this one claims exactly one room and answers with something
   * true even when nothing has opened a panel.
   */
  if (place.id === WHEELHOUSE) {
    /* THE STATION'S OWN CLOCK, off the world and not a second one — the Drum
     * is the same hour the medbay heals on and the shops reroll on, which is
     * the whole of why a spin cannot be re-taken by walking out. */
    const room = openWheelhouse(world._station?.hour ?? 0, stationDay(), place.id);
    if (world.onCasino && world.onCasino(room) !== false) return true;
    /* NO PANEL YET AND THE ROOM STILL WORKS. `main.js` owns the overlay; a
     * build without it gets the real spin and the real dealer off the same
     * call the panel reads, rather than a room that looks built and is not. */
    world.notify?.('THE WHEELHOUSE', wheelhouseLine(room));
    return true;
  }
  /**
   * ── #2, #3, #4, #5 AND #6 — FLIGHT OPS, SHARK §7 ───────────────────────
   *
   * LAST, and the position is the argument: none of the five sells anything,
   * opens a kiosk, keeps an animal or runs a bout, so every branch above has
   * already had its chance and none of them can be standing here. One line for
   * five rooms because `flightKey` is the dispatcher — the same shape
   * `homeKey` and `liftKey` have at the top of this function, and for the same
   * reason: five branches in here would be five more things to read before you
   * reach the one you want.
   */
  if (FLIGHT_PLACES.has(place.id)) return flightKey(world, place);
  /**
   * ── SOMEBODY IN HERE HAS A JOB — V16 Lane C3 ───────────────────────────
   *
   * *"you can talk to npcs there so maybe give you certain quests (very long
   * list of potential ones and totally random and not always there and the
   * npcs aren't always in the same place either so it's a chance thing) …
   * when you complete a certain quest it is recorded and you go back to that
   * npc who will be there since you compelted the quest."*
   *
   * `Quests.js` had the same defect `Games.js` had and it is the same fix: a
   * finished module, 3/3 green, that no file under `src/` imported and that
   * `pack.mjs` therefore never put in a build. This is its door.
   *
   * ── AND THE DOOR IS THE FALLBACK, WHICH IS THE HONEST ANSWER ──────────
   *
   * A giver does not belong in a new room. The player's own rule is that the
   * NPCs *"aren't always in the same place"*, so the right place for this is
   * every room that has nobody standing behind a counter in it — which is
   * exactly the set that reaches this line. Measured: 32 of the gazetteer's
   * rooms fall through to here, including `#14 The Long Night`, `#38` the
   * hostel, the six quarters, the Promenade, the gym, the chapel, the
   * arboretum, the morgue, the cargo hold and the dome, and `offersAt` puts
   * about twenty jobs a day across them.
   *
   * LAST, AND IT CANNOT SHADOW ANYTHING. Every branch above has already
   * returned if it wanted the press — a counter, a kiosk, a bench, a ward, a
   * pit, a card, a table, a hangar door. What it replaces is `notify(name,
   * verb)`, which is a line of text, and it only replaces it when there is
   * genuinely somebody here: no offer today and nothing owed here means no
   * panel and the verb still prints.
   *
   * THE OWED HALF IS WHY THIS IS NOT JUST A BOARD. `owedJobs` is the pinned
   * giver — you finished the job, the money is here, and the room opens for
   * that even on a day it is offering nothing new.
   */
  const day = stationDay();
  const offers = offersAt(place.id, day, questContext(world));
  const owed = owedJobs().filter((j) => j.place === place.id);
  if ((offers.length || owed.length) && world.onQuest) {
    const board = {
      place: place.id, name: place.name, day,
      offers, owed, carrying: openJobs(), verb: place.verb,
    };
    if (world.onQuest(board) !== false) return true;
  }
  /**
   * ── #25 LOST & FOUND: THE KEY READS THE WALL ──────────────────────────
   *
   * LAST, and below the job board on purpose. `#25` is one of the thirty-two
   * rooms that fall through to `offersAt`, so a resident standing at the board
   * with something to ask still gets the panel — a branch above the quest door
   * would have made this the one room in the gazetteer where a giver could not
   * be spoken to, which is the "branch that claims a press it did not use"
   * defect stated four branches up, facing the other way.
   *
   * What it replaces is `notify(name, verb)` — the literal words "read the
   * notices" over a wall that had nothing written on it. `Notices.noticeReading`
   * reads the same stores `dressNotices` writes onto the slabs, so the line the
   * key prints and the wall the player is looking at cannot disagree.
   */
  if (place.id === 25) {
    const [head, line] = noticeReading(day);
    world.notify?.(head, line);
    return true;
  }
  world.notify?.(place.name.toUpperCase(), place.verb);
  return true;
}

/**
 * What a job may be rolled against: the men on the roll and the kinds you
 * have actually fought. `Quests.SHAPES` reads both and neither is a new
 * counter — "a name" is `Company.js`'s own roll and "a mercy" is a kind out
 * of the same list the run reports. A context this cannot build is null, and
 * `offersAt` answers with the shapes that need none.
 */
function questContext(world) {
  let men = [];
  /* `StationBoards.companyOf` is the one authority on which manifest is "the"
   * company from the station's point of view — `StationLife` reads the same
   * one for the leave seats, and a job that named a man the bar has never
   * heard of would be two rolls. */
  /* `nameOf` AND NOT `m.name`, which no stored man has ever had. `Company`'s
   * record keeps `designation` and `nickname` and `nameOf` is the one rule for
   * turning those into what a screen calls him — so this filter dropped EVERY
   * man on the roll, `ctx.men` was always empty, and the one job shape that
   * names somebody could never be offered. It used to degrade instead of
   * disappearing: the roll answered `{ who: null }` and the test read a null
   * `who` as satisfied, which is a 340-credit job finished before it was
   * taken. See `SHAPES.name` in Quests.js. */
  try {
    men = (companyOf()?.men || [])
      .filter((m) => m && m.id && (m.designation || m.nickname))
      .map((m) => ({ id: m.id, name: nameOf(m) }));
  } catch { men = []; }
  /* `world.killedKinds` AND NOT `world.run.killedKinds`: the run bag has never
   * carried one — the tally is the World's own, written in `onEnemyKilled` and
   * reported by `runStats`. On the station it is empty (nothing dies in the
   * drum), so a mercy is rolled off `SHAPES`' own default list until a run has
   * been fought in this world; what this line stops is a reader of a field
   * nothing writes. */
  const kinds = world?.killedKinds ? Object.keys(world.killedKinds) : null;
  return { men, kinds: kinds && kinds.length ? kinds : null };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE JOB BOARD'S OWN MONEY, and it moves here for the tote's reason
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Quests.collect` marks a job paid and says what it is worth; it holds no
 * balance and names no wallet word, exactly as `Tote.js` does not. The purse
 * moves in this file, through the one pay door, under the same `PER_RUN_CAP`
 * that bounds every other payment in the game — a job that paid round the cap
 * would be the second place a player could earn past the doctrine.
 */
export function payForJob(jobId) {
  const got = collect(jobId);
  if (!got.ok) return { ...got, paid: 0, capped: false };
  const paid = pay(got.pay, 'work');
  /**
   * ══ AND THE STATION REMEMBERS THAT YOU DID IT ═══════════════════════════
   *
   * The riser half of §11's standing, and the reason it is HERE:
   *
   *   IT IS A RESIDENT'S OWN OPINION. The fall is "you cut somebody in this
   *     hull" and the rise has to be the same KIND of fact or the number means
   *     two things. A job is given by a named resident, in a room, and
   *     collected face to face — `Quests.pinnedGivers` keeps them standing
   *     there until you come back. That is the whole of what a vendor could
   *     have heard about you.
   *   IT IS BOUNDED BY PLAYING AND NOT BY SHOPPING. A job only exists because
   *     `Quests.settleRun` finished one off a RUN, so standing climbs at the
   *     rate runs happen and no faster, and `setStanding` clamps at +40 —
   *     eleven jobs from neutral, worth 12% off a cape. Nothing about that is
   *     power: `markupFor` moves a PRICE, every price is for a cosmetic or a
   *     run-only provision, and `PER_RUN_CAP` still bounds the purse.
   *   AND IT IS NOT SPENDING. Standing that rose when you paid would be a
   *     loyalty ladder — a number that grows by having played, which is the
   *     one sentence `Progress.js`'s header exists to refuse.
   *
   * +2 against the fall's −2 a body, so one man cut costs one job done. That
   * symmetry is the point: the number is a ledger of how you have treated the
   * place, not a currency with an exchange rate.
   */
  setStanding(standing() + 2);
  return { ...got, paid, capped: paid < got.pay };
}


/* ══════════════════════════════════════════════════════════════════════════
 *  THE WINDOW — the dozen lines where the credits actually move
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Tote.js` prices a bet and says what a ticket is worth; it holds no balance
 * and names no wallet word, which is what lets its suite settle a hundred
 * thousand tickets without a store. The money moves HERE, in the file that
 * already knows the player is standing at the window, through the one spend
 * door and the one pay door `Credits.js` exposes.
 *
 * ── AND THE CAP IS THE WALLET'S, NOT THE TOTE'S ──────────────────────────
 *
 * `Credits.pay` clamps a single payment to `PER_RUN_CAP`. A long-priced winner
 * is worth more than that, and it is NOT paid — the window returns both what
 * it owed and what it handed over, so a screen can say so. That is deliberate:
 * `Progress.js`'s amendment bounds the economy at a run's earnings, and a
 * betting room that paid round it would be the one place in the game where a
 * player could stake their way past the doctrine. A tote is a thing to do with
 * credits, not a way to make them.
 */

/** Strike a ticket and take the money for it. Refuses the way the shop does. */
export function stakeAtTote(race, bet) {
  const quote = ticketFor(race, bet);
  if (!quote.ok) return quote;
  const paid = spend(quote.ticket.stake, 'tote');
  if (!paid.ok) return { ok: false, why: paid.why, short: paid.short, ticket: null };
  return { ok: true, why: null, ticket: quote.ticket, left: paid.left };
}

/** Settle what is on the record against a result, and hand back the winnings. */
export function payAtTote(tickets, result) {
  const ledger = settleTickets(tickets, result);
  const paid = ledger.returned > 0 ? pay(ledger.returned, 'tote') : 0;
  return { ...ledger, paid, capped: paid < ledger.returned };
}

/**
 * ── AND THE DRUM'S WINDOW IS THE SAME WINDOW ─────────────────────────────
 *
 * *"you can bet your real money."* `Casino.js` prices a bet against a stop and
 * holds no balance; the two lines that move the purse are here, beside the
 * tote's, so the six-word currency scan over the economy still finds every
 * place a credit changes hands in one file.
 *
 * THE WHEEL IS SPUN BEFORE THE STAKE IS SETTLED AND NEVER AFTER. `drumAt` is
 * a pure function of the station clock, so `stakeAtDrum` takes the hour it is
 * betting ON and `payAtDrum` reads the same one — a player cannot stake into
 * an hour that has already turned, and cannot re-take one by walking out.
 */
export function stakeAtDrum(bet) {
  const stake = Math.max(0, Math.round(Number(bet?.stake) || 0));
  if (!stake) return { ok: false, why: 'name a stake', ticket: null };
  const paid = spend(stake, 'drum');
  if (!paid.ok) return { ok: false, why: paid.why, short: paid.short, ticket: null };
  return { ok: true, why: null, ticket: { ...bet, stake }, left: paid.left };
}

/** What the wheel owed, and what the wallet actually handed over. */
export function payAtDrum(ticket, at) {
  const owed = drumQuote(ticket, at);
  const paid = owed > 0 ? pay(owed, 'drum') : 0;
  return { owed, paid, capped: paid < owed, won: owed > 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  FLIGHT OPS — SHARK §7, and the five doors it puts on the station
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `FlightOps.js` is the rooms, `Launch.js` is the sequence and `Outside.js` is
 * #55. All three are pure and none of them has ever seen a world; this is the
 * seam where they meet one, and it is deliberately thin — a fold in, a line
 * out, and one sequence object on the world exactly as `world._warp` is.
 */

/** The five places §7 is about. #1 is the hangar and has no verb of its own. */
const FLIGHT_PLACES = new Set([2, 3, 4, 5, 6]);

/**
 * The flight fold, cached on the world for the length of a visit.
 *
 * READ ONCE, NOT PER PRESS. `flightState()` is a localStorage read and a parse
 * and the cert is looked at by four rooms; the cache is written through on
 * every change, so a reload is the same station and a refusal never half-
 * writes — `FlightOps` hands back a NEW fold rather than mutating the old one
 * precisely so this line can be the only place a write happens.
 */
function flightFold(world) {
  if (!world._flight) world._flight = cleanFlight(flightState());
  return world._flight;
}
function keepFlight(world, fold) {
  world._flight = fold;
  try { setFlightState(fold); } catch {}
  return fold;
}

/**
 * How fast a Starfury goes round the station, m/s.
 *
 * IT WAS 120 AND 120 IS NOT FLYABLE. That number was a camera on a rail, and a
 * rail has infinite lateral authority; the craft that flies this now is
 * `Starfury.js`, whose four mains make 18.4 m/s² against 14.8 t, and a turn at
 * 120 m/s under 18.4 m/s² has a radius of 783 m — round a station 180 m
 * across. The rail was cornering five times harder than the airframe can.
 *
 * So this is the CEILING the pilot holds on a straight and not a cruise: what
 * the craft actually flies is `sqrt(aMax · R)` for the turn the track is
 * asking for, which is `Pilot.js`'s corner law and is the only reason the loop
 * closes. Measured over a flown lap: 47 m/s at the flag, 22.0 s round instead
 * of 8.8, worst clearance from the hull 30.0 m against `Outside.CLEAR`'s 25.
 *
 * AN ALIAS AND NOT A SECOND NUMBER. `Pilot.TOP_SPEED` is the authority because
 * the pilot is what holds it; this is the station's name for the same byte, so
 * a reader who asks the station how fast a fighter goes round it cannot be
 * told something the craft would disagree with.
 */
export const ORBIT_SPEED = TOP_SPEED;

/**
 * ══ #2 THE TOWER ═════════════════════════════════════════════════════════
 *
 * The verb is *"read the board: what is inbound"* and the answer is the same
 * `FlightOps.boardAt` the glass in the room is printing — `StationBoards.
 * trafficRows` draws it and this reads it, off one pure function of the
 * station clock, so the banner cannot say something the board does not.
 *
 * AND READING IT IS WHAT SIGNS THE DECK CHECK. `fold.boards` only moves when
 * there was actually traffic on it, so a player who walks in at 04:00 with a
 * clear board is told the board is clear and has to come back — which is the
 * whole of what makes #3's third rung a trip to a second room.
 */
function readTower(world, st) {
  const seen = { theatre: st.theatre, mine: st.mine };
  const t = traffic(st.day ?? 0, st.hour ?? 0, seen);
  const line = inboundLine(st.day ?? 0, st.hour ?? 0, seen);
  if (t.live > 0) {
    const f = flightFold(world);
    keepFlight(world, { ...f, boards: (f.boards | 0) + 1 });
  }
  const tail = t.holding ? `, ${t.holding} holding` : t.live ? '' : ' — nothing moving';
  world.notify?.('DECK CONTROL', `${line}${tail}`);
  return true;
}

/**
 * ══ #3 THE READY ROOM — the gate ═════════════════════════════════════════
 *
 * One press signs the next rung you are actually eligible for, or says what it
 * is waiting on. NO PAGE AND NO OVERLAY: §14's rule is that the station adds no
 * interface, and a cert with three rows on it is a banner's worth of words —
 * see the same argument in `StationBoards.dressFlightBoard`, where the answer
 * to a longer list was to put it on a panel in the room rather than on a page
 * over the top of it.
 */
function signInReadyRoom(world, st) {
  const f = flightFold(world);
  const r = signCert(f, { hour: st.hour ?? 12, day: st.day ?? 0 });
  if (!r.ok) {
    world.notify?.("PILOTS' READY ROOM", r.why);
    return true;
  }
  keepFlight(world, r.fold);
  const left = CERT.length - r.fold.cert.length;
  world.notify?.(r.rung.name.toUpperCase(),
    left ? `${r.line} — ${left} to go` : `${r.line}. You are cleared for the Cobra bay`);
  return true;
}

/**
 * ══ #4 THE PIT — which gantry are your feet on? ══════════════════════════
 *
 * The level is a HEIGHT and not a menu. `StationKit.GANTRY_Y` is the one copy
 * of the three numbers and the pit's floor is the place's own, so this is a
 * subtraction rather than a second table — which is what `StationPlan.js`'s
 * header spends four paragraphs on.
 *
 * A press with your feet on the room's floor and not on a catwalk answers with
 * the stair, because "walk the gantries" means going down the stair.
 */
function walkThePit(world, st, place) {
  const f = flightFold(world);
  const y = (world.player?.position?.y ?? 0) - floorOf(place);
  let level = -1, best = 1.6;
  for (let i = 0; i < GANTRY_Y.length; i++) {
    const d = Math.abs(y - GANTRY_Y[i]);
    if (d < best) { best = d; level = i; }
  }
  if (level < 0) {
    const stage = gantryStage(st.day ?? 0, st.hour ?? 0);
    world.notify?.('FIGHTER MAINTENANCE', `${stage.what} — the stair down is on your left`);
    return true;
  }
  const r = walkGantry(f, level, { day: st.day ?? 0, hour: st.hour ?? 0 });
  if (!r.ok) { world.notify?.('FIGHTER MAINTENANCE', r.why); return true; }
  keepFlight(world, r.fold);
  world.notify?.(`GANTRY ${level + 1} OF ${GANTRY_LEVELS}`,
    r.had ? r.line : `${r.line} — ${r.left ? `${r.left} to go` : 'that is the type rating'}`);
  return true;
}

/**
 * ══ #5 THE COBRA BAY — board and launch ══════════════════════════════════
 *
 * ONE KEY, THREE MEANINGS, and they cannot overlap: it launches when you are
 * on the deck and certified, it recovers when you are outside, and it refuses
 * with the reason while a sequence is running. Exactly `DeckLift.liftKey`'s
 * shape — one press at the doors cannot both call a car and open a shop.
 *
 * AND THERE IS NO PLATE. See `Launch.js`'s header: nothing is loaded, the
 * player never moves, and what changes is a shader's uniforms on the one frame
 * the well is at full scroll. `station.mjs` holds the lift to that bar; this
 * sequence never touches `Screens`, `enterStation` or `captureStill`, and
 * `flightops.mjs` greps the whole of §7's source to prove it.
 */
function cobraBay(world, st) {
  const f = flightFold(world);
  const now = (st.day ?? 0) * 24 + (st.hour ?? 0);
  if (world._sortie && !world._sortie.done) {
    world.notify?.('COBRA BAY', `${world._sortie.phase} — stand by`);
    return true;
  }
  /* OUTSIDE ALREADY: the same key brings you home. */
  if (world._flying) {
    world._sortie = new Sortie('in', sortieSink(world, st), { at: now });
    return true;
  }
  const ready = readiness(f, st.day ?? 0, st.hour ?? 0);
  const may = canLaunch({ cert: ready.cert, short: shortLine(f), flying: false, busy: false });
  if (!may.ok) { world.notify?.('COBRA BAY', may.why); return true; }
  world._sortie = new Sortie('out', sortieSink(world, st), { at: now, well: PLACE.get(5)?.h });
  return true;
}

/**
 * ══ #6 THE RACK ══════════════════════════════════════════════════════════
 *
 * The verb is a GRIP AND A THROW, which this game already has — the four
 * engine bells `StationKit.cellar` stands up are `Props.Prop` bodies like every
 * crate on every battlefield, and the Force picks them up without a line of new
 * code. So the key here does not throw anything: it tells you what the rack is
 * and what you have found, and `stepBells` below is what listens for the
 * throw. A verb the game already owns should not be re-implemented behind a
 * key press; it should be given a consequence.
 */
function fighterRack(world, st) {
  const f = flightFold(world);
  const n = spares(f, st.day ?? 0);
  world.notify?.('FIGHTER RACK',
    n ? `${n} sound ${n === 1 ? 'bell' : 'bells'} on the day's rack — throw another and listen`
      : 'engine bells on the stands. Throw one and listen to it');
  return true;
}

/** The one dispatcher, so `stationKey` has one line for §7 rather than five. */
function flightKey(world, place) {
  const st = world._station;
  if (!st) return false;
  switch (place.id) {
    case 2: return readTower(world, st);
    case 3: return signInReadyRoom(world, st);
    case 4: return walkThePit(world, st, place);
    case 5: return cobraBay(world, st);
    case 6: return fighterRack(world, st);
    default: return false;
  }
}

/**
 * ══ WHAT A SORTIE DRIVES ═════════════════════════════════════════════════
 *
 * `Launch.Sortie` imports nothing and knows about no world; this is the bag it
 * pushes into, and it is the same arrangement `Warp`'s sink is — see that
 * file's header for why the sequence is testable at 6 ms a step because of it.
 *
 * `bay` is left on the station as plain numbers rather than driven into
 * materials here: the four things a launch moves (the canopy, the rams, the
 * bay's lighting and how much well has gone past) are the room's to draw, and
 * a station file reaching into a place's materials is how §9.1's nine-material
 * rule gets a tenth.
 */
function sortieSink(world, st) {
  st.bay = st.bay || { canopy: 0, lights: 0, rams: 0, shaft: 0, scroll: 0 };
  return {
    say: (line) => world.notify?.('COBRA BAY', line),
    canopy: (k) => { st.bay.canopy = k; },
    lights: (k) => { st.bay.lights = k; },
    rams: (k) => { st.bay.rams = k; },
    shaft: (k, m) => { st.bay.shaft = k; st.bay.scroll = m; },
    /**
     * THE ONE FRAME. `configureOrbit` is the same call the flight deck and the
     * drum's own windows already make (see `dressStation`), handed the same
     * `outsideLevel` record — so going outside is a re-configure of a shader
     * that is already running, on the frame `Launch.js` chose because it is the
     * frame nobody can see. Nothing is built and nothing is loaded.
     */
    outside: (on) => {
      world._flying = !!on;
      world._orbitU = on ? 0 : world._orbitU;
      /* Coming back in puts the craft away. It is rebuilt at the mouth on the
       * next launch, which is where `Outside`'s circuit starts. */
      if (!on) world._pilot = null;
      const shown = outsideLevel(world);
      world.engine?.skyDome?.configureOrbit?.({
        level: shown,
        terrain: TERRAIN_PRESETS[shown?.terrain],
        faction: world._deckFaction,
        forward: [0, 0, 1],
        /* Out of the well you are looking along the hull, so the disc sits
         * lower than it does from a window inside the drum. */
        rise: on ? 0.04 : 0.10,
      });
    },
    /* YOUR OWN LAUNCH GOES ON THE TOWER'S BOARD, which is the whole reason
     * `movementsIn` takes a `mine`. */
    sortie: (rec) => { st.mine = rec; },
    done: (way) => {
      if (way === 'out') { world._orbitU = 0; return; }
      keepFlight(world, flew(flightFold(world)));
      st.mine = null;
    },
  };
}

/**
 * One frame of a sortie: the sequence, then the lap.
 *
 * ── ONE LAP AND THE RECOVERY STARTS ITSELF ───────────────────────────────
 *
 * The verb §3.2 gives #5 is *"board and launch"* and the brief's bar is
 * *"launch, and come back"* — so a sortie is a round trip rather than a state
 * you have to remember to leave. One lap of `Outside`'s circuit, the sights
 * named as they go past, and then the recovery runs without another press.
 *
 * ── AND SOMETHING IS STEERING IT NOW ─────────────────────────────────────
 *
 * This block used to say *"WHAT IS HONESTLY NOT HERE: nobody is steering"*,
 * and it was right: `world._orbitU` was advanced by `ORBIT_SPEED * dt` and the
 * one truly new system §4 asks for — `Starfury.js`, 6-DOF Newtonian, ported
 * clause for clause and 264 lines of green check over it — was in NO SHIPPED
 * BUILD. `pack.mjs` walks the module graph from `index.play.html` and nothing
 * under `src/` imported it, so 96 of the 97 files in `src/game` were in the
 * manifest and that was the one that was not.
 *
 * `Pilot.js` is the seam and its header carries the argument. What changed
 * here is one line: the parameter is no longer added to, it is READ OFF A
 * CRAFT — the craft's own position, integrated by `Starfury.step` with no
 * damping term, projected onto the track. Everything else in this function is
 * untouched, because everything else was already right: the sights are named
 * off `nearest`, the recovery starts itself, and the player is on their feet
 * in control the whole way, which is the thing `Warp.js` argues for.
 *
 * The lap is 22.0 s where it was 8.8, and that is the airframe's answer rather
 * than a design change — see `ORBIT_SPEED` above for the arithmetic.
 */
function stepSortie(world, st, dt) {
  const s = world._sortie;
  if (s && !s.done) { s.step(dt); return; }
  if (!world._flying) return;
  /* Built on the frame the craft is first outside and not at dress time: a
   * station nobody launches from never makes one, which is most visits. The
   * drum's radius is the plan's, so the throw off the rim is the station's own
   * and not a constant typed in a flight file. */
  const pilot = world._pilot || (world._pilot = new CircuitPilot({ radius: DRUM.R }));
  const was = pilot.progress;
  const u = pilot.step(dt);
  world._orbitU = u;
  /* The sights, named as they pass. `nearest` never answers `hull` — see
   * `Outside.js` — so this is the four things you fly past and not a caption
   * every frame saying you are near the station. Named off the CRAFT's own
   * position now, which is the point: a sight the pilot flies wide of is a
   * sight you are not told about. */
  const a = orbitSample(was), b = orbitSample(u);
  if (b.near !== a.near) world.notify?.('OUTSIDE', sightLine(b.near));
  /* `lap` and not `u >= 1`, because `u` is a POSITION on the track and 0.99 →
   * 0.01 is a metre of travel. See `CircuitPilot.step`. */
  if (pilot.lap >= 1) {
    world._pilot = null;
    world._orbitU = 0;
    world._sortie = new Sortie('in', sortieSink(world, st),
      { at: (st.day ?? 0) * 24 + (st.hour ?? 0) });
  }
}

/**
 * ══ THE BELLS — #6's verb, listened for rather than pressed ══════════════
 *
 * A bell rings when it is STRUCK, so what this watches for is the strike: a
 * body that was moving at more than `BELL.ring` and has just lost most of it in
 * one frame has hit something. `FlightOps.ringBell` decides what that sounded
 * like, off the bell and the day rather than off the throw — see its note about
 * why a verb graded on how hard you threw would be a strength meter.
 *
 * The four bodies are found ONCE, on the first frame after the rack is dressed,
 * and never scanned for again: `world.props` is every prop in the level and a
 * filter per frame over it would be the one expensive line in this file.
 */
function stepBells(world, st) {
  if (st.deck !== 12) return;
  /* `undefined` is "not looked yet" and `[]` is "looked and there are none" —
   * two states, because collapsing them to a falsy check would re-filter the
   * whole prop list every frame on a rack that has been emptied. */
  if (st.bells === undefined) {
    st.bells = (world.props || []).filter((p) => p?.kind === 'engine')
      .map((p) => ({ prop: p, was: 0 }));
  }
  if (!st.bells.length) return;
  for (let i = 0; i < st.bells.length; i++) {
    const b = st.bells[i];
    const v = b.prop?.body?.velocity;
    if (!v || b.prop.dead) continue;
    const now = Math.hypot(v.x, v.y, v.z);
    /* A strike: it was going somewhere and most of that is gone in one frame.
     * Half is the threshold because a bell that bounces keeps some of it, and a
     * bell that stops dead has hit a bulkhead. */
    if (b.was >= BELL.ring && now < b.was * 0.5) {
      const f = flightFold(world);
      const r = throwBell(f, i, b.was, { day: st.day ?? 0 });
      if (r.heard) {
        keepFlight(world, r.fold);
        world.notify?.('ENGINE BELL', r.line);
      }
    }
    b.was = now;
  }
}

/**
 * The prompt, raised once when you arrive somewhere new. Not every frame and
 * not on a HUD element of its own: the station adds no interface (§14's "the
 * menu does not change"), so the place's name and its verb go through the
 * banner every other verb in this game already uses.
 */
function promptOnArrival(world, st, px, pz) {
  const here = placeUnder(world, px, pz);
  const id = here ? here.id : null;
  if (id === st.promptedAt) return;
  st.promptedAt = id;
  if (!here || !here.verb) return;
  world.notify?.(here.name.toUpperCase(), here.verb);
}

const CULL = 80;
const CULL_ATRIUM = 130;

/**
 * THE CLOCK, ON ITS OWN, BECAUSE ONE ROOM NEEDS IT WITHOUT THE REST.
 *
 * These eight lines were the top of `stepStation` and are still only called
 * from there — plus one place: `main.js`'s tote panel, which is a screen you
 * WATCH A RACE ON. `Screens.take` sets `world.paused`, and the frame loop only
 * calls `world.update` while the state is 'playing' or 'dead', so with any
 * panel up `stepStation` does not run and `st.hour` stops. Driven at #19 with
 * a race live: 5400 × `world.update(1/60)` — ninety simulated seconds — moved
 * the hour 15.25 → 15.25 and the panel's text not by one byte. A race lasts
 * 0.3 h, which is 36 real seconds, so the room the player was told he could
 * stand in for nothing was two stills with a walk between them.
 *
 * IT IS THE CLOCK AND NOTHING ELSE, and that is the whole point of splitting
 * it out rather than letting the panel call `stepStation`. The rest of that
 * function heals the ward, rerolls the boards, moves the piece in your hands
 * and steps the fleet outside the glass — all of it out of sight behind a
 * panel, none of it something the player asked to have happen while he reads
 * a board. What a watched race needs is the hour, and the hour is a number
 * both this file and that screen must agree on to the digit, which is why the
 * panel drives THIS and keeps no hour of its own.
 */
export function tickStationClock(world, dt) {
  const st = world?._station;
  if (!st) return;
  /* The clock: one game hour per two real minutes (§3.4). Everything in
   * `StationLife` reads this and nothing else keeps time. */
  st.hour += dt / 120;
  /**
   * ── AND MIDNIGHT GOES THROUGH THE FOLD, WHICH IS THE WHOLE DEFECT ──────
   *
   * This was `while (st.hour >= 24) st.hour -= 24;` — the wrap done in place,
   * on the world, and nowhere else. It is the ONLY moment in the running game
   * that means "a day has passed", and it was being subtracted away on the
   * frame it happened, so nothing durable ever heard about it. Measured in the
   * live build: 80 station hours on deck 40, `st.day` 0 → 0, the clothier's
   * shelf byte-identical. Everything V16 rerolls off the day — shelves,
   * keepers, faces, the job board, the pit's card, the tote programme, the
   * casino seats, the leave roll — was frozen on day 0 for ever because of
   * this line.
   *
   * `setStationHour` is handed the UNWRAPPED hour, folds the whole days into
   * the station's own record and hands back the wrapped remainder, so the
   * count happens in the one place that persists it and the world's clock is
   * left reading a wall clock exactly as before. `_savedHour` is moved with it
   * so the per-hour persist below does not immediately write the same number
   * again.
   */
  /**
   * ── AND A GUEST'S CLOCK IS NOT A GUEST'S SAVE ──────────────────────────
   *
   * Everything below this line either writes the fold or reads it back, and on
   * a joining player the number being written is not theirs: `applySnapshot`
   * has just set `st.hour` to the HOST's, because the census, the shelves and
   * the boards have to agree across the session (see `packSnapshot`'s `sh`).
   * Persisting it would put the host's evening into the guest's own station —
   * a player whose last visit ended at 22:00 joining a host at 09:00 would
   * find their own drum wound thirteen hours back, and a host past midnight
   * would advance a day the guest never lived. So a guest RUNS the clock, to
   * dead-reckon between packets, and writes none of it: the wrap rolls the
   * local day in place and `stationDay` — which reads the guest's own fold —
   * is not consulted at all.
   */
  const guest = world.netMode === 'client';
  if (st.hour >= 24) {
    if (guest) { st.hour -= 24; st.day = (st.day | 0) + 1; }
    else { st.hour = setStationHour(st.hour); st._savedHour = st.hour | 0; }
  }
  if (world.run) world.run.stationHour = st.hour;
  if (guest) return;
  /* AND WHICH DAY IT IS, published on the station so `StationLife` can read it.
   * Everything seeded off the day — the shelves, the board, the pit's card, the
   * tote's programme, who is on leave in the cantina — reads this one number,
   * and a reader that had to derive its own would put two different stations in
   * one hull. */
  st.day = stationDay(st.hour);
  /* Persisted on the hour rather than every frame: §14 wants a return visit to
   * be later in the same day, not a localStorage write sixty times a second. */
  if ((st.hour | 0) !== st._savedHour) { st._savedHour = st.hour | 0; setStationHour(st.hour); }
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  STANDING, PERSISTED — and it had NO WRITER AT ALL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `StationSave.setStanding` had zero callers in the tree. `Counter.markupFor`
 * works and is measured — standing 0 pays 38 for the oiled leather, −20 pays
 * 45, −35 is refused with a line — but the number it reads was 0 for every
 * player for ever, so the vendor-remembers-you half of the shop never fired
 * once.
 *
 * The fall was already being COMPUTED and thrown away.
 * `StationLife.witness` does `life.standing -= hurt * 2` when you cut a
 * resident, writes it to `world.run.stationStanding`, and `dressStationLife`
 * reads it back off the run — so it survives a station visit inside a run and
 * dies with the run, while the durable fold beside it never moved. Two numbers
 * called standing, one of them the one the shops read.
 *
 * ── SO THE DELTA IS MIRRORED, NOT THE VALUE ───────────────────────────────
 *
 * `life.standing` starts at `world.run?.stationStanding ?? 0` — NOT at the
 * saved fold — so copying it across would reset a player who had earned a −20
 * back to zero on the next visit, which is the fold quietly undoing the
 * consequence. What is written is the CHANGE since this file last looked, so
 * the two numbers can disagree about their origin and still agree about what
 * happened.
 *
 * Written on the frame it changes and not per frame: `witness` only moves the
 * number when a body is hurt for the first time, so this costs one integer
 * compare a frame and a `localStorage` write about once a lifetime.
 *
 * ── AND WHAT MOVES IT THE OTHER WAY IS WORK, WHICH IS IN `payForJob` ─────
 *
 * A ratchet that only ever falls would make `markupFor`'s +40 rung — "a
 * regular, and they knock a bit off" — a dead branch, and this file has just
 * finished deleting one of those. The riser is collecting on a job for a
 * resident: see `payForJob`. It is not shopping, deliberately — standing that
 * went up when you spent would be a loyalty ladder, which is a number that
 * grows by having played and is the thing `Progress.js`'s header refuses.
 */
function persistStanding(world, st) {
  const life = world?._stationLife;
  if (!life) return;
  const now = Math.round(Number(life.standing) || 0);
  if (st._lifeStanding === undefined) { st._lifeStanding = now; return; }
  if (now === st._lifeStanding) return;
  const moved = now - st._lifeStanding;
  st._lifeStanding = now;
  setStanding(standing() + moved);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE CROWD IN THE ROOM — V16 §G4
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"a crowd that reacts to what happens in the pit/arena/race."*
 *
 * `Tote.VENUES[].crowd` was a STRING and an audit found it had no reader
 * anywhere in `src/`: the row said "sixty in the seats" and the game had
 * nothing at all behind it. The announcer was DOM text in `main.js`, so the
 * Holo-theatre made exactly as much noise for a 40/1 shot winning by a nose as
 * for a favourite strolling home, which is to say none.
 *
 * `Tote.crowdIn` is the model and it is pure. This is the half that spends it,
 * and there are three things the player actually perceives:
 *
 *   IT IS HEARD    `audio.crowd` — the engine's own cue, three of its existing
 *                  noise layers, positioned at the middle of the room. A roar
 *                  is not a louder murmur: the shout layer only exists above
 *                  the swell gate, and it moves up the band as the room does.
 *   IT IS SEEN     the room FILLS. `StationLife`'s pool seats `crowd.in`
 *                  bodies in the venue while a card is on, on top of the
 *                  gazetteer's ordinary headcount, and lets them go when the
 *                  night goes dark.
 *   THEY LOOK      on a roar every resident inside the room turns to face the
 *                  stage, the sand or the ring.
 *
 * ── WHY IT IS HERE AND NOT IN main.js ────────────────────────────────────
 *
 * `showTote` is a DOM panel on a `setTimeout`, and it only exists while the
 * player has the board open. A crowd that could only be heard through the
 * betting screen is a crowd that reacts to a menu. This runs in `stepStation`,
 * off the world's own frame, so the room is loud whether or not you ever look
 * at the card — which is the same rule `watch()` is built on.
 */

/** How far from the middle of a venue you can still hear it. */
const CROWD_EAR = 34;
/** A swell under this is the room talking, not the room reacting. */
const ROAR_GATE = 0.12;
/** Two roars closer together than this are one roar. */
const ROAR_GAP = 0.7;
/** How often the wash under it is renewed while you are in the room. */
const MURMUR_EVERY = 1.6;

const _crowdAt = new THREE.Vector3();

/**
 * WHICH VENUE THE PLAYER IS IN EARSHOT OF, or null.
 *
 * The room the player is standing IN wins outright; otherwise the nearest
 * venue centre within `CROWD_EAR`, which is a little over the width of the
 * Arena — you hear the bowl from the concourse outside its door.
 */
function venueInEarshot(world, st, px, pz) {
  const inside = placeUnder(world, px, pz);
  if (inside && venueAtPlace(inside.id)) return inside;
  let best = null, bestD = CROWD_EAR * CROWD_EAR;
  for (const rec of st.places.values()) {
    const p = rec.place;
    if (!venueAtPlace(p.id)) continue;
    const dx = p.x - px, dz = p.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}

/**
 * THE ROOM, ONCE A FRAME.
 *
 * Everything it decides lands on `st.crowd`, which is the observable a check
 * drives the shipped loop against — `roars` counts what was actually asked of
 * the audio engine, `spec` is the last thing it asked for, and `heads` is what
 * the life pool was told to seat. A field nothing writes is the defect this
 * function exists to remove, so nothing here is written and not read.
 */
export function stepCrowd(world, st, dt) {
  if (!(dt > 0)) return;
  const cam = world.player?.position;
  const px = cam ? cam.x : 0, pz = cam ? cam.z : 0;
  const place = venueInEarshot(world, st, px, pz);
  const c = st.crowd || (st.crowd = {
    venue: null, place: null, says: '', in: 0, level: 0, swell: 0, moment: null,
    roars: 0, spec: null, since: 0, murmurIn: 0, turned: 0,
  });
  const life = world._stationLife;
  if (!place) {
    /* Out of earshot of all three. The pool keeps nothing, so a room the
     * player has walked away from stops being seated for a race. */
    if (c.venue) { c.venue = null; c.place = null; c.in = 0; c.level = 0; c.swell = 0; c.moment = null; }
    if (life?.crowd?.size) life.crowd.clear();
    return;
  }
  const v = venueAtPlace(place.id);
  const read = crowdAt(v.id, st.day | 0, st.hour);
  const was = c.venue === v.id ? c.swell : 0;
  c.venue = v.id; c.place = place.id; c.says = read.says;
  c.in = read.in; c.level = read.level; c.swell = read.swell; c.moment = read.moment;
  c.since += dt;

  /* WHO IS IN THE ROOM. The life pool reads this in `reseat` and seats up to
   * this many bodies in the venue instead of the gazetteer's quiet-room
   * headcount. One Map entry, rewritten in place. */
  if (life) {
    if (!life.crowd) life.crowd = new Map();
    life.crowd.set(place.id, read.in);
    for (const id of life.crowd.keys()) if (id !== place.id) life.crowd.delete(id);
  }

  _crowdAt.set(place.x, floorOf(place) + 1.7, place.z);

  /* ── THE ROAR. A RISE, not a level ────────────────────────────────────
   * `swell` jumps on the frame the moment lands and decays from there, so a
   * rise is the only thing that can be a new reaction. Gated on `ROAR_GAP` as
   * well, because two moments on adjacent gates of a Pit bout are two thirds
   * of a second apart and the room does not stop between them. */
  const rising = read.swell > was + 0.015;
  if (rising && read.swell >= ROAR_GATE && c.since >= ROAR_GAP) {
    c.since = 0;
    c.roars++;
    c.spec = audio.crowd({
      voices: read.in, temper: read.temper, swell: read.swell, level: read.level, pos: _crowdAt,
    });
    c.turned += turnToWatch(world, place);
    c.murmurIn = MURMUR_EVERY;
  } else {
    /* ── AND THE WASH UNDER IT, renewed on its own beat. A room with people
     * in it is never silent, and this is what makes walking in during a card
     * different from walking in on a dark night. */
    c.murmurIn -= dt;
    if (c.murmurIn <= 0 && read.level > 0.05) {
      c.murmurIn = MURMUR_EVERY;
      c.spec = audio.crowd({
        voices: read.in, temper: read.temper, swell: 0, level: read.level, pos: _crowdAt,
      });
    }
  }
}

/**
 * THE ROOM TURNS TO LOOK.
 *
 * `StationLife`'s walkers already write `body.facing` every frame and the
 * animator reads it, so this is the same field used for the one thing a crowd
 * does that a walking commuter does not: on a roar everyone in the venue faces
 * the middle of it. It is the cheapest possible motion — one `atan2` per body
 * in one room, on the frames a roar actually lands — and it is the difference
 * between a room of people who happen to be standing there and a room that is
 * watching something.
 *
 * Returns how many bodies were turned, which is what `st.crowd.turned` counts.
 */
function turnToWatch(world, place) {
  const life = world?._stationLife;
  if (!life?.live?.size) return 0;
  const half = Math.max(place.w, place.d) / 2 + 1;
  let n = 0;
  for (const [key, body] of life.live) {
    if (!body || body.dead || !body.position) continue;
    /* The pool's own key is `${place.id}:${slot}` — the room a body was seated
     * in, which is cheaper and more honest than a distance test against a
     * yawed footprint. */
    if (key.slice(0, key.indexOf(':')) !== String(place.id)) continue;
    const dx = place.x - body.position.x, dz = place.z - body.position.z;
    if (dx * dx + dz * dz > half * half) continue;
    /* Already in the middle of the room: leave them alone rather than spin
     * them on a zero-length vector. */
    if (dx * dx + dz * dz < 0.04) continue;
    body.facing = Math.atan2(dx, dz);
    n++;
  }
  return n;
}

/**
 * How long one frame may spend finishing the build. One job runs per call
 * whatever it costs — the jobs are hundreds of milliseconds each and slicing
 * INSIDE one is a different piece of work — so this only decides whether a
 * second job joins it on the same frame, and the answer is no unless the
 * first was trivial.
 */
const BUILD_SLICE = 4;

const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Finish what `dressStation` put off. See `pending`.
 *
 * A failed job is reported and dropped rather than retried: it has already
 * been taken out of the queue, and a builder that throws every frame for the
 * rest of a visit is worse than the thing it was going to build.
 */
export function drainStationBuild(world, st = world?._station, all = false) {
  if (!st?.pending?.length) return 0;
  const t0 = _now();
  let n = 0;
  /* A ceiling on the drain-it-all loop. A slicing job that never says it is
   * finished would otherwise hang the caller, and a hang inside a screenshot
   * tool is the worst place to discover one. */
  const CEIL = 4000;
  do {
    const job = st.pending[0];
    let again = false;
    try { again = job.run() === true; } catch (e) { console.error(`station: ${job.name} failed to build`, e); }
    if (!again) st.pending.shift();
    n++;
  } while (st.pending.length && n < CEIL && (all || _now() - t0 < BUILD_SLICE));
  return n;
}

/**
 * The whole of it, now.
 *
 * For a caller that wants the station as it stands when somebody has been
 * looking at it — a screenshot, a census, a check that asserts on the world
 * it just booted without stepping it. Play never calls this: play steps.
 */
export function finishStationBuild(world) { return drainStationBuild(world, world?._station, true); }

export function stepStation(world, dt) {
  const st = world._station;
  if (!st) return;
  /* THE REST OF THE BUILD, ON THE FRAMES AFTER THE FREEZE. First, so that
   * anything stepped below finds what it owns already standing. */
  drainStationBuild(world, st);
  tickStationClock(world, dt);
  /* §11's consequence, reaching the disk. One integer compare a frame — see
   * `persistStanding` for why it is a delta and not a copy. */
  persistStanding(world, st);
  /* THE WARD HEALS ON THE STATION'S OWN CLOCK. Every ten seconds, and only
   * then — a man mending is a thing that happens while you shop, not a thing
   * that happens when you walk into #44 and look at him. It returns the rolls
   * that changed, which is the one frame worth a banner. */
  const mended = stepMedbay(world, dt);
  if (mended) {
    for (const m of mended) {
      const n = m.healed.length;
      world.notify?.('MEDICAL BAY', `${n === 1 ? m.healed[0] : `${n} of the company`} off the list`);
    }
  }
  /* AND SO DOES A MAN WITH A PASS IN HIS POCKET. The same ten-second settle
   * and the same argument `stepMedbay` makes one line up: an evening off is a
   * thing that happens while you shop, not a thing that happens when you walk
   * into the cantina and look at him. `Bars.stepLeave` credits the nerve and
   * the mending; the banner is only for a man who came off the wounded list,
   * because that is the one event worth interrupting somebody for. */
  const rested = stepLeave(world, dt);
  if (rested) {
    for (const r of rested) {
      const n = r.mended.length;
      world.notify?.('LIBERTY', `${n === 1 ? r.mended[0] : `${n} of the company`} back on their feet`);
    }
  }
  stepBoards(world, st, dt);
  /* #25's wall, and ONLY when the day has turned — the gazetteer's line for
   * that room is "notices change daily". One integer compare a frame. */
  stepNotices(world, st);
  /* The piece in your hands follows the crosshair. Costs one property read a
   * frame when there is nothing held, which is nearly always. */
  stepHome(world, dt);
  /* The fleet outside the glass. Its own step is a no-op when nothing was
   * dressed, so this is unconditional and costs one call on a station whose
   * theatre could not be resolved. */
  stepDeckBattle(world, dt);
  /* THE JUMP, if one is running. It drives a shader and a fleet and nothing
   * else, which is why it can run while the player walks about — see Warp.js. */
  if (world._warp && !world._warp.done) world._warp.step(dt);
  /* AND THE COOK, on the same line and the same terms (V16 §B5). A no-op
   * until somebody orders something, which is one property read a frame; when
   * one is running it moves eight meshes and one man's arms, and it runs HERE
   * rather than off a timer so that what the player watches is the world's own
   * clock — see `StationKit.CookSet`. Step 8 of the frame, after every body
   * has posed itself at step 2, which is what lets it write the keeper's arms
   * at all. */
  stepCook(world, dt);
  /* THE SORTIE, on the same terms and for the same reason (§7). A no-op until
   * somebody launches, which is one property read a frame. */
  if (world._sortie || world._flying) stepSortie(world, st, dt);
  /* AND #6'S BELLS, which cost one cached array and four hypots on deck 12 and
   * a single early return everywhere else. */
  stepBells(world, st);
  /* AND THE THREE ROOMS WITH A CARD ON. One place lookup a frame and an early
   * return on every deck that has no venue on it — see `stepCrowd`. */
  stepCrowd(world, st, dt);

  const cam = world.player?.camera?.obj || world.player;
  if (!cam) return;
  const px = cam.position ? cam.position.x : 0;
  const pz = cam.position ? cam.position.z : 0;
  for (const rec of st.places.values()) {
    const p = rec.place;
    const dx = p.door[0] - px, dz = p.door[1] - pz;
    const d2 = dx * dx + dz * dz;
    const onBalcony = Math.hypot(p.door[0], p.door[1]) < DRUM.balcony + 2;
    const r = onBalcony ? CULL_ATRIUM : CULL;
    const want = d2 < r * r;
    if (want !== rec.group.visible) rec.group.visible = want;
  }
  promptOnArrival(world, st, px, pz);
}
