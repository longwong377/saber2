/**
 * SABER — voices, as numbers.
 *
 * Nothing in this project is a sample and a voice is no exception, so a
 * character's voice is not a folder of takes: it is five numbers — where the
 * larynx sits (`f0`), what the throat above it resonates at (`formants`), how
 * much of the sound is breath rather than tone (`rasp`), how fast the speaker
 * gets through a phrase (`cadence`), and what the glottal source waveform is.
 * Change those five and you have a different person, not the same person with a
 * different label.
 *
 * THE FAILURE THIS FILE IS SHAPED AROUND is four voices that measure identical.
 * It is easy to write five entries in a table, pick between them with a slider,
 * pass every structural check ever written, and ship one voice with five names —
 * because nothing in a source file can tell you what a sound is. So the table
 * below is not the deliverable; the deliverable is that
 * tools/checks/voices.mjs RENDERS every one of these to samples and measures
 * its pitch centre, its spectral centroid and its length, and fails if any two
 * of them land on top of each other.
 *
 * ── the one description, two consumers ──────────────────────────────────
 *
 * `utterance()` returns a GRAIN LIST: a flat description of every shaped burst
 * of sound in the line, with times, frequencies, glides, envelopes and filters
 * on it, and no WebAudio in sight. Two things read it:
 *
 *   1. AudioEngine.speak() builds oscillators, biquads and gains from it, which
 *      is what the player hears.
 *   2. The check renders it to a Float32Array and measures it.
 *
 * That is what stops the measurement drifting away from the thing measured.
 * There is exactly one description of what a voice is, and both the game and
 * the instrument are downstream of it.
 *
 * ── names ───────────────────────────────────────────────────────────────
 *
 * The archetypes are in-world roles, not people. Nobody here is an impression
 * of an actor and none of them is named after one: a voice is a build, in the
 * same sense the crystal and the robe are, and the names say what kind of Jedi
 * (or what kind of fallen one) you sound like.
 */

/** Finite-or-default. Every number below reaches an AudioParam eventually. */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * A VOICE SPEC.
 *
 *   f0         Hz — the pitch centre. The single number that most decides
 *                   "who is that", and the one a listener names first.
 *   wave       the glottal source. 'sawtooth' is a full, chesty buzz;
 *              'square' is hollow and reedy; 'triangle' is soft and thin.
 *   formants   [F1, F2] Hz — the two resonances of the vocal tract. F1 tracks
 *              jaw openness, F2 tracks tongue position; together they are the
 *              colour of the voice, and they move the spectral centroid far
 *              more than the pitch does.
 *   q          [Q1, Q2] — how sharply each formant rings. A high Q is a
 *              precise, placed voice; a low Q is loose and open.
 *   mix        how much of F2 sits under F1. Bright voices carry more.
 *   rasp       0..1 — noise through the upper formant. Breath, grit, age,
 *              strain. It also drags the centroid up, which is why the two
 *              have to be measured together rather than reasoned about.
 *   raspFreq   Hz — where that noise lives.
 *   cadence    a speed multiplier on the whole phrase. 1.4 is clipped and
 *              quick; 0.7 is deliberate, with air between the syllables.
 *   bend       semitone-ish glide within a syllable — flat is dead, too much
 *              is a cartoon.
 *   ring       optional inharmonic partial (× f0). Metal, not throat: this is
 *              what makes a droid a droid rather than a small person.
 *   gain       overall level trim, so a loud archetype does not simply win.
 */

/* ── what the player can sound like ──────────────────────────────────── */

export const PLAYER_VOICES = [
  {
    id: 'negotiator', name: 'The Negotiator',
    blurb: 'Warm, level, unhurried. Sounds like it is still trying to talk you out of it.',
    f0: 116, wave: 'sawtooth', formants: [600, 1080], q: [5.5, 4.6], mix: 0.44,
    rasp: 0.09, raspFreq: 1800, cadence: 1.0, bend: 0.07, gain: 1.0,
  },
  {
    id: 'mask', name: 'The Mask',
    blurb: 'Chest-deep and filtered, every word costing something. Slow on purpose.',
    f0: 88, wave: 'sawtooth', formants: [400, 760], q: [7.5, 5.5], mix: 0.62,
    rasp: 0.26, raspFreq: 780, cadence: 0.80, bend: 0.04, gain: 1.05,
  },
  {
    id: 'count', name: 'The Count',
    blurb: 'Thin, precise, amused. Places every syllable exactly where it wants it.',
    f0: 138, wave: 'square', formants: [720, 1980], q: [9, 4.4], mix: 1.05,
    rasp: 0.06, raspFreq: 2600, cadence: 1.22, bend: 0.10, gain: 0.94,
  },
  {
    id: 'chosen', name: 'The Chosen',
    blurb: 'Young, forward and strained. Always half a beat ahead of itself.',
    f0: 165, wave: 'sawtooth', formants: [800, 2500], q: [4.5, 3.4], mix: 0.72,
    rasp: 0.36, raspFreq: 3000, cadence: 1.45, bend: 0.16, gain: 0.98,
  },
  {
    id: 'sage', name: 'The Sage',
    blurb: 'Small, reedy, ancient. Stops in the middle of things and means to.',
    f0: 208, wave: 'triangle', formants: [500, 2250], q: [3.2, 6.5], mix: 0.85,
    rasp: 0.46, raspFreq: 3900, cadence: 0.72, bend: 0.13, gain: 0.92,
  },
];

