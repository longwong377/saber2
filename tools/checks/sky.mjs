/**
 * The sky, the deck that hangs in it, and what distance dissolves into.
 *
 * Every fault pinned here rendered without an error and looked like a
 * defensible frame, which is why all four shipped:
 *
 *   · 42.3% of the arena's sky hemisphere rendered ABOVE the bloom pass's 1.8
 *     threshold. Bloom is a highlight effect; handed half the frame as a source
 *     it is a veil. Measured on the deployed frame: the rim wall read 0.441
 *     display luminance with bloom off and 0.782 with it on, and the spire at
 *     60 m went 0.321 → 0.866. The landscape was not being bleached by fog or
 *     by albedo. It was being bleached by bloom.
 *   · scene.fog was anchored to the PHYSICAL skyline at linear 3.19 while the
 *     same skyline DREW at 1.50, so everything at distance converged on
 *     something twice as bright as the sky standing over it.
 *   · the inscatter term was an unbounded sum. The forward lobe peaks at 6.0,
 *     which put the fully-fogged tone a quarter above the fog colour itself —
 *     distance bleaching rather than receding.
 *   · cloudLit/cloudDark were authored sRGB swatches used as absolute radiance.
 *     The arena's 0xa89880 pinned a thick cloud at linear 0.145 against a sky
 *     behind it at 1.49. A cloud an order of magnitude darker than the sky is a
 *     hole, and a brown one is a smoke smear.
 *
 * These are numeric checks against the engine's own exported derivations, not
 * transcriptions of them — a transcription is how the last set drifted.
 */

import * as THREE from 'three';
import {
  skyRadiance, skyShoulder, sunDirection, atmosphereMeter,
  skyDisplayShoulder, hazeRadiance, cloudLight, SKY_PHYSICAL, AERIAL,
} from '../../src/engine/Engine.js';
import { SkyDome } from '../../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';

const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const sat = (c) => {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  return mx <= 1e-6 ? 0 : (mx - mn) / mx;
};
/* Derived from LEVEL_ORDER and not from Object.keys: the roster is the ordered
 * list, and a level parked in LEVELS without being in it is not in the game. */
const OUTDOOR = LEVEL_ORDER.filter((k) => LEVELS[k]?.atmosphere?.sky !== false);

/* ── the tone curve, because saturation is a DISPLAY quantity ──────────────
 *
 * Chroma is not a property of the radiance the shader writes, it is a property
 * of the pixel: ACES desaturates as it approaches its shoulder, by design and
 * by construction — the RRT fit is applied in the ACES AP1 primaries with a
 * matrix in and a matrix out, so the three channels converge as they climb.
 * A sky measured in linear therefore says nothing about whether the sky on
 * screen has a hue, and that is the whole of the "0.046 saturated" complaint.
 *
 * Transcribed from three's own chunk rather than from memory, and the
 * transcription is PINNED against the chunk below — the Narkowicz
 * approximation that tools/skyprobe.mjs uses is per-channel and misses exactly
 * the effect being measured here. */
const ACES_FIT = (v) => (v * (v + 0.0245786) - 0.000090537)
  / (v * (0.983729 * v + 0.432951) + 0.238081);
const SRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function toDisplay(c, exposure) {
  const k = exposure / 0.6;
  const r = c.r * k, g = c.g * k, b = c.b * k;
  // ACESInputMat, columns as GLSL's mat3() takes them
  const R = ACES_FIT(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const G = ACES_FIT(0.07600 * r + 0.90834 * g + 0.01566 * b);
  const B = ACES_FIT(0.02840 * r + 0.13383 * g + 0.83777 * b);
  const cl = (v) => SRGB(Math.min(Math.max(v, 0), 1));
  return new THREE.Color(
    cl(1.60475 * R - 0.53108 * G - 0.07367 * B),
    cl(-0.10208 * R + 1.10813 * G - 0.00605 * B),
    cl(-0.00327 * R - 0.07276 * G + 1.07602 * B));
}

/** The band of dome a level camera actually shows: 3°–35°, all bearings. */
const SKY_BAND = (() => {
  const dirs = [];
  for (let i = 0; i < 14; i++) {
    const el = ((3 + (i + 0.5) * (32 / 14)) * Math.PI) / 180;
    for (let k = 0; k < 36; k++) {
      const az = ((k + 0.5) / 36) * Math.PI * 2;
      dirs.push(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)));
    }
  }
  return dirs;
})();

