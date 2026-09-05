/**
 * BATTLEFRONT BORZ — the record, and the win it could not hold.
 *
 * `Progress.js` exists to answer one complaint about this game: "you could play
 * for an hour and the game would not know you had ever played". It was fixed for
 * one mode, then for four, and it was still refusing the fifth — and the fifth
 * is the only one in the game that can be WON.
 *
 * Two properties are asserted here and both were false when this file was
 * written:
 *
 *   A MODE THAT CAN BE LOST OR WON LEAVES A TRACE. `RECORDED` did not contain
 *     'command', so a five-area campaign — two dozen named bodies, a casualty
 *     list, the deepest thing this game asks anybody to do — wrote nothing at
 *     all. A player could finish it and the menu would still read "No runs yet".
 *
 *   A WIN IS RECORDABLE. `recordRun` has had `if (summary.won) p.wins++` and a
 *     `crowned` list beside it since the file was added, and NOTHING IN `src/`
 *     HAS EVER PASSED `won` — the Descent was the only mode with a top and it
 *     was deleted. Both fields were structurally pinned: `wins` at 0 and
 *     `crowned` at empty for every player who has ever run this game. That is
 *     not a bug you can find by reading `recordRun`, because `recordRun` is
 *     correct; it is only visible from the call sites, which is why the check
 *     below drives a real campaign to a real victory rather than constructing a
 *     summary by hand.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED ───────────────────────────────────
 *
 * Anything that would make this a progression system. The file's own header
 * refuses unlocks, currency and cross-run power, `DESIGN.md` agrees, and a check
 * that measured "how much does a run give you for next time" would be asking a
 * question the project has answered NO to on purpose.
 */

import { MODES } from '../../src/game/Waves.js';

const KEY = 'saber.progress.v1';

/** Run `fn` against an empty store and put the player's own back afterwards. */
async function withCleanStore(fn) {
  const had = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
  try { return await fn(); }
  finally { if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had); }
}

