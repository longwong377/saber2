/**
 * BATTLEFRONT BORZ — the big creatures, and whether there is anything to dodge.
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
import { Enemy, enemyRng, ARCHETYPES, BEAST_MOVES, beastMoveSet, guardFor, TURNED_CUT }
  from '../../src/game/Enemy.js';
import { duelRng } from '../../src/game/Duel.js';
import { buildQuadruped, CREATURE_PLANS } from '../../src/game/Bodies.js';
import '../../src/game/Levels.js';        // registers the Colosseum's creatures

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Scratch for the circling target's radius. One vector, not one per frame. */
const _rad = new THREE.Vector3();
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/** Every archetype that runs the beast brain, found rather than listed. */
const BEASTS = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].custom === 'beast');

/**
 * The attacks a given creature can make, over its whole health bar.
 *
 * THIS USED TO BE `(ARCHETYPES[type].moves || DEFAULT_BEAST_MOVES)`, which is
 * HANDOFF §2.4 exactly: a rule restated inside the instrument that measures
 * it. The shipped resolution now has a second source — a creature that
 * declares no move set takes the verbs its BODY PLAN affords (see
 * `beastMoveSet`, and CREATURE_PLANS in src/game/Bodies.js) — and this line
 * would have gone on measuring the move sets the reek, the nexu and the
 * acklay used to share, reporting them as unchanged while the game shipped
 * something else. It calls the resolver now, against a real built body, which
 * is the same answer `Enemy.beastMoves` gets.
 */
const _built = new Map();
const movesOf = (type) => {
  if (!_built.has(type)) _built.set(type, ARCHETYPES[type].build({ scale: ARCHETYPES[type].scale }));
  return beastMoveSet(ARCHETYPES[type], _built.get(type)).filter((k) => BEAST_MOVES[k]);
};

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
  let cur = '', winded = 0, dealt = 0;
  const target = {
    position: V(0, 0, 0), velocity: new THREE.Vector3(), chest: V(0, 1.3, 0),
    hp: 500, alive: true, invuln: 0, camera: { addShake() {} },
    /* The AMOUNT is kept as well as the count, and it is not decoration: the
     * roster now contains bodies that run this brain and declare no verbs at
     * all, and for those the only measurable statement is how much health they
     * took off a player who stood still — see the menagerie check, which
     * asserts that it is zero to the last decimal. */
    damage(n) { (by[cur] = by[cur] || [0, 0])[0]++; dealt += n || 0; },
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
      /**
       * ── THE CIRCLE WAS A SPIRAL, AND ON A SMALL ANIMAL IT WAS THE WHOLE
       *    MEASUREMENT ────────────────────────────────────────────────────
       *
       * This was one line — `addScaledVector(side, 7.4 * dt)` — and `side` is
       * re-derived every frame, so the target walks a POLYGON round the animal
       * rather than a circle: each frame it steps along the tangent and nothing
       * ever puts it back on its radius. A tangent step of `v·dt` off a radius
       * `r` lands at `sqrt(r² + (v dt)²)`, so the radius grows by `v²dt²/2r`
       * every frame, which over a wind-up of `T` seconds is
       *
       *       Δr  =  T · v² · dt / (2r)
       *
       * and that is proportional to the HARNESS'S OWN TIMESTEP. An evasion
       * whose effectiveness halves when the check runs at 120 Hz is not an
       * evasion, it is a discretisation error wearing the name of one.
       *
       * It went unnoticed because it is invisible at the radius the shipped
       * creatures fight at and it is everything at the radius a companion-sized
       * one does. Measured, over the slam's 0.95 s wind-up: on the Rancor
       * (circling radius 3.16 m) Δr is 0.14 m against a 6.97 m footprint — 2%,
       * noise. On a 0.55-scale body fought at 0.77 m it is 0.56 m against a
       * 1.13 m footprint — HALF THE RING. The drift falls as 1/r while the ring
       * it has to stay inside rises with the animal, so "a sustained circle at
       * fighting range" was a circle on a big animal and a walk-out on a small
       * one, and the slam check below was reading the harness rather than the
       * move: the target's median distance over the fight was 0.83 m and its
       * median distance AT THE MOMENT the slam resolved was 0.99 m, topping out
       * at 1.59 m. It was not circling. It had left.
       *
       * The radius is restored after the tangential step, which is what the
       * mode's own description at the top of this file has always claimed it
       * was — "a sustained circle at fighting range". Measured cost to the
       * shipped roster, every rate over 90 s: Rancor slam 93%→100%, Rancor
       * sweep 47%→33%, Wampa pounce 13%→33%, Reek charge 0%→5%, Reek gore
       * 8%→17%, everything else unmoved. No check's verdict changes; the two
       * that were nearly saturated stop being nearly saturated.
       */
      if (mode === 'strafe') {
        const r0 = _rad.subVectors(target.position, e.position).setY(0).length();
        target.position.addScaledVector(side, 7.4 * dt);
        _rad.subVectors(target.position, e.position).setY(0);
        if (_rad.lengthSq() > 1e-9) target.position.copy(e.position).addScaledVector(_rad.normalize(), r0);
      } else if (onAttack) target.position.addScaledVector(mode === 'back' ? away : side, 11 * dt);
    }
    target.chest.copy(target.position).setY(1.3);
    target.hp = 500;
    physics.step(dt);
  }
  for (const x of w.enemies) x.dispose?.();
  const rate = (k) => (by[k] && by[k][1] ? by[k][0] / by[k][1] : null);
  const line = () => Object.entries(by).map(([k, v]) => `${k}${v[0]}/${v[1]}`).join(' ');
  return { by, winded, dealt, rate, line };
}

