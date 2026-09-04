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
import { PLACES, PLACE, DECK_Y, DRUM, CORRIDOR, SHAFTS, placesOn, floorOf } from './StationPlan.js';
import { buildPlace, SHAPES } from './StationKit.js';
import { dressDeckLift, stepDeckLift, undressDeckLift, liftKey } from './DeckLift.js';
import { dressStationLife, stepStationLife, undressStationLife, dressTram } from './StationLife.js';

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

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DRUM                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/** A ring of slabs approximating an annulus: `n` segments, each a box. */
function annulus(kit, mat, y, h, r0, r1, n, opts = {}) {
  const from = opts.from ?? 0, to = opts.to ?? TAU;
  const span = to - from;
  const seg = Math.max(3, Math.round(n * (span / TAU)));
  const rMid = (r0 + r1) / 2, depth = r1 - r0;
  /* Each segment is a chord, so it is made slightly long: a box whose ends
   * meet its neighbours' on the OUTER radius leaves a wedge of gap on the
   * inner one, and a floor with gaps in it is a floor a capsule falls through. */
  const wide = 2 * rMid * Math.tan(span / seg / 2) * 1.06;
  for (let i = 0; i < seg; i++) {
    const a = from + span * ((i + 0.5) / seg);
    const x = rMid * Math.sin(a), z = rMid * Math.cos(a);
    kit.slab(mat, wide, h, depth, x, y, z, { ry: a, collide: opts.collide !== false, bevel: 0 });
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
  /* The floor: balcony lip out to the skin, in one merged annulus. */
  annulus(kit, M.deep, y - 0.3, 0.6, DRUM.atrium, DRUM.R, 72);
  /* The soffit over it — the next deck's underside, so a player on 40 looking
   * up sees a ceiling and not the sky. The top deck gets one too. */
  annulus(kit, M.dark, y + DRUM.storey + 0.4, 0.8, DRUM.atrium, DRUM.R, 48, { collide: false });
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
    if (i % 4 === 0) {
      kit.slab(M.dark, 0.9, DRUM.storey, 1.1, (DRUM.R - 0.6) * Math.sin(a), y + DRUM.storey / 2, (DRUM.R - 0.6) * Math.cos(a),
        { ry: a, collide: false, bevel: 0 });
      kit.slab(M.strip, 0.24, DRUM.storey - 1.6, 0.12, (DRUM.R - 1.15) * Math.sin(a), y + DRUM.storey / 2, (DRUM.R - 1.15) * Math.cos(a),
        { ry: a, collide: false, bevel: 0 });
    }
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
    if (type === 'transit') {
      /* DECK 40 — the imported ribbed corridor's language: a rib every two
       * bays, signage frames between them, and the lit floor channel. The
       * imported module itself stands on the spines (`buildSpine`); the ring
       * carries its ribs so the deck reads as one corridor system. */
      if (i % 2 === 0) {
        kit.slab(M.hull, wide, 0.5, DRUM.ringW, DRUM.ringR * sx, y + DRUM.storey - 0.3, DRUM.ringR * sz, { ry: a, collide: false, bevel: 0 });
        kit.slab(M.dark, 0.5, DRUM.storey, 0.6, (DRUM.ringR - DRUM.ringW / 2) * sx, y + DRUM.storey / 2, (DRUM.ringR - DRUM.ringW / 2) * sz, { ry: a, collide: false, bevel: 0 });
      }
      kit.slab(M.strip, wide * 0.9, 0.06, 0.5, DRUM.ringR * sx, y + 0.04, DRUM.ringR * sz, { ry: a, collide: false, bevel: 0 });
    } else if (type === 'promenade') {
      /* DECK 44 — a continuous window wall outboard, doors inboard, and the
       * tram guideway visible through the glass. The skin is already glass on
       * this deck; what the ring adds is the mullion rhythm and the handrail
       * you stand at to watch the tram go past. */
      kit.slab(M.dark, 0.22, DRUM.storey, 0.3, (DRUM.R - 0.9) * sx, y + DRUM.storey / 2, (DRUM.R - 0.9) * sz, { ry: a, collide: false, bevel: 0 });
      if (i % 2 === 0) {
        kit.slab(M.wing, wide * 0.92, 0.09, 0.14, (DRUM.R - 1.6) * sx, y + 1.02, (DRUM.R - 1.6) * sz, { ry: a, collide: false, bevel: 0 });
        kit.slab(M.dark, 0.1, 1.0, 0.1, (DRUM.R - 1.6) * sx, y + 0.5, (DRUM.R - 1.6) * sz, { ry: a, collide: false, bevel: 0 });
      }
    } else {
      /* DECK 48 — the service way: grating underfoot, conduit overhead, and a
       * cutaway into machinery every few bays. */
      kit.slab(M.dark, wide, 0.08, DRUM.ringW * 0.9, DRUM.ringR * sx, y + 0.34, DRUM.ringR * sz, { ry: a, collide: false, bevel: 0 });
      if (i % 3 === 0) {
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
function placeRoom(world, group, place, opts = {}) {
  const room = roomOf(place.room);
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
  /* WHICH DECK. `main.js` writes `_stationFloor` through `buildWorld`'s
   * `onWorld` before the level is built — the same door the deck's own
   * `_pickedLevel` comes through, and for the same reason: it is read by the
   * dressing, which runs after. A check with no `onWorld` says it in the
   * settings instead. */
  const deck = world._stationFloor ?? world.settings?.stationDeck ?? 40;
  const M = stationMats(deck);
  const st = {
    deck,
    /** Per-place groups, so §12.3's "places are drawn by their doors" is a
     * `.visible` flag and not a rebuild. */
    places: new Map(),
    sunk: [],
    draws: 0,
    /** Which place the arrival prompt last named. */
    promptedAt: undefined,
    tris: 0,
    solids: 0,
    /** The station clock (§3.4). One game hour per two real minutes. */
    hour: world.run?.stationHour ?? 9,
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
  const shellOut = shell.emit(world, new THREE.Vector3(0, 0, 0));
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
    if (place.room) {
      st.tris += placeRoom(world, group, place, {
        /* The Zocalo's end bulkheads come off: the hall opens onto the atrium
         * at its inner end and onto the ring at its outer, and §3.1 rule 5
         * says no room is sealed. */
        drop: place.room === 'zocalo' ? ['zoc_bulkhead'] : [],
      });
      st.solids += roomColliders(world, place, { openEnds: place.room === 'zocalo' });
      st.draws += group.children.length;
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
  const shaft = SHAFTS.find((sh) => sh.id === (world._stationShaft || 'arrivals') && sh.decks.includes(deck))
    || SHAFTS.find((sh) => sh.decks.includes(deck));
  if (shaft) {
    const r = Math.hypot(shaft.x, shaft.z) || 1;
    const k = (r + 3.2) / r;
    st.shaft = shaft;
    dressDeckLift(world, {
      arrive: true,
      at: { x: shaft.x * k, y: DECK_Y[deck], z: shaft.z * k, yaw: Math.atan2(shaft.x, shaft.z) + Math.PI },
    });
  }

  lightStation(world, deck);

  /* ── AND THE PEOPLE (§11). The pool re-seats itself round the player on the
   * first frame, so a player who arrives at the Concourse at 13:00 walks into
   * a market rather than into an empty hall. */
  dressStationLife(world, st);
  if (deck === 44) dressTram(world, st, M);

  /* ── AND SOMETHING TO THROW, from the first frame (§6 step 1). The station
   * is a sandbox and the cheapest proof of it is a crate in your hands. */
  const y = DECK_Y[deck];
  for (const [x, z] of [[3, 24], [-4, 26], [5, 30], [-6, 33], [2, 38], [-2, 42]]) {
    makeCrate(world, new THREE.Vector3(x, y + 0.5, z), 0.85);
  }
  return st;
}

/** Everything the station made, put down. `StationDirector.dispose` calls it. */
export function undressStation(world) {
  const st = world._station;
  if (!st) return;
  for (const rec of st.places.values()) {
    rec.group.parent?.remove(rec.group);
    rec.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  st.places.clear();
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
  if (liftKey(world)) return true;
  const p = world.player?.position;
  if (!p) return false;
  const place = placeUnder(world, p.x, p.z);
  if (!place || !place.verb) return false;
  /* A counter opens the panel it names; everything else answers with its own
   * verb, which is the prompt and, until its system lands, the whole of it. */
  if (place.kiosk && world.onKiosk) { world.onKiosk(place.kiosk); return true; }
  world.notify?.(place.name.toUpperCase(), place.verb);
  return true;
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

export function stepStation(world, dt) {
  const st = world._station;
  if (!st) return;
  /* The clock: one game hour per two real minutes (§3.4). Everything in
   * `StationLife` reads this and nothing else keeps time. */
  st.hour += dt / 120;
  while (st.hour >= 24) st.hour -= 24;
  if (world.run) world.run.stationHour = st.hour;

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
