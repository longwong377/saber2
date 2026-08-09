/**
 * SABER — terrain.
 *
 * A single large heightfield: one draw call, sampled analytically for physics,
 * and deformable at runtime so a Force landing actually leaves a crater in the
 * dune.
 *
 * Two things make ground read as ground rather than as a plane with a decal.
 *
 * The first is landform. The presets below build dunes with a windward face and
 * a slip face, canyon walls quantised into strata, and an arena rim gullied by
 * runoff — shapes with a direction and a story, not fractal noise.
 *
 * The second is that the material knows *where on the landform it sits*. At
 * build time the heightfield is analysed into four channels — local concavity,
 * openness, elevation relative to the surrounding land, and exposure to the
 * prevailing wind — and baked into a byte-per-channel vertex attribute. The
 * shader spends those on layered materials: fines drifting into the hollows,
 * coarse grit scoured off the windward brinks, a salt pan in the basin, strata
 * banding on the cliffs. That is macro variation at the scale the player walks
 * through, and it costs one attribute fetch.
 *
 * Everything else stays one mesh and one draw call.
 */

import * as THREE from 'three';
import { fbm2, ridged2, clamp, lerp, smoothstep } from '../engine/MathUtil.js';
import { sandMaps, rockMaps, duracreteMaps, metalMaps } from '../engine/Textures.js';
// One-way: Scenery knows nothing about Terrain, so publishing the heightfield
// on the broker here is what lets the water find the bed it is lying in
// without the World having to wire the two together.
import { ground } from './Scenery.js';

const fract = (v) => v - Math.floor(v);

/* ── landform shaping helpers ─────────────────────────────────────────── */

/**
 * One dune crossing. `f` is the phase along the wind, 0 at the upwind toe and
 * 1 at the next one. The windward face is long and steepens toward the brink;
 * the slip face drops back at the angle of repose in a quarter of the distance,
 * so the crest is a crisp line rather than a rounded sine.
 */
export function duneProfile(f, brink = 0.74) {
  if (f <= 0) return 0;
  if (f < brink) return Math.pow(clamp(f / brink, 0, 1), 1.55);
  // clamped, because pow() of a negative base is NaN and one NaN here poisons
  // the whole heightfield
  return Math.pow(clamp(1 - (f - brink) / (1 - brink), 0, 1), 1.3);
}

/**
 * Quantise a height into sedimentary benches: each band is a near-flat shelf
 * with a steep riser at its top. The exponent is drawn per band, so hard strata
 * stand as cliffs and soft ones weather back into ramps — which is what makes a
 * canyon wall look bedded instead of extruded. Continuous at every band edge
 * (f^p → 0 and 1 regardless of p), so the physics sampler never sees a step.
 */
