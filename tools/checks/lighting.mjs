/**
 * Lighting, HDR pipeline, sky and grade.
 *
 * Everything here is a number that was WRONG in a way that looked plausible.
 * The sky returned display-referred colour that the renderer consumed as
 * linear radiance and nobody noticed because the result was still blue. The
 * fog was authored the same tan as the sand it was hiding, so 50% fog at two
 * hundred metres changed nothing. Three levels shipped exposures within 5% of
 * each other over ground irradiance that differs by 140%. None of those show
 * up as an error, a crash or an obviously broken frame — they show up as
 * "it looks like a hobby project", which is not something a test can assert.
 * So these assert the measurements underneath instead.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  AERIAL, QUALITY, skyRadiance, skyShoulder, sunDirection, atmosphereMeter, hazeRadiance,
  cascadeBoxes, CASCADE_SPLIT,
} from '../../src/engine/Engine.js';
import { SkyDome } from '../../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';

const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const OUTDOOR = LEVEL_ORDER.filter((k) => LEVELS[k].atmosphere.sky !== false);

/* ── an independent Preetham, so the port is checked against maths and not
 *    against itself. Transcribed straight from the shader in the vendored
 *    Sky.js, in a different shape from Engine's version.                    */
function referenceSky(dir, sun, a) {
  const bR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const mC = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const d = dir.clone().normalize(), s = sun.clone().normalize();
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(Math.min(1, Math.max(-1, s.y)))) / 1.5)));
  const zen = Math.acos(Math.max(0, d.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const cosT = d.dot(s);
  const rP = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = a.mieG ?? 0.82, g2 = g * g;
  const mP = (1 / (4 * Math.PI)) * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const br = bR[i] * (a.rayleigh ?? 2.2);
    const bm = mC[i] * (0.434 * (0.2 * (a.turbidity ?? 6)) * 10e-18) * (a.mie ?? 0.008);
    const Fex = Math.exp(-(br * 8.4e3 * inv + bm * 1.25e3 * inv));
    const ratio = (br * rP + bm * mP) / (br + bm);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    const k = Math.min(1, Math.max(0, Math.pow(1 - s.y, 5)));
    Lin = Lin * (1 - k) + Lin * k * Math.sqrt(sunE * ratio * Fex);
    out[i] = (Lin + 0.1 * Fex) * 0.04;
  }
  return { r: out[0], g: out[1] + 0.0003, b: out[2] + 0.00075 };
}

/* ── the cloud deck's density field, ported from SkyDome.js.               */
const fr = (x) => x - Math.floor(x);
function chash(px, py) {
  let x = fr(px * 233.34), y = fr(py * 851.73);
  const d = x * (x + 23.45) + y * (y + 23.45);
  return fr((x + d) * (y + d));
}
function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = chash(ix, iy), b = chash(ix + 1, iy), c = chash(ix, iy + 1), d = chash(ix + 1, iy + 1);
  const t = a + (b - a) * fx;
  return t + ((c + (d - c) * fx) - t) * fy;
}
function fbm(px, py, oct) {
  let s = 0, amp = 0.5;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(px, py);
    const nx = (0.80 * px - 0.60 * py) * 2.03, ny = (0.60 * px + 0.80 * py) * 2.03;
    px = nx; py = ny; amp *= 0.5;
  }
  return s;
}
function deckDensity(px, py, thr) {
  const wx = fbm(px * 0.45, py * 0.45, 3) - 0.5;
  const wy = fbm(px * 0.45 + 31.7, py * 0.45 + 31.7, 3) - 0.5;
  return fbm(px + wx * 0.75, py + wy * 0.75, 5) - thr;
}

