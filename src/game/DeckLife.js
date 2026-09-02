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
 * ── WHAT IT IS NOW ─────────────────────────────────────────────────────────
 *
 *   FIFTEEN DROIDS of five kinds — `DeckCast.DROID_KINDS` — three astromechs
 *     that ROLL between jobs on a third leg with the dome turning and the eye
 *     lit, four tracked welders at four seams, three folded pit droids, three
 *     mouse droids zipping the deck's edges, two gonks waddling. One
 *     `InstancedMesh` per kind for the chassis; the dome, the leg and the
 *     welder's three arm parts are the only per-droid meshes.
 *   THIRTEEN WORKERS — humanoids on the game's own skeleton, dressed by the
 *     same `dressHumanoid` every trooper goes through, in jumpsuits
 *     (`DeckCast.buildDeckCrew`). They WALK with `Rig.BipedAnimator`, the
 *     gait every enemy in the game walks with, kneel at panels, hold a hose,
 *     weld from a scaffold, watch a crane, and two of them run to a damaged
 *     landing. Each folds to one draw call through `MergedSkin.mergeFigure`
 *     the frame after he is built.
 *   FOUR REPAIR JOBS at once: the hull section on jacks under the gantry,
 *     a fighter on a cradle with its panels off and a droid in the open bay,
 *     a transport with an engine out on a stand, and a coolant bowser with
 *     a hose crew — plus a panel job at each wall foot.
 *   TWO CRANE BRIDGES on the ceiling rails at x = ±36, y 89, one carrying a
 *     hull plate and one an engine, on a slow pass the length of the room.
 *   THREE LOADER SLEDS on three lanes, one instanced mesh.
 *   THE TRAFFIC: two MODELLED hulls (`DeckCast.buildCastFighter/Shuttle`,
 *     140 and 120 primitives) that come in through the aperture, land on the
 *     apron, sit on gear with a collider you cannot walk through, spin up,
 *     and go out — and NINE silhouettes outside the field: a formation of
 *     four and a pair of fighters on patrol loops, a shuttle crossing, and
 *     the far leg of every arrival and departure, drawn UNFOGGED out to
 *     720 m past the lip, so a ship that leaves is a speck before it is
 *     gone. Every other fighter arrival is damaged: smoke, a sputtering
 *     bell, sparks at touchdown, the crash crew running.
 *   PHYSICS ON ALL OF IT. Every droid is a `DeckCast.Knockable`, every
 *     worker a `Shovable`: PROP-layer dynamic bodies, asleep at their
 *     stations, that the Force grips, throws and knocks over, that the
 *     player cannot walk through, and that get up again and go back to
 *     work — a droid rights itself on `SHOVE`'s own clock.
 *   THE PA ANNOUNCES IT: every launch, every arrival, the company falling
 *     in, the lift — `DeckAudio.paCall`'s wordless horn with a HUD line
 *     through `world.notify`, never closer than `PA.gap` seconds apart.
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
 * The ink pass rasterises every opaque object twice, so what is here is
 * composed: one instanced mesh per droid kind, one for the sleds, two for
 * the silhouettes outside, one for every emitter in the room, one merged
 * kit for every static piece of every job, one skinned mesh per worker.
 * `tools/checks/decklife.mjs` prices the file's share and `deckcost.mjs`
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
import { DeckBuild, deckMats, catwalk } from './DeckKit.js';
import { BipedAnimator } from './Rig.js';
import { mergeFigure } from './MergedSkin.js';
import {
  castMaterials, Assembly, Knockable, DROID_KINDS, DROID_BUILDERS, astromechDome, astromechLeg,
  buildDeckCrew, bindPose, buildCastFighter, buildCastShuttle, farHullGeometry,
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
    padS: { x: Math.min(Z.apron.x1 * 0.80, CLEAR - 8), z: (Z.apron.z0 + Z.apron.z1) * 0.5 - 2 },
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

/** Fixed slots: every one has an owner for the life of the level. */
const GLOW = { arc: 0, torch: 4, beacon: 5, engine: 8, eye: 14, count: 17 };

function addGlows(world, life) {
  const M = deckMaterials();
  const im = new THREE.InstancedMesh(cylGeo(0.5, 0.16, 1.0, 8, 0.4), M.glow, GLOW.count);
  im.frustumCulled = false;
  im.castShadow = false; im.receiveShadow = false;
  im.renderOrder = 1;
  im.name = 'deck-glows';
  _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
  for (let i = 0; i < GLOW.count; i++) {
    im.setMatrixAt(i, _m.compose(_v, _q, _s));
    im.setColorAt(i, _c.setRGB(0, 0, 0));
  }
  world.scene.add(im);
  world.statics.push(im);
  life.glows = im;
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
  kit.slabAt(M.status, APRON.crash.x, kg + 1.9, APRON.crash.z - 2.5, 0.3, 0.3, 0.3);
  box(APRON.crash.x, kg + 0.8, APRON.crash.z - 2.5, 1.1, 0.8, 0.6);

  life.bay = { ground: g0, meshes: kit.build(world) };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  4 · THE DROIDS                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ FIFTEEN DROIDS, FIVE KINDS, EVERY SITE ASKED OF THE ZONES ═════════════
 *
 * A row is a droid: its kind, where it stands (or the path it rolls), its
 * heading, and for a welder the seam it works. `path` is `[x, z, x, z]` and
 * a droid with one rolls it forever with a hold at each end; a droid
 * without one stands.
 *
 * The two nearest are in the SLIVERS beside the corridor — the only ground
 * within thirty metres of the lift doors that is not the corridor, the
 * lobby or the crowd's — which is where the "closest NPC has to be real"
 * argument now lands: a pit droid at a bulkhead panel and a mouse droid on
 * the plate you walk out onto.
 */
let DROIDS = null;
function droidJobs() {
  if (DROIDS) return DROIDS;
  const { BAY, CRADLE, HULL, STAND, FLANK_R, FLANK_L, SLIVER, BAND, APRON, W } = frame();
  const cy = Math.cos(CRADLE.yaw), sy = Math.sin(CRADLE.yaw);
  return (DROIDS = [
    /* ASTROMECHS. One between the cradle and the bay, one from the port
     * flank round the pit's aft edge to the port job, one on the apron
     * between the crash station's side and the fighter's pad. */
    { kind: 'astro', path: [CRADLE.x - 7 * cy, CRADLE.z + 6, BAY.x - BAY.rad - 6, BAY.z + 8], yaw: 0, phase: 0.2 },
    /* The port one runs the BAND — the strip between the muster ground and
     * the pit — end to end: a straight line from the flank patch to the port
     * job clips the muster's corner, and paths are straight. */
    { kind: 'astro', path: [BAND.x0 + 2, BAND.z0 + 0.5, STAND.x - 7, BAND.z0 + 0.5], yaw: 0, phase: 0.6 },
    { kind: 'astro', path: [APRON.crash.x - 20, APRON.crash.z + 2, APRON.padL.x + 9, APRON.padL.z - 2], yaw: 0, phase: 0.9 },
    /* WELDERS, at four seams: the section's foot, the starboard wall panel,
     * the cradle's port wing, the transport's starboard flank. */
    { kind: 'welder', x: BAY.x - BAY.rad - 2.4, z: BAY.z - BAY.len * 0.42, yaw: Math.PI / 2,
      sweep: 0.42, reach: 0.78, lift: 1.15, duty: 0.62, phase: 0.0 },
    { kind: 'welder', x: FLANK_R.x1 - 6, z: (FLANK_R.z0 + FLANK_R.z1) * 0.5, yaw: Math.PI / 2,
      sweep: 0.7, reach: 1.0, lift: 0.5, duty: 0.4, phase: 2.9 },
    { kind: 'welder', x: CRADLE.x - 8.5 * cy, z: CRADLE.z + 8.5 * sy + 1.5, yaw: Math.PI / 2 - CRADLE.yaw,
      sweep: 0.5, reach: 0.9, lift: 0.7, duty: 0.45, phase: 5.4 },
    { kind: 'welder', x: HULL.x + HULL.wide * 0.5 + 2.6, z: HULL.z - 2, yaw: -Math.PI / 2,
      sweep: 0.55, reach: 0.95, lift: 0.9, duty: 0.5, phase: 1.7 },
    /* PIT DROIDS, folded: a bulkhead panel in the starboard sliver, the
     * cradle's open engine bay, the port wall foot. */
    { kind: 'pit', x: SLIVER.x, z: SLIVER.z0 + 1.5, yaw: Math.PI, phase: 0.3 },
    { kind: 'pit', x: CRADLE.x + 3.5 * cy + 0.6 * sy, z: CRADLE.z - 3.5 * sy - 5.0, yaw: -CRADLE.yaw + Math.PI, phase: 1.3 },
    { kind: 'pit', x: FLANK_L.x0 + 4, z: (FLANK_L.z0 + FLANK_L.z1) * 0.5, yaw: -Math.PI / 2, phase: 2.2 },
    /* MOUSE DROIDS: both slivers, and the starboard wall foot forward. */
    { kind: 'mouse', path: [SLIVER.x, SLIVER.z0 + 4, SLIVER.x, SLIVER.z1], yaw: 0, phase: 0.1 },
    { kind: 'mouse', path: [-SLIVER.x, SLIVER.z1, -SLIVER.x, SLIVER.z0 + 4], yaw: 0, phase: 0.5 },
    { kind: 'mouse', path: [W.x1 - 7, W.z1 + 2, W.x1 - 7, DECK_ZONES.apron.z0 + 2], yaw: 0, phase: 0.8 },
    /* GONKS: the port flank, and the work zone's forward end. */
    { kind: 'gonk', path: [FLANK_L.x0 + 10, FLANK_L.z1 - 3, FLANK_L.x0 + 10, FLANK_L.z0 + 4], yaw: 0, phase: 0.4 },
    { kind: 'gonk', path: [W.x1 - 16, W.z0 + 64, W.x1 - 16, W.z1 - 8], yaw: 0, phase: 0.7 },
  ]);
}

/** Turret, boom and forearm: the three things on a welder that turn. */
function welderArm(world, group, M) {
  const steel = M.steel;
  const turret = mover(world, group);
  turret.position.set(0, 0.76, 0);
  const tb = new Bin();
  tb.put(steel, cylGeo(0.30, 0.32, 0.44, 12, 0.8), 0, 0.22, 0);
  tb.put(steel, slabGeo(0.30, 0.26, 0.28, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.34, -0.30);
  for (const sx of [-1, 1]) tb.put(steel, slabGeo(0.11, 0.36, 0.22, { bevel: 0.025, seg: 2, tile: 1.1 }), sx * 0.21, 0.48, 0.04);
  tb.put(steel, slabGeo(0.40, 0.16, 0.22, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.58, 0.16, -0.30, 0, 0);
  tb.put(steel, slabGeo(0.30, 0.05, 0.05, { bevel: 0.015, seg: 1, tile: 0.6 }), 0, 0.64, 0.25, -0.30, 0, 0);
  tb.bake(world, turret);
  const boom = mover(world, turret);
  boom.position.set(0, 0.48, 0.04);
  const bb = new Bin();
  bb.put(steel, slabGeo(0.15, 0.92, 0.15, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.46, 0);
  bb.put(steel, cylGeo(0.055, 0.055, 0.62, 8, 0.6), 0.11, 0.34, -0.10, 0.22, 0, 0);
  bb.put(steel, cylGeo(0.085, 0.085, 0.20, 8, 0.6), 0, 0.92, 0, 0, 0, Math.PI / 2);
  bb.bake(world, boom);
  const fore = mover(world, boom);
  fore.position.set(0, 0.92, 0);
  const fb = new Bin();
  fb.put(steel, slabGeo(0.12, 0.66, 0.12, { bevel: 0.025, seg: 2, tile: 1.1 }), 0, 0.33, 0);
  fb.put(steel, slabGeo(0.17, 0.15, 0.17, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.70, 0);
  fb.bake(world, fore);
  return { turret, boom, fore };
}

function addDroids(world, life) {
  const M = deckMaterials();
  const C = castMaterials(world._deckFaction);
  const jobs = droidJobs();
  const byKind = new Map();
  for (const J of jobs) byKind.set(J.kind, (byKind.get(J.kind) || 0) + 1);
  /* ONE INSTANCED MESH PER KIND. */
  const meshes = {};
  const next = {};
  for (const [kind, n] of byKind) {
    const built = DROID_BUILDERS[kind]();
    const im = new THREE.InstancedMesh(built.geo, C.cast, n);
    im.frustumCulled = false;
    im.castShadow = true; im.receiveShadow = true;
    im.name = `deck-droid-${kind}`;
    world.scene.add(im);
    world.statics.push(im);
    meshes[kind] = im;
    next[kind] = 0;
  }
  const dome = astromechDome(), leg = astromechLeg();
  const droids = [];
  let arc = 0, eye = 0;
  for (const J of jobs) {
    const K = DROID_KINDS[J.kind];
    const x = J.path ? J.path[0] : J.x, z = J.path ? J.path[1] : J.z;
    const y = groundAt(world, x, z);
    const yaw = J.path ? Math.atan2(J.path[2] - J.path[0], J.path[3] - J.path[1]) : J.yaw;
    const d = {
      kind: J.kind, job: J, i: next[J.kind]++, mesh: meshes[J.kind], K,
      kn: new Knockable(world, _v.set(x, y, z), { half: K.half, mass: K.mass, facing: yaw, pace: Math.max(K.speed, 0.6) }),
      x, y, z, yaw, t: J.phase * 7, at: J.phase, dir: 1, hold: J.phase * 3, was: false,
      tip: new THREE.Vector3(), heat: 0, spark: 0, slot: -1,
    };
    if (J.kind === 'welder') {
      const g = mover(world);
      g.position.set(x, y, z); g.rotation.y = yaw;
      d.group = g;
      Object.assign(d, welderArm(world, g, M));
      d.slot = GLOW.arc + arc++;
    } else if (J.kind === 'astro') {
      const g = mover(world);
      g.position.set(x, y, z); g.rotation.y = yaw;
      d.group = g;
      d.dome = castMesh(world, g, dome.geo.clone(), C.cast, 'deck-astro-dome');
      d.dome.position.set(0, 1.46, 0);
      d.leg = castMesh(world, g, leg.geo.clone(), C.cast, 'deck-astro-leg');
      d.leg.position.set(0, 0.62, 0.30);
      d.leg.rotation.x = -1.4;
      d.slot = GLOW.eye + eye++;
    }
    droids.push(d);
  }
  dome.geo.dispose(); leg.geo.dispose();
  life.droids = droids;
  life.droidMeshes = meshes;
}

const DROID_CYCLE = 5.4;

/** Write one droid's chassis instance from a place and a heading, plus a lean. */
function droidPlace(d, x, y, z, yaw, roll = 0, pitch = 0) {
  _eu.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_eu);
  _v.set(x, y, z); _s.set(1, 1, 1);
  d.mesh.setMatrixAt(d.i, _m.compose(_v, _q, _s));
  d.mesh.instanceMatrix.needsUpdate = true;
  if (d.group) { d.group.position.set(x, y, z); d.group.quaternion.copy(_q); }
}

/** …and from the body, when the body is the one deciding. */
function droidFromBody(d) {
  const kn = d.kn;
  _v.copy(kn.at); _s.set(1, 1, 1);
  d.mesh.setMatrixAt(d.i, _m.compose(_v, kn.quaternion, _s));
  d.mesh.instanceMatrix.needsUpdate = true;
  if (d.group) { d.group.position.copy(kn.at); d.group.quaternion.copy(kn.quaternion); }
}

function stepDroids(world, life, dt) {
  const fx = world.particles;
  const eng = world.engine;
  for (const d of life.droids) {
    d.t += dt;
    const kn = d.kn;
    kn.update(dt);
    const J = d.job, K = d.K;
    /* ── KNOCKED OVER, GETTING UP, OR WALKING BACK: the body decides. */
    if (kn.state !== 'post') {
      droidFromBody(d);
      if (d.slot >= 0 && d.kind === 'welder') { glowBurn(life, d.slot, 0, 0, 0); d.heat = 0; }
      if (d.kind === 'astro') {
        /* A thrown astromech folds its leg and the dome stops. */
        d.leg.rotation.x = lerp(d.leg.rotation.x, -1.4, 1 - Math.exp(-6 * dt));
        d.dome.updateMatrixWorld(true);
        _m4.makeRotationX(Math.PI / 2 - 0.6).setPosition(0, 0.30, 0.46).premultiply(d.dome.matrixWorld);
        glowPlace(life, d.slot, _m4, 0.06, 0.05);
        glowBurn(life, d.slot, 0.4, 0.1, 0.05);
      }
      continue;
    }
    /* ── ON ITS BASE: run the job. */
    if (J.path) {
      const span = Math.hypot(J.path[2] - J.path[0], J.path[3] - J.path[1]);
      const moving = d.hold <= 0;
      if (d.hold > 0) d.hold -= dt;
      else {
        d.at += (K.speed / span) * d.dir * dt;
        if (d.at >= 1) { d.at = 1; d.dir = -1; d.hold = 3 + (d.i * 5 + Math.floor(d.t)) % 6; }
        else if (d.at <= 0) { d.at = 0; d.dir = 1; d.hold = 3 + (d.i * 3 + Math.floor(d.t)) % 5; }
      }
      const x = lerp(J.path[0], J.path[2], d.at), z = lerp(J.path[1], J.path[3], d.at);
      const y = groundAt(world, x, z);
      const yaw = Math.atan2((J.path[2] - J.path[0]) * d.dir, (J.path[3] - J.path[1]) * d.dir);
      /* THE GAIT OF EACH KIND is in its lean: a gonk rocks side to side at a
       * slow beat, a mouse droid is flat, an astromech tips back onto its
       * third leg. */
      const roll = d.kind === 'gonk' && moving ? Math.sin(d.t * 5.2) * 0.09 : 0;
      const pitch = d.kind === 'astro' ? lerp(0, -0.22, d.lean = lerp(d.lean || 0, moving ? 1 : 0, 1 - Math.exp(-4 * dt))) : 0;
      const bob = d.kind === 'gonk' && moving ? Math.abs(Math.sin(d.t * 5.2)) * 0.05 : 0;
      if (moving || d.x !== x || d.z !== z) kn.drive(x, z, yaw);
      d.x = x; d.z = z; d.yaw = yaw;
      droidPlace(d, x, y + bob, z, yaw, roll, pitch);
      if (d.kind === 'astro') {
        /* The third leg drops when it rolls, the dome hunts, the eye blinks. */
        d.leg.rotation.x = lerp(-1.4, 0, d.lean);
        d.dome.rotation.y = Math.sin(d.t * 0.7) * 0.9 + (moving ? 0 : Math.sin(d.t * 2.3) * 0.25);
        d.dome.updateMatrixWorld(true);
        _m4.makeRotationX(Math.PI / 2 - 0.6).setPosition(0, 0.30, 0.46).premultiply(d.dome.matrixWorld);
        glowPlace(life, d.slot, _m4, 0.06, 0.05);
        const blink = (Math.sin(d.t * 3.1) > 0.85 ? 0.2 : 1) * (0.8 + 0.2 * Math.sin(d.t * 11));
        glowBurn(life, d.slot, 1.6 * blink, 0.35 * blink, 0.1 * blink);
        if (moving) {
          eng?.lightUp?.(_v.set(x, y + 1.7, z), 0xff6040, 2.0, 3, 0);
        }
      }
      continue;
    }
    /* A standing droid's chassis is written once, and again only after it has
     * been knocked over — the body says where it landed. */
    if (!d.was) { droidPlace(d, d.x, d.y, d.z, d.yaw); d.was = true; }
    if (d.kind === 'pit') {
      /* A folded pit droid twitches: the head nods on a slow beat. Written
       * into the instance as a pitch. */
      droidPlace(d, d.x, d.y, d.z, d.yaw, 0, Math.sin(d.t * 1.3) * 0.02);
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
    d.turret.rotation.y = welding ? hold : lerp(hold, Math.sin((n + 1) * 2.399963) * J.sweep, smoothstep(J.duty, 1.0, ph));
    const bob = Math.sin(d.t * 0.9 + J.phase) * 0.035;
    d.boom.rotation.x = J.lift + bob;
    d.fore.rotation.x = -J.reach - bob * 1.6 + (welding ? Math.sin(d.t * 7.3) * 0.012 : 0);
    d.turret.updateMatrixWorld(true);
    d.tip.set(0, 0.93, 0).applyMatrix4(d.fore.matrixWorld);
    _m4.identity().setPosition(0, 0.85, 0).premultiply(d.fore.matrixWorld);
    glowPlace(life, d.slot, _m4, 0.11, 0.16);
    const flick = welding ? 0.55 + 0.45 * Math.sin(d.t * 41.7) * Math.sin(d.t * 17.3 + 1.1) : 0;
    d.heat = lerp(d.heat, flick, 1 - Math.exp(-18 * dt));
    const w = 0.07 + d.heat * 1.5;
    glowBurn(life, d.slot, w * 0.74, w * 0.85, w);
    if (d.heat > 0.05) eng?.lightUp?.(d.tip, 0xbcd8ff, 22 * d.heat, 11, 0);
    d.spark += dt;
    if (welding && d.spark > 0.14) {
      d.spark = 0;
      _v.set(0, -1, 0);
      fx?.sparkBurst?.(d.tip, _v, 5, { speed: 5.5, color: 0xffe2b0, hdr: 3.0, flash: false, embers: false });
    }
  }
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
  bb.bake(world, body);
  const hoist = mover(world, body);
  hoist.position.set(0, -0.28, 0);
  const hb = new Bin();
  hb.put(M.steel, cylGeo(0.028, 0.028, 2.60, 6, 0.6), 0, -1.30, 0);
  hb.put(M.steel, torusGeo(0.26, 0.055, 5, 10, Math.PI * 1.5, 0.6), 0, -2.72, 0, Math.PI / 2, 0, 0.4);
  hb.put(M.steel, slabGeo(1.10, 0.80, 0.90, { bevel: 0.05, seg: 2, tile: 1.1 }), 0, -3.35, 0);
  hb.put(M.steel, slabGeo(1.16, 0.08, 0.96, { bevel: 0.02, seg: 1, tile: 0.6 }), 0, -3.72, 0);
  hb.bake(world, hoist);
  life.trolley = { run: T, body, hoist, t: 0, at: 0, dir: 1, swing: 0, swingV: 0, hold: 0, vel: 0 };
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
  return (CRANES = [
    { x: -railX, y: railY - 0.7, x0: z0, x1: z1, speed: 1.2, hold: 18, drop: 22, load: 'plate', phase: 0.15 },
    { x: railX, y: railY - 0.7, x0: z1, x1: z0, speed: 1.05, hold: 24, drop: 26, load: 'engine', phase: 0.7 },
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
    castMesh(world, body, A.merge(), C.cast, 'deck-crane');
    const hoist = mover(world, body);
    hoist.position.set(0, -1.3, 0);
    const H = new Assembly();
    H.cyl(0x6a7079, 0.05, 0.05, R.drop, 0.5, -R.drop / 2, 0, 0, 0, 0, 6);
    H.cyl(0x6a7079, 0.05, 0.05, R.drop, -0.5, -R.drop / 2, 0, 0, 0, 0, 6);
    H.box(dark, 2.0, 0.6, 0.6, 0, -R.drop - 0.2, 0);
    H.ring(0x8d939b, 0.4, 0.08, 0, -R.drop - 0.8, 0, 0, Math.PI / 2, 0, 10);
    if (R.load === 'plate') {
      /* A hull plate in slings: a big bevelled slab with a rib and a row of
       * fixing holes along one edge. */
      H.box(wing, 6.0, 0.35, 4.0, 0, -R.drop - 2.4, 0);
      H.box(dark, 6.0, 0.2, 0.4, 0, -R.drop - 2.1, 1.6);
      for (let i = 0; i < 6; i++) H.box(dark, 0.2, 0.4, 0.2, -2.5 + i, -R.drop - 2.4, -1.7);
      H.pair((s) => H.cyl(0x6a7079, 0.04, 0.04, 2.0, s * 2.6, -R.drop - 1.5, 0, 0, 0, s * 0.9, 5));
    } else {
      /* An engine: a pod with a bell and three collars, hung by its lugs. */
      H.cyl(dark, 1.2, 1.1, 5.0, 0, -R.drop - 3.0, 0, 0, 0, Math.PI / 2, 12);
      H.cyl(0x1a1d22, 1.25, 0.9, 0.9, -2.9, -R.drop - 3.0, 0, 0, 0, Math.PI / 2, 12);
      for (let i = 0; i < 3; i++) H.ring(0x8d939b, 1.22, 0.08, -1.5 + i * 1.5, -R.drop - 3.0, 0, 0, Math.PI / 2, 0, 14);
      H.pair((s) => H.cyl(0x6a7079, 0.04, 0.04, 1.6, s * 1.4, -R.drop - 1.5, 0, 0, 0, s * 0.6, 5));
    }
    castMesh(world, hoist, H.merge(), C.cast, 'deck-crane-load');
    cranes.push({ run: R, body, hoist, at: R.phase, dir: 1, hold: 0, swing: 0, swingV: 0, vel: 0 });
  }
  life.cranes = cranes;
}

function stepCranes(life, dt) {
  for (const T of life.cranes) stepCrab(T, T.run, dt, 'z');
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
  return (SLEDS = [
    { z: deep(0.33), x0: across(-0.05), x1: across(0.76), along: 'x', speed: 4.0, hold: 3.5, ride: 0.42, phase: 0.0 },
    { x: W.x1 - 10, z0: W.z0 + 2, z1: W.z1 - 4, along: 'z', speed: 3.6, hold: 4.5, ride: 0.42, phase: 0.5 },
    { z: BAND.z0 + 4.5, x0: BAND.x0, x1: BAND.x1, along: 'x', speed: 3.2, hold: 5.0, ride: 0.42, phase: 0.8 },
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
  life.sleds = { mesh: im, runs, state: runs.map((R) => ({ at: R.phase, dir: 1, hold: 1.2 + R.phase * 3, t: R.phase * 9, gy: undefined })) };
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
    glowPlace(life, GLOW.beacon + i, _mb, 0.20, 0.20);
    const bl = 0.55 + 0.45 * Math.sin(s.t * 3.1);
    glowBurn(life, GLOW.beacon + i, 1.5 * bl, 0.72 * bl, 0.18 * bl);
    world.engine?.lightUp?.(_v.set(x, y + 0.9, z), 0xffa838, 6, 8, 0);
  }
  S.mesh.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  7 · THE WORKERS                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THIRTEEN MEN, EVERY ONE A BODY, TEN OF THEM WITHIN SIXTY METRES ══════
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
  const { BAY, SCAFFOLD, CRADLE, HULL, STAND, BOWSER, FLANK_R, FLANK_L, BAND, APRON } = frame();
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
      run: false, target: null, wasDown: false,
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
  glowPlace(life, GLOW.torch, _m4, 0.07, 0.20);
  const b = 0.08 + w.heat * 1.6 + (strike ? 3.4 : 0);
  glowBurn(life, GLOW.torch, b * 0.84, b * 0.92, b);
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

/** Two crash men leave the station for the pad, and come back when it clears. */
function callCrashCrew(life, x, z, out) {
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
      /* THE FIGHTER: port pad, entering from starboard across the apron. */
      { kind: 'fighter', pad: { x: APRON.padL.x, z: APRON.padL.z, y: gy(APRON.padL) },
        entry: { x: APRON.padL.x + 50, y: 30 }, farX: 90, farY: 130,
        farIn: 26, inDur: 9, sit: 30, spin: 4, out: 2.6, farOut: 26, gap: 12, t0: 14, flight: 7,
        damagedEvery: 2, slot: 6, glow: 0 },
      /* THE SHUTTLE: starboard pad, entering from port. Longer everything. */
      { kind: 'shuttle', pad: { x: APRON.padR.x, z: APRON.padR.z, y: gy(APRON.padR) },
        entry: { x: APRON.padR.x - 50, y: 32 }, farX: -110, farY: 150,
        farIn: 28, inDur: 11, sit: 44, spin: 5, out: 3.0, farOut: 28, gap: 22, t0: 28 + 11 + 8, flight: 12,
        damagedEvery: 0, slot: 1, glow: 1 },
      /* THE SECOND FIGHTER: the starboard corner, entering from the centre
       * line; starts its first cycle already down and smoking, so the deck
       * has a damaged hull on it from the first frame. Every third of its
       * arrivals is damaged, so the two fighters' bad days do not line up. */
      { kind: 'fighter', pad: { x: APRON.padS.x, z: APRON.padS.z, y: gy(APRON.padS) },
        entry: { x: APRON.padS.x - 40, y: 28 }, farX: 20, farY: 120,
        farIn: 27, inDur: 9, sit: 36, spin: 4, out: 2.6, farOut: 27, gap: 16, t0: 27 + 9 + 4, flight: 3,
        damagedEvery: 3, slot: 7, glow: 2 },
    ],
    /* The far mesh slots: formation 0-3, pair 4-5, the fighters' own legs
     * 6 and 7; shuttle loop 0, shuttle's own leg 1. */
    farFighters: 8, farShuttles: 2,
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
  const slot = GLOW.engine + H.glow * 2;
  for (let i = 0; i < 2; i++) {
    const b = H.cast.bells[Math.min(i, H.cast.bells.length - 1)];
    _mb.makeRotationX(Math.PI / 2).setPosition(b.x, b.y, b.z - 0.3);
    glowPlace(life, slot + i, _mb.premultiply(g.matrixWorld), b.r * 1.9, b.r * 1.6);
    glowBurn(life, slot + i, burn * 0.55, burn * 0.82, burn);
  }
}

function hullAway(life, H) {
  H.cast.group.visible = false;
  const slot = GLOW.engine + H.glow * 2;
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
        H.damaged ? `clear pad ${H.kind === 'fighter' ? 1 : 2} — crash crew to the apron`
          : `pad ${H.kind === 'fighter' ? 1 : 2} clear to receive`);
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
        callCrashCrew(life, px, pz, true);
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
      callCrashCrew(life, px, pz, false);
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
const PA = { gap: 14, slots: 3 };

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
    droids: [], rings: [], workers: [], cranes: [], fog0: null, far0: null,
    pa: { at: -99, n: 0, titles: [], subs: [], made: 0, mustered: false, lift: null },
  };
  world._deckLife = life;
  life.holes = scanHoles(world);
  for (const V of life.vents) V[1] += groundAt(world, V[0], V[2]);
  addDeckHaze(world, life);
  addJobs(world, life);
  addGlows(world, life);
  addDroids(world, life);
  addTrolley(world, life);
  addCranes(world, life);
  addSleds(world, life);
  addWorkers(world, life);
  addTraffic(world, life);
  addFieldRings(world, life);
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

/** Give back the camera's far plane and the bodies. Idempotent. */
export function undressDeckLife(world) {
  const life = world?._deckLife;
  if (!life) return;
  const cam = world.engine?.camera;
  if (cam && life.far0 != null) { cam.far = life.far0; cam.updateProjectionMatrix?.(); life.far0 = null; }
  for (const d of life.droids) { try { d.kn.dispose(); } catch {} }
  for (const w of life.workers) { try { w.shove.dispose(); } catch {} }
  if (life.traffic) for (const H of life.traffic.plan.hulls) { try { hullSolid(world, H, false); } catch {} }
  life.droids = []; life.workers = [];
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
  stepVents(world, life, dt);
  stepTraffic(world, life, dt);
  stepPA(world, life, dt);
  stepField(world, life, dt);
  stepRings(life, dt);
}
