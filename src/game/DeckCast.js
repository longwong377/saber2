/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE DECK'S CAST — the things on it you can pick up, and the ships
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `DeckLife.js` schedules what happens on the flight deck; this file BUILDS
 * the things it happens to. It was split out for the reason the player gave,
 * verbatim:
 *
 *   "all the actual repair men/workers are garbage looking stand ins like I
 *    would give it a 1/10 they don't even have physics" … "everything you can
 *    touch has to be modeled" … "countless ships and droids and workers and
 *    other shit I can throw around"
 *
 * Three families, and each is a builder here and a schedule over there:
 *
 *   DROIDS   nine kinds. An astromech (dome, photoreceptor, two legs and a
 *            third that drops when it rolls), the tracked welder the room
 *            already had, a pit droid folded and a pit droid up and working,
 *            a mouse droid, a gonk, a treadwell on its wheel, a protocol
 *            droid, and a binary load-lifter with a crate. Each kind is ONE
 *            vertex-coloured geometry, so a whole kind draws as one
 *            `InstancedMesh` whatever the count; the parts that turn — a
 *            dome, a leg, a welder's arm — are instanced too, one mesh per
 *            part for the whole deck (DeckLife composes their matrices).
 *   PAINT    a droid whose vertices are PURE WHITE takes its colour from the
 *            instance — `castMaterials().tint` reads `instanceColor` only
 *            where the vertex colour is (1, 1, 1) — so twenty-four
 *            astromechs in six panel schemes are one draw call, and eighty
 *            crew silhouettes in three suit tones are one per pose.
 *   CREW SILHOUETTES  `crewSilhouettes` poses the game's own skeleton with
 *            `BipedAnimator` — the same gait every worker walks — and bakes
 *            each pose to a two-hundred-triangle man of bone boxes, so the
 *            crowd past thirty metres flips through six frames of the real
 *            walk for one draw call a frame.
 *   WORKERS  humanoids on the game's own skeleton (`Rig.humanoidSkeleton`),
 *            dressed by the same `dressHumanoid` every trooper and Jedi goes
 *            through, in a jumpsuit rather than plate: cap, headset, tool
 *            belt, knee pads. Three materials, so `MergedSkin` folds one to
 *            three draw calls once he stops.
 *   HULLS    a fighter and a shuttle at the fidelity of `Vehicles.js` — panel
 *            lines, canopy, cannons, bells, gear, greebles, 120-200
 *            primitives each — baked to three meshes: the hull, the glass,
 *            and the gear that folds. And the SILHOUETTE geometry for the
 *            outside leg, taken straight from `DeckKit.parkedFighter` so a
 *            speck at 700 m is the same ship the racks are full of.
 *
 * ── PHYSICS ON EVERY ONE OF THEM ──────────────────────────────────────────
 *
 * `Knockable` below is `src/physics/Shovable.js`'s cycle — POST, DOWN, REST,
 * RISE, BACK — for a body that is not a man: it takes its own half-extents and
 * mass, and it can be DRIVEN while posted, which is how an astromech rolls
 * between jobs and stays a thing the Force can pick up. The clock numbers are
 * `SHOVE`'s own, imported and not retyped: a droid lies there as long as a
 * trooper does, and gets up in the same 1.35 s, because those two numbers are
 * the game's answer to "how long is being knocked over" and a second opinion
 * would be a second thing to tune. The workers use `Shovable` itself.
 *
 * ── EVERYTHING IS VERTEX-COLOURED, AND WHY ─────────────────────────────────
 *
 * The deck is drawn with an ink pass that rasterises every opaque object a
 * second time, so the budget is draw calls and not triangles. A droid with
 * white panels, a blue dome and black treads is three materials and three
 * draws if the colour is on the material — and ONE if it is on the vertices.
 * `Assembly` below paints every primitive it is handed and merges the lot into
 * a single buffer under `castMaterials().cast`, which is the only lit material
 * the whole cast shares. The faction's own hull, wing and dark colours come
 * off `deckMats(faction)` so a Separatist deck gets Separatist ships without
 * a second material set.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { TAU } from '../engine/MathUtil.js';
import { mergeGeos } from '../world/Props.js';
import { Body, LAYER, box, boxSpheres } from '../physics/RapierWorld.js';
import { SHOVE, STATE } from '../physics/Shovable.js';
import { Rig, humanoidSkeleton, BipedAnimator } from './Rig.js';
import { dressHumanoid } from './Bodies.js';
import { DeckBuild, deckMats, parkedFighter, factionOf } from './DeckKit.js';

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/* ══════════════════════════════════════════════════════════════════════ */
/*  MATERIALS — one lit surface for the whole cast, per army              */
/* ══════════════════════════════════════════════════════════════════════ */

const _mats = new Map();

/**
 * Cached per faction, like `deckMats`, and for the same reason: two Worlds in
 * one process must not share a material one of them will dispose. Named with
 * the `deck-<army>-` prefix `faction.mjs` buckets by, so a Republic fighter
 * on a Separatist deck is a red check and not a surprise.
 */
export function castMaterials(faction) {
  const id = factionOf(faction);
  const hit = _mats.get(id);
  if (hit) return hit;
  const M = { faction: id };
  /* THE ONE SURFACE. Roughness between the room's hull (0.66) and its wing
   * (0.58): machinery, not plate. The colour is white so the vertex colour
   * is the colour. */
  M.cast = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.30 });
  /**
   * THE OUTSIDE LEG IS UNFOGGED. `HANGAR_LEVEL.atmosphere` is exp2 fog and
   * DeckLife solves its density against the aperture rim; either way a ship
   * 300 m past the lip is 80% fog colour and a speck at 700 m is gone. But
   * there is no haze OUTSIDE the aperture — that is space — so the far hulls
   * carry no fog term at all and DeckLife darkens them by distance itself.
   */
  M.far = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.30, fog: false });
  /**
   * THE PAINTED SURFACE. The same lit material, with one change in the
   * vertex shader: three's `color_vertex` multiplies EVERY vertex by
   * `instanceColor`, which would tint an astromech's white can and black
   * treads along with its panels. Here a vertex takes the instance colour
   * only if its own colour is pure white — `PAINT` — and keeps its vertex
   * colour otherwise. So one geometry, one draw call, and a colour a droid.
   * `customProgramCacheKey` so three compiles this once and does not share
   * the program with `cast`.
   */
  M.tint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.30 });
  M.tint.onBeforeCompile = paintCompile;
  M.tint.customProgramCacheKey = () => 'deck-cast-paint';
  /* A canopy: dark glass, a little transparent so the seat frame reads
   * through it at close range. `saberNoInk` — a pane has no silhouette of its
   * own worth a second rasterisation. */
  M.glass = new THREE.MeshStandardMaterial({
    color: 0x1a2632, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.82,
  });
  M.glass.userData.saberNoInk = true;
  /* THE CREW. Matte, and three of them: a jumpsuit, skin, and the leather
   * and canvas of belt, boots, cap and headset. `MergedSkin` bins by
   * appearance, so three materials is three draws a man once he is baked. */
  M.suit = new THREE.MeshStandardMaterial({ color: 0x5a5f4c, roughness: 0.94, metalness: 0.02 });
  M.suitB = new THREE.MeshStandardMaterial({ color: 0x4a4e5e, roughness: 0.94, metalness: 0.02 });
  M.skin = new THREE.MeshStandardMaterial({ color: 0xc79a76, roughness: 0.78, metalness: 0.0 });
  M.gear = new THREE.MeshStandardMaterial({ color: 0x2a2621, roughness: 0.72, metalness: 0.08 });
  for (const k of Object.keys(M)) if (M[k] && M[k].isMaterial) M[k].name = `deck-${id}-cast-${k}`;
  _mats.set(id, M);
  return M;
}

/** The vertex colour that means "take the instance's colour". */
export const PAINT = 0xffffff;

