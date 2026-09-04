/**
 * WORK — V16 Lane C3.
 *
 * The player's own rule is the design and it is the thing worth holding: *"the
 * npcs aren't always in the same place either so it's a chance thing"* AND
 * *"you go back to that npc who will be there since you compelted the quest."*
 * Everyone rerolls; anyone who owes you money does not.
 */

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
      for (const o of offers) seen.add(o.shape + ':' + (o.n ?? o.how ?? o.kind ?? o.what ?? ''));
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
    const done = W.settleRun({ kills: 9999, depth: 99, lost: 0, bolts: 0, forceCasts: 0, recovered: ['x'], home: [], killedKinds: {} });
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
      const nothing = { kills: 0, depth: 0, lost: 3, bolts: 40, forceCasts: 9, recovered: [], home: [], killedKinds: { b1: 5 } };
      const everything = { kills: 9999, depth: 99, lost: 0, bolts: 0, forceCasts: 0, recovered: ['x'], home: ['m1'], killedKinds: {} };
      assert(!shape.test(nothing, job), `${shape.id} is finished by a run that did nothing`);
      assert(shape.test(everything, job), `${shape.id} cannot be finished by a run that did everything`);
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
}
