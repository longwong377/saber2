/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FLIGHT DECK, HEARD — the hull, the field, the tannoy and the boots
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The deck's whole promise is that it is a PLACE, and `Levels.js` has deleted
 * six interiors for failing exactly that. Nothing in this file draws anything,
 * so none of it can be screenshotted, and it is worth being explicit about
 * what it is therefore for: an interior that looks right and sounds like the
 * outdoors reads as a set. The one sense that can say "there is a hull around
 * you and vacuum on the other side of it" without drawing a single triangle is
 * this one.
 *
 * ── THE ONE IDEA THIS FILE IS BUILT ON ────────────────────────────────────
 *
 * WALKING TOWARD THE SHIELD HAS TO CHANGE WHAT YOU HEAR. Everything else here
 * is furniture around that. The room behind you is a machine — a hull hum, a
 * tannoy, coolant letting go somewhere in the dark, boots on plate — and two
 * metres from the field it is all gone but the sub, because there is nothing
 * on the other side of that plane for sound to be made of. `HANGAR-SPEC` calls
 * it "audible pressure differential — muffled hush right at the boundary, deck
 * noise behind you", and it is the single most convincing thing on the list
 * because it is the only one the player CAUSES.
 *
 * So the bed, the tannoy and the vents all pass through one filter and one
 * gain (`chain` below) whose two numbers are a function of where the player is
 * standing, and the room's reverb send goes with them. MEASURED, by rendering
 * the real graph offline and integrating it — `tools/checks/deck-audio.mjs`,
 * on `tools/checks/_offline-audio.mjs` — walking from the spawn to the lip:
 *
 *     3 kHz – 12 kHz   −18.3 dB
 *     800 Hz – 3 kHz   −18.2 dB
 *     200 – 800 Hz     −12.7 dB
 *     60 – 200 Hz       −1.9 dB
 *     20 – 60 Hz        +0.7 dB      ← the hull, and it gets LOUDER
 *
 *     A-weighted total −12.3 dB, and the share of the bed's energy under
 *     200 Hz goes from 90% to 99%.
 *
 * That is the shape of a room being taken away and a hull being left behind.
 * The unweighted RMS moves by 0.0 dB across the same walk and that number is
 * true and useless: this bed is 72% sub by energy, so a plain RMS measures the
 * one layer the boundary is supposed to leave alone. It is quoted here so that
 * nobody re-derives it later and concludes the feature does nothing.
 *
 * ── WHAT READS THE LEVEL'S OWN `ambience`, AND WHY IT IS NOT ENOUGH ───────
 *
 * `HANGAR_LEVEL.ambience = { wind: 0, windFreq: 90, drone: 0.20 }` is read by
 * `World.loadLevel` (`World.js:864`) into `AudioEngine.setAmbience`, which
 * lands on the shared bed built in `_startAmbience`: five sines at 55, 82.4,
 * 110, 164.8 and 220 Hz — A1, E2, A2, E3, A3, a stack of perfect fifths — with
 * a slow LFO each, through a 900 Hz lowpass, scaled by `drone`. It delivers
 * about 0.079 into `ambBus` at 0.20, and it is a good, cheap, MUSICAL drone.
 *
 * It is not a hull, for three reasons that are all in the shipped code:
 *
 *   IT IS PITCHED. A perfect-fifth stack on A is a chord. A ship is a plant —
 *     pumps and turbines whose blade-passing tones are not in any key and beat
 *     against each other rather than consonating.
 *   IT ANSWERS THE FIGHT. `_bed()` writes `droneGain` every frame as `base +
 *     0.09 × intensity`, and `intensity` on the deck is zero forever. Whatever
 *     this file wrote there would be overwritten sixty times a second by a
 *     number that never moves.
 *   IT CANNOT BE FILTERED FROM HERE. The pressure differential is a filter
 *     between a bed and the bus. The shared bed's only insert is a fixed
 *     900 Hz lowpass shared by all ten levels, and putting a per-position
 *     filter in there would put it under the Ember Shelf as well.
 *
 * So the level's drone STAYS, at 0.20, and is used as what it is good at: an
 * unmoving sub-floor under everything. The deck's own bed is built on top of
 * it, and everything the deck's bed does is something the shared one cannot.
 *
 * ── NOTHING HERE IS A SAMPLE ──────────────────────────────────────────────
 *
 * `Audio.js` opens with the rule and it is not a preference: `packed.mjs` boots
 * the single-file build from `file://` and fails on one byte fetched off-page.
 * Every sound below is oscillators and shaped noise. Where that costs
 * something honest — a human voice is the hardest thing in the world to
 * synthesise — the design goes around it rather than pretending, which is why
 * the PA is deliberately unintelligible and why that is a feature and not an
 * excuse. See `PA_VOICE`.
 *
 * ── HOW IT IS WIRED ───────────────────────────────────────────────────────
 *
 * Three calls, and the third is optional:
 *
 *     dressHangar(world)        …ends with `dressDeckAudio(world)`
 *     World.update(dt, camera)  …`stepDeckAudio(world, dt, camera)`, AFTER
 *                               `audio.updateListener(camera)` so the ear's
 *                               own velocity is this frame's rather than last
 *                               frame's — see `AudioEngine.dopplerRatio`
 *     leaving the deck          `undressDeckAudio(world)`, which is only
 *                               needed to put the deck's footstep materials
 *                               back: the BED registers its own teardown with
 *                               `audio.hold`, which `World.unload` already
 *                               drains through `stopLoops()`
 *
 * …plus the one-shots, which are for other people's code to call at the moment
 * the thing happens, because this file cannot see any of them:
 *
 *     hullThump(world, strength, {delay|range})   an explosion outside
 *     drainBlasts(world)                          …or every one the player
 *                                                 actually SAW, off the queue
 *                                                 `SkyDome` already publishes
 *     repulsorPass(world, {from, to, speed, …})   a ship crossing
 *     launchSequence(world, {x, z, speed})        a ship leaving, in four beats
 *     damagedArrival(world, {x, z, speed})        one coming back in a state
 *     bootStride(world, man, pos, dt)             one man walking, per frame
 *     bootFall(world, pos) / bootHalt(world, at, n)   the muster
 *     deckChant(world, army, men)                  the company, on command
 *     paCall(world) / ventBurst(world, at)        on demand, if the schedules
 *                                                 are turned off
 *     cuePaint / cueAttach / cueDetach / cueName  a man being changed
 *
 * ── WHAT `Hangar.js` HAS TO ADD, AND IT IS THREE LINES ───────────────────
 *
 * Two of these had no caller anywhere in `src/` and the third is a seam that
 * is already there and unfilled. All three are one line each:
 *
 *     HangarDirector.update, on the line after `stepDeckAudio(...)`
 *         drainBlasts(this.world);
 *     stepCompany, inside `if (p < 1)`, after `fig.root.position` is written
 *         bootStride(world, row, fig.root.position, dt);
 *     once, at module scope beside the other wiring
 *         setCompanySing(deckChant);
 *
 * The last one is why `deckChant` is positional: `deckOrder` already calls
 * `companySing?.(world, c.army, c.men.length)`, so the signatures meet with no
 * adapter between them.
 *
 * ── SILENT AND SAFE HEADLESS ──────────────────────────────────────────────
 *
 * Every check in this repository runs with no `AudioContext` at all:
 * `tools/dom-shim.mjs` defines no audio of any kind, so `audio.init()` returns
 * at `const AC = window.AudioContext || window.webkitAudioContext; if (!AC)
 * return;` and `audio.ready` stays false for the life of the process. Every
 * entry point in this file therefore begins by asking, and the ones that build
 * graphs go through `audio.shape` / `audio.open`, which ask again. A deck
 * dressed with no context is a deck with a state object and no nodes, which
 * steps, thumps, musters and tears down exactly like a live one and makes no
 * sound. That is the same contract `dressHangar` has with a headless renderer.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { audio, PRIO, SPEED_OF_SOUND } from '../engine/Audio.js';
import { clamp, damp, smoothstep, makeRng } from '../engine/MathUtil.js';
/* DEREFERENCED INSIDE FUNCTIONS ONLY, never at module scope. `Hangar.js` is
 * expected to import this file to wire the two entry points up, which makes
 * the pair a cycle; ES modules resolve one, but a `const` read during the
 * other module's evaluation is a temporal-dead-zone throw. Reading `DECK` from
 * inside a call that happens after both modules have finished evaluating
 * cannot be that, whichever order the loader picks. */
import { DECK } from './Hangar.js';
/* THE SAME RULE, FOR THE SAME REASON. `ground` is `Scenery.js`'s published
 * singleton and `SkyDome` writes the battle's flashes onto it; it is read
 * inside `drainBlasts` and nowhere at module scope, so nothing here depends on
 * which of the two modules the loader evaluates first. */
import { ground } from '../world/Scenery.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE BED — what a capital ship sounds like from the inside             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * SEVEN LAYERS, AND EVERY FREQUENCY IN THE TABLE IS AN ARGUMENT.
 *
 * A hull's own structural modes are single-digit hertz — a 400 m keel is a
 * beam whose fundamental is around 1–3 Hz — so they are FELT and never heard,
 * and a bed built on them is a bed that is not there. What you actually hear
 * standing on a large ship is the PLANT: rotating machinery, at the frequency
 * at which its blades pass. So:
 *
 *   `sub` — TWO sines 0.43 Hz apart at 27.5 and 27.93 Hz. 27.5 is A0, the
 *     bottom of a piano, chosen because at that pitch a small speaker
 *     reproduces LEVEL rather than PITCH: it arrives as weight, which is the
 *     right lie for a hull. Two of them and not one because the 0.43 Hz
 *     difference beats with a 2.33 s period, and that slow swelling is the
 *     whole tell that the thing making it is enormous. It is also the layer
 *     the field cannot take away — see `PRESSURE`.
 *   `plant` — 55.3 Hz triangle, an octave over the sub and 0.3 Hz sharp of it
 *     on purpose. Exactly 55 would fuse into the sub and be heard as timbre;
 *     0.3 Hz out, it beats at a 3.3 s period against a 2.33 s one, and two
 *     incommensurate beats never repeat inside anybody's attention span.
 *   `turbine` — 83.4 Hz sawtooth into a resonant 300 Hz lowpass (Q 3.2). A saw
 *     is a full harmonic series; a resonant lowpass over it is the cheapest
 *     formant there is, and it is what turns a buzz into a machine with a
 *     throat. NEAR the sub's third harmonic and 0.9 Hz off it — 82.5 was
 *     written first and `deck audio: the bed is a hull and not a chord` caught
 *     it as an EXACT 3:1, which fuses into the sub and is heard as its timbre
 *     rather than as a second machine. The whole difference between a plant
 *     and a chord is that nothing in a plant is tuned to anything else in it.
 *   `rumble` — pink noise at 0.61× rate through a 190 Hz lowpass. The loudest
 *     single layer (0.085) and the one that carries the room. Pink and not
 *     white because pink is −3 dB/octave, which is what broadband structural
 *     noise measures like; white through the same filter is a hiss with the
 *     top cut off.
 *   `air` — pink at 1.13× through a 640 Hz bandpass. THE HANDLING PLANT, and
 *     the layer the pressure filter is really about: 640 Hz is squarely inside
 *     the band a lowpass at 210 Hz annihilates, so this is most of what
 *     "vanishes as you walk to the edge" is made of.
 *   `hiss` — pink at 0.87× through a 3.1 kHz bandpass, very quiet (0.012). Two
 *     jobs: it is the coolant plant that `HANGAR-SPEC` asks to be always there
 *     at the periphery, without four held positional voices to hold it there,
 *     and it is the top end that makes the pressure filter's closing audible
 *     as a CLOSING rather than as a fade.
 *
 * THE THREE NOISE LAYERS RUN AT THREE INCOMMENSURATE RATES off ONE two-second
 * buffer, which is the same trick and the same reason as `BATTLE_BANDS`: three
 * copies of a 2 s loop at 1.0 lock into one audible 2 s period, and a listener
 * finds a two-second loop in about ninety seconds. At 0.61, 0.87 and 1.13 the
 * combined period is 2 s / gcd of the rates — in practice, never.
 *
 * MEASURED, rendered offline and integrated over 4.5 s: with the room open
 * (`p = 0`) the bed is 0.0378 RMS at a 0.147 peak, 72% of its energy in
 * 20–60 Hz, 18% in 60–200, 9% in 200–800 and 0.8% above 800. At the lip
 * (`p = 1`) it is 0.0377 RMS at a 0.126 peak and 87 / 12 / 0.5 / 0.0. The
 * peak matters: the level's own drone bed peaks around 0.13, and a deck bed
 * that arrived louder than the drone it sits under would be a room with two
 * floors in it.
 */
export const DECK_BED = {
  sub: [{ f: 27.5, g: 0.030 }, { f: 27.93, g: 0.026 }],
  plant: { f: 55.3, g: 0.020, type: 'triangle' },
  turbine: { f: 83.4, g: 0.022, type: 'sawtooth', lp: 300, q: 3.2 },
  rumble: { rate: 0.61, type: 'lowpass', freq: 190, q: 0.80, g: 0.072, lfo: 0.047, depth: 0.25 },
  air: { rate: 1.13, type: 'bandpass', freq: 640, q: 0.55, g: 0.045, lfo: 0.031, depth: 0.40 },
  hiss: { rate: 0.87, type: 'bandpass', freq: 3100, q: 0.50, g: 0.016, lfo: 0.019, depth: 0.30 },
};

/**
 * ══ THE FIELD, AS A PRESSURE BOUNDARY ═════════════════════════════════════
 *
 * `edgeOf` is metres to the nearest open side. It is a MINIMUM over three
 * bearings and not a radius, because the deck has one wall and it is aft: a
 * radial measure would start hushing the room as the player walked toward the
 * bulkhead, which is the one direction where there is more ship rather than
 * less.
 *
 * `inner`/`outer` — the hush is nothing at 22 m and total at 2 m, and the
 * curve between them is `smoothstep` raised to 1.6 so that most of the travel
 * happens in the last eight metres. Linear was tried on paper and rejected for
 * a reason worth writing down: a player crossing a 128 m deck spends most of
 * his walk in the transition, so a linear ramp is a room that is quietly wrong
 * everywhere instead of a boundary that is somewhere. At 12 m out the curve is
 * at 0.33; at 6 m it is at 0.84.
 *
 * THE FOUR THINGS IT MOVES, and each is a different physical claim:
 *
 *   `lp` 19 kHz → 210 Hz, GEOMETRICALLY interpolated (an octave is a ratio,
 *     not a difference — a linear sweep of a cutoff spends nine tenths of its
 *     travel above 2 kHz where nothing in this bed lives). This is the air
 *     that is not there.
 *   `cut` 1.0 → 0.42 on the whole deck bus. This is the room that is not
 *     behind you any more.
 *   `tilt` +6 dB of lowshelf at 110 Hz. This is the one thing that gets
 *     LOUDER, and it is the point: structure-borne sound does not need air, so
 *     what is left when the room goes is the hull under your boots. Without
 *     this the boundary reads as a mute rather than as a place.
 *   `send` the convolver send down to 0.05 from whatever `roomOf` derived for
 *     the deck (0.38 at `metal`). A reverb is reflections, and there is nothing
 *     out there to reflect off.
 *
 * `hush` is the only NEW sound: 0.030 of a 1.15 kHz band of pink, on a `p^2.2`
 * curve so it exists only in the last few metres, plus a 214 Hz emitter tone at
 * a third of that. It is deliberately almost nothing. The boundary is sold by
 * what stops, and a boundary that announced itself with a sound of its own
 * would be the fourth loud thing in a room whose composition is about silence
 * at the edge.
 */
export const PRESSURE = {
  inner: 2, outer: 22, shape: 1.6,
  lp: [19000, 300], stages: 2, cut: 0.45, tilt: 8, send: 0.05,
  hush: 0.014, emitter: 214,
  /** Below this much movement in `p`, do not reschedule. See `_bed`'s note. */
  step: 0.012,
};

/** Metres from (x, z) to the nearest open side of the deck. Pure. */
export function edgeOf(x, z) {
  return Math.min(DECK.lip - Math.abs(x), DECK.lip - z);
}

