/**
 * SABER — synthesised audio.
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
 * 12 deflections among them. The arena run was worse, 1331 refusals. Nothing
 * threw, nothing leaked, no gain was zero — the loudest events in the game were
 * simply queued behind boots on sand. That is "the sound comes in and out".
 *
 * So the pool is banded. A footstep may only ever fill the bottom third of it;
 * a clash may take the lot. The bands are ceilings on the LIVE count rather
 * than separate pools, so a quiet moment still lends the whole engine to a
 * footstep — they only bite while the pool is filling, which is the only moment
 * the question is worth asking.
 */
export const PRIO = { chatter: 0, world: 1, combat: 2, critical: 3 };
const BAND = [0.34, 0.68, 0.88, 1];

/**
 * The panner's inverse distance law, as a plain number.
 *
 * _panner() builds every positional voice with the same refDistance 1.8 and
 * rolloffFactor 1.1, so the amplitude a sound arrives at is knowable before a
 * single node exists — which is what lets a sound be refused for being
 * inaudible instead of for being late.
 */
const REF_DIST = 1.8, ROLLOFF = 1.1;
const attenuation = (d) => (d <= REF_DIST ? 1 : REF_DIST / (REF_DIST + ROLLOFF * (d - REF_DIST)));

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

// listener scratch — updateListener runs every frame
const _lq = new THREE.Quaternion(), _lf = new THREE.Vector3(), _lu = new THREE.Vector3();

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.volume = 0.8;
    this.musicVolume = 0.45;
    this.voices = 0;
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
    this.stats = { req: 0, alloc: 0, freed: 0, denied: 0, culled: 0, dropped: 0, threw: 0, peak: 0 };
  }

  /** The live-voice ceiling for a band, so a caller can state what it expects. */
  bandCap(prio) { return Math.max(1, Math.round((BAND[prio] ?? 1) * this.maxVoices)); }

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
    // Wind and drone are the world, not the score. On musicBus, turning the
    // music down muted the level's own atmosphere along with it.
    this.ambBus = this.ctx.createGain(); this.ambBus.gain.value = 1;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.6);
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0.16;

    this.sfxBus.connect(this.comp);
    this.sfxBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.ambBus.connect(this.comp);
    // The score bypasses the compressor: on it, every blaster shot pumped the
    // music down with it.
    this.musicBus.connect(this.master);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this._noiseBuf = this._makeNoise(2.0, false);
    this._pinkBuf = this._makeNoise(2.0, true);
    this.ready = true;
    this._startAmbience();
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
  setMusicVolume(v) {
    this.musicVolume = num(v, 0.45);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.02);
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

  _panner(pos, refDist = 1.8, maxDist = 160) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = maxDist;
    p.rolloffFactor = 1.1;
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
  _reach(pos, gain = 1) {
    if (!pos) return 1;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return 1;
    const d = this._listenerPos.distanceTo(pos);
    if (!(d <= MAX_RANGE)) return 0;
    return num(gain, 1) * attenuation(d) >= HEARING_FLOOR ? 2 : 0;
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
      if (!node || node === this.sfxBus || node === this.musicBus || node === this.master) return;
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

  /* ── the saber ─────────────────────────────────────────────────────── */

  /** A live, controllable hum. One per active blade. */
  createHum(color = 0x57c9ff) {
    if (!this.ready) return { set() {}, ignite() {}, retract() {}, move() {}, dispose() {} };
    const ctx = this.ctx;
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
        const pitch = 1 + s * 0.42 + strain * 0.25;
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
    }
  }

  step(pos, surface = 'sand', run = false) {
    const cfg = {
      sand:  { freq: 1500, q: 0.7, gain: 0.09 },
      stone: { freq: 2600, q: 1.4, gain: 0.11 },
      metal: { freq: 3400, q: 2.6, gain: 0.10 },
      water: { freq: 1900, q: 0.9, gain: 0.14 },
    }[surface] || { freq: 1800, q: 1, gain: 0.1 };
    this.noise({ dur: run ? 0.13 : 0.1, gain: cfg.gain * (run ? 1.5 : 1), type: 'bandpass',
      freq: cfg.freq, freqEnd: cfg.freq * 0.3, q: cfg.q, pos, prio: PRIO.chatter });
  }

  thud(pos, power = 1) {
    this.noise({ dur: 0.2, gain: 0.16 * power, type: 'lowpass', freq: 700, freqEnd: 130, pos, pink: true, prio: PRIO.world });
    this.tone({ freq: 110, freqEnd: 44, dur: 0.22, gain: 0.2 * power, type: 'sine', pos, prio: PRIO.world });
  }

  ui(kind = 'hover') {
    const map = {
      hover: { freq: 900, end: 1200, dur: 0.05, gain: 0.05, type: 'sine' },
      click: { freq: 500, end: 1400, dur: 0.09, gain: 0.09, type: 'triangle' },
      wave:  { freq: 180, end: 90, dur: 1.0, gain: 0.2, type: 'sine' },
      good:  { freq: 620, end: 1240, dur: 0.3, gain: 0.14, type: 'sine' },
      bad:   { freq: 300, end: 90, dur: 0.5, gain: 0.18, type: 'sawtooth' },
    }[kind];
    // The menu is the one place where a dropped sound reads as a broken button.
    if (map) this.tone({ freq: map.freq, freqEnd: map.end, dur: map.dur, gain: map.gain,
      type: map.type, prio: PRIO.critical });
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
  }

  setAmbience({ wind = 0.1, windFreq = 420, drone = 0.1 } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // These come out of level data. A throw here is thrown from World's
    // constructor, which would take the whole level down with it.
    this.windGain.gain.setTargetAtTime(num(wind, 0.1), t, 1.2);
    this.windFilter.frequency.setTargetAtTime(num(windFreq, 420), t, 1.2);
    this.droneGain.gain.setTargetAtTime(num(drone, 0.1), t, 2.0);
  }

  /** Drives the percussive pulse under combat. */
  updateScore(dt, intensity) {
    // The same reason the one-shots refuse a stopped context: a frozen clock
    // stacks every pulse on one timestamp and none of them can end.
    if (!this.ready || !this._live()) return;
    dt = num(dt, 1 / 60); intensity = num(intensity, 0);
    this.intensity += (intensity - this.intensity) * Math.min(1, dt * 0.6);
    if (this.intensity < 0.12) return;
    this._pulseTimer -= dt;
    if (this._pulseTimer <= 0) {
      const bpm = 74 + this.intensity * 46;
      this._pulseTimer = 60 / bpm;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(74, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14 * this.intensity, t + 0.006);
      g.gain.setTargetAtTime(0.0001, t + 0.01, 0.07);
      o.connect(g); g.connect(this.musicBus);
      o.onended = () => { try { g.disconnect(); } catch {} };
      o.start(t); o.stop(t + 0.35);
    }
  }
}

export const audio = new AudioEngine();
