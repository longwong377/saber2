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
 * ── SO THIS IS NOT THAT ROOM, AND THE DIFFERENCE IS THE SHAPE ─────────────
 *
 * THERE IS ONE WALL AND IT IS BEHIND YOU. Everything else is field, deck, or
 * space. `TERRAIN_PRESETS.hangardeck` is 128 m across and the heightfield's own
 * edge IS the deck's edge, so the ship genuinely runs out under your feet —
 * nothing is hidden by a fog bank or closed off by a wall you are not meant to
 * look at, which is what every deleted interior was doing at its boundary.
 *
 * THERE IS NO CEILING. The enclosure overhead is a field plane 90 m up, and
 * the structure that reads as "inside" is a rank of spars that arc up and OUT
 * OF FRAME. A ceiling plane is the single thing this file must never grow.
 *
 * THE VIEW IS THE ROOM, NOT A WINDOW IN IT. The planet fills a third of the
 * sky, the deck is lit from outside by it, and the brightest surface in frame
 * is the shield. If the composition ever drifts back toward a big enclosed bay
 * with a view at one end, this is the Invisible Hand again and `Levels.js`
 * already recorded what happened to it: "a box with a window."
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
import { buildFigure, paradeMan, poseParade, salute, turnTo, stagger, STANCES } from './Parade.js';
import { mergeFigure } from './MergedSkin.js';
import { loadAll as companyLoadAll } from './Company.js';
import { dressDeckAudio, stepDeckAudio, undressDeckAudio, bootHalt } from './DeckAudio.js';
import { squadPlan, leadOf, SQUAD } from './Command.js';
import { propMaterials, addWall, addStatic, addGantry, addPipeRun, addCableRun,
  addCrateStack, addScaffold, addMachine, addTank, addStanchion, addLamp,
  makeConsole, makeCrate, addHullSection, addFloorSlab } from '../world/Props.js';

/* The deck runs from the bulkhead aft to the lip forward. Named rather than
 * inlined because six things below have to agree about where the room stops,
 * and `hangardeck.height` is the seventh. */
export const DECK = {
  /** Aft face of the bulkhead — the one wall. */
  aft: -46,
  /** The lip, on every other side: the heightfield's own edge at scale/2. */
  lip: 64,
  /** Where the player is put down, looking forward. */
  start: new THREE.Vector3(0, 0, -34),
  /** Where the line forms up, facing him. */
  line: -12,
  /** How high the overhead field sits. Read by the spars, which stop short. */
  roof: 90,
};

/**
 * THE FIELD. One material, four planes, and it is the only thing between the
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
      uWeave: { value: 0.06 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime; uniform float uPower; uniform float uWeave;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        /* THE FRESNEL IS THE WHOLE READ ON A PLANE. On a bubble the rim does
           the work; a flat field seen face-on has no rim, so what makes it
           visible at all is the grazing term plus the weave. Held low so the
           planet behind it is not washed out — the field is the brightest
           surface in the room and it still must not be the loudest. */
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
        float hexes = sin(vP.x * uWeave) * sin(vP.y * uWeave) * sin(vP.z * uWeave);
        float ripple = 0.5 + 0.5 * sin(vP.y * 0.10 - uTime * 0.9);
        float raw = fres * 0.62 + max(hexes, 0.0) * 0.20 + ripple * 0.06;
        float e = max(fwidth(raw) * 0.5, 0.004);
        float s1 = smoothstep(0.14 - e, 0.14 + e, raw);
        float s2 = smoothstep(0.34 - e, 0.34 + e, raw);
        float s3 = smoothstep(0.62 - e, 0.62 + e, raw);
        float band = (0.05 + s1 * 0.16 + s2 * 0.22 + s3 * 0.30);
        float a = band * uPower;
        gl_FragColor = vec4(uColor * (a * 1.9), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  mat.userData.saberNoInk = true;
  return mat;
}

/**
 * A field plane, and the invisible wall that goes with it.
 *
 * The barrier is a static box rather than terrain because the terrain's job
 * here is to END — see `hangardeck`. A player who walks into the field should
 * stop at it and be able to stand there looking out, which is the best view in
 * the scene and the one thing the composition is built to reward.
 */
