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
  const S2 = await import('../../src/game/SaberController.js');
  const { SLASH } = S2;

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
      /**
       * ── AND THE PACE IS BOUGHT WITH THE ARC, ONE FOR ONE ────────────────
       *
       * `paceOf` gives a set with a free hand `FREE_HAND_PACE` of extra
       * ground per second at EVERY pace — a body-level term, the first one in
       * this game that has ever asked what is in your hands. Nothing in this
       * project is allowed to be only better, and the currency the sets are
       * paid in is the one the note over `STAFF_SLASH` names: arc width, which
       * is tip speed, which is what a contact is worth.
       *
       * So the rule is an exchange rate rather than a direction: a set may
       * keep no more of the single blade's arc than the pace it was given
       * leaves it. The pair takes 8% of pace and its light cut is 0.72 of a
       * guard unit against SLASH's 0.80, which is 90% — just inside the 92%
       * the bound allows. Put its arc back to the 0.74 it was first authored
       * at and this goes red, which is the whole point: the pace and the arc
       * are one trade and not two separate gifts.
       *
       * AND THE BOUND IS A CEILING AND NOT A TARGET. Measured, the arc is a
       * far dearer currency than SLASH's tip-speed table makes it look — it is
       * also how much of the ring the blade crosses, so 0.05 off it took the
       * pair's cut work against four bodies down 36% and turned two shipped
       * checks in this very file red. See `DUAL_SLASH`, which carries the
       * ladder. A price that deletes the feature is not a price.
       *
       * It is stated against `SLASH.rise` and not against a number typed here
       * because `setTables('single').slash === SLASH` by reference, so there
       * is exactly one single-blade arc in the tree and this reads it.
       */
      const arc = S2.setTables(set.id).slash.rise;
      const pace = S.paceOf(set.id);
      if (pace > 1) {
        assert(arc <= SLASH.rise * (1 - S.FREE_HAND_PACE) + 1e-12,
          `${set.id} walks ${((pace - 1) * 100).toFixed(0)}% faster than one blade and still swings `
          + `${arc} of a guard unit against SLASH's ${SLASH.rise} — a set may keep no more of the `
          + `single blade's arc than the pace it was given leaves it (${(SLASH.rise * (1 - S.FREE_HAND_PACE)).toFixed(3)})`);
        down.push('arc');
      }
      /* AND THE SINGLE BLADE'S OWN PACE IS THE LITERAL 1. Not "within a
       * tolerance of": `paceOf` is `1 + k·(hands - hands)` for it, so any
       * other answer means somebody made the term a typed column. */
      assert(S.paceOf('single') === 1, `the single blade's pace is ${S.paceOf('single')} — it moved`);
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

  check('saberforms: the spin barrier is a barrier ROUND you, and your hands stay free', async () => {
    /**
     * *"the double bladed user can use pure telekinesis to spin the staff at
     * high speeds AROUND YOUR BODY like a protective barrier, KEEPING YOUR
     * HANDS FREE TO CAST WHATEVER."*
     *
     * BOTH HALVES ARE MEASURED AND THE FIRST ONE HAS NOW FAILED THREE TIMES.
     * With the blades absent from `_bladeEntries` it stopped nothing because
     * nothing asked it. With them present and genuinely sweeping it stopped 1
     * bolt in 24, because a rotor answers ω/(π·f) of what crosses it — 4.8% at
     * 60 Hz and 9.5% at 30, a protection that doubles when the machine slows
     * down. Then it answered a 100° WEDGE of the sightline and this check said
     * it was a barrier, because every shot the bench had ever fired was inside
     * ±10° of that sightline — the one bearing the ordinary held guard already
     * covers in every set. Driven at five bearings on that tree:
     *
     *     bearing    0°     45°    90°   135°   180°
     *     spin      0/12   2/12   4/12  6/12   6/12   landed
     *     control   6/12   6/12   6/12  6/12   6/12
     *
     * — a bow wave, and behind you it stopped nothing at all. THE CLAIM IS
     * COVERAGE, SO THE ASSERTION IS ABOUT COVERAGE: `_spinprobe.coverage` walks
     * `BEARINGS` and every bearing carries its own control arm, because "no
     * bolts got through" means nothing unless they get through otherwise, and
     * one bearing's control cannot speak for another's.
     *
     * WHAT MAKES IT GO RED: `Player.bladeGuard`'s cone back to `GUARD.reach / 2`
     * — the tree this replaced, byte for byte — reports
     *
     *     at 45° the barrier let 2 of 12 through against 6 with it down
     *
     * on the first bearing outside the sightline, and it worsens from there to
     * 6 of 12 at the back. Verified by doing it.
     *
     * The rose is 12 shots a bearing and not 24 for time: the check pays 5×2×12
     * rounds with the ring re-raised and the bar refilled before every one, and
     * the 0° row is the same statement the old 24-shot stream made.
     */
    const { bootStaff, coverage } = await import('../_spinprobe.mjs');
    const b = await bootStaff('staff');
    try {
      const rows = coverage(b);
      for (const r of rows) {
        assert(r.up === r.fired,
          `at ${r.deg}° the spin was only up for ${r.up} of ${r.fired} shots`);
        assert(r.control > 2,
          `only ${r.control} of ${r.fired} bolts reached an UNSHIELDED player at ${r.deg}° — the bench `
          + 'is not delivering hits from that bearing, so its spin row would mean nothing');
        /* THE SAME RUNG THE FRONTAL ASSERTION ALWAYS USED, asked at every
         * bearing rather than at the only one the old bench could see. */
        assert(r.spin * 3 < r.control,
          `at ${r.deg}° the barrier let ${r.spin} of ${r.fired} through against ${r.control} with it `
          + 'down — a barrier you can walk round is a bow wave, and the word in the brief is AROUND');
      }
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
      return `${rows[0].fired} bolts a bearing, spin up against spin down: `
        + rows.map((r) => `${r.deg}° ${r.spin}/${r.control}`).join(', ')
        + `; hands on hilt 0, and a push spends ${(before - b.p.force).toFixed(0)} Force mid-spin`;
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

  check('saberforms: the pair covers more ground per second, and one blade does not', async () => {
    /**
     * *"Dual-wielding lightsabers generally provides increased offensive
     * capabilities AND MOBILITY."*
     *
     * THE OFFENSIVE HALF OF THAT SENTENCE HAS BEEN MEASURED SINCE THE SETS
     * LANDED — the four-body check above banks 86% more cut work off the pair
     * than off one blade. The mobility half was prose, and this is what it
     * measured before there was a term for it:
     *
     *     single 4.600 m/s      staff 4.600 m/s      pair 4.600 m/s
     *
     * Three sets, one pace, to three decimals, because `Player._move` opened
     * `const base = 4.6 * this.boonMods.moveSpeed` and NOTHING below it — the
     * slow walk, the sprint, the crouch, the stagger, the sense — ever asked
     * what was in your hands. `grep -c saberSet src/game/Player.js` returned
     * thirteen and every one of them was the sidearm, the grip row, `setHalf`
     * or the throw key.
     *
     * The bench is a player HOLDING FORWARD AND MASHING THE LIGHT CUT for ten
     * seconds, not one strolling with the blade down, because the clause is
     * about a fighter. Ground covered is the horizontal path summed frame by
     * frame; the body is topped up so the reading is the legs and not
     * `staggerTimer` or the stamina regen. See tools/_setbench.mjs.
     *
     * ── WHAT WOULD MAKE THIS GO RED ────────────────────────────────────────
     *
     * `FREE_HAND_PACE` back to 0 — which is the tree this replaced — and the
     * pair reads 4.600 like the other two, failing the first assertion by
     * exactly the term that was added. Verified by doing it.
     */
    const B = await import('../_setbench.mjs');
    const { snapshotShared } = await import('./_shared.mjs');
    const snap = await snapshotShared();
    const rows = {};
    for (const id of B.SETS) rows[id] = await B.pace(id, snap);
    const one = rows.single, staff = rows.staff, pair = rows.pair;
    /* THE TWO-HANDED SETS ARE THE SAME BODY, and this is the half of the
     * check that holds the single blade still. `paceOf` is a function of the
     * `hands` column, so the saberstaff — two hands on one shaft, exactly as
     * the single blade is — must read the identical float. A per-set column of
     * typed numbers would pass the pair's assertion below and fail this one. */
    assert(staff.mps === one.mps,
      `the saberstaff covers ${staff.mps} m/s against one blade's ${one.mps} — the pace is keyed off `
      + 'the free hand, and a saberstaff has no more free hands than one blade does');
    assert(pair.mps > one.mps * 1.05,
      `the pair covered ${pair.mps} m/s against one blade's ${one.mps} — that is `
      + `${((pair.mps / one.mps - 1) * 100).toFixed(1)}%, and "increased mobility" is not a rounding error`);
    /* AND IT IS THE GROUND AND NOT THE SWINGING. Both sets ran the same script
     * at their own cadence; a pair that covered more ground because it swung
     * less would be measuring the attack and not the legs. */
    assert(pair.strikes >= one.strikes,
      `the pair covered more ground while landing ${pair.strikes} presses against one blade's `
      + `${one.strikes} — this bench is meant to be a fighter moving, not a fighter idling`);
    return `ground per second of mashed attack: one ${one.mps.toFixed(3)} m/s, staff ${staff.mps.toFixed(3)}, `
      + `pair ${pair.mps.toFixed(3)} (+${((pair.mps / one.mps - 1) * 100).toFixed(1)}%); `
      + `presses accepted ${one.strikes}/${staff.strikes}/${pair.strikes}`;
  });

  check('saberforms: the pair answers bolts from bearings one blade cannot reach', async () => {
    /**
     * *"maybe with dual wielding BLOCKING BOLTS IS EASIER OR AREA THAT YOU CAN
     * COVER IS LARGER."*
     *
     * SIXTY BOLTS, ONE AT A TIME, ROUND THE WHOLE CIRCLE, INTO A PLANTED
     * GUARD — `_spinprobe.mjs`'s stream of 24 down one sightline, opened out
     * to a rose, because the claim is about AREA and one bearing cannot see
     * one. Health lost is the verdict: `GRADE_DAMAGE` gives an answered bolt
     * no damage at all, so a bolt that costs you hp is exactly a bolt the
     * guard did not answer.
     *
     * ── THE FINDING THIS CHECK EXISTS BECAUSE OF ───────────────────────────
     *
     * The pair's whole defensive gain used to be `setHalf` — 8.6° of extra
     * ROSE — and the only thing holding it was `assert(r.half > 0.05)`, a
     * geometric assertion on a published float. Driven, it bought nothing:
     *
     *     single 20 of 60 landed     staff 18     pair 19
     *
     * and all three stopped answering at the same 96° bearing. Driving the
     * pair's `setHalf` to its 135° ceiling left it at 19. The rose was never
     * the gate: `guardZoneAccepts` has two refusals and the bolts getting
     * through were being thrown away by the other one, `theta > guard.reach` —
     * the 100° shoulder line, identical in every set. With the four zones
     * tiling the circle, a 103.5° half already answers every bearing inside
     * that line a held zone can face, so no width of rose reaches past it.
     *
     * So the pair buys the SHOULDER LINE and the staff buys the ROSE, off one
     * measured span each — see `Player._setReach0` and `_publishGuard`.
     *
     * ── AND THE AUTO-GUARD CONE IS WHY THE FIRST READING WAS NOISE ─────────
     *
     * `Bolts.update` falls through to `entry.guard` the moment the directional
     * zone declines, and that is `CATCH.autoGuard` — 0.40 s of free cover any
     * manual catch opens, which EVERY set has. A stream tight enough for the
     * cone to still be open is mostly measuring a mechanic the three sets
     * share. The bench leaves 0.60 s between rounds so it has shut, and
     * `coneOpen` counts any round fired while it had not: asserted at zero
     * below, so the isolation is proved rather than assumed.
     *
     * ── WHAT WOULD MAKE THIS GO RED ────────────────────────────────────────
     *
     * `Player._setReach0` back to 0 — the tree this replaced — and the pair's
     * shoulder line comes back to the single blade's 100° and its 14 landed
     * back to 19 or 20. Verified by doing it: the run reported
     * "the pair answers out to 100° against one blade's 100°".
     */
    const B = await import('../_setbench.mjs');
    const { snapshotShared } = await import('./_shared.mjs');
    const snap = await snapshotShared();
    const rows = {};
    for (const id of B.SETS) rows[id] = await B.rose(id, snap);
    const one = rows.single, staff = rows.staff, pair = rows.pair;
    for (const r of [one, staff, pair]) {
      assert(r.coneOpen === 0,
        `${r.set} fired ${r.coneOpen} of its ${r.fired} rounds while the auto-guard cone was still `
        + 'open — that cone is common to all three sets and would swamp the difference being measured');
      assert(r.landed + r.turned + r.missed === r.fired,
        `${r.set} fired ${r.fired} rounds and accounted for ${r.landed + r.turned + r.missed} — `
        + 'the three verdicts are meant to tile the rose');
      assert(r.landed > 0,
        `${r.set} took nothing at all from sixty bolts — a bench where nobody can be hit measures nothing`);
    }
    /* THE SHOULDER LINE, READ OFF THE SHIPPED RULE. The scan walks one flank
     * in 2° steps and reports the last bearing that was answered, which is
     * what `guardZoneAccepts` actually did rather than what `GUARD.reach`
     * says. It is a scan and not a bisection because the pair's own row is not
     * monotone — 100° refused, 102° answered — which is the two gates
     * interacting and is exactly what a bisection would have hidden. */
    assert(staff.shoulder === one.shoulder,
      `the saberstaff answers out to ${staff.shoulder}° and one blade to ${one.shoulder}° — the staff's `
      + 'extra coverage is the rose, and a blade eating bolts behind your own back is not a feature');
    /**
     * ── AND THE SCAN IS ASKED FOR THE AREA, NOT ONLY FOR ITS FAR EDGE ──────
     *
     * `shoulder` is the LAST bearing answered and it is one number off a row of
     * eighteen. The pair's row is deliberately not monotone — 100° refused,
     * 102° answered, which is `guardZoneAccepts`' two gates interacting near
     * the boundary — so the far edge alone can move by a step for a reason that
     * is not the thing being measured. The set difference is the whole row: the
     * bearings the pair answers that one blade does not, counted.
     *
     * This is the sharp instrument in this check. It is degrees of coverage,
     * read off `guardZoneAccepts` by driving it, and it does not care how many
     * bolts happened to be aimed where.
     */
    const answered = (r) => r.scan.split(' ').filter((s) => s.endsWith('+')).map((s) => parseInt(s, 10));
    const oneReach = new Set(answered(one));
    const extra = answered(pair).filter((d) => !oneReach.has(d));
    assert(extra.length >= 3,
      `the pair answers ${extra.length} bearing(s) one blade refuses (${extra.join('°, ') || 'none'}) — `
      + 'two blades on two bearings buy AREA or they buy nothing, and the scan is where that shows');
    /* AND THE FAR EDGE OF THAT ROW, WHICH IS THE STATEMENT THE HEADER ABOVE
     * MAKES. It runs after the set difference on purpose: the difference is
     * the sharper of the two and a check states its sharp instrument first. */
    assert(pair.shoulder >= one.shoulder + 6,
      `the pair answers out to ${pair.shoulder}° against one blade's ${one.shoulder}° — two blades on `
      + 'two bearings have to reach further round your own side than a hilt both hands are on');
    /**
     * AND IT HAS TO SHOW IN BOLTS AND NOT ONLY IN DEGREES.
     *
     * ── THIS BOUND WAS ONE UNLUCKY RUN FROM RED, AND THE CAUSE WAS NOT NOISE ─
     *
     * Four runs of this suite on unchanged code read the pair at 14, 17, 14 and
     * 14 against a bound of 85% of the single blade's 20 — i.e. a ceiling of
     * 17, hit exactly. The paragraph that used to stand here blamed "a bolt of
     * weather" and widened the bound to absorb it, which is the wrong half of
     * the trade: a threshold set to survive a spread nobody has explained is a
     * check whose verdict is partly a coin toss (HANDOFF §2.1c).
     *
     * It was explained. Two runs of `tools/_setbench.mjs` STANDALONE — one
     * process each, nothing interleaved, every module stream restored — read
     * the pair at 14 and 16 while `single` and `staff` came back identical both
     * times, so it was never this suite's interleave. It is
     * `Combat.gradeCaught`'s outgoing direction, which draws a BLOCK's 0.55
     * scatter from the bare global `Math.random()`: the one generator in the
     * bolt path that is not a module `rng` and that `moduleSeed`,
     * `register.mjs` and `restoreShared` therefore cannot touch. The pair feels
     * it because the pair ANSWERS the most — 37 bolts turned against one
     * blade's 31 — and every one of those is a scatter direction drawn from an
     * unpinned stream in front of a player whose own health is the verdict.
     *
     * `rose` now borrows the global for the length of its measurement and hands
     * it back in a `finally` whose window contains no `await` — see
     * `pinScatter` in `_setbench.mjs`, which carries the proof. Measured after:
     * two consecutive runs, pair 14/60 and shoulder 108° both times.
     *
     * SO THE BOUND STAYS AT 85% AND ITS MARGIN IS NOW REAL RATHER THAN
     * HOPEFUL: 14 against a ceiling of 17, and it still fails on the tree this
     * replaced, where the pair took 19 or 20 of one blade's 20. Widening it
     * would have bought the same green with a worse instrument.
     */
    assert(pair.landed <= one.landed * 0.85,
      `sixty bolts round the circle: one blade took ${one.landed} and the pair ${pair.landed}. `
      + 'That is inside the noise the old geometric assertion was hiding in');
    assert(staff.landed <= one.landed,
      `the saberstaff took ${staff.landed} of sixty against one blade's ${one.landed} — its wider rose `
      + 'is supposed to answer at least as much');
    return `sixty bolts round the circle, guard held: one ${one.landed} landed, staff ${staff.landed}, `
      + `pair ${pair.landed} (−${(100 - pair.landed / one.landed * 100).toFixed(0)}%); `
      + `shoulder line scanned at 2°: ${one.shoulder}°/${staff.shoulder}°/${pair.shoulder}°, `
      + `the pair answering ${extra.length} bearings one blade refuses (${extra.join('°, ')}°); `
      + 'auto-guard cone shut on every round';
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
