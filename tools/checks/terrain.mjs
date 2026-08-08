/**
 * Ground, cover, water and the air between them.
 *
 * Everything pinned here was measured off the real heightfield and the real
 * shader source, because every one of these faults rendered without an error
 * and looked entirely plausible in the code:
 *
 *   · the dune sea composed to ONE colour — 46% of the map was the bare base
 *     coat with nothing layered on it, and the albedo across the whole 560 m
 *     field varied by 12% in luminance and 0.03 in chroma. No amount of ripple
 *     detail rescues a landscape that is one hue;
 *   · the ground had no occlusion of any kind, so a hollow, a gully and a
 *     ripple trough all received the full hemisphere plus the full probe and
 *     nothing on the surface had any form except what N·L gave it — which at a
 *     26° sun is almost nothing;
 *   · the sand map carries two ripple trains crossing at 33°, and the material
 *     bombed two ROTATED taps of it and took the brighter one per pixel, which
 *     multiplies the lattice: the desert came out as woven matting. The
 *     near-field detail tap then crossed both at 50° and four centimetres;
 *   · curving the ripples by spinning the sampling frame put a visible swirl
 *     with an eye in it wherever the map was far from the world origin, because
 *     the rotation scales the tile by |p|·dθ/dx;
 *   · the near grass ring covered 6.8% of its own ground with silhouette. Nine
 *     parts bare sand to one part grass is a pincushion, not a meadow;
 *   · the river was a plane at a constant height with a hard straight edge and
 *     no idea what was underneath it.
 *
 * None of those throw. They just make it look like a hobby project.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { GrassField, Water, ground } from '../../src/world/Scenery.js';

const PRESETS = ['dunes', 'arena', 'canyon', 'hangar'];
const OUTDOOR = ['dunes', 'arena', 'canyon'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c) => {
  const M = Math.max(c[0], c[1], c[2]);
  return M < 1e-6 ? 0 : (M - Math.min(c[0], c[1], c[2])) / M;
};
const mix3 = (a, b, w) => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];

/* ── the shader's own noise, in JS ───────────────────────────────────── */
const thash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function tnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = thash(ix, iy), b = thash(ix + 1, iy);
  const c = thash(ix, iy + 1), d = thash(ix + 1, iy + 1);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
function tfbm(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 3; i++) { s += tnoise(x, y) * a; x = x * 2.07 + 17.3; y = y * 2.07 + 17.3; a *= 0.5; }
  return s * 1.1428;
}

/**
 * The terrain fragment shader's layer weights and composed albedo, in JS,
 * driven by the REAL uniforms of a REAL Terrain so the two cannot drift apart
 * silently. Statistics on a screenshot can only ever suggest that a landscape
 * is one colour; this is the composition itself.
 */