/* ── what everything else sounds like ────────────────────────────────── */

/**
 * The other side of the room.
 *
 * Same five numbers, wider spread: a droid's `ring` puts an inharmonic partial
 * over a square source and no throat can do that, a beast's f0 is an octave
 * under any human's, and the walker is barely a voice at all — it is a
 * hydraulic groan with a formant on it.
 */
export const ENEMY_VOICES = {
  droid: {
    id: 'droid', name: 'Battle droid',
    f0: 300, wave: 'square', formants: [1900, 3200], q: [11, 9], mix: 0.8,
    rasp: 0.5, raspFreq: 4200, cadence: 1.9, bend: 0.34, ring: 2.71, gain: 0.8,
  },
  trooper: {
    id: 'trooper', name: 'Clone trooper',
    f0: 128, wave: 'sawtooth', formants: [1050, 2400], q: [8, 7], mix: 0.7,
    rasp: 0.28, raspFreq: 2900, cadence: 1.3, bend: 0.09, gain: 0.85,
  },
  sith: {
    id: 'sith', name: 'Sith acolyte',
    f0: 104, wave: 'sawtooth', formants: [520, 1050], q: [6, 5], mix: 0.6,
    rasp: 0.22, raspFreq: 1500, cadence: 0.95, bend: 0.11, gain: 0.95,
  },
  beast: {
    id: 'beast', name: 'Acklay',
    f0: 58, wave: 'sawtooth', formants: [280, 700], q: [4, 3], mix: 0.8,
    rasp: 0.55, raspFreq: 1100, cadence: 0.52, bend: 0.2, gain: 1.15,
  },
  walker: {
    id: 'walker', name: 'Spider walker',
    f0: 44, wave: 'square', formants: [170, 520], q: [6, 4.5], mix: 0.9,
    rasp: 0.35, raspFreq: 700, cadence: 0.62, bend: 0.05, ring: 1.62, gain: 1.05,
  },
};

/** Every spec in the project, player and enemy, in one list for measuring. */
export const ALL_VOICES = [...PLAYER_VOICES, ...Object.values(ENEMY_VOICES)];

export function voiceAt(index) {
  const i = Math.round(num(index, 0));
  return PLAYER_VOICES[((i % PLAYER_VOICES.length) + PLAYER_VOICES.length) % PLAYER_VOICES.length];
}
export function voiceById(id) { return PLAYER_VOICES.find(v => v.id === id) || PLAYER_VOICES[0]; }

/* ── what a line is made of ──────────────────────────────────────────── */

/**
 * The phrases, as pitch contours.
 *
 * Each entry is a list of syllables, `[pitch × f0, length × base, level]`, plus
 * a level for the whole line. There are no WORDS here on purpose — a
 * synthesised word is uncanny in a way a synthesised effort never is, and a
 * game that says the same four sentences for an hour is worse than one that
 * grunts. What carries the character is the contour and the timbre: a rising
 * three-syllable line reads as a taunt and a falling one reads as a curse,
 * whoever is speaking.
 *
 * The trigger list is the brief: a kill, a deflect streak, a boss arriving, low
 * health — plus the four efforts a body makes on its own.
 */
export const LINES = {
  /* efforts — one syllable, no thinking involved */
  effort: { gain: 0.50, syll: [[1.02, 0.42, 1.0]] },
  hurt:   { gain: 0.85, syll: [[1.22, 0.36, 1.0], [0.92, 0.42, 0.55]] },
  land:   { gain: 0.62, syll: [[0.78, 0.40, 1.0]] },
  die:    { gain: 1.00, syll: [[1.18, 0.55, 1.0], [0.96, 0.70, 0.8], [0.70, 1.15, 0.45]] },
  /* quips — the four triggers the brief names */
  kill:   { gain: 0.72, syll: [[1.05, 0.42, 0.9], [0.90, 0.52, 0.72]] },
  streak: { gain: 0.80, syll: [[0.94, 0.40, 0.8], [1.06, 0.40, 0.9], [1.20, 0.62, 1.0]] },
  boss:   { gain: 0.88, syll: [[0.86, 0.62, 0.85], [0.80, 0.50, 0.7], [0.90, 0.44, 0.8], [0.74, 0.95, 0.9]] },
  low:    { gain: 0.78, syll: [[1.10, 0.50, 0.85], [0.88, 0.80, 1.0]] },
  /* the enemy side */
  alarm:  { gain: 0.85, syll: [[1.10, 0.30, 1.0], [1.28, 0.34, 0.9]] },
  panic:  { gain: 0.90, syll: [[1.24, 0.28, 1.0], [1.34, 0.26, 0.9], [1.12, 0.44, 0.8]] },
  scream: { gain: 1.00, syll: [[1.30, 0.70, 1.0], [1.05, 0.95, 0.6]] },
  chatter:{ gain: 0.55, syll: [[1.00, 0.26, 0.9], [0.90, 0.30, 0.7]] },
};

