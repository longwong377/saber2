/**
 * BATTLEFRONT BORZ — what a body does while you are holding it in the air.
 *
 * Note 48: "held bodies have real limb physics as you swing them."
 *
 * What it did before: `dampVec(position, liftTarget, 8, dt)` with the animator
 * still running underneath. A droid lifted off the floor slid through the air
 * in a JOGGING POSE — its legs kept walking, its arms kept swinging their gait
 * swing, and the whole thing translated rigidly. That is the least cinematic
 * possible reading of the most cinematic thing in the source material, and no
 * assertion in the project could see it: the grip worked, the choke ticked, the
 * hurl fired, every number was right and the picture was wrong.
 *
 * So the measurement has to be about the POSE and not about the position. Two
 * things separate a hanging body from a rigid one, and both are measured here
 * against the rigid path they replace:
 *
 *   · the limbs ANSWER THE SWING. Each path is driven twice, once with the hold
 *     point sweeping a wide arc and once with it parked, and what is measured is
 *     how much a limb's offset from the hips DIFFERS between the two. A gait
 *     does not know where it is being carried, so the rigid path scores zero to
 *     the millimetre; a hanging leg is dragged by the hips it hangs from.
 *   · and they LAG. Swing the hold point and the foot arrives after the chest
 *     does, which is the difference between a body and a mannequin.
 *
 * WHAT THIS USED TO ASK, and why it was replaced: whether the hand travels
 * FURTHER in the body's frame than on the rigid path. Two faults. The reference
 * still runs the animator, so it is a gait swing rather than a zero — 42.7 cm
 * against the ragdoll's 72.1, a ratio of 1.69 against a bar of 2. And it had
 * been passing at 2.41 only because the acolyte's form and gait phase come out
 * of module-level RNG that whatever ran before it had already advanced: run
 * alone it failed, run inside the suite it passed, on identical code. Both
 * streams are seeded here now, and the metric no longer depends on a margin.
 *
 * Both run on a real Rapier world, because the claim is about a joint solve.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng } from '../../src/game/Enemy.js';
import { duelRng } from '../../src/game/Duel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

function gameWorld() {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flatGround();
  physics.terrain = terrain;
  return {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
}

/**
 * Hold a droid up and swing it, recording where its hands are RELATIVE TO ITS
 * CHEST on every frame.
 *
 * `rigid` runs the path this replaced — position damped straight at the hold
 * point, animator untouched — so the two are measured by the same instrument
 * rather than the new one being measured against a memory of the old.
 */
