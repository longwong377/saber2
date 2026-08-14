/**
 * SABER — five voices, or one voice with five labels?
 *
 * This suite exists because of the single most likely way for the feature it
 * checks to be wrong. A character-voice picker is four lines of menu code, a
 * table of names and a switch; it reads beautifully, it passes every structural
 * test anyone would think to write, and it can ship five entries that produce
 * BIT-IDENTICAL sound. Nothing in a source file can tell you what a sound is.
 *
 * So nothing here inspects source. Every voice in src/engine/Voice.js is
 * RENDERED to samples by the offline synthesiser below and then measured:
 *
 *   pitch centre       autocorrelation on the loudest 120 ms
 *   spectral centroid  4096-point FFT, Hann window, amplitude-weighted mean
 *   duration           the length of the line the cadence actually produces
 *
 * and any two archetypes that land on top of each other fail the build.
 *
 * ── why an offline synthesiser and not OfflineAudioContext ──────────────
 *
 * Node has no Web Audio at all. The renderer here is the same synthesis the
 * browser performs, expressed in samples: the same band-limited waveforms, the
 * RBJ biquad the Web Audio spec defines BiquadFilterNode as, and the same
 * envelope shape. What makes that trustworthy is not the code, it is that both
 * sides are downstream of one description — `utterance()` returns a grain list,
 * the browser turns it into nodes and this turns it into samples — and that
 * "the engine builds what was measured" below drives the REAL AudioEngine and
 * checks its oscillator and filter frequencies against the same grain list,
 * grain by grain. Neither half can drift without the other failing.
 */

import * as THREE from 'three';
import { AudioEngine, PRIO } from '../../src/engine/Audio.js';
import { PLAYER_VOICES, ENEMY_VOICES, ALL_VOICES, LINES, utterance, peakGain, voiceAt }
  from '../../src/engine/Voice.js';
import { Presence, bodyOf, MAX_BODIES, RANGE } from '../../src/engine/Presence.js';
import { Announcer, STREAKS, RETURNS, QUIP_GAP, CHATTER_GAP } from '../../src/ui/Announcer.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const SR = 48000;

/* ══════════════════════════════════════════════════════════════════════ */
/*  1. AN OFFLINE SYNTHESISER                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/** Deterministic noise. A measurement that moves between runs is not one. */
function noiseRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** The envelope AudioEngine._grain schedules: linear attack, exponential body,
 *  and a short run to zero so the source can be stopped without a click. */
function env(t, dur, attack) {
  if (t < 0 || t > dur) return 0;
  const a = Math.max(1e-4, attack);
  const tail = dur * 0.12;
  const fade = t > dur - tail ? (dur - t) / tail : 1;
  return (t < a ? t / a : Math.exp(-(t - a) / (dur / 2.2))) * fade;
}

/** Band-limited additive sources. A naive saw aliases, and folded energy lands
 *  under the formants — which is exactly what is being measured. */
function harmonics(src) {
  if (src === 'square') return { odd: true, amp: (n) => 1 / n, sign: () => 1 };
  if (src === 'triangle') return { odd: true, amp: (n) => 1 / (n * n), sign: (k) => (k % 2 ? -1 : 1) };
  if (src === 'sine') return { odd: false, amp: (n) => (n === 1 ? 1 : 0), sign: () => 1 };
  return { odd: false, amp: (n) => 1 / n, sign: () => 1 };
}

/** RBJ biquad — the shapes BiquadFilterNode is specified as. */
function biquad(type, freq, q, sr) {
  const w0 = TAU * Math.min(freq, sr * 0.49) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Math.max(1e-4, q));
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let b0, b1, b2;
  if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function runFilter(buf, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

function renderGrain(g, sr, seed) {
  const n = Math.max(1, Math.round(g.dur * sr));
  const buf = new Float32Array(n);
  if (g.src === 'noise') {
    const r = noiseRng(seed);
    for (let i = 0; i < n; i++) buf[i] = r() * 2 - 1;
  } else {
    const H = harmonics(g.src);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const f = g.f0 * Math.pow(Math.max(1e-3, g.f1 / g.f0), i / n);
      phase += TAU * f / sr;
      const top = Math.min(64, Math.floor(sr * 0.5 / Math.max(1, f)));
      let s = 0, k = 0;
      for (let h = 1; h <= top; h++) {
        if (H.odd && h % 2 === 0) continue;
        s += H.sign(++k) * H.amp(h) * Math.sin(h * phase);
      }
      buf[i] = s * 0.6;
    }
  }
  if (g.filter) runFilter(buf, biquad(g.filter.type, g.filter.freq, g.filter.q, sr));
  for (let i = 0; i < n; i++) buf[i] *= g.gain * env(i / sr, g.dur, g.attack);
  return buf;
}

export function renderUtterance(u, sr = SR, scale = 1) {
  const out = new Float32Array(Math.ceil((u.dur + 0.05) * sr));
  let seed = 12345;
  for (const g of u.grains) {
    const b = renderGrain(g, sr, (seed = (seed * 1103515245 + 12345) >>> 0));
    const at = Math.round(g.t * sr);
    for (let i = 0; i < b.length && at + i < out.length; i++) out[at + i] += b[i] * scale;
  }
  return out;
}

/* ── measurement ─────────────────────────────────────────────────────── */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function loudest(buf, n) {
  let best = 0, bestE = -1;
  const step = Math.max(1, Math.floor(n / 8));
  for (let s = 0; s + n <= buf.length; s += step) {
    let e = 0;
    for (let i = s; i < s + n; i++) e += buf[i] * buf[i];
    if (e > bestE) { bestE = e; best = s; }
  }
  return best;
}

/** Pitch centre, off the SIGNAL. A narrow formant can suppress a fundamental
 *  entirely, and the question is what the thing sounds like, not what the
 *  table says — the first pass of this file put a 138 Hz larynx at 353 Hz. */
export function pitch(buf, sr = SR, lo = 30, hi = 480) {
  const n = Math.min(buf.length, Math.round(sr * 0.12));
  const s = loudest(buf, n);
  const w = buf.subarray(s, s + n);
  const minLag = Math.floor(sr / hi), maxLag = Math.min(Math.floor(sr / lo), n - 2);
  let best = 0, bestLag = 0, e0 = 0;
  for (let i = 0; i < n; i++) e0 += w[i] * w[i];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0, e = 0;
    for (let i = 0; i + lag < n; i++) { c += w[i] * w[i + lag]; e += w[i + lag] * w[i + lag]; }
    const norm = c / Math.sqrt(Math.max(1e-12, e0 * e));
    if (norm > best) { best = norm; bestLag = lag; }
  }
  return bestLag ? sr / bestLag : 0;
}

export function centroid(buf, sr = SR, top = 9000) {
  const N = 4096;
  const s = loudest(buf, Math.min(N, buf.length));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const v = s + i < buf.length ? buf[s + i] : 0;
    re[i] = v * (0.5 - 0.5 * Math.cos(TAU * i / (N - 1)));
  }
  fft(re, im);
  let n = 0, d = 0;
  const maxBin = Math.min(N / 2, Math.floor(top * N / sr));
  for (let k = 1; k < maxBin; k++) {
    const mag = Math.hypot(re[k], im[k]);
    n += (k * sr / N) * mag; d += mag;
  }
  return d > 0 ? n / d : 0;
}

const peakAbs = (b) => { let p = 0; for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > p) p = v; } return p; };

/** One measured line. */
function profile(spec, kind = 'kill') {
  const u = utterance(spec, kind, 0.5);
  const buf = renderUtterance(u);
  return { id: spec.id, name: spec.name, dur: u.dur, grains: u.grains.length,
    f0: pitch(buf), centroid: centroid(buf), peak: peakAbs(buf), buf };
}

const gap = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.min(a, b));

/* ══════════════════════════════════════════════════════════════════════ */
/*  2. A WEBAUDIO THAT RECORDS WHAT IT WAS TOLD                           */
/* ══════════════════════════════════════════════════════════════════════ */

