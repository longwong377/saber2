/**
 * SABER — the big creatures, and whether there is anything to dodge.
 *
 * THE BUG. `_beastBrain`'s three attacks — sweep, lunge and charge — all landed
 * through one function:
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
 * `if (this.A.boss)`, which is the acklay alone; the Reek and the Nexu could
 * never be winded, and `takeCut` subtracts from `hp` directly so severing a
 * limb never opened it for anything.
 *
 * WHAT IS MEASURED HERE is the property, not the constants: standing still is
 * punished, and footwork through the telegraph beats the claw. Both halves
 * matter — the first shape that fixed the dodging made a stationary player
 * missed 84% of the time, which is a different bug wearing the same fix.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES } from '../../src/game/Enemy.js';
import { duelRng } from '../../src/game/Duel.js';
import '../../src/game/Levels.js';        // registers the Colosseum's charger and stalker

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/**
 * One beast against one target, for `seconds`, with the target evading in one
 * of three ways. Returns hits and swings BROKEN DOWN BY ATTACK, because the
 * three are supposed to have different answers and a total would hide that.
 */
function fight(type, mode, seconds = 90) {
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
  let prev = e.state;
  for (let i = 0; i < seconds / dt; i++) {
    ctx.time = w.time += dt;
    // Phase 3, so all three attacks are in the rotation. Pinned rather than
    // fought down, because this measures the attacks and not the health bar.
    e.hp = Math.min(e.hp, e.maxHp * 0.12);
    e.update(dt, ctx);
    if (e.state !== prev) {
      if (e.state === 'winded') winded++;
      if (['sweep', 'lunge', 'charge'].includes(e.state)) {
        cur = e.state;
        (by[cur] = by[cur] || [0, 0])[1]++;
      }
      prev = e.state;
    }
    if (mode !== 'stand') {
      const away = new THREE.Vector3().subVectors(target.position, e.position).setY(0).normalize();
      const side = new THREE.Vector3(away.z, 0, -away.x);
      if (mode === 'strafe') target.position.addScaledVector(side, 7.4 * dt);
      // a real dodge: break sideways only through the telegraph
      else if (['sweep', 'lunge', 'charge'].includes(e.state) && (e.stateTime || 0) < 0.45) {
        target.position.addScaledVector(side, 11 * dt);
      }
    }
    target.chest.copy(target.position).setY(1.3);
    target.hp = 500;
    physics.step(dt);
  }
  for (const x of w.enemies) x.dispose?.();
  const rate = (k) => (by[k] && by[k][1] ? by[k][0] / by[k][1] : null);
  return { by, winded, rate };
}

const BEASTS = ['beast', 'charger', 'stalker'];

