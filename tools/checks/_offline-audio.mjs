/**
 * AN OFFLINE WEBAUDIO, BECAUSE AUDIO CANNOT BE SCREENSHOTTED.
 *
 * `tools/checks/audio.mjs`'s `FakeCtx` answers "what did the game ASK FOR" —
 * which nodes, wired how, with which values commanded — and that is the right
 * instrument for almost every question this project has about sound: the
 * defects it was built for were a missing branch, a leaked voice, a full pool
 * and a ramp that never arrived, and none of those is a question about a
 * waveform.
 *
 * There is one question it cannot answer. "Walking toward the shield audibly
 * changes the room" is a claim about ENERGY IN BANDS, and no amount of reading
 * `filter.frequency.last('tgt')` establishes it — a lowpass at 210 Hz over a
 * bed with nothing above 190 Hz in it would command exactly the same number
 * and do nothing at all. So this renders the real graph, built by the real
 * engine from the real level code, into a real buffer, and the checks integrate
 * it.
 *
 * WHAT IT IS AND IS NOT. It is a block-based pull renderer over the subset of
 * WebAudio this project actually builds: gains, biquads (RBJ coefficients, the
 * same formulas the spec publishes), oscillators, looping buffer sources with a
 * playback rate, wave shapers, and panners as an inverse distance law. Every
 * `AudioParam` is evaluated by the spec's own automation rules at block rate.
 * It is NOT a browser: the oscillators are naive and therefore alias above
 * about a fifth of Nyquist, there is no convolver, and the compressor is a
 * wire. None of that touches what it is used for, which is integrated energy
 * per band in a bed whose highest layer is centred at 3.1 kHz.
 *
 * Underscore-prefixed so `verify.mjs:3808` does not mistake it for a suite.
 */

/* ── AudioParam, with the spec's automation ─────────────────────────── */

const EPS = 1e-8;

class Param {
  constructor(v = 0) { this._init = v; this.calls = []; this._in = []; this._sorted = null; }
  get value() { return this._init; }
  set value(v) { this._init = v; }
  setValueAtTime(v, t) { this._push(['set', v, t, 0]); return this; }
  linearRampToValueAtTime(v, t) { this._push(['lin', v, t, 0]); return this; }
  exponentialRampToValueAtTime(v, t) { this._push(['exp', v, t, 0]); return this; }
  setTargetAtTime(v, t, tc) { this._push(['tgt', v, t, tc]); return this; }
  cancelScheduledValues() { this.calls.length = 0; this._sorted = null; return this; }
  _push(e) {
    this.calls.push(e);
    this._sorted = null;
    /* PRUNE, or a long render is quadratic. `at()` walks the whole event list
     * on every block and a param under a per-frame `setTargetAtTime` collects
     * thousands over a few simulated minutes — a thirty-minute deck check took
     * longer than the whole gate before this line. The value at the cut is
     * folded into the initial value first, so collapsing the past changes
     * nothing about the future. */
    if (this.calls.length > 192) {
      const ev = this._events();
      const cut = ev.length - 96;
      this._init = this.at(ev[cut][2] - 1e-6);
      this.calls = ev.slice(cut);
      this._sorted = null;
    }
  }
  connect() {}
  /** The last value this param was COMMANDED to move to, of a kind or any. */
  last(kind) {
    for (let i = this.calls.length - 1; i >= 0; i--) if (!kind || this.calls[i][0] === kind) return this.calls[i][1];
    return null;
  }
  _events() {
    if (!this._sorted) this._sorted = this.calls.slice().sort((a, b) => a[2] - b[2]);
    return this._sorted;
  }
  /** The value at audio-clock time `t`, plus anything connected INTO the param. */
  at(t) {
    const ev = this._events();
    let v = this._init, lastT = 0;
    for (let i = 0; i < ev.length; i++) {
      const [k, val, tt, tc] = ev[i];
      if (tt <= t) {
        if (k === 'tgt') {
          let end = t;
          if (i + 1 < ev.length) end = Math.min(t, ev[i + 1][2]);
          v = val + (v - val) * Math.exp(-(end - tt) / Math.max(tc, 1e-6));
          lastT = end;
        } else { v = val; lastT = tt; }
      } else {
        const span = Math.max(tt - lastT, 1e-9);
        const a = Math.min(Math.max((t - lastT) / span, 0), 1);
        if (k === 'lin') return v + (val - v) * a;
        if (k === 'exp') {
          const s = Math.abs(v) < EPS ? EPS : v;
          return s * Math.pow(Math.max(Math.abs(val), EPS) / Math.abs(s), a) * Math.sign(s);
        }
        break;
      }
    }
    return v;
  }
}

/* ── nodes ──────────────────────────────────────────────────────────── */

