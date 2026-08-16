/**
 * BATTLEFRONT BORZ — THE SCORE, GENERATED.
 *
 * Everything in this game is synthesised. The one exception was the music: a
 * 29 MB mp3 streamed at constant gain from the first pointer-down to the death
 * card, with a single sine oscillator sweeping 74 → 38 Hz underneath it as the
 * whole of the "adaptive" layer. No stems, no key, no boss theme, no stinger,
 * and nothing anywhere that got out of the way of a clash.
 *
 * ── WHAT AN OSCILLATOR BANK CAN AND CANNOT DO ───────────────────────────
 *
 * The subject is late-Romantic brass and strings and you cannot sample either,
 * so the question is not "how do I fake an orchestra" — that road ends in a
 * worse orchestra — but "what does this synthesis method do WELL that suits an
 * army". Three answers, and the whole file is built out of them:
 *
 *   LOW BRASS is the one orchestral colour additive synthesis genuinely gets.
 *     A horn is a sawtooth whose spectrum OPENS as it gets louder — that is the
 *     physical fact, brass brightens under pressure — so `_brass` is a detuned
 *     saw pair through a lowpass whose cutoff rides its own amplitude envelope.
 *     Play it at 55–165 Hz and it is a trombone section; play it at 400 Hz and
 *     it is a synthesiser, which is why nothing here does.
 *
 *   A DRONE WITH MOVING PARTIALS is what a string section sounds like from far
 *     enough away. Six oscillators, detuned by a few cents each, glided rather
 *     than switched between chords, and the beating between them IS the ensemble.
 *     This is the layer that would be a generic pad if it stood still; it does
 *     not stand still, because the chord under it moves.
 *
 *   PERCUSSION IS A NOISE ENVELOPE and always was. A war drum is a pitched sine
 *     falling a fifth in 90 ms with a band of noise on the front of it. That is
 *     not an approximation of a taiko, it is most of what a taiko is.
 *
 * What is deliberately NOT attempted: melody. A tune played on these voices
 * would be a chiptune of a tune, and the game would be worse for it. The score
 * is HARMONY, RHYTHM and REGISTER — which is what actually changes when a wave
 * arrives — and the recognisable gestures are kept for the stingers, where they
 * are one bar long and land on a specific event.
 *
 * ── THE KEY IS ALREADY DECIDED, AND NOT BY THIS FILE ────────────────────
 *
 * `Audio.js` has built its ambience drone on [55, 82.4, 110, 164.8, 220] Hz
 * since it was written — A1, E2, A2, E3, A3, an A with open fifths — and
 * `victory()` resolves on 220/277.2/330/440, which is A major. The room is in A.
 * So the score is in A, and `ROOT` is the one place that is written down. A
 * second key would not be a richer game, it would be two pieces of music playing
 * in different keys through the same speaker.
 *
 * MODE is what moves, and it is the point of view:
 *
 *   explore  A aeolian     i – VI – VII – i. Unresolved, slow, no third in the
 *                          tonic — the room is waiting.
 *   combat   A phrygian    i – bII – i – bVII. The flat second over a pedal A
 *                          is the oldest menace in European music and it is
 *                          most of what the villain themes of this genre are.
 *   boss     A phrygian    i – bII – bV – bII. The bV is a tritone from the
 *                          pedal; it is the one interval that cannot resolve.
 *   victory  A ionian      I – IV – V – I, and it is the ONLY time the score
 *                          gets a major third. That is why it lands.
 *   death    A aeolian     one chord, held, everything above the bass removed.
 *
 * ── THE BAR CLOCK IS NOT THE FRAME CLOCK ────────────────────────────────
 *
 * Every musical timer in this project's history that used the wall clock has
 * been wrong, and a timer that uses the FRAME clock is wrong in a second way:
 * the frame rate here is whatever swiftshader manages, the menu does not run
 * `World.update` at all, and a death card is 2.6 s during which nothing ticks.
 *
 * So the score schedules itself on the AUDIO clock. `_pump` fills every bar
 * that starts inside the next `LOOKAHEAD` seconds and arms a silent oscillator
 * to wake it for the bar after that — which is the only callback WebAudio has
 * that runs on the same clock as the notes. `update()` is a belt-and-braces
 * nudge from the frame loop for the case where a browser drops an `ended`, and
 * it is cheap enough to call at 60 Hz: two comparisons when there is nothing to
 * schedule.
 *
 * The cost, measured in nodes rather than argued: a combat bar at 104 bpm is
 * 2.31 s and builds four ostinato stabs, two drums and one clock tick — about
 * 24 nodes, or ten a second. The one-shot pool grants sixty a second in an
 * ordinary fight. The score does not take voices from that pool, for the same
 * reason the old pulse did not: it is not an event in the room and it must
 * never be refused because the room is busy.
 */

import { clamp, makeRng } from './MathUtil.js';

/** Finite-or-default. Every AudioParam below throws on NaN. */
const num = (v, d) => (Number.isFinite(v) ? v : d);

const rng = makeRng(9137);

/**
 * A1, and the whole score is measured from it. See the header: the ambience
 * drone and `victory()` were both already in A before this file existed.
 */
export const ROOT = 55;
/** A semitone offset from ROOT, in Hz. */
export const hz = (semi) => ROOT * Math.pow(2, num(semi, 0) / 12);

/**
 * THE CHORDS, as semitones from A1.
 *
 * `bass` is where the low brass sits (40–90 Hz, which is the contrabass /
 * tuba register and the only place these oscillators sound like brass rather
 * than like a synthesiser). `tones` is the voicing the strings hold and the
 * ostinato draws its pitches from, so a figure written as "the chord's root,
 * then its fifth" is right in every chord instead of being a fixed interval
 * that goes sour the moment the harmony moves.
 */
