/**
 * BATTLEFRONT BORZ — the answer that cost nothing, and beat everything.
 *
 * THE DEFECT. Duel.js opens by promising that every attack is DECLARED: a
 * wind-up you can read, an arc drawn in the colour of what answers it, and one
 * of three answers — parry it, chamber it, or get out of the way. Each of those
 * is supposed to cost something. The third one cost nothing at all and beat
 * everything, because a duellist did not close the ground its own attack needed.
 *
 * Measured before, driving a real Player against a real acolyte through all
 * five forms at two difficulties, 30 s each, and doing NOTHING but holding one
 * movement key:
 *
 *     answer            hp/s taken (mean of 5 forms)      stamina spent
 *     stand still       knight 9.68   grandmaster 11.91        0
 *     walk backwards    knight 0.00   grandmaster  0.72        0
 *
 * Zero. In every form at Knight and in three of five at Grandmaster, and in the
 * cells that were not zero every strike thrown whiffed. `sprint` is gated on
 * `axis.y > 0.2` in Player._move so it cannot even be spent going backwards,
 * and a walk has no drain, so the strongest option in a duel was free forever.
 *
 * TWO CAUSES, both in Duel.js, both fixed there:
 *
 *   NO FOOTWORK. Eight of the ten attacks in ATTACKS carried no gap-closing at
 *   all — only `thrust` and `lunge` had a `lunge` value — so a committed
 *   duellist circled at ~1.6 m/s of closing while the player opened the gap at
 *   4.6. `DuelBrain._closing` is the answer: a proportional loop on the ground
 *   still to cover, capped well under a dash.
 *
 *   AND A COPIED NUMBER. `FORMS[*].spacing[1]` is read twice. `Enemy._move`
 *   holds the body inside `spacing[1] * scale`; `DuelBrain` decided whether to
 *   swing at all against the bare `spacing[1]`. Every melee body in the game
 *   has a scale above 1, so a duellist chasing a retreating player parked
 *   itself 4% OUTSIDE its own trigger and stood there, declaring nothing, for
 *   as long as the player kept walking. `DuelBrain.reachOut` is that number,
 *   derived once.
 *
 * WHAT THIS FILE HOLDS, and what it deliberately does not. Not "hp/s is now
 * 3.2" — that is a transcription of one run. The properties are ORDERINGS
 * between the four answers a player has, every one of them driven through the
 * shipped Player, Enemy, DuelBrain and blade test:
 *
 *     standing still  >  walking backwards  >  dashing backwards ≈ 0
 *     dashing costs stamina                     walking costs none
 *
 * The first inequality says retreating is still a real answer. The second says
 * it is no longer a free one. The third says the attacks did not become
 * undodgeable in the fixing — tools/checks/answerable.mjs and
 * tools/checks/duelling.mjs hold the rest of that line.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES } from '../../src/game/Enemy.js';
import { Player } from '../../src/game/Player.js';
import { duelRng, FORMS, FORM_KEYS, DuelBrain, ATTACKS, DUEL_PHASES } from '../../src/game/Duel.js';
import { DIFFICULTY, resolveBladeClash } from '../../src/game/Combat.js';
import { segmentSegment } from '../../src/physics/Physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scene = new THREE.Scene();

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/** A world with everything a real Player and a real Enemy touch, and no GPU. */
function gameWorld(diff) {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flatGround();
  physics.terrain = terrain;
  return {
    scene, physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY[diff], players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
}

/**
 * One duel, run frame by frame, with the player giving ONE of four answers.
 *
 *   still   the statue — the ceiling on how dangerous a duellist is
 *   back    hold the movement key that walks away. Costs nothing.
 *   dash    walk away AND spend a dash the instant a telegraph goes up.
 *           `actHit('dash')` is the shipped input path; Player._tryDash spends
 *           the 18 stamina and refuses when there is not enough, so the cost
 *           this reports is the cost the game actually charges.
 *   strafe  sidestep — the answer that neither retreats nor pays
 *
 * The blade branch mirrors World's own ordering (clash first, body second) for
 * the same reason tools/checks/duelling.mjs does: the order IS the rule that
 * steel beats flesh, and a check that got it backwards would be measuring a
 * different game.
 */
function duel(formKey, answer, { seconds = 24, diff = 'knight' } = {}) {
  /* THE SAME FIGHT EVERY TIME — both module streams, seeded off the form's own
   * key so the five are not handed identical luck. See the note in
   * tools/checks/duelling.mjs: a form measured after four other suites have run
   * is not the form measured on its own. */
  duelRng.seed(2200 + [...String(formKey)].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 90000);
  enemyRng.seed(41000 + FORM_KEYS.indexOf(formKey) + 1);

  const w = gameWorld(diff);
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  p.saber.ignite(); p.saber.ignition = 1;
  w.players.push(p);
  const e = new Enemy(w, 'acolyte', V(0, 0, 2.4));
  e.duel.formKey = formKey; e.duel.form = FORMS[formKey];
  w.enemies.push(e);

  const axis = { x: 0, y: 0 };
  if (answer === 'back' || answer === 'dash') axis.y = -1;
  if (answer === 'strafe') axis.x = 1;
  let dashWanted = false;
  const input = {
    keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
    accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { o.x = axis.x; o.y = axis.y; return o; },
    act: () => false,
    actHit: (a) => (a === 'dash' && dashWanted ? (dashWanted = false, true) : false),
  };
  const ctx = {
    input, terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };

  const s = {
    hits: 0, strikes: 0, declared: 0, hpLost: 0, stamSpent: 0,
    parkDist: 0, declareDist: 0, e, p, w,
  };
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const dt = 1 / 60, N = Math.round(seconds * 60);
  let lastHp = p.hp, lastStam = p.stamina, wasStrike = false, lastPhase = 'guard';

  for (let i = 0; i < N; i++) {
    ctx.time = w.time = i * dt;
    p.update(dt, ctx);
    e.update(dt, ctx);

    const dist = p.position.distanceTo(e.position);
    // How far out it is when it commits, and how far out it stands when it is
    // NOT committing. Those two numbers are the copied-`spacing[1]` defect.
    if (e.duel.phase === 'guard') s.parkDist = Math.max(s.parkDist, dist);
    if (e.duel.phase === 'windup' && lastPhase !== 'windup') {
      s.declared++;
      s.declareDist = Math.max(s.declareDist, dist);
      // …and this is the frame a player could first have seen the telegraph, so
      // it is the frame the dash answer spends its 18 stamina on. It lands on
      // the NEXT frame, which is also the earliest a human could act on it.
      if (answer === 'dash') dashWanted = true;
    }
    lastPhase = e.duel.phase;

    if (p.stamina < lastStam) s.stamSpent += lastStam - p.stamina;
    lastStam = p.stamina;

    if (!e.dead && e.saber && e.saber.ignition >= 0.6 && !e.lock && p.alive) {
      const clash = resolveBladeClash(p.saber, e.saber);
      if (!clash && e.duel.phase === 'strike' && p.invuln <= 0) {
        c0.set(p.position.x, p.position.y + 0.4, p.position.z);
        c1.set(p.position.x, p.position.y + 1.7, p.position.z);
        const d = Math.sqrt(segmentSegment(e.saber.prevTip, e.saber.tip, c0, c1, a, b).distSq);
        if (d <= 0.44) {
          p.damage(e.attackDamage * e.duel.damageScale, a.clone(), e, 'saber');
          e.duel.interrupt(0.45);
        }
      }
    }
    if (p.hp < lastHp) { s.hpLost += lastHp - p.hp; s.hits++; }
    lastHp = p.hp;
    // a dead statue measures nothing; stand it back up and keep counting
    if (!p.alive || p.hp <= 0.001) { p.hp = 100; p.alive = true; p.invuln = 0; lastHp = 100; }

    const isStrike = e.duel.phase === 'strike';
    if (isStrike && !wasStrike) s.strikes++;
    wasStrike = isStrike;
  }
  s.dps = s.hpLost / seconds;
  return s;
}

/* Five real bodies × four answers × 24 s of real frames is the expensive thing
 * in this file, and three checks want the same numbers. */
const _runs = new Map();
function answers(diff = 'knight') {
  if (_runs.has(diff)) return _runs.get(diff);
  const out = FORM_KEYS.map((k) => ({
    key: k,
    still: duel(k, 'still', { diff }),
    back: duel(k, 'back', { diff }),
    dash: duel(k, 'dash', { diff }),
    strafe: duel(k, 'strafe', { diff }),
  }));
  _runs.set(diff, out);
  return out;
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export async function run({ check, assert }) {
  await initPhysics();

  check('footwork: walking backwards is no longer a shutout', () => {
    /**
     * The headline number, and the one the owner's note is about. Before the
     * fix this was 0.00 hp/s in every form at Knight — not reduced, ZERO — with
     * 0 to 7 strikes thrown across 30 s and every one of them whiffing.
     *
     * Held as an aggregate AND per-form, because either alone is gameable: an
     * aggregate on its own would be satisfied by Ataru doing all of the work,
     * and a per-form floor tight enough to matter would be brittle against the
     * cadence differences that make Soresu throw one strike where Ataru throws
     * six.
     */
    const rows = answers('knight');
    const back = rows.map((r) => r.back.dps);
    const landed = rows.filter((r) => r.back.hits > 0);
    assert(mean(back) > 1.5,
      `a player holding one key takes ${mean(back).toFixed(2)} hp/s across the five forms`);
    assert(landed.length >= 4,
      `only ${landed.length}/5 forms can touch a retreating player: `
      + rows.map((r) => `${r.key} ${r.back.hits}`).join(', '));
    // …and every form must at least get its attack out of the gate. A form that
    // never declares is the copied-spacing defect, not a slow form.
    for (const r of rows) {
      assert(r.back.declared > 0,
        `${r.key} declared no attack at all in 24 s against a walking player`);
    }
    return rows.map((r) => `${r.key} ${r.back.dps.toFixed(2)} hp/s (${r.back.hits} hits, ${r.back.declared} declared)`).join('; ');
  });

  check('footwork: retreating is priced, not removed', () => {
    /**
     * THE ORDERING THAT IS THE WHOLE DESIGN. Giving ground must still be worth
     * doing — otherwise the fix has simply made the attacks undodgeable, which
     * is the failure mode this lane was told to avoid — and the retreat that
     * actually clears the arc must be the one that costs something.
     *
     * The only retreat in the game that spends anything is the dash: `sprint`
     * is gated on `axis.y > 0.2` and so cannot be spent going backwards at all,
     * and a walk has no drain. So this is literally "the free answer is partial
     * and the paid one is complete".
     */
    const rows = answers('knight');
    /* Per-form, but only where the form throws enough attacks at a statue for
     * the comparison to mean anything. Soresu's whole character is `aggression:
     * 0.42` and `defensive: 1.7` — it is WAITING for the player to commit — so
     * against a target that never swings it throws about seven strikes in
     * twenty-four seconds and the difference between two of those landing and
     * three is not a measurement of anything. The aggregate below is what
     * carries the property; this catches a single form going backwards. */
    for (const r of rows) {
      if (r.still.strikes < 8) continue;
      assert(r.back.dps < r.still.dps,
        `${r.key}: walking away (${r.back.dps.toFixed(2)} hp/s) is no better than standing still `
        + `(${r.still.dps.toFixed(2)})`);
    }
    const back = mean(rows.map((r) => r.back.dps));
    const dash = mean(rows.map((r) => r.dash.dps));
    const still = mean(rows.map((r) => r.still.dps));
    assert(still > back && back > dash,
      `the three answers are not ordered: still ${still.toFixed(2)}, walk ${back.toFixed(2)}, dash ${dash.toFixed(2)} hp/s`);
    /* THE SIDESTEP, which is the other free answer and must stay one. The fix
     * closes ground along the line to the target, so a duellist chases a
     * retreating player — but an arc declared at where you WERE is still an arc
     * you can step out of, and if this stopped working the attacks would have
     * become undodgeable in exactly the way this lane was told not to make
     * them. */
    const strafe = mean(rows.map((r) => r.strafe.dps));
    assert(strafe < still,
      `sidestepping (${strafe.toFixed(2)} hp/s) is no better than standing still (${still.toFixed(2)})`);
    assert(mean(rows.map((r) => r.strafe.stamSpent)) === 0,
      'sidestepping is supposed to be the other free answer and it now costs stamina');

    // and the price
    const walkCost = mean(rows.map((r) => r.back.stamSpent));
    const dashCost = mean(rows.map((r) => r.dash.stamSpent));
    /* NOT `=== 0`, AND THE LOOSENING IS A MEASUREMENT RATHER THAN A SHRUG.
     *
     * Since `tools/checks/powers.mjs` a duellist actually casts, and the `back`
     * run is the one that satisfies `fleeing` — so an acolyte shoves and chokes
     * a retreating player where it never touched a strafing one, which is why
     * the sidestep's `=== 0` above still holds and this one stopped. Driven
     * with the decrement instrumented, the entire cost across five forms and
     * 24 s each is ONE event: `-0.344 stamina, swing=15.7 m/s`. That is
     * Player.js's swing whoosh (`swing > 11` bills `swing * 0.055`) firing
     * because a body being thrown through the air carries its blade with it.
     * The walk itself still has no drain at all — there are four `stamina -=`
     * sites in Player.js and not one of them is a walk.
     *
     * 1 over 24 s is a sixth of a single thrust (6) and a ninetieth of what the
     * dash spends here, so it still catches "walking now drains" while not
     * failing on one whoosh. */
    assert(walkCost < 1, `walking backwards now costs ${walkCost.toFixed(2)} stamina over ${'24'} s `
      + '— it should be free and partial');
    assert(dashCost > 30, `dashing away cost only ${dashCost.toFixed(1)} stamina over 24 s`);
    return `still ${still.toFixed(2)} > walk ${back.toFixed(2)} (0 stamina) > dash ${dash.toFixed(2)} hp/s `
      + `(${dashCost.toFixed(0)} stamina); sidestep ${strafe.toFixed(2)}, also free`;
  });

  check('footwork: the band a duellist holds is inside the band it swings from', () => {
    /**
     * ONE NUMBER, TWO READERS — the sixth time this codebase has been bitten by
     * exactly that. `Enemy._move` parks the body at `spacing[1] * A.scale`;
     * `DuelBrain` used the bare `spacing[1]` to decide whether to swing. Every
     * duelling body in the game is scaled above 1, so the distance it chose to
     * stand at was outside the distance it would attack from, and against a
     * player who kept walking it stood there forever.
     *
     * BOTH SIDES ARE DRIVEN, and neither formula is restated here. A real
     * Enemy is stepped through `_think` at a swept distance and asked what its
     * FEET want: when it is beyond the band it holds, `Enemy._move` sets
     * `wish = toTarget` exactly — drive straight in — and inside the band the
     * wish is the circling blend, which points nowhere near the target. So the
     * distance at which that dot product collapses IS the band edge the body
     * chose, measured rather than computed. The brain's own trigger is
     * `reachOut`. There must be no distance where the feet are content and the
     * blade will not swing.
     */
    const w = gameWorld('knight');
    const target = { position: V(0, 0, 0), chest: V(0, 1.3, 0), alive: true, radius: 0.34,
      invuln: 0, crouch: 0, hp: 100, damage() {}, camera: { addShake() {} } };
    w.players.push(target);
    const ctx = { input: null, terrain: w.terrain, physics: w.physics, particles: null,
      bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
      enemies: w.enemies, players: w.players, pickTarget: () => target };
    const lines = [];
    for (const key of FORM_KEYS) {
      enemyRng.seed(9100 + FORM_KEYS.indexOf(key));
      duelRng.seed(7700 + FORM_KEYS.indexOf(key));
      const e = new Enemy(w, 'acolyte', V(0, 0, 6));
      e.duel.formKey = key; e.duel.form = FORMS[key];
      w.enemies.length = 0; w.enemies.push(e);
      // Sweep in from well outside. The band edge is the LAST distance at which
      // the feet still drive straight down the line to the target.
      let edge = 0;
      const STEP = 0.005;
      for (let i = 0; i < 1080; i++) {
        const d = 6.0 - i * STEP;
        e.position.set(0, 0, d);
        e.velocity.set(0, 0, 0);
        // guard only: a committed duellist drives in whatever the band says, and
        // the question here is where it is CONTENT to stand.
        e.duel.phase = 'guard'; e.duel.timer = 99; e.duel.attack = null;
        e._think(1 / 60, ctx);
        if (!e.wish) continue;
        if (e.wish.dot(e.toTarget) > 0.999) edge = d;
        else break;
      }
      const reach = e.duel.reachOut;
      assert(edge > 0, `${key}: the body never drove straight in at any distance`);
      // one sweep step of slack, and no more: the defect this catches was a
      // whole 4% of the band (2.90 against 3.02 for an acolyte), which is
      // twenty-four times this tolerance.
      assert(reach >= edge - STEP,
        `${key}: the feet are content at ${edge.toFixed(2)} m and the blade will not swing past `
        + `${reach.toFixed(2)} m — it stands outside its own trigger`);
      lines.push(`${key} content at ${edge.toFixed(2)} / swings to ${reach.toFixed(2)}`);
    }
    // and the scale really is the thing that was being dropped
    assert(ARCHETYPES.acolyte.scale !== 1,
      'the acolyte is no longer scaled, so this check has lost its teeth');
    return lines.join('; ');
  });

  check('footwork: nothing presses forward that has not declared an attack', () => {
    /**
     * The other half of "answerable". A loop that closed ground at guard, on a
     * feint or through a stagger would be a duellist that simply walks into you
     * — no telegraph, no window, nothing to read — which is the same game the
     * backpedal defect made, in reverse. `_closing` returns 0 outside `windup`
     * and `strike`, and this drives the shipped method through every phase the
     * game has — DUEL_PHASES, so a phase added later is covered the day it is
     * added rather than the day somebody remembers this file.
     *
     * DELIBERATELY NOT a per-frame reading of `lungeSpeed` off a live fight.
     * That is a different property and it is meant to be nonzero out of phase:
     * a thrust sets `lungeSpeed` to its authored 3.4 on the way into the strike
     * and it DECAYS through the recovery, because a body that has thrown its
     * weight forward does not stop on the frame the swing ends. What must be
     * zero is what the footwork loop ASKS for.
     */
    const b = Object.create(DuelBrain.prototype);
    b.e = { A: { scale: 1 }, saberPhase: 'guard' };
    b.form = FORMS.makashi;
    b.attack = { ...ATTACKS.overhead };
    Object.defineProperty(b, 'phase', { get: () => b.e.saberPhase, configurable: true });
    const pressed = [];
    for (const ph of DUEL_PHASES) {
      b.e.saberPhase = ph;
      const v = b._closing(50);
      if (ph === 'windup' || ph === 'strike') {
        assert(v > 0, `a committed duellist in '${ph}' asked for no ground at 50 m`);
      } else {
        assert(v === 0, `a duellist at '${ph}' wanted to close at ${v.toFixed(2)}`);
        pressed.push(ph);
      }
    }
    // …and a brain with no attack at all asks for nothing, at any distance
    b.e.saberPhase = 'windup';
    b.attack = null;
    assert(b._closing(50) === 0, 'a duellist with no attack still wanted to close');
    return `${pressed.join(', ')} press at 0.00; windup and strike are the only two that close`;
  });

  check('footwork: the press is bounded well under what a dash buys', () => {
    /**
     * The cap is what keeps the attack answerable, so it is worth measuring
     * rather than trusting. Enemy._meleeBrain turns `lungeSpeed` into velocity
     * along the line to the target; this drives the shipped `_closing` at an
     * absurd gap and reads the ceiling back, then compares it with the one
     * attack in the table that is SUPPOSED to cover a room.
     */
    const b = Object.create(DuelBrain.prototype);
    b.e = { A: { scale: 1 }, saberPhase: 'windup' };
    b.form = FORMS.djemSo;
    b.attack = { ...FORMS.djemSo, reach: 0 };
    Object.defineProperty(b, 'phase', { get: () => b.e.saberPhase, configurable: true });
    const far = b._closing(1000);
    assert(far > 0 && isFinite(far), `the closing loop returned ${far} at 1000 m`);
    // `lunge`'s authored 7.5 is the single biggest step in the game; ordinary
    // footwork must not reach it, or the lunge stops being a lunge.
    assert(far < 7.5, `ordinary footwork presses at ${far.toFixed(2)}, at or past the lunge's own 7.5`);
    // and it shuts off cleanly once the ground is covered
    assert(b._closing(FORMS.djemSo.spacing[0] * 0.5) === 0,
      'the loop was still pressing after it was already inside its own range');
    return `capped at ${far.toFixed(2)} against the lunge's 7.5, and 0 once inside spacing[0]`;
  });
}