/** The brightest the drawn dome gets anywhere, disc excluded. */
function drawnMax(a) {
  const sun = sunDirection(a), s = skyDisplayShoulder(a);
  let mx = 0;
  for (let el = 0.5; el <= 90; el += 1.5) {
    const e = (el * Math.PI) / 180, si = Math.sin(e), co = Math.cos(e);
    for (let k = 0; k < 24; k++) {
      const az = (k / 24) * Math.PI * 2;
      const d = new THREE.Vector3(co * Math.cos(az), si, co * Math.sin(az));
      mx = Math.max(mx, lum(skyShoulder(skyRadiance(d, sun, a, new THREE.Color()), s.knee, s.ceil)));
    }
  }
  return mx;
}

export function run({ check, assert, near }) {

  /* ══ the dome is not a bloom source ═══════════════════════════════════ */

  check('sky: the drawn dome stays under the bloom threshold, everywhere', () => {
    // UnrealBloomPass is constructed at 1.8 and every VFX in the game is
    // authored against that number — Particles.js pins sparks at 1.50 against
    // it by name, Saber.js the blade. So the threshold cannot move, and the
    // sky is what has to come down. The sun DISC is added after the shoulder
    // and must stay above it: it is the one thing in the sky that should bloom.
    const THRESHOLD = 1.8;
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const s = skyDisplayShoulder(a);
      const mx = drawnMax(a);
      assert(s.ceil < THRESHOLD, `${key}: the drawn ceiling is ${s.ceil.toFixed(2)} against a bloom threshold of ${THRESHOLD}`);
      assert(mx < THRESHOLD, `${key}: the sky reaches ${mx.toFixed(2)} — half the frame is a bloom source`);
      // and the disc, which applyAtmosphere sets to 9x the ceiling
      assert(s.ceil * 9 > THRESHOLD * 1.5,
        `${key}: the sun disc at ${(s.ceil * 9).toFixed(2)} would barely clear the threshold`);
      rows.push(`${key} ceil ${s.ceil.toFixed(2)} max ${mx.toFixed(2)} disc ${(s.ceil * 9).toFixed(1)}`);
    }
    return rows.join(', ');
  });

  check('sky: compressing the dome does not flatten it', () => {
    // The exponential shoulder this replaced was within a per cent of its
    // ceiling two spans past the knee, so once the ceiling came down to where
    // the drawn sky lives the entire dome from the skyline to 50° elevation —
    // over two stops of real modelling — came out inside 6%. One flat card.
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a), s = skyDisplayShoulder(a);
      const at = (el, az) => {
        const e = (el * Math.PI) / 180;
        return lum(skyShoulder(skyRadiance(
          new THREE.Vector3(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az)),
          sun, a, new THREE.Color()), s.knee, s.ceil));
      };
      const zen = at(89, 0);
      const bear = Math.atan2(sun.z, sun.x);
      const low = at(2, bear + Math.PI / 2), mid = at(35, bear + Math.PI / 2);
      assert(low / zen > 1.35, `${key}: skyline is only ${(low / zen).toFixed(2)}× the zenith`);
      // and the middle of the dome has to sit BETWEEN them, not pinned to
      // either end — that is the part the exponential lost
      assert(mid > zen * 1.08 && mid < low * 0.97,
        `${key}: mid-sky ${mid.toFixed(3)} against zenith ${zen.toFixed(3)} and skyline ${low.toFixed(3)}`);
      rows.push(`${key} ${zen.toFixed(2)}/${mid.toFixed(2)}/${low.toFixed(2)} (${(low / zen).toFixed(1)}:1)`);
    }
    return rows.join(', ');
  });

  check('sky: a level that authors a saturated sky DRAWS one', () => {
    /* NOTHING HELD THIS, AND IT WAS FALSE ON SIX LEVELS OUT OF EIGHT.
     *
     * Geonosis authors `skyColor: 0xd9a058` and rendered a sky measuring 0.071
     * saturated. Kamino's card says "at night, in the rain"; it rendered at
     * 0.046 against its own reference plate
     * (assets/reference/maps/kamino/kamino outside.webp) at 0.667. The check
     * one file over — cel's "the ground converges on the sky's own hue" —
     * passed throughout, because the ground DID converge on the sky: nothing
     * anywhere held that the sky still HAD a hue to converge on.
     *
     * Two mechanisms took it, and they compound. The display shoulder
     * (skyDisplayShoulder) is per-channel and asymptotic, so a sky far above
     * its ceiling comes out with all three channels on the ceiling — grey by
     * construction. And ACES desaturates as it climbs its shoulder. The
     * flat-metered engine drove every level's sky up that shoulder: a level
     * authored dark was metered up until its sky sat where chroma dies.
     *
     * MEASURED HERE ON THE BAND A LEVEL CAMERA SHOWS, in display, before and
     * after (shipped-old → now):
     *
     *     scoria    0.220 → 0.323     drifts     0.174 → 0.174
     *     mustafar  0.230 → 0.239     alpine     0.055 → 0.067
     *     kamino    0.075 → 0.154     wood       0.065 → 0.088
     *     geonosis  0.202 → 0.256     colosseum  0.082 → 0.082
     *
     * — the Shifting Waste and the Colosseum do not move, and that is correct:
     * they are the two levels whose metered correction already fell inside
     * METER_TRIM, i.e. the two the meter never had to bend.
     */
    const rows = [];
    const shares = [], ctlShares = [], sats = [], ctlSats = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const m = atmosphereMeter(a);
      const sun = sunDirection(a);
      const disp = skyDisplayShoulder(a, m);
      /* THE CONTROL, AND IT IS THE ENGINE AS IT SHIPPED — built out of the
       * meter's own numbers so there is no second copy of the old rule in
       * here. `rawTrim` is the correction before METER_TRIM bounded it, and
       * passing `key: null` takes skyDisplayShoulder's interior path, which is
       * the CAP ALONE — `SKY_CLIP / exposure`, which is exactly what the drawn
       * ceiling used to be for every level. Both halves of the old behaviour,
       * neither of them retyped. */
      const ctlExp = Math.min(Math.max((a.exposure ?? 1.05) * m.rawTrim, 0.2), 3);
      const ctl = skyDisplayShoulder(a, { ...m, exposure: ctlExp, key: null });

      let s = 0, sc = 0, sp = 0;
      const c = new THREE.Color();
      for (const d of SKY_BAND) {
        const raw = skyRadiance(d, sun, a, new THREE.Color());
        s += sat(toDisplay(skyShoulder(c.copy(raw), disp.knee, disp.ceil), m.exposure));
        sc += sat(toDisplay(skyShoulder(c.copy(raw), ctl.knee, ctl.ceil), ctlExp));
        // …and what the atmosphere itself produces, through the physical pair
        // the light transport uses. That is the chroma there is to keep.
        sp += sat(skyShoulder(c.copy(raw)));
      }
      const n = SKY_BAND.length;
      s /= n; sc /= n; sp /= n;
      const share = s / Math.max(sp, 1e-6), ctlShare = sc / Math.max(sp, 1e-6);
      shares.push(share); ctlShares.push(ctlShare); sats.push(s); ctlSats.push(sc);

      /* THE FLOOR, and where 0.118 comes from. Two readings put it in the same
       * place and neither is a taste call:
       *
       *  · IT SEPARATES THE TWO ENGINES. The worst level the flat-metered
       *    control draws keeps 0.105 of its own sky's chroma (the White Pass;
       *    the Drowned Wood is 0.110). The worst the shipped one draws keeps
       *    0.126 (the White Pass and the Colosseum). 0.118 is the geometric
       *    midpoint of 0.110 and 0.126, so the control fails and the roster
       *    passes, each with about a tenth of margin.
       *  · IT IS WHERE A SKY STOPS HAVING A HUE. At that share these skies
       *    measure 0.06–0.07 saturated on screen, which is `hoth.jpeg` — the
       *    ONE plate in assets/reference/ that is a genuine whiteout, at 0.048.
       *    Under the flat meter the White Pass and the Drowned Wood were both
       *    there, and a swamp is not a whiteout.
       */
      assert(share > 0.118,
        `${key}: the drawn sky keeps ${(share * 100).toFixed(1)}% of the chroma its own atmosphere `
        + `makes (${s.toFixed(3)} against ${sp.toFixed(3)}) — the sky has been drawn grey`);
      // …and the level's own authored swatch is not a decoration either: a
      // level that states a saturated sky may not draw a neutral one.
      const authored = sat(new THREE.Color(a.skyColor ?? 0xbcd8ff));
      assert(s > authored * 0.12,
        `${key}: \`skyColor\` is ${authored.toFixed(2)} saturated and the dome draws ${s.toFixed(3)}`);
      /* THE CHANGE MAY NOT COST A LEVEL ITS HUE. Two levels are unmoved by
       * construction — the Colosseum lands on 1.0000 of the control — and the
       * Shifting Waste gives up 0.03%, because anchoring the drawn ceiling to
       * its own key takes it from 1.218 to 1.170 and a slightly lower ceiling
       * compresses slightly harder. 0.99 is a hair of room around "unmoved";
       * anything a viewer could see is a regression and fails. */
      assert(s > sc * 0.99,
        `${key}: the shipped sky is ${s.toFixed(3)} saturated against ${sc.toFixed(3)} for the `
        + 'flat-metered control — the bound has cost this level its hue');
      rows.push(`${key} ${sc.toFixed(3)}→${s.toFixed(3)} (${(share * 100).toFixed(0)}% of ${sp.toFixed(2)})`);
    }
    /* AND THE BOUND IS NOT DECORATIVE: the control has to fail the floor, and
     * it has to fail it on the WORST level rather than on average, because an
     * average can be carried by the two levels that never moved. */
    assert(Math.min(...ctlShares) < 0.118,
      `the flat-metered control keeps ${(Math.min(...ctlShares) * 100).toFixed(1)}% at its worst, `
      + 'which is inside the floor above — so the floor is not what is holding the sky up');
    const mean = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
    assert(mean(sats) > mean(ctlSats) * 1.15,
      `the roster averages ${mean(sats).toFixed(3)} saturated against a control at `
      + `${mean(ctlSats).toFixed(3)} — the change buys under 15% and is not worth its lines`);

    // The transcription of ACES above is pinned against the chunk it copies.
    const tm = THREE.ShaderChunk.tonemapping_pars_fragment;
    for (const lit of ['0.0245786', '0.000090537', '0.983729', '0.4329510', '0.238081',
      '0.59719', '0.35458', '0.83777', '1.60475', '1.07602', 'toneMappingExposure / 0.6']) {
      assert(tm.indexOf(lit) >= 0,
        `three's ACES fit no longer contains ${lit} — the display transform above is a copy of a `
        + 'curve the renderer has stopped running');
    }
    return rows.join('; ');
  });

  check('sky: light transport still sees the real sky, not the drawn one', () => {
    // The compression is a DISPLAY transform. The exposure meter and the
    // environment probe have to keep the full range or the image-based light
    // loses its direction, which is the fault _linearSky was written to fix in
    // the first place.
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const s = skyDisplayShoulder(a);
      assert(s.ceil < SKY_PHYSICAL.ceil * 0.35,
        `${key}: the drawn ceiling ${s.ceil.toFixed(2)} is not meaningfully below the physical one`);
      const sun = sunDirection(a);
      const flat = sun.clone().setY(0.03).normalize();
      const phys = lum(skyShoulder(skyRadiance(flat, sun, a, new THREE.Color())));
      assert(phys > s.ceil * 2.5,
        `${key}: transport sees ${phys.toFixed(2)} against a drawn ${s.ceil.toFixed(2)} — the two have merged`);
      // and the meter is untouched by any of it
      const m = atmosphereMeter(a);
      assert(m.exposure > 0.2 && m.exposure < 3, `${key} exposure ${m.exposure}`);
    }
    return OUTDOOR.map((k) => {
      const s = skyDisplayShoulder(LEVELS[k].atmosphere);
      return `${k} draw ≤${s.ceil.toFixed(2)} / transport ≤${SKY_PHYSICAL.ceil}`;
    }).join(', ');
  });

  /* ══ what distance converges on ═══════════════════════════════════════ */

  check('fog: distance dissolves into what the dome draws, never past it', () => {
    // A passive surface behind a scattering medium cannot come out brighter
    // than the medium, and the medium cannot come out brighter than the sky it
    // is a piece of. Anchored to the physical skyline the arena fog measured
    // 3.19 against a drawn skyline of 1.50.
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a), s = skyDisplayShoulder(a);
      const side = sun.clone().setY(0).normalize()
        .cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
      const drawn = lum(skyShoulder(skyRadiance(side, sun, a, new THREE.Color()), s.knee, s.ceil));
      const fog = hazeRadiance(a, new THREE.Color());
      // "Never past it" is the hard half and is asserted as such; the floor is
      // loose because the renormalisation is clamped, and a wildly authored
      // swatch is allowed to land short of the skyline. It is not allowed to
      // land beyond it — that is the thing that cannot physically happen.
      assert(lum(fog) <= drawn * 1.02,
        `${key}: distance converges on ${lum(fog).toFixed(2)} against a drawn skyline of ${drawn.toFixed(2)} `
        + '— a surface behind a medium cannot exceed the medium');
      assert(lum(fog) > drawn * 0.5,
        `${key}: the haze is ${lum(fog).toFixed(2)} under a ${drawn.toFixed(2)} skyline — a dark band under a bright sky`);
      // it still has to be a haze and not the authored swatch replayed
      const authored = new THREE.Color(a.fogColor ?? 0xc9b391);
      assert(sat(fog) < sat(authored) * 0.75,
        `${key}: the haze is ${sat(fog).toFixed(2)} saturated against an authored ${sat(authored).toFixed(2)} `
        + '— it has taken no chroma from the sky');
      rows.push(`${key} fog ${lum(fog).toFixed(2)} = skyline ${drawn.toFixed(2)}, sat ${sat(authored).toFixed(2)}→${sat(fog).toFixed(2)}`);
    }
    return rows.join('; ');
  });

  check('aerial: the sunward glow is energy-limited, so distance converges', () => {
    // The chunk's arithmetic, evaluated here. Added raw the forward lobe put
    // 0.79 on top of a 3.19 fog colour; the exponential cap makes it an
    // asymptote at a quarter above the fog, whatever the phase function does.
    const src = THREE.ShaderChunk.fog_fragment;
    assert(/vec3 fogCap = max\( fogColor, vec3\( 1\.0e-4 \) \) \* 0\.26;/.test(src),
      'the inscatter cap is gone — the glow is an unbounded sum again');
    assert(/fogTone \+= fogCap \* \( 1\.0 - exp\( - fogGlow \/ fogCap \) \);/.test(src),
      'the glow is not being folded in through the shoulder');

    const g = 0.50, g2 = g * g;
    const phase = (c) => (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * c, 1e-4), 1.5);
    const lobe = (c) => phase(c) + 0.75 * (1 + c * c) * 0.16;
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a);
      const side = sun.clone().setY(0).normalize()
        .cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
      const flat = sun.clone().setY(0.03).normalize();
      const gain = Math.min(Math.max(
        lum(skyShoulder(skyRadiance(flat, sun, a, new THREE.Color())))
        - lum(skyShoulder(skyRadiance(side, sun, a, new THREE.Color()))), 0), 12);
      const w = a.inscatter ?? gain * 0.028;
      const fog = hazeRadiance(a, new THREE.Color());
      // unit-luminance tint, exactly as applyAtmosphere builds it
      const tone = (c) => {
        const glow = w * lobe(c);            // per-channel tint is ~1 in luminance
        const cap = lum(fog) * 0.26;
        return lum(fog) + cap * (1 - Math.exp(-glow / cap));
      };
      const toward = tone(1), away = tone(-1);
      assert(toward <= lum(fog) * 1.27,
        `${key}: looking into the sun the haze reaches ${(toward / lum(fog)).toFixed(2)}× the fog colour`);
      // …but it must still GLOW, or the cap has simply switched the effect off
      assert(toward > away * 1.06,
        `${key}: sunward ${toward.toFixed(3)} vs anti-sun ${away.toFixed(3)} — the lobe is gone`);
      rows.push(`${key} w ${w.toFixed(3)} → ${(toward / lum(fog)).toFixed(2)}×/${(away / lum(fog)).toFixed(2)}×`);
    }
    return rows.join(', ');
  });

  /* ══ the deck ═════════════════════════════════════════════════════════ */

  check('clouds: a cloud is a white body, and the swatches are only its hue', () => {
    // The fault: cloudLit/cloudDark were sRGB colours used as radiance, so the
    // level author was setting the deck's LEVEL by accident. Feed configure a
    // swatch four stops apart in luminance and the uniforms must not move in
    // level at all — only in cast.
    const dome = new SkyDome(new THREE.Scene());
    const u = dome.mat.uniforms;
    const base = { ...LEVELS.colosseum.atmosphere };
    dome.configure({ ...base, cloudDark: 0x101014, cloudLit: 0x202018 });
    const darkL = lum(u.uCloudDark.value), litL = lum(u.uCloudLit.value);
    dome.configure({ ...base, cloudDark: 0xf0f0ff, cloudLit: 0xfffff0 });
    near(lum(u.uCloudDark.value), darkL, 1e-6, 'a four-stop swatch change moved the shadowed LEVEL');
    near(lum(u.uCloudLit.value), litL, 1e-6, 'a four-stop swatch change moved the lit LEVEL');
    near(darkL, 1, 1e-6, 'the tints are not unit luminance');
    near(litL, 1, 1e-6, 'the tints are not unit luminance');
    // and the hue is pulled well in from the swatch — a base 0.45 saturated is
    // mud whatever its level, because a white body's only chroma is the light's
    dome.configure(base);
    const authored = new THREE.Color(base.cloudDark);
    assert(sat(u.uCloudDark.value) < sat(authored) * 0.5,
      `the shadowed tint is ${sat(u.uCloudDark.value).toFixed(2)} saturated against an authored ${sat(authored).toFixed(2)}`);
    // the lit face carries the SUN's cast, so it must not be the cold grey the
    // base is — that is the whole warm-shoulder / cold-belly reading
    assert(u.uCloudLit.value.r / u.uCloudLit.value.b > u.uCloudDark.value.r / u.uCloudDark.value.b * 1.15,
      'the lit face is no warmer than the shadowed one — the sun is not tinting it');
    dome.dispose();
    return `tints unit-luminance, dark sat ${sat(authored).toFixed(2)}→${sat(u.uCloudDark.value).toFixed(2)}, `
      + `lit R/B ${(u.uCloudLit.value.r / u.uCloudLit.value.b).toFixed(2)} vs dark ${(u.uCloudDark.value.r / u.uCloudDark.value.b).toFixed(2)}`;
  });

  check('clouds: the deck straddles the sky — lit above it, shaded below', () => {
    // A cumulus in daylight is the brightest thing in the sky short of the sun,
    // and its base is darker than the sky beside it. If both fall on the same
    // side the deck reads as either smoke (all below) or fog (all above); the
    // shipped version was 0.145 against a 1.49 sky, comprehensively below.
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const L = cloudLight(a);
      const s = skyDisplayShoulder(a);
      assert(L.sun >= s.ceil * 0.95,
        `${key}: a sunlit cloud is ${L.sun.toFixed(2)} against a sky reaching ${s.ceil.toFixed(2)}`);
      // shaded base: the shader's own terms at full thickness, no sun
      const base = L.amb * 0.55;
      assert(base < s.ceil * 0.85,
        `${key}: a shaded base at ${base.toFixed(2)} is not darker than the ${s.ceil.toFixed(2)} sky`);
      // and there has to be enough between them to read as volume
      assert(L.sun / Math.max(base, 1e-4) > 2.2,
        `${key}: lit ${L.sun.toFixed(2)} vs base ${base.toFixed(2)} is only ${(L.sun / base).toFixed(1)}:1 — flat paper`);
      // the three sources of the base, and none of them dominating outright
      assert(L.bounce > L.amb * 0.10 && L.inner > L.amb * 0.10 && L.sky > L.amb * 0.10,
        `${key}: base light is bounce ${L.bounce.toFixed(2)} / sky ${L.sky.toFixed(2)} / internal ${L.inner.toFixed(2)}`);
      /* ── THE BASE IS THE FRAME'S COLOUR, AND NOT VERY MUCH OF IT ────────
       *
       * "A turquoise cloud" is a claim about a HUE and this clause used to test
       * only a magnitude — `sat(L.tint) < 0.40` — which is the same fault
       * cel.mjs's "in its own hue" carried, in the same lane, on the same
       * illuminant. It let through exactly the frame it was written to catch:
       * shipped, GEONOSIS' base tint measured 0.245 saturated at hue 341°, a
       * MAGENTA cloud belly on a dust world whose ground is 13°, whose sky is
       * authored at 26° and whose sun is 35°. It passed with room to spare.
       *
       * It passed because 0.245 is a CANCELLATION, not a colour: the base is a
       * weighted average of the ground bounce (warm on five of the seven
       * levels), the sky (Preetham-blue on ALL of them — see Engine's
       * skyProbeTurn) and the deck's own internal scattering (white). Two
       * opposed chromas average to something small and pointed nowhere. The
       * magnitude bound was reading that cancellation and calling it grey.
       *
       * With the sky sample turned to the level's own hue the three sources
       * agree, and the numbers move the way that predicts — the tint's HUE
       * lands within 25° of the level's sky on every level, and its saturation
       * rises where the cancellation used to be:
       *
       *     level      before          after
       *     scoria     0.220 @ 235°    0.220 @  21°   (sky  11°)
       *     mustafar   0.208 @ 231°    0.208 @  18°   (sky   7°)
       *     colosseum  0.204 @ 236°    0.204 @ 244°   (sky 219°)
       *     wood       0.237 @ 224°    0.290 @  77°   (sky  96°)
       *     drifts     0.068 @ 343°    0.073 @ 337°   (sky 219°)
       *     alpine     0.389 @ 217°    0.390 @ 221°   (sky 220°)
       *     geonosis   0.245 @ 341°    0.466 @  18°   (sky  26°)
       *
       * So the clause is stated as the two things it was always trying to say.
       *
       * THE HUE, gated on there being one. Below 0.15 saturated a base has no
       * hue to be wrong about — the Shifting Waste's is 0.073, a genuinely
       * neutral belly under a pale sky — and asserting a hue there is asserting
       * on noise. 30° is not a new number: it is the bar lighting.mjs holds the
       * fill to and cel.mjs holds the shade's ambient to, and this is the third
       * term of the same sum. Four levels fail it on the shipped tree.
       *
       * THE MAGNITUDE, at the fault's own measurement. 0.51 is what the tint
       * read when it was taken straight off the dome at full chroma, which is
       * the frame this check was written from; 0.50 fails that and nothing
       * else. It is LOOSER than the 0.40 it replaces and that is deliberate and
       * costed: 0.40 was measured across a roster whose skies all disagreed
       * with their own ground, i.e. it was a bound on the cancellation. The
       * highest any level now reaches is Geonosis at 0.466 — and measured in
       * display through its own grade its thick core lands at 0.441 saturation
       * against the sky it hangs in front of at 0.439, which is a dust cloud on
       * a dust world and not a card. The hue clause is what carries the weight
       * the 0.40 was pretending to. */
      const tintSat = sat(L.tint);
      if (tintSat > 0.15) {
        const hueOf = (c) => {
          const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), d = mx - mn;
          if (d < 1e-6) return null;
          const h = mx === c.r ? ((c.g - c.b) / d + 6) % 6
            : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
          return h * 60;
        };
        const ht = hueOf(L.tint), hk = hueOf(new THREE.Color(a.skyColor ?? 0xbcd8ff));
        assert(ht !== null && hk !== null, `${key}: the base tint or the sky has no hue`);
        let off = Math.abs(ht - hk); if (off > 180) off = 360 - off;
        assert(off < 30,
          `${key}: the light on a cloud base is at ${ht.toFixed(0)}° against a sky this level `
          + `authors at ${hk.toFixed(0)}° — ${off.toFixed(0)}° apart, so the deck is lit by `
          + 'somebody else\'s sky');
      }
      assert(tintSat < 0.50,
        `${key}: the base tint is ${tintSat.toFixed(2)} saturated — that is a coloured card, not a cloud`);
      rows.push(`${key} lit ${L.sun.toFixed(2)} / sky ${s.ceil.toFixed(2)} / base ${base.toFixed(2)} `
        + `(${(L.sun / base).toFixed(1)}:1, tint sat ${tintSat.toFixed(2)})`);
    }
    return rows.join('; ');
  });

  check('clouds: the deck has a lit top, a shaded base and eroded edges', () => {
    const src = new SkyDome(new THREE.Scene()).mat.fragmentShader;
    // the levels arrive as radiance, not as a swatch
    assert(/uniform float uCloudSun;/.test(src) && /uniform float uCloudAmb;/.test(src),
      'the deck has no radiance inputs — its level is back on the authored swatches');
    assert(/uCloudLit \* uCloudSun \* sun/.test(src), 'the lit face is not driven by the sun radiance');
    assert(/uCloudDark \* uSkyAmb \* uCloudAmb \* amb/.test(src),
      'the shaded face is not driven by the ambient radiance');
    // rim erosion, weighted out of the core so the coverage calibration in
    // lighting.mjs — which ports deck() — stays valid
    assert(/float fine = fbm3\(p \* [\d.]+/.test(src) && /d -= fine \* [\d.]+ \* \(1\.0 - smoothstep/.test(src),
      'the deck outline is the level set of a smooth field — poured cream, not cloud');
    // the phase baseline has to be near 1: a white body cannot return a third
    // less light than falls on it and still read as white
    const m = src.match(/float phase = min\(([\d.]+) \+ ([\d.]+) \* hg\(cosT, ([\d.]+)\), ([\d.]+)\);/);
    assert(m, 'the phase function has changed shape');
    assert(Number(m[1]) > 0.8, `the side-lit baseline is ${m[1]} — every lit shoulder is dimmed by ${((1 - Number(m[1])) * 100).toFixed(0)}%`);
    assert(Number(m[4]) <= 2.6 && Number(m[4]) > 1.5,
      `the forward lobe is capped at ${m[4]} — a cloud crossing the sun is a white hole`);
    return `radiance-driven, rim erosion, phase ${m[1]}+${m[2]}·HG(${m[3]}) capped ${m[4]}`;
  });

  check('clouds: an interior draws no deck and gets no sky-derived light', () => {
    const dome = new SkyDome(new THREE.Scene());
    // Hangar Bay Nine was deleted at the player's request; the property is
    // about `sky: false` and not about that room, so it is asserted over EVERY
    // interior the game has rather than over one named one.
    for (const key of LEVEL_ORDER.filter((k) => LEVELS[k].atmosphere.sky === false)) {
      dome.configure(LEVELS[key].atmosphere);
      assert(!dome.mesh.visible, `${key} is an interior and must not draw a cloud deck`);
      near(cloudLight(LEVELS[key].atmosphere).amb, 0.42, 1e-9,
        `${key}: an interior must fall back to the neutral default`);
    }
    /* The named sample went with the Foundry. The loop above IS the check now
     * — it walks whatever interiors the roster has, and the roster has none,
     * so this reports the empty set rather than pretending to a subject. */
    const interiors = LEVEL_ORDER.filter((k) => LEVELS[k].atmosphere.sky === false);
    dome.dispose();
    return interiors.length
      ? `${interiors.length} interiors opt out of the deck and of the sky-derived cloud light`
      : 'no interior levels on the roster — every ground in the game is under open sky';
  });
}
