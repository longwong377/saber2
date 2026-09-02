/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FLIGHT DECK — where the company stands, and where the war is visible
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── READ `Levels.js`'s DELETION NOTE BEFORE CHANGING ANYTHING IN THIS FILE ──
 *
 * Six interior levels have been built here and deleted, on the same
 * instruction, three separate times. Hangar Bay Nine, the Invisible Hand, the
 * Boarding Bay, the Temple Halls, the Intake, the Cut. The reason is written
 * down and it is not a budget:
 *
 *   "your outdoor maps look good because they're immersive and have a feeling
 *    of place, whereas your interior maps remind you that this is an AI game"
 *   "I just tried the boarding bay and the providence and hated them, you
 *    completely missed the ball so just remove them."
 *   "a roof plus four walls at the draw budget this engine has is a box, and a
 *    box is the one shape that cannot be anywhere."
 *
 * Hangar Bay Nine measured **395 draw calls for an empty room** — 76% of the
 * whole dressing bound — and still read as a box, because the problem was
 * never the number of things in it.
 *
 * ── SO THIS IS NOT THAT ROOM, AND THE DIFFERENCE IS WHAT THE WALLS ARE ────
 *
 * The first two versions of this deck answered the box with ABSENCE: one wall
 * behind you, field on three sides, no ceiling ever, a deck that ran out
 * under your feet. The player walked round the ends of the rack walls onto
 * an apron with vacuum on three sides and called it "a janky mess on the
 * edges", watched ships fly through the side walls, and asked, in as many
 * words, for a solid ceiling higher than the walls and for the room to be
 * wider. That instruction overrides the old rule, and this header says so
 * because `HANGAR-SPEC.md` and three checks used to state the opposite.
 *
 * THE ROOM IS BOUNDED ON SIX SIDES BY THINGS YOU CAN SEE. Two rack walls run
 * the full length from the bulkhead to the aperture; a ceiling closes the top
 * twenty metres above the walls' bays; the bulkhead with the lift is behind
 * you; the deck is under you; and forward there is one opening — a wide
 * rounded rectangle with a thick white rim, `hangar 1`'s and `5`'s — with
 * the planet and the battle in it. That is the shape of the references.
 *
 * WHAT KEEPS IT FROM BEING A BOX IS DENSITY, NOT ABSENCE. The ceiling is a
 * structure — girders, beams, catenary cables, crane rails, hung fighters,
 * ducting, a lit strip grid, hanging fixtures — with the plate behind all of
 * it and under pale haze. The walls are fifty-four pale slabs with a strip
 * light each, a gallery, booths and doors (`hangar 1`, `3`, `6`). The deck has
 * a company, a crowd, droids, workers, a real transport, repairs, traffic in
 * and out of the opening. A box is four walls and nothing in it; a hangar is
 * the same walls with a war's worth of hardware between them.
 *
 * THE VIEW IS STILL THE ROOM. The planet is FORWARD now, in the opening,
 * where the player is facing when the lift doors part — it spent its first
 * weeks 167° behind him over the bulkhead, because the sky placed it by phase
 * and never by azimuth. See `SkyDome.configureOrbit`'s `forward`.
 *
 * ── WHAT IT IS FOR ────────────────────────────────────────────────────────
 *
 * The company already exists — named men, ranks, wounds, squads, kit and paint,
 * all persisted, all customisable from the Company tab. This is the same data
 * with a place to stand in. You give an order, your men file in and form up,
 * and you walk down the line. Everything you can do here you can do in the
 * menu; the menu is faster and this is the one that means something.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { buildFigure, paradeMan, poseParade, salute, stagger, STANCES } from './Parade.js';
import { mergeFigure } from './MergedSkin.js';
import { loadAll as companyLoadAll, load as companyLoad } from './Company.js';
import { lineup } from './Muster.js';
import { BipedAnimator } from './Rig.js';
import { attachTrooperCape } from './Cloth.js';
import { dressDeckAudio, stepDeckAudio, undressDeckAudio, bootHalt,
  drainBlasts, bootStride, deckChant } from './DeckAudio.js';
import { dressDeckLife, stepDeckLife } from './DeckLife.js';
import { dressDeckLift, stepDeckLift, undressDeckLift } from './DeckLift.js';
import { dressDeckMirror, stepDeckMirror, undressDeckMirror } from './DeckMirror.js';
import { dressDeckFlight, stepDeckFlight, undressDeckFlight, embarkCompany, hullFloorAt } from './DeckFlight.js';
import { stepDeckEdit } from './DeckEdit.js';
import { squadPlan, leadOf, SQUAD, ORDER_REACH, armyToLead, musterPlan, OPENING_STRENGTH, ARMIES, MARKS } from './Command.js';
import { TERRAIN_PRESETS } from '../world/Terrain.js';
/**
 * ONE PROP FROM THE OUTDOOR LIBRARY, AND IT IS THE ONE THE PLAYER THROWS.
 *
 * Everything else in this room comes from `DeckKit.js`. The first dressing was
 * built out of `Props.js` on the strength of a survey saying it "has every
 * part" — it does, for a BATTLEFIELD: `addWall` paints in bombed masonry,
 * `addLamp` is a street lamp on a pole, and `addScaffold`, `addTank` and
 * `addCrateStack` are a ruined settlement's furniture. Put on a flat plain they
 * make exactly what they are, and the first frame of this room was a bombed
 * street with a shield over it.
 *
 * That is the same failure `Levels.js` records against all six interiors it has
 * deleted, and the lesson is not "use fewer props": A ROOM ON A SHIP NEEDS
 * SHIPBOARD PARTS, and there were none in the tree until `DeckKit.js`.
 *
 * `makeCrate` stays because `_grippableBody` needs a real dynamic PROP-layer
 * body to pick up, and a crate is a crate on a deck as much as in a village.
 */
import { makeCrate } from '../world/Props.js';
import { makeShovable } from '../physics/Shovable.js';
import { Paint, DeckBuild, DECK_PAINT, deckMats, overheadRig, parkedFighter,
  catwalk, crates, smear, shuttlePad, factionOf, insigniaPanel,
  wallStrip, pilaster, serviceDoor, controlBooth, cableRun } from './DeckKit.js';

/* The deck runs from the bulkhead aft to the lip forward. Named rather than
 * inlined because six things below have to agree about where the room stops,
 * and `hangardeck.height` is the seventh. */
/* The deck runs from the bulkhead aft to the lip forward. Named rather than
 * inlined because six things below have to agree about where the room stops,
 * and `hangardeck.height` is the seventh. */
export const DECK = {
  /**
   * ══ THE ROOM, AND WHY IT IS A ROOM NOW ═══════════════════════════════════
   *
   * The first two versions of this deck were built on one rule — one wall,
   * behind you, field on the other three sides and no ceiling ever — and the
   * player walked round the ends of the rack walls onto an apron with vacuum
   * on three sides and said exactly what that was:
   *
   *   "the hangar was too big outside of the side walls like you had decent
   *    looking side walls but you were able to go behind them and it's just a
   *    janky mess on the edges, also ships were going through the side walls,
   *    give the hangar a solid ceiling (but very high up even higher than the
   *    side walls you have now) … but the ceiling can't make the hangar look
   *    like a shitty box … I want you to make the hangar wider"
   *
   * So the rule changed, on the player's own instruction, and the header of
   * this file says so. The room is now what every one of the seven references
   * actually is: two walls that run the FULL length, a ceiling higher than
   * the walls' gallery, and ONE opening — forward, a rounded rectangle with
   * a white rim, with the planet in it. What keeps it from being a box is
   * not the absence of a lid; it is that the lid is a structure — beams,
   * cable runs, crane rails, hung fighters, ducting, light panels, fixtures —
   * and that the haze eats it before it can read as a plane.
   */
  /** Aft face of the bulkhead — the one solid surface behind the player. */
  aft: -104,
  /** The lip, forward: the heightfield's own edge, where the aperture stands. */
  lip: 144,
  /**
   * WHERE THE PLAYER IS PUT DOWN: INSIDE THE LIFT.
   *
   * He no longer appears on the deck. He arrives in a lift car set into the
   * bulkhead, rides it for a few seconds with the shaft streaming past the
   * windows, and walks out when the doors part — see `src/game/DeckLift.js`.
   * The car's floor is the deck, so the walk out is one continuous piece of
   * ground.
   */
  start: new THREE.Vector3(0, 0, -99.3),
  /**
   * WHERE HE FIRST STANDS ON OPEN DECK: just outside the lift doors. Every
   * distance the deck's life measures "in front of the player" is measured
   * from here rather than from the spawn, which is inside a car in a wall.
   */
  threshold: -88,
  /** Where the line forms up, facing him. */
  line: -48,
  /**
   * THE CEILING. 96 m: above the walls' 62 m of bays and their 78 m band of
   * upper structure, so a player looking up sees the walls END and then a
   * further twenty metres of beams and cables before the plate. That gap is
   * the whole of "higher than the side walls" and it is what stops the top of
   * the room reading as the top of a box.
   */
  roof: 96,
  /**
   * ══ WHERE THE RACK WALLS STAND, AND IT IS ONE NUMBER ═══════════════════
   *
   * 80, from 56: "I want you to make the hangar wider". The inboard mouth of
   * the racks is 7.5 m inside this (see `deckColliders`), so the working
   * deck is 145 m across between the fighters' noses — half again the old
   * canyon. Every other file reads this rather than a ratio of the lip.
   */
  wall: 80,
  /** Kept as an alias for one release: `bays` was the old, wrong spelling. */
  get bays() { return this.wall; },
  /**
   * ══ THE APERTURE IS A ROUNDED RECTANGLE ══════════════════════════════
   *
   * `hangar 1`, `2`, `4` and `5` — four of the seven, and the three the
   * player's own verdict named — cut the opening as a wide rounded rectangle
   * with a thick white rim round it; only the concept piece (`hangar 7`) is
   * a chamfered hexagon. The hexagon was built first and it read as a dim
   * frame; the rounded rectangle is the shape a hangar door is REMEMBERED
   * as, and its rim is the one continuous band the references are all lit
   * by. It stands in the same opening — x in ±wall, y from the deck to
   * `top` — with a fascia closing the band between `top` and the roof, so
   * the aperture is a window in a wall rather than the wall simply stopping.
   *
   *   top     the opening's top edge; the fascia runs from here to `roof`
   *   corner  the radius of the four corners
   *
   * Named because the rim, the field plane, the fascia, the emitter studs
   * and the barrier all trace the same outline (`aperturePoints`).
   */
  aperture: { top: 86, corner: 20 },
};

/**
 * ══ THE LIFT CAR, in the bulkhead's own thickness ═════════════════════════
 *
 * `DeckLift.js` builds and drives it; this is the shape, published beside
 * `DECK` so the bulkhead recess, the colliders, the spawn and the car cannot
 * disagree about where it is. The car's floor is the deck plate, its door is
 * on the deck side, and the shaft the windows look into is drawn INSIDE the
 * bulkhead mass, where nothing on the deck can see it.
 */
export const LIFT = {
  x: 0,
  /** The car's centre. Its front face (the doors) is at `door`. */
  z: -101.0,
  halfW: 3.0, halfD: 3.0, height: 4.2,
  get door() { return this.z + this.halfD; },
  /** The lobby recess in the bulkhead round the doors. */
  lobby: { w: 16, h: 8.4, depth: 2.6 },
};

/**
 * ══ WHERE YOU LEAVE FROM ══════════════════════════════════════════════════
 *
 * The transport on the near pad, and the patch of deck at the foot of its
 * ramp. The pad is where the REAL hull stands — `DeckFlight.js` parks the
 * army's own transport here with its ramp down and flies it out through the
 * aperture — and the trigger is derived from it so the two cannot drift.
 */
/**
 * ══ WHERE THINGS MAY AND MAY NOT STAND, IN ONE TABLE ══════════════════════
 *
 * Four files put things on this deck — the structure, the company and its
 * crowd, the deck's life, the flight director — and each used to keep its own
 * idea of where the others were. The pit kerbs were twenty metres from the
 * pit; the droids sat in the company's march corridor; the crew walked into
 * the hole. So the deck's ground is partitioned HERE, once, as axis-aligned
 * boxes in x/z, and every siting decision asks `inZone`/`clearOf` rather than
 * remembering a number.
 *
 *   lobby      the lift's apron; the player walks out through it
 *   corridor   from the lobby to the muster line, where the company marches
 *   muster     the line's own ground
 *   padA       the transport's pad, `DEPLOY_RAMP`, with its ramp apron
 *   padB       the second craft's pad, forward starboard
 *   pit        the recess, `PIT_KERBS`
 *   crowdL/R   where the crowd stands and where the company waits in it
 *   work       the repair bays' ground, port and starboard, mid-deck
 *   apron      the last third before the aperture, kept for traffic
 */
export const DECK_ZONES = {
  lobby: { x0: -11, x1: 11, z0: -104, z1: -86 },
  corridor: { x0: -8, x1: 8, z0: -104, z1: -34 },
  muster: { x0: -50, x1: 50, z0: -54, z1: -34 },
  padA: { x0: -49, x1: -11, z0: -6, z1: 34 },
  padB: { x0: 26, x1: 64, z0: 78, z1: 116 },
  pit: { x0: -71, x1: -33, z0: -20, z1: 32 },
  crowdL: { x0: -70, x1: -14, z0: -100, z1: -60 },
  crowdR: { x0: 14, x1: 70, z0: -100, z1: -60 },
  work: { x0: 30, x1: 72, z0: -30, z1: 60 },
  apron: { x0: -72, x1: 72, z0: 116, z1: 144 },
};

/** Is (x, z) inside the named zone? */
export function inZone(name, x, z) {
  const Z = DECK_ZONES[name];
  return !!Z && x >= Z.x0 && x <= Z.x1 && z >= Z.z0 && z <= Z.z1;
}

/** Is (x, z) clear of every zone named, by `pad` metres? */
export function clearOf(names, x, z, pad = 0) {
  for (const n of names) {
    const Z = DECK_ZONES[n];
    if (!Z) continue;
    if (x >= Z.x0 - pad && x <= Z.x1 + pad && z >= Z.z0 - pad && z <= Z.z1 + pad) return false;
  }
  return true;
}

export const DEPLOY_RAMP = {
  x: -30,
  padZ: 14,
  /** The hull's heading: nose to the aperture, ramp facing the line. */
  yaw: Math.PI,
  /* The ramp's foot is behind the hull. `Vehicles` puts the bay's back about
   * 3.3 m aft of the hull's centre and the leaf 2.4 m past that. */
  get z() { return this.padZ - 6.0; },
  reach: 4.2,
  /* How long you have to stand on it. A trigger that fires the instant you
   * cross it takes the run away from a player who was walking past. */
  hold: 1.1,
};
const P_RAMP = { stencil: 0xb9bec6 };

/**
 * THE FIELD. One material, one plane, and it is the only thing between the
 * deck and vacuum — which is also the only thing keeping the player on the
 * deck, because there is no railing and the terrain simply ends.
 *
 * `buildShieldBubble`'s material verbatim (`Bodies.js:7507`): already cel-
 * banded per REFERENCE.md rule 1, already additive, already `saberNoInk`, and
 * already carrying a hex weave and a ripple. Writing a second energy shader for
 * this would be the same surface twice, which is the thing this codebase
 * deletes on sight.
 */
