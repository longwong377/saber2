/**
 * THE BENCH — V16 Lane A3, and it is the second check in this tree guarding a
 * doctrine rather than a behaviour.
 *
 * The player asked for stratagems that *"upgrade"* off a usage count. That is
 * a cross-run progression and `Progress.js` refuses one — its amendment allows
 * credits to buy cosmetics and provisions, and says nothing about a counter
 * buying power. So the resolution is that use opens SIDEGRADES: a variant
 * trades one thing for another and the player picks per run.
 *
 * "Sidegrade" is a word until something measures it. This measures it.
 */

export async function run({ check, assert, near }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('bench: every variant is a trade, and none of them is worth more than stock', async () => {
    /**
     * ══ THE ONE THAT MATTERS ═════════════════════════════════════════════
     *
     * A variant with a gain and no cost is an upgrade wearing the other word,
     * and it would not arrive labelled. So every row is priced: `radius` is
     * the only axis where more is better for the caller, and `lead`,
     * `cooldown` and `cost` are all axes where less is. A variant's worth is
     * the first over the product of the other three, and one is a wash.
     *
     * Nothing here reads the `gain`/`cost` prose. The prose is for the player;
     * the arithmetic is the guarantee.
     */
    const B = await import('../../src/game/Bench.js');
    const { STRATAGEMS } = await import('../../src/game/Stratagems.js');
    const rows = [];
    let worst = 0, worstAt = '';
    for (const s of STRATAGEMS) {
      for (const v of B.VARIANTS[s.id] || []) {
        assert(B.saneVariant(v), `${s.id}/${v.id} is refused by its own door — it has a gain and no cost, `
          + 'or its multipliers come out favouring the caller');
        assert(v.gain && v.cost, `${s.id}/${v.id} does not say both halves of its trade in words`);
        const w = B.worthOf(v);
        assert(w <= 1.0001,
          `${s.id}/${v.id} is worth ${w.toFixed(3)} of the stock call — that is an upgrade, and the `
          + 'whole reason this file exists is that a usage count may not buy one');
        /**
         * AND IT MOVES AT LEAST TWO AXES, which is the shape of a trade.
         *
         * One axis alone is a pure gain or a pure loss whichever way it goes,
         * and the first cut of `mines/dense` was exactly that: it moved only
         * `radius`, its prose promised a DENSER field, and the engine has no
         * density — so the row claimed something it did not deliver and came
         * out worth a flat 1.000. Two axes is what forces a row to say what it
         * gave up.
         */
        assert(Object.keys(v.mods).filter((k) => v.mods[k] !== 1).length >= 2,
          `${s.id}/${v.id} moves one axis — that is a pure gain or a pure loss, not a trade, and a `
          + 'row that moves one axis while its prose promises two is claiming what it cannot deliver');
        if (w > worst) { worst = w; worstAt = `${s.id}/${v.id}`; }
        rows.push(`${s.id}/${v.id} ${w.toFixed(2)}`);
      }
    }
    assert(rows.length >= 8, `only ${rows.length} variants on the bench`);
    /* AND THE DOOR REFUSES ALL FOUR SHAPES A BAD VARIANT COMES IN. */
    const ok = { id: 'x', gain: 'sooner', cost: 'and dearer', mods: { lead: 0.7, cost: 1.5 } };
    assert(B.saneVariant(ok), 'a legitimate trade was refused');
    assert(!B.saneVariant({ ...ok, cost: '' }), 'a variant that names no cost was accepted');
    assert(!B.saneVariant({ ...ok, mods: { lead: 0.5, cost: 1.1 } }),
      'a variant worth 1.8 of the stock call was accepted because it typed a cost');
    assert(!B.saneVariant({ ...ok, mods: { radius: 2 } }),
      'a variant moving one axis was accepted — that is a pure gain or a pure loss, not a trade');
    assert(!B.saneVariant({ ...ok, mods: {} }), 'a variant changing nothing was accepted');
    return `${rows.length} variants, worst worth ${worst.toFixed(3)} (${worstAt}) against a wash at 1.000`;
  });

  check('bench: use opens a sidegrade and never a number — a full bench wins no fight', async () => {
    /**
     * The behavioural half. A player who has called two hundred barrages and
     * one who has called none must be able to do the same things: the first
     * has CHOICES the second does not, and that is the entire difference.
     *
     * Measured by taking every stratagem's stock numbers, applying the best
     * variant the bench can offer, and asserting the result is not strictly
     * better on every axis at once.
     */
    const B = await import('../../src/game/Bench.js');
    const { STRATAGEMS } = await import('../../src/game/Stratagems.js');
    B.clearBench();
    /* A FRESH BENCH OPENS THE FIRST RUNG AND NOTHING ELSE. */
    for (const s of STRATAGEMS) {
      const bench = B.benchFor(s.id);
      if (!bench.length) continue;
      assert(bench[0].open, `${s.id}'s first variant is shut on a fresh bench — the first rung is at 0 calls`);
      if (bench[1]) assert(!bench[1].open, `${s.id}'s second variant is open before a single call`);
    }
    /* CALLING IT OPENS THE REST, and nothing else changes. */
    const id = STRATAGEMS.find((s) => (B.VARIANTS[s.id] || []).length > 1).id;
    for (let i = 0; i < 40; i++) B.noteCall(id);
    const full = B.benchFor(id);
    assert(full.every((v) => v.open), `${id} still has a shut variant after 40 calls`);
    assert(B.callsOf(id) === 40, `the ledger says ${B.callsOf(id)} after 40 calls`);

    /* THE FULL BENCH IS NOT STRICTLY BETTER. For every variant, at least one
     * axis got worse. */
    for (const v of full) {
      const worse = Object.entries(v.mods).some(([k, m]) => (k === 'radius' ? m < 1 : m > 1));
      assert(worse, `${id}/${v.id} made nothing worse — a bench that only gives is a power ladder`);
    }
    /* AND THE COUNT IS NEVER SPENT. */
    const before = B.callsOf(id);
    B.benchFor(id); B.variantsFor(id);
    assert(B.callsOf(id) === before, 'reading the bench spent the count — that is a currency');
    return `a fresh bench opens ${B.benchFor(id).filter((v) => v.open).length} of ${full.length}; `
      + `40 calls open ${full.length} of ${full.length}, every one of them worse on an axis`;
  });

  check('bench: the firing solution is skill, and it dies with the run', async () => {
    /**
     * *"come up with a minigame here."* A stratagem is fire called onto a
     * place from somewhere else, so the honest minigame is the thing that
     * actually goes wrong with called fire — the solution.
     *
     * Two properties. It must REWARD PRECISION, or it is a button. And it must
     * NOT PERSIST, or it is the stat this whole file refuses.
     */
    const B = await import('../../src/game/Bench.js');
    const perfect = { spread: 0.5, delay: 0.5, bearing: 0.5 };
    assert(B.solve(perfect, perfect) === 1, 'a perfect solution does not score 1');
    assert(B.solve(perfect, { spread: 1, delay: 0, bearing: 1 }) < 0.35,
      'a badly missed solution still scores well');
    /* THE CURVE IS UNFORGIVING IN THE MIDDLE: nearly right is a shell nearly
     * on the target, and the squared term is what says so. */
    const near1 = B.solve(perfect, { spread: 0.6, delay: 0.6, bearing: 0.6 });
    const near2 = B.solve(perfect, { spread: 0.7, delay: 0.7, bearing: 0.7 });
    assert(near1 - near2 > (1 - near1),
      `the curve is flat: 0.1 off scores ${near1.toFixed(3)}, 0.2 off ${near2.toFixed(3)}`);
    assert(B.solve(perfect, { spread: 'x' }) === 0, 'a junk solution scored');

    /* THE CEILING IS SMALL, deliberately: a player who never touches the bench
     * is behind by a tenth of one cooldown, which is nothing. */
    const best = B.tuningFrom(1);
    assert(best.cooldown >= 0.85 && best.cost >= 0.9,
      `a perfect solution buys ${JSON.stringify(best)} — that is a second progression`);
    assert(JSON.stringify(B.tuningFrom(0)) === JSON.stringify({ cooldown: 1, cost: 1 }),
      'a missed solution still buys something');

    /* AND IT DIES WITH THE RUN, which is what makes it a skill test and not a
     * stat. The COUNT survives, because a record of what you have done is the
     * one thing `Progress.js` has always allowed. */
    B.clearBench();
    B.noteCall('strike', 20);
    B.setTuning('strike', 1);
    assert(B.tuningFor('strike').cooldown < 1, 'a solved call bought nothing');
    B.clearTuning();
    assert(B.tuningFor('strike').cooldown === 1,
      'the tuning survived the run — that is permanent power off a minigame');
    assert(B.callsOf('strike') === 20,
      'the ledger was cleared with the tuning — a count of what you have done is a record');
    return `perfect 1.000, 0.1 off ${near1.toFixed(3)}, 0.2 off ${near2.toFixed(3)}; a perfect solution `
      + `buys ${((1 - best.cooldown) * 100).toFixed(0)}% off a cooldown and dies with the run`;
  });

  check('bench: a fitted shell and a solution multiply out into four numbers', async () => {
    /**
     * ══ THE HALF THAT HAD NO READER ══════════════════════════════════════
     *
     * `benchFor` said which variants were OPEN and nothing anywhere said which
     * one was FITTED, so twelve sidegrades sat behind a count nothing
     * incremented and reached no run even if it had. `callMods` is the one
     * door a call asks: the fitted shell times the firing solution, as the
     * four numbers a support call is made of.
     *
     * Identity is the whole contract for a player who has never walked into
     * either room — the table's own numbers, unmoved.
     */
    const B = await import('../../src/game/Bench.js');
    B.clearBench();
    const id = 'strike';
    const stock = B.callMods(id);
    assert(JSON.stringify(stock) === JSON.stringify({ radius: 1, lead: 1, cooldown: 1, cost: 1 }),
      `a bench nobody has touched moves a call by ${JSON.stringify(stock)} — the table's own `
      + 'numbers are the only base there is');

    /* A SHELL YOU HAVE NOT OPENED CANNOT BE FITTED, and the door refuses it
     * rather than the panel — a hand-edited save is a hostile input. */
    const shut = B.benchFor(id).find((v) => !v.open);
    assert(shut, `every ${id} variant is open on a fresh bench — this clause measures nothing`);
    assert(B.pick(id, shut.id) === null, `${shut.id} was fitted with ${B.callsOf(id)} calls behind it`);
    assert(B.pickedFor(id) === null, 'a refused pick was fitted anyway');
    assert(B.pick(id, 'not-a-variant') === null, 'a variant that does not exist was fitted');

    /* AN OPEN ONE IS FITTED, AND IT MOVES THE FOUR NUMBERS BY ITS OWN MODS. */
    const open = B.benchFor(id).find((v) => v.open);
    assert(B.pick(id, open.id) === open.id, `${open.id} is open and would not fit`);
    const fitted = B.callMods(id);
    for (const [k, v] of Object.entries(open.mods)) {
      assert(fitted[k] === v, `${open.id} says ${k} ${v} and the call gets ${fitted[k]}`);
    }
    for (const k of ['radius', 'lead', 'cooldown', 'cost']) {
      assert(Number.isFinite(fitted[k]), `${k} came out ${fitted[k]}`);
    }

    /* AND THE SOLUTION MULTIPLIES INTO THE SAME TWO AXES IT HAS ALWAYS OWNED,
     * rather than replacing the shell's. Two systems on one number is where a
     * pair of readers stops agreeing. */
    B.setTuning(id, 1);
    const both = B.callMods(id);
    const t = B.tuningFrom(1);
    assert(Math.abs(both.cooldown - (open.mods.cooldown ?? 1) * t.cooldown) < 1e-9,
      `the shell and the solution do not compose on cooldown: ${both.cooldown}`);
    assert(Math.abs(both.cost - (open.mods.cost ?? 1) * t.cost) < 1e-9,
      `the shell and the solution do not compose on cost: ${both.cost}`);

    /* …AND BOTH DIE WITH THE RUN. A sidegrade chosen once and kept is a
     * loadout, which is the cross-run power the doctrine refuses. */
    B.clearTuning();
    assert(B.pickedFor(id) === null, 'the fitted shell survived the run');
    assert(JSON.stringify(B.callMods(id)) === JSON.stringify(stock),
      `the next run starts on ${JSON.stringify(B.callMods(id))} rather than on the table`);
    return `stock is the identity; ${open.id} fits and moves ${Object.keys(open.mods).join('/')}; `
      + `shell x solution composes on cooldown (${both.cooldown.toFixed(3)}) and cost `
      + `(${both.cost.toFixed(3)}); both gone with the run`;
  });

  check('bench: the mark drifts, it is the same problem for everybody, and it costs an hour', async () => {
    /**
     * *"come up with a minigame here."* A mark that is shown and does not move
     * is a number you copy into a box and every player scores 1.000, so the
     * three dials swing about their hour's centre at their own rates and a
     * solution is a moment as much as a setting.
     *
     * Three properties, and the first is the one the tree's own bar names.
     */
    const B = await import('../../src/game/Bench.js');
    const { readFile } = await import('node:fs/promises');
    const code = (await readFile(new URL('../../src/game/Bench.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(!/Math\.random/.test(code),
      'Bench.js draws the mark off Math.random — two players on the same station hour would be '
      + 'handed different problems and no score would mean anything');

    /* IT IS INSIDE THE DIALS' RANGE and never at an end stop you could hold. */
    let lo = 1, hi = 0, moved = 0, same = 0;
    for (let hour = 0; hour < 48; hour++) {
      const a = B.wantFor('strike', hour);
      const b = B.wantFor('strike', hour + 1);
      for (const d of B.DIALS) {
        lo = Math.min(lo, a[d]); hi = Math.max(hi, a[d]);
        if (Math.abs(a[d] - b[d]) > 0.02) moved++; else same++;
      }
    }
    assert(lo > 0.05 && hi < 0.95, `the mark reaches ${lo.toFixed(2)}..${hi.toFixed(2)} — a dial at an end `
      + 'stop is an answer you can hold and forget');
    assert(moved > same * 3, `${same} of ${moved + same} dials stood still overnight — a fixed solution is `
      + 'a password, not a skill');

    /* IT DRIFTS WITHIN THE HOUR, and the three do not move together. */
    const path = { spread: [], delay: [], bearing: [] };
    for (let i = 0; i <= 60; i++) {
      const m = B.markAt('barrage', 9, i * 0.25);
      for (const d of B.DIALS) path[d].push(m[d]);
    }
    for (const d of B.DIALS) {
      const span = Math.max(...path[d]) - Math.min(...path[d]);
      assert(span > B.DRIFT, `${d} moved ${span.toFixed(3)} over fifteen seconds — that is a still mark`);
    }
    /* Not in lockstep: a solution you can set once and hold for ever is one
     * dial wearing three faces. */
    const together = path.spread.filter((v, i) =>
      Math.abs(v - path.delay[i]) < 0.02 && Math.abs(v - path.bearing[i]) < 0.02).length;
    assert(together < 8, `the three dials sat on the same number ${together} times in 61 samples`);

    /* AND IT IS THE SAME PROBLEM FOR EVERYBODY, TWICE. Pure, so a check and a
     * panel and a second player all read one answer. */
    assert(JSON.stringify(B.markAt('strike', 5, 2.5)) === JSON.stringify(B.markAt('strike', 5, 2.5)),
      'the mark answered differently to the same question');
    assert(JSON.stringify(B.markAt('strike', 5, 2.5)) !== JSON.stringify(B.markAt('strike', 6, 2.5)),
      'the mark is the same at 05:00 and at 06:00');

    /* ONE SOLUTION AN HOUR. Without this the panel is a SEND button you press
     * until it says 1.000, and every player arrives at the ceiling. */
    B.clearBench();
    assert(B.canSolve('strike', 9), 'a call that has never been solved refuses a solution');
    B.setTuning('strike', 0.4, 9);
    assert(!B.canSolve('strike', 9), 'the same hour took a second solution — the room is a re-roll');
    assert(!B.canSolve('strike', 9.9), 'the same hour took a second solution on a fraction of it');
    assert(B.canSolve('strike', 10), 'the next hour still refuses');
    assert(B.canSolve('barrage', 9), 'solving one call spent the hour for another');
    /* …and the gate goes with the run: it is there to stop a re-take, not to
     * ration by wall clock. */
    B.clearTuning();
    assert(B.canSolve('strike', 9), 'the hour-gate survived the run it was set in');
    return `mark spans ${lo.toFixed(2)}..${hi.toFixed(2)}, moves overnight on ${moved} of ${moved + same} `
      + `dials, drifts ±${B.DRIFT} within the hour, and one call takes one solution an hour`;
  });

  check('bench: it holds a count, not a currency, and the store clamps a hostile save', async () => {
    const B = await import('../../src/game/Bench.js');
    const { readFile } = await import('node:fs/promises');
    const code = (await readFile(new URL('../../src/game/Bench.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    /* NOTHING SUBTRACTS. That is the whole difference between a count and a
     * currency, and it is one grep. */
    assert(!/called\[[^\]]+\]\s*-=|called\[[^\]]+\]\s*=\s*[^;]*-\s/.test(code),
      'something subtracts from the call ledger — a count that can be spent is a currency');
    for (const word of ['currency', 'purchase', 'unlock', 'buy']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(code),
        `Bench.js has grown a "${word}"`);
    }
    /* THE STORE CLAMPS. A hand-edited save is a hostile input and this is the
     * field somebody would edit to open every variant at once. */
    B.clearBench();
    assert(B.noteCall('not-a-stratagem') === 0, 'the ledger accepted a stratagem that does not exist');
    B.noteCall('strike', 5);
    assert(B.callsOf('strike') === 5, `the ledger says ${B.callsOf('strike')}`);
    assert(B.callsOf('nope') === 0, 'an unknown id reads as something');
    return 'nothing subtracts from the ledger; unknown ids are refused at the door';
  });
}