const chk = (v) => {
  if (!Number.isFinite(v)) throw new TypeError('The provided float value is non-finite.');
  return v;
};

class Param {
  constructor(v = 0) { this._v = v; this.calls = []; }
  get value() { return this._v; }
  set value(v) { this._v = chk(v); this.calls.push(['value', v, 0]); }
  setValueAtTime(v, t) { chk(v); chk(t); this.calls.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { chk(v); chk(t); this.calls.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) {
    chk(v); chk(t);
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime: target must not be 0');
    this.calls.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, tc) { chk(v); chk(t); chk(tc); this.calls.push(['tgt', v, t]); return this; }
  cancelScheduledValues(t) { chk(t); this.calls.push(['cancel', 0, t]); return this; }
  /** The last value this param was COMMANDED to move to. */
  last(kind) {
    for (let i = this.calls.length - 1; i >= 0; i--) if (!kind || this.calls[i][0] === kind) return this.calls[i][1];
    return null;
  }
}

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = new Set(); }
  connect(d) { this.outs.add(d); return d; }
  disconnect(d) { this.ctx.disconnected.push(this); if (d) this.outs.delete(d); else this.outs.clear(); }
}
class Src extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.onended = null; this._started = false; }
  start(when = 0) { chk(when); if (when < 0) throw new RangeError('negative start'); this._started = true; }
  stop(when = 0) { chk(when); if (!this._started) throw new Error('stop before start'); this._stopAt = when; this.ctx.running.push(this); }
}

