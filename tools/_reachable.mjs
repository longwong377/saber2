/**
 * PROBE (not a check): what a standing player's blade can actually REACH on
 * each big body, and what it costs to part it.
 *
 * `capsulesFor` and `measureSwing` are tools/balance.mjs's, so the heights, the
 * radii, the toughness and the ceiling are all the shipped ones.
 *
 *   node --import ./tools/register.mjs tools/_reachable.mjs [archetype…]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { ARCHETYPES, guardFor } from '../src/game/Enemy.js';
import { TOUGHNESS } from '../src/game/Combat.js';
import '../src/game/Levels.js';
import '../src/game/Vehicles.js';
const B = await import('./balance.mjs');

const NAMES = Object.fromEntries(Object.entries(TOUGHNESS).map(([k, v]) => [v, k]));
const ceiling = B.measureSwing().reachHeight;
console.log(`blade ceiling ${ceiling.toFixed(2)} m (balance.measureSwing().reachHeight)\n`);

const want = process.argv.slice(2);
const keys = want.length ? want : Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].big);
for (const key of keys) {
  const A = ARCHETYPES[key];
  if (!A?.build) continue;
  const caps = B.capsulesFor(key);
  const reach = caps.filter((c) => !c.shield && c.height - c.r <= ceiling);
  console.log(`── ${key} (${A.label}) mass ${A.mass} guard ${guardFor(A)}`
    + `  ${reach.length}/${caps.length} capsules in reach`);
  const rows = caps.map((c) => [c.name, (c.height).toFixed(2), (c.r).toFixed(3),
    NAMES[c.toughness] ?? c.toughness, (c.vital ?? 0).toFixed(3),
    (c.height - c.r <= ceiling) ? 'reach' : '—']);
  const hdr = ['cap', 'y', 'r', 'tough', 'vital', ''];
  const w = hdr.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  console.log('   ' + hdr.map((h, i) => h.padEnd(w[i])).join('  '));
  for (const r of rows) console.log('   ' + r.map((c, i) => String(c).padEnd(w[i])).join('  '));
  console.log();
}
