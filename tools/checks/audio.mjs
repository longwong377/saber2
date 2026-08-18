/**
 * BATTLEFRONT BORZ — can the game still be heard?
 *
 * "The sound is really buggy and totally silent in most situations, comes in
 * and out." Twice now this file has been declared fixed by reading it, and
 * twice the game has gone quiet again, so these checks are deliberately not
 * about the shape of the code. They drive the real AudioEngine against a fake
 * WebAudio that behaves like the real one where it matters — every AudioParam
 * rejects a non-finite value with a TypeError, an exponential ramp to zero is a
 * RangeError, a source fires `ended` on the audio clock and not on the wall
 * clock, and a suspended context refuses to resume without a gesture — and then
 * assert on numbers.
 *
 * What actually went wrong, measured with tools/audiowatch.mjs on a real
 * session: 94% of every voice request in the game was a footstep, the pool of
 * 44 sat completely full for nine seconds at a time, and the requests that
 * arrived in that window were dropped on the floor — bolt impacts, blaster
 * shots and deflections among them. Nothing threw. Nothing leaked. No gain was
 * zero. The only way to see it was to count.
 */

import * as THREE from 'three';
import { AudioEngine, PRIO, MUSIC_TRACKS } from '../../src/engine/Audio.js';
import { ENEMY_VOICES } from '../../src/engine/Voice.js';
import { SCORE_STATES, CHORDS, ROOT, hz } from '../../src/engine/Score.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── a WebAudio that is as unforgiving as the browser's ─────────────── */

const chk = (v) => {
  if (!Number.isFinite(v)) throw new TypeError('The provided float value is non-finite.');
  return v;
};

/**
 * Every call is kept, because a param under a scheduled ramp does not report
 * where it is going: `.value` is where it was when the ramp was set. The score
 * and the ambience bed are BOTH nothing but scheduled ramps, so a check that
 * read `.value` on them would measure the level a level loaded at and call it
 * the level a fight reached. `last()` is what was commanded, in order.
 */
class Param {
  constructor(v = 0) { this._v = v; this.calls = []; }
  get value() { return this._v; }
  set value(v) { this._v = chk(v); this.calls.push(['value', v, 0]); }
  setValueAtTime(v, t) { chk(v); chk(t); this.calls.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { chk(v); chk(t); this.calls.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) {
    chk(v); chk(t);
    // The real node throws here, and this file used to reach it with a zero.
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime: target must not be 0');
    this.calls.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, tc) { chk(v); chk(t); chk(tc); this.calls.push(['tgt', v, t]); return this; }
  cancelScheduledValues(t) { chk(t); this.calls.push(['cancel', 0, t]); return this; }
  /** The last value this param was COMMANDED to move to, of a kind or any. */
  last(kind) {
    for (let i = this.calls.length - 1; i >= 0; i--) if (!kind || this.calls[i][0] === kind) return this.calls[i][1];
    return null;
  }
  /** How many times it was told to move at all. A ramp per frame arrives nowhere. */
  moves() { return this.calls.filter(c => c[0] !== 'cancel' && c[0] !== 'value').length; }
}

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = new Set(); }
  connect(d) { this.outs.add(d); this.ctx.connects++; this.ctx.edges.push([this, d]); return d; }
  disconnect(d) {
    this.ctx.disconnected.push(this);
    if (d) this.outs.delete(d); else this.outs.clear();
  }
}

class Src extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.onended = null; this._started = false; }
  start(when = 0) {
    chk(when);
    if (when < 0) throw new RangeError('start time must not be negative');
    this._started = true;
  }
  stop(when = 0) {
    chk(when);
    if (!this._started) throw new Error('stop called before start');
    this._stopAt = when;
    this.ctx.running.push(this);
  }
}

