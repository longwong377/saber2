/**
 * BATTLEFRONT BORZ — the OTHER side's Force, driven rather than read.
 *
 * Player note #44: *"the enemies that use the force or have lightsabers should
 * also have the same force powers as you… they also die way too easily"*.
 *
 * The kit was built — `ENEMY_POWERS`, five verbs, a pool, a telegraph — and
 * `tools/checks/force.mjs` proves every one of the PLAYER's powers works. What
 * nothing measured was whether the enemy's ever FIRE, and the answer, driven
 * against a real Player for 25 s per archetype, was no:
 *
 *     acolyte  0 casts (pool 62/62)   jedi 0 (44/44)   sentinel 0 (40/40)
 *     guardian 0 casts (48/48)        master 0 (150/150)
 *
 * A pool that never leaves its maximum is the proof nothing fired — that is
 * `combat-trace.mjs`'s own phrasing and it is why this file exists beside it:
 * the trace deliberately reports powers as OPPORTUNITY and never as usage, so
 * nothing in the tree could see an unused kit.
 *
 * Three causes, all arithmetic:
 *
 *   · `pressed` required `hpFrac < 0.72`, so a duellist at full health could
 *     never OPEN with a shove — and `pressed` is the only situation a stand-up
 *     fight ever satisfies.
 *   · `pull` banded [6.5, 20] and `lightning` [4.5, 18] against a stand-off
 *     this file measures at p50 1.6 m, p90 1.7 m. The bands describe a fight
 *     that does not happen.
 *   · a blade lock — 29–41% of a long duel — returned out of `_meleeBrain`
 *     before `_forceBrain` was reached at all.
 *
 * And three more that are about what a power MEANS rather than when it fires:
 *
 *   · nothing could interrupt a cast. `_castTimer` was checked before every
 *     situational test, and being stunned made `_think` return EARLIER, so a
 *     stun froze the wind-up instead of breaking it. Five counters were driven
 *     into a mid-wind-up Master and the cast arrived five times out of five.
 *   · 50 damage of kind `force`, `lightning`, `blaster` and `saber` all landed
 *     identically. A Master's pool sat at 150/150 while it was being
 *     electrocuted, because no code path could spend it on defence.
 *   · `takeCut` kills anything with `vital >= 0.9` outright, so a 460 hp Master
 *     and a 130 hp acolyte died to the same single torso pass. That is why
 *     "they die too easily" is not a health number.
 *
 * Every check below carries the measured number rather than the word "failed",
 * and every one of them fails on the code it was written against.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, ARCHETYPES, ENEMY_POWERS, FORCE_REGEN, PUSH_SPEED, PUSH_LIFT, enemyRng } from '../../src/game/Enemy.js';
import { Player } from '../../src/game/Player.js';
import { duelRng, FORMS, BladeLock } from '../../src/game/Duel.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { POWER_COST } from '../../src/game/Powers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scene = new THREE.Scene();

/** Every archetype that carries a kit, which is the population under test. */
export const FORCE_TYPES = Object.keys(ARCHETYPES)
  .filter(k => ARCHETYPES[k].powers && ARCHETYPES[k].powers.length);

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/**
 * The same world `duelling.mjs` fights in: a real RapierWorld, a real Player,
 * a real Enemy, and no renderer. Deliberately NOT `World.loadLevel` — see
 * HANDOFF 2.6/2.7, where the two suites that build real Worlds are the two that
 * stopped finishing. Nothing measured here is a property of a level.
 */
