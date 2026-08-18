/**
 * BATTLEFRONT BORZ — five voices, or one voice with five labels?
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
import { Announcer, STREAKS, RETURNS, QUIP_GAP, CHATTER_GAP, LINE_LIFE, CHEER_DELAY, RALLY_GAP }
  from '../../src/ui/Announcer.js';

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
    // `pos` is recorded because a positional line and a non-positional one are
    // two different sounds: the room's voice must be somewhere you can turn
    // toward, and the player's must not be anywhere at all.
    speak(spec, kind, o = {}) {
      this.lines.push({ id: spec.id, kind, self: !!o.self, gain: o.gain, pos: o.pos || null });
      return 0.3;
    },
    setVoiceLevel(v) { this.levels.push(v); },
    of(fn) { return this.calls.filter(c => c.fn === fn); },
  };
}

/* ══════════════════════════════════════════════════════════════════════ */

export async function run({ check, assert }) {

  /**
   * THE REAL ROSTER, and why it is imported here rather than at the top.
   *
   * Dynamically, inside a function body, because src/game reaches Engine.js and
   * Engine.js rewrites three's ShaderChunks behind once-only flags — a static
   * edge from a checks file patches the copy of three that came out of
   * node_modules instead of the one out of vendor/ and burns the flag. See the
   * note at the head of tools/verify.mjs.
   *
   * Levels.js is imported for its SIDE EFFECT: it is where `bodyguard`,
   * `charger` and `stalker` are registered into ARCHETYPES, and those three are
   * precisely the ones the classifiers used to miss. A sweep of ARCHETYPES that
   * has not imported Levels.js is a sweep of eleven, which is the same eleven
   * the drifted key lists knew about — it would agree with the bug.
   */
  const { ARCHETYPES } = await import('../../src/game/Enemy.js');
  await import('../../src/game/Levels.js');
  const { TOUGHNESS } = await import('../../src/game/Combat.js');
  const { PLATE } = await import('../../src/engine/Presence.js');

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
    return `a ${PLAYER_VOICES.length}-step drag → ${said.join(' then ')}, `
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
    // The archetype's OWN record under each body, not a hand-written stand-in:
    // `bodyOf` reads `custom`, `toughness` and `saber` off it to decide motor or
    // lungs, and a partial record is a body the classifier cannot recognise.
    // The masses are pinned here because the assertions below name them.
    const A = (key, over) => ({ ...ARCHETYPES[key], ...over });
    const world = {
      settings: { enemyBody: true }, terrain: null,
      enemies: [
        mk('b1', A('b1', { mass: 52, scale: 1.02, hp: 28 }), 3, true),
        mk('b2', A('b2', { mass: 130, scale: 1.18, hp: 96 }), 4, true),
        mk('acolyte', A('acolyte', { mass: 82, scale: 1.04, hp: 130 }), 5, true),
        mk('droideka', A('droideka', { mass: 210, scale: 1.5, hp: 170 }), 6, false),
        mk('walker', A('walker', { mass: 900, scale: 2.4, hp: 620, big: true }), 7, false),
        mk('beast', A('beast', { mass: 1400, scale: 2.9, hp: 900, boss: true }), 9, false),
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

  /**
   * THE CLASSIFICATION IS A DERIVATION, NOT A LIST OF NAMES.
   *
   * This check used to hand `bodyOf` eight synthetic records keyed by name —
   * `of('b1', { mass: 52 })` — and it passed while the shipping game got three
   * of fourteen bodies wrong, because it only ever asked about the eleven the
   * hard-coded regexes already knew. `DROIDS` was
   * /^(b1|b2|droideka|walker|remote|dummy)$/ and `BEASTS` was /^(beast)$/;
   * `bodyguard`, `charger` and `stalker` are registered in src/game/Levels.js,
   * after those regexes were written, and all three came out as plain
   * humanoids: the 240 kg IG droid breathed instead of running its servos, and
   * the Reek and the Nexu breathed at a man's pitch (1.0, not the beast's 0.42)
   * and took two footfalls a stride instead of four.
   *
   * So: sweep the WHOLE table and assert against what each record DECLARES
   * rather than against a copy of the answer. Every one of these expectations
   * is computed from `A` — `custom`, `toughness`, `saber` — which is the same
   * derivation the shipped function performs, restated from the data's side.
   * A fourteenth archetype added tomorrow is covered without editing this file;
   * an archetype that declares nothing recognisable fails the last clause.
   */
  check('presence: what a body IS, is derived from the archetype record', () => {
    const keys = Object.keys(ARCHETYPES);
    assert(keys.length >= 14, `only ${keys.length} archetypes — Levels.js did not register its three`);
    for (const k of ['bodyguard', 'charger', 'stalker']) {
      assert(ARCHETYPES[k], `${k} is not in ARCHETYPES; this check has stopped covering the defect`);
    }
    const rows = [];
    for (const key of keys) {
      const A = ARCHETYPES[key];
      const b = bodyOf({ type: key, A });
      const beast = A.custom === 'beast';
      const walker = A.custom === 'walker';
      const machine = beast ? false
        : walker || A.custom === 'droideka' || A.custom === 'remote' || A.toughness >= PLATE;
      assert(b.beast === beast, `${key}: beast=${b.beast} but custom=${A.custom}`);
      assert(b.walker === walker, `${key}: walker=${b.walker} but custom=${A.custom}`);
      assert(b.droid === machine,
        `${key}: droid=${b.droid} but custom=${A.custom} toughness=${A.toughness}`);
      assert(b.trooper === (!machine && !beast && !A.saber),
        `${key}: trooper=${b.trooper} with saber=${!!A.saber}`);
      assert(b.legs === (walker || beast ? 4 : 2), `${key} walks on ${b.legs} legs`);
      assert(b.grounded === !(A.float > 0 || A.custom === 'remote'), `${key} gait/float disagree`);
      assert(b.mass === A.mass && b.scale === A.scale, `${key} lost its own mass or scale`);
      rows.push(`${key}:${b.beast ? 'beast' : b.walker ? 'walker' : b.droid ? 'droid' : b.trooper ? 'trooper' : 'duellist'}`);
    }
    // Nothing may fall through to "a person with a sabre" unless it IS one.
    for (const key of keys) {
      const b = bodyOf({ type: key, A: ARCHETYPES[key] });
      if (!b.droid && !b.beast && !b.trooper) {
        assert(ARCHETYPES[key].saber === true,
          `${key} was classified as a duellist and does not carry a blade — it fell through`);
      }
    }
    // The one number this engine-side module states instead of importing.
    assert(PLATE === TOUGHNESS.droid, `PLATE ${PLATE} has drifted from TOUGHNESS.droid ${TOUGHNESS.droid}`);
    assert(TOUGHNESS.plastoid < PLATE && PLATE <= TOUGHNESS.armour,
      'the material table moved under the plate/tissue line');
    // …and the defaults, which the sweep cannot reach.
    assert(bodyOf({ type: 'b1', A: {} }).mass === 80, 'an archetype with no mass is not a person');
    assert(bodyOf(undefined, undefined).mass === 80, 'bodyOf threw on nothing at all');
    return `${keys.length} archetypes, each classified from its own record — ${rows.join(' ')}`;
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
    // The real archetype record under each body — see the note on the sweep
    // above: what a thing sounds like is read off `custom`/`toughness`/`saber`,
    // so a stand-in record with only a mass on it is nobody in particular.
    const mk = (type, x) => ({ type, A: { ...ARCHETYPES[type], mass: 80, label: type },
      position: V(x, 0, 0), dead: false, hp: 10, maxHp: 10, target: null });
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

  /**
   * EVERY BODY IN THE ROSTER DIES IN ITS OWN THROAT.
   *
   * `Announcer._enemySpec` was a second copy of the classification in
   * src/engine/Presence.js, written from the same eleven key names, and it had
   * drifted the same way — `bodyguard`, `charger` and `stalker` all fell past
   * every branch onto ENEMY_VOICES.sith. Measured on the real method over
   * Object.keys(ARCHETYPES): the Reek and the Nexu died at f0 97 on the
   * two-syllable HUMAN scream contour, where the one animal the list happened
   * to name — the Acklay — dies at f0 58 on the beast's, and the IG Bodyguard
   * Droid screamed with a man's throat instead of powering down at f0 300 with
   * an inharmonic ring partial. Four of the colosseum's nine pool slots are the
   * two animals, and the IG droid is SET_PIECE[0] from wave 10, so this was not
   * a corner of the roster.
   *
   * There is one classifier now, so this asserts the MAPPING rather than a
   * table of names: the voice each archetype gets must be the voice its own
   * body class implies, and the two files must never disagree again.
   */
  check('announcer: every archetype speaks with the voice its body implies', () => {
    /**
     * THIS CHECK USED TO RESTATE THE RULE IT WAS CHECKING, and the correction
     * is HANDOFF §2.4 in miniature: it carried
     *
     *     const want = b.walker ? walker : b.beast ? beast : b.droid ? droid
     *       : b.trooper ? trooper : sith;
     *
     * which is a second copy of `_enemySpec`'s own body, written in a second
     * file. An instrument that restates a rule will eventually disagree with it
     * and it fails in the direction nobody checks — it MANUFACTURES a defect.
     * It did exactly that the day the shipped rule learned two more throats: a
     * commando droid and a clone commander are both correctly voiced by the
     * game and both reported here as wrong, because the twin had never been
     * told about them and could not be.
     *
     * So the twin is gone. What is asserted instead is the set of PROPERTIES
     * the mapping exists to produce — every one of which is a sentence about
     * what the player hears rather than about how the function is written, and
     * every one of which would still be true after any refactor of it.
     */
    const spec = (key) => Announcer.prototype._enemySpec.call(null, { type: key, A: ARCHETYPES[key] });
    const nameOf = (s) => Object.keys(ENEMY_VOICES).find(k => ENEMY_VOICES[k] === s) || '?';
    const rows = [];
    for (const key of Object.keys(ARCHETYPES)) {
      const A = ARCHETYPES[key];
      const b = bodyOf({ type: key, A });
      const got = spec(key);
      // 1. EVERYTHING SPEAKS. The failure this whole method replaced was five
      //    hard-coded branches over type names, past which three archetypes
      //    fell onto the Sith acolyte by accident.
      assert(got && Object.values(ENEMY_VOICES).includes(got),
        `${key} has no voice at all`);
      // 2. A MACHINE HAS A RING PARTIAL and a body with a throat does not. That
      //    is the one acoustic property no throat can produce, and it is what
      //    makes a droid a droid rather than a small person.
      if (b.droid || b.walker) {
        assert(got.ring > 0, `${key} is a machine and has no inharmonic partial`);
      } else {
        assert(!(got.ring > 0), `${key} has a throat and speaks with a metal partial in it`);
      }
      // 3. AN ANIMAL IS AN OCTAVE UNDER A MAN.
      if (b.beast) {
        assert(got === ENEMY_VOICES.beast, `${key} is an animal and does not sound like one`);
      }
      // 4. A BODY WITH A BLADE IS NOT A B1. `melee` is the field that puts a
      //    body through DuelBrain, so a droid carrying it is one of the CIS
      //    machines meant to frighten you — a BX, a MagnaGuard, the IG general
      //    — and the B1's silly 300 Hz chirp is the wrong instrument for all
      //    three. (This is the assertion that moved: `bodyguard` used to be
      //    pinned to the droid voice here, and the method's own header records
      //    it as having been wrong in the other direction first.)
      if (b.droid && A.melee) {
        assert(got !== ENEMY_VOICES.droid,
          `${key} fights with a blade and still chirps like a B1`);
        assert(got.f0 < ENEMY_VOICES.droid.f0 * 0.6,
          `${key} is a duelling machine at ${got.f0} Hz — that is a B1's pitch`);
      }
      // 5. A BODY THAT COMMANDS SHOUTS. `commandAura` is the field that carries
      //    the rally ring; a body whose whole value is making the line around it
      //    better must not be indistinguishable from the line.
      if (A.commandAura) {
        assert(got !== ENEMY_VOICES.trooper && got !== ENEMY_VOICES.droid,
          `${key} leads a line and sounds exactly like one of them`);
      }
      rows.push(`${key}:${nameOf(got)}`);
    }
    // The consequences the player actually hears, stated as the numbers that
    // were wrong: a machine powers down on the ring, an animal is an octave
    // under a man, and neither is the acolyte.
    for (const key of ['b1', 'b2', 'droideka', 'remote', 'dummy']) {
      assert(spec(key).ring > 0, `${key} is a machine and has no ring partial`);
      assert(spec(key) === ENEMY_VOICES.droid, `${key} does not use the droid voice`);
    }
    for (const key of ['beast', 'charger', 'stalker']) {
      assert(spec(key) === ENEMY_VOICES.beast, `${key} is an animal and does not sound like one`);
      assert(spec(key).f0 < ENEMY_VOICES.sith.f0 * 0.75,
        `${key} dies at ${spec(key).f0} Hz, which is a man's pitch`);
    }
    // And an archetype nobody has named anywhere is still classified: this is
    // the property the key lists could not have.
    const invented = { type: 'nobody-has-heard-of-this',
      A: { mass: 900, scale: 2, toughness: TOUGHNESS.flesh, custom: 'beast' } };
    assert(Announcer.prototype._enemySpec.call(null, invented) === ENEMY_VOICES.beast,
      'a brand-new beast archetype does not get the beast voice');
    return rows.join(' ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * WHAT THE BUDGETS THROW AWAY
   *
   * Everything above proves the rate limits EXIST and are honoured. None of it
   * could see what they were spending themselves on, and measured on a real
   * Geonosis command wave (tools/_voiceprobe.mjs, seed 4242, 60 s) the answer
   * was: seven bodies fell and the player heard none of them, while 679 alarm
   * retries from bodies that were still standing took the budget instead.
   *
   * "The budget was honoured" and "the feature is strangled" are the same
   * observation from inside a unit check, so these three are all behavioural —
   * they drive an event a fight really produces and count what came out.
   * ──────────────────────────────────────────────────────────────────── */

  check('announcer: a squad wiped in one second is a squad you HEAR', () => {
    /**
     * THE ONE THAT WOULD HAVE CAUGHT IT.
     *
     * Six bodies die inside two frames — a Force rend, a thrown blade down a
     * corridor, one detonation, all of which the game produces — and every one
     * of them has to be heard. Before deaths moved onto the per-event budget
     * this returned ONE line for six deaths and every assertion in the file
     * still passed, because one line per 0.45 s is exactly what the shared
     * budget promises. The promise was the defect.
     */
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    const mk = (type, x) => ({ type, A: { ...ARCHETYPES[type], mass: 80, label: type },
      position: V(x, 0, 0), dead: false, hp: 10, maxHp: 10, target: null, team: 1 });
    const squad = [mk('b1', 3), mk('trooper', 4), mk('acolyte', 5),
      mk('b2', 6), mk('sniper', 7), mk('jet', 8)];
    w.enemies.push(...squad);
    an.update(1 / 60, w, p, hud);
    for (const e of squad) e.dead = true;
    // A second and a half, which is LINE_LIFE: six calls raised on one frame
    // cannot all be SAID on one frame — the engine will not play more than
    // three at once whatever this file decides — so the property is that every
    // one of them is heard, as a ripple, inside the window they are still
    // about. One frame of driving would measure the queue and not the rule.
    let spread = 0;
    for (let f = 0; f < Math.ceil(LINE_LIFE * 60); f++) { an.update(1 / 60, w, p, hud); spread += 1 / 60; }

    const deaths = rec.lines.filter(l => l.kind === 'die' || l.kind === 'scream');
    assert(deaths.length === squad.length,
      `${squad.length} bodies fell in one frame and ${deaths.length} of them made a sound — `
      + `the rest were refused by a budget and thrown away (lost: ${JSON.stringify(an.stats.lost)})`);
    assert(an.stats.lost.die === undefined && an.stats.lost.scream === undefined,
      'a death cry was refused');
    // …and they are not all the same voice, which is the other half of a wipe.
    assert(new Set(deaths.map(l => l.id)).size >= 3,
      `six bodies of five archetypes died in ${new Set(deaths.map(l => l.id)).size} voices`);
    /**
     * …AND SO IS A SIX-BODY PUSH, which is the case BATTLE_GAP's own note
     * claimed to have solved and had not: "0.14 s lets a six-body push produce
     * four or five voices stacked over each other". `forcePush` knocks every
     * body in the cone back on ONE frame, so all six calls are raised inside 16
     * ms and 0.14 s is eight frames — it produced one.
     *
     * Driven the way the announcer sees it, which is a speed GAIN and not a
     * call: six bodies standing still, then all six moving at once.
     */
    const rec2 = recorder();
    const an2 = new Announcer(rec2);
    const w2 = mkWorld(), p2 = mkPlayer(), hud2 = mkHud();
    const thrown = ['b1', 'b1', 'trooper', 'acolyte', 'b2', 'sniper'].map((t, i) => ({
      type: t, A: { ...ARCHETYPES[t], mass: 80, label: t }, position: V(3 + i, 0, 0),
      dead: false, hp: 10, maxHp: 10, target: null, team: 1,
      velocity: { length: () => 0 },
    }));
    w2.enemies.push(...thrown);
    an2.update(1 / 60, w2, p2, hud2);
    an2.update(1 / 60, w2, p2, hud2);                     // a previous frame to gain over
    for (const e of thrown) e.velocity = { length: () => 22 };
    for (let f = 0; f < Math.ceil(LINE_LIFE * 60); f++) an2.update(1 / 60, w2, p2, hud2);
    const flung = rec2.lines.filter(l => l.kind === 'flung');
    assert(flung.length === thrown.length,
      `a push threw ${thrown.length} bodies and ${flung.length} of them made a sound`);
    // …in their own throats, and a droid's is a droid's. The branch that used
    // to send a ring-modulated body to the `alarm` contour instead swapped the
    // meaning for the character, which src/engine/Voice.js's header says is
    // exactly backwards.
    assert(flung.some(l => l.id === 'droid') && flung.some(l => l.id !== 'droid'),
      `six thrown bodies of four archetypes spoke in ${new Set(flung.map(l => l.id)).size} voices`);
    assert(!rec2.lines.some(l => l.kind === 'alarm'),
      'a thrown droid called out that it had seen you instead of screaming');

    return `${deaths.length} of ${squad.length} deaths heard over ${spread.toFixed(2)}s in `
      + `${new Set(deaths.map(l => l.id)).size} throats; ${flung.length} of ${thrown.length} thrown bodies heard`;
  });

  check('announcer: a cheer ANSWERS a fall — it does not talk over it', () => {
    /**
     * Two per-event lines about one death, raised on one frame, against one
     * 0.14 s gap. Whichever is spoken first silences the other, so the order
     * and the delay are both load-bearing: the cry is the event and the cheer
     * is the reaction, and a reaction that arrives first is not one.
     *
     * Driven with two sides on the field, which is the only situation that
     * produces a cheer at all — `_cheerFor` reads `team` and nothing else.
     */
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    const mk = (type, x, team) => ({ type, A: { ...ARCHETYPES[type], mass: 80, label: type },
      position: V(x, 0, 0), dead: false, hp: 10, maxHp: 10, target: null, team });
    const victim = mk('trooper', 3, 0);
    const enemy = mk('b1', 6, 1);
    w.enemies.push(victim, enemy);
    an.update(1 / 60, w, p, hud);
    victim.dead = true;
    an.update(1 / 60, w, p, hud);

    const first = rec.lines[0];
    assert(first && first.kind === 'scream',
      `the frame a body fell said "${first?.kind}" first — the cheer beat the death it is about`);
    assert(!rec.lines.some(l => l.kind === 'cheer'),
      'the cheer landed on the same frame as the fall');
    let t = 0;
    for (let f = 0; f < 90 && !rec.lines.some(l => l.kind === 'cheer'); f++) { an.update(1 / 60, w, p, hud); t += 1 / 60; }
    const cheer = rec.lines.find(l => l.kind === 'cheer');
    assert(cheer, `nobody cheered a fall on the other side within ${t.toFixed(2)}s`);
    assert(cheer.id === 'droid', `the cheer came out of a ${cheer.id} throat, not the surviving droid's`);
    assert(t >= CHEER_DELAY * 0.8 && t <= CHEER_DELAY * 1.6,
      `the cheer arrived ${t.toFixed(2)}s after the fall against a ${CHEER_DELAY}s beat`);

    // AND A CHEERER WHO DIES IN THE MEANTIME DOES NOT CHEER. This is why the
    // body is chosen at the moment of the death and re-checked at the moment
    // of the cheer, rather than searched for once.
    const rec2 = recorder();
    const an2 = new Announcer(rec2);
    const w2 = mkWorld(), p2 = mkPlayer(), hud2 = mkHud();
    const v2 = mk('trooper', 3, 0), e2 = mk('b1', 6, 1);
    w2.enemies.push(v2, e2);
    an2.update(1 / 60, w2, p2, hud2);
    v2.dead = true; an2.update(1 / 60, w2, p2, hud2);
    e2.dead = true;
    for (let f = 0; f < 90; f++) an2.update(1 / 60, w2, p2, hud2);
    assert(!rec2.lines.some(l => l.kind === 'cheer'), 'a corpse cheered');
    return `scream then cheer ${t.toFixed(2)}s later, in the survivor's own throat; a dead cheerer stays quiet`;
  });

  check('announcer: a call-out nobody had room for expires instead of arriving late', () => {
    /**
     * `st.spotted` is latched on success and never on the attempt, which is
     * right and is what stops a squad of five producing one alarm between
     * them. What it had no notion of was TIME: a body refused by the shared
     * budget re-offered the same line every frame until it won, so a Geonosis
     * minute produced 679 refused attempts against 18 spoken and the one that
     * finally landed was a body telling you it had seen you twenty seconds
     * ago. Both halves are asserted here, because fixing the spin by latching
     * on the attempt would satisfy the first and re-break the second.
     */
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    const mk = (i) => ({ type: 'b1', A: { ...ARCHETYPES.b1, mass: 52, label: 'B1' },
      position: V(3 + i * 0.5, 0, 0), dead: false, hp: 10, maxHp: 10, target: p, team: 1 });
    const squad = [];
    for (let i = 0; i < 12; i++) squad.push(mk(i));
    w.enemies.push(...squad);
    an.update(1 / 60, w, p, hud);
    const frames = Math.round((LINE_LIFE + 0.5) * 60);
    for (let f = 0; f < frames; f++) an.update(1 / 60, w, p, hud);
    const spokeEarly = rec.lines.filter(l => l.kind === 'alarm').length;
    const expired = an.stats.lost.alarm || 0;
    const attempts = an.stats.refused.enemy;

    assert(spokeEarly >= 2, `twelve bodies acquiring you produced ${spokeEarly} alarms`);
    assert(spokeEarly <= squad.length, `${spokeEarly} alarms from ${squad.length} bodies — somebody repeated`);
    assert(spokeEarly + expired === squad.length,
      `${squad.length} bodies spotted you, ${spokeEarly} were heard and ${expired} expired — `
      + 'the rest are still on the queue, which means the window is not a window');
    // THE SPIN. Without the queue every unspoken body re-offered its own line
    // on every frame: ~10 bodies x ~120 frames, measured at 765 here and 679
    // over a real minute of Geonosis. Held, the whole queue is offered at most
    // once per budget per frame however long it is, so the count is O(frames)
    // and not O(frames x bodies) — which is the property, not the number.
    assert(attempts <= frames + squad.length,
      `${attempts} refused room-line attempts over ${frames} frames from ${squad.length} bodies — `
      + 'the retry is a per-body sweep again');

    // Nothing new arrives once the moment has passed, even with the room silent.
    const was = rec.lines.length;
    for (let f = 0; f < 60 * 6; f++) an.update(1 / 60, w, p, hud);
    const late = rec.lines.slice(was).filter(l => l.kind === 'alarm').length;
    assert(late === 0, `${late} bodies called out about spotting you six seconds after they did`);
    return `${spokeEarly} of ${squad.length} called out inside the window, ${expired} expired unheard, `
      + `${attempts} attempts over ${frames} frames, ${late} stale`;
  });

  check('announcer: your own line talks too — banter, and an order relayed', () => {
    /**
     * "A squad that never talks is the loudest silence in the game."
     *
     * Measured before this: your clones DID speak — 16 to 30 lines a minute of
     * alarms, wounds, deaths and cheers — so the premise was not quite right.
     * Two things they genuinely could not do:
     *
     *  1. IDLE BANTER, gated on `/^(b1|b2|droideka)$/` — three typed archetype
     *     keys against a roster of 31, so the only bodies with an idle voice in
     *     the whole game were the three the list happened to name. A clone
     *     squad standing beside you was silent between events.
     *  2. ANSWER AN ORDER. `LINES.order` is authored as a shout from a body
     *     with a rank; `HUD.setOrder` played it out of the JEDI'S throat, with
     *     no position, on the player's quip budget.
     *
     * Both are driven here rather than read, and the second is driven through
     * the public `say` the HUD calls.
     */
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    p.team = 0;
    w.player = p;
    const mk = (type, x, team) => ({ type, A: { ...ARCHETYPES[type], mass: 80, label: type },
      position: V(x, 0, 0), dead: false, hp: 10, maxHp: 10, target: p, team });
    const mine = [mk('trooper', 3, 0), mk('trooper', 5, 0), mk('heavy', 7, 0)];
    w.enemies.push(...mine, mk('b1', 20, 1), mk('b1', 22, 1));
    for (let f = 0; f < 60 * 30; f++) an.update(1 / 60, w, p, hud);
    const chatter = rec.lines.filter(l => l.kind === 'chatter');
    assert(chatter.length >= 2,
      `thirty seconds beside a clone squad produced ${chatter.length} idle lines`);
    assert(chatter.some(l => l.id === 'trooper'),
      `nothing in your own line ever chattered: ${[...new Set(chatter.map(l => l.id))].join(',')}`);

    // The dojo is still quiet. A training remote has nobody to talk to and an
    // inert dummy is furniture — the clauses the deleted key list encoded as
    // names are `training`, `boss`, `big`, and having an ally within reach.
    const quiet = new Announcer(recorder());
    for (const t of ['remote', 'dummy', 'sparring']) {
      const body = { type: t, A: { ...ARCHETYPES[t], label: t }, position: V(0, 0, 0), team: 1 };
      const mate = { type: t, A: { ...ARCHETYPES[t], label: t }, position: V(1, 0, 0), team: 1, dead: false };
      assert(!quiet._chatty(body, [body, mate]), `a ${t} chatters`);
    }
    const lone = { type: 'trooper', A: { ...ARCHETYPES.trooper, label: 't' }, position: V(0, 0, 0), team: 0 };
    assert(!quiet._chatty(lone, [lone]), 'the last body standing mutters to itself');

    // …and the order comes out of a trooper, at the trooper's position.
    rec.lines.length = 0;
    const said = an.say(w.settings, 'order');
    assert(said, 'changing formation said nothing at all');
    const order = rec.lines.find(l => l.kind === 'order');
    assert(order, `say('order') produced ${rec.lines.map(l => l.kind).join(',') || 'nothing'}`);
    assert(!order.self, 'the order came out of the player');
    assert(order.id === 'trooper' || order.id === 'officer',
      `a ${order.id} relayed your formation order`);
    assert(order.pos, 'the order has no position — it cannot be looked toward');
    return `${chatter.length} idle lines in 30 s from ${[...new Set(chatter.map(l => l.id))].join('+')}, `
      + `the dojo silent, the order relayed by a ${order.id}`;
  });

  check('announcer: the rally ring has something audible in it', () => {
    /**
     * `ENEMY_VOICES.officer` was built for this and has said so since it was
     * written — "the rally aura is already drawn as a ring on the ground, and a
     * ring with nothing audible in it is half a tell" — and for a whole session
     * nothing on the field emitted `LINES.order` at all. The one emitter was
     * the HUD, on a formation key, in the player's own voice.
     *
     * `commandAura` and not a rank or a type, for `_enemySpec`'s reason: it is
     * the field that MEANS this, `enlistBody` reads it to install the modifier,
     * and both armies field a body that carries it.
     */
    const rec = recorder();
    const an = new Announcer(rec);
    const w = mkWorld(), p = mkPlayer(), hud = mkHud();
    const boss = { type: 'officer', A: { ...ARCHETYPES.trooper, commandAura: 'leader', label: 'CMD' },
      position: V(6, 0, 0), dead: false, hp: 10, maxHp: 10, target: p, team: 1 };
    w.enemies.push(boss);
    for (let f = 0; f < 60 * (RALLY_GAP + 2); f++) an.update(1 / 60, w, p, hud);
    const orders = rec.lines.filter(l => l.kind === 'order');
    assert(orders.length >= 1, `an officer held a line for ${RALLY_GAP + 2}s and never opened its mouth`);
    assert(orders.length <= Math.ceil((RALLY_GAP + 2) / RALLY_GAP) + 1,
      `${orders.length} orders in ${RALLY_GAP + 2}s — the commander never stops talking`);
    assert(orders[0].id === 'officer', `the rally came out of a ${orders[0].id}, not a commander`);

    // A body with no aura is not a commander and does not get the line.
    const rec2 = recorder();
    const an2 = new Announcer(rec2);
    const w2 = mkWorld(), p2 = mkPlayer(), hud2 = mkHud();
    w2.enemies.push({ type: 'trooper', A: { ...ARCHETYPES.trooper, label: 'CT' },
      position: V(6, 0, 0), dead: false, hp: 10, maxHp: 10, target: p2, team: 1 });
    for (let f = 0; f < 60 * (RALLY_GAP + 2); f++) an2.update(1 / 60, w2, p2, hud2);
    assert(!rec2.lines.some(l => l.kind === 'order'), 'a rifleman gave the orders');
    return `${orders.length} rally shouts in ${RALLY_GAP + 2}s from the aura body, none from a rifleman`;
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
