/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE DECK, ALIVE — machines, not people
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THERE IS NOT ONE WALKING PERSON WITHIN THIRTY METRES ──────────────
 *
 * The brief asks for a deck with work happening on it. The tree's own record
 * says how that goes wrong: six interior levels were deleted on the note
 * "your interior maps remind you that this is an AI game", and the single
 * cheapest way to earn that sentence is a humanoid on a path. Verified against
 * the tree before a line of this was written — there is no non-combat body in
 * this game, no task AI, no idle rig and no tool VFX. `buildRemote` is a
 * floating ball, `buildDummy` is two cylinders, `pilotBody` is eight parts
 * bolted into a seat. Every row of `ARCHETYPES` is a fighter, and a fighter
 * given somewhere to walk walks like a fighter: `BipedAnimator` at 4.2 m/s
 * with an aim solver looking for something to shoot.
 *
 * So the near field is MACHINERY, which has no gait to get wrong:
 *
 *   · three repair droids, stationary, at three jobs — treads, a turntable,
 *     one articulated arm and a welder. Three `Object3D` rotations and a
 *     spark burst. No rig, no IK, no nav, nothing to walk anywhere.
 *   · a gantry trolley traversing on a slow loop overhead.
 *   · a loader sled crossing the far deck with a crate on it.
 *   · one tech, POSED, on the scaffold under the hull — static, lit by his own
 *     arc, at 34 m, where a welding flare is most of what you see of him.
 *
 * and the far field is silhouettes at 40-70 m through haze, which is the only
 * range at which a figure with no legs moving is honest. See `addDeckCrew`.
 *
 * ── THE HAZE IS THE CHEAPEST THING IN THE FILE AND IT DOES THE MOST ───────
 *
 * `HANGAR-SPEC.md` calls it out and it is right: haze is what lets the far
 * half of a 128 m deck be four dark shapes and a moving light instead of
 * modelled geometry. See `addDeckHaze` for the two halves of it and for the
 * one thing this file changes that it does not own.
 *
 * ── COST ──────────────────────────────────────────────────────────────────
 *
 * The bound is not a feeling. `tools/checks/hangar.mjs` fails the room at 380
 * meshes and the dressed deck already stands at 336, so everything below is
 * built to fit in the 44 that are left. Measured, on the scene:
 *
 *   droid chassis ×3 (one merge)   3 meshes   2 532 tris
 *   droid arms     ×3              12           1 476
 *   loader sled                     3             468
 *   trolley + hoist                 2             308
 *   tech + torch                    2             784
 *   field ripple rings              2             176
 *   crew (one InstancedMesh, 14)    1             200   (2 800 rasterised)
 *   haze sheets (one buffer)        1               6
 *                                  ──          ──────
 *                                  26           5 950
 *
 * That is why the three droid chassis are one merge and not three, why the
 * crew are one `InstancedMesh`, and why the welding arcs and the sled beacon
 * go through `Engine.lightUp` rather than adding point lights: the pool is
 * fixed at eight for the life of the renderer, and adding one recompiles every
 * lit material in the scene.
 *
 * ── THE API ───────────────────────────────────────────────────────────────
 *
 *   dressDeckLife(world)      build. Call after `dressHangar`, once.
 *   stepDeckLife(world, dt)   animate. Call every frame with the world's dt.
 *
 * `stepDeckLife` allocates nothing: every vector, quaternion and colour it
 * needs is a module-level scratch below, and every schedule is a float on
 * `world._deckLife`.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, lerp, smoothstep, TAU, makeRng } from '../engine/MathUtil.js';
import { Kit, propMaterials, mergeGeos, slabGeo, cylGeo, torusGeo } from '../world/Props.js';
import { DECK } from './Hangar.js';
import { DeckBuild, deckMats, catwalk } from './DeckKit.js';

/* Scratch. `stepDeckLife` runs at 60 Hz over eight movers and a fourteen-body
 * crowd; a Vector3 per mover per frame is 1 300 allocations a second for
 * arithmetic that never leaves the function. */
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _c = new THREE.Color();

/* ══════════════════════════════════════════════════════════════════════ */
/*  0 · THE FRAME — and there is not one loose metre below it             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE ROOM DOUBLED AND THIS FILE STAYED WHERE IT WAS ════════════════════
 *
 * Every coordinate here used to be a literal, measured against a 128 m deck
 * with the aft face at -46 and the lip at 64. `Hangar.js` then rebuilt the room
 * at 288 m — aft -104, lip 144, the player put down 30 m further back — and
 * nothing in this file moved. What that cost, item for item:
 *
 *   the trolley   rode a rail `addGantry` no longer builds, through open air
 *   the tech      stood 4.1 m up on a scaffold that had been deleted
 *   the droids    sited "beside the hull section, under the gantry" — neither
 *                 of which existed any more
 *   the sled      ran a 100 m stripe 113 m out, at 0.9 haze: a grey smear
 *   the crew      walked at 89-142 m against a comment claiming 48-70, and one
 *                 of their errands walked down into the pit and out again
 *   the vents     hissed into open air four metres above the pit floor
 *
 * Not one of those is a bug in the code. Every one of them is a NUMBER that
 * described the old room, so the fix is not to retype them against the new one
 * — that is the same failure with a later date on it. The fix is that nothing
 * below is a metre: everything is a fraction of `DECK`, and a rescale carries
 * the whole file with it.
 *
 * The four rulers:
 *
 *   `across(f)`  fraction of the canyon's half-beam — the rack walls.
 *   `fwd(m)`     metres in front of where the player is actually put down.
 *   `deep(f)`    fraction of the run from the muster line out to the lip.
 *   `NEAR`/`MID` the two bands: close enough to have to be real, and far
 *                enough to be a shape.
 *
 * Object DIMENSIONS below are still metres, and should be. A welding tech is
 * 1.8 m tall in any size of room; only WHERE he stands is a property of it.
 */

/**
 * ══ AND IT IS COMPUTED ON FIRST CALL, NOT AT IMPORT ═══════════════════════
 *
 * `Hangar.js` imports this file and this file imports `DECK` from `Hangar.js`,
 * which is a cycle — and a cycle in ES modules does not fail evenly. It fails
 * on whichever import order reaches the wrong half first: a module-level
 * `const WALL = DECK.lip * …` is evaluated while `Hangar.js` is still on its
 * own import list, so `DECK` is in the temporal dead zone and the whole tree
 * throws `Cannot access 'DECK' before initialization`. Booting the deck
 * through `tools/_one.mjs hangar` is exactly that order.
 *
 * Every other reader of `DECK` in this file already happened to be inside a
 * function body, which is the only reason it has never bitten here.
 * `Hangar.js`'s own `outsideLevel` note records the same trap from the other
 * side. So the frame is a MEMOISED CALL, not a set of constants: nothing below
 * touches `DECK` until something asks for the frame, and by then both halves
 * of the cycle have finished evaluating.
 */
let FRAME = null;
function frame() {
  if (FRAME) return FRAME;
  /**
   * Half the beam of the canyon. `dressStructure` stands the rack walls here
   * and keeps the number to itself — `DECK.bays` is the nearest thing the
   * header publishes and it is the DEPTH of the solid structure, not its beam.
   * So this is written as the fraction of the lip the racks actually stand at,
   * and `tools/checks/decklife.mjs` measures the built racks and fails if the
   * two ever stop agreeing.
   */
  const WALL = DECK.lip * (7 / 18);
  /** The deck in front of the player: what every distance below is a slice of. */
  const RUN = DECK.lip - DECK.start.z;
  /** The line to the lip — the room ahead of the FORMATION rather than the man. */
  const SPAN = DECK.lip - DECK.line;
  /**
   * NEAR is "the closest NPCs, and they have to be real" — the spec's own
   * words about the droids. MID is the far midground the crew and the traffic
   * live in. Both are read off the room rather than typed, so the near work
   * stays near however long the deck gets.
   */
  const NEAR = RUN * 0.10;
  const MID = [RUN * 0.26, RUN * 0.48];

  const fwd = (m) => DECK.start.z + m;
  const deep = (f) => DECK.line + SPAN * f;
  const across = (f) => f * WALL;

  /**
   * ══ WHERE A MAN MAY NOT BE PUT ════════════════════════════════════════
   *
   * `deckColliders` closes the rack walls with one box a side whose inboard
   * face is 48.5 m out, not 56: the bays are RECESSED into the wall and the
   * mouth of the recess is where the room actually stops. And the company now
   * marches from the bulkhead doors at `DECK.aft + 8` straight past the player
   * to the line, so the whole centre of the aft third is a corridor with
   * twenty-four men walking down it.
   *
   * Everything sited below is outside both, which is why the two "closest NPC"
   * droids are abeam of the player rather than in front of him.
   */
  const CLEAR = WALL * 0.85;

  /**
   * ══ THE REPAIR BAY — the one place with a job going on in it ══════════
   *
   * `HANGAR-SPEC.md`: "One ship on a pad mid-repair with a tech on a scaffold,
   * sparks, welding flare." What shipped was the sparks and the flare with
   * nothing under them: `addGantry` and `addScaffold` were deleted from
   * `Hangar.js` in the rebuild and this file went on placing a man at the
   * height the scaffold used to be.
   *
   * It stands starboard for one reason: the pit is cut into the PORT half of
   * the plate and it has already moved once, so the one heavy assembly in the
   * file is put where the heightfield is flat under both the old cut and the
   * new one — and `groundAt` samples under every leg anyway.
   *
   * Sited off `DECK.line` rather than off the player, because what it must
   * clear is the muster ground: a hull section standing where the company
   * forms up is a hull section standing in twenty-four men.
   */
  const BAY = {
    x: across(0.58),
    z: deep(0.12),
    /* Metres, and rightly: a hull section is a hull section in any room. */
    len: 15, rad: 3.0, jack: 2.6,
  };
  /** The portal that straddles it, and the rail the trolley actually rides. */
  const GANTRY = {
    /* Wide enough to stand its legs outside the jacks and the scaffold both. */
    half: BAY.len * 0.87,
    /* A quarter of the way to the overhead field: high enough to carry a hull
     * plate over the section, low enough to be furniture rather than sky. */
    beamY: DECK.roof * 0.25,
  };
  /** The lift the tech stands on, beside the section's port flank. */
  const SCAFFOLD = {
    x: BAY.x - BAY.rad - 2.0,
    z: BAY.z + 1.5,
    /* Two lifts: the working one at chest height to the flank, one over it. */
    lifts: [BAY.jack + 0.7, BAY.jack + 3.4],
    len: 9.0, wide: 2.6,
  };

  return (FRAME = { WALL, RUN, SPAN, NEAR, MID, CLEAR, fwd, deep, across, BAY, GANTRY, SCAFFOLD });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Materials — cached for the process, like propMaterials                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The four surfaces this file owns, built once and never disposed.
 *
 * `World.unload` disposes the GEOMETRY of everything in `statics` and leaves
 * materials alone, which is right — `propMaterials` hands out process-global
 * singletons and a level that disposed one would black out the next. These
 * follow the same rule for the same reason: they are cached here, so three
 * visits to the deck build three sets of geometry and one set of materials.
 */
let MATS = null;
function deckMaterials() {
  if (MATS) return MATS;
  const P = propMaterials();
  MATS = {
    /* THE CREW, AND WHY THEY ARE A MATERIAL AND NOT A COLOUR. At 40-70 m
     * through the haze below, a figure is 12-22 px tall and everything about
     * it that survives is its outline against the deck. So it is matte, it is
     * one value darker than the deck plate it stands on (0x474e58), and it has
     * no accent on it at all — an accent at that size is a coloured pixel that
     * flickers as the figure walks. */
    crew: new THREE.MeshStandardMaterial({ color: 0x2b323d, roughness: 0.94, metalness: 0.05 }),
    /* The tech's coveralls: the same argument at 34 m, one step warmer so he
     * is not read as one of the far crew who wandered in. */
    coverall: new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.92, metalness: 0.04 }),
    /**
     * ══ ONE MATERIAL FOR EVERY BURNING THING IN THE ROOM ══════════════════
     *
     * Three welder emitters, a cutting torch, a sled beacon and four engine
     * bells used to be six materials on six meshes, because
     * `emissiveIntensity` is per-material and an arc that strikes has to
     * strike on its own. Six meshes is six draw calls, doubled by the ink
     * pass, for objects that are between two and twelve pixels across.
     *
     * They are one `InstancedMesh` now and the brightness rides on
     * `instanceColor`, which three multiplies into `vColor` per instance —
     * so nine emitters flicker independently for one draw call. It is
     * `MeshBasicMaterial` and not `MeshStandard` for `DeckKit`'s own stated
     * reason: a shaded emissive is still tone-mapped and still loses to a
     * dark ambient, and the one thing an arc must never be is dim. The colour
     * is left at white and the HDR value is carried per instance, which is
     * what lets a strike go to 5× without touching the other eight.
     */
    glow: (() => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      /* A 2 cm arc has no silhouette worth inking, and the ink pass would
       * rasterise all nine of them a second time to find that out. */
      m.userData.saberNoInk = true;
      return m;
    })(),
    haze: hazeMaterial(),
    ring: [0, 1].map(() => ringMaterial()),
    steel: P.darkSteel,
    trim: P.rust,
    lamp: P.glowAmber,
    crate: P.crate,
  };
  return MATS;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE EMITTERS — nine burning points, one draw call                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Which instance is what. Fixed slots rather than a free list: every one of
 * these has an owner for the life of the level, and a pool would cost a
 * lookup per frame to answer a question that never changes.
 */
