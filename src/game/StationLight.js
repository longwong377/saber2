/**
 * ══ V20 LANE 1 — LIGHT MOODS, KEY SHADOWS, AND EMISSIVES THAT LIGHT THE FLOOR
 *
 * The player: *"Presentation lags the simulation by a lot. In motion the
 * station lacks lighting contrast."* And 2.0 item 4: *"Real light moods per
 * room and hour: the cantina at 02:00 should look nothing like it does at
 * noon. Shadows from the key light on bodies. Emissive surfaces that actually
 * light the floor near them."*
 *
 * Three things, and each one is a measurement before it is a feature.
 *
 * ── 1. A MOOD PER ROOM AND PER HOUR ──────────────────────────────────────
 *
 * `Station.lightStation` builds ONE rig for a whole deck — a key at 28°, a
 * rim from the opposite bearing, an ambient and a hemisphere — off
 * `DECK_PALETTE`. That is a deck's character, and it is the same character in
 * the cantina at 02:00 as in the medbay at noon. `MOOD` is the second table:
 * per shape (or per place id) and per hour band, what the key is, how much
 * ambient sits under it, what colour the fill is, and what the strips are
 * tinted. It is applied by the place the player is IN or nearest
 * (`Station.placeUnder`) and crossfaded over `FADE` seconds, so walking
 * through the cantina's door is a two-second change of light and not a cut.
 *
 * ── AND IT DOES NOT FIGHT THE THREE FILES THAT ALREADY WRITE HERE ────────
 *
 * `Morning` drives the strips' emissive INTENSITY off the hour, `StationWar`
 * turns their emissive COLOUR red on an alert, and `StationLife.stepDip`
 * scales the rig and the three emissive materials during a surge. All three
 * are read, none is overwritten:
 *
 *   THE KEY, THE RIM, THE AMBIENT, THE FILL — this file owns their colour and
 *   their BASE intensity (`rig.base`), and multiplies by the dip's own factor
 *   (`rig.lit`, `rig.floor`) every frame, which is exactly the arithmetic
 *   `stepDip` does. Two writers, one formula, and a blackout still blacks out.
 *
 *   THE STRIPS' COLOUR — written only while `life.war.strip0 === null`, i.e.
 *   while no alert holds them red. `redden` saves the hex it found and puts it
 *   back; whatever this file last wrote is what it finds.
 *
 *   THE STRIPS' INTENSITY — never written. It is read, as a fraction of the
 *   material's day level, and it is what dims the glow decals and the lamps at
 *   night and during a surge for free.
 *
 * ── 2. SHADOWS FROM THE KEY, ON BODIES ───────────────────────────────────
 *
 * THE STATION HAD SHADOWS AND THEY WERE THE PROBLEM. `Props.addStatic` sets
 * `castShadow` on every merged mesh it makes, so each room's own soffit,
 * lid and walls were casting into a shadow map lit by the engine's sun at
 * 62° — which is to say the interior of the drum was entirely inside its own
 * cast shadow, on every deck, at every hour. The key did nothing, everything
 * arrived at the flat ambient, and that is "in motion the station lacks
 * lighting contrast" said in one sentence.
 *
 * A room's ceiling is not a light blocker in a room lit by its own ceiling.
 * So on the station the SHELL AND THE ROOMS DO NOT CAST, and what casts is
 * the nearest few dozen things that read as objects — the people, the crates,
 * the barrels, the loose furniture. The engine's cascade 0 is the caster
 * (it is the only directional light the cel patch looks a shadow up for —
 * see `installCascadeShadows`: a fourth directional light with `castShadow`
 * set would render a shadow map that no fragment ever reads), and it is
 * turned onto the same bearing and colour as the mood's key so the shadow on
 * the floor agrees with the shading on the wall.
 *
 * The budget is one shadow-casting light at a 1024 map (cascades 1 and 2 are
 * switched off inside the drum: they exist to reach 150 m across a
 * battlefield and the longest sightline in here is the atrium), and at most
 * `CASTERS` casters, chosen by a sweep once a second. At quality 'low' the
 * whole pass is off.
 *
 * ── 3. EMISSIVES THAT LIGHT THE FLOOR ────────────────────────────────────
 *
 * Every strip, status lamp and screen in the station is a bright band on a
 * merged mesh that lights nothing at all. Two answers, because one of them
 * cannot be afforded everywhere:
 *
 *   THE FIXTURES are found at dress time by walking the emissive materials'
 *   vertices in the merged meshes and binning them into `CELL` metre cells —
 *   a 26 m soffit run comes out as a dozen fixtures along its length, which is
 *   what a soffit run actually is.
 *
 *   NEAR THE PLAYER, up to `LAMPS` of them get a real `PointLight` from a
 *   fixed pool — created once at dress and never added or removed, because
 *   the light COUNT changing is a shader recompile (`Engine`'s own pool
 *   carries the same note) — reassigned to the nearest fixtures as he walks.
 *
 *   EVERYWHERE ELSE, a GLOW DECAL: a flat quad on the floor under the fixture
 *   with a radial falloff, additive, tinted the fixture's own colour and
 *   scaled by the strips' live intensity. One merged mesh per place, parented
 *   to the place's group so it is culled with the room. Additive blending is
 *   what keeps it out of the ink prepass (`Ink.cutsItsOwnSilhouette`), so it
 *   reads as light on the floor rather than as a sticker with a line round it.
 *
 * NOTHING HERE ROLLS. Every number is the hour, the place or the frame clock.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { DECK_Y } from './StationPlan.js';
import { DECK_PALETTE, placeUnder } from './Station.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE NUMBERS                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/** How long a mood takes to arrive when you cross a door, real seconds. */
export const FADE = 2.0;
/** How many emissive fixtures may carry a real point light at once. */
export const LAMPS = 12;
/** How far a fixture may be and still be worth a light, metres. */
export const LAMP_REACH = 30;
/** How many meshes may cast into the shadow map at once. */
export const CASTERS = 40;
/** How far a caster may be from the player, metres. */
export const CAST_REACH = 26;
/** The shadow map the drum gets. One light, one map. */
export const SHADOW_MAP = 1024;
/** The cell an emissive vertex is binned into when fixtures are found, metres. */
export const CELL = 2.2;
/** A fixture higher than this above its own floor lights nothing under it. */
export const GLOW_CEIL = 6.5;
/** The most fixtures one place may declare, and the most a deck may. */
export const PLACE_FIXTURES = 48;
export const DECK_FIXTURES = 640;

