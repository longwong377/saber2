/**
 * SABER — what does a frame actually cost?
 *
 * Nothing in this project has ever known. Every performance claim it has made
 * is a BUDGET — instance counts, draw calls, triangles — and never a
 * millisecond, because the only renderer it can reach is a software rasterizer
 * running at about one frame per second. The player's very first complaint was
 * that it ran badly and got worse the longer they played, and that complaint
 * has been reasoned about for weeks and never once measured.
 *
 * This exists so that a two-minute playtest on a real GPU produces the number
 * instead. It is deliberately small and always-on: sampling is a few
 * microseconds, and a profiler you have to remember to enable is a profiler
 * that is off when the stutter happens.
 *
 * WHAT IT MEASURES, and what each number is worth:
 *
 *   frame     wall clock between one rAF and the next. This is the only number
 *             that is the truth — it includes everything, browser included.
 *   cpu       our own JS: the game update plus the draw calls we issue. Does
 *             NOT include the GPU actually doing the work.
 *   gpu       real GPU time for the draw, via EXT_disjoint_timer_query_webgl2
 *             where the browser allows it. Absent on most Apple hardware and
 *             on anything that considers it a fingerprinting vector, so it is
 *             reported as null rather than faked.
 *   p99/1%low the worst frames, not the average. A game that averages 8 ms and
 *             spikes to 40 four times a second reads as "smooth" in a mean and
 *             feels broken. The 1% low is what the player is complaining about.
 *
 * The GPU query is asynchronous by construction — you ask this frame and the
 * answer is ready several frames later — so it is polled, never awaited, and a
 * disjoint (a context switch on the GPU mid-measurement) throws the sample
 * away rather than reporting a spike that never happened.
 */

/** How many frames of history to keep. 600 at 60 Hz is ten seconds. */
const HISTORY = 600;
/** Never let more than this many timer queries be in flight. */
const MAX_QUERIES = 6;

export class Profiler {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;

    this.frames = new Float32Array(HISTORY);
    this.cpus = new Float32Array(HISTORY);
    this.gpus = new Float32Array(HISTORY);
    this.n = 0;                 // total frames seen
    this.i = 0;                 // write cursor

    this.last = 0;              // previous frame's timestamp
    this.cpuStart = 0;
    this.frameMs = 0;
    this.cpuMs = 0;
    this.gpuMs = null;          // null until a query comes back

    this.calls = 0;
    this.triangles = 0;
    this.programs = 0;
    this.geometries = 0;
    this.textures = 0;

    // Whatever the level costs is not the same as whatever a fight costs, and
    // the player's complaint was specifically that it got worse over time. So
    // the worst frame is kept for the whole session, not just the window.
    this.worst = 0;
    this.worstAt = 0;

    this._initGL();
  }

  _initGL() {
    this.ext = null;
    this.queries = [];
    this.pending = [];
    try {
      const gl = this.renderer.getContext();
      if (gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
        this.gl = gl;
        this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      }
    } catch { /* a context that will not answer is the same as not having one */ }
  }

  /** Called at the very top of the frame, before any game work. */
  begin(now) {
    if (!this.enabled) return;
    this.frameMs = this.last ? now - this.last : 0;
    this.last = now;
    this.cpuStart = performance.now();
  }

  /** Called immediately before the draw, so the GPU query wraps only the draw. */
  beginDraw() {
    if (!this.enabled || !this.ext || this.pending.length >= MAX_QUERIES) return;
    const gl = this.gl;
    const q = this.queries.pop() || gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this._active = q;
  }

  endDraw() {
    if (!this._active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this._active);
    this._active = null;
  }

  /** Called at the very end of the frame. */
  end() {
    if (!this.enabled) return;
    this.cpuMs = performance.now() - this.cpuStart;

    const info = this.renderer.info;
    this.calls = info.render.calls;
    this.triangles = info.render.triangles;
    this.programs = info.programs ? info.programs.length : 0;
    this.geometries = info.memory.geometries;
    this.textures = info.memory.textures;

    this._pollQueries();

    // The first frame after a load is always enormous and says nothing about
    // how the game runs, so it is recorded but never allowed to be "worst".
    if (this.n > 2 && this.frameMs > 0) {
      this.frames[this.i] = this.frameMs;
      this.cpus[this.i] = this.cpuMs;
      this.gpus[this.i] = this.gpuMs ?? 0;
      this.i = (this.i + 1) % HISTORY;
      if (this.frameMs > this.worst) { this.worst = this.frameMs; this.worstAt = this.n; }
    }
    this.n++;
  }

  _pollQueries() {
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl;
    // A disjoint means the GPU switched context mid-measurement. Every sample
    // in flight is suspect, so they all go — reporting a 40 ms spike that was
    // really the compositor stealing the GPU is worse than reporting nothing.
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      for (const q of this.pending) this.queries.push(q);
      this.pending.length = 0;
      return;
    }
    const q = this.pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    this.pending.shift();
    this.queries.push(q);
    this.gpuMs = ns / 1e6;
  }

  /** Sorted copy of the live window, for percentiles. */
  _sorted() {
    const count = Math.min(this.n - 3, HISTORY);
    if (count < 8) return null;
    const out = Array.from(this.frames.subarray(0, count));
    out.sort((a, b) => a - b);
    return out;
  }

  stats() {
    const s = this._sorted();
    if (!s) return null;
    const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return {
      frames: s.length,
      mean, fps: 1000 / mean,
      median: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      // The 1% LOW is the mean of the worst 1% of frames, not the 99th
      // percentile of one — it is what a player actually notices, and the two
      // differ by a lot on a game that hitches rather than sags.
      low1: (() => {
        const k = Math.max(1, Math.round(s.length * 0.01));
        let sum = 0;
        for (let j = s.length - k; j < s.length; j++) sum += s[j];
        return sum / k;
      })(),
      worst: this.worst,
    };
  }

  /**
   * One block of text a player can copy out of the pause screen and paste back.
   * Everything a diagnosis needs and nothing that identifies them.
   */
  report(extra = {}) {
    const s = this.stats();
    const L = [];
    L.push('SABER frame report');
    if (s) {
      L.push(`  frame   mean ${s.mean.toFixed(2)} ms (${s.fps.toFixed(0)} fps)  median ${s.median.toFixed(2)}`);
      L.push(`  worst   1% low ${s.low1.toFixed(2)} ms   p99 ${s.p99.toFixed(2)}   session worst ${s.worst.toFixed(1)}`);
      L.push(`  window  ${s.frames} frames`);
    } else {
      L.push('  (not enough frames yet)');
    }
    L.push(`  cpu     ${this.cpuMs.toFixed(2)} ms this frame`);
    L.push(`  gpu     ${this.gpuMs == null ? 'unavailable (no timer query)' : this.gpuMs.toFixed(2) + ' ms'}`);
    L.push(`  draw    ${this.calls} calls, ${(this.triangles / 1000).toFixed(0)}k triangles`);
    L.push(`  memory  ${this.geometries} geometries, ${this.textures} textures, ${this.programs} programs`);
    for (const [k, v] of Object.entries(extra)) L.push(`  ${k.padEnd(7)} ${v}`);
    const gl = this.renderer.getContext?.();
    try {
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) L.push(`  gpu id  ${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`);
    } catch { /* blocked, which is fine */ }
    return L.join('\n');
  }

  dispose() {
    if (!this.gl) return;
    for (const q of [...this.queries, ...this.pending]) {
      try { this.gl.deleteQuery(q); } catch { /* context already gone */ }
    }
    this.queries.length = 0;
    this.pending.length = 0;
  }
}
