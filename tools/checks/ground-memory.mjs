/**
 * THE GROUND: what covers it, what happens to it, and what it remembers.
 *
 * Five complaints, in the player's own words, and every one of them was a
 * property of the ground rather than of anything standing on it:
 *
 *   1. "The meadow must be ALL GRASS. Ghibli-dense, wind-blown, the bare
 *      ground never visible anywhere. Right now you can see soil between the
 *      tufts." Measured by rendering the level twice — once as shipped, once
 *      with the cover hidden — and counting the pixels that differ: 35.3% of
 *      the ground band was hidden by cover, and only 17.1% of it in the
 *      nearest quarter of the frame, which is the ground at your own feet.
 *      Five parts bare soil to one part grass, where you are standing.
 *
 *   2. "The tundra/ice maps must have NO GRASS AT ALL." The White Pass, a
 *      cirque above the treeline whose base coat is snow, ran a cover field at
 *      0.44 and grew tussock through its own snowpack.
 *
 *   3. "The dune sea must have no grass either." Its own blurb is "nothing
 *      between you and the horde but sand"; it ran 0.40, the deep erg 0.54,
 *      and the arena — "a bowl of sand ringed by stone" — 0.36.
 *
 *   4. "Ground deformation from attacks and movement, scaling up as the player
 *      gets stronger." `Player.forcePush` ends in
 *      `ctx.terrain.crater(_v1.x, _v1.z, 2.6, 0.22)` — two constants. The same
 *      hole on the first wave and on the last, at forcePower 0.25 and at 4.
 *
 *   5. "Saber contact with the ground must do something real." `bladeScar` —
 *      the emitter that draws a molten line, spatter, smoke and a cooling
 *      scorch — had NO CALLER anywhere in src/. The blade solver only ever
 *      tests enemies, props and doors, so a lit blade dragged through a dune
 *      did nothing whatsoever.
 *
 * And the thing under all of it: FOOTPRINTS. There were none, and there could
 * not be — the heightfield is 1.63 m per cell on the alpine preset and
 * `crater` widens anything under 2.20 m, against a boot at 0.11 m. The answer
 * is src/world/Surface.js, a second and much finer field over the same ground,
 * and most of this file is about proving it does what a snowfield does.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not count tufts. A tuft
 * count is not an answer to "you can see the soil" — the field could triple
 * its instances and lose ground, because cover from a scatter is
 * 1 − exp(−τ) and τ is an AREA, not a count. Everything here is metres and
 * fractions.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain, TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { SurfaceField, SURFACE_GRAD_FS } from '../../src/world/Surface.js';
import { GrassField, ground } from '../../src/world/Scenery.js';
import { Particles } from '../../src/world/Particles.js';
import { LEVELS, LEVEL_ORDER, groundMight, beginDressing } from '../../src/game/Levels.js';
import { Saber } from '../../src/game/Saber.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SRC = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');

/** What the World actually passes, so nothing here measures a field the game
 *  never builds. See World.loadLevel: count is the QUALITY tier's, density is
 *  the level's times the player's slider. */
const QUALITY_GRASS = { low: 0.25, medium: 0.55, high: 1.0, ultra: 1.5 };
function levelField(key, tier = 'high') {
  const L = LEVELS[key];
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.74);
  if (!L.grass) return { terrain, grass: null };
  const grass = new GrassField(new THREE.Scene(), terrain, {
    count: Math.round(11000 * QUALITY_GRASS[tier]),
    density: L.grass,
    tintA: L.grassTint?.[0], tintB: L.grassTint?.[1], radius: 46,
  });
  grass.update(1 / 60, V(0, terrain.height(0, 0), 0), [], null);
  return { terrain, grass };
}

/**
 * OPTICAL DEPTH OF THE COVER over a band of ground, and the closure that
 * follows from it.
 *
 * τ = Σ(silhouette area) / (ground area), and closure = 1 − exp(−τ). That is
 * not a modelling choice, it is what a scatter of independently placed
 * occluders does: the areas do not add, because two cards standing on the same
 * square metre only hide it once. It is also why COUNT is the wrong lever —
 * τ is linear in count and quadratic in size, so the same instances at 1.5×
 * the length carry 2.25× the ground.
 *
 * The silhouette formula is the one tools/checks/terrain.mjs already uses on
 * the same buffers, deliberately: a card is `uWidth · len · 2.2 · widen` wide
 * by `len` tall, a blade is its own width by its length at 0.62 for the taper.
 */
function opticalDepth(grass, r0, r1) {
  let area = 0, live = 0;
  for (const ring of grass.rings) {
    const a = ring.aInst.array, w = ring.mat.uniforms.uWidth.value;
    for (let i = 0; i < ring.count; i++) {
      const len = a[i * 4 + 3];
      if (len <= 0.004) continue;
      const r = Math.hypot(a[i * 4], a[i * 4 + 2]);
      if (r < r0 || r >= r1) continue;
      live++;
      const widen = ring.card ? 0.55 + 0.95 * Math.min(1, r / ring.far) : 1;
      const wide = w * len * (ring.card ? 2.2 * widen : 1);
      area += wide * len * (ring.card ? 1.0 : 0.62);
    }
  }
  const ground2 = Math.PI * (r1 * r1 - r0 * r0);
  const tau = area / ground2;
  return { tau, closure: 1 - Math.exp(-tau), live, area, ground: ground2 };
}

/**
 * THE CONTROL: the ladder exactly as it shipped, transcribed from the rows
 * this workstream replaced, so "the cover got denser" is a comparison and not
 * an assertion about a number nobody can check.
 *
 * Only the fields that enter the silhouette: radius, density, instances per
 * tuft, card width, and the two that set a blade's length.
 */
const SHIPPED_TIERS = [
  { name: 'blade', card: false, rIn: 0, rOut: 6.5, cell: 2.2, dens: 5.0, per: 8, width: 0.110, base: 0.16, varies: 0.22 },
  { name: 'clump', card: true, rIn: 2.5, rOut: 46, cell: 6.0, dens: 0.62, per: 3, width: 1.05, base: 0.26, varies: 0.26 },
  { name: 'swath', card: true, rIn: 42, rOut: 150, cell: 17, dens: 0.024, per: 2, width: 2.60, base: 0.26, varies: 0.26 },
  { name: 'far', card: true, rIn: 140, rOut: 400, cell: 46, dens: 0.0026, per: 1, width: 6.0, base: 0.26, varies: 0.26 },
];

