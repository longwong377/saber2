/** Every companion body, BUILT — which is the only test of a body plan. */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { COMPANION_KINDS } = await import('../src/game/CompanionKinds.js');
const { fieldCompanion } = await import('../src/game/Companions.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' }, runSeed: 3,
});
const STEP = 1 / 30;
for (let i = 0; i < 30; i++) world.update(STEP, idle);
const p = world.player;
/* EVERY KIND THE TABLE DECLARES, not a hand-kept list — so a kind that gains
 * a body is measured the day it lands and one that has none says so. */
for (const id of Object.keys(COMPANION_KINDS)) {
  const K = COMPANION_KINDS[id];
  if (!ARCHETYPES[K.archetype]) { console.log(`${id.padEnd(8)} NO ARCHETYPE`); continue; }
  let e = null, err = null;
  try { e = fieldCompanion(world, p, id, { rec: { xp: 99 } }); } catch (x) { err = x; }
  if (err) { console.log(`${id.padEnd(8)} THREW ON BUILD: ${err.message}`); continue; }
  if (!e) { console.log(`${id.padEnd(8)} SPAWN REFUSED`); continue; }
  /* THE MESHES ARE UNDER `rig.root`, NOT `group`. A creature has no `.group`
   * at all — it is a rigged body — so this counted zero for every companion
   * and printed "0 meshes 0 tris" beside twelve real animals. Both are walked
   * now, because the droid kinds DO carry a group. */
  let tris = 0, meshes = 0;
  const eat = (o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g?.index ? g.index.count : (g?.attributes?.position?.count || 0)) / 3;
  };
  e.rig?.root?.traverse?.(eat);
  if (e.group && e.group !== e.rig?.root) e.group.traverse?.(eat);
  const bones = e.rig ? [...e.rig.bones.keys()].length : 0;
  const legs = e.rig ? [...e.rig.bones.keys()].filter((n) => /thigh|shin|femur|tibia|tarsus|foot/i.test(n)).length : 0;
  let ticks = 0, thrown = null;
  try { for (let i = 0; i < 90; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); ticks++; } }
  catch (x) { thrown = x; }
  console.log(`${id.padEnd(8)} hp ${String(e.maxHp).padStart(4)} scale ${String(e.A.scale).padStart(5)}`
    + ` speed ${(e.speed).toFixed(2).padStart(5)} | ${String(meshes).padStart(3)} meshes ${String(Math.round(tris)).padStart(6)} tris`
    + ` | ${String(bones).padStart(2)} bones ${String(legs).padStart(2)} leg-bones`
    + ` | moves [${(e.beastMoves ? e.beastMoves(3) : []).join(',')}]`
    + ` | ${ticks} frames ${thrown ? 'THREW: ' + thrown.message : 'clean'}`
    + ` | y ${e.position.y.toFixed(2)} vs ground ${world.terrain.height(e.position.x, e.position.z).toFixed(2)}`);
  e.damage(e.maxHp * 3, e.position, null, 'bolt');
  for (let i = 0; i < 20; i++) world.update(STEP, idle);
}
