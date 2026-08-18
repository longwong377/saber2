/**
 * BATTLEFRONT BORZ — the answer that cost nothing, and beat everything.
 *
 * THE DEFECT. Duel.js opens by promising that every attack is DECLARED: a
 * wind-up you can read, an arc drawn in the colour of what answers it, and one
 * of three answers — parry it, chamber it, or get out of the way. Each of those
 * is supposed to cost something. The third one cost nothing at all and beat
 * everything, because a duellist did not close the ground its own attack needed.
 *
 * THREE CAUSES. Two are dead and the third is what this rewrite is about.
 *
 *   NO FOOTWORK. Eight of the ten attacks in ATTACKS carried no gap-closing at
 *   all — only `thrust` and `lunge` had a `lunge` value — so a committed
 *   duellist circled at ~1.6 m/s of closing while the player opened the gap at
 *   4.6. `DuelBrain._closing` is the answer: a proportional loop on the ground
 *   still to cover, capped well under a dash.
 *
 *   A COPIED NUMBER. `FORMS[*].spacing[1]` is read twice. `Enemy._move` holds
 *   the body inside `spacing[1] * scale`; `DuelBrain` decided whether to swing
 *   at all against the bare `spacing[1]`. Every melee body in the game has a
 *   scale above 1, so a duellist chasing a retreating player parked itself 4%
 *   OUTSIDE its own trigger and stood there. `DuelBrain.reachOut` is that
 *   number, derived once.
 *
 *   AND A DEADLOCK, WHICH THIS FILE COULD NOT SEE. `_closing` returns 0 unless
 *   an attack has been declared, and an attack is only ever declared from
 *   inside `reachOut` — so a body that cannot reach `reachOut` can never earn
 *   the loop that exists to get it there. Every duellist whose own top speed is
 *   at or under the player's 4.6 m/s walk was still shut out completely, and
 *   this suite reported 5/5 while that was true of SIX ARCHETYPES.
 *
 * WHY IT COULD NOT SEE IT, AND IT IS HANDOFF §2.3's SHAPE EXACTLY. It drove all
 * five forms on one body — the `acolyte`, at speed 5.0, the fastest thing on
 * the roster that is not a Jedi and the only body in the fixture that could
 * out-run a walking player. So it measured a property of the FORM on a body
 * that does not carry it. Soresu on an acolyte read 1.27 hp/s with one attack
 * declared and passed; Soresu on the SENTINEL, the archetype that actually
 * fights Soresu, read 0.11 hp/s with ZERO attacks declared over 30 seconds.
 * Measured through the shipped code, real Player, real Enemy, knife range,
 * Knight, hp/s standing still → walking backwards, and attacks declared while
 * the player backed away:
 *
 *     sentinel   4.6   2.26 → 0.11    0 declared
 *     guardian   4.4   3.56 → 0.11    0
 *     sparring   3.4   0.48 → 0.00    0
 *     master     5.2  10.11 → 0.57    8
 *     magna      4.8   3.33 → 2.10    8
 *     bodyguard  4.4   5.31 → 6.61   19
 *     acolyte    5.0  18.07 → 12.65  42        ← the only body this file drove
 *
 * That table was taken with the player's blade LIT, which is what this fixture
 * used to do; the runs below leave it unlit and the note on `duel()` says why.
 * The hp/s are therefore not comparable line for line with the pass output —
 * the ZEROES and the empty `declared` column are, and they are the defect.
 *
 * So the roster is DERIVED here now, and from the same field the game uses to
 * decide who gets a DuelBrain at all: every archetype that is `melee` and
 * carries a `saber`. It imports Levels.js for the same reason — the Command
 * units, the machines and the menagerie register themselves there, and without
 * it a sweep sees 15 archetypes instead of 31 and none of the three bodies
 * above that are not in Enemy.js.
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
import { Enemy, enemyRng, ARCHETYPES, limitBackpedal } from '../../src/game/Enemy.js';
import { Player } from '../../src/game/Player.js';
import { duelRng, FORMS, FORM_KEYS, DuelBrain, ATTACKS, DUEL_PHASES } from '../../src/game/Duel.js';
import { DIFFICULTY, resolveBladeClash } from '../../src/game/Combat.js';
import { segmentSegment } from '../../src/physics/Physics.js';
/* THE ROSTER IS 31 BODIES AND NINE OF THEM DUEL — and six of the nine are
 * registered here rather than in Enemy.js. Without this import the sweep below
 * sees the five in Enemy.js's own table and misses the IG general, the
 * MagnaGuard and the BX commando, which is three of the four bodies the defect
 * this file exists for was worst on. */