export const CHORDS = {
  /* A, open fifths — no third at all. The tonic of everything but victory. */
  Apow: { name: 'A5',  bass: 0,  tones: [12, 19, 24, 31] },
  /* bII. The phrygian half-step over an A pedal. */
  Bb:   { name: 'Bb',  bass: 1,  tones: [13, 17, 20, 25] },
  /* bV — a tritone from the pedal, and it cannot resolve. Boss only.
   * ABOVE the tonic rather than below it: a tritone DOWN from A1 is 38.9 Hz,
   * which most of the machines this runs on cannot reproduce at all, so the one
   * interval in the score that has to be heard as an interval would have
   * arrived as a level change. */
  Eb:   { name: 'Eb',  bass: 6,  tones: [18, 22, 25, 30] },
  /* VI and VII of A aeolian. */
  F:    { name: 'F',   bass: -4, tones: [8,  12, 17, 20] },
  G:    { name: 'G',   bass: -2, tones: [10, 14, 19, 22] },
  /* A minor, voiced with its third — death, and nowhere else. */
  Am:   { name: 'Am',  bass: 0,  tones: [12, 15, 19, 24] },
  /* The major set. Victory is the only state that ever hears a major third. */
  A:    { name: 'A',   bass: 0,  tones: [12, 16, 19, 24] },
  D:    { name: 'D',   bass: 5,  tones: [17, 21, 24, 29] },
  E:    { name: 'E',   bass: -5, tones: [19, 23, 26, 31] },
};

/**
 * THE STATE TABLE, and it is the only copy of any of this.
 *
 * Every state names its tempo, its harmony, where each layer sits and what the
 * rhythm section plays. A check reads this table to know what to expect rather
 * than restating the tempo in a second place — HANDOFF §2.4 — so a state whose
 * bpm is retuned is measured against its new bpm on the next run and cannot
 * quietly disagree with its own test.
 *
 * `layers` are TARGET GAINS, ramped over `XFADE` when the state changes. A
 * layer at 0 is genuinely absent: its oscillators keep running (starting and
 * stopping six oscillators per transition is a click and a leak waiting to
 * happen) but nothing of it reaches the bus.
 *
 * `ost` and `perc` are eighth-note grids, eight slots to the bar. An ostinato
 * slot names a degree of the CURRENT chord (`t` indexes `tones`) rather than a
 * fixed semitone, plus an octave shift, so the figure transposes with the
 * harmony instead of fighting it.
 */
