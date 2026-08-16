/**
 * The air in front of the ground, and the lattice underneath it.
 *
 * Both faults pinned here rendered without an error and read as a plausible
 * frame, which is exactly why they survived:
 *
 *   · the terrain replaced three's <fog_fragment> with its own model and threw
 *     away the height-stratified extinction the engine gives every OTHER
 *     material, then multiplied the density by 1.8 again with range. Measured
 *     on the arena rim — 184 m out, 40 m up, fogDensity 0.0034 — that was
 *     fogFactor 0.427 against the engine's 0.127 for the same point: the ground
 *     was three and a third times more fogged than the colonnade standing in
 *     front of it, and the amphitheatre wall came out at 0.774 display
 *     luminance / 0.154 saturation against the sand's 0.631 / 0.446. Chalk.
 *   · the tone it converged to was scene.fog, which the engine meters off the
 *     sky and renormalises to linear luminance 3.19 — while the sky RENDERS at
 *     0.67. A surface behind a scattering medium cannot come out brighter than
 *     the medium, and that one was: 0.80 wall against 0.69 sky.
 *   · the ripple map was sampled on one fixed lattice at one bearing, which
 *     measured 1.74° of bearing variation across 16 m of floor. Real corduroy
 *     does not do that.
 *
 * These are source-shape checks, because what went wrong is which terms the
 * chunk contains and what the uniforms are anchored to — neither of which any
 * runtime value on the Terrain exposes.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain, TERRAIN_PRESETS, writeSkyStrip, SKY_STRIP } from '../../src/world/Terrain.js';
import { ground } from '../../src/world/Scenery.js';
import {
  skyRadiance, skyShoulder, skyDisplayShoulder, sunDirection, hazeRadiance,
} from '../../src/engine/Engine.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';

const SRC = () => readFileSync(new URL('../../src/world/Terrain.js', import.meta.url), 'utf8');
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
/** Saturation of a LINEAR radiance triple. The frame's tone curve is monotone
 *  per channel, so an ordering that holds here holds on the screen; measuring
 *  in linear keeps this check off a second copy of the grade. */
const sat3 = (r, g, b) => { const mx = Math.max(r, g, b); return mx <= 1e-9 ? 0 : (mx - Math.min(r, g, b)) / mx; };
const hue3 = (r, g, b) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 1e-9) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
const hueGap = (a, b) => Math.abs(((b - a + 540) % 360) - 180);

/** The band SkyDome bakes, built here from the engine's own exported sky so a
 *  check does not need a GL context to have a sky to stand under. Mirrors
 *  SkyDome.skyBandTexture's grid exactly — same 64 × 16, same BAND_TOP, same
 *  texel centres — because the strip resamples it by index. */
function bakeBand(a, AZ = 64, EL = 16, TOP = 0.72) {
  const sun = sunDirection(a, new THREE.Vector3());
  const disp = skyDisplayShoulder(a);
  const rgb = new Float32Array(AZ * EL * 3), dir = new THREE.Vector3(), col = new THREE.Color();
  for (let j = 0; j < EL; j++) {
    const s = ((j + 0.5) / EL) * TOP, c = Math.sqrt(Math.max(0, 1 - s * s));
    for (let i = 0; i < AZ; i++) {
      const b = -Math.PI + ((i + 0.5) / AZ) * Math.PI * 2;
      skyShoulder(skyRadiance(dir.set(Math.cos(b) * c, s, Math.sin(b) * c), sun, a, col), disp.knee, disp.ceil);
      const q = (j * AZ + i) * 3;
      rgb[q] = col.r; rgb[q + 1] = col.g; rgb[q + 2] = col.b;
    }
  }
  return { az: AZ, el: EL, top: TOP, rgb };
}

/**
 * TERRAIN_FRAG_FOG, for one ground sample, in JS.
 *
 * A transcription — and the source-shape assertions above are what stop it
 * drifting from the chunk it stands for. It is here rather than in the shader
 * because the claim being tested ("a hundred and seventy metres of air must
 * take the chroma out of the sand") is a claim about a curve over distance, and
 * a curve cannot be read off a GPU this build never boots.
 */