export function strata(h, step, strength, seed = 0) {
  if (strength <= 0.001) return h;
  const t = h / step;
  const i = Math.floor(t), f = t - i;
  const p = 1.8 + fract(Math.sin(i * 12.9898 + seed) * 43758.5453) * 4.0;
  return lerp(h, (i + Math.pow(f, p)) * step, strength);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Presets                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `height` and `rockAt` describe the shape; everything else describes the
 * material. Colours are the five layers the shader blends between — base,
 * grit, rock (two bands), drift, crust — and the bands say which slopes and
 * which landform positions each one claims.
 */
export const TERRAIN_PRESETS = {
  dunes: {
    scale: 560, res: 340, waterLevel: -999,
    sandColor: 0x9e7a42, rockColor: 0x6b5d4c,
    maps: 'sand',
    gritColor: 0x6d5430, rockColor2: 0x8a7358,
    // A salt pan is dried silt, not sand: pale, and grey rather than tan.
    dustColor: 0xbb9459, crustColor: 0xa4a691,
    // Slope here is 1 − cos θ, so 0.13 is 30° and 0.29 is 45°. A dune sea is
    // sand all the way up — the slip faces get coarse grit, never stone.
    slopeBands: [0.30, 0.52, 0.11, 0.24],
    stoneSlope: 0.30,
    crust: 0.55, strataH: 5.0,
    wind: [0.86, 0.51],
    // patch metres, lag gain, sheet gain, occlusion gain — see `uMacro`
    macro: [165, 0.62, 0.50, 1.0],
    // Grain sorting reads as HUE, not only as value: a deflation pavement is
    // grey-brown gravel, a fresh drift sheet is pale and almost colourless.
    // Reusing grit/dust here left the whole map on one hue at three brightnesses.
    //
    // …which is what 0x6f6046 still was. Measured as an authored swatch it is
    // hue 38.0° against the base sand's 36.6° — one and a half degrees apart,
    // so the "hue" half of the claim above was never true on this preset and
    // the 165 m patchwork read as a brightness ramp. 0x63645a is 66°: still a
    // dark, dusty, unsaturated gravel, but on the other side of the sand's hue
    // from the pale sheet, which is the whole point of the pair.
    lagColor: 0x63645a, sheetColor: 0xc4a87e,
    ripple: 1.15,
    detail: [0.95, 34],
    height(x, z) {
      const wx = 0.86, wz = 0.51;
      // the draa: 250 m sand ridges the whole field is built on. Kept well
      // under the dune amplitude — at 27 m it swamped the dunes and the field
      // read as rolling hills with a texture on them.
      const draa = Math.pow(Math.max(0, ridged2(x * 0.0026 + 5.3, z * 0.0026, 3)), 1.25) * 18;

      // the dune train, measured along the wind, with the crest line warped so
      // it snakes instead of ruling a straight edge across the map
      const warp = fbm2(x * 0.0043, z * 0.0043, 3) * 30;
      const s = x * wx + z * wz + warp;
      const t = -x * wz + z * wx;
      const lam = 68 * (1 + fbm2(t * 0.0052, s * 0.0033, 2) * 0.30);
      const amp = 12.5 * clamp(fbm2(t * 0.0091 + 17, s * 0.0031, 3) * 2.2 + 0.72, 0, 1);
      const dune = duneProfile(fract(s / lam)) * amp;

      // secondary dunes riding the windward flanks, 20° off the primary wind
      const s2 = s * 0.36 + t * 0.93;
      const sec = duneProfile(fract(s2 / 26.5), 0.70) * 2.0
        * clamp(1.3 - dune * 0.10, 0, 1);

      // the interdune is firm corrugated sand, never a plane
      const corr = fbm2(x * 0.052, z * 0.052, 3) * 0.30
        + Math.max(0, ridged2(x * 0.019, z * 0.019, 2) - 0.3) * 0.55;

      // a pan in the middle to fight in — irregular edge, gently dished so it
      // reads as a basin the dunes have been kept out of rather than a disc
      const d = Math.hypot(x, z);
      const panR = 33 + fbm2(x * 0.011, z * 0.011, 2) * 20;
      const open = smoothstep(panR * 0.62, panR * 1.5, d);

      return draa * (0.42 + open * 0.58) + (dune + sec) * open + corr
        - (1 - open) * 1.1;
    },
    rockAt(x, z, slope) { return clamp(slope * 1.9 - 1.1, 0, 1); },
  },

  arena: {
    scale: 460, res: 300, waterLevel: -999,
    /* THE PALETTE WAS ONE HUE, in the source, before any light touched it.
     * Measured as HSV hue of the authored swatches:
     *
     *   grit 32.6°  dust 35.2°  sand 36.4°  sheet 37.5°  lag 37.8°
     *   rock 34.9°  rock2 34.6°  crust 43.0°
     *
     * Eight materials inside eleven degrees, and the two of them that are not
     * sand at all — the stone the level's own blurb rings the bowl with, and
     * the deflation pavement the grain-sorting layers exist to show — sat
     * within half a degree of the sand. That is why the rendered frame came
     * out with 80% of its pixels inside 13° of hue: the light was not flattening
     * a varied ground, the ground was already flat.
     *
     * ROCK IS NOT SAND. It is a different material with a different history, and
     * a bedded wall is the one place a landscape shows you two rocks at once.
     * The two bands now bracket the sand instead of sitting on it: an iron-
     * stained red-brown bed at 26.5° and a cool grey-blue one at 218.6°, the
     * usual sandstone-over-shale pair. Luminance is held on the warm band —
     * 0.153 linear against the old 0.154 — so nothing about the rim's exposure
     * moves; only its hue does.
     *
     * The cool band's VALUE is the number that had to be measured rather than
     * picked. rockTint is mix(rock, rock2, bandR) × (0.72 + bandR × 0.58), so
     * the same per-bed hash that selects the cool rock also brightens it by up
     * to 1.30: at a first try of 0x5f646d (linear 0.126, i.e. 0.83× the warm
     * bed) the product put the cool beds 1.5× the warm ones and the rim came
     * out as white stripes across a red cliff — a layer cake, not a wall.
     * 0x5a5f68 is 0.114, which is 0.75× the warm bed, and the 1.30 brings the
     * two back to within 3% of each other. The bands then read as a change of
     * ROCK rather than as a change of exposure.
     */
    sandColor: 0x9c7b48, rockColor: 0x8b6547,
    maps: 'sand',
    gritColor: 0x6a5334, rockColor2: 0x5a5f68,
    // …and the pan is not sand either: a silt flat is what is left when the
    // fines settle out of standing water, and it dries pale and grey.
    dustColor: 0xb88f55, crustColor: 0xa2a695,
    // "A bowl of sand ringed by STONE". The rim rises 27 m over 56, which is
    // 1-cos 0.11 — under the old rock band, so the amphitheatre wall came out
    // as pale sand cloth and the level's own blurb was a lie about it.
    slopeBands: [0.055, 0.19, 0.045, 0.14],
    stoneSlope: 0.24,
    crust: 0.55, strataH: 5.5, cliffs: true,
    wind: [0.34, 0.94],
    // Lag gain 0.75, not 0.62. The concavity channel is normalised by the
    // spread of (blur − height) over the WHOLE map, so fluting the rim — which
    // is four fifths of the arena by area — compresses the fighting floor's own
    // micro-relief along with it: the floor's crest term fell, the scour term
    // that rides on it fell, and the coarse lag patches went from 8.0% of the
    // loose ground to 6.5%, under the floor the checks hold this level to.
    macro: [140, 0.75, 0.50, 1.05],
    rockUpland: [0.16, 5, 26],
    // A deflation pavement is desert varnish on coarse gravel — olive-grey,
    // never tan. 0x615746 was the sand at 38° with the value turned down, so
    // the whole 140 m grain-sorting patchwork read as a brightness ramp; this
    // is 71°, and the sheet it is bracketed against stays warm at 37°.
    lagColor: 0x5e6055, sheetColor: 0xc0a880,
    ripple: 0.95,
    detail: [0.95, 30],
    height(x, z) {
      const d = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      // the rim is not a circle — it wanders by ±15 m so the bowl has a near
      // side and a far side you can navigate by
      const dd = d + fbm2(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 3) * 15;

      // the fighting floor: flat enough for the ring wall at r=56, dished so
      // dust and blood have somewhere to collect
      const floor = fbm2(x * 0.016, z * 0.016, 4) * 0.55
        + Math.max(0, ridged2(x * 0.05, z * 0.05, 2) - 0.35) * 0.4;
      const dish = -smoothstep(62, 6, d) * 1.0;

      // ── the wall: benched like an amphitheatre, gullied by runoff, and
      //    fluted at the silhouette.
      //
      // Every erosion term here is a function of ANGLE alone, so it is constant
      // along a radius and therefore cuts the ridge line by its full depth
      // rather than being averaged out on the way up. That is what makes it
      // reach the skyline at all on a 1.53 m grid: an erosion field that varied
      // with radius would need features several cells deep in BOTH directions.
      let wall = smoothstep(60, 116, dd) * 27 + smoothstep(112, 170, dd) * 42;

      // The chutes. They open upward, the way runoff cuts: shallow scallops at
      // the foot where the debris piles up, deep notches at the brink where
      // there is nothing to fill them. Measured on the ridge line as seen from
      // an eye in the middle of the bowl, this and the rills below take the
      // skyline from 0.85° of variation to 1.00°, its peak-to-peak from 4.12°
      // to 4.96°, the count of separate notches cut into it from 51 to 63 —
      // and, the number that actually decides whether an edge reads as eroded
      // or as drawn, its high-frequency content from 0.166 to 0.348 °/sample.
      const chute = Math.max(0, ridged2(Math.cos(a) * 7.4, Math.sin(a) * 7.4, 3) - 0.28);
      const gully = chute * (0.62 + 0.38 * smoothstep(100, 176, dd))
        * smoothstep(58, 132, dd) * 16.5;
      // Rills between the chutes, at two fifths of their wavelength. 119 of
      // them round a 170 m rim is 9 m each — six grid cells, so they survive; the
      // second octave is 3 cells and reads as roughness rather than as shape,
      // which is exactly what a silhouette needs to stop being a drawn line.
      const rill = Math.max(0, ridged2(Math.cos(a) * 19.0 + 5.1, Math.sin(a) * 19.0 - 2.7, 2) - 0.36)
        * smoothstep(96, 162, dd) * 5.4;

      // Bedding DIPS. Beds laid down level and then tilted is the normal case,
      // and quantising against a level datum all the way round is what makes an
      // amphitheatre read as a stack of cardboard rings. Added before the
      // quantiser and taken off after, so what tilts is where the treads and
      // risers fall — the wall's underlying profile, and its mean height round
      // the rim, do not move, and with the strata strength at zero the term
      // cancels exactly.
      const dip = Math.sin(a * 1.7 + 0.9) * 3.2 + Math.sin(a * 0.9 - 2.2) * 2.1;
      wall = strata(wall - gully - rill + dip, 6.2, smoothstep(60, 84, dd) * 0.70, 3.1) - dip;

      // The talus apron. A cliff that meets the floor at a line has nowhere to
      // have put the material it lost; a real one stands on a skirt of its own
      // debris, fanning out from under the chutes. Held off until d = 68 so the
      // colonnade at R = 56 and everything the level dresses inside it sit on
      // exactly the ground they sat on before.
      const talus = smoothstep(68, 90, d) * smoothstep(132, 94, dd)
        * (0.45 + 0.85 * chute) * 3.4;

      return wall + talus + floor + dish;
    },
    rockAt(x, z, slope) { return clamp(slope * 2.4 - 0.2, 0, 1); },
  },

  canyon: {
    scale: 520, res: 320, waterLevel: 0.4,
    sandColor: 0x8e7550, rockColor: 0x6e4028,
    maps: 'sand',
    gritColor: 0x5a4229, rockColor2: 0x3e2e24,
    dustColor: 0xa8895d, crustColor: 0x55523e,
    slopeBands: [0.10, 0.32, 0.035, 0.12],
    stoneSlope: 0.20,
    crust: 0.5, damp: 0.35, strataH: 3.8, cliffs: true,
    wind: [0.99, 0.14],
    macro: [125, 0.55, 0.40, 1.15],
    rockUpland: [0.10, 9, 34],
    lagColor: 0x5d5343, sheetColor: 0xab9673,
    // A wash is worked by water, not by wind. Aeolian ripples over the whole
    // canyon floor read as corduroy and contradict the river running down it.
    ripple: 0.55,
    detail: [1.05, 30],
    height(x, z) {
      // a thalweg that actually meanders instead of tracing one sine
      const mean = Math.sin(x * 0.0113) * 26 + Math.sin(x * 0.0043 + 1.7) * 15
        + fbm2(x * 0.0037, 8.6, 3) * 20;
      const river = Math.abs(z - mean);

      // the wash breathes: narrows to a slot, opens into a bench
      const w = 16 + fbm2(x * 0.0062, 3.1, 3) * 13;
      // side canyons cut back into the rim on a slow rhythm
      const tribs = Math.max(0, ridged2(x * 0.010, z * 0.0042 + 4.4, 3) - 0.42) * 3.2;
      const relief = 24 + Math.max(0, ridged2(x * 0.0047, z * 0.0047, 4)) * 40;

      const rise = smoothstep(w, w + 26 + tribs * 22, river);
      // Strata: benches with hard risers, strong high on the wall and fading
      // out at the foot so the wash floor stays walkable. The step has to be
      // several quads deep to survive a 1.6 m grid — at 3.6 m the benches were
      // two vertices wide and came out as noise. The fine banding is the
      // shader's job, where there is no grid to fight.
      const wall = strata(rise * relief, 7.5,
        smoothstep(0.06, 0.40, rise) * 0.78, 11.7);

      // talus fanning out from the foot of every wall
      const talus = smoothstep(w + 30, w + 2, river) * smoothstep(w - 6, w + 8, river) * 2.6;

      // The wash floor. The water plane sits at 0.35 m and the old bed dropped
      // to −1.6, which put two thirds of the level under two metres of river —
      // the blurb promises water underfoot. Gravel bars now sit just proud of
      // the waterline with braided channels cut through them, so the river is
      // ankle deep and you can read where it runs.
      const inWash = smoothstep(w + 14, w - 2, river);
      const bar = 0.75 - smoothstep(w + 10, 0, river) * 0.55;
      const braid = -Math.max(0, ridged2(x * 0.042 + 7.7, z * 0.021, 3) - 0.42) * 1.5;
      const detail = fbm2(x * 0.028, z * 0.028, 4) * (0.85 - inWash * 0.62);
      return wall + talus + (bar + braid) * inWash + detail;
    },
    rockAt(x, z, slope) { return clamp(slope * 1.7 + 0.12, 0, 1); },
  },

  hangar: {
    scale: 300, res: 160, waterLevel: -999, flat: true,
    sandColor: 0x4e535c, rockColor: 0x33373e,
    maps: 'deck',
    gritColor: 0x3a3e46, rockColor2: 0x272b32,
    dustColor: 0x666c76, crustColor: 0x3d434c,
    slopeBands: [0.05, 0.20, 0.010, 0.045],
    stoneSlope: 0.2,
    crust: 0.0, strataH: 2.2,
    wind: [1, 0],
    macro: [58, 0.34, 0.26, 0.75],
    lagColor: 0x2f343c, sheetColor: 0x6a707a,
    ripple: 0.55, ripAspect: 1.0,   // a deck is poured, not blown
    texScale: [0.42, 0.26, 0.34],
    detail: [1.6, 26],
    height(x, z) {
      const d = Math.max(Math.abs(x), Math.abs(z));
      // a deck: dead flat inside the bay, with drainage channels on a 12 m grid
      // so the floor catches a highlight instead of reading as a void
      const gx = Math.abs(fract(x / 12) - 0.5), gz = Math.abs(fract(z / 12) - 0.5);
      const drain = -smoothstep(0.46, 0.5, Math.max(gx, gz)) * 0.06;
      return smoothstep(74, 132, d) * 42 + drain + fbm2(x * 0.09, z * 0.09, 2) * 0.03;
    },
    rockAt() { return 1; },
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Shader                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

const TERRAIN_VERT_COMMON = /* glsl */`
  attribute vec4 aTer;
  varying vec3 vWPos;
  varying vec3 vWNrm;
  varying vec4 vTer;
`;

const TERRAIN_VERT_BODY = /* glsl */`
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * objectNormal);
  vTer = aTer;
`;

/**
 * Two frames for the texture bombing and a third for the near-field detail.
 *
 * The two bombing frames are no longer arbitrary fixed rotations. Aeolian
 * ripples are made by ONE wind: their crests run across it, everywhere, and a
 * ripple field that points two unrelated ways is the single loudest tell that
 * a desert was textured rather than blown. So both frames are built around the
 * preset's prevailing wind, a few degrees either side of it, and the whole
 * frame is then swung by a low-frequency warp so the crests curve, bifurcate
 * and die out the way a real ripple field does instead of ruling parallel
 * corduroy across the map. The scales still differ, and the warp is what breaks
 * the tiling that used to be the other rotation's job.
 */
const TERRAIN_FRAG_COMMON = /* glsl */`
  varying vec3 vWPos;
  varying vec3 vWNrm;
  varying vec4 vTer;

  uniform sampler2D uBaseAlb, uBaseNrm;
  uniform sampler2D uRockAlb, uRockNrm;
  uniform vec3 uBaseCol, uGritCol, uRockCol, uRockCol2, uDustCol, uCrustCol;
  uniform vec3 uLagCol, uSheetCol;   // the two ends of grain sorting, 100 m apart
  uniform vec3 uCoverCol;    // what grows on the ground, where anything does
  uniform vec4 uScales;      // tiles/m: base A, base B, rock, near detail
  uniform vec4 uBands;       // rock lo/hi, grit lo/hi  (surface slope)
  uniform vec4 uGround;      // water level, crust amount, damp amount, strata height
  uniform vec4 uMix;         // macro freq A, patch freq B, detail near, detail far
  uniform vec4 uMacro;       // patch freq (1/m), lag gain, sheet gain, occlusion gain
  uniform vec4 uRip;         // wind axis x, z, crest bend (m), ripple gain
  uniform float uRipAspect;  // how far the ripple frame is stretched along the crest
  uniform vec2 uHex;         // stochastic tile: cell size (m), bearing gain
  uniform vec3 uRockUp;      // rock-with-height: gain, y start, y end
  uniform vec3 uCover;       // amount, 1/extent (m), unused
  uniform sampler2D uCoverMap;  // WHERE anything grows — the grass's own field
  uniform vec3 uNrmScale;    // base, near detail, rock
  uniform vec3 uSkyCol;      // the fallback asymptote, when nothing drew a sky
  uniform sampler2D uSkyStrip;  // the DRAWN sky at the skyline, over bearing
  uniform vec2 uHaze;        // extra density gain at range, sky blend

  float thash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float tnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(thash(i), thash(i + vec2(1, 0)), f.x),
               mix(thash(i + vec2(0, 1)), thash(i + vec2(1, 1)), f.x), f.y);
  }
  float tfbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += tnoise(p) * a; p = p * 2.07 + 17.3; a *= 0.5; }
    return s * 1.1428;
  }

  /* The rotation that takes world XZ into a frame whose +x runs along d. */
  mat2 tframe(vec2 d) { return mat2(d.x, -d.y, d.y, d.x); }
  /* How far the flow field is allowed to turn the ripple bearing off the
   * level's own wind. EVERY layer that samples the sand map multiplies THIS
   * number by THE SAME flow, so they all curve together and the fixed offsets
   * between them stay the only angle there is between any two of them. Two
   * layers free to swing independently is a cross-hatch, and a fine
   * cross-hatch over a coarse one is how the dune sea came out as woven
   * matting the first time. tools/checks/terrain.mjs pins both halves. */
  const float TER_SWING = 0.62;
  vec2 tswing(vec2 d, float a) {
    float c = cos(a), s = sin(a);
    return vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  }

  // Rock is jointed, not blown: its two frames stay unrelated to the wind and
  // to each other.
  const mat2 TB_R1 = mat2( 0.9689, 0.2474, -0.2474, 0.9689);
  const mat2 TB_R2 = mat2(-0.1219, 0.9925, -0.9925, -0.1219);

  /* ── stochastic tiling ────────────────────────────────────────────────
   *
   * The ripple map is a 3.3 m tile on a fixed lattice: the same crest breaks,
   * the same pale granule patch, the same dark speck, every 3.3 m along the
   * wind and every 7.9 m across it, over the whole 460 m field. Displacing the
   * sampling phase with a noise (which is what the bend does) moves the repeat
   * but does not remove it — bend varies on a 74 m fbm, so inside any 10 m of
   * ground it is a constant and the repeat there is exact.
   *
   * What the eye actually convicts it on is not the seam, it is that the whole
   * field runs one way at one wavelength — 1.74° of bearing variation across
   * 16 m of floor, measured. So the lattice has to stop existing, and the
   * bearing has to stop being a constant. These two build a hex grid over
   * the ground and give every cell its own phase into the map, its own
   * bearing and its own wavelength. Rotating per CELL is what makes it safe:
   * the frame is rigid inside a cell — the rotation is about the cell centre,
   * so the shear a global spin would introduce, |p|·dθ, is bounded by the cell
   * radius instead of growing with distance from the world origin. (That spin,
   * with its visible eye 150 m out, is the thing this file has already been
   * burned by once.)
   *
   * Hex rather than square because three overlapping cells always cover a
   * point and their barycentric weights are continuous, so there is no seam to
   * place — and the cells that meet at a boundary meet where the third weight
   * is zero, which is also why sampling with explicit gradients is enough to
   * keep the mip chain honest across the join.
   */
  const mat2 TER_SKEW   = mat2(1.0, 0.0, -0.5773503, 1.1547005);
  const mat2 TER_UNSKEW = mat2(1.0, 0.0,  0.5,       0.8660254);

  void terHex(vec2 p, out vec2 c1, out vec2 c2, out vec2 c3, out vec3 w) {
    vec2 s = TER_SKEW * p;
    vec2 b = floor(s);
    vec3 f = vec3(s - b, 0.0);
    f.z = 1.0 - f.x - f.y;
    if (f.z > 0.0) {
      w = vec3(f.z, f.y, f.x);
      c1 = b; c2 = b + vec2(0.0, 1.0); c3 = b + vec2(1.0, 0.0);
    } else {
      w = vec3(-f.z, 1.0 - f.y, 1.0 - f.x);
      c1 = b + vec2(1.0, 1.0); c2 = b + vec2(1.0, 0.0); c3 = b + vec2(0.0, 1.0);
    }
  }

  /**
   * One cell's tap of the ripple map.
   *
   * THREE THINGS VARY, not one, and that is the difference between a ripple
   * field and corduroy. Scrambling only the phase and the bearing leaves one
   * wavelength and one amplitude edge to edge, and the eye counts the repeat
   * off the SPACING long before it notices the angle.
   *
   * This block used to cite "one row of sand autocorrelated at 0.61 against
   * itself 210 px away" as the reason. That number does not survive being
   * measured properly and should not be quoted again: 210 px on the plate it
   * came from is many times the 3.3 m tile, the plate was a shallow view of
   * ground receding to the horizon rather than a top-down one, and a 41 px box
   * detrend leaves a dune's own shading in the residual. On a true orthographic
   * plate (see the lag-plane table further down) the tile leaves no trace at
   * all, even with the hex grid switched off. What the variation below actually
   * buys is measured there, and it is a 10% drop in the ground's self-similarity
   * at the RIPPLE scale — not the removal of a seam, because there was no seam.
   *
   *   · BEARING, from a low-frequency flow field sampled at the cell centre
   *     (~120 m), so the crest lines sweep across the field the way a real
   *     train curves round the ground it is crossing, plus per-cell jitter.
   *   · WAVELENGTH, from a SECOND flow field at a different scale and offset —
   *     ripple spacing tracks grain size, grain sorts itself over the length of
   *     a dune rather than the width of a cell, and two draws off the same map
   *     would just make coarse sand and turned sand the same patches.
   *   · AMPLITUDE, tied to the wavelength field, because coarse ripples are
   *     also deep ripples — the same wind that moves bigger grains piles them
   *     higher. That tie is what stops the variation reading as noise: spacing
   *     and relief change together, which is what makes a patch read as a
   *     different SAND rather than as a different setting.
   *
   * The two flows are gated on uHex.y with the bearing, because a poured deck
   * is not blown by anything: panels at random angles, spacings and depths is a
   * different lie from the one the stochastic tile is telling.
   *
   * dqx and dqy are the screen-space derivatives of the SHARED pre-rotation
   * coordinate, carried through each cell's own frame, so every tap gets the
   * gradient it would have had if its frame were the only one in the shader.
   * They are scaled by the same sc, so the mip chain follows the wavelength.
   */
  void terRipTap(vec2 q, vec2 id, vec2 dqx, vec2 dqy, vec2 aspect,
                 out vec3 col, out vec2 tn, out mat2 frame) {
    vec2 c = (TER_UNSKEW * id) * uHex.x;
    float h1 = thash(id + 0.37), h2 = thash(id * 1.71 + 9.13), h3 = thash(id - 4.21);
    float flowA = tfbm(c * uMix.x * 0.62 + 31.7) - 0.5;   // which way   ~120 m
    float flowL = tfbm(c * uMix.x * 0.83 - 12.4) - 0.5;   // how coarse   ~89 m
    float ang = (flowA * TER_SWING + (h1 - 0.5) * 0.22) * uHex.y;
    // Divided, not multiplied: sc is tiles per metre, so the field reads as a
    // WAVELENGTH spreading either side of the authored one — 0.72× to 1.52× the
    // spacing across the map, against the old 0.87–1.15 that was too narrow to
    // see and far too narrow to break the phase lock between cells. Clamped
    // rather than left to the noise's tails: at half the authored spacing the
    // map is being read past its own texel density and starts to alias.
    float spread = clamp(1.0 + (flowL * 0.62 + (h3 - 0.5) * 0.34) * uHex.y
                             + (h3 - 0.5) * 0.14, 0.72, 1.52);
    float sc = uScales.x / spread;
    float ca = cos(ang), sa = sin(ang);
    frame = mat2(ca, -sa, sa, ca);
    vec2 uv = ((frame * (q - c)) * sc) * aspect + vec2(h1, h2) * 23.0;
    vec2 dx = ((frame * dqx) * sc) * aspect;
    vec2 dy = ((frame * dqy) * sc) * aspect;
    vec3 raw = texture2DGradEXT(uBaseAlb, uv, dx, dy).rgb;
    float amp = clamp(1.0 + (flowL * 1.30 + (h2 - 0.5) * 0.50) * uHex.y, 0.22, 1.55);
    tn = (texture2DGradEXT(uBaseNrm, uv, dx, dy).xy * 2.0 - 1.0) * amp;
    // The albedo follows the relief. Around its own mean, so a flatter patch
    // loses its ripple CONTRAST without changing tone — lifting or dropping the
    // level here would paint the flow field on as a stain.
    col = mix(vec3(dot(raw, vec3(0.2126, 0.7152, 0.0722))), raw, clamp(amp, 0.45, 1.30));
  }

  /**
   * Texture bombing. Two taps of the same map at different scales, chosen per
   * pixel by a macro noise. The choice is sharpened by the albedo itself so the
   * seam interfingers like drifting sand instead of cross-fading the ripples
   * into mush — a straight mix() would average two ripple fields and leave flat
   * grey.
   *
   * The tangent normals are rotated back out of each tap's frame (v * M is
   * transpose(M) * v) so a ripple lights from the direction it actually runs.
   */
  void bombTap(sampler2D alb, sampler2D nrm, vec2 p, float sA, float sB, float w,
               mat2 fA, mat2 fB, out vec3 col, out vec2 tn) {
    vec2 uA = (fA * p) * sA;
    vec2 uB = (fB * p) * sB + vec2(0.41, 0.73);
    vec3 cA = texture2D(alb, uA).rgb;
    vec3 cB = texture2D(alb, uB).rgb;
    float m = smoothstep(-0.13, 0.13, 2.0 * w - 1.0 + (cB.g - cA.g) * 0.55);
    col = mix(cA, cB, m);
    #ifdef TERRAIN_BOMB_NORMAL
      vec2 nA = (texture2D(nrm, uA).xy * 2.0 - 1.0) * fA;
      vec2 nB = (texture2D(nrm, uB).xy * 2.0 - 1.0) * fB;
      tn = mix(nA, nB, m);
    #else
      // one tap only: take whichever tile won the albedo, frame and all
      float pick = step(0.5, m);
      vec2 nP = texture2D(nrm, mix(uA, uB, pick)).xy * 2.0 - 1.0;
      tn = mix(nP * fA, nP * fB, pick);
    #endif
  }
`;

/**
 * Everything the material knows is worked out here, in <map_fragment>, because
 * three's chunk order runs it before roughness and before the normal — and the
 * locals survive into both.
 */
const TERRAIN_FRAG_MAP = /* glsl */`
  vec3 nW = normalize(vWNrm);
  float slope = 1.0 - clamp(nW.y, 0.0, 1.0);
  float viewDist = length(vViewPosition);
  vec2 wp = vWPos.xz;

  // the baked landform channels
  float conc = vTer.x * 2.0 - 1.0;   // + hollow, − crest        (≈8 m)
  float open = vTer.y;               // 0 enclosed, 1 exposed    (≈18 m)
  float upl  = vTer.z * 2.0 - 1.0;   // − basin, + upland        (≈80 m)
  float expo = vTer.w * 2.0 - 1.0;   // − lee, + windward

  float mA = tfbm(wp * uMix.x);      // ≈70 m — the shape of the ground
  float mB = tnoise(wp * uMix.y);    // ≈9 m — ripple patch scale
  float mC = tnoise(wp * 0.85);      // metre scale
  // The patchwork of a sand sea: which SORT of ground this is, at the scale you
  // can see the far side of. Two octaves, because one gives round blobs.
  float mD = tnoise(wp * uMacro.x) * 0.68 + tnoise(wp * uMacro.x * 2.37 + 9.1) * 0.32;

  float hollow = clamp(conc, 0.0, 1.0);
  float crest  = clamp(-conc, 0.0, 1.0);
  float basin  = clamp(-upl, 0.0, 1.0);
  float lee    = clamp(-expo, 0.0, 1.0);
  float encl   = clamp(1.0 - open * 2.0, 0.0, 1.0);   // 1 = down in something

  // ── layer weights: slope decides rock and grit, the landform decides the rest
  // Slope alone cannot decide where rock is on a BENCHED wall: strata put most
  // of the area on near-flat treads and only the thin risers are steep, so an
  // amphitheatre rim came out as pale sand cloth with pencil lines drawn on it
  // while the level's own blurb called it stone. Height above the fighting
  // floor is the other half of the answer, and a preset that has no walls
  // worth speaking of simply leaves the gain at zero.
  float rockW = smoothstep(uBands.x, uBands.y, slope + (mB - 0.5) * 0.14
                           + smoothstep(uRockUp.y, uRockUp.z, vWPos.y) * uRockUp.x);
  float gritW = smoothstep(uBands.z, uBands.w, slope + (mC - 0.5) * 0.09) * (1.0 - rockW);
  // fines blow off the convex windward brinks and settle in the lee and hollows
  float scour = crest * clamp(expo * 1.3 + 0.3, 0.0, 1.0);
  float driftW = clamp(hollow * 1.25 + lee * 0.5 - 0.12, 0.0, 1.0)
               * (1.0 - rockW) * smoothstep(uBands.w * 1.6, 0.0, slope);
  // A crust — salt pan, ash flat, dried silt — takes the flat floor of the
  // basins. Modulated at the macro scale, not the patch scale: a pan is one
  // feature you can see the far side of, not a spatter of light patches.
  float crustW = clamp(uGround.y * smoothstep(0.13, 0.02, slope)
               * smoothstep(0.25, 0.72, basin) * (0.55 + mA * 0.85), 0.0, 1.0);
  // The two ends of grain sorting, at the scale a landscape actually varies on.
  // Wind strips the fines off the exposed ground and leaves a coarse dark lag;
  // it drops them again downwind as pale sheets. Without this the whole map is
  // one hue and no amount of ripple detail rescues it.
  // (the thresholds are quantiles of mD, measured on the real field: it runs
  // 0.16 … 0.86 with p50 at 0.44, so lag takes the top third, sheet the bottom
  // third, and the middle third stays base. Set against the nominal 0…1 range
  // instead, lag only reached full strength in the top tenth of the map.)
  float lagW   = smoothstep(0.47, 0.61, mD + scour * 0.14 - hollow * 0.10)
               * uMacro.y * (1.0 - rockW);
  float sheetW = smoothstep(0.44, 0.28, mD - hollow * 0.10 - lee * 0.08)
               * uMacro.z * (1.0 - rockW);

  /* ── the ripple frame: crests across the wind, bending with the ground.
   *
   * The bend is a DISPLACEMENT along the wind, not a rotation of the frame.
   * Spinning the frame is the obvious way to curve a ripple field and it is
   * wrong: the rotation is about the world origin, so the tile is scaled by
   * |wp| · dθ/dx, and 150 m out from the middle of the map that is a swirl
   * with a visible eye in the centre of it. Sliding the frame along the wind
   * bends the crest lines by a couple of wavelengths — which is what a real
   * ripple field does — and leaves the scale exactly alone.
   */
  mat2 fA = tframe(uRip.xy);
  float bend = ((mB - 0.5) * 1.4 + (mA - 0.5) * 5.5) * uRip.z;

  /* ── the base coat and its ripples.
   *
   * ONE ripple field, running one way, curving with the ground. Bombing two
   * rotated taps of this map and picking the brighter one per pixel — which is
   * what an albedo-sharpened blend amounts to — multiplies the map's two
   * crossing ripple trains into a lattice, and the dune sea comes out as woven
   * matting. So the taps below all sit on the SAME bearing to within a few
   * degrees; what varies between them is phase, wavelength and that handful of
   * degrees, never the axis.
   *
   * Measured on top-down ground plates, block by block through the structure
   * tensor of the gradient — the same shader, the same light, the hex cell
   * simply widened past the map to collapse it back to one lattice:
   *
   *                              arena floor        dune sea
   *   ripple bearing, sd       1.74° → 7.46°     20.1° → 14.2°
   *   amplitude, coeff. of var. 0.118 → 0.148     0.167 → 0.196
   *   gradient coherence         0.87 → 0.75       0.34 → 0.42
   *
   * The arena floor is where the bearing number means anything: coherence 0.87
   * says the field there is one clean directional train, so 1.74° of variation
   * across it is a printed pattern and 7.46° is not. The dune sea reads the
   * other way round because it starts at coherence 0.34 — its bearing estimate
   * is mostly noise before the change and mostly signal after, which is what
   * the coherence rising to 0.42 says.
   *
   * AND THE TILE WAS NEVER THE PROBLEM. That last paragraph used to be a
   * hedge; it is now a measurement, made on a TRUE orthographic top-down plate
   * rendered with its own camera into its own float target rather than by
   * trying to move the game's camera and losing the race with the game's own
   * update (tools/arena-lane.mjs plate). 512 px over 48 m of the arena floor,
   * axis-aligned to the ripple frame so a lag in pixels is a lag in the tile's
   * own coordinates, high-passed in the frequency domain at σ = 2.5 m — which
   * keeps 100% of the 3.33 m tile, 86% of the 7.94 m cross-tile and 7% of a
   * 40 m landform — and autocorrelated on a zero-padded FFT:
   *
   *                              ACF(λ,0)   best in the 0.72–1.52λ band   peak
   *   shipped                      0.021       0.100 @ 2.43 m      0.307 @ 0.94 m
   *   phase scramble only          0.035       0.135 @ 2.33 m      0.346 @ 0.94 m
   *   hex collapsed to ONE cell    0.046       0.122 @ 2.52 m      0.352 @ 0.92 m
   *   CONTROL: this plate's own
   *   λ×μ block stamped out        0.587       0.873 @ 3.36 m      0.968 @ 3.38 m
   *
   * The control is the whole point, and it is why "no repeat found" is a result
   * rather than an absence of evidence: it is what a repeat looks like to this
   * measurement, and the measurement finds it at 0.87. The rendered ground
   * shows 0.10–0.14 in the same band — and shows it even with the hex grid
   * widened past the whole map, which is a single fixed 3.3 m lattice at one
   * bearing over 460 m of terrain. A lattice that leaves no trace in the lag
   * plane is not being seen by anyone, because everything the tap is multiplied
   * by afterwards — bend, ripMask, baseLum, the lag/sheet patchwork at 140 m,
   * the cavity term — varies on scales the repeat does not, and the product
   * never comes back to the same value twice.
   *
   * Nor at the scale the player's boots actually see it. A second plate, 512 px
   * over 16 m from 14 m up — close enough that the near-detail layer is at 85%
   * strength, which the 48 m plate is too far out to include at all — with the
   * high-pass at σ = 1.2 m: shipped 0.009 at (λ,0), phase 0.025, one lattice
   * 0.002, against the same stamped control at 0.492. Three orders of framing
   * and the tile never appears once.
   *
   * So: the stochastic tile is not load-bearing against a SEAM. What it buys is
   * variety, and that is visible in the same plates as a 13% drop in the
   * ground's self-similarity at the RIPPLE scale — the strongest off-origin
   * correlation goes 0.352 (one lattice) → 0.346 (phase only) → 0.307 (shipped)
   * and the whole 0.7–1.5λ band with it. That is the honest size of the effect.
   * Nobody should tune a constant here hoping to move a tiling number: there is
   * no tiling number to move.
   */
  vec2 aspect = vec2(1.0, uRipAspect);
  vec2 pA = fA * wp;  pA.x += bend;
  vec3 baseC;
  vec2 baseN;
  #ifdef TERRAIN_HEX
    // Three cells of the hex grid, blended by a HEIGHT blend rather than by
    // the barycentric weights alone. A straight barycentric mix averages three
    // ripple fields and the desert goes flat and grey in a band round every
    // cell — the same failure the old two-tap bombing had, one dimension up.
    // Adding the tap's own value to its weight and keeping only what is within
    // 0.17 of the winner narrows the transition to a couple of crest widths,
    // where the two fields interfinger the way drifting sand does.
    vec2 dqx = dFdx(pA), dqy = dFdy(pA);
    vec2 id1, id2, id3; vec3 hw;
    terHex(pA / uHex.x, id1, id2, id3, hw);
    vec3 c1, c2, c3; vec2 n1, n2, n3; mat2 fr1, fr2, fr3;
    terRipTap(pA, id1, dqx, dqy, aspect, c1, n1, fr1);
    terRipTap(pA, id2, dqx, dqy, aspect, c2, n2, fr2);
    terRipTap(pA, id3, dqx, dqy, aspect, c3, n3, fr3);
    vec3 hb = hw + vec3(c1.g, c2.g, c3.g) * 0.55;
    vec3 bw = max(hb - (max(hb.x, max(hb.y, hb.z)) - 0.17), 0.0);
    bw /= max(1e-4, bw.x + bw.y + bw.z);
    baseC = c1 * bw.x + c2 * bw.y + c3 * bw.z;
    baseN = (((n1 * aspect) * fr1) * bw.x
           + ((n2 * aspect) * fr2) * bw.y
           + ((n3 * aspect) * fr3) * bw.z) * fA;
  #else
    // Low quality: one tap on the fixed lattice, phase-displaced only. One
    // bearing over the whole map, and that is the price of the tier — the
    // stochastic path is six taps against this one. The second bombing tap
    // below only builds if something enables BOMB_NORMAL without HEX; the
    // shipped tiers turn both on together.
    vec2 uA = (pA * uScales.x) * aspect;
    baseC = texture2D(uBaseAlb, uA).rgb;
    baseN = ((texture2D(uBaseNrm, uA).xy * 2.0 - 1.0) * aspect) * fA;
    #ifdef TERRAIN_BOMB_NORMAL
      mat2 fB = tframe(tswing(uRip.xy, 0.09));
      vec2 pB = fB * wp;  pB.x += bend * 0.7;
      vec2 uB = (pB * uScales.y) * aspect + vec2(0.41, 0.73);
      float w2 = 0.18 + mB * 0.26;
      baseC = mix(baseC, texture2D(uBaseAlb, uB).rgb, w2);
      baseN = mix(baseN, ((texture2D(uBaseNrm, uB).xy * 2.0 - 1.0) * aspect) * fB, w2);
    #endif
  #endif

  // ── detail near the feet: the same map an octave up, gone by ~30 m, so the
  //    ground you stand on has grain and the horizon does not pay for it.
  //    It rides the SAME comb as the ripples. At its own fixed rotation it
  //    crossed them at 50° and four centimetres, and the dune sea came out as
  //    hessian — the finest cross-hatch in the frame beat everything else.
  //    AND IT RIDES THE SAME TWO FLOWS, which is the fix the stochastic tile
  //    above did not reach. This layer is the finest thing on screen and it was
  //    the only one still at one bearing, one wavelength and one amplitude from
  //    the player's boots to thirty metres out — a fixed cross-hatch passing
  //    unchanged under every rock and every shadow, which is exactly what
  //    "corduroy" was describing. The flows are sampled at the WORLD position
  //    rather than at a cell centre, so this layer stays continuous while the
  //    tile it lies over is stochastic, and both curve the same way.
  #ifdef TERRAIN_DETAIL
    float detW = 1.0 - smoothstep(uMix.z, uMix.w, viewDist);
    if (detW > 0.02) {
      float dFlowA = tfbm(wp * uMix.x * 0.62 + 31.7) - 0.5;
      float dFlowL = tfbm(wp * uMix.x * 0.83 - 12.4) - 0.5;
      mat2 fD = tframe(tswing(uRip.xy, -0.19 + dFlowA * TER_SWING * uHex.y));
      vec2 pD = fD * wp;  pD.x += bend * 1.4;
      float dSpread = clamp(1.0 + dFlowL * 0.70 * uHex.y, 0.74, 1.44);
      vec2 ud = (pD * (uScales.w / dSpread)) * aspect;
      vec3 cd = texture2D(uBaseAlb, ud).rgb;
      float dAmp = clamp(1.0 + dFlowL * 1.45 * uHex.y, 0.25, 1.55);
      baseN += ((texture2D(uBaseNrm, ud).xy * 2.0 - 1.0) * aspect) * fD * (detW * uNrmScale.y * dAmp);
      baseC *= mix(1.0, 0.74 + cd.g * 0.58, detW * 0.5 * dAmp);
    }
  #endif

  // ── compose the loose layers. The texture only modulates around 1.0 here, so
  //    the preset colours ARE the albedo; multiplying tint by texture the way
  //    this used to left the sand a saturated orange in every level.
  vec3 col = uBaseCol;
  col = mix(col, uLagCol, lagW);           // the coarse lag, 100 m across
  col = mix(col, uSheetCol, sheetW);       // the pale sheets it blew into
  col = mix(col, uGritCol, min(1.0, gritW * 0.9 + scour * 0.16));
  col = mix(col, uDustCol, driftW * 0.85);
  col = mix(col, uCrustCol, crustW);
  // Ground cover darkens the ground it grows out of — leaf litter, root mat,
  // damp soil. Without it every blade of grass is an isolated green spike
  // standing on bright sand, which is what "hobby project" looks like.
  /* THE MASK IS THE GRASS'S OWN. It used to be a 30 m value noise invented
   * here, while the blades clumped off a 36 m fbm invented in Scenery and the
   * props used no field at all — so the ground could be painted green where
   * nothing grew and left bare where the grass stood, and "how much of this
   * level is covered" had three different answers. One field now, baked to a
   * texture by makeCoverField and handed down by the grass, which is also the
   * only way cover reaches past the instanced field's outer radius: this runs
   * to the edge of the heightfield for nothing. */
  if (uCover.x > 0.001) {
    float cov = uCover.x * texture2D(uCoverMap, wp * uCover.y + 0.5).r
              * smoothstep(0.30, 0.08, slope)
              * smoothstep(uGround.x - 0.35, uGround.x + 0.45, vWPos.y);
    col = mix(col, uCoverCol, cov);
  }
  /* How hard this patch of ground is combed at all.
   *
   * Amplitude is the other half of breaking a repeat, and it is the half a
   * stochastic lookup cannot do: scramble the phase all you like and a field
   * that ripples equally hard from the toe of the dune to the horizon still
   * reads as one printed pattern. Real ripple fields die out over smooth
   * sheets and pick up again over coarser ground, at the scale of the grain
   * sorting — which is exactly what mD already measures, so the mask costs
   * nothing and agrees with the lag and sheet patches instead of fighting them.
   */
  float ripMask = 0.45 + 0.95 * smoothstep(0.22, 0.74, mD + (mA - 0.5) * 0.22);

  // cavity: the map's own troughs, which is what the ripple relief is made of.
  // Pulled toward the map's own mean (0.389 by calibration) where the field is
  // barely rippled, so a smooth sheet loses its tonal banding as well as its
  // relief rather than staying a flat-lit corduroy.
  float baseLum = mix(0.389, dot(baseC, vec3(0.3333)), 0.62 + ripMask * 0.27);
  col *= 0.55 + baseLum * 1.15;

  // ── rock, and the strata it is bedded in. Skipped wholesale where nothing is
  //    steep — on the dune sea that is the entire map, and it is four taps
  //    (six where the cliff re-projection runs).
  //    Loose fines are the roughest thing in the game; packed lag and a dried
  //    pan are smooth enough to actually catch the sun, which is where a dune
  //    sea gets its sheen from at a low sun.
  float terRough = mix(0.955, 0.99, driftW) - lagW * 0.08 - baseLum * 0.05;
  float ny = max(abs(nW.y), 0.28);
  vec3 Txz = normalize(vec3(ny, -nW.x, 0.0));
  vec3 Bxz = normalize(vec3(0.0, -nW.z, ny));
  float nFade = 1.0 - smoothstep(90.0, 300.0, viewDist) * 0.75;
  // damp ground near the waterline and in the wet bottoms
  float wet = clamp(smoothstep(uGround.x + 0.7, uGround.x - 0.3, vWPos.y)
            + uGround.z * smoothstep(0.55, 1.0, basin) * smoothstep(0.22, 0.03, slope) * 0.55,
            0.0, 1.0);
  // Ripples are a windward phenomenon: the slip face avalanches smooth, the
  // hollows fill with fines, a crust does not ripple at all, and sand the river
  // has been over is packed flat.
  float baseAmp = uRip.w * ripMask * mix(1.0, 0.45, driftW) * mix(1.0, 1.3, scour)
                * mix(1.0, 0.5, crustW) * nFade * (1.0 - wet * 0.85)
                * mix(1.0, 0.42, lee * smoothstep(0.05, 0.17, slope));
  vec3 terNrmOff = (Txz * baseN.x + Bxz * baseN.y) * (baseAmp * (1.0 - rockW));

  if (rockW > 0.004) {
    vec3 rockC; vec2 rockN;
    bombTap(uRockAlb, uRockNrm, wp, uScales.z, uScales.z * 0.53,
            clamp(mA * 1.7 - 0.35, 0.0, 1.0), TB_R1, TB_R2, rockC, rockN);

    float bedY = (vWPos.y + sin(vWPos.y * 0.41) * 1.25
                 + (mA - 0.5) * 4.0 + (mB - 0.5) * 0.9) / uGround.w;
    float bandI = floor(bedY), bandF = bedY - bandI;
    float bandR = thash(vec2(bandI, 7.3));
    float seam = (smoothstep(0.11, 0.0, bandF) + smoothstep(0.89, 1.0, bandF))
               * (0.25 + thash(vec2(bandI, 21.7)) * 1.1);
    // Beds differ from each other more than the rock inside one bed differs
    // from itself. That ordering is what makes a wall read as bedded; with the
    // fracture network louder than the bedding it reads as cork.
    vec3 rockTint = mix(uRockCol, uRockCol2, bandR) * (0.72 + bandR * 0.58) * (1.0 - seam * 0.34);

    col = mix(col, rockTint * (0.74 + dot(rockC, vec3(0.3333)) * 0.68), rockW);
    terRough = mix(terRough, 0.88, rockW);
    terNrmOff += (Txz * rockN.x + Bxz * rockN.y) * (uNrmScale.z * rockW * nFade);

  #ifdef TERRAIN_CLIFF
    // A cliff seen from above is the one place an XZ projection falls apart —
    // an 80° riser stretches the rock six to one. Re-project it onto the
    // vertical plane along the wall, with a tangent frame to match, so the
    // strata run along the face instead of smearing down it.
    float vface = smoothstep(0.42, 0.78, slope);
    if (vface > 0.02) {
      vec2 hn = nW.xz;
      vec2 tang = vec2(-hn.y, hn.x) / (length(hn) + 1e-4);
      // Squashed vertically, so the joint network comes out elongated ALONG
      // the bedding instead of as isotropic worms crawling over the face.
      vec2 vuv = vec2(dot(wp, tang) * 0.60, vWPos.y * 1.55) * uScales.z;
      vec3 cv = texture2D(uRockAlb, vuv).rgb;
      vec2 nv = texture2D(uRockNrm, vuv).xy * 2.0 - 1.0;
      vec3 Tv = vec3(tang.x, 0.0, tang.y);
      vec3 Bv = cross(Tv, nW);
      float k = vface * rockW;
      col = mix(col, rockTint * (0.74 + dot(cv, vec3(0.3333)) * 0.68), k);
      terNrmOff = mix(terNrmOff, (Tv * nv.x + Bv * nv.y) * (uNrmScale.z * nFade), k);
    }
  #endif
  }

  // Macro tone anchored to the landform rather than to noise alone: uplands
  // bleach, basins hold the darker fines, and mA keeps it off the vertex grid.
  col *= 0.90 + mA * 0.22 + upl * 0.07 - basin * 0.06 + open * 0.05;
  col *= mix(1.0, 0.62, wet);

  diffuseColor = vec4(col, opacity);

  terRough = mix(terRough, 0.62, crustW * 0.7);
  terRough = mix(terRough, 0.24, wet);

  /*
   * How much sky this point can actually see.
   *
   * The ground had none of this, and it is the single reason it read as a
   * painted plane: every hollow, gully, dune trough and ripple was receiving
   * the full hemisphere plus the full probe, so nothing on the surface had any
   * form except what N·L gave it — and at a 26° sun N·L barely varies across a
   * dune at all. Three scales feed it: the landform hollows (metres), how
   * enclosed the spot is (tens of metres), and the map's own cavity, which is
   * the ripple relief itself and is faded out with range along with the
   * normals it belongs to.
   */
  float cav = clamp(baseLum * 1.30 - 0.12, 0.0, 1.0);
  // rock keeps its relief in its normal map and its joints in its albedo;
  // a cavity term on top of both turns a cliff into cracked lava
  float cavW = (1.0 - smoothstep(24.0, 85.0, viewDist)) * (1.0 - rockW);
  float terAO = clamp(1.0
        - (hollow * 0.30 + encl * 0.20 + driftW * 0.10) * uMacro.w
        - (0.50 - cav) * 0.26 * cavW
        + crest * 0.05,
        0.28, 1.06);
`;

const TERRAIN_FRAG_ROUGH = /* glsl */`
  float roughnessFactor = roughness * terRough;
`;

/**
 * three applies AO to the indirect term only, which is exactly right: the sun
 * is a single direction and its occlusion is the shadow map's job.
 */
const TERRAIN_FRAG_AO = /* glsl */`
  reflectedLight.indirectDiffuse *= terAO;
  reflectedLight.indirectSpecular *= terAO;
`;

const TERRAIN_FRAG_NORMAL = /* glsl */`
  normal = normalize(mat3(viewMatrix) * normalize(nW + terNrmOff));
`;

/**
 * Aerial perspective — the ground has to sit in the SAME air as everything
 * standing on it.
 *
 * The engine replaces three's fog chunk wholesale (see AERIAL in Engine.js):
 * extinction is integrated along the view ray through an exponential haze
 * layer, because haze is a fluid in a gravity well and a rim 68 m up sits in a
 * column a third as deep as the valley floor, and the tone carries a lit
 * forward-scatter lobe. Every other material in the frame gets that.
 *
 * This chunk used to ignore all of it: uniform density integrated along the raw
 * view depth, then multiplied by up to 1.8 again with range. Measured against
 * the engine's own integral on the arena rim, from an eye 3.2 m up, with the
 * level's fogDensity of 0.0034:
 *
 *   mid-wall, 184 m out, 40 m up    fogFactor 0.427   engine 0.127
 *   the brink, 215 m out, 68 m up   fogFactor 0.621   engine 0.099
 *
 * — so the ground was three to six times more fogged than the colonnade
 * standing in front of it, and worse the higher it went, which is backwards.
 * With scene.fog metered off the sky (linear luminance 3.19, near neutral) that
 * took the amphitheatre wall from 0.399 display luminance / 0.541 saturation —
 * warm sandstone, the sand's own hue family, correctly a shade darker than the
 * floor, which is what it renders as with the fog off — to 0.781 / 0.149 at the
 * near end of the wall and 0.930 / 0.124 at the far end. Chalk. The albedo was
 * never the problem; the air in front of it was.
 *
 * So: the engine's integral verbatim, and the ground keeps exactly one licence
 * to differ — a slow lift in density past 160 m. It needs that because
 * scene.fog never touches the Sky material, so a rim meeting the sky with no
 * extra veil at all is a hard faceted polyline against it, which is the one
 * thing that gives away a 1.5 m quad grid.
 *
 * ── AND THE AIR HAS A DIRECTION ───────────────────────────────────────────
 *
 * Two things here used to make a hundred and seventy metres of desert air do
 * essentially nothing to the surface that fills 60% of the frame.
 *
 * 1. THE ASYMPTOTE WAS ONE COLOUR FOR THE WHOLE DOME — the level's authored
 *    `skyColor` swatch, which is the blue overhead, standing in for the sky in
 *    every direction. A skyline is not that colour anywhere. Modelled on the
 *    arena's own atmosphere through the engine's tone curve, sand at 20 m
 *    against sand at 200 m:
 *
 *                        60 m    90 m   120 m   160 m   200 m   240 m
 *      saturation       0.337   0.252   0.151   0.057   0.164   0.222
 *      hue                27°     25°     17°    288°    230°    222°
 *
 *    The saturation does not fall — it falls THROUGH zero and comes back up
 *    the other side, because the target is a saturated blue on the far side of
 *    neutral from the sand. Distance was not desaturating the desert, it was
 *    re-saturating it as a different colour, and it shows on the shipped frame:
 *    the arena's rim wall at 170 m reads hue 348° at 0.13 saturation, and the
 *    bowl floor at 110 m reads hue 340–348° at 0.05–0.06 over two runs.
 *    Deserts do not go magenta with range.
 *
 *    So the asymptote is now THE DRAWN SKY IN THE VIEW DIRECTION, read out of
 *    ground.skyBand — the same array SkyDome bakes for its own horizon and
 *    Scenery's far ranges converge on, so the ground and the ranges cannot
 *    disagree about the air they are both seen through. Same sweep, after:
 *
 *      saturation       0.339   0.267   0.203   0.136   0.083   0.052
 *      hue                27°     26°     26°     25°     23°     20°
 *
 * 2. THE INSCATTER HAD NO ENERGY LIMIT. Every other material in the game gets
 *    the engine's capped form (see AERIAL in Engine.js): the phase function
 *    peaks at 6.0 at g = 0.5, so an uncapped lobe lets the haze add several
 *    times its own colour. The ground alone was adding it raw — the one
 *    surface allowed to glow brighter, toward the sun, than the air standing
 *    in front of the colonnade on top of it.
 */
const TERRAIN_FRAG_FOG = /* glsl */`
  #ifdef USE_FOG
    float fogRadial = length(vFogRay);
    float fogPath = vFogDepth;
    if (uAerialShape.x > 0.0) {
      float y0 = clamp(cameraPosition.y - uAerialShape.y, -40.0, 600.0);
      float k = vFogRay.y * uAerialShape.x;
      float t0 = exp(-y0 * uAerialShape.x);
      float m = abs(k) < 1.0e-3 ? t0 : t0 * (1.0 - exp(-k)) / k;
      fogPath = fogRadial * clamp(m, 0.0, 6.0) * uAerialShape.w;
    }
    #ifdef FOG_EXP2
      float hazeD = fogDensity * (1.0 + uHaze.x * smoothstep(160.0, 460.0, fogRadial));
      float fogFactor = 1.0 - exp(-hazeD * hazeD * fogPath * fogPath);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, fogPath);
    #endif
    vec3 fogTone = fogColor;
    if (uAerialSun.w > 0.0) {
      vec3 fogDir = vFogRay / max(fogRadial, 1.0e-4);
      float fogCos = dot(fogDir, uAerialSun.xyz);
      float g = uAerialTint.w, g2 = g * g;
      float phase = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * fogCos, 1.0e-4), 1.5);
      vec3 fogGlow = uAerialTint.xyz * uAerialSun.w * (phase + 0.75 * (1.0 + fogCos * fogCos) * 0.16);
      // The engine's energy limit, verbatim. Uncapped, the ground was the one
      // surface in the frame free to add several times the haze's own colour
      // on the sunward side.
      vec3 fogCap = max(fogColor, vec3(1.0e-4)) * 0.26;
      fogTone += fogCap * (1.0 - exp(-fogGlow / fogCap));
    }
    // What the far ground actually converges ON: the sky IN THIS DIRECTION.
    //
    // scene.fog is not the sky. The engine meters the fog swatch off the sky's
    // radiance at the skyline and then renormalises it, and on the arena that
    // lands at linear luminance 3.19 while the sky RENDERS in the same frame at
    // 0.67 display luminance — the rim wall dissolving into it came out at
    // 0.80, brighter than the sky immediately above it, which is not something
    // a passive surface behind a scattering medium can be. So the near field
    // takes the haze's tone, which is right, and the far field is walked onto
    // the strip: 64 bearings of the DRAWN sky at the skyline, straight out of
    // ground.skyBand, so the sand and the ranges standing on the same horizon
    // dissolve into the same air rather than into two different guesses at it.
    float fogAz = atan(vFogRay.z, vFogRay.x) * 0.15915494 + 0.5;
    vec3 fogSky = texture2D(uSkyStrip, vec2(fogAz, 0.5)).rgb;
    fogTone = mix(fogTone, fogSky, smoothstep(50.0, 230.0, fogRadial) * uHaze.y);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTone, fogFactor);
  #endif
`;

/* ══════════════════════════════════════════════════════════════════════ */

export class Terrain {
  constructor(scene, presetName = 'dunes', quality = 1) {
    const preset = TERRAIN_PRESETS[presetName] || TERRAIN_PRESETS.dunes;
    this.preset = preset;
    /* The NAME, not just the table row. Anything that has to be different from
     * level to level and has only the terrain to ask — the grass's cover field
     * is the first — needs a per-level seed, and reading it off the preset
     * object means two levels on one preset agree, which is the right answer
     * for a heightfield and the right answer for what grows on it. */
    this.presetKey = TERRAIN_PRESETS[presetName] ? presetName : 'dunes';
    this.quality = clamp(quality, 0.4, 1.6);
    this.size = preset.scale;
    this.res = Math.max(64, Math.floor(preset.res * this.quality));
    this.half = this.size / 2;
    this.step = this.size / (this.res - 1);
    this.invStep = 1 / this.step;
    this.waterLevel = preset.waterLevel;
    this.friction = 0.95;

    this.heights = new Float32Array(this.res * this.res);
    this.deform = new Float32Array(this.res * this.res);
    /** Bumped by every crater, so the physics heightfield can tell it is stale. */
    this.deformSeq = 0;

    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        const x = -this.half + i * this.step;
        const z = -this.half + j * this.step;
        this.heights[j * this.res + i] = preset.height(x, z);
      }
    }

    this._bakeLandform();
    this._buildMesh(scene);
    this._dirtyRegion = null;
    // Published before anything else in the level is built, so the water knows
    // the shape of its own bed and decals land at the right altitude even on
    // the levels that have no grass to publish it for them.
    ground.terrain = this;
  }

  /* ── landform analysis ─────────────────────────────────────────────── */

  /** Separable box blur of the height grid, radius in cells, edges clamped. */
  _blur(src, r) {
    const R = this.res;
    r = Math.max(1, Math.min(r | 0, R - 1));
    const tmp = new Float32Array(R * R), out = new Float32Array(R * R);
    const w = 1 / (2 * r + 1);
    for (let j = 0; j < R; j++) {
      const row = j * R;
      let sum = src[row] * (r + 1);
      for (let i = 1; i <= r; i++) sum += src[row + Math.min(i, R - 1)];
      for (let i = 0; i < R; i++) {
        tmp[row + i] = sum * w;
        sum += src[row + Math.min(i + r + 1, R - 1)] - src[row + Math.max(i - r, 0)];
      }
    }
    for (let i = 0; i < R; i++) {
      let sum = tmp[i] * (r + 1);
      for (let j = 1; j <= r; j++) sum += tmp[Math.min(j, R - 1) * R + i];
      for (let j = 0; j < R; j++) {
        out[j * R + i] = sum * w;
        sum += tmp[Math.min(j + r + 1, R - 1) * R + i] - tmp[Math.max(j - r, 0) * R + i];
      }
    }
    return out;
  }

  /** Box average of the live heights around one cell — the incremental form of
   *  the small blur, so a crater can refresh its own concavity channel. */
  _localMean(i, j, r) {
    let sum = 0;
    const n = (2 * r + 1) * (2 * r + 1);
    for (let jj = j - r; jj <= j + r; jj++)
      for (let ii = i - r; ii <= i + r; ii++) sum += this.heights[this._idx(ii, jj)];
    return sum / n;
  }

  /**
   * Four bytes per vertex that say where on the landform this point sits:
   * concavity, openness, elevation against the surrounding land, and exposure
   * to the prevailing wind. Everything the material does with slope, hollows,
   * basins and lee faces reads from here, so the variation follows the terrain
   * instead of floating over it as unrelated noise.
   */
  _bakeLandform() {
    const R = this.res, n = R * R, H = this.heights;
    const cells = (metres) => Math.max(1, Math.round(metres / this.step));
    this._rS = cells(8);
    // 8 m for hollows you can stand in, 18 m for how enclosed a spot is, and a
    // double pass at 50 m — a tent kernel about 80 m wide — for which basin or
    // upland you are on. That last one is the 50-200 m macro variation the
    // material needs and noise cannot supply, because it has to agree with the
    // ground the player is walking over.
    const blurS = this._blur(H, this._rS);
    const blurM = this._blur(H, cells(18));
    const blurL = this._blur(this._blur(H, cells(50)), cells(50));

    // scale each channel by its own spread so every preset — a 1 m dune pan and
    // a 70 m arena rim — lands on the same 0..1 range the shader expects
    const sd = (f) => {
      let s = 0, ss = 0;
      for (let k = 0; k < n; k++) { const v = f(k); s += v; ss += v * v; }
      const m = s / n;
      return Math.sqrt(Math.max(1e-6, ss / n - m * m));
    };
    this._kConc = 0.5 / (2 * sd((k) => blurS[k] - H[k]));
    const kOpen = 1 / (2 * sd((k) => H[k] - blurM[k]));
    const kUpl = 0.5 / (2 * sd((k) => H[k] - blurL[k]));

    const wind = this.preset.wind || [1, 0];
    const wl = Math.hypot(wind[0], wind[1]) || 1;
    const wx = wind[0] / wl, wz = wind[1] / wl;

    const ter = new Uint8Array(n * 4);
    const inv2 = 1 / (2 * this.step);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const k = j * R + i;
        ter[k * 4] = clamp(0.5 + (blurS[k] - H[k]) * this._kConc, 0, 1) * 255;
        ter[k * 4 + 1] = clamp(0.5 + (H[k] - blurM[k]) * kOpen, 0, 1) * 255;
        ter[k * 4 + 2] = clamp(0.5 + (H[k] - blurL[k]) * kUpl, 0, 1) * 255;
        // aspect: the uphill direction of the landform, dotted with the wind
        const gx = (blurM[this._idx(i + 1, j)] - blurM[this._idx(i - 1, j)]) * inv2;
        const gz = (blurM[this._idx(i, j + 1)] - blurM[this._idx(i, j - 1)]) * inv2;
        const gl = Math.hypot(gx, gz);
        const e = gl > 1e-4 ? (gx * wx + gz * wz) / gl : 0;
        ter[k * 4 + 3] = clamp(0.5 + e * 0.5 * smoothstep(0.02, 0.22, gl), 0, 1) * 255;
      }
    }
    this.landform = ter;
  }

  /* ── mesh ──────────────────────────────────────────────────────────── */

  /**
   * One texture set per surface family. Every UV is computed in world space in
   * the shader, so the `repeat` these are asked for is irrelevant to us — pass
   * the same value the props use so the cache is shared. (metalMaps in
   * particular re-bakes 512² for every distinct repeat it is handed.)
   */
  _mapSet() {
    if (this.preset.maps === 'deck') return [duracreteMaps(2), metalMaps(2)];
    return [sandMaps(1), rockMaps(2)];
  }

  _buildMesh(scene) {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res - 1, this.res - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    for (let k = 0; k < this.res * this.res; k++) pos.setY(k, this.heights[k]);
    // Analytic normals, the same central difference normalAt() uses. Area
    // weighted face normals disagree with it just enough that a crater — which
    // does use the analytic form — used to leave a shading seam at its rim.
    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        this._vertexNormal(i, j, _tv);
        nrm.setXYZ(j * this.res + i, _tv.x, _tv.y, _tv.z);
      }
    }
    const ter = new THREE.BufferAttribute(this.landform, 4, true);
    // craters rewrite all three of these in place
    pos.setUsage(THREE.DynamicDrawUsage);
    nrm.setUsage(THREE.DynamicDrawUsage);
    ter.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTer', ter);
    geo.computeBoundingSphere();
    this.geometry = geo;

    const [base, rock] = this._mapSet();
    const P = this.preset;
    const C = (hex) => new THREE.Color(hex);
    const detail = P.detail || [1.0, 30];
    const macro = P.macro || [140, 0.5, 0.4, 1.0];
    // The ripple frame runs ALONG the wind, because the ripple crests in the
    // map run across its u axis. Normalised here so a preset can write a wind
    // vector of any length.
    const w = P.wind || [1, 0];
    const wl = Math.hypot(w[0], w[1]) || 1;

    // The heightfield is 560 m across and one tile is metres, so every UV is
    // computed in world space in the shader; the material carries no maps of
    // its own and three's uv plumbing stays out of the way.
    this._uniforms = {
      uBaseAlb: { value: base.map }, uBaseNrm: { value: base.normalMap },
      uRockAlb: { value: rock.map }, uRockNrm: { value: rock.normalMap },
      uBaseCol: { value: C(P.sandColor) },
      uGritCol: { value: C(P.gritColor ?? P.sandColor) },
      uRockCol: { value: C(P.rockColor) },
      uRockCol2: { value: C(P.rockColor2 ?? P.rockColor) },
      uDustCol: { value: C(P.dustColor ?? P.sandColor) },
      uCrustCol: { value: C(P.crustColor ?? P.sandColor) },
      uLagCol: { value: C(P.lagColor ?? P.gritColor ?? P.sandColor) },
      uSheetCol: { value: C(P.sheetColor ?? P.dustColor ?? P.sandColor) },
      // Rock at 0.115 tiles/m is a 8.7 m tile, and the map's joint network is
      // 11 cells across it — 79 cm blocks, which at the amplitude this used to
      // run at read as tooled leather rather than as broken stone. Half the
      // tile puts the joints at 40 cm, where they read as joints.
      uScales: { value: new THREE.Vector4(...(P.texScale || [0.30, 0.175, 0.215]), detail[0]) },
      uBands: { value: new THREE.Vector4(...(P.slopeBands || [0.2, 0.5, 0.08, 0.26])) },
      uGround: { value: new THREE.Vector4(this.waterLevel, P.crust ?? 0, P.damp ?? 0, P.strataH ?? 3.5) },
      // The ripple patch used to be 21 m across, which is why the ground came
      // out as corduroy: within a patch one tap wins outright and its crests
      // rule 21 metres of perfectly parallel lines. At 9 m the two taps
      // interfinger the way a real ripple field bifurcates.
      uMix: { value: new THREE.Vector4(1 / 74, 1 / 9, detail[1] * 0.35, detail[1]) },
      uMacro: { value: new THREE.Vector4(1 / macro[0], macro[1], macro[2], macro[3]) },
      uRip: { value: new THREE.Vector4(w[0] / wl, w[1] / wl, 1.0, P.ripple ?? 1.0) },
      // The sand map carries two ripple trains crossing at 33°, which is
      // a diamond lattice — matting, not sand. Stretching the sampling frame
      // along the crests pulls both trains toward the same bearing, where they
      // beat into crests that fade in and out along their length instead. It
      // is also the right shape: an aeolian ripple crest is ten times longer
      // than the ripple is wide, and the map's are two wavelengths long.
      uRipAspect: { value: P.ripAspect ?? 0.42 },
      // The stochastic tile: cell size in metres, and how much of a bearing
      // the cells are allowed to draw. 2.4 tiles per cell is the compromise —
      // wider and the same motif still turns up twice inside one glance,
      // narrower and you spend the blend band, which is ~15% of the area, on
      // ground that is a mix of three taps rather than one clean field.
      // A poured deck is not blown by anything, so it gets the phase scramble
      // and none of the bearing: panels at random angles is a different lie.
      uHex: { value: new THREE.Vector2(2.4 / (P.texScale ? P.texScale[0] : 0.30), P.flat ? 0.0 : 1.0) },
      uRockUp: { value: new THREE.Vector3(...(P.rockUpland || [0, 0, 1])) },
      uCover: { value: new THREE.Vector3(0, 1 / this.size, 0) },
      uCoverMap: { value: this._coverDefault = flatTexture(255) },
      uCoverCol: { value: new THREE.Color(0x3c4223) },
      // base ripple, near grain, rock. The rock figure used to be 1.35, which
      // added up to a 53 degree tilt on a unit normal: every joint in the map
      // came out as a rope lying on the cliff rather than as a crack in it.
      uNrmScale: { value: new THREE.Vector3(1.15, 0.85, 0.70) },
      uSkyCol: { value: new THREE.Color(0xcfe0f5) },
      uSkyStrip: { value: this._strip = skyStripTexture() },
      uHaze: { value: new THREE.Vector2(0.8, 0.7) },   // re-read every frame
    };

    const mat = new THREE.MeshStandardMaterial({
      roughness: 1, metalness: 0,
      color: 0xffffff,
      dithering: true,
    });

    // Quality buys texture taps, not triangles: the ground is one draw call and
    // the fragment cost is what actually scales.
    const defs = [];
    if (this.quality >= 0.7) defs.push('#define TERRAIN_BOMB_NORMAL');
    if (this.quality >= 0.7) defs.push('#define TERRAIN_DETAIL');
    // Stochastic tiling is three taps of the albedo and three of the normal
    // against the fixed lattice's one and one, and it replaces the second
    // bombing tap outright — so the ground goes from four base taps to six at
    // this tier, and stays at one below it.
    if (this.quality >= 0.7) defs.push('#define TERRAIN_HEX');
    if (this.quality >= 0.95 && this.preset.cliffs) defs.push('#define TERRAIN_CLIFF');
    const prelude = defs.join('\n') + (defs.length ? '\n' : '');

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this._uniforms);
      shader.vertexShader = prelude + shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_COMMON}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TERRAIN_VERT_BODY}`);
      shader.fragmentShader = prelude + shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_COMMON}`)
        .replace('#include <map_fragment>', TERRAIN_FRAG_MAP)
        .replace('#include <roughnessmap_fragment>', TERRAIN_FRAG_ROUGH)
        .replace('#include <normal_fragment_maps>', TERRAIN_FRAG_NORMAL)
        .replace('#include <aomap_fragment>', TERRAIN_FRAG_AO)
        .replace('#include <fog_fragment>', TERRAIN_FRAG_FOG);
      this._shader = shader;
    };

    // castShadow alone was a no-op here. three renders the shadow pass with
    // `shadowSide[material.side]`, which maps FrontSide → BackSide — the usual
    // front-face-cull trick for closed meshes. A heightfield is a single sheet:
    // culling its front faces removes it from the shadow map entirely, and the
    // frame came out byte-for-byte identical to castShadow = false. Measured on
    // the dune sea at a 26° sun: ground mean luminance 150 with the flag on and
    // the default side, 141 once the depth pass actually rasterises it.
    //
    // No depth bias of our own. The terrain's self-shadow at that sun angle
    // lives inside a ~15 cm depth window, so a normal offset big enough to
    // matter for acne (step × 0.09 ≈ 15 cm) put the frame back to 150 — it
    // erased exactly the shadows it was there to clean up. The light's own
    // bias is doing the job and no striping is visible at ground level.
    mat.shadowSide = THREE.FrontSide;

    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    scene.add(this.mesh);

    this._scene = scene;
    scene.traverse((o) => { if (o.isHemisphereLight) this._hemi = o; });
    this._syncAtmosphere();
  }

  /**
   * The horizon colour the far ground dissolves into, taken from the level.
   * The atmosphere is applied after the terrain is built and can change between
   * levels, so this is re-read rather than captured.
   *
   * The LEVEL comes from the sky and the HUE is half sky, half dust — and the
   * dust half is renormalised to the sky's luminance before it is mixed in, so
   * it can only ever swing the cast.
   *
   * It cannot come from scene.fog, which is the obvious place to look for it.
   * The engine meters that swatch off the sky's radiance at the skyline and
   * then renormalises it, and on the arena it lands at linear luminance 3.19
   * while the sky RENDERS at 0.67 display luminance in the same frame — five
   * times the level of the thing it is standing in for. Anchored there, the far
   * rim came out at 0.80 against a 0.69 sky: brighter than what it was
   * dissolving into, which for a passive surface behind a scattering medium is
   * not a matter of taste, it is impossible.
   *
   * The old ×1.55 on the hemisphere light was much closer to the truth than the
   * fog was — it just never had the weight to matter, because the blend that
   * used it topped out at 22% by 200 m and the extinction in front of it was
   * four times too strong.
   */
  _syncAtmosphere() {
    const u = this._uniforms;
    if (!u) return;
    const fog = this._scene && this._scene.fog;
    /* THE SKY THE GROUND IS SEEN THROUGH, over bearing.
     *
     * ground.skyBand is what SkyDome baked for its own horizon and what
     * Scenery's far ranges converge on. Reading the DATA rather than deriving a
     * sky of our own is the whole point: the sand at 200 m and the range behind
     * it meet on the same line of the frame, and two derivations that could
     * disagree would disagree exactly where the eye is already looking.
     *
     * Row 0 of the band is the skyline itself — sin(el) at the row centre is
     * 0.0225, i.e. 1.3° up — which is where ground at any believable range is
     * dissolving. Rebuilt on identity, because configure() hands over a fresh
     * object per level and nothing else can change it. */
    const band = ground.skyBand;
    if (band && band !== this._bandRef) {
      this._bandRef = band;
      writeSkyStrip(this._strip, band);
    }
    if (this._hemi) {
      // The LEVEL comes from the sky the level authored, not from the fog.
      const s = u.uSkyCol.value.copy(this._hemi.color).multiplyScalar(SKY_GAIN);
      if (fog) {
        // Half the HUE is the dust, though: a desert skyline is not the blue
        // overhead. Matched to s's own luminance first so the lerp cannot move
        // the level, only the cast.
        const L = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
        _tc.copy(fog.color).multiplyScalar(L(s) / Math.max(1e-3, L(fog.color)));
        s.lerp(_tc, 0.5);
      }
    }
    // NOTHING DREW A SKY — a Terrain built without an Engine, which is every
    // headless check and every unit test. Fall back to the authored tint, the
    // same colour in every bearing, so the chunk still has an asymptote and this
    // path stays the one the checks exercise. Outside the hemisphere branch on
    // purpose: a scene with neither a band nor a hemisphere light would
    // otherwise leave the strip at its constructed value forever, and "forever"
    // is the kind of default that only shows up on the one level that has no
    // hemisphere. Keyed on the colour, so a level change reaches the strip and a
    // still frame costs nothing.
    if (!band) {
      const s = u.uSkyCol.value, key = s.r * 4096 + s.g * 64 + s.b;
      if (key !== this._stripFlat) { this._stripFlat = key; writeSkyStrip(this._strip, null, s); }
    }
    /* Indoors there is no horizon to dissolve into, and the level's fog is
     * already thick enough to close the room off; leave it alone.
     *
     * THE TEST IS THE AUTHORED DENSITY, NOT THE CURRENT ONE, and that is worth
     * a paragraph because the naive version cost the game its weather. This
     * runs every frame from flush(), so `fog.density > 0.01` was a runtime
     * threshold sitting directly under a squall: the dune sea asks for 0.0193
     * at the peak of a front against an authored 0.0042, so every storm would
     * have hard-switched the ground's aerial term off on the way in and back on
     * on the way out — a pop, on a threshold, in a system that has no idea
     * weather exists. Scenery's Weather CAPPED ITSELF at 0.0098 to stay under
     * it, which cost the dune sea half its visibility loss: the whole squall
     * moved the arena's median frame luminance by 5%.
     *
     * Weather may only ever ADD to what the level authored (see _applyWeather),
     * so the smallest density this fog object has ever carried IS the authored
     * one. Keyed on object identity, because a level change swaps the fog. */
    if (fog !== this._fogRef) { this._fogRef = fog; this._fogFloor = fog ? fog.density : 0; }
    else if (fog) this._fogFloor = Math.min(this._fogFloor, fog.density);
    const indoor = this.preset.flat || (fog && this._fogFloor > 0.01);
    // 0.30, not 0.80. This is a nudge to keep the skyline from reading as a
    // cut edge against a sky the fog cannot reach; at 0.80 it was doubling the
    // optical depth of everything past 250 m on top of an integral that was
    // already right, which is how the rim turned to chalk.
    u.uHaze.value.set(indoor ? 0 : 0.30, indoor ? 0 : SKY_BLEND);
  }

  /**
   * Tell the ground that something grows on it.
   *
   * A field of grass standing on bright bare sand reads as green spikes stuck
   * into a beach, however many blades you spend, because the eye takes its
   * reading of "cover" from the ground TONE, not from the blades. The grass
   * hands its own colour and patch scale over here and the terrain darkens
   * itself under the cover to match — one lerp in the shader, and the field
   * stops looking like a pincushion.
   *
   * @param {number} amount   0 for bare ground, ~0.5 for real cover
   * @param {number|THREE.Color} colour   the litter/soil tone under the cover
   * @param {number} metres   patch scale — only read when there is no map
   * @param {THREE.Texture} [map]  the cover field, baked over the heightfield's
   *                        own square. WHERE cover is, as against how much.
   */
  setGroundCover(amount, colour, metres = 30, map) {
    const u = this._uniforms;
    if (!u) return this;
    u.uCover.value.set(clamp(amount, 0, 1), 1 / this.size, 0);
    if (map !== undefined) u.uCoverMap.value = map || this._coverDefault;
    if (colour !== undefined && colour !== null) u.uCoverCol.value.set(colour);
    return this;
  }

  /* ── sampling ──────────────────────────────────────────────────────── */

  _idx(i, j) {
    i = i < 0 ? 0 : i >= this.res ? this.res - 1 : i;
    j = j < 0 ? 0 : j >= this.res ? this.res - 1 : j;
    return j * this.res + i;
  }

  _vertexNormal(i, j, out) {
    const hL = this.heights[this._idx(i - 1, j)], hR = this.heights[this._idx(i + 1, j)];
    const hD = this.heights[this._idx(i, j - 1)], hU = this.heights[this._idx(i, j + 1)];
    return out.set(hL - hR, 2 * this.step, hD - hU).normalize();
  }

  /** Bilinear height at a world position. */
  height(x, z) {
    const fx = (x + this.half) * this.invStep;
    const fz = (z + this.half) * this.invStep;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h00 = this.heights[this._idx(i, j)], h10 = this.heights[this._idx(i + 1, j)];
    const h01 = this.heights[this._idx(i, j + 1)], h11 = this.heights[this._idx(i + 1, j + 1)];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.step;
    const hL = this.height(x - e, z), hR = this.height(x + e, z);
    const hD = this.height(x, z - e), hU = this.height(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z, _tv);
    return 1 - clamp(n.y, 0, 1);
  }

  /** Surface keyword used for footstep audio and particle colour. */
  surfaceAt(x, z) {
    if (this.preset.flat) return 'metal';
    const y = this.height(x, z);
    if (this.waterLevel > -900 && y < this.waterLevel + 0.05) return 'water';
    return this.slopeAt(x, z) > (this.preset.stoneSlope ?? 0.42) ? 'stone' : 'sand';
  }

  raycast(origin, dir, maxDist, outPoint, outNormal) {
    // Coarse march then bisect — plenty accurate for a heightfield.
    let t = 0, lastT = 0;
    let lastAbove = origin.y - this.height(origin.x, origin.z);
    if (lastAbove < 0) return null;
    const stepLen = Math.max(this.step * 0.5, 0.35);
    while (t < maxDist) {
      t = Math.min(t + stepLen * (1 + t * 0.035), maxDist);
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      if (Math.abs(px) > this.half || Math.abs(pz) > this.half) { lastT = t; continue; }
      const above = py - this.height(px, pz);
      if (above <= 0) {
        let lo = lastT, hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = origin.z + dir.z * mid;
          if (my - this.height(mx, mz) > 0) lo = mid; else hi = mid;
        }
        outPoint.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
        this.normalAt(outPoint.x, outPoint.z, outNormal);
        return hi;
      }
      lastAbove = above; lastT = t;
    }
    return null;
  }

  /* ── deformation ───────────────────────────────────────────────────── */

  /**
   * Push the surface down (or up with a negative depth) — craters from Force
   * landings, gouges from a body hitting the dune at speed.
   */
  crater(x, z, radius, depth, rim = 0.22) {
    if (this.preset.flat) return;
    // A crater narrower than the grid cannot be represented, so widen it and
    // shallow it to move the same amount of sand.
    const minR = this.step * 1.35;
    if (radius < minR) { depth *= (radius * radius) / (minR * minR); radius = minR; }
    // The physics heightfield is a snapshot of this grid; bump the counter so
    // it knows to take another one.
    this.deformSeq++;
    const i0 = Math.max(0, Math.floor((x - radius + this.half) * this.invStep));
    const i1 = Math.min(this.res - 1, Math.ceil((x + radius + this.half) * this.invStep));
    const j0 = Math.max(0, Math.floor((z - radius + this.half) * this.invStep));
    const j1 = Math.min(this.res - 1, Math.ceil((z + radius + this.half) * this.invStep));
    if (i1 < i0 || j1 < j0) return;
    const inv = 1 / radius;
    for (let j = j0; j <= j1; j++) {
      const wz = -this.half + j * this.step;
      for (let i = i0; i <= i1; i++) {
        const wx = -this.half + i * this.step;
        const d = Math.hypot(wx - x, wz - z) * inv;
        if (d > 1.25) continue;
        const k = this._idx(i, j);
        // A broad bowl, with the displaced material piled just outside the rim.
        // The lip is confined past 0.8 so it can never lift the crater floor.
        const bowl = -depth * (Math.cos(Math.min(d, 1) * Math.PI) * 0.5 + 0.5);
        const lip = d > 0.78
          ? depth * rim * Math.exp(-Math.pow((d - 1.0) * 4.2, 2))
          : 0;
        const delta = bowl + lip;
        this.deform[k] += delta;
        this.deform[k] = clamp(this.deform[k], -4.5, 3.0);
        this.heights[k] += delta;
      }
    }
    this._markDirty(i0, j0, i1, j1);
  }

  _markDirty(i0, j0, i1, j1) {
    const r = this._dirtyRegion;
    if (!r) this._dirtyRegion = { i0, j0, i1, j1 };
    else {
      r.i0 = Math.min(r.i0, i0); r.j0 = Math.min(r.j0, j0);
      r.i1 = Math.max(r.i1, i1); r.j1 = Math.max(r.j1, j1);
    }
  }

  /** Apply pending deformation to the GPU buffers (once per frame at most). */
  flush() {
    this._syncAtmosphere();
    const r = this._dirtyRegion;
    if (!r) return;
    this._dirtyRegion = null;
    const pos = this.geometry.attributes.position;
    const nrm = this.geometry.attributes.normal;
    const ter = this.geometry.attributes.aTer;
    const i0 = Math.max(0, r.i0 - 1), i1 = Math.min(this.res - 1, r.i1 + 1);
    const j0 = Math.max(0, r.j0 - 1), j1 = Math.min(this.res - 1, r.j1 + 1);
    // A crater touches a few hundred vertices. Without update ranges each one
    // re-uploads the whole 1.4 MB position buffer, the whole normal buffer and
    // now the landform buffer as well — one row per range is a couple of kB.
    const span = i1 - i0 + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.res + i;
        pos.setY(k, this.heights[k]);
        this._vertexNormal(i, j, _tv);
        nrm.setXYZ(k, _tv.x, _tv.y, _tv.z);
      }
      pos.addUpdateRange((j * this.res + i0) * 3, span * 3);
      nrm.addUpdateRange((j * this.res + i0) * 3, span * 3);
    }
    // and the concavity channel, so a fresh crater collects drift the way any
    // other hollow does rather than staying flagged as the crest it used to be
    const rs = this._rS;
    const ci0 = Math.max(0, i0 - rs), ci1 = Math.min(this.res - 1, i1 + rs);
    const cj0 = Math.max(0, j0 - rs), cj1 = Math.min(this.res - 1, j1 + rs);
    for (let j = cj0; j <= cj1; j++) {
      for (let i = ci0; i <= ci1; i++) {
        const k = j * this.res + i;
        const v = clamp(0.5 + (this._localMean(i, j, rs) - this.heights[k]) * this._kConc, 0, 1);
        this.landform[k * 4] = v * 255;
      }
      ter.addUpdateRange((j * this.res + ci0) * 4, (ci1 - ci0 + 1) * 4);
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    ter.needsUpdate = true;
  }

  /** Keep an entity above the ground; returns the ground height at the point. */
  clampToGround(v, offset = 0) {
    const h = this.height(v.x, v.z) + offset;
    if (v.y < h) v.y = h;
    return h;
  }

  inBounds(x, z, margin = 4) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  dispose() {
    if (ground.terrain === this) ground.terrain = null;
    this.geometry.dispose();
    this.material.dispose();
    this._strip?.dispose();
    this._coverDefault?.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

/** A 1×1 texture, so a sampler that has nothing bound to it yet still reads a
 *  known value rather than whatever the driver last left in the unit. */
function flatTexture(v) {
  const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

const _tv = new THREE.Vector3();
const _tc = new THREE.Color();

/* ── the sky the ground dissolves into, over bearing ──────────────────────
 *
 * 64 texels round the compass, half-float because these are radiances over a
 * 0.2–1.6 range and 8 bits bands visibly in a gradient this smooth — the same
 * reasoning, and the same numbers, as SkyDome's own band map.
 *
 * One row, not sixteen: the far ground is at the skyline by definition, so the
 * only elevation it can dissolve into is the first one. Taking the whole map
 * would be 16× the upload for a lookup that never leaves row 0.
 */
export const SKY_STRIP = 64;

function skyStripTexture() {
  const tex = new THREE.DataTexture(new Uint16Array(SKY_STRIP * 4), SKY_STRIP, 1,
    THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping;      // bearing is a circle
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;   // radiance, not a picture
  // Never hand the shader a strip of zeros: a material that compiles before the
  // first _syncAtmosphere would dissolve its distance into black, and black is
  // the one asymptote that looks deliberate.
  return writeSkyStrip(tex, null, new THREE.Color(0xcfe0f5));
}

/**
 * Fill the strip from SkyDome's baked band, or — with no band — from one flat
 * colour. Exported so the checks can build the same strip the shader samples
 * instead of a transcription of it.
 *
 * @param {THREE.DataTexture} tex
 * @param {{az:number,el:number,top:number,rgb:Float32Array}|null} band
 * @param {THREE.Color} [flat]  the asymptote when there is no band at all
 */
export function writeSkyStrip(tex, band, flat = null) {
  const H = THREE.DataUtils.toHalfFloat;
  const d = tex.image.data;
  for (let i = 0; i < SKY_STRIP; i++) {
    let r, g, b;
    if (band) {
      // Texel centres line up: both maps put bearing i at (i + 0.5) / n of the
      // circle, so this is a straight resample when the widths agree and a
      // nearest read when they do not.
      const j = Math.min(band.az - 1, Math.floor((i + 0.5) / SKY_STRIP * band.az));
      const p = j * 3;                    // row 0 — the skyline
      r = band.rgb[p]; g = band.rgb[p + 1]; b = band.rgb[p + 2];
    } else if (flat) { r = flat.r; g = flat.g; b = flat.b; } else { r = g = b = 0.5; }
    const o = i * 4;
    d[o] = H(r); d[o + 1] = H(g); d[o + 2] = H(b); d[o + 3] = H(1);
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * What the far ground dissolves into: the level's own sky tint at SKY_GAIN,
 * and how completely the haze tone is walked onto it by 230 m.
 *
 * Swept on the arena rim against the one criterion here that is not a matter of
 * taste — a passive surface behind a scattering medium cannot come out brighter
 * than the medium, so the wall may not render brighter than the sky directly
 * above it. Measured at 215 m — far rim wall / the sky just over it / the sand
 * floor, as display luminance, and the wall's saturation:
 *
 *   gain 1.55 blend 0.85   0.683 / 0.693 / 0.631   sat 0.29
 *   gain 1.55 blend 1.00   0.654 / 0.695 / 0.631   sat 0.31
 *   gain 1.00 blend 1.00   0.619 / 0.698 / 0.631   sat 0.35   ← here
 *   gain 0.65 blend 1.00   0.594 / 0.702 / 0.631   sat 0.38
 *
 * 1.00/1.00 is the shallowest setting that puts the wall under BOTH the sky and
 * the sand it is supposed to be carved from — which is what the level's own
 * blurb claims it is, and the property the eye actually reads. Everything below
 * that is buying saturation by darkening the far ground further, and there is
 * no measurement that says where to stop; 0.65 already reads as a band rather
 * than as distance.
 */
const SKY_GAIN = 1.00;
const SKY_BLEND = 1.00;