function fieldPlane(world, mat, centre, size, quat) {
  const geo = new THREE.PlaneGeometry(size.x, size.y, 2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(centre);
  if (quat) mesh.quaternion.copy(quat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  world.scene.add(mesh);
  world.statics.push(mesh);
  return mesh;
}

/**
 * ══ THE SPARS — what makes it read as inside without a ceiling ════════════
 *
 * A rank of ribs springing from the deck edge and arcing up and INWARD, cut off
 * by the top of the frame long before they meet. That is the whole trick: the
 * eye completes an enclosure it is never shown, and the one plane that would
 * make it a box is never drawn.
 *
 * They stop at 62 m against the field's 90, so there is always sky between the
 * highest structure and the top of the shot. A spar that met its opposite
 * number would be an arch, and an arch is a ceiling with a hole in it.
 */
function addSpars(world, M) {
  const steel = M.darkSteel || M.metal;
  for (let i = 0; i < 7; i++) {
    const z = -30 + i * 15;
    for (const sx of [-1, 1]) {
      const pts = [];
      /* A quarter of an ellipse, 60 m of run against 62 of rise, leaning in
       * about 14 m over its length — enough that the pair converge visibly and
       * nowhere near enough to close. */
      for (let k = 0; k <= 7; k++) {
        const t = k / 7;
        pts.push(new THREE.Vector3(
          sx * (62 - Math.sin(t * Math.PI * 0.5) * 14),
          Math.sin(t * Math.PI * 0.5) * 62,
          z + Math.sin(t * Math.PI) * 1.6));
      }
      addPipeRun(world, pts, { radius: 0.55, mat: steel, count: 1, supports: false });
      /* One tie back to the deck at the springing, so the rib has a foot
       * rather than growing out of the floor. */
      addPipeRun(world, [
        new THREE.Vector3(sx * 62, 0.4, z),
        new THREE.Vector3(sx * 54, 6.5, z),
      ], { radius: 0.30, mat: steel, count: 1, supports: false });
    }
  }
}

/**
 * ══ THE BULKHEAD — the only interior surface in the level ═════════════════
 *
 * Everything a room needs to say "this is a ship" is put on this one face,
 * because it is the only face there is: blast doors, a lit console rank, cable
 * runs, and the memorial.
 *
 * IT IS DRESSED IN DEPTH RATHER THAN IN DETAIL. Three planes at 2 m of relief
 * read as a hull section from twenty metres; a flat wall with more geometry on
 * it reads as wallpaper, which is exactly what the deleted interiors did.
 */
function dressBulkhead(world, M) {
  const steel = M.darkSteel || M.metal;
  const z = DECK.aft + 2.2;

  /* THE DOORS. Two leaves and a lit threshold, centred, because the deck needs
   * one place a man could plausibly have walked in from — the troop line files
   * in through here and it has to come from somewhere. */
  addWall(world, new THREE.Vector3(0, 5.5, z + 0.3), new THREE.Vector3(15, 11, 0.9),
    new THREE.Quaternion(), steel);
  for (const sx of [-1, 1]) {
    addWall(world, new THREE.Vector3(sx * 4.4, 4.6, z), new THREE.Vector3(7.6, 9.2, 0.6),
      new THREE.Quaternion(), steel);
  }
  const jamb = new THREE.Mesh(
    new THREE.BoxGeometry(16.4, 0.34, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x14181f, emissive: 0xff9a20, emissiveIntensity: 2.4, roughness: 0.5 }));
  jamb.position.set(0, 9.5, z - 0.5);
  world.scene.add(jamb); world.statics.push(jamb);

  /* THE WATCH. A rank of consoles along the wall with somebody's job on them,
   * lit from below — the only warm light in a room whose every other source is
   * a planet or a field. */
  for (let i = -3; i <= 3; i++) {
    if (Math.abs(i) < 2) continue;
    makeConsole(world, new THREE.Vector3(i * 7.5, 0, z + 1.6));
  }
  for (const sx of [-1, 1]) {
    addLamp(world, new THREE.Vector3(sx * 26, 0, z + 2.0), { height: 9, reach: 3.2 });
    addCableRun(world, new THREE.Vector3(sx * 30, 8.2, z + 0.4),
      new THREE.Vector3(sx * 12, 7.4, z + 0.4), { sag: 0.5 });
  }
}

/**
 * ══ THE FIELD ENVELOPE — three walls and a lid, none of them solid ════════
 *
 * Forward, port and starboard, standing ON the lip, plus one overhead at 90 m.
 * They are the room's only enclosure and they are the reason there is no
 * railing: you walk to the edge of the deck, the field stops you, and what is
 * in front of your face is a planet.
 *
 * THE OVERHEAD ONE IS WHY THERE IS NO CEILING and it is worth being explicit:
 * a field at 90 m over a deck 128 m across is a plane the player will never see
 * edge-on, so it never reads as a lid. It is there for the barrier and for the
 * faint wash it puts on everything, and the spars are what actually tell the
 * eye the room has a top.
 */
function addField(world) {
  const mat = fieldMaterial(0x8fd4ff);
  world._hangarField = mat;
  const L = DECK.lip;
  const H = DECK.roof;
  const q = (ax, ay, az, ang) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax, ay, az), ang);

  /* Forward, and it is the one the player walks up to. */
  fieldPlane(world, mat, new THREE.Vector3(0, H / 2, L), new THREE.Vector2(L * 2, H), null);
  for (const sx of [-1, 1]) {
    fieldPlane(world, mat, new THREE.Vector3(sx * L, H / 2, 0), new THREE.Vector2(L * 2, H),
      q(0, 1, 0, sx * Math.PI / 2));
  }
  /* Aft of the bulkhead there is nothing to close: the wall does it. */
  fieldPlane(world, mat, new THREE.Vector3(0, H, 0), new THREE.Vector2(L * 2, L * 2),
    q(1, 0, 0, -Math.PI / 2));

  /* THE BARRIER, and it is four boxes rather than the planes themselves — a
   * plane has no thickness and a character controller resolves through one. */
  const th = 2;
  for (const [cx, cz, hx, hz] of [
    [0, L + th, L + th, th], [0, -L - th, L + th, th],
    [L + th, 0, th, L + th], [-L - th, 0, th, L + th],
  ]) {
    world.physics?.addStaticBox?.(new THREE.Vector3(cx, H / 2, cz),
      new THREE.Vector3(hx, H / 2, hz), new THREE.Quaternion(), { friction: 0.4 });
  }
}