const GLOW = { arc: 0, torch: 3, beacon: 4, engine: 5, count: 9 };

function addGlows(world, life) {
  const M = deckMaterials();
  /* One tapered stub, one metre along +Y, scaled per instance into an arc
   * tip, a torch, a beacon or an engine bell. At the ranges these are seen
   * from — 20 m for the nearest, 90 for the furthest — the difference between
   * a cone and a cylinder is nothing, and the difference between one geometry
   * and four is three buffers. */
  const im = new THREE.InstancedMesh(cylGeo(0.5, 0.16, 1.0, 8, 0.4), M.glow, GLOW.count);
  im.frustumCulled = false;
  im.castShadow = false; im.receiveShadow = false;
  im.renderOrder = 1;
  im.name = 'deck-glows';
  /* Everything starts dark and folded to nothing. A slot whose owner has not
   * been built yet — the ships are away for two thirds of their loop — must
   * not draw a stub at the origin. */
  _s.set(0, 0, 0);
  _q.identity(); _v.set(0, 0, 0);
  for (let i = 0; i < GLOW.count; i++) {
    im.setMatrixAt(i, _m.compose(_v, _q, _s));
    im.setColorAt(i, _c.setRGB(0, 0, 0));
  }
  world.scene.add(im);
  world.statics.push(im);
  life.glows = im;
}

/**
 * Park one emitter: `m4` is where its base sits in the world, `sx`/`sy` how
 * wide and how long the stub is scaled to.
 *
 * Split from the brightness on purpose — the tech never takes a step, so his
 * torch's matrix is written once at dress and only its colour is touched at
 * 60 Hz.
 */
function glowPlace(life, slot, m4, sx, sy) {
  const im = life.glows;
  if (!im) return;
  _s.set(sx, sy, sx);
  _v.set(0, 0, 0); _q.identity();
  im.setMatrixAt(slot, _m.compose(_v, _q, _s).premultiply(m4));
  im.instanceMatrix.needsUpdate = true;
}

/** How hard it is burning. HDR: past 1 is what the bloom pass picks up. */
function glowBurn(life, slot, r, g, b) {
  const im = life.glows;
  if (!im) return;
  im.setColorAt(slot, _c.setRGB(r, g, b));
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  A merge helper for the parts that MOVE                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Bin by material, merge, hang on a parent that is allowed to move.
 *
 * `Props.Kit` is the right tool for everything nailed down and the wrong one
 * here for one line: `Kit.emit` goes through `addStatic`, which sets
 * `matrixAutoUpdate = false` and calls `updateMatrix` once. That is exactly
 * what a set piece wants and exactly what a trolley on a rail cannot have.
 * `Vehicles.js:265` has the same helper for the same reason and does not
 * export it; this is twenty lines rather than a shipped-file edit.
 */
class Bin {
  constructor() { this.bins = new Map(); }

  /** Place a geometry — rotate (XYZ euler), translate, bin it. */
  put(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (rx || ry || rz) geo.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz)));
    if (x || y || z) geo.translate(x, y, z);
    let a = this.bins.get(mat);
    if (!a) this.bins.set(mat, a = []);
    a.push(geo);
    return this;
  }

  /**
   * One mesh per material, parented to `parent`.
   *
   * Every mesh is also pushed to `world.statics` — not to be placed, but to be
   * FREED: `World.unload` walks that array disposing geometry, and a mesh that
   * is only a child of a group it never sees is a buffer that outlives the
   * level. The group goes in too, so `scene.remove` takes the whole assembly.
   */
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

/* ══════════════════════════════════════════════════════════════════════ */
/*  1 · THE HAZE                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE CHEAP TRICK THAT CARRIES THE WHOLE FAR HALF ═══════════════════════
 *
 * It is two things, and they do different jobs.
 *
 * FIRST, EXTINCTION, AND IT IS SOLVED OFF THE ROOM RATHER THAN TYPED.
 *
 * This was 0.0105, and the comment that justified it reasoned about "the 60 m
 * to the far crew" and "the whole 128 m diagonal" — a room that has not
 * existed since the rebuild. The deck's diagonal is 380 m now and the aperture
 * rim stands `DECK.lip - DECK.start.z` from where the player is put down.
 * Measured at 0.0105, from the spawn:
 *
 *     26 m   7.2%      100 m  66.8%      218 m  99.5%
 *     50 m  24.1%      150 m  91.6%      380 m 100.0%
 *
 * So the haze was eating the rim — the brightest object in the frame and the
 * one thing rule 1 says must be brighter than everything it lights — along
 * with both rack walls and the whole aft bulkhead. A number tuned for a shed
 * applied to a hangar is a fade to grey.
 *
 * THE THING IT MUST NOT EAT IS THE RIM, so that is what it is solved against:
 * the haze may take two thirds of the rim's contrast at the distance the
 * player actually stands from it, and no more. That is one line of algebra off
 * `exp(-d²k²)` and it re-solves itself if the room is resized again. At the
 * present room it lands at 0.0045, which reads
 *
 *     26 m   1.4%      100 m  18.1%      218 m  65.0%
 *     57 m   6.4%      150 m  36.4%      380 m  94.6%
 *
 * — near work crisp, the crew at 57-116 m softening, the far rows and the
 * bulkhead gone, and the rim still the brightest thing in the picture.
 *
 * That number is a property of the ROOM and belongs in
 * `HANGAR_LEVEL.atmosphere`; it is set here because this lane does not own
 * that file, and it is written through the same two calls `applyAtmosphere`
 * makes (`scene.fog.density` and `OutlinePass.setHaze`) so the ink stops where
 * sight does. Without the second one the outline pass keeps ruling hard black
 * lines around shapes the fog has already dissolved, which is worse than no
 * haze at all. **See the report: this is the one line that reaches outside.**
 *
 * ONE THING IT CANNOT FIX FROM HERE. The field planes are a `ShaderMaterial`
 * with no fog chunk in it, so the shield is not extinguished at all, while the
 * `MeshBasicMaterial` rim standing on top of it is — which inverts the depth
 * cue and makes the shield read as NEARER than the frame around it. The fix is
 * a fog chunk on `fieldMaterial`, which is `Hangar.js`. Lowering the density
 * makes the mismatch smaller; it does not remove it.
 *
 * SECOND, THE BAND. Extinction alone tends everything toward a very dark fog
 * colour, which reads as the far deck being unlit rather than as air. So three
 * horizontal sheets of lit haze sit at 0.9, 2.4 and 4.2 m.
 *
 * They are HORIZONTAL on purpose and it is the whole reason they work. A
 * vertical curtain has to face the camera and swims when you turn; a sheet
 * lying flat has no bearing at all. The geometry does the distance ramp by
 * itself: from a 1.7 m eye the sheet at 4.2 m is only crossed by rays with
 * elevation above `asin(2.5 / 98)` = 1.5°, so it draws a band hugging the
 * horizon and nothing anywhere else, and the sheets below the eye do the same
 * upside down over the floor. That is haze piling up at the lip, for one draw
 * call, with no billboard in it.
 *
 * They stop dead at `DECK.lip`. A sheet that ran past it would be a grey wash
 * over the planet, seen through the field, which is the one surface in the
 * room that must not be touched.
 */
