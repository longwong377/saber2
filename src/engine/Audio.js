/**
 * SABER — synthesised audio.
 *
 * Nothing here is a sample. Every sound is built from oscillators and shaped
 * noise at the moment it is needed, which means the saber hum can be a live
 * instrument: its pitch, its amplitude and its filter all track how fast the
 * blade is actually moving, so the weapon sings when you move it and settles
 * when you hold a guard.
 */

import * as THREE from 'three';
import { clamp, makeRng } from './MathUtil.js';

const rng = makeRng(4242);

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
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;

    // A gentle bus compressor keeps a hundred droids from clipping the mix.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 1;
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.musicVolume;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.6);
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0.16;

    this.sfxBus.connect(this.comp);
    this.sfxBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.musicBus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this._noiseBuf = this._makeNoise(2.0, false);
    this._pinkBuf = this._makeNoise(2.0, true);
    this.ready = true;
    this._startAmbience();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }

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
    const l = this.ctx.listener;
    camera.getWorldPosition(this._listenerPos);
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
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

  _panner(pos, refDist = 6, maxDist = 160) {
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

  _out(pos) {
    if (!pos) return this.sfxBus;
    // Cull distant one-shots before they cost anything.
    if (this._listenerPos.distanceToSquared(pos) > 190 * 190) return null;
    const p = this._panner(pos);
    p.connect(this.sfxBus);
    return p;
  }

  _voice() {
    if (this.voices >= this.maxVoices) return false;
    this.voices++;
    return true;
  }
  _freeAt(node, t) {
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); try { node.disconnect(); } catch {} }, t * 1000 + 60);
  }

  /* ── primitives ────────────────────────────────────────────────────── */

  noise({ dur = 0.2, gain = 0.4, type = 'bandpass', freq = 1200, q = 1.2, freqEnd = null,
          pos = null, pink = false, attack = 0.002, curve = 2.2 } = {}) {
    if (!this.ready || !this._voice()) return;
    const t = this.ctx.currentTime;
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
    const out = this._out(pos);
    if (!out) { this.voices--; return; }
    src.connect(flt); flt.connect(g); g.connect(out);
    src.start(t + rng() * 0.004);
    src.stop(t + dur + 0.06);
    this._freeAt(out, dur);
  }

  tone({ freq = 440, freqEnd = null, dur = 0.2, gain = 0.25, type = 'sine', pos = null,
         attack = 0.004, detune = 0, filter = null } = {}) {
    if (!this.ready || !this._voice()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, dur / 2.6);
    const out = this._out(pos);
    if (!out) { this.voices--; return; }
    let node = o;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass'; f.frequency.value = filter.freq || 2000; f.Q.value = filter.q || 1;
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    this._freeAt(out, dur);
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
      o.type = type; o.frequency.value = base * mult; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = lvl;
      o.connect(g); g.connect(bus);
      o.start();
      oscs.push({ o, mult }); gains.push(g);
    }
    // breath of noise for the crackle
    const ns = ctx.createBufferSource(); ns.buffer = this._pinkBuf; ns.loop = true;
    const nsF = ctx.createBiquadFilter(); nsF.type = 'bandpass'; nsF.frequency.value = 900; nsF.Q.value = 0.8;
    const nsG = ctx.createGain(); nsG.gain.value = 0.10;
    ns.connect(nsF); nsF.connect(nsG); nsG.connect(bus); ns.start();

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
        bus.gain.linearRampToValueAtTime(0.5, t + 0.09);
        bus.gain.linearRampToValueAtTime(0.20, t + 0.34);
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
        bus.gain.setTargetAtTime(0.19 + s * 0.30 + strain * 0.24, t, 0.045);
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
        try {
          for (const { o } of oscs) o.stop();
          ns.stop(); lfo.stop();
          bus.disconnect(); lp.disconnect(); hp.disconnect(); panner.disconnect();
        } catch {}
      },
    };
    return api;
  }

  /* ── one-shots ─────────────────────────────────────────────────────── */

  swing(speed, pos) {
    const s = clamp(speed / 30, 0, 1.4);
    this.noise({ dur: 0.16 + s * 0.13, gain: 0.05 + s * 0.30, type: 'bandpass',
      freq: 420 + s * 1500, freqEnd: 180 + s * 420, q: 1.5, pos, pink: true });
  }

  clash(pos, power = 1) {
    this.noise({ dur: 0.28, gain: 0.34 * power, type: 'bandpass', freq: 3200, freqEnd: 700, q: 0.7, pos });
    this.tone({ freq: 1900 + rng() * 700, freqEnd: 420, dur: 0.24, gain: 0.20 * power, type: 'sawtooth', pos });
    this.tone({ freq: 160, freqEnd: 70, dur: 0.3, gain: 0.24 * power, type: 'sine', pos });
  }

  deflect(pos, grade = 1) {
    this.noise({ dur: 0.13, gain: 0.22, type: 'bandpass', freq: 2600, freqEnd: 1100, q: 1.6, pos });
    this.tone({ freq: 780 + grade * 480, freqEnd: 2400 + grade * 900, dur: 0.13, gain: 0.14 + grade * 0.07,
      type: 'square', pos, filter: { type: 'lowpass', freq: 4200 } });
    if (grade >= 2) this.tone({ freq: 2600, freqEnd: 5200, dur: 0.22, gain: 0.12, type: 'sine', pos });
  }

  cut(pos, heavy = false) {
    this.noise({ dur: heavy ? 0.42 : 0.24, gain: heavy ? 0.34 : 0.22, type: 'bandpass',
      freq: 2400, freqEnd: 300, q: 0.9, pos });
    this.tone({ freq: 220, freqEnd: 60, dur: 0.26, gain: 0.16, type: 'sawtooth', pos });
  }

  blaster(pos, big = false) {
    const f = big ? 1500 : 2600;
    this.tone({ freq: f, freqEnd: f * 0.16, dur: big ? 0.24 : 0.14, gain: big ? 0.3 : 0.20,
      type: 'sawtooth', pos, filter: { type: 'lowpass', freq: 5200, q: 3 } });
    this.noise({ dur: 0.09, gain: 0.12, type: 'highpass', freq: 2400, pos });
  }

  boltHit(pos) {
    this.noise({ dur: 0.16, gain: 0.2, type: 'bandpass', freq: 1400, freqEnd: 260, q: 0.9, pos });
    this.tone({ freq: 130, freqEnd: 52, dur: 0.18, gain: 0.2, type: 'sine', pos });
  }

  explosion(pos, size = 1) {
    this.noise({ dur: 0.9 * size, gain: 0.5, type: 'lowpass', freq: 1800, freqEnd: 120, q: 0.6, pos, pink: true });
    this.tone({ freq: 90, freqEnd: 28, dur: 0.85 * size, gain: 0.45, type: 'sine', pos });
    this.tone({ freq: 220, freqEnd: 60, dur: 0.4 * size, gain: 0.22, type: 'triangle', pos });
  }

  force(pos, kind = 'push') {
    if (kind === 'push') {
      this.noise({ dur: 0.55, gain: 0.34, type: 'lowpass', freq: 900, freqEnd: 130, q: 0.7, pos, pink: true });
      this.tone({ freq: 74, freqEnd: 34, dur: 0.6, gain: 0.34, type: 'sine', pos });
    } else if (kind === 'pull') {
      this.noise({ dur: 0.5, gain: 0.24, type: 'bandpass', freq: 180, freqEnd: 1400, q: 1.1, pos, pink: true });
      this.tone({ freq: 60, freqEnd: 190, dur: 0.5, gain: 0.24, type: 'sine', pos });
    } else if (kind === 'jump') {
      this.noise({ dur: 0.4, gain: 0.22, type: 'bandpass', freq: 300, freqEnd: 1800, q: 1.4, pos, pink: true });
    } else if (kind === 'sense') {
      this.tone({ freq: 1400, freqEnd: 200, dur: 1.1, gain: 0.16, type: 'sine' });
      this.tone({ freq: 700, freqEnd: 100, dur: 1.3, gain: 0.12, type: 'triangle' });
    } else if (kind === 'lightning') {
      this.noise({ dur: 0.6, gain: 0.3, type: 'highpass', freq: 2600, q: 1.0, pos });
      this.tone({ freq: 60, freqEnd: 40, dur: 0.6, gain: 0.2, type: 'square', pos });
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
      freq: cfg.freq, freqEnd: cfg.freq * 0.3, q: cfg.q, pos });
  }

  thud(pos, power = 1) {
    this.noise({ dur: 0.2, gain: 0.16 * power, type: 'lowpass', freq: 700, freqEnd: 130, pos, pink: true });
    this.tone({ freq: 110, freqEnd: 44, dur: 0.22, gain: 0.2 * power, type: 'sine', pos });
  }

  ui(kind = 'hover') {
    const map = {
      hover: { freq: 900, end: 1200, dur: 0.05, gain: 0.05, type: 'sine' },
      click: { freq: 500, end: 1400, dur: 0.09, gain: 0.09, type: 'triangle' },
      wave:  { freq: 180, end: 90, dur: 1.0, gain: 0.2, type: 'sine' },
      good:  { freq: 620, end: 1240, dur: 0.3, gain: 0.14, type: 'sine' },
      bad:   { freq: 300, end: 90, dur: 0.5, gain: 0.18, type: 'sawtooth' },
    }[kind];
    if (map) this.tone({ freq: map.freq, freqEnd: map.end, dur: map.dur, gain: map.gain, type: map.type });
  }

  /* ── ambience & score ──────────────────────────────────────────────── */

  _startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._pinkBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.35;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start();
    this.windGain = g; this.windFilter = f;

    // Drone bed: a slow-breathing minor cluster that swells with the fight.
    this.droneOsc = [];
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    this.droneGain.connect(this.musicBus);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    this.droneGain.connect(lp);
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
    this.windGain.gain.setTargetAtTime(wind, t, 1.2);
    this.windFilter.frequency.setTargetAtTime(windFreq, t, 1.2);
    this.droneGain.gain.setTargetAtTime(drone, t, 2.0);
  }

  /** Drives the percussive pulse under combat. */
  updateScore(dt, intensity) {
    if (!this.ready) return;
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
      o.start(t); o.stop(t + 0.35);
    }
  }
}

export const audio = new AudioEngine();
