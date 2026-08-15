/**
 * BATTLEFRONT BORZ — a hilt on the ground.
 *
 * Note 61: "drop and pick up sabers, including a friend's."
 *
 * Before this there was no such object in the game. A duellist that lost the
 * arm holding its weapon called `saber.retract()` and the hilt ceased to exist
 * — so the most legible thing that can happen in a swordfight, one of you
 * losing your sword, produced nothing you could walk over and take. And the
 * player had no way to put theirs down at all.
 *
 * WHAT A DROPPED HILT IS. An ordinary `Prop`, which is deliberate and buys four
 * things without a line of new code each: it falls and rolls with real physics,
 * it can be picked up by the Force like any other loose object, the blade can
 * knock it across the floor, and it is in `world.props` so the level's own
 * culling and cleanup already know about it. What it adds is an identity —
 * `crystal`, `hiltStyle` and `order` — so that the weapon you pick up is the
 * weapon that was dropped, down to the metal it was machined from.
 *
 * THE FRIEND'S SABER CASE, which is the interesting half of the note and the
 * reason the identity travels rather than just the mesh: in co-op, your
 * partner's hilt is built from THEIR order's tuning with THEIR crystal. Pick it
 * up and you are holding their weapon — a Sith's bled red in a Jedi's hand, or
 * a Consular's gold hilt in yours — until you drop it again. Nothing about the
 * player's own saved identity is touched; `Player.takeSaber` rebuilds the blade
 * from what it was handed and remembers what it put down.
 */

import * as THREE from 'three';
import { Prop } from '../world/Props.js';
import { SABER_COLORS, BLADE_TUNING, buildHiltGroup } from './Saber.js';
import { TOUGHNESS } from './Combat.js';

const _v = new THREE.Vector3();

/**
 * How far a hilt can be picked up from, and how long it must lie there first.
 *
 * 1.6 m is a long reach for a hand and is deliberately generous — a hilt is a
 * 25 cm object that has just bounced off a wall, and hunting for the exact
 * pixel is not a skill worth testing. The delay is the important one: without
 * it, dropping your saber and walking forward picks it straight back up on the
 * next frame, and the player never sees it leave their hand.
 */
export const PICKUP_REACH = 1.6;
export const PICKUP_DELAY = 0.7;

/**
 * Put a hilt on the ground.
 *
 * @param world
 * @param opts.position   where it leaves the hand
 * @param opts.velocity   how it leaves it — a disarm throws, a drop does not
 * @param opts.colorIndex the crystal it was built with
 * @param opts.hiltStyle
 * @param opts.order      whose tuning machined it, for the metals
 * @param opts.owner      whoever dropped it, so it cannot be re-taken instantly
 */
export function dropSaber(world, opts = {}) {
  if (!world || !world.scene) return null;
  const colorIndex = opts.colorIndex ?? 0;
  const crystal = SABER_COLORS[colorIndex] || SABER_COLORS[0];
  const built = buildHiltGroup({
    tuning: opts.order ? BLADE_TUNING[opts.order] : null,
    color: new THREE.Color(crystal.hex),
    style: opts.hiltStyle,
  });

  /* The group is built about the EMITTER, which is 15 cm above the middle of
   * the hilt — so dropped as-is it lies with its handle buried and its muzzle
   * in the air. Re-centring it here rather than moving the spec keeps the
   * in-hand geometry exactly where `GRIP_AT` expects it. */
  const box = new THREE.Box3().setFromObject(built.group);
  const mid = box.getCenter(_v).clone();
  built.group.position.sub(mid);
  const mesh = new THREE.Group();
  mesh.add(built.group);

  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const prop = new Prop(world, {
    kind: 'hilt',
    mesh,
    // A lightsaber hilt is a machined metal cylinder: heavy for its size, hard
    // to cut, and it does not shatter. `toughness` is the armour figure because
    // that is what it is — you can cut one in half, but not casually.
    toughness: TOUGHNESS.armour,
    hp: 60,
    mass: 1.6,
    weather: false,
    grippable: true,
    bladeColor: crystal.hex,
    spheres: [{ c: new THREE.Vector3(0, 0, 0), r: Math.max(half.x, half.z, 0.03) },
      { c: new THREE.Vector3(0, half.y * 0.6, 0), r: Math.max(half.x, half.z, 0.03) },
      { c: new THREE.Vector3(0, -half.y * 0.6, 0), r: Math.max(half.x, half.z, 0.03) }],
  });

  prop.saber = { colorIndex, hiltStyle: opts.hiltStyle, order: opts.order ?? null };
  prop.droppedBy = opts.owner ?? null;
  prop.dropAge = 0;
  if (opts.position) prop.body.position.copy(opts.position);
  if (opts.velocity) prop.body.velocity.copy(opts.velocity);
  // A hilt tumbles. It is a cylinder with a hook on it, not a ball.
  prop.body.angularVelocity.set(
    (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 8);
  world.addProp?.(prop);
  return prop;
}

/**
 * The hilt this actor could pick up, or null.
 *
 * Nearest first, and never one you put down inside the last `PICKUP_DELAY` —
 * see the note over the constant. `world.props` is scanned rather than a
 * separate list being kept, because a dropped hilt that has been cut in half or
 * culled is no longer in it, and one register is one thing to be wrong.
 */
export function hiltWithinReach(world, actor, reach = PICKUP_REACH) {
  if (!world || !world.props) return null;
  let best = null, bestD = reach * reach;
  for (const p of world.props) {
    if (p.dead || !p.saber) continue;
    if (p.droppedBy === actor && p.dropAge < PICKUP_DELAY) continue;
    const d = p.body.position.distanceToSquared(actor.position);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Age every dropped hilt, so the delay above means something. */
export function ageDropped(world, dt) {
  if (!world || !world.props) return;
  for (const p of world.props) if (p.saber && p.dropAge !== undefined) p.dropAge += dt;
}
