/**
 * DOES EVERY BODY IN THE ROSTER COME APART CLEANLY?
 *
 * `Enemy.dispose` is eighteen conditional teardowns over objects that may or
 * may not exist depending on the archetype, whether it died, whether it
 * ragdolled and whether the blade took anything off it. A throw halfway down
 * leaves everything below it undone, and the two callers that matter —
 * `World.update`'s forty-second sweep and `World.unload` — have no catch.
 *
 * Four states per archetype: standing, dead, dead and cut, and torn down while
 * still alive (a wave reset).
 *
 *   node --import ./tools/register.mjs tools/_disposescan.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { ARCHETYPES } from '../src/game/Enemy.js';
import '../src/game/Levels.js';

const STEP = 1 / 30;
const { world } = await bootWorld({
  level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };

const types = Object.keys(ARCHETYPES).filter((k) => (ARCHETYPES[k].hp | 0) > 0);
const bad = [];
let done = 0, cutTried = 0, cutMade = 0;

for (const type of types) {
  for (const state of ['standing', 'dead', 'cut', 'alive-teardown']) {
    let e = null;
    try {
      const p = new THREE.Vector3(0, 0, -9);
      p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
      e = world.spawnEnemy(type, p);
      if (!e) continue;
      run(0.4);
      if (state !== 'standing' && state !== 'alive-teardown') { e.hp = 0; e.die?.(null, 'probe'); run(0.6); }
      if (state === 'cut') {
        cutTried++;
        const bone = e.rig?.list?.find((b) => !b.severed && b.parts?.length && /arm|thigh|leg|fore/i.test(b.name));
        if (bone && e.actor?.cut) {
          const ok = e.actor.cut(bone.name, 0.5, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
          if (ok) cutMade++;
          run(0.4);
        }
      }
      e.dispose();
      done++;
      /* …and a second one, which is what the corpse ledger's sink does to a
       * body World has already torn down. */
      e.dispose();
    } catch (err) {
      bad.push(`${type}/${state}: ${err && err.message}`);
    }
    if (e) {
      const i = world.enemies.indexOf(e);
      if (i >= 0) world.enemies.splice(i, 1);
    }
  }
}

console.log(`${types.length} archetypes x 4 states: ${done} disposed clean, ${bad.length} threw`);
console.log(`cuts: ${cutMade} of ${cutTried} bodies actually lost a limb before teardown`);
for (const b of bad.slice(0, 20)) console.log(`  ${b}`);
console.log(`world after: enemies=${world.enemies.length} bodies=${world.physics.bodies.length} `
  + `joints=${world.physics.joints.length} props=${world.props.length}`);
process.exit(0);
