/**
 * BATTLEFRONT BORZ — the per-frame costs that are REAL, and the ones that were
 * the box.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * A full gate reported `cloth: 19 enemies' garments cost 6.43 ms a frame` and
 * it was not true. HANDOFF §2.6b had already caught the shape of it — that run
 * was sharing four cores with a dozen agent lanes at a load average of 44 — and
 * its advice was to treat a red timing check as a lead. That is right, and it
 * leaves the actual question open: if a wall-clock millisecond on this box is
 * worthless, what IS the frame made of?
 *
 * `tools/_ledger.mjs` answers it. It drives `theline` at the population the
 * mode really fields — 38 hostiles standing against a ten-man roster on a real
 * seeded ground, not five enemies in a fixture — and splits `world.update` by
 * subsystem in CPU time rather than wall time, because `process.cpuUsage()`
 * counts only the time this process was on a core. Measured on geonosis, seed
 * 7, quality `high`, 300 frames after a 45 s warm-up, at a load average of 45
 * on 4 cores:
 *
 *     subsystem      ms CPU/frame   share
 *     physics           13.808      47.0%
 *     animation          6.612      22.5%
 *     enemy other        3.518      12.0%
 *     enemy think        1.140       3.9%
 *     player             0.947       3.2%
 *     terrain            0.873       3.0%
 *     residual           0.818       2.8%
 *     bolts              0.562       1.9%
 *     cloth              0.461       1.6%
 *     director / blades / particles / corpses / vfx   under 0.2 each
 *     FRAME             29.350
 *
 *     frame wall 185.9 ms · frame CPU 29.4 ms · contention x6.33
 *
 * The last line is the whole point. Every wall-clock figure taken on that box
 * was six times the cost of the work. `cloth` — the row the gate went red on —
 * is 1.6% of the frame in the mode the game is actually played in, and the
 * enemies on that ground wear no garments at all; the 0.46 ms is the PLAYER's
 * four. So the 6.43 ms was contention, and this file holds the two things that
 * came out of going and looking.
 *
 * ── WHAT IS HELD HERE ────────────────────────────────────────────────────
 *
 * 1. THE BROAD PHASE OVER `physics.staticBoxes`. Three separate notes in this
 *    tree say that array is walked linearly once per body per frame and each
 *    of them worked around it locally. `src/physics/BoxIndex.js` is the index
 *    the gather should have been reading. The check is a COUNT and an IDENTITY,
 *    which are both machine-independent: the short list it produces is compared
 *    element for element against the exhaustive sweep on every level in
 *    LEVEL_ORDER, and the box records touched per query are counted against
 *    what the sweep would have touched.
 *
 * 2. THAT A CORPSE STOPS BEING SIMULATED. `physics` is 47% of the frame and
 *    the population that makes it so is the dead: measured on the run above,
 *    288 rigid bodies of which 287 awake, 180 ragdoll joints, against 39 living
 *    enemies. `Corpses` freezes a ragdoll when it has held still — and holding
 *    still was the ONLY route out, so a body that never quite stops never stops
 *    costing. See the check for what the ragdolls were actually doing.
 *
 * Neither check is a clock. That is deliberate and it is the rule the whole
 * episode above teaches: the quantity that survives a shared box is a count.
 */

import { snapshotShared, restoreShared } from './_shared.mjs';

const idleInput = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

