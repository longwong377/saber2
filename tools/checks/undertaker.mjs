/**
 * BATTLEFRONT BORZ — WHAT THE FIELD KEEPS, AND WHAT IT LETS GO OF.
 *
 * Three systems own the leftovers of a fight: `Corpses` bounds the dead,
 * `CohortField` draws the distant living, and `Dropped` puts a hilt on the
 * floor. Every one of them was measured over a long drive and every one of
 * them was holding something it should have handed back. The suite that would
 * have caught each is missing for the same reason in all three cases — the
 * existing checks assert the BOUND on the thing they own and never ask whether
 * the thing being bounded is still real.
 *
 * What a long drive found. `tools/_bodyaudit.mjs`, colosseum/waves, one
 * scripted Jedi, 900 game-seconds, a full census every 60:
 *
 *     t=120s   20 corpses,  7 of them already disposed
 *     t=240s   20 corpses, 17 of them already disposed
 *     t=420s   20 corpses, 20 of them already disposed — and it never moves
 *
 * `World.update` tears a corpse down forty seconds after it falls
 * (`Enemy.update` ends `return this.dying < 40`) and `Corpses.update` guards
 * every entry on `e.disposed`, which `Enemy.dispose` never wrote. Seven
 * minutes in, every slot of the budget is a body that no longer exists, the
 * `live.length > budget` test is false forever, and the field a player fights
 * on keeps no dead at all.
 *
 * `tools/_cohortleak.mjs`, twelve B1s stood past `L3_AT` and killed there:
 * six were still cohort MEMBERS forty-five seconds after they had been
 * disposed, still drawn as standing soldiers by the shared InstancedMesh,
 * their slots never handed back.
 *
 * `tools/_hiltpile.mjs`, eight duellists killed five times over: 8 → 40 hilts,
 * 196 → 983 meshes, one per saber-carrying kill and nothing anywhere to take
 * one away.
 *
 * The rule this file holds is one sentence: **nothing may still be holding an
 * object the game has already torn down, and nothing a fight produces may grow
 * without a bound.** Each check drives the real systems rather than reading
 * them as text, because all three of these were green in every suite that
 * mentions them.
 *
 * HANDOFF §2.1: World, Cohorts and Dropped are imported INSIDE function
 * bodies. `Cohorts.js` reaches `src/toon/Ink.js` and `Dropped.js` reaches
 * `Props.js`; a static edge from a check into that graph is how a suite ends
 * up patching the wrong copy of three.
 */

import * as THREE from 'three';
import { bootWorld, idleInput } from './_coop.mjs';
import { clocked } from './_shared.mjs';

const STEP = 1 / 30;
/** Step a world for `seconds` of game time. */
const drive = (world, seconds, input) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) world.update(STEP, input);
};

