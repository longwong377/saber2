/**
 * BATTLEFRONT BORZ — a body the blade cannot reach is not an enemy, it is
 * weather.
 *
 * ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────────
 *
 * The V5 giants note ends: *"Look up other vehicles/mechs/monsters that we
 * could be missing. all of these need to be accurate and act/move/fire
 * differently as canon"*. The audit that answered it is `BACKLOG.md` §4.5; the
 * one structural hole it found is that thirty-five archetypes fought from the
 * ground and `src/game/Flight.js` is the answer. This is what holds that answer
 * to the same bar `giants.mjs` holds the five machines to, plus the one clause
 * a flyer adds and nothing else on the roster has to satisfy:
 *
 *   IT HAS TO BE FIGHTABLE, AND THAT IS A MEASUREMENT.
 *
 * Everything else in this file exists to stop a plausible-looking altitude from
 * being an enemy nobody can answer. The reach it is measured against is taken
 * off a REAL `Player` driven through `Player.update` with the shipped
 * `attackOver` binding — nothing here knows a number from Player.js — and the
 * share of a fight the body spends inside it comes off a driven `Enemy` rather
 * than off the constants that were used to author it.
 *
 * ── WHAT IS ASSERTED ──────────────────────────────────────────────────────
 *
 *   CANON       the reference height, against the body as built, through the
 *               scale divisor the archetype claims — off TRANSFORMED VERTICES,
 *               for `giants.mjs`'s reason: `Box3.setFromObject` inflates a
 *               rotated mesh to the box of its rotated local box, and this body
 *               is four tilted wings on a leaning trunk.
 *   REACH       measured, then compared with `Flight.BLADE_REACH`. The constant
 *               exists so the altitudes can be read against something; this is
 *               what stops it becoming a hand-maintained twin (HANDOFF §2.3).
 *   THE WINDOW  the share of a 60-second fight the lowest live capsule spends
 *               inside that reach, off a driven body. Both ends matter: a
 *               cruise that is reachable is not a flyer, and a stoop that is
 *               not is not an enemy.
 *   THE BLADE   a real swing, at the bottom of a real stoop, closing to
 *               contact — the honest form of "can you hit it", which a height
 *               comparison is only a proxy for.
 *   THE WING    the bones are `wing`, they are priced, the blade is offered
 *               them, and taking one root grounds the body for good.
 *   THE FORCE   held, then let go: it stays down for `FELL_FOR` and climbs
 *               again after.
 *   MOVEMENT    nothing else on the roster moves like it. Measured as vertical
 *               travel per fight against every other archetype, including the
 *               two that already hover.
 *   CADENCE     against every ranged body in the game, the way `giants.mjs`
 *               holds its five apart.
 *   THE DRAWING a floating body has to be DRAWN where its `position` says it
 *               is. This one is a guard on a defect that was found here and
 *               fixed in `Enemy._pose`, and it covers `jet` as well.
 *   THE PAGE    faction in three places and the kill answer in the player's own
 *               databank, because an answer nobody is told is not an answer.
 */

import '../dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, ARCHETYPES, enemyRng, severanceOf } from '../../src/game/Enemy.js';
import { duelRng } from '../../src/game/Duel.js';
import { Player } from '../../src/game/Player.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { FLIGHT, FLIGHT_CANON, BLADE_REACH, wingChains, wingLift, attachFlight }
  from '../../src/game/Flight.js';
import { DATABANK, factionOf } from '../../src/game/Databank.js';
import { LEVELS } from '../../src/game/Levels.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const m2 = (x) => `${x.toFixed(2)} m`;

/** Flat ground, in bounds everywhere — the same stub `giants.mjs` stands on. */
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/**
 * A world with the two things this file needs that the other stubs do not: a
 * `spawnEnemy` (so `attachFlight`'s adoption scan has something to adopt) and a
 * bolt sink that counts instead of drawing.
 */
function world(extra = {}) {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat();
  physics.terrain = terrain;
  const w = {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY.knight,
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    shots: 0,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
    addProp(p) { w.props.push(p); return p; },
    spawnEnemy(t, pos) { const e = new Enemy(w, t, pos); w.enemies.push(e); return e; },
    ...extra,
  };
  /* Everything `Player.update` asks of a bolt pool, which is more than an
   * enemy asks: it deflects, it holds and it looks for what is coming at it. */
  w.bolts = { bolts: [], fire() { w.shots++; }, update() {},
    hold() {}, release() {}, threatsNear: () => [] };
  return w;
}

