/**
 * A BODY THAT DIES INSIDE A COHORT — does it ever come out?
 *
 * `Enemy.update` returns on `this.dead` well above the LOD block, so the only
 * caller of `applyCohort` never runs again for a body that has fallen; and
 * `Enemy.dispose` says nothing about `_l3`. This measures what that costs.
 *
 *   node --import ./tools/register.mjs tools/_cohortleak.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { L3_AT } from '../src/game/Cohorts.js';

const STEP = 1 / 30;
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'sandbox', level: 'geonosis', quality: 'high' }, runSeed: 7,
});
const input = idleInput();
const cam = world.camera || world.engine?.camera;
const far = L3_AT + 25;
console.log(`L3_AT = ${L3_AT.toFixed(1)} m; standing bodies at ${far.toFixed(0)} m`);

const spawn = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * far, 0, Math.sin(a) * far);
    p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
    const e = world.spawnEnemy('b1', p);
    if (e) out.push(e);
  }
  return out;
};

const dump = (tag) => {
  const f = world.cohorts;
  let high = 0, free = 0, members = 0, deadMembers = 0, cohorts = 0;
  for (const c of f.cohorts.values()) {
    if (!c) continue;
    cohorts++; high += c.high; free += c.free.length; members += c.members.size;
    for (const e of c.members) if (e.dead) deadMembers++;
  }
  const s = f.stats();
  console.log(`${tag.padEnd(26)} cohorts=${cohorts} slotsTaken=${high} free=${free} members=${members} deadMembers=${deadMembers} instances=${s.instances} calls=${s.calls} enemies=${world.enemies.length}`);
  return { high, free, members, deadMembers };
};

const run = (secs) => { for (let i = 0; i < Math.round(secs / STEP); i++) world.update(STEP, input); };

const batch = spawn(12);
run(3);
dump('12 standing, far');

for (const e of batch) { e.hp = 0; e.die?.(null, 'probe'); }
run(2);
dump('all 12 dead');

run(45);              // past `update`'s own `dying < 40` teardown
const after = dump('45 s later (disposed)');

const batch2 = spawn(12);
run(3);
const reused = dump('12 fresh, far');

console.log(`\nslots handed back by 12 deaths: ${after.free}`);
console.log(`slots taken after the second batch: ${reused.high} (12 would mean every slot was reused)`);
process.exit(0);
