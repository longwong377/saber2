/**
 * BATTLEFRONT BORZ — procedural texture foundry.
 *
 * Every surface in the game is generated here at boot. No image files, nothing
 * to download, and full control over tiling, normal strength and roughness.
 * Heightfields are authored once and albedo/normal/roughness are derived from
 * them, which keeps lighting response consistent across every material.
 *
 * Three rules this file is built on, each of which it used to break:
 *
 *  1. EVERY tiling map wraps. All the noise below is periodic on an integer
 *     lattice whose period equals its own frequency, so the last column meets
 *     the first exactly. Measured before this pass: the wrap discontinuity was
 *     6.5× the local gradient on duracrete, 5.0× on armour, 4.6× on sand — a
 *     hard line down every tile boundary on every wall and every stormtrooper.
 *  2. NOTHING below ~8 cycles per tile. A soft blob at 4-6 cycles is the single
 *     loudest tiling tell there is: the eye reads the blob, not the grain, and
 *     the repeat becomes a grid. Macro variation is the *consumer's* job — the
 *     terrain shader has world-space noise for it, props have vertex colour.
 *     (This is the same disease that once baked "condensation" into every robe.)
 *  3. ALBEDO IS AUTHORED IN LINEAR AND CALIBRATED. Samplers return linear
 *     reflectance; the writer encodes to sRGB. Each map is then scaled so its
 *     mean linear albedo lands exactly on a measured value, which is what lets
 *     Props.js and Bodies.js multiply by a known tint and get a known result.
 *
 * Measured mean linear albedo of each map (this is the contract the rest of the
 * game tints against — see MEAN_ALBEDO and tools/checks/materials.mjs):
 *
 *   sand  0.578 0.399 0.190     rock   0.110 0.080 0.059    metal 0.318 0.353 0.416
 *   cloth 0.935 0.935 0.935     armor  0.668 0.653 0.623    crete 0.332 0.318 0.290
 *
 * The two terrain-only carriers, soil and snow, are a different kind of number
 * and are documented where they are declared: nothing tints against them, the
 * terrain reads only their luminance, and they are pinned to the mean the
 * terrain shader's own arithmetic expects (0.389). See MEAN_ALBEDO.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { fbm2, clamp, lerp, makeRng } from './MathUtil.js';

const cache = new Map();

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * Does this environment have a 2D context that can actually give pixels back?
 * A real browser can; the Node DOM shim the checks run under accepts
 * putImageData and returns zeros from getImageData, which is exactly the kind
 * of silent black readback that makes a texture measure as perfect.
 */
let _readable = null;
function canvasReadable() {
  if (_readable !== null) return _readable;
  try {
    const ctx = canvasOf(1).getContext('2d');
    const img = ctx.createImageData(1, 1);
    img.data[0] = 173; img.data[3] = 255;
    ctx.putImageData(img, 0, 0);
    _readable = ctx.getImageData(0, 0, 1, 1).data[0] === 173;
  } catch { _readable = false; }
  return _readable;
}

/**
 * Linear reflectance → sRGB display encoding, through an interpolated table.
 * The exact form needs a Math.pow per channel per texel — twelve million of
 * them across a boot — and the table is accurate to well under one 8-bit code.
 */
const SRGB_LUT = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) {
  const c = i / 4096;
  SRGB_LUT[i] = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function encodeSrgb(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const t = c * 4096, i = t | 0, f = t - i;
  return SRGB_LUT[i] + (SRGB_LUT[i + 1] - SRGB_LUT[i]) * f;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Periodic noise                                                        */
/*                                                                        */
/*  MathUtil's noise is fine for world-space fields but it does not wrap,  */
/*  and a texture that does not wrap has a seam. Everything here takes an  */
/*  explicit lattice period; call it with period == frequency and the      */
/*  result is exactly periodic over the unit tile.                         */
/* ══════════════════════════════════════════════════════════════════════ */

const PP = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = makeRng(20857);
  for (let i = 255; i > 0; i--) { const j = r.int(0, i); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PP[i] = p[i & 255];
}

// Branchy but hot: this runs tens of millions of times per bake and the double
// modulo it replaces was measurable.
const wrapi = (i, n) => (i >= 0 ? (i < n ? i : i % n) : ((i % n) + n) % n);
/** Deterministic 0..1 from a pair of lattice coordinates. */
const hash2 = (a, b, s = 0) => PP[(PP[(a + s) & 255] + b) & 255] / 255;
const fade5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const K = 1.4142135;
const grad = (h, x, y) => {
  switch (h & 7) {
    case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
    case 4: return x * K; case 5: return -x * K; case 6: return y * K; default: return -y * K;
  }
};

/**
 * Perlin gradient noise, wrapping on a `px` × `py` lattice. Roughly [-1, 1].
 * Periods above 256 alias in the hash table (cell 0 and cell 256 share a
 * gradient) but stay geometrically periodic, which is the property that
 * matters here.
 */
function pnoise(x, y, px, py = px, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  // no closure in here: this runs ~15 million times per bake and a per-call
  // arrow function was two thirds of the foundry's boot cost
  const w0 = wrapi(xi, px), v0 = wrapi(yi, py);
  const a0 = PP[(w0 + seed) & 255], a1 = PP[((w0 + 1 < px ? w0 + 1 : 0) + seed) & 255];
  const y0 = v0, y1 = v0 + 1 < py ? v0 + 1 : 0;
  const u = fade5(fx), v = fade5(fy);
  const n00 = grad(PP[(a0 + y0) & 255], fx, fy);
  const n10 = grad(PP[(a1 + y0) & 255], fx - 1, fy);
  const n01 = grad(PP[(a0 + y1) & 255], fx, fy - 1);
  const n11 = grad(PP[(a1 + y1) & 255], fx - 1, fy - 1);
  const ix0 = n00 + (n10 - n00) * u, ix1 = n01 + (n11 - n01) * u;
  return (ix0 + (ix1 - ix0) * v) * 1.32;
}

/** fbm with lacunarity exactly 2, so every octave's period divides the tile. */
function pfbm(u, v, cycles, oct = 4, gain = 0.5, seed = 0) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += pnoise(u * cycles * f, v * cycles * f, cycles * f, cycles * f, seed + i * 37) * a;
    n += a; a *= gain; f *= 2;
  }
  return s / n;
}

/** Anisotropic single-octave noise: long in v, tight in u (brushed metal, streaks). */
const pstretch = (u, v, cu, cv, seed = 0) => pnoise(u * cu, v * cv, cu, cv, seed);

/** Ridged multifractal — sharp crests for rock and crazing. */
function pridged(u, v, cycles, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, prev = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    let x = 1 - Math.abs(pnoise(u * cycles * f, v * cycles * f, cycles * f, cycles * f, seed + i * 53));
    x *= x * prev; prev = x;
    s += x * a; n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

const _w = new Float64Array(3);
/**
 * Periodic cellular noise → [F1, F2, id].
 *
 * Feature points are jittered inside the middle 70% of their cell, which keeps
 * the 3×3 search exact for both F1 and F2. F2 − F1 goes to zero on cell
 * *borders*, giving a proper fracture network instead of thresholded blobs;
 * `id` is a 0..1 constant across each cell, which is what lets a field be made
 * of discrete pieces — broken rock where every block sits at its own height and
 * tone — rather than of smooth distance falloffs.
 */
function pworley(u, v, cells, seed = 0) {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 99, f2 = 99, id = 0;         // squared until the very end
  const bx = wrapi(xi - 1, cells), by = wrapi(yi - 1, cells);
  let wy = by;
  for (let j = -1; j <= 1; j++) {
    let wx = bx;
    const cy = yi + j;
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const ha = PP[(PP[(wx + seed) & 255] + wy) & 255];
      const hb = PP[(ha + 89 + seed) & 255];
      const dx = cx + 0.15 + ha * 0.00274510 - x;
      const dy = cy + 0.15 + hb * 0.00274510 - y;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = PP[(hb + 151 + seed) & 255]; } else if (d < f2) f2 = d;
      if (++wx >= cells) wx = 0;
    }
    if (++wy >= cells) wy = 0;
  }
  _w[0] = Math.sqrt(f1); _w[1] = Math.sqrt(f2); _w[2] = id / 255;
  return _w;
}

const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/**
 * An asymmetric periodic wave along the lattice direction (cu, cv). Both must
 * be integers or the tile stops wrapping. `skew` < 0.5 puts the crest early:
 * wind ripples climb a long stoss slope and drop down a short lee face, which
 * is the difference between sand and corrugated iron.
 */
function ridgeWave(u, v, cu, cv, phase, skew) {
  const t = u * cu + v * cv + phase;
  const f = t - Math.floor(t);
  const p = f < skew ? f / skew : (1 - f) / (1 - skew);
  return p * p * (3 - 2 * p);
}

/**
 * The primitive set, exposed so tools/checks/materials.mjs can prove the one
 * property everything above depends on: that each of these meets itself after
 * exactly one tile in u and in v. Statistics on a baked map can only ever
 * suggest a seam; this is the property itself.
 */
