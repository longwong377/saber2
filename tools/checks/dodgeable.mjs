/**
 * BATTLEFRONT BORZ — every creature attack has to have an answer a player can
 * physically execute.
 *
 * ── THE BUG THIS FILE EXISTS FOR ──────────────────────────────────────────
 *
 * `BEAST_MOVES.charge` shipped with `aimUntil: 0.65` beside `hit: [0.65, …]`.
 * The aim is fixed and the blow resolves ON THE SAME FRAME, so there is no
 * interval at all in which any input can carry a body out of a 2.04 m
 * footprint. `gore` was the same shape with a tenth of a second in it — 2.16 m
 * to leave in 0.10 s, which is 21.6 m/s of sustained movement against a player
 * who breaks across the line at 4.60 m/s, backs straight off at 3.31 and dashes
 * 3.09 m in a quarter of a second. Driven through the shipped `_beastBrain` and
 * `hitTarget` with the target breaking away on the first frame of the wind-up:
 *
 *                    0     4.6   7.45  11    15.5  22    30      (m/s)
 *   charger/gore    100%  100%  100%  100%  100%   0%    0%
 *   charger/charge  100%  100%  100%  100%  100%  100%  100%
 *   stalker/charge   94%   94%   94%  100%  100%  100%  100%
 *   pouncer/charge  100%  100%  100%  100%  100%  100%  100%
 *
 * A Reek dealt 18.73 hp/s to a stationary player, a retreating player, a
 * strafing player and a dashing player — the same number to two decimals in all
 * four — and `gore` is its only phase-1 move, so it is the first thing a
 * Colosseum player meets. Both blows carried everything the game has for
 * "counter this now": a plant, a body wind-up, a roar and a floating call.
 *
 * ── WHAT IS PINNED, AND WHY IT IS NOT ONE SHAPE FOR EVERY MOVE ────────────
 *
 * Not "gore resolves at 1.0 now" — that is a transcription of the fix and it
 * would pass a table with a new hole in it. The property is that every move has
 * SOME answer, and the roster deliberately holds two kinds:
 *
 *   ANSWERED BY DISTANCE   the footprint is centred on a point the animal
 *                          REMEMBERED — `aim` of 'windup', 'drive' or 'launch'
 *                          — so the player is standing at the centre of it when
 *                          it commits and any direction is a way out. What has
 *                          to be true is that the interval between the last aim
 *                          update and the resolve is long enough to cross
 *                          `reach × scale`.
 *   ANSWERED BY DIRECTION  `aim: 'self'`: the footprint is centred on the
 *                          ANIMAL at the moment of impact. A sidestep inside
 *                          the ring gains nothing and that is the whole design
 *                          — this is the Rancor's slam, measured 100% against a
 *                          player circling at knife range and 0% against one
 *                          who breaks away. Here the player already stands
 *                          `preferred[0]` out, so what has to be crossed is the
 *                          part of the footprint beyond that, and the whole
 *                          wind-up is available to cross it in.
 *
 * Forcing the second kind into the first would delete the one attack on the
 * sand that punishes circling, which is a check bending the content it is
 * supposed to be measuring. Both are asserted; each is asserted against its own
 * escape.
 *
 * ── EVERY NUMBER IS READ OR MEASURED, NONE IS TYPED ───────────────────────
 *
 * HANDOFF §2.3: a hand-maintained table beside its generated twin is this
 * project's signature defect, and a check is the easiest place in the tree to
 * commit it. So:
 *
 *   • the move table is `BEAST_MOVES` itself;
 *   • which creature has which move is `beastMoveSet` — the shipped resolver
 *     the brain calls, against a really-built body, because a creature that
 *     declares no set takes its BODY PLAN's verbs;
 *   • `scale` and `preferred` come off the archetype that owns the move;
 *   • and the player's paces are MEASURED by driving a real `Player` through
 *     the shipped `_move`: holding a sidestep, holding a retreat, holding
 *     sprint, and spending a dash. Nothing here knows a number from Player.js.
 *
 * That last one is not ceremony, and it caught something a transcription would
 * have got wrong: the walk is NOT one number. A break across the line settles
 * at 4.60 m/s and a straight retreat at 3.31, because `PLAYER_BACKPEDAL` slows
 * the component pointing behind you — so "what a walking player can cover"
 * depends on which way the escape is allowed to go, which is exactly the
 * difference between the two answers this file is about.
 *
 * The last check closes the loop the other way: it drives the shipped
 * `_beastBrain` against a target breaking at the measured pace and asserts the
 * hit rates agree with the arithmetic above. Derivation and simulation have to
 * answer the same question the same way, or one of them is measuring something
 * else.
 */

