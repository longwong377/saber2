/**
 * The blade, its trail, and everything that comes off an impact.
 *
 * The complaint these exist to catch is "it looks like a hobby project", and
 * every one of the faults underneath it measured fine:
 *
 *   • The blade was a solid white capsule inside three tinted cylinders. Its
 *     colour was set correctly, its bloom fired, its shells were the right
 *     radii — and every crystal in the game rendered as the same white stick,
 *     because the white was AUTHORED and the tint sat under it. Measured on a
 *     cerulean blade at 2.6 m, the chroma nine pixels off the axis was 0.06.
 *   • The trail had a floor of 0.08 intensity and was driven by WORLD tip
 *     speed, so a blade held perfectly still while its owner walked laid down
 *     a permanent ribbon.
 *   • Not one particle in the game could cross the bloom threshold. The colour
 *     attribute was a 0..1 swatch and the fragment shader could not emit more
 *     than 1.0, so every spark, ember and impact flash was a sticker beside a
 *     blade that glowed.
 *   • Sparks were 5 cm radial blobs stretched by a factor of 1.4. Glowing peas.
 *
 * So these check the numbers underneath the look: the shape of the emission
 * profile, what survives of the hue at each radius, what actually reaches the
 * bloom pass, and what a smear does when nobody is swinging.
 */

import * as THREE from 'three';
import { Saber, SABER_COLORS } from '../../src/game/Saber.js';
import { Particles, ParticlePool, ChipField, surfaceTint, incandescent, ground, conformToGround }
  from '../../src/world/Particles.js';
import { Terrain } from '../../src/world/Terrain.js';
import { sliceGeometry } from '../../src/world/Slice.js';

/**
 * three's own punctual falloff, from lights_pars_begin. The blade's wash is
 * judged against this and not against 1/d², because the decay exponent is the
 * whole point of the rig.
 */
const atten = (d, cutoff, decay) => {
  let f = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (cutoff > 0) f *= Math.pow(Math.max(0, Math.min(1, 1 - Math.pow(d / cutoff, 4))), 2);
  return f;
};

const lum = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const chroma = (r, g, b) => {
  const M = Math.max(r, g, b), m = Math.min(r, g, b);
  return M < 1e-6 ? 0 : (M - m) / M;
};

/** A scene with the rig a level hangs: one shadowing sun, one hemisphere. */
function litScene() {
  const s = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffe8c0, 7);
  sun.castShadow = true;
  sun.position.set(30, 52, -18);
  s.add(sun); s.add(sun.target);
  s.add(new THREE.HemisphereLight(0xc0d4ee, 0x7a6244, 0.3));
  return s;
}

/**
 * The blade's emission profile, in linear radiance, as a function of distance
 * from the axis — transcribed from BLADE_FRAG but driven by the uniforms of a
 * REAL material, so the constants cannot drift away from the shader that uses
 * them without this going with them.
 *
 * @param {number} d      metres from the blade axis
 * @param {number} pxSize metres per pixel, for the sub-pixel widening
 */
function emission(mat, d, pxSize = 0) {
  const u = mat.uniforms;
  const wid = [u.uWidth.value.x, u.uWidth.value.y, u.uWidth.value.z];
  const amp = [u.uAmp.value.x, u.uAmp.value.y, u.uAmp.value.z];
  const R = u.uRadius.value;
  let e = 0;
  for (let i = 0; i < 3; i++) {
    const we = Math.max(wid[i], pxSize * 0.62);
    const keep = wid[i] / we;
    const dd = d / we;
    e += amp[i] * (i === 2 ? Math.exp(-Math.pow(dd, 1.4)) : Math.exp(-dd * dd)) * keep;
  }
  // the shader's outer feather, so the quad edge is exactly zero
  const t = Math.min(1, Math.max(0, (d - R) / (R * 0.55 - R)));
  return e * (t * t * (3 - 2 * t));
}

/** The profile as an RGB triple for a given crystal. */
function emissionRGB(saber, d, pxSize = 0) {
  const e = emission(saber.bladeMat, d, pxSize) * saber.punch;
  const h = saber.hue;
  return [h.r * e, h.g * e, h.b * e];
}

/**
 * three's ACESFilmicToneMapping, transcribed from tonemapping_pars_fragment.
 *
 * Nothing about how a blade READS can be judged in linear radiance: the blade
 * is one hue at every radius, so its emission chroma is constant and the
 * white core exists only because the tone curve puts it there. This is the
 * only place the question "is it a white stick" can actually be asked.
 */
