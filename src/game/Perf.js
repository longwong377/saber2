/**
 * BATTLEFRONT BORZ — the frame-time overlay and the quality auto-tune (V19 hole 2).
 *
 * Nobody on this project has ever measured a frame on a real GPU; the only
 * renderer the checks can reach is a software rasteriser at a frame a second.
 * The player can. So this is two things a player can use without being asked
 * to read a console:
 *
 *   THE OVERLAY — one key (`perf`, F3 by default) shows a small box, top-left,
 *   in the HUD's own type: frame mean and p95 over the last two seconds, draw
 *   calls and triangles off `renderer.info`, the station's own step, the body
 *   count, the deck and the room, the tier the engine is on and the GPU's
 *   name. Its last line is the COPY line: the one-line summary that is also
 *   written to `localStorage['saber.perf.v1']` (the last twenty) and
 *   `console.info`'d every LOG_EVERY ms while the box is up, so a report can be
 *   pasted from either.
 *
 *   THE AUTO-TUNE — `settings.quality === 'auto'`. `AutoTuner` is the whole
 *   policy, pure and clocked by the caller, so a check can feed it synthetic
 *   frames: p95 over WINDOW_MS windows while PLAYING only; a step DOWN after
 *   two bad windows in a row (p95 > DOWN_MS); a step UP after UP_HOLD_MS of
 *   good ones (p95 < UP_MS); never more than one step per STEP_GAP_MS; and a
 *   tier that has already been stepped down FROM costs twice as long a good
 *   run to re-enter each time, which is what stops a machine that is fine at
 *   medium and bad at high from bouncing between them every thirty seconds.
 *   A p95 sitting exactly ON a threshold is neither bad nor good, by
 *   construction: both comparisons are strict.
 *
 * Nothing here changes a frame unless the box is up or 'auto' is chosen: with
 * both off, `frame()` is one ring-buffer write.
 */
import { QUALITY } from '../engine/Engine.js';
import { placesOn } from './StationPlan.js';

/** The tiers the tuner may walk, worst first. */
export const TIERS = ['low', 'medium', 'high', 'ultra'];
/** The tier 'auto' starts on: Engine's own default, and the middle of the ladder's cost. */
export const AUTO_START = 'high';

export const WINDOW_MS = 4000;   // one measurement window
export const DOWN_MS = 24;       // p95 above this is a bad window
export const UP_MS = 11;         // p95 below this is a good window
export const BAD_WINDOWS = 2;    // bad windows in a row before a step down
export const UP_HOLD_MS = 20000; // good frames for this long before a step up
export const STEP_GAP_MS = 10000;// never two steps closer than this

/** Storage for the pasted log and for the tier 'auto' last settled on. */
export const LOG_KEY = 'saber.perf.v1';
export const TIER_KEY = 'saber.perf.tier.v1';
export const LOG_KEEP = 20;
export const LOG_EVERY = 5000;
/** How much history the overlay's window is cut from. */
export const SPAN_MS = 2000;

/** Mean and p95 of a list of frame times. Sorted copy; the caller keeps the raw one. */
export function band(ms) {
  if (!ms.length) return { mean: 0, p95: 0, n: 0 };
  const s = [...ms].sort((a, b) => a - b);
  let sum = 0;
  for (const v of s) sum += v;
  const at = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { mean: sum / s.length, p95: at(0.95), n: s.length };
}

/**
 * The policy, on its own. `feed(frameMs, nowMs, playing)` returns the tier to
 * move to, or null. `now` is the caller's clock, so a check can drive an hour
 * in a loop.
 */
export class AutoTuner {
  constructor(tier = AUTO_START, opts = {}) {
    this.tier = TIERS.includes(tier) ? tier : AUTO_START;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.downMs = opts.downMs ?? DOWN_MS;
    this.upMs = opts.upMs ?? UP_MS;
    this.badWindows = opts.badWindows ?? BAD_WINDOWS;
    this.upHoldMs = opts.upHoldMs ?? UP_HOLD_MS;
    this.stepGapMs = opts.stepGapMs ?? STEP_GAP_MS;
    this._win = [];
    this._winStart = null;
    this._bad = 0;
    this._goodSince = null;
    this._lastStep = -Infinity;
    /** How many times each tier has been stepped down FROM: the hysteresis. */
    this.burned = { low: 0, medium: 0, high: 0, ultra: 0 };
    this.steps = 0;
    this.lastP95 = 0;
  }

  /** Good-run length required before stepping up INTO `tier`. */
  holdFor(tier) { return this.upHoldMs * Math.pow(2, Math.min(4, this.burned[tier] || 0)); }

