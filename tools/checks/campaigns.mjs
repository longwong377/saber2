/**
 * BATTLEFRONT BORZ — CAMPAIGNS.
 *
 * Player notes #21 and #47 asked for two campaigns and both came with the same
 * second sentence: what makes a sequence of fights a campaign rather than a
 * playlist. `Levels.CAMPAIGNS` answers it in three parts — the order is
 * authored, every ground carries a brief, and the shape of the battle is part
 * of the mission — and this file holds all three to being true of a run rather
 * than of a table.
 *
 * THERE IS ONE CAMPAIGN NOW AND THAT IS A DELETION, NOT A REGRESSION. The
 * Boarding Action was the other one, and its two missions were the only two
 * missions in the game fought indoors. The player played both and asked for
 * them gone — "I just tried the boarding bay and the providence and hated
 * them, you completely missed the ball so just remove them. your outside work
 * is much better" — so the campaign went with its grounds, because a campaign
 * is a statement about grounds and there were none left to make it about.
 *
 * WHAT THAT COST IS WRITTEN DOWN RATHER THAN QUIETLY ABSORBED, because the
 * ships were built to reach unreachable content and deleting them un-reaches
 * some of it. `works()` in Levels.js — 300 lines of bulkhead-and-gantry
 * vocabulary — has no caller again, and the `warship` preset has no level
 * again. The half of that loss that mattered has since been recovered
 * elsewhere: the twenty-second door hold DESIGN.md calls a signature mechanic
 * is back as `magazine()` on Geonosis, outdoors, which is what FLAGSHIP.md §4
 * means by "an interior may exist as a feature on an outdoor field — a bunker
 * you breach". `tools/checks/blast-door.mjs` measures it. What is still
 * un-reached by this deletion is the ROOM and the `warship` ground, not the
 * mechanic. The IG-100 general survives: `drifts` names `bodyguard` in its
 * pool, which the check below is the standing proof of. The last check in this
 * file is the tripwire that counts the orphaned grounds.
 *
 * Every module is reached by `await import` inside a check body, for the reason
 * tools/checks/materials.mjs gives.
 */

async function boot(settings, level, seed = 41) {
  const H = await import('./_coop.mjs');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { seedWaves } = await import('../../src/game/Waves.js');
  enemyRng.seed(seed);
  seedWaves(seed, 0);
  const { world } = await H.bootWorld({ level, settings: { quality: 'low', difficulty: 'knight', ...settings } });
  world.runSeed = seed;
  return { world, input: H.idleInput() };
}

/** Fight the whole thing, killing everything hostile every half second. */
function fight(world, input, budget = 700) {
  const grounds = [world.levelKey];
  for (let t = 0; t < budget && !world.over; t++) {
    for (let i = 0; i < 30 && !world.over; i++) {
      if (world.player) world.player.hp = world.player.maxHp;
      world.update(1 / 60, input);
    }
    for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(99999, null, 'probe');
    if (grounds[grounds.length - 1] !== world.levelKey) grounds.push(world.levelKey);
  }
  return grounds;
}

