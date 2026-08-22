/**
 * WHAT A BODY THAT DIES FAR AWAY IS ACTUALLY DRAWING.
 *
 * Two rungs hide a body's own meshes: the L2 merged skin (62 m) swaps the
 * bone meshes for one baked SkinnedMesh in the STANDING pose, and the L3
 * cohort (137.8 m) hides everything and draws an instance. `Enemy.update`
 * returns on `this.dead` above the line that re-asks either of them.
 *
 *   node --import ./tools/register.mjs tools/_farcorpse.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const STEP = 1 / 30;
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'sandbox', level: 'geonosis', quality: 'high' }, runSeed: 11,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };

/** What of this body is on screen, and where its drawn triangles are. */
function drawn(e) {
  let own = 0, merged = 0, holders = 0;
  const vis = (o) => { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; };
  e.rig?.root?.traverse((o) => { if (o.isMesh && vis(o)) { if (o.userData?.mergedSkin) merged++; else own++; } });
  if (e._l2?.skin) {
    merged = 0;
    for (const m of e._l2.skin.meshes) if (vis(m)) merged++;
    own = 0;
    for (const m of e._l2.skin.replaced) if (vis(m)) own++;
  }
  for (const h of (e.actor?.holders?.values?.() || [])) h.traverse((o) => { if (o.isMesh && vis(o)) holders++; });
  const inCohort = [...(world.cohorts?.cohorts?.values?.() || [])].some((c) => c && c.members.has(e));
  return { own, merged, holders, l2: !!e._l2?.on, l3: !!e._l3, inCohort, lod: e.lod, dark: (e._dark || []).length };
}

for (const d of [100, 163]) {
  const p = new THREE.Vector3(0, 0, -d);
  p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
  const e = world.spawnEnemy('b1', p);
  if (!e) { console.log(`${d} m: no body`); continue; }
  run(2);
  const a = drawn(e);
  e.hp = 0; e.die?.(null, 'probe');
  run(3);
  const b = drawn(e);
  console.log(`${d} m  alive: own=${a.own} merged=${a.merged} holders=${a.holders} l2on=${a.l2} l3=${a.l3} inCohort=${a.inCohort} lod=${a.lod} dark=${a.dark}`);
  console.log(`      dead : own=${b.own} merged=${b.merged} holders=${b.holders} l2on=${b.l2} l3=${b.l3} inCohort=${b.inCohort} lod=${b.lod} dark=${b.dark}`
    + `  ragdolled=${!!e.actor?.ragdolled}`);
}
process.exit(0);
