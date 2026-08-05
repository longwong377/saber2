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
    slopeBands: [0.14, 0.36, 0.05, 0.15],
    stoneSlope: 0.24,
    crust: 0.55, strataH: 5.5, cliffs: true,
    wind: [0.34, 0.94],
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
 * Two rotations for the texture bombing and a third for the near-field detail.
 * They are deliberately not multiples of each other: the whole point is that
 * no two taps can ever line up into corduroy.
 */
const TERRAIN_FRAG_COMMON = /* glsl */`
  varying vec3 vWPos;
  varying vec3 vWNrm;
  varying vec4 vTer;

  uniform sampler2D uBaseAlb, uBaseNrm;
  uniform sampler2D uRockAlb, uRockNrm;
  uniform vec3 uBaseCol, uGritCol, uRockCol, uRockCol2, uDustCol, uCrustCol;
  uniform vec4 uScales;      // tiles/m: base A, base B, rock, near detail
  uniform vec4 uBands;       // rock lo/hi, grit lo/hi  (surface slope)
  uniform vec4 uGround;      // water level, crust amount, damp amount, strata height
  uniform vec4 uMix;         // macro freq A, macro freq B, detail near, detail far
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

  const mat2 TB_A = mat2( 0.9689, 0.2474, -0.2474, 0.9689);
  const mat2 TB_B = mat2(-0.1219, 0.9925, -0.9925, -0.1219);
  const mat2 TB_D = mat2( 0.6494, -0.7604, 0.7604, 0.6494);

  /**
   * Texture bombing. Two taps of the same map at different scales AND different
   * rotations, chosen per pixel by a macro noise. The choice is sharpened by the
   * albedo itself so the seam interfingers like drifting sand instead of
   * cross-fading the ripples into mush — a straight mix() would average two
   * ripple fields and leave flat grey.
   *
   * The tangent normals are rotated back out of each tap's frame (v * M is
   * transpose(M) * v) so a ripple lights from the direction it actually runs.
   */
  void bombTap(sampler2D alb, sampler2D nrm, vec2 p, float sA, float sB, float w,
               out vec3 col, out vec2 tn) {
    vec2 uA = (TB_A * p) * sA;
    vec2 uB = (TB_B * p) * sB + vec2(0.41, 0.73);
    vec3 cA = texture2D(alb, uA).rgb;
    vec3 cB = texture2D(alb, uB).rgb;
    float m = smoothstep(-0.13, 0.13, 2.0 * w - 1.0 + (cB.g - cA.g) * 0.55);
    col = mix(cA, cB, m);
    #ifdef TERRAIN_BOMB_NORMAL
      vec2 nA = (texture2D(nrm, uA).xy * 2.0 - 1.0) * TB_A;
      vec2 nB = (texture2D(nrm, uB).xy * 2.0 - 1.0) * TB_B;
      tn = mix(nA, nB, m);
    #else
      // one tap only: take whichever tile won the albedo, frame and all
      float pick = step(0.5, m);
      vec2 nP = texture2D(nrm, mix(uA, uB, pick)).xy * 2.0 - 1.0;
      tn = mix(nP * TB_A, nP * TB_B, pick);
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
  float mB = tnoise(wp * uMix.y);    // ≈21 m — patch scale
  float mC = tnoise(wp * 0.85);      // metre scale

  float hollow = clamp(conc, 0.0, 1.0);
  float crest  = clamp(-conc, 0.0, 1.0);
  float basin  = clamp(-upl, 0.0, 1.0);
  float lee    = clamp(-expo, 0.0, 1.0);

  // ── layer weights: slope decides rock and grit, the landform decides the rest
  float rockW = smoothstep(uBands.x, uBands.y, slope + (mB - 0.5) * 0.14);
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

  // ── the base coat and its ripples
  vec3 baseC; vec2 baseN;
  bombTap(uBaseAlb, uBaseNrm, wp, uScales.x, uScales.y,
          clamp(mB * 1.5 - 0.25, 0.0, 1.0), baseC, baseN);

  // ── detail near the feet: a third rotation an octave up, gone by ~30 m, so
  //    the ground you stand on has grain and the horizon does not pay for it
  #ifdef TERRAIN_DETAIL
    float detW = 1.0 - smoothstep(uMix.z, uMix.w, viewDist);
    if (detW > 0.02) {
      vec2 ud = (TB_D * wp) * uScales.w;
      vec3 cd = texture2D(uBaseAlb, ud).rgb;
      baseN += (texture2D(uBaseNrm, ud).xy * 2.0 - 1.0) * TB_D * (detW * uNrmScale.y);
      baseC *= mix(1.0, 0.55 + cd.g * 0.85, detW * 0.55);
    }
  #endif

  // ── compose the loose layers. The texture only modulates around 1.0 here, so
  //    the preset colours ARE the albedo; multiplying tint by texture the way
  //    this used to left the sand a saturated orange in every level.
  vec3 col = uBaseCol;
  col = mix(col, uGritCol, min(1.0, gritW * 0.9 + scour * 0.16));
  col = mix(col, uDustCol, driftW * 0.85);
  col = mix(col, uCrustCol, crustW);
  col *= 0.55 + dot(baseC, vec3(0.3333)) * 1.15;

  // ── rock, and the strata it is bedded in. Skipped wholesale where nothing is
  //    steep — on the dune sea that is the entire map, and it is four taps
  //    (six where the cliff re-projection runs).
  float terRough = mix(0.94, 0.99, driftW);
  float ny = max(abs(nW.y), 0.28);
  vec3 Txz = normalize(vec3(ny, -nW.x, 0.0));
  vec3 Bxz = normalize(vec3(0.0, -nW.z, ny));
  float nFade = 1.0 - smoothstep(90.0, 300.0, viewDist) * 0.75;
  // Ripples are a windward phenomenon: the slip face avalanches smooth, the
  // hollows fill with fines, and a crust does not ripple at all.
  float baseAmp = uNrmScale.x * mix(1.0, 0.45, driftW) * mix(1.0, 1.3, scour)
                * mix(1.0, 0.5, crustW) * nFade
                * mix(1.0, 0.42, lee * smoothstep(0.05, 0.17, slope));
  vec3 terNrmOff = (Txz * baseN.x + Bxz * baseN.y) * (baseAmp * (1.0 - rockW));

  if (rockW > 0.004) {
    vec3 rockC; vec2 rockN;
    bombTap(uRockAlb, uRockNrm, wp, uScales.z, uScales.z * 0.53,
            clamp(mA * 1.7 - 0.35, 0.0, 1.0), rockC, rockN);

    float bedY = (vWPos.y + sin(vWPos.y * 0.41) * 1.25
                 + (mA - 0.5) * 4.0 + (mB - 0.5) * 0.9) / uGround.w;
    float bandI = floor(bedY), bandF = bedY - bandI;
    float bandR = thash(vec2(bandI, 7.3));
    float seam = (smoothstep(0.11, 0.0, bandF) + smoothstep(0.89, 1.0, bandF))
               * (0.25 + thash(vec2(bandI, 21.7)) * 1.1);
    vec3 rockTint = mix(uRockCol, uRockCol2, bandR) * (0.84 + bandR * 0.30) * (1.0 - seam * 0.22);

    col = mix(col, rockTint * (0.55 + dot(rockC, vec3(0.3333)) * 1.15), rockW);
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
      vec2 vuv = vec2(dot(wp, tang), vWPos.y) * uScales.z;
      vec3 cv = texture2D(uRockAlb, vuv).rgb;
      vec2 nv = texture2D(uRockNrm, vuv).xy * 2.0 - 1.0;
      vec3 Tv = vec3(tang.x, 0.0, tang.y);
      vec3 Bv = cross(Tv, nW);
      float k = vface * rockW;
      col = mix(col, rockTint * (0.55 + dot(cv, vec3(0.3333)) * 1.15), k);
      terNrmOff = mix(terNrmOff, (Tv * nv.x + Bv * nv.y) * (uNrmScale.z * nFade), k);
    }
  #endif
  }

  // Macro tone anchored to the landform rather than to noise alone: uplands
  // bleach, basins hold the darker fines, and mA keeps it off the vertex grid.
  col *= 0.90 + mA * 0.22 + upl * 0.07 - basin * 0.06 + open * 0.05;

  // damp ground near the waterline and in the wet bottoms
  float wet = clamp(smoothstep(uGround.x + 0.7, uGround.x - 0.3, vWPos.y)
            + uGround.z * smoothstep(0.55, 1.0, basin) * smoothstep(0.22, 0.03, slope) * 0.55,
            0.0, 1.0);
  col *= mix(1.0, 0.62, wet);

  diffuseColor = vec4(col, opacity);

  terRough = mix(terRough, 0.74, crustW * 0.55);
  terRough = mix(terRough, 0.24, wet);
`;

const TERRAIN_FRAG_ROUGH = /* glsl */`
  float roughnessFactor = roughness * terRough;
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
      uScales: { value: new THREE.Vector4(...(P.texScale || [0.30, 0.175, 0.115]), detail[0]) },
      uBands: { value: new THREE.Vector4(...(P.slopeBands || [0.2, 0.5, 0.08, 0.26])) },
      uGround: { value: new THREE.Vector4(this.waterLevel, P.crust ?? 0, P.damp ?? 0, P.strataH ?? 3.5) },
      uMix: { value: new THREE.Vector4(1 / 74, 1 / 21, detail[1] * 0.35, detail[1]) },
      uNrmScale: { value: new THREE.Vector3(1.15, 0.85, 1.35) },
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
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

const _tv = new THREE.Vector3();