/** How much of the aperture rim's contrast the haze is allowed to take. */
const RIM_EATEN = 0.65;

const HAZE = {
  /**
   * Solved, not typed. `1 - exp(-d²k²) = RIM_EATEN` at the distance from the
   * player's own spawn to the rim, which is the one sight line in the room
   * that has to survive.
   *
   * A GETTER, for the reason `frame()` is a call: reading `DECK` while this
   * module is still being evaluated is the import cycle's dead zone, and a
   * property that is only read from inside `hazeMaterial` and `addDeckHaze`
   * has no reason to be evaluated any earlier than they are.
   */
  get density() { return Math.sqrt(-Math.log(1 - RIM_EATEN)) / (DECK.lip - DECK.start.z); },
  /** Sheet heights, metres. */
  lifts: [0.9, 2.4, 4.2],
  /** Per-sheet weight — the floor sheet is the faintest, it is nearest. */
  weights: [0.55, 0.85, 1.0],
  /** Peak alpha of the whole stack. Past about 0.3 it is a fog bank. */
  peak: 0.24,
  /** Metres before the haze is allowed to exist at all. */
  near: 14,
};

function hazeMaterial() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x7e93ad) },
      /* A SHADE DENSER THAN THE EXTINCTION IT SITS IN, and deliberately: the
       * sheet is the LIT part of the haze and the fog is the dark part, so if
       * the two saturated together the band would arrive exactly as the
       * geometry behind it went black and there would be nothing to see it
       * against. At 1.15× the sheet is already reading at 40 m while the fog
       * has taken only 15%. */
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
        /* The same exponential the engine's own fog chunk uses, so the sheet
           and the extinction agree about what distance means. */
        float a = 1.0 - exp(-d * d * uDensity * uDensity);
        /* AND NOTHING IN YOUR FACE. A flat sheet 0.7 m under the eye is
           crossed at two metres by any ray angled down at 20 degrees, and
           without this the player's own boots would be behind a curtain. */
        a *= smoothstep(uNear * 0.3, uNear, d);
        gl_FragColor = vec4(uColor, a * uPeak * vWeight);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  /* Haze has no edge, so it must not be given one. */
  mat.userData.saberNoInk = true;
  return mat;
}

function addDeckHaze(world, life) {
  const M = deckMaterials();
  const L = DECK.lip;

  /* The extinction half. Both writes, or neither. */
  if (world.scene.fog) {
    life.fog0 = world.scene.fog.density;
    world.scene.fog.density = HAZE.density;
    world.engine?.outline?.setHaze?.(HAZE.density);
  }

  /* Three sheets in one buffer: they share a material and a draw call, and
   * the per-sheet weight rides on a vertex attribute rather than on three
   * uniforms, because three uniforms would be three meshes. */
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
  mesh.renderOrder = 2;                        // under the field, which is 3
  mesh.castShadow = false; mesh.receiveShadow = false;
  world.scene.add(mesh);
  world.statics.push(mesh);
  life.haze = mesh;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  2 · THE GROUND, AND THE HOLE IN IT                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/** The deck under a point. Sampled, never assumed — see below for why. */
function groundAt(world, x, z) {
  return world.terrain ? world.terrain.height(x, z) : 0;
}

/**
 * ══ FIND THE PIT. DO NOT BE TOLD WHERE IT IS ══════════════════════════════
 *
 * `TERRAIN_PRESETS.hangardeck` cuts a lit recess into the plate, and two
 * comments in this file used to reason about it in metres: "a 1.4 m LAUNCH
 * TRENCH at |x + 34| < 7". There has been no trench for two rebuilds; there is
 * a rectangular pit, it is 3.2 m deep, it has already moved once and it is
 * being moved again as this is written. Every one of those numbers was written
 * down by someone who had read the heightfield at the time, and every one of
 * them was wrong within a week.
 *
 * So nothing here is told where the hole is. The plate is sampled on a 3 m
 * grid once, at dress, and whatever is more than 0.8 m below the level the
 * company musters on is the hole — wherever it is, however many there are, and
 * whatever shape. Four thousand `height()` calls is about a millisecond, once,
 * and it is the difference between a crew errand that walks around the pit and
 * one that walks down into it.
 *
 * The 0.8 m threshold is chosen against the two features that are NOT holes:
 * the 5.5 cm plate seam and the 0.6 m fall in the last two metres of lip.
 */
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

/** Does the segment a→b pass over the hole, with a metre or three to spare? */
function crossesHole(H, ax, az, bx, bz, pad = 3) {
  if (!H.found) return false;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = lerp(ax, bx, t), z = lerp(az, bz, t);
    if (x > H.x0 - pad && x < H.x1 + pad && z > H.z0 - pad && z < H.z1 + pad) return true;
  }
  return false;
}

/**
 * Slide a looping path off the hole, in place.
 *
 * `CREW_RUNS[9]` used to walk from (-56, 16) to (-30, 16) and back, which on
 * the present heightfield is a man descending three metres into a lit pit,
 * standing on nothing, and climbing out again — forever. He was not visible
 * enough for anyone to notice, which is the whole argument for the check file.
 *
 * The errand is MOVED rather than deleted, and it keeps its length and its
 * heading: the shape of a crossing crewman is what the far midground is for,
 * and a room that loses a path every time the ground changes ends up empty.
 * Out the near side first, in two-metre steps, then along the other axis if
 * the canyon runs out before the hole does.
 */