export async function run({ check, assert }) {

  /* ══ the table ════════════════════════════════════════════════════════ */

  check('campaigns: every mission names a ground that exists and is not the last one', async () => {
    const { CAMPAIGNS, CAMPAIGN_IDS, LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { SKIRMISH, skirmishConfig } = await import('../../src/game/Waves.js');
    /* ONE, and the floor is here to catch an accidental deletion rather than
     * a deliberate one. It was 2 against the notes' two; the Boarding Action
     * was struck with its grounds on the player's word, exactly the way
     * `roster.mjs` describes its own level floor going down. */
    assert(CAMPAIGN_IDS.length >= 1, `${CAMPAIGN_IDS.length} campaign(s)`);
    const rows = [];
    for (const id of CAMPAIGN_IDS) {
      const C = CAMPAIGNS[id];
      assert(C.id === id, `${id} disagrees with its own key (${C.id})`);
      assert(C.name && C.blurb, `${id} has no name or no blurb`);
      assert(C.missions.length >= 2,
        `${id} is ${C.missions.length} mission(s) — one battle on one ground is a skirmish, and there is a mode for that`);
      for (let i = 0; i < C.missions.length; i++) {
        const m = C.missions[i];
        assert(LEVELS[m.level], `${id} mission ${i + 1} names '${m.level}', which is not a level`);
        assert(LEVEL_ORDER.includes(m.level),
          `${id} mission ${i + 1} is on '${m.level}', which is not in LEVEL_ORDER — the theatre column cannot reach it`);
        assert(m.name && m.brief,
          `${id} mission ${i + 1} has no brief. A playlist announces a level name; a campaign says what you are for`);
        /* THE ORDER IS THE WHOLE POINT, so a repeat is the one thing a campaign
         * may not do — it is precisely the complaint note #48 makes, arriving
         * in the one place it was chosen rather than drawn. */
        if (i) assert(m.level !== C.missions[i - 1].level,
          `${id} fights missions ${i} and ${i + 1} on the same ground`);
        // …and the picks have to be picks the battle runner will honour.
        const cfg = skirmishConfig(m);
        assert(cfg.engagements === (m.engagements ?? SKIRMISH.engagements.def),
          `${id} mission ${i + 1} asks for ${m.engagements} engagements and gets ${cfg.engagements}`);
      }
      rows.push(`${C.name}: ${C.missions.map((m) => LEVELS[m.level].name).join(' → ')}`);
    }
    return rows.join('; ');
  });

  check('campaigns: the theatre column is the picker, and only an opening ground picks', async () => {
    const { CAMPAIGNS, CAMPAIGN_IDS, LEVEL_ORDER, campaignAt } = await import('../../src/game/Levels.js');
    const opens = new Set();
    for (const id of CAMPAIGN_IDS) {
      const first = CAMPAIGNS[id].missions[0].level;
      assert(campaignAt(first)?.id === id, `${first} does not open ${id}`);
      assert(!opens.has(first), `two campaigns open on ${first}, so the theatre cannot say which`);
      opens.add(first);
    }
    /* A ground that appears LATER in a campaign is a place you are taken to,
     * not a place you may start from — matching on it would let a player begin
     * the Execution on the plain with the arena behind them. */
    for (const id of CAMPAIGN_IDS) {
      for (const m of CAMPAIGNS[id].missions.slice(1)) {
        if (opens.has(m.level)) continue;
        assert(campaignAt(m.level) === null, `${m.level} is a middle mission and opens a campaign`);
      }
    }
    assert(campaignAt(null) === null && campaignAt('kamino') === null, 'a dead key opened a campaign');
    const idle = LEVEL_ORDER.filter((k) => !campaignAt(k));
    assert(idle.length >= 1, 'every ground in the game opens a campaign, which leaves nothing to skirmish on');
    return `${opens.size} of ${LEVEL_ORDER.length} grounds open a campaign (${[...opens].join(', ')})`;
  });

  /* ══ the run ══════════════════════════════════════════════════════════ */

  check('campaigns: the Execution is two grounds, one run, and one ending', async () => {
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { CAMPAIGNS } = await import('../../src/game/Levels.js');
      const C = CAMPAIGNS.petranaki;
      /**
       * `instantSpawn: true` — AND THAT IS THIS CHECK SAYING WHAT IT IS ABOUT.
       *
       * A ground change is a JOURNEY now (src/game/Extraction.js): five
       * seconds of aftermath, a transport that flies in and lands, a walk to
       * it, a bay and a flight, about 39 s of it, and an idle headless
       * commander who never walks holds the ship to its 22 s last call on top
       * of that. This check drives a whole campaign to its ending and clears
       * every wave with a probe, so the mission boundary alone ate most of the
       * budget and it reported "the campaign never ended — mission 1".
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
      const { world, input } = await boot({ mode: 'campaign', instantSpawn: true }, C.missions[0].level, 77);
      let overs = 0, ended = null;
      world.onGameOver = (s) => { overs++; ended = s; };
      const grounds = fight(world, input, 600);
      assert(world.over, `the campaign never ended — mission ${world.campaign?.index}`);
      /* ONE ENDING. A mission IS a battle and `_endSkirmish` is a battle's
       * ending, so without `_advanceMission` in front of it every mission would
       * have raised the death card with `won: true` on it. */
      assert(overs === 1, `${overs} run summaries came out of one campaign`);
      assert(ended.won === true, `a completed campaign reported won=${ended.won}`);
      assert(world.campaign.done && world.campaign.won === true, 'the plan was left undecided');
      assert(world.campaign.index === C.missions.length - 1,
        `the campaign ended on mission ${world.campaign.index + 1} of ${C.missions.length}`);
      assert(grounds.join() === C.missions.map((m) => m.level).join(),
        `walked ${grounds.join(' → ')} against an authored ${C.missions.map((m) => m.level).join(' → ')}`);
      assert(world.campaign.log.length === C.missions.length, 'the log does not have a row per mission');
      return `${C.name}: ${grounds.join(' → ')}, won at wave ${ended.wave}, one summary`;
    } finally { S.restoreShared(snap); }
  });

  check('campaigns: the run crosses the mission boundary and the escalation does not restart', async () => {
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { boonById } = await import('../../src/game/Waves.js');
      /* `instantSpawn` for the reason the check above it gives in full: the
       * mission boundary is a 39 s flight now, and this check is about what
       * survives one rather than about how long it takes. */
      const { world, input } = await boot({ mode: 'campaign', instantSpawn: true }, 'colosseum', 91);
      /* A build the campaign never gave the player, so what is measured on the
       * far side is the CARRY and not something the mode handed out. */
      for (const id of ['vaapad', 'vaapad', 'soresu']) {
        const b = boonById(id);
        world.takenBoons.take(id);
        world.player.applyBoon(b);
      }
      world.communion.earn(2);
      const before = {
        ranks: world.takenBoons.ranks, vaapad: world.takenBoons.rank('vaapad'),
        insight: +world.communion.insight.toFixed(3),
        deflect: +world.player.boonMods.deflectDamage.toFixed(4),
      };
      /* One frame first: the campaign is opened by `World.update` on the frame
       * it finds a player, so a loop conditioned on `campaign.index` would
       * never enter and the assertion below would read a null. */
      world.update(1 / 60, input);
      assert(world.campaign, 'the campaign never opened itself');
      /* SAMPLED WHILE STILL ON THE FIRST GROUND, and the guard is the point.
       * The rotation lands inside one of these thirty-frame blocks, so a
       * sample taken after the block has already crossed the boundary and
       * reads the INCOMING mission's wave as the outgoing one's high-water
       * mark — which is a check that can only ever report "it did not
       * advance". `levelKey` is the only thing that distinguishes the two. */
      const opened = world.levelKey;
      let firstGroundWave = 0;
      for (let t = 0; t < 400 && world.campaign.index === 0 && !world.over; t++) {
        for (let i = 0; i < 30 && !world.over; i++) {
          if (world.player) world.player.hp = world.player.maxHp;
          world.update(1 / 60, input);
          if (world.levelKey === opened) firstGroundWave = Math.max(firstGroundWave, world.director.wave);
        }
        for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(99999, null, 'probe');
      }
      assert(world.campaign.index === 1, 'the campaign never reached its second mission');
      /* THE GROUND CHANGE IS DEFERRED BY A FRAME on purpose — `_skirmishCleared`
       * runs inside the director's own update and `unload()` disposes the
       * bodies that loop is standing in, so `World.update` takes it at the top
       * of the next frame. A measurement taken on the frame the index moved is
       * reading the OUTGOING mission's world. */
      for (let i = 0; i < 120 && !world.over; i++) {
        if (world.player) world.player.hp = world.player.maxHp;
        world.update(1 / 60, input);
      }
      assert(world.levelKey === 'geonosis', `mission two is on ${world.levelKey}`);
      assert(world.takenBoons.ranks === before.ranks && world.takenBoons.rank('vaapad') === before.vaapad,
        `the build lost ${before.ranks - world.takenBoons.ranks} rank(s) crossing a mission boundary`);
      assert(+world.player.boonMods.deflectDamage.toFixed(4) === before.deflect,
        `deflectDamage went ${before.deflect} → ${world.player.boonMods.deflectDamage.toFixed(4)}`);
      assert(world.communion.insight >= before.insight, 'the Insight ledger was reset by a level load');
      assert(world.director.wave > firstGroundWave,
        `the escalation restarted: wave ${firstGroundWave} on mission one and ${world.director.wave} on mission two`);
      return `3 ranks, ${before.deflect} deflect and ${before.insight} Insight crossed; `
        + `wave ${firstGroundWave} → ${world.director.wave}`;
    } finally { S.restoreShared(snap); }
  });

  check('campaigns: going down mid-campaign loses it, once', async () => {
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { world, input } = await boot({ mode: 'campaign' }, 'colosseum', 5);
      let overs = 0, ended = null;
      world.onGameOver = (s) => { overs++; ended = s; };
      for (let i = 0; i < 30; i++) world.update(1 / 60, input);
      world.player.damage?.(999999, null, 'probe');
      for (let i = 0; i < 40 && !world.over; i++) world.update(1 / 60, input);
      assert(world.over && overs === 1, `the player died and ${overs} summaries came out`);
      assert(ended.won === false, `a lost campaign reported won=${ended.won}`);
      assert(world.campaign.done && world.campaign.won === false, 'the campaign was left undecided');
      assert(world.campaign.index === 0, 'a lost campaign advanced a mission');
      return `dead on mission 1: won=false at wave ${ended.wave}`;
    } finally { S.restoreShared(snap); }
  });

  /* ══ what the ships left behind ═════════════════════════════════════ */

  check('set-pieces: the general still has somewhere to be', async () => {
    /**
     * `SET_PIECE.unshift({ type: 'bodyguard', from: 10 })` at the foot of
     * Levels.js, and the archetype carries `setPieceOnly: true` — so it can
     * never arrive as fill and `_setPiece` fields it only on a level whose own
     * pool names the type. Three times now a level deletion has taken the only
     * pool that named it — the Foundry, then the Providence — and each time a
     * finished boss (its own Djem So form, an armoured torso, a whole paragraph
     * of counter-play) came within one commit of being unreachable by any route
     * in the game. `drifts` carries it today. This check is what makes the next
     * deletion loud instead of silent.
     */
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const { SET_PIECE } = await import('../../src/game/Waves.js');
    const setPieces = SET_PIECE.map((s) => s.type);
    const orphans = setPieces.filter((t) => !LEVEL_ORDER.some((k) => (LEVELS[k].pool || []).includes(t)));
    assert(!orphans.length,
      `${orphans.length} set-piece(s) no level's pool can field: ${orphans.join(', ')} — `
      + '`_setPiece` filters on the pool, so these can never arrive by any route');
    assert(ARCHETYPES.bodyguard?.setPieceOnly, 'the general stopped being a set-piece');
    const homes = LEVEL_ORDER.filter((k) => (LEVELS[k].pool || []).includes('bodyguard'));
    assert(homes.length >= 1, 'no level fields the IG-100 general');
    return `${setPieces.length} set-pieces, all fieldable; the general is on ${homes.join(', ')}`;
  });

  check('presets: a terrain preset nobody builds on is content nobody can reach', async () => {
    /**
     * THE TRIPWIRE, and it is the cheapest one in this file.
     *
     * `src/world/Terrain.js` holds fifteen presets, each a hundred-odd lines of
     * authored landform, palette, surface memory and measured notes. Eight of
     * them have no level: some were orphaned when levels were struck, and
     * `dunes` and `arena` never had one at all while DESIGN.md §6 was still
     * naming the Dune Sea and the Geonosis Arena as the game's levels. Nothing
     * failed when that happened, which is the whole problem — an orphaned
     * preset is invisible.
     *
     * The bar is the count at the time this was written and it may only FALL.
     * That is deliberate rather than lazy: reviving one is a level and deleting
     * one is a decision, and both are fine — what is not fine is the number
     * going up quietly. The named list is in the message so the next reader
     * knows which ones are waiting.
     */
    const { TERRAIN_PRESETS } = await import('../../src/world/Terrain.js');
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const used = new Set(LEVEL_ORDER.map((k) => LEVELS[k]?.terrain));
    const orphans = Object.keys(TERRAIN_PRESETS).filter((k) => !used.has(k)).sort();
    for (const k of used) assert(TERRAIN_PRESETS[k], `a level is built on '${k}', which is not a preset`);
    /**
     * THE BAR WENT UP ONCE, AND THE REASON IS RECORDED BECAUSE THE RULE SAYS
     * IT MAY NOT.
     *
     * It read 6 and said "this bar may only fall". Deleting a level is the one
     * move that raises it without anybody writing a preset: the Boarding Bay
     * and the Providence were struck on the player's word and their two grounds
     * — `hangar` and `warship` — went back on the waiting list, 6 → 8. That is
     * a deletion the player asked for and not a preset somebody added quietly,
     * which is the thing the bar exists to catch, so the number moved and this
     * paragraph is the price of moving it.
     *
     * `hangar` is not as orphaned as it looks: `DOJO_LEVEL` in src/game/Dojo.js
     * stands on it, and the dojo is not in `LEVEL_ORDER` because Training is
     * not a ground a player picks from the theatre column. `warship` is the
     * only one of the eight that nothing at all builds.
     */
    assert(orphans.length <= 8,
      `${orphans.length} terrain presets have no level: ${orphans.join(', ')} — each is a hundred lines `
      + 'of authored landform nobody can reach, and this bar may only fall');
    return `${used.size} of ${Object.keys(TERRAIN_PRESETS).length} presets built on; `
      + `${orphans.length} waiting (${orphans.join(', ')})`;
  });
}