function composeSurface(t) {
  const u = t._uniforms;
  const B = u.uBands.value, G = u.uGround.value, M = u.uMacro.value, RU = u.uRockUp.value;
  const V3 = (c) => [c.r, c.g, c.b];
  const base = V3(u.uBaseCol.value), grit = V3(u.uGritCol.value);
  const dust = V3(u.uDustCol.value), crust = V3(u.uCrustCol.value);
  const lag = V3(u.uLagCol.value), sheet = V3(u.uSheetCol.value);
  const rockA = V3(u.uRockCol.value), rockB = V3(u.uRockCol2.value);
  const patchF = u.uMix.value.y, macroF = M.x;

  const R = t.res, n = new THREE.Vector3();
  const step = Math.max(1, Math.floor(R / 200));
  const out = { cols: [], ao: [], layers: { rock: 0, grit: 0, drift: 0, crust: 0, lag: 0, sheet: 0 }, bare: 0, n: 0 };
  for (let j = 2; j < R - 2; j += step) {
    for (let i = 2; i < R - 2; i += step) {
      const k = j * R + i;
      const x = -t.half + i * t.step, z = -t.half + j * t.step;
      t._vertexNormal(i, j, n);
      const slope = 1 - clamp(n.y, 0, 1);
      const y = t.heights[k];
      const conc = (t.landform[k * 4] / 255) * 2 - 1;
      const open = t.landform[k * 4 + 1] / 255;
      const upl = (t.landform[k * 4 + 2] / 255) * 2 - 1;
      const expo = (t.landform[k * 4 + 3] / 255) * 2 - 1;
      const mA = tfbm(x / 74, z / 74);
      const mB = tnoise(x * patchF, z * patchF);
      const mC = tnoise(x * 0.85, z * 0.85);
      const mD = tnoise(x * macroF, z * macroF) * 0.68
        + tnoise(x * macroF * 2.37 + 9.1, z * macroF * 2.37 + 9.1) * 0.32;
      const hollow = clamp(conc, 0, 1), crest = clamp(-conc, 0, 1);
      const basin = clamp(-upl, 0, 1), lee = clamp(-expo, 0, 1);
      const encl = clamp(1 - open * 2, 0, 1);

      const rockW = smoothstep(B.x, B.y, slope + (mB - 0.5) * 0.14
        + smoothstep(RU.y, RU.z, y) * RU.x);
      const gritW = smoothstep(B.z, B.w, slope + (mC - 0.5) * 0.09) * (1 - rockW);
      const scour = crest * clamp(expo * 1.3 + 0.3, 0, 1);
      const driftW = clamp(hollow * 1.25 + lee * 0.5 - 0.12, 0, 1) * (1 - rockW)
        * smoothstep(B.w * 1.6, 0, slope);
      const crustW = clamp(G.y * smoothstep(0.13, 0.02, slope)
        * smoothstep(0.25, 0.72, basin) * (0.55 + mA * 0.85), 0, 1);
      const lagW = smoothstep(0.47, 0.61, mD + scour * 0.14 - hollow * 0.10) * M.y * (1 - rockW);
      const sheetW = smoothstep(0.44, 0.28, mD - hollow * 0.10 - lee * 0.08) * M.z * (1 - rockW);

      let col = base;
      col = mix3(col, lag, lagW);
      col = mix3(col, sheet, sheetW);
      col = mix3(col, grit, Math.min(1, gritW * 0.9 + scour * 0.16));
      col = mix3(col, dust, driftW * 0.85);
      col = mix3(col, crust, crustW);
      if (rockW > 0.004) col = mix3(col, mix3(rockA, rockB, 0.5), rockW);
      const macro = 0.90 + mA * 0.22 + upl * 0.07 - basin * 0.06 + open * 0.05;
      out.cols.push([col[0] * macro, col[1] * macro, col[2] * macro]);
      // landform occlusion only; the map's own cavity is texture, not landform
      out.ao.push(clamp(1 - (hollow * 0.30 + encl * 0.20 + driftW * 0.10) * M.w + crest * 0.05, 0.28, 1.06));

      out.layers.rock += rockW; out.layers.grit += gritW; out.layers.drift += driftW;
      out.layers.crust += crustW; out.layers.lag += lagW; out.layers.sheet += sheetW;
      const covered = Math.min(1, rockW) + Math.min(1, gritW * 0.9 + scour * 0.16) * (1 - rockW)
        + driftW * 0.85 + crustW + lagW + sheetW;
      if (covered < 0.15) out.bare++;
      out.n++;
    }
  }
  return out;
}

const spread = (vals) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
  return { mean: m, sd: Math.sqrt(Math.max(0, v)) };
};

/** Cache — a 340² Terrain plus its landform bake is not free. */
const built = new Map();
function terrainOf(name, q = 1.0) {
  const key = `${name}@${q}`;
  if (!built.has(key)) built.set(key, new Terrain(new THREE.Scene(), name, q));
  return built.get(key);
}
const surfaces = new Map();
function surfaceOf(name) {
  if (!surfaces.has(name)) surfaces.set(name, composeSurface(terrainOf(name)));
  return surfaces.get(name);
}

