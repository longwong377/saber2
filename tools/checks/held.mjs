/**
 * SABER — what a body does while you are holding it in the air.
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
 *   · the limbs move RELATIVE TO THE CHEST while the body is swung. A rigid
 *     transform cannot do that at all — every bone keeps its offset — so the
 *     old path scores a flat zero on the only thing that matters.
 *   · and they LAG. Swing the hold point and the hand arrives after the chest
 *     does, which is the difference between a body and a mannequin.
 *
 * Both run on a real Rapier world, because the claim is about a joint solve.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy } from '../../src/game/Enemy.js';

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
function swing({ rigid = false, seconds = 2.2 } = {}) {
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
  const rel = [];
  const chestT = [], handT = [];
  for (let i = 0; i < seconds / dt; i++) {
    ctx.time = w.time += dt;
    // swing it in a wide arc, the way a mouse does
    hold.set(Math.sin(i / 14) * 2.6, 2.2 + Math.sin(i / 23) * 0.5, -3 + Math.cos(i / 14) * 1.2);
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
    const chest = at('chest');
    const hand = at('foreR');
    rel.push(hand.clone().sub(chest));
    chestT.push(chest.clone());
    handT.push(hand.clone());
  }

  // How much the hand moved IN THE BODY'S OWN FRAME: the spread of the
  // hand-minus-chest offset. Rigid motion holds it constant.
  const mean = rel.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / rel.length);
  let spread = 0;
  for (const v of rel) spread = Math.max(spread, v.distanceTo(mean));

  // …and the lag: how far behind the chest's own travel the hand runs.
  let lag = 0, n = 0;
  for (let i = 6; i < chestT.length; i++) {
    const dChest = chestT[i].distanceTo(chestT[i - 6]);
    const dHand = handT[i].distanceTo(handT[i - 6]);
    if (dChest > 0.05) { lag += Math.abs(dHand - dChest) / dChest; n++; }
  }
  return { spread, lag: n ? lag / n : 0, ragdolled: !!e.actor?.ragdolled, e, w };
}

export async function run({ check, assert }) {
  await initPhysics();

  check('held: a body in the air hangs, instead of jogging through it', () => {
    /* The number that matters is the first one: how far the hand moves in the
     * body's own frame over a two-second swing. A rigid transform scores
     * essentially zero by construction — whatever the animator happens to be
     * doing is the same whether or not the body is being swung — and a hanging
     * arm scores centimetres. The bar is 6 cm, which is under half a hand's
     * length and far above anything a gait can produce while its owner is off
     * the ground. */
    const held = swing();
    const rigid = swing({ rigid: true });
    assert(held.ragdolled, 'a body held off the ground is not ragdolled — its limbs cannot hang');
    assert(held.spread > 0.06,
      `the held body's hand moved ${(held.spread * 100).toFixed(1)} cm in its own frame over the `
      + 'whole swing — it is being carried rigidly');
    assert(held.spread > rigid.spread * 2,
      `held ${(held.spread * 100).toFixed(1)} cm against rigid ${(rigid.spread * 100).toFixed(1)} cm — `
      + 'the limbs are no more alive than they were');
    return `hand travel in the body's frame: ${(held.spread * 100).toFixed(1)} cm held, `
      + `${(rigid.spread * 100).toFixed(1)} cm rigid`;
  });

  check('held: and the arm arrives after the body does', () => {
    /* The second half, and the one that reads as WEIGHT. A mannequin's hand
     * covers exactly the distance its chest covers; a hanging arm covers a
     * different distance, because it is being dragged. Measured as the mean
     * relative difference between the two over a swing. */
    const held = swing();
    const rigid = swing({ rigid: true });
    assert(held.lag > 0.05,
      `the hand tracks the chest to within ${(held.lag * 100).toFixed(1)}% over the swing — nothing is lagging`);
    assert(held.lag > rigid.lag,
      `held lag ${(held.lag * 100).toFixed(1)}% against rigid ${(rigid.lag * 100).toFixed(1)}% — no change`);
    return `hand lags the chest by ${(held.lag * 100).toFixed(0)}% of its travel, `
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
