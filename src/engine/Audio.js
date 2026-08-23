/**
 * BATTLEFRONT BORZ — synthesised audio.
 *
 * Nothing here is a sample. Every sound is built from oscillators and shaped
 * noise at the moment it is needed, which means the saber hum can be a live
 * instrument: its pitch, its amplitude and its filter all track how fast the
 * blade is actually moving, so the weapon sings when you move it and settles
 * when you hold a guard.
 *
 * Synthesis costs a voice, and voices are finite, so the other half of this
 * file is about who gets one. Three questions are asked of every one-shot, in
 * this order, and all three of them before a single node is built: is the
 * context running (a stopped one turns scheduling into a pile-up), would this
 * be loud enough at the listener to hear, and is its band of the pool free.
 * tools/audiowatch.mjs is the instrument that settles all three, and
 * tools/checks/audio.mjs is what stops them regressing.
 */

import * as THREE from 'three';
import { clamp, makeRng } from './MathUtil.js';
import { utterance, peakGain, contourFor, nextForceLine, forcePool } from './Voice.js';
import { Score } from './Score.js';

/** Finite-or-default. WebAudio params throw on NaN; game maths produces it. */
const num = (v, d) => (Number.isFinite(v) ? v : d);

const rng = makeRng(4242);

/**
 * What a sound is allowed to cost.
 *
 * The pool was first-come-first-served, and that is why the game went quiet.
 * Measured with tools/audiowatch.mjs over 24 s of a real dunes fight: the game
 * asked for 3435 sounds, and 3230 of them — 94% — were footsteps. The pool of
 * 44 sat completely full from t=11.6 s to t=20.2 s, and every request that
 * arrived in that window was thrown away: 37 bolt impacts, 14 blaster shots and
 * 12 deflections among them. Nothing threw, nothing leaked, no gain was zero —
 * the loudest events in the game were simply queued behind boots on sand. That
 * is "the sound comes in and out".
 *
 * A SECOND FIGURE USED TO STAND HERE — "the arena run was worse, 1331
 * refusals" — AND IT IS WITHDRAWN. `arena` is not a level and had not been for
 * a while; `audiowatch.mjs` defaulted to `--level arena`, `World.loadLevel`
 * substituted `LEVEL_ORDER[0]` for the key it did not know, and the run
 * therefore measured the Ember Shelf while printing `level arena` at the top of
 * its own report. The evidence quoted for the band layout was from a place that
 * does not exist. The dunes figures above stand — they were measured on a level
 * that was real at the time — and the bands are pinned by `audio.mjs` besides.
 * `audiowatch.mjs` now asks the page for its roster and refuses an unknown key
 * out loud.
 *
 * So the pool is banded. A footstep may only ever fill the bottom third of it;
 * a clash may take the lot. The bands are ceilings on the LIVE count rather
 * than separate pools, so a quiet moment still lends the whole engine to a
 * footstep — they only bite while the pool is filling, which is the only moment
 * the question is worth asking.
 */
export const PRIO = { chatter: 0, world: 1, combat: 2, critical: 3 };
/**
 * How long the death cue rings for — the length of its own longest layer,
 * named once because `death()` both schedules it and refuses to start a
 * second one inside it. Two numbers here would be a hand-maintained twin of
 * the kind this project keeps deleting.
 */
const DEATH_CUE = 2.6;
const BAND = [0.34, 0.68, 0.88, 1];

/**
 * The panner's inverse distance law, as a plain number.
 *
 * The amplitude a sound arrives at is knowable before a single node exists,
 * which is what lets a sound be refused for being inaudible instead of for
 * being late.
 *
 * IT TAKES THE CURVE AS AN ARGUMENT, AND IT DID NOT USED TO. This function's
 * own docstring said "_panner() builds every positional voice with the same
 * refDistance 1.8 and rolloffFactor 1.1", and that has been false since speech
 * was written: `speak()` alone builds `_panner(pos, VOICE_REF, VOICE_MAX)`, a
 * closer reference and a shorter tail, because a voice has to carry further
 * than a footstep. So `_reach` was predicting every scream on the wrong curve
 * — measured at 40 m, 0.0411 predicted against 0.0594 delivered, 45% under the
 * truth — and a prediction that is quiet by a constant factor can only cull
 * EARLY, which is a line silently thrown away for arriving further off than
 * the maths said it did. It never bit, because the amounts involved are far
 * over HEARING_FLOOR at every distance inside MAX_RANGE; it is exactly the
 * shape of HANDOFF §2.3 all the same — one rule written down in two places,
 * with the copy drifting.
 *
 * The clamp at `maxDist` is the same clamp the `inverse` distance model
 * applies, so past it the prediction stops falling exactly where the node
 * stops falling.
 */
