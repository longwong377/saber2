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
 *
 * Coverage and clustering came out measurably right, and the complaint did not
 * go away, because the rest of it was never about how MUCH cover there is:
 *
 *   4. THE BLADES WERE HOOPS. `ks = bend * h` swept the strip along a circular
 *      arc — constant curvature, the shape of bent fence wire. The turn rate at
 *      90% of a blade's height was 1.00× the rate at 15%, by construction.
 *
 *   5. THEY WERE NEEDLES. `pow(1 - h, 0.55)` is down to 47% of base width at
 *      three quarters height and 2% at the tip.
 *
 *   6. A CLUMP WENT OFF LIKE A FIREWORK. The facing was drawn per BLADE, so
 *      eight blades out of one crown pointed eight different ways.
 *
 *   7. THE FIELD WAS ONE COLOUR — 2.9 degrees of hue over the whole thing.
 *
 *   8. AND IT WENT BLACK IN SHADE, because the grass multiplied the SUN's
 *      shadow mask into every directional light including the shadowless blue
 *      fill, which the ground beside it kept.
 *
 * Those five are the second half of this file. Each one is arithmetic — the
 * blade's shape is a vertex displacement and the shade is a fragment's sum —
 * so each one is a number here rather than a screenshot.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import {
  GrassField, makeCoverField, ground, bladeSpine, bladeWidth, bladeRows,
  bladeSideAxis, bladeVisibleWidth, grassShade,
} from '../../src/world/Scenery.js';
import { LEVELS, LEVEL_ORDER, siteOk, drift, beginDressing, stoneField } from '../../src/game/Levels.js';

/**
 * WHICH LEVELS THESE CHECKS TALK ABOUT, and why the list changed.
 *
 * This file used to say `OUTDOOR = ['dunes', 'arena', 'canyon']` and mean
 * "levels with a grass field", because at the time every outdoor level had
 * one. Four of them no longer do, and that is the requested change, in the
 * player's words: "the tundra/ice maps must have NO GRASS AT ALL… the dune sea
 * must have no grass either… delete grass from any level whose ground is snow,
 * ice, sand or metal."
 *
 * So the split is now by what the ground IS, and both halves are asserted:
 *
 *   COVERED   the ground is a growing medium (meadow soil, the canyon's damp
 *             wash) and it must carry a real field, checked exactly as before.
 *   BARE      the ground is snow, sand or deck plate, and it must carry NO
 *             field at all — no instances, no cover tint, no sward — which is
 *             a new assertion this file did not previously make and could not,
 *             because nothing was ever supposed to be bare.
 *
 * Derived from LEVELS rather than written out, so a level that gains or loses
 * cover cannot quietly fall out of the survey.
 */
const COVERED = LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].grass > 0 && LEVELS[k].dress);
const BARE = LEVEL_ORDER.filter((k) => LEVELS[k] && !LEVELS[k].grass && LEVELS[k].dress
  && LEVELS[k].terrain !== 'hangar');
/**
 * What the stone-scatter surveys dress and measure.
 *
 * RE-DERIVED, and it is strictly more than it was. This read
 * `['dunes', 'arena', 'canyon', ...COVERED]` — three level keys written out by
 * hand because they were the three levels the scatter work was done against.
 * Two of those levels no longer exist (the dune sea and the wash were deleted
 * at the player's request), so the list had to change; what it changed INTO is
 * the general statement it was always a sample of: every level with open
 * ground to scatter over is held to the clustering bar, not just the three
 * somebody happened to measure. Six levels are surveyed here where four were
 * before, and two of the new ones (`drifts`, `alpine`) were never checked at
 * all despite strewing thousands of stones each.
 *
 * `...COVERED` stays in the union because the cover-avoidance test below has
 * nothing to compare on a level with no cover, and one covered level — the
 * flooded cut at the bottom of the descent — is indoors.
 */