class FakeCtx {
  constructor() {
    this.sampleRate = SR; this.currentTime = 0; this.state = 'running';
    this.disconnected = []; this.running = []; this.oscs = []; this.filters = []; this.bufsrcs = [];
    this.destination = new Node(this, 'destination');
    this.listener = {};
    for (const k of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) {
      this.listener[k] = new Param();
    }
  }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createBiquadFilter() {
    const n = new Node(this, 'biquad');
    n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.detune = new Param(0);
    this.filters.push(n);
    return n;
  }
  createDynamicsCompressor() {
    const n = new Node(this, 'comp');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    return n;
  }
  createConvolver() { const n = new Node(this, 'convolver'); n.buffer = null; n.normalize = true; return n; }
  createPanner() {
    const n = new Node(this, 'panner');
    n.panningModel = 'equalpower'; n.distanceModel = 'inverse';
    n.refDistance = 1; n.maxDistance = 1e4; n.rolloffFactor = 1;
    n.positionX = new Param(); n.positionY = new Param(); n.positionZ = new Param();
    return n;
  }
  createOscillator() {
    const n = new Src(this, 'osc');
    n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0);
    this.oscs.push(n);
    return n;
  }
  createBufferSource() {
    const n = new Src(this, 'bufsrc');
    n.buffer = null; n.loop = false; n.playbackRate = new Param(1);
    this.bufsrcs.push(n);
    return n;
  }
  createBuffer(channels, length, rate) {
    chk(length); chk(rate);
    const data = [];
    for (let i = 0; i < channels; i++) data.push(new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
      getChannelData: (i) => data[i] };
  }
  advance(dt) {
    this.currentTime += dt;
    const still = [];
    for (const s of this.running) {
      if (s._stopAt <= this.currentTime) { try { s.onended?.(); } catch {} } else still.push(s);
    }
    this.running = still;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

function engine() {
  const prev = globalThis.AudioContext;
  let made = null;
  globalThis.AudioContext = function () { made = new FakeCtx(); return made; };
  const a = new AudioEngine();
  try { a.init(); } finally { globalThis.AudioContext = prev; }
  a._listenerPos.set(0, 0, 0);
  a._lastWake = -1e9;
  // Clear the ambience's own nodes out of the way so a count means what it says.
  made.oscs.length = 0; made.filters.length = 0; made.bufsrcs.length = 0;
  return { a, ctx: made };
}

/** An audio engine stand-in that only records. */
function recorder() {
  return {
    _listenerPos: new THREE.Vector3(),
    calls: [], lines: [], levels: [],
    footfall(pos, o = {}) { this.calls.push({ fn: 'footfall', x: pos.x, z: pos.z, ...o }); },
    // What a rigged humanoid's own hook plays: the flat reference boot. It is
    // recorded separately from footfall() so a check can tell the two apart —
    // the whole question about a body's weight is which of them it got.
    step(pos, surface, run) { this.calls.push({ fn: 'step', x: pos.x, surface, run, mass: 80 }); },
    servo(pos, effort, size) { this.calls.push({ fn: 'servo', effort, size }); },
    breath(pos, o = {}) { this.calls.push({ fn: 'breath', ...o }); },
    bodyThump(pos, mass) { this.calls.push({ fn: 'thump', mass }); },
    speak(spec, kind, o = {}) { this.lines.push({ id: spec.id, kind, self: !!o.self, gain: o.gain }); return 0.3; },
    setVoiceLevel(v) { this.levels.push(v); },
    of(fn) { return this.calls.filter(c => c.fn === fn); },
  };
}

/* ══════════════════════════════════════════════════════════════════════ */

export async function run({ check, assert }) {

  /* ────────────────────────────────────────────────────────────────────
   * THE ONE THAT MATTERS
   * ──────────────────────────────────────────────────────────────────── */

  check('voices: no two archetypes measure the same voice', () => {
    const rows = ALL_VOICES.map(s => profile(s, 'kill'));
    // Every pair has to be separated on pitch OR on colour, and by a margin a
    // listener could actually name — 12% of pitch is a bit over a whole tone.
    const bad = [];
    let weakest = { sep: Infinity };
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        const df = gap(a.f0, b.f0), dc = gap(a.centroid, b.centroid);
        const sep = Math.max(df, dc);
        if (sep < weakest.sep) weakest = { sep, pair: `${a.id}/${b.id}`, df, dc };
        if (df < 0.12 && dc < 0.18) {
          bad.push(`${a.id} and ${b.id} are the same voice (${df * 100 | 0}% pitch, ${dc * 100 | 0}% colour)`);
        }
      }
    }
    assert(!bad.length, bad.join('; '));
    assert(rows.every(r => r.f0 > 20), `a voice rendered with no pitch at all: ${rows.filter(r => !(r.f0 > 20)).map(r => r.id)}`);
    assert(rows.every(r => r.peak > 0.01), 'a voice rendered silent');
    return rows.map(r => `${r.id} ${r.f0.toFixed(0)}Hz/${(r.centroid / 1000).toFixed(2)}k/${(r.dur * 1000) | 0}ms`).join('  ')
      + `  — weakest pair ${weakest.pair} at ${(weakest.sep * 100).toFixed(0)}%`;
  });

  check('voices: the five the player can choose differ on pitch AND on colour AND in tempo', () => {
    // Stricter than the room: these are the five a player will A/B against each
    // other in the options screen, so "different enough to tell apart in a
    // fight" is not the bar — "obviously a different person" is.
    const rows = PLAYER_VOICES.map(s => profile(s, 'kill'));
    let minF = Infinity, minC = Infinity, fp = '', cp = '';
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const df = gap(rows[i].f0, rows[j].f0), dc = gap(rows[i].centroid, rows[j].centroid);
        if (df < minF) { minF = df; fp = `${rows[i].id}/${rows[j].id}`; }
        if (dc < minC) { minC = dc; cp = `${rows[i].id}/${rows[j].id}`; }
      }
    }
    assert(minF >= 0.14, `closest pitch pair ${fp} is only ${(minF * 100).toFixed(1)}% apart`);
    assert(minC >= 0.15, `closest colour pair ${cp} is only ${(minC * 100).toFixed(1)}% apart`);
    // Cadence is the third axis and the one a table of formants would forget:
    // the same line has to take measurably longer in a slow voice.
    const durs = rows.map(r => r.dur);
    const spread = Math.max(...durs) / Math.min(...durs);
    assert(spread >= 1.6, `the same line takes ${spread.toFixed(2)}× as long in the slowest voice as the fastest`);
    // …and the ordering has to survive every line kind, or "cadence" is one
    // number that happens to differ on one phrase.
    for (const kind of ['effort', 'die', 'boss']) {
      const d = PLAYER_VOICES.map(s => utterance(s, kind, 0.5).dur);
      assert(Math.max(...d) / Math.min(...d) >= 1.6, `on '${kind}' the tempo spread collapses to ${(Math.max(...d) / Math.min(...d)).toFixed(2)}×`);
    }
    return `pitch ${rows.map(r => r.f0.toFixed(0)).join('/')} Hz · colour `
      + `${rows.map(r => (r.centroid / 1000).toFixed(2)).join('/')} kHz · `
      + `closest ${(minF * 100).toFixed(0)}% pitch, ${(minC * 100).toFixed(0)}% colour, tempo ${spread.toFixed(2)}×`;
  });

  check('voices: every trigger the brief names produces a different line', () => {
    // A picker with one utterance behind eight triggers is the same lie one
    // level down: a kill, a boss and a death cannot be the same noise.
    const spec = voiceAt(0);
    const want = ['effort', 'hurt', 'land', 'die', 'kill', 'streak', 'boss', 'low'];
    for (const k of want) assert(LINES[k], `there is no line for '${k}'`);
    const rows = want.map(k => ({ k, ...profile(spec, k) }));
    const seen = new Map();
    for (const r of rows) {
      const sig = `${r.grains}|${r.dur.toFixed(3)}`;
      assert(!seen.has(sig), `'${r.k}' and '${seen.get(sig)}' are the same line`);
      seen.set(sig, r.k);
    }
    // and the contours actually differ in shape, not only in length
    const f = rows.map(r => r.f0);
    assert(Math.max(...f) / Math.min(...f) > 1.15,
      `every line sits at the same pitch (${f.map(x => x.toFixed(0)).join('/')})`);
    return rows.map(r => `${r.k} ${(r.dur * 1000) | 0}ms/${r.grains}g`).join('  ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE MEASUREMENT DESCRIBES THE GAME
   * ──────────────────────────────────────────────────────────────────── */

  check('voices: the engine builds exactly the line that was measured', () => {
    // The offline renderer is only worth anything if the browser plays the same
    // thing. Both are downstream of one grain list, and this is the proof:
    // every voiced grain becomes an oscillator of that type starting at that
    // frequency and gliding to that one, every breath grain becomes a noise
    // source, and each carries the filter the grain asked for.
    const { a, ctx } = engine();
    const spec = voiceAt(2);
    const u = utterance(spec, 'boss', 0.5);
    const before = a.voices;
    const dur = a.speak(spec, 'boss', { vary: 0.5 });
    assert(dur > 0, 'the engine refused to speak at all');
    assert(Math.abs(dur - u.dur) < 1e-9, `the engine says ${dur}s and the grain list says ${u.dur}s`);
    assert(a.voices - before === 1,
      `one line cost ${a.voices - before} pool voices — an utterance is one sound, not ${u.grains.length}`);

    const voiced = u.grains.filter(g => g.src !== 'noise');
    const breaths = u.grains.filter(g => g.src === 'noise');
    assert(ctx.oscs.length === voiced.length,
      `${voiced.length} voiced grains produced ${ctx.oscs.length} oscillators`);
    assert(ctx.bufsrcs.length === breaths.length,
      `${breaths.length} breath grains produced ${ctx.bufsrcs.length} noise sources`);
    assert(ctx.filters.length === u.grains.length,
      `${u.grains.length} grains produced ${ctx.filters.length} filters`);

    for (let i = 0; i < voiced.length; i++) {
      const g = voiced[i], o = ctx.oscs[i];
      assert(o.type === g.src, `grain ${i} is a ${g.src} and the engine built a ${o.type}`);
      const start = o.frequency.calls.find(c => c[0] === 'set');
      const glide = o.frequency.calls.find(c => c[0] === 'exp');
      assert(start && Math.abs(start[1] - Math.max(20, g.f0)) < 1e-6,
        `grain ${i} starts at ${g.f0.toFixed(1)} Hz and the engine set ${start && start[1]}`);
      assert(glide && Math.abs(glide[1] - Math.max(20, g.f1)) < 1e-6,
        `grain ${i} glides to ${g.f1.toFixed(1)} Hz and the engine set ${glide && glide[1]}`);
    }
    for (let i = 0; i < u.grains.length; i++) {
      const g = u.grains[i], f = ctx.filters[i];
      assert(f.type === g.filter.type, `grain ${i} wants a ${g.filter.type} and got a ${f.type}`);
      assert(Math.abs(f.frequency.value - g.filter.freq) < 1e-6,
        `grain ${i} formant is ${g.filter.freq} and the filter is at ${f.frequency.value}`);
      assert(Math.abs(f.Q.value - g.filter.q) < 1e-6, `grain ${i} Q is ${g.filter.q}, filter has ${f.Q.value}`);
    }
    return `${u.grains.length} grains → ${ctx.oscs.length} osc + ${ctx.bufsrcs.length} noise + `
      + `${ctx.filters.length} filters, 1 pool voice, ${(u.dur * 1000) | 0}ms`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * IT CANNOT TURN INTO MUD
   * ──────────────────────────────────────────────────────────────────── */

  check('voices: three at once is the ceiling, and they duck under each other', () => {
    const { a } = engine();
    const spec = voiceAt(0);
    const d1 = a.speak(ENEMY_VOICES.droid, 'alarm', { gain: 1 });
    const d2 = a.speak(ENEMY_VOICES.trooper, 'alarm', { gain: 1 });
    const d3 = a.speak(ENEMY_VOICES.sith, 'scream', { gain: 1 });
    assert(d1 > 0 && d2 > 0 && d3 > 0, 'the engine refused one of the first three lines');
    const denied0 = a.stats.speechDenied;
    const d4 = a.speak(ENEMY_VOICES.beast, 'scream', { gain: 1 });
    assert(d4 === 0, 'a fourth concurrent line was allowed — that is the mud');
    assert(a.stats.speechDenied === denied0 + 1, 'the refusal was not counted');
    assert(a.speaking === 3, `${a.speaking} lines are live`);

    // The stack: the first at full, the rest under it. Three lines are 2.10
    // of a line's amplitude and not 3.00 — a 30% saving before any compressor.
    const levels = a._speech.map(e => e.bus.gain.value);
    assert(Math.abs(levels[0] - 1) < 1e-9, `the first line is at ${levels[0]}, not full`);
    for (let i = 1; i < levels.length; i++) {
      assert(levels[i] < 0.6, `line ${i + 1} is at ${levels[i]} — it is not ducking under the first`);
    }
    const sum = levels.reduce((x, y) => x + y, 0);
    assert(sum < 2.4, `three lines sum to ${sum.toFixed(2)} of a line`);

    // …and the PLAYER talks over the room.
    const said = a.speak(spec, 'kill', { gain: 1, self: true });
    assert(said === 0, 'the cap let a fourth line through for the player too');
    a._speech.length = 0;                       // clear and try it properly
    a.voices = 0;
    const enemy = a.speak(ENEMY_VOICES.droid, 'alarm', { gain: 1 });
    const mine = a.speak(spec, 'kill', { gain: 1, self: true });
    assert(enemy > 0 && mine > 0, 'the two-line case was refused');
    const droid = a._speech.find(e => !e.self);
    assert(droid && droid.ducked, 'the player spoke and the droid did not duck');
    const to = droid.bus.gain.last('tgt');
    assert(to !== null && to <= droid.level * 0.4,
      `the droid was ducked to ${to} from ${droid.level} — that is not out of the way`);
    return `cap 3 (4th refused), stack ${levels.map(l => l.toFixed(2)).join('+')} = ${sum.toFixed(2)}, `
      + `enemy ducked ${droid.level.toFixed(2)} → ${to.toFixed(2)} under the player`;
  });

  check('voices: speech holds the room down while it is speaking, and lets it up after', () => {
    const { a, ctx } = engine();
    assert(a.duckLevel() === 1, 'the effects bus is ducked before anything has been said');
    const dur = a.speak(voiceAt(1), 'boss', { gain: 1, self: true });
    assert(dur > 0, 'nothing was said');
    assert(a.duckLevel() < 0.8, `the room stayed at ${a.duckLevel()} while a line was playing`);
    const cmd = a.sfxBus.gain.calls.filter(c => c[0] === 'tgt');
    assert(cmd.length >= 2, 'the duck was never scheduled on the effects bus');
    assert(cmd[0][1] < 0.8 && cmd[cmd.length - 1][1] === 1,
      `the duck goes to ${cmd[0][1]} and comes back to ${cmd[cmd.length - 1][1]}`);
    ctx.advance(dur + 0.3);
    assert(a.duckLevel() === 1, 'the room never came back up after the line finished');
    // A second, longer line while the first is playing must EXTEND the duck
    // rather than let the room up underneath it.
    const t0 = a._duckUntil;
    a.speak(voiceAt(1), 'die', { gain: 1 });
    assert(a._duckUntil > t0, 'a second line did not extend the duck');
    return `sfx ${cmd[0][1]} while speaking, back to 1 after ${(dur + 0.3).toFixed(2)}s, extended by the next line`;
  });

  check('voices: a fight full of talking gives every voice back', () => {
    const { a, ctx } = engine();
    const pos = V(3, 1, 0);
    for (let f = 0; f < 2400; f++) {              // 40 s at 60 Hz
      if (f % 17 === 0) a.speak(ENEMY_VOICES.droid, 'chatter', { pos });
      if (f % 53 === 0) a.speak(ENEMY_VOICES.trooper, 'alarm', { pos });
      if (f % 91 === 0) a.speak(voiceAt(f % 5), 'kill', { pos, self: true });
      if (f % 7 === 0) a.step(pos, 'sand');
      if (f % 29 === 0) a.clash(pos, 1);
      ctx.advance(1 / 60);
    }
    const mid = a.voices;
    ctx.advance(6);
    a._retireSpeech();
    assert(a.voices === 0, `${a.voices} of ${a.maxVoices} voices never came back`);
    assert(a.speaking === 0, `${a.speaking} utterances are still on the books`);
    assert(a.stats.alloc === a.stats.freed, `alloc ${a.stats.alloc} vs freed ${a.stats.freed}`);
    assert(a.stats.threw === 0, `${a.stats.threw} lines threw mid-build`);
    assert(a.stats.spoke > 100, `only ${a.stats.spoke} lines were spoken over 40 s`);
    assert(a.duckLevel() === 1, 'the room is still ducked with nobody speaking');
    return `${a.stats.spoke} lines spoken, ${a.stats.speechDenied} refused, ${mid} voices live mid-fight, 0 after`;
  });

  /**
   * THE ONE CONTROL WHOSE ENTIRE PURPOSE IS AUDITIONING.
   *
   * The options screen's voice slider is bound to `input`, which fires on every
   * step of a drag, and its handler opened with `if (audio.speaking > 0)
   * return;`. A 'streak' line runs 0.35–0.80 s across the five archetypes, and
   * a drag from The Negotiator to The Sage fires five `input` events inside a
   * few hundred milliseconds — so the FIRST one played and the other four were
   * dropped, including the one the player let go on. The name and the blurb
   * said The Sage; what the player heard was The Mask. There is no
   * `change`-event re-fire on release to save it.
   *
   * audition() is the fix, and this is what it has to do: speak at once on the
   * first move (a slider CLICK has to answer immediately or it reads as
   * broken), then say the LAST index once the hand has stopped — and not stack
   * five lines on top of each other to do it, which is the mud the speech rules
   * exist to prevent.
   */
  check('voices: dragging the voice slider auditions the voice you land on', async () => {
    const { a } = engine();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const said = [];
    const real = a.speak.bind(a);
    a.speak = (spec, kind, o) => { const d = real(spec, kind, o); if (d > 0) said.push(spec.id); return d; };

    // A drag across the whole table. The five `input` events are delivered in
    // one go on purpose: a browser hands them to the same thread this handler
    // runs on, so nothing can fire between them, and it makes the measurement
    // independent of how long the machine running this check took to schedule
    // anything.
    for (let i = 0; i < PLAYER_VOICES.length; i++) a.audition(voiceAt(i), 'streak', { gain: 1, self: true });
    assert(said.length === 1, `${said.length} lines played DURING the drag — they are on top of each other`);
    assert(said[0] === PLAYER_VOICES[0].id, `the drag opened with ${said[0]}, not the voice it started on`);

    await sleep(320);                                    // the hand lets go
    const want = PLAYER_VOICES[PLAYER_VOICES.length - 1].id;
    assert(said[said.length - 1] === want,
      `the slider was released on ${want} and what spoke was ${said[said.length - 1]}`);
    assert(said.length === 2, `a five-step drag said ${said.length} lines (${said.join(', ')})`);

    // the line the drag opened with is out of the way, and the one the player
    // chose is at full level rather than ducked to SPEECH_STACK under it
    const first = a._speech.find(e => e.id === said[0]);
    const last = a._speech.find(e => e.id === want);
    assert(first && first.bus.gain.last('tgt') <= 0.001,
      `the first line is still at ${first ? first.bus.gain.last('tgt') : 'gone'} under the chosen one`);
    assert(last && Math.abs(last.level - 1) < 1e-9,
      `the chosen voice came in at ${last ? last.level : 0}, not full level`);
    assert(a.stats.speechDenied === 0, `${a.stats.speechDenied} audition lines were refused by the cap`);
    return `five ${PLAYER_VOICES.length}-step drag → ${said.join(' then ')}, `
      + `first faded to ${first.bus.gain.last('tgt')}, chosen at ${last.level}`;
  });

  check('voices: a line nobody can hear is not worth a voice', () => {
    const { a } = engine();
    const v0 = a.voices;
    a.speak(voiceAt(0), 'kill', { pos: V(600, 0, 0) });
    assert(a.voices === v0, 'a line 600 m away took a voice');
    assert(a.stats.culled > 0, 'the cull was not counted');
    a.speak(voiceAt(0), 'kill', { pos: V(4, 0, 0) });
    assert(a.voices === v0 + 1, 'a line four metres away was culled');
    // and the mixer is a real off switch, not a quiet one
    const { a: b } = engine();
    b.setVoiceLevel(0);
    assert(b.speak(voiceAt(0), 'kill', {}) === 0, 'the voice mixer at zero still spent a voice');
    assert(b.voices === 0, 'a muted line took a pool voice anyway');
    return 'culled at 600 m, kept at 4 m, mixer at 0 spends nothing';
  });

  /* ────────────────────────────────────────────────────────────────────
   * BODIES
   * ──────────────────────────────────────────────────────────────────── */

  check('presence: a heavier body lands lower, louder and longer', () => {
    const { a } = engine();
    const seen = [];
    const realNoise = a.noise.bind(a), realTone = a.tone.bind(a);
    a.noise = (o) => { seen.push({ k: 'noise', ...o }); return realNoise(o); };
    a.tone = (o) => { seen.push({ k: 'tone', ...o }); return realTone(o); };

    const rows = [];
    for (const mass of [52, 80, 130, 210, 900, 1400]) {
      seen.length = 0;
      a.footfall(V(2, 0, 0), { surface: 'sand', mass });
      const boot = seen.find(s => s.k === 'noise');
      const sub = seen.find(s => s.k === 'tone');
      rows.push({ mass, freq: boot.freq, gain: boot.gain, dur: boot.dur, sub: sub ? sub.freq : null });
    }
    for (let i = 1; i < rows.length; i++) {
      assert(rows[i].freq < rows[i - 1].freq,
        `${rows[i].mass} kg lands at ${rows[i].freq.toFixed(0)} Hz, ${rows[i - 1].mass} kg at ${rows[i - 1].freq.toFixed(0)}`);
      assert(rows[i].gain > rows[i - 1].gain, `${rows[i].mass} kg is not louder than ${rows[i - 1].mass} kg`);
      assert(rows[i].dur > rows[i - 1].dur, `${rows[i].mass} kg is not longer than ${rows[i - 1].mass} kg`);
    }
    // A spread, not a rounding difference: the acklay is an octave under the B1.
    const spread = rows[0].freq / rows[rows.length - 1].freq;
    assert(spread > 1.9, `52 kg to 1400 kg only moves the band ${spread.toFixed(2)}×`);
    assert(rows[0].sub === null && rows[1].sub === null,
      'a trooper-weight footstep is spending a second voice on ground shake');
    assert(rows[rows.length - 1].sub !== null, 'a 1400 kg body does not shake the ground');
    assert(rows[rows.length - 1].sub < 60, `the acklay's ground shake is at ${rows[rows.length - 1].sub} Hz — that is heard, not felt`);
    return rows.map(r => `${r.mass}kg ${r.freq.toFixed(0)}Hz/${r.gain.toFixed(3)}/${(r.dur * 1000).toFixed(0)}ms${r.sub ? `+${r.sub.toFixed(0)}Hz` : ''}`).join('  ');
  });

  /**
   * "A beast's breath is not a man's slowed down, it is the same shape an
   * octave and a half lower WITH MORE OF IT." — src/engine/Audio.js, breath().
   *
   * It used to be less of it. The level was multiplied by `pitch` along with
   * the frequency, and Presence passes 0.42 for a beast and 1.15 for a trooper,
   * so the size of the animal was an inverse volume control: measured against
   * the shipped hearing floor, an idling 1400 kg acklay was audible for 4.6 m
   * and an idling 78 kg man in a helmet for 12.3 m. 4.6 m is inside the
   * acklay's own 2.5–5 m preferred strike range — you could only hear it
   * breathe once it was already on you.
   *
   * The radius is measured, not derived: a distance is audible if breath() at
   * that distance still takes a voice instead of being culled.
   */
  check('presence: the bigger the chest, the further the breath carries', () => {
    const { a } = engine();
    const audible = (d, pitch, effort) => {
      const c0 = a.stats.culled;
      a.breath(V(d, 0, 0), { out: true, effort, pitch });
      return a.stats.culled === c0;
    };
    const radius = (pitch, effort) => {
      let lo = 0, hi = 400;
      if (!audible(lo, pitch, effort)) return 0;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (audible(mid, pitch, effort)) lo = mid; else hi = mid;
      }
      return lo;
    };
    // the three airways Presence._breath actually passes
    const rows = [];
    for (const [name, pitch] of [['acklay', 0.42], ['acolyte', 1.0], ['trooper', 1.15]]) {
      rows.push({ name, pitch, idle: radius(pitch, 0), hard: radius(pitch, 1) });
    }
    const [beast, human, trooper] = rows;
    for (const k of ['idle', 'hard']) {
      assert(beast[k] > human[k], `at ${k} the 1400 kg acklay carries ${beast[k].toFixed(1)} m `
        + `and a person carries ${human[k].toFixed(1)} m — the biggest chest is the quietest`);
      assert(human[k] > trooper[k], `a bare throat (${human[k].toFixed(1)} m) does not out-carry `
        + `a helmet (${trooper[k].toFixed(1)} m) at ${k}`);
    }
    // …and it has to reach past the thing's own reach. An acklay engages at
    // 2.5–5 m (ARCHETYPES.beast.preferred); a tell you only get inside that is
    // not a tell.
    assert(beast.idle > 10, `an idling acklay is audible for ${beast.idle.toFixed(1)} m, `
      + 'and it kills you from 5');
    // and a breath is still chatter-priority, not a clash
    assert(beast.hard < 90, `an acklay's breath carries ${beast.hard.toFixed(0)} m — that is a detonation`);
    return rows.map(r => `${r.name} ${r.idle.toFixed(1)}/${r.hard.toFixed(1)} m`).join('  ')
      + '  (idle/full exertion)';
  });

  check('presence: the footstep the game already had did not change', () => {
    // footfall() is where step() now goes, and step() is the sound the pool
    // arithmetic in tools/checks/audio.mjs is written against. At the reference
    // mass every factor is exactly 1, and these are the numbers it always had.
    const { a } = engine();
    const seen = [];
    const realNoise = a.noise.bind(a);
    a.noise = (o) => { seen.push(o); return realNoise(o); };
    a.step(V(2, 0, 0), 'sand');
    a.step(V(2, 0, 0), 'stone', true);
    const [walk, run] = seen;
    assert(seen.length === 2, `step() now makes ${seen.length / 2} sounds per footfall`);
    assert(walk.freq === 1500 && walk.q === 0.7 && Math.abs(walk.gain - 0.09) < 1e-12 && Math.abs(walk.dur - 0.1) < 1e-12,
      `sand walk is ${walk.freq}/${walk.q}/${walk.gain}/${walk.dur}, was 1500/0.7/0.09/0.1`);
    assert(run.freq === 2600 && Math.abs(run.gain - 0.11 * 1.5) < 1e-12 && Math.abs(run.dur - 0.13) < 1e-12,
      `stone run is ${run.freq}/${run.gain}/${run.dur}, was 2600/0.165/0.13`);
    assert(walk.prio === PRIO.chatter, 'a footstep left the chatter band');
    return 'sand 1500Hz/0.09/100ms, stone run 2600Hz/0.165/130ms — unchanged at 80 kg';
  });

  /**
   * THE ROSTER THE GAME ACTUALLY BUILDS, which is not the one this used to use.
   *
   * The previous version of this check built one of each family "none of them
   * rigged (so the gait path drives them and nothing depends on a
   * BipedAnimator)" and reported, in its own summary line, "73 footfalls over 6
   * masses (52/78/82/210/900/1400 kg)". Three of those six masses cannot happen
   * in the shipped game. Every humanoid archetype in src/game/Enemy.js — b1 52,
   * b2 130, trooper 78, sniper 76, acolyte 82, dummy 52, sparring 82 — is built
   * with a rig, and Enemy._build installs a BipedAnimator whose `onFootstep`
   * plays `audio.step` (the flat 80 kg boot) and puffs sand. Presence sees the
   * animator, WRAPS it (Presence._wrap), and marks `st.wrapped`, which is
   * exactly what turns the gait path off for those bodies — by design, and the
   * better design: the rig knows the frame a sole lands on, and a gait derived
   * from position is guessing. So the mass layer reaches only what the rig does
   * not carry, and the check has to be pointed at that arrangement or it is
   * certifying a configuration nobody ships.
   *
   * Measured against the real Presence, this is what the game produces:
   *   b1 52 / trooper 78 / sniper 76 / acolyte 82 → the 80 kg boot, no layer
   *   b2 130                                       → the boot AND its own 130 kg
   *   droideka 210 / walker 900 / beast 1400       → their own mass, gait path
   */
  check('presence: every body in the room makes a sound, on the path the game uses', () => {
    const rec = recorder();
    const p = new Presence(rec);
    const mk = (type, A, x, rigged) => {
      const e = { type, A, position: V(x, 0, 0), hp: A.hp, maxHp: A.hp, dead: false, lod: 0 };
      // exactly what src/game/Enemy.js:741-747 installs on a humanoid
      if (rigged) e.animator = { onFootstep: (pt) => rec.step(pt, 'sand', false) };
      return e;
    };
    const world = {
      settings: { enemyBody: true }, terrain: null,
      enemies: [
        mk('b1', { mass: 52, scale: 1.02, hp: 28 }, 3, true),
        mk('b2', { mass: 130, scale: 1.18, hp: 96 }, 4, true),
        mk('acolyte', { mass: 82, scale: 1.04, hp: 130 }, 5, true),
        mk('droideka', { mass: 210, scale: 1.5, hp: 170 }, 6, false),
        mk('walker', { mass: 900, scale: 2.4, hp: 620, big: true }, 7, false),
        mk('beast', { mass: 1400, scale: 2.9, hp: 900, boss: true }, 9, false),
      ],
    };
    for (let f = 0; f < 240; f++) {
      for (const e of world.enemies) {
        e.position.x += 3.4 / 60;                    // everything walking
        // The rig plants a sole about every 0.42 s at this speed.
        if (e.animator && f % 25 === 0) e.animator.onFootstep(e.position);
      }
      p.update(1 / 60, world);
    }
    const boots = rec.of('step');
    const weight = rec.of('footfall');
    const servos = rec.of('servo');
    const breaths = rec.of('breath');
    assert(boots.length > 0, 'no rigged body planted a foot in four seconds of walking');
    assert(weight.length > 0, 'nothing unrigged took a step in four seconds of walking');
    assert(servos.length > 0, 'no droid made a servo sound');
    assert(breaths.length > 0, 'nothing organic breathed');

    const masses = [...new Set(weight.map(s => s.mass))].sort((x, y) => x - y);
    // The three the gait path owns, and the one the rig's hook adds under it.
    for (const m of [130, 210, 900, 1400]) {
      assert(masses.includes(m), `nothing landed at ${m} kg (${masses.join(', ')} did)`);
    }
    // …and NOTHING near the reference weight took a second footfall: a rigged
    // 78 kg trooper already has a boot, and a mass layer under it is a flam.
    const doubled = masses.filter(m => m > 60 && m < 95);
    assert(doubled.length === 0, `${doubled.join('/')} kg landed twice on one foot plant`);

    // droids do not breathe and organics do not whine
    assert(!breaths.some(b => b.pitch === undefined), 'a breath arrived with no airway size');
    assert(breaths.some(b => b.pitch < 0.6), 'the acklay never breathed');
    return `${boots.length} rigged foot plants at 80 kg + ${weight.length} own-mass footfalls `
      + `over ${masses.length} masses (${masses.join('/')} kg), ${servos.length} servos, `
      + `${breaths.length} breaths in 4 s`;
  });

  check('presence: twenty bodies cost no more than six', () => {
    const rec = recorder();
    const p = new Presence(rec);
    const enemies = [];
    for (let i = 0; i < 20; i++) {
      enemies.push({ type: 'b1', A: { mass: 130, scale: 1, hp: 28 }, position: V(2 + i * 0.4, 0, 0),
        hp: 28, maxHp: 28, dead: false, lod: 0 });
    }
    // …and ten more well outside earshot, which must cost nothing at all
    for (let i = 0; i < 10; i++) {
      enemies.push({ type: 'b1', A: { mass: 130, scale: 1, hp: 28 }, position: V(200 + i, 0, 0),
        hp: 28, maxHp: 28, dead: false, lod: 0 });
    }
    const world = { settings: { enemyBody: true }, enemies, terrain: null };
    for (let f = 0; f < 120; f++) {
      for (const e of enemies) e.position.x += 3 / 60;
      p.update(1 / 60, world);
    }
    assert(p.stats.bodies <= MAX_BODIES, `${p.stats.bodies} bodies were audible at once, cap is ${MAX_BODIES}`);
    assert(p.state.size <= MAX_BODIES, `${p.state.size} bodies are being tracked`);
    assert(p.stats.culled > 0, 'nothing was culled — the budget is not being spent');
    // Two seconds of twenty droids must not be able to fill a 44-voice pool.
    const perSecond = rec.calls.length / 2;
    assert(perSecond < 90, `${perSecond.toFixed(0)} body sounds a second from twenty droids`);
    const far = rec.of('footfall').some(c => c.x > 100);
    assert(!far, 'something 200 m away made a footstep');
    return `20 near + 10 far → ${p.stats.bodies} audible, ${rec.calls.length} sounds in 2 s `
      + `(${perSecond.toFixed(0)}/s), ${p.stats.culled} culled`;
  });

  check('presence: the enemy-body switch is a reader, not a label', () => {
    const build = () => ({
      settings: { enemyBody: true }, terrain: null,
      enemies: [{ type: 'walker', A: { mass: 900, scale: 2.4, hp: 620 }, position: V(4, 0, 0),
        hp: 620, maxHp: 620, dead: false, lod: 0 }],
    });
    const drive = (on) => {
      const rec = recorder();
      const p = new Presence(rec);
      const w = build();
      w.settings.enemyBody = on;
      for (let f = 0; f < 300; f++) { w.enemies[0].position.x += 3 / 60; p.update(1 / 60, w); }
      return rec.calls.length;
    };
    const on = drive(true), off = drive(false);
    assert(on > 0, 'with the switch ON a walking 900 kg walker made no sound at all');
    assert(off === 0, `with the switch OFF it still made ${off} sounds`);
    // and it is read LIVE, mid-frame, not captured at construction
    const rec = recorder();
    const p = new Presence(rec);
    const w = build();
    for (let f = 0; f < 150; f++) { w.enemies[0].position.x += 3 / 60; p.update(1 / 60, w); }
    const half = rec.calls.length;
    w.settings.enemyBody = false;
    for (let f = 0; f < 150; f++) { w.enemies[0].position.x += 3 / 60; p.update(1 / 60, w); }
    assert(rec.calls.length === half, `unticking it mid-run left ${rec.calls.length - half} sounds still coming`);
    return `on ${on} sounds / off ${off}, and unticking mid-run silences it on the next frame`;
  });

  check('presence: the rig footstep hook is wrapped once and never replaced', () => {
    // The weight layer rides the animator's own footfall so it lands on the
    // exact frame the sole does. Wrapping it every frame is a stack of closures
    // that grows until the enemy dies, and dropping the original takes the sand
    // puff with it — both have to be impossible.
    const rec = recorder();
    const p = new Presence(rec);
    let inner = 0;
    const animator = { onFootstep: () => { inner++; } };
    const enemy = { type: 'b2', A: { mass: 130, scale: 1.18, hp: 96 }, position: V(3, 0, 0),
      hp: 96, maxHp: 96, dead: false, lod: 0, animator };
    const world = { settings: { enemyBody: true }, terrain: null, enemies: [enemy] };
    for (let f = 0; f < 120; f++) { enemy.position.x += 3 / 60; p.update(1 / 60, world); }
    const wrapped = animator.onFootstep;
    for (let f = 0; f < 120; f++) { enemy.position.x += 3 / 60; p.update(1 / 60, world); }
    assert(animator.onFootstep === wrapped, 'the hook was wrapped a second time');

    animator.onFootstep(V(3, 0, 0));
    assert(inner === 1, `the rig's own footstep handler ran ${inner} times, not once`);
    assert(rec.of('footfall').length === 1, 'the weight layer did not land with it');
    assert(rec.of('footfall')[0].mass === 130, 'the weight layer used the wrong mass');

    // …and with the toggle off the rig's own hook still runs — the sand puff
    // is a particle effect and an audio switch must not take it away.
    world.settings.enemyBody = false;
    animator.onFootstep(V(3, 0, 0));
    assert(inner === 2, 'the toggle silenced the rig hook itself, taking the sand puff with it');
    assert(rec.of('footfall').length === 1, 'the weight layer played with the toggle off');
    return 'wrapped once, inner hook always called, weight layer gated';
  });

  check('presence: what a body IS, is read off the archetype', () => {
    const of = (type, A) => bodyOf({ type, A });
    assert(of('b1', { mass: 52 }).droid && !of('b1', {}).beast, 'a B1 is not a droid');
    assert(!of('acolyte', { mass: 82 }).droid, 'an acolyte is a droid');
    assert(of('beast', { mass: 1400 }).beast, 'an acklay is not a beast');
    assert(of('trooper', {}).trooper, 'a trooper is not a trooper');
    assert(of('walker', {}).legs === 4, 'the walker walks on two legs');
    assert(of('remote', { float: 1.55 }).grounded === false, 'a hovering remote has a gait');
    assert(of('b1', {}).mass === 80, 'an archetype with no mass did not fall back to a person');
    assert(of(undefined, undefined).mass === 80, 'bodyOf threw on nothing at all');
    return 'droid/organic/beast/trooper, legs, float and the 80 kg fallback';
  });

  /* ────────────────────────────────────────────────────────────────────
   * WHAT THE FIGHT SAYS
   * ──────────────────────────────────────────────────────────────────── */

  const mkPlayer = () => ({
    kills: 0, deflects: 0, perfects: 0, hp: 100, maxHp: 100, alive: true, grounded: true,
    velocity: { y: 0 }, saber: { tipSpeed: 0 }, chest: V(0, 1.4, 0), position: V(0, 0, 0),
  });
  const mkHud = () => ({ pops: [], popup(t, s, k) { this.pops.push({ t, s, k }); return {}; } });
  const mkWorld = (over = {}) => ({
    settings: { voiceIndex: 0, voiceLevel: 0.9, voiceLines: true, enemyVoices: true, popups: true, ...over },
    enemies: [],
  });

  check('announcer: the body speaks for itself — swing, hit, landing, death', () => {
    const kinds = [];
    const drive = (mutate) => {
      const rec = recorder();
      const an = new Announcer(rec);
      const w = mkWorld(), p = mkPlayer(), hud = mkHud();
      an.update(1 / 60, w, p, hud);                    // baseline
      mutate(p);
      an.update(1 / 60, w, p, hud);
      return rec.lines;
    };
    const swing = drive(p => { p.saber.tipSpeed = 30; });
    const hurt = drive(p => { p.hp = 74; });
    const land = drive(p => { p.grounded = false; p.velocity.y = -18; });
    // landing is a transition, so it needs the airborne frame first
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    an.update(1 / 60, w, p, hud);
    p.grounded = false; p.velocity.y = -19; an.update(1 / 60, w, p, hud);
    p.grounded = true; an.update(1 / 60, w, p, hud);
    const died = drive(p => { p.alive = false; });

    assert(swing.length === 1 && swing[0].kind === 'effort', `a 30 m/s swing said ${JSON.stringify(swing)}`);
    assert(hurt.length === 1 && hurt[0].kind === 'hurt', `taking 26 damage said ${JSON.stringify(hurt)}`);
    assert(rec.lines.length === 1 && rec.lines[0].kind === 'land',
      `a 19 m/s landing said ${JSON.stringify(rec.lines)}`);
    assert(died.length === 1 && died[0].kind === 'die', `dying said ${JSON.stringify(died)}`);
    assert(land.length === 0, 'a landing fired while still in the air');
    for (const l of [...swing, ...hurt, ...died]) assert(l.self, 'the player\'s own voice did not duck the room');

    // A slow blade is not an effort, and holding a fast one is ONE grunt.
    const rec2 = recorder();
    const an2 = new Announcer(rec2);
    const w2 = mkWorld(), p2 = mkPlayer(), hud2 = mkHud();
    an2.update(1 / 60, w2, p2, hud2);
    for (let f = 0; f < 120; f++) { p2.saber.tipSpeed = 30; an2.update(1 / 60, w2, p2, hud2); }
    assert(rec2.lines.length === 1, `two seconds of a held 30 m/s blade produced ${rec2.lines.length} grunts`);
    kinds.push('effort', 'hurt', 'land', 'die');
    return `${kinds.join(', ')} — and a held blade is one grunt, not 120`;
  });

  check('announcer: a killstreak is counted, popped once a rung, and it expires', () => {
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    an.update(1 / 60, w, p, hud);
    for (let k = 1; k <= 5; k++) { p.kills = k; an.update(1 / 60, w, p, hud); }
    const titles = hud.pops.map(x => x.t);
    for (const r of STREAKS.filter(r => r.at <= 5)) {
      assert(titles.includes(r.title), `five kills in a row never said ${r.title}`);
    }
    assert(titles.length === STREAKS.filter(r => r.at <= 5).length,
      `five kills produced ${titles.length} popups: ${titles.join(', ')}`);
    // …and the window closes
    for (let f = 0; f < 300; f++) an.update(1 / 60, w, p, hud);
    const expired = an.streak;
    assert(expired === 0, `the streak is still ${expired} five seconds after the last kill`);
    p.kills = 6;
    an.update(1 / 60, w, p, hud);
    assert(hud.pops.length === titles.length, 'a kill after the window still counted as a streak');

    // The quip budget is separate and much stingier than the popup.
    assert(rec.lines.length <= 2, `five kills produced ${rec.lines.length} voice lines`);
    return `${titles.join(' → ')}, streak ${expired} five seconds later, ${rec.lines.length} quips for 6 kills`;
  });

  check('announcer: a run of deflections is its own ladder, and a boss is an event', () => {
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    an.update(1 / 60, w, p, hud);
    for (let d = 1; d <= 6; d++) { p.deflects = d; an.update(1 / 60, w, p, hud); }
    const titles = hud.pops.map(x => x.t);
    assert(titles.includes(RETURNS[0].title) && titles.includes(RETURNS[1].title),
      `six deflections said ${titles.join(', ')}`);
    p.perfects = 1;
    an.update(1 / 60, w, p, hud);
    assert(hud.pops.some(x => x.t === 'PERFECT RETURN'), 'a perfect return said nothing');

    const boss = { type: 'beast', A: { boss: true, label: 'Acklay', mass: 1400 }, position: V(9, 0, 0),
      dead: false, hp: 900, maxHp: 900 };
    w.enemies.push(boss);
    an.update(1 / 60, w, p, hud);
    assert(hud.pops.some(x => x.t === 'ACKLAY'), 'a boss walked in and the HUD said nothing');
    an.update(1 / 60, w, p, hud);
    assert(hud.pops.filter(x => x.t === 'ACKLAY').length === 1, 'the boss announced itself every frame');
    return `${titles.join(' → ')}, perfect return, boss announced once`;
  });

  check('announcer: the room screams, calls you in, and breaks', () => {
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    const mk = (type, x) => ({ type, A: { mass: 80, label: type }, position: V(x, 0, 0),
      dead: false, hp: 10, maxHp: 10, target: null });
    const squad = [mk('b1', 3), mk('b1', 4), mk('trooper', 5), mk('acolyte', 6), mk('beast', 8)];
    w.enemies.push(...squad);
    an.update(1 / 60, w, p, hud);

    // spotting: each body calls out once, on the frame it acquires you
    for (const e of squad) e.target = p;
    for (let f = 0; f < 200; f++) an.update(1 / 60, w, p, hud);
    const alarms = rec.lines.filter(l => l.kind === 'alarm');
    assert(alarms.length >= 3, `five bodies acquiring the player produced ${alarms.length} alarm calls`);
    assert(alarms.length <= 5, `five bodies called out ${alarms.length} times — somebody is repeating`);
    const voicesHeard = new Set(alarms.map(l => l.id));
    assert(voicesHeard.size >= 2, `every enemy used the same voice: ${[...voicesHeard]}`);

    // dying: a droid powers down, a body screams — different lines
    rec.lines.length = 0;
    squad[0].dead = true; an.update(1 / 60, w, p, hud);
    for (let f = 0; f < 60; f++) an.update(1 / 60, w, p, hud);
    squad[3].dead = true; an.update(1 / 60, w, p, hud);
    for (let f = 0; f < 60; f++) an.update(1 / 60, w, p, hud);
    const deaths = rec.lines.filter(l => l.kind === 'die' || l.kind === 'scream');
    assert(deaths.length === 2, `two deaths produced ${deaths.length} lines`);
    assert(deaths[0].kind === 'die' && deaths[0].id === 'droid', 'a droid screamed instead of powering down');
    assert(deaths[1].kind === 'scream' && deaths[1].id === 'sith', 'an acolyte powered down instead of screaming');

    // panic: three of them gone inside the window and a survivor says so
    rec.lines.length = 0;
    squad[1].dead = true; an.update(1 / 60, w, p, hud);
    squad[2].dead = true; an.update(1 / 60, w, p, hud);
    for (let f = 0; f < 60; f++) an.update(1 / 60, w, p, hud);
    assert(rec.lines.some(l => l.kind === 'panic'),
      `the squad lost three bodies in a second and nobody panicked: ${rec.lines.map(l => l.kind).join(',')}`);

    // idle chatter: furniture, and furniture that only arrives when something
    // happens is not furniture. It must appear on its own with nothing going on.
    rec.lines.length = 0;
    const reinforcement = mk('b1', 5);
    reinforcement.target = p;
    w.enemies.push(reinforcement);
    for (let f = 0; f < 60 * 30; f++) an.update(1 / 60, w, p, hud);
    const idle = rec.lines.filter(l => l.kind === 'chatter');
    assert(idle.length >= 2, `thirty quiet seconds beside a live squad produced ${idle.length} droid lines`);
    assert(idle.length <= Math.ceil(30 / CHATTER_GAP) + 1,
      `${idle.length} chatter lines in thirty seconds — the droids never stop talking`);
    assert(idle.every(l => l.id === 'droid'), 'something that is not a droid is chattering');
    return `${alarms.length} alarms in ${voicesHeard.size} voices, droid powers down / body screams, `
      + `squad panics, ${idle.length} idle droid lines in 30 s`;
  });

  check('announcer: every switch is a reader — off means silent, and it is live', () => {
    // The exact failure mode tools/checks/controls.mjs was written for, one
    // layer down: a voice toggle that changes nothing is worse than no toggle.
    const drive = (over) => {
      const rec = recorder();
      const an = new Announcer(rec);
      const w = mkWorld(over), p = mkPlayer(), hud = mkHud();
      const enemy = { type: 'b1', A: { mass: 52, label: 'B1' }, position: V(3, 0, 0),
        dead: false, hp: 10, maxHp: 10, target: p };
      w.enemies.push(enemy);
      an.update(1 / 60, w, p, hud);
      p.kills = 1; p.hp = 60; p.saber.tipSpeed = 32; p.deflects = 3;
      an.update(1 / 60, w, p, hud);
      enemy.dead = true;
      an.update(1 / 60, w, p, hud);
      return { mine: rec.lines.filter(l => l.self), theirs: rec.lines.filter(l => !l.self), pops: hud.pops.length };
    };
    const all = drive({});
    const noMine = drive({ voiceLines: false });
    const noTheirs = drive({ enemyVoices: false });
    const noPops = drive({ popups: false });
    assert(all.mine.length > 0 && all.theirs.length > 0 && all.pops > 0,
      `with everything on: ${all.mine.length} own lines, ${all.theirs.length} enemy lines, ${all.pops} popups`);
    assert(noMine.mine.length === 0, `voiceLines off still said ${noMine.mine.length} of the player's lines`);
    assert(noMine.theirs.length > 0, 'turning off the player\'s voice also silenced the enemies');
    assert(noTheirs.theirs.length === 0, `enemyVoices off still said ${noTheirs.theirs.length} enemy lines`);
    assert(noTheirs.mine.length > 0, 'turning off enemy voices also silenced the player');
    assert(noPops.pops === 0, `popups off still produced ${noPops.pops} popups`);
    assert(noPops.mine.length > 0, 'turning off popups also silenced the voice');

    // the mixer reaches the engine, once per change and not once per frame
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld({ voiceLevel: 0.4 }), p = mkPlayer(), hud = mkHud();
    for (let f = 0; f < 60; f++) an.update(1 / 60, w, p, hud);
    assert(rec.levels.length === 1 && rec.levels[0] === 0.4,
      `the mixer was written ${rec.levels.length} times in 60 frames: ${rec.levels.join(',')}`);
    w.settings.voiceLevel = 0.1;
    an.update(1 / 60, w, p, hud);
    assert(rec.levels.length === 2 && rec.levels[1] === 0.1, 'moving the mixer did not reach the engine');
    return `all on: ${all.mine.length}+${all.theirs.length} lines, ${all.pops} popups; `
      + 'each switch off silences only its own half; mixer written on change only';
  });

  check('announcer: the chosen archetype is the one that speaks', () => {
    // The picker has to reach the synthesiser. Same event, five settings, five
    // different specs — and the ids have to be the ids of the table.
    const heard = [];
    for (let i = 0; i < PLAYER_VOICES.length; i++) {
      const rec = recorder();
      const an = new Announcer(rec);
      const w = mkWorld({ voiceIndex: i }), p = mkPlayer(), hud = mkHud();
      an.update(1 / 60, w, p, hud);
      p.alive = false;
      an.update(1 / 60, w, p, hud);
      assert(rec.lines.length === 1, `voice ${i} said ${rec.lines.length} lines on death`);
      heard.push(rec.lines[0].id);
    }
    assert(new Set(heard).size === PLAYER_VOICES.length,
      `five settings produced ${new Set(heard).size} distinct voices: ${heard.join(', ')}`);
    assert(heard.join(',') === PLAYER_VOICES.map(v => v.id).join(','),
      `the slider does not walk the table in order: ${heard.join(', ')}`);
    // and an out-of-range index is somebody's voice, not a crash
    assert(voiceAt(-1).id && voiceAt(99).id && voiceAt(NaN).id, 'a bad voice index has no voice');
    return heard.join(' → ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE SUM, AS AMPLITUDE
   * ──────────────────────────────────────────────────────────────────── */

  check('voices: three lines at once are one line loud, not three', () => {
    /**
     * The ducking rules as a WAVEFORM rather than as gain values.
     *
     * The worst case the game can produce: two droids calling out and the
     * player answering over them, all inside the same 400 ms. Rendered twice —
     * once at the levels the real engine assigns, once flat — and measured on
     * both energy and peak, because those answer different questions. Energy is
     * "how much of the mix is speech", which is what turns to mud; the peak is
     * what reaches the limiter.
     */
    const specs = [ENEMY_VOICES.droid, ENEMY_VOICES.trooper, voiceAt(0)];
    const kinds = ['alarm', 'alarm', 'kill'];
    const mix = (levels) => {
      const bufs = specs.map((s, i) => renderUtterance(utterance(s, kinds[i], 0.5), SR, levels[i]));
      const out = new Float32Array(Math.max(...bufs.map(b => b.length)));
      for (const b of bufs) for (let k = 0; k < b.length; k++) out[k] += b[k];
      let e = 0;
      for (let i = 0; i < out.length; i++) e += out[i] * out[i];
      return { peak: peakAbs(out), rms: Math.sqrt(e / out.length) };
    };
    const flat = mix([1, 1, 1]);

    // What the engine actually assigns, in the order the fight produces them.
    const { a } = engine();
    a.speak(specs[0], kinds[0], { gain: 1 });
    a.speak(specs[1], kinds[1], { gain: 1 });
    a.speak(specs[2], kinds[2], { gain: 1, self: true });
    const levels = a._speech.map(e => e.bus.gain.last('tgt') ?? e.bus.gain.value);
    const ducked = mix(levels);

    assert(a._speech[0].id === 'droid' && a._speech[0].ducked, 'the first droid never ducked under the player');
    assert(levels[2] > levels[0] && levels[2] > levels[1],
      `the player is at ${levels[2].toFixed(2)} under enemies at ${levels[0].toFixed(2)}/${levels[1].toFixed(2)}`);
    assert(ducked.rms < flat.rms * 0.75,
      `three ducked lines carry ${(ducked.rms / flat.rms * 100).toFixed(0)}% of three flat ones`);
    assert(ducked.peak < flat.peak * 0.85,
      `ducked peak ${ducked.peak.toFixed(3)} vs flat ${flat.peak.toFixed(3)}`);
    // and the whole stack has to stay near ONE line's worth of level
    const single = mix([1, 0, 0]);
    assert(ducked.peak < single.peak * 1.6,
      `three ducked lines peak at ${(ducked.peak / single.peak).toFixed(2)}× a single line`);
    return `levels ${levels.map(l => l.toFixed(2)).join('/')} (sum ${levels.reduce((x, y) => x + y).toFixed(2)} of 3.00) → `
      + `rms ${(ducked.rms / flat.rms * 100).toFixed(0)}% and peak ${(ducked.peak / flat.peak * 100).toFixed(0)}% of flat, `
      + `${(ducked.peak / single.peak).toFixed(2)}× one line`;
  });
}
