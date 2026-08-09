/**
 * GROUND COVER AND THE SHAPE OF A SCATTER.
 *
 * The complaint this file answers, in the player's words: "rather than for
 * instance having you play on an entire field of grass all you did was add a
 * couple patches here and there, a couple rocks here and there, it just looks
 * like shit and not only that it looks like a jumbled mess with just little
 * objects everywhere."
 *
 * Three separate, measurable failures were behind it, and each one gets a
 * check here rather than an opinion:
 *
 *   1. THE COVER FIELD WAS THREE DIFFERENT FIELDS. The terrain shader masked
 *      its cover tint with a 30 m value noise, the grass clumped off a 36 m
 *      fbm, and the props used none. So the ground could be painted green
 *      where nothing grew.
 *
 *   2. THE SCATTER WAS UNIFORM. Clark–Evans — mean nearest-neighbour distance
 *      over what a Poisson process of the same intensity gives — came out at
 *      0.89 / 0.82 / 0.80 on the three outdoor levels. 1.0 is uniform random.
 *      Two thousand pebbles at R ≈ 0.85 is exactly "little objects everywhere".
 *
 *   3. NOTHING COULD TOUCH ANYTHING. `siteOk` enforced a 2.2 m mutual
 *      exclusion radius, 1.4 m for cluster satellites, so talus, thickets and
 *      drifts — where real ground gets its density — were structurally
 *      impossible.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { GrassField, makeCoverField, ground } from '../../src/world/Scenery.js';
import { LEVELS, LEVEL_ORDER, siteOk, drift, beginDressing, stoneField } from '../../src/game/Levels.js';

const OUTDOOR = ['dunes', 'arena', 'canyon'];

function stubWorld(terrain) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() {}, staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null, time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain, settings: { quality: 'medium' },
  };
}

/**
 * Every instanced stone that reached the scene, as [x, z].
 *
 * `wide` keeps only the passes that spray over more than 60 m of ground — the
 * ones that scatter across the PLAY AREA rather than banking an apron against
 * a feature. That distinction matters for the cover test below and nowhere
 * else: a scree apron at the foot of an outcrop is placed by the outcrop and
 * has no business consulting a vegetation field, while a 150 m spray does.
 */
function stones(world, { minCount = 40, wide = false } = {}) {
  const out = [];
  const m = new THREE.Matrix4(), t = new THREE.Vector3();
  const q = new THREE.Quaternion(), s = new THREE.Vector3();
  world.scene.traverse((o) => {
    if (!o.isInstancedMesh || o.count < minCount) return;
    o.updateMatrixWorld(true);
    const mine = [];
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); m.decompose(t, q, s); t.applyMatrix4(o.matrixWorld);
      if (!isFinite(t.x) || !isFinite(t.z)) continue;
      mine.push([t.x, t.z]);
      minx = Math.min(minx, t.x); maxx = Math.max(maxx, t.x);
      minz = Math.min(minz, t.z); maxz = Math.max(maxz, t.z);
    }
    if (wide && Math.max(maxx - minx, maxz - minz) < 60) return;
    for (const p of mine) out.push(p);
  });
  return out;
}

/**
 * CLARK–EVANS on a disc: the mean nearest-neighbour distance divided by the
 * 1/(2√ρ) a Poisson process of the same intensity would give.
 *
 *   R ≈ 1   indistinguishable from uniform random
 *   R < 1   clustered — the smaller, the harder
 *   R > 1   over-dispersed, i.e. something is enforcing a minimum spacing
 *
 * The last case matters here: a mutual-exclusion radius pushes R ABOVE 1, so
 * this one statistic catches both failure modes the file is about.
 */