/** rate as a percentage, or a dash when the move never came out. */
const pc = (r) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/**
 * One real body in a real world, standing still, for the cut tests below.
 *
 * Everything the guard does happens inside `takeCut`, which severs through
 * `this.actor` — so a stub with a `capsules()` on it is not enough and the body
 * has to be genuinely built. Same world shape `fight()` uses.
 */
function bench(type) {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat();
  physics.terrain = terrain;
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    spatter() {}, plasma: { spawn() {} }, smoke: { spawn() {} } };
  const w = {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  const e = new Enemy(w, type, V(0, 0, -6));
  w.enemies.push(e);
  const ctx = { enemies: w.enemies, particles, terrain, physics,
    bolts: w.bolts, time: 0, pickTarget: () => null, camera: w.engine.camera };
  e.update(1 / 60, ctx);
  return { w, e, ctx, physics };
}

/**
 * A cut event of the shape `BladeContactSolver` emits, aimed at one capsule of
 * a real body. Read off `Enemy.capsules()` so the vital and the toughness are
 * the game's own rather than typed here.
 */
function cutAt(e, pick) {
  const caps = e.capsules();
  const cap = caps.find((c) => pick.test(c.name)) || caps[0];
  return { bone: cap.name, cap, cutT: 0.5,
    point: e.position.clone().setY(1), impulse: new THREE.Vector3(0, 0, -1) };
}

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
    /**
     * Without this the previous check has a trivial solution — make every
     * attack miss — and the fix would have swapped an undodgeable beast for a
     * harmless one. The charge commits its aim when its DRIVE begins rather
     * than at the top of the wind-up, which is what lets it catch someone who
     * has been running since the telegraph.
     *
     * ── WHAT THIS USED TO ASK, AND WHY THAT WAS THE WRONG QUESTION.
     *
     * It asked for `> 0.6` against `strafe` — a player circling at 7.4 m/s for
     * the WHOLE fight — and the charge scored 100%, because it re-aimed and
     * resolved on the same frame: `aimUntil: 0.65` beside `hit: [0.65, …]` is a
     * zero-second window, and no movement at any speed can be outside a
     * remembered point that is fixed as the blow lands. Measured against a
     * target breaking away on the first frame of the wind-up, the charge landed
     * 100% at 0, 4.6, 7.45, 11, 15.5, 22 and 30 m/s. So this check was passing
     * on the strength of a defect: the evidence it accepted for "the charge
     * answers a runner" was that the charge answers EVERYTHING, which is the
     * 11.5 m sphere the file above it exists to have removed.
     *
     * The move keeps its property and loses that. It resolves half a second
     * after it commits now, so a player who breaks WHEN THE DRIVE BEGINS gets
     * out — and a player who broke early and stopped, which is what `dodge`
     * does (it moves only through the first 0.45 s of the attack), is caught
     * exactly as before, because the re-aim followed them. That is the real
     * statement of "it is the answer to a runner": it beats the habit that
     * beats a claw. `tools/checks/dodgeable.mjs` holds the other half — that
     * the window it now has is one a walking player can actually use.
     */
    const rows = [];
    for (const type of BEASTS) {
      if (!movesOf(type).includes('charge')) continue;
      const early = fight(type, 'dodge').rate('charge');            // breaks, then stops
      // …and one that is still going when the drive begins. The default window
      // stops at 0.45 s, which is BEFORE the charge commits at 0.65 — so this
      // one has to be told to keep moving, or both conditions are early breaks.
      const late = fight(type, 'back', 90, [0, 9]).rate('charge');
      assert(early !== null, `${type} never charged`);
      assert(early > 0.6,
        `${ARCHETYPES[type].label}'s charge caught a player who broke early and stopped only `
        + `${pc(early)} of the time — the re-aim has stopped following, and there is then no `
        + 'answer to running away');
      assert(late === null || late < 0.35,
        `${ARCHETYPES[type].label}'s charge landed ${pc(late)} on a player who was still moving when `
        + 'it committed — it is unanswerable again, which is what the zero-second window was');
      rows.push(`${ARCHETYPES[type].label} early ${pc(early)} / sustained ${pc(late)}`);
    }
    assert(rows.length >= 3, `only ${rows.length} creatures still carry the charge`);
    return `charges: ${rows.join(', ')}`;
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
    /**
     * …AND THE FAILURE SETS MUST DIFFER, which is the assertion above with its
     * loophole closed.
     *
     * "Every evasion is beaten by something" is satisfied by ONE undodgeable
     * attack existing anywhere in the roster — the charge is beaten by nothing
     * at all, so that assertion passes on the charge alone whatever else the
     * menagerie does. Proved by reverting: taking the slam's own aim away and
     * making it an ordinary claw left the check green.
     *
     * What actually says "each fought differently" is that the evasions fail on
     * DIFFERENT things: circling gets caught by the slam and walks away from
     * the pounce, retreating gets caught by the pounce and walks out of the
     * slam. Two evasions with identical failure sets are two names for one
     * habit, and a menagerie where every evasion fails on the same list is a
     * menagerie with one answer plus one attack nobody can answer.
     */
    const moving = EVASIONS.filter((m) => m !== 'stand');
    for (let i = 0; i < moving.length; i++) {
      for (let j = i + 1; j < moving.length; j++) {
        const a = beaten[moving[i]].slice().sort().join(','), b = beaten[moving[j]].slice().sort().join(',');
        assert(a !== b,
          `"${moving[i]}" and "${moving[j]}" are caught by exactly the same attacks (${a || 'none'}) — `
          + 'they are two names for one habit, so the roster asks one question');
      }
    }
    /* …and the converse, so this cannot be satisfied by making everything
     * undodgeable: every creature has to have at least one attack that at least
     * one evasion beats. */
    /**
     * ── AND A CREATURE WITH NO ATTACKS IS ASKED THE STRONGER QUESTION ──────
     *
     * This loop said "some evasion has to beat something this animal does" and
     * ran it over every body on the beast brain. The roster now contains two
     * that do NOTHING — the tooka kit and the tauntaun, both `moves: []` in
     * CREATURE_PLANS, both deliberately — and for those `movesOf` is empty, so
     * `escapable` could never leave zero and the message read "nothing a player
     * can do avoids anything Tooka Kit does". That is a true sentence about an
     * animal with nothing to avoid, and it is the wrong question: there is no
     * evasion to find because there is no attack. (The tauntaun was failing it
     * too and had been for as long as the tooka; it is later in the loop, so
     * the throw hid it. Same defect, twice, one fix.)
     *
     * THE PREMISE WAS CHECKED BEFORE IT WAS ACTED ON, and it is only half
     * true, so the assertion below is written against the half that holds.
     * `beastMoveSet` does return `[]` for both. But `_beastBrain`'s pick is
     * `moves[floor(rng() * moves.length)] || 'lunge'`, and an empty list falls
     * straight through that `||`: measured over 90 s, a tooka entered the
     * `lunge` state 49 times and called `damage()` on a motionless target 48
     * times. CREATURE_PLANS.tooka's own note claims a line in Enemy.js stands
     * between this row and a kitten that mauls people. There is no such line.
     * What there is is `damage: 0` on the archetype, and it is enough: those 48
     * resolutions moved the target's health by 0.0 exactly.
     *
     * So the exemption asserts MORE than the clause it replaces, not less. A
     * creature that declares no verbs has to declare none — and has to take
     * nothing off a player who stands in its face for a full fight, in every
     * evasion including standing still. "Some evasion answers it" is a claim
     * about getting away; this is the claim that there is nothing to get away
     * from, and it goes red the day anybody gives one of them a damage number.
     * Keyed on the empty move set and never on a label, so the next silent
     * animal is covered the day it lands.
     */
    for (const type of BEASTS) {
      const mine = movesOf(type);
      if (!mine.length) {
        for (const mode of EVASIONS) {
          const r = fight(type, mode, 60);
          assert(r.dealt === 0,
            `${ARCHETYPES[type].label} declares no attacks and still took ${r.dealt.toFixed(1)} health `
            + `off a player who ${mode === 'stand' ? 'stood perfectly still' : `evaded by "${mode}"`} `
            + '— an animal with no verbs must not have a way to hurt anybody');
        }
        continue;
      }
      let escapable = 0;
      for (const mode of EVASIONS) {
        if (mode === 'stand') continue;
        const r = fight(type, mode, 60);
        for (const k of mine) { const g = r.rate(k); if (g !== null && g < 0.35) escapable++; }
      }
      assert(escapable > 0, `nothing a player can do avoids anything ${ARCHETYPES[type].label} does`);
    }
    const silent = BEASTS.filter((t) => !movesOf(t).length).map((t) => ARCHETYPES[t].label);
    return EVASIONS.map((m) => `${m} is beaten by ${beaten[m].length} attack(s): ${beaten[m].join(', ')}`).join('; ')
      + (silent.length ? `; ${silent.join(' and ')} declare no attacks and deal 0 damage in all four` : '');
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
    /**
     * ── AND IT IS MEASURED NOW RATHER THAN GREPPED.
     *
     * This used to scan Enemy.js for the literal string `if (this.A.boss ||
     * this.A.custom === 'beast') this.recentDamage` and count two of them —
     * which is the mistake its neighbour four checks down already names in as
     * many words ("THIS USED TO BE A GREP, and that was the wrong instrument
     * twice over… it failed the moment the three curves were derived from one
     * table instead of written out, which is a REFACTOR, not a regression").
     * It failed exactly that way: the predicate was lifted into `keepsWind(A)`
     * so that the three write sites and the reader cannot disagree about who
     * keeps a tally, the behaviour was unchanged and strictly better organised,
     * and the check went red over the spelling.
     *
     * What is measured is the property: a real body of every beast type, hit
     * through `damage()` and then cut through `takeCut()`, has to accrue on
     * both paths. That is true of any spelling and false of any regression.
     */
    const rows = [];
    for (const type of BEASTS) {
      const A = ARCHETYPES[type];
      assert(A.custom === 'beast', `${type} is not a beast any more`);
      const { e } = bench(type);
      e.recentDamage = 0;
      e.damage(e.maxHp * 0.05, e.position.clone(), null, 'melee');
      const byBlow = e.recentDamage;
      assert(byBlow > 0,
        `${A.label} took a blow worth 5% of its health and its winded meter did not move — `
        + '`damage()` has stopped feeding it, so the window can never open');
      e.recentDamage = 0;
      e.guard = 0;                       // the hide is measured elsewhere
      const caps = e.capsules();
      const cap = caps.find((c) => /femur|tibia|thigh|hip/i.test(c.name)) || caps[0];
      e.takeCut({ bone: cap.name, cap, cutT: 0.5, point: e.position.clone().setY(1),
        impulse: new THREE.Vector3(0, 0, -1) }, null);
      assert(e.recentDamage > 0,
        `${A.label} lost a limb and its winded meter did not move — takeCut subtracts from hp `
        + 'directly, and severing a limb is the thing the window exists for');
      rows.push(`${type} blow ${byBlow.toFixed(0)} cut ${e.recentDamage.toFixed(0)}`);
      e.dispose?.();
    }
    return `all ${BEASTS.length} beasts accrue the winded meter from both damage and cuts — ${rows.join(', ')}`;
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
     * What is measured now is the HIPS: the real rig, posed by the real
     * function, sampled through each attack's own wind-up. (It said "the chest"
     * and read `hipsBone`. The hips are the right bone and the word was the
     * wrong one — `_poseWalker` spends a move's `rise` as `ST.rear * rise` on
     * the hips and every leg follows it through the IK, and the chest is that
     * same motion plus a pitch that partly cancels it: measured on the whole
     * roster, the chest's travel is smaller than the hips' on nine of eleven
     * bodies and the Acklay's stab reads 6.1% of its stance at the chest
     * against 8.8% at the hips. Measuring the smaller number and calling it the
     * bigger one is how a bar gets set wrong.)
     *
     * Every move has to move the body by a readable amount before its blow
     * lands, and the moves have to be told APART by that motion — two attacks
     * with the same wind-up are one telegraph and the player cannot know which
     * is coming.
     *
     * ── AND BOTH BARS ARE A FRACTION OF THE ANIMAL, NOT A NUMBER OF MILLIMETRES
     *
     * They were `travel > 0.12` and `diff > 0.08` — absolute metres, applied
     * from a 0.11 m-hipped tooka to a 4.59 m-hipped Acklay. That is the error
     * this tree already refuses twice by name: HANDOFF's "POINTS ARE NOT
     * COMPARABLE ACROSS AXES", and BEAST_MOVES' own decision to write every
     * `reach` as a multiple of the creature's scale "so they are the animal's
     * own reach rather than a number nobody can place". A telegraph is read
     * against the body doing it. 120 mm on the Acklay is 2.6% of its stance —
     * free. 120 mm on the shipped Massiff is 31% of its stance, which no animal
     * in the game manages for its cheapest move, and the Massiff was FAILING
     * this bar at 118 mm and 97 mm. It only looked green because it is eighth
     * in the loop and the Rancor Pup is fifth, so the throw came first. A bar
     * that condemns a shipped companion and waves through the biggest animal on
     * the sand is measuring size, not legibility.
     *
     * Measured across the roster, as a fraction of each animal's own standing
     * hip height (its stance — the height `_poseWalker` rears FROM):
     *
     *   cheapest move    Acklay stab 8.8% · Blurrg lunge 12.5% · Varactyl
     *                    sweep 15.2% · Rancor lunge 18.9% · Nexu rake 23.7% ·
     *                    Rancor Pup lunge 25.1% · Massiff rake 25.5% ·
     *                    Tuk'ata rake 25.6% · Wampa lunge 28.8% · Reek 33.2%
     *   closest pair     Rancor slam/sweep 16.5% · Acklay stab/sweep 16.7% ·
     *                    Massiff lunge/rake 24.1% · Wampa 28.2% · Nexu 28.6%
     *
     * So the floor the shipped roster actually holds is 8.8% for a single move
     * and 16.5% for a pair, and the Pup's 102 mm lunge — the thing that threw
     * — is 25.1% of its own stance, more than the adult Rancor's own lunge at
     * 18.9%. It was never the smaller telegraph. It is the smaller animal.
     *
     * The bars are 7% and 12%, under each floor with room for a re-tune and
     * nowhere near enough for a regression to hide in. They are STRICTER than
     * what they replace everywhere it matters: the Acklay's stab now has to
     * clear 0.32 m rather than 0.12 (2.7x), its closest pair 0.55 m rather than
     * 0.08 (6.9x), and the Rancor's slam and sweep 0.36 m rather than 0.08.
     * They are looser only on the small bodies, which is the correction.
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
      /* THE ANIMAL'S OWN STANCE, and it is read off the posed rig rather than
       * off `CREATURE_PLANS[kind].hip * scale`, which is the same number said
       * twice — HANDOFF §2.4. `approach` is the rest state, so this is where
       * the hips sit when nothing is winding up. */
      e.state = 'approach';
      e.stateTime = 0;
      e._poseWalker(1 / 60, ctx);
      const stance = hips.position.y;
      assert(stance > 0.02, `${type} stands ${(stance * 1000).toFixed(0)} mm at the hip — nothing to read against`);
      const sig = {};
      for (const k of movesOf(type)) {
        const M = BEAST_MOVES[k];
        // Drive the real pose through the real state, sampling the hip height
        // at ten points across the wind-up.
        const track = [];
        for (let i = 0; i <= 10; i++) {
          e.state = k;
          e.stateTime = (i / 10) * M.hit[0];
          e._poseWalker(1 / 60, ctx);
          track.push(hips.position.y);
        }
        const rest = track[0];
        const travel = Math.max(...track.map((y) => Math.abs(y - rest)));
        assert(travel > 0.07 * stance,
          `${ARCHETYPES[type].label}'s ${k} moves the body ${(travel * 1000).toFixed(0)} mm through its `
          + `whole wind-up — ${(100 * travel / stance).toFixed(1)}% of its own ${(stance * 1000).toFixed(0)} mm `
          + 'stance, which is not a telegraph, it is the same animal walking');
        sig[k] = track.map((y) => y - rest);
      }
      // …and no two of this creature's attacks may look the same on the way in.
      const keys = Object.keys(sig);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = sig[keys[i]], b = sig[keys[j]];
          let diff = 0;
          for (let n2 = 0; n2 < a.length; n2++) diff = Math.max(diff, Math.abs(a[n2] - b[n2]));
          assert(diff > 0.12 * stance,
            `${ARCHETYPES[type].label}'s ${keys[i]} and ${keys[j]} wind up identically `
            + `(${(diff * 1000).toFixed(0)} mm apart at their widest, ${(100 * diff / stance).toFixed(1)}% of `
            + 'its own stance) — one telegraph, two attacks');
        }
      }
      rows.push(`${ARCHETYPES[type].label} ${keys.length}`);
      e.dispose?.();
    }
    return `${rows.join(', ')} attacks, each with its own readable wind-up`;
  });

  check('beasts: five plans out of one builder are five animals', () => {
    /**
     * `buildQuadruped` was `const heavy = opts.kind !== 'stalker'` and
     * twenty-three `heavy ? a : b` expressions — a builder that could express
     * exactly two animals, where a third meant a third branch on every one of
     * those lines. It is a table now, and the risk a table carries is the
     * opposite one: rows that are the same animal with different numbers,
     * which is precisely what the player reported ("sphere with some legs").
     *
     * Measured off the built vertices rather than off the table: the bounding
     * proportions have to differ, and no two may share a fingerprint. The
     * acklay IS a row now — it is the six-legged plan, built by the same
     * function off the same table, which is what makes "no two share a body
     * plan" a property of the table rather than of who wrote which builder.
     */
    const kinds = Object.keys(CREATURE_PLANS);
    assert(kinds.length >= 5, `only ${kinds.length} plans in the table`);
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

  /* ══ THE HIDE — a body with no blade defending itself ═══════════════════ */

  check('beasts: a body with no blade turns a killing pass, and what it turns is its own mass', () => {
    /**
     * THE MEASUREMENT THAT ASKED FOR THIS. `tools/balance.mjs` put a 28 hp B1,
     * a 420 kg Nexu, a 1250 hp Reek, a 900 hp Acklay and a 2200 hp Rancor down
     * in the SAME 0.64 s, because `takeCut` makes any `vital >= 0.9` capsule
     * instantly lethal and nothing that was not a duellist defended itself. The
     * player's words were "the large creatures all look the same… they all
     * attack the same way"; the number adds the half nobody had said, which is
     * that they also died like nothing.
     *
     * `guardFor` is the whole rule and it is DERIVED — hp for a duellist, mass
     * for everything else. What is asserted here is the shape rather than the
     * constant: nothing man-sized turns anything, it rises with the body, and
     * it never contradicts the mass ordering.
     */
    const rows = [];
    for (const [type, A] of Object.entries(ARCHETYPES)) {
      if (A.training || A.inert) continue;
      const g = guardFor(A);
      if (A.saber) continue;                     // the duellist half, tested elsewhere
      rows.push({ type, mass: A.mass ?? 0, hp: A.hp, g });
    }
    rows.sort((a, b) => a.mass - b.mass);
    // MONOTONE IN MASS. Two bodies of the same weight must turn the same
    // number of passes, and a heavier one may never turn fewer — that is what
    // makes this a derivation rather than a table with opinions in it.
    for (let i = 1; i < rows.length; i++) {
      assert(rows[i].g >= rows[i - 1].g,
        `${rows[i].type} at ${rows[i].mass} kg turns ${rows[i].g} passes and the lighter `
        + `${rows[i - 1].type} at ${rows[i - 1].mass} kg turns ${rows[i - 1].g}`);
    }
    // A MAN IS NOT A WALL. Everything a player meets at eye level still comes
    // apart on the first pass, which is the half of the game that was right.
    for (const r of rows) {
      if (r.mass <= 260) {
        assert(r.g === 0, `${r.type} weighs ${r.mass} kg and turns ${r.g} killing passes — `
          + 'a body a player can pick up should not be shrugging off a lightsaber');
      }
    }
    // …AND THE BIG ONES DO. Named by what they are rather than by a list: any
    // body over half a tonne is one of the "large creatures" the note is about.
    const heavies = rows.filter((r) => r.mass >= 520);
    assert(heavies.length >= 8, `only ${heavies.length} bodies over 520 kg on the roster`);
    for (const r of heavies) {
      assert(r.g >= 1, `${r.type} weighs ${r.mass} kg and still turns nothing`);
    }
    return rows.filter((r) => r.g > 0)
      .map((r) => `${r.type} ${r.mass}kg→${r.g}`).join(', ')
      + `; ${rows.length - rows.filter((r) => r.g > 0).length} bodies turn nothing`;
  });

  check('beasts: the hide is a DELAY and never a wall — every body still dies, and the ceiling is the game\'s own', () => {
    /**
     * The failure mode a guard invites is the opposite of the one it fixes, and
     * it is worse: a body nothing can finish. It cannot happen here and this is
     * the proof, driven through the real `takeCut` on a real built body.
     *
     * A turned pass costs `TURNED_CUT` of maximum health, so `ceil(1 /
     * TURNED_CUT)` turns kill the body outright however deep its guard is —
     * which is why the AT-TE's twelve and the Rancor's five are one fight. The
     * bound below is that ceiling plus the passes that actually land, and the
     * point of it is that it does not scale with the guard.
     */
    const rows = [];
    for (const type of [...BEASTS, 'walker', 'atte', 'aat', 'hailfire', 'dwarfspider', 'b1']) {
      const { e } = bench(type);
      const guard0 = e.guardMax;
      let passes = 0, turned = 0;
      // The same leg, over and over — the pessimistic case, and the one the
      // player actually plays: you do not get to choose a new limb each swing.
      while (!e.dead && passes < 40) {
        const ev = cutAt(e, /femur|thigh|tibia|shin|hipL|leg/);
        passes++;
        if (e.takeCut(ev, null) === 'turned') turned++;
      }
      assert(e.dead, `${type} survived 40 passes at the same limb — the hide has become a wall`);
      assert(turned <= Math.ceil(1 / TURNED_CUT),
        `${type} turned ${turned} passes against a ceiling of ${Math.ceil(1 / TURNED_CUT)}`);
      assert(turned <= guard0, `${type} turned ${turned} passes with a guard of ${guard0}`);
      rows.push({ type, guard0, turned, passes });
      e.dispose?.();
    }
    // The control: a battle droid still comes apart on the first pass. If this
    // ever turns anything the constant has slipped down onto man-sized bodies.
    const b1 = rows.find((r) => r.type === 'b1');
    assert(b1.turned === 0 && b1.passes <= 3,
      `a B1 turned ${b1.turned} passes and took ${b1.passes} — the hide has reached the droids`);
    /**
     * …AND A HIDE HAS TO BE WORTH SOMETHING, which is what the line under this
     * comment used to be trying to say and did not.
     *
     * It said `r.passes > b1.passes` FOR EVERY BODY IN THE LIST, captioned "the
     * heavies cost strictly more than it does" — and the list is not the
     * heavies, it is every body that runs the beast brain plus five machines.
     * That was true of the roster it was written against, because the lightest
     * thing on it was a 110 kg Massiff on four legs. It stopped being true the
     * moment companions landed, and it fails on the Rancor Pup: 2 passes, the
     * same as a B1, and the message is "it dies like a droid".
     *
     * IT DIES LIKE A DROID BECAUSE IT IS BUILT LIKE ONE, and no number on that
     * animal moves it. Both are BIPEDS: `severanceOf` prices one leg of two at
     * `vital 0.55` where one leg of four is 0.28, and `takeCut` spends a
     * fraction of MAXIMUM health — measured, 0.632 of maxHp at vital 0.55 and
     * 0.316 at 0.28, on the Pup, the Massiff, the tooka and the B1 alike. So
     * the pass count is `ceil(1 / 0.632) = 2` whatever the health bar says: the
     * Pup's 240 hp and the B1's 28 die in the same two cuts, and giving the Pup
     * a thousand would not add one. The only thing that CAN add a pass is a
     * hide, and `guardFor` derives that from mass at 1/300 kg — so a 150 kg
     * animal has none, correctly and by the same rule the check above asserts
     * ("A MAN IS NOT A WALL: everything at 260 kg or under turns nothing"). It
     * would need 300 kg to buy one turned pass, and 300 kg is not a rancor pup:
     * the adult is 1700 kg at 5.5 m, and cube-law off that puts a 0.97 m
     * juvenile near 10 kg. 150 is already generous.
     *
     * So the clause was asking THIS check — the one about the hide — to enforce
     * a floor the hide rule deliberately does not give a light body, and the
     * only way to pass it would have been to make the Pup either heavy enough
     * to shrug off a lightsaber or four-legged, both of which are worse animals
     * than the check is bad.
     *
     * What is asserted instead is the property the caption names, scoped to the
     * bodies it is about: a body WITH a hide has to cost strictly more than the
     * body without one, and a body without a hide has to turn nothing at all.
     * The second half is not a consolation — it is the same statement as the
     * B1 control one line up, made about every light body on the roster rather
     * than about the one droid, and it is what keeps the hide off them.
     */
    for (const r of rows) {
      if (r.type === 'b1') continue;
      if (r.guard0 > 0) {
        assert(r.passes > b1.passes,
          `${r.type} carries a hide of ${r.guard0} and still takes ${r.passes} passes against a B1's `
          + `${b1.passes} — the guard is buying nothing`);
      } else {
        assert(r.turned === 0,
          `${r.type} has no hide and turned ${r.turned} passes — the guard has reached a body `
          + 'that `guardFor` gave none');
      }
    }
    return rows.map((r) => `${r.type} guard ${r.guard0}→turned ${r.turned}, ${r.passes} passes`).join('; ');
  });

  check('beasts: WINDED is the opening, and it is the one the animal already had', () => {
    /**
     * A guard with no way through is a wall, and the way through an animal is
     * the state it already enters when you hurt it fast enough. `_beastBrain`
     * has printed WINDED over its head since the move sets landed, and its own
     * comment calls it "the only safe time to go for a leg" — but until the
     * hide could turn a pass there was nothing for that window to be safe FROM,
     * because every pass landed. `_guardOpen` reads it now, which is the same
     * predicate the Force reads, so the opening is one rule and not two.
     */
    const rows = [];
    for (const type of BEASTS) {
      const { e } = bench(type);
      if (e.guardMax <= 0) { e.dispose?.(); continue; }
      // Guard up: the pass is turned.
      assert(e.takeCut(cutAt(e, /femur|thigh|tibia|hipL/), null) === 'turned',
        `${type} did not turn a pass with a full guard of ${e.guardMax}`);
      const guardLeft = e.guard;
      // Winded: the same pass lands, and does not spend the guard.
      e.state = 'winded';
      assert(e.takeCut(cutAt(e, /femur|thigh|tibia|hipL/), null) !== 'turned',
        `${type} turned a pass while WINDED — the window the brain prints is a lie`);
      assert(e.guard === guardLeft,
        `${type} spent guard on a pass it did not turn`);
      rows.push(`${type} ${e.guardMax}`);
      e.dispose?.();
    }
    assert(rows.length >= 4, `only ${rows.length} beasts have a guard to open`);
    return `${rows.join(', ')} — a full guard turns it, WINDED lets it through`;
  });
}
