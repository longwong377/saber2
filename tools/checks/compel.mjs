/**
 * BATTLEFRONT BORZ — Force compel, and the three places a "mind control" power usually
 * turns out to be an impression of itself.
 *
 * Note 44: "make an enemy fire on itself or its allies."
 *
 * It is easy to write a version of this that looks right in a screenshot and is
 * worth nothing: the droid turns round, the muzzle flashes, its friend takes no
 * damage, and the player concludes the power is broken — which is exactly the
 * failure force-feedback.mjs was written for one layer up. There are three
 * separate things that all have to be true, and none of them is the animation:
 *
 *   1. the compelled unit's TARGET is the ally, not the player. Everything the
 *      brain does — advancing, cover, leading the shot, the melee decision —
 *      hangs off `this.target`, so if only the trigger were redirected the unit
 *      would walk at the player while shooting sideways.
 *   2. the BOLT it fires may hurt its own side. Bolts are sorted by team, and a
 *      compelled droid has not changed sides — it has been made to point the
 *      wrong way — so without a flag its shots pass straight through the ally
 *      it is aiming at. This is the one that would have shipped.
 *   3. alone, it shoots ITSELF, and the bolt has to actually connect. A rifle
 *      at the shoulder has its muzzle half a metre in FRONT of the ribs, so
 *      aiming at its own chest from its own muzzle points backwards and the
 *      shot goes over its shoulder into the sky.
 *
 * (2) and (3) are measured through `World.prototype._boltHitTest` itself,
 * called against a hand-built `this`, because the claim is about what that
 * function decides and a re-implementation of its rules would only agree with
 * itself. Every check here fails on the tree it was written against, most of
 * them by `forceCompel` not existing.
 */

import { Player } from '../../src/game/Player.js';
import { Enemy } from '../../src/game/Enemy.js';
import { World } from '../../src/game/World.js';
import { clocked } from './_shared.mjs';

let THREE = null;

function bench({ force = 400, compel = true } = {}) {
  const world = {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
      // Enemy's own line of sight goes through the terrain, not the physics
      // world — an omission that reads as a bug in compel rather than in a stub.
      raycast: () => null,
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [],
      addJoint() {}, removeJoint() {} },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    notices: [],
    notify(title, sub) { this.notices.push({ title, sub }); },
    report() {},
  };
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.force = force;
  p.boonMods.compel = compel;
  p.aimDir.set(0, 0, -1);
  const ctx = { input: null, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  return { p, world, ctx };
}

/**
 * A droid standing where you put it, POSED.
 *
 * The pose matters and it is a trap this project has hit before: `capsules()`
 * reads bone world matrices, and every bone is at the world origin until the
 * body has been through one update. A hit test run against an unposed enemy
 * measures a droid standing inside the origin, so a bolt aimed at where it
 * looks like it is standing misses everything, and the check reports the bug it
 * was written to catch whether or not the bug is there.
 */
function foe(b, x, z, type = 'b1') {
  const e = new Enemy(b.world, type, new THREE.Vector3(x, 0, z));
  e.position.set(x, 0, z);
  b.ctx.enemies.push(e);
  b.ctx.pickTarget = b.ctx.pickTarget || (() => b.p);
  e.update(1 / 60, b.ctx);
  e.position.set(x, 0, z);
  e._pose(1 / 60, b.ctx);
  return e;
}

/** A bolt travelling `from → to`, put through the real hit test. */
function shootAt(b, bolt, from, to) {
  const host = {
    players: [b.p], enemies: b.ctx.enemies, props: [],
    physics: { raycast: () => null },
    particles: { sparkBurst() {}, boltImpact() {} },
    onHitmark() {},
  };
  return World.prototype._boltHitTest.call(host, bolt, from, to);
}

