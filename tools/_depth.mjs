/**
 * The depth lane's instrument — what the air does to the GROUND.
 *
 * The complaint this answers is not about the skyline: it is that a hundred and
 * seventy metres of desert air changes the sand by almost nothing, because the
 * haze is the same colour as the thing it is hazing. So the measurement has to
 * be taken ALONG THE GROUND at known distances, not off a hand-placed box.
 *
 * Two commands, and they check each other:
 *
 *   model   GL-free. Runs the engine's own sky/haze derivation and the terrain
 *           fog chunk's arithmetic over a level's atmosphere, for a sand sample
 *           at 20…240 m, and prints display luminance / saturation / hue. Costs
 *           60 ms, so the fix can be swept instead of guessed at.
 *
 *   sweep   The same quantities read off a REAL frame (one produced by
 *           tools/arena-lane.mjs frame, which freezes the weather and pins the
 *           camera). Distance per pixel comes from ray-marching the level's own
 *           heightfield from the pinned eye, so a pixel is binned by the range
 *           of the ground it is actually showing rather than by its row.
 *
 * `model` is calibrated by `sweep`: the near-sand radiance it propagates is
 * inverted out of the measured 20 m pixel, so the model is a model of the AIR
 * only and cannot quietly invent the ground.
 *
 * Usage:
 *   node tools/_depth.mjs sweep .smoke/lane-arena/depth-before-dunes.png --level dunes
 *   node tools/_depth.mjs model --level dunes [--near 0.62,0.44,0.28]
 *   node tools/_depth.mjs hist  <png>
 */

import { readFileSync } from 'node:fs';
import './dom-shim.mjs';
import { inflateSync } from 'node:zlib';
import { resolve, join, basename } from 'node:path';
import { resolveLevel, nodeLevel } from './_roster.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const CMD = argv[0];
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const positional = () => { const o = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { i++; continue; } o.push(argv[i]); } return o; };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx <= 1e-9 ? 0 : d / mx, v: mx };
}

/* ── the frame's own tone curve, transcribed from Engine's composite pass and
 *    kept identical to tools/arena-lane.mjs's copy of it ─────────────────── */
function aces(rgb, exposure) {
  const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
  const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  let v = rgb.map((c) => c * exposure / 0.6);
  v = mul(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(OUT, v).map(clamp01);
}
const GRADE_FIXED = { black: 0.018, curve: 0.32, contrast: 1.04,
  shadowTint: [0.955, 0.985, 1.070], highTint: [1.035, 1.000, 0.955] };
function grade(srgb, a) {
  const lift = a.lift ?? [0.004, 0.006, 0.012];
  const gain = a.gain ?? [1.02, 1.0, 0.98];
  const sat = a.saturation ?? 1.06;
  const G = GRADE_FIXED;
  let c = srgb.map((v) => Math.max(v - G.black, 0) / (1 - G.black));
  c = c.map((v) => v + (v * v * (3 - 2 * v) - v) * G.curve);
  c = c.map((v) => (v - 0.5) * G.contrast + 0.5);
  c = c.map((v, i) => v * gain[i] + lift[i]);
  const luma = LUM(c[0], c[1], c[2]);
  const t = clamp01((luma - 0.12) / 0.60); const ss = t * t * (3 - 2 * t);
  c = c.map((v, i) => v * (G.shadowTint[i] + (G.highTint[i] - G.shadowTint[i]) * ss));
  const th = clamp01((luma - 0.62) / 0.38); const sh = th * th * (3 - 2 * th);
  const satEff = sat * (1 + (0.70 - 1) * sh);
  return c.map((v) => clamp01(luma + (v - luma) * satEff));
}
const through = (linear, exposure, a) => grade(aces(linear, exposure).map(linearToSrgb), a);

/** Radiance that would display as `disp`. Bisection per channel through the
 *  whole curve — the saturation step mixes channels, so nothing here is
 *  invertible in closed form and pretending otherwise is how you calibrate a
 *  model against a number it never produced. */
function invert(disp, exposure, a) {
  let lo = [0, 0, 0], hi = [8, 8, 8];
  for (let it = 0; it < 60; it++) {
    const mid = lo.map((v, i) => (v + hi[i]) * 0.5);
    const out = through(mid, exposure, a);
    for (let i = 0; i < 3; i++) { if (out[i] < disp[i]) lo[i] = mid[i]; else hi[i] = mid[i]; }
  }
  return lo.map((v, i) => (v + hi[i]) * 0.5);
}

/* ══ PNG ═════════════════════════════════════════════════════════════════ */
function decodePng(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 8, colour = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colour = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNGs');
  const bpp = colour === 6 ? 4 : colour === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const A = i >= bpp ? cur[i - bpp] : 0, B = prev ? prev[i] : 0, C = i >= bpp && prev ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += A; else if (ft === 2) v += B; else if (ft === 3) v += (A + B) >> 1;
      else if (ft === 4) { const pp = A + B - C, pa = Math.abs(pp - A), pb = Math.abs(pp - B), pc = Math.abs(pp - C); v += (pa <= pb && pa <= pc) ? A : (pb <= pc ? B : C); }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, bpp, data: out };
}

