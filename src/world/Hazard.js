/**
 * SABER — the water that is not water.
 *
 * WHAT WAS WRONG. Nothing in any of the thirteen levels could hurt anybody.
 * `L.water` had exactly one consumer in the whole game — `new Water(...)` in
 * World.loadLevel — and `Water` (src/world/Scenery.js) is a transparent shader
 * plane with `ripple()`, `update()` and `dispose()`: no query, no volume, no
 * callback. So a lava sea, a canal of molten metal and an ocean were all
 * FLOORS. Measured with a real World and a real Player holding forward from
 * the spawn: 90 s on Mustafar ended 33 m under the surface of the lava sea at
 * 100/100 HP; 45 s on Kamino ended on the seabed at y = -9.0 with the eye under
 * the ocean for 64% of the walk, at 100/100 HP. The Foundry's own on-screen
 * notification says "the melt is not cover" about a decal.
 *
 * WHAT A HAZARD IS HERE. One number more on the level's own `water` block:
 *
 *   damage   HP per second while your feet are under the sheet. Lethal on the
 *            lava and the melt; absent on standing water.
 *   wade     how deep you may go before the level refuses to let you go
 *            deeper. This is the ocean's answer instead of damage — you cannot
 *            swim in this game (there is no stroke, no breath, no buoyancy),
 *            so the honest boundary is that deep water is somewhere you do not
 *            walk, resolved exactly the way Terrain.blockClimb resolves a face
 *            too steep to climb: push the body back up the bed's own gradient
 *            and take the velocity that was carrying it in.
 *   kind     what it is, carried into `damage()` as the source and used to
 *            pick the effect: 'lava', 'melt' or 'water'.
 *
 * WHY IT IS A PROP. `world.props` is ticked every frame between physics and
 * the draw, and a duck-typed member of it gets that tick without a line of
 * World.js changing — the idiom `Forest`, `RiderPack` and `DestructionProxy`
 * all already use, and each of them documents why. `capsules()` returns
 * nothing, so the blade solver never offers it a contact, and `boundingRadius`
 * is 0, so a bolt never finds it.
 *
 * IT APPLIES TO EVERYONE. A droid that walks into the lava burns in it. That
 * is not a flourish: the levels that have a hazard are the levels whose fights
 * happen along its edge, and a sea that kills only the player is a sea the
 * player learns to fight beside rather than over.
 */

import * as THREE from 'three';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * THE TICK. `Player.damage` sets `invuln = 0.18 s` on every hit it takes, so
 * damage applied per-frame would be silently thrown away 89% of the time —
 * 60 calls a second landing 5.5 of them. So the burn is applied four times a
 * second in quarter-second bites, which lands every one of them, and each bite
 * carries its own hit flash, its own shake and its own hurt sound instead of
 * sixty imperceptible ones.
 */
const TICK = 0.25;

export class Hazard {
  constructor(world, opts = {}) {
    this.id = 'hazard';
    this.world = world;
    this.dead = false;
    this.kind = opts.kind || 'water';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;

    /** The surface, in world y — the same number the drawn sheet uses. */
    this.level = opts.level ?? 0;
    /** HP per second of contact. Named `dps` because `damage()` is the prop
     *  contract's method and a field of the same name would shadow it. */
    this.dps = opts.damage ?? 0;
    /** How deep a body may wade before the water refuses it. */
    this.wade = opts.wade ?? Infinity;
    /**
     * How hard the bed shoves a body back toward the shallows, in m/s.
     *
     * 7.5 AND NOT 4.2, and the number is set by what it has to beat: a walk is
     * 4.6 m/s, so a shove under that is a body that walks out to sea slightly
     * more slowly. Measured on Kamino with a real Player holding forward off
     * the deck for twelve seconds, at 4.2 they were still 1.5 m under at the
     * end of it; at 7.5 the net is 2.9 m/s back toward the shallows and they
     * are out.
     */
    this.shove = opts.shove ?? 7.5;

    this._t = 0;
    // the prop contract, exactly as RiderPack states it: something for the
    // world to tick, and nothing for the blade or a bolt to find
    this.body = {
      position: new THREE.Vector3(0, -1e5, 0), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  /** Nothing cuts a sea. */
  damage() { return false; }

  update(dt) {
    if (!(dt > 0) || this.dead) return;
    this._t += dt;
    const bite = this._t >= TICK;
    if (bite) this._t = 0;
    const world = this.world;
    for (const p of (world.players || [])) {
      if (p && p.alive !== false) this._touch(p, bite, dt);
    }
    for (const e of (world.enemies || [])) {
      if (e && !e.dead) this._touch(e, bite, dt);
    }
  }

  /**
   * One body against the sheet.
   *
   * The test is the FEET (`position.y` is the ground point for both the player
   * and an enemy), because standing ankle-deep in molten rock is standing in
   * molten rock. A hazard with no `damage` and no `wade` is free
   * water and costs one comparison.
   */
  _touch(b, bite, dt) {
    const depth = this.level - b.position.y;
    if (depth <= 0) return;

    if (this.dps > 0 && bite) {
      _p.set(b.position.x, this.level, b.position.z);
      b.damage?.(this.dps * TICK, _p, null, this.kind);
      const fx = this.world.particles;
      if (fx) {
        if (this.kind === 'water') fx.splash?.(_p, 0.6);
        else fx.slag?.(_p, _n.set(0, 1, 0), this.kind === 'melt' ? 0xffc040 : 0xff8030);
      }
    }

    /**
     * TOO DEEP. Resolved as a boundary and not as a slowdown, for the same
     * reason the climb limit is: a body that can be pushed through a boundary
     * at 4.6 m/s is not standing behind one. The bed's own gradient is the way
     * out — up-slope is shoreward by definition on a heightfield — and the
     * velocity going deeper is taken away so nothing accumulates against it.
     */
    if (depth > this.wade) {
      const T = this.world.terrain;
      if (!T) return;
      T.normalAt(b.position.x, b.position.z, _n);
      // the plan direction of steepest ASCENT: the normal leans away from it
      let ux = -_n.x, uz = -_n.z;
      const g = Math.hypot(ux, uz);
      if (g < 1e-3) return;                       // a flat deep basin has no shore
      ux /= g; uz /= g;
      const step = Math.min(this.shove * dt, depth - this.wade);
      b.position.x += ux * step;
      b.position.z += uz * step;
      const v = b.velocity;
      if (v) {
        const into = -(v.x * ux + v.z * uz);
        if (into > 0) { v.x += into * ux; v.z += into * uz; }
      }
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
    if (this.world.hazard === this) this.world.hazard = null;
  }
}

/**
 * Give the level's water teeth. Called from a level's `dress()` with the same
 * block World hands to `Water`, so there is one place the numbers live.
 */
export function attachHazard(world, opts = {}) {
  if (!world) return null;
  if (world.hazard && !world.hazard.dead) return world.hazard;
  const h = new Hazard(world, opts);
  world.hazard = h;
  if (world.addProp) world.addProp(h);
  else if (world.props) world.props.push(h);
  return h;
}
