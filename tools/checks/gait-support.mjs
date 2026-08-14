/**
 * SABER — what an enemy pays to know what is under its feet.
 *
 * `supportHeight` (src/physics/Support.js) is the one answer to "what is under
 * you", asked by the player, by every enemy, and by the gait solver on behalf
 * of each foot. It has no spatial index and no reject of its own: it walks
 * every static box in the level, and `boxTopAt` does TWO quaternion rotations
 * before it looks at the distance, so a box 400 m away costs exactly what one
 * underfoot does. Its own doc comment says "pass a pre-filtered short list if
 * you have one" — and `Player._gatherNear` always did. The enemies never did.
 *
 * WHAT THAT COST, measured headless on the temple with 18 acolytes and the
 * player, quality `high`:
 *
 *   51,061 static-box tests per frame — 212 sweeps of the level's 241-box
 *   array, about 11.7 per character, because the gait asks about the ground
 *   eleven times per character per frame (Rig.js `_normalAt` alone is four,
 *   plus the plant, the slope probe and the swing aim).
 *
 * Timed the one way that changes no RESULT — padding the array with clones of
 * the level's own records displaced 400 m, so only the LENGTH of the loop
 * moves, four interleaved rounds of 120 frames:
 *
 *   boxes    241     353     477     595     900
 *   before  6.614   7.032   8.572   8.927  11.639 ms   (7.63 us per extra box)
 *   after   4.667   4.619   4.692   4.677   4.848 ms   (0.27 us per extra box)
 *
 * Linear before, flat after. The slope is what makes this worth a check rather
 * than a one-off tune: the array GROWS as the level is fought in, because
 * cutting masonry converts a monolithic structure into per-chunk static
 * colliders — four minutes of an ordinary temple fight takes 241 boxes to 377
 * with the player never deliberately cutting anything. A cost linear in that
 * number is a frame that gets worse the longer the session runs, which is the
 * player's own first bug report, quoted at src/engine/Profiler.js:7-9.
 *
 * THE THREE PROPERTIES BELOW, AND WHY THEY ARE THESE THREE.
 *
 * A faster wrong answer is a regression, and a short list is exactly the shape
 * of optimisation that gets it wrong quietly — one foot's normal sampled off a
 * box the gather did not reach, on one level, and a leg draws through the
 * masonry. So the first property drives the SHIPPED `_groundAt` against the
 * SHIPPED `supportHeight` over the SHIPPED full array, at every real query a
 * real fight makes, and demands they agree bit for bit — `Object.is`, not a
 * tolerance, because the two are supposed to be the same arithmetic on the
 * same numbers.
 *
 * The second is the work, not the wall clock: a millisecond threshold on a
 * contended box is noise, and the defect was never "slow" in the abstract, it
 * was "linear in a growing number". So it pads the array and asserts the count
 * of `boxTopAt` calls does not move.
 *
 * The third exercises the fallback the first two never reach. `_groundAt`
 * answers off the short list only inside the disc the list was gathered for
 * and takes the whole array outside it; across 655,564 real queries on all
 * thirteen levels that outside branch fired ZERO times, because the farthest
 * the gait ever asks from its own body is 2.102 m against a 2.6 m reach. Zero
 * coverage is how a safety net rots, so it is driven directly.
 *
 * ALL THREE READ ONE MEASUREMENT RUN, taken sequentially below, because the
 * first of them monkey-patches `Enemy.prototype._groundAt` to double every
 * query and the runner starts every `check` in this file before any of them
 * awaits. Run as three independent check bodies they contaminate each other:
 * the first inflated the second's box-test count by 16x, which is exactly the
 * kind of number a check must never be allowed to invent.
 */

import { snapshotShared, restoreShared } from './_shared.mjs';

const LEVELS_FOR_EQUIV = ['temple', 'warship', 'mustafar', 'meadow'];

/** Every `engine.*` member a World reaches, and nothing else. */
function stubEngine(THREE) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  return {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {}, render() {},
  };
}

const idleInput = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

/**
 * A world with two bodies of every archetype standing around the player.
 *
 * Every archetype, because the reach the short list is gathered with is scaled
 * by the body's own radius and a bodyguard's planted foot reaches farther from
 * its hips than an acolyte's does — a check that only ever spawns acolytes
 * cannot see that.
 */
