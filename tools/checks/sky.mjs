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
const OUTDOOR = Object.keys(LEVELS).filter((k) => LEVELS[k].atmosphere?.sky !== false);

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
    const base = { ...LEVELS.arena.atmosphere };
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
      // the base is grey, not blue: read straight off Preetham it was 0.51
      assert(sat(L.tint) < 0.40,
        `${key}: the base tint is ${sat(L.tint).toFixed(2)} saturated — that is a turquoise cloud`);
      rows.push(`${key} lit ${L.sun.toFixed(2)} / sky ${s.ceil.toFixed(2)} / base ${base.toFixed(2)} `
        + `(${(L.sun / base).toFixed(1)}:1, tint sat ${sat(L.tint).toFixed(2)})`);
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
    dome.configure(LEVELS.temple.atmosphere);
    const L = cloudLight(LEVELS.temple.atmosphere);
    near(L.amb, 0.42, 1e-9, 'an interior must fall back to the neutral default');
    near(lum(L.tint), 1, 1e-6, 'an interior cloud tint must be white');
    dome.dispose();
    return 'interiors opt out of the deck and of the sky-derived cloud light';
  });
}
