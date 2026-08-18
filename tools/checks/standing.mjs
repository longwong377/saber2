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
    /* `hurt`, `flash` and the rest are here because a body that falls far
     * enough now actually LANDS on the thing it used to pass through, and a
     * 67 m arrival costs hp — the fixture has to be able to survive the game
     * doing its job. */
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, setSense() {}, rumble() {},
      setDrain() {}, setBars() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, killTime() {}, setTimeScale() {}, onPlayerDeath() {},
    feelOn: () => true,
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
    // A footstep asks what it is standing ON, and this fixture now walks.
    surfaceAt: () => 'sand',
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
 * Something big enough to land on, in the shape `Enemy.platform()` returns.
 *
 * `deck` is the world height of the surface; the record hands back `position`
 * at the feet and `extent.y` as the height above them, which is exactly what
 * supportHeight's dynamic-prop branch reads — a rideable enemy and a crate are
 * the same question, and that is the point.
 */
function rideable(cx, cz, deck, r) {
  const e = {
    position: new THREE.Vector3(cx, 0, cz),
    dead: false, toppled: false,
    // a hard landing throws a shockwave through ctx.enemies, so this has to be
    // enough of an Enemy to be knocked about by one
    applyKnockback() {}, damage() {}, stun() {}, capsules: () => [],
    platform() {
      if (e.dead || e.toppled) return null;
      return { position: e.position, extent: new THREE.Vector3(r, deck - e.position.y, r) };
    },
  };
  return e;
}

/**
 * Drop a player from `fromY` onto whatever the world contains and run it.
 * Returns the per-frame trace so a property can be asserted over the tail
 * rather than at one lucky instant.
 */
