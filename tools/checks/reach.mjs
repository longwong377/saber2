/**
 * BATTLEFRONT BORZ — AN ORDER IS A THING YOU HAVE TO GET TO THEM.
 *
 * COMPANY.md's PHASE 2 opens with a measurement rather than a proposal:
 * "`order()` has no distance test and no rank test of any kind — verified. An
 * order reaches every man on the roll, anywhere, instantly." Every capability
 * this company has — a squad's own ground, a licence, a named leader, a
 * billet — was expensive against a command interface that always worked, and
 * a cost that is never paid is a cost nobody feels.
 *
 * SCOPE calls the reach the highest-leverage of its three capability
 * mechanisms and the argument is worth restating, because it is the reason
 * this file exists rather than another balance lane: A QUORUM DOES NOT TRAVEL
 * AND A DISTANCE DOES. Crewed objectives, fire missions and downed-not-dead
 * are all declared on The Line alone because each needs an advance quorum;
 * reach needs your body, and every mode has your body in it.
 *
 * WHAT IS ASSERTED HERE, and each is the shape of a specific way this feature
 * could be present in the source and absent from the game:
 *
 *   IT REFUSES.          A squad past `ORDER_REACH` does not take the order,
 *                        `order()` returns false, and NOTHING is written — no
 *                        formation, no plant, no cover epoch. A refusal that
 *                        still wrote the order would be the same lie the HUD
 *                        was already fixed for at a different range.
 *   IT LANDS.            The same order, same men, inside the reach. Without
 *                        this the check passes on an army that can never be
 *                        commanded at all.
 *   THE REASON IS NAMED. Every term in `REFUSALS` is produced by something,
 *                        and each is driven in isolation — reach, fear,
 *                        isolation and the licence — because "every refusal
 *                        needs a visible reason" (SCOPE.md:78-81) is a claim
 *                        about four different sentences.
 *   RELAYS CARRIES IT.   A Commander standing between you and them makes the
 *                        order land that would otherwise not. This is the top
 *                        rung's second consumer and the whole answer to "a
 *                        licence nothing reads".
 *   THE REFUSER SOLDIERS ON. He keeps the order he had. A refusal that froze a
 *                        man, or that silently gave him the order anyway,
 *                        are the two failures either side of the right one.
 *   THE RUNNER IS A MAN. Named, dispatched by the second press, arriving by
 *                        walking, and KILLABLE — with the order dying with
 *                        him. A message that cannot be intercepted is a
 *                        function call with a delay on it.
 *   THERE IS A WAY BACK. `circle` reaches everybody, always. Warning #1 names
 *                        Fall Back To Me as a required mitigation for
 *                        real-time permadeath, and a reach rule without one
 *                        is a way to lose a company to a walk.
 */

import * as Cmd from '../../src/game/Command.js';
import { army } from './_army.mjs';

/** Put a squad's bodies somewhere, and refresh the stamps that follow them. */
function put(d, men, x, z) {
  for (const t of men) if (t.body) t.body.position.set(x, 0, z);
  d._troops(1 / 30, {});
}

