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
