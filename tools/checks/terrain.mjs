/**
 * Ground, cover, water and the air between them.
 *
 * Everything pinned here was measured off the real heightfield and the real
 * shader source, because every one of these faults rendered without an error
 * and looked entirely plausible in the code:
 *
 *   · the dune sea composed to ONE colour — 46% of the map was the bare base
 *     coat with nothing layered on it, and the albedo across the whole 560 m
 *     field varied by 12% in luminance and 0.03 in chroma. No amount of ripple
 *     detail rescues a landscape that is one hue;
 *   · the ground had no occlusion of any kind, so a hollow, a gully and a
 *     ripple trough all received the full hemisphere plus the full probe and
 *     nothing on the surface had any form except what N·L gave it — which at a
 *     26° sun is almost nothing;
 *   · the sand map carries two ripple trains crossing at 33°, and the material
 *     bombed two ROTATED taps of it and took the brighter one per pixel, which
 *     multiplies the lattice: the desert came out as woven matting. The
 *     near-field detail tap then crossed both at 50° and four centimetres;
 *   · curving the ripples by spinning the sampling frame put a visible swirl
 *     with an eye in it wherever the map was far from the world origin, because
 *     the rotation scales the tile by |p|·dθ/dx;
 *   · the near grass ring covered 6.8% of its own ground with silhouette. Nine
 *     parts bare sand to one part grass is a pincushion, not a meadow;
 *   · the river was a plane at a constant height with a hard straight edge and
 *     no idea what was underneath it.
 *
 * None of those throw. They just make it look like a hobby project.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain, TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { GrassField, Water, ground, waterShade } from '../../src/world/Scenery.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { sunDirection, atmosphereMeter } from '../../src/engine/Engine.js';
import { rawMaps, sandMaps, soilMaps, snowMaps, duracreteMaps } from '../../src/engine/Textures.js';

/* ── the frame's own tone curve ───────────────────────────────────────────
 * Transcribed from Engine's composite pass, the same way tools/checks/vfx.mjs
 * carries its own copy: saturation is a DISPLAY quantity, and the last two
 * rounds of this workstream both went wrong by judging colour in linear
 * radiance. A river measured before the curve is a river nobody looked at.
 */
const clampT = (v) => Math.min(1, Math.max(0, v));
const LUMT = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
function acesT(rgb, exposure = 1) {
  const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
  const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  let v = rgb.map((c) => c * exposure / 0.6);
  v = mul(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(OUT, v).map(clampT);
}
const GRADE_T = { black: 0.018, curve: 0.32, contrast: 1.04,
  shadowTint: [0.955, 0.985, 1.070], highTint: [1.035, 1.000, 0.955] };
function throughTone(linear, exposure = 1, a = {}) {
  const G = GRADE_T;
  const lift = a.lift ?? [0.004, 0.006, 0.012], gain = a.gain ?? [1.02, 1.0, 0.98];
  let c = acesT(linear, exposure).map(linToSrgb);
  c = c.map((v) => Math.max(v - G.black, 0) / (1 - G.black));
  c = c.map((v) => v + (v * v * (3 - 2 * v) - v) * G.curve);
  c = c.map((v) => (v - 0.5) * G.contrast + 0.5);
  c = c.map((v, i) => v * gain[i] + lift[i]);
  const luma = LUMT(c);
  const t = clampT((luma - 0.12) / 0.60), ss = t * t * (3 - 2 * t);
  c = c.map((v, i) => v * (G.shadowTint[i] + (G.highTint[i] - G.shadowTint[i]) * ss));
  const th = clampT((luma - 0.62) / 0.38), sh = th * th * (3 - 2 * th);
  const satEff = (a.saturation ?? 1.06) * (1 + (0.70 - 1) * sh);
  return c.map((v) => clampT(luma + (v - luma) * satEff));
}

const PRESETS = ['dunes', 'arena', 'canyon', 'hangar', 'meadow', 'drifts', 'alpine'];
const OUTDOOR = ['dunes', 'arena', 'canyon', 'meadow', 'drifts', 'alpine'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c) => {
  const M = Math.max(c[0], c[1], c[2]);
  return M < 1e-6 ? 0 : (M - Math.min(c[0], c[1], c[2])) / M;
};
const mix3 = (a, b, w) => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];

/* ── the baked maps, read as bytes ────────────────────────────────────────
 * Never through a canvas: the headless DOM shim's getImageData returns zeros,
 * so a canvas readback measures every texture as perfectly black and perfectly
 * seamless. rawMaps hands back the arrays the bake actually wrote.
 */
const toLin8 = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const _mapMean = new Map();
/** Mean of dot(albedo, 1/3) — exactly what the terrain shader reads off it. */
function baseMapMean(name) {
  if (_mapMean.has(name)) return _mapMean.get(name);
  const m = rawMaps(name);
  const N = m.size * m.size;
  let s = 0;
  for (let i = 0; i < N; i++) {
    s += (toLin8(m.albedo[i * 4]) + toLin8(m.albedo[i * 4 + 1]) + toLin8(m.albedo[i * 4 + 2])) / 3;
  }
  const v = s / N;
  _mapMean.set(name, v);
  return v;
}

/**
 * How DIRECTIONAL a map's structure is, as the coherence of its gradient
 * structure tensor: 0 is isotropic, 1 is one perfectly parallel train.
 *
 * Rotation-invariant on purpose. Measuring |du| against |dv| would only find a
 * train that happens to run along a texture axis, and every one of these maps
 * builds its features on a slanted lattice vector so that it wraps.
 *
 * Measured on a 4× BOX DOWNSAMPLE, which is the whole trick. At full
 * resolution the tensor is dominated by whatever has the most energy per texel,
 * and on every one of these maps that is the isotropic grain — the sparkle in
 * the snow alone drags its raw coherence to 0.11, indistinguishable from soil's
 * 0.12, while its sastrugi are plainly there. At 128² the grain is gone and
 * what is left is the structure: sand 0.79, snow 0.65, soil 0.17.
 */
const _coh = new Map();
function anisotropy(name, down = 4) {
  const key = `${name}@${down}`;
  if (_coh.has(key)) return _coh.get(key);
  const m = rawMaps(name), S0 = m.size, A = m.albedo;
  const S = S0 / down, b = down;
  const g = new Float64Array(S * S);
  for (let y = 0; y < S0; y++) {
    for (let x = 0; x < S0; x++) g[((y / b) | 0) * S + ((x / b) | 0)] += toLin8(A[(y * S0 + x) * 4 + 1]) / (b * b);
  }
  const at = (x, y) => g[((y + S) % S) * S + ((x + S) % S)];
  let Jxx = 0, Jyy = 0, Jxy = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
      Jxx += gx * gx; Jyy += gy * gy; Jxy += gx * gy;
    }
  }
  const v = Math.hypot(Jxx - Jyy, 2 * Jxy) / Math.max(1e-12, Jxx + Jyy);
  _coh.set(key, v);
  return v;
}

/* ── the shader's own noise, in JS ───────────────────────────────────── */
const thash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function tnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = thash(ix, iy), b = thash(ix + 1, iy);
  const c = thash(ix, iy + 1), d = thash(ix + 1, iy + 1);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
function tfbm(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 3; i++) { s += tnoise(x, y) * a; x = x * 2.07 + 17.3; y = y * 2.07 + 17.3; a *= 0.5; }
  return s * 1.1428;
}

/**
 * The terrain fragment shader's layer weights and composed albedo, in JS,
 * driven by the REAL uniforms of a REAL Terrain so the two cannot drift apart
 * silently. Statistics on a screenshot can only ever suggest that a landscape
 * is one colour; this is the composition itself.
 */
function composeSurface(t) {
  const u = t._uniforms;
  const B = u.uBands.value, G = u.uGround.value, M = u.uMacro.value, RU = u.uRockUp.value;
  const V3 = (c) => [c.r, c.g, c.b];
  const base = V3(u.uBaseCol.value), grit = V3(u.uGritCol.value);
  const dust = V3(u.uDustCol.value), crust = V3(u.uCrustCol.value);
  const lag = V3(u.uLagCol.value), sheet = V3(u.uSheetCol.value);
  const rockA = V3(u.uRockCol.value), rockB = V3(u.uRockCol2.value);
  const patchF = u.uMix.value.y, macroF = M.x;

  const R = t.res, n = new THREE.Vector3();
  const step = Math.max(1, Math.floor(R / 200));
  const out = { cols: [], rock: [], ao: [], layers: { rock: 0, grit: 0, drift: 0, crust: 0, lag: 0, sheet: 0 }, bare: 0, n: 0 };
  for (let j = 2; j < R - 2; j += step) {
    for (let i = 2; i < R - 2; i += step) {
      const k = j * R + i;
      const x = -t.half + i * t.step, z = -t.half + j * t.step;
      t._vertexNormal(i, j, n);
      const slope = 1 - clamp(n.y, 0, 1);
      const y = t.heights[k];
      const conc = (t.landform[k * 4] / 255) * 2 - 1;
      const open = t.landform[k * 4 + 1] / 255;
      const upl = (t.landform[k * 4 + 2] / 255) * 2 - 1;
      const expo = (t.landform[k * 4 + 3] / 255) * 2 - 1;
      const mA = tfbm(x / 74, z / 74);
      const mB = tnoise(x * patchF, z * patchF);
      const mC = tnoise(x * 0.85, z * 0.85);
      const mD = tnoise(x * macroF, z * macroF) * 0.68
        + tnoise(x * macroF * 2.37 + 9.1, z * macroF * 2.37 + 9.1) * 0.32;
      const hollow = clamp(conc, 0, 1), crest = clamp(-conc, 0, 1);
      const basin = clamp(-upl, 0, 1), lee = clamp(-expo, 0, 1);
      const encl = clamp(1 - open * 2, 0, 1);

      const rockW = smoothstep(B.x, B.y, slope + (mB - 0.5) * 0.14
        + smoothstep(RU.y, RU.z, y) * RU.x);
      const gritW = smoothstep(B.z, B.w, slope + (mC - 0.5) * 0.09) * (1 - rockW);
      const scour = crest * clamp(expo * 1.3 + 0.3, 0, 1);
      const driftW = clamp(hollow * 1.25 + lee * 0.5 - 0.12, 0, 1) * (1 - rockW)
        * smoothstep(B.w * 1.6, 0, slope);
      const crustW = clamp(G.y * smoothstep(0.13, 0.02, slope)
        * smoothstep(0.25, 0.72, basin) * (0.55 + mA * 0.85), 0, 1);
      const lagW = smoothstep(0.47, 0.61, mD + scour * 0.14 - hollow * 0.10) * M.y * (1 - rockW);
      const sheetW = smoothstep(0.44, 0.28, mD - hollow * 0.10 - lee * 0.08) * M.z * (1 - rockW);

      let col = base;
      col = mix3(col, lag, lagW);
      col = mix3(col, sheet, sheetW);
      col = mix3(col, grit, Math.min(1, gritW * 0.9 + scour * 0.16));
      col = mix3(col, dust, driftW * 0.85);
      col = mix3(col, crust, crustW);
      if (rockW > 0.004) col = mix3(col, mix3(rockA, rockB, 0.5), rockW);
      const macro = 0.90 + mA * 0.22 + upl * 0.07 - basin * 0.06 + open * 0.05;
      out.cols.push([col[0] * macro, col[1] * macro, col[2] * macro]);
      out.rock.push(rockW);
      // landform occlusion only; the map's own cavity is texture, not landform
      out.ao.push(clamp(1 - (hollow * 0.30 + encl * 0.20 + driftW * 0.10) * M.w + crest * 0.05, 0.28, 1.06));

      out.layers.rock += rockW; out.layers.grit += gritW; out.layers.drift += driftW;
      out.layers.crust += crustW; out.layers.lag += lagW; out.layers.sheet += sheetW;
      const covered = Math.min(1, rockW) + Math.min(1, gritW * 0.9 + scour * 0.16) * (1 - rockW)
        + driftW * 0.85 + crustW + lagW + sheetW;
      if (covered < 0.15) out.bare++;
      out.n++;
    }
  }
  return out;
}

