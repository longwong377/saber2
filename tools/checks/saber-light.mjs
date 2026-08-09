/**
 * WHAT THE BLADE DOES TO EVERYTHING NEAR IT.
 *
 * A lightsaber is the brightest thing in this game and it is held at arm's
 * length from the character the player is looking at, so it is the one light in
 * the build that can destroy a subject. Two separate mechanisms do it and this
 * file pins both, because they were confused with each other for a whole round
 * and the confusion was expensive.
 *
 * The established experiment was the same walk with the blade LIT and with it
 * RETRACTED. It shows a real and large effect. But retracting a blade removes
 * TWO things at once — the two point lights, and the drawn emitter with its
 * bloom halo — and the difference between those two had never been separated.
 * Rendering one frozen frame of the real dune sea once per condition separates
 * them (tools/_wielder.mjs sweep):
 *
 *     wielder silhouette, one pose        R/B
 *     blade retracted (control)          0.984
 *     blade DRAWN, both lights ZEROED    0.303     <- already ruined
 *     as shipped                         0.283
 *     as shipped, bloom pass disabled    0.650     <- most of it back
 *
 * The point lights are almost none of it. The drawn blade is 88% of it, and
 * disabling the bloom pass with the lights still ON gives most of it back. What
 * flattens a wielder is the bloom halo of the blade's own core — 58 against the
 * pass's 1.8 threshold, in a hue that is 23:1 blue to red — laid over the figure
 * as a monochromatic wash.
 *
 * The cast shadow is the OTHER mechanism and it is genuinely separate: with the
 * blade drawn and the lights zeroed the player's shadow measures R/B 1.494
 * against an unlit 1.605, i.e. barely touched, and only with the point lights on
 * does it invert to 1.042. The lights are unshadowed (castShadow false, on
 * purpose) so in the one region the sun cannot reach they are unopposed.
 *
 * So: the emitter's chroma is what the wielder needs fixing, the thrown light's
 * chroma is what the shadow needs fixing, and a change to either one must not be
 * credited with the other's job. Everything below exists to keep that true.
 */

import { Saber, SABER_COLORS } from '../../src/game/Saber.js';
import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/game/Saber.js', import.meta.url);
const ENGINE_SRC = new URL('../../src/engine/Engine.js', import.meta.url);

/** three's own punctual attenuation, so the numbers here are the shader's. */
function attenuation(d, cutoff, decay) {
  let f = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (cutoff > 0) f *= Math.pow(Math.max(0, 1 - Math.pow(d / cutoff, 4)), 2);
  return f;
}