export async function run({ check, assert, THREE }) {
  const { bootWorld } = await import('./_coop.mjs');
  const { LEVEL_ORDER } = await import('../../src/game/Levels.js');

  /**
   * THE EXHAUSTIVE SWEEP, WRITTEN OUT ONCE.
   *
   * This is `Enemy._gatherNear`'s test verbatim and it is the ONLY thing in
   * this file that restates a rule from `src/` — HANDOFF §2.4's hazard. It is
   * here rather than called because the whole point of the check is to compare
   * the shipped fast path against the slow one, and the slow one no longer
   * exists in `src/` to be called. If the test in Enemy.js ever changes, this
   * check goes red rather than quiet: the two lists stop agreeing.
   */
  function sweep(boxes, x, z, reach) {
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.disabled) continue;
      const dx = b.center.x - x, dz = b.center.z - z;
      const rr = b.radius + reach;
      if (dx * dx + dz * dz <= rr * rr) out.push(b);
    }
    return out;
  }

  /* One World per level, built once and shared by both broad-phase checks. */
  const grounds = (async () => {
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const { world } = await bootWorld({
        level: key, spawn: false,
        settings: { mode: 'sandbox', level: key, quality: 'high' },
        runSeed: 11,
      });
      const input = idleInput();
      /* Ten seconds of a dressed, empty level: props settle, debris lands, and
       * anything that adds a static box on its way to rest has done it. A
       * census taken on frame zero is a census of the loader. */
      for (let i = 0; i < 300; i++) world.update(1 / 30, input);
      const phys = world.physics;
      const boxes = phys.staticBoxes;
      /* WHERE THE QUERIES ARE TAKEN. A grid over the level's own occupied
       * extent rather than a ring at the origin: a broad phase is easy to get
       * right in the middle of a map and wrong at its edges, where a cell is
       * half empty and a box hangs over the boundary. Plus every box's own
       * centre, because the interesting query is the one standing on something.
       */
      const pts = [];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const b of boxes) {
        minX = Math.min(minX, b.center.x); maxX = Math.max(maxX, b.center.x);
        minZ = Math.min(minZ, b.center.z); maxZ = Math.max(maxZ, b.center.z);
        pts.push({ x: b.center.x, z: b.center.z });
      }
      if (!Number.isFinite(minX)) { minX = maxX = minZ = maxZ = 0; }
      for (let i = 0; i <= 12; i++) {
        for (let j = 0; j <= 12; j++) {
          pts.push({ x: minX + (maxX - minX) * (i / 12), z: minZ + (maxZ - minZ) * (j / 12) });
        }
      }
      rows.push({ key, world, phys, boxes, pts });
    }
    return rows;
  })();

  check('broad phase: the short list is the same list the exhaustive sweep builds', async () => {
    /**
     * IDENTITY, ELEMENT FOR ELEMENT, ON EVERY LEVEL.
     *
     * An optimisation that is faster and wrong is worse than no optimisation,
     * and the way this one could be wrong is silent: a box the index failed to
     * bin is a piece of architecture a body walks through, or stands inside, or
     * falls off — none of which throws and none of which any other check would
     * attribute to a spatial index. So the bar is not "close enough" and not "a
     * superset": it is the SAME BOXES, and the same count of them.
     *
     * Two reaches, because the gather's own is `radius + NEAR_REACH` (about
     * 2.9 m for a trooper, 3.6 for a walker) and a query smaller than a grid
     * cell exercises a different corner of the arithmetic than one larger.
     */
    const shared = await snapshotShared();
    try {
      let queries = 0, boxes = 0, mismatch = 0, levels = 0, worst = '';
      for (const g of await grounds) {
        levels++;
        boxes += g.boxes.length;
        for (const reach of [2.9, 12.0]) {
          for (const p of g.pts) {
            queries++;
            const want = sweep(g.boxes, p.x, p.z, reach);
            const cand = g.phys.nearBoxes(p.x, p.z, reach, []);
            const got = cand.filter((b) => {
              if (b.disabled) return false;
              const dx = b.center.x - p.x, dz = b.center.z - p.z;
              const rr = b.radius + reach;
              return dx * dx + dz * dz <= rr * rr;
            });
            if (got.length !== want.length || want.some((b) => !got.includes(b))) {
              mismatch++;
              if (!worst) {
                worst = `${g.key} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) reach ${reach}: `
                  + `the sweep found ${want.length} boxes, the index ${got.length}`;
              }
            }
          }
        }
      }
      assert(levels === LEVEL_ORDER.length,
        `only ${levels} of ${LEVEL_ORDER.length} grounds were built`);
      assert(queries > 300, `only ${queries} queries were taken — this measured nothing`);
      assert(boxes > 100, `only ${boxes} static boxes across ${levels} grounds — nothing to index`);
      assert(mismatch === 0,
        `${mismatch} of ${queries} broad-phase queries disagreed with the exhaustive sweep. ${worst}. `
        + 'A missed box is architecture a body walks through, and nothing else in the gate would '
        + 'attribute that to src/physics/BoxIndex.js');
      return `${queries} queries over ${boxes} static boxes on ${levels} grounds agree with the `
        + 'exhaustive sweep exactly';
    } finally { restoreShared(shared); }
  });

  check('broad phase: a body no longer looks at every box in the level to find the ones underfoot', async () => {
    /**
     * THE COUNT, WHICH IS THE MACHINE-INDEPENDENT HALF OF THE SAVING.
     *
     * `Enemy._gatherNear` ran once per body per frame over the whole array, and
     * the array grows through a session — the note over NEAR_REACH measures a
     * temple going 241 → 377 boxes as its masonry is cut, and Trees.js measures
     * the same curve out to 1 800. What is asserted here is the RATIO, because
     * that is what does not depend on which machine or which level: a gather
     * touching a tenth of the array is a tenth of the work whatever a
     * millisecond happens to be worth today.
     *
     * The floor is deliberately loose. A ground whose architecture is one dense
     * clump will legitimately hand back most of the array for a query inside
     * that clump, and the check would be lying if it demanded otherwise; what
     * it must catch is the index quietly degenerating to a full scan, which is
     * what happens if the cell size, the spill rule or the version stamp break.
     */
    const shared = await snapshotShared();
    try {
      const rows = [];
      for (const g of await grounds) {
        if (g.boxes.length < 40) continue;          // nothing to index
        const bi = g.phys.boxIndex;
        const before = { t: bi.tested, q: bi.queries, l: bi.linear };
        for (const p of g.pts) g.phys.nearBoxes(p.x, p.z, 2.9, []);
        const q = bi.queries - before.q;
        const tested = (bi.tested - before.t) / q;
        const linear = (bi.linear - before.l) / q;
        rows.push({ key: g.key, tested, linear, n: g.boxes.length, over: bi.oversized.length });
      }
      assert(rows.length >= 3,
        `only ${rows.length} grounds carry enough architecture to price a broad phase`);
      for (const r of rows) {
        assert(r.tested < r.linear * 0.5,
          `${r.key}: a gather still looks at ${r.tested.toFixed(1)} of the level's ${r.n} static boxes — `
          + `the index is not narrowing anything (${r.over} records are oversized and scanned in full). `
          + 'That is a full scan wearing an index\'s name');
      }
      const t = rows.reduce((a, r) => a + r.tested, 0) / rows.length;
      const l = rows.reduce((a, r) => a + r.linear, 0) / rows.length;
      return `${rows.length} grounds: a gather looks at ${t.toFixed(1)} box records against ${l.toFixed(1)} `
        + `for the sweep it replaced (${(l / t).toFixed(1)}x) — `
        + rows.map((r) => `${r.key} ${r.tested.toFixed(0)}/${r.n}`).join(', ');
    } finally { restoreShared(shared); }
  });

  check('ground memory: a bootprint at one end of the field does not re-encode the other end', async () => {
    /**
     * `SurfaceField` remembers what has been walked on, driven over and burnt.
     * It publishes to the GPU through a 192x192 byte texture, and it used to
     * decide what to publish with ONE bounding box grown to contain every mark
     * in the frame — so two boots at opposite corners dirtied everything
     * between them. A battlefield has forty pairs of boots on it.
     *
     * Measured in a CPU profile of a real engagement (tools/_ledger.mjs
     * --prof), `_encodeCell` was 7.03% of the frame's self time, behind only
     * Rapier's step and `updateMatrixWorld`. It is four array writes; it was
     * simply being asked for three hundred times more of them than the marks
     * needed.
     *
     * TWO ASSERTIONS, AND THE SECOND IS THE ONE THAT MATTERS. A dirty list is
     * a correctness risk before it is a saving: a cell that changed and is not
     * inside any rectangle is a print that never reaches the screen, and
     * nothing would throw. So the check publishes incrementally, then re-encodes
     * the WHOLE field from the same depth and scorch arrays, and requires the
     * two byte buffers to be identical. The count is the saving; the identity
     * is the licence to have it.
     */
    const { SurfaceField } = await import('../../src/world/Surface.js');
    const field = new SurfaceField({ size: 48, ages: false });
    const N = field.res;

    let cells = 0;
    const realCell = field._encodeCell.bind(field);
    field._encodeCell = (i, j) => { cells++; return realCell(i, j); };

    /* Scattered prints, deliberately far apart: five walkers in different
     * corners of the window is the case the single box could not express. */
    const walkers = [[-18, -18], [17, -17], [-16, 16], [15, 15], [0, 0]];
    let stamped = 0;
    for (let step = 0; step < 24; step++) {
      for (const [wx, wz] of walkers) {
        const x = wx + Math.cos(step * 0.7) * 1.4, z = wz + Math.sin(step * 0.7) * 1.4;
        stamped += field.tread(x, z, 0.22, 0.05, 0.4, 0.2) > 0 ? 1 : 0;
      }
      field.flush();
    }
    assert(stamped > 60, `only ${stamped} prints landed in the window — nothing was measured`);

    const perFlush = cells / 24;
    assert(perFlush < N * N * 0.25,
      `publishing five walkers' prints re-encodes ${perFlush.toFixed(0)} of the field's ${N * N} cells a `
      + 'frame. One bounding box over marks that are far apart is the whole texture, which is what this '
      + 'is here to stop');

    /* THE IDENTITY. Same depth and scorch, encoded exhaustively, must give the
     * same bytes the incremental path published. */
    const published = Uint8Array.from(field.data);
    field._encodeCell = realCell;
    field._encodeAll();
    let bad = 0, firstAt = -1;
    for (let k = 0; k < field.data.length; k++) {
      if (field.data[k] !== published[k]) { bad++; if (firstAt < 0) firstAt = k; }
    }
    assert(bad === 0,
      `${bad} of ${field.data.length} texture bytes differ between the incremental publish and a full `
      + `re-encode (first at byte ${firstAt}, cell ${firstAt >> 2}). A cell that changed and was not in `
      + 'any dirty rectangle is a mark the player never sees, and nothing else in the gate would catch it');
    field.dispose();
    return `${stamped} prints from five walkers in four corners: ${perFlush.toFixed(0)} of ${N * N} cells `
      + `re-encoded a publish (${(N * N / perFlush).toFixed(0)}x less than one bounding box over them all), `
      + 'and the bytes are identical to a full re-encode';
  });

  check('corpses: a ragdoll stops being simulated, including one that never stops moving', async () => {
    /**
     * WHAT THIS IS ABOUT.
     *
     * `physics` is 47% of `world.update` at the population `theline` fields,
     * and it is spent on the dead: 386 rigid bodies of which 383 awake and 269
     * joints, against 40 living enemies. `Corpses` is supposed to prevent
     * exactly that — its own header says "573 bodies → 33" — and it was not,
     * because its settle test asked whether the FASTEST of a ragdoll's nineteen
     * bones was under 5 cm/s. A corpse lying in the sand reads 0.20-0.28 there
     * for ever. Measured in a real engagement: 15 of 21 corpses had never
     * settled and the oldest had been down 33.7 seconds.
     *
     * ── THE FIXTURE, AND WHY IT IS A HEAP ────────────────────────────────
     *
     * Bodies are killed ON TOP OF EACH OTHER. That is not a stress test, it is
     * the shape the defect actually takes: a corpse alone on flat ground does
     * eventually go quiet even under the old test, and a pile does not, because
     * every body in it is being nudged by the ones under it. A fixture that
     * lays them out politely in a row would pass on the broken build.
     *
     * One body is then held in motion for the whole run — a fair model of a
     * corpse wedged under a walker's foot, and the case the reading of 108 m/s
     * at 33 seconds came from. Under the old rule that body could never settle
     * by construction; under the cap it is ended one way or the other.
     *
     * ── WHAT IS ASSERTED, AND WHY IT IS A COUNT ──────────────────────────
     *
     * Rigid bodies in the solver, which is machine-independent and is the thing
     * the frame is actually paying for. Not milliseconds: see this file's
     * header for what a millisecond is worth on this box.
     */
    const shared = await snapshotShared();
    let world = null;
    try {
      /* GEONOSIS, because that is the ground the reading came from: `theline`
       * raises a generated battlefield heightfield under its levels, so a
       * corpse lies on a slope rather than on a machined floor, and every one
       * of the ten unsettled bodies in that census was lying flat on it — the
       * `above ground` column read 0.00 for all of them. A fixture on a
       * perfectly level plate would be measuring a nicer world than the game's. */
      const boot = await bootWorld({
        level: 'geonosis', spawn: true,
        /**
         * `sandboxCount` IS NOT DECORATION HERE. The sandbox director keeps the
         * `count` nearest bodies of the right archetype and DISPOSES the rest,
         * every frame (`WaveDirector._sandboxUpdate`), and its default is five.
         * The first cut of this fixture spawned ten and had five of them
         * disposed at full health inside three frames, which read exactly like
         * the bodies dying — `only 5 of 10 bodies stood up to be killed`. The
         * room is doing its job; the fixture has to ask it for the population
         * it wants.
         */
        settings: { mode: 'sandbox', level: 'geonosis', quality: 'high',
          sandboxCount: 24, sandboxType: 'mixed', sandboxFire: 0 },
        runSeed: 5,
      });
      world = boot.world;
      const input = idleInput();
      const phys = world.physics;

      const N = 10;
      const at = world.player.position.clone();
      for (let i = 0; i < N; i++) {
        /* A RING WIDE ENOUGH TO STAND IN. The first cut of this put them in a
         * 1.2 m circle to make a heap, and Rapier threw nine of the fourteen
         * out of the world resolving the overlap on frame one — a fixture that
         * kills its own subjects before the check begins. */
        const a = (i / N) * Math.PI * 2;
        const x = at.x + Math.cos(a) * 3.6, z = at.z + Math.sin(a) * 3.6;
        world.spawnEnemy('trooper', new THREE.Vector3(x, world.terrain.height(x, z) + 1.0, z));
      }
      for (let i = 0; i < 90; i++) world.update(1 / 30, input);
      const alive = world.enemies.filter((e) => !e.dead);
      assert(alive.length >= N - 2, `only ${alive.length} of ${N} bodies stood up to be killed`);
      const living = phys.stats.bodies;

      /* Through the shipped death, so the corpse reaches `Corpses` the way one
       * does in a game rather than by being pushed into the list by hand. */
      for (const e of alive) e.die(e.position.clone(), null, 'blade');
      for (let i = 0; i < 4; i++) world.update(1 / 30, input);
      const dead = world.corpses.list.slice();
      assert(dead.length >= N - 2, `only ${dead.length} of ${N} bodies reached the undertaker`);
      const peak = phys.stats.bodies;
      assert(peak > living + 40,
        `killing ${dead.length} bodies added only ${peak - living} rigid bodies — they did not ragdoll, `
        + 'so this check would pass on any build');

      /* THE ONE THAT NEVER STOPS. Re-kicked every frame, which is what being
       * under something heavy does to a corpse. */
      const restless = dead.find((c) => c.e?.actor?.ragdolled) || dead[0];
      const kick = () => {
        const a = restless.e?.actor;
        if (!a?.bodies) return;
        for (const b of a.bodies.values()) b.velocity?.set?.(0, 1.2, 0.9);
      };

      /**
       * THE ROOM STOPS PRODUCING BODIES NOW.
       *
       * With a `sandboxCount` high enough to hold ten subjects, the director
       * goes on filling the room to that number for the whole run — and one of
       * those late arrivals dying at second 29 is a corpse that is legitimately
       * two seconds old and legitimately still settling. The first cut of this
       * check counted it as a failure. Zero disposes the LIVING only; a corpse
       * is not in `alive` and none of ours is touched.
       */
      world.settings.sandboxCount = 0;

      /* Thirty game-seconds. The cap is twelve, the settle hold is 0.75, and
       * the sink takes 1.1 — so anything OLDER THAN THAT and still simulating
       * is not slow, it is unbounded. The age guard is the whole difference
       * between "no upper bound" and "has not got there yet". */
      const GRACE = 15;
      let worstT = 0;
      for (let i = 0; i < 900; i++) {
        kick();
        world.update(1 / 30, input);
        for (const c of world.corpses.list) if (!c.settled && c.sink <= 0) worstT = Math.max(worstT, c.t);
      }

      const held = world.corpses.list;
      const stuck = held.filter((c) => !c.settled && c.sink <= 0 && c.t > GRACE);
      const after = phys.stats.bodies;
      assert(stuck.length === 0,
        `${stuck.length} of ${held.length} corpses are still being simulated more than ${GRACE} s after `
        + `they died — oldest ${worstT.toFixed(1)} s. Settling is what takes a ragdoll's rigid bodies out of the `
        + 'solver, and a corpse with no upper bound on how long it may refuse to settle is an '
        + 'unbounded per-frame cost. See SETTLE_CAP in src/game/Corpses.js');
      assert(after <= living + 12,
        `the physics world still holds ${after} rigid bodies against ${living} before ${dead.length} `
        + `bodies died and ${peak} at the peak — the dead were never given back`);
      return `${dead.length} bodies killed in a heap took the solver ${living} → ${peak} rigid bodies and `
        + `back to ${after} within 30 s; ${world.corpses.settled} settled, ${world.corpses.capped} needed `
        + `the cap, and no corpse was ever left simulating past ${worstT.toFixed(1)} s`;
    } finally {
      try { world?.unload(); } catch { /* a world that never booted */ }
      restoreShared(shared);
    }
  });
}