import '../dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES, BEAST_MOVES, beastMoveSet } from '../../src/game/Enemy.js';
import { Player } from '../../src/game/Player.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { duelRng } from '../../src/game/Duel.js';
import '../../src/game/Levels.js';        // registers the Colosseum's creatures

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

const world = (extra = {}) => {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat();
  physics.terrain = terrain;
  return {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY.knight,
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {}, ...extra,
  };
};

/** Every archetype that runs the beast brain, found rather than listed. */
const BEASTS = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].custom === 'beast');

/** The shipped resolution of "what can this creature do", against a real body. */
const _built = new Map();
const movesOf = (type) => {
  if (!_built.has(type)) _built.set(type, ARCHETYPES[type].build({ scale: ARCHETYPES[type].scale }));
  return beastMoveSet(ARCHETYPES[type], _built.get(type)).filter((k) => BEAST_MOVES[k]);
};

/**
 * HOW FAR THE PLAYER CAN ACTUALLY GET, measured by making the move.
 *
 * A real `Player` in a real world, driven through `Player.update` with a stub
 * input that holds one direction, sampled once the pace has settled — which is
 * what a player evading a telegraph is already carrying when the animal
 * commits. Three paces come back, and THEY ARE NOT ONE NUMBER, which is the
 * thing measuring found and quoting would not have:
 *
 *   BREAK    across the line, still facing the animal. `limitBackpedal` (the
 *            law every body in the game obeys, the player included since
 *            PLAYER_BACKPEDAL) slows only the component pointing behind you, so
 *            a sidestep and a diagonal keep the full pace.
 *   RETREAT  straight back, still facing the animal — the same pace times
 *            `PLAYER_BACKPEDAL`. This is meaningfully slower, and it is the
 *            only pace available when the escape direction is FORCED, which is
 *            what `aim: 'self'` does.
 *   RUN      turned away and sprinting. `Player._move` gates the sprint on
 *            `axis.y > 0.2`, so this is a pace that costs you sight of the
 *            animal — real, and not free.
 *   DASH     a curve rather than a speed, sampled per frame from the moment it
 *            is spent, so a window of any length reads off it without this file
 *            knowing how long a dash lasts or how fast it is. Costs 18 stamina
 *            and 0.55 s of cooldown, so it is an answer you can be out of.
 */
function paces() {
  const mk = (opts) => {
    const w = world();
    const p = new Player(w, { isLocal: true });
    p.position.set(0, 0, 0);
    w.players.push(p);
    const h = { w, p, dashArmed: false };
    const input = {
      keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
      accel: { x: 0, y: 0 }, bindings: null,
      moveAxis: (o) => { o.x = opts.axis[0]; o.y = opts.axis[1]; return o; },
      act: (k) => k === 'sprint' && !!opts.sprint,
      actHit: (k) => (k === 'dash' && h.dashArmed ? (h.dashArmed = false, true) : false),
    };
    h.ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
      bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
      enemies: [], players: w.players, pickTarget: () => null };
    return h;
  };
  const dt = 1 / 60;
  const step = (h, seconds) => {
    for (let i = 0; i < seconds / dt; i++) { h.ctx.time = h.w.time += dt; h.p.update(dt, h.ctx); }
  };
  const settled = (opts) => { const h = mk(opts); step(h, 1.5); return h; };
  const groundSpeed = (p) => Math.hypot(p.velocity.x, p.velocity.z);

  const brk = groundSpeed(settled({ axis: [1, 0] }).p);          // sidestep
  const retreat = groundSpeed(settled({ axis: [0, -1] }).p);     // straight back
  const run = groundSpeed(settled({ axis: [0, 1], sprint: true }).p);

  /* The dash is ARMED AFTER SETTLING — armed before, it is spent during the
   * settle and what gets measured is a walk. (It was, the first time.) */
  const d = settled({ axis: [0, -1] });
  d.dashArmed = true;
  const from = d.p.position.clone();
  const curve = [0];
  for (let i = 0; i < 1.5 / dt; i++) {
    step(d, dt);
    curve.push(Math.hypot(d.p.position.x - from.x, d.p.position.z - from.z));
  }
  const dashOver = (seconds) => curve[Math.min(curve.length - 1, Math.round(seconds / dt))];
  return { brk, retreat, run, dashOver };
}

