/**
 * WORK — V16 Lane C3.
 *
 * The player's own rule is the design and it is the thing worth holding: *"the
 * npcs aren't always in the same place either so it's a chance thing"* AND
 * *"you go back to that npc who will be there since you compelted the quest."*
 * Everyone rerolls; anyone who owes you money does not.
 */

/**
 * EVERY FIELD ANY JOB CAN JUDGE ON, which is what an ending has to report.
 *
 * `needs` is a function of the ROLLED job — a manner asks about limbs, or the
 * Force, or the roll, and never all three — so the union is taken over jobs
 * that were actually rolled rather than read off a list beside the shapes. A
 * hand-written second list here would be HANDOFF §2.3's table beside its twin,
 * and the first thing to disagree with the shapes it describes.
 */
function SHAPES_NEEDS(W, ctx = { men: [{ id: 'm1', name: 'Vurn' }], kinds: ['b1'] }) {
  const out = new Set();
  for (const shape of W.SHAPES) {
    for (let k = 1; k <= 40; k++) {
      let i = k * 7919;
      const rng = () => ((i = (i * 1103515245 + 12345) % 2147483648) / 2147483648);
      const job = shape.roll(rng, ctx);
      if (job) for (const f of shape.needs(job)) out.add(f);
    }
  }
  return [...out];
}

/**
 * THE TWO RUNS EVERY SHAPE IS DRIVEN AGAINST, and both are in the shape
 * `World.runStats` hands out — the object `recordRun` is written from and the
 * one `main.js`'s `record()` passes to `settleRun`. A fixture with a field
 * `runStats` does not report is a check agreeing with a bug, which is what
 * `bolts: 40` and `recovered: ['x']` were: the player cannot fire a bolt and
 * nothing in any run has ever recovered anything.
 */
const DID_NOTHING = Object.freeze({
  kills: 0, depth: 0, lost: 3, limbs: 12, forceCasts: 9, saves: 0, home: [],
  killedKinds: { b1: 5 },
});
const DID_EVERYTHING = Object.freeze({
  kills: 9999, depth: 99, lost: 0, limbs: 0, forceCasts: 0, saves: 9, home: ['m1'],
  killedKinds: {},
});

