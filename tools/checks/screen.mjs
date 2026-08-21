/**
 * BATTLEFRONT BORZ — THE SCREEN: the bolt aimed at the man beside you.
 *
 * FLAGSHIP §6 prices the deflection ladder and §7 claims a Jedi in a line is
 * "the reason the line is still standing". `NEXT.md` measured the second claim
 * and it was false: five seeds, four arms, the outcome IDENTICAL in all of them
 * — same three waves, same area, the same 37 enemies dead — while a Jedi in the
 * formation made the fight half again as long and got seven of your men killed,
 * and a Jedi holding station a hundred metres off cost the line exactly the
 * same 6.33. Presence bought nothing a number could see.
 *
 * ── THE CENSUS THAT SAYS WHY, AND IT IS THE POINT OF THIS FILE ──────────
 *
 * One Command battle on Geonosis, seed 3, 150 game-seconds, every hit on a body
 * of the player's own side counted at `World._boltHitTest` with the owner's
 * team read off the bolt:
 *
 *     47 hits · 569.8 damage · every one of them fired by the player's OWN team
 *     0 hostile bolts reached a trooper at all
 *
 * The men are killed by their own line. A Jedi standing in a rank is what
 * brings the horde in among it, and a rank firing into a melee fires through
 * its own men — which is also why the arm with no player in it loses nobody.
 *
 * So the mechanic is: a bolt on its way into one of your own men, crossing
 * ground you are standing on, inside the arc a guard covers, is a bolt you can
 * take. Four gates and it must pass all four, the fourth being the bar. The
 * whole argument, and where every number comes from, is over `SCREEN` in
 * src/game/Combat.js.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHAT IT ONLY REPORTS ────────────────────
 *
 * The same discipline `suppression.mjs` sets out. Nothing here restates a
 * constant from the source: the price is measured by billing two identical
 * bolts for men at two different distances and comparing the RATIO to the ratio
 * of the distances; the reach is checked against the slots the shipped
 * `FORMATIONS` table actually puts men in; and "it saves men" is a rank under
 * fire with the bar full against the same rank with the bar empty. An
 * instrument that restated the rule would agree with it by construction and
 * would manufacture a defect the day either moved (HANDOFF §2.4).
 *
 * Every driven case goes through `tools/_screen.mjs`, so the gate measures the
 * thing the probe measures rather than a second copy of it.
 */

