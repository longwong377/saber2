/**
 * A BODY PUT BACK INTO THE WORLD IS STILL FLAGGED DEAD.
 *
 * `RapierWorld.remove` sets `body.dead = true` and `add` never clears it, so a
 * body that is removed and re-added is simulated by Rapier and reported gone
 * by every reader of the flag. `Enemy._tickGetUp` does exactly that: a droid
 * knocked flat has its capsule taken out of the world and put back when it
 * stands up.
 *
 *   node --import ./tools/register.mjs tools/_deadflag.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const STEP = 1 / 30;
const { world } = await bootWorld({
  level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'low' }, runSeed: 7,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };

const p = new THREE.Vector3(0, 0, -7);
p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
const e = world.spawnEnemy('b1', p);
if (!e) { console.log('no body'); process.exit(0); }
run(1);

const P = world.player;
const seen = () => (P && P._forceSeen ? P._forceSeen(e.body) : 'n/a');
const inWorld = () => world.physics.bodies.includes(e.body);
console.log(`standing   dead=${e.body.dead} inWorld=${inWorld()} rb=${!!e.body.rb} forceSeen=${seen()}`);

e.knockFlat?.(new THREE.Vector3(0, 6, -6));
run(0.5);
console.log(`knocked    dead=${e.body.dead} inWorld=${inWorld()} rb=${!!e.body.rb} bodyRemoved=${e.bodyRemoved}`);

/* Long enough for GET_UP plus the recover beat. */
for (let i = 0; i < 40 && e.bodyRemoved; i++) run(1);
console.log(`back up    dead=${e.body.dead} inWorld=${inWorld()} rb=${!!e.body.rb} forceSeen=${seen()} `
  + `ragdolled=${!!e.actor?.ragdolled} alive=${!e.dead}`);
process.exit(0);