function swing({ rigid = false, seconds = 2.2, still = false } = {}) {
  /* THE SAME DUELLIST EVERY TIME. Both module streams are seeded here, because
   * an acolyte's speed, facing and FORM all come out of Enemy's and its
   * manoeuvre choice out of Duel's — and the two arms of this comparison are
   * only comparable if they are the same fighter. Run alone this check read
   * held 72.1 cm against rigid 40.8; run after the rest of the suite it read a
   * clean pass, on identical code. See the note over `enemyRng`. */
  enemyRng.seed(4711);
  duelRng.seed(8123);
  const w = gameWorld();
  const e = new Enemy(w, 'acolyte', V(0, 0, -3));
  e.position.set(0, 0, -3);
  w.enemies.push(e);
  const ctx = {
    enemies: w.enemies, particles: null, terrain: w.terrain, physics: w.physics,
    bolts: null, time: 0, pickTarget: () => null, camera: w.engine.camera,
  };
  e.update(1 / 60, ctx);                    // one frame, so the rig is posed

  const hold = new THREE.Vector3(0, 2.2, -3);
  e.gripped = true;
  e.liftTarget = hold;
  if (!rigid && e.actor && !e.actor.ragdolled) e.actor.goRagdoll(e.velocity, null);

  const dt = 1 / 60;
  const rel = {};
  for (const b of BONES) rel[b] = [];
  const chestT = [], handT = [];
  for (let i = 0; i < seconds / dt; i++) {
    ctx.time = w.time += dt;
    // swing it in a wide arc, the way a mouse does — or, for the reference
    // run, hold it dead still at the same starting point
    if (!still) hold.set(Math.sin(i / 14) * 2.6, 2.2 + Math.sin(i / 23) * 0.5, -3 + Math.cos(i / 14) * 1.2);
    if (rigid) {
      // the path this replaced, verbatim
      const k = 1 - Math.exp(-8 * dt);
      e.position.lerp(hold, k);
      e.velocity.set(0, 0, 0);
      e.grounded = false;
      e._pose(dt, ctx);
    } else {
      e._move(dt, ctx);
    }
    w.physics.step(dt);
    e.actor?.update?.(dt);
    e.rig?.updateMatrices?.();

    /* WHERE THE HAND IS, through whichever representation is live.
     *
     * A ragdolled actor does not drive the rig's bones at all — `syncRagdoll`
     * copies each body's transform onto a `holder` Object3D and the rig is
     * bypassed — so reading `rig.worldPos('handR')` on a hanging body returns
     * the pose it had when it was ragdolled and never moves again. The first
     * cut of this check did exactly that, measured 0.0 cm, and would have
     * reported the fix as not working. */
    const at = (bone) => {
      const b = e.actor?.ragdolled && e.actor.bodies?.get(bone);
      if (b) return b.position.clone();
      return e.rig?.worldPos ? e.rig.worldPos(bone, new THREE.Vector3()) : e.position.clone();
    };
    const hips = at('hips');
    for (const b of BONES) rel[b].push(at(b).sub(hips));
    chestT.push(at('chest'));
    handT.push(at('footR'));
  }

  // …and the lag: how far behind the chest's own travel the foot runs.
  let lag = 0, n = 0;
  for (let i = 6; i < chestT.length; i++) {
    const dChest = chestT[i].distanceTo(chestT[i - 6]);
    const dFoot = handT[i].distanceTo(handT[i - 6]);
    if (dChest > 0.05) { lag += Math.abs(dFoot - dChest) / dChest; n++; }
  }
  return { rel, lag: n ? lag / n : 0, ragdolled: !!e.actor?.ragdolled, e, w };
}

/**
 * THE BONES THIS MEASURES, and the one it deliberately does not.
 *
 * `foreR` — the sword arm — is excluded, and finding that out is what fixed
 * this check. It is IK-solved every frame toward a WORLD-space guard position
 * (Enemy._pose → rig.solveIK('armR', …, this.saberHand)), so when the rigid
 * path teleports the body around a 2.6 m arc the arm reaches back toward where
 * the guard still is, and its offset from the hips changes by 55.7 cm. The arm
 * therefore responds to being swung on BOTH paths, which makes it useless as a
 * discriminator — and the first version of this check was built on exactly that
 * bone.
 *
 * The legs and the head are driven by the gait and by nothing in the world, so
 * on the rigid path they are carried perfectly rigidly. Measured over the same
 * two-second arc: shin 0.0 cm, foot 0.0 cm, head 0.0 cm — not "small", zero to
 * the millimetre — against 118-194 cm hanging. That is the actual reported bug,
 * too: "its legs kept walking".
 */
const BONES = ['shinR', 'shinL', 'footR', 'footL', 'head'];

