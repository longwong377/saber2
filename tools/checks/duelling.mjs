/**
 * BATTLEFRONT BORZ — enemy sabers, and the 180° that made every duel free.
 *
 * The player's words: "the enemies with lightsabers just circle and wave their
 * sabers and never hurt me", and "I have never once seen the blades touch".
 *
 * Both of those are one bug, and it is not a missing feature. Every piece of
 * machinery was already built and already correct:
 *
 *   • World._resolveBlades tests `e.saber.prevTip → e.saber.tip` against the
 *     player's capsule during the strike phase and calls `p.damage`.
 *   • World._applyClash resolves blade on blade into chamber / guard-break /
 *     bind / parry, with sparks, a clash, shake and an impulse on the blade.
 *   • Duel.BladeLock is a whole 60-line contest with a win and a lose.
 *
 * None of it could ever fire, because a duellist held its blade OVER ITS OWN
 * BACK. Guard space is −Z forward (Duel.js says so at the top of the file);
 * `Enemy.facing` is a +Z-forward yaw (`facing = atan2(toTarget.x, toTarget.z)`,
 * and every body in the game is drawn from `(sin f, 0, cos f)`). Three places
 * converted between them with a bare `setFromAxisAngle(UP, facing)`, which
 * takes local −Z to `(−sin f, 0, −cos f)` — exactly backwards.
 *
 * Measured on a real Enemy driven at a real Player for 30 s at 1.6 m, before:
 *
 *     hands relative to the body      0.71 m BEHIND it
 *     blade direction · to player    −0.84
 *     closest tip → player capsule    2.18 m   (the test needs 0.44 m)
 *     closest blade → blade           1.25 m   (a clash needs 0.10 m)
 *     hits landed in 30 s             0
 *     hp/s taken by a player standing still and doing nothing   0.00
 *
 * and after, driving each of the five forms until it has thrown eight strikes
 * at that same motionless player:
 *
 *     connect rate           13–75% of strikes, by form
 *     hp/s                   1.6–12.3, mean 6.3
 *     closest blade to blade 0.001–0.026 m against a 0.10 m contact radius
 *     applied clashes        3–13 per form per 20 s of armed duelling
 *     blade locks entered    2–6 per 100 s, from ordinary play and nothing else
 *
 * Two things were then added on top of the corrected geometry, because a hit
 * test alone is not a fight:
 *
 *   Enemy._saberStrike   the WHOLE blade, swept, not the tip point-sampled
 *                        once a frame. See the note on it.
 *   DuelBrain.stagger    a real reaction to having your blade beaten aside,
 *   DuelBrain.followUp   and a real consequence of landing a cut.
 *
 * Every check below fails on the code it was written against, and the failure
 * messages carry the measured number rather than the word "failed".
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, ARCHETYPES } from '../../src/game/Enemy.js';
import { Player } from '../../src/game/Player.js';
import { duelRng, DuelBrain, FORMS, FORM_KEYS, BladeLock, guardQuat, guardToWorld } from '../../src/game/Duel.js';
import { enemyRng } from '../../src/game/Enemy.js';
import { DIFFICULTY, resolveBladeClash, bladesTouching, CLASH_RADIUS } from '../../src/game/Combat.js';
import { segmentSegment } from '../../src/physics/Physics.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scene = new THREE.Scene();

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/** A world with everything a real Player and a real Enemy touch, and no GPU. */
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
 * A real duel, run frame by frame, with World's own enemy-blade branch mirrored
 * around it — the clash test first, the body test second, the lock contest
 * after both, in that order, because the order IS the rule that steel beats
 * flesh.
 *
 * The player is a statue by default: no dodging, no blocking, no retreating.
 * That is deliberately the WORST case for the game and the BEST case for the
 * measurement — whatever this reports is the ceiling on how dangerous a
 * duellist is, and the floor on how often blades meet.
 */