/**
 * The same τ, computed analytically off a tier table rather than off placed
 * instances, so the shipped ladder can be a CONTROL rather than a number
 * somebody wrote down.
 *
 * It has to size itself the way GrassField does or the comparison is rigged:
 * the budget is shared out in proportion to each rung's `area · dens · per`,
 * so a table with a rung removed spends more on the rungs that remain.
 * `thickness` is the one shared factor that falls out of that division, and it
 * is recomputed here from the control's OWN rows.
 */
function tableThickness(tiers, total, coverFrac, radius = 46) {
  const k = radius / 46;
  let wantAll = 0;
  const want = tiers.map((T) => {
    const rIn = T.rIn * k, rOut = T.rOut * k, cell = T.cell * k;
    const oR = rOut + cell, iR = Math.max(0, rIn - cell);
    const hold = Math.min(1, coverFrac
      + (rOut < 15 ? 0.45 : rOut < 60 ? 0.22 : rOut < 250 ? 0.12 : 0));
    const w = Math.PI * (oR * oR - iR * iR) * hold * T.dens * T.per;
    wantAll += w;
    return w;
  });
  void want;
  return total / (wantAll || 1);
}

function tableTau(tiers, r0, r1, thickness, coverFrac, lenGain) {
  let area = 0;
  const rm = (r0 + r1) * 0.5;
  for (const T of tiers) {
    if (rm < T.rIn || rm >= T.rOut) continue;
    const len = (T.base + T.varies * 0.5) * lenGain;
    const widen = T.card ? 0.55 + 0.95 * Math.min(1, rm / T.rOut) : 1;
    const wide = T.width * len * (T.card ? 2.2 * widen : 1);
    const per = wide * len * (T.card ? 1.0 : 0.62);
    area += T.dens * thickness * coverFrac * T.per * per;
  }
  return area;
}

