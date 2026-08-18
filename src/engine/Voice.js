/**
 * BATTLEFRONT BORZ — voices, as numbers.
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
    f0: 116, wave: 'sawtooth', formants: [640, 1180], q: [5.5, 4.6], mix: 0.5,
    rasp: 0.10, raspFreq: 1900, cadence: 1.0, bend: 0.07, gain: 1.0,
  },
  {
    id: 'mask', name: 'The Mask',
    blurb: 'Chest-deep and filtered, every word costing something. Slow on purpose.',
    f0: 88, wave: 'sawtooth', formants: [370, 690], q: [7.5, 5.5], mix: 0.55,
    rasp: 0.24, raspFreq: 700, cadence: 0.80, bend: 0.04, gain: 1.05,
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
    f0: 128, wave: 'sawtooth', formants: [1150, 2900], q: [8, 5], mix: 0.85,
    rasp: 0.30, raspFreq: 3400, cadence: 1.3, bend: 0.09, gain: 0.85,
  },
  sith: {
    id: 'sith', name: 'Sith acolyte',
    f0: 97, wave: 'sawtooth', formants: [470, 960], q: [6, 5], mix: 0.6,
    rasp: 0.22, raspFreq: 1350, cadence: 0.95, bend: 0.11, gain: 0.95,
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
  /**
   * THE OFFICER — the one voice on this list that has to carry over a battle.
   *
   * Command mode fields a Clone Commander and a MagnaGuard whose whole job is to
   * make the line around them better, and both of them SHOUT: the rally aura is
   * already drawn as a ring on the ground, and a ring with nothing audible in it
   * is half a tell. A commander is not a louder trooper — a voice that carries
   * across noise is a voice with its formants FORWARD and its rasp up, not one
   * with its gain up, which is why F2 goes to 3600 against the trooper's 2900
   * and the rasp to 0.42 against 0.30. Measured by `voices.mjs` against every
   * other spec: it has to be its own point in pitch/centroid/length, and the
   * pitch alone (112 against the trooper's 128) would not have been enough.
   */
  officer: {
    id: 'officer', name: 'Clone Commander',
    f0: 112, wave: 'sawtooth', formants: [820, 3600], q: [6, 4], mix: 1.0,
    rasp: 0.42, raspFreq: 3800, cadence: 1.12, bend: 0.14, gain: 1.0,
  },
  /**
   * THE COMMANDO DROID — a droid throat, but not a B1's.
   *
   * The `droid` spec is a B1: f0 300, cadence 1.9, a huge 2.71 ring partial, and
   * the whole character of it is that it sounds SILLY, which is correct for a B1
   * and is exactly wrong for a BX or a MagnaGuard. Those are the CIS bodies that
   * are meant to frighten you. So: an octave and a half down at 118, a slower
   * cadence, a much lower ring (1.41 rather than 2.71, so the inharmonic partial
   * sits close to the fundamental and reads as a resonating shell rather than as
   * a bell), and the formants low and narrow. Still unmistakably a machine —
   * nothing with a throat can make an inharmonic partial at all — and it is the
   * machine you take seriously.
   */
  commando: {
    id: 'commando', name: 'Commando droid',
    f0: 118, wave: 'square', formants: [420, 1150], q: [9, 7], mix: 0.7,
    rasp: 0.18, raspFreq: 2100, cadence: 0.86, bend: 0.06, ring: 1.41, gain: 0.92,
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
/**
 * ── one voice, or every voice ────────────────────────────────────────────
 *
 * `each: true` marks a contour where EVERY SPEAKER IS ITS OWN EVENT, and it is
 * the field that decides which of the announcer's two room budgets a line
 * spends. The distinction was already written down — in prose, over
 * `Announcer.BATTLE_GAP` — and being prose is exactly why the call sites did
 * not follow it:
 *
 *   "the limit was written for lines the room says about ITSELF — an alarm, a
 *    panic call, idle banter — where one is representative and six are noise.
 *    A body being flung is a thing the PLAYER just did, one per body, and
 *    hearing only one of six is hearing the power wrong."
 *
 * A DEATH IS THE CANONICAL ONE-PER-BODY LINE and it was on the wrong side of
 * that sentence. Measured with `tools/_voiceprobe.mjs` on a real Geonosis
 * command wave, seed 4242, 60 s: **seven bodies fell and the player heard none
 * of them.** Every death cry in the run — five screams and two power-downs —
 * was refused by the shared 0.45 s budget, which had already been spent on the
 * alarm calls of bodies that were still standing. `cheer`, which was moved to
 * the per-event budget when it was written, was refused zero times in the same
 * run. The colosseum run says the same thing with one death instead of seven.
 *
 * So the split is DATA now, on the contour, next to the contour. A new line is
 * on the shared budget unless it says otherwise, which is the quiet side to
 * default to — the failure mode of guessing wrong here is a wall of sound, and
 * a contour whose author has not thought about it should not be able to make
 * one.
 */
export const LINES = {
  /* efforts — one syllable, no thinking involved */
  effort: { gain: 0.50, syll: [[1.02, 0.42, 1.0]] },
  /**
   * A WOUND IS NOT MARKED `each`, AND THAT IS THE ONE JUDGEMENT IN THIS TABLE.
   *
   * It is the closest call of the five. A grunt is a thing that happens to one
   * body, like a death — but twenty bodies trading rifle fire is precisely the
   * case the shared budget was written for, and `Enemy.damage` fires this at
   * 8.5% of a body's health with only a 2.2 s per-body gap under it, so a
   * squad under sustained fire would be seven grunts a second. One grunt IS
   * representative of a firefight; one death is not representative of anything.
   */
  hurt:   { gain: 0.85, syll: [[1.22, 0.36, 1.0], [0.92, 0.42, 0.55]] },
  land:   { gain: 0.62, syll: [[0.78, 0.40, 1.0]] },
  die:    { each: true, gain: 1.00, syll: [[1.18, 0.55, 1.0], [0.96, 0.70, 0.8], [0.70, 1.15, 0.45]] },
  /* quips — the four triggers the brief names */
  kill:   { gain: 0.72, syll: [[1.05, 0.42, 0.9], [0.90, 0.52, 0.72]] },
  streak: { gain: 0.80, syll: [[0.94, 0.40, 0.8], [1.06, 0.40, 0.9], [1.20, 0.62, 1.0]] },
  boss:   { gain: 0.88, syll: [[0.86, 0.62, 0.85], [0.80, 0.50, 0.7], [0.90, 0.44, 0.8], [0.74, 0.95, 0.9]] },
  low:    { gain: 0.78, syll: [[1.10, 0.50, 0.85], [0.88, 0.80, 1.0]] },
  /* the enemy side */
  alarm:  { gain: 0.85, syll: [[1.10, 0.30, 1.0], [1.28, 0.34, 0.9]] },
  panic:  { gain: 0.90, syll: [[1.24, 0.28, 1.0], [1.34, 0.26, 0.9], [1.12, 0.44, 0.8]] },
  scream: { each: true, gain: 1.00, syll: [[1.30, 0.70, 1.0], [1.05, 0.95, 0.6]] },
  chatter:{ gain: 0.55, syll: [[1.00, 0.26, 0.9], [0.90, 0.30, 0.7]] },

  /* ── the battle, and it is the whole of player note #21's last sentence ──
   *
   * "I want to hear their screams and cheers, in general make the game more
   * audible as far as voices — I want to hear the enemies scream as they get
   * force thrown or killed or cheer when someone dies you know what I mean?"
   *
   * Three contours, and the reason they are three rather than reuses is that
   * each one is a DIFFERENT SHAPE and the shape is what carries the meaning. A
   * contour is not a word: what a listener reads off it is the direction, the
   * length and where the emphasis sits, and those three things read the same
   * whoever is speaking, which is the whole design of this file.
   */

  /**
   * FLUNG. Not `scream` — that is a death, and a death FALLS.
   *
   * A body that has just been picked up by something invisible does the
   * opposite: one syllable, the longest in the table at 1.35, starting above the
   * larynx and climbing the whole way. Nothing else here rises for more than a
   * third of a second, so this is the only contour in the game a listener could
   * not mistake for something ending. It is also the loudest (1.05), because
   * this fires at the moment the body is furthest away it will ever be.
   */
  flung:  { each: true, gain: 1.05, syll: [[1.22, 1.35, 1.0]] },

  /**
   * A CHEER, which is a THIRD thing and not a happy scream.
   *
   * Four syllables, short, level, all on one pitch, with the last one held. That
   * is what a group shouting together sounds like — a crowd cannot glide, so a
   * cheer is rhythmic where every other line here is melodic. The rhythm is the
   * tell: 0.20/0.20/0.20 then 0.62 is three beats and a held note, and it is
   * unmistakable at any pitch, through any throat, at any distance.
   */
  cheer:  { each: true, gain: 0.92, syll: [[1.06, 0.20, 0.85], [1.06, 0.20, 0.9], [1.06, 0.20, 0.95], [1.14, 0.62, 1.0]] },

  /**
   * AN ORDER GIVEN. Short, hard, and it lands DOWN.
   *
   * Two syllables, the first clipped to 0.22 and the second falling and held —
   * the contour of a two-word command. It is the officer's line and it is what
   * the player hears when they change formation, so it has to be legible under
   * a firefight: the fall is what distinguishes it from `alarm`, which is the
   * other short two-syllable line in the table and which rises.
   *
   * WHOSE LINE IT IS was written down twice here and the two did not agree —
   * this paragraph said "the officer's" and the note over ENEMY_LINES said "the
   * reply to a command, said by the troops, not by the commander". The contour
   * cannot be both a command and an answer to one; it FALLS, and an
   * acknowledgement rises. So it is the ORDER, said by whoever gives it: an
   * officer on the field shouting at the line around it, and — when the player
   * presses a formation key — the nearest of the player's own troops relaying
   * it, because a Jedi giving a hand signal is not a Jedi shouting. It is on
   * ENEMY_LINES under either reading: what the wheel must never do is let the
   * player speak it, and neither reading ever wanted that.
   */
  order:  { gain: 0.95, syll: [[1.16, 0.22, 1.0], [0.86, 0.58, 0.9]] },
};

export const LINE_KINDS = Object.keys(LINES);

/**
 * WHICH CONTOURS BELONG TO THE ROOM, AND WHICH BELONG TO YOU.
 *
 * The split exists because the emote wheel needs to know what the PLAYER's
 * voice can be asked for — a wheel slot that plays the droid alarm call out of
 * a Jedi's throat is not an emote, it is a bug — and because the answer must be
 * derived rather than typed twice. So exactly one of the two lists is written
 * down, and it is the shorter and more stable one: the four calls only an enemy
 * ever makes. Everything else in LINES is the player's, by construction, which
 * means a contour added below is on the wheel the day it is authored instead of
 * the day someone remembers the wheel exists.
 *
 * `die` is deliberately on BOTH sides of that line and is therefore in neither
 * list of exclusions: a droid powers down on the same three descending
 * syllables the player dies on (see Announcer._enemyLine, which picks 'die' for
 * anything with a `ring` partial and 'scream' for anything with a throat).
 */
/**
 * `flung`, `cheer` and `order` join this list, and each for its own reason.
 *
 * `flung` is a body reacting to being thrown by the Force, which is a thing that
 * happens TO somebody else — the player is the one doing the throwing. `cheer`
 * is a line the army around you says about a kill; a wheel slot that made the
 * player cheer their own kill would be a different and much worse emote. `order`
 * is a command given on the field — by an officer, or relayed by a trooper when
 * the player presses a formation key. See the contour's own note, which used to
 * contradict this sentence and no longer does. Either way it is not a thing a
 * Jedi shouts, and the commander's own voice is already on the wheel through
 * `streak` and `boss`.
 *
 * (`die` remains on both sides and therefore in neither list — see below.)
 */
export const ENEMY_LINES = ['alarm', 'panic', 'scream', 'chatter', 'flung', 'cheer', 'order'];
export const PLAYER_LINES = LINE_KINDS.filter(k => !ENEMY_LINES.includes(k));

/**
 * The two halves of `each`, derived — never listed. See the note over LINES.
 *
 * `EACH_LINES` is every contour where one speaker is one event and the next
 * speaker is another one; `CHORUS_LINES` is the rest of the room's vocabulary,
 * where one voice stands for all of them. `Announcer.roomLine` is the single
 * reader, and it is the only place in the game that decides which of the two
 * room budgets a line spends.
 */
export const EACH_LINES = LINE_KINDS.filter((k) => !!LINES[k].each);
export const CHORUS_LINES = ENEMY_LINES.filter((k) => !LINES[k].each);

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