export const PERIODIC = { pnoise, pfbm, pridged, pworley, pstretch, ridgeWave, hash2 };

/* ══════════════════════════════════════════════════════════════════════ */
/*  The baker                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/** Separable box blur that wraps, O(n) per radius. Used for the cavity AO. */
function boxBlurWrap(src, dst, size, r, tmp) {
  const w = 2 * r + 1, inv = 1 / w;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + wrapi(k, size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = sum * inv;
      sum += src[row + wrapi(x + r + 1, size)] - src[row + wrapi(x - r, size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[wrapi(k, size) * size + x];
    for (let y = 0; y < size; y++) {
      dst[y * size + x] = sum * inv;
      sum += tmp[wrapi(y + r + 1, size) * size + x] - tmp[wrapi(y - r, size) * size + x];
    }
  }
  return dst;
}

/**
 * Build albedo / normal / packed-roughness from a single sampler.
 *
 * sampler(u, v, x, y) → { h, r, g, b, rough, metal }  — r,g,b LINEAR.
 *
 * opts:
 *   normalStrength  slope gain; resolution independent (scaled by size/512)
 *   ao / aoFloor    cavity occlusion depth and its clamp
 *   aoRough         how much occlusion roughens (dust settles in the cavities)
 *   grime           linear colour that occlusion tints toward
 *   grimeAmount     how far
 *   calibrate       [r,g,b] target mean LINEAR albedo of the finished map
 */
function bake(size, sampler, opts = {}) {
  const {
    normalStrength = 2.0, ao = 0.75, aoFloor = 0.42, aoRough = 0,
    grime = null, grimeAmount = 0, calibrate = null,
  } = opts;
  const N = size * size;
  const H = new Float32Array(N);
  const CR = new Float32Array(N), CG = new Float32Array(N), CB = new Float32Array(N);
  const RO = new Float32Array(N), ME = new Float32Array(N);
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const s = sampler(x * inv, y * inv, x, y);
      H[i] = s.h;
      CR[i] = s.r; CG[i] = s.g; CB[i] = s.b;
      RO[i] = clamp(s.rough ?? 0.8, 0, 1);
      ME[i] = clamp(s.metal ?? 0, 0, 1);
    }
  }

  /* ── cavity occlusion ────────────────────────────────────────────────
   * Three scales of "how far below my neighbourhood am I", normalised by each
   * scale's own spread so one strength knob means the same thing on every
   * material. Crucially this only ever DARKENS. The old Laplacian version was
   * allowed to reach 1.15, which put a bright halo around every crack — the
   * cheapest possible tell that a texture was generated rather than measured. */
  const AO = new Float32Array(N).fill(1);
  if (ao > 0) {
    const scales = [[Math.max(1, size >> 7), 0.46], [Math.max(2, size >> 5), 0.34], [Math.max(4, size >> 3), 0.20]];
    const blur = new Float32Array(N), occ = new Float32Array(N), scratch = new Float32Array(N);
    for (const [r, w] of scales) {
      boxBlurWrap(H, blur, size, r, scratch);
      let s = 0, ss = 0;
      for (let i = 0; i < N; i++) { const d = blur[i] - H[i]; s += d; ss += d * d; }
      const m = s / N, sd = Math.sqrt(Math.max(1e-14, ss / N - m * m));
      const k = 1 / (sd * 2.3);
      for (let i = 0; i < N; i++) occ[i] += w * clamp((blur[i] - H[i]) * k, 0, 1.35);
    }
    for (let i = 0; i < N; i++) AO[i] = clamp(1 - ao * occ[i], aoFloor, 1);
  }

  // Dirt lives where light does not reach. Tying grime to the occlusion rather
  // than to a second noise field is both cheaper and the reason it reads as
  // dirt: it lands in the seams, the pits and the weave, never on the crowns.
  if (grime && grimeAmount > 0) {
    for (let i = 0; i < N; i++) {
      const t = (1 - AO[i]) * grimeAmount;
      CR[i] += (grime[0] - CR[i]) * t;
      CG[i] += (grime[1] - CG[i]) * t;
      CB[i] += (grime[2] - CB[i]) * t;
    }
  }
  if (aoRough) for (let i = 0; i < N; i++) RO[i] = clamp(RO[i] + (1 - AO[i]) * aoRough, 0, 1);

  for (let i = 0; i < N; i++) { CR[i] *= AO[i]; CG[i] *= AO[i]; CB[i] *= AO[i]; }

  /* ── calibration ─────────────────────────────────────────────────────
   * Author the structure, then scale onto a real measured albedo. One pass is
   * exact when nothing clamps; where the bright tail does clip — cloth, whose
   * mean of 0.935 leaves almost no headroom — it iterates to within a fraction
   * of a percent. */
  if (calibrate) {
    for (const [ch, target] of [[CR, calibrate[0]], [CG, calibrate[1]], [CB, calibrate[2]]]) {
      let k = 1;
      for (let pass = 0; pass < 4; pass++) {
        let s = 0, clipped = 0;
        for (let i = 0; i < N; i++) { const v = ch[i] * k; if (v > 1) { s += 1; clipped++; } else s += v; }
        k *= target / Math.max(1e-9, s / N);
        if (!clipped) break;    // nothing is clamped, so one pass was exact
      }
      for (let i = 0; i < N; i++) ch[i] = clamp(ch[i] * k, 0, 1);
    }
  }

  const albedo = new Uint8ClampedArray(N * 4);
  const rough = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    albedo[i * 4] = encodeSrgb(CR[i]) * 255;
    albedo[i * 4 + 1] = encodeSrgb(CG[i]) * 255;
    albedo[i * 4 + 2] = encodeSrgb(CB[i]) * 255;
    albedo[i * 4 + 3] = 255;
    // three's packed workflow: G = roughness, B = metalness
    rough[i * 4] = 255; rough[i * 4 + 1] = RO[i] * 255; rough[i * 4 + 2] = ME[i] * 255; rough[i * 4 + 3] = 255;
  }

  /* ── normals ─────────────────────────────────────────────────────────
   * Sobel on the wrapped height. The gain carries size/512 so a map can change
   * resolution without its bumps changing depth. */
  const nrm = new Uint8ClampedArray(N * 4);
  const at = (x, y) => H[wrapi(y, size) * size + wrapi(x, size)];
  const gain = normalStrength * size / 512;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
               - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
               - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * gain, ny = -dy * gain;
      const len = Math.hypot(nx, ny, 1);
      nrm[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
    }
  }

  const mk = (data) => {
    const c = canvasOf(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    // Verification needs the finished bytes. In a browser they can be read back
    // off the canvas, so keep nothing; under the headless DOM shim getImageData
    // returns zeros, so the array has to be held. Holding it unconditionally
    // would have doubled the foundry's footprint — 23 MB the game never reads.
    if (!canvasReadable()) c.pixels = data;
    return c;
  };
  /*
   * THE ALBEDO GETS A CANVAS AT BOOT. THE OTHER TWO GET ONE WHEN SOMEBODY ASKS,
   * WHICH IN THE SHIPPED GAME IS NEVER.
   *
   * `materialFrom` binds `normalMap: null` and `roughnessMap: null` — there is
   * nothing left in the shader that reads either (see the note there) — so the
   * two canvases below were allocated, filled with createImageData and written
   * with putImageData at boot, for every surface in the foundry, and then
   * handed to nothing. At 512² that is two 1 MB backing stores and 262 144
   * pixel writes each, nine surfaces deep: 18 MB of canvas and 4.7 million
   * writes on the load screen, none of it uploaded and none of it read.
   *
   * The BYTES are still computed eagerly and that is deliberate — they are a
   * few tight loops over arrays that already exist, `rawMaps` needs them, and
   * tools/checks/materials.mjs measures the structure precisely so that a
   * surface whose relief was authored can come back if this is ever revisited.
   * What is deferred is the DOM object, which is the part that costs. Ask for
   * `.normal` or `.rough` and it is built once and memoised, so the checks that
   * read them see exactly what they saw before.
   */
  let nrmCanvas = null, roughCanvas = null;
  return {
    albedo: mk(albedo),
    get normal() { return (nrmCanvas ||= mk(nrm)); },
    get rough() { return (roughCanvas ||= mk(rough)); },
    /** Has a canvas been materialised for the unbound maps? For the check. */
    get lazyBuilt() { return (nrmCanvas ? 1 : 0) + (roughCanvas ? 1 : 0); },
    size,
  };
}