function offHole(H, run) {
  if (!crossesHole(H, run[0], run[1], run[2], run[3])) return true;
  const cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2;
  const sx = (run[0] + run[2]) / 2 >= cx ? 1 : -1;
  const sz = (run[1] + run[3]) / 2 >= cz ? 1 : -1;
  const edge = frame().CLEAR;
  for (const axis of [0, 1]) {
    for (let k = 1; k <= 34; k++) {
      const d = k * 2;
      const dx = axis === 0 ? sx * d : 0;
      const dz = axis === 0 ? 0 : sz * d;
      const a = [run[0] + dx, run[1] + dz, run[2] + dx, run[3] + dz];
      if (Math.abs(a[0]) > edge || Math.abs(a[2]) > edge) break;
      if (a[1] < DECK.aft + 14 || a[3] < DECK.aft + 14) break;
      if (a[1] > DECK.lip - 14 || a[3] > DECK.lip - 14) break;
      if (crossesHole(H, a[0], a[1], a[2], a[3])) continue;
      run[0] = a[0]; run[1] = a[1]; run[2] = a[2]; run[3] = a[3];
      return true;
    }
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  3 · THE REPAIR BAY — the thing the tech is standing on                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A HULL SECTION ON JACKS, A SCAFFOLD, AND A GANTRY OVER BOTH ═══════════
 *
 * The spec bullet is "one ship on a pad mid-repair with a tech on a scaffold,
 * sparks, welding flare", and what the room had was the sparks and the flare
 * with a man floating four metres above bare plate. `addScaffold` and
 * `addGantry` were both deleted from `Hangar.js` in the rebuild and this file
 * kept placing props against them.
 *
 * IT IS BUILT HERE NOW, AND IT COSTS THREE DRAW CALLS. `DeckKit.DeckBuild`
 * bins by material and emits one mesh for the whole assembly per material, so
 * a gantry, a scaffold, four jacks and a sectioned hull come out as hull, dark
 * and strip — three meshes, and `catwalk` composes into the same three because
 * it draws from the same six materials. Building it out of `Props.Kit` instead
 * would have brought weathering and a village's palette into a painted steel
 * room, which is the mistake `Hangar.js`'s own header records.
 *
 * WHAT IT DOES NOT GET FROM `DeckBuild` IS COLLIDERS, so the four things a
 * player can walk into — two gantry legs, the hull section, the scaffold — get
 * static boxes of their own. Nothing else is worth one: at a 0.5 m capsule
 * radius a handrail is a thing you brush past.
 */
function addRepairBay(world, life) {
  const { BAY, GANTRY, SCAFFOLD } = frame();
  const M = deckMats();
  const kit = new DeckBuild();
  const g0 = groundAt(world, BAY.x, BAY.z);
  const box = (x, y, z, hx, hy, hz) => world.physics?.addStaticBox?.(
    _v.set(x, y, z).clone(), _v2.set(hx, hy, hz).clone(), new THREE.Quaternion(),
    { friction: 0.7 });

  /* ── THE JACKS. Four stands under the section, splayed, with a saddle each.
   * The splay is the tell: four vertical posts is a table, and a jack stand
   * carries a load it was wound up under. */
  const jz = BAY.len * 0.32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = BAY.x + sx * (BAY.rad - 0.6), z = BAY.z + sz * jz;
    kit.slabAt(M.hull, x, g0 + BAY.jack * 0.5, z, 0.55, BAY.jack, 0.55);
    kit.slabAt(M.dark, x, g0 + 0.16, z, 1.9, 0.32, 1.9);
    /* The saddle, canted into the shell it is holding. */
    kit.slabAt(M.hull, x - sx * 0.35, g0 + BAY.jack + 0.22, z, 1.5, 0.5, 1.1, 0);
  }

  /* ── THE SECTION. A barrel of hull with both ends open, which is the whole
   * reason it reads as a piece of a ship being worked on rather than as a
   * tank on a stand: you can see the frames inside it. */
  const shell = new THREE.CylinderGeometry(BAY.rad, BAY.rad, BAY.len, 12, 1, true);
  shell.rotateX(Math.PI / 2);
  kit.geoAt(M.hull, shell, BAY.x, g0 + BAY.jack + BAY.rad, BAY.z);
  /* Four ring frames showing through the open ends. */
  for (let i = 0; i < 4; i++) {
    const r = new THREE.TorusGeometry(BAY.rad * 0.93, 0.16, 4, 14);
    r.rotateY(Math.PI / 2); r.rotateZ(Math.PI / 2);
    kit.geoAt(M.dark, r, BAY.x, g0 + BAY.jack + BAY.rad, BAY.z + (i / 3 - 0.5) * BAY.len * 0.86);
  }
  /* A spine along the top and a plate off the port flank, hanging on the
   * gantry's hook line — the panel the tech is welding back on. */
  kit.slabAt(M.dark, BAY.x, g0 + BAY.jack + BAY.rad * 1.92, BAY.z, 1.1, 0.5, BAY.len * 0.8);
  kit.slabAt(M.dark, BAY.x - BAY.rad * 0.86, g0 + BAY.jack + BAY.rad * 0.78, BAY.z - 1.2,
    0.35, 2.6, 3.4, 0.22);
  /* THE WORK LIGHT UNDER IT. Rule 4 — light in this room is a thin bright bar
   * set into structure, never a lamp head — and it is what stops a six-metre
   * barrel being a black lump in a dark room. */
  kit.slabAt(M.strip, BAY.x, g0 + BAY.jack - 0.12, BAY.z, 1.4, 0.14, BAY.len * 0.72);
  box(BAY.x, g0 + BAY.jack + BAY.rad, BAY.z, BAY.rad, BAY.rad + BAY.jack * 0.5, BAY.len / 2);

  /* ── THE SCAFFOLD. Four legs, two lifts and a ladder between them, standing
   * clear of the flank by the length of a man's arm and his torch. */
  const sx0 = SCAFFOLD.x, sz0 = SCAFFOLD.z;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    kit.slabAt(M.hull, sx0 + a * SCAFFOLD.wide * 0.5, g0 + SCAFFOLD.lifts[1] * 0.55,
      sz0 + b * SCAFFOLD.len * 0.5, 0.22, SCAFFOLD.lifts[1] * 1.1, 0.22);
  }
  for (const y of SCAFFOLD.lifts) {
    /* `DeckKit.catwalk` is exactly a scaffold lift seen from the deck — a
     * plank, a handrail and stanchions — and it bins into the same three
     * materials, so two of them are free. Turned to run along the hull. */
    catwalk(kit, sx0, g0 + y - 0.25, sz0, SCAFFOLD.len, { yaw: Math.PI / 2 });
  }
  /* The ladder. Two stiles and five rungs, at the aft end where it is out of
   * the way of the work and in the player's line to it. */
  for (const a of [-1, 1]) {
    kit.slabAt(M.hull, sx0 + a * 0.28, g0 + (SCAFFOLD.lifts[0] + SCAFFOLD.lifts[1]) * 0.5,
      sz0 - SCAFFOLD.len * 0.44, 0.07, SCAFFOLD.lifts[1] - SCAFFOLD.lifts[0] + 0.9, 0.07);
  }
  for (let i = 0; i < 5; i++) {
    kit.slabAt(M.hull, sx0, g0 + SCAFFOLD.lifts[0] + 0.1 + i * 0.56,
      sz0 - SCAFFOLD.len * 0.44, 0.62, 0.06, 0.06);
  }
  box(sx0, g0 + SCAFFOLD.lifts[1] * 0.5, sz0,
    SCAFFOLD.wide * 0.5, SCAFFOLD.lifts[1] * 0.5, SCAFFOLD.len * 0.5);

  /* ── THE GANTRY. A portal straddling the whole bay, with the rail the
   * trolley actually rides on the underside of the beam. This is the spec's
   * "gantry crane traversing overhead on a slow loop", and the crab that does
   * the traversing is `addTrolley` below — kept a separate mover because half
   * a merged mesh cannot be moved, which is the same reason `Hangar.js`'s own
   * gantry could never have carried it. */
  for (const s of [-1, 1]) {
    const lx = BAY.x + s * GANTRY.half;
    const lg = groundAt(world, lx, BAY.z);
    kit.slabAt(M.dark, lx, lg + GANTRY.beamY * 0.5, BAY.z, 1.5, GANTRY.beamY, 1.9);
    kit.slabAt(M.hull, lx, lg + 0.35, BAY.z, 3.2, 0.7, 4.0);
    /* Bracing, one diagonal each way, so a 16 m leg is a frame and not a post. */
    for (const b of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.28, GANTRY.beamY * 0.62, 0.28);
      g.rotateX(b * 0.42);
      kit.geoAt(M.hull, g, lx, lg + GANTRY.beamY * 0.42, BAY.z + b * GANTRY.beamY * 0.13);
    }
    box(lx, lg + GANTRY.beamY * 0.5, BAY.z, 0.85, GANTRY.beamY * 0.5, 1.05);
  }
  const span = GANTRY.half * 2 + 3;
  kit.slabAt(M.hull, BAY.x, g0 + GANTRY.beamY + 0.55, BAY.z, span, 1.1, 1.7);
  /* THE RAIL, and it is a real one: `TROLLEY.y` is read off it below rather
   * than typed, so a crab cannot again be left riding air. */
  kit.slabAt(M.dark, BAY.x, g0 + GANTRY.beamY - 0.1, BAY.z, span, 0.36, 0.9);
  kit.slabAt(M.strip, BAY.x, g0 + GANTRY.beamY + 1.15, BAY.z, span * 0.94, 0.14, 0.5);

  life.bay = { ground: g0, meshes: kit.build(world) };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  4 · THE REPAIR DROIDS                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THREE MACHINES AT THREE JOBS ══════════════════════════════════════════
 *
 * A droid is four rigid bodies — chassis, turret, boom, forearm — and three
 * angles. That is all the articulation there is and all there needs to be: a
 * turntable sweeping, a boom breathing and a wrist tracking a seam is what a
 * welding machine looks like from six metres, and it is a rotation each.
 *
 * THE CHASSIS OF ALL THREE IS ONE MERGE. It never moves relative to the deck,
 * so three chassis binned into one `Props.Kit` at three world points come out
 * as three draw calls TOTAL rather than nine — steel, hazard trim, lamps —
 * and the kit brings their colliders with it, so you cannot walk through one.
 * The moving parts are what cost per droid, and they are four meshes each.
 *
 * Measured: 15 meshes for three droids, 4 008 triangles — 3 chassis meshes
 * shared by all of them and 4 apiece for the arm.
 */
let JOBS = null;
function droidJobs() {
  if (JOBS) return JOBS;
  const { across, fwd, NEAR, BAY } = frame();
  return (JOBS = [
    /**
     * THE PLATE. Abeam of the player, twenty-four metres off his port side,
     * and that placement is the whole point of the section.
     *
     * It used to be "sixteen metres off the player's start and on the path he
     * walks to the line". Both halves of that are now wrong and the second one
     * is worse than the first: the company marches from the bulkhead doors at
     * `DECK.aft + 8` PAST the player to the line, so what used to be an empty
     * approach is a corridor with twenty-four men walking down it, and a droid
     * on it is a droid twenty-four men walk through. So the two near jobs are
     * ABEAM rather than ahead — the same distance, out of the traffic.
     */
    { x: across(-0.42), z: fwd(NEAR * 0.12), yaw: 1.1,
      sweep: 0.75, reach: 1.32, lift: 0.24, duty: 0.44, phase: 2.9 },
    /* THE PANEL. Starboard quarter, a little forward, working down at deck
     * level. Far enough outboard to clear the widest rank the company forms. */
    { x: across(0.46), z: fwd(NEAR * 0.55), yaw: -2.3,
      sweep: 0.9, reach: 0.95, lift: 0.62, duty: 0.35, phase: 5.4 },
    /**
     * THE SEAM. At the foot of the hull section, under the gantry — the one
     * job in the room with a reason to be lit, and the one the tech's arc is
     * already lighting. It is sited off `BAY` rather than typed, which is what
     * the last version of this line could not say: it claimed to stand
     * "beside the hull section on jacks, under the gantry" when neither
     * existed, and it argued at length about a launch trench that has not been
     * in the heightfield for two rebuilds.
     */
    { x: BAY.x - BAY.rad - 2.4, z: BAY.z - BAY.len * 0.42, yaw: Math.PI / 2,
      sweep: 0.42, reach: 0.78, lift: 1.15, duty: 0.62, phase: 0.0 },
  ]);
}

/** The part of a droid that is bolted down. Binned into a shared kit. */
function droidChassis(kit, M) {
  const steel = M.steel, trim = M.trim, lamp = M.lamp;

  /* Treads. Two units either side with three road wheels showing under the
   * skirt — the wheels are what stop a tracked chassis reading as a box on
   * the floor, and at 12 tris each they are the cheapest silhouette in the
   * assembly. */
  for (const sx of [-1, 1]) {
    kit.slab(steel, 0.40, 0.34, 1.42, sx * 0.52, 0.26, 0, { tile: 1.1, seg: 2, collide: false });
    kit.slab(trim, 0.44, 0.10, 1.46, sx * 0.52, 0.44, 0, { tile: 1.1, seg: 2, collide: false });
    for (let i = 0; i < 3; i++) {
      kit.put(cylGeo(0.135, 0.135, 0.30, 8, 0.6), trim,
        sx * 0.52, 0.17, (i - 1) * 0.46, 0, 0, Math.PI / 2);
    }
  }
  /* The belly and the hull deck, two courses so the profile has a shoulder —
   * `addMachine`'s rule, and it is the difference between a machine and a
   * crate on tracks. */
  kit.slab(steel, 1.24, 0.24, 1.12, 0, 0.36, 0, { tile: 1.1, seg: 2, collide: false });
  kit.slab(steel, 1.06, 0.30, 1.06, 0, 0.60, 0, { tile: 1.1, seg: 3, collide: false });
  /* The locker aft, where the spare rod and the gas bottle live. */
  kit.slab(steel, 0.74, 0.36, 0.34, 0, 0.78, -0.50, { tile: 1.1, seg: 2, collide: false });
  kit.put(cylGeo(0.09, 0.09, 0.44, 8, 0.6), trim, 0.24, 0.98, -0.50);
  /* Hazard flash across the front, and the turntable ring the torso sits in. */
  kit.slab(trim, 1.02, 0.09, 0.07, 0, 0.60, 0.55, { tile: 1.1, seg: 2, collide: false });
  kit.put(torusGeo(0.33, 0.045, 5, 14, TAU, 0.6), trim, 0, 0.755, 0);
  /* Two marker lamps. A machine that is powered says so before it moves. */
  for (const sx of [-1, 1]) {
    kit.slab(lamp, 0.10, 0.06, 0.05, sx * 0.42, 0.70, 0.56, { tile: 0.5, seg: 1, collide: false });
  }
  kit.slab(lamp, 0.16, 0.05, 0.16, 0, 0.98, -0.50, { tile: 0.5, seg: 1, collide: false });
  /* ONE collider for the whole thing. A droid is 1.2 m across and 1.5 m
   * long; a player walking into it should stop, and nothing here is worth a
   * second box. */
  kit.collider(0, 0.48, 0, 0.62, 0.48, 0.80);
}

