/**
 * BATTLEFRONT BORZ — the five forms, and the authored data that nothing read.
 *
 * A duel is supposed to be five different fights. What shipped was one fight
 * with five different wind-up timings, because every term that was meant to
 * distinguish them had been authored and then never wired to anything:
 *
 *   FORMS[*].spacing   five distinct bands, and the only reader in the tree
 *                      was `dist < F.spacing[1]` — a range check, not
 *                      footwork. `spacing[0]` had no reader at all, and every
 *                      duellist stood in its ARCHETYPE's `preferred` band, so
 *                      all five forms fought at 1.59–1.62 m.
 *   FORMS.ataru.mobile no reader anywhere.
 *   FORMS[*].saberColour  no reader anywhere, and identical (4) on all five.
 *   FORMS.juyo.erratic driven through `_pick`, which re-rolled a uniform draw
 *                      into another uniform draw — the identity function.
 *   TIER.guardBreak    three tiers author it; one branch read one of them, so
 *                      putting your blade in front of an UNBLOCKABLE cost 10
 *                      stamina against a lost light clash's 14.
 *   player.chambers    counted since chambering shipped, read by nothing.
 *
 * And one live defect found in the same sweep: `DuelBrain.interrupt` set
 * `phase = 'recover'` unconditionally, so `_finish('player')` — winning a
 * blade lock — created a stagger and then erased it two lines later.
 *
 * What is measured here is the property in each case, not the constant.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng } from '../../src/game/Enemy.js';
import { DuelBrain, FORMS, FORM_KEYS, TIER, ATTACKS, duelRng } from '../../src/game/Duel.js';
import { World } from '../../src/game/World.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/** A world with just enough in it to run one duellist against one body. */
function arena() {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat();
  physics.terrain = terrain;
  const target = {
    position: V(0, 0, 0), velocity: new THREE.Vector3(), chest: V(0, 1.3, 0),
    hp: 5000, maxHp: 5000, alive: true, invuln: 0, crouch: 0, radius: 0.34,
    stamina: 100, maxStamina: 100, staggerTimer: 0,
    camera: { addShake() {} }, damage() {},
  };
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    plasma: { spawn() {} }, smoke: { spawn() {} } };
  const world = {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [target], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  return { world, target, particles };
}

/**
 * Where a duellist of `form` actually stands over a real fight, how often it
 * commits, and where in its own authored band it spends its time.
 *
 * One run answers four questions because a run is the expensive thing in this
 * file: three checks want the stand-off, the cadence and the band, and driving
 * a real Enemy for a minute per form three times over is three minutes of CPU
 * for one minute of measurement.
 */
function standOff(form, seconds = 60) {
  enemyRng.seed(4711);
  duelRng.seed(8123);
  const { world, target, particles } = arena();
  const e = new Enemy(world, 'acolyte', V(0, 0, -6));
  e.position.set(0, 0, -6);
  if (e.duel) e.duel.form = FORMS[form];
  world.enemies.push(e);
  const ctx = { enemies: world.enemies, particles, terrain: world.terrain, physics: world.physics,
    bolts: world.bolts, time: 0, pickTarget: () => target, camera: world.engine.camera };
  const dt = 1 / 60;
  let sum = 0, n = 0, min = Infinity, max = 0, declared = 0, was = 'guard';
  const dists = [];
  for (let i = 0; i < seconds / dt; i++) {
    ctx.time = world.time += dt;
    e.update(dt, ctx);
    target.hp = 5000;
    world.physics.step(dt);
    if (e.duel.phase === 'windup' && was !== 'windup') declared++;
    was = e.duel.phase;
    if (i > 120) {                                  // let it close the gap first
      const d = e.position.distanceTo(target.position);
      sum += d; n++; min = Math.min(min, d); max = Math.max(max, d);
      dists.push(d);
    }
  }
  for (const x of world.enemies) x.dispose?.();
  dists.sort((a, b) => a - b);
  return { mean: sum / n, min, max, declared, perSec: declared / seconds,
    p10: dists[Math.floor(dists.length * 0.1)], p90: dists[Math.floor(dists.length * 0.9)] };
}

