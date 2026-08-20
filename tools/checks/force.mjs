/**
 * BATTLEFRONT BORZ — the Force.
 *
 * Six complaints, all of them measurable, all of them from the player:
 *
 *   "when you use force powers there should be associated body movements"
 *   "even at max force powers there's a limit to the size of things that move"
 *   "everything feasible should be able to be picked up via the force"
 *   "when I pick up something how do I control the distance and how do I throw"
 *   "I should be able to with the force stop bolts mid air and send them back"
 *   "I need an option to force disassemble a droid into parts"
 *
 * Every one of them was a plausible-looking number underneath. The grip wrote a
 * held body's VELOCITY directly, so a 900 kg pillar and a 22 kg crate both
 * travelled 5.01 m in the first second and a hurl launched every mass in the
 * game at exactly 26.0 m/s — mass was not modelled at all, it was cancelled.
 * The only real size cap was Enemy.grippable, a flat `!A.big && !A.boss` that
 * no setting could reach. The wheel was already read for grip distance and was
 * ALSO read by SaberController for wrist roll, one notch doing two things. And
 * no power posed a single bone.
 *
 * So these tests assert the numbers, not the shapes: that the cap moves with
 * the setting and clears the heaviest body in the game at the top of it, that a
 * heavy thing measurably lags a light one everywhere, that a throw goes where
 * the crosshair is rather than where the camera ray is, that a frozen bolt does
 * not drift by a millimetre, and that every power moves the arm.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld, Body as RBody, LAYER, box as boxShape } from '../../src/physics/RapierWorld.js';
import { Player, canHarm, HOLD_COST, PERSON_OVER_PROP, STASIS_GRACE } from '../../src/game/Player.js';
import { Enemy, ARCHETYPES } from '../../src/game/Enemy.js';
import { BoltPool } from '../../src/game/Bolts.js';
import { buildJedi } from '../../src/game/Bodies.js';
import { Input } from '../../src/engine/Input.js';
import { POWER_COST } from '../../src/game/Powers.js';
import { defaultBindings } from '../../src/engine/Bindings.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = 180 / Math.PI;

/** The real mass spectrum, straight out of Props.js. */
const PROPS = { crate: 22, barrel: 30, console: 90, vaporator: 180, spire: 500, pillar: 900 };

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater() {}, flush() {},
});

function physicsWorld() {
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  return w;
}

/** A world stub wide enough for a real Enemy and a real Player's Force code. */
function gameWorld(physics) {
  return {
    scene: new THREE.Scene(), physics, terrain: physics.terrain,
    difficulty: null, hpScale: 1, dmgScale: 1,
    settings: { forcePower: 1, forceDrain: 1 },
    engine: { flash() {}, setRadial() {}, setSense() {} },
    particles: null, severs: 0,
    addHitstop() {}, report() {}, notify() {},
    onLimbSevered() { this.severs++; }, onEnemyKilled() {}, onHitmark() {}, spawnDebrisGroup() {},
  };
}

/**
 * A real Player prototype over hand-made state. Constructing a whole Player
 * needs a renderer, an audio graph and a level; the Force code only needs the
 * fifteen fields below, and using the prototype means these tests run the
 * shipping methods rather than a copy of them.
 */
function player(world, over = {}) {
  return Object.assign(Object.create(Player.prototype), {
    world, force: 1e9, maxForce: 1e9, score: 0, limbsRemoved: 0, flow: 0, team: 0,
    gripBody: null, gripEnemy: null, gripDistance: 4, _liftPoint: new THREE.Vector3(),
    lastGripRefusal: null, _wheel: 0, hurled: [], cloak: null,
    gesture: { kind: '', t: 0, env: 0, sustain: false, at: new THREE.Vector3(), hasAt: false },
    stasis: {
      active: false, timer: 0, radius: 0, fireT: 0, target: null, held: [], firing: [],
      bodies: new Set(), centre: new THREE.Vector3(), point: new THREE.Vector3(), vfx: 0,
    },
    chest: V(0, 1.35, 0), aimDir: V(0, 0, -1),
    /* A real Player always has one, and `_readInput` reads it: the controller
     * needs to be told whether the feet are under a lunge, because
     * `Player._attackDrive` now moves the anchor the controller would otherwise
     * infer that from. This bench builds a Player-shaped object by hand, so a
     * field the real constructor always sets has to be set here too. */
    velocity: new THREE.Vector3(),
    camera: { pos: V(0, 1.6, 3), addShake() {}, addYaw() {}, addPitch() {}, firstPerson: false },
    boonMods: { forceCost: 1, flowGain: 1 },
    cooldowns: { push: 0, pull: 0, throw: 0, sense: 0, dash: 0, lightning: 0, stasis: 0, rend: 0 },
    ...over,
  });
}

function prop(w, mass, pos = V(0, 1.35, -6)) {
  const b = new RBody({ position: pos, shape: boxShape(0.4, 0.5, 0.4), mass,
    layer: LAYER.PROP, mask: LAYER.WORLD });
  w.add(b);
  return b;
}

/**
 * A LIVE FIELD — a real RapierWorld, a real Player, real Enemies with their
 * brains running, and a real BoltPool because a ranged brain shoots.
 *
 * Everything else in this file drives the Force over hand-made state, which is
 * right for a claim about arithmetic. The stasis field's claim is not about
 * arithmetic: "freeze what is near you" is a claim about what a WAVE OF PEOPLE
 * does for the next few seconds, and the only way to be wrong about that in a
 * way a player would notice is to be wrong about the brain, the mover and the
 * animator — none of which a Player-shaped literal has. So this half of the
 * suite pays for a real world.
 *
 * Deliberately NOT `World.loadLevel`: HANDOFF 2.6/2.7 — the two suites that
 * build real Worlds are the two that stopped finishing, and nothing measured
 * here is a property of a level.
 */
function liveWorld({ forcePower = 1, force = null } = {}) {
  const physics = physicsWorld();
  const scene = new THREE.Scene();
  const w = {
    scene, physics, terrain: physics.terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower, forceDrain: 1 },
    difficulty: null, hpScale: 1, dmgScale: 1,
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: new BoltPool(scene, 160), time: 0, combatIntensity: 0,
    groundColor: 0xcfae82, severs: 0, notices: [],
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, setSense() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify(t, d) { this.notices.push(`${t} — ${d}`); }, notifyFloating() {},
    addHitstop() {}, onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {},
    onHitmark() {}, onExplosion() {}, spawnDebrisGroup() {}, onPlayerDeath() {},
    /* Force Sense dilates time, and `toggleSense` says so to the world it is
     * in — a fixture that cannot be told is a fixture that cannot light it. */
    setTimeScale() {},
  };
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  p.force = force ?? p.maxForce;
  w.players.push(p);
  const ctx = {
    input: null, terrain: w.terrain, physics, particles: null, bolts: w.bolts,
    camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies,
    players: w.players, pickTarget: () => p,
  };
  return { w, p, ctx, physics, dispose: () => w.bolts.dispose() };
}

/** A living hostile `d` metres away on bearing `a`, already posed once. */
function stand(b, type, d, a = 0) {
  const e = new Enemy(b.w, type, V(Math.sin(a) * d, 0, -Math.cos(a) * d));
  b.w.enemies.push(e);
  e.update(1 / 60, b.ctx);
  return e;
}

/** How far this body is from the player, across the ground. */
const away = (b, e) => Math.hypot(e.position.x - b.p.position.x, e.position.z - b.p.position.z);

/**
 * Where a bone of this body IS, in world space — the only honest way to ask
 * whether the player can SEE that it stopped.
 *
 * A body that has stopped walking has stopped WALKING. It goes on breathing,
 * settling its guard and swinging its cape, and from two metres away that is
 * indistinguishable from a man who paused to aim. So the freeze is measured on
 * a hand, which moves under every one of those and cannot move under a stop.
 */
function bone(e, out = new THREE.Vector3()) {
  const rig = e.rig;
  if (!rig) return out.copy(e.position);
  for (const n of ['handR', 'handL', 'foreR', 'footR', 'chest']) {
    if (rig.get(n)) return rig.worldPos(n, out);
  }
  return out.copy(e.position);
}

/** Run the whole world forward: the field, then every body, then physics. */
function pump(b, frames) {
  const dt = 1 / 60;
  for (let i = 0; i < frames; i++) {
    b.w.time += dt; b.ctx.time = b.w.time;
    b.p._updateStasis(dt, b.ctx);
    for (const e of b.w.enemies) e.update(dt, b.ctx);
    b.w.bolts.update(dt, { blades: [], hitTest: () => null });
    b.physics.step(dt);
  }
}

/** One update, so the rig is solved exactly as it always is in-game. */
function settle(e, world) {
  e.update(1 / 60, {
    time: 0, dt: 1 / 60, players: [], enemies: [e], physics: world.physics,
    terrain: world.terrain, particles: null, bolts: null,
    camera: { position: V(0, 1.6, 3) }, pickTarget: () => null,
  });
}

