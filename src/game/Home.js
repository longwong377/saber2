/**
 * ══════════════════════════════════════════════════════════════════════════
 *  #27 — THE HOME, AND IT IS A PLACE YOU MAKE RATHER THAN A ROOM YOU ENTER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `V15.md` §1.3 splits "your cabin" into five things, and this file is the
 * first four of them plus the fifth's door:
 *
 *   1. A GRID AND A CATALOGUE. The cabin's floor is a placement grid and the
 *      catalogue is a table of pieces with footprints. Place, rotate, remove —
 *      and everything placed is a real `Props.Prop`, so a home is still a
 *      sandbox and you can knock your own furniture over.
 *   2. SURFACES. Wall, floor and trim, chosen per home, and every one of them
 *      is a material `stationMats` already made.
 *   3. ROOMS. The partition `SHAPES.twinroom` builds is a blocker the grid
 *      knows about, so a piece cannot be put down inside a wall — AND IT
 *      MOVES. §1.3.3: *"make the partition movable and let a third be
 *      unlocked — the address is what pays for it."* Standing at a partition
 *      the wheel slides it and the key puts the second one up or takes it
 *      down; see the partition chapter for how the shape's own slab is taken
 *      over without editing the shape, and for the reading of "the address is
 *      what pays for it" that keeps a room out of the shop.
 *   4. AN ADDRESS. `44-C-27`, derived and not stored, printed on the door —
 *      and, once there are three rooms behind it, how many.
 *   5. THE MIRROR. A fixture that raises the creator — see `homeKey`.
 *
 * ── WHY THE FURNITURE IS NOT BUILT BY THE SHAPE ───────────────────────────
 *
 * `SHAPES.twinroom` used to drop four bodies of its own — a map table, a desk,
 * a chair and a locker. They are gone from it, because a room that builds
 * furniture AND a save that remembers furniture are two answers to where your
 * desk is, and the one the player moved would lose. So the shape builds the
 * ARCHITECTURE (walls, partition, bunk plinth, saber stand, trophy rack) and
 * this file builds everything that can be moved. `DEFAULT_LAYOUT` is the four
 * pieces the shape used to make, in the places it made them.
 *
 * ── AND IT NEVER TOUCHES `localStorage` ───────────────────────────────────
 *
 * `StationSave.js` §"WHY IT IS ITS OWN FILE AND ITS OWN KEY": the home is the
 * `home` FIELD of the station's fold, not a fifth durable key, and it is
 * reached only through `homeState`/`setHomeState`. `session.mjs` counts the
 * writers in this tree and asserts at most three; a `localStorage` call here
 * would be the fourth.
 *
 * ── THE SHAPE IS WRITTEN FOR WHAT IS COMING, NOT ONLY FOR WHAT IS HERE ────
 *
 * Two rows of the record are empty today and are not decoration:
 *
 *   `store` — `V16.md` §2 B5: food is *"bought at a counter, carried and
 *     stored at home"*, and §3.2's shipping office *"delivers to your
 *     apartment overnight"*. Both are lists of things the home holds, so they
 *     are one field with two lists in it, validated from the first version so
 *     that landing B5 adds rows rather than a migration.
 *
 *   `place` — `V16.md` §2 Lane F: a co-op guest is ASSIGNED an existing
 *     residence (`#31`–`#38`) and it *"becomes theirs for the session, dressed
 *     from their saved home state"*. So nothing in this record says 27: a home
 *     is a portable dressing that remembers which door it was last behind, and
 *     `dressHome` will dress whichever room it is handed.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { Prop, mergeGeos, slabGeo, cylGeo } from '../world/Props.js';
import { homeState, setHomeState } from './StationSave.js';
import { signPanel } from './StationKit.js';
import { floorOf } from './StationPlan.js';
import * as Food from './Food.js';
/**
 * ── AND THE ONE SMALL COMPANION — V15 §1.3's last clause ──────────────────
 *
 * Read only, and only three things: the archetype rows (`COMPANION_UNITS` is
 * the table `ARCHETYPES` is filled FROM, so a mass and a flight plan are
 * reachable without importing `Enemy.js` and the graph it drags), the growth
 * numbers the body is built with, and the Kennel's own record of what you
 * have. Nothing here writes an animal — `Kennel.js` is the single writer of
 * that record and this file never calls into it.
 */
import {
  COMPANION_KINDS, COMPANION_UNITS, bodyScaleOf, growthOptsFrom,
} from './CompanionKinds.js';
import { load as loadKennel } from './Kennel.js';
import { companionOptsFrom } from './Bodies.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE NUMBERS                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE GRID, IN METRES.
 *
 * Half a metre, and the cabin is 15 × 11, so the floor is 30 × 22 cells. It is
 * the coarsest spacing at which a chair (0.5 m) still has a cell of its own and
 * the finest at which "put it against that wall" lands on the wall rather than
 * four centimetres off it — which is the whole reason a placement grid exists
 * rather than free placement.
 */
export const CELL = 0.5;

/** How near you have to be to pick a piece up. `DeckEdit.REACH`'s own 6 m. */
export const REACH = 6.0;

/** Rotation is eight notches of the wheel, not a continuous dial. */
export const NOTCHES = 8;

/**
 * How much furniture one home may hold.
 *
 * A cap and not a budget: forty bodies is under a tenth of `RapierWorld`'s
 * 1100 and well inside §12.2, and the number is here so that a save which has
 * been edited by hand cannot spawn a thousand props into deck 44.
 */
export const MAX_PIECES = 40;

/** How near the glass you stand for it to be a mirror rather than a wall. */
const MIRROR_REACH = 2.4;

/**
 * ══ HOW MANY PARTITIONS A CABIN MAY HAVE, AND HOW SMALL A ROOM MAY BE ═════
 *
 * V15 §1.3.3: *"The cabin is two rooms now. Make the partition movable and let
 * a third be unlocked."* Two partitions is three rooms and that is the whole
 * of the ask; a fourth would be corridors.
 *
 * `MIN_ROOM` is measured rather than chosen: the deepest piece in `CATALOGUE`
 * is the map table at 1.4 m, and `fits` keeps every piece 0.5 m inside the
 * walls, so 2.0 m is the shallowest bay a player can still put the biggest
 * thing they own into and walk round. Below it a room is a cupboard, and the
 * cabin is 11 m deep — two partitions 0.3 m thick leave 10.4 m of floor, so
 * three rooms of 2.0 m is reachable with 4.4 m to spare.
 */
export const MAX_WALLS = 2;
export const MIN_ROOM = 2.0;
/**
 * How near a partition you stand for the wheel and the key to be its.
 *
 * 0.9 m from the LEAF's face, not from its centre, and tighter than the
 * mirror's and the panel's 2.4 because those are against the room's own walls
 * and a partition runs across the middle of the floor: at 2.4 the band in
 * which the wheel is not the catalogue's would be 5.1 m of an 11 m room. At
 * 0.9 it is 2.1 m, which is the same 19% the shape's four blockers already
 * cover, and it means "standing at it" is within arm's reach of it.
 */
const WALL_REACH = 0.9;
/** Float slop for reading a slab back out of a merged mesh. A millimetre. */
const WALL_EPS = 1e-3;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CATALOGUE                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ EVERY PIECE, WITH ITS FOOTPRINT ═══════════════════════════════════════
 *
 * §1.3.1: *"the catalogue is `Props.Kit` pieces plus the station's own
 * furniture, each with a footprint."* `w` × `d` is that footprint in metres and
 * it is what the grid tests; `form` is how the geometry is made and several
 * rows share one, because a desk and a map table are one shape at two sizes.
 *
 * ONE MATERIAL PER PIECE, and it is a key into `stationMats` rather than a
 * colour. §9.1 allows no new material inside a room and `station.mjs` reads
 * every material's name; a piece that machined its own would arrive there
 * nameless. It also means a lamp is `strip` — the deck's own emissive — which
 * is the only way to have a lamp that lights without inventing anything.
 *
 * `flat` is the rug: a piece you may stand furniture on, so it is exempt from
 * the overlap test and from nothing else.
 */
export const CATALOGUE = [
  { id: 'table',  name: 'Map table',     form: 'table', w: 2.4, d: 1.4, h: 0.80, mass: 16, mat: 'deep' },
  { id: 'desk',   name: 'Desk',          form: 'table', w: 1.6, d: 0.7, h: 0.76, mass: 14, mat: 'deep' },
  { id: 'chair',  name: 'Chair',         form: 'chair', w: 0.5, d: 0.5, h: 0.90, mass: 7,  mat: 'deep' },
  { id: 'locker', name: 'Locker',        form: 'box',   w: 1.2, d: 0.6, h: 2.10, mass: 40, mat: 'deep' },
  { id: 'rack',   name: 'Shelf rack',    form: 'rack',  w: 1.6, d: 0.5, h: 1.90, mass: 30, mat: 'dark' },
  { id: 'crate',  name: 'Crate',         form: 'box',   w: 0.8, d: 0.8, h: 0.80, mass: 18, mat: 'dark' },
  { id: 'plant',  name: 'Planter',       form: 'plant', w: 0.7, d: 0.7, h: 1.20, mass: 12, mat: 'mark' },
  { id: 'lamp',   name: 'Standing lamp', form: 'lamp',  w: 0.4, d: 0.4, h: 1.60, mass: 6,  mat: 'strip' },
  { id: 'rug',    name: 'Rug',           form: 'rug',   w: 2.4, d: 1.6, h: 0.04, mass: 4,  mat: 'mark', flat: true },
  { id: 'bunk',   name: 'Bunk',          form: 'box',   w: 2.0, d: 1.0, h: 0.55, mass: 48, mat: 'deep' },
];

const BY_ID = new Map(CATALOGUE.map((c) => [c.id, c]));

/** One catalogue row, or null. The single door onto the table. */
export function pieceKind(id) { return BY_ID.get(id) || null; }

/**
 * The four bodies `SHAPES.twinroom` used to build, at the coordinates it built
 * them at. A home nobody has touched is the cabin §3.2 describes; the first
 * thing you move is the first thing that is yours.
 */
export const DEFAULT_LAYOUT = [
  { k: 'table',  x: 1.5,  z: -1.5, r: 0 },
  { k: 'desk',   x: -3.0, z: -2.5, r: 0 },
  { k: 'chair',  x: -3.0, z: -1.5, r: 4 },
  { k: 'locker', x: -6.0, z: 4.0,  r: 0 },
];

/* ── the geometry of one piece, in its own frame, base at y = 0 ──────────── */

const FORMS = {
  table(c) {
    const g = [];
    const top = slabGeo(c.w, 0.07, c.d, { bevel: 0.02 }); top.translate(0, c.h - 0.035, 0); g.push(top);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const l = cylGeo(0.05, 0.05, c.h, 6, 1);
      l.translate(sx * (c.w / 2 - 0.12), c.h / 2, sz * (c.d / 2 - 0.1));
      g.push(l);
    }
    return g;
  },
  chair(c) {
    const g = [];
    const s = slabGeo(0.44, 0.06, 0.42, { bevel: 0.02 }); s.translate(0, 0.45, 0); g.push(s);
    const b = slabGeo(0.42, 0.5, 0.06, { bevel: 0.02 }); b.translate(0, 0.72, 0.18); g.push(b);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const l = cylGeo(0.035, 0.035, 0.45, 5, 1);
      l.translate(sx * 0.17, 0.225, sz * 0.16);
      g.push(l);
    }
    return g;
  },
  box(c) {
    const g = slabGeo(c.w, c.h, c.d, { bevel: 0.03 });
    g.translate(0, c.h / 2, 0);
    return [g];
  },
  rack(c) {
    const g = [];
    for (const s of [-1, 1]) {
      const u = slabGeo(0.08, c.h, c.d, { bevel: 0.01 });
      u.translate(s * (c.w / 2 - 0.04), c.h / 2, 0);
      g.push(u);
    }
    for (let i = 0; i < 4; i++) {
      const sh = slabGeo(c.w - 0.16, 0.05, c.d - 0.06, { bevel: 0.01 });
      sh.translate(0, 0.28 + i * ((c.h - 0.34) / 3), 0);
      g.push(sh);
    }
    return g;
  },
  plant(c) {
    const pot = cylGeo(0.24, 0.3, 0.42, 8, 1); pot.translate(0, 0.21, 0);
    const stem = cylGeo(0.04, 0.05, 0.5, 5, 1); stem.translate(0, 0.65, 0);
    const bush = cylGeo(0.3, 0.06, 0.5, 7, 1); bush.translate(0, 1.0, 0);
    return [pot, stem, bush];
  },
  lamp(c) {
    const base = cylGeo(0.16, 0.18, 0.06, 8, 1); base.translate(0, 0.03, 0);
    const post = cylGeo(0.03, 0.03, c.h - 0.3, 6, 1); post.translate(0, (c.h - 0.3) / 2, 0);
    const shade = cylGeo(0.19, 0.13, 0.26, 8, 1); shade.translate(0, c.h - 0.13, 0);
    return [base, post, shade];
  },
  rug(c) {
    const g = slabGeo(c.w, c.h, c.d, { bevel: 0 });
    g.translate(0, c.h / 2, 0);
    return [g];
  },
};

/** One piece's merged geometry, fresh every time — a `Prop` disposes its own. */
function pieceGeo(c) { return mergeGeos(FORMS[c.form](c)); }

/**
 * The footprint a piece occupies at rotation notch `r`, as half-extents in the
 * room's frame. A 45° notch is measured by the box that CONTAINS the turned
 * rectangle rather than by the rectangle, which costs a few centimetres of
 * floor and buys a test that is four comparisons instead of a polygon clip.
 */