import { GUARD_COST, SCREEN, guardCost, screenForce, screenReach, GRADE } from '../../src/game/Combat.js';
import { FORMATIONS } from '../../src/game/Command.js';
import { MORALE } from '../../src/game/Morale.js';
import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  One rule, read both ways                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('screen: the reach a player is granted and the price they are charged are one rule', () => {
    /**
     * `screenReach` is `screenForce` solved the other way, and the whole point
     * of writing it as one is that a screen wider than the bar can pay for
     * would refuse bolts at the moment of BILLING instead — a rule that fires
     * in one place and is enforced in another.
     *
     * So the test is the round trip, over the range of a real bar, and NOT the
     * formula: what a player is allowed to cover must be exactly what they can
     * afford, at every level of the pool.
     */
    const worst = [];
    for (let f = 0; f <= 120; f += 0.5) {
      const r = screenReach(f);
      const cost = screenForce(r);
      if (cost > f + 1e-9) worst.push(`${f} Force bought ${r.toFixed(2)} m and is billed ${cost.toFixed(2)}`);
      /* …and it must not be miserly either, or the mechanic would quietly
       * shrink the reach a player has paid for. Below the cap the two are
       * exact; at and above it the cap is what is binding, not the bar. */
      if (r < SCREEN.reach - 1e-9 && Math.abs(cost - f) > 1e-6) {
        worst.push(`${f} Force bought ${r.toFixed(3)} m priced at ${cost.toFixed(3)} — below the cap they must be equal`);
      }
    }
    assert(worst.length === 0, `the reach and the price disagree: ${worst.slice(0, 3).join(' · ')}`);
    assert(screenReach(0) === 0, 'an empty bar still covers ground');
    assert(screenReach(1e9) === SCREEN.reach,
      `a full bar reaches ${screenReach(1e9)} rather than stopping at the cap`);
    assert(screenForce(SCREEN.reach) > 0, 'covering the far edge of the reach is free');
    return `${SCREEN.reach} m cap · ${screenForce(SCREEN.reach).toFixed(1)} Force at the rim · `
      + `${screenForce(2.4).toFixed(2)} at a man's shoulder`;
  });

  check('screen: a screened bolt spends the Force and NOT the stamina, at every rung', () => {
    /* One event, one currency, and it is the same sentence `GUARD_COST`'s
     * `unanswered` row already makes: your blade never met this bolt, the
     * Force did. Charging the stamina rung as well would bill one event twice
     * and would make the reach scale with the bar that is not moving. */
    const rungs = [];
    for (let g = 0; g < GUARD_COST.stamina.length; g++) {
      const c = guardCost(g, { screen: 4 });
      assert(c.stamina === 0,
        `a screened bolt graded ${g} cost ${c.stamina} stamina — a bolt taken off a man beside you `
        + 'is paid for in one bar, not two');
      assert(c.force > 0, `a screened bolt graded ${g} cost no Force at all`);
      rungs.push(c.force.toFixed(2));
    }
    /* Every rung the same, because the price is a DISTANCE and not a grade:
     * how well you met a bolt that was never coming at you is not a question
     * with an answer. */
    assert(new Set(rungs).size === 1,
      `the screen charges different Force by grade (${rungs.join('/')}) — the price is the reach, `
      + 'not the rung');
    /* …and a contact that is NOT a screen must be untouched, or the new clause
     * has eaten the ladder the rest of §6 is built on. */
    const plain = guardCost(GRADE.BLOCK, { screen: 0 });
    assert(plain.stamina === GUARD_COST.stamina[GRADE.BLOCK] && plain.force === 0,
      `an ordinary BLOCK now costs ${plain.stamina} stamina and ${plain.force} Force — the screen `
      + 'clause has swallowed the ordinary ladder');
    return `screen → ${rungs[0]} Force / 0 stamina at every rung · ordinary BLOCK unchanged at `
      + `${plain.stamina} stamina`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The reach is the radius the game already owns                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('screen: the reach takes in the men the shipped formations actually put beside you', () => {
    /**
     * `SCREEN.reach` is `MORALE.NEAR` — the radius the game already owns for
     * "this Jedi is with these men" — rather than a second number of its own,
     * and this is the sentence that has to hold for that to be the right
     * choice: if a man is near enough for your presence to steady him, he is
     * near enough for you to take a bolt for him.
     *
     * MEASURED OFF THE TABLE, not restated. Every shipped formation is asked
     * where it would stand a squad of ten around its commander, and the
     * NEAREST man of each has to be inside the reach. A formation that put its
     * closest body outside it would be one the mechanic silently did not work
     * in, which is exactly the kind of thing nobody would notice.
     */
    const out = [];
    for (const [id, F] of Object.entries(FORMATIONS)) {
      let near = Infinity, far = 0, n = 0;
      for (let i = 0; i < 10; i++) {
        const v = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
        const slot = F.slot(i, 10, Math.floor(i / 5), v);
        if (!slot) continue;                       // `charge` has no slot at all
        const d = Math.hypot(slot.x, slot.z);
        near = Math.min(near, d); far = Math.max(far, d); n++;
      }
      if (!n) continue;
      out.push(`${id} ${near.toFixed(1)}–${far.toFixed(1)}`);
      assert(near <= SCREEN.reach,
        `${id} stands its closest man at ${near.toFixed(1)} m against a ${SCREEN.reach} m reach — `
        + 'the screen cannot reach anybody in that formation at all');
    }
    assert(out.length >= 4, `only ${out.length} formations offered a slot — the table is not being read`);
    assert(SCREEN.reach === MORALE.NEAR,
      `the screen reaches ${SCREEN.reach} m and presence reaches ${MORALE.NEAR} — two numbers for `
      + 'one fact is the twin this tree keeps deleting');
    return out.join(' · ') + ` · reach ${SCREEN.reach}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  …and the shipped path does it                                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('screen: the bolt that was going to hit the man beside you does not', async () => {
    const { oneScreen } = await import('../_screen.mjs');
    /* HOSTILE AND STRAY, because the census says the second is the one that
     * matters and the first is the one the design was written about. Both go
     * through the same four gates and the same bill. */
    const hostile = await oneScreen({ boltTeam: 2 });
    assert(hostile.screened === 1,
      `a hostile bolt on a path into the man at ${hostile.miss.toFixed(1)} m was not screened `
      + `(arrived ${hostile.arrived}, he lost ${hostile.mateHpLost} hp)`);
    assert(!hostile.arrived && hostile.mateHpLost === 0,
      `the bolt was counted as screened and the man still lost ${hostile.mateHpLost} hp`);
    assert(hostile.forceSpent > 0, 'screening it was free');
    assert(hostile.staminaSpent === 0,
      `screening it also cost ${hostile.staminaSpent} stamina — one event, one bar`);
    const stray = await oneScreen({ boltTeam: 0 });
    assert(stray.screened === 1 && !stray.arrived && stray.mateHpLost === 0,
      `a STRAY off your own line reached the man (screened ${stray.screened}, `
      + `${stray.mateHpLost} hp) — and that is the only fire the census found killing anybody`);
    return `hostile ${hostile.forceSpent} Force · stray ${stray.forceSpent} Force · neither man hurt`;
  });

  check('screen: it is a screen and not an aura — a bolt that would have missed is not answered', async () => {
    const { oneScreen } = await import('../_screen.mjs');
    /**
     * The same man, the same ground, the same guard: only the bolt's aim
     * moves, and it moves by two metres — well inside the reach, so gates one
     * and two still pass and only the third can refuse it.
     *
     * THIS IS THE CHECK THE FIRST CUT OF THE MECHANIC WOULD HAVE FAILED. Gate
     * three was the body's bound sphere, which wraps every capsule a body
     * presents and so stands about a metre off the chest: measured on a real
     * Command battle, 128 bolts screened for 8 fewer arriving in the rank —
     * sixteen near misses answered for every shot that was going to land.
     */
    const miss = await oneScreen({ aimAt: [2.2, 0, 0] });
    assert(miss.screened === 0,
      `a bolt aimed two metres wide of the man was screened anyway — the mechanic is answering fire `
      + 'that was never going to cost anybody anything, which is the aura it must not be');
    assert(miss.forceSpent === 0, `and it charged ${miss.forceSpent} Force for the privilege`);
    /* …and behind you is behind you. `GUARD.reach` is the shoulder line: you
     * cannot bring a guard behind you and you cannot screen behind you. */
    const behind = await oneScreen({ mateAt: [1.5, 0, -3], range: -14 });
    assert(behind.screened === 0,
      'a bolt arriving from behind the Jedi, into a man standing behind him, was screened — '
      + 'the arc gate is not holding and the reach is a sphere with nothing cut out of it');
    return `two metres wide → not answered · behind the shoulder line → not answered`;
  });

  check('screen: an empty bar covers nothing, and a part-full one covers only what it can pay for', async () => {
    const { oneScreen } = await import('../_screen.mjs');
    /**
     * The cost has to be something a player can RUN OUT OF, and the reach is
     * the bar: `screenReach` is the price solved the other way, so the screen
     * collapses toward the Jedi as the Force drains and comes back as it
     * refills. Nothing new on the HUD — the bar that was already there is the
     * readout — and this is the check that says the collapse is real.
     *
     * The two men are chosen off the FORMATIONS reading above rather than
     * invented: one at a `line` formation's own shoulder spacing, one out near
     * the rim of the reach.
     */
    const empty = await oneScreen({ force: 0 });
    assert(empty.screened === 0 && empty.arrived,
      `a Jedi with an empty Force bar still screened ${empty.screened} bolts — the price is not a `
      + 'price if it can be paid with nothing');
    assert(empty.mateHpLost > 0, 'the man was not hit even with the screen off — the harness is not landing shots');

    /* Enough Force to cover the shoulder and not the rim. Taken THROUGH the
     * shipped rule rather than typed, so this stays a test of behaviour: the
     * budget is what covers a man at 4 m and nothing further. */
    const budget = screenForce(4.5);
    const near = await oneScreen({ mateAt: [2.4, 0, 1.6], force: budget });
    const far = await oneScreen({ mateAt: [0, 0, 12], force: budget });
    assert(near.screened === 1,
      `${budget.toFixed(1)} Force did not cover the man at the shoulder — the reach has collapsed `
      + 'further than the bar says it should');
    assert(far.screened === 0 && far.arrived,
      `${budget.toFixed(1)} Force covered a man twelve metres out, which it cannot afford — the `
      + 'reach is not being cut to the bar');
    return `0 Force → nothing · ${budget.toFixed(1)} Force → the shoulder yes, twelve metres no`;
  });

  check('screen: the price is by the METRE, measured through the shipped bill', async () => {
    const { oneScreen } = await import('../_screen.mjs');
    /**
     * The economy the whole mechanic rests on: the man at your shoulder is
     * nearly free and the man at the rim costs, so standing WITH your line is
     * cheaper than gesturing at it from the flank — which is precisely the
     * behaviour the `far` arm of the Dead Jedi test proved the game did not
     * previously reward.
     *
     * Measured as a RATIO between two real bills rather than against the
     * constant, so this fails if the shape is wrong and not if somebody retunes
     * the rate.
     *
     * IT ALSO CATCHES THE BUG THE FIRST CUT SHIPPED WITH. The price used to be
     * taken at the point where the bolt CROSSED the reach — and a bolt arrives
     * from outside, so it crosses at the rim: every screened bolt billed the
     * maximum, whoever it was for and wherever he stood. The ratio below was
     * 1.00 and it should be four.
     */
    const a = await oneScreen({ mateAt: [2.4, 0, 1.6] });
    const b = await oneScreen({ mateAt: [0, 0, 12] });
    assert(a.screened === 1 && b.screened === 1, 'one of the two bolts was not screened at all');
    const bill = b.forceSpent / a.forceSpent;
    const dist = 12 / Math.hypot(2.4, 1.6);
    assert(bill > 1.5,
      `the man at twelve metres cost ${bill.toFixed(2)}x the man at the shoulder — the price is flat, `
      + 'so reaching further is free and there is no reason to stand in the line');
    assert(Math.abs(bill - dist) < 0.35 * dist,
      `the bill rose ${bill.toFixed(2)}x while the distance rose ${dist.toFixed(2)}x — the price is `
      + 'not proportional to the reach it is buying');
    return `${a.forceSpent} Force at ${Math.hypot(2.4, 1.6).toFixed(1)} m · ${b.forceSpent} at 12 m · `
      + `${bill.toFixed(2)}x the bill for ${dist.toFixed(2)}x the reach`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  …and it keeps men on their feet                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('screen: a rank under aimed fire loses fewer men with a Jedi who can pay for them', async () => {
    const { screenLine } = await import('../_screen.mjs');
    /**
     * THE ONE THAT MATTERS, and the arms are one variable apart: the same
     * Jedi, the same guard, the same men, the same scripted stream of bolts —
     * and a Force bar that is full in one and empty in the other. That is the
     * mechanic's own off switch rather than a test hook in shipped code,
     * because the reach IS the bar, and nothing in this harness spends Force on
     * anything else.
     *
     * The fire is scripted, one stream per man aimed at his chest, because a
     * real firing line cannot ask this question: every rifle on the field picks
     * the Jedi, and a first cut of the harness measured **0 bolts into the men
     * in both arms** — which reads exactly like a screen that works perfectly
     * and is a harness that cannot land a shot.
     *
     * The bound is on the SHARE that arrives rather than on a body count: the
     * harness stops firing at a man who is down, so the two arms do not aim the
     * same number of bolts and a raw count would flatter whichever arm killed
     * its men fastest.
     */
    const on = await screenLine({ mates: 4, seconds: 12, damage: 7, force: null });
    const off = await screenLine({ mates: 4, seconds: 12, damage: 7, force: 0 });
    assert(off.boltsIntoMates > 0, 'no bolt reached a man even with the screen off — nothing below is measurable');
    assert(on.screened > 0, 'the Jedi screened nothing at all with a full bar');
    assert(off.screened === 0, `the arm with an empty bar screened ${off.screened} bolts`);
    const shareOn = on.boltsIntoMates / Math.max(1, on.aimedAtMen);
    const shareOff = off.boltsIntoMates / Math.max(1, off.aimedAtMen);
    assert(shareOn < shareOff * 0.75,
      `${(100 * shareOn).toFixed(0)}% of aimed bolts reached the rank with a full bar against `
      + `${(100 * shareOff).toFixed(0)}% with an empty one — the screen is not keeping fire off them`);
    assert(on.mateStanding >= off.mateStanding,
      `${on.mateStanding} men standing with the screen against ${off.mateStanding} without it`);
    /* AND THE BAR IS WHAT ENDS IT. A screen that never ran out would be the
     * flat aura this must not be; the full-bar arm has to finish with the pool
     * visibly down, or the price is not binding at this volume of fire and the
     * comparison above is measuring a free mechanic. */
    assert(on.guardForceSpent > 0, 'the screen cost nothing over twelve seconds of aimed fire');
    return `${(100 * shareOn).toFixed(0)}% arrived with a bar against ${(100 * shareOff).toFixed(0)}% `
      + `without · ${on.screened} screened for ${on.guardForceSpent} Force · `
      + `${on.mateStanding} of ${on.mates} standing against ${off.mateStanding}`;
  });
}
