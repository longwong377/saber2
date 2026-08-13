/**
 * SABER — what the ground remembers.
 *
 * THE COMPLAINT THIS FILE ANSWERS: "the tundra and the dune sea should show
 * where everything has been — the player and every enemy leaving prints and
 * trails that stay, and slowly fill in — and a Force push late in a run should
 * crater the ground where an early one barely scuffs it."
 *
 * None of that could be built on the heightfield. The reason is arithmetic and
 * it is worth stating once, because it decides the whole shape of this file:
 *
 *   the alpine grid is 320 vertices over 520 m, i.e. 1.63 m per cell, and
 *   `Terrain.crater` widens anything under step × 1.35 = 2.20 m because a
 *   feature narrower than the grid cannot be represented on it.
 *
 * A boot is 0.11 m across and a footprint is 0.25. It is twenty times smaller
 * than the smallest thing the mesh can hold, so a footprint IS NOT GEOMETRY
 * here — it is a SURFACE, and it belongs in the material with the ripples and
 * the sastrugi rather than in the vertex buffer with the dunes.
 *
 * So this is a second, much finer field laid over the same ground: a 0.25 m
 * grid in a window that follows the player, holding two numbers per cell —
 *
 *   DEPTH   how far the loose layer has been pushed down, in metres. The
 *           material reads it three ways: it tilts the normal by the depth
 *           GRADIENT (which is what actually makes a print read as a print —
 *           the lit wall and the shaded one), it darkens and cools the albedo
 *           in the trough because packed snow and turned sand are darker than
 *           the surface they came from, and it occludes the sky there.
 *   SCORCH  one scalar carrying temperature and then soot, because that is
 *           what it is: a saber cut goes in at 1.0, cools through the glow in
 *           about four seconds, and the char it leaves behind fades over half
 *           a minute. The shader splits them back out with two smoothsteps.
 *
 * WHY NOT REUSE THE GRASS TRAIL. GrassField already carries a 128² window of
 * exactly this shape, and it is the wrong object twice over: it is a mask over
 * the BLADES (press, cut, shove direction — all of it consumed by the grass
 * vertex shader), and it does not exist at all on a level with no grass, which
 * is every level this feature is for. The two windows are siblings, not one
 * thing, and they follow the same rules because the rules are right: toroidal
 * addressing so scrolling the window is clearing a column, a hold timer so a
 * still field costs no uploads, and a float mirror of the 8-bit buffer so a
 * decay slower than one part in 255 per tick is not entirely truncation.
 *
 * THE COST, measured and stated. One RGBA8 texture, 192² by default — 147 kB,
 * uploaded at most ten times a second and only while something in it is still
 * changing, so a field nobody has walked on costs one texture and zero
 * bandwidth. In the fragment shader it is ONE texture2D tap on a branch the
 * whole ground takes together, and everything else is arithmetic on the four
 * bytes it returns; there is no second tap for the gradient because the
 * gradient is computed here, on the CPU, when the texel is written.
 */

import * as THREE from 'three';
import { clamp } from '../engine/MathUtil.js';

/** Texels across the window. 192 at 48 m is a 25 cm cell — a boot print. */
export const SURFACE_RES = 192;
/** Metres across the window. Beyond it the ground forgets. */
export const SURFACE_SIZE = 48;
/** Seconds of ageing after the last mark before the field goes quiet. */
const SURFACE_HOLD = 0.35;
/** The ageing tick. Decay and upload happen at this rate, never per frame. */
const SURFACE_TICK = 0.1;
/**
 * Full-scale of the encoded gradient, in metres of depth per metre of ground.
 * 1.0 is a 45° wall; the byte saturates at 2.0, which is the steepest side a
 * 25 cm cell can hold before it is a cliff rather than a print.
 */
export const SURFACE_GRAD_FS = 2.0;
/** Below this the cell is undisturbed and stops being counted as live. */
const EPS = 1.5 / 255;

/**
 * A scrolling record of what has happened to the loose layer of ground.
 *
 * All coordinates are WORLD metres. Everything outside the window is silently
 * dropped rather than wrapped, because the addressing is toroidal and a mark
 * one window away would land on a texel belonging to completely different
 * ground — the same rule, for the same reason, as GrassField.disturb.
 */