async function fight(THREE, level, quality = 'high') {
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const { ARCHETYPES, enemyRng } = await import('../../src/game/Enemy.js');
  enemyRng.seed(20250814);
  const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality });
  await world.loadLevel(level);
  world.spawnPlayer?.();
  const types = Object.keys(ARCHETYPES);
  const p = world.player.position;
  for (let t = 0; t < types.length; t++) {
    for (let k = 0; k < 2; k++) {
      const a = ((t * 2 + k) / (types.length * 2)) * Math.PI * 2;
      const r = 7 + ((t * 3 + k * 5) % 15);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      world.spawnEnemy(types[t], new THREE.Vector3(x, world.terrain.height(x, z), z));
    }
  }
  return world;
}

/* ── the one measurement run all three properties read ───────────────── */

async function measureAll(THREE) {
  // Every World this file drives advances the module-scope wind clock that a
  // later suite measures against. See tools/checks/_shared.mjs.
  const shared = await snapshotShared();
  try {
    return await measureInner(THREE);
  } finally { restoreShared(shared); }
}

async function measureInner(THREE) {
  const { Enemy } = await import('../../src/game/Enemy.js');
  const { supportHeight, STEP_UP } = await import('../../src/physics/Support.js');
  if (typeof Enemy.prototype._groundAt !== 'function') {
    throw new Error('Enemy no longer routes its ground queries through _groundAt — the short list '
      + 'and the guard that makes it safe are gone, and nothing here can see whether the answers moved');
  }

  /* ── 1. equivalence, over every real query a real fight makes ──────── */
  const eq = { samples: 0, bad: 0, worst: 0, fallbacks: 0, firstBad: '', perLevel: [] };
  const orig = Enemy.prototype._groundAt;
  /**
   * The reference is not a reimplementation: it is `supportHeight` itself,
   * handed `physics.staticBoxes` itself, which is verbatim the expression
   * Enemy._pose and Enemy._move used before the short list existed. So the two
   * sides of this comparison are the shipped optimised path and the shipped
   * unoptimised one, on the same live data, at the same instant.
   */
  Enemy.prototype._groundAt = function (ctx, x, z) {
    const got = orig.call(this, ctx, x, z);
    const want = supportHeight(ctx.terrain, ctx.physics?.staticBoxes, null,
      x, z, this.position.y, this.radius, STEP_UP);
    eq.samples++;
    if (!Object.is(got, want)) {
      eq.bad++;
      const d = Math.abs(got - want);
      if (d > eq.worst) eq.worst = d;
      if (!eq.firstBad) {
        eq.firstBad = `${this.type} at ${x.toFixed(2)},${z.toFixed(2)}: short list said ${got}, `
          + `the level says ${want}`;
      }
    }
    return got;
  };
  try {
    for (const level of LEVELS_FOR_EQUIV) {
      const world = await fight(THREE, level);
      const input = idleInput();
      const before = eq.samples;
      for (let f = 0; f < 300; f++) world.update(1 / 60, input);
      eq.fallbacks += world.enemies.reduce((s, e) => s + (e._nearMisses || 0), 0);
      eq.perLevel.push(`${level} ${world.physics.staticBoxes.length} boxes/${eq.samples - before} queries`);
      world.dispose?.();
    }
  } finally {
    Enemy.prototype._groundAt = orig;
  }

  /* ── 2. the work, and whether it is linear in the array ────────────── */
  /**
   * WHY THE ARRAY IS PADDED WITH CLONES RATHER THAN A LEVEL BEING CHOSEN.
   *
   * The defect is a slope, not a level: the frame cost was linear in
   * `staticBoxes.length`, and that array grows all session as destruction
   * converts cut masonry into per-chunk colliders. Padding with clones of the
   * level's own records displaced 400 m changes the LENGTH of every loop and
   * nothing else — the clones are unreachable, so no query's ANSWER can move,
   * which is what makes this a measurement of the loop rather than of the level.
   *
   * The counter is a getter on `halfExtents`, which `boxTopAt` reads exactly
   * once per call and the gather never reads at all. It counts the expensive
   * half of the work directly, so it is a number rather than a wall clock on a
   * box with three other agents on it.
   */
  const world = await fight(THREE, 'temple');
  const input = idleInput();
  for (let f = 0; f < 60; f++) world.update(1 / 60, input);
  const boxes = world.physics.staticBoxes;
  const base = boxes.slice();
  let deep = 0;
  const instrument = () => {
    for (const b of boxes) {
      if (Object.getOwnPropertyDescriptor(b, 'halfExtents')?.get) continue;
      let h = b.halfExtents;
      Object.defineProperty(b, 'halfExtents', {
        configurable: true, get() { deep++; return h; }, set(v) { h = v; },
      });
    }
  };
  const clone = (b, k) => {
    const c = { ...b };
    c.center = b.center.clone();
    c.center.x += 400 + (k % 7) * 13;
    c.center.z += 400 + ((k * 3) % 11) * 9;
    c.halfExtents = b.halfExtents.clone();
    c.quat = b.quat.clone(); c.invQuat = b.invQuat.clone();
    c.collider = null;
    return c;
  };
  const sweepAt = (pad) => {
    boxes.length = 0;
    for (const b of base) boxes.push(b);
    for (let k = 0; k < pad; k++) boxes.push(clone(base[k % base.length], k));
    for (let f = 0; f < 12; f++) world.update(1 / 60, input);
    const per = [];
    for (let f = 0; f < 40; f++) {
      instrument();
      deep = 0;
      world.update(1 / 60, input);
      per.push(deep);
    }
    per.sort((a, b) => a - b);
    return per[per.length >> 1];
  };
  const work = { boxes: base.length, at241: sweepAt(0), at900: sweepAt(659) };
  work.alive = world.enemies.filter((e) => !e.dead).length;
  boxes.length = 0;
  for (const b of base) boxes.push(b);

  /* ── 3. the fallback, which nothing else in the game ever reaches ──── */
  const e = world.enemies.find((x) => !x.dead && x.animator);
  if (!e) throw new Error('no living animated enemy to ask');
  const ctx = { terrain: world.terrain, physics: world.physics };
  e._nearMisses = 0;
  const far = { checked: 0, agreed: 0, misses: 0 };
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    for (const r of [8, 21, 47]) {
      const x = e.position.x + Math.cos(a) * r, z = e.position.z + Math.sin(a) * r;
      const got = e._groundAt(ctx, x, z);
      const want = supportHeight(world.terrain, world.physics.staticBoxes, null,
        x, z, e.position.y, e.radius, STEP_UP);
      far.checked++;
      if (Object.is(got, want)) far.agreed++;
    }
  }
  far.misses = e._nearMisses;
  return { eq, work, far };
}


