/**
 * RESTART WAVE — the pause card's second button, and what it used to cost.
 *
 * `index.html`'s `#btn-restart` → main.js's `onRestart` → `World.restartWave()`.
 * It is present on the pause card in every mode and at every moment; Menu only
 * hides it for a co-op CLIENT, which cannot own the horde. Two separate defects
 * lived on it, and both are measured here on a real World rather than read out
 * of the source:
 *
 *   · IT LEFT THE PREVIOUS WAVE IN THE AIR. `world.enemies` was emptied and
 *     `director.arrivals` — the flights and staging queues holding bodies that
 *     have been bought and are still inbound — was not, so the restarted wave
 *     fielded its own contacts AND the leftovers of the one just abandoned.
 *     Measured: announced 7, fielded 8 to 14.
 *
 *   · IT RE-PAID THE WAVE. `restartWave` hands the director the same wave
 *     number back, the clear signal fires again, and everything hanging off it
 *     — the draft, the Insight, the 500 × wave score, the party's heal — paid
 *     again, for as many times as the player pressed the button. Measured: ten
 *     restarts of wave 2 were worth +10 drafts, +8 boons, +20,400 score and
 *     +10 Insight with `director.wave` reading 2 throughout.
 *
 * These are slow on purpose. Waves are cleared by actually fighting them —
 * every body is killed through the real `Enemy.damage` path and the clear
 * signal is the director's own, instrumented with a pass-through counter rather
 * than inferred — because the first attempt at reproducing the second defect
 * measured ZERO by running 300 frames per restart and never letting the wave
 * finish spawning.
 *
 * Every module is reached by `await import` inside a check body: World.js
 * reaches Engine.js, which rewrites three's ShaderChunks behind once-only flags
 * as a module side effect, and a static edge from a check file patches the copy
 * of three that verify.mjs's own static graph resolved. See
 * tools/checks/materials.mjs.
 */

/** A world on the arena in the shipped default mode, with a seeded ladder. */
async function arena(seed) {
  const H = await import('./_coop.mjs');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { seedWaves } = await import('../../src/game/Waves.js');
  enemyRng.seed(seed);
  seedWaves(seed, 0);
  /* A DROPSHIP LEVEL, and it has to be one: this check watches `arrivals`
   * still have flights in the air at the moment of the restart, and a level
   * whose arrival is `gate` delivers without staging any. It used to be the
   * Sanctum, which flew them in; the Sanctum is deleted and the colosseum —
   * the obvious substitution — is a gate level, so it saw nothing inbound and
   * said so rather than passing quietly. That is the check working. Kamino
   * rather than the Ember Shelf because the Shelf is a DUELLING map with a
   * pool thinned of hordes — it composed one contact on wave 1 against the
   * seven this check's arithmetic is calibrated on. */
  const { world } = await H.bootWorld({ level: 'colosseum', settings: { mode: 'roguelite', difficulty: 'knight' } });
  return { world, input: H.idleInput() };
}