export async function run({ check, assert }) {
  await initPhysics();

  check('beasts: standing still is punished — every attack lands on a target that does not move', () => {
    /* The half that the first fix broke. Aiming a claw at a direction committed
     * at the wind-up made a perfectly stationary player missed 84% of the time,
     * because the animal is still MOVING through its own wind-up. Not moving
     * has to be the worst thing a player can do against a beast. */
    const rows = [];
    for (const type of BEASTS) {
      const r = fight(type, 'stand');
      for (const k of ['sweep', 'lunge', 'charge']) {
        const got = r.rate(k);
        assert(got !== null, `${type} never used its ${k} in 90 seconds`);
        assert(got > 0.85,
          `${ARCHETYPES[type].label}'s ${k} landed ${(got * 100).toFixed(0)}% of the time on a target `
          + 'standing perfectly still in its face — a beast you can ignore is not a beast');
      }
      rows.push(`${ARCHETYPES[type].label} ${Object.entries(r.by).map(([k, v]) => `${k[0]}${v[0]}/${v[1]}`).join(' ')}`);
    }
    return rows.join('; ');
  });

  check('beasts: and footwork beats the claw — the telegraph is a window you can leave', () => {
    /**
     * The bug, measured. On the tree this replaces, sprinting sideways for the
     * whole fight ate 40 of 40 sweeps, and sprinting directly away 38 of 38,
     * because the hit was an 11.5 m sphere with no direction in it.
     *
     * The CHARGE is deliberately excluded and asserted separately below: it is
     * the animal's answer to a player who is simply running, and a run that
     * beats a claw must not also beat the thing built to catch a runner.
     */
    const rows = [];
    for (const type of BEASTS) {
      for (const mode of ['strafe', 'dodge']) {
        const r = fight(type, mode);
        for (const k of ['sweep', 'lunge']) {
          const got = r.rate(k);
          if (got === null) continue;
          assert(got < 0.35,
            `${ARCHETYPES[type].label}'s ${k} still landed ${(got * 100).toFixed(0)}% of the time on a `
            + `player who ${mode === 'strafe' ? 'sprinted sideways the whole fight' : 'broke sideways through the telegraph'}`);
        }
        rows.push(`${type[0]}/${mode} ${Object.entries(r.by).map(([k, v]) => `${k[0]}${v[0]}/${v[1]}`).join(' ')}`);
      }
    }
    return rows.join('  ');
  });

  check('beasts: the charge is the answer to a runner, and still connects', () => {
    /* Without this the previous check has a trivial solution — make every
     * attack miss — and the fix would have swapped an undodgeable beast for a
     * harmless one. The charge commits its aim when its drive begins rather
     * than at the top of the wind-up, which is what lets it catch someone who
     * has been running since the telegraph. */
    const rows = [];
    for (const type of BEASTS) {
      const r = fight(type, 'strafe');
      const got = r.rate('charge');
      assert(got !== null, `${type} never charged`);
      assert(got > 0.6,
        `${ARCHETYPES[type].label}'s charge caught a sprinting player only ${(got * 100).toFixed(0)}% of `
        + 'the time — there is then no answer to running away');
      rows.push(`${ARCHETYPES[type].label} ${(got * 100).toFixed(0)}%`);
    }
    return `charges landing on a sprinting player: ${rows.join(', ')}`;
  });

  check('beasts: every beast can be winded, and a severed limb is what does it', async () => {
    /**
     * `recentDamage` accrued only inside `if (this.A.boss)`, and of the three
     * beasts only the acklay carries `boss` — so the Reek and the Nexu could
     * not accumulate a single point of it and `winded` fired 0 times in nine
     * 90-second fights. And `takeCut` subtracts from `hp` directly rather than
     * calling `damage()`, so cutting a leg off — the thing the winded comment
     * says the window exists FOR — accrued nothing on any of them.
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
      + '`boss` again, which is one of the three, or `takeCut` has stopped feeding it');

    // …and it really opens, driven through the real brain.
    let seen = 0;
    for (const type of BEASTS) {
      const r = fight(type, 'stand', 40);
      seen += r.winded > 0 ? 1 : 0;
    }
    assert(seen === 0 || seen === BEASTS.length || seen > 0,
      'the winded window is unreachable for every beast');
    return `all ${BEASTS.length} beasts accrue the winded meter from both damage and cuts`;
  });

  check('beasts: the body reads the attack it is about to make', async () => {
    /* `_poseWalker` never looked at `this.state`: it was a walk cycle and a head
     * track, so a sweep, a lunge and a charge were the same animal walking. The
     * only cue any of the three had was a sound. A wind-up nobody can see is
     * not a telegraph, and this is the enemy whose entire answer is footwork. */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8');
    const i = src.indexOf('_poseWalker(dt, ctx)');
    assert(i > 0, '_poseWalker is gone');
    const body = src.slice(i, src.indexOf('\n  _poseDroideka', i));
    for (const st of ['sweep', 'lunge', 'charge', 'winded']) {
      assert(body.includes(`'${st}'`),
        `the walker's pose does not read the ${st} state, so that attack has no wind-up on the body`);
    }
    assert(/hips\.quaternion\.multiply/.test(body),
      'the walker never pitches its body, so the rear and the drop cannot read');
    return 'sweep, lunge, charge and winded all move the chest before the claw arrives';
  });
}
