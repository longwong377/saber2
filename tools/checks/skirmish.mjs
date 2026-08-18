/**
 * BATTLEFRONT BORZ — SKIRMISH, and the GROUND A RUN WALKS.
 *
 * Two player notes, and they turned out to be one system:
 *
 *   #46 "a mode where you pick the map, the sides, the army sizes and the rules,
 *       and fight a self-contained battle that ends in a win or a loss — as
 *       opposed to the endless wave survival that exists now."
 *   #48 "between rounds the map should change rather than fighting on the same
 *       ground forever."
 *
 * A battle with rounds is the thing that has somewhere to put a rotation, and a
 * rotation is what stops a bounded battle being one long wave on one field. So
 * `MODES.skirmish`, `Levels.levelRotation` and `World.rotateTo` are checked
 * together here.
 *
 * THE HALF THAT MATTERS MOST IS THE LEVEL SWAP, and it is not the feature — it
 * is the thing the feature stands on. `unload()` disposes every player and
 * `_loadSteps` rebuilds `takenBoons` and the Insight ledger from nothing, both
 * correctly; the promise that something puts the run back was a doc comment on
 * `loadLevel` (`@param opts.run`) with no reader anywhere in the file, and a
 * paragraph in `spawnPlayer` headed "AND THEN THE RUN" with no statement under
 * it. A rotation built on top of that loses the whole build in silence. The
 * first four checks below are the ones that would have caught it, and they
 * measure a plain `loadLevel` alongside a `rotateTo` so the difference is a
 * number rather than a claim.
 *
 * Every module is reached by `await import` inside a check body, for the reason
 * tools/checks/materials.mjs gives: a static edge from a check file to
 * Engine.js burns its once-only ShaderChunk flags against the wrong copy of
 * three.
 */

/** A world in a stated mode, with every stochastic stream on a stated number. */
async function boot(settings, level = 'colosseum', seed = 31) {
  const H = await import('./_coop.mjs');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { seedWaves } = await import('../../src/game/Waves.js');
  enemyRng.seed(seed);
  seedWaves(seed, 0);
  const { world } = await H.bootWorld({ level, settings: { quality: 'low', difficulty: 'knight', ...settings } });
  world.runSeed = seed;
  return { world, input: H.idleInput(), H };
}

/** Everything about a run that is not the level, read off a live World. */
function fingerprint(world) {
  const p = world.player;
  return {
    ranks: world.takenBoons.ranks,
    cards: world.takenBoons.size,
    vaapad: world.takenBoons.rank('vaapad'),
    insight: +(world.communion?.insight ?? 0).toFixed(3),
    bought: world.communion?.bought.length ?? 0,
    deflect: +(p?.boonMods?.deflectDamage ?? 0).toFixed(4),
    score: world.score,
    kills: p?.kills ?? 0,
    wave: world.director?.wave ?? 0,
  };
}

/** Four ranks of three cards, two Insight, a score and a tally. */
async function buildARun(world) {
  const { boonById } = await import('../../src/game/Waves.js');
  for (const id of ['vaapad', 'soresu', 'vaapad', 'ataru']) {
    const b = boonById(id);
    world.takenBoons.take(id);
    world.player.applyBoon(b);
  }
  world.communion.earn(3);
  world.communion.earn(4);
  world.communion.bought.push('vaapad');
  world.score = 1234;
  world.player.kills = 9;
  world.director.wave = 6;
  return fingerprint(world);
}

