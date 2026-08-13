/**
 * SABER — is this actually cel shaded, or is it PBR wearing a ramp?
 *
 * That is the whole question this file exists to answer, because it is the
 * question the player asked twice: first "make it cel shaded like the good
 * ones", and then, of the prototype that came back, "it will inevitably look
 * like shit like your demos and there will be PBR leftovers everywhere" and
 * "something about it still looks similar to non-toon, especially the
 * ground/grass/sky."
 *
 * "Looks cel shaded" is not measurable. What IS measurable is every property
 * that distinguishes a drawn image from a photographed one, and there turn out
 * to be six of them that can each be reduced to a number:
 *
 *   COUNTABILITY   a drawn surface has a countable number of tones. A lit one
 *                  has as many as it has pixels. So: how many distinct values
 *                  does a smooth sweep of the input come out as?
 *   NO LOBE        a photographed surface has a specular lobe, so its
 *                  appearance depends on where the camera is and on how rough
 *                  it is. A drawn one does not depend on either. So: sweep the
 *                  view direction and the roughness and measure the range.
 *   FLAT FIELDS    a photographic texture is a continuum. A drawn one is a
 *                  small set of colours. So: what fraction of a real baked
 *                  albedo map lands within a hair of one of N values?
 *   HARD EDGES     a lit shadow has a penumbra whose width is set by the
 *                  source's angular size. A drawn one has none. So: how wide,
 *                  in the same units, is the transition?
 *   HUE, NOT HAZE  aerial perspective in the reference frames moves a surface
 *                  toward the SKY'S COLOUR. So: does the far asymptote's hue
 *                  match the sky's, and does saturation fall on the way?
 *   INK ON FOLDS   an outline pass that only finds silhouettes gives half the
 *                  look, and one that finds every gradient inks the landscape.
 *                  So: what fraction of a smooth hill is inked, and what
 *                  fraction of a chamfer?
 *
 * NO GPU. There is no GL context anywhere in this harness (tools/dom-shim.mjs
 * is a canvas stub), so every measurement below is made on a JS twin of the
 * shader plus a source-shape assertion that pins the shader the twin stands
 * for — the same pattern tools/checks/terrain-aerial.mjs uses, and for the same
 * reason: the claims here are claims about CURVES, and a curve cannot be read
 * off a device this build never boots.
 *
 * EVERY BOUND IS SHOWN TO BITE. Each measurement is made twice: once on the
 * cel model and once on the physical model it replaced, transcribed from
 * three's own chunks in the same file. A check that only measures the new
 * behaviour cannot tell you whether it measured anything.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  CEL, celTone, celShadow, celAlbedo, celBand, celDistance, lambertTone, bandCount,
} from '../../src/toon/Cel.js';
import { INK } from '../../src/toon/Ink.js';
import { rawMaps, MEAN_ALBEDO } from '../../src/engine/Textures.js';
import { fbm2 } from '../../src/engine/MathUtil.js';

const CEL_SRC = () => readFileSync(new URL('../../src/toon/Cel.js', import.meta.url), 'utf8');
const INK_SRC = () => readFileSync(new URL('../../src/toon/Ink.js', import.meta.url), 'utf8');
const ENGINE_SRC = () => readFileSync(new URL('../../src/engine/Engine.js', import.meta.url), 'utf8');
const TERRAIN_SRC = () => readFileSync(new URL('../../src/world/Terrain.js', import.meta.url), 'utf8');
const SCENERY_SRC = () => readFileSync(new URL('../../src/world/Scenery.js', import.meta.url), 'utf8');

const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
const sat3 = (c) => { const m = Math.max(...c); return m <= 1e-9 ? 0 : (m - Math.min(...c)) / m; };
const hue3 = (c) => {
  const [r, g, b] = c, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 1e-9) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
const hueGap = (a, b) => Math.abs(((b - a + 540) % 360) - 180);

/* ── three's physical BRDF, in JS, as the control ──────────────────────
 *
 * Transcribed from ShaderChunk.bsdfs — the Smith-GGX-correlated visibility and
 * the GGX distribution exactly as three r169 writes them, so "what this used to
 * do" is not a memory. Only the parts the cel model deleted are here.
 */
function BRDF_GGX(dotNL, dotNV, dotNH, roughness, F0 = 0.04) {
  const a = roughness * roughness, a2 = a * a;
  const gv = dotNL * Math.sqrt(dotNV * dotNV * (1 - a2) + a2);
  const gl = dotNV * Math.sqrt(dotNL * dotNL * (1 - a2) + a2);
  const V = 0.5 / Math.max(gv + gl, 1e-6);
  const d = (dotNH * dotNH) * (a2 - 1) + 1;
  const D = a2 / (Math.PI * d * d);
  const F = F0 + (1 - F0) * Math.pow(1 - Math.max(dotNL, 0), 5);
  return V * D * F;
}

/** The physical response of a surface to one light, direct only. */
function physicalDirect({ dotNL, dotNV, dotNH, roughness, albedo, metalness }) {
  const irr = Math.max(dotNL, 0);
  const diffuse = albedo * (1 - metalness) / Math.PI;
  const F0 = 0.04 + (albedo - 0.04) * metalness;
  return irr * (diffuse + BRDF_GGX(Math.max(dotNL, 1e-4), dotNV, dotNH, roughness, F0));
}

/** The cel response to the same input. No view direction, no roughness. */
function celDirect({ dotNL, key, albedo }) {
  return celTone(dotNL, key, 1) * albedo / Math.PI;
}