export async function run({ check, assert, THREE }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();
  const measured = measureAll(THREE);

  check('gait: an enemy asks a short list what is under its foot and gets the whole level\'s answer', async () => {
    const { eq } = await measured;
    assert(eq.samples > 150000, `only ${eq.samples} ground queries were driven — that is not a fight`);
    assert(eq.bad === 0,
      `${eq.bad} of ${eq.samples} ground queries disagreed with the full static-box array (worst `
      + `|delta| ${eq.worst}) — the gather radius no longer covers everywhere the gait asks about, `
      + `so a foot is being planted on ground that is not there. First: ${eq.firstBad}`);
    return `${eq.samples} real gait queries over ${eq.perLevel.join(', ')} — 0 disagreements, `
      + `${eq.fallbacks} fell back to the full array`;
  });

  check('gait: the cost of standing up does not grow as the level is cut apart', async () => {
    const { work } = await measured;
    // Before the short list, every one of these was a full sweep: the same
    // temple ran ~11.7 sweeps of the whole array per character per frame, and
    // rose in proportion with the array.
    const perBody = work.at241 / Math.max(1, work.alive);
    assert(perBody < work.boxes,
      `${work.at241} box tests a frame across ${work.alive} bodies is ${perBody.toFixed(0)} per body `
      + `against a ${work.boxes}-box level — that is a full sweep of the level per body per frame, `
      + 'so the short list is not being used');
    assert(work.at900 < work.at241 * 1.35,
      `padding the static-box array from ${work.boxes} to ${work.boxes + 659} with unreachable clones took `
      + `the per-frame box tests from ${work.at241} to ${work.at900} — the ground query is linear in `
      + 'the size of the array again, so the frame gets worse for the rest of the session every '
      + 'time the player cuts a piece of masonry');
    return `${work.alive} bodies, ${work.at241} box tests a frame at ${work.boxes} boxes and `
      + `${work.at900} at ${work.boxes + 659} — flat, where it used to be 7.6 us per box per frame`;
  });

  check('gait: a query the short list cannot vouch for still reads the whole level', async () => {
    const { far } = await measured;
    assert(far.misses === far.checked,
      `${far.checked} queries were made from 8 to 47 m away and only ${far.misses} of them fell back `
      + 'to the full array — the guard is not firing, so the short list is answering for ground it '
      + 'never looked at');
    assert(far.agreed === far.checked,
      `${far.checked - far.agreed} of ${far.checked} distant queries disagreed with the full array `
      + 'even though they took the fallback path');
    return `${far.checked} queries from 8-47 m out, all ${far.misses} routed to the full array, all agreed`;
  });

}