/** A fresh army with the general at the origin and everybody formed up on him. */
function field() {
  const A = army();
  A.squads = A.d.squadsOf(A.c);
  return A;
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  /* `army()` deploys through the stub's `spawnEnemy`, which draws on Enemy's
   * module stream, and `_morale` runs on every `_troops` step. */
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It refuses, and it lands                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.1 an order to men past the reach does not land, and writes nothing', () => {
    /**
     * THE WHOLE OF THE OLD BEHAVIOUR IN ONE ASSERTION. Before this, the two
     * arms below were the same arm: a squad at the origin and the same squad
     * 200 m away both took the order, on the same frame, with the same return
     * value. So the FAR arm is the feature and the NEAR arm is the control
     * that stops this passing on an army that cannot be commanded at all.
     *
     * AND NOTHING IS WRITTEN is the half that is easy to get wrong. A refusal
     * that returned false but still set `squadOrders` would leave the HUD
     * saying "2nd Squad — dig in" over a squad that never heard it, which is
     * exactly the defect the per-squad branch was already fixed for once.
     */
    const { d, c, squads } = field();
    const k = 1;
    const near = d.order('cover', c, k);
    assert(near === true, 'a squad standing on the general would not take an order');
    c.squadOrders?.clear(); c.squadPlanted?.clear();
    put(d, squads[k], 200, 200);
    const before = d._coverEpoch | 0;
    const far = d.order('charge', c, k);
    assert(far === false,
      `a squad ${Math.round(Math.hypot(200, 200))} m from the general took an order across a `
      + `reach of ${Cmd.ORDER_REACH} m — order() has no distance test`);
    assert(!c.squadOrders?.has(String(k)),
      'the order was refused and written anyway — the HUD would say they were doing it');
    assert(!c.squadPlanted?.has(String(k)), 'a refused order still gave the squad ground');
    assert((d._coverEpoch | 0) === before, 'a refused order still re-chose the army\'s cover');
    return `${Math.round(Math.hypot(200, 200))} m refused · 0 m taken · reach ${Cmd.ORDER_REACH} m`;
  });

  check('reach.2 the refusal names the term that failed, and every term is reachable', () => {
    /**
     * `SCOPE.md:78-81`: "Every refusal needs a visible reason." That is four
     * different sentences and this drives each one in isolation, because a
     * `REFUSALS` list with three unreachable entries in it is a list.
     *
     * ISOLATION IS THE POINT AND IT TOOK CARE TO GET. A lone man moved far
     * from his squad is *out of reach* before he is ever *alone*, and a
     * frightened squad standing on top of the general is neither. So each arm
     * below moves exactly one term and holds the other three satisfied.
     */
    const { d, c, squads } = field();
    const k = 1;
    const got = new Set();

    put(d, squads[k], 200, 200);
    for (const r of d._ask(Cmd.FORMATIONS.charge, c, squads[k], k).refused) got.add(r.why);

    /* FEAR, at the general's feet so distance and company are both satisfied.
     * `braveryOf` is `morale*0.72 + rank/4*0.28`, so a rank-0 man at zero
     * morale reads 0 — no new attribute, which is what COMPANY.md required. */
    put(d, squads[k], 2, 2);
    const was = squads[k].map((t) => t.morale);
    for (const t of squads[k]) t.morale = 0;
    for (const r of d._ask(Cmd.FORMATIONS.charge, c, squads[k], k).refused) got.add(r.why);
    /* …AND FEAR DOES NOT REFUSE COVER. A model in which a frightened man
     * ignores "get behind that rock" has never met a frightened man, and it
     * would read as the game breaking rather than as the men behaving. */
    const cover = d._ask(Cmd.FORMATIONS.cover, c, squads[k], k);
    assert(cover.refused.length === 0 && cover.took.length === squads[k].length,
      `${cover.refused.length} of ${squads[k].length} terrified men refused to TAKE COVER — `
      + 'fear is refusing the wrong half of the table');
    squads[k].forEach((t, i) => { t.morale = was[i]; });

    /* ALONE: one man, in reach of the general, with nobody of his own inside
     * `ALONE_NEAR`. The general is 28 m off — inside the reach, outside the
     * company — which is the only window where this term is the answer. */
    const lone = squads[k][0];
    put(d, squads[k], 300, 300);
    lone.body.position.set(40, 0, 40);
    c.player.position.set(60, 0, 60);
    for (const r of d._ask(Cmd.FORMATIONS.charge, c, [lone], k).refused) got.add(r.why);
    c.player.position.set(0, 0, 0);

    /* UNLED: a post given to a squad with nobody licensed to LEAD and no
     * general standing over it. See `_supervised`. */
    put(d, squads[k], 2, 2);
    c.player.position.set(200, 0, 200);
    lone.body.position.set(200, 0, 200);
    for (const t of squads[k]) t.body.position.set(202, 0, 202);
    c.player.position.set(200, 0, 200);
    d._troops(1 / 30, {});
    for (const t of squads[k]) t.xp = 0;
    c.player.position.set(200 + Cmd.RELAY_REACH + 6, 0, 200);
    for (const r of d._ask(Cmd.FORMATIONS.digin, c, squads[k], k).refused) got.add(r.why);

    for (const why of Cmd.REFUSALS) {
      assert(got.has(why),
        `nothing in the game produces the refusal "${why}" — REFUSALS lists ${Cmd.REFUSALS.length} `
        + `reasons and ${got.size} of them are reachable`);
    }
    return [...got].join(' · ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The licence, and the way a fresh company gets round it            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.3 a post needs a man who can be left, or you standing there', () => {
    /**
     * `RANKS[2].licence`: "May be given a squad's post — he leads it whatever
     * the roll would have said." A per-squad order that does not advance is
     * exactly a post: it writes `squadPlanted`, hands the squad its own frame
     * and lets the general walk away.
     *
     * THE MEASUREMENT THAT SHAPED THIS RULE: a muster deals TEN TROOPERS AT
     * RANK 0. So a licence-only test would make delegation — the thing the
     * player was told they had — unreachable until the first promotion. The
     * second door is supervision: a general inside `RELAY_REACH` of the
     * squad's own centre IS the supervision, so the fresh company's answer to
     * "they will not hold this alone" is to go and hold it with them.
     *
     * BOTH DOORS ARE ASSERTED, and so is the wall between them. A version with
     * no wall is the old always-works order with extra vocabulary.
     */
    const { d, c, squads } = field();
    const k = 1, men = squads[k];
    /* The squad on its own ground and the general well clear of it, but inside
     * `ORDER_REACH` so the reach term is satisfied and this is only about the
     * licence. */
    put(d, men, 26, 0);
    c.player.position.set(0, 0, 0);
    for (const t of men) t.xp = 0;
    assert(!d._supervised(c, men),
      `a squad of ${men.length} rank-0 troopers ${26} m from the general reads as supervised — `
      + 'a post can be given to anybody and the LEADS licence buys nothing');
    const no = d.order('digin', c, k);
    assert(no === false, 'an unled squad took a post');
    assert(/unled/.test(d.orderRefused || ''),
      `the refusal said "${d.orderRefused}" and the term that failed was the licence`);

    /* DOOR ONE — a man who can be left. */
    men[0].xp = Cmd.RANKS[2].xp;
    assert(Cmd.holds(men[0], 'LEADS'), 'a Sergeant does not hold LEADS — the ladder moved');
    assert(d._supervised(c, men), 'a squad with a Sergeant in it still cannot be given a post');
    assert(d.order('digin', c, k) === true, 'a squad with a Sergeant in it refused a post');
    men[0].xp = 0;
    c.squadOrders?.clear(); c.squadPlanted?.clear(); c.digs?.clear();
    for (const t of men) t.order = null;

    /* DOOR TWO — you, standing there. */
    assert(!d._supervised(c, men), 'the Sergeant was demoted and the squad is still supervised');
    c.player.position.set(26, 0, 0);
    assert(d._supervised(c, men),
      `the general standing on the squad is not supervision inside ${Cmd.RELAY_REACH} m`);
    assert(d.order('digin', c, k) === true, 'a squad the general is standing in refused a post');

    /* AND AN ADVANCE IS NOT A POST. `charge` from the same all-trooper squad,
     * with the general clear, has to be taken — or the licence has quietly
     * become a gate on every order there is. */
    c.player.position.set(0, 0, 0);
    c.squadOrders?.clear();
    for (const t of men) t.order = null;
    const adv = d._ask(Cmd.FORMATIONS.charge, c, men, k);
    assert(adv.took.length === men.length,
      `${adv.refused.length} men refused to CHARGE for "${adv.refused[0]?.why}" — the post `
      + 'licence is gating orders that are not posts');
    return `unled at ${26} m · LEADS opens it · standing inside ${Cmd.RELAY_REACH} m opens it`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  RELAYS, which is the top rung's second consumer                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.4 a Commander standing between you and them carries the order', () => {
    /**
     * `RANKS[4].licence` promises a Commander "steadies any of your men
     * standing near him, in his squad or not", and until this existed the
     * whole of it was `MORALE.RELAY_NEAR` — a presence term worth 0.035/s. A
     * licence whose only effect is a morale trickle is a line of text on a
     * dossier.
     *
     * THE ARM IS THE SAME ORDER TWICE with one man moved, so nothing else can
     * explain the difference: the squad sits at a distance no voice of yours
     * reaches, and a rank-4 man is placed once outside your reach (where he
     * cannot have heard it either) and once inside it.
     *
     * ONE HOP, ASSERTED. A relay is not itself a source for a further relay —
     * an order that hops indefinitely is an order with no reach, which is the
     * bug this file exists to close.
     */
    const { d, c, squads } = field();
    const k = 1, men = squads[k];
    /* Just past the general's own voice, and inside a relay's from the middle. */
    const far = Cmd.ORDER_REACH + 12;
    put(d, men, far, 0);
    const cold = d._ask(Cmd.FORMATIONS.charge, c, men, k);
    assert(cold.took.length === 0,
      `${cold.took.length} men heard an order from ${far} m with nobody relaying it`);

    /* THE RELAY, drawn from the OTHER squad so the men being reached are
     * untouched, and stood between the two. */
    const relay = squads[0][0];
    relay.xp = Cmd.RANKS[4].xp;
    assert(Cmd.holds(relay, 'RELAYS'), 'the top rung does not hold RELAYS');

    /* OUTSIDE YOUR REACH FIRST: a man who did not hear it cannot pass it on. */
    relay.body.position.set(Cmd.ORDER_REACH + 4, 0, 0);
    assert(d._voices(c).length === 1,
      'a Commander outside the general\'s own reach is being counted as a mouth — the order '
      + 'is hopping from a man who never heard it');
    const still = d._ask(Cmd.FORMATIONS.charge, c, men, k);
    assert(still.took.length === 0, 'an unreachable relay carried the order anyway');

    /* AND INSIDE IT. */
    relay.body.position.set(Cmd.ORDER_REACH - 2, 0, 0);
    assert(d._voices(c).length === 2, 'a Commander inside the reach is not a second mouth');
    const warm = d._ask(Cmd.FORMATIONS.charge, c, men, k);
    assert(warm.took.length === men.length,
      `${warm.took.length} of ${men.length} took it with a Commander ${Cmd.RELAY_REACH} m away — `
      + `${warm.refused[0]?.why}`);

    /* ONE HOP. A second Commander past the first cannot extend the chain. */
    const second = squads[0][1];
    second.xp = Cmd.RANKS[4].xp;
    second.body.position.set(Cmd.ORDER_REACH + Cmd.RELAY_REACH - 2, 0, 0);
    assert(d._voices(c).length === 2,
      'a Commander who is only inside ANOTHER relay\'s range became a mouth — the reach chains, '
      + 'and a chaining reach is no reach');
    return `${far} m: 0 took it · with a Commander at ${Cmd.ORDER_REACH - 2} m: ${warm.took.length} took it`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  What a man who did not hear it is doing                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.5 a man who did not hear it goes on doing what he was told last', () => {
    /**
     * THE TWO FAILURES EITHER SIDE OF THE RIGHT ONE. A refuser who is given
     * the order anyway is the old bug wearing a message; a refuser who is
     * given NOTHING falls through to the army's formation on the next frame,
     * which is the same thing again with an extra frame in it.
     *
     * `t.order` is the whole mechanism and `formationFor` reads it first. It
     * is set on the refusers and CLEARED on the takers, and the clearing is
     * the half that is easy to miss: without it a man who refused once carries
     * a private order for the rest of the run and can never be commanded
     * again.
     */
    const { d, c, squads } = field();
    const k = 1, men = squads[k];
    assert(d.order('line') === true, 'an army standing on its general would not form line');
    assert(men.every((t) => !t.order), 'a man who TOOK the order is carrying a private one');

    put(d, men, 200, 200);
    assert(d.order('charge') === true,
      'an army-wide order refused entirely because one squad walked off');
    assert(c.formation === 'charge', 'the army did not take the order the near half heard');
    for (const t of men) {
      assert(t.order === 'line',
        `a man 280 m away is under "${t.order}" — he should still be in the line he was put in`);
      assert(d.formationFor(c, k, t) === 'line',
        'formationFor hands a refuser the order he refused');
    }
    assert(d.formationFor(c, k) === 'charge', 'the squad itself is not under the army\'s order');

    /* AND HE IS BACK IN STEP THE MOMENT HE HEARS ONE. */
    put(d, men, 2, 2);
    assert(d.order('front') === true, 'the whole army refused an order given at its feet');
    for (const t of men) {
      assert(!t.order,
        `${t.name} is still carrying "${t.order}" after taking a new order — a refusal is `
        + 'permanent and a man who refuses once can never be commanded again');
    }
    return 'refused → keeps `line` while the army charges · reached → back in step';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The runner                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.6 the second press sends a named man, and he can be killed carrying it', () => {
    /**
     * "Press the same order again inside a short window and a named man leaves
     * the line to CARRY it. He can be killed on the way, and then the order
     * dies with him and the log says so."
     *
     * THE THIRD SENTENCE IS THE MECHANIC. A reach rule with no remedy tells
     * the player their button is broken; a remedy that always works is the
     * bug. A runner is neither: it works, it takes time, and some of the time
     * it fails as a NAME, which is this mode's entire subject.
     *
     * FOUR THINGS ARE DRIVEN: the window arms only on a distance refusal, the
     * second press produces a man with a destination, arriving delivers the
     * order FROM WHERE HE IS STANDING, and killing him kills it. The third is
     * the one a lesser implementation gets wrong — a delivery that writes the
     * order directly would be a second door into the method this whole phase
     * exists to put one door on.
     */
    const { w, d, c, squads } = field();
    const k = 1, men = squads[k];
    put(d, men, 120, 120);
    assert(d.order('charge', c, k) === false, 'a squad 170 m out took an order');
    assert(d._pending && d._pending.id === 'charge' && d._pending.squad === k,
      'a distance refusal did not arm the runner window');

    w.time += 1;
    assert(d.order('charge', c, k) === true,
      'the second press inside the window did not answer for the dispatch');
    const runner = d.led(c).find((t) => t.runner);
    assert(runner, 'nobody was sent with it');
    assert(runner.name, 'the runner has no name — this mechanic is a name or it is a timer');
    assert(!men.includes(runner),
      'the runner was drawn from the squad that cannot hear the general');
    assert(d.leaderOf(d.squadOf(runner, c)) !== runner,
      'a squad leader was sent as a messenger — his squad is what he is for');
    /**
     * …AND THAT IS A RULE AND NOT AN ACCIDENT OF THE SORT. The pool is
     * ordered by rank ascending and a leader is usually the senior man in it,
     * so on an ordinary company he comes last anyway and removing the guard
     * changes nothing visible. The rule only bites when he is the ONLY man
     * who heard it — so that is the arm: everybody else moved out of reach,
     * one squad leader left standing beside the general, and NOBODY GOES.
     * A company with nothing but leaders left keeps them.
     */
    const lead = d.leaderOf(squads[0]);
    const parked = [];
    for (const t of d.led(c)) {
      if (t === lead || !t.body) continue;
      parked.push([t, t.body.position.clone()]);
      t.body.position.set(500, 0, 500);
    }
    lead.body.position.set(1, 0, 1);
    assert(d._sendRunner('charge', k, c) === false,
      `${lead.name} leads ${d.squadLabel(0, c)} and was sent away with a message because he `
      + 'was the only man in earshot — a squad leader is never the messenger');
    for (const [t, at] of parked) t.body.position.copy(at);
    d._troops(1 / 30, {});
    assert(Math.hypot(runner.runner.to.x - 120, runner.runner.to.z - 120) < 1,
      'the runner was sent somewhere other than the men who did not hear it');
    /* HE IS OUT OF THE FORMATION WHILE HE CARRIES IT, which is the whole of
     * what a runner is on the field. */
    const slot = d.slotFor(runner.body);
    assert(Math.hypot(slot.x - 120, slot.z - 120) < 1,
      'a man carrying an order is still solving his slot in the formation — he will never '
      + 'leave the line and the mechanic is a log line');

    /* KILLED. */
    const dead = d.log.length;
    runner.body.dead = true;
    d.onDeath(runner.body, null);
    const lost = d.log.slice(dead).find((r) => r.t === 'lostorder');
    assert(lost && lost.why === 'killed' && lost.name === runner.name,
      'the runner was killed and the log does not say the order died with him');
    assert(!runner.runner, 'a dead man is still carrying an order');
    assert(!c.squadOrders?.has(String(k)),
      'the order the dead runner was carrying landed anyway');

    /* AND ONE WHO GETS THERE DELIVERS. A second dispatch, walked to the mark. */
    d._pending = null;
    put(d, men, 120, 120);
    d.order('charge', c, k);
    w.time += 1;
    d.order('charge', c, k);
    const two = d.led(c).find((t) => t.runner);
    assert(two, 'no second runner was sent');
    two.body.position.set(two.runner.to.x, 0, two.runner.to.z);
    d._runnerTick(two, 1 / 30);
    assert(!two.runner, 'a runner standing on the mark is still running');
    const done = d.log.filter((r) => r.t === 'delivered').pop();
    assert(done && done.ok === true,
      `the runner arrived and the order did not land — ${JSON.stringify(done)}`);
    assert(c.squadOrders?.get(String(k)) === 'charge',
      'the delivery did not write the order it carried');
    return `${runner.name} killed carrying it · ${two.name} delivered it`;
  });

  check('reach.7 the runner delivers from where he is standing, not from the general', () => {
    /**
     * THE HONEST VERSION, and the difference is observable: a delivery that
     * reached from the GENERAL would land on men the general can reach, which
     * is the set that did not need a runner. `_carrying` makes his own body
     * the mouth for the one `order()` call he makes, so a man who has walked
     * further off in the meantime still does not hear it.
     *
     * Driven by putting HALF the deaf squad past the runner's own relay range
     * at the moment he arrives: the near half take it and the far half are
     * still out of reach, which cannot happen if the mouth is at the origin
     * and cannot happen if the mouth is everywhere.
     */
    const { w, d, c, squads } = field();
    const k = 1, men = squads[k];
    put(d, men, 120, 0);
    d.order('charge', c, k);
    w.time += 1;
    d.order('charge', c, k);
    const run = d.led(c).find((t) => t.runner);
    assert(run, 'no runner was sent');
    /* He arrives at the mark; one man has since walked well past it. */
    run.body.position.set(120, 0, 0);
    const strays = men.slice(0, 2);
    for (const t of strays) t.body.position.set(320, 0, 0);
    d._runnerTick(run, 1 / 30);
    assert(c.squadOrders?.get(String(k)) === 'charge',
      'the delivery reached nobody at all — the runner\'s own body is not the mouth');
    for (const t of strays) {
      assert(t.order && t.order !== 'charge',
        `${t.name} walked 200 m past the delivery point and heard it anyway — the order is `
        + 'being delivered from somewhere other than the runner');
    }
    const near = men.filter((t) => !strays.includes(t));
    for (const t of near) {
      assert(!t.order, `${t.name} was standing on the runner and did not hear him`);
    }
    return `${near.length} at the mark took it · ${strays.length} who had walked on did not`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The way back                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.8 there is one order that always reaches, and it is the one that is you', () => {
    /**
     * COMPANY.md's Warning #1 names four mitigations real-time permadeath
     * needs and says three exist and this one does not: Fall Back To Me, "one
     * order, and it belongs here, where the rally point is your body".
     *
     * It is not a new verb. CIRCLE already means *form on me* — every slot in
     * it is an offset from the general's own frame — so the order whose
     * destination IS the man giving it is the one that cannot be out of
     * earshot of him. A reach rule with no way back is a way to lose a company
     * to a walk.
     *
     * AND IT IS EXACTLY ONE. If a second formation carried `always` the rule
     * would have a hole in it, so the count is asserted rather than the flag.
     */
    const { d, c, squads } = field();
    const always = Object.values(Cmd.FORMATIONS).filter((F) => F.always);
    assert(always.length === 1,
      `${always.length} formations ignore the reach (${always.map((F) => F.id).join(', ')}) — `
      + 'the way back is one order, or the rule has a hole in it');
    assert(always[0].id === 'circle',
      `the order that always reaches is \`${always[0].id}\` and the rally point has to be your body`);

    for (const sq of squads) put(d, sq, 400, 400);
    assert(d.order('charge') === false, 'a company 560 m out took an ordinary order');
    assert(d.order('circle') === true,
      'a company 560 m out could not be called back — permadeath with no way to recall the '
      + 'men you can see is a walk that costs a run');
    assert(c.formation === 'circle', 'the recall returned true and wrote nothing');

    /* AND IT SKIPS THE REACH AND ONLY THE REACH. A man who will not advance
     * into fire will not sprint across it to you either, and if `always` meant
     * "skip every refusal" this would be the one button that makes the other
     * three ignorable. */
    for (const sq of squads) put(d, sq, 2, 2);
    const was = [];
    for (const sq of squads) for (const t of sq) { was.push([t, t.morale]); t.morale = 0; }
    const ask = d._ask(Cmd.FORMATIONS.circle, c, d.led(c), null);
    assert(ask.refused.some((r) => r.why === 'shaken'),
      'a terrified company took the recall — `always` is skipping every refusal, not the reach');
    for (const [t, m] of was) t.morale = m;
    return `circle only · 560 m recall taken · ${ask.refused.length} shaken men still refuse it`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  And the player can see it before they press anything              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('reach.9 the roster panel says which squad cannot hear you', async () => {
    /**
     * A RULE A PLAYER CAN ONLY DISCOVER BY HAVING AN ORDER FAIL IS A RULE THAT
     * READS AS THE GAME BEING BROKEN. The toast after the press is the
     * confirmation; this is the thing that has to be on the screen BEFORE it,
     * and the roster panel is the only in-game view of a squad there is.
     *
     * TWO HALVES AND BOTH ARE DRIVEN, because either alone is a feature that
     * exists in one file: the director has to stamp `heard` on the summary it
     * hands out (`CommandRoster.summary()` knows nothing about a world and
     * must not), and `rosterHtml` has to print it.
     *
     * THE STRADDLING CASE IS THE ONE THAT MATTERS. A squad wholly out of
     * earshot is easy; "3 of 5 in earshot" is the sentence that makes a player
     * walk twenty metres, so it is asserted separately from the all-or-nothing
     * one.
     */
    const { rosterHtml } = await import('../../src/ui/HUD.js');
    const { d, c, squads } = field();
    const k = 1, men = squads[k];

    let seen = null;
    d.onRoster = (r) => { seen = r; };
    put(d, men, 200, 200);
    d._announceRoster();
    assert(seen, 'the director never announced a roster');
    const rows = new Map(seen.roll.map((r) => [r.id, r]));
    for (const t of men) {
      assert(rows.get(t.id)?.heard === false,
        `${t.name} is 283 m out and the roster row does not say he cannot hear you — the panel `
        + 'has no way to show the reach and the player finds out by pressing a key');
    }
    for (const t of squads[0]) {
      assert(rows.get(t.id)?.heard === true, `${t.name} is standing on the general and reads as deaf`);
    }

    const all = rosterHtml(seen, d.squadNames, 'Squad');
    assert(/out of reach/.test(all),
      'a squad nobody in it can hear you does not say so on the panel');

    /* THE STRADDLE. Two of the five walk back into earshot. */
    men[0].body.position.set(2, 0, 2);
    men[1].body.position.set(2, 0, 2);
    d._troops(1 / 30, {});
    d._announceRoster();
    const some = rosterHtml(seen, d.squadNames, 'Squad');
    assert(/2\/5 in earshot/.test(some),
      'a squad with two men in earshot and three out of it does not say so — the panel is '
      + 'all-or-nothing about a rule that is per man');

    /* AND A BUILD THAT DOES NOT CARRY THE FIELD SAYS NOTHING, rather than
     * claiming everybody is deaf: a summary off the wire (`applyNet`) has no
     * `heard` on any row. */
    const bare = { ...seen, roll: seen.roll.map(({ heard, ...r }) => r) };
    const quiet = rosterHtml(bare, d.squadNames, 'Squad');
    assert(!/out of reach|in earshot/.test(quiet),
      'a roster with no reach information printed a reach readout anyway');
    return 'per-man `heard` on the summary · "out of reach" · "2/5 in earshot" · silent without it';
  });
}
