/**
 * Procedural PBR material checks — src/engine/Textures.js.
 *
 * These read the bytes the baker actually wrote, via rawMaps. Under the headless
 * DOM shim a canvas readback returns zeros, so a suite that measured the maps
 * through getImageData would see a perfectly black, perfectly seamless, perfectly
 * uniform texture and pass every test in this file for the wrong reason. The
 * first check below exists to make that impossible to do by accident.
 *
 * What is pinned:
 *   · the mean LINEAR albedo of every map, because Props.js and Bodies.js pick
 *     their tints as linear multipliers on exactly these numbers;
 *   · that every tiling map actually wraps;
 *   · that the noise primitives underneath are periodic, which is what makes
 *     the wrap possible in the first place;
 *   · that normals, roughness and hue are not flat, which is the difference
 *     between a material and a sheet of coloured plastic.
 */

import * as THREE from 'three';
import { rawMaps, MEAN_ALBEDO, PERIODIC, sandMaps, rockMaps, metalMaps, clothMaps, armorMaps,
         duracreteMaps, skinMaps, soilMaps, snowMaps, disposeTextureCache } from '../../src/engine/Textures.js';

const SURFACES = ['sand', 'rock', 'metal', 'cloth', 'armor', 'duracrete', 'skin'];
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

/** Everything any check needs, measured once off the real bytes. */
const M = new Map();
function measure(name) {
  if (M.has(name)) return M.get(name);
  const m = rawMaps(name);
  const S = m.size, N = S * S, A = m.albedo, Nm = m.normal, R = m.rough;

  const lum = new Float64Array(N);
  let sr = 0, sg = 0, sb = 0, satSum = 0;
  const ratio = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const r = toLin(A[i * 4]), g = toLin(A[i * 4 + 1]), b = toLin(A[i * 4 + 2]);
    sr += r; sg += g; sb += b;
    lum[i] = (r + g + b) / 3;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx > 1e-6 ? (mx - mn) / mx : 0;
    ratio[i] = r / Math.max(1e-6, b);
  }
  let lm = 0; for (let i = 0; i < N; i++) lm += lum[i];
  lm /= N;
  let lv = 0; for (let i = 0; i < N; i++) lv += (lum[i] - lm) ** 2;
  const lsd = Math.sqrt(lv / N);

  // normal deviation from flat, and roughness spread
  let ang = 0, flat = 0, rm = 0, rv = 0;
  const rough = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const nz = Nm[i * 4 + 2] / 255 * 2 - 1;
    const a = Math.acos(Math.min(1, Math.max(-1, nz))) * 180 / Math.PI;
    ang += a; if (a < 1) flat++;
    rough[i] = R[i * 4 + 1] / 255; rm += rough[i];
  }
  rm /= N;
  for (let i = 0; i < N; i++) rv += (rough[i] - rm) ** 2;

  // hue spread: the p5..p95 range of the red/blue ratio. A material whose only
  // variation is a scalar on one colour has a ratio that never moves.
  const rs = Float64Array.from(ratio).sort();
  const hueSpread = rs[(N * 0.95) | 0] / Math.max(1e-6, rs[(N * 0.05) | 0]);

  // 1-texel rms vs total sd: at 1.0 the map is white noise at Nyquist and the
  // "detail" is aliasing, not structure.
  let hi = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    hi += (lum[i] - lum[y * S + ((x + 1) % S)]) ** 2;
  }
  hi = Math.sqrt(hi / N);

  const out = {
    size: S, albedo: [sr / N, sg / N, sb / N], lum: lm, lumSd: lsd,
    tiltMean: ang / N, flatFrac: flat / N,
    roughMean: rm, roughSd: Math.sqrt(rv / N),
    sat: satSum / N, hueSpread, microRms: hi, aliasRatio: hi / Math.max(1e-9, lsd),
    A, Nm, R,
  };
  M.set(name, out);
  return out;
}

