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
 *     repulsorPass(world, {from, to, speed, …})   a ship crossing
 *     bootFall(world, pos) / bootHalt(world, at, n)   the muster
 *     paCall(world) / ventBurst(world, at)        on demand, if the schedules
 *                                                 are turned off
 *     cuePaint / cueAttach / cueDetach / cueName  a man being changed
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
 * The three zones are what a flight deck actually is:
 *
 *   `plate`   everything from the bulkhead out to 14 m short of the edge, plus
 *             the middle of the room where the company forms up.
 *   `grating` a ring 8 m wide inside the lip — the blast channel, which every
 *             deck open to a drive wash has and which is grating because it
 *             has to drain and vent. Also the service walkway down the port
 *             side under the gantry, where the ship on jacks is being worked
 *             on, so the material change is not only a thing that happens at
 *             the edge.
 *   `lip`     the last 6 m. Cantilevered steel with nothing under it.
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
  if (e < 6) return 'lip';
  if (e < 14) return 'grating';
  /* The port work bay's service walkway: under the gantry at x = -34, from
   * the machine at z = -22 up past both scaffolds. See `Hangar.dressDeck`. */
  if (x > -42 && x < -26 && z > -26 && z < 12) return 'grating';
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
 * Where the horns are. Four of them, high on the bulkhead and out on the two
 * inboard spars, so the PA has a PLACE — which is what makes it get quieter and
 * duller as the player walks away from the ship and toward the field, for free,
 * through the panner it is already on and the chain it already sits in.
 */
const HORNS = [[-28, 9.5, -43.5], [28, 9.5, -43.5], [-56, 14, 6], [56, 14, 6]];

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
 * Placed at things that are actually built (`Hangar.dressDeck`): the pipe run
 * down the port side with its valves, the two tanks, the starboard machine and
 * the deck office. A vent hissing where there is no pipe is the class of detail
 * that reads as an AI game.
 */
const VENTS = [
  { at: [-52, 1.2, -8], gap: [14, 46] },
  { at: [-46, 1.8, -21], gap: [18, 55] },
  { at: [44, 1.4, -26], gap: [16, 50] },
  { at: [26, 1.0, -27], gap: [22, 62] },
];

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

/** Unattended traffic, outside the field, on a loose loop. See `dressDeckAudio`. */
const TRAFFIC = { gap: [50, 112], speed: [72, 118], z: [96, 138], y: [14, 34], gain: 4.5 };

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
    /* Announcements. */
    army: 'republic', paAt: 0, paPlan: [], horn: 0,
    /* Coalesced boots. See `BOOT`. */
    boot: { n: 0, x: 0, y: 0, z: 0, at: 0, run: false },
    /* Vents, thumps, traffic. */
    ventAt: VENTS.map(() => 0),
    thumpAt: 0, pending: [],
    passes: [], trafficAt: 0,
    /* What the caller asked for. */
    pa: opts.pa !== false, vents: opts.vents !== false,
    battle: opts.battle !== false, traffic: opts.traffic !== false,
    /* The terrain method this file stood in front of, so it can stand back. */
    terrain: null, hadSurface: false, priorSurface: null,
  };
  for (let i = 0; i < 12; i++) st.paPlan.push({ f: 0, sy: 0, gap: 0, f1: 0, f2: 0, last: false });
  for (let i = 0; i < 8; i++) st.pending.push({ live: false, at: 0, strength: 1 });
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

  st.army = PA_VOICE[opts.army] ? opts.army
    : PA_VOICE[world._company?.army] ? world._company.army
      : PA_VOICE[world.settings?.army] ? world.settings.army : 'republic';

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

  /* First events, spread so nothing arrives in the load's first second — a
   * tannoy that fires as the level fades in reads as a cutscene. */
  st.paAt = between(st, [8, 26]);
  st.thumpAt = between(st, THUMP.gap);
  st.trafficAt = between(st, [18, 60]);
  for (let i = 0; i < VENTS.length; i++) st.ventAt[i] = between(st, VENTS[i].gap) * 0.6;
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

  /* ── 5. THE TANNOY. */
  if (st.pa && st.t >= st.paAt) {
    st.paAt = st.t + between(st, PA_GAP);
    paCall(world);
  }

  /* ── 6. THE PERIPHERY. */
  if (st.vents) {
    for (let i = 0; i < VENTS.length; i++) {
      if (st.t < st.ventAt[i]) continue;
      st.ventAt[i] = st.t + between(st, VENTS[i].gap);
      ventBurst(world, VENTS[i].at);
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
    const z = between(st, TRAFFIC.z), y = between(st, TRAFFIC.y);
    st._q.set(-dir * 175, y, z);
    st._v.set(dir * 175, y * 0.8, z - 22);
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

  const h = HORNS[st.horn % HORNS.length];
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
      return [sc, kit];
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