function toTexture(canvas, { repeat = 1, srgb = false, aniso = 8, bake = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  /**
   * WHICH BAKE THIS CAME FROM, CARRIED ON THE TEXTURE.
   *
   * Tiling lives on the texture object, so one bake produces a DIFFERENT
   * texture per repeat — `sand@2` and `sand@26` are two objects over the same
   * pixels. Anything downstream that wants to know "which surface is this"
   * had to keep its own map keyed on object identity, and identity is exactly
   * what varies: `tools/checks/environment.mjs` did that, missed, and fell
   * back to a hard-coded 3, so it measured the fallback instead of the map and
   * reported an albedo that was really `max(colour) * 3`.
   *
   * The name is on the texture now. It costs one string per texture and it
   * removes a whole class of "I could not identify my own subject" from every
   * consumer, present and future.
   */
  if (bake) { t.name = bake; t.userData.saberBake = bake; }
  t.needsUpdate = true;
  return t;
}

const baked = new Map();      // name → canvases, shared across tilings

function materialFrom(name, size, sampler, opts = {}) {
  const repeat = opts.repeat ?? 1;
  // Tiling lives on the texture object, so each distinct repeat needs its own
  // texture. The expensive part — baking the pixels — is still done once.
  const key = `${name}@${repeat}`;
  if (cache.has(key)) return cache.get(key);
  if (!baked.has(name)) baked.set(name, bake(size, sampler, opts));
  const b = baked.get(name);
  /* THE ORM MAP IS NO LONGER BOUND, and this is the cel model paying for
   * itself rather than a tidy-up.
   *
   * It used to be one texture object serving both roughnessMap and
   * metalnessMap — they are the same packed image, and handing three two
   * CanvasTextures over one canvas uploaded every ORM map to the GPU twice.
   * Under the cel model there is nothing left to read it: the GGX lobe, the
   * sheen lobe and the environment reflection are gone from the shader (see
   * src/toon/Cel.js), which is every consumer of `material.roughness`; and
   * `metalnessFactor` no longer divides the diffuse, which was the only other
   * consumer. A bound ORM map is therefore one texture fetch per fragment, on
   * every lit material in the game, whose result is multiplied by nothing.
   *
   * The BAKE is untouched — `b.rough` still exists, tools/checks/materials.mjs
   * still measures it, and rawMaps still returns it — because what is dead is
   * the BINDING, not the data, and a surface whose roughness structure was
   * never authored is a surface that cannot come back if this is ever revisited.
   *
   * Same for the normal map, and for the same reason at one remove: a detail
   * normal under a two-tone terminator does not read as relief, it reads as
   * speckle (see TER_RELIEF in Terrain.js for the measurement that showed it).
   * Dropping the binding also drops the tangent-frame varyings three generates
   * for it, which is three floats of interpolation per vertex as well as the
   * fetch. */
  const set = {
    map: toTexture(b.albedo, { repeat, srgb: true, bake: name }),
    normalMap: null,
    roughnessMap: null,
    metalnessMap: null,
  };
  cache.set(key, set);
  return set;
}

/**
 * The contract with every consumer of these maps. Props.js and Bodies.js pick
 * their tints as linear multipliers on these numbers, so they are calibrated,
 * not observed — see `calibrate` in bake().
 */
export const MEAN_ALBEDO = {
  sand:      [0.578, 0.399, 0.190],   // dry quartz desert sand, ~0.40 luminance
  rock:      [0.110, 0.080, 0.059],   // dark weathered basalt; props scale it up for sandstone
  metal:     [0.318, 0.353, 0.416],   // cool durasteel; steel F0 with the game's blue cast
  cloth:     [0.935, 0.935, 0.935],   // near-white carrier — the robe colour is the tint
  armor:     [0.668, 0.653, 0.623],   // aged off-white plastoid
  duracrete: [0.332, 0.318, 0.290],   // portland concrete, 0.30-0.35 is the measured band
  skin:      [0.780, 0.700, 0.660],   // detail carrier; the flesh tone is the tint

  /* ── the two terrain-only carriers ────────────────────────────────────
   * These are NOT measured albedos and nothing tints against them, which is
   * why they are neutral and why they are both exactly 0.389.
   *
   * A terrain base map is a GAIN, not a colour. Terrain.js composes the
   * ground as `col = uBaseCol … ; col *= 0.55 + baseLum * 1.15`, so the map's
   * mean decides whether the level's authored ground colour arrives intact:
   * 0.55 + 0.389 × 1.15 = 0.997. Sand lands there by coincidence of being a
   * real albedo ((0.578 + 0.399 + 0.190)/3 = 0.389); soil and snow land there
   * on purpose, because a "physically honest" 0.10 soil would have delivered
   * every meadow at 0.67× its authored green and a 0.75 snow at 1.41× its
   * authored white with no knob anywhere saying why.
   *
   * The same constant is written into the shader a second time — `baseLum`
   * lerps toward 0.389 where the ground is barely rippled — so a base map at
   * any other mean also makes the smooth ground and the textured ground two
   * different brightnesses. tools/checks/terrain.mjs pins all of it.
   *
   * And hue is thrown away outright downstream: the shader takes
   * dot(baseC, 1/3). Both maps are authored with real hue in them — blue pits
   * in the snow, humus in the soil crumb — but pinning the MEAN neutral is a
   * per-channel scale, and once the three channels are pulled onto the same
   * mean what survives is only the part of each texel that disagrees with the
   * average ratio. Measured after calibration: 0.019 mean saturation on soil
   * and 0.038 on snow, against sand's 0.683. They are luminance carriers in
   * practice, and that is stated here rather than implied, because the authored
   * constants below read like colours and are not behaving as any. */
  soil:      [0.389, 0.389, 0.389],   // damp crumb under a grass field
  snow:      [0.389, 0.389, 0.389],   // wind-packed snow with sastrugi
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Surfaces                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Sand. The terrain shader uses this map's *luminance* as a multiplier on the
 * level's own sand colour and its normal for the ripples, so what matters here
 * is the shape and the spread, not the hue — but props never touch it and the
 * hue is measured anyway.
 *
 * Aeolian ripples are asymmetric (long stoss, short lee) and come in two sets
 * crossing at a shallow angle wherever the wind has shifted; their beat is the
 * "fingerprint" pattern you actually see on a dune. Coarse grains armour the
 * crests — that is a real sorting effect, and it is why ripple crests are pale
 * and the troughs, which hold iron-stained fines, are dark. Both directions are
 * integer lattice vectors so the whole field wraps.
 */
export function sandMaps(repeat = 26) {
  const QUARTZ = [0.700, 0.605, 0.430];   // pale, weakly coloured grains
  const FINES  = [0.430, 0.250, 0.098];   // iron-oxide coated silt in the troughs
  const HEAVY  = [0.055, 0.050, 0.046];   // magnetite / ilmenite, the dark specks
  return materialFrom('sand', 512, (u, v) => {
    // One dominant train with a weaker, longer secondary. Two sets of similar
    // wavelength crossing at 35° interfere into a diamond lattice, and once the
    // terrain shader stacks three rotated taps of this map on top of each other
    // the dune sea reads as a woven mat. Real ripples have a clear grain.
    const warp = pfbm(u, v, 8, 4, 0.5, 11) * 0.45;
    const rippA = ridgeWave(u, v, 26, 5, warp, 0.72);
    const rippB = ridgeWave(u, v, 15, -6, warp * 1.5 + 0.31, 0.66);
    const ripple = rippA * 0.76 + rippB * 0.24;
    // patch scale — where the surface is rippled at all vs. smoothed over
    const patch = pfbm(u, v, 11, 3, 0.5, 61) * 0.5 + 0.5;
    const rip = lerp(ripple, ripple * 0.45 + 0.28, sstep(0.62, 0.18, patch));

    const grain = (pnoise(u * 96, v * 96, 96, 96, 5) * 0.62
                 + pnoise(u * 176, v * 176, 176, 176, 71) * 0.38) * 0.5 + 0.5;
    // coarse granules, sorted onto the crests
    const gw = pworley(u, v, 54, 3);
    const granule = sstep(0.30, 0.05, gw[0]) * sstep(0.34, 0.80, rip);
    // heavy-mineral specks: sparse, dark, and they sit in the troughs
    // sized so a speck is one to three texels across; at 88 cells they were a
    // quarter of a texel, which is not a grain of magnetite, it is shimmer
    const hw = pworley(u, v, 64, 29);
    const speck = sstep(0.16, 0.06, hw[0]) * sstep(0.72, 0.22, rip);

    const h = rip * 0.62 + granule * 0.26 + grain * 0.11 + (patch - 0.5) * 0.05;
    // pale on the crests and on the coarse grains, dark in the fines
    const t = clamp(rip * 0.68 + granule * 0.55 + (grain - 0.5) * 0.7 + 0.06, 0, 1);
    const r = lerp(FINES[0], QUARTZ[0], t), g = lerp(FINES[1], QUARTZ[1], t), b = lerp(FINES[2], QUARTZ[2], t);
    return {
      h: h * 0.075,
      r: lerp(r, HEAVY[0], speck), g: lerp(g, HEAVY[1], speck), b: lerp(b, HEAVY[2], speck),
      // fines pack down smoother than the loose coarse crest material
      rough: clamp(0.86 + granule * 0.14 - (1 - rip) * 0.13 + (grain - 0.5) * 0.13 - speck * 0.10, 0, 1),
      metal: 0,
    };
  }, {
    repeat, normalStrength: 8.0, ao: 0.55, aoFloor: 0.62, calibrate: MEAN_ALBEDO.sand,
  });
}

/**
 * Rock. 1024² because this is the coarsest-tiled map in the game — the terrain
 * projects it at roughly one tile per 9 m, so at 512 a texel was 17 mm and the
 * map measured 0.004 rms of texel-scale detail, i.e. none. It was soft blobs.
 *
 * Structure is a two-scale fracture network (F2−F1 cellular, which puts the
 * ridge on the cell *border* where a joint actually is), bedding planes with
 * per-bed thickness and tone, spalled faces and real grain.
 */
export function rockMaps(repeat = 8) {
  const FRESH = [0.104, 0.097, 0.092];   // clean fracture face, near neutral
  const IRON  = [0.185, 0.108, 0.056];   // oxide staining out of the joints
  const CRUST = [0.215, 0.208, 0.183];   // caliche / lichen on the weathered faces
  return materialFrom('rock', 1024, (u, v) => {
    const warp = pfbm(u, v, 6, 2, 0.5, 17) * 0.09;
    const uu = u + warp, vv = v - warp * 0.8;

    /* Rock breaks into pieces. A ridged multifractal on its own gives sinuous
     * ropes — a first pass at this read as tree bark — because nothing in it is
     * ever discontinuous. The structure has to come from the cellular id: each
     * block sits at its own height and its own tone, the joints between them
     * are recessed, and the fractal only supplies relief *within* a block. */
    const j1 = pworley(uu, vv, 11, 5);
    const joint1 = sstep(0.13, 0.0, j1[1] - j1[0]);
    const b1 = j1[2];
    const j2 = pworley(uu, vv, 27, 41);
    const joint2 = sstep(0.085, 0.0, j2[1] - j2[0]) * 0.7;
    const b2 = j2[2];
    const joints = clamp(joint1 + joint2 * (1 - joint1), 0, 1);
    // the smaller blocks only step where the big block is already broken
    const block = (b1 - 0.5) + (b2 - 0.5) * (0.35 + b1 * 0.5);

    // Bedding: a shallow dip, with thickness and tone varying along the bed.
    // The variation has to come from a periodic field, not from hash(bandIndex)
    // — a band index built from a mixed lattice direction gains 4 in u and 26
    // in v across the tile, so no per-index hash can meet itself at the seam.
    const bp = uu * 4 + vv * 26;
    const bf = bp - Math.floor(bp);
    const bh = pnoise(u * 4, v * 8, 4, 8, 7) * 0.5 + 0.5;
    const seam = sstep(0.10 + bh * 0.06, 0.0, Math.min(bf, 1 - bf));

    const massif = pridged(uu, vv, 13, 4, 5);
    const spall = sstep(0.40, 0.12, j2[0]) * sstep(0.35, 0.68, massif);
    const grit = (pnoise(u * 190, v * 190, 190, 190, 13) * 0.6
                + pnoise(u * 96, v * 96, 96, 96, 91) * 0.4) * 0.5 + 0.5;
    const micro = pfbm(u, v, 46, 3, 0.55, 131) * 0.5 + 0.5;

    const h = block * 0.46 + massif * 0.16 + micro * 0.16 + grit * 0.10 + bh * 0.05
            - joints * 0.55 - seam * 0.14 - spall * 0.18;

    // hue, not just value: iron follows the joints and the bedding seams,
    // crust takes the high weathered faces, fresh rock is what is left.
    const ironW = clamp(joints * 0.60 + seam * 0.45 + micro * 0.30 - 0.18, 0, 1);
    const crustW = clamp((0.55 + b1 * 0.5) * sstep(0.35, 0.85, massif * 0.5 + micro * 0.7) - spall * 0.9, 0, 1);
    let r = lerp(FRESH[0], IRON[0], ironW), g = lerp(FRESH[1], IRON[1], ironW), b = lerp(FRESH[2], IRON[2], ironW);
    r = lerp(r, CRUST[0], crustW); g = lerp(g, CRUST[1], crustW); b = lerp(b, CRUST[2], crustW);
    const shade = 0.78 + block * 0.10 + massif * 0.22 + (grit - 0.5) * 0.44 - spall * 0.20;
    return {
      h: h * 0.10,
      r: r * shade, g: g * shade, b: b * shade,
      // a fresh spall is smoother than a wind-blasted crust
      rough: clamp(0.93 + joints * 0.05 - spall * 0.16 - crustW * 0.04 + (grit - 0.5) * 0.06, 0, 1),
      metal: 0,
    };
  }, {
    repeat, normalStrength: 3.1, ao: 0.85, aoFloor: 0.40, aoRough: 0.05,
    calibrate: MEAN_ALBEDO.rock,
  });
}

/**
 * Soil. The ground a grass field grows out of.
 *
 * This one is defined by what it must NOT do. It is seen almost entirely
 * BETWEEN blades — a few centimetres of it at a time, under and behind ten
 * thousand silhouettes — so anything with a legible pattern in it competes
 * with the grass and wins, because the grass is moving and broken up and the
 * ground is not. Sand can afford ripples; soil cannot afford anything the eye
 * can name. So: no directional structure at all (soil is not blown, and the
 * meadow preset samples it through a square frame, uRipAspect = 1, rather than
 * the stretched one the deserts comb their ripples with — measured, the
 * finished map's gradient coherence is 0.17 against the sand map's 0.79); a
 * tonal spread of 0.227 sd/mean against sand's 0.288; and, the number that
 * actually decides whether a ground layer competes with what stands on it, a
 * mean surface tilt of 6.4° against sand's 12.8°, at a normal gain of 2.6
 * against sand's 8.0.
 *
 * What it does carry is CRUMB. Soil aggregates into peds — millimetre to
 * centimetre lumps with dark damp organic matter in the cracks between them —
 * and that is the one structure that says "soil" rather than "brown noise".
 * F2−F1 cellular puts the crack on the cell border where it belongs, and the
 * cell id gives every crumb its own height and tone, the same trick the rock
 * map uses for blocks.
 */
export function soilMaps(repeat = 14) {
  const CRUMB = [0.430, 0.372, 0.300];   // ordinary damp loam crumb
  const HUMUS = [0.246, 0.206, 0.162];   // wet organic matter down in the cracks
  const FIBRE = [0.548, 0.505, 0.386];   // dead root and litter fragments
  const GRIT  = [0.500, 0.494, 0.480];   // the few small stones in it
  return materialFrom('soil', 512, (u, v) => {
    const warp = pfbm(u, v, 9, 3, 0.5, 23) * 0.05;
    const uu = u + warp, vv = v - warp * 0.9;

    // the crumb structure, at two sizes; the small peds only break where the
    // big ped is already broken, so the field reads as aggregate not as foam
    const p1 = pworley(uu, vv, 17, 11);
    const crack1 = sstep(0.115, 0.0, p1[1] - p1[0]);
    const p2 = pworley(uu, vv, 41, 67);
    const crack2 = sstep(0.070, 0.0, p2[1] - p2[0]) * 0.62;
    const cracks = clamp(crack1 + crack2 * (1 - crack1), 0, 1);
    const ped = (p1[2] - 0.5) + (p2[2] - 0.5) * (0.30 + p1[2] * 0.5);

    // litter: dead roots and stems, tangled rather than combed
    const fibre = sstep(0.52, 0.86, pridged(uu, vv, 23, 3, 89));
    // a few small stones
    const grit = sstep(0.125, 0.045, pworley(uu, vv, 56, 131)[0]);
    // the grain that stops it being clay
    const grain = (pnoise(u * 152, v * 152, 152, 152, 41) * 0.60
                 + pnoise(u * 84, v * 84, 84, 84, 7) * 0.40) * 0.5 + 0.5;
    // where the ground holds water. 15 cycles, well clear of the ~8 below which
    // a soft blob stops being variation and becomes the tile itself.
    const damp = sstep(0.42, 0.74, pfbm(uu, vv, 15, 3, 0.5, 173) * 0.5 + 0.5);

    const h = ped * 0.26 + (grain - 0.5) * 0.34 + grit * 0.30 + fibre * 0.14
            - cracks * 0.62 - damp * 0.10;

    // Damp soil is darker AND less saturated than dry soil, which is the whole
    // reason a wet patch reads as wet: water fills the pores and the surface
    // stops scattering off every grain boundary.
    const wetW = clamp(damp * 0.60 + cracks * 0.48, 0, 1);
    let r = lerp(CRUMB[0], HUMUS[0], wetW);
    let g = lerp(CRUMB[1], HUMUS[1], wetW);
    let b = lerp(CRUMB[2], HUMUS[2], wetW);
    r = lerp(r, FIBRE[0], fibre * 0.55); g = lerp(g, FIBRE[1], fibre * 0.55); b = lerp(b, FIBRE[2], fibre * 0.55);
    r = lerp(r, GRIT[0], grit * 0.62); g = lerp(g, GRIT[1], grit * 0.62); b = lerp(b, GRIT[2], grit * 0.62);
    const shade = 0.93 + ped * 0.11 + (grain - 0.5) * 0.18;
    return {
      h: h * 0.060,
      r: r * shade, g: g * shade, b: b * shade,
      // wet is smoother, litter and stone are smoother than bare crumb
      rough: clamp(0.965 - damp * 0.13 - grit * 0.10 - fibre * 0.06 + (grain - 0.5) * 0.06, 0, 1),
      metal: 0,
    };
  }, {
    // 2.6, not sand's 8.0: this map's job is to sit still behind the blades.
    repeat, normalStrength: 2.6, ao: 0.46, aoFloor: 0.64, aoRough: 0.04,
    calibrate: MEAN_ALBEDO.soil,
  });
}

/**
 * Snow.
 *
 * Wind-packed, not fresh — fresh powder has no surface at all and reads as a
 * white card, which is exactly the failure a snow level falls into. What gives
 * a snowfield form is SASTRUGI: the wind carves it into drifts with a long
 * smooth stoss face and a sharp lee edge, the same asymmetry as an aeolian sand
 * ripple at twice the wavelength — 11 and 17 cycles a tile against the sand
 * map's 26 and 15, which at the alpine preset's own tiling is 30 cm sastrugi
 * against the desert's 13 cm ripples. Those are the only large features here,
 * and the preset's own `ripple` gain and wind axis point them the same way the
 * deserts point their ripples, so the drift lies along the storm.
 *
 * Two things then keep it from being white:
 *
 *  · THE PITS ARE BLUE. Light that goes into snow and comes back out has been
 *    through several centimetres of ice, and ice absorbs red. A crown is white
 *    and the hollow beside it is not, and that pair is the only colour a
 *    snowfield has. Authored here rather than left to the lighting, because the
 *    hemisphere light is one colour and cannot know where a pit is.
 *  · SPARKLE IS SPECULAR, NOT ALBEDO. An ice facet catching the sun is a
 *    mirror, and a mirror cannot be drawn by making the albedo brighter — the
 *    map is calibrated, so anything pushed up here comes back out of the rest
 *    of the field, and above 1.0 it simply clips. The facets live in the
 *    ROUGHNESS map instead — measured, the field means 0.894 and the specks
 *    reach 0.13 — where they cost nothing and behave like facets: they flare
 *    when the sun lines up with them and vanish when it does not.
 *
 * Measured on the finished map: 0.162 sd/mean tonal spread (snow is genuinely
 * low contrast and this does not pretend otherwise), and a gradient coherence
 * of 0.65 at the feature scale against soil's 0.17 — the sastrugi are a real
 * directional train, which is the thing the preset's ripple frame is aimed at.
 */
export function snowMaps(repeat = 18) {
  const CROWN = [0.470, 0.478, 0.492];   // sunlit crystal, faintly cool
  const PIT   = [0.268, 0.312, 0.398];   // light that went into the pack and came back
  const GRIME = [0.330, 0.312, 0.284];   // wind-blown grit on an old surface
  return materialFrom('snow', 512, (u, v) => {
    const warp = pfbm(u, v, 8, 4, 0.5, 31) * 0.20;
    /* Sastrugi: long stoss, sharp lee. Both directions are integer lattice
     * vectors so the whole field wraps, and they sit 2° apart rather than at
     * unrelated bearings — one wind carved this, and two trains at 20° would
     * cross into the same diamond lattice that once turned the dune sea into
     * woven matting. What the pair buys at 2° is a beat ALONG the crest, so a
     * drift fades out and another picks up, which is what sastrugi do. */
    const driftA = ridgeWave(u, v, 11, 3, warp, 0.80);
    const driftB = ridgeWave(u, v, 17, 4, warp * 1.35 + 0.27, 0.72);
    const drift = driftA * 0.66 + driftB * 0.34;
    // Where the surface is drifted at all. A snowfield alternates between
    // carved ground and smooth infill; without this the sastrugi run edge to
    // edge at one amplitude and the tile is a corrugation.
    const patch = pfbm(u, v, 13, 3, 0.5, 59) * 0.5 + 0.5;
    const dr = lerp(drift, drift * 0.45 + 0.31, sstep(0.52, 0.14, patch));

    // wind slab cracks into plates on the exposed crests
    const pl = pworley(u, v, 15, 77);
    const plate = sstep(0.075, 0.0, pl[1] - pl[0]) * sstep(0.38, 0.74, dr);
    // packed granular snow: rounded grains, not the dendrites of fresh fall
    const grain = (pnoise(u * 164, v * 164, 164, 164, 3) * 0.62
                 + pnoise(u * 92, v * 92, 92, 92, 53) * 0.38) * 0.5 + 0.5;
    // individual crystal facets — one to two texels, sparse
    const spark = sstep(0.070, 0.020, pworley(u, v, 92, 19)[0]);
    // old surfaces collect blown grit; sparse, and it stays in the troughs
    const dirt = sstep(0.60, 0.88, pfbm(u, v, 14, 3, 0.5, 211) * 0.5 + 0.5)
               * sstep(0.62, 0.24, dr) * 0.5;

    const h = dr * 0.62 + (pl[2] - 0.5) * 0.10 + (grain - 0.5) * 0.16
            - plate * 0.30 + spark * 0.06;

    // the pit blue rides the cavity, not a separate noise: it IS the depth
    const pitW = clamp((1 - dr) * 0.72 + plate * 0.30 - 0.06, 0, 1);
    let r = lerp(CROWN[0], PIT[0], pitW);
    let g = lerp(CROWN[1], PIT[1], pitW);
    let b = lerp(CROWN[2], PIT[2], pitW);
    r = lerp(r, GRIME[0], dirt); g = lerp(g, GRIME[1], dirt); b = lerp(b, GRIME[2], dirt);
    const shade = 0.94 + (grain - 0.5) * 0.16 + spark * 0.14;
    return {
      h: h * 0.085,
      r: r * shade, g: g * shade, b: b * shade,
      // a facet is a mirror; the field around it is not
      rough: clamp(0.90 - spark * 0.70 - plate * 0.06 + (grain - 0.5) * 0.10 + dirt * 0.06, 0, 1),
      metal: 0,
    };
  }, {
    repeat, normalStrength: 5.2, ao: 0.50, aoFloor: 0.66, calibrate: MEAN_ALBEDO.snow,
  });
}

/**
 * Scratches, rasterised. The old version tested all 160 scratches at every one
 * of 262 144 texels — 42 M segment tests, 1.6 s of the boot — and the segments
 * did not wrap, so every scratch was cut off at the tile edge. Walking the line
 * into a buffer instead is ~0.4 M writes and wraps for free.
 */
function scratchBuffer(size, count, seed) {
  const buf = new Float32Array(size * size);
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const len = (rng() * rng() * 0.38 + 0.02) * size;
    const dx = Math.cos(a), dy = Math.sin(a);
    let px = rng() * size, py = rng() * size;
    const wide = rng() * 1.5 + 0.5;
    const amp = rng() * 0.65 + 0.35;
    const steps = Math.max(2, Math.ceil(len));
    const ri = Math.ceil(wide);
    for (let s = 0; s <= steps; s++) {
      const taper = amp * Math.sin((s / steps) * Math.PI) ** 0.45;
      const cx = px + dx * s, cy = py + dy * s;
      const ix = Math.round(cx), iy = Math.round(cy);
      for (let oy = -ri; oy <= ri; oy++) {
        for (let ox = -ri; ox <= ri; ox++) {
          const qx = ix + ox, qy = iy + oy;
          const d = Math.hypot(qx - cx, qy - cy);
          const val = taper * clamp(1 - d / wide, 0, 1);
          const k = wrapi(qy, size) * size + wrapi(qx, size);
          if (val > buf[k]) buf[k] = val;
        }
      }
    }
  }
  return buf;
}

// Built on first use and shared by every tiling; disposeTextureCache drops it.
let _scratches = null;
const scratches = () => (_scratches ||= scratchBuffer(512, 240, 77));

/**
 * Durasteel. Panelled, brushed, riveted and scratched.
 *
 * The thing that stops big machined surfaces reading as one plastic sheet is
 * per-panel variation: adjacent plates were cast in different batches, wear
 * differently, and get painted at different times. Each panel here draws its
 * own tone, roughness and brush angle from a hash of its index, so the seams
 * read as construction rather than as a texture repeat.
 */
export function metalMaps(repeat = 4) {
  const SIZE = 512, PANELS = 4, RIVETS = 5;
  const STEEL = [0.335, 0.372, 0.438];
  const OXIDE = [0.250, 0.196, 0.150];
  return materialFrom('metal', SIZE, (u, v, px, py) => {
    // panel seams — a bevelled channel, not a drawn line
    const gu = u * PANELS, gv = v * PANELS;
    const pu = Math.floor(gu), pv = Math.floor(gv);
    const du = Math.min(gu - pu, 1 - (gu - pu)), dv = Math.min(gv - pv, 1 - (gv - pv));
    const dSeam = Math.min(du, dv);
    const seam = sstep(0.035, 0.0, dSeam);
    const bevel = sstep(0.075, 0.02, dSeam) - seam;

    // per-panel identity — indices wrapped, or the panels at u=0 and u=1 are
    // different plates and the tile shows a step down its edge
    const wu = wrapi(pu, PANELS), wv = wrapi(pv, PANELS);
    const pa = hash2(wu, wv, 3), pb = hash2(wu, wv, 131), pc = hash2(wu, wv, 197);

    // Everything that is per-panel has to die inside the seam channel, or two
    // plates meet in a one-texel step of tone, roughness and brush angle right
    // down the middle of the groove — which under a moving specular reads as a
    // crawling line. `plate` is 1 out on the plate and 0 in the seam, so the
    // change happens where the surface is already in shadow.
    const plate = 1 - seam;

    // brushed grain, its direction set per panel
    const along = pb < 0.5
      ? pstretch(u, v, 112, 7, 23)
      : pstretch(u, v, 7, 112, 23);
    const fine = pstretch(u, v, pb < 0.5 ? 224 : 11, pb < 0.5 ? 13 : 224, 59);
    const brushed = ((along * 0.66 + fine * 0.34) * 0.5 + 0.5 - 0.5) * plate + 0.5;

    // rivets down every seam
    const rr = (a) => { const t = a * RIVETS; return Math.abs(t - Math.floor(t) - 0.5) / RIVETS; };
    const rivU = Math.hypot(du / PANELS, rr(gv));
    const rivV = Math.hypot(dv / PANELS, rr(gu));
    const rivet = sstep(0.0075, 0.0035, Math.min(rivU, rivV));

    const blotch = pfbm(u, v, 13, 4, 0.5, 151) * 0.5 + 0.5;
    const oxide = clamp(sstep(0.56, 0.86, blotch) * (0.5 + pc * 0.9), 0, 1);
    const s = scratches()[py * SIZE + px];

    const h = -seam * 0.62 - bevel * 0.18 + rivet * 0.55 + brushed * 0.26 + s * 0.16
            + (pa - 0.5) * 0.05 * plate - oxide * 0.05;
    // a scratch cuts through the oxide to bright metal; the seam is in shadow
    const shade = (0.80 + (pa - 0.5) * 0.05 * plate) * (1 + (brushed - 0.5) * 0.20)
                + s * 0.42 + rivet * 0.10 - seam * 0.22;
    return {
      h: h * 0.055,
      r: lerp(STEEL[0], OXIDE[0], oxide) * shade,
      g: lerp(STEEL[1], OXIDE[1], oxide) * shade,
      b: lerp(STEEL[2], OXIDE[2], oxide) * shade,
      // polished where it is rubbed and scratched, matte where it has oxidised
      rough: clamp(0.45 + (pa - 0.5) * 0.30 * plate + oxide * 0.42 + seam * 0.22 - s * 0.20 + (brushed - 0.5) * 0.12, 0.06, 1),
      metal: clamp(0.97 - oxide * 0.42 - seam * 0.22, 0, 1),
    };
  }, {
    repeat, normalStrength: 4.4, ao: 0.7, aoFloor: 0.5, aoRough: 0.10,
    grime: [0.055, 0.048, 0.042], grimeAmount: 0.5,
    calibrate: MEAN_ALBEDO.metal,
  });
}

/**
 * Cloth. A real plain weave: warp and weft alternate over and under on a
 * checkerboard, each thread carries its own width and tone (slubs), and the
 * interstices between them are occluded holes rather than a darker shade.
 *
 * The old version was sin(u) × sin(v) — a perfectly regular grid with a mean
 * surface tilt of 1.1°, which is to say the normal map did nothing at all and
 * the robes were flat sheets of colour.
 *
 * Two constraints fight here. The thread count has to divide the texture size
 * exactly (512/64 = 8 texels a thread) or the wrap lands mid-thread and every
 * tile edge is a thread boundary at maximum contrast. And the albedo has to
 * stay near white with a mean of 0.935, because it is a *carrier* — the robe
 * colour multiplies it — which leaves almost no room to darken: a first pass at
 * this drove the crowns of 70% of the texels into a hard white clip. So the
 * weave lives in the normal, the roughness and a light touch of occlusion, and
 * the albedo only whispers.
 */
export function clothMaps(repeat = 3) {
  const TH = 64;   // threads across the tile — must divide 512
  return materialFrom('cloth', 512, (u, v) => {
    const fu = u * TH, fv = v * TH;
    const iu = Math.floor(fu), iv = Math.floor(fv);
    let su = fu - iu, sv = fv - iv;
    // Each thread sits slightly off its slot, so the grid is a weave and not a
    // screen. Left unclamped on purpose — the cross-section below clamps its
    // own argument, so a thread can lean into its neighbour's gap.
    su += (hash2(wrapi(iu, TH), 43, 71) - 0.5) * 0.24;
    sv += (hash2(wrapi(iv, TH), 17, 71) - 0.5) * 0.24;
    // per-thread character: width, height and tone all vary, which is the
    // difference between homespun and nylon mesh
    const ju = wrapi(iu, TH), jv = wrapi(iv, TH);
    const wu = 0.76 + hash2(ju, 11, 5) * 0.30;
    const wv = 0.76 + hash2(jv, 29, 5) * 0.30;
    const tu = 0.965 + hash2(ju, 61, 17) * 0.07;
    const tv = 0.965 + hash2(jv, 97, 17) * 0.07;
    // cross-section of each thread; clamped so the gap between them is real
    const cu = Math.cos(clamp((su - 0.5) / wu, -0.5, 0.5) * Math.PI);
    const cv = Math.cos(clamp((sv - 0.5) / wv, -0.5, 0.5) * Math.PI);
    const overWarp = ((iu + iv) & 1) === 0;
    const top = overWarp ? cu : cv;
    const under = overWarp ? cv : cu;
    const weave = top * 0.85 + under * 0.28;
    // the hole where neither thread is
    const gap = clamp(1 - (cu + cv) * 1.2, 0, 1);
    // fibres standing off the cloth; they scatter light, so they brighten
    const fuzz = pfbm(u, v, 160, 2, 0.45, 37) * 0.5 + 0.5;
    const nap = pstretch(u, v, 32, 192, 83) * 0.5 + 0.5;

    const h = weave * 0.78 + (fuzz - 0.5) * 0.12 - gap * 0.70;
    const shade = (overWarp ? tu : tv) * (0.985 + top * 0.02 + (fuzz - 0.5) * 0.05 + (nap - 0.5) * 0.03)
                * (1 - gap * 0.20);
    return {
      h: h * 0.06,
      r: shade, g: shade, b: shade,
      // the crown of a thread is where cloth gets its sheen
      rough: clamp(0.94 - top * 0.13 + gap * 0.05 + (fuzz - 0.5) * 0.08, 0, 1),
      metal: 0,
    };
  }, {
    repeat, normalStrength: 3.0, ao: 0.30, aoFloor: 0.80, calibrate: MEAN_ALBEDO.cloth,
  });
}

/**
 * Plastoid armour, and by extension every strap, boot and scorch mark on a
 * trooper — Bodies.js re-tiles this map from 1.6 to 6.0, so it deliberately
 * spreads its energy across frequencies rather than owning one feature size.
 *
 * Moulded plastic has orange peel; used plastic has chips that show the darker
 * substrate, fine crazing, and directional scuffing. What it does not have is
 * the six-cycle grey blotch this map used to carry, which at any tiling read as
 * damp patches — the same mistake that once put condensation on the robes.
 */
export function armorMaps(repeat = 2) {
  // Plastoid does not weather by going grey; it yellows. UV-aged panels go
  // cream, the substrate under a chip is a cool dark grey, and the dust it
  // picks up is warm — three different hues, which is what stops a trooper
  // reading as a single moulded lump of off-white.
  const SHELL = [0.730, 0.722, 0.708];   // clean plastoid, faintly cool
  const AGED  = [0.755, 0.688, 0.545];   // sun-yellowed
  const CORE  = [0.240, 0.238, 0.232];   // the cool substrate a chip exposes
  return materialFrom('armor', 512, (u, v) => {
    // Injection-moulded orange peel. The cellular lattice has to be warped or
    // the dimples line up in rows and the plate reads as pegboard — which is
    // exactly what a first pass at this looked like.
    const w = pfbm(u, v, 9, 3, 0.5, 211) * 0.10;
    const peel = pworley(u + w, v - w * 0.8, 58, 9)[0];
    const orange = (1 - sstep(0.0, 0.62, peel)) * 0.5;
    const grain = pfbm(u, v, 128, 2, 0.5, 43) * 0.5 + 0.5;
    // crazing: fine stress cracks, low amplitude, everywhere
    const craze = pridged(u, v, 44, 3, 67);

    // scuffing runs in a direction
    const scuffA = pstretch(u, v, 96, 15, 71) * 0.5 + 0.5;
    const scuffB = pstretch(u, v, 15, 96, 113) * 0.5 + 0.5;
    const scuff = Math.max(scuffA, scuffB);
    const patch = pfbm(u, v, 19, 3, 0.5, 149) * 0.5 + 0.5;
    const wear = clamp((scuff - 0.52) * 1.6 * (0.4 + patch), 0, 1);

    /* Chips. One threshold on one cellular field puts exactly one chip in every
     * cell, evenly spaced — a peg board, not battle damage. Two things break
     * that up: chips only appear where the plate is already worn (they cluster
     * along the same edges the scuffing follows), and the radius is driven by
     * its own field so they come in a range of sizes instead of one. */
    const cw = pworley(u + w * 0.5, v, 21, 101);
    const chipWear = sstep(0.52, 0.92, wear * 0.6 + patch * 0.8);
    const rad = 0.09 + (pfbm(u, v, 26, 2, 0.5, 307) * 0.5 + 0.5) * 0.20;
    const chip = sstep(rad, rad * 0.28, cw[0]) * chipWear;
    const deepChip = sstep(rad * 0.5, rad * 0.15, cw[0]) * chipWear;

    const h = orange * 0.34 + (grain - 0.5) * 0.16 + craze * 0.07 - chip * 0.62 - deepChip * 0.35;
    const shade = 0.96 + (grain - 0.5) * 0.07 + orange * 0.04 + wear * 0.08 - craze * 0.035;
    const t = clamp(chip * 0.85 + deepChip * 0.4, 0, 1);
    const age = clamp(patch * 1.5 - 0.35, 0, 1);
    return {
      h: h * 0.045,
      r: lerp(lerp(SHELL[0], AGED[0], age), CORE[0], t) * shade,
      g: lerp(lerp(SHELL[1], AGED[1], age), CORE[1], t) * shade,
      b: lerp(lerp(SHELL[2], AGED[2], age), CORE[2], t) * shade,
      // clean plate is nearly glossy, scuffs and chips kill it stone dead
      rough: clamp(0.30 + wear * 0.34 + chip * 0.42 + craze * 0.16 + (grain - 0.5) * 0.10, 0.06, 1),
      metal: clamp(0.04 + deepChip * 0.22, 0, 1),
    };
  }, {
    // Plastoid is moulded plastic, not a cavity-rich surface. A first pass ran
    // the occlusion at 0.8 with a floor of 0.5, which turned the low-amplitude
    // crazing into a network of dark worms and made every plate read as
    // speckled terrazzo. It belongs in the chips and the deep scuffs only.
    repeat, normalStrength: 6.4, ao: 0.38, aoFloor: 0.62, aoRough: 0.14,
    grime: [0.148, 0.118, 0.082], grimeAmount: 0.30,
    calibrate: MEAN_ALBEDO.armor,
  });
}

/**
 * Duracrete.
 *
 * Concrete is mostly cement paste. That is the whole trick, and the reason a
 * first pass at this read as crazy paving: covering the surface in aggregate at
 * three sizes and then letting the cavity occlusion outline every stone gives
 * you terrazzo with black grout, not a cast wall. So the paste is the surface,
 * aggregate only shows through where the skin has worn or spalled off, and the
 * one thing that unmistakably says "this was poured" — entrained air voids,
 * sparse round pits with a dark floor — is the loudest feature.
 *
 * It also used to have a mean surface tilt of 0.0°: 99.8% of its normal map was
 * dead flat, so every wall in the hangar and every plinth in the dojo was a
 * painted card.
 */
export function duracreteMaps(repeat = 6) {
  const PASTE  = [0.330, 0.326, 0.318];   // portland cement, near neutral
  const AGG    = [0.400, 0.352, 0.278];   // warm sandy aggregate
  const DAMP   = [0.130, 0.130, 0.138];   // the cold shadow inside a void
  return materialFrom('duracrete', 512, (u, v) => {
    const warp = pfbm(u, v, 9, 3, 0.5, 19) * 0.045;
    const uu = u + warp, vv = v - warp;

    // Where the laitance has worn through. Everything below is gated on this,
    // so most of the wall stays smooth paste and the aggregate reads as damage.
    const expose = sstep(0.46, 0.80, pfbm(uu, vv, 11, 3, 0.5, 233) * 0.5 + 0.5);
    const a1 = pworley(uu, vv, 13, 7)[0];     // coarse stones
    const a2 = pworley(uu, vv, 31, 53)[0];    // medium
    const a3 = pworley(uu, vv, 44, 97)[0];    // sand fraction
    const stone = sstep(0.26, 0.09, a1) * expose;
    const med = sstep(0.22, 0.07, a2) * (0.25 + expose * 0.75) * 0.6;
    const fine = sstep(0.26, 0.10, a3) * 0.30;
    const aggregate = clamp(stone + med * (1 - stone) + fine * (1 - stone), 0, 1);

    // entrained air voids: sparse round pits, the signature of cast concrete
    const voidP = sstep(0.165, 0.060, pworley(uu, vv, 27, 181)[0]);
    const pin = sstep(0.135, 0.055, pworley(uu, vv, 39, 211)[0]) * 0.35;

    // paste grain, and the straight faint ridges the shuttering left
    const paste = (pnoise(u * 124, v * 124, 124, 124, 29) * 0.6
                 + pnoise(u * 62, v * 62, 62, 62, 103) * 0.4) * 0.5 + 0.5;
    const board = sstep(0.055, 0.0, Math.abs((v * 9) % 1 - 0.5) - 0.44) * 0.5;

    const h = aggregate * 0.30 + (paste - 0.5) * 0.22 + board * 0.10
            - expose * 0.16 - voidP * 0.95 - pin * 0.50;
    const shade = 0.90 + aggregate * 0.18 + (paste - 0.5) * 0.26 - expose * 0.08;
    const t = clamp(aggregate * 0.85, 0, 1);
    let r = lerp(PASTE[0], AGG[0], t) * shade;
    let g = lerp(PASTE[1], AGG[1], t) * shade;
    let b = lerp(PASTE[2], AGG[2], t) * shade;
    const d = clamp(voidP + pin * 0.7, 0, 1);
    return {
      h: h * 0.055,
      r: lerp(r, DAMP[0], d), g: lerp(g, DAMP[1], d), b: lerp(b, DAMP[2], d),
      // polished aggregate against matte paste is what makes concrete glitter
      rough: clamp(0.94 - stone * 0.22 - med * 0.10 + voidP * 0.05 + (paste - 0.5) * 0.12, 0, 1),
      metal: 0,
    };
  }, {
    repeat, normalStrength: 4.4, ao: 0.55, aoFloor: 0.52, aoRough: 0.06,
    grime: [0.105, 0.103, 0.100], grimeAmount: 0.45,
    calibrate: MEAN_ALBEDO.duracrete,
  });
}

/**
 * Skin. A near-white detail carrier — pores, fine creases and the mottling of
 * blood under the surface — meant to be multiplied by a flesh tone the way
 * clothMaps is multiplied by a robe colour. Untextured skin is the one thing
 * on a character that unavoidably reads as vinyl.
 */
export function skinMaps(repeat = 4) {
  return materialFrom('skin', 512, (u, v) => {
    const pore = pworley(u, v, 64, 13)[0];
    const pores = sstep(0.30, 0.10, pore);
    const crease = pridged(u, v, 26, 4, 47);
    const fine = pridged(u, v, 60, 2, 149) * 0.6;
    // subsurface mottling: redder where the capillaries are close
    const mottle = pfbm(u, v, 22, 3, 0.5, 199) * 0.5 + 0.5;
    const grain = pfbm(u, v, 76, 2, 0.5, 251) * 0.5 + 0.5;

    const h = -pores * 0.55 - crease * 0.30 - fine * 0.16 + (grain - 0.5) * 0.14;
    const shade = 0.95 + (grain - 0.5) * 0.09 - crease * 0.06;
    return {
      h: h * 0.05,
      r: shade * (1.0 + (mottle - 0.5) * 0.10),
      g: shade * (1.0 - (mottle - 0.5) * 0.05),
      b: shade * (1.0 - (mottle - 0.5) * 0.07),
      // oily on the crowns, matte in the pores
      rough: clamp(0.56 + pores * 0.22 + (mottle - 0.5) * 0.14 + (grain - 0.5) * 0.08, 0, 1),
      metal: 0,
    };
  }, {
    repeat, normalStrength: 2.2, ao: 0.5, aoFloor: 0.68, calibrate: MEAN_ALBEDO.skin,
  });
}

/* ── small utility textures ──────────────────────────────────────────── */

export function radialSprite(size = 128, inner = '#ffffff', outer = 'rgba(255,255,255,0)', power = 1) {
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = Math.pow(1 - t, power);
    g.addColorStop(t, i === 0 ? inner : `rgba(255,255,255,${a.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function sparkSprite(size = 64) {
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.5, 'rgba(255,170,60,0.35)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokeSprite(size = 128) {
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const u = x / size, v = y / size;
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const n = fbm2(u * 4, v * 4, 5) * 0.5 + 0.5;
    const a = clamp((1 - d) * 1.35, 0, 1) * clamp(n * 1.5, 0, 1);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.pow(a, 1.6) * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft elongated blade-of-grass alpha, used for the instanced grass cards. */
export function grassSprite(size = 64) {
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 4; i++) {
    const x = size * (0.2 + i * 0.2);
    const g = ctx.createLinearGradient(0, size, 0, 0);
    g.addColorStop(0, 'rgba(60,80,30,1)');
    g.addColorStop(1, 'rgba(150,190,90,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.055, size);
    ctx.quadraticCurveTo(x + size * 0.03, size * 0.45, x + size * 0.02, size * 0.04);
    ctx.quadraticCurveTo(x + size * 0.05, size * 0.45, x + size * 0.055, size);
    ctx.closePath(); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A SWAMP FLOOR, and it is a different KIND of ground cover rather than a
 * browner grass.
 *
 * "I like the drowned wood map but the grass and ground look like absolute
 *  fucking garbage and need to be redone from the ground up… just get rid of it
 *  entirely and redo it."
 *
 * Three attempts had already been made at that as a grass problem — a better
 * shader, a better palette, a better density — and the reference says why none
 * of them could work. `drowned-wood/dagobah.jpeg` HAS NO GRASS IN IT AT ALL.
 * Not sparse grass, not brown grass: none. A swamp floor is standing water,
 * matted leaf litter, fallen branches and the rootlets coming off the buttress
 * of every tree. A field of upright blades is the one surface a bog cannot
 * have, which is exactly why the level read as two games stitched together.
 *
 * So this is the sprite that replaces it, and every mark in it is horizontal or
 * arched rather than vertical:
 *
 *   MATS      broad low fans of sodden litter, three of them, overlapping. They
 *             are what actually closes the ground, and they are the reason this
 *             is drawn dark and warm rather than green — soaked leaf litter is
 *             umber, and green here would be grass again.
 *   ROOTLETS  arches: up out of the mat, over, and back down. A root is the one
 *             plant shape that touches the ground at BOTH ends, and it is the
 *             single clearest tell that what you are looking at is not grass.
 *   TWIGS     bare fallen deadwood lying across it, near-black.
 *
 * The alpha is deliberately much more solid than `grassSprite`'s: litter is a
 * MAT and blades are separate. That also matters to the budget — a card that
 * covers 70% of its own footprint instead of 25% covers the ground with three
 * times fewer instances.
 */
export function litterSprite(size = 64) {
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const S = size;
  // ── the mats: broad, low, overlapping fans of wet leaf litter
  for (let i = 0; i < 3; i++) {
    const x = S * (0.24 + i * 0.26), w = S * (0.30 + i * 0.04);
    const g = ctx.createLinearGradient(0, S, 0, S * 0.42);
    g.addColorStop(0, 'rgba(38,30,18,1)');
    g.addColorStop(1, 'rgba(104,86,44,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, S);
    ctx.quadraticCurveTo(x - w * 0.7, S * 0.52, x, S * (0.44 + i * 0.06));
    ctx.quadraticCurveTo(x + w * 0.7, S * 0.52, x + w, S);
    ctx.closePath(); ctx.fill();
  }
  // ── the rootlets: arches, down at both ends, which is what says "root"
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const x0 = S * (0.06 + i * 0.20), span = S * (0.16 + (i % 2) * 0.08);
    const rise = S * (0.30 + (i % 3) * 0.12);
    ctx.strokeStyle = i % 2 ? 'rgba(74,58,34,1)' : 'rgba(52,44,26,1)';
    ctx.lineWidth = S * (0.030 + (i % 2) * 0.014);
    ctx.beginPath();
    ctx.moveTo(x0, S);
    ctx.quadraticCurveTo(x0 + span * 0.5, S - rise, x0 + span, S);
    ctx.stroke();
  }
  // ── the deadwood, lying across it
  for (let i = 0; i < 3; i++) {
    const y = S * (0.62 + i * 0.13);
    ctx.strokeStyle = 'rgba(26,22,16,1)';
    ctx.lineWidth = S * 0.028;
    ctx.beginPath();
    ctx.moveTo(S * (0.02 + i * 0.22), y);
    ctx.lineTo(S * (0.44 + i * 0.20), y + S * (i % 2 ? 0.05 : -0.04));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Scorch decal — a cauterised black ring with a hot core. */
export function scorchSprite(size = 128) {
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const u = x / size - 0.5, v = y / size - 0.5;
    const n = fbm2(x * 0.06, y * 0.06, 4) * 0.16;
    const d = Math.hypot(u, v) * 2 + n;
    const a = clamp(1 - d, 0, 1);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 8;
    img.data[i + 3] = Math.pow(a, 2.1) * 235;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 3-channel blue-noise-ish texture for dithering / grain in the composite pass. */
export function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const rng = makeRng(9182);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = rng() * 255; data[i * 4 + 1] = rng() * 255;
    data[i * 4 + 2] = rng() * 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * Raw baked bytes for a surface, for measurement. Canvases are opaque under the
 * headless DOM shim — getImageData returns zeros there — so every numeric claim
 * about these maps has to come from the arrays the bake actually wrote, not
 * from a canvas readback that quietly reports black.
 */
export function rawMaps(name) {
  if (!baked.has(name)) {
    const build = { sand: sandMaps, rock: rockMaps, metal: metalMaps, cloth: clothMaps,
                    armor: armorMaps, duracrete: duracreteMaps, skin: skinMaps,
                    soil: soilMaps, snow: snowMaps }[name];
    if (!build) return null;
    build();
  }
  const b = baked.get(name);
  if (!b) return null;
  const px = (c) => c.pixels
    || c.getContext('2d').getImageData(0, 0, b.size, b.size).data;
  return { size: b.size, albedo: px(b.albedo), normal: px(b.normal), rough: px(b.rough) };
}

/**
 * How many canvases the foundry has materialised for maps nothing binds.
 *
 * Zero after a boot warm, because `materialFrom` binds `normalMap: null` and
 * `roughnessMap: null` and never touches either getter — which is the whole
 * point of them being getters. Non-zero only once something has explicitly
 * asked, which in the shipped game is nothing and in the harness is `rawMaps`.
 * Exported so tools/checks/materials.mjs can assert the boot path against it
 * rather than against a comment.
 */
export function unboundCanvases() {
  let n = 0;
  for (const b of baked.values()) n += b.lazyBuilt;
  return n;
}

export function disposeTextureCache() {
  // `t?.` and not `t.` — a set's dead slots are null now that the ORM and
  // normal maps are no longer bound (see materialFrom), and reaching for
  // `.dispose` on null throws before the optional call can save it.
  for (const set of cache.values()) for (const t of Object.values(set)) t?.dispose?.();
  cache.clear();
  baked.clear();
  _scratches = null;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Weathering — noise in METRES, for paint that goes on a body           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHY THIS IS NOT `PERIODIC` ABOVE, AND NOT `MathUtil.noise3` EITHER.
 *
 * Everything above this line tiles: it is sampled in u/v over a texture that
 * has to meet itself after one repeat, and `PERIODIC` is exported so
 * tools/checks/materials.mjs can prove that. A chip in the paint on a shin is
 * the opposite kind of thing. It is sampled at a VERTEX, in bone-local metres,
 * and the two properties it needs are that it is the same number for the same
 * vertex every time a body is built (a man carries the same chips onto every
 * ground, and the parade figure of him has to agree with the body that lands —
 * `tools/checks/worn-paint.mjs` compares the two region for region) and that
 * it is different for the two sides of one body, which are authored from the
 * same coordinates. Neither of those is a tiling question, and `MathUtil`'s
 * noise draws its permutation from a module seed that a check may re-seed.
 *
 * So: an integer hash of the lattice cell, a seed for the side, and value
 * noise over it. `cell` is the size of a chip in metres; `src/game/Command.js`
 * `PAINT.cell` is the number and the reason for it.
 */
function ihash(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
    ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul((seed | 0) + 0x5bd1e995, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Deterministic 0..1 for the lattice cell `p / cell` falls in. */
function hash3(x, y, z, cell = 1, seed = 0) {
  return ihash(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell), seed);
}

const _f5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise over `hash3`'s lattice, 0..1, smooth across cells. */
function vnoise3(x, y, z, cell = 1, seed = 0) {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const u = _f5(fx - x0), v = _f5(fy - y0), w = _f5(fz - z0);
  const c = (dx, dy, dz) => ihash(x0 + dx, y0 + dy, z0 + dz, seed);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/**
 * The wear field a painted edge follows: two octaves of value noise, 0..1,
 * mean 0.5. The second octave is 0.37 of the first's cell so a chip has a
 * ragged bite rather than a rounded one.
 */
function wear(x, y, z, cell = 0.016, seed = 0) {
  return 0.66 * vnoise3(x, y, z, cell, seed) + 0.34 * vnoise3(x + 7.31, y - 3.17, z + 1.93, cell * 0.37, seed + 11);
}

export const WEAR = { hash3, vnoise3, wear };