export function run({ check, assert }) {
  check('progress: every mode in the game has been DECIDED about, one way or the other', async () => {
    /**
     * THE SHAPE OF THE DEFECT, NOT THE INSTANCE OF IT.
     *
     * `RECORDED` is a hand-written list of mode names beside `MODES`, which is
     * the hand-maintained-table-beside-its-twin defect (HANDOFF §2.3) in its
     * mildest form — mild because the list is a POLICY and not a derivation: the
     * dojo cannot kill you and the sandbox is a room with a slider, so a
     * "deepest 99 waves" typed into a box is worse than no record at all. Those
     * two are refused on purpose and should stay refused.
     *
     * What is NOT acceptable is a mode that nobody decided about, which is
     * exactly what happened to Command: it was added to `MODES`, shipped, and
     * silently fell through to "not recorded" because a set does not have a
     * default it can complain about. §2.3's close relative — "a missing thing
     * answered with a plausible default instead of an error".
     *
     * So: every key of `MODES` must be either recorded or on the refusal list
     * BELOW, with a reason. Add a mode and this fails until somebody says which.
     * Asserted through `recordRun`'s own behaviour rather than by importing the
     * set, so it is the shipped rule being measured.
     */
    const { recordRun } = await import('../../src/game/Progress.js');
    const REFUSED = {
      training: 'nothing in the lessons can kill you, so there is no run to record',
      sandbox: 'a room with a slider — "deepest 99 waves" would mean somebody typed 99',
      /* THE FLIGHT DECK IS NOT A RUN AND MUST NEVER FILE AS ONE. There is no
       * wave on it, no enemy, no ending and no score; `HangarDirector` exists
       * to answer the four fields the HUD dereferences and to do nothing else.
       * Recording a visit would evict a real run from the forty-deep recent
       * list, and "deepest reached" would count a room you walked into. This
       * is why `quitToMenu` branches to `leaveHangar` before `record()`. */
      hangar: 'a visit is not a run — you walk onto the deck to look at your men',
      /* AND THE STATION IS THE SAME ANSWER, FOR MORE ROOMS. There is no wave
       * on it, no enemy, no ending and no score; what you do there is shop,
       * eat, look after an animal, put men in tanks and watch a race. Filing a
       * visit would evict a real run from the forty-deep recent list and make
       * "deepest reached" count an afternoon spent in a cantina. The clock
       * still runs and the shops still reroll — a station day is a durable
       * thing on `saber.station.v1`, which is a different question to whether
       * a RUN happened. */
      station: 'a visit is not a run — the station is where you live between them',
    };
    const recorded = [], refused = [];
    await withCleanStore(() => {
      for (const mode of Object.keys(MODES)) {
        localStorage.removeItem(KEY);
        const p = recordRun({ mode, wave: 7, score: 100, kills: 3, boons: [] });
        (p.runs === 1 ? recorded : refused).push(mode);
        assert(p.runs === 1 || p.runs === 0, `${mode} recorded ${p.runs} runs from one call`);
      }
    });
    for (const mode of refused) {
      assert(REFUSED[mode],
        `${mode} is a mode in this game and records nothing, and no reason is written down for it. `
        + 'Either it belongs in RECORDED or it belongs on the refusal list in this check.');
    }
    for (const mode of Object.keys(REFUSED)) {
      assert(refused.includes(mode), `${mode} is on the refusal list and is being recorded`);
    }
    assert(recorded.includes('command'),
      'a finished five-area Command campaign leaves no trace in saber.progress.v1');
    assert(recorded.length === Object.keys(MODES).length - refused.length, 'the two lists do not cover MODES');
    return `${recorded.length} recorded (${recorded.join(', ')}), ${refused.length} refused on purpose `
      + `(${refused.join(', ')})`;
  });

  check('progress: a win is a thing the store can hold, and it is shown', async () => {
    /**
     * `wins` and `crowned` are the two fields nothing has ever written. Driven
     * against the real module and the real store, because the arithmetic that
     * matters is `+=` against `Math.max` — some totals accumulate and some do
     * not, which is what made the double-record finding hard to see.
     */
    const { recordRun, loadProgress, progressLines } = await import('../../src/game/Progress.js');
    return withCleanStore(() => {
      const base = { mode: 'command', wave: 21, score: 40000, kills: 180,
        identity: { order: 'jedi', species: 'human' }, boons: ['vitality', 'djemso'] };
      const lost = recordRun({ ...base, wave: 9, won: false });
      assert(lost.runs === 1, 'a lost campaign did not record');
      assert(lost.wins === 0, 'a campaign that ended in a wipe counted as a win');
      assert(lost.crowned.length === 0, 'a lost run put its boons on the crowned list');

      const won = recordRun({ ...base, won: true });
      assert(won.runs === 2, 'the second run did not record');
      assert(won.wins === 1, `${won.wins} wins after one won campaign — \`won\` is not reaching the store`);
      assert(won.crowned.length === 2,
        `${won.crowned.length} boons on the crowned list after a win that held two`);
      assert(won.byMode.command === 21, `the deepest command run reads ${won.byMode.command}`);
      assert(won.recent[0].won === true, 'the run history does not remember that the run was won');
      assert(won.recent[1].won === false, 'the losing run is remembered as a win');

      // A SECOND win adds a win and does NOT re-add its boons — `crowned` is a
      // set of things that have ever worked, not a tally.
      const twice = recordRun({ ...base, won: true, boons: ['djemso', 'vaapad'] });
      assert(twice.wins === 2, 'the second win did not count');
      assert(twice.crowned.length === 3, `crowned holds ${twice.crowned.length}, so it is not a set`);

      // …AND IT IS ON THE SCREEN. Storage nothing displays is a write-only log,
      // which is the thing this file's own header refuses to be.
      const lines = progressLines(loadProgress()).join('\n');
      assert(/2 won/.test(lines), `the record line does not print the wins: "${lines.split('\n')[0]}"`);
      assert(/carried to the end of an advance/.test(lines),
        'the crowned list has no reader anywhere in the tree');
      assert(!/currency|unlock|spend/i.test(lines), 'the record line is selling something');
      return `lost → wins 0; won → wins 1, crowned 2; twice → wins 2, crowned 3; both on the menu line`;
    });
  });

  check('progress: a real campaign, finished, lands in the store as a win', async () => {
    /**
     * END TO END, THROUGH main.js'S OWN `record()`.
     *
     * The two checks above prove `recordRun` can hold a win and that Command is
     * allowed to file one. Neither of them proves the game ever HANDS it one,
     * and that gap is precisely where this defect lived for the whole life of
     * the mode: every field was correct and no caller ever set `won`.
     *
     * So this drives a real World in Command mode to a real victory — the
     * shipped `payWave` → `_areaClear` → `_endCampaign` path, clocked by
     * `world.update` — catches the summary the way `main.js` catches it, and
     * pushes it through the `record()` that main.js actually declares. The lift
     * is history.mjs's: `src/main.js` cannot be imported under Node, so the
     * function's own text is compiled rather than paraphrased, and the lift
     * refuses to run if the function stops matching.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i = src.indexOf('\nfunction record(stats = null) {');
    assert(i > 0, 'main.js no longer declares `function record(stats = null)` — this check describes a file that is gone');
    const end = src.indexOf('\n}\n', i);
    assert(end > i, 'the body of record() could not be delimited');
    const body = src.slice(i + 1, end + 2);
    assert(/recordRun\(/.test(body), 'the lifted record() does not call recordRun — the lift is wrong');
    assert(/\.\.\.\(stats/.test(body),
      'the lifted record() no longer spreads the stats object it is handed, so a `won` on the summary '
      + 'cannot reach the store however faithfully the director sets it');

    const H = await import('./_coop.mjs');
    const Cmd = await import('../../src/game/Command.js');
    const { world } = await H.bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', order: 'jedi' },
    });
    const d = world.command;
    assert(d, 'command mode did not build a command director');
    world.director.start(1);
    d.spawnQueue.length = Math.min(d.spawnQueue.length, 1);
    d.areaIndex = Cmd.AREAS.length - 1;
    d.areaWaves = d.area.waves - 1;

    let summary = null;
    world.onGameOver = (s) => { summary = s; };
    const dt = 1 / 30;
    for (let n = 0; n < Math.round(180 / dt) && !summary; n++) world.update(dt, H.idleInput());
    assert(summary, 'a driven campaign did not reach its own ending in 180 game-seconds');
    assert(summary.won === true, 'the campaign ended and the summary does not say it was won');

    const { recordRun, loadProgress } = await import('../../src/game/Progress.js');
    const out = await withCleanStore(() => {
      const written = [];
      /* `record` closes over `foldCompanion` too — it folds the companion's
       * durable record BEFORE filing the run, because the fold reads the
       * outcome that filing is what writes. This lift compiles the body
       * verbatim, so the name has to be supplied or the whole check dies on a
       * ReferenceError. A no-op is right here: this file is about what reaches
       * the STORE, and `history.mjs` is where the fold's own ordering and
       * once-per-run guard are asserted. */
      // eslint-disable-next-line no-new-func
      const make = new Function('scope', 'recordRun', 'sessionOr', 'settings', 'foldCompanion', 'emptyLarder',
        'payForRun', 'clearTuning', 'holdLessons', 'awayFor', 'HOURS_PER_SECOND', 'settleRun', 'isRun',
        `const world = scope.world;\n${body}\nreturn record;`);
      // The REAL `recordRun` behind a tap, so the store below is written by the
      // shipped path exactly once and the check can also read what was handed to it.
      /* THE STATION'S CLOCK AND THE JOB BOARD, both no-ops here and both
       * REQUIRED: the lift compiles `record()`'s body verbatim, so a free name
       * it does not supply is a ReferenceError that takes the check down —
       * which is exactly what `passStationHours` did to this file the day the
       * ending started winding the station's clock. `awayFor` is the ward's
       * door (`medbay.mjs` drives the real one) and `settleRun` is the quest
       * ledger's (`work.mjs` drives the real one, with a live World); this
       * file is about what reaches the run STORE. */
      const record = make({ world }, (s) => { written.push(s); return recordRun(s); },
        () => 'command', { order: 'jedi', species: 'human' }, () => {}, () => {}, () => {}, () => {}, () => {},
        () => {}, 1 / 120, () => [], () => true);
      record(summary);
      record();                       // the death card's own exit — once, not twice
      assert(written.length === 1, `a finished campaign wrote ${written.length} records`);
      assert(written[0].won === true,
        'main.js dropped `won` on its way to the store — the field is on the summary and not on the record');
      assert(written[0].mode === 'command', `the record filed it as ${written[0].mode}`);
      return loadProgress();
    });
    assert(out.runs === 1, `${out.runs} runs in the store from one finished campaign`);
    assert(out.wins === 1, `the store holds ${out.wins} wins after one finished campaign`);
    assert(out.byMode.command != null, 'the store does not know which mode the campaign was');
    world.unload();
    return `driven to the end of area ${Cmd.AREAS.length}: won=${summary.won}, `
      + `recorded once, store reads ${out.runs} run / ${out.wins} win`;
  });

  check('progress: a campaign you walked away from is not a campaign you lost', async () => {
    /**
     * `quitToMenu` calls `record()` WITH NO STATS — deliberately, and the note
     * there is right: "an abandoned session still happened. Recording it is
     * what stops 'deepest reached' from quietly meaning 'deepest you happened
     * to die on'." What it had no way to say is that nobody lost.
     *
     * Measured before the fix: quitting 25 s into mission 2 of a campaign,
     * alive — `campaign {index: 1, done: false, won: null}`, `world.over
     * false` — wrote `{depth: 3, score: 7460, won: false, mode: 'campaign'}`.
     * `recordRun` coerces with `!!summary.won`, so a missing verdict and a
     * defeat are the same byte, and `recent[]` is the one history a player
     * reads. That is §2.3's close relative: a missing thing answered with a
     * plausible default.
     *
     * The verdict is DERIVED rather than passed: every ending in the game sets
     * `world.over` — `_checkWipe`, `_endSkirmish`, `_endMeeting`,
     * `_endCampaign` — so a run whose world is not over is a run nobody
     * finished, and the record says `null` rather than guessing. Driven
     * through the same lift of main.js's own `record()` the check above uses,
     * against a live campaign standing on its second mission.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i = src.indexOf('\nfunction record(stats = null) {');
    const end = src.indexOf('\n}\n', i);
    assert(i > 0 && end > i, 'main.js no longer declares `function record(stats = null)`');
    const body = src.slice(i + 1, end + 2);

    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({
      level: 'geonosis',
      settings: { mode: 'campaign', campaign: 'petranaki', order: 'jedi' },
    });
    world.director.start(1);
    for (let n = 0; n < 60; n++) world.update(1 / 30, H.idleInput());
    world.score = 7460;
    assert(world.campaign, 'campaign mode did not open a campaign');
    assert(!world.campaign.done && world.campaign.won == null,
      `the campaign was already decided before anybody quit: ${JSON.stringify(world.campaign)}`);
    assert(!world.over, 'the world was already over — this drive is not an abandonment');
    assert(world.player?.alive !== false, 'the player is down, so this is a defeat and not a walk-away');

    const { recordRun, loadProgress, progressLines } = await import('../../src/game/Progress.js');
    const out = await withCleanStore(() => {
      const written = [];
      /* `record` closes over `foldCompanion` too — it folds the companion's
       * durable record BEFORE filing the run, because the fold reads the
       * outcome that filing is what writes. This lift compiles the body
       * verbatim, so the name has to be supplied or the whole check dies on a
       * ReferenceError. A no-op is right here: this file is about what reaches
       * the STORE, and `history.mjs` is where the fold's own ordering and
       * once-per-run guard are asserted. */
      // eslint-disable-next-line no-new-func
      const make = new Function('scope', 'recordRun', 'sessionOr', 'settings', 'foldCompanion', 'emptyLarder',
        'payForRun', 'clearTuning', 'holdLessons', 'awayFor', 'HOURS_PER_SECOND', 'settleRun', 'isRun',
        `const world = scope.world;\n${body}\nreturn record;`);
      /* THE STATION'S CLOCK AND THE JOB BOARD, both no-ops here and both
       * REQUIRED: the lift compiles `record()`'s body verbatim, so a free name
       * it does not supply is a ReferenceError that takes the check down —
       * which is exactly what `passStationHours` did to this file the day the
       * ending started winding the station's clock. `awayFor` is the ward's
       * door (`medbay.mjs` drives the real one) and `settleRun` is the quest
       * ledger's (`work.mjs` drives the real one, with a live World); this
       * file is about what reaches the run STORE. */
      const record = make({ world }, (s) => { written.push(s); return recordRun(s); },
        () => 'campaign', { order: 'jedi', species: 'human' }, () => {}, () => {}, () => {}, () => {}, () => {},
        () => {}, 1 / 120, () => [], () => true);
      record();                        // quitToMenu, verbatim
      assert(written.length === 1, `quitting wrote ${written.length} records`);
      assert(written[0].won !== false,
        'quitting a campaign alive, with the world not over, filed it as a DEFEAT — the ledger cannot '
        + 'tell a run you walked away from from one you lost');
      return { store: loadProgress(), handed: written[0] };
    });
    const last = out.store.recent[0];
    assert(out.store.runs === 1, `${out.store.runs} runs recorded from one abandoned campaign`);
    assert(last.won === null,
      `the history remembers the abandoned run as won=${JSON.stringify(last.won)} — a run with no `
      + 'verdict must not be stored as one');
    assert(out.store.wins === 0, 'an abandoned campaign counted as a win');
    assert(last.depth > 0, `the abandoned run recorded depth ${last.depth} — it still happened`);
    // …and the one line a player reads says which it was.
    const line = progressLines(out.store).find((l) => l.startsWith('last:'));
    assert(/left|abandon/i.test(line), `the menu's last-run line does not say it was abandoned: "${line}"`);
    world.unload();
    return `quit on mission ${world.campaign.index + 1}, alive: depth ${last.depth}, `
      + `won=${JSON.stringify(last.won)}, ${out.store.wins} wins — "${line}"`;
  });
}
