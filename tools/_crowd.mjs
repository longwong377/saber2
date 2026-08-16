/**
 * WHAT THIRTY BODIES ACTUALLY COST — the measurement behind player note #15.
 *
 * "any situation where multiple characters with sabers are on the screen it
 * gets really really laggy and freezes too, makes it really hard to tell if
 * saber vs saber combat works at all… sometimes for fun I'll spawn like 30
 * enemies and then it gets really really laggy, framerate probably <10 once
 * there are that many dead and alive enemies on the map."
 *
 * Two symptoms in one note and they are probably two different faults, so this
 * counts them separately: what a LIVE crowd costs, what a crowd of CORPSES
 * costs, and — the one nothing in this repo has ever counted — how many
 * dynamic LIGHTS are in the scene, because every lit saber carries two point
 * lights and a forward renderer pays for each of them in every fragment it
 * touches.
 *
 *   node --import ./tools/register.mjs tools/_crowd.mjs [count] [type]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const N = Number(process.argv[2] || 30);
const TYPE = process.argv[3] || 'acolyte';       // a saber user by default

const { world } = await bootWorld({
  level: 'colosseum', settings: { mode: 'waves', difficulty: 'knight' },
});
const y = world.terrain.height(0, 0);

const census = (label) => {
  let lights = 0, meshes = 0, tris = 0, mats = new Set(), skinned = 0;
  world.scene.traverse((o) => {
    if (o.isLight && o.intensity > 0) lights++;
    if (o.isMesh || o.isSkinnedMesh) {
      if (!o.visible) return;
      meshes++;
      if (o.isSkinnedMesh) skinned++;
      const g = o.geometry;
      if (g) tris += (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3
        * (o.isInstancedMesh ? o.count : 1);
      if (o.material) mats.add(o.material.uuid);
    }
  });
  const bodies = world.physics?.bodies?.length ?? 0;
  console.log(`  ${label.padEnd(26)} lights ${String(lights).padStart(3)} · meshes ${String(meshes).padStart(5)}`
    + ` · tris ${String(Math.round(tris)).padStart(8)} · materials ${String(mats.size).padStart(4)}`
    + ` · skinned ${String(skinned).padStart(4)} · rigidbodies ${bodies}`);
  return { lights, meshes, tris, mats: mats.size, bodies };
};

/* AND THE FRAME IS RESOLVED, NOT JUST SIMULATED.
 *
 * A blade no longer OWNS a point light; it asks `Engine.lightUp` for one every
 * frame and the engine's fixed pool of eight ranks the requests when it renders
 * (Saber.js, Engine.lightUp). `world.update` posts the requests, `engine.render`
 * is what turns the winners into lights — so a census taken after update alone
 * would read a pool that had never been driven and report 2 lights whatever was
 * on the field. That would be a flattering number and a false one. */
const step = (frames) => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < frames; i++) { world.update(1 / 60, idleInput()); world.engine.render(1 / 60); }
  return Number(process.hrtime.bigint() - t0) / 1e6 / frames;
};

console.log(`\n  ${N} x ${TYPE}, on the colosseum\n`);
const empty = census('empty');
console.log(`  ${'  simulation'.padEnd(26)} ${step(30).toFixed(2)} ms/frame\n`);

const made = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2, r = 9 + (i % 4) * 2.5;
  const e = world.spawnEnemy(TYPE, new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
  if (e) { made.push(e); e.saber && (e.saber.lit = true); }
}
console.log(`  seeded ${made.length}`);
step(20);
const live = census(`${made.length} alive`);
const liveMs = step(40);
console.log(`  ${'  simulation'.padEnd(26)} ${liveMs.toFixed(2)} ms/frame\n`);

/* …and then the same crowd DEAD, which is the half of the report that nothing
 * in this repo measures. A corpse is not free: it keeps its meshes, its
 * ragdoll bodies and its cloth. */
for (const e of made) e.damage?.(99999, e.position, null, 'probe');
step(60);
const dead = census(`${made.length} dead`);
const deadMs = step(40);
console.log(`  ${'  simulation'.padEnd(26)} ${deadMs.toFixed(2)} ms/frame\n`);

console.log(`  PER BODY   alive ${((live.tris - empty.tris) / N).toFixed(0)} tris, `
  + `${((live.meshes - empty.meshes) / N).toFixed(1)} meshes, `
  + `${((live.lights - empty.lights) / N).toFixed(2)} lights, `
  + `${((liveMs - Number(0)) / N).toFixed(2)} ms`);
console.log(`  PER CORPSE ${((dead.tris - empty.tris) / N).toFixed(0)} tris, `
  + `${((dead.meshes - empty.meshes) / N).toFixed(1)} meshes, `
  + `${((dead.lights - empty.lights) / N).toFixed(2)} lights\n`);

world.unload();
