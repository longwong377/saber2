/**
 * Scratch probe — WHAT HOLDS THE RUNS AND THE GANTRIES UP, on the two ship
 * levels. Not a check; it prints, it never asserts.
 *
 *   node --import ./tools/register.mjs tools/_hangarseat.mjs
 *
 * It asks `prop-seating`'s own survey rather than building a second one, for
 * HANDOFF §2.4: a probe that re-measures an assembly is a probe that will
 * eventually disagree with the check about what an assembly is.
 *
 * Three readings, one per claim under investigation:
 *
 *   BRACKETS   every cable run's two ends, and the nearest real surface to
 *              each in 3D. `addCableRun` puts a 0.3 m bracket slab at each
 *              end; the question is what it is bolted to.
 *   AXIS       every gantry's plan extent, x against z. `addGantry` builds its
 *              deck along +z unrotated, so this is the world axis the deck's
 *              long side ends up on after `yaw`.
 *   WALL       where the shell actually reaches a given height, by bisection
 *              on the level's own heightfield.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Terrain } from '../src/world/Terrain.js';
import { seating, carried, nearestTo } from './checks/prop-seating.mjs';

const rows = seating();

/** Distance from a point to an assembly's plan bounds and its y span. */
const distTo = (p, r) => {
  const dx = Math.max(0, r.bx0 - p.x, p.x - r.bx1);
  const dz = Math.max(0, r.bz0 - p.z, p.z - r.bz1);
  const dy = Math.max(0, r.minY - p.y, p.y - r.maxY);
  return Math.hypot(dx, dy, dz);
};

for (const key of ['hangar', 'warship']) {
  const all = rows.get(key);
  const T = new Terrain(new THREE.Scene(), key === 'hangar' ? 'hangar' : 'warship', 0.5);
  console.log(`\n══ ${key} — ${all.length} assemblies ═══════════════════════════`);

  console.log('  RUNS AND GANTRIES');
  for (const r of all) {
    if (!/Gantry|CableRun/.test(r.maker)) continue;
    const by = carried(r, all);
    const near = nearestTo(r, all);
    const ex = (r.bx1 - r.bx0), ez = (r.bz1 - r.bz0);
    console.log(`   ${r.maker.padEnd(12)} x[${r.bx0.toFixed(1)},${r.bx1.toFixed(1)}] z[${r.bz0.toFixed(1)},${r.bz1.toFixed(1)}]`
      + ` y[${r.minY.toFixed(2)},${r.maxY.toFixed(2)}]  plan ${ex.toFixed(1)}×${ez.toFixed(1)} → long axis ${ex > ez ? 'X' : 'Z'}`
      + `  seat=${r.seat.toFixed(2)} carriedBy=${by ? by.maker : 'NOTHING'}`
      + `  nearest=${near.at ? near.at.maker : '-'}@${near.d.toFixed(2)}m`);
  }

  console.log('  BRACKETS — the two ends of every cable run, and what is within 12 m of each');
  for (const r of all) {
    if (!/CableRun/.test(r.maker)) continue;
    for (const [tag, p] of [['a', new THREE.Vector3(r.bx0 + 0.35, r.maxY, r.bz0 + 0.1)],
      ['b', new THREE.Vector3(r.bx0 + 0.35, r.maxY, r.bz1 - 0.1)]]) {
      // the bracket sits at the anchor, i.e. at the top of the run at each end
      const list = all.filter((o) => o !== r && !/CableRun/.test(o.maker))
        .map((o) => ({ o, d: distTo(p, o) })).sort((u, v) => u.d - v.d).slice(0, 4);
      console.log(`   ${tag} (${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)})  ground ${T.height(p.x, p.z).toFixed(2)} → ${(p.y - T.height(p.x, p.z)).toFixed(2)} m of air under it`);
      for (const { o, d } of list) {
        console.log(`        ${d.toFixed(2)} m  ${o.maker.padEnd(14)} x[${o.bx0.toFixed(1)},${o.bx1.toFixed(1)}] z[${o.bz0.toFixed(1)},${o.bz1.toFixed(1)}] y[${o.minY.toFixed(2)},${o.maxY.toFixed(2)}]`);
      }
    }
  }

  console.log('  WALL — where the shell reaches each height, along z = 0 and z = ±40');
  for (const z of [0, 40]) {
    const line = [];
    for (const target of [0.5, 2, 4, 6, 7, 8, 10]) {
      let lo = 40, hi = 160;
      for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (T.height(m, z) < target) lo = m; else hi = m; }
      line.push(`${target}m@|x|=${lo.toFixed(1)}`);
    }
    console.log(`   z=${z}: ` + line.join('  '));
  }
  T.dispose();
}

const bad = [];
for (const [key, all] of rows) {
  for (const r of all) if (!r.lamp && r.seat > 0.05 && !carried(r, all)) bad.push(`${key}:${r.maker}+${r.seat.toFixed(2)}`);
}
console.log('\nfloating and uncarried, whole roster:', bad.length, bad.join(', '));
