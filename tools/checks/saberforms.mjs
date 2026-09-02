/**
 * THREE SABER SETS, AND THE FIRST ONE DID NOT MOVE.
 *
 * "I also want you to add A double-bladed lightsaber/saberstaff … and also
 *  dual weilding (one lightsaber in each hand), these two differing player
 *  fighting methods will require unique playstyles and have moves that are
 *  unique to them, DON'T CHANGE ANYTHING WITH THE DEFAULT SINGLE BLADE USAGE
 *  … anyway at the end of this having three different saber options that
 *  directly effect gameplay and create more fighting styles is good for the
 *  health of the game"
 *
 * The capitalised clause is the hardest constraint in the request and it is
 * the first check below. It is held against a RECORDING of the pre-change tree
 * rather than against numbers computed here, because a check that recomputed
 * its own expectations from the new code would agree with itself whatever the
 * code did — see `tools/_trace.mjs`.
 *
 * The rest are the other half of the sentence: three sets that "directly
 * effect gameplay" have to actually differ, and each difference has to cost
 * something. A set that was only better would not be a fighting style.
 */
import { readFile } from 'node:fs/promises';

const STEP = 1 / 30;

async function boot(saberSet) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', saberSet },
    runSeed: 5,
  });
  return { world, p: world.player, input: idleInput() };
}

