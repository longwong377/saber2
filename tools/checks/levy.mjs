/**
 * BATTLEFRONT BORZ — THE LEVY, AND WHAT IT COSTS THE FRAME. FLAGSHIP §6.
 *
 * "The lawnmower is only a lawnmower when mowing pays. Forty conscripts that
 * pay nothing are weather."
 *
 * `conscript.mjs` proves the BODY: 6 hp, one turned pass, 0.71 of a B1's gun,
 * and nothing at all paid for killing one. It also records, in its own words,
 * what was still missing — nothing fielded forty of them. This file is about
 * the forty, and it has two halves that are really one question:
 *
 *   THE FIELDING. A wave on the mode's own ground puts the mass on the field
 *     alongside the paying bodies, without buying it with them.
 *   THE FRAME. FLAGSHIP §4's whole architecture argument is that a cuttable
 *     body costs 26 draw calls at every distance forever, and §14's L2 and L3
 *     rungs exist to answer it. They have never been asked to carry a real
 *     mass — `frame-budget` §6 and §7 measure them on a BENCH of 42 bodies
 *     stood at a fixed radius with nobody moving. This measures the ladder
 *     under a wave that arrives, closes and dies.
 *
 * ── WHAT A DRAW CALL IS HERE, AND WHY THERE ARE NO MILLISECONDS IN THE BAND ─
 *
 * The same terms `frame-budget` states: one visible mesh in the graph is one
 * submission, `renderer.info` is unreachable because there is no GL in this
 * harness, and a millisecond on this box is a measurement of whoever else is
 * running (HANDOFF §2.6). The same scenario measured twice, on the same
 * commit, read a median step of 32.1 ms and then 13.6 ms — a factor of 2.4 on
 * nothing but load. So the millisecond figures below are taken as a RATIO
 * against a control built and stepped in the same process, minutes apart, and
 * the absolute numbers are reported and not asserted on.
 */

import { LEVY_STRENGTH, LEVY_TYPE, levySize } from '../../src/game/Levy.js';
import { clocked } from './_shared.mjs';

/** The rungs of the ladder, and what a body costs at each. See check 3. */
const LOD_BANDS = ['contact (<30 m)', 'L1 (30-62 m)', 'L2 (62-138 m)', 'L3 (past the ink)'];