/* ══ the terrain fog chunk, in JS ═════════════════════════════════════════ */

/**
 * TERRAIN_FRAG_FOG's arithmetic for one sample. `ray` is the world offset from
 * the eye to the fragment, which is exactly what vFogRay carries.
 *
 * `skyTarget` is what the far field converges on; passing it in is the whole
 * point of this file — it is the one term the fix moves.
 */
function terrainFog(ray, eyeY, opt) {
  const radial = Math.hypot(ray[0], ray[1], ray[2]);
  let path = -ray[2];                                    // placeholder; set below
  path = opt.viewDepth ?? radial;
  const invH = opt.shapeX, base = opt.shapeY;
  if (invH > 0) {
    const y0 = Math.min(Math.max(eyeY - base, -40), 600);
    const k = ray[1] * invH;
    const t0 = Math.exp(-y0 * invH);
    const m = Math.abs(k) < 1e-3 ? t0 : t0 * (1 - Math.exp(-k)) / k;
    path = radial * Math.min(Math.max(m, 0), 6) * opt.shapeW;
  }
  const ss = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const hazeD = opt.density * (1 + opt.hazeX * ss(160, 460, radial));
  const factor = 1 - Math.exp(-hazeD * hazeD * path * path);
  const tone = opt.fogColor.slice();
  if (opt.sunW > 0) {
    const d = ray.map((v) => v / Math.max(radial, 1e-4));
    const cos = d[0] * opt.sunDir[0] + d[1] * opt.sunDir[1] + d[2] * opt.sunDir[2];
    const g = opt.tintG, g2 = g * g;
    const phase = (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * cos, 1e-4), 1.5);
    const glow = opt.tint.map((c) => c * opt.sunW * (phase + 0.75 * (1 + cos * cos) * 0.16));
    if (opt.capped) {
      for (let i = 0; i < 3; i++) { const cap = Math.max(opt.fogColor[i], 1e-4) * 0.26; tone[i] += cap * (1 - Math.exp(-glow[i] / cap)); }
    } else {
      for (let i = 0; i < 3; i++) tone[i] += glow[i];
    }
  }
  const w = ss(50, 230, radial) * opt.hazeY;
  for (let i = 0; i < 3; i++) tone[i] = tone[i] + (opt.skyTarget[i] - tone[i]) * w;
  return { factor, tone, radial };
}

/* ══ level plumbing ══════════════════════════════════════════════════════ */