function drop(world, fromY, { frames = 240, x = 0, z = 0, enemies = null } = {}) {
  const p = new Player(world, { isLocal: true });
  p.position.set(x, fromY, z);
  p.velocity.set(0, 0, 0);
  const input = stubInput();
  const ctx = {
    input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies,
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

/**
 * THE SAME DRIVER, POINTED UP.
 *
 * Every other fixture in this file drops a body and asks what caught it, and
 * that is exactly why twelve checks about what is under the feet stood beside
 * no check at all about what is over the head: the harness had no way to send
 * a body upward, so the one direction vertical resolution did not exist in was
 * also the one direction nothing here could look.
 *
 * `jump` presses the real bound action through the real input seam and holds
 * it for `hold` seconds, so the arc is the shipped Force jump — not a velocity
 * written onto the body, which would test a number this file made up.
 */
function launch(world, { frames = 120, hold = 0.7, x = 0, z = 0, fromY = 0 } = {}) {
  const p = new Player(world, { isLocal: true });
  p.position.set(x, fromY, z);
  p.velocity.set(0, 0, 0);
  const held = new Set(), hits = new Set();
  const input = { ...stubInput(), act: (a) => held.has(a), actHit: (a) => hits.has(a) };
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: null };
  const trace = [];
  for (let i = 0; i < frames; i++) {
    if (i === 4) { hits.add('jump'); held.add('jump'); }
    if (i > 4 + hold * 60) held.delete('jump');
    ctx.time = world.time = i / 60;
    p.update(1 / 60, ctx);
    hits.clear();
    trace.push({ i, y: p.position.y, vy: p.velocity.y, grounded: p.grounded });
  }
  return { p, trace, apex: Math.max(...trace.map((r) => r.y)) };
}

/** Drop a body from `fromY` with no input at all, and return where it stops. */
function plunge(world, fromY, { frames = 400, dive = false } = {}) {
  const p = new Player(world, { isLocal: true });
  p.position.set(0, fromY, 0);
  p.velocity.set(0, 0, 0);
  const input = stubInput();
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: null };
  let dived = false;
  for (let i = 0; i < frames; i++) {
    ctx.time = world.time = i / 60;
    if (dive && !dived && i === 6) dived = p._tryDive(ctx);
    p.update(1 / 60, ctx);
  }
  return { p, dived, y: p.position.y };
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

  check('standing: you land ON a spider walker instead of falling through it', () => {
    /**
     * THE SECOND HALF OF THE SAME BUG, reported separately: "you fall through
     * the giant spiders instead of landing on them."
     *
     * `_supportAt` asks one question of every surface at once, and the comment
     * above it says so — "one query, every surface, highest wins". Enemies were
     * not in the list. `_gatherNear` takes bodies on the PROP, DEBRIS and
     * RAGDOLL layers and skips everything else, so LAYER.ENEMY never reached
     * the query and a four-metre chassis was fog.
     */
    const w = stubWorld();
    w.terrain = flatTerrain();
    const walker = rideable(0, 0, 5.23, 1.27);
    const r = drop(w, 7.4, { enemies: [walker], frames: 260 });
    const end = r.trace[r.trace.length - 1];
    assert(end.y > 5.0,
      `dropped onto a walker whose deck is at 5.23 and ended at y=${end.y.toFixed(2)} — fell straight through it`);
    assert(end.grounded, 'standing on a walker does not count as being on the ground');
    assert(swing(r.trace, 200) < 0.05,
      `the deck is not solid: the body still moves ${(swing(r.trace, 200) * 1000).toFixed(0)} mm a frame after settling`);
    return `rest at y=${end.y.toFixed(3)} on a deck at 5.23, ${r.landings} landing(s)`;
  });

  check('standing: a walker is only floor where the walker is', () => {
    // The deck is 1.27 m of radius, not a plane at that height. Standing four
    // metres away from one has to leave you on the sand — a support query that
    // answers "5.23" everywhere is worse than one that answers nothing.
    const w = stubWorld();
    w.terrain = flatTerrain();
    const r = drop(w, 0.05, { enemies: [rideable(4.2, 0, 5.23, 1.27)], frames: 40 });
    const end = r.trace[r.trace.length - 1];
    assert(end.y < 0.01, `standing 4.2 m from a walker put the body at y=${end.y.toFixed(2)}`);
    return 'a deck 4.2 m away is not floor';
  });

  check('standing: a dead walker is not a floor', () => {
    // You do not stand in mid-air on something that has fallen over. Both the
    // corpse and the toppled state have to withdraw the platform, and the
    // player has to come down.
    const w = stubWorld();
    w.terrain = flatTerrain();
    const walker = rideable(0, 0, 5.23, 1.27);
    const r = drop(w, 5.4, { enemies: [walker], frames: 90 });
    assert(r.trace[89].y > 5.0, `did not land on the walker in the first place (y=${r.trace[89].y.toFixed(2)})`);
    for (const kill of ['dead', 'toppled']) {
      const w2 = stubWorld();
      w2.terrain = flatTerrain();
      const e = rideable(0, 0, 5.23, 1.27);
      e[kill] = true;
      const r2 = drop(w2, 5.4, { enemies: [e], frames: 200 });
      const end = r2.trace[r2.trace.length - 1];
      assert(end.y < 0.05, `a ${kill} walker still held the player up at y=${end.y.toFixed(2)}`);
    }
    return 'live deck holds; dead and toppled both drop you';
  });

  check('standing: the deck is measured off the chassis, over the middle of it', async () => {
    /**
     * The measurement itself, against the real geometry, because the number
     * that matters is not "the top of the bounding box". On a walker that is a
     * turret 0.35 m above the hull, and a player standing on it floats over a
     * sloped glacis. `_measurePlatform` takes the highest vertex inside the
     * central 60% of the hull's own footprint instead.
     *
     * Run through Enemy's own method on a real built rig rather than through a
     * full Enemy, which needs a scene, a physics world and an audio context.
     */
    const [{ Enemy }, { buildWalker, buildBeast, buildB1 }] = await Promise.all([
      import('../../src/game/Enemy.js'), import('../../src/game/Bodies.js'),
    ]);
    const out = [];
    for (const [name, build, S, big, bodyH] of [
      ['walker', buildWalker, 2.4, true, 1.6 * 2.4],
      ['acklay', buildBeast, 2.9, true, 1.5 * 2.9],
      ['b1', buildB1, 1.0, false, 0],
    ]) {
      const rig = build({ scale: S }).rig;
      const e = { A: { big, scale: S }, rig, position: new THREE.Vector3(), dead: false, toppled: false };
      Enemy.prototype._measurePlatform.call(e);
      if (!big) {
        assert(!e.platformRadius && !Enemy.prototype.platform.call(e),
          `a ${name} has a platform — landing on a battle droid's head is a bug with a nicer name`);
        out.push(`${name} none`);
        continue;
      }
      const box = new THREE.Box3().setFromObject(rig.get('body').parts[0]);
      assert(e.platformTop > 0.8,
        `${name}'s deck measured ${e.platformTop.toFixed(2)} m above the hips — that is inside the chassis`);
      assert(e.platformTop <= box.max.y + 1e-6,
        `${name}'s deck is ${e.platformTop.toFixed(2)} m, above the hull's own top at ${box.max.y.toFixed(2)}`);
      assert(e.platformRadius > 1.0 && e.platformRadius < (box.max.x - box.min.x),
        `${name}'s deck is ${e.platformRadius.toFixed(2)} m of radius on a hull ${(box.max.x - box.min.x).toFixed(2)} m wide`);
      // and it rides the pose: move the bone, the deck moves with it
      rig.hipsBone.obj.position.y = bodyH;
      const p = Enemy.prototype.platform.call(e);
      const top = p.position.y + p.extent.y;
      assert(Math.abs(top - (bodyH + e.platformTop)) < 1e-6,
        `${name}'s deck did not follow its chassis: bone at ${bodyH.toFixed(2)} put the deck at ${top.toFixed(2)}`);
      out.push(`${name} deck ${top.toFixed(2)} m, r ${e.platformRadius.toFixed(2)}`);
    }
    return out.join('; ');
  });

  check('standing: there is a ceiling, and you stop under it', () => {
    /**
     * THERE WAS NO CEILING IN THIS GAME.
     *
     * `_collide`'s depenetration loop skips upward faces — correct, floors
     * belong to the support query — and then flattens what is left with
     * `_v5.y = 0`, which for a DOWNWARD face is the whole normal. So the
     * contact under a slab was computed and thrown away, and vertical
     * resolution existed in one direction only. On the code this replaces, a
     * jump under a slab spanning y=3.5..4.5 crossed the underside at f38, was
     * 0.5 m inside solid rock at f42, and STEP_UP snapped the body out ONTO
     * THE ROOF at f57, where it stood. Swept over the nine shipped levels the
     * same jump entered 11 roofs from underneath.
     *
     * The property is the one a player would state: a roof you jump into is a
     * roof you hit. Both halves are asserted, because passing the first alone
     * is what the old code did in the frame before it teleported.
     */
    const w = stubWorld();
    w.terrain = flatTerrain();
    w.physics.staticBoxes.push(box(0, 4.0, 0, 4, 0.5, 4));    // underside 3.5, top 4.5
    const r = launch(w, { frames: 150 });
    const crown = r.p._crownHeight();
    assert(r.apex + crown <= 3.5 + 0.01,
      `the head reached y=${(r.apex + crown).toFixed(2)} through a slab whose underside is at 3.50`);
    assert(r.trace[r.trace.length - 1].y < 0.01,
      `the jump ended at y=${r.trace[r.trace.length - 1].y.toFixed(2)} — the roof at 4.50 was entered from below `
      + 'and STEP_UP put the body on top of it');
    // …and the ceiling is only a ceiling where the slab is: the same jump one
    // span to the side has to reach its full height, or "a ceiling" would just
    // be a shorter jump everywhere.
    const w2 = stubWorld();
    w2.terrain = flatTerrain();
    w2.physics.staticBoxes.push(box(9, 4.0, 0, 4, 0.5, 4));
    const clear = launch(w2, { frames: 150 });
    assert(clear.apex > r.apex + 1,
      `with the slab 9 m away the jump still only reached ${clear.apex.toFixed(2)} m against `
      + `${r.apex.toFixed(2)} m under it — the ceiling is being applied to open sky`);
    return `apex ${r.apex.toFixed(2)} m (crown ${(r.apex + crown).toFixed(2)} under a 3.50 underside), `
      + `${clear.apex.toFixed(2)} m in the open, and it comes back down`;
  });

  check('standing: a fast descent cannot fall through the floor', () => {
    /**
     * `supportHeight` only answers with a surface within STEP_UP (0.45) below
     * the feet and the grounding window is GROUND_SNAP (0.12) above it, so a
     * frame that steps more than 0.57 m — 34.2 m/s at 1/60 — passes clean
     * between the two and the floor is never seen. DIVE_SPEED is 30 and
     * gravity keeps adding. Measured on this fixture, the identical column: a
     * dive from 25 m rested on the roof at y=22.80 and a dive from 60 m went
     * through the roof AND the deck under it to y=0.00.
     *
     * The A/B is the assertion, not the absolute: the same roof, the same
     * column, two heights, and the answer must not depend on how fast you
     * arrived. `_collide` sweeps from where the feet were at the top of the
     * frame, so every surface crossed during the step answers.
     */
    const roof = () => {
      const w = stubWorld();
      w.terrain = flatTerrain();
      w.physics.staticBoxes.push(box(0, 22.5, 0, 6, 0.3, 6));   // top at 22.80
      return w;
    };
    const slow = plunge(roof(), 25, { dive: true });
    const fast = plunge(roof(), 60, { dive: true });
    assert(slow.dived && fast.dived, 'the fixture never actually dived');
    assert(Math.abs(slow.y - 22.80) < 0.02,
      `a dive from 25 m came to rest at y=${slow.y.toFixed(2)} on a roof topping out at 22.80`);
    assert(Math.abs(fast.y - slow.y) < 0.02,
      `a dive from 25 m rests at y=${slow.y.toFixed(2)} and one from 60 m at y=${fast.y.toFixed(2)} — `
      + 'the same roof, the same column, and the faster body went through it');
    // and a free fall long enough to beat the window, with no dive at all
    const drop90 = plunge(roof(), 90);
    assert(Math.abs(drop90.y - 22.80) < 0.02,
      `a 67 m free fall ended at y=${drop90.y.toFixed(2)} instead of on the roof at 22.80`);
    return `roof at 22.80: dive from 25 → ${slow.y.toFixed(2)}, from 60 → ${fast.y.toFixed(2)}, `
      + `90 m free fall → ${drop90.y.toFixed(2)}`;
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
