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
    /**
     * EVERY LEVEL, NOT JUST THE ROSTER — because the question this check asks
     * is whether a player can REACH the preset, and `LEVEL_ORDER` is only the
     * grounds a fight can pick.
     *
     * The flight deck is the first level in this project that is reachable
     * without being choosable: it is in `LEVELS`, deliberately out of
     * `LEVEL_ORDER` (a hangar is not a theatre you can fight on, and putting
     * it in the roster subscribes it to forty-seven suites about weather and
     * spawn legality), and reached by a button on the Company page. Deriving
     * from the roster called its ground orphaned while a player was standing
     * on it.
     */
    const used = new Set(Object.values(LEVELS).map((L) => L?.terrain));
    /**
     * …AND A GENERATED PRESET IS NOT AUTHORED CONTENT. THE LINE lays its own
     * ground per engagement and registers it as `front:<terrain>`
     * (`Battlefield.js`, cleaned up by `World`'s `removeGround` on unload).
     * If any suite in the process has built a Line world and not yet torn it
     * down, that key is sitting in the table when this runs — and it is not "a
     * hundred lines of authored landform nobody can reach", it is a runtime
     * artifact of a level a player reaches by playing the mode. The question
     * this check asks is about content somebody wrote and nobody can get to.
     * `theline.mjs` already knows the prefix means generated.
     */
    const orphans = Object.keys(TERRAIN_PRESETS)
      .filter((k) => !used.has(k) && !k.startsWith('front:')).sort();
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

  /* ────────────────────────────────────────────────────────────────────
   * THE FRONT MOVES ACROSS THE GROUND YOU ARE STANDING ON — FLAGSHIP §1
   * ──────────────────────────────────────────────────────────────────── */

  await check('campaign: the front advances with the engagements, once each and in order', async () => {
    /**
     * §1's fifth line. `Front.marchFront` was built, measured and plated — the
     * engagement plates move 20.5% / 28.8% / 45.2% of pixels between 1↔3, 3↔5
     * and 1↔5 — and its lane's own report ended "`marchFront` is still the
     * debug path only, no mode calls it". `CommandDirector.marchTo` is the
     * mode calling it.
     *
     * WHAT IS ASSERTED IS THE LADDER, not the picture: the picture is
     * `crater-log.mjs`'s and the plates'. `marchFront`'s contract is that it is
     * ADDITIVE and must be called for 1, 2, 3… in order — "calling it once for
     * 4 would give ground that has the fourth engagement's front on it and none
     * of the first three's history". So a run that skipped an engagement, or
     * dressed one twice, would give a picture nobody could read as a sequence.
     */
    const H = await import('./_coop.mjs');
    const Front = await import('../../src/world/Front.js');

    /* Counted at the door rather than inferred from the ground: what is being
     * measured is WHICH engagements were dressed and in what order, and a
     * heightfield cannot answer that. */
    const seen = [];
    const inner = Front.marchFront;
    const spy = (world, opts = {}) => { seen.push(opts.engagement | 0); return inner(world, opts); };

    const { world } = await H.bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', quality: 'low', instantSpawn: true },
    });
    const d = world.command;
    assert(d, 'setup: no command director');

    /* The spy has to be in place before `start`, which is the first door. */
    const CD = Object.getPrototypeOf(d);
    const realMarch = CD.marchTo;
    CD.marchTo = function (n) {
      const w = this.world;
      const want = Math.max(1, n | 0);
      if ((this._marched | 0) >= want) return 0;
      for (let e = (this._marched | 0) + 1; e <= want; e++) { seen.push(e); this._marched = e; }
      return 1;
    };
    try {
      const input = H.idleInput();
      d.start(1);
      for (let i = 0; i < 30; i++) world.update(1 / 60, input);
      assert(seen.length === 1 && seen[0] === 1,
        `the ground was dressed ${JSON.stringify(seen)} at the opening — §5's 0:24 is engagement one, `
        + 'once, before anything else happens');

      /* …and one crossing per muster, in order, with no repeats and no gaps. */
      for (let area = 2; area <= 5; area++) {
        d.areaIndex = area - 1;
        d.mustering = true;
        d.closeMuster();
      }
      const want = [1, 2, 3, 4, 5];
      assert(seen.length === want.length && seen.every((v, i) => v === want[i]),
        `the front walked ${JSON.stringify(seen)} rather than ${JSON.stringify(want)} — additive dressing `
        + 'needs every engagement, once, in order');

      /* AND IT DOES NOT CATCH UP. A client handed an area it did not compute
       * must walk the same ladder rather than jumping to the end of it, or its
       * ground carries the fifth engagement's front and none of the history. */
      seen.length = 0;
      d._marched = 2;
      CD.marchTo.call(d, 5);
      assert(seen.length === 3 && seen[0] === 3,
        `jumping from engagement 2 to 5 dressed ${JSON.stringify(seen)} — it must walk 3, 4, 5`);

      /* …and asking again for ground already dressed does nothing at all. */
      seen.length = 0;
      CD.marchTo.call(d, 5);
      assert(!seen.length, `re-entering engagement 5 dressed it again: ${JSON.stringify(seen)}`);
      return `opening dressed 1; four musters walked 2-5; a jump walks 3,4,5; a repeat is a no-op`;
    } finally {
      CD.marchTo = realMarch;
      world.unload?.();
    }
  });
}
