/**
 * SABER — what the `cloth` quality column actually switches off.
 *
 * The note over `QUALITY.cloth` in src/engine/Engine.js used to read: "Measured
 * headless on this machine, 20 clothed duellists walking: 6.28 ms of garment
 * solve and 1.26 ms of collider refresh per frame — 7.5 ms of a 16.67 ms budget
 * … Per character that is 287 particles, 1466 links and 20 040 sphere tests
 * every frame, four garments deep." tools/checks/frame-budget.mjs repeats the
 * 7.5 ms and uses it to justify the tier.
 *
 * 287 particles and 1466 links four garments deep is the PLAYER's row, exactly.
 * `attachSkirt` is reached only when `built.robeSkirt` is truthy, and
 * `robeSkirt` is returned by exactly one builder — `buildJedi`, which is what
 * the Player is built from and no enemy is. Counted on a live World at `ultra`,
 * where the cut gates nothing off:
 *
 *   PLAYER      4 garments, 287 particles, 1466 links, 51 colliders
 *   acolyte     1 garment,   63 particles,  300 links, 21 colliders
 *   sparring, bodyguard   the same single cloak
 *   the other eleven archetypes   nothing at all
 *
 * So "20 clothed duellists, four garments deep" is a population the game cannot
 * field: 5740 particles and 29 320 links against the 1260 and 6000 that twenty
 * acolytes really are — 4.9x. The column's tuning decision, and every future
 * decision made from the same figure, was made against five times the real load.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS A COUNT AND NOT A CLOCK. The defect is
 * one machine's millisecond figure frozen into a comment; replacing it with a
 * different machine's millisecond figure repeats it. Two runs of this project's
 * own harness on two differently loaded boxes gave 1.9 ms and 3.3 ms for the
 * same fight — both far under 7.5, neither worth writing down. The POPULATION
 * is machine-independent, so that is what is pinned: who wears what, how much
 * cloth each garment is, and the ratio between an enemy's set and the player's.
 * The timing is held to a band wide enough to survive a contended box and
 * narrow enough to catch a 4x claim.
 *
 * The second check is the one the old note got wrong in the other direction:
 * `low` does not hand back the player's garments, because `Player.update` calls
 * `skirt.update` and `cloak.update` with no `clothOn` test at all. What the
 * column switches off is the enemy share, and that is what it should be
 * described as.
 */

import { snapshotShared, restoreShared } from './_shared.mjs';

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
 * Every cloth body hanging off a character, however it is reached.
 *
 * Deliberately a graph walk rather than a list of property names: the player's
 * sash straps live at `cloak.outer.sash.parts[0..1]` — the cape's `outer` is
 * the skirt, the skirt's `sash` is a wrapper, and the wrapper's `parts` are the
 * two straps — and a census that only looked at `cloak` and `skirt` missed 48
 * particles and 200 links of the very figure it was checking. A body is a body
 * if it has `pos` and `links`, which is what Cloth's own solver reads.
 */
function garments(owner) {
  const found = [];
  const walk = (c, name) => {
    if (!c || typeof c !== 'object' || found.some(([, x]) => x === c)) return;
    if (c.pos && c.links) found.push([name, c]);
    for (const k of ['sash', 'outer', 'inner']) if (c[k] && c[k] !== c) walk(c[k], `${name}.${k}`);
    for (const arr of ['parts', 'panels']) {
      if (Array.isArray(c[arr])) c[arr].forEach((x, i) => walk(x, `${name}.${arr}[${i}]`));
    }
  };
  walk(owner.cloak, 'cloak');
  walk(owner.skirt, 'skirt');
  let particles = 0, links = 0, colliders = 0;
  for (const [, c] of found) {
    particles += c.pos.length / 3;
    links += c.links.length;
    colliders += c.colliders ? c.colliders.length : 0;
  }
  return { n: found.length, particles, links, colliders, where: found.map(([k]) => k) };
}