async function levelAir(key) {
  const E = await import(join(ROOT, 'src/engine/Engine.js'));
  const { LEVELS } = await import(join(ROOT, 'src/game/Levels.js'));
  const THREE = await import('three');
  const a = LEVELS[key].atmosphere;
  const meter = E.atmosphereMeter(a);
  const disp = E.skyDisplayShoulder(a, meter);
  const sun = E.sunDirection(a, new THREE.Vector3());
  const fog = E.hazeRadiance(a, new THREE.Color(), disp);
  const side = sun.clone().setY(0).normalize().cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
  const flat = sun.clone().setY(0.03).normalize();
  const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const hazeSun = E.skyShoulder(E.skyRadiance(flat, sun, a, new THREE.Color()));
  const glowSide = lum(E.skyShoulder(E.skyRadiance(side, sun, a, new THREE.Color())));
  const gain = Math.min(Math.max(lum(hazeSun) - glowSide, 0), 12);
  const sl = Math.max(0.02, lum(hazeSun));
  /** The DRAWN sky in a bearing, at the skyline — the same evaluation
   *  SkyDome.skyBandTexture bakes into ground.skyBand. */
  const drawn = (bearing, el = 0.0225) => {
    const c = Math.sqrt(Math.max(0, 1 - el * el));
    const d = new THREE.Vector3(Math.cos(bearing) * c, el, Math.sin(bearing) * c);
    const col = E.skyShoulder(E.skyRadiance(d, sun, a, new THREE.Color()), disp.knee, disp.ceil);
    return [col.r, col.g, col.b];
  };
  return { a, meter, disp, sun: [sun.x, sun.y, sun.z], exposure: meter.exposure,
    fogColor: [fog.r, fog.g, fog.b], hazeSunTint: [hazeSun.r / sl, hazeSun.g / sl, hazeSun.b / sl],
    sunW: a.sky === false ? 0 : (a.inscatter ?? gain * 0.028), drawn,
    hemi: (() => { const c = new THREE.Color(a.skyColor ?? 0xbcd8ff); return [c.r, c.g, c.b]; })() };
}

function say(tag, rgb, exposure, a) {
  const d = through(rgb, exposure, a);
  const H = hsv(...d);
  return `${tag} L ${LUM(...d).toFixed(3)}  S ${H.s.toFixed(3)}  H ${H.h.toFixed(0).padStart(3)}°`;
}

/* ══ model ═══════════════════════════════════════════════════════════════ */

async function cmdModel() {
  const key = await nodeLevel(flag('level', null), { sky: true });
  const air = await levelAir(key);
  const a = air.a;
  const nearArg = flag('near', null);
  // The eye and the view of the pinned pose in tools/arena-lane.mjs frame.
  const eyeY = 1.75, viewB = Math.atan2(-1, 0);        // looking down −z
  const near = nearArg ? nearArg.split(',').map(Number)
    : invert([0.62, 0.50, 0.36], air.exposure, a);      // a stand-in until sweep calibrates
  console.log(`\n── ${key}  exposure ${air.exposure.toFixed(3)}  sunW ${air.sunW.toFixed(4)}`);
  console.log(`   near-sand radiance ${near.map((v) => v.toFixed(3)).join(', ')}  →  ${say('', near, air.exposure, a)}`);
  const skyOld = air.hemi;
  const skyNew = air.drawn(viewB);
  console.log(`   convergence target  OLD (hemi swatch) ${skyOld.map((v) => v.toFixed(3)).join(', ')}  L ${LUM(...skyOld).toFixed(3)}`);
  console.log(`                       NEW (drawn sky @ view bearing) ${skyNew.map((v) => v.toFixed(3)).join(', ')}  L ${LUM(...skyNew).toFixed(3)}`);
  console.log(`   ${say('   sky as drawn:', skyNew, air.exposure, a)}`);
  console.log(`   fogColor (hazeRadiance) ${air.fogColor.map((v) => v.toFixed(3)).join(', ')}  L ${LUM(...air.fogColor).toFixed(3)}`);

  const base = { shapeX: a.sky === false ? 0 : 1 / (a.fogHeight ?? 38), shapeY: a.fogBase ?? 0, shapeW: 1,
    density: a.fogDensity ?? 0.0035, hazeX: 0.30, hazeY: 1.0, fogColor: air.fogColor,
    sunDir: air.sun, tint: air.hazeSunTint, tintG: 0.50, sunW: air.sunW };

  for (const [name, opt] of [['CURRENT', { ...base, skyTarget: skyOld, capped: false }],
    ['PROPOSED', { ...base, skyTarget: skyNew, capped: true }]]) {
    console.log(`\n   ${name}`);
    console.log('     d(m)  fogFactor    L      S      H     ΔS vs 20m');
    let s20 = null;
    for (const d of [20, 40, 60, 90, 120, 160, 200, 240]) {
      // A ground sample d metres out along the view axis, dropping the eye
      // height over that run — a level camera on a level plane.
      const ray = [0, -eyeY, -d];
      const f = terrainFog(ray, eyeY, opt);
      const rgb = near.map((v, i) => v + (f.tone[i] - v) * f.factor);
      const disp = through(rgb, air.exposure, a);
      const H = hsv(...disp);
      if (d === 20) s20 = H.s;
      console.log(`   ${String(d).padStart(5)}   ${f.factor.toFixed(3)}    ${LUM(...disp).toFixed(3)}  ${H.s.toFixed(3)}  ${H.h.toFixed(0).padStart(3)}°   ${((H.s / s20 - 1) * 100).toFixed(1)}%`);
    }
  }
}

