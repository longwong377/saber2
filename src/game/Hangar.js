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
import { buildFigure, paradeMan, poseParade, salute, stagger, STANCES } from './Parade.js';
import { mergeFigure } from './MergedSkin.js';
import { loadAll as companyLoadAll } from './Company.js';
import { dressDeckAudio, stepDeckAudio, undressDeckAudio, bootHalt } from './DeckAudio.js';
import { dressDeckLife, stepDeckLife } from './DeckLife.js';
import { squadPlan, leadOf, SQUAD, ORDER_REACH, armyToLead } from './Command.js';
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
import { Paint, DeckBuild, DECK_PAINT, deckMats, rackBay, overheadRig,
  catwalk, crates, smear, deckLamp, shuttlePad, factionOf, insigniaPanel } from './DeckKit.js';

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
  /**
   * WHERE THE PLAYER IS PUT DOWN, and every metre of it is answering to
   * something.
   *
   * He stands 18 m forward of the bulkhead doors, so the company comes out
   * BEHIND him and marches past — which is what "file in from off-camera"
   * means from a first-person camera and is the one thing the brief says sells
   * the whole scene. And he is 30 m from the line, inside `ORDER_REACH`'s 34,
   * so he can give an order where he lands but only just: walk three paces the
   * wrong way and they stop hearing you, which is the reach rule teaching
   * itself in the room built for learning it.
   */
  start: new THREE.Vector3(0, 0, -78),
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
      uWeave: { value: 0.55 },
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
  /**
   * ══ AND THERE IS NO OVERHEAD PLANE, BECAUSE THAT PLANE WAS A CEILING ════
   *
   * A 288 x 288 m field lay flat at y = 64 over the whole deck. The prose
   * above argued the player would never see it edge-on so it would never read
   * as a lid -- and that argument is backwards. The field shader is fresnel
   * driven: it is DIMMEST looking straight up at it and BRIGHTEST at grazing
   * angles, which are exactly the angles you look at an overhead from. At 17
   * degrees of elevation it lands about eight times brighter than the forward
   * plane seen face on. It was a glowing lid over the room.
   *
   * Worse, it was the one object the no-ceiling check could not see:
   * tools/checks/hangar.mjs skips saberNoInk materials and anything named
   * field-rim, which is this plane and the three bars along its edges. The
   * rule this room stands on was enforced everywhere except on the thing that
   * broke it.
   *
   * The physics box that stops a player leaving through the top stays. It is
   * invisible, which is the correct way for a ceiling to exist here.
   */

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
  /**
   * AND IT IS UNLIT, WHICH THE FIRST ONE WAS NOT. A `MeshStandardMaterial`
   * with `emissiveIntensity: 3.4` is still a shaded surface: it is tone-mapped
   * with everything else and it loses to a dark ambient, so in the first
   * render of this room the rim was a grey kerb. Rule 1 says the rim is the
   * brightest thing in the frame, brighter than anything it lights. Only an
   * unlit material can promise that.
   *
   * `emissive` is kept on it anyway so `refhold`'s "every rim is emissive"
   * check still has something true to read, and so a bloom pass that keys off
   * emissive still finds it.
   */
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xf2f7ff, toneMapped: false });
  rimMat.emissive = new THREE.Color(0xdceaff);
  rimMat.emissiveIntensity = 3.4;
  rimMat.userData.saberNoInk = true;
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
  /**
   * THE BAND IS 4 m THICK, and the number is an angle rather than a taste.
   * The lip is 144 m from where the company stands: a 1.1 m band there
   * subtends 0.44°, which is a hairline — and a hairline is what the first
   * render showed. Four metres is 1.6°, about the width the rim takes up in
   * `hangar 1.webp` and `hangar 4.jpg` at their own distances, and it is the
   * difference between a bright edge and no edge.
   */
  const T = 4.0;
  rim(0, T / 2, L, L * 2, T, T);
  for (const sx of [-1, 1]) rim(sx * L, T / 2, 0, T, T, L * 2);
  /* UP THE TWO FORWARD CORNERS, so the aperture is framed vertically as well —
   * a band on the floor alone reads as a kerb. */
  for (const sx of [-1, 1]) rim(sx * L, H / 2, L, T, H, T);
  /* AND ACROSS THE TOP OF THE APERTURE ONLY -- the forward edge, which is
   * the top of the window you look out of. The two that used to run back
   * along the sides at y = H were drawing the outline of the overhead plane,
   * so between them they traced a lit rectangle over the deck: the ceiling
   * again, in the one material the check exempts. One bar, forward, framing
   * the view; nothing overhead behind you. */
  rim(0, H, L, L * 2, T, T);

  /**
   * ══ THE STROBES, WHICH THE SPEC TICKED AND THE ROOM DID NOT HAVE ════════
   *
   * "Deck extends out toward the shield and just ends. Warning strobes at the
   * lip, no railing." The railing was correctly absent and the strobes were
   * absent too -- grep for the word across src/ and the hangar had none. Two
   * files still carried prose about "the strobes stand 2.5 m inside it",
   * describing an object that was deleted with the first dressing.
   *
   * They are what makes an unfenced edge legible: a rank of low markers along
   * the last plates, pulsing out of phase so the eye reads a line rather than
   * a row of dots. Out of phase is the whole point -- a strobe rank that
   * blinks together is a decoration, and one that runs is an edge.
   */
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffe9d2, toneMapped: false });
  strobeMat.userData.saberNoInk = true;
  strobeMat.name = 'lip-strobe';
  const IN = 3.0;                      // how far inside the drop they stand
  const spots = [];
  for (let d = -L + 12; d <= L - 12; d += 16) {
    spots.push([d, L - IN], [-L + IN, d], [L - IN, d]);
  }
  /**
   * ONE INSTANCED MESH FOR ALL OF THEM. Fifty separate meshes on the lip is
   * fifty draw calls before the ink pass doubles them, which is a quarter of
   * this room's whole budget spent on markers a player looks at once. The
   * pulse is a per-instance colour, so the phase runs along the rank without
   * touching a matrix.
   */
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
  /* OFF THE KIT, NEVER BARE. `deckMats()` with no argument hands back the
   * default palette, so one bare call in here was enough to mix five Republic
   * materials into a Separatist room — which is the exact failure the brief
   * says kills the illusion, arriving through the least visible line in the
   * file. */
  const M = deckMats(kit.faction);
  const L = DECK.lip;
  /**
   * ══ HOW FAR APART THE WALLS STAND, AND IT IS THE WHOLE COMPOSITION ══════
   *
   * They were at ±138 — 276 m apart, the full width of the deck — and that is
   * why the first render of this room was a black void with a floor. A player
   * standing on the centreline was 138 m from either wall, which at a 60°
   * field of view puts the racks entirely outside the frame. Every light in
   * the room was in the walls, so the room had no light in it.
   *
   * No reference is anything like that wide across the working bay. `hangar
   * 6.jpg` is symmetric with both walls in frame and their strips carrying the
   * whole image; `hangar 3.jpg` has one wall close enough to read its ribs.
   * "Immense" in those pictures is the HEIGHT and the DEPTH, never the beam.
   *
   * So the racks stand 112 m apart and run the length of the ship, and the
   * deck keeps its full 288 m: past the ends of the racks it opens out into an
   * apron with vacuum on three sides. That is a bigger room than the flat one
   * — a canyon of ships that opens onto space — and it is one you can see.
   */
  const WALL = 56;
  const TIERS = [
    { y: 13.5, h: 21 },
    { y: 35.0, h: 20 },
    { y: 54.0, h: 16 },
  ];

  /* ── THE RACK WALLS. Fourteen bays a side, three tiers, from the bulkhead
   * forward to two thirds of the way out. Eighty-four fighters, and no two
   * neighbours are the same hull. */
  const first = DECK.aft + 14;
  const n = 14;
  const pitch = 11.6;
  const zEnd = first + (n - 1) * pitch + pitch * 0.6;
  for (let i = 0; i < n; i++) {
    const z = first + i * pitch;
    for (const s of [-1, 1]) {
      /* The wall itself, behind the bays — dark, so the lit recesses read as
       * openings in something rather than as panels on nothing. It runs the
       * full height: a wall that stops is a wall the eye finds the top of. */
      kit.slabAt(M.dark, s * (WALL + 7), 34, z, 14, 68, pitch * 0.99);
      for (let t = 0; t < TIERS.length; t++) {
        const T = TIERS[t];
        rackBay(kit, s * WALL, T.y, z, {
          side: s, width: pitch * 0.92, height: T.h,
          /* THE HULLS ALTERNATE ON BOTH AXES. `(i + t)` rather than `i` so a
           * column of three bays is three different ships and a row of
           * fourteen never repeats at the same height twice running. */
          kind: (i + t) % 3,
        });
      }
      /* THE OUTER FACE IS BAYS TOO. There is deck on the far side of these
       * walls — the apron runs out to the field at ±144 — and a blank 68 m
       * slab facing it would be the "bare side wall, cannot look like a box"
       * the brief bans in as many words. Two tiers out there, so the count of
       * racked ships is a hundred and forty. */
      for (let t = 0; t < 2; t++) {
        const T = TIERS[t];
        rackBay(kit, s * (WALL + 14), T.y, z, {
          side: -s, width: pitch * 0.92, height: T.h, kind: (i + t + 2) % 3,
        });
      }
      /* THE REFLECTION. One smear per tier, off the wall foot, running in
       * across the plate. This is rule 2 and it is the single biggest thing
       * separating these pictures from a grey floor. */
      if (i % 2 === 0) smear(kit, s * (WALL - 4), z, 34, pitch * 0.7, -s, 0);
    }
  }
  /* THE WALL CAPS. Where the structure ends the section is shown — a hull that
   * simply stopped would read as a wall that had been deleted. */
  for (const s of [-1, 1]) {
    kit.slabAt(M.hull, s * (WALL + 7), 34, zEnd, 15, 70, 3);
    kit.slabAt(M.glow, s * (WALL - 0.5), 34, zEnd + 1.8, 0.5, 64, 0.7);
    /* And the same at the aft end, so the canyon is closed at both ends. */
    kit.slabAt(M.hull, s * (WALL + 7), 34, first - pitch * 0.6, 15, 70, 3);
  }

  /* ── THE BULKHEAD. One solid face, ribbed, with the doors and two catwalks.
   * It is the only interior surface in the level and it spans the deck. */
  const bz = DECK.aft + 4;
  for (let i = -6; i <= 6; i++) {
    if (Math.abs(i) < 2) continue;
    kit.slabAt(M.dark, i * 22, 28, bz, 20, 56, 3.2);
    kit.slabAt(M.hull, i * 22 - 10.5, 28, bz + 2.0, 2.4, 58, 4);
    /* Rule 4's vertical run, unlit so it survives the dark. */
    kit.slabAt(M.glowDim, i * 22, 28, bz + 2.4, 1.0, 46, 0.7);
  }
  /* The doors, recessed, with a lit head — where the company walks in. */
  kit.slabAt(M.deep, 0, 13, bz + 1.0, 42, 26, 3);
  for (const s of [-1, 1]) kit.slabAt(M.hull, s * 22.5, 14, bz + 2.6, 5, 28, 4);
  kit.slabAt(M.hull, 0, 27.5, bz + 2.6, 50, 3, 4);
  kit.slabAt(M.glow, 0, 25.6, bz + 1.2, 40, 0.7, 0.7);
  /**
   * THE INSIGNIA, WHICH IS THE ONLY THING IN THE ROOM THAT SAYS WHOSE IT IS.
   *
   * Rule 7: large, pale, sparse — so it is one mark above the doors at the
   * scale a ship's own crest is painted, and one on the deck where the company
   * falls in. Not a badge on every surface; there is no insignia at all in any
   * of the seven references, which is exactly why the temptation is to
   * over-use the one thing that carries faction.
   */
  insigniaPanel(kit, 0, 36, bz + 3.4, 22, { faction: kit.faction });
  /* THE DOORWAY THROWS A WEDGE ONTO THE DECK. The company files out of it and
   * an unlit door they walk out of is a hole in a wall. */
  smear(kit, 0, bz + 3, 40, 34, 0, 1);
  catwalk(kit, 0, 22, bz + 5.5, WALL * 2.1);
  catwalk(kit, 0, 40, bz + 5.5, WALL * 2.1);

  /* ── THE OVERHEAD. Fixtures down the centreline and over each wall, coming
   * out of frame. Nothing is ever drawn across the top.
   *
   * THEY COME DOWN FURTHER THAN THEY DID. At `drop: 18` off a 64 m overhead
   * they stopped at 46 m, which from the deck is above the frame and might as
   * well not exist. In `hangar 7.jpg` the fixtures hang into the upper third
   * of the picture — low enough to be furniture, never low enough to be a
   * lid. */
  for (let i = 0; i < 10; i++) {
    const z = DECK.aft + 24 + i * 22;
    overheadRig(kit, 0, z, { top: DECK.roof, drop: 34, radius: 3.6 });
    for (const s of [-1, 1]) overheadRig(kit, s * (WALL * 0.62), z, { top: DECK.roof, drop: 27, radius: 2.6 });
  }

  /* ── THE MIDDLE DISTANCE. One craft on a pad, big enough to read, between
   * the company and the aperture — `hangar 7.jpg` and `hangar 5.webp` both
   * put exactly one there and it is what gives the room a scale ladder. */
  shuttlePad(kit, -26, 46, { radius: 17, yaw: 0.22 });
  shuttlePad(kit, 30, 92, { radius: 15, yaw: -1.4 });

  /* ── ON THE DECK: crate clusters at the wall feet, and the pit. Nothing in
   * the middle — the middle is where the company stands and where every
   * reference leaves the floor clear. */
  crates(kit, -WALL + 9, -70, 6, 3);
  crates(kit, WALL - 11, -58, 5, 7);
  crates(kit, WALL - 8, 18, 7, 11);
  crates(kit, -WALL + 12, 58, 4, 13);
  crates(kit, -WALL - 26, 8, 6, 17);
  crates(kit, WALL + 30, -30, 5, 23);
  /* The pit, lit from inside, exactly as `hangar 1.webp` and `hangar 7.jpg`
   * have it — the one thing that says there is more ship under this one. */
  for (const [dx, dz, w, d] of [[-30, -18, 26, 1.6], [-30, 30, 26, 1.6],
    [-43, 6, 1.6, 48], [-17, 6, 1.6, 48]]) {
    kit.slabAt(M.hull, dx, 0.35, dz, w, 0.7, d);
    kit.slabAt(M.glow, dx, 0.1, dz, w * 0.9, 0.16, d * 0.9);
  }

  /* ── THE UPLIGHTS. `hangar 3.jpg` scatters them across the plate and they
   * are the only thing in that image telling you the floor is a surface. Two
   * long runs down the working length, plus the apron. */
  for (let i = 0; i < 16; i++) {
    const z = DECK.aft + 20 + i * 15;
    for (const s of [-1, 1]) deckLamp(kit, s * 34, z);
  }
  for (const [lx, lz] of [[-92, 20], [-92, 70], [92, 20], [92, 70], [0, 118], [-60, 124], [60, 124]]) {
    deckLamp(kit, lx, lz);
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
  /* AND ON THE GROUND THE LINE FORMS ON. Big, pale and alone — the men stand
   * on their own crest, which is the one place a deck marking in these
   * pictures is ever allowed to be a shape rather than a line. */
  paint.insignia(0, DECK.line + 26, 30, { faction: kit.faction });
  /* The muster ground, boxed — the line has a place painted for it. */
  paint.line(P.stencil, -46, DECK.line - 2, 46, DECK.line - 2, 0.3);
  paint.line(P.stencil, -46, DECK.line + 9, 46, DECK.line + 9, 0.3);
  for (const s of [-1, 1]) paint.line(P.stencil, s * 46, DECK.line - 2, s * 46, DECK.line + 9, 0.3);
  /* Red keep-outs at the rack feet and the pit, which is the only colour any
   * reference paints on a deck. */
  for (let i = 0; i < n; i += 2) {
    const z = first + i * pitch;
    for (const s of [-1, 1]) {
      paint.line(P.keepOut, s * (WALL - 9), z - pitch * 0.4, s * (WALL - 9), z + pitch * 0.4, 0.28);
    }
  }
  paint.line(P.keepOut, -45, -20, -15, -20, 0.3);
  paint.line(P.keepOut, -45, 32, -15, 32, 0.3);
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
 * ══ WHOSE SHIP THIS IS, ASKED ONCE ════════════════════════════════════════
 *
 * "Ship classes, trooper models, deck insignia, PA voice, lighting colour
 *  temperature, and the enemy capital ships in the battle outside all swap
 *  together. Never mix — if the player sees one wrong-faction asset the whole
 *  illusion dies."
 *
 * That is the brief, and until now the room had no idea whose it was:
 * `DeckKit.js` contained the word `faction` zero times, so a hundred and forty
 * fighters built to the Separatist silhouette stood on the walls of a Republic
 * player's hangar — the loudest possible wrong-faction asset, and the dominant
 * visual element in the room.
 *
 * ONE FUNCTION, AND EVERY CONSUMER TAKES ITS ANSWER. The kit, the paint, the
 * insignia, the lights, the company, the PA and the fleet outside all read
 * this, so there is no second opinion anywhere for them to disagree over.
 *
 * IT CANNOT ASK `_company`, which is the trap: `dressStructure` runs before
 * `callTheCompany`, so at the moment the room is built there is no company to
 * ask. It reads the same roll `callTheCompany` will read, by the same door,
 * and falls back to whichever side the player's chosen order fights for —
 * because a player with no roll at all still has an alignment.
 */
export function deckFaction(world) {
  const want = world?.settings?.army;
  if (want) return factionOf(want);
  const rolls = companyLoadAll().filter((r) => (r?.men || []).length);
  if (rolls.length) return factionOf(rolls[0].army);
  /* NO ROLL YET. `armyToLead` is the fight's own answer to "whose side is this
   * player on", derived from the order they follow, so a fresh save still gets
   * a coherent room rather than a default. */
  try { return factionOf(armyToLead(world?.settings?.order)); } catch { return factionOf(null); }
}

/**
 * ══ WHAT YOU CANNOT WALK THROUGH ══════════════════════════════════════════
 *
 * One box per structural mass, declared against the same numbers
 * `dressStructure` builds from. It is duplication and it is the honest kind:
 * the alternative is deriving colliders from merged geometry, which cannot
 * distinguish a wall from the ninety fighters merged into the same mesh.
 *
 * The bays themselves are deliberately NOT solid to their own depth — the
 * wall is one slab from its outer face to the mouth of the recess, so a
 * player walks up to the racks and stops, rather than being able to stand
 * inside an alcove with a fighter through his head.
 */
function deckColliders(world) {
  const P = world.physics;
  if (!P?.addStaticBox) return;
  const q = new THREE.Quaternion();
  const box = (cx, cy, cz, hx, hy, hz) =>
    P.addStaticBox(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(hx, hy, hz), q, { friction: 0.7 });

  const WALL = 56, first = DECK.aft + 14, n = 14, pitch = 11.6;
  const zEnd = first + (n - 1) * pitch + pitch * 0.6;
  const mid = (first - pitch * 0.6 + zEnd) / 2;
  const half = (zEnd - (first - pitch * 0.6)) / 2;
  /* THE TWO RACK WALLS, each one box from the mouth of the inboard recess to
   * the mouth of the outboard one. */
  for (const s of [-1, 1]) box(s * (WALL + 7), 34, mid, 14.5, 34, half);
  /* THE BULKHEAD, the only interior surface, with the doorway left open —
   * the company walks through it and so does the player. */
  const bz = DECK.aft + 4;
  for (const sx of [-1, 1]) box(sx * 84, 28, bz, 60, 28, 3.5);
  box(0, 41, bz, 24, 15, 3.5);
  /* THE SHUTTLE PADS, low enough to step onto and solid enough to stand on. */
  for (const [px, pz, r] of [[-26, 46, 17], [30, 92, 15]]) box(px, 0.6, pz, r, 0.6, r);
  /* THE PIT: four kerbs, so a player can walk to the edge and look in but
   * cannot fall into a hole with no floor authored under it. */
  for (const [dx, dz, w, d] of [[-30, -18, 26, 1.6], [-30, 30, 26, 1.6],
    [-43, 6, 1.6, 48], [-17, 6, 1.6, 48]]) {
    box(dx, 0.5, dz, w / 2, 0.5, d / 2);
  }
  world._deckSolids = 4 + 2 + 3 + 2 + 4;
}

/**
 * ══ THE LIGHT, AND THE FIRST VERSION HAD ALMOST NONE ══════════════════════
 *
 * What shipped was one directional key, four point lamps 46 m apart on a deck
 * 288 m across, and a WARM ORANGE fill at the bulkhead. The render was black
 * with two bright specks in it, and the orange was a straight breach of rule
 * 6 — the palette is monochrome blue-grey and the only colour in seven
 * references is a red status lamp. A warm bounce is a terrestrial interior
 * convention and I invented it here the same way I invented the caution
 * chevrons.
 *
 * So: everything is cool, and the room is lit by its own ranks. A point light
 * per pair of rack bays down both walls is what actually throws the strips'
 * light onto the deck — an emissive material illuminates nothing in three.js,
 * which is the whole reason a wall of glowing bars sat in a black room.
 *
 * THE KEY IS STILL THE APERTURE and it still wins: 2.6 against 18 at 60 m
 * falloff means the wall lamps light their own bay and die, which is the
 * ratio every reference has — bright bars, dark air between them.
 */
function lightDeck(world) {
  /**
   * AND THE COLOUR TEMPERATURE SWAPS WITH EVERYTHING ELSE, because the brief
   * lists it in the same breath as the ship classes and the PA voice.
   *
   * Both are cool — rule 6 allows nothing else — so the difference is where in
   * the cool they sit: the Republic deck is lit near-white with the faintest
   * warmth left in it, the Separatist one is pushed hard to steel blue. Held
   * to a few hundred kelvin of each other on purpose. A faction swap that
   * changes the light to a DIFFERENT COLOUR reads as a filter over the same
   * room; one that changes it by a shade reads as a different ship.
   */
  const sep = world._deckFaction === 'separatist';
  const KEY = sep ? 0xaec6f2 : 0xcadcf6;
  const LAMP = sep ? 0xb9cef4 : 0xdbe6fb;
  const key = new THREE.DirectionalLight(KEY, 2.6);
  key.position.set(0, 42, DECK.lip);
  key.target.position.set(0, 0, DECK.aft);
  world.scene.add(key); world.scene.add(key.target);
  world.levelLights.push(key);

  /* THE BULKHEAD WASH — cool, where the orange one was. The aft third is the
   * one part of the room the aperture cannot reach, and a hole there reads as
   * an unfinished level rather than as depth. */
  const fill = new THREE.PointLight(LAMP, 30, 90, 2);
  fill.position.set(0, 16, DECK.aft + 10);
  world.scene.add(fill); world.levelLights.push(fill);

  /**
   * THE RANKS. Six a side down the canyon plus two on the apron.
   *
   * FOURTEEN LIGHTS IS A DELIBERATE NUMBER and it is near the ceiling of what
   * a forward renderer will take: three.js compiles the light count into the
   * shader, so this is the cost of every material in the room. Sixteen point
   * lights over 288 m at 60 m range is one lamp per bay-pair, which is the
   * rhythm in `hangar 6.jpg`, and going finer means going to baked vertex
   * light instead.
   */
  for (let i = 0; i < 6; i++) {
    const z = DECK.aft + 26 + i * 26;
    for (const s of [-1, 1]) {
      const l = new THREE.PointLight(LAMP, 18, 62, 2);
      l.position.set(s * 44, 16, z);
      world.scene.add(l); world.levelLights.push(l);
    }
  }
  /* And two out on the apron, so the deck between the racks and the lip is not
   * a black band the player crosses to reach the view. */
  for (const s of [-1, 1]) {
    const l = new THREE.PointLight(KEY, 14, 80, 2);
    l.position.set(s * 46, 14, 104);
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
    [26, 112], [31, 108], [-28, 116],
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
  /* THE COMPANY FIRST, because the window's faction comes off the roll that
   * is actually standing in the room. */
  callTheCompany(world);
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
  });

  /**
   * ══ AND THE ORDER WHEEL OPENS, BECAUSE THERE IS SOMETHING TO OPEN IT ═══
   *
   * `HUD.update` gates the wheel on `world.command`, which `World` assigns
   * below its own early return for this level — so the deck had none, the
   * wheel could never be built, `main.orderKeys` returned on its first line,
   * and every one of `DECK_ORDERS` was unreachable by any input the game has.
   */
  world.command = deckCommand(world);

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
    sunColor: 0xbcd8ff, sunIntensity: 3.2, ambient: 0.42,
    skyColor: 0x6e88b8, groundColor: 0x22262c, elevation: 12, azimuth: 0,
      /* COOL, like everything else. The warm bounce was invented. */
    fillColor: 0x93b2dc, fillIntensity: 0.30,
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
    this.world._deckAudio = null;
    for (const row of this.world?._company?.men || []) { try { row.shove?.dispose(); } catch {} }
  }

  update(dt) {
    stepStrobes(this.world, dt);
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
  /**
   * WHERE THEY COME FROM: THE BULKHEAD DOORS, and until now that was a lie.
   *
   * This said `z: -44`. The bulkhead is at `DECK.aft` — it was -46 when this
   * number was written and it is -104 now — so the men were materialising 60 m
   * out in open deck, four metres from their own marks, and "filing in" was
   * eleven bodies interpenetrating at two points and then fanning sideways.
   * The longest walk in a full company was 23 m and almost all of it lateral.
   *
   * It is derived from the bulkhead now and it can never drift from it again.
   * The doorway `dressStructure` builds is 42 m wide centred on 0, so the two
   * files come out either side of its centre and split at the threshold.
   */
  door: { z: DECK.aft + 8, spread: 7 },
};