/**
 * ══ THE DECK — worked, not decorated ══════════════════════════════════════
 *
 * The rule this whole side of the room is built on, taken from the transport
 * bay's own design note: a hangar is a WORKSHOP, and a workshop reads as one
 * because of what is half-done in it, not because of how many objects are on
 * the floor. So the port side is one job in progress and the starboard side is
 * the stores it is being done out of, and there is a great deal of empty deck
 * between them — which is where the company forms up, and which is what makes
 * the room feel large.
 *
 * EVERYTHING IS OUT OF THE PLAYER'S EYELINE FORWARD. The whole point of the
 * composition is that looking forward is planet, field and men; a prop between
 * the player and the aperture is a prop in front of the only view there is.
 */
function dressDeck(world, M) {
  const steel = M.darkSteel || M.metal;

  /* ── PORT: the job. A gantry over the launch trench with a hull section
   * under it on jacks, scaffolding up its flank, and the tools left where a
   * shift left them. One ship being worked on says more about a war than six
   * parked ones, and it is the only honest thing this engine can do with a
   * hull: nothing here has a parked pose or a bay that opens. */
  addGantry(world, new THREE.Vector3(-34, 0, -6), { length: 34, height: 11, width: 4.2, bays: 5 });
  addHullSection(world, new THREE.Vector3(-34, 3.4, -6), { length: 26, radius: 5.2 });
  addScaffold(world, new THREE.Vector3(-27, 0, -14), { lifts: 3, width: 3.2 });
  addScaffold(world, new THREE.Vector3(-27, 0, 4), { lifts: 2, width: 3.2 });
  addMachine(world, new THREE.Vector3(-24, 0, -22));
  addTank(world, new THREE.Vector3(-46, 0, -24));
  addTank(world, new THREE.Vector3(-46, 0, -18));
  addPipeRun(world, [
    new THREE.Vector3(-52, 1.1, -30), new THREE.Vector3(-52, 1.1, 6),
    new THREE.Vector3(-44, 1.1, 14),
  ], { radius: 0.26, mat: steel, count: 3, spread: 0.7, valves: true });

  /* ── STARBOARD: the stores. Racks, crates, a loading slab and the deck
   * office. Stacked to different heights on purpose — a level line of crates
   * is a wall, and a wall is the thing this room is not allowed to grow. */
  addFloorSlab(world, new THREE.Vector3(36, 0, -4), new THREE.Vector2(22, 30));
  addCrateStack(world, new THREE.Vector3(30, 0, -20), { tiers: 3, columns: 3 });
  addCrateStack(world, new THREE.Vector3(38, 0, -10), { tiers: 2, columns: 2 });
  addCrateStack(world, new THREE.Vector3(33, 0, 6), { tiers: 4, columns: 2 });
  addMachine(world, new THREE.Vector3(44, 0, -26));
  makeConsole(world, new THREE.Vector3(26, 0, -26));

  /* LOOSE CRATES, and they are loose on purpose: `_grippableBody` takes a
   * PROP-layer dynamic body, so these are what the player picks up and throws
   * at the field. A hangar you cannot pick anything up in is a diorama. */
  for (const [x, z] of [[22, -30], [24, -27], [19, -33], [-18, -30], [-14, -34], [16, 2]]) {
    makeCrate(world, new THREE.Vector3(x, 0.5, z), 0.8);
  }

  /* ── THE LIP. Strobes and nothing else — no railing, on instruction and on
   * principle: the drop is the point, and a handrail is a level telling you it
   * does not trust its own edge. They are stanchions rather than lamps so they
   * read as deck furniture at knee height and never light the room. */
  for (let i = -3; i <= 3; i++) {
    addStanchion(world, new THREE.Vector3(i * 18, 0, DECK.lip - 2.5));
    if (Math.abs(i) === 3) continue;
    addStanchion(world, new THREE.Vector3(-DECK.lip + 2.5, 0, i * 18));
    addStanchion(world, new THREE.Vector3(DECK.lip - 2.5, 0, i * 18));
  }
}

