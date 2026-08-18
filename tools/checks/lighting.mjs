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
  cascadeBoxes, CASCADE_SPLIT, PMREM_FAR, BOUNCE_RADIUS, diffuseCap,
} from '../../src/engine/Engine.js';
import { SkyDome } from '../../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { celBounce, CEL } from '../../src/toon/Cel.js';

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

  check('exposure: the meter TRIMS the authored frame, and cannot overrule it', () => {
    /* THE BOUND THIS REPLACES WAS `spread(metered keys) < 1.02`, AND IT WAS
     * ASSERTING THE DEFECT.
     *
     * `metered key` was computed as `m.key * m.exposure / a.exposure`, and with
     * `exposure = a.exposure * KEY / key` that expression is KEY exactly, on
     * every level, by algebra. The bound could not fail, it measured nothing,
     * and what it PINNED was the thing that was wrong: every outdoor level
     * normalised onto one mid-grey however dark its atmosphere was authored.
     * Measured on the shipped tree the correction ran kamino ×3.14, scoria
     * ×2.36, wood ×1.75, geonosis ×1.80, alpine ×1.54, mustafar ×1.34 — the
     * darker a level is authored the harder it was lifted, which inverts the
     * art direction. See METER_TRIM in Engine.js for the derivation of the
     * bound that replaced it and for the reference-plate measurements.
     *
     * So this asks the question the old one was trying to ask — is the frame
     * metered, or guessed — in a form that can fail, and adds the two the old
     * one could not see: that metering leaves the AUTHOR in charge, and that
     * the trim has less authority than the knob the author holds.
     */
    const rows = [], rendered = [], authored = [], raw = [], metered = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const m = atmosphereMeter(a);
      assert(m.key > 0 && isFinite(m.key), `${key} metered a non-finite key`);
      assert(m.exposure > 0.2 && m.exposure < 3, `${key} wants exposure ${m.exposure}`);
      // The three keys that matter, all in the same units (linear radiance a
      // mid-grey horizontal surface lands on, after whatever exposure applies):
      //   raw       — what the atmosphere alone puts down, unexposed
      //   metered   — the same with the meter's OWN correction and nothing
      //               else, which is how much metering the meter is doing
      //   authored  — what the level's own numbers ask the frame to be
      //   rendered  — what it actually lands on after the meter has its say
      raw.push(m.key);
      metered.push(m.key * m.trim);
      authored.push(m.key * (a.exposure ?? 1.05));
      rendered.push(m.key * m.exposure);
      rows.push(`${key} irr ${m.irradiance.toFixed(2)} → exp ${m.exposure.toFixed(2)} (×${m.trim.toFixed(2)})`);
    }
    const spread = (xs) => Math.max(...xs) / Math.min(...xs);
    // 1. THE METER STILL METERS. The atmospheres put down a spread the authored
    //    exposures never expressed — that is the fault the meter exists for —
    //    and the meter's OWN correction has to close a measurable share of it.
    //    Measured against `key * trim` and not against the finished frame:
    //    the finished frame carries the author's `exposure` too, and a spread
    //    that the author widened is not evidence the meter stopped working.
    assert(spread(authored) > 1.4, `the authored exposures were already within `
      + `${spread(authored).toFixed(2)}:1 of each other — nothing to fix, so this proves nothing`);
    assert(spread(metered) < spread(raw) * 0.85,
      `the meter took a raw spread of ${spread(raw).toFixed(2)}:1 to ${spread(metered).toFixed(2)}:1 — `
      + 'that is not a meter, it is the authored numbers passed through');
    // 2. …AND IT DOES NOT ERASE THE AUTHORING. Most of the authored separation
    //    has to survive. At the old flat normalisation this was 0 by
    //    construction: every rendered key was `a.exposure * KEY`, so the
    //    atmosphere contributed nothing at all.
    assert(spread(rendered) > spread(authored) * 0.6,
      `the authored frames span ${spread(authored).toFixed(2)}:1 and render at `
      + `${spread(rendered).toFixed(2)}:1 — the meter has flattened them`);
    // 3. THE ORDER IS THE AUTHOR'S. Spearman between the frame the level asks
    //    for and the frame it gets. Under the flat normalisation the rendered
    //    key was `a.exposure * KEY` exactly, so the whole roster's brightness
    //    spread WAS the spread of that one scalar — 1.62:1 against an authored
    //    4.20:1 — and this correlation measured one knob against eight whole
    //    atmospheres: rho 0.405. It is 0.929 and a 3.08:1 spread now.
    const rank = (xs) => {
      const s = [...xs].map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
      const r = new Array(xs.length);
      s.forEach(([, i], k) => { r[i] = k; });
      return r;
    };
    const ra = rank(authored), rr = rank(rendered);
    const n = ra.length;
    const d2 = ra.reduce((s, v, i) => s + (v - rr[i]) ** 2, 0);
    const rho = 1 - (6 * d2) / (n * (n * n - 1));
    assert(rho > 0.90,
      `the frame that renders ranks ${rho.toFixed(3)} against the frame the level asks for — `
      + 'the meter is deciding which levels are dark');
    // 4. THE TRIM HAS LESS AUTHORITY THAN THE AUTHOR. Read off the engine
    //    rather than restated: meter an atmosphere with almost no light in it
    //    and one with far too much, and the trim sits on each of its bounds.
    //    The rule METER_TRIM is derived from is that its full travel must not
    //    exceed the full travel of `exposure` itself — a meter able to move a
    //    frame further than the knob can is a meter that can overrule it.
    const base = LEVELS[OUTDOOR[0]].atmosphere;
    const hi = atmosphereMeter({ ...base, sunIntensity: 1e-3, ambient: 0, fillIntensity: 0 }).trim;
    const lo = atmosphereMeter({ ...base, sunIntensity: 4e3 }).trim;
    const auth = OUTDOOR.map((k) => LEVELS[k].atmosphere.exposure ?? 1.05);
    assert(hi / lo <= spread(auth),
      `the trim can move a frame ${(hi / lo).toFixed(2)}:1 while every \`exposure\` in the game `
      + `together spans ${spread(auth).toFixed(2)}:1 — the meter outranks the author`);
    assert(hi > 1 && lo < 1, `the trim is one-sided: ${lo.toFixed(2)}…${hi.toFixed(2)}`);
    return `${rows.join('; ')} — raw ${spread(raw).toFixed(2)}:1 → metered ${spread(metered).toFixed(2)}:1, `
      + `authored ${spread(authored).toFixed(2)}:1 → rendered ${spread(rendered).toFixed(2)}:1, rho ${rho.toFixed(3)}, `
      + `trim ${lo.toFixed(2)}…${hi.toFixed(2)} inside an authored ${spread(auth).toFixed(2)}:1`;
  });

  check('probe: the ground bounce is actually inside the bake', () => {
    // It was not, for the whole life of the feature. PMREMGenerator.fromScene
    // defaults to far = 100 and the bounce hemisphere was scaled to 4000, so
    // every triangle of it was clipped and the probe was pure sky — while the
    // comment above it said it was "the only thing that puts colour under a
    // chin". Nothing threw. This is the cheapest possible guard against it
    // happening again, and it is worth having precisely because the failure is
    // silent and looks exactly like a taste decision.
    assert(BOUNCE_RADIUS < PMREM_FAR * 0.95,
      `the bounce dome is ${BOUNCE_RADIUS} against a ${PMREM_FAR} far plane — it is clipped out of the bake`);
    assert(BOUNCE_RADIUS > 1, `a ${BOUNCE_RADIUS}-unit dome is inside the geometry it is lighting`);
    const src = readFileSync(new URL('../../src/engine/Engine.js', import.meta.url), 'utf8');
    assert(/fromScene\(\s*tmp,\s*0\.04,\s*0\.1,\s*PMREM_FAR\s*\)/.test(src),
      'the bake no longer passes its far plane explicitly, so the pair is a comment again');
    assert(/setScalar\(BOUNCE_RADIUS\)/.test(src),
      'the bounce dome is scaled by a literal again, so nothing connects it to the far plane');

    /* …AND IT HAS TO BE SAMPLED, WHICH IS A SEPARATE QUESTION AND WAS THE
     * ANSWER NOBODY ASKED FOR. Being inside the far plane only means the dome
     * is IN the bake. The shader's flat ambient looks the probe up along world
     * up (CEL.flat = 1.0), and `getIBLIrradiance` is a cosine lobe about the
     * direction it is given — so a hemisphere sitting entirely BELOW the
     * horizon lands at a weight of about zero. Two checks, one clipping fix and
     * a paragraph of comment about "the only thing that puts colour under a
     * chin", and the term was still contributing nothing. The lookup has to
     * read both ends of the axis or being in the bake buys the same nothing. */
    const cel = readFileSync(new URL('../../src/toon/Cel.js', import.meta.url), 'utf8');
    for (const [sym, label] of [['getIBLIrradiance', 'flat probe'],
      ['getHemisphereLightIrradiance', 'flat hemisphere']]) {
      // the text of the substitution that installs this lookup, up to its label
      const end = cel.indexOf(`'${label}'`);
      assert(end > 0, `installCelShading no longer has a '${label}' substitution`);
      const body = cel.slice(cel.lastIndexOf('  sub(', end), end);
      // `from` is three's own line and carries no saberCelFlatDir, so every
      // occurrence below is one of the lookups this installs.
      const ends = (body.match(/saberCelFlatDir\( geometryNormal \)/g) || []).length;
      const down = (body.match(/-saberCelFlatDir\( geometryNormal \)/g) || []).length;
      assert(ends === 2 && down === 1,
        `the ${label} reads ${sym} along ${ends} direction(s), ${down} of them downward — at one `
        + 'end the ground half of the hemisphere light and the lower half of the probe bake are '
        + 'multiplied by zero');
      assert(body.includes('saberCelBounce('),
        `the ${label} no longer folds the ground lookup in through saberCelBounce`);
    }
    return `bounce ${BOUNCE_RADIUS} inside far ${PMREM_FAR}, both passed explicitly, `
      + 'and both flat lookups read +Y and −Y';
  });

  check('probe: the ground colour every level authors reaches the frame, and costs no light', () => {
    /* WHAT THE ZERO WEIGHT ACTUALLY COST, counted rather than described.
     *
     * `hemi.groundColor` is written by Engine.applyAtmosphere on every level
     * change and authored in Levels.js once per level. three's hemisphere
     * weight is `0.5 · dot(normal, light.direction) + 0.5`; Engine builds the
     * HemisphereLight at three's default position (0,1,0) and never moves it,
     * and the cel model looks it up along world up — so dotNL is exactly 1, the
     * weight is exactly 1, and `mix(groundColor, skyColor, 1.0)` is skyColor.
     * Every one of those authored values multiplied by zero.
     *
     * Two properties are asserted and they pull against each other, which is
     * the point: the ground has to CHANGE the flat ambient (or it is still
     * dead) and it must not change its LUMINANCE (or it has moved the exposure
     * meter, the bloom headroom and the lit:shade ratio, which is a lighting
     * change wearing a colour fix's clothes — measured, folding it in by energy
     * takes the ambient down 3–15% and pushes two levels outside the 1.3–2.2
     * band cel.mjs defends, at a ground share of only 0.20).
     */
    const rows = [];
    const grounds = new Set();
    let worstLum = 0, leastMove = 9, movedWrong = 0, deadUnderOld = 0;
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const sky = new THREE.Color(a.skyColor ?? 0xbcd8ff);
      const ground = new THREE.Color(a.groundColor ?? 0x60482e);
      grounds.add((a.groundColor ?? 0x60482e).toString(16));
      const s = [sky.r, sky.g, sky.b], g = [ground.r, ground.g, ground.b];
      const out = celBounce(s, g);
      // luminance is untouched, so nothing about the light budget moved
      const dl = Math.abs(lum({ r: out[0], g: out[1], b: out[2] }) - lum(sky));
      worstLum = Math.max(worstLum, dl);
      // …and the hue did move, toward this level's own ground
      const br = (c) => c[2] / Math.max(c[0], 1e-6);
      const move = Math.abs(br(out) - br(s)) / Math.max(br(s), 1e-6);
      leastMove = Math.min(leastMove, move);
      if (Math.sign(br(out) - br(s)) !== Math.sign(br(g) - br(s)) && Math.abs(br(g) - br(s)) > 1e-3) movedWrong++;
      /* THE CONTROL, AND IT IS A DISCRIMINATION TEST RATHER THAN AN IDENTITY.
       * Hand the term a wildly different ground — this level's own sky, which
       * is the furthest thing from a ground colour the roster contains — and
       * the answer has to change. Under the single-ended lookup that shipped it
       * could not: `mix(groundColor, skyColor, 1.0)` is skyColor for every
       * ground there is, so the two answers were bit-identical and the authored
       * value was unrecoverable from the frame. */
      const decoy = celBounce(s, [s[0] * 1.6, s[1] * 1.6, s[2] * 1.6]);
      const differs = out.some((v, i) => Math.abs(v - decoy[i]) > 1e-6);
      if (!differs) deadUnderOld++;
      rows.push(`${key} B/R ${br(s).toFixed(2)}→${br(out).toFixed(2)}`);
    }
    assert(worstLum < 1e-9,
      `the flat ambient's luminance moved by ${worstLum.toExponential(2)} — this term is only `
      + 'allowed to change a colour, and it has just changed every level\'s exposure');
    assert(leastMove > 0.02,
      `the least-moved level's flat ambient shifts by only ${(leastMove * 100).toFixed(1)}% in `
      + 'blue/red — the ground lookup is not reaching the frame');
    assert(movedWrong === 0, `${movedWrong} levels move AWAY from their own ground colour`);
    assert(deadUnderOld === 0,
      `${deadUnderOld} levels give the same flat ambient for two completely different ground `
      + 'colours — the ground lookup is being discarded again');
    assert(grounds.size >= 5,
      `only ${grounds.size} distinct ground colours across ${OUTDOOR.length} outdoor levels — `
      + 'the authored term carries no information to recover');
    return `${OUTDOOR.length} levels, ${grounds.size} distinct authored grounds, luminance moved `
      + `${worstLum.toExponential(1)} — ` + rows.join(' · ');
  });

  check('shade: one authored skylight cannot stand for three different skies', () => {
    /* The fill is the one shade term a level authors outright, and for one
     * round every outdoor level authored the IDENTICAL 0x7ba4ff — B/R 5.05 in
     * linear — over three skies whose own hemisphere chroma is 2.92, 2.11 and
     * 3.38. It went in on the argument that the probe cannot make a face
     * turning toward the open sky get bluer for it. The probe does exactly
     * that: getIBLIrradiance samples the diffuse convolution along the normal,
     * and measured GL-free the probe's own B/R runs 0.30 pointing down to 4.34
     * pointing at the open sky. So the fill was a second copy of a term already
     * present, laid on bluer than the sky it stood in for.
     *
     * What it cost, on the controlled cast shadow (tools/_shade.mjs), was a
     * SHADED VERTICAL FACE at saturation 0.320 on the arena and 0.379 on the
     * dune sea — against those levels' own SUNLIT faces at 0.323 and 0.171. A
     * shaded face as colourful as a sunlit one is a filter, not a shadow.
     * Correcting the two of them took those to 0.105 and 0.143.
     *
     * The same correction applied to the canyon took its shaded face to
     * saturation 0.020 at hue 294.9° — grey, hue meaningless — because that
     * level's shade is 94.6% probe against 48–55% on the others and its
     * exposure sits a stop and a half higher. Hence no numeric ceiling here
     * (see the note in the loop); what IS assertable is that the correction is
     * per level, so the levels must not all be carrying the same constant.
     *
     * B/R and not HSV saturation: the shade axis is blue against red and B/R is
     * the ratio that multiplies a warm albedo. It is also immune to exposure
     * and to the grade, which is the trap this lane has fallen into before —
     * bounding a chromatic quantity with a measurement taken in the wrong
     * space.
     */
    const rows = [];
    // A deterministic Fibonacci hemisphere, so the integral is reproducible
    // and does not depend on a sample count someone tunes later.
    const N = 768;
    const dirs = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * Math.PI * (3 - Math.sqrt(5));
      dirs.push(new T.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    }
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const m = atmosphereMeter(a);
      const sun = sunDirection(a, new T.Vector3());
      // The direction Engine points the fill: opposite the sun, lifted to y=0.5.
      const n = sun.clone().multiplyScalar(-1).setY(0.5).normalize();
      // The probe, as the bake actually contains it: the PHYSICAL sky above and
      // the ground-bounce hemisphere below, cosine-weighted about the normal
      // and scaled by the environment intensity the engine will use.
      const bounce = new T.Color(a.groundColor ?? 0x60482e)
        .multiplyScalar(Math.min(6, Math.max(0.02, m.irradiance / Math.PI)));
      const c = new T.Color();
      const w = (4 * Math.PI) / N;
      let R = 0, G = 0, B = 0;
      for (const d of dirs) {
        const cs = d.dot(n);
        if (cs <= 0) continue;
        let r, g, b;
        if (d.y > 0) { skyShoulder(skyRadiance(d, sun, a, c)); r = c.r; g = c.g; b = c.b; }
        else { r = bounce.r; g = bounce.g; b = bounce.b; }
        R += r * cs * w; G += g * cs * w; B += b * cs * w;
      }
      R *= m.envI; G *= m.envI; B *= m.envI;
      // …plus the hemisphere light, which is the other half of the shade.
      const skyC = new T.Color(a.skyColor ?? 0xbcd8ff);
      const grdC = new T.Color(a.groundColor ?? 0x60482e);
      const hemiI = (a.ambient ?? 0.85) * 0.45;
      const t = 0.5 * n.y + 0.5;
      R += (grdC.r + (skyC.r - grdC.r) * t) * hemiI;
      G += (grdC.g + (skyC.g - grdC.g) * t) * hemiI;
      B += (grdC.b + (skyC.b - grdC.b) * t) * hemiI;

      const shadeBR = B / Math.max(R, 1e-9);
      const f = new T.Color(a.fillColor ?? 0x9fc4ff);
      const fillBR = f.b / Math.max(f.r, 1e-9);
      /* A CEILING WAS TRIED HERE AND THE DATA KILLED IT. Leaving the numbers
       * so the next person does not re-derive it.
       *
       * The rule was `fillBR <= shadeBR` — a term that only adds light must not
       * make the shade more coloured than the sky already makes it. It is a
       * nice rule and it does not predict the frame. Shipped, the amount each
       * level's fill raised its own shade's B/R was:
       *
       *     dunes ×1.247    arena ×1.120    canyon ×1.239
       *
       * — canyon in the middle, and canyon is the level that looked RIGHT while
       * the other two looked like a blue filter. Nothing about the fill alone
       * separates them, because the difference is not in the fill: at a 14° sun
       * canyon's probe is 94.6% of its shade against 48–55% on the others, and
       * its exposure of 1.78 lands its shade where ACES is already taking
       * chroma out. Any threshold that failed shipped-arena and passed canyon
       * would have been picked to fit this edit, which is how a taste knob ends
       * up wearing a physical argument. So: no ceiling. What is asserted below
       * is only what holds without one.
       */
      /* IT MUST BE THIS LEVEL'S OWN SKY, and that is the re-derivation of a
       * rule that used to read `fillBR > 1.15` — "warm fills belong to
       * interiors, which are not in OUTDOOR."
       *
       * That was true of every sky this game had, and it was a PROXY. What the
       * fill stands in for is the dome; the reason it had to be blue is that
       * every dome in the game was blue. the Ember Shelf's is not: it is a smoke
       * ceiling lit from below by a lava sea, its `skyColor` is B/R 0.35, and a
       * blue fill there would be a lamp nobody has switched on — the exact
       * fault the old rule existed to catch, arriving through the letter of it.
       *
       * So the question becomes the one it was always asking. The fill has to
       * be the colour of the sky ON THIS LEVEL: within 30° of `skyColor` on the
       * wheel, and carrying at least a third of its chroma so it cannot be a
       * grey dimmer wearing the right hue. That is STRICTLY MORE than the old
       * bar on every level that had one — a fill of B/R 1.2 pointed 90° away
       * from its own sky used to pass and now does not — and the old bar is
       * kept verbatim underneath it wherever the sky really is blue, so no
       * level that satisfied it is being let off anything.
       */
      const s = new T.Color(a.skyColor ?? 0xbcd8ff);
      const hueOf = (c) => {
        const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), d = mx - mn;
        if (d < 1e-6) return null;
        const h = mx === c.r ? ((c.g - c.b) / d + 6) % 6
          : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
        return h * 60;
      };
      const chroma = (c) => {
        const mx = Math.max(c.r, c.g, c.b);
        return mx <= 1e-6 ? 0 : (mx - Math.min(c.r, c.g, c.b)) / mx;
      };
      const hf = hueOf(f), hs = hueOf(s);
      assert(hf !== null && hs !== null, `${key}: the fill or the sky has no hue at all`);
      let gap = Math.abs(hf - hs); if (gap > 180) gap = 360 - gap;
      assert(gap < 30,
        `${key}: the fill is ${hf.toFixed(0)}° against a sky of ${hs.toFixed(0)}° — `
        + `${gap.toFixed(0)}° apart, so it is standing in for somebody else's sky`);
      assert(chroma(f) > chroma(s) * 0.33,
        `${key}: the fill carries ${(chroma(f) / Math.max(chroma(s), 1e-6)).toFixed(2)} of its `
        + 'own sky\'s chroma — that is a dimmer, not a skylight');
      // …and where the sky IS blue, the bar it always had stands unchanged.
      const skyBR = s.b / Math.max(s.r, 1e-9);
      if (skyBR > 1.15) {
        assert(fillBR > 1.15, `${key}: the fill is B/R ${fillBR.toFixed(2)} — that is not skylight`);
      }
      // The one number a chroma edit must NOT move. atmosphereMeter weighs the
      // fill by lum(fillColor), so a level that "desaturates" its fill by
      // reaching for a paler hex quietly re-meters its own exposure and its own
      // lit-to-shade ratio, and the change gets credited to the wrong knob.
      // Scaling chroma about the colour's own luminance does not: the three
      // outdoor fills are 0.3798, 0.3798 and 0.3798 to four places, and the
      // measured lit-to-shade ratios moved 3.18→3.16, 2.77→2.75, 2.15→2.14.
      assert(lum(f) > 0.16 && lum(f) < 0.62,
        `${key}: the fill's luminance is ${lum(f).toFixed(3)} — it is being used as a dimmer`);
      rows.push(`${key} fill ${fillBR.toFixed(2)} into shade ${shadeBR.toFixed(2)}`);
    }
    // THE ASSERTION. Three atmospheres whose skies differ by 60% in chroma,
    // whose shades are made of the probe in different proportions and whose
    // exposures span a stop and a half, cannot share one authored skylight and
    // have all three be right. That they were identical is how the previous
    // round's constant survived being wrong on two levels out of three: it was
    // measured on one level and copied to the others, and the level it was
    // measured on was the one it did least harm to.
    const set = new Set(OUTDOOR.map((k) => LEVELS[k].atmosphere.fillColor ?? 0x9fc4ff));
    assert(set.size === OUTDOOR.length,
      `${OUTDOOR.length} outdoor levels share ${set.size} distinct fill colours — `
      + 'one constant standing in for three different skies is the fault, whatever its value');
    return `fill B/R into the shade it joins: ${rows.join(', ')}`;
  });

  check('exposure: the indirect budget is set by AIR MASS, and leaves a shadow dark', () => {
    // REWRITTEN. This used to assert `ratio <= 0.56 && envI > 0.15`, which
    // pinned a flat 0.55 cap and a floor sitting just under it — between them
    // they made the diffuse fraction a constant, and 0.55 is three times what a
    // clear sky actually puts down at a high sun. Measured on a controlled cast
    // shadow (tools/_shade.mjs), sunlit sand and the same sand in its own
    // shadow came out 2.9:1 in LINEAR on the arena. A desert is five to eight.
    // The `envI > 0.15` half of it asserted the bug directly: it is the line
    // that would have to be deleted to darken a shadow at all.
    //
    // The properties now are stronger and there are three of them: the ratio is
    // tighter for every level, it has to be ORDERED BY SUN HEIGHT rather than
    // being one number, and the thing it exists for — how dark a cast shadow
    // lands — is asserted directly instead of being hoped for.
    const rows = [];
    const seen = [];
    for (const key of OUTDOOR) {
      const a = LEVELS[key].atmosphere;
      const m = atmosphereMeter(a);
      const usedSky = m.skyFull * (m.envI / 0.38);
      const ratio = usedSky / m.direct;
      assert(ratio <= 0.50, `${key} still runs ${(ratio * 100).toFixed(0)}% indirect`);
      // …and the probe is trimmed, never switched off: it is still the only
      // image-based light in the game and the only thing with direction in it.
      assert(m.envI > 0.05, `${key} switched the probe off at ${m.envI.toFixed(3)}`);
      // The whole point. Flat ground, one material, sun versus no sun, in
      // linear radiance before any curve — which is the number a tone curve can
      // compress but cannot invent.
      const shade = (m.irradiance - m.direct) / Math.PI;
      const lit = m.irradiance / Math.PI;
      // The floor rises with the sun because the physics does: a 14° sun is
      // shining through four times the air a 60° one is, so a low-sun level
      // legitimately has a brighter shadow and must not be held to a high-sun
      // level's contrast. Shipped, all three sat at 2.5–2.6:1 whatever their
      // sun was doing, which is the signature of a constant pretending to be a
      // physical quantity — this line fails every one of them.
      const floor = 1.2 + 4.6 * m.sunPos.y;
      assert(lit / shade >= floor,
        `${key}: sunlit ground is only ${(lit / shade).toFixed(2)}:1 over its own cast shadow, `
        + `and a ${(Math.asin(m.sunPos.y) * 180 / Math.PI).toFixed(0)}° sun owes ${floor.toFixed(2)}:1`);
      // …and not so dark that a shadow is a hole with nothing in it.
      assert(lit / shade <= 12, `${key}: ${(lit / shade).toFixed(1)}:1 is a shadow with no light in it`);
      seen.push([m.sunPos.y, ratio, key]);
      rows.push(`${key} ${(ratio * 100).toFixed(0)}% at ${(Math.asin(m.sunPos.y) * 180 / Math.PI).toFixed(0)}° `
        + `→ ${(lit / shade).toFixed(1)}:1`);
    }
    // A low sun shines through more air, so more of its beam arrives as sky and
    // less as sun. Sorting by elevation has to sort by indirect fraction too,
    // or the budget is a taste knob wearing a physical argument.
    seen.sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < seen.length; i++) {
      assert(seen[i][1] < seen[i - 1][1],
        `${seen[i][2]} has a higher sun than ${seen[i - 1][2]} and no less indirect light`);
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
    return 'every interior keeps its authored exposure';
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
    /* Named levels, and the three named here changed when the wash, Hangar
     * Bay Nine and the dune sea were deleted. What is measured did not: an
     * outdoor level's authored coverage has to reach the uniform, an interior
     * must not draw a deck at all, and the haze the deck meets must be the
     * fog's radiance rather than the authored swatch. `alpine` and `temple`
     * are the surviving samples of the first two; the third is read off
     * whichever level is being configured, so it can never drift out of
     * agreement with the block it is testing again. */
    dome.configure(LEVELS.alpine.atmosphere);
    near(u.uCoverage.value, LEVELS.alpine.atmosphere.cloudCover, 1e-9, 'alpine cloud cover');
    assert(dome.mesh.visible, 'the White Pass has a sky');
    /* THE INTERIOR CLAUSE IS DERIVED and it runs over an empty set today: the
     * roster has no roofed level left (the Temple, the Foundry and the Works
     * were all struck). Written as a loop rather than deleted so the property
     * — an interior draws no cloud deck — comes back with the first level that
     * declares `sky: false`, instead of being rediscovered. */
    for (const key of LEVEL_ORDER.filter((k) => LEVELS[k].atmosphere?.sky === false)) {
      dome.configure(LEVELS[key].atmosphere);
      assert(!dome.mesh.visible, `${key} is an interior and must not draw a cloud deck`);
      near(u.uOpacity.value, 0, 1e-9, `${key}: interior cloud opacity`);
    }

    dome.configure(LEVELS.drifts.atmosphere);
    // the haze the deck meets must be the fog's, in radiance, not the swatch
    const hot = new THREE.Color(1.4, 1.3, 1.1);
    dome.setHaze(hot, new THREE.Color(0.4, 0.3, 0.2));
    near(u.uHazeColor.value.r, 1.4, 1e-6, 'haze red');
    near(u.uHorizonColor.value.g, 0.3, 1e-6, 'distant land green');
    assert(lum(u.uHazeColor.value) > lum(new THREE.Color(LEVELS.drifts.atmosphere.fogColor)),
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