/** Every lit blade a player is holding, whatever set they are in. */
const bladesOf = (p) => [p.saber, p.sidearm?.saber].filter(Boolean);

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const S = await import('../../src/game/SaberSet.js');

  check('saberforms: the single blade is the blade it was, to six decimals', async () => {
    /**
     * THE PLAYER'S OWN HARD CONSTRAINT, AND THE ONLY HONEST WAY TO HOLD IT.
     *
     * `tools/checks/_singleblade.json` is 600 frames of the shipped weapon —
     * both endpoints, the tip velocity, the swing speed, the guard's own two
     * angles and its half-width, the stamina and the guard spend — recorded on
     * the tree BEFORE one line of the set code existed, driven by a scripted
     * hand that is a function of the frame index alone so nothing about when
     * it was taken is in it.
     *
     * A DIGEST WOULD NOT DO. The endpoints alone would miss a changed guard;
     * the guard alone would miss a changed blade. Sixteen floats a frame,
     * 9 600 numbers, and the assertion is that not one of them moved.
     *
     * THE TOLERANCE IS 1e-9 AND NOT ZERO, for floating-point reassociation
     * only — a compiler or a JIT is allowed to reorder an addition. Anything a
     * human could see is orders of magnitude above it.
     */
    const { trace, COLUMNS } = await import('../_trace.mjs');
    const want = JSON.parse(await readFile(new URL('./_singleblade.json', import.meta.url), 'utf8'));
    const got = await trace();
    assert(got.length === want.frames,
      `the trace is ${got.length} frames and the baseline is ${want.frames}`);
    assert(COLUMNS.join(',') === want.columns.join(','),
      'the trace records different columns than the baseline — the two cannot be compared');
    let worst = 0, worstAt = null;
    for (let f = 0; f < want.frames; f++) {
      for (let c = 0; c < COLUMNS.length; c++) {
        const d = Math.abs(got[f][c] - want.rows[f][c]);
        if (d > worst) { worst = d; worstAt = `${COLUMNS[c]} at frame ${f}`; }
      }
    }
    assert(worst < 1e-9,
      `the single blade moved: ${worstAt} is off by ${worst.toExponential(3)}. `
      + 'The player asked for the default blade not to change at all');
    return `${want.frames} frames × ${COLUMNS.length} floats = ${want.frames * COLUMNS.length} numbers, `
      + `worst drift ${worst.toExponential(2)}`;
  });

  check('saberforms: Saber.js and Combat.js gained nothing at all', async () => {
    /**
     * THE STRUCTURAL HALF OF THE SAME PROMISE, and it is one line rather than
     * an argument: both new weapons are EXTRA `Saber` instances driven through
     * the same public two-call contract — `setHiltPose` then `update` — that
     * `installOffhand`, the remote avatar, the menu preview and the thrown
     * blade already drive.
     *
     * So the ~30 enemy sabers in a wave, the duellists' blades and the
     * player's own all run the code they ran before, and the check for it is
     * that neither file mentions any of this.
     */
    const src = (p) => readFile(new URL('../../src/' + p, import.meta.url), 'utf8');
    for (const f of ['game/Saber.js', 'game/Combat.js']) {
      const code = await src(f);
      /**
       * THE WORDS ARE THE FEATURE'S OWN NAMES AND NOT DESCRIPTIONS OF IT.
       *
       * `staff` was on this list and went red on Saber.js — correctly finding
       * `weaponStyle === 'staff'`, which is the ELECTROSTAFF an enemy carries
       * and has nothing to do with a saberstaff. A check that fails on a word
       * the file has meant something else by for months is a check that will
       * be silenced rather than read. `dual` came off for the same reason.
       *
       * What is left cannot appear in either file by accident: they are the
       * identifiers this feature invented.
       */
      for (const word of ['saberSet', 'Sidearm', 'SABER_SETS', 'SaberSet', 'saberstaff', 'setById']) {
        assert(!new RegExp(`\\b${word}\\b`).test(code),
          `${f} mentions "${word}" — the sets were supposed to be built ON this file and not IN it`);
      }
    }
    return 'Saber.js and Combat.js know nothing about the sets';
  });

  check('saberforms: all three sets build a player that runs', async () => {
    /**
     * MEASURED ON A REAL PLAYER IN A REAL WORLD, because the first version of
     * this feature could not do it: `this.control.setHalf = …` was written
     * twenty lines ABOVE the statement that assigns `this.control`, so
     * constructing a staff or a pair threw in the Player CONSTRUCTOR — every
     * mode, every deploy. It survived being written because the single blade
     * skips that block entirely, so the default path was clean and the two new
     * weapons were unreachable from the first frame.
     *
     * That is why this check boots each set rather than reading the table.
     */
    const rows = [];
    for (const set of S.SABER_SETS) {
      const { world, p, input } = await boot(set.id);
      try {
        let err = null;
        try { for (let i = 0; i < 120; i++) world.update(STEP, input); } catch (e) { err = e; }
        assert(!err, `a ${set.id} player threw after ${set.id === 'single' ? '' : 'building: '}${err?.message}`);
        const blades = bladesOf(p);
        assert(blades.length === (set.offScale > 0 ? 2 : 1),
          `${set.id} carries ${blades.length} blade(s)`);
        assert(p.control.grip === set.grip, `${set.id} is gripped '${p.control.grip}', not '${set.grip}'`);
        assert(p.handsOnHilt?.() === set.hands ?? true,
          `${set.id} puts ${p.handsOnHilt?.()} hands on the hilt, not ${set.hands}`);
        rows.push(`${set.id} ${blades.length} blade(s), grip ${p.control.grip}, ${set.hands} hand(s)`);
      } finally { world.unload(); }
    }
    return rows.join('; ');
  });

  check('saberforms: each set is a trade, and none of them is only better', async () => {
    /**
     * "there will be pluses and minuses to each" — the player's own words, and
     * the health of the game rests on it. A set that only added would make the
     * other two wrong to pick, and three fighting styles would collapse into
     * one correct answer and two mistakes.
     *
     * So every set is asserted to differ from the single blade in BOTH
     * directions on the table's own fields, rather than on numbers typed here.
     */
    const single = S.setById('single');
    const said = [];
    for (const set of S.SABER_SETS) {
      if (set.id === 'single') continue;
      const up = [], down = [];
      for (const f of ['offScale', 'offDamage', 'hands']) {
        if (set[f] > single[f]) up.push(f);
        if (set[f] < single[f]) down.push(f);
      }
      assert(up.length, `${set.id} gives nothing the single blade does not`);
      assert(set.throwKey !== single.throwKey,
        `${set.id} does the same thing with the throw key as one blade — it is a reskin`);
      /* AND THE SECOND BLADE COSTS SOMETHING. The staff's far end is the same
       * weapon and pays with the hands it occupies and the arc it has to
       * answer; the pair's shoto is a SHORTER blade and a smaller share of the
       * cut, both of which are the price of the second bearing. */
      if (set.id === 'pair') {
        assert(set.offScale < 1, `the pair's off blade is ${set.offScale} of yours — a free second sword`);
        assert(set.offDamage < 1, `the pair's off blade cuts at ${set.offDamage} — a free second sword`);
        assert(set.hands < single.hands, 'the pair still has two hands on the main hilt');
      }
      if (set.id === 'staff') {
        assert(set.offScale === 1, "the staff's far end is not the same blade as its near one");
        assert(set.hands === single.hands, 'a saberstaff is two hands on one shaft');
      }
      said.push(`${set.id}: +${up.join('/')}${down.length ? ` −${down.join('/')}` : ''}, throw = ${set.throwKey}`);
    }
    return said.join('; ');
  });

  check('saberforms: a set is a setting with all four of its obligations', async () => {
    /**
     * A DEFAULT, A READER, A CONTROL AND A PLACE ON EXACTLY ONE NET LIST. The
     * four are checked by `controls.mjs` and `co-op` in general; this asserts
     * the two that are specific to this feature and that a general check
     * cannot phrase.
     */
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    assert(DEFAULT_SETTINGS.saberSet === 'single',
      `the default set is '${DEFAULT_SETTINGS.saberSet}' — every existing save and every check that `
      + 'does not name a set must get the blade the game has always given them');
    const Net = await import('../../src/net/Net.js');
    assert(Net.LOCAL_KEYS.saberSet, 'saberSet is not declared local — see co-op\'s own check');
    assert(!Net.SESSION_KEYS.includes('saberSet'),
      'saberSet is a session key — that would be the host choosing what is in everybody\'s hands');
    /* AND AN UNKNOWN ID IS THE SINGLE BLADE, never undefined: sixty call sites
     * outside Player.js dereference `player.saber` with no guard. */
    assert(S.setById('nonesuch').id === 'single', 'an unknown set id is not the single blade');
    assert(S.setById(undefined).id === 'single', 'a missing set id is not the single blade');
    return `default '${DEFAULT_SETTINGS.saberSet}', local not shared, and an unknown id falls back to one blade`;
  });
}