export function run({ check, assert, near }) {

  /* ══ 1. the meadow is grass all the way down ═════════════════════════ */

  check('meadow: the cover closes the ground it is standing on', () => {
    /* THE MEASUREMENT, and why it is optical depth rather than a tuft count.
     *
     * Rendered before this change, on the real level at medium quality with a
     * camera at eye height pitched 20° down: the cover hid 35.3% of the ground
     * band and 17.1% of the nearest quarter of the frame. The player's words
     * for that were "you can see soil between the tufts", and they are right —
     * five parts soil to one part grass at your own feet.
     *
     * τ over the first six metres is what decides that, and the shipped
     * ladder's τ is computed here from its own rows as a control rather than
     * quoted. Both halves of the fix show up in it: a new SWARD rung, which is
     * broad and low where the clump rung is tall and narrow, and a clump rung
     * that is 1.5× longer — and because τ goes as len², the length alone is
     * worth 2.2× for no extra instances at all.
     */
    const { terrain, grass } = levelField('meadow');
    const bands = [[0, 6], [6, 12], [12, 24]];
    const rows = [];
    for (const [r0, r1] of bands) {
      const m = opticalDepth(grass, r0, r1);
      rows.push(`${r0}-${r1}m τ=${m.tau.toFixed(2)} ${(m.closure * 100).toFixed(0)}%`);
      // The ceiling on the far band is the reach of the near rungs, not a
      // failure: the clump rung alone carries 12-24 m and is checked on its
      // own grazing coverage in tools/checks/terrain.mjs.
      const want = r1 <= 12 ? 0.90 : 0.80;
      assert(m.closure > want,
        `${r0}-${r1} m: the cover closes ${(m.closure * 100).toFixed(0)}% of the ground `
        + `(τ = ${m.tau.toFixed(2)} over ${m.live} instances), wanted ${(want * 100).toFixed(0)}%`);
    }

    // …and it is denser than the ladder it replaces, measured the same way.
    const nowTau = opticalDepth(grass, 0, 6).tau;
    /* The control spends the SAME budget the level would have handed it, shared
     * out by its own rows — so this is "the same instances, differently spent"
     * and not "more instances". The meadow's density of 1.4 moves the budget by
     * 1.2×; everything past that is shape. */
    const wasThick = tableThickness(SHIPPED_TIERS, grass.count, grass.coverFrac);
    const wasTau = tableTau(SHIPPED_TIERS, 0, 6, wasThick, grass.coverFrac, 1.15);
    assert(nowTau / wasTau > 2.0,
      `the near cover is only ${(nowTau / wasTau).toFixed(2)}× the ladder it replaces `
      + `(τ ${wasTau.toFixed(2)} → ${nowTau.toFixed(2)})`);

    /* AND THE GROUND ITSELF IS SWARD. The last few per cent of closure are not
     * affordable in geometry — τ has to reach 3 for 95%, and that is seven
     * times the instances — so on ground the field says is covered, the
     * SURFACE is a mat of blade tips rather than soil crumb. This is the
     * uniform that carries it, and it must be off on a level with no cover. */
    const u = terrain._uniforms;
    assert(u.uSward.value.x > 0.8,
      `the meadow paints its ground as sward at ${u.uSward.value.x.toFixed(2)}`);
    assert(u.uSward.value.z > 0.5,
      `the sward has ${u.uSward.value.z.toFixed(2)} of relief — a flat mat is a printed pattern`);
    // and it is the mat DOWN AMONG the blades, so it is darker than they are
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    assert(lum(u.uSwardA.value) < lum(grass.tintA) * 0.8,
      `the sward mat is ${(lum(u.uSwardA.value) / lum(grass.tintA)).toFixed(2)}× the blade's own value `
      + '— a canopy floor lit from above through a canopy cannot be that bright');
    assert(lum(u.uSwardB.value) < lum(u.uSwardA.value),
      'the gap between the blades is brighter than the blade tips over it');

    const rep = `${rows.join('  ')}; ${(nowTau / wasTau).toFixed(2)}× the shipped ladder; `
      + `sward ${u.uSward.value.x.toFixed(2)} relief ${u.uSward.value.z.toFixed(2)}`;
    grass.dispose(); terrain.dispose();
    return rep;
  });

  check('meadow: the density is bought with area, not with instances', () => {
    /* THE PERFORMANCE HALF, and it is a real constraint: "a meadow that is
     * 100% covered at 4 fps is not a fix." Instances and triangles are what
     * this costs, and the whole argument of the sward rung is that closure is
     * quadratic in size and only linear in count — so the right way to buy it
     * is bigger cover, not more of it.
     *
     * The budget is `count · 2.2 · (0.5 + 0.5·min(density, 1.4))`, and the
     * meadow's density of 1.4 is exactly where that term saturates: 1.2× the
     * instances for 2.2× the closure. Anything past 1.4 is free budget the
     * formula refuses to spend, which is the point of the clamp.
     */
    const rows = [], closures = [];
    for (const tier of ['low', 'medium', 'high', 'ultra']) {
      const { terrain, grass } = levelField('meadow', tier);
      let tris = 0;
      for (const r of grass.rings) tris += r.count * (r.geo.index.count / 3);
      const m = opticalDepth(grass, 0, 6);
      rows.push(`${tier} ${grass.count} inst / ${(tris / 1000).toFixed(0)}k tri / `
        + `${grass.meshes.length} draws / ${(m.closure * 100).toFixed(0)}%`);
      // The tier the game calls `high` is the reference; nothing may exceed
      // 1.25× the instances the shipped ladder spent there, which was 24,200.
      if (tier === 'high') {
        assert(grass.count <= 24200 * 1.25,
          `the high tier now spends ${grass.count} instances against the 24,200 it did`);
        assert(grass.meshes.length <= 10,
          `${grass.meshes.length} draw calls for the ground cover`);
      }
      /* Every tier still closes the near ground, and the bar is per tier
       * because the tier IS the budget: `low` holds a quarter of `high`'s
       * instances by design and it is the one setting that exists to buy
       * frames. What the ladder may not do is fall off a cliff — the shipped
       * ladder closed 34% at HIGH, so the Performance tier now closes nearly
       * twice what the top tier used to. */
      const bar = tier === 'low' ? 0.50 : tier === 'medium' ? 0.78 : 0.92;
      assert(m.closure > bar,
        `${tier}: the cover closes ${(m.closure * 100).toFixed(0)}% of the first six metres, `
        + `wanted ${(bar * 100).toFixed(0)}%`);
      closures.push(m.closure);
      grass.dispose(); terrain.dispose();
    }
    assert(closures.every((c, i) => i === 0 || c >= closures[i - 1] - 1e-9),
      `the ladder is not monotone: ${closures.map((c) => (c * 100).toFixed(0)).join(' → ')}`);
    return rows.join('; ');
  });

  /* ══ 2-3. snow, sand and metal grow nothing ══════════════════════════ */

  check('levels: nothing grows on snow, on sand or on deck plate', () => {
    /* "Delete grass from any level whose ground is snow, ice, sand or metal."
     *
     * Stated as a property of the TERRAIN rather than as a list, so a level
     * that changes its preset cannot quietly keep a field it should not have:
     * a preset declares which maps it dresses itself with, and `soil` is the
     * only one of them anything grows out of. The canyon is the one sand-mapped
     * level that keeps its cover, and it is not an exception to the rule — the
     * rule is about the GROUND, and the canyon's is a damp river wash with
     * standing water down the middle of it, which its own preset says with
     * `damp: 0.35` and a water level. Nothing else in the game has either.
     */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L || typeof L.dress !== 'function') continue;
      const P = TERRAIN_PRESETS[L.terrain];
      if (!P) continue;
      const grows = P.maps === 'soil' || (P.damp ?? 0) > 0.2;
      if (grows) {
        assert(L.grass > 0, `${key}: ${P.maps} ground with damp ${P.damp ?? 0} and no cover on it`);
      } else {
        assert(!L.grass,
          `${key}: its ground is ${P.maps} and it is growing grass at ${L.grass}`);
      }
      rows.push(`${key} ${P.maps}${(P.damp ?? 0) > 0.2 ? '+damp' : ''} ${L.grass || 0}`);
    }
    const bare = LEVEL_ORDER.filter((k) => LEVELS[k]?.dress && !LEVELS[k].grass);
    assert(bare.length >= 5, `only ${bare.length} levels are bare ground`);
    return rows.join(', ');
  });

  /* ══ the loose layer ═════════════════════════════════════════════════ */

  check('ground: snow lies ankle to waist, and every open ground has a loose layer', () => {
    /* "Snow, ankle-to-waist deep." Not a decoration on the preset: it is the
     * number that decides how deep a footprint can be, so a print on a
     * wind-stripped rib is a scuff and the same step in a lee hollow is a hole
     * you can see the shadow inside.
     *
     * It is derived from the landform channels the material already shades
     * itself with — concavity at 8 m and wind exposure — so the snow is deep
     * exactly where the shader is already drawing drift, and there is no
     * second field that can disagree with the first.
     */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L || typeof L.dress !== 'function') continue;
      const P = TERRAIN_PRESETS[L.terrain];
      assert(P.loose, `${key}: the ${L.terrain} preset declares no loose layer at all`);
      const t = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      let lo = 1e9, hi = -1e9, sum = 0, n = 0;
      for (let z = -140; z <= 140; z += 7) {
        for (let x = -140; x <= 140; x += 7) {
          if (!t.inBounds(x, z, 10)) continue;
          const m = t.mantleAt(x, z);
          lo = Math.min(lo, m); hi = Math.max(hi, m); sum += m; n++;
        }
      }
      rows.push(`${key} ${lo.toFixed(2)}-${hi.toFixed(2)} m (mean ${(sum / n).toFixed(2)})`);
      assert(n > 400, `${key}: only ${n} samples of the mantle`);
      assert(lo >= 0, `${key}: a negative loose layer`);
      if (key === 'alpine') {
        // ankle is ~0.10 m and waist is ~0.95 on a 1.78 m character
        assert(lo <= 0.12, `alpine: the thinnest snow on the level is ${lo.toFixed(2)} m — nothing is scoured`);
        assert(hi >= 0.85, `alpine: the deepest snow on the level is only ${hi.toFixed(2)} m — that is shin deep`);
        assert(hi / lo > 5, `alpine: the snow only varies ${(hi / lo).toFixed(1)}× across the level`);
      }
      t.dispose();
    }
    /* The ordering that says what each ground is made of.
     *
     * READ OFF THE PRESET TABLE, not off a level, and that is a correction
     * rather than a convenience. This used to be `LEVELS[k].terrain`, which
     * made a statement about MATERIALS depend on which levels happened to
     * exist — so deleting the dune sea and Hangar Bay Nine (both removed at
     * the player's request) took two of the four comparisons with them, and
     * `dunes`/`hangar` are still perfectly good ground presets that other
     * levels stand on. The property was always about the preset; now it says
     * so, and it covers every preset in the file rather than the subset a
     * level currently points at. */
    const depth = (name) => TERRAIN_PRESETS[name].loose.depth;
    assert(depth('alpine') > depth('drifts'), 'a boot goes deeper into an erg than into fresh snow');
    assert(depth('drifts') > depth('dunes'), 'the deep erg is firmer than the young dune field');
    assert(depth('meadow') < depth('arena') * 0.6, 'turf takes a print like a silt pan does');
    assert(depth('hangar') < 0.05, 'a poured deck takes a footprint');
    assert(depth('works') < 0.05 && depth('temple') < 0.05,
      'a poured works floor and a flagged temple hall take a footprint');
    assert(depth('mustafar') > depth('dunes') && depth('mustafar') < depth('drifts'),
      'an ash fall lies deeper than a young dune field and shallower than a deep erg');
    assert(depth('cavern') > depth('works') * 4, 'a flooded cut is as firm as the deck above it');
    // and every preset that is not a built floor carries a real layer
    for (const name of Object.keys(TERRAIN_PRESETS)) {
      assert(TERRAIN_PRESETS[name].loose, `${name} declares no loose layer at all`);
    }
    return rows.join('; ');
  });

  /* ══ footprints ══════════════════════════════════════════════════════ */

  check('ground: a footfall leaves a print, and every walker makes one', () => {
    /* THE HOOK, and it is the reason this needed no edit outside the ground's
     * own files. `Particles.sandPuff` is already what Player._footstep and
     * Enemy's `animator.onFootstep` call on every planted foot — with the
     * position, the power, and through `_stride` the direction of travel. It
     * pressed the GRASS trail and nothing else, which is why there were no
     * prints on any level that has no grass, i.e. every level this was for.
     *
     * So this check goes through the real emitter rather than through
     * `terrain.tread`: what it is proving is that the wiring exists, not that
     * the arithmetic works.
     */
    const t = new Terrain(new THREE.Scene(), 'alpine', 0.74);
    const P = new Particles(new THREE.Scene(), 1);
    ground.frame(0.02, V(0, 0, 0));

    // a spot with real snow on it, so the cap is not what is being measured
    let spot = null;
    for (let k = 0; k < 600 && !spot; k++) {
      const x = ((k * 7) % 31) - 15, z = ((k * 13) % 29) - 14;
      if (t.mantleAt(x, z) > 0.5) spot = [x, z];
    }
    assert(spot, 'no snow deeper than half a metre anywhere near the spawn');
    const [fx, fz] = spot;
    near(t.surface.depthAt(fx, fz), 0, 1e-9, 'the ground starts out already trodden');

    // A WALKING step, at the power Player._footstep passes: clamp(speed·0.09,
    // 0.12, 0.5), so 0.30 is a jog.
    P.sandPuff(V(fx, t.height(fx, fz), fz), 0.30, t.height(fx, fz), 0xffffff,
      { dir: { x: 1, z: 0 } });
    const walk = t.surface.depthAt(fx, fz);
    assert(walk > 0.06, `a jogging footfall pressed ${(walk * 100).toFixed(1)} cm into half a metre of snow`);

    // A LANDING, which is the same emitter at 1.9× the impact speed.
    const lx = fx + 6;
    P.sandPuff(V(lx, t.height(lx, fz), fz), 1.6, t.height(lx, fz), 0xffffff);
    const land = t.surface.depthAt(lx, fz);
    assert(land > walk * 1.4,
      `a hard landing pressed ${(land * 100).toFixed(1)} cm against a jog's ${(walk * 100).toFixed(1)}`);

    // …and a print is a SHAPE, not a stain: it has a wall the light can catch
    // and a berm of what it displaced standing outside it.
    let steepest = 0, berm = 0;
    const S = t.surface;
    for (let j = -8; j <= 8; j++) {
      for (let i = -8; i <= 8; i++) {
        const x = fx + i * S.cell, z = fz + j * S.cell;
        const k = S._k(S._cellOf(x), S._cellOf(z));
        const gx = (S.depth[S._k(S._cellOf(x) + 1, S._cellOf(z))]
                  - S.depth[S._k(S._cellOf(x) - 1, S._cellOf(z))]) / (2 * S.cell);
        steepest = Math.max(steepest, Math.abs(gx));
        berm = Math.max(berm, S.depth[k]);      // positive is material piled up
      }
    }
    assert(steepest > 0.30,
      `the deepest wall of a print falls at ${steepest.toFixed(2)} m/m — that is a stain, not a hole`);
    assert(steepest < SURFACE_GRAD_FS,
      `a print wall at ${steepest.toFixed(2)} m/m saturates the encoded gradient`);
    assert(berm > 0.004,
      `a moving foot displaced ${(berm * 1000).toFixed(1)} mm of material and put none of it anywhere`);

    // THE ENEMY USES THE SAME EMITTER. Enemy.js:698 is
    // `this.world.particles?.sandPuff(p.clone(), 0.16, p.y, ...)`, so proving
    // that call signature marks the ground proves every enemy leaves prints.
    const src = SRC('game/Enemy.js');
    assert(/onFootstep[\s\S]{0,300}particles\?\.sandPuff\(/.test(src),
      'Enemy no longer marks the ground on a footstep — the hook this rides has moved');
    // …on ground with snow on it, chosen the same way: `tread` caps the depth
    // by the mantle, so a scoured rib is a fair place for a light step to
    // leave almost nothing and a bad place to measure whether it left anything.
    let espot = null;
    for (let k = 0; k < 900 && !espot; k++) {
      const x = ((k * 11) % 27) - 13, z = ((k * 5) % 25) - 12;
      if (Math.hypot(x - fx, z - fz) > 1 && t.mantleAt(x, z) > 0.4) espot = [x, z];
    }
    assert(espot, 'no second patch of snow to put an enemy on');
    P.sandPuff(V(espot[0], t.height(espot[0], espot[1]), espot[1]), 0.16,
      t.height(espot[0], espot[1]), 0xffffff);
    assert(t.surface.depthAt(espot[0], espot[1]) > 0.02,
      `an enemy footfall left ${(t.surface.depthAt(espot[0], espot[1]) * 1000).toFixed(1)} mm in the snow`);

    const rep = `jog ${(walk * 100).toFixed(0)} cm, landing ${(land * 100).toFixed(0)} cm, `
      + `wall ${steepest.toFixed(2)} m/m, berm ${(berm * 1000).toFixed(0)} mm`;
    P.dispose(); t.dispose();
    return rep;
  });

  check('ground: prints persist, and they fill in at the rate the ground fills in', () => {
    /* "Footprints and trails that persist and slowly fill in." Two failure
     * modes and they are opposite, so both are pinned:
     *
     *   a print that fades in seconds is a decal, not a trail;
     *   a print that never leaves is a leak — the field uploads for ever and
     *   the level slowly fills with every step anybody has taken.
     *
     * The fill-in is not one exponential. A pure `v *= exp(-dt/τ)` never
     * arrives: at the alpine's 300 s a 30 cm print is still 3 mm deep four
     * minutes later, `live` never falls and the texture uploads at 10 Hz for
     * the rest of the level. What actually closes a hollow is drifting snow
     * and blown sand arriving at a rate set by the WIND rather than by how
     * deep the hole already is, so there is an absolute term as well, and it
     * is what lets the field go quiet again.
     */
    const rows = [];
    for (const [key, holds] of [['alpine', 0.55], ['drifts', 0.18], ['arena', 0.45]]) {
      const t = new Terrain(new THREE.Scene(), LEVELS[key].terrain, 0.74);
      ground.frame(0.02, V(0, 0, 0));
      let spot = null;
      for (let k = 0; k < 900 && !spot; k++) {
        const x = ((k * 7) % 31) - 15, z = ((k * 11) % 29) - 14;
        if (t.mantleAt(x, z) > TERRAIN_PRESETS[LEVELS[key].terrain].loose.depth * 0.9) spot = [x, z];
      }
      const [x, z] = spot || [2, 2];
      t.tread(x, z, 0.18, 0.4, 1, 0);
      const d0 = t.surface.depthAt(x, z);
      assert(d0 > 0.02, `${key}: a print only went ${(d0 * 100).toFixed(1)} cm in`);
      const at = {};
      let el = 0;
      for (const mark of [30, 120, 900]) {
        while (el < mark) { ground.frame(0.1, V(0, 0, 0)); el += 0.1; }
        at[mark] = t.surface.depthAt(x, z) / d0;
      }
      assert(at[30] > holds,
        `${key}: half a minute later a print is ${(at[30] * 100).toFixed(0)}% as deep — that is a decal`);
      assert(at[120] < at[30],
        `${key}: the print is not filling in at all`);
      assert(at[900] < 0.02,
        `${key}: a quarter of an hour later the print is still ${(at[900] * 100).toFixed(0)}% deep`);
      assert(t.surface.live === 0,
        `${key}: ${t.surface.live} cells still count as live with nothing left in them — `
        + 'the field will upload for ever');
      rows.push(`${key} 30s ${(at[30] * 100).toFixed(0)}%, 120s ${(at[120] * 100).toFixed(0)}%, `
        + `900s ${(at[900] * 100).toFixed(0)}%`);
      t.dispose();
    }
    // and a storm level forgets faster than a snowfield, because it is being
    // combed out from under you
    // Keyed by PRESET, like the depth check above it: `dunes` and `hangar` are
    // still perfectly good grounds that surviving levels stand on, and going
    // through LEVELS meant this died the day those level keys were deleted.
    const tau = (k) => TERRAIN_PRESETS[k].loose.refill;
    assert(tau('alpine') > tau('arena') && tau('arena') > tau('dunes') && tau('dunes') > tau('drifts'),
      `the memory ordering is wrong: alpine ${tau('alpine')}, arena ${tau('arena')}, `
      + `dunes ${tau('dunes')}, drifts ${tau('drifts')}`);
    return rows.join('; ');
  });

  check('ground: the memory is a window that follows you and forgets behind it', () => {
    /* The addressing is toroidal — a column leaving the back of the window has
     * the same texel index as the one arriving at the front — so the ONE thing
     * that must never happen is a mark landing outside the window and aliasing
     * onto a texel belonging to entirely different ground. That would print
     * somebody's tracks on a hillside forty-eight metres away.
     */
    const S = new SurfaceField({ res: 64, size: 32, depth: 0.3, refill: 100 });
    S.follow(0, 0);
    assert(S.tread(0, 0, 0.2, 0.3) > 0, 'a mark at the centre of the window did nothing');
    assert(S.tread(200, 0, 0.2, 0.3) === 0, 'a mark 200 m outside the window was accepted');
    assert(S.depthAt(200, 0) === 0, 'the field claims to remember ground it never held');
    const inside = S.depthAt(0, 0);
    // walk far enough that the mark leaves the window, and come back
    S.follow(80, 0);
    assert(S.depthAt(0, 0) === 0, 'a print survived the window scrolling clean past it');
    S.follow(0, 0);
    assert(S.depthAt(0, 0) === 0, 'walking back produced a print nobody made');
    // and a small scroll keeps what is still inside
    S.tread(0, 0, 0.2, 0.3);
    S.follow(4, 0);
    near(S.depthAt(0, 0), inside, 1e-6, 'a four-metre step lost a print still inside the window');
    S.dispose();
    return 'toroidal, masked, and clean on the way out';
  });

  /* ══ deformation that scales with the run ════════════════════════════ */

  check('ground: a crater scales with what the run has made of the player', () => {
    /* Complaint 4. `Player.forcePush` ends in `crater(x, z, 2.6, 0.22)` — two
     * constants — and Player.js is not this workstream's file to edit, so the
     * scale is published on the terrain and derived at DRESSING time, which is
     * the one moment the run and the heightfield are both in hand.
     *
     * The radius takes the CUBE ROOT of might and the depth the whole of it,
     * because the two are not free of each other: a blast that moves k times
     * the material at the same shape is k^(1/3) wider and k deeper. Scaling
     * both linearly at might 3 is an eight-metre hole, which is a change to
     * the level geometry rather than a hit.
     */
    const mightOf = (run, settings) => groundMight({ run, settings });
    const early = mightOf({ tier: 0, boons: [], done: false }, { forcePower: 1 });
    const late = mightOf({ tier: 3, boons: new Array(9).fill({ id: 'x' }), done: false }, { forcePower: 1 });
    assert(Math.abs(early - 1) < 1e-9, `an untouched run already hits at ${early.toFixed(2)}×`);
    assert(late / early > 1.9,
      `a fourth-rung run with nine boons hits at ${late.toFixed(2)}× — that is not "visibly" harder`);
    // the slider enters as a cube root, so turning it to 4 is not 4× the hole
    const slid = mightOf({ tier: 0, boons: [], done: false }, { forcePower: 4 });
    assert(slid < 1.7, `forcePower 4 alone puts the ground at ${slid.toFixed(2)}×`);

    // …and the hole that comes out of it, measured off the heightfield.
    /* MEASURED AGAINST THE GROUND AS IT WAS, sampled before the hit and again
     * after. Not against `preset.height`: the mesh is a bilinear read of a
     * 1.65 m grid and the preset is the analytic function it was sampled from,
     * so the two differ by centimetres everywhere and a width measured that
     * way comes out as the whole probe, at every might. */
    const dig = (might) => {
      const t = new Terrain(new THREE.Scene(), 'dunes', 0.6);
      t.setMight(might);
      const before = [];
      for (let r = 0; r <= 14; r += 0.1) before.push(t.height(r, 0));
      t.crater(0, 0, 2.6, 0.22);
      let wide = 0;
      for (let i = 0; i <= 140; i++) {
        if (Math.abs(t.height(i * 0.1, 0) - before[i]) > 0.01) wide = i * 0.1;
      }
      const deepest = before[0] - t.height(0, 0);
      t.dispose();
      return { deepest, wide };
    };
    const a = dig(early), b = dig(late);
    assert(b.deepest / a.deepest > 1.9,
      `the late crater is ${(b.deepest / a.deepest).toFixed(2)}× as deep as the early one`);
    assert(b.wide > a.wide,
      `the late crater is ${b.wide.toFixed(1)} m across against the early ${a.wide.toFixed(1)} m`);
    assert(b.wide / a.wide < 1.9,
      `the crater got ${(b.wide / a.wide).toFixed(2)}× wider — that is level geometry, not a hit`);

    // and the dressing pass is what publishes it, so it is live in the game
    const t = new Terrain(new THREE.Scene(), 'dunes', 0.5);
    const w = { terrain: t, run: { tier: 2, boons: [{ id: 'a' }], done: false }, settings: { forcePower: 1 } };
    beginDressing(w, 1);
    assert(t.might > 1.3, `dressing left the ground at might ${t.might.toFixed(2)}`);
    t.dispose();

    return `might ${early.toFixed(2)} → ${late.toFixed(2)}; crater `
      + `${(a.deepest * 100).toFixed(0)} cm / ${a.wide.toFixed(1)} m → `
      + `${(b.deepest * 100).toFixed(0)} cm / ${b.wide.toFixed(1)} m`;
  });

  check('ground: a small hit still marks the loose layer the heightfield cannot hold', () => {
    /* The grid is the reason this exists. `crater` widens anything under
     * step × 1.35 — 2.20 m on the alpine preset — and SHALLOWS it to conserve
     * the material, so a bolt that hits the sand asks for 0.55 m × 0.06 m and
     * gets 2.20 m × 0.004 m: four millimetres over a two-metre disc, which is
     * nothing, in both senses.
     *
     * The loose layer takes it at its real size instead, which is what makes a
     * near miss read as a near miss.
     */
    const t = new Terrain(new THREE.Scene(), 'dunes', 0.6);
    ground.frame(0.02, V(0, 0, 0));
    const h0 = t.height(1, 1);
    t.crater(1, 1, 0.55, 0.06);
    const mesh = h0 - t.height(1, 1);
    const surf = t.surface.depthAt(1, 1);
    assert(mesh < 0.02, `the control is wrong — the mesh moved ${(mesh * 100).toFixed(1)} cm`);
    assert(surf > 0.04,
      `a bolt crater left ${(surf * 1000).toFixed(1)} mm in the sand and ${(mesh * 1000).toFixed(1)} mm in the mesh`);
    // and it is a hole of about the size asked for, not a 2.2 m disc
    assert(t.surface.depthAt(2.4, 1) < surf * 0.25,
      'the surface crater is as wide as the grid cell the mesh was forced to');
    const rep = `mesh ${(mesh * 1000).toFixed(1)} mm, loose layer ${(surf * 1000).toFixed(0)} mm`;
    t.dispose();
    return rep;
  });

  /* ══ the blade in the ground ═════════════════════════════════════════ */

  check('ground: a blade dragged through it cuts a line that glows and then cools', () => {
    /* Complaint 5, and the thing that made it invisible: `bladeScar` — molten
     * spatter, smoke, sparks, a scorch decal that starts white-hot — was
     * written, tested by nothing, and CALLED BY NOTHING. `grep -rn bladeScar
     * src/` returned one line, its own definition. The blade contact solver
     * only ever tests enemies, props and doors; the ground is not a target, so
     * a lit blade could be dragged through a dune all day for no effect at all.
     *
     * `ground.scar(a, b)` is the entry point now, and it does both halves: the
     * trench, so the ground either side of the line catches the light
     * differently and the cut has a SHAPE, and the heat, which the material
     * reads as glow for the first few seconds and as soot for the next minute.
     * A scorch decal alone is a sticker; a trench alone is a scratch.
     */
    const t = new Terrain(new THREE.Scene(), 'dunes', 1.0);
    const P = new Particles(new THREE.Scene(), 1);
    ground.frame(0.02, V(0, 0, 0));
    const a = V(-1.2, t.height(-1.2, 0.4), 0.4), b = V(1.4, t.height(1.4, -0.3), -0.3);
    const decalsBefore = P.decals.head;
    ground.scar(a, b, { heat: 1 });

    // a trench, along the whole line
    const mid = V((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    const trench = t.surface.depthAt(mid.x, mid.z);
    assert(trench > 0.02, `the cut left ${(trench * 1000).toFixed(1)} mm of trench`);
    assert(t.surface.depthAt(a.x, a.z) > 0.01 && t.surface.depthAt(b.x, b.z) > 0.01,
      'the trench does not reach both ends of the stroke');
    /* And it is NARROW — a blade cut, not a furrow. The floor on how narrow is
     * the window's own texel: a mark under 1.7 cells cannot reach its depth at
     * any cell it touches, so the cut is widened to 0.43 m at the top quality
     * tier exactly as `crater` is widened to 2.2 m against the heightfield.
     * Half a metre off the line it must be gone. */
    assert(t.surface.depthAt(mid.x, mid.z + 0.6) < 0.004,
      `the cut is still ${(t.surface.depthAt(mid.x, mid.z + 0.6) * 100).toFixed(1)} cm deep `
      + '0.6 m off the line — that is a furrow');

    // the glow, and that it cools
    const hot = t.surface.scorchAt(mid.x, mid.z);
    assert(hot > 0.9, `the cut starts at scorch ${hot.toFixed(2)} — that is already cold`);
    const sample = (secs) => {
      let el = 0;
      while (el < secs) { ground.frame(0.1, V(0, 0, 0)); el += 0.1; }
      return t.surface.scorchAt(mid.x, mid.z);
    };
    // the shader splits one byte into glow and soot with two smoothsteps; these
    // are the same two thresholds, so the numbers mean what the frame shows
    const glow = (v) => { const x = Math.min(1, Math.max(0, (v - 0.52) / 0.43)); return x * x * (3 - 2 * x); };
    const soot = (v) => { const x = Math.min(1, Math.max(0, (v - 0.02) / 0.32)); return x * x * (3 - 2 * x); };
    const g0 = glow(hot), g4 = glow(sample(4)), s30 = soot(sample(26)), s120 = soot(sample(94));
    assert(g0 > 0.9, `the fresh cut glows ${g0.toFixed(2)}`);
    assert(g4 < 0.1, `four seconds later it still glows ${g4.toFixed(2)} — that is not cooling`);
    assert(s30 > 0.25, `half a minute later the char is ${s30.toFixed(2)} — the scar vanished with the heat`);
    assert(s120 < 0.05, `two minutes later the char is still ${s120.toFixed(2)}`);

    // the particle half is live too: `bladeScar` finally has a caller
    assert(P.decals.head !== decalsBefore, 'the cut laid no decals down the line');
    const scenery = SRC('world/Scenery.js');
    assert(/scar\(a, b, opts[\s\S]{0,400}bladeScar\(/.test(scenery),
      'ground.scar no longer reaches the molten-spatter emitter');

    const rep = `glow ${g0.toFixed(2)} → ${g4.toFixed(2)} at 4 s; char ${s30.toFixed(2)} at 30 s, `
      + `${s120.toFixed(2)} at 2 min; trench ${(trench * 1000).toFixed(0)} mm`;
    P.dispose(); t.dispose();
    return rep;
  });

  /* ══ the material actually reads it ══════════════════════════════════ */

  check('ground: the material reads the memory, in one tap, and lights it', () => {
    /* Everything above writes into a texture, and none of it means anything
     * unless the ground SHADER reads it. Four things have to be true and each
     * one of them was written by hand into a 700-line shader:
     *
     *   the sampler points at the live field, not at the 1×1 fallback;
     *   the depth GRADIENT reaches the normal, because a print is read as a
     *     lit wall and a shaded one and nothing else;
     *   the window is MASKED, or the wrap addressing prints tracks on ground
     *     forty-eight metres away;
     *   the glow is EMISSIVE, so it survives the shadow it is lying in and the
     *     bloom pass finds it.
     */
    const t = new Terrain(new THREE.Scene(), 'alpine', 0.74);
    const u = t._uniforms;
    assert(u.uSurfMap.value === t.surface.texture, 'the ground is sampling something else');
    assert(u.uSurfSet.value.x > 0, 'the surface memory is compiled out on a snow level');
    near(u.uSurf.value.z, 1 / t.surface.size, 1e-9,
      'the window is not sampled over the window it was written for');
    t.tick(0.1, V(40, 0, -25));
    near(u.uSurf.value.x, 40, 1e-6, 'the window uniform did not follow the player');

    const src = readFileSync(new URL('../../src/world/Terrain.js', import.meta.url), 'utf8');
    const frag = src.slice(src.indexOf('const TERRAIN_FRAG_MAP'), src.indexOf('const TERRAIN_FRAG_ROUGH'));
    assert(/texture2D\(uSurfMap/.test(frag), 'the shader never samples the surface memory');
    assert((frag.match(/texture2D\(uSurfMap/g) || []).length === 1,
      'the surface memory is sampled more than once — the gradient is meant to be precomputed');
    assert(/terNrmOff[\s\S]{0,200}Txz \* grd\.x/.test(frag),
      'the depth gradient never reaches the normal, so a print has no wall');
    assert(/smoothstep\(uSurf\.w/.test(frag), 'the window is not masked at its edge');
    assert(/totalEmissiveRadiance \+= uSurfGlowCol/.test(src),
      'a cut in the ground is albedo rather than light');
    assert(src.includes(".replace('#include <emissivemap_fragment>'"),
      'the emissive chunk is never spliced into the ground material');

    // the glow is a BLACKBODY, not the blade's colour: ground at two thousand
    // kelvin comes out orange whoever heated it
    const c = u.uSurfGlowCol.value;
    assert(c.r > c.g && c.g > c.b, `the ground glows #${c.getHexString()} — that is not hot ground`);
    assert(c.r > 1.2, 'the glow is inside the display range, so it cannot bloom');

    // reserved words. One of these compiled fine in JS and took the whole
    // terrain material out of the frame on the device.
    for (const word of ['packed', 'patch', 'sample', 'filter', 'half', 'output']) {
      assert(!new RegExp(`\\b(float|vec[234]|int|bool)\\s+${word}\\b`).test(frag),
        `the fragment shader declares a variable called "${word}", which is a reserved word in GLSL ES`);
    }
    t.dispose();
    return 'one tap, gradient to the normal, masked window, emissive glow';
  });

  check('ground: the memory costs one texture and goes quiet when nothing is happening', () => {
    /* "Performance is a real constraint." What this costs is a texture upload,
     * and the whole design of the ageing is about not paying it: the tick is
     * fixed at 10 Hz rather than per frame, and a field with nothing live in it
     * does not tick at all. A level nobody has walked on costs one texture
     * object and zero bandwidth.
     */
    const t = new Terrain(new THREE.Scene(), 'alpine', 1.0);
    const S = t.surface;
    const bytes = S.res * S.res * 4;
    assert(bytes <= 160 * 1024, `the window is ${(bytes / 1024).toFixed(0)} kB per upload`);
    assert(S.cell <= 0.30, `a texel is ${(S.cell * 100).toFixed(0)} cm — wider than a boot print`);

    // quiet ground: no ageing, no upload
    let uploads = 0;
    Object.defineProperty(S.texture, 'needsUpdate', { set() { uploads++; }, get() { return false; } });
    for (let i = 0; i < 120; i++) t.tick(1 / 60, V(0, 0, 0));
    assert(uploads === 0, `${uploads} uploads over two seconds of standing on undisturbed snow`);

    // one print, then two seconds: at most a 10 Hz tick's worth
    t.tread(1, 1, 0.18, 0.3, 0, 0);
    for (let i = 0; i < 120; i++) t.tick(1 / 60, V(0, 0, 0));
    assert(uploads <= 24,
      `${uploads} uploads in the two seconds after one footfall — that is per frame, not per tick`);
    assert(uploads >= 4, `only ${uploads} uploads — the print is not being aged at all`);

    /* THE CELL IS THE SAME AT EVERY TIER and the WINDOW is what moves. A
     * print has a real size — a boot is 11 cm — and a settings menu does not
     * get to make it bigger; what a cheaper tier honestly buys is remembering
     * less ground. The first version had this the other way round and the
     * default `medium` tier came out with 37 cm texels, which rendered as
     * broad undulations in the snow rather than as footprints. */
    const lo = new Terrain(new THREE.Scene(), 'alpine', 0.6);
    assert(lo.surface.res < S.res, 'the low quality tier pays the full window');
    assert(lo.surface.size < S.size, 'the low tier remembers the same ground for less');
    near(lo.surface.cell, S.cell, 0.02,
      `the low tier's texel is ${(lo.surface.cell * 100).toFixed(0)} cm against `
      + `${(S.cell * 100).toFixed(0)} — a footprint is not a quality setting`);
    const rep = `${S.res}² over ${S.size} m (${(S.cell * 100).toFixed(0)} cm/texel, `
      + `${(bytes / 1024).toFixed(0)} kB), ${uploads} uploads per print, `
      + `low tier ${lo.surface.res}² over ${lo.surface.size.toFixed(0)} m`;
    lo.dispose(); t.dispose();
    return rep;
  });

  check('ground: dragging the blade through the ground actually calls the mark', () => {
    /**
     * `Particles.bladeScar` — molten line, spatter, smoke, cooling scorch —
     * shipped with ZERO CALLERS anywhere in src/. It was written, it was
     * correct, and nothing in the game could ever reach it, because the blade
     * solver tests enemies, props and doors, and the ground is none of those.
     * That is this codebase's signature bug wearing a different hat: not a
     * parameter nobody reads, an EFFECT nobody calls.
     *
     * So the check is on the seam rather than on the pixels: drive the real
     * Saber's update with its tip in the ground and assert `ground.scar` is
     * reached, then lift the blade out and assert it is not. A structural grep
     * would pass on a call site behind a condition that is never true.
     */
    const calls = [];
    const real = ground.scar;
    ground.scar = (a, b) => { calls.push([a.clone(), b.clone()]); return 1; };
    try {
      const s = new Saber(new THREE.Scene(), { colorIndex: 0, bladeLength: 1.15 });
      s.ignite(); s.ignition = 1;
      const q = new THREE.Quaternion();
      // blade pointed down, hilt at hip height: the tip is in the floor
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      for (let i = 0; i < 6; i++) {
        s.setHiltPose(new THREE.Vector3(i * 0.1, 1.2, 0), q);
        s.update(1 / 60, {});
      }
      const dragged = calls.length;
      assert(dragged >= 4,
        `six frames of dragging the blade along the floor reached ground.scar ${dragged} times — `
        + 'the effect has no caller again');
      // …and the stroke it is handed is the tip's, not the hilt's
      const [a, b] = calls[calls.length - 1];
      assert(a.y < 0.3 && b.y < 0.3,
        `the stroke handed to ground.scar is at y ${a.y.toFixed(2)}→${b.y.toFixed(2)} — that is the hilt, not the tip`);
      assert(a.distanceTo(b) > 1e-4, 'the stroke has no length');
      // retracted: nothing
      calls.length = 0;
      s.retract(); s.ignition = 0; s.lit = false;
      for (let i = 0; i < 6; i++) {
        s.setHiltPose(new THREE.Vector3(i * 0.1, 1.2, 0), q);
        s.update(1 / 60, {});
      }
      assert(calls.length === 0, `a retracted hilt still scarred the ground ${calls.length} times`);
      s.dispose?.();
      return `${dragged}/6 frames marked while lit at tip y≈${a.y.toFixed(2)}, 0 while retracted`;
    } finally { ground.scar = real; }
  });

  check('ground: the blade keeps cutting after a level change', () => {
    /**
     * `scar`'s throttle read TWO CLOCKS through one field:
     *
     *     const now = ground.fx ? ground.fx.decals.time : Date.now() / 1000;
     *
     * — a decal clock starting at 0 when a Particles facade is published, and
     * a wall clock of about 1.78e9 when it is not. `ground._scarAt` held
     * whichever was current, so the moment `fx` changed the comparison stopped
     * meaning anything: losing it jumps the stamp to 1.78e9 and refuses every
     * cut for a second, and getting it back makes `now - _scarAt` about
     * −1.78e9, which is under any threshold — so dragging the blade through
     * the ground does nothing FOR THE REST OF THE SESSION.
     *
     * Found by accident: the trench check above passed alone and failed under
     * the full suite, because another suite had scarred on the wall clock a
     * fraction of a second earlier and one throttle refused the other's cut.
     * An order-dependent failure is usually the check's fault; this time it
     * was the game's, and the check was right.
     *
     * Driven through the transition rather than asserted about the field: what
     * matters is that a cut lands on the far side of it.
     */
    const t = new Terrain(new THREE.Scene(), 'dunes', 1.0);
    const P = new Particles(new THREE.Scene(), 1);
    const prevFx = ground.fx;
    try {
      const cut = (x) => {
        // A fresh line each time, and far enough apart not to overlap.
        const a = V(x, t.height(x, 3), 3), b = V(x + 2, t.height(x + 2, 3.4), 3.4);
        const before = t.surface.depthAt(x + 1, 3.2);
        ground.scar(a, b, { heat: 1 });
        return t.surface.depthAt(x + 1, 3.2) - before;
      };
      // Well past the 1/15 s throttle, so nothing here is testing the throttle.
      const wait = () => { for (let i = 0; i < 10; i++) ground.frame(0.05, V(0, 0, 0)); };

      ground.fx = P;                       // a level with a particle field
      wait();
      const withFx = cut(-14);
      assert(withFx > 0.02, `a cut with a particle field left ${(withFx * 1000).toFixed(1)} mm`);

      ground.fx = null;                    // …unloaded
      wait();
      const without = cut(-4);
      assert(without > 0.02,
        `the first cut after a level unload left ${(without * 1000).toFixed(1)} mm — the throttle is `
        + 'comparing a decal clock against a wall clock');

      ground.fx = new Particles(new THREE.Scene(), 1);   // …and the next level
      wait();
      const again = cut(6);
      assert(again > 0.02,
        `the first cut of the NEXT level left ${(again * 1000).toFixed(1)} mm — the stamp is 1.78e9 `
        + 'ahead of the clock now being read, so no cut will ever pass the throttle again');

      // …and the throttle itself still works, or the fix is a deletion.
      const back = cut(6.05);
      assert(back <= 0.0001,
        `two cuts in the same frame both landed (${(back * 1000).toFixed(1)} mm) — the 1/15 s `
        + 'throttle is what keeps a 144 Hz hook from recycling the whole decal ring five times a second');
      return `${(withFx * 1000).toFixed(0)} mm with fx, ${(without * 1000).toFixed(0)} mm after an `
        + `unload, ${(again * 1000).toFixed(0)} mm on the next level; a second cut in the same frame refused`;
    } finally {
      ground.fx = prevFx;
      t.dispose?.();
      P.dispose?.();
    }
  });
}
