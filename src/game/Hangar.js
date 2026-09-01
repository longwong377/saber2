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

import * as THREE from 'three';
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

  update() {}
}