class FakeCtx {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = 'running';
    this.connects = 0;
    this.edges = [];          // [from, to] — the graph as it was actually wired
    this.disconnected = [];
    this.running = [];        // sources with a scheduled stop, awaiting `ended`
    this.panners = 0;
    this.resumeCalls = 0;
    this.allowResume = true;
    this.destination = new Node(this, 'destination');
    this.listener = {
      positionX: new Param(), positionY: new Param(), positionZ: new Param(),
      forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(),
      upX: new Param(), upY: new Param(), upZ: new Param(),
    };
  }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createBiquadFilter() {
    const n = new Node(this, 'biquad');
    n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.detune = new Param(0);
    return n;
  }
  createDynamicsCompressor() {
    const n = new Node(this, 'comp');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    n.reduction = 0;
    return n;
  }
  createConvolver() { const n = new Node(this, 'convolver'); n.buffer = null; n.normalize = true; return n; }
  createPanner() {
    this.panners++;
    const n = new Node(this, 'panner');
    n.panningModel = 'equalpower'; n.distanceModel = 'inverse';
    n.refDistance = 1; n.maxDistance = 10000; n.rolloffFactor = 1;
    n.positionX = new Param(); n.positionY = new Param(); n.positionZ = new Param();
    // Kept so a check can ask what the game DECIDED about distance rather than
    // recomputing it: the curve a sound is played on is set by its caller, and
    // speech does not use the same one as the rest of the game.
    this.lastPanner = n;
    return n;
  }
  createOscillator() {
    const n = new Src(this, 'osc');
    n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0);
    return n;
  }
  createBufferSource() {
    const n = new Src(this, 'bufsrc');
    n.buffer = null; n.loop = false; n.playbackRate = new Param(1);
    return n;
  }
  createBuffer(channels, length, rate) {
    chk(length); chk(rate);
    const data = [];
    for (let i = 0; i < channels; i++) data.push(new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate,
      duration: length / rate, getChannelData: (i) => data[i] };
  }
  /** The score is the one sound in the game that is not built from these. */
  createMediaElementSource(el) { const n = new Node(this, 'media'); n.mediaElement = el; return n; }
  /** Move the audio clock and fire `ended` for everything that has finished. */
  advance(dt) {
    this.currentTime += dt;
    const still = [];
    for (const s of this.running) {
      if (s._stopAt <= this.currentTime) { try { s.onended?.(); } catch {} }
      else still.push(s);
    }
    this.running = still;
  }
  resume() {
    this.resumeCalls++;
    // A browser that has not seen a gesture rejects this and stays suspended,
    // which is the whole reason the engine has to cope with being stopped.
    if (this.allowResume) this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

/**
 * A fully initialised engine on a fake context.
 *
 * Exported because tools/checks/music.mjs drives the same engine — the score is
 * the one sound in the game that arrives as a file, and it still has to be
 * measured on the same graph as everything else rather than against a second
 * fake that could drift away from this one.
 */
export function engine() {
  const prevAC = globalThis.AudioContext;
  let made = null;
  globalThis.AudioContext = function () { made = new FakeCtx(); return made; };
  const a = new AudioEngine();
  try { a.init(); } finally { globalThis.AudioContext = prevAC; }
  a._listenerPos.set(0, 0, 0);
  // resume() rate-limits itself off the wall clock; start every test past it.
  a._lastWake = -1e9;
  return { a, ctx: made };
}

export async function run({ check, assert }) {

  check('audio: the engine comes up with a live graph and a full master', () => {
    const { a, ctx } = engine();
    assert(a.ready, 'init() did not finish — every sound in the game is a no-op');
    assert(a.master.gain.value === 0.8, `master is at ${a.master.gain.value}`);
    assert(a.sfxBus.gain.value === 1 && a.ambBus.gain.value === 1,
      `a bus came up muted: sfx ${a.sfxBus.gain.value}, amb ${a.ambBus.gain.value}`);
    assert(a.master.outs.has(ctx.destination), 'master never reached the destination');
    assert(ctx.disconnected.length === 0, 'init() disconnected something');
    return `${ctx.connects} edges, master ${a.master.gain.value}, sfx ${a.sfxBus.gain.value}`;
  });

  check('audio: a NaN volume setting cannot mute the game for good', () => {
    // A stored setting is whatever is in localStorage. master.gain.value = NaN
    // throws inside init(), which leaves ctx set and `ready` false, and every
    // later init() returns early on the ctx it already has. Permanent silence,
    // nothing in the console.
    const prevAC = globalThis.AudioContext;
    globalThis.AudioContext = function () { return new FakeCtx(); };
    const a = new AudioEngine();
    a.setVolume(undefined); a.setMusicVolume(NaN);
    try { a.init(); } finally { globalThis.AudioContext = prevAC; }
    assert(a.ready, 'a NaN volume killed init() — the whole session is silent');
    assert(Number.isFinite(a.master.gain.value) && a.master.gain.value > 0,
      `master came up at ${a.master.gain.value}`);
    assert(Number.isFinite(a.musicBus.gain.value), `musicBus came up at ${a.musicBus.gain.value}`);
    return `volume NaN → ${a.master.gain.value}, music NaN → ${a.musicBus.gain.value}`;
  });

  check('audio: the voice bands reserve real room above the chatter', () => {
    const { a } = engine();
    const caps = [PRIO.chatter, PRIO.world, PRIO.combat, PRIO.critical].map(p => a.bandCap(p));
    for (let i = 1; i < caps.length; i++) {
      assert(caps[i] > caps[i - 1], `band ${i} (${caps[i]}) does not sit above band ${i - 1} (${caps[i - 1]})`);
    }
    assert(caps[3] === a.maxVoices, `the top band is ${caps[3]} of ${a.maxVoices} — it must be the whole pool`);
    // A clash costs three voices and a deflection up to three. Whatever the
    // chatter is doing, there has to be room for several of them.
    const reserve = a.maxVoices - caps[0];
    assert(reserve >= 12, `only ${reserve} voices are held back from chatter — four clashes is 12`);
    return `caps ${caps.join('/')} of ${a.maxVoices}, ${reserve} reserved above chatter`;
  });

  check('audio: a storm of footsteps cannot silence a clash', () => {
    const { a } = engine();
    const near = V(2, 0, 0);
    // 400 footsteps on a single timestamp: worse than the 143/s the game
    // actually produces, and the pool must still not be theirs to fill.
    for (let i = 0; i < 400; i++) a.step(near, 'sand');
    const chatter = a.voices;
    assert(chatter <= a.bandCap(PRIO.chatter),
      `footsteps took ${chatter} of ${a.maxVoices} voices — the band cap is ${a.bandCap(PRIO.chatter)}`);

    const before = a.voices;
    a.clash(near, 1);
    assert(a.voices - before === 3, `the clash got ${a.voices - before} of its 3 voices`);
    const afterClash = a.voices;
    a.deflect(near, 3);
    assert(a.voices - afterClash === 3, `the deflection got ${a.voices - afterClash} of its 3 voices`);
    const afterDeflect = a.voices;
    a.ui('click');
    assert(a.voices - afterDeflect === 1, 'a menu blip was refused');
    return `400 footsteps held ${chatter}/${a.maxVoices}; clash, deflect and UI all still played`;
  });

  check('audio: the pool drains back to empty over a long fight', () => {
    const { a, ctx } = engine();
    const near = V(3, 1, 0);
    for (let f = 0; f < 1800; f++) {           // 30 s at 60 Hz
      for (let k = 0; k < 2; k++) a.step(near, 'sand');
      if (f % 7 === 0) a.blaster(near, false);
      if (f % 11 === 0) a.boltHit(near);
      if (f % 23 === 0) a.clash(near, 1);
      if (f % 97 === 0) a.explosion(near, 1);
      ctx.advance(1 / 60);
    }
    const mid = a.voices;
    ctx.advance(5);                            // let everything in flight finish
    assert(a.voices === 0, `${a.voices} of ${a.maxVoices} voices never came back — the game goes mute`);
    assert(a.stats.alloc === a.stats.freed,
      `allocated ${a.stats.alloc} but freed ${a.stats.freed} — ${a.stats.alloc - a.stats.freed} stranded`);
    assert(a.stats.threw === 0, `${a.stats.threw} voices threw mid-build`);
    return `${a.stats.alloc} voices over 30 s, ${mid} live at the end of the fight, 0 after it`;
  });

  check('audio: a refused sound does not leave a panner on the effects bus', () => {
    const { a, ctx } = engine();
    const near = V(2, 0, 0);
    const p0 = ctx.panners;
    const v0 = a.stats.alloc;
    for (let i = 0; i < 400; i++) a.step(near, 'sand');
    const built = ctx.panners - p0, took = a.stats.alloc - v0;
    assert(built === took,
      `${built} panners were built for ${took} voices — ${built - took} are orphaned on sfxBus forever`);
    assert(a.stats.denied > 0, 'the pool was never actually saturated, so this proves nothing');
    return `${a.stats.denied} refusals, ${built} panners for ${took} voices`;
  });

  check('audio: a sound too far away to hear is not worth a voice', () => {
    const { a, ctx } = engine();
    const p0 = ctx.panners;
    // At 80 m the inverse law leaves 2.05% of a source's amplitude, so a 0.09
    // footstep arrives at 0.0018 — under the 0.013 RMS the empty room already
    // makes on its own — while a 0.5 detonation still lands at 0.0103 and
    // belongs in the mix. The old flat 190 m cull gave both the same range.
    a.step(V(80, 0, 0), 'sand');
    assert(a.voices === 0, 'a footstep 80 m away took a voice');
    assert(ctx.panners === p0, 'a footstep 80 m away built a panner');
    a.explosion(V(80, 0, 0), 1);
    assert(a.voices === 3, `the distant explosion got ${a.voices} of its 3 voices`);

    // and near sounds are untouched
    const { a: b } = engine();
    b.step(V(2, 0, 0), 'sand');
    assert(b.voices === 1, 'a footstep two metres away was culled');
    return `footstep culled at 80 m, explosion kept, footstep at 2 m kept`;
  });

  check('audio: a voice is judged on the curve it is actually built on', () => {
    /**
     * `_reach` decides whether a sound is worth a voice by predicting the
     * amplitude it will arrive at, BEFORE any node exists. That prediction and
     * the panner it predicts are two expressions of one law, which is HANDOFF
     * §2.3's shape exactly — and they had drifted: `attenuation` was hard-wired
     * to refDistance 1.8 under a docstring claiming "_panner() builds every
     * positional voice with the same refDistance 1.8", while `speak()` alone
     * builds its panner at 2.6. Measured at 40 m: 0.0411 predicted against
     * 0.0594 delivered, 45% under the truth, in the direction that culls a line
     * the player would have heard.
     *
     * Rather than restate the law a third time, this drives BOTH halves and
     * compares them: every positional sound in the game is played at a series
     * of distances against a listener at the origin, and the panner each one
     * actually built is read back out of the context and asked what it will do.
     */
    const { a, ctx } = engine();
    const law = (p, d) => {
      const dd = Math.max(Math.min(d, p.maxDistance), p.refDistance);
      return p.refDistance / (p.refDistance + p.rolloffFactor * (dd - p.refDistance));
    };
    const rows = [];
    for (const d of [2, 20, 60, 120, 185]) {
      // Let the previous line finish. Three live utterances is the engine's own
      // ceiling, so a loop that does not advance the clock measures the
      // concurrency cap and reports it as a distance cull.
      ctx.advance(3);
      const before = ctx.panners;
      a.speak(ENEMY_VOICES.sith, 'scream', { pos: V(d, 0, 0), gain: 0.9 });
      const p = ctx.lastPanner;
      assert(ctx.panners > before, `a scream ${d} m away built no panner at all`);
      // What the cull believed, recomputed through the SHIPPED predicate: if it
      // had thought this inaudible it would have refused before building one.
      assert(a._reach(V(d, 0, 0), 1.7 * 0.9, p.refDistance, p.maxDistance) === 2,
        `_reach called a scream at ${d} m inaudible while speak() built it anyway`);
      rows.push(`${d}m ${(law(p, d) * 1.55).toFixed(3)}`);
    }
    // …and the two curves are genuinely different, so the check has a subject.
    const voice = ctx.lastPanner;
    ctx.advance(3);
    const n0 = ctx.panners;
    a.blaster(V(20, 0, 0));
    assert(ctx.panners > n0, 'the blaster built no panner');
    const world = ctx.lastPanner;
    assert(voice.refDistance !== world.refDistance,
      'a voice and a one-shot are on the same curve now — this check has nothing to hold apart');

    /**
     * AND THE MIX, WHICH IS THE OTHER HALF OF THE SAME QUESTION: is a voice
     * buried under the fight? Both sounds are driven at the same distance and
     * their own gains are read off the calls they made, so this is the shipped
     * blaster against the shipped scream and not two numbers typed here.
     */
    const gains = { blaster: 0, scream: 1.55 };
    const spy = Object.create(a.constructor.prototype);
    spy._listenerPos = a._listenerPos;
    spy.ready = false;
    spy.tone = ({ gain = 0 }) => { gains.blaster += gain; };
    spy.noise = ({ gain = 0 }) => { gains.blaster += gain; };
    a.constructor.prototype.blaster.call(spy, V(20, 0, 0));
    const heardBolt = gains.blaster * law(world, 20);
    const heardCry = gains.scream * 0.9 * law(voice, 20);
    assert(heardCry > heardBolt * 3,
      `a scream at 20 m arrives at ${heardCry.toFixed(4)} against a blaster bolt's `
      + `${heardBolt.toFixed(4)} — the room is louder than the people in it`);
    return `${rows.join(' ')}; a 20 m scream is ${(heardCry / heardBolt).toFixed(1)}x a 20 m bolt `
      + `(voice ref ${voice.refDistance}/${voice.maxDistance}, world ref ${world.refDistance}/${world.maxDistance})`;
  });

  check('audio: a stopped context is not fed sounds it cannot play', () => {
    const { a, ctx } = engine();
    ctx.allowResume = false;                   // a browser with no gesture yet
    ctx.state = 'suspended';
    const t = ctx.currentTime;
    const near = V(2, 0, 0);
    for (let i = 0; i < 200; i++) { a.clash(near, 1); a.step(near, 'sand'); }
    assert(a.voices === 0,
      `${a.voices} voices were taken while the context was stopped — none of them can ever fire 'ended'`);
    assert(ctx.currentTime === t, 'the fake clock moved; this test is not measuring what it thinks');
    assert(ctx.resumeCalls > 0, 'nothing ever asked the context to come back — that is the permanent mute');
    assert(a.stats.dropped >= 200, `only ${a.stats.dropped} sounds were dropped out of 800 scheduled`);

    // and it plays again the moment the context does
    ctx.allowResume = true;
    a._lastWake = -1e9;
    a.resume();
    assert(ctx.state === 'running', 'resume() did not restart the context');
    a.clash(near, 1);
    assert(a.voices === 3, `after resuming, the clash got ${a.voices} of its 3 voices`);
    return `800 sounds dropped while suspended, ${ctx.resumeCalls} resume attempts, full voices after`;
  });

  check('audio: a throw mid-build releases the voice and its panner', () => {
    const { a, ctx } = engine();
    const near = V(2, 0, 0);
    const p0 = ctx.panners, d0 = ctx.disconnected.length;
    const realGain = ctx.createGain.bind(ctx);
    ctx.createGain = () => { throw new TypeError('the browser said no'); };
    for (let i = 0; i < 60; i++) { a.clash(near, 1); a.blaster(near, true); }
    ctx.createGain = realGain;
    assert(a.voices === 0, `${a.voices} voices leaked through a throw — 44 of these and the game is mute`);
    assert(a.stats.threw > 0, 'nothing actually threw, so this proves nothing');
    const built = ctx.panners - p0, freed = ctx.disconnected.length - d0;
    assert(freed >= built, `${built} panners were built and only ${freed} disconnected`);
    // and the engine is still usable afterwards
    a.clash(near, 1);
    assert(a.voices === 3, `the engine did not recover: ${a.voices} of 3 voices`);
    return `${a.stats.threw} throws, 0 voices leaked, ${freed} panners released, engine still plays`;
  });

  check('audio: retiring a voice never disconnects a shared bus', () => {
    const { a, ctx } = engine();
    const shared = new Set([a.sfxBus, a.musicBus, a.master, a.ambBus, a.comp]);
    // Non-positional sounds route straight to sfxBus. Calling disconnect() on
    // that unplugs every sound in the game from the compressor, permanently.
    for (let f = 0; f < 600; f++) {
      a.ui(['hover', 'click', 'good', 'bad'][f & 3]);
      a.force(null, 'sense');
      ctx.advance(1 / 60);
    }
    ctx.advance(5);
    const bad = ctx.disconnected.filter(n => shared.has(n));
    assert(bad.length === 0, `${bad.length} shared buses were torn down (${bad.map(n => n.kind).join(', ')})`);
    assert(a.voices === 0, `${a.voices} voices leaked from non-positional sounds`);
    /* REACHABILITY, not one named edge. This used to assert
     * `a.sfxBus.outs.has(a.comp)`, which is a statement about the shape of the
     * graph rather than about the question — "can a sound still get out" — and
     * it went red the day a filter was inserted between the two on a change
     * that had made the game LOUDER. HANDOFF §2.4: an instrument that restates
     * a rule eventually disagrees with it. */
    const reaches = (from, to) => {
      const seen = new Set(), q = [from];
      while (q.length) {
        const n = q.pop();
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const o of n.outs) q.push(o);
      }
      return false;
    };
    assert(reaches(a.master, ctx.destination), 'the master no longer reaches the destination');
    assert(reaches(a.sfxBus, a.comp), 'the graph came apart: sfx no longer reaches the compressor');
    assert(reaches(a.sfxBus, ctx.destination), 'a sound on the effects bus cannot leave the machine');
    return `${a.stats.alloc} bus-routed voices, 0 bus disconnects, sfx→comp→destination intact`;
  });

  check('audio: a hum is an instrument, not a voice, and disposes cleanly', () => {
    const { a, ctx } = engine();
    const v0 = a.voices;
    const hums = [];
    for (let i = 0; i < 10; i++) { const h = a.createHum(0x57c9ff); h.ignite(); hums.push(h); }
    assert(a.voices === v0, `${a.voices - v0} one-shot voices were spent on hums`);
    for (const h of hums) { h.set(18, 0.4); h.move(V(1, 1, 1)); }
    const d0 = ctx.disconnected.length;
    for (const h of hums) h.dispose();
    // panner, hp, lp, bus, nsG, nsF, lfoG and five osc gains = 12 per hum
    assert(ctx.disconnected.length - d0 >= 10 * 12,
      `only ${ctx.disconnected.length - d0} nodes released for 10 hums — a hum stays audible forever`);
    assert(a.voices === v0, 'disposing a hum moved the one-shot pool');
    return `10 hums, 0 pool voices, ${ctx.disconnected.length - d0} nodes released on dispose`;
  });

  /**
   * THE SCORE, and what this check used to be — TWICE.
   *
   * Round one asserted that the voice pool was untouched and that `intensity`
   * had smoothed above 0.9. Neither of those is a sound: `intensity` is
   * smoothed before the pulse block and the pulse takes no voices by design, so
   * — measured — deleting the whole pulse and leaving the smoothing line kept
   * both assertions green. The one test of the game's musical reaction to
   * combat could not tell the feature from its total absence.
   *
   * Round two fixed that by counting sources arriving on the music bus against
   * `bpm = 74 + 46 × I`. It was a real measurement of a real thing, and the
   * thing is gone: that pulse was the entire adaptive layer, one sine sweeping
   * 74 → 38 Hz, and it has been replaced by src/engine/Score.js.
   *
   * So this measures the replacement, and it reads the TABLE for what to
   * expect rather than restating any of it (HANDOFF §2.4): the bar length comes
   * out of `SCORE_STATES[state].bpm` and the number of events per bar out of
   * that state's own ostinato and drum grids. Retune a state and this check
   * measures the new tuning; delete a state's rhythm and it fails.
   */
  check('audio: the score is a different piece of music in each state', () => {
    /** Drive an engine into `state` and count what one bar actually builds. */
    const play = (state, drive, secs) => {
      const { a, ctx } = engine();
      a.setMusicState({ state });                      // the seam, explicitly
      const step = () => { a.updateScore(1 / 60, drive, 0); ctx.advance(1 / 60); };
      for (let f = 0; f < 180; f++) step();             // let the grid take hold
      const e0 = ctx.edges.length, b0 = a.score.stats.bars, n0 = a.score.stats.notes;
      for (let f = 0; f < Math.round(secs * 60); f++) step();
      const fresh = ctx.edges.slice(e0);
      const into = (g) => fresh.filter(([, d]) => d === g).length;
      return { a, ctx, bars: a.score.stats.bars - b0, notes: a.score.stats.notes - n0,
        ost: into(a.score.layers.ost), perc: into(a.score.layers.perc),
        gain: Object.fromEntries(Object.entries(a.score.layers)
          .map(([k, g]) => [k, g.gain.last('tgt') ?? g.gain.value])) };
    };

    const SECS = 24;
    const rows = [];
    for (const state of ['explore', 'combat', 'boss', 'victory']) {
      const cfg = SCORE_STATES[state];
      const bar = 4 * 60 / cfg.bpm;
      const r = play(state, state === 'explore' ? 0 : 1, SECS);
      // The bar clock is the table's, within one bar of rounding at each end.
      const want = SECS / bar;
      assert(Math.abs(r.bars - want) <= 1.2,
        `${state} played ${r.bars} bars in ${SECS} s and ${cfg.bpm} bpm in 4/4 says ${want.toFixed(1)}`);
      // …and each bar built exactly what that state's own grid asks for.
      const perBar = cfg.ost.filter(Boolean).length
        + cfg.taiko.filter(x => x > 0).length + cfg.rattle.filter(x => x > 0).length;
      assert(Math.abs(r.notes / Math.max(1, r.bars) - perBar) < 0.35,
        `${state} averaged ${(r.notes / r.bars).toFixed(2)} notes a bar; its grid has ${perBar}`);
      rows.push({ state, cfg, ...r, bar, perBar });
    }
    const by = Object.fromEntries(rows.map(r => [r.state, r]));

    /* THE FOUR ARE NOT ONE CUE PLAYED LOUDER. */
    assert(by.explore.notes === 0,
      `${by.explore.notes} rhythm-section notes played between waves — explore has no drums`);
    assert(by.combat.notes > 20, `a wave built ${by.combat.notes} notes in ${SECS} s`);
    assert(by.boss.bars > by.combat.bars,
      `a boss (${by.boss.bars} bars) is no faster than a wave (${by.combat.bars})`);
    assert(by.boss.perc / by.boss.bars > by.combat.perc / by.combat.bars,
      `a boss is not louder in the kit than a wave: ${(by.boss.perc / by.boss.bars).toFixed(1)} `
      + `vs ${(by.combat.perc / by.combat.bars).toFixed(1)} drum sources a bar`);
    assert(by.victory.ost === 0 && by.combat.ost > 0,
      'victory plays the combat ostinato — the win sounds like the fight it ended');
    assert(by.boss.gain.air > by.combat.gain.air * 2,
      `the high line is not a boss's: ${by.boss.gain.air} vs ${by.combat.gain.air}`);

    /* …and none of it costs a one-shot voice. That was true of the old pulse
     * and it has to stay true: the score must never be refused because the room
     * is busy, and a footstep must never be refused because the score is. */
    for (const r of rows) {
      assert(r.a.voices === 0, `${r.state} took ${r.a.voices} voices from the one-shot pool`);
      assert(r.a.stats.denied === 0, `${r.state} caused ${r.a.stats.denied} refusals`);
    }
    return rows.map(r => `${r.state} ${r.cfg.bpm}bpm ${r.bars}bars `
      + `${(r.notes / Math.max(1, r.bars)).toFixed(1)}/bar`).join(', ')
      + `; pool untouched`;
  });

  /**
   * IT IS ONE PIECE OF MUSIC AND NOT FIVE, and that is measured as a KEY.
   *
   * The room has been in A since Audio.js was written — the ambience drone is
   * [55, 82.4, 110, 164.8, 220] Hz and `victory()` resolves on A major — so a
   * generated score in anything else would be a second piece of music playing
   * through the same speaker. This walks every chord in the table and every
   * state's progression and asserts they all belong to one root, and that the
   * modes differ in the way the table says they do.
   */
  check('audio: every state of the score is in the same key', () => {
    const semis = new Set();
    for (const [k, c] of Object.entries(CHORDS)) {
      const all = [c.bass, ...c.tones];
      for (const s of all) {
        assert(Number.isInteger(s), `${k} has a non-integer degree ${s}`);
        semis.add(((s % 12) + 12) % 12);
      }
      // Everything sits where an oscillator bank can be brass rather than a
      // synthesiser: the bass between 38 and 90 Hz, the voicing above it.
      const f = hz(c.bass);
      assert(f > 36 && f < 95, `${k}'s bass is ${f.toFixed(1)} Hz — outside the low-brass register`);
      assert(c.tones.every(t => t > c.bass), `${k} voices a tone under its own bass`);
    }
    // A is the root of the room and of this table.
    assert(hz(0) === ROOT && ROOT === 55, `the root moved to ${ROOT} Hz`);

    /* The modes are DIFFERENT, and specifically: only victory has a major
     * third, and only the phrygian states have the flat second. Both are read
     * off the progressions rather than off the mode NAME, because the name is a
     * label and the chords are the music. */
    const pcs = (state) => {
      const out = new Set();
      for (const name of SCORE_STATES[state].prog) {
        const c = CHORDS[name];
        assert(c, `${state} names a chord '${name}' that does not exist`);
        for (const s of [c.bass, ...c.tones]) out.add(((s % 12) + 12) % 12);
      }
      return out;
    };
    const explore = pcs('explore'), combat = pcs('combat'), boss = pcs('boss'), vic = pcs('victory');
    assert(!explore.has(1) && combat.has(1),
      'the flat second is not what separates a wave from the lull before it');
    assert(boss.has(6), 'the boss progression has no tritone from the pedal');
    assert(!combat.has(6), 'an ordinary wave already has the tritone, so a boss has nothing left');
    assert(vic.has(4), 'victory has no major third — it is the only state that is allowed one');
    for (const [n, s] of [['explore', explore], ['combat', combat], ['boss', boss]]) {
      assert(!s.has(4), `${n} has a major third in it`);
    }
    return `root A${ROOT} Hz; ${Object.keys(CHORDS).length} chords over `
      + `${semis.size} pitch classes; bII in combat+boss, bV in boss, major third only in victory`;
  });

  /**
   * THE FIVE MOMENTS, AND THEY HAVE TO BE FIVE DIFFERENT SOUNDS.
   *
   * A wave arriving was `ui('wave')` — a 180 → 90 Hz sine, one oscillator. A
   * wave cleared and a death have real sounds and are not touched here. A boss
   * entrance and a WON CAMPAIGN — the one completable thing in this game — had
   * nothing at all.
   *
   * Each is fired on a fresh engine from the call the GAME makes (not from
   * `stinger()` directly), and what it built is counted: how many notes, on
   * which layers, over how long, and how far it pushed the music down.
   */
  check('audio: a wave, a boss, a victory and a death are four different sounds', () => {
    const fire = (name, act) => {
      const { a, ctx } = engine();
      for (let f = 0; f < 240; f++) { a.updateScore(1 / 60, 0.6, 0); ctx.advance(1 / 60); }
      const e0 = ctx.edges.length, n0 = a.score.stats.notes, v0 = a.stats.alloc;
      const t0 = ctx.currentTime;
      act(a);
      const fresh = ctx.edges.slice(e0);
      const oscs = fresh.map(([f2]) => f2).filter(n => n.kind === 'osc');
      // When the last thing this gesture scheduled is due, relative to now.
      const span = Math.max(0, ...ctx.running.filter(s => s._stopAt > t0).map(s => s._stopAt - t0));
      const out = { a, ctx, notes: a.score.stats.notes - n0, want: a.score._want,
        // The room it made for itself: the BED under a stinger, or the whole
        // music path when the thing that fired also ducked that (death).
        duck: Math.min(a.score.bedLevel(), a.musicDuckLevel()), span, oscs,
        pitches: oscs.map(o => o.frequency.last('set') ?? o.frequency.value).filter(Boolean) };
      // `victory()` and `death()` schedule part of themselves through `_at`,
      // which is a silent oscillator on the AUDIO clock — nothing it defers has
      // happened yet at this instant, so a voice count taken here would measure
      // half of each. Let the clock run past the last of them first.
      for (let i = 0; i < 40; i++) ctx.advance(0.05);
      out.spent = a.stats.alloc - v0;
      return out;
    };
    const spec = { id: 'probe', f0: 130, cadence: 1 };
    const wave = fire('wave', a => a.ui('wave'));
    const clear = fire('clear', a => a.victory());
    const boss = fire('boss', a => a.setMusicState({ boss: true, active: true }));
    const heavy = fire('heavy', a => a.speak(spec, 'boss', { self: true }));
    const dead = fire('death', a => a.death());
    const won = fire('won', a => a.runWon(true));

    for (const [n, r] of [['wave', wave], ['clear', clear], ['boss', boss],
      ['heavy', heavy], ['death', dead], ['victory', won]]) {
      assert(r.notes > 0, `${n} built no music at all`);
      assert(r.duck < 1, `${n} did not make room for itself — the bed plays over the top of it`);
      assert(r.span > 0.25, `${n} is ${r.span.toFixed(2)} s long, which is a blip`);
    }

    /* THEY ARE NOT THE SAME GESTURE. Four different states, four different
     * lengths, and the two that must never be confused — a wave cleared and a
     * campaign won — are told apart by size. */
    assert(wave.want === 'combat', `a wave arriving put the score in '${wave.want}'`);
    assert(boss.want === 'boss', `a boss put the score in '${boss.want}'`);
    /* A HEAVY IS NOT A BOSS, and the announcer cannot tell them apart — it says
     * its 'boss' line for `e.A.boss || e.A.big`, and four archetypes carry
     * `big` from wave 1. Measured against a real World on the Colosseum, taking
     * that line as a boss put the score in `boss` on wave 1 and on every wave
     * after. So the line gets a smaller gesture, and it may not change state. */
    assert(heavy.want !== 'boss',
      'a heavy walking on put the score in the boss state — that is most waves');
    assert(heavy.span < boss.span * 0.6,
      `a heavy (${heavy.span.toFixed(2)} s) is as big a gesture as a boss `
      + `(${boss.span.toFixed(2)} s) — they would be indistinguishable`);
    assert(dead.want === 'death', `dying put the score in '${dead.want}'`);
    assert(won.want === 'victory', `winning the campaign put the score in '${won.want}'`);
    assert(clear.want === 'explore', `a wave cleared left the score in '${clear.want}'`);
    assert(won.notes > clear.notes,
      `winning a campaign (${won.notes} notes) is smaller than clearing one wave (${clear.notes})`);
    assert(won.span > 2.5 && dead.span > 2.5,
      `victory ${won.span.toFixed(1)} s / death ${dead.span.toFixed(1)} s — neither reaches the card`);

    /* A death FALLS and a victory RISES, read off the notes themselves. */
    const lows = (r) => r.pitches.filter(p => p < 400).sort((x, y) => x - y);
    assert(Math.min(...lows(dead)) < hz(0) * 0.85,
      `nothing in the death cue goes under the tonic (lowest ${Math.min(...lows(dead)).toFixed(1)} Hz)`);
    assert(Math.max(...lows(won)) > hz(0) * 1.4,
      `nothing in the victory cue rises above the tonic (highest ${Math.max(...lows(won)).toFixed(1)} Hz)`);

    /* …and the two beats that were menu beeps keep the sounds they were given.
     * `ui('bad')` and `ui('good')` must not have crept back in. */
    assert(dead.spent >= 6, `death() spent ${dead.spent} voices — it is four layers plus two heartbeats`);
    assert(clear.spent >= 6, `victory() spent ${clear.spent} voices — it is a four-note triad plus a swell`);
    assert(wave.spent >= 1, `a wave arriving spent ${wave.spent} voices — the sine under it is gone`);
    return `wave ${wave.notes}n/${wave.span.toFixed(1)}s→combat, clear ${clear.notes}n→explore, `
      + `boss ${boss.notes}n/${boss.span.toFixed(1)}s→boss, heavy ${heavy.notes}n/${heavy.span.toFixed(1)}s→`
      + `${heavy.want}, death ${dead.notes}n/${dead.span.toFixed(1)}s→death, `
      + `victory ${won.notes}n/${won.span.toFixed(1)}s→victory; ducks `
      + [wave, clear, boss, heavy, dead, won].map(r => r.duck.toFixed(2)).join('/');
  });

  /**
   * THE HARMONY ACTUALLY MOVES, and a stinger is not ducked by its own duck.
   *
   * Two things that sound the same when they are broken and are not:
   *
   *   A DRONE THAT NEVER CHANGES CHORD is a pad, and a pad is what this file's
   *     header says the score must not be. The sustained layers are eleven
   *     oscillators that are started once and RETUNED, so the only proof they
   *     are playing a progression rather than holding one chord is to drive a
   *     whole cycle and collect what the low brass was commanded to.
   *
   *   A STINGER THAT DUCKS ITSELF was the first version of the ducking here.
   *     The gesture plays through the same bus as the bed, so pulling the whole
   *     music path down moved both by the same amount and changed nothing
   *     audible except the level. That is invisible to an ear — "the music got
   *     quieter" is what it sounds like either way — and obvious in the graph.
   */
  check('audio: the score plays a progression, and a stinger is not under its own duck', () => {
    const { a, ctx } = engine();
    a.setMusicState({ state: 'combat' });
    const cfg = SCORE_STATES.combat;
    const bar = 4 * 60 / cfg.bpm;
    const cycle = bar * cfg.hold * cfg.prog.length;
    // Two full cycles, on the audio clock, with no frame loop.
    for (let i = 0; i < Math.ceil(cycle * 2 / 0.05); i++) ctx.advance(0.05);
    const lowOsc = a.score.lowOsc[0].o;
    const seen = new Set(lowOsc.frequency.calls.filter(c => c[0] === 'tgt')
      .map(c => Number(c[1].toFixed(2))));
    const wanted = new Set(cfg.prog.map(n => Number(hz(CHORDS[n].bass).toFixed(2))));
    for (const f of wanted) {
      assert(seen.has(f), `the low brass never reached ${f.toFixed(1)} Hz over two full cycles — `
        + `it visited ${[...seen].map(x => x.toFixed(1)).join(', ')}. The bed is one held chord.`);
    }
    assert(seen.size === wanted.size,
      `the bed visited ${seen.size} roots for a progression of ${wanted.size}`);

    /* THE CUE IS NOT INSIDE THE BED. */
    assert(!a.score.bed.outs.has(a.score.cue) && !a.score.cue.outs.has(a.score.bed),
      'the stingers and the bed are wired through each other');
    assert(a.score.bed.outs.has(a.score.bus) && a.score.cue.outs.has(a.score.bus),
      'the bed and the cue do not meet at the score bus');
    for (const g of Object.values(a.score.layers)) {
      assert(g.outs.has(a.score.bed), 'a layer bypasses the bed, so a stinger cannot duck it');
    }

    const bedMoves = a.score.bed.gain.moves(), cueMoves = a.score.cue.gain.moves();
    const musicMoves = a.musicDuck.gain.moves();
    a.stinger('boss');
    assert(a.score.bed.gain.moves() > bedMoves, 'a boss entrance does not push the bed out of its way');
    assert(a.score.cue.gain.moves() === cueMoves,
      'the stinger ducked the node it plays through — it is ducking itself');
    assert(a.musicDuck.gain.moves() === musicMoves,
      'a stinger ducked the whole music path, which includes the stinger');
    assert(a.score.bedLevel() < 0.8, `the bed only came down to ${a.score.bedLevel()}`);
    ctx.advance(8);
    assert(a.score.bedLevel() === 1, `the bed never came back: ${a.score.bedLevel()}`);
    return `low brass over ${[...seen].sort((x, y) => x - y).map(f => f.toFixed(1)).join(' → ')} Hz `
      + `for ${cfg.prog.join(' ')}; a boss stinger moves bed only, to `
      + `${a.score._bedDuckAt}, and back to 1`;
  });

  /**
   * NOTHING DUCKED ANYTHING, EVER.
   *
   * Before this, the score played at constant gain over every clash, every
   * detonation and every voice line in the game — the one thing an audit named
   * outright. `duckMusic` existed and had exactly one caller (death), and it
   * wrote `musicBus.gain`, which is the param the Music slider owns: a duck
   * scheduled a return to the volume AS IT WAS when the duck began, so a slider
   * moved inside that window was silently undone a second later.
   *
   * The measurement that matters is not "does a duck happen" — it is what
   * happens when SIX do. A clash storm has to be one hole in the music and not
   * six, and the score has to come all the way back afterwards.
   */
  check('audio: the music gets out of the way, and only once per exchange', () => {
    const { a, ctx } = engine();
    const near = V(2, 0, 0);
    for (let f = 0; f < 180; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    assert(a.musicDuckLevel() === 1, 'the score is already ducked with nothing happening');

    // The slider is NOT the duck. Both have to be readable and separate.
    const slider = a.musicBus.gain.last('tgt') ?? a.musicBus.gain.value;
    const m0 = a.musicBus.gain.moves();

    a.clash(near, 1);
    const one = a.musicDuckLevel();
    assert(one < 0.8, `one clash took the music to ${one.toFixed(2)} — that is not room`);

    // Six more inside a tenth of a second: an exchange, not six exchanges.
    const d0 = a.musicDuck.gain.moves();
    for (let i = 0; i < 6; i++) { a.clash(near, 1); ctx.advance(1 / 120); }
    const perExchange = a.musicDuck.gain.moves() - d0;
    assert(perExchange <= 2,
      `six more clashes inside 0.05 s cost ${perExchange} further duck automations — `
      + 'the score would pump between the hits of one exchange');

    // A whole second of them still costs a bounded number.
    const d1 = a.musicDuck.gain.moves();
    for (let i = 0; i < 60; i++) { a.clash(near, 1); ctx.advance(1 / 60); }
    const perSecond = a.musicDuck.gain.moves() - d1;
    assert(perSecond > 0 && perSecond <= 44,
      `${perSecond} duck automations for 60 clashes in one second`);

    assert(a.musicBus.gain.moves() === m0,
      'ducking wrote the Music slider — a slider moved during a duck would be undone');
    assert((a.musicBus.gain.last('tgt') ?? a.musicBus.gain.value) === slider,
      'the player\'s music level moved because something clashed');

    // …and it comes back. All the way back.
    ctx.advance(6);
    a.updateScore(1 / 60, 0, 0);
    assert(a.musicDuckLevel() === 1,
      `six seconds after the last clash the music is still held at ${a.musicDuckLevel()}`);

    /* A VOICE LINE, and for as long as the line lasts rather than a constant.
     * A grunt and a death cry are the same rule and different lengths. */
    const spec = { id: 'probe', f0: 130, cadence: 1 };
    const held = (kind, opts) => {
      const { a: b, ctx: c } = engine();
      for (let f = 0; f < 120; f++) { b.updateScore(1 / 60, 1, 0); c.advance(1 / 60); }
      const dur = b.speak(spec, kind, opts);
      let held2 = 0;
      while (b.musicDuckLevel() < 1 && held2 < 8) { c.advance(0.05); held2 += 0.05; }
      return { dur, held: held2, level: b._musicDuckAt };
    };
    const grunt = held('effort', { self: true });
    const cry = held('die', { self: true });
    const room = held('scream', { pos: V(3, 0, 0) });
    const chatter = held('chatter', { pos: V(3, 0, 0) });
    assert(grunt.held > 0 && cry.held > grunt.held,
      `a death cry (${cry.held.toFixed(2)} s) does not hold the music longer than a grunt `
      + `(${grunt.held.toFixed(2)} s)`);
    assert(room.held > 0 && room.level > cry.level,
      `a body screaming across the field leans on the score as hard as the player does `
      + `(${room.level} vs ${cry.level})`);
    assert(chatter.held === 0, 'idle droid banter stops the music');
    return `1 clash → ${one.toFixed(2)}; 7 in 0.05 s → ${perExchange} automations, `
      + `60 in 1 s → ${perSecond}; slider untouched, back to 1.00 after; `
      + `grunt ${grunt.held.toFixed(2)} s @${grunt.level} / cry ${cry.held.toFixed(2)} s / `
      + `room ${room.held.toFixed(2)} s @${room.level} / chatter none`;
  });

  /**
   * THE SEAM, AND THE THING IT MUST NOT BECOME.
   *
   * The score's state has two possible sources — what `World` knows, and what
   * the engine can derive from the calls the game already makes — and this
   * project has a section of its handoff about what happens when a derived
   * answer is allowed to sit beside an authoritative one (§2.3). So the rule is
   * written down and measured rather than asserted in a comment:
   *
   *   FACTS (`{active, boss, wave}`) are what the director knows and the engine
   *     cannot. They feed the derivation; they do not replace it, because the
   *     modes with no director at all — training, the dojo, a sandbox — still
   *     need a score and the only signal there is combat intensity.
   *   A STATE (`{state:'boss'}`) is a caller saying it knows better. It latches,
   *     and from then on nothing derived may contradict it.
   */
  check('audio: the game can tell the score what it is, and then it is the only voice', () => {
    /* FACTS: the derivation keeps running underneath them. */
    const { a, ctx } = engine();
    a.setMusicState({ wave: 3, active: true, boss: false });
    for (let f = 0; f < 120; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    assert(a.score._want === 'combat', `a live wave gave '${a.score._want}'`);
    assert(a.score.driven === false, 'passing facts latched the state machine shut');
    a.setMusicState({ active: false });
    for (let f = 0; f < 600; f++) { a.updateScore(1 / 60, 0, 0); ctx.advance(1 / 60); }
    assert(a.score._want === 'explore', `the wave ended and the score stayed in '${a.score._want}'`);
    // …and with the director silent, intensity alone still moves it. This is
    // the training/dojo/sandbox case, where there is no wave to be told about.
    for (let f = 0; f < 180; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    assert(a.score._want === 'combat',
      `nine bodies on a field with no director left the score in '${a.score._want}'`);

    /* A STATE: it latches, and the derivation may not contradict it. */
    const { a: b, ctx: c } = engine();
    b.setMusicState({ state: 'boss' });
    assert(b.score.driven, 'an explicit state did not take the wheel');
    for (let f = 0; f < 600; f++) { b.updateScore(1 / 60, 0, 0); c.advance(1 / 60); }
    assert(b.score._want === 'boss',
      `ten seconds of an empty field overruled the boss the game declared ('${b.score._want}')`);
    b.ui('wave');
    b.victory();
    for (let f = 0; f < 120; f++) { b.updateScore(1 / 60, 1, 0); c.advance(1 / 60); }
    assert(b.score._want === 'boss',
      `a derived call moved a state the game had set: '${b.score._want}'`);
    // …but the stingers those calls fire are events with one source each, so
    // they still play. Turning the derivation off must not mute the game.
    assert(b.score.stats.stingers >= 2,
      `${b.score.stats.stingers} stingers fired for a wave and a clear under an explicit state`);
    b.setMusicState({ state: 'explore' });
    assert(b.score._want === 'explore', 'the game could not take its own state back');
    return `facts → combat/explore/combat with driven=false; state → boss held through `
      + `10 s of nothing, a wave and a clear, ${b.score.stats.stingers} stingers still fired`;
  });

  /**
   * THE BAR CLOCK IS THE AUDIO CLOCK, and it has to be.
   *
   * Every musical timer in this project's history that used the WALL clock has
   * been wrong (see `death()`'s second heartbeat, and `victory()`'s arpeggio).
   * A score is worse: the frame clock does not run on the menu, does not run
   * during the 2.6 s death card, and — HANDOFF §2.6 — one frame on this box can
   * take four seconds. So the score wakes itself with a silent oscillator per
   * bar, and this is what proves it: drive the audio clock with NO frame loop
   * at all and count the bars.
   */
  check('audio: the score keeps time with nothing calling it', () => {
    const { a, ctx } = engine();
    a.setMusicState({ state: 'combat' });
    const b0 = a.score.stats.bars;
    // Not one updateScore. Only the audio clock moves.
    for (let i = 0; i < 600; i++) ctx.advance(0.05);      // 30 s
    const bars = a.score.stats.bars - b0;
    const want = 30 / (4 * 60 / SCORE_STATES.combat.bpm);
    assert(Math.abs(bars - want) <= 1.5,
      `${bars} bars in 30 s of audio clock with no frame loop; ${SCORE_STATES.combat.bpm} bpm says `
      + `${want.toFixed(1)}. The score is being driven by the renderer.`);

    /* AND A STOPPED CONTEXT IS NOT FED BARS. A suspended context freezes
     * currentTime, so everything scheduled while it is down lands on one
     * timestamp and arrives as a single chord when it comes back — the same
     * failure `_live()` exists to stop for one-shots. */
    const { a: b, ctx: c } = engine();
    b.setMusicState({ state: 'combat' });
    c.allowResume = false; c.state = 'suspended';
    const bb = b.score.stats.bars, t = c.currentTime;
    for (let f = 0; f < 600; f++) b.updateScore(1 / 60, 1, 0);
    assert(c.currentTime === t, 'the fake clock moved; this is not measuring what it thinks');
    assert(b.score.stats.bars === bb,
      `${b.score.stats.bars - bb} bars were scheduled onto a frozen clock — they all land at once`);
    c.allowResume = true; c.state = 'running';
    for (let f = 0; f < 300; f++) { b.updateScore(1 / 60, 1, 0); c.advance(1 / 60); }
    assert(b.score.stats.bars > bb, 'the score never came back after the context did');
    return `${bars} bars in 30 s with no frame loop (${SCORE_STATES.combat.bpm} bpm wants `
      + `${want.toFixed(1)}); 0 scheduled while suspended, ${b.score.stats.bars - bb} after resume`;
  });

  /**
   * THE SCORE COSTS FRAMES OR IT DOES NOT.
   *
   * Audio runs on the main thread here. The one-shot pool grants sixty voices a
   * second in an ordinary fight and that is the budget this has to be small
   * against — a score that built as much per second as the sound effects would
   * be a second sound engine. It also has to give every node back: eleven
   * oscillators run for the session by design, and everything else is
   * transient.
   */
  check('audio: the score is cheap, and gives every node it takes back', () => {
    const { a, ctx } = engine();
    a.setMusicState({ state: 'boss' });                   // the densest state
    for (let f = 0; f < 120; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    const e0 = ctx.edges.length, d0 = ctx.disconnected.length;
    for (let f = 0; f < 3600; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    const perSec = (ctx.edges.length - e0) / 60;
    assert(perSec < 40, `${perSec.toFixed(1)} connections a second under a boss`);
    assert(perSec > 4, `${perSec.toFixed(1)} connections a second — the densest state is not playing`);

    ctx.advance(8);
    const freed = ctx.disconnected.length - d0;
    const built = ctx.edges.length - e0;
    // Every transient voice releases its filter and its envelope; the sources
    // themselves are collected once stopped, exactly as _freeOnEnd does it.
    assert(freed > built * 0.3,
      `${built} connections in a minute and only ${freed} disconnects — nodes are accumulating`);
    assert(a.voices === 0 && a.stats.alloc === a.stats.freed,
      `the score moved the one-shot pool: ${a.stats.alloc} allocated, ${a.stats.freed} freed`);
    assert(ctx.running.length < 40,
      `${ctx.running.length} sources still scheduled 8 s after the last bar`);
    return `${perSec.toFixed(1)} connections/s under a boss for 60 s, ${freed} released, `
      + `${ctx.running.length} in flight after; one-shot pool untouched`;
  });

  /**
   * THE ROOM, which is the half of it the player can actually hear.
   *
   * src/engine/Audio.js says of the drone bed, three lines above where it is
   * built, "a slow-breathing minor cluster that swells with the fight". It was
   * written in exactly one place in the project — setAmbience, from level data,
   * at load — and measured over ten seconds at full combat intensity it
   * received ZERO automations: a nine-enemy fight and an empty level were the
   * same room.
   */
  check('audio: the room swells with the fight, and settles after it', () => {
    const { a, ctx } = engine();
    a.setAmbience({ wind: 0.20, windFreq: 190, drone: 0.26 });   // scoria's bed
    const base = a.droneGain.gain.last('tgt');
    assert(Math.abs(base - 0.26) < 1e-9, `the level's own drone arrived as ${base}`);
    const moves0 = a.droneGain.gain.moves();

    for (let f = 0; f < 600; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    const hot = a.droneGain.gain.last('tgt');
    assert(hot > base + 0.06,
      `ten seconds of a full fight moved the drone from ${base} to ${hot} — the bed does not answer combat`);
    // …and the fight is not weather: the wind bed must not have moved with it.
    assert(Math.abs(a.windGain.gain.last('tgt') - 0.20) < 1e-9,
      `the wind rose with the fight (${a.windGain.gain.last('tgt')}) — that is a storm, not a battle`);

    for (let f = 0; f < 1800; f++) { a.updateScore(1 / 60, 0, 0); ctx.advance(1 / 60); }
    const cold = a.droneGain.gain.last('tgt');
    assert(Math.abs(cold - base) < 0.01,
      `thirty seconds after the fight the drone is still at ${cold.toFixed(3)}, not back to ${base}`);

    // A ramp scheduled every frame is a ramp that never arrives anywhere: 2400
    // frames of this must cost tens of automations, not thousands.
    const moves = a.droneGain.gain.moves() - moves0;
    assert(moves > 2 && moves < 80, `${moves} drone automations over 2400 frames`);
    return `drone ${base} → ${hot.toFixed(3)} under a full fight → ${cold.toFixed(3)} after it, `
      + `in ${moves} automations`;
  });

  /**
   * THE WEATHER. Eight of the thirteen levels ship a squall — kamino peaks at
   * 1.0 for 44 s of every 88 — and src/world/Scenery.js drives fog density, sun
   * intensity, hemi fill and a 2.4× particle wind off `weather.intensity` every
   * frame. The audio wind was written once, at level load. A white-out crossed
   * the level in silence.
   */
  check('audio: a squall is heard as well as seen', () => {
    const { a, ctx } = engine();
    a.setAmbience({ wind: 0.42, windFreq: 520, drone: 0.18 });   // kamino's bed
    const w0 = a.windGain.gain.last('tgt'), f0 = a.windFilter.frequency.last('tgt');

    for (let f = 0; f < 900; f++) { a.updateScore(1 / 60, 0, 1); ctx.advance(1 / 60); }
    const w1 = a.windGain.gain.last('tgt'), f1 = a.windFilter.frequency.last('tgt');
    assert(w1 > w0 * 1.5, `a full squall took the wind from ${w0} to ${w1} — under +3.5 dB, it is not weather`);
    assert(f1 > f0 * 1.3, `the wind's band stayed at ${f1.toFixed(0)} Hz — a gale is brighter than a breeze`);
    // and a storm is not a fight
    assert(Math.abs(a.droneGain.gain.last('tgt') - 0.18) < 1e-9,
      `the drone rose with the weather (${a.droneGain.gain.last('tgt')})`);

    for (let f = 0; f < 900; f++) { a.updateScore(1 / 60, 0, 0); ctx.advance(1 / 60); }
    assert(Math.abs(a.windGain.gain.last('tgt') - w0) < 0.006,
      `the squall blew out and the wind stayed at ${a.windGain.gain.last('tgt')}`);
    assert(Math.abs(a.windFilter.frequency.last('tgt') - f0) < 7,
      `the wind's band never came back down: ${a.windFilter.frequency.last('tgt').toFixed(0)} Hz`);
    return `wind ${w0} → ${w1.toFixed(3)} and ${f0} → ${f1.toFixed(0)} Hz at peak squall, both back after`;
  });

  /**
   * SLOW MOTION WAS SILENT.
   *
   * Force Sense takes the world to 0.42× and a full Focus hold to 0.18×, and
   * `grep focus src/engine/Audio.js` returned nothing at all — the signature
   * power of the game bent time and the mix did not move.
   */
  check('audio: slow motion sounds slow', () => {
    const { a, ctx } = engine();
    const at = (s) => {
      a.setTimeScale(s); ctx.advance(0.2);
      return { f: a.timeLP.frequency.last('tgt') ?? a.timeLP.frequency.value,
        q: a.timeLP.Q.last('tgt') ?? a.timeLP.Q.value, p: a._timePitch };
    };
    const full = at(1);
    assert(full.f > 15000, `the bus is filtered at full speed (${full.f.toFixed(0)} Hz) — this must be free`);
    assert(full.p === 1, `one-shots are detuned at full speed (${full.p})`);

    const sense = at(0.42);          // Player.toggleSense
    const focus = at(0.18);          // a full Focus hold
    assert(sense.f < full.f * 0.72, `Force Sense moved the band from ${full.f.toFixed(0)} to ${sense.f.toFixed(0)} Hz`);
    assert(focus.f < sense.f * 0.8, `a deeper hold did not go darker: ${sense.f.toFixed(0)} vs ${focus.f.toFixed(0)} Hz`);
    assert(focus.q > full.q, `no resonance on the way down (${full.q} vs ${focus.q})`);
    assert(focus.p < 0.7 && sense.p < 0.8 && focus.p < sense.p,
      `pitch did not follow the clock: 1× ${full.p}, 0.42× ${sense.p}, 0.18× ${focus.p}`);

    // …and it is a real fundamental on a real sound, not a field.
    a.setTimeScale(1); ctx.advance(0.2);
    const before = ctx.edges.length;
    a.tone({ freq: 440, dur: 0.1, gain: 0.2, prio: PRIO.critical });
    const dry = ctx.edges.slice(before).map(([f]) => f).find(n => n.kind === 'osc');
    a.setTimeScale(0.18); ctx.advance(0.2);
    const mark = ctx.edges.length;
    a.tone({ freq: 440, dur: 0.1, gain: 0.2, prio: PRIO.critical });
    const slow = ctx.edges.slice(mark).map(([f]) => f).find(n => n.kind === 'osc');
    assert(dry && slow, 'the probe tones never built an oscillator');
    assert(Math.abs(dry.frequency.value - 440) < 0.001,
      `a tone at full speed came out at ${dry.frequency.value.toFixed(1)} Hz`);
    assert(slow.frequency.value < 300,
      `a tone in a 0.18× world came out at ${slow.frequency.value.toFixed(1)} Hz`);

    // Back up, and back to free.
    a.setTimeScale(1); ctx.advance(0.2);
    assert((a.timeLP.frequency.last('tgt') ?? 0) > 15000, 'the band never reopened');
    const semis = (12 * Math.log2(slow.frequency.value / 440)).toFixed(1);
    return `bus band ${full.f.toFixed(0)} → ${sense.f.toFixed(0)} Hz at Sense → ${focus.f.toFixed(0)} Hz at a full hold; `
      + `Q ${full.q.toFixed(2)} → ${focus.q.toFixed(2)}; a 440 Hz tone lands at `
      + `${slow.frequency.value.toFixed(0)} Hz (${semis} semitones); all of it back at 1×`;
  });

  /**
   * EVERY SPACE SOUNDED LIKE THE SAME ROOM.
   *
   * `init()` built one convolver from `_makeImpulse(2.4, 2.6)` behind a send of
   * 0.16, and `grep reverbSend` found nothing after the line that created it. A
   * 30,000-seat stone bowl, an open dune sea and a sealed foundry were all
   * played through that one tail at that one level for the life of the project.
   *
   * The room is DERIVED (World.roomOf) rather than added as a tenth field to
   * ten level records, so this measures the derivation over the whole roster —
   * a spread, not a single number — and then measures that the derivation
   * actually reaches the graph.
   */
  check('audio: each level is a different room, and the room reaches the graph', async () => {
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    // World.js is imported dynamically and inside the function body: it reaches
    // Engine.js, whose module-level ShaderChunk rewrites sit behind once-only
    // flags. See tools/verify.mjs.
    const { roomOf } = await import('../../src/game/World.js');

    /* The GROUND is `Terrain.surfaceAt`'s answer and this check does not build
     * ten heightfields to ask it — that is the shape that made levels-quality
     * unrunnable (HANDOFF §2.6). It sweeps the four surfaces that exist instead,
     * which is a stronger statement than one sample each: the derivation has to
     * be spread over the ROSTER whatever it is standing on. */
    const rows = [], all = [];
    for (const k of LEVEL_ORDER) {
      const L = LEVELS[k];
      const r = roomOf(L, 'sand');
      all.push(r);
      rows.push(`${k} ${r.seconds.toFixed(2)}s/${r.send.toFixed(3)}`);
      for (const g of ['sand', 'stone', 'metal', 'water']) {
        const q = roomOf(L, g);
        assert(Number.isFinite(q.seconds) && Number.isFinite(q.decay) && Number.isFinite(q.send),
          `${k}/${g} produced a non-finite room`);
        assert(q.seconds >= 0.15 && q.seconds <= 6 && q.send >= 0 && q.send <= 0.6,
          `${k}/${g} is out of the range setRoom will take: ${JSON.stringify(q)}`);
      }
    }
    const span = (list, f) => { const v = list.map(f); return Math.max(...v) / Math.min(...v); };
    /* The bar is "these are different places", not a tuning. One shared room is
     * 1.00x on everything, which is what shipped.
     *
     * TWO POPULATIONS, because the three numbers have two different causes and
     * measuring both against one would understate one of them. `seconds` and
     * `send` are the LEVEL's — how enclosed it is and how far it spreads — so
     * they are spread across the roster with the ground held still. `decay` is
     * the GROUND's, so a sweep that holds the ground still measures almost
     * nothing of it (1.55x, and every bit of that is grass and water); it is
     * spread over the four surfaces `Terrain.surfaceAt` can actually report. */
    const grid = [];
    for (const k of LEVEL_ORDER) for (const g of ['sand', 'stone', 'metal', 'water']) grid.push(roomOf(LEVELS[k], g));
    assert(span(all, r => r.seconds) > 3, `every level's tail is within ${span(all, r => r.seconds).toFixed(2)}x`);
    assert(span(all, r => r.send) > 3, `every level's send is within ${span(all, r => r.send).toFixed(2)}x`);
    assert(span(grid, r => r.decay) > 2.5,
      `every ground decays the same: within ${span(grid, r => r.decay).toFixed(2)}x`);

    // …and it lands. The impulse is a real buffer and the send is a real ramp.
    const { a } = engine();
    const open = roomOf(LEVELS[LEVEL_ORDER.find(k => LEVELS[k].ambience?.wind >= 0.3)] || {}, 'sand');
    /* A HALL, WRITTEN OUT. This used to read the Foundry's block and the
     * Foundry is deleted; the property is that a big metal room and an open
     * windy one get different impulses, and neither half of that needs a level
     * to exist to be true. `sky: false` is what `roomOf` reads to call a place
     * enclosed, so the fixture declares it. */
    const hall = roomOf({ atmosphere: { sky: false }, ambience: { wind: 0.02, drone: 0.3 } }, 'metal');
    a.setAmbience({ wind: 0.04, drone: 0.3, room: hall });
    const long = a.reverb.buffer;
    assert(long, 'setRoom left the convolver with no impulse at all');
    assert(Math.abs(long.duration - hall.seconds) < 0.02,
      `the impulse is ${long.duration.toFixed(2)}s for a ${hall.seconds.toFixed(2)}s room`);
    const sendLong = a.reverbSend.gain.last('tgt');
    a.setAmbience({ wind: 0.42, drone: 0.03, room: open });
    const short = a.reverb.buffer;
    assert(short !== long, 'the second level reused the first level\'s impulse');
    assert(short.duration < long.duration * 0.6,
      `an open ridge got ${short.duration.toFixed(2)}s against the hall's ${long.duration.toFixed(2)}s`);
    assert(a.reverbSend.gain.last('tgt') < sendLong * 0.6,
      `the send did not move between rooms: ${sendLong} → ${a.reverbSend.gain.last('tgt')}`);
    // Re-entering the same room must not rebuild 320 kB of impulse.
    const again = a.reverb.buffer;
    a.setRoom(open);
    assert(a.reverb.buffer === again, 'the same room built a second impulse');

    return `${LEVEL_ORDER.length} levels: tail ${span(all, r => r.seconds).toFixed(1)}x, `
      + `send ${span(all, r => r.send).toFixed(1)}x, decay ${span(grid, r => r.decay).toFixed(1)}x over 4 grounds `
      + `(all were 2.40s / 2.6 / 0.16); graph ${long.duration.toFixed(2)}s@${sendLong.toFixed(3)} `
      + `→ ${short.duration.toFixed(2)}s@${a.reverbSend.gain.last('tgt').toFixed(3)}, re-entry rebuilds nothing`;
  });
}