export async function run({ check, assert, near }) {
  /* Every check in this file is wrapped: the two shared streams are put on
   * their modules' own seeds before each body and the wind clock is put back
   * after it. See tools/checks/_shared.mjs — the rule is there, not here.
   */
  check = await clocked(check);
  await initPhysics();

  /* ── the cap ─────────────────────────────────────────────────────── */

  check('force: the lift cap is a real number and the setting moves it', () => {
    const w = gameWorld(physicsWorld());
    const p = player(w);
    const rungs = [0.25, 0.5, 1, 2, 3, 4];
    const caps = {};
    for (const P of rungs) { w.settings.forcePower = P; caps[P] = p.liftCapacity; }
    // Monotone, and spanning the whole mass table rather than sitting past the
    // end of it — a cap nothing can reach is the same as no cap.
    for (let i = 1; i < rungs.length; i++) {
      assert(caps[rungs[i]] > caps[rungs[i - 1]],
        `cap is not monotone: ${rungs[i - 1]}x=${caps[rungs[i - 1]].toFixed(0)} ${rungs[i]}x=${caps[rungs[i]].toFixed(0)}`);
    }
    assert(caps[0.25] < PROPS.barrel, `0.25x lifts a ${PROPS.barrel} kg barrel (cap ${caps[0.25].toFixed(0)})`);
    assert(caps[1] >= ARCHETYPES.droideka.mass && caps[1] < PROPS.spire,
      `1x cap ${caps[1].toFixed(0)} does not sit between a droideka and a spire`);
    /* THE WHOLE POINT OF THE COMPLAINT, AND ONE WORD OF IT HAS CHANGED:
     * the top of the slider must clear the heaviest LIFTABLE body in the game.
     *
     * This was written when every body on the roster was an animal or a droid
     * and the heaviest was a 1650 kg Reek, and against that roster "the cap
     * clears the heaviest body" is exactly the right invariant — a cap nothing
     * can reach is the same as no cap. Then an AT-TE arrived: 3600 kg and
     * thirteen metres of six-legged siege armour, with an AAT at 2400 behind
     * it. The check failed, and its SUBJECT was what had gone wrong rather than
     * its rule. Raising the cap past 3600 to satisfy the old wording would
     * price every other body in the game at nothing on the way past — a
     * droideka is 210 kg — and it would hand the player a power that deletes
     * the encounter these two exist to be: a heavy you fight AROUND.
     *
     * So the exclusion is authored on the archetype (`grippable: false`, see
     * Vehicles.js) and read by `Player._grippableBody`, and this line asks the
     * narrowed question. Three guards keep the narrowing from becoming a way to
     * dodge the bound, and they are the reason this is not simply a weaker
     * check than the one it replaces:
     *
     *   · every excluded body must be HEAVIER than the top of the slider, so
     *     nothing the cap ought to have cleared can hide behind the flag;
     *   · the exclusion set must be non-empty, or this has quietly gone back to
     *     being the old assert with extra words;
     *   · at least one `big` body must still be liftable, which is the
     *     player's original complaint and the thing that must not regress. */
    const excluded = Object.entries(ARCHETYPES).filter(([, a]) => a.grippable === false);
    const liftable = Object.entries(ARCHETYPES).filter(([, a]) => a.grippable !== false);
    const heaviest = Math.max(...Object.values(PROPS), ...liftable.map(([, a]) => a.mass));
    assert(caps[4] > heaviest,
      `max cap ${caps[4].toFixed(0)} kg cannot lift the heaviest liftable thing there is (${heaviest} kg)`);
    assert(excluded.length > 0,
      'nothing on the roster declares grippable:false, so this is the old unrestricted assert');
    for (const [name, a] of excluded) {
      assert(a.mass > caps[4],
        `${name} is marked ungrippable at ${a.mass} kg, which the 4x cap of ${caps[4].toFixed(0)} kg `
        + 'already clears — an exclusion is not a way to duck the bound');
    }
    assert(liftable.some(([, a]) => a.big),
      'every `big` body is now un-liftable — the size wall the player complained about is back');
    return `0.25x ${caps[0.25].toFixed(0)} kg → 1x ${caps[1].toFixed(0)} → 4x ${caps[4].toFixed(0)}; `
      + `heaviest liftable ${heaviest} kg; not liftable at any setting: `
      + excluded.map(([n, a]) => `${n} ${a.mass} kg`).join(', ');
  });

  check('force: a walker you cannot lift is REFUSED, not ignored', () => {
    /* THE OTHER HALF OF THE CHANGE ABOVE, and the half that is about the
     * player rather than about the roster. Excluding the AT-TE from the lift is
     * only correct if pointing at one and pressing grip produces an ANSWER. Two
     * ways it could have failed silently and both are asserted here:
     *
     *   · dropping it from the pick entirely would let the aim ray pass through
     *     thirteen metres of walker and grip whatever stood behind it;
     *   · returning null would play no sound, print nothing, and read exactly
     *     like a power that is broken.
     *
     * A liftable body in the same cone must still win, or the refusal has
     * bought silence somewhere else. */
    const w = physicsWorld();
    const world = gameWorld(w);
    world.settings.forcePower = 4;
    const said = [];
    world.notify = (title, sub) => said.push(`${title} — ${sub}`);

    const atte = new Enemy(world, 'atte', V(0, 0, -14));
    settle(atte, world);
    w.step(1 / 60);
    const p = player(world);
    const ctx = { physics: w, enemies: [atte], particles: null };
    p.toggleGrip(ctx);
    assert(!p.gripEnemy, 'an AT-TE came off the ground on a Force grip');
    assert(p.lastGripRefusal && p.lastGripRefusal.immovable,
      'the grip returned nothing at all — a silent refusal is indistinguishable from a broken button');
    assert(said.length === 1, `the refusal printed ${said.length} messages`);
    assert(/AT-TE/i.test(said[0]), `the refusal does not name what it refused: ${said[0]}`);
    assert(/leg/i.test(said[0]), `the refusal names no way in: ${said[0]}`);
    // …and it does not claim legs on a body that has none. The AAT is a
    // repulsorlift, built with `legs: 0`.
    const w2 = physicsWorld();
    const world2 = gameWorld(w2);
    world2.settings.forcePower = 4;
    const said2 = [];
    world2.notify = (t, s) => said2.push(`${t} — ${s}`);
    const aat = new Enemy(world2, 'aat', V(0, 0, -14));
    settle(aat, world2);
    w2.step(1 / 60);
    const p2 = player(world2);
    p2.toggleGrip({ physics: w2, enemies: [aat], particles: null });
    assert(!p2.gripEnemy, 'an AAT came off the ground on a Force grip');
    assert(said2.length === 1 && !/leg/i.test(said2[0]),
      `the AAT hovers on repulsorlifts and was told to have its legs cut: ${said2[0]}`);

    // A droid standing in the same cone still wins the pick — the walker must
    // not eat grips that were meant for something else.
    const w3 = physicsWorld();
    const world3 = gameWorld(w3);
    world3.settings.forcePower = 4;
    const big = new Enemy(world3, 'atte', V(2.5, 0, -16));
    const b1 = new Enemy(world3, 'b1', V(-0.6, 0, -7));
    settle(big, world3); settle(b1, world3);
    w3.step(1 / 60);
    const p3 = player(world3);
    p3.toggleGrip({ physics: w3, enemies: [big, b1], particles: null });
    assert(p3.gripEnemy === b1,
      `the AT-TE ate a grip aimed near a B1 (got ${p3.gripEnemy ? p3.gripEnemy.type : 'nothing'})`);

    return `AT-TE refused with "${said[0]}"; AAT refused without claiming legs; a B1 in the same cone still wins`;
  });

  check('force: the biggest enemies are a setting away, not a permanent no', () => {
    const out = [];
    for (const type of ['b1', 'droideka', 'walker', 'beast']) {
      const w = physicsWorld();
      const world = gameWorld(w);
      const e = new Enemy(world, type, V(0, 0, -6));
      settle(e, world);
      w.step(1 / 60);
      const at = [];
      for (const P of [1, 2, 3, 4]) {
        world.settings.forcePower = P;
        const p = player(world);
        p.toggleGrip({ physics: w, enemies: [e], particles: null });
        if (p.gripEnemy) at.push(P);
        p.releaseGrip();
      }
      out.push(`${type}@${at.length ? at[0] + 'x' : 'never'}`);
      // Enemy.grippable is `!A.big && !A.boss`: false for exactly these two, at
      // every forcePower there is. The Force powers must not consult it.
      const A = ARCHETYPES[type];
      if (A.big || A.boss) assert(at.length > 0, `${type} is still un-liftable at every setting`);
      assert(at.includes(4), `${type} cannot be lifted even at forcePower 4`);
    }
    return `first forcePower that lifts it — ${out.join(', ')}`;
  });

  check('force: the grip refuses what it cannot hold, and says why', () => {
    const w = physicsWorld();
    const world = gameWorld(w);
    world.settings.forcePower = 1;
    const b = prop(w, PROPS.pillar);
    w.step(1 / 60);
    const p = player(world);
    const cap1 = p.liftCapacity;
    p.toggleGrip({ physics: w, enemies: [], particles: null });
    assert(!p.gripBody, 'a 900 kg pillar was lifted at forcePower 1');
    assert(p.lastGripRefusal && p.lastGripRefusal.mass === PROPS.pillar,
      'the refusal was silent — nothing recorded why');
    world.settings.forcePower = 4;
    const p2 = player(world);
    p2.toggleGrip({ physics: w, enemies: [], particles: null });
    assert(p2.gripBody === b, 'the same pillar is still refused at forcePower 4');
    return `pillar 900 kg: refused at 1x (cap ${cap1.toFixed(0)}), lifted at 4x (cap ${p2.liftCapacity.toFixed(0)})`;
  });

  /* ── mass is visible ─────────────────────────────────────────────── */

  check('force: a heavy thing measurably lags a light one', () => {
    const peaks = {};
    for (const [name, mass] of Object.entries(PROPS)) {
      const w = physicsWorld();
      const world = gameWorld(w);
      world.settings.forcePower = 4;                  // so everything is liftable
      const b = prop(w, mass, V(0, 1.35, -4));
      b.gravityScale = 0;
      const p = player(world, { gripBody: b });
      p.gripDistance = p.camera.pos.distanceTo(p.chest) + 16;
      let peak = 0;
      for (let i = 0; i < 120; i++) {
        p._updateGrip(1 / 60, { physics: w });
        w.step(1 / 60);
        peak = Math.max(peak, b.velocity.length());
      }
      peaks[name] = peak;
    }
    // Before this the grip wrote velocity with no mass term at all and every
    // one of these was identical to three decimal places.
    assert(peaks.crate > peaks.pillar * 1.4,
      `a 22 kg crate (${peaks.crate.toFixed(1)}) barely outruns a 900 kg pillar (${peaks.pillar.toFixed(1)})`);
    assert(peaks.crate > peaks.console && peaks.console > peaks.spire, 'lift speed is not monotone in mass');
    return `peak lift speed 22 kg ${peaks.crate.toFixed(1)} m/s → 900 kg ${peaks.pillar.toFixed(1)} m/s`;
  });

  check('force: a push shoves a crate further than it shoves a pillar', () => {
    const speeds = {};
    for (const P of [1, 4]) {
      speeds[P] = {};
      for (const [name, mass] of Object.entries(PROPS)) {
        const w = physicsWorld();
        const world = gameWorld(w);
        world.settings.forcePower = P;
        const b = prop(w, mass);
        const p = player(world);
        p.forcePush({ physics: w, enemies: [], particles: null, bolts: null, terrain: null });
        w.step(1 / 60);
        speeds[P][name] = b.velocity.length();
      }
    }
    // Impulse ∝ mass cancels mass exactly, which is why every prop in the game
    // used to take the same 8.6 m/s off a default push.
    assert(speeds[1].crate > speeds[1].pillar * 2.4,
      `crate ${speeds[1].crate.toFixed(1)} vs pillar ${speeds[1].pillar.toFixed(1)} — the push still ignores mass`);
    assert(speeds[4].pillar > speeds[1].pillar * 4,
      `turning the setting up does not move a heavy thing appreciably harder — pillar `
      + `${speeds[1].pillar.toFixed(2)} m/s at 1x against ${speeds[4].pillar.toFixed(2)} at 4x `
      + `(${(speeds[4].pillar / speeds[1].pillar).toFixed(3)}x), crate ${speeds[1].crate.toFixed(2)} → `
      + `${speeds[4].crate.toFixed(2)} (${(speeds[4].crate / speeds[1].crate).toFixed(3)}x)`);
    return `1x: crate ${speeds[1].crate.toFixed(1)} / pillar ${speeds[1].pillar.toFixed(1)} m/s; ` +
      `4x: crate ${speeds[4].crate.toFixed(1)} / pillar ${speeds[4].pillar.toFixed(1)}`;
  });

  /* ── the throw ───────────────────────────────────────────────────── */

  check('force: a throw is aimed at the crosshair, not down the camera ray', () => {
    const w = physicsWorld();
    const world = gameWorld(w);
    const p = player(world);
    // The object is held well off to one side. The old code aimed everything at
    // camera.pos + aim·40, so the launch direction was the line from the OBJECT
    // to that point — several degrees wide, and worse the further out you held
    // it. Here the wall is 20 m away, so the parallax error is large.
    const b = prop(w, PROPS.crate, V(-6, 1.35, -12));
    w.step(1 / 60);
    p.gripBody = b;
    const aim = p._aimTarget({ physics: w, enemies: [] }, new THREE.Vector3());
    p.hurlGripped({ physics: w, enemies: [], particles: null });
    w.step(1 / 60);
    const want = aim.point.clone().sub(b.position).normalize();
    const got = b.velocity.clone().normalize();
    const err = Math.acos(Math.min(1, got.dot(want))) * DEG;
    const legacy = p.camera.pos.clone().addScaledVector(p.aimDir, 40).sub(V(-6, 1.35, -12)).normalize();
    const legacyErr = Math.acos(Math.min(1, legacy.dot(want))) * DEG;
    assert(err < 1.5, `the throw left ${err.toFixed(1)}° off the aim point`);
    return `launch is ${err.toFixed(2)}° off the aim point; the old fixed-40 m target was ${legacyErr.toFixed(1)}° off`;
  });

  check('force: throw speed depends on what you are throwing', () => {
    const out = {};
    for (const P of [1, 4]) {
      out[P] = {};
      for (const [name, mass] of Object.entries(PROPS)) {
        const w = physicsWorld();
        const world = gameWorld(w);
        world.settings.forcePower = P;
        const b = prop(w, mass);
        const p = player(world, { gripBody: b });
        if (mass > p.liftCapacity) continue;
        p.hurlGripped({ physics: w, enemies: [], particles: null });
        w.step(1 / 60);
        out[P][name] = b.velocity.length();
      }
    }
    // Every mass used to leave at exactly 26.0 m/s (104.0 at forcePower 4).
    assert(out[1].crate > out[1].vaporator * 1.6,
      `22 kg leaves at ${out[1].crate.toFixed(1)} and 180 kg at ${out[1].vaporator.toFixed(1)} — mass still cancels`);
    assert(out[4].crate > out[4].pillar * 1.3, 'at max power mass stops mattering again');
    assert(out[4].crate > out[1].crate * 1.8, 'forcePower barely changes throw speed');
    return `1x: 22 kg ${out[1].crate.toFixed(1)} → 180 kg ${out[1].vaporator.toFixed(1)} m/s; ` +
      `4x: 22 kg ${out[4].crate.toFixed(1)} → 900 kg ${out[4].pillar.toFixed(1)}`;
  });

  check('force: a thrown crate actually hurts what it lands on', () => {
    const w = physicsWorld();
    const world = gameWorld(w);
    const e = new Enemy(world, 'b1', V(0, 0, -14));
    settle(e, world);
    const b = prop(w, PROPS.crate, V(0, 1.2, -6));
    const p = player(world, { gripBody: b });
    const hp0 = e.hp;
    p.hurlGripped({ physics: w, enemies: [e], particles: null });
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60);
      p._updateHurled(1 / 60, { enemies: [e], particles: null });
    }
    // RapierWorld stores Body.onContact and never dispatches it, so the
    // userData.hurledBy this code has always set was read by nobody.
    assert(e.hp < hp0 - 5, `the crate passed through the droid (hp ${hp0} → ${e.hp.toFixed(1)})`);
    assert(p.hurled.length === 0 || p.hurled[0].hit.has(e.id), 'the same throw could hit twice');
    return `B1 hp ${hp0} → ${e.hp.toFixed(1)} from one thrown crate`;
  });

  /* ── distance control ────────────────────────────────────────────── */

  check('force: the wheel controls hold distance, in front of the body', () => {
    const rows = [];
    for (const P of [0.25, 1, 4]) {
      const w = physicsWorld();
      const world = gameWorld(w);
      world.settings.forcePower = P;
      const b = prop(w, PROPS.crate);
      const p = player(world, { gripBody: b });
      const lead = p.camera.pos.distanceTo(p.chest);
      // wind all the way in, then count notches back out to the far stop
      for (let i = 0; i < 200; i++) { p._wheel = 1; p._updateGrip(1 / 60, { physics: w }); }
      const near = p.gripDistance - lead;
      let n = 0;
      while (n < 400) {
        p._wheel = -1;
        p._updateGrip(1 / 60, { physics: w });
        if (p.gripDistance - lead >= p.forceReach - 1e-6) break;
        n++;
      }
      const far = p.gripDistance - lead;
      // The hold point is measured from the CAMERA, which in third person is
      // 3.05 m behind the chest: the old floor of 1.6 m from there put the
      // object 1.45 m BEHIND the player.
      assert(near > 0.9, `the near stop is only ${near.toFixed(2)} m in front of the chest`);
      near_far_ok(near, far, p.forceReach, assert);
      assert(n > 8 && n < 60, `${n} notches to cross the reach is unusable`);
      rows.push(`${P}x ${near.toFixed(1)}→${far.toFixed(1)} m in ${n} notches`);
    }
    return rows.join(', ');
  });

  check('force: gripping takes the wheel away from the attack rose', () => {
    // Was 'takes the wheel away from the wrist roll'. The wrist roll no longer
    // reads the wheel at all: it was the last raw device read in the blade, and
    // the collision this check exists to pin is the reason it had to go. The
    // wheel is now `attackOver` / `attackStab`, ordinary rows in ACTIONS — so
    // the property is the same and stronger, because it can be measured through
    // the REAL Input and the REAL bindings rather than through a stub that says
    // it reads the field.
    //
    // The mechanism is unchanged and still Player's: _readInput claims
    // input.mouse.wheel while something is held and hands it straight back
    // otherwise, and Input._codeDown reads that same field — so a notch spent
    // on hold distance cannot ALSO swing the blade.
    const w = physicsWorld();
    const world = gameWorld(w);
    const p = player(world);
    const canvas = { addEventListener() {}, removeEventListener() {} };
    const real = new Input(canvas);
    real.setBindings(defaultBindings());
    const input = Object.assign(real, { moveAxis: (o) => o });
    p.saberThrown = false;
    p.isLocal = true;
    p.saber = { lit: true, toggle() {}, base: V(0, 0, 0) };
    p.control = { applyInput: () => ({ yaw: 0, pitch: 0 }), grip: 'two' };
    p.stamina = 100; p.maxStamina = 100;

    input.mouse.wheel = 3;
    p._readInput(1 / 60, { input });
    assert(input.mouse.wheel === 3, 'the wheel was stolen from the blade while nothing was held');
    assert(p._wheel === 0, 'the grip took a wheel it has no use for');
    assert(input.actHit('attackStab'),
      'a wheel notch with nothing held did not reach the attack it is bound to');

    p.gripBody = prop(w, PROPS.crate);
    input.mouse.wheel = 3;
    p._readInput(1 / 60, { input });
    assert(p._wheel === 3, 'the grip did not receive the wheel');
    assert(input.mouse.wheel === 0, 'the blade will attack on the same notch that moved the object');
    assert(!input.actHit('attackStab') && !input.actHit('attackOver'),
      'one notch both pushed the held object away AND swung the blade');
    real.dispose();
    return 'wheel goes to the attack rose when free, to the grip when holding — never to both';
  });

  /* ── gestures ────────────────────────────────────────────────────── */

  check('force: every power sends the hand somewhere', () => {
    const world = gameWorld(physicsWorld());
    const p = player(world);
    const chest = V(0, 1.35, 0), fwd = V(0, 0, -1), right = V(1, 0, 0);
    const rest = () => V(-0.34, 0.73, -0.05);
    const rows = [];
    const kinds = ['push', 'pull', 'grip', 'hurl', 'stasis', 'unleash', 'rend', 'lightning', 'sense', 'cast'];
    for (const kind of kinds) {
      p.gesture = { kind: '', t: 0, env: 0, sustain: false, at: new THREE.Vector3(), hasAt: false };
      p._gesture(kind);
      assert(p.gesture.kind === kind, `${kind} did not start a gesture`);
      let peak = 0, peakT = 0, alive = 0;
      for (let i = 0; i < 180; i++) {
        p._advanceGesture(1 / 60);
        const target = rest(), pole = V(-0.85, 0.65, 0);
        const palm = p._gesturePose(target, pole, chest, fwd, right);
        if (palm) near(palm.length(), 1, 1e-6, `${kind} returned a non-unit palm direction`);
        const travel = target.distanceTo(rest());
        assert(isFinite(travel), `${kind} produced a non-finite hand position`);
        if (travel > peak) { peak = travel; peakT = (i + 1) / 60; }
        if (p.gesture.kind) alive++;
        if (p.gesture.sustain && i === 40) p._endGesture(kind);
      }
      // Readable means readable from across the room: an arm that moves 10 cm
      // is not an animation, it is a twitch.
      assert(peak > 0.5, `${kind} sends the hand only ${(peak * 100).toFixed(0)} cm`);
      // Snap, not wave: the reach has to be over well inside the gesture.
      assert(peakT < 0.30, `${kind} takes ${(peakT * 1000).toFixed(0)} ms to reach full extension`);
      assert(p.gesture.kind === '', `${kind} never let go of the arm`);
      rows.push(`${kind} ${(peak * 100).toFixed(0)}cm@${(peakT * 1000).toFixed(0)}ms`);
    }
    return rows.join(' ');
  });

  check('force: the powers actually fire their gestures', () => {
    const seen = {};
    const mk = () => {
      const w = physicsWorld();
      const world = gameWorld(w);
      const p = player(world);
      return { w, world, p };
    };
    {
      const { w, p } = mk();
      p.forcePush({ physics: w, enemies: [], particles: null, bolts: null, terrain: null });
      seen.push = p.gesture.kind;
    }
    {
      const { w, p } = mk();
      p.forcePull({ physics: w, enemies: [], particles: null });
      seen.pull = p.gesture.kind;
    }
    {
      const { w, p } = mk();
      prop(w, PROPS.crate); w.step(1 / 60);
      p.toggleGrip({ physics: w, enemies: [], particles: null });
      seen.grip = p.gesture.kind;
      p.hurlGripped({ physics: w, enemies: [], particles: null });
      seen.hurl = p.gesture.kind;
    }
    {
      const { w, p } = mk();
      p.boonMods.lightning = true;
      p.force = 1e9;
      p.forceLightning({ physics: w, enemies: [], particles: null });
      seen.lightning = p.gesture.kind;
    }
    for (const [k, v] of Object.entries(seen)) assert(v === k, `${k} fired gesture "${v}"`);
    return Object.entries(seen).map(([k, v]) => `${k}→${v}`).join(' ');
  });

  /* ── force stop ──────────────────────────────────────────────────── */

  check('force: stasis freezes hostile bolts dead, and only hostile ones', () => {
    const scene = new THREE.Scene();
    const w = physicsWorld();
    const world = gameWorld(w);
    const pool = new BoltPool(scene, 40);
    const p = player(world);
    const ctx = { physics: w, bolts: pool, enemies: [], particles: null };
    for (let i = 0; i < 8; i++) {
      pool.fire(V(i * 0.3 - 1, 1.4, -4 - i * 0.3), V(0, 0, 1), { speed: 80, team: 1, damage: 9 });
    }
    const mine = pool.fire(V(0, 1.4, -3), V(0, 0, -1), { speed: 80, team: 0, damage: 9 });
    const far = pool.fire(V(0, 1.4, -60), V(0, 0, 1), { speed: 80, team: 1, damage: 9 });
    const took = p.toggleStasis(ctx);
    assert(took === 8, `stasis took ${took} bolts, expected the 8 hostile ones in range`);
    assert(!mine.held, 'stasis froze the player’s own returned fire');
    assert(!far.held, `stasis reached a bolt ${(60 - p.stasis.radius).toFixed(0)} m outside its own radius`);

    const frozen = pool.bolts.filter(b => b.held);
    const at = frozen.map(b => b.pos.clone());
    const life0 = frozen.map(b => b.life);
    for (let i = 0; i < 60; i++) {
      pool.update(1 / 60, { blades: [], hitTest: () => null });
      p._updateStasis(1 / 60, ctx);
    }
    const drift = Math.max(...frozen.map((b, i) => b.pos.distanceTo(at[i])));
    const aged = Math.max(...frozen.map((b, i) => life0[i] - b.life));
    assert(drift < 1e-6, `a frozen bolt drifted ${drift.toFixed(4)} m in a second`);
    assert(aged < 1e-9, 'a frozen bolt aged out while it was being held');
    assert(frozen.every(b => b.held), 'the field dropped a bolt it was holding');
    pool.dispose();
    return `8 of 8 hostile bolts arrested in a ${p.stasis.radius.toFixed(1)} m field, 0.0000 m drift over 1 s, no ageing`;
  });

  check('force: released bolts fly at whoever you picked, and can hurt them', () => {
    const scene = new THREE.Scene();
    const w = physicsWorld();
    const world = gameWorld(w);
    const pool = new BoltPool(scene, 40);
    const e = new Enemy(world, 'b1', V(4, 0, -12));
    settle(e, world);
    const p = player(world);
    const ctx = { physics: w, bolts: pool, enemies: [e], particles: null };
    for (let i = 0; i < 6; i++) pool.fire(V(i * 0.4 - 1, 1.4, -4), V(0, 0, 1), { speed: 80, team: 1, damage: 9 });
    p.toggleStasis(ctx);
    // Look at the droid, then let go. The bolts came in from straight ahead;
    // the droid is 18° off to the right, so a volley that merely resumed its
    // old course would fail this.
    p.aimDir.copy(p._enemyPoint(e, new THREE.Vector3()).sub(p.camera.pos).normalize());
    p.releaseStasis(ctx, true);
    for (let i = 0; i < 60; i++) p._updateStasis(1 / 60, ctx);
    const sent = pool.bolts.filter(b => b.active && !b.held && b.team === 0);
    assert(sent.length === 6, `${sent.length} of 6 bolts were sent back`);
    const target = p._enemyPoint(e, new THREE.Vector3());
    let worst = 0;
    for (const b of sent) {
      const want = target.clone().sub(b.pos).normalize();
      worst = Math.max(worst, Math.acos(Math.min(1, b.vel.clone().normalize().dot(want))) * DEG);
      // World._boltHitTest only lets a team-1 bolt touch an enemy when it was
      // deflected, and only lets a bolt touch the player when it is not team 0.
      // Both flags, or a returned volley passes straight through everybody.
      assert(b.deflected && b.deflector === p && b.owner === p, 'the returned bolt is not the player’s');
      assert(b.damage > 9, 'the returned bolt lost its damage');
      assert(b.vel.length() > 50, `a returned bolt left at ${b.vel.length().toFixed(0)} m/s`);
    }
    assert(worst < 1, `worst return was ${worst.toFixed(1)}° off the target`);
    pool.dispose();
    return `6 bolts returned to a droid 18° off the incoming line, worst error ${worst.toFixed(2)}°`;
  });

  check('force: a dropped stasis field does not fire a free volley', () => {
    const scene = new THREE.Scene();
    const w = physicsWorld();
    const world = gameWorld(w);
    const pool = new BoltPool(scene, 20);
    const p = player(world);
    const ctx = { physics: w, bolts: pool, enemies: [], particles: null };
    for (let i = 0; i < 4; i++) pool.fire(V(i * 0.4 - 1, 1.4, -4), V(0, 0, 1), { speed: 80, team: 1 });
    p.toggleStasis(ctx);
    p.releaseStasis(ctx, false);
    for (let i = 0; i < 20; i++) p._updateStasis(1 / 60, ctx);
    const live = pool.bolts.filter(b => b.active);
    assert(live.length === 0, `${live.length} bolts survived a dropped field`);
    assert(p.stasis.held.length === 0 && p.stasis.firing.length === 0, 'the field kept its bookkeeping');
    pool.dispose();
    return 'running the bar dry drops the bolts; only a deliberate release fires them';
  });

  /* ── force stop: the people ──────────────────────────────────────── */

  /**
   * THE CHECKS BELOW ARE THE ONES THAT WOULD HAVE CAUGHT IT.
   *
   * Every stasis check above this line is about bolts and crates, and every one
   * of them passed for the whole life of the defect: the Codex card said
   * "freeze what is near you, bolts included" — an ADDITION to a broader set,
   * and what is near you in a fight is people — while `_stasisCapture` walked
   * `physics.bodies` filtered to PROP|DEBRIS|RAGDOLL with `v² ≥ 4`. A living
   * enemy is none of those and its proxy is kinematic besides, so the marquee
   * time-stop was a bolt freezer with a crate-catcher attached.
   *
   * Measured on the tree before the fix, five living bodies standing 3.0-8.5 m
   * inside a 9.0 m field: `toggleStasis` took **0**, and over the next two
   * seconds of held field the acolyte closed **5.77 m** to melee range while
   * the three shooters walked 2.0-2.7 m each to their stand-off. So these
   * assert on BEHAVIOUR — how many were arrested, how far they got, what
   * happened when it ended — and not on the source text, which read perfectly.
   */

  check('force: a stasis field arrests the PEOPLE inside it, not only the bolts', () => {
    const b = liveWorld();
    // A firefight's worth, spread around the player and across the radius: two
    // droids close, a trooper and an acolyte at the edge, a B2 at 8.5 of 9.0.
    const near = [['b1', 3.0], ['b1', 4.5], ['trooper', 6.0], ['acolyte', 7.5], ['b2', 8.5]]
      .map(([t, d], i) => stand(b, t, d, (i / 5) * Math.PI * 2));
    // …and one outside it, because a field that takes everything on the map is
    // not a field. 14 m against a 9 m radius.
    const out = stand(b, 'trooper', 14);

    const took = b.p.toggleStasis(b.ctx);
    const held = b.p.stasis.held.filter(h => h.enemy).length;
    assert(b.p.stasis.radius > 8.9 && b.p.stasis.radius < 9.1,
      `the field is ${b.p.stasis.radius.toFixed(2)} m, so these distances measure nothing`);
    assert(held === near.length,
      `${held} of ${near.length} living bodies inside a ${b.p.stasis.radius.toFixed(1)} m field were arrested`);
    assert(took === near.length, `toggleStasis reported ${took} taken, not ${near.length}`);
    for (const e of near) {
      assert(e.stasisHeld, `${e.A.label} at ${away(b, e).toFixed(1)} m is inside the field and free`);
      // The arrest is a stun and nothing else — every reader of "can this act"
      // already reads it, so this is the whole of "it cannot act".
      assert(e.stunTimer > 0, `${e.A.label} is marked held with no arrest behind it`);
    }
    assert(!out.stasisHeld, `the field reached a body ${(away(b, out) - b.p.stasis.radius).toFixed(1)} m outside itself`);
    b.dispose();
    return `${held} of ${near.length} living bodies arrested in a ${b.p.stasis.radius.toFixed(1)} m field `
      + `(${near.map(e => away(b, e).toFixed(1)).join('/')} m); the one at ${away(b, out).toFixed(1)} m untouched`;
  });

  check('force: a held body does not advance, and it does not go on moving either', () => {
    const b = liveWorld();
    // Caught WALKING. They are given half a second first, so a frozen hand is
    // frozen mid-stride rather than frozen in an idle that was not going
    // anywhere — a stopped body and a body that never moved look identical.
    const near = [['acolyte', 8.4], ['trooper', 8.0], ['b1', 7.6]]
      .map(([t, d], i) => stand(b, t, d, (i - 1) * 0.5));
    const free = stand(b, 'acolyte', 24);      // the control, well outside
    pump(b, 30);
    const freeFrom = away(b, free);

    b.p.toggleStasis(b.ctx);
    assert(near.every(e => e.stasisHeld), 'setup: the field did not take the walkers');
    const hand0 = near.map(e => bone(e));
    const at0 = near.map(e => away(b, e));
    const freeHand0 = bone(free);
    pump(b, 120);      // two seconds of held field

    /* Measured on the fixed tree, three bodies caught mid-stride against one
     * control at 24 m: held 0.0000 m travelled and 0.00 mm of hand over 120
     * frames, free 9.30 m closed and 9340 mm of hand. Two decimal places of
     * separation, so these bars are not fine margins. */
    const drift = Math.max(...near.map((e, i) => Math.abs(away(b, e) - at0[i])));
    const twitch = Math.max(...near.map((e, i) => bone(e).distanceTo(hand0[i])));
    const freeClosed = freeFrom - away(b, free);
    const freeTwitch = bone(free).distanceTo(freeHand0);
    // A metre-per-second body over two seconds; a millimetre is nothing.
    assert(drift < 0.01, `a held body moved ${drift.toFixed(3)} m in two seconds`);
    assert(twitch < 0.001, `a held body's hand moved ${(twitch * 1000).toFixed(1)} mm — it is standing still, not stopped`);
    // …and the world was not simply inert, which is the way this check could
    // pass while being worthless.
    assert(freeClosed > 0.5, `the control body only closed ${freeClosed.toFixed(2)} m, so nothing here was moving anyway`);
    assert(freeTwitch > 0.01, `the control body's hand moved ${(freeTwitch * 1000).toFixed(1)} mm, so a frozen hand proves nothing`);
    b.dispose();
    return `held: ${drift.toFixed(4)} m travelled, hand ${(twitch * 1000).toFixed(2)} mm, over 120 frames · `
      + `free: ${freeClosed.toFixed(2)} m closed, hand ${(freeTwitch * 1000).toFixed(0)} mm`;
  });

  check('force: running the bar dry DROPS the bodies and does not throw them', () => {
    // The two failures are deliberately different — see `_updateStasis`. This is
    // the one that costs you: the men land where they stood and walk again.
    const b = liveWorld({ force: 40 });
    const near = [['b1', 4], ['trooper', 6], ['acolyte', 7]].map(([t, d], i) => stand(b, t, d, (i - 1) * 0.7));
    b.p.toggleStasis(b.ctx);
    assert(near.every(e => e.stasisHeld), 'setup: nobody was caught');
    const at0 = near.map(e => away(b, e));
    /* AND ONE OF THEM IS CUT DOWN WHILE IT HANGS THERE, which is the whole
     * point of holding somebody: a held body's guard is open, so the blade
     * lands. `topple()` answers with `stun(9999)` and `_getUp` is the only
     * thing allowed to end it — so the field letting go must not stand it back
     * up. That is why the hold is laid with `Math.max` and why releasing it
     * clears the MARK and never the arrest. */
    const felled = near[0];
    felled.topple();
    // Twelve frames, because the parts have to be MOVING before the sweep that
    // takes loose things will look at them — `v² >= 4` is 2 m/s and a fifth of
    // a second of gravity is what buys it. Measured: 0 parts at 2 frames, 10 at
    // 10, which is the number of bones the rig comes apart into.
    pump(b, 12);
    /* …and ONE MAN IS BILLED ONCE. A toppled body turns into ten LAYER.RAGDOLL
     * bodies, every one in flight and every one taken by that same sweep —
     * which is the right picture. Holding the man as well would be the same
     * subject on the books twice. */
    assert(!b.p.stasis.held.some(h => h.enemy === felled),
      'a body that came apart in the field is held as a person AND in pieces — one subject, two bills');
    assert(b.p.stasis.held.some(h => h.body), 'the parts of a body that came apart were not caught at all');

    // Measured: the cast leaves 14 of the 40, three men cost 5 + 0.9x3x(11/7) =
    // 9.24/s and the ten bones of the toppled one take it to about 17, so the
    // bar is gone in 54 frames. The bodies land within 0.00 m of where they
    // stood and have closed 1.99 m half a second later — which is the whole
    // difference between a drop and a fire.
    let frames = 0;
    while (b.p.stasis.active && frames < 600) { pump(b, 1); frames++; }
    assert(!b.p.stasis.active, 'the field never ran out of Force');
    assert(b.p.stasis.held.length === 0 && b.p.stasis.firing.length === 0,
      `the dropped field kept ${b.p.stasis.held.length} held and ${b.p.stasis.firing.length} firing`);
    for (const e of near) assert(!e.stasisHeld, `${e.A.label} is still marked held by a field that dropped`);
    // Dropped, not fired: nothing left the ground and nothing was made a
    // projectile that could hurt what it lands on.
    assert(b.p.hurled.length === 0, `a dropped field threw ${b.p.hurled.length} bodies`);
    const flung = Math.max(...near.map((e, i) => Math.abs(away(b, e) - at0[i])));
    assert(flung < 0.6, `a dropped body travelled ${flung.toFixed(2)} m — that is a throw, not a release`);
    // And they are FREE, which is the half a mark left behind would hide: the
    // grace window is the longest a released body may stay arrested.
    pump(b, Math.ceil(STASIS_GRACE * 60) + 30);
    const closed = Math.max(...near.map((e, i) => at0[i] - away(b, e)));
    assert(closed > 0.15, `released bodies closed only ${closed.toFixed(2)} m in half a second — they are still frozen`);
    assert(felled.toppled && felled.stunTimer > 100,
      `the field let go and stood a toppled body back up (toppled ${felled.toppled}, stun ${felled.stunTimer.toFixed(1)})`);
    b.dispose();
    return `field dropped after ${frames} frames at ${b.p.force.toFixed(1)} Force; 3 bodies released within `
      + `${flung.toFixed(2)} m of where they stood and closed ${closed.toFixed(2)} m once free`;
  });

  check('force: firing the field THROWS the people it was holding', () => {
    const b = liveWorld();
    const near = [['b1', 4], ['trooper', 5.5], ['b1', 7]].map(([t, d], i) => stand(b, t, d, (i - 1) * 0.6));
    b.p.toggleStasis(b.ctx);
    assert(near.every(e => e.stasisHeld), 'setup: nobody was caught');
    const at0 = near.map(e => away(b, e));
    b.p.releaseStasis(b.ctx, true);
    assert(b.p.stasis.firing.length === near.length,
      `${b.p.stasis.firing.length} of ${near.length} bodies made it into the volley`);
    // The ripple is 28 ms a body — twenty things leaving on one frame is a
    // single white flash. Long enough to flush all three.
    pump(b, 60);
    assert(b.p.stasis.firing.length === 0, 'the volley never flushed');
    for (const e of near) assert(!e.stasisHeld, `${e.A.label} left the field still marked as held`);
    // A thrown body is a PROJECTILE, through the grip's own thrower — note #9.
    assert(b.p.hurled.length === near.length,
      `${b.p.hurled.length} of ${near.length} thrown bodies can hurt what they hit`);
    // Measured: the least-travelled of the three goes 23.29 m in one second, so
    // 0.8 m is not a margin, it is the difference between thrown and dropped.
    const moved = Math.min(...near.map((e, i) => Math.abs(away(b, e) - at0[i])));
    assert(moved > 0.8, `the least-moved body travelled ${moved.toFixed(2)} m — it was released, not thrown`);
    b.dispose();
    return `3 of 3 held bodies went into the volley and left it as tracked projectiles, `
      + `least travel ${moved.toFixed(2)} m`;
  });

  check('force: the field refuses what the grip refuses, and says so out loud', () => {
    // Same two gates, same order, same cap as `toggleGrip` — an author's
    // outright `grippable: false` first, then the mass the slider moves. A
    // field stricter or looser than the grip is a second rulebook.
    const b = liveWorld();
    const heavy = stand(b, 'walker', 6);              // 900 kg against a 220 kg cap
    const light = stand(b, 'b1', 5);
    b.p.toggleStasis(b.ctx);
    assert(!heavy.stasisHeld, `a ${heavy.A.mass} kg walker froze against a ${Math.round(b.p.liftCapacity)} kg cap`);
    assert(light.stasisHeld, 'the field took nothing at all, so the refusal proves nothing');
    assert(b.w.notices.length === 1, `the refusal spoke ${b.w.notices.length} times, not once`);
    assert(/kg/.test(b.w.notices[0]) && /Force Power/i.test(b.w.notices[0]),
      `the refusal does not carry the numbers or the slider: ${b.w.notices[0]}`);
    const heavySaid = b.w.notices[0];

    /* …and the body no setting will ever move gets the counter-play instead of
     * a number, because there is no number that would help. The subject is READ
     * OFF THE ROSTER rather than named here — `grippable: false` is authored in
     * Vehicles.js and the day a third body declares it, this tests that one
     * too. Driven at the TOP of the slider, so the refusal cannot be the mass
     * gate wearing the other message. */
    const [immovableKey] = Object.entries(ARCHETYPES).find(([, a]) => a.grippable === false) || [];
    assert(immovableKey, 'nothing on the roster declares grippable:false, so this half tests nothing');
    const c = liveWorld({ forcePower: 4 });
    const terrain = stand(c, immovableKey, 6);
    const other = stand(c, 'b1', 5);
    c.p.toggleStasis(c.ctx);
    assert(!terrain.stasisHeld, 'a body its author marked ungrippable was frozen anyway');
    assert(other.stasisHeld, 'setup: the second field took nothing');
    assert(c.w.notices.length === 1 && !/raise Force Power/i.test(c.w.notices[0]),
      `an immovable body was refused with a number the player cannot act on: ${c.w.notices[0]}`);
    assert(/legs|armour/i.test(c.w.notices[0]), `the refusal names no way in: ${c.w.notices[0]}`);
    b.dispose(); c.dispose();
    return `too heavy → "${heavySaid}" · ungrippable → "${c.w.notices[0]}"`;
  });

  check('force: who the field may freeze is the fight’s rule, asked once', () => {
    /* SYMMETRY, and it is decided by `canHarm` rather than here.
     *
     * Command's allies are `Enemy` instances with `team` set to the party's
     * (Command.js:1650), so a sweep over `ctx.enemies` meets them. Player note
     * #29 draws the line in two clauses about two different subjects:
     *
     *   "your allies should be as real as the enemies like no difference — you
     *    can do damage to them and throw them and manipulate them so you need
     *    to be careful not to hurt them … but like obviously the force
     *    blaster-stop thing shouldn't affect your allies' blasters."
     *
     * Their SHOTS are exempt and their BODIES are not, so the field reaches
     * exactly what push, pull, grip, lightning, compel and rend reach — which
     * is `ctx.rules`, the field World hands the powers. What this check pins is
     * not the answer but WHERE IT COMES FROM: run the same two bodies under
     * co-op's rules and under the friendly-fire rules Command gives the powers,
     * and the field's answer must equal `canHarm`'s, body for body, both times.
     * A hand-written `e.team === this.team` passes the first half of that and
     * fails the second, which is the whole reason `pvp.mjs` forbids it.
     */
    const seen = {};
    for (const [label, rules] of [['co-op', null], ['powers', { pvp: false, friendlyFire: true }]]) {
      const b = liveWorld();
      if (rules) b.ctx.rules = rules;
      const mine = stand(b, 'trooper', 4, -0.6);
      mine.team = b.p.team;                  // world.partyTeam, as installCommand sets it
      const theirs = stand(b, 'b1', 4, 0.6);
      b.p.toggleStasis(b.ctx);
      for (const [who, e] of [['ally', mine], ['hostile', theirs]]) {
        const may = canHarm(b.p, e, rules);
        assert(!!e.stasisHeld === may,
          `under ${label} rules canHarm says ${may} about the ${who} and the field did ${!!e.stasisHeld}`);
      }
      seen[label] = { ally: !!mine.stasisHeld, hostile: !!theirs.stasisHeld };
      b.dispose();
    }
    // …and the two rule sets must actually DISAGREE about the ally, or the
    // check above is satisfied by a field that never asked anybody anything.
    assert(seen['co-op'].ally === false && seen.powers.ally === true,
      `the two rule sets gave the same answer about an ally (${seen['co-op'].ally}/${seen.powers.ally}), `
      + 'so nothing here proves the rule was consulted');
    assert(seen['co-op'].hostile && seen.powers.hostile, 'the field froze no hostile under one of the rule sets');
    return 'ally frozen: no under co-op, yes under the rules Command hands the powers; hostile frozen under both '
      + '— the same answers canHarm gives';
  });

  check('force: the field lets go of a body that dies, is gripped, or outlives its holder', () => {
    const b = liveWorld();
    const dies = stand(b, 'b1', 4, -0.8);
    const taken = stand(b, 'b1', 5, 0);
    const rest = stand(b, 'trooper', 6, 0.8);
    b.p.toggleStasis(b.ctx);
    assert([dies, taken, rest].every(e => e.stasisHeld), 'setup: not everyone was caught');
    const n0 = b.p.stasis.held.length;

    // 1. it dies in the field — the common one, because a held body's guard is
    //    open and the blade is the whole reason you held it.
    dies.dead = true;
    pump(b, 2);
    assert(!b.p.stasis.held.some(h => h.enemy === dies), 'the field is still holding — and billing for — a corpse');

    // 2. the grip takes it. One arrest, one bill, and the grip is the hold that
    //    can also walk it about.
    b.p.gripEnemy = taken; taken.gripped = true;
    pump(b, 2);
    assert(!taken.stasisHeld, 'a gripped body is still marked as held by the field');
    assert(!b.p.stasis.held.some(h => h.enemy === taken), 'the field and the grip are both holding one body');
    assert(b.p.stasis.held.length === n0 - 2, `the field holds ${b.p.stasis.held.length} of an expected ${n0 - 2}`);
    b.p.gripEnemy = null; taken.gripped = false;

    // 3. the holder dies. A corpse is not holding a stasis field, and a body
    //    left marked would stand there for the rest of the level.
    assert(rest.stasisHeld, 'setup: nothing survived to test the death path');
    b.p.die(null);
    assert(!rest.stasisHeld, 'a held body outlived the player that was holding it');
    assert(b.p.stasis.held.length === 0 && b.p.stasis.firing.length === 0,
      'a dead player still has a field on the books');
    b.dispose();
    return 'a corpse, a body the grip took and a body whose holder died are all off the field within two frames';
  });

  check('force: a level change lets go of everyone the field was holding', () => {
    const b = liveWorld();
    const held = [4, 5.5, 7].map((d, i) => stand(b, 'b1', d, (i - 1) * 0.6));
    b.p.toggleStasis(b.ctx);
    assert(held.every(e => e.stasisHeld), 'setup: nobody was caught');
    // Mid-volley is the harder half: `releaseStasis` owns `held` and nothing
    // else owns `firing`, and `_updateForce` stops the moment the player is gone.
    b.p.releaseStasis(b.ctx, true);
    assert(b.p.stasis.firing.length === held.length, 'setup: the volley did not form');
    b.p.dispose();
    for (const e of held) assert(!e.stasisHeld, 'a body was left frozen by a torn-down level');
    assert(b.p.stasis.firing.length === 0, 'the volley outlived the world it was thrown in');
    b.dispose();
    return '3 bodies mid-volley, all released by dispose(); nothing left marked and nothing left in flight';
  });

  check('force: a person costs more to hold than a bolt, at the grip’s own ratio', () => {
    /* THE PRICE, AND IT IS NOT CHOSEN HERE EITHER. `_updateGrip` is the only
     * place in the game that prices a living body against an object for the
     * same act — 11 against 7 per second — and the field reads that ratio
     * rather than carrying a number of its own. So this check asks the module
     * what the ratio IS and measures whether the field charges it, instead of
     * typing 1.571 into an assertion and drifting from the grip in silence. */
    const dt = 1 / 60;
    const drain = (b) => { const f = b.p.force; b.p._updateStasis(dt, b.ctx); return (f - b.p.force) / dt; };

    // Nothing in range: the field's own standing cost.
    const empty = liveWorld();
    stand(empty, 'b1', 30);
    empty.p.toggleStasis(empty.ctx);
    const base = drain(empty);

    // The same field, four hostile bolts inside it.
    const shots = liveWorld();
    shots.p.toggleStasis(shots.ctx);
    for (let i = 0; i < 4; i++) {
      shots.w.bolts.fire(V(i * 0.3 - 1, 1.4, -4), V(0, 0, 1), { speed: 80, team: 1, damage: 9 });
    }
    const withBolts = drain(shots);

    // The same field, four hostile bodies inside it.
    const men = liveWorld();
    const four = [3, 4.5, 6, 7.5].map((d, i) => stand(men, 'b1', d, (i - 1.5) * 0.5));
    men.p.toggleStasis(men.ctx);
    assert(four.every(e => e.stasisHeld), 'setup: the four bodies were not all caught');
    const withMen = drain(men);

    // Measured: 5.00 Force/s standing, +0.90 a bolt, +1.41 a body — 1.571x,
    // which is HOLD_COST's 11/7 and nothing typed into this file.
    const perBolt = (withBolts - base) / 4;
    const perMan = (withMen - base) / 4;
    assert(perBolt > 0 && perMan > 0, `the field charges nothing for what it holds (${perBolt}, ${perMan})`);
    near(perMan / perBolt, PERSON_OVER_PROP, 1e-9,
      `a person costs ${(perMan / perBolt).toFixed(3)} bolts against the grip's own`);
    near(PERSON_OVER_PROP, HOLD_COST.person.base / HOLD_COST.prop.base, 1e-12, 'the ratio drifted from HOLD_COST');
    empty.dispose(); shots.dispose(); men.dispose();
    return `${base.toFixed(2)} Force/s standing, +${perBolt.toFixed(2)} a bolt, +${perMan.toFixed(2)} a body `
      + `— ${(perMan / perBolt).toFixed(3)}x, which is HOLD_COST's ${HOLD_COST.person.base}/${HOLD_COST.prop.base}`;
  });

  /* ── disassembly ─────────────────────────────────────────────────── */

  check('force: a droid comes apart, and how far scales with the setting', () => {
    const rows = [];
    for (const type of ['b1', 'walker', 'droideka']) {
      const counts = [];
      for (const P of [0.25, 1, 2, 4]) {
        const w = physicsWorld();
        const world = gameWorld(w);
        world.settings.forcePower = P;
        const e = new Enemy(world, type, V(0, 0, -6));
        settle(e, world);
        const p = player(world);
        p.forceDisassemble({ enemies: [e], particles: null, physics: w });
        counts.push(p.limbsRemoved);
        // A rig enemy routes every joint through Actor + world.onLimbSevered.
        // A droideka has no rig — Enemy._cutDroideka takes its legs off without
        // an actor and without reporting, which is that file's business.
        if (e.rig) assert(world.severs === p.limbsRemoved, 'a joint came off without telling the world');
        else assert(world.severs === 0 && p.limbsRemoved > 0, 'the droideka path changed shape');
      }
      assert(counts[0] >= 1, `${type} lost nothing at all at forcePower 0.25`);
      assert(counts[3] > counts[0], `${type} comes apart no further at 4x than at 0.25x`);
      rows.push(`${type} ${counts.join('/')}`);
    }
    return `joints taken at 0.25/1/2/4x — ${rows.join(', ')}`;
  });

  check('force: disassembly makes real pieces, through the real sever path', () => {
    const w = physicsWorld();
    const world = gameWorld(w);
    world.settings.forcePower = 4;
    const e = new Enemy(world, 'b1', V(0, 0, -6));
    settle(e, world);
    const p = player(world);
    const got = [];
    e.actor.onSever = (bone) => got.push(bone);
    p.forceDisassemble({ enemies: [e], particles: null, physics: w });
    let bodies = 0;
    for (const piece of e.actor.pieces) bodies += piece.entries.length;
    assert(e.actor.pieces.length >= 2, `only ${e.actor.pieces.length} pieces detached`);
    assert(bodies >= e.actor.pieces.length, 'a detached piece is not a physics body');
    // Extremities first. A disassembly that opens on the chest is an execution.
    assert(!got.includes('chest') && !got.includes('hips'), `it went for the core first: ${got.join(',')}`);
    return `${p.limbsRemoved} joints, ${e.actor.pieces.length} detached pieces made of ${bodies} rigid bodies (${got.join(', ')})`;
  });

  check('force: flesh does not disassemble', () => {
    for (const type of ['trooper', 'acolyte', 'beast']) {
      const w = physicsWorld();
      const world = gameWorld(w);
      world.settings.forcePower = 4;
      const e = new Enemy(world, type, V(0, 0, -5));
      settle(e, world);
      const p = player(world);
      const f0 = p.force;
      p.forceDisassemble({ enemies: [e], particles: null, physics: w });
      assert(p.limbsRemoved === 0, `a ${type} came apart at the joints`);
      assert(p.force === f0, `the power charged ${(f0 - p.force).toFixed(0)} Force for doing nothing`);
      assert(p.cooldowns.rend === 0, 'a no-op still went on cooldown');
    }
    return 'troopers, acolytes and the Acklay are cut, not dismantled — and a miss costs nothing';
  });

  /* ── what is grippable at all ────────────────────────────────────── */

  check('force: the grip sees every loose thing, and enemies in the same pass', () => {
    const w = physicsWorld();
    const world = gameWorld(w);
    world.settings.forcePower = 2;
    const kinds = [];
    for (const layer of [LAYER.PROP, LAYER.DEBRIS, LAYER.RAGDOLL]) {
      const w2 = physicsWorld();
      const world2 = gameWorld(w2);
      world2.settings.forcePower = 2;
      const b = new RBody({ position: V(0, 1.35, -6), shape: boxShape(0.4, 0.5, 0.4), mass: 30,
        layer, mask: LAYER.WORLD });
      w2.add(b);
      w2.step(1 / 60);
      const p = player(world2);
      p.toggleGrip({ physics: w2, enemies: [], particles: null });
      assert(p.gripBody === b, `layer ${layer} is not grippable`);
      kinds.push(layer === LAYER.PROP ? 'props' : layer === LAYER.DEBRIS ? 'debris' : 'ragdolls');
    }

    // The case that used to fail: a droid standing in front of a crate. The old
    // filter could not see a kinematic enemy proxy, so the ray went through the
    // droid and handed you the crate behind it.
    const e = new Enemy(world, 'b1', V(0, 0, -6));
    settle(e, world);
    const crate = prop(w, PROPS.crate, V(0, 1.35, -12));
    w.step(1 / 60);
    const p = player(world);
    p.toggleGrip({ physics: w, enemies: [e], particles: null });
    assert(p.gripEnemy === e, 'the droid in front was ignored in favour of the crate behind it');
    assert(p.gripBody !== crate, 'the grip reached through a body to a prop');

    // And the crosshair does not have to be exactly on it.
    const w3 = physicsWorld();
    const world3 = gameWorld(w3);
    world3.settings.forcePower = 2;
    const off = prop(w3, PROPS.crate, V(1.0, 1.35, -12));       // ≈4° off the aim
    w3.step(1 / 60);
    const p3 = player(world3);
    p3.toggleGrip({ physics: w3, enemies: [], particles: null });
    assert(p3.gripBody === off, 'a crate 4° off the crosshair could not be picked up');
    return `${kinds.join(', ')} and enemies all pick up; a target 4° off the crosshair still selects`;
  });
  check('force: stasis stops what is in flight, and lets go of what it took', () => {
    const scene = new THREE.Scene();
    const w = physicsWorld();
    const world = gameWorld(w);
    world.settings.forcePower = 2;
    const pool = new BoltPool(scene, 8);
    const p = player(world);
    const resting = prop(w, PROPS.crate, V(-1, 0.5, -4));
    for (let i = 0; i < 60; i++) w.step(1 / 60);     // let it come to rest first
    const flying = prop(w, PROPS.barrel, V(1, 2.0, -5));
    flying.velocity.set(0, 0, 9);                    // hurled at the player
    w.step(1 / 60);
    const ctx = { physics: w, bolts: pool, enemies: [], particles: null };
    p.toggleStasis(ctx);
    assert(p.stasis.bodies.has(flying), 'a barrel thrown at the player was not stopped');
    // Freezing the crate you are standing next to is not a moment, it is a
    // bug report — the field only takes what is actually moving.
    assert(!p.stasis.bodies.has(resting), 'stasis froze a crate that was just sitting there');
    assert(flying.gravityScale === 0, 'the frozen barrel is still falling');
    for (let i = 0; i < 30; i++) { p._updateStasis(1 / 60, ctx); w.step(1 / 60); }
    assert(flying.velocity.length() < 1e-6, `the frozen barrel is moving at ${flying.velocity.length().toFixed(3)} m/s`);
    assert(!p.stasis.bodies.has(resting), 'the field crept onto a crate that never moved');
    p.releaseStasis(ctx, true);
    for (let i = 0; i < 30; i++) { p._updateStasis(1 / 60, ctx); w.step(1 / 60); }
    assert(flying.gravityScale === 1, 'a released body never got its gravity back');
    assert(flying.velocity.length() > 20, `the released barrel left at ${flying.velocity.length().toFixed(1)} m/s`);
    assert(p.hurled.length === 1 && p.hurled[0].thing === flying,
      'a stasis-launched body cannot hurt what it hits');
    pool.dispose();
    return 'a barrel in flight is caught, held to 0.000 m/s, then launched with its gravity restored';
  });

  check('force: dying does not strand what the Force was holding', () => {
    const scene = new THREE.Scene();
    const w = physicsWorld();
    const world = gameWorld(w);
    const pool = new BoltPool(scene, 8);
    const p = player(world);
    const ctx = { physics: w, bolts: pool, enemies: [], particles: null };
    for (let i = 0; i < 3; i++) pool.fire(V(i * 0.4, 1.4, -4), V(0, 0, 1), { speed: 80, team: 1 });
    const b = prop(w, PROPS.crate);
    w.step(1 / 60);
    p.toggleGrip(ctx);
    assert(p.gripBody === b && b.gravityScale === 0, 'setup: nothing was gripped');
    p.toggleStasis(ctx);
    // die() needs only these; the ragdoll import is async and irrelevant here.
    Object.assign(p, {
      alive: true, saber: { retract() {}, color: { getHex: () => 0 } }, hum: { retract() {} },
      senseActive: false, position: V(0, 0, 0), velocity: V(0, 0, 0),
      // die() collapses the body into an Actor; an empty rig is enough for it.
      rig: { root: new THREE.Object3D(), list: [], updateMatrices() {}, get: () => null, dispose() {} },
    });
    p.die(null);
    assert(b.gravityScale === 1, 'the gripped crate is still weightless with the player dead');
    assert(pool.bolts.every(x => !x.held), 'bolts are still pinned to a dead player’s stasis field');
    assert(p.stasis.held.length === 0 && p.stasis.firing.length === 0, 'the field kept its bookkeeping');
    pool.dispose();
    return 'grip released, gravity restored, no bolt left hanging in the air';
  });
  check('force: the gesture lands on a real arm, not just on a number', () => {
    // Everything above tests the target the gesture asks for. This one drives
    // an actual built Jedi through the same two calls _updateBody makes, so a
    // renamed bone, an inverted elbow or a degenerate palm direction fails here
    // rather than as a limb folded inside out on screen — and it measures where
    // the HAND ends up, which is not the same thing as where it was sent: the
    // committed gestures deliberately aim past the end of a 55 cm arm, so the
    // arm reaches full extension and stops, which is what a thrown palm does.
    const { rig } = buildJedi({ robeIndex: 0, scale: 1 });
    rig.updateMatrices();
    const world = gameWorld(physicsWorld());
    const p = player(world);
    const chest = rig.worldPos('chest', new THREE.Vector3());
    const fwd = V(0, 0, -1), right = V(1, 0, 0);
    const armL = rig.get('armL'), foreL = rig.get('foreL');
    const span = armL.length * armL.cutT + foreL.length * foreL.cutT;
    const restTarget = () => chest.clone().add(V(-0.34, -0.62, -0.05));
    const restPole = () => chest.clone().add(V(-0.85, -0.7, 0));

    // where the hand hangs with no gesture running
    rig.solveIK('armL', 'foreL', restTarget(), restPole());
    rig.updateMatrices();
    const rest = rig.worldPos('handL', new THREE.Vector3());

    const rows = [];
    for (const kind of ['push', 'pull', 'grip', 'hurl', 'stasis', 'unleash', 'rend', 'lightning', 'sense', 'cast']) {
      p.gesture = { kind: '', t: 0, env: 0, sustain: false, at: new THREE.Vector3(), hasAt: false };
      p._gesture(kind);
      let travel = 0, worstAim = 0, worstStretch = 0;
      for (let i = 0; i < 60; i++) {
        p._advanceGesture(1 / 60);
        const target = restTarget(), pole = restPole();
        const palm = p._gesturePose(target, pole, chest, fwd, right);
        rig.solveIK('armL', 'foreL', target, pole);
        if (palm) rig.aimBoneWorld('handL', palm, right);
        rig.updateMatrices();
        const hand = rig.worldPos('handL', new THREE.Vector3());
        assert(isFinite(hand.x) && isFinite(hand.y) && isFinite(hand.z), `${kind} put the hand at NaN`);
        travel = Math.max(travel, hand.distanceTo(rest));
        const shoulder = rig.worldPos('armL', new THREE.Vector3());
        // the wrist can never be further from the shoulder than the arm is long
        worstStretch = Math.max(worstStretch, hand.distanceTo(shoulder) / span);
        // and it has to be pointing the way the gesture asked
        const want = target.clone().sub(shoulder);
        const got = hand.clone().sub(shoulder);
        if (want.length() > 0.1 && got.length() > 0.1) {
          worstAim = Math.max(worstAim,
            Math.acos(Math.min(1, got.normalize().dot(want.normalize()))) * DEG);
        }
      }
      assert(travel > 0.32, `${kind} moves the real hand only ${(travel * 100).toFixed(0)} cm`);
      assert(worstStretch < 1.001, `${kind} straightened the arm past its own length (${worstStretch.toFixed(3)}x)`);
      assert(worstAim < 8, `${kind} put the hand ${worstAim.toFixed(1)}° off the direction it was sent`);
      rows.push(`${kind} ${(travel * 100).toFixed(0)}cm`);
    }
    rig.dispose();
    return `real handL travel on a ${(span * 100).toFixed(0)} cm arm — ${rows.join(' ')}`;
  });

  check('force: a thrown saber rides the ground instead of vanishing into it', async () => {
    /**
     * The player's note 26 opens "thrown saber vanishes into the ground", and
     * `_updateThrow` had no terrain reference of any kind — the disc flew a
     * straight line from wherever it left the hand at whatever pitch, and the
     * ground was simply not in the simulation.
     *
     * It is not an edge case you have to aim for. `Player.js` sets the default
     * camera pitch to -0.06 rad, so at the RESTING aim, with no deliberate
     * downward throw at all, the blade goes under. Measured over all thirteen
     * levels at three pitches (-3, -11, -25 degrees):
     *
     *     before   3804 of 4897 flight frames below the surface, deepest 18.47 m
     *     after    0 of 4571
     *
     * The mark it leaves was never the problem: `Saber.update` already calls
     * `ground.scar(prevTip, tip)` on every lit frame, which is why the buried
     * blade was measured gouging a trench 8-34 times while invisible. Riding
     * the surface turns that from a bug into the effect the note asks for.
     *
     * Three pitches rather than one, because a check that only threw level
     * would have passed on the old tree too.
     */
    const THREE = await import('three');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { World } = await import('../../src/game/World.js');
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');

    const stub = () => {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.shadow.camera.updateProjectionMatrix();
      scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
      return { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
        sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
        renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
        profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
        applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
        setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
        setQuality() {}, setResolutionScale() {}, render() {} };
    };
    const idle = { act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };

    // The game's own resting pitch first: if only a deliberate downward throw
    // went under, this would be a much smaller finding than it is.
    const PITCHES = [-0.06, -0.20, -0.44];
    let under = 0, frames = 0, deepest = 0, worst = '';
    for (const key of LEVEL_ORDER) {
      const w = new World(stub(), { ...DEFAULT_SETTINGS, quality: 'low' });
      await w.loadLevel(key);
      w.spawnPlayer();
      const p = w.player;
      for (let i = 0; i < 60; i++) w.update(1 / 60, idle);
      for (const pitch of PITCHES) {
        p.camera.pitch = pitch;
        p.aimDir.set(0, Math.sin(pitch), -Math.cos(pitch)).normalize();
        p.force = p.maxForce;
        p.cooldowns.throw = 0;
        p.saber.lit = true;
        p.throwOrRecall({ terrain: w.terrain, particles: w.particles, enemies: w.enemies });
        for (let f = 0; f < 240; f++) {
          w.update(1 / 60, idle);
          if (!p.throwState || p.throwState === 'held') break;
          frames++;
          const d = w.terrain.height(p.throwPos.x, p.throwPos.z) - p.throwPos.y;
          if (d > 0.02) {
            under++;
            if (d > deepest) { deepest = d; worst = `${key} at ${(pitch * 180 / Math.PI).toFixed(0)}°`; }
          }
        }
        for (let i = 0; i < 120; i++) w.update(1 / 60, idle);   // let it come home
      }
      w.unload();
    }
    /* Per level rather than in total: 3000 was a sum over thirteen and is a
     * roster count in disguise. Seven levels give 2471, which is 353 each
     * against the old 231 — the survey got DENSER, not thinner. */
    assert(frames / LEVEL_ORDER.length > 250,
      `only ${frames} flight frames over ${LEVEL_ORDER.length} levels — the throw is not being driven`);
    assert(under === 0,
      `${under} of ${frames} flight frames put the blade under the surface, deepest ${deepest.toFixed(2)} m `
      + `(${worst}) — the note this answers opens "thrown saber vanishes into the ground"`);
    return `${LEVEL_ORDER.length} levels x ${PITCHES.length} pitches, ${frames} flight frames, none below the surface`;
  });

  check('force: the grip charges the price the HUD prints, and refuses out loud', () => {
    /**
     * A THRESHOLD WEARING A PRICE TAG.
     *
     * `toggleGrip` opened with `if (!this._canSpend(POWER_COST.grip)) return;`
     * and there was no matching `_spend` anywhere in the take-hold path — the
     * only real bill was the per-second hold. So `POWER_COST.grip = 10`, which
     * the HUD draws on the wheel as the price of the power, was a gate that
     * charged nothing: measured, grip at 100 Force left 100.00 and held a crate.
     *
     * And the `return` was silent, in a file whose own `_refuse` header calls
     * that "the same lie as a dead checkbox". All eleven powers say why; this
     * one and the dash did not.
     *
     * Both halves are asserted against `POWER_COST` and `_priceOf` rather than
     * against 10, because the defect was a number in one place disagreeing
     * with a number in another and a check that types a third copy joins in.
     */
    const w = physicsWorld();
    const world = gameWorld(w);
    world.notices = [];
    world.notify = (t, d) => world.notices.push(`${t} — ${d}`);
    const b = prop(w, PROPS.crate, V(0, 1.35, -6));
    w.step(1 / 60);
    const p = player(world, { force: 100, maxForce: 100, world });
    const price = p._priceOf(POWER_COST.grip);
    const ctx = { physics: w, enemies: [], particles: null };

    const before = p.force;
    p.toggleGrip(ctx);
    assert(p.gripBody === b, 'the fixture never took hold of the crate at all');
    assert(Math.abs((before - p.force) - price) < 1e-6,
      `taking hold cost ${(before - p.force).toFixed(2)} Force against the ${price} the wheel prints — `
      + 'a price that is checked and never charged is a threshold wearing a price tag');

    /* AND YOU ARE NOT BILLED FOR POINTING AT NOTHING. The gate is at the top of
     * the method and the charge is at the take-hold, with every refusal in
     * between — no target, too heavy, immovable. */
    const empty = player(world, { force: 100, maxForce: 100, world });
    const beforeEmpty = empty.force;
    empty.toggleGrip({ physics: physicsWorld(), enemies: [], particles: null });
    assert(!empty.gripBody && empty.force === beforeEmpty,
      `a grip that found nothing still cost ${(beforeEmpty - empty.force).toFixed(2)} Force`);

    // …and below the price it says so, in the charged price and not the list one.
    world.notices.length = 0;
    const broke = player(world, { force: price - 1, maxForce: 100, world });
    broke.toggleGrip(ctx);
    assert(!broke.gripBody, 'the grip took hold on less Force than it costs');
    const said = world.notices.find((n) => /Force needed/.test(n));
    assert(said, `the grip refused in silence at ${(price - 1).toFixed(0)} Force: ${JSON.stringify(world.notices)}`);
    assert(said.includes(String(price)),
      `the refusal reads "${said}" while _canSpend charges ${price}`);
    return `grip charged ${(before - p.force).toFixed(0)} of a printed ${price}; nothing charged for an empty `
      + `pick; refused with "${said}"`;
  });

  check('force: a held jump only lifts you while the Force is actually bought', () => {
    /**
     * THE HELD FORCE JUMP ADDED LIFT WHEN THE FORCE WAS REFUSED.
     *
     * `this._spend(34 * dt); this.velocity.y += 20 * dt;` — the spend's answer
     * dropped on the floor, and `_spend` deducts NOTHING when it refuses, so
     * below the tick price the impulse was simply free. The only gate was
     * `this.force > 0`, which is not the price: the price is
     * `34 * dt * forceDrain * forceCost`. Measured through the real input seam
     * on the shipped code: 0.4 Force bought the identical 4.32 m apex that 125
     * Force bought, and the 7.5/s regen outran the bill, so the full
     * force-jump was permanent at an empty bar.
     *
     * Stated as an ORDERING over the pool the leap is paid from, so it cannot
     * be satisfied by any particular apex: what you can afford is how high you
     * go. The floor is the unpaid leap — `velocity.y = 7.4` off the ground,
     * which costs nothing and must stay free.
     */
    const arc = (force) => {
      const w = liveWorld({ force });
      const held = new Set(), hits = new Set();
      w.ctx.input = {
        keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
        accel: { x: 0, y: 0 }, bindings: null,
        moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
        act: (a) => held.has(a), actHit: (a) => hits.has(a),
      };
      let apex = 0;
      for (let i = 0; i < 150; i++) {
        if (i === 4) { hits.add('jump'); held.add('jump'); }
        if (i > 45) held.delete('jump');
        w.ctx.time = w.w.time = i / 60;
        w.p.update(1 / 60, w.ctx);
        hits.clear();
        apex = Math.max(apex, w.p.position.y);
      }
      const out = { apex, left: w.p.force };
      w.dispose();
      return out;
    };
    const empty = arc(0.4);
    const rich = arc(125);
    assert(rich.apex > empty.apex + 1.5,
      `0.4 Force reached ${empty.apex.toFixed(2)} m and 125 Force reached ${rich.apex.toFixed(2)} m — the `
      + 'held jump is not being paid for, so the pool does not decide the leap');
    assert(empty.apex > 0.5,
      `an unaffordable hold left the leap itself at ${empty.apex.toFixed(2)} m — the ground jump is free and `
      + 'must stay free');
    return `apex 0.4 Force ${empty.apex.toFixed(2)} m, 125 Force ${rich.apex.toFixed(2)} m `
      + `(${(125 - rich.left).toFixed(0)} spent)`;
  });

  check('force: the pool never goes below empty', () => {
    /**
     * `_regen`'s Force Sense drain was `this.force -= 22 * dt`, unclamped, with
     * the shutdown a frame behind it — so the pool spent every tick of a Sense
     * ending a fraction under zero. Measured at 1/60: -0.3333 on the frame
     * before the shutdown, and a 22-verb randomised fuzz across all nine levels
     * turned up seven of them (-0.1405, -0.0110, -0.1170, -0.1529, -0.0721,
     * -0.1038, -0.0462). A negative pool is a bar drawn below zero and a
     * `_canSpend` answered against a debt.
     *
     * Every other drain in the file goes through `_spend`, which refuses rather
     * than overdraws; the per-frame holds are the ones that can undershoot, so
     * the property is stated over the WHOLE pool and swept across frame rates —
     * the overshoot is `rate * dt`, so a low frame rate is where it is worst,
     * and 10 Hz is a rate this project has measured on real hardware (see
     * tools/checks/somersault.mjs).
     */
    const rows = [];
    for (const hz of [60, 30, 10]) {
      const b = liveWorld({ force: 40 });
      b.p.toggleSense(b.ctx);
      assert(b.p.senseActive, `Force Sense would not light at 40 Force (${hz} Hz)`);
      let min = Infinity;
      for (let i = 0; i < Math.round(hz * 8); i++) {
        b.ctx.time = b.w.time += 1 / hz;
        b.p._regen(1 / hz);
        min = Math.min(min, b.p.force);
      }
      assert(min >= 0, `the pool reached ${min.toFixed(4)} at ${hz} Hz — the bar goes below empty`);
      assert(!b.p.senseActive, `Force Sense was still running after 8 s at ${hz} Hz`);
      rows.push(`${hz}Hz ${min.toFixed(4)}`);
      b.dispose();
    }
    return `lowest pool seen: ${rows.join(', ')}`;
  });

  check('force: a refusal quotes the price it actually charges, and the wheel gates what Player gates', async () => {
    /**
     * THE SENTENCE DISAGREED WITH THE REFUSAL ITSELF.
     *
     * Eight refusals quoted the LIST price straight out of `POWER_COST`, and
     * `_canSpend` charges `cost * forceDrain * boonMods.forceCost`. On a
     * default Jedi profile, measured through the real refusals:
     *
     *     push   says 20, charges 16      sense  says 25, charges 20
     *     pull   says 16, charges 12      throw  says 14, charges 11
     *
     * At Force Drain 2x the sentence reads "20 Force needed, you have 30",
     * which looks like a bug in the arithmetic rather than a rule of the game.
     * Lightning had already been fixed to do this by hand; `_priceOf` is that
     * same expression in one place, so the next power cannot get it wrong.
     *
     * AND THE WHEEL'S GATE IS DERIVED FROM PLAYER'S. `POWER_BOON` held
     * `lightning` alone while `forceCompel` also refuses on
     * `!this.boonMods.forceCompel`, so the HUD lit Domination as READY for
     * every player who had never drafted it — from the first frame of a first
     * run, with the earliest offer measured at wave 12. Asserted against the
     * gates actually present in Player.js rather than against a copy of the
     * list, because a copy is what produced the defect.
     */
    const THREE = await import('three');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { POWER_COST, POWER_BOON } = await import('../../src/game/Powers.js');
    const { readFile } = await import('node:fs/promises');

    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
    const engine = { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
      sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
      renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
      profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
      applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
      setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
      setQuality() {}, setResolutionScale() {}, render() {} };
    const idle = { act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };

    const w = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low' });
    /* ANY level — see the note in lifecycle.mjs. `'meadow'` was culled and
     * `loadLevel` has been quietly substituting `LEVEL_ORDER[0]` ever since. */
    const { LEVEL_ORDER: ORDER } = await import('../../src/game/Levels.js');
    await w.loadLevel(ORDER[0]);
    w.spawnPlayer();
    const p = w.player;
    for (let i = 0; i < 30; i++) w.update(1 / 60, idle);

    const refusals = [];
    const real = Object.getPrototypeOf(p)._refuse;
    p._refuse = function (name, why) { refusals.push({ name, why }); return real.call(this, name, why); };
    const ctx = { terrain: w.terrain, particles: w.particles, enemies: w.enemies, physics: w.physics };
    const charged = (c) => Math.round(c * (w.settings.forceDrain ?? 1) * p.boonMods.forceCost);

    const rows = [];
    let checked = 0;
    for (const [key, go] of [
      ['push', () => p.forcePush(ctx)],
      ['pull', () => p.forcePull(ctx)],
      ['throw', () => { p.saber.lit = true; p.throwOrRecall(ctx); }],
      ['sense', () => p.toggleSense(ctx)],
    ]) {
      refusals.length = 0;
      p.force = 0;
      p.cooldowns = {};
      try { go(); } catch { /* some need a target; the price refusal fires first */ }
      const r = refusals.find((x) => /Force needed/.test(x.why));
      assert(r, `${key} never produced a price refusal at 0 Force`);
      const quoted = parseInt(r.why, 10);
      const want = charged(POWER_COST[key]);
      assert(quoted === want,
        `${key} refuses with "${r.why}" while _canSpend charges ${want} — the sentence and the `
        + 'gate disagree, and at Force Drain 2x it reads "needed 20, you have 30"');
      checked++;
      rows.push(`${key} ${quoted}`);
    }
    assert(checked === 4, `only ${checked} powers were driven`);
    w.unload();

    // …and the wheel's gate list is exactly Player's own gates.
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const gates = [...src.matchAll(/if \(!this\.boonMods\.(\w+)\)/g)].map((m) => m[1]).sort();
    const held = Object.values(POWER_BOON).sort();
    assert(gates.length > 0, 'no boon gates found in Player.js — the pattern has moved');
    assert(JSON.stringify(gates) === JSON.stringify(held),
      `Player refuses on boonMods {${gates.join(', ')}} and POWER_BOON holds {${held.join(', ')}} — `
      + 'the HUD lights a power as READY that the player has never been granted');
    return `charged prices quoted: ${rows.join(', ')}; POWER_BOON {${held.join(', ')}} matches `
      + `Player's own gates`;
  });

  /**
   * UNLEASH — the 360-degree "get off me", and every clause of the request is
   * a bound below.
   *
   * "one force power that is a 360 degree 'get off me' type of ability, costs
   * a lot of force but you like yell really loud and raise both your arms out
   * and push everything around you off (like in a scenario where you're being
   * overwhelmed)."
   *
   * The clause that is easy to get wrong and impossible to SEE is the first. A
   * power built by copying `forcePush` inherits its cone, and a cone tested
   * with the enemies in front of you passes every assertion while being
   * exactly the wrong shape — you would only find it by being surrounded, in a
   * fight, at the moment it mattered. So the ring here is seeded all the way
   * round on purpose and the bound is a COMPARISON: what is behind the player
   * must travel about as far as what is in front.
   */
  check('unleash: it throws what is behind you as hard as what is in front', async () => {
    const H = await import('./_coop.mjs');
    const { POWER_COST } = await import('../../src/game/Powers.js');
    const { world } = await H.bootWorld({
      /* NOT `sandbox`. That mode holds the field at `sandboxCount`, which
       * defaults to five, so a ring of eight is quietly culled to five and the
       * three that vanish read as three bodies the power failed to move —
       * measured, and it cost an hour and a wrong hypothesis about vector
       * aliasing in `_shockwave`. */
      level: 'colosseum', settings: { mode: 'waves', difficulty: 'knight' },
    });
    const p = world.player;
    const y = world.terrain.height(0, 0);
    p.position.set(0, y, 0);
    p.aimDir.set(0, 0, -1);
    p.maxForce = 200; p.force = 200;
    p.cooldowns.unleash = 0;

    const ring = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      /* `spawnEnemy(type, pos)` — the position is an ARGUMENT, not something
       * to set afterwards: Enemy's constructor builds its body and its physics
       * proxy from it, so a body spawned at the default and moved later has
       * its collider somewhere else. */
      const at = new THREE.Vector3(Math.sin(a) * 6, y, Math.cos(a) * 6);
      const e = world.spawnEnemy?.('b1', at);
      if (!e || !e.position) continue;
      ring.push({ e, a });
    }
    assert(ring.length >= 6, `only ${ring.length} of 8 bodies could be seeded`);
    const before = ring.map(({ e }) => e.position.clone());

    const ctx = { enemies: world.enemies, physics: world.physics, particles: world.particles,
      terrain: world.terrain, groundColor: world.groundColor, input: H.idleInput() };
    /* COST IS READ BEFORE THE WORLD IS STEPPED. Force regenerates, so a
     * reading taken after the thirty frames the bodies need to fly reports the
     * spend minus half a second of regen — measured, 37 against a real 52,
     * which would have looked like the price table being wrong. */
    const purse = p.force;
    p.forceUnleash(ctx);
    const cost = purse - p.force;
    /* PEAK OUTWARD, not final. A B1 walks about 4 m/s and the AI starts
     * closing again the instant it is upright, so half a second after the cast
     * the FINAL distance is knockback minus walk-back — measured, one body read
     * 0.25 m of net travel having been thrown several metres. What the power
     * did is the furthest it put them, so that is what is sampled. */
    const peak = before.map((b) => b.length());
    for (let i = 0; i < 30; i++) {
      world.update(1 / 60, H.idleInput());
      ring.forEach(({ e }, k) => { peak[k] = Math.max(peak[k], e.position.length()); });
    }

    /* 1. it costs a lot — and more than anything else on the table, which is
     *    the difference between "expensive" and "the panic button". */
    assert(cost > 40, `unleash cost ${cost.toFixed(0)} Force`);
    const dearest = Math.max(...Object.entries(POWER_COST)
      .filter(([k]) => k !== 'unleash').map(([, v]) => v));
    assert(POWER_COST.unleash > dearest,
      `unleash is ${POWER_COST.unleash} against a dearest-other of ${dearest}`);

    /* 2. EVERYTHING went outward, front and back alike. */
    const moved = ring.map(({ e, a }, i) => ({
      d: peak[i] - before[i].length(),
      out: peak[i] - before[i].length(),
      facing: -Math.cos(a),                 // +1 dead ahead, -1 dead behind
    }));
    const front = moved.filter((m) => m.facing > 0.3);
    const back = moved.filter((m) => m.facing < -0.3);
    assert(front.length && back.length, 'the ring did not straddle the player');
    assert(moved.every((m) => m.out > 0.5),
      `something was not pushed outward (least ${Math.min(...moved.map((m) => m.out)).toFixed(2)} m)`);
    const mean = (xs) => xs.reduce((n, m) => n + m.d, 0) / xs.length;
    const fm = mean(front), bm = mean(back);
    assert(bm > fm * 0.6,
      `in front ${fm.toFixed(2)} m, BEHIND ${bm.toFixed(2)} m — that is a cone wearing a circle's name`);

    /* 3. it staggers, because the room it buys is the point and not the damage. */
    const stunned = ring.filter(({ e }) => (e.stunT ?? e.stunTimer ?? 0) > 0 || e.staggered).length;
    assert(stunned >= Math.floor(ring.length * 0.6),
      `only ${stunned} of ${ring.length} were staggered — knockback alone buys no room`);

    /* 4. and it cannot be leaned on. */
    assert(p.cooldowns.unleash > 4, `cooldown is ${p.cooldowns.unleash}s`);
    const again = p.force;
    p.forceUnleash(ctx);
    assert(p.force === again, 'a second cast on cooldown still charged the player');

    world.unload();
    return `${cost.toFixed(0)} Force · ${ring.length} bodies: front ${fm.toFixed(2)} m, `
      + `behind ${bm.toFixed(2)} m · ${stunned} staggered · ${p.cooldowns.unleash}s cooldown`;
  });

}

/** The hold range has to span the reach, not a slice of it. */
function near_far_ok(near, far, reach, assert) {
  assert(Math.abs(far - reach) < 0.05, `the far stop is ${far.toFixed(2)} m, not the ${reach.toFixed(2)} m reach`);
  assert(far > near * 3, `the hold range ${near.toFixed(2)}→${far.toFixed(2)} m barely moves`);
}