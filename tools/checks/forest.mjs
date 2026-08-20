/**
 * FELLING, MEASURED.
 *
 * "Fellable trees with chain reactions, Valheim-style: cut a trunk, the tree
 *  falls in the direction the cut implies, and a falling tree knocks over what
 *  it lands on."
 *
 * Three claims and a budget, and none of them is a thing you can eyeball:
 *
 *  THE DIRECTION. "The direction the cut implies" is the only part of this
 *  with a right answer, and it is the part a screenshot cannot show. A blade
 *  contact carries the velocity it was swept at; the tree has to go that way,
 *  from every bearing, not just from the one the feature was developed facing.
 *  This drives twelve cuts round the compass and measures the error.
 *
 *  THE CHAIN. A falling tree that knocks over the tree it lands on, which
 *  knocks over the tree IT lands on. The test is not that two trees fell — it
 *  is that the third one fell, because two is a special case somebody could
 *  have written and three is a system.
 *
 *  THE TIMING. The fall is the falling-chimney result, θ̈ = (3g/2L)·sin θ, and
 *  it is used rather than a tween because of what it does to the SHAPE of the
 *  motion: a long pause while the tree decides and then it goes over fast. If
 *  that ever became a linear tween every one of these tests would still pass
 *  except this one.
 *
 *  AND THE BUDGET. `addScree` is the convention in this codebase — hundreds of
 *  objects for one instanced call — and a felling system that spent a draw call
 *  per trunk could not be used on a forest at all. The count has to be flat in
 *  the number of trees AND flat in the number that have been cut down.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS } from '../../src/game/Levels.js';
import { Forest, attachForest, STANDING, FALLING, DOWN } from '../../src/world/Trees.js';
import { propMaterials } from '../../src/world/Props.js';
import { TAU } from '../../src/engine/MathUtil.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A world stub with the four things a Forest touches. */
/* `level` is attached because dressing passes read it — see the note on the
 * same field in sliceable.mjs, where leaving it off cost the deeps every loose
 * prop on its floor. */
function stubWorld(terrain = null, level = null) {
  const scene = new THREE.Scene();
  return {
    scene, level, statics: [], props: [], enemies: [], levelLights: [], doors: [],
    /* `add`/`remove`/`bodies` are not decoration: `Forest._syncLogs` opens
     * with `if (!this.world.physics?.add) return`, so a stub without them
     * silently turns off the whole log-realisation path and every claim about
     * a felled trunk being an OBJECT measures nothing. That is the shape
     * HANDOFF §2.3 warns about — a fixture that cannot express the thing it
     * is standing in for. */
    physics: {
      staticBoxes: [], bodies: [],
      /* THE SAME RECORD SHAPE THE REAL ENGINE RETURNS — `center`,
       * `halfExtents`, `quat`, `radius`, `userData` — because `Forest._realise`
       * reads `box.center.clone()` off it to remember where to lay the log's
       * collider back down. A stub that returns a differently-named bag
       * throws there, three call layers away from anything this file names. */
      addStaticBox(center, halfExtents, quat, o = {}) {
        const b = {
          center: center.clone(), halfExtents: halfExtents.clone(),
          quat: (quat || new THREE.Quaternion()).clone(),
          radius: halfExtents.length(), disabled: false, userData: o.userData || null,
          p: center, e: halfExtents, q: quat, o,
        };
        this.staticBoxes.push(b); return b;
      },
      removeStaticBox(b) { const i = this.staticBoxes.indexOf(b); if (i >= 0) this.staticBoxes.splice(i, 1); },
      add(b) { this.bodies.push(b); return b; },
      remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); },
      addJoint() {}, removeJoint() {}, raycast: () => null,
    },
    particles: { sparkBurst() {}, sandPuff() {}, slag() {} },
    addProp(p) { this.props.push(p); return p; },
    notify() {}, report() {}, spawnEnemy: () => null,
    addHitstop() {}, terrain, player: { position: V(0, 0, 0) },
    settings: { quality: 'medium' },
  };
}

/** A flat stand of trees on level ground, laid out by the caller. */
function stand(list, opts = {}) {
  const world = stubWorld();
  const M = propMaterials();
  const f = attachForest(world, { seed: 7, ...opts });
  f.plant(list.map((t) => ({ y: 0, yaw: 0, tone: 1, radius: 0.4, ...t })), {
    materials: { bark: M.wood, leaf: M.patina, core: M.duracreteDark },
  });
  return { world, f };
}