/**
 * THE PACE, off `MUSTER.formUp` and the longest walk in the room rather than
 * typed. The far corner of the widest line is about 36 m from the doors; at
 * 8.5 s minus the last man's start offset that is a brisk double-time, which is
 * what a company crossing a deck to a call actually moves at.
 */
const MARCH_SPEED = (() => {
  /**
   * AND IT IS DERIVED, WHICH THE COMMENT ABOVE HAS ALWAYS CLAIMED IT WAS.
   *
   * `MUSTER.formUp` is documented three separate times in this file as "the
   * only figure anybody should ever tune", and the pace was the literal 5.4
   * sitting under all of it: `formUp` was read by nothing and tuning it
   * changed nothing at all.
   *
   * The longest walk on the deck is a corner man of the widest rank going
   * from the doorway to his mark. At `formUp` seconds minus the last man's
   * start offset that is the speed, and now a change to `formUp` moves it.
   */
  const wide = (MUSTER.perRank - 1) * MUSTER.interval / 2 + MUSTER.gap * 2;
  const far = Math.hypot(wide - MUSTER.door.spread, DECK.line - MUSTER.door.z);
  return far / Math.max(1, MUSTER.formUp - 1.0);
})();

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
  const want = opts.army || world?.settings?.army;
  if (!rolls.length) {
    /**
     * AND A PLAYER WITH NO ROLL IS TOLD WHY, rather than left on an empty
     * floor. The button says "Inspect your men"; a fresh save has none, and
     * what happened was that the room opened, `callTheCompany` returned null
     * on its first line, and the player stood in a hangar with nobody in it
     * and no explanation at all.
     */
    world.notify?.('NOBODY ON THE ROLL YET',
      'Fight a run and the men who come back are the men who stand here.', 'flavour');
    return null;
  }
  /**
   * ONE ARMY, AND NEVER THE OTHER ONE AS A FALLBACK.
   *
   * This was `rolls.find(...) || rolls[0]`, three lines under a comment
   * promising that two companies must never be in the same room because one
   * wrong-faction asset kills the illusion. A Separatist player whose
   * Separatist roll was empty got a REPUBLIC company, on a Separatist deck.
   * If the army the player is here as has nobody on it, the honest answer is
   * that nobody falls in — and to say so.
   */
  const roll = want ? rolls.find((r) => r.army === want) : rolls[0];
  if (!roll) {
    world.notify?.('NO ONE OF YOURS ABOARD',
      `Nobody on the ${want} roll. The other side's company does not stand on your deck.`,
      'flavour');
    return null;
  }
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
      /**
       * FACING AFT — at the player, with the aperture behind them. And it is
       * ONE rotation now, not two.
       *
       * `man.facing = Math.PI` and `fig.root.rotation.y = Math.PI` were both
       * being applied, in different frames — the pose yaw is authored in the
       * figure's own space — and they cancelled. Measured on a real rig: the
       * pair composed to hips-forward = +z, which is the APERTURE. Every man
       * on this deck has been standing with his back to the player, under a
       * comment saying the opposite, and it only ever looked survivable
       * because the player was also spawning in the wrong place, on the far
       * side of them, facing the same way.
       */
      man.facing = Math.PI;
      man.stance = 'attention';
      const mark = markFor(i, men.length, order.indexOf(k), order.length);
      /* THEY COME FROM THE DOORS, not from their marks. `stagger` is the
       * per-man offset that stops the column arriving as one organism; the
       * side they come in on alternates so the column splits at the threshold
       * the way a real one does. */
      const side = (i % 2) ? 1 : -1;
      fig.root.position.set(side * MUSTER.door.spread, 0, MUSTER.door.z);
      world.scene.add(fig.root);
      const rowMan = {
        rec, fig, man, mark, squad: k, lead: false,
        /* Each man's own walk: when he starts and how long he takes. The
         * spread is what makes it a company and not a chorus line. */
        /* THE THREE THINGS THAT MAKE IT A COMPANY AND NOT A CHORUS LINE, and
         * they are deliberately three: when he starts (the column does not
         * leave the threshold as one), how fast he walks, and how far he has to
         * go. Any one of them alone still reads as a formation animation. */
        /* TWO DIFFERENT DRAWS, WHICH IS WHAT MADE THIS ONE. Both of these
         * read `stagger(man) % 1` — the SAME number — so the late starter was
         * always, exactly, the slow walker: one draw, perfectly correlated
         * with itself, wearing two hats. A second decorrelated stream off the
         * same seed costs a multiply and makes the claim true. */
        start: 0.10 + (i % 3) * 0.18 + (stagger(man) % 1) * 0.55,
        pace: 0.88 + ((stagger(man) * 7.13 + 0.37) % 1) * 0.26,
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
  /**
   * ══ AND THEY ARE BODIES, WHICH THEY WERE NOT ══════════════════════════
   *
   * `src/physics/Shovable.js` is four hundred lines written for exactly this
   * call, tested end to end through the whole POST → DOWN → REST → RISE →
   * BACK cycle with a real Force push — and it was imported by nothing but its
   * own test. `makeShovable`, the function written to take the row shape this
   * function builds, had never been called by anyone, including that test.
   * "Physics on everything, in the hangar and on every troop" was the brief,
   * and every man on this deck was a hologram the Force went straight through.
   *
   * One dynamic PROP-layer collider a man. `Player._grippableBody` and
   * `forcePush`'s sweep over `physics.bodies` both find them the frame they
   * exist, with no change to Player.js. They sleep at attention, so a company
   * standing still is twenty-four retired islands and costs the solver
   * nothing.
   */
  makeShovable(world, company.men);
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
    /**
     * ══ HE IS A BODY FIRST, AND A FIGURE SECOND ═══════════════════════════
     *
     * While the Force has hold of him — pushed, gripped, hurled, or lying
     * there being annoyed about it — the solver owns where he is and which way
     * up, and this loop's job is to copy that onto the drawn figure and get
     * out of the way. Only once he is back on his feet does the walk and the
     * parade pose resume.
     *
     * `up` is his own recovery blend, so the hand-off is not a pop: the rise
     * is `Shovable`'s, the pose is `Parade`'s, and neither of them has to know
     * about the other.
     */
    const sh = row.shove;
    if (sh) {
      sh.update(dt);
      if (sh.state !== 'post') {
        fig.root.position.copy(sh.at);
        fig.root.quaternion.copy(sh.quaternion);
        /* FLAT OUT OR GETTING UP — no parade pose over either. A man at
         * attention while lying on his back is the uncanny version of this. */
        if (sh.down) { row.merged?.update?.(c.t); continue; }
        man.stance = 'ease';
        poseParade(man, c.t + stagger(man));
        row.merged?.update?.(c.t);
        continue;
      }
    }
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
      /**
       * FACING WHERE HE IS GOING, THEN SQUARING TO THE FRONT AT THE END —
       * and this is the first version of that sentence that does anything.
       *
       * `turnIn` was computed and then `fig.root.rotation.y` was hard-assigned
       * to π on the very next line, so the ripple the comment describes has
       * never been drawn; `turnIn` fed only `man.marching`, which no file in
       * this project reads. A company that squares up in a ripple and one that
       * is already square are two different rooms, and this was the second
       * one with prose about the first.
       *
       * He faces his own travel until the last fifth of the walk, then swings
       * to the front. `atan2` on the velocity he actually has, not on the
       * vector to the mark, so a man stepping sideways into his file faces
       * sideways while he does it.
       */
      const turnIn = smoothstepIn(Math.max(0, (p - 0.8) / 0.2));
      const vx = (mark.x - row.from.x) * 0.75;
      const vz = (mark.z - row.from.z) * (p < 0.66 ? 1 : 0.25);
      const goingTo = (Math.abs(vx) + Math.abs(vz)) > 0.01 ? Math.atan2(vx, vz) : 0;
      /* THE FRONT IS 0, NOT π. `man.facing` already carries the π that turns
       * him to look aft at the player; a second one here is the pair that
       * cancelled. See `callTheCompany`. */
      fig.root.rotation.y = goingTo * (1 - turnIn);
      man.stance = 'attention';
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
      fig.root.rotation.y = 0;
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
  /* `id` and `blurb` are what `OrderWheel` reads off a table — the same two
   * fields `Command.FORMATIONS` carries — so this drops straight into the real
   * wheel with no adapter between. */
  fallin: {
    id: 'fallin', name: 'Fall in', blurb: 'Square the line up and hold at attention.',
    bark: 'COMPANY — FALL IN', stance: 'attention',
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
    id: 'dismissed', name: 'Dismissed', blurb: 'They break off and stand easy where they are.',
    bark: 'COMPANY — DISMISSED', dismiss: true,
  },
};