function fieldMaterial(color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uPower: { value: 1 },
      /* HOW HARD THE HEX READS. A bubble round one body is 2 m across and its
       * weave is a texture; a plane 128 m across at the same frequency is a
       * moiré field. The scale is a uniform so the two uses can disagree. */
      /* 1.9 puts a cell at about three metres. 0.55 was eleven, and from any
       * distance that reads as a wall of blue blobs rather than as the faint
       * interference a containment field has. The references barely show the
       * field at all — what you see through the opening is stars. */
      uWeave: { value: 1.9 },
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        /* three's fog_vertex chunk reads a local named mvPosition. */
        vec4 mvPosition = mv;
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uTime; uniform float uPower; uniform float uWeave;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        /* THE FRESNEL IS THE WHOLE READ ON A PLANE. On a bubble the rim does
           the work; a flat field seen face-on has no rim, so what makes it
           visible at all is the grazing term plus the weave. Held low so the
           planet behind it is not washed out — the field is the brightest
           surface in the room and it still must not be the loudest. */
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
        /* TWO TERMS, NOT THREE, AND THAT IS THE WHOLE BUG. This multiplied
           a third sine of vP.z, and every field plane is a PlaneGeometry --
           which writes EVERY vertex at object-space z = 0. sin(0) is 0, so
           the product was 0 everywhere, on all four planes, always. The
           "subtle hex/interference pattern" the spec ticks has never been
           drawn: what was on screen was a fresnel gradient and a ripple.

           And the frequency was a hectometre. At uWeave 0.06 one cell is
           105 m across a 288 m plane -- two and a half cells over the whole
           aperture. It is metres now, which is what "subtle pattern" means on
           a surface you can stand next to. */
        float hexes = sin(vP.x * uWeave) * sin(vP.y * uWeave);
        float ripple = 0.5 + 0.5 * sin(vP.y * 0.10 - uTime * 0.9);
        /* THE WEAVE IS A WHISPER. At 0.20 it was the loudest thing in the
           plane and the field read as decoration hung across the opening;
           the fresnel is what says "there is a surface here" and the weave
           only has to keep it from being a flat wash. */
        float raw = fres * 0.62 + max(hexes, 0.0) * 0.085 + ripple * 0.05;
        float e = max(fwidth(raw) * 0.5, 0.004);
        float s1 = smoothstep(0.14 - e, 0.14 + e, raw);
        float s2 = smoothstep(0.34 - e, 0.34 + e, raw);
        float s3 = smoothstep(0.62 - e, 0.62 + e, raw);
        float band = (0.05 + s1 * 0.16 + s2 * 0.22 + s3 * 0.30);
        float a = band * uPower;
        gl_FragColor = vec4(uColor * (a * 1.9), a);
        /* AN ADDITIVE SURFACE FADES BY LOSING ITS OWN LIGHT, not by taking on
           the fog's colour: mixing toward fogColor on a blend that ADDS
           would make the far field brighter the further away it got. So the
           extinction multiplies instead. */
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb *= (1.0 - fogF);
          gl_FragColor.a *= (1.0 - fogF);
        #endif
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    /**
     * AND IT IS FOGGED, WHICH INVERTED THE DEPTH CUE WHILE IT WAS NOT.
     *
     * A raw `ShaderMaterial` gets no fog unless it asks, so the field planes
     * were the one thing in this room at full contrast at 220 m — while the
     * `MeshBasicMaterial` rim sitting ON them was extinguished like everything
     * else. The frame around the opening faded and the opening did not, so the
     * shield read as NEARER than its own frame, which is the one relationship
     * a player reads distance from.
     *
     * `fog: true` puts three's fog uniforms into the program; the chunks are
     * pasted into the shader below.
     */
    fog: true,
  });
  /* THE UNIFORMS THE FOG CHUNKS READ. `UniformsLib.fog` is three's own block,
   * merged rather than typed, so a vendor bump cannot leave this behind. */
  Object.assign(mat.uniforms, THREE.UniformsLib.fog);
  mat.userData.saberNoInk = true;
  return mat;
}

/**
 * ══ THE APERTURE, AS ONE OUTLINE ══════════════════════════════════════════
 *
 * A rounded rectangle in the aperture's own plane — x across, y up from the
 * deck — anticlockwise from the bottom edge, with `SEG` straight pieces per
 * corner. The rim traces it, the field fills it, the fascia is cut round it,
 * the studs sit outside it and the barrier stands behind it: one list, five
 * consumers, so the frame and the hole cannot disagree.
 */
const APERTURE_SEG = 6;
export function aperturePoints() {
  const W = DECK.wall, T = DECK.aperture.top, C = DECK.aperture.corner;
  const pts = [];
  const arc = (cx, cy, a0) => {
    for (let i = 0; i <= APERTURE_SEG; i++) {
      const a = a0 + (i / APERTURE_SEG) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * C, cy + Math.sin(a) * C]);
    }
  };
  arc(W - C, C, -Math.PI / 2);          // bottom-right
  arc(W - C, T - C, 0);                 // top-right
  arc(-W + C, T - C, Math.PI / 2);      // top-left
  arc(-W + C, C, Math.PI);              // bottom-left
  return pts;
}

/** The same outline as a `THREE.Shape`/`THREE.Path`, for the field and the fascia. */
function apertureShape(Cls = THREE.Shape) {
  const pts = aperturePoints();
  const sh = new Cls();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  return sh;
}

/**
 * A field plane, and the invisible wall that goes with it.
 *
 * The barrier is a static box rather than terrain because the terrain's job
 * here is to END — see `hangardeck`. A player who walks into the field should
 * stop at it and be able to stand there looking out, which is the best view in
 * the scene and the one thing the composition is built to reward.
 */
function fieldPlane(world, mat, geo, centre, quat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(centre);
  if (quat) mesh.quaternion.copy(quat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.name = 'deck-field';
  world.scene.add(mesh);
  world.statics.push(mesh);
  return mesh;
}

/**
 * ══ THE FIELD — one opening, forward, and the rim round it ═══════════════
 *
 * What every reference has: one aperture in the forward face, a wide rounded
 * rectangle the full width of the working deck, with the field across it and
 * a fat white rim round the whole outline.
 *
 * THE RIM IS THE MOST IMPORTANT OBJECT IN THE ROOM. `REFERENCES.md` rule 1,
 * agreed by all seven images: the opening is bordered by a continuous,
 * intensely bright white band — brighter than anything it lights — and it is
 * what says the vacuum is on the other side. Without it the field is a hole
 * in the dark.
 */
function addField(world) {
  const mat = fieldMaterial(0x8fd4ff);
  world._hangarField = mat;
  const L = DECK.lip;
  const H = DECK.roof;
  const pts = aperturePoints();

  /* THE PLANE IS THE OUTLINE. A rectangle would show the field through the
   * corners the rounding closes, which is a shield with a frame drawn on top
   * of it rather than a shield in a frame. `ShapeGeometry` lies in the x/y
   * plane at z = 0, the same object space the weave reads. */
  const geo = new THREE.ShapeGeometry(apertureShape(), 1);
  fieldPlane(world, mat, geo, new THREE.Vector3(0, 0, L), null);

  /**
   * AND IT IS UNLIT, UNFOGGED AND UNTONEMAPPED, because rule 1 is not a
   * preference. A `MeshStandardMaterial` with `emissiveIntensity: 3.4` is
   * still a shaded surface and lost to the dark ambient; a fogged white at
   * 243 m — the lip, from the lift doors — is the fog's own colour, which is
   * a rim that has gone out from the one place the player first sees it.
   * `hangar 1` and `5` show the rim blazing from the far side of the deck.
   *
   * AND IT CARRIES NO `emissive`: a `MeshBasicMaterial`'s uniform set HAS NO
   * `emissive`, so setting one threw inside `WebGLRenderer.render` every frame
   * — in the browser only, which no headless suite could see.
   */
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  rimMat.userData.saberNoInk = true;
  rimMat.name = 'field-rim';
  /**
   * THE BAND IS 3 m THICK IN ITS PLANE and 2.4 m deep. The lip is 190 m from
   * where the company stands: a 1.1 m band there subtends 0.33°, a hairline.
   * Three metres is about the width the rim takes up in `hangar 1` and
   * `hangar 4` at their own distances — a bright edge, not a line.
   *
   * FOUR MESHES, NOT ONE: bottom, right, top, left, each with half of the
   * two corners it meets. `refhold` counts rims because a rim on every edge
   * is the rule, and a traverse cannot count edges inside a merge.
   */
  const T = 3.0, D = 2.4;
  const nSeg = pts.length;
  /* ONE SWEPT BAND, in four pieces. Each outline point is pushed T/2 out
   * and T/2 in along the average of its two edge normals, and each side's
   * run of points becomes one polygon (outer run, then the inner run back)
   * extruded D deep — so the corners are the arcs of the outline itself. A
   * box per segment, lengthened to hide its joins, was tried first and the
   * joins showed anyway as scallops on every corner from mid-deck. */
  const outer = [], inner = [];
  for (let i = 0; i < nSeg; i++) {
    const [px, py] = pts[(i - 1 + nSeg) % nSeg], [x, y] = pts[i], [nx, ny] = pts[(i + 1) % nSeg];
    let ex = x - px, ey = y - py; let l = Math.hypot(ex, ey) || 1; ex /= l; ey /= l;
    let fx = nx - x, fy = ny - y; l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l;
    /* Left-hand normals of the two edges; the outline runs counter-clockwise
     * so "out" is to the right of travel. */
    let ox = (ey + fy) * 0.5, oy = -(ex + fx) * 0.5;
    l = Math.hypot(ox, oy) || 1; ox /= l; oy /= l;
    outer.push([x + ox * T * 0.5, y + oy * T * 0.5]);
    inner.push([x - ox * T * 0.5, y - oy * T * 0.5]);
  }
  /* Is the outline counter-clockwise? If not, the offsets above are inside
   * out — swap them. */
  let area = 0;
  for (let i = 0; i < nSeg; i++) { const [x, y] = pts[i], [nx, ny] = pts[(i + 1) % nSeg]; area += x * ny - nx * y; }
  const [OUTER, INNER] = area > 0 ? [outer, inner] : [inner, outer];
  const per = APERTURE_SEG + 1;
  const groups = [[], [], [], []];
  for (let i = 0; i < nSeg; i++) {
    const side = Math.min(3, Math.floor(((i + Math.ceil(APERTURE_SEG / 2)) % nSeg) / per));
    groups[side].push(i);
  }
  for (const idx of groups) {
    if (idx.length < 2) continue;
    /* The run, in outline order, plus the next point so sides meet edge to edge. */
    const run = [...idx, (idx[idx.length - 1] + 1) % nSeg];
    const shape = new THREE.Shape();
    run.forEach((_, k) => {
      const [x, y] = OUTER[run[k]];
      if (k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
    for (let k = run.length - 1; k >= 0; k--) { const [x, y] = INNER[run[k]]; shape.lineTo(x, y); }
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -D / 2);
    const rim = new THREE.Mesh(g, rimMat);
    rim.position.set(0, 0, L);
    rim.name = 'field-rim';
    rim.renderOrder = 2;
    world.scene.add(rim);
    world.statics.push(rim);
  }

  /**
   * ══ THE STROBES, ALONG THE LIP ═══════════════════════════════════════════
   *
   * "Deck extends out toward the shield and just ends. Warning strobes at the
   * lip, no railing." A rank of low markers along the last plates, pulsing out
   * of phase so the eye reads a line rather than a row of dots. One instanced
   * mesh; the pulse is a per-instance colour.
   */
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffe9d2, toneMapped: false });
  strobeMat.userData.saberNoInk = true;
  strobeMat.name = 'lip-strobe';
  const IN = 3.0;                      // how far inside the drop they stand
  const spots = [];
  for (let d = -DECK.wall + 8; d <= DECK.wall - 8; d += 12) spots.push([d, L - IN]);
  const strobes = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.34, 0.5, 0.9, 6), strobeMat, spots.length);
  strobes.name = 'lip-strobe';
  strobes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
  const _m = new THREE.Matrix4();
  for (let i = 0; i < spots.length; i++) {
    strobes.setMatrixAt(i, _m.makeTranslation(spots[i][0], 0.45, spots[i][1]));
    strobes.setColorAt(i, new THREE.Color(1, 0.92, 0.82));
  }
  strobes.instanceMatrix.needsUpdate = true;
  strobes.frustumCulled = false;
  world.scene.add(strobes);
  world.statics.push(strobes);
  world._deckStrobes = { mesh: strobes, spots, t: 0 };

  addMarkerLights(world);

  /* THE BARRIER behind the field — a box rather than the plane itself, because
   * a plane has no thickness and a character controller resolves through one.
   * The walls and the ceiling carry their own in `deckColliders`. */
  const th = 2;
  world.physics?.addStaticBox?.(new THREE.Vector3(0, H / 2, L + th),
    new THREE.Vector3(DECK.wall + 30, H / 2 + 10, th), new THREE.Quaternion(), { friction: 0.4 });
}

/**
 * ══ THE MARKER LIGHTS — rows of small recessed lamps in the plate ═════════
 *
 * `hangar 1`, `3` and `5`: the deck is a black mirror with small white lamps
 * set flush in it, in rows along the lanes and round the pads, each throwing
 * a tiny pool. They replaced sixty uplights with additive discs under them:
 * a marker is a dot of light, not a fixture, and a row of them is what says
 * the floor goes somewhere. One `InstancedMesh`, unlit, untonemapped, no
 * ink — a hundred and eighty outlines on a hundred and eighty discs was the
 * loudest thing on the plate.
 */
function addMarkerLights(world) {
  const sep = world._deckFaction === 'separatist';
  const mat = new THREE.MeshBasicMaterial({ color: sep ? 0xdcecff : 0xfff6e8, toneMapped: false });
  mat.userData.saberNoInk = true;
  mat.name = 'deck-marker';
  const L = DECK.lip, A = DECK.aft;
  const spots = [];
  /* The two lane edges, staggered so the eye reads two rows and not a grid. */
  for (const s of [-1, 1]) {
    for (let z = A + 24; z <= L - 20; z += 6) spots.push([s * 40, z]);
    for (let z = A + 27; z <= L - 20; z += 12) spots.push([s * 62, z]);
  }
  /* The centreline, sparse, and never on the muster ground. */
  for (let z = A + 30; z <= L - 20; z += 12) {
    if (z > DECK.line - 10 && z < DECK.line + 14) continue;
    spots.push([0, z]);
  }
  /* A ring round each pad, just outside the kerb. */
  for (const [px, pz, r] of [[DEPLOY_RAMP.x, DEPLOY_RAMP.padZ, PADS.a.r + 2.2], [PADS.b.x, PADS.b.z, PADS.b.r + 2.2]]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      spots.push([px + Math.cos(a) * r, pz + Math.sin(a) * r]);
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.34, 0.10, 8), mat, spots.length);
  mesh.name = 'deck-marker';
  const _m = new THREE.Matrix4();
  for (let i = 0; i < spots.length; i++) mesh.setMatrixAt(i, _m.makeTranslation(spots[i][0], 0.05, spots[i][1]));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  world.scene.add(mesh);
  world.statics.push(mesh);
  world._deckMarkers = mesh;
}

