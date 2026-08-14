/**
 * SABER — a Force key that refuses has to say so.
 *
 * THE BUG. The player reported "force lightning does nothing when pressed",
 * and it was true. `KeyZ` is in ACTIONS, printed in the Codex and on the pause
 * card, and the call site read
 *
 *     if (input.actHit('lightning') && this.boonMods.lightning) this.forceLightning(ctx);
 *
 * with `forceLightning` then opening on `if (this.force < cost ||
 * this.cooldowns.lightning > 0) return;`. Four different states — not attuned,
 * not enough Force, still recovering, and working — collapsing into two
 * outcomes, one of which is nothing at all happening. There is no way for a
 * player to tell a power they have not unlocked from a power that is broken,
 * and they will report the second one, because that is what it looks like.
 *
 * This project already knows the shape of that bug: `controls.mjs` fails the
 * build for a setting nobody reads, a boon whose only effect is a flag nobody
 * reads, and an action nothing handles. This is the same class one layer in —
 * an action something handles, silently, by declining.
 *
 * The precedent for the fix is already in the tree too. A refused Force lift
 * says TOO HEAVY and names the mass, the cap and the slider that moves it. So:
 * every Force ability that declines, for any reason, notifies with the reason.
 *
 * Both checks fail on the tree they were written against.
 */

import { Player } from '../../src/game/Player.js';
import { ACTIONS } from '../../src/engine/Bindings.js';
import { functionBody } from './_source.mjs';

let THREE = null;

