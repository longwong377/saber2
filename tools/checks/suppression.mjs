/**
 * BATTLEFRONT BORZ — SUPPRESSION. FLAGSHIP §6, held to what it actually does.
 *
 * The design: a bolt costs the GUARD, not the health. One B1 does 2.17 dps to a
 * moving player (46 seconds to kill) and wave 20 does 353.8 raw dps (0.28
 * seconds); there is no middle, and deflection being a percentage scales that
 * problem rather than solving it. So the deflection ladder is priced —
 * `Combat.GUARD_COST`, 1.2 stamina for a BLOCK, 0.4 for a DEFLECT, nothing for
 * a RETURN or a PERFECT, and 0.5 FORCE for a bolt the auto-guard cone answered
 * off a blade you never drove — and volume of fire becomes terrain.
 *
 * ── WHAT THIS FILE ASSERTS AND WHAT IT ONLY REPORTS ─────────────────────
 *
 * The design also states an arithmetic: "twenty B1s fire 18 bolts/s; at 1.2
 * that is 21.6 stamina/s against a 16/s regen and a 100 pool — underwater in
 * twelve seconds." EVERY TERM OF THAT IS AN ASSUMPTION ABOUT A REAL FIGHT, and
 * two of them are wrong on this tree. Measured here, on Geonosis, twenty B1s
 * at 14 m against a player holding the guard and doing nothing else:
 *
 *     fired          13.33 bolts/s      (the design says 18)
 *     answered        9.00 bolts/s      67% of them; the rest miss, hit the
 *                                        body, or are stopped by somebody else
 *     drain          10.80 stamina/s    against a 16/s regen
 *     net            +5.20/s            the bar does not empty at all
 *
 * So the twelve seconds do not happen at twenty rifles. What DOES happen is the
 * property the design is really about, and it is the thing asserted below: the
 * drain is proportional to the volume of fire, so there is a rifle count past
 * which standing still is not survivable, and it is inside the mode's own body
 * budget. Measured, the crossover is around 28 rifles — 19.03 fired/s, 13.74
 * answered/s, 16.49 stamina/s against the 16/s regen.
 *
 * A CHECK MUST NOT ASSERT A CONSTANT IT CANNOT DEFEND. The bounds below are
 * therefore on the SHAPE — a price ladder that only ever falls, a top rung that
 * is free, a drain that grows with the number of rifles, a crossover that
 * exists and is reachable — and the numbers are reported in the message. A
 * literal "12.0 seconds" here would be a bound on the wave composer, the aim
 * model, the terrain and the weather all at once, and it would fail for a
 * reason that has nothing to do with suppression.
 *
 * ── AND THE SECOND HALF OF §6 ───────────────────────────────────────────
 *
 * "At zero stamina there is no dash (18), no dive (18), no sprint." That is not
 * a new rule — the three refusals are shipped — but it is the half that makes
 * the first half matter, so it is checked through the shipped `_tryDash` rather
 * than trusted.
 */

import * as THREE from 'three';
import { GUARD_COST, GRADE, GRADE_NAME, GRADE_DAMAGE, guardCost, CATCH } from '../../src/game/Combat.js';
import { DIVE_STAMINA } from '../../src/game/Player.js';
import { clocked, snapshotShared, restoreShared } from './_shared.mjs';

/** The regen a player in combat gets back, read off Player's own `_regen`. */
const REGEN = 16;