/** Nine lines of merge, so this file does not import a utils module for one call. */
function mergeGeometries(geos) {
  let n = 0, idx = 0;
  for (const g of geos) { n += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const index = new Uint32Array(idx);
  let o = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, o * 3); if (nn) nor.set(nn.array, o * 3); if (u) uv.set(u.array, o * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.array[i] + o;
    else for (let i = 0; i < p.count; i++) index[io++] = i + o;
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * ══ THE ROOM, BUILT AGAINST `hangar 1`, `3` AND `6` ═══════════════════════
 *
 * Part for part, and this is the rebuild against the references after the
 * player asked whether the room he was given was what would have been built
 * from them. It was not, and the gap was the LOOK:
 *
 *   TWO WALLS OF PALE SLABS, eight to twelve metres wide, running from the
 *     bulkhead to the aperture with a pilaster proud of the wall at every
 *     joint and one tall white strip light per slab — two per slab in the
 *     mouth, where `hangar 1` and `5` double the rank. A gallery catwalk
 *     with rails a third of the way up, a lit fascia under it, cable runs
 *     pinned along the wall, a glazed control booth every seventy metres
 *     and a service door at the foot of every other slab. The racked-fighter
 *     wallpaper is gone: the fighters hang from the overhead (`hangar 3`,
 *     `6`), where the references keep them.
 *   ONE SOLID WALL, aft, in the same vocabulary, with the lift set into it,
 *     blast doors either side, a small crest, and two catwalks for scale.
 *   THE CEILING is a structure — girders, beams, cables, crane rails, ducts,
 *     hung fighters, the fixtures — under a plate that carries a grid of
 *     white strip lights (`hangar 2`), so it reads as lit rather than as a
 *     dark lid.
 *   THE DECK IS A BLACK MIRROR: thin pale guide lines, thin red keep-outs
 *     (`hangar 5`), pad rings, rows of recessed marker lights, the seam grid
 *     and a lit pit. No emblem on the floor — the player asked for the wheel
 *     to go, and no reference paints a crest on its deck.
 *   ONE OPENING, forward, a rounded rectangle with a 3 m white rim, with the
 *     world in it.
 */
export function dressStructure(kit, paint) {
  _dressFaction = kit.faction || 'republic';
  /* OFF THE KIT, NEVER BARE. `deckMats()` with no argument hands back the
   * default palette, so one bare call in here was enough to mix five Republic
   * materials into a Separatist room. */
  const M = deckMats(kit.faction);
  const L = DECK.lip;
  const WALL = DECK.wall;
  const ROOF = DECK.roof;
  const A = DECK.aft;
  /**
   * THE WALL'S DRAWN FACE, six metres inside `DECK.wall`. The collider face
   * is at `DECK.wall - 7.5` (`deckColliders`); the pilasters stand two metres
   * proud of this face and the booths a metre and a half, so the player is
   * stopped a hand's breadth from the thing he can see, and the pale slab
   * itself is what closes the room at every ray the shape check fires.
   */
  const F = WALL - 6;
  const mid = (A + L) / 2, len = L - A + 8;
  const first = A + 6, last = L - 4;
  /* Slab pitch: 10.4 m, `hangar 6`'s rhythm, twenty-seven a side. */
  const pitch = 10.4;
  const n = Math.floor((last - first) / pitch);
  /* Where one strip per slab becomes two: the last seventy metres. */
  const mouth = L - 70;
  /* The gallery: catwalk height, and the strip runs either side of it. */
  const GALLERY = 30;

  /* ── THE TWO WALLS. */
  for (const s of [-1, 1]) {
    /* The slab: one pale wall, full length, full height, under the plate. */
    kit.slabAt(M.hull, s * (F + 7), ROOF / 2, mid, 14, ROOF, len);
    /* The skirting at its foot and the cornice under the plate: the dark
     * lines that make a slab read as a wall with a top and a bottom. */
    kit.slabAt(M.dark, s * (F - 0.35), 0.55, mid, 0.7, 1.1, len);
    kit.slabAt(M.dark, s * (F - 0.9), ROOF - 2.0, mid, 1.8, 2.6, len);
    /* Pilasters at every joint. */
    for (let i = 0; i <= n; i++) pilaster(kit, s * F, s, first + i * pitch, ROOF - 3.5);
    /* One strip per slab, two in the mouth: from the skirting to under the
     * gallery, and from over the gallery to the upper band. */
    for (let i = 0; i < n; i++) {
      const zc = first + (i + 0.5) * pitch;
      const zs = zc > mouth ? [zc - pitch * 0.24, zc + pitch * 0.24] : [zc];
      for (const z of zs) {
        wallStrip(kit, s * F, s, 2.4, GALLERY - 3.2, z);
        wallStrip(kit, s * F, s, GALLERY + 4.0, 62, z);
        /* Its reflection off the plate, rule 2. */
        smear(kit, s * (F - 2.4), z, 22, 3.0, -s, 0);
      }
      /* At the foot: a booth every seventh slab, a door on every other. */
      if (i % 7 === 3) controlBooth(kit, s * F, s, zc, { width: pitch * 0.86 });
      else if (i % 2 === 0) serviceDoor(kit, s * F, s, zc);
    }
    /* THE GALLERY: a catwalk with rails along the wall, `hangar 6`'s
     * walkway with a figure on it, and the lit fascia under its edge. */
    catwalk(kit, s * (F - 2.2), GALLERY, mid, len - 20, { yaw: Math.PI / 2 });
    kit.slabAt(M.deep, s * (F - 0.3), GALLERY - 1.7, mid, 0.6, 1.4, len - 20);
    kit.slabAt(M.glowDim, s * (F - 0.7), GALLERY - 1.3, mid, 0.3, 0.3, len - 22);
    /* The upper band: a dark panel line where the strips end, and the long
     * horizontal run along the top of the wall (`hangar 3`, `4`). */
    kit.slabAt(M.dark, s * (F - 0.3), 64.5, mid, 0.6, 2.4, len - 12);
    kit.slabAt(M.glowDim, s * (F - 0.5), 82, mid, 0.5, 0.7, len - 12);
    /* Cable runs pinned to the wall, two heights. */
    cableRun(kit, s * F, s, 20.5, mid, len - 16, { pitch });
    cableRun(kit, s * F, s, 44.0, mid, len - 16, { pitch, radius: 0.26 });
  }

  /* ── THE FORWARD FACE: a fascia round the opening, cut to the outline, so
   * the rounded rectangle is a window in a wall rather than the walls
   * simply stopping. One extrusion with the aperture as its hole. */
  {
    const fz = L + 1.2;
    const face = new THREE.Shape();
    face.moveTo(-WALL - 16, -2);
    face.lineTo(WALL + 16, -2);
    face.lineTo(WALL + 16, ROOF + 2);
    face.lineTo(-WALL - 16, ROOF + 2);
    face.closePath();
    face.holes.push(apertureShape(THREE.Path));
    const g = new THREE.ExtrudeGeometry(face, { depth: 2.4, bevelEnabled: false });
    kit.geoAt(M.hull, g, 0, 0, fz - 1.2);
    /* The lintel over the opening, dark, with a strip run along it. */
    kit.slabAt(M.dark, 0, (DECK.aperture.top + ROOF) / 2 + 1, fz - 1.6, WALL * 2 + 8, ROOF - DECK.aperture.top - 2, 0.9);
    kit.slabAt(M.glowDim, 0, DECK.aperture.top + 3.2, fz - 2.0, WALL * 2 - 24, 0.6, 0.5);
    /* Emitter housings along the rim: fat studs every ~12 m, just outside
     * the band, the hardware the white band is drawn on. */
    const pts = aperturePoints();
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const seg = Math.hypot(bx - ax, by - ay);
      /* One per 12 m of straight edge; the short corner pieces get one
       * between them (every other), so the arc is studded too. */
      if (seg < 12 && i % 2) continue;
      const k = Math.max(1, Math.round(seg / 12));
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        /* Outward: away from the opening's centre. */
        const ox = px, oy = py - DECK.aperture.top / 2;
        const ol = Math.hypot(ox, oy) || 1;
        kit.slabAt(M.dark, px + (ox / ol) * 3.0, Math.max(1.5, py + (oy / ol) * 3.0), fz - 0.4, 3.0, 3.0, 2.0);
      }
    }
  }

  /* ── THE BULKHEAD. One pale wall in the same vocabulary — slabs, pilasters,
   * a strip per slab — with the lift set into its centre, two blast doors
   * either side of it, and two catwalks. */
  const bz = A + 4;
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue;
    kit.slabAt(M.hull, i * 22, ROOF / 2, bz, 20, ROOF, 3.2);
    kit.slabAt(M.dark, i * 22 - 11, ROOF / 2, bz + 1.6, 2.2, ROOF, 2.4);
    kit.slabAt(M.hull, i * 22 - 11, ROOF / 2, bz + 2.9, 1.2, ROOF - 3, 0.3);
    /* A strip per slab, from over the doors to the upper band — laid by
     * hand rather than by `wallStrip`, whose axes are a side wall's. */
    kit.slabAt(M.deep, i * 22, 41, bz + 1.85, 1.7, 39, 0.5);
    kit.slabAt(M.lamp, i * 22, 41, bz + 2.15, 0.8, 38, 0.35);
  }
  /* The centre bay of the bulkhead: solid above the lobby, the lobby cut into
   * it, and the lift's own shaft face inside that. */
  kit.slabAt(M.hull, 0, (ROOF + LIFT.lobby.h) / 2, bz, 22, ROOF - LIFT.lobby.h, 3.2);
  liftLobby(kit, M, paint, bz);
  /* THE BLAST DOORS, closed, either side: where the rest of the ship is. The
   * crowd stands and walks in front of them; nobody comes through. */
  for (const s of [-1, 1]) {
    const dx = s * 30;
    kit.slabAt(M.deep, dx, 9, bz + 1.0, 14, 18, 3);
    kit.slabAt(M.hull, dx - 3.6, 9, bz + 2.2, 0.8, 17, 1.2);
    kit.slabAt(M.hull, dx + 3.6, 9, bz + 2.2, 0.8, 17, 1.2);
    kit.slabAt(M.dark, dx, 18.4, bz + 2.4, 15, 1.6, 2.2);
    kit.slabAt(M.status, dx, 19.6, bz + 2.9, 0.6, 0.6, 0.6);
    kit.slabAt(M.glowDim, dx, 17.2, bz + 2.6, 12, 0.4, 0.5);
    /* Their light on the deck. */
    smear(kit, dx, bz + 3, 14, 12, 0, 1);
  }
  /**
   * THE INSIGNIA, WHICH IS THE ONLY THING IN THE ROOM THAT SAYS WHOSE IT IS.
   *
   * SMALL, AND ON THE WALL ONLY. It was a 24 m crest here and a 32 m one on
   * the muster ground; the player asked for the wheel on the floor to go, and
   * no reference paints an emblem on its deck. A ship's crest high on a
   * bulkhead, at the scale a crest is painted, is what the references have.
   * See `DeckKit.insigniaParts` for the two shapes.
   */
  insigniaPanel(kit, 0, 34, bz + 3.4, 14, { faction: kit.faction });

  /* ══ THE MEMORIAL, ON THE ONE REAL WALL YOU WALK PAST ═══════════════════
   * A recessed panel beside the lift at head height, one lit bar per name.
   * NOT a wall of text: a rank of short bright marks, one for each man who is
   * not in the formation, getting longer as the war goes on. */
  const fallen = memorialRoll();
  if (fallen.length) {
    const mx = -13.5, my = 4.2, mz = bz + 2.9;
    kit.slabAt(M.deep, mx, my, mz - 0.5, 8, 4.4, 1.2);
    kit.slabAt(M.hull, mx, my + 2.4, mz, 8.6, 0.4, 1.8);
    kit.slabAt(M.hull, mx, my - 2.4, mz, 8.6, 0.4, 1.8);
    const per = 14;
    for (let i = 0; i < Math.min(fallen.length, per * 2); i++) {
      const col = i % per, row = (i / per) | 0;
      kit.slabAt(M.glow, mx - 3.3 + col * 0.5, my + 0.9 - row * 1.6, mz + 0.35, 0.22, 1.1, 0.3);
    }
    kit.slabAt(M.glowDim, mx, my - 1.9, mz + 0.3, 7, 0.14, 0.3);
  }

  catwalk(kit, 0, 22, bz + 5.5, WALL * 2.1);
  catwalk(kit, 0, 46, bz + 5.5, WALL * 2.1);

  /* ── THE CEILING, and everything hung from it. */
  ceilingAt(kit, M, first, last);

  /* ── THE SECOND PAD, out toward the aperture on the starboard side: a
   * craft on a raised platform in the middle distance, `hangar 7.jpg`'s scale
   * ladder. The near pad is left EMPTY here: the army's real transport stands
   * on it, built by `DeckFlight`, because a ship you can walk into has to be
   * a ship. */
  /* Pad B carries no static ship: DeckLife's third hull lands and launches
   * from it, so what stands there is a real, moving craft. */
  shuttlePad(kit, 44, 96, { radius: 15, yaw: -1.2, ship: false });
  shuttlePad(kit, DEPLOY_RAMP.x, DEPLOY_RAMP.padZ, { radius: 15, yaw: 0, ship: false, height: 0.45 });
  /* A painted apron at the ramp's foot, so the one square metre of deck that
   * does something is a place rather than a trap. */
  paint.line(P_RAMP.stencil, DEPLOY_RAMP.x - 5, DEPLOY_RAMP.z - 4,
    DEPLOY_RAMP.x + 5, DEPLOY_RAMP.z - 4, 0.32);
  paint.line(P_RAMP.stencil, DEPLOY_RAMP.x - 5, DEPLOY_RAMP.z + 4,
    DEPLOY_RAMP.x + 5, DEPLOY_RAMP.z + 4, 0.32);

  /* ── ON THE DECK: crate clusters at the wall feet, and the pit. Nothing in
   * the middle — the middle is where the company stands and where every
   * reference leaves the floor clear. */
  crates(kit, -WALL + 12, -70, 6, 3);
  crates(kit, WALL - 14, -58, 5, 7);
  crates(kit, WALL - 12, 18, 7, 11);
  crates(kit, -WALL + 16, 58, 4, 13);
  crates(kit, -WALL + 12, 104, 6, 17);
  crates(kit, WALL - 12, 124, 5, 23);
  crates(kit, WALL - 30, 70, 4, 29);
  /* The pit, lit from inside — the one thing that says there is more ship
   * under this one. Its kerbs are in `deckColliders` too. */
  for (const [dx, dz, w, d] of PIT_KERBS) {
    kit.slabAt(M.hull, dx, 0.35, dz, w, 0.7, d);
    kit.slabAt(M.glow, dx, 0.1, dz, w * 0.9, 0.16, d * 0.9);
  }

  /* DRAINAGE GRATINGS, flush, two runs the length of the deck — a
   * manufactured surface has seams that do something. */
  for (const s of [-1, 1]) {
    kit.slabAt(M.deep, s * 52, 0.015, (DECK.aft + L) / 2, 1.4, 0.03, L - DECK.aft - 30);
    for (let z = DECK.aft + 20; z < L - 10; z += 3.0) kit.slabAt(M.hull, s * 52, 0.03, z, 1.5, 0.03, 0.18);
  }

  /**
   * ── THE PAINT. Rule 7: large, pale, sparse, and RED where it is coloured
   * at all — there is no yellow in any of the seven. And THIN: the references
   * paint a black mirror with hairlines, not with a crest. The 32 m insignia,
   * the chevrons and the grid of tie-down rings are gone; what is left is
   * what `hangar 1`, `4` and `5` show — long pale guide lines, thin red
   * rectangles, rings round the pads.
   */
  const P = DECK_PAINT;
  paint.dashed(P.stencil, 0, DECK.aft + 20, 0, L - 20, 0.28, 5.5, 4.5);
  for (const s of [-1, 1]) {
    paint.line(P.stencil, s * 40, DECK.aft + 20, s * 40, L - 20, 0.24);
    paint.line(P.stencil, s * 62, DECK.aft + 20, s * 62, L - 20, 0.18);
  }
  /* Thin red rectangles on the crowd ground and the work bay, `hangar 5`. */
  const box = (c, x0, z0, x1, z1, w = 0.22) => {
    paint.line(c, x0, z0, x1, z0, w); paint.line(c, x1, z0, x1, z1, w);
    paint.line(c, x1, z1, x0, z1, w); paint.line(c, x0, z1, x0, z0, w);
  };
  for (const s of [-1, 1]) box(P.keepOut, s * 20, -92, s * 58, -66);
  box(P.keepOut, 36, -18, 66, 24);
  box(P.keepOut, 36, 34, 66, 58);
  /* The muster ground, boxed — the line has a place painted for it. */
  box(P.stencil, -46, DECK.line - 2, 46, DECK.line + 9, 0.26);
  /* The lift's apron. */
  paint.line(P.stencil, -9, bz + 4, 9, bz + 4, 0.3);
  paint.line(P.stencil, -9, bz + 14, 9, bz + 14, 0.3);
  /* Red keep-outs at the pit and both pads, pale rings inside the red. */
  paint.line(P.keepOut, -68, -18, -36, -18, 0.3);
  paint.line(P.keepOut, -68, 30, -36, 30, 0.3);
  for (const [px, pz] of [[DEPLOY_RAMP.x, DEPLOY_RAMP.padZ], [44, 96]]) {
    paint.ring(P.keepOut, px, pz, 18.5, 0.3, 48);
    paint.ring(P.stencil, px, pz, 15.8, 0.22, 48);
  }
}

