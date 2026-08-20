/**
 * BATTLEFRONT BORZ — HOW A RUN ENDS, IN EVERY MODE.
 *
 * There are eight modes and there were four ways out of one, each written where
 * it happened: `_checkWipe` for the wipe, `_endSkirmish` for a cleared battle,
 * `_endMeeting` for a decided match, `CommandDirector._endCampaign` for a
 * finished advance. Three of the four said something on screen. The fourth —
 * and it is the one every player meets first — said nothing at all, and it
 * covered the LOSING half of two modes that can be won.
 *
 * Measured before the fix, driving the shipped code:
 *
 *   skirmish, player down    last line "THE COLOSSEUM — ENGAGEMENT 1 OF 4",
 *                              audio.runWon fired 0 times
 *   command,  player down    last line "WAVE 1 · 8 contacts inbound",
 *                              audio.runWon fired 0 times
 *   duel,     wave 30+       nothing ever ends: the ladder plateaus and the
 *                              blurb promises "a master at the top"
 *
 * So the property this file holds is one sentence: A RUN THAT ENDED SAYS SO,
 * AND A RUN THAT WAS DECIDED SAYS WHICH WAY. It is held over every mode in
 * `MODES` rather than over a list typed here, because the list is what goes
 * stale — this game has gained three modes in two sessions and each of them
 * arrived with an ending nobody had written.
 *
 * Every module is reached by `await import` inside a check body, for the reason
 * tools/checks/materials.mjs gives: a static edge from a check file to
 * Engine.js burns its once-only ShaderChunk flags against the wrong copy of
 * three.
 */

const STEP = 1 / 60;

/** A world in a stated mode, with every stochastic stream on a stated number. */
async function boot(mode, level = 'colosseum', seed = 31) {
  const H = await import('./_coop.mjs');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { seedWaves } = await import('../../src/game/Waves.js');
  enemyRng.seed(seed);
  seedWaves(seed, 0);
  const { world } = await H.bootWorld({ level, settings: { quality: 'low', difficulty: 'knight', mode } });
  world.runSeed = seed;
  return { world, input: H.idleInput() };
}

/**
 * Everything a player is told when a run ends, collected off the shipped seams.
 *
 * `notify` is the line on screen, `onGameOver` is the card, `audio.runWon` is
 * the cue. All three are wrapped rather than re-implemented — the words are
 * whatever the game says, and what is asserted is that it says them.
 */
function listen(world, audio) {
  const said = [];
  const notify = world.notify.bind(world);
  world.notify = (t, sub) => { said.push([String(t), String(sub ?? '')]); notify(t, sub); };
  const state = { said, sounded: [], overs: 0, stats: null };
  world.onGameOver = (s) => { state.overs++; state.stats = s; };
  state.restoreAudio = audio.runWon;
  audio.runWon = (w) => { state.sounded.push(!!w); return state.restoreAudio?.call(audio, w); };
  return state;
}
const VERDICT = /\b(WON|LOST|DEFEAT|OVER|CLIMBED|YOURS)\b/;