export async function run({ check, assert, THREE }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();

  const shared = await snapshotShared();
  const built = (async () => {
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { ARCHETYPES, enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(20250814);
    // `ultra` puts the cut at 46 m, so nothing in this census is gated off by
    // distance and every archetype is asked what it is WEARING, not what it is
    // currently solving.
    const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality: 'ultra' });
    await world.loadLevel('temple');
    world.spawnPlayer?.();
    const types = Object.keys(ARCHETYPES);
    const p = world.player.position;
    for (let t = 0; t < types.length; t++) {
      const a = (t / types.length) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 8, z = p.z + Math.sin(a) * 8;
      world.spawnEnemy(types[t], new THREE.Vector3(x, world.terrain.height(x, z), z));
    }
    const input = idleInput();
    for (let f = 0; f < 4; f++) world.update(1 / 60, input);
    return { world, types };
  })();

  check('cloth: the population the tier is sized for is the one the game can field', async () => {
    try {
      const { world, types } = await built;
      const player = garments(world.player);
      assert(player.n >= 4,
        `the player is wearing ${player.n} cloth bodies (${player.where.join(', ')}) — the census is `
        + 'missing garments, so every ratio below it is wrong');
      assert(player.particles === 287 && player.links === 1466,
        `the player's garment set is now ${player.particles} particles / ${player.links} links, not `
        + '287 / 1466. Engine.js\'s note over QUALITY.cloth quotes those two numbers as the thing it '
        + 'is NOT sized for; update the note and this line together, or the comment goes stale the '
        + 'way the one it replaced did');

      const worn = [];
      for (const e of world.enemies) {
        const g = garments(e);
        if (g.n) worn.push([e.type, g]);
      }
      assert(worn.length >= 1 && worn.length <= 4,
        `${worn.length} of ${types.length} archetypes wear cloth — the note over QUALITY.cloth says `
        + 'three (acolyte, sparring, bodyguard) and the whole sizing argument rests on it');
      for (const [type, g] of worn) {
        assert(g.n === 1,
          `${type} now wears ${g.n} garments (${g.where.join(', ')}). Engine.js sizes the cloth column `
          + 'on every enemy wearing exactly one cape; a second garment on an archetype doubles the '
          + 'column\'s real cost and nothing else would notice');
      }
      const one = worn[0][1];
      const ratio = player.links / one.links;
      assert(ratio > 3.5,
        `an enemy's garment set is now ${(1 / ratio * 100).toFixed(0)}% of the player's — the note over `
        + 'QUALITY.cloth is built on the two being 4.9x apart');
      return `${worn.length}/${types.length} archetypes wear anything, one cape each `
        + `(${one.particles} particles / ${one.links} links / ${one.colliders} colliders); the player `
        + `wears ${player.n} (${player.particles} / ${player.links} / ${player.colliders}), `
        + `${ratio.toFixed(2)}x — so 20 duellists are ${20 * one.links} links, not ${20 * player.links}`;
    } finally { restoreShared(shared); }
  });

  check('cloth: 20 enemies of garments cost about two milliseconds, not seven and a half', async () => {
    /**
     * The band is wide on purpose. This box has three other agents on it and
     * the same fight measured 1.9 ms on a quiet one and 3.3 ms on a loaded one;
     * what must never come back is the claim that this is half a frame, so the
     * ceiling is set where a 7.5 ms figure would fail and ordinary contention
     * would not.
     */
    try {
      const { World } = await import('../../src/game/World.js');
      const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
      const { enemyRng } = await import('../../src/game/Enemy.js');
      enemyRng.seed(4711);
      const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality: 'high' });
      await world.loadLevel('temple');
      world.spawnPlayer?.();
      const p = world.player.position;
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2, r = 7 + (i % 5);
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        world.spawnEnemy('acolyte', new THREE.Vector3(x, world.terrain.height(x, z), z));
      }
      const input = idleInput();
      for (let f = 0; f < 90; f++) world.update(1 / 60, input);

      // Wrap the SHIPPED solver on the SHIPPED instances, so what is timed is
      // what the frame actually runs.
      const bodies = [];
      for (const e of world.enemies) {
        const g = garments(e);
        if (g.n) bodies.push(...g.where.map((_, i) => null), e);
      }
      let solve = 0, refresh = 0;
      const patched = [];
      for (const e of world.enemies) {
        for (const key of ['cloak', 'skirt']) {
          const c = e[key];
          if (!c || !c.update) continue;
          const u = c.update.bind(c), rc = c.refreshColliders ? c.refreshColliders.bind(c) : null;
          c.update = (...a) => { const t = performance.now(); const r = u(...a); solve += performance.now() - t; return r; };
          if (rc) c.refreshColliders = (...a) => { const t = performance.now(); const r = rc(...a); refresh += performance.now() - t; return r; };
          patched.push(c);
        }
      }
      assert(patched.length >= 10, `only ${patched.length} enemy garments were found to time`);

      const FRAMES = 400;
      solve = 0; refresh = 0;
      for (let f = 0; f < FRAMES; f++) world.update(1 / 60, input);
      const solveMs = solve / FRAMES, refreshMs = refresh / FRAMES;
      const total = solveMs + refreshMs;
      const on = world.enemies.filter((e) => !e.dead && e.clothOn).length;
      assert(on >= 10, `only ${on} enemies were inside the cloth cut — nothing was measured`);
      assert(total < 6.0,
        `${on} enemies' garments cost ${total.toFixed(2)} ms a frame. Engine.js was sized on 7.5 ms for `
        + 'this population; if that is true again the tier decision needs re-deriving, and if it is '
        + 'not, this check has stopped measuring the right thing');
      assert(total > 0.05, `the garment solve measured ${total.toFixed(3)} ms — nothing is being timed`);
      return `${on} enemy capes: solve ${solveMs.toFixed(2)} ms + collider refresh ${refreshMs.toFixed(2)} ms `
        + `= ${total.toFixed(2)} ms a frame over ${FRAMES} frames, against the 7.5 ms the column was sized on`;
    } finally { restoreShared(shared); }
  });

  check('cloth: the player\'s own garments are not what the bottom tier hands back', async () => {
    /* Engine.js used to call `low` "the largest single thing it can hand back",
     * which is two claims: that it is the largest, and that it hands back the
     * whole 7.5 ms. The second is false for a reason that is in the source and
     * not in any measurement — Player.update has no clothOn test at all, so the
     * player's four garments solve at every tier including `low`. */
    const { readFile } = await import('node:fs/promises');
    const player = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const enemy = await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8');
    assert(/this\.cloak\.update\(/.test(player), 'Player no longer solves its own cape');
    const gated = /clothOn/.test(player);
    assert(!gated,
      'Player now gates its own garments on clothOn — which may well be right, but Engine.js\'s note '
      + 'says in so many words that it does not, and the two must agree');
    assert(/if \(!this\.clothOn\)/.test(enemy),
      'Enemy no longer reads clothOn to gate its garments — the cloth column is decorative again');
    return 'the enemy garments are gated and the player\'s are not, which is what the note says';
  });

}
