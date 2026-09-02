/**
 * BATTLEFIELD BORZ — WHAT A SOLDIER DOES ABOUT SOMETHING AT HIS FEET.
 *
 * The player, on his own troops:
 *
 *   "I haven't seen any troops diving or having any dynamic movements, they
 *    should be smart and reactive to their own environment with self
 *    preservation, like diving out of the way of a grenade or picking one up
 *    and throwing it back (sometimes killing themselves) or diving on a grenade
 *    to save their friends if they're brave and selfless enough, or dragging
 *    their friends to safety, not just this stuff you know this stuff and more,
 *    you need to be really creative here the world is our oyster."
 *
 * ── WHY THERE WAS NOTHING TO SEE, IN ONE SENTENCE ───────────────────────
 *
 * There was nothing to react TO. `Stratagems.blast` is instantaneous — a call
 * lands, a sphere of damage is applied, the frame moves on — and every
 * behaviour in that note is a decision taken during the second and a half a
 * grenade spends lying on the ground. Nothing in this game had ever occupied a
 * piece of ground for a second and a half. So the object came first and the
 * behaviours came second, and this suite is in that order too.
 *
 * ── WHAT THESE CHECKS ARE FOR ────────────────────────────────────────────
 *
 * Each of the four answers is measured as a CONSEQUENCE rather than as a state
 * name: a dive is measured as the metres a body put between itself and the
 * blast, a throw-back as the grenade ending up somewhere else with the same
 * fuse still burning, a smother as the health of the men behind him, a drag as
 * the casualty moving. A check that asserted `body.reaction.kind === 'dive'`
 * would pass on a build where the dive moved nobody anywhere.
 */