export async function run({ check, assert }) {

  check('endings: every mode a player can lose ends, and the loss is on screen', async () => {
    /**
     * ONE DRIVE PER SHIPPED MODE, to the same event: the player goes down.
     *
     * WHICH MODES OWE A VERDICT IS MEASURED, NOT LISTED. A mode owes one if the
     * run it builds can be won — and that is three declarations and one
     * measurement rather than four names: `battles` (a bounded battle with an
     * army), `ladder` (a climb with a last rung), and "leads an army but is not
     * a bounded battle", which is Command and is read off `world.command`
     * rather than off the string 'command'. A ninth mode is therefore covered
     * by this check on the day it is authored, which a list of eight names
     * would not be.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    const { audio } = await import('../../src/engine/Audio.js');
    const real = audio.runWon;
    try {
      const { MODES } = await import('../../src/game/Waves.js');
      const rows = [];
      const gave = [];
      const owes = [];
      let unkillable = [];
      for (const mode of Object.keys(MODES)) {
        const { world, input } = await boot(mode);
        const heard = listen(world, audio);
        try {
          /* Through the ordinary door: main.js's deploy path for every mode
           * that is not Command or training is `director.start(1)`, and the
           * modes that open themselves do it on the first frame. */
          if (!world.command?.active) world.director.start?.(1);
          for (let i = 0; i < 60 && !world.over; i++) world.update(STEP, input);
          const armied = !!world.command;
          if (MODES[mode].battles || MODES[mode].ladder || (armied && !MODES[mode].battles)) owes.push(mode);
          world.player?.damage?.(1e9, null, 'probe');
          for (let i = 0; i < 90 && !world.over; i++) world.update(STEP, input);

          /* THE ONE MODE WITH NO ENDING IS THE ONE WITH NO DEATH, and it says
           * so itself: `World.training` is the flag the dojo sets, and the mode
           * card's promise is "nothing here can kill you". Identified off the
           * flag rather than off the name. */
          if (world.training) {
            assert(!world.over && world.player?.alive,
              'the training mode killed the player — its card says nothing here can kill you');
            assert(heard.overs === 0, `training raised ${heard.overs} run summaries`);
            unkillable.push(mode);
            rows.push(`${mode} cannot end`);
            continue;
          }

          assert(world.over, `${mode}: the player died and the run went on`);
          /* THE CARD. `main.js:gameOver(stats)` is the one ending a player
           * sees in every mode, and it cannot draw a row it was not sent. */
          assert(heard.overs === 1, `${mode} raised ${heard.overs} run summaries for one death`);
          for (const k of ['wave', 'score', 'kills', 'deflects', 'perfects', 'limbs']) {
            assert(typeof heard.stats[k] === 'number', `${mode}'s summary has no ${k}`);
          }

          const verdict = heard.said.filter(([t]) => VERDICT.test(t));
          /* SAID AND SOUNDED TOGETHER, both ways. A verdict with no cue is the
           * mute defeat this file was written for; a cue with no verdict is a
           * fanfare over a screen that does not say what happened. */
          assert(!!verdict.length === !!heard.sounded.length,
            `${mode} said ${verdict.length} verdict(s) and played ${heard.sounded.length} cue(s)`);
          if (verdict.length) {
            gave.push(mode);
            assert(verdict.length === 1,
              `${mode} announced the end ${verdict.length} times: ${verdict.map(([t]) => t).join(' / ')}`);
            assert(/\b(LOST|DEFEAT)\b/.test(verdict[0][0]),
              `${mode} lost and the line reads "${verdict[0][0]}"`);
            assert(verdict[0][1].length > 0, `${mode}'s verdict has no second line to say how far you got`);
            assert(heard.sounded.length === 1 && heard.sounded[0] === false,
              `${mode} played runWon(${heard.sounded.join(',')}) for a defeat`);
            /* …AND THE SUMMARY AGREES WITH THE SCREEN. A run that was announced
             * as lost must be RECORDED as lost — `Progress.recordRun` keys
             * `wins` and `crowned` on this field. */
            assert(heard.stats.won === false,
              `${mode} said "${verdict[0][0]}" and filed won=${JSON.stringify(heard.stats.won)}`);
            rows.push(`${mode} "${verdict[0][0]}"`);
          } else {
            /* An endless mode has no verdict to give, and must not invent one:
             * its summary carries no `won` at all, which is what keeps
             * `recordRun`'s "walked away" state distinguishable. */
            assert(!('won' in heard.stats),
              `${mode} sent won=${JSON.stringify(heard.stats.won)} without deciding anything`);
            assert(heard.stats.taken === null,
              `${mode} takes no ground and reported taken=${heard.stats.taken}`);
            rows.push(`${mode} card only`);
          }
        } finally {
          audio.runWon = heard.restoreAudio;
          world.unload?.();
        }
      }
      assert(unkillable.length === 1,
        `${unkillable.length} modes cannot kill the player (${unkillable.join(', ')}) — one is the dojo `
        + 'and a second one is a mode nobody can lose');
      assert(gave.join() === owes.join(),
        `these modes can be won and did not say they were lost: `
        + `${owes.filter((m) => !gave.includes(m)).join(', ') || 'none'}; and these announced a verdict `
        + `they have no way to decide: ${gave.filter((m) => !owes.includes(m)).join(', ') || 'none'}`);
      assert(owes.length >= 4, `only ${owes.length} modes can be decided — the detector is wrong`);
      return `${rows.join(', ')}; ${owes.length} of ${Object.keys(MODES).length} decidable, all announced`;
    } finally { audio.runWon = real; S.restoreShared(snap); }
  });

  check('endings: a run that is WON says a different thing, and there is one place that says it', async () => {
    /**
     * The other half. Two victories driven here — the ladder and the battle —
     * because they are the two cheapest; `tools/checks/command.mjs` and
     * `tools/checks/campaigns.mjs` drive the advance and the campaign to theirs
     * and hold the summary. What this adds is that the WORDS differ from the
     * defeat's and the cue carries `true`.
     *
     * AND THAT THERE IS ONE PLACE. `_endSkirmish` used to hold its own notify
     * and cue, `_endCampaign` held a second pair, and the wipe had neither — so
     * the mode that could be lost most easily was the one with nothing written
     * for it. `World._announceBattle` is the single builder now, and the source
     * clause is what stops a fifth ending rolling its own: the only other
     * `audio.runWon` in the game is `_endMeeting`'s, whose verdict is answered
     * per machine and is a different question.
     */
    const S = await import('./_shared.mjs');
    const snap = await S.snapshotShared();
    const { audio } = await import('../../src/engine/Audio.js');
    const real = audio.runWon;
    try {
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      const cues = [...code.matchAll(/audio\.runWon\??\.\(/g)].length;
      assert(cues === 2,
        `${cues} places in World.js play the run's ending cue — it is _announceBattle and _endMeeting, `
        + 'and a third is an ending that has written its own announcement again');
      const cmd = (await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      assert(!/audio\.runWon/.test(cmd),
        'CommandDirector plays the ending cue itself again — that is the second announcement World._announceBattle replaced');

      const rows = [];

      /* THE LADDER. Started on the wave the climb runs out on, which is the
       * mode's own answer and not a number typed here. */
      {
        const { world, input } = await boot('duel', 'colosseum', 31);
        const heard = listen(world, audio);
        try {
          const top = world.director.duelTop();
          world.director.start(top);
          for (let t = 0; t < 400 && !world.over; t++) {
            for (let i = 0; i < 20 && !world.over; i++) {
              if (world.player) world.player.hp = world.player.maxHp;
              world.update(STEP, input);
            }
            for (const e of world.enemies) if (!e.dead) e.damage?.(1e9, null, 'probe');
          }
          assert(world.over, `the duel cleared wave ${top}, the top of its own ladder, and carried on`);
          const verdict = heard.said.filter(([t]) => VERDICT.test(t));
          assert(verdict.length === 1 && !/\b(LOST|DEFEAT)\b/.test(verdict[0][0]),
            `the top of the ladder was announced as ${JSON.stringify(verdict.map(([t]) => t))}`);
          assert(heard.sounded.length === 1 && heard.sounded[0] === true,
            `a climbed ladder played runWon(${heard.sounded.join(',')})`);
          assert(heard.stats.won === true, `a climbed ladder filed won=${heard.stats.won}`);
          const { rungs } = world.director.duelRoster();
          assert(heard.stats.taken === rungs.length,
            `the card reports ${heard.stats.taken} of ${rungs.length} forms faced at the top of the ladder`);
          rows.push(`duel "${verdict[0][0]}" at wave ${top}, ${heard.stats.taken} forms`);
        } finally { audio.runWon = heard.restoreAudio; world.unload?.(); }
      }

      /* THE BATTLE. Two engagements, both cleared by killing the field. */
      {
        const { world, input } = await boot('skirmish', 'colosseum', 4242);
        const heard = listen(world, audio);
        try {
          world.beginSkirmish({ engagements: 2, strength: 10, pressure: 1 });
          for (let t = 0; t < 260 && !world.over; t++) {
            for (let i = 0; i < 30 && !world.over; i++) {
              if (world.player) world.player.hp = world.player.maxHp;
              world.update(STEP, input);
            }
            for (const e of world.enemies) if (e.team !== world.partyTeam && !e.dead) e.damage?.(1e9, null, 'probe');
          }
          assert(world.over && heard.stats?.won === true,
            `the battle did not resolve: ${JSON.stringify(heard.stats)}`);
          const verdict = heard.said.filter(([t]) => VERDICT.test(t));
          assert(verdict.length === 1 && /\bWON\b/.test(verdict[0][0]),
            `a won battle was announced as ${JSON.stringify(verdict.map(([t]) => t))}`);
          assert(heard.sounded.length === 1 && heard.sounded[0] === true,
            `a won battle played runWon(${heard.sounded.join(',')})`);
          assert(heard.stats.taken === 2,
            `two engagements were cleared and the card reports ${heard.stats.taken}`);
          rows.push(`skirmish "${verdict[0][0]}", taken ${heard.stats.taken}`);
        } finally { audio.runWon = heard.restoreAudio; world.unload?.(); }
      }
      return `${rows.join('; ')}; ${cues} cue call sites in World.js, 0 in Command.js`;
    } finally { audio.runWon = real; S.restoreShared(snap); }
  });

  check('endings: the duel ladder has a last rung, and past it nothing changes', async () => {
    /**
     * WHY THE DUEL NEEDED AN ENDING AT ALL, stated as the measurement that
     * found it rather than as an opinion about the mode.
     *
     * `duelFloor`'s note says the climb "runs to the top of the roster and
     * stops there, on a wave of masters, which is what 'a master at the top'
     * says". That is true of the climb and was false of the mode: the window
     * narrows to its last two rungs and then every wave is the same wave for
     * ever. This asserts both halves — that `duelTop` IS the first wave at
     * which the climb has run out AND a set piece, and that the composer's
     * answer stops moving there — so the ending is at the place the mode stops
     * being a ladder and not at a depth somebody liked the sound of.
     *
     * Table only: it drives the composer, never a World.
     */
    const Waves = await import('../../src/game/Waves.js');
    await import('../../src/game/Levels.js');     // registers 16 more archetypes
    const stub = { enemies: [], players: [], settings: {}, takenBoons: new Set(),
      notify() {}, spawnEnemy: () => ({}) };
    const d = new Waves.WaveDirector(stub, { mode: 'duel' });
    const { rungs, bosses } = d.duelRoster();
    const top = d.duelTop();
    const cap = Math.max(0, rungs.length - 2);

    assert(d.isBossWave(top), `the ladder's last rung, wave ${top}, is not a set-piece wave`);
    assert(d.duelFloor(top) >= cap, `at wave ${top} the window can still climb: floor ${d.duelFloor(top)} of ${cap}`);
    /* FIRST, not merely one: an ending on any later boss wave would be an
     * arbitrary depth wearing a derivation. */
    for (let w = 1; w < top; w++) {
      assert(!(d.duelFloor(w) >= cap && d.isBossWave(w)),
        `wave ${w} also runs the climb out on a set piece, so ${top} is not the first`);
    }
    assert(top > Waves.DUEL_RUNG * rungs.length,
      `the ladder ends at wave ${top}, before its ${rungs.length} rungs have all opened`);

    /* THE PLATEAU IT ENDS. Every wave past the top draws from the same window
     * at the same size with the same promotions — which is what "nothing
     * changes" means, and it is measured out to three more full climbs. */
    const shape = (w) => `${d.duelWindow(w).join(',')}|${d.duelSize(w)}|${d.duelElites(w)}`;
    const atTop = shape(top);
    let moved = 0;
    for (let w = top + 1; w <= top + Waves.DUEL_RUNG * rungs.length * 3; w++) {
      if (shape(w) !== atTop) moved++;
    }
    assert(moved === 0,
      `${moved} waves past the top still differ from it — the ladder has not run out at ${top}`);
    /* …and something DID move on the way up, so the plateau is a plateau and
     * not the whole mode. */
    assert(shape(1) !== atTop, 'wave 1 already composes the top of the ladder');
    const M = await import('../../src/game/Waves.js');
    assert(M.MODES.duel.ladder === true,
      'the duel does not declare that it ends, so World will never end it');
    return `${rungs.length} rungs + ${bosses.length} bosses; the climb runs out at wave ${top} `
      + `(${d.duelWindow(top).join(', ')} × ${d.duelSize(top)}, ${d.duelElites(top)} promoted, set piece), `
      + `and ${Waves.DUEL_RUNG * rungs.length * 3} waves past it compose identically`;
  });
}