function clarkEvans(pts, R) {
  const inside = pts.filter((p) => p[0] * p[0] + p[1] * p[1] <= R * R);
  const n = inside.length;
  if (n < 40) return null;
  const cell = 8, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const p of inside) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    let b = grid.get(k); if (!b) grid.set(k, b = []);
    b.push(p);
  }
  const d = [];
  for (const p of inside) {
    const gi = Math.floor(p[0] / cell), gj = Math.floor(p[1] / cell);
    let best = Infinity;
    for (let r = 0; r <= 8; r++) {
      for (let i = gi - r; i <= gi + r; i++) {
        for (let j = gj - r; j <= gj + r; j++) {
          if (r > 0 && Math.max(Math.abs(i - gi), Math.abs(j - gj)) !== r) continue;
          const b = grid.get(key(i, j)); if (!b) continue;
          for (const o of b) {
            if (o === p) continue;
            const dd = Math.hypot(o[0] - p[0], o[1] - p[1]);
            if (dd < best) best = dd;
          }
        }
      }
      if (best <= r * cell) break;
    }
    if (isFinite(best)) d.push(best);
  }
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const expected = 0.5 / Math.sqrt(n / (Math.PI * R * R));
  d.sort((a, b) => a - b);
  return { n, mean, expected, R: mean / expected, p90: d[(d.length * 0.9) | 0] };
}

let DRESSED = null;
function dressed() {
  if (DRESSED) return DRESSED;
  DRESSED = new Map();
  for (const key of OUTDOOR) {
    const L = LEVELS[key];
    const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
    const world = stubWorld(terrain);
    // the World builds the cover before it dresses, and the drifts read it
    const grass = L.grass
      ? new GrassField(new THREE.Scene(), terrain, { count: 11000, density: L.grass, radius: 46 })
      : null;
    L.dress(world);
    DRESSED.set(key, { world, terrain, grass, pts: stones(world), wide: stones(world, { wide: true }) });
  }
  return DRESSED;
}

