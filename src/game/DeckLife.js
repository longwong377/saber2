/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE DECK, ALIVE — dense, and every one of them a body
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT THE PLAYER SAID, AND WHAT THIS FILE WAS BEFORE HE SAID IT ─────────
 *
 *   "I like the repair droids/repair stuff going on but you only have one
 *    example I want literally tons of it happening … I want countless ships,
 *    countless repairs, I see no R2 units and just one repair droid moving
 *    around, 1 fucking ship coming in and out that doesn't even have physics
 *    … all the actual repair men/workers are garbage looking stand ins …
 *    they don't even have physics … everything you can touch has to be
 *    modeled … when ships leave they disappear after crossing the force
 *    field but that shouldn't be the case I should see them leaving/getting
 *    smaller … ships were going through the side walls … countless ships and
 *    droids and workers and other shit I can throw around … way more repairs,
 *    way more droids, more people, damaged ships coming in, fresh ones going
 *    out after repairs, rows and rows of ships, PA, announcements"
 *
 * What the room had: three stationary welders, one trolley, one posed tech
 * made of eleven boxes, one sled, fourteen legless silhouettes at 60-105 m,
 * two ships of twelve primitives in one instanced mesh — one of which flew
 * from x = -144 to +144 THROUGH BOTH RACK WALLS — and `shipAway()`, which
 * scaled a hull to zero the frame it crossed the lip. That last one is the
 * vanish he saw. None of it had a body.
 *
 * ── AND THEN HE SAID IT AGAIN ─────────────────────────────────────────────
 *
 *   "the hangar itself is really good but I just want more going on, should
 *    be pretty easy for you to do like just increase the amount of troops,
 *    and repairs, and droids (love the droids btw they're all so cute)
 *    significantly, like taste wise I think you did a really good job but
 *    just fill it in more by a lot, like all by an order of magnitude
 *    increased… turn up the volume way higher."
 *
 * ── WHAT IT IS NOW ─────────────────────────────────────────────────────────
 *
 *   A HUNDRED AND ELEVEN DROIDS of nine kinds — `DeckCast.DROID_KINDS` —
 *     twenty-four astromechs in seven panel schemes that ROLL between jobs
 *     with the dome turning and the eye lit, ten tracked welders at ten
 *     seams, eleven pit droids folded at panels and sixteen up and working
 *     in gangs of four round the hulls, eighteen mouse droids scurrying in
 *     threes, ten gonks waddling, eight treadwells on their wheels, six
 *     protocol droids walking with a man each, eight load-lifters carrying
 *     crates. One `InstancedMesh` per kind on the painted surface, one for
 *     the domes, three for the welders' arm parts: fourteen draws for the
 *     lot, where fifteen droids used to be twenty-three.
 *   TWENTY WORKERS on the skeleton, walking with `Rig.BipedAnimator`, each
 *     a `Shovable` body — kept to the pit's kerb, the flanks and the
 *     centre's near end, the ground nearest the player's own path — AND A
 *     CROWD OF EIGHTY-NINE: `DeckCast.crewSilhouettes`, the same skeleton
 *     walked by the same animator and baked to bone boxes at twelve poses.
 *     A ranked formation of twenty-four on the far apron with an officer
 *     walking the front rank, a file of ten marching the room's length, a
 *     medic tent with men on the cots, a briefing circle round a
 *     holotable, twelve on the gallery thirty metres up, gangs round every
 *     hull, three two-man teams carrying crates. Walkers flip through four
 *     frames of the real walk as instances; every man who only stands is
 *     one static mesh.
 *   TWENTY-FIVE REPAIR JOBS: the section on jacks under the gantry, two
 *     fighters on cradles with their panels off, a transport and a shuttle
 *     with an engine out on a stand apiece, an engine bay with a bowser
 *     hosed to it, a fighter on a lift platform that rises and settles,
 *     three pallet stacks, four bowsers, eleven floodlights (lit faces on
 *     the shared emitter, no point fixtures), a hull being lowered on a
 *     third crane's cable, ten welding arcs throwing sparks.
 *   THREE CRANE BRIDGES on the ceiling rails, SIX LOADER SLEDS on six lanes.
 *   THE TRAFFIC: FOUR modelled hulls in and out through the aperture on
 *     cycles about half as long as they were, three parked, a shuttle
 *     TAXIING the forward centre on its repulsors with a collider that
 *     moves with it, and nine silhouettes outside drawn unfogged to 720 m.
 *   PHYSICS ON ALL OF IT that is near: every droid a `DeckCast.Knockable`,
 *     every worker a `Shovable` — 131 PROP-layer bodies, asleep at their
 *     stations, that the Force grips and throws and that get up and go back.
 *     The crowd has no bodies: past thirty metres that is the honest trade.
 *   THE PA ANNOUNCES IT: every launch, every arrival, the taxi, the company,
 *     the lift, and ten lines of the deck's own chatter between — never
 *     closer than `PA.gap` seconds.
 *
 * ── THE ROOM'S OWN RULES, ALL OF THEM ASKED RATHER THAN REMEMBERED ─────────
 *
 * `Hangar.DECK_ZONES` partitions the deck; `inZone`/`clearOf` are the only
 * way anything below decides where it may stand. Nothing crosses a rack
 * wall (|x| > `DECK.wall` - 7.5 is inside a wall's collider), nothing
 * crosses the ceiling, the corridor from the lobby to the line is empty,
 * the muster ground is empty, the transport's pad is the flight lane's, and
 * the only way in or out of the room is the aperture at z = `DECK.lip`.
 * Inside, traffic stays under 40 m: the hung fighters reach down to 82 and
 * the crane loads to about 64.
 *
 * ── COST ──────────────────────────────────────────────────────────────────
 *
 * The ink pass rasterises every opaque object twice, and `hangar.mjs`
 * bounds the WHOLE scene at 320 draws with the room itself at ~248, so
 * everything here is composed: one instanced mesh per droid kind and per
 * turning part, one per crew pose for the walkers and one static mesh for
 * every man who stands, one for the sleds, two for the silhouettes outside,
 * one for every emitter in the room, four kit bins for every static piece
 * of every job, one merged skin per worker, one mesh per parked hull.
 *
 *   before   63 meshes, 121k triangles: 15 droids, 13 men, 3 hulls
 *   after    70 meshes, 266k triangles: 111 droids, 20 men, 89 in the
 *            crowd, 7 hulls, 25 jobs — measured by `deckcost.mjs`
 *   step     `stepDeckLife` 1.0 ms a frame over 300 live frames, timed by
 *            `deckcast.mjs`; 131 bodies, 20 gaits, ~250 instances a frame
 *
 * `tools/checks/decklife.mjs` bounds the file's share and `deckcost.mjs`
 * prints it by family.
 *
 * ── THE API ───────────────────────────────────────────────────────────────
 *
 *   dressDeckLife(world)      build. Call after `dressHangar`, once.
 *   stepDeckLife(world, dt)   animate. Call every frame with the world's dt.
 *   undressDeckLife(world)    give back what was borrowed (the camera's far
 *                             plane). `World.unload` reaches it through a
 *                             sentinel in `world.statics` even if nobody
 *                             calls it.
 *
 * `stepDeckLife` allocates nothing at steady state: every vector, matrix
 * and colour is a module scratch below and every schedule is a float.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, lerp, smoothstep, TAU, makeRng } from '../engine/MathUtil.js';
import { propMaterials, mergeGeos, slabGeo, cylGeo, torusGeo } from '../world/Props.js';
import { Shovable } from '../physics/Shovable.js';
import { DECK, DECK_ZONES, clearOf } from './Hangar.js';
import { DeckBuild, deckMats, catwalk, crates } from './DeckKit.js';
import { BipedAnimator } from './Rig.js';
import { mergeFigure } from './MergedSkin.js';
import {
  castMaterials, Assembly, Knockable, DROID_KINDS, DROID_BUILDERS, ASTRO_SCHEMES, astromechDome,
  buildDeckCrew, bindPose, buildCastFighter, buildCastShuttle, farHullGeometry, crewSilhouettes, CREW_POSES,
  crewStillGeometry, foldCast,
} from './DeckCast.js';
/**
 * The sound of the traffic rides the traffic's own clocks — see `stepHull`.
 * Both constants are read inside functions, never at module scope, for the
 * import-cycle reason `frame()` documents.
 */
import { LAUNCH, ARRIVE, launchSequence, damagedArrival, repulsorPass, paCall } from './DeckAudio.js';
import { liftState } from './DeckLift.js';

/* Scratch. Sixty hertz over forty movers; a Vector3 a mover a frame is two
 * and a half thousand allocations a second for arithmetic that never leaves
 * the function. */
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/* ══════════════════════════════════════════════════════════════════════ */
/*  0 · THE FRAME — and there is not one loose metre below it             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ EVERY PLACE IN THIS FILE IS DERIVED, AND THE ZONES SAY WHAT IS FREE ══
 *
 * The first version of this file was written against a 128 m room and
 * stayed where it was when the room became 288 m: a crane on a deleted rail,
 * a welder on a deleted scaffold, three vents in a pit, fourteen invisible
 * crew. The second version derived everything from `DECK` and then sited
 * its two nearest droids in the ground the company's crowd now stands on.
 * So this one goes one further: every site is a fraction of a ZONE from
 * `Hangar.DECK_ZONES` or of the free ground BETWEEN zones, and
 * `tools/checks/deckcast.mjs` asks `clearOf` about every one of them.
 *
 * ══ AND IT IS COMPUTED ON FIRST CALL, NOT AT IMPORT ═══════════════════════
 *
 * `Hangar.js` imports this file and this file imports `DECK` from it — a
 * cycle, and a module-level `const X = DECK.lip * …` throws `Cannot access
 * 'DECK' before initialization` on whichever import order reaches the wrong
 * half first. Nothing below touches `DECK` until something asks for the
 * frame.
 */
let FRAME = null;
function frame() {
  if (FRAME) return FRAME;
  const Z = DECK_ZONES;
  /* `DECK.wall`, published — the fraction of the lip this used to be was the
   * third of four independent copies of 56. */
  const WALL = DECK.wall;
  const RUN = DECK.lip - DECK.start.z;
  const SPAN = DECK.lip - DECK.line;
  const NEAR = RUN * 0.10;
  const MID = [RUN * 0.26, RUN * 0.48];
  const fwd = (m) => DECK.start.z + m;
  const deep = (f) => DECK.line + SPAN * f;
  const across = (f) => f * WALL;
  /**
   * WHERE THE ROOM ACTUALLY STOPS. `deckColliders` closes each rack wall with
   * a box whose inboard face is 7.5 m inside `DECK.wall`; anything past
   * `CANYON` is inside a wall. `CLEAR` keeps a hull's width off it.
   */
  const CANYON = WALL - 7.5;
  const CLEAR = WALL * 0.85;

  /* ── THE FREE GROUND, as rectangles between the zones ──────────────── */
  /** The starboard work zone, the room's own. */
  const W = Z.work;
  /** Port: between the pit and the corridor, forward of the muster ground,
   *  aft of the transport's pad. The port repair job lives here. */
  const PORT = { x0: Z.pit.x1 + 1, x1: Z.padA.x1 - 1, z0: Z.muster.z1 + 2, z1: Z.padA.z0 - 2 };
  /** The flanks: between the crowd and the muster line, outboard of it. */
  const FLANK_R = { x0: Z.muster.x1 + 3, x1: CLEAR, z0: Z.crowdR.z1 + 2, z1: Z.muster.z1 - 2 };
  const FLANK_L = { x0: -CLEAR, x1: Z.muster.x0 - 3, z0: Z.crowdL.z1 + 2, z1: Z.muster.z1 - 2 };
  /** The slivers either side of the corridor, from the bulkhead to the crowd's end. */
  const SLIVER = { x: Z.corridor.x1 + 4.5, z0: DECK.aft + 8, z1: Z.crowdR.z1 };
  /** The band between the muster ground and the pit, port: three lanes run it. */
  const BAND = { x0: -CLEAR + 4, x1: PORT.x0 - 4, z0: Z.muster.z1 + 2.5, z1: Z.pit.z0 - 3 };
  /** The apron: two landing marks, and the crash station between them. */
  const APRON = {
    padL: { x: -Z.apron.x1 * 0.53, z: (Z.apron.z0 + Z.apron.z1) * 0.5 - 2 },
    padR: { x: Z.apron.x1 * 0.53, z: (Z.apron.z0 + Z.apron.z1) * 0.5 - 2 },
    /* A third mark in the starboard corner: a fighter's half-span inside
     * `CLEAR`. Pad B would be the natural third pad, but `dressStructure`
     * stands its own parked shuttle on it. */
    /* Pad B itself (Hangar.PADS.b), now that nothing static stands on it. */
    padS: { x: 44, z: 96 },
    /* A fourth mark: the apron's centre, forward of the crash station, a
     * fighter's span clear of both pads. */
    padN: { x: 0, z: Z.apron.z1 - 10 },
    crash: { x: 0, z: Z.apron.z0 + 6 },
  };

  /* ── THE REPAIR BAY: the hull section on jacks, starboard, in the work zone. */
  const BAY = { x: across(0.58), z: deep(0.12), len: 15, rad: 3.0, jack: 2.6 };
  const GANTRY = { half: BAY.len * 0.87, beamY: DECK.roof * 0.25 };
  const SCAFFOLD = {
    x: BAY.x - BAY.rad - 2.0, z: BAY.z + 1.5, lifts: [BAY.jack + 0.7, BAY.jack + 3.4], len: 9.0, wide: 2.6,
  };
  /* ── THE CRADLE: a fighter with its panels off, forward of the bay. */
  const CRADLE = { x: W.x0 + 6, z: deep(0.26), yaw: -0.35 };
  /* ── THE PORT JOB: a transport lying along z with an engine out, its
   * stand beside the empty socket, the bowser forward with a hose to the
   * flank. */
  const HULL = { x: (PORT.x0 + PORT.x1) * 0.5 + 1, z: (PORT.z0 + PORT.z1) * 0.5, len: 18, wide: 7 };
  const STAND = { x: PORT.x0 + 3, z: HULL.z - HULL.len * 0.36 };
  const BOWSER = { x: PORT.x0 + 3, z: HULL.z + HULL.len * 0.32 };
  /* ── THE FREE GROUND THE ROOM HAD AND NOTHING USED. "just fill it in more
   * by a lot": the centre strip between the transport's pad and the work
   * zone, the port half forward of the pit, the strip between the work zone
   * and pad B, and the gallery catwalks thirty metres up the walls. Every
   * one a rectangle BETWEEN zones, so `clearOf` can be asked about it. */
  /** The centre strip: from the muster ground's forward edge to the apron. */
  const CENTRE = { x0: Z.padA.x1 + 1, x1: W.x0 - 2, z0: Z.muster.z1 + 4, z1: Z.apron.z0 - 4 };
  /** Port, forward of the pit and the transport's pad: the far apron's own ground. */
  const PF = { x0: -CLEAR + 10, x1: Z.padA.x1 - 3, z0: Z.padA.z1 + 4, z1: Z.apron.z0 - 4 };
  /** Starboard, between the work zone's end and pad B. */
  const SF = { x0: W.x0 + 2, x1: CLEAR, z0: W.z1 + 2, z1: Z.padB.z0 - 2 };
  /**
   * THE GALLERY. `Hangar.dressStructure` lays a catwalk along each wall at
   * `GALLERY` = 30 m, 2.2 m inboard of the wall face (`WALL - 6`), 3 m
   * wide, 0.5 thick; its plank top is 30.25. Not published, so
   * `deckcast.mjs` fires a ray from every man on it and asks for the plank.
   */
  const GALLERY = { x: WALL - 6 - 2.2 - 0.9, y: 30.25, z: [-40, 44, 86] };
  /* ── THE NEW JOBS, each in the ground above. */
  /** A fighter on a lift platform in the work zone, rising and settling. */
  const LIFTP = { x: W.x0 + 18, z: deep(0.46), w: 12, d: 11, rise: 2.6, period: 34 };
  /** An engine out on a cradle at the work zone's forward end, its bowser beside. */
  const ENG = { x: W.x0 + 6, z: W.z1 - 10, bowser: { x: W.x0 + 12, z: W.z1 - 6 } };
  /** A shuttle with an engine out, port forward, on gear. */
  const SHUT = { x: (PF.x0 + PF.x1) * 0.5 - 4, z: PF.z0 + 54, yaw: 0, stand: { x: (PF.x0 + PF.x1) * 0.5 + 8, z: PF.z0 + 46 }, bowser: { x: PF.x0 + 8, z: PF.z0 + 62 } };
  /** A second fighter on a cradle with its panels off, centre forward. */
  const FX2 = { x: CENTRE.x0 + 20, z: CENTRE.z1 - 28, yaw: 0.4 };
  /** The medic tent, centre, and the briefing circle forward of it. */
  const TENT = { x: CENTRE.x0 + 22, z: CENTRE.z0 + 60, w: 6, d: 5, h: 3.0 };
  const RING = { x: CENTRE.x0 + 14, z: CENTRE.z0 + 94, r: 2.6 };
  /** The ranked formation on the far apron, port, and the officer's walk. */
  const FORM = { cx: (PF.x0 + PF.x1) * 0.5, cz: PF.z0 + 28, files: 6, ranks: 4, dx: 1.6, dz: 2.2 };
  /** The file that marches the room's length, between the centre and the work zone. */
  const FILE = { x: W.x0 - 10, z0: CENTRE.z0 + 4, z1: CENTRE.z1 - 8, men: 10, gap: 1.8 };
  /** The shuttle taxiing across the forward centre, aft of the apron. */
  const TAXI = { z: Z.apron.z0 - 8, x0: CENTRE.x0 - 4, x1: CENTRE.x1 - 14, speed: 1.4, hold: 9 };
  /** Pallet stacks. */
  const PALLETS = [[W.x1 - 14, W.z0 + 60, 6, 41], [CENTRE.x0 + 24, CENTRE.z0 + 82, 5, 43], [PF.x0 + 34, PF.z1 - 8, 5, 47]];
  /* ── THE OUTSIDE. How far past the lip the far leg is drawn, and the
   * three patrol loops that never come in. */
  const OUTSIDE = {
    run: 720,
    form: { cx: 0, cz: DECK.lip + 460, ax: 400, az: 240, y: 90, period: 68 },
    pair: { cx: 120, cz: DECK.lip + 380, ax: 300, az: 180, y: 150, period: 49 },
    shuttle: { cx: -80, cz: DECK.lip + 330, ax: 380, az: 110, y: 28, period: 96 },
  };
  /** The camera's far plane this room needs: the deck's length plus the outside run, plus a hull. */
  const FAR = (DECK.lip - DECK.aft) + OUTSIDE.run + 40;

  return (FRAME = {
    WALL, RUN, SPAN, NEAR, MID, CANYON, CLEAR, fwd, deep, across, Z, W, PORT, FLANK_R, FLANK_L, SLIVER, BAND,
    APRON, BAY, GANTRY, SCAFFOLD, CRADLE, HULL, STAND, BOWSER, OUTSIDE, FAR,
    CENTRE, PF, SF, GALLERY, LIFTP, ENG, SHUT, FX2, TENT, RING, FORM, FILE, TAXI, PALLETS,
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Materials — cached for the process, like propMaterials                */
/* ══════════════════════════════════════════════════════════════════════ */

let MATS = null;
function deckMaterials() {
  if (MATS) return MATS;
  const P = propMaterials();
  MATS = {
    /**
     * ONE MATERIAL FOR EVERY BURNING THING IN THE ROOM. Arcs, a torch, three
     * beacons, four engine bells, three astromech eyes: one `InstancedMesh`
     * with the HDR brightness on `instanceColor`, one draw call.
     * `MeshBasicMaterial` because a shaded emissive loses to a dark ambient.
     */
    glow: (() => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      m.userData.saberNoInk = true;
      return m;
    })(),
    haze: hazeMaterial(),
    ring: [0, 1].map(() => ringMaterial()),
    steel: P.darkSteel,
  };
  return MATS;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE EMITTERS — every burning point, one draw call                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE SLOTS ARE HANDED OUT, NOT FIXED. Ten arcs, a torch, six beacons, eight
 * engine bells, two dozen astromech eyes, a dozen floodlights, a tent lamp
 * and a holotable: every burning thing asks `glowSlot` for one while the
 * room is dressed, and the mesh's `count` is trimmed to what was asked at
 * the end. `GLOW.cap` is the geometry's capacity and a check that the room
 * has not outgrown it.
 */
const GLOW = { cap: 128 };

function addGlows(world, life) {
  const M = deckMaterials();
  const im = new THREE.InstancedMesh(cylGeo(0.5, 0.16, 1.0, 8, 0.4), M.glow, GLOW.cap);
  im.frustumCulled = false;
  im.castShadow = false; im.receiveShadow = false;
  im.renderOrder = 1;
  im.name = 'deck-glows';
  _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
  for (let i = 0; i < GLOW.cap; i++) {
    im.setMatrixAt(i, _m.compose(_v, _q, _s));
    im.setColorAt(i, _c.setRGB(0, 0, 0));
  }
  world.scene.add(im);
  world.statics.push(im);
  life.glows = im;
  life.glowN = 0;
}

/** The next `n` emitter slots; the first index. */
function glowSlot(life, n = 1) {
  const at = life.glowN;
  life.glowN += n;
  if (life.glowN > GLOW.cap) throw new Error(`DeckLife: ${life.glowN} emitters asked of a ${GLOW.cap}-slot mesh`);
  return at;
}

function glowPlace(life, slot, m4, sx, sy) {
  const im = life.glows;
  if (!im) return;
  _s.set(sx, sy, sx);
  _v.set(0, 0, 0); _q.identity();
  im.setMatrixAt(slot, _m.compose(_v, _q, _s).premultiply(m4));
  im.instanceMatrix.needsUpdate = true;
}

function glowBurn(life, slot, r, g, b) {
  const im = life.glows;
  if (!im) return;
  im.setColorAt(slot, _c.setRGB(r, g, b));
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  A merge helper for the parts that MOVE                                */
/* ══════════════════════════════════════════════════════════════════════ */

/** Bin by material, merge, hang on a parent that is allowed to move. */
class Bin {
  constructor() { this.bins = new Map(); }
  put(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (rx || ry || rz) geo.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz)));
    if (x || y || z) geo.translate(x, y, z);
    let a = this.bins.get(mat);
    if (!a) this.bins.set(mat, a = []);
    a.push(geo);
    return this;
  }
  bake(world, parent, opts = {}) {
    const out = [];
    for (const [mat, geos] of this.bins) {
      const geo = mergeGeos(geos);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = opts.receiveShadow !== false;
      parent.add(mesh);
      world.statics.push(mesh);
      out.push(mesh);
    }
    this.bins.clear();
    return out;
  }
}

/** A group that moves, registered so the level takes it away with it. */
function mover(world, parent) {
  const g = new THREE.Group();
  (parent || world.scene).add(g);
  if (!parent) world.statics.push(g);
  return g;
}

/** One vertex-coloured assembly as one mesh on a mover. */
function castMesh(world, parent, geo, mat, name) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = name || '';
  parent.add(mesh);
  world.statics.push(mesh);
  return mesh;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  1 · THE HAZE                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Extinction solved off the room — the haze may take `RIM_EATEN` of the
 * aperture rim's contrast at the distance the player is put down from it —
 * and three horizontal sheets of lit haze that pile up at the horizon. See
 * the history in git for the whole argument; the numbers are unchanged.
 */
const RIM_EATEN = 0.65;
const HAZE = {
  get density() { return Math.sqrt(-Math.log(1 - RIM_EATEN)) / (DECK.lip - DECK.start.z); },
  lifts: [0.9, 2.4, 4.2],
  weights: [0.55, 0.85, 1.0],
  peak: 0.24,
  near: 14,
};

function hazeMaterial() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x7e93ad) },
      uDensity: { value: HAZE.density * 1.15 },
      uNear: { value: HAZE.near },
      uPeak: { value: HAZE.peak },
    },
    vertexShader: /* glsl */`
      attribute float aW;
      varying vec3 vW; varying float vWeight;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz; vWeight = aW;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uDensity; uniform float uNear; uniform float uPeak;
      varying vec3 vW; varying float vWeight;
      void main() {
        float d = length(vW - cameraPosition);
        float a = 1.0 - exp(-d * d * uDensity * uDensity);
        a *= smoothstep(uNear * 0.3, uNear, d);
        gl_FragColor = vec4(uColor, a * uPeak * vWeight);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  mat.userData.saberNoInk = true;
  return mat;
}

function addDeckHaze(world, life) {
  const M = deckMaterials();
  const L = DECK.lip;
  if (world.scene.fog) {
    life.fog0 = world.scene.fog.density;
    world.scene.fog.density = HAZE.density;
    world.engine?.outline?.setHaze?.(HAZE.density);
  }
  const geos = [];
  const weights = [];
  for (let i = 0; i < HAZE.lifts.length; i++) {
    const g = new THREE.PlaneGeometry(L * 2, L * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, HAZE.lifts[i], 0);
    geos.push(g);
    for (let k = 0; k < g.attributes.position.count; k++) weights.push(HAZE.weights[i]);
  }
  const geo = mergeGeos(geos);
  geo.setAttribute('aW', new THREE.Float32BufferAttribute(weights, 1));
  const mesh = new THREE.Mesh(geo, M.haze);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.castShadow = false; mesh.receiveShadow = false;
  world.scene.add(mesh);
  world.statics.push(mesh);
  life.haze = mesh;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  2 · THE GROUND, AND THE HOLE IN IT                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE FLOOR, NOT THE HEIGHTFIELD. `Hangar.dressHangar` installs
 * `world.floorAt`, which knows the two pads stand 0.45 and 1.2 m proud of a
 * flat plate and that a parked transport's ramp is a floor; the heightfield
 * knows none of that. Everything here that stands or walks asks this.
 */
function groundAt(world, x, z) {
  if (world?.floorAt) return world.floorAt(x, z);
  return world?.terrain ? world.terrain.height(x, z) : 0;
}

/** Find the pit by sampling the plate; never be told where it is. */
function scanHoles(world) {
  const { WALL } = frame();
  const T = world.terrain;
  const H = { found: false, x0: 0, x1: 0, z0: 0, z1: 0, plate: 0 };
  if (!T) return H;
  H.plate = T.height(0, DECK.line);
  for (let x = -WALL - 24; x <= WALL + 24; x += 3) {
    for (let z = DECK.aft + 12; z <= DECK.lip - 8; z += 3) {
      if (T.height(x, z) > H.plate - 0.8) continue;
      if (!H.found) { H.found = true; H.x0 = H.x1 = x; H.z0 = H.z1 = z; }
      else {
        if (x < H.x0) H.x0 = x; if (x > H.x1) H.x1 = x;
        if (z < H.z0) H.z0 = z; if (z > H.z1) H.z1 = z;
      }
    }
  }
  return H;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  3 · THE JOBS — every static piece of every repair, one merged kit     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The hull section on jacks, the scaffold, the gantry, the fighter cradle
 * with its panels leaning against it, the transport with its engine socket
 * empty, the engine on its stand, the coolant bowser and its hose, the crash
 * cart, the astromechs' charging posts. `DeckKit.DeckBuild` bins by material
 * and emits one mesh per bin — hull, dark, strip, wing — so the whole lot is
 * four draw calls, and it is the room's own palette so a Separatist deck
 * repairs Separatist ships.
 *
 * Colliders for the things a man walks into: the section, the scaffold, the
 * gantry legs, the cradle's trestles, the transport, the stand, the bowser.
 */
function addJobs(world, life) {
  const { BAY, GANTRY, SCAFFOLD, CRADLE, HULL, STAND, BOWSER, APRON } = frame();
  const M = deckMats(world._deckFaction);
  const kit = new DeckBuild(world._deckFaction);
  const g0 = groundAt(world, BAY.x, BAY.z);
  const box = (x, y, z, hx, hy, hz, yaw = 0) => world.physics?.addStaticBox?.(
    _v.set(x, y, z).clone(), _v2.set(hx, hy, hz).clone(), new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    { friction: 0.7 });

  /* ── THE HULL SECTION ON JACKS, the scaffold and the gantry: the bay the
   * room had, unchanged. */
  const jz = BAY.len * 0.32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = BAY.x + sx * (BAY.rad - 0.6), z = BAY.z + sz * jz;
    kit.slabAt(M.hull, x, g0 + BAY.jack * 0.5, z, 0.55, BAY.jack, 0.55);
    kit.slabAt(M.dark, x, g0 + 0.16, z, 1.9, 0.32, 1.9);
    kit.slabAt(M.hull, x - sx * 0.35, g0 + BAY.jack + 0.22, z, 1.5, 0.5, 1.1, 0);
  }
  const shell = new THREE.CylinderGeometry(BAY.rad, BAY.rad, BAY.len, 12, 1, true);
  shell.rotateX(Math.PI / 2);
  kit.geoAt(M.hull, shell, BAY.x, g0 + BAY.jack + BAY.rad, BAY.z);
  for (let i = 0; i < 4; i++) {
    const r = new THREE.TorusGeometry(BAY.rad * 0.93, 0.16, 4, 14);
    r.rotateY(Math.PI / 2); r.rotateZ(Math.PI / 2);
    kit.geoAt(M.dark, r, BAY.x, g0 + BAY.jack + BAY.rad, BAY.z + (i / 3 - 0.5) * BAY.len * 0.86);
  }
  kit.slabAt(M.dark, BAY.x, g0 + BAY.jack + BAY.rad * 1.92, BAY.z, 1.1, 0.5, BAY.len * 0.8);
  kit.slabAt(M.dark, BAY.x - BAY.rad * 0.86, g0 + BAY.jack + BAY.rad * 0.78, BAY.z - 1.2, 0.35, 2.6, 3.4, 0.22);
  kit.slabAt(M.strip, BAY.x, g0 + BAY.jack - 0.12, BAY.z, 1.4, 0.14, BAY.len * 0.72);
  box(BAY.x, g0 + BAY.jack + BAY.rad, BAY.z, BAY.rad, BAY.rad + BAY.jack * 0.5, BAY.len / 2);
  const sx0 = SCAFFOLD.x, sz0 = SCAFFOLD.z;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    kit.slabAt(M.hull, sx0 + a * SCAFFOLD.wide * 0.5, g0 + SCAFFOLD.lifts[1] * 0.55,
      sz0 + b * SCAFFOLD.len * 0.5, 0.22, SCAFFOLD.lifts[1] * 1.1, 0.22);
  }
  for (const y of SCAFFOLD.lifts) catwalk(kit, sx0, g0 + y - 0.25, sz0, SCAFFOLD.len, { yaw: Math.PI / 2 });
  for (const a of [-1, 1]) {
    kit.slabAt(M.hull, sx0 + a * 0.28, g0 + (SCAFFOLD.lifts[0] + SCAFFOLD.lifts[1]) * 0.5,
      sz0 - SCAFFOLD.len * 0.44, 0.07, SCAFFOLD.lifts[1] - SCAFFOLD.lifts[0] + 0.9, 0.07);
  }
  for (let i = 0; i < 5; i++) {
    kit.slabAt(M.hull, sx0, g0 + SCAFFOLD.lifts[0] + 0.1 + i * 0.56, sz0 - SCAFFOLD.len * 0.44, 0.62, 0.06, 0.06);
  }
  box(sx0, g0 + SCAFFOLD.lifts[1] * 0.5, sz0, SCAFFOLD.wide * 0.5, SCAFFOLD.lifts[1] * 0.5, SCAFFOLD.len * 0.5);
  for (const s of [-1, 1]) {
    const lx = BAY.x + s * GANTRY.half;
    const lg = groundAt(world, lx, BAY.z);
    kit.slabAt(M.dark, lx, lg + GANTRY.beamY * 0.5, BAY.z, 1.5, GANTRY.beamY, 1.9);
    kit.slabAt(M.hull, lx, lg + 0.35, BAY.z, 3.2, 0.7, 4.0);
    for (const b of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.28, GANTRY.beamY * 0.62, 0.28);
      g.rotateX(b * 0.42);
      kit.geoAt(M.hull, g, lx, lg + GANTRY.beamY * 0.42, BAY.z + b * GANTRY.beamY * 0.13);
    }
    box(lx, lg + GANTRY.beamY * 0.5, BAY.z, 0.85, GANTRY.beamY * 0.5, 1.05);
  }
  const span = GANTRY.half * 2 + 3;
  kit.slabAt(M.hull, BAY.x, g0 + GANTRY.beamY + 0.55, BAY.z, span, 1.1, 1.7);
  kit.slabAt(M.dark, BAY.x, g0 + GANTRY.beamY - 0.1, BAY.z, span, 0.36, 0.9);
  kit.slabAt(M.strip, BAY.x, g0 + GANTRY.beamY + 1.15, BAY.z, span * 0.94, 0.14, 0.5);

  /* ── THE CRADLE. Two trestles under the fighter's wing roots, a work lamp
   * bar between them, and three hull panels leaning against the port
   * trestle — the panels are what says "off": a fighter with a panel missing
   * and no panel anywhere is a fighter that was built that way. */
  const cg = groundAt(world, CRADLE.x, CRADLE.z);
  const cy = Math.cos(CRADLE.yaw), sy = Math.sin(CRADLE.yaw);
  for (const s of [-1, 1]) {
    const tx = CRADLE.x + s * 2.4 * cy, tz = CRADLE.z - s * 2.4 * sy;
    kit.slabAt(M.dark, tx, cg + 0.6, tz, 1.2, 1.2, 4.6, CRADLE.yaw);
    kit.slabAt(M.hull, tx, cg + 1.3, tz, 1.6, 0.2, 5.0, CRADLE.yaw);
    box(tx, cg + 0.7, tz, 0.8, 0.7, 2.5, CRADLE.yaw);
  }
  kit.slabAt(M.strip, CRADLE.x, cg + 0.25, CRADLE.z, 0.3, 0.12, 6.0, CRADLE.yaw);
  for (let i = 0; i < 3; i++) {
    const px = CRADLE.x - 4.6 * cy - i * 0.35 * cy, pz = CRADLE.z + 4.6 * sy + i * 0.35 * sy;
    const g = new THREE.BoxGeometry(0.08, 2.2, 1.4);
    g.rotateZ(-0.35); g.rotateY(CRADLE.yaw);
    kit.geoAt(M.wing, g, px, cg + 1.0, pz);
  }
  /* The open panel's frame on the deck beside the starboard wing, and the
   * tool chest a man kneels at. */
  kit.slabAt(M.dark, CRADLE.x + 5.5 * cy, cg + 0.35, CRADLE.z - 5.5 * sy, 1.1, 0.7, 0.7, CRADLE.yaw);

  /* ── THE TRANSPORT WITH AN ENGINE OUT. A silhouette of the pad's own
   * craft's family — a fat body along z, two engine pods aft, the port one
   * MISSING and its socket a dark ring — on four landing pads. The engine on
   * the stand beside it is the missing pod. */
  const hg = groundAt(world, HULL.x, HULL.z);
  const body = new THREE.CylinderGeometry(HULL.wide * 0.42, HULL.wide * 0.5, HULL.len, 10);
  body.rotateX(Math.PI / 2);
  kit.geoAt(M.hull, body, HULL.x, hg + 3.6, HULL.z);
  kit.slabAt(M.wing, HULL.x, hg + 2.4, HULL.z + HULL.len * 0.42, HULL.wide * 0.6, 2.2, 3.0);
  kit.slabAt(M.dark, HULL.x, hg + 4.2, HULL.z - HULL.len * 0.36, HULL.wide * 0.9, 2.0, 3.0);
  const pod = new THREE.CylinderGeometry(1.1, 1.0, 4.6, 10);
  pod.rotateX(Math.PI / 2);
  kit.geoAt(M.dark, pod, HULL.x + HULL.wide * 0.55, hg + 2.8, HULL.z - HULL.len * 0.34);
  const sock = new THREE.TorusGeometry(1.05, 0.16, 5, 14);
  kit.geoAt(M.strip, sock, HULL.x - HULL.wide * 0.55, hg + 2.8, HULL.z - HULL.len * 0.34);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    kit.slabAt(M.dark, HULL.x + sx * HULL.wide * 0.3, hg + 0.9, HULL.z + sz * HULL.len * 0.3, 0.4, 1.8, 0.4);
    kit.slabAt(M.dark, HULL.x + sx * HULL.wide * 0.3, hg + 0.1, HULL.z + sz * HULL.len * 0.3, 1.2, 0.2, 1.2);
  }
  kit.slabAt(M.strip, HULL.x, hg + 1.6, HULL.z, 0.4, 0.14, HULL.len * 0.6);
  box(HULL.x, hg + 3.6, HULL.z, HULL.wide * 0.5, 2.0, HULL.len * 0.5);
  /* The engine on its stand: an A-frame trestle and the pod lying in it. */
  const stg = groundAt(world, STAND.x, STAND.z);
  for (const s of [-1, 1]) {
    kit.slabAt(M.dark, STAND.x, stg + 0.9, STAND.z + s * 2.0, 0.4, 1.8, 0.3);
    kit.slabAt(M.dark, STAND.x + s * 1.2, stg + 0.1, STAND.z, 0.4, 0.2, 4.8);
  }
  kit.slabAt(M.hull, STAND.x, stg + 1.7, STAND.z, 0.3, 0.3, 4.6);
  const pod2 = new THREE.CylinderGeometry(1.1, 1.0, 4.4, 10);
  pod2.rotateZ(Math.PI / 2);
  kit.geoAt(M.dark, pod2, STAND.x, stg + 2.6, STAND.z);
  const bell = new THREE.CylinderGeometry(1.15, 0.8, 0.8, 10);
  bell.rotateZ(Math.PI / 2);
  kit.geoAt(M.hull, bell, STAND.x - 2.5, stg + 2.6, STAND.z);
  box(STAND.x, stg + 1.6, STAND.z, 1.5, 1.6, 2.5);
  /* The coolant bowser: a tank on a wheeled cart with a reel, and the hose
   * to the transport's flank — a sagging tube, which is what a hose does. */
  const bg = groundAt(world, BOWSER.x, BOWSER.z);
  kit.slabAt(M.dark, BOWSER.x, bg + 0.5, BOWSER.z, 2.6, 0.3, 1.6);
  const tank = new THREE.CylinderGeometry(0.75, 0.75, 2.4, 10);
  tank.rotateZ(Math.PI / 2);
  kit.geoAt(M.hull, tank, BOWSER.x, bg + 1.4, BOWSER.z);
  kit.slabAt(M.strip, BOWSER.x + 0.9, bg + 1.4, BOWSER.z + 0.76, 0.5, 0.12, 0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wh = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10);
    wh.rotateZ(Math.PI / 2);
    kit.geoAt(M.dark, wh, BOWSER.x + sx * 1.0, bg + 0.3, BOWSER.z + sz * 0.8);
  }
  const reel = new THREE.TorusGeometry(0.5, 0.12, 6, 12);
  reel.rotateY(Math.PI / 2);
  kit.geoAt(M.dark, reel, BOWSER.x + 1.4, bg + 1.2, BOWSER.z);
  const ha = new THREE.Vector3(BOWSER.x + 1.4, bg + 1.2, BOWSER.z);
  const hb = new THREE.Vector3(HULL.x - HULL.wide * 0.48, hg + 2.6, HULL.z + HULL.len * 0.1);
  const hm = new THREE.Vector3((ha.x + hb.x) * 0.5, bg + 0.25, (ha.z + hb.z) * 0.5);
  const hose = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(ha, hm, hb), 12, 0.08, 6, false);
  kit.geoAt(M.dark, hose, 0, 0, 0);
  box(BOWSER.x, bg + 1.0, BOWSER.z, 1.3, 1.0, 0.9);

  /* ── THE CRASH STATION on the apron: a cart of bottles and a hose. */
  const kg = groundAt(world, APRON.crash.x, APRON.crash.z);
  kit.slabAt(M.dark, APRON.crash.x, kg + 0.5, APRON.crash.z - 2.5, 2.2, 0.3, 1.2);
  for (let i = 0; i < 3; i++) {
    kit.geoAt(M.hull, new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8), APRON.crash.x - 0.7 + i * 0.7, kg + 1.2, APRON.crash.z - 2.5);
  }
  kit.slabAt(M.strip, APRON.crash.x, kg + 1.9, APRON.crash.z - 2.5, 0.3, 0.3, 0.3);
  box(APRON.crash.x, kg + 0.8, APRON.crash.z - 2.5, 1.1, 0.8, 0.6);

  /* ══ THE NEW JOBS — "way more repairs", twenty-five of them now ═══════
   *
   * Every builder below is a few slabs in the same four bins, so twenty more
   * jobs is the same four draw calls. The list, so a reader can find each:
   *
   *   ENG     an engine out on a cradle at the work zone's forward end, a
   *           bowser with a hose to it, two floodlights
   *   LIFTP   a lift platform's pit rim and rails (the platform itself and
   *           the fighter on it move — `addParkedHulls`)
   *   SHUT    a shuttle with an engine out, port forward: the engine on its
   *           stand, a bowser hosed to the hull, panels off, floodlights
   *   FX2     a second fighter on trestles with its panels off, centre forward
   *   TENT    the medic tent: four posts, a roof, two cots, a lamp
   *   RING    the briefing circle's holotable
   *   PALLETS three stacks of cargo pallets
   *   GALLERY nothing built — the catwalk is the room's — but crews stand on it
   *   FLOODS  a dozen floodlight masts round the jobs, each a lit lamp head
   *           on the shared emitter and no point light (rule 4)
   */
  const { ENG, LIFTP, SHUT, FX2, TENT, RING, PALLETS } = frame();
  const floods = [];
  /** A floodlight: a mast, a tilted head, and the head's face is an emitter. */
  const flood = (x, z, yaw) => {
    const g = groundAt(world, x, z);
    kit.slabAt(M.dark, x, g + 0.12, z, 1.2, 0.24, 1.2, yaw);
    kit.geoAt(M.dark, new THREE.CylinderGeometry(0.07, 0.10, 4.2, 8), x, g + 2.2, z);
    const head = new THREE.BoxGeometry(0.7, 0.45, 0.5);
    head.rotateX(0.6); head.rotateY(yaw);
    kit.geoAt(M.hull, head, x + Math.sin(yaw) * 0.15, g + 4.4, z + Math.cos(yaw) * 0.15);
    floods.push([x, g + 4.4, z, yaw]);
  };
  /** An engine pod on an A-frame trestle. */
  const engineStand = (x, z, yaw = 0) => {
    const g = groundAt(world, x, z);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const sg of [-1, 1]) {
      kit.slabAt(M.dark, x - sn * sg * 2.0, g + 0.9, z + c * sg * 2.0, 0.4, 1.8, 0.3, yaw);
      kit.slabAt(M.dark, x + c * sg * 1.2, g + 0.1, z + sn * sg * 1.2, 0.4, 0.2, 4.8, yaw);
    }
    kit.slabAt(M.hull, x, g + 1.7, z, 0.3, 0.3, 4.6, yaw);
    const podG = new THREE.CylinderGeometry(1.1, 1.0, 4.4, 10);
    podG.rotateX(Math.PI / 2); podG.rotateY(yaw);
    kit.geoAt(M.dark, podG, x, g + 2.6, z);
    const bellG = new THREE.CylinderGeometry(1.15, 0.8, 0.8, 10);
    bellG.rotateX(Math.PI / 2); bellG.rotateY(yaw);
    kit.geoAt(M.hull, bellG, x - sn * 2.5, g + 2.6, z - c * 2.5);
    box(x, g + 1.6, z, 1.5, 1.6, 2.5, yaw);
  };
  /** A coolant bowser, and its hose sagging to a point on a hull. */
  const bowserAt = (x, z, to) => {
    const g = groundAt(world, x, z);
    kit.slabAt(M.dark, x, g + 0.5, z, 2.6, 0.3, 1.6);
    const tk = new THREE.CylinderGeometry(0.75, 0.75, 2.4, 10);
    tk.rotateZ(Math.PI / 2);
    kit.geoAt(M.hull, tk, x, g + 1.4, z);
    kit.slabAt(M.strip, x + 0.9, g + 1.4, z + 0.76, 0.5, 0.12, 0.06);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wh = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10);
      wh.rotateZ(Math.PI / 2);
      kit.geoAt(M.dark, wh, x + sx * 1.0, g + 0.3, z + sz * 0.8);
    }
    const rl = new THREE.TorusGeometry(0.5, 0.12, 6, 12);
    rl.rotateY(Math.PI / 2);
    kit.geoAt(M.dark, rl, x + 1.4, g + 1.2, z);
    const a = new THREE.Vector3(x + 1.4, g + 1.2, z);
    const b = new THREE.Vector3(to.x, to.y, to.z);
    const m = new THREE.Vector3((a.x + b.x) * 0.5, g + 0.2, (a.z + b.z) * 0.5);
    kit.geoAt(M.dark, new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 12, 0.08, 6, false), 0, 0, 0);
    box(x, g + 1.0, z, 1.3, 1.0, 0.9);
  };
  /** Hull panels leaning against something, `n` of them. */
  const panelsOff = (x, z, yaw, n) => {
    const g = groundAt(world, x, z);
    for (let i = 0; i < n; i++) {
      const pg = new THREE.BoxGeometry(0.08, 2.0, 1.3);
      pg.rotateZ(-0.35); pg.rotateY(yaw);
      kit.geoAt(M.wing, pg, x + Math.cos(yaw) * i * 0.35, g + 0.9, z - Math.sin(yaw) * i * 0.35);
    }
  };
  /** A pair of trestles under a fighter's wing roots, a lamp bar, a tool chest. */
  const cradleAt = (x, z, yaw) => {
    const g = groundAt(world, x, z);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const sg of [-1, 1]) {
      const tx = x + sg * 2.4 * c, tz = z - sg * 2.4 * sn;
      kit.slabAt(M.dark, tx, g + 0.6, tz, 1.2, 1.2, 4.6, yaw);
      kit.slabAt(M.hull, tx, g + 1.3, tz, 1.6, 0.2, 5.0, yaw);
      box(tx, g + 0.7, tz, 0.8, 0.7, 2.5, yaw);
    }
    kit.slabAt(M.strip, x, g + 0.25, z, 0.3, 0.12, 6.0, yaw);
    kit.slabAt(M.dark, x + 5.5 * c, g + 0.35, z - 5.5 * sn, 1.1, 0.7, 0.7, yaw);
    panelsOff(x - 4.6 * c, z + 4.6 * sn, yaw, 3);
  };

  /* ── ENG: the engine out on its cradle, hosed, lit. */
  engineStand(ENG.x, ENG.z, 0);
  bowserAt(ENG.bowser.x, ENG.bowser.z, { x: ENG.x + 1.1, y: groundAt(world, ENG.x, ENG.z) + 2.6, z: ENG.z + 0.5 });
  flood(ENG.x - 5, ENG.z - 5, 0.8);
  flood(ENG.x + 6, ENG.z + 5, -2.4);

  /* ── LIFTP: the platform's rim and the four corner rails. */
  {
    const g = groundAt(world, LIFTP.x, LIFTP.z);
    kit.slabAt(M.dark, LIFTP.x, g + 0.10, LIFTP.z, LIFTP.w + 1.6, 0.2, LIFTP.d + 1.6);
    kit.slabAt(M.strip, LIFTP.x, g + 0.22, LIFTP.z, LIFTP.w + 1.2, 0.06, LIFTP.d + 1.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      kit.slabAt(M.hull, LIFTP.x + sx * (LIFTP.w * 0.5 + 0.6), g + LIFTP.rise * 0.5 + 0.6, LIFTP.z + sz * (LIFTP.d * 0.5 + 0.6), 0.3, LIFTP.rise + 1.2, 0.3);
    }
    flood(LIFTP.x - LIFTP.w * 0.5 - 3, LIFTP.z + LIFTP.d * 0.5 + 3, 2.4);
    flood(LIFTP.x + LIFTP.w * 0.5 + 3, LIFTP.z - LIFTP.d * 0.5 - 3, -0.8);
  }

  /* ── SHUT: the shuttle's engine on its stand, the bowser, panels, lamps.
   * The hull itself is a cast shuttle — `addParkedHulls`. */
  engineStand(SHUT.stand.x, SHUT.stand.z, Math.PI / 2);
  bowserAt(SHUT.bowser.x, SHUT.bowser.z, { x: SHUT.x - 6.5, y: groundAt(world, SHUT.x, SHUT.z) + 2.4, z: SHUT.z - 2 });
  panelsOff(SHUT.x + 9.5, SHUT.z + 4, Math.PI / 2, 4);
  flood(SHUT.x - 11, SHUT.z - 9, 0.6);
  flood(SHUT.x + 12, SHUT.z + 8, -2.6);
  flood(SHUT.x - 12, SHUT.z + 10, 2.2);

  /* ── FX2: the second fighter's cradle. */
  cradleAt(FX2.x, FX2.z, FX2.yaw);
  flood(FX2.x - 8, FX2.z - 7, 0.9);
  flood(FX2.x + 8, FX2.z + 7, -2.3);

  /* ── THE MEDIC TENT: posts, a roof, two cots, a marker on the ridge. */
  {
    const g = groundAt(world, TENT.x, TENT.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      kit.slabAt(M.dark, TENT.x + sx * TENT.w * 0.5, g + TENT.h * 0.5, TENT.z + sz * TENT.d * 0.5, 0.14, TENT.h, 0.14);
    }
    kit.slabAt(M.wing, TENT.x, g + TENT.h + 0.06, TENT.z, TENT.w + 0.8, 0.12, TENT.d + 0.8);
    kit.slabAt(M.strip, TENT.x, g + TENT.h + 0.4, TENT.z, 0.5, 0.5, 0.12);
    for (const sx of [-1, 1]) {
      kit.slabAt(M.dark, TENT.x + sx * 1.6, g + 0.25, TENT.z - 0.4, 0.9, 0.5, 2.2);
      box(TENT.x + sx * 1.6, g + 0.25, TENT.z - 0.4, 0.45, 0.25, 1.1);
    }
    kit.slabAt(M.dark, TENT.x, g + 0.45, TENT.z - 1.8, 0.8, 0.9, 0.5);
    floods.push([TENT.x, g + TENT.h - 0.3, TENT.z, 0, 'lamp']);
  }

  /* ── THE HOLOTABLE the briefing circle stands round. */
  {
    const g = groundAt(world, RING.x, RING.z);
    kit.geoAt(M.dark, new THREE.CylinderGeometry(0.7, 0.5, 1.0, 12), RING.x, g + 0.5, RING.z);
    kit.geoAt(M.strip, new THREE.CylinderGeometry(0.72, 0.72, 0.06, 12), RING.x, g + 1.02, RING.z);
    box(RING.x, g + 0.5, RING.z, 0.7, 0.5, 0.7);
    floods.push([RING.x, g + 1.3, RING.z, 0, 'holo']);
  }

  /* ── PALLETS: the room's own crate builder, three more stacks. */
  for (const [px, pz, n, seed] of PALLETS) crates(kit, px, pz, n, seed);

  life.bay = { ground: g0, meshes: kit.build(world) };
  life.floods = floods;
}

/**
 * ══ THE PARKED HULLS — three more modelled ships that never fly ═══════════
 *
 * "two more parked hull kinds if the builders exist" — they do, so the
 * shuttle repair bay gets a cast shuttle on its gear with a socket empty,
 * the second cradle gets a cast fighter on its trestles, and the lift
 * platform gets the racks' own fighter silhouette on a slab that rises and
 * settles on a slow clock. Nine meshes; the fighter on the lift is one.
 * Each stands in a collider the size of its hull.
 */
function addParkedHulls(world, life) {
  const { SHUT, FX2, LIFTP } = frame();
  const C = castMaterials(world._deckFaction);
  const P = deckMats(world._deckFaction);
  const park = (cast, x, z, yaw, lift) => {
    foldCast(cast, C.cast);
    const g = cast.group;
    const gy = groundAt(world, x, z) + cast.gearY + lift;
    g.position.set(x, gy, z);
    g.rotation.y = yaw;
    g.visible = true;
    world.scene.add(g);
    world.statics.push(g);
    for (const m of Object.values(cast.meshes)) if (m) world.statics.push(m);
    world.physics?.addStaticBox?.(new THREE.Vector3(x, gy + 0.2, z), new THREE.Vector3(cast.half.x, cast.half.y + 0.6, cast.half.z),
      new THREE.Quaternion().setFromAxisAngle(UP, yaw), { friction: 0.6 });
    return cast;
  };
  const parked = [];
  parked.push({ site: 'shuttle-bay', cast: park(buildCastShuttle({ faction: world._deckFaction }), SHUT.x, SHUT.z, SHUT.yaw, 0) });
  parked.push({ site: 'cradle-2', cast: park(buildCastFighter({ faction: world._deckFaction }), FX2.x, FX2.z, FX2.yaw, 0.3) });
  /* THE LIFT: a slab on a mover with the silhouette fighter on it, nose to
   * the aperture — one vertex-coloured mesh, the platform and the ship. */
  const plat = mover(world);
  const g = groundAt(world, LIFTP.x, LIFTP.z);
  plat.position.set(LIFTP.x, g, LIFTP.z);
  const A = new Assembly();
  A.box(P.hull.color.getHex(), LIFTP.w, 0.5, LIFTP.d, 0, 0.25, 0);
  A.box(P.dark.color.getHex(), LIFTP.w * 0.92, 0.10, 0.5, 0, 0.55, 0);
  const fg = farHullGeometry(1, world._deckFaction);
  fg.geo.scale(1.15, 1.15, 1.15); fg.geo.translate(0, 0.5, 0);
  A.geos.push(fg.geo); A.prims += fg.prims;
  castMesh(world, plat, A.merge(), C.cast, 'deck-lift-fighter');
  parked.push({ site: 'lift', plat, t: 0 });
  life.parked = parked;
}

function stepParked(world, life, dt) {
  const { LIFTP } = frame();
  for (const P of life.parked) {
    if (!P.plat) continue;
    P.t += dt;
    /* Up for a third of the period, hold, down, hold: a lift, not a bob. */
    const k = (P.t / LIFTP.period) % 1;
    const up = k < 0.3 ? smoothstep(0, 0.3, k) : k < 0.5 ? 1 : k < 0.8 ? 1 - smoothstep(0.5, 0.8, k) : 0;
    P.plat.position.y = groundAt(world, LIFTP.x, LIFTP.z) + up * LIFTP.rise;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  4 · THE DROIDS                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A HUNDRED AND FIFTEEN DROIDS, NINE KINDS, EVERY SITE ASKED OF THE ZONES ═
 *
 * "love the droids btw they're all so cute … increase the amount … by an
 * order of magnitude". Fifteen became a hundred and fifteen, and the draw
 * calls went from twenty-three to fourteen, because everything that turns
 * is instanced now too: one mesh of domes, one of third legs, three of
 * welder arm parts, with their matrices composed from the chassis's each
 * frame.
 *
 * A row is a droid: its kind, where it stands (or the path it rolls), its
 * heading, and for a welder the seam it works. `path` is `[x, z, x, z]` and
 * a droid with one rolls it forever with a hold at each end; a droid
 * without one stands. `convoy: n` makes a mouse droid follow the row `n`
 * places before it at `gap` metres — the threes — on the leader's clock, so
 * a convoy turns about as one. `scheme` is an astromech's panel colour, an
 * index into `ASTRO_SCHEMES`.
 *
 * The two nearest are in the SLIVERS beside the corridor — the only ground
 * within thirty metres of the lift doors that is not the corridor, the
 * lobby or the crowd's — a pit droid at a bulkhead panel and three mouse
 * droids on the plate you walk out onto.
 */
let DROIDS = null;
function droidJobs() {
  if (DROIDS) return DROIDS;
  const { BAY, CRADLE, HULL, STAND, FLANK_R, FLANK_L, SLIVER, BAND, APRON, W, PORT,
    CENTRE, PF, SF, LIFTP, ENG, SHUT, FX2, TENT, RING } = frame();
  const cy = Math.cos(CRADLE.yaw), sy = Math.sin(CRADLE.yaw);
  const rows = [
    /* ═ ASTROMECHS, twenty-four in seven schemes. The three the room had: */
    { kind: 'astro', path: [CRADLE.x - 10 * cy, CRADLE.z + 10, BAY.x - BAY.rad - 8, BAY.z + 8], yaw: 0, phase: 0.2 },
    { kind: 'astro', path: [BAND.x0 + 2, BAND.z0 + 0.5, STAND.x - 7, BAND.z0 + 0.5], yaw: 0, phase: 0.6 },
    { kind: 'astro', path: [APRON.crash.x - 20, APRON.crash.z + 2, APRON.padL.x + 9, APRON.padL.z - 2], yaw: 0, phase: 0.9 },
    /* …and the rest: one to every job, and paths between them. */
    { kind: 'astro', path: [PF.x0 + 4, SHUT.z - 4, PF.x0 + 4, SHUT.z + 8], yaw: 0, phase: 0.1 },
    { kind: 'astro', path: [FX2.x - 13, FX2.z, FX2.x - 13, FX2.z - 12], yaw: 0, phase: 0.3 },
    { kind: 'astro', path: [W.x0 - 2, ENG.z - 14, W.x0 - 2, ENG.z - 6], yaw: 0, phase: 0.5 },
    { kind: 'astro', x: TENT.x + 5, z: TENT.z + 3, yaw: -Math.PI / 2, phase: 0.7 },
    { kind: 'astro', x: RING.x, z: RING.z - 3.4, yaw: 0, phase: 0.8 },
    { kind: 'astro', path: [TENT.x + 6, TENT.z + 8, TENT.x + 6, TENT.z + 16], yaw: 0, phase: 0.15 },
    { kind: 'astro', x: LIFTP.x - 9, z: LIFTP.z, yaw: Math.PI / 2, phase: 0.25 },
    { kind: 'astro', x: BAY.x + 6, z: BAY.z + 9, yaw: -Math.PI / 2, phase: 0.35 },
    { kind: 'astro', x: BAND.x1 - 4, z: BAND.z1 + 0.5, yaw: 0, phase: 0.45 },
    { kind: 'astro', path: [PF.x0 + 8, PF.z0 + 2, PF.x0 + 8, PF.z0 + 12], yaw: 0, phase: 0.55 },
    { kind: 'astro', path: [SF.x0 + 2, SF.z0 + 4, SF.x0 + 12, SF.z0 + 4], yaw: 0, phase: 0.65 },
    { kind: 'astro', x: SHUT.stand.x + 4, z: SHUT.stand.z, yaw: -Math.PI / 2, phase: 0.75 },
    { kind: 'astro', path: [CENTRE.x0 + 6, CENTRE.z0 + 2, CENTRE.x0 + 14, CENTRE.z0 + 2], yaw: 0, phase: 0.85 },
    { kind: 'astro', path: [SF.x1 - 10, SF.z0 + 6, SF.x1 - 2, SF.z0 + 6], yaw: 0, phase: 0.95 },
    { kind: 'astro', x: FX2.x - 7, z: FX2.z + 2, yaw: Math.PI / 2, phase: 0.05 },
    { kind: 'astro', path: [PF.x1 - 6, PF.z0 + 2, PF.x1 - 6, PF.z0 + 20], yaw: 0, phase: 0.12 },
    { kind: 'astro', x: FLANK_R.x1 - 3, z: FLANK_R.z1 - 4, yaw: Math.PI / 2, phase: 0.22 },
    { kind: 'astro', x: FLANK_L.x0 + 12, z: FLANK_L.z1 - 0.5, yaw: -Math.PI / 2, phase: 0.32 },
    { kind: 'astro', path: [PF.x0 + 2, PF.z1 - 4, PF.x0 + 24, PF.z1 - 4], yaw: 0, phase: 0.42 },
    { kind: 'astro', x: ENG.bowser.x + 3, z: ENG.bowser.z, yaw: -Math.PI / 2, phase: 0.52 },
    { kind: 'astro', x: SHUT.x - 10, z: SHUT.z - 2, yaw: Math.PI / 2, phase: 0.62 },
    /* ═ WELDERS, ten seams. */
    { kind: 'welder', x: BAY.x - BAY.rad - 2.4, z: BAY.z - BAY.len * 0.42, yaw: Math.PI / 2,
      sweep: 0.42, reach: 0.78, lift: 1.15, duty: 0.62, phase: 0.0 },
    { kind: 'welder', x: FLANK_R.x1 - 6, z: (FLANK_R.z0 + FLANK_R.z1) * 0.5, yaw: Math.PI / 2,
      sweep: 0.7, reach: 1.0, lift: 0.5, duty: 0.4, phase: 2.9 },
    { kind: 'welder', x: CRADLE.x - 8.5 * cy, z: CRADLE.z + 8.5 * sy + 1.5, yaw: Math.PI / 2 - CRADLE.yaw,
      sweep: 0.5, reach: 0.9, lift: 0.7, duty: 0.45, phase: 5.4 },
    { kind: 'welder', x: HULL.x + HULL.wide * 0.5 + 2.6, z: HULL.z - 2, yaw: -Math.PI / 2,
      sweep: 0.55, reach: 0.95, lift: 0.9, duty: 0.5, phase: 1.7 },
    { kind: 'welder', x: SHUT.x + 9, z: SHUT.z + 6, yaw: -Math.PI / 2, sweep: 0.5, reach: 0.9, lift: 0.8, duty: 0.5, phase: 0.9 },
    { kind: 'welder', x: FX2.x + 8, z: FX2.z, yaw: -Math.PI / 2, sweep: 0.45, reach: 0.85, lift: 0.9, duty: 0.55, phase: 3.3 },
    { kind: 'welder', x: ENG.x - 5, z: ENG.z, yaw: Math.PI / 2, sweep: 0.4, reach: 0.9, lift: 0.7, duty: 0.5, phase: 4.1 },
    { kind: 'welder', x: LIFTP.x, z: LIFTP.z + LIFTP.d * 0.5 + 3.2, yaw: Math.PI, sweep: 0.6, reach: 1.0, lift: 0.6, duty: 0.45, phase: 2.2 },
    { kind: 'welder', x: W.x1 - 3, z: W.z0 + 60, yaw: Math.PI / 2, sweep: 0.7, reach: 1.0, lift: 0.5, duty: 0.4, phase: 1.1 },
    { kind: 'welder', x: PF.x0 - 4, z: SHUT.z - 2, yaw: -Math.PI / 2, sweep: 0.7, reach: 1.0, lift: 0.5, duty: 0.4, phase: 4.7 },
    /* ═ PIT DROIDS, folded, at panels: the three the room had, and eight more. */
    { kind: 'pit', x: SLIVER.x, z: SLIVER.z0 + 1.5, yaw: Math.PI, phase: 0.3 },
    { kind: 'pit', x: CRADLE.x + 3.5 * cy + 0.6 * sy, z: CRADLE.z - 3.5 * sy - 5.0, yaw: -CRADLE.yaw + Math.PI, phase: 1.3 },
    { kind: 'pit', x: FLANK_L.x0 + 4, z: (FLANK_L.z0 + FLANK_L.z1) * 0.5, yaw: -Math.PI / 2, phase: 2.2 },
    { kind: 'pit', x: BAY.x - 8.4, z: BAY.z + 17, yaw: 0, phase: 0.6 },
    { kind: 'pit', x: CRADLE.x + 10, z: CRADLE.z + 5, yaw: Math.PI, phase: 1.1 },
    { kind: 'pit', x: ENG.x - 5, z: ENG.z + 5, yaw: Math.PI / 2, phase: 1.7 },
    { kind: 'pit', x: SHUT.x + 7, z: SHUT.z - 12, yaw: 0, phase: 2.5 },
    { kind: 'pit', x: FX2.x - 12, z: FX2.z + 6, yaw: Math.PI / 2, phase: 0.9 },
    { kind: 'pit', x: W.x1 - 14, z: W.z0 + 66, yaw: -Math.PI / 2, phase: 1.9 },
    { kind: 'pit', x: TENT.x - 4, z: TENT.z - 5.5, yaw: 0, phase: 2.8 },
    { kind: 'pit', x: PF.x0 - 2, z: PF.z0 + 32, yaw: -Math.PI / 2, phase: 0.4 },
    /* ═ PIT DROIDS, UP, in gangs of four round the four hulls under repair. */
    { kind: 'pitup', x: CRADLE.x + 5, z: CRADLE.z + 3, yaw: -Math.PI * 0.75, phase: 0.1 },
    { kind: 'pitup', x: CRADLE.x - 5, z: CRADLE.z + 4, yaw: Math.PI * 0.75, phase: 0.4 },
    { kind: 'pitup', x: CRADLE.x + 1, z: CRADLE.z - 8, yaw: 0.3, phase: 0.7 },
    { kind: 'pitup', x: CRADLE.x + 4, z: CRADLE.z - 6.5, yaw: -0.4, phase: 1.0 },
    { kind: 'pitup', x: SHUT.x + 10, z: SHUT.z - 4, yaw: -Math.PI / 2, phase: 0.2 },
    { kind: 'pitup', x: SHUT.x - 10, z: SHUT.z + 4, yaw: Math.PI / 2, phase: 0.5 },
    { kind: 'pitup', x: SHUT.x - 4, z: SHUT.z - 10, yaw: 0, phase: 0.8 },
    { kind: 'pitup', x: SHUT.x + 4, z: SHUT.z + 10, yaw: Math.PI, phase: 1.1 },
    { kind: 'pitup', x: FX2.x + 7, z: FX2.z - 4, yaw: -Math.PI / 2, phase: 0.3 },
    { kind: 'pitup', x: FX2.x + 7, z: FX2.z + 4, yaw: -Math.PI * 0.6, phase: 0.6 },
    { kind: 'pitup', x: FX2.x - 9, z: FX2.z + 6, yaw: Math.PI * 0.6, phase: 0.9 },
    { kind: 'pitup', x: FX2.x - 6, z: FX2.z - 6, yaw: 0.6, phase: 1.2 },
    { kind: 'pitup', x: HULL.x + 2, z: PORT.z1 + 0.5, yaw: Math.PI, phase: 0.15 },
    { kind: 'pitup', x: HULL.x - 4, z: PORT.z1, yaw: Math.PI * 0.8, phase: 0.45 },
    { kind: 'pitup', x: HULL.x + 4, z: PORT.z0 + 1.5, yaw: 0, phase: 0.75 },
    { kind: 'pitup', x: HULL.x - 6, z: PORT.z0 + 1, yaw: 0.3, phase: 1.05 },
    /* ═ MOUSE DROIDS, six threes: the slivers, the wall foot, the centre,
     * the far apron, the strip by pad B. */
    { kind: 'mouse', path: [SLIVER.x, SLIVER.z0 + 4, SLIVER.x, SLIVER.z1], yaw: 0, phase: 0.1 },
    { kind: 'mouse', convoy: 1, gap: 1.2 }, { kind: 'mouse', convoy: 2, gap: 1.2 },
    { kind: 'mouse', path: [-SLIVER.x, SLIVER.z1, -SLIVER.x, SLIVER.z0 + 4], yaw: 0, phase: 0.5 },
    { kind: 'mouse', convoy: 1, gap: 1.2 }, { kind: 'mouse', convoy: 2, gap: 1.2 },
    { kind: 'mouse', path: [W.x1 - 5, W.z1 + 2, W.x1 - 5, DECK_ZONES.apron.z0 - 2], yaw: 0, phase: 0.8 },
    { kind: 'mouse', convoy: 1, gap: 1.3 }, { kind: 'mouse', convoy: 2, gap: 1.3 },
    { kind: 'mouse', path: [CENTRE.x0 + 1, CENTRE.z0 + 2, CENTRE.x0 + 1, CENTRE.z0 + 66], yaw: 0, phase: 0.2 },
    { kind: 'mouse', convoy: 1, gap: 1.2 }, { kind: 'mouse', convoy: 2, gap: 1.2 },
    { kind: 'mouse', path: [PF.x1 - 4, PF.z0 + 34, PF.x0 + 2, PF.z0 + 34], yaw: 0, phase: 0.6 },
    { kind: 'mouse', convoy: 1, gap: 1.2 }, { kind: 'mouse', convoy: 2, gap: 1.2 },
    { kind: 'mouse', path: [SF.x0 + 2, SF.z1 - 1, SF.x1 - 6, SF.z1 - 1], yaw: 0, phase: 0.9 },
    { kind: 'mouse', convoy: 1, gap: 1.2 }, { kind: 'mouse', convoy: 2, gap: 1.2 },
    /* ═ GONKS, ten, waddling. */
    { kind: 'gonk', path: [FLANK_L.x0 + 10, FLANK_L.z1 - 3, FLANK_L.x0 + 10, FLANK_L.z0 + 4], yaw: 0, phase: 0.4 },
    { kind: 'gonk', path: [W.x1 - 20, W.z0 + 42, W.x1 - 20, W.z0 + 54], yaw: 0, phase: 0.7 },
    { kind: 'gonk', path: [PF.x0, PF.z0 + 40, PF.x0, PF.z0 + 62], yaw: 0, phase: 0.1 },
    { kind: 'gonk', path: [PF.x1 - 10, PF.z0 + 24, PF.x1 - 10, PF.z0 + 40], yaw: 0, phase: 0.3 },
    { kind: 'gonk', path: [SF.x0, SF.z1 - 2, SF.x0 + 14, SF.z1 - 2], yaw: 0, phase: 0.5 },
    { kind: 'gonk', path: [W.x0 + 24, W.z0 + 16, W.x0 + 24, W.z0 + 30], yaw: 0, phase: 0.6 },
    { kind: 'gonk', path: [CENTRE.x0 + 26, CENTRE.z0 + 8, CENTRE.x0 + 26, CENTRE.z0 + 24], yaw: 0, phase: 0.8 },
    { kind: 'gonk', path: [SF.x1 + 2, SF.z1 + 6, SF.x1 + 2, SF.z1 + 32], yaw: 0, phase: 0.9 },
    { kind: 'gonk', path: [PF.x0 - 8, PF.z0 + 2, PF.x0 - 8, PF.z0 + 12], yaw: 0, phase: 0.2 },
    { kind: 'gonk', path: [CENTRE.x0 + 5, CENTRE.z1 - 20, CENTRE.x0 + 5, CENTRE.z1 - 14], yaw: 0, phase: 0.35 },
    /* ═ TREADWELLS, eight, one to a job, on their wheels. */
    { kind: 'tread', path: [BAY.x - 6, BAY.z + 11, BAY.x - 2, BAY.z + 19], yaw: 0, phase: 0.1 },
    { kind: 'tread', path: [W.x0, CRADLE.z + 6, W.x0, CRADLE.z + 18], yaw: 0, phase: 0.3 },
    { kind: 'tread', path: [ENG.x - 2, ENG.z - 12, ENG.x - 2, ENG.z - 4], yaw: 0, phase: 0.5 },
    { kind: 'tread', path: [LIFTP.x + 9.5, LIFTP.z + 4, LIFTP.x + 9.5, LIFTP.z + 12], yaw: 0, phase: 0.7 },
    { kind: 'tread', path: [SHUT.x + 8, SHUT.z - 6, SHUT.x + 8, SHUT.z + 2], yaw: 0, phase: 0.9 },
    { kind: 'tread', path: [FX2.x - 9, FX2.z - 10, FX2.x - 9, FX2.z + 2], yaw: 0, phase: 0.2 },
    { kind: 'tread', path: [PORT.x1 - 1, PORT.z0 + 4, PORT.x1 - 1, PORT.z1 - 4], yaw: 0, phase: 0.4 },
    { kind: 'tread', path: [TENT.x - 8, TENT.z - 8, TENT.x - 8, TENT.z + 6], yaw: 0, phase: 0.6 },
    /* ═ PROTOCOL DROIDS, six, each walking with a man (the silhouettes'
     * table puts a walker on the same path). */
    { kind: 'proto', path: [PF.x1 - 14, PF.z0 + 2, PF.x1 - 14, PF.z0 + 18], yaw: 0, phase: 0.1 },
    { kind: 'proto', path: [CENTRE.x0 + 8, CENTRE.z0 + 50, CENTRE.x0 + 8, CENTRE.z0 + 68], yaw: 0, phase: 0.4 },
    { kind: 'proto', path: [W.x0 + 16, W.z1 - 2, W.x0 + 30, W.z1 - 2], yaw: 0, phase: 0.7 },
    { kind: 'proto', path: [PF.x0 + 8, PF.z1 - 8, PF.x0 + 28, PF.z1 - 8], yaw: 0, phase: 0.2 },
    { kind: 'proto', path: [W.x0 + 26, W.z0 + 36, W.x0 + 26, W.z0 + 54], yaw: 0, phase: 0.5 },
    { kind: 'proto', path: [CENTRE.x0 + 22, CENTRE.z0, CENTRE.x0 + 22, CENTRE.z0 + 16], yaw: 0, phase: 0.8 },
    /* ═ LOAD-LIFTERS, eight, crates out front, between the stacks and the jobs. */
    { kind: 'lifter', path: [PF.x0, PF.z0 + 8, PF.x0, PF.z0 + 18], yaw: 0, phase: 0.1 },
    { kind: 'lifter', path: [LIFTP.x - 2, LIFTP.z - 16, LIFTP.x - 2, LIFTP.z - 8], yaw: 0, phase: 0.3 },
    { kind: 'lifter', path: [PF.x1 - 10, PF.z1 - 12, PF.x1 - 10, PF.z1 - 4], yaw: 0, phase: 0.5 },
    { kind: 'lifter', path: [CENTRE.x0 + 14, CENTRE.z0 + 70, CENTRE.x0 + 14, CENTRE.z0 + 86], yaw: 0, phase: 0.7 },
    { kind: 'lifter', path: [W.x0 - 4, W.z0 + 10, W.x0 - 4, W.z0 + 22], yaw: 0, phase: 0.9 },
    { kind: 'lifter', path: [W.x1 - 6, W.z0 + 66, W.x1 - 6, W.z0 + 86], yaw: 0, phase: 0.2 },
    { kind: 'lifter', path: [PF.x0 + 6, PF.z0 + 22, PF.x0 + 6, PF.z0 + 38], yaw: 0, phase: 0.4 },
    { kind: 'lifter', path: [CENTRE.x0 + 18, CENTRE.z0 + 36, CENTRE.x0 + 18, CENTRE.z0 + 46], yaw: 0, phase: 0.6 },
  ];
  /* Resolve the convoys: a follower takes its leader's path, offset. */
  for (let i = 0; i < rows.length; i++) {
    const J = rows[i];
    if (!J.convoy) continue;
    const L = rows[i - J.convoy];
    J.path = L.path; J.yaw = L.yaw; J.phase = L.phase; J.leader = i - J.convoy;
    L.followers = Math.max(L.followers || 0, J.convoy); L.gap = J.gap;
  }
  return (DROIDS = rows);
}

/** Per-instance paint by kind: an astromech's scheme, a gang's stripe, a plate. */
const DROID_PAINT = {
  astro: ASTRO_SCHEMES,
  pitup: [0xc03a2c, 0xb8842e, 0x2f5fa8, 0x8d939b],
  tread: [0xb8842e, 0x6a7079, 0xc03a2c, 0x2e7d4f],
  proto: [0xc9a227, 0xb9bec6, 0x8a2a22, 0xc9a227, 0x6a7079],
  lifter: [0xd7a51e, 0xd06a1e],
  welder: [0x6a7079], pit: [0x9a8d6c], mouse: [0x1e2126], gonk: [0x7a4a2c],
};

/** Turret, boom and forearm: the three things on a welder that turn, as geometry. */
function welderArmGeos() {
  const at = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    if (rx || ry || rz) geo.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz)));
    if (x || y || z) geo.translate(x, y, z);
    return geo;
  };
  const turret = [
    at(cylGeo(0.30, 0.32, 0.44, 12, 0.8), 0, 0.22, 0),
    at(slabGeo(0.30, 0.26, 0.28, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.34, -0.30),
    at(slabGeo(0.11, 0.36, 0.22, { bevel: 0.025, seg: 2, tile: 1.1 }), -0.21, 0.48, 0.04),
    at(slabGeo(0.11, 0.36, 0.22, { bevel: 0.025, seg: 2, tile: 1.1 }), 0.21, 0.48, 0.04),
    at(slabGeo(0.40, 0.16, 0.22, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.58, 0.16, -0.30, 0, 0),
    at(slabGeo(0.30, 0.05, 0.05, { bevel: 0.015, seg: 1, tile: 0.6 }), 0, 0.64, 0.25, -0.30, 0, 0),
  ];
  const boom = [
    at(slabGeo(0.15, 0.92, 0.15, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.46, 0),
    at(cylGeo(0.055, 0.055, 0.62, 8, 0.6), 0.11, 0.34, -0.10, 0.22, 0, 0),
    at(cylGeo(0.085, 0.085, 0.20, 8, 0.6), 0, 0.92, 0, 0, 0, Math.PI / 2),
  ];
  const fore = [
    at(slabGeo(0.12, 0.66, 0.12, { bevel: 0.025, seg: 2, tile: 1.1 }), 0, 0.33, 0),
    at(slabGeo(0.17, 0.15, 0.17, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.70, 0),
  ];
  return { turret: mergeGeos(turret), boom: mergeGeos(boom), fore: mergeGeos(fore) };
}

/** One instanced mesh of a part, `n` of them, hidden until placed. */
function instanced(world, geo, mat, n, name, shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.frustumCulled = false;
  im.castShadow = shadow; im.receiveShadow = shadow;
  im.name = name;
  _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
  for (let i = 0; i < n; i++) im.setMatrixAt(i, _m.compose(_v, _q, _s));
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  world.scene.add(im);
  world.statics.push(im);
  return im;
}

function addDroids(world, life) {
  const M = deckMaterials();
  const C = castMaterials(world._deckFaction);
  const jobs = droidJobs();
  const byKind = new Map();
  for (const J of jobs) byKind.set(J.kind, (byKind.get(J.kind) || 0) + 1);
  /* ONE INSTANCED MESH PER KIND, on the painted surface. */
  const meshes = {};
  const next = {};
  for (const [kind, n] of byKind) {
    const built = DROID_BUILDERS[kind]();
    const im = instanced(world, built.geo, C.tint, n, `deck-droid-${kind}`);
    meshes[kind] = im;
    next[kind] = 0;
  }
  /* …AND ONE PER TURNING PART: domes, third legs, the welder's three. */
  const nAstro = byKind.get('astro') || 0, nWeld = byKind.get('welder') || 0;
  const parts = {};
  if (nAstro) parts.dome = instanced(world, astromechDome().geo, C.tint, nAstro, 'deck-astro-dome');
  if (nWeld) {
    const G = welderArmGeos();
    parts.turret = instanced(world, G.turret, M.steel, nWeld, 'deck-welder-turret');
    parts.boom = instanced(world, G.boom, M.steel, nWeld, 'deck-welder-boom');
    parts.fore = instanced(world, G.fore, M.steel, nWeld, 'deck-welder-fore');
  }
  const droids = [];
  let astro = 0, weld = 0;
  for (let r = 0; r < jobs.length; r++) {
    const J = jobs[r];
    const K = DROID_KINDS[J.kind];
    /* WHERE IT STARTS. A convoy's leader keeps `lo` of the path behind it
     * for its followers, and a follower is built `rank` gaps behind. */
    const span = J.path ? Math.hypot(J.path[2] - J.path[0], J.path[3] - J.path[1]) : 1;
    const lo = J.followers ? J.followers * J.gap / span : 0;
    const at0 = J.convoy ? droids[J.leader].at - J.convoy * J.gap / span : Math.max(J.phase, lo);
    const x = J.path ? lerp(J.path[0], J.path[2], at0) : J.x, z = J.path ? lerp(J.path[1], J.path[3], at0) : J.z;
    const y = groundAt(world, x, z);
    const yaw = J.path ? Math.atan2(J.path[2] - J.path[0], J.path[3] - J.path[1]) : J.yaw;
    const i = next[J.kind]++;
    const d = {
      kind: J.kind, job: J, i, mesh: meshes[J.kind], K,
      kn: new Knockable(world, _v.set(x, y, z), { half: K.half, mass: K.mass, facing: yaw, pace: Math.max(K.speed, 0.6) }),
      x, y, z, yaw, t: J.phase * 7, at: at0, lo, dir: 1, hold: J.phase * 3, was: false,
      tip: new THREE.Vector3(), mat: new THREE.Matrix4(), heat: 0, spark: 0, slot: -1, lean: 0,
      lead: null, rank: 0, pi: -1,
    };
    if (J.convoy) { d.lead = droids[J.leader]; d.rank = J.convoy; }
    const paint = DROID_PAINT[J.kind];
    d.color = paint[(J.scheme ?? i) % paint.length];
    d.mesh.setColorAt(i, _c.set(d.color));
    if (J.kind === 'welder') { d.pi = weld++; d.slot = glowSlot(life); }
    else if (J.kind === 'astro') {
      d.pi = astro++; d.slot = glowSlot(life);
      parts.dome.setColorAt(d.pi, _c.set(d.color));
    }
    droids.push(d);
  }
  life.droids = droids;
  life.droidMeshes = meshes;
  life.droidParts = parts;
}

const DROID_CYCLE = 5.4;

/** Write one droid's chassis instance from a place and a heading, plus a lean. */
function droidPlace(d, x, y, z, yaw, roll = 0, pitch = 0) {
  _eu.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_eu);
  _v.set(x, y, z); _s.set(1, 1, 1);
  d.mat.compose(_v, _q, _s);
  d.mesh.setMatrixAt(d.i, d.mat);
}

/** …and from the body, when the body is the one deciding. */
function droidFromBody(d) {
  const kn = d.kn;
  _v.copy(kn.at); _s.set(1, 1, 1);
  d.mat.compose(_v, kn.quaternion, _s);
  d.mesh.setMatrixAt(d.i, d.mat);
}

/** The dome, off the chassis matrix, and the eye on it. */
function astroParts(life, d, domeYaw) {
  const P = life.droidParts;
  _m4.makeRotationY(domeYaw).setPosition(0, 1.46, 0).premultiply(d.mat);
  P.dome.setMatrixAt(d.pi, _m4);
  /* The eye: on the dome, forward. */
  _mb.makeRotationX(Math.PI / 2 - 0.6).setPosition(0, 0.30, 0.46).premultiply(_m4);
  glowPlace(life, d.slot, _mb, 0.06, 0.05);
}

/** The welder's three arm parts, off the chassis matrix; the tip in world. */
function welderParts(life, d, turretYaw, boomRot, foreRot) {
  const P = life.droidParts;
  _m4.makeRotationY(turretYaw).setPosition(0, 0.76, 0).premultiply(d.mat);
  P.turret.setMatrixAt(d.pi, _m4);
  _mb.makeRotationX(boomRot).setPosition(0, 0.48, 0.04).premultiply(_m4);
  P.boom.setMatrixAt(d.pi, _mb);
  _m4.makeRotationX(foreRot).setPosition(0, 0.92, 0).premultiply(_mb);
  P.fore.setMatrixAt(d.pi, _m4);
  d.tip.set(0, 0.93, 0).applyMatrix4(_m4);
  _mb.identity().setPosition(0, 0.85, 0).premultiply(_m4);
  glowPlace(life, d.slot, _mb, 0.11, 0.16);
}

function stepDroids(world, life, dt) {
  const fx = world.particles;
  const eng = world.engine;
  const P = life.droidParts;
  for (const d of life.droids) {
    d.t += dt;
    const kn = d.kn;
    kn.update(dt);
    const J = d.job, K = d.K;
    /* ── KNOCKED OVER, GETTING UP, OR WALKING BACK: the body decides. */
    if (kn.state !== 'post') {
      droidFromBody(d);
      if (d.kind === 'welder') {
        glowBurn(life, d.slot, 0, 0, 0); d.heat = 0;
        welderParts(life, d, 0, J.lift, -J.reach);
      } else if (d.kind === 'astro') {
        /* A thrown astromech: the dome stops. */
        d.lean = lerp(d.lean, 0, 1 - Math.exp(-6 * dt));
        astroParts(life, d, 0);
        glowBurn(life, d.slot, 0.4, 0.1, 0.05);
      }
      continue;
    }
    /* ── ON ITS BASE: run the job. */
    if (J.path) {
      const span = Math.hypot(J.path[2] - J.path[0], J.path[3] - J.path[1]);
      let moving;
      if (d.lead) {
        /* A CONVOY FOLLOWER: `rank` gaps behind the leader on the path's own
         * axis, moving when it moves, stopping when it stops — the line
         * halts as a line and goes back as a line, the last in front. The
         * leader keeps `lo` of the path behind it so nobody is pushed off
         * the end onto the man in front. */
        const L = d.lead;
        d.dir = L.dir;
        d.at = L.at - (d.rank * J.gap) / span;
        moving = L.hold <= 0;
      } else {
        moving = d.hold <= 0;
        if (d.hold > 0) d.hold -= dt;
        else {
          d.at += (K.speed / span) * d.dir * dt;
          if (d.at >= 1) { d.at = 1; d.dir = -1; d.hold = 3 + (d.i * 5 + Math.floor(d.t)) % 6; }
          else if (d.at <= d.lo) { d.at = d.lo; d.dir = 1; d.hold = 3 + (d.i * 3 + Math.floor(d.t)) % 5; }
        }
      }
      const x = lerp(J.path[0], J.path[2], d.at), z = lerp(J.path[1], J.path[3], d.at);
      const y = groundAt(world, x, z);
      const yaw = Math.atan2((J.path[2] - J.path[0]) * d.dir, (J.path[3] - J.path[1]) * d.dir);
      /* THE GAIT OF EACH KIND is in its lean: a gonk rocks side to side at a
       * slow beat, a mouse droid is flat, an astromech tips back onto its
       * third leg, a treadwell wobbles on its one wheel, a protocol droid
       * walks the stiff walk, a load-lifter rolls under its crate. */
      let roll = 0, pitch = 0, bob = 0;
      if (moving) {
        if (d.kind === 'gonk') { roll = Math.sin(d.t * 5.2) * 0.09; bob = Math.abs(Math.sin(d.t * 5.2)) * 0.05; }
        else if (d.kind === 'tread') { roll = Math.sin(d.t * 3.1) * 0.03; pitch = 0.02; }
        else if (d.kind === 'proto') { roll = Math.sin(d.t * 4.4) * 0.06; bob = Math.abs(Math.sin(d.t * 4.4)) * 0.03; pitch = 0.06; }
        else if (d.kind === 'lifter') { roll = Math.sin(d.t * 2.6) * 0.05; bob = Math.abs(Math.sin(d.t * 2.6)) * 0.06; pitch = 0.03; }
      }
      if (d.kind === 'astro') { d.lean = lerp(d.lean, moving ? 1 : 0, 1 - Math.exp(-4 * dt)); pitch = lerp(0, -0.22, d.lean); }
      if (moving || d.x !== x || d.z !== z) kn.drive(x, z, yaw);
      d.x = x; d.z = z; d.yaw = yaw;
      droidPlace(d, x, y + bob, z, yaw, roll, pitch);
      if (d.kind === 'astro') {
        /* It tips back onto its third leg to roll, the dome hunts, the eye blinks. */
        astroParts(life, d, Math.sin(d.t * 0.7) * 0.9 + (moving ? 0 : Math.sin(d.t * 2.3) * 0.25));
        const blink = (Math.sin(d.t * 3.1) > 0.85 ? 0.2 : 1) * (0.8 + 0.2 * Math.sin(d.t * 11));
        glowBurn(life, d.slot, 1.6 * blink, 0.35 * blink, 0.1 * blink);
        if (moving && (d.i & 3) === (life.frame & 3)) eng?.lightUp?.(_v.set(x, y + 1.7, z), 0xff6040, 2.0, 3, 0);
      }
      continue;
    }
    /* A standing droid's chassis is written once, and again only after it has
     * been knocked over — the body says where it landed. */
    if (!d.was) { droidPlace(d, d.x, d.y, d.z, d.yaw); d.was = true; }
    if (d.kind === 'astro') {
      /* A parked astromech: dome hunting, eye lit. */
      astroParts(life, d, Math.sin(d.t * 0.7 + d.i) * 0.9);
      const blink = (Math.sin(d.t * 3.1 + d.i) > 0.85 ? 0.2 : 1);
      glowBurn(life, d.slot, 1.6 * blink, 0.35 * blink, 0.1 * blink);
      continue;
    }
    if (d.kind === 'pit') {
      /* A folded pit droid twitches: the head nods on a slow beat. */
      droidPlace(d, d.x, d.y, d.z, d.yaw, 0, Math.sin(d.t * 1.3) * 0.02);
      continue;
    }
    if (d.kind === 'pitup') {
      /* A working pit droid leans into the panel and back, and turns to look. */
      droidPlace(d, d.x, d.y, d.z, d.yaw + Math.sin(d.t * 0.9 + d.i) * 0.10, 0, 0.04 + Math.sin(d.t * 2.1 + d.i * 1.7) * 0.05);
      continue;
    }
    if (d.kind !== 'welder') continue;
    /* ── THE WELDER: a turntable that holds a bearing while the arc is lit
     * and swings when it goes out, a boom that breathes, a wrist that
     * tracks a seam. Stateless off the cycle index. */
    const ph = (d.t % DROID_CYCLE) / DROID_CYCLE;
    const welding = ph < J.duty;
    const n = Math.floor(d.t / DROID_CYCLE);
    const hold = Math.sin(n * 2.399963) * J.sweep;
    const turret = welding ? hold : lerp(hold, Math.sin((n + 1) * 2.399963) * J.sweep, smoothstep(J.duty, 1.0, ph));
    const bob = Math.sin(d.t * 0.9 + J.phase) * 0.035;
    welderParts(life, d, turret, J.lift + bob, -J.reach - bob * 1.6 + (welding ? Math.sin(d.t * 7.3) * 0.012 : 0));
    const flick = welding ? 0.55 + 0.45 * Math.sin(d.t * 41.7) * Math.sin(d.t * 17.3 + 1.1) : 0;
    d.heat = lerp(d.heat, flick, 1 - Math.exp(-18 * dt));
    const w = 0.07 + d.heat * 1.5;
    glowBurn(life, d.slot, w * 0.74, w * 0.85, w);
    if (d.heat > 0.05) eng?.lightUp?.(d.tip, 0xbcd8ff, 22 * d.heat, 11, 0);
    d.spark += dt;
    /* Ten welders: a burst every 0.2 s each, which is fifty a second across
     * the room, against the four-at-0.14 the room had. */
    if (welding && d.spark > 0.2) {
      d.spark = 0;
      _v.set(0, -1, 0);
      fx?.sparkBurst?.(d.tip, _v, 5, { speed: 5.5, color: 0xffe2b0, hdr: 3.0, flash: false, embers: false });
    }
  }
  for (const im of Object.values(life.droidMeshes)) im.instanceMatrix.needsUpdate = true;
  for (const im of Object.values(P)) im.instanceMatrix.needsUpdate = true;
  if (life.glows.instanceMatrix) life.glows.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  5 · THE GANTRY TROLLEY, AND THE TWO CRANE BRIDGES                     */
/* ══════════════════════════════════════════════════════════════════════ */

let TROLLEY = null;
function trolleyRun(world) {
  if (TROLLEY) return TROLLEY;
  const { BAY, GANTRY } = frame();
  const g0 = groundAt(world, BAY.x, BAY.z);
  return (TROLLEY = {
    z: BAY.z,
    y: g0 + GANTRY.beamY - 0.1 - 0.18 - 0.23,
    x0: BAY.x - GANTRY.half + 2.5,
    x1: BAY.x + GANTRY.half - 2.5,
    speed: 0.9, hold: 4.0,
  });
}

function addTrolley(world, life) {
  const T = trolleyRun(world);
  const M = deckMaterials();
  const body = mover(world);
  body.position.set(T.x0, T.y, T.z);
  const bb = new Bin();
  bb.put(M.steel, slabGeo(1.30, 0.46, 0.84, { bevel: 0.04, seg: 2, tile: 1.1 }), 0, 0, 0);
  for (const sx of [-1, 1]) bb.put(M.steel, cylGeo(0.13, 0.13, 0.10, 8, 0.6), sx * 0.48, 0.28, 0, Math.PI / 2, 0, 0);
  bb.put(M.steel, slabGeo(0.30, 0.10, 0.30, { bevel: 0.02, seg: 1, tile: 0.6 }), 0, -0.26, 0);
  /* The hoist and its load in the same mesh as the crab: one draw, no
   * pendulum — the ceiling cranes swing theirs, and this one is 24 m up
   * over a bay nobody stands under. */
  bb.put(M.steel, cylGeo(0.028, 0.028, 2.60, 6, 0.6), 0, -0.28 - 1.30, 0);
  bb.put(M.steel, torusGeo(0.26, 0.055, 5, 10, Math.PI * 1.5, 0.6), 0, -0.28 - 2.72, 0, Math.PI / 2, 0, 0.4);
  bb.put(M.steel, slabGeo(1.10, 0.80, 0.90, { bevel: 0.05, seg: 2, tile: 1.1 }), 0, -0.28 - 3.35, 0);
  bb.put(M.steel, slabGeo(1.16, 0.08, 0.96, { bevel: 0.02, seg: 1, tile: 0.6 }), 0, -0.28 - 3.72, 0);
  bb.bake(world, body);
  life.trolley = { run: T, body, hoist: null, t: 0, at: 0, dir: 1, swing: 0, swingV: 0, hold: 0, vel: 0 };
}

/** A crab on a rail: translate, and the load lags into the start and overshoots the stop. */
function stepCrab(T, R, dt, axis) {
  const span = R.x1 - R.x0;
  const prev = T.at;
  if (T.hold > 0) T.hold -= dt;
  else {
    T.at += (R.speed / span) * T.dir * dt;
    if (T.at >= 1) { T.at = 1; T.dir = -1; T.hold = R.hold; }
    else if (T.at <= 0) { T.at = 0; T.dir = 1; T.hold = R.hold; }
  }
  T.body.position[axis] = R.x0 + span * T.at;
  const vel = (T.at - prev) * span / Math.max(dt, 1e-4);
  const drive = (vel - (T.vel || 0)) / Math.max(dt, 1e-4);
  T.vel = vel;
  T.swingV += (-9.4 * T.swing - clamp(drive, -18, 18) * 0.055) * dt;
  T.swingV *= Math.exp(-0.9 * dt);
  T.swing += T.swingV * dt;
  /* The pendulum swings along the travel: rotate about the OTHER axis. */
  if (!T.hoist) return;
  if (axis === 'x') T.hoist.rotation.z = clamp(T.swing, -0.25, 0.25);
  else T.hoist.rotation.x = clamp(-T.swing, -0.25, 0.25);
}

function stepTrolley(life, dt) {
  const T = life.trolley;
  if (!T) return;
  stepCrab(T, T.run, dt, 'x');
}

/**
 * ══ TWO BRIDGES ON THE CEILING RAILS ══════════════════════════════════════
 *
 * `Hangar.ceilingAt` lays two crane rails the length of the room at x = ±36,
 * y = `DECK.roof` - 7, "the bridges that ride them are DeckLife's and move".
 * They are, now: a crab under each rail with a cable down to a load twenty
 * metres below it — a hull plate on the port rail, an engine on the
 * starboard — running the room at 1.2 m/s with a long dwell at each end.
 *
 * The rail's own numbers, read once: the hull slab sits at roof - 7 and is
 * 1.2 thick, so its underside is roof - 7.6 and the crab hangs from that.
 * The load rides at about y 64, over the tops of the hung fighters (82) and
 * inboard of the overhead rigs at ±49.6 — and clear of the aperture's
 * traffic, which stays under 40 m.
 */
let CRANES = null;
function craneRuns() {
  if (CRANES) return CRANES;
  const { WALL } = frame();
  /* `Hangar.ceilingAt` lays the rails at x = ±36 under a roof of 96, and
   * publishes neither: 36 is 0.45 of the wall's 80, written that way so a
   * wider room carries its rails out with it, and `deckcast.mjs` fires a
   * ray from each crab to make sure the rail is actually over it. */
  const railX = WALL * 0.45, railY = DECK.roof - 7.0 - 0.6;
  const z0 = DECK.aft + 26, z1 = DECK.lip - 26;
  /* THREE CRABS ON TWO RAILS. The starboard rail is shared: the engine's
   * crab keeps to its forward half and the hull's to the aft half, so the
   * two cannot meet. The hull's crab LOWERS its load — the cable pays out
   * `lower` metres over `period` seconds and winds back — which is "a hull
   * being lowered by a crane". */
  const zm = (z0 + z1) * 0.5;
  return (CRANES = [
    { x: -railX, y: railY - 0.7, x0: z0, x1: z1, speed: 1.2, hold: 18, drop: 22, load: 'plate', phase: 0.15 },
    { x: railX, y: railY - 0.7, x0: z1, x1: zm + 8, speed: 1.05, hold: 24, drop: 26, load: 'engine', phase: 0.7 },
    { x: railX, y: railY - 0.7, x0: z0, x1: zm - 8, speed: 0.8, hold: 30, drop: 24, load: 'hull', phase: 0.4, lower: 16, period: 52 },
  ]);
}

function addCranes(world, life) {
  const C = castMaterials(world._deckFaction);
  const P = deckMats(world._deckFaction);
  const hull = P.hull.color.getHex(), dark = P.dark.color.getHex(), wing = P.wing.color.getHex();
  const cranes = [];
  for (const R of craneRuns()) {
    const body = mover(world);
    body.position.set(R.x, R.y, R.x0 + (R.x1 - R.x0) * R.phase);
    const A = new Assembly();
    /* The crab: a box across the rail, four flanged wheels up on it, a
     * winch drum, a cab, a status lamp. */
    A.box(dark, 3.2, 1.2, 4.4, 0, 0, 0);
    A.pair((s) => { A.cyl(0x8d939b, 0.32, 0.32, 0.3, s * 0.9, 0.75, 1.6, 0, 0, Math.PI / 2, 10); A.cyl(0x8d939b, 0.32, 0.32, 0.3, s * 0.9, 0.75, -1.6, 0, 0, Math.PI / 2, 10); });
    A.cyl(0x6a7079, 0.55, 0.55, 2.0, 0, -0.9, 0, 0, 0, Math.PI / 2, 12);
    A.box(hull, 1.4, 1.0, 1.6, 1.6, -1.0, -1.0);
    A.box(0xc03a2c, 0.3, 0.3, 0.3, 0, 0.75, 0);
    A.box(0xb8842e, 3.3, 0.12, 0.2, 0, -0.62, 2.15);
    A.box(0xb8842e, 3.3, 0.12, 0.2, 0, -0.62, -2.15);
    /* The hull crane's winch block rides the crab: its cable and load are
     * movers below, so nothing on the fixed part need swing. */
    if (R.load === 'hull') A.box(dark, 1.6, 0.5, 0.6, 0, -1.5, 0);
    /* THE PLATE AND THE ENGINE hang rigid from their crabs — one mesh each,
     * no pendulum, at 88 m up; the hull crane's load is the one that
     * moves on its cable and keeps a hoist of its own. */
    const hoist = R.load === 'hull' ? mover(world, body) : null;
    if (hoist) hoist.position.set(0, -1.3, 0);
    const H = R.load === 'hull' ? new Assembly() : A;
    const hy = R.load === 'hull' ? 0 : -1.3;
    if (R.load !== 'hull') {
      H.cyl(0x6a7079, 0.05, 0.05, R.drop, 0.5, hy - R.drop / 2, 0, 0, 0, 0, 6);
      H.cyl(0x6a7079, 0.05, 0.05, R.drop, -0.5, hy - R.drop / 2, 0, 0, 0, 0, 6);
      H.box(dark, 2.0, 0.6, 0.6, 0, hy - R.drop - 0.2, 0);
      H.ring(0x8d939b, 0.4, 0.08, 0, hy - R.drop - 0.8, 0, 0, Math.PI / 2, 0, 10);
    }
    if (R.load === 'hull') { /* nothing on the fixed part — see the crab */ }
    else if (R.load === 'plate') {
      /* A hull plate in slings: a big bevelled slab with a rib and a row of
       * fixing holes along one edge. */
      H.box(wing, 6.0, 0.35, 4.0, 0, hy - R.drop - 2.4, 0);
      H.box(dark, 6.0, 0.2, 0.4, 0, hy - R.drop - 2.1, 1.6);
      for (let i = 0; i < 6; i++) H.box(dark, 0.2, 0.4, 0.2, -2.5 + i, hy - R.drop - 2.4, -1.7);
      H.pair((s) => H.cyl(0x6a7079, 0.04, 0.04, 2.0, s * 2.6, hy - R.drop - 1.5, 0, 0, 0, s * 0.9, 5));
    } else {
      /* An engine: a pod with a bell and three collars, hung by its lugs. */
      H.cyl(dark, 1.2, 1.1, 5.0, 0, hy - R.drop - 3.0, 0, 0, 0, Math.PI / 2, 12);
      H.cyl(0x1a1d22, 1.25, 0.9, 0.9, -2.9, hy - R.drop - 3.0, 0, 0, 0, Math.PI / 2, 12);
      for (let i = 0; i < 3; i++) H.ring(0x8d939b, 1.22, 0.08, -1.5 + i * 1.5, hy - R.drop - 3.0, 0, 0, Math.PI / 2, 0, 14);
      H.pair((s) => H.cyl(0x6a7079, 0.04, 0.04, 1.6, s * 1.4, hy - R.drop - 1.5, 0, 0, 0, s * 0.6, 5));
    }
    const crane = { run: R, body, hoist, at: R.phase, dir: 1, hold: 0, swing: 0, swingV: 0, vel: 0, t: R.phase * 20, cable: null, load: null };
    if (R.load === 'hull') {
      /* THE HULL IN SLINGS: the racks' own fighter silhouette under a
       * spreader, one mesh, on a cable that is its own mesh so it can be
       * paid out — scaled in y — while the load rides at the cable's end. */
      H.geos = [];
      const cable = new Assembly();
      cable.cyl(0x6a7079, 0.05, 0.05, 1.0, 0.5, -0.5, 0, 0, 0, 0, 6);
      cable.cyl(0x6a7079, 0.05, 0.05, 1.0, -0.5, -0.5, 0, 0, 0, 0, 6);
      crane.cable = castMesh(world, hoist, cable.merge(), C.cast, 'deck-crane-cable');
      crane.cable.scale.y = R.drop;
      const load = mover(world, hoist);
      load.position.set(0, -R.drop, 0);
      const L = new Assembly();
      L.box(dark, 4.0, 0.4, 0.6, 0, -0.2, 0);
      L.pair((s) => L.cyl(0x6a7079, 0.04, 0.04, 2.6, s * 1.8, -1.6, 0, 0, 0, s * 0.5, 5));
      const fg = farHullGeometry(2, world._deckFaction);
      fg.geo.translate(0, -3.6, 0);
      L.geos.push(fg.geo); L.prims += fg.prims;
      castMesh(world, load, L.merge(), C.cast, 'deck-crane-hull');
      crane.load = load;
    }
    castMesh(world, body, A.merge(), C.cast, 'deck-crane');
    cranes.push(crane);
  }
  life.cranes = cranes;
}

function stepCranes(life, dt) {
  for (const T of life.cranes) {
    stepCrab(T, T.run, dt, 'z');
    if (!T.load) continue;
    /* The hull's cable pays out while the crab dwells, and winds in before it moves. */
    T.t += dt;
    const R = T.run;
    const k = (T.t / R.period) % 1;
    const out = k < 0.35 ? smoothstep(0, 0.35, k) : k < 0.55 ? 1 : k < 0.9 ? 1 - smoothstep(0.55, 0.9, k) : 0;
    const drop = R.drop + R.lower * out;
    T.cable.scale.y = drop;
    T.load.position.y = -drop;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  6 · THE LOADER SLEDS                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Three repulsor sleds, three lanes: the starboard wall foot the length of
 * the work zone, the mid-deck lane across the work zone's forward end, and
 * the port band between the muster ground and the pit. One `InstancedMesh`.
 */
let SLEDS = null;
function sledRuns() {
  if (SLEDS) return SLEDS;
  const { across, deep, W, BAND } = frame();
  const { PF, CENTRE, SF } = frame();
  return (SLEDS = [
    { z: deep(0.33), x0: across(-0.05), x1: across(0.76), along: 'x', speed: 4.0, hold: 3.5, ride: 0.42, phase: 0.0 },
    { x: W.x1 - 10, z0: W.z0 + 2, z1: W.z1 - 4, along: 'z', speed: 3.6, hold: 4.5, ride: 0.42, phase: 0.5 },
    { z: BAND.z0 + 4.5, x0: BAND.x0, x1: BAND.x1, along: 'x', speed: 3.2, hold: 5.0, ride: 0.42, phase: 0.8 },
    /* Three more: across the far apron's ground, the centre's length, the strip by pad B. */
    { z: PF.z0 + 8, x0: PF.x0 + 2, x1: PF.x1 - 2, along: 'x', speed: 3.4, hold: 4.0, ride: 0.42, phase: 0.3 },
    { x: CENTRE.x0 + 1, z0: CENTRE.z0 + 70, z1: CENTRE.z1 - 12, along: 'z', speed: 3.8, hold: 5.5, ride: 0.42, phase: 0.6 },
    { z: SF.z0 + 2, x0: SF.x0, x1: SF.x1 + 2, along: 'x', speed: 3.0, hold: 4.0, ride: 0.42, phase: 0.9 },
  ]);
}

function addSleds(world, life) {
  const C = castMaterials(world._deckFaction);
  const A = new Assembly();
  A.box(0x6a7079, 3.40, 0.34, 1.90, 0, 0.30, 0);
  A.box(0x6a7079, 0.90, 0.46, 1.30, -1.50, 0.68, 0);
  A.box(0x1e2126, 0.7, 0.3, 1.0, -1.50, 1.0, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) A.cyl(0x1e2126, 0.30, 0.24, 0.16, sx * 1.30, 0.10, sz * 0.72, 0, 0, 0, 10);
  A.box(0xb8842e, 3.44, 0.06, 0.12, 0, 0.49, 0.95);
  A.box(0xb8842e, 3.44, 0.06, 0.12, 0, 0.49, -0.95);
  A.box(0x8a7048, 1.50, 1.20, 1.30, 0.55, 1.07, 0);
  A.box(0x4a3a26, 1.56, 0.10, 1.36, 0.55, 1.62, 0);
  A.box(0x4a3a26, 0.12, 1.22, 1.34, 0.55, 1.07, 0);
  const runs = sledRuns();
  const im = new THREE.InstancedMesh(A.merge(), C.cast, runs.length);
  im.frustumCulled = false;
  im.castShadow = true; im.receiveShadow = true;
  im.name = 'deck-sleds';
  world.scene.add(im);
  world.statics.push(im);
  life.sleds = { mesh: im, runs, slot: glowSlot(life, runs.length),
    state: runs.map((R) => ({ at: R.phase, dir: 1, hold: 1.2 + R.phase * 3, t: R.phase * 9, gy: undefined })) };
}

function stepSleds(world, life, dt) {
  const S = life.sleds;
  if (!S) return;
  for (let i = 0; i < S.runs.length; i++) {
    const R = S.runs[i], s = S.state[i];
    s.t += dt;
    const a0 = R.along === 'x' ? R.x0 : R.z0, a1 = R.along === 'x' ? R.x1 : R.z1;
    const span = a1 - a0;
    if (s.hold > 0) s.hold -= dt;
    else {
      s.at += (R.speed / Math.abs(span)) * s.dir * dt;
      if (s.at >= 1) { s.at = 1; s.dir = -1; s.hold = R.hold; }
      else if (s.at <= 0) { s.at = 0; s.dir = 1; s.hold = R.hold; }
    }
    const p = a0 + span * s.at;
    const x = R.along === 'x' ? p : R.x, z = R.along === 'x' ? R.z : p;
    /* A repulsor holds an altitude over the PLATE, not over the pit. */
    const gy = Math.max(groundAt(world, x, z), life.holes.plate);
    s.gy = s.gy === undefined ? gy : lerp(s.gy, gy, 1 - Math.exp(-2.2 * dt));
    const y = s.gy + R.ride + Math.sin(s.t * 1.7) * 0.045;
    const dir = s.dir * Math.sign(span);
    const yaw = R.along === 'x' ? (dir > 0 ? Math.PI : 0) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    _eu.set(0, yaw, (s.hold > 0 ? 0 : -0.035) + Math.sin(s.t * 1.1) * 0.012, 'YXZ');
    _q.setFromEuler(_eu);
    _v.set(x, y, z); _s.set(1, 1, 1);
    S.mesh.setMatrixAt(i, _m4.compose(_v, _q, _s));
    /* The beacon on the cab, an instance of the shared emitter. */
    _mb.identity().setPosition(-1.50, 1.20, 0).premultiply(_m4);
    glowPlace(life, S.slot + i, _mb, 0.20, 0.20);
    const bl = 0.55 + 0.45 * Math.sin(s.t * 3.1);
    glowBurn(life, S.slot + i, 1.5 * bl, 0.72 * bl, 0.18 * bl);
    if ((i & 1) === (life.frame & 1)) world.engine?.lightUp?.(_v.set(x, y + 0.9, z), 0xffa838, 6, 8, 0);
  }
  S.mesh.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  7 · THE WORKERS                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ TWENTY MEN, EVERY ONE A BODY, ALL OF THEM NEAR THE PLAYER'S GROUND ═══
 *
 * A row is a man and his job:
 *
 *   torch   on the scaffold's upper lift, welding the section's flank
 *   kneel   crouched at a panel, hands on it
 *   hose    standing, both hands on a hose at the waist
 *   stand   standing at a job, hands on it at chest height
 *   watch   standing, one hand up, looking at a crane
 *   walk    a loop between two points, with a pause at each end
 *   crash   at the crash station; runs to a damaged landing, walks back
 *
 * "Within sixty metres" is measured from the MUSTER LINE'S centre, where the
 * player stands to look at his men: the zone table leaves nothing free
 * within sixty metres of the lift doors but the corridor and the crowd's
 * ground, so that is the honest ruler and `deckcast.mjs` uses it.
 */
let WORKERS = null;
function workerJobs(world) {
  if (WORKERS) return WORKERS;
  const { BAY, SCAFFOLD, CRADLE, HULL, STAND, BOWSER, FLANK_R, FLANK_L, BAND, APRON, CENTRE, Z } = frame();
  const cy = Math.cos(CRADLE.yaw), sy = Math.sin(CRADLE.yaw);
  const g0 = groundAt(world, SCAFFOLD.x, SCAFFOLD.z);
  return (WORKERS = [
    { job: 'torch', x: SCAFFOLD.x, z: SCAFFOLD.z + 0.8, y: g0 + SCAFFOLD.lifts[1], yaw: Math.PI / 2 },
    { job: 'kneel', x: BAY.x + BAY.rad + 1.1, z: BAY.z + 3.5, yaw: -Math.PI / 2 },
    { job: 'walk', path: [BAY.x - BAY.rad - 1.5, BAY.z + BAY.len * 0.55 + 2, CRADLE.x - 2 * cy, CRADLE.z - 8.5] },
    { job: 'kneel', x: CRADLE.x - 4.2 * cy, z: CRADLE.z + 4.2 * sy - 1.2, yaw: Math.PI / 2 - CRADLE.yaw },
    { job: 'watch', x: FLANK_R.x0 + 3, z: FLANK_R.z1 - 3, yaw: -Math.PI / 2 },
    { job: 'stand', x: FLANK_R.x1 - 9, z: (FLANK_R.z0 + FLANK_R.z1) * 0.5 + 3, yaw: Math.PI / 2 },
    /* Built at the port job's end of the band, which is inside sixty metres
     * of the line; the far end of his walk is not. */
    { job: 'walk', path: [BAND.x1, BAND.z1 - 1, BAND.x0 + 2, BAND.z1 - 1] },
    { job: 'hose', x: BOWSER.x + 2.2, z: BOWSER.z + 2.0, yaw: Math.atan2(HULL.x - BOWSER.x - 2.2, HULL.z - BOWSER.z - 2.0) },
    { job: 'hose', x: HULL.x - HULL.wide * 0.5 - 1.6, z: HULL.z + HULL.len * 0.1, yaw: Math.PI / 2 },
    { job: 'stand', x: STAND.x + 2.4, z: STAND.z + 1.8, yaw: Math.atan2(STAND.x - STAND.x - 2.4, STAND.z - STAND.z - 1.8) },
    { job: 'kneel', x: FLANK_L.x0 + 2.6, z: FLANK_L.z0 + 6, yaw: -Math.PI / 2 },
    { job: 'crash', x: APRON.crash.x - 3, z: APRON.crash.z, yaw: 0 },
    { job: 'crash', x: APRON.crash.x + 3, z: APRON.crash.z, yaw: 0 },
    /* SEVEN MORE, all on the pit's kerb and the centre's near end — the
     * ground nearest the player's own path, which is where a real gait and
     * a body that can be shoved are worth their 7,000 triangles. The far
     * crowd is `silJobs`. */
    { job: 'kneel', x: Z.pit.x1 + 2, z: Z.pit.z0 + 6, yaw: -Math.PI / 2 },
    { job: 'stand', x: Z.pit.x1 + 2, z: Z.pit.z0 + 10, yaw: -Math.PI / 2 },
    { job: 'kneel', x: (Z.pit.x0 + Z.pit.x1) * 0.5 - 6, z: Z.pit.z0 - 2, yaw: 0 },
    { job: 'watch', x: Z.pit.x0 + 4, z: Z.pit.z0 - 2.5, yaw: 0.3 },
    { job: 'kneel', x: Z.pit.x0 + 8, z: Z.pit.z1 + 2.5, yaw: Math.PI },
    { job: 'watch', x: Z.pit.x0 + 3, z: Z.pit.z1 + 4, yaw: Math.PI - 0.3 },
    { job: 'walk', path: [CENTRE.x0 + 20, CENTRE.z0 + 2, CENTRE.x1 - 2, CENTRE.z0 + 2] },
  ]);
}

function addWorkers(world, life) {
  const rng = makeRng(7717);
  const jobs = workerJobs(world);
  const workers = [];
  for (let i = 0; i < jobs.length; i++) {
    const J = jobs[i];
    const fig = buildDeckCrew({ faction: world._deckFaction, tone: i % 2, scale: 0.97 + rng() * 0.06 });
    world.scene.add(fig.root);
    world.statics.push(fig.root);
    const x = J.path ? J.path[0] : J.x, z = J.path ? J.path[1] : J.z;
    const y = J.y ?? groundAt(world, x, z);
    const yaw = J.path ? Math.atan2(J.path[2] - J.path[0], J.path[3] - J.path[1]) : J.yaw;
    /* HIS BODY, at his station. Built directly rather than through
     * `makeShovable` so the scaffold man's mark can be the PLANK and not the
     * deck under it. */
    const shove = new Shovable(world, _v.set(x, y, z), { facing: yaw });
    const anim = new BipedAnimator(fig.rig, { scale: fig.rig.scale, hipHeight: 0.95 });
    anim.setFacing(yaw);
    const w = {
      i, job: J, fig, rig: fig.rig, root: fig.root, anim, shove, yaw, x, z, y,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), prev: new THREE.Vector3(x, y, z),
      at: rng(), dir: rng() < 0.5 ? -1 : 1, hold: rng() * 4, speed: 1.15 + rng() * 0.5, t: rng() * 6,
      run: false, target: null, wasDown: false, slot: J.job === 'torch' ? glowSlot(life) : -1,
      merged: mergeFigure({ rig: fig.rig, root: fig.root, palette: null }, { castShadow: true }),
      /* The animator's argument bag, allocated ONCE. `Enemy._pose` builds a
       * literal a frame; at thirteen men that is eight hundred objects a
       * second for nothing. */
      p: null,
    };
    w.p = {
      position: w.pos, facing: yaw, velocity: w.vel, grounded: true,
      groundAt: (px, pz) => (J.y != null ? J.y : groundAt(world, px, pz)),
      crouch: 0, accelForward: 0, deferMatrices: false,
    };
    workers.push(w);
  }
  life.workers = workers;
}

/** Pose one arm's hand to a world point, elbow poled outboard. */
function reach(rig, side, target, yaw, out) {
  const s = side === 'L' ? 1 : -1;
  /* The pole: outboard of the shoulder and a little back, in the man's frame. */
  _v3.set(s * 0.6, -0.1, -0.25).applyAxisAngle(UP, yaw).add(target);
  rig.solveIK('arm' + side, 'fore' + side, target, _v3);
}

const WALK = 1.35, SPRINT = 3.1;

function stepWorkers(world, life, dt) {
  const W = life.workers;
  if (!W) return;
  const fx = world.particles;
  for (const w of W) {
    const sh = w.shove;
    const J = w.job;
    w.t += dt;
    sh.update(dt);
    /* ── ON THE DECK: the body decides, the figure follows it rigidly. */
    if (sh.down) {
      if (!w.wasDown) { bindPose(w.rig); w.wasDown = true; }
      w.root.position.copy(sh.at);
      w.root.quaternion.copy(sh.quaternion);
      w.merged.update(life.t);
      continue;
    }
    if (w.wasDown) {
      /* Back on his feet: the root goes home to the origin and the gait
       * takes over from where the body is, feet re-planted there. */
      w.wasDown = false;
      w.root.position.set(0, 0, 0);
      w.root.quaternion.identity();
      w.anim.initialised = false;
      w.prev.copy(sh.at);
    }
    /* ── WHERE HE IS AND WHERE HE IS GOING. */
    let crouch = 0;
    if (sh.state !== 'post') {
      /* Rising or walking back: the body's position is the truth. */
      w.pos.copy(sh.at);
      w.yaw = sh.facing;
    } else if (J.path || w.run || w.target) {
      /* A walker, or a crash man running out or walking home. */
      let ax, az, bx, bz, spd;
      if (w.run || w.target) {
        ax = J.x; az = J.z; bx = w.target.x; bz = w.target.z;
        spd = w.run ? SPRINT : WALK;
        const span = Math.hypot(bx - ax, bz - az);
        const want = w.run ? 1 : 0;
        if (w.at !== want) w.at = clamp(w.at + (spd / span) * (want > w.at ? 1 : -1) * dt, 0, 1);
        if (!w.run && w.at === 0) w.target = null;
      } else {
        ax = J.path[0]; az = J.path[1]; bx = J.path[2]; bz = J.path[3];
        spd = w.speed;
        const span = Math.hypot(bx - ax, bz - az);
        if (w.hold > 0) w.hold -= dt;
        else {
          w.at += (spd / span) * w.dir * dt;
          if (w.at >= 1) { w.at = 1; w.dir = -1; w.hold = 2 + ((w.i * 7 + Math.floor(w.t)) % 5); }
          else if (w.at <= 0) { w.at = 0; w.dir = 1; w.hold = 2 + ((w.i * 3 + Math.floor(w.t)) % 6); }
        }
      }
      const x = lerp(ax, bx, w.at), z = lerp(az, bz, w.at);
      w.pos.set(x, groundAt(world, x, z), z);
      const dx = w.pos.x - w.prev.x, dz = w.pos.z - w.prev.z;
      if (dx * dx + dz * dz > 1e-8) w.yaw = Math.atan2(dx, dz);
      else if (w.target && !w.run) w.yaw = J.yaw;
      /* The body walks with him. `retarget` puts a posted body on its new
       * mark, asleep, and is what `Hangar.stepCompany` does for a dismissed
       * man. */
      sh.retarget(w.pos);
    } else {
      w.pos.set(w.x, w.y, w.z);
      w.yaw = J.yaw;
      if (J.job === 'kneel') crouch = 1;
    }
    /* ── THE GAIT. Velocity from the displacement, world-space, into the
     * same solver every enemy walks with. */
    w.vel.set((w.pos.x - w.prev.x) / Math.max(dt, 1e-4), 0, (w.pos.z - w.prev.z) / Math.max(dt, 1e-4));
    if (w.vel.lengthSq() > 100) w.vel.set(0, 0, 0);          // a teleport is not a sprint
    w.prev.copy(w.pos);
    const speed = w.vel.length();
    const p = w.p;
    p.facing = w.yaw; p.crouch = crouch;
    p.accelForward = clamp(speed / 5, 0, 1);
    w.anim.setFacing(w.yaw);
    /**
     * A MAN STANDING STILL IS SOLVED AT A THIRD OF THE RATE, staggered by
     * his index — `Enemy._pose`'s own argument: the biped solve is the cost,
     * a body that is not moving its feet does not need it sixty times a
     * second, and the animator integrates its own clock off the `dt` it is
     * handed so three frames arriving as one advance the idle by exactly
     * what three would. A walker is solved every frame. Measured: 0.70 ms a
     * frame for thirteen men at full rate, 0.34 with the standing ones at a
     * third.
     */
    w.lag = (w.lag || 0) + dt;
    const due = speed > 0.05 || sh.state !== 'post' || ((life.frame + w.i) % 3 === 0);
    if (due) { w.anim.update(w.lag, p); w.lag = 0; }
    /* ── THE ARMS. Walking: they swing. Working: they reach for the work. */
    const fwdX = Math.sin(w.yaw), fwdZ = Math.cos(w.yaw);
    const rig = w.rig;
    if (!due) { w.merged.update(life.t); continue; }
    if (speed > 0.3 || sh.state !== 'post') {
      w.anim.swingArms(dt, speed, 1);
    } else if (J.job === 'kneel') {
      _v.set(w.pos.x + fwdX * 0.55, w.pos.y + 0.72, w.pos.z + fwdZ * 0.55);
      reach(rig, 'R', _v, w.yaw);
      _v2.set(w.pos.x + fwdX * 0.5 - fwdZ * 0.22, w.pos.y + 0.66, w.pos.z + fwdZ * 0.5 + fwdX * 0.22);
      reach(rig, 'L', _v2, w.yaw);
    } else if (J.job === 'hose') {
      _v.set(w.pos.x + fwdX * 0.42 - fwdZ * 0.12, w.pos.y + 0.98, w.pos.z + fwdZ * 0.42 + fwdX * 0.12);
      reach(rig, 'R', _v, w.yaw);
      _v2.set(w.pos.x + fwdX * 0.55 + fwdZ * 0.12, w.pos.y + 1.02, w.pos.z + fwdZ * 0.55 - fwdX * 0.12);
      reach(rig, 'L', _v2, w.yaw);
    } else if (J.job === 'stand') {
      const b = Math.sin(w.t * 1.7) * 0.05;
      _v.set(w.pos.x + fwdX * 0.5, w.pos.y + 1.25 + b, w.pos.z + fwdZ * 0.5);
      reach(rig, 'R', _v, w.yaw);
      _v2.set(w.pos.x + fwdX * 0.45 + fwdZ * 0.25, w.pos.y + 1.15, w.pos.z + fwdZ * 0.45 - fwdX * 0.25);
      reach(rig, 'L', _v2, w.yaw);
    } else if (J.job === 'watch') {
      _v.set(w.pos.x + fwdX * 0.18 - fwdZ * 0.1, w.pos.y + 1.66, w.pos.z + fwdZ * 0.18 + fwdX * 0.1);
      reach(rig, 'R', _v, w.yaw);
      w.anim.swingArms(dt, 0, 1);
      /* He follows the crane: yaw drifts with the port bridge's position. */
    } else if (J.job === 'torch') {
      _v.set(w.pos.x + fwdX * 0.62, w.pos.y + 1.36 + Math.sin(w.t * 0.8) * 0.06, w.pos.z + fwdZ * 0.62 + Math.sin(w.t * 0.5) * 0.15);
      reach(rig, 'R', _v, w.yaw);
      _v2.set(w.pos.x + fwdX * 0.30 + fwdZ * 0.2, w.pos.y + 1.30, w.pos.z + fwdZ * 0.30 - fwdX * 0.2);
      reach(rig, 'L', _v2, w.yaw);
      stepTorch(world, life, w, dt);
    } else {
      w.anim.swingArms(dt, 0, 1);
    }
    w.merged.update(life.t);
  }
  void fx;
}

/**
 * THE TORCH, in the scaffold man's right hand: an instance of the shared
 * emitter, on a schedule that is mostly OFF — a bead for 2.8 s, a stop for
 * 4.6, and the strike at the front of each bead is a single lobe eight
 * times the running brightness.
 */
function stepTorch(world, life, w, dt) {
  const cyc = w.t % 7.4;
  const on = cyc < 2.8;
  const strike = on && cyc < 0.09;
  const flick = on ? 0.5 + 0.5 * Math.sin(w.t * 37.1) * Math.sin(w.t * 13.7 + 0.6) : 0;
  w.heat = lerp(w.heat || 0, flick, 1 - Math.exp(-22 * dt));
  const fwdX = Math.sin(w.yaw), fwdZ = Math.cos(w.yaw);
  _v.set(w.pos.x + fwdX * 0.85, w.pos.y + 1.36, w.pos.z + fwdZ * 0.85);
  _m4.makeRotationFromEuler(_eu.set(Math.PI / 2, w.yaw, 0, 'YXZ')).setPosition(_v);
  glowPlace(life, w.slot, _m4, 0.07, 0.20);
  const b = 0.08 + w.heat * 1.6 + (strike ? 3.4 : 0);
  glowBurn(life, w.slot, b * 0.84, b * 0.92, b);
  const fx = world.particles;
  if (w.heat > 0.05) {
    _v2.set(w.pos.x + fwdX * 1.05, w.pos.y + 1.36, w.pos.z + fwdZ * 1.05);
    world.engine?.lightUp?.(_v2, 0xcfe6ff, 30 * w.heat + (strike ? 60 : 0), 16, 0);
    w.spark = (w.spark || 0) + dt;
    if (w.spark > 0.11) {
      w.spark = 0;
      _v3.set(-fwdX * 0.3, -0.9, -fwdZ * 0.3).normalize();
      fx?.sparkBurst?.(_v2, _v3, 7, { speed: 7.5, color: 0xfff0c8, hdr: 3.4, flash: false, embers: false });
    }
  }
  if (strike) fx?.cutFlare?.(_v2, null, 0xbcd8ff, 10, { scorch: false, cover: false });
}

/**
 * Two crash men leave the station for the pad, and come back when it
 * clears. With four hulls cycling twice as often, the recall is keyed to
 * the hull that sent them: another hull spinning up while they are still
 * running to the one that landed hard does not call them home.
 */
function callCrashCrew(life, H, x, z, out) {
  if (out) life.crashFor = H;
  else if (life.crashFor !== H) return;
  else life.crashFor = null;
  for (const w of life.workers) {
    if (w.job.job !== 'crash') continue;
    if (out) {
      if (!w.target) w.target = { x: 0, z: 0 };
      w.target.x = x + (w.i % 2 ? 6 : -6); w.target.z = z - 7;
      w.run = true;
    } else w.run = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  7b · THE CROWD — eighty men past thirty metres, fifteen draw calls    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE MEN WHO ARE NOT BODIES ════════════════════════════════════════════
 *
 * "increase the amount of troops … by an order of magnitude". Twenty men
 * on the skeleton is what the gait solver and the physics can afford at
 * sixty hertz; the other eighty are `DeckCast.crewSilhouettes` — the same
 * skeleton walked by the same animator, baked at fifteen poses — placed
 * as instances. A man here is a matrix, a suit tone and a pose; a walker
 * flips through the six walk frames at the real cadence. Nothing here has
 * a body: the Force passes through them, which at thirty metres and more
 * from the player's ground is the honest trade, and every one of them is
 * `clearOf` the ground the player, the company and the traffic use.
 *
 * A row: `pose` (a still), or `walk`/`carry` with a `path`; `rest` is the
 * still a walker wears at the ends of his path. `convoy`/`gap` as the
 * droids: the file marches on its leader's clock.
 */
let SILS = null;
function silJobs() {
  if (SILS) return SILS;
  const { FORM, FILE, TENT, RING, GALLERY, CRADLE, SHUT, FX2, HULL, LIFTP, PF, CENTRE, W, SF } = frame();
  const rows = [];
  /* THE FORMATION on the far apron: ranks facing aft, an officer walking
   * the front rank with his arm up. */
  for (let r = 0; r < FORM.ranks; r++) {
    for (let f = 0; f < FORM.files; f++) {
      rows.push({ pose: 'stand', x: FORM.cx + (f - (FORM.files - 1) * 0.5) * FORM.dx, z: FORM.cz + (r - (FORM.ranks - 1) * 0.5) * FORM.dz, yaw: Math.PI, tone: 1 });
    }
  }
  rows.push({ walk: true, rest: 'stand', path: [FORM.cx - 9, FORM.cz - 7, FORM.cx + 9, FORM.cz - 7], tone: 2, speed: 0.9 });
  /* THE FILE marching the room's length: ten men on the leader's clock. */
  rows.push({ walk: true, rest: 'stand', path: [FILE.x, FILE.z0, FILE.x, FILE.z1], tone: 1, speed: 1.3 });
  for (let i = 1; i < FILE.men; i++) rows.push({ walk: true, rest: 'stand', convoy: i, gap: FILE.gap, tone: 1 });
  /* THE MEDIC TENT: two sitting on the cots, a medic over one, one kneeling. */
  rows.push({ pose: 'sit', x: TENT.x - 1.6, z: TENT.z - 0.9, yaw: 0, tone: 0, lift: 0 });
  rows.push({ pose: 'sit', x: TENT.x + 1.6, z: TENT.z - 0.9, yaw: 0, tone: 1, lift: 0 });
  rows.push({ pose: 'stand', x: TENT.x - 1.6, z: TENT.z + 1.4, yaw: Math.PI, tone: 3 });
  rows.push({ pose: 'kneel', x: TENT.x + 1.6, z: TENT.z + 1.6, yaw: Math.PI, tone: 3 });
  rows.push({ pose: 'stand', x: TENT.x + 4.2, z: TENT.z - 3.5, yaw: -1.2, tone: 0 });
  /* THE BRIEFING CIRCLE: seven round the holotable, one gap for the droid. */
  for (let k = 0; k < 8; k++) {
    if (k === 4) continue;
    const a = k * Math.PI / 4;
    rows.push({ pose: k === 0 ? 'point' : 'stand', x: RING.x + Math.sin(a) * RING.r, z: RING.z + Math.cos(a) * RING.r, yaw: a + Math.PI, tone: k % 3 });
  }
  /* THE GALLERY: pairs at the rail thirty metres up, both walls. */
  for (const sgn of [-1, 1]) {
    for (const z of GALLERY.z) {
      rows.push({ pose: 'lean', x: sgn * GALLERY.x, z: z - 0.9, yaw: sgn * Math.PI / 2, tone: 0, y: GALLERY.y });
      rows.push({ pose: 'stand', x: sgn * GALLERY.x, z: z + 0.9, yaw: -sgn * Math.PI / 2, tone: 1, y: GALLERY.y });
    }
  }
  /* GANGS round the hulls under repair. */
  const cy = Math.cos(CRADLE.yaw), sy = Math.sin(CRADLE.yaw);
  rows.push({ pose: 'kneel', x: CRADLE.x + 6.5 * cy, z: CRADLE.z - 6.5 * sy + 1.4, yaw: -Math.PI / 2 - CRADLE.yaw, tone: 0 });
  rows.push({ pose: 'stand', x: CRADLE.x - 1, z: CRADLE.z + 8.5, yaw: Math.PI, tone: 1 });
  rows.push({ pose: 'point', x: CRADLE.x + 2, z: CRADLE.z + 9.5, yaw: Math.PI + 0.4, tone: 2 });
  rows.push({ pose: 'kneel', x: SHUT.x - 7.5, z: SHUT.z + 8, yaw: Math.PI / 2, tone: 0 });
  rows.push({ pose: 'stand', x: SHUT.x - 9, z: SHUT.z - 6, yaw: Math.PI / 2, tone: 1 });
  rows.push({ pose: 'stand', x: SHUT.x + 10, z: SHUT.z + 2, yaw: -Math.PI / 2 + 0.3, tone: 2 });
  rows.push({ pose: 'point', x: SHUT.x + 11, z: SHUT.z - 1, yaw: -Math.PI / 2, tone: 0 });
  rows.push({ pose: 'kneel', x: FX2.x + 5.5, z: FX2.z + 7, yaw: -Math.PI * 0.8, tone: 1 });
  rows.push({ pose: 'stand', x: FX2.x - 3, z: FX2.z + 9, yaw: Math.PI, tone: 0 });
  rows.push({ pose: 'stand', x: FX2.x - 1, z: FX2.z - 9, yaw: 0.2, tone: 2 });
  rows.push({ pose: 'stand', x: HULL.x + 6, z: HULL.z + 4, yaw: -Math.PI / 2, tone: 1 });
  rows.push({ pose: 'kneel', x: HULL.x + 6, z: HULL.z - 6, yaw: -Math.PI / 2, tone: 0 });
  rows.push({ pose: 'stand', x: LIFTP.x - LIFTP.w * 0.5 - 4, z: LIFTP.z - 4, yaw: Math.PI / 2, tone: 2 });
  rows.push({ pose: 'point', x: LIFTP.x + LIFTP.w * 0.5 + 3, z: LIFTP.z - 2, yaw: -Math.PI / 2, tone: 1 });
  /* TWO-MAN TEAMS carrying a crate between them: the second is the first's convoy. */
  const team = (path, tone) => { rows.push({ carry: true, rest: 'carry0', path, tone, speed: 1.0 }); rows.push({ carry: true, rest: 'carry0', convoy: 1, gap: 1.5, tone }); };
  team([PF.x1 - 1, PF.z0 + 2, PF.x1 - 1, PF.z1 - 16], 0);
  team([W.x0 - 5, SF.z0 - 2, W.x0 - 5, SF.z1 + 24], 1);
  team([W.x1 - 12, W.z0 + 58, W.x1 - 12, W.z1 - 4], 2);
  /* WALKERS: a man with each protocol droid (the droids' own paths), and
   * a few on errands. */
  const { PF: pf, CENTRE: ce } = frame();
  for (const J of droidJobs()) if (J.kind === 'proto') rows.push({ walk: true, rest: 'stand', path: J.path, tone: 2, speed: 1.1, phase: 0.5 });
  rows.push({ walk: true, rest: 'stand', path: [ce.x0 + 12, ce.z0 + 20, ce.x0 + 12, ce.z0 + 44], tone: 0, speed: 1.2 });
  rows.push({ walk: true, rest: 'stand', path: [W.x0 + 4, CRADLE.z + 22, W.x0 + 4, W.z1 - 16], tone: 1, speed: 1.15 });
  rows.push({ walk: true, rest: 'stand', path: [pf.x0 + 6, pf.z0 + 2, pf.x0 + 6, pf.z0 + 18], tone: 2, speed: 1.25 });
  rows.push({ walk: true, rest: 'stand', path: [ce.x0 + 26, ce.z1 - 14, ce.x0 + 2, ce.z1 - 14], tone: 0, speed: 1.05 });
  for (let i = 0; i < rows.length; i++) {
    const J = rows[i];
    if (!J.convoy) continue;
    const L = rows[i - J.convoy];
    J.path = L.path; J.speed = L.speed; J.leader = i - J.convoy;
    L.followers = Math.max(L.followers || 0, J.convoy); L.gap = J.gap;
  }
  return (SILS = rows);
}

/** Suit tones, by `tone`: the two jumpsuits, a tan, and the medics' white. */
const SIL_TONES = [0x5a5f4c, 0x4a4e5e, 0x7a6a4c, 0xcfd2cc];

function addSilhouettes(world, life) {
  const C = castMaterials(world._deckFaction);
  const jobs = silJobs();
  const n = jobs.length;
  const built = crewSilhouettes();
  /* Every pose mesh can hold every man, but `count` is only the men IN
   * that pose: a slot is taken when a man enters a pose and freed when he
   * leaves it (`silShow`), so the eighty men cost eighty instances across
   * the fifteen meshes, not fifteen times eighty. */
  /* …and only the WALKERS are instanced: the five walk frames, the three
   * carrying, and `stand` for a walker at the end of his path. Every man
   * who only stands is baked, tone and all, into ONE static mesh below —
   * `hangar.mjs` bounds the whole scene at 320 draws and this is where a
   * crowd of eighty-nine fits under it. */
  const meshes = {};
  const walkers = jobs.filter((J) => J.path).length;
  for (const name of [...CREW_POSES.walk, ...CREW_POSES.carry, 'stand']) {
    const im = instanced(world, built[name].geo, C.tint, Math.max(1, walkers), `deck-crew-${name}`, false);
    im.count = 0;
    im.userData.free = []; im.userData.top = 0;
    meshes[name] = im;
  }
  const stills = [];
  const sils = [];
  for (let i = 0; i < n; i++) {
    const J = jobs[i];
    const span = J.path ? Math.hypot(J.path[2] - J.path[0], J.path[3] - J.path[1]) : 1;
    const lo = J.followers ? J.followers * J.gap / span : 0;
    const at0 = J.convoy ? sils[J.leader].at - J.convoy * J.gap / span : Math.max(J.phase ?? (i * 0.37) % 1, lo);
    const x = J.path ? lerp(J.path[0], J.path[2], at0) : J.x, z = J.path ? lerp(J.path[1], J.path[3], at0) : J.z;
    const y = J.y ?? groundAt(world, x, z);
    const yaw = J.path ? Math.atan2(J.path[2] - J.path[0], J.path[3] - J.path[1]) : J.yaw;
    const S = {
      i, job: J, x, y, z, yaw, pos: new THREE.Vector3(x, y, z), at: at0, lo,
      dir: 1, hold: J.convoy ? 0 : (i % 5), t: (i * 1.7) % 6, frames: J.walk ? CREW_POSES.walk : J.carry ? CREW_POSES.carry : null,
      pose: J.pose || J.rest, shown: null, slot: -1, lead: null, rank: 0, moving: false,
    };
    if (J.convoy) { S.lead = sils[J.leader]; S.rank = J.convoy; }
    S.tone = SIL_TONES[J.tone % SIL_TONES.length];
    if (!J.path) {
      _q.setFromAxisAngle(UP, yaw); _v.set(x, y, z); _s.set(1, 1, 1);
      stills.push(crewStillGeometry(built[J.pose], _m.compose(_v, _q, _s), S.tone));
      S.shown = 'still';
    }
    sils.push(S);
  }
  if (stills.length) {
    const still = new THREE.Mesh(mergeGeos(stills), C.cast);
    still.name = 'deck-crew-still';
    still.castShadow = false; still.receiveShadow = true;
    still.frustumCulled = false;
    world.scene.add(still);
    world.statics.push(still);
    life.silStill = still;
  }
  for (const g of Object.values(built)) g.geo.dispose();
  life.sils = sils;
  life.silMeshes = meshes;
}

/** Put one man in one pose mesh, taking him out of the one he was in. */
function silShow(life, S, pose, x, y, z, yaw) {
  const M = life.silMeshes;
  if (S.shown !== pose) {
    if (S.shown) {
      const old = M[S.shown];
      _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
      old.setMatrixAt(S.slot, _m.compose(_v, _q, _s));
      old.instanceMatrix.needsUpdate = true;
      old.userData.free.push(S.slot);
    }
    const im = M[pose];
    S.slot = im.userData.free.length ? im.userData.free.pop() : im.userData.top++;
    if (S.slot >= im.count) im.count = S.slot + 1;
    im.setColorAt(S.slot, _c.set(S.tone));
    im.instanceColor.needsUpdate = true;
    S.shown = pose;
  }
  _q.setFromAxisAngle(UP, yaw);
  _v.set(x, y, z); _s.set(1, 1, 1);
  M[pose].setMatrixAt(S.slot, _m.compose(_v, _q, _s));
  M[pose].instanceMatrix.needsUpdate = true;
}

/** The walk's cadence: the animator's own period at 1.3 m/s, measured in `crewSilhouettes`' capture. */
const SIL_STRIDE = 0.77;

function stepSilhouettes(world, life, dt) {
  const sils = life.sils;
  if (!sils) return;
  for (const S of sils) {
    const J = S.job;
    S.t += dt;
    if (!S.frames) continue;                 // a still is in the merged mesh
    const span = Math.hypot(J.path[2] - J.path[0], J.path[3] - J.path[1]);
    if (S.lead) {
      /* The file: `rank` gaps behind the leader, halting and about-turning
       * as one — see the droids' convoys. */
      const L = S.lead;
      S.dir = L.dir;
      S.at = L.at - (S.rank * J.gap) / span;
      S.moving = L.moving;
    } else if (S.hold > 0) { S.hold -= dt; S.moving = false; }
    else {
      S.moving = true;
      S.at += (J.speed / span) * S.dir * dt;
      if (S.at >= 1) { S.at = 1; S.dir = -1; S.hold = 2 + ((S.i * 7 + Math.floor(S.t)) % 5); }
      else if (S.at <= S.lo) { S.at = S.lo; S.dir = 1; S.hold = 2 + ((S.i * 3 + Math.floor(S.t)) % 6); }
    }
    const x = lerp(J.path[0], J.path[2], S.at), z = lerp(J.path[1], J.path[3], S.at);
    const y = groundAt(world, x, z);
    const yaw = Math.atan2((J.path[2] - J.path[0]) * S.dir, (J.path[3] - J.path[1]) * S.dir);
    if (!S.moving) {
      /* At an end: the rest pose, facing where he was going. */
      if (S.shown !== J.rest || S.x !== x || S.z !== z) silShow(life, S, J.rest, x, y, z, S.yaw);
      S.x = x; S.z = z;
      continue;
    }
    /* THE FLIP-BOOK: the frame is the phase of a stride at his own speed. */
    const stride = SIL_STRIDE * 1.3 / J.speed;
    const k = Math.floor(((S.t / stride) % 1) * S.frames.length);
    silShow(life, S, S.frames[k], x, y, z, yaw);
    S.x = x; S.z = z; S.yaw = yaw;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  8 · VENTS — motion at the edge of vision                              */
/* ══════════════════════════════════════════════════════════════════════ */

/** [x, lift, z, dirX, dirY, dirZ, period, open, cold] — at surfaces, all of them. */
function ventTable() {
  const { across, deep, BAY, FLANK_L, WALL, W } = frame();
  return [
    /* The port rack foot, in the flank patch: nearest, and the only one the
     * player is close enough to hear as well as see. */
    [-(WALL - 8.5), 1.6, (FLANK_L.z0 + FLANK_L.z1) * 0.5 + 6, 1, 0.25, 0, 8.5, 1.4, 1],
    /* The starboard rack foot, forward, in the work zone. */
    [WALL - 8.5, 3.4, W.z1 - 20, -1, 0.30, 0, 11.0, 1.8, 1],
    /* Coolant off the hull section, under the jacks. */
    [BAY.x - BAY.rad - 0.4, BAY.jack * 0.55, BAY.z - BAY.len * 0.3, -1, 0.5, 0, 9.5, 1.2, 1],
    /* The bulkhead, beside the port blast door: exhaust, the only warm one. */
    [across(-0.47), 1.2, DECK.aft + 6, 0, 0.35, 1, 13.0, 1.0, 0],
    /* And one out in the midground, so the far half breathes too. */
    [WALL - 8.5, 1.5, deep(0.43), -1, 0.35, 0, 10.0, 1.6, 1],
  ];
}

function stepVents(world, life, dt) {
  const fx = world.particles;
  if (!fx) return;
  life.vt += dt;
  const vents = life.vents;
  for (let i = 0; i < vents.length; i++) {
    const V = vents[i];
    const ph = (life.vt + i * 2.7) % V[6];
    if (ph > V[7]) continue;
    life.vtick[i] += dt;
    if (life.vtick[i] < 0.09) continue;
    life.vtick[i] = 0;
    _v.set(V[0], V[1], V[2]);
    for (let k = 0; k < 3; k++) {
      _v2.set(V[3] + (k - 1) * 0.14, V[4] + 0.18 * k, V[5] + (k - 1) * 0.1).normalize().multiplyScalar(2.4 + k * 0.5);
      fx.smoke.spawn(_v, _v2, {
        life: 1.5 + k * 0.35, size: 0.16 + k * 0.05, drag: 1.7, gravity: -0.35,
        color: V[8] ? 0x9fb4c8 : 0x8b8f96, alpha: 0.16,
      });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  9 · THE FIELD REACTS                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

function ringMaterial() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xbfe6ff) },
      uAlpha: { value: 0 },
      uWidth: { value: 0.16 },
    },
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; uniform float uWidth;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float front = 1.0 - smoothstep(0.0, uWidth, 1.0 - r);
        float wake = smoothstep(1.0 - uWidth * 5.0, 1.0, r);
        float a = (front * 0.75 + wake * 0.25) * step(r, 1.0);
        gl_FragColor = vec4(uColor * a * 2.2, a * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  mat.userData.saberNoInk = true;
  return mat;
}

function addFieldRings(world, life) {
  const M = deckMaterials();
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.RingGeometry(0.30, 1.0, 44, 1);
    const mesh = new THREE.Mesh(geo, M.ring[i]);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.castShadow = false; mesh.receiveShadow = false;
    world.scene.add(mesh);
    world.statics.push(mesh);
    rings.push({ mesh, mat: M.ring[i], t: 9, life: 1, size: 1 });
  }
  life.rings = rings;
}

/** Fire a ripple centred on `p`, laid flat on the nearest field plane. */
function ripple(life, p, size = 16, hold = 1.5, color = 0xbfe6ff) {
  const L = DECK.lip;
  let best = null, bestD = 1e9;
  for (const r of life.rings) if (r.t >= r.life && !best) best = r;
  if (!best) for (const r of life.rings) if (r.t < bestD) { bestD = r.t; best = r; }
  const dz = Math.abs(Math.abs(p.z) - L), dx = Math.abs(Math.abs(p.x) - L);
  best.mesh.rotation.set(0, 0, 0);
  if (dx < dz) {
    best.mesh.position.set(Math.sign(p.x) * L, clamp(p.y, 1, DECK.roof - 4), clamp(p.z, -L, L));
    best.mesh.rotation.y = Math.PI / 2;
  } else {
    best.mesh.position.set(clamp(p.x, -L, L), clamp(p.y, 1, DECK.roof - 4), Math.sign(p.z || 1) * L);
  }
  best.mat.uniforms.uColor.value.set(color);
  best.t = 0; best.life = hold; best.size = size;
  best.mesh.visible = true;
}

function stepRings(life, dt) {
  for (const r of life.rings) {
    if (r.t >= r.life) { if (r.mesh.visible) r.mesh.visible = false; continue; }
    r.t += dt;
    const k = clamp(r.t / r.life, 0, 1);
    const s = Math.max(0.05, r.size * (1 - Math.exp(-3.4 * k)));
    r.mesh.scale.set(s, s, 1);
    r.mat.uniforms.uAlpha.value = (1 - k) * (1 - k) * 1.15;
    r.mat.uniforms.uWidth.value = clamp(0.30 - k * 0.22, 0.045, 0.30);
    if (k >= 1) r.mesh.visible = false;
  }
}

function stepField(world, life, dt) {
  const mat = world._hangarField;
  if (!mat) return;
  const u = mat.uniforms;
  u.uTime.value = life.t;
  if (life.brown > 0) {
    life.brown = Math.max(0, life.brown - dt);
    const k = life.brown / life.brownFor;
    const flick = 0.5 + 0.5 * Math.sin(life.brown * 34);
    u.uPower.value = lerp(1, 0.22 + flick * 0.30, k * k);
  } else if (u.uPower.value !== 1) {
    u.uPower.value = lerp(u.uPower.value, 1, 1 - Math.exp(-4 * dt));
    if (Math.abs(u.uPower.value - 1) < 0.005) u.uPower.value = 1;
  }
  life.next -= dt;
  if (life.next <= 0) {
    life.event++;
    life.next = 9 + (life.event % 4) * 2.4;
    const L = DECK.lip;
    const a = life.event * 2.399963;
    if (life.event % 4 === 3) {
      life.brown = life.brownFor = 1.35;
    } else {
      /* DEBRIS OFF THE OUTSIDE burning off against the forward field — the
       * only field there is now that the room has walls. */
      _v.set(Math.sin(a * 3.1) * L * 0.5, 6 + Math.abs(Math.sin(a * 1.7)) * 40, L);
      ripple(life, _v, 13 + (life.event % 3) * 5, 1.5, 0xd8f0ff);
      const fx = world.particles;
      fx?.plasma?.spawn(_v, _v2.set(0, 0, 0), { life: 0.10, size: 1.4, drag: 1, gravity: 0, color: 0xffffff, alpha: 1, hdr: 5.0 });
      fx?.plasma?.spawn(_v, _v2.set(0, 0, 0), { life: 0.34, size: 3.6, drag: 1, gravity: 0, color: 0xbfe6ff, alpha: 0.9, hdr: 2.6 });
      _v2.set(0, 0, -1);
      fx?.sparkBurst?.(_v, _v2, 16, { speed: 14, color: 0xd8f0ff, hdr: 3.4 });
      u.uPower.value = 1.5;
    }
  }
  /* Anything the player puts through it rings it. */
  const L = DECK.lip;
  for (const p of world.props) {
    const b = p.body;
    if (!b || !(b.invMass > 0) || !b.velocity) continue;
    const pos = b.position;
    const near = Math.abs(Math.abs(pos.x) - L) < 2.5 || Math.abs(Math.abs(pos.z) - L) < 2.5;
    if (!near || Math.abs(pos.x) > L + 3 || Math.abs(pos.z) > L + 3) continue;
    if (b.velocity.lengthSq() < 25) continue;
    if (life.t - (p._deckRipple ?? -9) < 0.9) continue;
    p._deckRipple = life.t;
    _v.set(pos.x, pos.y, pos.z);
    ripple(life, _v, 9, 1.2, 0x8fd4ff);
    world.particles?.sparkBurst?.(_v, null, 10, { speed: 9, color: 0xbfe6ff, hdr: 3.0 });
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/* 10 · THE TRAFFIC                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ IN THROUGH THE APERTURE, OUT THROUGH THE APERTURE, AND NEVER GONE ═════
 *
 * Two MODELLED hulls fly the inside: a fighter on the port apron mark and a
 * shuttle on the starboard one. Each runs one clock through seven phases —
 *
 *   FAR IN    the silhouette, from `OUTSIDE.run` past the lip to the lip,
 *             decelerating, growing
 *   IN        the modelled hull from the lip to its pad, flaring
 *   SIT       on gear, collider on, bells cooling, a droid rolling up
 *   SPIN      clamps, spool, grit blown out from under it
 *   OUT       up off the clamps and straight out through the lip
 *   FAR OUT   the silhouette, accelerating away to `OUTSIDE.run`, shrinking
 *   GAP       nothing, so the pad is empty for a while
 *
 * — and the outside legs are constant-acceleration runs whose speed at the
 * lip matches the inside leg's, so nothing jumps at the handover; the
 * ripple and the plasma flash at the lip cover the swap of silhouette for
 * model. Every other fighter arrival is damaged.
 *
 * The three PATROL LOOPS outside never come in: a diamond of four fighters,
 * a pair the other way round, a shuttle low across. Seven hulls in flight
 * at any moment before an arrival or a departure adds to them.
 *
 * INSIDE THE ROOM a hull is never past |x| = `CLEAR` - its span, never above
 * 40 m, and enters only across the lip's plane. The pads are the apron's.
 */
let TRAFFIC = null;
function trafficPlan(world) {
  if (TRAFFIC) return TRAFFIC;
  const { APRON, OUTSIDE, CLEAR } = frame();
  const gy = (p) => groundAt(world, p.x, p.z);
  return (TRAFFIC = {
    outside: OUTSIDE,
    /** Inside, traffic stays under this and inside this. */
    ceiling: 40, clear: CLEAR,
    hulls: [
      /* THE FIGHTER: port pad, entering from starboard across the apron.
       * Every leg is about half what the room had — "arriving and launching
       * twice as often" — except the descent and the launch, which are the
       * flying a ship does at the speed a ship does it. */
      { kind: 'fighter', pad: { x: APRON.padL.x, z: APRON.padL.z, y: gy(APRON.padL) },
        entry: { x: APRON.padL.x + 50, y: 30 }, farX: 90, farY: 130,
        farIn: 14, inDur: 8, sit: 16, spin: 4, out: 2.6, farOut: 14, gap: 6, t0: 6, flight: 7,
        damagedEvery: 2, slot: 6, glow: 0 },
      /* THE SHUTTLE: starboard pad, entering from port. Longer everything. */
      { kind: 'shuttle', pad: { x: APRON.padR.x, z: APRON.padR.z, y: gy(APRON.padR) },
        entry: { x: APRON.padR.x - 50, y: 32 }, farX: -110, farY: 150,
        farIn: 15, inDur: 10, sit: 22, spin: 5, out: 3.0, farOut: 15, gap: 10, t0: 15 + 10 + 6, flight: 12,
        damagedEvery: 0, slot: 1, glow: 1 },
      /* THE SECOND FIGHTER: pad B, entering from the centre line; starts its
       * first cycle already down and smoking, so the deck has a damaged
       * hull on it from the first frame. Every third of its arrivals is
       * damaged, so the two fighters' bad days do not line up. */
      { kind: 'fighter', pad: { x: APRON.padS.x, z: APRON.padS.z, y: gy(APRON.padS) },
        entry: { x: APRON.padS.x - 40, y: 28 }, farX: 20, farY: 120,
        farIn: 14, inDur: 8, sit: 18, spin: 4, out: 2.6, farOut: 14, gap: 8, t0: 14 + 8 + 4, flight: 3,
        damagedEvery: 3, slot: 7, glow: 2 },
      /* THE THIRD FIGHTER: the centre mark at the very front of the apron,
       * between the two pads, entering from port. Never damaged: the crash
       * crew has two to run to already. */
      { kind: 'fighter', pad: { x: APRON.padN.x, z: APRON.padN.z, y: gy(APRON.padN) },
        entry: { x: APRON.padN.x - 55, y: 26 }, farX: -60, farY: 110,
        farIn: 14, inDur: 8, sit: 20, spin: 4, out: 2.6, farOut: 14, gap: 12, t0: 40, flight: 9,
        damagedEvery: 0, slot: 8, glow: 3 },
    ],
    /* The far mesh slots: formation 0-3, pair 4-5, the fighters' own legs
     * 6, 7 and 8; shuttle loop 0, shuttle's own leg 1. */
    farFighters: 9, farShuttles: 2,
  });
}

/** Where a hull is along a constant-acceleration run of `D` metres in `T`
 *  seconds that ends (or starts) at `v1` metres a second. */
function runIn(D, T, v1, t) { const v0 = 2 * D / T - v1; const a = (v1 - v0) / T; return v0 * t + 0.5 * a * t * t; }
function runOut(D, T, v0, t) { const v1 = 2 * D / T - v0; const a = (v1 - v0) / T; return v0 * t + 0.5 * a * t * t; }

function addTraffic(world, life) {
  const C = castMaterials(world._deckFaction);
  const P = trafficPlan(world);
  /* The two modelled hulls, hidden until their clocks put them inside. */
  for (const H of P.hulls) {
    const cast = H.kind === 'fighter' ? buildCastFighter({ faction: world._deckFaction })
      : buildCastShuttle({ faction: world._deckFaction });
    cast.group.visible = false;
    world.scene.add(cast.group);
    world.statics.push(cast.group);
    for (const m of Object.values(cast.meshes)) if (m) world.statics.push(m);
    H.cast = cast;
    /* The clock starts INSIDE the first cycle — the fighter on final, the
     * shuttle already on its pad — so the first cycle's decisions are made
     * here rather than at a crossing nothing will see. Odd cycles of a hull
     * with `damagedEvery` are the damaged ones, so the FIRST fighter the
     * player sees is the one trailing smoke. */
    H.t = H.t0; H.last = H.t0 - 1e-6; H.cycle = 1; H.smoke = 0; H.wash = 0; H.collider = null;
    H.glowSlot = glowSlot(life, 2);
    H.damaged = H.damagedEvery > 0 && ((H.cycle - 1) % H.damagedEvery === 0);
    H.T = H.farIn + H.inDur + H.sit + H.spin + H.out + H.farOut + H.gap;
    /* The inside descent's speed at the lip and the launch's, so the
     * outside legs can match them. */
    const entryDist = Math.hypot(H.entry.x - H.pad.x, DECK.lip - H.pad.z, H.entry.y - H.pad.y);
    H.vLip = 2.4 * entryDist / H.inDur;
    H.aOut = 2 * (DECK.lip - H.pad.z + 2) / (H.out * H.out);
    H.vOut = H.aOut * H.out;
  }
  /* THE SILHOUETTES: one instanced mesh of fighters, one of shuttles, both
   * unfogged, both frustum-unculled (they cross 900 m). */
  const fg = farHullGeometry(0, world._deckFaction);
  const sg = farHullGeometry('shuttle', world._deckFaction);
  const mk = (geo, n, name) => {
    const im = new THREE.InstancedMesh(geo, C.far, n);
    im.frustumCulled = false;
    im.castShadow = false; im.receiveShadow = false;
    im.name = name;
    _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
    for (let i = 0; i < n; i++) { im.setMatrixAt(i, _m.compose(_v, _q, _s)); im.setColorAt(i, _c.setRGB(1, 1, 1)); }
    world.scene.add(im);
    world.statics.push(im);
    return im;
  };
  life.traffic = {
    plan: P,
    farF: mk(fg.geo, P.farFighters, 'deck-far-fighters'),
    farS: mk(sg.geo, P.farShuttles, 'deck-far-shuttles'),
    t: 0, formPassed: false,
  };
}

/** One far instance: place, heading, scale, and its brightness by distance. */
function farAt(im, i, x, y, z, yaw, pitch, roll, dz) {
  _eu.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_eu);
  _v.set(x, y, z); _s.set(1, 1, 1);
  im.setMatrixAt(i, _m4.compose(_v, _q, _s));
  /* DARKENED BY DISTANCE, by hand — the material has no fog. Down to 45% at
   * the end of the run, so a speck is a dark speck against the planet and not
   * a bright one, which is what a hull in a star's light at that range is. */
  const k = 1 - 0.55 * smoothstep(0, frame().OUTSIDE.run, Math.max(0, dz));
  im.setColorAt(i, _c.setRGB(k, k, k));
}

function farAway(im, i) {
  _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
  im.setMatrixAt(i, _m4.compose(_v, _q, _s));
}

/** A patrol loop: an ellipse outside, flown at constant angular rate. */
function loopAt(L, k, offA, offR, out) {
  const a = k * TAU + offA;
  const r = 1 + offR;
  out.set(L.cx + Math.cos(a) * L.ax * r, L.y + Math.sin(a * 2 + offA) * 12, L.cz + Math.sin(a) * L.az * r);
  return out;
}

function stepPatrols(world, life, dt) {
  const T = life.traffic, P = T.plan, O = P.outside;
  T.t += dt;
  /* THE FORMATION: a diamond of four on the big loop. */
  const kf = (T.t / O.form.period) % 1;
  for (let i = 0; i < 4; i++) {
    const offA = -i * 0.035, offR = (i === 1 ? 0.06 : i === 2 ? -0.06 : i === 3 ? 0 : 0);
    loopAt(O.form, kf, offA, offR, _v2);
    loopAt(O.form, kf + 0.002, offA, offR, _v3);
    const yaw = Math.atan2(_v3.x - _v2.x, _v3.z - _v2.z);
    farAt(T.farF, i, _v2.x, _v2.y + (i === 3 ? -6 : 0), _v2.z, yaw, 0, -0.18, _v2.z - DECK.lip);
  }
  /* The leader's closest pass in front of the aperture is a repulsor pass
   * outside the field, once per loop. */
  loopAt(O.form, kf, 0, 0, _v2);
  const front = Math.abs(_v2.x) < 20 && _v2.z < O.form.cz;
  if (front && !T.formPassed) {
    T.formPassed = true;
    _v3.set(_v2.x - 120, _v2.y, _v2.z); _v.set(_v2.x + 120, _v2.y, _v2.z);
    repulsorPass(world, { from: _v3, to: _v, speed: 60, power: 0.6, outside: true, spin: false });
  } else if (!front) T.formPassed = false;
  /* THE PAIR, the other way round. */
  const kp = 1 - (T.t / O.pair.period) % 1;
  for (let i = 0; i < 2; i++) {
    loopAt(O.pair, kp, i * 0.04, i * 0.05, _v2);
    loopAt(O.pair, kp - 0.002, i * 0.04, i * 0.05, _v3);
    const yaw = Math.atan2(_v3.x - _v2.x, _v3.z - _v2.z);
    farAt(T.farF, 4 + i, _v2.x, _v2.y, _v2.z, yaw, 0, 0.2, _v2.z - DECK.lip);
  }
  /* THE SHUTTLE, low and slow. */
  const ks = (T.t / O.shuttle.period) % 1;
  loopAt(O.shuttle, ks, 0, 0, _v2);
  loopAt(O.shuttle, ks + 0.002, 0, 0, _v3);
  farAt(T.farS, 0, _v2.x, _v2.y, _v2.z, Math.atan2(_v3.x - _v2.x, _v3.z - _v2.z), 0, -0.05, _v2.z - DECK.lip);
}

/** Put a modelled hull in the world. */
function hullAt(life, H, x, y, z, yaw, pitch, roll, burn) {
  const g = H.cast.group;
  g.visible = true;
  g.position.set(x, y, z);
  _eu.set(pitch, yaw, roll, 'YXZ');
  g.quaternion.setFromEuler(_eu);
  g.updateMatrixWorld(true);
  const slot = H.glowSlot;
  for (let i = 0; i < 2; i++) {
    const b = H.cast.bells[Math.min(i, H.cast.bells.length - 1)];
    _mb.makeRotationX(Math.PI / 2).setPosition(b.x, b.y, b.z - 0.3);
    glowPlace(life, slot + i, _mb.premultiply(g.matrixWorld), b.r * 1.9, b.r * 1.6);
    glowBurn(life, slot + i, burn * 0.55, burn * 0.82, burn);
  }
}

function hullAway(life, H) {
  H.cast.group.visible = false;
  const slot = H.glowSlot;
  for (let i = 0; i < 2; i++) { glowPlace(life, slot + i, _m4.identity(), 0, 0); glowBurn(life, slot + i, 0, 0, 0); }
}

/** A landed hull is solid; a flying one is not. */
function hullSolid(world, H, on) {
  if (on && !H.collider) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, 0);
    H.collider = world.physics?.addStaticBox?.(
      new THREE.Vector3(H.pad.x, H.pad.y + H.cast.gearY + 0.2, H.pad.z),
      new THREE.Vector3(H.cast.half.x, H.cast.half.y + 0.6, H.cast.half.z), q, { friction: 0.6 }) || null;
    if (!H.collider) H.collider = true;
  } else if (!on && H.collider) {
    if (H.collider !== true) world.physics?.removeStaticBox?.(H.collider);
    H.collider = null;
  }
}

/**
 * ONE HULL'S CLOCK. Every transition is a `<` on it — no state field, so a
 * skipped step or a jumped clock cannot leave a ship halfway through a
 * landing forever. `H.last` is where the clock was last frame, which is how
 * an event fires on exactly one frame.
 */
function stepHull(world, life, H, dt) {
  const T = life.traffic, P = T.plan, O = P.outside;
  const fx = world.particles;
  const far = H.kind === 'fighter' ? T.farF : T.farS;
  const slot = H.slot;
  const t = H.t, was = H.last;
  const A = H.farIn, B = A + H.inDur, Cc = B + H.sit, D = Cc + H.spin, E = D + H.out, F = E + H.farOut;
  const gy = H.pad.y + H.cast.gearY;
  const px = H.pad.x, pz = H.pad.z;
  const lip = DECK.lip;
  const crossed = (edge) => was < edge && t >= edge;

  if (t < A) {
    /* ── FAR IN. From `OUTSIDE.run` past the lip down to the entry point,
     * growing, decelerating to the inside leg's own speed. */
    /* `stepTraffic` marks a wrapped clock with `last = -1`; a clock that
     * jumped backwards any other way reads the same. (`was >= A` never held
     * here — the wrap put `was` below zero, not above A — so the cycle count
     * stood at 1 for ever and every fighter arrival was the damaged one.) */
    if (was < 0 || was > t) {
      /* The cycle begins: decide whether this one is damaged, and announce. */
      H.cycle++;
      H.damaged = H.damagedEvery > 0 && ((H.cycle - 1) % H.damagedEvery === 0);
      hullAway(life, H);
    }
    const d = runIn(O.run, A, H.vLip, t);
    const k = clamp(d / O.run, 0, 1);
    const x = lerp(H.farX, H.entry.x, k);
    const y = lerp(H.farY, H.entry.y, Math.pow(k, 0.8));
    const z = lip + O.run - d;
    const yaw = Math.atan2(H.entry.x - x, -1 - (z - lip) * 0.3);
    farAt(far, slot, x, y, z, yaw, 0.08, (H.entry.x - H.farX) > 0 ? -0.1 : 0.1, z - lip);
    /* THE SOUND GOES FIRST: `damagedArrival` starts its pass out at
     * `DECK.lip * LAUNCH.out` and queues the field punch for the lip, so it
     * is fired when the hull is there, not at the lip. A clean arrival is a
     * repulsor pass from the lip, fired at the lip below. */
    const lead = (lip * LAUNCH.out - lip);
    if (H.damaged && crossed(A - lead / H.vLip)) {
      damagedArrival(world, { x: px, z: pz, speed: H.vLip, mass: ARRIVE.mass });
    }
    if (crossed(A - 7)) {
      announce(world, life, H.damaged ? 'PA — DAMAGED HULL INBOUND' : `PA — FLIGHT ${H.flight} ON FINAL`,
        H.damaged ? `clear pad ${H.glow + 1} — crash crew to the apron`
          : `pad ${H.glow + 1} clear to receive`);
    }
    if (H.damaged && t > A - 8) {
      H.smoke += dt;
      if (H.smoke > 0.12) {
        H.smoke = 0;
        _v.set(x, y, z);
        fx?.smoke?.spawn(_v, _v2.set(0, 0.4, 2), { life: 2.2, size: 1.8, drag: 0.9, gravity: -0.1, color: 0x3a3f47, alpha: 0.45 });
      }
    }
    return;
  }
  if (t < B) {
    /* ── IN. Through the field and down to the pad. */
    if (crossed(A)) {
      farAway(far, slot);
      _v.set(H.entry.x, H.entry.y, lip);
      ripple(life, _v, 24, 1.8, 0xd8f0ff);
      fx?.plasma?.spawn(_v, _v2.set(0, 0, 0), { life: 0.28, size: 5.0, drag: 1, gravity: 0, color: 0xbfe6ff, alpha: 0.9, hdr: 3.0 });
      if (!H.damaged) {
        _v3.set(px, gy, pz);
        repulsorPass(world, { from: _v, to: _v3, speed: H.vLip * 0.6, power: 0.9, spin: false });
      }
    }
    const k = clamp((t - A) / H.inDur, 0, 1);
    const e = 1 - Math.pow(1 - k, 2.4);
    const x = lerp(H.entry.x, px, e);
    const z = lerp(lip, pz, e);
    const y = lerp(H.entry.y, gy, Math.pow(e, 0.7));
    const yaw = Math.atan2(px - H.entry.x, pz - lip) * (1 - smoothstep(0.7, 1, k));
    const flare = smoothstep(0.72, 0.95, k) * (1 - smoothstep(0.95, 1.0, k));
    /* A damaged lift sputters: the bells flicker and the hull rolls. */
    const sput = H.damaged ? (Math.sin(t * 23) > 0.6 ? 0.2 : 1) : 1;
    hullAt(life, H, x, y, z, yaw, -0.10 + flare * 0.34, (1 - e) * (H.damaged ? 0.22 : 0.10), (1.4 + flare * 2.2) * sput);
    H.cast.meshes.gear.visible = k > 0.55;
    if (H.damaged) {
      H.smoke += dt;
      if (H.smoke > 0.05) {
        H.smoke = 0;
        const b = H.cast.bells[0];
        _v.set(x + b.x * Math.cos(yaw), y + b.y, z - b.z * 0.2);
        fx?.smoke?.spawn(_v, _v2.set(-Math.sin(yaw) * 3, 0.6, -Math.cos(yaw) * 3), { life: 2.6, size: 1.1, drag: 1.1, gravity: -0.2, color: 0x3a3f47, alpha: 0.5 });
      }
    }
    world.engine?.lightUp?.(_v.set(x, y, z), 0xbcd8ff, 26, 30, 0);
    return;
  }
  if (t < Cc) {
    /* ── SIT. Touchdown once; then cooling on gear, solid. A hull whose clock
     * STARTS on the pad never crosses B, so the collider is asked for
     * directly: a ship you can walk through is the complaint, again. */
    if (!H.collider) hullSolid(world, H, true);
    if (crossed(B)) {
      hullSolid(world, H, true);
      _v.set(px, gy - H.cast.gearY + 0.2, pz);
      world.engine?.lightUp?.(_v, 0xffd8a8, 42, 26, 0);
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * TAU;
        _v2.set(Math.cos(a) * 9, 1.4, Math.sin(a) * 9);
        fx?.dust?.spawn(_v, _v2, { life: 2.2, size: 1.5, drag: 2.0, gravity: 1.2, color: 0x2a2f37, alpha: 0.45 });
        fx?.grit?.spawn(_v, _v2.multiplyScalar(1.4), { life: 1.4, size: 0.10, drag: 0.9, gravity: 12, color: 0x39404a, alpha: 0.7 });
      }
      if (H.damaged) {
        /* SPARKS ON TOUCHDOWN off the gear, and the crash crew runs. */
        _v2.set(0, 1, 0);
        fx?.sparkBurst?.(_v, _v2, 40, { speed: 12, color: 0xffd090, hdr: 3.2 });
        callCrashCrew(life, H, px, pz, true);
      }
    }
    const sat = t - B;
    const cool = Math.exp(-sat * 0.5);
    hullAt(life, H, px, gy, pz, 0, 0, 0, 0.25 + cool * 1.1);
    H.cast.meshes.gear.visible = true;
    H.wash += dt;
    if (H.wash > 0.16) {
      H.wash = 0;
      for (const b of H.cast.bells) {
        _v.set(px + b.x, gy + b.y + 0.6, pz + b.z - 0.5);
        fx?.plasma?.spawn(_v, _v2.set(0, 1.3, -0.4), { life: 1.5, size: 0.9, drag: 1.6, gravity: -0.5, color: 0x9fb6cc, alpha: 0.10, hdr: 0.5 });
        if (H.damaged && sat < 12) fx?.smoke?.spawn(_v, _v2.set(0.3, 1.0, 0), { life: 3, size: 1.4, drag: 1.2, gravity: -0.15, color: 0x2a2e34, alpha: 0.35 });
      }
    }
    return;
  }
  if (t < D) {
    /* ── SPIN. Clamps, spool, grit — the pad cleared first. */
    if (crossed(Cc)) {
      callCrashCrew(life, H, px, pz, false);
      launchSequence(world, { x: px, z: pz, speed: H.vOut });
      announce(world, life, `PA — FLIGHT ${H.flight} CLEARED TO LAUNCH`, 'clear the apron — stand behind the line');
    }
    const k = (t - Cc) / H.spin;
    const rise = smoothstep(0.5, 1, k) * 3.0;
    hullAt(life, H, px, gy + rise, pz, 0, 0, 0, 0.4 + k * 3.0);
    H.cast.meshes.gear.visible = rise < 1.5;
    H.wash += dt;
    if (H.wash > 0.06) {
      H.wash = 0;
      const a = k * 37;
      _v.set(px, gy - H.cast.gearY + 0.1, pz);
      _v2.set(Math.cos(a) * 13, 0.8, Math.sin(a) * 13);
      fx?.grit?.spawn(_v, _v2, { life: 1.1, size: 0.09, drag: 1.0, gravity: 14, color: 0x39404a, alpha: 0.75 });
      fx?.dust?.spawn(_v, _v2, { life: 1.8, size: 1.3, drag: 2.2, gravity: 0.8, color: 0x2a2f37, alpha: 0.30 });
    }
    world.engine?.lightUp?.(_v.set(px, gy, pz), 0xcfe6ff, 30 * k, 24, 0);
    return;
  }
  if (t < E) {
    /* ── OUT. Straight out of the door under constant acceleration. The
     * collider goes the frame it leaves the pad, not before: a ship winding
     * up is still a ship you cannot walk through. */
    if (crossed(D)) hullSolid(world, H, false);
    const tt = t - D;
    const z = pz + 0.5 * H.aOut * tt * tt;
    const y = gy + 3.0 + tt * 2.0;
    hullAt(life, H, px, y, z, 0, -0.06, 0, 3.6);
    H.cast.meshes.gear.visible = false;
    const wz = pz + 0.5 * H.aOut * (was - D) * (was - D);
    if (z >= lip && wz < lip) {
      _v.set(px, y, lip);
      ripple(life, _v, 26, 1.6, 0xd8f0ff);
      fx?.sparkBurst?.(_v, _v2.set(0, 0, 1), 18, { speed: 16, color: 0xd8f0ff, hdr: 3.4 });
    }
    return;
  }
  if (t < F) {
    /* ── FAR OUT. The silhouette takes over at the lip and climbs away,
     * accelerating, shrinking, for `OUTSIDE.run` metres. */
    if (crossed(E)) hullAway(life, H);
    const d = runOut(O.run, H.farOut, H.vOut, t - E);
    const k = clamp(d / O.run, 0, 1);
    const x = lerp(px, px * 0.4 + H.farX * 0.5, k * k);
    const y = lerp(gy + 3 + H.out * 2, H.farY * 0.8, Math.pow(k, 1.4));
    const z = lip + d;
    farAt(far, slot, x, y, z, Math.atan2(x - px, 20), -0.12 * (1 - k), 0, z - lip);
    return;
  }
  /* ── GAP. */
  if (crossed(F)) farAway(far, slot);
}

/**
 * ══ THE SHUTTLE TAXIING ═══════════════════════════════════════════════════
 *
 * A fifth modelled hull that never flies: a cast shuttle on its gear, a
 * hand's breadth off the plate on its repulsors, crossing the forward
 * centre between the far apron's ground and pad B at walking pace, waiting
 * at each end with its bells idling. The PA calls it when it moves. Its
 * collider moves with it — a taxiing ship is still a ship you walk into.
 */
function addTaxi(world, life) {
  const { TAXI } = frame();
  const C = castMaterials(world._deckFaction);
  const cast = foldCast(buildCastShuttle({ faction: world._deckFaction }), C.cast);
  cast.group.visible = true;
  world.scene.add(cast.group);
  world.statics.push(cast.group);
  for (const m of Object.values(cast.meshes)) if (m) world.statics.push(m);
  life.taxi = { cast, run: TAXI, at: 0.3, dir: 1, hold: 4, t: 0, slot: glowSlot(life, 2), collider: null, wasMoving: false, hover: 0.35 };
}

function stepTaxi(world, life, dt) {
  const T = life.taxi;
  if (!T) return;
  const R = T.run;
  T.t += dt;
  const span = R.x1 - R.x0;
  const moving = T.hold <= 0;
  if (T.hold > 0) T.hold -= dt;
  else {
    T.at += (R.speed / span) * T.dir * dt;
    if (T.at >= 1) { T.at = 1; T.dir = -1; T.hold = R.hold; }
    else if (T.at <= 0) { T.at = 0; T.dir = 1; T.hold = R.hold + 4; }
  }
  const x = R.x0 + span * T.at, z = R.z;
  const gy = groundAt(world, x, z) + T.cast.gearY + T.hover;
  const yaw = T.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  const g = T.cast.group;
  g.position.set(x, gy + Math.sin(T.t * 1.3) * 0.03, z);
  /* A slow swing of the nose through the turn at each end. */
  T.yaw = lerp(T.yaw ?? yaw, yaw, 1 - Math.exp(-1.2 * dt));
  g.rotation.set(0, T.yaw, moving ? Math.sin(T.t * 0.8) * 0.01 : 0);
  g.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) {
    const b = T.cast.bells[Math.min(i, T.cast.bells.length - 1)];
    _mb.makeRotationX(Math.PI / 2).setPosition(b.x, b.y, b.z - 0.3);
    glowPlace(life, T.slot + i, _mb.premultiply(g.matrixWorld), b.r * 1.4, b.r * 1.2);
    const burn = moving ? 0.9 : 0.35;
    glowBurn(life, T.slot + i, burn * 0.55, burn * 0.82, burn);
  }
  if (moving !== T.wasMoving) {
    T.wasMoving = moving;
    if (moving) announce(world, life, 'PA — SHUTTLE TAXIING, FORWARD CENTRE', 'stand clear of the moving hull');
    /* The collider is re-set at each end rather than every frame: a static
     * box a frame is a wall that flickers. */
    if (T.collider) { world.physics?.removeStaticBox?.(T.collider); T.collider = null; }
    if (!moving) {
      T.collider = world.physics?.addStaticBox?.(new THREE.Vector3(x, gy + 0.2, z),
        new THREE.Vector3(T.cast.half.z, T.cast.half.y + 0.6, T.cast.half.x), new THREE.Quaternion().setFromAxisAngle(UP, yaw), { friction: 0.6 }) || null;
    }
  }
}

function stepTraffic(world, life, dt) {
  const T = life.traffic;
  if (!T) return;
  stepPatrols(world, life, dt);
  for (const H of T.plan.hulls) {
    H.last = H.t;
    H.t += dt;
    if (H.t >= H.T) { H.t -= H.T; H.last = -1; }
    stepHull(world, life, H, dt);
  }
  T.farF.instanceMatrix.needsUpdate = true;
  T.farS.instanceMatrix.needsUpdate = true;
  if (T.farF.instanceColor) T.farF.instanceColor.needsUpdate = true;
  if (T.farS.instanceColor) T.farS.instanceColor.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* 11 · THE PA                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE DECK ANNOUNCES WHAT IT IS DOING ═══════════════════════════════════
 *
 * `DeckAudio.paCall` is wordless by rule — a PA that says a sentence is a
 * narrator — and stays so. What the player asked for is a deck that
 * ANNOUNCES: every launch, every arrival, the company falling in, the lift.
 * So every call here is the horn AND a HUD line through `world.notify`,
 * kind `flavour`, worded as a tannoy would word it. The line is the
 * announcement's text; the horn is its sound; nothing is spoken.
 *
 * Never closer than `PA.gap` seconds. A call that lands inside the gap waits
 * in a three-slot queue and the oldest is dropped if a fourth arrives — a
 * tannoy that read out everything a busy deck does would be the spam this
 * number exists to stop.
 */
const PA = { gap: 14, slots: 3, idle: 38 };

/** The deck's own chatter, in the tannoy's words: more lines, same horn. */
const PA_IDLE = [
  ['PA — CREW FOUR TO BAY SEVEN', 'engine change in progress'],
  ['PA — BOWSER TO PAD TWO', 'coolant crew stand by'],
  ['PA — CRANE LIFT, STARBOARD RAIL', 'clear the ground under the load'],
  ['PA — MEDICAL TO THE CENTRE TENT', 'walking wounded report'],
  ['PA — LIFT PLATFORM RISING', 'stand clear of the rails'],
  ['PA — FORMATION, FAR APRON', 'inspection party to the front rank'],
  ['PA — MOUSE DROIDS, RECALL', 'clear the slivers for the company'],
  ['PA — PIT CREW TO CRADLE TWO', 'panels off, bay open'],
  ['PA — WELDING, PORT WALL', 'eyes off the arc'],
  ['PA — GALLERY WATCH, CHANGE OVER', 'relief to the catwalks'],
];

function announce(world, life, title, sub) {
  const Q = life.pa;
  if (Q.n >= PA.slots) { Q.titles.shift(); Q.subs.shift(); Q.n--; }
  Q.titles.push(title); Q.subs.push(sub); Q.n++;
}

function stepPA(world, life, dt) {
  const Q = life.pa;
  /* THE TWO CALLS THAT ARE NOT THE TRAFFIC'S. The company falling in — the
   * first frame `_company` exists — and the lift being called or arriving. */
  /* `c.mustered` is what `Hangar.deckOrder` sets on FALL IN; the company
   * standing in the crowd before that is not a muster. */
  const c = world._company;
  const mustered = !!(c && c.mustered);
  if (mustered && !Q.mustered) announce(world, life, 'PA — COMPANY TO THE LINE', 'fall in on the muster line');
  Q.mustered = mustered;
  const ls = liftState(world);
  if (ls !== Q.lift) {
    if (ls === 'opening' && Q.lift === 'stop') announce(world, life, 'PA — LIFT AT THE FLIGHT DECK', 'stand clear of the doors');
    else if (ls === 'called' || ls === 'arriving') announce(world, life, 'PA — LIFT CALLED', 'car to the flight deck');
    Q.lift = ls;
  }
  /* THE DECK TALKING TO ITSELF. When nothing is queued and nothing has
   * been said for a while, one of these — a crew called to a bay, a bowser
   * to a pad — so a busy deck sounds busy between the flights. Never inside
   * the gap, and a real call always goes first. */
  if (Q.n === 0 && life.t - Q.at >= PA.idle) {
    const L = PA_IDLE[Q.idle++ % PA_IDLE.length];
    announce(world, life, L[0], L[1]);
  }
  if (Q.n > 0 && life.t - Q.at >= PA.gap) {
    const title = Q.titles.shift(), sub = Q.subs.shift();
    Q.n--;
    Q.at = life.t;
    Q.made++;
    paCall(world);
    world.notify?.(title, sub, 'flavour');
  }
  void dt;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* 12 · THE CAMERA'S FAR PLANE                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A SPECK AT 700 M IS BEHIND THE FAR PLANE ON EVERY QUALITY BUT ULTRA ═══
 *
 * `Engine.QUALITY.viewDist` is 380 m on low and 520 on medium, and the lip
 * is 244 m from the lift. A ship that has flown 150 m past the field is at
 * the far plane on low, and it vanishes — which is the complaint, again,
 * with a different cause. So this room asks for the far plane it needs, and
 * gives it back: `undressDeckLife` restores it, and a sentinel in
 * `world.statics` calls that from `World.unload` whether or not anybody
 * else does. `Engine.setQuality` may reset it mid-level; the step re-asserts.
 */
function farPlane(world, life) {
  const cam = world.engine?.camera;
  if (!cam) return;
  const { FAR } = frame();
  if (life.far0 == null) life.far0 = cam.far;
  if (cam.far < FAR) { cam.far = FAR; cam.updateProjectionMatrix?.(); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE ENTRY POINTS                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

export function dressDeckLife(world) {
  const prev = world._deckLife;
  if (prev && prev.haze && prev.haze.parent) return prev;
  if (prev) undressDeckLife(world);
  const vents = ventTable();
  const life = {
    t: 0, frame: 0, vt: 0, vents, vtick: vents.map(() => 0),
    next: 6, event: 0, brown: 0, brownFor: 1,
    droids: [], rings: [], workers: [], sils: [], cranes: [], parked: [], floods: [], fog0: null, far0: null,
    pa: { at: -99, n: 0, titles: [], subs: [], made: 0, mustered: false, lift: null, idle: 0 },
  };
  world._deckLife = life;
  life.holes = scanHoles(world);
  for (const V of life.vents) V[1] += groundAt(world, V[0], V[2]);
  addDeckHaze(world, life);
  addGlows(world, life);
  addJobs(world, life);
  addParkedHulls(world, life);
  addDroids(world, life);
  addTrolley(world, life);
  addCranes(world, life);
  addSleds(world, life);
  addWorkers(world, life);
  addSilhouettes(world, life);
  addTraffic(world, life);
  addTaxi(world, life);
  addFieldRings(world, life);
  lightFloods(life);
  farPlane(world, life);
  /* THE SENTINEL: `World.unload` disposes every static's geometry, and this
   * one's dispose is the restore. */
  const sentinel = new THREE.Object3D();
  sentinel.name = 'deck-life-sentinel';
  sentinel.geometry = { dispose: () => undressDeckLife(world) };
  world.statics.push(sentinel);
  life.sentinel = sentinel;
  return life;
}

/**
 * THE FLOODLIGHTS' FACES, the tent lamp and the holotable's disc: static
 * emitter instances, written once. No point fixtures — the lamps are lit
 * surfaces and the room's own lights do the lighting (rule 4).
 */
function lightFloods(life) {
  for (const F of life.floods) {
    const slot = glowSlot(life);
    if (F[4] === 'lamp') {
      _m4.makeRotationX(Math.PI).setPosition(F[0], F[1], F[2]);
      glowPlace(life, slot, _m4, 0.30, 0.18);
      glowBurn(life, slot, 1.6, 1.5, 1.2);
    } else if (F[4] === 'holo') {
      _m4.identity().setPosition(F[0], F[1], F[2]);
      glowPlace(life, slot, _m4, 0.55, 0.5);
      glowBurn(life, slot, 0.5, 1.4, 1.9);
    } else {
      /* The head's face: tilted down 0.6 like the head, forward of it. */
      _m4.makeRotationFromEuler(_eu.set(Math.PI / 2 + 0.6, F[3], 0, 'YXZ')).setPosition(F[0] + Math.sin(F[3]) * 0.35, F[1] - 0.1, F[2] + Math.cos(F[3]) * 0.35);
      glowPlace(life, slot, _m4, 0.32, 0.22);
      glowBurn(life, slot, 2.2, 1.9, 1.4);
    }
  }
  /* And trim the shared mesh to what was asked for. */
  life.glows.count = life.glowN;
}

/** Give back the camera's far plane and the bodies. Idempotent. */
export function undressDeckLife(world) {
  const life = world?._deckLife;
  if (!life) return;
  const cam = world.engine?.camera;
  if (cam && life.far0 != null) { cam.far = life.far0; cam.updateProjectionMatrix?.(); life.far0 = null; }
  for (const d of life.droids) { try { d.kn.dispose(); } catch {} }
  for (const w of life.workers) { try { w.shove.dispose(); } catch {} }
  if (life.traffic) for (const H of life.traffic.plan.hulls) { try { hullSolid(world, H, false); } catch {} }
  if (life.taxi?.collider) { try { world.physics?.removeStaticBox?.(life.taxi.collider); } catch {} life.taxi.collider = null; }
  life.droids = []; life.workers = []; life.sils = [];
}

/**
 * Advance every schedule in the room by `dt`. Safe before dress and after
 * unload — both return at once. Nothing in here allocates at steady state.
 */
export function stepDeckLife(world, dt) {
  const life = world && world._deckLife;
  if (!life || !(dt > 0) || !life.haze || !life.haze.parent) return;
  life.t += dt;
  life.frame++;
  farPlane(world, life);
  stepDroids(world, life, dt);
  stepTrolley(life, dt);
  stepCranes(life, dt);
  stepSleds(world, life, dt);
  stepWorkers(world, life, dt);
  stepSilhouettes(world, life, dt);
  stepParked(world, life, dt);
  stepVents(world, life, dt);
  stepTraffic(world, life, dt);
  stepTaxi(world, life, dt);
  stepPA(world, life, dt);
  stepField(world, life, dt);
  stepRings(life, dt);
}
