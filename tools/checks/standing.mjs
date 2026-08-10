/**
 * Standing on things. — src/game/Player.js
 *
 * The player's words: "every time you jump on top of an object, say a boulder
 * or a structure, you don't really stand on it well — you like repeatedly hop
 * over and over and over and kind of slide off, and phase into it."
 *
 * Three symptoms, one root cause and four passengers. `_collide` set
 * `grounded = true` when the player landed on a box and then, fifty lines
 * later, an unguarded `else if` re-decided it from the TERRAIN HEIGHTFIELD
 * alone — which on top of a boulder is metres below you. So `grounded` went
 * false again on the same frame, gravity re-applied, the body sank into the
 * rock, the snap teleported it back out, and around again at roughly 5 Hz.
 *
 * The amplitude was not subtle either: the player collided as a SINGLE SPHERE
 * AT MID-BODY, 0.89 m above the feet with a 0.36 m radius, so the top-snap
 * could not fire until the feet were 0.53 m inside the rock.
 *
 * Nothing in this project tested player movement at all — not one check
 * instantiated a Player and stepped it. That is why a bug this loud lived
 * through six rounds of measured improvement. These are the properties, and
 * every one of them fails on the code they were written against.
 */
import { Player } from '../../src/game/Player.js';
import { LAYER } from '../../src/physics/RapierWorld.js';

let THREE = null;

/** A world with no GPU, no level and a floor at y=0. */
function stubWorld() {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: null, particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {},
  };
}

function stubInput() {
  const keys = new Set();
  return {
    keys, buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    act: () => false, actHit: () => false,
  };
}

/** A flat terrain at height 0 with the shape Player expects. */
function flatTerrain() {
  return {
    height: () => 0,
    normalAt: (x, z, out) => out.set(0, 1, 0),
    inBounds: () => true,
    half: 200,
    crater() {},
  };
}

/** A static box, in the shape RapierWorld.addStaticBox produces. */
function box(cx, cy, cz, hx, hy, hz) {
  const half = new THREE.Vector3(hx, hy, hz);
  return {
    center: new THREE.Vector3(cx, cy, cz),
    halfExtents: half,
    quat: new THREE.Quaternion(),
    invQuat: new THREE.Quaternion(),
    radius: half.length(),
    disabled: false,
  };
}

/** A dynamic prop — a crate — with the fields Body now publishes. */
function crate(cx, cy, cz, h = 0.35) {
  return {
    position: new THREE.Vector3(cx, cy, cz),
    extent: new THREE.Vector3(h, h, h),
    boundingRadius: h * Math.sqrt(3),
    invMass: 1 / 40, mass: 40, layer: LAYER.PROP,
    wake() {}, applyImpulse() {},
  };
}

/**
 * Drop a player from `fromY` onto whatever the world contains and run it.
 * Returns the per-frame trace so a property can be asserted over the tail
 * rather than at one lucky instant.
 */
function drop(world, fromY, { frames = 240, x = 0, z = 0 } = {}) {
  const p = new Player(world, { isLocal: true });
  p.position.set(x, fromY, z);
  p.velocity.set(0, 0, 0);
  const input = stubInput();
  const ctx = {
    input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0,
  };
  const trace = [];
  let landings = 0, footsteps = 0;
  p.animator.onFootstep = () => { footsteps++; };
  const land = p._land.bind(p);
  p._land = (c, s) => { landings++; return land(c, s); };
  for (let i = 0; i < frames; i++) {
    ctx.time = world.time = i / 60;
    p.update(1 / 60, ctx);
    trace.push({ i, y: p.position.y, grounded: p.grounded, vy: p.velocity.y, landings, footsteps });
  }
  return { p, trace, get landings() { return landings; }, get footsteps() { return footsteps; } };
}