/** The pit's four kerbs, shared by the geometry and the colliders. */
/* OFF THE HEIGHTFIELD'S OWN CUT: `hangardeck.height` sinks the plate inside
 * |x+52| < 17, |z-6| < 24, and these are its four edges. The old kerbs stood
 * round (-30, 6) while the hole was at (-52, 6) — a fence twenty metres from
 * the drop it was fencing. */
const PIT_KERBS = [[-52, -18, 34, 1.6], [-52, 30, 34, 1.6], [-69, 6, 1.6, 48], [-35, 6, 1.6, 48]];

/**
 * ══ THE LOBBY, cut into the bulkhead round the lift ═══════════════════════
 *
 * A recess the height of two men with a lit header, the lift's two door
 * jambs, a call panel with its lamp, and the shaft's own dark face behind the
 * doors. The doors and the car are `DeckLift`'s — they move — so what is
 * here is the hole they sit in.
 */
function liftLobby(kit, M, paint, bz) {
  const { w, h, depth } = LIFT.lobby;
  const cz = LIFT.door;
  /* The recess back face, which is the shaft's face: dark, with the door
   * opening left as a darker slot behind the leaves. */
  kit.slabAt(M.deep, 0, h / 2, cz - 0.6, w, h, 1.2);
  /* The header and the jambs framing the recess. */
  kit.slabAt(M.hull, 0, h + 0.8, bz + 1.6, w + 3, 1.6, depth + 1.2);
  for (const s of [-1, 1]) kit.slabAt(M.hull, s * (w / 2 + 0.8), h / 2, bz + 1.6, 1.6, h + 2, depth + 1.2);
  /* The lit header over the doors, rule 4's bar. */
  kit.slabAt(M.glow, 0, LIFT.height + 0.6, cz + 0.3, LIFT.halfW * 2 + 0.6, 0.35, 0.35);
  /* The door frame proper, proud of the shaft face. */
  for (const s of [-1, 1]) kit.slabAt(M.hull, s * (LIFT.halfW + 0.45), LIFT.height / 2, cz + 0.2, 0.9, LIFT.height + 0.4, 0.8);
  kit.slabAt(M.hull, 0, LIFT.height + 0.2, cz + 0.2, LIFT.halfW * 2 + 1.8, 0.5, 0.8);
  /* The call panel, with its lamp: red while the car is away. `DeckLift`
   * swaps the lamp's colour, so it is a separate small mesh there. */
  kit.slabAt(M.hull, LIFT.halfW + 1.6, 1.3, cz + 0.5, 0.5, 0.7, 0.3);
  /* And the recess floor's own smear, so the doorway throws light out. */
  smear(kit, 0, cz + 0.4, 14, LIFT.halfW * 2, 0, 1);
}

/**
 * ══ THE CEILING, which is a structure and not a lid ══════════════════════
 *
 * "give the hangar a solid ceiling (but very high up even higher than the side
 *  walls you have now) … but the ceiling can't make the hangar look like a
 *  shitty box like you've done in the past it feels to have a billion
 *  different things going on to trick you"
 *
 * So the plate is there — a player firing a ray straight up hits something —
 * and it is the LEAST visible thing overhead. Under it, from the top down:
 *
 *   the plate            `deep`, at DECK.roof, under 60% haze from the deck
 *   longitudinal girders three, the length of the room, with lamps on them
 *   transverse beams     every 16 m, wall to wall, deeper than the girders
 *   light panels         ranks of unlit bars between the beams (rule 4)
 *   catenary cable runs  sagging between beams, `hangar 3.jpg`'s whole top
 *   crane rails          two, the length of the room; the bridges that ride
 *                        them are `DeckLife`'s and move
 *   ducting              two big runs along the walls, with collars
 *   hung fighters        two rows on ceiling mounts, nose down
 *   hanging fixtures     the big cylinders with red status lamps, `hangar
 *                        7.jpg`, now ENDING at the plate instead of running
 *                        up out of frame
 *
 * The eye never gets a clean look at the plate: something is always between
 * it and the deck, and the haze takes the rest.
 */
function ceilingAt(kit, M, zFirst, zEnd) {
  const W = DECK.wall + 14, R = DECK.roof, L = DECK.lip, A = DECK.aft;
  const mid = (A + L) / 2, len = L - A + 8;
  /* The plate — `dark`, not `deep`: a black lid ninety metres up under
   * pale haze was the one thing that made the top of the room read as a
   * lid. The lit grid below it is what makes it read as a ceiling. */
  kit.slabAt(M.dark, 0, R + 0.6, mid, W * 2, 1.2, len);
  /**
   * THE STRIP-LIGHT GRID ON THE PLATE, `hangar 2`: seven runs the length of
   * the room and one across every beam bay, unlit bars just under the plate,
   * so the ceiling is a lit thing seen through the girders rather than a
   * dark plane behind them. Fogged, so from the deck it dissolves toward
   * the same pale haze the walls do.
   */
  for (const x of [-66, -44, -22, 0, 22, 44, 66]) {
    kit.slabAt(M.lamp, x, R - 0.45, mid, 1.1, 0.3, len - 12);
  }
  /* Three girders the length of the room. */
  for (const x of [0, -44, 44]) {
    kit.slabAt(M.hull, x, R - 1.6, mid, 2.6, 3.2, len);
    kit.slabAt(M.dark, x, R - 3.4, mid, 4.0, 0.5, len);
  }
  /* Transverse beams, every 16 m, and a status lamp on every other one. */
  for (let z = A + 12, i = 0; z < L - 4; z += 16, i++) {
    kit.slabAt(M.hull, 0, R - 2.2, z, W * 2, 2.2, 1.8);
    kit.slabAt(M.dark, 0, R - 3.6, z, W * 2, 0.5, 3.0);
    if (i % 2 === 0) for (const x of [-22, 22]) kit.slabAt(M.status, x, R - 4.1, z, 0.5, 0.5, 0.5);
    /* The grid's cross run, halfway between this beam and the next. */
    kit.slabAt(M.lamp, 0, R - 0.45, z + 8, W * 2 - 16, 0.3, 1.1);
  }
  /* Catenary cable runs: a sag between neighbouring beams, six lanes. */
  for (const x of [-66, -34, -12, 12, 34, 66]) {
    for (let z = A + 12; z < L - 20; z += 16) {
      const a = new THREE.Vector3(x, R - 3.2, z);
      const b = new THREE.Vector3(x, R - 3.2, z + 16);
      const m = new THREE.Vector3(x + (x > 0 ? -1.2 : 1.2), R - 6.4, z + 8);
      const curve = new THREE.QuadraticBezierCurve3(a, m, b);
      const g = new THREE.TubeGeometry(curve, 6, 0.16, 5, false);
      kit.geoAt(M.dark, g, 0, 0, 0);
    }
  }
  /* Crane rails, the length of the room. The bridges are DeckLife's. */
  for (const x of [-36, 36]) {
    kit.slabAt(M.hull, x, R - 7.0, mid, 1.4, 1.2, len - 12);
    kit.slabAt(M.dark, x, R - 5.6, mid, 0.6, 1.6, len - 12);
  }
  /* Ducting along both walls, with collars every 20 m. */
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(2.2, 2.2, len - 16, 10);
    g.rotateX(Math.PI / 2);
    kit.geoAt(M.dark, g, s * (DECK.wall - 6), R - 4.6, mid);
    for (let z = A + 20; z < L - 10; z += 20) {
      const c = new THREE.CylinderGeometry(2.6, 2.6, 1.2, 10);
      c.rotateX(Math.PI / 2);
      kit.geoAt(M.hull, c, s * (DECK.wall - 6), R - 4.6, z);
    }
  }
  /* Hung fighters, `hangar 3` and `6`: two rows on ceiling mounts, nose
   * down toward the deck. This is the only place the racked-fighter idea
   * survives — the references hang them from rails, not in wall cubbies. */
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = A + 30 + i * 24;
      const x = s * 24;
      kit.slabAt(M.dark, x, R - 5.0, z, 1.4, 8.0, 1.4);
      kit.slabAt(M.hull, x, R - 9.4, z, 4.2, 1.0, 1.4);
      hungFighter(kit, x, R - 14.0, z, (i + (s > 0 ? 1 : 0)) % 3, kit.faction);
    }
  }
  /* The hanging fixtures, ending at the plate. */
  for (let i = 0; i < 10; i++) {
    const z = A + 24 + i * 24;
    overheadRig(kit, 0, z, { top: R, drop: 30, radius: 3.6, capped: true });
    for (const s of [-1, 1]) overheadRig(kit, s * (DECK.wall * 0.62), z, { top: R, drop: 24, radius: 2.6, capped: true });
  }
}

/**
 * A fighter hung nose-down from a ceiling mount: the rack silhouette on its
 * side, so the dark cross of a wing reads against the plate from below.
 */
function hungFighter(kit, x, y, z, kind, faction) {
  const M = deckMats(faction);
  /* The hull as a parked fighter, spun so its wings lie flat under the plate. */
  const sub = new DeckBuild(faction);
  parkedFighter(sub, 0, 0, 0, 1, { kind, faction });
  for (const [mat, geos] of sub.bins) {
    for (const g of geos) {
      g.rotateZ(-Math.PI / 2);
      g.rotateY(Math.PI / 2);
      g.translate(x, y, z);
      kit.geoAt(mat, g, 0, 0, 0);
    }
  }
  /* The cradle it hangs in. */
  kit.slabAt(M.hull, x, y + 4.2, z, 2.2, 0.8, 5.0);
}

/**
 * ══ STANDING AT THE FOOT OF THE RAMP IS HOW YOU LEAVE ═════════════════════
 *
 * A DWELL, NOT A TRIPWIRE. `DEPLOY_RAMP.hold` seconds standing on the apron,
 * with the countdown shown, so walking past the ship on your way to the shield
 * does not launch a run. Step off and it forgets.
 *
 * IT ASKS RATHER THAN DEPLOYS. `main.js` owns what a run IS — the mode, the
 * theatre, the seed, the session — so this raises `world.onDeckDeploy` and
 * main.js decides. With `DeckFlight` standing a real hull on the pad the
 * dwell is the moment the ramp is taken: the flight director boards the
 * company, seals, lifts and flies out through the aperture before main.js is
 * asked for the run — see `DeckFlight.js`.
 */
function stepRamp(world, dt) {
  const p = world?.player;
  if (!p || world._deckLaunched) return;
  if (world._deckFlight?.busy) return;
  const R = DEPLOY_RAMP;
  const d = Math.hypot(p.position.x - R.x, p.position.z - R.z);
  /* ARMED BY LEAVING. A player put down at the ramp's foot by an arrival is
   * inside the reach the moment he can move, and the dwell re-boarded him
   * a second later; the ramp only counts a player who has walked away from
   * it once since the last time it put him down. `DeckFlight` disarms it. */
  if (world._rampArmed === false) {
    if (d > R.reach) world._rampArmed = true;
    return;
  }
  if (d > R.reach) {
    /* STEPPING OFF JUST FORGETS. An empty `notify` is still a toast — the HUD
     * raises the element and animates it — so clearing the countdown by
     * sending two empty strings put a blank card on screen every time the
     * player walked past the ship. */
    world._rampHold = 0;
    return;
  }
  world._rampHold = (world._rampHold || 0) + dt;
  const left = R.hold - world._rampHold;
  if (left > 0) {
    /* The countdown is the whole of the interface. */
    world.notify?.('BOARDING', `hold — ${left.toFixed(1)}s`, 'flavour');
    return;
  }
  world._deckLaunched = true;
  /* THE FLIGHT FIRST, IF THERE IS ONE. `DeckFlight.depart` boards everybody,
   * seals, lifts and punches out through the field, and raises
   * `onDeckDeploy` itself when the hull is clear. A build with no flight
   * director simply asks main.js at once, which is what this always did. */
  if (world._deckFlight?.depart?.()) return;
  world.notify?.('DEPLOYING', 'the company forms up on the ramp', 'alarm');
  world.onDeckDeploy?.();
}

/**
 * THE LIP PULSES, AND IT RUNS RATHER THAN BLINKING.
 *
 * A rank of markers flashing in unison is a decoration; one where the pulse
 * travels along the rank is an edge, and the eye reads the direction of the
 * drop off it without being told. The phase is the marker's own distance
 * along the lip, so the wave runs the perimeter, and the whole thing is one
 * colour attribute upload a frame on one instanced mesh.
 */
function stepStrobes(world, dt) {
  const S = world?._deckStrobes;
  if (!S) return;
  S.t += dt;
  const c = _strobeCol;
  for (let i = 0; i < S.spots.length; i++) {
    const phase = S.t * 2.2 - i * 0.42;
    /* SHARP ON, SLOW OFF — a xenon flash, not a sine. A sine reads as a
     * breathing lamp and every warning light in the world is an impulse. */
    const f = phase - Math.floor(phase / (Math.PI * 2)) * (Math.PI * 2);
    const k = f < 0.5 ? 1 : Math.max(0.14, 1 - (f - 0.5) * 0.9);
    c.setRGB(k, k * 0.92, k * 0.8);
    S.mesh.setColorAt(i, c);
  }
  if (S.mesh.instanceColor) S.mesh.instanceColor.needsUpdate = true;
}
const _strobeCol = new THREE.Color();

/**
 * WHO IS NOT ON THE DECK. The roll's own capped list of the dead, for the
 * memorial — read through the same door `callTheCompany` reads the living
 * through, so the two can never disagree about which army's ship this is.
 */
function memorialRoll() {
  try {
    const rolls = companyLoadAll();
    const want = _dressFaction;
    const roll = rolls.find((r) => r.army === want) || null;
    return (roll?.fallen || []).filter((f) => f && f.designation);
  } catch { return []; }
}
/* WHOSE ROOM IS BEING BUILT RIGHT NOW. `dressStructure` takes a kit and a
 * paint shop and nothing else — that signature is what lets `faction.mjs`
 * build both armies' rooms without a World — so the one thing it needs from
 * outside is passed the only way that does not change it. */
let _dressFaction = 'republic';

/**
 * ══ WHOSE SHIP THIS IS, ASKED ONCE ════════════════════════════════════════
 *
 * "Ship classes, trooper models, deck insignia, PA voice, lighting colour
 *  temperature, and the enemy capital ships in the battle outside all swap
 *  together. Never mix — if the player sees one wrong-faction asset the whole
 *  illusion dies."
 *
 * ONE FUNCTION, AND EVERY CONSUMER TAKES ITS ANSWER. The kit, the paint, the
 * insignia, the lights, the company, the PA and the fleet outside all read
 * this, so there is no second opinion anywhere for them to disagree over.
 *
 * THE ORDER FIRST, THE ROLL SECOND — and the order of those two is the whole
 * rule. A player who has fought for both sides has TWO rolls, and asking the
 * rolls first makes the room's army depend on which one happens to be stored
 * first. The order they lead is unambiguous, is a real setting with a default
 * and a control, and is the same lever the menu already gives — jedi leads the
 * republic, sith the separatists. The roll only answers when there is no order
 * to read, which is a save so fresh it has no alignment at all.
 */
export function deckFaction(world) {
  const led = (() => {
    try { return factionOf(armyToLead(world?.settings?.order)); } catch { return null; }
  })();
  if (led) return led;
  const rolls = companyLoadAll().filter((r) => (r?.men || []).length);
  if (rolls.length) return factionOf(rolls[0].army);
  return factionOf(null);
}

/**
 * ══ WHAT YOU CANNOT WALK THROUGH ══════════════════════════════════════════
 *
 * One box per structural mass, declared against the same numbers
 * `dressStructure` builds from. It is duplication and it is the honest kind:
 * the alternative is deriving colliders from merged geometry, which cannot
 * distinguish a wall from the hundred fighters merged into the same mesh.
 *
 * The bays themselves are deliberately NOT solid to their own depth — the
 * wall is one slab from its outer face to the mouth of the recess, so a
 * player walks up to the racks and stops, rather than being able to stand
 * inside an alcove with a fighter through his head.
 *
 * AND THERE IS NO WAY ROUND THE END OF A WALL ANY MORE. Both run from the
 * bulkhead to the aperture's jamb and the ceiling closes the top, so the
 * room is bounded on six sides by something the player can see.
 */
