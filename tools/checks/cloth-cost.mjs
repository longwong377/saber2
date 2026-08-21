/**
 * BATTLEFRONT BORZ — what the `cloth` quality column actually switches off.
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


/**
 * WHERE THE CENSUS IS TAKEN, AND WHY IT IS NAMED ONCE.
 *
 * This suite used to stand its subjects on `'temple'`. That level was deleted
 * when the roster was culled to seven, and `loadLevel` on a key that is not in
 * `LEVELS` does not throw — the suite simply stopped completing, and two
 * separate callers spent real time reading it as a hang and blaming CPU load.
 * A wrong answer would have been better than no answer, so this file now says
 * which field it wants ONCE and asserts that the field exists before it builds
 * anything.
 *
 * The arena is the right field on its own merits, not just because it survives:
 * it is the flattest fighting floor in the game (`terrain.mjs` measures 1.77 m
 * of relief over the central 120 m), so a ring of enemies spawned at 8 m all
 * stand at the same height and none of them is part-way up a slope while it is
 * being asked what it is wearing.
 */
const FIELD = 'colosseum';

export async function run({ check, assert, THREE }) {
  /* Fail LOUDLY and immediately if the field is gone, rather than the silent
   * non-completion that the deleted temple produced. */
  check('cloth-cost: the field this census stands on still exists', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    assert(LEVELS[FIELD],
      `cloth-cost stands its subjects on '${FIELD}' and no such level exists. `
      + 'Every measurement below builds a World on it; a missing key does not throw, '
      + 'it just never finishes. Point FIELD at a level in LEVEL_ORDER.');
    return `${FIELD}`;
  });

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
    await world.loadLevel(FIELD);
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
    } finally {
      restoreShared(shared);
      /* AND THE CENSUS WORLD COMES DOWN. It is this check's alone, and it used
       * to stay alive for the whole of the rest of the run — a 31-body `ultra`
       * World, terrain heightfield, Rapier world, instanced fields and texture
       * set, 276 MB measured, held behind a promise nothing ever released. Not
       * a leak in the game and not why this suite was slow (see the note over
       * `timed`), but it is the peak this file contributes to every suite that
       * runs after it, and it costs one line to give back. */
      try { const { world } = await built; world.unload(); world.dispose?.(); } catch { /* the census already failed */ }
    }
  });

  /**
   * ONE WORLD, TWO QUESTIONS — and the second one is why this suite could not
   * finish for an entire session.
   *
   * The 400-frame fight below is the most expensive thing this file does, so it
   * is also the best place in the project to ask a question that only shows up
   * under a real fight: does any effect ask a particle pool for more than the
   * pool can hold? It is audited here rather than in a world of its own because
   * a second 20-body World would double the suite's cost to re-ask a question
   * this one is already in a position to answer.
   *
   * WHAT THE AUDIT FOUND, and it is the whole reason this suite was unrunnable.
   * `Enemy._sustain` (Enemy.js, the held-power tick) calls
   *
   *     sparkBurst(chest, 2, 0x9fd8ff)
   *
   * against a signature of `sparkBurst(pos, normal, count, opts)`. Three
   * arguments into four slots: `2` lands in `normal`, and the COLOUR lands in
   * `count`. The burst therefore asks for 10 467 583 sparks — 17.8 million
   * spawns after the recipe's own multiplier — each paying a THREE.Color
   * sRGB→linear conversion, on 35% of frames, per casting enemy.
   *
   * Measured here, 20 acolytes on the colosseum: frames 1-20 cost 10-15 ms;
   * from frame 30, once the first enemy holds lightning or choke, they cost
   * 71-134 SECONDS each. A CPU profile puts 96% of a 439-second run on
   * `_sustain → sparkBurst → spawn → SRGBToLinear`. Six previous attempts at
   * this suite across two callers each burned 40+ minutes at 85% CPU and were
   * killed without ever finishing; HANDOFF §2.6 recorded the roster's growth
   * from 20 to 31 archetypes as the suspect. **That hypothesis is refuted by
   * measurement**: the whole 31-archetype census world above builds, spawns and
   * steps in 5.2 seconds. The cost was never the roster.
   *
   * IT IS A GAME DEFECT AND NOT A HARNESS ONE — a held enemy power is a
   * multi-second freeze on a player's machine, and `normal = 2` makes every
   * spark in the burst spread along a NaN direction as well. `Particles.js`
   * now bounds a burst by its own pool's capacity, because a ring buffer cannot
   * show more than it holds and the surplus was provably invisible work. That
   * bound stops the gate being hostage to one call site; it does NOT correct
   * the call site, which is why this check exists and stays red until it is
   * fixed. Bounding the damage must never be able to silence the defect.
   */
  const timed = (async () => {
    /**
     * AFTER THE CENSUS, NOT BESIDE IT — and this is a measurement, not tidying.
     *
     * Both fixtures are module-scope IIFEs, so they used to build their Worlds
     * CONCURRENTLY: `built` spawns one of every archetype into an `ultra`
     * colosseum while this one loads its own colosseum and stands a player on
     * it. Measured, with the two overlapping:
     *
     *     player [0.3, 724.3, -2.9]      camera follows it to 722 m
     *     the twenty acolytes            still on the floor at y = -0.4
     *     nearest body to the camera     722.4 m against a 30 m cloth cut
     *
     * — so every garment was gated off by distance and this suite timed an
     * empty loop, which is the SECOND time that has happened here and the
     * reason the camera line below exists at all.
     *
     * IT IS A KNIFE-EDGE AND THE COUNT OF ARCHETYPES IS THE KNIFE. It appeared
     * the day the roster went from 36 entries to 37, and it is not that
     * archetype's doing: censusing `gunship` ALONE leaves the player on the
     * floor and censusing `conscript` alone, or `atte` alone, puts it at 720 m.
     *
     * ── AND THE MECHANISM IS NAMED NOW. It was never one World reaching into
     * another World's player, which is what the two paragraphs that used to
     * stand here supposed and could not demonstrate. It is TWO ordinary things
     * and neither of them needs a second World at all.
     *
     * WHAT LIFTS THE BODY is a stack of shoves. Twenty acolytes spawned on one
     * frame are twenty identical bodies running one brain in lockstep: they all
     * reach `pressed` together, and nineteen `push` casts land inside frame
     * 166. The ring is symmetric so the horizontal halves cancel exactly and
     * the `PUSH_LIFT` halves ADD — 19 x 10 m/s of pure lift, out at 190 m/s,
     * apex 718 m. `applyKnockback` did `velocity.add(impulse)` with no bound.
     * It is a game defect and it is fixed in `Player.applyKnockback`, where the
     * whole argument is written down: no combination of shoves may leave a body
     * moving faster than the hardest single one of them.
     *
     * WHAT MAKES IT A KNIFE-EDGE is the SHARED RANDOM STREAM, not the shared
     * level. `rng` in Enemy.js IS `enemyRng` (Enemy.js:59-60) — one stream for
     * every body in the process. This fixture seeds it and then spawns, so it
     * is only seeded if nothing else draws in between; run beside the census,
     * the census's own spawns land an unknown number of draws in that gap, and
     * the number of draws is the number of archetypes. Measured at `d736f60`,
     * the commit before the launch became unconditional, by drawing N times
     * from `enemyRng` between the seed and these twenty bodies:
     *
     *     N = 0    player -0.34 m,  20 of 20 inside the cut
     *     N = 1    player  612 m,    0 of 20
     *     N = 2    player -0.35 m,  20 of 20
     *     N = 5    player  722 m,    0 of 20
     *
     * ONE DRAW is the whole knife edge, and that is the entire content of "the
     * count of archetypes is the knife". `2ed3d65` then added one `rng()` call
     * per body — the droideka's `walkPhase` — and moved this fixture off the
     * offset that happened to be quiet, which is why serialising stopped being
     * enough. With the shove bounded, all four of those offsets keep 20 of 20
     * inside the cut.
     *
     * THE `await` STAYS, and now for a reason it can state: a check that seeds
     * a stream and then spawns is measuring a fight nobody chose unless it owns
     * the stream for the whole distance between the two. That is HANDOFF §2.5
     * and `_shared.mjs`'s own note about `enemyRng`, met from a third
     * direction. What it is NOT is a defence against holding two Worlds at
     * once — that was the wrong lesson drawn from the right symptom, and §2.7
     * of HANDOFF.md drew it too.
     */
    await built;
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(4711);
    const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality: 'high' });
    await world.loadLevel(FIELD);
    world.spawnPlayer?.();
    const p = world.player.position;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2, r = 7 + (i % 5);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      world.spawnEnemy('acolyte', new THREE.Vector3(x, world.terrain.height(x, z), z));
    }

    /* The audit reads the count as REQUESTED, in front of the bound in
     * Particles.js, so the bound cannot hide the caller from it. The first
     * offending stack is kept because a number with no call site in it is a
     * finding nobody can act on. */
    const P = world.particles;
    const audit = { worst: 0, calls: 0, over: 0, cap: P.sparks.max, where: null };
    const rawBurst = P.sparkBurst.bind(P);
    P.sparkBurst = (pos, normal, count = 18, opts = {}) => {
      audit.calls++;
      if (count > audit.worst) audit.worst = count;
      if (count > audit.cap) {
        audit.over++;
        if (!audit.where) {
          const line = (new Error().stack || '').split('\n')
            .find((l) => /src[\\/]game|src[\\/]world/.test(l) && !/Particles\.js/.test(l));
          audit.where = (line || 'unknown caller').trim();
        }
      }
      return rawBurst(pos, normal, count, opts);
    };

    /**
     * AND THE CAMERA GOES WHERE THE PLAYER IS, which every real frame does and
     * this fixture never did.
     *
     * `Enemy.update` decides both its LOD and `clothOn` from `camera.position
     * .distanceTo(this.position)`, and `stubEngine`'s camera is left at the
     * origin. That was invisible for as long as the level happened to spawn
     * the player near it — and stopped being invisible the moment a level
     * moved: measured, all twenty acolytes alive and the nearest 526.1 m from
     * the camera against a 30 m cut, so every garment in the fixture was
     * switched off and the suite was timing an empty loop while reporting a
     * millisecond figure.
     *
     * Not a distance test on the ring, which would be measuring the fixture's
     * own arithmetic: the camera is put where the thing it is a camera FOR is.
     */
    world.engine.camera.position.copy(world.player.position).add(new THREE.Vector3(0, 1.7, 4));
    world.engine.camera.updateMatrixWorld(true);

    const input = idleInput();
    for (let f = 0; f < 90; f++) world.update(1 / 60, input);

    // Wrap the SHIPPED solver on the SHIPPED instances, so what is timed is
    // what the frame actually runs.
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

    const FRAMES = 400;
    solve = 0; refresh = 0;
    for (let f = 0; f < FRAMES; f++) world.update(1 / 60, input);
    const alive = world.enemies.filter((e) => !e.dead);
    const on = alive.filter((e) => e.clothOn).length;
    /* WHY none, when it is none — the two ways this fixture can stop measuring
     * are a fight that killed everything and a cut that switched the cloth
     * off, and "0 enemies were inside the cloth cut" cannot tell them apart. */
    const near = alive.map((e) => e.position.distanceTo(world.engine.camera.position))
      .sort((a, b) => a - b);
    const out = { solveMs: solve / FRAMES, refreshMs: refresh / FRAMES,
      on, alive: alive.length, spawned: world.enemies.length,
      nearest: near.length ? near[0] : Infinity, cut: world.clothCut,
      patched: patched.length, FRAMES, audit };
    world.unload();
    world.dispose?.();
    return out;
  })();

  check('cloth: 20 enemies of garments cost about two milliseconds, not seven and a half', async () => {
    /**
     * The band is wide on purpose. This box has three other agents on it and
     * the same fight measured 1.9 ms on a quiet one and 3.3 ms on a loaded one;
     * what must never come back is the claim that this is half a frame, so the
     * ceiling is set where a 7.5 ms figure would fail and ordinary contention
     * would not.
     */
    try {
      const { solveMs, refreshMs, on, alive, spawned, nearest, cut, patched, FRAMES } = await timed;
      assert(patched >= 10, `only ${patched} enemy garments were found to time`);
      const total = solveMs + refreshMs;
      assert(on >= 10,
        `only ${on} enemies were inside the cloth cut — nothing was measured. `
        + `${alive} of ${spawned} still alive, nearest ${nearest === Infinity ? 'n/a' : nearest.toFixed(1)} m `
        + `against a cut of ${cut} m`);
      assert(total < 6.0,
        `${on} enemies' garments cost ${total.toFixed(2)} ms a frame. Engine.js was sized on 7.5 ms for `
        + 'this population; if that is true again the tier decision needs re-deriving, and if it is '
        + 'not, this check has stopped measuring the right thing');
      assert(total > 0.05, `the garment solve measured ${total.toFixed(3)} ms — nothing is being timed`);
      return `${on} enemy capes: solve ${solveMs.toFixed(2)} ms + collider refresh ${refreshMs.toFixed(2)} ms `
        + `= ${total.toFixed(2)} ms a frame over ${FRAMES} frames, against the 7.5 ms the column was sized on`;
    } finally { restoreShared(shared); }
  });

  check('particles: no effect asks a pool for more sparks than the pool can hold', async () => {
    /* The subject is a COUNT and not a clock, for the same reason the census
     * above is: a millisecond figure is one machine's, and the defect this
     * catches is an argument list out of step, which is machine-independent.
     * A pool holds `max` slots; a single burst asking for more than that
     * overwrites its own output inside one call, so exceeding it is never a
     * taste question and never a tuning question — it is always a bug. */
    const { audit } = await timed;
    assert(audit.calls > 0,
      'no burst was requested in 490 frames of a twenty-body fight, so this measured nothing');
    assert(audit.over === 0,
      `${audit.over} of ${audit.calls} bursts asked for more sparks than the pool holds — worst `
      + `${audit.worst.toLocaleString()} against a capacity of ${audit.cap.toLocaleString()}, a factor of `
      + `${Math.round(audit.worst / audit.cap).toLocaleString()}. That is an argument list out of step, not a `
      + 'tuning number: 10467583 is 0x9fd8ff and 16738410 is 0xff6a6a, the two colours Enemy._sustain '
      + 'passes, and sparkBurst\'s third parameter is `count`, not `color`. It also hands 2 to `normal`, '
      + `so the sparks spread along NaN. First offender: ${audit.where}. `
      + 'Unbounded this froze a frame for 71-134 seconds and made this suite unrunnable; Particles.js '
      + 'now bounds the loop by pool capacity, which stops the freeze and does not fix the caller.');
    return `${audit.calls} bursts, worst ${audit.worst} sparks against a ${audit.cap}-slot pool`;
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

  check('cloth: the extra iterations a carried frame buys are paid only on carried frames', async () => {
    /**
     * WHAT `CARRY_ITERS` COSTS, AND HOW OFTEN.
     *
     * A frame the wearer turned through gets `CARRY_ITERS` more relaxation
     * passes than one it walked through — the right answer, because the
     * residual one cell below a pin is a CONVERGENCE problem and not a
     * modelling one (see the note over `iters` in Cloth.js). What nothing
     * measured is the size of the bill or the size of the population paying
     * it, and both are needed before the constant can ever be raised again.
     *
     * Counted rather than timed, so it is the same number on every machine.
     * A link-solve is one distance constraint relaxed once, which is what the
     * inner loop of `Cloak.update` does `links.length x iterations` times:
     *
     *     the player's whole set   1466 links, 4 iterations   5 864 a frame
     *     a carried frame          the same links, 4 + 6     14 660 a frame
     *
     * 2.5x, and the population is ONE BODY for the duration of a somersault:
     * `Cloak.carry` has exactly one caller in the game — `Player._spinBody`,
     * which runs only while `flipT > 0`. No enemy carries anything, so the
     * multiplier can never be paid by a field of them. That is the whole of
     * why this is affordable, and it is what this check pins: the day a
     * second caller appears, or the day an enemy gets one, the cost stops
     * being a flip's and starts being a wave's.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Cloth.js', import.meta.url), 'utf8');
    const m = /const CARRY_ITERS = (\d+)/.exec(src);
    assert(m, 'Cloth.js no longer declares CARRY_ITERS, so nothing here is measuring it');
    const extra = Number(m[1]);

    /**
     * ITS OWN WORLD, AND A SMALL ONE — because `built` is not this check's.
     *
     * The census above says so in its own teardown note ("it is this check's
     * alone") and then proves it: its `finally` calls `world.unload()` and
     * `dispose()` on the shared promise. Every check in a suite is pushed onto
     * one `Promise.all`, so they interleave, and this one reading `built`'s
     * player was a RACE it happened to win when the suite ran alone and lost
     * under a full verify — `cleave` ahead of it is enough to flip the order.
     * The failure was `Cannot read properties of null (reading 'cloak')`, which
     * is a torn-down world, not a defect in anything it was measuring.
     *
     * Nothing here needs the census: this counts LINKS and ITERATIONS on the
     * player's own garment set, and the check above it has already established
     * that the player's garments are not distance-gated the way an enemy's are.
     * So: one player, no enemies, no 31-body ultra field. Costs a level load
     * this file was paying anyway and owes nothing to anybody else's lifetime.
     */
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality: 'ultra' });
    try {
      await world.loadLevel(FIELD);
      world.spawnPlayer?.();
      const input = idleInput();
      for (let f = 0; f < 4; f++) world.update(1 / 60, input);
      assert(world.player, 'the player did not come up, so there is no garment set to price');
      const set = garments(world.player);
      assert(set.n >= 4, `the player is wearing ${set.n} cloth bodies — nothing to price`);
      let plain = 0, carried = 0, iters = 0;
      /* DEDUPED, for the same reason `garments()` above is a graph walk and
       * not a list of two property names: the player's skirt is reachable as
       * `skirt` AND as `cloak.outer`, and counting it twice doubles the very
       * number this check exists to bound. */
      const seen = [];
      const walk = (c) => {
        if (!c || typeof c !== 'object' || seen.includes(c)) return;
        seen.push(c);
        if (c.pos && c.links) {
          plain += c.links.length * c.iterations;
          carried += c.links.length * (c.iterations + extra);
          iters = Math.max(iters, c.iterations);
        }
        for (const k of ['sash', 'outer', 'inner']) if (c[k] && c[k] !== c) walk(c[k]);
        for (const a of ['parts', 'panels']) if (Array.isArray(c[a])) c[a].forEach(walk);
      };
      walk(world.player.cloak); walk(world.player.skirt);
      const ratio = carried / plain;
      assert(ratio < 3.0,
        `a carried frame costs ${carried} link-solves against a plain frame's ${plain} — `
        + `${ratio.toFixed(2)}x. CARRY_ITERS is ${extra} on top of ${iters}; past 3x the extra `
        + 'passes are most of what a garment costs and the "on the frames that were carried and no '
        + 'others" argument stops covering it.');

      /* AND THE POPULATION. One caller, and it is a somersault. */
      const player = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
      const enemy = await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8');
      const callers = (t) => (t.match(/(?:cloak|skirt)\??\.carry\(/g) || []).length;
      assert(callers(enemy) === 0,
        `Enemy now carries a garment in ${callers(enemy)} place(s). CARRY_ITERS is sized on ONE `
        + 'body paying it for the length of one flip; a field of enemies paying 2.5x their garment '
        + 'solve is a different budget and Cloth.js\'s note has to be re-derived before it lands.');
      assert(callers(player) === 2,
        `Player carries its garments from ${callers(player)} sites, not the cape-and-skirt pair in `
        + '`_spinBody`. Every extra site is another population paying CARRY_ITERS.');
      assert(/_spinBody[\s\S]{0,3000}?cloak\?\.carry\(/.test(player),
        'the carry no longer happens inside `_spinBody`, so it is no longer bounded by a flip');
      return `${plain} link-solves a frame, ${carried} on a carried one (${ratio.toFixed(2)}x, `
        + `+${extra} iterations on ${iters}); one caller, and it is a somersault`;
    } finally {
      restoreShared(shared);
      world.unload(); world.dispose?.();
    }
  });
}