/**
 * THE LIGHT, and it is nearly all from outside.
 *
 * A hangar lit by its own fixtures is a warehouse. This one is lit by the
 * planet — a huge cool key through the aperture, throwing every shadow AFT —
 * with four working lamps for the deck and one warm bounce off the bulkhead so
 * the aft third is not a hole. The ratio is the composition: if the deck lights
 * ever out-read the aperture, the room has become a box with a window.
 */
function lightDeck(world) {
  const key = new THREE.DirectionalLight(0xbcd8ff, 2.6);
  key.position.set(0, 42, DECK.lip);
  key.target.position.set(0, 0, DECK.aft);
  world.scene.add(key); world.scene.add(key.target);
  world.levelLights.push(key);

  const fill = new THREE.PointLight(0xffb070, 60, 70, 2);
  fill.position.set(0, 9, DECK.aft + 8);
  world.scene.add(fill); world.levelLights.push(fill);

  for (const [x, z] of [[-34, -6], [34, -6], [-30, 24], [30, 24]]) {
    const l = new THREE.PointLight(0xcfe0ff, 26, 46, 2);
    l.position.set(x, 12, z);
    world.scene.add(l); world.levelLights.push(l);
  }
}

/** The one dress entry the level record names. */
export function dressHangar(world) {
  const M = propMaterials();
  addField(world);
  addSpars(world, M);
  dressBulkhead(world, M);
  dressDeck(world, M);
  lightDeck(world);
  /* AND THE COMPANY IS ALREADY WALKING IN when the room opens. The player's
   * first frame on the deck is his men coming through the doors, not an empty
   * floor with a button on it — "the filing in sells it more than the
   * standing", and it cannot sell anything if it has already happened. */
  callTheCompany(world);
  /* THE ROOM'S SOUND, and it is not decoration: the pressure differential at
   * the field is measured at −12.1 dB A-weighted from the spawn to the lip,
   * with the energy under 200 Hz going 90% → 99%. Walking toward the shield
   * audibly changes, which is the one thing that says a wall of light is
   * holding out vacuum. */
  dressDeckAudio(world, { army: world?._company?.army });
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
  pool: [],
  groundColor: 0x474e58,
  spawnRadius: [6, 10],
  grass: 0,
  atmosphere: {
    sky: false, bgColor: 0x05070c, fog: true, fogColor: 0x0a0f18, fogDensity: 0.004,
    sunColor: 0xbcd8ff, sunIntensity: 3.2, ambient: 0.42,
    skyColor: 0x6e88b8, groundColor: 0x22262c, elevation: 12, azimuth: 0,
    fillColor: 0xffb070, fillIntensity: 0.35,
    exposure: 1.2, bloom: 0.75, saturation: 1.02,
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
  update(dt) {
    stepCompany(this.world, dt);
    /* AFTER the listener has moved, which is `World.update`'s own ordering —
     * the pressure filter and every Doppler ratio are functions of where the
     * player is standing THIS frame. */
    stepDeckAudio(this.world, dt, this.world?.player?.camera?.obj || this.world?.player);
  }
}


/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE COMPANY, ON THE DECK                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE MEN WALK ON ═══════════════════════════════════════════════════════
 *
 * "Troops file in from off-camera in a loose column, then snap to formation.
 *  **The filing in sells it more than the standing.** Staggered arrival — they
 *  don't all take the same number of steps. Slight timing offsets on the
 *  snap-to."
 *
 * That is the whole design of this half and it is right: a line that is simply
 * THERE when you turn round is a menu with a floor under it. The men come
 * through the bulkhead doors in a loose column, break for their places, and
 * arrive over about eight seconds — and no two of them take the same number of
 * steps, because the walk is the real gait solver moving a real body toward a
 * mark and not a lerp.
 *
 * ── THE MARKS ────────────────────────────────────────────────────────────
 *
 * By SQUAD, in the order `squadPlan` deals them, which is the order they form
 * in the fight — so the shape you are walking down is the shape that will be
 * on the ground. Squads are separated by a gap wider than the interval inside
 * one, because that gap is the only thing that says "these five are a unit"
 * without a label.
 *
 * They face AFT, toward the player, with the aperture and the planet behind
 * them. That is the shot: your men in front of you, the war behind them.
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
  /** Seconds from the order to the last man halting. */
  formUp: 8.5,
  /** Where they come from: the bulkhead doors, off to either side of centre. */
  door: { z: -44, spread: 7 },
};