export function run({ check, assert, near, THREE }) {
  const scene = new THREE.Scene();
  const sabers = SABER_COLORS.map((_, i) => new Saber(scene, { colorIndex: i }));
  const chan = (c) => [c.r, c.g, c.b];
  const ratio = (c) => {
    const a = chan(c);
    return Math.max(...a) / Math.max(Math.min(...a), 1e-9);
  };

  /* ── 1. THE PALETTE MAY NOT THROW A CHANNEL FILTER ───────────────────── */

  check('saber light: no crystal throws a light with a negligible channel', () => {
    // A light whose dimmest channel is one part in a hundred does not tint a
    // surface, it DELETES a primary from it — and with that primary goes every
    // material distinction the surface carried in it. Bronze was 96.8:1 and put
    // one part blue in a hundred on everything it lit.
    const worst = [];
    for (let i = 0; i < sabers.length; i++) {
      const s = sabers[i], name = SABER_COLORS[i].name;
      for (const [what, col] of [['key', s.light.color], ['tip', s.tipLight.color]]) {
        const a = chan(col), mn = Math.min(...a), mx = Math.max(...a);
        assert(mx > 0, `${name} ${what} light is black`);
        const share = mn / mx;
        // A hair under, for floating point: floorChannels multiplies before it
        // compares, so the result can land a few ulp below the constant.
        assert(share >= Saber.FLOOR_CHANNEL - 1e-6,
          `${name} ${what} light has a dimmest channel at ${(share * 100).toFixed(2)}% of its `
          + `brightest — under the ${(Saber.FLOOR_CHANNEL * 100).toFixed(0)}% floor, so a surface `
          + 'lit by it loses that primary entirely');
        worst.push([name, share]);
      }
    }
    worst.sort((a, b) => a[1] - b[1]);
    return `worst is ${worst[0][0]} at ${(worst[0][1] * 100).toFixed(1)}% `
      + `(floor ${(Saber.FLOOR_CHANNEL * 100).toFixed(0)}%), ${sabers.length} crystals`;
  });

  check('saber light: the floor is a floor, not a desaturation', () => {
    // A lerp toward white would move colours that were never the problem. Ivory
    // (1.1:1) and Void (4.1:1) are already inside the floor and must come out of
    // _applyColour completely untouched, or the floor is quietly a saturation
    // control and every crystal in the game is paler than it was authored.
    let untouched = 0;
    for (let i = 0; i < sabers.length; i++) {
      const s = sabers[i], name = SABER_COLORS[i].name;
      const hue = s.hue.clone();
      const a = chan(hue), mn = Math.min(...a), mx = Math.max(...a);
      if (mn / mx < Saber.FLOOR_CHANNEL) continue;
      untouched++;
      for (const k of ['r', 'g', 'b']) {
        near(s.light.color[k], hue[k], 1e-9,
          `${name} is already inside the floor but its ${k} moved — the floor is desaturating`);
      }
    }
    assert(untouched >= 2, 'no crystal was inside the floor, so this check proved nothing');
    return `${untouched} crystals already inside the floor, all unmoved`;
  });

  check('saber light: the floor never darkens a channel', () => {
    // max(), not clamp() and not a rescale. If this ever became a two-sided
    // squeeze it would pull the BRIGHT channel down and quietly dim every blade
    // in the game while every ratio in this file still passed.
    for (let i = 0; i < sabers.length; i++) {
      const s = sabers[i], name = SABER_COLORS[i].name;
      const before = chan(s.hue), after = chan(s.light.color);
      for (let k = 0; k < 3; k++) {
        assert(after[k] >= before[k] - 1e-9,
          `${name} channel ${k} went DOWN under the floor (${before[k].toFixed(4)} -> ${after[k].toFixed(4)})`);
      }
      near(Math.max(...after), Math.max(...before), 1e-9,
        `${name} peak channel moved — the floor must leave the brightest channel alone`);
    }
    return 'every channel rises or holds; peaks unchanged';
  });

  /* ── 2. THE EMITTER IS NOT THE LIGHT ─────────────────────────────────── */

  check('saber light: the floor stops at the light and never reaches the emitter', () => {
    // The floor is a statement about what a light may do to other people's
    // materials. The blade, the trail and the hilt jewel ARE the crystal, and a
    // floored emitter would wash out the one thing that carries the colour —
    // and would do it invisibly, since both live behind the same _applyColour.
    for (let i = 0; i < sabers.length; i++) {
      const s = sabers[i], name = SABER_COLORS[i].name;
      const hue = chan(s.hue);
      const blade = chan(s.bladeMat.uniforms.uHue.value);
      const trail = chan(s.trailMat.uniforms.uHue.value);
      for (let k = 0; k < 3; k++) {
        near(blade[k], hue[k], 1e-9, `${name} blade hue has been floored`);
        near(trail[k], hue[k], 1e-9, `${name} trail hue has been floored`);
      }
    }
    // and it has to still be true after a live colour change, which is the path
    // the forge and the boon table actually use.
    const s = sabers[0];
    s.setColor(6);                                   // Bronze, the worst case
    assert(ratio(s.bladeMat.uniforms.uHue.value) > 20,
      'after setColor the blade emitter came back floored');
    assert(ratio(s.light.color) <= 1 / Saber.FLOOR_CHANNEL + 1e-6,
      'after setColor the thrown light came back UN-floored');
    s.setColor(0);
    return 'emitter keeps the crystal, light keeps the floor, across setColor';
  });

  /* ── 3. THE CORE NEUTRALISATION IS A CHROMA MOVE, NOT A BRIGHTNESS ONE ─ */

  check('saber light: neutralising the core holds its luminance exactly', () => {
    // This is the one that would ship a repeat of the chroma-inversion bug. The
    // shader mixes the core lobe toward vec3(dot(uHue, LUMA)) — the hue's own
    // luminance — precisely so that CORE_WHITE moves chroma and NOTHING else. A
    // future edit to vec3(1.0) would look like the same idea, would read as a
    // "lift toward white", and would make the bloom veil BRIGHTER as well as
    // paler, at which point no measurement could say which half did the work.
    const src = readFileSync(SRC, 'utf8');
    assert(/vec3 hueN = vec3\(dot\(uHue, vec3\(0\.2126, 0\.7152, 0\.0722\)\)\);/.test(src),
      'the core neutralisation target is no longer the hue own luminance');
    assert(!/mix\(uHue, vec3\(1\.0\)/.test(src),
      'the core lobe is being mixed toward WHITE, which adds radiance the bloom pass will spend');
    const L = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (let i = 0; i < sabers.length; i++) {
      const hue = chan(sabers[i].hue), l = L(hue);
      // the shader's mix, evaluated here at full strength
      const mixed = hue.map((v) => v + (l - v) * 1.0);
      near(L(mixed), l, 1e-9,
        `${SABER_COLORS[i].name}: neutralising the core changed its luminance`);
    }
    assert(Saber.CORE_WHITE > 0 && Saber.CORE_WHITE <= 1,
      `CORE_WHITE is ${Saber.CORE_WHITE}, outside 0..1`);
    return `CORE_WHITE ${Saber.CORE_WHITE}, luminance held for all ${sabers.length} crystals`;
  });

  check('saber light: the core is still the lobe worth neutralising', () => {
    // CORE_WHITE only earns its place because the core carries most of the
    // blade's flux. The line integral of a gaussian is amp x sigma, so that is
    // the weighting. If PROFILE is ever rebalanced so the core is a minority of
    // the flux, neutralising it stops being the lever and this must say so
    // rather than let the fix quietly become a no-op.
    const P = Saber.PROFILE;
    const flux = P.amp.map((a, i) => a * P.width[i]);
    const total = flux.reduce((a, b) => a + b, 0);
    const share = flux[0] / total;
    assert(share > 0.5,
      `the core lobe is only ${(share * 100).toFixed(0)}% of the blade flux — CORE_WHITE is aimed `
      + 'at the wrong lobe now');
    // …and the GLOW lobe must stay ABOVE the bloom threshold, because that is
    // what keeps the halo coloured once the core has gone neutral. A blade whose
    // bloom is entirely white is not a lightsaber.
    const eng = readFileSync(ENGINE_SRC, 'utf8');
    const m = eng.match(
      /new UnrealBloomPass\(\s*new THREE\.Vector2\([^)]*\)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
    assert(m, 'could not find the bloom pass constructor in Engine.js to read its threshold');
    const threshold = Number(m[3]);
    assert(P.amp[1] > threshold * 1.5,
      `the glow lobe (${P.amp[1]}) is not clear of the bloom threshold (${threshold}) — the blade `
      + 'core is neutral now, so if the glow lobe stops blooming the halo has no colour left');
    return `core ${(share * 100).toFixed(0)}% of flux, glow lobe ${P.amp[1]} vs bloom threshold ${threshold}`;
  });

  /* ── 4. THE NEAR FIELD, PINNED BECAUSE IT WAS DELIBERATELY LEFT ALONE ── */

  check('saber light: the near field is 1/r and unbounded, on measured purpose', () => {
    /* This is a decision, not an oversight, and it is pinned so it cannot drift
     * either way.
     *
     * A 1.15 m line source is not a point at half a metre and 1/r diverges, so
     * bounding the near field is a reasonable thing to want. But the bound has
     * to be at the emitter's own radius to be physical, and the blade's widest
     * lobe is 105 mm of sigma — a bound there changes nothing at the 0.47 m a
     * chest actually sits at. Cutting the intensity at 0.5 m is therefore not a
     * near-field bound, it is just less light, and it was measured as such:
     * putting BOTH lights at 60% moved the wielder's R/B from 0.583 to 0.607
     * against a retracted control of 0.998 — 6% of the gap, for 40% of what the
     * blade throws on the world. The bloom halo was the problem, not the throw.
     *
     * It does help the cast shadow (R/B 1.059 -> 1.177 of an unlit 1.611, and
     * the shadow's lift drops from 1.21x to 1.14x), and that is the one thing
     * that would argue for it. It was still not taken: the brief on this weapon
     * is that it must go on lighting the world, and the floor in _applyColour
     * buys most of the same warmth back for none of the reach.
     *
     * So the rig is unchanged and these numbers record what it does. */
    const s = sabers[0];
    assert(s.light.decay === 1 && s.tipLight.decay === 1,
      'the saber lights are no longer 1/r — the whole near/far balance moved');
    assert(s.light.castShadow === false && s.tipLight.castShadow === false,
      'a saber light casts shadows now: that is a shadow map per blade per wave, and it also '
      + 'changes the cast-shadow finding this file records');

    // Drive it like a frame so the cutoff below is the one _updateVisuals
    // actually wrote, not the constructor's placeholder.
    s.ignite(); s.ignition = 1;
    const q = new THREE.Quaternion(), pos = new THREE.Vector3(0, 1.1, 0);
    for (let k = 0; k < 6; k++) { s.setHiltPose(pos, q); s.update(1 / 60, k / 60); }
    const len = s.bladeLength;
    const cutoff = 5.6 + len * 3.6;
    near(s.light.distance, cutoff, 1e-6,
      `the key light cutoff is ${s.light.distance.toFixed(2)} m, not the 5.6 + len*3.6 this assumes`);
    const I = 5.4;
    const at = (d) => I * attenuation(d, cutoff, 1);
    const near05 = at(0.5), near15 = at(1.5), far30 = at(3.0);
    // Pure 1/r inside the window: the ratio across 0.5 -> 3.0 m is 6 before the
    // cutoff window bends it. If someone changes decay, intensity or the cutoff
    // formula, one of these moves.
    assert(near05 / far30 > 5.2 && near05 / far30 < 6.4,
      `the 0.5 m : 3.0 m irradiance ratio is ${(near05 / far30).toFixed(2)}, not the ~6 that 1/r gives`);
    assert(near05 > 9.5 && near05 < 11.5,
      `a chest at 0.5 m now takes ${near05.toFixed(2)} units from the key light, not the ~10.7 measured`);
    assert(far30 > 1.3,
      `the blade only throws ${far30.toFixed(2)} at three metres — it has stopped lighting the world`);
    return `${near05.toFixed(1)} at 0.5 m, ${near15.toFixed(1)} at 1.5 m, ${far30.toFixed(1)} at 3 m`;
  });

  /* ── 5. A SURFACE HALF A METRE AWAY KEEPS A MATERIAL ─────────────────── */

  check('saber light: a surface at 0.5 m keeps a readable difference in every channel', () => {
    /* The property the floor exists for, stated end to end rather than as a
     * ratio on the light.
     *
     * Two cloth tones off the robe palette, half a metre from the blade, lit by
     * it and nothing else. What must survive is that they are still TELLABLE
     * APART in the blade's dimmest channel — because that is the channel a
     * crystal filter annihilates, and once two materials land on the same value
     * there the figure is one colour at different brightnesses.
     *
     * The bar is the 8-bit quantum. Anything the renderer cannot resolve into
     * two different bytes is not a difference. */
    // ROBE_COLORS outers, converted ONCE into the working space. Typed rather
    // than imported because Bodies.js is another lane's file, and stated to four
    // places because approximating them is how the arithmetic in _applyColour
    // went wrong in the first place.
    const A = [0.3372, 0.2346, 0.1356];   // 'Sand'  0x9d8567
    const B = [0.1022, 0.0595, 0.0296];   // 'Umber' 0x5a4530
    const E = 5.4 * attenuation(0.5, 5.6 + 1.15 * 3.6, 1);
    const EXPOSURE = 0.68;             // Engine's tone-mapping exposure
    const QUANTUM = 1 / 255;
    const bad = [];
    for (let i = 0; i < sabers.length; i++) {
      const L = chan(sabers[i].light.color);
      const dim = L.indexOf(Math.min(...L));
      // Lambert, the renderer's own BRDF normalisation, straight on.
      const a = A[dim] * L[dim] * E / Math.PI * EXPOSURE;
      const b = B[dim] * L[dim] * E / Math.PI * EXPOSURE;
      // ACES only compresses, so pre-curve separation is the generous bound:
      // if it fails here it certainly fails on screen.
      if (Math.abs(a - b) < QUANTUM) bad.push(`${SABER_COLORS[i].name} (${(a - b).toExponential(1)})`);
    }
    assert(!bad.length,
      'these crystals collapse two robe tones onto one value in their dimmest channel at 0.5 m: '
      + bad.join(', '));
    // and prove the check has teeth: with the floor removed, the worst crystal
    // must actually fail it.
    const raw = sabers[6].hue.clone();               // Bronze, 96.8:1
    const rc = [raw.r, raw.g, raw.b];
    const d = rc.indexOf(Math.min(...rc));
    const gap = Math.abs(A[d] - B[d]) * rc[d] * E / Math.PI * EXPOSURE;
    assert(gap < QUANTUM,
      'the un-floored worst case now PASSES this check, so the check no longer proves the floor '
      + `does anything (gap ${gap.toExponential(2)})`);
    return `all ${sabers.length} crystals resolve two robe tones in their dim channel; `
      + `un-floored Bronze does not (${gap.toExponential(1)} vs quantum ${QUANTUM.toExponential(1)})`;
  });

  for (const s of sabers) s.dispose();
}