/**
 * THE TWO PADS, as the floor knows them: pad A is the transport's, pad B the
 * shuttle's. One table, read by the colliders below, by `deckFloorAt`, and
 * by `dressStructure` through `DEPLOY_RAMP` — so the drawn disc, the plate
 * you stand on and the height the company walks at cannot disagree.
 */
export const PADS = {
  get a() { return { x: DEPLOY_RAMP.x, z: DEPLOY_RAMP.padZ, r: 15, h: 0.45 }; },
  b: { x: 44, z: 96, r: 15, h: 1.2 },
};

/**
 * THE FLOOR UNDER A POINT OF THE DECK, in world height. The heightfield is
 * flat; what stands proud of it is the two pads and — when a transport is on
 * its pad — the ramp and the bay floor, which `DeckFlight.hullFloorAt` owns.
 * Installed on the world as `floorAt` by `dressHangar`, so `Shovable`, the
 * company's walk and the gait solver's foot placement all ask one question
 * of one function. Reading only the heightfield walked the company along the
 * deck UNDER the ramp and stood every man on the pad 0.45 m into it.
 */
export function deckFloorAt(world, x, z) {
  const h = hullFloorAt(world, x, z);
  if (h != null) return h;
  const A = PADS.a, B = PADS.b;
  if ((x - A.x) * (x - A.x) + (z - A.z) * (z - A.z) <= A.r * A.r) return A.h;
  if ((x - B.x) * (x - B.x) + (z - B.z) * (z - B.z) <= B.r * B.r) return B.h;
  return world?.terrain ? world.terrain.height(x, z) : 0;
}

/** The floor for a walker: the level's hook if it has one, else the ground. */
function floorY(world, x, z) {
  if (world?.floorAt) return world.floorAt(x, z);
  return world?.terrain ? world.terrain.height(x, z) : 0;
}

function deckColliders(world) {
  const P = world.physics;
  if (!P?.addStaticBox) return;
  const q = new THREE.Quaternion();
  const box = (cx, cy, cz, hx, hy, hz) =>
    P.addStaticBox(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(hx, hy, hz), q, { friction: 0.7 });

  const WALL = DECK.wall, L = DECK.lip, R = DECK.roof;
  const mid = (DECK.aft + L) / 2, half = (L - DECK.aft) / 2 + 4;
  /* THE TWO RACK WALLS, each one box from the mouth of the inboard recess to
   * the far side of the wall, the whole length and the whole height. */
  for (const s of [-1, 1]) box(s * (WALL + 7), R / 2, mid, 14.5, R / 2 + 4, half);
  /* THE CEILING: the plate, so the top is closed by the thing that is drawn. */
  box(0, R + 0.6, mid, WALL + 20, 0.8, half);
  /* THE BULKHEAD, with the lift lobby left open — the player walks out of
   * it and, later, back into it. */
  const bz = DECK.aft + 4;
  const lw = LIFT.lobby.w / 2 + 0.8;
  for (const s of [-1, 1]) box(s * (lw + 60), R / 2, bz, 60, R / 2 + 4, 3.5);
  box(0, (R + LIFT.lobby.h) / 2 + 1, bz, lw + 2, (R - LIFT.lobby.h) / 2, 3.5);
  /* The lobby's own jambs and header, so the recess is a slot and not a gap. */
  for (const s of [-1, 1]) box(s * (lw + 0.4), LIFT.lobby.h / 2, bz + 1.6, 1.2, LIFT.lobby.h / 2 + 1, LIFT.lobby.depth / 2 + 0.6);
  /* THE SHUTTLE PADS, low enough to step onto and solid enough to stand on. */
  /* Pad A is LOW — 0.45 m, under the player's 0.45 m step, so he walks up
   * onto it and up the ramp of the hull that stands on it. Pad B keeps its
   * height: nothing on it is anybody's to board. */
  /* THE PADS ARE DISCS, so their colliders are: six slabs a twelfth of a
   * turn apart, each the disc's diameter long and just wide enough that
   * its corners sit ON the drawn edge — their union is a twelve-pointed
   * plate that never reaches past the disc. (Three rotated SQUARES were
   * tried first: their union is a star whose points reach 1.4 r, and every
   * man who walked off the drawn pad stood inside a collider he could not
   * see and was thrown by the solver.) `deckFloorAt` answers the same disc.
   */
  const disc = (cx, cy, cz, r, hy) => {
    const half = r * Math.cos(Math.PI / 12);
    const wide = half * Math.tan(Math.PI / 12);
    for (let i = 0; i < 6; i++) {
      const yaw = (i * Math.PI) / 6;
      P.addStaticBox(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(half, hy, wide),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), { friction: 0.7 });
    }
  };
  disc(DEPLOY_RAMP.x, PADS.a.h / 2, DEPLOY_RAMP.padZ, PADS.a.r, PADS.a.h / 2);
  disc(PADS.b.x, PADS.b.h / 2, PADS.b.z, PADS.b.r, PADS.b.h / 2);
  /* THE PIT: four kerbs, so a player can walk to the edge and look in but
   * cannot fall into a hole with no floor authored under it. */
  for (const [dx, dz, w, d] of PIT_KERBS) box(dx, 0.5, dz, w / 2, 0.5, d / 2);
  world._deckSolids = 2 + 1 + 3 + 2 + 2 + 4;
}

/**
 * ══ THE LIGHT ═════════════════════════════════════════════════════════════
 *
 * HIGH-KEY WHITE, WHICH IT WAS NOT. Every reference is pale grey steel under
 * white light — `hangar 1` and `5` are nearly white rooms with a black floor.
 * The first rig lit a mid-grey wall with steel-blue lamps under a navy fog
 * and a navy ambient, and the room came out one dark blue from the plate to
 * the lid. Three things carry the lightness now, because the cel pipeline
 * has no specular to catch a lamp and a surface is exactly its albedo times
 * what falls on it:
 *
 *   THE ALBEDO      `DeckKit.FACTION_PALETTE` — the walls are pale.
 *   THE LAMPS       white (warm for the Republic, cool for the Separatists),
 *                   a few of them and WIDE. Point lights under the cel model
 *                   fall off hard on a floor, so there are ten down the room
 *                   at gallery height, thirty metres off the walls, rather
 *                   than fourteen small ones at the bays' feet.
 *   THE AIR         the fog is the wall's own pale grey, set here rather than
 *                   in the level record, so the far end of the room dissolves
 *                   into the haze `hangar 3` and `6` have and not into a void.
 *                   Density is `HANGAR_LEVEL`'s.
 *
 * THE KEY IS STILL THE APERTURE: a steep white directional from the opening,
 * so the floor's lit band is the planet's side and a wall is on the shadow
 * band in the key's own colour. A flat white ambient lifts the shadow band to
 * the pale the references show; the floor's near-black albedo keeps it a
 * mirror under the same light.
 */
function lightDeck(world) {
  const sep = world._deckFaction === 'separatist';
  /* The temperature swaps with everything else: warm white on the Republic
   * deck, blue-white on the Separatist one — a few hundred kelvin apart. */
  const KEY = sep ? 0xe6eeff : 0xfff6ea;
  const LAMP = sep ? 0xdae8ff : 0xfff3e2;
  const AIR = sep ? 0x6c7784 : 0x7b7974;
  const AMB = sep ? 0xb8c4d4 : 0xcfcac2;
  const key = new THREE.DirectionalLight(KEY, 1.5);
  key.position.set(0, 150, DECK.lip * 0.85);
  key.target.position.set(0, 0, DECK.aft * 0.35);
  world.scene.add(key); world.scene.add(key.target);
  world.levelLights.push(key);

  /* THE FLAT FILL, and it is what makes a wall the key does not face read
   * pale rather than navy: the engine's hemisphere is the level record's
   * `skyColor`, authored dark for the old room, and under the cel model the
   * ambient is one flat colour on everything, so this is the colour of every
   * shadow on the deck. */
  const amb = new THREE.AmbientLight(AMB, 0.38);
  world.scene.add(amb); world.levelLights.push(amb);

  /* THE AIR: the fog takes the wall's colour. Set on the scene the engine
   * built at stage 4 — the record's own `fogColor` is what a check reads,
   * and the density is its. */
  if (world.scene.fog) {
    world.scene.fog.color.set(AIR);
    world.engine?.skyDome?.setHaze?.(world.scene.fog.color, world.scene.fog.color);
  }

  /* THE BULKHEAD WASH, over the lift lobby, small and high. */
  const fill = new THREE.PointLight(LAMP, 260, 60, 2);
  fill.position.set(0, 22, DECK.aft + 10);
  world.scene.add(fill); world.levelLights.push(fill);

  /**
   * THE RANKS: five a side at gallery height, standing thirty metres off the
   * walls so the nearest slab gets about half a unit and nothing blows out,
   * plus two out toward the aperture. Twelve, well inside what a forward
   * renderer takes — three.js compiles the count into every shader.
   */
  for (let i = 0; i < 5; i++) {
    const z = DECK.aft + 30 + i * 44;
    for (const s of [-1, 1]) {
      const l = new THREE.PointLight(LAMP, 620, 130, 2);
      l.position.set(s * 44, 34, z);
      world.scene.add(l); world.levelLights.push(l);
    }
  }
  for (const s of [-1, 1]) {
    const l = new THREE.PointLight(KEY, 480, 110, 2);
    l.position.set(s * 40, 30, 124);
    world.scene.add(l); world.levelLights.push(l);
  }
}

export const __deckParts = {
  field: addField,
  /**
   * AND `structure` TAKES A WORLD, like everything else in this table.
   *
   * `dressStructure(kit, paint)` was put here raw, and `deckcost.mjs` calls
   * every entry as `fn(world, materials)` — so the one pass that actually
   * builds the room reported `THREW kit.slabAt is not a function` and had done
   * since the rebuild. The check still passed, because its job is to print a
   * cost breakdown rather than to assert one, so the single largest number in
   * the room's budget has been the word THREW in a green line.
   */
  structure: (world) => {
    const kit = new DeckBuild(world._deckFaction || deckFaction(world));
    const paint = new Paint(kit.faction);
    dressStructure(kit, paint);
    kit.build(world);
    paint.build(world);
  },
};

/** The one dress entry the level record names. */
export function dressHangar(world) {
  addField(world);
  /* ONE BUILDER AND ONE PAINT SHOP FOR THE WHOLE ROOM — twenty rack bays with
   * a fighter in each, seven overhead rigs, two catwalks and the bulkhead come
   * out as six meshes and three. */
  const faction = deckFaction(world);
  world._deckFaction = faction;
  const kit = new DeckBuild(faction);
  const paint = new Paint(faction);
  dressStructure(kit, paint);
  world._deckKit = kit.build(world);
  world._deckPaint = paint.build(world);
  lightDeck(world);

  /**
   * ══ AND THE ROOM IS SOLID, WHICH NONE OF IT WAS ═══════════════════════
   *
   * `DeckBuild.build` pushes its merged meshes onto `world.statics`, and
   * `world.statics` is read in exactly one place in this project: the
   * disposal loop in `World.unload`. Nothing created a collider for any of
   * it. The player walked straight through both rack walls, a hundred and
   * forty parked fighters, the bulkhead facing, the catwalks, the crate
   * clusters, the shuttles and the pit, and was stopped only by the four
   * barrier boxes out at the field.
   *
   * "Physics on everything, in the hangar" is a line of the brief, and a room
   * you can walk out of the back of is not a room. The colliders are declared
   * HERE, beside the geometry that needs them, rather than derived from the
   * merged meshes — a merge has thrown away the part boundaries by the time
   * anything could read them, and a single bounding box round a merged wall
   * would be a box round the whole room.
   */
  deckColliders(world);

  /**
   * LOOSE CRATES, and they are loose on purpose: `_grippableBody` takes a
   * PROP-layer dynamic body, so these are what the player picks up and throws
   * at the field. They cannot go in the kit — a merged crate cannot be
   * gripped.
   *
   * AND THEY ARE WITHIN THROWING RANGE, WHICH THEY WERE NOT. The six sat
   * 73–114 m from the nearest field plane against a measured hurl of 45.6 m,
   * so "pick up crates and throw them at the shield" — a brief line, and the
   * one bit of play the room actually had — could not be done from where any
   * of them stood. You had to carry one seventy metres first. Three are on
   * the apron near the lip now, inside one throw of the forward field, and
   * three stay back by the line so there is something to shove near the men.
   */
  for (const [x, z] of [
    /* MEASURED, NOT GUESSED: `deckplay` throws one and reports how far it
     * actually goes — 27.7 m off a 40 m/s hurl. From z = 112 that lands 4 m
     * short of a lip at 144, which is the same "you have to carry it seventy
     * metres first" defect one order of magnitude smaller. From 122 it goes
     * through. */
    [26, 122], [31, 118], [-28, 124],
    [26, -66], [-24, -66], [20, -30],
  ]) {
    makeCrate(world, new THREE.Vector3(x, 0.5, z), 0.9);
  }

  /* AND THE COMPANY IS ALREADY WALKING IN when the room opens. The player's
   * first frame on the deck is his men coming through the doors, not an empty
   * floor with a button on it — "the filing in sells it more than the
   * standing", and it cannot sell anything if it has already happened. */
  /**
   * ══ THE WINDOW, AND IT IS THE THEATRE THE PLAYER PICKED ═══════════════
   *
   * This is the whole reason the room can exist: the deck is a foreground and
   * the view is the scene. `SkyDome.configureOrbit` puts a planet, a starfield
   * and a fleet action into the dome's own fragment for ZERO new draw calls,
   * and it derives every colour in them from a level record — the land off
   * `sandColor`, the highlands off `rockColor`, the sea off `water.deep`, the
   * cloud deck off the atmosphere block, the limb off `skyColor`.
   *
   * SO IT IS SET HERE AND NOT ON THE LEVEL. `HANGAR_LEVEL.atmosphere` is
   * applied at load and would hard-code one world; what is wanted is the one
   * the player has selected in the menu, so picking the ice map really does put
   * an ice world outside. `dressHangar` runs at stage 6, after
   * `applyAtmosphere` at stage 4, so this is the last word.
   */
  /* THE TRANSPORT ON ITS PAD — the real hull, ramp down — before the men, so
   * a company arriving on it has a bay to be stood in. */
  /* `_deckArrival` is main.js's flag; `run.deckArrival` is a check's,
   * because a headless boot has no hook between construction and dressing. */
  if (world.run?.deckArrival) world._deckArrival = true;
  /* THE FLOOR, before anything stands on it: the transport's ramp, the
   * company's bodies and the crowd's all read `world.floorAt`. */
  world.floorAt = (x, z) => deckFloorAt(world, x, z);
  dressDeckFlight(world, { arrival: !!world._deckArrival });
  /* THE COMPANY, because the window's faction comes off the roll that is
   * actually standing in the room. */
  callTheCompany(world);
  /* AND IF THEY CAME HOME ON THE SHIP, THEY ARE STILL IN IT. */
  if (world._deckArrival) embarkCompany(world);
  const shown = outsideLevel(world);
  /**
   * ══ `skyDome`, NOT `sky`. ONE WORD, AND IT COST THE WHOLE VIEW ══════════
   *
   * `engine.sky` is three's Preetham `Sky` mesh (`Engine.js:2059`) and it has
   * no `configureOrbit`. The orbit window lives on `engine.skyDome`
   * (`Engine.js:2065`). The optional call swallowed the miss in silence, so
   * `SkyDome._orbit` stayed null, `uOrbit` stayed 0, and with
   * `atmosphere.sky === false` the dome was never even visible: beyond the
   * field there was `bgColor` and nothing else.
   *
   * There has never been a planet, a starfield, a fleet, a turbolaser or a
   * dying capital ship in this room. Seventeen bullets of `HANGAR-SPEC.md`
   * were ticked against a shader that has never once run in the game.
   *
   * It survived because `tools/checks/_coop.mjs`'s stub engine has NEITHER
   * property, so the suites took the same silent no-op path the browser did,
   * and because the numbers in the spec were measured by `_orbitprobe.mjs`,
   * which builds a `SkyDome` by hand and calls this method on it directly. A
   * probe that constructs the subject cannot test the wiring to it.
   *
   * AND THE FACTION GOES WITH IT. `SkyDome` colours the friendly bolts blue
   * and the hostile ones red off `spec.faction`; with none passed, a
   * Separatist player would have watched his own fleet fire Republic-blue.
   */
  world.engine?.skyDome?.configureOrbit?.({
    level: shown,
    terrain: TERRAIN_PRESETS[shown?.terrain],
    /* THE ROOM'S ONE ANSWER, not a third opinion. `deckFaction` is what the
     * kit, the paint, the insignia, the lights and the PA all read. */
    faction: world._deckFaction,
    /**
     * ══ IN THE OPENING, NOT OVER THE BULKHEAD ══════════════════════════════
     *
     * The deck's one aperture faces +Z and the player faces it when the lift
     * doors part. `SkyDome._placeByPhase` used to spend the free roll about the
     * star on elevation alone, and the disc landed 167° behind him on every
     * theatre — a planet the room was designed around that nobody in it could
     * see. `forward` is the opening's own axis; `rise` puts the disc's centre
     * about 13° up, so its lower limb sits on the lip and the rest fills the
     * hexagon from the muster line, and fills the whole view from the edge.
     */
    forward: [0, 0, 1],
    rise: 0.22,
  });

  /**
   * ══ AND THE ORDER WHEEL OPENS, BECAUSE THERE IS SOMETHING TO OPEN IT ═══
   *
   * `HUD.update` gates the wheel on `world.command`, which `World` assigns
   * below its own early return for this level — so the deck had none, the
   * wheel could never be built, `main.orderKeys` returned on its first line,
   * and every one of `DECK_ORDERS` was unreachable by any input the game has.
   */
  world.orders = deckCommand(world);
  world.deckBladeTargets = (mid) => deckBladeTargets(world, mid);

  /* THE ROOM'S SOUND, and it is not decoration: the pressure differential at
   * the field is measured at −12.1 dB A-weighted from the spawn to the lip,
   * with the energy under 200 Hz going 90% → 99%. Walking toward the shield
   * audibly changes, which is the one thing that says a wall of light is
   * holding out vacuum. */
  /* THE SAME ANSWER AGAIN. This read `_company?.army`, which is undefined for
   * a player with no roll — so a fresh save got the default PA voice on a deck
   * that had already been built in the other faction's colours. */
  dressDeckAudio(world, { army: world._deckFaction });
  /* AND THE ROOM WORKS. Droids on three jobs, a trolley on the gantry, a tech
   * welding, a sled crossing, crew as silhouettes in the haze, vents, and the
   * field reacting to what hits it. Measured at 0.016 ms of frame at steady
   * state with 46 dynamic props on the deck, and nothing in the step allocates.
   *
   * THE HAZE IS THE PIECE THAT MATTERS MOST and it is the cheapest: far rows
   * dissolve, so the deck never has to model what is behind them. */
  dressDeckLife(world);
  /**
   * AND THE LIFT, WHICH IS WHERE THE PLAYER ACTUALLY IS. The spawn is inside
   * the car; `DeckLift` runs the ride, parts the doors, and later takes him
   * back up to the menu. A player who came in on a ship (`_deckArrival`) is
   * not in it, so the car simply stands open.
   */
  dressDeckLift(world, { arrive: !!world._deckArrival });
  /* THE BLACK MIRROR — rule 2 of the references, a real planar reflection of
   * the room in its own plate. `DeckMirror` decides whether the fidelity tier
   * can afford it. */
  dressDeckMirror(world);
}