/** Step the forest forward at a fixed rate. */
function sim(f, seconds, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) f.update(dt);
}

/** Where a tree's tip ended up, relative to its own base, in plan. */
function fallBearing(f, i) {
  const tip = f.tip(i, new THREE.Vector3());
  const k = i * 15;
  return Math.atan2(tip.x - f.data[k + 0], tip.z - f.data[k + 1]);
}

function angDiff(a, b) {
  return Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI);
}


export async function run({ check, assert }) {
  /* Every check in this file is wrapped: the two shared streams are put on
   * their modules' own seeds before each body and the wind clock is put back
   * after it. See tools/checks/_shared.mjs — the rule is there, not here.
   */
  check = await clocked(check);
  check('felling: a tree falls the way the cut was swung, from every bearing', () => {
    /* Twelve cuts round the compass. Each one is a fresh single tree and a
     * blade contact whose IMPULSE points along the bearing — which is what
     * `World._applyBladeEvent` hands the prop it cut: the velocity the blade
     * was travelling at the moment it parted the wood. */
    let worst = 0, worstAt = 0;
    const rows = [];
    for (let b = 0; b < 12; b++) {
      const a = (b / 12) * TAU;
      const { f } = stand([{ x: 0, z: 0, height: 18, radius: 0.45 }]);
      const dir = V(Math.sin(a), 0, Math.cos(a));
      // a contact 0.8 m up the trunk, swung along `dir` at 22 m/s
      f.cut(V(0, 0.8, 0), V(0, 0, 1), dir.clone().multiplyScalar(22));
      assert(f.data[6] === FALLING, `a cut at bearing ${(a * 180 / Math.PI) | 0}° did not fell the tree`);
      sim(f, 6);
      assert(f.data[6] === DOWN, `the tree at bearing ${(a * 180 / Math.PI) | 0}° never came to rest`);
      const err = angDiff(fallBearing(f, 0), a);
      if (err > worst) { worst = err; worstAt = a; }
      rows.push((err * 180 / Math.PI).toFixed(1));
    }
    /* 2°, and it should be 0 — the only thing between the cut direction and
     * the fall direction is the normalisation of a unit vector. A tolerance
     * exists so the test is measuring a PROPERTY rather than an implementation:
     * an ordinary fix for something else (a lean term, a slope term) may move
     * this by a degree and should not be a failure. */
    assert(worst < 2 * Math.PI / 180,
      `a cut at ${(worstAt * 180 / Math.PI).toFixed(0)}° felled the tree ${(worst * 180 / Math.PI).toFixed(1)}° off the swing`);

    /* AND A THRUST HAS NO DIRECTION TO GIVE. A cut with no lateral travel is
     * an undercut with no back cut, and a real tree then goes the way it
     * leans. This is the one case where the tree chooses. */
    const { f } = stand([{ x: 0, z: 0, height: 18, radius: 0.45, lean: 0.06, yaw: 1.2 }]);
    f.cut(V(0, 0.8, 0), V(0, 0, 1), V(0, -14, 0));
    assert(f.data[6] === FALLING, 'a thrust into a trunk did not fell it');
    sim(f, 6);
    const leaned = angDiff(fallBearing(f, 0), 1.2);
    assert(leaned < 0.05, `a thrust felled the tree ${(leaned * 180 / Math.PI).toFixed(0)}° off its own lean`);
    return `12 bearings, worst error ${(worst * 180 / Math.PI).toFixed(2)}° (${rows.join('/')}°); ` +
      'a thrust goes with the lean';
  });

  check('felling: the fall is a hinge and not a tween — it pauses, then it goes', () => {
    /* θ̈ = (3g/2L)·sin θ for a rod hinged at one end. Two consequences the
     * shape of the motion lives on, and a linear tween has neither:
     *
     *   the first 30° takes MOST of the fall. Measured on a 20 m trunk: 4.35 s
     *     to the ground, of which 2.70 s — 62% — is spent in the first 30°.
     *   a tall tree falls SLOWER than a short one, because the acceleration
     *     goes as 1/L. A 27 m trunk takes 1.4× as long as a 7.5 m one.
     */
    const t = (h) => {
      const { f } = stand([{ x: 0, z: 0, height: h, radius: 0.4 }]);
      f.fell(0, 1, 0, 0.6);
      let firstThird = 0, total = 0;
      const dt = 1 / 120;
      for (let i = 0; i < 3000 && f.data[6] === FALLING; i++) {
        f.update(dt);
        total += dt;
        if (f.data[7] < Math.PI / 6) firstThird += dt;
      }
      return { total, firstThird };
    };
    const a = t(20), b = t(7.5), c = t(27);
    assert(a.total > 3 && a.total < 7,
      `a 20 m tree takes ${a.total.toFixed(2)} s to come down — that is not a tree`);
    assert(a.firstThird / a.total > 0.5,
      `only ${(a.firstThird / a.total * 100).toFixed(0)}% of the fall is spent in the first 30° — ` +
      'that is a tween, and a felling has to hesitate');
    assert(c.total > b.total * 1.25,
      `a 27 m tree takes ${c.total.toFixed(2)} s and a 7.5 m one ${b.total.toFixed(2)} — ` +
      'the fall does not know how tall the tree is');
    return `7.5 m: ${b.total.toFixed(2)} s, 20 m: ${a.total.toFixed(2)} s ` +
      `(${(a.firstThird / a.total * 100).toFixed(0)}% of it in the first 30°), 27 m: ${c.total.toFixed(2)} s`;
  });

  check('felling: it chains — and the third tree is what says so', () => {
    /* A line of five trees 9 m apart. The first is cut toward the second; each
     * one that comes down has to reach the next. The trunks are 18 m and the
     * spacing 9, so nothing here depends on a lucky overlap: the question is
     * only whether the sweep sees them and whether a tree felled BY a tree
     * fells the next one in turn. */
    const list = [];
    for (let i = 0; i < 5; i++) list.push({ x: 0, z: i * 9, height: 18, radius: 0.45 });
    const { f } = stand(list);
    f.cut(V(0, 0.8, 0), V(1, 0, 0), V(0, 0, 22));
    sim(f, 14);
    let down = 0;
    for (let i = 0; i < 5; i++) if (f.data[i * 15 + 6] === DOWN) down++;
    assert(down >= 3, `one cut in a line of five took down ${down} — two is a special case, three is a chain`);
    assert(f.stats.chained >= down - 1,
      `${down} trees came down but only ${f.stats.chained} of them were felled BY another`);
    assert(f.stats.longestChain >= 2,
      `the deepest link in the chain is ${f.stats.longestChain} — nothing was felled by something that was itself felled`);

    /* AND IT DOES NOT CHAIN THROUGH THIN AIR. The same line, felled the other
     * way, has to take down nothing at all: a system that knocks over
     * everything nearby is not a chain reaction, it is an explosion. */
    const { f: g } = stand(list);
    g.cut(V(0, 0.8, 0), V(1, 0, 0), V(0, 0, -22));
    sim(g, 14);
    let awayDown = 0;
    for (let i = 1; i < 5; i++) if (g.data[i * 15 + 6] !== STANDING) awayDown++;
    assert(awayDown === 0, `felling away from the line still took ${awayDown} of its trees down`);
    return `one cut felled ${down} of 5 at 9 m spacing, deepest link ${f.stats.longestChain}; ` +
      'the same cut the other way felled 0';
  });

  check('felling: a whole forest costs three draw calls, standing or flat', () => {
    /* THE BUDGET, and it is the reason the felling is not built on
     * `Destruction`. A forest is 520 trunks; `world-immersion` caps a level at
     * 520 draw calls. One call per trunk is the whole budget for the trees
     * alone, so the count has to be flat in the number of trees and flat in
     * how many of them have been cut down. */
    const mk = (n) => {
      const list = [];
      for (let i = 0; i < n; i++) list.push({ x: (i % 20) * 14 - 140, z: ((i / 20) | 0) * 14 - 140, height: 16, radius: 0.4 });
      return stand(list);
    };
    const count = (world) => {
      let m = 0;
      world.scene.traverse((o) => { if (o.isMesh && o.geometry) m++; });
      return m;
    };
    const small = mk(12), big = mk(600);
    assert(count(small.world) === count(big.world),
      `12 trees cost ${count(small.world)} draw calls and 600 cost ${count(big.world)}`);
    assert(count(big.world) <= 3,
      `a forest costs ${count(big.world)} draw calls; trunks, crowns and stumps should be one each`);

    // …and felling every one of them adds nothing
    const before = count(big.world);
    for (let i = 0; i < 600; i++) big.f.fell(i, 1, 0, 0.5);
    sim(big.f, 10);
    let flat = 0;
    for (let i = 0; i < 600; i++) if (big.f.data[i * 15 + 6] === DOWN) flat++;
    assert(flat === 600, `only ${flat} of 600 felled trees came to rest`);
    assert(count(big.world) === before,
      `felling the forest took it from ${before} draw calls to ${count(big.world)}`);
    // the stumps ride in the same mesh, as a draw RANGE
    assert(big.f.stumpMesh.count === 600,
      `600 trees were cut and ${big.f.stumpMesh.count} stumps were drawn`);
    // and each log left a collider, so a felled tree is something you meet
    assert(big.world.physics.staticBoxes.length === 600,
      `${big.world.physics.staticBoxes.length} of 600 logs are things you can walk into`);
    return `600 trees in ${before} draw calls; 600 felled, 600 stumps, 600 log colliders, still ${before}`;
  });

  check('felling: a trunk coming down hurts whatever is under it', () => {
    const { world, f } = stand([{ x: 0, z: 0, height: 20, radius: 0.5 }]);
    let hit = 0;
    // one body under where the trunk is going, one behind it
    world.enemies.push(
      { position: V(0, 0, 12), dead: false, damage(d) { hit += d; } },
      { position: V(0, 0, -12), dead: false, damage() { hit -= 1000; } },
    );
    f.fell(0, 0, 1, 0.5);
    sim(f, 8);
    assert(hit > 20, `a 20 m trunk landed on a body and did ${hit} damage`);
    assert(f.stats.crushed === 1, `${f.stats.crushed} bodies were crushed; exactly one was under it`);
    return `${hit} damage to the body under it, none to the one behind`;
  });

  check('wood: it is a wood — you cannot see through it', () => {
    /* THE ONE PROPERTY A FOREST HAS. Sight lines, measured on the real level:
     * from 300 sample points on the walkable ground, in a random direction,
     * how far is it to the first trunk?
     *
     * The comparison is the arena, where the same instrument reports the width
     * of the bowl. A wood whose median sight line is 100 m is a park. */
    const L = LEVELS.wood;
    const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
    const world = stubWorld(terrain, L);
    L.dress(world);
    const f = world.forest;
    assert(f && f.count > 300, `the wood planted ${f ? f.count : 0} trees`);

    const D = f.data, N = 15;
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const hits = [];
    /* SAMPLED INSIDE THE WOOD, r ≤ 70, and the trees run to 155. A ray fired
     * from the edge of the stand outward leaves it, and what that measures is
     * the size of the forest rather than its density: at a 110 m sample disc a
     * fifth of the rays escaped entirely and the survey reported a p95 of 200,
     * which is the instrument's own cap. */
    for (let s = 0; s < 300; s++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * 70;
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      const b = rnd() * TAU, dx = Math.sin(b), dz = Math.cos(b);
      let best = 200;
      for (let i = 0; i < f.count; i++) {
        const k = i * N;
        const px = D[k] - ox, pz = D[k + 1] - oz;
        const t = px * dx + pz * dz;
        if (t <= 0.5 || t >= best) continue;
        const perp = Math.abs(px * dz - pz * dx);
        if (perp <= D[k + 4] + 0.3) best = t;
      }
      hits.push(best);
    }
    hits.sort((a, b) => a - b);
    const p50 = hits[150], p90 = hits[270];
    /* 16 m median, measured. The arena's own floor, put through the same
     * instrument, reports the width of the bowl. A wood whose median sight
     * line is 30 m is a park with trees in it, and the number that produces
     * this one is derived in the level: mean free path through vertical rods
     * of radius r at n per square metre is 1/(2·r·n). */
    assert(p50 < 24, `the median sight line in the wood is ${p50.toFixed(0)} m — that is a park`);
    /* …and a tenth of it is glade. There have to be clearings — a stand with
     * no openings in it is a wall and there is nowhere to fight — but a glade
     * you can see ninety metres across is a field with a hedge round it. */
    assert(p90 > 30 && p90 < 80,
      `the wood's ninetieth-percentile sight line is ${p90.toFixed(0)} m — ` +
      `${p90 <= 30 ? 'there are no clearings in it at all' : 'its clearings are fields'}`);

    /* AND IT IS NOT A GRID. `drift` places the trees through a cover field so
     * the wood has stands and glades; Clark–Evans — mean nearest-neighbour
     * distance over what a Poisson process of the same intensity would give —
     * is 1.0 for uniform random and below 0.75 for genuinely clustered. */
    let sum = 0;
    for (let i = 0; i < f.count; i++) {
      let nn = Infinity;
      for (let j = 0; j < f.count; j++) {
        if (i === j) continue;
        const dx = D[j * N] - D[i * N], dz = D[j * N + 1] - D[i * N + 1];
        const d = dx * dx + dz * dz;
        if (d < nn) nn = d;
      }
      sum += Math.sqrt(nn);
    }
    const mean = sum / f.count;
    const area = Math.PI * 188 * 188;
    const poisson = 0.5 / Math.sqrt(f.count / area);
    const R = mean / poisson;
    assert(R < 0.9, `the wood's Clark-Evans ratio is ${R.toFixed(2)} — that is a uniform scatter of trees`);
    return `${f.count} trees, sight line p50 ${p50.toFixed(0)} m / p90 ${p90.toFixed(0)} m, ` +
      `Clark-Evans ${R.toFixed(2)} (mean neighbour ${mean.toFixed(1)} m)`;
  });

  check('forest: a thrown blade fells the trees it flies through, not the ones by your feet', async () => {
    /**
     * `Forest.update` pinned its cut proxy to `world.player.position`, and
     * `capsules()` culls every trunk outside `reach` of that point — so a disc
     * thrown 26 m out was offered no tree at all to cut. Measured on the wood,
     * aimed at a standing trunk 12.2 m away:
     *
     *     before   disc passed 1.40 m from its axis, crossed 17 standing
     *              trunks, felled 4 — every one beside the player, none of
     *              them the target
     *     after    felled 19
     *
     * Cleaving Throw's card says it "cuts clean through everything it passes".
     *
     * A FIRST FIX THAT MEASURED NOTHING is worth recording here, because it
     * looked obviously right: carrying the COLLIDER ring with the disc as well.
     * Felled went 4 → 4. Colliders are what a body walks into; cutting goes
     * through `capsules()`, and moving ~65 static boxes around a blade in
     * flight bought exactly nothing. It was reverted.
     */
    const THREE = await import('three');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');

    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
    const engine = { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
      sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
      renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
      profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
      applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
      setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
      setQuality() {}, setResolutionScale() {}, render() {} };
    const idle = { act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };

    const w = new World(engine, { ...DEFAULT_SETTINGS, quality: 'high' });
    await w.loadLevel('wood');
    w.spawnPlayer();
    const p = w.player;
    for (let i = 0; i < 60; i++) w.update(1 / 60, idle);

    const forest = w.forest;
    assert(forest?.data, 'the wood has no forest, so this measures nothing');
    const FN = 15, FX = 0, FZ = 1, FR = 4, FSTATE = 6;
    const D = forest.data, N = forest.count;
    const at = (i, f) => D[i * FN + f];
    const standing = () => { let n = 0; for (let i = 0; i < N; i++) if (at(i, FSTATE) === 0) n++; return n; };

    // A real standing trunk, well outside anything the body could reach.
    let target = null;
    for (let i = 0; i < N; i++) {
      if (at(i, FSTATE) !== 0) continue;
      const dx = at(i, FX) - p.position.x, dz = at(i, FZ) - p.position.z;
      const r = Math.hypot(dx, dz);
      if (r > 12 && r < 22 && (!target || r < target.r)) target = { i, r, dx, dz };
    }
    assert(target, 'no standing trunk 12-22 m from the spawn — the scene is wrong, not the fix');

    const before = standing();
    p.camera.pitch = 0;
    p.aimDir.set(target.dx, 0, target.dz).normalize();
    p.force = p.maxForce;
    p.cooldowns.throw = 0;
    p.saber.lit = true;
    p.throwOrRecall({ terrain: w.terrain, particles: w.particles, enemies: w.enemies });

    let closest = Infinity, crossed = 0;
    const seen = new Set();
    for (let f = 0; f < 260; f++) {
      w.update(1 / 60, idle);
      if (!p.throwState || p.throwState === 'held') break;
      closest = Math.min(closest,
        Math.hypot(at(target.i, FX) - p.throwPos.x, at(target.i, FZ) - p.throwPos.z));
      for (let i = 0; i < N; i++) {
        if (seen.has(i)) continue;
        if (Math.hypot(at(i, FX) - p.throwPos.x, at(i, FZ) - p.throwPos.z) < at(i, FR) + 0.4) {
          seen.add(i); crossed++;
        }
      }
    }
    const felled = before - standing();
    w.unload();

    assert(crossed >= 5,
      `the flight path only crossed ${crossed} trunks — the throw is not going through the wood`);
    // Half of what it passes through, not all: the disc is a moving point
    // sampled at 60 Hz and the wood is dense, so demanding every trunk would
    // be a check on the sampling rate rather than on the focus.
    assert(felled >= crossed * 0.5,
      `the disc passed through ${crossed} standing trunks and felled ${felled} — the cut proxy is `
      + `pinned to the body, ${closest.toFixed(2)} m being the closest it ever came to the trunk it `
      + 'was aimed at');
    return `aimed at a trunk ${target.r.toFixed(1)} m out: passed ${closest.toFixed(2)} m from its `
      + `axis, crossed ${crossed} standing trunks, felled ${felled}`;
  });

  check('felling: the player is under it too, and the logs stay objects', () => {
    /* TWO CLAUSES OF NOTE #24 IN ONE FIXTURE, because they are one complaint:
     * "tree don't have physics anymore when they fall like you can't keep
     * cutting them up or anything. Also they should damage things/players/
     * enemies if they fall on you."
     *
     * The crush walked `world.enemies` and nothing else, so the one hazard on
     * the level was free to the person who made it. And `LIFT_CAP` was 4 while
     * one cut in a dense stand fells a median of three trees and a max of
     * nine — so past the fourth, a felled trunk stayed a picture with a static
     * box under it and could not be cut again. */
    const list = [];
    for (let i = 0; i < 9; i++) list.push({ x: -8 + i * 2.2, z: 0, height: 16, radius: 0.42 });
    const { world, f } = stand(list, { crush: 46 });
    /* THE PLAYER STANDS UNDER TREE 0's FALL LINE. `players` is the array World
     * keeps and every other system reads; the crush is the one that did not. */
    const me = { position: V(-8, 0, 6), hp: 100, alive: true, hits: 0,
      damage(d) { this.hp -= d; this.hits++; }, applyKnockback() { this.shoved = true; } };
    world.players = [me];
    f.fell(0, 0, 1, 1);                      // straight along +z, onto the player
    sim(f, 8);
    assert(me.hits > 0, 'a sixteen-metre trunk came down through the player and did not touch them');
    assert(me.hp < 100, `the player is on ${me.hp} hp after being flattened`);
    assert(me.shoved, 'it hurt but it did not move them — a tree flattens');

    /* …AND EVERY LOG WITHIN REACH IS A REAL OBJECT. Fell the whole stand, put
     * the player in the middle of it, and count what became a Prop. */
    for (let i = 1; i < 9; i++) f.fell(i, 1, 0, 1);
    sim(f, 12);
    me.position.set(0, 0, 0);
    f.update(1 / 60);
    const down = [];
    for (let i = 0; i < f.count; i++) if (f.data[i * 15 + 6] === DOWN) down.push(i);
    assert(down.length >= 8, `only ${down.length} of 9 trees came down at all`);
    const near = down.filter((i) => Math.hypot(f.data[i * 15], f.data[i * 15 + 1]) < 9);
    const realNear = near.filter((i) => f.real.has(i)).length;
    assert(realNear === near.length,
      `${realNear} of ${near.length} logs within nine metres of the player are objects — the rest are `
      + 'pictures with a static box under them, and cutting one does nothing');
    for (const i of near) {
      const rec = f.real.get(i);
      assert(rec?.prop && !rec.prop.dead, `log ${i} realised without a live Prop`);
      assert(rec.prop.body && rec.prop.body.mass > 0, `log ${i} is an object with no mass`);
    }
    return `player took ${(100 - me.hp).toFixed(0)} hp and was shoved; `
      + `${realNear}/${near.length} nearby logs are cuttable objects`;
  });

}