/* ══ sweep ═══════════════════════════════════════════════════════════════ */

async function cmdSweep() {
  const file = positional()[0];
  const key = await nodeLevel(flag('level', null), { sky: true });
  const png = decodePng(file);
  const THREE = await import('three');
  const { Terrain } = await import(join(ROOT, 'src/world/Terrain.js'));
  const { LEVELS } = await import(join(ROOT, 'src/game/Levels.js'));
  const air = await levelAir(key);
  const terrain = new Terrain(new THREE.Scene(), LEVELS[key].terrain, 0.8);   // World's `medium`
  const gy = terrain.height(0, 0);

  // The pinned pose, exactly as tools/arena-lane.mjs frame installs it.
  const eye = parseFloat(flag('eye', '1.75'));
  const cam = new THREE.PerspectiveCamera(60, png.width / png.height, 0.15, 520);
  cam.position.set(0, gy + eye, 30);
  cam.lookAt(0, gy + eye * 0.35 + 6.3, -180);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const BINS = [20, 30, 40, 55, 70, 90, 110, 140, 170, 200, 240];
  const buckets = BINS.map(() => []);
  const v = new THREE.Vector3();
  for (let py = Math.floor(png.height * 0.40); py < png.height; py += 2) {
    for (let px = 40; px < png.width - 40; px += 4) {
      v.set((px / png.width) * 2 - 1, -((py / png.height) * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
      if (v.y > 0.02) continue;
      // march until the ray drops under the heightfield, then bisect
      let t = 2, hit = -1;
      for (; t < 330; t += 0.6) {
        const x = cam.position.x + v.x * t, z = cam.position.z + v.z * t;
        if (!terrain.inBounds(x, z, 2)) break;
        if (cam.position.y + v.y * t < terrain.height(x, z)) { hit = t; break; }
      }
      if (hit < 0) continue;
      let lo = hit - 0.6, hi = hit;
      for (let i = 0; i < 20; i++) {
        const m = (lo + hi) * 0.5;
        if (cam.position.y + v.y * m < terrain.height(cam.position.x + v.x * m, cam.position.z + v.z * m)) hi = m; else lo = m;
      }
      const d = (lo + hi) * 0.5;
      let bi = -1;
      for (let i = 0; i < BINS.length; i++) if (Math.abs(d - BINS[i]) < BINS[i] * 0.12) { bi = i; break; }
      if (bi < 0) continue;
      const o = (py * png.width + px) * png.bpp;
      buckets[bi].push([png.data[o] / 255, png.data[o + 1] / 255, png.data[o + 2] / 255]);
    }
  }
  console.log(`\n── ${basename(file)}   ground sampled by ray-marched range (${key})`);
  console.log('     d(m)    n      R     G     B     lum    sat   hue    ΔS vs 20m   p10 lum  dark%');
  let s20 = null;
  const rows = [];
  for (let i = 0; i < BINS.length; i++) {
    const px = buckets[i];
    if (px.length < 40) { console.log(`   ${String(BINS[i]).padStart(5)}  ${String(px.length).padStart(5)}   — too few samples`); continue; }
    // MEDIAN, not mean: a rock, a tussock or a prop in the band is an outlier,
    // and a mean quietly folds it into the sand's colour.
    const med = [0, 1, 2].map((c) => { const s = px.map((p) => p[c]).sort((x, y) => x - y); return s[s.length >> 1]; });
    const H = hsv(...med);
    if (s20 === null) s20 = H.s;
    // The DARK TAIL of the band, which is what a cast shadow actually is. A
    // median cannot see one: shadow is a minority of the pixels at any range,
    // so it moves the tenth percentile and leaves the middle alone.
    const L = px.map((p) => LUM(...p)).sort((x, y) => x - y);
    const p10 = L[Math.floor(L.length * 0.10)];
    const dark = L.filter((v) => v < LUM(...med) * 0.72).length / L.length;
    rows.push({ d: BINS[i], rgb: med, lum: LUM(...med), sat: H.s, hue: H.h, n: px.length, p10, dark });
    console.log(`   ${String(BINS[i]).padStart(5)}  ${String(px.length).padStart(5)}   ${med.map((x) => x.toFixed(3)).join(' ')}  ${LUM(...med).toFixed(3)}  ${H.s.toFixed(3)}  ${H.h.toFixed(0).padStart(3)}°   ${((H.s / s20 - 1) * 100).toFixed(1).padStart(6)}%    ${p10.toFixed(3)}   ${(100 * dark).toFixed(1)}%`);
  }
  // and what the sky over that ground reads as, in the same frame
  const skyBox = [];
  for (let py = 8; py < 60; py += 2) for (let px = 500; px < 780; px += 4) {
    const o = (py * png.width + px) * png.bpp;
    skyBox.push([png.data[o] / 255, png.data[o + 1] / 255, png.data[o + 2] / 255]);
  }
  const skyMed = [0, 1, 2].map((c) => { const s = skyBox.map((p) => p[c]).sort((x, y) => x - y); return s[s.length >> 1]; });
  console.log(`   sky above the view axis: ${skyMed.map((x) => x.toFixed(3)).join(' ')}  lum ${LUM(...skyMed).toFixed(3)}  sat ${hsv(...skyMed).s.toFixed(3)}`);
  for (const r of rows.slice(0, 3)) {
    const rad = invert(r.rgb, air.exposure, air.a);
    console.log(`   radiance inverted out of the ${r.d} m sample: ${rad.map((x) => x.toFixed(4)).join(',')}`);
  }
  terrain.dispose();
  hist(png);
}

/* ══ hist ════════════════════════════════════════════════════════════════ */

function hist(png) {
  const { width, height, bpp, data } = png;
  let n = 0, b20 = 0, b30 = 0, a85 = 0, a90 = 0, sum = 0;
  const all = [];
  for (let i = 0; i < width * height; i++) {
    const o = i * bpp;
    const L = LUM(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255);
    n++; sum += L; all.push(L);
    if (L < 0.20) b20++; if (L < 0.30) b30++; if (L > 0.85) a85++; if (L > 0.90) a90++;
  }
  all.sort((x, y) => x - y);
  const q = (f) => all[Math.min(all.length - 1, Math.floor(all.length * f))];
  console.log(`   LUMINANCE HISTOGRAM  below 0.20 ${(100 * b20 / n).toFixed(1)}%  below 0.30 ${(100 * b30 / n).toFixed(1)}%  `
    + `above 0.85 ${(100 * a85 / n).toFixed(1)}%  above 0.90 ${(100 * a90 / n).toFixed(1)}%`);
  console.log(`   p01 ${q(0.01).toFixed(3)}  p05 ${q(0.05).toFixed(3)}  median ${q(0.5).toFixed(3)}  p95 ${q(0.95).toFixed(3)}  p99 ${q(0.99).toFixed(3)}  mean ${(sum / n).toFixed(3)}`);
}

/* ══ frame ═══════════════════════════════════════════════════════════════ */

/**
 * The same pinned, weather-frozen pose tools/arena-lane.mjs shoots — the boot
 * below is its boot, and it has to stay its boot or the two lanes are not
 * looking at the same picture — with ONE addition that lane does not need.
 *
 * fitShadows follows the GAMEPLAY camera, because in the game the camera is the
 * view. arena-lane pins its pose inside engine.render, which happens after
 * World.update has already fitted the cascades to wherever the player happened
 * to be facing — so a shot taken that way measures the shadow rig aimed
 * somewhere else, and reads as "the cascades did nothing". This pins the pose
 * before the fit as well, which is what the running game does every frame.
 */
async function cmdFrame() {
  const { chromium } = await import('playwright-core');
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { existsSync, statSync, mkdirSync } = await import('node:fs');
  const { extname, normalize } = await import('node:path');
  let level = flag('level', null); const tag = flag('tag', 'now');
  // Eye height above the ground datum. The standing pose is 1.75 m, and from
  // there a dune sea occludes its own ground past about 95 m — so the one thing
  // the aerial term exists for cannot be photographed from it. `--eye 26` puts
  // the camera on a crest, which is where a landscape is looked at from.
  const eye = parseFloat(flag('eye', '1.75'));
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  level = await resolveLevel(page, level, { sky: true });
  await page.evaluate((lv) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6 }));
  }, level);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
  await page.click('#btn-deploy', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(2200);
  const info = await page.evaluate((eyeH) => {
    const S = window.SABER, e = S.engine, w = S.world;
    const W = w.atmosphere?.weather;
    if (W) { W.peak = 0; W.unrest = 0; W.update(0); }       // FREEZE THE WEATHER
    const gy = w.terrain ? w.terrain.height(0, 0) : 0;
    const pin = () => {
      const c = e.camera;
      c.position.set(0, gy + eyeH, 30);
      c.lookAt(0, gy + eyeH * 0.35 + 6.3, -180);
      c.updateMatrixWorld(true);
    };
    const origFit = e.fitShadows.bind(e);
    e.fitShadows = (centre) => { pin(); origFit(centre); };
    const orig = e.render.bind(e);
    e.render = (dt) => { pin(); orig(dt); };
    document.querySelector('#hud')?.classList.add('hidden');
    // `cascades` does not exist on the build this replaces — one box, on `sun`.
    const lights = e.cascades || [e.sun];
    return { exposure: e.renderer.toneMappingExposure, cascades: lights.length,
      boxes: lights.map((L) => [L.shadow.camera.right, L.shadow.mapSize.x, L.shadow.normalBias]) };
  }, eye);
  await page.waitForTimeout(4200);
  const out = join(ROOT, '.smoke', 'lane-arena');
  mkdirSync(out, { recursive: true });
  const file = join(out, `${tag}-${level}.png`);
  await page.screenshot({ path: file });
  await browser.close(); server.close();
  console.log(JSON.stringify(info));
  if (errors.length) console.log('ERRORS', errors.slice(0, 4));
  hist(decodePng(file));
}