/** The four hour bands. Night wraps midnight, which is why this is not a table. */
export function bandOf(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  if (h >= 22 || h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 18) return 'day';
  return 'evening';
}

/**
 * ══ THE MOODS ═════════════════════════════════════════════════════════════
 *
 * Keyed by a place's SHAPE, which is what makes a mood a kind of room rather
 * than a room — `sunkenround` is the cantina on deck 40 and would be the
 * cantina on any deck that grew one. A place ID key wins over a shape key for
 * the one-off. `all` is the room's own character at every hour; a band merges
 * over it; anything neither states falls to the deck's own rig.
 *
 *   key   the key light's colour        keyI  its intensity   (deck: 1.55)
 *   rimI  the opposite low rim                                (deck: 0.55)
 *   ambC  the flat ambient's colour     ambI  its level       (deck: 0.30)
 *   fillC the hemisphere's sky colour   fillI its level       (deck: 0.30)
 *   strip the strips' emissive tint
 *   sunI  the shadow-casting key's intensity                  (deck: 2.6)
 *   glow  a multiplier on the decals and the lamps
 *   pulse Hz of a slow breath on the glow, 0 for none
 */
export const MOOD = {
  /* #14 THE CANTINA. At 02:00 it is a low amber room with cold blue light in
   * the booths; at noon it is flat, grey and dim — a bar in the daytime. */
  sunkenround: {
    night:   { key: 0xff9a3c, keyI: 0.52, rimI: 0.30, ambC: 0x3a2a1c, ambI: 0.11, fillC: 0x24365f, fillI: 0.20, strip: 0x74aaff, sunI: 0.55, glow: 1.6 },
    dawn:    { key: 0xffb877, keyI: 0.78, rimI: 0.38, ambC: 0x4a3a2a, ambI: 0.19, fillC: 0x3d4c60, fillI: 0.26, strip: 0x9cc4ff, sunI: 0.9, glow: 1.15 },
    day:     { key: 0xd8dde5, keyI: 0.86, rimI: 0.50, ambC: 0x9aa4b0, ambI: 0.36, fillC: 0x8e9aa8, fillI: 0.36, strip: 0xd2e2f4, sunI: 1.0, glow: 0.45 },
    evening: { key: 0xff9a52, keyI: 0.88, rimI: 0.34, ambC: 0x3e2c1e, ambI: 0.14, fillC: 0x2e3d63, fillI: 0.30, strip: 0xffc48a, sunI: 0.95, glow: 1.25 },
  },
  /* #43 THE MEDBAY. White, even and awake at four in the morning: a ward is
   * the one room on the station whose light does not have an hour. */
  triagehall: {
    all:     { key: 0xf6faff, keyI: 1.52, rimI: 0.72, ambC: 0xdfe9f5, ambI: 0.44, fillC: 0xdfe9f5, fillI: 0.42, strip: 0xf2f8ff, sunI: 1.7, glow: 0.8 },
    night:   { keyI: 1.30, ambI: 0.38 },
  },
  /* #44 the bacta ward next door reads the same, one stop cooler. */
  tankrow: {
    all:     { key: 0xe8f4ff, keyI: 1.30, rimI: 0.62, ambC: 0xc8dcee, ambI: 0.40, fillC: 0xbcd4ea, fillI: 0.38, strip: 0xdff0ff, sunI: 1.5, glow: 0.9 },
  },
  /* #48 THE REACTOR HALL. Deep red-orange with a slow breath in the floor. */
  cathedral: {
    all:     { key: 0xff5218, keyI: 1.45, rimI: 0.26, ambC: 0x50190a, ambI: 0.15, fillC: 0x6b1c08, fillI: 0.30, strip: 0xff7a28, sunI: 1.15, glow: 1.9, pulse: 0.55 },
    night:   { keyI: 1.25, ambI: 0.12 },
  },
  /* #23 THE ARBORETUM. Green-gold by day, blue at night. */
  cutthrough: {
    night:   { key: 0x6f9fd8, keyI: 0.50, rimI: 0.30, ambC: 0x1d2c48, ambI: 0.15, fillC: 0x2f4a7a, fillI: 0.26, strip: 0x8fb6ff, sunI: 0.7, glow: 1.2 },
    dawn:    { key: 0xffd7a2, keyI: 1.15, rimI: 0.48, ambC: 0x54523c, ambI: 0.26, fillC: 0x7fae7a, fillI: 0.30, strip: 0xcdf0b6, sunI: 1.8, glow: 0.8 },
    day:     { key: 0xfff0b4, keyI: 1.72, rimI: 0.58, ambC: 0x8f9a74, ambI: 0.34, fillC: 0x9fd08a, fillI: 0.36, strip: 0xd9ffb4, sunI: 2.5, glow: 0.5 },
    evening: { key: 0xffb478, keyI: 1.05, rimI: 0.42, ambC: 0x5a4a38, ambI: 0.24, fillC: 0x6f8f76, fillI: 0.28, strip: 0xbfe8a8, sunI: 1.4, glow: 0.9 },
  },
  /* #22 THE CHAPEL. Candles, and almost nothing else, at any hour. */
  darkdrum: {
    all:     { key: 0xffc07a, keyI: 0.46, rimI: 0.16, ambC: 0x241a12, ambI: 0.10, fillC: 0x2a1e14, fillI: 0.16, strip: 0xffbb70, sunI: 0.5, glow: 1.5 },
    day:     { keyI: 0.62, ambI: 0.14 },
  },
  /* #49 COOLANT AND WATER. Cold, wet, cyan, and lit from under the grating. */
  wetgrating: {
    all:     { key: 0x9fe4e0, keyI: 1.10, rimI: 0.46, ambC: 0x1e3a3c, ambI: 0.20, fillC: 0x2c5a5e, fillI: 0.30, strip: 0x7fe8dc, sunI: 1.3, glow: 1.2 },
  },
  /* #50 FABRICATION. Hard white overheads and the forge's own orange. */
  machineshop: {
    all:     { key: 0xfff4e2, keyI: 1.45, rimI: 0.40, ambC: 0x3e3a34, ambI: 0.22, fillC: 0x5c5348, fillI: 0.28, strip: 0xffd9a0, sunI: 1.9, glow: 1.1 },
    night:   { keyI: 1.05, ambI: 0.16 },
  },
  /* #35 THE DRAZI QUARTER. Smoke and a red pit, worst at night. */
  fightingpit: {
    all:     { key: 0xff7a4a, keyI: 0.95, rimI: 0.28, ambC: 0x3c2018, ambI: 0.16, fillC: 0x4a2018, fillI: 0.26, strip: 0xff8a48, sunI: 1.0, glow: 1.3 },
    night:   { keyI: 0.62, ambI: 0.11, glow: 1.7 },
    day:     { keyI: 1.15, ambI: 0.22 },
  },
  /* #27 YOUR CABIN. Domestic, warm, and off at night unless you are up. */
  twinroom: {
    all:     { key: 0xffe0b4, keyI: 1.05, rimI: 0.40, ambC: 0x4a4038, ambI: 0.24, fillC: 0x5a4c40, fillI: 0.28, strip: 0xffd9a8, sunI: 1.3, glow: 0.9 },
    night:   { keyI: 0.58, ambI: 0.13, strip: 0xffc98a, glow: 1.3 },
  },
  /* #38 THE HOSTEL. A capsule wall with a blue reading light in each hole. */
  capsulewall: {
    all:     { key: 0xcfe0f4, keyI: 0.95, rimI: 0.38, ambC: 0x2c3646, ambI: 0.20, fillC: 0x39496a, fillI: 0.28, strip: 0x9fc8ff, sunI: 1.1, glow: 1.1 },
    night:   { keyI: 0.52, ambI: 0.12, glow: 1.5 },
  },
  /* #47 THE BRIG. Green-white, hard, and never off. */
  cellring: {
    all:     { key: 0xe6ffe8, keyI: 1.25, rimI: 0.30, ambC: 0x28382c, ambI: 0.22, fillC: 0x33483a, fillI: 0.26, strip: 0xcaffd2, sunI: 1.4, glow: 0.8 },
  },
  /* #18 THE PIT. A low den: dim, warm, and smoky at every hour. */
  lowden: {
    all:     { key: 0xffa860, keyI: 0.80, rimI: 0.26, ambC: 0x3a2a20, ambI: 0.16, fillC: 0x3e2c22, fillI: 0.24, strip: 0xffb070, sunI: 0.9, glow: 1.3 },
    night:   { keyI: 0.58, ambI: 0.12, glow: 1.5 },
  },
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DECK'S OWN, WHICH IS WHAT THE RING GETS                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The hour's shape on a deck with no mood of its own — the ring, the walks. */
const DECK_BAND = {
  night:   { keyI: 0.72, rimI: 0.32, ambI: 0.19, fillI: 0.22, sunI: 1.05, glow: 1.35, warm: -0.10 },
  dawn:    { keyI: 1.16, rimI: 0.46, ambI: 0.25, fillI: 0.27, sunI: 1.90, glow: 1.00, warm: 0.16 },
  day:     { keyI: 1.55, rimI: 0.55, ambI: 0.30, fillI: 0.30, sunI: 2.60, glow: 0.60, warm: 0.00 },
  evening: { keyI: 1.18, rimI: 0.44, ambI: 0.24, fillI: 0.26, sunI: 1.60, glow: 1.05, warm: 0.22 },
};

/** Warm (+) or cool (−) a hex by `k`, about its own luminance. */
const _wc = new THREE.Color();
function tempered(hex, k) {
  _wc.setHex(hex);
  if (k) {
    _wc.r = Math.min(1, Math.max(0, _wc.r * (1 + k * 0.22)));
    _wc.b = Math.min(1, Math.max(0, _wc.b * (1 - k * 0.26)));
  }
  return _wc.getHex();
}

/**
 * The mood for a place at an hour, resolved. Allocates one object, and only
 * on the frames the answer CHANGES — see `stepStationLight`.
 */
export function moodFor(deck, place, hour) {
  const P = DECK_PALETTE[deck] || DECK_PALETTE[40];
  const band = bandOf(hour);
  const B = DECK_BAND[band];
  /* The deck's own rig is the floor every mood stands on: the ring, the
   * spines and the lobbies are lit by the deck and by nothing else. */
  const base = {
    key: tempered(P.key, B.warm), keyI: B.keyI, rimI: B.rimI,
    ambC: P.ambient, ambI: B.ambI, fillC: P.fill, fillI: B.fillI,
    strip: P.strip, sunI: B.sunI, glow: B.glow, pulse: 0,
    id: place ? place.id : 0, band,
  };
  const rec = (place && (MOOD[place.id] || MOOD[place.shape])) || null;
  if (!rec) return base;
  return Object.assign(base, rec.all || null, rec[band] || null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE GLOW TEXTURE — a radial falloff, made without a canvas                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A `DataTexture` and not a canvas, so the same pixels exist in the browser
 * and in a headless check. 64², a smooth radial falloff with a hot core: a
 * gaussian alone reads as a fog patch, and a hard disc reads as a sticker.
 */
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      const r = Math.min(1, Math.hypot(u, v));
      /* (1 − r²)² is the smooth shoulder; the cube lifts the core so the
       * metre under the strip is brighter than the metre beside it. */
      const f = (1 - r * r) * (1 - r * r);
      const a = Math.max(0, Math.min(1, f * (0.55 + 0.45 * (1 - r) * (1 - r))));
      const i = (y * N + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _glowTex = t;
  return t;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  FINDING THE FIXTURES                                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

const EMISSIVE_KEYS = { strip: 1, screen: 1, status: 1 };

const _v = new THREE.Vector3();

/**
 * Walk one merged mesh's vertices and bin them into `CELL` metre cells.
 *
 * A merged mesh has no part boundaries left in it — that is what merging is —
 * so a cluster cannot be found by looking for one. A grid answers anyway, and
 * it answers the way the room wants: a 26 m soffit run becomes a dozen
 * fixtures spaced along it, which is what a soffit run looks like when it is
 * lit, and a single status lamp becomes one.
 */
function binMesh(mesh, kind, out) {
  const pos = mesh.geometry?.attributes?.position;
  if (!pos) return;
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;
  const cells = new Map();
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(m);
    const cx = Math.floor(_v.x / CELL), cy = Math.floor(_v.y / (CELL * 0.8)), cz = Math.floor(_v.z / CELL);
    const key = `${cx}|${cy}|${cz}`;
    let c = cells.get(key);
    if (!c) cells.set(key, c = { x: 0, y: 0, z: 0, n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y1: -1e9 });
    c.x += _v.x; c.y += _v.y; c.z += _v.z; c.n++;
    if (_v.x < c.x0) c.x0 = _v.x;
    if (_v.x > c.x1) c.x1 = _v.x;
    if (_v.z < c.z0) c.z0 = _v.z;
    if (_v.z > c.z1) c.z1 = _v.z;
    if (_v.y > c.y1) c.y1 = _v.y;
  }
  for (const c of cells.values()) {
    /* Four vertices is a face. Fewer is a corner of something that mostly
     * lives in the cell next door, and it already has a fixture there. */
    if (c.n < 4) continue;
    out.push({
      kind,
      x: c.x / c.n, y: c.y / c.n, z: c.z / c.n,
      w: Math.max(0.3, c.x1 - c.x0), d: Math.max(0.3, c.z1 - c.z0), top: c.y1,
      n: c.n, lamp: -1,
    });
  }
}

/** Every emissive fixture in one place, capped and ordered by size. */
function fixturesOf(rec) {
  const out = [];
  rec.group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const kind = o.material.userData?.key;
    if (!kind || !EMISSIVE_KEYS[kind]) return;
    binMesh(o, kind, out);
  });
  /* Biggest first, so a cap keeps the soffit run and drops a rivet. */
  out.sort((a, b) => b.n - a.n);
  if (out.length > PLACE_FIXTURES) out.length = PLACE_FIXTURES;
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DECALS                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * One merged additive quad sheet per place, in the place's own group.
 *
 * VERTEX COLOURS carry the fixture's kind — a screen's blue pool and a status
 * lamp's red one are in the same mesh — and the material's own colour is the
 * live trim: the mood's tint and the strips' current intensity, written once
 * a frame on one material rather than per decal.
 */
function decalsFor(world, fixtures, mats) {
  const quads = [];
  const col = new THREE.Color();
  for (const f of fixtures) {
    const floor = world.floorAt ? world.floorAt(f.x, f.z) : 0;
    const h = f.y - floor;
    /* Above the ceiling it lights nothing under it; below the floor it is
     * under something solid and there is nothing to light. A fixture ON the
     * floor — a lit tread, a strip set into a dais — keeps its decal and is
     * laid just proud of its own top face rather than under it. */
    if (h > GLOW_CEIL || h < -0.5) continue;
    const y = h < 0.35 ? Math.max(floor + 0.03, f.top + 0.02) : floor + 0.03;
    const lift = Math.max(0.25, h);
    /* A lamp two metres up throws a tighter pool than one six metres up, and
     * a long strip's pool is long. Both are the same rule: the pool is the
     * fixture plus its own height, in each direction. */
    const rx = Math.max(0.9, f.w / 2 + lift * 0.72);
    const rz = Math.max(0.9, f.d / 2 + lift * 0.72);
    const m = mats[f.kind];
    col.setHex(m);
    /* Falls off with height: a strip on the ceiling of the atrium is not what
     * lights the plate, and pretending it is makes a flat wash.
     *
     * ── AND IT IS DIVIDED BY ITS OWN OVERLAP, WHICH IS WHAT BLEW THE FLOOR
     * OUT. The ring's soffit is a continuous run: at `CELL` metres a fixture
     * and a pool `2·rx` wide, every point on the walk under it is inside three
     * or four pools at once and they ADD. Measured on the first sheet, the
     * plate at the cantina's door came out white from 22:00 to 06:00 with no
     * light in the room at all. Dividing by the root of how many pools deep a
     * pool is puts a run of strips at about the brightness of one of them,
     * which is what a run of strips looks like. */
    const over = Math.max(1, (2 * rx) / CELL) * Math.max(1, (2 * rz) / CELL);
    const k = Math.max(0.10, (1 - lift / (GLOW_CEIL + 1.5)) / Math.sqrt(over));
    quads.push({ x: f.x, y, z: f.z, rx, rz, r: col.r * k, g: col.g * k, b: col.b * k });
    f.glow = true;
  }
  if (!quads.length) return null;
  const n = quads.length;
  const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8);
  const cols = new Float32Array(n * 12), idx = new Uint16Array(n * 6);
  for (let i = 0; i < n; i++) {
    const q = quads[i], p = i * 12, u = i * 8, ix = i * 6, v0 = i * 4;
    const X = [q.x - q.rx, q.x + q.rx, q.x + q.rx, q.x - q.rx];
    const Z = [q.z - q.rz, q.z - q.rz, q.z + q.rz, q.z + q.rz];
    const U = [0, 1, 1, 0], V = [0, 0, 1, 1];
    for (let k = 0; k < 4; k++) {
      pos[p + k * 3] = X[k]; pos[p + k * 3 + 1] = q.y; pos[p + k * 3 + 2] = Z[k];
      uv[u + k * 2] = U[k]; uv[u + k * 2 + 1] = V[k];
      cols[p + k * 3] = q.r; cols[p + k * 3 + 1] = q.g; cols[p + k * 3 + 2] = q.b;
    }
    idx[ix] = v0; idx[ix + 1] = v0 + 1; idx[ix + 2] = v0 + 2;
    idx[ix + 3] = v0; idx[ix + 4] = v0 + 2; idx[ix + 5] = v0 + 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo, count: n };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DRESS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Which tier this world is on, however it was reached. */
function tierOf(world) {
  const s = world?.settings?.quality;
  if (s && s !== 'auto') return s;
  return world?.engine?.quality || s || 'high';
}

/**
 * Take the drum's lighting. Called from `dressStation` after every place is
 * standing, because the fixtures are found by walking what was built.
 */
export function dressStationLight(world, st) {
  if (!world?.scene || !st || st.light) return 0;
  const deck = st.deck;
  const tier = tierOf(world);
  const shadows = tier !== 'low';
  const L = st.light = {
    deck, tier, shadows,
    /** The mood on screen, the one being left, and where the fade is. */
    now: null, from: null, to: null, t: 1,
    /** Which place's mood is being shown, and the hour band with it. */
    at: null, band: null, fades: 0,
    lamps: [], lampsOn: 0, lampAt: 0,
    fixtures: [], decals: [], decalCount: 0, glowMat: null,
    casters: [], casterCount: 0, sweepAt: 0,
    /* What was taken off the engine, to be put back on the way out. */
    engine: null, statics: 0, clock: 0,
  };

  /* ── THE FIXTURES AND THEIR DECALS, PLACE BY PLACE ──────────────────── */
  const P = DECK_PALETTE[deck] || DECK_PALETTE[40];
  const mats = { strip: P.strip, screen: P.screen, status: P.status };
  const glowMat = L.glowMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    toneMapped: true, fog: true,
  });
  glowMat.name = `station-${deck}-glow`;
  for (const rec of st.places.values()) {
    if (L.fixtures.length >= DECK_FIXTURES) break;
    const found = fixturesOf(rec);
    if (!found.length) continue;
    const made = decalsFor(world, found, mats);
    if (made) {
      const mesh = new THREE.Mesh(made.geo, glowMat);
      mesh.name = `station-glow-${rec.place.id}`;
      /* Under everything else in the room: it is on the floor, and it must not
       * write depth over a body standing in it. */
      mesh.renderOrder = 2;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      rec.group.add(mesh);
      L.decals.push(mesh);
      L.decalCount += made.count;
      /* One draw per room, counted where every other draw in the station is
       * counted — a tally that does not include what was added is a tally a
       * budget check reads as headroom it has not got. */
      st.draws++;
    }
    for (const f of found) { f.place = rec.place.id; L.fixtures.push(f); }
  }

  /* ── THE LAMP POOL. Created once, parked at zero, never removed: the light
   * COUNT is a shader recompile and this is the file that would cause it. At
   * 'low' there are none at all, which is the same argument the other way. */
  const want = tier === 'low' ? 0 : tier === 'medium' ? 6 : LAMPS;
  for (let i = 0; i < want; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 7.2, 2);
    l.name = `station-lamp-${i}`;
    l.castShadow = false;
    world.scene.add(l);
    L.lamps.push(l);
  }

  /* ── THE SHADOW RIG ─────────────────────────────────────────────────── */
  takeShadows(world, L);

  /* ── AND THE FIRST FRAME IS ALREADY IN ITS MOOD, not fading into it from
   * whatever the deck's rig happened to be built with. */
  const place = placeUnder(world, world.player?.position?.x ?? 0, world.player?.position?.z ?? 0);
  const mood = moodFor(deck, place, st.hour);
  L.now = Object.assign({}, mood);
  L.to = Object.assign({}, mood);
  L.from = Object.assign({}, mood);
  L.t = 1;
  L.at = place ? place.id : null; L.band = L.now.band;
  applyMood(world, st, L);
  return L.decalCount;
}

