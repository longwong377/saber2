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

/** A receiver with just the collaborators Player.damage actually touches. */
function victim(hp = 100) {
  return {
    alive: true, invuln: 0, hp, difficulty: { damageTaken: 1 },
    world: { training: false, engine: { hurt() {} } },
    flow: 1, combo: 3, staggerTimer: 0, hitFlash: 0,
    camera: { addShake() {} }, chest: { x: 0, y: 0, z: 0 },
    died: false, die() { this.died = true; },
  };
}

export async function run({ check, assert }) {
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