/**
 * ══ THE DECK'S OWN DIRECTOR, AND IT EXISTS TO OPEN THE REAL WHEEL ═════════
 *
 * `HUD.update` builds the order wheel if and only if `world.command` is set,
 * and `World` assigns that below its own early return for the hangar — so on
 * this deck `world.command` was `undefined` by construction and the wheel
 * could never open. `DECK_ORDERS` and `deckOrder` had zero callers anywhere in
 * the repository, which quietly killed four spec bullets and left two authored
 * poses in `Parade.js` — `atEase` and `presentArms`, a hundred lines between
 * them — as code no player could ever reach.
 *
 * This is the smallest object the wheel and `main.orderKeys` actually read. It
 * is deliberately NOT a `CommandDirector`: that class carries a squad model, a
 * refusal system, runners, morale and a fight to hang them on, and none of
 * those things exist in a room where nothing is shooting at anybody.
 *
 * ORDER_REACH IS HONOURED, and it is the point of putting the interface here.
 * `HANGAR-SPEC.md`'s own line: "walk away from the line and they cannot hear
 * you." It is the fight's own constant, imported from the fight's own file, so
 * the distance a player learns on the deck is the distance he has in a battle.
 */
export function deckCommand(world) {
  return {
    /**
     * THE ONE FIELD THAT KEEPS THIS FROM BEING A CATASTROPHE.
     *
     * `main.bank()` is gated on `world.command` being truthy and nothing else,
     * and its rule for a man who was deployed and is not on an extraction
     * manifest is that he is dead. Setting `world.command` here to open the
     * order wheel therefore put the entire permadeath roll one forgotten exit
     * away from being struck off on every visit to the room whose whole
     * purpose is looking after it. `bank` reads this and returns.
     */
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
      if (!c) return false;
      /* FROM THE MAN, NOT FROM THE MIDDLE OF THE LINE. The nearest man is who
       * has to hear it; a company thirty metres wide is not one listener. */
      let best = Infinity;
      for (const row of c.men) {
        const d = Math.hypot((row.mark.x) - (p?.position?.x ?? 0),
          (row.mark.z) - (p?.position?.z ?? 0));
        if (d < best) best = d;
      }
      if (p && best > ORDER_REACH) {
        world.notify?.('TOO FAR', `${Math.round(best)} m — they cannot hear you from here`, 'alarm');
        return false;
      }
      this.formation = id;
      return deckOrder(world, id);
    },
  };
}

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
  /**
   * DISMISSED BREAKS THE LINE, which is the half of that order the first
   * version did not do: `c.dismissed = c.t` was written and read by nothing,
   * so "dismissed" was a caption over a company still standing rigidly at
   * attention. Each man gets a loose spot of his own near where he stood and
   * walks to it — the same walk `stepCompany` already drives, so this is two
   * fields and no new machinery.
   */
  if (O.dismiss) {
    c.dismissed = c.t;
    c.stance = 'ease';
    for (const row of c.men) {
      const r = (stagger(row.man) % 1);
      const r2 = ((stagger(row.man) * 3.7 + 0.11) % 1);
      row.from = row.fig.root.position.clone();
      row.mark = {
        x: row.mark.x + (r - 0.5) * 14,
        z: row.mark.z + (r2 - 0.5) * 12,
      };
      row.halted = false;
      /* THE CLOCK RESTARTS BELOW, so his start offset is measured from zero. */
      row.start = r * 0.9;
      row.shove.retarget(row.mark);
    }
    c.halted = 0;
    c.t = 0;
  }
  /* FALLING IN AFTER A DISMISSAL PUTS THEM BACK, which is the other half of
   * the same thing: the marks were overwritten, so they have to be dealt
   * again from the same pure function that dealt them. */
  if (id === 'fallin' && c.dismissed) {
    c.dismissed = 0;
    const n = c.men.length;
    const squads = new Set(c.men.map((r) => r.squad)).size;
    for (let k = 0; k < n; k++) {
      const row = c.men[k];
      row.mark = markFor(k, n, row.squad, squads);
      row.from = row.fig.root.position.clone();
      row.halted = false;
      row.start = 0;
      row.shove.retarget(row.mark);
    }
    c.halted = 0;
    c.t = 0;
  }
  if (O.sing) {
    /* THEIR OWN VOICE AND NOT YOURS. `DeckAudio` synthesises it with no words
     * in the source, the same rule the PA is held to, and it is picked off the
     * roll's army so a Separatist company never sounds Republic. */
    c.singing = 1;
    companySing?.(world, c.army, c.men.length);
  }
  world.notify?.(O.bark, `${c.men.length} ${c.men.length === 1 ? 'man' : 'men'}`);
  return true;
}

/* THE SINGING IS `DeckAudio`'s TO MAKE and it may not exist yet — that file is
 * being written beside this one. A missing voice must not take the order down
 * with it, so the call is resolved late and guarded. */
let companySing = null;
export function setCompanySing(fn) { companySing = fn; }


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