/** Put a body on the ground at (x, z), whatever the ground is doing there. */
function stand(world, type, x, z) {
  const p = new THREE.Vector3(x, 0, z);
  p.y = world.terrain?.height?.(x, z) ?? 0;
  return world.spawnEnemy(type, p);
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The dead                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('undertaker: a body the world has torn down is not still a corpse', async () => {
    /**
     * THE WHOLE DEFECT IN ONE PROPERTY, and it is not "the ledger is bounded"
     * — `command.mjs` already asserts that and it passed throughout. It is
     * that every entry in the ledger points at a body that still exists.
     *
     * Driven through the game's OWN teardown rather than by calling
     * `dispose()` here: `Enemy.update` returns `this.dying < 40` and
     * `World.update` disposes on that, so forty-one seconds of world is what
     * separates the two states. A check that disposed the body itself would
     * pass against a build where nothing else ever did.
     */
    const { world } = await bootWorld({
      level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
    });
    const input = idleInput();
    const made = [];
    for (let i = 0; i < 4; i++) {
      const e = stand(world, 'b1', 6 + i * 2, 0);
      if (e) made.push(e);
    }
    assert(made.length > 0, 'no bodies were spawned, so this check measures nothing');
    drive(world, 0.5, input);
    for (const e of made) { e.hp = 0; e.die?.(null, 'check'); }
    /**
     * DRIVEN UNTIL IT HAS HAPPENED, NOT FOR A FIXED WALL OF FRAMES — and the
     * difference is not slack, it is that `dying` does not advance at one
     * second per second. `World` scales `dt` for hitstop and kill-time, so
     * 42 s of stepping put `dying` at 37 and the first draft of this check
     * failed on a build where the fix was working. Same trap `HANDOFF §2.6`
     * names about frames and seconds, one clock further in.
     */
    let stepped = 0;
    while (stepped < 90 && made.some((e) => !e.disposed)) { drive(world, 2, input); stepped += 2; }

    const gone = made.filter((e) => e.disposed);
    assert(gone.length === made.length,
      `${made.length - gone.length} of ${made.length} bodies were still not marked disposed after `
      + `${stepped} s (dying ${made.map((e) => (e.dying ?? -1).toFixed(0)).join('/')}) — `
      + '`Corpses.update`\'s `e.disposed` guard is dead code again');

    const ghosts = (world.corpses?.list || []).filter((c) => c.e && c.e.disposed);
    assert(ghosts.length === 0,
      `${ghosts.length} of ${world.corpses.list.length} corpses point at a body that has been torn down; `
      + 'each holds a whole Enemy graph and occupies a slot of the budget forever');

    const held = (world.corpses?.list || []).filter((c) => !world.enemies.includes(c.e));
    assert(held.length === 0, `${held.length} corpses are not in world.enemies at all`);
    world.dispose?.();
    return `${made.length} bodies died, aged out inside ${stepped} s of driving and left the ledger; `
      + `${world.corpses.list.length} corpses held`;
  });

  check('undertaker: disposing a body twice is not an error, and the second one is free', async () => {
    /**
     * The sink path ends in `e.dispose?.()` inside a bare `catch {}`, and a
     * ghost that reached it had already been disposed once — so a whole class
     * of double-free lived behind that swallow. It is a contract now.
     */
    const { world } = await bootWorld({
      level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
    });
    const input = idleInput();
    const e = stand(world, 'b1', 6, 0);
    assert(e, 'no body');
    drive(world, 0.5, input);
    e.hp = 0; e.die?.(null, 'check');
    drive(world, 1.5, input);
    const before = world.physics.bodies.length;
    e.dispose();
    assert(e.disposed === true, '`dispose()` does not mark the body disposed');
    const after = world.physics.bodies.length;
    e.dispose();                       // must be a no-op, not a second teardown
    assert(world.physics.bodies.length === after,
      'a second dispose() changed the physics world, so it was not a no-op');
    world.dispose?.();
    return `one dispose freed ${before - after} bodies, the second freed none and threw nothing`;
  });

  check('undertaker: the grind ledger does not outlive the body it was grinding', async () => {
    /**
     * `BladeContactSolver` keys `progress`, `touched` and `cooldown` on
     * `enemy.id + ':' + capsule`, and only a COMPLETED cut clears them
     * (`World._applyBladeEvent`). Every bone the player started on and did not
     * finish was therefore a key that outlived the body — one more per kill,
     * for the whole level.
     */
    const { world } = await bootWorld({
      level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
    });
    const e = stand(world, 'b1', 6, 0);
    assert(e, 'no body');
    const S = world.bladeSolver;
    S.progress.set(`${e.id}:armL`, 0.4);
    S.touched.set(`${e.id}:armL`, 1);
    S.cooldown.set(`${e.id}:armL`, 2);
    e.dispose();
    const left = [...S.progress.keys(), ...S.touched.keys(), ...S.cooldown.keys()]
      .filter((k) => k.startsWith(e.id + ':'));
    assert(left.length === 0, `${left.length} grind keys survive the body: ${left.slice(0, 3).join(', ')}`);
    world.dispose?.();
    return 'a disposed body takes its unfinished grind with it';
  });

  check('undertaker: a body put back into the world is not still flagged dead', async () => {
    /**
     * `RapierWorld.remove` sets `body.dead = true`; `add` never cleared it. So
     * the flag meant "has been removed at least once" while every reader takes
     * it to mean "is not simulated", and a body CAN come back —
     * `Enemy._tickGetUp` takes the walking capsule out when a droid is knocked
     * flat and calls `add` again when it stands up.
     *
     * Measured with `tools/_deadflag.mjs`, one B1:
     *
     *     standing   dead=false  inWorld=true   forceSeen=true
     *     knocked    dead=true   inWorld=false
     *     back up    dead=true   inWorld=true   forceSeen=FALSE
     *
     * `Player._grippableBody` refuses anything with `b.dead`, and `_forceSeen`
     * is what the aim ray asks — so a droid the player had already put on its
     * back could never be gripped, pulled or thrown again for the rest of its
     * life. The ray went straight through it to whatever stood behind.
     *
     * Asserted as the INVARIANT rather than as the one path, because the flag
     * is read in five files and the next caller to remove-and-re-add a body
     * will not know about this note.
     */
    const { world } = await bootWorld({
      level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
    });
    const input = idleInput();
    const e = stand(world, 'b1', 7, 0);
    assert(e, 'no body');
    drive(world, 1, input);
    assert(e.body.dead === false, 'a freshly spawned body is already flagged dead');

    e.knockFlat?.(new THREE.Vector3(0, 6, -6));
    drive(world, 0.5, input);
    assert(e.bodyRemoved, 'knocking the body flat did not take its capsule out of the world, '
      + 'so this check is measuring nothing');

    /* Up again: GET_UP plus the recover beat, and it is not a fixed number of
     * seconds — the same time-scale trap the corpse check above documents. */
    let waited = 0;
    while (waited < 40 && e.bodyRemoved) { drive(world, 1, input); waited += 1; }
    assert(!e.bodyRemoved, `the body never stood back up inside ${waited} s`);
    assert(world.physics.bodies.includes(e.body), 'the capsule was not put back into the world');
    assert(e.body.dead === false,
      'a body that is standing, alive and simulated is flagged dead — every reader of the flag '
      + 'treats it as gone, and the Force aim ray is one of them');

    /* …and the invariant, over everything the world is stepping. */
    const lying = world.physics.bodies.filter((b) => b.dead);
    assert(lying.length === 0,
      `${lying.length} of ${world.physics.bodies.length} bodies in the world are flagged dead`);
    world.dispose?.();
    return `knocked flat, back up inside ${waited} s, and the flag tells the truth at both ends`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The distant living                                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('undertaker: a body that dies inside a cohort leaves it, and gives the slot back', async () => {
    /**
     * `applyCohort`'s own eligibility test already says a corpse is not a
     * cohort's — `fit` is `lod >= 3 && !owner.dead && !owner.actor?.ragdolled`
     * — and it was never asked again, because both callers of `applyBodyLod`
     * sit BELOW `Enemy.update`'s `if (this.dead) … return`. So the rung's last
     * word on a body was the one it heard while the body was alive.
     *
     * Two things are asserted and the second is the visible one: the slot
     * comes back (a bound), and the body is not left DARK (a corpse whose own
     * meshes are all hidden is a corpse nothing draws, lying under a standing
     * instance of itself).
     */
    const { L3_AT } = await import('../../src/game/Cohorts.js');
    const { world } = await bootWorld({
      level: 'geonosis', settings: { mode: 'sandbox', level: 'geonosis', quality: 'high' }, runSeed: 7,
    });
    const input = idleInput();
    const far = L3_AT + 25;
    const made = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const e = stand(world, 'b1', Math.cos(a) * far, Math.sin(a) * far);
      if (e) made.push(e);
    }
    drive(world, 4, input);
    const joined = made.filter((e) => e._l3);
    assert(joined.length > 0,
      'no body reached a cohort at ' + far.toFixed(0) + ' m, so this check measures nothing');

    /* What each of them was occupying, so the slot can be followed rather than
     * counted — a free list is shared, and a living body that joins in the
     * same second takes one back off it. */
    const took = joined.map((e) => ({ e, c: e._l3.c, slot: e._l3.slot }));
    for (const e of joined) { e.hp = 0; e.die?.(null, 'check'); }
    drive(world, 1, input);

    const stillIn = joined.filter((e) => e._l3);
    assert(stillIn.length === 0,
      `${stillIn.length} of ${joined.length} corpses are still cohort members — each is drawn as a `
      + 'standing soldier at the spot it fell, and its slot is never reused');
    const stillDark = joined.filter((e) => (e._dark || []).length > 0);
    assert(stillDark.length === 0,
      `${stillDark.length} corpses are still darkened with nothing drawing them`);

    /* Every slot a corpse held is either back on the free list or has been
     * taken by a body that is still alive. Either is the slot being REUSABLE,
     * which is the property; "it is on the free list" is not, because the
     * cohort hands one straight back out. */
    const stranded = took.filter(({ c, slot }) =>
      !c.free.includes(slot) && ![...c.members].some((m) => m._l3 && m._l3.slot === slot));
    assert(stranded.length === 0,
      `${stranded.length} of ${took.length} slots are neither free nor held by a living body — `
      + 'the instance buffer grows by one per distant kill and never shrinks');

    /* …and nothing dead or torn down is still a member, whoever it is. */
    const deadMembers = [];
    for (const c of world.cohorts.cohorts.values()) {
      if (!c) continue;
      for (const m of c.members) if (m.dead || m.disposed) deadMembers.push(m);
    }
    assert(deadMembers.length === 0, `${deadMembers.length} cohort members are dead or disposed`);
    world.dispose?.();
    return `${joined.length} bodies died in a cohort; every one left it and every slot came back`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The wood                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('undertaker: a felled trunk is never handed to the solver inside the hill', async () => {
    /**
     * NEXT.md, open: "a log that has settled BELOW the ground it fell on. Of
     * nine trunks realised in the wood, four had surfaces under the terrain
     * and one had fallen to −179 m. The floor query is right about all of
     * them; the solver put them there."
     *
     * −179 m is one metre off `RapierWorld.killY`. The fall is a hinge that
     * does not know about the ground — `Forest.update` integrates a rod to
     * horizontal about a pivot at the cut face — so a trunk rests at the
     * height of its own stump however the ground runs away under it, and
     * `_realise` built a DYNAMIC body at that pose. Measured over the wood
     * with `tools/_logsweep.mjs`, twelve stops, fourteen trees felled at each:
     * **9 of 21 realised logs were born with their underside below the
     * terrain**, deepest 1.53 m, p90 0.75 m.
     *
     * THE RULE IS THE BIRTH AND NOT THE RESTING PLACE, deliberately. Where a
     * log ends up after it has been shoved, cut, thrown or rolled down a bank
     * is the solver's business and a check that pinned it would be pinning a
     * scene. What may not happen is a rigid body being CREATED inside a
     * heightfield, because that is the one state Rapier has no correct answer
     * for — and it is the state every one of those nine was created in.
     *
     * Driven through `_realise` itself rather than through a fifteen-second
     * walk: the walk is what found it, and one realisation is what the rule is
     * about.
     */
    const { world } = await bootWorld({
      level: 'wood', settings: { mode: 'sandbox', level: 'wood', quality: 'low' }, runSeed: 7,
    });
    const input = idleInput();
    const f = world.forest;
    assert(f && f.data, 'the wood has no forest, so this check measures nothing');
    const N = Math.floor(f.data.length / 15);
    const T = world.terrain;
    const P = world.player.position;

    /* THE BIRTH IS WHAT IS CAUGHT, so `_realise` is wrapped rather than the
     * field being read afterwards. Where a log ends up once it has been
     * dropped, shoved or rolled down a bank is the solver's business and a
     * check that pinned it would be pinning a scene. */
    const births = [];
    const realise = f._realise.bind(f);
    f._realise = (i) => {
      realise(i);
      const rec = f.real.get(i);
      if (!rec) return;                       // refused: it is in the hill
      const b = rec.prop.body;
      const r = f.data[i * 15 + 4];
      const half = b.extent ? b.extent.y : 0;
      const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quaternion);
      let deep = 0;
      for (let s = -6; s <= 6; s++) {
        const q = b.position.clone().addScaledVector(ax, (s / 6) * half);
        const d = T.height(q.x, q.z) - (q.y - r);
        if (d > deep) deep = d;
      }
      births.push({ i, deep });
    };

    /* Fell everything near the player so there is a choice of logs, then let
     * them land and let `_syncLogs` realise the ones inside `LIFT_RING`. */
    const order = [];
    for (let i = 0; i < N; i++) {
      const dx = f.data[i * 15] - P.x, dz = f.data[i * 15 + 1] - P.z;
      order.push([i, dx * dx + dz * dz]);
    }
    order.sort((a, b) => a[1] - b[1]);
    let felled = 0;
    for (const [i] of order.slice(0, 40)) {
      const a = (i * 2.399963) % (Math.PI * 2);
      if (f.fell(i, Math.cos(a), Math.sin(a), 0.6)) felled++;
    }
    assert(felled > 8, `only ${felled} trees came down`);
    drive(world, 14, input);
    assert(births.length > 0, 'no log was realised at all, so this check measures nothing');

    /* The seat samples the log at eight points along its length, so a ridge
     * BETWEEN two samples can leave a few centimetres — 10 cm is that, and it
     * is inside the solver's own contact tolerance. Anything at the scale the
     * sweep measured before the fix (0.75 m at p90, 1.53 m deepest) is a body
     * born inside a heightfield. */
    const buried = births.filter((b) => b.deep > 0.10);
    assert(buried.length === 0,
      `${buried.length} of ${births.length} logs were CREATED inside the ground: `
      + buried.slice(0, 4).map((b) => `tree ${b.i} ${b.deep.toFixed(2)} m`).join(', ')
      + ' — Rapier pushes a shallow one out and cannot resolve a deep one at all');

    /* …and nothing that was handed to the solver has left the world. A log at
     * the kill plane keeps its Prop, is marked `moved`, and is then never
     * released either, so the tree is gone from the wood for good. */
    for (const [i, rec] of f.real) {
      const y = rec.prop.body.position.y;
      assert(Number.isFinite(y) && y > -50, `log ${i} is at y ${y} — it has left the world`);
    }
    const worst = births.reduce((m, b) => Math.max(m, b.deep), 0);
        return `${felled} trees felled, ${births.length} logs handed to the solver, deepest born ${worst.toFixed(2)} m in`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The floor                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('undertaker: the hilts a duel leaves behind are bounded, and the near ones stay', async () => {
    /**
     * A hilt is an ordinary `Prop` with no lifetime, and `ageDropped` only
     * ever advanced its `dropAge`. Measured: exactly one per saber-carrying
     * kill, 24.6 meshes each, forever.
     *
     * The bound is one half. The other half is that the budget is spent on
     * the RIGHT hilts: a weapon the PLAYER put down is one they mean to come
     * back for, and it must survive a cull that takes twenty others. That is
     * a relationship and not a radius — see the note in Dropped.js for why a
     * distance floor is the wrong guarantee and measured as one.
     */
    const { dropSaber, HILT_BUDGET } = await import('../../src/game/Dropped.js');
    const { world } = await bootWorld({
      level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'high' }, runSeed: 7,
    });
    const input = idleInput();
    const budget = HILT_BUDGET.high;
    const at = world.player ? world.player.position.clone() : new THREE.Vector3();

    /* Far away: the ones the budget is allowed to spend. */
    for (let i = 0; i < budget * 3; i++) {
      const a = (i / (budget * 3)) * Math.PI * 2;
      const p = new THREE.Vector3(at.x + Math.cos(a) * 30, at.y + 1, at.z + Math.sin(a) * 30);
      dropSaber(world, { position: p, colorIndex: 2, hiltStyle: 'Sentinel' });
    }
    /* …and one the PLAYER put down, forty metres away, which must never be
     * one of them however little it is worth by distance. */
    const mine = dropSaber(world, {
      position: new THREE.Vector3(at.x, at.y + 1, at.z + 40),
      colorIndex: 4, hiltStyle: 'Sentinel', owner: world.player,
    });
    assert(mine, 'no hilt was dropped, so this check measures nothing');

    const count = () => world.props.filter((p) => p.saber && !p.dead).length;
    const before = count();
    assert(before > budget, `only ${before} hilts were dropped against a budget of ${budget}`);
    drive(world, 6, input);
    const after = count();
    assert(after <= budget,
      `${after} hilts are still on the floor against a budget of ${budget} — nothing bounds them`);
    assert(!mine.dead,
      'the hilt the player put down themselves was spent; a weapon you mean to come back for '
      + 'must not evaporate because you walked away from it');

    /* The tiers are ordered and every one of them keeps something. */
    const tiers = ['low', 'medium', 'high', 'ultra'];
    for (let i = 1; i < tiers.length; i++) {
      assert(HILT_BUDGET[tiers[i]] > HILT_BUDGET[tiers[i - 1]],
        `the ${tiers[i]} tier does not keep more hilts than ${tiers[i - 1]}`);
    }
    assert(HILT_BUDGET.low >= 3,
      'the lowest tier keeps so few that a duel leaves nothing on the floor');
    world.dispose?.();
    return `${before} hilts dropped → ${after} kept at a budget of ${budget}, and the player's own survived; `
      + `tiers ${tiers.map((t) => HILT_BUDGET[t]).join('/')}`;
  });

  check('undertaker: a hilt somebody is holding is never spent', async () => {
    /**
     * The Force can hold a hilt across the field — `Player._grippedHilt` reads
     * it off `gripBody.userData.prop` — and a budget that took one out of the
     * air mid-pull would be the same broken promise from further away. It is
     * also the one case where a hilt is legitimately far from everybody.
     */
    const { dropSaber, HILT_BUDGET } = await import('../../src/game/Dropped.js');
    const { world } = await bootWorld({
      level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
    });
    const input = idleInput();
    const budget = HILT_BUDGET.low;
    const at = world.player ? world.player.position.clone() : new THREE.Vector3();
    let held = null;
    for (let i = 0; i < budget * 4; i++) {
      const a = (i / (budget * 4)) * Math.PI * 2;
      const p = new THREE.Vector3(at.x + Math.cos(a) * 34, at.y + 1, at.z + Math.sin(a) * 34);
      const h = dropSaber(world, { position: p, colorIndex: 1, hiltStyle: 'Sentinel' });
      if (i === 0) held = h;
    }
    assert(held, 'no hilt was dropped');
    /* Exactly the shape `_grippedHilt` reads, and nothing else. */
    world.player.gripBody = held.body;
    drive(world, 6, input);
    assert(!held.dead, 'the hilt the player had hold of was spent out from under them');
    world.player.gripBody = null;
    world.dispose?.();
    return 'a hilt in the Force survives a cull that spends the rest';
  });
}