function groundThroughAir(d, opt) {
  const ray = [0, -opt.eyeY, -d];
  const radial = Math.hypot(ray[0], ray[1], ray[2]);
  const ss = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
  const y0 = Math.min(Math.max(opt.eyeY, -40), 600), k = ray[1] * opt.invH;
  const t0 = Math.exp(-y0 * opt.invH);
  const m = Math.abs(k) < 1e-3 ? t0 : t0 * (1 - Math.exp(-k)) / k;
  const path = radial * Math.min(Math.max(m, 0), 6);
  const hazeD = opt.density * (1 + 0.30 * ss(160, 460, radial));
  const factor = 1 - Math.exp(-hazeD * hazeD * path * path);
  const tone = opt.fog.slice();
  if (opt.sunW > 0) {
    const dir = ray.map((v) => v / Math.max(radial, 1e-4));
    const cos = dir[0] * opt.sun[0] + dir[1] * opt.sun[1] + dir[2] * opt.sun[2];
    const g = 0.5, g2 = g * g;
    const phase = (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * cos, 1e-4), 1.5);
    for (let i = 0; i < 3; i++) {
      const glow = opt.tint[i] * opt.sunW * (phase + 0.75 * (1 + cos * cos) * 0.16);
      const cap = Math.max(opt.fog[i], 1e-4) * 0.26;
      tone[i] += cap * (1 - Math.exp(-glow / cap));      // the engine's energy limit
    }
  }
  const w = ss(50, 230, radial);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = opt.sand[i] + ((tone[i] + (opt.sky[i] - tone[i]) * w) - opt.sand[i]) * factor;
  return out;
}