export function run({ check, assert, near, THREE: T }) {

  /* ══ the sky is light, not a picture of light ═════════════════════════ */

  check('sky: the three lines the HDR patch rewrites are still in three\'s shader', () => {
    // _linearSky is a source rewrite of a vendored shader. If three changes any
    // of these strings the patch silently no-ops, the sky quietly goes back to
    // display-referred, and NOTHING else breaks — which is exactly how it
    // survived this long in the first place.
    const src = Sky.SkyShader.fragmentShader;
    const markers = [
      'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );',
      'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;',
      'float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );',
    ];
    for (const m of markers) assert(src.indexOf(m) >= 0, `Sky.js no longer contains: ${m.slice(0, 46)}…`);
    // and the value the patch is undoing is the one we think it is
    assert(/pow\( texColor, vec3\( 1\.0 \/ \( 1\.2 \+ \( 1\.2 \* vSunfade \) \) \) \)/.test(src),
      'the display transform changed shape');
    return `3 anchors present in ${src.length} chars of vendored shader`;
  });

  check('sky: the CPU model reproduces the shader\'s own radiance', () => {
    // Engine derives fog, inscatter, ambient and exposure from a JS port of
    // Preetham. Checked against an independently transcribed one.
    let worst = 0;
    const lines = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a);
      for (const [name, dir] of [
        ['zenith', new T.Vector3(0.02, 1, 0.02)],
        ['sun', sun.clone()],
        ['anti', sun.clone().multiplyScalar(-1).setY(0.4)],
        ['skyline', new T.Vector3(sun.x, 0.03, sun.z)],
      ]) {
        const mine = skyRadiance(dir, sun, a, new T.Color());
        const ref = referenceSky(dir, sun, a);
        for (const ch of ['r', 'g', 'b']) {
          const rel = Math.abs(mine[ch] - ref[ch]) / Math.max(1e-4, Math.abs(ref[ch]));
          worst = Math.max(worst, rel);
          if (rel > 1e-6) lines.push(`${key}/${name}.${ch} ${mine[ch]} vs ${ref[ch]}`);
        }
      }
    }
    assert(worst < 1e-6, `the port drifts ${(worst * 100).toFixed(4)}% from the model: ${lines[0]}`);
    return `${OUTDOOR.length} atmospheres x 4 directions x 3 channels, worst ${(worst * 1e9).toFixed(1)} ppb`;
  });

  check('sky: linear radiance keeps a hundred to one that the gamma curve threw away', () => {
    // This is the whole diagnosis. The shipped sky ran texColor through
    // pow(c, 1/2.4) and the renderer then read the result as linear light, so
    // a 100:1 dome arrived as 7:1 and ACES squashed what was left into a flat
    // card. Both numbers are asserted, because only the SECOND one proves the
    // first is worth anything.
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a);
      const dirs = [
        new T.Vector3(0.02, 1, 0.02),
        new T.Vector3(sun.x, 0.03, sun.z),
        sun.clone().multiplyScalar(-1).setY(0.05).normalize(),
        new T.Vector3(-sun.z, 0.3, sun.x),
      ];
      let lo = Infinity, hi = 0, dlo = Infinity, dhi = 0;
      for (const d of dirs) {
        const L = lum(skyRadiance(d, sun, a, new T.Color()));
        lo = Math.min(lo, L); hi = Math.max(hi, L);
        // what the shipped display transform did to the same sample
        const D = Math.pow(L, 1 / 2.4);
        dlo = Math.min(dlo, D); dhi = Math.max(dhi, D);
      }
      assert(hi / lo > 12, `${key}: the linear sky only spans ${(hi / lo).toFixed(1)}:1`);
      assert(hi / lo > (dhi / dlo) * 3.5, `${key}: the display-referred sky already spans `
        + `${(dhi / dlo).toFixed(1)}:1 against ${(hi / lo).toFixed(1)}:1 — too close to be worth undoing`);
      rows.push(`${key} ${(hi / lo).toFixed(0)}:1 (was ${(dhi / dlo).toFixed(1)}:1)`);
    }
    return rows.join(', ');
  });

  check('sky: the shoulder tames the horizon glare without flattening the dome', () => {
    // A half-float target turns anything past 65504 into Infinity, and bloom
    // turns Infinity into NaN. Preetham's solar term reaches 7e5.
    const c = new T.Color();
    near(lum(skyShoulder(c.setRGB(0.2, 0.2, 0.2, T.LinearSRGBColorSpace))), 0.2, 1e-6,
      'ordinary sky must pass through untouched');
    near(lum(skyShoulder(c.setRGB(1.0, 1.0, 1.0, T.LinearSRGBColorSpace))), 1.0, 1e-6,
      'a value under the knee must pass through untouched');
    const hot = lum(skyShoulder(c.setRGB(21.7, 21.7, 21.7, T.LinearSRGBColorSpace)));
    const nuclear = lum(skyShoulder(c.setRGB(7e5, 7e5, 7e5, T.LinearSRGBColorSpace)));
    assert(hot > 6 && hot < 9.5, `the horizon glow lands at ${hot.toFixed(2)}`);
    assert(nuclear <= 9.5 + 1e-9, `the solar term still reaches ${nuclear.toExponential(2)}`);
    assert(nuclear < 65504, 'half-float would turn this into Infinity and bloom into NaN');
    assert(hot < nuclear, 'the shoulder must stay monotonic');
    return `0.2→0.2, 1→1, 21.7→${hot.toFixed(2)}, 7e5→${nuclear.toFixed(2)} (half-float safe)`;
  });

  /* ══ metering ═════════════════════════════════════════════════════════ */

  check('exposure: every outdoor level is metered to the same key, not guessed', () => {
    // The authored exposures span 5% while the actual ground irradiance spans
    // 140%: the canyon shipped most of a stop under and the arena most of a
    // stop over, and no grade fixes a frame that is metered wrong.
    const rows = [], keys = [], authored = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const m = atmosphereMeter(a);
      assert(m.key > 0 && isFinite(m.key), `${key} metered a non-finite key`);
      assert(m.exposure > 0.2 && m.exposure < 3, `${key} wants exposure ${m.exposure}`);
      // the key AFTER exposure — that is what lands on the tone curve
      keys.push(m.key * m.exposure / (a.exposure ?? 1.05));
      authored.push(m.key * (a.exposure ?? 1.05));
      rows.push(`${key} irr ${m.irradiance.toFixed(2)} → exp ${m.exposure.toFixed(2)}`);
    }
    const spread = (xs) => Math.max(...xs) / Math.min(...xs);
    assert(spread(keys) < 1.02, `metered keys still spread ${spread(keys).toFixed(3)}:1`);
    assert(spread(authored) > 1.4, `the authored exposures were already within `
      + `${spread(authored).toFixed(2)}:1 of each other — nothing to fix, so this proves nothing`);
    return `${rows.join('; ')} — metered spread ${spread(keys).toFixed(3)}:1, `
      + `authored spread was ${spread(authored).toFixed(2)}:1`;
  });

  check('exposure: indirect light is capped below direct, or nothing has shape', () => {
    // A scene whose sky puts as much light on the ground as its sun does has no
    // modelling in it at all. Measured before the cap: the arena at 0.85 and
    // the canyon at 0.98 of direct.
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const m = atmosphereMeter(a);
      const usedSky = m.skyFull * (m.envI / 0.38);
      const ratio = usedSky / m.direct;
      assert(ratio <= 0.56, `${key} still runs ${(ratio * 100).toFixed(0)}% indirect`);
      assert(m.envI > 0.15, `${key} choked the probe down to ${m.envI.toFixed(3)}`);
      rows.push(`${key} ${(ratio * 100).toFixed(0)}% (uncapped ${(100 * m.skyFull / m.direct).toFixed(0)}%)`);
    }
    return rows.join(', ');
  });

  check('exposure: interiors are left alone — there is no sky to meter them from', () => {
    for (const key of LEVEL_ORDER) {
      const a = LEVELS[key].atmosphere;
      if (a.sky !== false) continue;
      const m = atmosphereMeter(a);
      assert(m.key === null, `${key} metered a sky it does not have`);
      assert(m.skyFull === 0, `${key} claims ${m.skyFull} of sky irradiance indoors`);
      near(m.exposure / (a.exposure ?? 1.05), 0.92, 1e-9, `${key} exposure trim`);
    }
    return 'dojo and hangar keep their authored exposure';
  });

  /* ══ aerial perspective ═══════════════════════════════════════════════ */

  check('aerial: the fog chunk is installed and every fogged material can see it', () => {
    const C = THREE.ShaderChunk;
    assert(/vFogRay/.test(C.fog_pars_vertex), 'fog_pars_vertex does not declare the world ray');
    assert(/vFogRay = mvPosition\.xyz \* mat3\( viewMatrix \)/.test(C.fog_vertex),
      'fog_vertex does not compute the world ray');
    for (const name of ['uAerialShape', 'uAerialSun', 'uAerialTint', 'vFogRay'])
      assert(C.fog_pars_fragment.indexOf(name) >= 0, `fog_pars_fragment is missing ${name}`);
    // the varying is declared identically on both sides or the link fails
    assert(C.fog_pars_vertex.indexOf('varying vec3 vFogRay;') >= 0
      && C.fog_pars_fragment.indexOf('varying vec3 vFogRay;') >= 0, 'vFogRay declarations disagree');
    // and the shipped shaders that hand-roll fog still find what they read
    for (const n of ['fogColor', 'fogDensity', 'fogNear', 'fogFar', 'vFogDepth'])
      assert(C.fog_pars_fragment.indexOf(n) >= 0, `dropping ${n} breaks Particles.js and Scenery.js`);
    // braces balance, or every fogged shader in the game fails to compile
    const all = C.fog_pars_vertex + C.fog_vertex + C.fog_pars_fragment + C.fog_fragment;
    let depth = 0;
    for (const ch of all) { if (ch === '{') depth++; else if (ch === '}') depth--; assert(depth >= 0, 'unbalanced'); }
    assert(depth === 0, `the fog chunks leave ${depth} braces open`);
    return `4 chunks rewritten, ${all.length} chars, braces balanced`;
  });

  check('aerial: the shared uniforms survive three\'s per-material uniform clone', () => {
    // The whole delivery mechanism. UniformsUtils.clone copies a uniform value
    // by REFERENCE unless it is a Color/Vector/Matrix/Texture/Array, so a plain
    // {x,y,z,w} reaches every material as the same object and one write per
    // frame updates the entire scene. If three ever starts deep-copying plain
    // objects this silently becomes 46 private copies that never update.
    assert(THREE.UniformsLib.fog.uAerialShape, 'UniformsLib.fog was never extended');
    assert(THREE.UniformsLib.fog.uAerialShape.value === AERIAL.shape, 'not the shared object');
    for (const id of ['standard', 'physical', 'basic', 'lambert', 'points']) {
      const u = THREE.ShaderLib[id] && THREE.ShaderLib[id].uniforms;
      assert(u && u.uAerialShape, `ShaderLib.${id} never got the aerial uniforms`);
      assert(u.uAerialShape.value === AERIAL.shape, `ShaderLib.${id} holds a copy, not the shared object`);
    }
    // this is what three actually does when it builds a material's uniforms
    const cloned = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
    assert(cloned.uAerialShape.value === AERIAL.shape,
      'the clone broke the reference — every material would hold a dead copy');
    assert(cloned.fogColor.value !== THREE.ShaderLib.standard.uniforms.fogColor.value,
      'Colors are still cloned by value, so the test is reading the right mechanism');
    // and the GL setters only ever ask for .x/.y/.z/.w
    for (const k of ['x', 'y', 'z', 'w'])
      for (const u of [AERIAL.shape, AERIAL.sun, AERIAL.tint])
        assert(typeof u[k] === 'number', `aerial uniform is missing .${k}`);
    return 'UniformsLib.fog + 5 ShaderLib entries share one object through clone()';
  });

  check('aerial: height-stratified extinction integrates exp(-h/H) correctly', () => {
    // The shader does the integral analytically. Same formula here, checked
    // against brute-force integration along the ray — a sign error here reads
    // as "distance is fine, but hills are the wrong way round", which is
    // exactly the kind of thing nobody spots in a screenshot.
    const H = 38, invH = 1 / H;
    const analytic = (camY, rayY, len) => {
      const y0 = Math.min(Math.max(camY, -40), 600);
      const k = rayY * invH;
      const t0 = Math.exp(-y0 * invH);
      const m = Math.abs(k) < 1e-3 ? t0 : t0 * (1 - Math.exp(-k)) / k;
      return len * Math.min(Math.max(m, 0), 6);
    };
    const numeric = (camY, rayY, len) => {
      const N = 4000; let s = 0;
      for (let i = 0; i < N; i++) s += Math.exp(-(camY + rayY * ((i + 0.5) / N)) * invH);
      return (s / N) * len;
    };
    let worst = 0;
    const cases = [[2, 0, 200], [2, 60, 200], [2, -30, 200], [40, -38, 300], [0, 0, 50],
      [12, 120, 400], [2, 1e-4, 200], [-5, 20, 150]];
    for (const [cy, ry, len] of cases) {
      const a = analytic(cy, ry, len), n = numeric(cy, ry, len);
      worst = Math.max(worst, Math.abs(a - n) / Math.max(1, n));
    }
    assert(worst < 0.002, `the analytic path is ${(worst * 100).toFixed(2)}% off numeric integration`);
    // and it has to actually stratify: a ridge crest sees less haze than the floor
    const floor = analytic(2, 0, 250), crest = analytic(2, 45, 250);
    assert(crest < floor * 0.8, `a 45 m climb only cut the haze from ${floor.toFixed(0)} to ${crest.toFixed(0)}`);
    // and from up on the rim, looking DOWN into the haze collects more of it
    // than looking up out of it over the same distance
    const down = analytic(45, -43, 250), up = analytic(45, 43, 250);
    assert(down > up * 2, `from 45 m, down collects ${down.toFixed(0)} and up ${up.toFixed(0)}`);
    return `8 geometries, worst ${(worst * 100).toFixed(3)}% vs numeric; `
      + `crest ${crest.toFixed(0)} vs floor ${floor.toFixed(0)}; from 45 m down ${down.toFixed(0)} vs up ${up.toFixed(0)}`;
  });

  check('aerial: with the uniforms unset the chunk is exactly three\'s own fog', () => {
    // Materials compiled before install, or shaders that never merged
    // UniformsLib.fog, read these as zero. That must degrade to stock fog, not
    // to a black screen.
    const src = THREE.ShaderChunk.fog_fragment;
    assert(/uAerialShape\.x > 0\.0/.test(src), 'the height term is not gated');
    assert(/uAerialSun\.w > 0\.0/.test(src), 'the inscatter term is not gated');
    assert(/float fogPath = vFogDepth;/.test(src), 'the ungated path must be three\'s own vFogDepth');
    assert(/vec3 fogTone = fogColor;/.test(src), 'the ungated tone must be three\'s own fogColor');
    assert(/1\.0 - exp\( - fogDensity \* fogDensity \* fogPath \* fogPath \)/.test(src),
      'FOG_EXP2 must still be exp2');
    return 'both terms gated; zeroed uniforms fall through to stock exp2 fog';
  });

  /* ══ what distance dissolves into ═════════════════════════════════════ */

  check('fog: the haze is the sky, not a swatch the same colour as the ground', () => {
    // The bug this replaces: dunes fog was 0xd8c8a4 against sand of almost
    // exactly that colour, so half the frame's worth of fog at 200 m removed
    // no saturation and changed no value. Fog now takes its LEVEL from the
    // sky's own skyline radiance and half its hue with it.
    const rows = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a);
      const side = sun.clone().setY(0).normalize()
        .cross(new T.Vector3(0, 1, 0)).setY(0.02).normalize();
      // The engine's own derivation, called rather than transcribed. The
      // transcription that used to live here went stale the moment the haze
      // was re-anchored from the physical skyline to the DRAWN one: it went on
      // reporting 3.14 for the arena while applyAtmosphere was handing the
      // scene 0.85, and it went on passing, which is worse than failing.
      const haze = skyShoulder(skyRadiance(side, sun, a, new T.Color()));
      const authored = new T.Color(a.fogColor ?? 0xc9b391);
      const fog = hazeRadiance(a, new T.Color());

      // The LEVEL must come from the sky, which is stronger than asserting the
      // fog is merely brighter than the swatch: double the swatch's luminance
      // and the haze must not move at all. (The old form asserted 1.3x the
      // swatch, which only held while the haze was anchored to the physical
      // skyline at three times the level the dome actually drew.)
      const brighter = new T.Color(authored).multiplyScalar(2);
      const fog2 = hazeRadiance({ ...a, fogColor: brighter.getHex(T.LinearSRGBColorSpace) }, new T.Color());
      near(lum(fog2), lum(fog), lum(fog) * 0.02,
        `${key}: doubling the authored swatch moved the haze from ${lum(fog).toFixed(2)} to ${lum(fog2).toFixed(2)} `
        + '— the level is coming off the swatch, not off the sky');
      // and it must differ from the ground it is dissolving, in hue as well as
      // value, or distance takes nothing away
      const ground = new T.Color(LEVELS[key].groundColor ?? 0xb09578);
      const hueDist = Math.abs(fog.r / lum(fog) - ground.r / lum(ground))
        + Math.abs(fog.b / lum(fog) - ground.b / lum(ground));
      assert(hueDist > 0.18, `${key}: haze and ground differ by only ${hueDist.toFixed(3)} in chroma`);
      const authoredHue = Math.abs(authored.r / lum(authored) - ground.r / lum(ground))
        + Math.abs(authored.b / lum(authored) - ground.b / lum(ground));
      rows.push(`${key} ${lum(authored).toFixed(2)}→${lum(fog).toFixed(2)}, `
        + `chroma gap ${authoredHue.toFixed(2)}→${hueDist.toFixed(2)}`);
    }
    return rows.join('; ');
  });

  check('fog: inscatter glows toward the sun and dies away from it', () => {
    // The phase lobe in the chunk, evaluated here. If the anisotropy or the
    // sign goes, the haze gets BRIGHTER behind you, which reads as a bug
    // immediately but is invisible in a still.
    const g = 0.50;
    const phase = (c) => (1 - g * g) / Math.pow(Math.max(1 + g * g - 2 * g * c, 1e-4), 1.5);
    const back = (c) => 0.75 * (1 + c * c);
    const toward = phase(1) + back(1) * 0.16;
    const across = phase(0) + back(0) * 0.16;
    const away = phase(-1) + back(-1) * 0.16;
    assert(toward > across * 4, `looking at the sun is only ${(toward / across).toFixed(1)}x the side`);
    assert(across > away * 1.25, `across is only ${(across / away).toFixed(2)}x the anti-sun`);
    assert(away > 0.1, 'the anti-sun side must not go black');
    // and the level of it is derived from the sky, not typed in
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sun = sunDirection(a);
      const side = sun.clone().setY(0).normalize().cross(new T.Vector3(0, 1, 0)).setY(0.02).normalize();
      const flat = sun.clone().setY(0.03).normalize();
      const gainv = Math.min(Math.max(lum(skyShoulder(skyRadiance(flat, sun, a, new T.Color())))
        - lum(skyShoulder(skyRadiance(side, sun, a, new T.Color()))), 0), 12);
      const w = gainv * 0.028;
      assert(w > 0.02 && w < 0.5, `${key} inscatter strength ${w.toFixed(3)} is out of range`);
    }
    return `sun ${toward.toFixed(2)}, across ${across.toFixed(2)}, anti ${away.toFixed(2)} `
      + `(${(toward / away).toFixed(0)}:1)`;
  });

  /* ══ the cloud deck ═══════════════════════════════════════════════════ */

  check('clouds: the coverage threshold is calibrated to the field it thresholds', () => {
    // This is the trap that ate the first version. The fbm's useful range is
    // 0.29 to 0.70 about a median of 0.50; a threshold picked by eye at 0.13
    // covers the whole sky and one at 0.60 clears it, and an alpha ramp 0.30
    // wide — which sounds gentle — makes EVERY cloud a translucent smear
    // because the density never gets that far above the threshold.
    const N = 150, span = 12;
    const field = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      field.push(deckDensity(-span / 2 + (i * span) / N, -span / 2 + (j * span) / N, 0));
    }
    field.sort((a, b) => a - b);
    const q = (p) => field[Math.floor(field.length * p)];
    assert(q(0.5) > 0.40 && q(0.5) < 0.60, `the deck's median density is ${q(0.5).toFixed(3)}`);
    const rows = [];
    for (const [cov, loPct, hiPct] of [[0, 8, 32], [0.44, 45, 72], [1, 85, 99]]) {
      const thr = 0.60 + (0.30 - 0.60) * cov;
      const touched = field.filter((v) => v - thr > 0).length / field.length;
      const solid = field.filter((v) => v - thr > 0.085).length / field.length;
      assert(touched * 100 > loPct && touched * 100 < hiPct,
        `coverage ${cov} covers ${(touched * 100).toFixed(0)}% of the deck`);
      // and once there is a deck at all, its core has to be a real fraction of
      // it and not just a rim, or the sky reads as smoke instead of cloud
      if (cov >= 0.44) {
        assert(solid > touched * 0.5,
          `at coverage ${cov} only ${(100 * solid / Math.max(touched, 1e-6)).toFixed(0)}% of the cloud is opaque `
          + '— the deck is all edge and reads as smoke');
      }
      rows.push(`${cov}→${(touched * 100).toFixed(0)}% (${(solid * 100).toFixed(0)}% solid)`);
    }
    // every level's authored coverage lands somewhere useful
    for (const key of OUTDOOR) {
      const cov = LEVELS[key].atmosphere.cloudCover ?? 0.42;
      const thr = 0.60 + (0.30 - 0.60) * cov;
      const touched = field.filter((v) => v - thr > 0).length / field.length;
      assert(touched > 0.25 && touched < 0.95, `${key} would sit at ${(touched * 100).toFixed(0)}% cloud`);
    }
    return rows.join(', ');
  });

  check('clouds: the deck is shaded by a light path, not by a view-direction mix', () => {
    // A cumulus has a bright shoulder and a slate flank because light is
    // absorbed on the way through it. mix(dark, lit, dot(view, sun)) has no
    // such gradient, which is why the old deck read as tan paper cut-outs.
    const src = new SkyDome(new THREE.Scene()).mat.fragmentShader;
    assert(/uSunDir\.xz \/ max\( ?uSunDir\.y/.test(src),
      'the sun march is not projected onto the deck by the sun\'s elevation');
    assert(/exp\(-od \* /.test(src), 'no Beer-Lambert absorption along the light path');
    assert(/powder/.test(src) && /1\.0 - exp\(-h \* /.test(src), 'no powder term');
    assert(/hg\(cosT/.test(src), 'no phase function');
    assert(/uSkyAmb/.test(src), 'the shaded side is not being lit by the sky');
    // three taps at increasing distance, with decreasing weight
    const march = src.split('deck(p + sstep').length - 1;
    assert(march >= 3, `only ${march} samples along the light path`);
    return `${march}-tap light march, Beer-Lambert + powder + HG phase + sky ambient`;
  });

  check('clouds: configure and the radiance hookup actually move the uniforms', () => {
    const scene = new THREE.Scene();
    const dome = new SkyDome(scene);
    const u = dome.mat.uniforms;
    dome.configure(LEVELS.canyon.atmosphere);
    near(u.uCoverage.value, 0.74, 1e-9, 'canyon cloud cover');
    assert(dome.mesh.visible, 'the canyon has a sky');
    dome.configure(LEVELS.hangar.atmosphere);
    assert(!dome.mesh.visible, 'the hangar is an interior and must not draw a cloud deck');
    near(u.uOpacity.value, 0, 1e-9, 'interior cloud opacity');

    dome.configure(LEVELS.dunes.atmosphere);
    // the haze the deck meets must be the fog's, in radiance, not the swatch
    const hot = new THREE.Color(1.4, 1.3, 1.1);
    dome.setHaze(hot, new THREE.Color(0.4, 0.3, 0.2));
    near(u.uHazeColor.value.r, 1.4, 1e-6, 'haze red');
    near(u.uHorizonColor.value.g, 0.3, 1e-6, 'distant land green');
    assert(lum(u.uHazeColor.value) > lum(new THREE.Color(LEVELS.dunes.atmosphere.fogColor)),
      'the deck still meets the world at a darker colour than the world dissolves to');
    dome.setRadiance(0.95, 1.1, new THREE.Color(0.7, 0.95, 1.4));
    near(u.uHdr.value, 0.95, 1e-9, 'hdr scale');
    near(u.uSkyAmb.value.b, 1.4, 1e-6, 'sky ambient blue');
    dome.dispose();
    assert(scene.children.length === 0, 'dispose left the dome in the scene');
    return 'coverage, interior opt-out, haze, land colour, radiance and sky ambient all land';
  });

  /* ══ the grade ════════════════════════════════════════════════════════ */

  check('grade: the S-curve deepens shadows without inverting or clipping', () => {
    // Modelled exactly as the composite does it, in display space.
    const black = 0.018, curve = 0.32;
    const apply = (x) => {
      let c = Math.max(x - black, 0) / (1 - black);
      c = c + curve * (c * c * (3 - 2 * c) - c);
      c = (c - 0.5) * 1.04 + 0.5;
      return c;
    };
    let prev = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const v = apply(i / 200);
      assert(isFinite(v), `the curve produced ${v} at ${i / 200}`);
      assert(v > prev - 1e-9, `the curve is not monotonic at ${(i / 200).toFixed(3)}`);
      prev = v;
    }
    assert(apply(0) < 0.005, `black comes out at ${apply(0).toFixed(4)} — nothing in the frame is black`);
    assert(apply(1) > 0.99, `white comes out at ${apply(1).toFixed(4)}`);
    // it has to actually add contrast in the region a frame lives in
    const slope = (apply(0.55) - apply(0.45)) / 0.1;
    assert(slope > 1.15, `midtone slope is only ${slope.toFixed(3)} — the curve is doing nothing`);
    // and pull the shadows down rather than lifting them
    assert(apply(0.14) < 0.14 * 0.85, `a shadow at 0.14 only reaches ${apply(0.14).toFixed(3)}`);
    return `monotonic over 201 samples, black→${apply(0).toFixed(4)}, `
      + `midtone slope ${slope.toFixed(2)}, 0.14→${apply(0.14).toFixed(3)}`;
  });

  check('grade: shadows and highlights are separated by colour, not only by value', () => {
    const shadow = new T.Vector3(0.955, 0.985, 1.070);
    const high = new T.Vector3(1.035, 1.000, 0.955);
    // cool below, warm above, and neither so strong it becomes a colour cast
    assert(shadow.z > shadow.x, 'shadows must be cooler than they are warm');
    assert(high.x > high.z, 'highlights must be warmer than they are cool');
    for (const v of [shadow, high]) {
      for (const c of ['x', 'y', 'z']) assert(Math.abs(v[c] - 1) < 0.09, `tint ${c}=${v[c]} is a cast, not a grade`);
    }
    const split = (high.x / high.z) / (shadow.x / shadow.z);
    assert(split > 1.15 && split < 1.5, `the warm/cool split is ${split.toFixed(3)}`);
    return `shadow ${shadow.toArray().join('/')} vs highlight ${high.toArray().join('/')}, split ${split.toFixed(2)}`;
  });

  /* ══ the rig ══════════════════════════════════════════════════════════ */

  check('shadows: the cascades cover enough ground to light a landscape', () => {
    // This replaces "the ONE cascade covers enough ground". One box can only
    // buy reach with texel size — they are the same number, 2·radius/mapSize —
    // so the old bound (a single box under 9 cm) capped the world at 58 m of
    // cast shadow at medium. The properties that matter now are per cascade,
    // and every one of them is tighter than the number it replaces.
    const rows = [];
    for (const [name, q] of Object.entries(QUALITY)) {
      const boxes = cascadeBoxes(name);
      assert(boxes.length >= 3, `${name} has only ${boxes.length} cascades`);
      // the near cascade is what the fight stands in, and it has to be FINER
      // than the single box managed at ANY tier (4.7 cm at ultra was the best)
      assert(boxes[0].texel < 0.045,
        `${name}: near cascade texels are ${(boxes[0].texel * 100).toFixed(1)}cm — coarser than the one box it replaced`);
      // the far one may be coarse, but not so coarse that a 2 m rock's shadow
      // is a dozen texels of staircase
      assert(boxes[boxes.length - 1].texel < 0.20,
        `${name}: far cascade texels are ${(boxes[boxes.length - 1].texel * 100).toFixed(1)}cm`);
      // neighbours may not be more than 2.6× apart, or the blend band cannot
      // hide the change in penumbra width and the handover reads as a line
      for (let i = 1; i < boxes.length; i++) {
        const r = boxes[i].texel / boxes[i - 1].texel;
        assert(r > 1.2 && r < 2.6, `${name}: cascades ${i - 1}→${i} step ${r.toFixed(2)}× in texel size`);
        assert(boxes[i].radius > boxes[i - 1].radius, `${name}: cascade ${i} is not outside cascade ${i - 1}`);
      }
      assert(q.shadowDist >= 70, `${name} shadows stop at ${q.shadowDist}m`);
      assert(q.shadowDist < q.viewDist * 0.4, `${name} shadow frustum is a large fraction of the view`);
      rows.push(`${name} ${q.shadowDist}m/${boxes.map((b) => (b.texel * 100).toFixed(1)).join('/')}cm`);
    }
    // and quality has to actually be a ladder: more reach every step, and never
    // blockier near shadows than the tier below
    const order = ['low', 'medium', 'high', 'ultra'];
    for (let i = 1; i < order.length; i++) {
      assert(QUALITY[order[i]].shadowDist > QUALITY[order[i - 1]].shadowDist,
        `${order[i]} does not extend shadows past ${order[i - 1]}`);
      assert(cascadeBoxes(order[i])[0].texel <= cascadeBoxes(order[i - 1])[0].texel + 1e-9,
        `${order[i]} has coarser near shadows than ${order[i - 1]}`);
    }
    return rows.join(', ');
  });

  check('shadows: the cascade rig lights the scene exactly once', () => {
    // The cascades are three DirectionalLights sharing one direction. If any of
    // the carriers ever gets a colour, every material that sums
    // `directionalLights[i].color` itself — the grass does, in Scenery.js — sees
    // two or three suns and doubles in key with nothing extra thrown.
    const src = readFileSync(new URL('../../src/engine/Engine.js', import.meta.url), 'utf8');
    // the DEFINITION, not the constructor's call to it
    const at = src.indexOf('_setupLights() {');
    const setup = src.slice(at, src.indexOf('this.pmrem = new THREE.PMREMGenerator', at));
    assert(/i === 0 \? 0xfff0d8 : 0x000000/.test(setup) && /i === 0 \? 3\.6 : 0/.test(setup),
      'a cascade past the first carries light — every hand-written light loop now sees two suns');
    assert(/this\.sun = this\.cascades\[0\]/.test(setup),
      'this.sun is no longer the lit cascade, so everything that reads the sun reads a black light');
    // and the shader may consult exactly ONE cascade, or a coarse map's
    // penumbra multiplies into the fine map's
    assert(/#if UNROLLED_LOOP_INDEX == 0/.test(src),
      'lights_fragment_begin applies a shadow for the carrier lights too');
    assert(/saberCascadeShadow\(\)/.test(src) && /shadowmask_pars_fragment/.test(src),
      'getShadowMask() still multiplies every cascade together');
    assert(/float saberCascadeFit/.test(src) && /\* 12\.0/.test(src),
      'the cascade handover has no blend band');
    // the snap has to be in the LIGHT's basis; world x/z is only the texel grid
    // when the sun happens to look down a world axis
    const fit = src.slice(src.indexOf('fitShadows(center)'), src.indexOf('addHeat('));
    assert(/Math\.round\(_fs\[2\]\.dot\(_fs\[3\]\) \/ texel\)/.test(fit),
      'the shadow box is snapped in world coordinates, so the map still slides sub-texel as you walk');
    assert(/addScaledVector\(fwd, d \* 0\.55\)/.test(fit),
      'the cascades are centred on the player, so half of every map is behind the camera');
    return 'one lit cascade, two carriers, one lookup, light-space snap';
  });
}
