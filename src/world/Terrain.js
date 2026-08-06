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
    dustColor: 0xbb9459, crustColor: 0xa89467,
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
    lagColor: 0x6f6046, sheetColor: 0xc4a87e,
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
    sandColor: 0x9c7b48, rockColor: 0x7d6b52,
    maps: 'sand',
    gritColor: 0x6a5334, rockColor2: 0x554a3b,
    dustColor: 0xb88f55, crustColor: 0x9c8f6e,
    // "A bowl of sand ringed by STONE". The rim rises 27 m over 56, which is
    // 1-cos 0.11 — under the old rock band, so the amphitheatre wall came out
    // as pale sand cloth and the level's own blurb was a lie about it.
    slopeBands: [0.055, 0.19, 0.045, 0.14],
    stoneSlope: 0.24,
    crust: 0.55, strataH: 5.5, cliffs: true,
    wind: [0.34, 0.94],
    macro: [140, 0.62, 0.50, 1.05],
    rockUpland: [0.16, 5, 26],
    lagColor: 0x615746, sheetColor: 0xc0a880,
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

      // the wall, benched like an amphitheatre and gullied by runoff
      let wall = smoothstep(60, 116, dd) * 27 + smoothstep(112, 170, dd) * 42;
      const gully = Math.max(0, ridged2(Math.cos(a) * 7.4, Math.sin(a) * 7.4, 3) - 0.28)
        * smoothstep(58, 132, dd) * 13;
      wall = strata(wall - gully, 6.2, smoothstep(60, 84, dd) * 0.70, 3.1);

      return wall + floor + dish;
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
  uniform vec3 uRockUp;      // rock-with-height: gain, y start, y end
  uniform vec3 uCover;       // amount, freq (1/m), threshold
  uniform vec3 uNrmScale;    // base, near detail, rock
  uniform vec3 uSkyCol;
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
  vec2 tswing(vec2 d, float a) {
    float c = cos(a), s = sin(a);
    return vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  }

  // Rock is jointed, not blown: its two frames stay unrelated to the wind and
  // to each other.
  const mat2 TB_R1 = mat2( 0.9689, 0.2474, -0.2474, 0.9689);
  const mat2 TB_R2 = mat2(-0.1219, 0.9925, -0.9925, -0.1219);

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
  mat2 fB = tframe(tswing(uRip.xy, 0.09));
  float bend = ((mB - 0.5) * 1.4 + (mA - 0.5) * 5.5) * uRip.z;

  /* ── the base coat and its ripples.
   *
   * ONE ripple field, running one way, curving with the ground. Bombing two
   * rotated taps of this map and picking the brighter one per pixel — which is
   * what the albedo-sharpened blend amounts to — multiplies the map's two
   * crossing ripple trains into a lattice, and the dune sea comes out as woven
   * matting. What breaks the 3.3 m tile instead is that the FRAME swings with
   * a 9 m noise, so the tile never repeats at the same angle twice.
   *
   * The second tap is a longer train mixed in at low weight, along nearly the
   * same axis. Averaging two near-parallel ripple fields of different
   * wavelength modulates the crest amplitude along its length, which is how a
   * real ripple field dies out and picks up again — not how it cross-hatches.
   */
  vec2 aspect = vec2(1.0, uRipAspect);
  vec2 pA = fA * wp;  pA.x += bend;
  vec2 uA = (pA * uScales.x) * aspect;
  vec3 baseC = texture2D(uBaseAlb, uA).rgb;
  vec2 baseN = ((texture2D(uBaseNrm, uA).xy * 2.0 - 1.0) * aspect) * fA;
  #ifdef TERRAIN_BOMB_NORMAL
    vec2 pB = fB * wp;  pB.x += bend * 0.7;
    vec2 uB = (pB * uScales.y) * aspect + vec2(0.41, 0.73);
    float w2 = 0.18 + mB * 0.26;
    baseC = mix(baseC, texture2D(uBaseAlb, uB).rgb, w2);
    baseN = mix(baseN, ((texture2D(uBaseNrm, uB).xy * 2.0 - 1.0) * aspect) * fB, w2);
  #endif

  // ── detail near the feet: the same map an octave up, gone by ~30 m, so the
  //    ground you stand on has grain and the horizon does not pay for it.
  //    It rides the SAME comb as the ripples. At its own fixed rotation it
  //    crossed them at 50° and four centimetres, and the dune sea came out as
  //    hessian — the finest cross-hatch in the frame beat everything else.
  #ifdef TERRAIN_DETAIL
    float detW = 1.0 - smoothstep(uMix.z, uMix.w, viewDist);
    if (detW > 0.02) {
      mat2 fD = tframe(tswing(uRip.xy, -0.19));
      vec2 pD = fD * wp;  pD.x += bend * 1.4;
      vec2 ud = (pD * uScales.w) * aspect;
      vec3 cd = texture2D(uBaseAlb, ud).rgb;
      baseN += ((texture2D(uBaseNrm, ud).xy * 2.0 - 1.0) * aspect) * fD * (detW * uNrmScale.y);
      baseC *= mix(1.0, 0.74 + cd.g * 0.58, detW * 0.5);
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
  if (uCover.x > 0.001) {
    float cov = uCover.x * smoothstep(uCover.z, uCover.z + 0.34, tnoise(wp * uCover.y) + 0.16)
              * smoothstep(0.30, 0.08, slope)
              * smoothstep(uGround.x - 0.35, uGround.x + 0.45, vWPos.y);
    col = mix(col, uCoverCol, cov);
  }
  // cavity: the map's own troughs, which is what the ripple relief is made of
  float baseLum = dot(baseC, vec3(0.3333));
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
  float baseAmp = uRip.w * mix(1.0, 0.45, driftW) * mix(1.0, 1.3, scour)
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
 * Aerial perspective. scene.fog never touches the Sky material, so a rim 200 m
 * out was meeting the sky as a hard faceted polyline — the one thing that gives
 * away a 1.5 m quad grid. Extra density with range plus a blend toward the
 * horizon colour dissolves the silhouette instead of outlining it.
 */
const TERRAIN_FRAG_FOG = /* glsl */`
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float hazeD = fogDensity * (1.0 + uHaze.x * smoothstep(110.0, 340.0, vFogDepth));
      float fogFactor = 1.0 - exp(-hazeD * hazeD * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    vec3 hazeCol = mix(fogColor, uSkyCol,
                       smoothstep(90.0, 340.0, vFogDepth) * uHaze.y);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, fogFactor);
  #endif
`;

/* ══════════════════════════════════════════════════════════════════════ */

export class Terrain {
  constructor(scene, presetName = 'dunes', quality = 1) {
    const preset = TERRAIN_PRESETS[presetName] || TERRAIN_PRESETS.dunes;
    this.preset = preset;
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
      uRockUp: { value: new THREE.Vector3(...(P.rockUpland || [0, 0, 1])) },
      uCover: { value: new THREE.Vector3(0, 1 / 30, 0.42) },
      uCoverCol: { value: new THREE.Color(0x3c4223) },
      // base ripple, near grain, rock. The rock figure used to be 1.35, which
      // added up to a 53 degree tilt on a unit normal: every joint in the map
      // came out as a rope lying on the cliff rather than as a crack in it.
      uNrmScale: { value: new THREE.Vector3(1.15, 0.85, 0.70) },
      uSkyCol: { value: new THREE.Color(0xcfe0f5) },
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
   */
  _syncAtmosphere() {
    const u = this._uniforms;
    if (!u) return;
    // The Preetham sky renders brighter than the level's nominal sky tint, so
    // lift it — otherwise the dissolve reads as a grey band under the sky
    // instead of the ground disappearing into it.
    if (this._hemi) u.uSkyCol.value.copy(this._hemi.color).multiplyScalar(1.55);
    // Indoors there is no horizon to dissolve into, and the level's fog is
    // already thick enough to close the room off; leave it alone.
    const fog = this._scene && this._scene.fog;
    const indoor = this.preset.flat || (fog && fog.density > 0.01);
    u.uHaze.value.set(indoor ? 0 : 0.8, indoor ? 0 : 0.7);
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
   * @param {number} metres   patch scale of the cover
   */
  setGroundCover(amount, colour, metres = 30) {
    const u = this._uniforms;
    if (!u) return this;
    u.uCover.value.set(clamp(amount, 0, 1), 1 / Math.max(2, metres), 0.42);
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
    this.mesh.parent?.remove(this.mesh);
  }
}

const _tv = new THREE.Vector3();