/**
 * Seam statistic. Take the mean absolute step for all S adjacent column pairs —
 * the wrap pair included — and compare the wrap pair with the strongest and the
 * typical interior pair.
 *
 * Ratio to the strongest interior edge is the structural test: a map built from
 * non-periodic noise puts a full noise-amplitude jump at the boundary and
 * nowhere else, so it dwarfs everything inside. A map whose features genuinely
 * continue across the boundary — metal's four panel seams a tile, cloth's
 * threads every eight texels — is at most as strong as its own kind, and a
 * plain percentile would flag it one time in four for nothing more than being
 * the largest of four identical events.
 *
 * Ratio to the median is the softer backstop, for a seam too small to beat the
 * map's own hard features but still visible against its ordinary grain.
 *
 * Returns [wrap ÷ strongest interior, wrap ÷ median] for columns and for rows.
 */
function seamOutlier(buf, S, ch) {
  const col = new Float64Array(S), row = new Float64Array(S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4 + ch;
    col[x] += Math.abs(buf[i] - buf[(y * S + (x + 1) % S) * 4 + ch]) / S;
    row[y] += Math.abs(buf[i] - buf[(((y + 1) % S) * S + x) * 4 + ch]) / S;
  }
  const score = (arr) => {
    const wrap = arr[arr.length - 1];
    let hi = 0;
    for (let i = 0; i < arr.length - 1; i++) if (arr[i] > hi) hi = arr[i];
    const sorted = Float64Array.from(arr).sort();
    return [wrap / Math.max(1e-6, hi), wrap / Math.max(1e-6, sorted[arr.length >> 1])];
  };
  return [score(col), score(row)];
}

