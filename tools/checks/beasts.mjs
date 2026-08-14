/**
 * SABER — the big creatures, and whether there is anything to dodge.
 *
 * THE FIRST BUG, and it is kept here because it is what these numbers are
 * measured against. `_beastBrain`'s three attacks — sweep, lunge and charge —
 * all landed through one function:
 *
 *     if (t && t.position.distanceTo(this.position) < radius) { …hit… }
 *
 * No facing. No arc. No aim. No limb. And the radii were `6.6 * scale * 0.6`,
 * which on a 2.9-scale acklay is an 11.48 m BALL centred on an animal whose
 * preferred fighting band is 2.5–5 m and which triggers its attacks at 7.5.
 * Measured against a real player over 90-second fights: standing still, 39 of
 * 39 sweeps landed; sprinting directly away, 38 of 38; sprinting sideways, 40
 * of 40. Across three beasts and three evasions, 348 of 350 connected. There
 * was nothing to dodge, because there was no shape to be outside of.
 *
 * Two further halves of the same defect: `_poseWalker` never read `this.state`,
 * so a sweep, a lunge and a charge were all the same animal walking — no
 * wind-up on the body at all, on the one enemy whose entire answer is footwork.
 * And `recentDamage` — which opens the WINDED window, the comment for which
 * says it is "the only safe time to go for a leg" — accrued only behind
 * `if (this.A.boss)`, which is the acklay alone.
 *
 * ── THE SECOND BUG IS THE ONE THIS FILE NOW EXISTS FOR, and the first fix is
 * what exposed it. Once every attack was dodgeable, the measurement said
 * something worse than "undodgeable": it said the three creatures had ONE
 * answer between them. 0 of 108 sweeps and 0 of 94 lunges landed on a player
 * who broke sideways through the telegraph — on all three animals, because all
 * three ran the same three hard-coded attacks and the only thing that differed
 * was how much health stood between the player and the next phase. The owner's
 * note asks for "a wave of unique large creatures EACH FOUGHT DIFFERENTLY";
 * three health bars over one move set is one creature at three speeds.
 *
 * So the move set is data now (`BEAST_MOVES` in src/game/Enemy.js) and each
 * archetype names its own. WHAT IS MEASURED HERE IS THAT THE ANSWERS DIFFER:
 * four ways of evading, driven against every creature, and the property is that
 * NO ONE OF THEM ANSWERS EVERYTHING. Plus the two halves that must never stop
 * being true — a stationary player is punished by every attack in the game, and
 * every attack has a window somebody can leave.
 *
 * Nothing below reads a hard-coded list of attack names. The moves come off
 * `Enemy.beastMoves()`, which is the shipped method the brain itself uses, so a
 * creature added tomorrow is measured the day it is added rather than the day
 * somebody remembers this file has a list in it.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES, BEAST_MOVES, DEFAULT_BEAST_MOVES } from '../../src/game/Enemy.js';
import { duelRng } from '../../src/game/Duel.js';
import { buildQuadruped, QUADRUPED_KINDS } from '../../src/game/Bodies.js';
import '../../src/game/Levels.js';        // registers the Colosseum's creatures

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/** Every archetype that runs the beast brain, found rather than listed. */
const BEASTS = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].custom === 'beast');

/** The attacks a given creature can make, over its whole health bar. */
const movesOf = (type) => (ARCHETYPES[type].moves || DEFAULT_BEAST_MOVES).filter((k) => BEAST_MOVES[k]);

/**
 * THE FOUR EVASIONS, and why each is a thing a real player does.
 *
 *   stand    nothing at all. The control: not moving has to be the worst
 *            possible answer to every attack in the game, and the first fix for
 *            the dodging bug broke exactly this — a cone committed at the
 *            wind-up missed a perfectly stationary player 84% of the time,
 *            because the animal is still moving through its own wind-up.
 *   strafe   a sustained circle at fighting range, which is what a player who
 *            has learned the claw actually does — and on the shipped roster it
 *            beats every claw in the game without ever giving up a metre.
 *   dodge    break sideways on the FIRST part of the telegraph and re-engage.
 *            The textbook answer, and the one the sweep and the lunge teach.
 *   back     break straight OUT of the telegraph rather than across it. On a
 *            claw it is worth roughly what a sidestep is; on a blow centred on
 *            the animal itself it is the only thing that works.
 *
 * `dodge` and `back` both move only while an attack is on, which is what makes
 * them evasions rather than "the player left". `strafe` runs the whole fight.
 */