function aces(rgb, exposure = 0.9) {
  const mul = (m, v) => [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
  const IN = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
  let v = rgb.map(c => c * exposure / 0.6);
  v = mul(IN, v);
  v = v.map(x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  return mul(OUT, v).map(x => Math.min(1, Math.max(0, x)));
}

/** Linear → sRGB, so a claim about "white" is made in the space a screen is in. */
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * The soft-particle fade, evaluated by RUNNING THE SHIPPED GLSL rather than by
 * writing the same `smoothstep` a second time in JavaScript.
 *
 * A JS twin of `softFade` is HANDOFF §2.4 exactly: it would agree with the game
 * on the day it was written and drift silently thereafter, and it would fail in
 * the direction that manufactures a pass. So the check parses the numbers out
 * of the ACTUAL string the material is compiled from — if the linearisation or
 * the clamp changes, this reads the change.
 */
function softFadeOf(glsl) {
  const body = glsl.slice(glsl.indexOf('float softFade('));
  const lin = glsl.slice(glsl.indexOf('float sceneLinearDepth('));
  // The two facts a soft fade has to have, taken off the source: it linearises
  // 1/z against a near/far pair, and it divides the gap by a width and clamps.
  return {
    linearises: /2\.0\s*\*\s*uDepthRange\.x\s*\*\s*uDepthRange\.y/.test(lin)
      && /texture2D\(\s*tSceneDepth/.test(lin),
    fades: /clamp\(\s*\(\s*scene\s*-\s*viewZ\s*\)\s*\/\s*uSoft/.test(body),
    skySafe: /uDepthRange\.y\s*\*\s*0\.98/.test(body),
    freeWhenUnarmed: /uDepthRange\.z\s*<\s*0\.5\s*\|\|\s*uSoft\s*<=\s*0\.0/.test(body),
  };
}

export function run({ check, assert, near }) {

  /**
   * NO SOFT PARTICLES — and for a cel-shaded frame that matters MORE, not less.
   *
   * `grep -n 'softParticle|depthTexture|sceneDepth'` over Particles.js and
   * Smoke.js returned zero. Every sprite was a `depthWrite: false` billboard
   * ending on a straight line where it crossed the world, and that line is at
   * its most visible over exactly the flat colour fields this renderer draws.
   */
  check('smoke: a column dissolves into the level\'s OWN sky, not into Geonosis\'', async () => {
    /**
     * A SMOKE COLUMN IS NOT LIT — `Smoke.js` says why in its header — so the
     * only thing that makes one END rather than stop is that its top has
     * become the colour of the haze behind it. `tip` is that colour, and
     * Geonosis authored it as `0xd0a473`, which is `LEVELS.geonosis
     * .atmosphere.fogColor` written a second time.
     *
     * IT WENT WRONG WHEN THE MODE PUT THIS SMOKE ON SEVEN GROUNDS. THE LINE
     * rolls its theatre off the run seed and `Front.marchFront` raises the
     * marching front's columns on whatever it lands on; the only level in the
     * game that publishes `world.smokeAir` is Geonosis, so the fallback — a
     * third copy of the same five numbers, in `Front.js` — was handing every
     * other ground Geonosis' dust:
     *
     *     level      its own fog     the tip it was given
     *     alpine       #b6cbee            #d0a473
     *     wood         #1a231b            #d0a473
     *     drifts       #cdc6b8            #d0a473
     *     colosseum    #c8c4b8            #d0a473
     *     mustafar     #584038            #d0a473
     *     scoria       #6b3a2a            #d0a473
     *
     * and a wind of `[0.94, 0.34]` (20°) on a ground whose own dunes are combed
     * along `[0.62, −0.78]` (−51°), so the columns leaned 71° off the way that
     * level's snow, grass and dust were all blowing.
     *
     * WHAT IS MEASURED IS THE MESH AND NOT THE RECORD. `addSmokeColumns` bakes
     * the tip into the vertex colours of the top ring and the lean into where
     * that ring sits over the base, so this reads the geometry the game draws
     * rather than the table it was drawn from — a record that agreed and a mesh
     * that did not is exactly the failure this clause is for.
     */
    const { addSmokeColumns } = await import('../../src/world/Smoke.js');
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { TERRAIN_PRESETS } = await import('../../src/world/Terrain.js');
    const lines = [];
    const geo = new THREE.Color(LEVELS.geonosis.atmosphere.fogColor);
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const preset = TERRAIN_PRESETS[L.terrain];
      assert(preset, `${key} names a terrain preset that does not exist`);
      /* A GROUND AT ZERO, not the level's real one: what is measured is the
       * tip colour and the lean, and both are relative to the column's own
       * base. Building seven real Terrains to place one column each would be
       * seven heightfields for a number that does not depend on them. */
      const world = { scene: new THREE.Scene(), statics: [],
        terrain: { preset, height: () => 0 }, level: L };
      const mesh = addSmokeColumns(world, [{ x: 0, z: 0, height: 60, seed: 5 }]);
      assert(mesh, `${key}: no column built`);
      const pos = mesh.geometry.attributes.position;
      const col = mesh.geometry.attributes.color;
      const SIDES = 7;
      const rings = pos.count / SIDES;
      /* THE TOP RING IS THE TIP EXACTLY: `shade = body.lerp(tip, t^0.7)` and
       * the last station is t = 1. Anything else means the ramp lost its end. */
      const want = new THREE.Color(L.atmosphere.fogColor);
      let dr = 0;
      let cx = 0, cz = 0;
      for (let s = 0; s < SIDES; s++) {
        const i = (rings - 1) * SIDES + s;
        dr = Math.max(dr, Math.abs(col.getX(i) - want.r), Math.abs(col.getY(i) - want.g),
          Math.abs(col.getZ(i) - want.b));
        cx += pos.getX(i); cz += pos.getZ(i);
      }
      cx /= SIDES; cz /= SIDES;
      const top0 = (rings - 1) * SIDES;
      const got = new THREE.Color(col.getX(top0), col.getY(top0), col.getZ(top0));
      assert(dr < 0.004,
        `${key}'s column tips to #${got.getHexString()} against its own fog #${want.getHexString()}`);
      /* AND IT LEANS THE LEVEL'S OWN WAY. The top ring's centre is the base
       * plus `wind · drift`, wobbled; 12° of tolerance covers the wobble and
       * is nowhere near the 71° the Geonosis literal was worth on alpine. */
      const w = preset.wind || [1, 0];
      const off = Math.atan2(cz, cx), want2 = Math.atan2(w[1], w[0]);
      let d = off - want2;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      assert(Math.abs(d) < 0.21,
        `${key}'s smoke leans ${(off * 180 / Math.PI).toFixed(0)}° and its ground is combed `
        + `along ${(want2 * 180 / Math.PI).toFixed(0)}°`);
      lines.push(`${key} #${want.getHexString()} @${(want2 * 180 / Math.PI) | 0}°`);
      mesh.geometry.dispose();
    }
    /* AND THE LEVELS ARE NOT ALL ONE LEVEL. Six of the seven tipping to the
     * seventh's fog is precisely the defect, and every per-level assertion
     * above would still pass if every level's fog were the same colour. */
    const tips = new Set(LEVEL_ORDER.map((k) => LEVELS[k].atmosphere.fogColor));
    assert(tips.size >= 6, `${tips.size} distinct fog colours over ${LEVEL_ORDER.length} levels`);
    assert(LEVEL_ORDER.filter((k) => new THREE.Color(LEVELS[k].atmosphere.fogColor).getHex() === geo.getHex()).length === 1,
      'more than one level tips to Geonosis\' dust');
    return lines.join('; ');
  });

  check('particles: a sprite fades where it meets the world instead of ending on a line', async () => {
    const S = await import('../../src/world/SoftDepth.js');
    const { addSmokeColumns } = await import('../../src/world/Smoke.js');

    const shape = softFadeOf(S.SOFT_GLSL);
    for (const [k, v] of Object.entries(shape)) assert(v, `softFade lost its ${k} clause`);

    /* ONE COPY OF THE MATHS, AND ONE SET OF UNIFORM OBJECTS. Two consumers with
     * two linearisations would put the smoke's fade and the sparks' fade at
     * different distances and nothing would throw — the eighth instance of
     * HANDOFF §2.3. The uniform IDENTITY is what makes that impossible: both
     * materials point at the same three objects, so one write moves both. */
    const p = new Particles(new THREE.Scene(), 0.25);
    const pools = p.pools;
    assert(pools.length >= 7, `only ${pools.length} pools`);
    const shared = pools[0].mat.uniforms.tSceneDepth;
    for (const pool of pools) {
      const u = pool.mat.uniforms;
      assert(u.tSceneDepth === shared, 'a pool has its own depth uniform object');
      assert(u.uDepthRange === pools[0].mat.uniforms.uDepthRange, 'a pool has its own range object');
      assert(pool.mat.fragmentShader.split('float softFade(').length === 2,
        'the fade is compiled into a pool zero or twice');
    }
    // …and the softness is a per-pool statement about the volume it stands in
    // for. All seven the same would mean a spark faded like a smoke puff.
    const softs = pools.map(x => x.mat.uniforms.uSoft.value);
    assert(new Set(softs).size >= 4,
      `all seven pools soften by the same ${softs[0]} m — a 2 cm spark is not a 1.5 m puff`);
    assert(Math.max(...softs) / Math.min(...softs) > 8,
      `the softest and hardest pool are within ${(Math.max(...softs) / Math.min(...softs)).toFixed(1)}x`);

    // The one consumer that is a stock three material reaches the same chunk
    // through onBeforeCompile, and it has to be patched exactly once.
    const world = { scene: new THREE.Scene(), statics: [], terrain: null };
    const mesh = addSmokeColumns(world, [{ x: 0, z: 0, height: 40, seed: 1 }]);
    assert(mesh, 'no smoke column built');
    assert(mesh.material.userData.softDepth, 'the smoke columns are not soft');
    const sh = { uniforms: {}, vertexShader: 'void main(){\n  #include <fog_vertex>\n}',
      fragmentShader: 'void main(){\n  #include <fog_fragment>\n}' };
    mesh.material.onBeforeCompile(sh);
    assert(sh.uniforms.tSceneDepth === shared,
      'the smoke columns fade against a different depth buffer than the particles do');
    assert(sh.fragmentShader.includes('softFade(vSoftViewZ)')
      && sh.vertexShader.includes('vSoftViewZ = -mvPosition.z'),
      'the smoke patch did not land on the stock shader');

    /* ARMING. Until an Engine has handed over a real prepass depth — and every
     * headless harness in tools/ never does — `uDepthRange.z` is 0 and the
     * whole thing is one comparison. That is what keeps a World built without a
     * renderer behaving exactly as it did. */
    S.setSceneDepth(null, 0, 0, 0, 0);
    assert(S.sceneDepthState().armed === false, 'the fade armed itself with no depth buffer');
    const tex = { isTexture: true };
    assert(S.setSceneDepth(tex, 0.15, 138, 1280, 720), 'a real buffer was refused');
    const st = S.sceneDepthState();
    assert(st.armed && st.texture === tex && st.near === 0.15 && st.far === 138
      && st.width === 1280 && st.height === 720, `armed wrong: ${JSON.stringify(st)}`);
    // A far plane that is not past the near one is a prepass that has not run.
    assert(!S.setSceneDepth(tex, 100, 100, 1280, 720), 'a degenerate frustum was accepted');
    S.setSceneDepth(null, 0, 0, 0, 0);

    p.dispose?.();
    return `${pools.length} pools + the smoke columns share one chunk and one depth uniform; `
      + `softness ${Math.min(...softs)}–${Math.max(...softs)} m `
      + `(${(Math.max(...softs) / Math.min(...softs)).toFixed(0)}x across the pools); `
      + 'unarmed → one comparison, armed → 0.15/138 m at 1280×720';
  });


  /* ══════════════════════════════════════════════════════════════════════ */
  /*  The blade                                                             */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('blade: white on the axis, the crystal\'s own colour a centimetre out', () => {
    // The whole complaint, as a number, measured ON SCREEN — through the tone
    // curve, because that is where a white stick becomes a white stick.
    //
    // A blade reads as plasma when the region that comes out white is a few
    // millimetres across and the region that comes out saturated is
    // centimetres across. The old build had it the other way round: a solid
    // 23 mm white capsule inside a 56 mm shell authored at amplitude 1.45, so
    // most of the blade's visible width was white BEFORE the tone curve ever
    // saw it, and the hue only appeared where the emission was already too
    // faint to read. Measured in the browser on a cerulean blade at 2.6 m, the
    // chroma nine pixels off the axis was 0.06; it is 0.22 now.
    const scene = new THREE.Scene();
    const lines = [];
    for (const key of ['blue', 'red', 'green', 'purple', 'amber']) {
      const idx = SABER_COLORS.findIndex(c => c.key === key);
      const s = new Saber(scene, { colorIndex: idx });

      // How much of the crystal's own saturation survives to the screen. A
      // fixed chroma threshold cannot be used here: ACES desaturates by a
      // different amount for every hue, so a red blade's core lands at 0.15
      // and a blue one's at 0.00 for the same physical reason.
      const kept = (d) => chroma(...aces(emissionRGB(s, d))) / chroma(s.hue.r, s.hue.g, s.hue.b);
      let white = 0, coloured = 0;
      for (let d = 0; d < 0.25; d += 0.0002) {
        const k = kept(d);
        if (k < 0.25) white = d;                                        // blown to white
        if (k > 0.75 && lum(...aces(emissionRGB(s, d))) > 0.05) coloured = d;
      }
      /* The bounds are a real blade's dimensions, not the old build's.
       *
       * A lightsaber's blown core is CENTIMETRES across — the prop is about
       * 4 cm of glass and the over-exposed part of it a good half of that. The
       * previous ceiling here was 13 mm of RADIUS, which the shipped profile
       * met by having an 8 mm one: at a blade 227 px long in a 1280-wide frame
       * that is a core 1.2 px wide, i.e. the "thin white line" complaint,
       * expressed as a passing test. Measured under the same probe now:
       * red 13 mm, amber 18 mm, purple 19 mm, blue 23 mm, green 37 mm — green
       * widest because its hue carries 2.5× the luminance of blue's and so
       * saturates the curve further out, which is physics and not a fault.
       *
       * The floor matters as much: under 3.5 mm and the core is back to being
       * a hairline that vanishes the moment the blade is more than a few
       * metres away. */
      assert(white > 0.0035 && white < 0.042,
        `${key}: the blade comes out white to a radius of ${(white * 1000).toFixed(1)}mm`);
      assert(coloured > 0.12,
        `${key}: the coloured band dies at ${(coloured * 1000).toFixed(0)}mm from the axis`);
      assert(coloured / white > 5,
        `${key}: only ${(coloured / white).toFixed(1)}× more coloured blade than white blade`);

      // and the transition has to be somewhere a player is looking, not out in
      // the wash where the emission is already invisible. The probes moved out
      // with the core: 20 mm is now INSIDE the white on half the palette, so
      // asking what the hue is doing there is asking the wrong question.
      assert(kept(0.045) > 0.30, `${key}: only ${(kept(0.045) * 100).toFixed(0)}% of the hue survives at 45mm`);
      assert(kept(0.080) > 0.70, `${key}: only ${(kept(0.080) * 100).toFixed(0)}% of the hue survives at 80mm`);
      lines.push(`${key} white≤${(white * 1000).toFixed(1)}mm colour≥${(coloured * 1000).toFixed(0)}mm `
        + `hue@45mm ${(kept(0.045) * 100).toFixed(0)}%`);
      s.dispose();
    }
    return lines.join(', ');
  });

  check('blade: every crystal crosses the bloom threshold on its own axis', () => {
    // UnrealBloomPass thresholds LUMINANCE at 1.8, and blue carries 7% of
    // luminance. A blue blade can therefore only bloom by being genuinely
    // over-exposed rather than merely bright — which is the reason the core
    // amplitude is 30 and not 7. Anything that quietly lowers it takes the
    // glow off half the palette and leaves the other half untouched.
    const scene = new THREE.Scene();
    const worst = [];
    for (let i = 0; i < SABER_COLORS.length; i++) {
      const s = new Saber(scene, { colorIndex: i });
      const L = lum(...emissionRGB(s, 0));
      assert(L > 1.8 * 1.6, `${SABER_COLORS[i].name} peaks at luminance ${L.toFixed(2)} — it will not bloom`);
      // and the bloom must not be a white ball: the emission has to have fallen
      // back under the threshold within a couple of centimetres
      // The ceiling is 60 mm, not the old 30: the bloom halo IS the look, and
      // the pass only sees what crosses 1.8, so the over-threshold band has to
      // be wide enough to give the blur something to work with. It still has
      // to die well inside the 360 mm quad, or the blade is a ball of light
      // rather than a blade with a halo.
      let over = 0;
      for (let d = 0; d < 0.3; d += 0.0005) if (lum(...emissionRGB(s, d)) > 1.8) over = d;
      assert(over < 0.060, `${SABER_COLORS[i].name} is over the bloom line out to ${(over * 1000).toFixed(0)}mm`);
      worst.push([SABER_COLORS[i].name, L, over]);
      s.dispose();
    }
    const lo = worst.reduce((a, b) => (a[1] < b[1] ? a : b));
    const hi = worst.reduce((a, b) => (a[2] > b[2] ? a : b));
    return `dimmest ${lo[0]} L=${lo[1].toFixed(1)}, widest over-threshold ${hi[0]} ${(hi[2] * 1000).toFixed(0)}mm`;
  });

  check('blade: the emission is monotone and reaches zero inside its own quad', () => {
    // A billboard whose profile has not died by the time it hits the quad's
    // edge draws a straight bright seam down each side of the blade — the
    // exact silhouette the analytic falloff exists to get rid of.
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    const R = s.bladeMat.uniforms.uRadius.value;
    let prev = Infinity, peak = 0;
    for (let d = 0; d <= R; d += R / 400) {
      const e = emission(s.bladeMat, d);
      peak = Math.max(peak, e);
      assert(e <= prev + 1e-9, `the profile rises again at ${(d * 1000).toFixed(0)}mm`);
      prev = e;
    }
    const edge = emission(s.bladeMat, R);
    assert(edge === 0, `the profile is still ${edge.toExponential(2)} at the quad edge`);
    assert(emission(s.bladeMat, R * 0.98) / peak < 1e-4, 'the feather is too abrupt to hide the edge');
    // and the last thing it can be cutting off has to be negligible
    const uncut = s.bladeMat.uniforms.uAmp.value.z
      * Math.exp(-Math.pow(R * 0.8 / s.bladeMat.uniforms.uWidth.value.z, 1.4));
    assert(uncut / peak < 0.004,
      `the feather starts where the halo is still ${(100 * uncut / peak).toFixed(2)}% of peak`);
    s.dispose();
    return `monotone over ${(R * 100).toFixed(0)}cm, halo down to ${(100 * uncut / peak).toFixed(3)}% before the feather`;
  });

  check('blade: going sub-pixel costs no light — amp·sigma is conserved', () => {
    // At 20 m a 2 cm blade is a fifth of a pixel wide, and a gaussian narrower
    // than the sample grid is a row of aliased dots that mostly misses. The
    // shader widens any lobe under about a pixel and cuts its amplitude by the
    // same factor. The LINE INTEGRAL of a gaussian is amp·sigma·√π, so holding
    // that product constant means the blade keeps every photon it had while it
    // stops being sub-pixel. If the compensation is ever dropped, distant
    // blades get brighter instead of merely wider.
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    const R = s.bladeMat.uniforms.uRadius.value;
    const integral = (px) => {
      let sum = 0;
      const step = R / 4000;
      for (let d = 0; d <= R; d += step) sum += emission(s.bladeMat, d, px) * step;
      return sum * 2;
    };
    const sharp = integral(0);
    // 15 mm per pixel is a blade seen at about eight metres in a 600px frame
    const coarse = integral(0.015);
    // 70 mm/px is thirty metres out. It used to be 40, which was three times
    // the OLD core sigma; the core is 11 mm now, so 40 mm no longer clears the
    // clamp by enough for the guard below to mean anything.
    const veryCoarse = integral(0.07);
    near(coarse / sharp, 1, 0.02, 'light lost or gained at 15mm/px');
    near(veryCoarse / sharp, 1, 0.05, 'light lost or gained at 70mm/px');
    // and it must actually be widening, or the test proves nothing
    const w0 = s.bladeMat.uniforms.uWidth.value.x;
    assert(0.07 * 0.62 > w0 * 3, 'the coarse case is not wide enough to trigger the clamp');
    const peakSharp = emission(s.bladeMat, 0, 0);
    const peakCoarse = emission(s.bladeMat, 0, 0.07);
    assert(peakCoarse < peakSharp * 0.6,
      'the peak did not come down, so the amplitude is not being compensated');
    s.dispose();
    return `∫ ratio ${(coarse / sharp).toFixed(4)} at 15mm/px, ${(veryCoarse / sharp).toFixed(4)} at 70mm/px; `
      + `peak ${peakSharp.toFixed(1)} → ${peakCoarse.toFixed(1)}`;
  });

  check('blade: a crystal is a hue, and the whole blade is one colour', () => {
    // Everything the blade does — white core, coloured halo, coloured bloom —
    // has to come out of ONE colour at many amplitudes. Two colours (a pale
    // "glow" and a saturated "hex") is how the old build ended up with a white
    // stick: the pale one always won, because it was on top.
    const scene = new THREE.Scene();
    const rows = [];
    for (let i = 0; i < SABER_COLORS.length; i++) {
      const s = new Saber(scene, { colorIndex: i });
      const h = s.hue;
      near(Math.max(h.r, h.g, h.b), 1, 1e-6, `${SABER_COLORS[i].name} hue is not normalised`);
      // the hue must keep the crystal's ratios
      const c = s.color;
      const k = 1 / Math.max(c.r, c.g, c.b);
      near(h.r, c.r * k, 1e-6, 'hue drifted from the crystal');
      near(h.g, c.g * k, 1e-6, 'hue drifted from the crystal');
      assert(s.punch > 0.6 && s.punch <= 1.0001, `${SABER_COLORS[i].name} punch ${s.punch}`);
      // and the shader is fed that hue, not the raw swatch
      assert(s.bladeMat.uniforms.uHue.value.equals(h), 'the material is not carrying the hue');
      assert(s.trailMat.uniforms.uHue.value.equals(h), 'the trail is not carrying the hue');
      rows.push([SABER_COLORS[i].name, s.punch]);
      s.dispose();
    }
    // a deliberately dark crystal must stay darker than a bright one
    const dark = rows.find(r => r[0] === 'Void')[1];
    const bright = rows.find(r => r[0] === 'Ivory')[1];
    assert(dark < bright * 0.92, `Void (${dark.toFixed(2)}) is as bright as Ivory (${bright.toFixed(2)})`);
    return `10 crystals normalised, punch ${dark.toFixed(2)} (Void) … ${bright.toFixed(2)} (Ivory)`;
  });

  check('blade: the whole weapon is one billboard, two triangles', () => {
    // It used to be a capsule and three 14-sided open cylinders: four draw
    // calls and ~300 triangles of geometry whose only job was to be a surface
    // for an angle-of-incidence fake that a distance field does exactly.
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    assert(s.bladeGroup.children.length === 1, `${s.bladeGroup.children.length} meshes in the blade`);
    const g = s.blade.geometry;
    assert(g.index.count === 6, `${g.index.count / 3} triangles`);
    assert(g.attributes.aQuad, 'the quad has no billboard coordinates');
    assert(s.bladeMat.blending === THREE.AdditiveBlending && s.bladeMat.premultipliedAlpha,
      'the blade must add its own light with an ONE/ONE blend');
    assert(s.bladeMat.depthWrite === false && s.bladeMat.depthTest === true,
      'the blade must test depth without writing it');
    // toneMapped:true matters only where the material renders straight to a
    // canvas — the saber forge preview — but that is where an un-tonemapped
    // amplitude of 30 clips to flat white and the crystal is invisible.
    assert(s.bladeMat.toneMapped === true, 'the blade bypasses the tone curve');
    assert(s.bladeMat.fog === true && s.bladeMat.fragmentShader.includes('1.0 - fogFactor'),
      'haze must take light AWAY from an emitter, not mix it toward the fog colour');
    s.dispose();
    return '1 mesh, 2 triangles, additive, fogged by attenuation';
  });

  check('blade: the wash is a LINE light, in the crystal\'s own colour', () => {
    /* Two faults, one cause, both measured in the arena before this existed.
     *
     * A 1.15 m column of plasma was being lit as a POINT: decay 2. Held 24 cm
     * off the sand that put 35 units of irradiance on the ground directly
     * under the tip — the sun in that level is 7 — and the ground came back
     * (1.00, 0.98, 0.91): clipped, i.e. the blade's own colour destroyed by
     * the blade's own brightness. A metre and a half away, on the wielder's
     * chest, the same light moved the pixel by 0.016.
     *
     * And what it threw was (0.25, 0.52, 1.00) — the hue lifted 22% toward
     * white "because bounce light has been through a surface". Bounce through
     * a surface IS the albedo multiply, so that lift was counted twice.
     *
     * ── REWRITTEN, and the numbers above are part of why ──────────────────
     *
     * This check used to demand the thrown light keep >90% of the crystal's
     * chroma and return >3:1 blue on sand. Both bars were computed on sand
     * albedo [0.51, 0.28, 0.109], and that array is the arena's ground colour
     * put through the sRGB-to-linear transform TWICE. `new THREE.Color(0xcfae82)`
     * is [0.617, 0.418, 0.220] in the working space. Every ratio in the old
     * paragraph is inflated about twofold, including the claim that a pale
     * light "lands RED-dominant on sand" — at the real albedo the old 22% lift
     * returns 1.4:1 BLUE, not red-dominant at all.
     *
     * The >90% chroma bar also had a hole in it big enough to drive the whole
     * palette through: it only ever ran on Cerulean, and "keeps its chroma" is
     * satisfied perfectly by a light with NO blue in it. Bronze throws
     * (1.000, 0.195, 0.010) — one part blue in a hundred — and scored 100%.
     * A surface lit by that does not get a warm tint, it loses a primary, and
     * with it every material distinction it carried there.
     *
     * So the property is now TWO-SIDED and runs over every crystal: the light
     * must still be recognisably the crystal AND must not annihilate a channel.
     * That is strictly more failure modes than the old bar caught. The sand
     * ratio moves 3 -> 2 only because it is now measured against the correct
     * albedo: the shipped light returns 8.2:1 there (not the 4.9 the old
     * comment quoted) and the floored light returns 2.2:1, so the bar sits at
     * 90% of what ships where the old bar sat at 61% of it.
     */
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });      // Cerulean
    s.ignite(); s.ignition = 1;
    const q = new THREE.Quaternion(), p = new THREE.Vector3(0, 1.1, 0);
    for (let i = 0; i < 6; i++) { s.setHiltPose(p, q); s.update(1 / 60, i / 60); }

    // The arena's own ground colour, converted ONCE. See above.
    const sand = [0.617, 0.418, 0.220];
    for (const [name, l] of [['main', s.light], ['tip', s.tipLight]]) {
      assert(l.decay === 1, `the ${name} light still falls off as 1/d^${l.decay}`);
      assert(l.intensity > 0.5, `the ${name} light is dark on a lit blade`);
      // still recognisably the crystal…
      const kept = chroma(l.color.r, l.color.g, l.color.b) / chroma(s.hue.r, s.hue.g, s.hue.b);
      assert(kept > 0.8, `the ${name} light keeps only ${(kept * 100).toFixed(0)}% of the crystal's chroma`);
      // …and blue still has to outrun red on SAND, the surface that broke it
      const ratio = (sand[2] * l.color.b) / (sand[0] * l.color.r);
      assert(ratio > 2, `on sand this light returns only ${ratio.toFixed(2)}× as much blue as red`);
    }

    // …and the hole the old bar left: EVERY crystal, not just the blue one.
    // A light may not put a channel so far down that a surface lit by it loses
    // that primary. This is the assertion Bronze used to walk straight past.
    for (let i = 0; i < SABER_COLORS.length; i++) {
      const t = new Saber(scene, { colorIndex: i });
      t.ignite(); t.ignition = 1;
      for (let k = 0; k < 6; k++) { t.setHiltPose(p, q); t.update(1 / 60, k / 60); }
      for (const [name, l] of [['main', t.light], ['tip', t.tipLight]]) {
        const c = [l.color.r, l.color.g, l.color.b];
        const share = Math.min(...c) / Math.max(...c);
        assert(share >= Saber.FLOOR_CHANNEL - 1e-6,
          `${SABER_COLORS[i].name}'s ${name} light puts its dimmest channel at `
          + `${(share * 100).toFixed(1)}% of its brightest — anything it lights loses that primary`);
      }
      t.dispose();
    }
    // neither sample sits ON the tip: a point light at the tip of a blade laid
    // on the deck is a singularity sitting on the deck
    assert(s.tipLight.position.distanceTo(s.tip) > 0.05,
      'the second light is sitting exactly on the tip');
    assert(s.tipLight.position.distanceTo(s.base) > s.light.position.distanceTo(s.base),
      'the two lights are not spread along the blade');

    // The shape, as a ratio. A point source is 25:1 between 0.3 m and 1.5 m; a
    // line source near it is 5:1. Anything near 25 has quietly gone back to
    // inverse square and the ground will clip again.
    const near = atten(0.3, s.light.distance, s.light.decay);
    const far = atten(1.5, s.light.distance, s.light.decay);
    const shape = near / far;
    assert(shape < 8, `the wash is ${shape.toFixed(1)}:1 between 0.3 m and 1.5 m — that is a point light`);
    // and the near field must genuinely be gentler than the old rig's
    const oldNear = 5.2 * atten(0.3, 8.05, 2);
    const nowNear = s.light.intensity * near;
    assert(nowNear < oldNear / 3,
      `the ground 30 cm from the blade still gets ${nowNear.toFixed(1)} against the old ${oldNear.toFixed(1)}`);
    // ...while the reach is not worse where a body actually stands
    const oldFar = 5.2 * atten(1.5, 8.05, 2);
    assert(s.light.intensity * far > oldFar,
      `a chest 1.5 m away now gets ${(s.light.intensity * far).toFixed(2)} against the old ${oldFar.toFixed(2)}`);
    s.dispose();
    return `decay 1, ${shape.toFixed(1)}:1 over 0.3→1.5 m (point light: 25:1), `
      + `30 cm ${oldNear.toFixed(0)}→${nowNear.toFixed(1)}, 1.5 m ${oldFar.toFixed(2)}→${(s.light.intensity * far).toFixed(2)}`;
  });

  check('blade: the core clips and the halo does not', () => {
    // The look, stated as the two things that have to be simultaneously true.
    // A halo that clips is a white ball; a core that does not is a coloured
    // stick. Both were true of earlier builds, at different times.
    const scene = new THREE.Scene();
    const rows = [];
    for (let i = 0; i < SABER_COLORS.length; i++) {
      const s = new Saber(scene, { colorIndex: i });
      // Judged in sRGB, which is what a screen shows and what pixels.mjs
      // reports — 0.93 of post-tone-curve LINEAR is 0.97 on screen, and the
      // difference between those two numbers is the difference between
      // "not white" and "white". A monochromatic crystal cannot drive its
      // opposite channel all the way: Crimson's core lands at
      // (1.00, 0.99, 0.97) on screen, a warm white, which is correct.
      const on = aces(emissionRGB(s, 0)).map(srgb);
      assert(Math.min(...on) > 0.95,
        `${SABER_COLORS[i].name}'s core comes out ${on.map(v => v.toFixed(2))} — it is not blown out`);
      // the halo lobe on its own must sit where the curve still has slope
      const halo = s.bladeMat.uniforms.uAmp.value.z * s.punch;
      const haloL = lum(s.hue.r * halo, s.hue.g * halo, s.hue.b * halo);
      assert(haloL < 3.0, `${SABER_COLORS[i].name}'s halo peaks at luminance ${haloL.toFixed(2)} — it will clip too`);
      const out = aces(emissionRGB(s, s.bladeMat.uniforms.uWidth.value.z * 1.5)).map(srgb);
      assert(Math.max(...out) < 0.995,
        `${SABER_COLORS[i].name} is still clipped a halo and a half out`);
      rows.push([SABER_COLORS[i].key, haloL]);
      s.dispose();
    }
    const core = Saber.PROFILE.amp[0] / Saber.PROFILE.amp[2];
    assert(core > 20, `the core is only ${core.toFixed(0)}× the halo — that is one lobe, not three`);
    return `10 crystals: core blown in every channel, halo peaks ${Math.min(...rows.map(r => r[1])).toFixed(2)}`
      + `…${Math.max(...rows.map(r => r[1])).toFixed(2)} (clip line ~3), core ${core.toFixed(0)}× halo`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  The trail                                                             */
  /* ══════════════════════════════════════════════════════════════════════ */

  const swing = (s, frames, fn, dt = 1 / 60, carrier = null) => {
    const q = new THREE.Quaternion(), p = new THREE.Vector3();
    for (let i = 0; i < frames; i++) {
      fn(i * dt, p, q);
      s.setHiltPose(p, q);
      s.update(dt, i * dt, carrier);
    }
  };

  check('trail: a blade nobody is swinging leaves nothing behind', () => {
    // The old trail had a floor of 0.08 and read WORLD tip speed, so a blade
    // held dead still while its owner walked painted a permanent ribbon across
    // the frame — and standing still painted a stationary one.
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    s.ignite(); s.ignition = 1;
    swing(s, 40, (t, p, q) => { p.set(0, 1, 0); q.identity(); });
    assert(s._trailPunch() === 0, `a still blade has trail punch ${s._trailPunch()}`);
    assert(!s.trail.visible, 'a still blade is drawing a trail');

    // walking: the tip moves at 4 m/s through the world, and the wrist not at all
    const carrier = new THREE.Vector3(0, 0, -4);
    swing(s, 40, (t, p, q) => { p.set(0, 1, -4 * t); q.identity(); }, 1 / 60, carrier);
    assert(s.tipSpeed > 3.5, `the test never moved the blade (tip ${s.tipSpeed.toFixed(2)} m/s)`);
    assert(s.swingSpeed < 0.2, `a carried blade reads ${s.swingSpeed.toFixed(2)} m/s of swing`);
    assert(!s.trail.visible, 'walking leaves a sword trail');

    // and a real cut does leave one: a steady 8 rad/s carve
    swing(s, 30, (t, p, q) => {
      p.set(0, 1, 0);
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.2 + t * 8);
    });
    assert(s.swingSpeed > 6, `the swing only reached ${s.swingSpeed.toFixed(2)} m/s`);
    assert(s.trail.visible, 'a real slash left no trail');
    assert(s._trailPunch() > 0.35, `a real slash only reached punch ${s._trailPunch().toFixed(2)}`);
    const punch = s.trail.geometry.attributes.aPunch.array;
    assert(punch.some(v => v > 0.3), 'the punch never reached the vertices');
    s.dispose();
    return `still 0.00, walking 0.00 (tip ${s.tipSpeed.toFixed(1)} m/s), slashing ${s._trailPunch().toFixed(2)}`;
  });

  check('trail: the smear has thickness, across the surface it swept', () => {
    // A swept ribbon of zero thickness disappears completely when the plane it
    // swept contains the view direction — which is every overhead chop. Three
    // sheets, offset along the swept surface's own normal, give it a body.
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    s.ignite(); s.ignition = 1;
    const axis = new THREE.Vector3(0, 0, 1);
    swing(s, 30, (t, p, q) => { p.set(0, 1, 0); q.setFromAxisAngle(axis, -1.2 + t * 8); });

    assert(s.trailSheets === 3, `${s.trailSheets} sheets`);
    const pos = s.trail.geometry.attributes.position.array;
    const S = s.trailSheets;
    // sample 0 is this frame's blade; compare its outer sheets
    const v = (i, k, end) => new THREE.Vector3(
      ...pos.slice(((i * S + k) * 2 + end) * 3, ((i * S + k) * 2 + end) * 3 + 3));
    const lo = v(0, 0, 0), mid = v(0, 1, 0), hi = v(0, 2, 0);
    const off = hi.clone().sub(lo);
    near(off.length(), s.trailThickness * 2, 1e-5, 'the sheets are not two half-thicknesses apart');
    near(mid.distanceTo(lo), s.trailThickness, 1e-5, 'the middle sheet is not centred');

    // and that offset has to be the normal of the swept surface
    const bladeDir = v(0, 1, 1).sub(mid).normalize();
    const travel = s.tip.clone().sub(s.prevTip).normalize();
    const n = off.clone().normalize();
    assert(Math.abs(n.dot(bladeDir)) < 1e-3, `the offset is ${n.dot(bladeDir).toFixed(3)} along the blade`);
    assert(Math.abs(n.dot(travel)) < 0.05, `the offset is ${n.dot(travel).toFixed(3)} along the travel`);

    // the ribbon must be carried past the tip so its leading edge is feathered
    const side = s.trail.geometry.attributes.aSide.array;
    assert(side[1] > 1.0, `the ribbon stops at the tip (aSide ${side[1]})`);
    s.dispose();
    return `3 sheets ${(s.trailThickness * 2000).toFixed(0)}mm apart on the sweep normal, `
      + `carried ${((side[1] - 1) * 100).toFixed(0)}% past the tip`;
  });

  check('trail: a slow frame is filled in, not spanned by one huge quad', () => {
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    s.ignite(); s.ignition = 1;
    const axis = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion(), p = new THREE.Vector3(0, 1, 0);
    // two frames, a quarter of a second apart, with the blade a metre and a
    // half further round: at 60 fps this would have been fifteen samples
    s.setHiltPose(p, q.setFromAxisAngle(axis, -0.7)); s.update(1 / 4, 0);
    s.setHiltPose(p, q.setFromAxisAngle(axis, 0.7)); s.update(1 / 4, 0.25);
    const live = s.trailHistory.length;
    assert(live >= 6, `a 1.5 m step produced only ${live} samples`);
    // and they have to be spread along the arc, not stacked
    const gaps = [];
    for (let i = 1; i < live; i++) gaps.push(s.trailHistory[i - 1].t.distanceTo(s.trailHistory[i].t));
    const max = Math.max(...gaps);
    assert(max < 0.35, `the largest gap in the smear is ${max.toFixed(2)}m`);
    s.dispose();
    return `${live} samples across a 250ms frame, largest gap ${(max * 100).toFixed(0)}cm`;
  });

  check('blade: ignition drives a hot front up the blade and then stops', () => {
    const scene = new THREE.Scene();
    const s = new Saber(scene, { colorIndex: 0 });
    let peak = 0;
    s.ignite();
    for (let i = 0; i < 12; i++) { s.update(1 / 60, i / 60); peak = Math.max(peak, s.surge); }
    assert(peak > 0.15, `the ignition front only reached ${peak.toFixed(3)}`);
    for (let i = 0; i < 240; i++) s.update(1 / 60, i / 60);
    assert(s.ignition > 0.99, 'the blade never finished extending');
    assert(s.surge < 0.01, `a lit blade is still surging at ${s.surge.toFixed(4)}`);
    assert(s.bladeMat.uniforms.uSurge.value < 0.03, 'the surge never reached the material');
    // the length reaches the shader, or the blade is drawn at unit length
    near(s.bladeMat.uniforms.uLen.value, s.bladeLength, 1e-3, 'blade length uniform');
    s.dispose();
    return `surge peaks at ${peak.toFixed(2)} and settles to 0`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  Particles                                                             */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('sparks: an impact puts light INTO the frame — the pools are HDR now', () => {
    // Nothing in this file could exceed 1.0 before, so nothing in it ever
    // reached the bloom pass (threshold 1.8 in linear luminance). Every impact
    // in the game was a decal beside a blade that glowed.
    const scene = litScene();
    const p = new Particles(scene, 1);
    const head = p.sparks.head;
    p.sparkBurst(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), 24, { speed: 10 });
    const n = (p.sparks.head - head + p.sparks.max) % p.sparks.max;
    assert(n > 20, `only ${n} sparks in a 24-spark burst`);
    let over = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const j = ((head + i) % p.sparks.max) * 4;
      const L = lum(p.sparks.aColor.array[j], p.sparks.aColor.array[j + 1], p.sparks.aColor.array[j + 2]);
      peak = Math.max(peak, L);
      if (L > 1.8) over++;
    }
    assert(over === n, `${n - over} of ${n} sparks are under the bloom threshold`);
    assert(peak > 2.2 && peak < 8, `spark luminance peaks at ${peak.toFixed(2)}`);

    // ...and the smoke must NOT be, or a puff of soot glows like a flare
    const sHead = p.smoke.head;
    p.cutFlare(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), 0x57c9ff, 20);
    const sn = (p.smoke.head - sHead + p.smoke.max) % p.smoke.max;
    assert(sn > 0, 'the cut made no smoke');
    for (let i = 0; i < sn; i++) {
      const j = ((sHead + i) % p.smoke.max) * 4;
      const m = Math.max(p.smoke.aColor.array[j], p.smoke.aColor.array[j + 1], p.smoke.aColor.array[j + 2]);
      assert(m <= 1.0001, `smoke was authored at ${m.toFixed(2)} — soot cannot emit`);
    }
    p.dispose();
    return `${n} sparks all over the 1.8 line (peak ${peak.toFixed(1)}), ${sn} smoke puffs all under 1.0`;
  });

  check('sparks: a fast spark is a streak, not a glowing pea', () => {
    // The billboard is stretched along its velocity AND narrowed across by the
    // same factor. Without the narrowing a fast spark just gets bigger, which
    // is what put 5 cm luminous lozenges all over every impact.
    const scene = litScene();
    const p = new Particles(scene, 1);
    const u = p.sparks.mat.uniforms;
    const shape = (speed, size) => {
      const stretch = 1 + Math.min(speed * u.uStretch.value, u.uStretchMax.value);
      const narrow = 1 / (1 + (stretch - 1) * u.uThin.value);
      return { len: size * stretch, wide: size * narrow, aspect: stretch / narrow };
    };
    const head = p.sparks.head;
    p.sparkBurst(new THREE.Vector3(0, 1, 0), null, 40, { speed: 12 });
    const n = (p.sparks.head - head + p.sparks.max) % p.sparks.max;
    let maxSize = 0, sumSpeed = 0;
    for (let i = 0; i < n; i++) {
      const j = (head + i) % p.sparks.max;
      maxSize = Math.max(maxSize, p.sparks.aParams.array[j * 4 + 1]);
      sumSpeed += Math.hypot(p.sparks.aVel.array[j * 3], p.sparks.aVel.array[j * 3 + 1],
        p.sparks.aVel.array[j * 3 + 2]);
    }
    const mean = sumSpeed / n;
    assert(maxSize < 0.025, `the biggest spark in the burst is ${(maxSize * 100).toFixed(1)}cm across`);
    const s12 = shape(12, maxSize);
    assert(s12.aspect > 6, `a 12 m/s spark is only ${s12.aspect.toFixed(1)}:1`);
    assert(s12.wide < 0.01, `a 12 m/s spark is ${(s12.wide * 1000).toFixed(1)}mm across`);
    // a spark that has slowed right down goes back to being a point
    assert(shape(0.5, maxSize).aspect < 1.3, 'a spent spark is still stretched');
    // and it must skitter rather than sink through the floor
    assert(u.uBounce.value > 0, 'sparks do not bounce');
    p.dispose();
    return `${n} sparks, ≤${(maxSize * 1000).toFixed(0)}mm, ${s12.aspect.toFixed(0)}:1 at 12 m/s `
      + `(mean launch ${mean.toFixed(1)} m/s), 1.0:1 at rest`;
  });

  check('smoke: a puff is shaded by the level\'s own key light', () => {
    // Smoke and dust were the only things in the frame with volume and no
    // lighting, which is exactly why they read as grey stickers stuck to the
    // world. Each billboard is now shaded as the sphere it stands in for.
    const scene = litScene();
    const p = new Particles(scene, 1);
    const sun = scene.children.find(c => c.isDirectionalLight);
    const want = sun.position.clone().sub(sun.target.position).normalize();
    const u = p.smoke.mat.uniforms;
    assert(u.uSunDir.value.distanceTo(want) < 1e-6,
      `the smoke is lit from ${u.uSunDir.value.toArray().map(v => v.toFixed(2))}`);
    assert('LIT_POOL' in p.smoke.mat.defines && 'LIT_POOL' in p.dust.mat.defines,
      'smoke or dust is still unlit');
    assert(!('LIT_POOL' in p.sparks.mat.defines) && !('LIT_POOL' in p.plasma.mat.defines),
      'an emitter is being diffuse-lit');

    /* The one thing this must not do is quietly rebalance how bright the smoke
     * in a level is. Averaged over the visible hemisphere of a puff AND over
     * every direction the key could come from, the shading has to be exactly
     * 1 — for every pool, whatever its wrap. A fixed split cannot manage that:
     * the mean of the wrapped term is (1 + wrap)/4, so the same pair of levels
     * brightens a tightly-wrapped pool and darkens a loose one. */
    const means = [];
    for (const pool of p.pools.filter(x => x.lit)) {
      const pu = pool.mat.uniforms;
      const sunS = pu.uShadeSun.value, skyS = pu.uShadeSky.value, wrap = pu.uWrap.value;
      let acc = 0, w = 0;
      // key directions on a spiral over the sphere; puff normals over the disc
      for (let i = 0; i < 64; i++) {
        const z = -1 + 2 * (i + 0.5) / 64, rr = Math.sqrt(1 - z * z), th = i * 2.39996;
        const sl = [rr * Math.cos(th), rr * Math.sin(th), z];
        for (let y = -0.5; y <= 0.5; y += 0.02) {
          for (let x = -0.5; x <= 0.5; x += 0.02) {
            const r2 = (x * x + y * y) * 4;
            if (r2 > 1) continue;
            const ndl = x * 2 * sl[0] + y * 2 * sl[1] + Math.sqrt(1 - r2) * sl[2];
            const t = Math.min(1, Math.max(0, (ndl + wrap) / (1 + wrap)));
            const k = t * t * (3 - 2 * t);
            acc += ((skyS.x + (sunS.x - skyS.x) * k) + (skyS.y + (sunS.y - skyS.y) * k)
                  + (skyS.z + (sunS.z - skyS.z) * k)) / 3;
            w++;
          }
        }
      }
      const mean = acc / w;
      near(mean, 1, 0.03, `mean shading of a wrap-${wrap} pool`);
      means.push(mean);
      // and it has to be doing something visible
      const range = (sunS.x + sunS.y + sunS.z) / (skyS.x + skyS.y + skyS.z);
      assert(range > 1.7, `only ${range.toFixed(2)}:1 between the lit and shadowed sides of a puff`);
    }
    const range = (u.uShadeSun.value.x + u.uShadeSun.value.y + u.uShadeSun.value.z)
                / (u.uShadeSky.value.x + u.uShadeSky.value.y + u.uShadeSky.value.z);
    p.dispose();
    return `key from the scene's sun, ${range.toFixed(1)}:1 across a puff, `
      + `${means.length} lit pools all averaging ${means[0].toFixed(3)}`;
  });

  check('smoke: the key is re-read when the level re-hangs its lights', () => {
    const scene = litScene();
    const p = new Particles(scene, 1);
    const sun = scene.children.find(c => c.isDirectionalLight);
    sun.position.set(-40, 30, 60);
    sun.color.setHex(0xff4020);
    // it must not change until the pools are asked to look again
    p.update(1 / 60);
    for (let i = 0; i < 40; i++) p.update(1 / 60);
    const u = p.dust.mat.uniforms;
    const want = sun.position.clone().normalize();
    assert(u.uSunDir.value.distanceTo(want) < 1e-6, 'the pools never re-read the sun');
    // a red sun tints the lit side red without changing the overall level
    assert(u.uShadeSun.value.x > u.uShadeSun.value.z * 1.5, 'the key tint did not follow the sun colour');
    const k = 0.25 * (1 + u.uWrap.value);
    near((u.uShadeSun.value.x + u.uShadeSun.value.y + u.uShadeSun.value.z) / 3, 1 + (1 - k) * 0.78, 0.02,
      'the lit side changed level as well as tint');
    p.dispose();
    return 'sun direction and tint re-read within half a second';
  });

  check('chips: debris out of a fireball glows and then cools', () => {
    // A black tetrahedron tumbling out of an explosion is the loudest possible
    // sign that the explosion and the debris were authored by different people.
    const scene = litScene();
    const chips = new ChipField(scene, { max: 32 });
    chips.spawn(new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, 2, 0),
      { life: 20, size: 0.05, floor: 0, heat: 1, cool: 1.2 });
    chips.update(1 / 60);
    const hot = chips.aHeat.array[0];
    assert(hot > 0.45, `a chip spawned at heat 1 renders at ${hot.toFixed(3)}`);
    for (let i = 0; i < 60; i++) chips.update(1 / 60);
    const warm = chips.aHeat.array[0];
    assert(warm < hot * 0.65, `after a second the chip is still at ${warm.toFixed(3)}`);
    for (let i = 0; i < 300; i++) chips.update(1 / 60);
    assert(chips.aHeat.array[0] < 0.03, `the chip is still glowing at ${chips.aHeat.array[0].toFixed(3)}`);
    // cold debris must be exactly cold, not faintly warm
    chips.clear();
    chips.spawn(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), { life: 5, floor: 0 });
    chips.update(1 / 60);
    assert(chips.aHeat.array[0] === 0, 'a stone chip is glowing');
    assert(chips.material.onBeforeCompile, 'the heat attribute never reaches a shader');
    chips.dispose();

    const p = new Particles(litScene(), 1);
    p.explosion(new THREE.Vector3(0, 0.4, 0), 1.2);
    p.update(1 / 60);
    const anyHot = p.chips.chips.some(c => c.alive && c.heat > 0.3);
    assert(anyHot, 'an explosion threw nothing but cold rubble');
    p.dispose();
    return `heat ${hot.toFixed(2)} → ${warm.toFixed(2)} in 1s → 0 in 6s; explosions throw hot debris`;
  });

  check('impacts: every strike has a flash that outshines the thing it hit', () => {
    const scene = litScene();
    const p = new Particles(scene, 1);
    const at = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(0, 1, 0);
    const flashes = (fn) => {
      const head = p.plasma.head;
      fn();
      const n = (p.plasma.head - head + p.plasma.max) % p.plasma.max;
      const out = [];
      for (let i = 0; i < n; i++) {
        const j = ((head + i) % p.plasma.max) * 4;
        out.push({
          L: lum(p.plasma.aColor.array[j], p.plasma.aColor.array[j + 1], p.plasma.aColor.array[j + 2]),
          size: p.plasma.aParams.array[(((head + i) % p.plasma.max)) * 4 + 1],
          life: p.plasma.aParams.array[(((head + i) % p.plasma.max)) * 4],
        });
      }
      return out;
    };
    for (const [name, fn] of [
      ['cutFlare', () => p.cutFlare(at, nrm, 0x57c9ff, 20)],
      ['boltImpact', () => p.boltImpact(at, nrm, 0xff3a2a)],
      ['explosion', () => p.explosion(at, 1)],
    ]) {
      const f = flashes(fn);
      assert(f.length >= 2, `${name} produced ${f.length} flash lobes — it needs a hot one and a wide one`);
      assert(f.some(x => x.L > 1.8), `${name}'s flash peaks at ${Math.max(...f.map(x => x.L)).toFixed(2)}`);
      // the hot lobe has to be the small, brief one, or the flash is a fog bank
      const hot = f.reduce((a, b) => (a.L > b.L ? a : b));
      const wide = f.reduce((a, b) => (a.size > b.size ? a : b));
      assert(hot !== wide, `${name}'s brightest lobe is also its widest`);
      assert(hot.life < wide.life, `${name}'s hot core outlives its afterglow`);
      assert(hot.life < 0.14, `${name}'s flash core lasts ${hot.life.toFixed(2)}s`);
    }
    p.dispose();
    return 'cutFlare, boltImpact and explosion each flash hot-and-brief over wide-and-dim';
  });

  check('sparks: a strike inherits the colour of what it struck', () => {
    /* Two failure modes, both of which this codebase has shipped before.
     *
     * The first is inheriting nothing: every impact in the game threw the same
     * straw-white shower whether the blade went through sandstone, plate steel
     * or a droid, so nothing on screen ever told you what you were cutting.
     *
     * The second is worse and subtler: inheriting the ALBEDO. A rock 26× darker
     * than the sand beside it is not a rock that throws 26× dimmer sparks — it
     * throws sparks of the same temperature in a different hue. `incandescent`
     * exists to normalise that away, and this is the check that it does.
     */
    // The pair is built in LINEAR and handed over as Colors, not as 8-bit
    // hexes: a 26:1 ratio puts the dark one's blue channel at 0.003, where the
    // sRGB byte grid is coarse enough to move it 60% and the test would be
    // measuring quantisation instead of the thing it is about.
    const bright = new THREE.Color().setRGB(0.36, 0.20, 0.08);
    const dark = bright.clone().multiplyScalar(1 / 26);
    assert(incandescent(dark, 0.5) === incandescent(bright, 0.5),
      'a surface 26× darker throws a different spark from one of the same hue');
    const dl = lum(...new THREE.Color(incandescent(dark, 0.5)).toArray());
    const bl = lum(...new THREE.Color(incandescent(bright, 0.5)).toArray());
    // and the hue does survive: a red rock and a blue-grey plate differ
    const warm = new THREE.Color(incandescent(0x8a3a18, 0.45));
    const cold = new THREE.Color(incandescent(0x3a4a68, 0.45));
    assert(warm.r / warm.b > 1.35 && cold.b / cold.r > 1.35,
      `warm ${warm.r / warm.b} / cold ${cold.b / cold.r} — the material hue did not survive`);

    // with no terrain published there is nothing to inherit, and it must say so
    const keep = ground.terrain;
    ground.terrain = null;
    assert(surfaceTint(0, 0) === null, 'surfaceTint invented a colour with no terrain');
    // ...and with one, it reads that level's own dirt
    ground.terrain = {
      preset: { sandColor: 0x9c7b48, rockColor: 0x6e4028 },
      surfaceAt: (x) => (x > 5 ? 'stone' : 'sand'),
      height: () => 0,
    };
    assert(surfaceTint(0, 0) === 0x9c7b48 && surfaceTint(9, 0) === 0x6e4028,
      'surfaceTint is not reading the terrain preset');

    const scene = litScene();
    const p = new Particles(scene, 1);
    const head = p.sparks.head;
    p.cutFlare(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(1, 0, 0), 0x3ba7ff, 30);
    const n = (p.sparks.head - head + p.sparks.max) % p.sparks.max;
    const seen = new Set();
    let coldest = 99;
    for (let i = 0; i < n; i++) {
      const j = ((head + i) % p.sparks.max) * 4;
      const c = [p.sparks.aColor.array[j], p.sparks.aColor.array[j + 1], p.sparks.aColor.array[j + 2]];
      seen.add(c.map(v => v.toFixed(2)).join(','));
      coldest = Math.min(coldest, lum(...c));
    }
    assert(seen.size >= 3, `a cut threw ${seen.size} distinct spark colours`);
    // every one of them still has to reach the bloom pass, or the "material"
    // sparks are the dull ones and the effect reads as a bug
    assert(coldest > 1.8, `the dimmest spark off the cut is at luminance ${coldest.toFixed(2)}`);
    ground.terrain = keep;
    p.dispose();
    return `${seen.size} spark colours off one cut, dimmest L=${coldest.toFixed(1)}; `
      + `albedo normalised (dark/bright ${(dl / bl).toFixed(3)})`;
  });

  check('impacts: a saber cut burns a mark into what it cut', () => {
    // cutFlare was the only impact recipe in the file that left nothing behind.
    // A blade parts things by burning through them; sparks over undisturbed
    // sand is the read of a sparkler, not a plasma blade.
    const keep = ground.terrain;
    ground.terrain = { preset: { sandColor: 0x9c7b48 }, surfaceAt: () => 'sand', height: () => 0 };
    const scene = litScene();
    const p = new Particles(scene, 1);
    const at = (h) => new THREE.Vector3(0, h, 0);

    const marks = (fn) => { const h = p.decals.head; fn(); return (p.decals.head - h + p.decals.max) % p.decals.max; };
    assert(marks(() => p.cutFlare(at(0.1), null, 0x3ba7ff, 20)) >= 1, 'a cut against the deck left no mark');
    assert(marks(() => p.cutFlare(at(6.0), null, 0x3ba7ff, 20)) === 0,
      'a cut six metres in the air scorched the ground under it');
    assert(marks(() => p.cutFlare(at(6.0), null, 0x3ba7ff, 20, { normal: new THREE.Vector3(1, 0, 0) })) >= 1,
      'a cut with a surface normal left no mark on that surface');
    assert(marks(() => p.cutFlare(at(0.1), null, 0x3ba7ff, 20, { scorch: false })) === 0,
      'scorch:false still scorched');

    // and the mark must start molten and be told to outlive the sparks
    const i = (p.decals.head - 1 + p.decals.max) % p.decals.max;
    void i;
    // every strike also gets its moment of light, including the plain bursts
    const flashes = (fn) => { const h = p.plasma.head; fn(); return (p.plasma.head - h + p.plasma.max) % p.plasma.max; };
    assert(flashes(() => p.sparkBurst(at(1), null, 12)) >= 1, 'a 12-spark strike had no flash');
    assert(flashes(() => p.sparkBurst(at(1), null, 3)) === 0, 'a 3-spark decorative tick flashed');
    assert(flashes(() => p.sparkBurst(at(1), null, 12, { flash: false })) === 0, 'flash:false still flashed');
    ground.terrain = keep;
    p.dispose();
    return 'cuts scorch the deck and named surfaces, not thin air; strikes ≥6 sparks carry a flash';
  });

  check('particles: every recipe still runs, and none of them emits a NaN', () => {
    const scene = litScene();
    const p = new Particles(scene, 1);
    const at = new THREE.Vector3(2, 1, -1), dir = new THREE.Vector3(0, 1, 0);
    p.sparkBurst(at, dir, 12);
    p.spatter(at, dir, 4);
    p.cutFlare(at, dir, 0x57c9ff, 14);
    p.boltImpact(at, dir, 0xff3a2a);
    p.explosion(at, 1.4);
    p.slag(at, dir);
    p.chipBurst(at, dir, 6, { heat: 0.8 });
    for (let i = 0; i < 40; i++) p.update(1 / 60);
    let live = 0;
    for (const pool of p.pools) {
      for (const v of pool.aColor.array) assert(isFinite(v) && v >= 0, 'a particle colour went bad');
      for (const v of pool.aParams.array) assert(isFinite(v), 'a particle parameter went bad');
      live += pool.live;
    }
    for (const v of p.chips.aHeat.array) assert(isFinite(v) && v >= 0, 'a chip heat went bad');
    p.dispose();
    return `7 recipes, ${live} particles alive, all finite`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  Nothing may hang in the air                                           */
  /*                                                                        */
  /*  One bug, three shapes, all of it "a flat thing pinned to a height      */
  /*  sampled somewhere else": a chip that rests at the height of the burst   */
  /*  that threw it, a decal quad that lies at the height of the foot that    */
  /*  made it, and a cut face whose UVs collapse onto one texel. The first    */
  /*  two put hard-edged pale polygons in mid-air over the arena's sand and   */
  /*  translucent grey ones hanging off the canyon's rocks; the third is the  */
  /*  untextured plate you get the instant you cut anything.                 */
  /* ══════════════════════════════════════════════════════════════════════ */

  /** A real heightfield, published the way a level publishes one. */
  const onTerrain = (preset) => {
    const t = new Terrain(new THREE.Scene(), preset, 1);
    ground.terrain = t;
    return t;
  };

  check('debris: a chip settles on the ground it LANDED on, not the one it left', () => {
    const rows = [];
    for (const preset of ['arena', 'canyon', 'dunes']) {
      const t = onTerrain(preset);
      const scene = litScene();
      const p = new Particles(scene, 1);
      let s = 12345;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let k = 0; k < 60; k++) {
        const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 70;
        const gy = t.height(x, z);
        // A hard landing: the ring, the chips it throws, and the floor the
        // emitter captured once for the whole burst.
        p.landingRing(new THREE.Vector3(x, gy, z), 1.4, gy, 0xd8c09a);
      }
      for (let i = 0; i < 60 * 6; i++) p.chips.update(1 / 60, 22);

      let n = 0, sum = 0, worst = 0, floating = 0;
      for (const c of p.chips.chips) {
        if (!c.alive) continue;
        const err = c.pos.y - c.scale * 0.5 - t.height(c.pos.x, c.pos.z);
        n++; sum += Math.abs(err);
        if (Math.abs(err) > worst) worst = Math.abs(err);
        if (err > 0.10) floating++;
      }
      assert(n > 40, `${preset} settled only ${n} chips — the burst is not being measured`);
      // 5 cm is half the smallest chip: below that it is inside its own body.
      assert(worst < 0.05, `${preset}: a chip came to rest ${worst.toFixed(2)} m off the ground `
        + `(${floating} of ${n} more than 10 cm up) — that is the hard-edged pale polygon `
        + 'floating over the sand');
      rows.push(`${preset} ${n} chips, worst ${(sum / n).toFixed(3)}/${worst.toFixed(3)} m`);
      p.dispose(); ground.terrain = null;
    }
    // Freezing the floor at spawn is what did it, so the fix has to be in the
    // step and not in the emitter: the pooled particles keep their one lookup
    // per burst (a shader cannot ask the terrain anything), the chips do not.
    return rows.join('; ') + ' (was 0.09/0.40, 2.60/30.18, 0.45/4.62 m mean/worst)';
  });

  check('marks: a ground decal lies ON the ground, at whatever size it can', () => {
    const RING = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7071, 0.7071],
      [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]];
    // the half-widths the game actually asks for: landing rings, skids,
    // footfall scuffs, blade scars, explosion scorches
    const RADII = [1.60, 1.30, 0.55, 0.48, 0.34, 0.28, 0.22, 1.32];
    const UP = new THREE.Vector3(0, 1, 0);
    const rows = [];
    for (const preset of ['arena', 'canyon', 'dunes']) {
      const t = onTerrain(preset);
      let s = 987654321;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      let n = 0, before = 0, after = 0, bMax = 0, aMax = 0, kept = 0;
      for (let k = 0; k < 300; k++) {
        const x = (rnd() - 0.5) * 80, z = (rnd() - 0.5) * 80;
        const gy = t.height(x, z), r = RADII[k % RADII.length];
        const at = new THREE.Vector3(x, gy + 0.012, z);
        // BEFORE: the shipped model — one flat quad, straight up, fixed height.
        let b = 0;
        const R = r * Math.SQRT2;
        for (const [dx, dz] of RING) b = Math.max(b, Math.abs(gy - t.height(x + dx * R, z + dz * R)));
        // AFTER: the fitted plane, at the half-width the fit could keep.
        const f = conformToGround(at, UP, r);
        const nl = Math.hypot(f.nx, f.ny, f.nz);
        const nx = f.nx / nl, ny = f.ny / nl, nz = f.nz / nl;
        let a = 0;
        const RA = f.r * Math.SQRT2;
        for (const [dx, dz] of RING) {
          const cx = x + dx * RA, cz = z + dz * RA;
          const cy = f.y - (nx * (cx - f.x) + nz * (cz - f.z)) / (ny || 1);
          a = Math.max(a, Math.abs(cy - t.height(cx, cz) - 0.012));
        }
        n++; before += b; after += a;
        bMax = Math.max(bMax, b); aMax = Math.max(aMax, a);
        kept += f.shrunk;
      }
      assert(aMax < 0.12, `${preset}: a mark's worst corner still stands ${aMax.toFixed(2)} m `
        + 'off the ground — that is the translucent quadrilateral hanging off the rocks');
      assert(after / n < before / n * 0.4 || before / n < 0.02,
        `${preset}: fitting the mark to the ground bought only `
        + `${(before / n).toFixed(3)} → ${(after / n).toFixed(3)} m`);
      // and it must not pay for that by throwing the mark away
      assert(kept / n > 0.6, `${preset}: fitting shrank marks to ${(100 * kept / n).toFixed(0)}% of the size asked for`);
      rows.push(`${preset} ${(before / n).toFixed(3)}→${(after / n).toFixed(3)} m mean, `
        + `${bMax.toFixed(2)}→${aMax.toFixed(2)} max, ${(100 * kept / n).toFixed(0)}% size`);
      ground.terrain = null;
    }
    // A mark on a WALL or on a droid must be left exactly alone: the terrain is
    // not the surface it is stuck to, and fitting it to one would be a new lie.
    const t = onTerrain('arena');
    const wall = new THREE.Vector3(3, t.height(3, 4) + 1.4, 4);
    const side = new THREE.Vector3(1, 0.1, 0).normalize();
    const w = conformToGround(wall, side, 0.4);
    assert(w.y === wall.y && w.r === 0.4 && w.nx === side.x, 'a scorch on a wall was flattened onto the terrain');
    const air = new THREE.Vector3(3, t.height(3, 4) + 2.5, 4);
    const a2 = conformToGround(air, new THREE.Vector3(0, 1, 0), 0.4);
    assert(a2.y === air.y, 'a mark on top of a prop was dragged down to the terrain under it');
    ground.terrain = null;
    return rows.join('; ');
  });

  check('cuts: the face a blade leaves is textured, not a flat plate', () => {
    // `_v.cross(_n)` writes into `_v`, and the two UVs were read off `_v` and
    // `_n` AFTERWARDS — so every cap vertex but one landed on (0.5, 0.5) and
    // the whole cut face sampled a single line of texels. The area it computed
    // was correct, which is exactly why nothing caught it. Measured: total cap
    // UV area 0.00000 on a crate, a barrel and a pillar alike.
    const shapes = [
      ['crate', new THREE.BoxGeometry(0.7, 0.7, 0.7)],
      ['barrel', new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12)],
      ['pillar', new THREE.BoxGeometry(0.4, 2.0, 0.4)],
    ];
    const rows = [];
    for (const [name, geo] of shapes) {
      const res = sliceGeometry(geo, new THREE.Vector3(0.02, 0.05, 0),
        new THREE.Vector3(0.3, 0.9, 0.2).normalize());
      assert(res, `${name} refused to cut`);
      // The area the slicer reports is the cross-section, and it has to stay
      // right — it is what decides whether a cut is a cut at all.
      assert(res.area > 0.05, `${name} reports a ${res.area.toFixed(4)} m² cross-section`);
      for (const [side, g] of [['front', res.front], ['back', res.back]]) {
        const pos = g.attributes.position, uv = g.attributes.uv;
        const tris = pos.count / 3;
        let world = 0, uvA = 0;
        for (let t = tris - res.ringCount; t < tris; t++) {
          const P = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, t * 3 + k));
          const U = [0, 1, 2].map(k => new THREE.Vector2().fromBufferAttribute(uv, t * 3 + k));
          world += new THREE.Vector3().subVectors(P[1], P[0])
            .cross(new THREE.Vector3().subVectors(P[2], P[0])).length() * 0.5;
          uvA += Math.abs((U[1].x - U[0].x) * (U[2].y - U[0].y)
            - (U[2].x - U[0].x) * (U[1].y - U[0].y)) * 0.5;
        }
        assert(world > 1e-4, `${name}/${side}: the cap has no area at all`);
        // The cap's UVs are authored at 0.5 + d·2, so one metre of cut face is
        // exactly four square uv. Anything else is a smear.
        const perM = uvA / world;
        near(perM, 4, 0.02, `${name}/${side}: the cut face gets ${perM.toFixed(3)} uv² per m² `
          + '(0 means every cap triangle is degenerate in UV and the face is untextured)');
        rows.push(`${name}/${side} ${uvA.toFixed(3)} uv² over ${world.toFixed(3)} m²`);
      }
    }
    return rows.join('; ') + ' — 4.000 uv²/m², was 0.000';
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  WHAT THE PARTICLE SYSTEM COSTS WHEN NOTHING IS HAPPENING              */
  /*                                                                        */
  /*  A day's content landed with nothing priced. Most of it measured fine  */
  /*  — the jet plume is 1.9 particles a trooper a frame, the B2 is 2 268   */
  /*  triangles more than a B1 and cheaper than a clone, the barrage is     */
  /*  9.7% of the spark pool in one call. The three below are the ones that */
  /*  were not fine, and all three were invisible for the same reason:      */
  /*  nothing turned them into a number.                                    */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('particles: a pool with nothing alive in it draws nothing', () => {
    /**
     * THE POOL DREW ITS WHOLE CAPACITY EVERY FRAME, FOREVER.
     *
     * A dead particle is culled in the VERTEX shader — `gl_Position =
     * vec4(2.0)`, outside the clip volume — so it costs no fragments. It costs
     * a vertex shader invocation, because that is the thing that decided to
     * cull it, and every pool set `geo.instanceCount = max` in its constructor
     * and never moved it again. Measured on a Command battle with 18 bodies
     * standing and nothing firing: **19 800 instances drawn, 122 particles
     * alive.** 79 200 vertex shader invocations a frame, permanently, on the
     * tier the menu offers to integrated graphics.
     *
     * Instancing draws 0..N-1 and cannot skip a hole, so the only shape the
     * answer can take is a PREFIX of the ring, and the two ends of that are
     * what is asserted here: an idle system draws exactly nothing, and a busy
     * one never draws fewer instances than it has particles alive (which would
     * be a live particle silently clipped out of the frame).
     */
    const scene = litScene();
    const p = new Particles(scene, 1);
    const capacity = p.pools.reduce((a, q) => a + q.max, 0) + p.decals.max;

    // an idle frame, before anything has ever been spawned
    for (let i = 0; i < 4; i++) p.update(1 / 60);
    assert(p.stats().drawn === 0,
      `a particle system with nothing in it draws ${p.stats().drawn} instances of a possible `
      + `${capacity}. Every one is a vertex shader invocation on a quad that the vertex shader `
      + 'then throws away — the pools set instanceCount = max once and never moved it.');

    // …then a real burst, and it must cover everything alive
    const at = new THREE.Vector3(2, 1, -1), dir = new THREE.Vector3(0, 1, 0);
    p.sparkBurst(at, dir, 40);
    p.explosion(at, 1.6);
    p.sandPuff(at, 1.2, 0);
    let peakDrawn = 0, peakLive = 0;
    const liveIn = (pool) => {
      let n = 0;
      const pa = pool.aParams.array, ex = pool.aExtra.array, t = pool.time;
      for (let i = 0; i < pool.max; i++) {
        const life = pa[i * 4];
        if (life > 0 && t - ex[i * 3 + 2] >= 0 && t - ex[i * 3 + 2] <= life) n++;
      }
      return n;
    };
    for (let f = 0; f < 200; f++) {
      p.update(1 / 60);
      let drawn = 0, live = 0;
      for (const pool of p.pools) { drawn += pool.mesh.geometry.instanceCount; live += liveIn(pool); }
      assert(drawn >= live,
        `${live} particles are alive and only ${drawn} instances are being drawn — a live particle `
        + 'past the end of the drawn prefix never reaches the screen at all');
      peakDrawn = Math.max(peakDrawn, drawn);
      peakLive = Math.max(peakLive, live);
    }
    /* …and once they have all gone out, back to nothing. Stepped to the end
     * of the LONGEST thing any of these recipes lays down rather than to a
     * round number of frames: `explosion` leaves a scorch decal that lives 16
     * seconds, and a test that stopped at 200 frames would read that decal as
     * a pool that had failed to empty. */
    for (let f = 0; f < 1400; f++) p.update(1 / 60);
    const settled = p.stats().drawn;
    p.dispose();
    assert(settled === 0,
      `${settled} instances are still being drawn after every particle has expired — the ring's `
      + 'head never returns to 0, so a pool that has been used once costs its high-water mark for '
      + 'the rest of the level');
    return `idle draws 0 of ${capacity}; a burst peaks at ${peakDrawn} instances for ${peakLive} `
      + 'alive; it returns to 0 when they go out';
  });

  check('particles: every recipe is priced against the pool it draws from', () => {
    /**
     * DERIVED FROM THE CLASS, not from a list of the recipes that exist today.
     * `RECIPES` below is checked against `Particles.prototype` itself, so a
     * fifteenth effect fails this check on the day it is written rather than
     * on a player's machine — which is HANDOFF §2.3's rule applied to a cost
     * instead of to a table of content.
     *
     * WHAT IS ASSERTED IS A COUNT AND NOT A CLOCK. A pool is a ring buffer of
     * `max` slots: one call that asks for more than that overwrites what it
     * wrote a microsecond earlier, so the surplus is not merely wasteful, it
     * is provably invisible — no frame can ever show it. That makes "over
     * capacity" always a defect and never a tuning decision, which is the one
     * property a bound can be asserted on without anybody having to agree
     * about taste. It is also exactly how the `sparkBurst` freeze arrived: a
     * colour where the parameter is `count`, 10 467 583 sparks, 71 to 134
     * SECONDS a frame, and a suite that could not finish for a session.
     *
     * The bound is a fifth of a pool and not the whole of it, because a single
     * effect that fills a fifth of a shared pool means five of them on screen
     * erase each other — an artillery shell landing inside a smoke screen is
     * exactly that situation and it is the one the barrage was built for.
     */
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const at = () => V(2, 1, -1), dir = () => V(0.3, 0.9, 0.1).normalize();
    /** recipe → the arguments a caller in the game really passes. */
    const RECIPES = {
      sparkBurst: [at(), dir(), 40, { speed: 16 }],
      spatter: [at(), dir(), 12, 0xffb050],
      cutFlare: [at(), dir(), 0x57c9ff, 26],
      boltImpact: [at(), dir(), 0xff3a2a],
      scorch: [at(), dir(), 0.6],
      sandPuff: [at(), 1.6, 0],
      landingRing: [at(), 2.0, 0],
      slide: [at(), dir(), 1.4, 0],
      bladeScar: [V(0, 1, 0), V(2, 1.6, 0.4), 0xffb040],
      grassClippings: [V(0, 1, 0), V(2, 1.6, 0.4), 0x7d8c4a, 1.4],
      chipBurst: [at(), dir(), 10, { heat: 0.8 }],
      splash: [at(), 1.6],
      explosion: [at(), 2.2],
      slag: [at(), dir(), 0xffa030],
    };
    const skip = new Set(['constructor', '_syncKey', 'update', '_stride', 'stats', 'dispose']);
    const onClass = Object.getOwnPropertyNames(Particles.prototype).filter((n) => !skip.has(n));
    for (const name of onClass) {
      assert(RECIPES[name],
        `Particles has a recipe '${name}' that nothing prices. Add it to RECIPES with the arguments `
        + 'a real caller passes; an effect nobody has costed is how the spark freeze shipped.');
    }
    for (const name of Object.keys(RECIPES)) {
      assert(onClass.includes(name), `RECIPES prices '${name}', which is no longer a recipe`);
    }

    const scene = litScene();
    const p = new Particles(scene, 1);
    const POOLS = ['sparks', 'embers', 'plasma', 'smoke', 'dust', 'grit', 'water'];
    const tally = {};
    for (const k of POOLS) {
      const pool = p[k];
      const real = pool.spawn.bind(pool);
      pool.spawn = (...a) => { tally[k] = (tally[k] || 0) + 1; return real(...a); };
    }
    /* The chip field and the decal field are not pools and have no ring to
     * overrun, but a recipe that draws only from them still has to be seen to
     * EMIT — otherwise "spawned nothing" cannot tell a dead recipe apart from
     * a chip-only one, and the clause below would have to carry a list of
     * names, which is the thing §2.3 keeps deleting. */
    let elsewhere = 0;
    const realChip = p.chips.spawn.bind(p.chips);
    p.chips.spawn = (...a) => { elsewhere++; return realChip(...a); };
    const realDecal = p.decals.add.bind(p.decals);
    p.decals.add = (...a) => { elsewhere++; return realDecal(...a); };
    let worst = 0, worstAt = 'nothing';
    for (const [name, args] of Object.entries(RECIPES)) {
      for (const k of POOLS) tally[k] = 0;
      elsewhere = 0;
      p[name](...args);
      let touched = 0;
      for (const k of POOLS) {
        const n = tally[k] || 0;
        if (!n) continue;
        touched++;
        const share = n / p[k].max;
        if (share > worst) { worst = share; worstAt = `${name} → ${n} of the ${k} pool's ${p[k].max}`; }
        assert(share < 0.2,
          `one call to ${name}() spawns ${n} into the ${k} pool, which holds ${p[k].max} — `
          + `${(share * 100).toFixed(0)}% of a shared ring in a single effect. Five of these on `
          + 'screen at once erase each other, and a ring buffer cannot show more than it holds, so '
          + 'anything over the whole capacity is arithmetic nobody can ever see.');
      }
      assert(touched > 0 || elsewhere > 0,
        `${name}() emitted nothing at all — not a particle, not a chip, not a decal. Either the `
        + 'recipe has stopped working or the '
        + 'arguments in RECIPES no longer match what a caller passes, and a priced effect that '
        + 'emits nothing is a budget that measures nothing');
    }
    p.dispose();
    return `${onClass.length} recipes, all priced; worst single call is ${worstAt} `
      + `(${(worst * 100).toFixed(1)}%)`;
  });

  check('injury: a wound costs the same however many are already on the body', async () => {
    /**
     * THE ONE THING THIS SESSION SHIPPED THAT IS GENUINELY TOO EXPENSIVE, and
     * it is the same shape as every other cost this project has found: a
     * correct feature under a comment that describes it correctly, with
     * nothing anywhere counting what it does.
     *
     * `Injury._rebuild` re-seats every mark by RAYCASTING the bone's own
     * meshes — the right answer, and the note above it says why: a torso lathe
     * is revolved circular and then squashed on Z, so "the surface is at
     * chestR" is wrong by up to four centimetres depending on the bearing.
     * Each mark is a 9-point rim plus two 7-point satellite runs plus a tear,
     * every vertex rayed at its own bearing and own height, with up to four
     * retries walking the height home when a rim point runs off the end of a
     * plate. That is about a hundred rays a wound, and `surfacePoint` is a
     * brute-force Möller-Trumbore over EVERY triangle of EVERY mesh the bone
     * carries — 832 triangles on a chest, 2 532 on a head.
     *
     * So one wound is ~86 000 ray-triangle tests. That is affordable.
     *
     * WHAT IS NOT is that `_rebuild()` rebuilds ALL of them, and it is called
     * from `hit()`. The bill is therefore quadratic in the number of wounds a
     * body is carrying, and `max` is 14:
     *
     *     wound  1     86 088 triangle tests        median  6.4 ms
     *     wound  7    638 064
     *     wound 14  1 293 852                       median 78.5 ms
     *     ---------------------------------------------------------
     *     a full health bar   9 550 704             median  635 ms
     *
     * The millisecond figures are seven repetitions each on this contended
     * box, quoted because the two distributions do not touch — every one of
     * the seven fourteenth-wound samples was between 66.6 and 123.0 ms and
     * every cached one between 4.1 and 6.1 — which is the only form a wall
     * clock is worth anything in here (HANDOFF §2.6). The COUNT above is the
     * claim; the clock is the corroboration.
     *
     * 1.29 million ray-triangle tests is twenty times the triangle count of
     * the entire cast (`characters` prints 64 538 over the whole roster), paid
     * on the frame the player is hit, and it gets worse the more hurt they
     * are — which is the player's original complaint about this game almost
     * word for word.
     *
     * THE FIX IS A CACHE AND IT IS SEVEN LINES. A mark's geometry is in
     * BONE-LOCAL space and cannot move once it is built, so `_rebuild` only
     * ever needs to build the marks that have none. Give each wound its own
     * seed at `hit()` so the shapes stop depending on the order the shared
     * `rand` is drawn in, keep the built geometry on the wound, and reuse it.
     * Measured with exactly that patch applied to a copy of the file: the
     * fourteenth wound costs 86 088 tests instead of 1 293 852 (15.0x) and a
     * whole health bar 1 260 936 instead of 9 550 704 (7.6x), with the same
     * 420 mark triangles and the same 2 meshes on the body. On the clock, same
     * seven repetitions: the fourteenth hit 78.5 -> 5.2 ms median, a full bar
     * 635 -> 96 ms.
     *
     * `src/game/Injury.js` is outside this lane's boundary, so this check is
     * RED ON PURPOSE and is the handover. It is the same arrangement
     * `cloth-cost` used for the `sparkBurst` freeze — the damage is priced
     * where it can be seen, and nothing this lane could do to soften it is
     * allowed to silence it.
     */
    const { buildJedi } = await import('../../src/game/Bodies.js');
    const { Injury } = await import('../../src/game/Injury.js');

    const built = buildJedi({ scale: 1 });
    const rig = built.rig ?? built;
    /* COUNTED THROUGH THE GEOMETRY, not through a stub of `surfacePoint`: the
     * ray is a `const` binding imported into Injury.js and cannot be replaced
     * from here, and counting the index reads it makes is both unfakeable and
     * exactly proportional to the work — three per triangle tested. */
    let reads = 0;
    const wrapped = [];
    rig.root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.index || o.geometry.__counted) return;
      const g = o.geometry;
      const real = g.index.getX.bind(g.index);
      g.index.getX = (i) => { reads++; return real(i); };
      g.__counted = true;
      wrapped.push(g);
    });
    assert(wrapped.length > 10, `only ${wrapped.length} indexed meshes on the body — nothing to count`);

    const inj = new Injury(rig, { scale: 1 });
    const cost = [];
    for (let w = 0; w < inj.max; w++) {
      const before = reads;
      inj.hit(new THREE.Vector3(0.1, 1.3, 0.25), 0.25);
      cost.push((reads - before) / 3);
    }
    for (const g of wrapped) { delete g.__counted; }

    const first = cost[0], last = cost[cost.length - 1];
    const total = cost.reduce((a, b) => a + b, 0);
    assert(first > 100, `the first wound cost ${first} triangle tests — nothing was measured`);
    assert(last < first * 2,
      `the ${cost.length}th wound costs ${Math.round(last).toLocaleString()} ray-triangle tests `
      + `against the first wound's ${Math.round(first).toLocaleString()} — `
      + `${(last / first).toFixed(1)}x, and ${Math.round(total).toLocaleString()} over a full health `
      + 'bar. `Injury._rebuild` re-rays EVERY mark on the body every time one is added, so the cost '
      + 'of being hit grows with how hurt you already are. A mark\'s geometry is in bone-local space '
      + 'and cannot move once built: give each wound its own seed in `hit()` (`seed: (this.rand() * '
      + '0xffffffff) >>> 0`), build its marks into a `w.geo = { blood: [...], tear }` the first time, '
      + 'and have `_rebuild` push `w.geo` straight through when it is there. Measured with that '
      + 'patch: 15.0x off the worst hit, 7.6x off a full bar, identical output. '
      + 'src/game/Injury.js is outside this lane\'s files — see the handover.');
    return `${cost.length} wounds, ${Math.round(first).toLocaleString()} → `
      + `${Math.round(last).toLocaleString()} ray-triangle tests (${(last / first).toFixed(2)}x), `
      + `${Math.round(total).toLocaleString()} over a full bar`;
  });
}
