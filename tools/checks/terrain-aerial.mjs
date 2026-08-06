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
import { Terrain, TERRAIN_PRESETS } from '../../src/world/Terrain.js';

const SRC = () => readFileSync(new URL('../../src/world/Terrain.js', import.meta.url), 'utf8');
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

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
    for (const name of ['dunes', 'arena', 'canyon', 'hangar']) {
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