export async function run({ check, assert, THREE: T }) {
  /* Every check in this file is wrapped: the two shared streams are put on
   * their modules' own seeds before each body and the wind clock is put back
   * after it. See tools/checks/_shared.mjs — the rule is there, not here.
   */
  check = await clocked(check);
  THREE = T;

  check('compel: the unit is turned, not just its trigger', () => {
    /* `_think` is where a brain decides everything, and it decides all of it
     * from `this.target`. If compulsion only redirected the shot, the droid
     * would close on the player while firing at its friend, which is not a
     * turned unit — it is a bug with a muzzle flash. */
    const b = bench();
    const droid = foe(b, 0, -6);
    const ally = foe(b, 5, -9);
    b.p.forceCompel(b.ctx);
    assert(droid.compelled, 'the droid under the crosshair was not compelled at all');
    assert(droid.compelled.target === ally,
      'the compelled droid is not aimed at its ally');

    // The brain, run for real: pickTarget in this stub always answers "the
    // player", so anything other than the ally means the substitution did not
    // reach `_think`.
    b.ctx.pickTarget = () => b.p;
    droid.stunTimer = 0;
    droid._think(1 / 60, b.ctx);
    assert(droid.target === ally,
      `the compelled droid's brain is still fighting ${droid.target === b.p ? 'the player' : 'nothing'}`);

    // …and it wears off, rather than converting the unit permanently. It fires
    // while it runs, so the sink has to be here: `ctx.bolts` is null in this
    // bench and a compelled droid is a droid that pulls a trigger.
    b.ctx.bolts = { fire: () => null };
    for (let i = 0; i < 60 * 8; i++) { b.world.time += 1 / 60; droid.update(1 / 60, b.ctx); }
    assert(!droid.compelled, 'the compulsion never ended — a wave could be converted card by card');
    return `target → ally, brain follows, released after ${(6).toFixed(0)} s`;
  });

  check('compel: a turned bolt hurts the side that fired it, and a plain one does not', () => {
    /* The failure that would have shipped. `team` says which side a bolt
     * belongs to and a compelled droid is still team 1, so the ONLY thing that
     * can let its shot land on an ally is the flag. Both directions are
     * measured, because a fix that let every enemy bolt hit every enemy would
     * also pass a one-sided test and would turn every firefight into a
     * massacre. */
    const b = bench();
    const shooter = foe(b, 0, -6);
    const victim = foe(b, 0, -12);
    const from = new THREE.Vector3(0, 1.2, -7);
    const to = new THREE.Vector3(0, 1.2, -13);

    const before = victim.hp;
    const plain = shootAt(b, { team: 1, owner: shooter, damage: 9, deflected: false, turned: false }, from, to);
    assert(!plain || plain.victim !== victim,
      'an ordinary enemy bolt is hitting another enemy — every firefight is now a massacre');
    assert(victim.hp === before, `a plain bolt took ${(before - victim.hp).toFixed(1)} hp off an ally`);

    const turned = shootAt(b, { team: 1, owner: shooter, damage: 9, deflected: false, turned: true }, from, to);
    assert(turned && turned.victim === victim,
      'a turned bolt passed straight through the ally it was aimed at — the whole ability is an impression');
    assert(victim.hp < before, 'the turned bolt connected and did nothing');
    return `plain: no hit, hp ${before.toFixed(0)}; turned: ${turned.bone ?? 'hit'}, hp ${victim.hp.toFixed(0)}`;
  });

  check('compel: alone, it turns the blaster on itself — and the shot connects', () => {
    /* Both halves. The first is a decision (`target === itself` when there is
     * nobody else within reach); the second is geometry, and it is the one that
     * silently fails: `_boltHitTest` skipped `owner === e` outright, so even a
     * perfectly aimed self-shot did nothing at all. */
    const b = bench();
    const lone = foe(b, 0, -6);
    b.p.forceCompel(b.ctx);
    assert(lone.compelled, 'a lone droid could not be compelled');
    assert(lone.compelled.target === lone,
      'a droid with nobody to shoot was compelled at nothing — the power silently did nothing');

    const before = lone.hp;
    const from = new THREE.Vector3(lone.position.x, 0.55, lone.position.z + 0.26);
    const to = new THREE.Vector3(lone.position.x, 1.9, lone.position.z);
    const res = shootAt(b, { team: 1, owner: lone, damage: 20, deflected: false, turned: true }, from, to);
    assert(res && res.victim === lone, 'the self-shot missed the droid that fired it');
    assert(lone.hp < before, 'the self-shot connected and did no damage');

    // and a plain bolt from the same muzzle still cannot hurt its owner, or
    // every droid in the game would shoot itself in the foot on wave one
    const b2 = bench();
    const other = foe(b2, 0, -6);
    const hp = other.hp;
    shootAt(b2, { team: 1, owner: other, damage: 20, deflected: false, turned: false }, from, to);
    assert(other.hp === hp, 'an ordinary droid is damaging itself with its own fire');
    return `self-target chosen with nobody in ${(14).toFixed(0)} m; ${(before - lone.hp).toFixed(0)} hp of self-inflicted damage; plain fire still safe`;
  });

  check('compel: the muzzle is behind the chest for a self-shot, not in front of it', () => {
    /* The geometry on its own, because it is the part that looks correct in the
     * source and is exactly backwards. A B1 holds its rifle at the shoulder, so
     * the muzzle is ~0.5 m FORWARD of the ribs: aiming from the muzzle at its
     * own chest gives a direction pointing back over its shoulder, and the shot
     * leaves the level. Measured on the shipped muzzle, the dot between
     * (chest − muzzle) and the droid's own forward was negative.
     *
     * This measures the two points `_shoot` uses rather than firing, because
     * the claim is about where they are relative to each other. */
    const b = bench();
    const e = foe(b, 0, -6);
    e.facing = 0;
    e.compelled = { target: e, t: 6 };
    e.target = e;

    const fired = [];
    const ctx = { ...b.ctx, bolts: { fire: (from, dir, opts) => { fired.push({ from: from.clone(), dir: dir.clone(), opts }); } } };
    e.world.particles = null;
    e._shoot(ctx);
    assert(fired.length === 1, `a compelled self-shot fired ${fired.length} bolts`);
    const { from, dir, opts } = fired[0];
    assert(opts.turned, 'a compelled unit fired an ordinary bolt — it cannot hit anything of its own');

    // The shot has to travel UP THROUGH the body: start below the chest, end
    // above it, and pass within the droid's own radius of its centre line.
    assert(dir.y > 0.5, `the self-shot leaves at ${dir.y.toFixed(2)} vertical — it is going over its own shoulder`);
    const axial = Math.hypot(from.x - e.position.x, from.z - e.position.z);
    assert(axial < 0.6, `the muzzle is ${axial.toFixed(2)} m off its own centre line`);
    assert(from.y < e.position.y + 1.0, `the shot starts at ${from.y.toFixed(2)} m, already above the chest`);
    return `muzzle ${axial.toFixed(2)} m off axis at ${from.y.toFixed(2)} m, firing ${(Math.asin(dir.y) * 180 / Math.PI).toFixed(0)}° up`;
  });

  check('compel: it refuses out loud, and it refuses the things it should', () => {
    /* The house rule: a Force power that declines says which of its reasons it
     * was. Four of them here, and two are specific to this power — a boss
     * cannot be turned (a boss fight that ends with a keypress is not a fight)
     * and neither can something with no blaster to turn. */
    const rows = [];
    {
      const b = bench({ compel: false });
      foe(b, 0, -6);
      b.p.forceCompel(b.ctx);
      assert(b.world.notices.length === 1 && /attun|Domination/i.test(b.world.notices[0].sub),
        `unattuned compel said ${JSON.stringify(b.world.notices)}`);
      rows.push('unattuned');
    }
    {
      const b = bench({ force: 4 });
      foe(b, 0, -6);
      b.p.forceCompel(b.ctx);
      assert(b.world.notices.length === 1 && /Force/.test(b.world.notices[0].sub),
        `compel at 4 Force said ${JSON.stringify(b.world.notices)}`);
      rows.push('no force');
    }
    {
      const b = bench();
      b.p.forceCompel(b.ctx);                        // nothing in the level
      assert(b.world.notices.length === 1 && /sight|reach/i.test(b.world.notices[0].sub),
        `compel at an empty room said ${JSON.stringify(b.world.notices)}`);
      rows.push('empty');
    }
    {
      const b = bench();
      const e = foe(b, 0, -6, 'acolyte');            // a blade, no blaster
      b.p.forceCompel(b.ctx);
      assert(!e.compelled, 'a swordsman was compelled to open fire with a lightsaber');
      assert(b.world.notices.length === 1 && /blaster/i.test(b.world.notices[0].sub),
        `compelling a melee unit said ${JSON.stringify(b.world.notices)}`);
      rows.push('no blaster');
    }
    {
      const b = bench();
      const e = foe(b, 0, -6);
      e.A = { ...e.A, boss: true };
      b.p.forceCompel(b.ctx);
      assert(!e.compelled, 'a boss was compelled — the fight now ends with a keypress');
      rows.push('boss');
    }
    return rows.join(', ') + ' — all refused by name';
  });
}