export async function run({ check, assert, near }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('work: the giver is a chance encounter and the payer is pinned', async () => {
    /**
     * ══ THE ONE THAT MATTERS ═════════════════════════════════════════════
     *
     * Two properties pulling against each other, which is why they need
     * measuring rather than asserting. Offers must CHANGE with the day and
     * with the room. And the moment you take one, that person must stop
     * changing — because nothing else in the game makes a stranger persist,
     * and it is the cheapest way to make one matter.
     */
    const W = await import('../../src/game/Quests.js');
    W.clearWork();

    /* NOT ALWAYS THERE, and not always the same. */
    let empty = 0, seen = new Set();
    for (let day = 0; day < 40; day++) {
      const offers = W.offersAt(14, day);
      if (!offers.length) empty++;
      for (const o of offers) seen.add(o.shape + ':' + (o.n ?? o.how ?? o.kind ?? o.who ?? ''));
    }
    assert(empty > 6 && empty < 34,
      `the bar had somebody in it on ${40 - empty} of 40 days — "not always there" is the whole clause`);
    assert(seen.size > 8, `only ${seen.size} distinct jobs over 40 days at one place`);

    /* AND IT IS THE SAME FOR EVERYONE ON THE DAY. An offer that rerolled per
     * look would be a slot machine with a face on it. */
    const a = JSON.stringify(W.offersAt(14, 7));
    assert(a === JSON.stringify(W.offersAt(14, 7)), 'the offer changed when nothing did');
    assert(a !== JSON.stringify(W.offersAt(18, 7)), 'two different rooms offer the same job');

    /* THE PIN. Take one, and that giver is on the station until they pay. */
    let job = null;
    for (let day = 0; day < 40 && !job; day++) job = W.offersAt(14, day)[0] || null;
    assert(job, 'nobody offered anything in forty days');
    assert(!W.pinnedGivers().size, 'somebody was pinned before a job was taken');
    assert(W.takeJob(job).ok, 'a legitimate job was refused');
    assert(W.pinnedGivers().has(job.giver), 'taking a job did not pin the person who gave it');

    /* …AND THEY STAY PINNED UNTIL PAID, not until finished. */
    /* A RUN THAT DID EVERYTHING, and it now has to REPORT everything: a field
     * the summary does not carry leaves the job open rather than finishing it,
     * which is the rule that stops a shape reading a counter no ending sends. */
    const done = W.settleRun(DID_EVERYTHING);
    assert(done.length === 1, `${done.length} jobs finished on a run that did everything`);
    assert(W.pinnedGivers().has(job.giver),
      'the giver came unpinned when the job was FINISHED — they are pinned until they PAY, which is '
      + 'the entire reason to walk back');
    const paid = W.collect(job.id);
    assert(paid.ok && paid.pay > 0, 'a finished job paid nothing');
    assert(!W.pinnedGivers().has(job.giver), 'the giver is still pinned after paying');
    assert(!W.collect(job.id).ok, 'a job paid out twice');
    return `somebody there on ${40 - empty} of 40 days, ${seen.size} distinct jobs; the giver pins on `
      + `taking, stays pinned through finishing, and unpins on paying ${paid.pay}`;
  });

  check('work: every job is a number the run already reports', async () => {
    /**
     * A quest that needed a new counter would be a second scoring system
     * beside the real one, and the first thing to disagree with it. So every
     * shape is driven against a summary in the SAME SHAPE `recordRun` is
     * written from, and a job cannot be finished by anything the record does
     * not also say happened.
     */
    const W = await import('../../src/game/Quests.js');
    const men = [{ id: 'm1', name: 'Vurn' }];
    const ctx = { men, kinds: ['b1'] };
    /* Every shape must be able to both pass and fail — a test that cannot
     * fail is a job that is already done. */
    const rows = [];
    for (const shape of W.SHAPES) {
      const rng = (() => { let i = 0; return () => ((i = (i * 9301 + 49297) % 233280), i / 233280); })();
      const job = { shape: shape.id, ...shape.roll(rng, ctx) };
      assert(!shape.test(DID_NOTHING, job), `${shape.id} is finished by a run that did nothing`);
      assert(shape.test(DID_EVERYTHING, job), `${shape.id} cannot be finished by a run that did everything`);
      /**
       * AND EVERY FIELD IT JUDGES ON IS A FIELD `World.runStats` REPORTS.
       *
       * The clause this file was missing, and the reason four shapes shipped
       * unfinishable or already finished: `bolts`, `forceCasts`, `killedKinds`
       * and `recovered` were read off a summary that has never carried any of
       * them. A shape may only ask a question the run answers.
       */
      assert(typeof shape.needs === 'function' && shape.needs(job).length,
        `${shape.id} does not say which fields it judges on, so nothing can check that a run reports them`);
      for (const f of shape.needs(job)) {
        assert(f in DID_EVERYTHING,
          `${shape.id} judges on \`${f}\`, which no run in this game reports`);
      }
      assert(typeof shape.line(job) === 'string' && shape.line(job).length > 12,
        `${shape.id} has no line for the giver to say`);
      assert(job.pay > 0, `${shape.id} pays nothing`);
      rows.push(`${shape.id} ${job.pay}`);
    }
    assert(W.SHAPES.length >= 6, `only ${W.SHAPES.length} shapes of job`);
    /* AND ONE OF THEM IS NOT ABOUT KILLING. A player who has only ever been
     * asked for numbers has not been asked for anything. */
    assert(W.SHAPES.some((s) => s.id === 'mercy'), 'every job in the game is a body count');
    return `${W.SHAPES.length} shapes, each provably passable and failable: ${rows.join(', ')}`;
  });

  check('work: a board, not a backlog, and it never pays a stat', async () => {
    const W = await import('../../src/game/Quests.js');
    W.clearWork();
    /* THREE AT A TIME. A board you can fill with twenty is a checklist. */
    const jobs = [];
    for (let day = 0; jobs.length < 5 && day < 200; day++) {
      for (const o of W.offersAt(14, day)) if (jobs.length < 5) jobs.push(o);
    }
    let taken = 0;
    for (const j of jobs) if (W.takeJob(j).ok) taken++;
    assert(taken === W.OPEN_MAX, `${taken} jobs taken against a board of ${W.OPEN_MAX}`);
    assert(W.openJobs().length === W.OPEN_MAX, 'the board does not hold what it says');
    const refused = W.takeJob(jobs[4]);
    assert(!refused.ok && /carrying/.test(refused.why || ''),
      'a fourth job was taken, or refused without saying why');
    /* THE SAME JOB TWICE IS NOT TWO JOBS. */
    W.clearWork();
    assert(W.takeJob(jobs[0]).ok && !W.takeJob(jobs[0]).ok, 'one job was taken twice');

    /* AND IT PAYS CREDITS, NEVER A STAT. `Progress.js`'s amendment allows a
     * currency to buy cosmetics and provisions; a job that handed out a facet
     * would be the third category by another route. */
    const { readFile } = await import('node:fs/promises');
    const code = (await readFile(new URL('../../src/game/Quests.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const bad of ['takenBoons', 'Communion', 'boonMods', 'FACETS', 'maxHp']) {
      assert(!new RegExp(`\\b${bad}\\b`).test(code),
        `Quests.js reaches ${bad} — a job is a reason to come back, not a second Holocron`);
    }
    for (const word of ['currency', 'purchase', 'unlock']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(code), `Quests.js has grown a "${word}"`);
    }
    return `a board of ${W.OPEN_MAX}, refusing a fourth with a reason and the same job twice; `
      + 'nothing in it reaches the run\'s own ledger';
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('work: a REAL run finishes a job, and the man who owes you is still standing there', async () => {
    /**
     * ══ THE DEFECT THIS CHECK IS NAMED AFTER, AND IT IS THE SECOND OF ITS
     *    KIND IN THIS FILE ═══════════════════════════════════════════════
     *
     * Every check above was green while `settleRun` — the ONLY function that
     * moves a job from `open` to `done` — had no caller anywhere in `src/`.
     * The suite called it itself, which is a statement about a pure function
     * and not about the game. Driven end to end on the shipped build: take a
     * 300-credit job at #7, play a real skirmish, die — `done: []`, the job
     * still open, "carrying 1, owed 0" at the giver's room for ever. `OPEN_MAX`
     * is three and there was no abandon, so three of those bricked the board
     * for the rest of the save.
     *
     * So this drives the REAL THING and calls nothing it is testing:
     *
     *   A REAL WORLD, in Command mode, to a REAL ENDING — the shipped
     *     `payWave` → `_areaClear` → `_endCampaign` path, clocked by
     *     `world.update`, which is what `progress.mjs` drives and for the same
     *     reason: main.js cannot be imported under Node.
     *   MAIN.JS'S OWN `record()`, lifted verbatim and compiled, so what settles
     *     the job is the ending funnel the game runs and not a paraphrase of
     *     it. The lift refuses to run if the function stops matching.
     *   THE REAL `settleRun` behind a tap — the tap only READS the summary it
     *     was handed. If `record()` stops calling it, the tap is never touched
     *     and the job is still open, which is the assertion below.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i = src.indexOf('\nfunction record(stats = null) {');
    assert(i > 0, 'main.js no longer declares `function record(stats = null)`');
    const end = src.indexOf('\n}\n', i);
    assert(end > i, 'the body of record() could not be delimited');
    const body = src.slice(i + 1, end + 2);
    assert(/settleRun\(/.test(body),
      'main.js\'s record() does not call settleRun — the one funnel every ending goes through does not '
      + 'settle the job board, which is a quest that can be taken and can never be finished');

    const W = await import('../../src/game/Quests.js');
    const H = await import('./_coop.mjs');
    const Cmd = await import('../../src/game/Command.js');
    W.clearWork();

    const { world } = await H.bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', order: 'jedi' },
    });
    try {
      const d = world.command;
      assert(d, 'command mode did not build a command director');
      world.director.start(1);
      d.spawnQueue.length = Math.min(d.spawnQueue.length, 1);
      d.areaIndex = Cmd.AREAS.length - 1;
      d.areaWaves = d.area.waves - 1;

      /* THE JOB IS A REAL OFFER off a real room on a real day, rolled against
       * the men who are actually on this ground — which is what
       * `Station.questContext` hands `offersAt` in the game. A `name` job is
       * the one whose evidence a driven win produces deterministically: the
       * ending seals the manifest, and the manifest is who walked off. */
      const men = d.roster.living.slice(0, 8).map((t) => ({ id: t.id, name: t.designation }));
      assert(men.length > 2, `the ground raised ${men.length} men — there is nobody to name`);
      const ctx = { men, kinds: ['b1'] };
      let job = null, where = 0;
      for (let day = 0; day < 60 && !job; day++) {
        for (const place of [14, 18, 27, 38, 9]) {
          const found = W.offersAt(place, day, ctx).find((o) => o.shape === 'name');
          if (found) { job = found; where = place; break; }
        }
      }
      assert(job, 'no room in the gazetteer offered a job naming one of your men in sixty days');
      assert(W.takeJob(job).ok, 'the board refused a legitimate job');
      assert(W.openJobs().length === 1 && !W.owedJobs().length,
        'taking the job did not put it on the board');

      /* ── THE RUN ─────────────────────────────────────────────────────── */
      let summary = null;
      world.onGameOver = (s) => { summary = s; };
      const dt = 1 / 30;
      for (let n = 0; n < Math.round(180 / dt) && !summary; n++) world.update(dt, H.idleInput());
      assert(summary, 'a driven campaign did not reach its own ending in 180 game-seconds');
      assert(summary.won === true, 'the campaign ended and the summary does not say it was won');
      assert((world.manifest || []).some((t) => t.id === job.who),
        'the man the job named did not walk off the ground, so this drive proves nothing');

      /* ── AND THE ENDING, WHICH IS MAIN.JS'S OWN ──────────────────────── */
      let handed = null;
      // eslint-disable-next-line no-new-func
      const make = new Function('scope', 'recordRun', 'sessionOr', 'settings', 'foldCompanion', 'emptyLarder',
        'payForRun', 'clearTuning', 'holdLessons', 'awayFor', 'HOURS_PER_SECOND', 'settleRun', 'isRun',
        `const world = scope.world;\n${body}\nreturn record;`);
      /* THE REAL `isRun` and the real `settleRun`: the mode gate is part of what
       * is being proved — `quitToMenu` reaches `record()` from the station too,
       * and a walk across the drum must not finish a manner job. The tap only
       * READS what the ending handed the board. */
      const { isRun } = await import('../../src/game/Progress.js');
      const record = make({ world }, () => {}, () => 'command', { order: 'jedi', species: 'human' },
        () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, 1 / 120,
        (run) => { handed = run; return W.settleRun(run); }, isRun);
      record(summary);

      assert(handed, 'the ending never reached the job board at all');
      /**
       * AND THE SUMMARY ANSWERS EVERY QUESTION THE SHAPES ASK. `settleRun`
       * leaves a job open when the run did not report the field it judges on,
       * so a shape reading a field no ending sends is a job that can be taken
       * and never finished — which is what `recovered` was, and `bolts`,
       * `forceCasts` and `killedKinds` were the same defect passing instead of
       * failing. `undefined` is the failure; a null is a legal "this mode has
       * no answer" and is counted separately.
       */
      const asked = SHAPES_NEEDS(W);
      const missing = asked.filter((f) => handed[f] === undefined);
      assert(!missing.length,
        `the ending reports nothing for ${missing.join(', ')} — a shape judging on a field no run sends `
        + 'is a job that can be taken and can never be finished');
      const nulled = asked.filter((f) => handed[f] === null);

      assert(!W.openJobs().length,
        `the run did the job and the board is still carrying ${W.openJobs().length}`);

      /**
       * ── AND A VISIT TO THE STATION IS NOT A RUN ──────────────────────────
       *
       * `quitToMenu` calls `record()` from wherever the player is, the drum
       * included, and a walk across the concourse reports 0 kills, 0 limbs and
       * an empty kind tally — a run that did nothing, to look at. `Progress.isRun`
       * is what tells those apart, and without it a manner job ("leave them in
       * one piece") would be finished by pressing Menu on the station.
       */
      assert(W.takeJob(job).ok, 'the finished job could not be taken again for the station drive');
      const still = W.openJobs().length;
      const onStation = make({ world }, () => {}, () => 'station', { order: 'jedi', species: 'human' },
        () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, 1 / 120,
        (run) => { handed = run; return W.settleRun(run); }, isRun);
      world._recorded = false;
      onStation(null);
      assert(W.openJobs().length === still,
        'walking out of the STATION settled the job board — a visit to the drum is not a run');
      const owed = W.owedJobs();
      assert(owed.length === 1 && owed[0].id === job.id,
        `${owed.length} finished jobs after a run that finished one`);

      /* …and the job that was re-taken for that drive comes back off the board,
       * so the ledger below is the one the run left. */
      W.dropJob(job.id);
      assert(W.owedJobs().length === 1, 'dropping the re-taken copy took the finished one with it');

      /* ── AND THE GIVER IS STILL THERE, DAYS LATER ────────────────────── */
      assert(W.pinnedGivers().has(job.giver), 'the giver came unpinned the moment the job was finished');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const { occupant } = await import('../../src/game/StationLife.js');
      const room = PLACE.get(where);
      let standing = 0;
      for (const day of [0, 1, 9, 40]) {
        for (let slot = 0; slot < 8; slot++) {
          if (occupant(room, slot, { day })?.seed === job.giver) { standing++; break; }
        }
      }
      assert(standing === 4,
        `the man who owes you was in ${room.name} on ${standing} of 4 days — the census rerolled him, `
        + 'which is the whole of "you go back to that npc who will be there"');

      /* ── AND YOU CAN BE PAID, FACE TO FACE ───────────────────────────── */
      const { payForJob } = await import('../../src/game/Station.js');
      const paid = payForJob(job.id);
      assert(paid.ok && paid.paid > 0, `collecting a finished job paid ${paid.paid} — ${paid.why}`);
      assert(!W.pinnedGivers().has(job.giver), 'the giver is still pinned after paying');
      assert(!W.owedJobs().length, 'the job is still owed after it was paid');

      /* AND THE LEDGER IS PUT BACK. `Quests.js` caches the fold in memory, so a
       * job left open here would still be pinning a body in the census for
       * every suite that boots a station after this one — `clocked` restores
       * localStorage and cannot reach a module's own cache. */
      W.clearWork();
      return `took "${job.line}" at #${where}, drove a real Command run to a real win, and main.js's own `
        + `record() settled it: open 0, owed 1, paid ${paid.paid}. The ending answers all ${asked.length} `
        + `fields the shapes judge on (${nulled.length} null on this mode: ${nulled.join(', ') || 'none'}); `
        + 'the giver was in the room on all 4 days sampled';
    } finally { world.unload?.(); }
  });

  check('work: a job you cannot finish can be put down, and one nobody judged is not failed', async () => {
    /**
     * TWO ABSENCES, AND THE BOARD BRICKED ON BOTH.
     *
     * `OPEN_MAX` is three and there was no way to be rid of one, so three jobs
     * a player's mode cannot report — a mercy in a room with no droids, a name
     * off a roll that was wiped — answered every board in the game with "you
     * are already carrying 3" for the rest of the save. The player's words are
     * about what happens when you COMPLETE a job and do not forbid dropping
     * one; a board that can permanently brick is worse than one that forgets.
     *
     * AND A RUN THAT COULD NOT ANSWER THE QUESTION HAS NOT FAILED IT. Four of
     * the six shapes shipped reading fields no ending sends, and a missing
     * field read as a zero finished two of them for a run that did the
     * opposite. Open is the honest state: you may take it out again.
     */
    const W = await import('../../src/game/Quests.js');
    W.clearWork();
    const ctx = { men: [{ id: 'm1', name: 'Vurn' }], kinds: ['b1'] };
    const jobs = [];
    for (let day = 0; jobs.length < 3 && day < 200; day++) {
      for (const o of W.offersAt(14, day, ctx)) if (jobs.length < 3) jobs.push(o);
    }
    for (const j of jobs) W.takeJob(j);
    assert(W.openJobs().length === 3, 'the board is not full, so nothing is being proved about a full one');

    /* A RUN THAT REPORTS NOTHING FINISHES NOTHING — and fails nothing. */
    const none = W.settleRun({});
    assert(!none.length, `${none.length} jobs were finished by a run that reported no fields at all`);
    assert(W.openJobs().length === 3, 'an unjudgeable run took jobs off the board');
    /* …AND A FIELD THAT IS PRESENT AND NULL IS THE SAME ANSWER. `fallen` is
     * null in every mode with no army, which is not "you lost nobody". */
    const nulls = W.settleRun({ kills: null, depth: null, lost: null, home: null, limbs: null,
      saves: null, forceCasts: null, killedKinds: null });
    assert(!nulls.length, `${nulls.length} jobs were finished by a run whose every field was null`);

    const drop = W.dropJob(jobs[0].id);
    assert(drop.ok && drop.carrying === 2, `dropping a job left ${drop.carrying} on the board`);
    assert(!W.dropJob(jobs[0].id).ok, 'the same job was dropped twice');
    assert(W.takeJob(jobs[0]).ok, 'a job that was put down could not be taken again');
    /* AND IT CANNOT THROW AWAY MONEY. `done` is what somebody owes you. */
    W.clearWork();
    W.takeJob(jobs[1]);
    const fin = W.settleRun({ kills: 9999, depth: 99, lost: 0, limbs: 0, forceCasts: 0, saves: 9,
      home: ['m1'], killedKinds: {} });
    if (fin.length) {
      assert(!W.dropJob(jobs[1].id).ok, 'a FINISHED job was dropped — that is a button that deletes credits');
      assert(W.owedJobs().length === 1, 'the finished job left the ledger');
    }
    W.clearWork();
    return `a full board of 3: an unjudged run finished 0 and failed 0, a null-fielded run finished 0, `
      + 'one dropped and re-taken, and a finished job refuses to be dropped';
  });

  check('work: the job board is IN THE BUILD, and a room actually opens it', async () => {
    /**
     * ══ THE DEFECT THIS CHECK IS NAMED AFTER ═════════════════════════════
     *
     * Every check above this one was green for the whole life of `Quests.js`
     * while NOTHING UNDER `src/` IMPORTED IT. `tools/pack.mjs` walks the
     * module graph from `index.play.html`'s entry, so the packed build simply
     * did not contain the file: a finished quest system, 3/3 green, that no
     * player could ever meet a giver for. `Games.js` had the identical defect
     * next door. A suite that reaches its module with `import()` is making a
     * statement about the file system, not about the game, and green over an
     * orphan is worse than red because nobody investigates green.
     *
     * So this asks the shipping question on the same walk `pack.mjs` does,
     * and then asks the harder half: that a PLACE raises it.
     */
    const { assertShipped, shippedGraph } = await import('./_shipped.mjs');
    const by = await assertShipped(assert, 'src/game/Quests.js',
      'a quest system with no giver in it is a system no player can meet');

    /* THE DOOR IS `Station.stationKey`'s LAST BRANCH, and it has to be the
     * real one: the file that imports `offersAt` must be the file that owns
     * the interact key, or the import is paperwork. */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Station.js', import.meta.url), 'utf8');
    assert(by.includes('src/game/Station.js'),
      `Quests.js is imported by ${by.join(', ')} — the door is the interact key and that lives in Station.js`);
    assert(/from '\.\/Quests\.js'/.test(src), 'Station.js does not import Quests.js');
    const key = src.slice(src.indexOf('export function stationKey('));
    const end = key.indexOf('\n}');
    const body = key.slice(0, end);
    assert(/offersAt\(/.test(body) && /onQuest/.test(body),
      'stationKey does not reach offersAt — the board is imported and never opened');
    /* AND IT IS LAST, so it cannot shadow a counter, a ward, a pit or a card.
     * The pit branch three above it once returned on its own refusal and made
     * #20's betting card unreachable; that is the failure mode this measures
     * rather than trusts. */
    assert(body.indexOf('offersAt(') > body.indexOf('venueAtPlace(')
      && body.indexOf('offersAt(') > body.indexOf('countersAt(')
      && body.indexOf('offersAt(') > body.indexOf('onPit')
      && body.indexOf('offersAt(') > body.indexOf('onMedbay'),
      'the job board is raised BEFORE a counter, a pit, a card or the ward — it will eat their press');

    /* AND THE ROOMS IT LANDS IN ARE THE ONES THE PLAYER ASKED FOR: not one
     * new room, but every room with nobody behind a counter in it. */
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const { countersAt } = await import('../../src/game/Vendors.js');
    const { venueAtPlace } = await import('../../src/game/Tote.js');
    const { pitAtPlace } = await import('../../src/game/Pits.js');
    const W = await import('../../src/game/Quests.js');
    const claimed = new Set([13, 28, 41, 42, 43, 44, 50, 56, 57, 60, 2, 3, 4, 5, 6]);
    const open = PLACES.filter((p) => !p.external && p.verb && !claimed.has(p.id)
      && !p.kiosk && !countersAt(p.id).length && !pitAtPlace(p.id) && !venueAtPlace(p.id));
    assert(open.length >= 20, `only ${open.length} rooms reach the job board — the givers have nowhere to be`);
    assert(open.some((p) => p.id === 14), '#14 The Long Night does not reach the board, and a bar is where a job is offered');

    let jobs = 0, worstFull = 0;
    for (let day = 0; day < 14; day++) {
      let full = 0;
      for (const p of open) { const n = W.offersAt(p.id, day).length; jobs += n; if (n) full++; }
      if (full > worstFull) worstFull = full;
    }
    assert(jobs / 14 > 8, `only ${(jobs / 14).toFixed(1)} jobs a day across the whole station`);
    /* NOT ALWAYS THERE, measured PER DAY and not over a fortnight: over enough
     * days every room offers something eventually, and asserting otherwise
     * would be a check that only passes while the sample is small. What has to
     * be true is that on any GIVEN day you walk into rooms with nobody in them
     * — which is the player's *"it's a chance thing"*. */
    assert(worstFull < open.length,
      `on the fullest of 14 days all ${open.length} rooms had a job going — walking in is not a chance any more`);

    const { files } = await shippedGraph();
    return `Quests.js ships, imported by ${by.join(' and ')}; ${open.length} rooms reach the board, `
      + `${(jobs / 14).toFixed(1)} jobs a day; ${files.size} modules in the build`;
  });

}
