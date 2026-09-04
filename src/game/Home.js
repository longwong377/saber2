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
 *      knows about, so a piece cannot be put down inside a wall.
 *   4. AN ADDRESS. `44-C-27`, derived and not stored, printed on the door.
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
    /** V15 §1.3 — the one small companion who lives here. An id or null. */
    pad: typeof raw.pad === 'string' ? raw.pad.slice(0, 32) : null,
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
    /** What the grid may not be put into: the partition, from the shape. */
    blockers: spot.blockers || [],
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
    surfaces: null, mirror: null, galley: null, sign: null, wheel: null, draws: 0,
    /** Every mesh this dressing put in the room's group — see `undressOne`. */
    built: [],
  };
  if (mine) world._home = h;
  /* EVERY DRESSED APARTMENT, YOURS FIRST. `homeUnder` walks it to answer which
   * room a player is standing in, and `undressHome` walks it to take them all
   * down — a guest's cabin that outlived the visit would be a live body list
   * pointing into a disposed world. */
  (world._homes || (world._homes = [])).push(h);

  dressSurfaces(world, h);
  dressMirror(world, h);
  dressGalley(world, h);
  dressSign(world, h);
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

/**
 * ══ THE MIRROR, AND IT IS DELIBERATELY NOT A REFLECTION ═══════════════════
 *
 * §1.3: *"a real mirror in the cabin, and standing at it opens the character
 * creator with your own body in the glass rather than on a menu stage."* The
 * SECOND half of that is the feature and it is what `homeKey` raises;
 * the first half is a planar reflection, and `DeckMirror.js` — the only mirror
 * in this tree — is floor-plane only. Generalising it to an arbitrary vertical
 * plane is a rendering change with a rendering change's risk, and it would buy
 * a picture of a body that the panel it opens is about to draw anyway.
 *
 * So the fixture is dark glass in a frame, which is what an unlit mirror looks
 * like, and the door behind it is real from the first day.
 */
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
  h.mirror = { lx, lz, at: toWorld(h, lx, lz).clone(), mesh: fm };
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
 * The address, on the door. §1.3.4's *"what makes a home a place rather than a
 * menu"*, and the one panel in the room a passer-by reads rather than you.
 */
function dressSign(world, h) {
  const { d } = h.spot;
  /* AND WHOSE IT IS, WHEN IT IS NOT YOURS. V16 Lane F is *"you should be able
   * to visit your friend's apartment"*, and a visit needs a door you can tell
   * from the twelve beside it — which is the argument §1.3.4 already makes for
   * having an address at all, one player further on. */
  const panel = signPanel([h.address, h.owner ? `${String(h.owner.name || 'RESIDENT').toUpperCase()}'S CABIN` : 'PRIVATE RESIDENCE'], {
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
   * your apartment overnight, and V15 §1.3 says which small companion lives
   * here is *"a choice you make at the habitat"*. All three happen while the
   * player is somewhere else on the station, and a visit that ended by writing
   * the copy of the record it STARTED with would take the shopping back off
   * the shelf. So the two fields this file never edits are taken from the fold
   * at the moment of writing, and the ones it does edit are taken from memory.
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
  h.surfaces = h.mirror = h.galley = h.sign = null;
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
  };
}