export async function run({ check, assert }) {
  await initPhysics();

  check('held: a body in the air hangs, instead of jogging through it', () => {
    /**
     * DOES SWINGING IT CHANGE WHERE THE ARMS GO? That is the whole question,
     * and it is the one this check did not previously ask.
     *
     * What it asked before was whether the hand travels FURTHER in the body's
     * own frame than it does on the rigid path — and the rigid path still runs
     * the animator, so its reference number is a gait swing, which is large.
     * Measured: 72.1 cm held against 42.7 cm rigid, a ratio of 1.69 against a
     * bar of 2. It had been passing at 2.41 because both the acolyte's FORM and
     * its gait phase come out of module-level RNG streams that whatever ran
     * before it had already advanced — the same defect as `duelling`'s, one
     * file later. Seeded, it fails; unseeded, it passed by luck. A bound that
     * depends on suite order is not a bound.
     *
     * So: run each path TWICE, once with the hold point swinging through a wide
     * arc and once with it held dead still at the same point, and measure how
     * much the hand-minus-chest offset DIFFERS between the two.
     *
     * A gait does not know where it is being carried. The animator produces the
     * same arm swing whether the body is thrown around the arena or parked, so
     * the rigid path scores near zero BY CONSTRUCTION rather than by being
     * smaller than something. A hanging arm is dragged by the chest it hangs
     * from, so it scores the arc. There is no phase, no form and no seed that
     * can make a jogging mannequin respond to being swung.
     */
    const heldSwung = swing();
    const heldStill = swing({ still: true });
    const rigidSwung = swing({ rigid: true });
    const rigidStill = swing({ rigid: true, still: true });

    const response = (a, b, bone) => {
      let worst = 0;
      const n = Math.min(a.rel[bone].length, b.rel[bone].length);
      for (let i = 0; i < n; i++) worst = Math.max(worst, a.rel[bone][i].distanceTo(b.rel[bone][i]));
      return worst;
    };
    assert(heldSwung.ragdolled, 'a body held off the ground is not ragdolled — its limbs cannot hang');
    const rows = [];
    for (const bone of BONES) {
      const heldR = response(heldSwung, heldStill, bone);
      const rigidR = response(rigidSwung, rigidStill, bone);
      assert(heldR > 0.40,
        `swinging the held body moved its ${bone} only ${(heldR * 100).toFixed(1)} cm relative to its `
        + 'own hips against holding it still — that limb is not answering the swing');
      assert(rigidR < 0.03,
        `the rigid path's ${bone} moved ${(rigidR * 100).toFixed(1)} cm in the body's frame when the `
        + 'body was swung — the reference is not rigid, so this comparison proves nothing');
      rows.push(`${bone} ${(heldR * 100).toFixed(0)}/${(rigidR * 100).toFixed(1)}`);
    }
    return `swinging the body moves each limb this far in its own frame, hanging vs carried (cm): `
      + rows.join(', ');
  });

  check('held: and the arm arrives after the body does', () => {
    /* The second half, and the one that reads as WEIGHT. A mannequin's foot
     * covers exactly the distance its chest covers; a hanging leg covers a
     * different distance, because it is being dragged. Measured as the mean
     * relative difference between the two over a swing — and on the FOOT, for
     * the reason set out over BONES: the sword arm is IK-solved to a world
     * point and is not carried rigidly on either path. */
    const held = swing();
    const rigid = swing({ rigid: true });
    assert(held.lag > 0.05,
      `the foot tracks the chest to within ${(held.lag * 100).toFixed(1)}% over the swing — nothing is lagging`);
    assert(held.lag > rigid.lag * 2,
      `held lag ${(held.lag * 100).toFixed(1)}% against rigid ${(rigid.lag * 100).toFixed(1)}% — no change`);
    return `foot lags the chest by ${(held.lag * 100).toFixed(0)}% of its travel, `
      + `against ${(rigid.lag * 100).toFixed(0)}% carried rigidly`;
  });

  check('held: the grip still works — it is suspended, not dropped', () => {
    /* The thing a ragdoll could plausibly have broken. Suspending by the chest
     * has to keep the body near the hold point, or "real limb physics" has cost
     * the player the power it was decorating. */
    const { e, w } = swing({ seconds: 1.4 });
    const target = e.liftTarget;
    assert(e.position.distanceTo(target) < 1.6,
      `the held body ended ${e.position.distanceTo(target).toFixed(2)} m from the hold point`);
    assert(!e.dead, 'suspending the body killed it');
    assert(e.position.y > 0.8, `the held body sank to ${e.position.y.toFixed(2)} m — it is on the floor`);
    for (const b of w.enemies) b.dispose?.();
    return `chest holds within ${e.position.distanceTo(target).toFixed(2)} m of the grip point`;
  });
}