/**
 * Everything derivable about one creature's use of one move.
 *
 * `commit` is the last frame the aim updates: `aimUntil` for the moves that
 * re-read the target through their own wind-up, and the top of the wind-up for
 * the ones that remember a point at the start. `need` is what the player has to
 * cross — the whole footprint for a remembered point they are standing on, and
 * only the part beyond the engagement band for a blow centred on the animal.
 */
function shape(type, key) {
  const A = ARCHETYPES[type];
  const M = BEAST_MOVES[key];
  const self = M.aim === 'self';
  const commit = self ? 0 : (M.aimUntil ?? 0);
  const foot = M.reach * A.scale;
  return {
    type, key, M, A, self,
    commit,
    window: M.hit[0] - commit,
    foot,
    need: self ? Math.max(0, foot - A.preferred[0]) : foot,
    lateCommit: M.aimUntil !== undefined && !self,
  };
}

const all = () => BEASTS.flatMap((t) => movesOf(t).map((k) => shape(t, k)));
const m2 = (x) => `${x.toFixed(2)} m`;

export async function run({ check, assert }) {
  await initPhysics();
  const P = paces();

  check('dodgeable: the player has four paces, and they are measured rather than quoted', () => {
    /* The floor under every number in this file. If these stop being real the
     * rest of the suite is arithmetic about a player who does not exist — and
     * the gap between the first two is the reason this is measured at all: a
     * one-number model of "the walk" would have used the advance, which is a
     * pace nobody retreating has. */
    assert(P.brk > 1 && P.brk < 12, `a sidestep measured ${P.brk.toFixed(2)} m/s`);
    assert(P.retreat < P.brk,
      `backing straight off (${P.retreat.toFixed(2)}) is as fast as breaking across (${P.brk.toFixed(2)}) — `
      + 'PLAYER_BACKPEDAL has stopped applying to the player');
    assert(P.run > P.brk, `the sprint (${P.run.toFixed(2)}) is no faster than the break (${P.brk.toFixed(2)})`);
    const d24 = P.dashOver(0.24);
    assert(d24 > P.brk * 0.24 * 1.5,
      `a dash covered ${m2(d24)} in 0.24 s against ${m2(P.brk * 0.24)} of walking — it is not buying ground`);
    return `break ${P.brk.toFixed(2)} m/s, retreat ${P.retreat.toFixed(2)} m/s, run ${P.run.toFixed(2)} m/s, `
      + `dash ${m2(d24)} in 0.24 s / ${m2(P.dashOver(0.5))} in 0.5 s`;
  });

  check('dodgeable: the move table is sane — an aim that outlives its own blow is a zero-second window', () => {
    /* The shape of the defect, caught in the data before anybody has to run a
     * fight to find it: an `aimUntil` at or past `hit[0]` means the point is
     * fixed on the frame it lands. */
    const rows = [];
    for (const k of Object.keys(BEAST_MOVES)) {
      const M = BEAST_MOVES[k];
      assert(Array.isArray(M.hit) && M.hit.length === 2 && M.hit[1] > M.hit[0],
        `${k} has no resolve window: hit ${JSON.stringify(M.hit)}`);
      assert(typeof M.reach === 'number' && M.reach > 0, `${k} has no footprint`);
      assert(M.unlock >= 1 && M.unlock <= 3, `${k} unlocks at phase ${M.unlock}, and there are three`);
      if (M.aimUntil !== undefined) {
        assert(M.aimUntil < M.hit[0],
          `${k} re-aims until ${M.aimUntil}s and lands at ${M.hit[0]}s — the point is fixed on the frame `
          + 'it resolves, so no movement at any speed can be outside it. This is the charge defect.');
        rows.push(`${k} commits ${(M.hit[0] - M.aimUntil).toFixed(2)}s early`);
      }
    }
    return rows.join(', ');
  });

  check('dodgeable: every attack every creature has can be escaped by something the player can do', () => {
    /**
     * The property, stated once and applied to both kinds of answer. For each
     * creature-and-move: how far the player has to get, how long they have, and
     * whether any of the three paces covers it. The CHEAPEST pace that works is
     * reported, because "answerable only with a dash" and "answerable at a
     * walk" are different games and the difference should be visible without
     * running anything.
     */
    const dist = [];
    const dirn = [];
    for (const s of all()) {
      /* The always-available pace depends on which way the escape is allowed to
       * go, and that is the difference between the two answers. Out of a
       * REMEMBERED disc, any direction works, so it is the sidestep. Out of a
       * ring centred on the animal, the direction is forced outward and the
       * player is walking backwards, so it is the slower one — unless they turn
       * their back and run, which is the next rung. */
      const free = s.self ? P.retreat : P.brk;
      const budget = { walk: free * s.window, run: P.run * s.window, dash: P.dashOver(s.window) };
      const verb = budget.walk >= s.need ? (s.self ? 'back off' : 'break')
        : budget.run >= s.need ? 'turn and run'
          : budget.dash >= s.need ? 'dash' : null;
      const best = Math.max(budget.walk, budget.run, budget.dash);
      assert(verb !== null,
        `${s.A.label}'s ${s.key} cannot be escaped by anything the player has: ${m2(s.need)} to cross in `
        + `${s.window.toFixed(2)}s, and the best of break/run/dash covers ${m2(best)}. `
        + `It is telegraphed${s.M.call ? ` with a floating ${s.M.call}` : ''} and there is no answer to the telegraph.`);
      const row = `${s.type}.${s.key} ${m2(s.need)}/${s.window.toFixed(2)}s → ${verb}`;
      (s.self ? dirn : dist).push(row);
    }
    assert(dist.length >= 12, `only ${dist.length} remembered-point attacks found — the table has stopped being read`);
    assert(dirn.length >= 1, 'no attack on the roster is centred on the animal itself — the slam is the one '
      + 'blow that punishes circling at knife range, and without it one habit answers everything');
    return `answered by DISTANCE: ${dist.join(', ')} — answered by DIRECTION (out of the ring): ${dirn.join(', ')}`;
  });

  check('dodgeable: a move that re-aims through its own wind-up leaves a window a WALK can use', () => {
    /**
     * The stricter half, and it applies to exactly the class the bug was in.
     *
     * A move with `aimUntil` re-reads the target while it winds up, so every
     * metre the player spends before the commit is given back — footwork during
     * the telegraph is not an answer to it by design, which is what makes the
     * charge the reply to a runner rather than a second claw. That leaves the
     * interval AFTER the commit as the only one that can be spent, so it cannot
     * be a pace the player might not have: turning to run costs sight of a
     * charging animal, and the dash costs 18 stamina against a 0.55 s cooldown.
     * The break across the line is the one that is always there.
     *
     * `aim: 'self'` is excluded because it does not remember a point at all —
     * see the header. Its own escape is asserted in the check above.
     */
    const rows = [];
    for (const s of all()) {
      if (!s.lateCommit) continue;
      const walked = P.brk * s.window;
      assert(walked >= s.need,
        `${s.A.label}'s ${s.key} fixes its aim at ${s.commit.toFixed(2)}s and lands at ${s.M.hit[0].toFixed(2)}s — `
        + `${s.window.toFixed(2)}s to leave ${m2(s.need)}, which is ${(s.need / s.window).toFixed(1)} m/s sustained `
        + `against a break of ${P.brk.toFixed(2)} m/s. Everything before the commit is re-aimed away, so this is `
        + 'the whole of the counter-play and it is not enough of it.');
      rows.push(`${s.type}.${s.key} ${m2(walked)} broken vs ${m2(s.need)} needed`);
    }
    assert(rows.length >= 4, `only ${rows.length} late-committing attacks measured — \`aimUntil\` has stopped being read`);
    return rows.join('; ');
  });

  check('dodgeable: no creature spends the longest phase of its fight on one move', () => {
    /**
     * Phase 1 is over 66% of the health bar — the longest of the three — and
     * `_beastBrain` picks uniformly from whatever the phase has unlocked. Four
     * of the five creatures had exactly ONE move in it: measured at full health
     * over 30 s, the Acklay declared `stab` eleven times and nothing else, the
     * Reek `gore` eleven times, the Rancor `lunge` ten times. "They all attack
     * the same way" is what the player said, and a one-move phase is that
     * sentence in the data.
     *
     * Derived from `unlock` against the shipped move sets, so a creature added
     * tomorrow with one phase-1 verb fails here the day it is authored.
     */
    const rows = [];
    for (const type of BEASTS) {
      const set = movesOf(type);
      /**
       * …AND A BODY THAT CANNOT HURT YOU IS NOT A LOOP, IT IS SCENERY.
       *
       * This clause is a complaint about a repetitive THREAT — "they all attack
       * the same way" — and it is the right complaint for the eight creatures
       * the file was written against. Three of the twelve archetypes are now
       * companion MOUNTS, and every one of them is authored at `damage: 0` on
       * purpose: the tauntaun and the varactyl declare no bite at all, because
       * the design's whole point is that arriving somewhere is their entire
       * contribution and a mount that trades on its own makes the dismount
       * optional. A varactyl with one 0-damage sweep at phase 2 was failing a
       * check about how boring its attacks are to fight.
       *
       * So a zero-damage set is measured against the STRONGER claim instead of
       * being waved through: nothing it declares may do a point of damage to
       * anybody, ever. That is a real assertion — arm the varactyl and this
       * goes red — and it is keyed on the numbers the roster actually carries
       * rather than on a list of names, so the next mount is covered the day it
       * is authored and the day one of them is given teeth it is not.
       */
      const hurts = (k) => (ARCHETYPES[type].damage || 0) * (BEAST_MOVES[k].damage ?? 0);
      const armed = set.filter((k) => hurts(k) > 0);
      if (!armed.length) {
        /* `BEAST_MOVES[*].damage` is a MULTIPLIER on the archetype's own, so
         * the varactyl's sweep reads 0.85 and lands 0.85 x 0 = nothing. The
         * product is what a player feels and it is what is asserted. */
        const worst = Math.max(0, ...set.map(hurts));
        assert(worst === 0,
          `${ARCHETYPES[type].label} was taken for unarmed and its worst move lands ${worst}`);
        rows.push(`${type} unarmed [${set.join(' ') || 'no verbs'}]`);
        continue;
      }
      const p1 = set.filter((k) => BEAST_MOVES[k].unlock <= 1);
      assert(p1.length >= 2,
        `${ARCHETYPES[type].label} has ${p1.length} attack(s) at phase 1 (${p1.join(', ') || 'none'}) out of `
        + `${set.length} — and phase 1 is two thirds of its health bar, so that is most of the fight on a loop`);
      // …and the phases have to still MEAN something: a set that is fully
      // unlocked at phase 1 is a creature that never escalates.
      const later = set.filter((k) => BEAST_MOVES[k].unlock > 1);
      assert(later.length >= 1,
        `${ARCHETYPES[type].label} has its whole move set at phase 1, so hurting it changes nothing it does`);
      rows.push(`${type} p1 [${p1.join(' ')}] +[${later.join(' ')}]`);
    }
    return rows.join('; ');
  });

  check('dodgeable: and the shipped brain agrees — a walking break leaves every late-committing blow', () => {
    /**
     * The arithmetic above is a model of `hitTarget`, and a model of a rule is
     * HANDOFF §2.4's defect waiting to happen. This drives the real thing: a
     * real Enemy, the real `_beastBrain`, the real `hitTarget`, and a target
     * moving at the pace the first check MEASURED off a real Player — no
     * transcription in either direction.
     *
     * It asks only for the class the derivation calls walkable, and it asks for
     * it at the BREAK — the pace the check above measured off a real Player
     * sidestepping, with no sprint and no dash in it. 100% at every speed up to
     * 30 m/s was the bug, and if the fix only works at a sprint it is not one.
     *
     * The break is a STRAIGHT line, fixed on the frame the wind-up starts, and
     * that is deliberate: a break that re-derives its direction every frame is a
     * CIRCLE, and the chord across a circle is shorter than the distance walked
     * along it — which is exactly the confound `beasts.mjs` documents for the
     * Rancor's sweep. The derivation is about distance from a point, so the
     * simulation has to travel in a straight line from that point.
     */
    const dt = 1 / 60;
    const rows = [];
    for (const type of BEASTS) {
      const late = movesOf(type).filter((k) => shape(type, k).lateCommit);
      if (!late.length) continue;
      enemyRng.seed(4711);
      duelRng.seed(8123);
      const by = {};
      let cur = '';
      const w = world();
      const target = {
        position: V(0, 0, 0), velocity: new THREE.Vector3(), chest: V(0, 1.3, 0),
        hp: 500, alive: true, invuln: 0, camera: { addShake() {} },
        damage() { (by[cur] = by[cur] || [0, 0])[0]++; },
      };
      w.players.push(target);
      w.particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
        plasma: { spawn() {} }, smoke: { spawn() {} } };
      w.bolts = { fire() {}, update() {}, threatsNear: () => [] };
      const e = new Enemy(w, type, V(0, 0, -14));
      e.position.set(0, 0, -14);
      w.enemies.push(e);
      const ctx = { enemies: w.enemies, particles: w.particles, terrain: w.terrain,
        physics: w.physics, bolts: w.bolts, time: 0, pickTarget: () => target,
        camera: w.engine.camera };
      const attacks = movesOf(type);
      let prev = e.state;
      const away = new THREE.Vector3();
      const line = new THREE.Vector3();
      for (let i = 0; i < 90 / dt; i++) {
        ctx.time = w.time += dt;
        e.hp = Math.min(e.hp, e.maxHp * 0.12);          // phase 3: the whole set
        e.update(dt, ctx);
        if (e.state !== prev) {
          if (attacks.includes(e.state)) {
            cur = e.state;
            (by[cur] = by[cur] || [0, 0])[1]++;
            // the direction of the break, taken once and held
            away.subVectors(target.position, e.position).setY(0).normalize();
            line.set(away.z, 0, -away.x);
          }
          prev = e.state;
        }
        // A break across the line, at the measured pace, from the first frame
        // of the wind-up.
        if (attacks.includes(e.state)) target.position.addScaledVector(line, P.brk * dt);
        target.chest.copy(target.position).setY(1.3);
        target.hp = 500;
        w.physics.step(dt);
      }
      for (const x of w.enemies) x.dispose?.();
      for (const k of late) {
        const n = by[k];
        assert(n && n[1] >= 3, `${type} used its ${k} ${n ? n[1] : 0} times in 90 s — too few to measure`);
        const rate = n[0] / n[1];
        assert(rate < 0.2,
          `${ARCHETYPES[type].label}'s ${k} landed ${Math.round(rate * 100)}% of the time on a player breaking `
          + `across the line at the measured ${P.brk.toFixed(2)} m/s (${n[0]} of ${n[1]}) — the derivation says its window `
          + 'is walkable and the shipped brain disagrees');
        rows.push(`${type}.${k} ${n[0]}/${n[1]}`);
      }
    }
    return `${rows.join(' ')} — breaking at ${P.brk.toFixed(2)} m/s`;
  });
}