export async function run({ check, assert }) {
  /**
   * THE SAME PHASE `clocked` PUTS BACK, REACHABLE FROM INSIDE ONE BODY.
   *
   * `clocked` restores the module-scope streams before a check body and after
   * it — that is the boundary BETWEEN checks. The pace check below is an A/B
   * INSIDE one body: it boots two Worlds back to back and compares them, and
   * there is no such boundary between the two boots. So the second one drew
   * from streams the first had already advanced and mustered a different army.
   * Its own note says why that is fatal; holding the suite's quiescent phase
   * here is what lets it re-seat both arms onto the same deal.
   */
  const phase = await snapshotShared();
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The ladder has prices, and they only ever fall                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('suppression: every rung of the deflection ladder has a price, and the top two are free', () => {
    assert(GUARD_COST.stamina.length === GRADE_NAME.length,
      `GUARD_COST.stamina has ${GUARD_COST.stamina.length} rows against ${GRADE_NAME.length} grades — `
      + 'a fifth grade with no price would silently cost nothing');
    assert(GUARD_COST.stamina.length === GRADE_DAMAGE.length,
      'the price column and the payout column disagree about how many rungs the ladder has');
    /* MONOTONE, and it is the whole design rather than a tidiness rule: the
     * better you meet a bolt the less it costs, with no rung where trying
     * harder is dearer. Read off the table in order, never restated. */
    for (let g = 1; g < GUARD_COST.stamina.length; g++) {
      assert(GUARD_COST.stamina[g] <= GUARD_COST.stamina[g - 1],
        `${GRADE_NAME[g]} costs ${GUARD_COST.stamina[g]} against ${GRADE_NAME[g - 1]}'s `
        + `${GUARD_COST.stamina[g - 1]} — meeting a bolt better must never cost more`);
    }
    assert(GUARD_COST.stamina[GRADE.PERFECT] === 0,
      `a PERFECT costs ${GUARD_COST.stamina[GRADE.PERFECT]} stamina — the design's one promise is that `
      + 'fire a player can answer perfectly cannot suppress them at all');
    assert(GUARD_COST.stamina[GRADE.RETURN] === 0, 'a RETURN is not free');
    assert(GUARD_COST.stamina[GRADE.BLOCK] > 0,
      'a BLOCK is free, so volume of fire costs the guard nothing and §6 does not exist');
    /* The auto-guard row is a different bar, and it must be — see GUARD_COST. */
    const auto = guardCost(GRADE.BLOCK, { auto: true, driven: false });
    assert(auto.force > 0 && auto.stamina === 0,
      `a bolt the cone answered cost ${auto.stamina} stamina and ${auto.force} Force — the fourth row `
      + 'of §6 is a Force cost precisely so the two bars drain in different fights');
    /* …and a blade the player DROVE pays the ordinary grade even if the cone
     * happened to cover the bolt. Both, or the player is billed twice. */
    const drove = guardCost(GRADE.DEFLECT, { auto: true, driven: true });
    assert(drove.force === 0 && drove.stamina === GUARD_COST.stamina[GRADE.DEFLECT],
      'a bolt met with a driven blade inside the cone is billed as an auto catch — a player who '
      + 'turned and answered it pays the Force as well as the grade');
    return GRADE_NAME.map((n, g) => `${n} ${GUARD_COST.stamina[g]}`).join(' · ')
      + ` · cone ${GUARD_COST.unanswered} Force`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  …and the shipped path actually charges them                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('suppression: a bolt answered on a real blade moves the bar, and does NOT pause the regen', async () => {
    const { firingLine } = await import('../_beaten.mjs');
    /**
     * ONE RIFLE, TEN SECONDS, and the two things being separated are:
     *
     *   the CHARGE   — `guardSpent` is cumulative and monotone, so it counts
     *                  what the guard paid whatever else spent the pool;
     *   the REGEN    — which must still be running. §6's arithmetic is a drain
     *                  RACING a refill, and a guard cost that set `staminaHold`
     *                  the way the dash does would be 21.6 against nothing.
     *                  `staminaHold` staying at zero is the whole of that
     *                  claim, and it is read off the player rather than off the
     *                  constant.
     */
    const r = await firingLine({ n: 4, range: 10, seconds: 14 });
    assert(r.answered > 0,
      'four B1s at 10 m answered zero bolts in fourteen seconds against a held guard — nothing below '
      + 'this line can be measured, and the fault is in the harness or in the guard, not the price');
    assert(r.guardSpent > 0,
      `${r.answered} bolts were answered and the guard paid ${r.guardSpent} — the charge is not wired`);
    /* Every answer off a PARKED blade is a BLOCK, so the total is the count
     * times the bottom rung. Asked of the table, never retyped. */
    const expect = r.answered * GUARD_COST.stamina[GRADE.BLOCK];
    assert(Math.abs(r.guardSpent - expect) < 0.5 + expect * 0.02,
      `${r.answered} answers off a parked blade cost ${r.guardSpent} against ${expect.toFixed(1)} — `
      + 'either the grade is not BLOCK or the price is not the table\'s');
    assert(r.staminaHold === 0,
      `answering a bolt left staminaHold at ${r.staminaHold}: the guard cost has paused the regen, `
      + 'which turns a 21.6-against-16 race into 21.6 against nothing');
    return `${r.answered} answered in ${r.seconds}s · ${r.guardSpent} stamina · regen never paused`;
  });

  check('suppression: the auto-guard cone spends FORCE and the ordinary ladder spends stamina', async () => {
    /**
     * THE ONE ROW A FIRING LINE CANNOT REACH, and the reason is worth writing
     * down: `CatchWindow.add` only opens the cone for a catch the player DROVE
     * (`snap.driven && !snap.auto`), so a probe that parks its blade never
     * opens one and the fourth row of §6 never fires. Measured — every run of
     * `tools/_beaten.mjs`, every rifle count, reads 0.00 Force a second.
     *
     * So the cone is opened here the way a manual catch opens it, and one bolt
     * is put through it, and the two bars are read. Everything below the cone
     * is shipped code: `Bolts.update` finds the guard, `World._onBoltDeflect`
     * grades it, `_creditDeflect` bills it.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    const idle = idleInput();
    try {
      const p = world.player;
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
      p.saber.ignite(); p.saber.ignition = 1;
      p.camera.yaw = Math.PI;
      /* Two frames with the blade parked, so `saber.baseVelocity` is honestly
       * zero and the contact cannot be graded as driven by the rig settling. */
      world.update(1 / 60, idle);
      world.update(1 / 60, idle);

      const cw = p.boltCatch;
      assert(cw, 'the player has no catch window, so the cone cannot be opened');
      cw.anchor = p.chest;
      cw.origin.copy(p.chest);
      cw.axis.set(0, 0, 1);                        // pointing down +z, where the bolt comes from
      cw.auto = CATCH.autoGuard;

      const stam0 = p.stamina, force0 = p.force, spent0 = p.guardSpent || 0;
      const from = p.chest.clone().add(new THREE.Vector3(0, 0, 3));
      world.bolts.fire(from, new THREE.Vector3(0, 0, -1), { speed: 60, team: 1, damage: 9 });
      for (let i = 0; i < 12 && (p.guardForceSpent || 0) === 0; i++) world.update(1 / 60, idle);
      /* The window holds the bolt for up to CATCH.hold, so the bill lands at
       * the throw. Step past it. */
      for (let i = 0; i < 40 && (p.guardForceSpent || 0) === 0; i++) world.update(1 / 60, idle);

      assert((p.guardForceSpent || 0) > 0,
        'a bolt driven into an open auto-guard cone off a parked blade cost no Force at all — '
        + '§6\'s fourth row is not wired, or the cone did not catch it');
      assert(Math.abs((p.guardForceSpent || 0) - GUARD_COST.unanswered) < 1e-6,
        `the cone charged ${p.guardForceSpent} Force against the table's ${GUARD_COST.unanswered}`);
      assert(Math.abs((p.guardSpent || 0) - spent0) < 1e-6,
        `the cone also charged ${(p.guardSpent || 0) - spent0} stamina — a bolt the player did not `
        + 'answer must cost one bar, not both');
      /* THE POOL MOVED DOWN, AND BY LESS THAN THE CHARGE — which is the
       * correct reading and not a slack bound. `Player._regen` refills Force
       * every frame, so over the fifty frames it takes the catch window to
       * expire and the throw to bill, part of the 0.5 has already come back.
       * The exact figure is the COUNTER's, which is cumulative and monotone
       * and is why it exists; the pool is asked only whether it noticed. */
      assert(force0 > p.force,
        `the Force pool is ${p.force.toFixed(3)} against ${force0.toFixed(3)} before the catch — `
        + 'the counter was written but nothing was actually taken out of the bar');
      assert(force0 - p.force <= GUARD_COST.unanswered + 1e-6,
        `the pool lost ${(force0 - p.force).toFixed(3)} against a ${GUARD_COST.unanswered} charge — `
        + 'something else is spending Force in this window and the reading is not the cone\'s');
      void stam0;
      return `cone catch → ${GUARD_COST.unanswered} Force, 0 stamina, pool ${force0.toFixed(0)} → ${p.force.toFixed(1)}`;
    } finally { world.unload?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Volume of fire is terrain                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('suppression: the drain grows with the volume of fire, and there is a count you cannot stand in', async () => {
    const { firingLine } = await import('../_beaten.mjs');
    /**
     * TWO POINTS ON THE CURVE, both on a real Geonosis with real B1s, and the
     * crossover DERIVED from the second rather than measured at it. A third
     * run at the crossover itself would cost another forty seconds of gate to
     * report a number this pair already implies, and it would sit within a
     * bolt or two of the line it is being compared to — a coin toss inside a
     * check (NEXT.md's own note on wall-clock bounds).
     */
    const few = await firingLine({ n: 6, range: 12, seconds: 20 });
    const many = await firingLine({ n: 20, range: 12, seconds: 20 });
    assert(many.drainPerS > few.drainPerS * 1.5,
      `six rifles drain ${few.drainPerS}/s and twenty drain ${many.drainPerS}/s — volume of fire is `
      + 'not costing the guard proportionally, so a crowd is not terrain, it is scenery');
    /* THE BEATEN ZONE, in rifles: how many it takes for the drain to beat the
     * refill. Linear in the count because the drain is a sum over shooters,
     * and taken off the larger sample. */
    const perRifle = many.drainPerS / many.rifles;
    assert(perRifle > 0, 'a rifle costs the guard nothing');
    const crossover = REGEN / perRifle;
    /**
     * BOUNDED ABOVE BY THE MODE'S OWN BODY BUDGET, not by a number chosen
     * here. FLAGSHIP §4 measures `maxAlive = 26` as honest and the design
     * fields 40–60 live bodies, so a beaten zone that needs more rifles than
     * the mode can put on the field is a mechanic that never fires.
     */
    assert(crossover <= 60,
      `it takes ${crossover.toFixed(1)} rifles firing at once before the guard drain beats the `
      + `${REGEN}/s regen, and the mode fields 40–60 bodies of which only some are riflemen. `
      + 'At that price volume of fire is not terrain.');
    assert(crossover >= 4,
      `${crossover.toFixed(1)} rifles empty the bar — at that price a patrol suppresses a Jedi and `
      + 'the guard is not a resource, it is a countdown');
    return `${few.rifles} rifles → ${few.drainPerS}/s · ${many.rifles} → ${many.drainPerS}/s `
      + `(${many.firedPerS} fired/s, ${(many.answeredShare * 100).toFixed(0)}% answered) · `
      + `regen ${REGEN}/s is beaten at ${crossover.toFixed(1)} rifles`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  …and the line moves at the pace of its slowest man                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('suppression: the objective advances at the pace of the slowest friendly inside 14 m', async () => {
    /**
     * FLAGSHIP §6's second half, and it is the one rule in that section that
     * was already HAPPENING and had never been designed:
     *
     *   "The objective advances at the pace of the slowest friendly inside
     *    14 m. You can sprint 200 m into their rear; the line does not come
     *    with you, and you arrive alone on an empty bar. Killing stays fast and
     *    fun and advances nothing. Measured, and nobody designed it: walking
     *    35 m forward drags the whole formation with you and costs 4 of 10
     *    men."
     *
     * `CommandDirector._frame` used to return the commander's LIVE POSITION as
     * the frame every slot is solved in, so a Jedi at a sprint handed twelve
     * men a destination they could not reach and they strung out behind it one
     * at a time. `_paceAnchor` is the same point with a speed limit on it.
     *
     * THE A/B IS INSIDE ONE CHECK because the alternative is a claim. Two fresh
     * worlds, the same seed, the same walk; one runs the shipped `advancePace`
     * and the other has it stubbed to `Infinity`, which IS the old behaviour
     * exactly — an unlimited chase is a chase that arrives every frame. So the
     * two arms differ by one number and nothing else.
     *
     * ── AND THEY DID NOT, WHICH COST THIS CHECK A GATE ──────────────────
     *
     * "The same seed" is a statement about `settings.seed`, and the muster is
     * not built out of it. `Command.js`'s `commandRng` deals every designation
     * and `Enemy.js`'s `enemyRng` deals the ±10% speed jitter every body is
     * built with, both at module scope, and `clocked` puts them back BETWEEN
     * checks — not between two boots inside one. So arm 1 got the seeded army
     * and arm 2 got whatever phase arm 1 left, and the arms differed by an
     * army as well as by the number under test:
     *
     *     arm 1   CT-1500 CT-2794 CT-5111 …   slowest 3.93 m/s
     *     arm 2   CT-7688 CT-4443 CT-1109 …   slowest 3.83 m/s
     *
     * That is not a small difference in a derived number. `strung` came out at
     * whatever the arm that booted FIRST read, and the second arm read about
     * 14 m whatever it was — measured on this tree, off identical code, the
     * only difference being which arm ran first:
     *
     *     paced first     paced 34.9 m   ·  unpaced 14.2 m   → the bound below FAILS
     *     unpaced first   unpaced 37.1 m ·  paced   14.1 m   → it passes
     *
     * The reading was a fact about the process, not about the pace anchor.
     *
     * `restoreShared` at the top of each arm is the fix, and it is the same
     * call `clocked` makes: both arms now muster the identical army and the
     * sentence above is true. Re-measured with it in, both orders, paced
     * against unpaced: 34.9 against 40.3 and 35.7 against 37.1 — the paced
     * line is the tighter one either way round.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { MORALE } = await import('../../src/game/Morale.js');

    const walk = async (unlimited) => {
      /* THE DEAL, NOT JUST THE SEED. See the note above: without this the two
       * arms are two different armies and the comparison is meaningless. */
      restoreShared(phase);
      const { world } = await bootWorld({
        level: 'geonosis',
        settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed: 7, difficulty: 'knight' },
      });
      try {
        const d = world.command;
        const p = world.player;
        /**
         * THE ARMY HAS TO BE ON THE GROUND. `bootWorld` builds the director and
         * the roster; `start` is what puts bodies under the names. Without it
         * `roster.living` carries records with no `body`, `advancePace` finds
         * nobody alive at all, and its own degenerate case — "no line exists,
         * so nothing paces the objective" — correctly returns Infinity. The
         * first version of this check missed that and read a lag of exactly
         * 0.0 m in BOTH arms, which reads like the rule being unwired and was
         * the harness measuring an army that had not landed.
         *
         * The spawn queue is then emptied: this measures the WALK, and a fight
         * would put reactions, cover and casualties between the rule and the
         * reading.
         */
        world.director.start(1);
        d.spawnQueue.length = 0;
        for (let i = 0; i < 60; i++) world.update(1 / 30, { act: () => false, actHit: () => false,
          actDown: () => false, moveAxis: (o) => (o ? (o.x = 0, o.y = 0, o) : { x: 0, y: 0 }),
          mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
          delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} });
        const standingAtStart = d.commander.roster.living.filter((t) => t.body && !t.body.dead).length;
        if (!(standingAtStart > 1)) throw new Error(`only ${standingAtStart} bodies stood up`);
        if (unlimited) d.advancePace = () => Infinity;
        const input = {
          keys: new Set(), buttons: [false, false, false],
          mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
          delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
          moveAxis: (o) => (o ? (o.x = 0, o.y = 1, o) : { x: 0, y: 1 }),
          act: () => false, actHit: () => false, actDown: () => false, end() {},
        };
        const from = p.position.clone();
        let worstLag = 0, frames = 0;
        for (let i = 0; i < 900; i++) {
          world.update(1 / 30, input);
          frames++;
          const a = d.commander._paceAnchor;
          if (a) worstLag = Math.max(worstLag, Math.hypot(p.position.x - a.x, p.position.z - a.z));
          if (p.position.distanceTo(from) >= 35) break;
        }
        /* HOW FAR THE LINE IS STRUNG OUT: the furthest living body from the
         * anchor its slots are solved against. That is the number §6's "costs
         * 4 of 10 men" is about — men alone in the open, one at a time. */
        let strung = 0, standing = 0;
        const a = d.commander._paceAnchor || p.position;
        for (const t of d.commander.roster.living) {
          const e = t.body;
          if (!e || e.dead) continue;
          standing++;
          strung = Math.max(strung, Math.hypot(e.position.x - a.x, e.position.z - a.z));
        }
        return {
          walked: +p.position.distanceTo(from).toFixed(1), frames,
          worstLag: +worstLag.toFixed(1), strung: +strung.toFixed(1), standing,
          pace: d.advancePace(d.commander),
        };
      } finally { world.unload?.(); }
    };

    const paced = await walk(false);
    const old = await walk(true);

    assert(paced.walked > 20, `the player only walked ${paced.walked} m, so nothing was measured`);
    assert(old.worstLag < 1.0,
      `with the pace unlimited the anchor still lagged ${old.worstLag} m — the control arm is not `
      + 'the old behaviour, so the comparison below is between two unknown things');
    assert(paced.worstLag > 1.5,
      `walking ${paced.walked} m, the formation's anchor never fell more than ${paced.worstLag} m `
      + 'behind the commander — the line is still being dragged at whatever pace the player chooses');
    /**
     * AND IT MUST NOT MAKE THE STRINGING-OUT WORSE, which is the weaker claim
     * and the honest one to bind. Measured on this seed: 36.8 m against 39.4 m,
     * a 7% difference, and a 7% difference between two 35 m walks is not a
     * number to hang a gate on. The rule's direct effect is the LAG asserted
     * above — 3.9 m against 0.0 — and how much of the formation's dispersal
     * that saves depends on the deploy pattern, the terrain and how far the men
     * started from their slots, none of which this rule touches. So the bound
     * here is one-sided: pacing the anchor may not cost the line its cohesion.
     */
    assert(paced.strung <= old.strung + 1,
      `the line ended ${paced.strung} m strung out with the rule and ${old.strung} m without it — `
      + 'pacing the anchor has made the formation MORE dispersed, which is the opposite of §6');
    /* AND THE RULE'S OWN TWO EDGES, asked of the function rather than the walk.
     * Re-seated for the same reason the two arms are: this is the third boot in
     * one body, and it reads the roster's own slowest speed. */
    restoreShared(phase);
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed: 7 },
    });
    try {
      const d = world.command;
      const p = world.player;
      world.director.start(1);
      d.spawnQueue.length = 0;
      const speeds = d.commander.roster.living.map((t) => t.body?.speed).filter((v) => v > 0);
      assert(speeds.length > 1, 'the roster stood up fewer than two bodies');
      const slowest = Math.min(...speeds);
      assert(Math.abs(d.advancePace(d.commander) - slowest) < 1e-6,
        `the line advances at ${d.advancePace(d.commander).toFixed(2)} m/s against its slowest man's `
        + `${slowest.toFixed(2)} — the pace is not the slowest friendly's`);
      p.position.x += MORALE.NEAR * 20;
      assert(d.advancePace(d.commander) === 0,
        `a commander who has outrun every man he has still advances the line at `
        + `${d.advancePace(d.commander).toFixed(2)} m/s — §6's "the line does not come with you"`);
      return `35 m walk: anchor lagged ${paced.worstLag} m and the line ended ${paced.strung} m `
        + `strung out, against ${old.worstLag} m / ${old.strung} m unpaced · pace is the slowest `
        + `man's ${slowest.toFixed(2)} m/s, and 0 once nobody is inside ${MORALE.NEAR} m`;
    } finally { world.unload?.(); }
  });

  check('suppression: at zero stamina there is no dash and no dive — the floor §6 nails your feet to', async () => {
    /**
     * THE SECOND HALF OF §6, and the reason the first half is worth anything:
     * "at zero stamina there is no dash (18), no dive (18), no sprint. The
     * crowd does not kill you; it nails your feet to the floor, and then the
     * four B2s at 5.85 dps each kill you."
     *
     * The three refusals are shipped and nothing here re-implements one:
     * `_tryDash` and `_tryDive` are called on a real Player at a real bar
     * level and asked what they did. The bound is the price the code charges
     * (`DIVE_STAMINA`, which is the dash's own constant re-exported), so a
     * tuning pass that moves it moves this check with it.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      const ctx = { input: idleInput(), dt: 1 / 60 };
      const refusals = [];
      p._refuse = (verb, why) => { refusals.push(`${verb}: ${why}`); return false; };

      p.stamina = p.maxStamina;
      p.dashTimer = 0; p.cooldowns.dash = 0;
      p._tryDash(ctx);
      assert(p.dashTimer > 0,
        'a full bar could not buy a dash, so the refusal below proves nothing about stamina');
      const spentOnOne = p.maxStamina - p.stamina;

      p.dashTimer = 0; p.cooldowns.dash = 0; p.diving = false;
      p.stamina = 0;
      refusals.length = 0;
      p._tryDash(ctx);
      assert(p.dashTimer === 0,
        `the dash fired on an empty bar (dashTimer ${p.dashTimer}) — a crowd that empties the guard `
        + 'has to take the movement with it or suppression buys nothing');
      assert(refusals.length > 0 && /stamina/i.test(refusals[0]),
        `the dash was refused with ${JSON.stringify(refusals)} — a bound key that does nothing and `
        + 'does not say why is the lie `_refuse` exists to stop');
      const said = refusals[0];

      p.diving = false; p.dashTimer = 0;
      refusals.length = 0;
      p._tryDive(ctx);
      assert(!p.diving,
        'the dive fired on an empty bar, and it costs the same 18 the dash does');

      /* …and the price is the one the constant names, so the bar level this
       * check calls "empty enough" is the game's and not this file's. */
      p.stamina = DIVE_STAMINA - 0.01;
      p.dashTimer = 0; p.cooldowns.dash = 0; p.diving = false;
      p._tryDash(ctx);
      assert(p.dashTimer === 0,
        `a bar one hundredth under DIVE_STAMINA (${DIVE_STAMINA}) still bought a dash`);
      return `dash costs ${DIVE_STAMINA}; full bar spends ${spentOnOne.toFixed(0)}; `
        + `empty bar → "${said}"; a hundredth under the price → refused too`;
    } finally { world.unload?.(); }
  });
}