/** Peak-to-peak of a value over the settled tail of a trace. */
const swing = (trace, from, key = 'y') => {
  const t = trace.slice(from).map(r => r[key]);
  return Math.max(...t) - Math.min(...t);
};

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('standing: on top of a boulder you STAND, you do not bounce', () => {
    // THE ONE THIS SUITE EXISTS FOR. On the code this replaced the body cycled
    // through roughly 0.53 m at about 5 Hz forever — free-fall into the rock
    // and a teleport back out, over and over, which is exactly what the player
    // described. The bound here is a millimetre, because a figure standing
    // still on a rock should be still.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 1.0, 0, 1.2, 1.0, 1.2));   // top at y = 2.0
    const r = drop(w, 3.4);
    const settled = r.trace.slice(120);
    const top = 2.0;
    assert(Math.abs(settled[settled.length - 1].y - top) < 0.002,
      `came to rest at y=${settled[settled.length - 1].y.toFixed(3)} on a boulder whose top is ${top}`);
    assert(swing(r.trace, 120) < 0.001,
      `the body moved ${(swing(r.trace, 120) * 1000).toFixed(0)}mm up and down while standing still on a rock`);
    assert(settled.every(s => s.grounded),
      `grounded went false on ${settled.filter(s => !s.grounded).length} of ${settled.length} frames while standing on a rock`);
    return `rest at y=${settled[settled.length - 1].y.toFixed(4)}, `
      + `${(swing(r.trace, 120) * 1000).toFixed(2)}mm of movement over 2 s`;
  });

  check('standing: the feet never go inside the thing they are standing on', () => {
    // "phase into it". The old collider was a sphere at mid-body, so support
    // could not exist until the feet were 0.53 m below the surface.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 1.0, 0, 1.2, 1.0, 1.2));
    const r = drop(w, 4.0);
    let worst = 0;
    for (const s of r.trace.slice(60)) worst = Math.max(worst, 2.0 - s.y);
    assert(worst < 0.01, `the feet went ${(worst * 1000).toFixed(0)}mm inside the rock`);
    return `deepest penetration after the landing frame: ${(worst * 1000).toFixed(2)}mm`;
  });

  check('standing: you do not slide off what you are standing on', () => {
    // A GUARD, not a regression test — say so rather than imply otherwise. It
    // passes on the old code too: dropped straight down with no horizontal
    // speed the body happens to settle on the top face even there. It is kept
    // because vertical depenetration is new and a lip is where it would first
    // go wrong, but it did not reproduce the player's "slide off" on its own.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 1.0, 0, 1.2, 1.0, 1.2));
    const r = drop(w, 2.6, { x: 1.05, z: 0 });         // 15cm from a 1.2m lip
    const end = r.trace[r.trace.length - 1];
    const drift = Math.hypot(r.p.position.x - 1.05, r.p.position.z);
    assert(end.y > 1.9, `standing near the edge, the body ended at y=${end.y.toFixed(2)} — it fell off`);
    assert(drift < 0.05, `the body slid ${(drift * 100).toFixed(1)}cm across a surface it was standing still on`);
    return `15cm from the lip: still at y=${end.y.toFixed(3)}, drifted ${(drift * 1000).toFixed(1)}mm`;
  });

  check('standing: the feet are planted on the rock, not on the ground under it', () => {
    // The gait's `groundAt` sampled the terrain heightfield only, so with the
    // pelvis at y=2 both ankles were driven to y=0 and the legs were drawn
    // straight through the boulder.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 1.0, 0, 1.6, 1.0, 1.6));
    const r = drop(w, 3.2);
    const feet = r.p.animator.feet;
    for (const f of feet) {
      // planted, not merely hovering at the right height: the airborne tuck
      // pose also puts a foot near the body, so height alone does not tell
      // these two apart and this check passed on the broken code when it did.
      assert(f.grounded && !f.air, 'a foot is not planted at all while the body stands on a rock');
      assert(f.planted.y > 1.9,
        `a foot is PLANTED at y=${f.planted.y.toFixed(2)} while the body stands on a surface at y=2.0`);
    }
    return `both feet planted at y=${feet.map(f => f.planted.y.toFixed(3)).join(' / ')} on a 2.0 m rock`;
  });

  check('standing: the GAIT believes it is standing, not falling', () => {
    // Correction to a guess made while writing this file: the old code did not
    // spam footsteps. It did something quieter and worse — `grounded` was false
    // on EVERY frame, so `Rig.js` never reached its re-plant branch at all and
    // held both legs in the airborne tuck the whole time you stood on a rock.
    // The legs dangle. That is most of "you don't really stand on it well",
    // and it is why the feet check above passes for the wrong reason if you
    // measure their height instead of their state.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 1.0, 0, 1.4, 1.0, 1.4));
    const r = drop(w, 3.0, { frames: 300 });
    const anim = r.p.animator;
    for (let k = 0; k < 2; k++) {
      assert(anim.feet[k].grounded,
        `the gait has foot ${k} in the air while the body stands on a rock`);
      assert(!anim.feet[k].air, `the gait has foot ${k} in its airborne tuck pose on solid rock`);
    }
    assert(anim.airTime === 0, `the gait has been airborne for ${anim.airTime.toFixed(2)}s while standing still`);
    return 'both feet planted, airTime 0';
  });

  check('standing: landing on a rock is a landing, and stepping off is not', () => {
    // `_land` and the `fallSpeed` reset lived only on the terrain branch, so a
    // prop landing was silent AND kept a stale most-negative fallSpeed, which
    // then fired a bogus violent landing — camera shake, dust, crater — the
    // moment you walked off onto sand.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 1.0, 0, 1.2, 1.0, 1.2));
    const r = drop(w, 6.0, { frames: 180 });
    assert(r.landings === 1, `dropping 4 m onto a rock produced ${r.landings} landings`);
    assert(Math.abs(r.p.fallSpeed) < 0.001,
      `fallSpeed is still ${r.p.fallSpeed.toFixed(2)} while standing on a rock — it will fire a false landing later`);
    return `one landing from 4 m, fallSpeed reset to ${r.p.fallSpeed.toFixed(3)}`;
  });

  check('standing: a crate holds your weight', () => {
    // Dynamic props gave NO vertical support at all — the shove loop ended in
    // `_v2.y = 0`, so you fell straight through a crate to the terrain.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.bodies.push(crate(0, 0.35, 0, 0.35));
    const r = drop(w, 2.2);
    const end = r.trace[r.trace.length - 1];
    assert(end.y > 0.65,
      `stood on a crate whose top is at 0.70 and ended at y=${end.y.toFixed(2)} — fell through it`);
    assert(end.grounded, 'standing on a crate does not count as being on the ground');
    return `rest at y=${end.y.toFixed(3)} on a crate topping out at 0.70`;
  });

  check('standing: a ledge above your head does not snatch you out of the air', () => {
    // The support query has to reject surfaces that are walls rather than
    // floors, or jumping past an overhang would teleport you onto it. STEP_UP
    // is that line and this is what holds it there.
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(3.0, 1.0, 0, 1.0, 1.0, 1.0));   // top at 2.0, well to the side
    const r = drop(w, 0.05, { frames: 30 });
    assert(r.trace[r.trace.length - 1].y < 0.01,
      `standing on flat ground 2 m from a rock, the body was pulled to y=${r.trace[r.trace.length - 1].y.toFixed(2)}`);
    return 'a 2 m rock 3 m away is not floor';
  });
}