export function run({ check, assert, near }) {

  /* ══ one field ═══════════════════════════════════════════════════════ */

  check('cover: the terrain paints itself with the same field the grass grows from', () => {
    /* Before this, the mask in the terrain shader and the clump field in the
     * grass scatter were different functions at different frequencies with
     * different thresholds — so the ground could be toned as covered where
     * there was no cover and left bare under a clump. There is one field now,
     * and the terrain gets it as a baked texture, which is also the only way
     * the tone can reach past the instanced field's outer radius at all: the
     * texture runs to the edge of the heightfield for no draw calls. */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const u = t._uniforms;
    near(u.uCover.value.x, 0, 1e-6, 'bare ground starts out covered');
    const g = new GrassField(new THREE.Scene(), t, { count: 4000, density: 1, radius: 46 });
    assert(g.coverTex, 'the grass never handed the terrain a mask');
    assert(u.uCoverMap.value === g.coverTex, 'the terrain is masking itself with something else');
    near(u.uCover.value.y, 1 / t.size, 1e-9,
      'the mask is not being sampled over the heightfield it was baked for');

    // and the texture IS the field, to within its own 8-bit quantisation
    const img = u.uCoverMap.value.image;
    const res = img.width, size = t.size;
    let worst = 0, sum = 0, n = 0;
    for (let j = 2; j < res - 2; j += 5) {
      for (let i = 2; i < res - 2; i += 5) {
        const x = ((i + 0.5) / res - 0.5) * size, z = ((j + 0.5) / res - 0.5) * size;
        const texel = img.data[(j * res + i) * 4] / 255;
        const d = Math.abs(texel - g.cover.at(x, z));
        worst = Math.max(worst, d); sum += d; n++;
      }
    }
    assert(worst < 1 / 255 + 1e-6,
      `a texel of the cover mask is ${worst.toFixed(4)} away from the field the blades are placed by`);
    // the mask must actually be a MASK — bimodal, not a grey wash
    let lowN = 0, highN = 0;
    for (let k = 0; k < img.data.length; k += 4) {
      if (img.data[k] < 26) lowN++; else if (img.data[k] > 229) highN++;
    }
    const decided = (lowN + highN) / (img.data.length / 4);
    assert(decided > 0.72,
      `only ${(decided * 100).toFixed(0)}% of the mask is decidedly covered or decidedly bare — `
      + 'that is a wash over everything, which is the thing being fixed');
    const rep = `${res}² mask, worst texel error ${worst.toFixed(4)}, ${(decided * 100).toFixed(0)}% decided`;
    g.dispose();
    // and it must hand the mask back rather than leave the terrain sampling a
    // texture it has just deleted
    assert(u.uCoverMap.value !== g.coverTex, 'the terrain still points at the disposed mask');
    near(u.uCover.value.x, 0, 1e-6, 'the cover amount outlived the field that asked for it');
    t.dispose();
    return rep;
  });

  check('cover: every level grows a different field', () => {
    // The seed came off the terrain preset, and the terrain did not carry its
    // own name — so every level in the game was handed seed 1337 and the three
    // outdoor levels had the SAME grass laid out in the same places.
    const seen = new Map();
    for (const key of OUTDOOR) {
      const t = new Terrain(new THREE.Scene(), LEVELS[key].terrain, 0.5);
      assert(t.presetKey === LEVELS[key].terrain,
        `${key}: the terrain does not know it is a ${LEVELS[key].terrain}`);
      const g = new GrassField(new THREE.Scene(), t, { count: 400, density: LEVELS[key].grass, radius: 46 });
      seen.set(key, { ox: g.cover.ox, oz: g.cover.oz, amount: g.cover.amount });
      g.dispose(); t.dispose();
    }
    const keys = [...seen.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = seen.get(keys[i]), b = seen.get(keys[j]);
        assert(Math.hypot(a.ox - b.ox, a.oz - b.oz) > 50,
          `${keys[i]} and ${keys[j]} are standing in the same part of the same field`);
      }
    }
    return keys.map((k) => `${k} @${seen.get(k).ox.toFixed(0)},${seen.get(k).oz.toFixed(0)} `
      + `${(seen.get(k).amount * 100).toFixed(0)}%`).join('  ');
  });

  check('cover: the field is bimodal — swathes and clearings, not an even dusting', () => {
    /* The whole argument of this pass in one statistic. A landscape reads as
     * full when the full parts are full and the empty parts are empty; an fbm
     * used raw is a grey wash whose every square metre is a bit covered, which
     * is what "evenly dusted" means numerically. Solving the threshold to a
     * stated area fraction and pushing the result through a narrow smoothstep
     * is what makes it decide. */
    const F = makeCoverField({ seed: 99, amount: 0.5, patch: 54, grain: 15, extent: 260 });
    let lo = 0, hi = 0, n = 0, sum = 0;
    for (let z = -240; z <= 240; z += 5) {
      for (let x = -240; x <= 240; x += 5) {
        const v = F.at(x, z); n++; sum += v;
        if (v < 0.1) lo++; else if (v > 0.9) hi++;
      }
    }
    const frac = sum / n;
    assert(Math.abs(frac - 0.5) < 0.06,
      `asked for half the ground covered and got ${(frac * 100).toFixed(0)}%`);
    assert((lo + hi) / n > 0.72,
      `only ${(((lo + hi) / n) * 100).toFixed(0)}% of the ground is decided — the rest is a wash`);
    // and the same request at another fraction has to land there too, or the
    // threshold is not being solved, it is being guessed
    for (const want of [0.22, 0.78]) {
      const G = makeCoverField({ seed: 7, amount: want, patch: 54, grain: 15, extent: 260 });
      let s2 = 0, m2 = 0;
      for (let z = -240; z <= 240; z += 5) for (let x = -240; x <= 240; x += 5) { s2 += G.at(x, z); m2++; }
      assert(Math.abs(s2 / m2 - want) < 0.07,
        `asked for ${want} and got ${(s2 / m2).toFixed(2)}`);
    }
    return `${(frac * 100).toFixed(0)}% covered, ${(((lo + hi) / n) * 100).toFixed(0)}% of it decided either way`;
  });

  /* ══ the shape of a scatter ══════════════════════════════════════════ */

  check('scatter: the ground litter is clustered, measured against a Poisson control', () => {
    /* THE NUMBER THE COMPLAINT REDUCES TO. Clark–Evans on every instanced
     * stone inside r = 130 m, against a Poisson process of the same intensity
     * generated here so "clustered" is a comparison and not an adjective:
     *
     *     shipped   dunes 0.893   arena 0.819   canyon 0.800
     *
     * That is uniform scatter with a rounding error of clumping on it, over
     * three to five thousand objects a level, which is precisely what "a
     * jumbled mess with just little objects everywhere" describes. The control
     * is drawn here every run rather than quoted, because a statistic with an
     * edge correction in it has to be checked against the same estimator that
     * measures the real thing.
     */
    const rows = [];
    // the control: uniform random on the same disc, same count, same estimator
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const control = [];
    for (let i = 0; i < 4000; i++) {
      const a = rnd() * Math.PI * 2, r = 130 * Math.sqrt(rnd());
      control.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const ctrl = clarkEvans(control, 130);
    assert(Math.abs(ctrl.R - 1) < 0.06,
      `the Poisson control measures R = ${ctrl.R.toFixed(3)} — the estimator is biased, not the levels`);

    for (const [key, d] of dressed()) {
      const ce = clarkEvans(d.pts, 130);
      assert(ce && ce.n > 500, `${key}: only ${ce ? ce.n : 0} stones to measure`);
      assert(ce.R < 0.70,
        `${key}: Clark–Evans R = ${ce.R.toFixed(3)} against the control's ${ctrl.R.toFixed(3)} — `
        + 'that is a uniform sprinkle, not drifts');
      // and clustered is not the same as collapsed: a drift still has a spread
      assert(ce.p90 > 0.8,
        `${key}: nine tenths of the stones are within ${ce.p90.toFixed(2)} m of another — that is a heap, not ground`);
      rows.push(`${key} R=${ce.R.toFixed(2)} (n=${ce.n})`);
    }
    return `Poisson control R=${ctrl.R.toFixed(3)}; ${rows.join(', ')}`;
  });

  check('scatter: the drifts land where the cover is not', () => {
    /* Two independent fields put their clearings on top of each other by
     * chance, and the ground under the overlap carries neither stone nor
     * plant: measured, that was 10.9% of the dune sea's walkable disc. Rock
     * and vegetation compete for the same ground in the real thing — what you
     * get where cover fails is pavement and lag — so the stone field is biased
     * away from the cover field rather than being drawn beside it. */
    const rows = [];
    for (const [key, d] of dressed()) {
      if (!d.grass) continue;
      let onCover = 0, n = 0;
      for (const [x, z] of d.wide) {
        if (x * x + z * z > 130 * 130) continue;
        n++; onCover += d.grass.cover.at(x, z);
      }
      // what the same count would average if the stones ignored the cover
      let base = 0, m = 0;
      for (let z = -130; z <= 130; z += 5) for (let x = -130; x <= 130; x += 5) {
        if (x * x + z * z > 130 * 130) continue;
        base += d.grass.cover.at(x, z); m++;
      }
      const got = onCover / n, flat = base / m;
      /* Measured against the room the level HAS. A gorge that is 96% covered
       * cannot move its stones onto 20% ground because there is none, so the
       * bar is a fraction of the bare ground available rather than a fraction
       * of the cover — which is the same property stated so that it does not
       * quietly become unreachable on the greenest level in the game. */
      const room = 1 - flat;
      assert(n > 400, `${key}: only ${n} stones in a wide pass to measure`);
      assert(flat - got > 0.25 * room,
        `${key}: stones sit on ground that is ${(got * 100).toFixed(0)}% covered against the level's own `
        + `${(flat * 100).toFixed(0)}%, with ${(room * 100).toFixed(0)}% bare ground to have gone to — `
        + 'the drifts are ignoring the cover');
      rows.push(`${key} ${(got * 100).toFixed(0)}% vs ${(flat * 100).toFixed(0)}%`);
    }
    assert(rows.length >= 3, `only ${rows.length} levels compared`);
    return `mean cover under a stone vs over the level: ${rows.join(', ')}`;
  });

  check('composition: things are allowed to touch, and a drift follows a field', () => {
    /* `siteOk` enforced a mutual-exclusion radius on everything, always — 2.2 m
     * by default, 1.4 m for a cluster satellite — so nothing in the game could
     * rest against anything else. Real ground gets most of its density from
     * exactly that. Zero clearance now means "may touch" and still records the
     * site, so anything that does want its own room still gets it. */
    const world = { terrain: { slopeAt: () => 0.05, height: () => 0 } };
    beginDressing(world, 11);
    assert(siteOk(world, 30, 0, { clearance: 2 }), 'a clear site was refused');
    assert(!siteOk(world, 31, 0, { clearance: 2 }), 'the exclusion radius stopped working');
    assert(siteOk(world, 31, 0, { clearance: 0 }), 'zero clearance still refuses to let things touch');
    assert(siteOk(world, 31.05, 0, { clearance: 0 }), 'two touching things cannot both be placed');
    assert(!siteOk(world, 31.2, 0, { clearance: 2 }),
      'a site placed at zero clearance was not recorded, so it can be built over');

    // and drift has to follow the field rather than the disc
    beginDressing(world, 12);
    const F = makeCoverField({ seed: 5, amount: 0.3, patch: 40, grain: 12, extent: 90 });
    const hit = [];
    const n = drift(world, {
      field: (x, z) => F.at(x, z), rmin: 0, rmax: 90, count: 400, clearance: 0, spawnClear: 0,
    }, (p) => hit.push([p.x, p.z]));
    assert(n > 250, `drift only placed ${n} of 400 through a field covering 30% of the ground`);
    let on = 0;
    for (const [x, z] of hit) on += F.at(x, z);
    const mean = on / hit.length;
    assert(mean > 0.80,
      `the mean field value under a drifted item is ${mean.toFixed(2)} — it is not following the field`);
    // against the same count placed uniformly on the same disc
    beginDressing(world, 13);
    const flat = [];
    drift(world, { rmin: 0, rmax: 90, count: 400, clearance: 0, spawnClear: 0 }, (p) => flat.push([p.x, p.z]));
    let ref = 0;
    for (const [x, z] of flat) ref += F.at(x, z);
    assert(mean > (ref / flat.length) * 1.8,
      `field-driven placement lands on ${mean.toFixed(2)} against uniform's ${(ref / flat.length).toFixed(2)}`);
    return `${n} placed, mean field ${mean.toFixed(2)} against uniform scatter's ${(ref / flat.length).toFixed(2)}`;
  });

  check('scatter: the grit grade is gone, and nothing quietly replaced it', () => {
    /* 520 stones of 22 cm over a 71 m disc, per level. The terrain shader
     * already paints that grain — `uGritCol` and its slope band, over the whole
     * heightfield, for nothing — and at 22 cm a stone is sub-pixel past about
     * ten metres, so what it added at range was aliasing and what it added
     * underfoot was the litter the complaint names. This pins the cut: no wide
     * pass may spray hundreds of sub-30 cm stones over the play area again. */
    const rows = [];
    const m = new THREE.Matrix4(), t = new THREE.Vector3();
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const [key, d] of dressed()) {
      let tiny = 0, spread = 0;
      d.world.scene.traverse((o) => {
        if (!o.isInstancedMesh || o.count < 150) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        o.geometry.boundingBox.getSize(size);
        let big = 0, minx = 1e9, maxx = -1e9;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m); m.decompose(t, q, s);
          if (Math.max(size.x * s.x, size.z * s.z) > 0.30) big++;
          minx = Math.min(minx, t.x); maxx = Math.max(maxx, t.x);
        }
        // a wide pass of stones that are nearly all under 30 cm across
        if (big < o.count * 0.25 && maxx - minx > 60) { tiny += o.count; spread = Math.max(spread, maxx - minx); }
      });
      assert(tiny < 200,
        `${key}: ${tiny} stones under 30 cm are sprayed over ${spread.toFixed(0)} m of ground — `
        + 'the grit grade is back');
      rows.push(`${key} ${tiny}`);
    }
    return `sub-30 cm stones in a wide pass: ${rows.join(', ')}`;
  });
}