export function extentsAt(c, r) {
  const a = (r & (NOTCHES - 1)) * (Math.PI * 2 / NOTCHES);
  const co = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
  return [(c.w * co + c.d * si) / 2, (c.w * si + c.d * co) / 2];
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SURFACES                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WALL, FLOOR AND TRIM, OFF THE DECK'S OWN PALETTE ══════════════════════
 *
 * §1.3.2 asks for per-room colour *"off the same palette discipline
 * `DECK_PALETTE` uses, so a cabin cannot be made to look like it is from
 * another game."* The strongest reading of that is also the cheapest one: a
 * surface choice is not a COLOUR, it is a choice of WHICH of the deck's eleven
 * materials the surface wears. Nothing new is machined, `station.mjs`'s
 * material audit has nothing new to read, and there is no colour a player can
 * reach that the station does not already use somewhere else.
 *
 * Trim is the emissive row, because trim is what is lit.
 */
export const SURFACES = {
  floor: ['dark', 'deep', 'hull', 'mark', 'wing'],
  wall: ['hull', 'wing', 'mark', 'deep', 'dark'],
  trim: ['strip', 'status', 'screen'],
};

export const SURFACE_SLOTS = ['floor', 'wall', 'trim'];

const DEFAULT_SURFACES = { floor: 'dark', wall: 'hull', trim: 'strip' };

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PERCH, THE BASKET AND THE CHARGE PAD                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ V15 §1.3, IN FULL, AND IT WAS A FIELD WITH NOBODY AT EITHER END ═══════
 *
 * *"A cabin gets a perch, a basket or a charge pad for one small companion,
 * and which one is a choice you make at the habitat."*
 *
 * `state.pad` was sanitised, copied through `leaveHome` and written to the
 * fold, and `grep -rn "\bpad\b" src/` found NO READER AND NO WRITER: not in
 * `Habitat.js`, not in `Kennel.js`, and no fixture in `dressHome`. Measured on
 * a live deck-44 cabin it read `null`, and no path in the tree could have made
 * it anything else. A record field that declares behaviour nothing keeps is
 * HANDOFF §0.1b exactly, and this section is the two ends it never had.
 *
 * ── THREE ROWS, BECAUSE THE SENTENCE NAMES THREE THINGS ───────────────────
 *
 * `pad` is WHICH FIXTURE, not which animal. There is one live companion in
 * `Kennel.js` and never two, so "which small companion" is already answered by
 * the record the Kennel keeps; what the player is asked at the habitat, in the
 * sentence's own words, is *which one* of the three. So the field holds the
 * choice, and the animal is whoever is on the roll.
 *
 * `suits` is what the fixture is FOR, and it is checked against the archetype's
 * own published facts rather than against a list of kind ids — see `padSuit`.
 * Any of the three may be chosen for any animal: the sentence says the choice
 * is yours and offers no rule, and a bird standing on a charge plate is a
 * player's joke and not a defect. The habitat says which one fits.
 */
export const PADS = [
  {
    id: 'perch', label: 'Perch', suits: 'flier',
    note: 'a bar across two posts, high on the wall',
    /** Where a body standing on it rests, in metres over the cabin floor. */
    rest: 1.02,
  },
  {
    id: 'basket', label: 'Basket', suits: 'beast',
    note: 'a low round bed with straw in it',
    rest: 0.24,
  },
  {
    id: 'charge', label: 'Charge pad', suits: 'droid',
    note: 'a docking plate and a standing post',
    rest: 0.07,
  },
];

const PAD_BY_ID = new Map(PADS.map((p) => [p.id, p]));

/** One row of the table, or null. The single door onto it. */
export function padKind(id) { return PAD_BY_ID.get(id) || null; }

/**
 * ══ HOW SMALL "SMALL" IS, AND IT IS ONE NUMBER OFF THE ARCHETYPE TABLE ════
 *
 * The kennel (#28) is where the big ones live and the cabin gets ONE SMALL
 * one, so something has to answer which is which. It is the archetype's own
 * `mass`, because that is the field the design already reasons about: the
 * tooka's row argues its 3 kg at length — *"the lightest mass in ARCHETYPES …
 * you can pick it up"* — and a companion you can pick up is exactly the one
 * that comes home in your arms.
 *
 * 40 kg, and the number is the gap in the measured table rather than a guess.
 * Every companion archetype, by mass:
 *
 *   tooka 3 · hawk 6 · astro 32 │ tuk 45 · b1c 52 · medic 90 · pup 150 ·
 *   wook 200 · varac 420 · taun 420 · blurrg 640
 *
 * The bar falls in a 13 kg hole, the widest one under 100, and it leaves
 * exactly three animals in the cabin — and those three are one flier, one
 * beast and one droid, which is the three fixtures the sentence names, one
 * each. That is not arranged: it is what the table already said.
 *
 * A kind whose archetype row is missing reads as NOT small, which is the safe
 * direction — an unknown body does not get put in a basket.
 */
export const PAD_MASS = 40;

/**
 * Which fixture suits a kind, or null if the kind is too big to live here.
 *
 * DERIVED FROM WHAT THE ARCHETYPE PUBLISHES, and never from a list of ids:
 * `float`/`flight` is the flight plan (only the hawk carries one and only the
 * hawk never lands), and `look: 'droid'` is the same field `CARE_WORDS` reads
 * to say "charge" instead of "feed". Anything else small enough is a beast.
 */
export function padSuit(kind) {
  const K = COMPANION_KINDS[kind];
  if (!K) return null;
  const A = COMPANION_UNITS[K.archetype];
  if (!A || !(A.mass > 0) || A.mass > PAD_MASS) return null;
  if (A.float || A.flight) return 'flier';
  if (K.look === 'droid') return 'droid';
  return 'beast';
}

/**
 * The animal that lives in the cabin: the Kennel's live record if it is small
 * enough, otherwise nothing. `k` is a record already read, for a caller that
 * has one.
 *
 * IT IS THE LOCAL MACHINE'S KENNEL AND CAN NEVER BE A GUEST'S — `Coop.js`
 * §WHAT A GUEST SEES makes the same argument for the larder. So the FIXTURE
 * dresses in every apartment (it is a row of that apartment's record) and the
 * ANIMAL only ever stands in yours.
 */
export function homeCompanion(k = null) {
  const rec = (k || loadKennel()).live;
  if (!rec || !padSuit(rec.kind)) return null;
  return rec;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ADDRESS                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Twelve sectors round the drum, one letter each. A..L, A at the Concourse. */
const SECTORS = 'ABCDEFGHIJKL';

/**
 * ══ `44-C-27`, AND IT IS DERIVED RATHER THAN STORED ═══════════════════════
 *
 * §1.3.4: *"derived from the deck, the sector angle and the door number,
 * printed on the door and on the notice board."* Derived is the operative
 * word — an address kept in the save is a second opinion about where a room
 * is, and `StationPlan.js`'s own header is about what happens when four files
 * each keep one. So this is a pure function of the gazetteer row, which means
 * `V16.md` Lane F's *"each friend gets an apartment"* is a lookup: hand it
 * `#33` and it answers `44-F-33` with nothing to assign.
 */
export function homeAddress(place) {
  if (!place) return '';
  const [dx, dz] = place.door || [place.x, place.z];
  let a = Math.atan2(dx, dz);
  if (a < 0) a += Math.PI * 2;
  const s = SECTORS[Math.min(SECTORS.length - 1, Math.floor(a / (Math.PI * 2) * SECTORS.length))];
  return `${place.deck}-${s}-${String(place.id).padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE RECORD                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ CLAMPED ON THE WAY IN, RE-VALIDATED ON THE WAY OUT ════════════════════
 *
 * `Kennel.js`'s law, and the reason for it is that this record survives a
 * death, a version and a hand edit. An array must come back an array and a
 * colour must come back one of `SURFACES`' own keys, because the alternative
 * is a `MeshStandardMaterial` lookup returning `undefined` on the frame a
 * player walks through their own front door.
 *
 * `v` is the migration hook and nothing reads it yet, which is correct: it is
 * there so that the version that DOES has something to branch on.
 */
function clean(v) {
  const raw = (v && typeof v === 'object') ? v : {};
  const out = {
    v: 1,
    /** Which door this dressing was last behind. Lane F reassigns it. */
    place: Number.isFinite(raw.place) ? Math.round(raw.place) : 27,
    surfaces: { ...DEFAULT_SURFACES },
    pieces: [],
    /** V16 §2 B5 and §3.2 — what the home HOLDS. Two lists, empty today. */
    store: { food: [], parcels: [] },
    /**
     * V15 §1.3 — the perch, the basket or the charge pad, or null for a cabin
     * that has not been given one. A `PADS` id and nothing else: it is read
     * straight into a fixture builder by `dressPad`, so an unknown string here
     * is a `FIXTURES` lookup returning `undefined` on the frame a player walks
     * through their own front door — the header's own example.
     */
    pad: PAD_BY_ID.has(raw.pad) ? raw.pad : null,
    /**
     * ══ WHERE THE PARTITIONS STAND — V15 §1.3.3 ═════════════════════════════
     *
     * One number per partition, in the room's own frame, and the LENGTH of the
     * array is how many rooms there are: none means "as the shape built it",
     * one means the shape's partition has been moved, two means there is a
     * third room. That is one field saying both things, which is right,
     * because they are one fact — a wall is somewhere or it is not there.
     *
     * EMPTY IS NOT "NO PARTITION". `SHAPES.twinroom` builds one and hands its
     * rectangle over on `ctx.home.blockers[0]`; an empty array means the
     * record has no opinion and `dressWalls` reads the position off that
     * rectangle. Storing the shape's own 0.6 here on a fresh save would be
     * `HANDOFF` §2.3's twin — the day StationKit moved the partition, every
     * existing home would have pinned it to where it used to be.
     *
     * Clamped for LENGTH and snapped to the grid here, and clamped for
     * POSITION at dress time — the same split the pieces are under, and for
     * the same reason: `clean` does not know how deep the room is, `fits`
     * does. See `wallFits`.
     */
    walls: [],
  };
  const s = (raw.surfaces && typeof raw.surfaces === 'object') ? raw.surfaces : {};
  for (const slot of SURFACE_SLOTS) {
    if (SURFACES[slot].includes(s[slot])) out.surfaces[slot] = s[slot];
  }
  const list = Array.isArray(raw.pieces) ? raw.pieces : DEFAULT_LAYOUT;
  for (const p of list) {
    if (out.pieces.length >= MAX_PIECES) break;
    if (!p || typeof p !== 'object') continue;
    const c = BY_ID.get(p.k);
    if (!c) continue;
    out.pieces.push({
      k: c.id,
      x: snap(Number(p.x) || 0),
      z: snap(Number(p.z) || 0),
      r: ((Math.round(Number(p.r) || 0) % NOTCHES) + NOTCHES) % NOTCHES,
    });
  }
  const wl = Array.isArray(raw.walls) ? raw.walls : [];
  for (const z of wl.slice(0, MAX_WALLS)) {
    if (!Number.isFinite(Number(z))) continue;
    out.walls.push(snap(Number(z)));
  }
  const st = (raw.store && typeof raw.store === 'object') ? raw.store : {};
  for (const bin of ['food', 'parcels']) {
    const rows = Array.isArray(st[bin]) ? st[bin] : [];
    for (const r of rows.slice(0, 32)) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue;
      const n = Math.max(1, Math.min(99, Math.round(Number(r.n) || 1)));
      /**
       * `t` IS THE ONE FIELD V16 §B5 ADDED, and it is the whole of the
       * migration the header promised there would not be: a row without it
       * reads as stowed at hour nought, which is the oldest anything can be,
       * so a save from before this lane comes back as a larder full of things
       * that have gone off rather than as a larder full of things that never
       * will. Erring stale is the only safe direction — the other one hands a
       * player a bowl of noodle that is fresh for ever.
       *
       * It is the ABSOLUTE station clock (`Food.clockOf(day, hour)`), not an
       * hour of the day: see that function for why an hour alone cannot say
       * whether a jar is five hours old or twenty-nine. Clamped like every
       * other number that survives a hand edit.
       */
      const t = Math.max(0, Math.min(1e9, Math.round(Number(r.t) || 0)));
      out.store[bin].push({ id: r.id.slice(0, 32), n, t });
    }
  }
  return out;
}

function snap(v) { return Math.round(v / CELL) * CELL; }

/** The home as it is saved, validated. Never null, never half-populated. */
export function loadHome() { return clean(homeState()); }

/** Write it back, validated a second time so a caller cannot store rubbish. */
export function saveHome(rec) { return setHomeState(clean(rec)); }

/**
 * The same clamp, on a record that did not come off this machine's disk.
 *
 * `Coop.js` reads a friend's home off the wire, which is a hand-edited save
 * with a shorter wire: 4000 pieces at coordinates a kilometre out is bodies
 * spawned into deck 44 on somebody else's machine. Restating those clamps
 * there would be `HANDOFF` §2.4's manufactured second copy, so the validator
 * gets a door instead of a twin.
 */
export function cleanHome(rec) { return clean(rec); }

/**
 * What the home HOLDS (V16 §2 B5, §3.2). Its own door, so that the food lane
 * and the parcels desk write one field each and never the whole record.
 */
export function homeStock() { return loadHome().store; }
export function setHomeStock(bin, rows) {
  const rec = loadHome();
  if (bin !== 'food' && bin !== 'parcels') return rec.store;
  rec.store[bin] = Array.isArray(rows) ? rows : [];
  return clean(saveHome(rec)).store;
}

/**
 * ══ AND WHICH FIXTURE THE CABIN HAS — WRITTEN FROM THE HABITAT ════════════
 *
 * §1.3 puts the choice in ANOTHER ROOM, so this cannot be a verb on the
 * cabin's key: the player making it is standing at #28 with the cabin two
 * decks away and possibly not dressed at all. It is `setHomeStock`'s shape for
 * `setHomeStock`'s reason — read the fold, change one field, write the fold —
 * and it goes through `saveHome`, which is `StationSave.setHomeState`. There
 * is still no `localStorage` in this file and `session.mjs` still counts the
 * same writers it counted yesterday.
 *
 * `null` (or any id not on the table) takes the fixture out, which is the
 * other half of a choice.
 *
 * @param world optional — pass the live world and the room re-dresses on the
 *              same call, so a player who walks home finds what they chose
 *              rather than what was there when the level was built.
 * @returns the id that is now stored.
 */
export function setPad(id, world = null) {
  const want = PAD_BY_ID.has(id) ? id : null;
  const rec = loadHome();
  rec.pad = want;
  saveHome(rec);
  /* THE ROOM, IF THERE IS ONE. Only your own: `dressPad` is a fixture builder
   * and every fixture in this file belongs to the apartment it was dressed
   * with — see `dressHome`'s note on `mine`. */
  const h = world?._home;
  if (h && h.mine) {
    h.state.pad = want;
    undressPad(h);
    dressPad(world, h);
  }
  return want;
}

/** Which fixture the cabin has, off the fold. The habitat's own read. */
export function homePad() { return loadHome().pad; }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LARDER — V16 §B5                                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE PEN IS HERE AND THE ARITHMETIC IS IN `Food.js` ════════════════════
 *
 * *"you can buy food … then you can take it home and store it in your
 * apartment and eat it for buffs."*
 *
 * The field is `store.food`, which this file has been reserving for exactly
 * this since V15 — see `clean` and the header. It is NOT a second store, and
 * these four doors exist so that the food lane never has to hold the whole
 * home record to add a jar of pickle to it: each of them reads one field,
 * hands it to a pure function in `Food.js`, and writes the one field back
 * through `setHomeStock`.
 *
 * `Food.js` cannot do this itself and must not learn how. It is pure — no
 * store, no world, no THREE — which is what lets `food.mjs` drive a week of
 * shopping with no disk at all. The dependency runs one way: Home knows about
 * Food, Food knows nothing about Home.
 *
 * ── EVERY READ SWEEPS ─────────────────────────────────────────────────────
 *
 * `Food.sweep` throws out whatever the clock has killed before the rows are
 * handed back, so a screen can never draw a row that `takeFood` would then
 * refuse. A list with dead entries in it is a list that lies, and the player
 * finds out at the moment they were counting on a meal.
 */

/** What is in the larder now, with anything past its keeping thrown out. */
export function larder(clock = 0) {
  const { kept, lost } = Food.sweep(homeStock().food, clock);
  if (lost.length) setHomeStock('food', kept);
  return Food.larderRows(kept, clock);
}

/** Put `n` of a dish in it. Returns `{ ok, why, rows }` — a refusal speaks. */
export function stowFood(dish, opts = {}) {
  const now = Number.isFinite(opts.clock) ? opts.clock : Food.clockOf(opts.day, opts.hour);
  const { kept } = Food.sweep(homeStock().food, now);
  const r = Food.stow(kept, dish, { ...opts, clock: now });
  if (r.ok) setHomeStock('food', r.rows);
  return { ok: r.ok, why: r.why, rows: Food.larderRows(r.ok ? r.rows : kept, now) };
}

/**
 * Take one out. Returns the counter row itself, so the caller hands it
 * straight to `Food.eat` — this file has no opinion about what eating does.
 */
export function takeFood(id, opts = {}) {
  const now = Number.isFinite(opts.clock) ? opts.clock : Food.clockOf(opts.day, opts.hour);
  const { kept } = Food.sweep(homeStock().food, now);
  const r = Food.unstow(kept, id);
  if (r.ok) setHomeStock('food', r.rows);
  return { ok: r.ok, why: r.why, dish: r.ok ? Food.dishById(id) : null };
}

/**
 * ══ AND A DEATH EMPTIES IT ════════════════════════════════════════════════
 *
 * `Progress.js`'s amendment: a provision is *"a run's worth of something, and
 * gone when the run ends."* An uneaten dish is still a provision, so it goes
 * with the run that failed to eat it — `Food.afterDeath` decides which rows
 * those are, by testing the row rather than by emptying the list, so a
 * mods-free keepsake you eat would survive without anybody having to come
 * back here.
 *
 * NOTHING CALLS THIS YET. The one funnel every death and quit goes through is
 * `main.js`'s `record()`, which this lane may not edit; the line for it is in
 * the report. Until it is wired, the guarantee that actually holds is the
 * stronger one: a meal's EFFECT is never written anywhere at all, so no buff
 * can outlive anything. This closes the smaller hole of a larder that
 * outlives the run it was stocked for.
 */
export function emptyLarder() {
  const { kept, lost } = Food.afterDeath(homeStock().food);
  setHomeStock('food', kept);
  return { kept: kept.length, lost: lost.reduce((a, r) => a + (r.n | 0), 0) };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PARCELS — V16 §3.2, and it is where a bought piece of furniture waits  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHY A CRATE YOU PAID FOR IS NOT ON THE FLOOR THE INSTANT YOU PAY ══════
 *
 * The audit: four `slot:'home'` rows on the counters, of which three named
 * nothing in `CATALOGUE` at all — so a Narn banner and a mounted skull were
 * 240 and 2100 credits for a string. The rows are real ids now, and this is
 * where they land.
 *
 * They land in `store.parcels` and not in `pieces`, and the reason is the
 * partition. `fits()` — the one rule about where a piece may stand — needs
 * `h.blockers`, which the room's OWN shape hands back through `ctx.home` at
 * dress time (`StationKit.twinroom` declares four: the partition, the trophy
 * rack, the saber stand and the bunk). Nothing off the disk knows those, so a
 * delivery that put a locker down from the Concourse would put it in a wall
 * about a fifth of the time — measured over the cabin's 30 × 22 grid, the
 * blockers cover 19% of it.
 *
 * So the parcel waits and the ROOM unpacks it, which is exactly the sentence
 * this file's header wrote when it reserved the field: *"§3.2's shipping
 * office delivers to your apartment overnight."* You buy it at the counter,
 * and it is standing in your cabin the next time you walk in.
 *
 * `store.parcels` already validates as `{ id, n, t }` and needs no migration:
 * `id` is the catalogue id, `n` is how many of them and `t` is the station
 * clock it was sent at, exactly as the larder uses them.
 */

/** Send a catalogue piece home. Returns `{ ok, why }` — a refusal speaks. */
export function deliverPiece(id, opts = {}) {
  const c = BY_ID.get(id);
  if (!c) return { ok: false, why: `there is no such thing as a ${id}` };
  const rec = loadHome();
  const held = rec.pieces.length + rec.store.parcels.reduce((a, r) => a + (r.n | 0), 0);
  if (held >= MAX_PIECES) return { ok: false, why: `a cabin holds ${MAX_PIECES} pieces and yours is full` };
  const t = Math.max(0, Math.round(Number(opts.clock) || 0));
  const rows = rec.store.parcels.slice();
  const at = rows.findIndex((r) => r.id === c.id);
  if (at >= 0) rows[at] = { ...rows[at], n: Math.min(99, rows[at].n + 1) };
  else rows.push({ id: c.id, n: 1, t });
  setHomeStock('parcels', rows);
  return { ok: true, why: null, piece: c.name, waiting: rows.length };
}

/** What is waiting to be unpacked, as catalogue rows. For a screen. */
export function parcels() {
  return loadHome().store.parcels
    .map((r) => ({ ...r, kind: BY_ID.get(r.id) || null }))
    .filter((r) => r.kind);
}

/**
 * ══ UNPACKED BY THE ROOM, BECAUSE THE ROOM KNOWS WHERE THE WALLS ARE ══════
 *
 * Called once from `dressHome`, after `h` exists and therefore after the
 * blockers do. Every parcel is walked onto the first free cell of a lattice
 * scanned from the middle of the floor outwards, tested with `fits()` — the
 * same rule the player's own hands are held to, so a delivered piece can never
 * stand anywhere they could not have put it themselves.
 *
 * A parcel that will not fit STAYS A PARCEL. That is deliberate: a cabin with
 * no floor left keeps your banner in the box until you move something, which
 * is a thing you can act on, and the alternative — dropping it, or stacking it
 * on the bunk — is a purchase quietly deleted.
 *
 * Only yours. A guest's apartment is dressed from a record that came off the
 * wire and unpacking into it would put YOUR furniture in THEIR room and then
 * write it to your disk on the way out.
 */
function unpackParcels(world, h) {
  if (!h.mine) return 0;
  const rows = h.state.store?.parcels || [];
  if (!rows.length) return 0;
  const left = [];
  let put = 0;
  for (const r of rows) {
    const c = BY_ID.get(r.id);
    let n = c ? (r.n | 0) : 0;
    while (n > 0 && h.state.pieces.length < MAX_PIECES) {
      const at = freeCell(h, c);
      if (!at) break;
      /* The row only. `dressHome` spawns a `Prop` for every row immediately
       * below this call and `spawnPiece` PUSHES onto `h.props`, so a null
       * pushed here would put the two lists one apart for ever — and
       * `leaveHome` reads `h.props[i]` against `h.state.pieces[i]` to find out
       * where a piece was pushed to. */
      h.state.pieces.push({ k: c.id, x: at.x, z: at.z, r: 0 });
      n--; put++;
    }
    if (n > 0) left.push({ ...r, n });
  }
  if (!put) return 0;
  h.state.store = { ...h.state.store, parcels: left };
  /* WRITTEN WHOLE, HERE, AND NOT LEFT TO `leaveHome`. That function takes
   * `store` from the DISK on the way out — correctly, because the larder and
   * the pad are written while you are somewhere else — so a parcel emptied
   * only in memory would come back on the next visit and be unpacked again,
   * once per visit, for ever. One save, both halves, at the moment the two
   * facts change together. */
  saveHome(h.state);
  h.dirty = false;
  h.edits++;
  world?.notify?.('DELIVERED', put === 1 ? 'a parcel was waiting for you' : `${put} parcels were waiting for you`);
  return put;
}

/**
 * The first cell a piece will stand on, scanned outwards from the middle.
 *
 * Outwards rather than from a corner so a delivery lands in the room rather
 * than behind the door, and deterministic — no `Math.random` in `src/`, and
 * two players unpacking one record must get one layout.
 */
function freeCell(h, c) {
  const nx = Math.floor(h.hx / CELL), nz = Math.floor(h.hz / CELL);
  const n = Math.max(nx, nz);
  for (let ring = 0; ring <= n; ring++) {
    for (let ix = -ring; ix <= ring; ix++) {
      for (let iz = -ring; iz <= ring; iz++) {
        if (Math.max(Math.abs(ix), Math.abs(iz)) !== ring) continue;
        if (Math.abs(ix) > nx || Math.abs(iz) > nz) continue;
        const x = ix * CELL, z = iz * CELL;
        if (!fits(h, c, x, z, 0)) return { x, z };
      }
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  DRESSING THE ROOM                                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * ══ WHICH ROOM A DRESSING GOES BEHIND ═════════════════════════════════════
 *
 * `SHAPES.twinroom` is the only builder that hands back a home spot, and it
 * hands back #27's — the footprint AND the four rectangles a piece may not be
 * set down in. Lane F dresses a home behind a RESIDENCE (`Coop.GUEST_ROOMS`:
 * `#31`, `#38`, `#33`) whose builder declares nothing of the sort, so the spot
 * for one is derived from the gazetteer row that every place already has: the
 * same centre, yaw, footprint and deck floor `buildPlace` emitted the room at.
 *
 * WHAT IS LOST BY DERIVING IT, SAID PLAINLY AND NOT PAPERED OVER: `blockers`
 * comes back EMPTY, so inside a converted residence the grid knows the walls
 * and nothing inside them — a chair may be set down in the Centauri fountain.
 * The honest fix is one declared rectangle per shape in `StationKit`, exactly
 * as `twinroom` has; until that is written this is a room you may furnish
 * through, not a room with no rules. It is bounded, snapped and capped like
 * every other home, which is the part that protects the record.
 */
function spotOf(st, id) {
  if (!st || !Number.isFinite(id)) return null;
  if (st.home && st.home.id === id) return st.home;
  const rec = st.places.get(id);
  const p = rec?.place;
  if (!p || !(p.w > 2 && p.d > 2)) return null;
  return { id: p.id, deck: p.deck, x: p.x, z: p.z, yaw: p.yaw, y: floorOf(p),
    w: p.w, d: p.d, h: p.h, blockers: [] };
}

/**
 * ══ THE HOME, PUT UP ══════════════════════════════════════════════════════
 *
 * Called by `dressStation` once the places are built, with the station's own
 * materials — which is how this file avoids importing `Station.js` and closing
 * a cycle round `StationKit`. Everything made here goes into the PLACE'S GROUP,
 * so `undressStation`'s existing teardown frees the geometry and the cull
 * switches the home off with the room it is in.
 *
 * ── AND THERE MAY NOW BE FOUR OF THEM, OF WHICH EXACTLY ONE IS YOURS ──────
 *
 * `Coop.js` calls this again, once per guest, with `opts.owner` and the record
 * that came off THEIR machine. Every apartment is the same object and is put
 * up by the same code — the only difference between yours and a friend's is
 * two fields, and every rule in this file that has to know reads them:
 *
 *   `mine`   TRUE for exactly one dressed home per world. `world._home` is it,
 *            and it is the ONLY home the placement verbs can name — `addPiece`,
 *            `takePiece`, `dropPiece`, `movePiece`, `rotatePiece` and
 *            `setSurface` every one of them start `world._home`, so "a guest
 *            may not rearrange your cabin" is not a permission test that can be
 *            forgotten, it is the absence of a way to say it. See `Coop.js`
 *            §WHO MAY MOVE THE FURNITURE.
 *   `owner`  `{ id, name }` for a friend's, null for yours. It is what the
 *            refusal names, and a refusal that cannot name whose room this is
 *            is a control that ignores you.
 *
 * @param st the station record; `st.home` is what `SHAPES.twinroom` handed back.
 * @param opts `{ place, state, owner }` — the door, the dressing and whose.
 */
export function dressHome(world, st, M, opts = {}) {
  const spot = spotOf(st, opts.place ?? st?.home?.id);
  if (!world || !spot) return null;
  const rec = st.places.get(spot.id);
  if (!rec) return null;

  /* YOURS COMES OFF THE DISK AND A GUEST'S COMES OFF THE WIRE, and neither
   * path can be the other: `loadHome` reads the one durable fold this machine
   * has, which is the local player's and nobody else's. A guest's record is
   * re-validated here anyway — it crossed a wire, and `clean` is the same
   * clamp a hand-edited save meets. */
  const mine = !opts.owner;
  /* AND `opts.state` OVERRIDES THE DISK EVEN FOR YOUR OWN, which is the one
   * case `Coop.reseatMine` needs: an apartment assignment can arrive after the
   * level is built, and moving your dressing to the door you were given must
   * carry the chairs you moved before it arrived rather than re-reading a fold
   * that has not been written since you walked in. */
  const state = opts.state ? clean(opts.state) : (mine ? loadHome() : clean(null));
  /* THE ROOM IT IS BEHIND IS THE ROOM IT IS DRESSED IN, and the record is
   * told which one that was. Lane F assigns a different door per player and
   * nothing else in the record has to change. */
  state.place = spot.id;

  const h = {
    spot, group: rec.group, place: rec.place, M, state,
    address: homeAddress(rec.place),
    /** Exactly one dressed home per world is yours; the verbs know no other. */
    mine,
    /** Whose this is: `{ id, name }`, or null when it is yours. */
    owner: opts.owner || null,
    /** The room's frame, resolved once. Local (x,z) → world (x,z). */
    cos: Math.cos(spot.yaw), sin: Math.sin(spot.yaw),
    y: spot.y,
    /** Half-extents of the placeable floor, inside the walls. */
    hx: spot.w / 2 - 0.5, hz: spot.d / 2 - 0.5,
    /**
     * What the grid may not be put into. REBUILT by `syncWalls` from the
     * walls plus the shape's other three, and never the shape's own array —
     * see `dressWalls` for why aliasing it would move `st.home`'s declaration.
     */
    blockers: [...(spot.blockers || [])],
    /** V15 §1.3.3 — the partitions, one per entry. `dressWalls` fills it. */
    walls: [],
    /** Why the shape's partition could not be taken over, or null. */
    wallWhy: null,
    /** The shape's own slab, as the vertices of it inside the room's mesh. */
    kitWall: null,
    /** Live bodies, one per row of `state.pieces`. */
    props: [],
    /** The piece in your hands: `{ c, r, x, z, from, ghost }` or null. */
    held: null,
    /** Where the catalogue wheel is sitting when nothing is held. */
    dial: 0,
    /** Set by anything that changes the record. `leaveHome` reads it. */
    dirty: false,
    /**
     * HOW MANY TIMES THE RECORD HAS BEEN CHANGED, and it only ever climbs.
     *
     * `dirty` is a flag that `leaveHome` CLEARS, so it cannot answer "has
     * anything happened since the last time I looked" for a second reader —
     * and Lane F has one: `Coop.publishApartment` puts this room on the wire
     * when it changes and must not stringify a forty-piece home every frame to
     * find out. A counter answers that in one integer compare and has no
     * owner to fight over.
     */
    edits: 0,
    /** V15 §1.3 — the perch/basket/charge pad, and what is standing on it. */
    pad: null,
    surfaces: null, mirror: null, galley: null, panel: null, sign: null, wheel: null, draws: 0,
    /** Every mesh this dressing put in the room's group — see `undressOne`. */
    built: [],
  };
  if (mine) world._home = h;
  /* EVERY DRESSED APARTMENT, YOURS FIRST. `homeUnder` walks it to answer which
   * room a player is standing in, and `undressHome` walks it to take them all
   * down — a guest's cabin that outlived the visit would be a live body list
   * pointing into a disposed world. */
  (world._homes || (world._homes = [])).push(h);

  /* THE SHAPE'S PARTITION FIRST, before this file has put a single mesh in
   * the group — see `takeKitPartition` for the measurement that says why the
   * order is load-bearing and not a preference. */
  h.kitWall = takeKitPartition(h);
  dressSurfaces(world, h);
  dressMirror(world, h);
  dressGalley(world, h);
  dressPanel(world, h);
  /* …and the one fixture that may not be there at all. AFTER the panel and
   * before the sign for no reason but the order they stand in the room. */
  dressPad(world, h);
  dressSign(world, h);
  /* …and the partitions, AFTER the sign, because putting the third room up
   * redraws the sign and there has to be one to redraw. */
  dressWalls(world, h);
  /* WHAT THE SHOP SENT, BEFORE THE BODIES ARE MADE — a parcel unpacked after
   * the loop below would be a row in the record with no `Prop` beside it, and
   * `leaveHome` walks the two lists in step. See `unpackParcels`. */
  unpackParcels(world, h);
  for (const p of state.pieces) spawnPiece(world, h, p);
  /* ONE WHEEL LISTENER PER WORLD, NOT PER ROOM. The wheel turns the piece in
   * YOUR hands and dials YOUR catalogue; a listener per guest apartment would
   * be four claims on one notch, three of which have nothing to spend it on. */
  if (mine) attachWheel(world, h);
  st.draws += h.draws;
  return h;
}

/**
 * ══ WHICH APARTMENT A PLAYER IS STANDING IN, WHOEVER'S IT IS ══════════════
 *
 * `inHome` answers "are you in YOUR home", which is the fence every verb in
 * this file wants and is the wrong question at a friend's front door. This is
 * the other one, and the two together are the whole of the co-op key: you are
 * in a room, and the room either is or is not yours.
 */
export function homeUnder(world) {
  const p = world?.player?.position;
  if (!p) return null;
  for (const h of world._homes || []) {
    const l = toLocal(h, p.x, p.z);
    if (Math.abs(l.x) <= h.spot.w / 2 && Math.abs(l.z) <= h.spot.d / 2) return h;
  }
  return null;
}

/** Local room coordinates → world. The frame `buildPlace` emitted the kit in. */
function toWorld(h, lx, lz, out = _v) {
  return out.set(h.spot.x + lx * h.cos + lz * h.sin, h.y, h.spot.z - lx * h.sin + lz * h.cos);
}

/** …and back, which is what a crosshair on the floor has to be turned into. */
function toLocal(h, wx, wz, out = { x: 0, z: 0 }) {
  const dx = wx - h.spot.x, dz = wz - h.spot.z;
  out.x = dx * h.cos - dz * h.sin;
  out.z = dx * h.sin + dz * h.cos;
  return out;
}

/**
 * Floor, wainscot and trim, as three meshes and not thirty.
 *
 * One merged geometry per SLOT, because a slot is what a player recolours and
 * a mesh is what carries a material — so re-dressing a wall is one assignment
 * rather than a walk. Three draws for the whole of §1.3.2.
 */
function dressSurfaces(world, h) {
  const { w, d } = h.spot;
  const mk = (geos, key, name) => {
    const geo = mergeGeos(geos);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, h.M[key]);
    mesh.name = `home-${name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.position.copy(toWorld(h, 0, 0));
    mesh.quaternion.setFromAxisAngle(UP, h.spot.yaw);
    h.group.add(mesh);
    h.built.push(mesh);
    h.draws++;
    return mesh;
  };
  /* The floor skin, a centimetre proud of the plate so it is what you see. */
  const fl = slabGeo(w - 0.1, 0.02, d - 0.1, { bevel: 0 }); fl.translate(0, 0.02, 0);
  /* The wainscot: three walls, the fourth being the window. */
  const wall = [];
  for (const s of [-1, 1]) {
    const g = slabGeo(0.06, 1.1, d - 0.2, { bevel: 0 });
    g.translate(s * (w / 2 - 0.05), 0.55, 0);
    wall.push(g);
  }
  const front = slabGeo(w - 0.2, 1.1, 0.06, { bevel: 0 });
  front.translate(0, 0.55, -(d / 2 - 0.05));
  wall.push(front);
  /* The trim: a lit line where the wainscot stops. */
  const trim = [];
  for (const s of [-1, 1]) {
    const g = slabGeo(0.09, 0.07, d - 0.2, { bevel: 0 });
    g.translate(s * (w / 2 - 0.06), 1.14, 0);
    trim.push(g);
  }
  const tf = slabGeo(w - 0.2, 0.07, 0.09, { bevel: 0 });
  tf.translate(0, 1.14, -(d / 2 - 0.06));
  trim.push(tf);

  h.surfaces = {
    floor: mk([fl], h.state.surfaces.floor, 'floor'),
    wall: mk(wall, h.state.surfaces.wall, 'wall'),
    trim: mk(trim, h.state.surfaces.trim, 'trim'),
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PARTITIONS — V15 §1.3.3, AND THE THIRD ROOM                           */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  *"Make the partition movable and let a third be unlocked — the address is
 *   what pays for it."*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT WAS THERE, MEASURED ──────────────────────────────────────────────
 *
 * A STATIC BLOCKER AND NOTHING ELSE. `SHAPES.twinroom` lays one slab —
 * `kit.slab(M.hull, w - 3.2, h, 0.3, -1.6, h/2, 0.6, { collide: true })` — and
 * hands its rectangle over on `ctx.home.blockers[0]`, and the only line in
 * this file that had ever read it was `fits`, to REFUSE a piece with the words
 * "in the partition". Nothing moved it, there was no second one, and
 * `grep -rn "third\|unlock" src/` found the blocker and this file's own
 * header note. The four blockers cover 19% of the 30 × 22 grid.
 *
 * ══ "THE ADDRESS IS WHAT PAYS FOR IT", AND IT IS NOT A CURRENCY ═══════════
 *
 * The player's sentence is the mechanism, so it has to be read rather than
 * paraphrased into a price. Three readings were on the table:
 *
 *   A PRICE IN CREDITS. `Progress.js`'s AMENDMENT — CREDITS allows exactly two
 *     kinds of purchase, and a room would have to be a KEEPSAKE: cosmetic,
 *     permanent, carrying no number. A room passes that test. It is still the
 *     wrong answer, and the reason is one line further up the same file:
 *     *"no unlocks — every crystal, cut, species and order is available from
 *     the first run. A creator you have to earn is a creator you cannot use."*
 *     A ROOM YOU HAVE TO EARN IS A ROOM YOU CANNOT USE. It would also be the
 *     first keepsake in the tree that is not a thing you look at but a thing
 *     you live in, and the shop's own contract (`Keepsakes.js`) is that a
 *     purchase DYES something rather than granting it.
 *
 *   A TIMER — so many station days at the address. That is a currency wearing
 *     a clock: something accumulates and then buys, which is the shape the
 *     doctrine refuses, and it makes the room a thing that happens TO you.
 *
 *   THE ADDRESS ITSELF, WHICH IS WHAT HE SAID. §1.3.4: the address is *"what
 *     makes a home a place rather than a menu"*, derived from the deck, the
 *     sector and the door number, printed on the door and on the notice board.
 *     It is a DEED. And a deed does not buy floor — IT ALREADY COVERS THE
 *     FLOOR. The cabin is 15 × 11 m whether it is one room or three; a third
 *     room adds not one square metre. What it adds is a WALL, and the thing
 *     that entitles you to put a wall up inside a room is that the room is
 *     yours.
 *
 * SO THE THIRD ROOM COSTS NOTHING AND IS REFUSED IN EXACTLY ONE PLACE: an
 * apartment whose address is not yours. Every verb below starts at
 * `world._home`, which `dressHome` assigns only under `mine` — so "you may
 * divide your own cabin and not your friend's" is not a permission test that
 * can be forgotten, it is the absence of a way to say it, which is the same
 * construction `Coop.js` §WHO MAY MOVE THE FURNITURE already relies on. And
 * the payment is VISIBLE rather than asserted: the door sign is redrawn when
 * the count changes, so the address on the door is the thing that says how
 * many rooms are behind it.
 *
 * ══ THE GRAMMAR IS THE ROOM'S OWN, TURNED NINETY DEGREES AGAIN ════════════
 *
 * `dressPanel` states it: *"the wheel says WHAT and the key says WHERE"*, and
 * the swatch panel turns that into "the key steps the slot, the wheel runs the
 * colours". Standing at a partition:
 *
 *   THE WHEEL SLIDES THE WALL YOU ARE STANDING AT — half a metre a notch,
 *     which is `CELL`, so a wall lands on the same grid the furniture does.
 *   THE KEY PUTS THE SECOND WALL UP, OR TAKES IT DOWN. One press, one meaning,
 *     at either wall, and never a dead branch: it is the toggle for whether
 *     there is a third room.
 *
 * §14's "the station adds no interface" holds — no new binding, no new screen.
 *
 * ══ AND A WALL IS HELD TO THE RULE THE FURNITURE IS HELD TO ═══════════════
 *
 * `fits` refuses a piece that would stand in a partition. `wallFits` is the
 * same test with the mover and the obstacle swapped: a wall may not be slid
 * into a chair, into the bunk, into the trophy rack or into the saber stand,
 * and it may not leave a bay shallower than `MIN_ROOM`. A refusal names what
 * is in the way, exactly as `dropPiece`'s does, because the alternative is
 * furniture silently deleted by a wall — and the one thing this file will not
 * do is destroy something the player put down. Move the chair, then the wall.
 */

/**
 * ══ TAKING THE SHAPE'S PARTITION OVER, WITHOUT EDITING THE SHAPE ══════════
 *
 * The slab is MERGED. `Kit.emit` bins by material and hands back one mesh per
 * material, so the partition is 96 vertices inside the room's 864-vertex
 * `hull` mesh with no handle of its own, and its collider is a static box in
 * `physics.staticBoxes` that `buildPlace` counts and then drops. There is no
 * API that says "the partition"; there is a rectangle the SHAPE DECLARED.
 *
 * So the selection is driven by that declaration and never by a second copy of
 * it: every vertex inside `blockers[0]`, between the floor and the ceiling, is
 * the partition. If StationKit moves the slab the blocker moves with it
 * (`home.mjs` already checks they agree) and this follows. That is the
 * difference between reading a thing back out of the kit — `HANDOFF` §2.3's
 * hand-maintained twin, which this file's own header warns about — and reading
 * the kit against the statement it published.
 *
 * TWO THINGS MAKE IT SAFE TO DO AT ALL:
 *
 *   IT RUNS BEFORE THIS FILE HAS PUT ANYTHING IN THE GROUP. `dressMirror` and
 *   `dressPanel` add meshes whose geometry is in their OWN frame, near the
 *   origin, and four of their vertices land inside the partition's rectangle
 *   when read as room coordinates — measured, 32 of the mirror frame's 96 and
 *   32 of the glass's. Taking the partition first means "what is in the group"
 *   is a fact about the ROOM rather than a filter over this file's own work.
 *
 *   THE SELECTION IS CHECKED AGAINST ITS OWN BOUNDS. One mesh, and the union
 *   of what was picked has to BE the declared rectangle to the millimetre. A
 *   partial or a scattered match returns null and the feature is inert, with
 *   the reason on `h.wallWhy` for `home.mjs` to read — because a wall that
 *   moved half of itself would be worse than a wall that does not move.
 */
function takeKitPartition(h) {
  const b = (h.spot.blockers || [])[0];
  if (!b) { h.wallWhy = 'the shape declares no partition'; return null; }
  const H = h.spot.h;
  const hit = [];
  for (const m of h.group.children) {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) continue;
    const p = m.geometry.attributes.position;
    const idx = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (Math.abs(x - b.x) > b.w / 2 + WALL_EPS) continue;
      if (Math.abs(z - b.z) > b.d / 2 + WALL_EPS) continue;
      if (y < -WALL_EPS || y > H + WALL_EPS) continue;
      idx.push(i);
    }
    if (idx.length) hit.push({ mesh: m, idx });
  }
  if (hit.length !== 1) {
    h.wallWhy = `${hit.length} meshes carry geometry inside the partition's rectangle`;
    return null;
  }
  const { mesh, idx } = hit[0];
  const p = mesh.geometry.attributes.position;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const baseZ = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i];
    const x = p.getX(j), y = p.getY(j), z = p.getZ(j);
    baseZ[i] = z;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const want = [b.x - b.w / 2, b.x + b.w / 2, 0, H, b.z - b.d / 2, b.z + b.d / 2];
  const got = [x0, x1, y0, y1, z0, z1];
  for (let i = 0; i < 6; i++) {
    if (Math.abs(want[i] - got[i]) <= 2 * WALL_EPS) continue;
    h.wallWhy = `what was picked out of the room measures ${got.map((v) => v.toFixed(2)).join('/')} `
      + `against the declared ${want.map((v) => v.toFixed(2)).join('/')}`;
    return null;
  }
  h.wallWhy = null;
  return { mesh, idx: new Int32Array(idx), baseZ, at: b.z };
}

/** Slide the shape's own slab, in its own merged mesh, to `z`. */
function slideKitPartition(kit, z) {
  const p = kit.mesh.geometry.attributes.position;
  const dz = z - kit.at;
  for (let i = 0; i < kit.idx.length; i++) p.setZ(kit.idx[i], kit.baseZ[i] + dz);
  p.needsUpdate = true;
  /* The room's bounding sphere was computed with the slab where the kit left
   * it. Culling is per-MESH and the mesh is the whole room, so a stale sphere
   * would cull a wall that had been slid towards the camera. 864 vertices,
   * once per notch. */
  kit.mesh.geometry.computeBoundingSphere();
}

/**
 * The static box a partition is, put where the record says.
 *
 * REMOVE AND RE-ADD RATHER THAN MOVE, which is `RapierWorld.addStaticBox`'s
 * own sentence for exactly this case: *"a `removeStaticBox` and an
 * `addStaticBox` in one frame — a door that swings, a wall that…"*. Writing
 * `collider.setTranslation` would leave `physics.boxVersion` and therefore
 * `BoxIndex`'s spatial buckets stale, so the six hand-rolled sweeps that read
 * `staticBoxes` directly — `Support.supportHeight`, `Player._collide` and both
 * of `Enemy`'s — would go on finding the wall where it used to be. The pair
 * bumps the version between them and there is no third opinion to keep.
 */
function setWallBox(world, h, W) {
  const phys = world && world.physics;
  if (!phys || !phys.addStaticBox) return;
  if (W.box) { phys.removeStaticBox(W.box); W.box = null; }
  const c = toWorld(h, W.rect.x, W.rect.z, new THREE.Vector3());
  c.y = h.y + h.spot.h / 2;
  W.box = phys.addStaticBox(c,
    new THREE.Vector3(W.rect.w / 2, h.spot.h / 2, W.rect.d / 2),
    new THREE.Quaternion().setFromAxisAngle(UP, h.spot.yaw), { friction: 0.8 }) || null;
}

/**
 * Find the static box `Kit.emit` made for the shape's own partition.
 *
 * FAILING TO FIND IT IS THE ONE OUTCOME THAT MUST NOT HAPPEN QUIETLY, because
 * `setWallBox` removes what it is given and adds a new one: handed null it
 * would leave the kit's original standing at 0.6 and put a second box wherever
 * the wall went, and the cabin would be solid in two places with nothing on
 * screen at one of them. So both search paths are covered. `nearBoxes` is *"the
 * one place `staticBoxes` is meant to be searched from"* and is the fast one;
 * `Physics.js` — the older sphere solver, which `RapierWorld` shares the array
 * with — has no such index, and its own note says sweeping the array by hand
 * "still works and still gives the same answer; it costs O(every box in the
 * level) PER BODY PER FRAME". This runs once per dressing.
 */
function findKitBox(world, h, rect) {
  const phys = world && world.physics;
  if (!phys || !Array.isArray(phys.staticBoxes)) return null;
  const c = toWorld(h, rect.x, rect.z, new THREE.Vector3());
  let near = phys.staticBoxes;
  if (phys.nearBoxes) { near = []; phys.nearBoxes(c.x, c.z, 2, near); }
  for (const r of near) {
    if (Math.hypot(r.center.x - c.x, r.center.z - c.z) > 0.05) continue;
    if (Math.abs(r.halfExtents.x - rect.w / 2) > 0.02) continue;
    if (Math.abs(r.halfExtents.z - rect.d / 2) > 0.02) continue;
    return r;
  }
  return null;
}

/** The second partition's leaf, as a real mesh in the room's own group. */
function buildWallMesh(h, W) {
  const g = slabGeo(W.rect.w, h.spot.h, W.rect.d, { bevel: 0 });
  g.translate(0, h.spot.h / 2, 0);
  const m = new THREE.Mesh(g, h.M.hull);
  m.name = 'home-partition';
  m.castShadow = true;
  m.receiveShadow = true;
  h.group.add(m);
  h.built.push(m);
  h.draws++;
  return m;
}

/** Stand a wall's mesh and its collider where `W.rect` now says. */
function poseWall(world, h, W) {
  if (W.kit) slideKitPartition(W.kit, W.rect.z);
  else if (W.mesh) {
    W.mesh.position.copy(toWorld(h, W.rect.x, W.rect.z));
    W.mesh.quaternion.setFromAxisAngle(UP, h.spot.yaw);
  }
  setWallBox(world, h, W);
}

/**
 * ══ THE WALLS, PUT UP ═════════════════════════════════════════════════════
 *
 * The shape's partition first, wherever the record says it stands, then the
 * second one if the record has two. `h.blockers` is REBUILT from the walls
 * plus the three obstacles the shape declared that are not the partition —
 * and it is rebuilt rather than edited, because `spot.blockers` is
 * `st.home`'s own array and this room is dressed and re-dressed while the
 * station stands (`Coop.js` re-dresses a guest's on every change). Mutating it
 * would move the shape's declaration and the second dressing would read a
 * rectangle the first one had walked.
 */
function dressWalls(world, h) {
  h.walls = [];
  const kitRect = (h.spot.blockers || [])[0];
  if (h.kitWall && kitRect) {
    const W = { i: 0, kit: h.kitWall, mesh: null, box: findKitBox(world, h, kitRect),
      rect: { x: kitRect.x, z: kitRect.z, w: kitRect.w, d: kitRect.d } };
    h.walls.push(W);
    /**
     * WHERE THE RECORD SAYS, CLAMPED AGAINST THE REAL ROOM — which `clean`
     * could not do, because it does not know how deep the room is. Same split
     * the pieces are under.
     *
     * AND AN EMPTY RECORD KEEPS THE SHAPE'S OWN NUMBER UNTOUCHED, off the
     * grid if that is where the shape put it (it is: `twinroom` builds at
     * z = 0.6 and `CELL` is 0.5). A fresh home is the cabin §3.2 describes to
     * the centimetre; the grid is what a wall lands on once a PLAYER has moved
     * it, which is the same rule `DEFAULT_LAYOUT` is under one screen up.
     */
    const want = h.state.walls[0];
    if (Number.isFinite(want) && !wallFits(h, 0, snap(want))) W.rect.z = snap(want);
    poseWall(world, h, W);
  }
  if (h.walls.length && Number.isFinite(h.state.walls[1])) {
    const W = secondWall(h, snap(h.state.walls[1]));
    if (W) {
      W.mesh = buildWallMesh(h, W);
      poseWall(world, h, W);
    }
  }
  syncWalls(h);
  /* The door was drawn before the walls went up — see the order in
   * `dressHome` — so it is told the count now. Idempotent: `signPanel.draw`
   * early-outs on identical text, which is what a two-room cabin gets. */
  redrawSign(h);
}

/**
 * The second partition's rectangle: the shape's own span and thickness, at the
 * OTHER end of the room.
 *
 * `twinroom` leaves its way through at +x (the slab runs from −7.5 to +4.3 in
 * a 15 m room). Mirroring the second one puts its gap at −x, so the route
 * through a three-room cabin zig-zags instead of being a corridor you can see
 * the back wall down — which is §3.1 rule 1's own argument about what makes a
 * place rather than a hall, applied inside one room.
 *
 * Returns null, and never a wall that would not stand: `wallFits` is the same
 * gate the wheel is under, so a wall put up by the key can never be somewhere
 * the wheel could not have slid it.
 */
function secondWall(h, z) {
  const b = (h.spot.blockers || [])[0];
  if (!b) return null;
  const W = { i: 1, kit: null, mesh: null, box: null,
    rect: { x: -b.x, z, w: b.w, d: b.d } };
  h.walls.push(W);
  if (wallFits(h, 1, z)) { h.walls.pop(); return null; }
  return W;
}

/**
 * The blocker list the grid reads: the walls, then the shape's other three.
 *
 * THE RECORD IS ONLY WRITTEN WHERE THERE IS A PARTITION TO DESCRIBE, and that
 * is not a nicety. `Coop.reseatMine` re-dresses YOUR OWN home behind a
 * RESIDENCE (`#31`, `#33`, `#38`) when an apartment assignment arrives after
 * the level was built, and no residence's shape declares a partition — see
 * `spotOf`, which hands back an empty `blockers`. Writing `walls: []` there
 * would take a player's third room off their disk because they joined a
 * friend's session, which is the same class of defect `leaveHome` already
 * guards against by taking `store` and `pad` off the fold rather than from
 * memory. A room that cannot show the walls does not get to forget them.
 */
function syncWalls(h) {
  h.blockers = [...h.walls.map((W) => W.rect), ...(h.spot.blockers || []).slice(1)];
  if (h.kitWall) h.state.walls = h.walls.map((W) => W.rect.z);
}

/**
 * Will a partition stand at `z`? Returns a REASON, or null.
 *
 * The furniture's own rule with the mover and the obstacle swapped — see the
 * chapter header for why a wall may not simply delete what is in its way.
 */
function wallFits(h, i, z) {
  const W = h.walls[i];
  if (!W) return 'there is no wall there';
  const half = W.rect.d / 2;
  if (Math.abs(z) + half > h.spot.d / 2 - MIN_ROOM) return `it would leave less than ${MIN_ROOM} m behind it`;
  for (let k = 0; k < h.walls.length; k++) {
    if (k === i) continue;
    if (Math.abs(z - h.walls[k].rect.z) < MIN_ROOM + half + h.walls[k].rect.d / 2) {
      return 'it would meet the other partition';
    }
  }
  /* The three obstacles the shape declared that are not a partition, and then
   * everything the player has put down. Both tested as rectangles against this
   * wall's own footprint, which is what `fits` does one way round. */
  const near = (ox, oz, ow, od) =>
    Math.abs(W.rect.x - ox) < W.rect.w / 2 + ow / 2 && Math.abs(z - oz) < half + od / 2;
  for (const b of (h.spot.blockers || []).slice(1)) {
    if (near(b.x, b.z, b.w, b.d)) return 'through the fittings';
  }
  for (const p of h.state.pieces) {
    const c = BY_ID.get(p.k);
    if (!c || c.flat) continue;
    const [ox, oz] = extentsAt(c, p.r);
    if (near(p.x, p.z, ox * 2, oz * 2)) return `through the ${c.name.toLowerCase()}`;
  }
  return null;
}

/** Which partition the player is standing at, or −1. A fixture, like the panel. */
export function wallAt(world) {
  const h = world && world._home;
  const p = world && world.player && world.player.position;
  if (!h || !p || !h.walls || !h.walls.length) return -1;
  const l = toLocal(h, p.x, p.z);
  let best = -1, bd = WALL_REACH;
  for (let i = 0; i < h.walls.length; i++) {
    const r = h.walls[i].rect;
    /* Perpendicular distance to the LEAF, not to its centre: a partition is
     * twelve metres wide and standing at one end of it is standing at it. */
    if (Math.abs(l.x - r.x) > r.w / 2 + 0.6) continue;
    const d = Math.abs(l.z - r.z) - r.d / 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Slide a partition by `n` notches of the wheel. One notch is one `CELL`, so a
 * wall lands on the same half-metre grid the furniture does.
 */
export function moveWall(world, i, n) {
  const h = world && world._home;
  const W = h && h.walls && h.walls[i];
  if (!W || !n) return null;
  const z = snap(W.rect.z + Math.sign(n) * CELL);
  const why = wallFits(h, i, z);
  if (why) {
    world.notify?.('THE PARTITION', `it will not go there — ${why}`);
    return null;
  }
  W.rect.z = z;
  poseWall(world, h, W);
  syncWalls(h);
  h.dirty = true; h.edits++;
  world.notify?.('THE PARTITION', roomLine(h));
  return z;
}

/**
 * ══ THE THIRD ROOM, PUT UP OR TAKEN DOWN ══════════════════════════════════
 *
 * The key's whole meaning at a partition, and it is the same press at either
 * one — see the chapter header for why the address is what allows it and why
 * nothing is charged for it.
 *
 * WHERE IT GOES is derived and deterministic: the middle of the DEEPER of the
 * two bays, walked outwards a cell at a time until `wallFits` agrees. Outwards
 * from the middle for `freeCell`'s reason — a wall that appeared against the
 * back of the room would read as a mistake — and deterministic because there
 * is no `Math.random` in `src/` and two machines dressing one record in co-op
 * have to build the same cabin.
 */
export function toggleWall(world) {
  const h = world && world._home;
  if (!h || !h.walls || !h.walls.length) return null;
  if (h.walls.length > 1) {
    const W = h.walls.pop();
    if (W.box) { world.physics?.removeStaticBox?.(W.box); W.box = null; }
    if (W.mesh) {
      h.group.remove(W.mesh);
      const at = h.built.indexOf(W.mesh);
      if (at >= 0) h.built.splice(at, 1);
      W.mesh.geometry.dispose();
      h.draws--;
    }
    syncWalls(h);
    redrawSign(h);
    h.dirty = true; h.edits++;
    world.notify?.(h.address, `two rooms again — ${roomLine(h)}`);
    return h.walls.length;
  }
  if (h.walls.length >= MAX_WALLS) return null;
  const first = h.walls[0].rect.z;
  const front = -h.spot.d / 2, back = h.spot.d / 2;
  /* The deeper of the two bays, and its middle. */
  const deepFront = first - front > back - first;
  const mid = snap(deepFront ? (front + first) / 2 : (first + back) / 2);
  let put = null, why = 'there is no room for another wall';
  for (let step = 0; step <= Math.ceil(h.spot.d / CELL); step++) {
    for (const s of step === 0 ? [0] : [-1, 1]) {
      const z = snap(mid + s * step * CELL);
      const W = secondWall(h, z);
      if (!W) { why = 'there is no room for another wall'; continue; }
      put = W;
      break;
    }
    if (put) break;
  }
  if (!put) { world.notify?.('THE PARTITION', why); return null; }
  put.mesh = buildWallMesh(h, put);
  poseWall(world, h, put);
  syncWalls(h);
  h.dirty = true; h.edits++;
  /* THE ADDRESS IS WHAT PAID FOR IT, so the address is what says so — and the
   * door says so too, which is the visible half of the argument in the header. */
  redrawSign(h);
  world.notify?.(h.address, `three rooms — ${roomLine(h)}`);
  return h.walls.length;
}

/** The bays, front to back, as a sentence. What a notify says. */
function roomLine(h) {
  const edges = [-h.spot.d / 2, ...h.walls.map((W) => W.rect.z).sort((a, b) => a - b), h.spot.d / 2];
  const bays = [];
  for (let i = 1; i < edges.length; i++) bays.push((edges[i] - edges[i - 1]).toFixed(1));
  return `${bays.join(' m / ')} m`;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE MIRROR, AND IT IS A REFLECTION NOW — V15 §1.3
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §1.3: *"a real mirror in the cabin, and standing at it opens the character
 * creator with your own body in the glass rather than on a menu stage."*
 *
 * ── WHAT WAS HERE, AND WHY IT WAS A LIE ───────────────────────────────────
 *
 * Dark glass in a frame, a press that opened the menu's saber tab scrolled to
 * the face list, and a notification reading *"THE MIRROR — your own body in
 * the glass"*. The glass reflected nothing. The sentence on screen described a
 * feature the code did not have, which is worse than the feature being absent:
 * a player who reads it looks for the body and concludes the game is broken.
 *
 * ── WHAT IT COSTS, MEASURED BEFORE IT WAS WRITTEN ─────────────────────────
 *
 * A reflection is a second rasterisation, and the question is of WHAT.
 * `DeckMirror.js` reflects the whole hangar and pays +123..+149 draw calls,
 * 11-13% of the frame's. A mirror hanging on a cabin wall does not need the
 * station: it needs the room it is in and the person standing in it. Counted
 * on a live deck-44 world:
 *
 *   the whole station scene   1334 draws   493 449 triangles
 *   #27's own group             18 draws     4 030 triangles
 *   the player's rig            62 draws    12 920 triangles
 *   ───────────────────────────────────────────────────────
 *   what the glass renders      80 draws    16 950 triangles
 *                               +6.0%       +3.4%
 *
 * …and only while the camera is inside `GLASS.reach` of the glass and on the
 * room side of it. Everywhere else in the game this is one distance test in a
 * hook that returns. That is the whole reason the mask below exists: without
 * it a cabin mirror would cost what the deck's does, for a picture of a room
 * six metres across.
 *
 * ── WHAT IS STILL NOT TRUE, SAID HERE RATHER THAN ON SCREEN ───────────────
 *
 * *"with your own body in the glass rather than on a menu stage"* is TWO
 * claims, and this delivers one of them. The body in the glass is the real
 * one — your species, your robe, your hair, your blade, moving as you move.
 * The creator's controls do NOT drive it: they drive `Menu.js`'s own preview
 * figure, and the change reaches your body on your next deploy exactly as it
 * did before. Making them drive the live body needs a re-dress path that does
 * not exist — `dressPreviewFigure` ATTACHES cloth to a figure that has none,
 * so calling it on a dressed player hangs a second cape on the first, and
 * species and build change the skeleton, which is a rebuild and not a
 * re-dress. Both live in `src/ui/Menu.js` and `src/game/Player.js`.
 *
 * So the room is honest about which half it has: the notification says the
 * glass is real and says where the creator's controls land. Nothing on screen
 * claims the other half until the other half exists.
 */

/** Every number the cabin's glass runs on. */
export const GLASS = {
  /**
   * How near the camera has to be for the reflection to be rendered at all,
   * in metres. `MIRROR_REACH` (2.4) is how near the PLAYER must be to press
   * the key; this is bigger because in third person the camera sits a couple
   * of metres behind the player's head and the glass has to be live before
   * you have finished walking up to it.
   */
  reach: 7.0,
  /**
   * The render target's size as a fraction of the drawing buffer, per tier.
   * 0 is "no reflection": the glass keeps its dark material and nothing is
   * rendered, which is the tier the menu offers to integrated graphics.
   * Smaller than `DeckMirror`'s at every tier because the glass is 0.94 m of
   * a room and never fills the frame the way a deck floor does.
   */
  scale: { low: 0, medium: 0.34, high: 0.5, ultra: 0.5 },
  /** How much of the reflected image comes back. Glass is not a front mirror. */
  strength: 0.86,
  /** What the glass is when the reflection is off, and what it tints toward. */
  tint: [0.052, 0.058, 0.070],
};

/** The target's size as a fraction of the frame for a tier name. */
export function glassScale(tier) {
  const s = GLASS.scale[tier];
  return Number.isFinite(s) ? s : GLASS.scale.medium;
}

const GLASS_VERT = /* glsl */`
  uniform mat4 uTexMat;
  varying vec4 vProj;
  void main() {
    /* uTexMat carries the mesh's own matrixWorld, folded in on the CPU each
     * frame exactly as three's Reflector does, so this maps OBJECT space. */
    vProj = uTexMat * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const GLASS_FRAG = /* glsl */`
  uniform sampler2D tGlass;
  uniform vec3 uTint;
  uniform float uOn;
  varying vec4 vProj;
  void main() {
    /* Behind the plane, or off: the glass is what an unlit mirror is. */
    vec3 c = uTint;
    if (uOn > 0.0 && vProj.w > 0.0) {
      vec2 uv = vProj.xy / vProj.w;
      vec3 r = texture2D(tGlass, clamp(uv, 0.0, 1.0)).rgb;
      c = mix(uTint, r, ${GLASS.strength.toFixed(3)} * uOn);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

/* Scratch, so the per-frame hook allocates nothing. */
const _gN = new THREE.Vector3();
const _gP = new THREE.Vector3();
const _gCam = new THREE.Vector3();
const _gView = new THREE.Vector3();
const _gLook = new THREE.Vector3();
const _gTarget = new THREE.Vector3();
const _gRot = new THREE.Matrix4();
const _gPlane = new THREE.Plane();
const _gClip = new THREE.Vector4();
const _gQ = new THREE.Vector4();
const _gSize = new THREE.Vector2();

/**
 * The tier the world is running at — `DeckMirror.tierOf`'s argument, and the
 * same order: the ENGINE's tier first, because `world.settings` is a copy
 * taken when the world was built and never sees an options screen.
 */
function glassTier(world) {
  return world?.engine?.quality ?? world?.settings?.quality ?? 'high';
}

/**
 * ══ POINT THE VIRTUAL CAMERA — three's `Reflector`, generalised ═══════════
 *
 * `DeckMirror.mirrorCamera` is the y-plane special case of this: it flips y
 * and calls `lookAt`. A wall mirror's plane is vertical and its normal is the
 * room's own yaw, so the reflection has to be about an ARBITRARY plane —
 * which is `Vector3.reflect` plus the same `lookAt`, and `lookAt` is what
 * keeps the basis right-handed so no triangle winding flips and no material
 * has to switch its `side`.
 *
 * The near plane is then replaced by the mirror's own plane (Lengyel's
 * oblique depth projection, transcribed from `DeckMirror` because it is the
 * same six lines): the wall the glass is screwed to sits between the virtual
 * camera and the room, and without the clip it fills the reflection.
 */
function aimGlassCamera(S, camera) {
  const V = S.camera;
  _gN.copy(S.normal);
  _gP.copy(S.plane);
  _gCam.setFromMatrixPosition(camera.matrixWorld);

  _gView.subVectors(_gP, _gCam);
  /* Facing away: the camera is behind the glass, which happens the moment you
   * walk through the wall in a free camera. Nothing to reflect. */
  if (_gView.dot(_gN) > 0) return false;
  _gView.reflect(_gN).negate().add(_gP);

  _gRot.extractRotation(camera.matrixWorld);
  _gLook.set(0, 0, -1).applyMatrix4(_gRot).add(_gCam);
  _gTarget.subVectors(_gP, _gLook).reflect(_gN).negate().add(_gP);

  V.position.copy(_gView);
  V.up.set(0, 1, 0).applyMatrix4(_gRot).reflect(_gN);
  V.lookAt(_gTarget);
  V.near = camera.near; V.far = camera.far;
  V.fov = camera.fov; V.aspect = camera.aspect; V.zoom = camera.zoom;
  V.updateMatrixWorld(true);
  V.projectionMatrix.copy(camera.projectionMatrix);

  /* World → clip → [0,1], through the projection BEFORE the oblique rewrite:
   * that rewrite touches the z row only, and the uv never reads z. */
  S.texMat.set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0,
  );
  S.texMat.multiply(V.projectionMatrix);
  S.texMat.multiply(V.matrixWorldInverse);
  S.texMat.multiply(S.mesh.matrixWorld);

  _gPlane.setFromNormalAndCoplanarPoint(_gN, _gP);
  _gPlane.applyMatrix4(V.matrixWorldInverse);
  _gClip.set(_gPlane.normal.x, _gPlane.normal.y, _gPlane.normal.z, _gPlane.constant);
  const P = V.projectionMatrix.elements;
  _gQ.x = (Math.sign(_gClip.x) + P[8]) / P[0];
  _gQ.y = (Math.sign(_gClip.y) + P[9]) / P[5];
  _gQ.z = -1.0;
  _gQ.w = (1.0 + P[10]) / P[14];
  _gClip.multiplyScalar(2.0 / _gClip.dot(_gQ));
  P[2] = _gClip.x;
  P[6] = _gClip.y;
  P[10] = _gClip.z + 1.0;
  P[14] = _gClip.w;
  V.projectionMatrixInverse.copy(V.projectionMatrix).invert();
  return true;
}

/**
 * ══ WHAT IS IN THE REFLECTION, AND IT IS NOT THE STATION ══════════════════
 *
 * The room and the person in it, and everything else switched off for the
 * length of one render. That is the whole cost argument at the top of this
 * chapter: reflecting the scene would be 1334 draws for a picture of a cabin.
 *
 * `station-place-27` IS A DIRECT CHILD OF THE SCENE — measured, 185 of them,
 * one group per place plus the lights and the loose props — so the mask is one
 * pass over `scene.children` and never a `traverse`. Lights stay (a hidden
 * light is a dark reflection), the cabin's own group stays, and the player's
 * body stays: the rig root, and the two cloth meshes, which are scene children
 * of their own at the ORIGIN with world-space vertices, so no distance test
 * could ever have found them.
 *
 * Objects are hidden and not removed, for the reason `DeckMirror` gives: the
 * scene graph must not change shape in the middle of a frame.
 */
function maskForGlass(S, world, h, scene) {
  const hidden = S.hidden;
  hidden.length = 0;
  const keep = S.keep;
  keep.clear();
  keep.add(h.group);
  const P = world?.player;
  if (P?.rig?.root) keep.add(P.rig.root);
  for (const c of [P?.cloak, P?.skirt, P?.waistCape, P?.hoodDrape]) {
    if (c?.mesh) keep.add(c.mesh);
  }
  for (const o of scene.children) {
    if (!o.visible || o.isLight || keep.has(o)) continue;
    o.visible = false;
    hidden.push(o);
  }
  /* The glass cannot be in its own reflection. */
  S.mesh.visible = false;
}

function unmaskAfterGlass(S) {
  for (const o of S.hidden) o.visible = true;
  S.hidden.length = 0;
  S.keep.clear();
  S.mesh.visible = true;
}

/**
 * The render hook. Runs inside the beauty pass, once a stepped frame, when the
 * glass is about to be drawn by the engine's own camera.
 *
 * ONE RENDER PER STEPPED FRAME, AND THE CLOCK IS `world.time`. `DeckMirror`
 * has a director to arm it; this room has none, and a per-frame `step` export
 * would be a line in `Station.js`, which this lane does not own. `world.time`
 * advances once per `world.update`, so a second pass over the same frame — the
 * ink prepass, a probe, a shadow camera — reads the same number and is
 * refused. It is the same guard by another clock.
 */
function renderGlass(world, h, S, renderer, scene, camera) {
  const u = S.material.uniforms;
  if (S.disposed || S.rendering || !(S.scale > 0)) { u.uOn.value = 0; return; }
  const main = world?.engine?.camera;
  if (main && camera !== main) { S.skipped++; return; }
  if (typeof renderer?.getDrawingBufferSize !== 'function' || typeof renderer.render !== 'function') return;
  const t = world?.time ?? 0;
  if (t === S.at) { S.skipped++; return; }
  S.at = t;
  /* THE DISTANCE GATE, and it is the whole of the cost argument. */
  _gCam.setFromMatrixPosition(camera.matrixWorld);
  if (_gCam.distanceTo(S.plane) > GLASS.reach) { u.uOn.value = 0; S.skipped++; return; }
  if (!aimGlassCamera(S, camera)) { u.uOn.value = 0; S.skipped++; return; }

  renderer.getDrawingBufferSize(_gSize);
  const w = Math.max(2, Math.round(_gSize.x * S.scale));
  const hh = Math.max(2, Math.round(_gSize.y * S.scale));
  if (S.target.width !== w || S.target.height !== hh) S.target.setSize(w, hh);
  maskForGlass(S, world, h, scene);

  S.rendering = true;
  const prevTarget = renderer.getRenderTarget();
  const xr = renderer.xr;
  const prevXr = xr ? xr.enabled : false;
  const sm = renderer.shadowMap;
  const prevAuto = sm ? sm.autoUpdate : false;
  const prevNeeds = sm ? sm.needsUpdate : false;
  if (xr) xr.enabled = false;
  /* The cascades are already fresh and are rendered from the LIGHT's camera,
   * so a second set would come back byte-identical — `frame-budget.mjs` §1's
   * finding, and the reason this does what the deck's mirror does. */
  if (sm) { sm.autoUpdate = false; sm.needsUpdate = false; }
  renderer.setRenderTarget(S.target);
  renderer.state?.buffers?.depth?.setMask?.(true);
  if (renderer.autoClear === false) renderer.clear();
  try {
    renderer.render(scene, S.camera);
  } catch { /* a reflection is never worth a frame */ } finally {
    if (xr) xr.enabled = prevXr;
    if (sm) { sm.autoUpdate = prevAuto; sm.needsUpdate = prevNeeds; }
    renderer.setRenderTarget(prevTarget);
    const vp = camera.viewport;
    if (vp !== undefined) renderer.state?.viewport?.(vp);
    unmaskAfterGlass(S);
    S.rendering = false;
  }
  u.uTexMat.value.copy(S.texMat);
  u.uOn.value = 1;
  S.renders++;
}

/**
 * Give the glass its reflection: a target, a virtual camera and the material
 * that samples one. YOURS ONLY — a guest's apartment keeps the flat glass,
 * because four render targets and four second passes for four rooms, three of
 * which you are not standing in, is the cost this chapter exists to refuse.
 *
 * Returns the state, or null when the tier has the reflection switched off, in
 * which case the mesh keeps `stationMats.glass` and nothing is allocated.
 */
function glassMirror(world, h, gm, lx, lz) {
  const scale = glassScale(glassTier(world));
  if (!(scale > 0)) return null;
  const target = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType, generateMipmaps: false,
    colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false,
  });
  target.texture.name = 'home-mirror';
  const material = new THREE.ShaderMaterial({
    name: 'home-mirror',
    uniforms: {
      uTexMat: { value: new THREE.Matrix4() },
      tGlass: { value: target.texture },
      uTint: { value: new THREE.Vector3(...GLASS.tint) },
      uOn: { value: 0 },
    },
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    /* Opaque: the glass is the picture, not light added over one. A mirror
     * standing against a wall has nothing behind it to blend with. */
    transparent: false, depthWrite: true, depthTest: true,
    side: THREE.FrontSide, fog: false, lights: false,
  });
  /* The ink prepass rasterises silhouettes; the frame around the glass already
   * draws this one, and a prepass through a cloned camera is exactly the
   * second pass the `world.time` guard above refuses. */
  material.userData.saberNoInk = true;
  gm.material = material;
  gm.updateMatrixWorld(true);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 900);
  camera.name = 'home-mirror-camera';
  const S = {
    mesh: gm, material, target, camera, scale,
    texMat: new THREE.Matrix4(),
    /* The plane: a point on the glass and the normal pointing into the room.
     * The glass slab is offset 0.09 m along the room's own +x inside its mesh,
     * and the room's +x is the world direction `toWorld` turns it into. */
    normal: new THREE.Vector3(Math.cos(h.spot.yaw), 0, -Math.sin(h.spot.yaw)).normalize(),
    /** A point on the glass: the plane's anchor AND the distance gate's mark. */
    plane: toWorld(h, lx + 0.09, lz).clone().setY(h.y + 1.15),
    /** `world.time` of the last render — the one-per-frame clock. */
    at: -1,
    rendering: false, disposed: false,
    renders: 0, skipped: 0,
    keep: new Set(), hidden: [],
  };
  return S;
}

function dressMirror(world, h) {
  const { w, d } = h.spot;
  /* On the left-hand wall of the outer room, facing the desk. */
  const lx = -w / 2 + 0.16, lz = -d / 2 + 3.2;
  const frame = slabGeo(0.12, 2.1, 1.1, { bevel: 0.02 }); frame.translate(0, 1.15, 0);
  const glass = slabGeo(0.04, 1.9, 0.94, { bevel: 0 }); glass.translate(0.09, 1.15, 0);
  const fm = new THREE.Mesh(frame, h.M.wing);
  const gm = new THREE.Mesh(glass, h.M.glass);
  fm.name = 'home-mirror-frame'; gm.name = 'home-mirror-glass';
  for (const m of [fm, gm]) {
    m.position.copy(toWorld(h, lx, lz));
    m.quaternion.setFromAxisAngle(UP, h.spot.yaw);
    h.group.add(m);
    h.built.push(m);
    h.draws++;
  }
  h.mirror = { lx, lz, at: toWorld(h, lx, lz).clone(), mesh: fm, glass: gm, S: null };
  if (h.mine) {
    const S = glassMirror(world, h, gm, lx, lz);
    if (S) {
      gm.onBeforeRender = (renderer, scene, cam) => renderGlass(world, h, S, renderer, scene, cam);
      h.mirror.S = S;
    }
  }
}

/** The reflection's own allocations, given back. `undressOne` calls it. */
function undressMirror(h) {
  const S = h?.mirror?.S;
  if (!S) return;
  S.disposed = true;
  S.mesh.onBeforeRender = () => {};
  S.material.uniforms.tGlass.value = null;
  S.material.dispose();
  S.target.dispose();
  S.keep.clear();
  S.hidden.length = 0;
  h.mirror.S = null;
}

/**
 * ══ THE GALLEY — V16 §B5's *"store it in your apartment"* ═════════════════
 *
 * A cold store against the far wall, and it is a FIXTURE rather than a piece
 * off the catalogue for the mirror's reason exactly: you have to be able to
 * find it. A larder you could pick up, rotate and drop in a corner is a larder
 * a player can lose, and losing the cupboard is a different game to the one
 * that was asked for.
 *
 * TWO SLABS AND A DOOR SEAM. Same shape as the mirror, same cost — the room's
 * whole argument is that it is a place and not a menu, and a place has a
 * kitchen in it whether or not anything is in the kitchen today.
 */
const GALLEY_REACH = 2.4;

function dressGalley(world, h) {
  const { w, d } = h.spot;
  const lx = w / 2 - 0.36, lz = -d / 2 + 1.4;
  const body = slabGeo(0.62, 1.9, 1.3, { bevel: 0.03 }); body.translate(0, 0.95, 0);
  const seam = slabGeo(0.04, 1.7, 0.06, { bevel: 0 }); seam.translate(-0.31, 0.95, 0);
  const bm = new THREE.Mesh(body, h.M.wing);
  const sm = new THREE.Mesh(seam, h.M.glass);
  bm.name = 'home-galley'; sm.name = 'home-galley-seam';
  for (const m of [bm, sm]) {
    m.position.copy(toWorld(h, lx, lz));
    m.quaternion.setFromAxisAngle(UP, h.spot.yaw);
    h.group.add(m);
    h.built.push(m);
    h.draws++;
  }
  h.galley = { lx, lz, at: toWorld(h, lx, lz).clone(), mesh: bm };
}

/**
 * ══ THE SWATCH PANEL — V15 §1.3.2's *"wall, floor, trim and light colour"* ══
 *
 * ── A VERB WITH NO KEY IS NOT A VERB, AND THAT IS WHAT THIS WAS ───────────
 *
 * `cycleSurface` has existed since the home landed, under a note calling it
 * "what a fixture's verb does" — and there was no fixture and no verb.
 * `grep -rn "cycleSurface" src/` found ZERO callers. A hostile pass drove it
 * the way a player would, twelve wheel notches and twelve presses inside a
 * real cabin, and read the wall back: `hull` before, `hull` after. The suite
 * was green because `home.mjs` calls `setSurface(world, slot, key)` directly —
 * a check reading a function the player has no key for, which is exactly the
 * dead control this tree keeps deleting.
 *
 * ── THE GRAMMAR IS THE ONE THE ROOM ALREADY SPEAKS ────────────────────────
 *
 * Standing at the panel, THE KEY STEPS THE SLOT and THE WHEEL STEPS THE
 * COLOUR — floor, then wall, then trim, and the wheel runs that row. That is
 * `homeWheel`'s own sentence one screen down ("the wheel says WHAT and the key
 * says WHERE") turned ninety degrees, and it means the room needs no second
 * interface to paint itself: §14's "the station adds no interface" holds.
 *
 * A FIXTURE AND NOT A PIECE, for the galley's reason: a swatch panel you could
 * pick up, rotate and drop behind the bunk is a control a player can lose.
 */
const PANEL_REACH = 2.4;

function dressPanel(world, h) {
  const { w, d } = h.spot;
  const lx = -w / 2 + 0.22, lz = -d / 2 + 1.1;
  const plate = slabGeo(0.10, 1.0, 0.72, { bevel: 0.02 }); plate.translate(0, 1.35, 0);
  const pm = new THREE.Mesh(plate, h.M.wing);
  pm.name = 'home-swatch';
  pm.position.copy(toWorld(h, lx, lz));
  pm.quaternion.setFromAxisAngle(UP, h.spot.yaw);
  h.group.add(pm);
  /**
   * REMEMBERED, LIKE EVERY OTHER FIXTURE. This and its three chips were the
   * only things this file put in the room's group without pushing onto
   * `h.built`, so `undressOne` left four meshes standing in a group it had
   * otherwise emptied — and `Coop.reseatMine` undresses and re-dresses YOUR
   * OWN home when an apartment assignment arrives late, so they accumulated
   * four at a time. It surfaced through V15 §1.3.3: `takeKitPartition` reads
   * the room's own meshes out of the group and requires exactly one to carry
   * the partition's rectangle, and an orphaned swatch plate sits inside that
   * rectangle when its local geometry is read as room coordinates.
   */
  h.built.push(pm);
  h.draws++;
  /* THREE CHIPS, ONE PER SLOT, and they are the live materials — so the panel
   * is the room's own answer to what colour it is rather than a picture of
   * one. `repaintPanel` swaps them when a slot changes. */
  const chips = [];
  for (let i = 0; i < SURFACE_SLOTS.length; i++) {
    const g = slabGeo(0.04, 0.2, 0.56, { bevel: 0 });
    g.translate(0, 1.68 - i * 0.3, 0);
    const cm = new THREE.Mesh(g, h.M[h.state.surfaces[SURFACE_SLOTS[i]]] || h.M.hull);
    cm.name = `home-swatch-${SURFACE_SLOTS[i]}`;
    cm.position.copy(toWorld(h, lx + 0.06, lz));
    cm.quaternion.setFromAxisAngle(UP, h.spot.yaw);
    h.group.add(cm);
    h.built.push(cm);
    h.draws++;
    chips.push(cm);
  }
  h.panel = { lx, lz, at: toWorld(h, lx, lz).clone(), mesh: pm, chips, slot: 0 };
}

/** The chips say what the room says. Called on every surface change. */
function repaintPanel(h) {
  const P = h?.panel;
  if (!P) return;
  for (let i = 0; i < SURFACE_SLOTS.length; i++) {
    const m = h.M[h.state.surfaces[SURFACE_SLOTS[i]]];
    if (m && P.chips[i]) P.chips[i].material = m;
  }
}

/** Is the player standing at the swatch panel? */
export function atPanel(world) {
  const h = world?._home;
  const p = world?.player?.position;
  return !!(h?.panel && p && p.distanceTo(h.panel.at) < PANEL_REACH);
}

/**
 * ══ THE PERCH, PUT UP — AND SOMETHING STANDING ON IT ══════════════════════
 *
 * A FIXTURE, for the galley's reason and the mirror's: you have to be able to
 * find it. It is also the one fixture whose PRESENCE is a choice, so unlike
 * the other four this builder can decide to build nothing at all — a cabin
 * whose record says `pad: null` has a bare wall there, which is what "you have
 * not chosen one yet" looks like.
 *
 * ── WHERE IT STANDS ───────────────────────────────────────────────────────
 *
 * Against the right-hand wall of the outer room, between the galley (`-d/2 +
 * 1.4`) and the partition, opposite the mirror. It is not a blocker for the
 * same reason the galley and the swatch panel are not: everything against a
 * wall sits in the half metre the grid already keeps clear of it.
 *
 * ── AND THE ANIMAL IS THE LOCAL KENNEL'S, ALWAYS ──────────────────────────
 *
 * `homeCompanion` says why: a friend's apartment gets their FIXTURE and never
 * their animal, because `loadKennel` reads this machine's roll and there is no
 * second one. It is also gated on `mine` here, which is the same fence every
 * placement verb in this file stands behind.
 */
const PAD_FIXTURES = {
  /** Two posts and a bar, with a tray under it for what a bird drops. */
  perch() {
    const wing = [], strip = [], dark = [];
    for (const sx of [-1, 1]) {
      const post = cylGeo(0.03, 0.045, 1.02, 6, 1);
      post.translate(sx * 0.32, 0.51, 0);
      wing.push(post);
    }
    const bar = cylGeo(0.035, 0.035, 0.70, 8, 1);
    bar.rotateZ(Math.PI / 2); bar.translate(0, 1.02, 0);
    strip.push(bar);
    const tray = slabGeo(0.80, 0.05, 0.34, { bevel: 0.02 });
    tray.translate(0, 0.05, 0);
    dark.push(tray);
    return { wing, strip, dark };
  },
  /** A low tub with a straw pad in it. Eight sides, because a basket is round. */
  basket() {
    const deep = [], mark = [];
    const tub = cylGeo(0.44, 0.34, 0.30, 10, 1);
    tub.translate(0, 0.15, 0);
    deep.push(tub);
    const straw = cylGeo(0.40, 0.40, 0.06, 10, 1);
    straw.translate(0, 0.27, 0);
    mark.push(straw);
    return { deep, mark };
  },
  /** A docking plate and the post that feeds it. */
  charge() {
    const wing = [], strip = [];
    const plate = slabGeo(0.90, 0.07, 0.90, { bevel: 0.03 });
    plate.translate(0, 0.035, 0);
    wing.push(plate);
    const post = slabGeo(0.14, 1.25, 0.14, { bevel: 0.02 });
    post.translate(0, 0.62, -0.38);
    wing.push(post);
    const lamp = slabGeo(0.06, 0.42, 0.06, { bevel: 0 });
    lamp.translate(0.05, 0.95, -0.38);
    strip.push(lamp);
    return { wing, strip };
  },
};

function dressPad(world, h) {
  const P = padKind(h.state.pad);
  h.pad = null;
  if (!P) return null;
  const { w, d } = h.spot;
  const lx = w / 2 - 0.5, lz = -d / 2 + 3.9;
  const at = toWorld(h, lx, lz).clone();
  const meshes = [];
  for (const [key, geos] of Object.entries(PAD_FIXTURES[P.id]())) {
    const geo = mergeGeos(geos);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, h.M[key] || h.M.hull);
    m.name = `home-pad-${P.id}-${key}`;
    m.position.copy(at);
    m.quaternion.setFromAxisAngle(UP, h.spot.yaw);
    h.group.add(m);
    h.built.push(m);
    h.draws++;
    meshes.push(m);
  }
  h.pad = { id: P.id, lx, lz, at, rest: P.rest, meshes, body: null, root: null };
  seatCompanion(world, h);
  return h.pad;
}

/**
 * ══ WHAT "USING IT" MEANS, AND WHY IT IS A STILL BODY ═════════════════════
 *
 * The animal is built by the archetype's OWN builder with the same three
 * option bags `CompanionDeck.callTheCompanion` uses — size, colours and growth
 * — so the thing asleep on your basket is the thing you deploy with, which is
 * the one fact two representations of one animal may never disagree about.
 *
 * IT IS NOT STEPPED. There is no gait, no brain and no per-frame hook: it is
 * placed once at dress time and stands there. That is a decision and not an
 * omission — a walking companion on the station is a lane of its own
 * (`Companions.js`, whose heel, leash and orders all assume a field), and the
 * sentence being kept here is *"a cabin gets a perch … for one small
 * companion"*, which is about the cabin. What it costs is one build and, on
 * the smallest of the three, 24 draws inside a room that is culled with its
 * own door.
 *
 * THE FEET ARE PUT ON THE FIXTURE BY MEASUREMENT. The rig's root is the
 * pelvis on both body paths, so "how far the lowest point of this animal is
 * below its own origin" is a number that has to be read off the built body —
 * a constant per kind would be four numbers that go wrong the first time a
 * companion grows, and growth is exactly what `bodyScaleOf` is for.
 */
function seatCompanion(world, h) {
  if (!h?.pad || !h.mine) return null;
  const rec = homeCompanion();
  if (!rec) return null;
  const K = COMPANION_KINDS[rec.kind];
  const A = COMPANION_UNITS[K?.archetype];
  if (!A?.build) return null;
  let built = null;
  try {
    built = A.build({
      scale: bodyScaleOf(rec.kind, rec),
      ...companionOptsFrom(rec.look),
      ...growthOptsFrom(rec.kind, rec),
    });
  } catch { return null; }
  const root = built?.rig?.root || built?.group;
  if (!root) return null;
  foldForRest(built, padSuit(rec.kind));
  /* Measured at the origin, before it is moved: `setFromObject` reads world
   * matrices, so a body already carried up to the fixture would measure its
   * own new height and lift itself again. */
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const drop = Number.isFinite(box.min.y) ? -box.min.y : 0;
  root.position.copy(h.pad.at);
  root.position.y = h.y + h.pad.rest + drop;
  /* Facing off the wall and into the room: the fixture is on the +x wall, so
   * the animal looks down −x. A body's forward is +z, and a Y rotation takes
   * +z to (sin, cos) — which is local −x at the room's own yaw less a right
   * angle. */
  root.quaternion.setFromAxisAngle(UP, h.spot.yaw - Math.PI / 2);
  root.updateMatrixWorld(true);
  h.group.add(root);
  h.pad.body = { rec, built, drop };
  h.pad.root = root;
  let draws = 0;
  root.traverse((o) => { if (o.isMesh) draws++; });
  h.draws += draws;
  return h.pad.body;
}

/**
 * A FLIER AT REST HAS ITS WINGS IN. `creatureSkeleton` builds `wing{L,R}` and
 * `wingTip{L,R}` off the body with a `rest` euler that holds them OUT — which
 * is right for the only place a hawk has ever been, which is the air. On a bar
 * in a cabin it is a bird with a 1.8 m span standing in a 15 m room.
 *
 * So the two bones a side are turned in toward the flank. It is the rest euler
 * and nothing else: no solver, no beat, no `Flight` state — the wings are
 * PARENTS of their own meshes on this rig, so a rotation is the fold.
 */
/**
 * SEARCHED RATHER THAN AUTHORED. A grid over the two bones' local eulers,
 * measuring the built hawk's bounding box at each: unfolded it is
 * **1.83 m across, 0.61 m tall, 1.39 m long**; at these two numbers it is
 * **0.59 m across, 0.61 m tall, 1.48 m long**, with the lowest point of the
 * body unchanged at −0.24 m under the pelvis — so the span comes in by 68%,
 * the wings go BACK over the tail rather than down through the perch, and the
 * feet are still the part that touches the bar.
 */
const WING_FOLD = { arm: [-0.85, 0, 0], fan: [0.25, 0, 0] };
const _fold = new THREE.Quaternion();
const _euler = new THREE.Euler();

function foldForRest(built, suit) {
  if (suit !== 'flier') return 0;
  const rig = built?.rig;
  if (!rig?.bones) return 0;
  let folded = 0;
  for (const L of ['L', 'R']) {
    const side = L === 'L' ? 1 : -1;
    for (const [name, rot] of [[`wing${L}`, WING_FOLD.arm], [`wingTip${L}`, WING_FOLD.fan]]) {
      const b = rig.bones.get ? rig.bones.get(name) : rig.bones[name];
      if (!b?.obj) continue;
      /* ON THE RIGHT OF THE REST QUATERNION, which is what makes one pair of
       * numbers do both sides: a right multiply is a rotation in the BONE's
       * own frame, and the two wings' rest frames are already mirrored by
       * `creatureSkeleton`. Multiplying on the left would be a rotation in the
       * body's frame and would fold one wing in and the other out. */
      _euler.set(rot[0], rot[1] * side, rot[2] * side);
      _fold.setFromEuler(_euler);
      b.obj.quaternion.copy(b.restQuat).multiply(_fold);
      /* AND THE POSE THE ANIMATOR WOULD BLEND TOWARD, for the day something
       * does step this body: `Rig` seeds `pose` from the rest quaternions, so
       * a fold written only onto `obj` would be undone by the first solve. */
      rig.pose?.[name]?.copy(b.obj.quaternion);
      folded++;
    }
  }
  return folded;
}

/** The fixture and whatever was standing on it, taken down. */
function undressPad(h) {
  const P = h?.pad;
  if (!P) return;
  for (const m of P.meshes || []) {
    const i = h.built.indexOf(m);
    if (i >= 0) h.built.splice(i, 1);
    h.group.remove(m);
    m.geometry?.dispose?.();
  }
  if (P.root) {
    h.group.remove(P.root);
    /* GEOMETRY ONLY, WHICH IS THIS FILE'S OWN RULE ONE SCREEN DOWN: the
     * geometry was machined for this body and the materials came out of the
     * body foundry's own cache, shared with every other copy of the animal.
     * Disposing one of those would take the hide off the companion standing on
     * the hangar deck. */
    P.root.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  h.pad = null;
}

/**
 * The address, on the door. §1.3.4's *"what makes a home a place rather than a
 * menu"*, and the one panel in the room a passer-by reads rather than you.
 */
function dressSign(world, h) {
  const { d } = h.spot;
  /* AND WHOSE IT IS, WHEN IT IS NOT YOURS. V16 Lane F is *"you should be able
   * to visit your friend's apartment"*, and a visit needs a door you can tell
   * from the twelve beside it — which is the argument §1.3.4 already makes for
   * having an address at all, one player further on. */
  const panel = signPanel(signRows(h), {
    name: `home${h.place.id}`, w: 1.4, h: 0.5,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.62), panel.material);
  mesh.name = 'home-address';
  /* Outside the door, at head height, facing the corridor. */
  mesh.position.copy(toWorld(h, 2.1, -d / 2 - 0.25));
  mesh.position.y += 2.35;
  mesh.rotation.y = h.spot.yaw + Math.PI;
  h.group.add(mesh);
  h.built.push(mesh);
  h.draws++;
  h.sign = panel;
}

/**
 * ══ WHAT THE DOOR SAYS ════════════════════════════════════════════════════
 *
 * The address, and then who lives here — and for your own, HOW MANY ROOMS.
 * That last word is the visible half of §1.3.3's *"the address is what pays
 * for it"*: the thing the third room is charged against is the address, so the
 * address is where it shows. A friend's door keeps saying whose it is, because
 * at somebody else's front door the question a visitor has is not how many
 * rooms are behind it.
 */
const ROOMS = ['NO ROOMS', 'ONE ROOM', 'TWO ROOMS', 'THREE ROOMS'];

function signRows(h) {
  if (h.owner) return [h.address, `${String(h.owner.name || 'RESIDENT').toUpperCase()}'S CABIN`];
  const n = (h.walls ? h.walls.length : 0) + 1;
  return [h.address, `${ROOMS[Math.min(n, 3)]} · PRIVATE RESIDENCE`];
}

/** The door, told the count changed. `signPanel.draw` early-outs on same text. */
function redrawSign(h) { h.sign?.draw?.(signRows(h)); }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PIECES                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/** One row of the record, made into the real body §1.3.1 insists on. */
function spawnPiece(world, h, row) {
  const c = BY_ID.get(row.k);
  if (!c) return null;
  const mesh = new THREE.Mesh(pieceGeo(c), h.M[c.mat]);
  mesh.name = `home-${c.id}`;
  const prop = new Prop(world, {
    mesh,
    position: toWorld(h, row.x, row.z).clone(),
    quaternion: new THREE.Quaternion().setFromAxisAngle(UP, h.spot.yaw + notchAngle(row.r)),
    mass: c.mass, kind: c.id, hp: 26, weather: false,
  });
  prop._home = { k: c.id, r: row.r };
  h.props.push(prop);
  return prop;
}

function notchAngle(r) { return (r & (NOTCHES - 1)) * (Math.PI * 2 / NOTCHES); }

/**
 * Will this piece stand here?
 *
 * Inside the walls, clear of the partition, and clear of everything already
 * down — except a rug, which is a piece you put furniture ON and is the one
 * exemption. Returns a REASON rather than a boolean, because the prompt the
 * player gets is the difference between a rule and a control that ignores you.
 */
export function fits(h, c, lx, lz, r, ignore = null) {
  const [ex, ez] = extentsAt(c, r);
  if (Math.abs(lx) + ex > h.hx || Math.abs(lz) + ez > h.hz) return 'outside the cabin';
  for (const b of h.blockers) {
    if (Math.abs(lx - b.x) < ex + b.w / 2 && Math.abs(lz - b.z) < ez + b.d / 2) return 'in the partition';
  }
  if (c.flat) return null;
  for (const p of h.state.pieces) {
    if (p === ignore) continue;
    const o = BY_ID.get(p.k);
    if (!o || o.flat) continue;
    const [ox, oz] = extentsAt(o, p.r);
    if (Math.abs(lx - p.x) < ex + ox && Math.abs(lz - p.z) < ez + oz) return `where the ${o.name.toLowerCase()} is`;
  }
  return null;
}

/* ── the three verbs ──────────────────────────────────────────────────────── */

/**
 * PICK IT UP. The body goes, a ghost takes its place, and the row stays in the
 * record until it is put down somewhere — so a pick that is interrupted by
 * walking out of the door leaves the piece where it was rather than deleting
 * it. `leaveHome` puts it back down for exactly that reason.
 */
export function takePiece(world, i) {
  const h = world?._home;
  if (!h || h.held) return null;
  const row = h.state.pieces[i];
  if (!row) return null;
  const c = BY_ID.get(row.k);
  const prop = h.props[i];
  if (prop && !prop.dead) prop.destroy();
  h.props[i] = null;
  const ghost = new THREE.Mesh(pieceGeo(c), h.M[c.mat]);
  ghost.name = `home-ghost-${c.id}`;
  h.group.add(ghost);
  h.held = { c, row, i, x: row.x, z: row.z, r: row.r, ghost, ok: true };
  poseGhost(h);
  world.notify?.(c.name.toUpperCase(), 'move it, wheel to turn, press again to set it down');
  return h.held;
}

/** Add a piece from the catalogue and hold it, which is how one is bought. */
export function addPiece(world, id) {
  const h = world?._home;
  if (!h || h.held) return null;
  const c = BY_ID.get(id);
  if (!c) return null;
  if (h.state.pieces.length >= MAX_PIECES) {
    world.notify?.('NO ROOM', `a cabin holds ${MAX_PIECES} pieces and this one is full`);
    return null;
  }
  const row = { k: c.id, x: 0, z: 0, r: 0 };
  h.state.pieces.push(row);
  h.props.push(null);
  const i = h.state.pieces.length - 1;
  const ghost = new THREE.Mesh(pieceGeo(c), h.M[c.mat]);
  ghost.name = `home-ghost-${c.id}`;
  h.group.add(ghost);
  h.held = { c, row, i, x: 0, z: 0, r: 0, ghost, ok: true, fresh: true };
  h.dirty = true; h.edits++;
  poseGhost(h);
  world.notify?.(c.name.toUpperCase(), 'move it, wheel to turn, press again to set it down');
  return h.held;
}

/** Move what is held to a point in the room's own frame. Snapped to the grid. */
export function movePiece(world, lx, lz) {
  const h = world?._home;
  const g = h?.held;
  if (!g) return null;
  g.x = snap(lx);
  g.z = snap(lz);
  poseGhost(h);
  return g;
}

/** Turn it. One wheel notch is one eighth, which is `NOTCHES`. */
export function rotatePiece(world, n) {
  const h = world?._home;
  const g = h?.held;
  if (!g || !n) return null;
  g.r = ((g.r + Math.sign(n)) % NOTCHES + NOTCHES) % NOTCHES;
  poseGhost(h);
  return g;
}

/**
 * PUT IT DOWN — or, where it does not fit, put it AWAY.
 *
 * A single interact key has to express both "here" and "no longer", and this
 * is how: a piece carried out of the cabin's footprint and set down is
 * removed, which is what carrying something out of a room means. The prompt
 * says which of the two happened, every time, so it is a verb and not a
 * surprise.
 */
export function dropPiece(world) {
  const h = world?._home;
  const g = h?.held;
  if (!g) return null;
  const why = fits(h, g.c, g.x, g.z, g.r, g.row);
  h.group.remove(g.ghost);
  g.ghost.geometry.dispose();
  h.held = null;
  if (why) {
    /* Out of the room, or into the partition: the piece is stowed. */
    h.state.pieces.splice(g.i, 1);
    h.props.splice(g.i, 1);
    h.dirty = true; h.edits++;
    world.notify?.(g.c.name.toUpperCase(), `put away — it would have stood ${why}`);
    return null;
  }
  g.row.x = g.x; g.row.z = g.z; g.row.r = g.r;
  h.props[g.i] = spawnPiece(world, h, g.row);
  h.dirty = true; h.edits++;
  world.notify?.(g.c.name.toUpperCase(), `set down at ${g.x.toFixed(1)}, ${g.z.toFixed(1)}`);
  return g.row;
}

/**
 * The ghost, posed. Its MATERIAL says whether it may be set down: the piece's
 * own where it fits and the deck's red `status` where it does not, which is a
 * legality read at a glance and costs no material this deck did not have.
 */
function poseGhost(h) {
  const g = h.held;
  if (!g) return;
  const why = fits(h, g.c, g.x, g.z, g.r, g.row);
  g.ok = !why;
  g.ghost.material = why ? h.M.status : h.M[g.c.mat];
  g.ghost.position.copy(toWorld(h, g.x, g.z));
  g.ghost.position.y += 0.02;
  g.ghost.quaternion.setFromAxisAngle(UP, h.spot.yaw + notchAngle(g.r));
}

/* ── the surfaces, changed ────────────────────────────────────────────────── */

/**
 * Recolour one surface. Instant, because the overlays are one mesh per slot and
 * the materials were all made at `stationMats` time — so this is an assignment
 * and never a rebuild.
 */
export function setSurface(world, slot, key) {
  const h = world?._home;
  if (!h || !SURFACES[slot] || !SURFACES[slot].includes(key)) return null;
  h.state.surfaces[slot] = key;
  const mesh = h.surfaces?.[slot];
  if (mesh) mesh.material = h.M[key];
  repaintPanel(h);
  h.dirty = true; h.edits++;
  return key;
}

/** Step one surface to the next colour on its row. What a fixture's verb does. */
export function cycleSurface(world, slot, n = 1) {
  const h = world?._home;
  if (!h || !SURFACES[slot]) return null;
  const row = SURFACES[slot];
  const i = Math.max(0, row.indexOf(h.state.surfaces[slot]));
  const key = row[((i + n) % row.length + row.length) % row.length];
  setSurface(world, slot, key);
  world.notify?.(slot.toUpperCase(), `${key} — ${h.address}`);
  return key;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE KEY, AND THE WHEEL                                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Is the player standing in their own home? Everything below is fenced by it. */
export function inHome(world) {
  const h = world?._home;
  const p = world?.player?.position;
  if (!h || !p) return false;
  const l = toLocal(h, p.x, p.z);
  return Math.abs(l.x) <= h.spot.w / 2 && Math.abs(l.z) <= h.spot.d / 2;
}

/** Where the crosshair meets the floor, in room coordinates. Null if nowhere. */
function aimOnFloor(world, h, opts = {}) {
  if (opts.at) return { x: opts.at[0], z: opts.at[1] };
  let o = opts.from, dir = opts.dir;
  if (!o || !dir) {
    const rig = world?.player?.camera;
    if (!rig?.pos || !rig?.aimQuat) return null;
    o = rig.pos;
    dir = _dir.copy(FWD).applyQuaternion(rig.aimQuat);
  }
  const dy = dir.y;
  /* Looking level or up at the ceiling is not a point on the floor. A metre of
   * fall over the reach is the shallowest angle that still resolves to a cell
   * rather than to the far wall. */
  if (dy > -0.08) return null;
  const t = (h.y - o.y) / dy;
  if (t < 0 || t > REACH * 2) return null;
  return toLocal(h, o.x + dir.x * t, o.z + dir.z * t);
}

/**
 * ══ ONE KEY, AND IT IS THE STATION'S OWN ══════════════════════════════════
 *
 * `Station.stationKey` calls this before it answers with a place's verb, so the
 * home adds no binding: §14's "one key, one prompt style" holds, `controls.mjs`
 * has nothing new to refuse, and outside the cabin this is one property read.
 *
 * The order is the order of what is in front of you:
 *
 *   holding something   → set it down (or put it away — see `dropPiece`)
 *   at the mirror       → the creator, through `world.onKiosk('mirror')`
 *   looking at a piece  → pick it up
 *   looking at bare floor → put the dialled catalogue piece there
 *
 * @returns true if the press was spent here.
 */
export function homeKey(world, opts = {}) {
  const h = world?._home;
  if (!h) return false;
  if (h.held) { dropPiece(world); return true; }
  /**
   * ══ AND IN SOMEBODY ELSE'S APARTMENT IT SPENDS THE PRESS ON A SENTENCE ══
   *
   * The press is CLAIMED and answered, not passed through. Falling through
   * would hand it to `placeUnder`, whose verb for `#33` is *"walk"* — so a
   * player standing at a friend's cupboard would be told to walk, and a player
   * standing at their own would open their own larder while looking at
   * somebody else's fridge. That second one is the whole of `Coop.js`
   * §WHAT A GUEST SEES: `larder()` reads the LOCAL store, which is yours and
   * can never be theirs, so the door onto it is shut here rather than left to
   * whichever store answered first.
   *
   * It is one sentence with a name and an address in it, because "nothing
   * happened" is indistinguishable from a broken key.
   */
  const here = homeUnder(world);
  if (here && !here.mine) {
    world.notify?.(`${(here.owner?.name || 'A RESIDENT').toUpperCase()}'S CABIN`,
      `${here.address} — their furniture and their cupboard, not yours`);
    return true;
  }
  if (!inHome(world) && !opts.at) return false;

  /* THE MIRROR FIRST, because you have to stand at it and standing at it is
   * unambiguous. `onKiosk` is `main.js`'s door onto the menu's panels and it
   * goes up through `Screens.take` like every other counter on the station. */
  const p = world.player?.position;
  if (p && h.mirror && p.distanceTo(h.mirror.at) < MIRROR_REACH && world.onKiosk) {
    world.onKiosk('mirror');
    world.notify?.('THE MIRROR', 'your own body in the glass');
    return true;
  }

  /* AND THE GALLEY, on the same terms: a fixture you stand at, so the press
   * cannot be mistaken for placing furniture on the floor beside it. */
  if (p && h.galley && p.distanceTo(h.galley.at) < GALLEY_REACH && world.onLarder) {
    world.onLarder();
    return true;
  }

  /**
   * AND A PARTITION. §1.3.3's *"let a third be unlocked"* — the key is the
   * toggle for whether there is a third room and the wheel slides the wall you
   * are standing at. Ahead of the floor because a partition is a fixture you
   * stand at, exactly as the panel and the galley are; after them because they
   * are against the room's own walls and it is in the middle of the floor, so
   * the two can never both be true.
   */
  if (wallAt(world) >= 0) { toggleWall(world); return true; }

  /* AND THE SWATCH PANEL. The key steps WHICH surface you are painting; the
   * wheel runs its colours. See `dressPanel` for why it is that way round. */
  if (atPanel(world)) {
    const P = h.panel;
    P.slot = (P.slot + 1) % SURFACE_SLOTS.length;
    const slot = SURFACE_SLOTS[P.slot];
    world.notify?.(slot.toUpperCase(), `${h.state.surfaces[slot]} — wheel to change it`);
    return true;
  }

  const aim = aimOnFloor(world, h, opts);
  if (!aim) return false;

  /* THE NEAREST PIECE UNDER THE CROSSHAIR, which is a footprint test and not a
   * raycast: the thing being picked is a rectangle on a floor and the aim has
   * already been resolved to a point on that floor. */
  let hit = -1, best = Infinity;
  for (let i = 0; i < h.state.pieces.length; i++) {
    const row = h.state.pieces[i];
    const c = BY_ID.get(row.k);
    if (!c) continue;
    const [ex, ez] = extentsAt(c, row.r);
    if (Math.abs(aim.x - row.x) > ex || Math.abs(aim.z - row.z) > ez) continue;
    const d2 = (aim.x - row.x) ** 2 + (aim.z - row.z) ** 2;
    if (d2 < best) { best = d2; hit = i; }
  }
  if (hit >= 0) { takePiece(world, hit); movePiece(world, aim.x, aim.z); return true; }

  const c = CATALOGUE[h.dial % CATALOGUE.length];
  if (addPiece(world, c.id)) { movePiece(world, aim.x, aim.z); return true; }
  return true;
}

/**
 * ══ THE WHEEL MEANS TWO THINGS AND NEVER AT ONCE ══════════════════════════
 *
 * Holding a piece, a notch turns it — that is §1.3.1's "rotate". Holding
 * nothing, a notch steps the catalogue, which is what makes the single interact
 * key able to place anything: the wheel says WHAT and the key says WHERE.
 *
 * @returns true if the notch was spent here.
 */
export function homeWheel(world, notches) {
  const h = world?._home;
  if (!h || !notches) return false;
  if (h.held) { rotatePiece(world, notches); return true; }
  if (!inHome(world)) return false;
  /* AT THE PANEL THE WHEEL PAINTS. Ahead of the catalogue, because a player
   * standing at the swatches is not shopping for furniture. */
  if (atPanel(world)) { cycleSurface(world, SURFACE_SLOTS[h.panel.slot], Math.sign(notches)); return true; }
  /* AT A PARTITION THE WHEEL SLIDES IT — half a metre a notch, on the same
   * grid the furniture lands on. Ahead of the catalogue for the panel's
   * reason: a player standing at a wall is not shopping for furniture. */
  const wi = wallAt(world);
  if (wi >= 0) { moveWall(world, wi, Math.sign(notches)); return true; }
  h.dial = ((h.dial + Math.sign(notches)) % CATALOGUE.length + CATALOGUE.length) % CATALOGUE.length;
  const c = CATALOGUE[h.dial];
  world.notify?.(c.name.toUpperCase(), `${c.w} × ${c.d} m — press to put one down`);
  return true;
}

/**
 * ══ AND THE WHEEL IS TAKEN FROM THE WINDOW, NOT FROM `Player.js` ══════════
 *
 * `Player._readInput` claims `input.mouse.wheel` for the grip, the stasis field
 * and a piloted blade, and hands it to the saber's wrist roll otherwise. A
 * fourth claimant in that branch is a line in a file this work does not own,
 * and — more to the point — the home's claim is not a mode the player is in, it
 * is a room they are standing in.
 *
 * So it is read where `Input` reads it: a CAPTURE-phase listener on the window,
 * which runs before `Input`'s own bubble-phase one and calls
 * `stopPropagation` only on the notches this file actually spends. Outside the
 * cabin, and with nothing held, the event is untouched and the wheel is the
 * saber's exactly as before. It is the same "listen at the document, fenced by
 * one condition" `Station.beginStationName` already does for the keyboard.
 */
function attachWheel(world, h) {
  const w = globalThis.window;
  if (!w?.addEventListener) return;
  h.wheel = (e) => {
    if (!world._home || world._home !== h) return;
    if (!h.held && !inHome(world)) return;
    if (!homeWheel(world, Math.sign(e.deltaY))) return;
    e.preventDefault();
    e.stopPropagation();
  };
  w.addEventListener('wheel', h.wheel, { capture: true, passive: false });
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE FRAME, AND THE LEAVING                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * One line of `stepStation`. It does nothing at all unless something is held,
 * which is the state a player is in for a few seconds of a visit.
 */
export function stepHome(world, dt) {
  const h = world?._home;
  if (!h?.held) return;
  const aim = aimOnFloor(world, h);
  if (aim) movePiece(world, aim.x, aim.z);
}

/**
 * ══ "SAVED ON LEAVING" — §1.3.5, AND IT IS THE `leaveDeck` PATTERN ════════
 *
 * `DeckEdit.leaveDeck`'s door, for its reason: a home is edited by dozens of
 * small movements and writing the fold on each of them would be a localStorage
 * write per wheel notch. So the record is authored in memory and committed
 * once, here, on the way out — which is also exactly what V15 asks for:
 * *"you would have the option of saving it so you don't lose all the work if
 * you die."* Nothing in a run's ending reaches this file.
 *
 * WHERE THE FURNITURE ACTUALLY IS is what gets written, not where it was put:
 * §1.3.1 says a home is a sandbox and you can knock your own furniture over, so
 * a chair that has been shoved across the room is saved shoved, snapped back
 * onto the grid. A piece that was destroyed is dropped from the record, because
 * the alternative is a cabin that resurrects its own wreckage.
 *
 * @returns how many pieces the home was left with.
 */
export function leaveHome(world) {
  const h = world?._home;
  /* `world._home` IS BY CONSTRUCTION THE ONE HOME THAT IS YOURS — `dressHome`
   * assigns it only under `mine` — and the test is here anyway, because this
   * is the single line in the tree that turns a room into a durable record and
   * the cost of it ever being wrong is a friend's furniture overwriting yours
   * on your own disk. One property read, once per station visit. */
  if (!h || !h.mine) return 0;
  /* A piece still in your hands is put back down first — the same "a change
   * dialled and not yet settled is still a change" `releaseMan` makes. */
  if (h.held) dropPiece(world);
  const kept = [];
  for (let i = 0; i < h.state.pieces.length; i++) {
    const row = h.state.pieces[i];
    const prop = h.props[i];
    if (prop && prop.dead) continue;
    if (prop?.body?.position) {
      const l = toLocal(h, prop.body.position.x, prop.body.position.z);
      row.x = snap(l.x);
      row.z = snap(l.z);
    }
    kept.push(row);
  }
  h.state.pieces = kept;
  /**
   * ══ AND ONLY THE FIELDS THIS ROOM OWNS ARE WRITTEN FROM MEMORY ══════════
   *
   * `store` and `pad` are written by systems that are not in this room:
   * `V16.md` §2 B5 buys food at a counter and §3.2 has a parcel delivered to
   * your apartment overnight, and V15 §1.3 says which of the perch, the basket
   * and the charge pad the cabin gets is *"a choice you make at the habitat"*.
   * All three happen while the player is somewhere else on the station, and a
   * visit that ended by writing the copy of the record it STARTED with would
   * take the shopping back off the shelf. So the two fields this file never
   * edits FROM THE ROOM are taken from the fold at the moment of writing, and
   * the ones it does edit are taken from memory. `setPad` writes the fold and
   * the dressed room together, so this reads back what it just wrote.
   */
  const now = loadHome();
  h.state.store = now.store;
  h.state.pad = now.pad;
  saveHome(h.state);
  h.dirty = false;
  return kept.length;
}

/** Everything the home made, put down. `undressStation` calls it. */
export function undressHome(world) {
  /* EVERY APARTMENT, NOT ONLY YOURS. A guest's cabin is bodies in `world.props`
   * and a canvas texture on a door exactly as yours is, and one left standing
   * after a station is disposed is a leak with a collider in it. */
  for (const h of [...(world?._homes || [])]) undressOne(world, h);
  if (world) { world._homes = []; world._home = null; }
}

function undressOne(world, h) {
  if (!h) return;
  const w = globalThis.window;
  if (h.wheel && w?.removeEventListener) w.removeEventListener('wheel', h.wheel, { capture: true });
  if (h.held) {
    h.group.remove(h.held.ghost);
    h.held.ghost.geometry.dispose();
    h.held = null;
  }
  /* The sign's material is the one this file MACHINED (a canvas texture), so
   * it is the one this file frees. Every other material in here is
   * `stationMats`', shared with the whole deck, and disposing one would take
   * the paint off every room on it — `Prop.destroy`'s note, one file over. */
  h.sign?.material?.map?.dispose?.();
  h.sign?.material?.dispose?.();
  /**
   * THE PARTITIONS. The second one's mesh is in `h.built` and is freed with
   * the rest below; what is NOT in `h.built` is the shape's own slab, which
   * this file MOVED inside somebody else's merged mesh, and the two static
   * boxes, which are in the physics world rather than in the scene.
   *
   * The slab is put back where the kit left it for `attachSoftBody.dispose`'s
   * reason exactly: this file borrowed geometry it does not own, and the
   * contract for borrowing is that it goes back. `Coop.js` re-dresses a
   * guest's apartment while the world stands, so this path runs far more than
   * once a session and a slab left slid would walk across the room.
   */
  for (const W of h.walls || []) {
    if (W.box) { world?.physics?.removeStaticBox?.(W.box); W.box = null; }
  }
  if (h.kitWall) { slideKitPartition(h.kitWall, h.kitWall.at); h.kitWall = null; }
  if (h.walls) h.walls.length = 0;
  /* THE PERCH AND ITS OCCUPANT, before the sweep below: the animal's body is a
   * whole rig in the group and `h.built` holds meshes, so the sweep's
   * `remove` + one `geometry.dispose` would leave thirty-seven of them alive
   * inside a Group nobody points at any more. */
  undressPad(h);
  /* AND THE GLASS'S REFLECTION — a render target is GPU memory and the hook
   * that fills it closes over this world. Neither is freed by removing a mesh
   * from a group. */
  undressMirror(h);
  for (const p of h.props) { if (p && !p.dead) p.destroy(); }
  h.props.length = 0;
  /* And the fixtures and surfaces this dressing added to the room's group.
   * They are remembered as they are made (`h.built`) rather than found by a
   * name test over the group's children, because the group is the ROOM's and
   * most of what is in it was built by `StationKit` — a filter is a guess about
   * somebody else's naming and it fails by deleting the walls. A guest's
   * apartment is dressed and RE-dressed while the world stands, every time its
   * owner moves a chair, so this path runs far more than once a session. */
  for (const m of h.built || []) {
    h.group.remove(m);
    m.geometry?.dispose?.();
  }
  if (h.built) h.built.length = 0;
  h.surfaces = h.mirror = h.galley = h.sign = h.panel = h.pad = null;
  const at = (world?._homes || []).indexOf(h);
  if (at >= 0) world._homes.splice(at, 1);
  if (world && world._home === h) world._home = null;
}

/** One apartment, taken down on its own — `Coop.js` re-dresses a guest's. */
export function undressApartment(world, h) { undressOne(world, h); }

/**
 * The home, for anything that wants to read it without dressing one.
 * `V16.md` §3.2's parcels desk and Lane F's visiting both need the address and
 * neither should have to know how a room is built.
 */
export function homeRecord(world) {
  const h = world?._home;
  if (!h) return null;
  return {
    address: h.address, place: h.place.id, deck: h.place.deck,
    surfaces: { ...h.state.surfaces }, pieces: h.state.pieces.length,
    store: h.state.store, pad: h.state.pad,
    /** V15 §1.3 — is the small companion actually standing on it? */
    padded: !!h.pad, resident: h.pad?.body?.rec?.id || null,
    /** V15 §1.3.3 — how many rooms are behind the address. One more than walls. */
    rooms: (h.walls ? h.walls.length : 0) + 1,
  };
}