export function run({ check, assert, near }) {

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Ground material                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: no level composes to one colour at three brightnesses', () => {
    // The failure this replaces was not subtle and did not look like a bug: the
    // dune sea spent 46% of its area on the bare base coat and varied by 12% in
    // luminance across 560 m, because every layer that could have broken it up
    // was gated behind a slope or a hollow the dune sea does not have.
    const lines = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const L = spread(s.cols.map(lum));
      const C = spread(s.cols.map(chroma));
      const bare = s.bare / s.n;
      assert(L.sd / L.mean > 0.18,
        `${name}: albedo luminance varies by only ${(L.sd / L.mean * 100).toFixed(1)}% over the whole map`);
      assert(C.sd > 0.035,
        `${name}: chroma varies by only ${C.sd.toFixed(3)} — one hue at several brightnesses`);
      assert(bare < 0.22,
        `${name}: ${(bare * 100).toFixed(0)}% of the ground is the bare base coat with nothing layered on it`);
      lines.push(`${name} ${(L.sd / L.mean * 100).toFixed(0)}%/±${C.sd.toFixed(3)} bare ${(bare * 100).toFixed(0)}%`);
    }
    return lines.join('  ');
  });

  check('terrain: grain sorting reaches the flat ground, not just the steep bits', () => {
    // Slope-gated layers cannot touch a dune sea: the windward face of a dune
    // is 10-15°, which is 1-cos 0.03, well under any rock or grit band. The
    // 100-metre lag/sheet patchwork is the layer that has to carry it.
    // Measured against the LOOSE ground only — the arena is four fifths cliff
    // by area and sand does not sort itself on a rock face.
    const out = [], bad = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const loose = Math.max(1, s.n - s.layers.rock);
      const lag = s.layers.lag / loose, sheet = s.layers.sheet / loose;
      // the arena is the floor of the distribution: its fighting floor is a
      // dish, and lag is a convex-ground phenomenon that a dish suppresses
      if (lag < 0.075) bad.push(`${name} lag ${(lag * 100).toFixed(1)}%`);
      if (sheet < 0.10) bad.push(`${name} sheet ${(sheet * 100).toFixed(1)}%`);
      out.push(`${name} lag ${(lag * 100).toFixed(0)}% sheet ${(sheet * 100).toFixed(0)}%`);
    }
    assert(bad.length === 0, `grain sorting barely reaches the loose ground: ${bad.join(', ')}`);
    return out.join('  ');
  });

  check('terrain: the lag and the sheet are different HUES, not the same one twice', () => {
    // Reusing grit and dust here is the trap: they are the same sand darker and
    // lighter, so a hundred metres of "variation" reads as a brightness ramp.
    const out = [];
    for (const name of OUTDOOR) {
      const u = terrainOf(name)._uniforms;
      const b = u.uBaseCol.value, l = u.uLagCol.value, s = u.uSheetCol.value;
      const cb = chroma([b.r, b.g, b.b]), cl = chroma([l.r, l.g, l.b]), cs = chroma([s.r, s.g, s.b]);
      assert(Math.abs(cl - cb) > 0.06 || Math.abs(cs - cb) > 0.06,
        `${name}: lag ${cl.toFixed(2)} and sheet ${cs.toFixed(2)} sit on the base's own chroma ${cb.toFixed(2)}`);
      // and they must still bracket it in value, or the patchwork has no read
      assert(lum([l.r, l.g, l.b]) < lum([b.r, b.g, b.b]),
        `${name}: the coarse lag is not darker than the sand it was winnowed from`);
      assert(lum([s.r, s.g, s.b]) > lum([b.r, b.g, b.b]),
        `${name}: the drift sheet is not paler than the sand that blew into it`);
      out.push(`${name} ${cb.toFixed(2)} → lag ${cl.toFixed(2)} / sheet ${cs.toFixed(2)}`);
    }
    return out.join('  ');
  });

  check('terrain: hollows and enclosed ground see less sky than crests do', () => {
    // The ground had no occlusion term at all. Under a hemisphere plus a probe
    // that is a billiard table: every dune trough and every gully received
    // exactly as much indirect light as the brink above it.
    const src = TERRAIN_SRC();
    assert(/reflectedLight\.indirectDiffuse \*= terAO/.test(src),
      'nothing applies an occlusion term to the indirect light');
    assert(src.includes("replace('#include <aomap_fragment>'"),
      'the occlusion term is computed but never spliced into the shader');
    const out = [];
    for (const name of OUTDOOR) {
      const s = surfaceOf(name);
      const A = spread(s.ao);
      assert(A.mean < 0.96, `${name}: mean landform occlusion is ${A.mean.toFixed(3)} — effectively none`);
      assert(A.mean > 0.72, `${name}: mean landform occlusion is ${A.mean.toFixed(3)} — the ground is being crushed`);
      assert(A.sd > 0.05, `${name}: occlusion varies by only ${A.sd.toFixed(3)}, so it adds no form`);
      out.push(`${name} ${A.mean.toFixed(2)}±${A.sd.toFixed(2)}`);
    }
    return out.join('  ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Ripples                                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: ripples run across the level\'s own wind, one field, not two', () => {
    // Two taps of the sand map at unrelated rotations, blended by whichever is
    // brighter, is a max() of two lattices — the dune sea came out as woven
    // matting. Both frames now sit within a few degrees of the wind axis.
    const src = TERRAIN_SRC();
    assert(!/const mat2 TB_A/.test(src) && !/const mat2 TB_D/.test(src),
      'the sand still samples through hard-coded rotations unrelated to the wind');
    const out = [];
    for (const name of PRESETS) {
      const t = terrainOf(name);
      const w = t.preset.wind || [1, 0];
      const wl = Math.hypot(w[0], w[1]);
      const rip = t._uniforms.uRip.value;
      near(rip.x, w[0] / wl, 1e-5, `${name}: the ripple axis does not follow the wind`);
      near(rip.y, w[1] / wl, 1e-5, `${name}: the ripple axis does not follow the wind`);
      near(Math.hypot(rip.x, rip.y), 1, 1e-5, `${name}: the ripple frame is not a rotation`);
      out.push(`${name} ${(Math.atan2(rip.y, rip.x) * 180 / Math.PI).toFixed(0)}°`);
    }
    /* Every frame that samples the sand map must stay near-parallel to every
     * other one; that is the whole point. There are two halves to it now:
     *
     *   · the FIXED offset each layer carries, which is the angle between them
     *     when the field is running straight, and
     *   · the FLOW, which turns the whole field off the wind as it crosses the
     *     ground. That part is shared — one TER_SWING, one noise — so it moves
     *     every layer together and cancels out of the angle BETWEEN them. A
     *     layer with its own swing coefficient would be free to open a
     *     cross-hatch anywhere the two noises disagreed, which is the failure
     *     this check was written for. */
    const swing = src.match(/const float TER_SWING\s*=\s*([\d.]+)/);
    assert(swing, 'the shared ripple swing is gone — every layer can turn on its own again');
    const S = parseFloat(swing[1]);
    assert(S < 0.70, `the flow turns the field ${(S * 90 / Math.PI).toFixed(0)}° off the wind at its worst`);
    const flows = src.match(/dFlowA \* TER_SWING|flowA \* TER_SWING/g) || [];
    assert(flows.length >= 2, 'a sand layer no longer rides the shared flow');
    const angs = [...src.matchAll(/tswing\(uRip\.xy,\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
    assert(angs.length >= 2, 'the second ripple frame is gone');
    for (const v of angs) {
      assert(Math.abs(v) < 0.45,
        `a ripple frame sits ${(Math.abs(v) * 180 / Math.PI).toFixed(0)}° off the field — that is a cross-hatch`);
    }
    const spread = Math.max(...angs, 0) - Math.min(...angs, 0);
    assert(spread < 0.60,
      `the sand layers open ${(spread * 180 / Math.PI).toFixed(0)}° between them — that is a lattice, not a field`);
    return `${out.join('  ')}  swing ±${(S * 90 / Math.PI).toFixed(0)}° shared, ` +
      `layers ${(spread * 180 / Math.PI).toFixed(0)}° apart`;
  });

  check('terrain: the crest bend is a displacement, never a spin of the frame', () => {
    // Rotating the sampling frame by a noise is the obvious way to curve a
    // ripple field, and it is wrong: UV = R(θ(p))·p has a Jacobian term of
    // |p|·∇θ, so 150 m out from the origin the tile is sheared into a swirl
    // with a visible eye in the middle of it. Measured on the dune sea.
    const src = TERRAIN_SRC();
    assert(/pA\.x \+= bend/.test(src), 'the ripple bend is not applied as a displacement');
    assert(!/tswing\(uRip\.xy,\s*swing/.test(src), 'the ripple frame is still spun per pixel');

    // and prove the bound: how far apart do two frames 1 m apart map a point
    // 150 m from the origin? A displacement moves it by the bend gain; a spin
    // moves it by |p| times the angle.
    const t = terrainOf('dunes');
    const gain = t._uniforms.uRip.value.z;
    const spinLike = 150 * 0.85 * (1 / 9);       // what the rotating version did
    assert(gain < 2.0, `the bend gain is ${gain} m — that is not a bend, it is a smear`);
    assert(gain < spinLike * 0.2,
      `the bend moves the tile ${gain.toFixed(2)} m/m against the spin's ${spinLike.toFixed(1)} m/m at 150 m out`);
    return `bend ${gain.toFixed(2)} m, flat in |p|; the spin was ${spinLike.toFixed(1)} m at 150 m`;
  });

  check('terrain: ripple crests are longer than they are wide, and die where sand is not blown', () => {
    const src = TERRAIN_SRC();
    // the frame is stretched along the crest, or the map's two trains cross at
    // 33° and every desert in the game is a diamond lattice
    for (const name of ['dunes', 'arena', 'canyon']) {
      const a = terrainOf(name)._uniforms.uRipAspect.value;
      assert(a > 0.2 && a < 0.75,
        `${name}: the ripple frame aspect is ${a} — 1.0 is the lattice, 0 is a smear`);
    }
    // a poured deck is not blown by anything
    near(terrainOf('hangar')._uniforms.uRipAspect.value, 1.0, 1e-6,
      'the hangar deck is being combed by a wind');
    // and wet sand is packed flat
    assert(/1\.0 - wet \* 0\.8/.test(src) || /\(1\.0 - wet/.test(src),
      'the river bed is still covered in wind ripples');
    // the canyon is worked by water, the dune sea by wind
    assert(terrainOf('canyon')._uniforms.uRip.value.w < terrainOf('dunes')._uniforms.uRip.value.w * 0.7,
      'a river wash ripples as hard as a dune sea');
    return `aspect ${terrainOf('dunes')._uniforms.uRipAspect.value}, gain dunes ` +
      `${terrainOf('dunes')._uniforms.uRip.value.w} vs canyon ${terrainOf('canyon')._uniforms.uRip.value.w}`;
  });

  check('terrain: rock reads as jointed stone, not as tooled leather', () => {
    // The rock map's fracture network is 11 cells across a tile. At 0.115
    // tiles/m that is 79 cm blocks, and at a normal scale of 1.35 — a 53° tilt
    // on a unit normal — every joint came out as a rope lying on the cliff.
    const u = terrainOf('canyon')._uniforms;
    const tile = 1 / u.uScales.value.z;
    const block = tile / 11;
    assert(block < 0.65, `the rock joint spacing is ${block.toFixed(2)} m — that is masonry, not fracture`);
    assert(u.uNrmScale.value.z < 0.95,
      `the rock normal is scaled ${u.uNrmScale.value.z} — the joints stand off the face`);
    const src = TERRAIN_SRC();
    // beds must differ from each other more than the rock inside one bed does
    const bed = src.match(/\(0\.(\d+) \+ bandR \* 0\.(\d+)\)/);
    assert(bed, 'the strata band tint is gone');
    const [, lo, sw] = bed;
    assert(Number('0.' + sw) > Number('0.' + lo) * 0.6,
      'the bedding contrast is weaker than the block-to-block contrast — that is cork');
    return `${tile.toFixed(1)} m tile, ${(block * 100).toFixed(0)} cm joints, normal ×${u.uNrmScale.value.z}`;
  });

  check('terrain: a cliff face is textured along its bedding, not across it', () => {
    const src = TERRAIN_SRC();
    const m = src.match(/vec2 vuv = vec2\(dot\(wp, tang\) \* ([\d.]+), vWPos\.y \* ([\d.]+)\)/);
    assert(m, 'the cliff re-projection no longer stretches its rock along strike');
    const [, h, v] = m.map(Number);
    assert(v / h > 1.8, `the cliff texture is ${(v / h).toFixed(2)}:1 — isotropic worms on a bedded wall`);
    return `${(v / h).toFixed(1)}:1 along strike`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Landform                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: a level that promises stone walls has stone on its walls', () => {
    // Slope alone cannot find the wall of a BENCHED landform: strata put most
    // of its area on near-flat treads and only the thin risers are steep. The
    // arena's blurb says "a bowl of sand ringed by stone" and its rim rises
    // 27 m over 56 — 1-cos 0.11, under the old rock band — so the amphitheatre
    // came out as pale sand cloth with pencil lines drawn on it.
    const t = terrainOf('arena');
    const B = t._uniforms.uBands.value, RU = t._uniforms.uRockUp.value;
    const n = new THREE.Vector3();
    const R = t.res;
    let rocky = 0, wall = 0, floorRock = 0, floor = 0;
    for (let j = 2; j < R - 2; j += 2) {
      for (let i = 2; i < R - 2; i += 2) {
        const x = -t.half + i * t.step, z = -t.half + j * t.step;
        const y = t.heights[j * R + i];
        t._vertexNormal(i, j, n);
        const slope = 1 - clamp(n.y, 0, 1);
        const w = smoothstep(B.x, B.y, slope + smoothstep(RU.y, RU.z, y) * RU.x);
        const d = Math.hypot(x, z);
        if (d > 90 && y > 12) { wall++; if (w > 0.5) rocky++; }
        else if (d < 55) { floor++; floorRock += w; }
      }
    }
    assert(wall > 200 && floor > 200, 'the arena has no rim or no floor to test');
    assert(rocky / wall > 0.85,
      `only ${(rocky / wall * 100).toFixed(0)}% of the amphitheatre rim is stone`);
    // and the thing you fight on is still sand, or the whole level is a quarry
    assert(floorRock / floor < 0.03,
      `${(floorRock / floor * 100).toFixed(0)}% of the fighting floor turned to rock`);
    return `rim ${(rocky / wall * 100).toFixed(0)}% stone, floor ${(floorRock / floor * 100).toFixed(1)}%`;
  });

  check('terrain: the canyon wash you fight in is gravel, not cliff', () => {
    // The other half of the same lever. Rock-with-height has to leave the
    // valley floor alone: the wash is where the fight happens and it is a
    // braided gravel bar, not a rock face.
    const t = terrainOf('canyon');
    const B = t._uniforms.uBands.value, RU = t._uniforms.uRockUp.value;
    const n = new THREE.Vector3();
    const R = t.res;
    let washRock = 0, wash = 0, wallRock = 0, walls = 0;
    for (let j = 2; j < R - 2; j += 2) {
      for (let i = 2; i < R - 2; i += 2) {
        const y = t.heights[j * R + i];
        t._vertexNormal(i, j, n);
        const slope = 1 - clamp(n.y, 0, 1);
        const w = smoothstep(B.x, B.y, slope + smoothstep(RU.y, RU.z, y) * RU.x);
        if (y < 2.5) { wash++; washRock += w; }
        else if (slope > 0.25) { walls++; wallRock += w; }
      }
    }
    assert(wash > 200 && walls > 200, 'the canyon has no wash or no walls to test');
    assert(washRock / wash < 0.15, `${(washRock / wash * 100).toFixed(0)}% of the wash floor is rock`);
    assert(wallRock / walls > 0.9, `only ${(wallRock / walls * 100).toFixed(0)}% of the walls are rock`);
    return `wash ${(washRock / wash * 100).toFixed(0)}% rock, walls ${(wallRock / walls * 100).toFixed(0)}%`;
  });

  check('terrain: the ground publishes itself, so water and decals can find it', () => {
    const prev = ground.terrain;
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    assert(ground.terrain === t, 'a level with no grass leaves the broker with no heightfield');
    assert(ground.heightAt(0, 0) === t.height(0, 0), 'the broker is reading a different surface');
    t.dispose();
    assert(ground.terrain === null, 'the broker still points at a disposed heightfield');
    ground.terrain = prev;
    return 'published on construction, cleared on dispose';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Cover                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grass: the ground it grows out of knows it is covered', () => {
    // A field of blades standing on bright bare sand reads as green spikes
    // stuck into a beach however many you spend, because the eye takes its
    // reading of "cover" from the ground TONE. This is half the fix and it
    // costs one lerp.
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    near(t._uniforms.uCover.value.x, 0, 1e-6, 'bare ground starts out covered');
    const g = new GrassField(new THREE.Scene(), t, {
      count: 400, density: 1, tintA: 0x8a9a58, tintB: 0x4d5c2e,
    });
    const amt = t._uniforms.uCover.value.x;
    assert(amt > 0.25, `a full-density grass field only tints the ground by ${amt.toFixed(2)}`);
    const c = t._uniforms.uCoverCol.value;
    // litter is what green rots into: darker than the blade and not green
    assert(lum([c.r, c.g, c.b]) < lum([g.tintB.r, g.tintB.g, g.tintB.b]),
      'the litter under the grass is brighter than the grass');
    assert(c.g < g.tintB.g, 'the ground under the grass is as green as the grass');
    g.dispose();
    near(t._uniforms.uCover.value.x, 0, 1e-6, 'the cover tint outlived the field that asked for it');
    t.dispose();
    return `cover ${amt.toFixed(2)}, litter #${c.getHexString()}`;
  });

  check('grass: the near ring covers enough ground to read as cover', () => {
    // 6.8% silhouette is nine parts bare sand to one part grass. The lever is
    // the ring's AREA, not the blade: instances over πr² is what decides it.
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const g = new GrassField(new THREE.Scene(), t, { count: 11000, density: 1, radius: 46 });
    g.update(1 / 60, new THREE.Vector3(0, t.height(0, 0), 0), [], null);
    const report = [];
    for (const [name, ring] of [['near', g.near], ['far', g.far]]) {
      const a = ring.aInst.array;
      let live = 0, area = 0;
      for (let i = 0; i < ring.count; i++) {
        const len = a[i * 4 + 3];
        if (len <= 0.004) continue;
        live++;
        const w = ring.mat.uniforms.uWidth.value * len * (ring.card ? 2.2 : 1);
        area += w * len * (ring.card ? 1.0 : 0.62);
      }
      const inner = ring.card ? g.nearRadius * 0.62 : 0;
      const ground2 = Math.PI * (ring.far * ring.far - inner * inner);
      const cover = area / ground2;
      assert(cover > 0.12,
        `${name} ring silhouette covers ${(cover * 100).toFixed(1)}% of its own ground`);
      assert(live / ring.count > 0.55,
        `${name} ring spends ${((1 - live / ring.count) * 100).toFixed(0)}% of its budget on instances that render as nothing`);
      report.push(`${name} ${(cover * 100).toFixed(0)}% from ${live}/${ring.count}`);
    }
    g.dispose(); t.dispose();
    return report.join('  ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Water                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('water: the river knows the shape of the bed it is lying in', () => {
    const t = terrainOf('canyon');
    ground.terrain = t;
    const w = new Water(new THREE.Scene(), { size: t.size + 60, level: 0.35 });
    assert(w.depthTex, 'the water has no depth map, so its edge is wherever the sheet ends');
    assert('WATER_DEPTH' in w.mat.defines, 'the depth map was baked and never compiled in');
    const N = w.depthTex.image.width, d = w.depthTex.image.data;
    const sample = (x, z) => {
      const i = clamp(Math.round((x / t.size + 0.5) * N - 0.5), 0, N - 1);
      const j = clamp(Math.round((z / t.size + 0.5) * N - 0.5), 0, N - 1);
      return (d[j * N + i] / 255) * 3.0;
    };
    // the map has to agree with the heightfield, or the shoreline is drawn in
    // the wrong place and the whole thing is worse than no map at all
    let worst = 0, deepest = 0;
    for (let z = -80; z <= 80; z += 3) {
      for (let x = -220; x <= 220; x += 7) {
        const truth = clamp(0.35 - t.height(x, z), 0, 3);
        worst = Math.max(worst, Math.abs(truth - sample(x, z)));
        deepest = Math.max(deepest, truth);
      }
    }
    assert(worst < 0.55, `the depth map is out by ${worst.toFixed(2)} m against the terrain`);
    assert(deepest > 0.2 && deepest < 2.5,
      `the wash is ${deepest.toFixed(2)} m deep — the blurb says water underfoot`);
    assert(w.wetFraction > 0.005 && w.wetFraction < 0.5,
      `${(w.wetFraction * 100).toFixed(0)}% of the map is under water`);
    w.dispose();
    ground.terrain = null;
    return `${N}² map, ≤${(worst * 100).toFixed(0)} cm error, ${(w.wetFraction * 100).toFixed(1)}% wet, ${deepest.toFixed(2)} m deepest`;
  });

  check('water: the edge fades out where the depth runs out', () => {
    const src = SCENERY_SRC();
    assert(/float shore = smoothstep\([\d.]+, [\d.]+, depth\)/.test(src),
      'there is no shoreline band');
    assert(/float edge = smoothstep\(0\.0, [\d.]+, depth\)/.test(src) && /\* edge/.test(src),
      'the alpha does not go to zero at the waterline — the sheet ends in a hard line');
    assert(/mix\(uBed, body, dw\)/.test(src),
      'shallow water does not show the bed through it');
    // and a shallow river must not be throwing whitecaps
    const swell = src.match(/smoothstep\(0\.08, 0\.15, abs\(vWave\)\) \* ([\d.]+)/);
    assert(swell && Number(swell[1]) < 0.08,
      'the long swell is still foaming, which on a 580 m sheet is white blobs the size of a barge');
    // reflecting only the sky is a sheet of milk; a facet term is what bands it
    assert(/float facet = smoothstep/.test(src) && /vec3 mirror = mix\(/.test(src),
      'the surface mirrors one flat colour');
    return 'depth-graded colour, faded edge, a lap at the shoreline';
  });

  check('water: a level with no terrain still gets a river, just a flat one', () => {
    const prev = ground.terrain;
    ground.terrain = null;
    const w = new Water(new THREE.Scene(), { size: 100 });
    assert(!w.depthTex, 'a water plane with no bed under it baked a depth map anyway');
    assert(!('WATER_DEPTH' in w.mat.defines), 'the shader wants a depth map that does not exist');
    w.dispose();
    ground.terrain = prev;
    return 'falls back cleanly';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Cost                                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('terrain: every preset is still one mesh, one material, one draw call', () => {
    const out = [];
    for (const name of PRESETS) {
      const scene = new THREE.Scene();
      const t = new Terrain(scene, name, 1.0);
      const meshes = scene.children.filter((c) => c.isMesh);
      assert(meshes.length === 1, `${name}: the ground is ${meshes.length} meshes`);
      assert(!Array.isArray(t.mesh.material), `${name}: the ground is a material array`);
      assert(t.mesh.receiveShadow && t.mesh.castShadow, `${name}: the ground dropped out of the shadow pass`);
      out.push(`${name} ${(t.geometry.index.count / 3 / 1000).toFixed(0)}k tris`);
      t.dispose();
    }
    return out.join('  ');
  });

  check('terrain: the surface stays finite and continuous with everything added', () => {
    // Every layer above multiplies into diffuseColor; one NaN anywhere in the
    // heightfield poisons the landform bake and every channel that reads it.
    for (const name of PRESETS) {
      const t = terrainOf(name);
      for (let k = 0; k < t.heights.length; k++) {
        if (!isFinite(t.heights[k])) throw new Error(`${name}: a non-finite height at ${k}`);
      }
      for (let k = 0; k < t.landform.length; k++) {
        const v = t.landform[k];
        if (!(v >= 0 && v <= 255)) throw new Error(`${name}: landform byte ${k} is ${v}`);
      }
      for (const [n, u] of Object.entries(t._uniforms)) {
        const v = u.value;
        if (typeof v === 'number' && !isFinite(v)) throw new Error(`${name}: uniform ${n} is ${v}`);
        if (v && v.isVector4 !== undefined && v.toArray) {
          for (const c of v.toArray()) if (!isFinite(c)) throw new Error(`${name}: uniform ${n} holds ${c}`);
        }
      }
    }
    return `${PRESETS.length} presets, all finite`;
  });
}

/* ── source, read once ───────────────────────────────────────────────── */
/*
 * The shaders are strings inside a module, so the only way to hold one to a
 * shape is to read the file it lives in — the same trick the stray-backtick
 * check uses. Everything checked this way is a property no runtime value
 * exposes: which chunk a term is spliced into, whether a bend is a
 * displacement or a rotation, whether the alpha reaches zero at the waterline.
 */
let _terSrc = null, _scnSrc = null;
const TERRAIN_SRC = () => (_terSrc ??= readSrc('Terrain.js'));
const SCENERY_SRC = () => (_scnSrc ??= readSrc('Scenery.js'));
const readSrc = (name) =>
  readFileSync(new URL(`../../src/world/${name}`, import.meta.url), 'utf8');
