/**
 * BATTLEFRONT BORZ — the player's health is a number, and it must stay one.
 *
 * This suite exists because of one line, World.js:614:
 *
 *     p.damage(e.damage * e.duel.damageScale, hit, e, 'saber');
 *
 * `e` is an Enemy. Enemy.damage is a METHOD; the number an enemy DEALS was
 * renamed to attackDamage precisely because the two names collided, and this
 * one caller was left behind. function * number is NaN, Player.damage does
 * `this.hp -= NaN`, and from that moment `hp <= 0` is false forever. The player
 * is immortal for the rest of the run with a blank health bar, on the very path
 * that matters most — an enemy duellist's blade landing on your body. Nothing
 * throws, nothing logs, nothing looks wrong in the source.
 *
 * That is the third time this exact shadowing collision has produced a
 * different silent bug, so this checks the PROPERTY rather than the line:
 * whatever a caller passes, hp stays finite and death stays reachable.
 */
import '../dom-shim.mjs';
import { Player } from '../../src/game/Player.js';
import { Enemy } from '../../src/game/Enemy.js';
import { clocked } from './_shared.mjs';

/** A receiver with just the collaborators Player.damage actually touches. */
/*
 * THE STUB CARRIES THE REAL `resistForce`, not a nulled-out one.
 *
 * `Player.damage` gained a line — `amount -= this.resistForce(amount, kind,
 * source)`, the player's half of the Force contest — after this fixture was
 * written, and the fixture did not have the method. So every check in here
 * that drove `damage` threw `this.resistForce is not a function` before
 * reaching a single assertion: a suite reporting a defect in the game that was
 * really a stub two versions behind the object it stands in for.
 *
 * It is bound to `Player.prototype.resistForce` rather than to `() => 0`
 * because a stub that answers zero is a stub that has quietly turned a feature
 * off, and this suite's whole subject is what `damage` does to `hp` — with the
 * real subtraction in the path or not at all. It reads `alive`, `force` and
 * `staggerTimer`, which is why `force` is here now.
 */
function victim(hp = 100) {
  return {
    alive: true, invuln: 0, hp, difficulty: { damageTaken: 1 },
    world: { training: false, engine: { hurt() {} } },
    flow: 1, combo: 3, staggerTimer: 0, hitFlash: 0, force: 100,
    camera: { addShake() {} }, chest: { x: 0, y: 0, z: 0 },
    resistForce: Player.prototype.resistForce,
    died: false, die() { this.died = true; },
  };
}

/**
 * A world with no GPU and no level, wide enough to kill a real Player in and
 * to stand one back up in. `respawn` rebuilds the rig, so `settings` has to
 * carry what `buildJedi` reads.
 */