export class SurfaceField {
  /**
   * @param {object} [opts]
   * @param {number} [opts.res]     texels across the window
   * @param {number} [opts.size]    metres across the window
   * @param {number} [opts.depth]   metres of depth the byte's 255 stands for
   * @param {number} [opts.refill]  e-folding time of the fill-in, seconds
   */
  constructor(opts = {}) {
    this.res = Math.max(32, Math.round(opts.res ?? SURFACE_RES));
    this.size = Math.max(8, opts.size ?? SURFACE_SIZE);
    this.cell = this.size / this.res;
    /* THE DEPTH THE BYTE STANDS FOR is per level, not per game: a boot in
     * fresh snow goes in a third of a metre and the same boot on a wind-packed
     * salt pan leaves a scuff. Scaling the ENCODING rather than the marks is
     * what keeps the full eight bits of precision on both. */
    this.maxDepth = Math.max(0.02, opts.depth ?? 0.30);
    this.refill = Math.max(1, opts.refill ?? 120);
    this.scorchGlow = opts.scorchGlow ?? 1.7;    // seconds, molten → dull
    this.scorchChar = opts.scorchChar ?? 26;     // seconds, char → gone

    const n = this.res * this.res;
    /** Depth in METRES, the authority. The texture is a lossy view of this. */
    this.depth = new Float32Array(n);
    /** 0..1. Above 0.5 is still glowing; below it is soot going cold. */
    this.scorch = new Float32Array(n);
    this.data = new Uint8Array(n * 4);
    for (let o = 0; o < this.data.length; o += 4) { this.data[o + 1] = 128; this.data[o + 2] = 128; }

    const tex = new THREE.DataTexture(this.data, this.res, this.res, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;

    this.center = new THREE.Vector2(0, 0);
    this._ci = 0; this._cj = 0;
    this._hot = 0;
    this._accum = 0;
    this._dirty = null;      // {i0,j0,i1,j1} in unwrapped cell coordinates
    this._live = 0;          // cells still holding anything
    this.marks = 0;          // every stamp that landed, for the checks
  }

  /* ── addressing ────────────────────────────────────────────────────── */

  /** Cell index of a world x (or z). Anchored to the WORLD, never the window. */
  _cellOf(v) { return Math.floor(v / this.cell); }
  _wrap(i) { const N = this.res; return ((i % N) + N) % N; }
  _k(i, j) { return this._wrap(j) * this.res + this._wrap(i); }

  /** True when (x, z) is inside the window and a mark there means anything. */
  covers(x, z) {
    return Math.max(Math.abs(x - this.center.x), Math.abs(z - this.center.y)) <= this.size * 0.47;
  }

  _touch(i0, j0, i1, j1) {
    const d = this._dirty;
    if (!d) this._dirty = { i0, j0, i1, j1 };
    else {
      if (i0 < d.i0) d.i0 = i0; if (j0 < d.j0) d.j0 = j0;
      if (i1 > d.i1) d.i1 = i1; if (j1 > d.j1) d.j1 = j1;
    }
    this._hot = SURFACE_HOLD;
  }

  /* ── the window follows the player ─────────────────────────────────── */

  /**
   * Slide the window. Addressing is toroidal, so the column leaving the back
   * has the same texel index as the one arriving at the front and moving the
   * window is exactly clearing that column — the ground beyond the window has
   * not been remembered, and pretending otherwise is how a print ends up
   * printed on a hillside 48 m away.
   */
  follow(x, z) {
    this.center.set(x, z);
    const N = this.res;
    const ni = this._cellOf(x), nj = this._cellOf(z);
    let di = ni - this._ci, dj = nj - this._cj;
    if (di === 0 && dj === 0) return;
    if (Math.abs(di) >= N || Math.abs(dj) >= N) {
      this.depth.fill(0); this.scorch.fill(0); this._live = 0;
      for (let o = 0; o < this.data.length; o += 4) {
        this.data[o] = 0; this.data[o + 1] = 128; this.data[o + 2] = 128; this.data[o + 3] = 0;
      }
      this._dirty = null;
      this.texture.needsUpdate = true;
    } else {
      const half = (N / 2) | 0;
      for (let k = 0; k < Math.abs(di); k++) this._clearCol(di > 0 ? this._ci + half + 1 + k : this._ci - half - k);
      for (let k = 0; k < Math.abs(dj); k++) this._clearRow(dj > 0 ? this._cj + half + 1 + k : this._cj - half - k);
      this.texture.needsUpdate = true;
    }
    this._ci = ni; this._cj = nj;
  }

  _clearCol(i) {
    const N = this.res, ii = this._wrap(i);
    for (let j = 0; j < N; j++) {
      const k = j * N + ii, o = k * 4;
      this.depth[k] = 0; this.scorch[k] = 0;
      this.data[o] = 0; this.data[o + 1] = 128; this.data[o + 2] = 128; this.data[o + 3] = 0;
    }
  }

  _clearRow(j) {
    const N = this.res, jj = this._wrap(j);
    for (let i = 0; i < N; i++) {
      const k = jj * N + i, o = k * 4;
      this.depth[k] = 0; this.scorch[k] = 0;
      this.data[o] = 0; this.data[o + 1] = 128; this.data[o + 2] = 128; this.data[o + 3] = 0;
    }
  }

  /* ── marks ─────────────────────────────────────────────────────────── */

  /**
   * A footfall, a landing, a body hitting the ground: a bowl pressed into the
   * loose layer with the material it displaced piled just outside it.
   *
   * `dirX/dirZ` lengthen the print along the direction of travel, because a
   * running step is a smear and a standing one is a hole — and the rim goes
   * BEHIND, where the foot pushed the material.
   *
   * @param {number} radius  metres
   * @param {number} depth   metres, positive = down. Clamped to the layer.
   * @returns {number} cells actually written
   */
  tread(x, z, radius, depth, dirX = 0, dirZ = 0, opts = {}) {
    if (!this.covers(x, z) || depth === 0) return 0;
    const cell = this.cell;
    /* A PRINT CANNOT BE SMALLER THAN A TEXEL and still be a print. A boot is
     * 0.11 m across against a 0.25 m cell, so at its true radius every cell it
     * touches sits on the bowl's WALL and the deepest thing the field records
     * is a third of the depth asked for — measured, 0.029 m out of 0.08. It is
     * the same trade `Terrain.crater` makes against the 1.6 m heightfield one
     * level up, and it is made the same way: widen to what the grid can hold.
     * The depth is NOT shallowed to match, because unlike a crater this is not
     * conserving displaced material — it is drawing a mark that has to be
     * visible at the size the ground can draw it.
     *
     * 1.25 cells, not 1.7: at 25 cm a texel that is 0.42 m of print with a
     * 0.57 m rim on it, laid at a walking stride of 0.7 m, is a continuous
     * trough rather than a line of prints. Rendered on the alpine at 1.7 it
     * came out as broad soft undulations in the snow — deformation, but not
     * FOOTPRINTS. 1.25 gives a 0.30 m mark, which is a boot. */
    const r = Math.max(cell * 1.25, radius);
    const rim = opts.rim ?? 0.30;
    const speed = Math.hypot(dirX, dirZ);
    const ux = speed > 1e-4 ? dirX / speed : 0, uz = speed > 1e-4 ? dirZ / speed : 0;
    // A smear is the same bowl in an ellipse: `stretch` along the travel axis,
    // and the area is held by narrowing it across, so a run does not press a
    // wider hole than a stand does.
    const stretch = 1 + clamp(opts.stretch ?? 0, 0, 2.5);
    const across = 1 / Math.sqrt(stretch);
    const reach = r * Math.max(stretch, 1) * 1.3;
    const i0 = this._cellOf(x - reach), i1 = this._cellOf(x + reach) + 1;
    const j0 = this._cellOf(z - reach), j1 = this._cellOf(z + reach) + 1;
    const maxD = this.maxDepth;
    let hit = 0;
    for (let j = j0; j <= j1; j++) {
      const wz = (j + 0.5) * cell - z;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) * cell - x;
        // into the print's own frame: along travel, across it
        const al = speed > 1e-4 ? (wx * ux + wz * uz) / stretch : wx;
        const ac = speed > 1e-4 ? (-wx * uz + wz * ux) / across : wz;
        const d = Math.hypot(al, ac) / r;
        if (d > 1.35) continue;
        const k = this._k(i, j);
        let delta;
        if (d <= 1) {
          // A flat-bottomed bowl with a soft wall, not a cone: a cone only
          // reaches its full depth at one texel and reads as a dimple. Full
          // depth out to 0.74 of the radius, then a wall — which is also what
          // gives the gradient channel something steep to encode.
          delta = -depth * Math.min(1, (1 - d * d) * 2.2);
        } else {
          // the berm of displaced material, thrown behind a moving foot
          const behind = speed > 1e-4 ? clamp(0.55 - (al / r) * 0.9, 0.15, 1.6) : 1;
          delta = depth * rim * behind * Math.exp(-Math.pow((d - 1.06) * 7.0, 2));
        }
        const was = this.depth[k];
        /* Deepen, never fill: walking over your own print does not undo it,
         * and — the case that is easy to miss — the BERM of a later step must
         * not fill in an earlier step's hole either. A trail is a sequence of
         * overlapping prints, so without that guard a second pass over the
         * same ground erases the first with its own displaced material. */
        const v = clamp(
          delta < 0 ? Math.min(was, delta) : (was < 0 ? was : Math.max(was, delta)),
          -maxD, maxD * 0.6);
        if (v !== was) {
          this.depth[k] = v;
          if (Math.abs(was) < EPS * maxD && Math.abs(v) >= EPS * maxD) this._live++;
          hit++;
        }
      }
    }
    if (hit) { this._touch(i0 - 1, j0 - 1, i1 + 1, j1 + 1); this.marks++; }
    return hit;
  }

  /**
   * Heat laid on the ground: a saber tip dragged through it, slag off a cut, a
   * bolt that missed. One scalar — 1.0 is molten and the shader reads the top
   * of the range as glow and the bottom as soot.
   */
  burn(x, z, radius, heat = 1) {
    if (!this.covers(x, z) || heat <= 0) return 0;
    const cell = this.cell;
    const r = Math.max(cell * 0.8, radius);
    const i0 = this._cellOf(x - r), i1 = this._cellOf(x + r) + 1;
    const j0 = this._cellOf(z - r), j1 = this._cellOf(z + r) + 1;
    let hit = 0;
    for (let j = j0; j <= j1; j++) {
      const wz = (j + 0.5) * cell - z;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) * cell - x;
        const d = Math.hypot(wx, wz) / r;
        if (d > 1) continue;
        const k = this._k(i, j);
        const v = clamp(heat * Math.min(1, (1 - d * d) * 1.5), 0, 1);
        if (v > this.scorch[k]) {
          if (this.scorch[k] < EPS && v >= EPS) this._live++;
          this.scorch[k] = v;
          hit++;
        }
      }
    }
    if (hit) { this._touch(i0 - 1, j0 - 1, i1 + 1, j1 + 1); this.marks++; }
    return hit;
  }

  /**
   * A blade dragged from `a` to `b`: a narrow trench, glowing along its whole
   * length. The trench is what makes it read as a CUT and not as a painted
   * line — the ground either side of it catches the light differently.
   */
  gouge(a, b, radius = 0.10, depth = 0.07, heat = 1) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.min(64, Math.max(1, Math.ceil(len / Math.max(0.04, radius * 0.7))));
    let hit = 0;
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const x = a.x + dx * t, z = a.z + dz * t;
      hit += this.tread(x, z, radius, depth, dx, dz, { rim: 0.22, stretch: 0.2 });
      hit += this.burn(x, z, radius * 1.5, heat);
    }
    return hit;
  }

  /* ── reading it back ───────────────────────────────────────────────── */

  /** Metres pressed down at a point; negative is a berm standing proud. */
  depthAt(x, z) {
    if (!this.covers(x, z)) return 0;
    return -this.depth[this._k(this._cellOf(x), this._cellOf(z))];
  }

  /** 0..1, what the shader will read as glow-then-soot. */
  scorchAt(x, z) {
    if (!this.covers(x, z)) return 0;
    return this.scorch[this._k(this._cellOf(x), this._cellOf(z))];
  }

  /** How many cells still hold anything at all. */
  get live() { return this._live; }

  /* ── ageing ────────────────────────────────────────────────────────── */

  /**
   * Age the field and push whatever changed to the GPU.
   *
   * The tick is FIXED at 10 Hz and not per frame, and that is both halves of
   * the budget: the decay is 37k cells of arithmetic and the upload is 147 kB,
   * so doing either at 144 Hz would be the most expensive thing on the ground.
   * A field with nothing in it does neither.
   */
  update(dt) {
    if (this._dirty) this._encode();
    if (this._live === 0) { this._hot = 0; return; }
    this._accum += dt;
    if (this._accum < SURFACE_TICK) return;
    const step = this._accum;
    this._accum = 0;
    this._age(step);
    this._encodeAll();
  }

  _age(dt) {
    /* THE FILL-IN IS NOT ONE EXPONENTIAL. A pure `v *= exp(-dt/tau)` never
     * arrives: at tau = 240 s a 0.3 m print is still 3 mm deep four minutes
     * later, so `live` never falls and the field uploads for ever. The
     * absolute term is what actually closes a print — drifting snow and blown
     * sand fill a hollow at a rate set by the WIND, not by how deep it already
     * is — and it is what lets the field go quiet again. */
    const kD = Math.exp(-dt / this.refill);
    const floorD = this.maxDepth * (dt / (this.refill * 6));
    const kG = Math.exp(-dt / this.scorchGlow);
    const kC = Math.exp(-dt / this.scorchChar);
    const D = this.depth, S = this.scorch;
    const eps = EPS * this.maxDepth;
    let live = 0;
    for (let k = 0; k < D.length; k++) {
      let d = D[k];
      if (d !== 0) {
        const mag = Math.abs(d) * kD - floorD;
        d = mag <= eps ? 0 : Math.sign(d) * mag;
        D[k] = d;
      }
      let s = S[k];
      if (s !== 0) {
        /* Above the half-way mark it is TEMPERATURE and it falls fast; the
         * whole of it is SOOT and that falls slowly. Both rates are applied,
         * not one or the other: a two-branch form that only chars below 0.5
         * has 0.5 as a fixed point it approaches from above and never leaves,
         * so the scar sits at exactly half glow for ever. Measured before the
         * fix: 0.500 at thirty seconds, and at three hundred. */
        s = (s > 0.5 ? 0.5 + (s - 0.5) * kG : s) * kC;
        if (s < EPS) s = 0;
        S[k] = s;
      }
      if (d !== 0 || s !== 0) live++;
    }
    this._live = live;
  }

  /** Re-encode one rectangle of cells, expanded by the gradient's own stencil. */
  _encode() {
    const d = this._dirty;
    this._dirty = null;
    if (!d) return;
    for (let j = d.j0; j <= d.j1; j++) for (let i = d.i0; i <= d.i1; i++) this._encodeCell(i, j);
    this.texture.needsUpdate = true;
  }

  _encodeAll() {
    const N = this.res;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this._encodeCell(i, j);
    this._dirty = null;
    this.texture.needsUpdate = true;
  }

  _encodeCell(i, j) {
    const inv = 1 / this.maxDepth;
    const k = this._k(i, j), o = k * 4;
    const v = this.depth[k];
    // Central differences on the live depth. Doing it here rather than with
    // three more taps in the fragment shader is the whole reason this costs
    // ONE texture2D on the ground.
    /* NEGATED, into the normal-map convention. `depth` is a height OFFSET —
     * negative inside a print — and a tangent-space normal for a height field
     * h is (−∂h/∂u, −∂h/∂v, 1), which is what the terrain material's
     * `terNrmOff` is summed in alongside the ripple relief. Storing +∇depth
     * lights every print inside out: the far wall catches the sun and the near
     * one goes dark, which reads as a MOUND, and a trail of mounds across a
     * snowfield is the one thing worse than no trail at all. */
    const gx = -(this.depth[this._k(i + 1, j)] - this.depth[this._k(i - 1, j)]) / (2 * this.cell);
    const gz = -(this.depth[this._k(i, j + 1)] - this.depth[this._k(i, j - 1)]) / (2 * this.cell);
    this.data[o] = Math.round(clamp(-v * inv, 0, 1) * 255);
    this.data[o + 1] = Math.round(128 + clamp(gx / SURFACE_GRAD_FS, -1, 1) * 127);
    this.data[o + 2] = Math.round(128 + clamp(gz / SURFACE_GRAD_FS, -1, 1) * 127);
    this.data[o + 3] = Math.round(clamp(this.scorch[k], 0, 1) * 255);
  }

  dispose() { this.texture.dispose(); }
}