/** The one shader edit `castMaterials().tint` makes; see there. */
function paintCompile(shader) {
  shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', /* glsl */`
    vColor = vec3( 1.0 );
    #ifdef USE_COLOR
      vColor *= color;
    #endif
    #ifdef USE_INSTANCING_COLOR
      float paint = step( 2.97, color.r + color.g + color.b );
      vColor.xyz = mix( vColor.xyz, instanceColor.xyz, paint );
    #endif
  `);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  ASSEMBLY — paint a primitive, place it, merge the lot                 */
/* ══════════════════════════════════════════════════════════════════════ */

/** Write one flat colour into a geometry's `color` attribute. */
export function tint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * A pile of coloured primitives that becomes one geometry. `prims` is kept
 * so a check can price a builder in the unit the brief states it in.
 */
export class Assembly {
  constructor() { this.geos = []; this.prims = 0; }

  put(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (rx || ry || rz) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz)));
    if (x || y || z) geo.translate(x, y, z);
    tint(geo, hex);
    this.geos.push(geo);
    this.prims++;
    return this;
  }

  box(hex, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.put(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz);
  }

  cyl(hex, r0, r1, h, x, y, z, rx = 0, ry = 0, rz = 0, radial = 10) {
    return this.put(new THREE.CylinderGeometry(r0, r1, h, radial), hex, x, y, z, rx, ry, rz);
  }

  ball(hex, r, x, y, z, ws = 10, hs = 7) {
    return this.put(new THREE.SphereGeometry(r, ws, hs), hex, x, y, z);
  }

  ring(hex, r, tube, x, y, z, rx = 0, ry = 0, rz = 0, seg = 12) {
    return this.put(new THREE.TorusGeometry(r, tube, 5, seg), hex, x, y, z, rx, ry, rz);
  }

  /** Both sides at once, authored per side and never mirrored by scale. */
  pair(fn) { fn(1); fn(-1); return this; }

  merge() {
    const g = mergeGeos(this.geos);
    this.geos = [];
    return g;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE DROIDS — five kinds, one geometry each                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The palette every droid is painted from. Kept off the deck's own — a droid
 * is not deck furniture and does not swap with the army: an astromech is
 * white and blue on either side's flight deck.
 */
const D = {
  white: 0xd8dde3, blue: 0x2f5fa8, steel: 0x6a7079, dark: 0x1e2126, trim: 0xb8842e,
  rust: 0x7a4a2c, lens: 0x0a0d12, red: 0xc03a2c, tan: 0x9a8d6c, grey: 0x8d939b,
};

/**
 * ══ WHAT EACH KIND IS, IN ONE ROW ═════════════════════════════════════════
 *
 *   half   the body's half-extents (x, y, z), which is also the collider
 *   mass   kilograms — an astromech is a heavy little machine and a mouse
 *          droid is a shoebox; the Force's lift limit is about 78 kg, so the
 *          mouse and the pit droid come off the deck and the gonk does not
 *   speed  how fast it moves when it moves, metres a second
 *   rolls  whether it travels at all
 */
export const DROID_KINDS = {
  astro:  { half: [0.50, 0.62, 0.40], mass: 32, speed: 1.6, rolls: true },
  welder: { half: [0.62, 0.50, 0.80], mass: 140, speed: 0, rolls: false },
  pit:    { half: [0.30, 0.60, 0.26], mass: 18, speed: 0, rolls: false },
  /** A pit droid UP and working: taller, lighter on its feet, and it stands. */
  pitup:  { half: [0.26, 0.60, 0.22], mass: 18, speed: 0, rolls: false },
  mouse:  { half: [0.18, 0.12, 0.26], mass: 6, speed: 3.4, rolls: true },
  gonk:   { half: [0.42, 0.62, 0.36], mass: 95, speed: 0.55, rolls: true },
  /** A treadwell: a box of tools on a column on one wheel, and it rolls. */
  tread:  { half: [0.34, 0.70, 0.34], mass: 40, speed: 0.9, rolls: true },
  /** A protocol droid: a man's size, a man's weight, walks at a man's pace. */
  proto:  { half: [0.28, 0.86, 0.20], mass: 70, speed: 1.1, rolls: true },
  /** A binary load-lifter with a crate: heavy, slow, and the Force does not lift it. */
  lifter: { half: [0.60, 1.20, 0.55], mass: 260, speed: 0.6, rolls: true },
};

/**
 * ASTROMECH PANEL SCHEMES. The can is off-white on all of them; the panels,
 * the dome's panels and the shoulder studs are `PAINT` and take one of these
 * per instance. Blue first, because an R2 unit is blue before it is anything
 * else; the rest are the schemes every hangar reference has a few of.
 */
export const ASTRO_SCHEMES = [0x2f5fa8, 0xb8352a, 0x2e7d4f, 0xd07a1e, 0x5a3b8a, 0x2a2f36, 0xc9b23a];

/**
 * THE ASTROMECH. A cylinder with a dome, two legs on shoulders, and the
 * third leg is NOT here — it is `astromechLeg`, a mover, because it drops
 * when the droid rolls and folds when it stops. The dome is `astromechDome`
 * for the same reason: it turns.
 *
 * Twenty-two primitives; the blue is the panel colour of every reference
 * astromech and the whole silhouette is the dome on the can.
 */
export function astromechChassis() {
  const a = new Assembly();
  /* The can. */
  a.cyl(D.white, 0.50, 0.50, 0.96, 0, 0.98, 0, 0, 0, 0, 14);
  /* Panel lines and the recessed blue panels round the body. */
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * TAU;
    a.box(PAINT, 0.22, 0.28, 0.04, Math.sin(th) * 0.49, 1.10, Math.cos(th) * 0.49, 0, th, 0);
    a.box(D.dark, 0.16, 0.05, 0.04, Math.sin(th) * 0.49, 0.72, Math.cos(th) * 0.49, 0, th, 0);
  }
  /* The front tool bays and the power bus ladder. */
  a.box(D.dark, 0.30, 0.16, 0.06, 0, 1.30, 0.49);
  a.box(PAINT, 0.10, 0.06, 0.05, 0, 0.62, 0.50);
  /* Shoulders and legs, either side. */
  a.pair((s) => {
    a.cyl(D.white, 0.22, 0.22, 0.16, s * 0.58, 1.18, 0, 0, 0, Math.PI / 2, 12);
    a.box(PAINT, 0.10, 0.14, 0.14, s * 0.66, 1.18, 0);
    a.box(D.white, 0.16, 0.86, 0.26, s * 0.58, 0.72, -0.06);
    a.box(D.dark, 0.18, 0.10, 0.20, s * 0.58, 0.32, -0.02);
    /* The foot: a wedge on rollers. */
    a.box(D.white, 0.22, 0.20, 0.50, s * 0.58, 0.18, 0.02);
    a.cyl(D.dark, 0.06, 0.06, 0.20, s * 0.58, 0.07, 0.22, 0, 0, Math.PI / 2, 8);
  });
  return { geo: a.merge(), prims: a.prims };
}

/** The dome, in its own frame: origin at the dome's base ring. */
export function astromechDome() {
  const a = new Assembly();
  a.put(new THREE.SphereGeometry(0.50, 16, 8, 0, TAU, 0, Math.PI / 2), D.white, 0, 0, 0);
  a.ring(D.steel, 0.49, 0.03, 0, 0.02, 0, Math.PI / 2, 0, 0, 20);
  /* The photoreceptor housing, forward; the eye itself is a glow instance. */
  a.cyl(D.dark, 0.07, 0.09, 0.10, 0, 0.30, 0.42, Math.PI / 2 - 0.6, 0, 0, 10);
  /* Blue panels on the dome and the holoprojector nub. */
  for (let i = 0; i < 4; i++) {
    const th = (i / 4) * TAU + 0.4;
    a.box(PAINT, 0.14, 0.05, 0.16, Math.sin(th) * 0.32, 0.36, Math.cos(th) * 0.32, -0.7, th, 0);
  }
  a.cyl(D.steel, 0.05, 0.05, 0.10, 0.22, 0.44, 0.10, 0, 0, 0, 8);
  return { geo: a.merge(), prims: a.prims };
}

/** The third leg, hinged at its top: rotates down out of the belly to roll. */
export function astromechLeg() {
  const a = new Assembly();
  a.box(D.white, 0.14, 0.40, 0.14, 0, -0.20, 0);
  a.box(D.white, 0.18, 0.14, 0.36, 0, -0.44, 0.04);
  a.cyl(D.dark, 0.05, 0.05, 0.16, 0, -0.50, 0.18, 0, 0, Math.PI / 2, 8);
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE TRACKED WELDER — the chassis the room already had, moved off
 * `Props.Kit` and onto vertex colours so four of them are one draw. The arm
 * is `welderArm` in DeckLife (turret, boom, forearm: three movers).
 */
export function welderChassis() {
  const a = new Assembly();
  a.pair((s) => {
    a.box(D.steel, 0.40, 0.34, 1.42, s * 0.52, 0.26, 0);
    a.box(D.trim, 0.44, 0.10, 1.46, s * 0.52, 0.44, 0);
    for (let i = 0; i < 3; i++) a.cyl(D.dark, 0.135, 0.135, 0.30, s * 0.52, 0.17, (i - 1) * 0.46, 0, 0, Math.PI / 2, 8);
  });
  a.box(D.steel, 1.24, 0.24, 1.12, 0, 0.36, 0);
  a.box(D.steel, 1.06, 0.30, 1.06, 0, 0.60, 0);
  a.box(D.steel, 0.74, 0.36, 0.34, 0, 0.78, -0.50);
  a.cyl(D.trim, 0.09, 0.09, 0.44, 0.24, 0.98, -0.50);
  a.box(D.trim, 1.02, 0.09, 0.07, 0, 0.60, 0.55);
  a.ring(D.trim, 0.33, 0.045, 0, 0.755, 0, Math.PI / 2, 0, 0, 14);
  a.pair((s) => a.box(D.red, 0.10, 0.06, 0.05, s * 0.42, 0.70, 0.56));
  a.box(D.red, 0.16, 0.05, 0.16, 0, 0.98, -0.50);
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE PIT DROID, FOLDED. Knees up, arms in, the flat head hinged down on the
 * chest — the resting pose every reference shows a pit droid in, and the
 * pose that is a box 1.2 m tall, which is what lets it stand where a man
 * would be in the way.
 */
export function pitDroid() {
  const a = new Assembly();
  a.box(D.tan, 0.36, 0.44, 0.30, 0, 0.62, 0);          // torso
  a.box(D.dark, 0.30, 0.10, 0.06, 0, 0.72, 0.16);       // chest louvre
  a.box(D.tan, 0.30, 0.12, 0.40, 0, 1.00, 0.12, 0.9, 0, 0);   // the flat head, folded down
  a.cyl(D.lens, 0.05, 0.05, 0.06, 0, 1.02, 0.30, Math.PI / 2, 0, 0, 8);
  a.pair((s) => {
    a.box(D.tan, 0.09, 0.40, 0.09, s * 0.24, 0.62, 0.02, 0.5, 0, s * 0.2);   // upper arm in
    a.box(D.tan, 0.08, 0.30, 0.08, s * 0.20, 0.38, 0.14, -1.2, 0, 0);
    a.box(D.tan, 0.11, 0.42, 0.11, s * 0.13, 0.28, 0.12, 1.3, 0, 0);          // thigh up
    a.box(D.tan, 0.09, 0.36, 0.09, s * 0.13, 0.20, -0.06, -0.3, 0, 0);
    a.box(D.dark, 0.14, 0.06, 0.24, s * 0.13, 0.03, 0.02);                    // foot
  });
  a.cyl(D.rust, 0.04, 0.04, 0.34, 0, 0.42, 0.20, 0, 0, Math.PI / 2, 6);       // the hip bar
  return { geo: a.merge(), prims: a.prims };
}

/** THE MOUSE DROID. A wedge on a skirt, a sensor bump, a tail antenna. */
export function mouseDroid() {
  const a = new Assembly();
  a.box(D.dark, 0.34, 0.14, 0.50, 0, 0.13, 0);
  a.box(D.dark, 0.30, 0.10, 0.34, 0, 0.24, -0.04);
  a.box(D.grey, 0.26, 0.04, 0.30, 0, 0.30, -0.04);
  a.box(D.grey, 0.10, 0.03, 0.10, 0, 0.32, 0.12);
  a.cyl(D.red, 0.02, 0.02, 0.05, 0.10, 0.31, -0.18, 0, 0, 0, 6);
  a.cyl(D.steel, 0.008, 0.008, 0.22, -0.10, 0.40, -0.20, 0, 0, 0, 5);
  a.pair((s) => {
    a.cyl(D.steel, 0.05, 0.05, 0.04, s * 0.15, 0.06, 0.16, 0, 0, Math.PI / 2, 8);
    a.cyl(D.steel, 0.05, 0.05, 0.04, s * 0.15, 0.06, -0.16, 0, 0, Math.PI / 2, 8);
  });
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE GONK. A box with legs, and the whole character is that it is only a
 * box with legs: two thick shins, a face of vents, and a hazard stripe.
 * The waddle is the instance matrix rolling; nothing on it articulates.
 */
export function gonkDroid() {
  const a = new Assembly();
  a.box(D.rust, 0.80, 0.90, 0.66, 0, 0.78, 0);
  a.box(D.dark, 0.60, 0.20, 0.06, 0, 0.98, 0.34);
  for (let i = 0; i < 3; i++) a.box(D.dark, 0.50, 0.04, 0.05, 0, 0.62 + i * 0.10, 0.34);
  a.box(D.trim, 0.82, 0.08, 0.68, 0, 0.40, 0);
  a.pair((s) => {
    a.box(D.dark, 0.26, 0.36, 0.34, s * 0.24, 0.18, 0.02);
    a.box(D.steel, 0.30, 0.06, 0.40, s * 0.24, 0.03, 0.04);
  });
  a.cyl(D.steel, 0.06, 0.06, 0.24, 0.30, 1.32, -0.20, 0, 0, 0, 8);
  a.box(D.steel, 0.20, 0.16, 0.16, -0.24, 1.30, -0.10);
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE PIT DROID, UP. Standing on its bird legs, the flat head up, one arm
 * reaching for the work and the other holding a panel: what a gang of four
 * round a hull looks like from thirty metres. The arms are PAINT so a gang
 * can be told apart by a stripe.
 */
export function pitDroidUp() {
  const a = new Assembly();
  a.box(D.tan, 0.34, 0.40, 0.26, 0, 0.98, 0);                      // torso
  a.box(D.dark, 0.28, 0.08, 0.05, 0, 1.06, 0.14);                  // chest louvre
  a.cyl(D.rust, 0.05, 0.05, 0.16, 0, 1.26, 0, 0, 0, 0, 6);         // neck
  a.box(D.tan, 0.30, 0.12, 0.40, 0, 1.40, 0.06, -0.15, 0, 0);      // the flat head, up
  a.cyl(D.lens, 0.05, 0.05, 0.06, 0, 1.40, 0.28, Math.PI / 2, 0, 0, 8);
  a.pair((s) => {
    a.box(PAINT, 0.08, 0.34, 0.08, s * 0.24, 1.02, 0.08, s > 0 ? -1.1 : -0.3, 0, s * 0.25);   // upper arm
    a.box(D.tan, 0.07, 0.30, 0.07, s * 0.30, 0.98 + (s > 0 ? 0.20 : -0.10), s > 0 ? 0.34 : 0.20, s > 0 ? -1.4 : 0.4, 0, 0);
    a.box(D.tan, 0.10, 0.46, 0.10, s * 0.12, 0.56, 0.02, 0.25, 0, s * 0.08);                  // thigh
    a.box(D.tan, 0.08, 0.36, 0.08, s * 0.14, 0.22, -0.06, -0.5, 0, 0);                         // shin, knee back
    a.box(D.dark, 0.14, 0.05, 0.26, s * 0.15, 0.03, 0.04);                                     // foot
  });
  a.box(D.rust, 0.30, 0.05, 0.30, 0, 0.78, 0);                     // hip plate
  /* The panel in the left hand. */
  a.box(D.grey, 0.04, 0.50, 0.40, -0.40, 0.92, 0.18, 0, 0, 0.2);
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE TREADWELL. One fat wheel in a fork, a thin column, a box of a head
 * with two eyestalks and a rack of tools on the column: the WED droid every
 * Rebel hangar shot has one of, rolling somewhere slowly.
 */
export function treadwell() {
  const a = new Assembly();
  a.cyl(D.dark, 0.30, 0.30, 0.22, 0, 0.30, 0, 0, 0, Math.PI / 2, 12);          // the wheel
  a.pair((s) => a.box(D.steel, 0.05, 0.40, 0.30, s * 0.15, 0.48, 0));           // the fork
  a.box(D.steel, 0.40, 0.10, 0.44, 0, 0.70, 0);                                 // the fork's bridge
  a.cyl(D.steel, 0.05, 0.05, 0.70, 0, 1.08, 0, 0, 0, 0, 8);                     // the column
  a.box(PAINT, 0.36, 0.26, 0.30, 0, 1.52, 0);                                   // the head, painted
  a.pair((s) => {
    a.cyl(D.steel, 0.02, 0.02, 0.22, s * 0.10, 1.74, 0.06, -0.3, 0, s * 0.35, 5);   // eyestalk
    a.ball(D.lens, 0.045, s * 0.16, 1.84, 0.12, 6, 5);                              // eye
    a.box(D.trim, 0.06, 0.06, 0.34, s * 0.24, 1.10, 0.06, 0, 0, 0);                 // tool rack
    a.cyl(D.dark, 0.03, 0.03, 0.30, s * 0.24, 1.10, 0.28, Math.PI / 2, 0, 0, 5);    // a tool in it
  });
  a.box(D.dark, 0.24, 0.14, 0.20, 0, 1.30, 0);                                  // the junction box
  a.cyl(D.steel, 0.03, 0.03, 0.44, 0.06, 1.30, 0.26, 0.9, 0, 0, 5);             // the manipulator
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE PROTOCOL DROID. Gold plate over a wire midriff, a face with two eyes,
 * arms straight at the sides, and it walks the stiff walk — the instance's
 * pitch and a little roll are the whole gait, which is the joke of the
 * character. Nothing on it articulates. The plate is PAINT: gold as built,
 * silver or red on another instance.
 */
export function protocolDroid() {
  const a = new Assembly();
  a.box(PAINT, 0.36, 0.44, 0.24, 0, 1.24, 0);                       // chest
  a.box(D.dark, 0.26, 0.20, 0.18, 0, 0.92, 0);                       // the wire midriff
  for (let i = 0; i < 3; i++) a.cyl(D.steel, 0.012, 0.012, 0.22, -0.09 + i * 0.09, 0.92, 0.10, 0, 0, 0, 4);
  a.box(PAINT, 0.32, 0.16, 0.22, 0, 0.78, 0);                       // pelvis
  a.cyl(PAINT, 0.09, 0.10, 0.28, 0, 1.62, 0, 0, 0, 0, 10);         // head
  a.box(D.lens, 0.16, 0.05, 0.05, 0, 1.66, 0.09);                    // the eye band
  a.pair((s) => {
    a.ball(D.trim, 0.025, s * 0.04, 1.66, 0.10, 5, 4);               // eye
    a.box(PAINT, 0.09, 0.34, 0.09, s * 0.24, 1.24, 0, 0, 0, s * 0.06);   // upper arm
    a.box(PAINT, 0.08, 0.32, 0.08, s * 0.26, 0.92, 0.02, -0.15, 0, 0);   // forearm
    a.box(D.dark, 0.06, 0.10, 0.05, s * 0.27, 0.72, 0.06);              // hand
    a.box(PAINT, 0.11, 0.40, 0.11, s * 0.10, 0.52, 0);                  // thigh
    a.box(PAINT, 0.10, 0.36, 0.10, s * 0.10, 0.16, 0);                  // shin
    a.box(D.dark, 0.10, 0.05, 0.22, s * 0.10, 0.03, 0.04);              // foot
  });
  a.cyl(D.steel, 0.05, 0.05, 0.10, 0, 1.44, 0, 0, 0, 0, 8);           // the neck
  return { geo: a.merge(), prims: a.prims };
}

/**
 * THE LOAD-LIFTER. A binary load-lifter: two thick legs, a box of a torso,
 * a small head, and both arms forward under a cargo crate. It walks slowly
 * with the crate held out — the instance rocks — and it is 260 kg, which is
 * what a crate's carrier ought to weigh.
 */
export function loadLifter() {
  const a = new Assembly();
  a.box(D.steel, 0.70, 0.90, 0.46, 0, 1.55, 0);                      // torso
  a.box(PAINT, 0.72, 0.16, 0.48, 0, 1.20, 0);                        // hazard band, painted
  a.box(D.dark, 0.30, 0.22, 0.26, 0, 2.14, 0.06);                    // head
  a.box(D.lens, 0.20, 0.05, 0.04, 0, 2.16, 0.20);                    // visor
  a.pair((s) => {
    a.box(D.steel, 0.20, 0.60, 0.20, s * 0.50, 1.50, 0.30, -1.5, 0, 0);   // upper arm, forward
    a.box(D.steel, 0.16, 0.60, 0.16, s * 0.50, 1.20, 0.72, -0.4, 0, 0);   // forearm, under the crate
    a.box(D.dark, 0.28, 0.80, 0.30, s * 0.28, 0.66, 0);                    // thigh
    a.box(D.steel, 0.24, 0.50, 0.26, s * 0.28, 0.25, -0.02);               // shin
    a.box(D.dark, 0.30, 0.10, 0.44, s * 0.28, 0.05, 0.06);                 // foot
  });
  a.cyl(D.steel, 0.12, 0.12, 0.20, 0, 2.00, 0, 0, 0, 0, 8);          // neck
  /* THE CRATE, held out front: a big bevelled box with a strap. */
  a.box(0x8a7048, 1.10, 0.90, 0.90, 0, 1.30, 0.86);
  a.box(0x4a3a26, 1.14, 0.08, 0.94, 0, 1.30, 0.86);
  a.box(0x4a3a26, 0.10, 0.94, 0.94, 0, 1.30, 0.86);
  return { geo: a.merge(), prims: a.prims };
}

/** Every chassis builder by kind, so DeckLife can build a fleet from a row. */
export const DROID_BUILDERS = {
  astro: astromechChassis, welder: welderChassis, pit: pitDroid, pitup: pitDroidUp, mouse: mouseDroid,
  gonk: gonkDroid, tread: treadwell, proto: protocolDroid, lifter: loadLifter,
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  KNOCKABLE — Shovable's cycle for a thing that is not a man            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ ONE BODY, ONE CLOCK, ANY SHAPE ═══════════════════════════════════════
 *
 * `Shovable` is written for a man: its half-extents and mass are constants
 * of that file, and its resting place is a parade mark. A droid needs three
 * things it does not offer — its own box, its own weight, and a way to be
 * MOVED while it is standing, because an astromech that rolls from job to
 * job has to carry its collider with it. So this is the same five states
 * with those three knobs, and the clock — how long it lies there, how long
 * getting up takes, how fast it goes back — is `SHOVE`'s, read and not
 * copied, because "how long is being knocked over" has one answer in this
 * game and this is not the file that gets to change it.
 *
 * `userData.figure` and NOT `userData.prop`, for `Shovable`'s stated reason:
 * the Force reads `prop.grippable` as an author's veto and `Impact` expects a
 * real `Prop` behind that key.
 */
export class Knockable {
  /**
   * @param world  the live World (needs `.physics`)
   * @param at     THREE.Vector3, the deck point its base rests on
   * @param opts.half    [hx, hy, hz] half-extents; the collider and the lift
   * @param opts.mass    kilograms
   * @param opts.facing  yaw, radians
   * @param opts.pace    metres a second walking back; default `SHOVE.pace`
   */
  constructor(world, at, opts = {}) {
    this.world = world;
    const h = opts.half || [0.4, 0.5, 0.4];
    this.half = new THREE.Vector3(h[0], h[1], h[2]);
    this.mark = at.clone();
    this.facing = opts.facing ?? 0;
    this.pace = opts.pace ?? SHOVE.pace;
    this.state = STATE.POST;
    this.t = 0;
    this.up = 1;
    this.falls = 0;
    this.at = at.clone();
    this.quaternion = new THREE.Quaternion();
    this.body = new Body({
      position: _v.copy(at).setY(at.y + this.half.y),
      quaternion: _q.setFromAxisAngle(UP, this.facing),
      shape: box(this.half.x, this.half.y, this.half.z),
      spheres: boxSpheres(this.half.x, this.half.y, this.half.z),
      mass: opts.mass ?? 40,
      friction: 0.85, restitution: 0.05,
      linearDamping: 0.08, angularDamping: 0.35,
      layer: LAYER.PROP,
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER,
    });
    this.body.userData.figure = this;
    world.physics.add(this.body);
    this.body.sleep();
  }

  get down() { return this.state === STATE.DOWN || this.state === STATE.REST; }

  /**
   * MOVE IT WHILE IT STANDS. The owner's schedule says where the droid is
   * this frame; if it is on its base, the body goes there — placed, asleep,
   * velocities zero — and `mark` follows so a shove sends it back to where
   * it was going, not to where it was built. Ignored while it is down or
   * getting up: a body teleported out from under its own tumble blinks.
   */
  drive(x, z, yaw) {
    this.facing = yaw;
    const y = this._deckY(x, z);
    this.mark.set(x, y, z);
    if (this.state !== STATE.POST) return this;
    this.body.setTransform(_v.set(x, y + this.half.y, z), _q.setFromAxisAngle(UP, yaw));
    this.body.velocity.set(0, 0, 0); this.body.angularVelocity.set(0, 0, 0);
    this.body.sleep();
    return this._publish();
  }

  /** Put it over without waiting for the Force. The check's door. */
  shove(dir, speed = 4) {
    this.body.wake();
    this.body.applyImpulse(
      _v.copy(dir).setY(0).normalize().multiplyScalar(this.body.mass * speed).setY(this.body.mass * 1.2), null);
    _w.copy(dir).setY(0);
    if (_w.lengthSq() > 1e-6) {
      _w.normalize().cross(UP).multiplyScalar(-this.body.mass * 1.15);
      this.body.applyTorqueImpulse(_w);
    }
    return this;
  }

  update(dt) {
    const b = this.body;
    this.t += dt;
    if (b.dead) {
      /* Off the bottom of the world: back to its mark, as `Shovable` does. */
      b.setTransform(_v.copy(this.mark).setY(this.mark.y + this.half.y), _q.setFromAxisAngle(UP, this.facing));
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      this.world.physics.add(b);
      b.sleep();
      return this._enter(STATE.POST)._publish();
    }
    _up.copy(UP).applyQuaternion(b.quaternion);
    const lean = _up.dot(UP);
    const speed = b.velocity.length();

    if (this.state === STATE.POST) {
      /* Planted, like a man at his post: a brush is undone, a shove is not. */
      if (speed > SHOVE.shove || (lean < SHOVE.tip && speed > SHOVE.wake)) this._enter(STATE.DOWN);
      else {
        if (speed > 0.02 || lean < 0.9995) {
          b.setTransform(_v.copy(this.mark).setY(this.mark.y + this.half.y), _q.setFromAxisAngle(UP, this.facing));
          b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
          b.sleep();
        }
        return this._publish();
      }
    }
    if (this.state === STATE.DOWN) {
      if (speed < SHOVE.still && b.angularVelocity.length() < 1.2) {
        this._settled = (this._settled || 0) + dt;
        if (this._settled > 0.35) this._enter(STATE.REST);
      } else this._settled = 0;
      return this._publish();
    }
    if (this.state === STATE.REST) {
      if (speed > SHOVE.wake) return this._enter(STATE.DOWN)._publish();
      if (this.t >= SHOVE.down) this._enter(STATE.RISE);
      else return this._publish();
    }
    if (this.state === STATE.RISE) {
      if (speed > SHOVE.wake) return this._enter(STATE.DOWN)._publish();
      /* IT RIGHTS ITSELF where it lies: driven upright over `SHOVE.rise`. */
      this.up = Math.min(1, this.t / SHOVE.rise);
      const y = this._deckY(b.position.x, b.position.z);
      b.setTransform(_v.set(b.position.x, y + this.half.y, b.position.z), _q.setFromAxisAngle(UP, this.facing));
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      if (this.t >= SHOVE.rise) this._enter(STATE.BACK);
      return this._publish();
    }
    if (this.state === STATE.BACK) {
      if (speed > SHOVE.wake) return this._enter(STATE.DOWN)._publish();
      _v.copy(this.mark).sub(b.position).setY(0);
      const gap = _v.length();
      if (gap <= SHOVE.mark) {
        b.setTransform(_v.copy(this.mark).setY(this.mark.y + this.half.y), _q.setFromAxisAngle(UP, this.facing));
        b.sleep();
        this._enter(STATE.POST);
        return this._publish();
      }
      const step = Math.min(gap, this.pace * dt);
      _v.multiplyScalar(step / gap);
      b.setTransform(_v.add(b.position).setY(this._deckY(b.position.x, b.position.z) + this.half.y),
        _q.setFromAxisAngle(UP, this.facing));
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      return this._publish();
    }
    return this._publish();
  }

  _enter(state) {
    this.state = state; this.t = 0; this._settled = 0;
    if (state === STATE.DOWN) { this.falls++; this.up = 0; this.body.wake(); }
    if (state === STATE.POST) this.up = 1;
    return this;
  }

  /** The floor under a point: `world.floorAt` when the level installs one
   *  (the deck's pads stand proud of its plate), else the terrain, else the mark. */
  _deckY(x, z) {
    if (this.world.floorAt) return this.world.floorAt(x, z);
    return this.world.terrain ? this.world.terrain.height(x, z) : this.mark.y;
  }

  _publish() {
    this.at.copy(this.body.position);
    this.at.y -= this.half.y;
    this.quaternion.copy(this.body.quaternion);
    return this;
  }

  dispose() {
    this.world.physics?.remove?.(this.body);
    this.body.userData.figure = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE DECK CREW — a man in a jumpsuit, on the game's own skeleton       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHY HE IS NOT `buildTrooper` ═══════════════════════════════════════
 *
 * `Bodies.js` has no non-armoured humanoid: every row of `TROOPER_KITS` is
 * plate over an undersuit with a helmet, `buildJedi` is robes, and the droids
 * are droids. A deck crew in clone plate is the company doing a job it has no
 * animation for. So this is the same skeleton, the same `dressHumanoid`, the
 * same hands and boots — and a jumpsuit, a cap with a peak, a headset with a
 * boom mic, a tool belt with pouches, and knee pads. Every one of those is a
 * `BoxGeometry` or a lathe hung off the bone it belongs to, which is exactly
 * how `buildTrooper` hangs a pauldron, so `MergedSkin` folds them the same
 * way and a severance would take them with the limb.
 *
 * Two suit tones, alternated by `opts.tone`, so a line of ten is not ten
 * copies of one man. Three materials in all — see `castMaterials`.
 */
export function buildDeckCrew(opts = {}) {
  const S = opts.scale ?? 1;
  const M = castMaterials(opts.faction);
  const suit = opts.tone ? M.suitB : M.suit;
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  let prims = 0;
  const hang = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    prims++;
    return m;
  };
  dressHumanoid(rig, {
    scale: S,
    body: suit, arm: suit, leg: suit, hand: M.skin, boot: M.gear, head: M.skin, skin: M.skin,
    parts: { torsoDepth: 0.78, chestR: 0.150, shoulderR: 0.130 },
    yoke: true, yokeMat: suit,
    hands: { curl: 0.55 },
    feet: { w: 0.100, len: 0.210, h: 0.110 },
    buildHead(headObj, s) {
      /* THE CAP: a short cylinder on the crown and a peak forward. It is the
       * one thing that says "crew" from twenty metres, and it costs two
       * boxes. The headset band sits under its brim with the mic boom coming
       * round the right cheek. */
      hang(headObj, new THREE.CylinderGeometry(0.108 * s, 0.112 * s, 0.075 * s, 14), M.gear, 0, 0.192 * s, -0.008 * s);
      hang(headObj, new THREE.BoxGeometry(0.16 * s, 0.014 * s, 0.10 * s), M.gear, 0, 0.162 * s, 0.11 * s, -0.10, 0, 0);
      hang(headObj, new THREE.TorusGeometry(0.108 * s, 0.010 * s, 5, 16, Math.PI), M.gear, 0, 0.12 * s, 0, 0, 0, Math.PI);
      hang(headObj, new THREE.BoxGeometry(0.04 * s, 0.04 * s, 0.04 * s), M.gear, -0.115 * s, 0.10 * s, 0);
      hang(headObj, new THREE.CylinderGeometry(0.005 * s, 0.005 * s, 0.11 * s, 5), M.gear, -0.09 * s, 0.06 * s, 0.06 * s, 0.9, 0, 0.7);
    },
    dress(rig, s) {
      const hips = rig.get('hips')?.obj;
      const chest = rig.get('chest')?.obj;
      if (hips) {
        /* The tool belt, and three pouches on it: a belt is a torus round the
         * hips bone's own waist and the pouches are boxes on its back and
         * flanks, which is where a man keeps what he does not need both hands
         * for. */
        hang(hips, new THREE.TorusGeometry(0.155 * s, 0.018 * s, 5, 18), M.gear, 0, 0.06 * s, 0, Math.PI / 2, 0, 0);
        hang(hips, new THREE.BoxGeometry(0.08 * s, 0.10 * s, 0.05 * s), M.gear, 0.13 * s, 0.02 * s, -0.09 * s, 0, 0.5, 0);
        hang(hips, new THREE.BoxGeometry(0.08 * s, 0.10 * s, 0.05 * s), M.gear, -0.13 * s, 0.02 * s, -0.09 * s, 0, -0.5, 0);
        hang(hips, new THREE.BoxGeometry(0.11 * s, 0.09 * s, 0.05 * s), M.gear, 0, 0.02 * s, -0.16 * s);
        /* A spanner in the belt, because a belt with nothing in it is a strap. */
        hang(hips, new THREE.BoxGeometry(0.025 * s, 0.16 * s, 0.012 * s), M.gear, 0.10 * s, 0.00, 0.14 * s, 0.1, 0, 0.2);
      }
      if (chest) {
        /* The harness strap over the chest and the ID flash on it. */
        hang(chest, new THREE.BoxGeometry(0.04 * s, 0.26 * s, 0.012 * s), M.gear, -0.06 * s, 0.10 * s, 0.128 * s, 0, 0, 0.25);
        hang(chest, new THREE.BoxGeometry(0.035 * s, 0.025 * s, 0.008 * s), M.skin, 0.07 * s, 0.15 * s, 0.13 * s);
      }
      /* Knee pads, on the shins' own tops. */
      for (const side of ['L', 'R']) {
        const shin = rig.get('shin' + side)?.obj;
        if (shin) hang(shin, new THREE.SphereGeometry(0.058 * s, 8, 6), M.gear, 0, 0.03 * s, 0.045 * s);
      }
    },
  });
  rig.root.name = 'deck-crew';
  return { rig, root: rig.root, prims };
}

/** Put a rig back in its bind pose: what a body that has just been on the
 *  deck needs before the gait solver takes it back, and what a figure whose
 *  root is about to be driven from a rigid body needs first. */
export function bindPose(rig) {
  for (const b of rig.list) {
    b.obj.position.copy(b.offset);
    b.obj.quaternion.copy(b.restQuat);
  }
  rig.touchMatrices?.();
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE CREW SILHOUETTES — the real gait, frozen, two hundred triangles  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ EIGHTY MEN PAST THIRTY METRES, FOR FIFTEEN DRAW CALLS ═════════════════
 *
 * "increase the amount of troops … all by an order of magnitude". A deck
 * crewman on the skeleton is 7,300 triangles and a draw call, and at thirty
 * metres a 0.9 m leg is a dozen pixels — so the men past the player's own
 * ground are these: the same `humanoidSkeleton`, walked by the same
 * `BipedAnimator` every worker and trooper walks with, and baked at a pose
 * to ONE box per bone. About 240 triangles a man; the cap and the belt are
 * what say "crew" at that range.
 *
 * A walk is six frames of the real cycle, captured at phase k/6; a carrier
 * is four with the arms out under a crate; the rest stand, kneel, sit, point
 * or lean. DeckLife holds one `InstancedMesh` per pose and a walker flips
 * through the six — the flip-book `Cohorts.js` does with a texture, done
 * with a mesh swap because the poses here are a dozen and not a palette.
 *
 * Suit = `PAINT`, so an instance's colour is its suit tone under
 * `castMaterials().tint`; skin, boots, cap and belt keep their own.
 */
export const CREW_POSES = {
  walk: ['walk0', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5'],
  carry: ['carry0', 'carry1', 'carry2', 'carry3'],
  still: ['stand', 'kneel', 'sit', 'point', 'lean'],
};

/** Bone boxes: [width, depth] by bone, and what paints them. */
const SIL_BONES = {
  hips: [0.30, 0.20, PAINT], spine: [0.30, 0.20, PAINT], chest: [0.34, 0.22, PAINT],
  neck: [0.10, 0.10, 0xc79a76], head: [0.19, 0.21, 0xc79a76],
  clavL: [0.08, 0.10, PAINT], clavR: [0.08, 0.10, PAINT],
  armL: [0.10, 0.10, PAINT], armR: [0.10, 0.10, PAINT], foreL: [0.09, 0.09, PAINT], foreR: [0.09, 0.09, PAINT],
  handL: [0.07, 0.05, 0xc79a76], handR: [0.07, 0.05, 0xc79a76],
  thighL: [0.14, 0.15, PAINT], thighR: [0.14, 0.15, PAINT], shinL: [0.12, 0.13, PAINT], shinR: [0.12, 0.13, PAINT],
  footL: [0.10, 0.09, 0x2a2621], footR: [0.10, 0.09, 0x2a2621],
};

/** Bake the rig's current pose to bone boxes, root at the origin, facing +Z. */
function bakeSilhouette(rig, at, extra) {
  rig.updateMatrices();
  const a = new Assembly();
  for (const b of rig.list) {
    const row = SIL_BONES[b.name];
    if (!row) continue;
    const [w, d, hex] = row;
    const len = b.name === 'head' ? 0.23 : b.length;
    const g = new THREE.BoxGeometry(w, len, d);
    g.translate(0, len / 2, 0);
    g.applyMatrix4(b.obj.matrixWorld);
    a.put(g, hex);
  }
  /* The cap: a short cylinder on the crown, with the peak forward. */
  const head = rig.get('head').obj;
  const cap = new THREE.CylinderGeometry(0.105, 0.11, 0.07, 10);
  cap.translate(0, 0.21, 0); cap.applyMatrix4(head.matrixWorld);
  a.put(cap, 0x2a2621);
  const peak = new THREE.BoxGeometry(0.15, 0.014, 0.10);
  peak.translate(0, 0.18, 0.11); peak.applyMatrix4(head.matrixWorld);
  a.put(peak, 0x2a2621);
  /* The belt, and the pouch on its back. */
  const hips = rig.get('hips').obj;
  const belt = new THREE.BoxGeometry(0.33, 0.05, 0.23);
  belt.translate(0, 0.06, 0); belt.applyMatrix4(hips.matrixWorld);
  a.put(belt, 0x2a2621);
  if (extra) extra(a);
  const geo = a.merge();
  geo.translate(-at.x, 0, -at.z);
  return { geo, prims: a.prims };
}

/**
 * Build every pose. Fresh geometry per call — a World disposes what it
 * draws — and a few milliseconds: the animator is stepped through three
 * seconds of walk before the first frame is taken, at 120 Hz.
 */
export function crewSilhouettes() {
  const rig = new Rig(humanoidSkeleton(1), { scale: 1 });
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const pos = new THREE.Vector3(), vel = new THREE.Vector3();
  const p = { position: pos, facing: 0, velocity: vel, grounded: true, groundAt: () => 0, crouch: 0, accelForward: 0.26, deferMatrices: false };
  const dt = 1 / 120;
  const out = {};
  const walk = (seconds) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) { pos.z += vel.z * dt; anim.update(dt, p); anim.swingArms(dt, vel.z, 1); } };
  const aim = (name, x, y, z) => rig.aimBoneWorld(name, _v.set(x, y, z).normalize(), null);
  /* THE WALK, six frames at phase k/6, once the gait has settled. */
  vel.set(0, 0, 1.3);
  walk(3);
  const frames = (names, extra, arms) => {
    let k = 0, last = anim.phase;
    for (let i = 0; i < 1200 && k < names.length; i++) {
      pos.z += vel.z * dt; anim.update(dt, p); anim.swingArms(dt, vel.z, 1);
      const want = k / names.length;
      const ph = anim.phase;
      /* Did the phase cross `want` this step? A wrap (ph < last) crosses
       * everything from `last` to 1 and from 0 to `ph`. */
      const crossed = ph < last ? (want >= last || want <= ph) : (last < want && want <= ph) || (k === 0 && last === 0);
      if (crossed) {
        if (arms) arms();
        out[names[k++]] = bakeSilhouette(rig, pos, extra);
      }
      last = anim.phase;
    }
  };
  frames(CREW_POSES.walk, null, null);
  /* THE CARRIER: the walk with both arms out under the end of a crate. */
  const crate = (a) => {
    const g = new THREE.BoxGeometry(0.60, 0.44, 0.70);
    g.translate(pos.x, 0.86, pos.z + 0.62);
    a.put(g, 0x8a7048);
  };
  frames(CREW_POSES.carry, crate, () => {
    aim('armL', 0.15, -0.55, 0.8); aim('armR', -0.15, -0.55, 0.8);
    aim('foreL', 0.05, -0.15, 1); aim('foreR', -0.05, -0.15, 1);
  });
  /* STANDING, and everything that starts from standing. */
  vel.set(0, 0, 0);
  walk(2);
  out.stand = bakeSilhouette(rig, pos, null);
  /* POINTING: the right arm up and out, the way an officer walks a rank. */
  aim('armR', -0.25, 0.30, 0.9); aim('foreR', -0.10, 0.25, 1);
  out.point = bakeSilhouette(rig, pos, null);
  /* LEANING on a rail: both forearms forward at chest height. */
  walk(0.5);
  aim('armL', 0.2, -0.75, 0.6); aim('armR', -0.2, -0.75, 0.6);
  aim('foreL', 0.1, 0.05, 1); aim('foreR', -0.1, 0.05, 1);
  out.lean = bakeSilhouette(rig, pos, null);
  /* KNEELING at a panel: the animator's own crouch, hands on the work. */
  p.crouch = 1;
  walk(2);
  aim('armL', 0.2, -0.6, 0.8); aim('armR', -0.2, -0.6, 0.8);
  aim('foreL', 0.05, -0.3, 1); aim('foreR', -0.05, -0.3, 1);
  out.kneel = bakeSilhouette(rig, pos, null);
  /* SITTING on a cot half a metre up: thighs forward, shins down, hands on
   * the knees. The animator cannot sit, so this is posed by hand off the
   * stand — a bone at a time, no numbers the skeleton does not carry. */
  p.crouch = 0;
  walk(2);
  aim('thighL', 0.12, 0, 1); aim('thighR', -0.12, 0, 1);
  aim('shinL', 0, -1, 0.05); aim('shinR', 0, -1, 0.05);
  aim('armL', 0.2, -0.7, 0.55); aim('armR', -0.2, -0.7, 0.55);
  aim('foreL', 0.05, -0.55, 0.8); aim('foreR', -0.05, -0.55, 0.8);
  rig.get('hips').obj.position.y = 0.50;
  out.sit = bakeSilhouette(rig, pos, null);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE HULLS — a fighter and a shuttle you can walk up to               */
/* ══════════════════════════════════════════════════════════════════════ */

/** The faction's own three hull colours, read off the room's materials. */
function hullPalette(faction) {
  const M = deckMats(faction);
  const hex = (m) => m.color.getHex();
  return {
    hull: hex(M.hull), wing: hex(M.wing), dark: hex(M.dark), deep: hex(M.deep),
    /* A canopy frame and a bell throat are the same dark alloy on both decks. */
    alloy: 0x2b3038, bell: 0x1a1d22, mark: hex(M.mark), lamp: 0xff5a3c,
  };
}

/**
 * Bake an assembly into a group: the hull as one vertex-coloured mesh, the
 * glass as a second, the gear as a third that the owner folds. Every mesh is
 * `frustumCulled = false` because a hull in flight crosses 900 m of world and
 * three's bounding sphere is computed once.
 */
function bakeHull(A, glass, gear, M, name) {
  const g = new THREE.Group();
  g.name = name;
  const add = (geo, mat, nm) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.name = nm; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    g.add(m);
    return m;
  };
  const meshes = { body: add(A.merge(), M.cast, 'hull'), glass: add(glass.merge(), M.glass, 'canopy'),
    gear: add(gear.merge(), M.cast, 'gear') };
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), bs = new THREE.Vector3();
  bb.getSize(bs);
  g.userData.span = bs.x; g.userData.length = bs.z; g.userData.height = bs.y;
  g.userData.prims = A.prims + glass.prims + gear.prims;
  return { group: g, meshes, box: bb };
}

/**
 * ══ THE FIGHTER ═══════════════════════════════════════════════════════════
 *
 * Nose to +Z, the centreline at y = 0, and it stands on its gear with the
 * belly `gearY` above the deck. The Republic hull is the delta the racks are
 * full of — a wedge with swept wings, twin nacelles, a fin — and the
 * Separatist one is the panel-and-ball read of the same racks, so a launch
 * from either deck is a bigger version of what is parked on its walls.
 *
 * A hundred and forty-odd primitives, and most of them are the things the
 * player sees from two metres: panel seams, vents, rivets, cannon barrels,
 * bell rings, the gear's own struts and pads. Everything up to the canopy
 * bakes to ONE mesh.
 */
export function buildCastFighter(opts = {}) {
  const faction = factionOf(opts.faction);
  const P = hullPalette(faction);
  const M = castMaterials(faction);
  const A = new Assembly(), G = new Assembly(), R = new Assembly();
  const bells = [];
  if (faction === 'republic') {
    /* Fuselage: nose cone, forward hull, aft hull, tail boom. */
    A.cyl(P.hull, 0.30, 1.05, 3.0, 0, 0.05, 5.9, Math.PI / 2, 0, 0, 10);
    A.box(P.hull, 2.2, 1.5, 4.2, 0, 0, 2.3);
    A.box(P.hull, 2.6, 1.7, 4.6, 0, -0.05, -1.6);
    A.box(P.dark, 2.0, 1.2, 1.8, 0, -0.1, -4.6);
    A.box(P.dark, 2.7, 0.5, 8.0, 0, -0.9, 0.2);                       // the belly plate
    /* Panel seams along the flanks and over the spine. */
    for (let i = 0; i < 7; i++) {
      const z = -3.4 + i * 1.3;
      A.pair((s) => A.box(P.dark, 0.05, 1.3, 0.06, s * 1.31, -0.02, z));
      A.box(P.dark, 1.8, 0.04, 0.06, 0, 0.86, z);
    }
    /* Vents, rivets, the sensor stub and the dorsal antenna. */
    for (let i = 0; i < 4; i++) A.pair((s) => A.box(P.deep, 0.04, 0.10, 0.6, s * 1.32, 0.35, -2.8 + i * 0.9));
    for (let i = 0; i < 8; i++) A.pair((s) => A.box(P.alloy, 0.05, 0.05, 0.05, s * 0.9, 0.88, -3.2 + i));
    A.cyl(P.alloy, 0.03, 0.03, 1.1, 0.6, 0.9, -1.2, 0, 0, 0, 6);
    A.ball(P.deep, 0.22, -0.7, 0.86, 3.6, 8, 6);
    /* Canopy frame and glass. */
    A.box(P.alloy, 1.3, 0.12, 2.4, 0, 0.82, 2.4);
    A.pair((s) => A.box(P.alloy, 0.08, 0.6, 2.3, s * 0.62, 1.05, 2.4));
    A.box(P.alloy, 1.3, 0.6, 0.10, 0, 1.05, 3.55, 0.3, 0, 0);
    G.put(new THREE.BoxGeometry(1.16, 0.62, 2.2), P.deep, 0, 1.08, 2.4);
    G.put(new THREE.SphereGeometry(0.6, 10, 6), P.deep, 0, 1.2, 3.3);
    /* Wings, swept, with tip fins and cannons. */
    A.pair((s) => {
      A.box(P.wing, 5.4, 0.30, 3.2, s * 3.8, -0.1, -0.8, 0, s * -0.30, s * 0.06);
      A.box(P.wing, 4.8, 0.06, 2.6, s * 3.8, 0.10, -0.8, 0, s * -0.30, s * 0.06);
      for (let i = 0; i < 4; i++) A.box(P.dark, 0.9, 0.06, 0.05, s * (2.0 + i * 1.0), 0.09, -0.8 - i * 0.35 * s * s, 0, s * -0.30, 0);
      A.box(P.wing, 0.30, 1.9, 1.9, s * 6.3, 0.75, -1.9);
      A.box(P.dark, 0.34, 0.5, 0.6, s * 6.3, 1.5, -1.5);
      /* The cannon: a long barrel with a muzzle collar and a mount. */
      A.cyl(P.alloy, 0.07, 0.07, 3.6, s * 6.3, -0.2, 0.9, Math.PI / 2, 0, 0, 8);
      A.cyl(P.dark, 0.11, 0.11, 0.30, s * 6.3, -0.2, 2.6, Math.PI / 2, 0, 0, 8);
      A.box(P.dark, 0.30, 0.34, 0.9, s * 6.3, -0.2, -0.6);
      /* Nacelle, bell, bell rings, the intake up front. */
      A.cyl(P.dark, 0.85, 0.75, 4.2, s * 1.7, -0.25, -3.0, Math.PI / 2, 0, 0, 12);
      A.cyl(P.bell, 0.62, 0.78, 0.8, s * 1.7, -0.25, -5.3, Math.PI / 2, 0, 0, 12);
      A.ring(P.alloy, 0.80, 0.06, s * 1.7, -0.25, -5.5, 0, 0, 0, 14);
      A.ring(P.alloy, 0.84, 0.05, s * 1.7, -0.25, -4.4, 0, 0, 0, 14);
      A.cyl(P.deep, 0.62, 0.70, 0.3, s * 1.7, -0.25, -0.9, Math.PI / 2, 0, 0, 12);
      A.box(P.hull, 0.8, 0.5, 2.2, s * 1.35, 0.3, -2.8);
      /* Hardpoints under the wing. */
      for (let i = 0; i < 2; i++) A.box(P.alloy, 0.20, 0.30, 0.9, s * (3.2 + i * 1.4), -0.35, -1.0 - i * 0.4);
      /* Rivets down the wing's leading edge, pipes along the nacelle, and
       * the fuel cap: the two-metre detail that makes a hull a hull. */
      for (let i = 0; i < 6; i++) A.box(P.alloy, 0.06, 0.06, 0.06, s * (2.0 + i * 0.75), 0.14, 0.75 - i * 0.24);
      for (let i = 0; i < 3; i++) A.cyl(P.alloy, 0.04, 0.04, 3.4, s * (1.7 + 0.86 * Math.cos(0.5 + i * 0.7)), -0.25 + 0.86 * Math.sin(0.5 + i * 0.7), -2.9, Math.PI / 2, 0, 0, 6);
      A.cyl(P.deep, 0.12, 0.12, 0.05, s * 3.0, 0.08, 0.2, 0, 0, 0, 8);
      bells.push({ x: s * 1.7, y: -0.25, z: -5.7, r: 0.7 });
    });
    /* Belly hatches and the aft ladder rungs. */
    for (let i = 0; i < 5; i++) A.box(P.deep, 0.7, 0.04, 0.5, 0, -1.15, -3.0 + i * 1.4);
    for (let i = 0; i < 4; i++) A.box(P.alloy, 0.5, 0.05, 0.05, 1.0, -0.6 + i * 0.3, -3.9);
    /* The fin and the tailplane. */
    A.box(P.wing, 0.30, 2.5, 2.6, 0, 1.4, -3.5, 0.35, 0, 0);
    A.box(P.dark, 0.34, 0.4, 0.6, 0, 2.5, -4.3, 0.35, 0, 0);
    A.box(P.deep, 0.06, 1.2, 1.2, 0.2, 1.5, -3.6, 0.35, 0, 0);
    /* Landing lamps on the belly, and the nav lamps on the tips. */
    A.box(P.lamp, 0.16, 0.06, 0.16, 0, -1.16, 3.0);
    A.pair((s) => A.box(P.lamp, 0.10, 0.06, 0.10, s * 6.3, 1.72, -1.5));
  } else {
    /* THE SEPARATIST FIGHTER: a ball between two panels on pylons, and the
     * ball is the hull. Nose to +Z still. */
    A.ball(P.hull, 2.1, 0, 0, 0, 16, 12);
    A.cyl(P.alloy, 1.35, 1.35, 0.3, 0, 0, 2.0, Math.PI / 2, 0, 0, 14);
    G.put(new THREE.CylinderGeometry(1.15, 1.15, 0.20, 14), P.deep, 0, 0, 2.15, Math.PI / 2, 0, 0);
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * TAU;
      A.box(P.alloy, 0.07, 0.07, 1.2, Math.cos(th) * 1.15, Math.sin(th) * 1.15, 1.7);
      A.box(P.deep, 0.10, 0.10, 0.08, Math.cos(th + 0.4) * 2.02, Math.sin(th + 0.4) * 2.02, -0.3);
    }
    A.box(P.dark, 1.6, 1.6, 1.8, 0, 0, -2.2);
    for (let i = 0; i < 6; i++) A.box(P.alloy, 1.5, 0.05, 0.08, 0, -0.6 + i * 0.24, -3.1);
    A.cyl(P.bell, 0.70, 0.90, 0.9, 0, 0, -3.4, Math.PI / 2, 0, 0, 12);
    A.ring(P.alloy, 0.92, 0.07, 0, 0, -3.7, 0, 0, 0, 14);
    A.ring(P.alloy, 0.96, 0.06, 0, 0, -2.9, 0, 0, 0, 14);
    bells.push({ x: 0, y: 0, z: -3.9, r: 0.85 });
    /* Six radiator fins round the ball's aft, the belly lamp, two whip
     * antennae off the crown: the greebles a hull is read by from two metres. */
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * TAU + 0.2;
      A.box(P.alloy, 0.10, 0.10, 0.5, Math.cos(th) * 1.9, Math.sin(th) * 1.9, -0.9, 0, 0, th);
    }
    A.box(P.lamp, 0.12, 0.12, 0.12, 0, -2.05, 1.2);
    A.pair((s) => A.cyl(P.alloy, 0.04, 0.04, 1.4, s * 1.2, 1.4, -1.5, 0.4 * s, 0, 0, 5));
    A.box(P.deep, 0.6, 0.4, 0.9, 0, 1.8, 0.8);
    for (let i = 0; i < 6; i++) A.box(P.deep, 0.6, 0.06, 0.05, 0, 1.2 - i * 0.45, 1.85 - i * 0.06);
    A.pair((s) => {
      /* Pylon, panel, the frame edges and the spar ribs. */
      A.box(P.dark, 2.4, 0.8, 1.2, s * 3.0, 0, 0);
      for (let i = 0; i < 4; i++) A.box(P.alloy, 0.08, 0.9, 0.08, s * (2.2 + i * 0.5), 0, 0.5);
      A.box(P.wing, 0.24, 8.2, 7.2, s * 4.4, 0, 0);
      A.box(P.wing, 0.32, 9.0, 2.0, s * 4.4, 0, 0);
      A.box(P.alloy, 0.36, 8.4, 0.18, s * 4.4, 0, 3.65);
      A.box(P.alloy, 0.36, 8.4, 0.18, s * 4.4, 0, -3.65);
      A.box(P.alloy, 0.36, 0.18, 7.3, s * 4.4, 4.2, 0);
      A.box(P.alloy, 0.36, 0.18, 7.3, s * 4.4, -4.2, 0);
      for (let i = 0; i < 5; i++) A.box(P.alloy, 0.30, 0.10, 7.1, s * 4.4, -3.3 + i * 1.65, 0);
      for (let i = 0; i < 3; i++) A.box(P.alloy, 0.30, 8.2, 0.10, s * 4.4, 0, -2.4 + i * 2.4);
      for (let i = 0; i < 10; i++) A.box(P.deep, 0.08, 0.06, 0.06, s * 4.6, -3.6 + i * 0.8, i % 2 ? 1.5 : -1.5);
      /* The cannons under the ball's chin. */
      A.cyl(P.alloy, 0.08, 0.08, 3.0, s * 0.7, -1.5, 2.0, Math.PI / 2, 0, 0, 8);
      A.cyl(P.dark, 0.13, 0.13, 0.3, s * 0.7, -1.5, 3.4, Math.PI / 2, 0, 0, 8);
      A.box(P.dark, 0.25, 0.5, 0.8, s * 0.7, -1.7, 0.8);
      A.box(P.lamp, 0.10, 0.10, 0.10, s * 4.4, 4.3, 3.5);
    });
  }
  /* THE GEAR — its own mesh, folded away in flight: a nose strut with a pad
   * and two main struts with pads and oleo collars. Struts drop 1.3 m below
   * the belly. */
  const gearY = 1.35;
  const strut = (x, z, len) => {
    R.cyl(P.alloy, 0.09, 0.09, len, x, -0.55 - len / 2, z, 0, 0, 0, 8);
    R.cyl(P.dark, 0.14, 0.14, 0.18, x, -0.9, z, 0, 0, 0, 8);
    R.box(P.dark, 0.55, 0.10, 0.75, x, -0.55 - len, z);
    R.box(P.alloy, 0.14, 0.5, 0.06, x + 0.12, -0.75, z + 0.1, 0.3, 0, 0);
  };
  if (faction === 'republic') { strut(0, 3.4, gearY - 0.55); strut(1.9, -1.4, gearY - 0.55); strut(-1.9, -1.4, gearY - 0.55); }
  else { strut(0, 1.2, gearY - 0.55 + 1.6); strut(3.0, -0.8, gearY - 0.55 + 0.4); strut(-3.0, -0.8, gearY - 0.55 + 0.4); }
  const out = bakeHull(A, G, R, M, `deck-fighter-${faction}`);
  out.bells = bells;
  /* A panel fighter stands on its wings' lower frames: the gear is a stub
   * and the hull's belly is 4.2 m up. */
  out.gearY = faction === 'republic' ? gearY : gearY + 1.6;
  /* The collider is the hull's own box, and not the gear's: a player walks
   * under a wingtip and into a fuselage. */
  out.half = new THREE.Vector3(out.group.userData.span * 0.42, 1.0, out.group.userData.length * 0.45);
  out.kind = 'fighter';
  return out;
}

/**
 * ══ THE SHUTTLE ═══════════════════════════════════════════════════════════
 *
 * Nose to +Z, y = 0 at the centreline. The Republic one is the broad, low
 * gunship of `DeckKit.shuttlePad` — fat body, chin cockpit, wings canted
 * down with pods, side doors — and the Separatist one is the tall tri-blade
 * with the wings folded up. Both about eighteen metres, so they are the
 * pad's shuttle at flying size and not a second species of craft.
 */
export function buildCastShuttle(opts = {}) {
  const faction = factionOf(opts.faction);
  const P = hullPalette(faction);
  const M = castMaterials(faction);
  const A = new Assembly(), G = new Assembly(), R = new Assembly();
  const bells = [];
  if (faction === 'republic') {
    A.cyl(P.hull, 2.2, 2.5, 12.0, 0, 0, -0.5, Math.PI / 2, 0, 0, 12);
    A.cyl(P.hull, 1.2, 2.2, 3.4, 0, -0.2, 7.2, Math.PI / 2, 0, 0, 12);
    A.box(P.wing, 3.2, 1.8, 3.2, 0, -1.0, 6.5);                        // the chin cockpit
    A.box(P.alloy, 3.3, 0.14, 1.4, 0, -0.1, 6.9);
    G.put(new THREE.BoxGeometry(2.6, 0.9, 1.2), P.deep, 0, -0.6, 8.05, -0.25, 0, 0);
    A.box(P.dark, 4.0, 2.4, 3.0, 0, -0.4, -6.0);                        // the aft block
    A.cyl(P.deep, 1.4, 1.4, 0.4, 0, 0.2, -7.6, Math.PI / 2, 0, 0, 12);
    /* Doors, seams and the row of ports down each flank. */
    A.pair((s) => {
      A.box(P.dark, 0.10, 2.0, 3.2, s * 2.32, -0.2, 0.5);
      A.box(P.alloy, 0.14, 0.14, 3.4, s * 2.36, 0.9, 0.5);
      A.box(P.alloy, 0.14, 0.14, 3.4, s * 2.36, -1.3, 0.5);
      for (let i = 0; i < 5; i++) A.box(P.deep, 0.06, 0.3, 0.3, s * 2.4, 0.9, -4.8 + i * 0.9);
      for (let i = 0; i < 6; i++) A.box(P.dark, 0.05, 1.8, 0.06, s * 2.44, 0, -5.5 + i * 1.6);
      /* Wing canted down, with a pod on the tip and its bell. */
      A.box(P.wing, 5.0, 0.7, 4.2, s * 4.6, -0.8, -0.8, 0, 0, s * 0.22);
      A.box(P.alloy, 4.6, 0.06, 0.5, s * 4.6, -0.42, 0.4, 0, 0, s * 0.22);
      for (let i = 0; i < 4; i++) A.box(P.dark, 0.06, 0.74, 0.5, s * (2.6 + i * 1.2), -0.8 + s * 0 - i * 0.26, -0.8, 0, 0, s * 0.22);
      A.cyl(P.dark, 1.15, 1.0, 6.0, s * 7.2, -1.55, -1.2, Math.PI / 2, 0, 0, 12);
      A.cyl(P.bell, 0.7, 0.95, 0.9, s * 7.2, -1.55, -4.6, Math.PI / 2, 0, 0, 12);
      A.ring(P.alloy, 1.0, 0.07, s * 7.2, -1.55, -4.9, 0, 0, 0, 14);
      A.ring(P.alloy, 1.05, 0.06, s * 7.2, -1.55, -3.6, 0, 0, 0, 14);
      A.cyl(P.deep, 0.8, 0.95, 0.4, s * 7.2, -1.55, 1.7, Math.PI / 2, 0, 0, 12);
      A.box(P.alloy, 0.4, 0.6, 3.0, s * 7.2, -0.6, -1.2);
      bells.push({ x: s * 7.2, y: -1.55, z: -5.1, r: 0.9 });
      /* The ball turret under the nose, either side. */
      A.ball(P.alloy, 0.42, s * 1.3, -1.9, 5.2, 8, 6);
      A.cyl(P.dark, 0.05, 0.05, 1.2, s * 1.3, -1.95, 6.0, Math.PI / 2, 0, 0, 6);
    });
    /* The dorsal fin and its lamp, the spine antennae. */
    A.box(P.hull, 0.6, 3.6, 4.4, 0, 3.0, -4.6, 0.25, 0, 0);
    A.box(P.deep, 0.08, 1.8, 2.0, 0.2, 3.4, -4.8, 0.25, 0, 0);
    A.box(P.lamp, 0.16, 0.16, 0.16, 0, 4.9, -5.4);
    for (let i = 0; i < 3; i++) A.cyl(P.alloy, 0.03, 0.03, 1.2, -0.8 + i * 0.8, 2.9, 1.0 - i * 1.5, 0, 0, 0, 6);
    /* Ribs over the top of the body. */
    for (let i = 0; i < 8; i++) A.ring(P.alloy, 2.45, 0.06, 0, 0, -5.5 + i * 1.5, 0, 0, 0, 20);
    A.box(P.lamp, 0.2, 0.06, 0.2, 0, -2.55, 3.0);
    /* Ports down each flank, belly hatches, wing rivets, roof pipes. */
    A.pair((s) => {
      for (let i = 0; i < 6; i++) A.cyl(P.deep, 0.16, 0.16, 0.06, s * 2.42, 0.4, -3.6 + i * 1.5, 0, 0, Math.PI / 2, 8);
      for (let i = 0; i < 5; i++) A.box(P.alloy, 0.07, 0.07, 0.07, s * (3.0 + i * 0.9), -0.36 - i * 0.2 * 0, 1.2, 0, 0, s * 0.22);
    });
    for (let i = 0; i < 4; i++) A.box(P.deep, 1.4, 0.05, 1.0, 0, -2.5, -4.5 + i * 2.2);
    for (let i = 0; i < 3; i++) A.cyl(P.alloy, 0.05, 0.05, 9.0, -0.9 + i * 0.9, 2.5, -1.5, Math.PI / 2, 0, 0, 6);
    /* The dorsal sensor dish and its mast. */
    A.cyl(P.alloy, 0.04, 0.04, 1.2, 0, 3.1, 2.6, 0, 0, 0, 6);
    A.cyl(P.deep, 0.5, 0.2, 0.2, 0, 3.75, 2.6, 0, 0, 0, 10);
  } else {
    /* THE TRI-BLADE: a long wedge, a boxy cabin, three tall wings up. */
    A.cyl(P.hull, 0.6, 2.4, 14, 0, 0.2, 2.0, Math.PI / 2, 0, 0, 6);
    A.box(P.hull, 5.0, 2.2, 5.0, 0, -0.4, -3.0);
    A.box(P.dark, 4.2, 1.6, 2.0, 0, -0.3, -6.2);
    A.cyl(P.bell, 0.7, 0.9, 0.9, 0, -0.3, -7.5, Math.PI / 2, 0, 0, 12);
    A.ring(P.alloy, 0.95, 0.07, 0, -0.3, -7.8, 0, 0, 0, 14);
    bells.push({ x: 0, y: -0.3, z: -8.0, r: 0.9 });
    G.put(new THREE.BoxGeometry(1.4, 0.6, 2.4), P.deep, 0, 1.1, 5.5, -0.35, 0, 0);
    A.box(P.alloy, 1.5, 0.1, 2.5, 0, 0.85, 5.5, -0.35, 0, 0);
    A.box(P.wing, 0.6, 12, 4.0, 0, 6.5, -3.0);                           // the dorsal blade
    A.box(P.alloy, 0.7, 12, 0.2, 0, 6.5, -1.0);
    for (let i = 0; i < 6; i++) A.box(P.deep, 0.7, 0.10, 3.6, 0, 1.5 + i * 2.0, -3.0);
    A.pair((s) => {
      A.box(P.wing, 0.5, 11, 3.6, s * 3.6, 5.2, -3.0, 0, 0, s * 0.20);
      A.box(P.alloy, 0.6, 11, 0.2, s * 3.6, 5.2, -1.2, 0, 0, s * 0.20);
      for (let i = 0; i < 5; i++) A.box(P.deep, 0.6, 0.10, 3.2, s * (3.6 - i * 0.22), 1.6 + i * 2.0, -3.0);
      A.box(P.dark, 1.6, 0.8, 2.0, s * 2.8, 0.2, -3.0);
      for (let i = 0; i < 4; i++) A.box(P.dark, 0.06, 1.2, 0.05, s * 2.52, -0.4, -5.0 + i * 1.2);
      A.cyl(P.alloy, 0.06, 0.06, 2.0, s * 1.2, -1.2, 5.6, Math.PI / 2, 0, 0, 6);
      A.box(P.lamp, 0.12, 0.12, 0.12, s * 3.9, 10.6, -3.0);
    });
    for (let i = 0; i < 5; i++) A.ring(P.alloy, 2.3, 0.06, 0, -0.3, -1.5 - i * 1.0, 0, 0, 0, 16);
    A.box(P.lamp, 0.2, 0.06, 0.2, 0, -1.55, 3.0);
    /* Rivets up every blade, louvres on the cabin, vanes on the nose. */
    for (let i = 0; i < 8; i++) {
      A.box(P.deep, 0.08, 0.08, 0.06, 0.32, 1.2 + i * 1.4, -1.1);
      A.pair((s) => A.box(P.deep, 0.08, 0.08, 0.06, s * (3.6 - (1.2 + i * 1.4) * 0.2 * 0) + s * 0.28, 1.0 + i * 1.2, -1.3));
    }
    for (let i = 0; i < 6; i++) A.box(P.alloy, 4.6, 0.05, 0.08, 0, -1.3 + i * 0.3, -0.5);
    A.pair((s) => { for (let i = 0; i < 4; i++) A.box(P.alloy, 0.05, 0.4, 1.2, s * (0.8 + i * 0.35), 0.4, 6.0 - i * 1.3); });
    for (let i = 0; i < 4; i++) A.cyl(P.alloy, 0.03, 0.03, 1.4, -1.2 + i * 0.8, 1.6, -6.8, 0, 0, 0, 5);
    /* Rivets down the nose ridge, louvres on the cabin flanks, wingtip lamps,
     * a whip antenna and a belly rail: the two-metre detail. */
    for (let i = 0; i < 8; i++) A.box(P.alloy, 0.07, 0.07, 0.07, 0, 0.85 + i * 0.115, 8.6 - i * 0.9);
    A.pair((s) => {
      for (let i = 0; i < 3; i++) A.box(P.deep, 0.06, 0.5, 0.4, s * 2.52, 0.3, -1.8 - i * 0.7);
      A.box(P.lamp, 0.10, 0.10, 0.10, s * 3.9, 0.4, -1.0);
    });
    A.cyl(P.alloy, 0.03, 0.03, 1.6, 0.9, 1.2, -6.5, 0, 0, -0.5, 5);
    A.box(P.deep, 0.5, 0.06, 0.06, 0, -1.5, 3.0);
  }
  const gearY = 2.2;
  const strut = (x, z, len) => {
    R.cyl(P.alloy, 0.13, 0.13, len, x, -1.6 - len / 2, z, 0, 0, 0, 8);
    R.cyl(P.dark, 0.20, 0.20, 0.24, x, -2.1, z, 0, 0, 0, 8);
    R.box(P.dark, 0.9, 0.14, 1.1, x, -1.6 - len, z);
    R.box(P.alloy, 0.16, 0.7, 0.08, x + 0.16, -1.9, z + 0.2, 0.3, 0, 0);
  };
  const drop = faction === 'republic' ? gearY + 0.9 - 1.6 : gearY + 0.3 - 1.6;
  strut(0, 5.2, drop); strut(2.4, -3.0, drop); strut(-2.4, -3.0, drop);
  const out = bakeHull(A, G, R, M, `deck-shuttle-${faction}`);
  out.bells = bells;
  out.gearY = faction === 'republic' ? gearY + 0.9 : gearY + 0.3;
  out.half = new THREE.Vector3(out.group.userData.span * 0.36, 1.6, out.group.userData.length * 0.46);
  out.kind = 'shuttle';
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE SILHOUETTES — the racks' own ships, turned nose-forward           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The outside leg's fighter, as ONE vertex-coloured geometry: the three
 * `parkedFighter` kinds of the deck's own army, taken out of a `DeckBuild`'s
 * bins, painted with each bin's material colour, and merged. Nose to +Z, so
 * the same heading arithmetic drives it as drives the modelled hulls.
 *
 * Why the racks' geometry and not a third drawing: a speck at 600 m has to
 * be the same ship the walls are full of, or the room has three fleets.
 */
export function farHullGeometry(kind, faction) {
  const id = factionOf(faction);
  const kit = new DeckBuild(id);
  if (kind === 'shuttle') {
    /* No parked shuttle exists at silhouette size, so this is the pad's
     * craft at half scale: the two builders above are too many triangles to
     * instance twelve times, and at 300 m nobody can tell. */
    const A = new Assembly();
    const P = hullPalette(id);
    if (id === 'republic') {
      A.cyl(P.hull, 2.2, 2.5, 12, 0, 0, -0.5, Math.PI / 2, 0, 0, 8);
      A.box(P.wing, 3.2, 1.8, 3.2, 0, -1.0, 6.5);
      A.pair((s) => {
        A.box(P.wing, 5.0, 0.7, 4.2, s * 4.6, -0.8, -0.8, 0, 0, s * 0.22);
        A.cyl(P.dark, 1.15, 1.0, 6.0, s * 7.2, -1.55, -1.2, Math.PI / 2, 0, 0, 8);
      });
      A.box(P.hull, 0.6, 3.6, 4.4, 0, 3.0, -4.6, 0.25, 0, 0);
    } else {
      A.cyl(P.hull, 0.6, 2.4, 14, 0, 0.2, 2.0, Math.PI / 2, 0, 0, 6);
      A.box(P.hull, 5.0, 2.2, 5.0, 0, -0.4, -3.0);
      A.box(P.wing, 0.6, 12, 4.0, 0, 6.5, -3.0);
      A.pair((s) => A.box(P.wing, 0.5, 11, 3.6, s * 3.6, 5.2, -3.0, 0, 0, s * 0.20));
    }
    return { geo: A.merge(), prims: A.prims };
  }
  parkedFighter(kit, 0, 0, 0, 1, { kind: kind | 0, faction: id });
  const geos = [];
  let prims = 0;
  for (const [mat, list] of kit.bins) {
    for (const g of list) {
      /* `parkedFighter`'s nose points to -s·X, and s is +1 here: a quarter
       * turn about Y carries -X onto +Z. */
      g.rotateY(Math.PI / 2);
      tint(g, mat.color.getHex());
      geos.push(g);
      prims++;
    }
  }
  return { geo: mergeGeos(geos), prims };
}
