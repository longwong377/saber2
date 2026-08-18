/**
 * PROBE (not a check): what aiming at a weak point is WORTH, driven through
 * the shipped solver.
 *
 * `tools/balance.mjs`'s `engagementFor` builds a real Saber, a real
 * `BladeContactSolver` and the body's real capsules, and applies the shipped
 * `_fightEnding`/`guardFor` turn rule. `opts.only` restricts which capsules the
 * model may reach, so the SAME instrument answers both halves of the question:
 * with the gaps out of reach it reproduces the game before this change exactly,
 * because no bone capsule moved.
 *
 *   node --import ./tools/register.mjs tools/_weakgain.mjs [archetype…]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { ARCHETYPES, guardFor, hasWeakPoints } from '../src/game/Enemy.js';
import '../src/game/Levels.js';
import '../src/game/Vehicles.js';
const B = await import('./balance.mjs');

const MODS = { cutPower: 1, bladeLength: 1.15, attackRate: 1, moveSpeed: 1 };
const want = process.argv.slice(2);
const keys = want.length ? want : Object.keys(ARCHETYPES).filter((k) => hasWeakPoints(ARCHETYPES[k]));

const rows = [];
for (const key of keys) {
  const A = ARCHETYPES[key];
  if (!A?.build) continue;
  const caps = B.capsulesFor(key);
  /* A weak point's capsule is named `bone.key`; no bone in any skeleton the
   * game has carries a dot, so the name IS the discriminator. `capsulesFor`
   * projects the capsule down to nine fields and `covers` is not one of them. */
  const weak = new Set(caps.filter((c) => c.name.includes(".")).map((c) => c.name));
  const before = B.engagementFor(key, MODS, 0, { only: (n) => !weak.has(n), onlyKey: 'nogap' });
  const after = B.engagementFor(key, MODS, 0);
  const openB = B.engagementFor(key, MODS, 0, { only: (n) => !weak.has(n), onlyKey: 'nogap', guardOpen: true });
  const openA = B.engagementFor(key, MODS, 0, { guardOpen: true });
  rows.push([key, String(guardFor(A)), `${weak.size}/${caps.length}`,
    before.passes + '→' + after.passes,
    before.tKill.toFixed(2) + '→' + after.tKill.toFixed(2),
    (before.tKill / after.tKill).toFixed(2) + '×',
    before.via, after.via,
    openB.tKill.toFixed(2) + '→' + openA.tKill.toFixed(2)]);
}
const hdr = ['body', 'grd', 'gaps', 'passes', 'tKill guarded', 'gain', 'via before', 'via after', 'tKill open'];
const w = hdr.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
console.log(hdr.map((h, i) => h.padEnd(w[i])).join('  '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