import '../../src/game/Levels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scene = new THREE.Scene();

/**
 * EVERY BODY IN THE GAME THAT CARRIES A DUEL BRAIN, and it is asked rather than
 * typed. `Enemy._build` gives a DuelBrain to exactly `A.melee && A.saber`, so
 * that pair IS the roster of duellists: a body added to any of the four files
 * that register archetypes is swept here the day it is authored, and a body
 * that stops duelling drops out of the sweep instead of failing it.
 */
const duellists = () => Object.keys(ARCHETYPES)
  .filter((k) => ARCHETYPES[k].melee && ARCHETYPES[k].saber);

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

const stubInput = (axis, wantDash) => ({
  keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
  accel: { x: 0, y: 0 }, bindings: null,
  moveAxis: (o) => { o.x = axis.x; o.y = axis.y; return o; },
  act: () => false,
  actHit: (a) => (a === 'dash' && wantDash() ? true : false),
});

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
 * The subject is an ARCHETYPE, not a form. Which form it fights in is the
 * archetype's own business — four of the nine declare one and the rest draw
 * from the duel stream — and that is the whole point: a form is only ever met
 * on the body that carries it.
 *
 * The blade branch mirrors World's own ordering (clash first, body second) for
 * the same reason tools/checks/duelling.mjs does: the order IS the rule that
 * steel beats flesh, and a check that got it backwards would be measuring a
 * different game.
 */