let UID = 0;

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.id = ++UID; this._in = []; this.outs = new Set(); }
  connect(d) {
    if (d instanceof Param) { d._in.push(this); return d; }
    this.outs.add(d);
    if (d._in) d._in.push(this);
    return d;
  }
  disconnect(d) {
    if (d) { this.outs.delete(d); if (d._in) { const i = d._in.indexOf(this); if (i >= 0) d._in.splice(i, 1); } return; }
    for (const o of this.outs) { if (o._in) { const i = o._in.indexOf(this); if (i >= 0) o._in.splice(i, 1); } }
    this.outs.clear();
  }
  /** Sum of everything wired into this node, for one block. */
  _sum(out, t0) {
    out.fill(0);
    for (const src of this._in) {
      const b = src._block(t0);
      for (let i = 0; i < out.length; i++) out[i] += b[i];
    }
    return out;
  }
  /** One block, memoised so a fan-out is not rendered twice. */
  _block(t0) {
    if (this._at === t0) return this._buf;
    this._at = t0;
    this._buf ||= new Float32Array(this.ctx.block);
    this._scratch ||= new Float32Array(this.ctx.block);
    this._render(this._buf, this._scratch, t0);
    return this._buf;
  }
  _render(out) { out.fill(0); }
}

class GainNode extends Node {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new Param(1); }
  _render(out, scratch, t0) {
    this._sum(out, t0);
    let g = this.gain.at(t0);
    for (const m of this.gain._in) {
      const b = m._block(t0);
      let s = 0;
      for (let i = 0; i < b.length; i++) s += b[i];
      g += s / b.length;               // an LFO into a param, at block rate
    }
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
}

/** RBJ biquad coefficients, exactly as the Web Audio spec publishes them. */
function coeffs(type, f0, Q, dB, rate) {
  const w0 = 2 * Math.PI * Math.min(Math.max(f0, 1), rate * 0.4999) / rate;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const A = Math.pow(10, dB / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'lowshelf' || type === 'highshelf') {
    const al = sw / 2 * Math.SQRT2;
    const sa = 2 * Math.sqrt(A) * al;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + sa); b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - sa); a0 = (A + 1) + (A - 1) * cw + sa;
      a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sa;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + sa); b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - sa); a0 = (A + 1) - (A - 1) * cw + sa;
      a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sa;
    }
  } else {
    const al = sw / (2 * Math.max(Q, 1e-4));
    if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; }
    else if (type === 'notch') { b0 = 1; b1 = -2 * cw; b2 = 1; }
    else if (type === 'peaking') {
      b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A;
      a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
      return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    } else { b0 = 1; }
    a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

class BiquadNode extends Node {
  constructor(ctx) {
    super(ctx, 'biquad');
    this.type = 'lowpass';
    this.frequency = new Param(350); this.Q = new Param(1);
    this.gain = new Param(0); this.detune = new Param(0);
    this.z1 = 0; this.z2 = 0;
  }
  _render(out, scratch, t0) {
    this._sum(out, t0);
    const [b0, b1, b2, a1, a2] = coeffs(this.type, this.frequency.at(t0), this.Q.at(t0),
      this.gain.at(t0), this.ctx.sampleRate);
    let z1 = this.z1, z2 = this.z2;
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      out[i] = y;
    }
    this.z1 = z1; this.z2 = z2;
  }
}

class ShaperNode extends Node {
  constructor(ctx) { super(ctx, 'shaper'); this.curve = null; this.oversample = 'none'; }
  _render(out, scratch, t0) {
    this._sum(out, t0);
    const c = this.curve;
    if (!c || !c.length) return;
    const n = c.length;
    for (let i = 0; i < out.length; i++) {
      const x = Math.min(Math.max(out[i], -1), 1);
      const f = (x + 1) * 0.5 * (n - 1);
      const k = Math.min(n - 2, Math.floor(f));
      out[i] = c[k] + (c[k + 1] - c[k]) * (f - k);
    }
  }
}

class Src extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.startAt = null; this.stopAt = Infinity; this.onended = null; }
  start(t = 0) { this.startAt = t; this.ctx.sources.add(this); }
  stop(t = 0) { this.stopAt = t; }
}

class OscNode extends Src {
  constructor(ctx) {
    super(ctx, 'osc');
    this.type = 'sine'; this.frequency = new Param(440); this.detune = new Param(0);
    this.phase = 0;
  }
  _render(out, scratch, t0) {
    const rate = this.ctx.sampleRate, n = out.length;
    if (this.startAt === null || t0 + n / rate < this.startAt || t0 > this.stopAt) { out.fill(0); return; }
    let f = this.frequency.at(t0) * Math.pow(2, this.detune.at(t0) / 1200);
    for (const m of this.frequency._in) {
      const b = m._block(t0); let s = 0;
      for (let i = 0; i < b.length; i++) s += b[i];
      f += s / b.length;
    }
    const inc = f / rate;
    const ty = this.type;
    for (let i = 0; i < n; i++) {
      const t = t0 + i / rate;
      if (t < this.startAt || t > this.stopAt) { out[i] = 0; continue; }
      const ph = this.phase;
      out[i] = ty === 'sine' ? Math.sin(2 * Math.PI * ph)
        : ty === 'square' ? (ph < 0.5 ? 1 : -1)
          : ty === 'sawtooth' ? 2 * ph - 1
            : 4 * Math.abs(ph - 0.5) - 1;                       // triangle
      this.phase += inc;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    }
  }
}