export function run({ check, assert, near }) {
  /* ══ 1. COUNTABILITY ═══════════════════════════════════════════════════ */

  check('cel: a lit surface has TWO tones and the boundary between them is crisp', () => {
    /* Rule 1 of src/toon/REFERENCE.md, as a number. The reference frames'
     * surfaces are "a lit colour and a shadow colour meeting on a hard edge",
     * and the note is explicit that a ramp with more steps "starts reading as a
     * smooth gradient again, which is the thing being avoided".
     *
     * So sweep N·L across its whole range and ask how much of the surface is
     * flat. Everything outside the anti-aliasing window has to be one of
     * exactly two values. */
    const key = 0.44;                                   // the arena's 26° sun
    const N = 20001;
    const vals = [];
    for (let i = 0; i < N; i++) vals.push(celTone(i / (N - 1), key, 1));
    const hi = Math.max(...vals), lo = Math.min(...vals);
    near(hi, key, 1e-9, 'the lit band is not the light\'s own horizontal response');

    /* RE-DERIVED, and the re-derivation is the point of this round.
     *
     * This line used to be `near(lo, 0)` — the shadow band was zero, on the
     * argument that a floor on the direct term would be a soft second
     * terminator. The frames said otherwise (a near-black player character, and
     * a grey ball whose shadow side measured saturation 0.73 blue) and so does
     * the arithmetic: `mix( shadowBand, 1.0, s )` with s a step is CONSTANT
     * below the terminator, so a non-zero band is a second flat LEVEL and not a
     * gradient. See CEL.shadowBand.
     *
     * So what is asserted is stronger than `lo === 0` was, in three ways at
     * once: the band is EXACTLY the authored share of the key (an identity, not
     * a bound), it is strictly positive (a shadow is a colour), and the low
     * region is exactly as flat as the high one — which is the property the old
     * line was really standing in for and never actually tested. */
    assert(CEL.shadowBand > 0,
      'the shadow band is zero again — the shadow side of everything is whatever the '
      + 'ambient happens to be, which on this rig is blue');
    near(lo, key * CEL.shadowBand, 1e-12, 'the shadow band is not the authored share of the key');
    const belowT = vals.slice(0, Math.floor(N * 0.15));
    assert(belowT.every((v) => v === lo),
      'the shadow band is not flat — some of it is a ramp, which is the second terminator '
      + 'the band was zero to avoid');
    const flat = vals.filter((v) => v < lo + 1e-6 || v > hi - 1e-6).length / N;
    assert(flat > 0.97,
      `only ${(flat * 100).toFixed(1)}% of the response is flat — the rest is a ramp`);
    /* AND THE TWO LEVELS ARE THE SAME COLOUR. The direct term is the light's own
     * colour times this scalar in BOTH bands, so a shadow is its surface one
     * step down rather than the ambient's hue — which is what the reference does
     * ("one coral and one darker coral") and what a shadow band of zero cannot
     * do at all, because with the direct term switched off there is no term left
     * carrying the surface's own light. Stated as the identity it is. */
    near(lo / hi, CEL.shadowBand, 1e-12,
      'the shadow band is not a pure scalar on the lit band — something is changing the '
      + 'colour of the light between the two tones');

    // And the CONTROL: Lambert, over the same sweep, is flat nowhere at all.
    const lam = [];
    for (let i = 0; i < N; i++) lam.push(lambertTone(i / (N - 1)));
    const lamFlat = lam.filter((v) => v < 1e-6 || v > Math.max(...lam) - 1e-6).length / N;
    assert(lamFlat < 0.01,
      'the Lambert control is measuring as flat, so this measurement is not measuring flatness');

    // The terminator's width, in degrees of surface tilt, at this key.
    const t = Math.min(CEL.terminatorMax, CEL.terminatorRel * key);
    const deg = (Math.acos(Math.max(t - CEL.edge, 0)) - Math.acos(Math.min(t + CEL.edge, 1))) * 180 / Math.PI;
    assert(deg < 2.0, `the terminator is ${deg.toFixed(2)}° of tilt wide — that is a ramp, not an edge`);

    // …and it is a step in the SHADER too, not only in the twin.
    const src = CEL_SRC();
    assert(/vec3 irradiance = saberCelTone\( dotNL \)/.test(src),
      'the direct term no longer goes through saberCelTone');
    return `2 tones over ${(flat * 100).toFixed(1)}% of the sweep, terminator ${deg.toFixed(2)}° wide `
      + `(Lambert: ${(lamFlat * 100).toFixed(1)}% flat), lit band = ${hi.toFixed(3)} = sin(elevation), `
      + `shadow band = ${lo.toFixed(3)} = ${CEL.shadowBand} of it, in the same colour`;
  });

  check('cel: the whole frame is countable — a sphere in the game\'s own rig has two tones', () => {
    /* The end-to-end version, because "two tones per surface" is a claim about
     * a rendered object and not about one term of the shader. A sphere, the
     * game's actual light rig read out of Engine.js — a sun with a cascade, two
     * black carriers, a fill that owns no shadow map — and a flat indirect
     * term. Count the distinct luminances over the whole sphere.
     *
     * The fill is what makes this interesting. It is a second directional light
     * from a different direction, so if it were allowed a terminator of its own
     * a sphere would have FOUR tones — a sun terminator crossing a fill
     * terminator — and the frame would read as a gradient again. That is the
     * whole reason for saberCelShape. */
    const src = ENGINE_SRC();
    const sunM = /new THREE\.DirectionalLight\(i === 0 \? (0x[0-9a-f]+) : 0x000000, i === 0 \? ([\d.]+) : 0\)/i.exec(src);
    const fillM = /this\.fill = new THREE\.DirectionalLight\(\s*(0x[0-9a-f]+)\s*,\s*([\d.]+)\s*\)/i.exec(src);
    const fillP = /this\.fill\.position\.set\(([-\d., ]+)\)/.exec(src);
    const hemiM = /new THREE\.HemisphereLight\(\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*,\s*([\d.]+)\s*\)/i.exec(src);
    assert(sunM && fillM && fillP && hemiM, 'the light rig moved; this check can no longer see it');
    const lin = (hex) => { const c = new THREE.Color(Number(hex)); return [c.r, c.g, c.b]; };
    const sunC = lin(sunM[1]).map((v) => v * +sunM[2]);
    const fillC = lin(fillM[1]).map((v) => v * +fillM[2]);
    const fd = fillP[1].split(',').map(Number);
    const fl = Math.hypot(...fd);
    const fill = fd.map((v) => v / fl);
    const sun = [0.42, 0.44, 0.79];                     // 26° elevation
    /* THE FLAT INDIRECT TERM, DERIVED FROM THE RIG RATHER THAN TYPED.
     *
     * This was the literal [0.030, 0.036, 0.048], and a hand-typed ambient is
     * exactly the wrong thing to have in a check whose subject is now the RATIO
     * between the lit band and the shadow band: it decides that ratio outright,
     * and at a fortieth of the rig's real skylight it reported a sphere at 11:1
     * when the rendered frame measured 2.5:1.
     *
     * Every lookup in the game now goes along world up (saberCelFlatDir), and a
     * hemisphere light sampled along its own up axis is exactly its sky colour
     * times its intensity — so the term can be read straight off the rig, and
     * then chroma-trimmed the way saberCelAmbient trims it. The probe is added
     * at the share the level's own meter gives it (see lighting.mjs, which
     * takes the same quantity from the same place). */
    const trim = (c) => { const l = lum(c); return c.map((v) => l + (v - l) * CEL.ambientChroma); };
    const amb = trim(lin(hemiM[1]).map((v) => v * +hemiM[3]));

    const tone = (n, cel) => {
      const out = [0, 0, 0];
      const dS = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
      const dF = n[0] * fill[0] + n[1] * fill[1] + n[2] * fill[2];
      const kS = cel ? celTone(dS, sun[1], 1) : Math.max(dS, 0);
      const kF = cel ? celTone(dF, Math.max(fill[1], 0), 0) : Math.max(dF, 0);
      for (let i = 0; i < 3; i++) out[i] = amb[i] + sunC[i] * kS + fillC[i] * kF;
      return out;
    };
    /* Counted BY AREA, not by distinct float. Every step in this frame is
     * anti-aliased over a sliver — 2.4% of the N·L range, ~0.9° of surface
     * tilt — so a naive distinct-value count returns one entry for each pixel
     * that happens to land inside the terminator and says "289 tones" about a
     * sphere that reads as two. What the eye counts is how many tones cover a
     * meaningful part of the object, so that is what is counted: a tone is a
     * value that at least 1% of the sphere sits within a whisker of. */
    const sweep = (cel) => {
      const vals = [];
      for (let i = 0; i < 160; i++) {
        for (let j = 0; j < 160; j++) {
          const u = (i + 0.5) / 160, v = (j + 0.5) / 160;
          const z = 1 - 2 * u, r = Math.sqrt(Math.max(0, 1 - z * z)), a = v * Math.PI * 2;
          vals.push(lum(tone([r * Math.cos(a), z, r * Math.sin(a)], cel)));
        }
      }
      const bins = new Map();
      for (const v of vals) {
        const k = Math.round(v * 2000);
        bins.set(k, (bins.get(k) || 0) + 1);
      }
      const big = [...bins.entries()].filter(([, n]) => n / vals.length >= 0.01);
      return {
        tones: big.map(([k]) => k / 2000).sort((a, b) => a - b),
        covered: big.reduce((s, [, n]) => s + n, 0) / vals.length,
      };
    };
    const cel2 = sweep(true), pbr2 = sweep(false);
    assert(cel2.tones.length === 2,
      `a sphere in this rig comes out in ${cel2.tones.length} tones, not 2 — `
      + (cel2.tones.length > 2 ? 'something other than the sun is putting a terminator on it'
        : 'the terminator has gone'));
    assert(cel2.covered > 0.95,
      `those tones only cover ${(cel2.covered * 100).toFixed(1)}% of the sphere — the rest is gradient`);
    /* THE CONTROL, and it is the whole measurement rather than a side note. On
     * the physical sphere there is no such thing as "a tone": every one of the
     * 25,600 samples is its own value, so nothing covers 1% of the surface and
     * the same sweep returns zero tones covering nothing. That is what
     * "countable" means, stated as the difference between 98% and 0%. */
    /* The physical control is not at zero and should not be: a sphere lit by a
     * sun and a fill has one genuinely flat region, the cap that neither light
     * reaches, and on this rig that is a sixth of the surface. The
     * discriminator is the other five sixths — under the cel model they belong
     * to a second flat tone, and under the physical one they are a continuum in
     * which nothing repeats. */
    assert(pbr2.covered < 0.35,
      `the physical control has tones covering ${(pbr2.covered * 100).toFixed(0)}% of the sphere, `
      + 'so this measurement is not distinguishing countable from continuous');
    assert(cel2.covered > pbr2.covered * 2.5,
      'the cel sphere is no more countable than the physical one');
    /* THE TWO TONES ARE SEPARATED, AND BOUNDED FROM BOTH SIDES.
     *
     * This was `contrast > 2.5` and only that, which is a lower bound on a
     * quantity whose failure mode turned out to be the OTHER end: with the
     * shadow band at zero the same sphere measured 4.3:1 in linear, the player
     * character rendered as a near-black silhouette in every frame, and no
     * assertion in the build said a word about it. A one-sided bound on a ratio
     * whose whole subject is "how far apart should two tones be" is half a
     * check.
     *
     * The upper bound is not a taste knob. It comes off the reference frames
     * (src/toon/REFERENCE.md): "the coral butte's shadow side is a slightly
     * deeper coral, the mint mech's shadow panels are a deeper mint" — nothing
     * in four frames goes to near-black except deliberate ink and one cast
     * shadow on sand. The lower bound is the old one, kept: two tones a
     * rounding error apart are one tone.
     *
     * Stated in LINEAR, which is what this twin computes. Through ACES and the
     * grade that band lands at 1.3:1 to 1.6:1 in display, and the rendered frame
     * agrees: three probe spheres in the arena's own rig measured 1.45:1, 1.45:1
     * and 1.56:1 (.shots/probe-sphere2.png), against 2.13:1, 2.20:1 and 2.46:1
     * for the same spheres with the band at zero (.shots/probe-sphere.png). */
    const contrast = cel2.tones[1] / cel2.tones[0];
    assert(contrast > 1.5,
      `the two tones are only ${contrast.toFixed(2)}:1 apart — that is one tone with a rounding error`);
    assert(contrast < 3.0,
      `the two tones are ${contrast.toFixed(2)}:1 apart — that is a lit side and a hole, and the `
      + 'reference frames have no hole in them');

    /* AND THE SHADOW TONE IS THE SURFACE'S OWN COLOUR, which is the half of
     * "readable" that a luminance ratio cannot see. Measured as a chromaticity
     * distance between the two tones, with the shadow band at zero as the
     * control — that is the frame in which a grey ball's shadow side came back
     * saturated blue, because with the direct term switched off the only light
     * left is the sky's. */
    const toneAt = (n, band) => {
      const out = [0, 0, 0];
      const dS = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
      const dF = n[0] * fill[0] + n[1] * fill[1] + n[2] * fill[2];
      const kS = band * sun[1] + (1 - band) * celTone(dS, sun[1], 1);
      const kF = celTone(dF, Math.max(fill[1], 0), 0);
      for (let i = 0; i < 3; i++) out[i] = amb[i] + sunC[i] * kS + fillC[i] * kF;
      return out;
    };
    const chroma = (c) => { const l = Math.max(lum(c), 1e-6); return c.map((v) => v / l); };
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const litN = [sun[0], sun[1], sun[2]], darkN = litN.map((v) => -v);
    const gap = dist(chroma(toneAt(litN, 0)), chroma(toneAt(darkN, 0)));
    // the same sphere with CEL.shadowBand forced to 0, which is what shipped
    const zeroBand = (n) => {
      const out = [0, 0, 0];
      const dS = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
      const dF = n[0] * fill[0] + n[1] * fill[1] + n[2] * fill[2];
      const t = Math.min(CEL.terminatorMax, CEL.terminatorRel * sun[1]);
      const kS = dS > t ? sun[1] : 0;
      const kF = celTone(dF, Math.max(fill[1], 0), 0);
      for (let i = 0; i < 3; i++) out[i] = amb[i] + sunC[i] * kS + fillC[i] * kF;
      return out;
    };
    const gap0 = dist(chroma(zeroBand(litN)), chroma(zeroBand(darkN)));
    const contrast0 = lum(zeroBand(litN)) / lum(zeroBand(darkN));
    assert(gap < 0.30,
      `the shadow side is ${gap.toFixed(3)} of chromaticity away from the lit side — that is a `
      + 'different hue family on one surface, which is rule 5 broken by the lighting');
    assert(gap0 > gap * 1.5,
      `a zero shadow band puts the shadow only ${gap0.toFixed(3)} from the lit side against the `
      + `band's ${gap.toFixed(3)} — this measurement is not seeing the thing it was written for`);
    assert(contrast0 > 3.0,
      `the zero-band control measures ${contrast0.toFixed(2)}:1, inside the bound above — so the `
      + 'bound is not biting and the check is stale');
    return `cel: 2 tones at ${contrast.toFixed(2)}:1 covering ${(cel2.covered * 100).toFixed(1)}% of the sphere, `
      + `shadow ${gap.toFixed(3)} of chromaticity off the lit side `
      + `(zero band: ${contrast0.toFixed(2)}:1 at ${gap0.toFixed(3)}) `
      + `· physical: ${pbr2.tones.length} tones covering ${(pbr2.covered * 100).toFixed(1)}%`;
  });

  /* ══ 2. NO LOBE ════════════════════════════════════════════════════════ */

  check('cel: nothing is shiny — the frame does not depend on roughness or on where the camera is', () => {
    /* Rule 8, and the re-derivation the brief asked for: where an existing
     * check measures a roughness or specular ladder, the stronger property is
     * that a flat field has no specular lobe AT ALL.
     *
     * Measured as a sensitivity rather than as a look: hold the surface and the
     * light still, sweep the roughness across the whole range the game
     * authors — Props.MATS.glass is 0.06, a terrain is 1.0 — and sweep the view
     * direction across the mirror lobe. Under the physical model the response
     * changes by a factor of hundreds. Under the cel model it changes by
     * exactly zero, and "exactly" is the point: this is an identity, so there
     * is no threshold to erode. */
    /* Real vectors, not cosines invented independently: N is +z, the light sits
     * at a fixed angle from it, and the view swings through the whole plane
     * containing the two — so the sweep genuinely passes through the mirror
     * direction, which is the only place a lobe lives. Assembling dotNH from
     * dotNL and dotNV separately gets an "average" half vector that never sits
     * on the specular peak, and the control then measures 1.1× and proves
     * nothing. */
    const thetaL = Math.acos(0.62), albedo = 0.5;
    const L = [Math.sin(thetaL), 0, Math.cos(thetaL)];
    let pMin = Infinity, pMax = 0, cMin = Infinity, cMax = 0;
    for (let ri = 0; ri <= 40; ri++) {
      const roughness = 0.06 + (1 - 0.06) * (ri / 40);
      for (let vi = 0; vi <= 60; vi++) {
        const thetaV = -Math.PI / 2 + Math.PI * (vi / 60) * 0.98;
        const V = [Math.sin(thetaV), 0, Math.cos(thetaV)];
        if (V[2] <= 0.02) continue;
        const H = [L[0] + V[0], 0, L[2] + V[2]];
        const hl = Math.hypot(...H);
        const p = physicalDirect({
          dotNL: L[2], dotNV: V[2], dotNH: H[2] / hl, roughness, albedo, metalness: 0 });
        const c = celDirect({ dotNL: L[2], key: 0.44, albedo });
        pMin = Math.min(pMin, p); pMax = Math.max(pMax, p);
        cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      }
    }
    assert(cMax - cMin === 0,
      `the cel response still moves by ${(cMax - cMin).toExponential(2)} across roughness and view angle`);
    assert(pMax / pMin > 20,
      `the physical control only moves ${(pMax / pMin).toFixed(1)}× — this sweep is not exercising the lobe`);

    // And the lobe is DELETED, not driven to zero: a term that is still in the
    // shader can be brought back by a material, and Props.MATS.glass would.
    const src = CEL_SRC();
    for (const [what, pat] of [
      ['the GGX lobe', /'\\treflectedLight\.directSpecular \+= irradiance \* BRDF_GGX\(/],
      ['the sheen lobe', /sheenSpecularDirect \+= irradiance \* BRDF_Sheen\(/],
      ['the environment reflection', /reflectedLight\.indirectSpecular \+= radiance \* singleScattering/],
    ]) {
      assert(pat.test(src), `Cel.js no longer removes ${what} — the removal has silently stopped happening`);
    }
    return `physical response spans ${(pMax / pMin).toFixed(0)}× over roughness 0.06–1.0 and 40 view `
      + `angles; cel spans exactly 0 (${cMax.toFixed(6)} everywhere)`;
  });

  check('cel: a metal is a colour, not a black hole', () => {
    /* THE MOST DANGEROUS PBR LEFTOVER IN THE BUILD, and the one a ramp-on-top
     * approach cannot see.
     *
     * three's physical model gives a metal NO diffuse colour —
     * `diffuseColor * (1 - metalness)` — because all of a metal's appearance is
     * its specular lobe. Delete the lobe, which rule 8 requires, and every
     * metalness-1 surface in the game renders pure black: the saber hilt
     * (metalness 1), the gold ring (1), droid plate, blast doors. Measured on
     * the shipped material list rather than argued. */
    const albedo = 0.55;
    const withLobe = (m) => physicalDirect({
      dotNL: 0.7, dotNV: 0.6, dotNH: 0.95, roughness: 0.35, albedo, metalness: m });
    // What a metal is worth once the lobe is gone, under each model.
    const physicalNoLobe = (m) => 0.7 * albedo * (1 - m) / Math.PI;
    const celNoLobe = () => celDirect({ dotNL: 0.7, key: 0.44, albedo });
    assert(physicalNoLobe(1) === 0,
      'the physical control does not black out a metal, so this check is measuring nothing');
    assert(celNoLobe() > 0.05,
      `a metal under the cel model returns ${celNoLobe().toFixed(4)} — it is still black`);
    // The mechanism, in the shader: the metalness multiply is gone.
    const src = CEL_SRC();
    assert(/material\.diffuseColor = saberCelAlbedo\( diffuseColor\.rgb \);/.test(src),
      'the metalness multiply is back on material.diffuseColor — metals will render black');
    assert(withLobe(1) > 0, 'the transcribed physical model is not lighting a metal at all');
    return `metalness 1 · physical-without-lobe 0.000 · cel ${celNoLobe().toFixed(4)} `
      + `(same as metalness 0, which is the point)`;
  });

  /* ══ 3. FLAT FIELDS ════════════════════════════════════════════════════ */

  check('cel: a real baked albedo map comes out as a handful of colours, not a continuum', () => {
    /* Rule 6: "texture is DRAWN, not shaded … no noise fields."
     *
     * The maps in this game are procedural fBm, worley and ridged noise — a
     * continuum by construction. The posteriser is what turns each of them into
     * flat colour fields, and the honest measurement is the one the brief
     * names: the fraction of pixels within a small distance of one of N palette
     * colours, on the REAL maps rather than on a synthetic ramp.
     *
     * Measured per map, at every texel, in linear light. The palette is not
     * supplied — it is whatever the posteriser lands on, and its SIZE is the
     * result. */
    const rows = [];
    for (const name of ['sand', 'rock', 'soil', 'snow', 'armor', 'metal', 'cloth', 'duracrete']) {
      const m = rawMaps(name);
      assert(m, `no baked map for ${name}`);
      const n = m.size * m.size;
      const step = Math.max(1, Math.floor(n / 40000));   // ~40k texels is plenty
      const srgbToLinear = (u) => { const c = u / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const rawSeen = new Set(), celSeen = new Set();
      let inBand = 0, total = 0;
      for (let i = 0; i < n; i += step) {
        const p = i * 4;
        const raw = [srgbToLinear(m.albedo[p]), srgbToLinear(m.albedo[p + 1]), srgbToLinear(m.albedo[p + 2])];
        const out = celAlbedo(raw);
        // Quantise to 1/1000 of the range for counting, so "distinct" means
        // visibly distinct rather than distinct in the last float bit.
        rawSeen.add(Math.round(lum(raw) * 1000));
        const q = Math.round(lum(out) * 1000);
        celSeen.add(q);
        // and "within a hair of one of N values": the posteriser's plateaus are
        // luminance q² for integer band q, so distance to the nearest plateau
        // is exactly measurable.
        const l = lum(out);
        const b = Math.round(Math.sqrt(Math.max(l, 0)) * CEL.albedoBands - 0.5);
        const plateau = Math.pow((b + 0.5) / CEL.albedoBands, 2);
        if (Math.abs(l - plateau) < 1e-6) inBand++;
        total++;
      }
      const frac = inBand / total;
      assert(celSeen.size <= CEL.albedoBands + 1,
        `${name} posterises to ${celSeen.size} distinct values, more than the ${CEL.albedoBands} bands allow`);
      assert(frac > 0.999,
        `${name}: only ${(frac * 100).toFixed(1)}% of texels sit on a plateau`);
      assert(rawSeen.size > 40,
        `the raw ${name} map only has ${rawSeen.size} distinct values, so it was never a continuum`);
      rows.push(`${name} ${rawSeen.size}→${celSeen.size}`);
    }
    return rows.join(', ') + ' distinct luminances (raw → posterised)';
  });

  check('cel: posterising the ground does not move what the ground IS', () => {
    /* The posteriser sits directly on top of a calibrated contract: Props.js
     * and Bodies.js pick their tints as linear multipliers on MEAN_ALBEDO, and
     * the terrain shader is built around its base maps averaging exactly 0.389
     * (see the note on MEAN_ALBEDO.soil). An operator that moved a map's mean
     * would silently re-tint every prop and every body in the game.
     *
     * The plateau CENTRE is taken rather than its lower edge for exactly this
     * reason, and this is the check that says so. */
    const srgbToLinear = (u) => { const c = u / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    /* THE CONTROL, and it is what makes "centre" a decision rather than a
     * detail: the same quantiser taking the plateau's LOWER EDGE, which is what
     * `floor(x*n)/n` — the obvious form, and the one the grass wave and the
     * cloud coverage use where a shape rather than a level is wanted — does. */
    const celAlbedoEdge = (rgb) => {
      const l = lum(rgb);
      if (l <= 1e-5) return rgb.slice();
      const q = Math.floor(Math.sqrt(l) * CEL.albedoBands) / CEL.albedoBands;
      return rgb.map((c) => Math.max(0, (l + (c - l) * CEL.chroma) * ((q * q) / l)));
    };
    const rows = [];
    let worst = 0, worstEdge = 0;
    for (const name of ['sand', 'soil', 'snow', 'armor', 'duracrete']) {
      const m = rawMaps(name);
      const n = m.size * m.size, step = Math.max(1, Math.floor(n / 40000));
      let a = [0, 0, 0], b = [0, 0, 0], e = [0, 0, 0], k = 0;
      for (let i = 0; i < n; i += step) {
        const p = i * 4;
        const raw = [srgbToLinear(m.albedo[p]), srgbToLinear(m.albedo[p + 1]), srgbToLinear(m.albedo[p + 2])];
        const out = celAlbedo(raw), edge = celAlbedoEdge(raw);
        for (let c = 0; c < 3; c++) { a[c] += raw[c]; b[c] += out[c]; e[c] += edge[c]; }
        k++;
      }
      a = a.map((v) => v / k); b = b.map((v) => v / k); e = e.map((v) => v / k);
      const drift = (lum(b) - lum(a)) / Math.max(lum(a), 1e-6);
      const driftEdge = (lum(e) - lum(a)) / Math.max(lum(a), 1e-6);
      worst = Math.max(worst, Math.abs(drift)); worstEdge = Math.max(worstEdge, Math.abs(driftEdge));
      /* THE BOUND IS DERIVED, NOT CHOSEN. A quantiser MOVES values — that is
       * what it is — so "the mean does not move" is not a property this can
       * have and a threshold on it would just be the largest measurement with a
       * safety factor. What it can have, and what the plateau centre buys, is
       * that no texel moves by more than HALF A BAND in the space the bands are
       * cut in. That is exact, it needs no number of its own, and it is the
       * statement that keeps two materials a stop apart a stop apart. */
      const half = 0.5 / CEL.albedoBands + 1e-9;
      let worstTexel = 0;
      for (let i = 0; i < n; i += step * 7) {
        const p = i * 4;
        const raw = [srgbToLinear(m.albedo[p]), srgbToLinear(m.albedo[p + 1]), srgbToLinear(m.albedo[p + 2])];
        if (lum(raw) <= 1e-5) continue;
        worstTexel = Math.max(worstTexel,
          Math.abs(Math.sqrt(lum(celAlbedo(raw))) - Math.sqrt(lum(raw))));
      }
      assert(worstTexel <= half,
        `${name} has a texel moved ${worstTexel.toFixed(4)} in sqrt-luminance, past the `
        + `${half.toFixed(4)} half-band the quantiser guarantees`);
      if (MEAN_ALBEDO[name]) {
        rows.push(`${name} ${lum(a).toFixed(3)}→${lum(b).toFixed(3)} (${(drift * 100).toFixed(0)}%)`);
      } else rows.push(`${name} ${lum(a).toFixed(3)}→${lum(b).toFixed(3)} (${(drift * 100).toFixed(0)}%)`);
    }
    /* AND THE ORDERING SURVIVES, which is the property MEAN_ALBEDO exists for:
     * Props and Bodies pick tints as multipliers on these, so what must not
     * change is that a pale material stays paler than a dark one. Pairs closer
     * together than one band may merge — that is posterisation, and it is the
     * intended effect — so the assertion is on pairs that are further apart
     * than a band, which is every pair that was ever meant to read as two
     * different materials. */
    const named = Object.entries(MEAN_ALBEDO).map(([k, v]) => [k, lum(v)]);
    let pairs = 0;
    for (const [ka, la] of named) {
      for (const [kb, lb] of named) {
        if (la <= lb || Math.abs(Math.sqrt(la) - Math.sqrt(lb)) < 1 / CEL.albedoBands) continue;
        pairs++;
        assert(lum(celAlbedo(MEAN_ALBEDO[ka])) > lum(celAlbedo(MEAN_ALBEDO[kb])),
          `${ka} was lighter than ${kb} and is not any more — posterisation reordered the palette`);
      }
    }
    assert(pairs >= 8, `only ${pairs} material pairs are more than a band apart — nothing was tested`);
    /* The plateau CENTRE against the obvious lower-EDGE form, which is what
     * `floor(x·n)/n` gives and what the grass wave and the cloud coverage use
     * where a shape rather than a level is wanted. The edge form is biased: it
     * can only ever darken, so it walks the whole palette down. */
    assert(worstEdge > worst * 1.5,
      `taking the plateau's lower edge drifts ${(worstEdge * 100).toFixed(1)}% against the centre's `
      + `${(worst * 100).toFixed(1)}% — the choice of centre is not buying anything and the check is stale`);
    return rows.join(', ') + ` · ${pairs} ordered pairs held, worst mean drift `
      + `${(worst * 100).toFixed(1)}% (lower edge instead of centre: ${(worstEdge * 100).toFixed(1)}%)`;
  });

  /* ══ 4. HARD EDGES ═════════════════════════════════════════════════════ */

  check('cel: a cast shadow is a flat shape — there is no penumbra anywhere', () => {
    /* Rule 2: "There is no penumbra anywhere in any of these frames. A soft
     * shadow is a PBR leftover."
     *
     * The engine's filter is a 12-tap Poisson disc whose radius tracks the
     * sun's angular size, so the value it produces ramps smoothly from 0 to 1
     * across the penumbra. Measure how much of that ramp survives the step.
     *
     * The filter is NOT removed and that is deliberate — its 50% contour is a
     * far better blocker silhouette than a single tap, which staircases on the
     * shadow map's own grid. What is removed is the gradient. */
    const N = 4001;
    let softIn = 0, softOut = 0;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      if (s > 1e-6 && s < 1 - 1e-6) softIn++;
      const o = celShadow(s);
      if (o > 1e-6 && o < 1 - 1e-6) softOut++;
    }
    const width = softOut / N;
    assert(width < 0.10,
      `${(width * 100).toFixed(1)}% of the filter's range still comes out as a gradient`);
    assert(softIn / N > 0.99,
      'the unstepped control is not a gradient, so this measurement is measuring nothing');
    near(celShadow(0.2), 0, 1e-9, 'the umbra is not solid');
    near(celShadow(0.8), 1, 1e-9, 'full sun is not full');
    // …and it is applied to BOTH ways the game asks the shadow question.
    const src = CEL_SRC();
    assert(/saberCelShadow\( saberCascadeShadow\(\) \)/.test(src)
      && (src.match(/saberCelShadow\( saberCascadeShadow\(\) \)/g) || []).length >= 2,
      'only one of lights_fragment_begin / shadowmask_pars_fragment steps the shadow — '
      + 'the grass and the terrain would then disagree about where a shadow ends');
    return `penumbra ${(width * 100).toFixed(1)}% of the filter's range `
      + `(${(softIn / N * 100).toFixed(0)}% before), umbra and full sun both exact`;
  });

  /* ══ 5. HUE, NOT HAZE ══════════════════════════════════════════════════ */

  check('cel: distance arrives in plates, and every material stands on the same grid', () => {
    /* Rule 3's other half. The COLOUR distance converges on is the sky in the
     * view direction and has to stay a smooth function of bearing — the
     * reference's fourth frame grades orange to cyan across its sky and the
     * ground under it does the same. What is quantised is the STRENGTH, which
     * is what turns a continuous veil into the flat plates a background
     * painting is built from.
     *
     * The grid has to be shared. The terrain replaces three's fog chunk with
     * its own (Terrain.js, TERRAIN_FRAG_FOG) — that is the whole subject of
     * tools/checks/terrain-aerial.mjs — so if only one of the two were banded,
     * a prop at 90 m would sit in a different plate from the ground under its
     * feet. */
    const N = 20001;
    const seen = new Set();
    for (let i = 0; i < N; i++) seen.add(Math.round(celDistance(i / (N - 1)) * 1e6));
    assert(seen.size === CEL.fogBands + 1,
      `distance resolves to ${seen.size} plates, not the ${CEL.fogBands + 1} the band count allows`);
    // monotone, and it still reaches both ends — a banded fog that cannot reach
    // 1 leaves the world's edge visible, which is what the fog is there to hide
    near(celDistance(0), 0, 1e-9, 'the near plate is not transparent');
    near(celDistance(1), 1, 1e-9, 'the far plate is not opaque');
    for (let i = 1; i < 200; i++) {
      assert(celDistance(i / 199) >= celDistance((i - 1) / 199), 'the plates are not monotone in distance');
    }
    assert(/saberCelDistance\(fogFactor\)/.test(TERRAIN_SRC()),
      'the terrain\'s own fog chunk is not banded — the ground and the props are on different grids');
    assert(/saberCelDistance\( fogFactor \)/.test(CEL_SRC()),
      'the engine\'s fog chunk is not banded');
    return `${seen.size} plates over the full range, terrain and engine chunks both on it`;
  });

  check('cel: the sky is a few flat fields, and the ground converges on the sky\'s own hue', () => {
    /* Rule 3 ("aerial perspective is a HUE SHIFT toward the sky, not grey fog")
     * and rule 7 ("the sky is flat, or one simple gradient"), on the engine's
     * own sky rather than on a swatch.
     *
     * The dome is evaluated exactly as Engine draws it — skyRadiance through
     * skyShoulder through the level's own display pair — and then through the
     * band function the shader applies. Two things have to come out of it: a
     * countable number of fields, and a far asymptote whose HUE is the sky's.
     *
     * Imported dynamically. A static import edge to Engine.js from a check
     * resolves `three` out of node_modules while everything else resolves out
     * of vendor/, which patches the wrong copy of the fog chunks and burns the
     * once-only flag — see the note at the top of tools/verify.mjs. */
    return (async () => {
      const E = await import('../../src/engine/Engine.js');
      const { LEVELS } = await import('../../src/game/Levels.js');
      const bandsM = /const SKY_BANDS = (\d+)/.exec(ENGINE_SRC());
      assert(bandsM, 'SKY_BANDS is gone from Engine.js');
      const BANDS = +bandsM[1];
      assert(/saberCelBand\( skyShoulder\( texColor \* uSkyScale \)/.test(ENGINE_SRC()),
        'the sky mesh is no longer banded');

      const rows = [];
      const { LEVEL_ORDER: ORDER1 } = await import('../../src/game/Levels.js');
      for (const key of ORDER1.filter((k) => LEVELS[k] && LEVELS[k].atmosphere.sky !== false)) {
        const a = LEVELS[key].atmosphere;
        const sun = E.sunDirection(a, new THREE.Vector3());
        const disp = E.skyDisplayShoulder(a);
        const col = new THREE.Color(), dir = new THREE.Vector3();
        const raw = new Set(), banded = new Set();
        for (let j = 0; j < 48; j++) {
          const s = (j + 0.5) / 48 * 0.98, c = Math.sqrt(Math.max(0, 1 - s * s));
          for (let i = 0; i < 96; i++) {
            const b = -Math.PI + ((i + 0.5) / 96) * Math.PI * 2;
            E.skyShoulder(E.skyRadiance(dir.set(Math.cos(b) * c, s, Math.sin(b) * c), sun, a, col),
              disp.knee, disp.ceil);
            raw.add(Math.round(lum([col.r, col.g, col.b]) * 400));
            banded.add(Math.round(lum(celBand([col.r, col.g, col.b], BANDS)) * 400));
          }
        }
        assert(banded.size <= BANDS + 1,
          `${key}'s sky resolves to ${banded.size} fields, more than ${BANDS} bands allow`);
        assert(raw.size > 20,
          `${key}'s unbanded sky already has only ${raw.size} fields — this is measuring nothing`);

        /* …AND WHAT DISTANCE CONVERGES ON IS THAT SKY.
         *
         * Measured as a CHROMATICITY DISTANCE and not as a hue angle, because
         * on a level whose sky is nearly neutral the hue angle is noise: the
         * alpine skyline measures 0.006 saturation, so "its hue" is whichever
         * way the last significant bit fell, and comparing an angle to it
         * reports 73° for two colours that are both, to the eye, white. The
         * distance between the two unit-luminance triples has no such hole in
         * it and it is the quantity the reference is actually describing —
         * "distant rock goes lavender under a lavender sky" is a statement
         * about where the colour ENDS UP, not about an angle. */
        const side = sun.clone().setY(0).normalize()
          .cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
        const skyline = E.skyShoulder(E.skyRadiance(side, sun, a, new THREE.Color()), disp.knee, disp.ceil);
        const haze = E.hazeRadiance(a, new THREE.Color(), disp);
        const chromaOf = (c) => { const l = Math.max(lum([c.r, c.g, c.b]), 1e-4); return [c.r / l, c.g / l, c.b / l]; };
        const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const d = dist(chromaOf(skyline), chromaOf(haze));
        /* THE CONTROL: the same derivation with the authored-dust share it
         * shipped at. hazeRadiance keeps 1 - share of the level's own fog
         * swatch, and at the old 0.55 the swatch still set the hue — which on
         * the arena put a hue-32° tan haze under a hue-201° sky. */
        const unitc = (c) => c.clone().multiplyScalar(1 / Math.max(0.02, lum([c.r, c.g, c.b])));
        const control = new THREE.Color(a.fogColor ?? 0xc9b391)
          .lerp(unitc(skyline.clone()), 0.55);
        const dControl = dist(chromaOf(skyline), chromaOf(control));
        assert(d < 0.06,
          `${key}: what distance converges on is ${d.toFixed(3)} of chromaticity away from the sky it `
          + 'stands in — that is grey fog with a colour of its own, not aerial perspective');
        assert(dControl > d,
          `${key}: the shipped 0.55 dust share was already at least as close to the sky (${dControl.toFixed(3)}) `
          + 'as the current one, so raising it bought nothing');
        rows.push(`${key} ${raw.size}→${banded.size} fields, haze ${d.toFixed(3)} from sky (was ${dControl.toFixed(3)})`);
      }
      return rows.join('; ');
    })();
  });

  /* ══ 6. INK ON FOLDS ═══════════════════════════════════════════════════ */

  check('ink: a chamfer is drawn, the ground it stands on is not, and the far field is quiet', () => {
    /* Rule 4 wants interior lines — "the strata in the cliffs, the mortar
     * between stones and the panel seams on the mech" — and the first attempt
     * at satisfying it inked the entire landscape instead. Three separate
     * mechanisms keep the line where it belongs, and all three are measured
     * here on the game's OWN terrain noise rather than on a synthetic bulge.
     *
     * 1. THE OPERATOR IS A SECOND DIFFERENCE. On a surface of constant
     *    curvature the Laplacian and the first difference are the same size —
     *    both go as the square of the turn per sample — so the gain is not the
     *    "smooth bend versus fold" story it is tempting to tell. What it
     *    actually buys is measured below on real fBm ground, where the
     *    curvature is not constant: the first difference accumulates every
     *    wiggle, the Laplacian cancels whatever part of it is locally linear.
     *
     * 2. THE CREASE FADES WITH RANGE. Past INK.creaseFade a fold is a fraction
     *    of a pixel wide and the detector finds it somewhere different every
     *    frame. Silhouettes are not faded — a mountain keeps its outline.
     *
     * 3. THE DEPTH TERM IS DIVIDED BY THE GRAZING ANGLE, SQUARED. That is what
     *    the far field's black band actually was, and it is measured last. */
    const src = INK_SRC();
    assert(/length\( nL \+ nR - 2\.0 \* n0 \) \+ length\( nD \+ nU - 2\.0 \* n0 \)/.test(src),
      'the crease term is not a second difference any more');

    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const first = (f, x, r) => {
      const n0 = f(x), a = f(x - r), b = f(x + r);
      return (1 - dot(n0, a)) + (1 - dot(n0, b));
    };
    const second = (f, x, r) => {
      const n0 = f(x), a = f(x - r), b = f(x + r);
      return Math.hypot(a[0] + b[0] - 2 * n0[0], a[1] + b[1] - 2 * n0[1], a[2] + b[2] - 2 * n0[2]);
    };
    const R = INK.creaseWidth;
    const STEP = 0.05;
    /** Fraction of a 120-pixel span the operator inks. */
    const inked = (op, f, bias, lo = -60, hi = 60) => {
      let n = 0, k = 0;
      for (let x = lo; x <= hi; x += STEP) { if (op(f, x, R) > bias) n++; k++; }
      return n / k;
    };
    /** Width of the line the operator draws over one feature, in pixels. This
     *  is the quantity rule 4 is about — "thin, even weight" — and a coverage
     *  fraction over a window is not: a single 1.7 px line in a 120 px span is
     *  1.4% of it, which reads as "barely inked" and is exactly right. */
    const lineWidth = (op, f, bias) => {
      let n = 0;
      for (let x = -8; x <= 8; x += STEP) if (op(f, x, R) > bias) n++;
      return n * STEP;
    };

    /* WHERE THE TWO OPERATORS ACTUALLY DIFFER, derived rather than asserted,
     * because the obvious story about them is wrong and it is worth writing the
     * right one down.
     *
     * On a surface of CONSTANT curvature turning by a per sample radius, both
     * operators return the same thing — 2(1 - cos a) ≈ a². The Laplacian does
     * NOT cancel a circular arc; nL and nR are symmetric about n₀ in angle, not
     * in position, and 2·cos(a)·n₀ - 2·n₀ is exactly a² of residue. So a story
     * about "smooth bends cancelling" would be a story about nothing.
     *
     * What differs is the response to a DISCONTINUITY. Across a fold of angle
     * a the first difference returns 1 - cos a ≈ a²/2 — second order, the same
     * order as the bend — while the Laplacian returns |nL - n₀| = 2·sin(a/2) ≈
     * a, which is FIRST order. So the fold sticks out further above the bend
     * the smaller the fold is, and that is the entire gain: for a given seam
     * the pass must find, the Laplacian can run a threshold that tolerates much
     * faster ground before it starts scribbling.
     *
     * Both margins are computed here from the operators themselves. */
    const foldFirst = (a) => 1 - Math.cos(a);
    const foldSecond = (a) => 2 * Math.sin(a / 2);
    const bendBoth = (a) => 2 * (1 - Math.cos(a));
    const solveBend = (bias) => {            // per-sample turn at which open ground inks
      let lo = 0, hi = Math.PI / 2;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (bendBoth(m) < bias) lo = m; else hi = m; }
      return lo * 180 / Math.PI;
    };
    /* The finest fold rule 4 asks the pass to draw. 20°, not 9°, and the
     * difference was decided by looking: at 9° the canyon's cliff faces and the
     * arena's scattered rock came out crazed with black, because a procedurally
     * displaced rock is thousands of facets meeting at ten to fifteen degrees
     * and those are the mesh rather than anything a modeller drew. Rule 4's own
     * examples — strata, mortar, panel seams — are DRAWN marks in the reference
     * frames, which is rule 6 seen from the other side. */
    const SEAM = 20 * Math.PI / 180;
    const biasSecond = INK.creaseBias;
    const biasFirst = foldFirst(SEAM);       // what a first difference would need
    assert(foldSecond(SEAM) >= biasSecond * 0.98,
      `a ${(SEAM * 180 / Math.PI).toFixed(0)}° seam scores ${foldSecond(SEAM).toFixed(3)} against a `
      + `${biasSecond} threshold — the pass cannot see the interior detail rule 4 asks for`);
    const marginSecond = solveBend(biasSecond), marginFirst = solveBend(biasFirst);
    assert(marginSecond > marginFirst * 2,
      `the second difference tolerates ground bending ${marginSecond.toFixed(1)}°/sample against the `
      + `first difference's ${marginFirst.toFixed(1)}° — the operator is not buying anything`);

    /* And the sanity check on real ground: the game's own fBm, at the scale a
     * hillside fills the middle of the frame, inks nothing at all. */
    const H = (xpx, mpp) => fbm2(xpx * mpp / 70, 3.7, 4) * 9;   // 9 m of relief on a 70 m base
    const ground = (mpp) => (x) => norm([-(H(x + 0.5, mpp) - H(x - 0.5, mpp)) / mpp, 0, 1]);
    const chamfer = (x) => (x < 0 ? norm([-0.32, 0, 1]) : norm([0.32, 0, 1]));  // 35° fold
    // Each operator measured at ITS OWN threshold — the one that just draws the
    // 20° seam — so the comparison is between two passes that satisfy rule 4
    // equally, which is the only comparison that means anything.
    const g2 = inked(second, ground(0.9), biasSecond), g1 = inked(first, ground(0.9), biasFirst);
    const c2 = lineWidth(second, chamfer, biasSecond), c1 = lineWidth(first, chamfer, biasFirst);
    assert(c2 > 1.0, `the chamfer draws a line ${c2.toFixed(2)} px wide — rule 4 is unmet`);
    assert(c2 < 3.0, `the chamfer draws a line ${c2.toFixed(2)} px wide — that is a smudge, not ink`);
    assert(g2 < 0.01, `${(g2 * 100).toFixed(1)}% of open ground is inked — that is the scribble`);

    /* 2. RANGE. The crease term is scaled by 1 - smoothstep(fade), so the same
     * chamfer has to survive at arm's length and disappear in the far field. */
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const atRange = (d) => second(chamfer, 0.4, R) * (1 - ss(INK.creaseFade[0], INK.creaseFade[1], d));
    assert(atRange(12) > INK.creaseBias, 'a chamfer twelve metres away is not inked');
    assert(atRange(240) < INK.creaseBias * 0.25, 'a chamfer at 240 m is still being inked — it will shimmer');

    /* 3. GRAZING. The depth term is multiplied by |N·V|², so ground seen almost
     * edge-on — which is the entire mid-field of an outdoor level — contributes
     * a small fraction of what a surface facing the camera does. At the 0.06
     * floor the first attempt ran, one sixteenth of an enormous second
     * difference was still over the line and the horizon inked solid. */
    assert(/dEdge \*= facing \* facing;/.test(src), 'the grazing correction is no longer squared');
    const graze = Math.pow(Math.cos(84 * Math.PI / 180), 2);
    assert(graze < 0.02,
      `a surface 84° from face-on still contributes ${(graze * 100).toFixed(1)}% of the depth gradient`);

    return `to draw a ${(SEAM * 180 / Math.PI).toFixed(0)}° seam the second difference tolerates `
      + `ground bending ${marginSecond.toFixed(1)}°/sample, `
      + `the first only ${marginFirst.toFixed(1)}° (${(marginSecond / marginFirst).toFixed(1)}× the margin) `
      + `· chamfer line ${c2.toFixed(2)} px, real fBm ground ${(g2 * 100).toFixed(2)}% inked `
      + `(first difference ${(g1 * 100).toFixed(2)}%, chamfer ${c1.toFixed(2)} px) `
      + `· chamfer fades ${atRange(12).toFixed(2)} at 12 m → ${atRange(240).toFixed(3)} at 240 m `
      + `· grazing at 84° contributes ${(graze * 100).toFixed(1)}%`;
  });

  check('ink: nothing whose silhouette is not its geometry reaches the outline prepass', () => {
    /* Four separate bugs in the first attempt, all of which drew ink where
     * there was no edge, and all four are one property: `overrideMaterial`
     * replaces every material with MeshNormalMaterial, which has no alpha map,
     * no alpha test and no blending — so a camera-facing billboard writes a
     * fully opaque RECTANGLE into the normal and depth buffers.
     *
     * The subtle one is the grass. Its cards set `transparent: false` and no
     * alphaTest: the cutout is a `discard` inside their own fragment shader, so
     * a test built on material flags alone lets them through and the mid-field
     * turns into a band of black stipple. That is why the test ends up reading
     * shader SOURCE — inelegant, and the alternative is a list of object names
     * which is wrong the first time somebody adds a cutout. */
    const src = INK_SRC();
    for (const [what, pat] of [
      ['transparent materials', /m\.transparent/],
      ['alpha-tested materials', /m\.alphaTest > 0/],
      ['additive materials', /m\.blending === THREE\.AdditiveBlending/],
      ['shaders that discard', /m\.fragmentShader\.indexOf\('discard'\) >= 0/],
      ['the explicit opt-out', /m\.userData\.saberNoInk/],
    ]) assert(pat.test(src), `the prepass no longer excludes ${what}`);
    // the sky is excluded by depth, not by a flag, and the shader has to say so
    assert(/if \( zc >= 0\.9999 \) \{ gl_FragColor = src; return; \}/.test(src),
      'the far-plane discard is gone — empty sky will be inked');
    assert(/scene\.background = null/.test(src) && /scene\.fog = null/.test(src),
      'the prepass no longer clears the background and the fog, so empty space has a normal in it');
    // and the grass really does carry a discard, which is what the test relies on
    assert(/if\(a < uCut\) discard;/.test(SCENERY_SRC()),
      'the grass no longer discards, so the source test no longer excludes it');
    // the ink is not black, and it is applied after the tone curve
    const c = INK.color;
    assert(c !== 0x000000, 'the line colour is pure black — rule 4 asks for dark brown or charcoal');
    const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    assert(Math.max(...rgb) < 80, `the line colour is too light to read as ink (${rgb.join(',')})`);
    assert(Math.max(...rgb) - Math.min(...rgb) >= 8,
      'the line colour is a neutral grey — the reference inks in dark brown or charcoal');
    assert(/enc\(g\.r \* k\) << 16/.test(ENGINE_SRC()),
      'the line colour is no longer derived per level from the ground it is drawn over');
    return `5 exclusions live, far plane discarded, default ink #${c.toString(16).padStart(6, '0')} `
      + `(warm by ${Math.max(...rgb) - Math.min(...rgb)}/255), per-level ink derived in applyAtmosphere`;
  });

  check('ink: the line stops where sight does, on every level\'s own air', () => {
    /* THE WORST THING IN THE FIRST MEADOW FRAME was a hard black line ruled
     * straight across the whole width of the picture at the horizon, and it was
     * not a fault in the detector: it is the EDGE OF THE WORLD. The heightfield
     * is a 520 m box and past its rim there is sky, so the rim is a genuine
     * depth silhouette, and the pass drew it at full strength — the one thing
     * every level's fog is authored to hide.
     *
     * The pass runs after the tone curve and cannot see the scene's air, so it
     * is told. The fade is derived, not authored: FogExp2's transmittance is
     * exp(-(d·k)²), so the distance at which the air has replaced a fraction f
     * of a surface is sqrt(-ln(1-f))/k.
     *
     * What has to come out of it is that the line survives as far as the LEVEL
     * lets you see and no further — which means the two numbers must differ
     * per level in the same direction the visibility does, rather than being a
     * constant with a level's name on it. */
    return (async () => {
      const { LEVELS } = await import('../../src/game/Levels.js');
      const { OutlinePass } = await import('../../src/toon/Ink.js');
      // Built without a renderer: the constructor only allocates targets and
      // uniforms, and setHaze touches nothing else.
      const pass = Object.create(OutlinePass.prototype);
      pass.uniforms = { uHaze: { value: new THREE.Vector2() } };
      const rows = [];
      let widest = 0, narrowest = Infinity;
      const { LEVEL_ORDER: ORDER2 } = await import('../../src/game/Levels.js');
      for (const key of ORDER2.filter((k) => LEVELS[k] && LEVELS[k].atmosphere.sky !== false)) {
        const a = LEVELS[key].atmosphere;
        if (!a || a.fog === false) continue;
        pass.setHaze(a.fogDensity);
        const [s, e] = [pass.uniforms.uHaze.value.x, pass.uniforms.uHaze.value.y];
        assert(e > s, `${key}: the ink fade ends before it starts`);
        // it must reach past the fight and stop inside the world box
        assert(s > 40, `${key}: the ink starts fading at ${s.toFixed(0)} m, inside the arena of a fight`);
        assert(e < 620, `${key}: the ink still draws at ${e.toFixed(0)} m — past the heightfield's own rim`);
        widest = Math.max(widest, e); narrowest = Math.min(narrowest, e);
        rows.push(`${key} ${s.toFixed(0)}–${e.toFixed(0)} m`);
      }
      assert(widest / narrowest > 1.8,
        `every level fades its ink over the same range (${narrowest.toFixed(0)}–${widest.toFixed(0)} m) — `
        + 'it is not tracking the air, it is a constant');
      assert(/e \*= 1\.0 - smoothstep\( uHaze\.x, uHaze\.y, dC \);/.test(INK_SRC()),
        'the shader no longer fades the line with range');
      assert(/this\.outline\?\.setHaze\(fog\.density\)/.test(ENGINE_SRC()),
        'nothing hands the level\'s air to the outline pass');
      return rows.join(', ');
    })();
  });

  check('cel: every level inks in its own dark note, warm on sand and cool on snow', () => {
    /* Rule 5 — one hue family per scene — reaching the one element that would
     * otherwise be the same on all seven levels. A single ink colour breaks it
     * both ways: pure black on a coral butte reads as a hole punched in it, and
     * a warm brown line on snow reads as dirt.
     *
     * Derived, not authored, from the one thing every level already states
     * about its own warm/cool axis: `groundColor`, the colour of the light its
     * ground throws back up. The derivation is transcribed here — the same two
     * lines Engine.applyAtmosphere runs — and what is asserted is that the
     * answers come out DARK, CHROMATIC, and on the correct side of neutral for
     * the level, all three of which a constant would fail. */
    return (async () => {
      const { LEVELS } = await import('../../src/game/Levels.js');
      const enc = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92
        : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
      const inkOf = (a) => {
        const g = new THREE.Color(a.groundColor ?? 0x60482e);
        const k = 0.021 / Math.max(lum([g.r, g.g, g.b]), 1e-4);
        return [enc(g.r * k), enc(g.g * k), enc(g.b * k)];
      };
      /* WHICH WAY EACH LEVEL LEANS is read off the level, not off a table.
       *
       * This used to be two hand-written sets — WARM = dunes/drifts/arena/
       * canyon, COOL = meadow/alpine/hangar — which broke the moment three of
       * those levels were deleted, and was the weaker question anyway: it
       * asked whether seven named levels came out on the side somebody had
       * written down. What the ink actually has to do is follow ITS OWN
       * LEVEL's ground light, whichever way that leans, for every level in the
       * game — so the expected side is derived from `groundColor` and the
       * assertion is that the derivation survives being driven down to a fixed
       * luminance. A constant ink fails that on every level at once, which is
       * the fault this exists to catch, and now nine levels are covered where
       * seven were.
       *
       * The SPREAD is the second half and it is new: a game whose levels all
       * ink within a hair of each other has a constant with extra steps,
       * however well derived. */
      const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
      const rows = [], leans = [];
      for (const key of LEVEL_ORDER) {
        const a = LEVELS[key] && LEVELS[key].atmosphere;
        if (!a) continue;
        const g = new THREE.Color(a.groundColor ?? 0x60482e);
        const want = (g.r - g.b);                       // the level's own warm/cool axis
        const [r, g2, b] = inkOf(a);
        assert(Math.max(r, g2, b) < 70, `${key} inks at ${r},${g2},${b} — too light to read as a drawn line`);
        assert(Math.max(r, g2, b) > 20, `${key} inks at ${r},${g2},${b} — that is black, which rule 4 excludes`);
        const lean = r - b;
        if (want > 0.004) {
          assert(lean > 6, `${key}'s ground light is warm (r-b ${want.toFixed(3)} linear) and it inks `
            + `cool or neutral (r-b ${lean})`);
        } else if (want < -0.004) {
          assert(lean < -3, `${key}'s ground light is cool (r-b ${want.toFixed(3)} linear) and it inks `
            + `warm or neutral (r-b ${lean})`);
        }
        leans.push(lean);
        rows.push(`${key} ${r},${g2},${b}`);
      }
      assert(rows.length >= 6, `only ${rows.length} levels inked`);
      assert(Math.max(...leans) - Math.min(...leans) > 20,
        `every level in the game inks within ${(Math.max(...leans) - Math.min(...leans)).toFixed(0)} of the `
        + 'same warm/cool lean — that is a constant with a derivation in front of it');
      assert(Math.max(...leans) > 6 && Math.min(...leans) < -3,
        'no level inks warm, or none inks cool — the derivation is not reaching both sides');
      return rows.join(' · ');
    })();
  });

  /* ══ 7. THE MECHANISM IS AT THE ROOT ═══════════════════════════════════ */

  check('cel: the whole game is cel shaded because the BRDF is, not because materials were swapped', () => {
    /* The argument the player made, and the reason this is not Toon.js.
     *
     * A sweep that converts MeshStandardMaterial to MeshToonMaterial cannot
     * reach: a material carrying an onBeforeCompile (the terrain, the
     * particles, the sign), a hand-written ShaderMaterial (grass, water, sky
     * dome, blade, motes, snow, haze, shimmer), or anything constructed after
     * the sweep runs — a severed limb, a fractured chunk, a prop a wave spawns.
     *
     * Counted here so the size of that hole is a number rather than an
     * argument, and asserted the other way round: the game must contain NO
     * material swap, and the shading must come from a chunk rewrite that every
     * one of those materials is compiled against. */
    const files = ['world/Terrain.js', 'world/Scenery.js', 'world/Props.js', 'world/Particles.js',
      'game/Bodies.js', 'game/Saber.js', 'engine/SkyDome.js'];
    let custom = 0, shaders = 0;
    for (const f of files) {
      const s = readFileSync(new URL('../../src/' + f, import.meta.url), 'utf8');
      custom += (s.match(/onBeforeCompile\s*=/g) || []).length;
      shaders += (s.match(/new THREE\.ShaderMaterial\(/g) || []).length;
    }
    assert(custom + shaders > 15,
      `only ${custom + shaders} materials would have been missed by a swap — the argument is weaker than stated`);

    // Nothing anywhere replaces a material to shade it.
    const engine = ENGINE_SRC();
    assert(!/MeshToonMaterial/.test(engine), 'Engine builds a MeshToonMaterial — that is the swap approach');
    assert(/installCelShading\(THREE\)/.test(engine), 'the cel model is not installed');
    // …and it is installed AFTER the two chunk rewrites it depends on.
    const iA = engine.indexOf('installAerialPerspective(THREE)');
    const iC = engine.indexOf('installCascadeShadows(THREE)');
    const iL = engine.indexOf('installCelShading(THREE)');
    assert(iA > 0 && iC > 0 && iL > 0, 'one of the three installs is missing');
    assert(iL > iA && iL > iC,
      'installCelShading runs before the chunks it patches are written — every one of its '
      + 'replacements would miss and the frame would come out half physical');
    // and it says so when it misses, rather than assuming
    assert(/console\.warn\('SABER: cel shading could not patch: '/.test(CEL_SRC()),
      'a failed chunk replacement is now silent');
    return `${custom} extended + ${shaders} hand-written materials a swap could not have reached; `
      + 'installed at the root, after aerial and cascades';
  });

  check('cel: the ground\'s texture relief is drawn, not shaded', () => {
    /* Rule 6, on the one surface it matters most for. A detail normal under a
     * two-tone terminator does not read as relief — it reads as SPECKLE,
     * because the shading is flat wherever N·L is clear of the threshold and
     * salt-and-pepper wherever it is not. Screenshotted on the dune sea: the
     * whole foreground came out as a mat of dark dashes.
     *
     * The ripple, the joints and the sward are all still in the ALBEDO — the
     * base coat is modulated by the same map's luminance — so what is removed
     * is the second, shaded copy. The SURFACE MEMORY is deliberately not
     * removed: a boot print is a deformation the player made, not a texture,
     * and its tilt is the only thing that says a print is a hole and not a
     * stain. */
    const src = TERRAIN_SRC();
    const relM = /const TER_RELIEF = '([\d.]+)'/.exec(src);
    assert(relM, 'TER_RELIEF is gone');
    assert(+relM[1] === 0, `the ground still shades ${relM[1]} of its texture relief`);
    const iScale = src.indexOf('terNrmOff *= ');
    const iSurf = src.indexOf('vec2 grd = (S.gb * 2.0 - 1.0)');
    const iSward = src.indexOf('terNrmOff += (Txz * (swardBlade');
    assert(iScale > 0 && iSurf > 0 && iSward > 0, 'the terrain normal chain has moved');
    assert(iScale > iSward,
      'the relief scale runs before the sward relief is added, so the sward survives it');
    assert(iScale < iSurf,
      'the relief scale runs AFTER the surface memory is added, so footprints and craters '
      + 'have been flattened along with the ripples — the deformation system draws nothing');
    // the albedo half is still there, or the ripple is simply gone
    assert(/baseLum/.test(src) && /0\.55 \+ baseLum/.test(src),
      'the base map no longer modulates the ground colour, so removing the relief removed the ripple');
    return 'relief 0.0 into the shading, ripple still in the albedo, surface memory added after the scale';
  });

  /* ══ 8. THE SHADOW IS A COLOUR, NOT AN ABSENCE ═════════════════════════ */

  check('cel: a shadow is READABLE — every level lands between 1.3:1 and 2.2:1, in its own hue', () => {
    /* THE FRAME THAT PROMPTED THIS. With the shadow band at zero the player
     * character rendered as a near-black silhouette on every level
     * (.shots/cel9-arena.png, .shots/cel7-meadow.png): you could tell there was
     * a robe, you could not read the figure. The reference frames do not have
     * one dark like it — "the coral butte's shadow side is a slightly deeper
     * coral, the mint mech's shadow panels are a deeper mint", and nothing in
     * four frames goes to near-black except deliberate ink and one cast shadow.
     *
     * The check above measures a sphere in the CONSTRUCTOR's rig. This one
     * measures every outdoor level as shipped, and takes the indirect term from
     * the game's own exposure meter rather than from a swatch: `irradiance` is
     * what a horizontal surface receives, `direct` is the sun's share of it, so
     * the difference IS the ambient, in the units the shader works in. There is
     * nothing to type in and nothing to remember.
     *
     * A LIT surface receives `irradiance`. A shadowed one receives the ambient
     * plus the authored band of the direct (CEL.shadowBand) — cast shadow and
     * terminator alike, because saberCelCast combines with the terminator by min
     * rather than by product. That is the whole of the rendering claim, and it
     * is one line of arithmetic.
     *
     * Imported dynamically — a static import edge to Engine.js from a check
     * patches the wrong copy of `three` and burns the once-only chunk flag. */
    return (async () => {
      const E = await import('../../src/engine/Engine.js');
      const { LEVELS } = await import('../../src/game/Levels.js');
      /* Derived rather than listed: two of the six named here were deleted,
       * and "every outdoor level" is what the property was always about. */
      const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
      const OUT = LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].atmosphere.sky !== false);
      const rows = [], seen = [];
      let tightest = 0, loosest = Infinity, worstGap = 0;
      for (const key of OUT) {
        const a = LEVELS[key].atmosphere;
        if (!a || a.sky === false) continue;
        const m = E.atmosphereMeter(a);
        const ambient = m.irradiance - m.direct;
        const lit = m.irradiance;
        const shade = ambient + m.direct * CEL.shadowBand;
        const ratio = lit / shade;
        /* THE BAND, and both ends of it are the reference rather than taste.
         * Below 1.3 the terminator stops reading as a boundary at all; above 2.2
         * the shadow side stops being a colour. The brief's own target — "the
         * shadow band should sit somewhere around 0.55–0.75 of the lit band's
         * luminance" — is 1.33:1 to 1.82:1 stated the other way up, and these
         * are linear radiances which the tone curve then compresses toward 1. */
        assert(ratio >= 1.3,
          `${key}: sunlit ground is only ${ratio.toFixed(2)}:1 over its own shadow — the terminator `
          + 'has stopped being a boundary');
        assert(ratio <= 2.2,
          `${key}: ${ratio.toFixed(2)}:1 into shade. The reference's shadow side is a deeper version `
          + 'of the surface, not a hole in it');
        /* THE CONTROL, and it is what shipped: the same level with the band at
         * zero, which is the ambient alone. It has to FAIL the bound above, or
         * the bound is decorative. */
        const ratio0 = lit / ambient;
        assert(ratio0 > 2.2,
          `${key}: with the shadow band at zero the ratio is ${ratio0.toFixed(2)}:1, inside the bound — `
          + 'so the bound is not what is holding the shadow up and this check is stale');
        /* …AND THE SHADOW KEEPS THE SUN'S WARMTH RATHER THAN TAKING THE SKY'S
         * COLOUR OUTRIGHT. Measured as the share of a shadowed surface's light
         * that still arrives from the key. At zero that share is zero by
         * construction, which is exactly why a grey ball's shadow side measured
         * saturation 0.73 blue. */
        const keyShare = (m.direct * CEL.shadowBand) / shade;
        assert(keyShare > 0.30,
          `${key}: only ${(keyShare * 100).toFixed(0)}% of a shadowed surface's light comes from the key, `
          + 'so its hue is the ambient\'s and not the surface\'s');
        tightest = Math.max(tightest, ratio); loosest = Math.min(loosest, ratio);
        worstGap = Math.max(worstGap, ratio0);
        seen.push([m.sunPos.y, keyShare, key]);
        rows.push(`${key} ${ratio.toFixed(2)}:1 (was ${ratio0.toFixed(2)}:1), key ${(keyShare * 100).toFixed(0)}%`);
      }
      assert(rows.length >= 5, `only ${rows.length} outdoor levels were measured`);
      /* AND THE SHARE ORDERS BY SUN HEIGHT, which is what makes 0.30 a floor on
       * a physical quantity rather than a number somebody liked. A 14° sun
       * shines through four times the air a 60° one does, so it delivers less
       * of the level's light and its shadows are legitimately cooler and closer
       * to the ambient's hue — the canyon sits at 33% and the arena at 46% for
       * exactly that reason. A constant pretending to be a physical quantity
       * fails this line; the floor alone would not have noticed. */
      seen.sort((p, q) => p[0] - q[0]);
      for (let i = 1; i < seen.length; i++) {
        assert(seen[i][1] > seen[i - 1][1],
          `${seen[i][2]} has a higher sun than ${seen[i - 1][2]} and no more of its shadow comes `
          + 'from the key — the shadow tone is not tracking the light');
      }
      /* AND THE EXPOSURE DID NOT MOVE. The lit band is untouched by all of this —
       * a lit surface still receives exactly `irradiance` — which is the reason
       * the meter, the bloom headroom and every existing lighting check are
       * where they were. Asserted rather than assumed, because it is the one
       * thing a shadow lift could plausibly have broken. */
      assert(/mix\( 1\.0, mix\( 0\.3000, 1\.0, onLight \), saberCelShape \)/.test(CEL_SRC())
        || /mix\( 1\.0, mix\( \$\{CEL\.shadowBand/.test(CEL_SRC()),
        'the tone function no longer mixes the shadow band under the lit band');
      assert(/float onLight = min\( s, saberCelCast \);/.test(CEL_SRC()),
        'the cast shadow no longer combines with the terminator by min — a cast shadow falling on a '
        + 'shadow face will square the band and go black');
      assert(/saberCelCast = \( directLight\.visible && receiveShadow \)/.test(CEL_SRC()),
        'the cascade mask is being multiplied into the light colour again, which skips the band');
      assert(/saberCelCast = shadow;/.test(SCENERY_SRC()),
        'the grass is not on the same shadow tone as the ground it grows out of');
      return rows.join(' · ') + ` — worst zero-band control ${worstGap.toFixed(2)}:1`;
    })();
  });

  /* ══ 9. THE FAR FIELD ══════════════════════════════════════════════════ */

  check('ink: the far field carries no line at all, and a fight carries every line it had', () => {
    /* "The cleanest, flattest part of a Sable frame is the distance. In ours it
     * is the noisiest." Both halves of that were measured before this was
     * written: .shots/diag-ink.png renders the pass's own edge factor in red and
     * the arena's far buttes come back SOLID, and .shots/probe-noink.png is the
     * same view with the pass switched off and is the reference look outright.
     *
     * Every mark out there is a true silhouette — a ruin is a stack of separate
     * blocks and a butte is several hundred displaced rocks — so the fix cannot
     * be a threshold. It is range, and it now has to be range in METRES rather
     * than in extinction, because fog density across the levels spans 2.6× while
     * "how far away is the far wall" does not follow it at all.
     *
     * So: sweep range and measure the line's OPACITY, per term, against the old
     * behaviour as the control. */
    const src = INK_SRC();
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    // A REAL SILHOUETTE, in the shader's own units: a wall with sky behind it,
    // which is what a ruin's edge and a butte's rim both are. Its dEdge is far
    // over the threshold, so the only thing that can switch it off is the fade.
    const BIG = 0.35;                                  // relative depth jump
    const bias = INK.depthBias * 0.02;
    const edgeAt = (d) => ss(bias, bias + 0.004, BIG) * (1 - ss(INK.edgeFade[0], INK.edgeFade[1], d));
    // The crease term, on the 35° chamfer the check above uses, faded twice.
    const chamfer = 2 * Math.sin(35 * Math.PI / 360);
    const creaseAt = (d) => {
      const f = 1 - ss(INK.creaseFade[0], INK.creaseFade[1], d);
      return ss(INK.creaseBias, INK.creaseBias + INK.creaseSoft, chamfer * f) * f;
    };

    // 1. INSIDE A FIGHT, NOTHING HAS CHANGED. A duel happens inside 25 m.
    for (const d of [2, 8, 18, 25]) {
      near(edgeAt(d), 1, 1e-9, `a silhouette at ${d} m is no longer drawn at full weight`);
      assert(creaseAt(d) > 0.9, `a chamfer at ${d} m only inks at ${creaseAt(d).toFixed(2)}`);
    }
    // 2. AND THE FAR FIELD IS CLEAN. Both terms are exactly zero, not small.
    for (const d of [140, 200, 400]) {
      near(edgeAt(d), 0, 1e-9, `a silhouette at ${d} m is still being drawn`);
      near(creaseAt(d), 0, 1e-9, `a crease at ${d} m is still being drawn`);
    }
    // 3. THE CONTROL: the ranges this replaced. Silhouettes had no metre fade at
    //    all and creases faded only their measurement, so on the arena's buttes
    //    at 160 m both were still at full weight — which is the frame.
    // Measured on the fold a RUIN is made of rather than on the 35° chamfer: the
    // arena's walls are stacked blocks and its ground is displaced rock, so the
    // crease term out there is seeing 90° corners, and 90° is what was scribbling.
    const corner = 2 * Math.sin(90 * Math.PI / 360);
    const creaseOld = (d) => ss(INK.creaseBias, INK.creaseBias + INK.creaseSoft,
      corner * (1 - ss(40, 120, d)));
    const cornerAt = (d) => {
      const f = 1 - ss(INK.creaseFade[0], INK.creaseFade[1], d);
      return ss(INK.creaseBias, INK.creaseBias + INK.creaseSoft, corner * f) * f;
    };
    assert(creaseOld(90) > 0.5,
      `the old crease fade already had a stacked-block corner at 90 m down to `
      + `${creaseOld(90).toFixed(2)} — this measurement is not seeing what the frames saw`);
    near(cornerAt(90), 0, 1e-9,
      `a block corner at 90 m still inks at ${cornerAt(90).toFixed(2)}`);
    assert(cornerAt(20) > 0.99, 'a block corner at 20 m is no longer drawn at full weight');

    // 4. …and the shader really does fade the OPACITY rather than the input.
    //    Scaling a measurement that is ten times over a threshold four
    //    thousandths wide does nothing at all, which is why the first attempt at
    //    this changed the frame not at all.
    assert(/\* \( 1\.0 - smoothstep\( uEdge\.x, uEdge\.y, dC \) \)/.test(src),
      'the silhouette fade is not applied to the line opacity');
    assert(/smoothstep\( uWeight\.w, uWeight\.w \+ \$\{INK\.creaseSoft[^}]*\}, nEdge \) \* creaseFade/.test(src),
      'the crease fade is not applied to the line opacity');
    assert(/float creaseFade = 1\.0 - smoothstep\( uRange\.z, uRange\.w, dC \);/.test(src),
      'the crease measurement is no longer faded with range');

    // 5. THE DEPTH BUFFER HAS TO RESOLVE THE WORLD, or the pass inks its own
    //    quantisation. At 16 bits over the meadow's prepass frustum one code is
    //    2.3 m at 150 m, and the second difference of a 2.3 m step over 150 m
    //    scores 0.031 against a 0.019 threshold — a hard line ruled across the
    //    whole width of the frame, on every iso-depth contour in the far field.
    assert(/depthTexture\.type = THREE\.UnsignedIntType/.test(src),
      'the ink prepass is back on a 16-bit depth buffer — its own quantisation contours will '
      + 'be inked as horizontal lines across the far field');
    const step = (bits, d, n = 0.15, f = 190) => (f - n) * d * d / (f * n * Math.pow(2, bits));
    const scoreAt = (bits, d) => 2 * step(bits, d) / d;
    assert(scoreAt(16, 150) > bias,
      `a 16-bit contour at 150 m scores ${scoreAt(16, 150).toFixed(4)}, under the ${bias} threshold — `
      + 'this measurement is not reproducing the bug');
    assert(scoreAt(24, 150) < bias / 50,
      `a 24-bit contour at 150 m still scores ${scoreAt(24, 150).toExponential(2)}`);

    // 6. and nothing past the ink's reach is rasterised at all
    assert(/const reach = Math\.min\(this\.uniforms\.uHaze\.value\.y, this\.uniforms\.uEdge\.value\.y\)/.test(src),
      'the prepass frustum no longer tracks the nearer of the two fades, so it is drawing geometry '
      + 'to produce pixels the composite multiplies by nothing');
    return `silhouette full to ${INK.edgeFade[0]} m, gone by ${INK.edgeFade[1]} m; crease full to `
      + `${INK.creaseFade[0]} m, gone by ${INK.creaseFade[1]} m (a block corner at 90 m: `
      + `${creaseOld(90).toFixed(2)} → 0.00) · `
      + `16-bit contour scores ${scoreAt(16, 150).toFixed(4)} vs 24-bit ${scoreAt(24, 150).toExponential(1)} `
      + `against a ${bias} threshold`;
  });

  check('cel: the ground is a countable set of colour fields, not a continuum of mixtures', () => {
    /* Rule 1 — "two tones per surface, and the boundary is crisp" — applied to
     * the ground's PALETTE rather than to its shading. A hillside blending sand
     * into rock through a smoothstep is a continuum in which no two pixels are
     * the same colour, which is the definition of the thing the whole file is
     * measuring against.
     *
     * AND THE CLAIM THIS REPLACED, because it was wrong and it is worth leaving
     * the disproof behind. The argument for quantising the blend was that the
     * albedo posteriser dithers wherever its input drifts across a band
     * boundary, so the arena's speckled cliff face would be fixed by quantising
     * the input first. Measured below: a posteriser only dithers on input that
     * varies PER PIXEL, and the terrain's weights are driven by noise fields at
     * 9 m and 140 m, which are fifteen pixels and more across at any range you
     * can see a cliff from. Quantising a smooth input changes the dither by
     * nothing measurable — the control and the subject come out within a
     * percentage point of each other, both ways round, at every amplitude.
     *
     * The wall was speckling because of the rock MAP, whose features are
     * centimetres wide and therefore genuinely per-pixel out there. That is
     * terFlat's job, and it is asserted in the check below this one. */
    const A = MEAN_ALBEDO.sand, B = MEAN_ALBEDO.rock;
    const N = 4000;

    /* 1. COUNTABILITY, on the real weight the arena's cliff is blended by:
     *    rockW = smoothstep(bands, slope + noise), swept across the slope range
     *    a wall actually spans. */
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // Measured over THE PART OF THE WALL THAT IS A BLEND — where the raw weight
    // is neither pinned at all-sand nor at all-rock. Outside it both models are
    // trivially flat and averaging that in would hide the whole difference.
    const raw0 = [];
    for (let i = 0; i < N; i++) {
      // the slope across a wall, and the 9 m noise the shader adds to it
      const slope = 0.06 + (i / (N - 1)) * 0.24;   // just the band a wall blends across
      raw0.push(ss(0.10, 0.32, slope + (fbm2(i * 0.0026, 5.3, 3) - 0.5) * 0.14));
    }
    const band = raw0.map((w, i) => (w > 0.02 && w < 0.98 ? i : -1)).filter((i) => i > 0 && i < N - 1);
    assert(band.length > N * 0.4,
      `only ${band.length} of ${N} samples across the wall are a blend at all — the sweep is not `
      + 'crossing the band');
    const face = (quantise) => {
      const q = (w) => (quantise ? Math.floor(w * CEL.blendBands + 0.5) / CEL.blendBands : w);
      const cols = new Set(), blends = new Set();
      let flat = 0;
      for (const i of band) {
        const w = q(raw0[i]);
        blends.add(w);
        cols.add(Math.round(lum(celAlbedo([0, 1, 2].map((c) => A[c] + (B[c] - A[c]) * w))) * 4000));
        if (w === q(raw0[i - 1]) && w === q(raw0[i + 1])) flat++;
      }
      return { flat: flat / band.length, blends: blends.size, cols: cols.size };
    };
    const q = face(true), raw = face(false);
    assert(q.blends <= CEL.blendBands + 1,
      `the ground blends through ${q.blends} weights, more than the ${CEL.blendBands + 1} nodes allow`);
    assert(raw.blends > band.length * 0.9,
      `the unquantised control only reaches ${raw.blends} distinct weights across the blend band — `
      + 'it was never a continuum and this check is measuring nothing');
    assert(q.flat > 0.99,
      `only ${(q.flat * 100).toFixed(1)}% of a blended wall is inside a flat field`);
    assert(raw.flat < 0.01,
      `the unquantised control measures ${(raw.flat * 100).toFixed(1)}% flat, so "flat field" is not `
      + 'distinguishing anything');

    /* 2. THE DISPROOF, kept as a live measurement so nobody re-argues it: with
     *    input that varies per pixel — which the MAP does and the blend does
     *    not — quantising the blend first buys nothing. */
    const dither = (quantise) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        let w = Math.min(1, Math.max(0, (i / (N - 1)) * 1.25 - 0.12 + (fbm2(i * 0.37, 11.3, 3) - 0.5) * 0.16));
        if (quantise) w = Math.floor(w * CEL.blendBands + 0.5) / CEL.blendBands;
        out.push(Math.round(lum(celAlbedo([0, 1, 2].map((c) => A[c] + (B[c] - A[c]) * w))) * 4000));
      }
      let flat = 0;
      for (let i = 1; i < N - 1; i++) if (out[i] === out[i - 1] && out[i] === out[i + 1]) flat++;
      return flat / (N - 2);
    };
    const dq = dither(true), dr = dither(false);
    assert(Math.abs(dq - dr) < 0.03,
      `quantising the blend moved per-pixel dither from ${(dr * 100).toFixed(1)}% flat to `
      + `${(dq * 100).toFixed(1)}% — it IS an anti-dither measure after all, and both the note in `
      + 'CEL.blendBands and the one in Terrain.js are now wrong');

    /* 3. THE FORM OF THE QUANTISER. A mask has to be able to reach 0 and 1, so
     *    it snaps to nodes; the albedo posteriser takes plateau centres, so it
     *    cannot darken a field on average. They are different operators and the
     *    two are used for different things. */
    assert(/float saberCelQuant\( const in float v, const in float n \) \{\n  return floor\( v \* n \+ 0\.5 \) \/ n;/.test(CEL_SRC()),
      'saberCelQuant is gone or is no longer snapping to nodes');
    assert(Math.floor(0 * CEL.blendBands + 0.5) / CEL.blendBands === 0
      && Math.floor(1 * CEL.blendBands + 0.5) / CEL.blendBands === 1,
      'the blend quantiser cannot reach 0 or 1 — every surface in the game carries a fraction of '
      + 'every other layer');
    assert(celBand([0.4, 0.4, 0.4], CEL.blendBands)[0] !== 0.4 * 1,
      'the two quantisers have become the same operator');
    const ter = TERRAIN_SRC();
    for (const w of ['rockW', 'gritW', 'driftW', 'crustW', 'lagW', 'sheetW']) {
      assert(new RegExp(`float ${w}\\s*=\\s*saberCelQuant\\(`).test(ter),
        `${w} is not quantised before it picks a colour`);
    }
    return `a blended wall is ${q.blends} weights over ${(q.flat * 100).toFixed(1)}% flat field `
      + `(unquantised: ${raw.blends} weights, ${(raw.flat * 100).toFixed(1)}% flat) · per-pixel `
      + `dither unmoved: ${(dr * 100).toFixed(1)}% → ${(dq * 100).toFixed(1)}% flat`;
  });

  check('cel: the ground\'s marks are DRAWN — sparse dots on a lattice, not a thresholded noise field', () => {
    /* Rule 6, the positive half: "Ground detail as sparse dark speckle dots —
     * literal dots, widely spaced, no noise field." The shaded relief came out
     * (TER_RELIEF is 0) and the photographic tone now collapses with range
     * (terFlat), which between them leave the ground flat — and flat-but-empty
     * is not flat-but-designed.
     *
     * The measurable difference between a mark and a noise field is that marks
     * are COUNTABLE, SEPARATED and the same size as each other. Transcribed from
     * terSpeckle in Terrain.js and measured against the game's own fBm
     * thresholded to the same coverage, which is the thing rule 6 is against. */
    const thash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const speckle = (px, pz, cell, fill, rad, soft) => {
      const qx = px / cell, qz = pz / cell;
      const ix = Math.floor(qx), iz = Math.floor(qz);
      const fx = qx - ix, fz = qz - iz;
      if (thash(ix * 1.031 + 4.7, iz * 1.031 + 4.7) > fill) return 0;
      const cx = thash(ix + 3.7, iz + 3.7) * 0.56 + 0.22;
      const cz = thash(ix * 0.917 + 11.3, iz * 0.917 + 11.3) * 0.56 + 0.22;
      const d = Math.hypot(fx - cx, fz - cz);
      const t = Math.min(1, Math.max(0, (d - (rad - soft)) / (2 * soft)));
      return 1 - t * t * (3 - 2 * t);
    };
    // the near-field parameters, read off the shader so the twin cannot drift
    const ter = TERRAIN_SRC();
    const call = /terSpeckle\(wp, ([\d.]+), ([\d.]+), ([\d.]+), clamp\(spx \/ [\d.]+, ([\d.]+), [\d.]+\)\)/.exec(ter);
    assert(call, 'the speckle call has moved; this check can no longer read its parameters');
    const [cell, fill, rad, soft] = call.slice(1).map(Number);

    const SIDE = 48, RES = 6;                       // 48 m of ground at 6 samples/m
    const n = SIDE * RES;
    const grid = new Uint8Array(n * n);
    let covered = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = speckle(i / RES, j / RES, cell, fill, rad, soft);
        if (v > 0.5) { grid[j * n + i] = 1; covered++; }
      }
    }
    const cov = covered / (n * n);
    /* SPARSE. The reference's speckle is a scattering, not a stipple: a few per
     * cent of the ground, so the field between the marks stays the flat colour
     * the level authored. */
    assert(cov > 0.001 && cov < 0.03,
      `the speckle covers ${(cov * 100).toFixed(2)}% of the ground — that is a texture, not marks`);

    // COUNTABLE AND SEPARATED. One dot per filled cell, and no dot touches the
    // next: the jittered centre sits in [0.22, 0.78] of a cell and the radius is
    // small enough that the disc cannot cross the cell edge.
    assert(rad + 0.22 < 0.5,
      `a dot of radius ${rad} centred as close as 0.22 from a cell edge crosses it — the marks `
      + 'will merge into blobs');
    const seen = new Uint8Array(n * n);
    let blobs = 0; const sizes = [];
    const stack = [];
    for (let s = 0; s < n * n; s++) {
      if (!grid[s] || seen[s]) continue;
      blobs++; let size = 0; stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        const k = stack.pop(); size++;
        const x = k % n, y = (k - x) / n;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const t = ny * n + nx;
          if (grid[t] && !seen[t]) { seen[t] = 1; stack.push(t); }
        }
      }
      sizes.push(size);
    }
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const sd = Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length);
    /* THE MARKS ARE ALL THE SAME SIZE, which is what "dots" means and what an
     * fBm blob field can never be. A coefficient of variation under a fifth is
     * a set of discs; the control below is over one. */
    assert(sd / mean < 0.25,
      `the marks vary in size by ${(sd / mean * 100).toFixed(0)}% — they are blobs, not dots`);
    assert(blobs > 40, `only ${blobs} marks in ${SIDE}×${SIDE} m — nothing was measured`);

    /* THE CONTROL: the game's own fBm, thresholded to the SAME coverage. It is
     * the alternative rule 6 names and rejects, and it fails both properties. */
    const vals = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals.push(fbm2(i / RES / 3, j / RES / 3, 4));
    const sorted = [...vals].sort((a, b) => a - b);
    const thr = sorted[Math.floor((1 - cov) * sorted.length)];
    const ngrid = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) ngrid[k] = vals[k] > thr ? 1 : 0;
    const nseen = new Uint8Array(n * n);
    let nblobs = 0; const nsizes = [];
    for (let s = 0; s < n * n; s++) {
      if (!ngrid[s] || nseen[s]) continue;
      nblobs++; let size = 0; stack.length = 0; stack.push(s); nseen[s] = 1;
      while (stack.length) {
        const k = stack.pop(); size++;
        const x = k % n, y = (k - x) / n;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const t = ny * n + nx;
          if (ngrid[t] && !nseen[t]) { nseen[t] = 1; stack.push(t); }
        }
      }
      nsizes.push(size);
    }
    const nmean = nsizes.reduce((a, b) => a + b, 0) / nsizes.length;
    const nsd = Math.sqrt(nsizes.reduce((a, b) => a + (b - nmean) ** 2, 0) / nsizes.length);
    assert(nsd / nmean > 0.5,
      `a thresholded noise field at the same coverage has marks varying by only `
      + `${(nsd / nmean * 100).toFixed(0)}% — this measurement cannot tell a dot from a blob`);

    // …and the strata are drawn too, in world space, so a bed 150 m out is
    // drawn exactly as firmly as one at arm's length.
    assert(/smoothstep\(0\.075, 0\.0, bandF\) \+ smoothstep\(0\.925, 1\.0, bandF\)/.test(ter),
      'the strata seam is no longer a narrow contour line');
    assert(/1\.0 - seam \* 0\.46/.test(ter), 'the strata seam has lost its contrast');
    // and the far field really does collapse onto the map's own calibrated mean
    assert(/baseLum = mix\(uFarMean\.x, baseLum, terFlat\);/.test(ter),
      'the ground\'s photographic tone no longer collapses with range');
    assert(/float rockLum = mix\(uFarMean\.y, dot\(rockC, vec3\(0\.3333\)\), terFlat\);/.test(ter),
      'the rock\'s photographic tone no longer collapses with range');
    return `${blobs} marks over ${SIDE}×${SIDE} m covering ${(cov * 100).toFixed(2)}%, size spread `
      + `${(sd / mean * 100).toFixed(0)}% (thresholded fBm at the same coverage: ${nblobs} blobs, `
      + `${(nsd / nmean * 100).toFixed(0)}%)`;
  });
}

/* Sampling stride for the mean-drift check — one in ~40k texels is far more
 * than enough for a mean and keeps the whole file under a second. */
function MathizeStep(n) { return Math.floor(n / 40000); }
