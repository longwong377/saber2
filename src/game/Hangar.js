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
import { dressDeckLife, stepDeckLife } from './DeckLife.js';
import { squadPlan, leadOf, SQUAD } from './Command.js';
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
import { Paint, DeckBuild, DECK_PAINT, deckMats, rackBay, overheadRig,
  catwalk, crates } from './DeckKit.js';

/* The deck runs from the bulkhead aft to the lip forward. Named rather than
 * inlined because six things below have to agree about where the room stops,
 * and `hangardeck.height` is the seventh. */
export const DECK = {
  /**
   * ══ THE ROOM, AND EVERY NUMBER IN IT COMES OFF THE REFERENCES ═══════════
   *
   * The first version was 128 m across with a 34 m wall and it read as a shed.
   * `hangar 7.jpg` is the target composition and nothing in it is small: the
   * racked fighters recede until they are specks, the troopers are four pixels,
   * and the overhead is out of frame. "Scale must be immense" is the brief and
   * it is the first thing a number can get wrong.
   */
  /** Aft face of the bulkhead — the one solid surface in the level. */
  aft: -104,
  /** The lip, on every other side: the heightfield's own edge. */
  lip: 144,
  /** Where the player is put down, looking forward down the length of it. */
  start: new THREE.Vector3(0, 0, -74),
  /** Where the line forms up, facing him. */
  line: -48,
  /** The overhead field. 64 m, which is the height ref 6's catwalk implies. */
  roof: 64,
  /** How far out the solid structure runs before the walls become field. */
  bays: 46,
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

  /**
   * ══ THE RIM, AND IT IS THE MOST IMPORTANT OBJECT IN THE ROOM ══════════
   *
   * `assets/reference/REFERENCES.md` rule 1, agreed by all seven images: the
   * opening is bordered by a continuous, intensely bright white band. It is the
   * brightest thing in every one of those frames — brighter than anything it
   * lights — and it is what says the vacuum is on the other side.
   *
   * WITHOUT IT THE FIELD IS INVISIBLE. Measured, in the first render of this
   * room: three translucent additive planes against black space returned almost
   * nothing, so the aperture read as a hole in the dark. A field seen face-on
   * has no rim of its own to catch the light — the emitter housing is what you
   * actually see, and every reference draws it as a fat glowing strip.
   *
   * Ours borders THREE field planes and the overhead rather than one window,
   * because the player's brief is "space/force field on 3 sides and the
   * ceiling" — more open than any reference. So the rim runs the whole lip of
   * the deck and up the two corners, which is the same object doing the same
   * job on a more open room.
   */
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12, emissive: 0xdceaff, emissiveIntensity: 3.4, roughness: 0.35,
  });
  rimMat.name = 'field-rim';
  const rim = (cx, cy, cz, w, h, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat);
    m.position.set(cx, cy, cz);
    m.name = 'field-rim';
    m.renderOrder = 2;
    world.scene.add(m);
    world.statics.push(m);
    return m;
  };
  /* ALONG THE LIP, where the deck stops — the band a player standing at the
   * edge is looking straight down the length of. */
  rim(0, 0.55, L, L * 2, 1.1, 1.1);
  for (const sx of [-1, 1]) rim(sx * L, 0.55, 0, 1.1, 1.1, L * 2);
  /* UP THE TWO FORWARD CORNERS, so the aperture is framed vertically as well —
   * a band on the floor alone reads as a kerb. */
  for (const sx of [-1, 1]) rim(sx * L, H / 2, L, 1.1, H, 1.1);
  /* AND ACROSS THE TOP, closing the frame against the overhead field. */
  rim(0, H, L, L * 2, 1.1, 1.1);
  for (const sx of [-1, 1]) rim(sx * L, H, 0, 1.1, 1.1, L * 2);

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
 * ══ THE ROOM, BUILT AGAINST `hangar 7.jpg` ════════════════════════════════
 *
 * That image is the target composition and this is it, part for part:
 *
 *   TWO WALLS OF RACKED FIGHTERS receding to a vanishing point — ten a side,
 *     each in its own canted alcove with a full-height light strip. This is
 *     rule 3 and it is the piece the first two dressings did not have at all.
 *     It is also what "rows and rows of different ships" means: the floor stays
 *     clear and the ships live in the walls.
 *   ONE SOLID WALL, aft, 58 m of it, with a catwalk across at 22 m for scale.
 *   THE OVERHEAD IS HANGING FIXTURES coming down out of frame with red status
 *     lamps on them — never a ceiling.
 *   THE DECK IS A BLACK MIRROR and it is mostly EMPTY. Every reference keeps
 *     the middle of the floor clear; what is on it is crate clusters and a lit
 *     pit, at the edges.
 *
 * AND THE WALLS STOP. The player's brief is field on three sides and overhead,
 * which is more open than any reference — so the racks run the aft two-thirds
 * and the last third of the room is open to space on both flanks. Standing at
 * the lip you have vacuum in front of you and to both sides, with the ranks
 * receding behind you.
 */