const EVASIONS = ['stand', 'strafe', 'dodge', 'back'];

/**
 * One beast against one target, for `seconds`, with the target evading one of
 * four ways. Returns hits and swings BROKEN DOWN BY ATTACK, because the moves
 * are supposed to have different answers and a total would hide exactly that.
 *
 * `window` overrides when a `dodge`/`back` breaks, as a fraction-free pair of
 * seconds into the attack state. It exists for one measurement and one only:
 * the pounce commits its landing point PART WAY THROUGH, so "break early" and
 * "break late" are two different answers to the same attack and the harness has
 * to be able to express both.
 */
function fight(type, mode, seconds = 90, window = [0, 0.45]) {
  enemyRng.seed(4711);
  duelRng.seed(8123);
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat();
  physics.terrain = terrain;
  const by = {};
  let cur = '', winded = 0;
  const target = {
    position: V(0, 0, 0), velocity: new THREE.Vector3(), chest: V(0, 1.3, 0),
    hp: 500, alive: true, invuln: 0, camera: { addShake() {} },
    damage() { (by[cur] = by[cur] || [0, 0])[0]++; },
  };
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    plasma: { spawn() {} }, smoke: { spawn() {} } };
  const w = {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [target], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  const e = new Enemy(w, type, V(0, 0, -14));
  e.position.set(0, 0, -14);
  w.enemies.push(e);
  const ctx = { enemies: w.enemies, particles, terrain, physics,
    bolts: w.bolts, time: 0, pickTarget: () => target, camera: w.engine.camera };
  const dt = 1 / 60;
  const attacks = movesOf(type);
  let prev = e.state;
  for (let i = 0; i < seconds / dt; i++) {
    ctx.time = w.time += dt;
    // Phase 3, so the whole move set is in the rotation. Pinned rather than
    // fought down, because this measures the attacks and not the health bar.
    e.hp = Math.min(e.hp, e.maxHp * 0.12);
    e.update(dt, ctx);
    if (e.state !== prev) {
      if (e.state === 'winded') winded++;
      if (attacks.includes(e.state)) {
        cur = e.state;
        (by[cur] = by[cur] || [0, 0])[1]++;
      }
      prev = e.state;
    }
    if (mode !== 'stand') {
      const away = new THREE.Vector3().subVectors(target.position, e.position).setY(0).normalize();
      const side = new THREE.Vector3(away.z, 0, -away.x);
      const st = e.stateTime || 0;
      const onAttack = attacks.includes(e.state) && st >= window[0] && st < window[1];
      if (mode === 'strafe') target.position.addScaledVector(side, 7.4 * dt);
      else if (onAttack) target.position.addScaledVector(mode === 'back' ? away : side, 11 * dt);
    }
    target.chest.copy(target.position).setY(1.3);
    target.hp = 500;
    physics.step(dt);
  }
  for (const x of w.enemies) x.dispose?.();
  const rate = (k) => (by[k] && by[k][1] ? by[k][0] / by[k][1] : null);
  const line = () => Object.entries(by).map(([k, v]) => `${k}${v[0]}/${v[1]}`).join(' ');
  return { by, winded, rate, line };
}

/** rate as a percentage, or a dash when the move never came out. */
const pc = (r) => (r === null ? '—' : `${Math.round(r * 100)}%`);