/**
 * THE LEVEL. `DOJO_LEVEL` is the template for every field here and the two
 * differ in exactly the ways this room differs from that one: no sky (both),
 * a background that is space rather than a dark room, and an atmosphere tuned
 * so the brightest thing in frame is outside the ship.
 *
 * NOT IN `LEVEL_ORDER`, deliberately. A hangar is not a theatre you can choose
 * to fight on, and putting it in the roster would subscribe it to forty-seven
 * level suites about weather, ground cover, spawn legality and generated
 * fronts, every one of which is about a battlefield. It gets its own checks
 * instead.
 */
export const HANGAR_LEVEL = {
  name: 'The Flight Deck',
  blurb: 'Your company, on the deck of the ship carrying them, with the war outside.',
  terrain: 'hangardeck',
  /**
   * ══ WHERE THE PLAYER ACTUALLY LANDS, WHICH WAS NOWHERE THIS ROOM MEANT ══
   *
   * This record declared no `start`, so `World._playerSpawn` fell through to
   * its literal default of `[0, 8]` and `Player` set the camera to yaw π —
   * which on this deck means the player arrived 56 m PAST his own company,
   * facing the aperture, with every man he came here to look at behind his
   * back and out of frame.
   *
   * `DECK.start` has been sitting in this file the whole time with the comment
   * "where the player is put down, looking forward down the length of it", and
   * `src/` read it nowhere: only `tools/_deckshot.mjs` did, by teleporting the
   * player there before taking a picture. So every screenshot this room has
   * ever been judged by was taken from a place the game does not put anyone.
   * That is the worst class of bug in this project — a test fixture standing
   * in for the thing it is supposed to be testing — and it is why a room whose
   * whole subject is a formation of men rendered as an empty floor.
   */
  start: [DECK.start.x, DECK.start.z],
  pool: [],
  groundColor: 0x474e58,
  spawnRadius: [6, 10],
  grass: 0,
  atmosphere: {
    /**
     * THE HAZE IS THE ROOM'S DEPTH AND IT WAS DOING NOTHING. At density
     * 0.004 the far end of a 250 m deck keeps 85% of its contrast — the racks
     * stayed crisp to the back wall and the room read flat. Worse, the colour
     * was 0x0a0f18, which is very nearly the background: fog that fades to
     * black is not haze, it is a fade-out.
     *
     * `HANGAR-SPEC.md` marks this bullet as not started and it was right.
     * Every reference has an obvious blue-grey atmosphere eating the far
     * ranks, and it is what lets a wall of fourteen bays read as a wall of
     * fifty. 0.011 puts the aft bulkhead at about a third contrast from the
     * lip, which is where `hangar 7.jpg` sits.
     */
    sky: false, bgColor: 0x05070c, fog: true, fogColor: 0x1b2636, fogDensity: 0.011,
    /**
     * ══ THE AMBIENT WAS PAINTING THE FLOOR ════════════════════════════════
     *
     * A hemisphere light's SKY half points straight down at a deck, so on a
     * flat floor it is the dominant term — and at 0.42 with a sky colour of
     * 0x6e88b8 it lifted a near-black plate to a pale grey sheen at every
     * grazing angle, which is where a player actually looks at a floor. The
     * plan shots proved it: from 46 m up, looking nearly straight down, the
     * same deck rendered BLACK. It was never the albedo, the map or the
     * metalness — it was the light.
     *
     * Every reference is lit by its own strips and by the aperture, with the
     * air between them dark. So the ambient is a fill of last resort here,
     * and the sixteen lamps down the ranks do the work.
     */
    /* 0.24: enough that a near-black plate is a surface rather than a hole,
     * far short of the 0.42 that was painting it pale. */
    sunColor: 0xbcd8ff, sunIntensity: 3.2, ambient: 0.24,
    /**
     * ══ 55 DEGREES, NOT 12 — THE ELEVATION WAS THE BLACK BAND ══════════════
     *
     * `elevation` is what `applyAtmosphere` gives the ENGINE's sun, and that
     * sun is the one with the shadow cascades on it: the deck key in
     * `lightDeck` never casts. At 12 degrees across a 250 m room every tall
     * thing in here — two 68 m rack walls, the shuttles, the overhead rigs —
     * threw a shadow the length of the ship, they merged, and the aft third
     * (where the player lands and where his line stands) was a black band with
     * a dead-straight cascade edge across it.
     *
     * I chased that band through the terrain map, the metalness, the ambient,
     * the deck lamps and the deck key before finding it in one number on the
     * atmosphere block. Each of those was a real defect and none of them was
     * this. A twelve-degree sun is a sunset, and this room is nose-on to a
     * star with the light coming down through an opening.
     */
    skyColor: 0x39485f, groundColor: 0x191d23, elevation: 55, azimuth: 0,
      /* COOL, like everything else. The warm bounce was invented. */
    fillColor: 0x93b2dc, fillIntensity: 0.30,
    /**
     * BLOOM 0.30, NOT 0.75. `tools/checks/saber-bloom.mjs` measured the curve:
     * the blown-white run across a blade is 16 px at 0.30 and 14 px at 0.26
     * against a 13 px floor with the pass switched off entirely, so past about
     * 0.30 it has flattened and everything above is spend with nothing bought.
     * I typed 0.75 reaching for the glow around the light strips; the strips
     * are unlit materials at full white and they do not need it.
     */
    exposure: 1.2, bloom: 0.30, saturation: 1.02,
    lift: [0.004, 0.006, 0.012], gain: [0.98, 1.0, 1.08],
  },
  /* A DECK IS NOT SILENT AND IT HAS NO WIND. The bed is the hull: a low drone
   * with almost nothing above it, so a footstep on plate is the loudest thing
   * in the room and the field's hush at the lip is audible. */
  ambience: { wind: 0.0, windFreq: 90, drone: 0.20 },
  /* Deck grit in the light shafts, cool and sparse. */
  dust: { count: 320, color: 0xb8c6dd, opacity: 0.10, size: 12 },
  dress: dressHangar,
};

/**
 * ══ A DIRECTOR THAT DIRECTS NOTHING ═══════════════════════════════════════
 *
 * There is no wave on the deck, no enemy, no ending and no score. This exists
 * for one reason: `HUD.update` reads `world.director.wave`, `.active`,
 * `.intermission` and `.state()` with no optional chaining, because until this
 * room there has never been a world without a director for it to have been
 * written against. Four fields and an empty `update` is a smaller and safer
 * change than putting four `?.` into the shipped HUD for one place.
 *
 * IT IS NOT A `WaveDirector` SUBCLASS, deliberately. Inheriting one would give
 * this room a spawn queue, a budget curve, an intermission clock and a
 * liveness watchdog, every one of which is a thing that could go off in a
 * place whose whole promise is that nothing happens in it unless you ask.
 */
export class HangarDirector {
  constructor(world) {
    this.world = world;
    this.wave = 0;
    this.active = false;
    /* Not 0 and not Infinity: `HUD` prints `Math.ceil(intermission)` as "to
     * next wave" under 900 and the word "attune" over it, and neither sentence
     * is true here. The HUD is hidden on the deck anyway; this is what it says
     * if it is ever shown. */
    this.intermission = 1e9;
    this.done = false;
    this.roster = null;
  }

  state() { return { progress: 0, need: Infinity }; }

  /**
   * THE ONE THING ON THIS DECK THAT MOVES BY ITSELF. `World.update` steps the
   * director every frame and this is the only hook the room has that is not a
   * body or a prop — the company walking in, halting and breathing goes
   * through here.
   */
  /**
   * WALKING OFF THE DECK HAS TO TAKE THE DECK'S SOUND WITH IT.
   *
   * `undressDeckAudio` was imported at the top of this file and called from
   * nowhere in `src/`. `World.unload` disposes statics and lights and knows
   * nothing about a twenty-five node hull-hum graph, and `world._deckAudio`
   * was never nulled — so the bed kept running after the player was back on
   * the menu, and `dressDeckAudio`'s own guard would have refused to build it
   * again if the same `World` were ever re-dressed.
   *
   * `World.unload` calls `director.dispose?.()`; this is that hook.
   */
  dispose() {
    try { undressDeckAudio(this.world); } catch {}
    try { undressDeckLift(this.world); } catch {}
    try { undressDeckMirror(this.world); } catch {}
    try { undressDeckFlight(this.world); } catch {}
    if (this.world.floorAt) this.world.floorAt = null;
    if (this.world.deckBladeTargets) this.world.deckBladeTargets = null;
    this.world._deckAudio = null;
    dismissCompany(this.world);
  }

  update(dt) {
    stepRamp(this.world, dt);
    stepStrobes(this.world, dt);
    stepCompany(this.world, dt);
    /**
     * AFTER THE COMPANY, AND THE ORDER IS LOAD-BEARING. `stepCompany` ends
     * each man with `merged.update`, which carries a moved material colour
     * into the merged buffer — and the paint wash writes that buffer directly.
     * Stepped before it, every frame of the sweep is overwritten by a flat
     * colour and "paint as a sweep, not a pop" quietly becomes a pop again.
     */
    stepDeckEdit(this.world, dt);
    /* AFTER the listener has moved, which is `World.update`'s own ordering —
     * the pressure filter and every Doppler ratio are functions of where the
     * player is standing THIS frame. */
    stepDeckLife(this.world, dt);
    stepDeckLift(this.world, dt);
    stepDeckMirror(this.world, dt);
    /* THE SHIP, after the men: a man who halted on his slot this frame is
     * taken aboard this frame. */
    stepDeckFlight(this.world, dt);
    stepDeckAudio(this.world, dt, this.world?.player?.camera?.obj || this.world?.player);
    /**
     * AND THE THUMPS ARE THE FLASHES YOU SAW.
     *
     * `SkyDome` pushes every explosion outside onto `ground.orbit.events` with
     * its own strength and delay, capped at twelve, and NOTHING drained it —
     * so the queue rotated for ever and the muffled thump a player heard came
     * off an independent random timer, uncorrelated with any blast in the
     * window. `HANGAR-SPEC.md` ticked that bullet while its own last sentence
     * said "nothing drains it yet".
     */
    drainBlasts(this.world);
  }
}


/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE COMPANY, ON THE DECK — and the crowd it comes out of                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE MEN WALK ON — FROM THE CROWD ══════════════════════════════════════
 *
 * "When I call my troops I want them to file in from the background like
 *  imagine that the hangar is already full of troopers and mine hear the
 *  order and come in from the crowd."
 *
 * So the deck is full of troopers before the player says a word: ranks formed
 * up at port arms by the starboard wall the way `hangar 3.jpg` has them,
 * clusters standing easy at the crate stacks, a few walking their errands
 * between the racks. The player's own men are IN that crowd — each standing
 * at a spot of his own among the others, at attention, facing whichever way
 * he happened to be facing — and they are told apart by nothing but the fact
 * that they answer. FALL IN and they leave the crowd and walk to the line;
 * DISMISSED and they walk back into it.
 *
 * ── AND THEY ARE ALL THE NEXT DEPLOYMENT, ON A FRESH SAVE TOO ────────────
 *
 * "I couldn't customize or see my troops in the hangar on a fresh run, it
 *  wanted me to finish a mode first but I specifically asked that I be able to
 *  spawn in fresh troops at the very beginning for customization."
 *
 * `callTheCompany` used to read only the roll — the men who had come BACK
 * from a run — and a fresh save has none, so it said so and stood nobody.
 * The muster slate has existed the whole time (`Muster.js`): the fresh half
 * of the next deployment, minted in advance with real designations, shown on
 * the Company tab, and never once read by this room. It is read now, through
 * the same resolver the tab and the deploy path use, so the men on the deck
 * are exactly the men who ride the transport: veterans first, recruits behind
 * them, the player's picks honoured. A recruit's edits go to the slate's own
 * dressing door (`DeckEdit.applyEdit`), and the slate keeps a dressed recruit
 * across a re-mint (`Muster.ensure`), so what is painted here survives.
 *
 * ── THE WALK IS A WALK ───────────────────────────────────────────────────
 *
 * The previous version slid the figure across the deck in its standing pose.
 * Each man carries the gait solver a fighting body carries (`BipedAnimator`),
 * and while he is between spots the solver walks him — legs cycling, arms
 * swinging, pelvis bobbing — from a world-space position this file owns,
 * with the figure's root at the origin the way an `Enemy`'s is. When he
 * halts the root is put on his mark and `Parade` takes the pose back. The
 * hand-off is a snap, and a halt IS a snap.
 */