function duel(type, answer, { seconds = 22, diff = 'knight', seed = 0 } = {}) {
  /* THE SAME FIGHT EVERY TIME — both module streams, seeded off the body's own
   * key so no two are handed identical luck. See the note in
   * tools/checks/duelling.mjs: a body measured after four other suites have run
   * is not the body measured on its own. */
  const h = [...String(type)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  duelRng.seed(2200 + seed * 977 + (h % 90000));
  enemyRng.seed(41000 + seed * 131 + (h % 9000));

  const w = gameWorld(diff);
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  /**
   * THE PLAYER'S BLADE IS NOT LIT, AND THAT IS THE FIXTURE RATHER THAN AN
   * OVERSIGHT — the same call tools/checks/duelling.mjs makes for `bare`.
   *
   * With a lit blade `resolveBladeClash` fires whenever the two blades happen
   * to touch, and World's ordering — which this loop mirrors — stands the body
   * hit down when it does. So a player who stands still holding a guard in
   * front of them BLOCKS, for free, because nothing here charges the stamina
   * that `World._applyClash` charges. Measured over 22 s: 28 such contacts
   * against an IG general standing still, 3 against the same body while the
   * player walked backwards. That is a real mechanic and it belongs to
   * tools/checks/duelling.mjs, which measures clashes, binds and locks — but
   * inside THIS file it is a confound worth 15–20% of the very ordering the
   * suite exists to hold, and it is a measurement of the guard rather than of
   * the feet. Unlit, what is left is purely "can this body reach a player who
   * is walking away", which is the question.
   */
  w.players.push(p);
  const e = new Enemy(w, type, V(0, 0, 2.4));
  w.enemies.push(e);

  const axis = { x: 0, y: 0 };
  if (answer === 'back' || answer === 'dash') axis.y = -1;
  if (answer === 'strafe') axis.x = 1;
  let dashWanted = false;
  const input = stubInput(axis, () => (dashWanted ? (dashWanted = false, true) : false));
  const ctx = {
    input, terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };

  const s = {
    type, hits: 0, strikes: 0, declared: 0, hpLost: 0, stamSpent: 0,
    parkDist: 0, declareDist: 0, dists: [], e, p, w,
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
    s.dists.push(dist);
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
  for (const x of w.enemies) x.dispose?.();
  s.dps = s.hpLost / seconds;
  s.dists.sort((x, y) => x - y);
  s.p10 = s.dists[Math.floor(s.dists.length * 0.1)];
  s.p90 = s.dists[Math.floor(s.dists.length * 0.9)];
  return s;
}

/**
 * Nine real bodies × four answers × 22 s of real frames is the expensive thing
 * in this file, and three checks want the same numbers.
 *
 * THREE SEEDS FOR THE TWO THAT ARE COMPARED BODY BY BODY, one for the two that
 * are only ever read in aggregate. A duel is chaotic — the same body against
 * the same answer with a different draw lands three hits or six — and the
 * still-versus-walk ordering is the close call in this file, so it gets the
 * sample. The dash and the sidestep are not close calls: a dash takes a tenth
 * of what standing still does and the question there is an order of magnitude,
 * not a percentage.
 */
const _runs = new Map();
function runs(type, answer, seeds, diff = 'knight') {
  const key = `${type}|${answer}|${diff}`;
  if (!_runs.has(key)) {
    const rs = [];
    for (let s = 0; s < seeds; s++) rs.push(duel(type, answer, { diff, seed: s }));
    const sum = (f) => rs.reduce((a, x) => a + f(x), 0);
    _runs.set(key, {
      dps: sum((x) => x.dps) / rs.length,
      hits: sum((x) => x.hits),
      strikes: sum((x) => x.strikes),
      declared: sum((x) => x.declared),
      stamSpent: sum((x) => x.stamSpent) / rs.length,
      runs: rs.length, each: rs,
    });
  }
  return _runs.get(key);
}
function answers(diff = 'knight') {
  return duellists().map((k) => ({
    key: k,
    A: ARCHETYPES[k],
    still: runs(k, 'still', 3, diff),
    back: runs(k, 'back', 3, diff),
    dash: runs(k, 'dash', 1, diff),
    strafe: runs(k, 'strafe', 1, diff),
  }));
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export async function run({ check, assert }) {
  await initPhysics();

  check('footwork: no duelling body is shut out by a player holding one key', () => {
    /**
     * THE HEADLINE, and it is now asked of every body that duels rather than of
     * five forms on the one body fast enough to answer for itself. Before the
     * chase loop this read 0 declared / 0.11 hp/s on the Sentinel, the Temple
     * Guardian and the sparring partner — the three whose top speed is at or
     * under a walk — and 8 declared on a Jedi Master.
     *
     * DECLARING is the clause that carries it. A body that never enters
     * `windup` against a retreating player is in the deadlock this file's
     * header describes, and no amount of luck in a 22-second window changes
     * that: it is a controller that cannot reach its own trigger. Damage is
     * held in aggregate, because a form authored at 0.42 aggression that is
     * WAITING for the player to swing is not the same measurement as Ataru's
     * flurry and a per-body damage floor would be a bound written from the
     * loudest form and applied to the quietest.
     */
    const rows = answers('knight');
    assert(rows.length >= 8,
      `only ${rows.length} duelling archetypes were found — Levels.js registers six of them and this `
      + 'sweep is meant to see all of them');
    const mute = rows.filter((r) => r.back.declared === 0);
    assert(mute.length === 0,
      `${mute.length} of ${rows.length} bodies declared NO attack at all in 22 s against a player `
      + `walking backwards: ${mute.map((r) => `${r.key} (speed ${r.A.speed})`).join(', ')}`);
    /* The sparring partner is authored `damage: 3` and `training: true` — it is
     * the dojo's body and it is SUPPOSED not to hurt. It is held to the clause
     * above, which is about whether it can reach you at all, and excluded from
     * the one below, which is about how much it takes off you. */
    const armed = rows.filter((r) => !r.A.training);
    const landed = armed.filter((r) => r.back.hits > 0);
    assert(landed.length >= Math.ceil(armed.length * 0.7),
      `only ${landed.length}/${armed.length} bodies can touch a retreating player: `
      + armed.map((r) => `${r.key} ${r.back.hits}`).join(', '));
    const back = mean(armed.map((r) => r.back.dps));
    assert(back > 1.5,
      `a player holding one key takes ${back.toFixed(2)} hp/s across ${armed.length} duelling bodies`);
    return rows.map((r) => `${r.key} ${r.back.dps.toFixed(2)} hp/s (${r.back.hits} hits, `
      + `${r.back.declared} declared)`).join('; ');
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
    const rows = answers('knight').filter((r) => !r.A.training);
    const still = mean(rows.map((r) => r.still.dps));
    const back = mean(rows.map((r) => r.back.dps));
    const dash = mean(rows.map((r) => r.dash.dps));
    const strafe = mean(rows.map((r) => r.strafe.dps));
    assert(still > back && back > dash,
      `the three answers are not ordered: still ${still.toFixed(2)}, walk ${back.toFixed(2)}, `
      + `dash ${dash.toFixed(2)} hp/s`);
    /**
     * PER BODY IT IS THE PAID ESCAPE THAT IS ASSERTED, AND THE REASON IS
     * ARITHMETIC RATHER THAN TASTE.
     *
     * hp/s here is a count of landed cuts times a damage, and against the slow
     * heavy bodies a duellist lands two to four of them in a 22-second run. A
     * count of N carries a relative standard error of 1/√N, so at three hits
     * two runs of the same fixture differ by sixty per cent for no reason at
     * all — and the still-versus-walk difference this file is about is a good
     * deal smaller than that on those bodies. Measured over the three seeds this
     * fixture runs, walking away is worth 34% against an acolyte, 48% against a
     * Master and 9% against a Jedi Knight, and reads the WRONG way against the
     * Temple Guardian and the IG general — the two slowest bodies on the roster
     * and both of them fighting Djem So, the heavy form, whose whole answer to a
     * retreat is a long arc timed for where you are going, and the two whose
     * counts swing hardest between seeds. A
     * per-body bound tight enough to call that would be a coin toss and one
     * loose enough not to flap would be a number picked to pass, so the strict
     * ordering is held in AGGREGATE above, where the counts are pooled over the
     * whole roster, and the per-body numbers are printed rather than asserted.
     *
     * What IS resolvable per body — an order of magnitude rather than a
     * percentage — is that the paid answer works against every one of them. A
     * dash costs 18 stamina and it must clear the arc of anything on the field;
     * a body it did not clear would be the shutout defect pointing the other
     * way, with the game taking the answer away instead of pricing it.
     */
    for (const r of rows) {
      assert(r.dash.dps < r.still.dps * 0.6 + 0.05,
        `dashing away from ${r.key} takes ${r.dash.dps.toFixed(2)} hp/s against ${r.still.dps.toFixed(2)} `
        + 'for standing still — the one answer the player pays stamina for has to clear the arc');
    }
    /* THE SIDESTEP, which is the other free answer and must stay one. The fix
     * closes ground along the line to the target, so a duellist chases a
     * retreating player — but an arc declared at where you WERE is still an arc
     * you can step out of, and if this stopped working the attacks would have
     * become undodgeable in exactly the way this lane was told not to make
     * them. */
    assert(strafe < still,
      `sidestepping (${strafe.toFixed(2)} hp/s) is no better than standing still (${still.toFixed(2)})`);

    // and the price
    const walkCost = mean(rows.map((r) => r.back.stamSpent));
    const dashCost = mean(rows.map((r) => r.dash.stamSpent));
    /* NOT `=== 0`, AND THE LOOSENING IS A MEASUREMENT RATHER THAN A SHRUG.
     *
     * Since `tools/checks/powers.mjs` a duellist actually casts, and the `back`
     * run is the one that satisfies `fleeing` — so a duellist shoves and chokes
     * a retreating player where it never touched a strafing one. Driven with
     * the decrement instrumented, the cost is Player.js's swing whoosh
     * (`swing > 11` bills `swing * 0.055`) firing because a body thrown through
     * the air carries its blade with it. The walk itself still has no drain at
     * all — there are four `stamina -=` sites in Player.js and not one of them
     * is a walk. */
    assert(walkCost < 4, `walking backwards now costs ${walkCost.toFixed(2)} stamina over 22 s `
      + '— it should be free and partial');
    assert(dashCost > 30, `dashing away cost only ${dashCost.toFixed(1)} stamina over 22 s`);
    return `still ${still.toFixed(2)} > walk ${back.toFixed(2)} (${walkCost.toFixed(1)} stamina) > `
      + `dash ${dash.toFixed(2)} hp/s (${dashCost.toFixed(0)} stamina); sidestep ${strafe.toFixed(2)}; `
      + `per body still/walk ${rows.map((r) => `${r.key} ${r.still.dps.toFixed(1)}/${r.back.dps.toFixed(1)}`).join(' ')}`;
  });

  check('footwork: the player pays the same backpedal law every body pays', () => {
    /**
     * `limitBackpedal` is Enemy.js's, it is exported because it is a numeric
     * law, tools/checks/movement.mjs asserts it holds for the bodies — and the
     * player did not obey it. `Player._move` took one `base = 4.6` and applied
     * it to every direction, so the one fighter on the field who could give
     * ground at a dead run was the one holding the camera.
     *
     * Driven through the shipped `Player._move` at a real 60 Hz, reading the
     * steady-state ground speed off `velocity`, because the property is what
     * the player MOVES AT and not what a constant says.
     */
    const w = gameWorld('knight');
    const p = new Player(w, { isLocal: true });
    p.position.set(0, 0, 0);
    w.players.push(p);
    const axis = { x: 0, y: 0 };
    const ctx = { input: stubInput(axis, () => false), terrain: w.terrain, physics: w.physics,
      particles: null, bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
      enemies: [], players: w.players, pickTarget: () => null };
    const paceOf = (x, y) => {
      axis.x = x; axis.y = y;
      p.position.set(0, 0, 0); p.velocity.set(0, 0, 0);
      for (let i = 0; i < 120; i++) { ctx.time = w.time = i / 60; p.update(1 / 60, ctx); }
      return Math.hypot(p.velocity.x, p.velocity.z);
    };
    const fwd = paceOf(0, 1), back = paceOf(0, -1), side = paceOf(1, 0);
    assert(back < fwd * 0.9,
      `walking backwards runs at ${back.toFixed(2)} m/s against a ${fwd.toFixed(2)} m/s advance — `
      + 'the player is the only body in the game that backpedals at a run');
    assert(back > fwd * 0.5,
      `walking backwards runs at ${back.toFixed(2)} m/s against ${fwd.toFixed(2)} — that is not a `
      + 'retreat any more, it is a punishment');
    assert(Math.abs(side - fwd) < 0.05,
      `a sidestep runs at ${side.toFixed(2)} m/s against a ${fwd.toFixed(2)} m/s advance — the law `
      + 'slows the part of a pace that points BEHIND you and nothing else');
    /* …and it is the same function, not a second copy of it. A hand-written
     * "multiply by 0.72" in Player.js would pass every line above and be the
     * copied-table defect this codebase keeps removing. */
    const probe = limitBackpedal(V(0, 0, -4), V(0, 0, 1), 0.5);
    assert(Math.abs(probe.z + 2) < 1e-9,
      `limitBackpedal is not the law it was: a 4 m/s retreat at factor 0.5 came out ${probe.z}`);
    return `advance ${fwd.toFixed(2)}, sidestep ${side.toFixed(2)}, retreat ${back.toFixed(2)} m/s `
      + `(${(back / fwd * 100).toFixed(0)}% of the advance)`;
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
     *
     * Every duelling BODY, in every form it can draw — the scale that was being
     * dropped belongs to the archetype, so sweeping five forms on one body
     * could only ever find it on that body's scale.
     */
    const lines = [];
    for (const type of duellists()) {
      const w = gameWorld('knight');
      const target = { position: V(0, 0, 0), chest: V(0, 1.3, 0), alive: true, radius: 0.34,
        invuln: 0, crouch: 0, hp: 100, velocity: new THREE.Vector3(),
        damage() {}, camera: { addShake() {} } };
      w.players.push(target);
      const ctx = { input: null, terrain: w.terrain, physics: w.physics, particles: null,
        bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
        enemies: w.enemies, players: w.players, pickTarget: () => target };
      for (const key of FORM_KEYS) {
        enemyRng.seed(9100 + FORM_KEYS.indexOf(key));
        duelRng.seed(7700 + FORM_KEYS.indexOf(key));
        const e = new Enemy(w, type, V(0, 0, 8));
        e.duel.formKey = key; e.duel.form = FORMS[key];
        w.enemies.length = 0; w.enemies.push(e);
        // Sweep in from well outside. The band edge is the LAST distance at
        // which the feet still drive straight down the line to the target.
        let edge = 0;
        const STEP = 0.005;
        // exact multiples of the step, so the sweep's own arithmetic cannot
        // put a sample a hair above the band edge and read that as a defect
        for (let i = 0; i < 1400; i++) {
          const d = (1600 - i) * STEP;
          e.position.set(0, 0, d);
          e.velocity.set(0, 0, 0);
          // guard only: a committed duellist drives in whatever the band says,
          // and the question here is where it is CONTENT to stand.
          e.duel.phase = 'guard'; e.duel.timer = 99; e.duel.attack = null;
          e._think(1 / 60, ctx);
          if (!e.wish) continue;
          if (e.wish.dot(e.toTarget) > 0.999) edge = d;
          else break;
        }
        const reach = e.duel.reachOut;
        assert(edge > 0, `${type}/${key}: the body never drove straight in at any distance`);
        // one sweep step of slack, and no more: the defect this catches was a
        // whole 4% of the band (2.90 against 3.02 for an acolyte), which is
        // twenty-four times this tolerance.
        assert(reach >= edge - STEP - 1e-9,
          `${type}/${key}: the feet are content at ${edge.toFixed(2)} m and the blade will not swing `
          + `past ${reach.toFixed(2)} m — it stands outside its own trigger`);
        // …and the distance the form wants to hold is inside the band it swings
        // from, or `standAt` would park it outside its own trigger by design.
        assert(e.duel.standOff <= reach,
          `${type}/${key}: the form stands at ${e.duel.standOff.toFixed(2)} m and swings to `
          + `${reach.toFixed(2)} m`);
        for (const x of w.enemies) x.dispose?.();
        if (type === duellists()[0]) lines.push(`${key} content at ${edge.toFixed(2)} / swings to ${reach.toFixed(2)}`);
      }
    }
    // and the scale really is the thing that was being dropped
    const scaled = duellists().filter((k) => ARCHETYPES[k].scale !== 1);
    assert(scaled.length > 0,
      'no duelling body is scaled any more, so this check has lost its teeth');
    return `${duellists().length} bodies × ${FORM_KEYS.length} forms; on ${duellists()[0]}: `
      + lines.join('; ');
  });

  check('footwork: only a declared attack presses a duellist inside its own measure', () => {
    /**
     * The other half of "answerable", and it is the property in the shape it
     * now takes. There are two presses in Duel.js and they answer two different
     * questions, so they are asked separately:
     *
     *   `_closing`  I have an arc on screen and there is ground between it and
     *               the body it was declared against. Zero in every phase but
     *               `windup` and `strike` — a loop that closed ground at guard,
     *               on a feint or through a stagger would be a duellist that
     *               simply walks into you, which is the backpedal defect in
     *               reverse.
     *   `_chase`    the body I am fighting is RUNNING. Zero unless the target
     *               is actually opening the distance under its own power, zero
     *               through a stagger, and — this is the clause that keeps the
     *               guarantee — zero at or inside `standOff`, the distance the
     *               form fights at. So the only thing in the file that can take
     *               a duellist closer than that is an arc it has declared.
     *
     * Driven through DUEL_PHASES so a phase added later is covered the day it
     * is added rather than the day somebody remembers this file.
     *
     * DELIBERATELY NOT a per-frame reading of `lungeSpeed` off a live fight.
     * That is a different property and it is meant to be nonzero out of phase:
     * a thrust sets `lungeSpeed` to its authored 3.4 on the way into the strike
     * and it DECAYS through the recovery, because a body that has thrown its
     * weight forward does not stop on the frame the swing ends. What must be
     * zero is what the loops ASK for.
     */
    const b = Object.create(DuelBrain.prototype);
    const fleeing = new THREE.Vector3(0, 0, 9);
    b.e = { A: { scale: 1 }, saberPhase: 'guard',
      target: { velocity: fleeing }, toTarget: new THREE.Vector3(0, 0, 1) };
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
      // the chase is alive in every phase but a stagger — and never inside the
      // measure, whatever the phase
      const far = b._chase(50), inside = b._chase(b.standOff * 0.999);
      assert(ph === 'stagger' ? far === 0 : far > 0,
        `the chase returned ${far.toFixed(2)} in '${ph}'`);
      assert(inside === 0,
        `a duellist at '${ph}' pressed at ${inside.toFixed(2)} from inside its own measure `
        + `(${b.standOff.toFixed(2)} m) with no attack declared`);
    }
    // …and a brain with no attack at all asks for nothing, at any distance
    b.e.saberPhase = 'windup';
    b.attack = null;
    assert(b._closing(50) === 0, 'a duellist with no attack still wanted to close');
    // …and neither loop runs against a target that is not going anywhere
    fleeing.set(0, 0, 0);
    assert(b._chase(50) === 0,
      'a duellist chased a target that was standing still — the chase answers footwork with '
      + 'footwork and a stationary player is not footwork');
    fleeing.set(4, 0, 0);                                  // a pure sidestep
    assert(b._chase(50) === 0, 'a duellist chased a player who was sidestepping, not retreating');
    return `${pressed.join(', ')} press at 0.00; windup and strike are the only two that close, `
      + 'and the chase needs a target that is running';
  });

  check('footwork: holding sprint spends the pool it runs on', () => {
    /**
     * NOTHING IN THIS TREE HAD EVER PRESSED `sprint`.
     *
     * This file's own `stubInput` answers `act: () => false`, and its price
     * column sums DEBITS ONLY — `stamSpent` counts the decrements — so it could
     * report a cost of 18 for a dash while the pool itself never moved. A
     * balance measured by adding up the withdrawals cannot see an account that
     * refills faster than it is drawn on, and that is exactly what was
     * happening: `_move` drained 11/s while sprinting and `_regen` handed back
     * `(16 + 10*(1 - combatIntensity)) * staminaRegen` EVERY frame, a floor of
     * 13.6/s and a ceiling of 26/s. Measured on the shipped code: 30 s of
     * sprinting from an EMPTY bar ended at 100.0 stamina having covered
     * 222.8 m, and 20 s from full ended at 100.0 over 148.7 m. The dash
     * inherited it — 27 dashes in 15 s, the cooldown ceiling exactly, never
     * dropping below half a bar, because 18 against 26/s of regen over a 0.55 s
     * cooldown is a net 1.6.
     *
     * So the property is stated on the POOL and never on the debits: pressing
     * the key that spends stamina must leave you with less of it than not
     * pressing it. It is a comparison rather than a threshold, so it cannot be
     * satisfied by tuning either number.
     */
    const run = (sprint, seconds) => {
      const w = gameWorld('knight');
      const p = new Player(w, { isLocal: true });
      p.position.set(0, 0, 0);
      w.players.push(p);
      const axis = { x: 0, y: 1 };
      const input = {
        keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
        accel: { x: 0, y: 0 }, bindings: null,
        moveAxis: (o) => { o.x = axis.x; o.y = axis.y; return o; },
        act: (a) => (a === 'sprint' ? sprint : false),
        actHit: () => false,
      };
      const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
        camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies, players: w.players };
      const from = p.position.clone();
      let running = 0;
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) {
        ctx.time = w.time = i / 60;
        p.update(1 / 60, ctx);
        if (p._sprinting) running++;
      }
      return { stamina: p.stamina, metres: p.position.distanceTo(from), duty: running / frames };
    };

    const walked = run(false, 20);
    const sprinted = run(true, 20);
    assert(walked.stamina > 99,
      `the fixture cannot even walk without spending stamina (${walked.stamina.toFixed(1)} left)`);
    assert(sprinted.stamina < walked.stamina - 20,
      `20 s of holding sprint ended at ${sprinted.stamina.toFixed(1)} stamina against ${walked.stamina.toFixed(1)} `
      + 'for the same 20 s of walking — the run is paying for itself out of its own regen');
    assert(sprinted.duty < 0.95,
      `the bar sustained a run for ${(sprinted.duty * 100).toFixed(0)}% of 20 s — sprinting has no end`);
    assert(sprinted.metres > walked.metres,
      `sprinting covered ${sprinted.metres.toFixed(0)} m against a walk's ${walked.metres.toFixed(0)} m — `
      + 'it has been priced out of being worth pressing');

    /* AND FROM EMPTY IT IS NOT AN OPENING AT ALL. A pool that pays for the
     * verb that empties it can be run indefinitely from zero; this is the
     * measurement that read 222.8 m on the old code. */
    const fromEmpty = (() => {
      const w = gameWorld('knight');
      const p = new Player(w, { isLocal: true });
      p.position.set(0, 0, 0); p.stamina = 0; w.players.push(p);
      const input = { keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
        accel: { x: 0, y: 0 }, bindings: null, moveAxis: (o) => { o.x = 0; o.y = 1; return o; },
        act: (a) => a === 'sprint', actHit: () => false };
      const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
        camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies, players: w.players };
      let first = -1;
      for (let i = 0; i < 120; i++) {
        ctx.time = w.time = i / 60; p.update(1 / 60, ctx);
        if (p._sprinting && first < 0) first = i;
      }
      return first;
    })();
    assert(fromEmpty > 30,
      `an empty bar was running again ${(fromEmpty / 60).toFixed(2)}s after hitting zero — the floor the `
      + 'sprint gate uses is a rounding error away from empty, so the run never really stops');

    /* THE DASH RIDES THE SAME POOL. Pressed at its own cooldown ceiling it has
     * to run the bar down; 27 dashes without passing half a bar was the
     * measurement, and the bound here is that the chain ENDS. */
    const dashChain = (() => {
      const w = gameWorld('knight');
      const p = new Player(w, { isLocal: true });
      p.position.set(0, 0, 0); w.players.push(p);
      let want = false, dashes = 0, low = p.maxStamina;
      const input = { keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
        accel: { x: 0, y: 0 }, bindings: null, moveAxis: (o) => { o.x = 0; o.y = 1; return o; },
        act: () => false, actHit: (a) => (a === 'dash' ? want : false) };
      const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
        camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies, players: w.players };
      for (let i = 0; i < 15 * 60; i++) {
        want = p.cooldowns.dash <= 0;
        const before = p.stamina;
        ctx.time = w.time = i / 60;
        p.update(1 / 60, ctx);
        if (p.stamina < before - 10) dashes++;
        low = Math.min(low, p.stamina);
      }
      return { dashes, low };
    })();
    assert(dashChain.low < 20,
      `15 s of dashing at the cooldown ceiling never took the bar below ${dashChain.low.toFixed(0)} — `
      + `${dashChain.dashes} dashes at 18 each is not a cost if the pool refills between them`);
    return `20 s held: walk ${walked.stamina.toFixed(0)} stamina / ${walked.metres.toFixed(0)} m, `
      + `sprint ${sprinted.stamina.toFixed(0)} / ${sprinted.metres.toFixed(0)} m at ${(sprinted.duty * 100).toFixed(0)}% `
      + `duty; from empty the run resumes at ${(fromEmpty / 60).toFixed(2)}s; `
      + `dash chain ${dashChain.dashes} dashes, low-water ${dashChain.low.toFixed(0)}`;
  });

  check('footwork: both presses are bounded well under what a dash buys', () => {
    /**
     * The caps are what keep the attack answerable, so they are worth measuring
     * rather than trusting. Enemy._meleeBrain turns `lungeSpeed` into velocity
     * along the line to the target; this drives the shipped loops at an absurd
     * gap and reads the ceilings back, then compares them with the one attack
     * in the table that is SUPPOSED to cover a room.
     */
    const b = Object.create(DuelBrain.prototype);
    b.e = { A: { scale: 1 }, saberPhase: 'windup',
      target: { velocity: new THREE.Vector3(0, 0, 9) }, toTarget: new THREE.Vector3(0, 0, 1) };
    b.form = FORMS.djemSo;
    b.attack = { ...ATTACKS.overhead, reach: 0 };
    Object.defineProperty(b, 'phase', { get: () => b.e.saberPhase, configurable: true });
    const far = b._closing(1000);
    const chase = b._chase(1000);
    assert(far > 0 && isFinite(far), `the closing loop returned ${far} at 1000 m`);
    assert(chase > 0 && isFinite(chase), `the chase returned ${chase} at 1000 m`);
    // `lunge`'s authored 7.5 is the single biggest step in the game; ordinary
    // footwork must not reach it, or the lunge stops being a lunge.
    assert(far < 7.5, `ordinary footwork presses at ${far.toFixed(2)}, at or past the lunge's own 7.5`);
    /* AND THE CHASE IS THE GENTLER OF THE TWO. Being run down must not feel
     * like being lunged at: the lunge is the declared thing and the arc on
     * screen is what promises it. Enemy.js turns a press into about 1.1x its
     * value of closing speed, so this is the number that decides whether a
     * 15.5 m/s dash is still an exit — see the note on CHASE_CAP. */
    assert(chase < far,
      `the chase presses at ${chase.toFixed(2)} against a declared attack's ${far.toFixed(2)} — `
      + 'running a player down is not supposed to be stronger than committing to an arc');
    assert(chase * 1.1 < 4.0,
      `the chase adds ${(chase * 1.1).toFixed(2)} m/s of closing on top of a body's own pace — a dash `
      + 'has to stay an exit');
    // and both shut off cleanly once the ground is covered
    assert(b._closing(FORMS.djemSo.spacing[0] * 0.5) === 0,
      'the closing loop was still pressing after it was already inside its own range');
    assert(b._chase(b.standOff) === 0, 'the chase was still pressing at its own measure');
    return `closing capped at ${far.toFixed(2)} against the lunge's 7.5, chase at ${chase.toFixed(2)} `
      + `(${(chase * 1.1).toFixed(2)} m/s of extra closing); both 0 once inside`;
  });
}
