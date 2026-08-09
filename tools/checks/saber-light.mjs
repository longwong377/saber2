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

  /* ── 3b. AND SO IS THE TRAIL'S, WHICH IS THE SAME FAULT OVER MORE SCREEN ─
   *
   * The core fix above landed on the blade and was never applied to the SMEAR —
   * the same emitter, in the same hue, dragged through a whole arc. The old trail
   * shader ended `vec3 c = uHue * e`, one saturated hue at every age, while the
   * comment two lines above it said the freshest slice "whites out". It did not:
   * `hot` only ever raised the amplitude of the same 22.9:1 blue.
   *
   * Measured on the shipped profile, cerulean, all three sheets stacked: the
   * freshest slice reaches linear luminance 4.30 against UnrealBloomPass's 1.8
   * threshold, i.e. 2.4x over, at the full crystal chroma. Identical number,
   * identical mechanism and identical ratio to the pre-fix core.
   *
   * The three checks below pin the fix as a SHAPE rather than as a constant: what
   * blooms must be near-neutral, what carries the colour must be under the line
   * where ACES can keep it, and the width slider must reach both. Each one is
   * shown to have teeth by re-running its own arithmetic on the old behaviour.
   */

  /** The trail shader's own source, so the model below cannot silently diverge. */
  const TRAIL_SRC = (() => {
    const src = readFileSync(SRC, 'utf8');
    const a = src.indexOf('const TRAIL_FRAG');
    const b = src.indexOf('export class Saber');
    assertOrThrow(a > 0 && b > a, 'TRAIL_FRAG is no longer where this file looks for it');
    return src.slice(a, b);
  })();
  function assertOrThrow(c, m) { if (!c) throw new Error(m); }

  /** UnrealBloomPass's threshold, read from the pass's own constructor call. */
  const BLOOM_THRESHOLD = (() => {
    const eng = readFileSync(ENGINE_SRC, 'utf8');
    const m = eng.match(
      /new UnrealBloomPass\(\s*new THREE\.Vector2\([^)]*\)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
    assertOrThrow(m, 'could not find the bloom pass constructor in Engine.js to read its threshold');
    return Number(m[3]);
  })();

  /**
   * TRAIL_FRAG, evaluated in JS, for one age of one crystal.
   *
   * `prof`, `th` and `vPunch` are common factors of both lobes, so they cancel
   * out of the colour entirely and only scale `e`. The three sheets are additive
   * and overlap down the centre of the ribbon, so the value the bloom pass sees
   * there is the single-sheet radiance times exp(-1.3) + 1 + exp(-1.3).
   */
  const SHEET_STACK = Math.exp(-1.3) * 2 + 1;
  const L709 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  function trailAt(saber, age, coreWhite = saber.trailMat.uniforms.uCoreWhite.value,
    hot0 = saber.trailMat.uniforms.uHot.value, glow0 = saber.trailMat.uniforms.uGlow.value) {
    const fade = Math.pow(Math.max(0, 1 - age), 1.5);
    const hot = Math.pow(Math.max(0, Math.min(1, 1 - age * 2.6)), 2);
    const ec = hot0 * hot;
    const e0 = glow0 * fade + ec;
    const hue = chan(saber.trailMat.uniforms.uHue.value);
    const hueN = L709(hue);
    const k = coreWhite * (ec / Math.max(e0, 1e-5));
    const col = hue.map((v) => v + (hueN - v) * k);
    return { e0, col, lum: e0 * SHEET_STACK * L709(col),
      ratio: Math.max(...col) / Math.max(Math.min(...col), 1e-9) };
  }

  check('saber trail: what blooms is near-neutral and what keeps the crystal does not bloom', () => {
    /* THE DESIGN STATEMENT, as an inequality rather than as a constant.
     *
     * A Jedi Survivor blade is a thin white-clipping core inside a coloured halo,
     * and the colour lives in the halo. The trail is the same idea in time rather
     * than in space: the freshest slice is the core and the cooling wisp is the
     * halo. So the two claims are — over the bloom line the smear must have given
     * up its chroma, because bloom samples the LINEAR buffer before the tonemap
     * and spreads whatever it finds across a quarter of the screen; and under the
     * line it must still be the crystal, because that is the part ACES keeps and
     * it is the only thing that says which sabre this is.
     *
     * Stated on the ribbon's own age axis so it holds for any amplitude pair. */
    /* THE SHADER HAS TO BE DOING WHAT THE MODEL SAYS IT DOES. trailAt() above is
     * TRAIL_FRAG rewritten in JS, and a model that can drift from the shader it
     * models is a way of measuring nothing at all — so every constant the model
     * hardcodes is pinned to the source here, and this check failing is how a
     * shader edit tells the other two they are out of date. */
    for (const [re, what] of [
      [/float\s+fade\s*=\s*pow\(clamp\(1\.0 - vAge, 0\.0, 1\.0\), 1\.5\);/, 'the glow lobe fade'],
      [/float\s+hot\s*=\s*pow\(clamp\(1\.0 - vAge \* 2\.6, 0\.0, 1\.0\), 2\.0\);/, 'the hot lobe decay'],
      [/float\s+th\s*=\s*exp\(-vThick \* vThick \* 1\.3\);/, 'the across-sheet falloff'],
    ]) assert(re.test(TRAIL_SRC), `${what} has changed and the model in this file has not`);
    assert(/float\s+ec\s*=\s*uHot\s*\*\s*hot;/.test(TRAIL_SRC)
      && /float\s+e0\s*=\s*uGlow\s*\*\s*fade\s*\+\s*ec;/.test(TRAIL_SRC),
    'the trail no longer splits into a hot lobe and a glow lobe, so there is nothing to neutralise');
    assert(/vec3\s+col\s*=\s*mix\(uHue,\s*hueN,\s*uCoreWhite\s*\*\s*\(ec\s*\/\s*max\(e0,\s*1e-5\)\)\);/.test(TRAIL_SRC),
      'the trail is not mixing its hot lobe toward hueN in proportion to how far that lobe dominates');
    assert(/vec3\s+c\s*=\s*col\s*\*\s*e;/.test(TRAIL_SRC) && !/vec3\s+c\s*=\s*uHue\s*\*\s*e;/.test(TRAIL_SRC),
      'the trail is emitting the raw crystal hue again — the neutralised colour is computed and dropped');

    /* THE VEIL, and why it is not the worst pixel.
     *
     * A saturated component over the bloom line is DELIBERATE — the check above
     * this one requires the blade's glow lobe to stay over it, because a bloom
     * with no colour in it is not a lightsaber. So the quantity to bound is not
     * the reddest sample, it is what the pass actually spreads: the high pass
     * hands the mip chain the texel itself wherever luminance clears the
     * threshold, so the wash's colour is the ENERGY-WEIGHTED MEAN of those
     * texels. Age is a fair area weight here because the ribbon is one quad per
     * history sample and the samples are one frame apart.
     *
     * And the bound is not invented either. This veil is a wash laid over other
     * people's materials, which is precisely what FLOOR_CHANNEL exists to bound
     * on the thrown light: a source whose dimmest channel is a small enough
     * fraction of its brightest stops tinting a surface and starts deleting a
     * primary from it. The emitter is not floored — it is the crystal — but what
     * bloom smears across a quarter of the screen is not the emitter any more,
     * it is a light, and it is held to the light's standard. */
    const BOUND = 1 / Saber.FLOOR_CHANNEL;
    const bad = [], noColour = [], veils = [];
    for (let i = 0; i < sabers.length; i++) {
      const s = sabers[i], name = SABER_COLORS[i].name;
      const crystal = ratio(s.hue);
      const veil = (cw) => {
        const sum = [0, 0, 0];
        let w = 0, over = 0, n = 0;
        for (let a = 0; a <= 1.0001; a += 0.002) {
          n++;
          const t = trailAt(s, a, cw);
          if (t.lum <= BLOOM_THRESHOLD) continue;
          over++; w += t.e0;
          for (let k = 0; k < 3; k++) sum[k] += t.col[k] * t.e0;
        }
        if (!w) return { ratio: 1, over, n };
        const m = sum.map((v) => v / w);
        return { ratio: Math.max(...m) / Math.max(Math.min(...m), 1e-9), over, n };
      };
      const now = veil(Saber.CORE_WHITE), was = veil(0);
      veils.push([name, crystal, now.ratio, was.ratio]);
      if (now.ratio > BOUND) bad.push(`${name} ${now.ratio.toFixed(1)}:1`);
      // the other half: under the line the crystal has to be intact somewhere
      let seenColour = false;
      for (let a = 0; a <= 1.0001; a += 0.005) {
        const t = trailAt(s, a);
        if (t.lum <= BLOOM_THRESHOLD && t.ratio > crystal * 0.99) { seenColour = true; break; }
      }
      if (!seenColour) noColour.push(name);
      /* THE SAME AMOUNT BLOOMS, which is the luminance-holding property seen from
       * the other side and the reason the wielder A/B is readable: if the fix
       * also changed how much of the ribbon cleared the threshold, no measurement
       * on the figure could separate "less blue" from "less light".
       *
       * One sample of slack and not zero: the two luminances are equal in exact
       * arithmetic (that is what the mix toward hueN guarantees) but reach the
       * comparison down two different code paths, so a sample sitting exactly on
       * the threshold could land either side of it in the last bit. Check 2 pins
       * the equality itself; this pins the consequence without a knife edge. */
      assert(Math.abs(now.over - was.over) <= 1,
        `${name}: neutralising the smear changed how much of it clears the bloom threshold `
        + `(${was.over}/${was.n} samples -> ${now.over}/${now.n})`);
    }
    assert(!bad.length,
      'the bloom pass is still being handed a channel filter by the smear: ' + bad.join(', ')
      + ` (bound ${BOUND.toFixed(2)}:1, the same FLOOR_CHANNEL the thrown light is held to)`);
    assert(!noColour.length,
      'these crystals have no part of the smear that is both under the bloom line and still the '
      + 'crystal, so the trail has no colour left at all: ' + noColour.join(', '));

    /* AND THE CHECK HAS TEETH: the same arithmetic with the hot lobe left alone —
     * which is exactly the old `vec3 c = uHue * e` — must fail it. A check that
     * passes both ways is worth nothing. */
    const old = veils.filter(([, , , was]) => was > BOUND);
    assert(old.length >= 8,
      'un-neutralised, only ' + old.length + ' crystals fail this check, so it has stopped proving '
      + 'the neutralisation does anything');
    const [, , cn, cw0] = veils[0];
    return `cerulean's bloom veil ${cw0.toFixed(1)}:1 -> ${cn.toFixed(2)}:1, worst crystal `
      + `${Math.max(...veils.map((v) => v[2])).toFixed(2)}:1 against a ${BOUND.toFixed(2)}:1 bound; `
      + `${old.length}/${sabers.length} crystals fail it un-neutralised`;
  });

  check('saber trail: neutralising it moves colour and not one photon of bloom', () => {
    /* The trail's version of the luminance-holding property, and it is TIGHTER
     * than the blade's because of where the number is spent.
     *
     * UnrealBloomPass's high pass thresholds on three's own luminance(), whose
     * weights come from ColorManagement.getLuminanceCoefficients — the same
     * Rec.709 triple the shader mixes toward. So mixing toward hueN leaves the
     * high pass's own value bit-identical: exactly the same pixels bloom, by
     * exactly the same amount, in a different colour. That is what makes the
     * before/after on the wielder readable at all. A mix toward vec3(1.0) would
     * raise the value, bloom MORE of the ribbon, and no measurement afterwards
     * could say which half of the change did the work. */
    const w = new THREE.Vector3();
    THREE.ColorManagement.getLuminanceCoefficients(w);
    const m = TRAIL_SRC.match(
      /vec3 hueN = vec3\(dot\(uHue, vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)\)\);/);
    assert(m, 'the trail no longer neutralises toward a luminance at all');
    assert(!/mix\(uHue, vec3\(1\.0\)/.test(TRAIL_SRC),
      'the trail hot lobe is being mixed toward WHITE, which adds radiance the bloom pass will spend');
    for (const [k, got] of [[0, Number(m[1])], [1, Number(m[2])], [2, Number(m[3])]]) {
      near(got, w.getComponent(k), 5e-4,
        `the trail's neutralisation weight ${k} is not the weight UnrealBloomPass's own luminance() `
        + 'uses, so the mix changes how much blooms as well as what colour it is');
    }
    // and the consequence, at every age of every crystal
    let worst = 0;
    for (let i = 0; i < sabers.length; i++) {
      for (let a = 0; a <= 1.0001; a += 0.02) {
        const on = trailAt(sabers[i], a), off = trailAt(sabers[i], a, 0);
        if (off.lum < 1e-9) continue;
        worst = Math.max(worst, Math.abs(on.lum / off.lum - 1));
      }
    }
    assert(worst < 1e-9,
      `neutralising the trail moved its luminance by ${(worst * 100).toFixed(4)}% somewhere — this is a `
      + 'chroma fix and it is not allowed to be anything else');
    return `weights ${w.toArray().join('/')} match the bloom pass; luminance held to `
      + `${worst.toExponential(1)} across ${sabers.length} crystals x 51 ages`;
  });

  check('saber trail: the width slider reaches the smear, not only the blade', () => {
    /* THE SECOND HALF OF COMMIT 0000567, which stopped at the blade.
     *
     * That commit's finding was that bloom is driven by AMPLITUDE, not by width,
     * so a slider that scales only the gaussian sigmas cannot do what its label
     * says. It scaled the blade's glow by w and its halo by w*w and left the
     * trail's two amplitudes as absolute constants — so at the newly shipped
     * default of 0.7 the blade's halo fell to 0.735, under the 1.8 threshold,
     * while the smear sat at 5.525/2.25 exactly as on a full-width blade: on a
     * default blade the trail was BRIGHTER than the blade's own glow lobe and
     * 7.5x its halo, and the slider at minimum changed it by nothing at all.
     *
     * The exponents are not chosen. TRAIL_HOT_OF_GLOW and TRAIL_GLOW_OF_HALO
     * define the smear as a fraction of two blade lobes; a fraction of a lobe
     * inherits that lobe's exponent or it is not a fraction of it. This check is
     * that identity, at four widths, on the uniforms the shader actually reads —
     * a field nobody consumes is exactly the bug 0000567 was about. */
    const drive = (s) => {
      s.ignite(); s.ignition = 1;
      const q = new THREE.Quaternion(), pos = new THREE.Vector3(0, 1.1, 0);
      for (let k = 0; k < 4; k++) {
        s.root.rotation.z = Math.sin(k * 0.6) * 1.2;
        s.setHiltPose(pos, q); s.update(1 / 60, k / 60, null);
      }
      return s;
    };
    // near() compares with Math.abs and a NaN comparison is false, so a missing
    // constant would sail through every assertion below as an undefined ratio.
    assert(Number.isFinite(Saber.TRAIL_HOT_OF_GLOW) && Number.isFinite(Saber.TRAIL_GLOW_OF_HALO),
      'the smear is not stated as a fraction of the blade lobes any more, so there is nothing left '
      + 'to inherit their exponents and the width slider has no defined effect on it');
    const rows = [];
    for (const w of [0.45, 0.7, 1.0, 1.6]) {
      const s = drive(new Saber(new THREE.Scene(), { colorIndex: 0, coreWidth: w }));
      const amp = s.bladeMat.uniforms.uAmp.value;
      const u = s.trailMat.uniforms;
      assert(u.uCoreWhite && u.uHot && u.uGlow,
        'the trail material is missing one of uHot/uGlow/uCoreWhite');
      // The identity, on the DRAWN uniforms and not on the fields behind them.
      near(u.uHot.value / s.punch, amp.y * Saber.TRAIL_HOT_OF_GLOW, 1e-9,
        `at width ${w} the smear's hot lobe is not ${Saber.TRAIL_HOT_OF_GLOW} of the blade's glow lobe`);
      near(u.uGlow.value / s.punch, amp.z * Saber.TRAIL_GLOW_OF_HALO, 1e-9,
        `at width ${w} the smear's glow lobe is not ${Saber.TRAIL_GLOW_OF_HALO} of the blade's halo lobe`);
      assert(u.uCoreWhite.value === Saber.CORE_WHITE,
        `at width ${w} the smear's uCoreWhite is ${u.uCoreWhite.value}, not CORE_WHITE — the shader has `
        + 'the mix and nothing drives it');
      rows.push([w, u.uHot.value, u.uGlow.value, trailAt(s, 0).lum]);
      s.dispose();
    }
    const [lo, , , hi] = rows;
    // What the slider is FOR: at the bottom of its travel the smear must stop
    // blooming, and at the top it must bloom hard. Old code: 4.30 at both ends.
    assert(lo[3] < BLOOM_THRESHOLD,
      `at the minimum width the smear still reaches luminance ${lo[3].toFixed(2)} against a bloom `
      + `threshold of ${BLOOM_THRESHOLD} — the slider cannot switch its bloom off`);
    assert(hi[3] / lo[3] > 3,
      `the slider only moves the smear's peak luminance ${(hi[3] / lo[3]).toFixed(2)}x across its whole `
      + 'travel, which is not authority over anything');

    // A LIVE write, because that is the path the forge slider and the Focusing
    // Crystal boon take — the field used to be read once, at construction.
    const s = drive(new Saber(new THREE.Scene(), { colorIndex: 0, coreWidth: 1 }));
    const was = s.trailMat.uniforms.uHot.value;
    s.coreWidth *= 1.25;
    drive(s);
    near(s.trailMat.uniforms.uHot.value / was, 1.25, 1e-9,
      'moving coreWidth on a live saber did not move the smear amplitude the shader reads');
    s.coreWidth = 1; drive(s);
    near(s.trailMat.uniforms.uHot.value, was, 1e-9, 'putting the width back did not put the uniform back');
    s.dispose();

    // Teeth: the OLD constants — absolute, unscaled — fail both of the two
    // properties above, and the check must say so rather than assume it.
    const oldHot = Saber.PROFILE.amp[1] * Saber.TRAIL_HOT_OF_GLOW;
    const oldGlow = Saber.PROFILE.amp[2] * Saber.TRAIL_GLOW_OF_HALO;
    const oldLo = trailAt(sabers[0], 0, Saber.CORE_WHITE, oldHot, oldGlow).lum;
    assert(oldLo > BLOOM_THRESHOLD,
      'the un-scaled amplitudes no longer bloom at the minimum width, so this check has stopped '
      + 'proving the width scaling does anything');
    return rows.map(([w, h, g, l]) => `w${w} ${h.toFixed(2)}/${g.toFixed(2)} lum ${l.toFixed(2)}`).join(', ')
      + ` (threshold ${BLOOM_THRESHOLD}; unscaled it was ${oldLo.toFixed(2)} at every width)`;
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