function stubWorld(THREE) {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1, robeIndex: 0, hairIndex: 1 },
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
      half: 200, surfaceAt: () => 'sand',
      crater(x, z, r, d) { (this.craters ||= []).push({ x, z, r, d }); } },
    particles: null, bolts: null, time: 0, combatIntensity: 0, training: false,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, setSense() {}, rumble() {},
      setDrain() {}, setBars() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, feelOn: () => true, killTime() {}, setTimeScale() {}, onPlayerDeath() {},
  };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  check('vitals: coming back to life does not land on the people standing there', async () => {
    /**
     * DYING WHILE FALLING WAS A FREE FORCE SLAM AT YOUR REVIVE POINT.
     *
     * `respawn()` reset hp, Force, stamina, velocity and `invuln` — and not
     * `fallSpeed`, and not `diving`. Both are state of the body that just
     * died: `fallSpeed` is the most negative velocity.y since the last contact
     * and `diving` is a commitment only an impact may answer. The next frame
     * `_collide` saw `!wasGrounded && fallSpeed < -7` and fired `_land` AT THE
     * REVIVE POINT, with `dove` true so the DIVE_LAND multiplier was on it.
     * Measured on the shipped code, after a 1 s fall: a trooper 3 m from the
     * spawn went 46 -> 18.7 hp and was thrown at 14.8 m/s, the ground
     * cratered, the camera shook 0.55 — and the player took none of it,
     * because `respawn` sets `invuln = 2.2` two lines further down.
     *
     * `World._reviveDowned` is the reachable path: it is the co-op wave-clear
     * revive, and it runs once per death for the whole session.
     *
     * The property is the one the mode promises: a revive is not an event that
     * happens TO anyone else. Asserted on a bystander's hp rather than on the
     * fields, because a second field with the same problem — a stale
     * `jumpHeld`, a stale dash — would be the same bug again and this has to
     * see it.
     */
    const THREE = await import('three');
    const w = stubWorld(THREE);
    const p = new Player(w, { isLocal: true });
    p.position.set(0, 40, 0);
    const input = { keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
      accel: { x: 0, y: 0 }, bindings: null, moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
      act: () => false, actHit: () => false };
    const bystander = { position: new THREE.Vector3(3, 0, 0), dead: false, hp: 46, knocked: 0,
      applyKnockback(v, dmg) { this.hp -= dmg; this.knocked = v.length(); },
      damage(d) { this.hp -= d; }, stun() {}, platform: () => null };
    const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
      camera: w.engine.camera, time: 0, groundColor: 0, enemies: [bystander] };
    for (let i = 0; i < 60; i++) { ctx.time = w.time = i / 60; p.update(1 / 60, ctx); }
    assert(p.fallSpeed < -20, `the fixture is not falling fast enough to test this (${p.fallSpeed.toFixed(1)})`);

    // …and it died in a dive, which is the worst case: DIVE_LAND is on it.
    p.diving = true;
    let shook = 0;
    p.camera.addShake = () => { shook++; };
    p.respawn(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 10; i++) { ctx.time = w.time += 1 / 60; p.update(1 / 60, ctx); }

    assert(bystander.hp === 46,
      `a bystander 3 m from the revive point went 46 -> ${bystander.hp.toFixed(1)} hp — the fall the player `
      + 'died in arrived at the place they came back to');
    assert(bystander.knocked === 0,
      `the revive threw a bystander at ${bystander.knocked.toFixed(1)} m/s`);
    assert(!(w.terrain.craters || []).length,
      `the revive cratered the ground ${(w.terrain.craters || []).length} time(s)`);
    assert(shook === 0, `the revive shook the camera ${shook} time(s)`);
    assert(p.alive && p.hp === p.maxHp, 'the revive did not actually stand the player back up');
    return `revived mid-fall (${p.fallSpeed.toFixed(2)} fallSpeed, diving ${p.diving}): bystander untouched at `
      + `${bystander.hp} hp, no crater, no shake`;
  });

  check('vitals: an enemy blade deals a NUMBER, not a method', () => {
    // The collision itself. If someone ever puts a `damage` number back on the
    // instance, or renames the method, this is the line that notices.
    assert(typeof Enemy.prototype.damage === 'function',
      'Enemy.damage should be the method that HURTS an enemy');
    const e = Object.create(Enemy.prototype);
    e.attackDamage = 17;
    assert(Number.isFinite(e.attackDamage), 'attackDamage must be the number an enemy deals');
    assert(!Number.isFinite(e.damage * 1),
      'e.damage is somehow numeric — the two names have collided again');
    return `damage() is a ${typeof Enemy.prototype.damage}, attackDamage is ${e.attackDamage}`;
  });

  check('vitals: the duel strike passes the number, and it kills', async () => {
    // Read the real call site rather than trusting that it was fixed once.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const bad = [...src.matchAll(/\be\.damage\s*\*/g)];
    assert(!bad.length, `World.js multiplies e.damage (the method) in ${bad.length} place(s)`);

    // And prove the arithmetic the fixed line performs is lethal.
    const e = Object.create(Enemy.prototype);
    e.attackDamage = 17;
    e.duel = { damageScale: 1.4 };
    const dealt = e.attackDamage * e.duel.damageScale;
    assert(Number.isFinite(dealt) && dealt > 0, `a duel strike deals ${dealt}`);
    const p = victim(20);
    const killed = Player.prototype.damage.call(p, dealt, null, e, 'saber');
    assert(killed && p.died && p.hp === 0, `20 hp minus ${dealt.toFixed(1)} should kill: hp=${p.hp}`);
    return `duel strike deals ${dealt.toFixed(1)}, kills from 20 hp`;
  });

  check('vitals: a bad amount cannot make the player immortal', () => {
    // The hardening, tested the only way that means anything: hand Player.damage
    // the poison directly and prove the player is still killable afterwards.
    for (const poison of [NaN, Infinity, -Infinity, undefined, 'ouch']) {
      const p = victim(60);
      Player.prototype.damage.call(p, poison, null, null, 'test');
      assert(Number.isFinite(p.hp), `hp went non-finite on ${String(poison)}: ${p.hp}`);
      assert(p.hp === 60, `a refused hit should not change hp, got ${p.hp}`);
      p.invuln = 0;
      const killed = Player.prototype.damage.call(p, 999, null, null, 'test');
      assert(killed && p.died, `after ${String(poison)} the player survived 999 damage`);
    }
    return 'NaN, ±Infinity, undefined and a string all refused; death still reachable after each';
  });

  check('vitals: nothing else does arithmetic on a method', async () => {
    // The general form. Collect every prototype method name in src/, then look
    // for that name being multiplied or subtracted somewhere. Reads that are
    // legitimately numeric on PLAIN objects (bolt.damage) are the common case,
    // so this only complains when the receiver is named like a class instance
    // that actually owns the method — which is what makes it quiet enough to
    // be worth having.
    const { readdir, readFile } = await import('node:fs/promises');
    const root = new URL('../../src/', import.meta.url);
    const files = [];
    const walk = async (dir, prefix) => {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const u = new URL(ent.name + (ent.isDirectory() ? '/' : ''), dir);
        if (ent.isDirectory()) await walk(u, prefix + ent.name + '/');
        else if (ent.name.endsWith('.js')) files.push([prefix + ent.name, await readFile(u, 'utf8')]);
      }
    };
    await walk(root, '');

    // Receivers that are known to BE an enemy at the call site. Anything else
    // (bolt, prop, boon) legitimately carries plain numeric fields.
    const ENEMY_VARS = ['e', 'en', 'enemy', 'target', 'foe'];
    const METHODS = ['damage', 'die', 'update', 'stagger', 'sever'];
    const hits = [];
    for (const [path, text] of files) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const v of ENEMY_VARS) {
        for (const m of METHODS) {
          const re = new RegExp(`\\b${v}\\.${m}\\s*[*+\\-/]\\s*[\\w(]`, 'g');
          for (const hit of code.matchAll(re)) {
            const line = code.slice(0, hit.index).split('\n').length;
            hits.push(`${path}:${line} ${hit[0].trim()}`);
          }
        }
      }
    }
    assert(!hits.length, `arithmetic on what is probably a method: ${hits.join('; ')}`);
    return `${files.length} files, ${ENEMY_VARS.length}x${METHODS.length} receiver/method pairs, none multiplied`;
  });
}