/**
 * THE PACE, off `MUSTER.formUp` and the longest walk in the room rather than
 * typed. The far corner of the widest line is about 36 m from the doors; at
 * 8.5 s minus the last man's start offset that is a brisk double-time, which is
 * what a company crossing a deck to a call actually moves at.
 */
const MARCH_SPEED = 5.4;

/** Where man `i` of `n` stands, by squad. Pure, so a check can ask it. */
export function markFor(i, n, squad, squads) {
  const wide = Math.min(n, MUSTER.perRank);
  const rank = Math.floor(i / MUSTER.perRank);
  const col = i % MUSTER.perRank;
  /* THE SQUAD GAPS ARE PART OF THE WIDTH, or the line is not centred: a
   * company of two squads laid out on interval alone sits off to one side of
   * the room by half a gap. */
  const gaps = Math.max(0, (squads | 0) - 1) * (MUSTER.gap - MUSTER.interval);
  const span = (wide - 1) * MUSTER.interval + gaps;
  const before = Math.max(0, squad | 0) * (MUSTER.gap - MUSTER.interval);
  return {
    x: -span / 2 + col * MUSTER.interval + before,
    z: DECK.line + rank * MUSTER.depth,
  };
}

/**
 * ══ CALL THEM ═════════════════════════════════════════════════════════════
 *
 * Reads the player's own roll through `Company.loadAll` — the same door the
 * Company tab reads, so the men standing here are the men on that page, with
 * their ranks, their wounds, their kit and the gaps where last run's dead used
 * to stand.
 *
 * ONE ARMY AT A TIME. A player who has fought for both sides has two rolls and
 * they must never be in the same room: `HANGAR-SPEC` is explicit that one
 * wrong-faction asset kills the illusion, and two whole companies of them is
 * not a subtle version of that. The army is the one whose roll has men on it,
 * preferring the one the player last fielded.
 */
