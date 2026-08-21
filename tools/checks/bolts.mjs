/**
 * BATTLEFIELD BORZ — THE BOLT BROAD PHASE.
 *
 * FLAGSHIP §10 item 3, verbatim: "`capsules()` has no broad phase: 12,456
 * objects rebuilt per frame, 26.7 ms = 39% of the frame at 213 bodies. This is
 * a live bug today." It was worse than that. Measured at a FIFTH of the body
 * count — 39 live bodies, a lit field — `capsules()` ran **463 times a frame
 * for 8,797 entries and 16.43 ms**, a quarter of a 60 Hz frame, because
 * `World._boltHitTest` rebuilt every enemy's whole skeleton for every bolt in
 * flight.
 *
 * The fix is a sphere per body, tested before the bones are gathered. The
 * danger with any broad phase is that it is INVISIBLY WRONG: a sphere that is
 * slightly too small does not crash, it silently deletes hits, and the only
 * symptom is bolts that pass through a limb once in a while. Nobody reports
 * that as a bug; they report the game feeling unfair.
 *
 * So the suite below does not read the sphere's formula. It fires a dense fan
 * through every archetype on the roster and compares the answer the shipped
 * test gives against the answer with the reject switched off. Any difference
 * is a hit the optimisation lost.
 *
 * ── WHY THE FIRST SPHERE WAS WRONG ──────────────────────────────────────
 *
 * It was built out of `radius` and `chestY`, which are a hull width and a
 * chest height. Neither is a bound, and the fan said so: 134 of 13,320 bolts
 * changed answer, led by the dwarf spider, whose legs stand its capsules
 * 2.70 m up and well outside the trunk. The shipped sphere is measured off the
 * capsules the body actually presents.
 */

import { clocked } from './_shared.mjs';

/** The roster, one body at a time, on an otherwise quiet colosseum floor. */
const boot = async () => {
  const H = await import('./_coop.mjs');
  const { world } = await H.bootWorld({
    level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
  });
  const input = H.idleInput();
  for (let i = 0; i < 10; i++) world.update(1 / 60, input);
  return { world, input, H };
};

const BOLT = { damage: 1, owner: null, team: 0, color: { getHex: () => 0 } };