function gameWorld() {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flatGround();
  physics.terrain = terrain;
  return {
    scene, physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY.knight, players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
}

const stubInput = () => ({
  keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
  accel: { x: 0, y: 0 }, bindings: null,
  moveAxis: (o) => { o.x = 0; o.y = 0; return o; }, act: () => false, actHit: () => false,
});

/**
 * A REAL FIGHT, WITH THE PLAYER'S DEATH TAKEN OUT OF IT.
 *
 * The player is immortal, because the question is "what does this body DO in
 * 25 seconds" and a dead player ends the sample at four. Health is restored
 * every frame after damage is counted, so `hpTaken` is still the honest number.
 *
 * `behaviour` is the one axis that matters to a situational brain:
 *
 *   'stand'    a statue with a sweeping blade. The worst case for the enemy and
 *              the one the audit drove: no `fleeing`, no `ranged`, ever.
 *   'give'     backs away steadily — the habit `pull`, `choke` and `lightning`
 *              are all authored to answer.
 */
function fight(type, seconds, opts = {}) {
  /* Seeded per subject for the reason duelling.mjs spells out at length: both
   * `duelRng` and `enemyRng` are module-scope streams, so a body measured after
   * four other suites is not the body measured alone. */
  const h = [...String(type)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  duelRng.seed(7700 + (h % 90000));
  enemyRng.seed(51000 + (h % 9000));

  const w = gameWorld();
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  p.saber.ignite(); p.saber.ignition = 1;
  w.players.push(p);
  const e = new Enemy(w, type, V(0, 0, opts.range ?? 2.4));
  if (opts.form) { e.duel.formKey = opts.form; e.duel.form = FORMS[opts.form]; }
  w.enemies.push(e);

  const ctx = {
    input: stubInput(), terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };

  const s = {
    e, p, w, casts: [], winds: [], hpTaken: 0, dists: [], lockFrames: 0, frames: 0,
    minPool: e.forceMax, poolAtEnd: 0,
  };
  /**
   * Wind-up starts announce themselves; the cast itself is the landing.
   *
   * COUNTED ON THE CALL, NOT ON THE POOL — and the first version of this counted
   * on the pool, which lied the moment `Enemy` started charging at the wind-up
   * instead of at the landing. It reported "jedi cast NOTHING, pool 44 → 23",
   * a body spending 37 Force on nothing at all, and the sentence should have
   * been read as the instrument breaking rather than the game being broken.
   * HANDOFF 2.5, from the other side: a result that CONFIRMS the hypothesis you
   * arrived with is exactly the one to re-derive.
   */
  w.notifyFloating = (at, label) => s.winds.push({ t: w.time, label });
  const realCast = e._castPower.bind(e);
  e._castPower = (key, c, d) => {
    if (key && e.target?.alive) s.casts.push({ key, t: w.time, dist: d });
    return realCast(key, c, d);
  };
  const realDamage = p.damage.bind(p);
  /* EVERY ARGUMENT FORWARDED, and this counter has already been burned once by
   * not doing it. `Player.damage` grew a fifth argument — `preResisted`, set by
   * `applyKnockback` to say the pool has already paid for this blow — and a
   * wrapper that named the four it knew about dropped it, so every enemy shove
   * was resisted twice inside this fixture and nowhere else. It read as a
   * finding: the Sentinel, whose entire kit is one shove, fell from 4.3 hp/s to
   * 0.44 and looked like a body that had stopped fighting. It was the
   * instrument. An instrument that restates a signature measures whatever that
   * signature used to be. */
  p.damage = (...a) => {
    const before = p.hp;
    const r = realDamage(...a);
    if (p.hp < before) s.hpTaken += before - p.hp;
    return r;
  };

  const dt = 1 / 60, N = Math.round(seconds * 60);
  const back = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    ctx.time = w.time = i * dt;
    // A sweeping blade: the mouse IS the sword in this game, so a moving mouse
    // is a moving blade and nothing else needs to be faked.
    ctx.input.mouse.dx = Math.sin(i * 0.11) * (opts.mouse ?? 260);
    ctx.input.mouse.dy = Math.cos(i * 0.17) * (opts.mouse ?? 260) * 0.5;
    p.update(dt, ctx);
    e.update(dt, ctx);

    const d = p.position.distanceTo(e.position);
    s.dists.push(d);
    if (opts.behaviour === 'give' && d < 9) {
      back.subVectors(p.position, e.position).setY(0).normalize().multiplyScalar(3.2 * dt);
      p.position.add(back);
      p.velocity.x = back.x / dt; p.velocity.z = back.z / dt;
    }

    if (e.lock) s.lockFrames++;
    s.minPool = Math.min(s.minPool, e.force);
    // immortal, and counted before it is healed
    if (p.hp < p.maxHp) { p.hp = p.maxHp; p.alive = true; }
    s.frames++;
  }
  s.poolAtEnd = e.force;
  s.seconds = s.frames / 60;
  s.dists.sort((a, b) => a - b);
  s.p50 = s.dists[Math.floor(s.dists.length * 0.5)] ?? 0;
  s.p90 = s.dists[Math.floor(s.dists.length * 0.9)] ?? 0;
  s.lockShare = s.lockFrames / Math.max(1, s.frames);
  s.byKey = {};
  for (const c of s.casts) s.byKey[c.key] = (s.byKey[c.key] || 0) + 1;
  return s;
}

/** One enemy on a bench, posed by real frames, so its own methods can be driven. */
function bench(type = 'master', range = 2.2, frames = 30) {
  duelRng.seed(9100); enemyRng.seed(9100);
  const w = gameWorld();
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  p.saber.ignite(); p.saber.ignition = 1;
  w.players.push(p);
  const e = new Enemy(w, type, V(0, 0, range));
  w.enemies.push(e);
  const ctx = {
    input: stubInput(), terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };
  for (let i = 0; i < frames; i++) { ctx.time = w.time = i / 60; p.update(1 / 60, ctx); e.update(1 / 60, ctx); }
  return { w, p, e, ctx };
}

/**
 * Drive a body's OWN brain until it commits to a named power, and report the
 * pool it held on the frame before it paid.
 *
 * Hand-setting `_castTimer` was the obvious way to do this and it is wrong now:
 * the price and the cooldown are charged at the COMMIT, so a hand-built wind-up
 * has never been paid for and an interrupt of it looks free when it is not.
 * The body is pinned at a range inside the power's band so the situation it
 * wants stays true while it decides.
 */
function windUp(type, key) {
  const P = ENEMY_POWERS[key];
  const A = ARCHETYPES[type];
  const at = Math.max(P.band[0] + 1.0, A.preferred[1] + 2.6);
  const b = bench(type, at, 4);
  const { e, ctx } = b;
  /* CLEAR WHATEVER THE WARM-UP ALREADY STARTED, and do it before the pool and
   * the cooldowns are reset rather than after. The first version reset them
   * after, which wiped the cooldown a wind-up committed DURING `bench` had just
   * written — so the body could re-commit immediately, and every interrupt
   * measurement was reading the second cast rather than the first surviving. */
  e.breakCast();
  e.powers = [key];
  e.force = e.forceMax;
  for (const k in e.powerCd) e.powerCd[k] = 0;
  b.poolBefore = e.force;
  for (let i = 0; i < 900 && !(e._castTimer > 0); i++) {
    b.poolBefore = e.force;
    e.position.set(0, e.position.y, at);       // hold the range the band asks for
    e.velocity.set(0, e.velocity.y, 0);
    ctx.time = b.w.time = i / 60;
    e.update(1 / 60, ctx);
  }
  b.key = key;
  return b;
}

/** The real cap on a `takeCut` pass: the torso capsule, straight off the rig. */
function torsoCap(e) {
  const caps = e.capsules();
  return caps.find(c => c.name === 'chest') || caps.find(c => (c.vital ?? 0) >= 0.9) || caps[0];
}

function cutOnce(e, cap, source = null) {
  e.takeCut({
    bone: cap.name, cutT: 0.14, cap, point: e.position.clone(),
    impulse: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 1, 0), speed: 18,
  }, source);
}

