/**
 * BATTLEFRONT BORZ — terrain.
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
import { fbm2, ridged2, clamp, lerp, smoothstep, TAU } from '../engine/MathUtil.js';
import { sandMaps, rockMaps, duracreteMaps, metalMaps, soilMaps, snowMaps, MEAN_ALBEDO } from '../engine/Textures.js';
import { SurfaceField, SURFACE_RES, SURFACE_SIZE, SURFACE_GRAD_FS } from './Surface.js';
import { CEL } from '../toon/Cel.js';
// One-way: Scenery knows nothing about Terrain, so publishing the heightfield
// on the broker here is what lets the water find the bed it is lying in
// without the World having to wire the two together.
import { ground } from './Scenery.js';

const fract = (v) => v - Math.floor(v);

/**
 * THE WALK LIMIT, in the units the rest of the game already uses for slope:
 * `1 - n.y`, which is 0 on the flat and 1 on a vertical face. 0.52 is the
 * number Player's downhill slide has always been written against — see
 * `Terrain.blockClimb` for what it costs that the slide was the ONLY thing
 * that number did. As a gradient, rise over run, 0.52 is 1.83.
 */
export const WALK_SLOPE = 0.52;
const CLIMB_GRADIENT = Math.sqrt(1 / ((1 - WALK_SLOPE) ** 2) - 1);
/** How far up the face a wall has to keep climbing to count as one. */
const CLIMB_PROBE = 3.0;

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
 *
 * ONE HONEST NOTE ABOUT `rockAt`: nothing in the game calls it. Grepped across
 * src/ and tools/, the only occurrences are the five definitions below. What
 * actually decides rock-versus-loose is `slopeBands` (+ `rockUpland`) in the
 * fragment shader, and what decides the footstep and the particle tint is
 * `stoneSlope` in surfaceAt(). It is left here, and kept in agreement with each
 * preset's own bands, because it is the natural JS twin of that band and the
 * next person to want a slope mask in script will reach for it — but it is not
 * wired to anything today, and a preset author should not believe it is.
 * tools/checks/terrain.mjs pins the agreement; it found two presets whose
 * rockAt disagreed with their own material by 0.17 and 0.43 of slope.
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
    // The loose layer, and how fast the wind puts it back. `depth` is what one
    // footfall presses into it; `refill` is the e-folding time of the fill-in.
    // A young dune field is being combed all day, so a track has a minute or
    // two rather than an afternoon — but not the erg's forty seconds.
    loose: { depth: 0.20, refill: 78, tilt: 1.00, tint: 0.46, soot: 1.0 },
    packedColor: 0x6b4f2c,
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
    // 0.30 → 0.52 is this preset's own rock band, i.e. the material starts
    // painting stone at 46° and is all stone by 61°. The twin has to cross
    // where the material does; this one used to cross at slope 0.84, steeper
    // than anything in the field, i.e. "never stone" anywhere.
    rockAt(x, z, slope) { return clamp(slope * 4.55 - 1.36, 0, 1); },
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
    // A fought-over bowl with a wind-packed silt floor: it takes a print
    // shallowly and keeps it a long time, which is the right memory for the
    // one level whose whole subject is what happened on it.
    loose: { depth: 0.13, refill: 150, tilt: 0.92, tint: 0.42, soot: 1.0 },
    packedColor: 0x63492a,
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
    // matched to the 0.055 → 0.19 band above; it used to cross at 0.29 against
    // the material's 0.12, so the twin called the whole amphitheatre rim sand
    rockAt(x, z, slope) { return clamp(slope * 7.4 - 0.41, 0, 1); },
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
    // A wash floor is damp sand over gravel: it takes a sharp print and the
    // river's own air does very little to it.
    loose: { depth: 0.11, refill: 190, tilt: 0.86, tint: 0.50, soot: 1.0 },
    packedColor: 0x4a3524,
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

  /**
   * Rolling green hills. The simplest height function in this file, on purpose.
   *
   * A meadow has no landform story. There is no wind that built it, no water
   * that cut it and no bedding under it — it is the shape the ground was left
   * in, with grass over the top. Everything the deserts spend their octaves on
   * (a windward face, a slip face, a thalweg, strata) is a lie here, and the
   * one thing that is true is that the CRESTS ARE LONG. Two octaves of fbm at
   * 320 m and 100 m is the whole silhouette; a third at 20 m and 30 cm keeps
   * the ground from being a mathematical surface underfoot. Six noise2 calls
   * against the dune sea's eighteen, and 0.21× its cost measured, which matters
   * because this runs per vertex at bake, per frame per FOOT of every
   * character, and per physics heightfield refresh.
   *
   * Measured on the built field: 27 m of relief, 9.0° mean slope, 23.9° at its
   * steepest, and 69% of the map under 10°. That last figure is the design —
   * the level's cover is grass to the horizon, and grass wants ground it can
   * stand up on.
   */
  meadow: {
    scale: 540, res: 300, waterLevel: -999,
    // The base coat IS the meadow at distance. The grass field is instanced out
    // to its own reach and the level is seen to 700 m; past that reach the only
    // green in the frame is THIS colour, so it is the sward's own green rather
    // than the soil under it.
    sandColor: 0x6d7a3e, rockColor: 0x736a58,
    maps: 'soil',
    // thin dry earth on the shoulders, where the mat wears through
    gritColor: 0x7d7048, rockColor2: 0x585d5f,
    // the hollows are wetter, and wet sward is darker and bluer-green
    dustColor: 0x4c5b2e, crustColor: 0x7e8a5c,
    // 0.050 is 18.2° and 0.135 is 30.1°, against a field whose steepest ground
    // is 23.9°: outcrop appears on the few steepest banks and nowhere else,
    // which is the correct amount of rock in a meadow. The grit band at
    // 0.014-0.055 (9.6°-19.1°) is the one that does the work — that is the
    // shoulder of every hill, and it is where a footpath wears the sward off.
    slopeBands: [0.050, 0.135, 0.014, 0.055],
    stoneSlope: 0.10,
    crust: 0.35, damp: 0.30, strataH: 4.0,
    wind: [0.42, 0.91],
    macro: [155, 0.60, 0.55, 0.95],
    // The same two ends of the same mechanism, reading as what they are on wet
    // ground instead of dry: what the 155 m patchwork sorts here is not grain
    // size but how long the sward has stood. Peaty humus where it is old and
    // rank, bleached thatch where last year's growth is still standing.
    lagColor: 0x4a4736, sheetColor: 0xb3ac8e,
    // Turf. The shallowest layer and the fastest recovery in the game, because
    // the thing that remembers a footfall on a meadow is the GRASS and not the
    // soil, and that is GrassField's own trail rather than this.
    loose: { depth: 0.055, refill: 26, tilt: 0.70, tint: 0.34, soot: 1.0 },
    packedColor: 0x3a3722,
    // A meadow is not wind-carved. 0.35 against the dune sea's 1.15 — and the
    // number that actually kills the corduroy is ripAspect: at 1.0 the soil map
    // is sampled through a SQUARE frame, so its crumb has no bearing at all.
    // (Zeroing `ripple` instead would have been the obvious reading of "no
    // ripples" and it is wrong: uRip.w scales the whole base normal, so at 0
    // the ground loses every scrap of micro-relief and lights as a painted
    // plane. The anisotropy is the thing to remove, not the relief.)
    ripple: 0.35, ripAspect: 1.0,
    // 2.0 m base tile, not 3.3: soil crumb is centimetres, and at the desert's
    // tiling a ped came out 20 cm across.
    texScale: [0.50, 0.29, 0.215],
    detail: [0.95, 32],
    height(x, z) {
      const swell = fbm2(x * 0.0031, z * 0.0031, 2) * 25;          // ~320 m
      const hills = fbm2(x * 0.0106 + 7.3, z * 0.0106 - 1.9, 2) * 8.5;  // ~100 m
      const turf = fbm2(x * 0.048 + 5.1, z * 0.048 - 2.6, 2) * 0.30;    // underfoot
      return swell + hills + turf;
    },
    rockAt(x, z, slope) { return clamp(slope * 7.4 - 0.37, 0, 1); },
  },

  /**
   * The deep erg — the dune sea's landform with the amplitude a sandstorm level
   * wants, and the same primitive underneath.
   *
   * Two things are different and both are deliberate:
   *
   *  · SCALE. Dune height and dune spacing are not free of each other; a taller
   *    dune is a longer one. Measured over both fields, the dune sea averages a
   *    7.4 m dune every 70 m and this averages 15.1 m every 108 m, so the
   *    amplitude doubles and the wavelength goes up by half. What that buys is
   *    visible in the SLIP FACE, which is the thing an erg is actually about:
   *    the dune sea's drops 7.4 m over 18 m of run, which is 22° — a slope you
   *    stroll down — and this one drops 15.1 over 23, which is 34°, sand's
   *    angle of repose exactly, the steepest a dry slip face can stand.
   *    Holding the 70 m wavelength and only raising the amplitude would have
   *    put it at 46°, past repose by a mile and unclimbable in a way that reads
   *    as a bug rather than as a dune.
   *  · THE BRINK. duneProfile's `brink` is where along the crossing the crest
   *    sits. At 0.79 rather than 0.74 the windward face is longer and the slip
   *    face shorter, and the discontinuity in slope at the crest goes from
   *    2.39:1 to 3.16:1 — which is what "a sharper brink" means as a number.
   *    The crest reads as an edge from further away, which is the only thing
   *    you can see when visibility is 40 m.
   *
   * Measured: 44 m of relief against the dune sea's 28, 22.1° mean slope against
   * 18.4°, and a corridor at the middle that holds under 9° out to 36 m and
   * only then starts to climb.
   */
  drifts: {
    scale: 560, res: 340, waterLevel: -999,
    // A deep erg is older sand than a young dune field: more of the quartz has
    // been coated in iron oxide, and it runs red rather than tan. Held at the
    // dune sea's luminance — 0.2162 linear against 0.2158, a fifth of a percent
    // — so a level can start from the dune sea's authored exposure and be right.
    // What moves is the hue, 22.0° against the dune sea's 29.3°, and the
    // saturation, 0.880 against 0.841.
    sandColor: 0xaa753e, rockColor: 0x6d5644,
    maps: 'sand',
    gritColor: 0x76502a, rockColor2: 0x4d5055,
    dustColor: 0xc49a63, crustColor: 0xada38c,
    // 0.34 is 48.7°. A dune sea is sand all the way up and a deep one is more
    // so: the band is set past the steepest slip face this field builds, so
    // stone never appears anywhere on it. The grit band carries the slip faces.
    slopeBands: [0.34, 0.58, 0.12, 0.26],
    stoneSlope: 0.34,
    crust: 0.50, strataH: 5.0,
    wind: [0.79, 0.61],
    // 180 m patches, not 165: the landform under them is half again as big.
    macro: [180, 0.62, 0.56, 1.05],
    lagColor: 0x585a4e, sheetColor: 0xd4b184,
    // A storm combs harder than a breeze does.
    ripple: 1.30,
    // Deep, dry, unpacked sand — the deepest print in the game after the snow
    // — and the shortest memory, because this is the level with a sandstorm
    // scheduled every ninety seconds and a storm erases a trail in under a
    // minute. That is a feature: on this one map your tracks are being chased.
    loose: { depth: 0.26, refill: 40, tilt: 1.05, tint: 0.50, soot: 1.0 },
    packedColor: 0x6d4526,
    detail: [0.95, 34],
    height(x, z) {
      const wx = 0.79, wz = 0.61;
      // draa: 480 m sand ridges, 30 m tall. The dune sea keeps these at 18 and
      // under the dune amplitude on purpose; here they are meant to be over it,
      // because what an erg has and a dune field does not is a horizon made of
      // sand rather than of sky.
      const draa = Math.pow(Math.max(0, ridged2(x * 0.0021 + 11.9, z * 0.0021, 3)), 1.20) * 30;

      const warp = fbm2(x * 0.0036, z * 0.0036, 3) * 42;
      const s = x * wx + z * wz + warp;
      const t = -x * wz + z * wx;
      const lam = 104 * (1 + fbm2(t * 0.0041, s * 0.0026, 2) * 0.28);
      const amp = 21 * clamp(fbm2(t * 0.0074 + 23, s * 0.0025, 3) * 2.0 + 0.78, 0, 1);
      const dune = duneProfile(fract(s / lam), 0.79) * amp;

      // secondary dunes on the windward flanks, dying out as the primary rises
      const s2 = s * 0.36 + t * 0.93;
      const sec = duneProfile(fract(s2 / 31), 0.72) * 2.4
        * clamp(1.3 - dune * 0.07, 0, 1);

      // the interdune is scoured to a firm corrugated floor, never a plane
      const corr = fbm2(x * 0.048, z * 0.048, 3) * 0.32
        + Math.max(0, ridged2(x * 0.017, z * 0.017, 2) - 0.3) * 0.5;

      // The corridor. Same device as the dune sea's pan and wider, because the
      // dunes around it are nearly twice as tall and a fight needs the same
      // amount of floor whatever is standing over it.
      const d = Math.hypot(x, z);
      const panR = 46 + fbm2(x * 0.010, z * 0.010, 2) * 24;
      const open = smoothstep(panR * 0.62, panR * 1.60, d);

      return draa * (0.38 + open * 0.62) + (dune + sec) * open + corr
        - (1 - open) * 1.4;
    },
    // the 0.34 → 0.58 band, so the twin agrees with the material: the very
    // steepest brinks this field builds do show a little stone and nothing else
    // on it does
    rockAt(x, z, slope) { return clamp(slope * 4.17 - 1.42, 0, 1); },
  },

  /**
   * The mountain. Same vocabulary as the canyon — strata, cliffs, rock-with-
   * height — at nearly twice the relief (112 m against 61), and with the
   * rock/loose decision run backwards: what lies on the shallow ground here is
   * snow, and what the steep ground shows is stone.
   *
   * THE HARD CONSTRAINT IS 520 METRES. A mountain is a kilometre tall and this
   * field is half a kilometre wide, so the summit cannot be in it — it lives in
   * the painted horizon, which is not this file's. What is in here is the
   * ground within sight of the player, and it is built in three pieces:
   *
   *  · the FLANKS, outside 60 m. A ridged multifractal, because an arête is a
   *    crest that is a LINE and nothing else in MathUtil makes one; quantised
   *    into beds by `strata` so the buttresses come out ledged rather than
   *    extruded, which is also what gives snow somewhere to sit on a wall.
   *  · the CIRQUE FLOOR, inside it. Not a plate: rock ribs breaking through the
   *    snow, benched at a 3.2 m step. 89% of the first 40 m is under 30° so the
   *    fight works, and it still has 13 m of relief in it to move around.
   *  · the TALUS, a skirt of the flanks' own debris fanning out from their foot,
   *    because a cliff that meets the floor at a line has nowhere to have put
   *    what it lost.
   *
   * Measured: 112 m of relief, 35° mean slope, 80° at the steepest riser.
   */
  alpine: {
    scale: 520, res: 320, waterLevel: -999,
    /* THE BASE COAT IS SNOW, and snow is the one ground in this game brighter
     * than the light falling on it is metered for. This number was measured,
     * and it did not come out where I expected it to.
     *
     * atmosphereMeter keys the exposure off IRRADIANCE alone — key = E·0.18/π,
     * an 18% grey world, with nothing about the ground reaching it. So for a
     * flat, fully lit patch the linear value that arrives at ACES is exactly
     * albedo × bias × KEY / 0.18, and the ATMOSPHERE CANCELS OUT. Whatever the
     * weather lane does to this level's sky, the ground's place on the tone
     * curve is decided here, by this hex.
     *
     * The expected failure was clipping. It does not happen: ACES has a
     * shoulder, not a wall, and even real 0.90 snow measures 0.0% of the ground
     * over 0.985 display. What actually happens on the shoulder is that the
     * ground goes FLAT — the curve stops resolving albedo differences, and every
     * layer the material spends its taps on arrives as the same white. Measured
     * through the real ACES + grade at the dune sea's authored bias of 0.86:
     *
     *   authored albedo   base coat    a 15% albedo    base coat vs the
     *                     displays at  step is worth   pale drift sheet
     *     desert ground (0.18-0.22)  0.45-0.51   0.050      0.19-0.31
     *     0xf0f4f8  real fresh snow, 0.90   0.914   0.018      0.010
     *     0xd8e0e8  settled snow,    0.74   0.882   0.023      0.026
     *     0xbcc6d0                   0.56   0.825   0.030      0.068
     *     0xb4bfca  ← this           0.51   0.805   0.033      0.088
     *     0xadb8c4                   0.47   0.783   0.035      0.109
     *
     * Read the last column. At real snow's albedo the base coat and the drift
     * sheet display 0.010 apart — they are the SAME COLOUR on screen, and the
     * sastrugi, the wind slab and the fresh drift are all one white card. That
     * is what a physically honest snow albedo buys, and it is worth more than
     * clipping ever was.
     *
     * So 0.51 is a lie about snow, and it is the same lie every photograph of
     * snow tells, because a camera meters the way this engine does. The
     * alternative — author 0.90 and hand the level a −0.9 stop bias — fails
     * because exposure is ONE number for the whole frame: it would have taken
     * the sky, the sabers and the characters down with the ground, and the
     * ground is the only part of the frame that is white.
     *
     * Even at 0.51 this ground gets two thirds of a desert's tonal modulation.
     * There is no setting that gets all of it; the shoulder is where it is. */
    sandColor: 0xb4bfca, rockColor: 0x4b4744,
    maps: 'snow',
    // wind crust: older, greyer, slightly warmer snow on the scoured shoulders
    gritColor: 0xa2acb6, rockColor2: 0x3b3f45,
    // powder collecting in the lee hollows, and the wind slab on the flats
    dustColor: 0xd2dae2, crustColor: 0xc6ced8,
    // 0.10 is 25.8° and 0.30 is 45.6°. Snow does not lie on a 46° face: it
    // sloughs, and what is left is the rock. The grit band at 0.030-0.11
    // (14°-27°) is the wind crust between the two.
    slopeBands: [0.10, 0.30, 0.030, 0.11],
    stoneSlope: 0.16,
    crust: 0.45, strataH: 6.0, cliffs: true,
    wind: [0.62, -0.78],
    macro: [130, 0.55, 0.60, 1.05],
    // The other half of the snow mask. Slope alone cannot find a benched wall —
    // strata put most of its area on near-flat treads — and the treads high on
    // a buttress are wind-scoured, not snow-covered. Same lever as the canyon's
    // and the arena's, aimed at the same failure.
    rockUpland: [0.09, 34, 108],
    // The two ends of the same sorting, on snow: the wind strips the exposed
    // crests down to the moraine grit under them and drops what it took as
    // fresh drift downwind. Both are true of a snowfield and both are visible.
    lagColor: 0x60564a, sheetColor: 0xdfe6ee,
    /* SNOW. The deepest loose layer and the longest memory in the game, and
     * both are the point of the level: what you do here stays until it snows.
     *
     * 0.34 m is what one FOOTFALL presses into flat, unpacked snow. `mantle`
     * is the other half — how much snow is actually LYING at a point, which is
     * what decides whether a print is a scuff on a wind-stripped rib or a hole
     * with a shadow in it. 0.10 m on a scoured crest to 0.95 m in a lee hollow:
     * ankle to waist, which is the range this level was asked for.
     *
     * The tint is the coldest in the table because packed snow is BLUER as
     * well as darker — what you are looking at in the bottom of a print is a
     * centimetre of ice lit by nothing but sky. */
    loose: { depth: 0.34, refill: 300, tilt: 1.25, tint: 0.62, soot: 1.0 },
    mantle: [0.10, 0.95],
    packedColor: 0x7d8ca6,
    // Sastrugi. Real, directional, and softer than an aeolian sand ripple — the
    // map's drift wavelength is twice the sand map's and its two trains sit 2°
    // apart rather than 33°, so the frame does not need stretching as hard to
    // keep them from crossing into a lattice.
    ripple: 0.70, ripAspect: 0.55,
    detail: [1.0, 30],
    height(x, z) {
      const d = Math.hypot(x * 1.06, z * 0.90);
      const rise = smoothstep(60, 235, d);

      // the massif. ^1.30 sharpens the arête and drops the ground between the
      // ridges, which is what stops a ridged fractal reading as a pile of cones
      const arete = Math.pow(Math.max(0, ridged2(x * 0.0044 + 8.4, z * 0.0037 - 3.1, 4)), 1.30);
      // 7 m beds — four grid cells at this resolution, which is the floor for a
      // bench that survives the mesh at all (the canyon learned this at 3.6 m,
      // where its benches were two vertices wide and came out as noise)
      const flank = strata(arete * 118 * rise, 7.0,
        smoothstep(0.06, 0.42, rise) * 0.66, 7.3);

      // the cirque floor: rock ribs through the snow, benched into ledges
      const rib = Math.max(0, ridged2(x * 0.0115 + 2.2, z * 0.0102 + 6.4, 3) - 0.22)
        * 18 * (1 - rise * 0.62);
      const bench = strata(rib, 3.2, 0.30, 3.9);

      // sastrugi and boulders, at the scale you walk over
      const floor = fbm2(x * 0.019, z * 0.019, 3) * 1.3
        + Math.max(0, ridged2(x * 0.055, z * 0.055, 2) - 0.34) * 0.7;

      // the debris skirt under the buttresses
      const talus = smoothstep(64, 118, d) * smoothstep(210, 130, d) * 5.0;

      return flank + bench + talus + floor;
    },
    // Snow lies on shallow ground and falls off steep faces — the same shape as
    // the shader's own rock band, at the same crossing (0.20, i.e. 36.9°).
    rockAt(x, z, slope) { return clamp(slope * 5.0 - 0.5, 0, 1); },
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
    // A poured deck does not take a footprint. It takes a SCORCH, which is the
    // half of the surface memory that has nothing to do with loose material —
    // so the layer is here at two centimetres of grit and dust, and the burn
    // channel is at full strength.
    loose: { depth: 0.02, refill: 40, tilt: 0.55, tint: 0.30, soot: 1.0 },
    packedColor: 0x23262b,
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

  /* ══════════════════════════════════════════════════════════════════════
   *  THE DESCENT — two floors, four rooms
   *
   *  The Spire could not build a tower because terrain is a single
   *  heightfield h(x, z): no floors, no overhangs. A DESCENT has exactly the
   *  same constraint and exactly the same answer — the depth is not geometry,
   *  it is the AIR and the LIGHT — but it gets one thing the climb never
   *  could. A room has walls, and a heightfield can raise them: `d` below is
   *  the CHEBYSHEV distance, so the shell that closes each level is a
   *  rectangular hall rather than a bowl, and the ground the player can stand
   *  on is exactly the ground inside it.
   *
   *  Two presets carry four rooms. The works is what people built — poured
   *  rockcrete, drainage falls, a casting sink. The cavern is what they cut it
   *  out of and what has come back since. Sharing them is deliberate: the
   *  rooms differ by their DRESSING and by their light, which is the whole
   *  claim the descent makes, and two rooms on one floor plan is what a
   *  facility actually looks like.
   * ═════════════════════════════════════════════════════════════════════ */

  /**
   * THE WORKS. A poured floor in a cut hall — the intake, the foundry and the
   * core all stand on it.
   *
   * Authored for the cel pass, which means the palette is stated once here and
   * not re-litigated per level: ONE HUE FAMILY, a cold blue-grey rockcrete,
   * with no warm anywhere in the ground at all. Every warm note in the foundry
   * is LIGHT — the melt, the tap-holes, the hazard lamps — so the same floor
   * reads as a cold receiving hall two hundred metres up and as a foundry
   * floor down here without a single colour changing. A ground authored warm
   * would have fought the one accent each room is allowed.
   */
  works: {
    scale: 320, res: 180, waterLevel: -999, flat: true,
    /* Rockcrete, and its darker aggregate core where the surface has gone.
     * NEUTRAL rather than blue-grey, and that is the correction the first
     * render forced. Authored at 0x4b525d — a cold swatch — under a cold key
     * and a cold fill, every pixel of the intake came out the same blue and
     * the room had one hue in it and no accent to read against. A floor is
     * lit; it does not need to be coloured as well. */
    sandColor: 0x53545a, rockColor: 0x3a3b40,
    maps: 'deck',
    gritColor: 0x3d444f, rockColor2: 0x262b33,
    // The two ends of the same 84 m patchwork: swept floor against the grey
    // pan of spill that has soaked into it. Both inside the one hue family.
    dustColor: 0x686a70, crustColor: 0x424349,
    slopeBands: [0.05, 0.20, 0.010, 0.045],
    stoneSlope: 0.2,
    crust: 0.0, strataH: 2.2,
    wind: [1, 0],
    macro: [84, 0.36, 0.24, 0.85],
    lagColor: 0x2c323b, sheetColor: 0x6b7480,
    // A poured floor does not take a footprint, it takes a SCORCH — the same
    // reasoning as the hangar deck, and the burn channel is what the foundry
    // is actually about. Two centimetres of swarf and grit over the top.
    loose: { depth: 0.025, refill: 44, tilt: 0.55, tint: 0.30, soot: 1.0 },
    packedColor: 0x1f242b,
    ripple: 0.5, ripAspect: 1.0,     // poured, not blown
    texScale: [0.42, 0.26, 0.34],
    detail: [1.6, 26],
    height(x, z) {
      // The shell. Chebyshev, so the room is rectangular: 152 m of floor
      // inside walls that climb 46 m, which is what makes the walkable ground
      // and the fighting ground the same thing.
      const d = Math.max(Math.abs(x), Math.abs(z));
      // 66 → 84, and both numbers are measured rather than chosen.
      //
      // The RUN first: over 18 m the wall stands at 68°, whose 1 − cos is 0.63,
      // past the 0.55 every survey in the suite uses to mean "ground you can
      // stand on". Written first as 78 → 134 it was a 51° RAMP, so the room had
      // no walls at all — the walkable disc ran straight up and over them.
      //
      // Then the SIZE, which is the number an interior lives or dies on.
      // `world-immersion` wants over 900 walkable samples on a 4 m grid (so at
      // least ~14,400 m² of floor) AND, on ground with no cover, a median gap
      // to the nearest object under 6.5 m. Those pull opposite ways: every
      // extra metre of room is more floor to fill, and filling it costs draw
      // calls against a cap of 520. A 132 m hall is about 16,000 m² — a
      // thousand samples, and a 22 m plant grid that clears the median with
      // objects this file can afford.
      const shell = smoothstep(66, 84, d) * 46;
      // Drainage falls on a 9 m bay grid. A poured floor is never level — it
      // is laid to a channel — and the falls are what give a flat deck a
      // highlight to break on.
      const gx = Math.abs(fract(x / 9) - 0.5), gz = Math.abs(fract(z / 9) - 0.5);
      const drain = -smoothstep(0.42, 0.5, Math.max(gx, gz)) * 0.09;
      // The casting sink: the middle of the room is 1.3 m low over a 30 m
      // dish, so the fight has a floor with a lip you can be pushed over
      // rather than a plane. Gentle enough (1.3 m over 16) that nothing about
      // it is unwalkable — the drama is the lip, not the gradient.
      const sink = -smoothstep(34, 17, Math.hypot(x * 0.94, (z + 5) * 1.08)) * 1.3;
      // A loading apron down one side, one step up. It is the only thing in
      // the room that tells you which way is out.
      const apron = smoothstep(46, 56, x) * 1.5;
      return shell + drain + sink + apron + fbm2(x * 0.085, z * 0.085, 2) * 0.035;
    },
    rockAt() { return 1; },
  },

  /**
   * THE FOUNDRY. The works' floor with a MELT CANAL cut across it.
   *
   * It gets a preset of its own rather than borrowing the works', and the
   * reason is a shape and not a colour: a foundry is a room you have to cross
   * something to fight in. The canal is 2.2 m deep with banks at 40°, which is
   * a deliberate compromise measured against two things it must not break —
   * the gait solver and the enemy nav both read one heightfield and will walk
   * anything they can climb, so a canal steep enough to be a wall would have
   * droids grinding against an invisible edge, and a canal shallow enough to
   * ignore is a decal. At 40° they march down into the melt and out the other
   * side, which is what a droid does and what a person will not.
   *
   * Everything else is the works, verbatim: same palette, same falls, same
   * shell. The two rooms are the same building.
   */

  /**
   * THE CAVERN. What the works was cut out of, three hundred metres further
   * down: wet rock, a silt floor, and standing water in the low bays.
   *
   * `damp` and a water level are what make this the one preset below ground
   * that anything grows on — ground-memory.mjs holds `maps: 'soil'` or
   * `damp > 0.2` to mean "this must carry cover", and it should: a flooded
   * excavation is the wettest floor in the game and it is not bare.
   */
  cavern: {
    /**
     * −1.50, NOT THE 0.30 THIS ROOM SHIPPED WITH, and the old number made The
     * Cut a swimming pool. The floor here is `bench + rib + sump + floor` and
     * its median inside the 60 m fighting disc is −1.09 m; against a sheet at
     * +0.30 that is 92.6% of the floor submerged, 80.2% of it knee-deep, 64.4%
     * waist-deep, and 44.8% of it deep enough to put the player's 1.62 m eye
     * UNDER a DoubleSide, depthWrite-off transparent plane — so for half the
     * level the whole frame was seen through the water shader. Driven with a
     * real Player on six bearings the render camera was under the sheet on
     * 58.5% of frames.
     *
     * The intent is written three lines down over `sump`: "two long low bays,
     * so the level has standing water you fight around instead of a puddle in
     * the middle". At −1.50 that is what it is: 41% of the disc has water on
     * it, 23% is over the ankle, 6.2% over the waist and 0.2% deep enough to
     * drown the camera, with the deepest bay 1.67 m. The FLOOR is untouched —
     * every bench, rib and spoil bank the level was tuned around is where it
     * was — because the thing that was wrong was the height of the water, not
     * the shape of the room.
     *
     * Levels.js's `deeps.water.level` carries the same −1.50. Two numbers for
     * one sea is how the Ember Shelf ended up with a coastline 2.5 m wide that was
     * lava on screen and rock underfoot; they move together or not at all.
     */
    scale: 320, res: 190, waterLevel: -1.50,
    // Wet blue-grey stone. The family is the works' own, one step colder and
    // darker, because this is the same rock with the lights off.
    sandColor: 0x414b52, rockColor: 0x2e373e,
    maps: 'soil',
    gritColor: 0x39434a, rockColor2: 0x232a30,
    dustColor: 0x4e5a60, crustColor: 0x35403f,
    // 0.050 is 18.2° and 0.185 is 35.6°: silt lies on the floor and the flats,
    // bare rock on the ribs and the spoil banks, which is the whole read.
    slopeBands: [0.050, 0.185, 0.014, 0.060],
    stoneSlope: 0.12,
    crust: 0.30, damp: 0.45, strataH: 3.4, cliffs: true,
    wind: [0.31, 0.95],
    macro: [96, 0.52, 0.30, 1.10],
    lagColor: 0x2f3a3a, sheetColor: 0x707d7e,
    // The deepest loose layer under ground: this is silt that water has been
    // laying down since the pumps stopped, and it holds a print for a very
    // long time because nothing down here disturbs it.
    loose: { depth: 0.22, refill: 210, tilt: 0.84, tint: 0.52, soot: 1.0 },
    mantle: [0.10, 0.62],
    packedColor: 0x27302f,
    ripple: 0.30, ripAspect: 1.0,    // still water, not wind
    texScale: [0.50, 0.29, 0.215],
    detail: [1.0, 30],
    height(x, z) {
      const d = Math.max(Math.abs(x), Math.abs(z));
      const shell = smoothstep(76, 96, d) * 44;
      // The cut. Benches left by whatever took the rock out, quantised into
      // steps that run across the room — the same `strata` the canyon walls
      // use, at a bench height a person can climb.
      const bench = strata(fbm2(x * 0.0072 + 3.1, z * 0.0072 - 4.4, 3) * 5.2,
        1.15, 0.55, 7.3);
      // Ribs of rock left standing between the bays, along the cut direction.
      const rib = Math.max(0, ridged2(x * 0.0142, z * 0.0061 + 2.2, 3) - 0.42) * 6.4;
      // and the sumps: where the water is. Two long low bays, so the level has
      // standing water you fight around instead of a puddle in the middle.
      const sump = -smoothstep(0.30, 0.86, Math.max(0,
        ridged2(x * 0.0049 - 1.7, z * 0.0088 + 6.1, 2))) * 1.9;
      const floor = fbm2(x * 0.055, z * 0.055, 3) * 0.16;
      return shell + bench + rib + sump + floor;
    },
    // Matched to the 0.050 → 0.185 band above, so the JS twin calls rock where
    // the material paints it and the cover survey believes the same floor.
    rockAt(x, z, slope) { return clamp(slope * 7.4 - 0.37, 0, 1); },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  MUSTAFAR
   * ═════════════════════════════════════════════════════════════════════ */

  /**
   * A basalt shelf standing out of a lava sea, under an ash fall.
   *
   * The landform argument is the same one the dune sea makes and the opposite
   * shape: a shield volcano's flank is not noise, it is FLOWS — long lobes
   * running downhill from the vent, each one a metre or two proud of the one
   * it ran over, with the levees standing at their edges and the channel
   * sunk between them. That is what `lobe` is, and it is the only thing in
   * this heightfield that is not underneath something else.
   *
   * The shelf falls away to the north-east into the sea. Everything below
   * `waterLevel` is lava (Levels.js dresses the sheet), so the coastline is
   * where the flow lobes drown — an outline with real bays and headlands
   * rather than a circle, because the lobes decide it.
   */
  scoria: {
    /**
     * 0.55, NOT THE 0.0 THIS PRESET CARRIED, and the difference was a ring of
     * ground all round the coast that was drawn as lava and treated as dry
     * rock. Levels.js sets `water: { level: 0.55 }` and that is the sheet World
     * actually builds; this number is the one `surfaceAt` (footstep sample,
     * splash particle) and the ground shader's damp band key off. Ray-walking
     * 64 bearings on the built heightfield, the drawn 0.55 contour came out at
     * 100.8-145.0 m and this one's 0.00 contour at 104.5-147.3 m: a band 0.3 to
     * 11.0 m wide, median 2.5, that was molten on screen and gave you a rock
     * footstep and a dust puff. Every other level in the game agrees between
     * the two numbers (wood 0/0, kamino 0/0, foundry -1.45/-1.45, deeps
     * 0.30/0.30) and only this one did not.
     */
    scale: 460, res: 300, waterLevel: 0.55,
    /* THE PALETTE IS ONE HUE AND IT IS NOT ORANGE. Rule 5: one family plus one
     * or two saturated accents, and the accent is the SUBJECT. Every warm
     * pixel in this level is lava, lit lava, or ash lit by lava; the rock is a
     * cold near-neutral charcoal that exists to make the accent read. Author
     * the basalt warm — the instinct, because the frame is warm — and the
     * accent has nothing to be an accent against.
     *
     * WHERE THE FIRST ATTEMPT WENT WRONG, because it is the more interesting
     * half. The instinct above was taken literally and the basalt was authored
     * COLD — base at hue 232°, the second rock band at 250° — on the argument
     * that a warm rock leaves the orange nothing to be an accent against.
     * Rendered, the ground came out LAVENDER: a two-tone cel ramp has no
     * midtones to hide a cast in, the shaded band is most of the ground on a
     * 15° sun, and a cold dark swatch under a warm sky bands straight to
     * violet. That reads as moonlight, which is the one thing this level is
     * not.
     *
     * So the family is a warm NEAR-NEUTRAL charcoal instead — base 15°, second
     * band 355°, both under 0.14 saturation — which is dark enough and flat
     * enough to sit under the accent without competing, and lands on the warm
     * side of neutral where the firelight can find it. The one genuinely
     * chromatic band is the OXIDISED crust on a cooling flow, and it is
     * deliberately the minority material. */
    sandColor: 0x3a3533, rockColor: 0x4e3c33,
    maps: 'sand',
    gritColor: 0x2f2b28, rockColor2: 0x332b2c,
    /* The ash. Pale and dry — the only thing here with any value in it, so it
     * is what draws the shape of the ground, and therefore the swatch that
     * decides what colour the SHADE is.
     *
     * WARM, not neutral, and that is a correction the frame forced. Authored
     * at 0x6f6a6a / 0x8a8280 (both dead neutral) the shaded ground rendered
     * lavender: the IBL probe is baked from the physical sky, which is blue at
     * any turbidity the exposure meter can afford, and a neutral albedo under
     * a blue probe returns blue. An albedo cannot change what is falling on
     * it, but it decides what comes back — a warm ash multiplies most of that
     * blue out, and it is also what ash lit by a red sun actually is. */
    dustColor: 0x7a6a5e, crustColor: 0x968878,
    // 0.10 is 25.8° and 0.34 is 48.7°: ash lies on the flow tops and the
    // benches, bare basalt on the levee faces and the sea cliffs.
    slopeBands: [0.10, 0.34, 0.030, 0.11],
    stoneSlope: 0.16,
    crust: 0.45, strataH: 2.6, cliffs: true,
    // Down the flow line, so the ash streaks the way the wind off the sea
    // actually lays it.
    wind: [0.62, -0.78],
    macro: [118, 0.58, 0.46, 1.10],
    rockUpland: [0.12, 6, 28],
    lagColor: 0x33363c, sheetColor: 0x7d7876,
    // Ash is the loosest ground in the game and it holds nothing: it is dry,
    // it is being fed from the sky continuously, and a print fills back in
    // inside a minute. Deeper than snow, shorter memory than sand.
    loose: { depth: 0.24, refill: 62, tilt: 0.92, tint: 0.44, soot: 1.0 },
    mantle: [0.09, 0.70],
    packedColor: 0x201f24,
    ripple: 0.70,
    detail: [0.95, 30],
    height(x, z) {
      /* The regional tilt: the shelf drains to the north-east. 0.045 and not
       * 0.085, because a tilt is meant to MODULATE the coastline — giving the
       * island a lee shore and a windward one, bays on the low side and
       * headlands on the high — and at 0.085 it swung the ground by ±27 m,
       * which is more than the shelf itself stands, so half the compass had no
       * shore inside the heightfield at all. */
      const down = (-x * 0.62 + z * 0.78);
      const tilt = -down * 0.045;

      // THE FLOWS. Phase across the flow line gives lobes about 46 m wide;
      // each lobe is a PLATEAU with a levee at its margin, which is what the
      // smoothstep buys over a sine — flat on top, hard at the edge, and
      // bounded in gradient where `pow(cos, 0.35)` (tried first) is not: that
      // form has an infinite derivative wherever the cosine crosses zero, and
      // it measured 8.2 of gradient at 5 cm going to 11.4 at 5 mm, i.e. a
      // heightfield reporting itself as very nearly discontinuous.
      const across = (x * 0.78 + z * 0.62) + fbm2(x * 0.0041, z * 0.0041, 3) * 34;
      const ph = fract(across / 46);
      const lobe = smoothstep(0.015, 0.20, Math.sin(ph * Math.PI)) * 3.4
        * clamp(fbm2(across * 0.0062, down * 0.0034, 2) * 2.0 + 0.55, 0, 1);
      // The channel each flow ran down, cut into its own lobe.
      const chan = -Math.max(0, ridged2(across * 0.0210 + 5.5, down * 0.0043, 2) - 0.52) * 3.0;

      /* The shelf itself, and its SIZE is the whole design of the level.
       *
       * Written first at smoothstep(196, 54) it was a 460 m field with the sea
       * in one corner: measured, the shoreline in the downhill direction sat
       * 125 m from the middle of the fight, and at this level's fog density
       * (half-light at 73 m) the lava was a pale band on the horizon. A map
       * whose subject is a lava sea cannot keep it a hundred and twenty metres
       * away. At 132 → 48 the shelf is a genuine ISLAND: 95-125 m of basalt
       * depending on which way the regional tilt runs, so the melt is in the
       * frame from anywhere on it, the shore is somewhere you can be driven,
       * and the walkable disc the surveys measure is the island itself. */
      const d = Math.hypot(x, z);
      const shelf = smoothstep(132, 48, d) * 17.5;
      // …and the sea floor beyond it. Without this the tilt alone decides
      // where the coast is, and the uphill half of the compass never reaches
      // it: measured, no shore at all within 220 m on two of four bearings.
      const deep = -smoothstep(104, 208, d) * 34;
      // Spatter cones on the high ground. Steep, small and everywhere — the
      // silhouettes that stop a lava plain reading as a table.
      const cone = Math.max(0, ridged2(x * 0.0165 + 9.1, z * 0.0165 - 3.3, 3) - 0.55) * 26;

      // Sea cliffs: the shelf does not ramp into the lava, it BREAKS off. The
      // strata quantiser is what makes that edge read as stacked flows.
      const raw = shelf + deep + tilt + lobe + chan + cone;
      return strata(raw, 1.9, smoothstep(9.0, 1.5, raw) * 0.55, 4.7)
        + fbm2(x * 0.062, z * 0.062, 3) * 0.22;
    },
    rockAt(x, z, slope) { return clamp(slope * 4.2 - 0.42, 0, 1); },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE TEMPLE
   * ═════════════════════════════════════════════════════════════════════ */

  /**
   * MUSTAFAR — braided rivers of lava through dark broken rock.
   *
   * "For the actual mustafar map go off the reference images more."
   *
   * THE ONE THING EVERY REFERENCE AGREES ON IS THAT THERE IS NO LAVA SEA.
   * Across `mustafar 2/3/4/5/6` the melt is a RIVER SYSTEM: a trunk channel
   * winding through a valley, strands that split off it and rejoin, falls
   * pouring over ledges, and a web of thin veins cracking the crust between
   * them. The Ember Shelf (preset `scoria`, kept, renamed at the player's
   * request) is the other thing — a shelf standing out of an open sea — and
   * the two are built from opposite sides of the same water plane:
   *
   *   scoria     the ground is an ISLAND. The sheet is everywhere the
   *              heightfield falls below it, which is most of the field.
   *   mustafar   the ground is a PLATEAU with channels CUT INTO IT. The sheet
   *              is at the datum and the shelf stands 3-26 m over it, so the
   *              only lava you can see is what is in the cuts — which is
   *              exactly the picture, and which is why the rivers have banks,
   *              islands and braid bars in them instead of a coastline.
   *
   * THE ROCK IS NOT RED. In every reference the basalt is a near-black
   * grey-brown and it only LOOKS red where the melt is throwing light on it.
   * The palette is authored at that near-black; the red arrives from the sheet
   * (analytic, self-luminous — see the Ember Shelf's note), from the point
   * lights the dressing pass strings along the channels, and from the level's
   * own sky. Author the rock warm to "help" and the accent has nothing to be
   * an accent against, which is rule 5 and is the mistake `scoria`'s own
   * comment records making from the other direction.
   */
  mustafar: {
    scale: 500, res: 300, waterLevel: 0.0,
    /* Near-black basalt, barely warm. `scoria` records the whole experiment
     * that fixes this swatch: authored COLD (hue 232-250°) a two-tone cel ramp
     * with a low sun bands straight to lavender, because the shaded band is
     * most of the ground and there are no midtones to hide a cast in. So this
     * is the same solution — a warm NEAR-NEUTRAL at 22° and 0.11 of
     * saturation, dark enough to sit under the accent and on the warm side of
     * neutral where the firelight can find it. */
    sandColor: 0x2b2622, rockColor: 0x3a3029,
    maps: 'rock',
    gritColor: 0x241f1c, rockColor2: 0x2e2622,
    /* The dust is the ash on the flow tops; the crust is the oxidised skin on
     * a lobe that has cooled. The crust is the one genuinely chromatic band
     * here and it is deliberately the minority material. */
    dustColor: 0x4a413a, crustColor: 0x6b4433,
    // 0.09 is 24° and 0.30 is 46°: ash lies on the benches, bare basalt on
    // every ridge face and every channel wall.
    slopeBands: [0.09, 0.30, 0.028, 0.10],
    stoneSlope: 0.14,
    crust: 0.52, strataH: 2.4, cliffs: true,
    // Down the trunk valley, so the ash streaks the way the draught off the
    // river lays it.
    wind: [0.78, 0.62],
    macro: [126, 0.62, 0.48, 1.12],
    rockUpland: [0.10, 5, 24],
    lagColor: 0x2b2c30, sheetColor: 0x5a4c42,
    // Ash, like the Ember Shelf's and for the same reason: dry, fed from the
    // sky continuously, a print filled back in inside a minute.
    loose: { depth: 0.22, refill: 58, tilt: 0.90, tint: 0.42, soot: 1.0 },
    mantle: [0.08, 0.66],
    packedColor: 0x1b1a1c,
    /* `ripAspect: 1.0` BECAUSE THE BASE MAP IS ROCK, and this preset was the
     * only one in the table taking the default instead of saying so.
     *
     * `uRipAspect` stretches the frame the BASE MAP is sampled through, and it
     * exists to pull the sand map's two ripple trains onto one bearing. The
     * default is 0.42 — the sand stretch — and every other preset whose base
     * map is not wind-worked writes 1.0 here with a note saying why ("a deck is
     * poured, not blown"; "still water, not wind"; "rolled plate, not blown
     * sand"). Mustafar wrote nothing, so a 0.42 frame was combing a basalt map
     * that has no train in it at all: measured coherence 0.10, against sand's
     * 0.79 and snow's 0.65. That is the same defect the meadow was fixed for —
     * crumb combed into corduroy — on a lava shelf, and it arrived by the same
     * route the `maps: 'rock'` fallthrough did, a missing declaration answered
     * with a plausible default. tools/checks/terrain.mjs now derives combed
     * from the map's own measured coherence, so the next one is loud. */
    ripple: 0.66, ripAspect: 1.0,
    detail: [0.95, 30],
    height(x, z) {
      /* ── THE RIVER SYSTEM ──────────────────────────────────────────────
       *
       * A braided river is not a sine wave and it is not a noise field. It is
       * ONE meandering centre line that a high-frequency ridged term keeps
       * splitting into strands and letting rejoin, and the thing that makes it
       * read as water rather than as a canyon is that the strands share a
       * floor: the bars between them stand a metre or two proud of the melt,
       * so the channel is wide and the sheet inside it is broken up.
       *
       * The trunk wanders along x. Three harmonics, deliberately incommensurate,
       * plus a slow warp — a river with one wavelength reads as a road. */
      const trunk = Math.sin(x * 0.0097) * 38 + Math.sin(x * 0.0042 + 1.9) * 21
        + fbm2(x * 0.0058, 4.1, 3) * 16;
      /* THE BRAID. `ridged2` is near 1 along its crest lines, so subtracting a
       * threshold and scaling gives a set of curved BARS wandering across the
       * channel; adding them to the distance-from-centre-line splits the river
       * into strands wherever a bar crosses it. This is the term that makes it
       * braided rather than a canal. */
      const bar = Math.max(0, ridged2(x * 0.0182 + 3.3, z * 0.0094 - 6.1, 3) - 0.38) * 30;
      const d1 = Math.abs(z - trunk) + bar;
      // A tributary joining from the far side, so the system has a confluence
      // in it rather than one line across the map.
      const trib = Math.sin(x * 0.0151 - 2.4) * 26 + 96;
      const d2 = Math.abs(z - trunk * 0.4 - trib) + bar * 0.7;
      // and a third strand on the near side, thinner, so the middle of the
      // field is fought across a river and not beside one
      const d3 = Math.abs(z - trunk * 0.7 + 78) + bar * 0.55;
      const river = Math.min(d1, Math.min(d2, d3));

      /* THE BANK. 0 in the channel, 1 on the shelf, over 24 m — which at 5.2 m
       * of cut is a 12° ramp out of the melt and NOT a wall. That is the whole
       * reason the number is 24 and not 8: a channel you can be pushed into
       * and cannot climb out of is a death pit, and this level's melt already
       * does 56 HP a second. */
      const bank = smoothstep(7, 31, river);
      const d0 = Math.hypot(x, z);
      /* THE CHANNELS SHALLOW OUT TOWARD THE MIDDLE, and this is a defect fix
       * rather than a shaping choice.
       *
       * `levels-quality` asks one thing of every level that declares a sea: on
       * the ground you are meant to stand and FIGHT on, the player's eye may
       * not pass under the sheet. Whatever the fluid is, a transparent
       * double-sided plane with depth-write off, seen from underneath, is the
       * single ugliest thing this renderer can show — and on this level those
       * cells are also 56 HP a second. Measured with `tools/_wetfloor.mjs` on
       * the 60 m fighting disc: 11.2% of it sat more than 1.62 m under the
       * melt, against a bar of 3%. The braid runs straight through the middle
       * of the map, which is exactly where a full 5.2 m cut cannot go.
       *
       * So the cut is SCALED: 16% of its depth at the spawn, full depth past
       * 88 m. Measured on the same disc afterwards — 0.1% over eye height and
       * the deepest cell 1.80 m under the melt, against 11.2% and 3.52 m — and
       * the melt is still THERE, on 4.1% of the fighting floor, because a
       * shallow river is still a river and still kills you in two seconds.
       *
       * It is also the composition the reference plates actually have:
       * `mustafar 3.jpeg` is a dry foreground shelf with the river system
       * beyond it, and `mustafar 4.jpeg` looks down into channels from a rim
       * you are standing on. And it gives the level what its own pool wants —
       * a clear middle to fight in, with the lethal edge at the rim you can be
       * driven onto.
       */
      const shelf = 1 - 0.84 * smoothstep(88, 24, d0);
      const cut = -(1 - bank) * 5.2 * shelf;

      /* ── THE ROCK ──────────────────────────────────────────────────────
       *
       * Ridges and spires, both gated on `bank` so nothing stands up out of
       * the river. `ridged2` again for the ridges, because what the reference
       * shows is SHARP: knife-edge crests with the flanks falling straight
       * into the channels, not the rounded swell an fbm gives. */
      /* BOTH ARE HELD OFF THE MIDDLE, and the number came out of a measurement
       * rather than a taste. `world-immersion` scores an ash level on how much
       * of the walkable r = 90 m disc is loose material at least ankle deep,
       * and ash does not lie on anything past about 12° — so relief inside the
       * fight is relief the ground cover cannot survive. Written without the
       * bowl the level measured 60% against a bar of 70%; the crests are the
       * skyline and the skyline is not where you stand. */
      const bowl = smoothstep(26, 96, d0);
      const ridge = Math.max(0, ridged2(x * 0.0051 + 8.8, z * 0.0051 - 2.2, 4)) * 24 * bank
        * (0.30 + 0.70 * bowl);
      // and the spatter cones and stacks on top of them
      const spire = Math.pow(Math.max(0, ridged2(x * 0.0148 + 7.3, z * 0.0148 - 3.1, 3) - 0.30), 1.6)
        * 34 * bank * bowl;

      /* The regional fall: the whole field drains toward +x, which is what
       * puts the falls on one side of the map and the pools on the other. */
      const fall = -x * 0.030;

      /* The rim. 90 m out the ground climbs into the volcano wall so the level
       * does not end in a cliff of sky — and so the smoke columns and the
       * distant cones the dressing pass stands have somewhere to stand. */
      const d = Math.hypot(x * 1.04, z * 0.94);
      const rim = smoothstep(150, 244, d) * 54;

      const raw = 3.1 + cut + ridge + spire + fall + rim;
      /* Quantised into flow courses near the melt, exactly as the Ember Shelf
       * quantises its sea cliffs: a channel wall reads as stacked cooled flows
       * rather than as a smooth bank, and the strength falls off with height so
       * the upland stays a landform instead of a wedding cake. */
      return strata(raw, 1.8, smoothstep(11.0, 1.2, raw) * 0.50, 5.3)
        + fbm2(x * 0.058, z * 0.058, 3) * 0.24;
    },
    rockAt(x, z, slope) { return clamp(slope * 4.4 - 0.40, 0, 1); },
  },

  /**
   * THE WARSHIP. One deck of a capital ship, read fore to aft.
   *
   * The brief is "corridors, a hangar, a bridge", and the honest constraint is
   * that this engine has ONE heightfield: no floors, no overhangs, no stairs
   * that go anywhere the nav cannot walk. A ship laid out as three DECKS is
   * therefore not available. What is available — and is what a capital ship
   * actually is anyway — is one enormous spine with the three spaces strung
   * along it at three different levels, all of them reachable on a ramp.
   *
   *   z < −30    THE BRIDGE. A raised platform, +5.4 m, reached up a 12° ramp
   *              through the aft bulkhead. It is the highest ground on the
   *              level and it is where the thing you came for is standing.
   *   |z| < 30   THE HANGAR. The floor at datum, 150 m of it, with the launch
   *              trench cut across it. The wide part of the level.
   *   z > 30     THE SPINE. The corridor run forward, narrowed by the shell to
   *              about 40 m and stepped down 1.2 m at a blast-door threshold,
   *              so walking it feels like going through a ship rather than
   *              across a room.
   *
   * THE SHELL IS ELLIPTICAL IN PLAN, and that is the one thing that stops this
   * reading as the works with a different palette. A hull section is not a
   * rectangle: it is wide amidships and it closes in fore and aft. `d` below is
   * an anisotropic Chebyshev — the room is 84 m half-width across the beam and
   * 116 m half-length along the keel — so the corridor genuinely narrows toward
   * the bow because the SHIP does, not because a wall was put there.
   *
   * The gait solver and the enemy nav read this heightfield and will walk
   * anything they can climb, so every transition here is a ramp under 15°: the
   * bridge approach is 5.4 m over 26 (12°), the spine threshold 1.2 m over 8
   * (9°), and the launch trench's banks 1.6 m over 5 (18°, which droids march
   * down and which reads as a lip rather than as a wall).
   */
  warship: {
    scale: 340, res: 190, waterLevel: -999, flat: true,
    /* DURASTEEL, and it is a COOL neutral where the works' rockcrete is a warm
     * one. The two interiors must not be the same room: measured as authored
     * swatches, the works' floor sits at hue 232° and 0.06 of saturation, and
     * this at 213° and 0.13 — a plated metal deck against a poured one. The
     * accent this level is authored around is the BOLTS, which are red, so the
     * ground is held cold and low so that red has somewhere to be. */
    sandColor: 0x474e58, rockColor: 0x333a45,
    maps: 'deck',
    gritColor: 0x39424f, rockColor2: 0x22272f,
    // Swept plate against the grey pan of hydraulic spill that has soaked into
    // the seams: the two ends of the same 76 m patchwork.
    dustColor: 0x5d6570, crustColor: 0x3a4048,
    slopeBands: [0.05, 0.20, 0.010, 0.045],
    stoneSlope: 0.2,
    crust: 0.0, strataH: 2.2,
    wind: [0, 1],                                  // fore-and-aft, along the keel
    macro: [76, 0.34, 0.22, 0.85],
    lagColor: 0x282e37, sheetColor: 0x616a76,
    // A plated deck takes no footprint at all; what it takes is a SCORCH, and
    // this is a level fought entirely with blaster bolts. 1.5 cm of grit and
    // shed carbon over the top, and a very long memory for a burn.
    loose: { depth: 0.015, refill: 220, tilt: 0.5, tint: 0.28, soot: 1.0 },
    packedColor: 0x1b2027,
    ripple: 0.4, ripAspect: 1.0,                   // rolled plate, not blown sand
    texScale: [0.40, 0.25, 0.32],
    detail: [1.6, 26],
    height(x, z) {
      /* The hull, in plan. Anisotropic so the ship is longer than it is wide,
       * and Chebyshev rather than Euclidean so the beam is a straight run of
       * wall amidships instead of a barrel. */
      /* 104 and 0.86, not 116 and 0.80. `descent.mjs` asks a room to be walled
       * by ground the player cannot walk up — over 0.55 of 1 − cos θ, i.e.
       * 63° — along every bearing out to 112 m, and the first version put the
       * fore and aft hull at 44 m over 23 m of run, which is 62.4°: two of
       * sixteen bearings opened onto a ramp the player could walk out over.
       * At 46 m over 14.6 it is 72°. */
      const d = Math.max(Math.abs(x) / 84, Math.abs(z) / 104);
      let wall = smoothstep(0.86, 1.0, d) * 46;

      /* THE SPINE IS NARROW, and it has to be narrow in the GROUND rather than
       * in the props standing on it. The first version put ribs 22 m apart on a
       * deck that was still 134 m across, so the corridor was a pair of
       * doorframes in a hall: you could walk round them, the nav walked round
       * them, and nothing about being in it felt like being in a ship. Forward
       * of the threshold the hull closes to 26 m half-width over 12 m of run.
       * `max` rather than `+`, because the two walls are the same hull seen at
       * two stations and adding them would stack 88 m of it at the bow. */
      /* A RIDGE, not a plateau: the wall rises at |x| = 30-38 and falls again
       * at 56-68, so what is outside the spine is hull rather than forty
       * metres of tabletop. `descent.mjs` walks sixteen bearings out of the
       * room asking whether there is a radius the player cannot get past, and
       * it asks it as SLOPE — so a diagonal ray that starts its walk already
       * standing on top of an unbounded wall measures no wall at all. Two of
       * sixteen bearings read 0.38 for exactly that reason. */
      const corridor = smoothstep(38, 50, z) * smoothstep(30, 38, Math.abs(x))
        * smoothstep(68, 56, Math.abs(x)) * 40;
      wall = Math.max(wall, corridor);

      // Deck plate, on a 6 m module. Half a centimetre of relief: enough for
      // the ink pass to find the seams and for a raking lamp to catch them.
      const px = Math.abs(fract(x / 6) - 0.5), pz = Math.abs(fract(z / 6) - 0.5);
      const seam = -smoothstep(0.40, 0.5, Math.max(px, pz)) * 0.055;

      /* THE BRIDGE. Raised aft, on a ramp that starts at z = −30 and tops out
       * at −56. 5.4 m over 26 is 12°, which every solver in the game walks. */
      const bridge = smoothstep(-30, -56, z) * 5.4;
      // and its own bulkhead, closing the bridge off from the hangar except at
      // the ramp. Two piers with a 22 m opening between them.
      const gap = smoothstep(24, 11, Math.abs(x - 4));
      const bulk = smoothstep(6, 2, Math.abs(z + 34)) * (1 - gap) * 9.0;

      /* THE SPINE, forward. One step down through the blast-door threshold at
       * z = +34, so the corridor sits below the hangar floor and you can see
       * where the ship changes. */
      const spine = -smoothstep(30, 38, z) * 1.2;

      /* THE LAUNCH TRENCH across the hangar, where the racks ran. 1.6 m deep
       * with 18° banks: a lip to be pushed over, never a wall. Crossed twice,
       * and the crossings are TERRAIN rather than props so that the ground the
       * nav walks and the ground the player walks are one thing. */
      const across = Math.abs(z + 4 - Math.sin(x * 0.026) * 3.5);
      const cross = Math.max(smoothstep(6.5, 3.6, Math.abs(x + 30)),
        smoothstep(6.5, 3.6, Math.abs(x - 26)));
      const trench = -smoothstep(7.2, 5.0, across) * 1.6 * (1 - cross);

      return wall + seam + bridge + bulk + spine + trench
        + fbm2(x * 0.09, z * 0.09, 2) * 0.03;
    },
    rockAt() { return 1; },
  },

  /**
   * THE COLOSSEUM. An oval of raked sand with the whole world watching it.
   *
   * The landform is three things and the boundary between the first two is the
   * only one that matters:
   *
   *   THE FLOOR       an ellipse, 62 × 46 m, raked flat and dished by 40 cm so
   *                   the middle is where everything ends up.
   *   THE PODIUM      a 5.2 m wall standing straight off the sand, all the way
   *                   round. It is 68° — 1 − cos is 0.63, past the 0.55 every
   *                   solver in this game uses for "ground you can stand on" —
   *                   and that is the entire reason it exists. The player, the
   *                   nav and the mounts are all held on the sand by the
   *                   GROUND rather than by an invisible wall, which is what a
   *                   real arena wall was for as well.
   *   THE CAVEA       banks of seating above it, rising 34 m at 30°, which is
   *                   the rake of a real amphitheatre and is what puts the top
   *                   row's sight line over the heads in front.
   *
   * The cavea is walkable by the numbers (0.13 of slope) and unreachable in
   * fact, because the podium is between it and everything. That is deliberate:
   * a crowd you could walk into is a crowd the fight has to be balanced around.
   *
   * The floor is authored as SAND over a stone sub-base, because the one thing
   * an arena floor does that no other floor does is take and hold a mark: this
   * preset has the longest surface memory in the game after the alpine
   * snowpack (refill 240 s against the old execution ground's 150), and what
   * that buys is a floor that visibly accumulates the whole fight.
   */
  colosseum: {
    scale: 400, res: 240, waterLevel: -999,
    /* Raked sand over a masonry bowl. The sand is a pale bleached ochre and
     * the stone is the cream ashlar of the reference frames — one warm family,
     * exactly as rule 5 asks — and the accent this level is authored around is
     * the CROWD, which carries the only saturated colour in the bowl. */
    sandColor: 0xa88a5c, rockColor: 0x9a8f78,
    maps: 'sand',
    gritColor: 0x7d6743, rockColor2: 0x6e6455,
    dustColor: 0xc2a878, crustColor: 0xa79c86,
    // The podium is 68° and the cavea 30°; the stone band has to claim the
    // first and not the second, so it opens at 1 − cos 26° and is complete by
    // 1 − cos 48°.
    slopeBands: [0.10, 0.33, 0.05, 0.16],
    stoneSlope: 0.22,
    crust: 0.35, strataH: 3.0, cliffs: true,
    wind: [0.94, 0.34],
    macro: [110, 0.55, 0.42, 1.0],
    rockUpland: [0.12, 4, 20],
    lagColor: 0x6b6355, sheetColor: 0xd0b98e,
    /* THE LONGEST MEMORY ON ANY SAND IN THE GAME, AND THE THINNEST LAYER.
     *
     * Both halves are what an arena floor actually is. It is raked before the
     * show and then not touched again, so every footfall, every skid and every
     * body that lands on it is still there at the end: 240 s of e-folding
     * against the execution ground's 150 and the erg's 40, the longest memory
     * in the game outside the alpine snowpack.
     *
     * And it is a HAND'S DEPTH of sand spread over a stone sub-base, not a
     * dune. 0.11 m is deeper than any other built floor in the game — the
     * temple's flagging is 0.02 and the works' deck 0.025 — and it is
     * deliberately under the 0.12 m that `world-immersion` uses to divide
     * ground you are IN from ground you are standing ON. That division decides
     * which bar the level answers: a sand sea has to be 70% covered material,
     * and an arena has to answer for its emptiness with its ARCHITECTURE
     * instead, which is the right question to ask of a building. Measured, it
     * answers it — 3.0% of its walkable ground has nothing within twelve
     * metres, against a bar of 10%. */
    loose: { depth: 0.11, refill: 240, tilt: 0.94, tint: 0.46, soot: 1.0 },
    packedColor: 0x6d5735,
    // Raked, and a rake leaves parallel furrows: this is the one preset where
    // the ripple field is not aeolian and is not apologising for it.
    ripple: 1.25, ripAspect: 0.30,
    detail: [0.95, 30],
    height(x, z) {
      // the ellipse, as a normalised radius: 1.0 is the foot of the podium
      const e = Math.hypot(x / 62, z / 46);
      // the floor: raked flat, dished 0.4 m over the whole oval so the middle
      // of it is where a fight collects, and scuffed at the scale of a footfall
      const dish = -smoothstep(1.0, 0.0, e) * 0.4;
      const rake = fbm2(x * 0.05, z * 0.05, 3) * 0.10;

      /* THE PODIUM. 5.2 m over 2 m of run, which is 68°, which is 0.63 of
       * 1 − cos θ, which is past the 0.55 every walkability survey in this
       * project uses. Written first as 5.2 over 4 it was 52° — 0.39 — and the
       * player could walk up the arena wall and out into the crowd. */
      const podium = smoothstep(1.0, 1.045, e) * 5.2;

      /* THE CAVEA. 34 m of seating at 30°, in courses of 0.72 m so the ink
       * pass has a step to draw on every row — a smooth bank reads as a hill
       * with people on it, and the rows are the whole of what says "seating".
       * `strata` is the quantiser the cliffs already use. */
      const bank = smoothstep(1.05, 1.95, e) * 34;
      const seating = strata(bank, 0.72, smoothstep(1.04, 1.10, e) * 0.85, 5.7);

      /* THE ARCADE at the top, and it is what stops the bowl from ending in a
       * line against the sky — and what stops the PLAYER, which is the part it
       * was not doing.
       *
       * 15 m proud of the last row, over 2.0 e-hundredths of run, not 6 m over
       * 11. The first shape was a ramp: measured on the built heightfield, an
       * unbroken walk from the sand up through the crowd and over the top, and
       * a real Player holding W for 25 s finished at y = 45.1 m at r = 115 on
       * six of eight bearings, out on the plain beyond the building. The
       * podium — 5.2 m over 2 m of run, which the comment above it calls 68°
       * and "past the number every walkability survey uses" — never measured
       * over 0.374 on the grid it is actually sampled on, because a heightfield
       * with a 3.1 m step cannot hold a face steeper than rise/step: EVERY
       * feature in this bowl is a ramp by the time it reaches the player.
       *
       * That is the constraint this number is derived from. `Terrain.blockClimb`
       * refuses ground whose gradient exceeds 1.83 (the game's 0.52 walk limit),
       * gradient is read as a central difference over ±step, and the coarsest
       * tier builds this preset at res 130, step 3.10 m. So a wall here has to
       * rise more than 1.83 × 2 × 3.10 = 11.3 m to survive the sampling. 15 m
       * measures 2.42 on that grid, which holds at every tier and leaves the
       * margin the podium never had.
       *
       * It is also the right drawing. A real amphitheatre's outer wall stands
       * far above its top row — the Colosseum's is 48 m over an arena floor
       * 25 m below the last course — so this reads as the building it is, and
       * the bowl keeps its own horizon (`horizon: false` in the level).
       */
      const arcade = smoothstep(1.95, 1.99, e) * 15.0;

      // the four gates the floor is entered by, cut through the podium as
      // ramps so the mounts can be walked in
      const a = Math.atan2(z, x);
      let gate = 0;
      for (let g = 0; g < 4; g++) {
        const ga = g * (Math.PI / 2) + 0.32;
        let d = Math.abs(((a - ga + Math.PI) % TAU + TAU) % TAU - Math.PI);
        gate = Math.max(gate, smoothstep(0.075, 0.0, d));
      }
      const cut = gate * smoothstep(0.99, 1.12, e) * smoothstep(1.34, 1.16, e);

      return dish + rake + (podium + seating + arcade) * (1 - cut * 0.94);
    },
    // matched to the 0.10 → 0.33 band above: sand on the floor and on the
    // shallow rake of the cavea, stone on the podium
    rockAt(x, z, slope) { return clamp(slope * 4.35 - 0.43, 0, 1); },
  },

  /**
   * THE BOG. A drowned forest floor, and the one landform in this file whose
   * job is to be CLOSE.
   *
   * Every other outdoor preset here is built for distance: a dune train, a
   * canyon wall, a cirque, three painted ranges. This one is the opposite
   * claim, and the whole of it is in one number — the relief is under 3.5 m
   * over the entire 480 m map. There is nothing to see over and nothing to
   * navigate by, because in a dense wood there is nothing to see over and
   * nothing to navigate by: what you steer by is the trees, and the trees are
   * props (see src/world/Trees.js).
   *
   * What the ground does instead is DRAIN. It is a mosaic of hummocks standing
   * a metre and a half out of standing water, with the channels between them
   * connected — so the walkable ground is a network rather than a plane, and
   * crossing the level means picking a line through it. Two scales do it: a
   * 46 m ridged field for the hummocks and a 12 m one for the tussocks on top
   * of them, with the water table at 0.
   *
   * `damp: 0.9` is the highest in the file and it is what makes the material
   * read as a swamp rather than as a lawn: the shader darkens and saturates
   * toward the water table, so the ground gets visibly wetter as it goes down
   * into a channel instead of meeting the water on a line.
   */
  bog: {
    scale: 480, res: 240, waterLevel: 0.0,
    /* One hue family, and it is not green. The COVER is green — the grass
     * field carries the moss and the fern — so the ground under it is the peat
     * and leaf litter that a forest floor actually is: a very dark warm brown
     * at 28°, against the cover's 95°. Authoring the soil green as well is
     * what turns a wood into a golf course. */
    sandColor: 0x3f3527, rockColor: 0x4a4a44,
    maps: 'soil',
    gritColor: 0x33301f, rockColor2: 0x38423a,
    // the two ends of the 58 m patchwork: dry leaf litter against black peat
    dustColor: 0x584a33, crustColor: 0x1a1a12,
    // Nothing here is steep enough to be rock; what stone there is sits in the
    // water as boulders, and the dressing puts it there.
    slopeBands: [0.16, 0.42, 0.08, 0.24],
    stoneSlope: 0.34,
    crust: 0.0, damp: 0.9, strataH: 2.0,
    wind: [0.36, 0.93],
    macro: [58, 0.42, 0.30, 1.05],
    lagColor: 0x3a3b2c, sheetColor: 0x7e6c47,
    /* Peat, and it is the deepest and slowest-recovering surface in the game
     * after the alpine snowpack. A footprint in saturated peat fills with
     * water and stays: 0.20 m of give and 420 s of e-folding, which is seven
     * minutes — longer than a run spends here. */
    loose: { depth: 0.20, refill: 420, tilt: 0.72, tint: 0.52, soot: 1.0 },
    packedColor: 0x151007,
    // Water does not ripple a forest floor into corduroy.
    ripple: 0.25, ripAspect: 1.0,
    detail: [1.15, 26],
    height(x, z) {
      /* The hummocks: a ridged field at 46 m, squared so the tops are broad
       * and the channels between them are narrow — which is the shape of
       * ground that drains, and the opposite of the smooth swell an fbm gives.
       */
      const hum = Math.pow(Math.max(0, ridged2(x * 0.0215, z * 0.0215, 3)), 1.35) * 3.2;
      // tussock on top of the hummocks, and nothing in the channels: the
      // gating is what stops this reading as noise laid over everything
      const tus = Math.max(0, ridged2(x * 0.084 + 3.7, z * 0.084 - 1.2, 2) - 0.30)
        * 0.85 * Math.min(1, hum * 0.55);
      // the channels themselves, cut a little below the water table so they
      // hold standing water rather than meeting it exactly on a line
      const cut = -Math.max(0, 0.44 - hum) * 1.5;
      // a bank round the edge of the map, so the wood does not end in a cliff
      // of sky: 6 m over 90 is 4°, which reads as ground rising into the trees
      const d = Math.hypot(x, z);
      const rim = smoothstep(150, 240, d) * 6.0;
      return hum + tus + cut + rim + fbm2(x * 0.13, z * 0.13, 3) * 0.16 - 0.35;
    },
    // Nothing on this level is steep enough to strip to rock; the boulders in
    // the water are props. Matched to the 0.16 → 0.42 band above.
    rockAt(x, z, slope) { return clamp(slope * 3.85 - 0.62, 0, 1); },
  },

  /**
   * GEONOSIS — and this preset is the OPPOSITE of every other one in this file.
   *
   * Eleven reference images of this battle were read before a line of it was
   * written, and amalgamated they agree on one thing before they agree on
   * anything else: THE GROUND IS FLAT AND THE SIGHTLINES ARE ENORMOUS. Infantry
   * are visible as specks to the horizon; two armies of hundreds advance in
   * loose massed ranks across open ochre with nothing between them; the only
   * things that break the line are vertical smoke columns off wrecks, a few
   * isolated stacks, and the silhouettes of the machines themselves.
   *
   * Every level this game has shipped is a BOWL, a CIRQUE, a WASH or a DUNE
   * TRAIN — landforms whose whole job is to give the player somewhere to fall
   * back to and something to fight around. This is a mode about leading a line
   * of troops, and a line cannot form in a gully. So the design constraint is
   * inverted: the fighting ground must be flat enough to array an army on and
   * open enough to see the other one coming a hundred and fifty metres out.
   *
   * WHAT THAT COSTS, AND HOW IT IS PAID. A flat plain fails the two properties
   * every other preset gets for free from its landform — `terrain.mjs` holds
   * every outdoor level to a luminance spread over 18% and a landform occlusion
   * that varies by more than 0.05, and a plane has neither. It is paid for by
   * the three things a real deflation plain has and a plane does not:
   *
   *   THE STACKS. Isolated flat-topped buttes, benched by `strata`, standing 20
   *     to 46 m off the plain and placed by a ridged mask so they come in
   *     groups with open ground between them — which is exactly what
   *     `more geonosis landscape.jpeg` shows. They are suppressed inside 66 m of
   *     the middle, so the ground you actually array an army on stays open, and
   *     they are what carries the occlusion, the rock band and the skyline.
   *   THE RILLS. Sheetwash on a plain does not cut a valley, it cuts a braided
   *     web of shallow channels 30-60 cm deep. Underfoot they are nothing; to
   *     the material channels they are the concavity that puts fines in the
   *     hollows and lag on the interfluves, which is the whole 150 m patchwork.
   *   THE SWELL. ±1.7 m over 200 m wavelengths. You cannot feel it and you
   *     cannot see it, and it is the difference between ground and a table.
   *
   * MEASURED ON THE FIELD, inside the central 120 m — relief, then mean slope:
   *
   *     geonosis   1.62 m   2.58°
   *     arena      1.77 m   2.20°     ← the flattest fighting floor in the game
   *     meadow    13.69 m   6.58°
   *     drifts    25.26 m  17.15°
   *
   * So it is level with the arena's dish, which is the flattest ground this
   * project has, and it holds that out to 180 m where the arena's runs into a
   * 27 m wall at 60. Of the disc inside 180 m, 17.6% stands over 6 m — that is
   * the stacks, and it is the number that says this is a plain WITH buttes on it
   * rather than butte country you can fight in the gaps of.
   *
   * THE SPIRES ARE NOT HERE, deliberately. Geonosian needle spires are 4-8 m
   * across at the base and this heightfield is 1.8 m a cell, so a spire in the
   * terrain is three vertices wide and comes out as a lump. They are PROPS —
   * `makeSpire` already exists — and props can be as thin as they like.
   *
   * THE COLOUR is the one thing every image agrees on even more than the
   * flatness: red-ochre rust, pale sand streaked over it, and a sky so full of
   * dust that everything past a hundred metres desaturates into it. The two
   * rock bands are the banded buttes — an iron-stained bed over a cooler
   * grey-mauve one, which is the sandstone-over-shale pair the arena's rim
   * already uses and the reason those cliffs read as rock rather than as sand.
   */
  geonosis: {
    /* 620 m and 340 vertices — the largest field in the game, and it has to be:
     * "you can see the other army coming" is a statement about metres. 1.82 m a
     * cell, which is the coarsest here, and it is affordable precisely because
     * there is no fine landform to lose — a plain is the one shape that does
     * not need resolution. */
    scale: 620, res: 340, waterLevel: -999,
    sandColor: 0x9a5c34, rockColor: 0xa8613a,
    maps: 'sand',
    gritColor: 0x6e3f22, rockColor2: 0x6b5a55,
    // Wind-blown fines are much paler than the dirt they came off, and the
    // caliche crust on a deflation surface is paler still and nearly neutral.
    dustColor: 0xc9a074, crustColor: 0xbfae8f,
    /* Slope here is 1 − cos θ. 0.06 is 20° and 0.24 is 41°: the plain never
     * reaches the band at all, and the butte faces are all of it. That is the
     * point — this is the one level where the rock band is a LANDMARK rather
     * than a texture, because there are exactly a dozen places on the map
     * steep enough to trigger it. */
    slopeBands: [0.06, 0.24, 0.045, 0.15],
    stoneSlope: 0.22,
    crust: 0.62, strataH: 6.5, cliffs: true,
    /* The dust runs across the plain from the same bearing the level's sun
     * comes from, so the smoke columns and the drifted sand agree with each
     * other and with the shadows. */
    wind: [0.94, 0.34],
    /* Lag gain 0.72 — higher than the dune sea's 0.62 and near the arena's
     * 0.75, for the same reason the arena needs it: on ground with almost no
     * slope, the 150 m grain-sorting patchwork is the ONLY layer carrying
     * variation, and a deflation plain is the landform that patchwork actually
     * describes. This is the one preset where lag/sheet is not decoration. */
    macro: [150, 0.72, 0.55, 1.05],
    /* Rock by ELEVATION as well as slope, which is what makes the stacks read
     * as stone all the way to their flat tops rather than as sand hats. 0.14
     * slope, 6 m above the surrounding land, fully rock by 30. */
    rockUpland: [0.14, 6, 30],
    /* A deflation pavement is desert varnish on coarse gravel — grey-olive,
     * never tan, and DARKER than the dirt it was winnowed out of. The sheet is
     * the pale wind-blown fines that settle on top of it. The two bracket the
     * base in value and sit either side of it in hue, which is what stops 150 m
     * of patchwork reading as a brightness ramp. */
    lagColor: 0x4e4a41, sheetColor: 0xd8b083,
    /* THE MOST DEEPLY PRINTED GROUND IN THE GAME, and it is the mode that earns
     * it: two armies of infantry cross this plain, and the record of where they
     * went is the level's own subject. 0.24 m of loose over a hard pan, and a
     * refill time of 240 s — four minutes, longer than any other preset, because
     * the air here is dusty rather than windy. An area you fought through still
     * shows it when you come back past. */
    loose: { depth: 0.24, refill: 240, tilt: 1.0, tint: 0.52, soot: 1.0 },
    packedColor: 0x6a3d20,
    /* Aeolian ripples, but weakly: this is a deflation surface with the fines
     * blown OFF it, not a dune field with them piling up. 0.7 puts a texture on
     * the loose patches and leaves the pavement alone. */
    ripple: 0.7,
    detail: [1.0, 34],
    height(x, z) {
      const d = Math.hypot(x, z);

      /* ── THE PLAIN. Three terms and none of them is a landform.
       *
       * The swell is two octaves at 200 m and 70 m, ±1.7 m total — under the
       * eye's threshold at any distance and above the physics grid at every
       * one, which is exactly what "flat but not a table" means.
       *
       * The rills are sheetwash: a braided web at 55 m, cut 0.55 m at most,
       * with a second finer web inside it. `Math.max(0, ridged - k)` is the
       * standard channel form in this file — it is zero over most of the ground
       * and only cuts where the ridge function is high, so it produces separate
       * channels with flat interfluves between them rather than corrugation. */
      const swell = fbm2(x * 0.0050 + 3.1, z * 0.0050 - 1.4, 2) * 1.7;
      const rill = -Math.max(0, ridged2(x * 0.0182, z * 0.0182, 3) - 0.44) * 1.25
        - Math.max(0, ridged2(x * 0.049 + 6.3, z * 0.049 - 2.2, 2) - 0.52) * 0.55;
      const micro = fbm2(x * 0.14, z * 0.14, 3) * 0.09;

      /* ── THE STACKS.
       *
       * `mask` is a ridged field at 240 m thresholded hard, so buttes come in
       * clusters with hundreds of metres of open plain between the clusters —
       * which is what the landscape plate shows and what a uniform noise field
       * cannot produce. `open` keeps them off the middle: nothing rises inside
       * 66 m, and they come up over the next 40, so wherever the campaign puts
       * you there is ground to array a line on.
       *
       * The profile is a PLATEAU, not a hill: `Math.pow(m, 0.42)` flattens the
       * top of the mask and the strata band the sides, so what stands up is a
       * flat-topped stack with benched walls. `strata` is the same quantiser the
       * canyon's walls use, at 6.5 m a bed — several grid cells deep, which is
       * what makes a bench survive a 1.8 m grid at all.
       *
       * A SECOND, SMALLER SET at three times the frequency and a fifth of the
       * height gives the rubble stacks and boulder plinths the foreground plates
       * are full of, without another octave of the expensive term. */
      const open = smoothstep(66, 106, d);
      const m = clamp((ridged2(x * 0.0042 - 4.7, z * 0.0042 + 2.9, 3) - 0.62) / 0.30, 0, 1);
      /* 0.34, not 0.46, AND THE BOUND IS A CLIMB RATHER THAN A LOOK. `strata`
       * quantises with `pow(f, p)` where p runs to 5.8, so at the top of a bed
       * the riser's local slope is the strength times that exponent — this
       * ground reached 21.9 (87.4°) against verify's bound of 20, which is the
       * steepest anything in the game is allowed to be because a face past it
       * is one the gait solver cannot walk and the player cannot leave.
       *
       * It was invisible for as long as Kamino was on the roster: that preset
       * failed the same clause at 24.7 and the loop asserts per preset, so the
       * first one to fail was the only one anybody saw. Deleting Kamino
       * uncovered this one, which had been over the line the whole time.
       *
       * The BENCHES are what this term is for and they survive: 0.34 keeps the
       * flat-topped stack and the stepped wall, and takes the worst riser to
       * 18.6 (86.9°). What is lost is half a degree on the sheerest bed edge
       * in the level, which is not a thing anybody can see and is the
       * difference between a wall you can be pushed against and one you can be
       * trapped on. */
      const stack = strata(smoothstep(0, 0.62, m) * 44 * open, 7.5, 0.34, 21.3);
      const m2 = clamp((ridged2(x * 0.0126 + 8.2, z * 0.0126 - 5.1, 2) - 0.66) / 0.26, 0, 1);
      const rubble = smoothstep(0, 0.7, m2) * 8.0 * open;

      /* ── THE FAR SIDE. The map is a hard-bounded box and the painted ranges
       * (addHorizon) are what sell "endless" — see the note at the head of
       * LEVELS. What this adds is the ground rising into them, so the drawn
       * ranges stand ON something instead of floating at the edge of a plane.
       * It starts at 236 m, which is beyond every sightline the fight uses. */
      const far = smoothstep(236, 306, d) * 26
        * (0.55 + Math.max(0, ridged2(x * 0.0072, z * 0.0072, 2)) * 0.9);

      return swell + rill + micro + stack + rubble + far;
    },
    /* 0.06 → 0.24 is this preset's own rock band, i.e. stone starts at 20° and
     * is all stone by 41°. The twin has to cross where the material does. */
    rockAt(x, z, slope) { return clamp(slope * 5.55 - 0.33, 0, 1); },
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
/**
 * HOW MUCH OF THE GROUND'S TEXTURE RELIEF SURVIVES INTO THE SHADING.
 *
 * Zero — see the long note where it is applied, in TERRAIN_FRAG_MAP. It is a
 * named constant rather than a deletion because the maps, their amplitudes and
 * their tangent frames all still exist and are all still measured (the ripple
 * bearing, the joint depth, the sward relief); what this switches off is
 * whether a two-tone terminator is allowed to see them, and that is one number
 * with a reason attached rather than a rewrite of two hundred lines that would
 * have to be undone to change the answer.
 *
 * It is exactly 0 and not 0.1: any non-zero value puts speckle back wherever
 * N·L lands near the terminator, and "a little bit of speckle" is not a smaller
 * version of the artefact, it is the same artefact in a narrower band.
 */
const TER_RELIEF = '0.0';

/**
 * WHERE THE GROUND'S PHOTOGRAPHIC TONE STOPS, in metres: full weight to the
 * first, gone by the second.
 *
 * 45 m is about where a 3 cm ripple crest drops under one pixel at this field
 * of view and resolution, so past it the map is not describing a surface any
 * more — it is sampling a noise field once per pixel, which crawls when the
 * camera moves and dithers when the posteriser lands on it. 150 m is where the
 * aerial term has taken enough of the surface that nothing is left to modulate.
 *
 * The near half of a frame keeps every bit of the detail it had. This is a
 * statement about distance, not about texture.
 */
const TER_FLAT = [45, 150];

/**
 * THE PERSISTENT SCAR FIELD'S CELL, in metres, and it is fixed at every
 * quality tier for the reason set out where the field is built: what the
 * ground remembers must not be a settings slider.
 *
 * 1.6 m is chosen against the thing it has to draw. `World._boltHitTest`
 * craters at 0.55 m and `Particles.boltImpact` burns at 0.26 m, so a single
 * bolt is under one cell either way and lands as one dark texel — which is
 * correct, because one bolt IS one dark spot the size of a dinner plate seen
 * from ten metres. An explosion is 2.6 m and covers three cells across, so it
 * has a shape. Halving it to 0.8 m would quadruple the memory to draw a scuff
 * the same size on screen at any range a battlefield is read from.
 */
const SCAR_CELL = 1.6;

/**
 * How much of one burn's heat the permanent record keeps, per hit, stacking.
 *
 * 0.30 is a measurement of the thing it has to survive: a fought Command area
 * lays 539 marks over roughly 25 000 m² of walkable ground, so the average
 * square metre is hit about once and the hardest-fought ones tens of times.
 * At 1.0 the first bolt would blacken its cell outright and a battlefield
 * would be a field of identical black dots; at 0.30 it takes four passes over
 * the same ground to blacken it, so what the field draws is where the fighting
 * CONCENTRATED, which is the only thing about it worth a picture.
 */
const SCAR_STACK = 0.30;

/**
 * What a crater's own soot is worth, as a fraction of its churn.
 *
 * A crater is not just a hole — an explosion burns what it throws. This is why
 * a replayed crater log paints as well as digs: `crater` is the one method
 * every site that breaks this ground goes through (see CraterLog), so putting
 * the soot here means the log persists the DRAWN mark without a second event
 * kind for the ninety per cent of marks that are already on it.
 */
const SCAR_BLAST = 0.55;

/** How often the scar field's writes reach the GPU. See `Terrain.tick`. */
const SCAR_TICK = 0.1;

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
  uniform vec4 uSward;       // amount, comb scale (1/m), relief, unused
  uniform vec3 uSwardA;      // the mat's canopy, where it is thick
  uniform vec3 uSwardB;      // and what shows down between the blades
  uniform vec4 uSurf;        // window centre x, z, 1/window size, half window (m)
  uniform vec4 uSurfSet;     // master gain, tilt gain, packed tint, soot
  uniform sampler2D uSurfMap;   // WHAT HAS HAPPENED HERE — depth, ∂depth, scorch
  uniform vec4 uScarSet;     // master gain, tilt gain, turned tint, soot
  uniform vec2 uScar;        // 1/period (m), unused — the WHOLE map, never a window
  uniform sampler2D uScarMap;   // WHAT HAPPENED HERE AND DID NOT GO AWAY
  uniform vec3 uSurfCol;     // the colour of turned, packed material
  uniform vec3 uSurfGlowCol; // what a cut in this ground glows
  uniform vec2 uFarMean;     // base map / rock map mean tone — what the far field collapses onto
  uniform vec3 uNrmScale;    // base, near detail, rock
  uniform vec3 uSkyCol;      // the fallback asymptote, when nothing drew a sky
  uniform sampler2D uSkyStrip;  // the DRAWN sky at the skyline, over bearing
  uniform vec2 uHaze;        // extra density gain at range, sky blend

  /* How many flat steps a layer blend gets before it picks a colour, and how
   * far the ground's photographic tone survives. See CEL.blendBands and
   * TER_FLAT in src/world/Terrain.js. */
  const float TER_BLEND = ${CEL.blendBands.toFixed(1)};

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

  /**
   * DRAWN SPECKLE — literal dots, widely spaced, on a lattice, NOT a noise field.
   *
   * Rule 6 of src/toon/REFERENCE.md is exact about this: "Ground detail as
   * sparse dark speckle dots — literal dots, widely spaced, no noise field."
   * It is the positive half of the change that took the shaded relief out of
   * the ground (TER_RELIEF) and collapsed its photographic tone at range
   * (terFlat); without it the ground reads as flat-but-empty rather than
   * flat-but-drawn.
   *
   * A lattice with a jittered centre per cell, and most cells empty. That is
   * what makes it read as marks somebody put there: an fBm field thresholded to
   * the same coverage gives blobs with fractal edges, which is the thing rule 6
   * is contrasting against.
   *
   * THE DOT'S EDGE SOFTENS WITH THE PIXEL FOOTPRINT. A hard-edged 40 cm mark is
   * about two pixels at 150 m, and a two-pixel hard disc on a lattice is a
   * sparkling moiré as the camera moves. The soft argument is the footprint in
   * the same units the radius is in, so the mark stays a mark up close and
   * dissolves into an even tint exactly when it stops being resolvable —
   * mip-mapping, done by hand, for a function that has no mip chain.
   *
   * (No backticks anywhere in this comment. It lives inside a JS template
   * literal, and one backtick closes the string and takes the whole material
   * out of the frame. node --check catches it; tools/verify.mjs does not.)
   *
   * @param p    world XZ, metres
   * @param cell lattice pitch, metres
   * @param fill fraction of cells that carry a dot
   * @param rad  dot radius, in cells
   * @param soft edge width, in cells
   */
  float terSpeckle(vec2 p, float cell, float fill, float rad, float soft) {
    vec2 q = p / cell;
    vec2 i = floor(q), f = fract(q);
    float h = thash(i * 1.031 + 4.7);
    if (h > fill) return 0.0;
    vec2 c = vec2(thash(i + 3.7), thash(i * 0.917 + 11.3)) * 0.56 + 0.22;
    float d = length(f - c);
    return 1.0 - smoothstep(rad - soft, rad + soft, d);
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

  /* ── THE FAR FIELD IS THE FLATTEST PART OF THE PICTURE ──────────────────
   *
   * "The cleanest, flattest part of a Sable frame is the distance. In ours it is
   * the noisiest." That is rule 3 and rule 6 arriving together, and the cause is
   * one line: the ground's tone is modulated by a PHOTOGRAPHIC map — a ripple
   * field, a joint network — whose features are centimetres across. Past forty
   * metres those features are smaller than a pixel, so what the map contributes
   * is not detail but per-pixel variance, and the posteriser turns per-pixel
   * variance into salt-and-pepper dither.
   *
   * So the map's TONE is collapsed onto its own mean with range. The mean is the
   * map's real one (uFarMean, from MEAN_ALBEDO), which is what makes this exact
   * rather than approximate: the far field lands on precisely the colour the
   * level authored, with the texture contributing nothing either way. Nothing
   * else changes — the macro fields (mA at 70 m, mD at 140 m) are LOW frequency,
   * still several pixels wide at 300 m, and they are what a distant hillside is
   * supposed to vary over. What replaces the lost centimetre detail is drawn:
   * strata seams and speckle, which do not shrink with distance. */
  float terFlat = 1.0 - smoothstep(${TER_FLAT[0].toFixed(1)}, ${TER_FLAT[1].toFixed(1)}, viewDist);

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
  /* ── QUANTISE THE BLEND, THEN THE RESULT ────────────────────────────────
   *
   * Every weight below is snapped to CEL.blendBands nodes before it is used for
   * anything.
   *
   * ONE HONEST CORRECTION, because the obvious reason for doing this turns out
   * not to be the true one. The story is that a posteriser dithers wherever its
   * input drifts across a band boundary, so quantising the blend first stops the
   * far field speckling. Measured (tools/checks/cel.mjs), that is FALSE for this
   * shader: a posteriser only dithers on input that varies per PIXEL, the blend
   * weights here are driven by noise fields at 9 m and 140 m — fifteen pixels
   * and more across at any range you can see a cliff from — and quantising a
   * smooth input changes the dither not at all. What was actually speckling the
   * arena's far wall was the rock MAP, whose features are centimetres wide and
   * therefore genuinely per-pixel out there, and that is fixed by terFlat above.
   *
   * What this does buy, and what the check measures instead, is COUNTABILITY —
   * rule 1 applied to the ground's palette rather than to its tone. Unquantised,
   * a hillside is a continuum of mixtures and every pixel of it is its own
   * colour; snapped, it is a handful of flat fields with a drawn boundary
   * between each pair, which is what the reference's ground is.
   *
   * Snapped to nodes rather than to plateau centres (saberCelQuant, not
   * saberCelBand1): a mask has to be able to reach 0 and 1, or the flattest sand
   * in the level carries an eighth of a rock tint. See CEL.blendBands. */
  float rockW = saberCelQuant(
    smoothstep(uBands.x, uBands.y, slope + (mB - 0.5) * 0.14
               + smoothstep(uRockUp.y, uRockUp.z, vWPos.y) * uRockUp.x), TER_BLEND);
  float gritW = saberCelQuant(
    smoothstep(uBands.z, uBands.w, slope + (mC - 0.5) * 0.09), TER_BLEND) * (1.0 - rockW);
  // fines blow off the convex windward brinks and settle in the lee and hollows
  float scour = crest * clamp(expo * 1.3 + 0.3, 0.0, 1.0);
  float driftW = saberCelQuant(clamp(hollow * 1.25 + lee * 0.5 - 0.12, 0.0, 1.0)
               * smoothstep(uBands.w * 1.6, 0.0, slope), TER_BLEND) * (1.0 - rockW);
  // A crust — salt pan, ash flat, dried silt — takes the flat floor of the
  // basins. Modulated at the macro scale, not the patch scale: a pan is one
  // feature you can see the far side of, not a spatter of light patches.
  float crustW = saberCelQuant(clamp(uGround.y * smoothstep(0.13, 0.02, slope)
               * smoothstep(0.25, 0.72, basin) * (0.55 + mA * 0.85), 0.0, 1.0), TER_BLEND);
  // The two ends of grain sorting, at the scale a landscape actually varies on.
  // Wind strips the fines off the exposed ground and leaves a coarse dark lag;
  // it drops them again downwind as pale sheets. Without this the whole map is
  // one hue and no amount of ripple detail rescues it.
  // (the thresholds are quantiles of mD, measured on the real field: it runs
  // 0.16 … 0.86 with p50 at 0.44, so lag takes the top third, sheet the bottom
  // third, and the middle third stays base. Set against the nominal 0…1 range
  // instead, lag only reached full strength in the top tenth of the map.)
  float lagW   = saberCelQuant(smoothstep(0.47, 0.61, mD + scour * 0.14 - hollow * 0.10)
               * uMacro.y, TER_BLEND) * (1.0 - rockW);
  float sheetW = saberCelQuant(smoothstep(0.44, 0.28, mD - hollow * 0.10 - lee * 0.08)
               * uMacro.z, TER_BLEND) * (1.0 - rockW);

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
  float coverW = 0.0;
  float swardBlade = 0.5;
  float swardCross = 0.5;
  if (uCover.x > 0.001) {
    float cov = uCover.x * texture2D(uCoverMap, wp * uCover.y + 0.5).r
              * smoothstep(0.30, 0.08, slope)
              * smoothstep(uGround.x - 0.35, uGround.x + 0.45, vWPos.y);
    col = mix(col, uCoverCol, cov);
    coverW = cov;

    /* ── AND WHAT SHOWS BETWEEN THE BLADES IS SWARD, NOT SOIL ─────────
     *
     * The complaint is "the meadow must be ALL GRASS — the bare ground never
     * visible anywhere", and the instanced field alone cannot answer it. The
     * arithmetic is in GRASS_TIERS: cover from a scatter is 1 − exp(−λa), so
     * closing the last few per cent costs exponentially more instances than
     * the first fifty, and the ground between the blades is what the eye reads
     * when you look down at your own feet — where the view is nearly plan and
     * the silhouettes have almost no depth to hide behind.
     *
     * So the last few per cent are not bought with geometry. On ground the
     * cover field says is covered, the SURFACE is a mat of blade tips seen
     * from above: a comb direction that swirls at four metres, blades three
     * centimetres across and twenty-five long, and the level's own two grass
     * colours sorted between them. It costs four noise taps on ground the
     * shader has already decided is vegetated, and it is the difference
     * between a field of tussocks standing on a painted plane and a field of
     * tussocks standing in grass.
     *
     * NOT the same colour as the blades. This is the mat DOWN AMONG them,
     * shaded by everything standing over it — see the cover setter below,
     * which derives both stops from the level's own tints and darkens them.
     * (Spelling that method's name here breaks tools/checks/terrain-aerial.mjs,
     * which slices this file between '_syncAtmosphere()' and the first
     * occurrence of it. A source-slicing check is a real constraint on where a
     * name may appear, and it is cheaper to respect than to argue with.)
     */
    if (uSward.x > 0.001 && cov > 0.02) {
      // which way the mat lies here — one bearing over a few metres, because
      // sward that points a different way every centimetre is felt, not grass
      float sang = (tnoise(wp * uSward.y) - 0.5) * 6.2832;
      vec2 sdir = vec2(cos(sang), sin(sang));
      vec2 sp = vec2(dot(wp, sdir), dot(wp, vec2(-sdir.y, sdir.x)));
      // 3 cm across the comb and 25 cm along it: a blade, at the aspect a
      // blade has. Two scales so the mat has coarse and fine in it.
      float bl1 = tnoise(vec2(sp.x * 4.2, sp.y * 33.0));
      float bl2 = tnoise(vec2(sp.x * 9.5, sp.y * 74.0));
      float bl = bl1 * 0.62 + bl2 * 0.38;
      // …and which patch of sward, at the scale a meadow changes over
      // NOT "patch", and not "mat": both are reserved words in ESSL 3.00 and
      // the fragment shader fails to compile with "illegal use of reserved
      // word", which surfaces as a black terrain and one console line.
      // And NOT backticks in this comment either — this whole block is a
      // JS template literal, so one closes the string and the module stops
      // parsing. node --check catches that; verify.mjs does not.
      /* THE BLADE SCALE HAS TO GO AWAY WITH RANGE, and the patch scale must
       * not. A 3 cm feature is well under a pixel by twenty metres, so past
       * that it is not detail, it is noise sampled once per pixel — which
       * crawls when the camera moves and is the classic way a procedural
       * ground betrays itself at distance. Collapsing it toward its own mean
       * leaves the 3 m patchwork, which is exactly the scale a meadow changes
       * colour over and is still several pixels wide at 300 m. */
      float fine = 1.0 - smoothstep(14.0, 55.0, viewDist);
      bl = mix(0.5, bl, fine);
      float swardPatch = clamp(tfbm(wp * 0.30) * 1.5 - 0.22 + (bl - 0.5) * 0.55, 0.0, 1.0);
      // BOTH taps are carried, not the blend and a function of it: the relief
      // below needs two INDEPENDENT numbers to tilt with. Deriving the second
      // from the first puts every normal in the mat on one diagonal, which
      // lights as a corduroy rather than as grass.
      swardBlade = bl;
      swardCross = bl2;
      vec3 swardCol = mix(uSwardA, uSwardB, swardPatch) * (0.74 + bl * 0.52);
      col = mix(col, swardCol, cov * uSward.x);
    }
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
  // …and the whole of it goes away with range, onto the map's own mean, so a
  // distant slope is the level's authored colour and nothing else. See terFlat.
  baseLum = mix(uFarMean.x, baseLum, terFlat);
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
    /* THE STRATA ARE A DRAWN CONTOUR LINE (rule 6), not a shaded ledge.
     *
     * "Mint cliffs drawn with contour strata lines" is the third reference
     * frame, and this seam is the only thing in the game that draws them. It
     * mattered less when the rock texture was carrying tone at every range;
     * now that the far field collapses onto a flat colour (terFlat) this IS
     * the cliff's interior detail, and it has to read as a line.
     *
     * So it is narrower and darker than it was — a 7% band rather than an 11%
     * one, at 0.46 rather than 0.34 — and, unlike a texture, it is procedural
     * in WORLD space, so a bed 150 m away is drawn exactly as firmly as a bed
     * at arm's length. That is the property a drawn mark has and a photographed
     * one does not.
     */
    float seam = (smoothstep(0.075, 0.0, bandF) + smoothstep(0.925, 1.0, bandF))
               * (0.25 + thash(vec2(bandI, 21.7)) * 1.1);
    // Beds differ from each other more than the rock inside one bed differs
    // from itself. That ordering is what makes a wall read as bedded; with the
    // fracture network louder than the bedding it reads as cork.
    vec3 rockTint = mix(uRockCol, uRockCol2, bandR) * (0.72 + bandR * 0.58) * (1.0 - seam * 0.46);

    float rockLum = mix(uFarMean.y, dot(rockC, vec3(0.3333)), terFlat);
    col = mix(col, rockTint * (0.74 + rockLum * 0.68), rockW);
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
      col = mix(col, rockTint * (0.74 + mix(uFarMean.y, dot(cv, vec3(0.3333)), terFlat) * 0.68), k);
      terNrmOff = mix(terNrmOff, (Tv * nv.x + Bv * nv.y) * (uNrmScale.z * nFade), k);
    }
  #endif
  }

  /* ── THE DRAWN MARKS (rule 6) ───────────────────────────────────────────
   *
   * Two lattices rather than one, because one lattice at one size is a pattern
   * you can read; two coprime pitches at different sizes and coverages read as
   * scattered stones and grit. Both are in WORLD space, so they sit on the
   * ground rather than on the screen, and neither is a noise field.
   *
   * The footprint handed to terSpeckle is the world size of one pixel at this
   * range — 2·tan(fov/2)/height · viewDist, and the constant below is that for
   * this game's 52° vertical field at 1080p — divided by the lattice pitch to
   * put it in the same units as the radius. Past about 250 m a dot is under a
   * pixel and the term has softened into a flat tint of exactly its own mean,
   * which is the correct answer rather than a fade.
   */
  float spx = viewDist * 0.00090;
  float speck = terSpeckle(wp, 2.7, 0.16, 0.150, clamp(spx / 2.7, 0.020, 0.150))
              + terSpeckle(wp + 41.3, 6.1, 0.085, 0.115, clamp(spx / 6.1, 0.016, 0.115));
  // Dark on loose ground and darker on rock, and nowhere near a crust or a
  // sward: a salt pan and a grass mat are not stony ground and do not get grit.
  col *= 1.0 - clamp(speck, 0.0, 1.0) * (0.115 + rockW * 0.085)
             * (1.0 - crustW * 0.8) * (1.0 - coverW * 0.85);

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

  /* ── WHAT HAS HAPPENED TO THIS GROUND ────────────────────────────────
   *
   * One tap of the surface memory (src/world/Surface.js): depth in R, the
   * depth GRADIENT already differenced into G/B, and scorch in A.
   *
   * The gradient is the whole trick. A footprint 25 cm across and 30 cm deep
   * is twenty times finer than the heightfield's 1.6 m cell, so it can never
   * be geometry here — but a print is not read as geometry anyway. It is read
   * as a lit wall and a shaded one, which is a NORMAL, and a normal is exactly
   * what a surface can carry. The depth itself then does the two things the
   * tilt cannot: it darkens the trough, because packed snow and turned sand
   * are darker than the face they came off, and it takes sky away from the
   * bottom of a hole.
   *
   * The window is 48 m of ground that follows the player, so the mask is not
   * optional: without it the wrap addressing prints somebody's tracks on a
   * hillside a window away.
   */
  /* The mat's own relief. It lives here rather than beside its albedo because
   * this is where the ground's tangent frame exists; swardBlade was measured
   * up there and carried down. Half a millimetre of geometry and it is what
   * stops the mat reading as a printed pattern: blade tips catch the sun and
   * the gaps between them do not. Faded out with range along with every other
   * normal on this material, because at 90 m it is smaller than a pixel and
   * all it can do there is alias. */
  if (uSward.z > 0.001 && coverW > 0.02) {
    float sw = coverW * uSward.z * (1.0 - smoothstep(18.0, 60.0, viewDist));
    terNrmOff += (Txz * (swardBlade - 0.5) + Bxz * (swardCross - 0.5)) * sw * 1.6;
    terAO = clamp(terAO * (1.0 - (0.62 - swardBlade) * 0.30 * sw), 0.20, 1.06);
    terRough = mix(terRough, 0.97, coverW * 0.5);
  }

  /* ── TEXTURE IS DRAWN, NOT SHADED ──────────────────────────────────────
   *
   * Rule 6 of src/toon/REFERENCE.md: "There is no bump, no roughness variation,
   * no detail normal anywhere in these frames." Everything added to terNrmOff
   * above this line is exactly that — the ripple relief, the rock joints, the
   * sward blades — and under a two-tone terminator it does not read as relief
   * at all. It reads as SPECKLE, because that is what a detail normal does to a
   * step function: the shading is flat wherever N·L is clear of the threshold
   * and salt-and-pepper wherever it is not, and on a dune field lit at 26° a
   * ripple map of this amplitude puts most of the near ground within reach of
   * the threshold. Screenshotted: the whole foreground of the dune sea came out
   * as a mat of dark dashes.
   *
   * NOTHING IS LOST BY REMOVING IT. The ripple, the joints and the sward are
   * all in the ALBEDO already — the base coat is modulated by the same map's
   * luminance a few lines up (col *= 0.55 + baseLum * 1.15), which is a drawn
   * mark and exactly what rule 6 asks for. What goes is the second, shaded copy
   * of the same information.
   *
   * WHAT IS KEPT, and why it is below this line rather than above it: the
   * SURFACE MEMORY. A boot print, a crater, a scorch trench is not texture, it
   * is a deformation the player made, it is gameplay feedback, and its tilt is
   * the only thing that says a print is a hole rather than a stain. It is added
   * after this scale for that reason. */
  terNrmOff *= ${TER_RELIEF};

  float surfGlow = 0.0;
  if (uSurfSet.x > 0.0) {
    vec2 sd = abs(wp - uSurf.xy);
    float win = 1.0 - smoothstep(uSurf.w * 0.80, uSurf.w * 0.98, max(sd.x, sd.y));
    if (win > 0.002) {
      vec4 S = texture2D(uSurfMap, wp * uSurf.z);
      float dep = S.r * win;
      /* DECODED, THEN GAINED. The byte holds the depth gradient over a full
       * scale of SURFACE_GRAD_FS (2.0 m per m), so "S.gb·2−1" is the gradient
       * DIVIDED BY TWO — reading it straight put a 30-degree print wall on
       * screen at 14. The preset's tilt is a gain about 1, not the decode. */
      vec2 grd = (S.gb * 2.0 - 1.0) * (2.0 * uSurfSet.y) * win;
      // The tilt goes in the ground's own tangent frame, alongside the ripple
      // relief, and it REPLACES that relief where it is deep: a boot print has
      // squashed the sastrugi it went through.
      terNrmOff = terNrmOff * (1.0 - dep * 0.75) + (Txz * grd.x + Bxz * grd.y);
      // Turned material: darker, and toward the level's own packed colour
      // rather than toward black, so a print in snow goes blue and a print in
      // sand goes brown.
      // NOT "packed": that is a RESERVED WORD in GLSL ES. Declaring one
      // compiles fine in your head and fails on the device with a message
      // pointing at the next line, taking the whole terrain shader — and with
      // it the ground — out of the frame. verify.mjs scans every glsl block.
      //
      // A SMOOTHSTEP, not the depth itself: linear in depth spends most of its
      // range on holes deeper than any boot makes. A footfall in half a metre
      // of snow reaches 0.29 of the encoded scale, so linear gave it 29% of
      // the tint and the print rendered as a faint smudge on white. What is
      // wanted is that undisturbed snow is untouched and anything actually
      // stepped in is most of the way to packed.
      float packing = smoothstep(0.04, 0.52, dep) * uSurfSet.z;
      diffuseColor.rgb = mix(diffuseColor.rgb, uSurfCol, packing);
      // a hole sees less sky than the flat beside it
      terAO = clamp(terAO * (1.0 - smoothstep(0.03, 0.60, dep) * 0.42), 0.20, 1.06);
      terRough = mix(terRough, 0.70, dep * 0.55);
      /* SCORCH IS ONE SCALAR AND TWO THINGS. Above the half-way mark it is
       * still hot, and the glow is what the player sees for the first few
       * seconds; under it, it is soot, and soot is an albedo. Splitting them
       * with two smoothsteps off the same byte is what lets a saber cut cool
       * on screen without a second channel and a second tap. */
      float soot = smoothstep(0.02, 0.34, S.a) * win;
      float heat = smoothstep(0.52, 0.95, S.a) * win;
      diffuseColor.rgb *= mix(1.0, 0.16, soot * uSurfSet.w);
      surfGlow = heat;
    }
  }

  /* ── AND THE LONG MEMORY, WHICH HAS NO WINDOW AND NO GLOW ──────────────
   *
   * Same texture layout, same one tap, three differences and every one of them
   * is the difference between a window and a battlefield (see Terrain.scars):
   *
   *   NO MASK. The field's period IS the map, so fract(wp / size) is an exact
   *     bijection and there is no edge to fade against. RepeatWrapping does the
   *     fract, so this is a multiply and a fetch.
   *   NO GLOW. Nothing here is hot. A scar is soot, and soot is an albedo —
   *     the top half of the byte's range means "burnt harder", not "still
   *     burning", so it is read with ONE ramp instead of the window's two.
   *   IT IS DRAWN AT DISTANCE. terFlat collapses the photographic maps past
   *     45 m because their features are sub-pixel out there; this one is
   *     metres across and is exactly what the far field has none of. It is the
   *     only thing on this ground that says a war happened, from 200 m.
   *
   * ORDER MATTERS AND IT IS THE PHYSICAL ONE: the window is the loose layer
   * lying on top and the scar is the ground under it, so a fresh footprint
   * across old burnt ground darkens as it should rather than wiping it. Both
   * multiply, so the two commute in the soot term and only the turned-colour
   * mix cares — and a print pressed into burnt ground turns up burnt material,
   * which is what taking the scar first gives. */
  if (uScarSet.x > 0.0) {
    vec4 K = texture2D(uScarMap, wp * uScar.x);
    float kd = K.r;
    if (kd > 0.004 || K.a > 0.004) {
      vec2 kgrd = (K.gb * 2.0 - 1.0) * (2.0 * uScarSet.y);
      /* THE SHADING IS THE WHOLE POINT OF THIS CHANNEL. §14 Step 0 measured a
       * bolt crater at 3.35 m across and 1.6 mm deep — geometry the heightfield
       * is telling the truth about and the eye cannot possibly see. The same
       * mark is 1.6 mm over a 1.6 m cell here, which is a 0.001 gradient and
       * still invisible; what makes it read is that a crater ALSO turns the
       * material and burns it, and those two are albedo terms that do not care
       * how deep the hole is. The tilt is kept because a shelled 2.6 m crater
       * is 0.55 m deep and that one does have a wall. */
      terNrmOff += Txz * kgrd.x + Bxz * kgrd.y;
      /* ── THE EDGE IS FRAYED BY THE GROUND'S OWN NOISE, AND IT HAS TO BE ───
       *
       * A 1.6 m texel read through a linear filter is a 3 m blob with a soft
       * rim, and twenty sorties of them merge into one amoeba: rendered, the
       * first pass read as OIL STAINS — smooth, rounded, and exactly the shape
       * the eye files as a shadow. Rule 6 of src/toon/REFERENCE.md and §11's
       * "no gore effect may have a soft edge" both say the same thing about
       * it, and the field cannot be given a finer cell without quadrupling
       * what the ground remembers to draw a scuff the same size on screen.
       *
       * So the threshold is dithered by the two noise fields the shader has
       * already computed for the sand — 1.2 m and 9 m, no new taps — which
       * turns a soft ramp into a ragged coastline at both scales at once.
       * That is also what burnt ground IS: fire takes the patch it takes, and
       * the boundary is a fractal, not a circle. Scaled by the mark's own
       * strength so a texel holding almost nothing cannot be dithered UP into
       * a stain on clean ground. */
      float kfray = ((mC - 0.5) * 0.30 + (mB - 0.5) * 0.16
        /* AND A THIRD SCALE, NEAR ONLY. mC is 1.2 m and mB is 9 m, which is
         * the right pair at fifty metres and not enough at fifteen: a 1.6 m
         * texel under the player's nose covers fifty pixels, and an edge
         * dithered only at 1.2 m is still an airbrush at that size. The 0.34 m
         * term is what makes it a coastline when you walk up to it — and it is
         * multiplied by terFlat for exactly the reason terFlat exists, because
         * a 0.34 m feature is sub-pixel past forty metres and past forty metres
         * a sub-pixel feature is not detail, it is dither. */
        + (tnoise(wp * 2.9) - 0.5) * 0.26 * terFlat) * min(1.0, max(kd, K.a) * 6.0);
      float turned = smoothstep(0.08, 0.46, kd + kfray) * uScarSet.z;
      diffuseColor.rgb = mix(diffuseColor.rgb, uSurfCol, turned);
      terAO = clamp(terAO * (1.0 - smoothstep(0.05, 0.62, kd) * 0.34), 0.20, 1.06);
      float ksoot = smoothstep(0.06, 0.34, K.a * uScarSet.w + kfray);
      /* 0.24 AND NOT ZERO. Burnt sand is a dark warm brown, not a hole in the
       * frame — and §11's second hard rule about the gruesome is the same
       * thought from the other end: nothing on this ground may out-contrast a
       * lightsaber. A quarter of the albedo is two full cel bands down from
       * the sand beside it, which is as far as anything on the ground is
       * allowed to move. */
      diffuseColor.rgb *= mix(1.0, 0.24, ksoot);
      terRough = mix(terRough, 0.86, ksoot * 0.7);
    }
  }
`;

/**
 * The cut line, while it is still hot.
 *
 * Emissive rather than albedo because that is what it is: fused ground at
 * two thousand kelvin is a light source, it survives the shadow it is lying
 * in, and it is the one thing on the ground the bloom pass should find.
 */
const TERRAIN_FRAG_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  totalEmissiveRadiance += uSurfGlowCol * (surfGlow * surfGlow * uSurfSet.x);
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
    /* DISTANCE IN PLATES. The engine bands its own fog chunk the same way (see
     * saberCelDistance in src/toon/Cel.js, installed into <common>), and the
     * ground has to be banded on the SAME grid as everything standing on it or
     * a prop at 90 m sits in a different plate from the ground under its feet.
     *
     * Only the strength is quantised. The tone above is the drawn sky in the
     * view direction, which is a smooth function of bearing and has to stay one
     * — rule 3 of REFERENCE.md is that distance is a HUE SHIFT toward the sky,
     * and the whole of that shift lives in fogTone. */
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTone, saberCelDistance(fogFactor));
  #endif
`;

/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How far the ground may be dug out and piled up over a whole run, in metres,
 * accumulated per grid cell. These were inline in `crater` and bounded the
 * wrong array — see the note at the point of use.
 */
const MAX_DEFORM_DOWN = 4.5, MAX_DEFORM_UP = 3.0;

export class Terrain {
  constructor(scene, presetName = 'dunes', quality = 1) {
    /* A NAME THIS TABLE DOES NOT HAVE IS A TYPO, AND A TYPO MUST NOT MEASURE
     * CLEAN. `TERRAIN_PRESETS[presetName] || TERRAIN_PRESETS.dunes` handed back
     * the dunes on any misspelling, so a level asking for 'colloseum', a check
     * asking for a ground that has been renamed, and an instrument defaulting
     * to a preset that was cut all got a working heightfield and a green run
     * describing somebody else's ground. Same rule as `_source.functionBody`'s:
     * a missing thing gets an error, not a plausible default. */
    const preset = TERRAIN_PRESETS[presetName];
    if (!preset) {
      throw new Error(`Terrain: there is no '${presetName}' ground. `
        + `The table holds ${Object.keys(TERRAIN_PRESETS).join(', ')}`);
    }
    this.preset = preset;
    /* The NAME, not just the table row. Anything that has to be different from
     * level to level and has only the terrain to ask — the grass's cover field
     * is the first — needs a per-level seed, and reading it off the preset
     * object means two levels on one preset agree, which is the right answer
     * for a heightfield and the right answer for what grows on it. */
    this.presetKey = presetName;
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

    /* ── the surface memory ───────────────────────────────────────────
     * Built before the mesh, because the material's uniforms point straight
     * at its texture. See src/world/Surface.js for why a footprint cannot be
     * geometry on a 1.6 m grid and what it is instead.
     *
     * THE CELL IS 25 CM AT EVERY QUALITY TIER, and the tier moves the WINDOW.
     * The first version scaled the resolution and held the window, which meant
     * `medium` — the tier the screenshots are taken at, and the default —
     * carried 37 cm texels: a footfall widened to 0.64 m, laid at a 0.7 m
     * stride, and the alpine came out with broad soft undulations in the snow
     * instead of a line of prints. A print has a real size and it does not
     * negotiate with the settings menu; what a cheaper tier can honestly buy
     * is REMEMBERING LESS GROUND, which is 29 m of window instead of 60 and
     * 53 kB an upload instead of 230. */
    const LZ = preset.loose;
    const sq = this.quality >= 1.2 ? 1.25 : this.quality >= 0.9 ? 1.0
      : this.quality >= 0.7 ? 0.8 : 0.6;
    this.surface = LZ
      ? new SurfaceField({
        res: Math.round(SURFACE_RES * sq), size: SURFACE_SIZE * sq,
        depth: LZ.depth, refill: LZ.refill,
      })
      : null;
    /* ── THE GROUND'S LONG MEMORY ─────────────────────────────────────
     *
     * `NEXT.md`'s Step 0 verdict, in one sentence: the crater log replays a
     * fought battlefield to `max |Δh| = 0` and you cannot see it. 520 of 539
     * marks are a bolt hitting sand, this grid's cell is 2.5-3.4 m, and
     * `crater` widens anything under 1.35 cells and shallows it to conserve
     * volume — so a bolt scuff lands as 3.35 m across and 1.6 mm deep. Twenty
     * sorties of it reads as dunes. The verdict names the fix and this field is
     * it: **persist what is DRAWN, not only what is dented.**
     *
     * It is `SurfaceField` again — the same two channels, the same encoding,
     * the same one texture2D in the shader — with three of its rules inverted,
     * and each inversion is the difference between a window and a map:
     *
     *   IT IS THE WHOLE MAP, not a 29 m window that follows the player. Its
     *     period is exactly `size`, so world space tiles onto it once and the
     *     toroidal addressing that makes the window cheap makes this exact.
     *   IT NEVER AGES. The window fills in over 240 s because that is what
     *     blown sand does to a footprint. A burnt-out hull's stain is still
     *     there next sortie, which is `FLAGSHIP.md` §11's "persistence beats
     *     intensity" and the whole of what the mode's front is standing on.
     *   ITS BURNS STACK. One bolt scuff is nothing; the same square metre hit
     *     forty times is black. `stack` is what makes the field a record of
     *     how hard a place was fought over rather than of the hottest single
     *     thing that ever touched it.
     *
     * THE CELL IS 1.6 m AT EVERY TIER, and — unlike the window, whose tier
     * moves how much ground it remembers — this one cannot move at all. What
     * the ground remembers is not allowed to be a settings slider, for exactly
     * the reason `CraterLog` refuses to snapshot the heightfield: the grid is a
     * quality setting, and a player who changed one between sittings would come
     * back to somebody else's battlefield. 384² over 620 m is 590 kB of texture
     * and 1.2 MB of float mirror; it is the largest single thing on the ground
     * and it is the only thing in the frame that says a war happened here.
     */
    this.scars = LZ
      ? new SurfaceField({
        res: clamp(Math.round(this.size / SCAR_CELL), 96, 384),
        size: this.size, depth: LZ.depth * 1.6, whole: true, ages: false,
        stack: SCAR_STACK,
      })
      : null;
    /**
     * HOW HARD THIS GROUND IS BEING HIT, as a multiplier on every crater.
     *
     * A Force push landed the same 2.6 m × 0.22 m hole on the first wave of a
     * run and on the last, whatever the player had picked up on the way — so
     * the ground was the one part of the frame that never learned the player
     * had got stronger. Published here rather than passed, because the call
     * sites that make craters are in Player.js and World.js and they have no
     * business knowing about the run. See `setMight`.
     */
    this.might = 1;

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
    // The rock set is deliberately shared by every landform that has any rock
    // in it: a snowfield's outcrop and a canyon wall are the same stone, and
    // the preset's two rock colours are what make them different rocks.
    switch (this.preset.maps) {
      case 'sand': return [sandMaps(1), rockMaps(2)];
      case 'deck': return [duracreteMaps(2), metalMaps(2)];
      case 'soil': return [soilMaps(1), rockMaps(2)];
      case 'snow': return [snowMaps(1), rockMaps(2)];
      /**
       * ROCK ALL THE WAY DOWN — Mustafar, and it was falling through to SAND.
       *
       * `maps: 'rock'` was authored for the basalt shelf and no case ever
       * matched it, so the `default` handed a lava plain the dune sea's sand
       * carrier as its base map. The declaration and the switch were a
       * hand-maintained pair that had quietly come apart (HANDOFF §2.3) — and
       * because the fallthrough produced a perfectly valid material, nothing
       * looked broken; it just looked like the wrong planet up close.
       *
       * Both maps are rock because that is what the landform is: the base is
       * the flow top and the second is the same stone at the other variant, so
       * the preset's two rock colours are still what separate them.
       */
      case 'rock': return [rockMaps(1), rockMaps(2)];
      /* AND THERE IS NO `default: sand` ANY MORE.
       *
       * That fallthrough is the whole reason the paragraph above exists: an
       * unknown key produced a perfectly valid material, so nothing threw,
       * nothing logged, and the level simply looked like the wrong planet for
       * as long as it took a person to notice. `sand` is a case like any other
       * now, and a key nobody wrote a case for is loud at the moment the
       * ground is built rather than silent forever. */
      default: throw new Error(`terrain: preset ground map '${this.preset.maps}' has no case in `
        + '_mapSet — add one rather than letting it render on sand');
    }
  }

  /**
   * What the far field collapses onto — the mean tone of the two maps this
   * preset actually binds, in the same `dot(rgb, 1/3)` the shader takes.
   *
   * Read out of MEAN_ALBEDO rather than measured off the canvas: those are the
   * calibrated figures the whole material palette is built on (the terrain
   * carriers are pinned to 0.389 precisely so `0.55 + mean·1.15` lands on 1.0),
   * and taking them from the same place is what makes "the distance is the
   * level's authored colour" an identity rather than a near miss.
   */
  _mapMeans() {
    /* ASKED OF THE MAPS `_mapSet` ACTUALLY BOUND, which is the whole point.
     *
     * This used to be a second table — `{ deck: ['duracrete','metal'], soil:
     * […] }` — sitting beside that switch, and its own comment called itself
     * "the generated twin of that switch". It was: `maps: 'rock'` reached this
     * table and not the switch, so for one release the far field of Mustafar
     * collapsed onto basalt's mean while the near field rendered on sand.
     * A set that binds two maps and a mean that names two materials have to
     * agree, and the only way to guarantee that is to stop asking twice.
     *
     * Every texture carries the name of the bake it came from — see
     * `toTexture` in Textures.js, where it was put precisely so a consumer
     * could identify its own subject — so the mean is a lookup on what is
     * bound, and a map with no calibrated mean is an error rather than a
     * plausible number. */
    const mean = (set) => {
      const n = set.map.userData.saberBake;
      const v = MEAN_ALBEDO[n];
      if (!v) throw new Error(`terrain: the '${n}' map has no MEAN_ALBEDO — the far field `
        + 'would collapse onto a colour the near field never had');
      return (v[0] + v[1] + v[2]) / 3;
    };
    const [base, upper] = this._mapSet();
    return new THREE.Vector2(mean(base), mean(upper));
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
    const LOOSE = P.loose || {};
    const surf = this.surface;
    const scar = this.scars;

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
      uSward: { value: new THREE.Vector4(0, 0.26, 0, 0) },
      uSwardA: { value: new THREE.Color(0x5c6b30) },
      uSwardB: { value: new THREE.Color(0x38431f) },
      /* The surface memory. `uSurf.z` is 1/window, NOT 1/heightfield: the
       * window wraps, so the uv is `fract(world / window)` and the repeat
       * wrap does the fract for free. `.w` is the half-window the mask fades
       * out over, and the mask is not decoration — without it the wrap prints
       * a set of tracks on ground 48 m away that nobody has been near. */
      uSurf: { value: new THREE.Vector4(0, 0, 1 / (surf ? surf.size : 1), (surf ? surf.size : 1) * 0.5) },
      uSurfSet: { value: new THREE.Vector4(surf ? 1 : 0, LOOSE.tilt ?? 1,
        LOOSE.tint ?? 0.45, LOOSE.soot ?? 1) },
      uSurfMap: { value: surf ? surf.texture : (this._surfDefault = flatSurface()) },
      /* THE LONG MEMORY. `uScar.x` is 1/period and the period is the MAP, so
       * unlike `uSurf` there is no centre to track and no half-window to fade
       * over — the two numbers the window needs for that are the two this one
       * does not have. The gains are the window's own, moved down: a scar is
       * the ghost of a mark, not the mark. */
      uScar: { value: new THREE.Vector2(scar ? 1 / scar.size : 1, 0) },
      uScarSet: { value: new THREE.Vector4(scar ? 1 : 0, (LOOSE.tilt ?? 1) * 0.55,
        (LOOSE.tint ?? 0.45) * 0.85, (LOOSE.soot ?? 1) * 1.35) },
      uScarMap: { value: scar ? scar.texture
        : (this._surfDefault = this._surfDefault || flatSurface()) },
      uSurfCol: { value: C(P.packedColor ?? P.lagColor ?? P.sandColor) },
      /* NOT the saber's colour. Ground at two thousand kelvin is a blackbody,
       * and a blackbody does not come out blue however blue the thing that
       * heated it was — a cut in sand glows the same orange whether a blue
       * blade or a red one made it. Authored as a LINEAR multiplier, so it
       * goes through setRGB rather than through the sRGB→linear conversion
       * `new THREE.Color(hex)` performs. */
      uSurfGlowCol: { value: new THREE.Color().setRGB(3.4, 1.05, 0.24, THREE.LinearSRGBColorSpace) },
      // What a distant slope's tone falls back to once its texture is under a
      // pixel — see terFlat and _mapMeans.
      uFarMean: { value: this._mapMeans() },
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
        .replace('#include <emissivemap_fragment>', TERRAIN_FRAG_EMISSIVE)
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
   * @param {object} [sward]  the MAT: `{ amount, relief, a, b }`. The litter
   *                        above is what is UNDER the cover; this is the top of
   *                        the cover itself, seen from above between the
   *                        blades, and it is what a level asked to be entirely
   *                        grass needs the ground to be. Both colours are
   *                        derived from the level's own tints by the caller and
   *                        DARKENED — this is the mat down among the blades,
   *                        shaded by everything standing over it, so a stop
   *                        painted at the blade's own value reads as fog.
   */
  setGroundCover(amount, colour, metres = 30, map, sward) {
    const u = this._uniforms;
    if (!u) return this;
    u.uCover.value.set(clamp(amount, 0, 1), 1 / this.size, 0);
    if (map !== undefined) u.uCoverMap.value = map || this._coverDefault;
    if (colour !== undefined && colour !== null) u.uCoverCol.value.set(colour);
    if (sward) {
      u.uSward.value.set(clamp(sward.amount ?? 0, 0, 1), sward.comb ?? 0.26,
        clamp(sward.relief ?? 0, 0, 2), 0);
      if (sward.a) u.uSwardA.value.set(sward.a);
      if (sward.b) u.uSwardB.value.set(sward.b);
    } else if (amount <= 0) {
      u.uSward.value.set(0, 0.26, 0, 0);
    }
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

  /**
   * `outPoint` AND `outNormal` ARE OPTIONAL, and that is a fix rather than a
   * convenience.
   *
   * Half the callers of a terrain raycast do not want the hit — they want to
   * know whether there IS one. The caller that found this asked exactly that,
   * one line under the identical question asked of `physics.raycast`, which
   * takes a predicate and returns a body: "is the ground between my muzzle and
   * that man". It called this with three arguments, and the moment the answer
   * was YES this threw `Cannot read properties of undefined (reading 'set')`
   * and took the frame down with it. Found by a probe driving a whole sitting;
   * it was a live crash in the shipped game, on the one path that only ran when
   * the shooter's target walked behind a rise.
   *
   * Guarding at the call site would have fixed one caller and left the trap
   * armed for the next; making the out parameters optional here answers "did it
   * hit, and how far" for everybody, which is what the return value has always
   * been. `Enemy.js`'s caller passes both and is unchanged.
   */
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
        if (outPoint) {
          outPoint.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
          /* Only with a point to read it at: `normalAt` is asked for the
           * normal AT the hit, and there is no hit to stand on without one. */
          if (outNormal) this.normalAt(outPoint.x, outPoint.z, outNormal);
        }
        return hi;
      }
      lastAbove = above; lastT = t;
    }
    return null;
  }

  /* ── deformation ───────────────────────────────────────────────────── */

  /**
   * HOW MUCH LOOSE MATERIAL IS LYING HERE, in metres.
   *
   * Snow is not a coat of paint: it lies deep in the lee hollows the wind
   * dropped it into and is stripped to nothing on the crests the wind came
   * over. The two landform channels that say which is which are already baked
   * — concavity at 8 m and wind exposure — so this costs one lookup and no new
   * state, and it is the number that makes a print in a drift a different
   * thing from a print on a scoured rib.
   *
   * Presets with no `mantle` have a uniform layer as deep as one footfall goes,
   * which is the honest statement for sand: a dune is loose all the way down.
   */
  mantleAt(x, z) {
    const M = this.preset.mantle;
    const loose = this.preset.loose;
    if (!loose) return 0;
    if (!M) return loose.depth;
    const i = clamp(Math.round((x + this.half) * this.invStep), 0, this.res - 1);
    const j = clamp(Math.round((z + this.half) * this.invStep), 0, this.res - 1);
    const k = (j * this.res + i) * 4;
    const conc = this.landform[k] / 255 * 2 - 1;        // + hollow, − crest
    const expo = this.landform[k + 3] / 255 * 2 - 1;    // + windward, − lee
    // Steep ground sheds it: snow does not lie on a 46° face, it sloughs.
    const shed = 1 - smoothstep(0.10, 0.34, this.slopeAt(x, z));
    const fill = clamp(0.5 + conc * 0.62 - expo * 0.44, 0, 1) * shed;
    return lerp(M[0], M[1], fill);
  }

  /**
   * What the run has made of the player, as a multiplier on every crater.
   *
   * One number, set once when the level is dressed, because that is when the
   * run's tier and boons are known and the ground is built. Clamped rather
   * than trusted: `forcePower` is a settings slider that goes to 4, and a
   * 4× crater on top of a 4× radius is a hole you fall into.
   */
  setMight(k) { this.might = clamp(k, 0.35, 3.2); return this.might; }

  /**
   * A footfall, a skid, a body landing: press the LOOSE LAYER, not the mesh.
   *
   * The depth asked for is capped by how much material is actually lying here
   * — you cannot press a 30 cm print into 10 cm of snow — which is what turns
   * one number in the preset into a level where the drifts hold a deep track
   * and the scoured ribs hold a scuff.
   *
   * @returns {number} cells written; 0 if the point is outside the window
   */
  tread(x, z, radius, depth, dirX = 0, dirZ = 0, opts = {}) {
    if (!this.surface) return 0;
    const cap = this.mantleAt(x, z) * 0.62;
    return this.surface.tread(x, z, radius, Math.min(depth, cap), dirX, dirZ, opts);
  }

  /**
   * Heat on the ground: slag, a bolt that missed, a blade laid against it.
   *
   * TWO FIELDS, ONE CALL, and the second one is why a battlefield now shows.
   * The window draws the mark as the player sees it happen — molten for a
   * couple of seconds, then soot for half a minute, at 25 cm. The scar field
   * keeps a fraction of it for the rest of the session at 1.6 m. Every site
   * that already burns this ground gets the permanent half for free, which is
   * the same argument `CraterLog` makes for wrapping one method instead of
   * threading a recorder through five call sites: the caller that has not been
   * written yet is covered by construction.
   */
  burn(x, z, radius, heat = 1) {
    const n = this.surface ? this.surface.burn(x, z, radius, heat) : 0;
    /* WIDER THAN THE MARK, and that is not a fudge. A bolt fuses a 26 cm patch
     * and scorches a ring around it that has no edge; at 1.6 m cells the fused
     * core is a fifth of one texel, so laying it at its true radius records a
     * fifth of the heat over the wrong shape. The scorch is what a battlefield
     * is made of, so the scorch is what is stored. */
    this.scorch(x, z, radius * 1.6, heat);
    return n;
  }

  /**
   * A MARK THAT DOES NOT GO AWAY. Soot only — no depth, no glow, no decay.
   *
   * This is the public verb for "this ground was burnt", and it is deliberately
   * separate from `burn`: `burn` is an EVENT with a temperature that cools, and
   * this is a RECORD. A caller that wants the ground to remember something and
   * has no fire to show — the front's own burnt swath, a wreck's stain, the
   * ash under a column — asks for this one, and `CraterLog` wraps it for the
   * same reason it wraps `crater`.
   *
   * @returns {number} cells written
   */
  scorch(x, z, radius, amount = 1) {
    if (!this.scars || amount <= 0) return 0;
    return this.scars.burn(x, z, radius, amount);
  }

  /**
   * A lit blade dragged through the ground from `a` to `b`.
   *
   * Two things at once, and it needs to be both: a TRENCH, so the ground
   * either side of the line catches the light differently and the cut has a
   * shape, and HEAT, which the material reads as glow for the first few
   * seconds and then as soot for half a minute. A scorch decal alone is a
   * sticker; a trench alone is a scratch.
   */
  scar(a, b, opts = {}) {
    if (!this.surface) return 0;
    const w = opts.radius ?? 0.11;
    const d = Math.min(opts.depth ?? 0.09, this.mantleAt(a.x, a.z) * 0.55);
    return this.surface.gouge(a, b, w, d, opts.heat ?? 1);
  }

  /**
   * The per-frame tick the surface memory needs: move its window to the
   * player and age what it holds. Driven from `ground.frame` — see the note
   * on the broker in Scenery.js for why the tick lives there.
   *
   * NOT `step`: `this.step` is the grid spacing in metres, an instance field
   * set in the constructor, and a method of that name is shadowed by it on
   * every Terrain ever built. It fails as `step is not a function`, which
   * reads like a missing import rather than a name collision.
   */
  tick(dt, focus) {
    const S = this.surface;
    if (!S) return;
    if (focus) S.follow(focus.x, focus.z);
    S.update(dt);
    /* THE SCAR FIELD IS PUSHED ON THE SAME TICK AND NEVER PER FRAME, and the
     * reason is the one difference between the two that costs anything: this
     * one's dirty box is a bounding box over a whole BATTLE rather than over a
     * window, so a bolt at each end of the field dirties the map between them.
     * Encoding that per frame would be the most expensive thing on the ground;
     * at 10 Hz, and only when something was actually written, it is not on the
     * list. `_scarAccum` is separate from the window's own accumulator because
     * the window ages on its tick and this one only uploads. */
    const K = this.scars;
    if (K) {
      this._scarAccum = (this._scarAccum || 0) + dt;
      if (this._scarAccum >= SCAR_TICK) { this._scarAccum = 0; K.flush(); }
    }
    const u = this._uniforms.uSurf.value;
    u.x = S.center.x; u.y = S.center.y; u.z = 1 / S.size; u.w = S.size * 0.5;
  }

  /**
   * Push the surface down (or up with a negative depth) — craters from Force
   * landings, gouges from a body hitting the dune at speed.
   *
   * SCALED BY `might`, which is what makes the ground know how far into a run
   * it is. The radius takes the cube root of it and the depth the whole of it,
   * because the two are not independent: a blast that moves k times the
   * material at the same shape is k^(1/3) wider and k deeper, and scaling both
   * linearly at might 3 would be a 8 m crater, which is a level-geometry
   * change rather than a hit.
   */
  crater(x, z, radius, depth, rim = 0.22) {
    const might = this.might ?? 1;
    /* The loose layer takes the hit whatever the mesh does, so a Force push on
     * the hangar deck still scuffs it and a small one on a dune leaves a
     * print-scale mark rather than being widened to 2.2 m and vanishing. This
     * runs BEFORE the flat/grid early-outs on purpose. */
    if (this.surface) {
      this.surface.tread(x, z, radius * 0.85, Math.min(depth * might * 1.6, this.mantleAt(x, z) * 0.85),
        0, 0, { rim: 0.5 });
    }
    /* AND THE LONG MEMORY, WHICH IS WHY A REPLAYED LOG NOW DRAWS SOMETHING.
     *
     * The heightfield cannot hold this mark — §14 Step 0 measured a bolt
     * crater at 3.35 m across and 1.6 mm deep after `crater` widened it to
     * what the grid can represent — but the ground it turned over and the soot
     * it left are albedo, and albedo has no minimum feature size. Both go in
     * here, ahead of the `flat` early-out and ahead of the widening, so a
     * crater on a hangar deck still marks it and a crater smaller than a grid
     * cell is recorded at the size it actually was. */
    if (this.scars) {
      this.scars.tread(x, z, radius * 1.15, Math.min(depth * might * 1.9, this.scars.maxDepth * 0.8),
        0, 0, { rim: 0.45 });
      /* SCALED BY THE HOLE. A bolt scuff and a shell both burn, and they do not
       * burn the same: `SCAR_BLAST` is priced against the bolt crater
       * (0.55 m) because that is 96% of the marks a battle makes, and a 2.6 m
       * shell is three times the soot per square metre on top of covering nine
       * times the area. Without the ratio a shell and a scuff record the same
       * 0.165 and the field cannot tell shelling from small-arms fire, which is
       * the one distinction §14 Step 0 says the ground has to be able to draw. */
      this.scars.burn(x, z, radius * 1.5, SCAR_BLAST * clamp(radius / 0.55, 0.5, 3));
    }
    if (this.preset.flat) return;
    radius *= Math.cbrt(might);
    depth *= might;
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
        /**
         * THE BOUND IS ON THE ACCUMULATED DEFORMATION, AND IT HAS TO REACH
         * `heights`, WHICH IS THE GRID EVERY READER USES.
         *
         * `deform` was written on these two lines and read nowhere in src/ or
         * tools/, so the −4.5 m floor bounded an array nothing consulted while
         * `heights` — what `height()`, `slopeAt()`, the mesh and the physics
         * heightfield all answer from — took the raw delta and accumulated
         * without limit. Measured on scoria at might 1, the same 2.2 m × 0.55 m
         * crater repeated at the origin:
         *
         *     10× deform −2.80  h(0,0) 20.17→17.37   rim slope 0.18
         *     30× deform −4.50  h(0,0)       11.77   rim slope 0.67
         *     60× deform −4.50  h(0,0)        3.38   rim slope 0.84
         *    400× deform −4.50  h(0,0)      −91.74   rim slope 0.98
         *
         * — the clamp pinned after sixteen and the ground kept sinking. This is
         * reachable from `Player._land`, which craters at the player's own feet
         * on ANY landing over 15 m/s with no height gate, so about thirty hard
         * landings on one spot leave the player at the bottom of a nine-metre
         * hole whose walls are past the anti-climb threshold (slope 0.52)
         * against a STEP_UP of 0.45: a soft lock, not a fall-through, since the
         * heightfield follows the grid correctly the whole way down.
         *
         * Taking the applied delta from the CLAMPED difference makes the two
         * arrays agree by construction: `deform` is the bound and `heights` is
         * the bound applied. Levels.js's "nothing here can produce a hole you
         * fall into whatever the settings say" is true per crater and was false
         * for the sum; the sum is what this is for. Same shape as
         * `Surface.tread`, one file away.
         */
        const was = this.deform[k];
        const now = clamp(was + delta, -MAX_DEFORM_DOWN, MAX_DEFORM_UP);
        this.deform[k] = now;
        this.heights[k] += now - was;
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
    /* BEFORE THE EARLY-OUT, because the two dirty flags are independent and
     * one of them is reachable when the other is not: a crater on a `flat`
     * preset returns before `_markDirty` and a `scorch` never touches the
     * heightfield at all, so a flush gated on the geometry's dirty region
     * would leave a replayed battlefield's soot sitting in a Float32Array that
     * nothing ever uploads. `CraterLog.replay` calls this once at the end, and
     * this is the line that makes the replay VISIBLE rather than merely true. */
    this.scars?.flush();
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

  /**
   * A FACE TOO STEEP TO WALK UP IS A WALL, and this is the only thing in the
   * game that says so.
   *
   * WHAT WAS WRONG. Every level in the game was open at the top. The whole of
   * the anti-climb term was Player's downhill nudge — `(slope - 0.52) * 26`,
   * which tops out at 12.5 m/s² against a vertical face — while the walk pulls
   * `damp(v, 4.6 m/s, 19.3)`, i.e. 89 m/s² from rest. Steady state on a 90°
   * wall is still 4.6 − 12.5/19.3 = 3.9 m/s UPHILL, so the slide could never
   * stop anybody. Measured, holding W for 25 s from the origin on eight
   * bearings with nothing else pressed: on the intake — a room whose roof is at
   * y = 16.5 — four bearings ended standing at y = 31 to 46 m, out over that
   * roof at r = 99 to 108 m, having walked terrain of measured slope 0.727
   * (74°); the deeps reached y = 44.8 at r = 114; the colosseum y = 45.1; the
   * alpine y = 55.7 at r = 288. The square position clamp at `terrain.half - 6`
   * is 154 m away and never came into it.
   *
   * WHAT THIS DOES. It resolves a body that has walked INTO a steep face the
   * same way the collision code resolves a body that has walked into a box:
   * push it back out along the horizontal gradient and kill the velocity going
   * into the face. It is not a slowdown and not a friction term — nothing is
   * negotiable about it, which is what "boundary" has to mean.
   *
   * THE THREE-METRE PROBE is what keeps this from breaking ordinary walking.
   * Point slope alone is far too eager: a heightfield is full of half-metre
   * lips, boulders' skirts, strata edges and channel banks that are locally
   * over 61° and that the player has always been able to step over, and
   * blocking those would be a worse defect than the one being fixed. So the
   * face must SUSTAIN its steepness: the ground is only a wall if it is still
   * climbing at more than the walk limit 3 m further up the gradient. A 0.4 m
   * lip averages 0.13 over that span and passes; the intake shell averages 3.5
   * and does not.
   *
   * The units: everywhere else in this codebase "slope" means `1 - n.y`, and
   * the walk limit is the 0.52 Player's slide already used. As a gradient
   * (rise over run) that is √(1/(1-0.52)² - 1) = 1.83.
   *
   * `maxPen` is the other guard. Only a body that has just walked into the face
   * this frame is pushed out — at a walk that is 0.08 m of ground per frame, at
   * a 30 m/s fall 0.5 m. Anything deeper than 1.2 m inside the ground is
   * something else entirely (a deck built into a hillside, a spawn dropped in
   * the wrong place) and teleporting it sideways would be the bug.
   *
   * Returns true if the move was refused.
   */
  blockClimb(pos, vel = null, feetY = pos.y, maxPen = 1.2) {
    const gh = this.height(pos.x, pos.z);
    const pen = gh - feetY;
    if (pen <= 0.02 || pen > maxPen) return false;
    const e = this.step;
    const gx = (this.height(pos.x + e, pos.z) - this.height(pos.x - e, pos.z)) / (2 * e);
    const gz = (this.height(pos.x, pos.z + e) - this.height(pos.x, pos.z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    if (g < CLIMB_GRADIENT) return false;
    const ux = gx / g, uz = gz / g;                       // uphill, in plan
    const ahead = this.height(pos.x + ux * CLIMB_PROBE, pos.z + uz * CLIMB_PROBE);
    if ((ahead - gh) / CLIMB_PROBE < CLIMB_GRADIENT) return false;   // a step, not a wall
    const back = Math.min(pen / g, 0.6);
    pos.x -= ux * back;
    pos.z -= uz * back;
    if (vel) {
      const into = vel.x * ux + vel.z * uz;
      if (into > 0) { vel.x -= into * ux; vel.z -= into * uz; }
    }
    return true;
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
    this._surfDefault?.dispose();
    this.surface?.dispose();
    this.surface = null;
    this.scars?.dispose();
    this.scars = null;
    this.mesh.parent?.remove(this.mesh);
  }
}

/** Undisturbed ground, as one texel: no depth, no gradient, no scorch. */
function flatSurface() {
  const t = new THREE.DataTexture(new Uint8Array([0, 128, 128, 0]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
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