const O = (t, g, o = -12) => ({ t, g, o });
export const SCORE_STATES = {
  /** Between waves. Slow, modal, no third, no drums. */
  explore: {
    bpm: 66, hold: 2, mode: 'aeolian',
    prog: ['Apow', 'F', 'Apow', 'G'],
    layers: { low: 0.26, strings: 0.22, air: 0.00, ost: 0.00, perc: 0.00 },
    ost: [null, null, null, null, null, null, null, null],
    taiko: [0, 0, 0, 0, 0, 0, 0, 0],
    rattle: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  /** A wave is on the field. The bII arrives with it. */
  combat: {
    bpm: 104, hold: 1, mode: 'phrygian',
    prog: ['Apow', 'Bb', 'Apow', 'G'],
    layers: { low: 0.40, strings: 0.24, air: 0.04, ost: 0.30, perc: 0.34 },
    ost: [O(0, 1.0), null, O(0, 0.55), O(2, 0.8), null, O(0, 0.65), null, O(1, 0.75)],
    taiko: [1.0, 0, 0, 0, 0.85, 0, 0, 0],
    rattle: [0, 0, 0.5, 0, 0, 0, 0.55, 0.4],
  },
  /**
   * A boss. Faster, a tritone in the progression, a 3+3+2 ostinato — the
   * asymmetry is what makes it read as a different piece rather than as the
   * combat cue played louder.
   */
  boss: {
    bpm: 120, hold: 1, mode: 'phrygian',
    prog: ['Apow', 'Bb', 'Eb', 'Bb'],
    layers: { low: 0.48, strings: 0.20, air: 0.15, ost: 0.40, perc: 0.44 },
    ost: [O(0, 1.0), null, null, O(0, 0.9), null, null, O(1, 0.85), O(0, 0.6)],
    taiko: [1.0, 0, 0, 0.8, 0, 0, 0.9, 0],
    rattle: [0, 0.35, 0, 0, 0.45, 0, 0, 0.5],
  },
  /** The field is held, or the campaign is won. The one major state. */
  victory: {
    bpm: 92, hold: 1, mode: 'ionian',
    prog: ['A', 'D', 'E', 'A'],
    layers: { low: 0.36, strings: 0.36, air: 0.18, ost: 0.00, perc: 0.14 },
    ost: [null, null, null, null, null, null, null, null],
    taiko: [0.8, 0, 0, 0, 0, 0, 0, 0],
    rattle: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  /** You died. One chord, held, and everything above the bass taken away. */
  death: {
    bpm: 48, hold: 4, mode: 'aeolian',
    prog: ['Am'],
    layers: { low: 0.30, strings: 0.07, air: 0.09, ost: 0.00, perc: 0.00 },
    ost: [null, null, null, null, null, null, null, null],
    taiko: [0, 0, 0, 0, 0, 0, 0, 0],
    rattle: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  /** Not playing. A real state rather than a flag, so a transition INTO
   *  silence is a crossfade like any other. */
  off: {
    bpm: 66, hold: 4, mode: 'aeolian',
    prog: ['Apow'],
    layers: { low: 0, strings: 0, air: 0, ost: 0, perc: 0 },
    ost: [null, null, null, null, null, null, null, null],
    taiko: [0, 0, 0, 0, 0, 0, 0, 0],
    rattle: [0, 0, 0, 0, 0, 0, 0, 0],
  },
};

export const STATE_NAMES = Object.keys(SCORE_STATES);

/** Beats to a bar. Everything here is in four. */
const BEATS = 4;
/** Slots to a bar — eighths. */
const SLOTS = 8;
/** How far ahead of the audio clock a bar is built. */
const LOOKAHEAD = 0.45;
/** How long a layer takes to arrive or leave on a state change. */
const XFADE = 1.1;
/** …except into death, which is a cut. */
const XFADE_DEATH = 0.22;
/** The longest a new state waits for its own downbeat. See setState. */
const BAR_PULL = 1.0;

/**
 * How long a state must want to change before it is allowed to.
 *
 * The derived state (see `_derive`) reads a smoothed combat intensity, and a
 * score that flipped between explore and combat every time one droid wandered
 * out of range would be worse than one that never moved at all. Rising is
 * quick — a wave arriving must be heard arriving — and falling is slow, because
 * the end of a fight is not an event, it is an absence.
 */
const RISE_HOLD = 0.9;
const FALL_HOLD = 5.0;
/** The smoothed intensity at which a fight is a fight, with hysteresis. */
const HOT = 0.30, COLD = 0.10;

export class Score {
  /**
   * @param ctx  an AudioContext (or the shim in tools/dom-shim.mjs)
   * @param out  the node the score plays into — AudioEngine's music duck
   * @param noise a noise AudioBuffer for the percussion, or null
   */
  constructor(ctx, out, noise = null) {
    this.ctx = ctx;
    this.noise = noise;
    /**
     * TWO SWITCHES, because there are three kinds of soundtrack row and they
     * want three different things (see AudioEngine.MUSIC_TRACKS).
     *
     *   `enabled` is THE BED — the sustained layers, the bar clock, the
     *     ostinato and the drums. It is on only when the generated score is the
     *     chosen track, because a bed under the streamed orchestral theme would
     *     be two pieces of music at once.
     *   `armed` is ANYTHING AT ALL, and it is on for the streamed track too.
     *     A wave arriving, a boss walking on, a death and a won campaign are
     *     the beats this game had no sound for; a player who prefers the mp3
     *     should not lose them along with the bed. It is off for exactly one
     *     row — "No score" — which is a player asking for the room and the
     *     blade and nothing else, and means it.
     */
    this.enabled = false;
    this.armed = false;
    this.state = 'off';
    /** The state the NEXT bar will be played in. See setState. */
    this._want = 'off';
    this.bar = 0;
    this.intensity = 0;
    /** Facts the game has told us, or that were derived from what it did. */
    this.wave = 0;
    this.waveActive = false;
    this.boss = false;
    this.dead = false;
    this.won = false;
    /** True once anything has called `AudioEngine.setMusicState`. See there. */
    this.driven = false;
    this._hotFor = 0; this._coldFor = 0;
    this.stats = { bars: 0, notes: 0, stingers: 0, transitions: 0, skipped: 0 };

    /* ── the fixed part of the graph ─────────────────────────────────── */

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    /**
     * The score's own limiter, and it is not the game's.
     *
     * `musicBus` deliberately bypasses the master compressor — on it, every
     * blaster shot pumped the music down with it — so a fanfare stacked on top
     * of a pad and a drum has nothing at all catching it. This one only ever
     * sees the score, so it cannot be told about the fight.
     */
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -9;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.20;
    this.bus.connect(this.comp);
    this.comp.connect(out);

    /**
     * THE BED AND THE CUE ARE TWO NODES, and they have to be.
     *
     * A stinger that ducked the whole music path would duck ITSELF — it plays
     * through the same bus — so the bed and the gesture would drop by exactly
     * the same amount and the duck would achieve nothing except making the most
     * important half-second in the wave quieter. That was the first version and
     * it is the kind of mistake a graph measurement catches and an ear does not,
     * because "the music got quieter" is what it sounds like either way.
     *
     * So: the five layers sum into `bed`, the stingers go into `cue`, both meet
     * at `bus`, and `stinger()` pulls `bed` down under `cue`. The engine's own
     * `musicDuck` sits downstream of both and moves them together, which is
     * right for the thing IT is for — a clash beats the music, all of it,
     * including a fanfare.
     */
    this.bed = ctx.createGain(); this.bed.gain.value = 1;
    this.bed.connect(this.bus);
    this.cue = ctx.createGain(); this.cue.gain.value = 1;
    this.cue.connect(this.bus);
    this._bedDuckUntil = 0; this._bedDuckAt = 1;

    this.layers = {};
    for (const k of ['low', 'strings', 'air', 'ost', 'perc']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.bed);
      this.layers[k] = g;
    }

    this._buildSustained();

    this._nextBar = 0;
    this._tick = null;
    this._retry = 0;
  }

  /* ── the three sustained layers ─────────────────────────────────────── */

  /**
   * The oscillators that never stop.
   *
   * Six for the strings, three for the brass, two for the air: eleven for the
   * life of the session, against the sixty a second the one-shot pool grants in
   * an ordinary fight. They are started once and GLIDED between chords rather
   * than restarted, which is both cheaper and the thing that makes the bed
   * sound like an ensemble changing position instead of a synthesiser changing
   * preset — every partial arrives at the new chord at a slightly different
   * moment, because every one of them has its own detune.
   */
  _buildSustained() {
    const ctx = this.ctx;
    const osc = (type, gainTo, level, detune) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = ROOT;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g); g.connect(gainTo);
      try { o.start(); } catch {}
      return o;
    };

    /* LOW BRASS. Sawtooth through a lowpass that opens with the level — see
     * the header: brass brightens under pressure, and a static filter is the
     * single thing that makes a synth brass patch sound like plastic. */
    this.brassLP = ctx.createBiquadFilter();
    this.brassLP.type = 'lowpass';
    this.brassLP.frequency.value = 320;
    this.brassLP.Q.value = 1.6;
    this.brassLP.connect(this.layers.low);
    this.lowOsc = [
      { o: osc('sawtooth', this.brassLP, 0.30, -5), semi: 0 },
      { o: osc('sawtooth', this.brassLP, 0.22, 6), semi: 12 },
      { o: osc('sine', this.brassLP, 0.34, 0), semi: 0 },
    ];

    /* STRINGS. Six partials on the voicing, each with its own detune, through a
     * gentle band so the top of the sawtooth does not read as a buzz. */
    this.stringBP = ctx.createBiquadFilter();
    this.stringBP.type = 'lowpass';
    this.stringBP.frequency.value = 2400;
    this.stringBP.Q.value = 0.6;
    this.stringBP.connect(this.layers.strings);
    this.stringOsc = [];
    for (let i = 0; i < 6; i++) {
      const t = i % 4;
      this.stringOsc.push({
        o: osc(i < 4 ? 'sawtooth' : 'triangle', this.stringBP, 0.13 / (1 + i * 0.25),
          (rng() - 0.5) * 16),
        tone: t, oct: i < 4 ? 0 : 12,
      });
    }
    /* …and the ensemble breathes. One slow LFO on every string detune is what
     * a section doing vibrato out of phase with itself sounds like from the
     * back of a hall. */
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.19;
    const lg = ctx.createGain(); lg.gain.value = 7;
    lfo.connect(lg);
    for (const s of this.stringOsc) lg.connect(s.o.detune);
    try { lfo.start(); } catch {}
    this._stringLfo = lfo;

    /* AIR. Two sines high over the chord — the keening line that only a boss,
     * a victory and a death ever get. */
    this.airOsc = [
      { o: osc('sine', this.layers.air, 0.5, 3), tone: 1, oct: 24 },
      { o: osc('sine', this.layers.air, 0.32, -4), tone: 3, oct: 24 },
    ];
    const vib = ctx.createOscillator();
    vib.type = 'sine'; vib.frequency.value = 4.6;
    const vg = ctx.createGain(); vg.gain.value = 9;
    vib.connect(vg);
    for (const a of this.airOsc) vg.connect(a.o.detune);
    try { vib.start(); } catch {}
    this._airVib = vib;
  }

  /** Glide every sustained partial onto `ch`. */
  _voice(ch, when) {
    const t = Math.max(when, this.ctx.currentTime);
    const glide = 0.09;
    for (const s of this.lowOsc) {
      try { s.o.frequency.setTargetAtTime(hz(ch.bass + s.semi), t, glide); } catch {}
    }
    for (const s of this.stringOsc) {
      try { s.o.frequency.setTargetAtTime(hz(ch.tones[s.tone] + s.oct), t, glide); } catch {}
    }
    for (const a of this.airOsc) {
      try { a.o.frequency.setTargetAtTime(hz(ch.tones[a.tone] + a.oct), t, glide); } catch {}
    }
  }

  /* ── the transient voices ───────────────────────────────────────────── */

  /**
   * Free the nodes of a scheduled voice once it has finished.
   *
   * `onended` and not a timer, for the reason written out at length in
   * `AudioEngine._freeOnEnd`: a wall-clock timer is throttled to one a minute
   * in a backgrounded tab and detached from a suspended context, and every
   * musical timer in this project that used one has been wrong.
   */
  _ping(src, ...nodes) {
    src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch {} } };
  }

  /**
   * ONE BRASS NOTE. Two detuned saws through a lowpass that opens with the
   * envelope and shuts again as the note decays — see the header.
   *
   * `bright` is how far the filter opens at the peak, in multiples of the
   * fundamental. A stab wants 6–8 and a swell wants 3–4: a long note that opens
   * as far as a short one reads as a filter sweep rather than as a horn.
   */
  _brass(when, freq, dur, gain, { bright = 6, attack = 0.02, dest = null, detune = 7 } = {}) {
    const ctx = this.ctx, t = Math.max(when, ctx.currentTime);
    const f = clamp(num(freq, 110), 20, 4000);
    const d = clamp(num(dur, 0.3), 0.03, 12);
    const g0 = clamp(num(gain, 0.2), 0.0002, 4);
    const a = clamp(num(attack, 0.02), 0.004, d * 0.9);
    const stopAt = t + d + 0.05;
    try {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1.1;
      lp.frequency.setValueAtTime(Math.max(60, f * 1.4), t);
      lp.frequency.linearRampToValueAtTime(Math.max(80, f * bright), t + a);
      lp.frequency.setTargetAtTime(Math.max(60, f * 1.2), t + a, d / 2.4);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(g0, t + a);
      env.gain.setTargetAtTime(0.0001, t + a, d / 2.6);
      env.gain.linearRampToValueAtTime(0.0001, stopAt);
      lp.connect(env); env.connect(dest || this.layers.ost);
      let last = null;
      for (const det of [-detune, detune]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t); o.stop(stopAt);
        last = o;
      }
      this._ping(last, lp, env);
      this.stats.notes++;
    } catch { this.stats.skipped++; }
  }

  /**
   * A WAR DRUM. A sine falling a fifth in under a tenth of a second with a band
   * of noise on the front of it — which is most of what a struck skin is.
   */
  _drum(when, freq, dur, gain, dest = null) {
    const ctx = this.ctx, t = Math.max(when, ctx.currentTime);
    const f = clamp(num(freq, 62), 22, 400);
    const d = clamp(num(dur, 0.4), 0.05, 4);
    const g0 = clamp(num(gain, 0.3), 0.0002, 4);
    const out = dest || this.layers.perc;
    const stopAt = t + d + 0.04;
    try {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(18, f * 0.62), t + Math.min(0.09, d));
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(g0, t + 0.006);
      env.gain.setTargetAtTime(0.0001, t + 0.008, d / 3.2);
      env.gain.linearRampToValueAtTime(0.0001, stopAt);
      o.connect(env); env.connect(out);
      o.start(t); o.stop(stopAt);
      this._ping(o, env);
      this.stats.notes++;
    } catch { this.stats.skipped++; }
    if (!this.noise) return;
    try {
      const n = ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      n.playbackRate.value = 0.8 + rng() * 0.4;
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass'; bp.frequency.value = Math.max(60, f * 4); bp.Q.value = 0.8;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(g0 * 0.5, t + 0.004);
      env.gain.setTargetAtTime(0.0001, t + 0.005, 0.035);
      env.gain.linearRampToValueAtTime(0.0001, t + 0.16);
      n.connect(bp); bp.connect(env); env.connect(out);
      n.start(t, rng() * 1.2); n.stop(t + 0.17);
      this._ping(n, bp, env);
    } catch { this.stats.skipped++; }
  }

  /** A rattle — the dry side of the kit, a short band of noise and nothing else. */
  _rattle(when, gain, dest = null) {
    if (!this.noise) return;
    const ctx = this.ctx, t = Math.max(when, ctx.currentTime);
    const g0 = clamp(num(gain, 0.1), 0.0002, 2);
    try {
      const n = ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      n.playbackRate.value = 0.9 + rng() * 0.3;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1700 + rng() * 500; bp.Q.value = 1.3;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(g0, t + 0.003);
      env.gain.setTargetAtTime(0.0001, t + 0.004, 0.026);
      env.gain.linearRampToValueAtTime(0.0001, t + 0.13);
      n.connect(bp); bp.connect(env); env.connect(dest || this.layers.perc);
      n.start(t, rng() * 1.2); n.stop(t + 0.14);
      this._ping(n, bp, env);
      this.stats.notes++;
    } catch { this.stats.skipped++; }
  }

  /* ── the state machine ──────────────────────────────────────────────── */

  cfg(name = this.state) { return SCORE_STATES[name] || SCORE_STATES.off; }
  /** Seconds in one bar of a state. */
  barLength(name = this.state) { return BEATS * 60 / this.cfg(name).bpm; }

  /**
   * Go to a state.
   *
   * The layer gains move NOW — a wave arriving has to be heard arriving, not on
   * the next downbeat — while the tempo and the rhythm patterns wait for the
   * bar line, because changing the grid mid-bar tears it. That split is the
   * whole of why `_want` exists beside `state`.
   *
   * @returns true if this was a change.
   */
  setState(name, { now = false } = {}) {
    if (!SCORE_STATES[name]) return false;
    if (this._want === name) return false;
    const from = this._want;
    this._want = name;
    this.stats.transitions++;
    const fade = (name === 'death' || now) ? XFADE_DEATH : XFADE;
    this._rampLayers(name, fade);
    /**
     * …AND THE GRID IS PULLED IN.
     *
     * Explore is 3.64 s to the bar, so a boss walking on at the top of one
     * would wait three and a half seconds for its own tempo and its own
     * rhythm — long enough that the player has finished reacting before the
     * music does. The layer gains are already moving (above); this is the
     * downbeat, and it comes within a second whatever the old bar was doing.
     * The old bar's notes are already scheduled and are left to decay across
     * it, which is what an interruption sounds like.
     */
    this._nextBar = Math.max(this.ctx.currentTime + 0.02,
      Math.min(this._nextBar, this.ctx.currentTime + BAR_PULL));
    if (from === 'off' || name === 'death' || name === 'victory') {
      this.state = name;
      this.bar = 0;
    }
    return true;
  }

  /** Ramp every layer of `name` to where the table says it goes. */
  _rampLayers(name, fade) {
    const cfg = this.cfg(name);
    const t = this.ctx.currentTime;
    const drive = name === 'combat' || name === 'boss'
      ? 0.62 + 0.38 * clamp(this.intensity, 0, 1) : 1;
    for (const k of Object.keys(this.layers)) {
      const want = this.enabled ? num(cfg.layers[k], 0) * (k === 'ost' || k === 'perc' ? drive : 1) : 0;
      try {
        this.layers[k].gain.cancelScheduledValues(t);
        this.layers[k].gain.setTargetAtTime(Math.max(0.0001, want), t, fade / 3);
      } catch {}
      this.layers[k]._want = want;
    }
    try {
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setTargetAtTime(this.armed ? 1 : 0.0001, t, fade / 3);
    } catch {}
  }

  /**
   * WHAT THE SCORE SHOULD BE PLAYING, from what the game has said.
   *
   * Precedence, and it is stated once here rather than in five callers:
   * death and a won campaign LATCH — they are the end of a run and nothing
   * that happens afterwards is music; a boss holds until the wave it belongs
   * to is cleared; otherwise a live wave or a hot field is combat and anything
   * else is explore.
   *
   * The intensity half of that is HYSTERETIC on purpose. `world.combatIntensity`
   * is already damped, but a score that flipped every time one droid wandered
   * out of the 20 m ring would be worse than one that never moved: rising is
   * quick because a wave arriving must be heard arriving, and falling is slow
   * because the end of a fight is an absence rather than an event.
   */
  _derive(dt) {
    if (this.dead) return 'death';
    if (this.won) return 'victory';
    if (this.boss) return 'boss';
    const i = this.intensity;
    if (i >= HOT) { this._hotFor += dt; this._coldFor = 0; }
    else if (i <= COLD) { this._coldFor += dt; this._hotFor = 0; }
    if (this.waveActive) return 'combat';
    if (this._hotFor >= RISE_HOLD) return 'combat';
    // `_want` and not `state`: the state a bar behind is the one the grid is
    // still PLAYING, and hysteresis is about the state that has been DECIDED.
    // Reading the lagging one made `reset()` unable to leave combat — it set
    // explore, and the next frame put it straight back, because the bar had not
    // turned yet and this clause still saw a fight.
    if (this._want === 'combat' && this._coldFor < FALL_HOLD) return 'combat';
    return 'explore';
  }

  /* ── the clock ──────────────────────────────────────────────────────── */

  /**
   * One frame, from `AudioEngine.updateScore`.
   *
   * Cheap by construction: it smooths one number, asks `_derive` for a name and
   * compares it, and `_pump` returns after one comparison unless a bar is
   * actually due. The score is NOT driven from here — see the header — this is
   * the belt-and-braces nudge for a browser that drops an `ended`, and the
   * thing that keeps the score alive on a screen where nothing calls it.
   */
  update(dt, intensity) {
    if (!this.enabled) return;
    const d = clamp(num(dt, 1 / 60), 0, 0.25);
    const i = clamp(num(intensity, 0), 0, 1);
    this.intensity = i;
    /**
     * ONE AUTHORITY, NEVER TWO. Once anything has called
     * `AudioEngine.setMusicState`, the game is telling this file what state to
     * be in and the derivation stops — otherwise `_derive` would read a
     * smoothed intensity on the very next frame and quietly overrule a `boss`
     * the director had just declared. HANDOFF §2.3, in its usual costume: a
     * hand-derived answer sitting beside the authoritative one.
     */
    if (!this.driven) {
      const want = this._derive(d);
      if (want !== this._want) { this.setState(want); this._pump(); return; }
    }
    this._driveLayers();
    this._pump();
  }

  /**
   * Within a fight, the rhythm section rides the intensity.
   *
   * Re-scheduled only when the target has actually moved by more than a
   * fortieth, for the reason `AudioEngine._bed` gives: `setTargetAtTime` at
   * 60 Hz is a ramp that never arrives anywhere.
   */
  _driveLayers() {
    if (this._want !== 'combat' && this._want !== 'boss') return;
    const cfg = this.cfg(this._want);
    const drive = 0.62 + 0.38 * clamp(this.intensity, 0, 1);
    const t = this.ctx.currentTime;
    for (const k of ['ost', 'perc']) {
      const want = num(cfg.layers[k], 0) * drive;
      if (Math.abs(want - num(this.layers[k]._want, 0)) < 0.025) continue;
      this.layers[k]._want = want;
      try { this.layers[k].gain.setTargetAtTime(Math.max(0.0001, want), t, 0.6); } catch {}
    }
  }

  /**
   * Build every bar that starts inside the next LOOKAHEAD seconds, and arm the
   * wake-up for the one after.
   *
   * A context that is not running has a FROZEN clock, so every bar scheduled
   * while it is down would land on the same timestamp and arrive as one chord
   * when it came back — the same failure `AudioEngine._live` exists to stop for
   * one-shots. The retry is the one place in this file that legitimately uses
   * the wall clock: it is waiting for the audio clock to start, which by
   * definition it cannot do on the audio clock.
   */
  _pump() {
    const ctx = this.ctx;
    if (!this.enabled) return;
    if (ctx.state && ctx.state !== 'running') { this._armRetry(); return; }
    const now = ctx.currentTime;
    this._retries = 0;
    // A tab that was backgrounded for a minute must not now build a minute of
    // bars. Everything before the present is gone; start from here.
    if (!(this._nextBar > now - 4)) this._nextBar = now + 0.03;
    let built = 0;
    while (this._nextBar < now + LOOKAHEAD && built < 8) {
      this._bar(this._nextBar);
      this._nextBar += this.barLength();
      built++;
    }
    if (built) this._armTick();
  }

  /** A silent oscillator whose `ended` is the next bar's wake-up. */
  _armTick() {
    const ctx = this.ctx;
    const when = this._nextBar - LOOKAHEAD * 0.6;
    if (this._tickAt !== undefined && Math.abs(this._tickAt - when) < 1e-6) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.bus);
      o.onended = () => { try { g.disconnect(); } catch {} this._pump(); };
      o.start(ctx.currentTime);
      o.stop(Math.max(when, ctx.currentTime + 0.005));
      this._tickAt = when;
    } catch { /* the frame-loop nudge is the fallback */ }
  }

  /**
   * Wait for the audio clock to start, on the only clock that is running.
   *
   * BOUNDED, because a browser that blocks autoplay and never gets a gesture
   * would otherwise leave a timer polling four times a second for the life of
   * the tab. Ten seconds is longer than any unlock takes; past that the frame
   * loop's own `update()` and every one of `enable`/`setState`/`stinger` will
   * pump again the moment something happens, and `AudioEngine.resume` is
   * already watching the context.
   */
  _armRetry() {
    if (this._retry || (this._retries = (this._retries || 0) + 1) > 40) return;
    this._retry = setTimeout(() => { this._retry = 0; this._pump(); }, 260);
    // Node holds the process open for a pending timer; a check must not hang.
    this._retry?.unref?.();
  }

  /**
   * ONE BAR.
   *
   * The bar line is where a pending state actually takes hold, because that is
   * where the grid can change without tearing. `_voice` glides the sustained
   * layers onto this bar's chord; the ostinato and the drums are built from the
   * state's own eighth-note grid.
   */
  _bar(when) {
    if (this._want !== this.state) {
      this.state = this._want;
      this.bar = 0;
    }
    const cfg = this.cfg();
    const beat = 60 / cfg.bpm;
    const slot = beat * BEATS / SLOTS;
    const ch = CHORDS[cfg.prog[Math.floor(this.bar / cfg.hold) % cfg.prog.length]] || CHORDS.Apow;
    this.chord = ch;
    this._voice(ch, when);

    // The brass filter follows the state's own low level, so the bed is darker
    // between waves and open in a fight — the same brightening the individual
    // notes get, applied to the layer that never stops.
    try {
      this.brassLP.frequency.setTargetAtTime(
        260 + 900 * clamp(num(cfg.layers.low, 0.3) / 0.5, 0, 1.4), when, 0.6);
    } catch {}

    for (let s = 0; s < SLOTS; s++) {
      const at = when + s * slot;
      const o = cfg.ost[s];
      if (o) {
        const semi = ch.tones[clamp(o.t | 0, 0, ch.tones.length - 1)] + num(o.o, -12);
        this._brass(at, hz(semi), slot * 1.5, 0.42 * num(o.g, 1),
          { bright: 7, attack: 0.012 });
      }
      const k = num(cfg.taiko[s], 0);
      if (k > 0) this._drum(at, 64, 0.55, 0.5 * k);
      const r = num(cfg.rattle[s], 0);
      if (r > 0) this._rattle(at, 0.16 * r);
    }
    this.bar++;
    this.stats.bars++;
  }

  /* ── stingers ───────────────────────────────────────────────────────── */

  /**
   * THE FIVE MOMENTS, plus two accents.
   *
   * Every one of them is built from the SAME chord table the bed is built from,
   * which is the whole reason they belong to the piece rather than sitting on
   * top of it: a wave-clear cadence that resolved to a key the drone is not in
   * would be a jingle. They play on their own layer so the bed does not have to
   * be interrupted for them, and they take no voice from the one-shot pool.
   *
   * A stinger returns the seconds it occupies, so a caller can budget against
   * it the way `Announcer._say` budgets against a spoken line.
   */
  stinger(kind, opts = {}) {
    if (!this.ctx) return 0;
    // `delay` is on the audio clock and is what lets `death()` put the harmony
    // failing AFTER the body has finished dying, rather than underneath it.
    const t = this.ctx.currentTime + 0.01 + clamp(num(opts.delay, 0), 0, 8);
    const g = clamp(num(opts.gain, 1), 0, 2);
    const S = this.cue;
    this.stats.stingers++;
    switch (kind) {
      /* A KILL. Not a jingle — a single low accent on the chord under it, so it
       * reads as the score answering rather than as a sound effect. Rate limited
       * by the caller (AudioEngine.stinger), because one on every body in a
       * six-kill Force rend is a machine gun. */
      case 'kill': {
        const ch = this.chord || CHORDS.Apow;
        this._brass(t, hz(ch.bass), 0.20, 0.26 * g, { bright: 8, attack: 0.008, dest: S });
        this._drum(t, 78, 0.28, 0.22 * g, S);
        return 0.3;
      }
      /* A STREAK. The same accent, answered a fifth up — the smallest gesture
       * that reads as "and another". */
      case 'streak': {
        const ch = this.chord || CHORDS.Apow;
        this._brass(t, hz(ch.bass), 0.18, 0.26 * g, { bright: 8, attack: 0.008, dest: S });
        this._brass(t + 0.16, hz(ch.bass + 7), 0.34, 0.30 * g, { bright: 9, attack: 0.01, dest: S });
        this._drum(t, 82, 0.3, 0.24 * g, S);
        return 0.55;
      }
      /* A WAVE ARRIVING. A rising swell under a drum figure that accelerates
       * into the downbeat — the oldest way there is of saying "here it comes",
       * and the beat this game used to answer with a 180 → 90 Hz menu blip. */
      case 'wave': {
        const ch = CHORDS.Apow;
        this._brass(t, hz(ch.bass), 1.5, 0.34 * g, { bright: 3.2, attack: 0.9, dest: S });
        this._brass(t, hz(ch.bass + 7), 1.5, 0.24 * g, { bright: 3.4, attack: 1.0, dest: S });
        // four drums, each closer to the next than the last
        let at = t + 0.28, gap = 0.34;
        for (let i = 0; i < 4; i++) { this._drum(at, 60, 0.5, (0.24 + i * 0.07) * g, S); at += gap; gap *= 0.72; }
        this._drum(at + 0.06, 52, 0.9, 0.52 * g, S);
        return 1.7;
      }
      /* A WAVE CLEARED. A cadence — bVII to i, the one resolution A aeolian
       * has — with the room letting go under it. `AudioEngine.victory()` keeps
       * its own rising triad on top of this; the two were written a year apart
       * and are in the same key because there has only ever been one key.
       *
       * BARE FIFTHS, and that is not laziness. The triad above it is A MAJOR
       * and this is in A minor's aeolian, so a bVII voiced with its own third
       * (B) would sit a semitone off the C# arriving over it. G+D and A+E have
       * no third to disagree with anything. */
      case 'clear': {
        this._brass(t, hz(-2), 0.5, 0.26 * g, { bright: 4, attack: 0.05, dest: S });
        this._brass(t, hz(5), 0.5, 0.18 * g, { bright: 4, attack: 0.05, dest: S });
        this._brass(t + 0.42, hz(0), 1.8, 0.30 * g, { bright: 3.6, attack: 0.08, dest: S });
        this._brass(t + 0.42, hz(19), 1.8, 0.16 * g, { bright: 3.8, attack: 0.12, dest: S });
        this._drum(t + 0.42, 58, 1.0, 0.3 * g, S);
        return 2.2;
      }
      /* A BOSS. The half-step, played as a half-step: the tonic and its bII
       * struck together low, then a rip up to the tritone. Nothing else in the
       * score is allowed to do this. */
      case 'boss': {
        this._drum(t, 46, 1.4, 0.62 * g, S);
        this._brass(t, hz(0), 2.4, 0.34 * g, { bright: 3.0, attack: 0.16, dest: S });
        this._brass(t + 0.06, hz(1), 2.3, 0.30 * g, { bright: 3.0, attack: 0.2, dest: S });
        this._brass(t + 0.75, hz(6), 1.6, 0.26 * g, { bright: 6.5, attack: 0.5, dest: S });
        this._brass(t + 0.75, hz(18), 1.5, 0.14 * g, { bright: 6.0, attack: 0.55, dest: S });
        this._rattle(t + 0.55, 0.2 * g, S);
        this._drum(t + 1.6, 44, 1.6, 0.5 * g, S);
        return 2.6;
      }
      /* VICTORY — the campaign, not a wave. The only full fanfare in the game,
       * and the only place three brass notes are allowed to be a tune: V of the
       * major, up to the tonic, held. */
      case 'triumph': {
        /* [semitone, when, length, level] — E, A, C#, E, the major arpeggio
         * `AudioEngine.victory()` has resolved on since it was written. */
        const line = [[7, 0, 0.30, 0.30], [12, 0.30, 0.28, 0.55],
          [16, 0.56, 0.30, 0.28], [19, 0.84, 2.6, 0.34]];
        for (const [semi, at, dur, lvl] of line) {
          this._brass(t + at, hz(semi), dur, lvl * g, { bright: 6.5, attack: 0.02, dest: S });
        }
        this._brass(t + 0.84, hz(0), 3.0, 0.30 * g, { bright: 3.2, attack: 0.1, dest: S });
        this._brass(t + 0.84, hz(28), 2.8, 0.13 * g, { bright: 5.0, attack: 0.35, dest: S });
        this._drum(t, 58, 0.7, 0.4 * g, S);
        this._drum(t + 0.84, 52, 1.6, 0.5 * g, S);
        return 3.4;
      }
      /* YOUR DEATH. The score does not play a chord over a corpse: it drops the
       * bass a tritone and lets the fifth hang, which is the sound of the
       * harmony failing rather than of a sad ending. */
      case 'fall': {
        this._brass(t, hz(0), 1.2, 0.30 * g, { bright: 2.6, attack: 0.05, dest: S });
        this._brass(t + 0.55, hz(-6), 3.2, 0.26 * g, { bright: 2.2, attack: 0.4, dest: S });
        this._brass(t + 0.55, hz(7), 3.0, 0.12 * g, { bright: 2.4, attack: 0.9, dest: S });
        this._drum(t, 42, 1.6, 0.36 * g, S);
        return 3.4;
      }
      default: this.stats.stingers--; return 0;
    }
  }

  /**
   * PULL THE BED DOWN UNDER A STINGER.
   *
   * The gesture and the bed are in the same key on the same instruments, so
   * without this a fanfare arrives as the bed getting thicker rather than as
   * something happening. Only ever deeper, like the engine's own music duck,
   * and it reports what it COMMANDED because a param under a scheduled ramp
   * cannot be read back.
   */
  duckBed(level, seconds) {
    const t = this.ctx.currentTime;
    const l = clamp(num(level, 0.5), 0, 1);
    const d = clamp(num(seconds, 1), 0.05, 12);
    if (t < this._bedDuckUntil && l >= this._bedDuckAt && t + d <= this._bedDuckUntil) return false;
    try {
      this.bed.gain.cancelScheduledValues(t);
      this.bed.gain.setTargetAtTime(Math.max(0.0001, l), t, 0.07);
      this.bed.gain.setTargetAtTime(1, t + d, 0.45);
    } catch { return false; }
    this._bedDuckAt = l;
    this._bedDuckUntil = t + d;
    return true;
  }

  /** How far the bed is being HELD under a stinger right now. */
  bedLevel() {
    return this.ctx && this.ctx.currentTime < this._bedDuckUntil ? this._bedDuckAt : 1;
  }

  /* ── switching on and off ───────────────────────────────────────────── */

  /** The bed. See the two switches on the constructor. */
  enable(on) {
    const want = !!on;
    if (want === this.enabled) return this.enabled;
    this.enabled = want;
    if (want) {
      this._nextBar = this.ctx.currentTime + 0.05;
      this.state = 'off';
      this._want = 'off';
      this.setState(this._derive(0));
      this._pump();
    } else {
      this._rampLayers('off', XFADE_DEATH);
      this.state = 'off'; this._want = 'off';
    }
    return this.enabled;
  }

  /** Anything at all — the stingers, with or without the bed under them. */
  arm(on) {
    const want = !!on;
    if (want === this.armed) return this.armed;
    this.armed = want;
    this._rampLayers(this._want, XFADE_DEATH);
    return this.armed;
  }

  /**
   * A new level, or a new run. Forget everything the last one latched.
   *
   * `_coldFor` goes to the full fall hold rather than to zero: a level ending
   * is not "the fight might come back", it is "there is no fight", and starting
   * the hysteresis at zero is what would keep the combat cue alive across a
   * quit to the menu for five more seconds.
   */
  reset() {
    this.wave = 0; this.waveActive = false; this.boss = false;
    this.dead = false; this.won = false;
    this._hotFor = 0; this._coldFor = FALL_HOLD; this.intensity = 0;
    this.bar = 0;
    if (this.enabled) this.setState('explore');
  }

  /** Every oscillator this file started, stopped. */
  dispose() {
    this.enabled = false;
    if (this._retry) { clearTimeout(this._retry); this._retry = 0; }
    const osc = [...this.lowOsc, ...this.stringOsc, ...this.airOsc].map(x => x.o);
    for (const n of [this.bus, this.comp, this.bed, this.cue, this.brassLP, this.stringBP,
      ...Object.values(this.layers)]) {
      try { n.disconnect(); } catch {}
    }
    for (const o of [...osc, this._stringLfo, this._airVib]) { try { o.stop(); } catch {} }
  }
}