export const MUSTER = {
  /** Between two men of the same squad. */
  interval: 2.1,
  /** Between one squad and the next. Deliberately more than double. */
  gap: 5.4,
  /** How far apart the ranks are if the company needs two. */
  depth: 2.8,
  /** Men in one rank before it wraps. Past this a line stops being legible. */
  perRank: 12,
  /**
   * Seconds from the order to the last man halting. Fourteen, from eight and
   * a half: the walk is from the crowd at the wall now, sixty-odd metres for
   * the far man, and eight seconds of that is a sprint. A company called to
   * the line walks briskly; it does not run.
   */
  formUp: 14,
  /** A man leaves the crowd within this many seconds of the order. */
  spread: 2.6,
};

/**
 * THE PACE, off `MUSTER.formUp` and the longest walk in the room rather than
 * typed: the far corner of the crowd to the far end of the widest line.
 */
export const MARCH_SPEED = (() => {
  const wide = (MUSTER.perRank - 1) * MUSTER.interval / 2 + MUSTER.gap * 2;
  const far = Math.hypot(DECK_ZONES.crowdR.x1 - (-wide), DECK.line - DECK_ZONES.crowdR.z0);
  return far / Math.max(1, MUSTER.formUp - MUSTER.spread);
})();

/** Where man `i` of `n` stands, by squad. Pure, so a check can ask it. */
export function markFor(i, n, squad, squads) {
  const wide = Math.min(n, MUSTER.perRank);
  const rank = Math.floor(i / MUSTER.perRank);
  const col = i % MUSTER.perRank;
  /* THE SQUAD GAPS ARE PART OF THE WIDTH, or the line is not centred. */
  const gaps = Math.max(0, (squads | 0) - 1) * (MUSTER.gap - MUSTER.interval);
  const span = (wide - 1) * MUSTER.interval + gaps;
  const before = Math.max(0, squad | 0) * (MUSTER.gap - MUSTER.interval);
  return {
    x: -span / 2 + col * MUSTER.interval + before,
    z: DECK.line + rank * MUSTER.depth,
  };
}

/**
 * ══ THE CROWD'S GROUND ════════════════════════════════════════════════════
 *
 * Spots in `DECK_ZONES.crowdL/crowdR`, three kinds:
 *
 *   BLOCK    a formed body, three ranks deep by the starboard wall, at port
 *            arms, facing the deck — `hangar 3.jpg`'s subject.
 *   CLUSTER  three or four men standing round a crate stack, facing in.
 *   LOOP     a pair of points a man walks between, along the wall.
 *
 * The player's own men are dealt the block and the clusters — never a loop,
 * because a man who has to be found should be standing still — and the crowd
 * takes what is left. Everything is derived from the zone so the crowd moves
 * with the walls.
 */
export const CROWD = {
  /** Other troopers on the deck besides the player's own. */
  n: 18,
  /** The formed block: ranks and files. */
  block: { ranks: 3, files: 5, pitch: 1.5, depth: 1.6 },
};

function crowdSpots(rng) {
  const L = DECK_ZONES.crowdL, R = DECK_ZONES.crowdR;
  const spots = [];
  /* THE BLOCK, at the starboard wall, facing -x into the room. */
  const B = CROWD.block;
  const bx = R.x1 - 12, bz = (R.z0 + R.z1) / 2 - 6;
  for (let r = 0; r < B.ranks; r++) {
    for (let f = 0; f < B.files; f++) {
      spots.push({ x: bx + r * B.depth, z: bz + (f - (B.files - 1) / 2) * B.pitch,
        facing: -Math.PI / 2, kind: 'block', arms: 'port', stance: 'attention' });
    }
  }
  /* CLUSTERS, at the crate stacks on both flanks and the blast doors. */
  const groups = [
    { x: L.x0 + 14, z: L.z1 - 12, n: 4 }, { x: L.x0 + 30, z: L.z0 + 10, n: 3 },
    { x: (L.x0 + L.x1) / 2, z: L.z1 - 2, n: 3 }, { x: R.x0 + 12, z: R.z1 - 8, n: 4 },
    { x: R.x1 - 12, z: R.z1 - 4, n: 3 }, { x: L.x1 - 6, z: L.z0 + 12, n: 3 },
  ];
  for (const g of groups) {
    for (let i = 0; i < g.n; i++) {
      const a = (i / g.n) * Math.PI * 2 + rng() * 0.6;
      const r = 1.3 + rng() * 0.5;
      spots.push({ x: g.x + Math.cos(a) * r, z: g.z + Math.sin(a) * r,
        facing: a + Math.PI, kind: 'cluster', arms: 'sides', stance: 'ease' });
    }
  }
  /* LOOPS, along the walls. */
  const loops = [
    [[L.x0 + 8, L.z0 + 4], [L.x0 + 10, L.z1 - 2]],
    [[R.x0 + 4, R.z0 + 6], [R.x1 - 30, R.z1 - 4]],
    [[L.x1 - 4, L.z0 + 2], [L.x0 + 20, L.z1 - 20]],
    [[R.x1 - 6, R.z0 + 2], [R.x1 - 8, R.z1 - 14]],
  ];
  for (const [a, b] of loops) {
    spots.push({ x: a[0], z: a[1], facing: Math.atan2(b[0] - a[0], b[1] - a[1]),
      kind: 'loop', loop: b, arms: 'port', stance: 'attention' });
  }
  return spots;
}

/**
 * ══ WHO STANDS HERE: THE NEXT DEPLOYMENT ══════════════════════════════════
 *
 * The plan the barracks and the deploy path both use, resolved for the mode
 * the player will ride out to. `main.js` hands the room the theatre it will
 * fight on (`_pickedLevel`) and the mode (`_pickedMode`); a headless boot has
 * neither, and a mode that fields no army (a duel, a lesson) still has to put
 * MEN on this deck — it is the room the ask is about — so the fallback is the
 * campaign's own opening: ten strangers, minted for the army the player leads.
 */
function deckLineup(world, army) {
  const settings = { ...(world?.settings || {}), mode: world?._pickedMode || world?.settings?.mode };
  const company = companyLoad(army);
  let plan = null;
  try { plan = musterPlan(settings); } catch { plan = null; }
  if (plan && plan.army !== army) plan = null;
  let list = null;
  try { list = plan ? lineup(plan, company) : null; } catch { list = null; }
  if (!list || !list.length) {
    const fallback = { army, want: OPENING_STRENGTH, armyMode: true, unit: null, campaign: true };
    try { list = lineup(fallback, company) || []; } catch { list = []; }
  }
  /* A fresh save's roll is empty, and every man on the list is then a recruit
   * off the slate. The flag is what routes his edits to the slate's door. */
  const onRoll = new Set((company?.men || []).map((m) => m.designation));
  return list.slice(0, MAX_ON_DECK).map((rec) => ({ ...rec, recruit: !onRoll.has(rec.designation) }));
}

/**
 * A crowd trooper's record: the army's cheapest rung, a few of the second, a
 * rank here and there so the paint varies, an occasional mark. Seeded, so
 * the same deck stands the same crowd.
 */
function crowdRecords(army, n, rng) {
  const A = ARMIES[army];
  const tiers = A?.tiers || [];
  const t0 = tiers[0]?.type || 'trooper';
  const t1 = tiers[1]?.type || t0;
  const kind = army === 'separatist' ? 'steel' : 'flesh';
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rng();
    const num = 100 + Math.floor(rng() * 8900);
    const designation = army === 'separatist' ? `OOM-${(10 + i * 3) % 90}` : `CT-9${String(num).padStart(3, '0')}`;
    const xp = r < 0.62 ? 0 : (r < 0.86 ? 5 : (r < 0.97 ? 11 : 21));
    out.push({
      id: null, army, type: rng() < 0.82 ? t0 : t1, designation, kind,
      xp, kills: 0, wounds: rng() < 0.2 ? 1 : 0, morale: 0.72, areas: 0, joined: 1,
      look: rng() < 0.3 ? { mark: MARKS[Math.floor(rng() * MARKS.length)]?.id } : null,
      crowd: true,
    });
  }
  return out;
}

/** A tiny seeded stream for the crowd, so a check gets the same room twice. */
function crowdRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * ══ STAND EVERYBODY UP ════════════════════════════════════════════════════
 *
 * Reads the next deployment through `Muster.lineup` and the crowd out of a
 * seeded table, builds a figure and a body for each, and puts them all in the
 * crowd. Nobody is on the line until the order is given.
 *
 * ONE ARMY AT A TIME, and never the other one as a fallback: the deck's
 * faction is `deckFaction`'s answer, and the men are that army's.
 */
export function callTheCompany(world, opts = {}) {
  const want = opts.army || world?._deckFaction || deckFaction(world);
  const men = deckLineup(world, want);
  const rng = crowdRng(opts.seed ?? 4711);
  const spots = crowdSpots(rng);
  const still = spots.filter((s) => s.kind !== 'loop');
  const loops = spots.filter((s) => s.kind === 'loop');
  /* Shuffle the standing spots once, so the company is scattered through the
   * crowd rather than filling the block front to back. */
  for (let i = still.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [still[i], still[j]] = [still[j], still[i]];
  }
  const company = {
    army: want, men: [], crowd: [], byMan: new Map(), t: 0, at: 0,
    stance: 'attention', mustered: false, dismissed: 0, halted: 0,
  };
  if (!men.length) {
    world.notify?.('NO ONE OF YOURS ABOARD',
      `Nobody on the ${want} roll and no muster minted for it.`, 'flavour');
  }

  /* THE SHAPE THE FIGHT WOULD DEAL THEM, not a fresh one. `squadPlan` is the
   * pure derivation the Company tab's order of battle already draws. */
  const plan = squadPlan(men, SQUAD);
  const bySquad = new Map();
  for (const [m, k] of plan) {
    if (!bySquad.has(k)) bySquad.set(k, []);
    bySquad.get(k).push(m);
  }
  const order = [...bySquad.keys()].sort((a, b) => a - b);
  let i = 0;
  const stand = (rec, spot, isCrowd) => {
    const fig = buildFigure(rec);
    if (!fig) return null;
    const man = paradeMan(fig.rig, { designation: rec.designation || rec.name || `m${i}` });
    /* THE FIGURE'S OWN GAIT, kept: `paradeMan` builds one to take its
     * measurements and throws it away. It is what walks him. */
    const anim = fig.rig?.get?.('thighL')
      ? new BipedAnimator(fig.rig, { scale: fig.rig.scale ?? 1 }) : null;
    man.facing = spot.facing;
    man.stance = spot.stance;
    man.arms = fig.rifle ? spot.arms : 'sides';
    fig.root.position.set(spot.x, 0, spot.z);
    fig.root.rotation.y = 0;
    world.scene.add(fig.root);
    const row = {
      rec, fig, man, anim, crowd: isCrowd,
      /** Where he stands in the crowd, and stands back in when dismissed. */
      home: { x: spot.x, z: spot.z, facing: spot.facing, stance: spot.stance, arms: spot.arms },
      mark: { x: spot.x, z: spot.z },
      from: new THREE.Vector3(spot.x, 0, spot.z),
      pos: new THREE.Vector3(spot.x, 0, spot.z),
      vel: new THREE.Vector3(),
      start: 0, pace: 0.88 + ((stagger(man) * 7.13 + 0.37) % 1) * 0.26,
      halted: true, merged: null, squad: 0, lead: false,
      loop: spot.loop ? { a: [spot.x, spot.z], b: spot.loop, dwell: 3 + rng() * 6, at: 0 } : null,
    };
    /**
     * ══ HIS CAPE IS CLOTH ═══════════════════════════════════════════════════
     *
     * "are the capes for troopers even actual cloth like my capes? they look
     *  completely solid." The builder publishes the half-cape's rigid plates
     * and which shoulder they hang from; `Cloth.attachTrooperCape` hangs a
     * simulated sheet there and hides the plates. BEFORE the merge, because
     * the bake photographs what is visible and a plate that is hidden now is
     * left out of the fold — a plate baked in would stand under the cloth for
     * the life of the figure.
     */
    row.cape = null;
    if (fig.cape && world.scene) {
      try {
        row.cape = attachTrooperCape(world.scene, fig.rig, { scale: fig.rig?.scale ?? 1, ...fig.cape });
      } catch { row.cape = null; }
    }
    /* HE IS FOLDED WHERE HE STANDS. The bake is a photograph of the rig; the
     * gait keeps writing the bones under it, so a merged man still walks. */
    row.merged = mergeFigure(fig, { castShadow: true });
    return row;
  };
  for (const k of order) {
    const squad = bySquad.get(k);
    for (let j = 0; j < squad.length; j++) {
      const rec = squad[j];
      const spot = still.length ? still.shift() : { x: 30 + i * 2, z: -70, facing: Math.PI, kind: 'cluster', arms: 'port', stance: 'attention' };
      /* HIS OWN MEN WAIT AT PORT ARMS, whatever the spot's crowd would do:
       * a man who is about to be called stands ready, and it is what makes
       * him findable in a crowd standing easy. */
      const row = stand(rec, { ...spot, stance: 'attention', arms: 'port' }, false);
      if (!row) continue;
      row.squad = k;
      row.man.facing = spot.facing;
      company.men.push(row);
      company.byMan.set(rec.designation || rec.name, row);
      i++;
    }
    const lead = leadOf(bySquad.get(k).map((m) => ({ ...m, alive: true })));
    const row = company.men.find((r) => r.rec.designation === lead?.designation);
    if (row) row.lead = true;
  }
  /* THE CROWD takes the rest of the standing spots and every loop. */
  const crowdN = Math.min(CROWD.n, still.length + loops.length);
  const recs = crowdRecords(want, crowdN, rng);
  for (let c = 0; c < crowdN; c++) {
    const spot = still.length ? still.shift() : loops.shift();
    if (!spot) break;
    const row = stand(recs[c], spot, true);
    if (row) company.crowd.push(row);
  }
  /**
   * ══ AND THEY ARE BODIES ═════════════════════════════════════════════════
   *
   * One dynamic PROP-layer collider a man, asleep where he stands, so the
   * Force finds him and the player cannot walk through him. `Shovable`
   * refuses to fall over for a shoulder — see its POST rule — and goes over
   * for a push.
   */
  makeShovable(world, company.men);
  makeShovable(world, company.crowd);
  world._company = company;
  return company;
}

/** How many men the deck will stand at once. See `MergedSkin` for the cost. */
export const MAX_ON_DECK = 24;

/**
 * ══ ONE MAN, ONE FRAME ════════════════════════════════════════════════════
 *
 * Shared by the company and the crowd. A man is a BODY first — while the
 * solver has him the drawn figure copies the body — a WALKER second, and only
 * once he has halted does `Parade` pose him.
 */
/* The cloth, after the rig's matrices are current. `refreshColliders` reads
 * the bones it was pinned to; the wind on a deck is nought. */
const _noWind = new THREE.Vector3();
function stepCape(row, dt) {
  const cape = row.cape;
  if (!cape) return;
  try { row.fig.rig?.updateMatrices?.(); cape.update(dt, cape.refreshColliders(), _noWind); } catch {}
}

function stepRow(world, c, row, dt) {
  stepRowInner(world, c, row, dt);
  stepCape(row, dt);
}