export async function run({ check, assert }) {
  check('restart: a restarted wave fields the number of bodies it announces', async () => {
    /**
     * `ArrivalDirector.clear()` already existed, already empties both queues,
     * and its own comment names "a wave reset, a level change, a run ending" as
     * the callers it is for. A wave reset was not one of them.
     *
     * The player is pinned unkillable and kills nothing, so the wave never
     * clears and the count is exactly "how many bodies this wave put on the
     * ground" with no second wave to confuse it.
     */
    const { world, input } = await arena(99);
    let fielded = 0, announced = 0;
    const realSpawn = world.spawnEnemy.bind(world);
    world.spawnEnemy = (...a) => { const e = realSpawn(...a); if (e) fielded++; return e; };
    world.director.onWaveStart = (w, n) => { announced = n; };

    const step = (seconds) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        world.player.hp = world.player.maxHp;
        world.update(1 / 60, input);
      }
    };
    world.director.start(1);
    step(5);
    const A = world.director.arrivals;
    const inbound = () => A.flights.filter((f) => !f.done).length + A.staging.length;
    const before = inbound();
    assert(before > 0,
      'nothing was inbound at the moment of the restart, so this check cannot see the defect — '
      + 'the arrival director is not delivering this wave');
    world.restartWave();
    const survived = inbound();
    fielded = 0;
    step(55);

    // The player-visible number first, then the mechanism under it — a failing
    // check should say what the player saw before it says why.
    assert(announced === 7, `the seeded wave 1 composed ${announced} contacts, not the 7 this check is calibrated on`);
    assert(fielded === announced,
      `the banner said ${announced} contacts and ${fielded} bodies walked out — the restarted wave is `
      + `${(fielded / announced).toFixed(2)}× the wave the director thinks it started`);
    const alive = world.enemies.filter((e) => !e.dead).length;
    assert(alive === announced, `${alive} bodies are standing against ${announced} announced`);
    assert(survived === 0,
      `${survived} of the ${before} bodies already in the air survived the restart — they walk out of `
      + 'the ships and gates of the wave the player just abandoned, on top of the wave they asked for');
    world.unload(); world.dispose?.();
    return `announced ${announced}, ${before} inbound dropped by the restart, ${fielded} fielded, ${alive} standing`;
  });

  check('restart: a wave pays out once, however many times it is re-fought', async () => {
    /**
     * The draft, the Insight, the 500 × wave score and the party's heal all
     * hang off the clear SIGNAL, which fires every time the last body falls.
     * `WaveDirector.payWave` is the ledger that turns that into once per WAVE.
     *
     * Drafts are answered exactly as main.js's `offerDraft` pick callback
     * answers them — `world.applyBoon(b)` on the first card — so a card offered
     * is a card taken, which is what makes the boon count meaningful.
     *
     * KILL SCORE IS NOT GATED AND IS NOT MEANT TO BE: the player really did
     * fight seven more bodies. It is also not a farm — a re-fought wave 2 pays
     * wave 2's bodies, while progressing pays deeper bodies AND the wave bonus,
     * so restarting is strictly worse score per minute than playing on. What is
     * asserted here is the WAVE payout, which is the part that was.
     */
    const { world, input } = await arena(9);
    let clears = 0, drafts = 0;
    const bonus = [];
    const realClear = world.director.onWaveClear;
    /* Score moves for two different reasons and only one of them is the wave's:
     * the bonus is whatever the clear handler itself adds, so it is measured
     * across the handler rather than inferred from a total the fight was also
     * adding to. */
    world.director.onWaveClear = (...a) => {
      clears++;
      const s0 = world.score;
      const r = realClear(...a);
      bonus.push(Math.round(world.score - s0));
      return r;
    };
    world.director.onDraft = (boons) => { drafts++; if (boons?.length) world.applyBoon(boons[0]); };
    world.director.start(1);

    const step = () => {
      world.player.hp = world.player.maxHp;
      world.player.force = world.player.maxForce;
      for (const e of world.enemies) if (!e.dead) e.damage(1e6, e.position.clone(), world.player, 'saber');
      world.update(1 / 60, input);
    };
    const toClear = (max = 5000) => {
      const c = clears;
      for (let i = 0; i < max; i++) { step(); if (clears > c) return true; }
      return false;
    };
    assert(toClear(), 'wave 1 never cleared — the scene is wrong, not the ledger');
    world.director.intermission = 0.01;            // skip the draft pause
    for (let i = 0; i < 3; i++) step();
    assert(toClear(), 'wave 2 never cleared — the scene is wrong, not the ledger');

    const base = { drafts, boons: world.takenBoons.size, score: Math.round(world.score),
      insight: world.communion.insight, wave: world.director.wave, hp: world.player.maxHp };
    assert(base.drafts === 1, `wave 2 offered ${base.drafts} draft(s) legitimately, not the 1 this check is calibrated on`);
    assert(base.insight > 0, 'no Insight was earned at all — the ledger is not wired to the clear');

    const N = 3;
    for (let i = 0; i < N; i++) {
      assert(world.restartWave(), 'restartWave declined on a solo world');
      assert(toClear(), `the restarted wave ${i + 1} never re-cleared`);
    }
    assert(clears === 2 + N, `${clears} clears fired for ${2 + N} cleared waves — the counter is wrong`);
    assert(world.director.wave === base.wave,
      `the wave counter moved from ${base.wave} to ${world.director.wave} across ${N} restarts`);
    assert(drafts === base.drafts,
      `${N} restarts of wave ${base.wave} were worth ${drafts - base.drafts} extra draft(s) — a player who `
      + 'muffed the opening of a wave is handed another card for it, as often as they like');
    assert(world.takenBoons.size === base.boons,
      `${world.takenBoons.size - base.boons} extra boon(s) came out of ${N} restarts of one wave`);
    assert(world.communion.insight === base.insight,
      `${(world.communion.insight - base.insight).toFixed(1)} extra Insight came out of ${N} restarts — `
      + 'World.js says surviving a wave is the only thing that earns it and there is nothing here to farm');
    assert(world.player.maxHp === base.hp, 'a restart moved max health');
    // The 500 × wave bonus, isolated from the kill score the player did earn.
    assert(bonus[0] > 0 && bonus[1] > 0,
      `waves 1 and 2 paid ${bonus[0]} and ${bonus[1]} clear bonus — the scene is wrong, not the ledger`);
    const repaid = bonus.slice(2).filter((b) => b !== 0);
    assert(!repaid.length,
      `the same wave paid its clear bonus again on ${repaid.length} of ${N} restarts (${repaid.join(', ')}) — `
      + `${bonus.join(' / ')} across ${clears} clears of ${base.wave} waves`);
    world.unload(); world.dispose?.();
    return `wave ${base.wave} cleared ${1 + N} times: drafts ${base.drafts}→${drafts}, boons `
      + `${base.boons}→${world.takenBoons.size}, Insight ${base.insight.toFixed(1)}→`
      + `${world.communion.insight.toFixed(1)}, clear bonus ${bonus.join('/')}`;
  });

  check('restart: a host who restarts does not pay every peer a second time', async () => {
    /**
     * A client has no director of its own — main.js only calls `director.start`
     * when `netMode !== 'client'` — so everything a wave is worth reaches a
     * joining player through `_netWaveEdge`, which reads the snapshot's `w` and
     * `act` as an EDGE. A host pressing Restart Wave leaves `act` at 1 and `w`
     * unchanged, so the restart itself raises no edge at all; the re-clear that
     * follows raises a falling one, and every peer was paid again for a wave
     * they had already been paid for.
     *
     * Driven through the real `applySnapshot` with hand-built snapshots rather
     * than a second live World, because what is under test is the EDGE and the
     * two edges have to be identical for the ledger to be the only thing that
     * separates them. `w` is the host's run-wide `director.wave`, which is what
     * `packSnapshot` puts on the wire.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'colosseum', settings: { mode: 'roguelite', difficulty: 'knight' } });
    world.attachNet({ connected: true, isHost: false, name: 'PEER', roster: [],
      broadcast() {}, toPeer() {}, toHost() {} }, 'client');
    let cleared = 0;
    const realClear = world.director.onWaveClear;
    world.director.onWaveClear = (...a) => { cleared++; return realClear(...a); };

    const snap = (w, act) => ({ t: 'snapshot', e: [], bf: [], w, act, rem: 0, ic: 0, sc: 0 });
    const cycle = (w) => { world.applySnapshot(snap(w, 1)); world.applySnapshot(snap(w, 0)); };

    cycle(1);
    const first = { insight: world.communion.insight, hp: world.player.hp, flow: world.player.flow };
    assert(cleared === 1, `the client read ${cleared} wave-clear edges from one wave`);
    assert(first.insight > 0, 'a joining player earned no Insight from a wave the host cleared');

    // The host restarts wave 1 and clears it again: same `w`, another edge.
    world.player.hp = Math.max(1, world.player.hp - 30);
    const hpBefore = world.player.hp;
    cycle(1);
    assert(cleared === 2, 'the second falling edge was not read at all');
    assert(world.communion.insight === first.insight,
      `the host re-cleared wave 1 and every peer earned another `
      + `${(world.communion.insight - first.insight).toFixed(1)} Insight for it`);
    assert(world.player.hp === hpBefore,
      `a re-cleared wave healed the joining player another ${(world.player.hp - hpBefore).toFixed(1)} hp`);

    // …and wave 2 still pays, so the ledger has not simply switched the wire off.
    cycle(2);
    assert(world.communion.insight > first.insight,
      'the client stopped earning Insight altogether — the ledger is refusing waves it has not been paid for');
    world.unload(); world.dispose?.();
    return `edges read ${cleared + 1}, waves paid 2: Insight ${first.insight.toFixed(1)} → `
      + `${world.communion.insight.toFixed(1)} across a host restart`;
  });
}