export function run({ check, assert, near }) {

  check('terrain: the ground is in the same air as everything standing on it', () => {
    const src = SRC();
    const fog = src.slice(src.indexOf('const TERRAIN_FRAG_FOG'));
    // the engine's stratified path integral, term for term
    assert(/uAerialShape\.x > 0\.0/.test(fog) && /vFogRay\.y \* uAerialShape\.x/.test(fog),
      'the terrain integrates fog along raw view depth — a rim 68 m up gets valley-floor haze');
    assert(/exp\(\s*-\s*y0 \* uAerialShape\.x\s*\)/.test(fog),
      'the haze layer has no scale height, so distance is a flat veil');
    assert(/fogRadial \* clamp\(m, 0\.0, 6\.0\) \* uAerialShape\.w/.test(fog),
      'the stratified path length is computed and then not used');
    // and the lit forward-scatter lobe, or the ground is the one thing in the
    // frame whose haze does not know where the sun is
    assert(/uAerialSun\.w > 0\.0/.test(fog) && /uAerialTint\.xyz \* uAerialSun\.w/.test(fog),
      'the ground gets no inscatter while every other material does');
    // the terrain's own extra density must stay a nudge
    const gain = src.match(/u\.uHaze\.value\.set\(indoor \? 0 : ([\d.]+)/);
    assert(gain, 'the extra-density knob is gone');
    assert(Number(gain[1]) <= 0.4,
      `the ground adds ${gain[1]} of extra optical depth on top of a correct integral`);
    return `stratified + inscatter, extra density +${gain[1]} past 160 m`;
  });

  check('terrain: the far ground converges on the sky, never past it', () => {
    // scene.fog is metered off the sky AND renormalised, and lands well above
    // it. Anchoring the convergence target to the fog swatch is what let the
    // rim render brighter than the sky directly above it.
    const src = SRC();
    assert(/const SKY_GAIN = [\d.]+/.test(src) && /const SKY_BLEND = [\d.]+/.test(src),
      'the haze target is no longer a named, swept pair of numbers');
    const gain = Number(src.match(/const SKY_GAIN = ([\d.]+)/)[1]);
    assert(gain <= 1.1, `the sky target is scaled ${gain}× — that is the fog swatch again`);
    // it has to be built from the level's own sky, not from the fog
    const sync = src.slice(src.indexOf('_syncAtmosphere()'), src.indexOf('setGroundCover'));
    assert(/this\._hemi\.color\).multiplyScalar\(SKY_GAIN\)/.test(sync),
      'the convergence target no longer takes its LEVEL from the sky');
    assert(/_tc\.copy\(fog\.color\)\.multiplyScalar\(L\(s\)/.test(sync),
      'the fog hue is folded in without being level-matched first, so it can move the exposure');

    // and prove the anchoring on a real Terrain: the target must sit far below
    // the fog swatch it used to be pinned to
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xffffff, 0.0034);
    scene.fog.color.setRGB(3.042, 3.2302, 3.2018);      // the arena's, measured
    const hemi = new THREE.HemisphereLight(0xc0d4ee, 0x7a6244, 0.135);
    scene.add(hemi);
    const t = new Terrain(scene, 'arena', 0.5);
    const sky = lum(t._uniforms.uSkyCol.value), haze = lum(scene.fog.color);
    assert(sky < haze * 0.55,
      `the ground converges on ${sky.toFixed(2)} against a haze of ${haze.toFixed(2)} — that is the swatch`);
    assert(sky > haze * 0.10, `the ground converges on ${sky.toFixed(2)} — a dark band under a bright sky`);
    t.dispose();
    return `target ${sky.toFixed(2)} vs haze ${haze.toFixed(2)}, gain ${gain}`;
  });

  check('terrain: the air over the ground is the DRAWN sky, in the view direction', () => {
    const src = SRC();
    const fog = src.slice(src.indexOf('const TERRAIN_FRAG_FOG'), src.indexOf('export class Terrain'));
    // one colour for the whole dome was the fault: the far field has to look up
    // the bearing it is actually looking down
    assert(/atan\(vFogRay\.z, vFogRay\.x\)/.test(fog) && /texture2D\(uSkyStrip/.test(fog),
      'the far ground converges on ONE colour again — the same air whichever way you face');
    assert(/mix\(fogTone, fogSky, smoothstep\(50\.0, 230\.0, fogRadial\) \* uHaze\.y\)/.test(fog),
      'the walk from the near haze onto the sky is gone');
    // and the inscatter must carry the engine's energy limit, or the ground is
    // the one surface free to glow past the air standing in front of it
    assert(/vec3 fogCap = max\(fogColor, vec3\(1\.0e-4\)\) \* 0\.26/.test(fog)
      && /fogTone \+= fogCap \* \(1\.0 - exp\(-fogGlow \/ fogCap\)\)/.test(fog),
      'the terrain adds raw phase-function inscatter while every other material has it capped');

    // the strip has to BE ground.skyBand, not a second derivation of it
    const a = LEVELS.colosseum.atmosphere;
    const band = bakeBand(a);
    const tex = writeSkyStrip(new THREE.DataTexture(new Uint16Array(SKY_STRIP * 4), SKY_STRIP, 1,
      THREE.RGBAFormat, THREE.HalfFloatType), band);
    const F = THREE.DataUtils.fromHalfFloat, d = tex.image.data;
    const texel = (i) => [F(d[i * 4]), F(d[i * 4 + 1]), F(d[i * 4 + 2])];
    for (let i = 0; i < SKY_STRIP; i++) {
      const j = Math.min(band.az - 1, Math.floor((i + 0.5) / SKY_STRIP * band.az)) * 3;
      const got = texel(i);
      for (let c = 0; c < 3; c++) {
        assert(Math.abs(got[c] - band.rgb[j + c]) < 2e-3,
          `strip texel ${i} channel ${c} is ${got[c].toFixed(4)} against the band's ${band.rgb[j + c].toFixed(4)}`);
      }
    }
    // and it has to actually be directional — a strip that is flat round the
    // compass is the old bug with more texels
    let lo = 9, hi = 0, loI = 0, hiI = 0;
    for (let i = 0; i < SKY_STRIP; i++) {
      const L = lum({ r: texel(i)[0], g: texel(i)[1], b: texel(i)[2] });
      if (L < lo) { lo = L; loI = i; } if (L > hi) { hi = L; hiI = i; }
    }
    assert(hi / lo > 1.15,
      `the sky the ground dissolves into spans only ${(hi / lo).toFixed(3)}:1 round the compass`);
    // the dim end must be BLUER than the bright end: that is the sun side vs
    // the shade side, and getting it backwards would mean the strip is upside
    // down in bearing
    const bR = texel(loI)[2] / texel(loI)[0], sR = texel(hiI)[2] / texel(hiI)[0];
    assert(bR > sR, `the darkest bearing (${loI}) is warmer than the brightest (${hiI}) — the strip is reversed`);
    tex.dispose();
    return `strip ${SKY_STRIP} bearings, ${(hi / lo).toFixed(2)}:1 across the compass, B/R ${sR.toFixed(2)}→${bR.toFixed(2)}`;
  });

  check('terrain: the air with no sky drawn still has an asymptote', () => {
    // Every headless check, and every unit test, builds a Terrain with no
    // Engine and therefore no band. That path must still fill the strip, or the
    // ground converges on an uninitialised texture and the far field is grey.
    const saved = ground.skyBand;
    ground.skyBand = null;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xffffff, 0.0034);
    scene.fog.color.setRGB(3.042, 3.2302, 3.2018);
    scene.add(new THREE.HemisphereLight(0xc0d4ee, 0x7a6244, 0.135));
    const t = new Terrain(scene, 'arena', 0.5);
    t._syncAtmosphere();
    const F = THREE.DataUtils.fromHalfFloat, d = t._uniforms.uSkyStrip.value.image.data;
    const c = t._uniforms.uSkyCol.value;
    for (const i of [0, 17, 41, 63]) {
      near(F(d[i * 4]), c.r, 2e-3, `strip texel ${i} red does not fall back to uSkyCol`);
      near(F(d[i * 4 + 2]), c.b, 2e-3, `strip texel ${i} blue does not fall back to uSkyCol`);
    }
    t.dispose();
    ground.skyBand = saved;
    return `flat fallback at ${c.toArray().map((v) => v.toFixed(3)).join('/')}`;
  });

  check('terrain: 200 m of air takes the chroma out of the ground and never puts it back', () => {
    /* THE MEASUREMENT THIS LANE IS HELD TO.
     *
     * Sand at 200 m must lose at least 40% of the saturation it has at 20 m,
     * and its luminance must move TOWARD the sky's. Both are asserted, and so
     * is a third property that is strictly stronger and that the build this
     * replaces actually failed: the loss must be MONOTONE. Converging on the
     * authored `skyColor` swatch — a saturated blue on the far side of neutral
     * from the sand — took the arena's ground to 0.057 saturation at 160 m and
     * then back UP to 0.222 by 240 m, at hue 222°. Distance was not
     * desaturating the desert, it was re-saturating it as a different colour.
     */
    const rows = [];
    /* Derived: the three levels written out here were the three that existed
     * when this was written, and two of them have been deleted. Every outdoor
     * level has 200 m of its own air to answer for. */
    for (const key of LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].atmosphere.sky !== false)) {
      const a = LEVELS[key].atmosphere;
      const band = bakeBand(a);
      const sun = sunDirection(a, new THREE.Vector3());
      const disp = skyDisplayShoulder(a);
      const fogC = hazeRadiance(a, new THREE.Color(), disp);
      const hazeSun = skyShoulder(skyRadiance(sun.clone().setY(0.03).normalize(), sun, a, new THREE.Color()));
      const side = sun.clone().setY(0).normalize().cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
      const gain = Math.min(Math.max(lum(hazeSun) - lum(skyShoulder(skyRadiance(side, sun, a, new THREE.Color()))), 0), 12);
      const sl = Math.max(0.02, lum(hazeSun));
      // looking down −z, which is the pose every lane measures from
      const bearing = Math.atan2(-1, 0);
      const j = Math.min(band.az - 1, Math.floor(((bearing / (Math.PI * 2) + 0.5) % 1) * band.az)) * 3;
      const sky = [band.rgb[j], band.rgb[j + 1], band.rgb[j + 2]];
      // The terrain's own ground swatch is what the sand is made of; its
      // absolute level does not matter to a ratio, only its chroma does.
      const g = new THREE.Color(a.groundColor ?? 0x60482e);
      const opt = { eyeY: 1.75, invH: 1 / (a.fogHeight ?? 38), density: a.fogDensity ?? 0.0035,
        fog: [fogC.r, fogC.g, fogC.b], sky, sun: [sun.x, sun.y, sun.z],
        tint: [hazeSun.r / sl, hazeSun.g / sl, hazeSun.b / sl], sunW: a.inscatter ?? gain * 0.028,
        sand: [g.r, g.g, g.b].map((v) => v * 1.6) };

      const D = [20, 40, 60, 90, 120, 160, 200, 240];
      const out = D.map((d) => groundThroughAir(d, opt));
      const S = out.map((c) => sat3(...c)), L = out.map((c) => lum({ r: c[0], g: c[1], b: c[2] }));
      const skyL = lum({ r: sky[0], g: sky[1], b: sky[2] });
      const skyS = sat3(...sky);
      const near200 = D.indexOf(200);
      /* CONVERGENCE, and it is the general form of the assertion under it.
       *
       * "Two hundred metres of air takes the chroma out of the ground" is true
       * whenever the sky is less chromatic than the ground — which was every
       * level in the game until one of them was a lava sea under a smoke
       * ceiling. the Ember Shelf's sky is a saturated orange and its ash is a
       * near-neutral grey, so distance there legitimately ADDS chroma, and a
       * bare saturation-loss bar would be demanding that the ground fail to
       * converge on its own sky.
       *
       * So the property is stated as what it always meant — the ground walks
       * toward the sky and keeps walking — measured as the GAP in chroma, and
       * the old bar is kept verbatim underneath it on every level where the
       * sky really is the greyer of the two. That is strictly more: a ground
       * that lost saturation while heading for a different colour used to pass
       * the first line and now fails the gap. */
      /* THE GROUND WALKS ONTO THE SKY, measured as a CHROMATICITY DISTANCE —
       * each colour divided by its own luminance, so this is about hue and
       * chroma and not about how bright the far ground is. The mixing law in
       * `groundThroughAir` is a lerp toward the sky, so this is the quantity
       * the air actually moves, and it has to move all the way.
       *
       * IT REPLACES A PER-STEP SATURATION TEST, and it is the stronger form of
       * it. The old line was "saturation never rises again — the air is
       * re-saturating the ground as a new colour", which is a proxy: what makes
       * a rise wrong is the NEW COLOUR, and saturation cannot tell the
       * difference between drifting off toward a hue the sky never has (the
       * fault, and the one this file was written for: the arena used to come
       * back to 0.222 at hue 222°) and climbing back onto the sky's own chroma
       * from below. The distance rises in the first case and does not in the
       * second, so every failure the old line caught still fails here — and a
       * ground that loses saturation while heading somewhere else, which the
       * old line waved through, now fails too.
       *
       * That distinction stopped being academic the moment a level had a
       * SATURATED sky. the Ember Shelf's ash is a near-neutral grey under an orange
       * smoke ceiling: its ground's saturation dips through 0.034 at 90 m and
       * comes back to 0.045 at 240 m, against a sky of 0.046 — dead on it, and
       * the old line reads that as the bug.
       *
       * The step tolerance is 6% OF THE WHOLE JOURNEY, not a free pass: the
       * target is itself a blend of the near air and the sky that slides with
       * range (`w = smoothstep(50, 230, r)`), so a ground whose own chroma
       * crosses the sky's can wobble by a fraction of a step while still
       * closing monotonically in the large. Measured, every level's worst step
       * is under 4% and four of the five are exactly monotone.
       *
       * THE ENDPOINT BAR IS UNCHANGED and still applies to every level: at
       * 200 m the ground keeps under 60% of the saturation it had at 20 m.
       * scoria 14%, meadow 20%, drifts 22%, alpine 21%, arena 18%. */
      const norm = (c) => { const l = Math.max(lum({ r: c[0], g: c[1], b: c[2] }), 1e-6); return c.map((v) => v / l); };
      const skyN = norm(sky);
      const dist = out.map((c) => {
        const n = norm(c);
        return Math.hypot(n[0] - skyN[0], n[1] - skyN[1], n[2] - skyN[2]);
      });
      assert(S[near200] < S[0] * 0.60,
        `${key}: sand at 200 m keeps ${(100 * S[near200] / S[0]).toFixed(0)}% of its 20 m saturation`);
      assert(dist[near200] < dist[0] * 0.30,
        `${key}: at 200 m the ground is still ${dist[near200].toFixed(3)} from its own sky in chromaticity, `
        + `against ${dist[0].toFixed(3)} at 20 m — the air is not dissolving it into anything`);
      const tol = dist[0] * 0.06;
      for (let i = 1; i < D.length; i++) {
        assert(dist[i] < dist[i - 1] + tol,
          `${key}: the ground moves back AWAY from its sky in chromaticity between ${D[i - 1]} m `
          + `(${dist[i - 1].toFixed(3)}) and ${D[i]} m (${dist[i].toFixed(3)}) — the air is taking it `
          + 'somewhere the sky never goes');
        // and toward the sky in LEVEL, monotonically, from whichever side it starts
        const sgn = Math.sign(skyL - L[0]);
        assert(sgn * (L[i] - L[i - 1]) > -1e-4,
          `${key}: luminance moves AWAY from the sky between ${D[i - 1]} and ${D[i]} m`);
        assert(sgn * (L[i] - skyL) <= 1e-4,
          `${key}: ground at ${D[i]} m has overshot past the sky it is dissolving into`);
      }
      /* HUE MUST STAY IN THE LEVEL'S OWN FAMILY: a desert does not turn violet
       * with range, and the swatch target took the arena to 222°.
       *
       * GUARDED ON HAVING A HUE AT ALL, which is not a loosening — it closes a
       * hole. The fault this caught was the arena at SATURATION 0.222 and hue
       * 222°: a visible violet cast. Below about 0.08 a colour has no hue worth
       * measuring and the angle between two near-neutrals is noise — measured,
       * the Ember Shelf's ash lands at 0.052 saturation and reports a 172° "swing"
       * that is invisible on any display. So the two cases are asserted
       * separately and between them they cover the whole range: a far ground
       * either still has a hue, in which case it must be its own, or it has
       * none, in which case it must be sitting on its sky. There is no third
       * option and nothing falls through the gap. */
      const drift = hueGap(hue3(...out[0]), hue3(...out[near200]));
      if (S[near200] > 0.08) {
        assert(drift < 40, `${key}: the ground's hue swings ${drift.toFixed(0)}° between 20 m and 200 m`);
      } else {
        assert(dist[near200] < dist[0] * 0.12,
          `${key}: the far ground has no hue left (saturation ${S[near200].toFixed(3)}) and is still `
          + `${dist[near200].toFixed(3)} from its sky in chromaticity — it has gone grey rather than gone away`);
      }
      rows.push(`${key} S ${S[0].toFixed(3)}→${S[near200].toFixed(3)} (${(100 * (S[near200] / S[0] - 1)).toFixed(0)}%), `
        + `L ${L[0].toFixed(3)}→${L[near200].toFixed(3)} of sky ${skyL.toFixed(3)}, Δhue ${drift.toFixed(0)}°`);
    }
    return rows.join('; ');
  });

  check('terrain: the ripple map is not one lattice at one bearing', () => {
    const src = SRC();
    // three overlapping cells, each with its own phase, bearing and wavelength
    assert(/void terHex\(/.test(src) && /void terRipTap\(/.test(src),
      'the stochastic tiling is gone; the ripple map is back on a fixed lattice');
    assert(/texture2DGradEXT\(uBaseAlb/.test(src),
      'the rotated taps sample without explicit gradients — the mip chain breaks at every cell join');
    // the bearing has to come from a field, not from a constant
    assert(/tfbm\(c \* uMix\.x \* [\d.]+/.test(src),
      'the per-cell bearing is not driven by a low-frequency flow field');
    // the rotation must be about the CELL centre; about the origin it is the
    // swirl-with-an-eye this file has already shipped once
    assert(/frame \* \(q - c\)/.test(src),
      'the per-cell rotation is not about the cell centre — that is a global spin');
    // and a height blend, or three ripple fields average into flat grey
    assert(/max\(hb - \(max\(hb\.x, max\(hb\.y, hb\.z\)\) - [\d.]+\), 0\.0\)/.test(src),
      'the three taps are cross-faded, which averages three ripple fields into mush');
    // amplitude has to vary too: phase alone still gives one printed pattern
    assert(/float ripMask = /.test(src) && /uRip\.w \* ripMask/.test(src),
      'ripple amplitude is constant from the toe to the horizon');

    const out = [];
    for (const name of ['dunes', 'arena', 'canyon', 'hangar', 'works', 'cavern', 'scoria', 'temple']) {
      const t = new Terrain(new THREE.Scene(), name, 0.5);
      const cell = t._uniforms.uHex.value.x, tile = 1 / t._uniforms.uScales.value.x;
      // a cell smaller than a tile scrambles the map instead of placing it; a
      // cell many tiles wide puts the same motif twice inside one glance
      assert(cell > tile * 1.4 && cell < tile * 5,
        `${name}: the hex cell is ${(cell / tile).toFixed(1)} tiles`);
      // a poured deck is not blown by anything, so it gets phase and no bearing
      near(t._uniforms.uHex.value.y, TERRAIN_PRESETS[name].flat ? 0 : 1, 1e-6,
        `${name}: the bearing jitter does not match the surface`);
      out.push(`${name} ${cell.toFixed(1)} m / ${(cell / tile).toFixed(1)} tiles`);
      t.dispose();
    }
    return out.join('  ');
  });

  check('terrain: the arena rim is eroded at the SILHOUETTE, and stands on its own debris', () => {
    // The rim read as an extruded ribbon with horizontal banding — a cardboard
    // cyclorama. Erosion that varies with radius is averaged away climbing the
    // wall; only an angular field cuts the ridge line by its full depth.
    const t = new Terrain(new THREE.Scene(), 'arena', 1.0);
    const eyeY = t.height(0, 0) + 1.7;
    const N = 720, prof = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      let best = -9;
      for (let d = 50; d <= t.half - 2; d += 0.8) {
        const el = Math.atan2(t.height(cx * d, cz * d) - eyeY, d);
        if (el > best) best = el;
      }
      prof[k] = best * 180 / Math.PI;
    }
    let m = 0; for (const v of prof) m += v; m /= N;
    let sd = 0; for (const v of prof) sd += (v - m) * (v - m); sd = Math.sqrt(sd / N);
    let d2 = 0, notches = 0;
    for (let k = 0; k < N; k++) {
      d2 += Math.abs(prof[(k + 1) % N] - 2 * prof[k] + prof[(k - 1 + N) % N]);
      if (prof[k] <= prof[(k - 1 + N) % N] && prof[k] < prof[(k + 1) % N] && prof[k] < m - sd * 0.4) notches++;
    }
    d2 /= N;
    assert(sd > 0.92, `the skyline varies by ${sd.toFixed(2)}° — that is a ribbon`);
    assert(notches >= 58, `only ${notches} notches are cut into the ridge line`);
    assert(d2 > 0.26,
      `the ridge line carries ${d2.toFixed(3)}°/sample of high-frequency detail — it reads as a drawn edge`);

    // the talus apron, and the fighting floor it must not have touched
    const foot = [74, 82, 90].map((d) => t.height(d, 0));
    assert(foot[0] > 4.6 && foot[1] > 9.4,
      `no debris at the foot of the wall: ${foot.map((v) => v.toFixed(1)).join('/')} m`);
    for (const [d, want] of [[0, -0.80], [20, -0.72], [40, -0.19], [55, 0.07]]) {
      near(t.height(d, 0), want, 0.02, `the fighting floor moved at r=${d} m`);
    }
    t.dispose();
    return `skyline ±${sd.toFixed(2)}°, ${notches} notches, ${d2.toFixed(3)}°/sample, talus ${foot[1].toFixed(1)} m at r=82`;
  });
}
