/**
 * BATTLEFRONT BORZ — what the Force does when it takes hold of something.
 *
 * Three of the player's notes are one mechanic seen from three sides:
 *
 *   42 "force pull should bring things fully to melee range, let me impale or
 *       cut them while held, and let me use a held body as a shield that
 *       actually stops bolts"
 *   41 "force drain should scale with mass, distance and hold time, and grow
 *       with power"
 *   48 "held bodies should have real limb physics as you swing them"
 *
 * The shield half was built and checked earlier. This file is the other two,
 * and both of them failed on the tree they were written against for the same
 * underlying reason: THE GRIP KNEW ABOUT MASS AND NOTHING ELSE.
 *
 *   · a pull was `impulse = -min(d * 3.2, 22)` along the line to the player. It
 *     is a shove with no idea where the player is, so it overshoots at close
 *     range and falls short at long. Measured on the tree before this change,
 *     against a target that should end 2.2 m in front of the chest: from 4 m it
 *     ended up 5.6 m PAST the player; from 16 m it stopped 9.8 m short. There
 *     is exactly one distance at which "bring it to melee" was true.
 *   · a hold cost `(7 + 6·mass/cap)` per second whether the thing was at arm's
 *     length or at thirty-six metres, and whether it had been held for a tenth
 *     of a second or a minute. Distance and time did not appear at all, so
 *     there was never a reason to pull something closer and never a moment at
 *     which continuing to hold it became a decision.
 *   · and a held body was no easier to cut than one standing up, so "impale
 *     them while held" was not a thing the cut model could express.
 *
 * Every number below is measured through the real Player, the real Enemy
 * damping and the real BladeContactSolver rather than asserted about the
 * source, because all three of these are claims about where a body ENDS UP.
 */

import { Player } from '../../src/game/Player.js';
import { Enemy } from '../../src/game/Enemy.js';
import { openness } from '../../src/game/Combat.js';

let THREE = null;

function bench({ force = 400, forcePower = 1 } = {}) {
  const world = {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [],
      // A choke kills, a kill ragdolls, and a ragdoll builds joints. Without
      // these two the grip checks die on the frame their victim does, which
      // reads as a bug in the grip.
      addJoint() {}, removeJoint() {} },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    notify() {}, report() {},
  };
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.force = force;
  const ctx = { input: null, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  return { p, world, ctx };
}

/** A droid standing `d` metres in front of the player, in the player's own world. */
function standing(b, d, type = 'b1') {
  const e = new Enemy(b.world, type, new THREE.Vector3(0, 0, -d));
  e.position.set(0, 0, -d);
  b.ctx.enemies.push(e);
  return e;
}

/**
 * Where a body comes to rest after being pulled, and how long it took to get
 * there, integrated through Enemy's own damping rather than guessed at. Only
 * the horizontal is followed: the arc is the arc, and what "melee range" means
 * is a distance across the ground.
 *
 * "Arrived" is the first frame it is inside 3.5 m of the player rather than the
 * frame it stops, because a body that skids to a halt has arrived when it gets
 * there and not when it settles.
 */