export async function run({ check, assert }) {
  check = await clocked(check);
  const THREE = await import('three');
  const { ARCHETYPES } = await import('../../src/game/Enemy.js');
  await import('../../src/game/Vehicles.js');

  /**
   * A fan around and through each body: 24 bearings, a spread of heights from
   * below the feet to above the head, each bolt a segment that passes clean
   * through where the body stands. Every bolt is answered twice — once
   * shipped, once with `_noBoltReject`, which is the "test every bone always"
   * arm — and the two answers must name the same bone.
   *
   * hp is restored between the two arms so the second reads the same body the
   * first did; a probe worth 1 damage still kills something eventually.
   */
  const fan = (world, e, each = null) => {
    let tested = 0, lost = 0, first = null;
    for (let b = 0; b < 24; b++) {
      for (let h = -0.3; h <= 3.2; h += 0.25) {
        if (each) each();
        const a = (b / 24) * Math.PI * 2;
        const from = new THREE.Vector3(e.position.x + Math.cos(a) * 5, e.position.y + h, e.position.z + Math.sin(a) * 5);
        const to = new THREE.Vector3(e.position.x - Math.cos(a) * 5, e.position.y + h, e.position.z - Math.sin(a) * 5);
        const hp0 = e.hp;
        const withReject = world._boltHitTest(BOLT, from, to);
        e.hp = hp0;
        world._noBoltReject = true;
        const without = world._boltHitTest(BOLT, from, to);
        world._noBoltReject = false; e.hp = hp0;
        tested++;
        const n1 = withReject?.bone ?? null, n2 = without?.bone ?? null;
        if (n1 !== n2) {
          lost++;
          if (!first) first = `${e.type} bearing ${b} h ${h.toFixed(2)}: ${n2} -> ${n1}`;
        }
      }
    }
    return { tested, lost, first };
  };

  await check('bolts.1 the reject drops nothing, on the whole roster', async () => {
    const { world, input } = await boot();
    const types = Object.keys(ARCHETYPES).filter(k => (ARCHETYPES[k].hp | 0) > 0);
    let tested = 0, lost = 0, first = null, bodies = 0;
    for (const type of types) {
      const e = world.spawnEnemy(type, new THREE.Vector3(0, 0, -6));
      if (!e) continue;
      bodies++;
      for (let i = 0; i < 12; i++) world.update(1 / 60, input);
      const r = fan(world, e);
      tested += r.tested; lost += r.lost; if (!first) first = r.first;
      e.dead = true; e.hp = 0;
      for (let i = 0; i < 4; i++) world.update(1 / 60, input);
    }
    assert(bodies >= 20, `only ${bodies} archetypes stood up to be shot at`);
    assert(tested > 10000, `only ${tested} bolts fired`);
    assert(lost === 0, `${lost} of ${tested} bolts changed answer — first: ${first}`);
    return `${bodies} archetypes · ${tested} bolts · nothing dropped`;
  });

  await check('bolts.2 …and keeps dropping nothing while the body moves', async () => {
    /* The fan above is one frozen pose per body. The sphere is BAKED off one
     * pose, so the thing it could still get wrong is an arm that reaches
     * further on a later frame than it did on the bake. This arm steps the
     * world between every bolt, so the pose is never the one the bake saw. */
    const { world, input } = await boot();
    let tested = 0, lost = 0, first = null;
    for (const type of ['b1', 'b2', 'droideka', 'clone', 'spider']) {
      if (!ARCHETYPES[type]) continue;
      const e = world.spawnEnemy(type, new THREE.Vector3(0, 0, -6));
      if (!e) continue;
      for (let i = 0; i < 12; i++) world.update(1 / 60, input);
      const r = fan(world, e, () => world.update(1 / 60, input));
      tested += r.tested; lost += r.lost; if (!first) first = r.first;
      e.dead = true; e.hp = 0;
      for (let i = 0; i < 4; i++) world.update(1 / 60, input);
    }
    assert(tested > 500, `only ${tested} bolts fired at a moving body`);
    assert(lost === 0, `${lost} of ${tested} moving-pose bolts changed answer — first: ${first}`);
    return `${tested} bolts through a walking pose · nothing dropped`;
  });

  await check('bolts.3 and it actually pays', async () => {
    /**
     * The point of the whole thing. `capsules()` is counted directly by
     * wrapping it on the prototype, over a field with bolts in the air, and
     * the count is per FRAME rather than per bolt — §2.6, frames are not
     * seconds and neither is a bolt.
     *
     * The bar is deliberately loose. What is being defended is the ORDER: the
     * old path rebuilt every skeleton for every bolt, so the count scaled as
     * bodies × bolts; the new one only pays for bodies a bolt came near.
     */
    const { world, input } = await boot();
    const { Enemy } = await import('../../src/game/Enemy.js');
    for (let i = 0; i < 24; i++) {
      world.spawnEnemy(i % 2 ? 'b1' : 'b2',
        new THREE.Vector3(-18 + (i % 6) * 6, 0, -14 - Math.floor(i / 6) * 5));
    }
    for (let i = 0; i < 90; i++) world.update(1 / 60, input);

    const real = Enemy.prototype.capsules;
    let calls = 0, entries = 0;
    Enemy.prototype.capsules = function () { calls++; const o = real.call(this); entries += o.length; return o; };
    let frames = 0;
    try {
      for (let i = 0; i < 120; i++) { world.update(1 / 60, input); frames++; }
    } finally { Enemy.prototype.capsules = real; }

    const live = world.enemies.filter(e => !e.dead).length;
    const perFrame = calls / frames;
    assert(live >= 8, `only ${live} bodies alive — the field emptied before it was measured`);
    assert(perFrame < live * 3, `${perFrame.toFixed(1)} capsules() calls a frame at ${live} bodies `
      + '— the broad phase is not rejecting');
    return `${live} bodies · ${perFrame.toFixed(1)} calls, ${(entries / frames).toFixed(0)} entries a frame`;
  });

  await check('bolts.4 a ragdoll is exempt, not shrunk', async () => {
    /* A ragdoll's capsules are placed by the solver and sprawl metres from
     * `position`, which is still standing where the body fell. No sphere
     * centred there is honest, so the reject must stand aside rather than
     * guess — a loose corpse you cannot shoot is a worse bug than a corpse
     * that costs a few capsule rebuilds. */
    const { world, input } = await boot();
    const e = world.spawnEnemy('b1', new THREE.Vector3(0, 0, -6));
    for (let i = 0; i < 12; i++) world.update(1 / 60, input);
    const from = new THREE.Vector3(5, e.position.y + 1, -6);
    const to = new THREE.Vector3(-5, e.position.y + 1, -6);
    const hp0 = e.hp;
    world._boltHitTest(BOLT, from, to); e.hp = hp0;
    assert(e._boltBound, 'a standing body was given no bound at all');

    e.hp = 0; e.die?.(null, 'bolt');
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);
    if (!e.actor?.ragdolled) return 'no ragdoll on this body — nothing to exempt';
    /* Shot through where the corpse actually LIES, not where it stood. */
    const caps = e.capsules();
    assert(caps.length > 0, 'the ragdoll presents no capsules');
    const c = caps[0].p0;
    const a = world._boltHitTest(BOLT, new THREE.Vector3(c.x + 4, c.y, c.z), new THREE.Vector3(c.x - 4, c.y, c.z));
    world._noBoltReject = true;
    const b = world._boltHitTest(BOLT, new THREE.Vector3(c.x + 4, c.y, c.z), new THREE.Vector3(c.x - 4, c.y, c.z));
    world._noBoltReject = false;
    assert((a?.bone ?? null) === (b?.bone ?? null),
      `the reject changed a ragdoll's answer: ${b?.bone ?? null} -> ${a?.bone ?? null}`);
    return 'the sprawl is tested bone by bone, as it must be';
  });

  await check('bolts.5 no archetype presents a non-finite capsule', async () => {
    /**
     * THE BUG THE SPHERE FOUND. A NaN endpoint is invisible: `segmentNear`
     * answers it with a miss, so the capsule simply never gets hit and nothing
     * anywhere says so. Every droideka in the game shipped three of them — its
     * `walkPhase` was initialised in a branch it does not take, and NaN feeds
     * back into itself every frame — which meant its legs could not be shot
     * off or cut off, and the topple at two legs lost was unreachable.
     *
     * Now that a sphere is measured off these numbers, one NaN would take the
     * whole body out of the bolt path rather than one limb. The bake guards
     * against that; this check makes sure it never has to.
     */
    const { world, input } = await boot();
    const types = Object.keys(ARCHETYPES).filter(k => (ARCHETYPES[k].hp | 0) > 0);
    const bad = [];
    let seen = 0;
    for (const type of types) {
      const e = world.spawnEnemy(type, new THREE.Vector3(0, 0, -6));
      if (!e) continue;
      for (let i = 0; i < 20; i++) world.update(1 / 60, input);
      for (const c of e.capsules()) {
        seen++;
        const ok = [c.p0.x, c.p0.y, c.p0.z, c.p1.x, c.p1.y, c.p1.z, c.r].every(Number.isFinite);
        if (!ok) bad.push(`${type}/${c.name}`);
      }
      e.dead = true; e.hp = 0;
      for (let i = 0; i < 4; i++) world.update(1 / 60, input);
    }
    assert(seen > 200, `only ${seen} capsules gathered across the roster`);
    assert(bad.length === 0, `${bad.length} non-finite capsules: ${bad.slice(0, 6).join(', ')}`);
    return `${seen} capsules across ${types.length} archetypes, all finite`;
  });

  return;
}