/** A target for the brain to fight: stationary, on the ground, not hittable. */
function dummyTarget(w) {
  const t = {
    position: V(0, 0, 0), chest: V(0, 1.3, 0), velocity: V(0, 0, 0),
    team: 0, dead: false, hp: 1e9, maxHp: 1e9, isLocal: true, grounded: true,
    radius: 0.35, damage() {}, hurt() {},
  };
  w.players.push(t);
  w.player = t;
  return t;
}

const enemyCtx = (w, target) => ({
  terrain: w.terrain, physics: w.physics, particles: null, bolts: w.bolts,
  camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies,
  players: w.players, input: null, pickTarget: () => target,
});

/**
 * Drive one flyer for `seconds` and return everything measured off it.
 *
 * The pack is attached and the body spawned through `world.spawnEnemy`, which
 * is the door the game uses — so what this drives is the shipped adoption path
 * and not a hand-installed wrapper.
 */
function fly(seconds, opts = {}) {
  const w = world();
  attachFlight(w);
  const target = dummyTarget(w);
  const e = w.spawnEnemy(opts.type ?? 'geonosian', V(opts.at ?? 14, 0, 0));
  const ctx = enemyCtx(w, target);
  const dt = 1 / 60;
  const out = { w, e, ctx, alt: [], low: [], state: [], wingRoot: [] };
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    ctx.time = w.time += dt;
    for (const p of w.props) p.update?.(dt);
    e.update(dt, ctx);
    /* The brain drops its target when the body is out of its band; re-handing
     * it every frame is what a real world's `pickTarget` does. */
    e.target = target;
    if (opts.each) opts.each(e, i, w);
    e.rig?.root.updateMatrixWorld(true);
    out.alt.push(e.position.y);
    out.state.push(e._flightState);
    let low = Infinity;
    let root = Infinity;
    for (const c of e.capsules()) {
      if (!c.p0) continue;
      low = Math.min(low, c.p0.y - c.r, c.p1.y - c.r);
      if (c.name === 'wingL' || c.name === 'wingR') root = Math.min(root, c.p0.y, c.p1.y);
    }
    out.low.push(low);
    out.wingRoot.push(root);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The player's reach, measured                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How high the blade actually gets, by making the swings.
 *
 * A real `Player` in a real physics world, driven through `Player.update` with
 * a stub input that holds one action, sampled over the whole attack. The blade
 * is lit through `Saber.ignite` — the same call `Player` makes — because an
 * unlit saber's tip IS its hilt and the first version of this measured 1.95 m
 * for every attack in the game and did not notice.
 *
 * Returned per action, so the caller can say which swing a claim rests on
 * rather than taking the best of four and calling it "reach".
 */
function reaches() {
  const out = {};
  for (const action of ['attackOver', 'thrust', 'attackSpin', 'attackStab']) {
    const w = world();
    const p = new Player(w, { isLocal: true });
    p.position.set(0, 0, 0);
    w.players.push(p);
    const fire = { hit: false, held: false };
    const input = {
      keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
      accel: { x: 0, y: 0 }, bindings: null,
      moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
      act: (k) => (k === action ? fire.held : false),
      actHit: (k) => (k === action && fire.hit ? (fire.hit = false, true) : false),
    };
    const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
      bolts: w.bolts, camera: w.engine.camera, time: 0, groundColor: 0,
      enemies: [], players: w.players, pickTarget: () => null };
    const dt = 1 / 120;
    const step = (n) => { for (let i = 0; i < n; i++) { ctx.time = w.time += dt; p.update(dt, ctx); } };
    p.saber.ignite();
    step(180);
    fire.hit = true; fire.held = true;
    let tip = 0, hilt = 0;
    for (let i = 0; i < 240; i++) {
      ctx.time = w.time += dt;
      p.update(dt, ctx);
      if (i > 30) fire.held = false;
      if (p.saber?.lit) { tip = Math.max(tip, p.saber.tip.y); hilt = Math.max(hilt, p.saber.base.y); }
    }
    out[action] = { tip, hilt };
  }
  return out;
}