import * as THREE from 'three';
import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  /* These drive real Worlds, which advance the wind clock and both seeded
   * streams — see `determinism.mjs`. */
  check = await clocked(check);

  const boot = async (settings = {}) => {
    const H = await import('./_coop.mjs');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(77);
    const { world } = await H.bootWorld({
      level: 'colosseum',
      settings: { mode: 'waves', quality: 'low', instantSpawn: true, ...settings },
    });
    return { world, input: H.idleInput() };
  };

  /** A squad of allied troopers standing in a line, and a grenade among them. */
  const squad = async (n = 5, opts = {}) => {
    const { world, input } = await boot();
    const p = world.player;
    const men = [];
    for (let i = 0; i < n; i++) {
      const x = p.position.x - 4 + i * 2;
      const z = p.position.z - 12;
      const e = world.spawnEnemy(opts.type || 'trooper', new THREE.Vector3(x, world.terrain.height(x, z), z));
      assert(e, 'no trooper spawned');
      e.team = p.team;                              // one of yours
      men.push(e);
    }
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    return { world, input, men, p };
  };

  check('reactions: a grenade is a THING that lies on the ground and burns', async () => {
    /**
     * THE OBJECT, BEFORE ANY BEHAVIOUR. Three properties, and the third is the
     * one the whole feature rests on: it lands where it was aimed, it goes off
     * on its own clock, and in between there is a window long enough for a man
     * to decide something. On the code this replaces there was no window at
     * all — `blast` is one frame.
     */
    const { world, input } = await boot();
    const { FUSE, GRENADE } = await import('../../src/game/Reactions.js');
    const p = world.player;
    const to = new THREE.Vector3(p.position.x + 8, 0, p.position.z);
    to.y = world.terrain.height(to.x, to.z);
    const from = p.chest.clone();
    const g = world.grenades.throw(from, to, { team: 1 });
    assert(g && !g.dead, 'the throw produced nothing');
    let landedAt = -1, ground = 0;
    for (let i = 0; i < 60 * 5; i++) {
      world.update(1 / 60, input);
      if (g.dead) break;
      if (landedAt < 0 && g.grounded) { landedAt = i; ground = g.position.distanceTo(to); }
    }
    assert(landedAt > 0, 'the grenade never reached the ground');
    assert(ground < 0.35, `it came to rest ${ground.toFixed(2)} m from where it was aimed`);
    assert(g.dead, `it never went off — ${FUSE} s of fuse and it is still there`);
    /* THE WINDOW, in seconds, and it is the whole reason the rest of this
     * suite has anything to measure. */
    const window = FUSE - landedAt / 60;
    assert(window > 1.2,
      `there is only ${window.toFixed(2)} s between it landing and it going off — nobody can decide `
      + 'anything in that, and every behaviour below is a decision taken in this window');
    return `landed at ${(landedAt / 60).toFixed(2)} s, ${ground.toFixed(2)} m from the mark, `
      + `${window.toFixed(2)} s of window, blast ${GRENADE.radius} m`;
  });

  check('reactions: men get out of the way, and they are further away for it', async () => {
    /**
     * THE DIVE, measured in metres rather than in state names. Two runs of the
     * same scene: one where the reaction system is allowed to act and one where
     * every body is pinned. What is compared is the distance from the blast at
     * the moment it goes off — which is the only thing a dive is FOR.
     */
    const { GRENADE } = await import('../../src/game/Reactions.js');
    const run = async (react) => {
      const { world, input, men, p } = await squad(5);
      /* ORDINARY MEN. `nerveOf` is what decides between the four answers, and
       * a squad of veterans would throw it back rather than dive — which is
       * correct behaviour and a different check. These are troopers. */
      const at = men[2].position.clone();
      const from = at.clone(); from.y += 12; from.x += 10;
      world.grenades.throw(from, at, { team: 1 });
      let blown = false, hp = 0, spread = 0;
      /* THE CONTROL ARM IS THE SHIPPED OPT-OUT, not a reaction cleared every
       * frame: clearing it leaves the body mid-leap with its velocity already
       * spent, so the "pinned" arm was measuring a squad that had been shoved
       * and then abandoned. `noReact` is read at the top of `senseDanger`. */
      if (!react) for (const m of men) m.noReact = true;
      for (let i = 0; i < 60 * 5 && !blown; i++) {
        world.update(1 / 60, input);
        if (!world.grenades.list.length) {
          blown = true;
          for (const m of men) { hp += Math.max(0, m.hp); spread += m.position.distanceTo(at); }
        }
      }
      assert(blown, 'the grenade never went off in five seconds');
      return { hp, spread: spread / men.length, alive: men.filter((m) => !m.dead).length, world };
    };
    const still = await run(false);
    const alive = await run(true);
    assert(alive.spread > still.spread + 1.0,
      `men who reacted stood ${alive.spread.toFixed(2)} m from the blast and men who did not stood `
      + `${still.spread.toFixed(2)} m — nobody moved anywhere`);
    assert(alive.alive >= still.alive,
      `${alive.alive} men reacted and lived against ${still.alive} who stood still — a reaction that `
      + 'gets more of them killed is worse than none');
    assert(alive.hp > still.hp + 1,
      `${alive.hp.toFixed(0)} hp survived with reactions on and ${still.hp.toFixed(0)} with them off — `
      + 'diving out of the way of a grenade has to be worth doing');
    assert(alive.world.grenades.stats.dived > 0, 'no body ever chose to dive');
    return `pinned ${still.spread.toFixed(1)} m / ${still.hp.toFixed(0)} hp · reacting `
      + `${alive.spread.toFixed(1)} m / ${alive.hp.toFixed(0)} hp`;
  });

  check('reactions: somebody shouts, and the squad answers together', async () => {
    /**
     * THE CHEAPEST THING IN THE FILE AND MOST OF WHY IT READS AS A SQUAD.
     *
     * Without the shout each man notices on his own clock and a line of five
     * ripples over half a second, which reads as five individuals who happen to
     * be near each other. `senseDanger` cuts everyone's lag to `LAG.heard` the
     * moment the first of them acts, so what you see is a squad reacting.
     *
     * Measured as the SPREAD in the frame each man commits, which is a number
     * with no state names in it.
     */
    const { LAG } = await import('../../src/game/Reactions.js');
    const { world, input, men } = await squad(5);
    const at = men[2].position.clone();
    const from = at.clone(); from.y += 12; from.z += 12;
    world.grenades.throw(from, at, { team: 1 });
    const first = new Map();
    for (let i = 0; i < 60 * 3; i++) {
      world.update(1 / 60, input);
      for (const m of men) if (m.reaction && !first.has(m)) first.set(m, i);
      if (!world.grenades.list.length) break;
    }
    assert(first.size >= 4, `only ${first.size} of ${men.length} men reacted at all`);
    const frames = [...first.values()];
    const spread = (Math.max(...frames) - Math.min(...frames)) / 60;
    assert(spread < LAG.base,
      `the squad committed over ${spread.toFixed(2)} s, which is longer than one man's own reaction `
      + `time (${LAG.base} s) — the shout is not reaching anybody`);
    return `${first.size} men, all committed inside ${spread.toFixed(2)} s`;
  });

  check('reactions: a brave man throws it back, and the fuse does not wait for him', async () => {
    /**
     * "picking one up and throwing it back (sometimes killing themselves)".
     *
     * Both halves are one mechanism and that is the point: nothing stops the
     * fuse while a man is carrying it, so the same code that returns a grenade
     * kills the man who tried it too late. This measures the good outcome and
     * then, on the same fixture with the clock nearly out, the bad one.
     */
    const { world, input, men } = await squad(3, {});
    const R = await import('../../src/game/Reactions.js');
    const brave = men[1];
    /**
     * NERVE IS READ, NOT ROLLED — see `nerveOf`. A Command trooper's is his
     * morale record and his rank, both of which the player can see on his
     * nameplate; a body with no record answers with its archetype's threat.
     * These are spawned bodies with no roster behind them, so the second path
     * is the one to raise — and it is raised on a COPY, because `A` is the
     * shared archetype object and mutating it would make every clone in the
     * process braver for the rest of the run.
     */
    brave.A = { ...brave.A, threat: 7 };
    /* THREE METRES: inside the throw-back's own reach (4.2 m) and outside
     * `SMOTHER.range`, because a man standing ON one covers it instead — see
     * the branch order in `chooseReaction`, and the check below. */
    const at = brave.position.clone().add(new THREE.Vector3(3.0, 0, 0));
    at.y = world.terrain.height(at.x, at.z);
    const g = world.grenades.throw(at.clone().setY(at.y + 6), at, { team: 1 });
    const where = at.clone();
    let returned = false;
    for (let i = 0; i < 60 * 4; i++) {
      world.update(1 / 60, input);
      if (world.grenades.stats.returned > 0) { returned = true; break; }
      if (g.dead) break;
    }
    assert(returned,
      'nobody picked it up. A steady man standing 3 m from a live grenade with two seconds on it '
      + 'is exactly the case the player described');
    assert(g.to.distanceTo(where) > 4,
      `it was thrown back ${g.to.distanceTo(where).toFixed(1)} m — a return that lands where it was `
      + 'is not a return');
    assert(g.left < R.FUSE - 0.3,
      'the fuse was reset by the throw — a grenade you send back is a grenade with less time on it, '
      + 'which is the whole risk in doing it');
    return `returned ${g.to.distanceTo(where).toFixed(1)} m with ${g.left.toFixed(2)} s left`;
  });

  check('reactions: a man on top of it takes it for the others', async () => {
    /**
     * "diving on a grenade to save their friends if they're brave and selfless
     * enough".
     *
     * TWO HALVES, because they are two different questions and a single
     * measurement of both answers neither. The first is whether anybody does
     * it; the second is what it is worth to the men behind him — and the second
     * cannot be measured by running the same scene with the behaviour switched
     * off, because with it off the same brave men simply choose the next answer
     * down and survive by diving. Measured that way: 184 hp with, 184 hp
     * without, and nothing learned.
     */
    const R = await import('../../src/game/Reactions.js');
    const { world, input, men } = await squad(5);
    /* Brave enough to have one in it. `nerveOf` reads the roster record where
     * there is one and the archetype's threat where there is not; these are
     * spawned bodies, so it is the second — on a COPY of the archetype, since
     * `A` is shared and mutating it would make every clone in the process
     * braver for the rest of the run. */
    for (const m of men) m.A = { ...m.A, threat: 7 };
    const at = men[2].position.clone();
    at.y = world.terrain.height(at.x, at.z);
    /* AT A MAN'S FEET, which is the situation the behaviour is for: from
     * `SMOTHER.range` there is nowhere to throw it that is out of the blast he
     * is standing in, so covering it is the only act available to him that
     * changes what happens to the men behind him. Further out the same man
     * throws it back — see the check above, and the branch order in
     * `chooseReaction`. */
    const g = world.grenades.throw(at.clone().setY(at.y + 6), at, { team: 1 });
    let hero = null;
    for (let i = 0; i < 60 * 5; i++) {
      world.update(1 / 60, input);
      if (g.smotheredBy) hero = g.smotheredBy;
      if (g.dead) break;
    }
    assert(hero, 'nobody threw themselves on it, with a squad of five at full nerve around it');
    assert(hero.dead || hero.hp < hero.maxHp * 0.2,
      `the man who lay on a grenade got up afterwards on ${hero.hp.toFixed(0)} hp, which is not what `
      + 'that is');
    assert(world.grenades.stats.smothered > 0, 'the field never recorded a smother');

    /* ── AND WHAT IT BOUGHT, measured as arithmetic on one blast rather than
     * as two runs of a scene whose other men change their minds between them.
     * Same detonation, same ring of bodies, the only difference being whether
     * somebody was lying on it. */
    const ring = async (covered) => {
      const b = await squad(5);
      for (const m of b.men) m.noReact = true;            // nobody moves, either way
      const site = b.men[2].position.clone();
      site.y = b.world.terrain.height(site.x, site.z);
      const gg = b.world.grenades.throw(site.clone().setY(site.y + 6), site, { team: 1 });
      if (covered) gg.smotheredBy = b.men[2];
      for (let i = 0; i < 60 * 5 && !gg.dead; i++) b.world.update(1 / 60, b.input);
      const others = b.men.filter((m) => m !== b.men[2]);
      return others.reduce((a, m) => a + Math.max(0, m.hp), 0);
    };
    const withHim = await ring(true);
    const without = await ring(false);
    assert(without < withHim - 1,
      `the men around it held ${withHim.toFixed(0)} hp with somebody on it and ${without.toFixed(0)} `
      + 'without — the act bought them nothing');
    return `somebody covered it and went down; the ring held ${withHim.toFixed(0)} hp against `
      + `${without.toFixed(0)} uncovered (share ${R.SMOTHER_SHARE})`;
  });

  check('reactions: a man goes back for somebody who is down', async () => {
    /**
     * "or dragging their friends to safety".
     *
     * A casualty here is what the game already means by one: a body that is
     * LIMP AND ALIVE, which `Enemy._tickGetUp` stands up after a moment of
     * lying still. Measured as the casualty MOVING — a drag that does not move
     * the man is two soldiers standing next to each other.
     */
    const { world, input, men } = await squad(3);
    const { findCasualty, startDrag } = await import('../../src/game/Reactions.js');
    const hurt = men[0], helper = men[1];
    if (helper.trooper) helper.trooper.morale = 1;
    hurt.hp = hurt.maxHp * 0.3;
    hurt.actor?.goRagdoll?.(hurt.velocity.clone(), null);
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);
    const found = findCasualty(helper, { enemies: world.enemies });
    assert(found === hurt, 'a soldier standing two metres from a downed man does not see him');
    const from = hurt.position.clone();
    assert(startDrag(helper, hurt, { enemies: world.enemies }), 'the drag would not start');
    assert(hurt.beingDragged === helper, 'the casualty is not claimed, so ten men would grab him');
    let moved = 0;
    for (let i = 0; i < 60 * 8 && helper.reaction; i++) {
      /* He must not simply stand up on his own and end the drag before it has
       * moved him — this check is about the drag, and `_tickGetUp` has its own. */
      hurt.actor.ragdolled = true;
      world.update(1 / 60, input);
      moved = hurt.position.distanceTo(from);
    }
    assert(moved > 2.5, `the casualty was dragged ${moved.toFixed(2)} m`);
    /* AND THE CLAIM IS A LEASE. Ending the drag the ugly way — the dragger's
     * reaction replaced out from under him, which is what a grenade landing
     * next to him does — must still free the casualty, or the first
     * interruption in a battle leaves a man nobody can ever help again. */
    helper.reaction = null;
    for (let i = 0; i < 60; i++) { hurt.actor.ragdolled = true; world.update(1 / 60, input); }
    assert(!hurt.beingDragged,
      'the claim outlived the man holding it — see DRAG_LEASE, and Enemy.hold for the same lesson');
    return `dragged ${moved.toFixed(1)} m`;
  });

  check('reactions: a man who went back for a mate walks at his own pace afterwards', async () => {
    /**
     * THE PACE A REACTION BORROWS HAS TO BE GIVEN BACK.
     *
     * `Enemy.speed` is not a per-frame field. The constructor rolls it once —
     * archetype speed, a shake, the difficulty's aggression — and nothing
     * writes it again for the body's whole life. Everything that wants a
     * different pace for a moment writes it, uses it and hands it back;
     * `Command.installCommand` wraps `_move` to do exactly that, and says why:
     * "leaving it on the body would compound with the rank multipliers …
     * a promotion would silently become a permanent sprint".
     *
     * `stepReaction` runs BEFORE `_move` and therefore outside that wrapper's
     * window, so the wrapper captured the reaction's borrowed pace as if it
     * were the body's own and dutifully restored it on top of itself.
     * `stepDrag` asks for a third of a walk, which is the whole content of the
     * behaviour — and measured, a trooper who pulled one casualty out went from
     * 4.465 m/s to 1.394 and stayed there. One rescue, and a man walks at a
     * third of a walk for the rest of the level.
     *
     * Measured as GROUND COVERED and not as the field, and against a mate who
     * did nothing, because a pace is only ever visible as distance: both bodies
     * are walked the same way through the shipped `_move` after the drag is
     * over.
     */
    const { world, input, men } = await squad(3);
    const { startDrag } = await import('../../src/game/Reactions.js');
    const hurt = men[0], helper = men[1], mate = men[2];
    if (helper.trooper) helper.trooper.morale = 1;
    hurt.hp = hurt.maxHp * 0.3;
    hurt.actor?.goRagdoll?.(hurt.velocity.clone(), null);
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);

    assert(startDrag(helper, hurt, { enemies: world.enemies }), 'the drag would not start');
    let n = 0;
    for (; n < 60 * 14 && helper.reaction; n++) { hurt.actor.ragdolled = true; world.update(1 / 60, input); }
    assert(!helper.reaction, `the drag was still running after ${(n / 60).toFixed(1)} s`);

    /* BOTH OF THEM, THE SAME WAY, THROUGH THE SHIPPED MOVER. `_move` is the one
     * thing that reads `speed`, so driving it directly with the same wish is
     * the consequence with nothing restated. */
    const ctx = world._frameCtx;
    const walk = (e) => {
      const from = e.position.clone();
      for (let i = 0; i < 120; i++) {
        if (!e.wish) e.wish = new THREE.Vector3();
        e.wish.set(1, 0, 0);
        e.stunTimer = 0; e.knockTimer = 0;
        e._move(1 / 60, ctx);
      }
      return e.position.distanceTo(from);
    };
    const dHelper = walk(helper);
    const dMate = walk(mate);
    assert(dMate > 1, `the control trooper covered ${dMate.toFixed(2)} m in 2 s — nothing walked, `
      + 'so this check cannot say anything about pace');
    const ratio = dHelper / dMate;
    assert(ratio > 0.85,
      `the man who did the dragging covered ${dHelper.toFixed(2)} m where his mate covered `
      + `${dMate.toFixed(2)} (${(ratio * 100).toFixed(0)}%) — DRAG.speed is still on his body, and `
      + 'Enemy.speed is a field that lasts a lifetime, not a frame');
    return `after the drag he covers ${dHelper.toFixed(2)} m against a mate's ${dMate.toFixed(2)} `
      + `(${(ratio * 100).toFixed(0)}%)`;
  });

  check('reactions: a grenadier who decides against it does not decide again next frame', async () => {
    /**
     * THE COST OF A DECISION NOBODY TAKES.
     *
     * `_maybeGrenade` runs on every grenade-carrying body every frame, and
     * `grenadeCd` at 0 means READY rather than ASKED — so a body whose target
     * is alone and in the open re-took the whole decision on every frame it
     * stood in the 9.5-26 m band: an O(bodies) clump scan and, worse,
     * `_hasLineOfSight`, which is a physics raycast, a terrain raycast and a
     * smoke integral. That is the most expensive question this class asks and
     * the rifle only asks it about once a fire cycle.
     *
     * Counted rather than timed, because this box is shared and a stopwatch on
     * it measures the neighbours (HANDOFF 2.6). Twelve troopers ringing a lone
     * target at 15 m, over 180 frames: 0.930 sight rays per body per frame with
     * the gate open against 0.006 with the cooldown held down — a 167x
     * multiplier bought by a feature nobody could see happening.
     *
     * The bound below is on the RATIO and is deliberately loose: its job is to
     * catch the whole decision creeping back onto the every-frame path, not to
     * police a constant.
     */
    const { Enemy } = await import('../../src/game/Enemy.js');
    const trial = async (armed) => {
      const { world, input } = await boot();
      const p = world.player;
      const men = [];
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = p.position.x + Math.cos(a) * 15, z = p.position.z + Math.sin(a) * 15;
        const e = world.spawnEnemy('trooper', new THREE.Vector3(x, world.terrain.height(x, z), z));
        if (e) men.push(e);
      }
      for (let i = 0; i < 30; i++) world.update(1 / 60, input);
      const base = Enemy.prototype._hasLineOfSight;
      let calls = 0;
      Enemy.prototype._hasLineOfSight = function (...a) { calls++; return base.apply(this, a); };
      const frames = 180;
      try {
        /* Once, not every frame: `armed` is a grenadier whose lead-in has run
         * out on its own, which is the state every one of them reaches nine
         * seconds into a fight. */
        for (const e of men) e.grenadeCd = armed ? 0 : 1e9;
        for (let i = 0; i < frames; i++) world.update(1 / 60, input);
      } finally { Enemy.prototype._hasLineOfSight = base; }
      const alive = men.filter((e) => !e.dead).length;
      return { per: calls / frames / Math.max(1, alive), calls, alive };
    };
    const held = await trial(false);
    const open = await trial(true);
    assert(held.alive > 6 && open.alive > 6,
      `only ${held.alive}/${open.alive} bodies survived the two runs — the scene is not the one `
      + 'this check describes');
    const mult = open.per / Math.max(1e-6, held.per);
    assert(mult < 40,
      `a grenadier who is not going to throw one costs ${open.per.toFixed(3)} sight raycasts per `
      + `body per frame against ${held.per.toFixed(3)} with the cooldown held — ${mult.toFixed(0)}x, `
      + 'and the rifle asks the same question about once a fire cycle. A refused throw has to cost '
      + 'him the look (GRENADE_LOOK), or every frame is two raycasts and a scan of the field');
    return `${open.per.toFixed(3)} sight rays per body per frame with the gate open against `
      + `${held.per.toFixed(3)} held — ${mult.toFixed(1)}x`;
  });

  check('reactions: somebody on the field actually throws one', async () => {
    /**
     * THE FIELD THAT WAS DELETED FOR HAVING NO READER. `trooper` carried
     * `grenades: true` for its whole life with nothing in src/ reading it, and
     * the note that removed it said what it would take to earn it back. This is
     * the check that says it has been earned: the archetype declares it, the
     * brain reads it, and a body on a real field throws one at somebody.
     */
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');
    await import('../../src/game/Command.js');
    const throwers = Object.entries(ARCHETYPES).filter(([, A]) => A.grenades).map(([k]) => k);
    assert(throwers.length >= 2,
      `${throwers.length} archetypes carry grenades — both sides need one or half the army never `
      + 'has anything to react to');
    const { world, input } = await boot();
    const p = world.player;
    const at = new THREE.Vector3(p.position.x, p.position.y, p.position.z - 18);
    const g1 = world.spawnEnemy('b2', at);
    assert(g1 && g1.A.grenades, 'the B2 is not a grenadier');
    /* THE GATE IS A DECISION, NOT A TIMER: he throws when the target is behind
     * something or when there are several of them together. Two men standing
     * beside the player is the second case. */
    for (let i = 0; i < 2; i++) {
      const mate = world.spawnEnemy('trooper', new THREE.Vector3(p.position.x + 1 + i, p.position.y, p.position.z));
      if (mate) mate.team = p.team;
    }
    g1.grenadeCd = 0;
    let thrown = 0;
    for (let i = 0; i < 60 * 30 && !thrown; i++) {
      world.update(1 / 60, input);
      thrown = world.grenades.stats.thrown;
    }
    assert(thrown > 0,
      'a grenadier with a clumped enemy inside its throwing range never threw one in thirty seconds');
    return `${throwers.join(', ')} carry them; a B2 threw ${thrown} inside 30 s`;
  });

  check('reactions: none of this costs anything when there is no grenade', async () => {
    /**
     * THE BUDGET CLAUSE, and it is not a formality: `senseDanger` runs on every
     * body every frame for the whole life of the game, and the overwhelming
     * majority of those frames have no grenade in the world at all.
     *
     * IT IS COUNTED, NOT TIMED, and the first version of this check was timed —
     * a 12 ms-a-frame bound that failed at 19 to 30 ms whenever the box was
     * busy and passed at 7 when it was quiet, on identical code. That is a
     * check measuring the machine (HANDOFF §2.6): this gate runs a hundred and
     * twenty suites, several of them driving browsers, and a wall clock inside
     * one of them is a coin toss.
     *
     * What the quiet path is supposed to cost is ONE `list.length` test per
     * body per frame and nothing else. So the instrument counts the calls that
     * are not that: the nearest-threat search, which walks the field, and the
     * decision, which walks the enemy list. Both must be exactly zero with an
     * empty field, and both must be non-zero the moment a grenade is thrown —
     * or the check is passing because the system is switched off.
     */
    const { world, input } = await boot();
    const R = await import('../../src/game/Reactions.js');
    const p = world.player;
    for (let i = 0; i < 24; i++) {
      const x = p.position.x - 12 + i, z = p.position.z - 14;
      world.spawnEnemy(i % 2 ? 'b1' : 'trooper', new THREE.Vector3(x, world.terrain.height(x, z), z));
    }
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);
    assert(world.grenades.list.length === 0, 'the field is not empty, so this measures the wrong path');

    /* COUNTED THROUGH THE SHIPPED OBJECT: `nearest` is the field's own method
     * and the only way into the expensive half of `senseDanger`. */
    const real = world.grenades.nearest.bind(world.grenades);
    let searches = 0;
    world.grenades.nearest = (...a) => { searches++; return real(...a); };
    const bodies = world.enemies.filter((e) => !e.dead).length;
    const FRAMES = 120;
    for (let i = 0; i < FRAMES; i++) world.update(1 / 60, input);
    const quiet = searches;
    assert(quiet === 0,
      `${quiet} nearest-threat searches over ${FRAMES} frames with ${bodies} bodies and an empty field `
      + '— the quiet path is supposed to be one length test per body');

    /* AND THE OTHER HALF: it is zero because there is nothing there, not
     * because nothing is looking. */
    searches = 0;
    const at = new THREE.Vector3(p.position.x, p.position.y, p.position.z - 12);
    at.y = world.terrain.height(at.x, at.z);
    world.grenades.throw(at.clone().setY(at.y + 8), at, { team: 1 });
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    assert(searches > 0,
      'a live grenade on the field and not one body looked for it — the quiet path is cheap because '
      + 'the whole system is asleep');
    world.grenades.nearest = real;
    return `${bodies} bodies, ${quiet} searches over ${FRAMES} empty frames, ${searches} in the 20 `
      + 'after a grenade landed';
  });

  /* THE SECOND NOTE — "don't stop there". See _reactions2.mjs. */
  const { behaviours } = await import('./_reactions2.mjs');
  behaviours({ check, assert, squad, boot });
}