export const LINE_KINDS = Object.keys(LINES);

/** Seconds one syllable of length 1.0 lasts at cadence 1. */
const SYLL_BASE = 0.30;
/** Silence between syllables, before cadence. */
const SYLL_GAP = 0.055;

/**
 * Build the grain list for one line.
 *
 * `vary` is a 0..1 dither (a stored RNG draw, not Math.random inside a loop) so
 * the same trigger twice in a row is not bit-identical — one number, applied to
 * pitch and length together, because a voice that wanders in pitch but not in
 * time sounds like a machine pretending.
 *
 * @returns {{kind:string, dur:number, grains:Array}}
 */
export function utterance(spec, kind = 'effort', vary = 0.5) {
  const L = LINES[kind] || LINES.effort;
  const v = Math.min(1, Math.max(0, num(vary, 0.5)));
  const drift = 1 + (v - 0.5) * 0.11;              // ±5.5% pitch
  const pace = num(spec.cadence, 1) * (1 + (v - 0.5) * 0.14);
  const grains = [];
  let t = 0;
  for (const [pitch, len, level] of L.syll) {
    const dur = (SYLL_BASE * len) / pace;
    syllable(grains, spec, t, dur, pitch * drift, level * L.gain * num(spec.gain, 1));
    t += dur + SYLL_GAP / pace;
  }
  const dur = Math.max(0.02, t - SYLL_GAP / pace);
  return { kind, dur, grains };
}

/**
 * One syllable: two formant-filtered copies of the glottal source, an optional
 * inharmonic ring, and a breath of noise in the upper formant.
 *
 * The pitch GLIDES across the syllable rather than sitting still. A held
 * frequency is the single most synthetic thing a voice can do — it is what
 * makes a tone read as a beep — so every syllable arrives from below and leaves
 * above or vice versa, by `spec.bend`.
 */
function syllable(out, spec, t, dur, pitch, level) {
  const f0 = num(spec.f0, 120) * num(pitch, 1);
  const bend = num(spec.bend, 0.08);
  const start = f0 * (1 - bend * 0.6);
  const end = f0 * (1 + bend * 0.4);
  const wave = spec.wave || 'sawtooth';
  const [F1, F2] = spec.formants || [600, 1200];
  const [Q1, Q2] = spec.q || [6, 5];

  out.push({ t, dur, src: wave, f0: start, f1: end, gain: level * 0.9,
    attack: dur * 0.16, filter: { type: 'bandpass', freq: F1, q: Q1 } });
  out.push({ t: t + dur * 0.02, dur: dur * 0.9, src: wave, f0: start, f1: end,
    gain: level * num(spec.mix, 0.6) * 0.8, attack: dur * 0.22,
    filter: { type: 'bandpass', freq: F2, q: Q2 } });

  /**
   * THE CHEST, and it is not decoration.
   *
   * Two narrow bandpasses on a square source can suppress the fundamental
   * completely — The Count's F1 sits on his fifth harmonic — and a voice with
   * no fundamental does not merely sound thin, it MEASURES as a different
   * person: autocorrelation on the first pass put a 138 Hz larynx at 353 Hz,
   * one hertz off the droid. This is the low-passed source under both formants,
   * which is what a chest is, and it anchors the pitch to the number in the
   * table.
   */
  out.push({ t, dur: dur * 0.95, src: wave, f0: start, f1: end, gain: level * 0.30,
    attack: dur * 0.2, filter: { type: 'lowpass', freq: Math.min(F1 * 0.8, f0 * 2.4), q: 0.9 } });

  // Metal. An inharmonic partial is the one thing a throat cannot make, which
  // is exactly why a droid gets one and nothing organic does.
  if (spec.ring > 0) {
    out.push({ t, dur: dur * 0.85, src: 'square', f0: start * spec.ring, f1: end * spec.ring,
      gain: level * 0.34, attack: dur * 0.08,
      filter: { type: 'bandpass', freq: F2 * 1.15, q: Q2 * 1.4 } });
  }

  const rasp = num(spec.rasp, 0);
  if (rasp > 0.02) {
    out.push({ t, dur: dur * 0.8, src: 'noise', f0: 0, f1: 0, gain: level * rasp * 0.6,
      attack: dur * 0.1, filter: { type: 'bandpass', freq: num(spec.raspFreq, 2400), q: 1.6 } });
  }
}

/**
 * How loud the loudest moment of a line is, before distance.
 *
 * The engine needs this BEFORE it builds anything: a line that would arrive
 * under the hearing floor must be refused without spending a voice, exactly
 * like every one-shot in Audio.js. Grains overlap, so this is the sum of the
 * levels alive at each grain's onset rather than the largest single grain.
 */
export function peakGain(u) {
  let peak = 0;
  for (const g of u.grains) {
    let sum = 0;
    for (const h of u.grains) if (h.t <= g.t + 1e-6 && h.t + h.dur > g.t) sum += h.gain;
    if (sum > peak) peak = sum;
  }
  return peak;
}