  /** A not-playing frame — loading, paused, a menu — resets the window. */
  feed(frameMs, now, playing = true) {
    // …and the bad count with it: two bad windows with a pause between are not 'in a row'.
    if (!playing) { this._win.length = 0; this._winStart = null; this._goodSince = null; this._bad = 0; return null; }
    if (this._winStart === null) this._winStart = now;
    this._win.push(frameMs);
    if (now - this._winStart < this.windowMs) return null;
    const { p95 } = band(this._win);
    this._win.length = 0;
    this._winStart = now;
    this.lastP95 = p95;
    return this._judge(p95, now);
  }

  _judge(p95, now) {
    const i = TIERS.indexOf(this.tier);
    if (p95 > this.downMs) {
      this._bad++;
      this._goodSince = null;
    } else {
      this._bad = 0;
      if (p95 < this.upMs) { if (this._goodSince === null) this._goodSince = now - this.windowMs; }
      else this._goodSince = null;
    }
    if (now - this._lastStep < this.stepGapMs) return null;
    if (this._bad >= this.badWindows && i > 0) {
      this.burned[this.tier]++;
      return this._step(TIERS[i - 1], now);
    }
    if (this._goodSince !== null && i < TIERS.length - 1) {
      const up = TIERS[i + 1];
      if (now - this._goodSince >= this.holdFor(up)) return this._step(up, now);
    }
    return null;
  }

  _step(tier, now) {
    this.tier = tier;
    this._lastStep = now;
    this._bad = 0;
    this._goodSince = null;
    this.steps++;
    return tier;
  }
}

/** The one-line summary: every field, in a fixed order, spaces only. */
export function summaryLine(s) {
  const k = (v) => (v == null ? '-' : v);
  return `perf level=${k(s.level)} deck=${k(s.deck)} place=${k(s.place)} quality=${k(s.quality)}`
    + ` ms=${(+s.mean || 0).toFixed(1)}/${(+s.p95 || 0).toFixed(1)} calls=${k(s.calls)} tris=${k(s.tris)}`
    + ` station=${(+s.stationMs || 0).toFixed(2)} bodies=${k(s.bodies)} gpu=${String(k(s.gpu)).replace(/\s+/g, '_')}`;
}

/** Append a line to the log, keep the last LOG_KEEP, return the list. */
export function appendLog(line, store = globalThis.localStorage) {
  let list = [];
  try { list = JSON.parse(store.getItem(LOG_KEY) || '[]'); if (!Array.isArray(list)) list = []; } catch { list = []; }
  list.push(line);
  while (list.length > LOG_KEEP) list.shift();
  try { store.setItem(LOG_KEY, JSON.stringify(list)); } catch { /* full or blocked */ }
  return list;
}

/** What the lift calls each deck — the same three rows Station.js's PA reads. */
const DECK_NAME = {
  12: 'the launch well', 32: 'flight operations', 40: 'the Concourse',
  44: 'the Living deck', 48: 'the Working deck', 60: 'the Observation dome',
};

/** The room a position stands in on `deck`, by the plan's own footprints. */
function placeAt(deck, x, z) {
  for (const p of placesOn(deck)) {
    if (p.w == null || p.d == null) continue;
    const dx = x - p.x, dz = z - p.z;
    const c = Math.cos(-p.yaw), sn = Math.sin(-p.yaw);
    const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    if (Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2) return p.name;
  }
  return null;
}

/**
 * The live thing: one per game. `frame(now, ctx)` once a frame after the
 * render, `toggle()` on the key, `setAuto(on)` when the setting changes.
 * `applyTier` is the seam to the engine — main.js supplies it so the tier is
 * applied through the same setter the options screen uses.
 */
export class Perf {
  constructor(engine, { applyTier = null, notify = null, store = null, now = null, say = null } = {}) {
    this.engine = engine;
    this.applyTier = applyTier;
    this.notify = notify;
    /** Where the copy line is also said: console.info, so it can be pasted from the console too. */
    this.say = say || ((line) => { try { console.info(line); } catch { /* no console */ } });
    this.store = store || globalThis.localStorage || null;
    this.clock = now || (() => (globalThis.performance?.now?.() ?? Date.now()));
    this.visible = false;
    this.auto = false;
    this.tuner = new AutoTuner(this._storedTier());
    this.el = null;
    this._t = new Float64Array(512);
    this._ms = new Float64Array(512);
    this._i = 0;
    this._n = 0;
    this._lastLog = 0;
    this._lastPaint = 0;
    this._gpu = null;
    this.last = null;
    this.log = [];
  }

  _storedTier() {
    try { const t = this.store?.getItem(TIER_KEY); return TIERS.includes(t) ? t : AUTO_START; } catch { return AUTO_START; }
  }

