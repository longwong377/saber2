/**
 * BATTLEFRONT BORZ — the broad phase over the bodies, and whether it lies.
 *
 * `src/game/ArmyIndex.js` replaced two O(bodies²) sweeps with a uniform grid:
 * `World.pickTarget`'s cross-army nearest-hostile search and the candidate list
 * `CommandDirector.targetFor` used to reject an army against a thirty-metre
 * leash. Its own note carries the numbers — 2.49 ms a frame to 1.72 at 160
 * bodies on Geonosis — and its own correctness argument, which is what this
 * file exists to stop being an argument.
 *
 * ── WHY EXACTNESS IS THE WHOLE OF IT ─────────────────────────────────────
 *
 * A broad phase that returns a superset is safe by construction: the caller
 * keeps its own test and an extra candidate is wasted work and nothing else.
 * That is `within`, and one check is enough for it.
 *
 * `nearest` is a different animal, because it does not return a candidate list,
 * it returns THE ANSWER. A grid nearest-neighbour search is exact only if its
 * stopping rule is sound, and an unsound one does not crash and does not throw
 * — it quietly hands back the second-nearest body some of the time. On this
 * field that is a trooper who turns his back on the droid at his elbow to shoot
 * at one thirty metres away, intermittently, on some frames, depending on how
 * the bodies happen to be spread across cell boundaries. No amount of playing
 * finds that reliably and no sampled benchmark sees it at all.
 *
 * So the first three checks below do the only thing that settles it: run the
 * exhaustive sweep beside the grid over randomised fields, body for body, and
 * assert IDENTITY of the record returned — not agreement of the distance, which
 * would pass on a tie broken differently and hide exactly the case the tie rule
 * exists to pin down.
 *
 * ── AND THE COST, AS A COUNT ─────────────────────────────────────────────
 *
 * HANDOFF §2.6 wants a count and not a clock wherever one is available, and
 * here one is: `tested` is how many body records a caller actually looked at,
 * `linear` is how many the sweep would have. Their ratio is the result and it
 * is the same number on every machine.
 *
 * The count is also the check that the structure has not silently stopped
 * working. A grid that answers correctly by falling through to the sweep every
 * time is a correct grid and a useless one, and the shipped ring-walk version
 * did precisely that on 77% of queries before it was rewritten — passing every
 * correctness check while costing more than the code it replaced.
 */

import { ArmyIndex } from '../../src/game/ArmyIndex.js';

/** A tiny deterministic stream, so a failure is reproducible from its seed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A field of `n` bodies with `spread` metres of scatter, two teams, some dead.
 * `id` is sequential because the tie rule reads it and a check about a tie rule
 * that hands out random ids is a check that never sees the tie.
 */
function field(n, spread, seed, { clumps = 0 } = {}) {
  const r = rng(seed);
  const out = [];
  const centres = [];
  for (let i = 0; i < clumps; i++) {
    centres.push({ x: (r() - 0.5) * spread, z: (r() - 0.5) * spread });
  }
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (clumps) {
      const c = centres[i % clumps];
      x = c.x + (r() - 0.5) * 18; z = c.z + (r() - 0.5) * 18;
    } else {
      x = (r() - 0.5) * spread; z = (r() - 0.5) * spread;
    }
    y = r() * 4;
    out.push({ id: i + 1, team: i % 2, dead: r() < 0.12,
               position: { x, y, z } });
  }
  return out;
}