function settle(b, e, seconds = 4) {
  const dt = 1 / 60;
  let arrived = null;
  for (let i = 0; i < seconds / dt; i++) {
    b.world.time += dt;
    // The mover, without the AI: `_move` is what carries the knockback, and
    // running the full update would have the droid walk back toward the player
    // and hide the thing being measured.
    e._move(dt, b.ctx);
    e.knockTimer = Math.max(0, e.knockTimer - dt);
    const r = Math.hypot(e.position.x, e.position.z);
    // Melee range is measured to the BODY, not to the origin of a coordinate
    // system: an Acklay's flank is a metre and a half from its own centre, and
    // a big creature that gets its bulk to within arm's reach has arrived.
    if (arrived === null && r < 3.5 + (e.radius || 0)) arrived = i * dt;
    if (e.velocity.lengthSq() < 1e-4 && i * dt > 0.4) break;
  }
  return { end: Math.hypot(e.position.x, e.position.z), arrived };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('force pull: things arrive at the end of your blade, from any distance', () => {
    /* The bar is a BAND rather than a point, and it is deliberately generous
     * at the top: 3.5 m is still inside a swing, and a pull that stopped
     * everything dead at exactly 2.2 would look like a tractor beam. What it
     * may not do is either of the two things it used to do — arrive behind the
     * player, or not arrive at all.
     *
     * "Behind" is the sharper failure and it needs its own statement: a body
     * that ends up on the far side of you has been pulled THROUGH you, which
     * no amount of correct physics makes look right. */
    const rows = [];
    let worst = 0;
    // Within the reach at the shipped Force Power, plus one at the top of the
    // slider: the far end is where a speed-capped pull would give up, and
    // 30 m is inside `17·√4` but well outside anything the low end can do.
    for (const [d, P] of [[4, 1], [8, 1], [12, 1], [16, 1], [30, 4]]) {
      const b = bench({ force: 400, forcePower: P });
      const e = standing(b, d);
      b.p.aimDir.set(0, 0, -1);
      b.p.forcePull(b.ctx);
      const { end } = settle(b, e);
      // …and which side of the player it stopped on.
      assert(e.position.z < 0.4,
        `pulled from ${d} m and it ended up ${(-e.position.z).toFixed(1)} m BEHIND the player`);
      assert(end < 4.2, `pulled from ${d} m and it stopped ${end.toFixed(1)} m away — that is not melee range`);
      assert(end > 1.0, `pulled from ${d} m and it ended ${end.toFixed(1)} m away, inside the player`);
      worst = Math.max(worst, Math.abs(end - 2.2));
      rows.push(`${d}m${P > 1 ? `@P${P}` : ''} → ${end.toFixed(1)}m`);
    }
    assert(worst < 2.0, `the worst arrival misses the mark by ${worst.toFixed(1)} m`);
    return rows.join(', ') + ` (worst error ${worst.toFixed(1)} m)`;
  });

  check('force pull: mass shows itself as TIME, not as falling short', () => {
    /* The heft law is already in the code and this is the check it never had.
     *
     * It measures the clock rather than the distance, and that is a design
     * decision worth stating: something that stops two thirds of the way to you
     * does not read as heavy, it reads as the power having missed. What reads
     * as heavy is a thing that comes, and takes its time coming. Both still
     * arrive; the beast takes several times as long over the same ground. */
    const rows = [];
    const run = (type) => {
      const b = bench({ force: 400 });
      const e = standing(b, 14, type);
      b.p.aimDir.set(0, 0, -1);
      b.p.forcePull(b.ctx);
      const { end, arrived } = settle(b, e, 8);
      assert(arrived !== null, `a ${type} pulled from 14 m never arrived at all (stopped ${end.toFixed(1)} m out)`);
      rows.push(`${type} ${arrived.toFixed(2)}s → ${end.toFixed(1)}m`);
      return arrived;
    };
    const light = run('b1'), heavy = run('beast');
    assert(heavy > light * 1.5,
      `a b1 arrives in ${light.toFixed(2)}s and a beast in ${heavy.toFixed(2)}s — mass is not being felt`);
    return rows.join(', ') + `, ${(heavy / Math.max(light, 0.01)).toFixed(1)}× slower`;
  });

  check('force grip: what a hold costs rises with distance, with time, and falls with power', () => {
    /* Three separate claims, each measured by holding the same body under one
     * changed condition and reading the Force actually spent. The absolute
     * numbers are not pinned — they are balance and they will move — but the
     * ORDERING and the size of each effect are the mechanic. */
    const spend = ({ out = 3, seconds = 1, forcePower = 1, warm = 0 } = {}) => {
      const b = bench({ force: 100000, forcePower });
      const e = standing(b, out);
      b.p.aimDir.set(0, 0, -1);
      b.p.gripEnemy = e; e.gripped = true;
      b.p._liftPoint.copy(e.position);
      b.p.gripDistance = b.p.camera.pos.distanceTo(b.p.chest) + out;
      b.p._holdT = warm;
      const dt = 1 / 60;
      const before = b.p.force;
      for (let i = 0; i < seconds / dt; i++) {
        b.world.time += dt;
        b.p._wheel = 0;
        b.p._updateGrip(dt, b.ctx);
      }
      return before - b.p.force;
    };

    const near = spend({ out: 2 });
    const far = spend({ out: 30 });
    assert(far > near * 1.25,
      `holding at 30 m costs ${far.toFixed(1)} and at 2 m ${near.toFixed(1)} — distance is not in the price`);

    const fresh = spend({ warm: 0 });
    const tired = spend({ warm: 20 });
    assert(tired > fresh * 1.25,
      `a hold costs ${fresh.toFixed(1)}/s new and ${tired.toFixed(1)}/s after twenty seconds — time is not in the price`);

    const weak = spend({ forcePower: 1 });
    const strong = spend({ forcePower: 4 });
    assert(strong < weak * 0.8,
      `forcePower 4 pays ${strong.toFixed(1)} against ${weak.toFixed(1)} at 1 — power buys nothing`);

    return `near ${near.toFixed(1)} far ${far.toFixed(1)} (${(far / near).toFixed(2)}×), `
      + `fresh ${fresh.toFixed(1)} tired ${tired.toFixed(1)} (${(tired / fresh).toFixed(2)}×), `
      + `P1 ${weak.toFixed(1)} P4 ${strong.toFixed(1)} (${(strong / weak).toFixed(2)}×)`;
  });

  check('force grip: the wear clock runs only while something is held', () => {
    /* Two failure modes, and the tree had the second one.
     *
     * It would be a bug rather than a mechanic if wear accumulated across
     * separate holds — a player five minutes into a fight would find their
     * first grip of the sixth minute already exhausted — so releasing has to
     * clear it. And `_updateGrip` runs every frame the key is down whether or
     * not the pick found anything, so an empty hand must not age the clock
     * either: the first version did, and five seconds of grabbing at air made
     * the next real hold cost 60% more.
     *
     * The victim is a CRATE rather than a droid, deliberately. Holding a living
     * thing is a choke and a B1 dies of it in about four seconds, so a check
     * that held one for five would be measuring the choke. */
    const b = bench({ force: 100000 });
    const crate = {
      mass: 40, dead: false, gravityScale: 1, boundingRadius: 0.5, invMass: 1 / 40,
      position: new THREE.Vector3(0, 1, -3), velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(), wake() {},
    };
    b.p.gripBody = crate;
    for (let i = 0; i < 300; i++) { b.world.time += 1 / 60; b.p._updateGrip(1 / 60, b.ctx); }
    const warmed = b.p._holdT;
    assert(warmed > 4.5, `five seconds of holding only clocked ${warmed.toFixed(1)}s`);

    b.p.releaseGrip();
    assert(b.p._holdT === 0, `releasing left the hold clock at ${b.p._holdT}`);

    for (let i = 0; i < 300; i++) { b.world.time += 1 / 60; b.p._updateGrip(1 / 60, b.ctx); }
    assert(b.p._holdT === 0,
      `five seconds of holding NOTHING aged the wear clock to ${b.p._holdT.toFixed(1)}s`);
    return `${warmed.toFixed(1)}s held → cleared on release → ${b.p._holdT}s for an empty hand`;
  });

  check('cutting: a body that cannot set itself parts faster, and a boss does not', () => {
    /* `openness` is a multiplier on cutting WORK, so it shortens the road to a
     * sever rather than inventing a damage number the cut model does not have.
     * The three states have to be ordered — held is the most helpless thing
     * that can happen to a body — and the boss exemption has to hold, or
     * "grab the boss" becomes the whole fight. */
    const mk = (props) => Object.assign({ dead: false, gripped: false, yankT: 0,
      toppled: false, stunTimer: 0, A: {} }, props);
    const held = openness(mk({ gripped: true }));
    const yanked = openness(mk({ yankT: 0.2 }));
    const downed = openness(mk({ stunTimer: 0.5 }));
    const standing_ = openness(mk({}));
    const boss = openness(mk({ gripped: true, A: { boss: true } }));

    assert(standing_ === 1, `a droid on its feet cuts at ${standing_}×`);
    assert(held > yanked && yanked > downed && downed > standing_,
      `the states are out of order: held ${held}, yanked ${yanked}, downed ${downed}`);
    assert(held >= 2.5, `a body held off the ground only parts ${held}× faster — that is not an impale`);
    assert(boss < held * 0.6, `a held boss parts at ${boss}× against a droid's ${held}× — hold-to-kill`);
    assert(openness(mk({ gripped: true, dead: true })) === 1, 'a corpse is still being counted as helpless');
    assert(openness(null) === 1, 'openness(null) has to be neutral — every prop and door goes through it');
    return `held ${held}×, yanked ${yanked}×, downed ${downed}×, standing ${standing_}×, held boss ${boss}×`;
  });

  check('force pull: the window it opens closes on its own', () => {
    // A yank that never expired would make the first pull of a fight a
    // permanent 2× on that target.
    const b = bench();
    const e = standing(b, 10);
    b.p.aimDir.set(0, 0, -1);
    b.p.forcePull(b.ctx);
    assert(e.yankT > 0, 'a pull left no window at all');
    const opened = openness(e);
    let t = 0;
    const dt = 1 / 60;
    while (e.yankT > 0 && t < 5) { e.yankT = Math.max(0, e.yankT - dt); t += dt; }
    assert(t > 0.15 && t < 1.0, `the window lasted ${t.toFixed(2)}s — that is not one swing`);
    assert(openness(e) === 1, 'the window closed and the bonus did not');
    return `${opened}× for ${t.toFixed(2)}s, then ${openness(e)}×`;
  });
}
