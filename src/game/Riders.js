/**
 * BATTLEFRONT BORZ — things that are ridden.
 *
 * "A wave of unique large creatures each fought differently, SOME RIDDEN."
 *
 * A rider is not a new kind of body and it is deliberately not one. It is an
 * ordinary enemy — a B2 with its own health, its own gun, its own hit boxes and
 * its own death — whose POSITION is taken over by whatever it is sitting on.
 * Everything that makes it worth having falls straight out of that:
 *
 *   you can shoot it off, and the mount keeps coming;
 *   you can kill the mount, and the rider comes down and fights on foot;
 *   the blade reaches the mount's legs and not the rider, because the rider is
 *     three metres up, which is the whole tactical question the pairing asks.
 *
 * WHY IT LIVES IN `world.props`. The World's update order is enemies (step 2),
 * blades (3), bolts (4), physics (5), then props (6) — so a prop's `update`
 * runs after every enemy has moved and before anything draws. That is exactly
 * the slot a rider needs and it is the slot `Destruction` already uses for its
 * own proxy: riding in the prop list buys a per-frame tick without a line of
 * World.js changing. `capsules()` returns nothing, so the blade solver never
 * offers the pack a contact — the rider and the mount are already in the target
 * list on their own account.
 *
 * WHO GETS A RIDER is declared on the ARCHETYPE, as `saddle: '<type>'`, for the
 * same reason a level's arrivals are declared beside the level: the pairing is
 * a property of the creature, not of the code that spawns it. An archetype with
 * no `saddle` is never crewed and pays nothing.
 *
 * AND IT IS PAID FOR. A rider is a whole extra body on the field, so a mount
 * that carries one must be priced with it — the wave director spends `threat`,
 * and a mount that quietly brought a free B2 would be a wave 30% bigger than
 * the budget says. `saddleThreat` is the number a mount has to add, and
 * `tools/checks/colosseum.mjs` asserts that every saddled archetype has it.
 */

import * as THREE from 'three';
import { ARCHETYPES } from './Enemy.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** What a mount must add to its own threat for the body it carries. */
export function saddleThreat(type) {
  const A = ARCHETYPES[type];
  if (!A || !A.saddle) return 0;
  return ARCHETYPES[A.saddle]?.threat ?? 0;
}

class RiderPack {
  constructor(world) {
    this.id = 'riders';
    this.world = world;
    this.dead = false;
    this.kind = 'riders';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;
    /** mount → { rider, seat, back } */
    this.bound = new Map();
    /** mounts we have already tried to crew, so a failed spawn is not retried
     *  sixty times a second for the rest of the level. */
    this.seen = new WeakSet();
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  /** Put somebody on this mount's back, if its archetype asks for one. */
  crew(mount) {
    const A = mount.A;
    if (!A || !A.saddle) return null;
    const plat = mount.platform();
    if (!plat) return null;
    /* Spawned AT the deck rather than on the ground beside it. `spawnEnemy`
     * seats a body on the terrain, so a rider made at ground level spends its
     * first frame standing in the mount's legs — visible, and long enough for
     * the physics to push the two apart. */
    _v1.copy(mount.position);
    _v1.y = plat.position.y + plat.extent.y;
    const rider = this.world.spawnEnemy(A.saddle, _v1);
    if (!rider) return null;
    /* A rider does not walk. Zeroing `speed` is what stops its own brain from
     * trying to close on the player — its position is overwritten every frame
     * anyway, but a body whose animator thinks it is sprinting on the spot is
     * exactly what a rider must not look like. It gets it back on dismount. */
    rider._footSpeed = rider.speed;
    rider.speed = 0;
    // it can see further from up there, and it has to: a gunner on a mount that
    // is closing to 3 m would never fire.
    rider._footPreferred = rider.A.preferred;
    const seat = { rider, back: -(0.24 + 0.10) * (A.scale ?? 1), yaw: 0 };
    this.bound.set(mount, seat);
    return rider;
  }

  /** Take the rider off — because the mount died, fell, or was cut in half. */
  dismount(mount, seat) {
    this.bound.delete(mount);
    const r = seat.rider;
    if (!r || r.dead) return;
    r.speed = r._footSpeed ?? r.A.speed;
    /* Thrown clear, not deleted. It is a real body with real health and it has
     * just fallen three metres off something that was killed under it, so it
     * arrives with the mount's own momentum and takes the landing like anything
     * else that falls in this game. */
    r.velocity.copy(mount.velocity).multiplyScalar(0.8);
    r.velocity.y = 2.6;
    _v2.set(Math.cos(seat.yaw), 0, Math.sin(seat.yaw)).multiplyScalar(2.4);
    r.velocity.add(_v2);
    r.grounded = false;
    r.stun?.(0.7);
  }

  update(dt) {
    if (!(dt > 0)) return;
    const world = this.world;
    const enemies = world.enemies;
    if (!enemies) return;

    // adopt anything new that asks for a rider
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead || !e.A || !e.A.saddle) continue;
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      this.crew(e);
    }

    for (const [mount, seat] of this.bound) {
      const r = seat.rider;
      if (!r || r.dead || !r.position) { this.bound.delete(mount); continue; }
      const plat = mount.dead || mount.toppled ? null : mount.platform();
      if (!plat) { this.dismount(mount, seat); continue; }

      /* THE SEAT. Behind the shoulders and above the deck, in the mount's own
       * frame, so a rider on a beast that is turning turns with it. `facing` is
       * the yaw the animator poses the body to, which is what the saddle is
       * bolted to — using the velocity instead would swing the rider out to the
       * side every time the mount strafed. */
      const yaw = mount.facing ?? 0;
      seat.yaw = yaw;
      const back = seat.back;
      const x = mount.position.x + Math.sin(yaw) * back;
      const z = mount.position.z + Math.cos(yaw) * back;
      const y = plat.position.y + plat.extent.y;

      const dx = x - r.position.x, dy = y - r.position.y, dz = z - r.position.z;
      r.position.set(x, y, z);
      /* The rig was posed from `position` earlier this same frame, in step 2,
       * so moving the body here without moving what was drawn from it leaves
       * the mesh one frame behind — 10 cm at a charging mount's 6 m/s, which
       * reads as the rider sliding on the back. Carrying the same delta into
       * the rig root closes it. */
      if (r.rig?.root) r.rig.root.position.set(
        r.rig.root.position.x + dx, r.rig.root.position.y + dy, r.rig.root.position.z + dz);
      else if (r.group) r.group.position.set(
        r.group.position.x + dx, r.group.position.y + dy, r.group.position.z + dz);
      r.velocity.set(0, 0, 0);
      r.grounded = true;
      r.wish = null;
      r._syncBody?.();
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.bound.clear();
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
}

/**
 * The world's rider pack, made on demand. A level that has nothing rideable in
 * its pool never needs to call this, and nothing costs it anything if it does:
 * the pack's whole per-frame cost with no mounts on the field is one pass over
 * `world.enemies`.
 */
export function attachRiders(world) {
  if (!world) return null;
  if (world.riders && !world.riders.dead) return world.riders;
  const pack = new RiderPack(world);
  world.riders = pack;
  if (world.addProp) world.addProp(pack);
  else if (world.props) world.props.push(pack);
  return pack;
}

export { RiderPack };