const REF_DIST = 1.8, ROLLOFF = 1.1, MAX_DIST = 160;
/** …and the pair a VOICE is built on. Read by `speak` and by nothing else. */
const VOICE_REF = 2.6, VOICE_MAX = 120;
const attenuation = (d, ref = REF_DIST, maxD = MAX_DIST) => {
  const dd = Math.max(Math.min(d, maxD), ref);
  return ref / (ref + ROLLOFF * (dd - ref));
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE SCORE — which one                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE SOUNDTRACK LIST, and it is DATA so that adding one is a row.
 *
 * "I want to have different options for the soundtrack, is that possible? like
 * selecting one or the other?" — and there was no mechanism at all: one url,
 * armed by main.js, with a volume slider over it.
 *
 * WHAT A ROW IS. `files` is a list of file NAMES, resolved at play time
 * against the directory the caller armed (see _trackList), and a list because
 * assets/music/README.md tells a maintainer to split a long score into
 * `theme.mp3` + `theme2.mp3` to clear GitHub's 25 MB web-upload limit — the
 * chaining that supports that already exists and this reuses it rather than
 * inventing a second path.
 *
 * TWO SPECIAL ROWS, and neither of them is a fake track:
 *
 *   `files: null` means "whatever the game armed" — the shipped score, under
 *   whatever name main.js gives it. It is row 0 so a fresh profile hears
 *   exactly what it always heard, and so this file never has to know the
 *   name of the one asset in the project that is not procedural.
 *
 *   `files: []` is SILENCE, and it is a legitimate thing to choose rather
 *   than a placeholder: it builds no element, fetches nothing and is not the
 *   same request as Music 0, which is a level. A player who wants the room and
 *   the blade and no score can have exactly that.
 *
 *   `synth: true` is the THIRD kind, and it is not a file at all: the score is
 *   GENERATED, by src/engine/Score.js, out of the same oscillator bank
 *   everything else in this game is made of. It fetches nothing, so it is a
 *   sibling of the silence row rather than of the mp3 — which is also the
 *   argument for the ORDER below.
 *
 * WHAT IS DELIBERATELY NOT HERE: a row for a file this repository does not
 * ship. A list that offered three tracks and delivered one would be a menu of
 * lies. Drop an mp3 into assets/music/, add a row, and it is an option; the
 * engine reports a row whose file does not arrive (`onMusicMissing`) rather
 * than playing nothing and saying nothing.
 *
 * ── THE ORDER, AND WHY IT IS THIS ORDER ────────────────────────────────
 *
 * `musicIndex` is persisted as an INDEX (src/ui/Menu.js), so inserting a row
 * changes the meaning of every stored value at or after it. There is exactly
 * one arrangement that adds the generated score, makes it what a fresh profile
 * and an untouched slider both land on, and leaves every other saved value
 * meaning what it meant: put it FIRST, and leave `silence` at 1. A player who
 * chose "no score" still gets no score; a player who never chose anything gets
 * the adaptive score instead of the 28 MB stream, which is the intended change
 * and the only one.
 *
 * The two rows that fetch nothing therefore lead and the one that costs 28 MB
 * follows, which is also the right order to read them in.
 */
export const MUSIC_TRACKS = [
  { id: 'borz', name: 'Battle Score', files: [], synth: true,
    blurb: 'Generated, and it follows the fight: brass and drums in A, '
      + 'phrygian under a wave, a tritone under a boss. Nothing is downloaded.' },
  { id: 'silence', name: 'No score', files: [],
    blurb: 'The room, the blade and nothing else. Nothing is fetched at all.' },
  { id: 'theme', name: 'Main Theme', files: null,
    blurb: 'The orchestral track the game ships with — one 28 MB file, streamed.' },
];

/**
 * A row that plays NOTHING — no file to fetch and no generator behind it.
 *
 * `_trackList` does not need this — "no files" already means "fetch nothing"
 * for the generated row too — but `_applyTrack` does, because those two rows
 * differ in exactly one way and it is this one: silence must also turn the
 * stingers off, and the generated score must not. Written down once so
 * "silence" cannot come to mean two slightly different things (HANDOFF §2.3).
 */
export const isSilent = (t) => !!t && !t.synth && Array.isArray(t.files) && t.files.length === 0;

/** The track at an index, clamped — never an invented row. */
export function trackAt(i) {
  const n = MUSIC_TRACKS.length;
  const k = Math.max(0, Math.min(n - 1, Math.round(Number.isFinite(i) ? i : 0)));
  return MUSIC_TRACKS[k];
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  WORDS — the same lines, said in a language                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT THE VOICE IS ACTUALLY SAYING.
 *
 * "I want to be able to say actual voice lines. Like the alien robotic speech
 * is cool and all but we should be able to do actual voicelines."
 *
 * The synthesiser is not going anywhere — it is five larynxes of glottal
 * source, formant filter and breath, it is expressive, and the player says so
 * themselves. What it is not is INTELLIGIBLE, on purpose. So this is the same
 * event, said in words, and the two are alternatives a player chooses between
 * (see speechMode) rather than a replacement.
 *
 * IT IS `speechSynthesis` AND NOT RECORDED AUDIO, and that is a constraint
 * rather than a preference: this project ships no binary art except one
 * licensed music track, and README's pitch is that there is nothing to
 * download. A folder of VO would be megabytes of the one thing this game does
 * not have. The browser's own synthesiser is words, at zero bytes, with no
 * build step — and on a browser that does not carry it, the feature simply
 * does not arm and the synthesised voice plays as it always did.
 *
 * THE TABLE IS KEYED BY `kind`, which is Voice.js's LINE_KINDS — the same
 * vocabulary the announcer and the emote wheel already speak, so a line here
 * lands on exactly the event the wordless contour lands on and the emote wheel
 * can print the words for the slot the player is about to pick. Several per
 * kind, chosen at random, because a game that says the same four words on
 * every kill is worse than one that grunts.
 */
export const SPOKEN_LINES = [
  { id: 'kill.1', kind: 'kill', text: 'Done.' },
  { id: 'kill.2', kind: 'kill', text: 'You chose this.' },
  { id: 'kill.3', kind: 'kill', text: 'Stay down.' },
  { id: 'kill.4', kind: 'kill', text: 'That was nothing.' },
  { id: 'streak.1', kind: 'streak', text: 'Come on, then!' },
  { id: 'streak.2', kind: 'streak', text: 'Who else?' },
  { id: 'streak.3', kind: 'streak', text: 'Is that all of you?' },
  { id: 'boss.1', kind: 'boss', text: 'So it is you.' },
  { id: 'boss.2', kind: 'boss', text: 'I will not yield.' },
  { id: 'boss.3', kind: 'boss', text: 'This ends here.' },
  { id: 'low.1', kind: 'low', text: 'Enough!' },
  { id: 'low.2', kind: 'low', text: 'I can hold.' },
  { id: 'low.3', kind: 'low', text: 'Not yet.' },
  { id: 'die.1', kind: 'die', text: 'For the ones who fell.' },
  { id: 'die.2', kind: 'die', text: 'The Force is with me.' },
  { id: 'hurt.1', kind: 'hurt', text: 'Argh!' },
  { id: 'hurt.2', kind: 'hurt', text: 'Enough of that.' },
  { id: 'land.1', kind: 'land', text: 'Hah!' },
  { id: 'effort.1', kind: 'effort', text: 'Hyah!' },
  { id: 'effort.2', kind: 'effort', text: 'Ha!' },
];

const LINES_BY_KIND = new Map();
for (const l of SPOKEN_LINES) {
  if (!LINES_BY_KIND.has(l.kind)) LINES_BY_KIND.set(l.kind, []);
  LINES_BY_KIND.get(l.kind).push(l);
}

/** Every line written for a situation, or []. */
export function linesFor(kind) { return LINES_BY_KIND.get(kind) || []; }

/**
 * The words a wheel slot or a quip would say, or '' if that situation has
 * none. Deterministic on `pick` so a caption and the line that follows it
 * cannot disagree; random when it is not given.
 */
export function wordsFor(kind, pick = null) {
  const list = linesFor(kind);
  /**
   * A FORCE LINE CARRIES ITS OWN WORDS, and this is the fall-through.
   *
   * The table above is several lines per SITUATION, chosen at random, because
   * 'kill' is one event with four things a Jedi might say about it. A Force
   * line is the other shape: the pool has already been chosen from by the time
   * anything gets here — `AudioEngine.forceLine` picked `push.2` out of four —
   * so the words are one-to-one with the contour and belong ON it, beside the
   * syllables they are the same sentence as. Two tables would be exactly the
   * hand-maintained twin HANDOFF §2.3 is a section about, and the drift would
   * be silent: a pool reordered here and not there says "Come here" while it
   * shoves.
   */
  if (!list.length) {
    const c = contourFor(kind);
    return c && c.words ? c.words : '';
  }
  const i = pick === null ? Math.floor(rng() * list.length) : Math.abs(Math.round(pick)) % list.length;
  return list[i].text;
}

/** Does this browser carry a speech synthesiser at all? */
export function canSpeakWords() {
  return typeof globalThis !== 'undefined'
    && !!globalThis.speechSynthesis
    && typeof globalThis.SpeechSynthesisUtterance === 'function';
}

/**
 * How long a spoken line must be left alone before another may start.
 *
 * The announcer's own QUIP_GAP already spaces the LINES; this is the floor
 * under it that stops two systems talking at once when a wordless effort and
 * a quip land on adjacent frames — `speechSynthesis` has its own queue and
 * will happily read four things in a row, half a minute after the fight they
 * described.
 */
const WORD_GAP = 1.1;

/**
 * Below this amplitude at the listener, a one-shot is not a sound, it is a
 * voice being spent. The room's own bed — wind, drone, one idle hum — measures
 * 0.013 RMS with nothing happening at all, so 0.004 is about 11 dB under the
 * floor of a silent level. In practice that retires a 0.09 footstep at 37 m and
 * a 0.5 explosion at 190 m: each sound gets the range its own level earns,
 * where the flat 190 m cull gave the footstep and the detonation the same one.
 */
const HEARING_FLOOR = 0.004;
/** And an absolute backstop, because HRTF panning is not free even at -70 dB. */
const MAX_RANGE = 190;

/**
 * SPEECH, and why it has its own rules.
 *
 * A voice line is not a louder one-shot. It is 300–1000 ms of continuous,
 * mid-band, highly structured sound, which is exactly the material a mix turns
 * to mud with: two of them at once are unintelligible, three are noise, and a
 * fight can easily ask for six in the same second (four droids spotting you
 * while you kill a fifth). So three rules, all of them enforced here rather
 * than left to the callers:
 *
 *   1. A HARD CAP on concurrent utterances. Past it, the line is refused and
 *      counted, exactly like a one-shot past its band.
 *   2. LINES DUCK EACH OTHER. The second live line drops to `SPEECH_STACK`, and
 *      anything the player says drops every enemy line to `SPEECH_UNDER` for
 *      its duration — the player is the camera, and the camera wins.
 *   3. SPEECH DUCKS THE ROOM. While anyone is talking the effects bus sits at
 *      `SFX_DUCK`, which is what makes a line audible over a blaster fight
 *      without making the line loud.
 *
 * Speech is wired to the compressor directly rather than through sfxBus, or
 * rule 3 would duck the voices along with everything else and achieve nothing.
 */
const MAX_SPEECH = 3;
const SPEECH_STACK = 0.55;
const SPEECH_UNDER = 0.32;
const SFX_DUCK = 0.62;
/** How long the room stays down after the last syllable, in seconds. */
const DUCK_TAIL = 0.16;

/**
 * THE MUSIC'S SIDECHAIN, as three tables. See `_duck` and `stinger`.
 *
 * DUCK_MIN_GAP is the floor under how often the score is allowed to be pushed
 * down at all: two automations 20 ms apart are one automation with extra steps,
 * and a clash followed by the cut it opened is one gesture, not two.
 *
 * MUSIC_DUCK says how far each thing in the game pushes it and for how long.
 * The order is the argument: a player's own line is the loudest claim anything
 * has on the mix, a clash is the game answering an input, an enemy dying is
 * one of twenty in a wave and may only lean on the score rather than move it.
 */
const DUCK_MIN_GAP = 0.05;
export const MUSIC_DUCK = {
  /** The player speaks. The camera is their head; they win. */
  self:      [0.42, 0.55],
  /** Something on the field screams or powers down. Twenty a wave — a lean. */
  room:      [0.74, 0.30],
  /** Blade on blade. The one sound the score must never sit on top of. */
  clash:     [0.52, 0.26],
  /** Something detonated. */
  explosion: [0.58, 0.45],
};

/**
 * How close together a stinger of each kind may be fired, in seconds.
 *
 * Only the two that CAN repeat are listed. A boss entrance, a wave, a victory
 * and a death each happen once and must never be refused for being near
 * something else — a refused death stinger is the most important half-second in
 * the run, silent, for a reason nobody could ever find.
 */
const STINGER_GAP = { kill: 2.2, streak: 1.4, heavy: 7 };
/** …and how far each one pushes the bed down, so it is not mud under itself. */
const STINGER_DUCK = { wave: 0.5, clear: 0.55, boss: 0.42, heavy: 0.6, triumph: 0.35, fall: 0.3 };
/**
 * How long a dragged control is given to settle before its line is auditioned.
 * The shortest line in the game is 0.35 s (The Chosen's 'streak'), so a slider
 * dragged across five archetypes cannot be heard one voice per step whatever
 * this is; 0.18 s is under the ~0.25 s a hand takes to stop and let go, so the
 * voice the player LANDS on is the one that speaks. See audition().
 */
const AUDITION_GAP = 0.18;

/**
 * How much the room answers, and to what. See _bed().
 *
 * DRONE_SWELL is added to the level's own drone at full combat intensity, and
 * added rather than multiplied because three levels ship `drone: 0.0`.
 * STORM_GAIN multiplies the level's own wind at a full squall (+5.1 dB), and
 * STORM_BRIGHT opens the wind's bandpass with it — kamino's 520 Hz bed reads as
 * 780 Hz in the teeth of one, which is the difference between more air and
 * louder air.
 */
const DRONE_SWELL = 0.09;
const STORM_GAIN = 0.8;
const STORM_BRIGHT = 0.5;

/** Footstep timbre by ground, before the body standing on it is considered. */
const SURFACES = {
  sand:  { freq: 1500, q: 0.7, gain: 0.09 },
  stone: { freq: 2600, q: 1.4, gain: 0.11 },
  metal: { freq: 3400, q: 2.6, gain: 0.10 },
  water: { freq: 1900, q: 0.9, gain: 0.14 },
};
const SURFACE_DEFAULT = { freq: 1800, q: 1, gain: 0.1 };
/** The mass a footstep is quoted at — one adult in boots. */
const REF_MASS = 80;

// listener scratch — updateListener runs every frame
const _lq = new THREE.Quaternion(), _lf = new THREE.Vector3(), _lu = new THREE.Vector3();

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    /**
     * ONE, FROM THE MOMENT THE OBJECT EXISTS — not from the moment the graph is.
     *
     * `_timePitch` was assigned 1 where the time-scale filter is built, which
     * is inside the graph construction and therefore does not run for an engine
     * that has not started a context. Until then it is `undefined`, and both
     * one-shot paths guard the multiply with `if (this._timePitch !== 1)` —
     * which `undefined` passes. So `freq *= undefined` turned a frequency that
     * `num()` had just sanitised two lines earlier into NaN, and a NaN reaching
     * an AudioParam throws a TypeError between taking a voice and releasing it.
     * Forty-four of those and the game is silent for the session, which is the
     * exact failure `audio: a NaN never leaks the voice pool dry` exists for.
     *
     * The saber hum already defended itself — `(eng._timePitch || 1)` — which is
     * the tell that this had been met before and answered at one call site
     * rather than at the source.
     */
    this._timePitch = 1;
    this.master = null;
    this.volume = 0.8;
    this.musicVolume = 0.45;
    this.voiceLevel = 0.9;
    this.voices = 0;
    /** Live utterances, newest last. See MAX_SPEECH above. */
    this._speech = [];
    this.maxSpeech = MAX_SPEECH;
    /** Audio-clock time the effects bus is allowed back up to full. */
    this._duckUntil = 0;
    /** …and the same pair for the music's own sidechain. See _duck(). */
    this._musicDuckUntil = 0;
    this._musicDuckAt = 1;
    this._musicDuckSet = -1e9;
    this.maxVoices = 44;
    this._listenerPos = new THREE.Vector3();
    this._noiseBuf = null;
    this._pinkBuf = null;
    /**
     * Voice-pool telemetry. This file has been declared fixed twice by reading
     * it, so it now keeps its own books: `alloc - freed` is the live count and
     * must return to zero when the fight stops, `denied` is sound the player
     * asked for and did not get, and `dropped` is sound thrown away because the
     * context was not running. tools/audiowatch.mjs tabulates all of it.
     */
    this.stats = { req: 0, alloc: 0, freed: 0, denied: 0, culled: 0, dropped: 0, threw: 0, peak: 0,
      spoke: 0, speechDenied: 0, ducked: 0 };
    /**
     * WHICH SCORE, as an index into MUSIC_TRACKS. See setMusicTrack.
     *
     * 0 is the GENERATED score (src/engine/Score.js) — the one row that
     * fetches nothing and cannot fail to arrive, which is what a default
     * should be. The streamed theme is still there, one row down the slider.
     */
    this.musicIndex = 0;
    /** The live <audio> stream, or null. Never left undefined — see playMusic. */
    this._music = null;
    /**
     * SYNTHESISED, SPOKEN, OR BOTH. See sayWords().
     *
     * 'synth' is the game as it stands — five larynxes of oscillator, formant
     * filter and breath, deliberately wordless — and it is the default so
     * nothing changes for anyone who does not ask.
     */
    this.speechMode = 'synth';
    this._spokeAt = 0;
    /**
     * WHICH LINE EACH FORCE POWER SAID LAST. See forceLine().
     *
     * One string per power and nothing else, because that is the whole of what
     * "not the same thing twice in a row" needs to remember. It lives on the
     * engine rather than at module scope in Voice.js so that
     * tools/checks/_shared.mjs puts it back between suites along with the rest
     * of this object's own properties — a picker with a hidden module-level
     * memory is a picker whose second suite of the run draws differently from
     * its first, which is the class of defect that file exists for.
     */
    this._forceSaid = {};
  }

  /** How many lines are being spoken right now. */
  get speaking() { return this._speech.length; }

  /**
   * The level the effects bus is currently being HELD at, as a number.
   *
   * The automation on `sfxBus.gain` is the real thing, but an AudioParam under
   * a scheduled ramp does not report where it is going — `.value` is where it
   * was when the ramp was set — so a check that read the param would measure
   * nothing. This is what was commanded, on the audio clock.
   */
  duckLevel() {
    if (!this.ctx) return 1;
    return this.ctx.currentTime < this._duckUntil ? SFX_DUCK : 1;
  }

  /** The live-voice ceiling for a band, so a caller can state what it expects. */
  bandCap(prio) { return Math.max(1, Math.round((BAND[prio] ?? 1) * this.maxVoices)); }

  /**
   * THE WORLD IS RUNNING AT THIS SPEED — SLOW MOTION, HEARD.
   *
   * Force Sense takes the world to 0.42× and a full Focus hold to 0.18×.
   * Neither of them made a single sound in this file: the power that stops time
   * had no acoustic response at all, which is the difference between a game
   * that slows down and one that only looks like it has.
   *
   * TWO MECHANISMS, because slow motion is two things at once:
   *
   *   THE ROOM GOES DARK. Air absorbs the top end over distance and a listener
   *     inside a dilated moment is, in effect, a long way from everything. One
   *     lowpass on the effects bus, from wide open at 1× down to 700 Hz at a
   *     standstill, on a curve (`s ** 0.55`) rather than linearly so that the
   *     first third of the slowdown does most of the closing — that is where
   *     the ear is most sensitive to the change.
   *   NEW SOUNDS ARRIVE LOWER. Not a pitch shift of what is already playing,
   *     which WebAudio cannot do to a live graph without a delay line: every
   *     one-shot BUILT while the world is slow is built at a lower fundamental,
   *     which is what an event happening more slowly actually sounds like. At
   *     0.18× that is 0.63× — a little over eight semitones down.
   *
   * HITSTOP IS DELIBERATELY NOT PASSED HERE. It is a 30–120 ms freeze, and
   * pitching the whole mix down for a twentieth of a second reads as a dropout,
   * not as weight. The caller passes `timeScale * focus.scale`, which is the
   * dilation the player is HOLDING.
   *
   * Rate-limited on 0.01 for the same reason `_bed` is: `setTargetAtTime` at
   * 60 Hz is a ramp that never arrives anywhere.
   */
  setTimeScale(scale) {
    if (!this.ready || !this.timeLP) return this._timeAt;
    const s = clamp(num(scale, 1), 0.02, 2);
    if (Math.abs(s - this._timeAt) < 0.01) return this._timeAt;
    this._timeAt = s;
    const t = this.ctx.currentTime;
    try {
      this.timeLP.frequency.setTargetAtTime(700 + 19300 * Math.pow(Math.min(s, 1), 0.55), t, 0.08);
      // A little resonance on the way down, so the filter is heard closing
      // rather than the mix simply getting quieter.
      this.timeLP.Q.setTargetAtTime(0.7 + clamp(1 - s, 0, 1) * 0.9, t, 0.08);
    } catch {}
    this._timePitch = 0.55 + 0.45 * clamp(s, 0, 1);
    return s;
  }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    // num() and not this.volume directly: a stored setting is whatever was in
    // localStorage, and `gain.value = NaN` throws here, halfway through the
    // graph, leaving ctx set and ready false — permanent silence, no console.
    this.master.gain.value = num(this.volume, 0.8);

    // A gentle bus compressor keeps a hundred droids from clipping the mix.
    this.comp = this.ctx.createDynamicsCompressor();
    // A limiter for the peaks, not a blanket. At -14dB with a 22dB knee the
    // soft knee began at -25dBFS, so essentially every sound in the game was
    // being compressed all the time — quiet UI blips vanished and the whole mix
    // pumped on each blaster shot.
    this.comp.threshold.value = -6;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.12;

    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 1;
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = num(this.musicVolume, 0.45);
    /**
     * THE ONE NODE THE MUSIC IS DUCKED ON, and it is not the one the slider
     * writes.
     *
     * `duckMusic` used to automate `musicBus.gain` — the same param
     * `setMusicVolume` owns — so the two fought: a duck schedules a return to
     * `this.musicVolume` AS IT WAS WHEN THE DUCK STARTED, and a slider moved
     * inside that window was silently undone a second later. Worse, nothing at
     * all ducked the music before a clash or a death cry, which is the whole
     * reason the mix had no room in it.
     *
     * So: `musicBus.gain` is the PLAYER'S LEVEL and nothing else ever writes
     * it, and `musicDuck.gain` is the automation, resting at 1. Both the
     * streamed track and the generated score go through it, because both of
     * them are the music and both of them have to get out of the way.
     */
    this.musicDuck = this.ctx.createGain(); this.musicDuck.gain.value = 1;
    this.musicDuck.connect(this.musicBus);
    // Wind and drone are the world, not the score. On musicBus, turning the
    // music down muted the level's own atmosphere along with it.
    this.ambBus = this.ctx.createGain(); this.ambBus.gain.value = 1;

    // Speech goes to the compressor DIRECTLY. On sfxBus, the duck that exists
    // to make a line audible over a firefight would duck the line with it.
    this.speechBus = this.ctx.createGain();
    this.speechBus.gain.value = num(this.voiceLevel, 0.9);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.6);
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0.16;

    /**
     * THE ONE NODE THAT MAKES SLOW MOTION AUDIBLE. See setTimeScale().
     *
     * Force Sense drops the world to 0.42× and a full Focus hold to 0.18×, and
     * `grep focus src/engine/Audio.js` returned nothing at all: the game's
     * signature power bent time and the mix did not move by a decibel. It sits
     * between the effects bus and everything downstream of it — the compressor
     * AND the reverb send — because a slowed room is darker too, and a bright
     * tail hanging off a dark dry signal is the one arrangement that sounds
     * broken rather than slow.
     *
     * Wide open at 1× (20 kHz is above the material and above most listeners),
     * so a game nobody has slowed measures byte-identical to one without it.
     */
    this.timeLP = this.ctx.createBiquadFilter();
    this.timeLP.type = 'lowpass';
    this.timeLP.frequency.value = 20000;
    this.timeLP.Q.value = 0.7;
    this._timeAt = 1;
    /** What new one-shots are multiplied by while the world is slow. */
    this._timePitch = 1;

    this.sfxBus.connect(this.timeLP);
    this.timeLP.connect(this.comp);
    this.timeLP.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.ambBus.connect(this.comp);
    this.speechBus.connect(this.comp);
    // The score bypasses the compressor: on it, every blaster shot pumped the
    // music down with it.
    this.musicBus.connect(this.master);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this._noiseBuf = this._makeNoise(2.0, false);
    this._pinkBuf = this._makeNoise(2.0, true);
    this.ready = true;
    this._startAmbience();
    /**
     * THE GENERATED SCORE. See src/engine/Score.js.
     *
     * Built here rather than lazily on the first wave, because its eleven
     * sustained oscillators are started once and glided for the life of the
     * session — a bed that had to be constructed at the moment a fight began
     * would arrive a frame late, every time, and that frame is the one the
     * whole feature exists for.
     *
     * It plays into `musicDuck` and NOT into `sfxBus`: it is music, so the
     * Music slider owns it, the duck reaches it, and the master compressor
     * does not (a blaster shot must not pump the score — see musicBus).
     */
    this.score = new Score(this.ctx, this.musicDuck, this._pinkBuf);
    this._applyTrack();
  }

  /**
   * Ask the context to come back, at most four times a second.
   *
   * `suspended` is not the only stopped state — Safari parks a context in
   * `interrupted` when a phone call or another tab takes the audio session, and
   * the old check for `=== 'suspended'` left those muted for good. resume()
   * returns a promise that is rejected outright when there has been no user
   * gesture yet, and an unhandled rejection there used to show up in the
   * console as the only sign anything was wrong.
   */
  resume() {
    if (!this.ctx || this.ctx.state === 'running' || this.ctx.state === 'closed') return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - (this._lastWake || -1e9) < 250) return;
    this._lastWake = now;
    try { this.ctx.resume()?.catch?.(() => {}); } catch {}
  }

  /**
   * Is it worth scheduling anything right now?
   *
   * A stopped context freezes currentTime, so every sound scheduled while it is
   * down lands on the same timestamp and arrives as one crack when it comes
   * back; and none of those sources can fire `ended` in the meantime, so the
   * pool fills with voices that only the wall-clock backstop can retire. A
   * browser that blocked autoplay therefore produced exactly the reported
   * symptom — nothing for a while, then a burst, then nothing again. Dropping
   * the sound and nudging the context is strictly better than both halves.
   *
   * A context with no `state` at all is a stub in a test; let it through.
   */
  _live() {
    const s = this.ctx.state;
    if (!s || s === 'running') return true;
    this.stats.dropped++;
    this.resume();
    return false;
  }

  setVolume(v) {
    // A NaN here is a permanent, silent mute: master.gain.value = NaN throws
    // inside init(), which leaves `ready` false and every sound a no-op with
    // nothing in the console to say why.
    this.volume = num(v, 0.8);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }
  /**
   * The Music slider, and the one place "off" is allowed to mean off.
   *
   * This used to write `musicBus.gain` and nothing else, which made Music 0 a
   * setting that streams and decodes 29,400,953 bytes in order to play them at
   * zero. Zero is not "silently"; it is "do not send it". So the slider also
   * owns the element: at zero the stream is paused (or never created — see
   * playMusic), and the first move off zero starts or resumes it.
   */
  setMusicVolume(v) {
    this.musicVolume = num(v, 0.45);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.02);
    this._applyTrack();
  }

  /**
   * WHAT IS ACTUALLY PLAYING, given the row and the slider — one place, and
   * every caller that can move either of them ends here.
   *
   * There are three kinds of row and they need three different things done:
   * the generated score is a graph to switch on, the streamed one is an
   * element to build or pause, and silence is neither. That decision used to be
   * repeated in four callers, each of which knew about only the case it was
   * written for; adding a third kind to that arrangement is how a track ends up
   * playing under the one the player chose.
   */
  _applyTrack() {
    if (!this.ready) return null;
    const t = trackAt(this.musicIndex);
    const on = this.musicVolume > 0;
    const synth = !!(t && t.synth);
    // The two BEDS are alternatives, so the one that was not chosen is STOPPED
    // and not merely turned down: a 28 MB stream paused at zero is still 28 MB.
    // The stingers are not a bed and survive the streamed track — see
    // `Score.arm`, and the one row that turns them off too.
    this.score?.enable(synth && on);
    this.score?.arm(on && !isSilent(t));
    if (synth) { if (this._music) this.setMusicPlaying(false); return t; }
    if (on) { if (this._music) this.setMusicPlaying(true); else this._startMusic(); }
    else if (this._music) this.setMusicPlaying(false);
    return t;
  }
  /** The speech mixer. Zero is a legitimate answer and means "no voices". */
  setVoiceLevel(v) {
    this.voiceLevel = clamp(num(v, 0.9), 0, 1.5);
    if (this.speechBus) this.speechBus.gain.setTargetAtTime(this.voiceLevel, this.ctx.currentTime, 0.03);
  }

  /**
   * THE SCORE — streamed, never decoded.
   *
   * `decodeAudioData` is how every other sound in this file is made, and it is
   * the wrong tool for a 49-minute track by three orders of magnitude: decoded
   * to float32 at 44.1 kHz stereo that file is about 1.0 GB resident, and the
   * tab dies before the first note. An <audio> element streams it — the browser
   * pulls only what it is about to play, `loop` is handled natively with no gap
   * to schedule, and `createMediaElementSource` routes it into the same
   * musicBus the Music slider already controls, so volume and mute come for
   * free and cost nothing to wire.
   *
   * Everything here is best-effort by design. A missing file, a codec the
   * browser will not take, or an autoplay policy that refuses the first play()
   * must all end in "no music" — never in a broken game. The score is the one
   * asset in this project that is not procedural, so it is also the only one
   * that can fail to load at all.
   *
   * ── two things this call does NOT do any more ───────────────────────────
   *
   * IT DOES NOT FETCH ANYTHING THE PLAYER DID NOT ASK FOR. src/main.js binds
   * the start to the first pointerdown or keydown anywhere on the page, which
   * is right — that gesture is what unlocks the context — but it meant the
   * largest file in the repository by two orders of magnitude (theme.mp3,
   * 29,400,953 bytes = 28.0 MB) began downloading with `preload='auto'` before
   * the player had picked a level, a voice or a difficulty, and whatever the
   * Music slider said. Music 0 wrote `musicBus.gain` and nothing else: the
   * element still streamed, still decoded, and still cost 28 MB to hear
   * nothing. So the url is ARMED here and only started while `musicVolume > 0`;
   * setMusicVolume() is what starts it later, and pauses it again at zero.
   *
   * IT TAKES A LIST. assets/music/README.md tells the maintainer replacing the
   * score to split it as `theme.mp3` + `theme2.mp3` to get under GitHub's
   * 25 MB web-upload limit, and promised that "the player will chain them
   * seamlessly and loop back to the first". Nothing chained anything: `theme2`
   * occurred exactly once in the whole repository, in that sentence, and a
   * maintainer who followed the project's own first instruction shipped a game
   * that played half its score and looped it with nothing in the console to say
   * why. A list is chained on `ended` and wraps to the first; a member that
   * fails to load is stepped over, so the single-file install pays nothing at
   * all for the second name.
   */
  playMusic(urls, opts = {}) {
    if (!this.ready || this._music) return null;
    if (typeof Audio === 'undefined' || typeof document === 'undefined') return null;
    const list = (Array.isArray(urls) ? urls : [urls]).filter(u => typeof u === 'string' && u);
    if (!list.length) return null;
    this._musicWanted = { list, opts };
    // ARMED, not started. main.js binds this to the first gesture anywhere on
    // the page whatever the player picked, so the row decides whether a byte is
    // ever fetched — a profile on the generated score (which is the default)
    // must not pull 28 MB in order to play none of it.
    this._applyTrack();
    // `|| null` and not the field: `_music` is undefined until something builds
    // one, and a caller testing `=== null` for "nothing was started" is right to.
    return this._music || null;
  }

  /**
   * WHICH SCORE IS PLAYING — the selection, and the whole of its mechanism.
   *
   * "I want to have different options for the soundtrack, is that possible?
   * like selecting one or the other?" There was one url, hard-armed by
   * main.js, and no way to say anything about it but how loud.
   *
   * The list of tracks is DATA (MUSIC_TRACKS, above) rather than a switch
   * statement, so a new score is one row and a file; and row 0 carries no
   * files at all on purpose — it means "whatever the game armed", which is
   * what keeps `playMusic(['one.mp3','two.mp3'])` chaining a split score
   * exactly as it did and keeps a fresh profile on the shipped theme without
   * this file having to know its name.
   *
   * The urls of a chosen track are resolved against the DIRECTORY the caller
   * armed, which is the one piece of knowledge the engine genuinely does not
   * have: main.js builds `new URL('../assets/music/x.mp3', import.meta.url)`,
   * and a track named here as `theme2.mp3` has to land beside it.
   */
  _trackList() {
    const armed = this._musicWanted ? this._musicWanted.list : [];
    const t = trackAt(this.musicIndex);
    if (!t || !t.files) return armed;                 // the shipped score
    if (!t.files.length) return [];                   // silence, or generated
    const base = (armed[0] || '').replace(/[^/]*$/, '');
    return t.files.map(f => base + f);
  }

  /**
   * Choose a score. Takes an index into MUSIC_TRACKS, clamped.
   *
   * Live: a track picked mid-run tears the old stream down and starts the new
   * one, because the alternative is a control that only works from the front
   * screen — and the pause card is where a player realises they have had
   * enough of the track. At Music 0 it is remembered and nothing is fetched,
   * which is the same rule the volume slider already obeys.
   */
  setMusicTrack(i) {
    const want = Math.max(0, Math.min(MUSIC_TRACKS.length - 1, Math.round(num(i, 0))));
    if (want === this.musicIndex) return trackAt(this.musicIndex);
    this.musicIndex = want;
    this._stopMusic();
    this._applyTrack();
    return trackAt(this.musicIndex);
  }

  /** Tear the stream down so a different one can be built. */
  _stopMusic() {
    const m = this._music;
    if (!m) return false;
    this._music = null;
    try { m.el.pause(); } catch {}
    try { m.el.src = ''; } catch {}
    try { m.gain.disconnect(); } catch {}
    try { m.src.disconnect(); } catch {}
    return true;
  }

  /** Build the element for the armed url list and start it. */
  _startMusic() {
    if (this._music || !this._musicWanted || !this.ready) return this._music || null;
    if (typeof Audio === 'undefined' || typeof document === 'undefined') return null;
    const { opts } = this._musicWanted;
    const list = this._trackList();
    // A track with no files is a CHOICE — "no score" — and not a failure, so
    // it builds no element and reports no error. Nothing to fetch, nothing to
    // decode, nothing to pause.
    if (!list.length) return null;
    try {
      const el = new Audio();
      el.src = list[0];
      // One file loops natively, with no gap for anything to schedule. A list
      // cannot — the element has to be handed the next url when this one ends —
      // so `loop` is the single-file case only.
      el.loop = list.length === 1 && opts.loop !== false;
      /* 'auto' — PULL IT NOW, and that is a reversal with a reason.
       *
       * This was 'metadata' on the argument that `play()` drives the fetch on
       * its own and only as far as it is playing, which is true and which is
       * why the score arrived late every single time: nothing was fetched
       * until the first click, so the gesture had to pay for the connection,
       * the decode AND the buffer before a note came out. Reported as "there
       * is a lag with the soundtrack, it doesn't actually start playing until
       * you click a button — it needs to play as early as you can".
       *
       * `main.js` now arms the score at module load instead of on the gesture,
       * so the element exists and the connection is warm while the player is
       * reading the menu, and `play()` has somewhere to start the instant the
       * autoplay gate lifts.
       *
       * 'metadata' AND NOT 'auto', and the difference is 28 MB. 'auto' asks the
       * browser for the WHOLE file up front — 29,400,953 bytes, the largest
       * thing in the repository by two orders of magnitude — before a note has
       * been heard, and it was set here in the belief that a score cannot start
       * early unless it has already arrived. It can: `play()` on a streaming
       * element starts as soon as the first buffer lands, which for an MP3 is a
       * fraction of a second, and the rest arrives behind the playhead. So the
       * early start survives and the download does not.
       *
       * The check that holds this reads the source AND the element (see
       * tools/checks/music.mjs, "the score is STREAMED, never decoded into
       * memory"), because the value is one word and the cost is a quarter of a
       * gigabyte across ten players.
       *
       * It is also not a fetch nobody asked for: `_applyTrack` refuses to build
       * this element at all while the Music slider is at 0, so a player who does
       * not want the score never pays for it. */
      el.preload = 'metadata';
      el.crossOrigin = 'anonymous';
      // The element's own volume stays at 1: the musicBus is the only place
      // loudness is decided, or the slider and the element would fight and the
      // result would depend on which one moved last.
      el.volume = 1;
      const src = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      // Fade in rather than cutting in on the menu: a 49-minute score that
      // starts at full level the instant the context unlocks is a jump-scare.
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(num(opts.gain, 1), this.ctx.currentTime, opts.fade ?? 1.6);
      // → musicDuck → musicBus. The stream is ducked by the same node the
      // generated score is, because both of them are the music: a clash has to
      // make room in the mix whichever one the player chose.
      src.connect(gain); gain.connect(this.musicDuck);
      const m = this._music = { el, src, gain, list, at: 0 };
      const go = () => { try { el.play()?.catch?.(() => {}); } catch {} };
      if (list.length > 1) {
        let missing = 0;
        const advance = (failed) => {
          // A member that is not there is stepped over exactly once per pass.
          // Without the counter, a split score whose second half was never
          // uploaded is an error-load-error loop at network speed.
          if (failed) { if (++missing >= list.length) return; } else missing = 0;
          m.at = (m.at + 1) % list.length;
          try { el.src = list[m.at]; } catch { return; }
          go();
        };
        el.addEventListener('ended', () => advance(false));
        el.addEventListener('error', () => advance(true));
      } else {
        /*
         * A CHOSEN TRACK WHOSE FILE IS NOT THERE says so, once, and gives the
         * shipped score back.
         *
         * The list is data and the files are not in the repository — that is
         * the whole point of a data-driven list, and it means a row can name
         * an mp3 nobody has dropped in yet. Silence with no explanation is the
         * worst of the three possible answers; inventing a track is the
         * second worst. So the failure is HANDED to the options screen —
         * `onMusicMissing`, which is what the menu registers and what caches
         * the name it prints — and the engine falls back to row 0. There used
         * to be a `this.musicMissing` field beside it, written three times and
         * read nowhere, and TWO comments (this one included) named that field
         * as the reporting path while the callback next to them did the work.
         * The field is gone; one path, and it is the one that runs. Row 0 —
         * which is now the GENERATED score, and is therefore the one row that
         * cannot itself fail to arrive. A fallback that can 404 is not one.
         */
        el.addEventListener('error', () => {
          const t = trackAt(this.musicIndex);
          if (!t || !t.files || !t.files.length) return;      // the shipped score itself
          this._stopMusic();
          this.musicIndex = 0;
          this.onMusicMissing?.(t);
          this._applyTrack();
        });
      }
      go();
      // An autoplay block is not an error, it is a "not yet" — retry on the
      // first real gesture, which is the same event that unlocks the context.
      if (el.paused) {
        const once = () => {
          this.resume(); go();
          if (!el.paused) {
            for (const e of ['pointerdown', 'keydown']) window.removeEventListener(e, once);
          }
        };
        for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, once);
      }
      return this._music;
    } catch { this._music = null; return null; }
  }

  /**
   * Silence the score without tearing the stream down, so it can come back.
   *
   * This is what Music 0 does. Pausing the element rather than dropping it
   * keeps the position, the decoder and the connection, so sliding back up
   * resumes rather than restarting a 49-minute track from the top — and it is
   * what stops the browser pulling the rest of a 28 MB file nobody is hearing.
   */
  setMusicPlaying(on) {
    const m = this._music;
    if (!m) return;
    try {
      if (on) { this.resume(); m.el.play()?.catch?.(() => {}); }
      else m.el.pause();
    } catch {}
  }

  _makeNoise(seconds, pink) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (!pink) { for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1; }
    else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (rng() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.35);
      }
    }
    return buf;
  }

  /* ── spatialisation ────────────────────────────────────────────────── */

  updateListener(camera) {
    if (!this.ready) return;
    // The context gets suspended by the browser on tab-switch, on losing
    // pointer lock, and on some autoplay heuristics. Nothing re-arms it on its
    // own, so a silent watchdog does — cheaply, twice a second. resume() rate
    // limits itself, so this only needs to stop the state read being per-frame.
    this._resumeCheck = (this._resumeCheck || 0) + 1;
    if ((this._resumeCheck & 31) === 0) this.resume();
    const l = this.ctx.listener;
    camera.getWorldPosition(this._listenerPos);
    const q = camera.getWorldQuaternion(_lq);
    const fwd = _lf.set(0, 0, -1).applyQuaternion(q);
    const up = _lu.set(0, 1, 0).applyQuaternion(q);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(this._listenerPos.x, t, 0.02);
      l.positionY.setTargetAtTime(this._listenerPos.y, t, 0.02);
      l.positionZ.setTargetAtTime(this._listenerPos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02); l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else if (l.setPosition) {
      l.setPosition(this._listenerPos.x, this._listenerPos.y, this._listenerPos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  _panner(pos, refDist = REF_DIST, maxDist = MAX_DIST) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = maxDist;
    p.rolloffFactor = ROLLOFF;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  /**
   * Where does this sound play, and is it worth playing at all?
   *
   *   0 — inaudible. Do not spend a voice on it.
   *   1 — flat into the effects bus: no position, or one with a NaN in it. A
   *       NaN anywhere in a position makes PannerNode throw, which used to leak
   *       the voice that had already been taken.
   *   2 — through a panner of its own.
   *
   * This has to be answerable BEFORE a voice is taken and before any node
   * exists, which is the whole reason it is separate from _out().
   */
  _reach(pos, gain = 1, ref = REF_DIST, maxD = MAX_DIST) {
    if (!pos) return 1;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return 1;
    const d = this._listenerPos.distanceTo(pos);
    if (!(d <= MAX_RANGE)) return 0;
    return num(gain, 1) * attenuation(d, ref, maxD) >= HEARING_FLOOR ? 2 : 0;
  }

  _out(pos, gain = 1) {
    const r = this._reach(pos, gain);
    if (r === 0) return null;
    if (r === 1) return this.sfxBus;
    const p = this._panner(pos);
    p.connect(this.sfxBus);
    return p;
  }

  /**
   * Take a voice from the band this sound is allowed to draw on.
   *
   * The ceiling is recomputed rather than cached so that changing maxVoices at
   * runtime keeps the shape of the bands instead of stranding them.
   */
  _voice(prio = PRIO.world) {
    this.stats.req++;
    if (this.voices >= this.bandCap(prio)) { this.stats.denied++; return false; }
    this.voices++;
    this.stats.alloc++;
    if (this.voices > this.stats.peak) this.stats.peak = this.voices;
    return true;
  }
  /** Hand a voice back to the pool. Idempotent — callers may race. */
  _release() {
    if (this.voices <= 0) { this.voices = 0; return; }
    this.voices--;
    this.stats.freed++;
  }

  /**
   * Retire a voice once its source has actually finished.
   *
   * This used to be a wall-clock setTimeout, which is wrong in three ways that
   * all end in silence. A backgrounded tab throttles timers to one per minute,
   * so a pool that was full when you alt-tabbed stays full long after you come
   * back. A suspended context freezes ctx.currentTime while wall-clock runs on,
   * so the timer fires for a sound that never played. And the timer raced the
   * source's own stop time, unplugging the output from under it.
   *
   * `ended` fires on the audio clock, which is the only clock that knows when
   * the sound is over. The timer stays purely as a backstop for the case where
   * `ended` never arrives at all.
   *
   * Only ever tear down the per-voice panner: a non-positional sound routes
   * straight to the shared sfxBus, and disconnecting *that* unplugs the whole
   * effects bus from the compressor, silencing the game for the rest of the
   * session after the first UI blip.
   */
  _freeOnEnd(src, node, dur) {
    let done = false, timer = 0;
    const release = () => {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = 0; }
      this._release();
      if (!node || node === this.sfxBus || node === this.musicBus || node === this.master
          || node === this.speechBus || node === this.ambBus || node === this.comp) return;
      try { node.disconnect(); } catch {}
    };
    try { src.onended = release; } catch { /* fall through to the backstop */ }
    // Cancelling the backstop the moment `ended` lands matters at this rate. A
    // busy arena grants 60 voices a second now and granted 150 before the pool
    // was banded, so leaving each 1.3 s timer to expire on its own left 80 to
    // 200 dead timers pending at all times, each holding its closure — and its
    // panner — alive long after the sound had finished.
    timer = setTimeout(release, (num(dur, 0.2) + 1.2) * 1000);
  }

  /* ── primitives ────────────────────────────────────────────────────── */

  noise({ dur = 0.2, gain = 0.4, type = 'bandpass', freq = 1200, q = 1.2, freqEnd = null,
          pos = null, pink = false, attack = 0.002, curve = 2.2, prio = PRIO.world } = {}) {
    if (!this.ready || !this._live()) return;
    // Sanitise BEFORE taking a voice. Every AudioParam below rejects a
    // non-finite value with a TypeError, and a throw between _voice() and the
    // release leaks that voice permanently — 44 of them and the game is mute.
    dur = num(dur, 0.2); gain = num(gain, 0.4); freq = num(freq, 1200); q = num(q, 1.2);
    attack = num(attack, 0.002); curve = num(curve, 2.2) || 2.2;
    if (freqEnd !== null) freqEnd = num(freqEnd, freq);
    // …and DOWN with the world, if it is slow. See setTimeScale(): exactly 1
    // at full speed, so nothing changes for a game nobody has dilated.
    if (this._timePitch !== 1) { freq *= this._timePitch; if (freqEnd !== null) freqEnd *= this._timePitch; }

    // Decide, then allocate, and in that order. _out() used to build and
    // connect the panner and only then ask for a voice, so every refusal left a
    // live HRTF panner hanging off the effects bus: 1330 of them over 24 s of
    // an arena fight, one for every sound the full pool turned away.
    const reach = this._reach(pos, gain);
    if (!reach) { this.stats.culled++; return; }
    if (!this._voice(prio)) return;
    let out = null;
    try {
      out = reach === 2 ? this._panner(pos) : this.sfxBus;
      if (out !== this.sfxBus) out.connect(this.sfxBus);
      const t = this.ctx.currentTime;
      const stopAt = t + dur + 0.06;
      const src = this.ctx.createBufferSource();
      src.buffer = pink ? this._pinkBuf : this._noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.85 + rng() * 0.3;
      const flt = this.ctx.createBiquadFilter();
      flt.type = type; flt.frequency.value = freq; flt.Q.value = q;
      if (freqEnd !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setTargetAtTime(0.0001, t + attack, dur / curve);
      // The exponential release only ever reaches ~11% of peak, so cutting the
      // source there clicks. Ramp the last of it to silence first.
      g.gain.linearRampToValueAtTime(0.0001, stopAt);
      src.connect(flt); flt.connect(g); g.connect(out);
      src.start(t + rng() * 0.004);
      src.stop(stopAt + 0.01);
      this._freeOnEnd(src, out, dur);
    } catch {
      this.stats.threw++;
      this._release();
      // A half-built voice must not leave its panner on the bus either.
      if (out && out !== this.sfxBus) { try { out.disconnect(); } catch {} }
    }
  }

  tone({ freq = 440, freqEnd = null, dur = 0.2, gain = 0.25, type = 'sine', pos = null,
         attack = 0.004, detune = 0, filter = null, prio = PRIO.world } = {}) {
    if (!this.ready || !this._live()) return;
    dur = num(dur, 0.2); gain = num(gain, 0.25); freq = num(freq, 440);
    attack = num(attack, 0.004); detune = num(detune, 0);
    if (freqEnd !== null) freqEnd = num(freqEnd, freq);
    if (this._timePitch !== 1) { freq *= this._timePitch; if (freqEnd !== null) freqEnd *= this._timePitch; }

    const reach = this._reach(pos, gain);
    if (!reach) { this.stats.culled++; return; }
    if (!this._voice(prio)) return;
    let out = null;
    try {
      out = reach === 2 ? this._panner(pos) : this.sfxBus;
      if (out !== this.sfxBus) out.connect(this.sfxBus);
      const t = this.ctx.currentTime;
      const stopAt = t + dur + 0.05;
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setTargetAtTime(0.0001, t + attack, dur / 2.6);
      // an oscillator chopped mid-cycle at 7% of peak is an audible click
      g.gain.linearRampToValueAtTime(0.0001, stopAt);
      let node = o;
      if (filter) {
        const f = this.ctx.createBiquadFilter();
        f.type = filter.type || 'lowpass';
        f.frequency.value = num(filter.freq, 2000); f.Q.value = num(filter.q, 1);
        o.connect(f); node = f;
      }
      node.connect(g); g.connect(out);
      o.start(t); o.stop(stopAt + 0.01);
      this._freeOnEnd(o, out, dur);
    } catch {
      this.stats.threw++;
      this._release();
      if (out && out !== this.sfxBus) { try { out.disconnect(); } catch {} }
    }
  }

  /* ── speech ────────────────────────────────────────────────────────── */

  /**
   * Say one line, in one voice.
   *
   * A whole utterance costs ONE voice from the pool no matter how many grains
   * it is built from, because it is one sound as far as the player is
   * concerned: a five-grain syllable is not five sounds any more than a chord
   * is three notes of separate music. All of the grains hang off a single
   * per-utterance gain node, which is also the handle the ducking rules move.
   *
   * @param spec  a voice spec from src/engine/Voice.js
   * @param kind  a key of LINES — 'effort', 'kill', 'boss', 'scream', …
   * @param opts  {pos, gain, vary, self, prio}
   * @returns the length of the line in seconds, or 0 if it was not spoken.
   */
  /**
   * SYNTHESISED, SPOKEN, OR BOTH.
   *
   * Three states and not a checkbox, because they are three different things a
   * player might want and one of them is the game as it stands. 'synth' is the
   * default so that nobody's game changes under them.
   *
   * An unknown value is 'synth' rather than an error: this arrives from a
   * settings blob on disk.
   */
  setSpeechMode(mode) {
    this.speechMode = (mode === 'spoken' || mode === 'both') ? mode : 'synth';
    if (this.speechMode === 'synth') this.stopWords();
    return this.speechMode;
  }

  /**
   * THE NEXT THING THIS POWER SAYS — the anti-staleness half of the note.
   *
   * "maybe there's a pool of 3-4 things you can say for every force ability so
   * it doesnt get stale and you hear the same thing over and over".
   *
   * The pools and the rule for drawing from them are in src/engine/Voice.js,
   * beside the syllables — `nextForceLine` is pure and draws uniformly from the
   * n−1 lines that are NOT the one just said, so an immediate repeat is
   * impossible rather than merely unlikely. This is the memory that makes it
   * mean anything: one id per power, updated on the way out.
   *
   * IT SITS IN THE AUDIO ENGINE and not in Player.js, for the same reason
   * `wordsFor` does: the draw needs a seeded stream (`rng` at the head of this
   * file, seeded 4242) and the game needs exactly one of them, so that a run
   * replayed under the same seed says the same lines in the same order. A
   * `Math.random()` inside the picker would be a stream nothing can seed and
   * every measurement taken through it would move between runs.
   *
   * The memory advances even when the line is then refused by the announcer's
   * budget, and that is deliberate: what the player must not hear is the same
   * utterance twice IN A ROW, and a line nobody heard is not one of the two.
   *
   * @returns the contour id, or '' for a power with no pool — which is a power
   *          that was added to POWER_COST and not to FORCE_LINES, and the
   *          caller then says nothing rather than grunting.
   */
  forceLine(power) {
    if (!forcePool(power).length) return '';
    const id = nextForceLine(power, this._forceSaid[power] || '', rng());
    if (id) this._forceSaid[power] = id;
    return id;
  }

  /** Cancel anything the browser is part-way through saying. */
  stopWords() {
    if (!canSpeakWords()) return false;
    try { globalThis.speechSynthesis.cancel(); } catch {}
    return true;
  }

  /**
   * SAY IT IN WORDS — the other half of `speak`.
   *
   * Called from inside speak() rather than from the announcer, and that is the
   * whole design: `Announcer._say` already owns the budget that stops this
   * game babbling (one quip per QUIP_GAP whatever happens, a shorter budget
   * for the wordless efforts, one enemy line per ENEMY_GAP), and it spends
   * that budget by calling `audio.speak` and reading back a duration. Hanging
   * the words off the same call means every line the announcer decides to say
   * is spoken under the same rate limits, with no second gate to keep in step
   * and not one line of src/ui/Announcer.js changed.
   *
   * ONLY THE PLAYER'S OWN VOICE GETS WORDS (`opts.self`). The room is droids,
   * beasts and troopers, and the report was explicit that the alien speech is
   * the good part — a battle droid enunciating in the browser's default voice
   * would be a different game and a worse joke.
   *
   * `pitch` and `rate` are biased by the chosen larynx, so the five voices in
   * Options still mean something in spoken mode: The Mask speaks low and slow
   * and The Sage high and halting, because those are the numbers their own
   * specs carry — `f0` is the larynx's fundamental in Hz (88 to 208 across the
   * five) and `cadence` is its pace (0.72 to 1.45). Read off the spec rather
   * than written as a second table of five voices, which would be the same
   * defect this project keeps a section of the handoff for.
   *
   * Everything is inside a try: `speechSynthesis` is present-but-broken on
   * more platforms than it is absent from, and a voice line must never be able
   * to take a frame with it.
   */
  sayWords(kind, spec, opts = {}) {
    if (this.speechMode === 'synth' || !opts.self) return '';
    if (!canSpeakWords() || this.voiceLevel <= 0.001) return '';
    const text = wordsFor(kind, opts.pick ?? null);
    if (!text) return '';
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (now - this._spokeAt < WORD_GAP) return '';
    this._spokeAt = now;
    try {
      const u = new globalThis.SpeechSynthesisUtterance(text);
      // 130 Hz sits in the middle of the five shipped larynxes (88…208), so
      // the ratio either side of it maps the whole rack onto
      // speechSynthesis's own 0.1–2 pitch scale — clamped well inside it, so
      // no voice can come out as a chipmunk or a foghorn on a platform whose
      // synthesiser takes those numbers more literally than most.
      u.pitch = clamp(num(spec?.f0, 130) / 130, 0.55, 1.7);
      u.rate = clamp(num(spec?.cadence, 1) * 0.98, 0.6, 1.5);
      u.volume = clamp(this.voiceLevel * clamp(num(opts.gain, 1), 0, 2), 0, 1);
      // The browser queues; the game does not want a queue. Anything still
      // being said is a line about a fight that has moved on.
      globalThis.speechSynthesis.cancel();
      globalThis.speechSynthesis.speak(u);
      this.stats.words = (this.stats.words || 0) + 1;
      return text;
    } catch { return ''; }
  }

  /**
   * ONE WORD, INTO A WRIST COMM — player note #31's "every keystroke a word".
   *
   * A stratagem code used to be silent. It is a RADIO CALL now: the player
   * holds the comm up and speaks, and every direction they press is the next
   * word of the phrase (see `Stratagems.callPhrase`, which derives it, and
   * `Player._stratagemInput`, which is the only caller).
   *
   * ── WHY IT IS NOT `speak()` ─────────────────────────────────────────────
   *
   * `speak` is built around the announcer's vocabulary: a `kind` from
   * Voice.js's LINE_KINDS, one of a handful of authored SPOKEN_LINES chosen at
   * random, a `WORD_GAP` of 1.1 s under it and a `cancel()` before every line.
   * Every one of those is right for a quip and wrong for a phrase. A code is
   * eight words in about two seconds — the gap would silence seven of them,
   * the cancel would clip each one on the next, and the words are not a line
   * from a table, they are the specific thing the player is asking for.
   *
   * So this is a narrow second door with the shared parts kept shared: the
   * same larynx spec biases pitch and rate, the same `voiceLevel` gates it,
   * the same `speechMode` decides between words and a contour, and the same
   * `canSpeakWords` capability test arms it.
   *
   *   'synth'   the wordless larynx says a clipped syllable — one word, one
   *             sound, so the RHYTHM of the phrase is audible even with no
   *             speech synthesiser on the platform. `self: false` on purpose:
   *             a keystroke must not duck the music or fire a stinger.
   *   'spoken'  the browser says the actual word. It is NOT cancelled, so the
   *             words queue into a sentence, which is the one place in this
   *             file where the browser's queue is the feature.
   *   'both'    both, which is what the mode means everywhere else.
   *
   * `pos` is the player's own mouth, so a co-op partner spelling a code beside
   * you is audibly beside you.
   */
  radio(spec, text, opts = {}) {
    if (!this.ready || !spec || !this._live()) return '';
    if (this.voiceLevel <= 0.001) return '';
    let said = '';
    if (this.speechMode !== 'synth' && canSpeakWords() && text) {
      try {
        const u = new globalThis.SpeechSynthesisUtterance(String(text));
        u.pitch = clamp(num(spec.f0, 130) / 130, 0.55, 1.7);
        // Clipped: a radio call is not conversation. 1.25x the larynx's own
        // pace, inside speechSynthesis's own range.
        u.rate = clamp(num(spec.cadence, 1) * 1.25, 0.6, 1.6);
        u.volume = clamp(this.voiceLevel * clamp(num(opts.gain, 0.9), 0, 2), 0, 1);
        globalThis.speechSynthesis.speak(u);
        this.stats.words = (this.stats.words || 0) + 1;
        said = String(text);
      } catch { said = ''; }
    }
    if (this.speechMode !== 'spoken' || !said) {
      /* THE SQUELCH under the word, so the comm is a comm and not a person
       * talking to themselves. Short, band-limited, and it plays in every mode
       * — it is the radio, not the voice. */
      this.noise({ dur: 0.06, gain: 0.16, type: 'bandpass', freq: 2600, q: 3.4,
        attack: 0.004, pos: opts.pos || null });
      this.speak(spec, 'effort', { self: false, pos: opts.pos || null,
        gain: clamp(num(opts.gain, 0.62), 0, 2), vary: num(opts.vary, 0.5) });
    }
    return said;
  }

  /**
   * WHAT A VOICE LINE TELLS THE SCORE.
   *
   * Two of the beats the score needs have exactly one announcement in the whole
   * project and it is a line: `Announcer._player` says 'kill' or 'streak' off
   * the ladder it already keeps. Reading those is HANDOFF §2.4 — the rule for
   * what a killstreak IS stays in one place and this file listens to the call.
   *
   * THE THIRD ONE IS A CAUTIONARY TALE and it is why 'boss' here is not the
   * boss cue. `Announcer._enemies` says a 'boss' line for `e.A.boss || e.A.big`
   * — and `big` is carried by four archetypes with `unlockAt: 1`, held at about
   * 13% of every wave by `heavyLimit`. Deriving the boss STATE from that line
   * was written, and then measured against a real World with a real director on
   * the Colosseum: the score went to `boss` on wave 1 at t=0.5 s, and again on
   * wave 2, and would have on every wave after. A state that is always on is
   * not a state.
   *
   * So the line gets its own, smaller gesture — `heavy`, a third the length —
   * which is the honest reading of what the announcer actually detected, and
   * the boss cue belongs to the boss STATE, which only `setMusicState` can
   * declare because only the director knows.
   *
   * Called BEFORE the voice pool is consulted and before `voiceLevel` is read,
   * because the score's business is that the thing ARRIVED, not that a larynx
   * was free to say so. It is still downstream of `settings.voiceLines`, which
   * the announcer checks before it calls at all.
   *
   * `opts.audition` is the options screen dragging the voice slider. A player
   * comparing larynxes must not fire a killstreak stinger five times.
   */
  _scoreFromLine(kind, opts) {
    if (!this.score || opts.audition || !opts.self) return;
    if (kind === 'boss') this.stinger('heavy');
    else if (kind === 'kill') this.stinger('kill');
    else if (kind === 'streak') this.stinger('streak');
  }

  /**
   * THE MUSIC MAKES ROOM FOR A VOICE, for exactly as long as the voice lasts.
   *
   * The hold is the line's OWN duration and not a constant, which is what makes
   * one table right for a 0.22 s grunt and a 1.0 s death cry: the depth says how
   * much a speaker is worth and the length says how long they take. Only the
   * player and the lines a body says as it dies move the score at all — an
   * alarm call from the fourth droid in a squad is furniture, and furniture
   * does not get to stop the music.
   */
  _duckMusicForLine(kind, opts, dur) {
    const room = kind === 'scream' || kind === 'die' || kind === 'panic';
    if (!opts.self && !room) return false;
    const [level] = opts.self ? MUSIC_DUCK.self : MUSIC_DUCK.room;
    return this._duck(level, clamp(num(dur, 0.4), 0.12, 2.5) + 0.18);
  }

  speak(spec, kind = 'effort', opts = {}) {
    if (!this.ready || !spec || !this._live()) return 0;
    this._scoreFromLine(kind, opts);
    if (this.voiceLevel <= 0.001) return 0;
    /*
     * THE WORDS FIRST, and they do not depend on a voice being free.
     *
     * `speechSynthesis` is not on the WebAudio graph — it costs no voice, no
     * panner and no bus — so gating it behind the pool would mean a player in
     * spoken mode losing the line for a reason that has nothing to do with it.
     * In 'spoken' the synthesised contour is then skipped entirely, which is
     * what makes it a CHOICE rather than a layer: two versions of the same
     * line at once is what 'both' is for, and only when it is asked for.
     */
    const said = this.sayWords(kind, spec, opts);
    if (said && this.speechMode === 'spoken') {
      this.stats.spoke++;
      // The duration the announcer budgets against. Read off the words rather
      // than off a synthesised contour that was never built: roughly 12
      // characters a second, floored at half a second, which is what an
      // ordinary rate says a short line takes.
      const words = Math.max(0.5, said.length / 12);
      // …and the score makes room for words on the same terms it makes room
      // for a contour. A spoken line is MORE in need of it, not less.
      this._duckMusicForLine(kind, opts, words);
      return words;
    }
    const u = utterance(spec, kind, num(opts.vary, rng()));
    const level = clamp(num(opts.gain, 1), 0, 4);
    const pos = opts.pos || null;

    // Decide before allocating, in the same order every other sound uses.
    // The SAME curve the panner five lines down is built on. See `attenuation`.
    const reach = this._reach(pos, peakGain(u) * level, VOICE_REF, VOICE_MAX);
    if (!reach) { this.stats.culled++; return 0; }
    this._retireSpeech();
    if (this._speech.length >= this.maxSpeech) { this.stats.speechDenied++; return 0; }
    const prio = opts.self ? PRIO.critical : PRIO.combat;
    if (!this._voice(prio)) return 0;

    let out = null, bus = null;
    try {
      const t = this.ctx.currentTime;
      const stopAt = t + u.dur + 0.09;
      out = reach === 2 ? this._panner(pos, VOICE_REF, VOICE_MAX) : this.speechBus;
      if (out !== this.speechBus) out.connect(this.speechBus);

      bus = this.ctx.createGain();
      // RULE 2, the first half: the second live line sits under the first.
      // `level > 0` and not `length`, because audition() silences the line a
      // slider drag left playing — a line nobody can hear must not be the
      // reason the one the player chose comes in at 0.55.
      const stack = this._speech.some(e => e.level > 0) ? SPEECH_STACK : 1;
      const target = level * stack;
      bus.gain.value = target;
      bus.connect(out);

      // The LAST grain to finish, which is not the last in the list: a
      // syllable's breath layer is shorter than its voiced core, so trusting
      // the array order retired the line before its own tail had played.
      let last = null, lastEnd = -1;
      for (const g of u.grains) {
        this._grain(g, bus, t, (src, end) => { if (end > lastEnd) { lastEnd = end; last = src; } });
      }
      if (!last) throw new Error('an utterance with no grains');

      // RULE 2, the second half: the player talks over the room.
      if (opts.self) {
        for (const e of this._speech) {
          if (e.self) continue;
          try { e.bus.gain.setTargetAtTime(e.level * SPEECH_UNDER, t, 0.05); } catch {}
          e.ducked = true;
          this.stats.ducked++;
        }
      }

      const entry = { bus, level: target, endsAt: stopAt, self: !!opts.self, kind, id: spec.id,
        ducked: false, audition: !!opts.audition };
      this._speech.push(entry);
      this.stats.spoke++;
      this._duckRoom(u.dur);
      this._duckMusicForLine(kind, opts, u.dur);

      /**
       * The utterance is retired by its LAST grain.
       *
       * `_freeOnEnd` owns the pool voice and the panner and wants a source to
       * hang an `onended` on; the shim is that source, and the real handler is
       * chained under the grain's own node cleanup so neither is lost. Its
       * wall-clock backstop can still fire on its own, which is why
       * `_retireSpeech` also releases the bus of anything it finds stale.
       */
      const shim = {};
      this._freeOnEnd(shim, out, u.dur + 0.09);
      const grainCleanup = last.onended;
      last.onended = () => {
        try { grainCleanup?.(); } catch {}
        const i = this._speech.indexOf(entry);
        if (i >= 0) this._speech.splice(i, 1);
        try { bus.disconnect(); } catch {}
        try { shim.onended?.(); } catch {}
      };
      return u.dur;
    } catch {
      this.stats.threw++;
      this._release();
      if (bus) { try { bus.disconnect(); } catch {} }
      if (out && out !== this.speechBus) { try { out.disconnect(); } catch {} }
      return 0;
    }
  }

  /** One grain of an utterance: source → filter → envelope → the line's bus. */
  _grain(g, bus, t0, keep) {
    const t = t0 + num(g.t, 0);
    const dur = Math.max(0.01, num(g.dur, 0.1));
    const stopAt = t + dur + 0.01;
    const src = g.src === 'noise'
      ? this.ctx.createBufferSource()
      : this.ctx.createOscillator();
    if (g.src === 'noise') {
      src.buffer = this._noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.9 + rng() * 0.2;
    } else {
      src.type = g.src;
      const f0 = Math.max(20, num(g.f0, 120));
      src.frequency.setValueAtTime(f0, t);
      src.frequency.exponentialRampToValueAtTime(Math.max(20, num(g.f1, f0)), t + dur);
    }
    const flt = this.ctx.createBiquadFilter();
    flt.type = g.filter?.type || 'bandpass';
    flt.frequency.value = clamp(num(g.filter?.freq, 900), 30, 18000);
    flt.Q.value = clamp(num(g.filter?.q, 4), 0.1, 30);
    const env = this.ctx.createGain();
    const a = Math.max(0.002, num(g.attack, dur * 0.15));
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, num(g.gain, 0.2)), t + a);
    env.gain.setTargetAtTime(0.0001, t + a, dur / 2.2);
    env.gain.linearRampToValueAtTime(0.0001, stopAt);
    src.connect(flt); flt.connect(env); env.connect(bus);
    src.start(t);
    src.stop(stopAt);
    src.onended = () => { try { env.disconnect(); } catch {} try { flt.disconnect(); } catch {} };
    keep(src, stopAt);
  }

  /** RULE 3 — hold the room down while somebody is talking. */
  _duckRoom(dur) {
    const t = this.ctx.currentTime;
    const until = t + num(dur, 0.3) + DUCK_TAIL;
    if (until <= this._duckUntil) return;
    this._duckUntil = until;
    try {
      this.sfxBus.gain.cancelScheduledValues(t);
      this.sfxBus.gain.setTargetAtTime(SFX_DUCK, t, 0.04);
      this.sfxBus.gain.setTargetAtTime(1, until, 0.10);
    } catch {}
  }

  /**
   * AUDITION a voice for a control the player is DRAGGING.
   *
   * The options screen's voice slider is bound to `input`, which fires on every
   * step of a drag, and its handler refused anything while `speaking > 0`. The
   * arithmetic of that: a 'streak' line runs 0.35–0.80 s across the five
   * archetypes (measured — chosen 0.35–0.40, negotiator 0.51–0.58, mask
   * 0.63–0.72, sage 0.70–0.80), and a drag across the table fires five `input`
   * events inside a few hundred milliseconds. The FIRST one plays and the other
   * four are dropped on the floor — including the one the player let go on. The
   * name and the blurb said The Sage; what the player heard was The Mask. The
   * one control in the game whose entire purpose is auditioning was the one
   * that played the wrong item, and there is no `change`-event re-fire on
   * release to save it.
   *
   * So: leading edge plus trailing edge. The first move speaks immediately —
   * clicking a slider step has to answer at once or it reads as broken — and
   * every move after it re-arms a AUDITION_GAP timer that speaks whatever the
   * LAST index was, once the hand has stopped. Anything a previous step left
   * playing is faded out first rather than left to stack, because the engine's
   * own rules would otherwise duck the new line to SPEECH_STACK under it or
   * refuse it outright past MAX_SPEECH.
   *
   * @returns true if it spoke on this call, false if it was queued.
   */
  audition(spec, kind = 'streak', opts = {}) {
    if (!this.ready || !spec) return false;
    this._audWant = { spec, kind, opts };
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!this._audTimer && now - (this._audAt || -1e9) >= AUDITION_GAP * 1000) {
      this._auditionNow();
      return true;
    }
    clearTimeout(this._audTimer);
    this._audTimer = setTimeout(() => {
      this._audTimer = 0;
      // Nothing to say if the hand came back to where it started.
      if (this._audSaid !== this._audWant.spec) this._auditionNow();
    }, AUDITION_GAP * 1000);
    // Node holds the process open for a pending timer; a check must not hang.
    this._audTimer?.unref?.();
    return false;
  }

  _auditionNow() {
    const w = this._audWant;
    if (!w) return;
    this._audAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._audSaid = w.spec;
    const t = this.ctx.currentTime;
    for (const e of this._speech) {
      if (!e.audition) continue;
      try {
        e.bus.gain.cancelScheduledValues(t);
        e.bus.gain.setTargetAtTime(0.0001, t, 0.02);
      } catch {}
      e.level = 0;
    }
    this.speak(w.spec, w.kind, { ...w.opts, audition: true });
  }

  /** Drop anything whose stop time has passed, in case `ended` never came. */
  _retireSpeech() {
    const now = this.ctx.currentTime;
    for (let i = this._speech.length - 1; i >= 0; i--) {
      if (this._speech[i].endsAt + 0.5 >= now) continue;
      try { this._speech[i].bus.disconnect(); } catch {}
      this._speech.splice(i, 1);
    }
  }

  /* ── the saber ─────────────────────────────────────────────────────── */

  /** A live, controllable hum. One per active blade. */
  createHum(color = 0x57c9ff) {
    if (!this.ready) return { set() {}, ignite() {}, retract() {}, move() {}, dispose() {} };
    const ctx = this.ctx;
    // `this` inside the returned api is the api, not the engine. The hum has to
    // be able to read the engine's live time scale on every frame it is set.
    const eng = this;
    const base = 92;
    const oscs = [], gains = [];
    const bus = ctx.createGain(); bus.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55;

    const panner = this._panner(new THREE.Vector3(), 3, 90);
    lp.connect(hp); hp.connect(panner); panner.connect(this.sfxBus);

    for (const [mult, type, lvl, det] of [[1, 'sawtooth', 0.30, -6], [1.005, 'sawtooth', 0.24, 7],
                                          [0.5, 'sine', 0.34, 0], [2.02, 'triangle', 0.10, 12],
                                          [3.01, 'sine', 0.05, -14]]) {
      const o = ctx.createOscillator();
      // Every hum used to be built from identical fixed detunes and an
      // identical noise phase, so ten enemies summed coherently to 10x and beat
      // against each other instead of sounding like ten separate blades.
      o.type = type; o.frequency.value = base * mult; o.detune.value = det + (rng() - 0.5) * 26;
      const g = ctx.createGain(); g.gain.value = lvl;
      o.connect(g); g.connect(bus);
      o.start();
      oscs.push({ o, mult }); gains.push(g);
    }
    // breath of noise for the crackle
    const ns = ctx.createBufferSource(); ns.buffer = this._pinkBuf; ns.loop = true;
    const nsF = ctx.createBiquadFilter(); nsF.type = 'bandpass'; nsF.frequency.value = 900; nsF.Q.value = 0.8;
    const nsG = ctx.createGain(); nsG.gain.value = 0.10;
    ns.playbackRate.value = 0.92 + rng() * 0.16;
    ns.connect(nsF); nsF.connect(nsG); nsG.connect(bus);
    ns.start(0, rng() * this._pinkBuf.duration);

    // slow wobble, the instability of a plasma blade
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 4.3;
    const lfoG = ctx.createGain(); lfoG.gain.value = 3.4;
    lfo.connect(lfoG);
    for (const { o } of oscs) lfoG.connect(o.detune);
    lfo.start();

    bus.connect(lp);

    let lit = false;
    const api = {
      ignite() {
        lit = true;
        const t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(0.0001, t);
        bus.gain.linearRampToValueAtTime(0.20, t + 0.09);
        bus.gain.linearRampToValueAtTime(0.085, t + 0.34);
        for (const { o, mult } of oscs) {
          o.frequency.cancelScheduledValues(t);
          o.frequency.setValueAtTime(base * mult * 0.35, t);
          o.frequency.exponentialRampToValueAtTime(base * mult, t + 0.3);
        }
      },
      retract() {
        lit = false;
        const t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setTargetAtTime(0.0001, t, 0.09);
        for (const { o, mult } of oscs) {
          o.frequency.cancelScheduledValues(t);
          o.frequency.setTargetAtTime(base * mult * 0.4, t, 0.1);
        }
      },
      /** speed: blade tip speed m/s; strain: contact pressure 0..1 */
      set(speed, strain = 0) {
        if (!lit) return;
        const t = ctx.currentTime;
        const s = clamp(speed / 26, 0, 1.6);
        // The blade drops with the world too. It is the loudest continuous
        // sound in the game and the one the player is holding, so a slow motion
        // it did not answer would be the tell that the effect is a filter.
        const pitch = (1 + s * 0.42 + strain * 0.25) * (eng._timePitch || 1);
        for (const { o, mult } of oscs) o.frequency.setTargetAtTime(base * mult * pitch, t, 0.05);
        // The oscillator gains already sum to ~1.03; a bus gain over 1 here put
        // a single hum at full scale and made the compressor duck everything
        // else in the game by ~12dB every time the blade moved.
        bus.gain.setTargetAtTime(0.075 + s * 0.115 + strain * 0.10, t, 0.045);
        lp.frequency.setTargetAtTime(1400 + s * 3400 + strain * 2600, t, 0.05);
        nsG.gain.setTargetAtTime(0.08 + s * 0.16 + strain * 0.42, t, 0.05);
        lfoG.gain.setTargetAtTime(3.2 + strain * 26, t, 0.05);
      },
      move(pos) {
        if (panner.positionX) {
          const t = ctx.currentTime;
          panner.positionX.setTargetAtTime(pos.x, t, 0.02);
          panner.positionY.setTargetAtTime(pos.y, t, 0.02);
          panner.positionZ.setTargetAtTime(pos.z, t, 0.02);
        } else panner.setPosition(pos.x, pos.y, pos.z);
      },
      dispose() {
        // Disconnect BEFORE stopping, and guard every step separately. As one
        // try block, a single throwing o.stop() skipped every disconnect below
        // it and left a hum audible for the rest of the session.
        for (const n of [panner, hp, lp, bus, nsG, nsF, lfoG, ...gains]) {
          try { n.disconnect(); } catch {}
        }
        for (const { o } of oscs) { try { o.stop(); } catch {} }
        try { ns.stop(); } catch {}
        try { lfo.stop(); } catch {}
      },
    };
    return api;
  }

  /* ── one-shots ─────────────────────────────────────────────────────────
   * Every one of these declares what it is worth. The rule that decides the
   * band is simply: would the player notice its absence? A clash, a deflection
   * and a menu blip are the game answering an input, so they are `critical` and
   * may take the last free voice in the engine. Blaster fire and bolt impacts
   * are combat, and hold their own band above the room. Swings, thuds and stray
   * layers are `world`. Footsteps are `chatter` — texture, and the only sound
   * numerous enough to have starved everything else.
   */

  swing(speed, pos) {
    const s = clamp(speed / 30, 0, 1.4);
    this.noise({ dur: 0.16 + s * 0.13, gain: 0.05 + s * 0.30, type: 'bandpass',
      freq: 420 + s * 1500, freqEnd: 180 + s * 420, q: 1.5, pos, pink: true, prio: PRIO.world });
  }

  clash(pos, power = 1) {
    const P = PRIO.critical;
    this.noise({ dur: 0.28, gain: 0.34 * power, type: 'bandpass', freq: 3200, freqEnd: 700, q: 0.7, pos, prio: P });
    this.tone({ freq: 1900 + rng() * 700, freqEnd: 420, dur: 0.24, gain: 0.20 * power, type: 'sawtooth', pos, prio: P });
    this.tone({ freq: 160, freqEnd: 70, dur: 0.3, gain: 0.24 * power, type: 'sine', pos, prio: P });
    /**
     * AND THE MUSIC GETS OUT OF THE WAY. Blade on blade is the one sound this
     * game exists for, and the score used to sit on top of every one of them at
     * constant gain. `_duck` only ever goes deeper and is rate limited, so a
     * six-clash exchange is one hole in the music and not six.
     */
    const [level, hold] = MUSIC_DUCK.clash;
    this._duck(level, hold * clamp(num(power, 1), 0.4, 2));
  }

  deflect(pos, grade = 1) {
    const P = PRIO.critical;
    this.noise({ dur: 0.13, gain: 0.22, type: 'bandpass', freq: 2600, freqEnd: 1100, q: 1.6, pos, prio: P });
    this.tone({ freq: 780 + grade * 480, freqEnd: 2400 + grade * 900, dur: 0.13, gain: 0.14 + grade * 0.07,
      type: 'square', pos, filter: { type: 'lowpass', freq: 4200 }, prio: P });
    if (grade >= 2) this.tone({ freq: 2600, freqEnd: 5200, dur: 0.22, gain: 0.12, type: 'sine', pos, prio: P });
  }

  cut(pos, heavy = false) {
    this.noise({ dur: heavy ? 0.42 : 0.24, gain: heavy ? 0.34 : 0.22, type: 'bandpass',
      freq: 2400, freqEnd: 300, q: 0.9, pos, prio: PRIO.combat });
    this.tone({ freq: 220, freqEnd: 60, dur: 0.26, gain: 0.16, type: 'sawtooth', pos, prio: PRIO.combat });
  }

  /**
   * A LIMB COMES OFF — and until this existed it sounded like a graze.
   *
   * `Enemy._onSever` played `audio.cut(point, this.A.big)` and a contact that
   * took nothing played `audio.cut(ev.point, false)`. On the 22 of 31 bodies
   * whose `A.big` is falsy those are the SAME CALL: same two layers, same
   * 0.380 of delivered gain, measured through the shipped engine. The mechanic
   * this game is named for had no sound of its own.
   *
   * `cut` FIRST and then this over it, so a severance is a graze plus
   * something — which is what it is, physically and dramatically. Three layers
   * the graze has none of:
   *
   *   · the PART. A tone that falls away and keeps falling, because what makes
   *     a dismemberment read is that something left;
   *   · the SEPARATION — a short, wide, dry noise burst, no resonance. A limb
   *     parting is not a ring, it is a tearing;
   *   · a SUB, only for a `big` body, because a Rancor's arm hitting the
   *     ground is felt and a B1's is not.
   *
   * `critical`, not `combat`: a full pool refusing the one event the whole
   * mechanic exists for is exactly the failure `audio.mjs` was written after.
   */
  sever(pos, big = false) {
    const P = PRIO.critical;
    this.cut(pos, big);
    this.noise({ dur: 0.11, gain: 0.30, type: 'highpass', freq: 1800, q: 0.5, pos, prio: P });
    this.tone({ freq: big ? 300 : 460, freqEnd: big ? 44 : 70, dur: big ? 0.62 : 0.44,
      gain: 0.24, type: 'triangle', pos, prio: P });
    if (big) this.tone({ freq: 70, freqEnd: 30, dur: 0.5, gain: 0.26, type: 'sine', pos, prio: P });
  }

  /**
   * HOW A FOUR-AND-A-HALF-SECOND CONTEST OF STRENGTH ENDS.
   *
   * `Duel.js` ended one with `audio.ui('good')` / `ui('bad')` — the exact
   * 620→1240 Hz ping the skill tree plays when you buy an upgrade,
   * non-positional, 0.140/0.180 of gain, against the lock's own OPENING at
   * 0.940 positional. `death()` and `victory()` both exist because the same
   * substitution was made twice before and both of their docstrings say so;
   * this was the third instance.
   *
   * Positional, because a blade lock happens at a place — the point where the
   * two blades are crossed — and it is the one moment in the game where the
   * player and the thing they are fighting are in physical contact.
   *
   * WON: the bind lets go. A rising third under a scrape that releases, and a
   * body-weight thump as the beaten guard is driven off.
   * LOST: the same materials falling. No triad, no resolution: a descending
   * scrape into a low hit, which is the player being pushed onto their heels.
   */
  lockBroken(pos, won = true) {
    const P = PRIO.critical;
    if (won) {
      this.noise({ dur: 0.34, gain: 0.30, type: 'bandpass', freq: 1400, freqEnd: 4200, q: 1.2, pos, prio: P });
      this.tone({ freq: 330, freqEnd: 495, dur: 0.30, gain: 0.20, type: 'triangle', pos, prio: P });
      this.tone({ freq: 120, freqEnd: 60, dur: 0.36, gain: 0.26, type: 'sine', pos, prio: P });
    } else {
      this.noise({ dur: 0.40, gain: 0.30, type: 'bandpass', freq: 3000, freqEnd: 500, q: 1.0, pos, prio: P });
      this.tone({ freq: 260, freqEnd: 98, dur: 0.42, gain: 0.22, type: 'sawtooth', pos, prio: P });
      this.tone({ freq: 96, freqEnd: 40, dur: 0.5, gain: 0.28, type: 'sine', pos, prio: P });
    }
  }

  /**
   * WHAT A BLADE EXCHANGE ACTUALLY DID — the four outcomes that had no sound.
   *
   * `World._applyClash` plays `clash(point, power)` and THEN branches six ways.
   * Two of the six add something (a chamber adds `deflect`, a lock adds its own
   * opening) and four add nothing at all. Measured as delivered gain sums:
   * clash 0.780, +chamber 1.470, +lock 0.940, and PARRY, LOST CLASH, GUARD
   * BROKEN and UNBLOCKABLE all 0.780 — byte-identical. The HUD prints four
   * different words in four different colours and the ears get one waveform,
   * on the four outcomes a player most needs to tell apart in the dark.
   *
   * Each is the same physical event — two blades meeting — so each is a LAYER
   * OVER the clash rather than a replacement for it, and each says the one
   * thing the player has to know:
   *
   *   parry        you won it. Bright, short, rising — and it is the only one
   *                of the four that goes up, because it is the only one that
   *                opens a riposte.
   *   lost         you did not. The same event dulled and dropped: the blade
   *                was moved rather than the enemy's.
   *   guardBroken  something got through. A hard low crack with the mid
   *                scooped out, so it does not read as a heavier parry.
   *   unblockable  the blade was never the answer. A dead, wide, unpitched
   *                thud — nothing rings, because nothing was blocked.
   *
   * And the chain ENDS IN A FALLBACK, for the reason `force` now does.
   */
  clashOutcome(pos, kind = 'parry', power = 1) {
    const P = PRIO.critical, g = clamp(num(power, 1), 0.5, 1.6);
    if (kind === 'parry') {
      this.tone({ freq: 1600, freqEnd: 3200, dur: 0.16, gain: 0.16 * g, type: 'square', pos,
        filter: { type: 'lowpass', freq: 6000 }, prio: P });
      this.noise({ dur: 0.13, gain: 0.16 * g, type: 'highpass', freq: 3400, pos, prio: P });
    } else if (kind === 'lost') {
      this.tone({ freq: 900, freqEnd: 320, dur: 0.22, gain: 0.16 * g, type: 'triangle', pos, prio: P });
      this.noise({ dur: 0.20, gain: 0.14 * g, type: 'bandpass', freq: 900, freqEnd: 260, q: 1.4, pos, prio: P });
    } else if (kind === 'guardBroken') {
      this.tone({ freq: 210, freqEnd: 62, dur: 0.30, gain: 0.30 * g, type: 'sawtooth', pos,
        filter: { type: 'lowpass', freq: 1400, q: 4 }, prio: P });
      this.noise({ dur: 0.24, gain: 0.24 * g, type: 'lowpass', freq: 520, freqEnd: 120, q: 0.7, pos, pink: true, prio: P });
    } else if (kind === 'unblockable') {
      this.noise({ dur: 0.34, gain: 0.32 * g, type: 'lowpass', freq: 900, freqEnd: 90, q: 0.5, pos, pink: true, prio: P });
      this.tone({ freq: 58, freqEnd: 30, dur: 0.36, gain: 0.30 * g, type: 'sine', pos, prio: P });
    } else {
      this.noise({ dur: 0.18, gain: 0.18 * g, type: 'bandpass', freq: 1200, freqEnd: 500, q: 1.0, pos, prio: P });
      this.tone({ freq: 520, freqEnd: 260, dur: 0.18, gain: 0.14 * g, type: 'triangle', pos, prio: P });
    }
  }

  blaster(pos, big = false) {
    const f = big ? 1500 : 2600, P = PRIO.combat;
    this.tone({ freq: f, freqEnd: f * 0.16, dur: big ? 0.24 : 0.14, gain: big ? 0.3 : 0.20,
      type: 'sawtooth', pos, filter: { type: 'lowpass', freq: 5200, q: 3 }, prio: P });
    this.noise({ dur: 0.09, gain: 0.12, type: 'highpass', freq: 2400, pos, prio: P });
  }

  boltHit(pos) {
    const P = PRIO.combat;
    this.noise({ dur: 0.16, gain: 0.2, type: 'bandpass', freq: 1400, freqEnd: 260, q: 0.9, pos, prio: P });
    this.tone({ freq: 130, freqEnd: 52, dur: 0.18, gain: 0.2, type: 'sine', pos, prio: P });
  }

  explosion(pos, size = 1) {
    const P = PRIO.critical;
    this.noise({ dur: 0.9 * size, gain: 0.5, type: 'lowpass', freq: 1800, freqEnd: 120, q: 0.6, pos, pink: true, prio: P });
    this.tone({ freq: 90, freqEnd: 28, dur: 0.85 * size, gain: 0.45, type: 'sine', pos, prio: P });
    this.tone({ freq: 220, freqEnd: 60, dur: 0.4 * size, gain: 0.22, type: 'triangle', pos, prio: P });
    /**
     * The loudest thing the game can make, and only if it was close enough to
     * be one. `_reach` would say yes out to 190 m for a 0.5 detonation, which is
     * the right answer for "is it worth a voice" and the wrong one for "should
     * the music stop": a mine going off across the Colosseum must not punch a
     * hole in the score for a flash the player can barely hear. 45 m is the
     * distance at which the inverse law has already taken it to a fifth.
     */
    const d = pos && Number.isFinite(pos.x) ? this._listenerPos.distanceTo(pos) : 0;
    if (d < 45) {
      const [level, hold] = MUSIC_DUCK.explosion;
      this._duck(level, hold * clamp(num(size, 1), 0.5, 2));
    }
  }

  force(pos, kind = 'push') {
    const P = PRIO.critical;
    if (kind === 'push') {
      this.noise({ dur: 0.55, gain: 0.34, type: 'lowpass', freq: 900, freqEnd: 130, q: 0.7, pos, pink: true, prio: P });
      this.tone({ freq: 74, freqEnd: 34, dur: 0.6, gain: 0.34, type: 'sine', pos, prio: P });
    } else if (kind === 'pull') {
      this.noise({ dur: 0.5, gain: 0.24, type: 'bandpass', freq: 180, freqEnd: 1400, q: 1.1, pos, pink: true, prio: P });
      this.tone({ freq: 60, freqEnd: 190, dur: 0.5, gain: 0.24, type: 'sine', pos, prio: P });
    } else if (kind === 'jump') {
      this.noise({ dur: 0.4, gain: 0.22, type: 'bandpass', freq: 300, freqEnd: 1800, q: 1.4, pos, pink: true, prio: P });
    } else if (kind === 'sense') {
      this.tone({ freq: 1400, freqEnd: 200, dur: 1.1, gain: 0.16, type: 'sine', prio: P });
      this.tone({ freq: 700, freqEnd: 100, dur: 1.3, gain: 0.12, type: 'triangle', prio: P });
    } else if (kind === 'lightning') {
      this.noise({ dur: 0.6, gain: 0.3, type: 'highpass', freq: 2600, q: 1.0, pos, prio: P });
      this.tone({ freq: 60, freqEnd: 40, dur: 0.6, gain: 0.2, type: 'square', pos, prio: P });
    } else if (kind === 'grip') {
      /**
       * THE CHOKE, WHICH WAS THE ONE POWER IN THE GAME WITH NO SOUND AT ALL.
       *
       * `ENEMY_POWERS.choke` has declared `sound: 'grip'` since it was written
       * and this chain had no branch for it and no fallback, so the cast, the
       * hold and the release were silent — measured through the shipped engine,
       * push / pull / lightning 2 voices each and grip 0. The only one of the
       * five enemy powers with that property, on the power whose whole point is
       * that the player cannot see what has them.
       *
       * A grip is not a shove. It CLOSES: a band-pass that narrows and falls
       * rather than opening out, over a sub that rises — the sound of something
       * tightening, not something arriving. Deliberately the quietest of the
       * five: it is a hold, and it has to sit under the victim's own voice.
       */
      this.noise({ dur: 0.7, gain: 0.20, type: 'bandpass', freq: 900, freqEnd: 220, q: 3.2, pos, pink: true, prio: P });
      this.tone({ freq: 48, freqEnd: 96, dur: 0.75, gain: 0.22, type: 'triangle', pos, prio: P });
    } else {
      /**
       * AND A SIXTH KIND CANNOT GO SILENT THE WAY THE FIFTH DID.
       *
       * This chain used to end at `lightning` with nothing after it, so a power
       * that named a sound this method did not know made no sound and nothing
       * anywhere reported it. That is HANDOFF 2.3's close relative — a missing
       * thing answered with silence instead of an error — except that silence
       * is worse than a plausible default, because a plausible default is at
       * least audible. A generic effort layer is what an unnamed power gets: it
       * is wrong for the power and it is not nothing, and `audio.mjs` asserts
       * that every `sound` any POWERS table declares reaches a branch.
       */
      this.noise({ dur: 0.45, gain: 0.22, type: 'bandpass', freq: 520, freqEnd: 240, q: 1.0, pos, pink: true, prio: P });
      this.tone({ freq: 90, freqEnd: 55, dur: 0.5, gain: 0.20, type: 'sine', pos, prio: P });
    }
  }

  /**
   * A footstep, at the mass that made it.
   *
   * Every foot in the game landed with the same weight: a 1400 kg acklay and a
   * 3 kg training remote both got the trooper's boot on sand, and the only
   * thing that ever varied was the ground. Mass moves three things, and it has
   * to move all three or the result is the same sound played louder — the band
   * DROPS (a heavy foot excites the low end of whatever it lands on), the level
   * RISES, and the contact LENGTHENS. Past `REF_MASS * 2.75` a body also
   * displaces enough ground to be felt rather than heard, which is the
   * `bodyThump` layer below: sub-bass, no band, and a separate voice so it can
   * be refused on its own when the pool is tight.
   *
   * At `REF_MASS` every factor is exactly 1 and this is byte-for-byte the sound
   * it always was, which is what keeps the pool arithmetic in
   * tools/checks/audio.mjs meaning what it says.
   */
  footfall(pos, { surface = 'sand', run = false, mass = REF_MASS } = {}) {
    const cfg = SURFACES[surface] || SURFACE_DEFAULT;
    const m = clamp(num(mass, REF_MASS) / REF_MASS, 0.05, 20);
    const drop = Math.pow(m, -0.26);          // heavier → lower
    const lift = Math.pow(m, 0.28);           // heavier → louder
    const dur = (run ? 0.13 : 0.1) * (1 + (m - 1) * 0.14);
    this.noise({ dur: clamp(dur, 0.05, 0.5), gain: cfg.gain * (run ? 1.5 : 1) * lift, type: 'bandpass',
      freq: cfg.freq * drop, freqEnd: cfg.freq * drop * 0.3, q: cfg.q, pos, prio: PRIO.chatter });
    if (m > 2.75) this.bodyThump(pos, mass);
  }

  step(pos, surface = 'sand', run = false) {
    this.footfall(pos, { surface, run, mass: REF_MASS });
  }

  /** The ground answering something heavy. Felt, not heard. */
  bodyThump(pos, mass = 400) {
    const m = clamp(num(mass, 400) / REF_MASS, 1, 24);
    const f = clamp(96 / Math.pow(m, 0.34), 26, 96);
    this.tone({ freq: f, freqEnd: f * 0.45, dur: 0.16 + m * 0.012, gain: clamp(0.05 * Math.pow(m, 0.42), 0.05, 0.34),
      type: 'sine', pos, prio: PRIO.world });
  }

  /**
   * A servo. Droids move by motor and motors sing under load.
   *
   * `effort` is 0..1 — how hard the thing is working — and it moves the whine
   * UP in pitch and out in duration, because that is what a loaded stepper
   * actually does. A droid standing still still ticks; one charging you shrieks.
   */
  servo(pos, effort = 0.4, size = 1) {
    const e = clamp(num(effort, 0.4), 0, 1);
    const s = clamp(num(size, 1), 0.3, 4);
    const f = (1350 + e * 1500) / s;
    this.tone({ freq: f, freqEnd: f * (0.72 + e * 0.5), dur: 0.09 + e * 0.11, gain: 0.020 + e * 0.030,
      type: 'sawtooth', pos, filter: { type: 'bandpass', freq: f * 1.15, q: 7 }, prio: PRIO.chatter });
    this.noise({ dur: 0.05 + e * 0.05, gain: 0.014 + e * 0.02, type: 'highpass', freq: 3600,
      pos, prio: PRIO.chatter });
  }

  /**
   * Breathing. Anything with lungs has them, and they are the cheapest way to
   * know something alive is behind you.
   *
   * `pitch` scales the airway — a beast's breath is not a man's slowed down,
   * it is the same shape an octave and a half lower with more of it.
   *
   * AND "MORE OF IT" HAS TO BE MORE. The level used to be multiplied by `pitch`
   * along with the frequency, which made the size of the animal an inverse
   * volume control: at Presence's shipped pitches (beast 0.42, trooper 1.15) a
   * 1400 kg acklay idling put 0.0109 on the bus and a 78 kg man in a helmet put
   * 0.0299, so against the 0.004 hearing floor the acklay was audible for 4.6 m
   * and the trooper for 12.3 m. The one body in the game whose breathing is
   * supposed to be the tell that something enormous is behind you was the
   * quietest breather in it, and it only became audible from inside its own
   * 2.5–5 m strike range. `dur` still divides by `p` — a big airway is slower —
   * so the trade the old line was half of (peak down, length up) is kept; the
   * level now goes the OTHER way, by the same reasoning that gives a heavier
   * footfall more gain in footfall(): 0.6 of it is fixed and 0.4 scales with
   * 1/p, which measures 16.6 m for the idling acklay against the trooper's
   * 10.2 m and 51.6 m against 31.6 m at a charge.
   */
  breath(pos, { out = true, effort = 0.3, pitch = 1 } = {}) {
    const e = clamp(num(effort, 0.3), 0, 1);
    const p = clamp(num(pitch, 1), 0.2, 3);
    const f = (out ? 640 : 900) * p;
    this.noise({ dur: (out ? 0.34 : 0.26) * (1 + e * 0.4) / p, gain: (0.026 + e * 0.055) * (0.6 + 0.4 / p),
      type: 'bandpass', freq: f, freqEnd: f * (out ? 0.55 : 1.5), q: 0.85, pos, pink: true,
      attack: out ? 0.05 : 0.09, prio: PRIO.chatter });
  }

  /**
   * A JETPACK, HELD OPEN. Note #33 — "engines that fire and thrust and makes
   * sounds like you know what I mean?"
   *
   * A LOOP AND NOT A RETRIGGER, and that is the whole design problem. Every
   * other voice in this file is an event; a jetpack is a continuous state, and
   * firing a one-shot per frame per trooper is twelve retriggers a frame and a
   * machine-gun instead of a roar. So each body gets ONE voice, keyed on its
   * id, and after that it is only ever told how hard it is working.
   *
   * TWO LAYERS, because a rocket is two sounds: a broadband roar (the
   * combustion) under a narrow whistle (the nozzle). The roar's filter opens
   * with power and the whistle rises with it, which is what makes a climb
   * audibly different from a hover rather than merely louder.
   *
   * @param power 0..1.6 — how hard it is working. 0 releases the voice.
   */
  jet(pos, power, id) {
    if (!this.ctx || this.muted) return;
    const jets = this._jets || (this._jets = new Map());
    let v = jets.get(id);
    if (power <= 0.02) {
      if (v) { try { v.stop(); } catch { /* already gone */ } jets.delete(id); }
      return;
    }
    if (!v) {
      /* A cap, for the same reason every other voice pool in this file has
       * one: a wave of twelve jet troopers is twelve continuous voices and
       * the mixer has a budget. Past it the far ones are silent, which is
       * what distance would have done anyway. */
      if (jets.size >= 6) return;
      v = this._openLoop(pos, PRIO.world);
      if (!v) return;
      jets.set(id, v);
    }
    v.set(pos, Math.min(power, 1.6));
  }

  /**
   * A CONTINUOUS POSITIONAL VOICE — two layers, held open, driven by a number.
   *
   * The only one in this file, and it exists because a jetpack is a STATE and
   * everything else here is an event. Two sources: pink noise through a
   * band-pass for the combustion, and a saw for the nozzle whistle. Both
   * filters and both gains move with `power`, which is what makes a climb
   * sound different from a hover rather than merely louder.
   *
   * The returned handle is the only way to reach it again: `set` retunes it,
   * `stop` releases the voice and the panner together. A caller that drops the
   * handle leaks a voice, which is why `jet()` keys them by body id and
   * releases on zero.
   */
  _openLoop(pos, prio = PRIO.world) {
    if (!this.ready || !this._live()) return null;
    if (!this._voice(prio)) return null;
    let out = null;
    try {
      out = this._panner(pos);
      out.connect(this.sfxBus);
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._pinkBuf; src.loop = true;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'bandpass'; flt.frequency.value = 420; flt.Q.value = 0.9;
      const ng = this.ctx.createGain(); ng.gain.setValueAtTime(0.0001, t);
      src.connect(flt); flt.connect(ng); ng.connect(out);
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = 240;
      const olp = this.ctx.createBiquadFilter();
      olp.type = 'lowpass'; olp.frequency.value = 900;
      const og = this.ctx.createGain(); og.gain.setValueAtTime(0.0001, t);
      osc.connect(olp); olp.connect(og); og.connect(out);
      src.start(t); osc.start(t);
      let dead = false;
      const handle = {
        set: (p, power) => {
          if (dead || !this.ctx) return;
          const now = this.ctx.currentTime;
          if (p && out.positionX) {
            out.positionX.setTargetAtTime(num(p.x, 0), now, 0.03);
            out.positionY.setTargetAtTime(num(p.y, 0), now, 0.03);
            out.positionZ.setTargetAtTime(num(p.z, 0), now, 0.03);
          } else if (p && out.setPosition) {
            out.setPosition(num(p.x, 0), num(p.y, 0), num(p.z, 0));
          }
          const k = clamp(num(power, 0), 0, 1.6);
          ng.gain.setTargetAtTime(0.045 + k * 0.13, now, 0.06);
          og.gain.setTargetAtTime(0.008 + k * 0.028, now, 0.06);
          flt.frequency.setTargetAtTime(340 + k * 720, now, 0.08);
          osc.frequency.setTargetAtTime(190 + k * 260, now, 0.08);
        },
        stop: () => {
          if (dead) return;
          dead = true;
          const now = this.ctx.currentTime;
          ng.gain.setTargetAtTime(0.0001, now, 0.05);
          og.gain.setTargetAtTime(0.0001, now, 0.05);
          try { src.stop(now + 0.3); osc.stop(now + 0.3); } catch { /* already stopped */ }
          setTimeout(() => {
            try { src.disconnect(); osc.disconnect(); out.disconnect(); } catch { /* gone */ }
            this._release();
          }, 400);
        },
      };
      return handle;
    } catch {
      this.stats.threw++;
      this._release();
      if (out) { try { out.disconnect(); } catch { /* gone */ } }
      return null;
    }
  }

  thud(pos, power = 1) {
    this.noise({ dur: 0.2, gain: 0.16 * power, type: 'lowpass', freq: 700, freqEnd: 130, pos, pink: true, prio: PRIO.world });
    this.tone({ freq: 110, freqEnd: 44, dur: 0.22, gain: 0.2 * power, type: 'sine', pos, prio: PRIO.world });
  }

  ui(kind = 'hover') {
    /**
     * A WAVE ARRIVING IS NOT A UI SOUND, and this is where it stopped being one.
     *
     * `World.onWaveStart` calls `audio.ui('wave')` and it is the ONLY caller of
     * that kind anywhere in the project. So this call is not a button being
     * pressed, it is the game announcing that a wave has begun, and it is
     * treated as one: the score goes to combat and the swell fires.
     *
     * THE SECOND HALF OF THIS PARAGRAPH USED TO SAY "every other `ui()` in
     * `src/` is a menu click, a hover or a skill node" AND IT WAS NOT TRUE.
     * `grep -rn "audio.ui(" src/` finds callers in `Duel.js`, `Dojo.js`,
     * `Stratagems.js`, `Player.js` and `main.js` — five files outside `src/ui/`
     * — and one of them, the blade lock's resolution, was a four-and-a-half
     * second physical contest ending on the skill tree's purchase ping. It is
     * `lockBroken` now. The rest are refusals, a lesson advancing and a screen
     * opening, which are UI events happening to be raised from a game file.
     *
     * A claim in a comment that nothing checks is a claim that expires
     * silently, so `audio.mjs` now reads the tree for it: every `audio.ui(`
     * outside `src/ui/` has to be on a named list with a reason, and this
     * paragraph goes red the day a sixth one appears.
     *
     * Listening to the call the game already makes rather than restating the
     * rule that raised it is HANDOFF §2.4. The director owns "when is a wave" and
     * this file never needs to know.
     */
    if (kind === 'wave') {
      if (this.score) { this.score.waveActive = true; this.score.wave++; this.score.dead = false; }
      if (!this.score?.driven) this.score?.setState(this.score.boss ? 'boss' : 'combat');
      this.stinger('wave');
      // …and the 180 → 90 Hz sine is kept UNDER it. It is the sound a player
      // has learned means "wave", and the swell is the thing it was missing.
      this.tone({ freq: 180, freqEnd: 90, dur: 1.0, gain: 0.14, type: 'sine', prio: PRIO.critical });
      return;
    }
    const map = {
      hover: { freq: 900, end: 1200, dur: 0.05, gain: 0.05, type: 'sine' },
      click: { freq: 500, end: 1400, dur: 0.09, gain: 0.09, type: 'triangle' },
      good:  { freq: 620, end: 1240, dur: 0.3, gain: 0.14, type: 'sine' },
      bad:   { freq: 300, end: 90, dur: 0.5, gain: 0.18, type: 'sawtooth' },
    }[kind];
    // The menu is the one place where a dropped sound reads as a broken button.
    if (map) this.tone({ freq: map.freq, freqEnd: map.end, dur: map.dur, gain: map.gain,
      type: map.type, prio: PRIO.critical });
  }

  /* ── the two moments a run has ─────────────────────────────────────── */

  /**
   * YOU DIED, and it used to be `ui('bad')`.
   *
   * The identical 300 → 90 Hz sawtooth blip the menu plays when you click a
   * skill node you cannot afford: 0.5 s, one oscillator, no position, no tail.
   * The most important half-second in a run and the cheapest sound in the game
   * were the same waveform.
   *
   * Four layers, and each one is doing a different job:
   *
   *   · the DROP — 96 Hz falling to 22 over two and a half seconds, which is
   *     under the pitch of anything else in the mix and long enough that it is
   *     still going when the death card lands 2.6 s later;
   *   · the ROOM COLLAPSING — a wide pink band closing from 2.4 kHz to 90 Hz,
   *     which is what makes it read as hearing going rather than as a note;
   *   · the RING — 2.9 kHz sine, quiet, long. The one detail everybody
   *     recognises and nobody can name;
   *   · a HEARTBEAT of two thumps, because the body is the last thing left.
   *
   * Non-positional on purpose: this is not an event in the room, it is what is
   * happening to the listener, and a panner would put your own death somewhere
   * over your left shoulder. `critical`, so a full pool cannot refuse it.
   */
  death() {
    if (!this.ready) return 0;
    /**
     * ONCE PER DEATH, HOWEVER MANY THINGS ASK FOR IT.
     *
     * There was one caller — `Player.die()` — for as long as there was one way
     * to end a run, so nothing here needed to think about overlap. There are
     * two now: a bounded battle that is LOST announces itself through
     * `audio.runWon(false)`, and the first line of `runWon` for a loss is
     * `return this.death()` (deliberately — the losing commander of a meeting
     * has not died and still owes the player a cue). A wipe reaches both, in
     * the same frame, because `Player.die` raises `onPlayerDeath` → `_checkWipe`
     * → `_announceBattle(false)` BEFORE it plays its own cue.
     *
     * Two of these on top of each other is not "louder", it is a different
     * sound: five layers doubled with a frame of offset, the 96 Hz drop
     * summing to +6 dB under a pool that may not refuse a `critical` voice.
     *
     * Guarded on the AUDIO clock and not the wall clock, for the reason `_at`
     * below gives, and for the length of the cue's own longest layer — a
     * second death two seconds after the first is the same death.
     */
    const now = this.ctx.currentTime;
    if (this._deathAt != null && now - this._deathAt < DEATH_CUE) {
      return Math.max(0, DEATH_CUE - (now - this._deathAt));
    }
    this._deathAt = now;
    const P = PRIO.critical;
    this.tone({ freq: 96, freqEnd: 22, dur: 2.5, gain: 0.42, type: 'sine', attack: 0.01, prio: P });
    this.tone({ freq: 143, freqEnd: 33, dur: 2.2, gain: 0.16, type: 'triangle', attack: 0.02, prio: P });
    this.noise({ dur: 2.4, gain: 0.30, type: 'lowpass', freq: 2400, freqEnd: 90, q: 0.6,
      pink: true, attack: 0.02, curve: 3.4, prio: P });
    this.tone({ freq: 2900, freqEnd: 2600, dur: DEATH_CUE, gain: 0.055, type: 'sine', attack: 0.35, prio: P });
    // Two beats at about 46 bpm — the rate a body slows to, not a resting pulse.
    this.tone({ freq: 58, freqEnd: 30, dur: 0.34, gain: 0.30, type: 'sine', attack: 0.006, prio: P });
    // `_at` and not `setTimeout`: the second beat belongs to the first, and a
    // wall-clock timer is throttled to one a minute in a backgrounded tab and
    // detached from a suspended context. Every musical timer in this file's
    // history that used the wall clock has been wrong.
    this._at(this.ctx.currentTime + 1.3, () => {
      this.tone({ freq: 54, freqEnd: 27, dur: 0.4, gain: 0.24, type: 'sine', attack: 0.006, prio: P });
    });
    // AND THE SCORE STOPS. A 49-minute orchestral track carrying on over your
    // corpse is the single loudest thing wrong with the moment.
    this.duckMusic(0.12, 0.9);
    /**
     * …AND WHAT COMES BACK IS NOT THE FIGHT.
     *
     * The four layers above are the BODY dying and they are not touched. This
     * is the SCORE dying, which is a different event and was the missing one.
     *
     * TWO THINGS, AND THEY ARE NOT SIMULTANEOUS. The bed collapses at once —
     * `death`'s layer table has no drums, no ostinato and almost no strings,
     * and the crossfade into it is a 0.22 s cut rather than the usual second —
     * so the moment the player dies the fight stops. The HARMONY failing is a
     * separate gesture and it is DELAYED: the duck above holds the music at
     * 0.12 for nine tenths of a second so the drop, the collapsing room and the
     * heartbeat own the front of it, and a brass note arriving underneath that
     * would be a note nobody can hear. At +1.5 s the music is coming back, and
     * what comes back is a bass falling a tritone with a fifth left hanging
     * over it — which is still going when the death card lands at 2.6 s.
     */
    if (this.score) { this.score.dead = true; this.score.waveActive = false; }
    if (!this.score?.driven) this.score?.setState('death');
    this.stinger('fall', { delay: 1.5 });
    return 2.6;
  }

  /**
   * YOU HELD THE FIELD, and it used to be `ui('good')` — the same 620 → 1240 Hz
   * ping the menu plays when you buy an upgrade.
   *
   * A rising triad rather than a rising interval, arpeggiated over 160 ms so it
   * arrives as a phrase, with a low swell under it that is the room letting go.
   * Non-positional and `critical` for the same reasons death() is.
   */
  victory() {
    if (!this.ready) return 0;
    const P = PRIO.critical;
    const t0 = this.ctx.currentTime;
    // A, C#, E, A — the same chord the drone bed is built on a fifth up, so it
    // resolves the room rather than arriving beside it.
    const chord = [220, 277.2, 330, 440];
    for (let i = 0; i < chord.length; i++) {
      const f = chord[i];
      // Scheduled by hand rather than with setTimeout: a timer is wall-clock,
      // and everything else in this file that has ever used one for musical
      // timing has been wrong under a hitstop or a background tab.
      this._at(t0 + i * 0.055, () => this.tone({ freq: f, freqEnd: f * 1.001, dur: 1.1 - i * 0.1,
        gain: 0.12, type: 'triangle', attack: 0.012, prio: P }));
    }
    this.tone({ freq: 110, freqEnd: 220, dur: 1.4, gain: 0.16, type: 'sine', attack: 0.09, prio: P });
    this.noise({ dur: 0.9, gain: 0.07, type: 'bandpass', freq: 5200, freqEnd: 9000, q: 0.8,
      attack: 0.02, prio: P });
    /**
     * …AND THE SCORE PUTS THE WAVE DOWN.
     *
     * `World.onWaveClear` is the only caller of this, so it is the wave-clear
     * signal and not a generic "something good happened" — see `ui('wave')` for
     * the same argument on the other end of the wave. The bII and the drums
     * leave, the cadence lands under the triad above (bVII → i, in the same A
     * the triad resolves to, because there has only ever been one key), and a
     * boss latch is released: whatever it was, it is over.
     */
    if (this.score) { this.score.waveActive = false; this.score.boss = false; }
    if (!this.score?.driven) this.score?.setState('explore');
    this.stinger('clear');
    return 1.4;
  }

  /**
   * THE RUN IS WON — and until now it made no sound at all.
   *
   * Command mode can be finished: `World._endMeeting` and `Command`'s last
   * advance both end in `onGameOver({ won: true })`, `main.js` prints a
   * different card for it, and the one completable thing in this game was
   * delivered in silence. `victory()` is NOT that moment — it is a wave being
   * cleared, of which there are forty in a run — so this is its own gesture and
   * its own state: the only full fanfare in the game and the only place the
   * score is ever allowed a major third for more than a bar.
   *
   * NOTHING CALLS THIS YET. It is the seam, and the call it wants is one line
   * at the top of `World._endMeeting`, beside the notify that is already there:
   *
   *     audio.runWon(winner === mine);
   *
   * — with `false` for the losing commander, who gets the death cue instead,
   * because the same match is a victory on one screen and a defeat on the other.
   */
  runWon(won = true) {
    if (!this.ready) return 0;
    if (!won) return this.death();
    if (this.score) { this.score.won = true; this.score.waveActive = false; this.score.boss = false; }
    if (!this.score?.driven) this.score?.setState('victory');
    return this.stinger('triumph') || 3.4;
  }

  /**
   * Run `fn` at an AUDIO-clock time. A one-node silent oscillator is the only
   * thing in WebAudio that can raise a callback on that clock; a `setTimeout`
   * runs on the wall clock, which a suspended context and a backgrounded tab
   * both detach from the sound the callback is supposed to be part of.
   */
  _at(when, fn) {
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.master);
      o.onended = () => { try { g.disconnect(); } catch {} fn(); };
      o.start(this.ctx.currentTime);
      o.stop(Math.max(when, this.ctx.currentTime + 0.001));
    } catch { fn(); }
  }

  /**
   * Pull the score down to `level` and leave it there for `seconds`, then bring
   * it back to whatever the slider says.
   *
   * Separate from `setMusicVolume` on purpose: this must not move the player's
   * setting, and a player at Music 0 must not have it turned on for them.
   */
  duckMusic(level = 0.2, seconds = 1.2) {
    return this._duck(level, seconds, { fall: 0.18, rise: 0.9 });
  }

  /**
   * SIDECHAIN — the music getting out of the way, for a moment.
   *
   * Nothing in this game ducked anything before a clash or a death cry: the
   * score sat at constant gain through every one of them, which is why the mix
   * had no room in it. This is the mechanism, and everything about it is about
   * what happens when it is asked TWICE.
   *
   *   IT ONLY EVER GOES DEEPER. A clash storm is six calls in half a second and
   *     a naive one would re-schedule the release six times, so the music would
   *     pump up between hits and read as a broken gate. A duck that is already
   *     deeper, and still has longer to run, is left alone; a deeper one takes
   *     over. `_musicDuckAt` is what was commanded, on the audio clock, for the
   *     same reason `duckLevel()` exists: an AudioParam under a scheduled ramp
   *     reports where it WAS, not where it is going.
   *
   *   IT IS RATE LIMITED. Two automations 20 ms apart are one automation with
   *     extra steps. `DUCK_MIN_GAP` is under the shortest gesture the game can
   *     produce and above the frame time, so a clash and the cut that follows
   *     it are one duck.
   *
   * `musicDuck.gain` and not `musicBus.gain`: the bus is the player's slider,
   * and a duck that wrote it would undo a slider moved while it was running.
   */
  _duck(level, seconds, { fall = 0.09, rise = 0.35 } = {}) {
    if (!this.ready || !this.musicDuck || !(this.musicVolume > 0)) return false;
    const t = this.ctx.currentTime;
    const l = clamp(num(level, 0.2), 0, 1);
    const d = clamp(num(seconds, 1.2), 0.05, 30);
    if (t - (this._musicDuckSet || -1e9) < DUCK_MIN_GAP && l >= (this._musicDuckAt ?? 1)) return false;
    if (t < (this._musicDuckUntil || 0) && l >= (this._musicDuckAt ?? 1) && t + d <= this._musicDuckUntil) return false;
    try {
      this.musicDuck.gain.cancelScheduledValues(t);
      this.musicDuck.gain.setTargetAtTime(Math.max(0.0001, l), t, fall);
      this.musicDuck.gain.setTargetAtTime(1, t + d, rise);
    } catch { return false; }
    this._musicDuckSet = t;
    this._musicDuckAt = l;
    this._musicDuckUntil = t + d;
    this.stats.musicDucked = (this.stats.musicDucked || 0) + 1;
    return true;
  }

  /**
   * How far the music is being HELD down right now, as a number, for the same
   * reason `duckLevel()` exists — a param under a ramp cannot be read back.
   */
  musicDuckLevel() {
    if (!this.ctx) return 1;
    return this.ctx.currentTime < (this._musicDuckUntil || 0) ? (this._musicDuckAt ?? 1) : 1;
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  THE SCORE — what it should be playing                                 */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * TELL THE SCORE WHAT THE GAME IS DOING. **This is the seam.**
   *
   * `src/engine/Score.js` is a state machine — explore, combat, boss, victory,
   * death — and the facts it needs are all in `world.director`: the wave
   * number, whether the wave is running, whether this one is a boss, whether
   * the run is over. None of that reaches this file today, so the score DERIVES
   * what it can from the calls the game already makes (see `ui('wave')`,
   * `victory()`, `death()` and `speak()`, each of which is the game's own
   * announcement of the event and not a second copy of the rule that raised
   * it), plus the smoothed combat intensity `updateScore` already receives.
   *
   * That derivation is honest but it is thinner than the truth: it cannot tell
   * a boss wave from an ordinary one until something announces the boss, and it
   * cannot know a campaign has been WON at all, because nothing in the game
   * makes a sound when it is.
   *
   * So this exists, and it takes either of two things:
   *
   *   FACTS — `{ active, boss, wave, dead, won }`. These are what the director
   *     knows and the engine cannot work out, and they are all `Score._derive`
   *     was missing. Passing them leaves the derivation running, which is what
   *     you want: the facts settle explore/combat/boss/death/victory exactly,
   *     and the smoothed combat intensity still covers the modes that have no
   *     director at all (training, the dojo, a sandbox). This is the call
   *     `World` should make, at the two director callbacks it already has:
   *
   *         this.director.onWaveStart = (w, n) => {
   *           …
   *           audio.setMusicState({ wave: w, active: true,
   *             boss: this.director.isBossWave(this.director.wave) });
   *         };
   *         this.director.onWaveClear = (w) => {
   *           …
   *           audio.setMusicState({ active: false, boss: false });
   *         };
   *
   *   A STATE — `{ state: 'boss' }`. This is the caller saying it knows better
   *     than any derivation, so `driven` latches and the per-frame derivation
   *     stops for good. One authority, never two disagreeing (HANDOFF §2.3).
   *
   * Stingers keep firing from their existing call sites either way, because
   * those are events with exactly one source each and there is nothing for them
   * to disagree with.
   */
  setMusicState(s = {}) {
    if (!this.score) return null;
    const sc = this.score;
    if (typeof s.state === 'string') sc.driven = true;
    if (Number.isFinite(s.wave)) sc.wave = s.wave;
    if (s.boss !== undefined) sc.boss = !!s.boss;
    if (s.dead !== undefined) sc.dead = !!s.dead;
    if (s.won !== undefined) sc.won = !!s.won;
    if (s.active !== undefined) sc.waveActive = !!s.active;
    const was = sc._want;
    if (typeof s.state === 'string') sc.setState(s.state);
    else sc.setState(sc._derive(0));
    // ENTERING the boss state is the boss entrance, and this is the only place
    // that knows it happened — the state can be reached by a fact (`boss:true`),
    // by a name (`state:'boss'`) or by a latch that was already set, and one
    // gesture at the transition covers all three without any caller having to
    // remember to fire it. Nothing else in the game can raise it: see
    // `_scoreFromLine` for the signal that looked like it could and could not.
    if (sc._want === 'boss' && was !== 'boss') this.stinger('boss');
    return sc._want;
  }

  /** What the score is playing, for a HUD, a check, or a caller deciding. */
  musicState() { return this.score ? this.score.state : 'off'; }

  /**
   * FIRE A STINGER — one musical gesture, on one event.
   *
   * Rate limited PER KIND rather than globally, because the two things that
   * need limiting need different limits and everything else needs none: a kill
   * accent is one of six inside a single frame during a Force rend, a boss
   * entrance happens once, and a victory must never be refused for being close
   * to anything.
   *
   * The BED ducks under the big ones — a fanfare in the same key on the same
   * instruments as the pad under it arrives as the pad getting thicker — and it
   * is the bed specifically and NOT the whole music path, because a stinger
   * plays through that path too and would duck itself to no effect. See
   * `Score.duckBed`.
   */
  stinger(kind, opts = {}) {
    if (!this.ready || !this.score) return 0;
    const gap = STINGER_GAP[kind];
    const t = this.ctx.currentTime;
    if (gap) {
      const key = `_st_${kind}`;
      if (t - (this[key] || -1e9) < gap) return 0;
      this[key] = t;
    }
    const dur = this.score.stinger(kind, opts);
    const d = STINGER_DUCK[kind];
    if (d && dur > 0) this.score.duckBed(d, num(opts.delay, 0) + dur * 0.8);
    return dur;
  }

  /* ── ambience & score ──────────────────────────────────────────────── */

  _startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._pinkBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.35;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(f); f.connect(g); g.connect(this.ambBus);
    src.start();
    this.windGain = g; this.windFilter = f;

    // Drone bed: a slow-breathing minor cluster that swells with the fight.
    this.droneOsc = [];
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    // droneGain -> lp -> ambBus. This used to connect droneGain to BOTH the bus
    // and the filter, so the filter was an orphan and the drone was unfiltered.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    this.droneGain.connect(lp);
    lp.connect(this.ambBus);
    for (const f2 of [55, 82.4, 110, 164.8, 220]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f2;
      const og = ctx.createGain(); og.gain.value = 0.16 / (1 + f2 / 110);
      const lfo = ctx.createOscillator(); lfo.type = 'sine';
      lfo.frequency.value = 0.06 + rng() * 0.09;
      const lg = ctx.createGain(); lg.gain.value = og.gain.value * 0.7;
      lfo.connect(lg); lg.connect(og.gain); lfo.start();
      o.connect(og); og.connect(this.droneGain); o.start();
      this.droneOsc.push(o);
    }
    this._pulseTimer = 0;
    this.intensity = 0;
    // What the level asked for, and what is currently commanded. _bed() moves
    // the second relative to the first every frame; without the pair it would
    // have to read the params back, and a param under a scheduled ramp reports
    // where it WAS when the ramp was set, not where it is going.
    this._bedWind = 0; this._bedWindFreq = 420; this._bedDrone = 0;
    this._windAt = 0; this._windFreqAt = 420; this._droneAt = 0;
  }

  /**
   * WHICH ROOM THE GAME IS IN, and the first time this file has had more than
   * one.
   *
   * `init()` built one convolver from `_makeImpulse(2.4, 2.6)` behind a send of
   * 0.16, and nothing in the project wrote `reverbSend` ever again. Every level
   * — a stone bowl, an open dune sea, a sealed foundry, a rain-lashed platform
   * over an ocean — was played through the same 2.4-second tail at the same
   * level. `_makeImpulse` has taken both parameters since it was written; it
   * had one caller and one pair of arguments.
   *
   * Three numbers, and all three have to move together or a level sounds like a
   * setting rather than a place:
   *
   *   `seconds` is how long the tail is — the path length of the room;
   *   `decay`   is how fast it dies inside that time — the absorption;
   *   `send`    is how much of the dry signal ever reaches it — how enclosed.
   *
   * A tail is a BUFFER, so changing it means building one — 2 channels of
   * `rate × seconds` floats, about 320 kB at the longest room, on a level load
   * and never on a frame. `_roomAt` is what stops a re-entered level paying for
   * it twice, and the send is ramped rather than set, because a convolver whose
   * input jumps clicks the same way an oscillator does.
   */
  setRoom({ seconds = 2.4, decay = 2.6, send = 0.16 } = {}) {
    if (!this.ready || !this.reverb) return null;
    const s = clamp(num(seconds, 2.4), 0.15, 6);
    const d = clamp(num(decay, 2.6), 0.5, 8);
    const g = clamp(num(send, 0.16), 0, 0.6);
    const t = this.ctx.currentTime;
    // The impulse is what costs; the send is free. A level that only wants to
    // be louder into the same room must not rebuild a 320 kB buffer for it.
    const key = `${s.toFixed(3)}/${d.toFixed(3)}`;
    if (key !== this._roomAt) {
      try { this.reverb.buffer = this._makeImpulse(s, d); this._roomAt = key; }
      catch { /* an impulse that will not build leaves the old room in place */ }
    }
    try { this.reverbSend.gain.setTargetAtTime(g, t, 0.5); } catch {}
    this.room = { seconds: s, decay: d, send: g };
    return this.room;
  }

  /** Release every held jetpack voice. Called on unload — see `setAmbience`. */
  stopLoops() {
    if (!this._jets) return;
    for (const v of this._jets.values()) { try { v.stop(); } catch { /* gone */ } }
    this._jets.clear();
  }

  setAmbience({ wind = 0.1, windFreq = 420, drone = 0.1, room = null } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // These come out of level data. A throw here is thrown from World's
    // constructor, which would take the whole level down with it.
    this._bedWind = num(wind, 0.1);
    this._bedWindFreq = num(windFreq, 420);
    this._bedDrone = num(drone, 0.1);
    this._windAt = this._bedWind; this._windFreqAt = this._bedWindFreq; this._droneAt = this._bedDrone;
    this.windGain.gain.setTargetAtTime(this._bedWind, t, 1.2);
    this.windFilter.frequency.setTargetAtTime(this._bedWindFreq, t, 1.2);
    this.droneGain.gain.setTargetAtTime(this._bedDrone, t, 2.0);
    // The room travels with the bed because they are the same fact about a
    // level, arriving through the one call that already carries it.
    if (room) this.setRoom(room);
    /**
     * …AND SO DOES THE SCORE'S MEMORY, because this call is the ONLY thing in
     * the project that means "a level began or ended". `World.loadLevel` makes
     * it with the room; `World.unload` makes it with wind and drone at zero, to
     * stop a level's weather playing under the main menu. Both of them are the
     * moment the score has to forget what it latched: a player who quits from
     * the death card and deploys again used to arrive on the next level with
     * the bass still a tritone down, because `death` is a latch and only a new
     * run releases it.
     *
     * The SMOOTHED combat level goes with it, and it has to: `updateScore`
     * lags it by about a second and a half, so a player who quits a nine-body
     * fight and deploys somewhere quiet arrives with `intensity` still over the
     * threshold and hears a wave that is not there for the first second of the
     * new level. A level change is not a fight winding down, it is a different
     * place.
     */
    this.intensity = 0;
    this.score?.reset();
  }

  /**
   * THE ROOM ANSWERS, and this is the half of the score that is actually heard.
   *
   * Two promises used to be written here and kept nowhere. The first is three
   * lines up in _startAmbience — "a slow-breathing minor cluster that swells
   * with the fight" — and `droneGain` was written in exactly one place in the
   * project, setAmbience, from level data at load: measured over ten seconds at
   * full combat intensity it received ZERO automations, so a nine-enemy fight
   * and an empty level sounded identical. The second is the weather: eight of
   * the thirteen levels ship a squall (kamino peak 1.0 for 44 s of every 88,
   * alpine 48 s of every 132), src/world/Scenery.js drives fog, sun, hemi fill
   * and a 2.4× particle wind off `weather.intensity` every frame, and the audio
   * wind sat at the constant it was handed at load for the whole run. A
   * white-out crossed the level in total silence.
   *
   * So both move here, from the one call that already runs every frame with the
   * fight in hand. The drone is ADDITIVE (`base + 0.09 × intensity`) rather
   * than a multiplier, because three levels ship `drone: 0.0` — meadow's
   * daylight is a choice — and 0 × anything stays a choice that can never be
   * answered; +0.09 against beds of 0.03–0.34 is a layer arriving, not the room
   * getting louder. The wind is MULTIPLICATIVE (`base × (1 + 0.8 × storm)`,
   * +5.1 dB at a full squall) because a squall is the same air moving harder,
   * and a level with `wind: 0.03` has nothing for a gale to be made of.
   *
   * Both are re-scheduled only when the target has actually MOVED — the drone
   * by more than 0.004, which is one thirtieth of the swell — because
   * setTargetAtTime at 60 Hz is a ramp that never arrives anywhere. In a real
   * fight that is about twenty automations, not twelve hundred.
   */
  _bed(storm) {
    const t = this.ctx.currentTime;
    const drone = num(this._bedDrone, 0) + DRONE_SWELL * this.intensity;
    if (Math.abs(drone - this._droneAt) > 0.004) {
      this._droneAt = drone;
      this.droneGain.gain.setTargetAtTime(drone, t, 1.4);
    }
    const wind = num(this._bedWind, 0) * (1 + STORM_GAIN * storm);
    if (Math.abs(wind - this._windAt) > 0.004) {
      this._windAt = wind;
      this.windGain.gain.setTargetAtTime(wind, t, 0.8);
    }
    // …and a gale is brighter than a breeze: the bandpass opens with it, which
    // is the difference between more wind and louder wind.
    const freq = num(this._bedWindFreq, 420) * (1 + STORM_BRIGHT * storm);
    if (Math.abs(freq - this._windFreqAt) > 6) {
      this._windFreqAt = freq;
      this.windFilter.frequency.setTargetAtTime(freq, t, 0.8);
    }
  }

  /**
   * The bed under everything, and the fight the score is answering.
   *
   * WHAT USED TO BE HERE was the whole of this game's "adaptive music": one
   * sine oscillator per beat, sweeping 74 → 38 Hz, at 74 + 46 × intensity bpm,
   * straight onto the music bus. No key, no harmony, no layers, no states, no
   * transitions and nothing that changed when a wave arrived or a boss walked
   * on — because a lone sub pulse has nothing to change INTO. It has been
   * replaced by src/engine/Score.js, where that pulse survives as one voice of
   * one layer (`taiko`) of five, and where the tempo is a property of the state
   * the game is in rather than a linear function of how many bodies are near.
   *
   * @param storm 0..1 — `weather.intensity` from src/world/Scenery.js, passed
   *              by World.update. Zero indoors and on the five levels with no
   *              weather block, which is why it defaults to it.
   */
  updateScore(dt, intensity, storm = 0) {
    // The same reason the one-shots refuse a stopped context: a frozen clock
    // stacks every scheduled note on one timestamp and none of them can end.
    if (!this.ready || !this._live()) return;
    dt = num(dt, 1 / 60); intensity = num(intensity, 0);
    this.intensity += (intensity - this.intensity) * Math.min(1, dt * 0.6);
    // BEFORE any early return: the bed has to be able to come back DOWN when
    // the fight ends, and the storm is weather rather than combat — it blows
    // through a level with nothing alive on it.
    this._bed(clamp(num(storm, 0), 0, 1));
    // …and so does the score, for the same reason. It is a state machine with
    // an `explore` state; a score that only ran while something was on the
    // field would have nothing to leave.
    this.score?.update(dt, this.intensity);
  }
}

export const audio = new AudioEngine();