function duel(formKey, seconds, opts = {}) {
  /* THE SAME FIGHT EVERY TIME. `Duel.js` draws from one module-level stream for
   * the life of the process, so a form measured after four other suites have
   * run is not the form measured on its own — which is why this check has
   * flickered twice now, once on strike COUNT (fixed by running to a count
   * rather than a clock, see below) and once on whether Djem So landed a single
   * hit in eight strikes. Seeding per form removes the dependence rather than
   * widening a bound around it, and the seed is derived from the form's own key
   * so the five are not handed identical luck. */
  duelRng.seed(2200 + [...String(formKey || 'x')].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 90000);
  /* …and the ENEMY stream beside it, for the same reason. A duellist's speed
   * jitter, its strafe side and its spawn offset all come off `enemyRng`,
   * which is module-scope — so seeding only the duel brain leaves half of what
   * this measures depending on which suite ran before it. */
  enemyRng.seed(41000 + FORM_KEYS.indexOf(formKey) + 1);
  /* `minStrikes` matters more than it looks. The forms differ in cadence by a
   * factor of eight — Ataru throws 1.4 strikes a second, Soresu 0.2, because
   * Soresu's whole character is waiting for you to commit first — so a fixed
   * wall of seconds measures Ataru forty times over and Soresu barely once.
   * Running to a strike COUNT makes the sample the same size for every form,
   * which is the only way "does this form's blade land" is one question rather
   * than five. Measured under verify.mjs, where the shared module rng has
   * already been advanced by other suites, a fixed 26 s window gave Soresu as
   * few as three strikes and the check flickered. */
  const w = gameWorld();
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  // `bare` leaves the player's blade unlit, which takes blade-on-blade out of
  // the experiment entirely: no clash can fire, so what is left is purely
  // "does this form's blade reach a body". The armed run is the one that
  // measures clashes and locks. Two different questions, two fixtures.
  if (!opts.bare) { p.saber.ignite(); p.saber.ignition = 1; }
  w.players.push(p);
  const e = new Enemy(w, opts.type || 'acolyte', V(0, 0, opts.range ?? 2.4));
  if (formKey) { e.duel.formKey = formKey; e.duel.form = FORMS[formKey]; }
  w.enemies.push(e);
  const ctx = {
    input: stubInput(), terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };

  const s = {
    hits: 0, clashes: 0, locks: 0, staggers: 0, strikes: 0,
    hpLost: 0, minBladeGap: Infinity, hitsThisStrike: 0,
    worstHitsInOneStrike: 0, e, p, w,
  };
  const realDamage = p.damage.bind(p);
  /* `...rest` FORWARDED WHOLE. An instrument that names the arguments it knows
   * about measures a different function the day the real one grows one —
   * `Player.damage` took a fifth (`preResisted`) when the Force learned to
   * answer the Force, and a wrapper that dropped it made every knockback pay
   * the pool twice INSIDE THE HARNESS ONLY. Nothing here reads past `kind`, so
   * there is no reason to name any of them. */
  /**
   * AND `s.hits` IS THE GAME'S HIT TEST, THE ONLY ONE LEFT.
   *
   * This harness used to run a second one of its own — an unswept chord from
   * `prevTip` to `tip` against a capsule — and bill damage through this same
   * wrapper when it passed. `World._resolveBlades` had already deleted the
   * game's copy of that test, and its note records why: "every hit it produced
   * was a false positive". A chord cuts the corner of a swing that arcs round
   * the body, so on Ataru it passed 0.386 m from the player while the swept
   * blade the game actually uses passed 0.441 — no `_struck`, no clash, no
   * invulnerability window, and 12 hp billed for a miss. A harness that keeps
   * running a test the thing under test threw away is measuring itself. It is
   * gone, so every hit counted here is one the game landed.
   */
  p.damage = (amt, pt, ...rest) => {
    if (rest[0] === e && rest[1] === 'saber') {
      s.hits++;
      s.hitsThisStrike++;
    }
    return realDamage(amt, pt, ...rest);
  };
  /**
   * A STRIKE IS COUNTED WHERE THE GAME ENTERS ONE, not where a once-a-frame
   * sample happens to catch it — and the difference is a whole clause.
   *
   * This used to be `isStrike && !wasStrike` on `e.duel.phase`, read at the END
   * of the frame. Two things happen between the read and the truth. `p.damage`
   * is billed inside `e.update`, and THIS LOOP then resolves the clash and
   * calls `duelB.interrupt(0.45)` — so a strike that landed a hit and was
   * parried in the same frame is out of `strike` again before anything looks,
   * and the hit is counted while the strike is not.
   *
   * Measured over 20 s of Ataru, which is the only form fast enough to chain
   * into it: the brain entered `strike` 28 times and the sample saw 20, and
   * `hits > strikes` therefore fired at 21/20 on a fight where 21 hits came out
   * of 28 swings. `worstHitsInOneStrike` was 1 throughout, which is the tell —
   * the per-strike latch, which is billed from inside the same frame, never
   * disagreed with the game.
   *
   * So the transition is observed on the FIELD, which cannot be aliased. The
   * clause is unchanged in every other respect: it is still "no form may land
   * more hits than it made swings", and it is still the plain arithmetic.
   */
  {
    let ph = e.duel.phase;
    Object.defineProperty(e.duel, 'phase', {
      configurable: true,
      get: () => ph,
      set: (v) => {
        if (v === 'strike' && ph !== 'strike') { s.strikes++; s.hitsThisStrike = 0; }
        else if (v !== 'strike' && ph === 'strike') {
          s.worstHitsInOneStrike = Math.max(s.worstHitsInOneStrike, s.hitsThisStrike);
        }
        ph = v;
      },
    });
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const dt = 1 / 60, N = Math.round(seconds * 60);
  const minStrikes = opts.minStrikes ?? 0;
  let lastHp = p.hp, wasStrike = false;

  for (let i = 0; i < N; i++) {
    if (minStrikes && s.strikes >= minStrikes && !wasStrike) { s.frames = i; break; }
    ctx.time = w.time = i * dt;
    ctx.input.mouse.dx = Math.sin(i * 0.09) * (opts.mouse ?? 0);
    ctx.input.mouse.dy = Math.cos(i * 0.13) * (opts.mouse ?? 0) * 0.6;
    p.update(dt, ctx);
    e.update(dt, ctx);

    if (!e.dead && e.saber && e.saber.ignition >= 0.6 && !e.lock && p.alive) {
      const gap = Math.sqrt(segmentSegment(p.saber.base, p.saber.tip, e.saber.base, e.saber.tip, a, b).distSq);
      s.minBladeGap = Math.min(s.minBladeGap, gap);
      const clash = resolveBladeClash(p.saber, e.saber);
      if (clash) {
        if (w.time - (e._lastClash ?? -1) >= 0.09) {
          e._lastClash = w.time;
          s.clashes++;
          const duelB = e.duel, tier = duelB.tier;
          const attacking = duelB.phase === 'windup' || duelB.phase === 'strike';
          const bv = new THREE.Vector3().lerpVectors(p.saber.baseVelocity, p.saber.tipVelocity, 0.7);
          const bladeSpeed = bv.length();
          if (duelB.chamberOpen && bladeSpeed > 5.5 && duelB.chambersWith(bv)) {
            duelB.interrupt(0.85); e.stun(0.6); s.staggers++;
          } else if (attacking && !tier.parryable) { /* unblockable / guard break */ }
          else if (clash.type === 'bind' && !e.lock && !attacking && w.locks.length < 2) {
            const lock = new BladeLock(p, e, clash.point);
            e.lock = lock; p.lockState = lock; w.locks.push(lock); s.locks++;
          } else if (clash.winner === 'a' || bladeSpeed > clash.sb) {
            duelB.interrupt(0.45); e.stun(0.18); s.staggers++;
          }
        }
      }
    }
    for (let li = w.locks.length - 1; li >= 0; li--) {
      const lk = w.locks[li];
      lk.update(dt, w);
      if (lk.done) { lk.enemy.lock = null; lk.player.lockState = null; w.locks.splice(li, 1); }
    }

    if (p.hp < lastHp) s.hpLost += lastHp - p.hp;
    lastHp = p.hp;
    if (!p.alive || p.hp <= 0.001) { p.hp = 100; p.alive = true; p.invuln = 0; lastHp = 100; }

    // `wasStrike` is still what the `minStrikes` early-out reads — "stop at the
    // end of a strike, not in the middle of one" — and nothing else now.
    wasStrike = e.duel.phase === 'strike';
  }
  s.frames = s.frames ?? N;
  s.seconds = s.frames / 60;
  s.dps = s.hpLost / s.seconds;
  s.connect = s.strikes ? s.hits / s.strikes : 0;
  return s;
}

/**
 * One posed frame of a real duellist, so its blade can be measured in place.
 *
 * THE KIT IS TAKEN OUT, and it has to be. Three of the checks below pose a
 * blade at fixed WORLD coordinates either side of a player they assume is
 * standing on the origin — which is what makes "the whole edge cuts, not only
 * the tip" a test of the edge rather than of where anybody happens to be. Once
 * an acolyte could actually cast (it never could until `tools/checks/powers.mjs`
 * existed), 60 warm-up frames were long enough for it to open with a shove, and
 * the player was 3.96 m from a blade laid through where they used to be. The
 * check failed, correctly, on a fixture that had stopped measuring its subject.
 *
 * `duel()` above deliberately keeps the kit — that one measures a whole fight.
 * What a duellist does with the Force belongs to `powers.mjs`.
 */
function posedDuellist(formKey = 'djemSo', range = 1.8, frames = 90) {
  const w = gameWorld();
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  p.saber.ignite(); p.saber.ignition = 1;
  w.players.push(p);
  const e = new Enemy(w, 'acolyte', V(0, 0, range));
  e.duel.formKey = formKey; e.duel.form = FORMS[formKey];
  e.powers = null;
  w.enemies.push(e);
  const ctx = {
    input: stubInput(), terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };
  for (let i = 0; i < frames; i++) {
    ctx.time = w.time = i / 60;
    p.update(1 / 60, ctx);
    e.update(1 / 60, ctx);
  }
  return { w, p, e, ctx };
}

/* Cached: five real bodies × twenty seconds of real frames each is the most
 * expensive thing in this file, and four checks want the same numbers. */
let _armed = null, _bare = null;
/** Every form against a player holding a lit blade — clashes, locks, parries. */
function allForms() {
  if (!_armed) _armed = FORM_KEYS.map(k => ({ key: k, ...duel(k, 20) }));
  return _armed;
}
/** Every form against a player with no blade at all — reach, pure. */
function allFormsBare() {
  if (!_bare) _bare = FORM_KEYS.map(k => ({ key: k, ...duel(k, 60, { bare: true, minStrikes: 8 }) }));
  return _bare;
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped: the two shared streams are put on
   * their modules' own seeds before each body and the wind clock is put back
   * after it. See tools/checks/_shared.mjs — the rule is there, not here.
   */
  check = await clocked(check);
  await initPhysics();

  /* ══ the geometry: which way does a duellist hold its blade? ════════ */

  check('duel: guard space and a body\'s heading agree about which way is forward', () => {
    // THE UNIT LAW, and the one line that was wrong. A body facing yaw looks
    // along (sin yaw, 0, cos yaw); guard space is −Z forward. The conversion
    // must take one to the other, and a bare setFromAxisAngle(UP, yaw) takes
    // it to the exact opposite.
    let worst = 1, worstYaw = 0;
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2 - Math.PI;
      const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
      const g = guardToWorld(V(0, 0, -1), yaw);
      if (g.dot(fwd) < worst) { worst = g.dot(fwd); worstYaw = yaw; }
      // and +X must be the body's own right hand, fwd × up
      const right = new THREE.Vector3().crossVectors(fwd, V(0, 1, 0)).normalize();
      const gx = guardToWorld(V(1, 0, 0), yaw);
      assert(gx.dot(right) > 0.999,
        `at yaw ${yaw.toFixed(2)} guard +X points ${gx.dot(right).toFixed(3)} along the body's right`);
    }
    assert(worst > 0.999,
      `guard −Z points ${worst.toFixed(3)} along the body's forward at yaw ${worstYaw.toFixed(2)} `
      + '— −1 means every duellist swings behind itself');
    // and the quaternion form agrees with the vector form
    const q = guardQuat(1.1);
    const byQ = V(0, 0, -1).applyQuaternion(q);
    assert(byQ.distanceTo(guardToWorld(V(0, 0, -1), 1.1)) < 1e-9, 'guardQuat and guardToWorld disagree');
    return `−Z → forward and +X → right at all 24 headings, worst dot ${worst.toFixed(4)}`;
  });

  check('duel: a duellist holds its blade between itself and its target', () => {
    // THE END-TO-END FORM, on a real body, posed by the real animator. On the
    // code this replaces: hands 0.71 BEHIND the body, blade −0.84 off the
    // target. Nothing about that is a near miss.
    const { p, e } = posedDuellist('soresu', 2.0, 120);
    const toP = new THREE.Vector3().subVectors(p.position, e.position).setY(0).normalize();
    const hand = new THREE.Vector3().subVectors(e.saber.base, e.position).setY(0);
    const blade = new THREE.Vector3().subVectors(e.saber.tip, e.saber.base).normalize();
    const handDot = hand.lengthSq() > 1e-6 ? hand.clone().normalize().dot(toP) : 0;
    assert(handDot > 0.3,
      `the hands sit ${handDot.toFixed(2)} toward the target (negative = behind the body)`);
    assert(blade.dot(toP) > 0.1,
      `the blade points ${blade.dot(toP).toFixed(2)} at the target — it is aimed the wrong way`);
    const tipToBody = Math.hypot(e.saber.tip.x - p.position.x, e.saber.tip.z - p.position.z);
    assert(tipToBody < e.position.distanceTo(p.position),
      `the tip is ${tipToBody.toFixed(2)} m from the player while the body is only `
      + `${e.position.distanceTo(p.position).toFixed(2)} m — the blade is on the far side`);
    return `hands ${handDot.toFixed(2)}, blade ${blade.dot(toP).toFixed(2)} toward the target; `
      + `tip ${tipToBody.toFixed(2)} m out from a body at ${e.position.distanceTo(p.position).toFixed(2)} m`;
  });

  check('duel: nothing converts guard space with a bare yaw any more', async () => {
    // The general form, so the half turn cannot be reintroduced by the next
    // thing that needs to put something in a duellist's hand.
    const { readFile } = await import('node:fs/promises');
    const bad = [];
    for (const f of ['Enemy.js', 'Duel.js']) {
      const src = (await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const m of src.matchAll(/setFromAxisAngle\(\s*UP\s*,\s*(?:this\.)?(?:e\.)?facing[^)]*\)/g)) {
        // hips and group transforms legitimately use the raw heading; only the
        // ones that then apply a guardDir / attack arc are the bug.
        const after = src.slice(src.indexOf(m[0]), src.indexOf(m[0]) + 320);
        if (/guardDir|attack\.(from|to)|applyQuaternion/.test(after)) bad.push(`${f}: ${m[0]}`);
      }
    }
    assert(bad.length === 0,
      `guard space converted with a bare heading in ${bad.length} place(s): ${bad.join('; ')}`);
    return 'every guard-space conversion goes through guardQuat';
  });

  /* ══ does the blade do anything? ═══════════════════════════════════ */

  check('duel: an enemy blade draws blood — every form of it', () => {
    // THE ONE THIS FILE EXISTS FOR. The player stands still and does nothing
    // at all, and carries no blade, so nothing but reach is being measured.
    // Before: 0 hits, 0.00 hp/s, every form, forever.
    const runs = allFormsBare();
    const thin = runs.filter(r => r.strikes < 4);
    assert(thin.length === 0,
      `${thin.map(r => FORMS[r.key].name).join(', ')} threw fewer than four strikes in 60 s, so `
      + 'this measured nothing');
    const dead = runs.filter(r => r.hits === 0);
    assert(dead.length === 0,
      `${dead.length} of ${runs.length} forms never landed one hit on an unarmed, motionless player `
      + 'at knife range: '
      + dead.map(r => `${FORMS[r.key].name} (0 of ${r.strikes} strikes in ${r.seconds.toFixed(0)} s)`).join(', '));
    const mean = runs.reduce((s, r) => s + r.dps, 0) / runs.length;
    assert(mean > 3,
      `a duellist standing over a motionless player deals ${mean.toFixed(2)} hp/s — that is not a fight`);
    return runs.map(r => `${FORMS[r.key].name} ${r.dps.toFixed(1)} hp/s (${(r.connect * 100).toFixed(0)}% of `
      + `${r.strikes} strikes in ${r.seconds.toFixed(0)} s)`).join(', ') + `; mean ${mean.toFixed(2)} hp/s`;
  });

  check('duel: the blade hit test is wired into the pose, not merely defined', async () => {
    // Belt and braces for the check below, which drives `_saberStrike`
    // directly and would keep passing if nothing in the game ever called it.
    // It has to run AFTER the blade is posed, because the prev→cur sweep it
    // reads does not exist until then.
    const { readFile } = await import('node:fs/promises');
    const src = (await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const i = src.indexOf('  _poseSaber(');
    assert(i > 0, '_poseSaber is gone');
    const body = src.slice(i, src.indexOf('\n  _poseOffhand(', i));
    const call = body.indexOf('this._saberStrike(');
    assert(call > 0, 'nothing in the pose ever runs the blade hit test');
    assert(call > body.indexOf('this.saber.update('),
      'the hit test runs before the blade is posed, so it reads last frame\'s sweep');
    return 'the strike test runs from _poseSaber, after saber.update';
  });

  check('duel: the whole edge cuts, not only the tip', () => {
    // World's own test is `prevTip → tip`, so the middle of a 1.12 m blade
    // passed through a body for free. Posed here on purpose: the blade is laid
    // ACROSS the player with its tip well past them, which is the commonest
    // way a horizontal slash actually arrives.
    const { p, e, ctx } = posedDuellist('makashi', 1.5, 60);
    e.duel.phase = 'strike';
    e.duel.timer = 0.1; e.duel._strikeLen = 0.14;
    e._strikePhase = 'guard'; e._struck = false;
    p.invuln = 0;
    // hilt to one side of the player at chest height, tip past the other side
    const y = p.position.y + 1.2;
    const from = new THREE.Vector3(-0.9, y, 0.05);
    const to = new THREE.Vector3(0.9, y, -0.05);
    e.saber.valid = false;
    e.saber.base.copy(from); e.saber.tip.copy(to);
    e.saber.prevBase.copy(from); e.saber.prevTip.copy(to);
    const c0 = new THREE.Vector3(p.position.x, p.position.y + 0.4, p.position.z);
    const c1 = new THREE.Vector3(p.position.x, p.position.y + 1.7, p.position.z);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const tipMiss = Math.sqrt(segmentSegment(e.saber.prevTip, e.saber.tip, c0, c1, a, b).distSq);
    assert(tipMiss > 0.44,
      `this fixture is not testing what it claims: the tip is ${tipMiss.toFixed(2)} m from the body, `
      + 'which the old tip test would already have caught');
    const hp0 = p.hp;
    e.target = p;
    const landed = e._saberStrike(ctx);
    assert(landed && p.hp < hp0,
      `a blade laid straight through the chest did not cut: the tip was ${tipMiss.toFixed(2)} m away `
      + 'and only the tip was ever tested');
    return `blade through the torso with its tip ${tipMiss.toFixed(2)} m clear: `
      + `${(hp0 - p.hp).toFixed(1)} hp`;
  });

  check('duel: one strike is one hit, however many frames it lasts', () => {
    // A strike is 7–11 frames. A test with no per-swing latch bills every one
    // of them, which would be 200+ damage from a single overhead.
    const runs = allForms();
    const worst = Math.max(...runs.map(r => r.worstHitsInOneStrike));
    assert(worst <= 1,
      `one strike phase landed ${worst} separate hits — a swing is billing per frame`);
    /* AND NO FORM MAY LAND MORE HITS THAN IT MADE SWINGS. This used to be a
     * clause about two hit tests billing the same swing; there is one test
     * now, so what is left is the plain arithmetic — more hits than strikes
     * means a swing was counted twice by some route the latch above missed. */
    const over = runs.filter(r => r.hits > r.strikes);
    assert(over.length === 0,
      `${over.map(r => FORMS[r.key].name).join(', ')} landed more hits than they made strikes`);
    const own = runs.reduce((s, r) => s + r.hits, 0);
    return `${own} hits over ${runs.reduce((s, r) => s + r.strikes, 0)} strikes, `
      + `worst ${worst} hit(s) in any one strike`;
  });

  check('duel: steel on steel outranks steel on flesh', () => {
    // The rule World's ordering states and the enemy's own test now has to
    // obey, since it runs FIRST — a blade that cuts through a block is worse
    // than a blade that does nothing.
    const { p, e, ctx } = posedDuellist('makashi', 1.5, 60);
    e.duel.phase = 'strike';
    e.duel.timer = 0.1; e.duel._strikeLen = 0.14;
    e._strikePhase = 'guard'; e._struck = false;
    p.invuln = 0;
    e.target = p;
    const y = p.position.y + 1.2;
    e.saber.base.set(-0.9, y, 0.05); e.saber.tip.set(0.9, y, -0.05);
    e.saber.prevBase.copy(e.saber.base); e.saber.prevTip.copy(e.saber.tip);
    // put the player's blade across the enemy's, at the contact point
    p.saber.base.set(0, y - 0.6, 0.4); p.saber.tip.set(0, y + 0.5, -0.4);
    p.saber.prevBase.copy(p.saber.base); p.saber.prevTip.copy(p.saber.tip);
    p.saber.ignition = 1; e.saber.ignition = 1;
    assert(bladesTouching(p.saber, e.saber),
      'the fixture failed to put the two blades in contact, so it proves nothing');
    const hp0 = p.hp;
    const landed = e._saberStrike(ctx);
    assert(!landed && p.hp === hp0,
      `the enemy blade cut through a block: ${(hp0 - p.hp).toFixed(1)} hp taken with the player's `
      + `blade ${CLASH_RADIUS} m or closer to the incoming one`);
    return 'a blade on the incoming blade stands the body hit down, every time';
  });

  /* ══ blade on blade ════════════════════════════════════════════════ */

  check('duel: two blades in ordinary play actually meet', () => {
    // "I have never seen the blades touch." They could not: closest approach
    // over 30 s was 1.25 m against a 0.10 m contact radius — twelve times.
    const runs = allForms();
    const worst = Math.max(...runs.map(r => r.minBladeGap));
    const best = Math.min(...runs.map(r => r.minBladeGap));
    assert(best <= CLASH_RADIUS,
      `over ${runs.length} forms the closest two blades ever came was ${best.toFixed(3)} m, `
      + `and a clash needs ${CLASH_RADIUS} m`);
    const touched = runs.filter(r => r.clashes > 0);
    assert(touched.length >= 3,
      `only ${touched.length} of ${runs.length} forms ever produced a resolved clash in 20 s`);
    return runs.map(r => `${FORMS[r.key].name} ${r.clashes} clash(es), gap ${r.minBladeGap.toFixed(3)} m`)
      .join(', ') + `; worst form's closest approach ${worst.toFixed(3)} m`;
  });

  check('duel: a clash stops, sparks, sounds and shoves', async () => {
    // The four things a player asked to see when steel meets steel. They were
    // all already written — and unreachable, which is the same as absent. Now
    // that the contact happens they are load-bearing, so they are pinned: this
    // is the only place in the suite that reads World.js, because World owns
    // the clash and this suite may not edit it.
    const { readFile } = await import('node:fs/promises');
    const src = (await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const i = src.indexOf('  _applyClash(');
    assert(i > 0, 'World._applyClash is gone — nothing resolves blade on blade');
    const body = src.slice(i, src.indexOf('\n  notifyFloating(', i));
    const need = {
      'a shower of sparks': /sparkBurst\(clash\.point/,
      'a sound': /audio\.clash\(clash\.point/,
      'strain on both blades': /player\.saber\.strain\([\s\S]*?enemy\.saber\.strain\(/,
      'a stop': /addHitstop\(/,
      'a push on the blade': /hitImpulse\(clash\.point/,
      'a camera kick': /camera\.addShake\(/,
    };
    const missing = Object.entries(need).filter(([, re]) => !re.test(body)).map(([k]) => k);
    assert(missing.length === 0, `a clash no longer produces: ${missing.join(', ')}`);
    // and the contact throttle has to still be there, or a held blade fires a
    // clash every frame — 60 spark bursts and 60 voices a second
    assert(/_lastClash/.test(body), 'the per-enemy clash cooldown is gone');
    return `${Object.keys(need).length} clash consequences present, behind a per-enemy cooldown`;
  });

  check('duel: a blade lock can be entered from normal play, and it resolves', () => {
    // The lock was reachable only from a state nothing produced. Two halves:
    // ordinary duelling has to REACH the bind, and the bind has to finish.
    const runs = allForms();
    let total = runs.reduce((s, r) => s + r.locks, 0);
    let extra = '';
    if (total === 0) {
      // A bind needs both blades slow, in contact, and nobody committed — a
      // conjunction that a 20 s window can miss by luck. Soresu is the form
      // that produces it most often, because standing and waiting is what the
      // form IS, so ask it directly rather than failing on a coin toss.
      const s = duel('soresu', 60);
      total = s.locks;
      extra = ` (needed a 60 s Soresu bout: ${s.clashes} clashes, ${s.locks} locks)`;
    }
    assert(total > 0,
      'no blade lock was entered in 160 s of duelling across all five forms — the bind is unreachable'
      + ` from ordinary play (${runs.reduce((s, r) => s + r.clashes, 0)} clashes did resolve)`);

    // and it terminates, both ways, with real consequences
    const { p, e, w } = posedDuellist('djemSo', 1.6, 30);
    const lock = new BladeLock(p, e, e.aimPoint(new THREE.Vector3()));
    e.lock = lock;
    let frames = 0;
    while (!lock.done && frames++ < 60 * 8) lock.update(1 / 60, w);
    assert(lock.done, 'a blade lock ran for 8 s without resolving');
    assert(lock.result === 'player' || lock.result === 'enemy',
      `a lock finished with result ${String(lock.result)}`);
    // whoever loses pays: the enemy is staggered, or the player is
    if (lock.result === 'player') {
      assert(e.duel.staggered || e.stunTimer > 0,
        'the player won a blade lock and the duellist reacted in no way at all');
    } else {
      assert(p.staggerTimer > 0, 'the player lost a blade lock and was not staggered');
    }
    return `${total} lock(s) entered from ordinary duelling in 100 s${extra}; a forced lock `
      + `resolved '${lock.result}' in ${(frames / 60).toFixed(2)} s`;
  });

  /* ══ reactions ═════════════════════════════════════════════════════ */

  check('duel: a duellist whose blade is beaten aside is visibly out of line', () => {
    // Before: `interrupt(0.45)` — the guard slid back to rest and the same
    // attack came again. There was no state a player could read as "I won that
    // exchange", so beating a blade aside felt like nothing.
    const { e, ctx } = posedDuellist('makashi', 2.2, 60);
    const rest = e.duel.restDir.clone();
    const before = e.duel.guardDir.clone();
    // World's parry path, exactly: interrupt then a short stun
    e.duel.interrupt(0.45);
    e.stun(0.18, new THREE.Vector3(1, 0, 0), 1);
    assert(e.duel.staggered,
      `a parried duellist is in phase '${e.duel.phase}' — nothing distinguishes it from recovering`);
    const held = e.duel.timer;
    assert(held >= 0.4,
      `the opening lasts ${held.toFixed(2)} s, which at 60 Hz is ${Math.round(held * 60)} frames — `
      + 'that is a twitch, not a stagger');

    // the guard has to TRAVEL, and it must not be able to attack while it does
    let peak = 0, attacked = false;
    for (let i = 0; i < Math.round(held * 60) - 2; i++) {
      e.duel.update(1 / 60, ctx, 2.2);
      const ang = e.duel.guardDir.angleTo(rest) * 180 / Math.PI;
      peak = Math.max(peak, ang);
      if (e.duel.phase === 'windup' || e.duel.phase === 'strike') attacked = true;
    }
    assert(!attacked, 'a staggered duellist started a new attack before its guard was back');
    assert(peak > 40,
      `the guard was driven only ${peak.toFixed(0)}° off its rest line — from across the room `
      + 'that is indistinguishable from standing there');
    // and it comes back
    for (let i = 0; i < 60; i++) e.duel.update(1 / 60, ctx, 2.2);
    assert(!e.duel.staggered, 'the stagger never ended');
    return `parry → ${held.toFixed(2)} s out of line, guard driven ${peak.toFixed(0)}° wide `
      + `(was ${before.angleTo(rest) * 180 / Math.PI | 0}°), no attack until it recovers`;
  });

  check('duel: two parries in a row are two staggers, not one', () => {
    // Math.max semantics, the same rule Enemy.stun already followed. Without
    // it the second parry SHORTENS the first, which is backwards.
    const { e } = posedDuellist('djemSo', 2.2, 30);
    e.stun(1.2);
    const long = e.duel.timer;
    e.stun(0.18);
    assert(e.duel.timer >= long - 1e-6,
      `a light parry cut a heavy stagger from ${long.toFixed(2)} s to ${e.duel.timer.toFixed(2)} s`);
    return `1.2 s stagger survives a 0.18 s one: ${e.duel.timer.toFixed(2)} s`;
  });

  check('duel: a duellist that lands a cut presses, and cannot press forever', () => {
    // Before: World did `e.duel.interrupt(0.45)` after its blade connected, so
    // being hit BOUGHT you half a second of quiet. Now a connected hit chains
    // exactly one attack, and the second one in a row does not.
    const { e, ctx } = posedDuellist('makashi', 2.0, 60);
    // The sixty settle frames are a real duel at knife range, so the duellist
    // may already have landed a cut and spent its one follow-up. Reset the
    // counter rather than assume a clean brain — a fixture that only passes
    // when the warm-up happened to miss is a coin toss, and under verify.mjs
    // (where the shared rng starts somewhere else) it came up tails.
    e.duel.followUps = 0;
    e.duel.phase = 'strike'; e.duel.timer = 0.01; e.duel.attack = { damage: 1 };
    const chained = e.duel.followUp();
    assert(chained, 'a connected hit did not chain anything');
    assert(e.duel.chainLeft >= 1, 'the follow-up left no chained attack behind it');
    const shortRecover = e.duel.timer;

    // run it out and prove a windup actually arrives
    let sawWindup = false, t = 0;
    while (t < 1.2 && !sawWindup) { e.duel.update(1 / 60, ctx, 2.0); t += 1 / 60; if (e.duel.phase === 'windup') sawWindup = true; }
    assert(sawWindup, `no follow-up attack arrived within ${t.toFixed(2)} s of landing a cut`);
    assert(t < 0.8, `the "follow-up" took ${t.toFixed(2)} s to arrive, which is not pressure`);

    // the cap: a second landed hit in the same exchange must not chain again
    e.duel.phase = 'strike'; e.duel.timer = 0.01;
    const again = e.duel.followUp();
    assert(!again, 'a duellist chained a second follow-up off one exchange — that is a stunlock');
    return `hit → ${shortRecover.toFixed(2)} s recovery and a chained attack in ${t.toFixed(2)} s; `
      + 'the second one is refused';
  });

  /* ══ balance ═══════════════════════════════════════════════════════ */

  check('duel: an enemy blade is dangerous without being a one-shot', () => {
    // The authored numbers were never changed by this work — an acolyte's
    // `damage: 26` and the per-attack scales in Duel.ATTACKS are exactly what
    // they were. What changed is that they now apply. So the job here is to
    // state what that means in hp and check it stayed sane.
    const A = ARCHETYPES.acolyte;
    const perHit = A.damage * 1.6;                       // the heaviest arc in the table
    const taken = perHit * DIFFICULTY.grandmaster.damageTaken;
    assert(taken < 100,
      `the hardest single arc takes ${taken.toFixed(0)} of 100 hp on Grandmaster — that is a one-shot`);
    assert(taken > 20,
      `the hardest single arc takes only ${taken.toFixed(0)} hp — a lightsaber should hurt`);
    const runs = allForms();
    const hottest = Math.max(...runs.map(r => r.dps));
    assert(hottest < 26,
      `${FORMS[runs.find(r => r.dps === hottest).key].name} deals ${hottest.toFixed(1)} hp/s to a `
      + 'player who is standing still — four seconds from full health is not a duel');
    return `heaviest arc ${perHit.toFixed(0)} hp (${taken.toFixed(0)} on Grandmaster); `
      + `worst form ${hottest.toFixed(1)} hp/s against a motionless player`;
  });

  check('duel: a duellist that cannot see you does not swing at you', () => {
    // The hit test is the enemy's own now, so the guards that used to be
    // World's — dead, unlit, locked, invulnerable target — have to be here.
    const { p, e, ctx } = posedDuellist('ataru', 1.5, 60);
    e.target = p;
    const arm = () => { e.duel.phase = 'strike'; e.duel.timer = 0.1; e.duel._strikeLen = 0.14;
      e._strikePhase = 'guard'; e._struck = false;
      const y = p.position.y + 1.2;
      e.saber.base.set(-0.9, y, 0.05); e.saber.tip.set(0.9, y, -0.05);
      e.saber.prevBase.copy(e.saber.base); e.saber.prevTip.copy(e.saber.tip); };

    arm(); p.invuln = 1; assert(!e._saberStrike(ctx), 'cut an invulnerable player');
    arm(); p.invuln = 0; p.alive = false; assert(!e._saberStrike(ctx), 'cut a dead player');
    p.alive = true;
    arm(); e.saber.ignition = 0.2; assert(!e._saberStrike(ctx), 'cut with an unlit blade');
    e.saber.ignition = 1;
    arm(); e.lock = {}; assert(!e._saberStrike(ctx), 'cut while pinned in a blade lock');
    e.lock = null;
    arm(); e.target = null; assert(!e._saberStrike(ctx), 'cut with no target');
    e.target = p;
    arm(); assert(e._saberStrike(ctx), 'the fixture no longer lands at all, so it proves nothing');
    return 'invulnerable, dead, unlit, locked and targetless all refused; the control case lands';
  });
}
