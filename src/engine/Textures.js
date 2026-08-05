/**
 * SABER — procedural texture foundry.
 *
 * Every surface in the game is generated here at boot. No image files, nothing
 * to download, and full control over tiling, normal strength and roughness.
 * Heightfields are authored once and albedo/normal/roughness are derived from
 * them, which keeps lighting response consistent across every material.
 */

import * as THREE from 'three';
import { noise2, fbm2, worley2, ridged2, clamp, lerp, makeRng } from './MathUtil.js';

const cache = new Map();

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, { repeat = 1, srgb = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Build albedo / normal / roughness from a single sampler.
 * sampler(x, y) → { h, r, g, b, rough, ao }  with x,y in [0,1)
 */
function bake(size, sampler, opts = {}) {
  const { normalStrength = 2.0, aoStrength = 0.55 } = opts;
  const H = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const s = sampler(x * inv, y * inv, x, y);
      H[i] = s.h;
      albedo[i * 4] = s.r * 255; albedo[i * 4 + 1] = s.g * 255; albedo[i * 4 + 2] = s.b * 255; albedo[i * 4 + 3] = 255;
      const rr = clamp(s.rough ?? 0.8, 0, 1);
      const mm = clamp(s.metal ?? 0, 0, 1);
      // three's packed workflow: G = roughness, B = metalness
      rough[i * 4] = 255; rough[i * 4 + 1] = rr * 255; rough[i * 4 + 2] = mm * 255; rough[i * 4 + 3] = 255;
    }
  }

  // Sobel → normal, plus a cheap curvature AO folded into albedo
  const nrm = new Uint8ClampedArray(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
               - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
               - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * normalStrength, ny = -dy * normalStrength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nrm[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;

      // concavity darkening
      const lap = at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1) - 4 * H[i];
      const ao = clamp(1 + lap * aoStrength * 8, 0.55, 1.15);
      albedo[i * 4] *= ao; albedo[i * 4 + 1] *= ao; albedo[i * 4 + 2] *= ao;
    }
  }

  const mk = (data) => {
    const c = canvasOf(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    return c;
  };
  return { albedo: mk(albedo), normal: mk(nrm), rough: mk(rough) };
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
  const set = {
    map: toTexture(b.albedo, { repeat, srgb: true }),
    normalMap: toTexture(b.normal, { repeat }),
    roughnessMap: toTexture(b.rough, { repeat }),
    metalnessMap: toTexture(b.rough, { repeat }),
  };
  cache.set(key, set);
  return set;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Surfaces                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

export function sandMaps(repeat = 26) {
  return materialFrom('sand', 512, (u, v) => {
    // fine grain over wind ripples
    const ripple = Math.sin((u * 34 + fbm2(u * 5, v * 5, 3) * 3.4) * Math.PI * 2) * 0.5 + 0.5;
    const grain = fbm2(u * 190, v * 190, 3) * 0.5 + 0.5;
    const macro = fbm2(u * 7, v * 7, 4) * 0.5 + 0.5;
    const h = ripple * 0.42 + grain * 0.34 + macro * 0.24;
    const tint = 0.86 + macro * 0.2 + grain * 0.09;
    return {
      h: h * 0.06,
      r: clamp(0.78 * tint, 0, 1), g: clamp(0.66 * tint, 0, 1), b: clamp(0.47 * tint, 0, 1),
      rough: 0.92 - grain * 0.12, metal: 0,
    };
  }, { repeat, normalStrength: 5.5, aoStrength: 0.5 });
}

export function rockMaps(repeat = 8) {
  return materialFrom('rock', 512, (u, v) => {
    const cell = worley2(u * 9, v * 9);
    const crack = 1 - clamp(cell * 3.4, 0, 1);
    const detail = ridged2(u * 15, v * 15, 5) ;
    const grit = fbm2(u * 120, v * 120, 3) * 0.5 + 0.5;
    const h = detail * 0.6 + grit * 0.18 - crack * 0.5;
    const t = 0.5 + detail * 0.45 + grit * 0.16 - crack * 0.3;
    return {
      h: h * 0.09,
      r: clamp(0.42 * t + 0.06, 0, 1), g: clamp(0.36 * t + 0.05, 0, 1), b: clamp(0.30 * t + 0.05, 0, 1),
      rough: clamp(0.94 - detail * 0.12, 0, 1), metal: 0,
    };
  }, { repeat, normalStrength: 4.0 });
}

export function metalMaps(repeat = 4, opts = {}) {
  const key = 'metal@' + repeat + (opts.tint || '');
  const tintR = opts.tintR ?? 0.62, tintG = opts.tintG ?? 0.65, tintB = opts.tintB ?? 0.70;
  if (cache.has(key)) return cache.get(key);
  const rng = makeRng(77);
  const scratches = [];
  for (let i = 0; i < 160; i++) scratches.push({ x: rng(), y: rng(), a: rng() * Math.PI, l: rng() * 0.4 + 0.03, w: rng() * 0.0016 + 0.0004 });
  const bakedMetal = bake(512, (u, v) => {
    // panel seams
    const gx = Math.abs(((u * 4) % 1) - 0.5), gy = Math.abs(((v * 4) % 1) - 0.5);
    const seam = clamp(1 - Math.min(gx, gy) * 44, 0, 1);
    const brushed = fbm2(u * 300, v * 6, 3) * 0.5 + 0.5;
    const blotch = fbm2(u * 12, v * 12, 4) * 0.5 + 0.5;
    let scr = 0;
    for (const s of scratches) {
      const dx = u - s.x, dy = v - s.y;
      const along = dx * Math.cos(s.a) + dy * Math.sin(s.a);
      const perp = -dx * Math.sin(s.a) + dy * Math.cos(s.a);
      if (along > 0 && along < s.l && Math.abs(perp) < s.w) scr = Math.max(scr, 1 - Math.abs(perp) / s.w);
    }
    const h = -seam * 0.55 + brushed * 0.1 + scr * 0.22 + blotch * 0.06;
    const shade = 0.78 + brushed * 0.22 + blotch * 0.16 - seam * 0.28 + scr * 0.25;
    return {
      h: h * 0.05,
      r: clamp(tintR * shade, 0, 1), g: clamp(tintG * shade, 0, 1), b: clamp(tintB * shade, 0, 1),
      rough: clamp(0.42 + blotch * 0.3 - scr * 0.26 + seam * 0.2, 0.06, 1),
      metal: clamp(0.94 - seam * 0.35 - blotch * 0.12, 0, 1),
    };
  }, { normalStrength: 3.2 });
  const set = {
    map: toTexture(bakedMetal.albedo, { repeat, srgb: true }),
    normalMap: toTexture(bakedMetal.normal, { repeat }),
    roughnessMap: toTexture(bakedMetal.rough, { repeat }),
    metalnessMap: toTexture(bakedMetal.rough, { repeat }),
  };
  cache.set(key, set);
  return set;
}

export function clothMaps(repeat = 3) {
  return materialFrom('cloth', 256, (u, v) => {
    const weaveU = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5;
    const weaveV = Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5;
    const weave = Math.max(weaveU, weaveV);
    const wear = fbm2(u * 8, v * 8, 4) * 0.5 + 0.5;
    const fuzz = fbm2(u * 220, v * 220, 2) * 0.5 + 0.5;
    const h = weave * 0.5 + fuzz * 0.2 + wear * 0.3;
    const t = 0.72 + wear * 0.35 + weave * 0.12;
    return {
      h: h * 0.04,
      r: clamp(t, 0, 1), g: clamp(t, 0, 1), b: clamp(t, 0, 1),
      rough: clamp(0.86 + fuzz * 0.1 - wear * 0.08, 0, 1), metal: 0,
    };
  }, { repeat, normalStrength: 3.0 });
}

export function armorMaps(repeat = 2) {
  return materialFrom('armor', 512, (u, v) => {
    const scuff = fbm2(u * 26, v * 26, 4) * 0.5 + 0.5;
    const dirt = clamp(fbm2(u * 6 + 11, v * 6, 4) * 0.5 + 0.5, 0, 1);
    const nick = worley2(u * 26, v * 26) < 0.13 ? 1 : 0;
    const h = scuff * 0.24 - nick * 0.5;
    const t = 0.92 + scuff * 0.12 - dirt * 0.26 - nick * 0.3;
    return {
      h: h * 0.04,
      r: clamp(t, 0, 1), g: clamp(t * 0.99, 0, 1), b: clamp(t * 0.97, 0, 1),
      rough: clamp(0.34 + dirt * 0.45 + nick * 0.3, 0.05, 1),
      metal: clamp(0.06 + nick * 0.5, 0, 1),
    };
  }, { repeat, normalStrength: 3.0 });
}

export function duracreteMaps(repeat = 6) {
  return materialFrom('duracrete', 512, (u, v) => {
    const agg = worley2(u * 22, v * 22);
    const grain = fbm2(u * 90, v * 90, 3) * 0.5 + 0.5;
    const stain = fbm2(u * 4, v * 4, 4) * 0.5 + 0.5;
    const h = agg * 0.35 + grain * 0.2;
    const t = 0.52 + agg * 0.28 + grain * 0.12 - stain * 0.18;
    return {
      h: h * 0.045,
      r: clamp(t * 1.0, 0, 1), g: clamp(t * 0.98, 0, 1), b: clamp(t * 0.94, 0, 1),
      rough: clamp(0.88 - agg * 0.1, 0, 1), metal: 0,
    };
  }, { repeat, normalStrength: 3.4 });
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

export function disposeTextureCache() {
  for (const set of cache.values()) for (const t of Object.values(set)) t.dispose?.();
  cache.clear();
  baked.clear();
}
