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

  check('skirmish: every number the Deploy panel offers is a number the plan keeps', async () => {
    /**
     * THE OTHER HALF OF `menu: a slider offers the numbers the run will take`,
     * and the half that needs a World.
     *
     * `Your line` used to open at 0 against `_planSkirmish`'s floor of
     * OPENING_STRENGTH, so nine of its twenty-five positions read "1 of 24" …
     * "9 of 24" and every one of them planned TEN. `Menu._range` writes the
     * three travels off `SKIRMISH.engagements`, `OPENING_STRENGTH..MAX_STRENGTH`
     * and `AREAS` now; this walks every position of each one through the
     * shipped planner and requires the plan to keep it.
     *
     * A range that merely MATCHES the tables is not enough — the tables could
     * both be wrong together — so the edges are pushed as well: one step
     * outside each bound has to come back clamped TO that bound, which is what
     * makes the offered range the real edge of what the battle accepts rather
     * than a pair of numbers that happen to agree.
     *
     * `_planSkirmish` and not `beginSkirmish`: the planner is the rule under
     * test and calling it costs nothing, where opening a battle musters an army
     * and can only happen once per world.
     */
    const { SKIRMISH } = await import('../../src/game/Waves.js');
    const { AREAS, MAX_STRENGTH, OPENING_STRENGTH } = await import('../../src/game/Command.js');
    const { world } = await boot({ mode: 'skirmish' });
    const plan = (picks) => world._planSkirmish(picks);
    const offers = [
      ['engagements', SKIRMISH.engagements.min, SKIRMISH.engagements.max,
        (v) => plan({ engagements: v }).engagements],
      ['strength', OPENING_STRENGTH, MAX_STRENGTH, (v) => plan({ strength: v }).strength],
      ['pressure', 0, AREAS.length - 1, (v) => plan({ pressure: v }).pressure],
    ];
    const rows = [];
    for (const [name, lo, hi, ask] of offers) {
      for (let v = lo; v <= hi; v++) {
        assert(ask(v) === v,
          `the panel offers ${name} ${v} and the plan comes back ${ask(v)} — that position of the `
          + 'control is a number no battle will ever be fought at');
      }
      assert(ask(lo - 1) === lo, `${name} ${lo - 1} planned as ${ask(lo - 1)} rather than clamping to ${lo}`);
      assert(ask(hi + 1) === hi, `${name} ${hi + 1} planned as ${ask(hi + 1)} rather than clamping to ${hi}`);
      rows.push(`${name} ${lo}..${hi} (${hi - lo + 1} honoured)`);
    }
    return `${rows.join(', ')}; one step outside each bound clamps to it`;
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
     * `bearing`, `head`, `floor`), so a mode with no composed wave — Command's
     * meeting — can honour none of them. This asserts that the mode a player
     * picks a rule on is a mode the rule reaches.
     *
     * `floor` IS THE LIST'S NEWEST MEMBER AND ITS ABSENCE WAS A REAL RED.
     * ARMOUR COLUMN was a `types` filter and became a reservation in
     * `_composeUnder` — PLAN §4.6's "40% must be vehicles" — the day the filter
     * was measured to field no vehicle at all on four of the seven theatres. A
     * hook list written out by hand goes stale the first time the composer
     * grows one, and this one did, loudly and correctly: the assertion below
     * says the premise needs rewriting, and it did.
     */
    const { CONDITIONS, CONDITION_KEYS } = await import('../../src/game/Waves.js');
    const hooks = ['types', 'allow', 'capScale', 'heavyScale', 'eliteScale', 'aliveScale', 'pace',
                   'bearing', 'head', 'floor'];
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
      /**
       * `instantSpawn: true` — AND THAT IS THIS CHECK SAYING WHAT IT IS ABOUT.
       *
       * A ground change is a JOURNEY now (src/game/Extraction.js): five
       * seconds of aftermath, a transport that flies in and lands, a walk to
       * it, a bay and a flight, about 39 s of it, and an idle headless
       * commander who never walks holds the ship to its 22 s last call on top
       * of that. This check drives a whole battle to its victory and clears
       * every wave with a probe, so two rotations were suddenly 116 s of a
       * 130 s budget and it reported "cleared 2 of 3".
       *
       * Raising the budget would be the wrong fix twice over: it would make a
       * bookkeeping check pay for a cinematic every run, and it would leave the
       * check silently measuring the extraction's timing as well as its own
       * subject. `instantSpawn` is the game's own single reader for "this
       * caller wants things to simply appear" — the sandbox, the dojo and the
       * arrival suite all use it — and it restores the one-frame rotate.
       *
       * The journey itself is measured in tools/checks/extraction.mjs, which
       * is where a change to its timing should break something.
       */
      const { world, input } = await boot({ mode: 'skirmish', instantSpawn: true }, 'colosseum', 4242);
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
      /* 320 HALF-SECONDS WAS THE OLD ARITHMETIC, when an engagement was one
       * cleared wave. `SKIRMISH.waves` makes it three — the player found the
       * one-wave version and called it "the map will immediately say cleared"
       * — so five engagements is fifteen waves and fifteen intermissions. The
       * budget is the shipped default's, not a number that keeps the old bug
       * passing. */
      for (let t = 0; t < 1000 && !world.over; t++) {
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
      // Three waves to an engagement now — see the budget note above.
      for (let t = 0; t < 900 && !world.over; t++) {
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

  check('skirmish: one ending builder, and it feeds everything that reads an ending', async () => {
    /**
     * `_checkWipe`, `_endMeeting` and `CommandDirector._endCampaign` each built
     * this object by hand — a three-way twin the note over `_endCampaign` named
     * and asked `World.runStats()` to replace. All three call it now.
     *
     * THIS CHECK USED TO END ON `Object.keys(runStats()).length === 6`, AND
     * THAT LINE WAS ENFORCING A DEFECT. main.js's victory card reads
     * `stats.areas ?? 5` and `stats.fallen ?? 0`; NO ending passes either, so
     * every won run ever played printed "Areas taken 5" — a literal — and
     * "Troops lost 0" on the mode whose whole subject is named people dying
     * permanently. A count of keys cannot see that, and worse, it FAILS the day
     * somebody fixes it: the shape it pinned is exactly the shape that starves
     * the card.
     *
     * So the property is stated from the consumer's end instead. Every
     * `stats.<field>` the ending card reads is lifted out of main.js's own
     * source and required to be a field `runStats` reports — a count is a
     * number nobody can act on, and "the card asks for something no ending
     * sends" is the actual defect.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const hand = [...src.matchAll(/onGameOver\?\.\(\{/g)].length;
    assert(hand === 0, `${hand} endings still assemble the summary by hand`);
    const calls = [...src.matchAll(/onGameOver\?\.\(this\.runStats\(/g)].length;
    assert(calls >= 3, `only ${calls} endings go through runStats`);
    const cmd = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/onGameOver\?\.\(w\.runStats\(/.test(cmd),
      "CommandDirector._endCampaign assembles its own summary again — that is the twin World's note names");

    const { world } = await boot({ mode: 'roguelite' });
    const stats = world.runStats({ won: true });
    for (const k of ['won', 'wave', 'score', 'kills', 'deflects', 'perfects', 'limbs']) {
      assert(k in stats, `runStats does not report ${k}`);
    }

    /* THE CARD'S OWN LIST, LIFTED. `gameOver(stats)` in main.js is the one
     * reader of an ending summary that a player sees; anything it names and
     * nothing sends is a fabricated row. */
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i = main.indexOf('\nfunction gameOver(stats) {');
    assert(i > 0, 'main.js no longer declares `function gameOver(stats)` — this check describes a file that is gone');
    /* CODE ONLY. The block comment over these rows QUOTES the two fabricated
     * reads it is about, and a scan that counts prose finds fields the card
     * does not ask for — an instrument manufacturing its own defect (§2.4). */
    const body = main.slice(i, main.indexOf('\n}\n', i))
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const wants = [...new Set([...body.matchAll(/\bstats\.(\w+)/g)].map((m) => m[1]))];
    assert(wants.length >= 6, `only ${wants.length} fields lifted out of gameOver — the lift is wrong`);
    const starved = wants.filter((k) => !(k in stats));
    assert(!starved.length,
      `the ending card reads ${starved.map((k) => `stats.${k}`).join(', ')} and no ending sends `
      + 'it — that is the "Areas taken 5" literal again. World.runStats must carry them; the patch is '
      + 'in the lane report');
    /* …AND IT MAY NOT PAPER OVER A MISSING ONE. `?? 5` is what turned an absent
     * field into a statistic; a row with no number belongs off the card. */
    const invented = [...body.matchAll(/\bstats\.(\w+)\s*\?\?\s*([^,\n)]+)/g)]
      .map((m) => `stats.${m[1]} ?? ${m[2].trim()}`);
    assert(!invented.length,
      `the card invents a value for a missing field: ${invented.join(', ')}`);
    return `${calls} endings, one builder, ${Object.keys(stats).length} fields; the card reads `
      + `${wants.length} (${wants.join(', ')}) and every one is sent`;
  });

  /* ══ what the player found by playing ═════════════════════════════════ */

  check('skirmish: an engagement is a battle and not one cleared wave', async () => {
    /**
     * THE PLAYER'S REPORT, and it is the whole of this check: "in skirmish mode
     * I'll start the map will immediately say cleared and we leave like there
     * were never any enemies."
     *
     * `World._skirmishCleared` is hung off the wave-clear ledger, so an
     * engagement WAS exactly one cleared wave — and wave 1 of the escalation
     * composes ONE body. Driven in `tools/_stall.mjs --mode skirmish` before the
     * fix: engagement 1 closed at t = 6.0 s having composed a single hostile,
     * and the transport was called on it.
     *
     * Two properties, and neither can be satisfied by the old code:
     *   · clearing ONE wave does not advance the engagement counter;
     *   · the battle opens at a wave the pressure chose, so the heaviest
     *     skirmish in the game does not open on the one-droid wave.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { SKIRMISH } = await import('../../src/game/Waves.js');
      assert(SKIRMISH.waves.def >= 3,
        `an engagement defaults to ${SKIRMISH.waves.def} wave(s) — one is the bug the player reported`);
      const { world, input } = await boot({ mode: 'skirmish' });
      world.beginSkirmish({ engagements: 4, strength: 10, pressure: 3, rotate: false });
      const opened = world.director.wave;
      assert(opened >= 1 + 3 * SKIRMISH.pressureWaves,
        `pressure 3 opened the escalation at wave ${opened}`);
      /* One wave, cleared, by the ledger's own door — the same call World hangs
       * the engagement off. Anything that advances `cleared` here is the defect. */
      const first = world.skirmish.cleared;
      world.director.onWaveClear(world.director.wave, true);
      assert(world.skirmish.cleared === first,
        'one cleared wave ended the engagement — that is the bug, exactly');
      assert(world.skirmish.waveCount === 1,
        `the wave was not counted (waveCount ${world.skirmish.waveCount})`);
      for (let i = 1; i < SKIRMISH.waves.def; i++) world.director.onWaveClear(world.director.wave, true);
      assert(world.skirmish.cleared === first + 1,
        `${SKIRMISH.waves.def} cleared waves did not close one engagement`);
      assert(world.skirmish.waveCount === 0, 'the wave counter did not reset at the boundary');
      return `${SKIRMISH.waves.def} waves to an engagement; pressure 3 opened at wave ${opened}`;
    } finally { S.restoreShared(snap); }
  });

  check('skirmish: a journey in flight is not re-asked for every frame — the campaign freeze', async () => {
    /**
     * THE PLAYER: "in campaign mode the game completely freezes when you finish
     * the first wave, never unfreezes so I don't know what's in it."
     *
     * A two-line loop between three correct pieces, and the reason no check in
     * the tree caught it is that EVERY campaign check passes `instantSpawn:
     * true`, which is precisely the flag that switches the journey off.
     *
     *   `_advanceMission` nulls `world.skirmish` and asks for the next ground →
     *   `World.update`'s auto-open block sees no skirmish and re-opens the
     *   campaign → which sets `_groundPending` again → which is handed to an
     *   extraction that already owns it → whose `begin` answers true → and
     *   `World.update` RETURNS, above the line that steps the extraction.
     *
     * So the director is never updated: `phase` stays `aftermath`, `t` never
     * advances, and the whole game is one frame wide from then on. Measured at
     * 40 s of driven play with nothing in the world moving.
     *
     * The property is stated as a frame count rather than as source text: a
     * campaign whose first mission ends must still be stepping its extraction
     * some seconds later.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { world, input } = await boot({ mode: 'campaign', instantSpawn: false }, 'geonosis');
      world.beginCampaign();
      /* End mission 1 by hand, through the door the battle uses, so this check
       * does not depend on how long a mission takes to fight. */
      world.skirmish = world.skirmish || world._planSkirmish({});
      world.skirmish.started = true;
      world.skirmish.cleared = world.skirmish.engagements;
      world._endSkirmish(true);
      let ticks = 0;
      const phases = new Set();
      for (let i = 0; i < 60 * 20 && !world.over; i++) {
        world.update(1 / 60, input);
        if (world.extraction?.active) { ticks++; phases.add(world.extraction.phase); }
      }
      assert(ticks > 0, 'no extraction ever ran on a mission boundary');
      assert(phases.size > 1,
        `the journey never left '${[...phases][0]}' in 20 s — World.update is returning above `
        + 'extraction.update, which is the campaign freeze');
      return `mission boundary flew ${phases.size} phases (${[...phases].join(' → ')}) in 20 s`;
    } finally { S.restoreShared(snap); }
  });

  check('the line crosses the ground with you, and the top-up is added to it', async () => {
    /**
     * ══ THE MEN WHO BOARDED THE SHIP WERE REPLACED BY STRANGERS ══
     *
     * Reported: "we get in the extraction ship and go to the next map, at some
     * point the troops that got on were cleared off the ship and a new set of
     * troops came in… the promoted guy wasn't in the game anymore but he still
     * was on the troop list."
     *
     * One cause for both halves. `World.loadLevel` builds a NEW
     * `CommandDirector` — a ground change goes through it — and that
     * constructor ends on `_musterOpening()`. So the incoming ground raised a
     * fresh roll and the outgoing one, ranks and casualty list and all, went
     * with the director that owned it; the name stayed visible because the
     * troop tab reads the COMPANY, which is written at the end of a run.
     *
     * ASSERTED ON IDENTITY, NOT ON A HEAD-COUNT. Ten men crossing and ten
     * strangers arriving are the same number, which is exactly why the defect
     * survived: the designations are what say it is the same line. The rank is
     * asserted too, because the promotion is the thing the player noticed —
     * `xp` is what `rank` is derived from, so a man who crossed as a corporal
     * and arrives as a recruit has been re-mustered whatever his name says.
     *
     * AND THE FALLEN CROSS. A roll is a casualty list as much as a line, and a
     * man who died in engagement one is still a name the next muster screen
     * has to print.
     */
    const { world, input } = await boot({ mode: 'skirmish' });
    const d = world.command;
    assert(d, 'a skirmish with no army — this check measures the roster');
    world.beginSkirmish();
    const before = d.commander.roster;
    assert(before.all.length >= 4,
      `a skirmish opened with ${before.all.length} men, which is too few to tell a carried line `
      + 'from a fresh muster');
    /* A PROMOTION AND A CASUALTY, so the two things a fresh muster cannot
     * reproduce are both on the roll before the crossing. */
    const hero = before.living[0];
    hero.xp = 400;
    const heroRank = hero.rank;
    const heroName = hero.designation;
    const dead = before.living[before.living.length - 1];
    dead.alive = false;
    const names = before.all.map((t) => t.designation).sort();
    const wasLiving = before.strength;

    world.rotateTo('drifts');
    const after = world.command?.commander?.roster;
    assert(after, 'the ground changed and the army did not come with it at all');
    const now = after.all.map((t) => t.designation);
    const lost = names.filter((n) => !now.includes(n));
    assert(lost.length === 0,
      `${lost.length} of ${names.length} men did not cross the ground: ${lost.slice(0, 5).join(', ')}`
      + ' — the new director mustered a roll of its own and the line that boarded the ship was '
      + 'dropped with the old one');
    const he = after.all.find((t) => t.designation === heroName);
    assert(he && he.rank === heroRank,
      `${heroName} crossed as ${heroRank} and arrived as ${he ? he.rank : 'nobody'} — a man `
      + 're-mustered under his own name is not the same man');
    assert(after.all.some((t) => t.designation === dead.designation && !t.alive),
      'the fallen did not cross — the roll on the next ground is a line without its casualty list');
    /* AND THE TOP-UP IS ADDED TO THEM, not instead of them: "I want those guys
     * to stay with me when other troops get added". */
    assert(after.strength >= wasLiving,
      `the line stood ${wasLiving} before the crossing and ${after.strength} after — a top-up that `
      + 'shrinks the army has replaced it');
    /* …AND EVERY MAN GETS A BODY ON THE NEW GROUND. `recall` nulls `body`, so a
     * carried record that nothing re-fields is precisely the "still on the
     * troop list, not in the game" half of the report. */
    for (let i = 0; i < 240; i++) world.update(1 / 60, input);
    const fielded = after.living.filter((t) => t.body && !t.body.dead).length;
    assert(fielded >= Math.min(wasLiving, after.strength),
      `${fielded} of ${after.strength} men on the roll are standing on the new ground — the rest `
      + 'are names on a list with no body, which is what the player saw');
    return `${names.length} crossed (${wasLiving} standing, 1 fallen), ${heroName} still ${heroRank}, `
      + `${after.strength} on the roll after the top-up, ${fielded} on their feet`;
  });

  check('a battle you WIN brings your survivors home, and a wipe still keeps nobody', async () => {
    /**
     * ══ WINNING STRUCK THE WHOLE ROLL OFF ══
     *
     * Reported: "I finished a skirmish run and when I was back at the main menu
     * and went to the troop tab I could only see a list of fallen troops,
     * nothing about the troops that had just survived. And when I went into a
     * new skirmish game, it was a fresh set of troops."
     *
     * `World.manifest` had exactly one writer — `_endWithdrawal`, the ship —
     * and `main.js`'s `bank()` reads it as "who came home", handing
     * `Company.keep` an EMPTY list with `deployed: roster.all` under it. Keep's
     * rule for a man who went out and is not on the manifest is that he is
     * dead, so every ending except the ship executed the army.
     *
     * MEASURED HERE ON THE WORLD, not through `bank()`: `main.js` cannot be
     * imported without a browser, and the decision was moved into
     * `World.sealManifest` for that reason among others — main.js owns
     * localStorage, the game owns the game.
     *
     * BOTH VERDICTS, because the failure this could grow into is the opposite
     * one: a wipe that quietly keeps the line would pass a check that only ever
     * looked at a victory, and `tools/checks/company.mjs` says of itself that
     * it is "the check that would go red the day" a bad run is softened.
     */
    const won = await boot({ mode: 'skirmish' });
    won.world.beginSkirmish();
    const line = won.world.command.commander.roster;
    const standing = line.strength;
    assert(standing > 0, 'a skirmish opened with nobody on the line');
    /* One casualty, so "the survivors" is a smaller list than "the roll" and
     * the assertion cannot pass by carrying everybody. */
    const fell = line.living[0];
    fell.alive = false;
    won.world.skirmish.cleared = won.world.skirmish.engagements;
    won.world._endSkirmish(true);
    const home = won.world.manifest;
    assert(Array.isArray(home),
      'a won battle wrote no manifest at all — every man who fought it is about to be struck off '
      + 'the roll by the layer that keeps the company');
    assert(home.length === standing - 1,
      `${home.length} of ${standing - 1} survivors walked off a ground they had just taken`);
    assert(!home.includes(fell),
      'a man who fell in the battle is on the list of men who came home from it');

    /* …AND A WIPE STILL COSTS EVERYTHING. */
    const lost = await boot({ mode: 'skirmish' });
    lost.world.beginSkirmish();
    const dead = lost.world.command.commander.roster.strength;
    lost.world._endSkirmish(false);
    assert(Array.isArray(lost.world.manifest) && lost.world.manifest.length === 0,
      `${lost.world.manifest?.length} of ${dead} men came home from a battle that was lost — the `
      + 'roll dying with the commander is the stake the whole company plays for');
    return `won: ${home.length} of ${standing} home (1 fallen left behind) · lost: 0 of ${dead}`;
  });

  check('the men who survived your last skirmish are on the line in your next one', async () => {
    /**
     * ══ THE WHOLE LOOP, END TO END, IN ONE CHECK ══
     *
     * "when I went into a new skirmish game, it was a fresh set of troops… I
     * thought we made it so troops that survive with you go with you into the
     * next run? Am I wrong?"
     *
     * Not wrong: every piece of it was built and the first one was broken, so
     * the last one had nothing to do. This drives the four in order —
     * `_endSkirmish(true)` seals a manifest, `Company.keep` folds it into the
     * roll, `Company.fieldable` picks who deploys, `_musterVeterans` puts them
     * back on a line — because each of those has its own check and the run of
     * them did not. A defect in the joins between four green units is exactly
     * the shape the player hit.
     *
     * `Company.fieldable(load(...))` is `main.js`'s `veteransToField` inlined
     * rather than called: that function is fifteen lines into a module that
     * needs a browser to import. What it does is these two calls and the plan
     * that decides the army, and the plan has its own check in company.mjs.
     */
    const Company = await import('../../src/game/Company.js');
    const store = globalThis.localStorage;
    const had = store?.getItem?.(Company.KEY) ?? null;
    try {
      store?.removeItem?.(Company.KEY);
      /* ── RUN ONE, WON. */
      const a = await boot({ mode: 'skirmish' });
      a.world.beginSkirmish();
      const roster = a.world.command.commander.roster;
      const army = a.world.command.commander.army.id;
      /* A promotion, so the man who comes back is provably the same man and not
       * a fresh trooper who happens to share a designation table. */
      const hero = roster.living[0];
      hero.xp = 400;
      const heroName = hero.designation, heroRank = hero.rank;
      const survivors = roster.living.map((t) => t.designation).sort();
      a.world.skirmish.cleared = a.world.skirmish.engagements;
      a.world._endSkirmish(true);
      Company.keep(a.world.manifest, {
        army, deployed: roster.all, left: [], ground: a.world.levelKey, ended: 'won',
      });

      /* ── AND RUN TWO, WHICH HAS NEVER HEARD OF RUN ONE. */
      const roll = Company.fieldable(Company.load(army), 10);
      assert(roll.length === survivors.length,
        `${roll.length} men are on the roll after a won battle that ${survivors.length} walked `
        + 'away from — the company kept the wrong number of them');
      const H = await import('./_coop.mjs');
      const { world: b } = await H.bootWorld({ level: 'colosseum',
        settings: { quality: 'low', difficulty: 'knight', mode: 'skirmish' },
        run: { veterans: roll } });
      b.beginSkirmish();
      const line = b.command.commander.roster.all.map((t) => t.designation);
      const missing = survivors.filter((n) => !line.includes(n));
      assert(missing.length === 0,
        `${missing.length} of ${survivors.length} veterans did not make the next line: `
        + `${missing.slice(0, 5).join(', ')} — the roll persisted and the muster ignored it`);
      const he = b.command.commander.roster.all.find((t) => t.designation === heroName);
      assert(he && he.rank === heroRank,
        `${heroName} finished the last run as ${heroRank} and turned up as `
        + `${he ? he.rank : 'nobody'} — the rank is the thing a company is FOR`);
      return `${survivors.length} survivors banked and all ${survivors.length} back on the next `
        + `line, ${heroName} still ${heroRank}, ${line.length} strong after the top-up`;
    } finally {
      if (had === null) store?.removeItem?.(Company.KEY); else store?.setItem?.(Company.KEY, had);
    }
  });
}