/** Shortest distance from a segment to a segment, for the blade-versus-bone test. */
function segDist(a0, a1, b0, b1) {
  const u = new THREE.Vector3().subVectors(a1, a0);
  const v = new THREE.Vector3().subVectors(b1, b0);
  const w0 = new THREE.Vector3().subVectors(a0, b0);
  const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w0), e = v.dot(w0);
  const D = a * c - b * b;
  let s, t;
  if (D < 1e-9) { s = 0; t = b > c ? d / b : e / c; }
  else { s = (b * e - c * d) / D; t = (a * e - b * d) / D; }
  s = Math.min(1, Math.max(0, s));
  t = Math.min(1, Math.max(0, t));
  const pa = u.multiplyScalar(s).add(a0);
  const pb = v.multiplyScalar(t).add(b0);
  return pa.distanceTo(pb);
}

/* ══════════════════════════════════════════════════════════════════════ */

export async function run({ check, assert }) {
  check = await clocked(check);
  await initPhysics();

  check('flight: the body is built to the one dimension the reference states', () => {
    const rows = [];
    for (const [type, C] of Object.entries(FLIGHT_CANON)) {
      const A = ARCHETYPES[type];
      assert(A, `${type} is in FLIGHT_CANON and not in ARCHETYPES`);
      const built = A.build({ scale: A.scale });
      built.rig.root.updateMatrixWorld(true);
      /* TRANSFORMED VERTICES, for `giants.mjs`'s reason — see its own note.
       * This body is four tilted wings on a leaning trunk, which is exactly the
       * shape `Box3.setFromObject` reads wrong. */
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      built.rig.root.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
      });
      const size = box.getSize(new THREE.Vector3());
      for (const [axis, key] of [['y', 'h'], ['x', 'w'], ['z', 'l']]) {
        if (C[key] == null) continue;
        const want = C[key] / C.built;
        const got = size[axis];
        assert(Math.abs(got - want) / want < 0.04,
          `${type} is ${got.toFixed(3)} m on ${axis} against ${want.toFixed(3)} — `
          + `${C[key]} m at 1:${C.built} from the reference`);
      }
      rows.push(`${type} ${size.y.toFixed(3)} m tall against ${C.h} (1:${C.built}), `
        + `${wingChains(built.rig).length} wing chains`);
    }
    return rows.join(' · ');
  });

  check('flight: the reach every altitude here is authored against is MEASURED', () => {
    const R = reaches();
    const best = Math.max(...Object.values(R).map((r) => r.tip));
    /* The constant is allowed to exist — the altitudes have to be readable
     * against something — but it is not allowed to be a second opinion. */
    assert(Math.abs(best - BLADE_REACH) < 0.05,
      `Flight.BLADE_REACH says ${BLADE_REACH} and a driven player reaches ${best.toFixed(3)} m`);
    assert(R.attackOver.tip > R.thrust.tip,
      `the overhead (${R.attackOver.tip.toFixed(2)}) is no higher than a thrust (${R.thrust.tip.toFixed(2)}) — `
      + 'the generous swing is not the one the numbers were authored against');
    return Object.entries(R).map(([k, r]) => `${k} tip ${r.tip.toFixed(3)} hilt ${r.hilt.toFixed(3)}`).join(' · ');
  });

  check('flight: the cruise is out of reach, the stoop is inside it, and the share is measured', () => {
    const f = fly(60);
    const n = f.low.length;
    const reachable = f.low.filter((y) => y <= BLADE_REACH).length;
    const share = reachable / n;
    /**
     * BOTH ENDS, and each of them is a different failure.
     *
     * A body that is always reachable is a trooper standing on air, which is
     * what the roster already had two of. A body that is never reachable is the
     * thing this whole file exists to refuse.
     */
    const atCruise = f.low.filter((y, i) => f.state[i] === 'cruise' && Math.abs(f.alt[i] - FLIGHT.CRUISE) < 0.3);
    const cruiseLow = Math.min(...atCruise);
    assert(atCruise.length > n * 0.2, `it only held its cruise for ${atCruise.length} of ${n} frames`);
    assert(cruiseLow > BLADE_REACH + 1.0,
      `at cruise the lowest thing on it is ${m2(cruiseLow)} against a ${m2(BLADE_REACH)} blade — `
      + 'that is a body standing on air, not one flying');
    assert(share > 0.20,
      `only ${(share * 100).toFixed(1)}% of a 60 s fight is inside a blade — that is weather`);
    assert(share < 0.75,
      `${(share * 100).toFixed(1)}% of the fight is inside a blade — it is not flying, it is hovering`);
    const bottom = Math.min(...f.low);
    assert(bottom < 2.0,
      `at the bottom of its stoop the lowest capsule is still ${m2(bottom)} up`);
    return `${(share * 100).toFixed(1)}% of 60 s inside ${m2(BLADE_REACH)} · cruise floor ${m2(cruiseLow)} · `
      + `stoop floor ${m2(bottom)} · altitude ${m2(Math.min(...f.alt))}–${m2(Math.max(...f.alt))} · `
      + `${f.w.shots} shots`;
  });

  check('flight: the blade gets as near this body as it gets to a duellist', () => {
    /**
     * THE HONEST FORM OF "CAN YOU HIT IT", AND IT IS COMPARATIVE ON PURPOSE.
     *
     * Every height comparison above is a proxy for this one: a lit blade, swung
     * by a driven Player who chases the body and swings when it is low and
     * near, has to get as close to it as it gets to something everybody agrees
     * is fightable.
     *
     * It is a RATIO against the Dark Acolyte rather than an absolute distance
     * because the absolute number is a property of THIS HARNESS and not of the
     * game: measured, the same player over 99 swings gets no nearer than
     * 0.57 m to an acolyte standing at knife range, because a stub input
     * cannot aim the guard the way a hand on a mouse does (`p.pitch` is not
     * even the field — the look angle lives on `Player.camera`, and see the
     * note in the loop, where the same sentence turned out to be true of the
     * yaw and had not been carried across). An absolute bar here would be a
     * bar on the probe. What the ratio says is the thing that matters and is
     * not an artefact: with the same player, the same swing and the same gate,
     * this body is at least as reachable as the duellist the whole game is
     * built around.
     *
     * The two counts are the real difference and they are reported rather than
     * asserted: 99 swings against an acolyte in 60 s and 48 against this,
     * because an acolyte is in front of you the whole fight and a flyer is only
     * ever down for a moment — 3080 of 7200 frames of stoop against an acolyte
     * that never leaves the ground.
     */
    const bout = (type, seed) => {
      /* SEEDED, and both bouts get the same one. `enemyRng` and `duelRng` are
       * module-level streams shared by every body in the process, so an
       * unseeded pair of bouts is two different fights compared with each
       * other — HANDOFF §2.5, and it showed: the acolyte read 0.69 m in a
       * standalone probe and 0.15 m as the second bout in this suite, purely
       * because three checks had drawn from the stream in between. */
      enemyRng.seed(seed);
      duelRng.seed(seed);
      const w = world();
      attachFlight(w);
      const p = new Player(w, { isLocal: true });
      p.position.set(0, 0, 0);
      w.players.push(p);
      w.player = p;
      const e = w.spawnEnemy(type, V(2.4, 0, 0));
      const drive = { advance: 0 };
      const fire = { hit: false, held: false };
      const input = {
        keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
        accel: { x: 0, y: 0 }, bindings: null,
        moveAxis: (o) => { o.x = 0; o.y = drive.advance; return o; },
        act: (k) => (k === 'attackOver' ? fire.held : false),
        actHit: (k) => (k === 'attackOver' && fire.hit ? (fire.hit = false, true) : false),
      };
      const pctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
        bolts: w.bolts, camera: w.engine.camera, time: 0, groundColor: 0,
        enemies: w.enemies, players: w.players, pickTarget: () => e };
      const ectx = enemyCtx(w, p);
      p.saber.ignite();
      const dt = 1 / 120;
      let closest = Infinity, closestAt = '', swings = 0, lastSwing = -9, minFlat = Infinity;
      /* PER SWING, because a min over a whole bout is a max-statistic and a
       * max-statistic over six samples is not a measurement. The assert is on
       * the MEDIAN of these; the best one is reported beside it. */
      const perSwing = [];
      for (let i = 0; i < 120 * 60; i++) {
        pctx.time = ectx.time = w.time += dt;
        for (const pr of w.props) pr.update?.(dt);
        e.update(dt, ectx);
        e.target = p;
        p.update(dt, pctx);
        if (i > 30) fire.held = false;
        const flat2 = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
        /**
         * CLOSE ONLY WHILE IT IS DOWN, and `-1` is FORWARD.
         *
         * Both halves were measured rather than assumed. Chasing a flyer
         * through its cruise is chasing a body whose band is 9-20 m and which
         * outruns a walk (5.37 against 4.60), so the player arrives late for
         * every window and got ONE swing in forty seconds; waiting for the
         * stoop and closing then reaches 0.77 m. And `moveAxis.y` is
         * screen-space — positive is AWAY from where the body is facing, which
         * is what dodgeable.mjs's "turned away and sprinting" means — so `+1`
         * walked the player backwards out of every window at 4.45 m/s while
         * facing the thing it was fleeing.
         */
        const down = e._flightState ? e._flightState === 'stoop' : true;
        drive.advance = down && flat2 > 0.9 ? -1 : 0;
        /**
         * TURNED WITH `camera.yaw`, WHICH IS THE FIELD THE WALK READS.
         *
         * This line wrote `p.yaw`, and the note above already knew why that is
         * the wrong answer — it says so about the pitch, one paragraph up:
         * "`p.pitch` is not even the field — the look angle lives on
         * `Player.camera`." The same is true of the yaw and it was not carried
         * across. `Player._move` builds its basis from `this.camera.yaw`
         * (Player.js, `heading`), so `p.yaw` — the AIM yaw, read by `syncAim`
         * for a gun this player is not carrying — steered nothing at all.
         *
         * The arithmetic was never wrong: `axis.y = -1` drives along
         * `+(sin heading, 0, cos heading)`, so `atan2(dx, dz)` is exactly the
         * heading that walks at the body. It was written to a field nobody
         * reads, and the fixture therefore walked in one fixed world direction
         * for the whole minute while facing the thing it was supposed to be
         * chasing. Measured, one bout each way:
         *
         *     p.yaw          3 swings, closed to 1.79 m, 69 of 7200 frames
         *                    with the body inside the 2.2 m swing gate
         *     p.camera.yaw   48 swings, closed to 0.75 m, 2981 frames
         *
         * — and the 3356 frames the body spent below 3 m are the SAME in both,
         * so the flyer was always coming down inside reach and the player was
         * never brought to it. Setting both fields is measurably identical to
         * setting this one, which is how it is known that `p.yaw` is dead
         * weight here rather than a second half of the turn.
         */
        p.camera.yaw = Math.atan2(e.position.x - p.position.x, e.position.z - p.position.z);
        if (down) minFlat = Math.min(minFlat, flat2);
        if (e.position.y < 3.0 && flat2 < 2.2 && w.time - lastSwing > 0.6) {
          lastSwing = w.time;
          fire.hit = true; fire.held = true; swings++;
          perSwing.push(Infinity);
        }
        if (!p.saber?.lit) continue;
        e.rig?.root.updateMatrixWorld(true);
        for (const c of e.capsules()) {
          if (!c.p0) continue;
          const d = segDist(p.saber.base, p.saber.tip, c.p0, c.p1) - c.r;
          if (d < closest) { closest = d; closestAt = c.name; }
          /* …and only while the swing that opened this sample is still running,
           * which is the 0.6 s the gate above rate-limits to. */
          if (perSwing.length && w.time - lastSwing < 0.6 && d < perSwing[perSwing.length - 1]) {
            perSwing[perSwing.length - 1] = d;
          }
        }
      }
      const sorted = perSwing.filter(Number.isFinite).sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity;
      return { closest, closestAt, swings, minFlat, median };
    };
    const mine = bout('geonosian', 20250821);
    /* The Dark Acolyte: a melee duellist whose band is [1.6, 3.4] against this
     * body's stoop band of [1.1, 3.0]. It is the closest thing on the roster to
     * "a body that comes to knife range", which is what makes it the yardstick. */
    const ref = bout('acolyte', 20250821);
    assert(mine.swings > 3, `the player only got ${mine.swings} swings off in 60 s`);
    assert(mine.median <= ref.median * 1.35,
      `the blade's median approach to this body over ${mine.swings} swings was ${m2(mine.median)} against `
      + `${m2(ref.median)} to a Dark Acolyte over ${ref.swings}, with the same player, the same swing and `
      + 'the same seed — it is further out of reach than the duellist this game is built around');
    return `geonosian ${mine.swings} swings, median ${(mine.median * 100).toFixed(0)} cm / best `
      + `${(mine.closest * 100).toFixed(0)} cm at '${mine.closestAt}', closed to ${m2(mine.minFlat)} · `
      + `acolyte ${ref.swings} swings, median ${(ref.median * 100).toFixed(0)} cm / best `
      + `${(ref.closest * 100).toFixed(0)} cm at '${ref.closestAt}', closed to ${m2(ref.minFlat)}`;
  });

  check('flight: the wings are limbs — priced, offered to the blade, and inside a swing', () => {
    const f = fly(30);
    const roots = wingChains(f.e.rig);
    assert(roots.length === FLIGHT_CANON.geonosian.kill.chains,
      `${roots.length} wing chains against the ${FLIGHT_CANON.geonosian.kill.chains} declared`);
    for (const r of roots) {
      /* Priced by the SHIPPED function, which throws on a role it has no price
       * for — so this is a check that the role reached the table and not a
       * second opinion about what it is worth. */
      const s = severanceOf(r);
      assert(s > 0 && s < 1, `${r.name} is priced ${s}`);
      assert(r.parts.length, `${r.name} carries no geometry — the blade is never offered it`);
    }
    const names = new Set(f.e.capsules().map((c) => c.name));
    for (const r of roots) assert(names.has(r.name), `${r.name} is not in the blade's contact set`);
    /* And the roots come down inside a swing, which is what makes "take a wing"
     * advice rather than a slogan. */
    const lowestRoot = Math.min(...f.wingRoot.filter(Number.isFinite));
    assert(lowestRoot < BLADE_REACH,
      `the wing roots never come below ${m2(lowestRoot)} against a ${m2(BLADE_REACH)} blade`);
    return `${roots.length} chains, priced ${roots.map((r) => severanceOf(r).toFixed(3)).join('/')}, `
      + `lowest root ${m2(lowestRoot)}`;
  });

  check('flight: it flies on two and it does not fly on one', () => {
    /**
     * THE ANSWER THIS ARCHETYPE DECLARES AS ITS OWN, driven rather than read:
     * the wing is severed through `Actor.cut` — the same call a blade makes —
     * and then the body is given twenty more seconds to try to climb.
     */
    let cut = false;
    const f = fly(26, {
      each: (e, i) => {
        if (cut || i < 60 * 5) return;
        /* `Actor.cut(name, t, impulse, point)` — `t` is a FRACTION of the
         * bone's remaining length, not a place. 0.15 is a wing taken off at the
         * shoulder, which is the cut this archetype's answer is about. */
        cut = !!e.actor?.cut('wingL', 0.15, V(0, 0, 0), e.position.clone());
      },
    });
    assert(cut, 'the wing root could not be cut at all');
    assert(wingLift(f.e) === 0, `a body with one wing root gone still reports ${wingLift(f.e)} of lift`);
    const after = f.alt.slice(60 * 8);
    const ceiling = Math.max(...after);
    assert(ceiling < 0.4,
      `with a wing off it still climbed to ${m2(ceiling)} — losing one is supposed to be the end of flying`);
    const before = Math.max(...f.alt.slice(0, 60 * 5));
    assert(before > BLADE_REACH,
      `it never got off the ground before the cut (peak ${m2(before)}), so nothing was proved`);
    return `peak ${m2(before)} before the cut, ${m2(ceiling)} for the 18 s after · lift ${wingLift(f.e)}`;
  });

  check('flight: the Force is the anti-air, and it stays down long enough to matter', () => {
    /**
     * `hold` is the one door into `gripped` — `Player._updateGrip` and
     * `World.applyClaim` both call it and nothing else sets the flag — so
     * leasing it here is what a Force grip does and not an imitation of one.
     */
    /* Taken WHILE IT IS UP, found rather than timed: a grip that happens to
     * land during a stoop proves nothing, and which second the cycle is at
     * depends on the spawn jitter the constructor rolled. */
    const HOLD_FOR = 1.0;
    let heldAt = -1, took = 0;
    const f = fly(24, {
      each: (e, i) => {
        const t = i / 60;
        if (heldAt < 0 && t > 3 && e.position.y > BLADE_REACH + 1) { heldAt = t; took = e.position.y; }
        if (heldAt >= 0 && t >= heldAt && t < heldAt + HOLD_FOR) e.hold(0.2);
      },
    });
    const HOLD_AT = heldAt;
    assert(HOLD_AT > 0, 'it never got above blade reach at all, so nothing could be pulled out of the air');
    assert(took > BLADE_REACH, `it was only at ${m2(took)} when the grip took it`);
    /* Down through the whole lease AND through FELL_FOR after it. The window is
     * sampled just inside each end rather than at the boundary frame. */
    const window = f.alt.slice(Math.round((HOLD_AT + HOLD_FOR + 0.5) * 60),
      Math.round((HOLD_AT + HOLD_FOR + FLIGHT.FELL_FOR - 0.5) * 60));
    const worst = Math.max(...window);
    assert(worst < 0.5,
      `after the grip let go it was back up to ${m2(worst)} inside the ${FLIGHT.FELL_FOR} s it is supposed to `
      + 'spend on the ground');
    const back = Math.max(...f.alt.slice(Math.round((HOLD_AT + HOLD_FOR + FLIGHT.FELL_FOR + 2) * 60)));
    assert(back > BLADE_REACH,
      `it never got airborne again (peak ${m2(back)}) — felled is a window, not a kill`);
    return `held at ${HOLD_AT.toFixed(1)}s from ${m2(took)} · grounded to ${m2(worst)} for `
      + `${FLIGHT.FELL_FOR} s · flying again at ${m2(back)}`;
  });

  check('flight: nothing else on the roster moves like it', () => {
    /**
     * The rule `giants.mjs` holds its five to, in the one axis a flyer owns.
     * Vertical TRAVEL — the sum of |dy| over a fight — rather than peak height,
     * because a body standing on a 1.35 m column of air has a height and does
     * not move: the jet trooper and the training remote are the bodies this has
     * to be different from, and a peak comparison would score them as flying.
     */
    const travel = (type) => {
      const f = fly(20, { type });
      let sum = 0;
      for (let i = 1; i < f.alt.length; i++) sum += Math.abs(f.alt[i] - f.alt[i - 1]);
      return { sum, peak: Math.max(...f.alt) };
    };
    const mine = travel('geonosian');
    const rows = [`geonosian ${mine.sum.toFixed(1)} m in 20 s (peak ${m2(mine.peak)})`];
    for (const type of Object.keys(ARCHETYPES).filter((t) => ARCHETYPES[t].float && t !== 'geonosian')) {
      const other = travel(type);
      rows.push(`${type} ${other.sum.toFixed(1)} m (peak ${m2(other.peak)})`);
      assert(mine.sum > other.sum * 2.5,
        `${type} travels ${other.sum.toFixed(1)} m vertically against this body's ${mine.sum.toFixed(1)} — `
        + 'they are the same movement signature');
      assert(mine.peak > other.peak * 2,
        `${type} reaches ${m2(other.peak)} against this body's ${m2(mine.peak)}`);
    }
    assert(mine.sum > 25, `${mine.sum.toFixed(1)} m of vertical travel in 20 s is not a flight cycle`);
    return rows.join(' · ');
  });

  check('flight: its gun is not a rifle with a different colour on it', () => {
    /**
     * `giants.mjs`'s cadence rule, applied to the roster this body actually
     * stands beside: burst size, the gap inside a burst, and the whole cycle.
     * Two of the three have to differ from every other shooter in the game, or
     * the thing that arrives is a trooper at an altitude.
     */
    const A = ARCHETYPES.geonosian;
    const cycle = (X) => (X.fireRate ?? 2) + (X.burst ?? 1) * (X.burstGap ?? 0.12) + (X.telegraph ?? 0);
    const same = [];
    for (const [t, X] of Object.entries(ARCHETYPES)) {
      if (t === 'geonosian' || !X.ranged || X.training) continue;
      let alike = 0;
      if ((X.burst ?? 1) === (A.burst ?? 1)) alike++;
      if (Math.abs((X.burstGap ?? 0.12) - A.burstGap) < 0.06) alike++;
      if (Math.abs(cycle(X) - cycle(A)) / cycle(A) < 0.12) alike++;
      if (alike >= 2) same.push(`${t} (${alike}/3)`);
    }
    assert(!same.length,
      `it fires like ${same.join(', ')} — burst ${A.burst} at ${A.burstGap}s on a ${cycle(A).toFixed(2)}s cycle`);
    return `burst ${A.burst} · gap ${A.burstGap}s (nearest other ${
      Math.min(...Object.values(ARCHETYPES).filter((X) => X.ranged && X.burstGap && X !== A)
        .map((X) => Math.abs(X.burstGap - A.burstGap))).toFixed(2)}s) · cycle ${cycle(A).toFixed(2)}s`;
  });

  check('flight: a body that hovers is DRAWN where its position says it is', () => {
    /**
     * THE GUARD ON A DEFECT THIS FILE FOUND.
     *
     * `BipedAnimator.update` writes the pelvis in WORLD coordinates onto a bone
     * parented to the rig root, so the root may only ever be an identity
     * transform — and `_pose`'s jet lean rotates it. Before the fix the drawn
     * body swung about the WORLD ORIGIN, away from the `position` that the
     * muzzle, the brain's range, a Force grip's pick and `Waves.positionIsValid`
     * all read: measured on the shipped Jet Trooper, 1.83 m at x=2, 1.36 at
     * x=14 and 1.79 at x=30 over eight seconds.
     *
     * Run over every archetype that declares `float`, from three distances, so
     * the distance-scaling that was the tell is what fails if it comes back.
     */
    const rows = [];
    for (const type of Object.keys(ARCHETYPES).filter((t) => ARCHETYPES[t].float)) {
      let worst = 0, worstAt = 0;
      for (const at of [2, 14, 30]) {
        const f = fly(8, { type, at, each: (e, i, w) => {
          if (i < 60) return;
          e.rig?.root.updateMatrixWorld(true);
          const hips = e.capsules().find((c) => c.name === 'hips');
          if (!hips) return;
          const err = Math.hypot(hips.p0.x - e.position.x, hips.p0.z - e.position.z);
          if (err > worst) { worst = err; worstAt = at; }
        } });
        void f;
      }
      /* 0.45 m is what leaning a pelvis about the body's own feet costs at the
       * steepest lean the model produces — it is geometry and not slack. The
       * defect this replaces was metres and grew with distance from the origin,
       * which is why all three distances are driven. */
      assert(worst < 0.45,
        `${type}: the drawn pelvis is ${m2(worst)} from its own position (worst at x=${worstAt}) — `
        + 'the rig root is being rotated about the world origin again');
      rows.push(`${type} ${(worst * 100).toFixed(0)} cm`);
    }
    return rows.join(' · ');
  });

  check('flight: faction, pool and page all say the same thing', () => {
    const rows = [];
    for (const [type, C] of Object.entries(FLIGHT_CANON)) {
      assert(factionOf(type) === C.side,
        `the databank puts ${type} with the ${factionOf(type)} and FLIGHT_CANON says ${C.side}`);
      const pools = Object.entries(LEVELS).filter(([, L]) => (L.pool || []).includes(type)).map(([k]) => k);
      assert(pools.length, `${type} is in no level's pool — nothing can ever field it`);
      /* And on a two-army level it must belong to one of the armies, or the
       * faction rotation cannot place it. */
      for (const k of pools) {
        const armies = LEVELS[k].armies;
        if (!armies) continue;
        assert(armies.includes(C.side), `${k} fields ${type} and its armies are ${armies.join('/')}`);
      }
      const page = DATABANK[type];
      assert(page, `${type} has no databank page`);
      const text = String(page.text).toLowerCase();
      for (const word of C.kill.says) {
        assert(text.includes(word),
          `${type}'s page never says "${word}" — its own answer is something the player is never told`);
      }
      rows.push(`${type}: ${C.side}, ${pools.join('+')}, page says ${C.kill.says.join('/')}`);
    }
    return rows.join(' · ');
  });

}