export function callTheCompany(world, opts = {}) {
  const rolls = companyLoadAll().filter((r) => (r?.men || []).length);
  if (!rolls.length) return null;
  const want = opts.army || world?.settings?.army;
  const roll = rolls.find((r) => r.army === want) || rolls[0];
  const men = roll.men.slice(0, MAX_ON_DECK);

  /* THE SHAPE THE FIGHT WOULD DEAL THEM, not a fresh one. `squadPlan` is the
   * pure derivation the Company tab's order of battle already draws and the
   * director already uses; asking it here is what makes the line on the deck
   * the line on the ground. */
  const plan = squadPlan(men, SQUAD);
  const bySquad = new Map();
  for (const [m, k] of plan) {
    if (!bySquad.has(k)) bySquad.set(k, []);
    bySquad.get(k).push(m);
  }
  const order = [...bySquad.keys()].sort((a, b) => a - b);

  const company = { army: roll.army, men: [], byMan: new Map(), t: 0, at: 0, stance: 'attention' };
  let i = 0;
  for (const k of order) {
    const squad = bySquad.get(k);
    for (let j = 0; j < squad.length; j++) {
      const rec = squad[j];
      const fig = buildFigure(rec);
      if (!fig) continue;
      const man = paradeMan(fig.rig, { designation: rec.designation || rec.name || `m${i}` });
      /* FACING AFT — at the player, with the aperture behind them. */
      man.facing = Math.PI;
      man.stance = 'attention';
      const mark = markFor(i, men.length, order.indexOf(k), order.length);
      /* THEY COME FROM THE DOORS, not from their marks. `stagger` is the
       * per-man offset that stops the column arriving as one organism; the
       * side they come in on alternates so the column splits at the threshold
       * the way a real one does. */
      const side = (i % 2) ? 1 : -1;
      fig.root.position.set(side * MUSTER.door.spread, 0, MUSTER.door.z);
      fig.root.rotation.y = Math.PI;
      world.scene.add(fig.root);
      const rowMan = {
        rec, fig, man, mark, squad: k, lead: false,
        /* Each man's own walk: when he starts and how long he takes. The
         * spread is what makes it a company and not a chorus line. */
        /* THE THREE THINGS THAT MAKE IT A COMPANY AND NOT A CHORUS LINE, and
         * they are deliberately three: when he starts (the column does not
         * leave the threshold as one), how fast he walks, and how far he has to
         * go. Any one of them alone still reads as a formation animation. */
        start: 0.10 + (i % 3) * 0.18 + (stagger(man) % 1) * 0.55,
        pace: 0.88 + (stagger(man) % 1) * 0.26,
        from: fig.root.position.clone(),
        merged: null,
      };
      company.men.push(rowMan);
      company.byMan.set(rec.designation || rec.name, rowMan);
      i++;
    }
    const lead = leadOf(bySquad.get(k).map((m) => ({ ...m, alive: true })));
    const row = company.men.find((r) => r.rec.designation === lead?.designation);
    if (row) row.lead = true;
  }
  world._company = company;
  return company;
}

/** How many men the deck will stand at once. See `MergedSkin` for the cost. */
export const MAX_ON_DECK = 24;


/**
 * ══ THE FILING IN, WHICH IS THE PART THAT SELLS IT ════════════════════════
 *
 * Stepped once a frame. Each man walks from the doors to his mark on his own
 * clock — his own start, his own pace — and halts. Nobody takes the same number
 * of steps as anybody else, because the distances differ, the paces differ and
 * the marks differ, which is the whole of "staggered arrival" and costs one
 * multiply per man.
 *
 * THE HALT IS A SNAP AND THE SNAP IS OFFSET. `smoothstep` to the mark, then the
 * facing swings to the front over the last fifth of his walk — so the line
 * squares up in a ripple rather than all at once, which is what a company
 * halting actually looks like and what a single eased transform never does.
 *
 * ── THE MERGE HAPPENS WHEN HE STOPS ──────────────────────────────────────
 *
 * `mergeFigure` folds 54 meshes into about 7 and `BAKES_PER_FRAME` is 1, so
 * twenty-four men bake over twenty-four frames. Doing it AT THE HALT rather
 * than at the build spreads those frames across the walk-on, when the player is
 * watching men move and cannot see a bake, instead of stacking them on the
 * frame the room opens.
 */