class BufSrc extends Src {
  constructor(ctx) {
    super(ctx, 'bufsrc');
    this.buffer = null; this.loop = false; this.playbackRate = new Param(1); this.pos = 0;
  }
  _render(out, scratch, t0) {
    const rate = this.ctx.sampleRate, n = out.length;
    const buf = this.buffer && this.buffer.getChannelData(0);
    if (!buf || this.startAt === null || t0 + n / rate < this.startAt || t0 > this.stopAt) { out.fill(0); return; }
    const step = this.playbackRate.at(t0) * (this.buffer.sampleRate / rate);
    for (let i = 0; i < n; i++) {
      const t = t0 + i / rate;
      if (t < this.startAt || t > this.stopAt) { out[i] = 0; continue; }
      let p = this.pos;
      if (p >= buf.length) { if (this.loop) { p -= Math.floor(p / buf.length) * buf.length; this.pos = p; } else { out[i] = 0; continue; } }
      const k = p | 0;
      const k2 = (k + 1) % buf.length;
      out[i] = buf[k] + (buf[k2] - buf[k]) * (p - k);
      this.pos += step;
    }
  }
}

/** Distance only, mono — the inverse law `_reach` predicts against. */
class PannerNode extends Node {
  constructor(ctx) {
    super(ctx, 'panner');
    this.panningModel = 'HRTF'; this.distanceModel = 'inverse';
    this.refDistance = 1; this.maxDistance = 10000; this.rolloffFactor = 1;
    this.positionX = new Param(0); this.positionY = new Param(0); this.positionZ = new Param(0);
  }
  setPosition(x, y, z) { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
  _render(out, scratch, t0) {
    this._sum(out, t0);
    const L = this.ctx.listenerPos;
    const dx = this.positionX.at(t0) - L[0], dy = this.positionY.at(t0) - L[1], dz = this.positionZ.at(t0) - L[2];
    const d = Math.max(Math.min(Math.sqrt(dx * dx + dy * dy + dz * dz), this.maxDistance), this.refDistance);
    const g = this.refDistance / (this.refDistance + this.rolloffFactor * (d - this.refDistance));
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
}

export class OfflineCtx {
  constructor(sampleRate = 48000, block = 64) {
    this.sampleRate = sampleRate;
    this.block = block;
    this.currentTime = 0;
    this.state = 'running';
    this.sources = new Set();
    this.listenerPos = [0, 0, 0];
    /** Where the ear is, for the panners. Set it alongside `audio._listenerPos`. */
    this.setListener = (x, y, z) => { this.listenerPos[0] = x; this.listenerPos[1] = y; this.listenerPos[2] = z; };
    this.destination = new GainNode(this);
    this.listener = {
      positionX: new Param(), positionY: new Param(), positionZ: new Param(),
      forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(),
      upX: new Param(), upY: new Param(), upZ: new Param(),
    };
  }
  createGain() { return new GainNode(this); }
  createBiquadFilter() { return new BiquadNode(this); }
  createWaveShaper() { return new ShaperNode(this); }
  createOscillator() { return new OscNode(this); }
  createBufferSource() { return new BufSrc(this); }
  createPanner() { return new PannerNode(this); }
  createConvolver() { const n = new Node(this, 'convolver'); n.buffer = null; n.normalize = true; return n; }
  createDynamicsCompressor() {
    const n = new GainNode(this);
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    n.reduction = 0;
    return n;
  }
  createMediaElementSource(el) { const n = new Node(this, 'media'); n.mediaElement = el; return n; }
  createBuffer(channels, length, rate) {
    const data = [];
    for (let i = 0; i < channels; i++) data.push(new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate,
      duration: length / rate, getChannelData: (i) => data[i] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }

  /**
   * Render `seconds` of whatever is arriving at `node`, from the CURRENT clock.
   * Advances `currentTime` as it goes, which is what makes automation
   * scheduled relative to it land where the caller meant it to.
   */
  render(node, seconds) {
    const n = Math.floor(seconds * this.sampleRate);
    const out = new Float32Array(n);
    const blocks = Math.ceil(n / this.block);
    for (let b = 0; b < blocks; b++) {
      const t0 = this.currentTime;
      const buf = node._block(t0);
      const off = b * this.block;
      for (let i = 0; i < this.block && off + i < n; i++) out[off + i] = buf[i];
      this.currentTime += this.block / this.sampleRate;
      /* `ended` FIRES ON THE AUDIO CLOCK, and it has to. `_freeOnEnd` hangs
       * the whole teardown off it — the voice release AND the panner
       * disconnect — so a renderer that never raised it would leave every
       * finished one-shot wired to the bus, replaying from its own absolute
       * start time on the next render. Measured before this loop existed:
       * eight footsteps rendered in a row summed into one another and the
       * four deck materials all measured within 10% of each other, which is
       * the accumulation and not the sound. */
      for (const s of this.sources) {
        if (s.stopAt <= this.currentTime) {
          this.sources.delete(s);
          try { s.onended?.(); } catch { /* a teardown that throws is the caller's */ }
        }
      }
    }
    return out;
  }
}

/* ── measuring what came out ─────────────────────────────────────────── */

/** In-place radix-2 FFT. `re`/`im` are power-of-two Float64Arrays. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Root-mean-square of a rendered buffer, over a window in seconds. */
export function rms(buf, rate, from = 0, to = Infinity) {
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(buf.length, Math.floor(to * rate));
  let s = 0;
  for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

export const BANDS = [
  ['20-60', 20, 60], ['60-200', 60, 200], ['200-800', 200, 800],
  ['800-3k', 800, 3000], ['3k-12k', 3000, 12000],
];

/**
 * Power per band, Welch-averaged over Hann-windowed 8192-sample frames.
 * Returns absolute band powers plus the total, in the same units as `rms²`.
 */
/**
 * A-WEIGHTING, and the reason this file has it.
 *
 * The deck bed's energy is 72% below 60 Hz, because a hull hum IS mostly below
 * 60 Hz. A plain RMS of it is therefore a measurement of the sub and almost
 * nothing else — walking to the lip moves the raw RMS by 0.0 dB while the
 * entire midrange of the room disappears, which is a true number that says the
 * opposite of what a listener would say. A-weighting (IEC 61672) is the
 * standard curve for exactly this: it is 39.5 dB down at 30 Hz and 0 dB at
 * 1 kHz, which is roughly what an ear does. It is used here to state the
 * PERCEIVED change, alongside the unweighted bands, never instead of them.
 */
export function aWeight(f) {
  const f2 = f * f;
  const r = (12194 * 12194 * f2 * f2)
    / ((f2 + 20.6 * 20.6)
      * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9))
      * (f2 + 12194 * 12194));
  return r * Math.pow(10, 2.0 / 20);          // +2.00 dB normalisation at 1 kHz
}

export function bands(buf, rate, from = 0, to = Infinity, opts = {}) {
  const N = 8192;
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(buf.length, Math.floor(to * rate));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  let wsum = 0;
  for (let i = 0; i < N; i++) wsum += win[i] * win[i];
  const acc = new Float64Array(N / 2);
  let frames = 0;
  for (let off = a; off + N <= b; off += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = buf[off + i] * win[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += (re[k] * re[k] + im[k] * im[k]) / (wsum * N);
    frames++;
  }
  const out = {};
  let total = 0, weighted = 0;
  for (const [name, lo, hi] of BANDS) {
    let p = 0, w = 0;
    const k0 = Math.max(1, Math.round(lo * N / rate)), k1 = Math.min(N / 2 - 1, Math.round(hi * N / rate));
    for (let k = k0; k <= k1; k++) {
      p += acc[k];
      const a = aWeight(k * rate / N);
      w += acc[k] * a * a;
    }
    out[name] = frames ? p * 2 / frames : 0;
    total += out[name];
    weighted += frames ? w * 2 / frames : 0;
  }
  out.total = total;
  /** The same energy an ear would weigh it at. See `aWeight`. */
  out.aTotal = weighted;
  out.frames = frames;
  return out;
}

/** A ratio as decibels, floored so a silent band prints a number. */
export const dB = (a, b) => 10 * Math.log10(Math.max(a, 1e-18) / Math.max(b, 1e-18));

/**
 * The shipped `AudioEngine`, fully initialised on an offline context.
 *
 * The same bootstrap `audio.mjs`'s `engine()` uses, against a context that
 * renders instead of recording. Hands back both, plus the restore the caller
 * owes the module singleton if it used that instead.
 */
export async function offlineEngine(sampleRate = 48000) {
  const { AudioEngine } = await import('../../src/engine/Audio.js');
  const prev = globalThis.AudioContext;
  let ctx = null;
  globalThis.AudioContext = function () { ctx = new OfflineCtx(sampleRate); return ctx; };
  const a = new AudioEngine();
  try { a.init(); } finally { globalThis.AudioContext = prev; }
  a._listenerPos.set(0, 0, 0);
  a._lastWake = -1e9;
  return { a, ctx };
}