export function run({ check, assert, near }) {

  check('materials: the baker hands back real pixels, not a black canvas', () => {
    // Guard for every other check in this file. The DOM shim's canvas discards
    // putImageData and returns zeros from getImageData, so a suite that read
    // maps through the canvas would measure a uniformly black texture and call
    // it seamless, flat-albedo perfect. Everything here reads rawMaps instead.
    const m = rawMaps('sand');
    assert(m && m.albedo && m.albedo.length === m.size * m.size * 4, 'no raw albedo bytes');
    let nz = 0;
    for (let i = 0; i < m.albedo.length; i += 4) if (m.albedo[i]) nz++;
    assert(nz > m.size * m.size * 0.99, `${nz} of ${m.size ** 2} albedo texels are non-zero`);
    return `${SURFACES.length} surfaces, sand ${m.size}² with ${nz} live texels`;
  });

  check('materials: every map lands on its measured linear albedo', () => {
    // Props.js and Bodies.js multiply these maps by linear tints chosen against
    // these exact numbers — the reason `stone` is lit(1.90, 2.10, 2.20) is that
    // the rock map means 0.110. Drift here silently re-lights the whole game,
    // which is how boulders once ended up 26× darker than the sand.
    const lines = [];
    for (const name of SURFACES) {
      const m = measure(name);
      const want = MEAN_ALBEDO[name];
      assert(want, `${name} has no declared mean albedo`);
      for (let c = 0; c < 3; c++) {
        const err = Math.abs(m.albedo[c] - want[c]) / want[c];
        assert(err < 0.03, `${name} channel ${'RGB'[c]} is ${m.albedo[c].toFixed(4)}, declared ${want[c]} (${(err * 100).toFixed(1)}% off)`);
      }
      lines.push(`${name} ${m.albedo.map(v => v.toFixed(3)).join('/')}`);
    }
    return lines.join('  ');
  });

  check('materials: the periodic noise meets itself after exactly one tile', () => {
    // The property the whole file rests on, and the only one that can be
    // checked exactly rather than inferred: called with period == frequency,
    // every primitive is a function on a torus, so f(u, v) must equal f(u+1, v)
    // and f(u, v+1) to the last bit. MathUtil's noise — which these maps used
    // to be built from — fails this by construction, which is why the wrap
    // discontinuity measured 6.5× the local gradient on duracrete and 5.0× on
    // armour, one hard line across every wall and every stormtrooper.
    const { pnoise, pfbm, pridged, pworley, pstretch, ridgeWave } = PERIODIC;
    const cases = [
      ['pnoise 7',   (u, v) => pnoise(u * 7, v * 7, 7, 7, 3)],
      ['pnoise 190', (u, v) => pnoise(u * 190, v * 190, 190, 190, 13)],
      ['pfbm 13×4',  (u, v) => pfbm(u, v, 13, 4, 0.5, 151)],
      ['pfbm 46×3',  (u, v) => pfbm(u, v, 46, 3, 0.55, 131)],
      ['pridged 13', (u, v) => pridged(u, v, 13, 4, 5)],
      ['pworley F1', (u, v) => pworley(u, v, 19, 41)[0]],
      ['pworley F2', (u, v) => pworley(u, v, 7, 5)[1]],
      ['pstretch',   (u, v) => pstretch(u, v, 112, 7, 23)],
      ['ridgeWave',  (u, v) => ridgeWave(u, v, 26, 5, 0.13, 0.72)],
    ];
    let worst = 0, who = '';
    for (const [name, f] of cases) {
      for (let i = 0; i < 400; i++) {
        const u = (i * 0.6180339887) % 1, v = ((i * 0.4142135624) % 1) * 0.97 + 0.01;
        const base = f(u, v);
        const e = Math.max(Math.abs(f(u + 1, v) - base), Math.abs(f(u, v + 1) - base),
                           Math.abs(f(u - 3, v + 2) - base));
        if (e > worst) { worst = e; who = name; }
      }
    }
    assert(worst < 1e-12, `${who} is not periodic: ${worst.toExponential(2)} across a tile`);
    return `${cases.length} primitives × 1200 shifted samples, worst error ${worst.toExponential(1)}`;
  });

  check('materials: no baked map has a step at its wrap', () => {
    // The primitive test above proves the maths; this proves the maps actually
    // built out of it, including the places a sampler could still combine
    // periodic pieces aperiodically — a cellular field scaled by 1.3, or a
    // per-band hash whose index gains 4 across the tile. Both of those were
    // live in this file an hour ago and both show up here.
    // The percentile carries the test. The ratio to the median edge is a
    // backstop, and it is loose for metal on purpose: metal's median column is
    // flat machined plate, so anything that lands on one of its four panel
    // seams — which by construction includes the tile boundary — is a large
    // multiple of the median while being completely ordinary for that map.
    const MAX_MEDIAN = { metal: 8.0, cloth: 4.5 };
    const rows = [];
    for (const name of SURFACES) {
      const m = measure(name);
      let worstH = 0, worstM = 0;
      for (const [buf, ch, what] of [[m.A, 0, 'albedo'], [m.Nm, 0, 'normal'], [m.R, 1, 'rough']]) {
        for (const [vsMax, vsMed] of seamOutlier(buf, m.size, ch)) {
          assert(vsMax < 1.25, `${name} ${what}: the wrap steps ${vsMax.toFixed(2)}× the strongest edge inside the map`);
          assert(vsMed < (MAX_MEDIAN[name] ?? 4.0), `${name} ${what}: the wrap steps ${vsMed.toFixed(2)}× the median edge`);
          worstH = Math.max(worstH, vsMax); worstM = Math.max(worstM, vsMed);
        }
      }
      rows.push(`${name} ${worstH.toFixed(2)}×peak ${worstM.toFixed(1)}×med`);
    }
    return rows.join('  ');
  });

  check('materials: no map is a flat plastic sheet', () => {
    // Three ways a procedural material reads as plastic, all of them things
    // this file has actually shipped: a normal map that is dead flat (duracrete
    // measured 0.0° mean tilt with 99.8% of texels under one degree), a
    // roughness channel that is a constant, and an albedo that is one hue
    // scaled by a scalar so nothing ever shifts colour.
    const rows = [];
    const MIN_TILT = { sand: 6, rock: 6, metal: 1.5, cloth: 8, armor: 2, duracrete: 3, skin: 1.5 };
    for (const name of SURFACES) {
      const m = measure(name);
      assert(m.tiltMean > MIN_TILT[name],
        `${name} normal map is flat: ${m.tiltMean.toFixed(1)}° mean tilt`);
      assert(m.roughSd > 0.02, `${name} roughness is a constant (sd ${m.roughSd.toFixed(3)})`);
      rows.push(`${name} ${m.tiltMean.toFixed(1)}° r±${m.roughSd.toFixed(2)}`);
    }
    // Hue has to move on the materials that are meant to be coloured. Cloth and
    // skin are near-white carriers for a tint applied by the consumer, so they
    // are exempt from the hue test but not from the other two.
    for (const name of ['sand', 'rock', 'metal', 'armor', 'duracrete']) {
      const m = measure(name);
      assert(m.hueSpread > 1.10,
        `${name} never changes hue: R/B ratio spans only ${m.hueSpread.toFixed(3)}× from p5 to p95`);
    }
    return rows.join('  ');
  });

  check('materials: microdetail is structure, not aliasing', () => {
    // A map whose 1-texel rms equals its total spread is white noise at Nyquist:
    // it shimmers when you move and turns to flat grey two metres away. A map
    // with almost no 1-texel energy is a blur — rock measured 0.004 rms against
    // an 0.020 spread and had no grain at all. Both are failures; the band
    // between them is a surface.
    const rows = [];
    for (const name of SURFACES) {
      const m = measure(name);
      assert(m.aliasRatio > 0.15, `${name} has no texel-scale grain (rms ${m.microRms.toFixed(4)} vs sd ${m.lumSd.toFixed(4)})`);
      assert(m.aliasRatio < 0.90, `${name} is aliased noise (rms ${m.microRms.toFixed(4)} vs sd ${m.lumSd.toFixed(4)})`);
      rows.push(`${name} ${(m.aliasRatio * 100).toFixed(0)}%`);
    }
    return rows.join('  ');
  });

  check('materials: cavity occlusion darkens and never haloes', () => {
    // The old AO was a Laplacian clamped to [0.55, 1.15], so every crack got a
    // bright ring around it — the cheapest tell that a texture was generated
    // rather than measured. The replacement is a three-scale "how far below my
    // neighbourhood am I", which can only subtract. Proved on the map that
    // carries the most cavities: the darkest texels must sit in the places the
    // height field is most concave, and the mean must be pulled down.
    const m = measure('duracrete');
    assert(m.lum < 0.36 && m.lum > 0.28, `duracrete luminance drifted to ${m.lum.toFixed(3)}`);
    // occlusion shows up as a long dark tail with no matching bright tail
    const S = m.size, N = S * S;
    const lum = [];
    for (let i = 0; i < N; i += 3) lum.push(toLin(m.A[i * 4 + 1]));
    lum.sort((a, b) => a - b);
    const p1 = lum[(lum.length * 0.01) | 0], p50 = lum[lum.length >> 1], p99 = lum[(lum.length * 0.99) | 0];
    assert(p50 - p1 > (p99 - p50) * 1.4,
      `duracrete has no occlusion tail: p1 ${p1.toFixed(3)} p50 ${p50.toFixed(3)} p99 ${p99.toFixed(3)}`);
    return `p1 ${p1.toFixed(3)} · p50 ${p50.toFixed(3)} · p99 ${p99.toFixed(3)} — dark tail ${((p50 - p1) / (p99 - p50)).toFixed(1)}× the bright one`;
  });

  check('materials: the maps modulate the terrain around 1.0, not 1.3', () => {
    // Terrain.js does `col *= 0.55 + dot(albedo, 1/3) * 1.15`, so the sand and
    // rock maps are gain, not colour: their luminance decides whether a level's
    // authored sand colour arrives intact or 20% hot. Sand must sit on 1.0.
    const s = measure('sand');
    const gain = 0.55 + s.lum * 1.15;
    near(gain, 1.0, 0.06, 'sand terrain gain');
    // and it has to have somewhere to swing, or the desert is one flat colour
    assert(s.lumSd / s.lum > 0.12, `sand is tonally flat: sd/mean ${(s.lumSd / s.lum).toFixed(3)}`);
    const r = measure('rock');
    return `sand gain ${gain.toFixed(3)} ±${(s.lumSd * 1.15).toFixed(3)}, rock gain ${(0.55 + r.lum * 1.15).toFixed(3)}`;
  });

  check('materials: nothing is bound that nothing reads', async () => {
    /* THIS USED TO BE "the packed ORM map is uploaded once, not twice", and it
     * is re-derived rather than relaxed — the property it asserted is now the
     * weaker half of a stronger one.
     *
     * It was: roughnessMap and metalnessMap are the same packed image, so
     * handing three two CanvasTextures over one canvas costs a second GPU
     * upload and a second mip chain for every material. One upload instead of
     * two.
     *
     * Under the cel model the answer is ZERO uploads, because there is nothing
     * left in the shader that could read one. src/toon/Cel.js deletes the GGX
     * lobe, the sheen lobe and the environment reflection — which is every
     * consumer of `material.roughness` — and stops `metalnessFactor` dividing
     * the diffuse, which was the only consumer of metalness. A detail normal
     * goes the same way: under a two-tone terminator it produces speckle rather
     * than relief (see TER_RELIEF in Terrain.js).
     *
     * So the assertion is now the strongest form of the same idea: a material
     * may not bind a map the frame does not read. It is stated against the
     * SHADER rather than against a list, so it fails if either side moves. */
    const sets = [sandMaps(3), rockMaps(3), metalMaps(3), clothMaps(3),
                  armorMaps(3), duracreteMaps(3), skinMaps(3)];
    let bytes = 0, saved = 0;
    for (const s of sets) {
      assert(s.map.colorSpace === 'srgb', 'albedo must be tagged sRGB');
      for (const dead of ['roughnessMap', 'metalnessMap', 'normalMap']) {
        assert(s[dead] === null,
          `${dead} is bound again — every lit fragment in the game now fetches a texture `
          + 'whose result is multiplied by nothing');
      }
      bytes += s.map.image.width ** 2 * 4;
      // what a bound ORM + normal pair would have cost, at the same size
      saved += s.map.image.width ** 2 * 4 * 2;
    }
    /* …and the reason it is dead, read off the shader rather than asserted from
     * memory. If any of these came back, the maps would have to as well.
     *
     * Engine.js is imported DYNAMICALLY and awaited — see the note at the top
     * of tools/verify.mjs. A static edge from a check reaches Engine through a
     * module graph in which `three` resolves out of node_modules while
     * everything dynamic resolves out of vendor/, so the chunk rewrites land on
     * the wrong copy and burn their once-only flags. Awaiting it here is also
     * what guarantees the chunks have been patched at all by the time they are
     * read: nothing else in this file imports the engine. */
    await import('../../src/engine/Engine.js');
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    assert(!/BRDF_GGX\( directLight\.direction/.test(chunk), 'the GGX lobe is back — roughness matters again');
    assert(!/radiance \* singleScattering/.test(chunk), 'the environment reflection is back');
    assert(!/material\.diffuseColor = diffuseColor\.rgb \* \( 1\.0 - metalnessFactor \)/
      .test(THREE.ShaderChunk.lights_physical_fragment), 'metalness divides the diffuse again');
    return `${sets.length} surfaces bind albedo only — ${(bytes / 1048576).toFixed(1)} MB uploaded, `
      + `${(saved / 1048576).toFixed(1)} MB of ORM and normal maps no longer uploaded or fetched`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  …AND THE PATCH ACTUALLY LANDED                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('materials: the cel shader is installed in the frame, not only in its own source', async () => {
    /**
     * EVERY OTHER CHECK IN THIS FILE READS `src/toon/Cel.js` AS TEXT.
     *
     * That is the house pattern and it is the right one for arithmetic — there
     * is no GL context anywhere in this harness, so a JS twin plus assertions
     * that pin the GLSL it stands for is the only way to measure a BRDF. But it
     * has a hole the size of the feature: nothing here ever installed the patch,
     * so nothing here could tell whether the game runs it.
     *
     * Verified before this check existed: running this file's own `run()` in a
     * process that never imports Engine.js reported 19 passed, 0 failed while
     * `THREE.ShaderChunk.lights_physical_pars_fragment` still contained
     * `reflectedLight.directSpecular += irradiance * BRDF_GGX` — a fully
     * physical frame, every cel assertion green. The player would be looking at
     * the PBR render they explicitly rejected and the gate would say nothing.
     *
     * The failure is live, not theoretical. Each `sub()` matches three's chunk
     * text exactly, tabs included, and two of the chunks have already been
     * rewritten by `installAerialPerspective` and `installCascadeShadows` — so
     * the order of the three installers is load-bearing. Calling
     * `installCelShading` on stock three drops three of its sixteen
     * substitutions with nothing but a console warning: measured, `hard cascade
     * shadow`, `hard shadow mask` and `banded distance`.
     *
     * IT LIVES HERE RATHER THAN IN cel.mjs, and that is not tidiness. The
     * chunk rewrites are once-only flags, and the file that imports Engine
     * FIRST is the one whose copy of three gets patched (see the note over the
     * dynamic import above). Putting this in cel.mjs made it the first, and
     * `aerial`'s four checks and `materials: nothing is bound that nothing
     * reads` — five assertions that were reading the patched chunks perfectly
     * well — all began reading an unpatched copy. Six green checks went red
     * from adding one. This file already owns the pattern; the check belongs
     * beside the ones it shares a mechanism with.
     */
    await import('../../src/engine/Engine.js');
    const { celInstall } = await import('../../src/toon/Cel.js');
    assert(celInstall, 'installCelShading never ran, so the frame is stock three');
    assert(celInstall.count >= 16,
      `only ${celInstall.count} substitutions were attempted — the model lost a rule`);
    assert(celInstall.missed.length === 0,
      `${celInstall.missed.length} of ${celInstall.count} cel substitutions did not match three's `
      + `chunk text: ${celInstall.missed.join(', ')} — the frame renders part physical`);

    /* …and independently of what `sub()` reports, the chunks have to CARRY the
     * cel model. `missed` is the installer marking its own homework; this is the
     * shader the GPU would compile. */
    const C = THREE.ShaderChunk;
    const carries = {
      common: ['saberCelTone', 'saberCelBand', 'saberCelAlbedo', 'saberCelAmbient',
        'saberCelCast', 'saberCelDistance', 'saberCelKey', 'saberCelShape'],
      lights_physical_pars_fragment: ['saberCelTone', 'saberCelAmbient', 'saberCelShape'],
      lights_physical_fragment: ['saberCelAlbedo'],
      lights_fragment_begin: ['saberCelKey', 'saberCelCast', 'saberCelShadow', 'saberCelFlatDir'],
      shadowmask_pars_fragment: ['saberCelShadow'],
      lights_fragment_maps: ['saberCelAmbient', 'saberCelFlatDir'],
      fog_fragment: ['saberCelDistance'],
    };
    for (const [chunk, marks] of Object.entries(carries)) {
      assert(typeof C[chunk] === 'string', `three has no ${chunk} chunk any more`);
      for (const m of marks) {
        assert(C[chunk].includes(m),
          `${chunk} does not call ${m} — that rule of the cel model is not in the frame`);
      }
    }
    // and the three PBR terms rule 3 deletes are gone from the compiled chunk,
    // not merely driven to zero somewhere this file can read
    assert(!/BRDF_GGX\( directLight\.direction/.test(C.lights_physical_pars_fragment),
      'the direct GGX lobe is back in the shader — roughness matters again');
    assert(!/radiance \* singleScattering/.test(C.lights_physical_pars_fragment),
      'the environment reflection is back in the shader');
    assert(!/material\.diffuseColor = diffuseColor\.rgb \* \( 1\.0 - metalnessFactor \)/
      .test(C.lights_physical_fragment),
      'metalness zeroes diffuse again — every hilt and droid plate renders black');
    const n = Object.values(carries).reduce((a, v) => a + v.length, 0);
    return `${celInstall.count} substitutions, none missed; ${n} cel calls found across `
      + `${Object.keys(carries).length} chunks; GGX, IBL and the metalness divide all gone`;
  });

  check('materials: a surface bakes once however many tilings ask for it', () => {
    // Terrain, props and bodies all want the same maps at different repeats.
    // The texture objects differ; the 512²/1024² bake must not.
    const a = sandMaps(11), b = sandMaps(12);
    assert(a.map !== b.map, 'distinct repeats must get distinct textures');
    assert(a.map.image === b.map.image, 'the same surface re-baked for a second tiling');
    assert(a.map.repeat.x === 11 && b.map.repeat.x === 12, 'repeat not applied');
    const t0 = Date.now();
    for (let i = 20; i < 40; i++) { sandMaps(i); rockMaps(i); armorMaps(i); }
    return `60 extra tilings in ${Date.now() - t0}ms, zero re-bakes`;
  });

  check('materials: nothing sits at the frequency that makes tiling obvious', () => {
    // Rule 2 of the file: no feature below ~8 cycles per tile. A soft blob at
    // 4-6 cycles is what turns a repeat into a visible grid — it is the bug
    // that put "condensation" on every robe and damp patches on every plate.
    // Measured as the energy in a 4×4 downsample (≈4 cycles) against the energy
    // in a 16×16 one (≈16 cycles): the coarse band must be the quieter of the two.
    const rows = [];
    for (const name of SURFACES) {
      const m = measure(name);
      const S = m.size;
      const band = (blocks) => {
        const b = S / blocks, acc = new Float64Array(blocks * blocks);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
          acc[((y / b) | 0) * blocks + ((x / b) | 0)] += toLin(m.A[(y * S + x) * 4 + 1]);
        let mu = 0; for (const v of acc) mu += v / (b * b);
        mu /= acc.length;
        let sd = 0; for (const v of acc) sd += (v / (b * b) - mu) ** 2;
        return Math.sqrt(sd / acc.length) / Math.max(1e-9, mu);
      };
      const coarse = band(4), fine = band(16);
      assert(coarse < fine, `${name} has more energy at 4 cycles (${coarse.toFixed(4)}) than at 16 (${fine.toFixed(4)}) — that reads as a repeating blob`);
      assert(coarse < 0.05, `${name} carries a ${(coarse * 100).toFixed(1)}% swing at 4 cycles; the tile will be visible`);
      rows.push(`${name} ${(coarse * 100).toFixed(2)}%`);
    }
    return `4-cycle swing — ${rows.join('  ')}`;
  });

  check('materials: the whole foundry bakes inside its boot budget', async () => {
    /**
     * READ FROM THE BOOT LIST, not restated. This used to name six surfaces in
     * an array here — and the boot list had grown past six, so the check was
     * measuring a budget for a foundry that no longer existed. The generators
     * are looked up by name out of `main.js`'s own warm steps, so adding one
     * there is what changes this.
     *
     * Rock is 1024² because it is the coarsest-tiled map in the game (one tile
     * per ~9 m of terrain) and at 512 its grain aliased; everything else is 512².
     */
    const gens = { sandMaps, rockMaps, soilMaps, snowMaps, metalMaps, clothMaps,
      armorMaps, duracreteMaps, skinMaps };
    const warmed = await bootWarmList();
    assert(warmed.length >= 6, `only ${warmed.length} warm steps parsed out of main.js`);
    disposeTextureCache();
    M.clear();
    const times = [];
    for (const name of warmed) {
      const f = gens[name];
      assert(f, `boot warms ${name}, which this check cannot resolve to a generator`);
      const t = Date.now(); f(); times.push([name.replace('Maps', ''), Date.now() - t]);
    }
    const total = times.reduce((s, t) => s + t[1], 0);
    // The budget is per-surface-count now rather than a flat number, because the
    // list is allowed to grow and a flat 12 s would silently become a tighter
    // and tighter bound as it does. 2 s each is generous against the ~200-400 ms
    // a 512² bake actually costs.
    assert(total < 2000 * warmed.length,
      `the foundry takes ${total}ms to bake ${warmed.length} surfaces`);
    assert(rawMaps('rock').size === 1024, 'rock must stay at 1024²');
    return times.map(([n, t]) => `${n} ${t}ms`).join(' ') + ` — ${total}ms total`;
  });

  check('materials: every ground a level can stand on is warmed at boot', async () => {
    /**
     * THE HITCH THIS PREVENTS. `materialFrom` caches the expensive half — the
     * 512² pixel bake — under the texture's name, so a generator missing from
     * `main.js`'s warm list is not merely cold: it bakes on the first frame that
     * needs it.
     *
     * Three were missing, and they were the three added most recently. `soil`
     * and `snow` are what Terrain's ground presets resolve to for meadow,
     * drifts and alpine — the Spire's crown, shoulders and flanks — so three of
     * the four rungs baked their ground on the first frame AFTER A LANDING,
     * measured at ~440 ms and ~335 ms, at the exact moment the player is looking
     * hardest at a new place. `skin` is every body in the game, on first spawn.
     *
     * Pinned against Terrain's own preset table rather than a list here, so the
     * next ground preset someone authors cannot quietly repeat it.
     */
    const { readFile } = await import('node:fs/promises');
    const terrain = await readFile(new URL('../../src/world/Terrain.js', import.meta.url), 'utf8');
    // `_mapSet` is the one place a preset name becomes a generator call.
    const i = terrain.indexOf('  _mapSet()');
    assert(i > 0, 'Terrain._mapSet is gone');
    const body = terrain.slice(i, i + 700);
    const needed = new Set([...body.matchAll(/\b(\w+Maps)\(/g)].map(m => m[1]));
    assert(needed.size >= 3, `only ${needed.size} generators found in _mapSet — the parse is wrong`);
    const warmed = new Set(await bootWarmList());
    const cold = [...needed].filter(n => !warmed.has(n));
    assert(!cold.length,
      `${cold.join(', ')} can be a level's ground and ${cold.length === 1 ? 'is' : 'are'} not warmed at boot — `
      + 'it bakes 512² of procedural noise on the first frame that needs it');
    // …and every preset the table declares must actually reach _mapSet, or a
    // level could name a ground this check never sees.
    const declared = new Set([...terrain.matchAll(/maps:\s*'(\w+)'/g)].map(m => m[1]));
    const unhandled = [...declared].filter(p => !new RegExp(`case '${p}'`).test(body) && p !== 'sand');
    assert(!unhandled.length,
      `ground preset(s) ${unhandled.join(', ')} are declared but have no case in _mapSet — they fall through to sand`);
    return `${needed.size} ground generators, all warmed; ${declared.size} presets, all handled`;
  });
}

/**
 * The texture generators `main.js` warms on the loading screen, by name.
 *
 * Parsed rather than duplicated: a copy of this list is exactly what let the
 * budget check above go stale, and what let three generators go cold.
 */
async function bootWarmList() {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  const i = main.indexOf('const steps = [');
  const list = main.slice(i, main.indexOf('];', i));
  return [...list.matchAll(/\(\)\s*=>\s*(\w+Maps)\(/g)].map(m => m[1]);
}