export async function run({ check, assert }) {
  check = await clocked(check);

  check('levy: a wave on the mode\'s own ground fields forty conscripts', async () => {
    const Cmd = await import('../../src/game/Command.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const { seedWaves } = await import('../../src/game/Waves.js');
    const { spawnType } = await import('../../src/game/Waves.js');
    const L = LEVELS.geonosis;
    const stub = () => ({
      enemies: [], players: [], difficulty: null, takenBoons: new Set(), level: L,
      settings: { mode: 'command', level: 'geonosis', order: 'jedi' },
    });
    /* THE SHIPPED COMPOSER, at the depth the mode actually spends its time —
     * `AREAS` is five stages of three to five waves, so wave 3 is an ordinary
     * one rather than an opening. Seeded so the two arms below are the same
     * draw; `seedWaves` is the game's own re-seed and not a harness one. */
    seedWaves(20260821);
    const d = new Cmd.CommandDirector(stub(), { pool: L.pool, seed: 4242 });
    d.start(1);
    d.wave = 3;
    d._compose();
    const levy = d.spawnQueue.filter((e) => spawnType(e) === LEVY_TYPE).length;
    const paying = d.spawnQueue.length - levy;
    assert(levy >= LEVY_STRENGTH,
      `the mode's own ground composed ${levy} conscripts against §6's forty. A pool weight cannot `
      + 'do this — `conscript` is two of the eleven Confederate entries on geonosis, so the draw '
      + 'gives about two in a wave of fifteen, and two conscripts are a B1 that gave you nothing');
    assert(paying >= 5,
      `the wave is ${paying} paying bodies and ${levy} conscripts — the levy has eaten the wave it `
      + 'is supposed to be standing behind, which is the exact failure the levy being free of the '
      + 'threat budget exists to prevent');
    /* AND THE MASS CAN STAND. `shape.alive` is what `WaveDirector.update`
     * gates the field on; a levy queued behind a cap of 26 is a levy delivered
     * one body at a time for a minute, which is a queue and not weather. */
    assert(d.shape.alive >= levy + 20,
      `${levy} conscripts queued against a standing cap of ${d.shape.alive} — the mass would be fed `
      + 'in single file');
    return `wave 3 on geonosis: ${paying} paying + ${levy} conscripts, standing cap ${d.shape.alive}, `
      + `pace ×${d.shape.pace.toFixed(3)}`;
  });

  check('levy: it costs the wave nothing — the same rifles arrive, at the same rate', async () => {
    /**
     * THE LOAD-BEARING CLAIM OF THE WHOLE MECHANISM, TAKEN AS AN A/B.
     *
     * Forty conscripts at threat 0.5 is 20, against an Open Plain wave-4 budget
     * of about 30. Bought out of the wave, the levy would arrive by deleting
     * the paying bodies — so a levied wave would be strictly EASIER than an
     * unlevied one and the mass would be a discount rather than weather.
     *
     * Both arms are composed from the same re-seeded stream through the same
     * director class, with the levy suppressed in the control by overriding
     * the one method that applies it. The paying half of the queue must come
     * back IDENTICAL, entry for entry, and the surplus the wave could not
     * absorb — which is what buys extra conditions — must be unchanged.
     */
    const Cmd = await import('../../src/game/Command.js');
    const Waves = await import('../../src/game/Waves.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const L = LEVELS.geonosis;
    const stub = () => ({
      enemies: [], players: [], difficulty: null, takenBoons: new Set(), level: L,
      settings: { mode: 'command', level: 'geonosis', order: 'jedi' },
    });
    /**
     * THE CONTROL HAS TO SUPPRESS THE LEVY AND NOTHING ELSE, and the first
     * version of it did not.
     *
     * It replaced the whole override with the base class's method — which drops
     * every wrapper on that line, not just the levy. `applyArmour` was added
     * beside `applyLevy` after this check was written, so the control quietly
     * stopped fielding a walker the levied arm still fielded, and the A/B
     * reported the LEVY as having changed the wave. It had not: the diff was
     * one `walker`, and it was armour's.
     *
     * So the wrappers are read off the production method and re-applied, all of
     * them but the levy, innermost first. A third wrapper added tomorrow fails
     * the assertion by name instead of silently becoming part of the measured
     * difference.
     */
    const WRAPPERS = {
      applyArmour: (await import('../../src/game/Armour.js')).applyArmour,
      applyLevy: (await import('../../src/game/Levy.js')).applyLevy,
    };
    const src = Cmd.CommandDirector.prototype._composeUnder.toString();
    const used = [...src.matchAll(/\b(apply[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
    const unknown = used.filter((n) => !WRAPPERS[n]);
    assert(!unknown.length,
      `_composeUnder now calls ${unknown.join(', ')} and this control cannot suppress it — `
      + 'add it to WRAPPERS or the A/B measures that wrapper as well as the levy');
    assert(used.includes('applyLevy'), '_composeUnder no longer applies the levy at all');
    const arm = (levied) => {
      Waves.seedWaves(20260821);
      const d = new Cmd.CommandDirector(stub(), { pool: L.pool, seed: 4242 });
      if (!levied) {
        // source order is outermost-first, so re-apply in reverse
        const keep = used.slice().reverse().filter((n) => n !== 'applyLevy');
        d._composeUnder = (wave, keys) => keep.reduce(
          (out, n) => WRAPPERS[n](out, d, wave),
          Waves.WaveDirector.prototype._composeUnder.call(d, wave, keys));
      }
      d.start(1);
      d.wave = 5;
      d._compose();
      return {
        queue: d.spawnQueue.filter((e) => Waves.spawnType(e) !== LEVY_TYPE),
        all: d.spawnQueue.slice(),
        conditions: d.conditions.slice(),
        pace: d.shape.pace, alive: d.shape.alive,
      };
    };
    const off = arm(false), on = arm(true);
    assert(off.queue.length > 0, 'the control wave composed nothing, so nothing below means anything');
    assert(on.queue.join(',') === off.queue.join(','),
      'the levy changed the wave it was added to.\n'
      + `  without  ${off.queue.join(' ')}\n  with     ${on.queue.join(' ')}\n`
      + 'A levy bought out of the threat budget deletes the rifles it is meant to stand behind, '
      + 'and a levied wave becomes the easier wave.');
    assert(on.conditions.join(',') === off.conditions.join(','),
      `the levy changed the wave's conditions (${off.conditions.join(',')} → ${on.conditions.join(',')})`);
    /**
     * …AND THE RATE, which is the half a queue length cannot show. `update`
     * feeds one entry per `spawnTimer` and does not care what the entry is, so
     * appending forty conscripts to a fifteen-body wave quarters the rate the
     * RIFLES arrive at. The pace correction is `paying / (paying + levy)`, so
     * the product below — entries × pace — is what the shipped timer turns into
     * "how long until the next paying body", and it must not move.
     */
    const rateOff = off.all.length * off.pace;
    const rateOn = on.all.length * on.pace * (off.queue.length / on.queue.length);
    assert(Math.abs(rateOn - rateOff) < 0.5,
      `the paying bodies arrive at a different cadence with the levy: ${rateOff.toFixed(2)} against `
      + `${rateOn.toFixed(2)} entry-intervals. The levy is allowed to make the wave bigger and not `
      + 'to make it slower — that would be a difficulty change smuggled in beside a crowd.');
    return `wave 5, ${off.queue.length} paying bodies identical either way; levy adds `
      + `${on.all.length - on.queue.length} · pace ${off.pace.toFixed(2)} → ${on.pace.toFixed(2)} · `
      + `standing cap ${off.alive} → ${on.alive}`;
  });

  check('levy: forty on a real field, and what the LOD ladder makes them cost', async () => {
    /**
     * THE FRAME, MEASURED THROUGH THE SHIPPED PATH ON A REAL WORLD.
     *
     * Two arms in ONE process, one after the other, on the same ground at the
     * same quality with the same seed and the camera on the player's own eye:
     * a Command engagement with the levy suppressed, and the same engagement
     * with it. Everything else — the composer, the arrivals, the LOD ladder,
     * the allies — is the shipped one.
     *
     * WHAT THE LADDER IS WORTH, and it is the number this check exists for. A
     * body's cost in visible meshes is a clean function of its rung, measured
     * on this ground with the shipped `_applyLod`:
     *
     *     conscript   45 · 23 · 4 · 0     at 12 m · 45 m · 90 m · 170 m
     *     b1          45 · 23 · 4 · 0     — the same four numbers exactly
     *     trooper     47 · 26 · 4 · 0
     *
     * So forty conscripts standing ON you is 1 800 calls and NO rung helps: L2
     * does not begin until 62 m. That is the ceiling, and it is not what a levy
     * costs, because a levy arrives from a 58-96 m ring and dies on the way in.
     * The assertion below is on the SHAPE of the answer rather than on a
     * constant: the mass must cost materially less per body than a contact body
     * does, or the ladder is not carrying it and forty is not affordable.
     */
    const Rapier = await import('../../src/physics/Rapier.js');
    await Rapier.initPhysics();
    const { bootWorld } = await import('./_coop.mjs');
    const Waves = await import('../../src/game/Waves.js');
    const { enemyRng } = await import('../../src/game/Enemy.js');

    const idle = () => ({
      act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
    });
    const meshes = (w) => {
      let n = 0;
      for (const e of w.enemies) (e.rig?.root || e.group)?.traverseVisible((o) => { if (o.isMesh) n++; });
      return n;
    };

    /** One arm: build, run `secs` game-seconds, report the worst frame it saw. */
    const arm = async (levied, secs) => {
      enemyRng.seed(20260821);
      Waves.seedWaves(20260821);
      const { world, engine } = await bootWorld({
        level: 'geonosis',
        settings: { quality: 'high', mode: 'command', level: 'geonosis' },
      });
      try {
        const d = world.director;
        if (!levied) d._composeUnder = Waves.WaveDirector.prototype._composeUnder.bind(d);
        d.start(1);
        d.wave = 3; d._compose();
        const p = world.player, cam = engine.camera, input = idle();
        let peak = 0, peakN = 0, peakLod = null, bodies = 0;
        const step = [];
        for (let s = 0; s < secs; s++) {
          for (let f = 0; f < 60; f++) {
            /* THE CAMERA IS THE PLAYER'S EYE, every frame. `Enemy._applyLod`
             * reads its distance off the camera, so a reading taken with the
             * camera left at the origin is a reading of a rung that never
             * engaged. */
            cam.position.set(p.position.x, p.position.y + 1.6, p.position.z);
            cam.lookAt(p.position.x, p.position.y + 1.6, p.position.z + 1);
            cam.updateMatrixWorld(true);
            const t = process.hrtime.bigint();
            world.update(1 / 60, input);
            step.push(Number(process.hrtime.bigint() - t) / 1e6);
          }
          const m = meshes(world);
          if (m > peak) {
            peak = m; peakN = world.enemies.length;
            peakLod = [0, 0, 0, 0];
            for (const e of world.enemies) peakLod[e.lod | 0]++;
          }
          bodies = Math.max(bodies, world.enemies.length);
        }
        step.sort((a, b) => a - b);
        return { peak, peakN, peakLod, bodies, med: step[step.length >> 1] };
      } finally { world.unload?.(); world.dispose?.(); }
    };

    const SECS = 50;
    const off = await arm(false, SECS);
    const on = await arm(true, SECS);

    assert(on.bodies - off.bodies >= LEVY_STRENGTH * 0.6,
      `the levied run held ${on.bodies} bodies at most against the control's ${off.bodies} — the `
      + 'mass never reached the field, so the frame reading below is of a wave that did not happen');
    assert(on.peak > off.peak,
      'forty more bodies cost no more draw calls than none, which cannot be true and means the '
      + 'count is not counting');
    const extra = on.peak - off.peak;
    const extraBodies = on.peakN - off.peakN;
    const perBody = extra / Math.max(1, extraBodies);
    /* THE LADDER IS DOING ITS JOB OR IT IS NOT. A contact body is 45 meshes on
     * this ground (measured above, and `frame-budget` §6 owns the rung); if the
     * mass costs anything like that per body then every conscript is standing
     * inside 30 m and no rung is engaged. Asked as a ratio to the contact cost
     * rather than to a transcribed number, so a body that gets cheaper or
     * dearer moves both sides. */
    assert(perBody < 34,
      `each extra body cost ${perBody.toFixed(1)} draw calls — a contact body is about 45 on this `
      + 'ground, so the mass is standing inside the L2 cut and the ladder built for exactly this '
      + 'moment is not engaging. Forty at that price is 1 800 calls of weather.');
    assert(on.peakLod[1] + on.peakLod[2] + on.peakLod[3] > 0,
      'every body on the field at the worst frame was at contact range — the reading is of a '
      + 'pile-up rather than of a wave crossing ground');
    return `${SECS}s of Command on geonosis at high, camera on the player: `
      + `control peak ${off.peak} body draw calls at ${off.peakN} bodies · `
      + `levied peak ${on.peak} at ${on.peakN} (${on.peakLod.map((n, i) => `${n} ${LOD_BANDS[i]}`).join(', ')}) `
      + `→ +${extra} calls for +${extraBodies} bodies, ${perBody.toFixed(1)} a body against 45 at `
      + `contact. Step ${off.med.toFixed(1)} ms → ${on.med.toFixed(1)} ms median `
      + `(×${(on.med / off.med).toFixed(2)}; absolute ms is this box, see the header)`;
  });

  check('levy: the weather does not have to be mowed — it breaks when the rifles are gone', async () => {
    /**
     * THE DEFECT THE FIRST FIELDING HAD, KEPT AS A CHECK BECAUSE IT IS THE
     * WHOLE DESIGN INVERTED.
     *
     * `blocksWaveEnd` is "not dead and not on your team", so a conscript gates
     * a wave exactly as a B1 does. Measured before the break rule, on a real
     * Command world at wave 3 with an idle player: the control wave cleared at
     * s72 and the levied one was still open at s90 with 26 conscripts standing.
     * §6's sentence is that mowing does not pay; a levy that gates the wave
     * makes mowing COMPULSORY, which is the one mechanic meant to stop the
     * lawnmower handing the player the lawnmower.
     *
     * So the levy breaks when the last paying body is down and nothing is still
     * coming. Driven here by killing the paying bodies outright — the player's
     * own skill is not what is being measured — and asserting that the field
     * empties without anybody killing the conscripts.
     */
    const Rapier = await import('../../src/physics/Rapier.js');
    await Rapier.initPhysics();
    const { bootWorld } = await import('./_coop.mjs');
    const { paysOut } = await import('../../src/game/World.js');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    const Waves = await import('../../src/game/Waves.js');
    enemyRng.seed(20260821); Waves.seedWaves(20260821);
    const { world } = await bootWorld({
      level: 'geonosis', settings: { mode: 'command', level: 'geonosis' } });
    try {
      const d = world.director;
      const input = {
        act: () => false, actHit: () => false, actDown: () => false,
        moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
        mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
        delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
      };
      d.start(1);
      d.wave = 3; d._compose();
      /* Let the mass reach the field before anything is killed, or the break
       * fires against an empty field and proves nothing. */
      for (let f = 0; f < 60 * 25; f++) world.update(1 / 60, input);
      const standing = world.enemies.filter((e) => d.blocksWaveEnd(e));
      const levy = standing.filter((e) => !paysOut(e.A));
      assert(levy.length >= 12,
        `only ${levy.length} conscripts had reached the field after 25 s — nothing to break`);
      /* THE RIFLES, TAKEN OFF THE FIELD BY THE DIRECTOR'S OWN PATH. Anything
       * still queued goes too: what is being tested is what happens once the
       * paying half of a wave is finished, however it finished. */
      const { ARCHETYPES } = await import('../../src/game/Enemy.js');
      d.spawnQueue = d.spawnQueue.filter((e) => !paysOut(ARCHETYPES[Waves.spawnType(e)]));
      for (const e of standing) {
        if (!paysOut(e.A)) continue;
        e.dead = true; e.dying = 0;
        world.onEnemyKilled?.(e, world.player, 'cut');
      }
      const before = world.enemies.filter((e) => d.blocksWaveEnd(e)).length;
      /**
       * SAMPLED EVERY SECOND, AND THE FLOOR IS WHAT IS ASSERTED — because the
       * field does not stay empty. Measured on the first run of this check: the
       * wave cleared and the assertion "no conscripts are on the field" failed
       * with ONE, which was a wave-4 conscript. Clearing a wave composes the
       * next one on the same frame and the next one has a levy of its own, so
       * "the field is empty now" is a question about the following wave. What
       * the break has to be shown to do is take the levy to nothing at least
       * once, without anybody killing one.
       */
      let cleared = -1, floor = before;
      for (let s = 0; s < 40 && cleared < 0; s++) {
        for (let f = 0; f < 60; f++) {
          world.update(1 / 60, input);
          const n = world.enemies.reduce(
            (a, e) => a + (d.blocksWaveEnd(e) && !paysOut(e.A) ? 1 : 0), 0);
          if (n < floor) floor = n;
          if (d.wave > 3 && cleared < 0) cleared = s + 1;
        }
      }
      assert(cleared > 0,
        `${before} conscripts were left standing when the last rifle fell and the wave never `
        + `cleared in 40 s (${floor} was the fewest that stood). The player has to mow the weather `
        + 'to make progress, which is §6 exactly backwards');
      assert(floor === 0,
        `the levy never went below ${floor} bodies — it did not break, the wave ended some other way`);
      return `${before} conscripts standing when the last paying body fell; the levy broke and the `
        + `field was clear ${cleared} s later, with nobody having killed one`;
    } finally { world.unload?.(); world.dispose?.(); }
  });
}