  /** The tier the engine should be on right now: the tuner's under 'auto'. */
  get tier() { return this.tuner.tier; }

  setAuto(on) {
    this.auto = !!on;
    if (this.auto) this.applyTier?.(this.tuner.tier);
  }

  gpuName() {
    if (this._gpu !== null) return this._gpu;
    let name = 'WebGL';
    try {
      const gl = this.engine?.renderer?.getContext?.();
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) name = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    } catch { /* blocked, which is an answer */ }
    this._gpu = name.slice(0, 48);
    return this._gpu;
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) { this._ensureEl(); this._lastLog = 0; this._lastPaint = 0; }
    else { if (this.el) this.el.hidden = true; if (this.last) this._writeLog(); }
    return this.visible;
  }

  _ensureEl() {
    if (this.el || typeof document === 'undefined') return;
    const el = document.createElement('pre');
    el.id = 'perf-overlay';
    el.className = 'perf-overlay';
    document.body.appendChild(el);
    this.el = el;
  }

  /** Called once a frame, after the render. `ctx`: { world, playing, level }. */
  frame(now, ctx = {}) {
    const dtMs = this._n ? now - this._t[(this._i + 511) & 511] : 0;
    this._t[this._i] = now; this._ms[this._i] = dtMs;
    this._i = (this._i + 1) & 511; this._n = Math.min(512, this._n + 1);
    if (this.auto && this._n > 1) {
      const to = this.tuner.feed(dtMs, now, !!ctx.playing);
      if (to) this._applyStep(to);
    }
    if (!this.visible) return;
    if (now - this._lastPaint < 250) return;
    this._lastPaint = now;
    const s = this.sample(now, ctx);
    this.last = s;
    if (this.el) this.el.textContent = this.render(s);
    if (now - this._lastLog >= LOG_EVERY) { this._lastLog = now; this._writeLog(); }
  }

  _applyStep(to) {
    try { this.store?.setItem(TIER_KEY, to); } catch { /* fine */ }
    this.applyTier?.(to);
    const up = TIERS.indexOf(to) > TIERS.indexOf(this._announced || AUTO_START);
    this.notify?.(`QUALITY ${to.toUpperCase()}`,
      `auto: frame p95 ${this.tuner.lastP95.toFixed(0)} ms — stepped ${up ? 'up' : 'down'}`);
    this._announced = to;
  }

  /** Frame times inside the last SPAN_MS. */
  window(now) {
    const out = [];
    for (let k = 0; k < this._n; k++) {
      const idx = (this._i - 1 - k + 1024) & 511;
      if (now - this._t[idx] > SPAN_MS) break;
      if (this._ms[idx] > 0) out.push(this._ms[idx]);
    }
    return out;
  }

  sample(now, ctx = {}) {
    const w = ctx.world || null;
    const b = band(this.window(now));
    const info = this.engine?.renderer?.info?.render || {};
    const st = w?._station || null;
    const deck = st ? (st.deck | 0) : null;
    const p = w?.player?.position;
    const place = (st && p) ? placeAt(deck, p.x, p.z) : null;
    const quality = this.engine?.quality || '-';
    return {
      level: ctx.level ?? w?.level?.name ?? '-',
      deck: deck == null ? '-' : (DECK_NAME[deck] || `deck ${deck}`),
      place: place || (st ? 'a walkway' : '-'),
      quality: this.auto ? `auto:${quality}` : quality,
      mean: b.mean, p95: b.p95, n: b.n,
      calls: info.calls ?? 0, tris: info.triangles ?? 0,
      stationMs: w?._stationLife?.stepMs ?? 0,
      bodies: w?.physics?.bodies?.length ?? w?.physics?.stats?.bodies ?? 0,
      gpu: this.gpuName(),
    };
  }

  render(s) {
    return `frame ${s.mean.toFixed(1)} ms  p95 ${s.p95.toFixed(1)}  (${s.n} in 2 s)\n`
      + `draw  ${s.calls} calls  ${(s.tris / 1000).toFixed(0)}k tris\n`
      + `station ${(+s.stationMs).toFixed(2)} ms  bodies ${s.bodies}\n`
      + `${s.level} · ${s.deck} · ${s.place}\n`
      + `quality ${s.quality}  gpu ${s.gpu}\n`
      + `copy: ${summaryLine(s)}`;
  }

  _writeLog() {
    if (!this.last) return;
    const line = summaryLine(this.last);
    this.log = this.store ? appendLog(line, this.store) : [...this.log, line].slice(-LOG_KEEP);
    this.say(line);
    return line;
  }
}