/**
 * Take the engine's cascade 0 as the drum's one shadow-casting light.
 *
 * WHY THE ENGINE'S AND NOT ONE OF OURS: `Engine.installCascadeShadows` patches
 * `lights_fragment_begin` so that ONLY the light at unrolled index 0 looks a
 * shadow up. A new directional light with `castShadow` set would render a map
 * every frame that no fragment ever reads — the whole cost and none of the
 * picture. Cascade 0 is `engine.sun`, it is already fitted to the camera every
 * frame (`fitShadows`), and turning it onto the mood's own bearing is what
 * makes the shadow on the floor agree with the shading on the wall.
 */
function takeShadows(world, L) {
  const eng = world.engine;
  if (!eng) return;
  const cas = eng.cascades;
  const sun = eng.sun;
  L.engine = {
    sunColor: sun ? sun.color.getHex() : null,
    sunI: sun ? sun.intensity : null,
    dir: eng.sunDir ? eng.sunDir.clone() : null,
    cast: cas ? cas.map((c) => c.castShadow) : null,
    map: cas && cas[0] ? cas[0].shadow.mapSize.x : null,
  };
  if (!cas) return;
  for (let i = 0; i < cas.length; i++) {
    /* ONE LIGHT, ONE MAP. Cascades 1 and 2 reach 150 m across a battlefield;
     * the longest sightline inside the drum is the atrium and cascade 0 spans
     * it. Two maps that draw nothing are two shadow passes a frame. */
    const on = L.shadows && i === 0;
    if (cas[i].castShadow !== on) cas[i].castShadow = on;
  }
  if (L.shadows && cas[0].shadow.mapSize.x !== SHADOW_MAP) {
    cas[0].shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    cas[0].shadow.map?.dispose?.();
    cas[0].shadow.map = null;
  }
  /* ── AND NOTHING THE ROOM IS MADE OF CASTS ─────────────────────────────
   * A room lit by its own ceiling cannot have that ceiling in the shadow map:
   * `Props.addStatic` sets `castShadow` on every merged mesh, so the whole
   * interior of the drum stood inside its own cast shadow and the key did
   * nothing. They still RECEIVE — that is the floor the shadow lands on. */
  let n = 0;
  for (const m of world.statics || []) {
    if (m && m.castShadow) { m.castShadow = false; n++; }
    if (m) m.receiveShadow = true;
  }
  L.statics = n;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

const _ca = new THREE.Color(), _cb = new THREE.Color();
const lerp = (a, b, k) => a + (b - a) * k;

/** Ease the fade so a door crossing arrives rather than stops. */
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/**
 * Put the current mood on the rig, the strips and the decals.
 *
 * READS THE DIP RATHER THAN OVERWRITING IT. `StationLife.stepDip` scales the
 * rig off `life.dip` and writes `rig.lit` and `rig.floor`; this multiplies by
 * the same two numbers, so a blackout still blacks out and a mood still
 * arrives while one is running.
 */
function applyMood(world, st, L) {
  const rig = st.rig;
  if (!rig) return;
  const a = L.from, b = L.to, k = ease(L.t);
  const m = L.now;
  m.keyI = lerp(a.keyI, b.keyI, k);
  m.rimI = lerp(a.rimI, b.rimI, k);
  m.ambI = lerp(a.ambI, b.ambI, k);
  m.fillI = lerp(a.fillI, b.fillI, k);
  m.sunI = lerp(a.sunI, b.sunI, k);
  m.glow = lerp(a.glow, b.glow, k);
  m.pulse = lerp(a.pulse || 0, b.pulse || 0, k);

  const lit = rig.lit === undefined ? 1 : rig.lit;
  const floor = rig.floor === undefined ? 0.3 : rig.floor;

  /* THE KEY. `rig.base[0]` is what `stepDip` multiplies, so the base is the
   * mood and the intensity on the light is the mood through the dip. */
  _ca.setHex(a.key); _cb.setHex(b.key);
  rig.key.color.copy(_ca).lerp(_cb, k);
  rig.base[0] = m.keyI;
  rig.key.intensity = m.keyI * lit;

  _ca.setHex(a.ambC); _cb.setHex(b.ambC);
  rig.amb.color.copy(_ca).lerp(_cb, k);
  rig.base[1] = m.ambI;
  rig.amb.intensity = m.ambI * (floor + (1 - floor) * lit);

  _ca.setHex(a.fillC); _cb.setHex(b.fillC);
  rig.fill.color.copy(_ca).lerp(_cb, k);
  rig.base[2] = m.fillI;
  rig.fill.intensity = m.fillI * (floor + (1 - floor) * lit);

  if (rig.rim) {
    rig.rim.color.copy(_ca).lerp(_cb, k);
    rig.rim.intensity = m.rimI * lit;
  }

  /* THE STRIPS' COLOUR, AND ONLY WHEN NOBODY ELSE HAS IT. `StationWar.redden`
   * saves the hex it finds and puts it back when the alert ends, so the tint
   * written here is what returns. Its INTENSITY is Morning's and the dip's and
   * is never touched. */
  const war = world._stationLife?.war;
  const M = st.mats;
  _ca.setHex(a.strip); _cb.setHex(b.strip);
  _ca.lerp(_cb, k);
  if (M?.strip && (!war || war.strip0 === null || war.strip0 === undefined)) {
    if (!M.strip.emissive.equals(_ca)) M.strip.emissive.copy(_ca);
  }

  /* THE SHADOW KEY follows the shading key: same bearing, same colour, and an
   * intensity of its own so the mood can say how hard the shadow is. */
  const eng = world.engine;
  if (eng?.sun && L.engine) {
    eng.sun.color.copy(rig.key.color);
    eng.sun.intensity = m.sunI * lit;
    if (eng.sunDir) {
      const y = DECK_Y[L.deck] ?? 0;
      eng.sunDir.set(rig.key.position.x, rig.key.position.y - y, rig.key.position.z).normalize();
    }
    /* ══ AND THE WEATHER'S BASE WITH IT, OR THE WEATHER WINS ═════════════
     *
     * `Scenery.Atmosphere` takes the scene's first shadow-casting directional
     * light as its sun — which is cascade 0, the light above — snapshots its
     * colour and intensity at level build, and RE-WRITES BOTH every frame in
     * `_applyWeather`, storm or no storm. A mood written only onto the light
     * would therefore last exactly until `World.update` reached the
     * atmosphere, and the drum would be lit by whatever `applyAtmosphere` set
     * at load. So the mood goes onto the BASE as well, which is the seam
     * `fogScale` already exists for one field along: the storm goes on doing
     * its own arithmetic, on top of a key that is now the room's. */
    const atmo = world.atmosphere;
    if (atmo && atmo.sun === eng.sun) {
      atmo._sunBase = eng.sun.intensity;
      atmo._sunTint?.copy(eng.sun.color);
    }
  }

  /* THE DECALS. One write on one material a frame: the mood's tint, the
   * strips' live level (night, a surge), and the reactor's slow breath. */
  if (L.glowMat) {
    const strip = M?.strip;
    const lvl = strip && strip.userData.dip0 ? Math.min(1.4, strip.emissiveIntensity / strip.userData.dip0) : 1;
    let g = m.glow * (0.35 + 0.65 * lvl);
    if (m.pulse > 0.001) g *= 0.82 + 0.18 * Math.sin(L.clock * Math.PI * 2 * m.pulse);
    L.glowMat.opacity = Math.max(0, Math.min(1.2, 0.6 * g));
    /* The tint is the key's own colour brought most of the way to white: a
     * pool of light on the floor takes the room's colour, it does not become
     * the room's colour. */
    L.glowMat.color.setRGB(
      0.68 + 0.32 * rig.key.color.r,
      0.68 + 0.32 * rig.key.color.g,
      0.68 + 0.32 * rig.key.color.b,
    );
  }
}

/** The nearest fixtures get the pool's lights. */
function stepLamps(world, st, L, px, py, pz) {
  if (!L.lamps.length) return;
  const fx = L.fixtures;
  const reach = LAMP_REACH * LAMP_REACH;
  /* A partial selection rather than a sort: the pool is twelve and the deck
   * has hundreds of fixtures, so this is one pass with an insertion into a
   * twelve-long list — the same shape `Engine._syncLights` uses. */
  const best = L._best || (L._best = []);
  best.length = 0;
  for (let i = 0; i < fx.length; i++) {
    const f = fx[i];
    const dx = f.x - px, dy = f.y - py, dz = f.z - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > reach) continue;
    if (best.length < L.lamps.length) {
      best.push({ f, d2 });
      if (best.length === L.lamps.length) best.sort((u, w) => u.d2 - w.d2);
      continue;
    }
    if (d2 >= best[best.length - 1].d2) continue;
    best[best.length - 1] = { f, d2 };
    for (let j = best.length - 1; j > 0 && best[j].d2 < best[j - 1].d2; j--) {
      const t = best[j]; best[j] = best[j - 1]; best[j - 1] = t;
    }
  }
  if (best.length < L.lamps.length) best.sort((u, w) => u.d2 - w.d2);

  const M = st.mats;
  const strip = M?.strip;
  const lvl = strip && strip.userData.dip0 ? Math.min(1.4, strip.emissiveIntensity / strip.userData.dip0) : 1;
  const g = (L.now?.glow ?? 1) * (0.3 + 0.7 * lvl);
  const P = DECK_PALETTE[L.deck] || DECK_PALETTE[40];
  for (let i = 0; i < L.lamps.length; i++) {
    const l = L.lamps[i], b = best[i];
    if (!b) { l.intensity = 0; continue; }
    const f = b.f;
    /* The strips take the mood's tint; a screen and a status lamp keep their
     * own colour, because a red status lamp in an amber room is still red. */
    if (f.kind === 'strip' && M?.strip) l.color.copy(M.strip.emissive);
    else l.color.setHex(f.kind === 'screen' ? P.screen : P.status);
    l.position.set(f.x, f.y - 0.12, f.z);
    /* Six to eight metres: a fixture's own pool and not a room light. A wide
     * strip carries further than a status lamp, which is what `w`/`d` say. */
    l.distance = f.kind === 'status' ? 6 : Math.min(8, 6 + Math.max(f.w, f.d) * 0.2);
    l.intensity = (f.kind === 'status' ? 4.5 : f.kind === 'screen' ? 6 : 9) * g;
  }
  L.lampsOn = Math.min(best.length, L.lamps.length);
}

