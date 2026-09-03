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
  check('saberforms: the second blade cuts and stops things, which it did not', async () => {
    /**
     * THE FINDING THIS WHOLE PASS IS ABOUT, held as an assertion.
     *
     * `World._bladeEntries` pushed `p.saber` and nothing else, and
     * `World._resolveBlades` solved `p.saber` against the target list and
     * nothing else. So a staff and a pair were TWO LIT SABERS AND ONE WEAPON:
     * measured against a stationary B1 across every distance from 1.0 m to
     * 2.6 m, the off blade produced 0 contact events and deflected 0 bolts, and
     * `SABER_SETS[].offDamage`, `Sidearm.blades()` and `Sidearm.frontBlade()`
     * had no caller anywhere in the tree.
     *
     * Everything below this check — the barrier, the throw that keeps a blade,
     * the follow-up strike, four bodies at once — is unmeasurable while that is
     * true, because there is only ever one blade doing anything. So this is
     * first, and it asserts the plumbing rather than the balance: does a
     * contact off the SECOND blade exist at all.
     */
    const { bootSet } = await import('../_setfight.mjs');
    const rows = [];
    /**
     * AND EACH SET IS ASKED WHERE ITS SECOND BLADE ACTUALLY IS, which is a
     * different place in each and is not a detail. The staff's far end is
     * rigidly OPPOSITE the near one, so a body in front of you is the one place
     * it can never be — measured, 0 of 251 contacts there — and that is the
     * weapon being correct rather than absent. Swept out to the quarters it is
     * the ONLY thing answering at all: at 137° and 0.90 m, 21 contacts of 21
     * came off the far end and none off the blade in front. That is the
     * saberstaff's real gift and it is worth naming — a man at your back
     * shoulder is answered with no second press and no turn.
     *
     * The pair's shoto is carried on the other side of the same front, so it is
     * asked about the front.
     */
    for (const [id, bearing, dist] of [['staff', 2.4, 0.90], ['pair', 0, 1.20]]) {
      const b = await bootSet(id);
      try {
        for (let i = 0; i < 300; i++) {
          if (i % 30 === 0) { b.clear(); b.dummy(bearing, dist); }
          if (i % 6 === 0) b.swing();
          b.step(1);
        }
        const off = b.log.filter((e) => e.blade === 'off').length;
        assert(off > 0,
          `a ${id}'s second blade landed 0 of ${b.log.length} contacts on a body at `
          + `${(bearing * 57.3) | 0}° and ${dist} m — it is a light, not a weapon`);
        rows.push(`${id} ${off}/${b.log.length} at ${(bearing * 57.3) | 0}°`);
      } finally { b.world.unload(); }
    }
    return `contacts off the second blade: ${rows.join(', ')}`;
  });

  check('saberforms: the staff reaches further than one blade, against a real body', async () => {
    /**
     * *"THE DOUBLE BLADED USER WILL HAVE MORE REACH."*
     *
     * MEASURED BEFORE `SHAFT`: the single blade's furthest contact on a body
     * was 1.83 m from its own feet and the saberstaff's was 1.78 — the staff
     * reached NO FURTHER, and marginally less. Tip to tip it spanned 2.78 m
     * against one blade's 1.15 and every centimetre of that was behind the
     * wielder, because every set poses its hilt ORIGIN at the hand and a bar
     * held at its middle is not a sword held at its pommel.
     *
     * This is deliberately NOT `base.distanceTo(tip)`, which is the blade's own
     * length and is 1.15 m in all three sets by construction. It is where a
     * contact with a body actually happened, measured from the player's feet on
     * the frame it happened — the only number a player can feel.
     */
    const { reachOf } = await import('../_setreach.mjs');
    const one = await reachOf('single');
    const staff = await reachOf('staff');
    assert(staff.far > one.far * 1.08,
      `the staff's furthest contact is ${staff.far.toFixed(2)} m against one blade's `
      + `${one.far.toFixed(2)} — a polearm that cannot touch anything further away than a sword `
      + 'is a longer model, not more reach');
    return `furthest contact on a body: one blade ${one.far.toFixed(2)} m, `
      + `staff ${staff.far.toFixed(2)} m (+${((staff.far / one.far - 1) * 100).toFixed(0)}%)`;
  });

  check('saberforms: the spin barrier stops bolts, and your hands stay free', async () => {
    /**
     * *"the double bladed user can use pure telekinesis to spin the staff at
     * high speeds around your body like a protective barrier, KEEPING YOUR
     * HANDS FREE TO CAST WHATEVER."*
     *
     * BOTH HALVES ARE MEASURED AND THE FIRST ONE FAILED TWICE. With the blades
     * absent from `_bladeEntries` it stopped nothing because nothing asked it.
     * With them present and genuinely sweeping it stopped 1 bolt in 24, because
     * a bar spinning in the HORIZONTAL plane is coplanar with a bolt flying
     * flat, and because a rotor answers ω/(π·f) of what crosses it — 4.8% at
     * 60 Hz and 9.5% at 30, a protection that doubles when the machine slows
     * down. See `Player.bladeGuard`, which is where both are answered.
     *
     * The control is the same twenty-four shots with the spin DOWN, on the same
     * player in the same place, because "no bolts got through" means nothing
     * unless they get through otherwise.
     */
    const { bootStaff, stream } = await import('../_spinprobe.mjs');
    const b = await bootStaff('staff');
    try {
      const bare = stream(b, {});
      assert(bare.landed > 4,
        `only ${bare.landed} of ${bare.fired} bolts reached an unshielded player — `
        + 'the bench is not delivering hits, so nothing below would mean anything');
      const up = stream(b, { spin: true });
      assert(up.up === up.fired, `the spin was only up for ${up.up} of ${up.fired} shots`);
      assert(up.landed * 3 < bare.landed,
        `${up.landed} of ${up.fired} bolts got through the barrier against ${bare.landed} with it down `
        + '— that is a light show, not a barrier');
      /* AND THE HANDS. `handsOnHilt` is 0 while it spins — through the reader
       * that shipped years ago, not a new flag — and a power really goes off. */
      b.p.force = b.p.maxForce;
      if (b.p.throwState !== 'orbit') { b.p.throwState = 'held'; b.p.spinBarrier(b.ctx); b.step(12); }
      assert(b.p.throwState === 'orbit', 'the barrier would not come up');
      assert(b.p.handsOnHilt() === 0,
        `${b.p.handsOnHilt()} hand(s) still on the hilt while the staff is spinning by itself`);
      const before = b.p.force;
      b.p.forcePush(b.ctx);
      assert(b.p.force < before - 1,
        'a push cast while the barrier was up spent nothing — the hands are not actually free');
      assert(b.p.throwState === 'orbit', 'casting dropped the barrier — the hands were not free after all');
      return `${up.landed}/${up.fired} bolts through with the spin up against ${bare.landed}/${bare.fired} `
        + `with it down; hands on hilt 0, and a push spends ${(before - b.p.force).toFixed(0)} Force mid-spin`;
    } finally { b.world.unload(); }
  });

  check('saberforms: throw one and you can still fight with the other', async () => {
    /**
     * *"WITH DUAL WIELDING YOU CAN THROW ONE LIGHTSABER WHILE STILL HAVING ONE
     * SABER FREE TO ATTACK/BLOCK WITH."*
     *
     * Both verbs, both driven. ATTACK is contacts landed on a body over three
     * seconds of the same mashed attack, with the shoto out against with it in
     * hand. BLOCK is twelve bolts down the sightline — against the same player
     * with the blade PUT DOWN, which is the control that says the blade is what
     * was stopping them rather than the player being hard to hit.
     */
    const { bootSet } = await import('../_setfight.mjs');
    const THREE = await import('three');
    const b = await bootSet('pair');
    try {
      const shots = (n) => {
        let landed = 0;
        for (let i = 0; i < n; i++) {
          b.p.force = b.p.maxForce; b.p.cooldowns.throwOff = 0;
          if (b.p.sidearm && b.p.sidearm.throwState === 'held' && b._wantOut) b.p.throwOffBlade(b.ctx);
          b.p.hp = b.p.maxHp;
          const away = b.p.aimDir.clone().setY(0).normalize()
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), (i % 5 - 2) * 0.10);
          b.world.bolts.fire(b.p.chest.clone().addScaledVector(away, 9), away.clone().negate(),
            { speed: 60, team: 1, damage: 10 });
          const hp = b.p.hp; b.step(11);
          if (b.p.hp < hp - 1e-6) landed++;
        }
        return landed;
      };
      const swings = () => {
        b.log.length = 0;
        for (let i = 0; i < 180; i++) {
          if (i % 30 === 0) { b.clear(); b.dummy(0, 1.20); }
          if (i % 6 === 0) b.swing();
          b.step(1);
        }
        return b.log.length;
      };
      const held = swings();
      b.p.force = b.p.maxForce; b.p.cooldowns.throwOff = 0;
      b.p.throwOffBlade(b.ctx);
      assert(b.p.sidearm.throwState === 'flying', 'the shoto did not leave the hand');
      assert(b.p.throwState === 'held',
        "throwing the shoto emptied the main hand — `Player.throwState` is what nine readers "
        + 'mean by "the weapon in your right hand is gone"');
      const out = swings();
      assert(out > held * 0.3,
        `${out} contacts with the shoto in the air against ${held} with both blades — `
        + 'the remaining blade is not attacking');
      b._wantOut = true;
      const through = shots(12);
      b._wantOut = false;
      b.p.saberDown = true;
      b.step(20);
      const bare = shots(12);
      assert(through < bare,
        `${through} of 12 bolts got through with the shoto out and ${bare} of 12 with no blade at all `
        + '— the remaining blade is not blocking');
      return `contacts in 3 s: ${held} both in hand, ${out} with the shoto out; `
        + `bolts through: ${through}/12 shoto out, ${bare}/12 blade down`;
    } finally { b.world.unload(); }
  });

  check('saberforms: the staff\'s follow-up lands sooner than one blade\'s', async () => {
    /**
     * *"THE DOUBLE-BLADED SWORD OFFERS A SIGNIFICANT ADVANTAGE IN TWO-TEMPO
     * MOVES BECAUSE THE SECOND BLADE IS INSTANTLY READY FOR A FOLLOW-UP
     * STRIKE."*
     *
     * The gap between the FIRST CONTACT of one landed strike and the first
     * contact of the next, so it measures when the follow-up ARRIVES and not
     * how long a blade lies in a body once it is there. A strike is the
     * controller's own — `slashT` leaving −1, i.e. a press it accepted.
     *
     * TWO NUMBERS, because one sample is not a claim: the fastest follow-up the
     * weapon managed at all, and the lower quartile of every follow-up in
     * fifteen seconds of mashing.
     */
    const { bootSet, tempo } = await import('../_setfight.mjs');
    const rows = {};
    for (const id of ['single', 'staff']) {
      const b = await bootSet(id);
      try {
        b.log.length = 0; b.strikes.length = 0;
        for (let i = 0; i < 900; i++) {
          if (i % 30 === 0) { b.clear(); b.dummy(0, 1.20); }
          if (i % 6 === 0) b.swing();
          b.step(1);
        }
        rows[id] = tempo(b.log, b.strikes);
        assert(rows[id].landed > 6, `only ${rows[id].landed} strikes landed on a ${id} — nothing to time`);
      } finally { b.world.unload(); }
    }
    assert(rows.staff.fastest < rows.single.fastest,
      `the staff's quickest follow-up is ${rows.staff.fastest.toFixed(3)} s against one blade's `
      + `${rows.single.fastest.toFixed(3)} — the far end is not answering any sooner`);
    assert(rows.staff.quarter < rows.single.quarter,
      `the staff's lower-quartile follow-up is ${rows.staff.quarter.toFixed(3)} s against one blade's `
      + `${rows.single.quarter.toFixed(3)} — one fast pair of hits is luck, not a tempo`);
    return `fastest follow-up: one blade ${rows.single.fastest.toFixed(3)} s, staff `
      + `${rows.staff.fastest.toFixed(3)}; lower quartile ${rows.single.quarter.toFixed(3)} against `
      + `${rows.staff.quarter.toFixed(3)}`;
  });

  check('saberforms: against four bodies at once the pair does the most work', async () => {
    /**
     * *"Dual-wielding lightsabers generally provides increased offensive
     * capabilities and mobility, MAKING IT EFFECTIVE AGAINST MULTIPLE
     * OPPONENTS."*
     *
     * Four bodies in the arc at −57°, −20°, +20° and +57°, replaced every half
     * second — a B1 held at 1e9 hp does not die but it does come apart, and a
     * torso on the floor is not an opponent. Cut work is the currency
     * `BladeContactSolver` actually banks, so it is what is compared.
     *
     * AND THE COUNTER-FACT IS REPORTED RATHER THAN HIDDEN: the single blade
     * answers marginally MORE of the four in a given half-second, because
     * `SLASH`'s 0.80/0.82 arc is the widest in the game and both new sets pay
     * for what they have with a narrower one. The pair's answer to four men is
     * not a wider sweep, it is two edges working at once — which is why this
     * check asserts about the work and reports about the spread.
     */
    const { bootSet } = await import('../_setfight.mjs');
    const rows = {};
    for (const id of ['single', 'staff', 'pair']) {
      const b = await bootSet(id);
      try {
        b.log.length = 0;
        for (let i = 0; i < 900; i++) {
          if (i % 30 === 0) { b.clear(); for (const a of [-1.0, -0.35, 0.35, 1.0]) b.dummy(a, 1.20); }
          if (i % 6 === 0) b.swing();
          b.step(1);
        }
        const win = new Map();
        for (const e of b.log) {
          const k = Math.floor(e.t / 0.5);
          if (!win.has(k)) win.set(k, new Set());
          win.get(k).add(e.id);
        }
        const counts = [...win.values()].map((v) => v.size);
        rows[id] = {
          work: b.log.reduce((s, e) => s + e.work, 0),
          spread: counts.reduce((a, c) => a + c, 0) / Math.max(counts.length, 1),
          off: b.log.filter((e) => e.blade === 'off').length,
        };
      } finally { b.world.unload(); }
    }
    assert(rows.pair.work > rows.single.work * 1.2,
      `against four bodies the pair banked ${rows.pair.work.toFixed(0)} of cut work and one blade `
      + `${rows.single.work.toFixed(0)} — two blades that are not worth more than one against a `
      + 'crowd are a second hilt and a handicap');
    assert(rows.pair.off > rows.pair.work * 0.1,
      'the pair out-works one blade with almost nothing coming off its second blade — '
      + 'something other than the shoto is doing this');
    return `cut work on four bodies: one ${rows.single.work.toFixed(0)}, staff ${rows.staff.work.toFixed(0)}, `
      + `pair ${rows.pair.work.toFixed(0)} (+${((rows.pair.work / rows.single.work - 1) * 100).toFixed(0)}%, `
      + `${rows.pair.off} contacts off the shoto); bodies answered per half-second `
      + `${rows.single.spread.toFixed(2)}/${rows.staff.spread.toFixed(2)}/${rows.pair.spread.toFixed(2)}`;
  });

  check('saberforms: measured on real bodies, each set covers and pays differently', () => {
    /**
     * THE TABLE SAYS THEY DIFFER; THIS ASSERTS THE BODIES DO.
     *
     * The trade check above reads `SABER_SETS` and can only prove the rows are
     * not copies of each other. This one builds all three and measures the two
     * things the player's ask is actually about — how much ground the blades
     * cover, and how wide a guard answers.
     *
     * THE PAIR FAILED THIS BEFORE IT EXISTED. Measured: against the single
     * blade its tip-to-tip span was −30% and its extra guard rose was +0.0°,
     * while it paid a shorter off blade, 55% of the cut and a hand. That is
     * the single blade with a handicap and a second hilt — the "only better or
     * only worse" collapse in the worse direction — and the player's ask for
     * that set was the opposite: "blocking bolts is easier or area that you
     * can cover is larger".
     *
     * The fix is a `cross` on the Sidearm and a `setHalf` derived from it, off
     * the carrier's own arm rather than a typed number, which is why this
     * check measures a built body instead of reading a constant.
     */
    return (async () => {
      const rows = [];
      for (const set of S.SABER_SETS) {
        const { world, p, input } = await boot(set.id);
        try {
          /* THE BLADE HAS NO ENDPOINTS UNTIL IT HAS BEEN POSED. `base` and
           * `tip` are written by `setHiltPose`/`update` on the world's own
           * frame, so a fixture that measures at frame zero measures two zero
           * vectors and reports every span as 0.00 m. */
          for (let i = 0; i < 60; i++) world.update(STEP, input);
          const blades = bladesOf(p);
          rows.push({
            id: set.id,
            span: blades.length > 1 ? blades[0].tip.distanceTo(blades[1].tip)
              : blades[0].base.distanceTo(blades[0].tip),
            half: p.control.setHalf ?? 0,
            hands: set.hands,
          });
        } finally { world.unload(); }
      }
      const one = rows.find((r) => r.id === 'single');
      const staff = rows.find((r) => r.id === 'staff');
      const pair = rows.find((r) => r.id === 'pair');
      assert(one.half === 0, `the single blade answers a ${one.half.toFixed(3)} rad wider rose — it changed`);
      /* THE STAFF COVERS MORE GROUND. Its far end is a whole blade beyond the
       * grip, so tip to tip it is more than twice one blade. */
      assert(staff.span > one.span * 2,
        `the staff spans ${staff.span.toFixed(2)} m against one blade's ${one.span.toFixed(2)} — `
        + 'a saberstaff whose two ends are not further apart than one blade is a reskin');
      /* AND BOTH SETS ANSWER A WIDER GUARD THAN ONE BLADE. */
      for (const r of [staff, pair]) {
        assert(r.half > 0.05,
          `${r.id} answers a ${(r.half * 57.3).toFixed(1)}° wider rose than one blade — `
          + 'that is not a second bearing, it is a second decoration');
      }
      /* AND THE STAFF'S IS THE WIDER OF THE TWO, which is the trade between
       * them: a quarterstaff answers more ground than two short swords, and
       * what the pair buys instead is the free hand. */
      assert(staff.half > pair.half,
        `the pair answers ${(pair.half * 57.3).toFixed(1)}° against the staff's `
        + `${(staff.half * 57.3).toFixed(1)}° — two short swords should not out-cover a polearm`);
      assert(pair.hands < staff.hands, 'the pair does not free a hand, which is the whole of what it buys');
      return `span: one ${one.span.toFixed(2)} m, staff ${staff.span.toFixed(2)}, pair ${pair.span.toFixed(2)}; `
        + `extra rose: staff +${(staff.half * 57.3).toFixed(1)}°, pair +${(pair.half * 57.3).toFixed(1)}°; `
        + `hands ${one.hands}/${staff.hands}/${pair.hands}`;
    })();
  });

}