export async function run({ check, assert }) {

  check('army: the grid names the same body the sweep does, over a scattered field', async () => {
    const ix = new ArmyIndex();
    let asked = 0, agreed = 0, found = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const bodies = field(140, 320, seed);
      ix.sync(bodies);
      for (const asker of bodies) {
        const p = asker.position;
        const pred = (b) => b !== asker && !b.dead && b.team !== asker.team;
        const a = ix.nearest(p.x, p.y, p.z, pred);
        const b = ix.nearestLinear(p.x, p.y, p.z, pred);
        asked++;
        if (a === b) agreed++;
        if (a) found++;
      }
    }
    assert(agreed === asked,
      `${asked - agreed} of ${asked} searches over 24 randomised fields named a different body than `
      + 'the exhaustive sweep — the grid\'s stopping rule is unsound, so a body picks the '
      + 'second-nearest target on some frames and nobody will ever reproduce it by playing');
    assert(found > asked * 0.8,
      `only ${found} of ${asked} searches found anything at all — the field is not populated `
      + 'enough for this check to be measuring what it claims');
    return `${asked} searches over 24 fields of 140 bodies at 320 m spread — all ${agreed} identical `
      + `to the sweep, ${found} of them non-null`;
  });

  check('army: …and over a clumped one, which is what an army actually is', async () => {
    const ix = new ArmyIndex();
    let asked = 0, agreed = 0;
    for (let seed = 100; seed <= 115; seed++) {
      const bodies = field(160, 400, seed, { clumps: 6 });
      ix.sync(bodies);
      for (const asker of bodies) {
        const p = asker.position;
        const pred = (b) => b !== asker && !b.dead && b.team !== asker.team;
        asked++;
        if (ix.nearest(p.x, p.y, p.z, pred) === ix.nearestLinear(p.x, p.y, p.z, pred)) agreed++;
      }
    }
    assert(agreed === asked,
      `${asked - agreed} of ${asked} searches over six-squad fields disagreed with the sweep`);
    return `${asked} searches over 16 fields of 160 bodies in 6 clumps — all identical`;
  });

  check('army: a seeded search is still exact, and that is the case that broke', async () => {
    /* `World.pickTarget` hands in the distance to the nearest PLAYER and asks
     * only for a body that beats it. Written with the stopping rule testing
     * `best` rather than `bestD`, a search that finds nothing closer than the
     * seed can never stop early — it swept the whole field every frame to learn
     * nothing, which cost 4.1 ms a frame. The answer must be null in that case
     * and it must be reached without a sweep. */
    const ix = new ArmyIndex();
    let asked = 0, agreed = 0, nulls = 0;
    for (let seed = 200; seed <= 215; seed++) {
      const bodies = field(120, 260, seed, { clumps: 4 });
      ix.sync(bodies);
      for (const asker of bodies) {
        const p = asker.position;
        const pred = (b) => b !== asker && !b.dead && b.team !== asker.team;
        /* Seeds from "the player is on top of me" to "the player is a hundred
         * metres off", which is the range `pickTarget` really hands in. */
        for (const seedD of [4, 100, 900, 10000, Infinity]) {
          const a = ix.nearest(p.x, p.y, p.z, pred, seedD);
          const b = ix.nearestLinear(p.x, p.y, p.z, pred, seedD);
          asked++;
          if (a === b) agreed++;
          if (a === null) nulls++;
        }
      }
    }
    assert(agreed === asked,
      `${asked - agreed} of ${asked} seeded searches disagreed with the sweep`);
    assert(nulls > asked * 0.1,
      `only ${nulls} of ${asked} seeded searches returned null — the seeds are not tight enough `
      + 'for this check to be exercising the early-out it exists to defend');
    return `${asked} searches at seeds 2-100 m and unseeded — all identical, ${nulls} correctly null`;
  });

  check('army: two bodies exactly equidistant resolve the same way every time', async () => {
    /* The sweep this replaced took the first at the minimum distance in ARRAY
     * order, and array order is not a fact about the world — `World.enemies` is
     * spliced as bodies die. The tie is on `id`, which is stable and the same on
     * every machine, and the check is that the answer does not depend on which
     * order the two are offered in. */
    const ix = new ArmyIndex();
    const mk = (id) => ({ id, team: 1, dead: false, position: { x: 0, y: 0, z: 0 } });
    const a = mk(7), b = mk(3);
    a.position.x = -20; b.position.x = 20;
    const asker = { id: 99, team: 0, dead: false, position: { x: 0, y: 0, z: 0 } };
    const pred = (e) => e !== asker && !e.dead && e.team !== asker.team;
    const one = ix.sync([asker, a, b]).nearest(0, 0, 0, pred);
    const two = ix.sync([asker, b, a]).nearest(0, 0, 0, pred);
    assert(one === two, 'two equidistant bodies resolved differently depending on array order');
    assert(one === b, `the tie went to id ${one.id} rather than to the lower id ${b.id}`);
    /* And the sweep agrees, so the two are comparable in the checks above. */
    assert(ix.sync([asker, a, b]).nearestLinear(0, 0, 0, pred) === b,
      'the exhaustive reference broke the tie differently from the grid');
    return `ids 3 and 7 both 20 m out — both orderings and both structures answer 3`;
  });

  check('army: `within` returns a superset of the disc and never misses a body', async () => {
    const ix = new ArmyIndex();
    let asked = 0, complete = 0, offered = 0, inside = 0;
    for (let seed = 300; seed <= 311; seed++) {
      const bodies = field(150, 300, seed, { clumps: 5 });
      ix.sync(bodies);
      for (const asker of bodies) {
        for (const r of [14, 30, 34]) {
          const out = [];
          ix.within(asker.position.x, asker.position.z, r, out);
          const set = new Set(out);
          let missed = 0, want = 0;
          for (const b of bodies) {
            const dx = b.position.x - asker.position.x, dz = b.position.z - asker.position.z;
            if (dx * dx + dz * dz > r * r) continue;
            want++;
            if (!set.has(b)) missed++;
          }
          asked++; offered += out.length; inside += want;
          if (!missed) complete++;
        }
      }
    }
    assert(complete === asked,
      `${asked - complete} of ${asked} disc queries missed a body the sweep would have found — `
      + 'a broad phase that misses is not a broad phase, it is a bug with a cache in front of it');
    return `${asked} discs of 14-34 m: every body inside was offered, ${(offered / asked).toFixed(1)} `
      + `offered per query against ${(inside / asked).toFixed(1)} actually inside`;
  });

  check('army: a body that walked since the rebuild is still found', async () => {
    /* The index is built once at the top of the frame and read all the way
     * through it, so a body can be a frame of travel outside the cell it is
     * filed in. STALE is the pad that covers it, and this is the check that the
     * pad is applied rather than merely declared: bodies are indexed, then moved
     * up to 2 m, and both queries must still answer as if they had not been. */
    const ix = new ArmyIndex();
    let asked = 0, agreed = 0, moved = 0;
    for (let seed = 400; seed <= 411; seed++) {
      const bodies = field(140, 300, seed, { clumps: 5 });
      ix.sync(bodies);
      const r = rng(seed * 31);
      for (const b of bodies) {
        const a = r() * Math.PI * 2, d = r() * 2;
        b.position.x += Math.cos(a) * d; b.position.z += Math.sin(a) * d;
        moved++;
      }
      for (const asker of bodies) {
        const p = asker.position;
        const pred = (e) => e !== asker && !e.dead && e.team !== asker.team;
        asked++;
        if (ix.nearest(p.x, p.y, p.z, pred) === ix.nearestLinear(p.x, p.y, p.z, pred)) agreed++;
      }
    }
    assert(agreed === asked,
      `${asked - agreed} of ${asked} searches disagreed with the sweep after every body walked up `
      + 'to 2 m from where it was indexed — the staleness pad is not covering a frame of movement, '
      + 'so the grid drops targets at exactly the speeds this game runs at');
    return `${moved} bodies displaced up to 2 m after indexing — all ${asked} searches still exact`;
  });

  check('army: it touches less than the sweep it replaced, and by how much', async () => {
    /* The count, not the clock. A grid that is correct because it falls through
     * to the sweep is a correct grid and a useless one — the ring-walk version
     * this replaced did exactly that on 77% of queries while passing every
     * check above. */
    const ix = new ArmyIndex();
    for (let seed = 500; seed <= 507; seed++) {
      const bodies = field(160, 260, seed, { clumps: 6 });
      ix.sync(bodies);
      for (const asker of bodies) {
        const p = asker.position;
        ix.nearest(p.x, p.y, p.z,
          (b) => b !== asker && !b.dead && b.team !== asker.team, 3600);
      }
    }
    const ratio = ix.tested / ix.linear;
    assert(ratio < 0.75,
      `the grid looked at ${ix.tested} body records where the sweep would have looked at `
      + `${ix.linear} — ${(ratio * 100).toFixed(0)}%, which is not a broad phase, it is the sweep `
      + 'with a hash table in front of it');
    return `${ix.queries} searches over 8 fields of 160: ${ix.tested} records touched against `
      + `${ix.linear} for the sweep — ${(ratio * 100).toFixed(0)}%, plus `
      + `${(ix.cellTests / ix.queries).toFixed(0)} cell tests a query`;
  });

  check('army: the rebuild allocates nothing after the first frame', async () => {
    /* It runs every frame for the life of the session. A Map of fresh arrays per
     * frame is a few hundred allocations a second handed to the collector for a
     * structure whose shape never changes, and a collector pause is a dropped
     * frame with no name on it. The cell records are pooled; this asserts the
     * pool stops growing and that the reused records do not leak last frame's
     * bodies into this frame's answer. */
    const ix = new ArmyIndex();
    const bodies = field(160, 260, 900, { clumps: 6 });
    ix.sync(bodies);
    const first = ix.pool.length;
    for (let f = 0; f < 40; f++) {
      for (const b of bodies) { b.position.x += 0.4; b.position.z -= 0.3; }
      ix.sync(bodies);
    }
    const grew = ix.pool.length - first;
    assert(grew <= first,
      `the cell pool went from ${first} records to ${ix.pool.length} over 40 rebuilds of the same `
      + '160 bodies — it is allocating a fresh record set every frame');
    /* The reuse is only safe if `n` is what bounds a read, not the array's
     * length: a record that held nine bodies last frame and three this frame
     * still HAS the other six in it. */
    let counted = 0;
    for (let k = 0; k < ix.live; k++) counted += ix.pool[k].n;
    assert(counted === bodies.length,
      `the live cells hold ${counted} bodies against ${bodies.length} on the field — a pooled `
      + 'record is being read past its count, so a body from a previous frame is still a candidate');
    return `${first} cells for 160 bodies, ${ix.pool.length} after 40 rebuilds, ${counted} bodies filed`;
  });

}
