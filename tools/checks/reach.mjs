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
    assert(c._pending && c._pending.id === 'charge' && c._pending.squad === k,
      'a distance refusal did not arm the runner window');
    /* THE WINDOW IS THE COMMANDER'S. A director holds every commander in the
     * session, so a window on `this` would let one player's refused order arm
     * another player's next press — and would leave a joining player, whose
     * line is by definition wherever the host's is not, with no way to send a
     * runner at all. */
    assert(d._pending === undefined,
      'the runner window is on the director and is therefore shared between every commander '
      + 'in the session');

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
    c._pending = null;
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

    /**
     * AND A SHAKEN COMPANY TAKES IT, which is the clause this check had
     * BACKWARDS and an adversarial pass turned round.
     *
     * It first asserted that fear still refuses the recall, on the reasoning
     * that a man too frightened to advance is too frightened to sprint to you.
     * The hole is that the company which would refuse it is a SHAKEN company,
     * and a shaken company is the only kind anybody ever presses this for — so
     * the mitigation was absent in the one circumstance it exists for. What a
     * frightened man actually does is run to his officer.
     *
     * BOTH ARMS, because "it lands on everybody" is only worth something
     * beside "everything else does not": the same men, the same frame, one
     * order each.
     */
    for (const sq of squads) put(d, sq, 2, 2);
    const was = [];
    for (const sq of squads) for (const t of sq) { was.push([t, t.morale]); t.morale = 0; }
    const other = d._ask(Cmd.FORMATIONS.charge, c, d.led(c), null);
    assert(other.took.length === 0 && other.refused.every((r) => r.why === 'shaken'),
      `a company at zero morale took CHARGE (${other.took.length} of ${other.took.length
        + other.refused.length}) — the control arm is not shaken and this proves nothing`);
    const ask = d._ask(Cmd.FORMATIONS.circle, c, d.led(c), null);
    assert(ask.refused.length === 0,
      `${ask.refused.length} of a terrified company refused the RECALL (${ask.refused[0]?.why}) — `
      + 'a permadeath mitigation that a shaken company can refuse is absent in the only '
      + 'circumstance anybody presses it for');
    for (const [t, m] of was) t.morale = m;
    return `circle only · 560 m recall taken · a company at zero morale refuses CHARGE `
      + `${other.refused.length}/${other.refused.length} and takes the recall ${ask.took.length}/${ask.took.length}`;
  });

  check('reach.10 an army standing in its own correct slots is always in earshot', async () => {
    /**
     * ══ THE NUMBER, AND THE ONE PROPERTY IT HAS TO HAVE ═══════════════════
     *
     * A reach that is shorter than the shape the army was TOLD to form is a
     * rule that fires on a company doing exactly what it was ordered to do:
     * form line abreast, then discover you cannot re-order the ends of it.
     * That is not a cost, it is a bug that looks like a cost, and it would be
     * introduced by a tuning change to either side — a wider formation or a
     * shorter reach — with nothing in the tree noticing.
     *
     * SO IT IS MEASURED OFF THE FORMATIONS THEMSELVES, at the largest company
     * the game can field (`MAX_STRENGTH`), across every squad index, rather
     * than asserted as a literal. MEASURED at the time of writing, the widest
     * slot each formation puts a man in:
     *
     *     rank 28.9 · line 27.7 · behind 27.4 · holdfire 21.3 · front 20.4
     *     cover 13.6 · circle 5.8 · digin 4.6 · charge 0.0
     *
     * against a reach of 34. `rank` is the binding one with 5.1 m to spare.
     *
     * COVER IS THE EXCEPTION AND IS CHECKED SEPARATELY. A man told to take
     * cover does not stand in his slot — `slotFor` hunts up to `COVER_HUNT`
     * from it — so the worst case there is the slot plus the hunt, and that
     * has to fit too or a line that took cover could not then be told to move.
     */
    const THREE = await import('three');
    const out = new THREE.Vector3();
    const worst = [];
    for (const F of Object.values(Cmd.FORMATIONS)) {
      let max = 0;
      for (let i = 0; i < Cmd.MAX_STRENGTH; i++) {
        for (let k = 0; k < Cmd.SQUAD_SLOTS; k++) {
          if (!F.slot(i, Cmd.MAX_STRENGTH, k, out)) continue;
          max = Math.max(max, Math.hypot(out.x, out.z));
        }
      }
      worst.push([F.id, max]);
      assert(max <= Cmd.ORDER_REACH,
        `\`${F.id}\` puts a man ${max.toFixed(1)} m from his commander and the reach is `
        + `${Cmd.ORDER_REACH} m — a company that formed the shape it was ordered to form `
        + 'cannot be given its next order');
    }
    /* AND THE ONE THAT DOES NOT STAND IN ITS SLOT. */
    const cover = worst.find(([id]) => id === 'cover')[1];
    assert(cover + 16 <= Cmd.ORDER_REACH,
      `a man in COVER can be ${(cover + 16).toFixed(1)} m out (a ${cover.toFixed(1)} m slot plus `
      + `the 16 m cover hunt) against a reach of ${Cmd.ORDER_REACH} — a line that took cover `
      + 'could not then be told to move');
    worst.sort((a, b) => b[1] - a[1]);
    return worst.map(([id, m]) => `${id} ${m.toFixed(1)}`).join(' · ')
      + ` — all inside ${Cmd.ORDER_REACH} m`;
  });

  check('reach.11 a company standing where it was ordered to stand is still commandable an hour later', () => {
    /**
     * ══ THE WORST THING THIS FEATURE DID, AND IT WAS NOT IN THIS FEATURE ══
     *
     * `_morale` pays presence from the Jedi, from a man's SQUAD LEADER, and
     * from a RELAYS man. A leader is excluded from his own leader term — he
     * does not lead himself — and there was no other term, so a squad leader
     * further than `MORALE.NEAR` (14 m) from the Jedi took `MORALE.ALONE`
     * every frame until his morale hit zero. `braveryOf` is
     * `morale*0.72 + rank/4*0.28`, so a rank-0 leader read 0.000.
     *
     * He got there BY STANDING IN THE SLOT HE WAS ORDERED INTO: `line` at 24
     * men is ±27.6 m of frontage. MEASURED before the fix, army-wide `line`,
     * settled 60 s, no enemies, the general at the centre — every shaken man
     * at every company size was a squad leader beyond 14 m, and at
     * `MAX_STRENGTH` three of five leaders sat at 0.000:
     *
     *     n=10  1 shaken   leaders at 11, 3 m
     *     n=15  1 shaken   leaders at 17, 5, 7 m
     *     n=20  1 shaken   leaders at 23, 11, 3, 13 m
     *     n=24  3 shaken   leaders at 28, 16, 4, 9, 20 m
     *
     * That was a latent defect in the morale table and it was invisible for as
     * long as morale bought nothing an order could be refused for. The reach
     * made it visible and made it permanent: three named leaders refusing
     * every advancing order for the rest of the run, each refusal re-pinning
     * `t.order`, with no remedy — a runner carries an order past distance, not
     * past fear.
     *
     * WHAT HOLDS A LEADER UP IS THE SQUAD HE IS LEADING, and the rule keeps
     * its teeth where they belong: a leader whose squad is gone IS alone.
     * Both halves are driven.
     */
    const { d, c, me } = field();
    c.roster.points = 9999;
    while (c.roster.strength < Cmd.MAX_STRENGTH && d.recruit('trooper')) { /* fill the company */ }
    d.deploy();
    d._troops(1 / 30, {});
    assert(d.order('line') === true, 'a company at its general\'s feet would not form line');
    d._troops(1 / 30, {});
    /* EVERY MAN IN THE SLOT THE ORDER PUT HIM IN — which is the whole point:
     * nobody has wandered off, nobody was sent away. */
    for (const t of d.led(c)) {
      const at = d.slotFor(t.body);
      if (at) t.body.position.set(at.x, 0, at.z);
    }
    for (let i = 0; i < 1800; i++) d._morale(1 / 30, c);

    const squads = d.squadsOf(c);
    const leads = squads.map((sq) => d.leaderOf(sq)).filter((t) => t && t.body);
    assert(leads.length >= 4, `only ${leads.length} squads in a company of ${c.roster.strength}`);
    const far = leads.filter((t) => Math.hypot(t.body.position.x - me.position.x,
      t.body.position.z - me.position.z) > 14);
    assert(far.length >= 1,
      'no squad leader ended up further than MORALE.NEAR from the general — the geometry this '
      + 'check is about did not happen, so it proves nothing');
    for (const t of leads) {
      assert(t.morale > Cmd.SHAKEN_AT,
        `${t.name} leads a squad, is standing in the slot LINE put him in `
        + `${Math.hypot(t.body.position.x - me.position.x, t.body.position.z - me.position.z).toFixed(0)} m `
        + `out, and has decayed to ${t.morale.toFixed(3)} morale — every squad leader in the `
        + 'company goes shaken and then refuses every advancing order for the rest of the run');
    }
    const ask = d._ask(Cmd.FORMATIONS.rank, c, d.led(c), null);
    assert(ask.took.length === ask.took.length + ask.refused.length,
      `${ask.refused.length} of ${c.roster.strength} refused an order after an hour of standing `
      + `in formation (${[...new Set(ask.refused.map((r) => r.why))].join(', ')})`);

    /* AND THE RULE STILL HAS TEETH. A leader with nobody left is alone. */
    const lone = leads[0];
    for (const t of d.squadOf(lone, c)) if (t !== lone && t.body) t.body.position.set(400, 0, 400);
    lone.body.position.set(200, 0, 0);
    me.position.set(0, 0, 0);
    const was = lone.morale;
    for (let i = 0; i < 300; i++) d._morale(1 / 30, c);
    assert(lone.morale < was,
      `${lone.name} is the last man of his squad, 200 m from anybody, and his morale did not `
      + 'move — a leader is never alone and the term is dead');
    return `${leads.length} leaders in a ${c.roster.strength}-man line, ${far.length} of them past `
      + `${14} m, lowest morale ${Math.min(...leads.map((t) => t.morale)).toFixed(2)} · `
      + 'a leader with no squad left still falls';
  });

  check('reach.12 the reach is measured from the ground the formation is solved on', () => {
    /**
     * THE VOICE COMES FROM YOUR BODY AND THE SHAPE IS SOLVED SOMEWHERE ELSE.
     *
     * `_frame` returns `c._paceAnchor`, which lags the player at `advancePace`
     * and — FLAGSHIP §6, deliberately — without bound: once no trooper is
     * inside 14 m, `advancePace` returns 0 and the anchor stops dead. So
     * `reach.10`'s proof is about a distance from the ANCHOR, and the test was
     * against the PLAYER. MEASURED, 24 men in `line`, the player walking at
     * 6 m/s against a slowest trooper of 4.1:
     *
     *     +2s   lag  4.5   furthest man 28.0   deaf 0
     *     +4s   lag  9.0   furthest man 29.0   deaf 0
     *     +6s   lag 13.5   furthest man 30.7   deaf 0
     *     +10s  lag 25.0   furthest man 37.2   deaf 1
     *
     * Five seconds of walking faster than your slowest man spends the whole
     * 5.1 m margin — and it charges the player for something the mechanic is
     * not about. Sending a squad away is the cost; outwalking your own line
     * while it jogs after you is not.
     *
     * SO THE ANCHOR IS A MOUTH TOO. It is where the company IS; you are where
     * you are. A squad genuinely sent somewhere else is out of reach of both,
     * which is the case the rule is for.
     */
    const { d, c, me } = field();
    const anchor = c._paceAnchor;
    assert(anchor, 'the commander has no pace anchor — this check is about the wrong field');
    /* The line stays where it formed and the general walks off. */
    const men = d.led(c).filter((t) => t.body && !t.body.dead);
    for (const t of men) t.body.position.set(0, 0, 0);
    anchor.set(0, 0, 0);
    me.position.set(Cmd.ORDER_REACH + 10, 0, 0);
    const voices = d._voices(c);
    assert(voices.length >= 2,
      `the general walked ${Cmd.ORDER_REACH + 10} m ahead of the ground his own formation is `
      + 'solved on and his line went deaf — outwalking your own men is not what the reach is '
      + 'meant to charge for');
    const ask = d._ask(Cmd.FORMATIONS.charge, c, men, null);
    assert(ask.took.length === men.length,
      `${ask.refused.length} of the line could not hear an order given ${Cmd.ORDER_REACH + 10} m `
      + 'ahead of the ground they are standing on');

    /* AND A SQUAD ACTUALLY SENT AWAY IS STILL OUT OF REACH OF BOTH. */
    for (const t of men) t.body.position.set(400, 0, 400);
    const gone = d._ask(Cmd.FORMATIONS.charge, c, men, null);
    assert(gone.took.length === 0 && gone.refused.every((r) => r.why === 'out of reach'),
      'a company 560 m from both the general and his anchor was still in earshot — the second '
      + 'mouth has made the reach unbounded');
    return `${voices.length} mouths: the body and the ground the shape is solved on · `
      + 'a company sent 560 m away is out of reach of both';
  });

  check('reach.13 a squad still in the air, and one man carrying one order', () => {
    /**
     * TWO NARROW CASES, BOTH FOUND BY DRIVING RATHER THAN BY READING.
     *
     * A SQUAD IN A GUNSHIP IS NOT UNLED. `_inReach` deliberately answers TRUE
     * for a man with no body — he has not landed yet — and `_supervised`
     * answered the opposite, so five men bought at the muster and riding a
     * ship for four seconds were refused a post as `unled`: a statement about
     * a LICENCE, made about a squad whose ranks the test never reached. A
     * Sergeant in it did not help, and no runner window either, because only
     * distance arms one.
     *
     * ONE MAN CARRIES ONE ORDER. Nothing tracked a runner per (order, unit),
     * so refuse → press → runner A → refuse → press → runner B put two men out
     * of the line with the same message, two RUNNER AWAY toasts and two
     * `delivered` rows. The refusal toast's own "Press it again to send a
     * runner" invites exactly those presses. And a delivery must not arm the
     * window off its own partial refusal, or the arrival dispatches a second
     * man to carry what the first one just carried.
     */
    const { w, d, c, squads } = field();
    const k = 1, men = squads[k];
    /* IN THE AIR: no bodies at all, which is what a gunship looks like here. */
    const kept = men.map((t) => [t, t.body]);
    for (const t of men) t.body = null;
    assert(d._supervised(c, men) === true,
      'a squad still in a gunship reads as unled — a claim about a licence, about a squad whose '
      + 'ranks the test never reached');
    const air = d._ask(Cmd.FORMATIONS.digin, c, men, k);
    assert(!air.refused.some((r) => r.why === 'unled'),
      'a squad in the air was refused a post as unled');
    for (const [t, e] of kept) t.body = e;

    /* ONE RUNNER. */
    d._pending = null; c._pending = null;
    put(d, men, 150, 150);
    assert(d.order('charge', c, k) === false, 'a squad 210 m out took an order');
    w.time += 1;
    assert(d.order('charge', c, k) === true, 'the second press sent nobody');
    const first = d.led(c).filter((t) => t.runner);
    assert(first.length === 1, `${first.length} men were sent with one order`);
    /* Refuse it again and press again: the window must not put a second man on
     * the same errand. */
    w.time += 1;
    d.order('charge', c, k);
    w.time += 1;
    d.order('charge', c, k);
    const now = d.led(c).filter((t) => t.runner && t.runner.id === 'charge' && t.runner.squad === k);
    assert(now.length === 1,
      `${now.length} men are carrying the same order to the same squad — two RUNNER AWAY toasts `
      + 'and two deliveries for one press of one key');

    /* AND A DELIVERY DOES NOT ARM THE WINDOW OFF ITS OWN REFUSAL. Cleared
     * first, because the presses above legitimately armed one — what is being
     * measured is whether the ARRIVAL writes a new one. */
    c._pending = null;
    const man = now[0];
    /* Two of the destination men walk out of his voice, so the delivery is
     * partially refused for distance — the exact case that re-armed it. */
    for (const t of men.slice(0, 2)) t.body.position.set(500, 0, 500);
    man.body.position.set(man.runner.to.x, 0, man.runner.to.z);
    d._runnerTick(man, 1 / 30);
    assert(!c._pending,
      `a delivery armed a fresh runner window (${JSON.stringify(c._pending)}) — the next press `
      + 'sends a second man to carry the order the first one just carried');
    /* AND A DELIVERY DOES NOT MOVE THE PLAYER'S TARGET SLOT. A runner sent
     * thirty seconds ago whose destination squad has since been wiped arrives,
     * calls `order()`, and takes its "nobody left to take it" branch — which
     * clears the selection. That is a HUD retargeted from a `_troops` tick by
     * something that is not a key press. */
    d._pending = null; c._pending = null;
    put(d, men, 150, 150);
    d.order('charge', c, k);
    w.time += 1;
    d.order('charge', c, k);
    const late = d.led(c).find((t) => t.runner && t.runner.squad === k);
    assert(late, 'no runner was sent for the selection case');
    d.selectedSquad = k;
    let told = 'nothing';
    d.onTarget = (i) => { told = i; };
    for (const t of men) { t.alive = false; if (t.body) t.body.dead = true; }
    late.body.position.set(late.runner.to.x, 0, late.runner.to.z);
    d._runnerTick(late, 1 / 30);
    assert(d.selectedSquad === k,
      'a runner arriving at a squad that was wiped while he crossed moved the player\'s Target '
      + 'slot — a HUD retargeted from a physics tick by a key press half a minute old');
    assert(told === 'nothing', `onTarget fired (${told}) from a delivery`);
    return 'a squad in the air is supervised · one man per order · a delivery arms nothing '
      + 'and retargets nothing';
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

    /**
     * …AND A COMPANY DOWN TO ONE SQUAD IS THE STATE WITH NO HEADING AND THE
     * MOST TO SAY.
     *
     * The readout lived inside the squad-heading branch, which only runs when
     * there are two squads, or a name, or a detached man. A roll ground down
     * to a single squad printed a bare list with no warning on it — and that
     * is precisely the state in which the WHOLE COMPANY can go deaf at once.
     * A detached man is the same shape of gap from the other end: by
     * definition the one furthest from anybody.
     */
    const one = { ...seen, roll: seen.roll.filter((r) => r.squad === 1 && !r.detached)
      .map((r) => ({ ...r, squad: 0, heard: false })) };
    const solo = rosterHtml(one, null, 'Squad');
    assert(/out of reach/.test(solo),
      'a company down to ONE squad, every man of it out of earshot, printed a bare list with no '
      + 'warning — the state where the whole roll can go deaf at once is the state with no heading');
    const det = { ...seen, roll: seen.roll.map((r, i) => ({ ...r,
      squad: i < 2 ? null : r.squad, detached: i < 2, heard: i < 2 ? false : true })) };
    assert(/out of reach/.test(rosterHtml(det, null, 'Squad')),
      'a detached man out of earshot is not marked — a man pulled out of the line is by '
      + 'definition the furthest from anybody');

    /* AND A BUILD THAT DOES NOT CARRY THE FIELD SAYS NOTHING, rather than
     * claiming everybody is deaf: a summary off the wire (`applyNet`) has no
     * `heard` on any row. */
    const bare = { ...seen, roll: seen.roll.map(({ heard, ...r }) => r) };
    const quiet = rosterHtml(bare, d.squadNames, 'Squad');
    assert(!/out of reach|in earshot/.test(quiet),
      'a roster with no reach information printed a reach readout anyway');
    /**
     * …AND IT FOLLOWS YOUR FEET, WHICH IS THE HALF THAT NEEDED ITS OWN CLOCK.
     *
     * `_announceRoster` fires on a death, a deploy and a start — every one of
     * them something happening to the ROLL. Earshot is not about the roll; it
     * changes on a frame where nothing at all has happened to anybody, because
     * YOU walked. So a panel refreshed only on those events would have said
     * "2nd Squad — out of reach" for the whole of the next engagement after
     * the player walked back to it.
     *
     * DRIVEN THROUGH `_troops`, which is the loop the game actually runs, and
     * stepped for a real quarter second rather than poked — a check that calls
     * `_announceRoster` itself proves nothing about whether anything calls it.
     */
    let paints = 0;
    d.onRoster = (r) => { seen = r; paints++; };
    for (const t of men) t.body.position.set(200, 0, 200);
    for (let i = 0; i < 30; i++) d._troops(1 / 30, {});
    const settled = paints;
    for (let i = 0; i < 30; i++) d._troops(1 / 30, {});
    assert(paints === settled,
      `the panel repainted ${paints - settled} times in a second with nobody moving — the `
      + 'readout is on a timer rather than on a change');
    for (const t of men) t.body.position.set(2, 0, 2);
    for (let i = 0; i < 30; i++) d._troops(1 / 30, {});
    assert(paints > settled,
      'the squad walked back into earshot and the panel never heard about it — the readout '
      + 'is only refreshed by things that happen to the roll, and this one happens to you');
    assert(seen.roll.filter((r) => r.heard === false).length === 0,
      'the repaint carried the old picture');
    return 'per-man `heard` on the summary · "out of reach" · "2/5 in earshot" · one squad and '
      + 'the detached both marked · silent without it · repaints when they cross, not on a timer';
  });

  /**
   * ══ reach.14 THE ONE PRE-PRESS FEAR SIGNAL IS THE REFUSAL RULE'S OWN ═════
   *
   * `_takers` refuses an advance when `braveryOf(body) < SHAKEN_AT` — 0.30
   * over `morale*0.72 + rank/4*0.28 + rally`. The nameplate, which is the only
   * thing on screen that says a man is frightened BEFORE you press anything,
   * carried `mo < 0.4`: a typed literal against raw morale, importing neither
   * term. Resolved, they were two different rules:
   *
   *     rank            refuses an advance below   the plate said "shaken" below
   *     0 Trooper       morale 0.417               0.400
   *     2 Sergeant      morale 0.222               0.400
   *     4 Commander     morale 0.028               0.400
   *
   * So the plate flagged obedient Sergeants and Commanders as shaken and was
   * approximately right for exactly one rung — and either number moving would
   * have widened the gap in silence, because nothing tied them together.
   *
   * ASSERTED AS AN AGREEMENT AND NOT AS A NUMBER. The check does not know what
   * 0.30 is; it walks the morale axis at every rank, asks the DIRECTOR whether
   * an advance is refused and asks the HUD's own class whether the plate is
   * lit, and holds the two to the same crossing. Retune `SHAKEN_AT`, the
   * bravery weights or the rank ladder and this stays green; let the plate
   * drift off the rule again and it turns red with the rank that disagreed.
   */
  check('reach.14 a plate that says "shaken" is a man who would refuse to advance', async () => {
    const { readFile } = await import('node:fs/promises');
    const { HUD } = await import('../../src/ui/HUD.js');
    const { makeDocument } = await import('./_page.mjs');
    const THREE = await import('three');
    const INDEX = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const { d, c, me, w } = army();
    const men = d.squadsOf(c).flat().filter((t) => t.alive !== false);
    assert(men.length >= 2, `the fixture deployed ${men.length} men`);
    /* ONE MAN UNDER TEST and one friend standing on him, because `alone` is the
     * other advance refusal and it is not what is measured here. Everyone else
     * goes off the roll so `live[0]` is the man whose plate is read. */
    const t = men[0];
    const mate = men[1];
    for (const o of men.slice(2)) { o.alive = false; if (o.body) o.body.dead = true; }
    t.body.position.set(0, 0, 3);
    mate.body.position.set(1, 0, 3);
    mate.morale = 1;
    /* IN REACH, so `out of reach` is never the refusal that answers. */
    me.position.set(0, 0, 0);
    w.settings.troopNames = 'all';
    w.command = d;
    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(doc);
      /* A REAL CAMERA, because `_nameplates` projects the head through one and
       * that is how a plate gets a screen position at all. Looking down +Z at
       * the two men standing 3 m out, so both are on screen. */
      const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
      cam.position.set(0, 1.6, -2);
      cam.lookAt(0, 1.6, 3);
      cam.updateMatrixWorld(true);
      const player = { team: 0, position: me.position, aimDir: null, camera: { pos: cam.position } };
      const rows = [];
      /* THE RUNG IS SET THROUGH XP, because `rank` is a getter over `RANKS`. A
       * rung written directly would be a rung the game cannot produce. */
      for (const rank of [0, 2, 4]) {
        t.xp = Cmd.RANKS[rank].xp;
        assert(t.rank === rank, `xp ${t.xp} came back as rung ${t.rank}, not ${rank}`);
        let ruleCross = null;
        let plateCross = null;
        for (let m = 100; m >= 0; m--) {
          t.morale = m / 100;
          /* THE RULE, ASKED THROUGH THE DOOR THE PLAYER PRESSES. `charge` is an
           * `advance` formation, so `_takers` reaches the fear term. `order()`
           * reports who refused and why. */
          const ask = d._ask(Cmd.FORMATIONS.charge, c, [t, mate], null);
          const refused = ask.refused.some((r) => r.t === t && r.why === 'shaken');
          /* THE PLATE, PAINTED. Not the expression re-typed here — the real
           * `_nameplates` on a real page, and the class it actually set. */
          hud._nameplates(w, player, cam);
          const P = hud._plates.find((x) => x.name?.textContent === t.name);
          assert(P, `no plate was painted for ${t.name}`);
          const lit = P.node.classList.contains('shaken');
          if (refused && ruleCross === null) ruleCross = m / 100;
          if (lit && plateCross === null) plateCross = m / 100;
          assert(refused === lit,
            `rank ${rank} at morale ${(m / 100).toFixed(2)}: the order is `
            + `${refused ? 'refused as shaken' : 'taken'} and the plate `
            + `${lit ? 'says shaken' : 'says nothing'}`);
        }
        rows.push(`rank ${rank} → ${ruleCross == null ? 'never' : ruleCross.toFixed(2)}`);
        assert(ruleCross === plateCross, `rank ${rank}: the rule crosses at ${ruleCross} and the plate at ${plateCross}`);
      }
      return `${rows.join(' · ')} — the plate and the refusal cross together at every rung`;
    } finally { restore(); }
  });

  /**
   * ══ reach.15 A RUNNER IS A MAN ON THE FIELD, AND HE CAN SEE TROUBLE ══════
   *
   * The one mechanic in this mode that turns a message into a BODY, and both
   * halves of that were missing.
   *
   * HE COULD NOT DEFEND HIMSELF. `leashFor`'s runner branch gives him
   * `LEASH_FLOOR` with a comment saying it is "so he still shoots what walks
   * into him — a man who cannot defend himself at all is a delivery animation
   * with a health bar". `targetFor` centres that disc on `slotFor(e)`, and
   * `slotFor`'s runner branch returns `RUN.to` — his DESTINATION. So the 10 m
   * disc sat on ground he had not reached and a droid standing on his toes was
   * rejected for being outside it. A load-bearing comment asserting the
   * opposite of the code is the shape that hides real bugs, so the check asks
   * the shipped `targetFor` rather than reading either.
   *
   * AND NOTHING MARKED HIM. `grep -rn runner src/ui/` came back empty: no
   * plate change, no glyph, no colour. `onRunner` was where that was meant to
   * go and nothing ever wired it — it is gone, and `summary()` carries the
   * errand instead, because "a man is carrying an order" is a STATE that has
   * to end when he arrives and a fire-once hook cannot say that.
   */
  check('reach.15 a runner defends himself and the field can see him', () => {
    const { w, d, c, squads } = field();
    const k = 1, men = squads[k];
    d._pending = null; c._pending = null;
    put(d, men, 150, 150);
    assert(d.order('charge', c, k) === false, 'a squad 210 m out took an order');
    w.time += 1;
    assert(d.order('charge', c, k) === true, 'the second press sent nobody');
    const man = d.led(c).find((t) => t.runner);
    assert(man, 'nobody was sent');
    const e = man.body;

    /* ── HE SHOOTS WHAT WALKS INTO HIM. A hostile one metre from his BODY and
     * two hundred metres from his destination: under the old centre the disc
     * was on the destination and this was rejected. */
    const near = { position: new (e.position.constructor)(e.position.x + 1, 0, e.position.z),
                   dead: false, hp: 10, team: 1, trooper: null };
    const got = d.targetFor(e, [near]);
    assert(got === near,
      'a hostile standing on the runner is not a target — his leash disc is on ground he has '
      + 'not reached, and he is the delivery animation his own comment disclaims');
    /* …AND THE DISC IS STILL SMALL. He is running an errand, not fighting his
     * way across: something out past the floor is still not his problem. */
    const far = { position: new (e.position.constructor)(e.position.x + Cmd.LEASH_FLOOR + 6, 0,
                                                        e.position.z),
                  dead: false, hp: 10, team: 1, trooper: null };
    assert(d.targetFor(e, [far]) !== far,
      `a runner picked a fight ${Cmd.LEASH_FLOOR + 6} m away — the errand is not a patrol`);

    /* ── AND THE ROLL SAYS HE IS CARRYING IT, which is what the plate and the
     * column draw from. It has to STOP saying so: the errand is a state, and
     * the whole reason `onRunner` was deleted rather than wired is that a
     * fire-once hook cannot end one. */
    const row = () => c.roster.summary().roll.find((r) => r.id === man.id);
    assert(row()?.runner === 'charge',
      `the roll says the runner is carrying ${JSON.stringify(row()?.runner)}`);
    assert(c.roster.summary().roll.filter((r) => r.runner).length === 1,
      'more than one man on the roll is carrying an order');
    man.runner = null;
    assert(row()?.runner === null, 'the roll still marks a man who has stopped carrying it');
    return 'a hostile on his toes is a target, one past the floor is not, and the roll marks '
      + 'him only while he carries it';
  });
}
