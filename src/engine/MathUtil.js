/** BATTLEFRONT BORZ — deterministic noise, random and small math helpers. */

import * as THREE from 'three';

/**
 * Clamp, written so NaN lands on the low bound instead of passing straight
 * through. `v < a ? a : v > b ? b : v` returns NaN for NaN — which then reached
 * WebAudio params, physics positions and shader uniforms, all of which either
 * throw or render black. A clamp is the natural place to stop that.
 */
export const clamp = (v, a, b) => (v >= a ? (v <= b ? v : b) : a);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Exponential smoothing toward a target vector, framerate independent. */
export function dampVec(out, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  out.x += (target.x - out.x) * t;
  out.y += (target.y - out.y) * t;
  out.z += (target.z - out.z) * t;
  return out;
}

/** Mulberry32 — small, fast, seedable. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.sign = () => rng() < 0.5 ? -1 : 1;
  rng.unitVec = (out = new THREE.Vector3()) => {
    const z = rng() * 2 - 1, a2 = rng() * TAU, s = Math.sqrt(1 - z * z);
    return out.set(s * Math.cos(a2), z, s * Math.sin(a2));
  };
  rng.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  /**
   * Put the stream back to a known state.
   *
   * A module-level generator is shared by every object in its file for the
   * life of the process, which is right for the game — one duel should not
   * play out identically to the last one — and is exactly what makes a
   * measurement of a stochastic system depend on what ran before it. A harness
   * that wants the same fight twice needs to be able to say so, and the note
   * over `duel()` in tools/checks/duelling.mjs records what happens without
   * it: the same check reading 8 strikes in one run and 3 in another purely
   * because another suite had drawn from the stream first.
   */
  rng.seed = (n) => { a = (n >>> 0) || 1; return rng; };
  return rng;
}

export const rand = makeRng((Math.random() * 1e9) | 0);

/* ── value / simplex-ish noise ───────────────────────────────────────── */

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = makeRng(1337);
  for (let i = 255; i > 0; i--) { const j = r.int(0, i); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const grad2 = (h, x, y) => {
  switch (h & 7) {
    case 0: return  x + y; case 1: return  x - y; case 2: return -x + y; case 3: return -x - y;
    case 4: return  x;     case 5: return -x;     case 6: return  y;     default: return -y;
  }
};

/** 2D Perlin, range roughly [-1,1]. */
export function noise2(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const A = PERM[X] + Y, B = PERM[X + 1] + Y;
  const n00 = grad2(PERM[A], x, y);
  const n10 = grad2(PERM[B], x - 1, y);
  const n01 = grad2(PERM[A + 1], x, y - 1);
  const n11 = grad2(PERM[B + 1], x - 1, y - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.35;
}

const grad3 = (h, x, y, z) => {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};

export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(
    lerp(lerp(grad3(PERM[AA], x, y, z), grad3(PERM[BA], x - 1, y, z), u),
         lerp(grad3(PERM[AB], x, y - 1, z), grad3(PERM[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad3(PERM[AA + 1], x, y, z - 1), grad3(PERM[BA + 1], x - 1, y, z - 1), u),
         lerp(grad3(PERM[AB + 1], x, y - 1, z - 1), grad3(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}

/** Fractal Brownian motion. */
export function fbm2(x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal — sharp crests, good for dunes and rock. */
export function ridged2(x, y, octaves = 5, lacunarity = 2.07, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, prev = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq));
    n *= n * prev;
    prev = n;
    sum += n * amp; norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Worley / cellular F1 distance in [0,1]. */
export function worley2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 8;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const h = PERM[(PERM[cx & 255] + (cy & 255)) & 255];
    const px = cx + (h & 15) / 15, py = cy + ((h >> 4) & 15) / 15;
    const dx = px - x, dy = py - y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.min(1, Math.sqrt(best));
}

/* ── misc ────────────────────────────────────────────────────────────── */

/** Signed angle from a to b about `axis` (all normalized). */
export function signedAngle(a, b, axis) {
  const dot = clamp(a.dot(b), -1, 1);
  const ang = Math.acos(dot);
  const cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x;
  return (cx * axis.x + cy * axis.y + cz * axis.z) < 0 ? -ang : ang;
}

/** Shortest-arc quaternion from `from` to `to` (both normalized vectors). */
const _sa = new THREE.Vector3();
export function shortestArc(from, to, out = new THREE.Quaternion()) {
  const d = from.dot(to);
  if (d >= 1 - 1e-7) return out.set(0, 0, 0, 1);
  if (d <= -1 + 1e-7) {
    _sa.set(1, 0, 0).cross(from);
    if (_sa.lengthSq() < 1e-6) _sa.set(0, 1, 0).cross(from);
    _sa.normalize();
    return out.setFromAxisAngle(_sa, Math.PI);
  }
  _sa.crossVectors(from, to);
  return out.set(_sa.x, _sa.y, _sa.z, 1 + d).normalize();
}

/** Convert a quaternion into an axis-angle rotation vector (radians · axis). */
export function quatToRotVec(q, out = new THREE.Vector3()) {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-8) return out.set(0, 0, 0);
  const angle = 2 * Math.atan2(s, w);
  return out.set(x / s * angle, y / s * angle, z / s * angle);
}

/** Smallest signed difference between two angles. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** A moving-average window, used to read mouse gesture speed. */
export class Ema {
  constructor(lambda = 14) { this.v = 0; this.lambda = lambda; }
  push(x, dt) { this.v = damp(this.v, x, this.lambda, dt); return this.v; }
}

/** Circular buffer of recent samples — used for chamber/parry timing windows. */
export class RingBuffer {
  constructor(n) { this.n = n; this.buf = new Array(n); this.i = 0; this.count = 0; }
  push(v) { this.buf[this.i] = v; this.i = (this.i + 1) % this.n; this.count = Math.min(this.count + 1, this.n); }
  /** iterate newest → oldest */
  *recent() { for (let k = 1; k <= this.count; k++) yield this.buf[(this.i - k + this.n) % this.n]; }
}