function stepRowInner(world, c, row, dt) {
  const { fig, man } = row;
  /* IN THE HULL: the ship owns him. Posed where he stands, and nothing else. */
  if (row.aboard) {
    man.stance = 'attention';
    poseParade(man, c.t + stagger(man));
    row.merged?.update?.(c.t);
    return;
  }
  const sh = row.shove;
  if (sh) {
    sh.update(dt);
    if (sh.state !== 'post') {
      fig.root.position.copy(sh.at);
      fig.root.quaternion.copy(sh.quaternion);
      row.pos.copy(sh.at);
      if (sh.down) { row.merged?.update?.(c.t); return; }
      man.stance = 'ease';
      poseParade(man, c.t + stagger(man));
      row.merged?.update?.(c.t);
      return;
    }
  }
  const local = Math.max(0, c.t - row.start) * row.pace;
  const dx = row.mark.x - row.pos.x, dz = row.mark.z - row.pos.z;
  const dist = Math.hypot(dx, dz);
  if (!row.halted && dist > 0.12 && local <= 0) {
    /* HIS TURN HAS NOT COME. A staggered start (`sendCompany`, `depart`,
     * `putAshore` all set `start` in the future) is a man STANDING until
     * it does — it used to fall through to the halt below, which put him
     * on his mark at once, so a company "filing in from the crowd" was the
     * first man walking and everybody else teleporting to the line. */
    man.stance = row.crowd ? row.home.stance : 'ease';
    poseParade(man, c.t + stagger(man));
    row.merged?.update?.(c.t);
    return;
  }
  if (!row.halted && dist > 0.12 && local > 0) {
    /* ── THE WALK. A position this file owns, advanced at his own pace, and
     * the gait solver asked to put legs under it. The root stands at the
     * origin for exactly as long as the solver is writing world-space bones
     * under it. */
    const speed = MARCH_SPEED * row.pace;
    const step = Math.min(dist, speed * dt);
    let nx = dx / dist, nz = dz / dist;
    /* HE WALKS ROUND THE PLAYER, not through him. A man whose line crosses
     * the commander inside two metres sidesteps to whichever side the
     * commander is not on, and re-aims at his mark next frame; in the last
     * metre he takes his mark regardless, or a player standing on it would
     * have a man circling him for ever. Without this the file to the ramp
     * formed through the player standing at its foot. */
    const P = world.player;
    if (P && !P.riding && dist > 1.2 && !(row.slot && !row.path?.length)) {
      const px = P.position.x - row.pos.x, pz = P.position.z - row.pos.z;
      const along = px * nx + pz * nz;
      if (along > -0.2 && along < 1.8) {
        const lat = -px * nz + pz * nx;
        if (Math.abs(lat) < 0.9) {
          const side = lat >= 0 ? -1 : 1;
          const ax = nx - side * nz * 1.4, az = nz + side * nx * 1.4;
          const al = Math.hypot(ax, az) || 1;
          nx = ax / al; nz = az / al;
        }
      }
    }
    /* AND ROUND THE PIT, along its kerb. A straight line from the pad to a
     * crowd spot on the port side crosses the pit; the kerb is a metre high
     * and the body walked into it stayed in `Shovable`'s BACK state for
     * ever. A step that would land inside the pit's zone is turned along
     * the kerb toward the mark's side, and the corner is turned when the
     * next step is clear again. */
    {
      const Z = DECK_ZONES.pit, M = 1.2;
      const px = row.pos.x + nx * step, pz = row.pos.z + nz * step;
      if (px >= Z.x0 - M && px <= Z.x1 + M && pz >= Z.z0 - M && pz <= Z.z1 + M) {
        const x = row.pos.x, z = row.pos.z;
        if (x > Z.x1 || x < Z.x0) { nx = 0; nz = Math.sign(dz) || 1; }
        else { nz = 0; nx = Math.sign(dx) || 1; }
      }
    }
    row.pos.x += nx * step; row.pos.z += nz * step;
    /* THE FLOOR, AT A CLIMBING PACE. A pad's edge is a 0.45 m kerb and the
     * bay's floor is a metre over the ramp's foot; the feet are planted on
     * the true floor by the gait solver, and the root follows it at the
     * rate a man steps up or down, so a kerb is a step and not a pop. */
    const fy = floorY(world, row.pos.x, row.pos.z);
    row.pos.y = fy > row.pos.y ? Math.min(fy, row.pos.y + 2.4 * dt) : Math.max(fy, row.pos.y - 4.0 * dt);
    row.vel.set(nx * speed, 0, nz * speed);
    const facing = Math.atan2(nx, nz);
    if (row.anim) {
      fig.root.position.set(0, 0, 0);
      fig.root.quaternion.identity();
      row.anim.setFacing(facing);
      row.anim.update(dt, {
        position: row.pos, facing, velocity: row.vel, grounded: true,
        groundAt: (x, z) => floorY(world, x, z),
        crouch: 0, accelForward: 1, deferMatrices: false,
      });
    } else {
      fig.root.position.copy(row.pos);
      fig.root.rotation.y = facing;
    }
    /* He makes a noise doing it. `bootStride` integrates distance. */
    bootStride(world, row, row.pos, dt);
    /* The body walks with him, asleep, so the Force still finds him. */
    sh?.retarget(row.pos);
    row.merged?.update?.(c.t);
    return;
  }
  if (!row.halted && row.path?.length) {
    /* THE NEXT LEG of a path — the ramp's foot, then the bay. */
    row.mark = row.path.shift();
    row.from.copy(row.pos);
    row.start = c.t;
    return;
  }
  if (!row.halted) {
    /* THE HALT. The root goes onto the mark, the pose is Parade's again. */
    row.halted = true;
    row.pos.set(row.mark.x, floorY(world, row.mark.x, row.mark.z), row.mark.z);
    fig.root.position.copy(row.pos);
    fig.root.quaternion.identity();
    row.vel.set(0, 0, 0);
    sh?.retarget(row.pos);
    if (!row.crowd) {
      c.halted = (c.halted | 0) + 1;
      /* THE COMPANY HALTING IS ONE SOUND, not twenty-four. */
      if (c.halted === c.men.length) bootHalt(world, { x: 0, y: 0, z: DECK.line }, c.men.length);
    } else if (row.loop) {
      /* A walker rests at each end for a different while every time. */
      row.loop.at = c.t + row.loop.dwell + ((stagger(man) * 3.1) % 4);
    }
  }
  /* A WALKER SETS OFF AGAIN once he has stood long enough. */
  if (row.crowd && row.loop && c.t >= row.loop.at) {
    const to = (Math.abs(row.mark.x - row.loop.b[0]) < 0.1 && Math.abs(row.mark.z - row.loop.b[1]) < 0.1)
      ? row.loop.a : row.loop.b;
    row.mark = { x: to[0], z: to[1] };
    row.from.copy(row.pos);
    row.halted = false;
    row.start = c.t;
    row.loop.at = Infinity;
    return;
  }
  man.stance = row.crowd ? row.home.stance : c.stance;
  poseParade(man, c.t + stagger(man));
  row.merged?.update?.(c.t);
}

/**
 * ══ WHAT THE BLADE MEETS ON THE DECK ══════════════════════════════════════
 *
 * Every body on the deck that stands on a `Shovable` — the company, the
 * crowd, and anything another director pushes onto `world._deckProps` (the
 * crew and the droids) — offered to the blade solver as a prop: one capsule
 * the height of a man, plastoid-tough, whose `cut` declines (nobody on this
 * deck is severed) and whose `shatter` is the shove the Force uses. A man hit
 * with a lit blade goes over and gets up; the plate scars under the stroke
 * like any ground. Within `reach` of the blade's middle only, because the
 * solver is handed the list every swinging frame.
 */
const _bladeTargets = [];
const _bladeMid = new THREE.Vector3();
export function deckBladeTargets(world, mid, reach = 5) {
  const out = _bladeTargets;
  out.length = 0;
  const c = world?._company;
  if (mid) _bladeMid.copy(mid); else if (world?.player) _bladeMid.copy(world.player.position); else return out;
  const r2 = reach * reach;
  const offer = (row, tag, i) => {
    const sh = row?.shove;
    if (!sh || sh.down || row.aboard) return;
    const at = sh.at;
    if (at.distanceToSquared(_bladeMid) > r2) return;
    out.push({
      id: `deck-${tag}-${i}`,
      capsules: [{
        name: 'body',
        p0: new THREE.Vector3(at.x, at.y + 0.15, at.z),
        p1: new THREE.Vector3(at.x, at.y + 1.65, at.z),
        r: 0.32, toughness: 1.5,
      }],
      prop: {
        cut: () => null,
        shatter: (impulse, point) => {
          const dir = impulse && impulse.lengthSq() > 1e-4 ? impulse : _v.subVectors(at, _bladeMid);
          sh.shove(dir, 6.5);
          world.particles?.sparkBurst?.(point || at, null, 10, { speed: 5 });
        },
      },
      dead: false,
    });
  };
  if (c) {
    c.men.forEach((row, i) => offer(row, 'man', i));
    c.crowd.forEach((row, i) => offer(row, 'crowd', i));
  }
  const extra = world?._deckProps;
  if (extra) for (let i = 0; i < extra.length; i++) offer(extra[i], 'prop', i);
  return out;
}

/**
 * ══ THE FRAME ═════════════════════════════════════════════════════════════
 */
export function stepCompany(world, dt) {
  const c = world?._company;
  if (!c) return;
  c.t += dt;
  for (const row of c.men) stepRow(world, c, row, dt);
  for (const row of c.crowd) stepRow(world, c, row, dt);
}

/* `smoothstep` from MathUtil takes an edge pair; this is the 0..1 form. */
function smoothstepIn(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
void smoothstepIn;

/**
 * ══ AN ORDER, ON THE DECK ═════════════════════════════════════════════════
 *
 * The same verbs the fight has, which is the point of putting them here — the
 * deck is where the command interface is learned, in a place where getting it
 * wrong costs nothing. `ORDERS` here is deliberately NOT `Command.FORMATIONS`:
 * a formation is a shape a line fights in and these are things a company does
 * standing still.
 */
export const DECK_ORDERS = {
  fallin: {
    id: 'fallin', name: 'Fall in', blurb: 'Call the company out of the crowd and onto the line.',
    bark: 'COMPANY — FALL IN', stance: 'attention', muster: true,
  },
  ease: {
    id: 'ease', name: 'At ease', blurb: 'Feet apart, hands behind. They can breathe.',
    bark: 'STAND AT — EASE', stance: 'ease',
  },
  present: {
    id: 'present', name: 'Present arms', blurb: 'Weapons up to the vertical. The formal one.',
    bark: 'PRESENT — ARMS', stance: 'present',
  },
  salute: {
    id: 'salute', name: 'Salute', blurb: 'Each man on his own beat, inside a third of a second.',
    bark: 'COMPANY — SALUTE', salute: true,
  },
  sing: {
    id: 'sing', name: 'Sing out', blurb: 'The company gives voice. Their own, not yours.',
    bark: 'COMPANY — SOUND OFF', sing: true,
  },
  dismissed: {
    id: 'dismissed', name: 'Dismissed', blurb: 'They break off and go back into the crowd.',
    bark: 'COMPANY — DISMISSED', dismiss: true,
  },
};

/**
 * ══ THE DECK'S OWN DIRECTOR, AND IT EXISTS TO OPEN THE REAL WHEEL ═════════
 *
 * `HUD.update` builds the order wheel if and only if `world.command` or
 * `world.orders` is set. This is the smallest object the wheel and
 * `main.orderKeys` actually read, and it is deliberately NOT a
 * `CommandDirector`: that class carries a squad model, a refusal system,
 * runners, morale and a fight to hang them on.
 *
 * ORDER_REACH IS HONOURED. `HANGAR-SPEC.md`'s own line: "walk away from the
 * line and they cannot hear you." It is measured to the NEAREST man — so a
 * company scattered through a crowd can still hear a fall-in from the middle
 * of the deck, which is where a player who has just walked out of the lift
 * is standing.
 */
export function deckCommand(world) {
  return {
    /** `main.bank()` reads this and refuses a deck. See its note. */
    deck: true,
    orders: DECK_ORDERS,
    formation: 'fallin',
    selectedSquad: null,
    commander: null,
    squadsOf: () => [],
    readout: () => ({ force: [] }),
    order(id) {
      const p = world.player;
      const c = world._company;
      if (!c || !c.men.length) return false;
      let best = Infinity;
      for (const row of c.men) {
        const d = Math.hypot(row.pos.x - (p?.position?.x ?? 0), row.pos.z - (p?.position?.z ?? 0));
        if (d < best) best = d;
      }
      /* The fall-in carries across the deck — it is a shout and a PA call
       * both — everything else is said to a formed line at the fight's own
       * reach. */
      const reach = id === 'fallin' ? ORDER_REACH * 3 : ORDER_REACH;
      if (p && best > reach) {
        world.notify?.('TOO FAR', `${Math.round(best)} m — they cannot hear you from here`, 'alarm');
        return false;
      }
      this.formation = id;
      return deckOrder(world, id);
    },
  };
}

/** Send every man of the company walking to `marks[i]`, staggered. */
function sendCompany(c, marks) {
  for (let k = 0; k < c.men.length; k++) {
    const row = c.men[k];
    row.mark = { x: marks[k].x, z: marks[k].z };
    row.from.copy(row.pos);
    row.halted = false;
    row.start = c.t + (stagger(row.man) % 1) * MUSTER.spread;
  }
  c.halted = 0;
}

/** Give one. Returns false for an id nobody answers to. */
export function deckOrder(world, id) {
  const O = DECK_ORDERS[id];
  const c = world?._company;
  if (!O || !c) return false;
  if (O.muster) {
    /* FALL IN: out of the crowd and onto the line, in the fight's own
     * squad order. Given to a formed company it squares them up again. */
    const n = c.men.length;
    const squads = new Set(c.men.map((r) => r.squad)).size;
    const order = [...new Set(c.men.map((r) => r.squad))].sort((a, b) => a - b);
    const marks = c.men.map((row, k) => markFor(k, n, order.indexOf(row.squad), squads));
    sendCompany(c, marks);
    for (const row of c.men) { row.man.facing = Math.PI; row.man.arms = row.fig.rifle ? 'port' : 'sides'; }
    c.mustered = true;
    c.dismissed = 0;
    c.stance = 'attention';
  }
  if (O.stance && !O.muster) c.stance = O.stance;
  if (O.salute) {
    /* NOT ALL AT ONCE. Each man comes up on his own beat off his own seed,
     * inside about a third of a second. */
    for (const row of c.men) salute(row.man, c.t + (stagger(row.man) % 1) * 0.34);
  }
  if (O.dismiss) {
    /* BACK INTO THE CROWD, each to the spot he came from. */
    c.dismissed = c.t;
    c.mustered = false;
    c.stance = 'attention';
    sendCompany(c, c.men.map((r) => r.home));
    for (const row of c.men) { row.man.facing = row.home.facing; }
  }
  if (O.sing) {
    c.singing = 1;
    companySing?.(world, c.army, c.men.length);
  }
  world.notify?.(O.bark, `${c.men.length} ${c.men.length === 1 ? 'man' : 'men'}`);
  return true;
}

/* THE SINGING IS `DeckAudio`'s TO MAKE, and the seam stays even now that it
 * exists: the order must not fall over if a voice ever fails to build. */
let companySing = null;
export function setCompanySing(fn) { companySing = fn; }
setCompanySing(deckChant);

/**
 * Tear the company down: figures off the scene, bodies out of the world.
 * `World.unload` disposes statics and knows nothing about these.
 */
export function dismissCompany(world) {
  const c = world?._company;
  if (!c) return;
  for (const row of [...c.men, ...c.crowd]) {
    try { row.shove?.dispose(); } catch {}
    try { row.cape?.dispose?.(); } catch {}
    try { row.merged?.dispose?.(); } catch {}
    row.fig?.root?.parent?.remove(row.fig.root);
    try { row.fig?.rig?.dispose?.(); } catch {}
  }
  world._company = null;
}

/**
 * ══ WHICH WORLD IS OUTSIDE ════════════════════════════════════════════════
 *
 * The record is HANDED IN, never looked up, and that is the whole reason this
 * file does not import `Levels.js`: the pair was an import cycle for one
 * commit and it died with `Cannot access 'HANGAR_LEVEL' before
 * initialization` in one suite. `main.js` resolves the player's theatre and
 * stashes the RECORD on the world before the dressing runs.
 */
export function outsideLevel(world) {
  return world?._pickedLevel || world?.level || null;
}