function dressStructure(kit, paint) {
  const M = deckMats();
  const L = DECK.lip;

  /* ── THE RACK WALLS. Ten a side, 18 m apart, from the bulkhead forward to
   * where the structure ends and the field begins. */
  const first = DECK.aft + 16;
  const n = 10;
  const pitch = (DECK.bays * 2 + 60) / n;
  for (let i = 0; i < n; i++) {
    const z = first + i * pitch;
    for (const s of [-1, 1]) {
      /* The wall itself, behind the bays — dark, so the lit recesses read as
       * openings in something rather than as panels on nothing. */
      kit.slabAt(M.dark, s * (L - 6), 21, z, 12, 42, pitch * 0.98);
      rackBay(kit, s * (L - 13), 15, z, { side: s, width: pitch * 0.9, height: 21 });
      /* A second tier above the first, which is what makes the wall read as
       * tall — `hangar 7.jpg` stacks them and `hangar 6.jpg` hangs them. */
      rackBay(kit, s * (L - 13), 38, z, { side: s, width: pitch * 0.9, height: 19 });
    }
  }
  /* THE WALL CAPS. Where the structure ends the section is shown — a hull that
   * simply stopped would read as a wall that had been deleted. */
  for (const s of [-1, 1]) {
    const zEnd = first + n * pitch;
    kit.slabAt(M.hull, s * (L - 6), 24, zEnd, 13, 48, 3);
    kit.slabAt(M.strip, s * (L - 12.5), 24, zEnd + 1.7, 0.5, 44, 0.6);
  }

  /* ── THE BULKHEAD. One solid face, ribbed, with the doors and a catwalk. */
  const bz = DECK.aft + 4;
  for (let i = -6; i <= 6; i++) {
    if (Math.abs(i) < 2) continue;
    kit.slabAt(M.dark, i * 22, 28, bz, 20, 56, 3.2);
    kit.slabAt(M.hull, i * 22 - 10.5, 28, bz + 2.0, 2.4, 58, 4);
    kit.slabAt(M.strip, i * 22, 28, bz + 2.4, 1.0, 46, 0.7);
  }
  /* The doors, recessed, with a lit head — where the company walks in. */
  kit.slabAt(M.deep, 0, 13, bz + 1.0, 42, 26, 3);
  for (const s of [-1, 1]) kit.slabAt(M.hull, s * 22.5, 14, bz + 2.6, 5, 28, 4);
  kit.slabAt(M.hull, 0, 27.5, bz + 2.6, 50, 3, 4);
  kit.slabAt(M.strip, 0, 25.6, bz + 1.2, 40, 0.7, 0.7);
  catwalk(kit, 0, 22, bz + 5.5, L * 1.6);
  catwalk(kit, 0, 40, bz + 5.5, L * 1.6);

  /* ── THE OVERHEAD. Fixtures down the centreline and over each wall, coming
   * out of frame. Nothing is ever drawn across the top. */
  for (let i = 0; i < 7; i++) {
    const z = DECK.aft + 30 + i * 34;
    overheadRig(kit, 0, z, { top: DECK.roof, drop: 18, radius: 3.4 });
    for (const s of [-1, 1]) overheadRig(kit, s * (L * 0.55), z, { top: DECK.roof, drop: 13, radius: 2.4 });
  }

  /* ── ON THE DECK: crate clusters at the edges, and the pit's rim. Nothing in
   * the middle — the middle is where the company stands and where every
   * reference leaves the floor clear. */
  crates(kit, -L + 26, -70, 6, 3);
  crates(kit, L - 30, -60, 5, 7);
  crates(kit, L - 24, 20, 7, 11);
  crates(kit, -L + 34, 60, 4, 13);
  /* The pit, lit from inside, exactly as `hangar 1.webp` and `hangar 7.jpg`
   * have it — the one thing that says there is more ship under this one. */
  for (const [dx, dz, w, d] of [[-52, -18, 34, 1.6], [-52, 30, 34, 1.6],
    [-69, 6, 1.6, 48], [-35, 6, 1.6, 48]]) {
    kit.slabAt(M.hull, dx, 0.35, dz, w, 0.7, d);
    kit.slabAt(M.strip, dx, 0.1, dz, w * 0.9, 0.16, d * 0.9);
  }

  /* ── THE PAINT. Rule 7: large, pale, sparse, and RED where it is coloured at
   * all — there is no yellow in any of the seven. Long guide runs down the
   * length of the deck, a marked muster ground, and thin red boxes at the
   * edges the way `hangar 5.webp` has them. */
  const P = DECK_PAINT;
  paint.dashed(P.stencil, 0, DECK.aft + 20, 0, L - 20, 0.5, 5.5, 4.5);
  for (const s of [-1, 1]) {
    paint.line(P.stencil, s * 34, DECK.aft + 20, s * 34, L - 20, 0.35);
  }
  /* The muster ground, boxed — the line has a place painted for it. */
  paint.line(P.stencil, -46, DECK.line - 2, 46, DECK.line - 2, 0.3);
  paint.line(P.stencil, -46, DECK.line + 9, 46, DECK.line + 9, 0.3);
  for (const s of [-1, 1]) paint.line(P.stencil, s * 46, DECK.line - 2, s * 46, DECK.line + 9, 0.3);
  /* Red keep-outs at the rack feet and the pit, which is the only colour any
   * reference paints on a deck. */
  for (let i = 0; i < n; i++) {
    const z = first + i * pitch;
    for (const s of [-1, 1]) {
      paint.line(P.keepOut, s * (L - 22), z - pitch * 0.4, s * (L - 22), z + pitch * 0.4, 0.28);
    }
  }
  paint.line(P.keepOut, -71, -20, -33, -20, 0.3);
  paint.line(P.keepOut, -71, 32, -33, 32, 0.3);
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

/**
 * THE FOUR PASSES, NAMED — so a cost measurement can say which one is
 * expensive. A traverse of the finished room buckets every prop into one
 * anonymous `Mesh` and tells you nothing you can act on; building them one at a
 * time on a bare scene is the only reading that names a caller.
 */
export const __deckParts = { field: addField, structure: dressStructure };

/** The one dress entry the level record names. */
export function dressHangar(world) {
  addField(world);
  /* ONE BUILDER AND ONE PAINT SHOP FOR THE WHOLE ROOM — twenty rack bays with
   * a fighter in each, seven overhead rigs, two catwalks and the bulkhead come
   * out as six meshes and three. */
  const kit = new DeckBuild();
  const paint = new Paint();
  dressStructure(kit, paint);
  world._deckKit = kit.build(world);
  world._deckPaint = paint.build(world);
  lightDeck(world);

  /* LOOSE CRATES, and they are loose on purpose: `_grippableBody` takes a
   * PROP-layer dynamic body, so these are what the player picks up and throws
   * at the field. They cannot go in the kit — a merged crate cannot be
   * gripped. */
  for (const [x, z] of [[26, -66], [30, -62], [22, -70], [-24, -66], [-19, -71], [20, -30]]) {
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
  const shown = outsideLevel(world);
  world.engine?.sky?.configureOrbit?.({
    level: shown,
    terrain: TERRAIN_PRESETS[shown?.terrain],
  });

  callTheCompany(world);
  /* THE ROOM'S SOUND, and it is not decoration: the pressure differential at
   * the field is measured at −12.1 dB A-weighted from the spawn to the lip,
   * with the energy under 200 Hz going 90% → 99%. Walking toward the shield
   * audibly changes, which is the one thing that says a wall of light is
   * holding out vacuum. */
  dressDeckAudio(world, { army: world?._company?.army });
  /* AND THE ROOM WORKS. Droids on three jobs, a trolley on the gantry, a tech
   * welding, a sled crossing, crew as silhouettes in the haze, vents, and the
   * field reacting to what hits it. Measured at 0.016 ms of frame at steady
   * state with 46 dynamic props on the deck, and nothing in the step allocates.
   *
   * THE HAZE IS THE PIECE THAT MATTERS MOST and it is the cheapest: far rows
   * dissolve, so the deck never has to model what is behind them. */
  dressDeckLife(world);
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
    stepDeckLife(this.world, dt);
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


/**
 * ══ WHICH WORLD IS OUTSIDE ════════════════════════════════════════════════
 *
 * The record is HANDED IN, never looked up, and that is the whole reason this
 * file does not import `Levels.js`. It did for one commit: `Levels.js` imports
 * `Hangar.js` for the level record, so the pair was a cycle — and a cycle in
 * ES modules does not throw on every path, it throws on the first import order
 * that reaches the wrong half first. It ran green for hours and then died with
 * `Cannot access 'HANGAR_LEVEL' before initialization` in one suite.
 *
 * Registering from this side instead was worse: the ground then exists only if
 * something has imported this file, and two suites that read `LEVELS` directly
 * went red saying a mode names a ground the game does not have.
 *
 * So the dependency points one way — `Levels.js` owns the roster and knows
 * about the deck; the deck knows about no levels at all — and `main.js`, which
 * already imports both, resolves the player's theatre through `theatreFor` (the
 * same resolver `deploy` uses, so a mode that owns its ground wins) and stashes
 * the RECORD on the world before the dressing runs.
 */
export function outsideLevel(world) {
  return world?._pickedLevel || world?.level || null;
}