const _cp = new THREE.Vector3();

/** Set (or clear) the shadow pass on one thing, whatever shape it is. */
function setCast(o, on) {
  if (!o) return;
  if (o.isMesh || o.isInstancedMesh) { o.castShadow = on; return; }
  o.traverse((c) => { if (c.isMesh || c.isInstancedMesh) c.castShadow = on; });
}

/**
 * The caster sweep: the nearest `CASTERS` things that read as objects, once a
 * second.
 *
 * The FAR cut is `Enemy._applyLod`'s and stays its — it drops the shadow pass
 * off a body past its second LOD. This is the NEAR cap: forty things in a room
 * with a hundred people in it, chosen by distance, so the shadow map holds the
 * bodies at the player's own feet at 1024 rather than a crowd at four pixels
 * each.
 */
function sweepCasters(world, st, L, px, pz) {
  const prev = L.casters;
  const pick = L._pick || (L._pick = []);
  pick.length = 0;
  const reach = CAST_REACH * CAST_REACH;
  const add = (o, x, z) => {
    const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
    if (d2 > reach) return;
    pick.push({ o, d2 });
  };
  for (const e of world.enemies || []) {
    const g = e?.group;
    if (!g || e.dead) continue;
    add(g, g.position.x, g.position.z);
  }
  for (const p of world.props || []) {
    const m = p?.mesh;
    if (!m) continue;
    m.getWorldPosition(_cp);
    add(m, _cp.x, _cp.z);
  }
  pick.sort((a, b) => a.d2 - b.d2);
  if (pick.length > CASTERS) pick.length = CASTERS;
  /* Off first, on second, so a thing in both lists is never dark for a frame. */
  for (const o of prev) setCast(o, false);
  prev.length = 0;
  if (L.shadows) for (const p of pick) { setCast(p.o, true); prev.push(p.o); }
  L.casterCount = prev.length;
}