const spread = (vals) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
  return { mean: m, sd: Math.sqrt(Math.max(0, v)) };
};

/** Cache — a 340² Terrain plus its landform bake is not free. */
const built = new Map();
function terrainOf(name, q = 1.0) {
  const key = `${name}@${q}`;
  if (!built.has(key)) built.set(key, new Terrain(new THREE.Scene(), name, q));
  return built.get(key);
}
const surfaces = new Map();
function surfaceOf(name) {
  if (!surfaces.has(name)) surfaces.set(name, composeSurface(terrainOf(name)));
  return surfaces.get(name);
}

export function run({ check, assert, near }) {

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Ground material                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: no level composes to one colour at three brightnesses', () => {
    // The failure this replaces was not subtle and did not look like a bug: the
    // dune sea spent 46% of its area on the bare base coat and varied by 12% in
    // luminance across 560 m, because every layer that could have broken it up
    // was gated behind a slope or a hollow the dune sea does not have.
    const lines = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const L = spread(s.cols.map(lum));
      const C = spread(s.cols.map(chroma));
      const bare = s.bare / s.n;
      assert(L.sd / L.mean > 0.18,
        `${name}: albedo luminance varies by only ${(L.sd / L.mean * 100).toFixed(1)}% over the whole map`);
      assert(C.sd > 0.035,
        `${name}: chroma varies by only ${C.sd.toFixed(3)} — one hue at several brightnesses`);
      assert(bare < 0.22,
        `${name}: ${(bare * 100).toFixed(0)}% of the ground is the bare base coat with nothing layered on it`);
      lines.push(`${name} ${(L.sd / L.mean * 100).toFixed(0)}%/±${C.sd.toFixed(3)} bare ${(bare * 100).toFixed(0)}%`);
    }
    return lines.join('  ');
  });

  check('terrain: grain sorting reaches the flat ground, not just the steep bits', () => {
    // Slope-gated layers cannot touch a dune sea: the windward face of a dune
    // is 10-15°, which is 1-cos 0.03, well under any rock or grit band. The
    // 100-metre lag/sheet patchwork is the layer that has to carry it.
    // Measured against the LOOSE ground only — the arena is four fifths cliff
    // by area and sand does not sort itself on a rock face.
    const out = [], bad = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const loose = Math.max(1, s.n - s.layers.rock);
      const lag = s.layers.lag / loose, sheet = s.layers.sheet / loose;
      // the arena is the floor of the distribution: its fighting floor is a
      // dish, and lag is a convex-ground phenomenon that a dish suppresses
      if (lag < 0.075) bad.push(`${name} lag ${(lag * 100).toFixed(1)}%`);
      if (sheet < 0.10) bad.push(`${name} sheet ${(sheet * 100).toFixed(1)}%`);
      out.push(`${name} lag ${(lag * 100).toFixed(0)}% sheet ${(sheet * 100).toFixed(0)}%`);
    }
    assert(bad.length === 0, `grain sorting barely reaches the loose ground: ${bad.join(', ')}`);
    return out.join('  ');
  });

  check('terrain: the lag and the sheet are different HUES, not the same one twice', () => {
    // Reusing grit and dust here is the trap: they are the same sand darker and
    // lighter, so a hundred metres of "variation" reads as a brightness ramp.
    const out = [];
    for (const name of OUTDOOR) {
      const u = terrainOf(name)._uniforms;
      const b = u.uBaseCol.value, l = u.uLagCol.value, s = u.uSheetCol.value;
      const cb = chroma([b.r, b.g, b.b]), cl = chroma([l.r, l.g, l.b]), cs = chroma([s.r, s.g, s.b]);
      assert(Math.abs(cl - cb) > 0.06 || Math.abs(cs - cb) > 0.06,
        `${name}: lag ${cl.toFixed(2)} and sheet ${cs.toFixed(2)} sit on the base's own chroma ${cb.toFixed(2)}`);
      // and they must still bracket it in value, or the patchwork has no read
      assert(lum([l.r, l.g, l.b]) < lum([b.r, b.g, b.b]),
        `${name}: the coarse lag is not darker than the sand it was winnowed from`);
      assert(lum([s.r, s.g, s.b]) > lum([b.r, b.g, b.b]),
        `${name}: the drift sheet is not paler than the sand that blew into it`);
      out.push(`${name} ${cb.toFixed(2)} → lag ${cl.toFixed(2)} / sheet ${cs.toFixed(2)}`);
    }
    return out.join('  ');
  });

  check('terrain: hollows and enclosed ground see less sky than crests do', () => {
    // The ground had no occlusion term at all. Under a hemisphere plus a probe
    // that is a billiard table: every dune trough and every gully received
    // exactly as much indirect light as the brink above it.
    const src = TERRAIN_SRC();
    assert(/reflectedLight\.indirectDiffuse \*= terAO/.test(src),
      'nothing applies an occlusion term to the indirect light');
    assert(src.includes("replace('#include <aomap_fragment>'"),
      'the occlusion term is computed but never spliced into the shader');
    const out = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const A = spread(s.ao);
      assert(A.mean < 0.96, `${name}: mean landform occlusion is ${A.mean.toFixed(3)} — effectively none`);
      assert(A.mean > 0.72, `${name}: mean landform occlusion is ${A.mean.toFixed(3)} — the ground is being crushed`);
      assert(A.sd > 0.05, `${name}: occlusion varies by only ${A.sd.toFixed(3)}, so it adds no form`);
      out.push(`${name} ${A.mean.toFixed(2)}±${A.sd.toFixed(2)}`);
    }
    return out.join('  ');
  });

  check('terrain: a ground base map is a GAIN of one, not a colour', () => {
    /* The invariant that lets a preset author its ground as a hex.
     *
     * Terrain composes the surface as `col = uBaseCol … ; col *= A + baseLum·B`
     * with baseLum the base map's own mean of R, G and B — so the map decides
     * whether the level's authored colour arrives intact, and a base map at any
     * other mean silently re-lights every level built on it. Sand lands on 1.0
     * by being a real 0.389 albedo. Soil and snow are calibrated onto the same
     * number ON PURPOSE, and this is where that is enforced: a "physically
     * honest" 0.10 soil would have delivered the meadow at 0.67× its authored
     * green with nothing anywhere saying why, and a 0.75 snow at 1.41×.
     *
     * Both constants are read out of the shader rather than written here, so
     * the check cannot drift away from the thing it is checking. */
    const src = TERRAIN_SRC();
    const gm = src.match(/col \*= ([\d.]+) \+ baseLum \* ([\d.]+);/);
    assert(gm, 'the base map is no longer applied as a gain around 1.0');
    const [, A, B] = gm.map(Number);
    const fm = src.match(/float baseLum = mix\(([\d.]+), dot\(baseC/);
    assert(fm, 'baseLum no longer falls back to a constant on smooth ground');
    const fallback = Number(fm[1]);

    /* AND THE MAP A PRESET ASKS FOR IS THE MAP IT GETS. _mapSet() resolves the
     * `maps` key through a switch with a default, so a key it does not know
     * falls through to sand and the level renders on the wrong surface with no
     * error anywhere — which is exactly what a green level did before soil
     * existed, and what any future 'ash' or 'mud' preset would do the moment
     * somebody added the key and forgot the case. Identity on the baked image,
     * because the texture objects differ per tiling and the bake does not. */
    const BUILD = { sand: sandMaps, soil: soilMaps, snow: snowMaps, deck: duracreteMaps };
    for (const name of PRESETS) {
      const want = BUILD[TERRAIN_PRESETS[name].maps];
      assert(want, `${name}: '${TERRAIN_PRESETS[name].maps}' is not a known base surface`);
      assert(terrainOf(name)._uniforms.uBaseAlb.value.image === want(1).map.image,
        `${name} asks for '${TERRAIN_PRESETS[name].maps}' and is rendering on a different surface`);
    }

    const rows = [];
    for (const [map, presets] of [['sand', ['dunes', 'arena', 'canyon', 'drifts']],
                                  ['soil', ['meadow']], ['snow', ['alpine']]]) {
      const mean = baseMapMean(map);
      const gain = A + mean * B;
      near(gain, 1.0, 0.06, `${map} is a ${gain.toFixed(3)}× gain, so ${presets.join('/')} do not render the colour they authored`);
      /* And the SMOOTH ground has to match the textured ground. baseLum lerps
       * toward this constant wherever the surface is barely rippled, so a map
       * whose mean is not it puts a visible step between a rippled patch and a
       * smooth one — on the same level, in the same light. */
      near(mean, fallback, 0.02,
        `${map} averages ${mean.toFixed(3)} but the shader falls back to ${fallback} on smooth ground`);
      rows.push(`${map} ${mean.toFixed(3)} → ×${gain.toFixed(3)}`);
    }
    /* The deck is NOT held to this and it is the one that misses. duracrete
     * means 0.313, so the hangar's floor renders at 0.910× the colour the
     * preset asks for and its smooth patches read 24% brighter than its
     * textured ones. Recorded rather than asserted: the fix is either to
     * recalibrate duracrete — which re-lights every wall and plinth that tints
     * against MEAN_ALBEDO.duracrete — or to brighten the hangar's own swatch,
     * and both of those are somebody else's level. */
    const deck = baseMapMean('duracrete');
    rows.push(`deck ${deck.toFixed(3)} → ×${(A + deck * B).toFixed(3)} (known, unasserted)`);
    return rows.join('  ');
  });

  check('terrain: the two new ground maps obey the foundry\'s own three rules', () => {
    /* tools/checks/materials.mjs holds every surface in the game to these, over
     * a hardcoded SURFACES list that does not know soil and snow exist. Rather
     * than let two maps into the game with nobody measuring them, the same three
     * rules are restated here on the two the terrain added — and they are the
     * three this foundry has actually broken before, not a wish list:
     *
     *  1. IT WRAPS. Every primitive takes an explicit lattice period; combine
     *     two periodic pieces aperiodically (a cellular field scaled by 1.3, a
     *     per-band hash whose index gains 4 across the tile) and there is a hard
     *     line down every tile boundary. Measured as the wrap edge against the
     *     strongest interior edge and against the median one.
     *  2. NOTHING BELOW ~8 CYCLES. A soft blob at 4-6 cycles IS the repeat: the
     *     eye reads the blob, not the grain, and the tiling becomes a grid.
     *  3. THERE IS GRAIN, AND IT IS NOT NOISE. A map with no one-texel energy
     *     is a blur (rock once measured 0.004 rms against an 0.020 spread); a
     *     map whose one-texel rms IS its spread is white noise at Nyquist and
     *     shimmers when you move.
     */
    const rows = [];
    for (const name of ['soil', 'snow']) {
      const m = rawMaps(name), S = m.size, N = S * S;
      assert(m && m.albedo.length === N * 4, `${name} baked no pixels`);

      // 1 — the wrap, on albedo, normal and roughness
      let worstMax = 0, worstMed = 0;
      for (const [buf, ch] of [[m.albedo, 0], [m.normal, 0], [m.rough, 1]]) {
        const col = new Float64Array(S), row = new Float64Array(S);
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const i = (y * S + x) * 4 + ch;
            col[x] += Math.abs(buf[i] - buf[(y * S + (x + 1) % S) * 4 + ch]) / S;
            row[y] += Math.abs(buf[i] - buf[(((y + 1) % S) * S + x) * 4 + ch]) / S;
          }
        }
        for (const arr of [col, row]) {
          const wrap = arr[arr.length - 1];
          let hi = 0;
          for (let i = 0; i < arr.length - 1; i++) if (arr[i] > hi) hi = arr[i];
          const sorted = Float64Array.from(arr).sort();
          worstMax = Math.max(worstMax, wrap / Math.max(1e-6, hi));
          worstMed = Math.max(worstMed, wrap / Math.max(1e-6, sorted[arr.length >> 1]));
        }
      }
      assert(worstMax < 1.25, `${name}: the wrap steps ${worstMax.toFixed(2)}× the strongest edge inside the map`);
      assert(worstMed < 4.0, `${name}: the wrap steps ${worstMed.toFixed(2)}× the median edge`);

      // 2 — energy at 4 cycles must be under the energy at 16, and small
      const band = (blocks) => {
        const b = S / blocks, acc = new Float64Array(blocks * blocks);
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) acc[((y / b) | 0) * blocks + ((x / b) | 0)] += toLin8(m.albedo[(y * S + x) * 4 + 1]);
        }
        let mu = 0; for (const v of acc) mu += v / (b * b);
        mu /= acc.length;
        let sd = 0; for (const v of acc) sd += (v / (b * b) - mu) ** 2;
        return Math.sqrt(sd / acc.length) / Math.max(1e-9, mu);
      };
      const coarse = band(4), fine = band(16);
      assert(coarse < fine, `${name} has more energy at 4 cycles (${coarse.toFixed(4)}) than at 16 — that reads as a repeating blob`);
      assert(coarse < 0.05, `${name} carries a ${(coarse * 100).toFixed(1)}% swing at 4 cycles; the tile will be visible`);

      // 3 — grain, and a normal that is not a flat card
      const L = new Float64Array(N);
      let lm = 0;
      for (let i = 0; i < N; i++) {
        L[i] = (toLin8(m.albedo[i * 4]) + toLin8(m.albedo[i * 4 + 1]) + toLin8(m.albedo[i * 4 + 2])) / 3;
        lm += L[i];
      }
      lm /= N;
      let lv = 0, hi = 0, tilt = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = y * S + x;
          lv += (L[i] - lm) ** 2;
          hi += (L[i] - L[y * S + ((x + 1) % S)]) ** 2;
          const nz = m.normal[i * 4 + 2] / 255 * 2 - 1;
          tilt += Math.acos(Math.min(1, Math.max(-1, nz))) * 180 / Math.PI;
        }
      }
      const lsd = Math.sqrt(lv / N), micro = Math.sqrt(hi / N), alias = micro / lsd;
      assert(alias > 0.15, `${name} has no texel-scale grain (rms ${micro.toFixed(4)} vs sd ${lsd.toFixed(4)})`);
      assert(alias < 0.90, `${name} is aliased noise (rms ${micro.toFixed(4)} vs sd ${lsd.toFixed(4)})`);
      assert(tilt / N > 4, `${name} normal map is flat: ${(tilt / N).toFixed(1)}° mean tilt`);
      rows.push(`${name} wrap ${worstMax.toFixed(2)}×peak/${worstMed.toFixed(1)}×med, `
        + `4-cycle ${(coarse * 100).toFixed(2)}%, grain ${(alias * 100).toFixed(0)}%, tilt ${(tilt / N).toFixed(1)}°`);
    }
    return rows.join('; ');
  });

  check('terrain: snow is the brightest ground in the game, and the grade survives it', () => {
    /* WHAT THE EXPOSURE METER ACTUALLY KNOWS, and why a white ground is a real
     * problem rather than an imagined one.
     *
     * atmosphereMeter keys off IRRADIANCE alone: key = E·0.18/π, i.e. it
     * assumes an 18% grey world. Nothing about the ground reaches it. So for a
     * flat, fully lit patch the linear value that arrives at ACES is
     *
     *     albedo/π · E · exposure  =  albedo · bias · KEY / 0.18
     *
     * with E cancelling out completely — the atmosphere does not appear. That
     * identity is verified below against the three shipped levels before it is
     * used, because it is the whole basis of the measurement and it is only
     * true while the meter's own clamp is off it.
     *
     * The consequence: a level cannot fix a white ground with weather. Snow's
     * albedo goes straight into the curve, and at real snow's 0.8-0.9 the
     * ground lands on top of the shoulder with nothing above it — which is not
     * "bright", it is FLAT, because the drift crest and the drift trough both
     * clip to the same white. The alpine preset therefore authors settled snow
     * dark (0.53 linear) and this holds it there.
     *
     * Everything is measured through the real ACES + grade, because clipping is
     * a display quantity; measured in linear radiance it does not exist. */
    const KEY = Number((ENGINE_SRC().match(/^const KEY = ([\d.]+);/m) || [])[1]);
    assert(KEY > 0, 'Engine no longer states the key it exposes for');

    /*
     * The identity, on the levels it is an identity FOR — and asked rather than
     * named, twice over, because both vocabularies here have moved.
     *
     * The list used to be three literal level keys, two of which have since been
     * deleted; note also that OUTDOOR above is a list of TERRAIN PRESETS, a
     * different vocabulary that happens to share several spellings. But
     * "every level with an atmosphere" is too wide, and wrong in an
     * instructive way: the identity is the OUTDOOR branch of atmosphereMeter,
     * where exposure = bias·KEY/key and key = E·0.18/π, so E cancels. The
     * indoor branch does not meter at all — it returns bias·EXPOSURE flat,
     * because an interior is lit by lamps the atmosphere cannot see — and
     * against that the identity is out by up to 82% on the deeps. That is not
     * a fault in the grade; it is the check asking a question the indoor path
     * never claimed to answer. So the loop asks the meter which branch it took
     * rather than deciding for it.
     */
    const drift = [];
    let metered = 0;
    for (const name of LEVEL_ORDER.filter((k) => LEVELS[k]?.atmosphere)) {
      const A = LEVELS[name].atmosphere;
      const m = atmosphereMeter(A);
      if (!m.outdoor) continue;
      metered++;
      assert(m.exposure > 0.2001 && m.exposure < 2.9999, `${name}: the exposure meter is on its clamp`);
      const direct = (m.irradiance / Math.PI) * m.exposure;      // a 1.0 albedo ground
      const identity = (A.exposure ?? 1.05) * KEY / 0.18;
      drift.push(Math.abs(direct - identity) / identity);
    }
    assert(metered >= 3, `only ${metered} metered levels to verify the identity against`);
    assert(Math.max(...drift) < 0.02,
      `the exposure identity is out by ${(Math.max(...drift) * 100).toFixed(1)}% — the measurement below is measuring nothing`);

    // ONE authored bias, used for every level here so the numbers compare. A
    // level is free to bias its own, and that moves every row by the same
    // factor. It used to be read off the dune sea, which no longer exists; the
    // erg carries the same 0.86 and is the same kind of place, so not a digit
    // in any row below moves.
    const BIAS = LEVELS.drifts.atmosphere.exposure;
    const K = BIAS * KEY / 0.18;
    const disp = (c, k = 1) => LUMT(throughTone([c[0] * K * k, c[1] * K * k, c[2] * K * k]));
    const rows = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const P = TERRAIN_PRESETS[name];
      const swatch = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
      const base = swatch(P.sandColor), sheet = swatch(P.sheetColor ?? P.dustColor ?? P.sandColor);

      /* THE MEAN, on the ground you actually walk on. Taken over the LOOSE
       * surface only: the alpine is a third rock by area and averaging a
       * snowfield together with a cliff hides the snowfield. */
      let ls = 0, ln = 0;
      for (let i = 0; i < s.cols.length; i++) {
        if (s.rock[i] > 0.35) continue;
        ls += disp(s.cols[i]); ln++;
      }
      const loose = ls / Math.max(1, ln);

      /* WHAT A 15% CHANGE OF ALBEDO IS WORTH ON SCREEN, at the level this
       * ground sits at. This is the number the whole check exists for, and it
       * is not "does it clip": ACES has a shoulder, not a wall, so nothing ever
       * reaches 1.0 and a clipping test on a snowfield reports 0.0% while the
       * snowfield is completely flat. What actually happens on the shoulder is
       * that the material's layers stop being tellable apart. Measured through
       * the real curve at this bias: a desert ground gets 0.049-0.051 of display
       * for a 15% albedo step; REAL fresh snow at 0.90 albedo gets 0.018, a
       * third of that, and the drift crest and the drift trough arrive at the
       * same white however much work the shader did on them. */
      const modul = disp(base, 1.15) - disp(base);
      /* And the same failure stated over the two layers that cover most of the
       * ground: the base coat and the pale sheet riding on it. */
      const sep = Math.abs(disp(sheet) - disp(base));

      assert(loose < 0.88,
        `${name}: the loose ground displays at ${loose.toFixed(3)} mean luminance — nothing can be lit on top of that`);
      assert(modul > 0.025,
        `${name}: a 15% change in albedo is worth ${modul.toFixed(3)} of display — the ground is on the shoulder and its layers have merged`);
      assert(sep > 0.06,
        `${name}: the base coat and the drift sheet display ${sep.toFixed(3)} apart — the material's two biggest layers are one colour on screen`);
      rows.push(`${name} base ${lum(base).toFixed(2)}→${disp(base).toFixed(3)} loose ${loose.toFixed(3)} `
        + `mod ${modul.toFixed(3)} sep ${sep.toFixed(3)}`);
    }
    return rows.join('; ') + ` (bias ${BIAS}, KEY ${KEY}; real snow at 0.90 albedo measures mod 0.018)`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Ripples                                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: ripples run across the level\'s own wind, one field, not two', () => {
    // Two taps of the sand map at unrelated rotations, blended by whichever is
    // brighter, is a max() of two lattices — the dune sea came out as woven
    // matting. Both frames now sit within a few degrees of the wind axis.
    const src = TERRAIN_SRC();
    assert(!/const mat2 TB_A/.test(src) && !/const mat2 TB_D/.test(src),
      'the sand still samples through hard-coded rotations unrelated to the wind');
    const out = [];
    for (const name of PRESETS) {
      const t = terrainOf(name);
      const w = t.preset.wind || [1, 0];
      const wl = Math.hypot(w[0], w[1]);
      const rip = t._uniforms.uRip.value;
      near(rip.x, w[0] / wl, 1e-5, `${name}: the ripple axis does not follow the wind`);
      near(rip.y, w[1] / wl, 1e-5, `${name}: the ripple axis does not follow the wind`);
      near(Math.hypot(rip.x, rip.y), 1, 1e-5, `${name}: the ripple frame is not a rotation`);
      out.push(`${name} ${(Math.atan2(rip.y, rip.x) * 180 / Math.PI).toFixed(0)}°`);
    }
    /* Every frame that samples the sand map must stay near-parallel to every
     * other one; that is the whole point. There are two halves to it now:
     *
     *   · the FIXED offset each layer carries, which is the angle between them
     *     when the field is running straight, and
     *   · the FLOW, which turns the whole field off the wind as it crosses the
     *     ground. That part is shared — one TER_SWING, one noise — so it moves
     *     every layer together and cancels out of the angle BETWEEN them. A
     *     layer with its own swing coefficient would be free to open a
     *     cross-hatch anywhere the two noises disagreed, which is the failure
     *     this check was written for. */
    const swing = src.match(/const float TER_SWING\s*=\s*([\d.]+)/);
    assert(swing, 'the shared ripple swing is gone — every layer can turn on its own again');
    const S = parseFloat(swing[1]);
    assert(S < 0.70, `the flow turns the field ${(S * 90 / Math.PI).toFixed(0)}° off the wind at its worst`);
    const flows = src.match(/dFlowA \* TER_SWING|flowA \* TER_SWING/g) || [];
    assert(flows.length >= 2, 'a sand layer no longer rides the shared flow');
    const angs = [...src.matchAll(/tswing\(uRip\.xy,\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
    assert(angs.length >= 2, 'the second ripple frame is gone');
    for (const v of angs) {
      assert(Math.abs(v) < 0.45,
        `a ripple frame sits ${(Math.abs(v) * 180 / Math.PI).toFixed(0)}° off the field — that is a cross-hatch`);
    }
    const spread = Math.max(...angs, 0) - Math.min(...angs, 0);
    assert(spread < 0.60,
      `the sand layers open ${(spread * 180 / Math.PI).toFixed(0)}° between them — that is a lattice, not a field`);
    return `${out.join('  ')}  swing ±${(S * 90 / Math.PI).toFixed(0)}° shared, ` +
      `layers ${(spread * 180 / Math.PI).toFixed(0)}° apart`;
  });

  check('terrain: the crest bend is a displacement, never a spin of the frame', () => {
    // Rotating the sampling frame by a noise is the obvious way to curve a
    // ripple field, and it is wrong: UV = R(θ(p))·p has a Jacobian term of
    // |p|·∇θ, so 150 m out from the origin the tile is sheared into a swirl
    // with a visible eye in the middle of it. Measured on the dune sea.
    const src = TERRAIN_SRC();
    assert(/pA\.x \+= bend/.test(src), 'the ripple bend is not applied as a displacement');
    assert(!/tswing\(uRip\.xy,\s*swing/.test(src), 'the ripple frame is still spun per pixel');

    // and prove the bound: how far apart do two frames 1 m apart map a point
    // 150 m from the origin? A displacement moves it by the bend gain; a spin
    // moves it by |p| times the angle.
    const t = terrainOf('dunes');
    const gain = t._uniforms.uRip.value.z;
    const spinLike = 150 * 0.85 * (1 / 9);       // what the rotating version did
    assert(gain < 2.0, `the bend gain is ${gain} m — that is not a bend, it is a smear`);
    assert(gain < spinLike * 0.2,
      `the bend moves the tile ${gain.toFixed(2)} m/m against the spin's ${spinLike.toFixed(1)} m/m at 150 m out`);
    return `bend ${gain.toFixed(2)} m, flat in |p|; the spin was ${spinLike.toFixed(1)} m at 150 m`;
  });

  check('terrain: ripple crests are longer than they are wide, and die where sand is not blown', () => {
    const src = TERRAIN_SRC();
    /* REWRITTEN AGAINST THE MAP, not just the uniform. The old form asserted
     * the frame stretch on three named presets and the absence of it on the
     * deck, which pinned half of the property: the stretch exists to pull the
     * BASE MAP's two ripple trains onto one bearing, so it is only meaningful
     * if the base map has trains in it, and it is actively wrong on a base map
     * that does not. A soil map sampled through a 0.42 frame is a meadow with
     * its crumb combed into corduroy, and nothing in the uniform would say so.
     *
     * So the ground is split by what its base MAP is, and the map's own
     * directionality is measured rather than assumed. */
    const COMB = { sand: true, snow: true, soil: false, deck: false };
    const rows = [];
    for (const name of PRESETS) {
      const P = TERRAIN_PRESETS[name];
      const a = terrainOf(name)._uniforms.uRipAspect.value;
      const combed = COMB[P.maps];
      assert(combed !== undefined, `${name}: '${P.maps}' is not a known base surface`);
      if (combed) {
        assert(a > 0.2 && a < 0.75,
          `${name}: the ripple frame aspect is ${a} — 1.0 is the lattice, 0 is a smear`);
      } else {
        // a poured deck is not blown by anything, and neither is a meadow
        near(a, 1.0, 1e-6, `${name}: ground that no wind worked is being combed by one`);
      }
      rows.push(`${name} ${a}`);
    }
    /* And the map behind it. Coherence of the gradient structure tensor at the
     * feature scale: a wind-worked surface is one train of crests and measures
     * high; soil is crumb and measures low however hard you look. The two must
     * not be within reach of each other, or "this ground is not combed" is a
     * claim about a uniform rather than about anything on screen. */
    const dirn = {};
    for (const m of ['sand', 'snow', 'soil']) dirn[m] = anisotropy(m);
    assert(dirn.sand > 0.45, `the sand map has no ripple train in it: coherence ${dirn.sand.toFixed(2)}`);
    assert(dirn.snow > 0.45, `the snow map has no sastrugi in it: coherence ${dirn.snow.toFixed(2)}`);
    assert(dirn.soil < 0.30, `the soil map is combed: coherence ${dirn.soil.toFixed(2)}`);
    assert(dirn.soil < dirn.snow * 0.5,
      `soil at ${dirn.soil.toFixed(2)} is as directional as the wind-carved snow at ${dirn.snow.toFixed(2)}`);
    // and wet sand is packed flat
    assert(/1\.0 - wet \* 0\.8/.test(src) || /\(1\.0 - wet/.test(src),
      'the river bed is still covered in wind ripples');
    // the canyon is worked by water, the dune sea by wind
    const gain = (n) => terrainOf(n)._uniforms.uRip.value.w;
    assert(gain('canyon') < gain('dunes') * 0.7, 'a river wash ripples as hard as a dune sea');
    // a storm-driven erg combs harder than the dune sea, a meadow barely at all
    assert(gain('drifts') > gain('dunes'), 'a sandstorm erg is combed no harder than a breeze');
    assert(gain('meadow') < gain('dunes') * 0.4,
      `the meadow ripples at ${gain('meadow')} against the dune sea's ${gain('dunes')}`);
    /* …and NOT at zero, which is the trap this number sets. uRip.w scales the
     * whole base normal, so a meadow "with no ripples" at 0.0 is a meadow with
     * no surface relief of any kind: a painted plane that lights only by the
     * mesh normal. The anisotropy is what had to go, not the relief. */
    assert(gain('meadow') > 0.15, 'the meadow has no base relief left at all — that is a painted plane');
    return `aspect ${rows.join(' ')}; gain dunes ${gain('dunes')} / drifts ${gain('drifts')} / `
      + `canyon ${gain('canyon')} / meadow ${gain('meadow')}; map coherence sand ${dirn.sand.toFixed(2)} `
      + `snow ${dirn.snow.toFixed(2)} soil ${dirn.soil.toFixed(2)}`;
  });

  check('terrain: rock reads as jointed stone, not as tooled leather', () => {
    // The rock map's fracture network is 11 cells across a tile. At 0.115
    // tiles/m that is 79 cm blocks, and at a normal scale of 1.35 — a 53° tilt
    // on a unit normal — every joint came out as a rope lying on the cliff.
    const u = terrainOf('canyon')._uniforms;
    const tile = 1 / u.uScales.value.z;
    const block = tile / 11;
    assert(block < 0.65, `the rock joint spacing is ${block.toFixed(2)} m — that is masonry, not fracture`);
    assert(u.uNrmScale.value.z < 0.95,
      `the rock normal is scaled ${u.uNrmScale.value.z} — the joints stand off the face`);
    const src = TERRAIN_SRC();
    // beds must differ from each other more than the rock inside one bed does
    const bed = src.match(/\(0\.(\d+) \+ bandR \* 0\.(\d+)\)/);
    assert(bed, 'the strata band tint is gone');
    const [, lo, sw] = bed;
    assert(Number('0.' + sw) > Number('0.' + lo) * 0.6,
      'the bedding contrast is weaker than the block-to-block contrast — that is cork');
    return `${tile.toFixed(1)} m tile, ${(block * 100).toFixed(0)} cm joints, normal ×${u.uNrmScale.value.z}`;
  });

  check('terrain: a cliff face is textured along its bedding, not across it', () => {
    const src = TERRAIN_SRC();
    const m = src.match(/vec2 vuv = vec2\(dot\(wp, tang\) \* ([\d.]+), vWPos\.y \* ([\d.]+)\)/);
    assert(m, 'the cliff re-projection no longer stretches its rock along strike');
    const [, h, v] = m.map(Number);
    assert(v / h > 1.8, `the cliff texture is ${(v / h).toFixed(2)}:1 — isotropic worms on a bedded wall`);
    return `${(v / h).toFixed(1)}:1 along strike`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Landform                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: a level that promises stone walls has stone on its walls', () => {
    // Slope alone cannot find the wall of a BENCHED landform: strata put most
    // of its area on near-flat treads and only the thin risers are steep. The
    // arena's blurb says "a bowl of sand ringed by stone" and its rim rises
    // 27 m over 56 — 1-cos 0.11, under the old rock band — so the amphitheatre
    // came out as pale sand cloth with pencil lines drawn on it.
    const t = terrainOf('arena');
    const B = t._uniforms.uBands.value, RU = t._uniforms.uRockUp.value;
    const n = new THREE.Vector3();
    const R = t.res;
    let rocky = 0, wall = 0, floorRock = 0, floor = 0;
    for (let j = 2; j < R - 2; j += 2) {
      for (let i = 2; i < R - 2; i += 2) {
        const x = -t.half + i * t.step, z = -t.half + j * t.step;
        const y = t.heights[j * R + i];
        t._vertexNormal(i, j, n);
        const slope = 1 - clamp(n.y, 0, 1);
        const w = smoothstep(B.x, B.y, slope + smoothstep(RU.y, RU.z, y) * RU.x);
        const d = Math.hypot(x, z);
        if (d > 90 && y > 12) { wall++; if (w > 0.5) rocky++; }
        else if (d < 55) { floor++; floorRock += w; }
      }
    }
    assert(wall > 200 && floor > 200, 'the arena has no rim or no floor to test');
    assert(rocky / wall > 0.85,
      `only ${(rocky / wall * 100).toFixed(0)}% of the amphitheatre rim is stone`);
    // and the thing you fight on is still sand, or the whole level is a quarry
    assert(floorRock / floor < 0.03,
      `${(floorRock / floor * 100).toFixed(0)}% of the fighting floor turned to rock`);
    return `rim ${(rocky / wall * 100).toFixed(0)}% stone, floor ${(floorRock / floor * 100).toFixed(1)}%`;
  });

  check('terrain: the canyon wash you fight in is gravel, not cliff', () => {
    // The other half of the same lever. Rock-with-height has to leave the
    // valley floor alone: the wash is where the fight happens and it is a
    // braided gravel bar, not a rock face.
    const t = terrainOf('canyon');
    const B = t._uniforms.uBands.value, RU = t._uniforms.uRockUp.value;
    const n = new THREE.Vector3();
    const R = t.res;
    let washRock = 0, wash = 0, wallRock = 0, walls = 0;
    for (let j = 2; j < R - 2; j += 2) {
      for (let i = 2; i < R - 2; i += 2) {
        const y = t.heights[j * R + i];
        t._vertexNormal(i, j, n);
        const slope = 1 - clamp(n.y, 0, 1);
        const w = smoothstep(B.x, B.y, slope + smoothstep(RU.y, RU.z, y) * RU.x);
        if (y < 2.5) { wash++; washRock += w; }
        else if (slope > 0.25) { walls++; wallRock += w; }
      }
    }
    assert(wash > 200 && walls > 200, 'the canyon has no wash or no walls to test');
    assert(washRock / wash < 0.15, `${(washRock / wash * 100).toFixed(0)}% of the wash floor is rock`);
    assert(wallRock / walls > 0.9, `only ${(wallRock / walls * 100).toFixed(0)}% of the walls are rock`);
    return `wash ${(washRock / wash * 100).toFixed(0)}% rock, walls ${(wallRock / walls * 100).toFixed(0)}%`;
  });

  check('terrain: snow lies on the shallow ground and slides off the steep faces', () => {
    /* The alpine's whole material idea, and it is not a new mechanism: it is
     * the canyon's rock band and the arena's rock-with-height run the other way
     * round. What is loose here is SNOW, so the same lever that keeps the wash
     * gravelly and the rim stony keeps the benches white and the buttresses
     * bare — a snowfield is exactly a rock face with a slope threshold on it.
     *
     * Both halves have to hold or the level is one material: all snow and the
     * mountain is a dust sheet, all rock and there is no snow in the blizzard.
     */
    const t = terrainOf('alpine');
    const B = t._uniforms.uBands.value, RU = t._uniforms.uRockUp.value;
    const n = new THREE.Vector3();
    const R = t.res;
    let flat = 0, flatRock = 0, steep = 0, steepRock = 0, mid = 0, midRock = 0;
    for (let j = 2; j < R - 2; j += 2) {
      for (let i = 2; i < R - 2; i += 2) {
        const y = t.heights[j * R + i];
        t._vertexNormal(i, j, n);
        const slope = 1 - clamp(n.y, 0, 1);
        const w = smoothstep(B.x, B.y, slope + smoothstep(RU.y, RU.z, y) * RU.x);
        if (slope < 0.034) { flat++; flatRock += w; }          // under 15°
        else if (slope > 0.293) { steep++; steepRock += w; }   // over 45°
        else { mid++; midRock += w; }
      }
    }
    assert(flat > 200 && steep > 200, 'the alpine has no shallow ground or no steep faces to test');
    assert(flatRock / flat < 0.25,
      `${(flatRock / flat * 100).toFixed(0)}% of the shallow ground is bare rock — the snow is not lying anywhere`);
    assert(steepRock / steep > 0.85,
      `only ${(steepRock / steep * 100).toFixed(0)}% of the 45° faces shed their snow`);
    /* And the preset's own rockAt has to say the same thing the material does.
     * It is the JS twin of that band — the surface keyword, the footstep and
     * the particle tint are all supposed to agree with what you can see — and a
     * twin that crosses over at a different slope is worse than no twin. */
    const cross = (f) => {   // the slope at which a 0..1 mask passes a half
      let lo = 0, hi = 1;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (f(m) < 0.5) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    // every preset that has loose ground; the hangar is exempt because
    // surfaceAt() short-circuits a `flat` deck to 'metal' before either of
    // these is consulted
    for (const name of PRESETS.filter((n) => !TERRAIN_PRESETS[n].flat)) {
      const p = TERRAIN_PRESETS[name], u = terrainOf(name)._uniforms.uBands.value;
      const jsCross = cross((s) => p.rockAt(0, 0, s));
      const glCross = cross((s) => smoothstep(u.x, u.y, s));
      assert(Math.abs(jsCross - glCross) < 0.06,
        `${name}: rockAt turns to stone at slope ${jsCross.toFixed(2)} and the material at ${glCross.toFixed(2)}`);
    }
    return `flat ${(flatRock / flat * 100).toFixed(0)}% rock, 15-45° ${(midRock / mid * 100).toFixed(0)}%, `
      + `steep ${(steepRock / steep * 100).toFixed(0)}%`;
  });

  check('terrain: the ground publishes itself, so water and decals can find it', () => {
    const prev = ground.terrain;
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    assert(ground.terrain === t, 'a level with no grass leaves the broker with no heightfield');
    assert(ground.heightAt(0, 0) === t.height(0, 0), 'the broker is reading a different surface');
    t.dispose();
    assert(ground.terrain === null, 'the broker still points at a disposed heightfield');
    ground.terrain = prev;
    return 'published on construction, cleared on dispose';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Cover                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grass: the ground it grows out of knows it is covered', () => {
    // A field of blades standing on bright bare sand reads as green spikes
    // stuck into a beach however many you spend, because the eye takes its
    // reading of "cover" from the ground TONE. This is half the fix and it
    // costs one lerp.
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    near(t._uniforms.uCover.value.x, 0, 1e-6, 'bare ground starts out covered');
    const g = new GrassField(new THREE.Scene(), t, {
      count: 400, density: 1, tintA: 0x8a9a58, tintB: 0x4d5c2e,
    });
    const amt = t._uniforms.uCover.value.x;
    assert(amt > 0.25, `a full-density grass field only tints the ground by ${amt.toFixed(2)}`);
    const c = t._uniforms.uCoverCol.value;
    // litter is what green rots into: darker than the blade and not green
    assert(lum([c.r, c.g, c.b]) < lum([g.tintB.r, g.tintB.g, g.tintB.b]),
      'the litter under the grass is brighter than the grass');
    assert(c.g < g.tintB.g, 'the ground under the grass is as green as the grass');
    g.dispose();
    near(t._uniforms.uCover.value.x, 0, 1e-6, 'the cover tint outlived the field that asked for it');
    t.dispose();
    return `cover ${amt.toFixed(2)}, litter #${c.getHexString()}`;
  });

  check('grass: every tuft prints a contact shadow on the ground under it', () => {
    /* NOTHING IN THE FRAME TOUCHED THE GROUND, and it was named the loudest
     * "assembled rather than lit" signal in the whole picture. Measured on a
     * dune tuft, the sand 5 px from a blade base against the sand 40 px away:
     * 1.6% apart. The whole field stood on sand of exactly its own value right
     * up to each blade.
     *
     * Grass cannot go in the shadow map — ten thousand alpha-tested blades is
     * the most expensive thing that could be in a depth pass, and the cascade
     * starts further out than the field goes — so the contact is baked as one
     * multiplied quad per TUFT. This pins the three things that make it a
     * contact rather than a smudge: it is DARK enough to read, it is LOCAL
     * enough to be a contact, and it lies ON the ground rather than through it.
     */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const scene = new THREE.Scene();
    const g = new GrassField(scene, t, { count: 6000, density: 1, radius: 46 });
    g.update(1 / 60, new THREE.Vector3(0, t.height(0, 0), 0), [], null);
    const report = [];
    /* Only the two rungs a contact can actually resolve on. Past the clump
     * ring a tuft is smaller than the pixel it lands in, so a stain under it
     * is a second draw call for something nobody can see — which is why the
     * rungs declare `shade` and this reads the declaration rather than
     * assuming every ring has one. */
    const shaded = g.rings.filter(r => r.shade);
    assert(shaded.length >= 2, `only ${shaded.length} LOD rungs print a contact at all`);
    assert(shaded.every((r, i) => r === g.rings[i]),
      'the rungs that print a contact are not the nearest ones');
    for (const ring of shaded) {
      const name = ring.tier.name;
      const sh = ring.shade;
      assert(sh && sh.mesh, `the ${name} ring has no contact shadows at all`);
      const S = sh.aShade.array, N = sh.aShadeN.array;
      let live = 0, dark = 0, rad = 0, worstOff = 0, worstTilt = 1;
      for (let i = 0; i < sh.tufts; i++) {
        if (S[i * 4 + 3] <= 1e-4 || N[i * 4 + 3] <= 1e-3) continue;
        live++;
        dark += N[i * 4 + 3];
        rad += S[i * 4 + 3];
        // on the ground, not floating over it or buried in it
        worstOff = Math.max(worstOff, Math.abs(S[i * 4 + 1] - t.height(S[i * 4], S[i * 4 + 2])));
        // and lying along it: the quad is built on this normal, so a flat one
        // on a 30° hillside would cut straight through the slope
        const n = t.normalAt(S[i * 4], S[i * 4 + 2], new THREE.Vector3());
        worstTilt = Math.min(worstTilt, n.x * N[i * 4] + n.y * N[i * 4 + 1] + n.z * N[i * 4 + 2]);
      }
      assert(live > sh.tufts * 0.4,
        `${name}: only ${live} of ${sh.tufts} tufts printed anything`);
      const mD = dark / live, mR = rad / live;
      // What the ground keeps directly under a clump, and 25 cm out. The
      // falloff is (1 - (d/R)^2)^2, ported from SHADE_FRAG.
      const keep = (d) => 1 - mD * Math.pow(Math.max(0, 1 - (d / mR) * (d / mR)), 2);
      assert(keep(0) < 0.62,
        `${name}: the ground under a tuft keeps ${(keep(0) * 100).toFixed(0)}% of its open value — ` +
        'that is not a contact, it is a smudge');
      // A disc wide enough to swallow the reference patch measures as no
      // gradient at all however dark it is — that is how the first attempt
      // came out at a 9.8% median on a metric that wanted 12%.
      assert(mR < 0.75,
        `${name}: the contact spreads ${mR.toFixed(2)} m from the tuft — a soft blob, not a contact`);
      assert(keep(mR * 1.02) > 0.999, `${name}: the contact does not end at its own radius`);
      assert(worstOff < 0.05, `${name}: a contact sits ${worstOff.toFixed(2)} m off the ground`);
      assert(worstTilt > 0.999, `${name}: a contact is not lying along the slope it is on`);
      report.push(`${name} ${live} tufts, ${(mD * 100).toFixed(0)}% at the base over ${mR.toFixed(2)} m ` +
        `(ground keeps ${(keep(0) * 100).toFixed(0)}% under it, ${(keep(mR * 0.6) * 100).toFixed(0)}% at 0.6R)`);
    }
    /* Stronger than the "minus four" this replaces, which was a count of the
     * meshes the field happened to build at the time: the scene it was given
     * held nothing but grass, so after dispose it must hold NOTHING, however
     * many rungs the ladder grows. */
    const before = scene.children.length;
    assert(before === g.meshes.length && before >= 6,
      `the field put ${before} meshes in the scene and tracks ${g.meshes.length}`);
    g.dispose(); t.dispose();
    assert(scene.children.length === 0,
      `the grass left ${scene.children.length} meshes behind on dispose`);
    return report.join('; ') + `; ${before} draw calls`;
  });

  check('grass: the cover reaches out to the range you can see, at a density that reads', () => {
    /* WHAT THIS REPLACES, and why the old form could pass on a field nobody
     * would call covered: it measured each ring against ITS OWN ground, so a
     * 46 m bubble scoring 19% and 313,600 m² of bare dunes outside it scored
     * 19%. Measured on the shipped build: the grass disc was 2.1% of the dune
     * sea's terrain, 3.1% of the arena's, and beyond 46 m there was no grass
     * at any quality on levels you can see 700 m across.
     *
     * So the bar is stated over BANDS, out to the reach, and the bands past
     * the near one are held to a lower plan-view figure ON PURPOSE — not as a
     * concession, but because plan view is the wrong projection out there. At
     * a hundred metres the ground is one degree below the horizon and a 0.4 m
     * tuft hides the twenty-three metres of ground behind it, so what the eye
     * gets is the GRAZING coverage, which is computed here too and held to a
     * real bar. Both are reported; only asserting the first is how a field can
     * measure "covered" and still show you bare ground to the horizon. */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const g = new GrassField(new THREE.Scene(), t, { count: 11000, density: 1, radius: 46 });
    g.update(1 / 60, new THREE.Vector3(0, t.height(0, 0), 0), [], null);

    const BANDS = [[0, 12, 0.22, 0], [12, 46, 0.10, 0], [46, 150, 0.015, 0.45], [150, 400, 0.002, 0.30]];
    const plan = BANDS.map(() => 0), graze = BANDS.map(() => 0);
    let live = 0, budget = 0;
    for (const ring of g.rings) {
      const a = ring.aInst.array, w = ring.mat.uniforms.uWidth.value;
      budget += ring.count;
      for (let i = 0; i < ring.count; i++) {
        const len = a[i * 4 + 3];
        if (len <= 0.004) continue;
        live++;
        const r = Math.hypot(a[i * 4], a[i * 4 + 2]);
        // the card shader widens with range: `widen = 0.55 + 0.95 * d/uFar`
        const widen = ring.card ? 0.55 + 0.95 * Math.min(1, r / ring.far) : 1;
        const wide = w * len * (ring.card ? 2.2 * widen : 1);
        const b = BANDS.findIndex(([lo, hi]) => r >= lo && r < hi);
        if (b < 0) continue;
        plan[b] += wide * len * (ring.card ? 1.0 : 0.62);
        // ground hidden behind it from eye height: len / tan(depression)
        graze[b] += wide * Math.min(60, len * Math.max(1, r) / 1.7);
      }
    }
    const rows = [];
    for (let b = 0; b < BANDS.length; b++) {
      const [lo, hi, wantPlan, wantGraze] = BANDS[b];
      const area = Math.PI * (hi * hi - lo * lo);
      const p = plan[b] / area, z = Math.min(1, graze[b] / area);
      assert(p > wantPlan,
        `${lo}-${hi} m: the silhouette covers ${(p * 100).toFixed(1)}% of the ground in plan, wanted ${(wantPlan * 100).toFixed(1)}%`);
      assert(z > wantGraze,
        `${lo}-${hi} m: only ${(z * 100).toFixed(0)}% of the ground is hidden behind cover from eye height`);
      rows.push(`${lo}-${hi}m ${(p * 100).toFixed(1)}%/${(z * 100).toFixed(0)}%`);
    }
    assert(live / budget > 0.55,
      `the field spends ${((1 - live / budget) * 100).toFixed(0)}% of its budget on instances that render as nothing`);
    assert(g.reach >= 300, `the cover stops at ${g.reach} m`);
    g.dispose(); t.dispose();
    return `plan/grazing by band: ${rows.join('  ')}; ${live}/${budget} instances live to ${g.reach} m`;
  });

  check('grass: a tuft stays where it is when you walk away and come back', () => {
    /* THE CORRECTNESS BUG UNDER THE ART ONE. The field this replaces re-rolled
     * every blade in the level off a module-global generator whenever the
     * centre moved more than 0.3 of its radius — 13.8 m of walking. Measured
     * on the shipped build, over a 4×4 m box of ground and a 40 m round trip:
     * 532 instances before, 407 after, ZERO of them the same one. Turn around
     * after fourteen paces and the tussock you just fought past was different
     * tussock.
     *
     * Placement is a hash of the cell's integer coordinate now, so this is a
     * property and not a tolerance: not "mostly the same", the SAME. */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const g = new GrassField(new THREE.Scene(), t, { count: 8000, density: 1, radius: 46 });
    const at = (x, z) => new THREE.Vector3(x, t.height(x, z), z);
    const snap = (bx, bz, br) => {
      const out = [];
      for (const ring of g.rings) {
        const a = ring.aInst.array, o = ring.aOrient.array;
        for (let i = 0; i < ring.count; i++) {
          if (a[i * 4 + 3] <= 0.004) continue;
          if (Math.abs(a[i * 4] - bx) > br || Math.abs(a[i * 4 + 2] - bz) > br) continue;
          out.push(`${ring.tier.name}|${a[i * 4].toFixed(4)}|${a[i * 4 + 2].toFixed(4)}`
            + `|${a[i * 4 + 3].toFixed(4)}|${o[i * 4 + 2].toFixed(4)}`);
        }
      }
      return out.sort();
    };
    g.update(1 / 60, at(0, 0), [], null);
    const boxes = [[5, 0, 2], [28, 6, 4], [110, -20, 10]];
    const before = boxes.map(([x, z, r]) => snap(x, z, r));
    assert(before[0].length > 40, `only ${before[0].length} instances near the spawn to compare`);
    assert(before[2].length > 0, 'nothing at all is planted 110 m out');
    // out to 240 m and back, in steps small enough to cross every tier's grid
    for (let d = 0; d <= 240; d += 3) g.update(1 / 60, at(d, 0), [], null);
    for (let d = 240; d >= 0; d -= 3) g.update(1 / 60, at(d, 0), [], null);
    const rows = [];
    for (let b = 0; b < boxes.length; b++) {
      const after = new Set(snap(...boxes[b]));
      const same = before[b].filter(s => after.has(s)).length;
      assert(same === before[b].length && after.size === before[b].length,
        `box at ${boxes[b][0]},${boxes[b][1]}: ${before[b].length} instances went out and `
        + `${after.size} came back, ${same} of them the same tuft in the same place`);
      rows.push(`${boxes[b][0]}m ${same}/${before[b].length}`);
    }
    // and a field built from scratch a second time must agree with the first,
    // or "the same place" only means "the same place this session"
    const h = new GrassField(new THREE.Scene(), t, { count: 8000, density: 1, radius: 46 });
    h.update(1 / 60, at(0, 0), [], null);
    const a0 = g.rings[0].aInst.array, b0 = h.rings[0].aInst.array;
    let diff = 0;
    for (let i = 0; i < g.rings[0].count * 4; i++) if (a0[i] !== b0[i]) diff++;
    assert(diff === 0, `${diff} of ${g.rings[0].count * 4} floats differ between two builds of the same field`);
    g.dispose(); h.dispose(); t.dispose();
    return `identical after a 240 m round trip: ${rows.join(', ')}; and byte-identical on a rebuild`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Water                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('water: the river knows the shape of the bed it is lying in', () => {
    const t = terrainOf('canyon');
    ground.terrain = t;
    const w = new Water(new THREE.Scene(), { size: t.size + 60, level: 0.35 });
    assert(w.depthTex, 'the water has no depth map, so its edge is wherever the sheet ends');
    assert('WATER_DEPTH' in w.mat.defines, 'the depth map was baked and never compiled in');
    const N = w.depthTex.image.width, d = w.depthTex.image.data;
    // RGBA now: R is depth, GB are its gradient (see Water._bakeDepth)
    assert(d.length === N * N * 4, `the depth map is ${d.length} bytes for ${N}² texels`);
    const texel = (x, z) => {
      const i = clamp(Math.round((x / t.size + 0.5) * N - 0.5), 0, N - 1);
      const j = clamp(Math.round((z / t.size + 0.5) * N - 0.5), 0, N - 1);
      return (j * N + i) * 4;
    };
    const sample = (x, z) => (d[texel(x, z)] / 255) * 3.0;
    const gradAt = (x, z) => {
      const k = texel(x, z);
      return Math.hypot((d[k + 1] / 255 - 0.5) * 4.0, (d[k + 2] / 255 - 0.5) * 4.0);
    };
    // the map has to agree with the heightfield, or the shoreline is drawn in
    // the wrong place and the whole thing is worse than no map at all
    let worst = 0, deepest = 0;
    for (let z = -80; z <= 80; z += 3) {
      for (let x = -220; x <= 220; x += 7) {
        const truth = clamp(0.35 - t.height(x, z), 0, 3);
        worst = Math.max(worst, Math.abs(truth - sample(x, z)));
        deepest = Math.max(deepest, truth);
      }
    }
    assert(worst < 0.55, `the depth map is out by ${worst.toFixed(2)} m against the terrain`);
    assert(deepest > 0.2 && deepest < 2.5,
      `the wash is ${deepest.toFixed(2)} m deep — the blurb says water underfoot`);
    assert(w.wetFraction > 0.005 && w.wetFraction < 0.5,
      `${(w.wetFraction * 100).toFixed(0)}% of the map is under water`);
    /* And the gradient channels have to agree with the heightfield too, or the
     * lap goes back to painting every shallow. Sampled on the wet ground only:
     * a bank is where the bed climbs, and the shader can only know that from
     * this map. */
    let gWorst = 0, gMax = 0, gN = 0;
    for (let z = -80; z <= 80; z += 3) {
      for (let x = -180; x <= 180; x += 7) {
        if (0.35 - t.height(x, z) <= 0.01) continue;
        const truth = Math.hypot(
          (clamp(0.35 - t.height(x + 1.1, z), 0, 3) - clamp(0.35 - t.height(x - 1.1, z), 0, 3)) / 2.2,
          (clamp(0.35 - t.height(x, z + 1.1), 0, 3) - clamp(0.35 - t.height(x, z - 1.1), 0, 3)) / 2.2);
        gWorst = Math.max(gWorst, Math.abs(truth - gradAt(x, z)));
        gMax = Math.max(gMax, gradAt(x, z));
        gN++;
      }
    }
    assert(gN > 200, `only ${gN} wet samples for the gradient`);
    assert(gWorst < 0.45, `the baked bed gradient is out by ${gWorst.toFixed(2)} m/m against the terrain`);
    /* 0.10, not the 0.16 this actually measures: the map is 2.2 m per texel, so
     * it cannot resolve a bank steeper than the bank's own run, and the survey
     * grid below is coarser still. The property being pinned is that the map
     * knows a bank from a shallow AT ALL — without that the lap has nothing to
     * sit on and goes back to painting every ankle-deep metre of the wash. */
    assert(gMax > 0.10, `the steepest bank the map knows about is ${gMax.toFixed(2)} m/m — the lap has nothing to sit on`);
    w.dispose();
    ground.terrain = null;
    return `${N}² map, ≤${(worst * 100).toFixed(0)} cm error, ${(w.wetFraction * 100).toFixed(1)}% wet, `
      + `${deepest.toFixed(2)} m deepest, bed gradient ≤${gWorst.toFixed(2)} m/m error over ${gN} wet samples (max ${gMax.toFixed(2)})`;
  });

  check('water: the edge fades out where the depth runs out', () => {
    const src = SCENERY_SRC();
    assert(/float shore = smoothstep\([\d.]+, [\d.]+, depth\)/.test(src),
      'there is no shoreline band');
    assert(/float edge = smoothstep\(0\.0, [\d.]+, depth\)/.test(src) && /\* edge/.test(src),
      'the alpha does not go to zero at the waterline — the sheet ends in a hard line');
    /* REWRITTEN, and the old line is worth recording: this asserted
     * `mix(uBed, body, dw)` — a SCALAR fade from a flat bed colour to a flat
     * swatch. That expression was the bug. A scalar carries no hue, so the
     * swatch never asserted itself and the river displayed at saturation 0.11
     * against an authored 0.62; and sampling the bed straight down puts it
     * behind the ripples like a decal. The property that replaces it is
     * strictly stronger on both counts. */
    assert(/vec3 trans = exp\(-WATER_EXT \* bedDepth\)/.test(src),
      'the bed is filtered by a scalar, so a foot of river has no colour of its own');
    assert(/bedDepth = max\(0\.0, depth \+ dot\(grad, N\.xz/.test(src),
      'the bed is read straight down — it sits behind the ripples instead of refracting through them');
    // one fetch, not six: the canyon stops booting somewhere above two
    const fetches = (src.slice(src.indexOf('const WATER_FRAG'), src.indexOf('waterShade'))
      .match(/bedAt\(|texture2D\(uDepth/g) || []).length;
    assert(fetches <= 3,
      `the water shader takes ${fetches} depth reads per pixel; a 520 m sheet cannot afford that`);
    assert(/mix\(body, bed \* trans,/.test(src),
      'shallow water does not show the bed through it');
    // and a shallow river must not be throwing whitecaps
    const swell = src.match(/smoothstep\(0\.08, 0\.15, abs\(vWave\)\) \* ([\d.]+)/);
    assert(swell && Number(swell[1]) < 0.08,
      'the long swell is still foaming, which on a 580 m sheet is white blobs the size of a barge');
    /* Also rewritten. The old pair — a flatness term and any `mirror = mix(` —
     * was satisfied by a shader that mirrored a 55/45 blend of haze and sky,
     * i.e. two chromas cancelling into grey. What matters is that the mirror is
     * chosen by where the REFLECTED RAY GOES, and that a lap is a shore rather
     * than a shallow: 71% of the canyon's wet surface is 2.5-30 cm deep, so a
     * lap keyed on depth alone is a lap over the whole river. */
    assert(/vec3 R = reflect\(-V, N\)/.test(src) && /float facet = smoothstep\([\d.]+, [\d.]+, clamp\(R\.y/.test(src),
      'the reflection is picked by a flatness proxy, not by where the mirrored ray actually goes');
    assert(/vec3 mirror = mix\(/.test(src), 'the surface mirrors one flat colour');
    assert(/float lapBand = shore \* smoothstep\([\d.]+, [\d.]+, climb\)/.test(src),
      'the lap is keyed on depth alone, so it paints foam across every shallow');
    assert(/float wet = smoothstep/.test(src) && /bed \* 0\.44, wet/.test(src),
      'there is no wet ground at the waterline — the river ends in a bright line instead of a beach');
    return 'refracted bed, per-channel extinction, ray-chosen mirror, a lap at the shore and wet ground under it';
  });

  check('water: standing water reads as water, and along it the surface is a mirror', () => {
    /*
     * The canyon river shipped as a flat near-white sheet: hue 189, saturation
     * 0.192 measured off a frame, against an authored shallow swatch of 0.62,
     * and 11.8% of the frame over 0.80 luminance with none of it sky.
     *
     * Three things were wrong and only one of them was the reflection:
     *   · the lap was keyed on DEPTH, and 71% of that wash was 2.5-30 cm deep,
     *     so 0.86 of linear white went down over a body colour of 0.14 across
     *     nearly the whole river;
     *   · the Fresnel was pow(1-N.V, 3.2) folded into 0.62 of the mix, so at
     *     the 2-8 degrees a standing player sees a river at, the surface came
     *     back mostly DIFFUSE — water does not do that;
     *   · the mirror was a 55/45 blend of haze and sky, two chromas cancelling.
     *
     * ── RE-DERIVED, IN TWO HALVES, AND BOTH ARE STRONGER ───────────────────
     *
     * This used to be one measurement on ONE named level, the wash, which has
     * since been deleted at the player's request. Re-pointing it at another
     * level would have been the weak fix, and it would also have been wrong:
     * the mirror half of the claim silently depended on that level having a
     * BRIGHT SKY over it. The game's remaining standing water is a pool at the
     * bottom of a mine with a near-black ceiling — measured, it returns 0.52 of
     * reflection per unit of scatter at a grazing view, and it SHOULD, because
     * there is nothing above it to mirror. A check that failed that would be
     * demanding a physical impossibility.
     *
     * So the two halves are separated and each is asked of the right thing.
     *
     *   THE MIRROR is a property of the MODEL, and is now measured against a
     *   controlled environment — one surface, one sky brighter than its bed,
     *   swept from overhead to grazing. That is strictly more than the old
     *   form: it pins the whole curve (monotone, and crossing over between 30°
     *   and 6°) rather than one sample of it, and it cannot be lost again by
     *   deleting a level.
     *
     *   THE DISPLAY is a property of each LEVEL, and is now asked of EVERY
     *   level that has a body of liquid on it — three of them, where one was
     *   surveyed before, and two of those are molten rather than water.
     *
     *            shipped wash    now (deeps)
     *   sat        0.113          0.622      (gate: 60% of the authored swatch)
     *   >0.80     48.13%          0.00%
     */
    const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
    const linToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

    /* ── one: the model mirrors at a grazing view and scatters from above ── */
    const ctrl = {
      shallow: [0.06, 0.22, 0.30], deep: [0.006, 0.028, 0.055], bed: [0.14, 0.11, 0.07],
      sky: [0.35, 0.52, 0.95], fog: [0.42, 0.46, 0.52], sun: [0.4, 0.24, 0.3],
    };
    const sweep = [];
    for (const deg of [60, 30, 12, 6, 4, 2]) {
      let R = 0, S = 0;
      for (const d of [0.2, 0.6, 1.2, 2.4]) {
        const s = waterShade({ ...ctrl, depth: d, bedDepth: d, climb: 0.05, viewDeg: deg, ny: 0.996 });
        R += s.reflected; S += s.scattered;
      }
      sweep.push({ deg, ratio: R / S });
    }
    for (let i = 1; i < sweep.length; i++) {
      assert(sweep[i].ratio > sweep[i - 1].ratio,
        `the mirror does not strengthen toward grazing: ${sweep[i - 1].deg}° gives `
        + `${sweep[i - 1].ratio.toFixed(2)} and ${sweep[i].deg}° gives ${sweep[i].ratio.toFixed(2)}`);
    }
    assert(sweep[0].ratio < 0.25,
      `seen from 60° above, the surface is already ${sweep[0].ratio.toFixed(2)} mirror — water is not a plate of chrome`);
    assert(sweep[sweep.length - 1].ratio > 1.6,
      `seen along it at 2°, the surface returns only ${sweep[sweep.length - 1].ratio.toFixed(2)} `
      + 'reflected per unit scattered — a river seen along it is a mirror');
    const cross = sweep.find((s) => s.ratio > 1);
    assert(cross && cross.deg <= 30 && cross.deg >= 6,
      `the mirror takes over at ${cross ? cross.deg : '∞'}° — that is not where Fresnel puts it`);

    /* ── two: every body of liquid in the game, on its own level ────────── */
    const FACET = [-0.44, -0.28, -0.14, 0, 0.14, 0.28, 0.44];
    const WT = [0.06, 0.13, 0.19, 0.24, 0.19, 0.13, 0.06];
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L || !L.water) continue;
      const A = L.atmosphere;
      const t = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      const env = {
        shallow: lin(L.water.shallow), deep: lin(L.water.deep), bed: lin(L.water.bed ?? 0x6b5a41),
        sky: lin(A.skyColor), fog: lin(A.fogColor), sun: sunDirection(A).normalize().toArray(),
      };
      let wsat = 0, wlum = 0, n = 0, hot = 0;
      for (let z = -110; z <= 110; z += 1.5) {
        for (let x = -110; x <= 110; x += 1.5) {
          const d = L.water.level - t.height(x, z);
          if (d <= 0.005) continue;
          const climb = Math.hypot(t.height(x + 0.7, z) - t.height(x - 0.7, z),
            t.height(x, z + 0.7) - t.height(x, z - 0.7)) / 1.4;
          const dist = Math.max(6, Math.hypot(x, z) * 0.35 + 8);
          const viewDeg = Math.atan(1.7 / dist) * 180 / Math.PI;
          const col = [0, 0, 0];
          for (let k = 0; k < FACET.length; k++) {
            const a = FACET[k], ny = 1 / Math.sqrt(1 + 2 * a * a);
            const s = waterShade({ ...env, depth: d, bedDepth: d, climb, viewDeg, ny });
            for (let i = 0; i < 3; i++) col[i] += s.col[i] * WT[k];
          }
          const disp = throughTone(col, A.exposure, A);
          const mx = Math.max(...disp), mn = Math.min(...disp);
          wsat += mx <= 1e-9 ? 0 : (mx - mn) / mx;
          const lum = 0.2126 * disp[0] + 0.7152 * disp[1] + 0.0722 * disp[2];
          wlum += lum; if (lum > 0.80) hot++;
          n++;
        }
      }
      const s0 = env.shallow.map(linToSrgb), smx = Math.max(...s0), smn = Math.min(...s0);
      const authored = (smx - smn) / smx;
      const sat = wsat / n, lum = wlum / n, hotShare = (hot / n) * 100;
      assert(n > 500, `${key}: only ${n} wet cells surveyed`);
      assert(sat >= authored * 0.60,
        `${key}: the surface displays at saturation ${sat.toFixed(3)}, under 60% of the authored ${authored.toFixed(3)}`);
      assert(hotShare < 2.0,
        `${key}: ${hotShare.toFixed(1)}% of the surface is over 0.80 luminance — it is a white sheet again`);
      rows.push(`${key} sat ${sat.toFixed(3)}/${authored.toFixed(3)} lum ${lum.toFixed(3)} hot ${hotShare.toFixed(2)}%`);
      t.dispose();
    }
    assert(rows.length >= 2, `only ${rows.length} level(s) carry a body of liquid`);
    return `model ${sweep.map((s) => `${s.deg}°:${s.ratio.toFixed(2)}`).join(' ')}; ${rows.join('; ')}`;
  });

  check('water: a level with no terrain still gets a river, just a flat one', () => {
    const prev = ground.terrain;
    ground.terrain = null;
    const w = new Water(new THREE.Scene(), { size: 100 });
    assert(!w.depthTex, 'a water plane with no bed under it baked a depth map anyway');
    assert(!('WATER_DEPTH' in w.mat.defines), 'the shader wants a depth map that does not exist');
    w.dispose();
    ground.terrain = prev;
    return 'falls back cleanly';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Cost                                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: every preset is still one mesh, one material, one draw call', () => {
    const out = [];
    for (const name of PRESETS) {
      const scene = new THREE.Scene();
      const t = new Terrain(scene, name, 1.0);
      const meshes = scene.children.filter((c) => c.isMesh);
      assert(meshes.length === 1, `${name}: the ground is ${meshes.length} meshes`);
      assert(!Array.isArray(t.mesh.material), `${name}: the ground is a material array`);
      assert(t.mesh.receiveShadow && t.mesh.castShadow, `${name}: the ground dropped out of the shadow pass`);
      out.push(`${name} ${(t.geometry.index.count / 3 / 1000).toFixed(0)}k tris`);
      t.dispose();
    }
    return out.join('  ');
  });

  check('terrain: every height function is smooth, and the meadow is the cheapest of them', () => {
    /* height() is the hottest function in this file by a distance. It runs
     * res² times at bake, once per physics heightfield refresh, and once per
     * FOOT PER CHARACTER PER FRAME — so it is not a bake-time cost, it is a
     * frame cost that scales with how many people are standing on the level.
     *
     * SMOOTHNESS first, because it is the property that can break silently. A
     * step in the field is invisible in a screenshot and lethal underfoot: the
     * physics sampler bilinearly interpolates a grid, so a discontinuity
     * between two grid points becomes a wall a character can be pushed through
     * or stood on top of.
     *
     * Measured as the largest jump over one MILLIMETRE of ground, which is the
     * scale that separates the two cases: a discontinuity shows its whole size
     * at any epsilon and every plausible one here is metres — a strata band is
     * 3 to 7 m, a dune amplitude 21 — while the steepest continuous thing in
     * the game, the near-vertical riser `strata` puts at the top of a bed,
     * shows 13 mm. The gate sits at 50 mm: three times the worst real riser and
     * sixty times under the smallest step anything here could produce.
     *
     * Then COST, as a ratio to the dune sea measured in the same process, so
     * the number does not depend on the machine or on what else is running. */
    const rows = [];
    const jump = {}, cost = {};
    for (const name of PRESETS) {
      const P = TERRAIN_PRESETS[name], half = P.scale / 2;
      let worst = 0;
      for (let k = 0; k < 20000; k++) {
        // a low-discrepancy walk, so the sample set is not itself on a lattice
        const x = (fract(k * 0.7548776662) * 2 - 1) * half * 0.98;
        const z = (fract(k * 0.5698402909) * 2 - 1) * half * 0.98;
        const a = P.height(x, z);
        if (!isFinite(a)) throw new Error(`${name}: height(${x}, ${z}) is ${a}`);
        worst = Math.max(worst, Math.abs(P.height(x + 1e-3, z) - a),
          Math.abs(P.height(x, z + 1e-3) - a));
      }
      jump[name] = worst;
      assert(worst < 0.05,
        `${name}: the surface steps ${(worst * 1000).toFixed(0)} mm across one millimetre of ground`);

      const h = P.height;
      let s = 0;
      for (let i = 0; i < 60000; i++) s += h(i * 0.37 - 180, i * 0.71 - 240);   // warm
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 300000; i++) s += h(i * 0.37 - 180, i * 0.71 - 240);
      cost[name] = Number(process.hrtime.bigint() - t0) / 300000;
      if (!isFinite(s)) throw new Error(`${name}: the timing loop went non-finite`);
      rows.push(`${name} ${(worst * 1000).toFixed(1)}mm ${cost[name].toFixed(0)}ns`);
    }
    /* The meadow's whole design claim, as a number. It is two octaves of fbm
     * and a micro term — six noise2 calls against the dune sea's eighteen —
     * and if it ever stops being the cheapest ground in the game, somebody has
     * put landform into a landscape that does not have any. Measured: 0.19×.
     * The gate is loose because this is wall-clock on a shared machine; the
     * failure it is here to catch is a factor, not a percentage. */
    assert(cost.meadow < cost.dunes * 0.40,
      `the meadow costs ${(cost.meadow / cost.dunes).toFixed(2)}× the dune sea — it is not the simple one any more`);
    // and the two new deserts/mountains must not cost more than the field they
    // were built next to
    assert(cost.drifts < cost.dunes * 1.4,
      `the erg costs ${(cost.drifts / cost.dunes).toFixed(2)}× the dune sea`);
    assert(cost.alpine < cost.canyon * 1.4,
      `the alpine costs ${(cost.alpine / cost.canyon).toFixed(2)}× the canyon`);
    return rows.join('  ') + `  — meadow ${(cost.meadow / cost.dunes).toFixed(2)}× dunes`;
  });

  check('terrain: a Force landing still craters every ground that is not a deck', () => {
    // crater() rewrites position, normal and the landform attribute in place
    // and is disabled only on `flat` presets. A new preset that a crater slid
    // off — because its height function is dominated by a term the deformation
    // is added under, or because it is quietly flat — would lose the one piece
    // of terrain interaction the game has.
    const rows = [];
    for (const name of PRESETS) {
      const t = new Terrain(new THREE.Scene(), name, 0.6);
      /* 8 m, not the 3 the dune sea's own check uses: at quality 0.6 the grid
       * is up to 3 m and a crater narrower than a few cells is resolved by
       * whichever vertices happen to fall inside it, so a 4 m one measures as
       * a 0.7 m dent on the 540 m meadow and as 1.5 m on the 300 m deck. That
       * is the grid, not the preset — this is testing that the deformation
       * lands at all, not what crater() does at the resolution limit. */
      const before = t.height(9, -6), rimBefore = t.height(17.3, -6);
      t.crater(9, -6, 8, 1.6);
      const after = t.height(9, -6);
      if (t.preset.flat) {
        near(after, before, 1e-6, `${name}: a deck deformed`);
        rows.push(`${name} —`);
      } else {
        assert(after < before - 1.1, `${name}: a 1.6 m crater only moved the ground ${(before - after).toFixed(2)} m`);
        /* The rim is measured against ITS OWN height before the crater, not
         * against the crater floor. On rough ground the two are unrelated: the
         * alpine's ribs put 13 m of relief inside the first 40 m, so a point
         * 8 m away is routinely metres below a crater floor that a perfectly
         * good 34 cm lip has just been added to. */
        assert(t.height(17.3, -6) > rimBefore + 0.05,
          `${name}: the crater has no raised rim — the ground 8.3 m out moved ${(t.height(17.3, -6) - rimBefore).toFixed(3)} m`);
        assert(t.deformSeq === 1, `${name}: the physics heightfield was not told the ground moved`);
        t.flush();
        const k = t._idx(Math.round((9 + t.half) * t.invStep), Math.round((-6 + t.half) * t.invStep));
        assert(t.landform[k * 4] > 128, `${name}: the crater floor did not become a hollow in the landform`);
        rows.push(`${name} ${(before - after).toFixed(2)}m`);
      }
      t.dispose();
    }
    return rows.join('  ');
  });

  check('terrain: the surface stays finite and continuous with everything added', () => {
    // Every layer above multiplies into diffuseColor; one NaN anywhere in the
    // heightfield poisons the landform bake and every channel that reads it.
    for (const name of PRESETS) {
      const t = terrainOf(name);
      for (let k = 0; k < t.heights.length; k++) {
        if (!isFinite(t.heights[k])) throw new Error(`${name}: a non-finite height at ${k}`);
      }
      for (let k = 0; k < t.landform.length; k++) {
        const v = t.landform[k];
        if (!(v >= 0 && v <= 255)) throw new Error(`${name}: landform byte ${k} is ${v}`);
      }
      for (const [n, u] of Object.entries(t._uniforms)) {
        const v = u.value;
        if (typeof v === 'number' && !isFinite(v)) throw new Error(`${name}: uniform ${n} is ${v}`);
        if (v && v.isVector4 !== undefined && v.toArray) {
          for (const c of v.toArray()) if (!isFinite(c)) throw new Error(`${name}: uniform ${n} holds ${c}`);
        }
      }
    }
    return `${PRESETS.length} presets, all finite`;
  });
}

/* ── source, read once ───────────────────────────────────────────────── */
/*
 * The shaders are strings inside a module, so the only way to hold one to a
 * shape is to read the file it lives in — the same trick the stray-backtick
 * check uses. Everything checked this way is a property no runtime value
 * exposes: which chunk a term is spliced into, whether a bend is a
 * displacement or a rotation, whether the alpha reaches zero at the waterline.
 */
let _terSrc = null, _scnSrc = null, _engSrc = null;
const TERRAIN_SRC = () => (_terSrc ??= readSrc('Terrain.js'));
const SCENERY_SRC = () => (_scnSrc ??= readSrc('Scenery.js'));
const readSrc = (name) =>
  readFileSync(new URL(`../../src/world/${name}`, import.meta.url), 'utf8');
/* The exposure key is a module-private const in Engine, and the whole snow
 * measurement is anchored on it; reading it out of the source is the only way
 * to be sure the check and the engine are talking about the same number. */
const ENGINE_SRC = () =>
  (_engSrc ??= readFileSync(new URL('../../src/engine/Engine.js', import.meta.url), 'utf8'));