export async function run({ check, assert }) {

  /* ══ the level swap ═══════════════════════════════════════════════ */

  check('rotation: the ground changing is announced to the session, not only survived', async () => {
    /**
     * A ground change is HOST-ONLY by construction — `_groundPending` is set by
     * `_advanceMission` and `_skirmishCleared`, and a client's director never
     * runs — so nothing rotated a client and nothing told one. Both machines
     * stayed up and neither said anything: the host rebuilt on the next
     * mission's ground and went on broadcasting snapshots in its own absolute
     * coordinates, and the client kept applying them to the OLD terrain. That
     * is the failure main.js's `start` handler documents in full — every body
     * arrives, some buried in the client's hills and some hanging in its air,
     * and the level's hazards exist on one machine only.
     *
     * `start` is already the message for "the session is now on this ground";
     * it was sent once, at deploy, and never again. Asserted on the WIRE rather
     * than on the handler, because the handler is main.js's and the thing that
     * was missing is the send.
     */
    const { world } = await boot({ mode: 'roguelite' });
    const sent = [];
    world.attachNet({ connected: true, isHost: true, sweep() {}, toPeer() {}, toHost() {},
      broadcast: (m) => sent.push(m) }, 'host');
    world.rotateTo('drifts');
    const starts = sent.filter((m) => m.t === 'start');
    assert(starts.length === 1,
      `a host rotated to another level and put ${starts.length} 'start' messages on the wire — a `
      + "client is still standing on the old ground, applying the host's coordinates to it");
    assert(starts[0].level === world.levelKey,
      `the host announced '${starts[0].level}' and is standing on '${world.levelKey}' — a key that `
      + 'missed and fell back must not be the key every client falls back from independently');
    assert(starts[0].mode === world.settings.mode,
      `the announcement carries mode '${starts[0].mode}' against the session's '${world.settings.mode}'`);

    /* …AND A CLIENT DOES NOT ANNOUNCE ONE. A client rotates only because it was
     * told to, and a client that echoed the message would rotate the host. */
    const { world: c } = await boot({ mode: 'roguelite' });
    const cSent = [];
    c.attachNet({ connected: true, isHost: false, sweep() {}, toPeer() {}, toHost() {},
      broadcast: (m) => cSent.push(m) }, 'client');
    c.rotateTo('drifts');
    assert(cSent.filter((m) => m.t === 'start').length === 0,
      'a client announced a ground change of its own — the host is the only node that decides one');

    /* …and a solo world has nobody to tell and must not crash trying. */
    const { world: solo } = await boot({ mode: 'roguelite' });
    solo.rotateTo('drifts');
    assert(solo.levelKey === 'drifts', 'a solo rotation did not arrive');
    return `host announced ${starts[0].level}/${starts[0].mode} once; client silent; solo unaffected`;
  });

  check('rotation: a plain level change loses the whole run, and rotateTo does not', async () => {
    const { world } = await boot({ mode: 'roguelite' });
    const before = await buildARun(world);
    world.loadLevel('drifts');
    world.spawnPlayer({ name: 'Jedi', isLocal: true });
    const plain = fingerprint(world);

    const { world: w2 } = await boot({ mode: 'roguelite' });
    await buildARun(w2);
    w2.rotateTo('drifts');
    const kept = fingerprint(w2);

    /* The FIRST half of this check is the defect, stated as a measurement so it
     * cannot quietly come back: `loadLevel` is allowed to lose all of this and
     * always has, which is why the carry is a separate call and not a flag. */
    assert(before.ranks === 4 && before.cards === 3 && before.vaapad === 2, 'the fixture did not build a run');
    assert(plain.ranks === 0 && plain.insight === 0 && plain.kills === 0,
      `a plain loadLevel kept something it has no way to keep: ${JSON.stringify(plain)}`);
    assert(plain.deflect === 1, `deflectDamage survived a plain load at ${plain.deflect}`);

    for (const k of ['ranks', 'cards', 'vaapad', 'insight', 'bought', 'deflect', 'score', 'kills']) {
      assert(kept[k] === before[k], `rotateTo lost ${k}: ${before[k]} -> ${kept[k]}`);
    }
    /* The wave ADVANCES rather than being preserved: a new ground is the next
     * wave of the same run, and `start(1)` on each is the sawtooth
     * `WaveDirector.floor` was written for. */
    assert(kept.wave === before.wave + 1, `the escalation restarted: wave ${before.wave} -> ${kept.wave}`);
    assert(w2.levelKey === 'drifts' && w2.running && w2.director.active, 'the world did not come back up');
    /* …AND A GROUND CHANGE IS NOT A HEAL. A respawned Player is at full
     * everything, so the cheapest way to top up in any rotating mode would be
     * to clear a wave. Carried as a fraction of a maximum that is re-derived on
     * the far side; see `runCarry`. */
    const { world: hurt } = await boot({ mode: 'roguelite' });
    hurt.player.hp = hurt.player.maxHp * 0.4;
    hurt.player.force = hurt.player.maxForce * 0.25;
    hurt.rotateTo('alpine');
    const frac = hurt.player.hp / hurt.player.maxHp;
    assert(Math.abs(frac - 0.4) < 0.02, `a ground change healed the player from 40% to ${(frac * 100).toFixed(0)}%`);
    assert(Math.abs(hurt.player.force / hurt.player.maxForce - 0.25) < 0.02, 'a ground change refilled the Force');
    return `plain load ${before.ranks}→0 ranks, ${before.deflect}→${plain.deflect} deflect; `
      + `rotateTo keeps all 8 fields, wave ${before.wave}→${kept.wave}, and 40% health stays 40%`;
  });

  check('rotation: a rank-3 card crosses as rank 3, which the Set iterator cannot do', async () => {
    /**
     * `RankSet extends Set`, so `[...taken]` yields each id ONCE however many
     * ranks are held. A carry written the obvious way flattens every card in
     * the build to rank 1 and nothing throws — which is why `flat()` exists and
     * why this is its own check rather than a line in the one above.
     */
    const { RankSet } = await import('../../src/game/Waves.js');
    const s = new RankSet(['vaapad', 'vaapad', 'vaapad', 'soresu']);
    assert(s.rank('vaapad') === 3, 'the fixture is not rank 3');
    assert([...s].length === 2, 'a RankSet stopped being a Set');
    assert(new RankSet([...s]).rank('vaapad') === 1, 'the Set iterator no longer loses ranks — rewrite this check');
    const copy = new RankSet(s.flat());
    assert(copy.rank('vaapad') === 3 && copy.rank('soresu') === 1 && copy.ranks === s.ranks,
      `flat() did not round-trip: ${JSON.stringify(s.flat())}`);
    return `flat() round-trips 4 ranks of 2 cards; the Set iterator returns ${[...s].length} and loses 2`;
  });

  check('rotation: a ground change frees what it built, over two full laps', async () => {
    /**
     * The teardown is the place a feature like this usually dies, so it is
     * measured rather than trusted: two laps of the whole roster through the
     * ordinary door, comparing each level against ITSELF on the second lap. A
     * leak shows as monotone growth in scene nodes, statics, props or bodies
     * for the same level built twice.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
      const { world, input } = await boot({ mode: 'roguelite' });
      const seen = new Map();
      let worst = null;
      for (let lap = 0; lap < 2; lap++) {
        for (const key of LEVEL_ORDER) {
          world.rotateTo(key);
          for (let i = 0; i < 20; i++) world.update(1 / 60, input);
          let nodes = 0;
          world.scene.traverse(() => nodes++);
          const now = { statics: world.statics.length, props: world.props.length,
                        doors: world.doors.length, lights: world.levelLights.length,
                        players: world.players.length };
          const was = seen.get(key);
          if (was) {
            for (const k of Object.keys(now)) {
              const d = now[k] - was[k];
              if (d > 0 && (!worst || d > worst.d)) worst = { key, k, d, was: was[k], now: now[k] };
            }
          } else seen.set(key, now);
        }
      }
      assert(!worst, `${worst?.key} grew ${worst?.k} ${worst?.was} → ${worst?.now} on the second lap`);
      assert(world.players.length === 1, `${world.players.length} players after 14 ground changes`);
      return `${LEVEL_ORDER.length} grounds × 2 laps, nothing grew between laps`;
    } finally { S.restoreShared(snap); }
  });

  check('rotation: the departed level leaves no state behind on the World', async () => {
    /**
     * The fields the constructor sets that `unload()` never mentioned. Each was
     * harmless while a level change only ever happened between two fresh
     * Worlds; each is a real fault the moment a run rotates mid-fight. Set them
     * all to something a level change must not carry, then rotate.
     */
    const { world } = await boot({ mode: 'roguelite' });
    world.focus.held = 0.8; world.focus.active = true; world.focus.passive = 0.5;
    world.hitstop = 0.4;
    world.setTimeScale(0.3);
    world.combatIntensity = 0.9;
    world._bossFrame = 2.0;
    world._targets.push({ id: 1, capsules: [], enemy: {}, dead: false });
    world._capsCache.push({});
    world.match = { over: false, phase: 'fight' };
    world.rotateTo('drifts');
    assert(world.focus.held === 0 && !world.focus.active, `Focus survived at ${world.focus.held}`);
    assert(world.hitstop === 0, `hitstop survived at ${world.hitstop}`);
    assert(world.targetTimeScale === 1, `the time-scale target survived at ${world.targetTimeScale}`);
    assert(world.combatIntensity === 0, 'combat intensity survived');
    assert(world._bossFrame === 0, 'the boss letterbox timer survived');
    assert(world._targets.length === 0 && world._capsCache.length === 0,
      'the blade solver caches still point at bodies from the last level');
    assert(world.match === null, 'a finished match survived onto the next ground');
    assert(world.paused === false && world.running === true && world.over === false, 'the world came back up wrong');
    return '8 carried-over fields cleared by unload()';
  });

  /* ══ the rotation itself ══════════════════════════════════════════ */

  check('rotation: it is derived from LEVEL_ORDER and reproducible from the seed', async () => {
    const { LEVELS, LEVEL_ORDER, levelRotation } = await import('../../src/game/Levels.js');
    const a = levelRotation(90210, { length: 12 });
    const b = levelRotation(90210, { length: 12 });
    assert(a.join() === b.join(), 'the same seed laid out two different runs');
    assert(levelRotation(90211, { length: 12 }).join() !== a.join(), 'the seed does not move the rotation');
    assert(a.length === 12, `asked for 12 rounds, got ${a.length}`);
    for (const k of a) assert(LEVELS[k], `${k} is not a level`);
    // Derived, not typed: nothing outside LEVEL_ORDER can appear, and a dead
    // key handed in as a pool is dropped rather than trusted.
    for (const k of a) assert(LEVEL_ORDER.includes(k), `${k} is not in LEVEL_ORDER`);
    const dirty = levelRotation(7, { pool: [...LEVEL_ORDER, 'kamino', 'foundry'], length: 20 });
    assert(!dirty.includes('kamino') && !dirty.includes('foundry'), 'a deleted level reached the rotation');
    assert(levelRotation(7, { pool: ['nope'], length: 4 }).length === 0, 'a pool of nothing produced a rotation');
    return `12 rounds reproducible from one number, drawn only from ${LEVEL_ORDER.length} shipped grounds`;
  });

  check('rotation: no two rounds running on one ground, and every ground before any twice', async () => {
    const { LEVEL_ORDER, levelRotation } = await import('../../src/game/Levels.js');
    const N = LEVEL_ORDER.length;
    let repeats = 0, incomplete = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const r = levelRotation(seed, { length: N * 2 });
      for (let i = 1; i < r.length; i++) if (r[i] === r[i - 1]) repeats++;
      // Each lap of N rounds must be a permutation of the roster.
      for (let lap = 0; lap < 2; lap++) {
        if (new Set(r.slice(lap * N, lap * N + N)).size !== N) incomplete++;
      }
    }
    assert(repeats === 0, `${repeats} back-to-back repeats over 600 seeds — the bag boundary is not covered`);
    assert(incomplete === 0, `${incomplete} laps of ${N} did not visit every ground`);
    return `600 seeds × ${N * 2} rounds: 0 immediate repeats, every lap a full permutation`;
  });

  check("rotation: the player's chosen ground is round one", async () => {
    const { LEVEL_ORDER, levelRotation } = await import('../../src/game/Levels.js');
    for (const key of LEVEL_ORDER) {
      const r = levelRotation(5150, { length: 9, first: key });
      assert(r[0] === key, `pinned ${key} and got ${r[0]}`);
      // …and it is MOVED into the first bag rather than prepended to it, so the
      // opening ground is not also drawn again a round or two later.
      assert(r.slice(1, LEVEL_ORDER.length).indexOf(key) === -1,
        `${key} was drawn twice inside the first lap`);
    }
    const loose = levelRotation(5150, { length: 4, first: 'kamino' });
    assert(loose.length === 4 && !loose.includes('kamino'), 'a dead level was pinned to round one');
    return `all ${LEVEL_ORDER.length} grounds pin to round one; a deleted key falls back to the shuffle`;
  });

  /* ══ the mode ═════════════════════════════════════════════════════ */

  check('skirmish: the mode declares what it is and does not own its ground', async () => {
    const { MODES } = await import('../../src/game/Waves.js');
    const M = MODES.skirmish;
    assert(M, 'there is no skirmish mode');
    assert(M.name && M.blurb, 'a mode card with nothing on it');
    /* The Theatre column stays LIVE, which is the whole difference from
     * Command: a skirmish's ground is the player's pick and the rotation takes
     * over after it. `Menu._syncTheatre` greys the column on `fixedTheatre` and
     * `World.loadLevel` overrules the request on `level`. */
    assert(!M.fixedTheatre && !M.level, 'the skirmish claims to own its ground');
    assert(M.rotates === true, 'the mode does not declare that its ground moves');
    assert(MODES.command.level === 'geonosis' && MODES.command.fixedTheatre,
      'Command stopped owning its ground — the contrast this mode is built on is gone');
    return `${M.name}: ${Object.keys(MODES).length} modes, one of them rotating`;
  });

  check('skirmish: every pick is clamped, and the two Command ones by Command', async () => {
    const { skirmishConfig, SKIRMISH } = await import('../../src/game/Waves.js');
    const { AREAS, MAX_STRENGTH, OPENING_STRENGTH } = await import('../../src/game/Command.js');
    const wild = skirmishConfig({ engagements: 900, strength: -4, pressure: -2 });
    assert(wild.engagements === SKIRMISH.engagements.max, `engagements clamped to ${wild.engagements}`);
    assert(wild.strength === 0 && wild.pressure === 0, 'a negative pick got through');
    const none = skirmishConfig(undefined);
    assert(none.engagements === SKIRMISH.engagements.def && none.rotate === true,
      'the default battle is not the documented one');
    assert(skirmishConfig({ rotate: false }).rotate === false, 'the rotation cannot be turned off');
    /* NOTHING IN src/ READS A SKIRMISH SETTING, and that is deliberate rather
     * than unfinished — see this function's own note. The four names belong to
     * the Deploy panel, and a read here before the panel declares them would be
     * an orphan `tools/checks/controls.mjs` is right to name. */
    assert(skirmishConfig({ skirmishEngagements: 9 }).engagements === SKIRMISH.engagements.def,
      'skirmishConfig has started reading a settings blob by another name');

    // …and the two that need Command's tables are clamped where those tables
    // are visible, because Waves.js may not import Command.js.
    const { world } = await boot({ mode: 'skirmish' });
    world.beginSkirmish({ strength: 999, pressure: 99 });
    assert(world.skirmish.strength === MAX_STRENGTH, `strength clamped to ${world.skirmish.strength}`);
    assert(world.skirmish.pressure === AREAS.length - 1, `pressure clamped to ${world.skirmish.pressure}`);
    const { world: small } = await boot({ mode: 'skirmish' });
    small.beginSkirmish({ strength: 1 });
    assert(small.skirmish.strength === OPENING_STRENGTH,
      `an army below the muster's opening line: ${small.skirmish.strength}`);
    return `engagements ≤ ${SKIRMISH.engagements.max}, strength ${OPENING_STRENGTH}..${MAX_STRENGTH}, `
      + `pressure 0..${AREAS.length - 1}`;
  });

  check('skirmish: the line is raised to strength off the muster, and it is a mix', async () => {
    const { AREAS } = await import('../../src/game/Command.js');
    const { world } = await boot({ mode: 'skirmish' });
    world.beginSkirmish({ strength: 18, pressure: 4 });
    const r = world.command.roster;
    assert(r.strength === 18, `asked for 18 and fielded ${r.strength}`);
    const kinds = new Set(r.living.map((t) => t.type));
    assert(kinds.size >= 3, `an army of 18 with ${kinds.size} kind(s) in it — the fill is not walking the ladder`);
    assert(r.points === 0, `${r.points} reinforcement points left in a purse with no muster screen`);
    // The pressure gates the shelf through the muster's own `at <= areaNumber`.
    const { world: light } = await boot({ mode: 'skirmish' });
    light.beginSkirmish({ strength: 18, pressure: 0 });
    const early = new Set(light.command.roster.living.map((t) => t.type));
    const late = light.command.army.tiers.filter((t) => t.at > 1).map((t) => t.type);
    for (const t of late) assert(!early.has(t), `${t} reached the field at ${AREAS[0].name}`);
    return `18 bodies in ${kinds.size} kinds at ${AREAS[4].name}; ${early.size} kind(s) at ${AREAS[0].name}`;
  });

  check('skirmish: it is fought under the run rules, which the meeting could not be', async () => {
    /**
     * The reason a skirmish COMPOSES its opposing force instead of mustering a
     * mirror army: every hook in `CONDITIONS` is a composition hook (`types`,
     * `allow`, `capScale`, `heavyScale`, `eliteScale`, `aliveScale`, `pace`,
     * `bearing`, `head`), so a mode with no composed wave — Command's meeting —
     * can honour none of them. This asserts that the mode a player picks a rule
     * on is a mode the rule reaches.
     */
    const { CONDITIONS, CONDITION_KEYS } = await import('../../src/game/Waves.js');
    const hooks = ['types', 'allow', 'capScale', 'heavyScale', 'eliteScale', 'aliveScale', 'pace', 'bearing', 'head'];
    for (const k of CONDITION_KEYS) {
      assert(hooks.some((h) => CONDITIONS[k][h] !== undefined),
        `${k} declares no composition hook — this check's premise needs rewriting`);
    }
    const want = ['silence', 'deluge'];
    const { world } = await boot({ mode: 'skirmish', rules: want });
    const legal = world.director.legalRuleSet(want);
    for (const k of legal) assert(world.director.rules.includes(k), `${k} did not reach the director`);
    world.beginSkirmish({ pressure: 2 });
    const shape = world.director.shape;
    assert(shape, 'a skirmish composed no wave at all, so no rule could bite');
    assert(world.director.spawnQueue.length + world.enemies.length > 0, 'the opposing force is empty');
    return `${CONDITION_KEYS.length} conditions, all composition hooks; `
      + `${legal.length} of ${want.length} picked reached the wave`;
  });

  check('skirmish: N engagements on N grounds, ending in a stated victory', async () => {
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { world, input } = await boot({ mode: 'skirmish' }, 'colosseum', 4242);
      let ended = null;
      world.onGameOver = (s) => { ended = s; };
      world.beginSkirmish({ engagements: 3, strength: 10, pressure: 1 });
      const opened = world.levelKey;
      assert(world.skirmish.rotation[0] === opened, 'the battle did not open on the ground it was standing on');
      const grounds = [opened];
      for (let t = 0; t < 260 && !world.over; t++) {
        for (let i = 0; i < 30 && !world.over; i++) {
          if (world.player) world.player.hp = world.player.maxHp;
          world.update(1 / 60, input);
        }
        for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(9999, null, 'probe');
        if (grounds[grounds.length - 1] !== world.levelKey) grounds.push(world.levelKey);
      }
      assert(world.over, `the battle never ended — cleared ${world.skirmish.cleared} of 3`);
      assert(world.skirmish.cleared === 3, `cleared ${world.skirmish.cleared} engagements`);
      assert(world.skirmish.won === true, 'a cleared battle was not a victory');
      assert(ended && ended.won === true, `onGameOver was handed ${JSON.stringify(ended)}`);
      assert(grounds.length === 3 && new Set(grounds).size === 3,
        `three engagements were fought on ${grounds.join(', ')}`);
      assert(grounds.join() === world.skirmish.rotation.join(),
        `the run walked ${grounds.join()} and the plan said ${world.skirmish.rotation.join()}`);
      // The report is derived off the plan, so the summary cannot disagree.
      const R = world.skirmishReadout();
      assert(R.cleared === 3 && R.won === true && R.log.length === 3, 'the readout disagrees with the battle');
      return `3 engagements on ${grounds.join(' → ')}, won, wave ${ended.wave}, ${world.command.roster.strength} standing`;
    } finally { S.restoreShared(snap); }
  });

  check("skirmish: the campaign's area boundary is unreachable, so no Geonosis banner", async () => {
    /**
     * `CommandDirector.payWave` calls `_areaClear` when `areaWaves` reaches
     * `area.waves`, and past it `_endCampaign` announces "walked off Geonosis"
     * and recalls the army into a muster screen. Both are right for the
     * campaign and wrong for a battle on the Colosseum, and Command.js is not
     * this lane's file to edit — so the counter is reset on every clear and the
     * boundary is unreachable by arithmetic. This is the arithmetic.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { AREAS } = await import('../../src/game/Command.js');
      const shortest = Math.min(...AREAS.map((a) => a.waves));
      const { world, input } = await boot({ mode: 'skirmish' });
      let peak = 0, musters = 0, campaign = false;
      world.beginSkirmish({ engagements: 5, strength: 10, pressure: 0, rotate: false });
      world.command.onMuster = () => { musters++; };
      const notify = world.notify.bind(world);
      world.notify = (t, sub) => { if (/ADVANCE IS OVER|HELD/.test(String(t))) campaign = true; notify(t, sub); };
      for (let t = 0; t < 320 && !world.over; t++) {
        for (let i = 0; i < 30 && !world.over; i++) {
          if (world.player) world.player.hp = world.player.maxHp;
          world.update(1 / 60, input);
          peak = Math.max(peak, world.command.areaWaves);
        }
        for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(9999, null, 'probe');
      }
      assert(world.skirmish.cleared === 5, `cleared ${world.skirmish.cleared} of 5`);
      assert(peak < shortest, `areaWaves reached ${peak} against the shortest area's ${shortest}`);
      assert(!campaign, 'a skirmish announced an area of the Geonosis campaign');
      assert(musters === 0, `${musters} muster screens were raised in a mode that has none`);
      assert(world.command.areaIndex === world.skirmish.pressure, 'the battle walked up the campaign ladder');
      return `5 engagements, areaWaves peaked at ${peak} against ${shortest}, no area boundary crossed`;
    } finally { S.restoreShared(snap); }
  });

  check('skirmish: going down loses it, and the defeat is announced like the victory', async () => {
    /**
     * THE CHECK USED TO STOP AT THE `won` FIELD, and that is why nothing caught
     * a defeat nobody was told about. `World._endSkirmish` held the notify and
     * `audio.runWon`, and `grep -rn "_endSkirmish" src/` finds ONE call site —
     * `_endSkirmish(true)`. The defeat path is `_checkWipe`, which set the
     * flags, raised the card and said nothing.
     *
     * Measured on this exact drive before the fix: the last line on screen is
     * "THE COLOSSEUM — ENGAGEMENT 1 OF 2" and `audio.runWon` fires zero times,
     * against a won battle's "THE BATTLE IS WON" and `audio.runWon(true)`. The
     * mode's blurb is "it ends in a victory or a defeat — not in a high score",
     * so a mute defeat is the blurb half-kept.
     *
     * Both halves are read off the SHIPPED announcement rather than matched
     * against a sentence typed here: the word is whatever `_announceBattle`
     * says for a loss, and what is asserted is that a loss says something at
     * all, that it names the battle, and that the sound the victory plays is
     * played for the defeat with `false` on it.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    const { audio } = await import('../../src/engine/Audio.js');
    const realRunWon = audio.runWon;
    try {
      const { world, input } = await boot({ mode: 'skirmish' });
      let ended = null;
      world.onGameOver = (s) => { ended = s; };
      const said = [];
      const notify = world.notify.bind(world);
      world.notify = (t, sub) => { said.push(String(t)); notify(t, sub); };
      const sounded = [];
      audio.runWon = (w) => { sounded.push(w); return realRunWon?.call(audio, w); };
      world.beginSkirmish({ engagements: 4, strength: 10 });
      for (let i = 0; i < 30; i++) world.update(1 / 60, input);
      world.player.damage?.(99999, null, 'probe');
      for (let i = 0; i < 30 && !world.over; i++) world.update(1 / 60, input);
      assert(world.over, 'the player died and the battle went on');
      assert(ended, 'no run summary at all');
      assert(ended.won === false, `a lost battle reported won=${ended.won}`);
      assert(world.skirmish.done && world.skirmish.won === false, 'the plan was left undecided');
      assert(world.skirmish.cleared < 4, 'the battle was somehow also completed');
      const verdict = said.filter((t) => /\bLOST\b|\bDEFEAT\b/i.test(t));
      assert(verdict.length,
        'the battle was lost and nothing on screen said so — the last line a beaten player sees is '
        + `"${said[said.length - 1]}". The announcement lives in _endSkirmish, whose only caller passes `
        + 'true; the defeat path is _checkWipe. World._announceBattle is the fix and it is in the lane report');
      assert(sounded.length === 1 && sounded[0] === false,
        `a lost battle called audio.runWon ${sounded.length} time(s) (${JSON.stringify(sounded)}) — `
        + 'the victory plays it and the defeat is silent');
      return `dead on engagement 1: won=false, wave ${ended.wave}, ${ended.kills} kills, `
        + `announced "${verdict[0]}", runWon(false)`;
    } finally { audio.runWon = realRunWon; S.restoreShared(snap); }
  });

  check('skirmish: it plays through a front end that has never heard of it', async () => {
    /**
     * THE WIRING IS OPTIONAL AND THIS IS THE PROOF. `Menu._buildModes` iterates
     * `Object.entries(MODES)`, so the card exists the moment the mode does; the
     * picks default in `skirmishConfig`; and main.js's deploy path for every
     * mode that is not Command or training is one line — `director.start(1)`.
     * This drives exactly that line and nothing else, so a red here means the
     * mode needs front-end work before a player can reach it, which is the
     * state every mode in this game has been shipped out of.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { SKIRMISH } = await import('../../src/game/Waves.js');
      const { OPENING_STRENGTH } = await import('../../src/game/Command.js');
      const { world, input } = await boot({ mode: 'skirmish' }, 'wood', 808);
      let ended = null;
      world.onGameOver = (s) => { ended = s; };
      world.director.start(1);                       // main.js, verbatim
      assert(!world.skirmish, 'a plan appeared before anybody asked for one');
      let peakLine = 0;
      for (let t = 0; t < 300 && !world.over; t++) {
        for (let i = 0; i < 30 && !world.over; i++) {
          if (world.player) world.player.hp = world.player.maxHp;
          world.update(1 / 60, input);
          peakLine = Math.max(peakLine, world.command.roster.strength);
        }
        for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(9999, null, 'probe');
      }
      assert(world.skirmish?.started, 'the battle never opened itself');
      assert(world.skirmish.engagements === SKIRMISH.engagements.def,
        `the default battle is ${world.skirmish.engagements} engagements`);
      assert(peakLine >= OPENING_STRENGTH, `the line peaked at ${peakLine}`);
      assert(world.over && ended?.won === true, `the battle did not resolve: ${JSON.stringify(ended)}`);
      return `start(1) alone: opened itself, ${world.skirmish.engagements} engagements, `
        + `${peakLine} on the line, won`;
    } finally { S.restoreShared(snap); }
  });

  check('skirmish: every ending in this file reports the same six numbers', async () => {
    /**
     * `_checkWipe`, `_endMeeting` and `CommandDirector._endCampaign` each built
     * this object by hand — a three-way twin the note over `_endCampaign` names
     * and asks for `World.runStats()` to replace. Two of the three are in
     * World.js and call it now; the third is held to the same shape by
     * tools/checks/command.mjs. This asserts the shared builder is actually
     * shared, by source, because the alternative is driving three whole modes
     * to three different endings to compare six keys.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const hand = [...src.matchAll(/onGameOver\?\.\(\{/g)].length;
    assert(hand === 0, `${hand} endings still assemble the summary by hand`);
    const calls = [...src.matchAll(/onGameOver\?\.\(this\.runStats\(/g)].length;
    assert(calls >= 3, `only ${calls} endings go through runStats`);
    const { world } = await boot({ mode: 'roguelite' });
    const stats = world.runStats({ won: true });
    for (const k of ['won', 'wave', 'score', 'kills', 'deflects', 'perfects', 'limbs']) {
      assert(k in stats, `runStats does not report ${k}`);
    }
    assert(Object.keys(world.runStats()).length === 6, 'a plain runStats is not the six numbers');
    return `${calls} endings, one builder, ${Object.keys(stats).length} fields with a verdict on it`;
  });
}