/* ══ tone ════════════════════════════════════════════════════════════════ */

/**
 * The lit/shade ratio of flat ground, through the metered exposure and the
 * grade — the modelled form of the "GROUND BAND … tonal range" number
 * arena-lane reads off a frame. It will not reproduce that number exactly (the
 * frame's quartiles are not pure lit and pure shade, and half the dark quartile
 * is grazing N·L rather than shadow), but it moves the same way under the same
 * knobs, which is what a sweep needs.
 *
 *   node tools/_depth.mjs tone --level dunes [--set ambient=0.24,sunIntensity=8.6]
 */
async function cmdTone() {
  const E = await import(join(ROOT, 'src/engine/Engine.js'));
  const { LEVELS } = await import(join(ROOT, 'src/game/Levels.js'));
  const THREE = await import('three');
  const key = await nodeLevel(flag('level', null), { sky: true });
  const base = LEVELS[key].atmosphere;
  const sets = (flag('set', '') || '').split(',').filter(Boolean);
  const a = { ...base };
  for (const s of sets) { const [k, v] = s.split('='); a[k] = Number(v); }
  const m = E.atmosphereMeter(a);
  const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const albedo = new THREE.Color(a.groundColor ?? 0x60482e);
  const hemiIrr = (a.ambient ?? 0.85) * 0.45 * lum(new THREE.Color(a.skyColor ?? 0xbcd8ff));
  const fillIrr = (a.fillIntensity ?? 0.25) * lum(new THREE.Color(a.fillColor ?? 0x9fc4ff)) * 0.5;
  const probe = m.skyFull * (m.envI / 0.38);
  const indirect = hemiIrr + fillIrr + probe;
  const direct = (a.sunIntensity ?? 3.6) * Math.max(m.sunPos.y, 0);
  const sunC = new THREE.Color(a.sunColor ?? 0xfff0d8);
  const shade = [albedo.r, albedo.g, albedo.b].map((c) => c * indirect / Math.PI);
  const lit = [albedo.r * sunC.r, albedo.g * sunC.g, albedo.b * sunC.b]
    .map((c, i) => shade[i] + c * direct / Math.PI);
  const dl = through(lit, m.exposure, a), ds = through(shade, m.exposure, a);
  const hl = hsv(...dl), hs = hsv(...ds);
  console.log(`   ${key}${sets.length ? ' [' + sets.join(' ') + ']' : ''}  exposure ${m.exposure.toFixed(3)}  `
    + `irradiance ${m.irradiance.toFixed(2)} (direct ${direct.toFixed(2)} / indirect ${indirect.toFixed(2)})`);
  console.log(`      lit   ${dl.map((v) => v.toFixed(3)).join(' ')}  L ${LUM(...dl).toFixed(3)}  hue ${hl.h.toFixed(1)}°  B/R ${(dl[2] / dl[0]).toFixed(3)}`);
  console.log(`      shade ${ds.map((v) => v.toFixed(3)).join(' ')}  L ${LUM(...ds).toFixed(3)}  hue ${hs.h.toFixed(1)}°  B/R ${(ds[2] / ds[0]).toFixed(3)}`);
  console.log(`      tonal range ${(LUM(...dl) / Math.max(1e-4, LUM(...ds))).toFixed(2)}:1   `
    + `Δ(B/R) ${(ds[2] / ds[0] - dl[2] / dl[0]).toFixed(3)}   Δhue ${Math.abs(hl.h - hs.h).toFixed(1)}°`);
}

/* ══════════════════════════════════════════════════════════════════════ */

if (CMD === 'tone') await cmdTone();
else if (CMD === 'frame') await cmdFrame();
else if (CMD === 'model') await cmdModel();
else if (CMD === 'sweep') await cmdSweep();
else if (CMD === 'hist') hist(decodePng(positional()[0]));
else console.log('usage: node tools/_depth.mjs model|sweep|hist');