/** Turret, boom and forearm: the three things that turn. */
function droidArm(world, group, M, arcMat) {
  const steel = M.steel;

  const turret = mover(world, group);
  turret.position.set(0, 0.76, 0);
  const tb = new Bin();
  tb.put(steel, cylGeo(0.30, 0.32, 0.44, 12, 0.8), 0, 0.22, 0);
  tb.put(steel, slabGeo(0.30, 0.26, 0.28, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.34, -0.30);
  for (const sx of [-1, 1]) {
    tb.put(steel, slabGeo(0.11, 0.36, 0.22, { bevel: 0.025, seg: 2, tile: 1.1 }), sx * 0.21, 0.48, 0.04);
  }
  /* The sensor head, tipped forward. A turntable with nothing on top of it
   * turns; a turntable with a head on it LOOKS. */
  tb.put(steel, slabGeo(0.40, 0.16, 0.22, { bevel: 0.03, seg: 2, tile: 1.1 }), 0, 0.58, 0.16, -0.30, 0, 0);
  /* The brow over the head, in the SAME bin as everything else on the turret.
   * A second material here would be a second draw call on a part that turns,
   * three times over, for a 30 cm strip seen at six metres. */
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
  /* The emitter is its own mesh so its own material can strike. */
  const eb = new Bin();
  eb.put(arcMat, cylGeo(0.055, 0.018, 0.16, 8, 0.4), 0, 0.85, 0);
  eb.bake(world, fore, { castShadow: false });

  return { turret, boom, fore };
}

function addRepairDroids(world, life) {
  const M = deckMaterials();
  const kit = new Kit(3301);
  const droids = [];
  /* THROUGH THE LAZY READER, NOT THE OLD CONSTANT. The jobs are derived from
   * `DECK` now, and `DECK` lives in a module that imports this one — so
   * reading it at module-evaluation time is a temporal dead zone, not a
   * value. `droidJobs()` is the memoised first-call form. */
  const jobs = droidJobs();
  for (let i = 0; i < jobs.length; i++) {
    const J = jobs[i];
    const y = world.terrain ? world.terrain.height(J.x, J.z) : 0;
    kit.push(J.x, y, J.z, J.yaw);
    droidChassis(kit, M);
    kit.pop();

    const g = mover(world);
    g.position.set(J.x, y, J.z);
    g.rotation.y = J.yaw;
    const arm = droidArm(world, g, M, M.arc[i]);
    droids.push({
      ...arm, job: J, arc: M.arc[i],
      /* The duty clock. A droid welds for `duty` of a 5.4 s cycle and spends
       * the rest of it re-aiming, and the three phases are 2.5 s apart so at
       * most two arcs are ever lit — three simultaneous arcs read as a
       * disco, and the bloom pass agrees. */
      t: J.phase, yaw: 0, yawTo: 0, heat: 0,
      tip: new THREE.Vector3(),
    });
  }
  kit.emit(world, new THREE.Vector3(0, 0, 0));
  life.droids = droids;
}

const DROID_CYCLE = 5.4;

function stepDroids(world, life, dt) {
  const fx = world.particles;
  const eng = world.engine;
  for (const d of life.droids) {
    d.t += dt;
    const ph = (d.t % DROID_CYCLE) / DROID_CYCLE;
    const J = d.job;
    const welding = ph < J.duty;

    /* THE TURNTABLE. It HOLDS a bearing while the arc is lit and swings to the
     * next one when it goes out — not a sine, because a continuous oscillation
     * is the single motion that says "animated prop" rather than "machine".
     *
     * STATELESS, and that is a fix rather than a style. The first version kept
     * `yawFrom`/`yawTo` on the droid and rewrote them when the eased parameter
     * came back under 0.02, which is true for a WINDOW of frames rather than
     * for one — so `from` was overwritten with `to` several frames running and
     * the machine never swung at all. Off the cycle index there is nothing to
     * get out of step: cycle n holds at `bearing(n)` and hands over to
     * `bearing(n + 1)`, which is where cycle n + 1 starts. */
    const n = Math.floor(d.t / DROID_CYCLE);
    const hold = Math.sin(n * 2.399963) * J.sweep;
    d.yaw = welding ? hold
      : lerp(hold, Math.sin((n + 1) * 2.399963) * J.sweep, smoothstep(J.duty, 1.0, ph));
    d.turret.rotation.y = d.yaw;

    /* The boom breathes and the wrist tracks. Small — a 3 cm travel at the
     * tip is a machine holding a bead; 30 cm is a machine waving. */
    const bob = Math.sin(d.t * 0.9 + J.phase) * 0.035;
    d.boom.rotation.x = J.lift + bob;
    d.fore.rotation.x = -J.reach - bob * 1.6 + (welding ? Math.sin(d.t * 7.3) * 0.012 : 0);

    /* WHERE THE ARC IS. One matrix decompose per droid per frame, into the
     * scratch above, because the tip is three transforms deep and the sparks,
     * the light and the flare all need it in world space. */
    d.turret.updateMatrixWorld(true);
    d.tip.set(0, 0.93, 0).applyMatrix4(d.fore.matrixWorld);

    /* The strike. Amplitude is a fast random-ish flicker because a real arc
     * is not a lamp — it stutters, and the stutter is most of what says
     * welding rather than glowing. */
    const flick = welding
      ? 0.55 + 0.45 * Math.sin(d.t * 41.7) * Math.sin(d.t * 17.3 + 1.1)
      : 0;
    d.heat = lerp(d.heat, flick, 1 - Math.exp(-18 * dt));
    d.arc.emissiveIntensity = 0.35 + d.heat * 7.5;
    if (d.heat > 0.05) {
      /* Through the pool, never a new PointLight — see the file header. */
      eng?.lightUp?.(d.tip, 0xbcd8ff, 22 * d.heat, 11, 0);
    }
    /* Sparks on a fixed tick rather than per frame: five bursts a second is
     * a continuous shower at 60 Hz and 60 is a firework. */
    d.spark = (d.spark || 0) + dt;
    if (welding && d.spark > 0.14) {
      d.spark = 0;
      _v.set(0, -1, 0);
      fx?.sparkBurst?.(d.tip, _v, 5,
        { speed: 5.5, color: 0xffe2b0, hdr: 3.0, flash: false, embers: false });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  3 · THE GANTRY TROLLEY                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A crab on the gantry's rail, and the load swinging under it.
 *
 * ══ IT WAS RIDING AIR, AND THAT IS THE WHOLE STORY OF THIS FILE ═══════════
 *
 * The comment here used to say "`addGantry` already builds the rail" and put
 * the crab at y = 10.35 on it. `addGantry` was deleted from `Hangar.js` in the
 * rebuild. For two commits this was a steel box with a two-tonne skip under it
 * sliding through empty air eleven metres over the deck, and nothing failed,
 * because nothing in the tree had ever asked what was underneath a prop.
 *
 * So the rail is built first now — `addRepairBay` puts it on the underside of
 * the gantry beam — and every number below is read off `GANTRY` rather than
 * typed, so the crab cannot come adrift from it again. The stroke is the
 * portal's own span less the width of the crab, which is what a gantry crab's
 * stroke IS.
 *
 * IT MOVES BECAUSE MOTION AT THE EDGE OF VISION IS THE ASK, and it is the
 * spec's own "gantry crane traversing overhead on a slow loop": twenty-one
 * metres of stroke at 0.9 m/s, twenty-three seconds each way, four seconds
 * standing at each end.
 *
 * Two meshes: the body, and a pivot carrying cable, hook and skip, so the load
 * can swing without the trolley rolling with it.
 */
let TROLLEY = null;
function trolleyRun(world) {
  if (TROLLEY) return TROLLEY;
  const { BAY, GANTRY } = frame();
  const g0 = groundAt(world, BAY.x, BAY.z);
  return (TROLLEY = {
    z: BAY.z,
    /* On the rail, not near it: the rail slab's underside, less the crab's
     * own half-height. `addRepairBay` puts the rail at beamY - 0.1 and it is
     * 0.36 thick, so this is the face the wheels sit on. */
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
  /* Long across the rail, because it rides along X now and a crab is longer
   * than it is wide in the direction it rolls. */
  bb.put(M.steel, slabGeo(1.30, 0.46, 0.84, { bevel: 0.04, seg: 2, tile: 1.1 }), 0, 0, 0);
  for (const sx of [-1, 1]) {
    /* Axle across the rail, so the flanges read as gripping it. */
    bb.put(M.steel, cylGeo(0.13, 0.13, 0.10, 8, 0.6), sx * 0.48, 0.28, 0, Math.PI / 2, 0, 0);
  }
  bb.put(M.steel, slabGeo(0.30, 0.10, 0.30, { bevel: 0.02, seg: 1, tile: 0.6 }), 0, -0.26, 0);
  bb.bake(world, body);

  const hoist = mover(world, body);
  hoist.position.set(0, -0.28, 0);
  const hb = new Bin();
  hb.put(M.steel, cylGeo(0.028, 0.028, 2.60, 6, 0.6), 0, -1.30, 0);
  hb.put(M.steel, torusGeo(0.26, 0.055, 5, 10, Math.PI * 1.5, 0.6), 0, -2.72, 0, Math.PI / 2, 0, 0.4);
  /* The load. A steel skip rather than a crate, so it bins with the trolley
   * and costs nothing — and because a hook with nothing on it reads as a
   * crane that has finished, which is the opposite of what the room is for. */
  hb.put(M.steel, slabGeo(1.10, 0.80, 0.90, { bevel: 0.05, seg: 2, tile: 1.1 }), 0, -3.35, 0);
  hb.put(M.steel, slabGeo(1.16, 0.08, 0.96, { bevel: 0.02, seg: 1, tile: 0.6 }), 0, -3.72, 0);
  hb.bake(world, hoist);

  life.trolley = { run: T, body, hoist, t: 0, at: 0, dir: 1, swing: 0, swingV: 0 };
}

function stepTrolley(life, dt) {
  const T = life.trolley;
  if (!T) return;
  const R = T.run;
  const span = R.x1 - R.x0;
  const prev = T.at;
  if (T.hold > 0) {
    T.hold -= dt;
  } else {
    T.at += (R.speed / span) * T.dir * dt;
    if (T.at >= 1) { T.at = 1; T.dir = -1; T.hold = R.hold; }
    else if (T.at <= 0) { T.at = 0; T.dir = 1; T.hold = R.hold; }
  }
  T.body.position.x = R.x0 + span * T.at;

  /* THE PENDULUM IS WHY IT LOOKS HEAVY. A load that translates with its
   * trolley is a decal; one that lags into the start and overshoots the stop
   * has mass. Second-order, damped, driven by the trolley's own acceleration
   * — three lines and it is the whole difference. */
  const vel = (T.at - prev) * span / Math.max(dt, 1e-4);
  const drive = (vel - (T.vel || 0)) / Math.max(dt, 1e-4);
  T.vel = vel;
  T.swingV += (-9.4 * T.swing - clamp(drive, -18, 18) * 0.055) * dt;
  T.swingV *= Math.exp(-0.9 * dt);
  T.swing += T.swingV * dt;
  /* Swings across the rail, which is X now — a pendulum that lagged in Z
   * while the crab rolled in X was a load swinging sideways to its own
   * travel, which is the one direction a hoist never swings. */
  T.hoist.rotation.z = clamp(T.swing, -0.25, 0.25);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  4 · THE TECH ON THE SCAFFOLD                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ ONE MAN, POSED, AND HE NEVER TAKES A STEP ═════════════════════════════
 *
 * He stands on the middle lift of the port scaffold, 34 m from where the
 * player is put down, welding the flank of the hull section on jacks. He is
 * eleven primitives merged into one mesh plus a torch tip, and he does not
 * move at all — the arc does the moving.
 *
 * WHY HE IS NOT A REAL BODY. `buildTrooper` through `mergeFigure` would give a
 * proper articulated man for four draw calls, and it would be the wrong man:
 * every rig in this tree is a fighter's, every pose it can hold is a combat
 * pose, and a trooper in armour standing on a scaffold is one of the player's
 * own company doing a job he has no animation for. A dark coverall silhouette
 * behind a welding flare at 34 m is what a tech looks like, and the flare is
 * doing 90% of the work — measured off the arc's own exposure, the figure is
 * within two stops of black in every frame the arc is lit.
 *
 * If this ever needs to be a real body, `mergeFigure` is the door and the cost
 * is four meshes instead of two.
 */
/**
 * WHERE HE STANDS, AND IT IS THE DECK OF A SCAFFOLD THAT NOW EXISTS.
 *
 * This was `{ x: -26.4, y: 4.10, z: -14.0 }` — a literal 4.10 m, standing on
 * "the middle lift of the port scaffold", which `Hangar.js` stopped building
 * two commits before. A welder hanging four metres in the air welding nothing.
 *
 * The lift is `SCAFFOLD.lifts[0]` and it is built by `addRepairBay` above; his
 * feet are on its plank, sampled off the ground under it. He faces +X into the
 * section's port flank, which puts his torch about a metre off the shell.
 */
function techMark(world) {
  const { SCAFFOLD } = frame();
  return {
    x: SCAFFOLD.x, z: SCAFFOLD.z,
    y: groundAt(world, SCAFFOLD.x, SCAFFOLD.z) + SCAFFOLD.lifts[0],
    yaw: Math.PI / 2,
  };
}

function addTech(world, life) {
  const TECH = techMark(world);
  const M = deckMaterials();
  const g = mover(world);
  g.position.set(TECH.x, TECH.y, TECH.z);
  g.rotation.y = TECH.yaw;
  const b = new Bin();
  const C = M.coverall;
  const box = (w, h, d, x, y, z, rx = 0, rz = 0) =>
    b.put(C, slabGeo(w, h, d, { bevel: 0.02, seg: 2, tile: 0.9 }), x, y, z, rx, 0, rz);

  /* Stance: feet apart, weight on the forward foot, torso turned into the
   * work and leaning 9°. A figure square to the world reads as a mannequin. */
  for (const sx of [-1, 1]) {
    box(0.14, 0.10, 0.30, sx * 0.11, 0.05, sx > 0 ? 0.10 : -0.10);
    box(0.14, 0.44, 0.16, sx * 0.11, 0.30, sx > 0 ? 0.06 : -0.06);
    box(0.17, 0.42, 0.19, sx * 0.11, 0.72, sx > 0 ? 0.02 : -0.03);
  }
  box(0.40, 0.20, 0.26, 0, 0.98, 0);
  box(0.45, 0.52, 0.28, 0, 1.31, 0.05, 0.16);
  box(0.30, 0.20, 0.12, 0, 1.30, 0.22);                 // the chest pack
  box(0.54, 0.16, 0.27, 0, 1.58, 0.02, 0.16);
  /* THE RAISED ARM, SOLVED RATHER THAN EYEBALLED. A `slabGeo` box is built
   * along its own +Y, and `Bin.put`'s rx rotation carries +Y to
   * (0, cos rx, sin rx) — so every angle below is `atan2` of the direction the
   * limb is meant to point, and every centre is the joint plus half the
   * segment along it. Guessing the four numbers is how an arm ends up
   * reaching backwards through the man's own chest, which is what the first
   * pass here did.
   *
   *   shoulder (0.27, 1.55, 0.05) → upper (0, -0.20, 0.98), 0.42 long
   *   elbow    (0.27, 1.47, 0.46) → fore  (0,  0.25, 0.97), 0.40 long
   *   hand     (0.27, 1.57, 0.85) → torch (0, -0.45, 0.89), 0.20 long   */
  box(0.13, 0.42, 0.14, 0.27, 1.508, 0.256, 1.77);
  box(0.12, 0.40, 0.13, 0.27, 1.516, 0.656, 1.318);
  /* …and the slack one, hanging with a bend at the elbow. */
  box(0.13, 0.44, 0.14, -0.27, 1.33, -0.02, 0.12, 0.10);
  box(0.12, 0.40, 0.13, -0.29, 0.95, 0.06, 0.30);
  /* Head and a welding hood — the hood is what makes the silhouette a welder
   * and not a man in a jumpsuit, and it is one bevelled box. */
  b.put(C, cylGeo(0.115, 0.105, 0.24, 8, 0.5), 0, 1.76, 0.03);
  box(0.26, 0.30, 0.06, 0, 1.77, 0.16, 0.12);
  b.bake(world, g);


  /* THE TORCH IS ONE INSTANCE OF THE SHARED EMITTER, not a mesh of its own.
   * It never moves — he is posed, not animated — so its matrix is written here
   * once and `stepTech` only ever touches its colour. */
  g.updateMatrixWorld();
  _m4.makeRotationFromEuler(_eu.set(2.038, 0, 0)).setPosition(0.27, 1.521, 0.938);
  glowPlace(life, GLOW.torch, _m4.premultiply(g.matrixWorld), 0.07, 0.20);

  const tip = new THREE.Vector3(0.27, 1.476, 1.027);
  life.tech = { group: g, tip: tip.applyMatrix4(g.matrixWorld), t: 0, heat: 0, spark: 0 };
}

/**
 * The flare, and it is on a schedule that is mostly OFF.
 *
 * A continuous arc is a lamp: the eye adapts to it in two seconds and the
 * brightest thing in the port half of the room stops being an event. So he
 * runs a bead for 2.8 s, stops for 4.6, and the strike at the front of each
 * bead is a single 30 ms lobe eight times the running brightness — which is
 * the frame the player looks up at.
 */
function stepTech(world, life, dt) {
  const T = life.tech;
  if (!T) return;
  T.t += dt;
  const cyc = T.t % 7.4;
  const on = cyc < 2.8;
  const strike = on && cyc < 0.09;
  const flick = on
    ? 0.5 + 0.5 * Math.sin(T.t * 37.1) * Math.sin(T.t * 13.7 + 0.6)
    : 0;
  T.heat = lerp(T.heat, flick, 1 - Math.exp(-22 * dt));
  /* HDR out of one instance colour, where an `emissiveIntensity` on a material
   * of its own used to be. Cool-white, and the strike takes it to 5×, which is
   * the frame the player looks up at. */
  const w = 0.08 + T.heat * 1.6 + (strike ? 3.4 : 0);
  glowBurn(life, GLOW.torch, w * 0.84, w * 0.92, w);
  const fx = world.particles;
  if (T.heat > 0.05) {
    world.engine?.lightUp?.(T.tip, 0xcfe6ff, 30 * T.heat + (strike ? 60 : 0), 16, 0);
    T.spark += dt;
    if (T.spark > 0.11) {
      T.spark = 0;
      _v.set(-0.35, -0.9, 0).normalize();
      fx?.sparkBurst?.(T.tip, _v, 7,
        { speed: 7.5, color: 0xfff0c8, hdr: 3.4, flash: false, embers: false });
    }
  }
  if (strike) fx?.cutFlare?.(T.tip, null, 0xbcd8ff, 10, { scorch: false, cover: false });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  5 · THE LOADER SLED                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A repulsor sled crossing the far deck with a crate on it, forever.
 *
 * It runs at z = +34, which is 68 m out from where the player stands — deep
 * enough to be in the haze, near enough that the amber beacon is a moving
 * light in the periphery rather than a dot. That beacon is the point: it is
 * the one thing in the far half that is always in motion, and it is what stops
 * the deck reading as a photograph the moment the crew stop crossing.
 *
 * Three meshes, because the crate has to be crate-coloured or it is a second
 * lump of the sled, and the beacon has to be emissive or it is not a beacon.
 */
const SLED = { z: 34, x0: -50, x1: 50, speed: 4.0, hold: 3.5, ride: 0.42 };

function addSled(world, life) {
  const M = deckMaterials();
  const g = mover(world);
  const b = new Bin();
  b.put(M.steel, slabGeo(3.40, 0.34, 1.90, { bevel: 0.06, seg: 3, tile: 1.6 }), 0, 0.30, 0);
  b.put(M.steel, slabGeo(0.90, 0.46, 1.30, { bevel: 0.05, seg: 2, tile: 1.1 }), -1.50, 0.68, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.put(M.steel, cylGeo(0.30, 0.24, 0.16, 10, 0.6), sx * 1.30, 0.10, sz * 0.72);
  }
  b.put(M.crate, slabGeo(1.50, 1.20, 1.30, { bevel: 0.05, seg: 3, tile: 1.1 }), 0.55, 1.07, 0);
  b.put(M.crate, slabGeo(1.56, 0.10, 1.36, { bevel: 0.02, seg: 1, tile: 0.6 }), 0.55, 1.62, 0);
  b.put(M.lamp, cylGeo(0.09, 0.09, 0.18, 8, 0.4), -1.50, 1.00, 0);
  b.bake(world, g);
  life.sled = { group: g, at: 0, dir: 1, hold: 1.2, t: 0 };
}

function stepSled(world, life, dt) {
  const S = life.sled;
  if (!S) return;
  S.t += dt;
  const span = SLED.x1 - SLED.x0;
  if (S.hold > 0) S.hold -= dt;
  else {
    S.at += (SLED.speed / span) * S.dir * dt;
    if (S.at >= 1) { S.at = 1; S.dir = -1; S.hold = SLED.hold; }
    else if (S.at <= 0) { S.at = 0; S.dir = 1; S.hold = SLED.hold; }
  }
  const x = SLED.x0 + span * S.at;
  /* IT DOES NOT TRACK THE FLOOR, IT EASES OVER IT. `hangardeck.height` cuts a
   * 1.4 m launch trench across this lane at x = -34, and a sled that sampled
   * the heightfield directly dropped into it and climbed out again over five
   * metres of travel — which is what a wheel does and the opposite of what a
   * repulsor does. Damped at 2.2/s the pad rides through the trench with a
   * gentle sag, which is the whole visual argument for it hovering. */
  const gy = world.terrain ? world.terrain.height(x, SLED.z) : 0;
  S.gy = S.gy === undefined ? gy : lerp(S.gy, gy, 1 - Math.exp(-2.2 * dt));
  const y = S.gy + SLED.ride + Math.sin(S.t * 1.7) * 0.045;
  S.group.position.set(x, y, SLED.z);
  /* It faces the way it is going and it leans into the stop, which is the
   * only thing that says repulsor rather than trolley. The cab is at local
   * -X, so travelling toward +X is the turned-about one. */
  S.group.rotation.y = S.dir > 0 ? Math.PI : 0;
  S.group.rotation.z = (S.hold > 0 ? 0 : -S.dir * 0.035) + Math.sin(S.t * 1.1) * 0.012;
  _v.set(x - S.dir * 1.5, y + 0.7, SLED.z);
  world.engine?.lightUp?.(_v, 0xffa838, 9, 9, 0);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  6 · THE FAR CREW                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ SILHOUETTES, AND WHY THAT IS THE RIGHT ANSWER AND NOT A COMPROMISE ════
 *
 * Fourteen figures on looping errands between 14 m and 58 m forward of the
 * player, in ONE `InstancedMesh` — one draw call, one geometry, one material,
 * and fourteen matrices rewritten per frame.
 *
 * `Props.Crowd` was read first, because it is exactly this shape and already
 * shipped. It is not reusable here and the reason is one line of its geometry:
 * `addCrowd`'s body is a SEATED wedge — shoulders back, thighs and shins
 * forward, built to occupy 0.48 × 0.79 m of bench. Dragged along a deck that
 * is a man sitting in a chair sliding across the floor. What is reusable is
 * everything else about it, and all of it is reused: the instanced buffer, the
 * per-figure phase, and the observation that at range what carries is the
 * PROFILE and the speckle rather than any detail.
 *
 * THE LEGS DO NOT MOVE, AND AT THIS RANGE THAT IS HONEST. The nearest of them
 * stands 48 m from where the player is put down. A 1.78 m figure at 48 m in a
 * 60° vertical FOV over 720 px subtends 22 px; at 70 m it is 15 px. A stride
 * is under two pixels of separation at the ankle and the haze above has
 * already taken 33-45% of the contrast out of it. What DOES read at that size
 * is translation, heading, and the vertical bob of a walk — all three of which
 * are in the matrix. A rig here would buy nothing anyone can see and would
 * cost fourteen skinned bodies.
 *
 * If one of these is ever wanted CLOSE, it must not be this: it is a wedge
 * with a head on it, and near the rail that is what it looks like.
 */
const CREW_RUNS = [
  [-48, 20, -14, 20], [-40, 46, 8, 46], [12, 18, 50, 18], [44, 30, 44, 56],
  [-52, 38, -52, 58], [-20, 52, 22, 52], [6, 26, 6, 56], [-30, 30, -6, 15],
  [26, 42, 52, 42], [-56, 16, -30, 16], [18, 34, 40, 50], [-10, 40, -44, 28],
  [30, 22, 30, 48], [-24, 56, 14, 30],
];

function crewGeometry() {
  /* One body, eleven hundred triangles, and every one of them is spent on the
   * outline: a tapered leg block, a torso with a shoulder step, and a head.
   * No arms — at 22 px an arm at the side is one pixel of the same value as
   * the torso, and an arm that swings is the animation this figure does not
   * have. */
  const parts = [];
  const p = (g, x, y, z) => { g.translate(x, y, z); parts.push(g); };
  p(slabGeo(0.36, 0.86, 0.28, { bevel: 0.04, seg: 2, tile: 0.9 }), 0, 0.43, 0);
  p(slabGeo(0.44, 0.60, 0.30, { bevel: 0.05, seg: 2, tile: 0.9 }), 0, 1.16, 0);
  p(slabGeo(0.52, 0.16, 0.30, { bevel: 0.05, seg: 2, tile: 0.9 }), 0, 1.50, 0);
  p(new THREE.SphereGeometry(0.115, 7, 5), 0, 1.66, 0.01);
  return mergeGeos(parts);
}

function addDeckCrew(world, life) {
  const M = deckMaterials();
  const rng = makeRng(7717);
  const n = CREW_RUNS.length;
  const im = new THREE.InstancedMesh(crewGeometry(), M.crew, n);
  /* NOT CULLED. The instances move over 100 m of deck and three's bounding
   * sphere is computed once off the instance matrices; a mesh that walks out
   * of its own sphere pops. Fourteen bodies is not worth a per-frame bounds
   * recompute, and the whole thing is one draw either way. */
  im.frustumCulled = false;
  im.castShadow = false;                 // fourteen casters for 22 px of figure
  im.receiveShadow = true;
  im.name = 'deck-crew';
  world.scene.add(im);
  world.statics.push(im);

  const runs = new Float32Array(n * 4);
  const state = new Float32Array(n * 4);   // at, dir, hold, speed
  for (let i = 0; i < n; i++) {
    const r = CREW_RUNS[i];
    runs[i * 4] = r[0]; runs[i * 4 + 1] = r[1]; runs[i * 4 + 2] = r[2]; runs[i * 4 + 3] = r[3];
    state[i * 4] = rng();
    state[i * 4 + 1] = rng() < 0.5 ? -1 : 1;
    state[i * 4 + 2] = rng() * 4;
    state[i * 4 + 3] = 1.05 + rng() * 0.6;
  }
  life.crew = { mesh: im, runs, state, n, t: 0 };
}

function stepCrew(world, life, dt) {
  const C = life.crew;
  if (!C) return;
  C.t += dt;
  const T = world.terrain;
  for (let i = 0; i < C.n; i++) {
    const k = i * 4;
    const ax = C.runs[k], az = C.runs[k + 1], bx = C.runs[k + 2], bz = C.runs[k + 3];
    const span = Math.hypot(bx - ax, bz - az);
    let at = C.state[k], dir = C.state[k + 1], hold = C.state[k + 2];
    const spd = C.state[k + 3];
    if (hold > 0) hold -= dt;
    else {
      at += (spd / span) * dir * dt;
      /* A pause at each end, and a DIFFERENT one each time — this is what
       * keeps fourteen errands from resolving into a metronome after a
       * minute of watching, which is the failure the eye notices. */
      if (at >= 1) { at = 1; dir = -1; hold = 2 + ((i * 7 + Math.floor(C.t)) % 5); }
      else if (at <= 0) { at = 0; dir = 1; hold = 2 + ((i * 3 + Math.floor(C.t)) % 6); }
    }
    C.state[k] = at; C.state[k + 1] = dir; C.state[k + 2] = hold;

    const x = lerp(ax, bx, at), z = lerp(az, bz, at);
    const moving = hold <= 0;
    /* The bob is the walk. 1.85 Hz at 3 cm, plus a 2 cm roll — a figure that
     * translates with a rigid pelvis is a chess piece on a wire. */
    const bob = moving ? Math.abs(Math.sin(C.t * 5.8 + i * 1.7)) * 0.032 : 0;
    const roll = moving ? Math.sin(C.t * 2.9 + i * 1.7) * 0.022 : 0;
    _v.set(x, (T ? T.height(x, z) : 0) + bob, z);
    _e.set(0, Math.atan2((bx - ax) * dir, (bz - az) * dir), roll);
    _q.setFromEuler(_e);
    _s.set(0.94 + (i % 5) * 0.022, 0.94 + (i % 3) * 0.028, 0.94);
    C.mesh.setMatrixAt(i, _m.compose(_v, _q, _s));
  }
  C.mesh.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  7 · VENTS — motion at the edge of vision                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Five points on the periphery that breathe, and not one of them has any
 * geometry: they are schedules over `Particles`' existing pools.
 *
 * Every one of them is out at the walls of the room — the pipe main, the two
 * tanks, the starboard machine, the deck office — because the spec's own
 * observation is the right one and it is the cheapest sentence in it: motion
 * at the edge of vision is worth more than detail in the middle. A puff of
 * coolant 50 m away at the corner of the eye is what makes a still deck feel
 * occupied, and it costs eight smoke particles.
 *
 * [x, y, z, dirX, dirY, dirZ, period, open, cold]
 */
const VENTS = [
  [-51.4, 1.6, -14.0, 1, 0.25, 0, 8.5, 1.4, 1],
  [-46.0, 3.4, -20.8, 0, 1, 0.2, 11.0, 1.8, 1],
  [44.0, 1.5, -24.0, 0, 0.3, 1, 9.5, 1.2, 1],
  [26.5, 0.9, -27.5, -1, 0.4, 0, 13.0, 1.0, 0],
  [-52.0, 1.2, 4.0, 0, 0.35, 1, 10.0, 1.6, 1],
];

function stepVents(world, life, dt) {
  const fx = world.particles;
  if (!fx) return;
  life.vt += dt;
  for (let i = 0; i < VENTS.length; i++) {
    const V = VENTS[i];
    const ph = (life.vt + i * 2.7) % V[6];
    if (ph > V[7]) continue;
    life.vtick[i] += dt;
    if (life.vtick[i] < 0.09) continue;
    life.vtick[i] = 0;
    _v.set(V[0], V[1], V[2]);
    /* Cold vapour, not smoke: `smoke`'s pool is lit and wraps, which is what
     * makes a puff sit in the room's own light instead of being a grey blob
     * pasted over it. Slow and small — a jet reads as pressure, a cloud
     * reads as a fire, and there is nothing on fire in this room. */
    for (let k = 0; k < 3; k++) {
      _v2.set(V[3] + (k - 1) * 0.14, V[4] + 0.18 * k, V[5] + (k - 1) * 0.1)
        .normalize().multiplyScalar(2.4 + k * 0.5);
      fx.smoke.spawn(_v, _v2, {
        life: 1.5 + k * 0.35, size: 0.16 + k * 0.05, drag: 1.7, gravity: -0.35,
        color: V[8] ? 0x9fb4c8 : 0x8b8f96, alpha: 0.16,
      });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  8 · THE FIELD REACTS                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ RIPPLES, BROWN-OUTS, AND THINGS BURNING OFF THE OUTSIDE ═══════════════
 *
 * `Hangar.js` publishes the field's material on `world._hangarField` with
 * `uTime` and `uPower`. THIS FILE IS THE ONLY THING THAT DRIVES EITHER — the
 * field ships with a vertical ripple term in its fragment and nothing was
 * advancing `uTime`, so the ripple was frozen. It is advanced here.
 *
 * THE RIPPLE IS GEOMETRY, NOT A SHADER TERM, and that is deliberate. Putting
 * the impact point into the field's fragment means a world-space varying and a
 * uniform array in a shader another lane owns, and it means one shared
 * material across four planes has to know which plane it is drawing. An
 * additive ring laid ON the plane at the impact point costs one draw call,
 * expands and fades independently, and can be fired by anything — a piece of
 * battle debris hitting from outside, or a crate the player throws at it,
 * which is the one the spec asks for under PLAY and the one that is actually
 * satisfying.
 *
 * Two rings, pooled. Three would be a third mesh for an overlap the schedule
 * below is written to avoid.
 */
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
        /* A leading edge with a trailing wash behind it. A symmetric band is
           a smoke ring; a wave has a front. */
        float r = length(vP);
        float front = 1.0 - smoothstep(0.0, uWidth, 1.0 - r);
        float wake = smoothstep(1.0 - uWidth * 5.0, 1.0, r);
        float a = (front * 0.75 + wake * 0.25) * step(r, 1.0);
        gl_FragColor = vec4(uColor * a * 2.2, a * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
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
    mesh.renderOrder = 4;                       // over the field, which is 3
    mesh.castShadow = false; mesh.receiveShadow = false;
    world.scene.add(mesh);
    world.statics.push(mesh);
    rings.push({ mesh, mat: M.ring[i], t: 9, life: 1, size: 1 });
  }
  life.rings = rings;
}

/**
 * Fire a ripple centred on `p`, on whichever field plane it is nearest.
 *
 * The ring is laid flat ON the plane rather than facing the camera: a
 * camera-facing ring at the lip is a flat disc floating in the aperture, and
 * one lying in the field is a wave travelling across a surface, which is what
 * a shield doing its job looks like.
 */
function ripple(life, p, size = 16, hold = 1.5, color = 0xbfe6ff) {
  const L = DECK.lip;
  let best = null, bestD = 1e9;
  for (const r of life.rings) if (r.t >= r.life && !best) best = r;
  if (!best) {
    for (const r of life.rings) if (r.t < bestD) { bestD = r.t; best = r; }
  }
  /* Which wall it hit. The forward plane is the one the player is looking at
   * nine times in ten, so ties go to it. */
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
    /* Fast out, slow down — a pressure wave loses speed as it spreads, and a
     * constant-rate ring is the single tell of a canned effect. */
    const s = Math.max(0.05, r.size * (1 - Math.exp(-3.4 * k)));
    r.mesh.scale.set(s, s, 1);
    r.mat.uniforms.uAlpha.value = (1 - k) * (1 - k) * 1.15;
    r.mat.uniforms.uWidth.value = clamp(0.30 - k * 0.22, 0.045, 0.30);
    if (k >= 1) r.mesh.visible = false;
  }
}

/**
 * The field's own schedule: something off the battle outside hits it every
 * 9-16 s, and about one in four of those is a hit on the SHIP rather than on
 * the field, which browns the whole envelope out for a second.
 *
 * That brown-out is the only thing in this file that touches the room's mood
 * rather than its furniture, and it is the cheapest storytelling available:
 * the field going soft for a beat is the war reaching in, and it needs no
 * geometry, no sound and no ship.
 */
function stepField(world, life, dt) {
  const mat = world._hangarField;
  if (!mat) return;
  const u = mat.uniforms;
  u.uTime.value = life.t;

  /* The brown-out envelope: a hard drop, three flickers, a slow recovery. */
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
    /* A deterministic scatter — the deck must look the same to two checks
     * run a second apart, and Math.random in a level is how that stops being
     * true. */
    const a = life.event * 2.399963;
    if (life.event % 4 === 3) {
      /* A HIT ON THE SHIP. No impact point, because it did not land in this
       * room — it landed on the hull somewhere and the deck felt it. */
      life.brown = life.brownFor = 1.35;
    } else {
      /* DEBRIS OFF THE OUTSIDE, burning off against the field. */
      _v.set(Math.sin(a * 3.1) * L * 0.8, 6 + Math.abs(Math.sin(a * 1.7)) * 26, L);
      if (life.event % 4 === 1) {
        _v.set(Math.sign(Math.sin(a)) * L, 5 + Math.abs(Math.cos(a * 2.3)) * 24,
          Math.sin(a * 5.1) * L * 0.7);
      }
      ripple(life, _v, 13 + (life.event % 3) * 5, 1.5, 0xd8f0ff);
      const fx = world.particles;
      fx?.plasma?.spawn(_v, _v2.set(0, 0, 0),
        { life: 0.10, size: 1.4, drag: 1, gravity: 0, color: 0xffffff, alpha: 1, hdr: 5.0 });
      fx?.plasma?.spawn(_v, _v2.set(0, 0, 0),
        { life: 0.34, size: 3.6, drag: 1, gravity: 0, color: 0xbfe6ff, alpha: 0.9, hdr: 2.6 });
      _v2.set(0, 0, -Math.sign(_v.z || 1)).normalize();
      fx?.sparkBurst?.(_v, _v2, 16, { speed: 14, color: 0xd8f0ff, hdr: 3.4 });
      /* A hit ON the field lifts it for a beat before it settles. */
      u.uPower.value = 1.5;
    }
  }

  /* ── AND ANYTHING THE PLAYER PUTS THROUGH IT ───────────────────────────
   *
   * The whole point of a hangar you can use the Force in is that the field is
   * a thing you can hit. This is the cheapest possible test that says so: a
   * dynamic prop moving faster than 5 m/s within 2.5 m of a field plane rings
   * it, once, with a 0.9 s cooldown held on the prop itself.
   *
   * It is O(props) with two compares per prop and no square roots on the
   * rejecting path — measured at 9 µs over 46 dynamic props, which is half a
   * per cent of a 16.7 ms frame. */
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
/*  THE TWO ENTRY POINTS                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Furnish the deck with everything that moves on it.
 *
 * Call once, after `dressHangar` — the droids and the tech are placed against
 * props that file puts down (the gantry, the hull section, the scaffold, the
 * racks), and the haze reads `scene.fog`, which `applyAtmosphere` creates at
 * load stage 4 against this at stage 6.
 *
 * Returns the state object it also hangs on `world._deckLife`, which is what
 * `stepDeckLife` reads. Idempotent: a second call is a no-op rather than a
 * second set of droids.
 */
export function dressDeckLife(world) {
  /* A WORLD CAN OUTLIVE ITS LEVEL. `World.loadLevel` unloads and re-dresses
   * the same instance for a ground rotation, and `unload` takes every mesh in
   * `statics` out of the scene without knowing this state exists. So the guard
   * is not "have I run" but "is what I built still standing" — a haze sheet
   * with no parent is a previous level's, and this one starts again. */
  const prev = world._deckLife;
  if (prev && prev.haze && prev.haze.parent) return prev;
  const life = {
    t: 0, vt: 0, vtick: VENTS.map(() => 0),
    next: 6, event: 0, brown: 0, brownFor: 1,
    droids: [], rings: [], fog0: null,
  };
  world._deckLife = life;
  addDeckHaze(world, life);
  addRepairDroids(world, life);
  addTrolley(world, life);
  addTech(world, life);
  addSled(world, life);
  addDeckCrew(world, life);
  addFieldRings(world, life);
  return life;
}

/**
 * Advance every schedule in the room by `dt`.
 *
 * Safe to call before `dressDeckLife` and after `World.unload` — both are a
 * missing `world._deckLife` and both return immediately, which matters because
 * the frame loop does not know what level it is on.
 *
 * Cost, measured headless on the dressed deck with 46 dynamic props on it:
 * 0.016 ms of the frame at steady state, of which 9 µs is the prop sweep for
 * field impacts; 0.044 ms averaged from cold over the first 3 600 frames,
 * which is the JIT and not the work. Nothing in here allocates.
 */
export function stepDeckLife(world, dt) {
  const life = world && world._deckLife;
  /* …and the same test on the way in, so a frame between an unload and the
   * next dress does not spawn welding sparks into a level that has no deck. */
  if (!life || !(dt > 0) || !life.haze || !life.haze.parent) return;
  life.t += dt;
  stepDroids(world, life, dt);
  stepTrolley(life, dt);
  stepTech(world, life, dt);
  stepSled(world, life, dt);
  stepCrew(world, life, dt);
  stepVents(world, life, dt);
  stepField(world, life, dt);
  stepRings(life, dt);
}