/**
 * The station's light, once a frame. One place lookup, one mood compare, and
 * the two sweeps on their own clocks.
 */
export function stepStationLight(world, st, dt) {
  const L = st?.light;
  if (!L || !(dt >= 0)) return;
  L.clock += dt;
  const p = world.player?.position;
  const px = p ? p.x : 0, py = p ? p.y : DECK_Y[L.deck] ?? 0, pz = p ? p.z : 0;

  /* WHICH ROOM'S LIGHT. `placeUnder` answers the room you are standing in, or
   * the nearest door within arm's reach of one, or null on the open ring —
   * which is the deck's own rig and is exactly right. */
  const place = placeUnder(world, px, pz);
  const id = place ? place.id : null;
  const band = bandOf(st.hour);
  if (id !== L.at || band !== L.band) {
    /* Snapshot what is on screen NOW as the thing being left, so a fade
     * interrupted halfway does not jump back to where it started. */
    L.from = Object.assign({}, L.now);
    L.to = moodFor(L.deck, place, st.hour);
    L.at = id; L.band = band; L.t = 0; L.fades++;
  } else if (L.t < 1) {
    L.t = Math.min(1, L.t + dt / FADE);
  }
  applyMood(world, st, L);

  /* The lamps five times a second: a pool that re-picks every frame flickers
   * when two fixtures are the same distance away. */
  if (L.clock - L.lampAt > 0.2) { L.lampAt = L.clock; stepLamps(world, st, L, px, py, pz); }
  if (L.clock - L.sweepAt > 1) { L.sweepAt = L.clock; sweepCasters(world, st, L, px, pz); }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE UNDRESS                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Put back everything that is not this world's.
 *
 * The decals and the lamps go down with the level; the ENGINE does not — it
 * outlives every level in the session — so the sun's colour, its intensity,
 * its bearing, the cascades' shadow flags and the map size all go back to what
 * `applyAtmosphere` last set, or the next battlefield is lit by a cantina.
 */
export function undressStationLight(world) {
  const st = world?._station;
  const L = st?.light;
  if (!L) return;
  for (const m of L.decals) { m.parent?.remove(m); m.geometry?.dispose?.(); }
  L.decals.length = 0;
  L.glowMat?.dispose?.();
  for (const l of L.lamps) { l.intensity = 0; l.parent?.remove(l); }
  L.lamps.length = 0;
  for (const o of L.casters) setCast(o, true);
  L.casters.length = 0;
  const eng = world.engine, E = L.engine;
  if (eng && E) {
    if (eng.sun && E.sunColor !== null) {
      eng.sun.color.setHex(E.sunColor); eng.sun.intensity = E.sunI;
      const atmo = world.atmosphere;
      if (atmo && atmo.sun === eng.sun) { atmo._sunBase = E.sunI; atmo._sunTint?.setHex(E.sunColor); }
    }
    if (eng.sunDir && E.dir) eng.sunDir.copy(E.dir);
    if (eng.cascades && E.cast) {
      for (let i = 0; i < eng.cascades.length; i++) {
        if (E.cast[i] !== undefined) eng.cascades[i].castShadow = E.cast[i];
      }
      if (E.map && eng.cascades[0].shadow.mapSize.x !== E.map) {
        eng.cascades[0].shadow.mapSize.set(E.map, E.map);
        eng.cascades[0].shadow.map?.dispose?.();
        eng.cascades[0].shadow.map = null;
      }
    }
  }
  /* The strips go back to the deck's own colour. The material is cached per
   * deck for the life of the process (`stationMats`), so a tint left on it
   * would be the next visit's opening frame. */
  const P = DECK_PALETTE[L.deck] || DECK_PALETTE[40];
  if (st.mats?.strip) st.mats.strip.emissive.setHex(P.strip);
  st.light = null;
}