function bench({ force = 100, boons = {} } = {}) {
  const notices = [];
  const world = {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    notify: (title, sub) => notices.push({ title, sub }),
    report() {},
  };
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.force = force;
  Object.assign(p.boonMods, boons);
  const ctx = { input: null, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  return { p, world, ctx, notices };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('force: a power that declines says which of its three reasons it was', () => {
    /*
     * Three states per ability, and each one has to produce a DIFFERENT notice.
     * A single "you can't do that" would pass a check that only counted
     * notices, and would be very nearly as useless to the player as silence —
     * "not yet attuned" and "18 Force short" are different problems with
     * different answers.
     */
    const rows = [];

    // 1. not attuned
    {
      const b = bench({ force: 100, boons: { lightning: false } });
      b.p.forceLightning(b.ctx);
      assert(b.notices.length === 1,
        `pressing lightning without the boon produced ${b.notices.length} notices — the key is silent, which is the bug`);
      assert(/attun|boon|draft/i.test(b.notices[0].sub),
        `the refusal says "${b.notices[0].sub}" without telling the player how to get the power`);
      rows.push(`unattuned → "${b.notices[0].sub}"`);
    }
    // 2. not enough Force
    {
      const b = bench({ force: 5, boons: { lightning: true } });
      b.p.forceLightning(b.ctx);
      assert(b.notices.length === 1 && /Force/.test(b.notices[0].sub),
        `pressing lightning at 5 Force produced ${JSON.stringify(b.notices)} — it has to name the cost`);
      assert(/30/.test(b.notices[0].sub) && /5/.test(b.notices[0].sub),
        `the refusal says "${b.notices[0].sub}" without both the cost and what the player has`);
      rows.push(`no force → "${b.notices[0].sub}"`);
    }
    // 3. on cooldown
    {
      const b = bench({ force: 100, boons: { lightning: true } });
      b.p.forceLightning(b.ctx);                       // fires, and starts the cooldown
      const fired = b.notices.length;
      b.world.time = 0.1;
      b.p.forceLightning(b.ctx);
      assert(b.notices.length === fired + 1,
        'pressing lightning again during its own cooldown said nothing');
      assert(/recover|\ds/i.test(b.notices[fired].sub),
        `the cooldown refusal says "${b.notices[fired].sub}" without saying how long`);
      rows.push(`cooldown → "${b.notices[fired].sub}"`);
    }
    // 4. and it fires when it can
    {
      const b = bench({ force: 100, boons: { lightning: true } });
      const before = b.p.force;
      b.p.forceLightning(b.ctx);
      assert(b.p.force < before, 'lightning with the boon and full Force did not fire');
      assert(b.notices.length === 0, `a power that WORKED still complained: ${JSON.stringify(b.notices)}`);
      rows.push(`attuned → fires, ${Math.round(before - b.p.force)} Force`);
    }
    return rows.join('; ');
  });

  check('force: a held key does not turn the refusal into a stutter', () => {
    // 60 refusals a second is a notice nobody reads and a sound nobody can
    // stand. The rate limit is per ability, so two different refusals in the
    // same second still both arrive.
    const b = bench({ force: 0, boons: { lightning: true } });
    for (let i = 0; i < 60; i++) { b.world.time = i / 60; b.p.forceLightning(b.ctx); }
    assert(b.notices.length <= 2,
      `holding the key for a second produced ${b.notices.length} notices`);
    assert(b.notices.length >= 1, 'holding a refusing key for a second said nothing at all');
    const n = b.notices.length;
    b.p.forcePush(b.ctx);
    assert(b.notices.length === n + 1,
      'a DIFFERENT power refusing in the same second was swallowed by the rate limit');
    return `${n} notice(s) for a second of held lightning, and force push still gets its own`;
  });

  check('force: every Force action reaches a handler that can refuse out loud', async () => {
    /*
     * The structural half, so the next power added does not reintroduce the
     * silence. Every id in the Force group has to be read in Player.js, and
     * every method it dispatches to has to be able to reach `_refuse` — an
     * ability whose only early return is a bare `return` is one press away from
     * being reported as broken.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    // `focus` is the one Force action read a layer up rather than in Player: it
    // dilates the WORLD's clock, so World.update owns it and Focus.js spends
    // the meter. Both files count.
    const forceIds = ACTIONS.filter((a) => a.group === 'Force').map((a) => a.id);
    const unread = forceIds.filter((id) =>
      !new RegExp(`act(?:Hit)?\\(\\s*'${id}'`).test(src) && !new RegExp(`act\\(\\s*'${id}'`).test(world));
    assert(!unread.length, `Force actions nothing reads: ${unread.join(', ')}`);
    // the abilities with a cost or a cooldown are the ones that can decline
    const spenders = ['forceLightning', 'forcePush', 'forcePull', 'toggleStasis', 'forceDisassemble'];
    const silent = [];
    for (const name of spenders) {
      if (!src.includes(`  ${name}(`)) { silent.push(`${name} (gone)`); continue; }
      const body = functionBody(src, `  ${name}(`);
      if (!/_refuse\(/.test(body)) silent.push(name);
    }
    assert(!silent.length,
      `these decline without a word: ${silent.join(', ')} — the player cannot tell them from broken`);
    return `${forceIds.length} Force actions, all read across Player.js and World.js; `
      + `${spenders.length} spenders, all able to say why not`;
  });

  check('force: holding a living thing off the ground chokes it', () => {
    /**
     * THE GRIP DID NO HARM. It could lift an enemy, walk them about and hurl
     * them, and for as long as it held them nothing happened — so the most
     * cinematic thing in the source material was a way to move a droid around.
     * Force choke is that grip with a consequence, which is why it has no key
     * of its own.
     *
     * The rate is a FRACTION OF MAX HP, because this roster spans 28 hp on a B1
     * and 900 on an Acklay and a flat number is either an instant kill or a
     * joke depending on which one you grabbed. So the check is on the FRACTION,
     * measured on two bodies an order of magnitude apart, and it has to come
     * out the same for both — a flat rate would fail it on the second one.
     */
    const rows = [];
    for (const [name, maxHp, big] of [['acolyte', 400, false], ['acklay', 900, true]]) {
      const b = bench({ force: 1e6 });
      let hp = maxHp;
      const e = {
        maxHp, dead: false, gripped: false, liftTarget: null, chokeT: 0,
        position: new THREE.Vector3(2, 0, 0),
        A: { mass: 80, big }, rig: null,
        damage: (v) => { hp -= v; },
      };
      b.p.gripEnemy = e;
      b.p._liftPoint.copy(e.position);
      b.ctx.enemies = [e];
      for (let i = 0; i < 180; i++) { b.ctx.time = i / 60; b.p._updateGrip(1 / 60, b.ctx); }
      const lost = (maxHp - hp) / maxHp;
      assert(lost > 0.01, `${name}: three seconds of being held off the ground cost it ${(lost * 100).toFixed(1)}% — nothing is happening`);
      assert(e.chokeT > 2.9, `${name}: the choke timer reached ${e.chokeT.toFixed(2)}s in three seconds of holding`);
      rows.push(`${name} ${(lost * 100).toFixed(0)}%/3s`);
    }
    // …and the same fraction on both, allowing for the big body's half rate
    const [a, c] = rows.map((r) => parseFloat(r.split(' ')[1]));
    assert(Math.abs(a / 2 - c) < a * 0.15,
      `a big body took ${c}% where the half-rate rule says about ${(a / 2).toFixed(0)}% — the rate is not a fraction of max hp`);
    // and letting go clears it
    const b2 = bench();
    const e2 = { maxHp: 100, dead: false, gripped: true, chokeT: 4, liftTarget: {}, position: new THREE.Vector3(), A: { mass: 80 }, damage() {} };
    b2.p.gripEnemy = e2;
    b2.p.releaseGrip();
    assert(e2.chokeT === 0 && !e2.gripped, 'letting go left the victim mid-choke');
    return rows.join(', ');
  });

  check('force: heal is three seconds you have to survive, not a button', () => {
    /*
     * An instant heal is simply more health. The whole design is the channel:
     * it costs time standing still with your hands down, and a single hit ends
     * it. Four things, and the third is the one that makes it a decision.
     */
    const b = bench({ force: 200 });
    b.p.hp = 40;
    b.p.forceHeal(b.ctx);
    assert(b.p.healing === 0, 'force heal did not start');
    for (let i = 0; i < 30; i++) { b.ctx.time = i / 60; b.p._updateHeal(1 / 60, b.ctx); }
    const half = b.p.hp;
    assert(half > 40 && half < 40 + b.p.maxHp * 0.45,
      `half a second in, hp went 40 → ${half.toFixed(1)} — a channel does not pay out all at once`);
    for (let i = 0; i < 200; i++) { b.ctx.time = 0.5 + i / 60; b.p._updateHeal(1 / 60, b.ctx); }
    assert(b.p.healing === null, 'the channel never finished');
    const healed = b.p.hp - 40;
    assert(healed > b.p.maxHp * 0.40, `a completed heal restored ${healed.toFixed(0)} of ${b.p.maxHp}`);
    assert(b.p.force < 200, 'the heal cost no Force at all');

    // interrupted by a hit
    const c = bench({ force: 200 });
    c.p.hp = 40;
    c.p.forceHeal(c.ctx);
    for (let i = 0; i < 30; i++) { c.ctx.time = i / 60; c.p._updateHeal(1 / 60, c.ctx); }
    c.p.hp -= 5;                                   // a bolt lands
    c.p._updateHeal(1 / 60, c.ctx);
    assert(c.p.healing === null, 'taking a hit did not break the channel');
    assert(c.notices.some((n) => /broke/i.test(n.title)), 'the broken channel said nothing');

    // at full health it refuses, out loud
    const d = bench({ force: 200 });
    d.p.forceHeal(d.ctx);
    assert(d.notices.length === 1 && /whole/i.test(d.notices[0].sub),
      `healing at full health said ${JSON.stringify(d.notices)}`);
    return `40 → ${b.p.hp.toFixed(0)} hp over 3s for ${(200 - b.p.force).toFixed(0)} Force; a hit breaks it`;
  });

  check('force: the stasis field can send every bolt back to whoever fired it', () => {
    /**
     * The field had ONE answer — everything at the thing under your reticle —
     * and that is the right one when a squad has walked into a crossfire you
     * can point somewhere. It is the wrong one when six of them have shot at you
     * from six directions, which is exactly the situation the field is easiest
     * to catch. So `hurl` still throws the whole field at the aim, and pressing
     * the stasis key again returns every bolt to its own shooter.
     *
     * `owner` was already on every bolt — BoltPool.fire takes one — and nothing
     * had ever read it back. This check is what makes that field load-bearing:
     * three bolts from three different places have to leave along three
     * different vectors, which is a thing no aimed volley can do.
     */
    const b = bench({ force: 500 });
    const shooters = [
      { dead: false, position: new THREE.Vector3(10, 0, 0), chestY: 1.2, A: { scale: 1 } },
      { dead: false, position: new THREE.Vector3(-10, 0, 0), chestY: 1.2, A: { scale: 1 } },
      { dead: false, position: new THREE.Vector3(0, 0, 12), chestY: 1.2, A: { scale: 1 } },
    ];
    const released = [];
    b.ctx.bolts = { release: (bolt, dir, speed) => released.push({ bolt, dir: dir.clone(), speed }) };
    b.ctx.enemies = shooters;
    const S = b.p.stasis;
    S.active = true;
    S.point.set(0, 1.2, 4);
    S.held = shooters.map((o, i) => ({ bolt: {
      active: true, pos: new THREE.Vector3(i - 1, 1.2, 1), vel: new THREE.Vector3(0, 0, 1),
      speed: 90, damage: 8, life: 1, owner: o, team: 1, held: null,
    } }));
    b.p.releaseStasis(b.ctx, true, true);
    for (let i = 0; i < 40; i++) b.p._flushStasisFire(1 / 60, b.ctx);
    assert(released.length === 3, `${released.length} of 3 bolts left the field`);
    // each one points at its OWN shooter
    for (let i = 0; i < 3; i++) {
      const want = shooters[i].position.clone().sub(released[i].bolt.pos).normalize();
      const dot = want.dot(released[i].dir);
      assert(dot > 0.9,
        `bolt ${i} left ${(Math.acos(Math.min(1, dot)) * 180 / Math.PI).toFixed(0)}° away from the enemy that fired it`);
    }
    // and they are genuinely three different directions, which an aimed volley is not
    const spread = Math.max(
      ...released.map((r, i) => Math.max(...released.map((q, j) => i === j ? 0 : r.dir.angleTo(q.dir)))));
    assert(spread > 1.0,
      `the three bolts left within ${(spread * 180 / Math.PI).toFixed(0)}° of each other — they are not going back to senders`);
    // …while the aimed release still puts them all on one line
    const c = bench({ force: 500 });
    const hit = [];
    c.ctx.bolts = { release: (bolt, dir) => hit.push(dir.clone()) };
    c.ctx.enemies = shooters;
    const S2 = c.p.stasis;
    S2.active = true; S2.point.set(0, 1.2, 4);
    S2.held = S.firing.length ? [] : shooters.map((o, i) => ({ bolt: {
      active: true, pos: new THREE.Vector3(i - 1, 1.2, 1), vel: new THREE.Vector3(0, 0, 1),
      speed: 90, damage: 8, life: 1, owner: o, team: 1, held: null,
    } }));
    c.p.releaseStasis(c.ctx, true, false);
    for (let i = 0; i < 40; i++) c.p._flushStasisFire(1 / 60, c.ctx);
    const aimedSpread = Math.max(
      ...hit.map((r, i) => Math.max(...hit.map((q, j) => i === j ? 0 : r.angleTo(q)))));
    assert(aimedSpread < spread,
      `the aimed volley spread ${(aimedSpread * 180 / Math.PI).toFixed(0)}° against return-to-sender's `
      + `${(spread * 180 / Math.PI).toFixed(0)}° — the two modes are the same mode`);
    return `return to sender: 3 bolts, ${(spread * 180 / Math.PI).toFixed(0)}° apart; `
      + `aimed volley: ${(aimedSpread * 180 / Math.PI).toFixed(0)}° apart`;
  });

  check('force: a body held in front of you stops the bolts', () => {
    /**
     * The grip could lift an enemy or a crate and hold it between the player
     * and a firing line, and the bolts went straight through into the player.
     * `World._boltHitTest` knows about players and about enemies, and a held
     * thing is neither: a bolt aimed at the PLAYER returns on the player's own
     * capsule before the enemy loop is ever reached.
     *
     * Four properties, and the third is the one that keeps it from being an
     * invulnerability window.
     */
    const b = bench({ force: 500 });
    const hits = [];
    const held = {
      dead: false, gripped: true, liftTarget: null, chokeT: 0, maxHp: 200,
      radius: 0.4, A: { mass: 80, scale: 1 },
      position: new THREE.Vector3(),
      damage: (v, at, from, kind) => { hits.push({ v, kind }); },
    };
    b.p.gripEnemy = held;

    // 1. in front and close: it is a shield
    held.position.set(0, 0, -1.6);
    b.p.chest.set(0, 1.2, 0);
    const s1 = b.p.shieldBody();
    assert(s1, 'a body held 1.6 m in front of the chest is not offered as cover at all');
    assert(s1.victim === held, 'the shield names the wrong victim');

    // 2. what it stops, it TAKES
    s1.take(24, new THREE.Vector3(0, 1.2, -1.6), null);
    assert(hits.length === 1 && hits[0].v > 0,
      `the shield ate a 24-point bolt and passed ${JSON.stringify(hits)} to the thing being held`);
    assert(hits[0].v >= 24 * 0.5,
      `the held body took only ${hits[0].v} of a 24-point bolt — cover that does not suffer is invulnerability`);

    // 3. reach: a body dangling behind your shoulder covers nothing
    held.position.set(0, 0, 9);
    assert(!b.p.shieldBody(),
      'a body held nine metres away still counts as cover — that is an aura, not a shield');

    // 4. and nothing held is nothing to hide behind
    b.p.gripEnemy = null;
    assert(!b.p.shieldBody(), 'the player is shielded by a body they are not holding');
    return `cover at 1.6 m, none at 9 m, and it takes ${hits[0].v.toFixed(0)} of a 24-point bolt`;
  });

  check('force: the bolt test asks the shield before it asks the player', async () => {
    /*
     * ORDER IS THE WHOLE FIX. `_boltHitTest` returns on the first thing it
     * finds, so a shield tested after the player's capsule can never fire — the
     * player has already been hit and the function has already returned. This
     * is checked against the source because the alternative is standing up a
     * whole World, and the property is positional: the shield block has to come
     * before the `segmentNear(from, to, _v1, _v2, 0.36)` that tests the player.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const test = src.slice(src.indexOf('_boltHitTest(bolt, from, to)'));
    const shield = test.indexOf('shieldBody');
    const player = test.indexOf('segmentNear(from, to, _v1, _v2, 0.36)');
    assert(shield >= 0, 'World._boltHitTest never asks for a held body — the shield cannot fire');
    assert(player >= 0, 'the player capsule test has moved; this check is looking at the wrong line');
    assert(shield < player,
      'the shield is tested AFTER the player capsule, so the bolt has already hit the player and returned');
    return 'shield tested before the player capsule';
  });
}