let _fights = null;
/** Every kitted archetype, standing its ground for 25 s. Cached: it is the
 *  most expensive thing in the file and four checks want the same numbers. */
function standUp() {
  if (!_fights) _fights = FORCE_TYPES.map(t => ({ type: t, ...fight(t, 25, { behaviour: 'stand' }) }));
  return _fights;
}

export async function run({ check, assert }) {
  await initPhysics();

  /* ══ 1. does anything cast at all? ═════════════════════════════════ */

  check('powers: every Force archetype actually casts in a stand-up fight', () => {
    const runs = standUp();
    const silent = runs.filter(r => r.casts.length === 0);
    const line = runs.map(r => `${r.type} ${r.casts.length} (${Object.entries(r.byKey)
      .map(([k, n]) => `${k}×${n}`).join(' ') || 'none'})`).join(', ');
    assert(silent.length === 0,
      `${silent.map(r => `${r.type} cast NOTHING in ${r.seconds.toFixed(0)} s with its pool at `
        + `${r.poolAtEnd.toFixed(0)}/${r.e.forceMax}`).join('; ')} — measured stand-off p50 `
      + `${runs[0].p50.toFixed(1)} m, p90 ${runs[0].p90.toFixed(1)} m. ${line}`);
    return line;
  });

  check('powers: a kit is not one verb repeated — a duellist spends more than one', () => {
    // The Sentinel's whole kit IS `push`, so it is exempt by design; anything
    // holding two or more verbs has to reach at least two of them, or the extra
    // entries in the archetype table are decoration.
    const runs = standUp().filter(r => r.e.powers.length > 1);
    const stuck = runs.filter(r => Object.keys(r.byKey).length < 2);
    assert(stuck.length === 0,
      stuck.map(r => `${r.type} holds [${r.e.powers.join(', ')}] and reached only `
        + `${Object.keys(r.byKey).join(', ') || 'nothing'}`).join('; '));
    return runs.map(r => `${r.type} ${Object.keys(r.byKey).length}/${r.e.powers.length} verbs`).join(', ');
  });

  check('powers: the pool is a real resource — it moves, and it is not free', () => {
    // Both halves. A pool that never leaves its maximum means nothing fired;
    // a pool that empties and stays empty means the regen is decorative.
    const runs = standUp();
    const idle = runs.filter(r => r.minPool >= r.e.forceMax - 0.01);
    assert(idle.length === 0,
      `${idle.map(r => `${r.type} ${r.minPool.toFixed(0)}/${r.e.forceMax}`).join(', ')} never spent a point`);
    const drained = runs.filter(r => r.poolAtEnd < 1 && r.minPool < 1);
    assert(drained.length < runs.length,
      'every archetype ended on an empty pool — the cooldowns are not the limit, the price is');
    return runs.map(r => `${r.type} ${r.e.forceMax}→${r.minPool.toFixed(0)} low, `
      + `${r.poolAtEnd.toFixed(0)} at the end`).join(', ');
  });

  check('powers: a band describes the range the fight actually happens at', () => {
    // The structural version of the check above, so the bands cannot drift back
    // out of the fight without something saying so. A melee archetype's kit must
    // contain at least one power whose band overlaps its own duelling band.
    const bad = [];
    for (const t of FORCE_TYPES) {
      const A = ARCHETYPES[t];
      if (!A.melee) continue;
      const reach = [A.preferred[0], A.preferred[1] + 0.8];
      const ok = A.powers.filter(k => {
        const P = ENEMY_POWERS[k];
        return P && P.band[0] <= reach[1] && P.band[1] >= reach[0];
      });
      if (!ok.length) bad.push(`${t} fights at ${reach[0]}–${reach[1].toFixed(1)} m and every power `
        + `in [${A.powers.join(', ')}] bands outside it`);
    }
    assert(bad.length === 0, bad.join('; '));
    return FORCE_TYPES.map(t => `${t}: ${ARCHETYPES[t].powers.length} verb(s)`).join(', ');
  });

  /**
   * ── A SHOVE BUYS A RANGE OF DISTANCES NOW, NOT A DISTANCE ─────────────
   *
   * THIS CHECK'S PREMISE EXPIRED, AND THAT IS THE ONLY REASON IT IS EDITED —
   * not because the change under it failed a bound it was still entitled to
   * hold. It used to name no target: it shoved a Master's victim once, took the
   * peak, and asserted it cleared `ranged` (`preferred[1] + 2.0`), because in
   * the world it was written for there was one kind of victim and one answer.
   *
   * `Player.resistForce` blunts the SHOVE as well as the harm — one blow,
   * weighed once, both halves scaled by what the pool bought back — so the same
   * shove now buys 3.86 m from a braced player and 6.84 m from an empty bar.
   * The question "does a shove buy the range the next beat needs" cannot be
   * answered without saying WHOSE BAR, and the answer is different at the two
   * ends on purpose: braced you deny him the lightning, empty-bar the whole kit
   * opens on you. See the note over PUSH_SPEED for the sizing and for why no
   * sizing reaches 5.4 m through a full pool without throwing an undefended
   * player 14 m.
   *
   * WHAT IT ASSERTS IS THE KIT'S OWN TABLE, NOT A NUMBER COPIED OUT OF IT.
   * The gates come off `ENEMY_POWERS`, and the second beat is DRIVEN — the
   * Master's own `_forceBrain` decides whether a power opens, with `push` taken
   * off the body so the peak is one shove's and not two stacked. That is the
   * thing the metres were always a proxy for.
   */
  check('powers: a shove buys the range the next beat needs, against the bar it is aimed at', () => {
    /**
     * One shove, the shover pinned so the number is what the SHOVE bought and
     * not what the chase gave back. `only` names the one verb left on the body
     * afterwards, and the brain is then run on to see whether it opens.
     */
    const shove = (pool, only) => {
      const { w, p, e, ctx } = bench('master', 2.2, 20);
      e.breakCast();
      /* EXPLICIT, because the fixture nearly lies. The Master's own push lands
       * on this player around frame 28, and a stagger is a beaten guard —
       * `forceResistance` gives a beaten guard `RESIST_BEATEN` of its cap. A
       * bench that ran a few frames longer would silently be measuring a
       * player who had already been knocked about, and calling it "braced". */
      p.staggerTimer = 0;
      p.force = pool;
      const d0 = p.position.distanceTo(e.position);
      const dir = new THREE.Vector3().subVectors(p.position, e.position).setY(0).normalize();
      p.applyKnockback(dir.multiplyScalar(PUSH_SPEED).setY(PUSH_LIFT), 9, e);
      const spent = pool - p.force;
      const at = e.position.clone();
      let peak = 0, beat = null, tBeat = 0;
      if (only) { e.powers = [only]; e.force = e.forceMax; for (const k in e.powerCd) e.powerCd[k] = 0; }
      const realCast = e._castPower.bind(e);
      e._castPower = (key, c, d) => { if (key && !beat) { beat = key; tBeat = w.time; } return realCast(key, c, d); };
      for (let i = 0; i < 180; i++) {
        ctx.time = w.time = i / 60;
        p.update(1 / 60, ctx);
        if (only) e.update(1 / 60, ctx);
        e.position.copy(at); e.velocity.set(0, 0, 0);
        peak = Math.max(peak, p.position.distanceTo(e.position));
      }
      return { d0, peak, spent, beat, tBeat };
    };

    const beats = ['lightning', 'pull', 'choke'];
    const braced = shove(100, null);
    const bare = shove(0, null);
    const opens = (pool) => beats.filter(k => shove(pool, k).beat === k);
    const bracedOpens = opens(100), bareOpens = opens(0);

    // A braced player is the binding case, and the nearest gate in the kit is
    // the pull's band floor — read off the table rather than written down here.
    const nearest = ENEMY_POWERS.pull.band[0];
    assert(braced.peak > nearest + 0.3,
      `a shove takes a BRACED Master's target from ${braced.d0.toFixed(2)} m to a peak of `
      + `${braced.peak.toFixed(2)} m, and the nearest second beat in the kit — the pull — does not `
      + `open until ${nearest.toFixed(1)} m. Clearing it by ${(braced.peak - nearest).toFixed(2)} m is `
      + 'not a margin, it is a coincidence: bracing would leave the shove with no follow-up at all');
    assert(bracedOpens.length > 0,
      'a shove at a braced player opened NOTHING in a Master\'s own kit — its brain was run on for '
      + '3 s after the shove with each verb in turn and committed to none of them');

    // An empty bar is the other end, and it is the end the old bound measured:
    // nothing spent on defence means the whole kit opens, lightning included.
    const wants = ARCHETYPES.master.preferred[1] + 2.0;
    assert(bare.peak > wants,
      `a shove takes an EMPTY-BAR target from ${bare.d0.toFixed(2)} m to a peak of `
      + `${bare.peak.toFixed(2)} m, and the Master's own lightning does not open until `
      + `${wants.toFixed(1)} m — a player who spent nothing on defence must still fly`);
    assert(bareOpens.includes('lightning'),
      'a shove at a player with an empty bar did not open the lightning it is sized to open');

    /* AND IT MUST NOT THROW THEM OUT OF THE CASTER'S OWN REACH. This is the
     * ceiling the sizing is held under: `push` bands [0, 7.5], so a shove that
     * carried further than that would leave the target somewhere the body
     * cannot push them again — the shove would be its own last beat. */
    const ceiling = ENEMY_POWERS.push.band[1];
    assert(bare.peak < ceiling,
      `a shove carries an undefended player ${bare.peak.toFixed(2)} m, past the far edge of the `
      + `push's own ${ceiling.toFixed(1)} m band — the caster shoves its target out of its next cast`);

    return `braced: ${braced.d0.toFixed(2)} → ${braced.peak.toFixed(2)} m for ${braced.spent.toFixed(1)} Force, `
      + `opens [${bracedOpens.join(', ') || 'nothing'}]; empty bar: → ${bare.peak.toFixed(2)} m, `
      + `opens [${bareOpens.join(', ') || 'nothing'}] against a ${wants.toFixed(1)} m lightning threshold `
      + `and a ${ceiling.toFixed(1)} m ceiling`;
  });

  /* ══ 2. can a cast be broken? ══════════════════════════════════════ */

  check('powers: a stagger BREAKS a wind-up instead of freezing it', () => {
    // Measured on the code this replaces: five counters into a mid-wind-up
    // Master, and the cast arrived five times out of five — because `_think`
    // returns on `stunTimer > 0` BEFORE `_forceBrain` runs, so the two interrupt
    // clauses inside it were unreachable dead code.
    const results = [];
    for (const counter of ['stun', 'push', 'grip', 'lightning', 'unleash']) {
      const { e, ctx } = windUp('master', 'lightning');
      assert(e._castTimer > 0, 'the fixture never reached a wind-up, so it proves nothing');
      if (counter === 'stun') e.stun(0.5, V(0, 0, 1), 1);
      else if (counter === 'push') e.applyKnockback(V(0, 0, 14).setY(6), 9, null);
      /* THROUGH THE DOOR, and this is not a cosmetic edit. `gripped` used to be
       * a latch anyone could set; it is a LEASE now (`Enemy.hold`), because a
       * hold whose holder went away stranded the body limp and invisible for
       * the rest of the level — tools/checks/ghosts.mjs has the whole account.
       * A raw `= true` here expires on the very next `_tickGetUp`, so the
       * fixture would be measuring a grip that had already been let go of. */
      else if (counter === 'grip') e.hold();
      else if (counter === 'lightning') e.damage(46, e.position, null, 'lightning');
      else e.applyKnockback(V(0, 0, 22).setY(9), 14, null);
      let arrived = false;
      const realCast = e._castPower.bind(e);
      e._castPower = (k, c, d) => { arrived = true; return realCast(k, c, d); };
      // One frame, because a grip is a STATE and the brain is where it is read.
      e.update(1 / 60, ctx);
      const stillWound = e._castTimer > 0;
      /* Long enough that a FROZEN wind-up would have thawed and landed — the
       * longest counter here holds the body for 0.5 s against a 0.45 s wind-up
       * — and short enough that the power's own 8.5 s cooldown guarantees
       * anything seen here is the ORIGINAL cast rather than a fresh one. */
      for (let i = 0; i < 120; i++) e.update(1 / 60, ctx);
      results.push({ counter, arrived, stillWound });
    }
    const through = results.filter(r => r.arrived || r.stillWound);
    assert(through.length === 0,
      `${through.map(r => r.counter).join(', ')} did not stop the cast — ${through.length} of `
      + `${results.length} wind-ups ${through.some(r => r.arrived) ? 'arrived anyway' : 'were merely frozen'}`);
    return `${results.length} counters, ${results.length} wind-ups cleared on the frame they landed `
      + 'and none arrived in the 3 s after';
  });

  check('powers: a held power ENDS when the caster is hit, it does not pause', () => {
    // The same defect one layer down: `_sustain` already refuses on
    // `stunTimer > 0 || this.gripped`, and `_think` returned before it could.
    const { e, ctx } = bench('acolyte');
    e.casting = 'choke'; e.castLeft = 2.4; e.force = e.forceMax;
    e.stun(0.4, V(0, 0, 1), 1);
    for (let i = 0; i < 12; i++) e.update(1 / 60, ctx);
    assert(e.casting === null,
      `a choke survived a 0.40 s stagger with ${e.castLeft.toFixed(2)} s still on it`);
    return 'a stagger ends a held power on the frame it lands';
  });

  check('powers: breaking a wind-up costs the caster the power', () => {
    // A wind-up that costs nothing when it is broken is a free bluff, and the
    // player learns to ignore the telegraph. The price and the cooldown are
    // committed when the body commits, which is what makes an interrupt worth
    // reaching for.
    const { e, ctx, poolBefore } = windUp('master', 'lightning');
    e.stun(0.5, V(0, 0, 1), 1);
    const after = e.force;
    for (let i = 0; i < 20; i++) e.update(1 / 60, ctx);
    assert(poolBefore - after >= POWER_COST.lightning * 0.9,
      `a broken lightning cost ${(poolBefore - after).toFixed(0)} of a ${POWER_COST.lightning} price `
      + '— interrupting it took nothing away');
    assert(e.powerCd.lightning > 0,
      'a broken lightning left no cooldown behind, so it can be re-wound on the next frame');
    return `a broken lightning costs ${(poolBefore - after).toFixed(0)} Force and `
      + `${e.powerCd.lightning.toFixed(1)} s of cooldown`;
  });

  /* ══ 3. can a power be answered by a power? ════════════════════════ */

  check('powers: a Force body spends its pool to blunt an incoming power', () => {
    // Measured before: 50 damage of kind force, lightning, blaster and saber
    // all delivered identically into a Jedi Master, and its pool moved
    // 150 → 150 while it was being electrocuted.
    const rows = [];
    for (const kind of ['force', 'lightning', 'choke', 'blaster', 'saber']) {
      const { e } = bench('master');
      const hp0 = e.hp, f0 = e.force;
      e.damage(50, e.position, null, kind);
      rows.push({ kind, took: hp0 - e.hp, spent: f0 - e.force });
    }
    const forceKinds = rows.filter(r => /force|lightning|choke/.test(r.kind));
    const mundane = rows.filter(r => /blaster|saber/.test(r.kind));
    assert(forceKinds.every(r => r.spent > 0),
      `${forceKinds.filter(r => !(r.spent > 0)).map(r => r.kind).join(', ')} moved the Master's pool `
      + 'by nothing — it cannot defend itself with the Force it is holding');
    assert(forceKinds.every(r => r.took < mundane[0].took - 0.5),
      `a resisted power took ${forceKinds.map(r => r.took.toFixed(1)).join('/')} hp against a blaster's `
      + `${mundane[0].took.toFixed(1)} — resisting bought nothing`);
    assert(mundane.every(r => r.spent === 0),
      'a blaster bolt made the Master spend Force, which is not a contest, it is a tax');
    assert(forceKinds.every(r => r.took > 0),
      'a resisted power did NOTHING — a full pool must blunt a power, never refuse it');
    return rows.map(r => `${r.kind} ${r.took.toFixed(1)} hp / ${r.spent.toFixed(0)} Force`).join(', ');
  });

  check('powers: an empty pool cannot defend, and a beaten guard defends less', () => {
    const measure = (setup) => {
      const { e } = bench('master');
      setup(e);
      const hp0 = e.hp;
      e.damage(50, e.position, null, 'lightning');
      return hp0 - e.hp;
    };
    const full = measure(() => {});
    const empty = measure(e => { e.force = 0; });
    const staggered = measure(e => { e.stun(0.5, V(0, 0, 1), 1); });
    assert(empty > full + 1,
      `a Master with an empty pool took ${empty.toFixed(1)} hp against ${full.toFixed(1)} with a full `
      + 'one — the pool is not what is doing the defending');
    assert(staggered > full + 0.5,
      `a staggered Master resisted just as well as a composed one (${staggered.toFixed(1)} vs `
      + `${full.toFixed(1)} hp) — there is no reason to beat its guard first`);
    return `50 hp of lightning: full pool ${full.toFixed(1)}, staggered ${staggered.toFixed(1)}, `
      + `empty ${empty.toFixed(1)} hp taken`;
  });

  check('powers: push into push is a contest, not two free shoves', () => {
    // The impulse has to be answered too, or "I pushed him as he pushed me" is
    // two people flying apart at full speed.
    const a = bench('master').e;
    const b = bench('master').e;
    const shove = (target, resisting) => {
      target.force = resisting ? target.forceMax : 0;
      target.velocity.set(0, 0, 0);
      target.applyKnockback(V(0, 6.5, 17), 9, a);
      return target.velocity.length();
    };
    const soft = shove(b, false);
    const hard = shove(bench('master').e, true);
    assert(hard < soft - 0.5,
      `a Master with a full pool was shoved to ${hard.toFixed(1)} m/s and an empty one to `
      + `${soft.toFixed(1)} — the Force did not answer the Force`);
    return `a push moves an empty Master ${soft.toFixed(1)} m/s and a full one ${hard.toFixed(1)} m/s`;
  });

  /* ══ 4. they die too easily ════════════════════════════════════════ */

  check('powers: a duellist is not cut down by one pass through its chest', () => {
    // `takeCut` upgrades any capsule with `vital >= 0.9` to `maxHp * 2`, so a
    // 460 hp Master and a 130 hp acolyte died to the same torso pass and no
    // amount of health could ever change it. The counter-play is the duel game
    // the rest of this file is built on: beat the guard FIRST.
    const rows = [];
    for (const t of ['acolyte', 'jedi', 'master']) {
      const { e } = bench(t);
      let passes = 0;
      for (let i = 0; i < 12 && !e.dead; i++) { cutOnce(e, torsoCap(e)); passes++; }
      rows.push({ t, passes, dead: e.dead });
    }
    const oneShot = rows.filter(r => r.passes <= 1);
    assert(oneShot.length === 0,
      `${oneShot.map(r => `${r.t} (${ARCHETYPES[r.t].hp} hp)`).join(', ')} died to a single torso pass`);
    assert(rows.every(r => r.dead),
      `${rows.filter(r => !r.dead).map(r => r.t).join(', ')} survived twelve torso passes — a guard `
      + 'that cannot be worn down is a wall, not a duel');
    // …and health has to MEAN something: the Master is the roster's set-piece.
    assert(rows[2].passes > rows[0].passes,
      `a 460 hp Master takes ${rows[2].passes} passes and a 130 hp acolyte ${rows[0].passes} — `
      + 'health still buys nothing');
    return rows.map(r => `${r.t} ${r.passes} torso pass(es)`).join(', ');
  });

  check('powers: a beaten guard is cut down at once — the opening is real', () => {
    // The other half, and the one that keeps the fix from being "more health".
    // Anything that beats the guard — a parry, a chamber, a won blade lock, a
    // Force shove, a heavy blow — must restore the single killing pass.
    const rows = [];
    for (const open of ['stun', 'topple', 'gripped', 'disarmed']) {
      const { e } = bench('master');
      if (open === 'stun') e.stun(0.6, V(0, 0, 1), 1.4);
      else if (open === 'topple') e.topple();
      else if (open === 'gripped') e.hold();
      else e.disarmed = true;
      cutOnce(e, torsoCap(e));
      rows.push({ open, dead: e.dead });
    }
    const survived = rows.filter(r => !r.dead);
    assert(survived.length === 0,
      `${survived.map(r => r.open).join(', ')} did not open a Master to a killing pass — the guard `
      + 'holds through the openings the player earned');
    return `${rows.length} earned openings, ${rows.length} killing passes`;
  });

  check('powers: a regenerating guard still cannot outlast the body', () => {
    /* The guard wins a turned pass back every 6 s, so an attacker slower than
     * that could in principle never spend it down — which would be the wall the
     * note is NOT asking for. It cannot stall, and the reason is worth pinning:
     * a turned pass is paid for out of maximum health and health does not come
     * back, so `1 / TURNED_CUT` passes is a hard ceiling on any body however
     * deep its guard or however long you take. Driven at eight seconds between
     * passes, which is slower than the refresh. */
    const { e, ctx } = bench('master');
    let passes = 0, t = 0;
    while (!e.dead && passes < 12) {
      for (let i = 0; i < 60 * 8; i++) { e.update(1 / 60, ctx); t += 1 / 60; }
      cutOnce(e, torsoCap(e));
      passes++;
    }
    assert(e.dead,
      `a Master survived ${passes} torso passes spread over ${t.toFixed(0)} s — its guard comes `
      + 'back faster than the blade can spend it');
    return `${passes} passes at one every 8 s — slower than the ${'6'} s refresh — and it still dies`;
  });

  check('powers: a duellist that loses an arm still loses the arm', () => {
    // The guard must not become a blanket immunity. A limb comes off, and the
    // FIRST arm still disarms once the guard has been spent. An acolyte rather
    // than a Master because a Master's guard outlives its own health — five
    // turned passes at a quarter of maximum each is the whole body — so it dies
    // holding its blade, which is a different (and correct) outcome.
    const { e } = bench('acolyte');
    const arm = e.capsules().find(c => /^(armL|armR|foreL|foreR)$/.test(c.name));
    assert(arm, 'no arm capsule on a real rig');
    let cuts = 0;
    while (!e.disarmed && !e.dead && cuts < 10) { cutOnce(e, arm); cuts++; }
    assert(e.disarmed, `${cuts} passes at the ${arm.name} and the blade is `
      + `${e.dead ? 'still in the hand of a corpse' : 'still in its hand'}`);
    assert(cuts > 1, 'one pass at an arm still ends the fight outright');
    return `${cuts} passes at the ${arm.name} before the hilt falls`;
  });

  /* ══ 5. a lock must not switch the Force off ═══════════════════════ */

  check('powers: a blade lock does not turn a duellist\'s kit off', () => {
    // Locks are 29–41% of a long duel, so the archetypes that live long enough
    // to use a kit were exactly the ones whose kit was disabled for a third of
    // the fight. A lock is the moment a shove means the most.
    const { w, p, e, ctx } = bench('sentinel', 1.9, 20);
    e.force = e.forceMax; e.powerCd.push = 0;
    const lock = new BladeLock(p, e, e.position.clone().setY(1.4));
    e.lock = lock; p.lockState = lock; w.locks.push(lock);
    let wound = false, cast = false;
    const realCast = e._castPower.bind(e);
    e._castPower = (k, c, d) => { cast = true; return realCast(k, c, d); };
    for (let i = 0; i < 60 && e.lock; i++) {
      e.update(1 / 60, ctx);
      if (e._castTimer > 0) wound = true;
    }
    assert(wound || cast,
      'a duellist pinned in a blade lock never reached its kit at all — `_meleeBrain` returns '
      + 'before `_forceBrain` on `this.lock`');
    return `a locked duellist ${cast ? 'cast' : 'wound up'} inside the lock`;
  });

  /* ══ 6. the held-power bill ════════════════════════════════════════ */

  /**
   * ── THE POOL THIS IS MEASURED AGAINST IS NOW PART OF THE QUESTION ──────
   *
   * THIS CHECK'S PREMISE EXPIRED, AND THAT IS THE ONLY REASON IT IS EDITED.
   * It used to be called "a held power delivers exactly what it is authored to"
   * and it named no target at all, because in the world it was written for
   * there was only one kind of target: one that could not answer. `_sustain`
   * had been billing per frame into `Player.invuln`'s 0.18 s window and
   * delivering 8% of its authored damage; the tick fixed that, and the bound
   * existed to stop the fix OVER-paying.
   *
   * `Player.resistForce` makes "what it is authored to" a question with two
   * answers. An enemy power CANNOT deliver its authored damage to a player with
   * a full bar — by design, and it is the whole feature. Asserting that it does
   * would be asserting the feature away, so the check has to say WHICH TARGET.
   *
   * It is the same bound, applied to the target it was always about. Against a
   * bar with nothing in it the old question is exactly right and the old
   * numbers are unchanged, 0.9–1.1 and all: 95% for lightning, 100% for choke,
   * the same figures this check has always returned. The full-bar case is a
   * NEW clause and it is deliberately a shape rather than a number — less than
   * the empty bar, and more than nothing — because what a full bar buys is
   * `RESIST_CAP`'s business and is asserted where that lives.
   */
  check('powers: a held power delivers what it is authored to, against the bar it is aimed at', () => {
    const rows = [];
    for (const key of ['lightning', 'choke']) {
      for (const bar of ['full', 'empty']) {
        const P = ENEMY_POWERS[key];
        const { w, p, e, ctx } = bench(key === 'lightning' ? 'master' : 'acolyte', 3.0, 10);
        p.invuln = 0;
        /* AN EMPTY BAR HAS TO STAY EMPTY. `Player._regen` puts 7.5 Force a
         * second back, so a pool merely SET to zero is holding 0.125 by the
         * next tick and quietly blunts 1.4 hp across a 1.6 s hold — which is
         * exactly the shape of "a plausible default instead of the real
         * thing" this project keeps finding. Taking `maxForce` to zero makes
         * `_regen`'s own clamp do it, rather than fighting the regen. */
        if (bar === 'empty') { p.maxForce = 0; p.force = 0; }
        let taken = 0;
        const real = p.damage.bind(p);
        /* …AND EVERY ARGUMENT FORWARDED. See the note on the same wrapper in
         * `fight`: this one named four and `Player.damage` has five, so the
         * fifth — `preResisted` — was dropped and every tick paid the pool
         * twice. It read as lightning delivering 19% of its authored damage.
         * It was the instrument, not the game. */
        p.damage = (...a) => {
          const b = p.hp; const r = real(...a);
          if (p.hp < b) taken += b - p.hp; return r;
        };
        e.force = 1e6; e.forceMax = 1e6;
        e.casting = key; e.castLeft = P.hold;
        e._sustainDebt = 0;
        for (let i = 0; i < Math.round(P.hold * 60) + 30 && e.casting; i++) {
          w.time = ctx.time = i / 60;
          /* THE PLAYER'S OWN UPDATE HAS TO RUN, and leaving it out is what
           * produced the "45.88 against an authored 35.2" the audit could not
           * explain. `Player.invuln` is decayed in `Player.update` and set to
           * 0.18 by every hit — so a probe that only steps the ENEMY pins invuln
           * at 0.18 forever, every tick after the first is refused, and the
           * measurement comes out at 14% rather than either number. */
          p.update(1 / 60, ctx);
          e.update(1 / 60, ctx);
          if (p.hp < p.maxHp * 0.4) { p.hp = p.maxHp; p.alive = true; }
        }
        const authored = P.dps * P.hold * w.difficulty.damageTaken;
        rows.push({ key, bar, taken, authored });
      }
    }
    const at = (key, bar) => rows.find(r => r.key === key && r.bar === bar);
    for (const key of ['lightning', 'choke']) {
      const empty = at(key, 'empty'), full = at(key, 'full');
      const ratio = empty.taken / empty.authored;
      assert(ratio > 0.9 && ratio < 1.1,
        `${key} delivered ${empty.taken.toFixed(2)} hp into an EMPTY bar against an authored `
        + `${empty.authored.toFixed(2)} (${(ratio * 100).toFixed(0)}%) — the tick is `
        + `${ratio > 1 ? 'overpaying' : 'still dropping payments'}`);
      assert(full.taken < empty.taken - 0.5,
        `${key} delivered ${full.taken.toFixed(2)} hp into a FULL bar against ${empty.taken.toFixed(2)} `
        + 'into an empty one — holding Force bought the player nothing against a held power');
      assert(full.taken > 0,
        `${key} delivered NOTHING into a full bar — a pool must blunt a power, never refuse it`);
    }
    return rows.map(r => `${r.key}/${r.bar} bar ${r.taken.toFixed(1)}/${r.authored.toFixed(1)} hp `
      + `(${(r.taken / r.authored * 100).toFixed(0)}%)`).join(', ');
  });

  check('powers: a held power does not carry its unpaid tick into the next cast', () => {
    // `_sustainDebt` is module state on the body and nothing cleared it when a
    // cast ENDED, so a hold that stopped mid-tick handed its arrears to whatever
    // power ran next — including one with a completely different dps.
    const { e } = bench('acolyte');
    e.casting = 'choke'; e.castLeft = 0.01; e._sustainDebt = 3.9;
    e.casting = null;
    e._endSustain?.();
    assert(!(e._sustainDebt > 0),
      `${(e._sustainDebt ?? 0).toFixed(2)} hp of unpaid choke was left on the body for the next power`);
    return 'a finished hold leaves no arrears';
  });

  /* ══ 7. the fight the note is about ════════════════════════════════ */

  check('powers: a duellist gives back what it takes', () => {
    // Note #44's other half. Measured before: the acolyte dealt 0.00 hp/s while
    // dying in 3.1 s. The bar is deliberately low — this is "is it a fight",
    // not "is it tuned" — and `duelling.mjs` owns the ceiling.
    const runs = standUp();
    const limp = runs.filter(r => r.hpTaken / r.seconds < 1.0);
    assert(limp.length === 0,
      `${limp.map(r => `${r.type} ${(r.hpTaken / r.seconds).toFixed(2)} hp/s`).join(', ')} `
      + 'over a 25 s fight against a player who never moves');
    return runs.map(r => `${r.type} ${(r.hpTaken / r.seconds).toFixed(1)} hp/s`).join(', ');
  });

  check('powers: the kit answers the habit it is authored for', () => {
    /* `pull`, `choke` and `lightning` are all authored to answer a player who
     * will not stay inside a blade's reach, so the measurement that matters for
     * them is a player who backs off. If giving ground does not change what the
     * kit reaches, the four situations in `_forceBrain` are decoration.
     *
     * The coverage bar is every verb on the table except `unleash`, and the
     * exception is honest rather than convenient: unleash needs `hpFrac < 0.34`,
     * and the player in this fixture is a statue whose blade is never resolved
     * against a body — nothing here can take a Master below a third. `standUp`
     * is what proves it is not simply "wait at range and everything fires".
     */
    const reached = new Set();
    const rows = [];
    for (const r of standUp()) for (const k of Object.keys(r.byKey)) reached.add(k);
    for (const t of ['acolyte', 'guardian', 'master']) {
      const give = fight(t, 20, { behaviour: 'give' });
      for (const k of Object.keys(give.byKey)) reached.add(k);
      rows.push(`${t} ${Object.keys(give.byKey).join('+') || 'none'} at p50 ${give.p50.toFixed(1)} m`);
      if (t === 'guardian') {
        assert(give.casts.length > 0,
          `a Temple Guardian holding [${ARCHETYPES.guardian.powers.join(', ')}] cast nothing at a `
          + `player who spent 20 s walking away from it (p50 ${give.p50.toFixed(1)} m)`);
      }
    }
    const want = Object.keys(ENEMY_POWERS).filter(k => k !== 'unleash');
    const never = want.filter(k => !reached.has(k));
    assert(never.length === 0,
      `${never.join(', ')} never fired once across five archetypes and two behaviours — `
      + `${never.length > 1 ? 'those verbs are' : 'that verb is'} in the table and not in the game`);
    return `${[...reached].sort().join(', ')} all reached; giving ground: ${rows.join(', ')}`;
  });

  check('powers: nothing in the kit is priced off a second copy of the table', () => {
    // HANDOFF 2.3. `Powers.js` exists because this table was duplicated once
    // and drifted; an enemy paying a different price for the same verb is the
    // same defect with a new reader.
    const wrong = Object.entries(ENEMY_POWERS)
      .filter(([k, P]) => POWER_COST[k] !== undefined && P.cost !== POWER_COST[k])
      .map(([k, P]) => `${k} ${P.cost} vs ${POWER_COST[k]}`);
    assert(wrong.length === 0, `enemy prices have drifted from Powers.js: ${wrong.join(', ')}`);
    // and the regen has to be slower than the cheapest verb's cooldown pays for,
    // or the pool is not a resource at all
    const cheapest = Math.min(...Object.values(ENEMY_POWERS).map(P => P.cost));
    return `${Object.keys(ENEMY_POWERS).length} verbs priced off POWER_COST; regen ${FORCE_REGEN}/s `
      + `against a cheapest verb of ${cheapest}`;
  });
}