/* One 60-second fight per form, shared by the three checks that want one. */
const _stand = new Map();
const stats = (k) => {
  if (!_stand.has(k)) _stand.set(k, standOff(k));
  return _stand.get(k);
};

/** A DuelBrain with just enough of an owner to phase and stagger. */
function brain(formKey = 'makashi') {
  const e = { saberPhase: 'guard', saberTimer: 0, facing: 0 };
  return new DuelBrain(e, { form: formKey });
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  await initPhysics();

  check('forms: a form has a rhythm, and only Juyo will not hold one', () => {
    /**
     * `_pick` was:
     *
     *     let key = F.moves[…uniform…];
     *     if (F.erratic && rng() < F.erratic * 0.4) key = F.moves[…uniform…];
     *
     * Re-rolling a uniform variable returns the same distribution, so the
     * second line was the identity and every form drew independently every
     * time. A rhythm is a CONDITIONAL distribution — what comes next given
     * what just came — and independent draws cannot have one, which is why
     * this measures P(next | last) rather than the shape of the code.
     */
    const rows = [];
    for (const k of FORM_KEYS) {
      duelRng.seed(8123);
      const F = FORMS[k];
      const b = brain(k);
      const moves = F.moves;
      let inRhythm = 0, n = 0, last = null;
      for (let i = 0; i < 20000; i++) {
        const got = b._pick();
        assert(moves.includes(got), `${k} picked ${got}, which is not one of its moves`);
        if (last != null) {
          const expected = moves[(moves.indexOf(last) + 1) % moves.length];
          if (got === expected) inRhythm++;
          n++;
        }
        last = got;
      }
      const p = inRhythm / n;
      const uniform = 1 / moves.length;
      if (F.erratic) {
        assert(p < 0.45,
          `${F.name} is authored erratic and still plays the move its order implies ${(p * 100).toFixed(1)}% `
          + 'of the time — the rhythm it is supposed to break is intact');
        assert(p > uniform * 1.3,
          `${F.name} picks at ${(p * 100).toFixed(1)}% against a uniform ${(uniform * 100).toFixed(1)}% — it has `
          + 'no rhythm at all to trap you with, which is not the same thing as breaking one');
      } else {
        assert(p > 0.6,
          `${F.name} plays the move its order implies only ${(p * 100).toFixed(1)}% of the time `
          + `(uniform is ${(uniform * 100).toFixed(1)}%) — there is nothing here for a player to learn`);
      }
      rows.push(`${k} ${(p * 100).toFixed(0)}%/${(uniform * 100).toFixed(0)}%`);
    }
    return `P(in rhythm) vs uniform: ${rows.join(', ')}`;
  });

  check('forms: the five forms fight at five distances, and Ataru will not hold one', () => {
    /* Before: 1.59, 1.62, 1.62, 1.61, 1.59 — five forms, one distance, to
     * within 3 cm, because footwork read the archetype's `preferred` band and
     * `FORMS[*].spacing[0]` had no reader in the game at all. */
    const got = {};
    for (const k of FORM_KEYS) got[k] = stats(k);

    for (const k of FORM_KEYS) {
      const want = FORMS[k].spacing;
      const r = got[k];
      if (FORMS[k].mobile) continue;                // asserted on its own terms below
      assert(Math.abs(r.mean - want[0]) < 0.45,
        `${FORMS[k].name} holds ${r.mean.toFixed(2)} m against an authored near edge of ${want[0]} m — `
        + 'its spacing is not what is putting its feet anywhere');
    }
    const held = FORM_KEYS.filter((k) => !FORMS[k].mobile).map((k) => got[k].mean);
    const spread = Math.max(...held) - Math.min(...held);
    assert(spread > 0.15,
      `the disciplined forms stand within ${(spread * 100).toFixed(0)} cm of each other — they are one `
      + 'fighter in five costumes');

    const mobile = FORM_KEYS.filter((k) => FORMS[k].mobile);
    assert(mobile.length > 0, 'no form is authored `mobile` any more');
    for (const k of mobile) {
      const r = got[k], band = FORMS[k].spacing;
      assert(r.max - r.min > (band[1] - band[0]) * 0.6,
        `${FORMS[k].name} is authored mobile across [${band}] and worked a ${(r.max - r.min).toFixed(2)} m `
        + 'band — it is holding a line like everything else');
    }
    return FORM_KEYS.map((k) => `${k} ${got[k].mean.toFixed(2)}m`).join(', ');
  });

  check('forms: no two forms are one fight at two volumes', () => {
    /**
     * MAKASHI AND SORESU WERE THE SAME FIGHT AT TWO SETTINGS.
     *
     * A player does not experience a form as its wind-up times. They experience
     * it as an ANSWER PROFILE: what share of what it throws must be met with
     * the blade, what share can only be countered, what share must be got out
     * of the way of, how far out it fights, and how fast it comes. Measured on
     * that profile, makashi↔soresu was the closest pair on the roster and each
     * was the other's nearest neighbour — 100% parryable both, 7 cm apart,
     * three of the same five moves. Two forms that differ only in volume are
     * one form, and these are the two the source material is most specific
     * about being opposites.
     *
     * EVERY AXIS IS MEASURED THROUGH THE SHIPPED CODE. The tier shares come
     * from driving `DuelBrain._pick` — the chooser the game uses, including its
     * rhythm walk, so the share reported is the share thrown and not the share
     * the move list implies. The stand-off and the cadence come from a real
     * Enemy fighting for a minute.
     *
     * THE BOUND IS THE ROSTER'S OWN SPREAD, not a number. Each axis is
     * normalised by the range the five forms cover on it, so the profile is in
     * units of "as different as these forms get", and the failure is a pair
     * that is closer than half the typical pair. A hand-picked distance would
     * be a bound written from today's five, and adding a sixth form would move
     * what "different" means without moving the number.
     */
    const rows = FORM_KEYS.map((k) => {
      duelRng.seed(8123);
      const b = brain(k);
      const share = { light: 0, heavy: 0, unblockable: 0 };
      const N = 20000;
      for (let i = 0; i < N; i++) share[ATTACKS[b._pick()].tier]++;
      const fight = stats(k);
      return {
        k,
        parry: share.light / N,
        chamberOnly: share.heavy / N,
        evadeOnly: share.unblockable / N,
        standOff: fight.mean,
        tempo: fight.perSec,
      };
    });
    const AXES = ['parry', 'chamberOnly', 'evadeOnly', 'standOff', 'tempo'];
    const span = {};
    for (const a of AXES) {
      const xs = rows.map((r) => r[a]);
      span[a] = Math.max(...xs) - Math.min(...xs) || 1;
    }
    const pairs = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        let s = 0;
        for (const a of AXES) s += ((rows[i][a] - rows[j][a]) / span[a]) ** 2;
        pairs.push({ a: rows[i].k, b: rows[j].k, d: Math.sqrt(s) });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    const median = pairs[Math.floor(pairs.length / 2)].d;
    const worst = pairs[0];
    assert(worst.d > median * 0.5,
      `${worst.a} and ${worst.b} are ${worst.d.toFixed(3)} apart on the answer profile against a `
      + `median pair's ${median.toFixed(3)} — they are one fight at two volumes. Profiles: `
      + rows.map((r) => `${r.k} parry ${(r.parry * 100) | 0}% / chamber ${(r.chamberOnly * 100) | 0}% `
        + `/ evade ${(r.evadeOnly * 100) | 0}% / ${r.standOff.toFixed(2)} m / ${r.tempo.toFixed(2)}/s`).join('; '));
    /* …and every form has to be SOMEBODY's opposite as well as nobody's twin:
     * a roster where four forms are identical and one is strange would satisfy
     * the clause above on the median alone. */
    for (const r of rows) {
      const mine = pairs.filter((p) => p.a === r.k || p.b === r.k);
      assert(Math.min(...mine.map((p) => p.d)) > median * 0.5,
        `${r.k}'s nearest neighbour is inside half the median pair`);
    }
    return `closest pair ${worst.a}/${worst.b} ${worst.d.toFixed(2)}, median ${median.toFixed(2)}; `
      + rows.map((r) => `${r.k} ${(r.parry * 100) | 0}/${(r.chamberOnly * 100) | 0}/`
        + `${(r.evadeOnly * 100) | 0}% ${r.standOff.toFixed(2)}m ${r.tempo.toFixed(2)}/s`).join(', ');
  });

  check('forms: interrupt cannot put a beaten guard back on line', () => {
    /**
     * `_finish('player')` — winning a blade lock, the largest opening the game
     * offers — ran `e.stun(1.15)` and then `e.duel?.interrupt(1.0)` two lines
     * later, and `interrupt` set `phase = 'recover'` unconditionally. So the
     * reward for overpowering a lock was a duellist standing at rest with its
     * guard exactly where it started. World's chamber and parry paths happen
     * to interrupt BEFORE they stun, which is the only reason this was
     * invisible everywhere else.
     */
    const b = brain();
    b.stagger(0.9, V(1, 0, 0), 1.2);
    assert(b.staggered, 'stagger did not take');
    const held = b.timer;
    b.interrupt(1.0);
    assert(b.staggered,
      'interrupt() turned a live stagger back into a recover — beating a blade aside now buys nothing');
    assert(b.timer === held, `interrupt() shortened the stagger from ${held} to ${b.timer}`);

    // …and it still does its job on a duellist that is not staggered.
    const c = brain();
    c.phase = 'windup';
    c.attack = { label: 'x' };
    c.interrupt(0.4);
    assert(c.phase === 'recover' && c.attack === null, 'interrupt no longer interrupts anything');
    return 'a stagger outranks a recover in both directions';
  });

  check('forms: a guard opens on the side it was beaten from', () => {
    /**
     * `stagger(seconds, worldDir, power)` was written to throw the guard to the
     * side the blade was actually driven and to scale the throw by how hard.
     * All eleven callers passed a duration and nothing else, so `worldDir` was
     * null at every site and `power` was 1 at every site: a beat from the left
     * and a beat from the right produced the same opening on the same side.
     *
     * Driven through `Enemy.damage`, which is a real caller, rather than
     * through `stagger` directly — the argument list was never the thing that
     * was broken.
     */
    enemyRng.seed(4711);
    duelRng.seed(8123);
    const { world, target } = arena();
    const e = new Enemy(world, 'acolyte', V(0, 0, -3));
    e.position.set(0, 0, -3);
    e.facing = 0;
    world.enemies.push(e);
    assert(e.duel, 'an acolyte has no duel brain');

    const beat = (from) => {
      e.hp = e.maxHp;
      e.stunTimer = 0;
      e.duel.phase = 'guard';
      e.duel.timer = 0;
      e.duel.staggerDir = null;
      e.damage(e.maxHp * frac, from, { position: from }, 'saber');
      assert(e.duel.staggered, `a ${(frac * 100) | 0}% blow did not stagger the duellist at all`);
      return { dir: e.duel.staggerDir.clone(), held: e.duel.timer };
    };
    let frac = 0.5;
    const left = beat(V(-4, 1, -3));
    const right = beat(V(4, 1, -3));
    assert(Math.sign(left.dir.x) !== Math.sign(right.dir.x),
      `beaten from the left the guard went to x=${left.dir.x.toFixed(2)} and from the right `
      + `x=${right.dir.x.toFixed(2)} — the same side both times, so \`worldDir\` is not reaching stagger()`);

    // …and `power` is doing something too. The direction is normalised, so the
    // width it buys is small by construction; the LENGTH is where it reads.
    frac = 0.24;
    const light = beat(V(4, 1, -3));
    assert(light.held < right.held - 0.02,
      `a 24% blow left the guard out of line for ${light.held.toFixed(2)} s and a 50% blow for `
      + `${right.held.toFixed(2)} s — \`power\` is not reaching stagger() either`);
    assert(Math.abs(light.dir.x) < Math.abs(right.dir.x) - 1e-4,
      'and the lighter blow did not throw the guard any narrower either');
    for (const x of world.enemies) x.dispose?.();
    return `left ${left.dir.x.toFixed(2)}, right ${right.dir.x.toFixed(2)}; `
      + `a 50% blow holds the guard open ${right.held.toFixed(2)} s against a 24% blow's ${light.held.toFixed(2)} s`;
  });

  check('forms: one implementation of an enemy blade meeting a body', async () => {
    /**
     * World inlined a second copy of the hit test that disagreed with
     * `Enemy._saberStrike` on every term that matters: an unswept `segmentNear`
     * on the tip alone at r = 0.44 against a swept eight-substep
     * segment-segment on the whole blade; no rally multiplier on the damage;
     * no crouch; no `bladesTouching` stand-down; and `interrupt(0.45)` after a
     * connected hit, which is exactly the behaviour `DuelBrain.followUp` was
     * written to replace. The two never double-hit — a real hit ends the
     * strike phase — so the copy only ever fired when the accurate test had
     * decided the swing MISSED.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/attackDamage/.test(code),
      'World is reading `attackDamage` again — that is the enemy-blade-hits-body test coming back');
    assert(/_saberStrike\(/.test(code),
      'World no longer calls Enemy._saberStrike, so nothing tests an enemy blade against a player '
      + 'who is not that enemy\'s own target — which in co-op is most of the room');

    // and the one that remains still lands, on a target it was not aiming at
    enemyRng.seed(4711);
    duelRng.seed(8123);
    const { world, particles } = arena();
    const e = new Enemy(world, 'acolyte', V(0, 0, -2));
    e.position.set(0, 0, -2);
    world.enemies.push(e);
    let hits = 0;
    const bystander = {
      position: V(0, 0, 0), velocity: new THREE.Vector3(), chest: V(0, 1.3, 0),
      hp: 5000, maxHp: 5000, alive: true, invuln: 0, crouch: 0, radius: 0.34,
      camera: { addShake() {} }, damage() { hits++; },
    };
    const ctx = { enemies: world.enemies, particles, terrain: world.terrain, physics: world.physics,
      bolts: world.bolts, time: 0, pickTarget: () => world.players[0], camera: world.engine.camera };
    const dt = 1 / 60;
    for (let i = 0; i < 60 / dt; i++) {
      ctx.time = world.time += dt;
      world.players[0].position.set(0, 0, 0);
      // The duellist's OWN target is untouchable, so its in-update strike never
      // claims the once-per-swing flag — which is the co-op case exactly: the
      // person it is fighting is not the only person standing in the arc.
      world.players[0].invuln = 1;
      e.update(dt, ctx);
      e._saberStrike(null, bystander);
      world.physics.step(dt);
    }
    for (const x of world.enemies) x.dispose?.();
    assert(hits > 0,
      'the surviving hit test landed nothing on a body standing in the arc over 60 s — deleting World\'s '
      + 'copy deleted the mechanic');
    return `World delegates to _saberStrike; ${hits} hits on a bystander in 60 s`;
  });

  check('forms: every tier of guard break costs what it says, driven through the real clash', () => {
    /**
     * `TIER.guardBreak` is authored three ways — 0.6 / 1.9 / 3.2 — and exactly
     * one branch of `_applyClash` read exactly one of them. The other two rows
     * had no reader in the game, and verify.mjs asserted only that the three
     * were in increasing order, which a table nobody reads satisfies for free.
     * So putting your blade in front of an UNBLOCKABLE — the red arc, whose
     * whole meaning is "your blade is not the answer" — cost a flat 10
     * stamina, against the 14 a lost light clash cost. The cheapest mistake in
     * the game was the one the colour was screaming about.
     *
     * Driven through the SHIPPED `World.prototype._applyClash`, so the numbers
     * measured are the ones the player pays.
     */
    assert(TIER.unblockable.guardBreak > TIER.heavy.guardBreak
        && TIER.heavy.guardBreak > TIER.light.guardBreak,
      'guard-break no longer scales with tier');

    const cost = (tierKey) => {
      const w = Object.create(World.prototype);
      Object.assign(w, {
        time: 10, locks: [],
        particles: { cutFlare() {}, sparkBurst() {}, slag() {} },
        engine: { flash() {}, addHeat() {} },
        addHitstop() {}, notifyFloating() {}, report() {},
        onDeflectFeedback() {},
      });
      const duel = Object.create(DuelBrain.prototype);
      Object.assign(duel, {
        e: { facing: 0 }, chamberOpen: false, phase: 'windup',
        attack: { ...ATTACKS.slashR }, chainLeft: 0, telegraph: null,
        followUp() {}, interrupt() {},
      });
      Object.defineProperty(duel, 'timer', { set(v) { this._t = v; }, get() { return this._t; } });
      Object.defineProperty(duel, 'tier', { value: TIER[tierKey] });
      const zero = new THREE.Vector3();
      const player = {
        saber: { strain() {}, pointAt: (t, o) => o.set(0, 1.2, -1.4),
          baseVelocity: zero.clone(), tipVelocity: zero.clone(),
          color: { getHex: () => 0x4fc3ff } },
        camera: { addShake() {} }, control: { hitImpulse() {} },
        boonMods: {}, score: 0, stamina: 100, maxStamina: 100, staggerTimer: 0,
        riposteTimer: 0, addFlow() {},
        position: new THREE.Vector3(), velocity: new THREE.Vector3(), damage() {}, invuln: 0,
      };
      const enemy = {
        duel, saber: { strain() {}, color: { getHex: () => 0xff5a4a } },
        stun() {}, position: V(0, 0, -2), attackDamage: 8,
      };
      // A losing clash: the player's blade is not moving, the enemy's is.
      w._applyClash(player, enemy, {
        point: V(0, 1.3, -1), power: 0.8, normal: V(0, 1, 0), winner: 'b', sb: 9, type: 'clash',
      });
      return 100 - player.stamina;
    };

    const paid = { light: cost('light'), heavy: cost('heavy'), unblockable: cost('unblockable') };
    for (const k of Object.keys(TIER)) {
      assert(paid[k] > 0, `a lost ${k} exchange cost no stamina at all`);
    }
    assert(paid.unblockable > paid.heavy && paid.heavy > paid.light,
      `a lost exchange costs ${paid.light} / ${paid.heavy} / ${paid.unblockable} stamina for `
      + 'light / heavy / unblockable — the colour of the arc is not the size of the mistake');
    for (const k of Object.keys(TIER)) {
      const ratio = paid[k] / TIER[k].guardBreak;
      assert(Math.abs(ratio - paid.light / TIER.light.guardBreak) < 0.5,
        `the ${k} tier is not being charged through guardBreak — ${paid[k]} stamina against an `
        + `authored ${TIER[k].guardBreak}`);
    }
    return 'a lost exchange costs '
      + `${paid.light.toFixed(1)}, ${paid.heavy.toFixed(1)}, ${paid.unblockable.toFixed(1)} stamina `
      + '(light, heavy, unblockable) out of 100';
  });

  check('forms: no field is authored on a form that nothing reads', async () => {
    /**
     * `saberColour: 4` sat on all five forms — the same value on every one, so
     * even a reader would have shown nothing — and was read by nothing in the
     * tree. This is the check that would have caught it, and `mobile`, and
     * `spacing[0]`: enumerate what the table declares and go looking for a
     * reader outside the table itself.
     */
    const { readFile, readdir } = await import('node:fs/promises');
    const dir = new URL('../../src/', import.meta.url);
    const files = [];
    const walk = async (d) => {
      for (const ent of await readdir(d, { withFileTypes: true })) {
        const u = new URL(ent.name + (ent.isDirectory() ? '/' : ''), d);
        if (ent.isDirectory()) await walk(u);
        else if (ent.name.endsWith('.js')) files.push(u);
      }
    };
    await walk(dir);

    const duelSrc = await readFile(new URL('../../src/game/Duel.js', import.meta.url), 'utf8');
    const table = duelSrc.slice(duelSrc.indexOf('export const FORMS'),
      duelSrc.indexOf('export const FORM_KEYS'));

    let corpus = '';
    for (const f of files) {
      const s = await readFile(f, 'utf8');
      corpus += (f.pathname.endsWith('Duel.js') ? s.replace(table, '') : s);
    }
    corpus = corpus.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    /**
     * READ OFF A FORM, and not merely present as a word.
     *
     * This was `\b${key}\b` against every .js file in `src/` with only the
     * table itself cut out — a bare word-boundary match over eight megabytes of
     * source, and the words are ordinary English. Measured outside the table:
     * `strength` 137 times, `strike` 38, `moves` 26, `tell` 22, `windup` 20.
     * So deleting `if (rng() < F.feint) this._beginFeint(sp)` — feints stop
     * existing — left this green on `DUEL_PHASES`'s own `'feint'` string, and
     * `F.chain` was covered by `SLASH.chain` in a different file entirely.
     * Roughly half the table was unguardable.
     *
     * A form is bound to `F`, `form` or `this.form` and to nothing else in the
     * tree, so a reader has to be a member access off one of those. It found a
     * real dead field the moment it was tightened: `tell`, five authored
     * sentences on how to READ each form, rendered nowhere at all.
     */
    const dead = [];
    for (const key of new Set(FORM_KEYS.flatMap((k) => Object.keys(FORMS[k])))) {
      if (!new RegExp(`\\b(F|form|forms|FORMS\\[[^\\]]*\\])\\s*\\??\\.\\s*${key}\\b`).test(corpus)) dead.push(key);
    }
    assert(dead.length === 0,
      `FORMS authors ${dead.join(', ')} and nothing outside the table reads ${dead.length === 1 ? 'it' : 'them'} — `
      + 'either wire it to something or take it out');
    return `all ${new Set(FORM_KEYS.flatMap((k) => Object.keys(FORMS[k]))).size} authored form fields are read off a form`;
  });

  check('forms: the tell is five different sentences, and the dojo says the one it is sparring', async () => {
    /**
     * WHAT THE FIELD ABOVE FOUND. `tell` is the one sentence per form that says
     * what it LOOKS like from the other side — "erratic — the rhythm is the
     * trap" — and it was authored five times and rendered nowhere, in a game
     * whose training mode exists to teach exactly that. The old reader test
     * could not see it: `tell` is an ordinary English word and appears
     * twenty-two times in `src/` outside the table.
     *
     * FIVE DIFFERENT ONES, first, because that is the `saberColour: 4` defect
     * this suite was written for — a field authored identically on every form
     * teaches nothing even once it is drawn.
     */
    const tells = FORM_KEYS.map((k) => FORMS[k].tell);
    for (const [i, t] of tells.entries()) {
      assert(typeof t === 'string' && t.length > 12,
        `${FORM_KEYS[i]} has no tell worth reading: ${JSON.stringify(t)}`);
    }
    assert(new Set(tells).size === tells.length,
      `${tells.length} forms share ${new Set(tells).size} tells — a field with one value teaches nothing`);

    /* AND IT REACHES THE PANEL. The coach line is the only surface in the game
     * that names a form at all, so it is the only place this can be true. */
    const { makeDocument } = await import('./_page.mjs');
    const { HUD } = await import('../../src/ui/HUD.js');
    const { readFile } = await import('node:fs/promises');
    const doc = makeDocument(await readFile(new URL('../../index.html', import.meta.url), 'utf8'));
    const restore = doc.install();
    try {
      const hud = new HUD(doc);
      const state = { title: 'The bind', need: 3, progress: 1, index: 2, total: 11,
                      brief: 'b', hint: 'push through it', form: 'Juyo VII', formTell: FORMS.juyo.tell };
      hud.setCoach(state);
      const line = doc.getElementById('coach-hint').textContent;
      assert(line.includes('Juyo VII'), `the coach line lost the form: "${line}"`);
      assert(line.includes(FORMS.juyo.tell),
        `the coach line names the form and never says how to read it: "${line}"`);
      /* …and a lesson with nobody to spar leaves both off rather than printing
       * a dangling dash, which is what an unguarded append would do. */
      hud.setCoach({ ...state, form: null, formTell: null });
      assert(doc.getElementById('coach-hint').textContent === 'push through it',
        'a lesson with no sparring partner still prints a form line');
      return `5 distinct tells; the panel reads "${line.slice(0, 64)}…"`;
    } finally { restore(); }
  });
}
