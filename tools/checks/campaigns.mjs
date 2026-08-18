/**
 * BATTLEFRONT BORZ — CAMPAIGNS, AND THE TWO SHIPS.
 *
 * Player notes #21 and #47 ask for two campaigns and both come with the same
 * second sentence: what makes a sequence of fights a campaign rather than a
 * playlist. `Levels.CAMPAIGNS` answers it in three parts — the order is
 * authored, every ground carries a brief, and the shape of the battle is part
 * of the mission — and this file holds all three to being true of a run rather
 * than of a table.
 *
 * THE OTHER HALF IS UNREACHABLE CONTENT, which is what the ships are really
 * about. Before this pass `src/world/Terrain.js` held EIGHT terrain presets no
 * level used; `works()` in Levels.js — 300 lines, and the only `BlastDoor`
 * construction in a game whose DESIGN.md calls the twenty-second door hold a
 * signature mechanic — had no caller at all; and the IG-100 general registered
 * as a SET_PIECE at the foot of Levels.js was gated on a pool that no longer
 * existed. Finished work nobody could reach is the most expensive kind of
 * defect this repository has, because nothing fails when it happens. The last
 * check in this file is the tripwire that notices the next one.
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
    assert(CAMPAIGN_IDS.length >= 2, `${CAMPAIGN_IDS.length} campaign(s) — the notes asked for two`);
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
      const { world, input } = await boot({ mode: 'campaign' }, C.missions[0].level, 77);
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
      const { world, input } = await boot({ mode: 'campaign' }, 'colosseum', 91);
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

  check("campaigns: a mission's own terms are in force on the ground it is fought on", async () => {
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    try {
      const { CAMPAIGNS } = await import('../../src/game/Levels.js');
      const { AREAS } = await import('../../src/game/Command.js');
      const C = CAMPAIGNS.boarding;
      const { world, input } = await boot({ mode: 'campaign' }, C.missions[0].level, 303);
      // Frame one: the opening mission's pressure, off the mission and not a default.
      world.update(1 / 60, input);
      assert(world.campaign?.id === 'boarding', `the hangar opened ${world.campaign?.id}`);
      assert(world.command.areaIndex === C.missions[0].pressure,
        `mission one is at pressure ${world.command.areaIndex}, not ${C.missions[0].pressure}`);
      assert(world.skirmish.engagements === C.missions[0].engagements, 'mission one is the wrong length');
      let peak = 0;
      for (let t = 0; t < 500 && world.campaign.index === 0 && !world.over; t++) {
        for (let i = 0; i < 30 && !world.over; i++) {
          if (world.player) world.player.hp = world.player.maxHp;
          world.update(1 / 60, input);
        }
        for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(99999, null, 'probe');
      }
      assert(world.campaign.index === 1, 'never reached the deck');
      for (let i = 0; i < 60; i++) { world.player.hp = world.player.maxHp; world.update(1 / 60, input); peak = Math.max(peak, world.command.roster.strength); }
      assert(world.command.areaIndex === C.missions[1].pressure,
        `mission two is at pressure ${world.command.areaIndex}, not ${C.missions[1].pressure}`);
      assert(peak >= C.missions[1].strength,
        `mission two asked for ${C.missions[1].strength} on the line and fielded ${peak}`);
      return `${AREAS[C.missions[0].pressure].name} → ${AREAS[C.missions[1].pressure].name}, ${peak} on the line`;
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

  /* ══ the ships ════════════════════════════════════════════════════════ */

  check('ships: the deck builds the only blast doors in the game, and they are real', async () => {
    /**
     * `works()` held the only `BlastDoor` construction in the tree and had no
     * caller — `levels-quality`'s door check has been red for exactly that
     * reason and says so in its own message: "unreachable content is the defect
     * here, not this assertion". This is the other end of it, from the level
     * side, so a future pass that stops calling `works` fails here as well as
     * there.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'warship', settings: { quality: 'low' } });
    const n = world.doors.length, caps = world.doors[0]?.capsules().length ?? 0;
    assert(n >= 3, `the Providence builds ${n} blast doors`);
    for (const d of world.doors) {
      assert(d.collider && world.physics.staticBoxes.includes(d.collider), 'a door with no collider in the world');
      assert(d.capsules().length > 4, `a door the blade cannot find (${d.capsules().length} capsules)`);
    }
    /* Counted BEFORE the dispose: `unload` empties `world.doors`, so a return
     * line built after it reports zero on a check that has just passed. */
    world.dispose();
    return `${n} bulkheads, each a collider and ${caps} blade capsules`;
  });

  check('ships: the general has somewhere to be again', async () => {
    /**
     * `SET_PIECE.unshift({ type: 'bodyguard', from: 10 })` at the foot of
     * Levels.js, and the archetype carries `setPieceOnly: true` — so it can
     * never arrive as fill and `_setPiece` fields it only on a level whose own
     * pool names the type. No pool has since the Foundry was struck, which made
     * a finished boss (its own Djem So form, an armoured torso, a whole
     * paragraph of counter-play) unreachable by any route in the game.
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

  check('ships: neither ground is a box, and they are not boxes in different ways', async () => {
    /**
     * The roster was cut from thirteen to seven on one finding: "a roof plus
     * four walls at the draw budget this engine has is a box, and a box is the
     * one shape that cannot be anywhere." Two interiors are back, so the
     * finding gets an instrument rather than a promise — and the instrument had
     * to be built twice, because the first version asked the wrong question of
     * one of the two grounds.
     *
     * IT FIRST ASKED THE DELETED `descent.mjs` QUESTION: walk sixteen bearings
     * and stop at ground steeper than 0.55 of 1−cos, i.e. 63°. The Providence
     * passes it 16/16 — its own preset note records two rounds of work getting
     * the fore-and-aft hull from 62.4° to 72° for exactly that reason. The
     * Boarding Bay failed it 16 of 16, and the measurement is right: its shell
     * is `smoothstep(74, 132, d) * 42`, whose steepest tangent is 47°, so a
     * player really can walk up the inside of the hull.
     *
     * WHICH IS NOT AN ESCAPE, and this is the distinction the check now draws.
     * Walking up that hull takes you UP, under a 22 m deckhead, on ground that
     * climbs 42 m — you end up in the roof, not outside the level. A bay is
     * bounded by rising into its own overhead rather than by a cliff, which is
     * what a landing deck inside a hull actually is. So each ground is asked
     * the question its own shape answers:
     *
     *   THE PROVIDENCE  a wall. 63° on every bearing, the strict test.
     *   THE BOARDING BAY  a climb. At least 18 m of rise before 120 m out, so
     *                     there is no bearing along which the floor simply
     *                     continues.
     *
     * AND BOTH HAVE TO HAVE A SHAPE, which is the half that separates a place
     * from a room: the spread of floor height over the walkable middle. A plate
     * reads ~0; a trench, a ramp and a raised bridge do not.
     */
    const THREE = await import('three');
    const { Terrain } = await import('../../src/world/Terrain.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const rows = [];
    const relief = (t) => {
      let lo = Infinity, hi = -Infinity, n = 0;
      for (let z = -60; z <= 60; z += 4) {
        for (let x = -60; x <= 60; x += 4) {
          if (t.slopeAt(x, z) > 0.55) continue;
          const h = t.height(x, z);
          lo = Math.min(lo, h); hi = Math.max(hi, h); n++;
        }
      }
      return { spread: hi - lo, n };
    };

    const deck = new Terrain(new THREE.Scene(), LEVELS.warship.terrain, 0.5);
    let escapes = 0;
    for (let b = 0; b < 16; b++) {
      const a = (b / 16) * Math.PI * 2;
      let walled = false;
      for (let r = 8; r <= 130; r += 2) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!deck.inBounds(x, z, 2)) { walled = true; break; }
        if (deck.slopeAt(x, z) > 0.55) { walled = true; break; }
      }
      if (!walled) escapes++;
    }
    assert(escapes === 0, `warship: ${escapes} of 16 bearings walk out of the level`);
    const dr = relief(deck);
    assert(dr.n > 400, `warship: only ${dr.n} samples of floor`);
    assert(dr.spread > 4,
      `the Providence's deck has ${dr.spread.toFixed(1)} m of relief over ${dr.n} samples — it is one plane`);
    rows.push(`warship 16/16 walled at 63°, ${dr.spread.toFixed(1)} m of relief`);
    deck.dispose();

    const bay = new Terrain(new THREE.Scene(), LEVELS.hangar.terrain, 0.5);
    /* WALKED TO THE EDGE OF THE HEIGHTFIELD, not to a radius. The shell is a
     * CHEBYSHEV distance, so a bearing down the diagonal is still on flat deck
     * at r = 120 while one down an axis is 40 m up the hull — measured, the
     * diagonal had climbed 4.2 m at 120 and 21.8 m by the time it left bounds.
     * Asking a square room a question in polar coordinates is how you get an
     * answer about the question. */
    let worst = Infinity;
    for (let b = 0; b < 16; b++) {
      const a = (b / 16) * Math.PI * 2;
      const h0 = bay.height(Math.cos(a) * 8, Math.sin(a) * 8);
      let climb = 0;
      for (let r = 8; r <= 220; r += 2) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!bay.inBounds(x, z, 2)) break;
        climb = Math.max(climb, bay.height(x, z) - h0);
      }
      worst = Math.min(worst, climb);
    }
    assert(worst >= 18,
      `hangar: the shallowest bearing climbs only ${worst.toFixed(1)} m before it leaves the heightfield `
      + '— the deck just carries on');
    const br = relief(bay);
    assert(br.n > 400, `hangar: only ${br.n} samples of floor`);
    rows.push(`hangar climbs ${worst.toFixed(0)} m on its shallowest bearing into a 22 m deckhead`);
    bay.dispose();
    return rows.join('; ');
  });

  check('presets: a terrain preset nobody builds on is content nobody can reach', async () => {
    /**
     * THE TRIPWIRE, and it is the cheapest one in this file.
     *
     * `src/world/Terrain.js` holds sixteen presets, each a hundred-odd lines of
     * authored landform, palette, surface memory and measured notes. Eight of
     * them had no level: some were orphaned when three levels were struck, and
     * `dunes`, `arena` and `hangar` never had one at all while DESIGN.md §6 was
     * still naming the Dune Sea, the Geonosis Arena and Hangar Bay as the
     * game's levels. Nothing failed when that happened, which is the whole
     * problem — an orphaned preset is invisible.
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
    assert(orphans.length <= 6,
      `${orphans.length} terrain presets have no level: ${orphans.join(', ')} — each is a hundred lines `
      + 'of authored landform nobody can reach, and this bar may only fall');
    return `${used.size} of ${Object.keys(TERRAIN_PRESETS).length} presets built on; `
      + `${orphans.length} waiting (${orphans.join(', ')})`;
  });
}