/** How closed-in the room is at (x, z): 0 on the deck, 1 with your nose on the field. */
export function pressureAt(x, z) {
  const t = 1 - smoothstep(PRESSURE.inner, PRESSURE.outer, edgeOf(x, z));
  return Math.pow(clamp(t, 0, 1), PRESSURE.shape);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  WHERE THE ROOM'S SURFACES ARE                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ EVERY EMITTER IN THIS FILE IS A FRACTION OF `DECK`, AND HERE IS WHY ═══
 *
 * `d1e3a92` doubled the room — aft −46 → −104, lip 64 → 144, the ground
 * 128 m → 288 — and nothing in this file moved, because nothing in it referred
 * to the room: it referred to a set of coordinates that had been true OF the
 * room. Three things were wrong the moment that commit landed and all three
 * were silent:
 *
 *   THE TANNOY CAME OFF THE WALLS. The bulkhead pair sat at z = −43.5, 60 m
 *     forward of the bulkhead they were named after, with nothing inside 40 m
 *     of them but the deck 9.5 m below — measured by ray against the built
 *     scene, which is what `deck-audio.mjs` does now.
 *   THREE VENTS HISSED OVER A HOLE. `hangardeck.height` puts a 3.2 m pit
 *     around x = −52; the port vents were in it.
 *   THE TRAFFIC LANE CAME INDOORS. `z: [96, 138]` was outside a lip at 64 and
 *     is the front third of a room whose lip is at 144, so every "distant"
 *     pass flew through the hangar at 14–34 m while being filtered as though
 *     it were behind the shield.
 *
 * None of it could go red, because the check built its world as
 * `{ terrain: null }` and typed the old spawn in thirteen places while reading
 * the live `DECK.lip`. That is the root cause of the whole class, so the fix
 * is in two halves and the one that matters is the check: coordinates derived
 * here can still be wrong, and the ray probe is what says so.
 *
 * WHAT THE FRACTIONS ARE OF. `DECK.aft` and `DECK.lip` are the room's two ends
 * and `DECK.roof` is its top, so the depth, the half-width and the overhead
 * are the three rulers everything below is measured with. `rack` is the one
 * ratio taken of a number this file cannot see — `Hangar.js`'s `WALL`, a local
 * const rather than a field of `DECK` — which is exactly why every position
 * derived from it is fired at the real geometry by the check.
 */
export const GEOM = {
  /**
   * The rack walls: x = ±DECK.lip × this. READ OFF `DECK.wall`, lazily — a
   * getter rather than a literal, because this object is built at import and
   * `DECK` is in the temporal dead zone then (the import cycle `frame()`
   * documents in DeckLife.js). `56 / 144` sat here as a literal while the
   * walls moved to 80, which is exactly the four-independent-copies-of-56
   * defect the audit named.
   */
  get rack() { return DECK.wall / DECK.lip; },
  /** How far the rack run reaches, as fractions of the depth aft of `DECK.aft`. */
  rackFrom: 0.03, rackTo: 0.69,
  /** The bulkhead's inboard face, the same way. The ribs stand at aft + 6…8 m. */
  face: 0.030,
  /** The cantilevered plates and the blast channel, as fractions of the half-width. */
  lipBand: 6 / 144, grateBand: 14 / 144,
  /** The grating apron at the bulkhead doors: half-width, and how far out. */
  apron: 0.15, apronTo: 0.12,
  /** How far off a wall an emitter hangs, so it is ON it and not IN it. */
  standoff: 1.4 / 144,
  /** The horns: how far outboard of the doors, and how high up each surface. */
  hornX: 0.30, hornBulk: 0.30, hornRack: 0.25, hornZ: 0.35,
  /** The vents: how far inboard of the wall, and where along the run. */
  ventX: 0.028, ventAt: [0.18, 0.22, 0.60, 0.52],
};

/** The room's length, which is what most of the fractions above are of. */
const deckDepth = () => DECK.lip - DECK.aft;
/** A fraction of the way forward from the bulkhead. */
const alongDeck = (f) => DECK.aft + deckDepth() * f;
/** Where the rack walls stand. */
const rackX = () => DECK.lip * GEOM.rack;
/** The bulkhead's inboard face — the only solid surface in the level. */
const faceZ = () => alongDeck(GEOM.face);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE DECK UNDERFOOT                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHAT A BOOT LANDS ON, AT (x, z) ═══════════════════════════════════════
 *
 * `Terrain.surfaceAt` (`Terrain.js:3783`) opens `if (this.preset.flat) return
 * 'metal'` — one keyword for every square metre of every flat ground in the
 * game, which for a hangar means the plate by the bulkhead, the blast channel
 * at the edge and the last cantilevered plates over vacuum are all the same
 * 3400 Hz tick. `HANGAR-SPEC` asks for "your own footsteps changing material as
 * you walk toward the shield", and a deck where they do not is a deck the ear
 * cannot navigate.
 *
 * THIS IS NOT A SECOND FOOTSTEP SYSTEM AND MUST NEVER BECOME ONE. There is
 * exactly one path from a foot to a sound in this game — `Player._footstep`
 * asks `terrain.surfaceAt`, `Enemy` asks it, `Presence` asks it twice, and
 * `Particles.surfaceTint` asks it for the colour of the grit that comes up —
 * and all four of them are served by this, because `dressDeckAudio` installs it
 * as an OWN PROPERTY on the live terrain INSTANCE, in front of the prototype
 * method. Every existing reader picks it up, nobody is edited, and it goes away
 * with the terrain rather than with a flag somebody has to remember.
 *
 * The three zones are what a flight deck actually is, and every one of them is
 * a FRACTION OF `DECK` rather than a distance — see `GEOM`:
 *
 *   `plate`   everything from the bulkhead out to the blast channel, plus the
 *             middle of the room where the company forms up.
 *   `grating` a ring inside the lip — the blast channel, which every deck open
 *             to a drive wash has and which is grating because it has to drain
 *             and vent. Also the apron immediately outside the bulkhead doors,
 *             which is a drain and a boot scraper on any deck anybody has to
 *             walk out onto, so the material change is not only a thing that
 *             happens at the edge — and it is the one the COMPANY crosses,
 *             because the company files out of those doors.
 *   `lip`     the last plates. Cantilevered steel with nothing under it.
 *
 * THE APRON REPLACES A WALKWAY THAT NO LONGER EXISTS, and the replacement is
 * chosen for where it can be TRUE. This zone used to name a gantry at x = −34
 * that `d1e3a92` deleted, and half of what was left of it lay over the pit
 * `hangardeck.height` cuts around x = −52 — a patch of open steel bar reported
 * over a 3.2 m hole in the deck. The obvious repair, a lane at each rack-wall
 * foot, walks straight back into it: the port wall stands at x = −56 and the
 * pit runs from −69 to −35, so that lane would cross the same hole.
 *
 * A PURE FUNCTION OF (x, z) CANNOT SEE THE GROUND, so it must not claim a
 * surface where the ground is free to move. The apron is at the doors, where
 * this room has a solid bulkhead and flat plate and always will, and
 * `deck-audio.mjs` samples every zone this function reports against
 * `terrain.height` — so if a future pit is cut under one of them, that is red
 * rather than a walkway over a void.
 *
 * WHY A RING AND NOT A STRIPE. The player walks out to the field on whatever
 * bearing he feels like; a stripe across the front of the room is a change he
 * finds once and then walks around. The ring is the deck's edge, which is the
 * one thing this composition is built to make him walk to.
 *
 * UNKNOWN KEYS ARE SAFE EVERYWHERE THEY GO, checked rather than assumed:
 * `Audio.SURFACES` has rows for all three (added with this file);
 * `Particles.surfaceTint` falls through to `preset.sandColor ?? null`;
 * `Player._footstep` branches only on `'water'`; and `World.roomOf`'s
 * `GROUND_ECHO[surface] ?? 0.4` is never asked, because `World.loadLevel`
 * derives the room at stage 4 and this is installed by `dress` at stage 6 —
 * so the deck's reverb is still derived from the honest `'metal'`.
 */
export function deckSurfaceAt(x, z) {
  const e = edgeOf(x, z);
  if (e < DECK.lip * GEOM.lipBand) return 'lip';
  if (e < DECK.lip * GEOM.grateBand) return 'grating';
  /* The apron outside the bulkhead doors — a drain and a scraper, and the
   * plate the company walks out onto. `dressStructure` puts the doors on the
   * centreline of the bulkhead; this is the deck in front of them. */
  if (Math.abs(x) < DECK.lip * GEOM.apron
      && z > alongDeck(GEOM.face) && z < alongDeck(GEOM.apronTo)) return 'grating';
  return 'plate';
}

/**
 * ══ BOOTS ON A DECK — and the reason ten of them are one sound ════════════
 *
 * `PRIO`'s own note is the measurement this is written against: over 24 s of a
 * real fight the game asked for 3435 sounds and 3230 of them — 94% — were
 * footsteps, the pool of 44 sat completely full for nine seconds at a stretch,
 * and every bolt impact that arrived in that window was thrown away. The muster
 * puts up to twenty-four men on the deck at about 1.8 paces a second, which is
 * 43 footfalls a second into a chatter band whose entire ceiling is fifteen
 * live voices. Passed straight through, the company would take the pool with
 * it and then be refused anyway.
 *
 * IT IS ALSO WRONG AS SOUND. A rank marching in step is ONE event. Ten men
 * landing inside 50 ms of each other is not ten footsteps, it is a stamp — and
 * the difference is not volume, it is that the ear fuses them and hears a
 * bigger, lower, longer thing. `footfall` already knows how to make that: it
 * takes a `mass` and derives pitch (`m^-0.26`), level (`m^0.28`) and length
 * from it, and adds `bodyThump` — the ground answering — over 2.75 reference
 * masses.
 *
 * SO THE WINDOW IS THE PHYSICS AND NOT A BUDGET, which is the part worth
 * getting right. Sound covers 343 m in a second; the line forms up 22 m from
 * where the player is put down, and 22 m is 64 ms of travel. A 55 ms
 * coalescing window is SHORTER than the propagation delay of the thing it is
 * coalescing, so it cannot introduce a latency a listener could detect even in
 * principle — the sound already had further to come than the window is long.
 *
 * WHAT IT RENDERS, through the shipped `footfall` and its own exponents. Four
 * boots inside the window become one stamp at 2.65 reference masses: 4.4
 * semitones lower (`m^-0.26`), 2.4 dB louder (`m^0.28`) and 23% longer. FIVE
 * is where the total passes 2.75 and `footfall` adds `bodyThump`, so the deck
 * itself answers — which is the right place for that line, because four men
 * stamping is a sound and five is a rank. Rendered from 22 m: one boot peaks
 * at 0.0025 and ten together at 0.0109, a factor of 4.4 for ten times the men,
 * which is the saturation doing what a rank actually does.
 */
export const BOOT = {
  /** Seconds a rank has to land in before it is one sound. See above. */
  window: 0.055,
  /** One man, in armour and boots, as a multiple of `Audio.REF_MASS` (80 kg). */
  each: 1.0,
  /** How much of the n-th man is heard. A rank saturates; it does not sum. */
  fold: 0.55,
  /** …and the ceiling, so a company of 24 is a stamp and not an explosion. */
  cap: 9,
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE TANNOY                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE PA, AND WHY IT MUST NOT BE UNDERSTANDABLE ═════════════════════════
 *
 * `HANGAR-SPEC`: "Idle chatter callouts on the PA, distant and unintelligible."
 * That is the design and not a limitation, and it is worth defending because
 * the temptation to make it say words is enormous.
 *
 * A PA that says a sentence is a NARRATOR. The player looks up, listens,
 * decodes it, finds it says nothing that matters, and never listens again —
 * and worse, on the second visit he recognises the line. Twelve recorded
 * announcements is twelve things a player can exhaust in ten minutes. A tannoy
 * he cannot quite make out is a tannoy that is still working on the fortieth
 * visit, because there is nothing there to exhaust: it is a room being
 * administered by somebody else, which is exactly what a hangar is.
 *
 * ── HOW A VOICE THAT SAYS NOTHING IS BUILT ────────────────────────────────
 *
 * One sawtooth is the larynx — a full harmonic series, which is what vocal
 * folds actually produce — through TWO parallel bandpasses which are the first
 * and second formants. F1 and F2 are the whole of vowel identity in speech
 * acoustics; move them and the vowel changes, and a `formants` table of four
 * pairs is four vowels this voice can be in. Consonants are deliberately
 * absent, and that single omission is most of what makes it unintelligible
 * while still being unmistakably a person: consonants are where the
 * information is, vowels are where the voice is.
 *
 * The SYLLABLE is the unit — 85 to 155 ms with a 20 ms onset and a 30 ms
 * release, separated by 12–50 ms, with a longer break every two to four for a
 * word boundary. The LAST syllable falls 14% in pitch, because a declarative
 * sentence ends on a fall in every language anybody is going to be listening
 * in, and that one number does more to make it read as an announcement than
 * the formants do.
 *
 * ── AND THEN IT IS PUT THROUGH A HORN ─────────────────────────────────────
 *
 * A tannoy is a compression driver on a horn, and it sounds the way it does
 * because of what it cannot do: nothing under about 340 Hz (the horn's cutoff),
 * nothing over about 2.6 kHz (the driver's), a hard resonance around 1.7 kHz
 * where the horn's throat rings, and audible distortion because it is always
 * being driven too hard. All four are in `horn`, and the last one is a
 * `WaveShaper` on a soft-clip curve — the only nonlinearity in this project and
 * the reason the PA sounds like a speaker rather than like a synthesiser.
 *
 * ── FACTION ───────────────────────────────────────────────────────────────
 *
 * `HANGAR-SPEC` is absolute about this: "Never mix — if the player sees one
 * wrong-faction asset the whole illusion dies." The two rows are two different
 * machines, not two settings:
 *
 *   `republic` a two-tone bell up a perfect fourth, then a person. 128 Hz
 *     larynx, a wide 6% pitch drift, an unhurried syllable, a horn that
 *     reaches 2.6 kHz. It is a man in a compartment somewhere with a
 *     microphone.
 *   `separatist` three flat pips at one pitch, then a machine. 96 Hz, almost
 *     no drift (1.5% — the flatness IS the character), fast, short syllables,
 *     and a horn 700 Hz narrower at the top with more drive, so it is a worse
 *     speaker as well as a worse voice. Droid comms are not people being
 *     transmitted, they are a network talking to itself out loud.
 */
export const PA_VOICE = {
  republic: {
    chime: [880, 1174.7], pip: 0.20, pipLen: 0.16, chimeType: 'sine', chimeGain: 0.16,
    f0: 128, drift: 0.06, fall: 0.86,
    formants: [[560, 1180], [700, 1420], [430, 900], [610, 1650]],
    syl: [0.085, 0.155], gap: [0.012, 0.050], word: [0.10, 0.20],
    horn: { hp: 340, ring: 1700, ringDb: 7, ringQ: 1.6, lp: 2600, drive: 2.6 },
    words: [4, 11], pre: 0.22, gain: 3.0,
  },
  separatist: {
    chime: [620, 620, 620], pip: 0.13, pipLen: 0.075, chimeType: 'square', chimeGain: 0.11,
    f0: 96, drift: 0.015, fall: 0.94,
    formants: [[480, 1520], [520, 1560], [455, 1495]],
    syl: [0.062, 0.098], gap: [0.010, 0.026], word: [0.06, 0.12],
    horn: { hp: 420, ring: 1450, ringDb: 9, ringQ: 2.4, lp: 1900, drive: 4.2 },
    words: [5, 13], pre: 0.14, gain: 3.0,
  },
};

/**
 * ══ WHERE THE HORNS ARE, AND THEY ARE ON SOMETHING ════════════════════════
 *
 * Four of them: a pair high on the bulkhead outboard of the doors, and a pair
 * on the two rack walls level with the middle of the room. The PA has a PLACE,
 * which is what makes it get quieter and duller as the player walks away from
 * the ship and toward the field, for free, through the panner it is already on
 * and the chain it already sits in.
 *
 * THAT ARGUMENT ONLY HOLDS IF THE HORNS ARE BOLTED TO THE SHIP. Written as
 * four literals for a 128 m room they survived the rebuild unchanged and the
 * bulkhead pair ended up hanging in mid-air 60 m forward of the bulkhead, with
 * nothing inside 40 m of them but the deck 9.5 m below. A tannoy in open space
 * still gets quieter with distance — a panner does that to anything — and it
 * is quieter from the wrong place, which is worse than being non-positional,
 * because the ear is being told a wall is somewhere there is no wall.
 *
 * Derived rather than typed, so the next rescale carries them, and probed by
 * ray against the real scene in `deck-audio.mjs`, so a derivation that is
 * wrong is red rather than quiet.
 */
function hornSites() {
  const off = DECK.lip * GEOM.standoff;
  const rx = rackX() - off;
  const fz = faceZ() + off;
  return [
    [-DECK.lip * GEOM.hornX, DECK.roof * GEOM.hornBulk, fz],
    [DECK.lip * GEOM.hornX, DECK.roof * GEOM.hornBulk, fz],
    [-rx, DECK.roof * GEOM.hornRack, alongDeck(GEOM.hornZ)],
    [rx, DECK.roof * GEOM.hornRack, alongDeck(GEOM.hornZ)],
  ];
}

/** How long between announcements. Long, because a tannoy that talks is a radio. */
const PA_GAP = [26, 74];

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE PERIPHERY                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * COOLANT AND STEAM, and they are EVENTS rather than a hiss.
 *
 * Four held positional hisses at the corners of the room would cost four of the
 * world band's thirty voices for the entire visit and would be four constants —
 * and a constant is the one thing the ear stops hearing. A vent that lets go
 * every twelve to fifty seconds is heard every single time, costs one voice for
 * two seconds, and is the "motion in the periphery is worth more than detail"
 * line from `HANGAR-SPEC` applied to sound.
 *
 * The always-there half is not dropped, it is folded into the bed: `DECK_BED
 * .hiss` is the plant that never stops, non-positional, sharing a source with
 * the rest of the bed and costing nothing.
 *
 * ── AND A VENT NEEDS DECK UNDER IT ───────────────────────────────────────
 *
 * Four literals aimed at props `dressStructure` no longer builds put three of
 * these over the pit `hangardeck.height` cuts around x = −52: a coolant line
 * letting go 3.2 m above the nearest plate, which is a sound with no object
 * under it. The pit is TERRAIN, so no amount of care with the dressing could
 * have found it and no table of positions written here can be right about it —
 * the pit is free to move, and the same commit that moved the room moved it.
 *
 * So the sites are derived at the wall feet, where a deck of this shape puts
 * its trunking, and then each one ASKS THE GROUND: `world.terrain.height` at
 * the site, and if the answer is a hole the site slides along the wall until
 * it is on plate. That is the whole of it, it runs once per visit, and it is
 * the difference between a position that was right when it was typed and one
 * that is right now.
 */
/** How far below the deck plane counts as "not deck". Half a step. */
const ON_DECK = 0.6;

/** What the ground is doing at (x, z), or 0 with no terrain to ask. */
function deckUnder(world, x, z) {
  const t = world?.terrain;
  return (t && typeof t.height === 'function') ? t.height(x, z) : 0;
}

/** The nearest z along the wall at `x` that has deck under it, or null. */
function onDeckZ(world, x, z0) {
  if (Math.abs(deckUnder(world, x, z0)) < ON_DECK) return z0;
  const near = alongDeck(GEOM.rackFrom), far = alongDeck(GEOM.rackTo);
  for (let d = 3; d <= deckDepth() * 0.3; d += 3) {
    for (const s of [-1, 1]) {
      const z = z0 + s * d;
      if (z <= near || z >= far) continue;
      if (Math.abs(deckUnder(world, x, z)) < ON_DECK) return z;
    }
  }
  return null;
}

/** The four vent sites for this world, on the deck, at the wall feet. */
function ventSites(world) {
  const x0 = rackX() - DECK.lip * GEOM.ventX;
  const gaps = [[14, 46], [18, 55], [16, 50], [22, 62]];
  const out = [];
  for (let i = 0; i < GEOM.ventAt.length; i++) {
    const x = (i % 2 ? 1 : -1) * x0;
    const z = onDeckZ(world, x, alongDeck(GEOM.ventAt[i]));
    if (z === null) continue;
    /* THE ONE NUMBER HERE THAT IS NOT A FRACTION, and it is written down so it
     * is a decision rather than an oversight: a valve is at the height of the
     * hand that closes it. A person does not scale with the room, so a vent
     * keyed to `DECK.roof` would be at 3 m in a room twice this tall. */
    out.push({ at: [x, 1.4, z], gap: gaps[i % gaps.length] });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE WAR, THROUGH THE HULL                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A HIT ON THE SHIP YOU ARE STANDING IN ═════════════════════════════════
 *
 * `HANGAR-SPEC`: "Distant explosions with no sound, then a delayed muffled
 * thump through the hull." The delay is the whole effect — a flash and a bang
 * together is a firework, and a flash followed by the deck moving under you is
 * a ship being shot at — so `hullThump` takes one.
 *
 * AND THE DEFAULT DELAY IS DRAMATIC, NOT PHYSICAL, WHICH IS WORTH SAYING OUT
 * LOUD. The battle outside is drawn at capital-ship distance; a detonation
 * genuinely 6 km away is 17.5 s of sound travel, by which time the flash is not
 * merely forgotten, it is four flashes ago and the association is gone. The
 * association is the entire content of the effect. So the gap is 0.9–2.1 s,
 * which is the longest a human will still bind two events into one cause, and
 * a caller with a real range may pass one: `hullThump(world, s, { range })`
 * divides by `SPEED_OF_SOUND` and is welcome to be as slow as it likes.
 *
 * FOUR LAYERS AND NONE OF THEM IS "AN EXPLOSION":
 *
 *   the SUB — 34 → 19 Hz over 0.85 s. What actually reaches you through 400 m
 *     of ship is the bottom two octaves and nothing else, because everything
 *     above them was absorbed by the structure it travelled through.
 *   the BODY — pink through a lowpass falling 150 → 60 Hz. The mass of it.
 *   the RING — 128 Hz triangle over 1.1 s, quiet. A steel plate that has been
 *     hit rings, and this is the layer that says the thing you are standing on
 *     is the thing that was hit.
 *   the RATTLE — 40 ms of 2.2 kHz at 0.014. Loose fittings somewhere. This is
 *     the smallest number in the file and it is the one that moves the sound
 *     from "a sub in the mix" to "inside a structure": nothing else here has
 *     any high end at all, so the ear has to place it in the room.
 *
 * It is NON-POSITIONAL on purpose. A thump through a hull arrives through the
 * deck, the bulkhead and your boots at once; a panner would put a whole
 * capital ship's worth of impact somewhere over the player's left shoulder.
 * The same argument `death()` makes for itself.
 *
 * And it BLOOMS THE BED. `st.bloom` lifts the rumble layer for a second and a
 * half afterwards, which is the ship still moving after the hit — the one part
 * of this that a one-shot cannot do, and the reason the thump is here rather
 * than in `Audio.js` as a generic cue.
 */
const THUMP = {
  /** Seconds between the flash and the arrival, when the caller does not say. */
  delay: [0.9, 2.1],
  /** …and between unprompted ones, so the war is going on whether or not the view says so. */
  gap: [9, 34],
  /** How much of a hit is still in the room afterwards, and for how long. */
  bloom: 0.075, bloomTau: 0.7,
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  TRAFFIC                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A REPULSORLIFT GOING PAST, AND THE DOPPLER QUESTION ANSWERED ══════════
 *
 * The recon is right and it was checked again: before this feature `grep -i
 * "doppler|speedOfSound|setVelocity"` over `src/` was empty. It is not an
 * oversight. WebAudio HAD a Doppler — `PannerNode.setVelocity`,
 * `AudioListener.dopplerFactor`, `AudioListener.speedOfSound` — and the spec
 * deprecated all three in 2014 and Chrome and Firefox removed them in 2016.
 * There is no switch. A `PannerNode` in 2024 is a distance law and an HRTF and
 * nothing else.
 *
 * SO IT IS DONE BY HAND, AND THIS ENGINE IS THE EASY CASE. Doppler on a
 * sampler means resampling. Doppler here means multiplying an
 * `OscillatorNode.frequency` and an `AudioBufferSourceNode.playbackRate` that
 * this code already writes every frame — because nothing in this game is a
 * sample. `AudioEngine.dopplerRatio` (added with this file) is the factor;
 * `stepDeckAudio` applies it to both oscillators, the noise rate AND the two
 * filter cutoffs of every pass in flight, sixty times a second.
 *
 * WHAT IT IS HONESTLY WORTH, measured rather than estimated. A 240 m pass at
 * 34 m/s across the front of the deck, 45 m off at its closest, driven through
 * `stepDeckAudio` frame by frame and sampled every half second:
 *
 *     t=0.0  128 m  ×1.102        t=4.0   48 m  ×0.967
 *     t=2.0   68 m  ×1.081        t=5.0   68 m  ×0.931
 *     t=3.0   48 m  ×1.037        t=7.0  127 m  ×0.915
 *     t=3.5   45 m  ×1.001   ← abeam
 *
 * A 1.204× sweep — 3.22 semitones — and two thirds of it happens in the 1.5 s
 * either side of the closest point. That is audible and it is not enormous. A
 * player asked afterwards would say the ship went past, not that it changed
 * pitch.
 *
 * AND THAT IS THE POINT, so the claim is made precisely rather than largely.
 * The gain curve and the filter opening and closing do most of the work of
 * selling a pass; they always did, and a pass built on them alone is a good
 * pass. What the pitch term buys is that the sound is MOVING rather than being
 * FADED, and the ear will not be talked out of that distinction: a gain ramp
 * with no pitch on it reads as a mixing desk, every time, and it is the one
 * artefact that makes a scene feel authored. So the recon's alternative —
 * "say plainly that a passing ship is a gain ramp and it will not convince" —
 * was the right thing to say about the engine as it stood, and it is no longer
 * true of it.
 *
 * WHAT IS STILL NOT MODELLED, in the interest of not overselling: there is no
 * cone directivity, so a repulsorlift is omnidirectional and a nozzle does not
 * get brighter when it turns toward you; and the listener's own motion is in
 * the ratio (it is the numerator) but the listener's own ACCELERATION is not,
 * which nobody has ever heard. The first of those is a real gap and the recon
 * named it: "an engine nozzle facing every direction at once".
 *
 * ── THE OTHER HALF OF A PASS ──────────────────────────────────────────────
 *
 * `air` is an air-absorption lowpass, `20 kHz × e^(−d/78)`, which is 6.3 kHz at
 * 90 m and 830 Hz at 250. Air really does eat the top end with distance and it
 * is most of why distance sounds like distance; without it a far ship is a near
 * ship turned down, which is the same failure as the gain ramp one level up.
 *
 * `outside` is the field again. A ship on the far side of the boundary is
 * heard through it: the cutoff is halved and the level is cut to 0.45. That is
 * the same statement `PRESSURE` makes, made about a source instead of about
 * the room, and it means a ship punching through the field gets brighter and
 * louder in one step at the moment it crosses — which is the whole of
 * `HANGAR-SPEC`'s "pop" without any code for a pop.
 */
export const REPULSOR = {
  /** The whine: two partials a slightly flat fifth apart, so they beat. */
  a: { f: 214, type: 'sawtooth', g: 0.055, lp: 1400, q: 4.0 },
  b: { f: 320, type: 'square', g: 0.028, lp: 2100, q: 2.2 },
  /** …and the air it is pushing. */
  wash: { rate: 1.0, freq: 2400, q: 1.1, g: 0.070 },
  /** Air absorption: cutoff = top × e^(−d / fall). */
  top: 20000, fall: 78,
  /** Heard through the field: cutoff × this, level × this. */
  through: 0.5, throughGain: 0.45,
  /** Spin-up and spin-down, in seconds. Clamps release, then it lifts. */
  spin: 1.3, settle: 0.9,
  /** At most this many in flight. Each is one voice for the length of its pass. */
  max: 2,
};

/**
 * ══ UNATTENDED TRAFFIC, AND IT HAS TO BE OUTSIDE ══════════════════════════
 *
 * Every one of these passes is opened with `outside: true`, which halves its
 * cutoff and cuts its level to 0.45 on the argument that it is being heard
 * THROUGH the boundary. That argument is a statement about where the ship is,
 * and the lane was written as `z: [96, 138]` when the lip was at 64. The lip
 * is at 144 now, so the lane was inside the room: repulsorlifts crossing the
 * hangar's forward third at 14–34 m altitude, muffled as if there were a
 * shield between them and the player, with the actual shield behind them.
 *
 * So the lane is stated in LIPS. `out` is how far past the field the ship
 * flies and its floor is above 1, which is the whole invariant — a pass is
 * outside iff `z > DECK.lip` or `|x| > DECK.lip`, and `deck-audio.mjs` samples
 * every derived path and asserts it. `run` is how long the run is, also in
 * lips, so a bigger room gets a longer approach rather than a ship that pops
 * into existence abeam.
 *
 * TWO BEARINGS, because the player's brief is field on three sides: most
 * traffic crosses the aperture he is looking through, and some of it crosses a
 * flank, which is the cheapest way to say the ship is in a lane rather than on
 * a loop.
 */
const TRAFFIC = {
  gap: [50, 112], speed: [72, 118], gain: 4.5,
  /** How far beyond the field, and how long the run, in DECK.lip. */
  out: [1.10, 1.85], run: 2.1,
  /** How high, as a fraction of the overhead. */
  y: [0.25, 0.75],
  /** How often it is a flank pass rather than one across the aperture. */
  flank: 0.35,
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  STATE                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * One object per world, allocated once, and NOTHING BELOW IT IS ALLOCATED IN
 * THE STEP. The three vectors, the twelve-slot announcement plan, the eight
 * pending thumps and the two pass slots are all built here and reused, because
 * `stepDeckAudio` runs sixty times a second for as long as the player stands on
 * the deck and a per-frame `new THREE.Vector3` is a garbage collector pause
 * with the player's own footsteps in it.
 */
function newState(world, opts) {
  const st = {
    world,
    /* Seeded, so a session is reproducible and a check can drive it. Not the
     * shared `rand`: two systems drawing from one stream means the deck's
     * announcements change when something else draws, which is the defect
     * `_shared.mjs` exists for. */
    rng: makeRng(opts.seed ?? 90210),
    t: 0,
    /* The graph, or nulls when there is no context. */
    ctx: null, chain: null, lp: [], tilt: null, out: null, started: [], torn: false,
    hushGain: null, emitGain: null, rumbleGain: null,
    stop: null,          // deregisters the teardown registered with `audio.hold`
    /* The pressure differential, as commanded. */
    p: -1, sendBase: 0.16,
    /* The rumble bloom a hull thump leaves behind. */
    bloom: 0,
    /* Scratch — see the note above. */
    _p: new THREE.Vector3(), _q: new THREE.Vector3(), _v: new THREE.Vector3(),
    /* Announcements, and the horns they come out of — derived at dress. */
    army: 'republic', paAt: 0, paPlan: [], horn: 0, horns: [],
    /* Coalesced boots. See `BOOT`. */
    boot: { n: 0, x: 0, y: 0, z: 0, at: 0, run: false },
    /* Vents, thumps, traffic. The vent sites are derived at dress too, because
     * where there is deck is a question about the ground and not about this
     * file — see `ventSites`. */
    ventSites: [], ventAt: [],
    thumpAt: 0, pending: [],
    passes: [], trafficAt: 0,
    /* The phases of a launch or an arrival, held on the deck's own clock. */
    cues: [],
    /* When the graph may be tried again. See `stepDeckAudio`'s first section. */
    armAt: 0,
    /* What the caller asked for. */
    pa: opts.pa !== false, vents: opts.vents !== false,
    battle: opts.battle !== false, traffic: opts.traffic !== false,
    /* The terrain method this file stood in front of, so it can stand back. */
    terrain: null, hadSurface: false, priorSurface: null,
  };
  for (let i = 0; i < 12; i++) st.paPlan.push({ f: 0, sy: 0, gap: 0, f1: 0, f2: 0, last: false });
  for (let i = 0; i < 8; i++) st.pending.push({ live: false, at: 0, strength: 1 });
  for (let i = 0; i < 8; i++) st.cues.push({ live: false, at: 0, kind: '', x: 0, y: 0, z: 0, k: 1 });
  for (let i = 0; i < REPULSOR.max; i++) {
    st.passes.push({ live: false, v: null, t: 0, dur: 0, power: 1, outside: false, spin: true,
      from: new THREE.Vector3(), to: new THREE.Vector3(), vel: new THREE.Vector3(),
      pos: new THREE.Vector3(), a: null, b: null, wash: null, air: null, lpA: null, lpB: null });
  }
  return st;
}

/** A number in [a, b) off the deck's own stream. */
const between = (st, r) => r[0] + st.rng() * (r[1] - r[0]);

/* ══════════════════════════════════════════════════════════════════════ */
/*  BUILDING IT                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE CHAIN, and everything the deck makes goes through it.
 *
 *     everything → chain → lp → tilt → out → ambBus
 *
 * `ambBus` and not `sfxBus`, on the routing rule this engine already keeps: the
 * effects bus is under `timeLP` (slow motion), under the duck that clears room
 * for a voice line and under the master compressor, and a room is none of those
 * things — a hull hum that ducked under a shout would be a hull that noticed.
 * `_startAmbience`'s wind and drone are on `ambBus` for the same reason and
 * `_battleBed`'s three layers are deliberately NOT, because those are weapons.
 *
 * THE PA IS ON IT TOO, which is the one debatable routing decision here, and
 * the argument is that the tannoy is a fixture of the room in exactly the sense
 * the ventilation is. Putting it on `sfxBus` would leave it bright and
 * unmuffled at the lip while the room it is bolted to went quiet — the one
 * arrangement that sounds broken rather than distant.
 */
/** Seconds between attempts to build the graph. See `stepDeckAudio`'s §0. */
const REARM = 1.0;

function buildGraph(st) {
  const ctx = audio.ctx;
  if (!ctx || !audio.ready || !audio.ambBus) return false;
  st.ctx = ctx;
  const pink = audio.noiseBuffer(true);
  if (!pink) return false;

  const out = ctx.createGain(); out.gain.value = 1; out.connect(audio.ambBus);
  const tilt = ctx.createBiquadFilter();
  tilt.type = 'lowshelf'; tilt.frequency.value = 110;
  if (tilt.gain) tilt.gain.value = 0;
  tilt.connect(out);
  /* TWO CASCADED LOWPASSES AND NOT ONE, and the number is measured rather than
   * chosen. A biquad is 12 dB/octave, so a single stage closing to 300 Hz
   * leaves the 800 Hz–3 kHz band only about 11 dB down — audible, and heard as
   * the room getting quieter rather than as the room going away. Two stages
   * are 24 dB/octave. Rendered offline, spawn to lip: −18.2 dB in 800 Hz–3 kHz
   * and −18.3 dB in 3–12 kHz, against −10.6 dB for both with one stage. The
   * band does not reach the filter's full −24 because `PRESSURE.hush` puts
   * 0.014 of a 1.15 kHz band back in at the same moment — which is the design
   * rather than a shortfall: the boundary arrives as the room leaves, and
   * measured across the walk the 800 Hz–3 kHz band bottoms out at −19.0 dB
   * six metres from the field and comes back up to −17.8 at the lip itself. */
  const lps = [];
  let tail = tilt;
  for (let i = 0; i < PRESSURE.stages; i++) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = PRESSURE.lp[0]; f.Q.value = 0.6;
    f.connect(tail); tail = f; lps.push(f);
  }
  const chain = ctx.createGain(); chain.gain.value = 1; chain.connect(tail);
  st.out = out; st.tilt = tilt; st.lp = lps; st.chain = chain;

  const started = [];
  const noise = (rate) => {
    const s = ctx.createBufferSource();
    s.buffer = pink; s.loop = true; s.playbackRate.value = rate;
    started.push(s);
    return s;
  };
  const osc = (type, f) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    started.push(o);
    return o;
  };
  /* A slow gain wobble. TWO NODES and not a `setTargetAtTime` treadmill: an
   * LFO runs on the audio clock inside the graph, so it keeps breathing while
   * the game is paused, while a tab is backgrounded and while `stepDeckAudio`
   * is not being called at all — none of which are moments the ship stops. */
  const wobble = (target, base, hz, depth) => {
    const l = osc('sine', hz);
    const d = ctx.createGain(); d.gain.value = base * depth;
    l.connect(d); d.connect(target.gain);
  };

  for (const s of DECK_BED.sub) {
    const o = osc('sine', s.f);
    const g = ctx.createGain(); g.gain.value = s.g;
    o.connect(g); g.connect(chain);
  }
  {
    const o = osc(DECK_BED.plant.type, DECK_BED.plant.f);
    const g = ctx.createGain(); g.gain.value = DECK_BED.plant.g;
    o.connect(g); g.connect(chain);
  }
  {
    const T = DECK_BED.turbine;
    const o = osc(T.type, T.f);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = T.lp; f.Q.value = T.q;
    const g = ctx.createGain(); g.gain.value = T.g;
    o.connect(f); f.connect(g); g.connect(chain);
  }
  for (const key of ['rumble', 'air', 'hiss']) {
    const L = DECK_BED[key];
    const s = noise(L.rate);
    const f = ctx.createBiquadFilter(); f.type = L.type; f.frequency.value = L.freq; f.Q.value = L.q;
    const g = ctx.createGain(); g.gain.value = L.g;
    s.connect(f); f.connect(g); g.connect(chain);
    wobble(g, L.g, L.lfo, L.depth);
    if (key === 'rumble') st.rumbleGain = g;
  }

  /* THE BOUNDARY, and it hangs off `out` rather than off `chain` — it is the
   * one sound in the room that the pressure filter must not take away, because
   * it IS the pressure boundary. */
  {
    const s = noise(0.93);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1150; f.Q.value = 0.55;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(out);
    st.hushGain = g;
    const o = osc('sine', PRESSURE.emitter);
    const eg = ctx.createGain(); eg.gain.value = 0;
    o.connect(eg); eg.connect(out);
    st.emitGain = eg;
  }

  const t0 = ctx.currentTime;
  for (const s of started) { try { s.start(t0); } catch { /* already going */ } }

  /* THE TEARDOWN GOES TO `audio.hold`, which is what `World.unload` already
   * drains through `stopLoops()`. A bed that relied on the caller remembering
   * to call `undressDeckAudio` would be the jetpack defect again — the one
   * `audio: a dead jet trooper stops making a noise` measures — one level up. */
  st.started = started;
  st.stop = audio.hold(() => teardown(st));
  return true;
}

/**
 * Silence and unplug the whole bed. Idempotent, and it reads the source list
 * off the STATE rather than off a closure — `undressDeckAudio` can reach it
 * too, and a teardown that only the registered closure could complete would
 * leave nine oscillators running for the session on the path where the caller
 * tears down in good order instead of waiting for `stopLoops`.
 */
function teardown(st) {
  if (st.torn) return;
  st.torn = true;
  const ctx = st.ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  try { st.out.gain.setTargetAtTime(0.0001, now, 0.08); } catch { /* gone */ }
  /* THE SEND GOES BACK. `setRoom` owns `reverbSend` and this file borrows it
   * for the length of one level; leaving it at the lip's 0.05 would give the
   * next level the deck's dead room, and `setRoom` only writes on a load —
   * so nothing would ever put it right. */
  try { audio.reverbSend?.gain.setTargetAtTime(st.sendBase, now, 0.4); } catch { /* gone */ }
  for (const p of st.passes) { if (p.live && p.v) { try { p.v.stop(0.08); } catch { /* gone */ } p.live = false; } }
  setTimeout(() => {
    for (const s of st.started) { try { s.stop(); } catch { /* already stopped */ } }
    for (const n of [st.chain, ...(st.lp || []), st.tilt, st.out, st.hushGain, st.emitGain]) {
      try { n?.disconnect(); } catch { /* gone */ }
    }
  }, 400);
}

/**
 * ══ DRESS IT ═════════════════════════════════════════════════════════════
 *
 * Called from the level's `dress`, at `World._loadSteps` stage 6 — after
 * `applyAtmosphere` (stage 4) and after `roomOf` has already derived the deck's
 * reverb from the honest `'metal'`, which is why the surface override below is
 * safe to install here and would not be at stage 3.
 *
 * @param opts.pa       announcements, default on
 * @param opts.vents    coolant and steam, default on
 * @param opts.battle   unprompted hull thumps, default on. Turn it OFF and
 *                      drive `hullThump` from the view, which is better: a
 *                      thump 1.4 s after a flash the player actually saw is
 *                      the whole effect and this file cannot see the flash.
 * @param opts.traffic  distant repulsorlift passes outside the field, default
 *                      on. Turn it OFF and drive `repulsorPass` from whatever
 *                      is flying real ships, for the same reason.
 * @param opts.army     'republic' | 'separatist'. Defaults to the company's.
 */
export function dressDeckAudio(world, opts = {}) {
  if (!world || world._deckAudio) return world?._deckAudio || null;
  const st = newState(world, opts);
  world._deckAudio = st;

  /* ONE ANSWER FOR THE WHOLE ROOM. `dressHangar` resolves `_deckFaction`
   * before anything is built and hands it in, and the fallback reads the same
   * field rather than `_company?.army` — the dressing runs BEFORE the company
   * exists, so a player with no roll used to get the default PA voice on a
   * deck already built in the other faction's colours. */
  st.army = PA_VOICE[opts.army] ? opts.army
    : PA_VOICE[world._deckFaction] ? world._deckFaction
      : PA_VOICE[world._company?.army] ? world._company.army
        /* NOT `settings.army`: nothing in the project writes it — see
         * `Hangar.deckFaction`. The room's one answer is `_deckFaction`. */
        : PA_VOICE[world._deckFaction] ? world._deckFaction : 'republic';

  /* ── THE DECK UNDERFOOT. See `deckSurfaceAt` for why this is an override on
   * the INSTANCE and not a second footstep system. */
  const terrain = world.terrain;
  if (terrain && typeof terrain.surfaceAt === 'function') {
    st.terrain = terrain;
    st.hadSurface = Object.prototype.hasOwnProperty.call(terrain, 'surfaceAt');
    st.priorSurface = st.hadSurface ? terrain.surfaceAt : null;
    terrain.surfaceAt = deckSurfaceAt;
  }

  st.sendBase = audio.room?.send ?? 0.16;
  buildGraph(st);

  /* ── WHERE THE ROOM'S SOUNDS COME FROM, derived here rather than written
   * down: the horns off `DECK`, the vents off `DECK` and then off the ground
   * they would be standing on. Once per visit. See `GEOM`. */
  st.horns = hornSites();
  st.ventSites = ventSites(world);
  st.ventAt = st.ventSites.map(() => 0);

  /* First events, spread so nothing arrives in the load's first second — a
   * tannoy that fires as the level fades in reads as a cutscene. */
  st.paAt = between(st, [8, 26]);
  st.thumpAt = between(st, THUMP.gap);
  st.trafficAt = between(st, [18, 60]);
  for (let i = 0; i < st.ventSites.length; i++) st.ventAt[i] = between(st, st.ventSites[i].gap) * 0.6;
  return st;
}

/**
 * Put the room back. Safe to call twice, safe to call on a world that was never
 * dressed, and safe to call after `World.unload` has already drained
 * `audio.stopLoops()` — which is the ordinary case, because the bed registers
 * its own teardown there.
 */
export function undressDeckAudio(world) {
  const st = world?._deckAudio;
  if (!st) return;
  if (st.stop) { st.stop(); st.stop = null; }
  teardown(st);
  const terrain = st.terrain;
  if (terrain && terrain.surfaceAt === deckSurfaceAt) {
    /* Back to what was there — which for a `Terrain` is nothing at all, and
     * `delete` on an own property is what re-exposes the prototype's method.
     * Assigning the prototype's function instead would leave an own property
     * behind that a later `Terrain.prototype.surfaceAt` fix could never reach. */
    if (st.hadSurface) terrain.surfaceAt = st.priorSurface;
    else delete terrain.surfaceAt;
  }
  world._deckAudio = null;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE FRAME                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ ONE FRAME OF THE DECK ═════════════════════════════════════════════════
 *
 * Ordered so that the thing the player is DOING is answered first: the
 * pressure differential is the only part of this file he controls, so it is
 * updated before anything that might have to be scheduled, and it is
 * deadbanded on `PRESSURE.step` for the reason `_bed()` is deadbanded —
 * `setTargetAtTime` at 60 Hz is a ramp that never arrives anywhere. At a walk
 * of 4 m/s the whole 20 m transition costs about 80 automations rather than
 * 300.
 *
 * ALLOCATES NOTHING. Every vector, plan slot, thump slot and pass slot was
 * built in `newState`.
 *
 * @param camera the view. Its world position is the ear. Falls back to the
 *               engine's own listener position, which `World.update` sets one
 *               line before this is reached.
 */
export function stepDeckAudio(world, dt, camera) {
  const st = world?._deckAudio;
  if (!st || st.torn) return;
  dt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 1 / 60;
  st.t += dt;

  const ear = st._p;
  if (camera?.getWorldPosition) camera.getWorldPosition(ear);
  else ear.copy(audio._listenerPos);

  /* THE CLOCK AND THE SCHEDULES RUN WHETHER OR NOT THERE IS A GRAPH, and only
   * the two sections that write AudioParams are skipped. A stepper that
   * returned early with no context would be a different state machine headless
   * from the one that ships — the pending thumps would never drain, the
   * announcements would never come round, and every check in this repository
   * runs with no context at all, so the only version anybody could measure
   * would be the one nobody plays. The entry points it calls are each their
   * own no-op without a graph. */
  /* ── 0. RE-ARM, WHICH IS THE DIFFERENCE BETWEEN A FAILURE AND A VISIT.
   *
   * `buildGraph` was called once, in `dress`, and its return value was
   * discarded. It returns false whenever there is no context yet — and that is
   * the ORDINARY case in a browser, not an edge: a page may not open an
   * `AudioContext` until a gesture has landed, and the deck can be dressed by a
   * level load that begins before the click that started it is delivered. One
   * false there left `st.ctx` null for the whole visit: the schedules below all
   * went on ticking, the announcements came round, the vents let go, the
   * thumps drained, and every one of them reached a no-op. A silent room and
   * nothing in the console.
   *
   * So it is retried, on a slow clock, because the only thing that can change
   * the answer is the engine coming up. `st.p` is reset so the pressure filter
   * writes its first value against the new graph rather than against the
   * position it happened to be at when the old one failed. */
  if (!st.ctx && !st.torn && audio.ready && st.t >= st.armAt) {
    st.armAt = st.t + REARM;
    if (buildGraph(st)) st.p = -1;
  }

  const live = audio.ready && !!st.ctx;
  const now = live ? st.ctx.currentTime : st.t;

  /* ── 1. THE FIELD. */
  const p = pressureAt(ear.x, ear.z);
  if (live && (st.p < 0 || Math.abs(p - st.p) >= PRESSURE.step)) {
    st.p = p;
    const [hi, lo] = PRESSURE.lp;
    try {
      /* GEOMETRIC and not linear — see `PRESSURE`. `hi × (lo/hi)^p` is one
       * `Math.pow` and is the same curve a musician would call constant
       * octaves per metre. */
      const cut = hi * Math.pow(lo / hi, p);
      for (const f of st.lp) f.frequency.setTargetAtTime(cut, now, 0.20);
      st.out.gain.setTargetAtTime(1 - (1 - PRESSURE.cut) * p, now, 0.25);
      if (st.tilt.gain) st.tilt.gain.setTargetAtTime(PRESSURE.tilt * p, now, 0.25);
      /* The hush arrives late and leaves early: `p^2.2` is nothing at all
       * until the last few metres. */
      const near = Math.pow(p, 2.2);
      st.hushGain.gain.setTargetAtTime(PRESSURE.hush * near, now, 0.30);
      st.emitGain.gain.setTargetAtTime(PRESSURE.hush * 0.34 * near, now, 0.30);
      audio.reverbSend?.gain.setTargetAtTime(
        st.sendBase + (PRESSURE.send - st.sendBase) * p, now, 0.35);
    } catch { /* a param that will not take it leaves the room where it was */ }
  }

  /* ── 2. THE BLOOM a hull thump left in the room. */
  if (st.bloom > 1e-4) {
    const was = st.bloom;
    st.bloom = damp(st.bloom, 0, 1 / THUMP.bloomTau, dt);
    if (live && (Math.abs(st.bloom - was) > 0.004 || st.bloom <= 1e-4)) {
      try {
        st.rumbleGain.gain.setTargetAtTime(DECK_BED.rumble.g * (1 + st.bloom * 5), now, 0.25);
      } catch { /* gone */ }
    }
  }

  /* ── 3. BOOTS that landed together. See `BOOT`. */
  if (st.boot.n && now - st.boot.at >= BOOT.window) flushBoot(st);

  /* ── 4. THUMPS that were scheduled with a delay. */
  for (const q of st.pending) {
    if (!q.live || st.t < q.at) continue;
    q.live = false;
    fireThump(st, q.strength);
  }

  /* ── 4b. THE PHASES OF A LAUNCH OR AN ARRIVAL. A sequence is four events
   * over about eight seconds and the caller fires it once; the deck holds the
   * rest on its own clock. Slots, not closures — see `newState`. */
  for (const q of st.cues) {
    if (!q.live || st.t < q.at) continue;
    q.live = false;
    fireCue(world, st, q);
  }

  /* ── 5. THE TANNOY. */
  if (st.pa && st.t >= st.paAt) {
    st.paAt = st.t + between(st, PA_GAP);
    paCall(world);
  }

  /* ── 6. THE PERIPHERY. */
  if (st.vents) {
    for (let i = 0; i < st.ventSites.length; i++) {
      if (st.t < st.ventAt[i]) continue;
      st.ventAt[i] = st.t + between(st, st.ventSites[i].gap);
      ventBurst(world, st.ventSites[i].at);
    }
  }

  /* ── 7. THE WAR, unprompted. */
  if (st.battle && st.t >= st.thumpAt) {
    st.thumpAt = st.t + between(st, THUMP.gap);
    hullThump(world, 0.55 + st.rng() * 0.75);
  }

  /* ── 8. TRAFFIC. */
  if (st.traffic && st.t >= st.trafficAt) {
    st.trafficAt = st.t + between(st, TRAFFIC.gap);
    const dir = st.rng() < 0.5 ? 1 : -1;
    const out = DECK.lip * between(st, TRAFFIC.out);
    const run = DECK.lip * TRAFFIC.run;
    const y = DECK.roof * between(st, TRAFFIC.y);
    /* ACROSS THE APERTURE, or up a flank. Both ends of both paths are past the
     * lip on the axis that decides it, which is what makes `outside: true`
     * below a true statement rather than a filter setting. */
    if (st.rng() < TRAFFIC.flank) {
      const side = st.rng() < 0.5 ? -1 : 1;
      st._q.set(side * out, y, -dir * run);
      st._v.set(side * out, y * 0.86, dir * run);
    } else {
      st._q.set(-dir * run, y, out);
      st._v.set(dir * run, y * 0.86, out);
    }
    repulsorPass(world, { from: st._q, to: st._v, speed: between(st, TRAFFIC.speed),
      power: 0.9, outside: true, gain: TRAFFIC.gain });
  }
  if (live) stepPasses(st, dt, now);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE HULL, HIT                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A detonation outside, arriving through the ship. See `THUMP`.
 *
 * @param strength 0..1.5 — how big it was
 * @param opts.delay  seconds to hold it for. The whole effect.
 * @param opts.range  metres, if the caller knows: `range / SPEED_OF_SOUND`.
 *                    Read the note in `THUMP` before using it for a real one.
 */
export function hullThump(world, strength = 1, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn) return false;
  const s = clamp(Number.isFinite(strength) ? strength : 1, 0.05, 1.5);
  let hold = Number.isFinite(opts.delay) ? opts.delay
    : Number.isFinite(opts.range) ? opts.range / SPEED_OF_SOUND
      : between(st, THUMP.delay);
  hold = clamp(hold, 0, 30);
  if (hold <= 0.001) return fireThump(st, s);
  for (const q of st.pending) {
    if (q.live) continue;
    q.live = true; q.at = st.t + hold; q.strength = s;
    return true;
  }
  /* Eight in flight at once is a bombardment nobody asked for; drop the ninth
   * rather than growing the array in the middle of a frame. */
  return false;
}

function fireThump(st, s) {
  st.bloom = Math.min(st.bloom + THUMP.bloom * s, 0.28);
  return audio.shape({
    dur: 1.25, gain: 1, pos: null, prio: PRIO.world,
    build(ctx, out, t0, pitch) {
      const sub = ctx.createOscillator();
      sub.type = 'sine'; sub.frequency.setValueAtTime(34 * pitch, t0);
      sub.frequency.exponentialRampToValueAtTime(19 * pitch, t0 + 0.85);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t0);
      sg.gain.linearRampToValueAtTime(0.115 * s, t0 + 0.035);
      sg.gain.setTargetAtTime(0.0001, t0 + 0.035, 0.30);
      sg.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
      sub.connect(sg); sg.connect(out);

      const ring = ctx.createOscillator();
      ring.type = 'triangle'; ring.frequency.setValueAtTime(128 * pitch, t0);
      ring.frequency.exponentialRampToValueAtTime(116 * pitch, t0 + 1.05);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t0);
      rg.gain.linearRampToValueAtTime(0.032 * s, t0 + 0.02);
      rg.gain.setTargetAtTime(0.0001, t0 + 0.02, 0.34);
      rg.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
      ring.connect(rg); rg.connect(out);

      const body = ctx.createBufferSource();
      body.buffer = audio.noiseBuffer(true); body.loop = true; body.playbackRate.value = 0.7;
      const bf = ctx.createBiquadFilter();
      bf.type = 'lowpass'; bf.Q.value = 0.9;
      bf.frequency.setValueAtTime(150 * pitch, t0);
      bf.frequency.exponentialRampToValueAtTime(60 * pitch, t0 + 0.55);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.linearRampToValueAtTime(0.10 * s, t0 + 0.03);
      bg.gain.setTargetAtTime(0.0001, t0 + 0.03, 0.22);
      bg.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
      body.connect(bf); bf.connect(bg); bg.connect(out);

      /* THE RATTLE. Forty milliseconds and 0.014 of level, and it is what puts
       * the whole sound inside a structure — nothing else in it has any high
       * end, so without this the ear has nowhere to place it. */
      const rat = ctx.createBufferSource();
      rat.buffer = audio.noiseBuffer(false); rat.loop = true; rat.playbackRate.value = 1.0;
      const rf = ctx.createBiquadFilter();
      rf.type = 'bandpass'; rf.frequency.value = 2200 * pitch; rf.Q.value = 1.6;
      const rgn = ctx.createGain();
      /* ZERO AT CREATION, and every envelope gain in this file is. A GainNode
       * is born at 1 and an AudioParam holds its initial value until its FIRST
       * SCHEDULED EVENT — so a layer whose envelope opens 12 ms into the sound
       * plays at FULL GAIN for those 12 ms. Rendered offline before this line
       * existed, the four cue one-shots peaked at 1.04, 1.12 and 1.16 against
       * envelopes that never ask for more than 0.07: three hundred
       * milliseconds of a bare oscillator at unity, which is a click and then
       * a tone. `FakeCtx` cannot see it — it records what was commanded, and
       * what was commanded was correct — and neither can a voice count. */
      rgn.gain.value = 0;
      rgn.gain.setValueAtTime(0.0001, t0 + 0.012);
      rgn.gain.linearRampToValueAtTime(0.014 * s, t0 + 0.026);
      rgn.gain.setTargetAtTime(0.0001, t0 + 0.026, 0.05);
      rgn.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
      rat.connect(rf); rf.connect(rgn); rgn.connect(out);

      return [sub, ring, body, rat];
    },
  });
}

/**
 * ══ THE FLASHES THE PLAYER ACTUALLY SAW ═══════════════════════════════════
 *
 * `HANGAR-SPEC`: "Distant explosions with no sound, then a delayed muffled
 * thump through the hull." The delay is the whole effect and the BINDING is
 * the whole content of it — a bang the ear can attach to a light it saw is an
 * event, and the same bang two seconds off any flash is weather.
 *
 * `SkyDome._blasts` already publishes exactly that, and it has since it was
 * written: each detonation pushes `{ kind, strength, delay, at }` onto
 * `ground.orbit.events`, capped at 12 with the oldest dropped. NOTHING DRAINED
 * IT. So the room still thumped — `THUMP.gap` fires one every 9 to 34 seconds
 * whether or not anything happened — and every one of those was uncorrelated
 * with every flash in the window. The feature the spec ticks was two calls
 * apart the whole time: the queue existed, the consumer existed, and no line
 * anywhere joined them.
 *
 * WHY IT IS EXPORTED RATHER THAN CALLED FROM `stepDeckAudio`. A queue with two
 * drains is a queue with a race in it, and the one call that must exist is in
 * the room's own update. `HangarDirector.update` is the room's update. Put
 * `drainBlasts(this.world);` on the line after `stepDeckAudio(...)` there.
 *
 * The strengths are taken as published and not rescaled: a detonation arrives
 * at 0.55–1.40, which is the band `hullThump` was written for, and the capital
 * ship breaking up arrives at 2.4, which clamps to 1.5 and is the loudest
 * thing in the session. That is the right answer and it is an accident worth
 * not disturbing.
 *
 * @returns how many thumps were scheduled.
 */
export function drainBlasts(world) {
  const q = ground.orbit?.events;
  if (!q || !q.length) return 0;
  const st = world?._deckAudio;
  /* A deck that is not dressed still EMPTIES it. Twelve stale detonations held
   * across a level change would all arrive in the first second of the next
   * visit, bound to nothing at all. */
  if (!st || st.torn) { q.length = 0; return 0; }
  let n = 0;
  while (q.length) {
    const e = q.shift();
    if (!e) continue;
    const hold = Number.isFinite(e.delay) ? e.delay : between(st, THUMP.delay);
    if (hullThump(world, e.strength, { delay: hold })) n++;
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE TANNOY                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A soft-clip curve, built once. `tanh(k·x)/tanh(k)` — smooth, odd-symmetric
 * (so it makes no DC and no even harmonics, which is what an overdriven
 * push-pull driver does) and monotonic, so quiet passages are untouched and
 * only the peaks bend.
 */
const DRIVE_CURVES = new Map();
function driveCurve(k) {
  let c = DRIVE_CURVES.get(k);
  if (c) return c;
  c = new Float32Array(1024);
  const norm = Math.tanh(k);
  for (let i = 0; i < 1024; i++) c[i] = Math.tanh(k * (i / 511.5 - 1)) / norm;
  DRIVE_CURVES.set(k, c);
  return c;
}

/**
 * ONE ANNOUNCEMENT. See `PA_VOICE` for what it is made of and why it says
 * nothing.
 *
 * The plan is laid out BEFORE the voice is asked for, because `shape` needs the
 * total length up front — a voice whose duration is discovered while building
 * it is a voice whose graph outlives its own release. The plan lives in
 * pre-allocated slots on the state and is rewritten each time.
 */
export function paCall(world, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn) return false;
  const key = PA_VOICE[opts.army] ? opts.army : st.army;
  const V = PA_VOICE[key] || PA_VOICE.republic;

  /* ── plan it. */
  const n = clamp(Math.round(between(st, V.words)), 3, st.paPlan.length);
  let span = V.chime.length * V.pip + V.pre;
  for (let k = 0; k < n; k++) {
    const s = st.paPlan[k];
    s.last = k === n - 1;
    s.sy = between(st, V.syl);
    /* A word boundary every two to four syllables. Speech is not a metronome
     * and the gaps are most of what says so. */
    s.gap = (k && k % (2 + Math.floor(st.rng() * 3)) === 0) ? between(st, V.word) : between(st, V.gap);
    s.f = V.f0 * (1 + (st.rng() * 2 - 1) * V.drift) * (s.last ? V.fall : 1);
    const F = V.formants[Math.floor(st.rng() * V.formants.length)];
    s.f1 = F[0]; s.f2 = F[1];
    span += s.sy + s.gap;
  }
  span += 0.34;

  const h = st.horns[st.horn % Math.max(st.horns.length, 1)] || hornSites()[0];
  st.horn++;
  st._q.set(h[0], h[1], h[2]);

  return audio.shape({
    dur: span, gain: V.gain, pos: st._q, prio: PRIO.chatter, dest: st.chain,
    build(ctx, out, t0, pitch) {
      /* ── THE HORN, from the driver outwards. Everything joins at `hp`. */
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = V.horn.hp; hp.Q.value = 0.7;
      const ring = ctx.createBiquadFilter();
      ring.type = 'peaking'; ring.frequency.value = V.horn.ring; ring.Q.value = V.horn.ringQ;
      if (ring.gain) ring.gain.value = V.horn.ringDb;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = V.horn.lp; lp.Q.value = 0.9;
      hp.connect(ring); ring.connect(lp);
      /* Guarded: a context without a shaper is a wire, not a silence. */
      if (ctx.createWaveShaper) {
        const sh = ctx.createWaveShaper();
        sh.curve = driveCurve(V.horn.drive);
        sh.oversample = '2x';
        lp.connect(sh); sh.connect(out);
      } else lp.connect(out);

      /* ── THE LARYNX: one saw through two formants. */
      const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t0);
      env.connect(hp);
      const buzz = ctx.createOscillator();
      buzz.type = 'sawtooth'; buzz.frequency.setValueAtTime(V.f0 * pitch, t0);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = V.formants[0][0] * pitch; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = V.formants[0][1] * pitch; f2.Q.value = 9;
      const g1 = ctx.createGain(); g1.gain.value = 0.30;
      const g2 = ctx.createGain(); g2.gain.value = 0.17;
      buzz.connect(f1); f1.connect(g1); g1.connect(env);
      buzz.connect(f2); f2.connect(g2); g2.connect(env);
      /* A little air, riding the same envelope. A buzz with no noise in it is
       * a synthesiser; 6% of broadband is the difference between that and
       * somebody breathing into a microphone. It is band-limited well above
       * the formants so it never becomes a consonant. */
      const air = ctx.createBufferSource();
      air.buffer = audio.noiseBuffer(true); air.loop = true; air.playbackRate.value = 1.07;
      const af = ctx.createBiquadFilter();
      af.type = 'bandpass'; af.frequency.value = 2200; af.Q.value = 0.8;
      const ag = ctx.createGain(); ag.gain.value = 0.055;
      air.connect(af); af.connect(ag); ag.connect(env);

      /* ── THE CHIME and the squelch, both through the same horn. */
      const bell = ctx.createOscillator();
      bell.type = V.chimeType; bell.frequency.setValueAtTime(V.chime[0], t0);
      const bf = ctx.createBiquadFilter();
      bf.type = 'bandpass'; bf.frequency.value = V.chime[0] * 1.4; bf.Q.value = 1.1;
      const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t0);
      bell.connect(bf); bf.connect(bg); bg.connect(hp);
      const sq = ctx.createBufferSource();
      sq.buffer = audio.noiseBuffer(false); sq.loop = true; sq.playbackRate.value = 1.0;
      const sf = ctx.createBiquadFilter();
      sf.type = 'bandpass'; sf.frequency.value = 2400; sf.Q.value = 3.0;
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t0);
      sq.connect(sf); sf.connect(sg); sg.connect(hp);

      /* ── schedule it. */
      let t = t0;
      /* The system keying up: 30 ms of squelch before anything else, which is
       * the sound of a channel opening and is why a PA never surprises you. */
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.10, t + 0.006);
      sg.gain.setTargetAtTime(0.0001, t + 0.008, 0.02);
      t += 0.06;
      for (let i = 0; i < V.chime.length; i++) {
        bell.frequency.setValueAtTime(V.chime[i], t);
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.linearRampToValueAtTime(V.chimeGain, t + 0.010);
        bg.gain.setTargetAtTime(0.0001, t + 0.012, V.pipLen * 0.4);
        t += V.pip;
      }
      t += V.pre;
      for (let k = 0; k < n; k++) {
        const s = st.paPlan[k];
        buzz.frequency.setValueAtTime(s.f * pitch, t);
        /* Every syllable glides. A held pitch is a note; speech never holds
         * one for a tenth of a second. The last one falls into the cadence. */
        buzz.frequency.linearRampToValueAtTime(
          s.f * pitch * (s.last ? 0.88 : 1 + (st.rng() * 2 - 1) * 0.035), t + s.sy);
        f1.frequency.setValueAtTime(s.f1 * pitch, t);
        f2.frequency.setValueAtTime(s.f2 * pitch, t);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(1, t + 0.020);
        env.gain.setValueAtTime(1, t + Math.max(s.sy - 0.030, 0.024));
        env.gain.linearRampToValueAtTime(0.0001, t + s.sy);
        t += s.sy + s.gap;
      }
      /* …and the channel closing again. */
      sg.gain.setValueAtTime(0.0001, t + 0.05);
      sg.gain.linearRampToValueAtTime(0.13, t + 0.058);
      sg.gain.setTargetAtTime(0.0001, t + 0.060, 0.028);
      return [buzz, air, bell, sq];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE PERIPHERY                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A VENT LETTING GO. Three layers and a plateau.
 *
 * `audio.noise()` cannot make this and it is worth saying which part: its
 * envelope is attack-then-exponential-decay, and a pressure release is
 * attack, HOLD, then fall — the hold is the whole character, it is what says
 * something is escaping under pressure rather than something was struck. So it
 * is a `shape`, which is also how three layers cost one voice instead of three.
 *
 * The jet falls from 4.2 kHz to 1.6 as the pressure behind it drops, which is
 * what a valve actually does and what makes it read as a finite quantity of
 * something getting out.
 */
export function ventBurst(world, at, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn) return false;
  const dur = clamp(opts.dur ?? (0.9 + st.rng() * 1.3), 0.3, 4);
  const g = clamp(opts.gain ?? 1, 0.1, 3);
  st._q.set(at[0] ?? at.x ?? 0, at[1] ?? at.y ?? 1, at[2] ?? at.z ?? 0);
  return audio.shape({
    dur: dur + 0.45, gain: g, pos: st._q, prio: PRIO.chatter, dest: st.chain,
    build(ctx, out, t0, pitch) {
      const jet = ctx.createBufferSource();
      jet.buffer = audio.noiseBuffer(false); jet.loop = true; jet.playbackRate.value = 0.95;
      const jf = ctx.createBiquadFilter();
      jf.type = 'bandpass'; jf.Q.value = 0.55;
      jf.frequency.setValueAtTime(4200 * pitch, t0);
      jf.frequency.exponentialRampToValueAtTime(1600 * pitch, t0 + dur);
      const jg = ctx.createGain();
      jg.gain.setValueAtTime(0.0001, t0);
      jg.gain.linearRampToValueAtTime(0.075, t0 + 0.022);   // the valve cracking
      jg.gain.linearRampToValueAtTime(0.048, t0 + 0.14);    // …and settling to a flow
      jg.gain.setValueAtTime(0.048, t0 + dur * 0.72);
      jg.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.30);
      jet.connect(jf); jf.connect(jg); jg.connect(out);

      /* THE PIPE ITSELF. A 140 Hz body resonance under the jet — the thing the
       * steam is coming out of, which is a metre of steel bolted to a deck. */
      const pipe = ctx.createOscillator();
      pipe.type = 'triangle'; pipe.frequency.setValueAtTime(140 * pitch, t0);
      pipe.frequency.exponentialRampToValueAtTime(122 * pitch, t0 + dur * 0.6);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, t0);
      pg.gain.linearRampToValueAtTime(0.020, t0 + 0.05);
      pg.gain.setTargetAtTime(0.0001, t0 + 0.05, dur * 0.35);
      pg.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.30);
      pipe.connect(pg); pg.connect(out);

      /* The seal breaking: 25 ms of top end, once. */
      const tick = ctx.createBufferSource();
      tick.buffer = audio.noiseBuffer(false); tick.loop = true; tick.playbackRate.value = 1.0;
      const tf = ctx.createBiquadFilter();
      tf.type = 'highpass'; tf.frequency.value = 5200 * pitch; tf.Q.value = 0.7;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(0.045, t0 + 0.005);
      tg.gain.setTargetAtTime(0.0001, t0 + 0.006, 0.012);
      tg.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.30);
      tick.connect(tf); tf.connect(tg); tg.connect(out);
      return [jet, pipe, tick];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  BOOTS                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ONE MAN'S BOOT. Called by whatever is walking the muster in. See `BOOT` for
 * why several inside 55 ms become one sound.
 *
 * It does not play anything itself: it accumulates a centroid and a count, and
 * `stepDeckAudio` fires the rank once the window has closed. A caller who is
 * NOT stepping this file — a check, or a muster that runs before the deck is
 * dressed — still gets a sound, through the ordinary `audio.footfall` path.
 */
export function bootFall(world, pos, opts = {}) {
  const st = world?._deckAudio;
  const surface = deckSurfaceAt(pos.x, pos.z);
  if (!st || st.torn || !audio.ctx) {
    audio.footfall(pos, { surface, run: !!opts.run, mass: 80 * BOOT.each });
    return;
  }
  const b = st.boot;
  const now = st.ctx.currentTime;
  if (b.n && now - b.at >= BOOT.window) flushBoot(st);
  if (!b.n) { b.at = now; b.x = 0; b.y = 0; b.z = 0; b.run = false; }
  b.n++;
  b.x += pos.x; b.y += pos.y; b.z += pos.z;
  b.run = b.run || !!opts.run;
}

/** Fire whatever boots have collected, as one sound at the centroid. */
function flushBoot(st) {
  const b = st.boot;
  if (!b.n) return;
  const n = b.n;
  st._v.set(b.x / n, b.y / n, b.z / n);
  b.n = 0;
  /* The n-th man is worth less than the first: a rank saturates. `footfall`
   * turns mass into pitch, level and length, so this is the whole of what
   * "ten men, together" means as a synthesis parameter. */
  const mass = 80 * BOOT.each * Math.min(1 + (n - 1) * BOOT.fold, BOOT.cap);
  audio.footfall(st._v, { surface: deckSurfaceAt(st._v.x, st._v.z), run: b.run, mass });
}

/**
 * ══ A MAN WALKING, WITHOUT A GAIT SOLVER ══════════════════════════════════
 *
 * `bootFall` had no caller in `src/` at all. `Hangar.stepCompany` moves
 * `fig.root.position` with two eases and a lerp — there is no leg cycle in it
 * and no event anywhere that could be called a footfall — so twenty-four men
 * crossed the deck in silence and the only thing that ever sounded was the
 * `bootHalt` at the end. "The filing in sells it more than the standing" is
 * the muster's own brief, and the filing in was the half with no sound.
 *
 * A GAIT SOLVER IS NOT THE ANSWER TO THAT, and it would cost more than the
 * walk it had to drive. A footfall is a DISTANCE, not a time: a man puts a
 * boot down once per stride length he covers, whichever speed he covers it at,
 * which is why a walk and a run leave the same footprints at different rates.
 * So this integrates the ground each walker has actually crossed and lands a
 * boot every time the total passes a stride — off the position the caller was
 * writing anyway, with no clock, no phase, and nothing stored in `Hangar.js`.
 *
 * AND IT COSTS ALMOST NOTHING BECAUSE THE BOOTS COALESCE. Twenty-four men at a
 * brisk 5.4 m/s put down about a hundred boots a second between them, which is
 * seven times the chatter band's entire ceiling. `bootFall` folds everything
 * inside `BOOT.window` into one footfall at the centroid, at the saturated
 * mass of the men who landed — so what the pool actually sees is at most one
 * voice per 55 ms whatever the company is doing, and what the ear hears is a
 * mass crossing a deck rather than twenty-four cursors ticking.
 *
 * @param who any per-man object — used only as an identity, never written to,
 *            and held in a `WeakMap` so a company that goes away takes its
 *            phases with it
 * @param pos where he is THIS frame
 * @param dt  the frame, if the caller has it: it is only used to decide
 *            whether he is running, which lengthens the stride
 * @returns true if a boot landed this frame
 */
export const STRIDE = {
  /** Metres of deck per boot, marching and running. */
  walk: 0.82, run: 1.30,
  /** Over this many metres a second he is running. */
  runAt: 4.2,
  /** A jump further than this is a man being PLACED, not a man walking. */
  jump: 3.0,
};

const GAIT = new WeakMap();

export function bootStride(world, who, pos, dt = 0) {
  if (!who || !pos) return false;
  let g = GAIT.get(who);
  if (!g) { g = { x: pos.x, z: pos.z, d: 0 }; GAIT.set(who, g); return false; }
  const dx = pos.x - g.x, dz = pos.z - g.z;
  g.x = pos.x; g.z = pos.z;
  const step = Math.sqrt(dx * dx + dz * dz);
  /* A TELEPORT IS NOT A WALK. A man set down at the doors, or snapped onto his
   * mark at the halt, would otherwise cash the whole jump in as a rank of
   * boots — which is the one artefact this could produce and the reason the
   * accumulator is reset rather than clamped. */
  if (!(step > 0) || step > STRIDE.jump) { g.d = 0; return false; }
  const run = dt > 0 && step / dt > STRIDE.runAt;
  g.d += step;
  const stride = run ? STRIDE.run : STRIDE.walk;
  if (g.d < stride) return false;
  /* One boot per frame at most: a frame long enough to have covered two
   * strides is a frame the player did not see anyway, and two footfalls at the
   * same instant are one sound with the level of two. */
  g.d = Math.min(g.d - stride, stride);
  bootFall(world, pos, { run });
  return true;
}

/**
 * THE HALT — the one moment the muster is worth hearing.
 *
 * A company coming to a stop does not take a last step, it STAMPS: every boot
 * on the deck inside about 40 ms, followed by the scrape of the men who were
 * half a pace out squaring up. Two layers over the coalesced footfall, and the
 * scrape is the one that makes it a person rather than an event.
 *
 * @param men how many came to a halt. Scales exactly as a coalesced rank does.
 */
export function bootHalt(world, at, men = 1) {
  const st = world?._deckAudio;
  const n = clamp(Math.round(men) || 1, 1, 40);
  const mass = 80 * BOOT.each * Math.min(1 + (n - 1) * BOOT.fold, BOOT.cap * 1.4);
  const pos = at.isVector3 ? at : { x: at[0] ?? 0, y: at[1] ?? 0, z: at[2] ?? 0 };
  audio.footfall(pos, { surface: deckSurfaceAt(pos.x, pos.z), run: false, mass });
  if (!st || st.torn) return false;
  return audio.shape({
    dur: 0.42, gain: 1, pos, prio: PRIO.world,
    build(ctx, out, t0, pitch) {
      const extra = [];
      /* THE SCRAPE. Boot on grit on steel: broadband, brief, and swept DOWN in
       * frequency because a foot squaring up slows as it arrives. */
      const sc = ctx.createBufferSource();
      sc.buffer = audio.noiseBuffer(false); sc.loop = true; sc.playbackRate.value = 1.0;
      const sf = ctx.createBiquadFilter();
      sf.type = 'bandpass'; sf.Q.value = 1.1;
      sf.frequency.setValueAtTime(2600 * pitch, t0 + 0.055);
      sf.frequency.exponentialRampToValueAtTime(950 * pitch, t0 + 0.22);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t0);
      sg.gain.setValueAtTime(0.0001, t0 + 0.055);
      sg.gain.linearRampToValueAtTime(0.030 * Math.min(1 + n * 0.10, 2.2), t0 + 0.085);
      sg.gain.setTargetAtTime(0.0001, t0 + 0.085, 0.055);
      sg.gain.linearRampToValueAtTime(0.0001, t0 + 0.40);
      sc.connect(sf); sf.connect(sg); sg.connect(out);

      /* ══ THE DECK ANSWERING, AND WHY IT IS NOT `footfall`'s ═══════════
       *
       * `footfall` already has this layer — `bodyThump`, added over 2.75
       * reference masses — and for a long time it was the whole of what made
       * ten men sound different from one. It stopped working when the room
       * grew: `bodyThump` asks for about 0.105 of gain, `_reach` culls
       * anything under `HEARING_FLOOR` after `attenuation`, and the muster
       * line is now 30 m from where the player is put down instead of 22.
       * Measured across those eight metres: the sub share of a ten-man halt
       * goes 91% → 0%, because the layer is not quieter, it is REFUSED.
       *
       * A rank halting is the loudest thing this room does and it cannot be
       * the one sound that falls off a cliff at the distance the room is built
       * around. So the weight is carried here, inside a `shape` whose own gain
       * is 1 rather than 0.105, which reaches the whole deck — and it starts
       * at five men, which is the same line `footfall` draws and the same
       * argument: four men stamping is a sound, five is a rank. */
      if (n >= 5) {
        const deck = ctx.createOscillator();
        deck.type = 'sine';
        const f0 = clamp(66 / Math.pow(n, 0.22), 26, 66);
        deck.frequency.setValueAtTime(f0 * pitch, t0);
        deck.frequency.exponentialRampToValueAtTime(f0 * 0.45 * pitch, t0 + 0.30);
        const dg = ctx.createGain(); dg.gain.value = 0;
        dg.gain.setValueAtTime(0.0001, t0);
        dg.gain.linearRampToValueAtTime(clamp(0.020 * Math.pow(n, 0.42), 0.02, 0.115), t0 + 0.020);
        dg.gain.setTargetAtTime(0.0001, t0 + 0.022, 0.10);
        dg.gain.linearRampToValueAtTime(0.0001, t0 + 0.40);
        deck.connect(dg); dg.connect(out);
        extra.push(deck);
      }

      /* THE ARMOUR. Plates settling against each other — the tell that the
       * thing that stopped was wearing something. */
      const kit = ctx.createBufferSource();
      kit.buffer = audio.noiseBuffer(false); kit.loop = true; kit.playbackRate.value = 1.11;
      const kf = ctx.createBiquadFilter();
      kf.type = 'bandpass'; kf.frequency.value = 4600 * pitch; kf.Q.value = 3.2;
      const kg = ctx.createGain(); kg.gain.value = 0;
      kg.gain.setValueAtTime(0.0001, t0 + 0.030);
      kg.gain.linearRampToValueAtTime(0.020 * Math.min(1 + n * 0.08, 1.8), t0 + 0.042);
      kg.gain.setTargetAtTime(0.0001, t0 + 0.042, 0.035);
      kg.gain.linearRampToValueAtTime(0.0001, t0 + 0.40);
      kit.connect(kf); kf.connect(kg); kg.connect(out);
      return [sc, kit, ...extra];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  TRAFFIC                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * FLY ONE. See `REPULSOR` for the whole argument about Doppler.
 *
 * The path is a straight line and the velocity is constant, which is not a
 * simplification of anything: a ship crossing an aperture on a scripted timeline
 * IS a straight line at a constant speed, and the pass is over in five seconds.
 *
 * @param opts.from    where it comes in
 * @param opts.to      where it goes out
 * @param opts.speed   metres a second
 * @param opts.power   0..1.4 — how hard it is working
 * @param opts.outside true if it is on the far side of the field
 * @param opts.spin    open with a spin-up, default true
 */
export function repulsorPass(world, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn || !audio.ready) return null;
  let slot = null;
  for (const p of st.passes) if (!p.live) { slot = p; break; }
  if (!slot) return null;
  const from = opts.from, to = opts.to;
  if (!from || !to) return null;
  slot.from.set(from.x, from.y, from.z);
  slot.to.set(to.x, to.y, to.z);
  const speed = clamp(Number.isFinite(opts.speed) ? opts.speed : 34, 2, 400);
  const len = slot.from.distanceTo(slot.to);
  if (!(len > 1)) return null;
  slot.dur = len / speed;
  slot.vel.copy(slot.to).sub(slot.from).multiplyScalar(1 / slot.dur);
  slot.pos.copy(slot.from);
  slot.t = 0;
  slot.power = clamp(Number.isFinite(opts.power) ? opts.power : 1, 0.1, 1.4);
  slot.outside = !!opts.outside;
  slot.spin = opts.spin !== false;

  let a = null, b = null, wash = null, air = null, lpA = null, lpB = null;
  const gain = clamp(Number.isFinite(opts.gain) ? opts.gain : 1.6, 0.05, 12);
  const v = audio.open({
    pos: slot.pos, gain, prio: PRIO.world,
    build(ctx, out, t0) {
      /* THE AIR-ABSORPTION FILTER IS THE OUTERMOST NODE, so it closes over the
       * whole voice and not over one layer of it. Distance is not a treble
       * control on the whine only. */
      air = ctx.createBiquadFilter();
      air.type = 'lowpass'; air.frequency.value = REPULSOR.top; air.Q.value = 0.6;
      air.connect(out);
      const mk = (L) => {
        const o = ctx.createOscillator();
        o.type = L.type; o.frequency.value = L.f;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = L.lp; f.Q.value = L.q;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
        o.connect(f); f.connect(g); g.connect(air);
        return { o, f, g };
      };
      a = mk(REPULSOR.a); b = mk(REPULSOR.b);
      lpA = a.f; lpB = b.f;
      const w = REPULSOR.wash;
      const src = ctx.createBufferSource();
      src.buffer = audio.noiseBuffer(true); src.loop = true; src.playbackRate.value = w.rate;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass'; wf.frequency.value = w.freq; wf.Q.value = w.q;
      const wg = ctx.createGain(); wg.gain.setValueAtTime(0.0001, t0);
      src.connect(wf); wf.connect(wg); wg.connect(air);
      wash = { src, f: wf, g: wg };
      return [a.o, b.o, src];
    },
  });
  if (!v) return null;
  slot.v = v; slot.a = a; slot.b = b; slot.wash = wash; slot.air = air;
  slot.lpA = lpA; slot.lpB = lpB;
  slot.live = true;
  return slot;
}

/**
 * Every pass in flight, once a frame. Six automations each, on a voice that
 * exists for about five seconds once a minute.
 */
function stepPasses(st, dt, now) {
  for (const p of st.passes) {
    if (!p.live) continue;
    p.t += dt;
    if (p.t >= p.dur + REPULSOR.settle) {
      try { p.v.stop(0.35); } catch { /* gone */ }
      p.live = false; p.v = null;
      continue;
    }
    const u = clamp(p.t / p.dur, 0, 1);
    p.pos.copy(p.from).lerp(p.to, u);
    p.v.at(p.pos);

    /* ── THE DOPPLER. `dopplerRatio` carries the listener's own motion as well
     * as the source's — see `SPEED_OF_SOUND` for the formula and the signs. */
    const r = audio.dopplerRatio(p.pos, p.vel);
    /* …applied to the FILTERS as well as to the oscillators. A pitch that
     * moves under a fixed formant is a mistuning; the whole spectrum has to
     * shift or the ear hears a detune rather than a movement. */
    const d = st._q.copy(p.pos).sub(audio._listenerPos).length();
    let top = REPULSOR.top * Math.exp(-d / REPULSOR.fall);
    let lvl = 1;
    if (p.outside) { top *= REPULSOR.through; lvl = REPULSOR.throughGain; }

    /* Spin-up at the head of the pass and a settle at the tail. */
    const ramp = p.spin ? smoothstep(0, REPULSOR.spin, p.t) : 1;
    const tail = 1 - smoothstep(p.dur, p.dur + REPULSOR.settle, p.t);
    const k = p.power * ramp * tail * lvl;

    try {
      p.a.o.frequency.setTargetAtTime(REPULSOR.a.f * r * (0.72 + 0.28 * ramp), now, 0.04);
      p.b.o.frequency.setTargetAtTime(REPULSOR.b.f * r * (0.72 + 0.28 * ramp), now, 0.04);
      p.lpA.frequency.setTargetAtTime(REPULSOR.a.lp * r, now, 0.05);
      p.lpB.frequency.setTargetAtTime(REPULSOR.b.lp * r, now, 0.05);
      p.wash.src.playbackRate.setTargetAtTime(REPULSOR.wash.rate * r, now, 0.05);
      p.a.g.gain.setTargetAtTime(REPULSOR.a.g * k, now, 0.06);
      p.b.g.gain.setTargetAtTime(REPULSOR.b.g * k, now, 0.06);
      p.wash.g.gain.setTargetAtTime(REPULSOR.wash.g * k, now, 0.06);
      p.air.frequency.setTargetAtTime(clamp(top, 220, REPULSOR.top), now, 0.08);
    } catch { /* a param that will not take it leaves the pass where it was */ }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE COMPANY, SINGING                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ TROOPS SING ON COMMAND, AND STILL SAY NOTHING ═════════════════════════
 *
 * `HANGAR-SPEC`: "Troops sing/chant on command, faction-specific." It is the
 * same problem the PA has and it takes the same answer for the same reason —
 * there are no words anywhere in this file and there never will be — but it is
 * NOT the same sound, and the difference is the whole design:
 *
 *   A PA IS ONE VOICE AND NEVER REPEATS. `paCall` re-plans every announcement
 *     so no two are alike, because a tannoy a player recognises is a tannoy he
 *     has exhausted.
 *   A CHANT IS MANY VOICES AND IS NOTHING BUT REPETITION. A figure of four or
 *     six beats, said again, and again, is what makes a body of men one thing
 *     — and a chant that never repeated would not be a chant, it would be a
 *     crowd. So the figure is planned once and repeated, and the only thing
 *     that moves across a performance is that the last bar falls.
 *
 * ── HOW A CHOIR IS BUILT OUT OF FOUR OSCILLATORS ──────────────────────────
 *
 * Detuning. Several larynxes on one note are never on one note: they sit
 * within a couple of percent of each other and beat, and that beating IS the
 * sound of a number of people. Four saws spread ±2.1% through one pair of
 * formant bandpasses is a section of men; the same four at zero spread is one
 * man with a thick tone. `spread` is therefore how many people are in the room
 * and it is the single most important number in the table.
 *
 * ── AND THE TWO FACTIONS ARE TWO SPECIES ──────────────────────────────────
 *
 *   `republic` men. 104 Hz, four voices, a wide spread, a 4.6 Hz vibrato,
 *     open vowels, an unhurried four-beat figure that falls at the end. A
 *     unit shouting a cadence.
 *   `separatist` machines. 74 Hz, three voices, almost no spread (a network
 *     does not have members), no vibrato at all, a narrow nasal formant pair,
 *     six fast beats and no fall — because a fall is a breath, and nothing
 *     over there is breathing.
 */
export const CHANT = {
  republic: {
    f0: 104, voices: 4, spread: 0.021, type: 'sawtooth',
    vib: 4.6, vibDepth: 0.011,
    formants: [[430, 950], [560, 1180]],
    hp: 95, lp: 2300,
    /** The figure: one entry a beat, as a ratio on `f0`. Repetition is the point. */
    figure: [1, 1, 1.122, 1],
    beat: 0.54, bars: 5, drop: 0.84,
    gain: 2.6, air: 0.045,
  },
  separatist: {
    f0: 74, voices: 3, spread: 0.0016, type: 'square',
    vib: 0, vibDepth: 0,
    formants: [[300, 1660], [330, 1600]],
    hp: 190, lp: 1500,
    figure: [1, 1, 1, 1.059, 1, 1],
    beat: 0.33, bars: 7, drop: 1.0,
    gain: 2.2, air: 0.010,
  },
};

/**
 * ORDER THE COMPANY TO SING. One voice from the pool for the whole
 * performance, at the line, through the deck's own chain — so it hushes with
 * the room when the player walks to the field, which is right: the men are
 * behind him and so is the air that carries them.
 *
 * ── THE SIGNATURE IS `Hangar.setCompanySing`'s, EXACTLY ──────────────────
 *
 * `deckOrder` calls `companySing?.(world, c.army, c.men.length)` through a
 * seam that is resolved late, because this file is being written beside that
 * one and a missing voice must not take an order down with it. Positional
 * rather than an options bag for that one reason: it makes the wiring
 * `setCompanySing(deckChant);` and nothing else, so there is no adapter to
 * drift out of step with either side.
 *
 * @param army 'republic' | 'separatist'. Falls back to the room's own answer.
 * @param men  how many are singing. Moves the level and nothing else: a
 *             hundred men are not ten times ten men.
 * @param opts.at where they are. Defaults to the muster line.
 */
export function deckChant(world, army, men = 12, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn) return false;
  const V = CHANT[army] || CHANT[st.army] || CHANT.republic;
  const n = clamp(Math.round(men ?? 12) || 1, 1, 60);
  /* SATURATION, the same shape `BOOT.fold` uses and for the same reason: a
   * body of men is heard as one bigger thing, not as a sum. */
  const body = Math.min(1 + Math.log(n) * 0.30, 2.4);
  const at = opts.at || { x: 0, y: 1.6, z: DECK.line };
  st._q.set(at.x ?? at[0] ?? 0, at.y ?? at[1] ?? 1.6, at.z ?? at[2] ?? DECK.line);

  const beats = V.figure.length * V.bars;
  const span = beats * V.beat + 0.6;
  return audio.shape({
    dur: span, gain: V.gain * body, pos: st._q, prio: PRIO.chatter, dest: st.chain,
    build(ctx, out, t0, pitch) {
      /* ── THE THROAT. Two formants in parallel, one lowpass over both, and a
       * highpass under them so a chorus of saws does not put a rumble into the
       * bed it is standing on. */
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = V.lp; lp.Q.value = 0.8;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = V.hp; hp.Q.value = 0.7;
      lp.connect(hp); hp.connect(out);
      const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t0);
      env.connect(lp);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = V.formants[0][0] * pitch; f1.Q.value = 5.5;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = V.formants[0][1] * pitch; f2.Q.value = 8;
      const g1 = ctx.createGain(); g1.gain.value = 0.34;
      const g2 = ctx.createGain(); g2.gain.value = 0.16;
      f1.connect(g1); g1.connect(env);
      f2.connect(g2); g2.connect(env);

      /* ── THE MEN. `voices` larynxes spread either side of the pitch. */
      const srcs = [];
      const oscs = [];
      for (let v = 0; v < V.voices; v++) {
        const o = ctx.createOscillator();
        o.type = V.type;
        const k = V.voices === 1 ? 0 : (v / (V.voices - 1)) * 2 - 1;
        o.frequency.setValueAtTime(V.f0 * pitch * (1 + k * V.spread), t0);
        o.connect(f1); o.connect(f2);
        oscs.push({ o, k });
        srcs.push(o);
      }
      /* THE VIBRATO IS ONE LFO FOR ALL OF THEM, because a section breathes
       * together — that is what being drilled sounds like. Zero depth on the
       * droid row leaves the node out entirely rather than modulating by nothing. */
      if (V.vib > 0 && V.vibDepth > 0) {
        const l = ctx.createOscillator();
        l.type = 'sine'; l.frequency.value = V.vib;
        for (const { o } of oscs) {
          const d = ctx.createGain(); d.gain.value = o.frequency.value * V.vibDepth;
          l.connect(d); d.connect(o.frequency);
        }
        srcs.push(l);
      }
      /* A little breath over the top. Band-limited well above the formants so
       * it can never be mistaken for a consonant. */
      const air = ctx.createBufferSource();
      air.buffer = audio.noiseBuffer(true); air.loop = true; air.playbackRate.value = 1.03;
      const af = ctx.createBiquadFilter();
      af.type = 'bandpass'; af.frequency.value = 1900; af.Q.value = 0.8;
      const ag = ctx.createGain(); ag.gain.value = V.air;
      air.connect(af); af.connect(ag); ag.connect(env);
      srcs.push(air);

      /* ── SAY IT, AND SAY IT AGAIN. */
      let t = t0;
      for (let b = 0; b < V.bars; b++) {
        const last = b === V.bars - 1;
        for (let i = 0; i < V.figure.length; i++) {
          const tail = last && i === V.figure.length - 1;
          const r = V.figure[i] * (tail ? V.drop : 1);
          for (const { o, k } of oscs) {
            o.frequency.setValueAtTime(V.f0 * pitch * r * (1 + k * V.spread), t);
          }
          const F = V.formants[i % V.formants.length];
          f1.frequency.setValueAtTime(F[0] * pitch, t);
          f2.frequency.setValueAtTime(F[1] * pitch, t);
          /* Each beat is attack, hold, release — a shout, not a note. The last
           * one is held longer, which is how a phrase ends. */
          const len = V.beat * (tail ? 1.5 : 0.78);
          env.gain.setValueAtTime(0.0001, t);
          env.gain.linearRampToValueAtTime(1, t + 0.035);
          env.gain.setValueAtTime(1, t + Math.max(len - 0.06, 0.05));
          env.gain.linearRampToValueAtTime(0.0001, t + len);
          t += V.beat;
        }
      }
      return srcs;
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  A LAUNCH, AND AN ARRIVAL THAT DID NOT GO WELL                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ FOUR EVENTS OVER EIGHT SECONDS ════════════════════════════════════════
 *
 * `HANGAR-SPEC`: "Launches: clamps release, repulsor spin-up whine, taxi,
 * punch through." That is four events and it is a SEQUENCE, which is the only
 * thing about it that is hard — a launch played as one sound is a whoosh, and
 * the reason the four-beat version reads is that each beat explains the next.
 *
 * The caller fires it once and the deck holds the rest on its own clock, in
 * pre-allocated slots (`st.cues`) drained by `stepDeckAudio` beside the hull
 * thumps. No closures, no timers, nothing that outlives an unload.
 *
 * THE PUNCH IS THE ONE SOUND IN THE ROOM THAT DOES NOT GO THROUGH THE ROOM.
 * Everything else here is on `st.chain` and hushes as the player walks to the
 * boundary. The punch happens AT the boundary — it is the boundary being
 * crossed — so it hangs off `st.out` for the same reason `PRESSURE.hush` does:
 * filtering it with the room would take away the loudest thing about standing
 * where it happens.
 */
export const LAUNCH = {
  /** How many clamps let go, and how far apart. A ship is held by several. */
  clamps: 3, clampGap: 0.115,
  /** Seconds from the clamps letting go to the lift taking the weight. */
  spool: 1.15,
  /** How fast it taxis out, and how far past the lip it is gone, in lips. */
  speed: 24, out: 1.25,
  /**
   * WHERE IT STARTS, AND IT IS A PAD THAT EXISTS. `dressStructure` puts one
   * craft on a pad at (−26, 46) and another at (30, 92) — "the middle
   * distance… what gives the room a scale ladder" — so the default launch is
   * the port one leaving and the default arrival is the starboard one coming
   * back. A sequence that started from open deck would be the horns again.
   */
  padX: -26 / 144, from: (46 + 104) / 248,
  /** How high it rides once the lift has it, as a fraction of the overhead. */
  y: 0.055,
  gain: 3.4,
};

/** An arrival, which is a launch backwards and worse. */
export const ARRIVE = {
  /** How fast it comes in, and the starboard pad it puts down on. */
  speed: 32, padX: 30 / 144, at: (92 + 104) / 248,
  /** How far through the approach the engine misses. */
  cough: [0.35, 0.62],
  /** The mass that lands, as a multiple of `Audio.REF_MASS`. */
  mass: 220,
  gain: 3.6,
};

/** Hold `kind` for `hold` seconds. Slots, so a frame allocates nothing. */
function queueCue(st, hold, kind, x, y, z, k = 1) {
  for (const q of st.cues) {
    if (q.live) continue;
    q.live = true; q.at = st.t + Math.max(hold, 0);
    q.kind = kind; q.x = x; q.y = y; q.z = z; q.k = k;
    return true;
  }
  return false;
}

/**
 * A SHIP LEAVES. Clamps, spool-up, taxi, and through.
 *
 * @param opts.x/.z where it is standing. Defaults to a pad off the port wall.
 * @param opts.speed how fast it taxis out.
 */
export function launchSequence(world, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn) return false;
  const x = Number.isFinite(opts.x) ? opts.x : DECK.lip * LAUNCH.padX;
  const z0 = Number.isFinite(opts.z) ? opts.z : alongDeck(LAUNCH.from);
  const y = Number.isFinite(opts.y) ? opts.y : DECK.roof * LAUNCH.y;
  const speed = clamp(Number.isFinite(opts.speed) ? opts.speed : LAUNCH.speed, 4, 200);
  clampRelease(st, x, y, z0);
  const travel = Math.max(DECK.lip - z0, 1) / speed;
  queueCue(st, LAUNCH.spool, 'spool', x, y, z0, speed);
  queueCue(st, LAUNCH.spool + travel, 'punch', x, y, DECK.lip, 1);
  return true;
}

/**
 * A SHIP COMES BACK IN A STATE. It crosses the field, its lift misses on the
 * way down, and it does not land, it ARRIVES — which is the whole of what
 * `HANGAR-SPEC` means by "hard landing".
 *
 * The smoke trail and the fire crew are geometry and are somebody else's;
 * what is here is the three sounds that make the geometry read.
 */
export function damagedArrival(world, opts = {}) {
  const st = world?._deckAudio;
  if (!st || st.torn) return false;
  const x = Number.isFinite(opts.x) ? opts.x : DECK.lip * ARRIVE.padX;
  const z1 = Number.isFinite(opts.z) ? opts.z : alongDeck(ARRIVE.at);
  const speed = clamp(Number.isFinite(opts.speed) ? opts.speed : ARRIVE.speed, 4, 200);
  const z0 = DECK.lip * LAUNCH.out;
  const hi = DECK.roof * 0.22, lo = DECK.roof * LAUNCH.y;
  st._q.set(x, hi, z0);
  st._v.set(x, lo, z1);
  /* NOT `outside`, and not a spin-up: it is already flying and it is already
   * on this side by the time most of the pass is audible. `power` is low
   * because a lift that is failing is not making its rated noise. */
  repulsorPass(world, { from: st._q, to: st._v, speed, power: 0.68, gain: ARRIVE.gain, spin: false });
  const travel = Math.max(z0 - z1, 1) / speed;
  queueCue(st, Math.max(z0 - DECK.lip, 0) / speed, 'punch', x, hi, DECK.lip, 0.8);
  queueCue(st, travel * ARRIVE.cough[0], 'cough', x, (hi + lo) * 0.5, (z0 + z1) * 0.5, 1);
  queueCue(st, travel * ARRIVE.cough[1], 'cough', x, lo * 1.4, z1 + (z0 - z1) * 0.3, 0.7);
  queueCue(st, travel, 'touch', x, 0, z1, clamp(opts.mass ?? ARRIVE.mass, 40, 4000));
  return true;
}

/** One held phase of a launch or an arrival. See `queueCue`. */
function fireCue(world, st, q) {
  if (q.kind === 'spool') {
    st._q.set(q.x, q.y, q.z);
    st._v.set(q.x, q.y * 1.6, DECK.lip * LAUNCH.out);
    repulsorPass(world, { from: st._q, to: st._v, speed: q.k, power: 1.15,
      gain: LAUNCH.gain, spin: true });
  } else if (q.kind === 'punch') fieldPunch(st, q);
  else if (q.kind === 'touch') hardLanding(st, q);
  else if (q.kind === 'cough') engineCough(st, q);
}

/**
 * THE CLAMPS. Three of them, a tenth of a second apart, because a ship held by
 * one clamp would fall over — and because three staggered bangs are a MACHINE
 * letting go of something heavy while one bang is a door.
 *
 * One noise source carries every clack, retuned and re-enveloped per clamp, so
 * three events cost one voice and no extra nodes.
 */
function clampRelease(st, x, y, z) {
  const n = LAUNCH.clamps;
  const span = n * LAUNCH.clampGap + 0.7;
  st._q.set(x, y, z);
  return audio.shape({
    dur: span, gain: 1.4, pos: st._q, prio: PRIO.world, dest: st.chain,
    build(ctx, out, t0, pitch) {
      const clack = ctx.createBufferSource();
      clack.buffer = audio.noiseBuffer(false); clack.loop = true; clack.playbackRate.value = 1.0;
      const cf = ctx.createBiquadFilter();
      cf.type = 'bandpass'; cf.Q.value = 5.5;
      const cg = ctx.createGain(); cg.gain.value = 0;
      clack.connect(cf); cf.connect(cg); cg.connect(out);
      /* The mass under each one: a steel jaw the size of a man swinging clear. */
      const body = ctx.createOscillator();
      body.type = 'triangle';
      const bg = ctx.createGain(); bg.gain.value = 0;
      body.connect(bg); bg.connect(out);
      /* And the line that was holding the pressure. */
      const hiss = ctx.createBufferSource();
      hiss.buffer = audio.noiseBuffer(false); hiss.loop = true; hiss.playbackRate.value = 1.0;
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass'; hf.frequency.value = 2600 * pitch; hf.Q.value = 0.7;
      const hg = ctx.createGain(); hg.gain.value = 0;
      hiss.connect(hf); hf.connect(hg); hg.connect(out);

      cg.gain.setValueAtTime(0.0001, t0);
      bg.gain.setValueAtTime(0.0001, t0);
      hg.gain.setValueAtTime(0.0001, t0);
      let t = t0;
      for (let i = 0; i < n; i++) {
        /* No two clamps are the same jaw: each is a little lower and a little
         * later than the last, which is what stops three bangs being a flam. */
        const f = (2100 - i * 240) * pitch;
        cf.frequency.setValueAtTime(f, t);
        cg.gain.setValueAtTime(0.0001, t);
        cg.gain.linearRampToValueAtTime(0.085, t + 0.004);
        cg.gain.setTargetAtTime(0.0001, t + 0.005, 0.020);
        body.frequency.setValueAtTime((190 - i * 16) * pitch, t + 0.006);
        body.frequency.exponentialRampToValueAtTime((72 - i * 5) * pitch, t + 0.13);
        bg.gain.setValueAtTime(0.0001, t + 0.006);
        bg.gain.linearRampToValueAtTime(0.062, t + 0.016);
        bg.gain.setTargetAtTime(0.0001, t + 0.016, 0.052);
        t += LAUNCH.clampGap * (1 + i * 0.16);
      }
      cg.gain.linearRampToValueAtTime(0.0001, t0 + span);
      bg.gain.linearRampToValueAtTime(0.0001, t0 + span);
      /* The pressure goes last and it is the tell that it was a MACHINE that
       * let go rather than something breaking. */
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.linearRampToValueAtTime(0.040, t + 0.03);
      hg.gain.setTargetAtTime(0.0001, t + 0.05, 0.16);
      hg.gain.linearRampToValueAtTime(0.0001, t0 + span);
      return [clack, body, hiss];
    },
  });
}

/**
 * THROUGH THE FIELD. `HANGAR-SPEC` calls it "pop, shockwave ring, engine wash"
 * and all three are here — the crack of the boundary being opened and shut, a
 * sub-bass ring that is the pressure step, and the wash of the drive going
 * away through the hole it made.
 *
 * ON `st.out`, past the pressure filter, because this IS the pressure
 * boundary. A player standing at the lip when a ship comes through should be
 * hit by it, not have it muffled by the same numbers that are muffling the
 * room behind him.
 */
function fieldPunch(st, q) {
  st.bloom = Math.min(st.bloom + THUMP.bloom * 0.6 * q.k, 0.28);
  st._q.set(q.x, q.y, q.z);
  return audio.shape({
    dur: 1.6, gain: 1.6 * q.k, pos: st._q, prio: PRIO.world, dest: st.out || st.chain,
    build(ctx, out, t0, pitch) {
      /* THE POP. Sixty milliseconds, falling hard, and it is the only bright
       * thing in the sound. */
      const pop = ctx.createBufferSource();
      pop.buffer = audio.noiseBuffer(false); pop.loop = true; pop.playbackRate.value = 1.0;
      const pf = ctx.createBiquadFilter();
      pf.type = 'bandpass'; pf.Q.value = 0.9;
      pf.frequency.setValueAtTime(3600 * pitch, t0);
      pf.frequency.exponentialRampToValueAtTime(900 * pitch, t0 + 0.09);
      const pg = ctx.createGain(); pg.gain.value = 0;
      pg.gain.setValueAtTime(0.0001, t0);
      pg.gain.linearRampToValueAtTime(0.090, t0 + 0.006);
      pg.gain.setTargetAtTime(0.0001, t0 + 0.008, 0.030);
      pg.gain.linearRampToValueAtTime(0.0001, t0 + 1.5);
      pop.connect(pf); pf.connect(pg); pg.connect(out);

      /* THE RING. The pressure step, which is felt rather than heard. */
      const ring = ctx.createOscillator();
      ring.type = 'sine'; ring.frequency.setValueAtTime(124 * pitch, t0);
      ring.frequency.exponentialRampToValueAtTime(38 * pitch, t0 + 0.55);
      const rg = ctx.createGain(); rg.gain.value = 0;
      rg.gain.setValueAtTime(0.0001, t0);
      rg.gain.linearRampToValueAtTime(0.088, t0 + 0.018);
      rg.gain.setTargetAtTime(0.0001, t0 + 0.020, 0.24);
      rg.gain.linearRampToValueAtTime(0.0001, t0 + 1.5);
      ring.connect(rg); rg.connect(out);

      /* THE WASH. The drive, going away through the hole — it SWELLS, because
       * what you hear is the air behind the ship arriving after it. */
      const wash = ctx.createBufferSource();
      wash.buffer = audio.noiseBuffer(true); wash.loop = true; wash.playbackRate.value = 0.9;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass'; wf.Q.value = 0.6;
      wf.frequency.setValueAtTime(1500 * pitch, t0 + 0.04);
      wf.frequency.exponentialRampToValueAtTime(380 * pitch, t0 + 1.1);
      const wg = ctx.createGain(); wg.gain.value = 0;
      wg.gain.setValueAtTime(0.0001, t0 + 0.04);
      wg.gain.linearRampToValueAtTime(0.052, t0 + 0.26);
      wg.gain.linearRampToValueAtTime(0.0001, t0 + 1.45);
      wash.connect(wf); wf.connect(wg); wg.connect(out);
      return [pop, ring, wash];
    },
  });
}

/**
 * IT DID NOT LAND, IT ARRIVED. Gear, then the airframe, then the scrape of it
 * settling on a deck it hit too hard — three events inside a third of a second,
 * which is the difference between a hard landing and a crash.
 *
 * `q.k` is the mass. It moves the pitch of the thud the way `footfall` moves a
 * boot's, because it is the same physics and there is no reason for this file
 * to have a second opinion about it.
 */
function hardLanding(st, q) {
  const m = clamp(q.k / 80, 1, 40);
  const drop = Math.pow(m, -0.22);
  st.bloom = Math.min(st.bloom + THUMP.bloom * 0.8, 0.28);
  st._q.set(q.x, q.y, q.z);
  return audio.shape({
    dur: 1.5, gain: 1.5, pos: st._q, prio: PRIO.world, dest: st.chain,
    build(ctx, out, t0, pitch) {
      /* THE GEAR. Steel taking the whole weight in one go. */
      const gear = ctx.createBufferSource();
      gear.buffer = audio.noiseBuffer(false); gear.loop = true; gear.playbackRate.value = 1.0;
      const gf = ctx.createBiquadFilter();
      gf.type = 'bandpass'; gf.frequency.value = 1400 * drop * pitch; gf.Q.value = 3.4;
      const gg = ctx.createGain(); gg.gain.value = 0;
      gg.gain.setValueAtTime(0.0001, t0);
      gg.gain.linearRampToValueAtTime(0.072, t0 + 0.006);
      gg.gain.setTargetAtTime(0.0001, t0 + 0.008, 0.045);
      /* THE BOUNCE. It came down harder than it should have, so it comes back
       * up — and the second contact is the one that says so. */
      gg.gain.setValueAtTime(0.0001, t0 + 0.19);
      gg.gain.linearRampToValueAtTime(0.045, t0 + 0.198);
      gg.gain.setTargetAtTime(0.0001, t0 + 0.200, 0.035);
      gg.gain.linearRampToValueAtTime(0.0001, t0 + 1.4);
      gear.connect(gf); gf.connect(gg); gg.connect(out);

      /* ══ THE MASS, AND IT IS THE LOUDEST THING IN THE SOUND ═══════════
       *
       * "Felt before it is heard" is the whole of what a hard landing means,
       * and it is a claim about which band the energy is in rather than about
       * level. Measured over the second the ship touches, with the gear and
       * the scrape as they were first written, only 23% of a hundred tonnes
       * arriving was under 200 Hz — the rest was a 1.4 kHz strut and a bright
       * scrape over the tail of the approach whine, which is the sound of a
       * skip rather than of an impact. So the sub carries it and the two
       * bright layers came down to make room for it. */
      const thud = ctx.createOscillator();
      thud.type = 'sine'; thud.frequency.setValueAtTime(78 * drop * pitch, t0);
      thud.frequency.exponentialRampToValueAtTime(26 * drop * pitch, t0 + 0.55);
      const tg = ctx.createGain(); tg.gain.value = 0;
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(0.185, t0 + 0.022);
      tg.gain.setTargetAtTime(0.0001, t0 + 0.024, 0.32);
      tg.gain.linearRampToValueAtTime(0.0001, t0 + 1.4);
      thud.connect(tg); tg.connect(out);

      /* THE SCRAPE. It is not stopped yet. */
      const sc = ctx.createBufferSource();
      sc.buffer = audio.noiseBuffer(false); sc.loop = true; sc.playbackRate.value = 1.06;
      const sf = ctx.createBiquadFilter();
      sf.type = 'bandpass'; sf.Q.value = 1.2;
      sf.frequency.setValueAtTime(2400 * pitch, t0 + 0.05);
      sf.frequency.exponentialRampToValueAtTime(520 * pitch, t0 + 0.72);
      const sg = ctx.createGain(); sg.gain.value = 0;
      sg.gain.setValueAtTime(0.0001, t0 + 0.05);
      sg.gain.linearRampToValueAtTime(0.028, t0 + 0.10);
      sg.gain.linearRampToValueAtTime(0.0001, t0 + 0.80);
      sc.connect(sf); sf.connect(sg); sg.connect(out);
      return [gear, thud, sc];
    },
  });
}

/**
 * A LIFT MISSING. Half a second of a drive that is not running properly: the
 * whine drops away, catches, and comes back short. It is the only thing in the
 * arrival that says the ship is DAMAGED rather than merely landing.
 */
function engineCough(st, q) {
  st._q.set(q.x, q.y, q.z);
  return audio.shape({
    dur: 0.75, gain: 1.5 * q.k, pos: st._q, prio: PRIO.chatter, dest: st.chain,
    build(ctx, out, t0, pitch) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(REPULSOR.a.f * pitch, t0);
      o.frequency.exponentialRampToValueAtTime(REPULSOR.a.f * 0.42 * pitch, t0 + 0.16);
      o.frequency.exponentialRampToValueAtTime(REPULSOR.a.f * 0.86 * pitch, t0 + 0.34);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1600 * pitch; f.Q.value = 3.2;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.062, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0.018, t0 + 0.17);
      g.gain.linearRampToValueAtTime(0.050, t0 + 0.36);
      g.gain.setTargetAtTime(0.0001, t0 + 0.38, 0.10);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 0.72);
      o.connect(f); f.connect(g); g.connect(out);

      /* THE MISFIRE ITSELF: a burst of broadband where the burn should be. */
      const bang = ctx.createBufferSource();
      bang.buffer = audio.noiseBuffer(true); bang.loop = true; bang.playbackRate.value = 0.85;
      const bf = ctx.createBiquadFilter();
      bf.type = 'bandpass'; bf.frequency.value = 420 * pitch; bf.Q.value = 1.0;
      const bg = ctx.createGain(); bg.gain.value = 0;
      bg.gain.setValueAtTime(0.0001, t0 + 0.14);
      bg.gain.linearRampToValueAtTime(0.058, t0 + 0.155);
      bg.gain.setTargetAtTime(0.0001, t0 + 0.158, 0.055);
      bg.gain.linearRampToValueAtTime(0.0001, t0 + 0.72);
      bang.connect(bf); bf.connect(bg); bg.connect(out);
      return [o, bang];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE MENU, MADE TACTILE                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ ONE-SHOTS FOR CHANGING A MAN ══════════════════════════════════════════
 *
 * `HANGAR-SPEC`: "Every change plays a one-shot audio cue so the menu feels
 * tactile." They are the smallest things in this file and they are the ones the
 * player will hear most often, so each one is the SOUND OF THE ACTION and not a
 * UI blip — `audio.ui()` exists and none of these use it, because a paint job
 * and a pauldron and a name are three different physical events and a menu
 * where they all click the same way is a menu, not a hangar.
 *
 * `cuePaint` is a SWEEP, matching the spec's "paint applies as a wash moving
 * over the armour, not a pop": 0.55 s of atomised noise rising 900 → 3400 Hz
 * as the spray crosses the plate, with a 0.13 s settle underneath. It is the
 * one cue with a duration you can hear, because it is the one change that is
 * described as taking time.
 *
 * `cueAttach` is a part SEATING: a metallic tick as it meets the mount, a dull
 * clamp under it, and a short servo tighten after — three events in 0.34 s, in
 * that order, which is what fitting something actually sounds like.
 *
 * `cueDetach` is the same three backwards and lighter: the clamp releasing
 * first, then the part coming away.
 *
 * `cueName` is a datapad accepting an entry. The only one that is allowed to
 * be a beep, because writing a name down is the only one of the four that is
 * not a physical act on a man.
 */
export function cuePaint(world, at = null) {
  return audio.shape({
    dur: 0.62, gain: 1, pos: at, prio: PRIO.critical,
    build(ctx, out, t0, pitch) {
      const s = ctx.createBufferSource();
      s.buffer = audio.noiseBuffer(false); s.loop = true; s.playbackRate.value = 1.0;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 0.85;
      f.frequency.setValueAtTime(900 * pitch, t0);
      f.frequency.exponentialRampToValueAtTime(3400 * pitch, t0 + 0.40);
      f.frequency.exponentialRampToValueAtTime(1500 * pitch, t0 + 0.55);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.055, t0 + 0.05);
      g.gain.setValueAtTime(0.055, t0 + 0.34);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 0.58);
      s.connect(f); f.connect(g); g.connect(out);
      /* THE SETTLE. A short low body under the spray so the wash lands on
       * something rather than hanging in the air. */
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(320 * pitch, t0 + 0.36);
      o.frequency.exponentialRampToValueAtTime(190 * pitch, t0 + 0.50);
      const og = ctx.createGain(); og.gain.value = 0;
      og.gain.setValueAtTime(0.0001, t0 + 0.36);
      og.gain.linearRampToValueAtTime(0.038, t0 + 0.39);
      og.gain.setTargetAtTime(0.0001, t0 + 0.39, 0.055);
      og.gain.linearRampToValueAtTime(0.0001, t0 + 0.60);
      o.connect(og); og.connect(out);
      return [s, o];
    },
  });
}

export function cueAttach(world, at = null) {
  return audio.shape({
    dur: 0.40, gain: 1, pos: at, prio: PRIO.critical,
    build(ctx, out, t0, pitch) {
      /* 1. the tick — plate meeting mount. */
      const t = ctx.createBufferSource();
      t.buffer = audio.noiseBuffer(false); t.loop = true; t.playbackRate.value = 1.0;
      const tf = ctx.createBiquadFilter();
      tf.type = 'bandpass'; tf.frequency.value = 5200 * pitch; tf.Q.value = 4.5;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(0.070, t0 + 0.004);
      tg.gain.setTargetAtTime(0.0001, t0 + 0.005, 0.016);
      tg.gain.linearRampToValueAtTime(0.0001, t0 + 0.38);
      t.connect(tf); tf.connect(tg); tg.connect(out);
      /* 2. the clamp — the mass of it, 25 ms behind. */
      const c = ctx.createOscillator();
      c.type = 'triangle'; c.frequency.setValueAtTime(240 * pitch, t0 + 0.025);
      c.frequency.exponentialRampToValueAtTime(96 * pitch, t0 + 0.14);
      const cg = ctx.createGain(); cg.gain.value = 0;
      cg.gain.setValueAtTime(0.0001, t0 + 0.025);
      cg.gain.linearRampToValueAtTime(0.072, t0 + 0.034);
      cg.gain.setTargetAtTime(0.0001, t0 + 0.034, 0.045);
      cg.gain.linearRampToValueAtTime(0.0001, t0 + 0.38);
      c.connect(cg); cg.connect(out);
      /* 3. the tighten — `servo`'s own shape, loaded and short. */
      const sv = ctx.createOscillator();
      sv.type = 'sawtooth'; sv.frequency.setValueAtTime(1450 * pitch, t0 + 0.10);
      sv.frequency.exponentialRampToValueAtTime(2150 * pitch, t0 + 0.26);
      const svf = ctx.createBiquadFilter();
      svf.type = 'bandpass'; svf.frequency.value = 1900 * pitch; svf.Q.value = 7;
      const svg = ctx.createGain(); svg.gain.value = 0;
      svg.gain.setValueAtTime(0.0001, t0 + 0.10);
      svg.gain.linearRampToValueAtTime(0.028, t0 + 0.13);
      svg.gain.setValueAtTime(0.028, t0 + 0.22);
      svg.gain.linearRampToValueAtTime(0.0001, t0 + 0.30);
      sv.connect(svf); svf.connect(svg); svg.connect(out);
      return [t, c, sv];
    },
  });
}

export function cueDetach(world, at = null) {
  return audio.shape({
    dur: 0.34, gain: 1, pos: at, prio: PRIO.critical,
    build(ctx, out, t0, pitch) {
      /* The clamp lets go first — a short pneumatic release. */
      const h = ctx.createBufferSource();
      h.buffer = audio.noiseBuffer(true); h.loop = true; h.playbackRate.value = 1.0;
      const hf = ctx.createBiquadFilter();
      hf.type = 'bandpass'; hf.Q.value = 0.9;
      hf.frequency.setValueAtTime(3000 * pitch, t0);
      hf.frequency.exponentialRampToValueAtTime(1200 * pitch, t0 + 0.20);
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, t0);
      hg.gain.linearRampToValueAtTime(0.062, t0 + 0.012);
      hg.gain.setTargetAtTime(0.0001, t0 + 0.014, 0.055);
      hg.gain.linearRampToValueAtTime(0.0001, t0 + 0.32);
      h.connect(hf); hf.connect(hg); hg.connect(out);
      /* …then the part comes away: lighter and higher than it went on. */
      const k = ctx.createOscillator();
      k.type = 'triangle'; k.frequency.setValueAtTime(430 * pitch, t0 + 0.11);
      k.frequency.exponentialRampToValueAtTime(280 * pitch, t0 + 0.20);
      const kg = ctx.createGain(); kg.gain.value = 0;
      kg.gain.setValueAtTime(0.0001, t0 + 0.11);
      kg.gain.linearRampToValueAtTime(0.040, t0 + 0.118);
      kg.gain.setTargetAtTime(0.0001, t0 + 0.120, 0.030);
      kg.gain.linearRampToValueAtTime(0.0001, t0 + 0.32);
      k.connect(kg); kg.connect(out);
      return [h, k];
    },
  });
}

export function cueName(world, at = null) {
  return audio.shape({
    dur: 0.24, gain: 1, pos: at, prio: PRIO.critical,
    build(ctx, out, t0, pitch) {
      /* Two pips a major sixth apart, rising: a datapad taking an entry. */
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.setValueAtTime(740 * pitch, t0);
      o.frequency.setValueAtTime(1244 * pitch, t0 + 0.075);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2600 * pitch; f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.030, t0 + 0.006);
      g.gain.setTargetAtTime(0.0001, t0 + 0.008, 0.020);
      g.gain.setValueAtTime(0.0001, t0 + 0.075);
      g.gain.linearRampToValueAtTime(0.034, t0 + 0.081);
      g.gain.setTargetAtTime(0.0001, t0 + 0.083, 0.026);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(f); f.connect(g); g.connect(out);
      return o;
    },
  });
}
