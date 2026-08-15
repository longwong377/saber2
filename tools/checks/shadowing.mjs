/**
 * BATTLEFRONT BORZ — no instance property may shadow a method of its own class.
 *
 * `Enemy` had a damage() method and a constructor that wrote
 * `this.damage = <number>`. The property wins, so `e.damage(...)` threw
 * "e.damage is not a function" at every call site: deflected bolts, Force
 * lightning, fall damage, net damage. The blade was the only thing left that
 * could kill anything — which is exactly what the report "I've barely been able
 * to kill anyone" described — and the throw aborted the remainder of
 * world.update() on every frame a bolt reached an enemy, so a run degraded
 * until it froze and then recovered when you restarted it.
 *
 * It failed silently for weeks because requestAnimationFrame was already
 * scheduled before the throw, so the game kept drawing and the only evidence
 * was a console error nobody was reading.
 *
 * This is a whole CLASS of bug and it is cheap to rule out for every class at
 * once, so it is checked structurally rather than one name at a time.
 */

import * as THREE from 'three';
import { Enemy, ARCHETYPES, limitBackpedal } from '../../src/game/Enemy.js';
import { Saber } from '../../src/game/Saber.js';
import { SaberController } from '../../src/game/SaberController.js';
import { BoltPool } from '../../src/game/Bolts.js';
import { Rig } from '../../src/game/Rig.js';
import { FocusSystem } from '../../src/game/Focus.js';

/**
 * Strip comments before pattern-matching source. Without this the check reads
 * the prose warning ABOUT the bug as the bug itself — which it duly did the
 * first time it ran, on the doc comment added to Enemy.damage().
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every method name on a class's prototype chain, excluding Object's. */
function protoMethods(cls) {
  const names = new Set();
  let p = cls.prototype;
  while (p && p !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(p, k);
      if (d && typeof d.value === 'function') names.add(k);
    }
    p = Object.getPrototypeOf(p);
  }
  return names;
}

export async function run({ check, assert }) {
  check('shadowing: no class writes an instance property over its own method', () => {
    // Classes whose constructors are cheap enough to read statically. Enemy and
    // Player need a whole world to instantiate, so those are read from source
    // below rather than built.
    const cheap = [
      ['Saber', Saber], ['SaberController', SaberController],
      ['BoltPool', BoltPool], ['Rig', Rig], ['FocusSystem', FocusSystem],
    ];
    const rows = [];
    for (const [name, cls] of cheap) {
      const methods = protoMethods(cls);
      // Read the constructor source and look for `this.<name> =` where <name>
      // is also a method. Static, so it needs no instance and no GL context.
      const src = cls.toString();
      const body = stripComments(src.slice(src.indexOf('constructor'), src.length));
      for (const m of methods) {
        const re = new RegExp(`this\\.${m}\\s*=[^=]`);
        assert(!re.test(body),
          `${name}.${m}() is a method, and the constructor also assigns this.${m} — the property shadows the method`);
      }
      rows.push(`${name} ${methods.size}`);
    }
    return rows.join(', ');
  });

  check('shadowing: Enemy deals attackDamage and receives damage()', () => {
    // The specific regression, asserted against the source because building an
    // Enemy needs a world, terrain and physics.
    const methods = protoMethods(Enemy);
    assert(methods.has('damage'), 'Enemy lost its damage() method');
    const src = stripComments(Enemy.toString());
    assert(!/this\.damage\s*=[^=]/.test(src),
      'the Enemy constructor assigns this.damage again — that shadows damage() and silently breaks every bolt, Force and fall hit');
    assert(/this\.attackDamage\s*=/.test(src),
      'Enemy no longer carries attackDamage, so it deals no damage');
    // and nothing may call this.damage as a number again
    assert(!/damage:\s*this\.damage\b/.test(src),
      'a bolt is being spawned with damage: this.damage, which is now a method');
    return 'damage() intact, attackDamage carries the number';
  });

  check('shadowing: every archetype carries a numeric attack damage or none', () => {
    const rows = [];
    for (const [key, A] of Object.entries(ARCHETYPES)) {
      if (A.damage === undefined) { rows.push(`${key} —`); continue; }
      assert(typeof A.damage === 'number' && Number.isFinite(A.damage) && A.damage > 0,
        `${key} has damage ${A.damage}`);
      rows.push(`${key} ${A.damage}`);
    }
    return `${rows.length} archetypes`;
  });

  check('shadowing: the movement law survived the rename', () => {
    // limitBackpedal is exported from the same file; a botched rename would
    // take it out too, and nothing else would notice until a playtest.
    const v = new THREE.Vector3(0, 0, 4);
    limitBackpedal(v, new THREE.Vector3(0, 0, -1));
    assert(Math.abs(v.z - 2) < 1e-6, `backpedal law returned ${v.z}, expected 2`);
    return 'intact';
  });
}