export async function run({ check, assert }) {
  await initPhysics();

  check('beasts: standing still is punished — every attack lands on a target that does not move', () => {
    /* The half that the first fix broke. Aiming a claw at a direction committed
     * at the wind-up made a perfectly stationary player missed 84% of the time,
     * because the animal is still MOVING through its own wind-up. Not moving
     * has to be the worst thing a player can do against a beast, and it has to
     * stay true of every attack any creature is ever given — which is why the
     * list of attacks comes off the archetype rather than out of this file. */
    const rows = [];
    for (const type of BEASTS) {
      const r = fight(type, 'stand');
      for (const k of movesOf(type)) {
        const got = r.rate(k);
        assert(got !== null, `${type} never used its ${k} in 90 seconds`);
        assert(got > 0.85,
          `${ARCHETYPES[type].label}'s ${k} landed ${pc(got)} of the time on a target `
          + 'standing perfectly still in its face — an attack you can ignore is not an attack');
      }
      rows.push(`${ARCHETYPES[type].label} ${r.line()}`);
    }
    return rows.join('; ');
  });

  check('beasts: and footwork beats the claw — the telegraph is a window you can leave', () => {
    /**
     * The bug, measured. On the tree this replaces, sprinting sideways for the
     * whole fight ate 40 of 40 sweeps, and sprinting directly away 38 of 38,
     * because the hit was an 11.5 m sphere with no direction in it.
     *
     * DERIVED FROM `aim`, not from a list of move names. A move that resolves
     * about a point the animal REMEMBERED is a move footwork answers, and that
     * is exactly what `aim: 'windup'` means. The moves that commit later — the
     * charge, the slam, the pounce — are each asserted separately below,
     * because each of them has a different answer and lumping them in here
     * would let one pass on another's evidence.
     *
     * ── WHY THIS ASKS "SOME EVASION" RATHER THAN "BOTH OF THEM".
     *
     * It asked both, and the Rancor found the reason not to. Its claw arc is
     * `1.15 x scale` = 3.91 m against the Acklay's 3.34, and a sustained circle
     * at 7.4 m/s covers 4.07 m of ARC in the 0.55 s wind-up — but the chord
     * across that arc at the radius the animal fights at is 3.96 m, and closing
     * shortens it further. Measured: 47% of the brute's sweeps land on a player
     * who ambles round it, and 0% on one who actually breaks. That is not a
     * defect, it is a 3.4-scale animal with a longer reach than anything else
     * on the sand, and writing an exemption for it would have been a check
     * bending round the content it is supposed to be measuring.
     *
     * So the property is the one that was always meant: EVERY remembered-point
     * attack has an evasion that opens it, and which evasion that is belongs to
     * the creature. The roster-level half — that no single evasion opens them
     * all — is the check four below, and the pair of them is what "each fought
     * differently" means in numbers.
     */
    const rows = [];
    let tested = 0;
    const runs = {};
    for (const mode of ['strafe', 'dodge', 'back']) {
      for (const type of BEASTS) runs[`${type}/${mode}`] = fight(type, mode);
    }
    for (const type of BEASTS) {
      for (const k of movesOf(type)) {
        if (BEAST_MOVES[k].aim !== 'windup') continue;
        const got = ['strafe', 'dodge', 'back']
          .map((m) => ({ m, r: runs[`${type}/${m}`].rate(k) }))
          .filter((x) => x.r !== null);
        if (!got.length) continue;
        tested++;
        const best = got.reduce((a, b) => (b.r < a.r ? b : a));
        assert(best.r < 0.35,
          `${ARCHETYPES[type].label}'s ${k} lands on a player however they move — `
          + got.map((x) => `${x.m} ${pc(x.r)}`).join(', ')
          + '. A remembered-point attack with no escape is the 11.5 m sphere again');
        rows.push(`${type}.${k} escaped by ${best.m} (${pc(best.r)}), worst ${pc(Math.max(...got.map((x) => x.r)))}`);
      }
    }
    assert(tested >= 8, `only ${tested} remembered-point attacks measured — the aim field has stopped being read`);
    return rows.join('; ');
  });

  check('beasts: the charge is the answer to a runner, and still connects', () => {
    /* Without this the previous check has a trivial solution — make every
     * attack miss — and the fix would have swapped an undodgeable beast for a
     * harmless one. The charge commits its aim when its drive begins rather
     * than at the top of the wind-up, which is what lets it catch someone who
     * has been running since the telegraph. */
    const rows = [];
    for (const type of BEASTS) {
      if (!movesOf(type).includes('charge')) continue;
      const r = fight(type, 'strafe');
      const got = r.rate('charge');
      assert(got !== null, `${type} never charged`);
      assert(got > 0.6,
        `${ARCHETYPES[type].label}'s charge caught a sprinting player only ${pc(got)} of `
        + 'the time — there is then no answer to running away');
      rows.push(`${ARCHETYPES[type].label} ${pc(got)}`);
    }
    assert(rows.length >= 3, `only ${rows.length} creatures still carry the charge`);
    return `charges landing on a sprinting player: ${rows.join(', ')}`;
  });

  check('beasts: the slam is answered by DISTANCE and by nothing else', () => {
    /**
     * THE POINT OF THE WHOLE PASS, in one measurement.
     *
     * Every attack the game shipped with resolves about a point the animal
     * remembered, so every one of them is answered by the same verb: be
     * somewhere else. Measured on the shipped three, a sustained circle at
     * fighting range took 0 of 108 sweeps and 0 of 94 lunges — which means a
     * player who has learned to circle has learned every large creature in the
     * game, and a second creature on the sand asks nothing new.
     *
     * `aim: 'self'` centres the footprint on the ANIMAL at the moment of
     * impact. A sidestep inside that ring is worth nothing; the ring is 2.05
     * times the creature's scale, which is wider than the band it fights at, so
     * the only answer is to leave. This asserts both halves, because either one
     * alone is trivially satisfiable: the circle must FAIL and the retreat must
     * WORK.
     */
    const slammers = BEASTS.filter((t) => movesOf(t).includes('slam'));
    assert(slammers.length >= 1, 'nothing in the game slams');
    const rows = [];
    for (const type of slammers) {
      const circling = fight(type, 'strafe').rate('slam');
      const breaking = fight(type, 'back').rate('slam');
      assert(circling !== null && breaking !== null, `${type} never slammed`);
      assert(circling > 0.7,
        `${ARCHETYPES[type].label}'s slam missed ${pc(1 - circling)} of a player circling at knife `
        + 'range — then it is just another claw and the creature has no answer of its own');
      assert(breaking < 0.3,
        `${ARCHETYPES[type].label}'s slam still landed ${pc(breaking)} of the time on a player who `
        + 'broke straight out of the ring — a blow with no escape is not an attack, it is a tax');
      rows.push(`${ARCHETYPES[type].label} circling ${pc(circling)} / retreating ${pc(breaking)}`);
    }
    return rows.join('; ');
  });

  check('beasts: the pounce is answered by breaking LATE, and punishes breaking early', () => {
    /**
     * The other new answer, and it inverts WHEN rather than WHERE.
     *
     * `aim: 'launch'` re-reads the target until the animal leaves the ground at
     * 0.55 s and does not land until 0.95, so the 0.4 s at the END of the
     * telegraph is the whole window. A player who breaks on the first frame —
     * which is precisely what the sweep and the lunge train them to do — has
     * been standing still again for a tenth of a second by the time the aim is
     * taken, and gets landed on.
     *
     * Both halves again, and the two runs differ ONLY in when the break
     * happens: same creature, same evasion, same speed, [0, 0.45] against
     * [0.55, 1.1].
     */
    const pouncers = BEASTS.filter((t) => movesOf(t).includes('pounce'));
    assert(pouncers.length >= 1, 'nothing in the game pounces');
    const rows = [];
    for (const type of pouncers) {
      const early = fight(type, 'dodge', 90, [0, 0.45]).rate('pounce');
      const late = fight(type, 'dodge', 90, [0.55, 1.1]).rate('pounce');
      assert(early !== null && late !== null, `${type} never pounced`);
      assert(early > 0.7,
        `${ARCHETYPES[type].label}'s pounce missed ${pc(1 - early)} of a player who broke on the `
        + 'first frame of the telegraph — then it is a claw with a longer wind-up');
      assert(late < 0.3,
        `${ARCHETYPES[type].label}'s pounce landed ${pc(late)} of the time on a player who broke `
        + 'as it left the ground — there is then nothing to read and nothing to answer');
      rows.push(`${ARCHETYPES[type].label} early ${pc(early)} / late ${pc(late)}`);
    }
    return rows.join('; ');
  });

  check('beasts: no one evasion answers the whole menagerie', () => {
    /**
     * The claim the owner's note actually makes — "each fought differently" —
     * asked of the roster as a whole rather than of any one animal. The failure
     * mode this is written against is not "a creature is undodgeable", it is a
     * roster of creatures that are all dodged the same way, which is what
     * shipped and which no per-creature check can see.
     *
     * For every one of the four evasions there has to be at least one attack
     * somewhere in the menagerie that it does NOT answer. Note that `stand` is
     * in the list and is covered by the first check in this file; it is here
     * too because the property is about the table, and a table with a column
     * that answers everything is the defect whatever that column is.
     */
    const grid = {};
    const beaten = {};
    for (const mode of EVASIONS) {
      const punished = [];
      for (const type of BEASTS) {
        const r = fight(type, mode, 60);
        for (const k of movesOf(type)) {
          const got = r.rate(k);
          if (got === null) continue;
          (grid[mode] = grid[mode] || []).push(`${type}.${k} ${pc(got)}`);
          if (got > 0.6) punished.push(`${type}.${k}`);
        }
      }
      beaten[mode] = punished;
      assert(punished.length > 0,
        `evading by "${mode}" answers every attack every creature in the game has — `
        + 'then the menagerie is one fight wearing five skins');
    }
    /* …and the converse, so this cannot be satisfied by making everything
     * undodgeable: every creature has to have at least one attack that at least
     * one evasion beats. */
    for (const type of BEASTS) {
      let escapable = 0;
      for (const mode of EVASIONS) {
        if (mode === 'stand') continue;
        const r = fight(type, mode, 60);
        for (const k of movesOf(type)) { const g = r.rate(k); if (g !== null && g < 0.35) escapable++; }
      }
      assert(escapable > 0, `nothing a player can do avoids anything ${ARCHETYPES[type].label} does`);
    }
    return EVASIONS.map((m) => `${m} is beaten by ${beaten[m].length} attack(s): ${beaten[m].join(', ')}`).join('; ');
  });

  check('beasts: every beast can be winded, and a severed limb is what does it', async () => {
    /**
     * `recentDamage` accrued only inside `if (this.A.boss)`, and of the beasts
     * only the acklay carries `boss` — so the others could not accumulate a
     * single point of it and `winded` fired 0 times in nine 90-second fights.
     * And `takeCut` subtracts from `hp` directly rather than calling
     * `damage()`, so cutting a leg off — the thing the winded comment says the
     * window exists FOR — accrued nothing on any of them.
     */
    for (const type of BEASTS) {
      const A = ARCHETYPES[type];
      assert(A.custom === 'beast', `${type} is not a beast any more`);
    }
    const src = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8'));
    const gate = /if \(this\.A\.boss \|\| this\.A\.custom === 'beast'\) this\.recentDamage/g;
    const n = (src.match(gate) || []).length;
    assert(n >= 2,
      `only ${n} of the two damage paths accrue the winded meter for a beast — it is gated on `
      + '`boss` again, which is one of the five, or `takeCut` has stopped feeding it');
    return `all ${BEASTS.length} beasts accrue the winded meter from both damage and cuts`;
  });

  check('beasts: the body reads the attack it is about to make', () => {
    /**
     * `_poseWalker` never looked at `this.state`: it was a walk cycle and a head
     * track, so a sweep, a lunge and a charge were the same animal walking. The
     * only cue any of the three had was a sound. A wind-up nobody can see is
     * not a telegraph, and this is the enemy whose entire answer is footwork.
     *
     * THIS USED TO BE A GREP, and that was the wrong instrument twice over: it
     * looked for the four state names as string literals inside the function's
     * source, so it passed on a `_poseWalker` that mentioned them and did
     * nothing, and it failed the moment the three curves were derived from one
     * table instead of written out — which is a REFACTOR, not a regression.
     *
     * What is measured now is the chest: the real rig, posed by the real
     * function, sampled through each attack's own wind-up. Every move has to
     * move the body by a readable amount before its blow lands, and the moves
     * have to be told APART by that motion — two attacks with the same wind-up
     * are one telegraph and the player cannot know which is coming.
     */
    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
    const terrain = flat();
    physics.terrain = terrain;
    const particles = { sandPuff() {}, sparkBurst() {}, cutFlare() {}, slag() {}, plasma: { spawn() {} } };
    const w = {
      scene: new THREE.Scene(), physics, terrain, statics: [], settings: { fov: 60 },
      players: [], enemies: [], props: [], particles, time: 0, groundColor: 0xcfae82,
      bolts: { fire() {} }, engine: { flash() {}, camera: new THREE.PerspectiveCamera() },
      report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    };
    const ctx = { enemies: [], particles, terrain, physics, bolts: w.bolts, time: 0,
      pickTarget: () => null, camera: w.engine.camera };

    const rows = [];
    for (const type of BEASTS) {
      enemyRng.seed(99);
      const e = new Enemy(w, type, V(0, 0, 0));
      const hips = e.rig?.hipsBone?.obj;
      assert(hips, `${type} has no hips to pose`);
      const sig = {};
      for (const k of movesOf(type)) {
        const M = BEAST_MOVES[k];
        // Drive the real pose through the real state, sampling the chest height
        // and pitch at ten points across the wind-up.
        const track = [];
        for (let i = 0; i <= 10; i++) {
          e.state = k;
          e.stateTime = (i / 10) * M.hit[0];
          e._poseWalker(1 / 60, ctx);
          track.push(hips.position.y);
        }
        const rest = track[0];
        const travel = Math.max(...track.map((y) => Math.abs(y - rest)));
        assert(travel > 0.12,
          `${ARCHETYPES[type].label}'s ${k} moves the chest ${(travel * 1000).toFixed(0)} mm through its `
          + 'whole wind-up — that is not a telegraph, it is the same animal walking');
        sig[k] = track.map((y) => y - rest);
      }
      // …and no two of this creature's attacks may look the same on the way in.
      const keys = Object.keys(sig);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = sig[keys[i]], b = sig[keys[j]];
          let diff = 0;
          for (let n2 = 0; n2 < a.length; n2++) diff = Math.max(diff, Math.abs(a[n2] - b[n2]));
          assert(diff > 0.08,
            `${ARCHETYPES[type].label}'s ${keys[i]} and ${keys[j]} wind up identically `
            + `(${(diff * 1000).toFixed(0)} mm apart at their widest) — one telegraph, two attacks`);
        }
      }
      rows.push(`${ARCHETYPES[type].label} ${keys.length}`);
      e.dispose?.();
    }
    return `${rows.join(', ')} attacks, each with its own readable wind-up`;
  });

  check('beasts: four kinds out of one builder are four animals', () => {
    /**
     * `buildQuadruped` was `const heavy = opts.kind !== 'stalker'` and
     * twenty-three `heavy ? a : b` expressions — a builder that could express
     * exactly two animals, where a third meant a third branch on every one of
     * those lines. It is a table now, and the risk a table carries is the
     * opposite one: four rows that are the same animal with different numbers.
     *
     * Measured off the built vertices rather than off the table: the bounding
     * proportions of the four have to differ, and no two may share a
     * fingerprint. `beast` is deliberately not here — the acklay has its own
     * six-legged builder and is not a row of this table.
     */
    const kinds = Object.keys(QUADRUPED_KINDS);
    assert(kinds.length >= 4, `only ${kinds.length} kinds in the table`);
    const seen = new Map();
    const rows = [];
    for (const kind of kinds) {
      const built = buildQuadruped({ scale: 2.4, kind });
      built.rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      let h = 2166136261 >>> 0, verts = 0;
      built.rig.root.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        o.updateMatrixWorld(true);
        box.expandByObject(o);
        const a = o.geometry.attributes.position;
        verts += a.count;
        for (let i = 0; i < a.count * 3; i++) {
          const q = Math.round(a.array[i] * 10000) | 0; h ^= q; h = Math.imul(h, 16777619) >>> 0;
        }
      });
      const key = `${verts}:${h.toString(16)}`;
      assert(!seen.has(key), `${kind} builds exactly the same geometry as ${seen.get(key)}`);
      seen.set(key, kind);
      const s = box.getSize(new THREE.Vector3());
      rows.push({ kind, verts, len: s.z, wide: s.x, tall: s.y });
    }
    // and they are not one animal at four sizes: the length-to-height ratio,
    // which is what the eye reads as "long and low" against "tall and heavy",
    // has to actually spread.
    const ratio = rows.map((r) => r.len / r.tall);
    assert(Math.max(...ratio) > Math.min(...ratio) * 1.35,
      `every kind is ${ratio.map((v) => v.toFixed(2)).join('/')} long for its height — `
      + 'that is one animal at four scales');
    return rows.map((r) => `${r.kind} ${r.verts}v ${r.len.toFixed(1)}x${r.tall.toFixed(1)} m`).join(', ');
  });
}