export function stepCompany(world, dt) {
  const c = world?._company;
  if (!c) return;
  c.t += dt;
  for (const row of c.men) {
    const { fig, man, mark } = row;
    const local = Math.max(0, c.t - row.start) * row.pace;
    /* HOW LONG HIS OWN WALK IS: the distance he has to cover at his own pace.
     * A fixed duration would have the far men sprint and the near men crawl. */
    const dist = Math.hypot(mark.x - row.from.x, mark.z - row.from.z);
    /* HIS OWN SPEED, DERIVED FROM THE ONE NUMBER THAT IS A DESIGN DECISION.
     * `MUSTER.formUp` is how long the whole thing takes and it is the only
     * figure anybody should ever tune; the pace falls out of the longest walk
     * on the deck so a company of four and a company of twenty-four both form
     * up in about the same time. Measured before this was derived: a hard
     * 3.1 m/s put the last man on his mark at fourteen seconds, which is a
     * wait rather than an arrival. */
    const span = Math.max(0.8, dist / MARCH_SPEED);
    const p = Math.min(1, local / span);
    if (p < 1) {
      /* THE COLUMN BREAKS FOR ITS PLACES rather than sliding to them: the
       * first two thirds of the walk is down the centreline toward the line's
       * own z, and the last third is the man stepping out to his file. It is
       * one extra ease and it is the difference between men and cursors. */
      const along = smoothstepIn(Math.min(1, p / 0.66));
      const across = smoothstepIn(Math.max(0, (p - 0.5) / 0.5));
      fig.root.position.x = row.from.x + (mark.x - row.from.x) * across;
      fig.root.position.z = row.from.z + (mark.z - row.from.z) * along;
      /* Facing where he is going, then squaring to the front at the end. */
      const turnIn = smoothstepIn(Math.max(0, (p - 0.8) / 0.2));
      fig.root.rotation.y = Math.PI;
      man.stance = 'attention';
      man.marching = turnIn < 1;
    } else if (!row.halted) {
      row.halted = true;
      c.halted = (c.halted | 0) + 1;
      /* THE COMPANY HALTING IS ONE SOUND, not eleven. `bootHalt` coalesces
       * inside a 55 ms window — shorter than the 64 ms it takes the sound to
       * cross from the line to the player, so it can never be heard as
       * latency — and ten men come out +11.8 dB on one with the sub share
       * going 0% → 91%. Eleven separate footfalls would be a stutter. */
      if (c.halted === c.men.length) bootHalt(world, { x: 0, y: 0, z: DECK.line }, c.men.length);
      fig.root.position.set(mark.x, 0, mark.z);
      fig.root.rotation.y = Math.PI;
      /* HE IS STANDING STILL NOW, so he can be folded. See the note above. */
      if (!row.merged) row.merged = mergeFigure(fig, { castShadow: true });
    }
    man.stance = c.stance;
    poseParade(man, c.t + stagger(man));
    row.merged?.update?.(c.t);
  }
}

/* `smoothstep` from MathUtil takes an edge pair; this is the 0..1 form the
 * walk wants and it is one line rather than a second import shape. */
function smoothstepIn(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }

/**
 * ══ AN ORDER, ON THE DECK ═════════════════════════════════════════════════
 *
 * "In the hangar you give a certain order (audibly, it'll be similar in
 *  carrying out to a stratagem), and that calls your troops."
 *
 * And then: "at ease, present arms, dismissed", multiple salutes, and singing.
 * These are the same verbs the fight has, which is the point of putting them
 * here — the deck is where the command interface is learned, in a place where
 * getting it wrong costs nothing.
 *
 * `ORDERS` here is deliberately NOT `Command.FORMATIONS`: a formation is a
 * shape a line fights in and these are things a company does standing still.
 * What they share is the door — one call, one id, one announcement — so a
 * player who learns "press this, they do that" learns the real one.
 */
export const DECK_ORDERS = {
  fallin: { name: 'Fall in', bark: 'COMPANY — FALL IN', stance: 'attention' },
  ease: { name: 'At ease', bark: 'STAND AT — EASE', stance: 'ease' },
  present: { name: 'Present arms', bark: 'PRESENT — ARMS', stance: 'present' },
  salute: { name: 'Salute', bark: 'COMPANY — SALUTE', salute: true },
  dismissed: { name: 'Dismissed', bark: 'COMPANY — DISMISSED', dismiss: true },
};

/** Give one. Returns false for an id nobody answers to. */
export function deckOrder(world, id) {
  const O = DECK_ORDERS[id];
  const c = world?._company;
  if (!O || !c) return false;
  if (O.stance) c.stance = O.stance;
  if (O.salute) {
    /* NOT ALL AT ONCE. A company saluting on one frame is a machine; each man
     * comes up on his own beat off his own seed, inside about a third of a
     * second, which is what a drilled company actually looks like. */
    for (const row of c.men) salute(row.man, c.t + (stagger(row.man) % 1) * 0.34);
  }
  if (O.dismiss) c.dismissed = c.t;
  world.notify?.(O.bark, `${c.men.length} ${c.men.length === 1 ? 'man' : 'men'}`);
  return true;
}