const OUTDOOR = [...new Set([
  ...LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].dress && LEVELS[k].atmosphere.sky !== false),
  ...COVERED,
])];
const DEG = 180 / Math.PI;

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
    /* GROUND LITTER, and until the colosseum and the wood every instanced mesh
     * in the game was some grade of it — so this collected all of them, and
     * "is the litter clustered" was the same question as "is every instanced
     * mesh clustered". Neither of the two that are not is litter. A crowd is
     * 6,900 instances spanning 236 m and it is uniform BY DESIGN, because a
     * full house is: it dragged the arena's Clark-Evans to 0.87 whatever the
     * stone was doing. A forest is the same failure with a louder symptom —
     * its trunks and its crowns are two instanced meshes at the same 1,800
     * positions, so nine tenths of the "stones" measured 0.00 m from another
     * one, and the survey was reporting that a wood is a heap of gravel.
     *
     * The discriminator is the mesh's own NAME, which is the convention this
     * codebase already keeps for exactly this reason (`addInstanced`: "Name
     * it. Hunting one stray polygon through a frame cost a round of this
     * project"). It is a list kept by hand and it will be short of one again —
     * and that direction of error is the safe one, because an unnamed mesh is
     * measured rather than skipped. */
    if (o.name === 'crowd' || o.name.startsWith('forest.')) return;
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
    for (const key of COVERED) {
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

    /* THE SAMPLE FLOOR IS A PRECONDITION ON THE ESTIMATOR, NOT THE PROPERTY,
     * and it is 150 rather than 500 because a level is allowed to be thin.
     * The meadow strews 212 stones over a 130 m disc and its own dressing pass
     * says why — "and the loose stone the tors shed, thin: this is pasture,
     * not scree". Holding it to 500 would not be measuring its scatter, it
     * would be demanding it have more gravel, which is the exact complaint
     * this file exists to answer. So the floor drops to where Clark–Evans is
     * still a statistic, EVERY level is held to the shape, and the aggregate
     * below keeps the sample sizes honest. */
    let bulk = 0;
    for (const [key, d] of dressed()) {
      const ce = clarkEvans(d.pts, 130);
      assert(ce && ce.n > 150, `${key}: only ${ce ? ce.n : 0} stones to measure`);
      if (ce.n > 500) bulk++;
      assert(ce.R < 0.70,
        `${key}: Clark–Evans R = ${ce.R.toFixed(3)} against the control's ${ctrl.R.toFixed(3)} — `
        + 'that is a uniform sprinkle, not drifts');
      // and clustered is not the same as collapsed: a drift still has a spread
      assert(ce.p90 > 0.8,
        `${key}: nine tenths of the stones are within ${ce.p90.toFixed(2)} m of another — that is a heap, not ground`);
      rows.push(`${key} R=${ce.R.toFixed(2)} (n=${ce.n})`);
    }
    assert(bulk >= 3,
      `only ${bulk} levels carry enough stone for the estimator to be quiet — `
      + 'thinning every level is not a way past this check');
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
      // Same precondition, same reason as the clustering check above: a level
      // that strews thin on purpose is still held to the shape of its scatter.
      assert(n > 150, `${key}: only ${n} stones in a wide pass to measure`);
      assert(flat - got > 0.25 * room,
        `${key}: stones sit on ground that is ${(got * 100).toFixed(0)}% covered against the level's own `
        + `${(flat * 100).toFixed(0)}%, with ${(room * 100).toFixed(0)}% bare ground to have gone to — `
        + 'the drifts are ignoring the cover');
      rows.push(`${key} ${(got * 100).toFixed(0)}% vs ${(flat * 100).toFixed(0)}%`);
    }
    /* RE-DERIVED, and stated so it cannot be read as a relaxation. The bar was
     * "three levels compared" when three levels had cover; two do now, and the
     * property "stone shuns plants" is meaningless on a level with no plants.
     * What replaces the third comparison is STRICTLY MORE than it asked: every
     * bare level is checked to be actually bare — no field, no tint, no mat —
     * rather than being allowed to pass with a token 0.4 of a cover mask that
     * nothing grew out of. A level cannot satisfy both halves at once, and
     * every outdoor level is in exactly one of them. */
    assert(rows.length === COVERED.length && rows.length >= 2,
      `${rows.length} of ${COVERED.length} levels with cover were compared`);
    const bare = [];
    for (const key of BARE) {
      const t = new Terrain(new THREE.Scene(), LEVELS[key].terrain, 0.5);
      assert(!LEVELS[key].grass,
        `${key}: ground made of ${LEVELS[key].terrain} still authors grass ${LEVELS[key].grass}`);
      assert(!LEVELS[key].grassTint,
        `${key}: no grass, but it still authors a grass tint — one of the two is a lie`);
      const u = t._uniforms;
      assert(u.uCover.value.x === 0, `${key}: the bare ground is tinted ${u.uCover.value.x} covered`);
      assert(u.uSward.value.x === 0, `${key}: the bare ground is painted with sward`);
      bare.push(key);
      t.dispose();
    }
    assert(bare.length >= 4, `only ${bare.length} levels are bare ground`);
    return `mean cover under a stone vs over the level: ${rows.join(', ')}; `
      + `bare by design: ${bare.join(', ')}`;
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

  /* ══ the shape of a blade ════════════════════════════════════════════ */

  check('blades: a blade curves like a cantilever, not like a hoop', () => {
    /* THE FIRST HALF OF "IT LOOKS LIKE SHIT". What shipped sent the strip
     * along `ks = bend * h` — a constant turn per unit length, which is a
     * CIRCLE. Every blade in the field was equally curved at the sheath and at
     * the tip, which is the silhouette of bent wire and not of a plant; and the
     * CARD shader in the same file had `bv * (h * h)` all along, so the
     * billboards standing in for tufts curved correctly while the real blades
     * did not.
     *
     * Grass is a tapered cantilever: the bending moment falls off toward the
     * tip but the second moment of area falls off faster, so the curvature goes
     * UP with height and the blade stands out of the ground before arching
     * over. That is one exponent, and these are the numbers it has to hit. */
    const P = [];
    // 1. the turn rate must climb with height. A circular arc scores exactly 1.
    const rate = (bend, h) => bladeSpine(bend, h).rate;
    const climb = rate(1, 0.9) / rate(1, 0.15);
    assert(climb > 3.0,
      `the turn rate at 90% height is ${climb.toFixed(2)}× the rate at 15% — 1.00 is a circle`);
    // and it must be the same shape whatever the wind is doing
    for (const bend of [0.4, 1.0, 1.8, 2.4]) {
      const c = rate(bend, 0.9) / rate(bend, 0.15);
      assert(Math.abs(c - climb) < 1e-9, `the curve changes shape with the bend (${c.toFixed(2)} at ${bend})`);
    }
    // 2. most of the turning happens in the top half. A circle splits it 50/50.
    for (const bend of [0.6, 1.2, 2.0]) {
      const top = 1 - bladeSpine(bend, 0.5).theta / bladeSpine(bend, 1).theta;
      assert(top > 0.62,
        `only ${(top * 100).toFixed(0)}% of the turn is in the top half of the blade — 50% is a circle`);
      P.push(top);
    }
    // 3. the base stands up. At the bend the field actually spends its time at,
    //    the shipped arc was 8.6°/12.0° off vertical a sixth of the way up.
    for (const bend of [1.0, 1.4]) {
      const base = bladeSpine(bend, 0.15).theta * DEG;
      assert(base < 4.5, `a blade leaves the ground ${base.toFixed(1)}° off vertical at bend ${bend}`);
    }
    // 4. and it still arches: the tip has to leave vertical by a real angle
    assert(bladeSpine(1.0, 1).theta * DEG > 50,
      'the tip barely departs from vertical, which is the spike being complained about');
    // 5. bending may not stretch the blade — the spine is arc-length parametrised
    let worstLen = 0;
    for (const bend of [0, 0.8, 1.6, 2.4]) {
      let L = 0, px = 0, py = 0;
      for (let i = 1; i <= 3000; i++) {
        const s = bladeSpine(bend, i / 3000);
        L += Math.hypot(s.x - px, s.y - py); px = s.x; py = s.y;
      }
      worstLen = Math.max(worstLen, Math.abs(L - 1));
    }
    assert(worstLen < 0.005, `a blade at full bend is ${(worstLen * 100).toFixed(2)}% longer or shorter than itself`);

    /* 6. AND THE SHADER IS THE SAME CURVE. The polynomial in GRASS_VERT is
     *    generated from the exponent, so it can only be checked by reading it
     *    back out of the compiled material and evaluating it here. */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    const g = new GrassField(new THREE.Scene(), t, { count: 400, density: 1, radius: 46 });
    const vs = g.near.mat.vertexShader;
    const exp = /float ks = bend \* pow\(max\(h, 1e-4\), ([\d.]+)\)/.exec(vs);
    const cyL = /float cy = s \* \(([^)]*)\)/.exec(vs);
    const cxL = /float cx = s \* ks \* \(([^)]*)\)/.exec(vs);
    assert(exp && cyL && cxL, 'the blade sweep is no longer where this check can read it');
    const nums = (s) => s.split(/(?=[+-])/).map((x) => parseFloat(x.replace(/\s|\*|t\d/g, '')));
    const Y = nums(cyL[1]), X = nums(cxL[1]);
    assert(Y.length >= 4 && X.length >= 3 && Y.every(Number.isFinite) && X.every(Number.isFinite),
      'the generated polynomial did not parse');
    let worst = 0;
    for (const bend of [0.3, 0.9, 1.5, 2.1, 2.4]) {
      for (let k = 1; k <= 20; k++) {
        const h = k / 20;
        const ks = bend * Math.pow(h, parseFloat(exp[1])), t2 = ks * ks;
        const gy = h * Y.reduce((a, c, i) => a + c * Math.pow(t2, i), 0);
        const gx = h * ks * X.reduce((a, c, i) => a + c * Math.pow(t2, i), 0);
        const m = bladeSpine(bend, h);
        worst = Math.max(worst, Math.hypot(gx - m.x, gy - m.y));
      }
    }
    assert(worst < 1e-6,
      `the shader's spine and bladeSpine() disagree by ${worst.toExponential(2)} of a blade length`);
    // and the cap has to be a real arch rather than a lean
    const cap = /bend = min\(bend \+ press \* 1\.15, ([\d.]+)\)/.exec(vs);
    assert(cap && parseFloat(cap[1]) * DEG > 120,
      'a blade can no longer be turned past the horizontal, however hard the wind blows');
    g.dispose(); t.dispose();
    return `turn rate ×${climb.toFixed(2)} from 15% to 90% height (a circle is ×1.00), `
      + `${(P[1] * 100).toFixed(0)}% of the turn in the top half, base ${(bladeSpine(1.4, 0.15).theta * DEG).toFixed(1)}° off vertical, `
      + `shader agrees to ${worst.toExponential(1)}`;
  });

  check('blades: a blade is a leaf, not a needle', () => {
    /* `pow(1 - h, 0.55)`: 85% of base width a quarter of the way up, 47% at
     * three quarters, and then 2% — the whole taper collapsing inside the top
     * segment. That is a spike with a bevel on it. Real grass is very nearly
     * parallel-sided and does its tapering in the last quarter, and what that
     * buys is silhouette, which is the only thing a blade at four metres has.
     *
     * Measured on the strip's OWN ROWS, because a width profile the geometry
     * never samples is a curve nobody draws. */
    const rows = bladeRows();
    const w = rows.map(bladeWidth);
    assert(rows.length >= 5, `a blade is ${rows.length - 1} segments`);
    assert(Math.abs(rows[0]) < 1e-9 && Math.abs(rows[rows.length - 1] - 1) < 1e-9,
      'the strip does not span the whole blade');
    for (let i = 1; i < rows.length; i++) assert(rows[i] > rows[i - 1], 'the rows are not in order');
    // rows biased toward the tip, where all the curvature now is
    assert(rows[1] > 1.15 / (rows.length - 1),
      `the rows are evenly spaced (first at ${rows[1].toFixed(3)}), so the arch is drawn with a kink`);
    // the blade holds its width
    assert(bladeWidth(0.5) > 0.90, `half way up a blade is ${(bladeWidth(0.5) * 100).toFixed(0)}% of its base width`);
    assert(bladeWidth(0.75) > 0.68, `three quarters up a blade is ${(bladeWidth(0.75) * 100).toFixed(0)}% of its base width`);
    assert(bladeWidth(1) < 0.10, 'a blade ends in a stump rather than a point');
    // and it must be monotonic, or the blade has a waist
    for (let h = 0; h < 1; h += 0.01) {
      assert(bladeWidth(h + 0.01) <= bladeWidth(h) + 1e-9, `the blade gets wider at h=${h.toFixed(2)}`);
    }
    // the silhouette the strip actually draws, as a fraction of a rectangle
    let area = 0;
    for (let i = 1; i < rows.length; i++) area += (w[i] + w[i - 1]) * 0.5 * (rows[i] - rows[i - 1]);
    assert(area > 0.75,
      `a blade covers ${(area * 100).toFixed(0)}% of its own bounding rectangle — 63% was the needle`);
    // the shader must be drawing this curve and not another
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    const g = new GrassField(new THREE.Scene(), t, { count: 400, density: 1, radius: 46 });
    const m = /float wdt = uWidth \* len \* pow\(max\(1\.0 - h \* h \* h, ([\de.-]+)\), ([\d.]+)\)/.exec(g.near.mat.vertexShader);
    assert(m, 'the shader is no longer using the taper this check measures');
    for (const h of [0.2, 0.5, 0.8, 0.95]) {
      const shader = Math.pow(Math.max(1 - h * h * h, parseFloat(m[1])), parseFloat(m[2]));
      assert(Math.abs(shader - bladeWidth(h)) < 1e-9, 'bladeWidth() and the shader disagree');
    }
    g.dispose(); t.dispose();
    return `rows ${rows.map((v) => v.toFixed(2)).join('/')} at widths ${w.map((v) => v.toFixed(2)).join('/')}, `
      + `${(area * 100).toFixed(0)}% of its bounding rectangle`;
  });

  check('blades: a near blade turns its face to the eye instead of vanishing edge-on', () => {
    /* A blade's plane is perpendicular to the way it bends, and the way it
     * bends is the wind plus its own lean — nothing to do with where you are
     * standing. So for any given eye, the field contains blades at every
     * orientation and the ones presenting an edge are one pixel wide: the near
     * ring was paying for twice the cover it was showing. Averaged over
     * facings, an unbillboarded field shows 2/π = 64% of its own width and a
     * tenth of it shows less than 15%.
     *
     * The turn is scaled by how edge-on the blade already is, so a blade that
     * is presenting its face is not moved at all — which is what stops this
     * from flattening the field into one wall of identically-facing blades. */
    const N = 512, cam = [0, 1];
    let mn = 1, sum = 0, worstTurn = 0, bad = 0;
    const axes = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const bd = [Math.cos(a), Math.sin(a)];
      const side0 = [-bd[1], bd[0]];
      const side = bladeSideAxis(bd, cam);
      const vis = bladeVisibleWidth(side, cam);
      const raw = bladeVisibleWidth(side0, cam);
      if (raw < 0.15) bad++;
      mn = Math.min(mn, vis); sum += vis;
      worstTurn = Math.max(worstTurn, Math.acos(Math.min(1, Math.abs(side[0] * side0[0] + side[1] * side0[1]))));
      axes.push(Math.atan2(side[1], side[0]));
    }
    assert(bad > N * 0.06, 'the control is wrong: an unbillboarded field should have edge-on blades in it');
    assert(mn > 0.60,
      `the worst-placed blade still shows only ${(mn * 100).toFixed(0)}% of its width`);
    assert(sum / N > 0.78,
      `the field shows ${((sum / N) * 100).toFixed(0)}% of its width on average — 64% is doing nothing`);
    /* And it must NOT become a billboard. A blade already presenting its width
     * — one bending along the view axis — has to come back untouched, and the
     * field has to keep a real spread of orientations across the sweep. */
    const face = bladeSideAxis([0, 1], [0, 1]);
    assert(bladeVisibleWidth(face, [0, 1]) > 0.999
      && Math.abs(face[0] + 1) < 1e-6 && Math.abs(face[1]) < 1e-6,
      'a blade that was already showing its width is being turned anyway');
    let span = 0;
    for (const p of axes) for (const q of axes) {
      let d = Math.abs(p - q); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > Math.PI / 2) d = Math.PI - d;               // a width axis is a line, not an arrow
      span = Math.max(span, d);
    }
    assert(span > 1.0,
      `every blade in the field now lies within ${(span * DEG).toFixed(0)}° of the same axis — that is a wall`);
    assert(worstTurn * DEG < 60, `a blade is being spun ${(worstTurn * DEG).toFixed(0)}° out of its own plane`);
    return `worst-case visible width ${(mn * 100).toFixed(0)}% (was 0%), mean ${((sum / N) * 100).toFixed(0)}% (was 64%), `
      + `axes still spread over ${(span * DEG).toFixed(0)}°, worst turn ${(worstTurn * DEG).toFixed(0)}°`;
  });

  /* ══ the colour of a field ═══════════════════════════════════════════ */

  check('cover: a field is not one colour', () => {
    /* Every level authors two grass tints and lerps between them, and the three
     * outdoor levels author pairs 0.5°, 2.6° and 5.1° apart in hue — so the
     * pair was a lightness ramp with two names and the whole dune sea was straw
     * at 45°. Koboh, which is the reference this was measured against, is
     * explicitly withered straw AND greenery AND blue-green in one field.
     *
     * Hue is measured in sRGB, because that is where "yellow" and "blue-green"
     * mean anything; the tints themselves are linear, and are NOT converted
     * again on the way in — `new THREE.Color(hex)` has already done it. */
    const hsl = (c) => c.getHSL({}, THREE.SRGBColorSpace);
    const col = new THREE.Color();
    const rows = [];
    for (const key of COVERED) {
      const L = LEVELS[key];
      assert(Array.isArray(L.grassTint),
        `${key}: it grows a field at density ${L.grass} and authors no tint for it`);
      // the control: what the shipped two-stop ramp spanned on this level
      const A = new THREE.Color(L.grassTint[0]), B = new THREE.Color(L.grassTint[1]);
      let cLo = 999, cHi = -999;
      for (let i = 0; i <= 100; i++) {
        const h = hsl(col.copy(A).lerp(B, (i / 100) * 0.9)).h * 360;
        cLo = Math.min(cLo, h); cHi = Math.max(cHi, h);
      }
      assert(cHi - cLo < 12, `${key}: the control is wrong — the authored pair already spans ${(cHi - cLo).toFixed(0)}°`);

      const t = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      const g = new GrassField(new THREE.Scene(), t, {
        count: 9000, density: L.grass ?? 1, radius: 46,
        tintA: L.grassTint[0], tintB: L.grassTint[1],
      });
      g.update(1 / 60, new THREE.Vector3(0, 0, 0), [], null);
      const hueOf = (ring, i) => {
        col.setRGB(ring.aTint.array[i * 3], ring.aTint.array[i * 3 + 1], ring.aTint.array[i * 3 + 2]);
        return hsl(col).h * 360;
      };
      const all = [], near = [], light = [];
      for (const ring of g.rings) {
        for (let i = 0; i < ring.used; i++) {
          if (ring.aInst.array[i * 4 + 3] <= 0.004) continue;
          const h = hueOf(ring, i);
          all.push(h); light.push(hsl(col).l);
          if (ring === g.rings[0]) near.push(h);
        }
      }
      all.sort((a, b) => a - b); near.sort((a, b) => a - b); light.sort((a, b) => a - b);
      const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
      const span = q(all, 0.98) - q(all, 0.02);
      const nearSpan = q(near, 0.98) - q(near, 0.02);
      const frac = (lo, hi) => all.filter((h) => h >= lo && h < hi).length / all.length;
      const straw = frac(0, 58), green = frac(58, 112), blue = frac(112, 360);
      assert(span > 45,
        `${key}: the field spans ${span.toFixed(0)}° of hue against the authored pair's ${(cHi - cLo).toFixed(0)}°`);
      assert(nearSpan > 35,
        `${key}: the grass at the player's feet spans ${nearSpan.toFixed(0)}° — the variety is all at range`);
      for (const [name, f] of [['withered', straw], ['green', green], ['blue-green', blue]]) {
        assert(f > 0.04, `${key}: ${(f * 100).toFixed(1)}% of the field is ${name}`);
      }
      // the level still governs where the middle of its own field sits
      const mid = q(all, 0.5), authored = (cLo + cHi) / 2;
      assert(Math.abs(mid - authored) < 30,
        `${key}: the field's median hue is ${mid.toFixed(0)}° against the level's authored ${authored.toFixed(0)}°`);

      /* AND IT IS A SPREAD, NOT A LIFT. The cheapest way to make a field of
       * cover read better in a plate is to make it brighter, and it is not an
       * improvement, it is a thumb on the scale. Against the shipped two-stop
       * ramp put through the same per-blade value noise, the median blade may
       * not have got lighter — the withered end IS paler, which is what
       * withered means, and it has to be paid for at the other end. */
      const shipL = [];
      for (let i = 0; i <= 200; i++) {
        const tl = i / 200;
        col.copy(A).lerp(B, tl * 0.9);
        const v = 0.82 + ((tl * 7.13) % 1) * 0.36;
        col.setRGB(col.r * v, col.g * v, col.b * v);
        shipL.push(hsl(col).l);
      }
      shipL.sort((a, b) => a - b);
      const lifted = q(light, 0.5) / q(shipL, 0.5);
      assert(lifted < 1.02,
        `${key}: the median blade is ${lifted.toFixed(2)}× lighter than the ramp it replaces — `
        + 'the field is being brightened, not recoloured');
      rows.push(`${key} ${span.toFixed(0)}° (was ${(cHi - cLo).toFixed(0)}°) `
        + `${(straw * 100).toFixed(0)}/${(green * 100).toFixed(0)}/${(blue * 100).toFixed(0)}`
        + ` L×${lifted.toFixed(2)}`);
      g.dispose(); t.dispose();
    }
    return `hue span, then withered/green/blue-green %: ${rows.join('; ')}`;
  });

  check('cover: hue comes in drifts, and a tuft is one plant', () => {
    /* Two separate ways of getting this wrong, and the field had both. Drawn
     * per tuft out of a plain random, hue is salt-and-pepper — a mown lawn
     * seeded with confetti. Drawn per BLADE, so is the facing, and eight blades
     * out of one crown then point eight different ways, which is what made
     * every clump in the game go off like a firework. A tuft is ONE PLANT: its
     * blades share a colour and a direction and fan a little around both. */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const g = new GrassField(new THREE.Scene(), t, { count: 9000, density: 1, radius: 46 });
    g.update(1 / 60, new THREE.Vector3(0, 0, 0), [], null);
    const ring = g.rings[0], per = ring.per;
    assert(per >= 6, `a tuft is only ${per} blades, so this measures nothing`);

    const circStd = (angles) => {
      let sx = 0, sy = 0;
      for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
      return Math.sqrt(-2 * Math.log(Math.max(Math.hypot(sx, sy) / angles.length, 1e-9)));
    };
    const within = [], means = [], hueSpread = [];
    const hsl = (c) => c.getHSL({}, THREE.SRGBColorSpace);
    const col = new THREE.Color();
    for (let tf = 0; tf + per <= ring.used; tf += per) {
      const ang = [], hue = [];
      let ok = true;
      for (let b = 0; b < per; b++) {
        const i = tf + b;
        if (ring.aInst.array[i * 4 + 3] <= 0.004) { ok = false; break; }
        ang.push(Math.atan2(ring.aOrient.array[i * 4 + 1], ring.aOrient.array[i * 4]));
        col.setRGB(ring.aTint.array[i * 3], ring.aTint.array[i * 3 + 1], ring.aTint.array[i * 3 + 2]);
        hue.push(hsl(col).h * 360);
      }
      if (!ok) continue;
      within.push(circStd(ang));
      means.push(Math.atan2(ang.reduce((s, a) => s + Math.sin(a), 0), ang.reduce((s, a) => s + Math.cos(a), 0)));
      hueSpread.push(Math.max(...hue) - Math.min(...hue));
    }
    assert(within.length > 200, `only ${within.length} whole tufts to measure`);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const inTuft = mean(within), across = circStd(means);
    // uniform random over a circle measures ≈ 3.0; the shipped field measured
    // the same within a tuft as across the field, which is the whole bug
    assert(inTuft < 0.50,
      `the blades of one tuft point ${inTuft.toFixed(2)} rad apart — a tuft is not a plant, it is a firework`);
    assert(across > 1.5,
      `every tuft in the field faces the same way (${across.toFixed(2)} rad across tufts)`);
    assert(across / inTuft > 4,
      `a tuft is as spread out as the whole field (${(across / inTuft).toFixed(1)}×)`);
    // and a tuft is one colour, give or take
    assert(mean(hueSpread) < 25,
      `one tuft covers ${mean(hueSpread).toFixed(0)}° of hue — that is a bouquet, not a plant`);

    // hue drifts across the ground rather than sparkling: neighbouring tufts
    // agree far more than distant ones
    const F = g.species;
    let near = 0, far = 0;
    for (let k = 0; k < 4000; k++) {
      const x = (k * 37.13) % 300 - 150, z = (k * 91.7) % 300 - 150;
      near += Math.abs(F.at(x, z) - F.at(x + 1.2, z + 0.8));
      far += Math.abs(F.at(x, z) - F.at(x + 55, z - 41));
    }
    /* Against a control drawn here rather than a number remembered: an
     * uncorrelated field — which is what a per-tuft random IS — changes exactly
     * as much over a metre as over fifty, so it scores 1. */
    let cn = 0, cf = 0, seed = 4242;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let k = 0; k < 4000; k++) {
      const a = rnd(), b = rnd(), c = rnd();
      cn += Math.abs(a - b); cf += Math.abs(a - c);
    }
    const smooth = (near / far) / (cn / cf);
    assert(smooth < 0.55,
      `the species field changes ${smooth.toFixed(2)}× as fast over a metre as an uncorrelated one — that is confetti`);
    g.dispose(); t.dispose();
    return `within a tuft ${inTuft.toFixed(2)} rad, across the field ${across.toFixed(2)} rad (${(across / inTuft).toFixed(1)}×), `
      + `tuft hue spread ${mean(hueSpread).toFixed(0)}°, species field 1 m vs 50 m `
      + `${smooth.toFixed(2)}× an uncorrelated control`;
  });

  /* ══ the shade ═══════════════════════════════════════════════════════ */

  check('shade: a light that casts no shadow keeps its light on a shadowed blade', () => {
    /* THE REASON GRASS WENT BLACK IN SHADE AND THE SAND BESIDE IT DID NOT. The
     * rig is a sun with a cascade, two black carriers that exist only to own
     * the middle and far shadow maps, and a blue sky FILL that casts nothing.
     * `getShadowMask()` is the sun's cascade — Engine.js narrows it to light 0
     * for the terrain, with `#if UNROLLED_LOOP_INDEX == 0` — and the grass then
     * multiplied that same mask into every directional light it summed. So a
     * blade in shadow lost the fill as well as the sun, and the ground next to
     * it kept it.
     *
     * The rig is read out of Engine.js rather than restated here, so the check
     * measures the game's own lights and not a memory of them. */
    const src = readFileSync(new URL('../../src/engine/Engine.js', import.meta.url), 'utf8');
    const hemiM = /new THREE\.HemisphereLight\(\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*,\s*([\d.]+)\s*\)/i.exec(src);
    const sunM = /new THREE\.DirectionalLight\(i === 0 \? (0x[0-9a-f]+) : 0x000000, i === 0 \? ([\d.]+) : 0\)/i.exec(src);
    const fillM = /this\.fill = new THREE\.DirectionalLight\(\s*(0x[0-9a-f]+)\s*,\s*([\d.]+)\s*\)/i.exec(src);
    const fillP = /this\.fill\.position\.set\(([-\d., ]+)\)/.exec(src);
    assert(hemiM && sunM && fillM && fillP, 'the light rig moved; this check can no longer see it');
    assert(!/this\.fill\.castShadow\s*=\s*true/.test(src),
      'the fill casts a shadow now, so masking it would be correct and this check is stale');

    // the regex hands back '0xbcd8ff' as a STRING, and THREE.Color reads a string as
    // a CSS name; Number() first. Nothing is convertSRGBToLinear'd here — a Color
    // built from a hex is already linear and converting twice publishes a wrong figure.
    const lin = (hex) => { const c = new THREE.Color(Number(hex)); return [c.r, c.g, c.b]; };
    const hemi = { sky: lin(hemiM[1]).map((v) => v * +hemiM[3]), ground: lin(hemiM[2]).map((v) => v * +hemiM[3]) };
    const fillDir = fillP[1].split(',').map(Number);
    const fl = Math.hypot(...fillDir);
    const lights = [
      { color: lin(sunM[1]).map((v) => v * +sunM[2]), L: [0.573, 0.574, 0.585] },  // sun at 35°
      { color: [0, 0, 0], L: [0.573, 0.574, 0.585] },                              // carriers
      { color: [0, 0, 0], L: [0.573, 0.574, 0.585] },
      { color: lin(fillM[1]).map((v) => v * +fillM[2]), L: fillDir.map((v) => v / fl) },
    ];
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

    /* Averaged over blade facings, because a single normal is a single blade
     * and the complaint is about a field. The fragment flips the normal toward
     * the viewer, so the average has to be taken after that. */
    const sweep = (o) => {
      const acc = [0, 0, 0];
      const M = 256;
      for (let k = 0; k < M; k++) {
        const a = (k / M) * Math.PI * 2;
        const r = grassShade({
          N: [Math.cos(a), 0.30, Math.sin(a)], V: [0, 0.18, -1],
          hemi, lights, height: 0.7, ...o,
        });
        for (let i = 0; i < 3; i++) acc[i] += r.total[i] / M;
      }
      return acc;
    };
    const lit = sweep({ shadow: 1 });
    const shaded = sweep({ shadow: 0 });
    const shippedShaded = sweep({ shadow: 0, guard: false });
    const shippedLit = sweep({ shadow: 1, guard: false });

    /* 1. THE FILL SURVIVES A FULL SHADOW — and it now survives EXACTLY, which
     * is a tightening rather than a restatement.
     *
     * This used to be `kept > 0.95`, and 0.95 was not slack: under the
     * half-lambert response the fill's contribution genuinely depended on the
     * blade's orientation, so "the fill in shade" and "the fill in sun" were
     * two slightly different numbers and the bound had to allow for it. Under
     * the cel model a light that owns no shadow map is a FILL and lands flat
     * (saberCelShape, src/toon/Cel.js), so its contribution cannot depend on
     * anything the shadow does. The bound is 1.0 to a part in 10^9. */
    const kept = (lum(shaded) - lum(sweep({ shadow: 0, lights: [lights[0]] })))
               / (lum(lit) - lum(sweep({ shadow: 1, lights: [lights[0]] })));
    assert(Math.abs(kept - 1) < 1e-9,
      `a fully shadowed blade keeps ${(kept * 100).toFixed(3)}% of the light a shadowless fill gives it, not 100%`);

    /* 2. AND IT IS WORTH SOMETHING — re-derived on the term the bug deletes
     * rather than on a total the bug does not touch, and the re-derivation is
     * strictly stronger.
     *
     * The old form was `total(shaded) / total(shaded, guard off) > 1.20`: the
     * guard has to move a shadowed blade's TOTAL by a fifth. That ratio has an
     * ambient in its denominator which this bug has nothing to do with, and the
     * ambient moved when the sky term went flat (every surface now receives the
     * skylight a horizontal one receives — see saberCelFlatDir), so the same
     * intact guard now scores 1.175. Restating the bound at 1.15 would be
     * exactly the weakening the house rules forbid.
     *
     * So measure the thing itself. The bug multiplies the sun's cascade mask
     * into every directional light, so what it costs a fully shadowed blade is
     * ALL of its direct light — not a fifth of its total, all of it. That is an
     * exact statement with no threshold in it, and it fails the moment the
     * guard is removed rather than when a ratio drifts under a number. */
    // `translucency: 0` because the back-scatter term is a different mechanism
    // and a deliberate exception: light coming THROUGH a blade keeps 35% of
    // itself in full shadow on purpose (`back * (0.35 + 0.65 * sh)`), so it is
    // never zero and would mask the thing being measured.
    const direct = (o) => lum(grassShade({
      N: [0.62, 0.30, 0.72], V: [0, 0.18, -1], hemi, lights, height: 0.7, translucency: 0, ...o,
    }).direct);
    /* RE-DERIVED, AND ISOLATED, because the quantity it was standing on moved.
     *
     * This was `direct({ shadow: 0, guard: false }) === 0` — with the bug in,
     * a fully shadowed blade receives NO direct light at all. That worked only
     * because the sun's own contribution in shadow was also zero, and it is not
     * any more: the cel model now lands a shadowed surface on an authored band
     * of the key rather than on nothing (CEL.shadowBand), so light 0 is worth
     * something in shade whether the guard is there or not.
     *
     * The thing the bug actually destroys is THE FILL'S CONTRIBUTION, so that is
     * what is measured now — the difference between the whole rig and light 0
     * alone. It is still an identity with no threshold in it, and it is a
     * stricter statement than the old one: the old form could have passed with
     * the fill intact if the sun had happened to be zero. */
    const fillPart = (o) => direct(o) - direct({ ...o, lights: [lights[0]] });
    assert(direct({ shadow: 0 }) > 0,
      'a fully shadowed blade receives no direct light at all — the fill has been masked away');
    assert(fillPart({ shadow: 0 }) > 0,
      'a fully shadowed blade gets nothing from the shadowless fill');
    assert(fillPart({ shadow: 0, guard: false }) === 0,
      'the shipped bug no longer deletes the fill in shadow, so this check is measuring nothing');
    /* …AND WHAT THE GUARD IS WORTH ON THE TOTAL IS EXACTLY THE FILL — re-derived
     * from `gain > 1.10` to an identity, because the ratio's denominator moved
     * underneath it and a restated threshold would be the weakening the house
     * rules forbid.
     *
     * The denominator moved for a real reason: a shadowed blade is no longer
     * left with nothing from the sun. The cel model lands it on an authored
     * band of the key (CEL.shadowBand), which is 84% of a shaded blade's direct
     * light, so the same intact guard that scored 1.175× and then 1.10× now
     * scores 1.09× while doing precisely as much work as it ever did.
     *
     * So the claim is stated exactly instead of approximately: the guard's whole
     * effect on the total, in shade, IS the fill's whole contribution — no more
     * and no less — and without it the fill contributes exactly zero. Two
     * identities with no threshold between them, and they fail the instant the
     * guard is removed rather than when a ratio drifts under a number. */
    const gain = lum(shaded) / lum(shippedShaded);
    const fillTotal = lum(shaded) - lum(sweep({ shadow: 0, lights: [lights[0]] }));
    const fillTotal0 = lum(shippedShaded) - lum(sweep({ shadow: 0, guard: false, lights: [lights[0]] }));
    assert(fillTotal > 0, 'the fill contributes nothing to a shadowed blade even with the guard');
    assert(Math.abs(fillTotal0) < 1e-12,
      `the shipped bug leaves ${fillTotal0.toExponential(2)} of the fill on a shadowed blade, so it `
      + 'is no longer the bug this check is about');
    assert(Math.abs(lum(shaded) - lum(shippedShaded) - fillTotal) < 1e-12,
      'the guard is worth something other than exactly the fill — it is doing a second job');
    /* 3. SHADE IS SKY-COLOURED — an identity now, not a ratio.
     *
     * This was `blueShade > blueLit * 1.25`, a threshold chosen against the
     * half-lambert response. Under the cel model the statement it was
     * approximating can be made exactly, from both ends:
     *
     *   · a fully shadowed blade receives NO sun, so the difference between a
     *     lit blade and a shaded one is the sun's own colour times a scalar —
     *     asserted as an exact chromaticity match, not a bound;
     *   · and a shadowed blade's colour is therefore exactly the sky's.
     *
     * "Bluer in shade" is then a CONSEQUENCE of the rig rather than a number to
     * remember: it holds if and only if the sun is warmer than the sky, which
     * is a property of Engine's own light colours and is asserted on those. The
     * measured ratio is printed rather than tested, because a threshold on it
     * would be a weaker statement than the two identities above. */
    const unitv = (c) => { const l = lum(c); return c.map((v) => v / l); };
    const dLit = lit.map((v, i) => v - shaded[i]);
    const sunHue = unitv(lights[0].color), gotHue = unitv(dLit);
    for (let i = 0; i < 3; i++) {
      assert(Math.abs(gotHue[i] - sunHue[i]) < 1e-9,
        'what a shadow takes off a blade is not exactly the sun — some other light is being masked with it');
    }
    // and the sky the shadow is left with really is cooler than that sun
    const skyBlue = hemi.sky[2] / lum(hemi.sky), sunBlue = sunHue[2];
    assert(skyBlue > sunBlue * 1.10,
      `the rig's sky is only ${(skyBlue / sunBlue).toFixed(2)}× as blue as its sun, so no shadow can read cool`);
    const blueLit = lit[2] / lum(lit), blueShade = shaded[2] / lum(shaded);
    assert(blueShade > blueLit,
      `shaded grass is ${(blueShade / blueLit).toFixed(3)}× as blue as sunlit grass`);
    // 4. and the guard may not touch a lit blade — it is a shadow fix, nothing else
    assert(Math.abs(lum(lit) / lum(shippedLit) - 1) < 1e-9,
      'the guard changed what a blade in full sun receives');
    // 5. the shader has to be doing what this model says
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.5);
    const g = new GrassField(new THREE.Scene(), t, { count: 200, density: 1, radius: 30 });
    const fs = g.near.mat.fragmentShader;
    const loop = fs.slice(fs.indexOf('for(int i = 0; i < NUM_DIR_LIGHTS'), fs.indexOf('#pragma unroll_loop_end', fs.indexOf('NUM_DIR_LIGHTS')));
    assert(/#if UNROLLED_LOOP_INDEX == 0/.test(loop),
      'the grass applies the sun\'s shadow to every directional light again');
    assert(!/wrap \* shadow/.test(loop),
      'the raw shadow mask is still being multiplied into a light inside the loop');
    g.dispose(); t.dispose();

    return `shaded blade ${lum(shippedShaded).toFixed(3)} → ${lum(shaded).toFixed(3)} irradiance `
      + `(${gain.toFixed(2)}×), keeps ${(kept * 100).toFixed(0)}% of the fill in full shadow, `
      + `shade ${(blueShade / blueLit).toFixed(2)}× as blue as sun`;
  });

  /* ══ the scatter, again ══════════════════════════════════════════════ */

  check('cover: a tier holds what its cell says, not what the walk there said', () => {
    /* A tier only refills when its snapped cell changes, and it was then culling
     * tufts against the annulus measured from WHEREVER THE CAMERA WAS at that
     * instant. The swath tier's cells are 17 m: walking east across a line
     * refills it from 15 m one side of the cell's middle and walking back west
     * refills the same cell from the other, so its contents depended on the
     * path taken to it. Measured on the shipped build, arriving at the origin
     * from the east and from the north gave the swath ring 2242 instances one
     * way and 2246 the other, with 96% of its buffer different — and the far
     * ring 99%. Everything else about this field is a pure function of the cell
     * coordinate; this was the one thing that was not. */
    const t = new Terrain(new THREE.Scene(), 'canyon', 0.6);
    const at = (x, z) => new THREE.Vector3(x, t.height(x, z), z);
    const walk = (path) => {
      const g = new GrassField(new THREE.Scene(), t, { count: 8000, density: 1, radius: 46 });
      for (const [x, z] of path) g.update(1 / 60, at(x, z), [], null);
      const out = g.rings.map((r) => ({
        name: r.tier.name, used: r.used,
        inst: Float32Array.from(r.aInst.array), orient: Float32Array.from(r.aOrient.array),
        tint: Float32Array.from(r.aTint.array),
      }));
      g.dispose();
      return out;
    };
    const east = walk([[80, 0], [60, 0], [40, 0], [20, 0], [9, 0], [0, 0]]);
    const north = walk([[0, 80], [0, 60], [0, 40], [0, 20], [0, 9], [0, 0]]);
    const still = walk([[0, 0]]);
    const rows = [];
    for (let k = 0; k < east.length; k++) {
      assert(east[k].used > 100, `${east[k].name}: only ${east[k].used} instances to compare`);
      for (const [name, other] of [['from the north', north[k]], ['standing still', still[k]]]) {
        assert(east[k].used === other.used,
          `${east[k].name}: ${east[k].used} instances arriving from the east, ${other.used} ${name}`);
        let diff = 0;
        for (let i = 0; i < east[k].inst.length; i++) {
          if (east[k].inst[i] !== other.inst[i] || east[k].orient[i] !== other.orient[i]) diff++;
        }
        for (let i = 0; i < east[k].tint.length; i++) if (east[k].tint[i] !== other.tint[i]) diff++;
        assert(diff === 0,
          `${east[k].name}: ${diff} of ${east[k].inst.length} floats differ ${name} — `
          + 'the field depends on how you walked to it');
      }
      rows.push(`${east[k].name} ${east[k].used}`);
    }
    t.dispose();
    return `identical from east, from north and standing still: ${rows.join(', ')}`;
  });
}
