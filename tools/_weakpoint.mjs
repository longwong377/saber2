/**
 * PROBE (not a check): what a blade meets on every body in the roster.
 *
 * No bars, no assertions — HANDOFF §3's rule for a trace. It prints, per
 * archetype, every capsule the solver will be handed: the bone, its role, what
 * `Enemy._boneToughness` charges to part it, what `severanceOf` says losing it
 * is worth, and how many 14 m/s passes of a blade that is.
 *
 *   node --import ./tools/register.mjs tools/_weakpoint.mjs [archetype…]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { ARCHETYPES } from '../src/game/Enemy.js';
import { severanceOf } from '../src/game/Enemy.js';
import { TOUGHNESS } from '../src/game/Combat.js';
import '../src/game/Levels.js';
import '../src/game/Vehicles.js';
import '../src/game/Command.js';

const NAMES = { [TOUGHNESS.flesh]: 'flesh', [TOUGHNESS.cloth]: 'cloth', [TOUGHNESS.plastoid]: 'plastoid',
  [TOUGHNESS.droid]: 'droid', [TOUGHNESS.armour]: 'armour', [TOUGHNESS.heavy]: 'heavy',
  [TOUGHNESS.durasteel]: 'durasteel', [TOUGHNESS.blastdoor]: 'blastdoor' };

/* The shipped rule, called and not restated — a copy of the if-chain here
 * would be HANDOFF §2.4 in the instrument. It is a method, so it is borrowed
 * off the prototype against a stand-in that carries only `A`. */
const { Enemy } = await import('../src/game/Enemy.js');
const toughOf = (A, name) => Enemy.prototype._boneToughness.call({ A }, name);

/* One pass of a blade at `v` m/s through a capsule of radius r: the solver's
 * own arithmetic, imported where it can be and reproduced only where the terms
 * are local to `solve`. */
const SLASH_REF = 8, SLASH_CAP = 8, WORK_RATE = 2.4;
function passWork(tough, speed, chord) {
  const softness = Math.min(1, Math.max(0.25, TOUGHNESS.armour / tough));
  const rush = (speed / SLASH_REF) ** 2 * softness;
  const slash = Math.min(SLASH_CAP, 1 + rush);          // coverage 1 at full transit
  return speed * (chord / speed) * WORK_RATE * slash;   // dt = chord / speed
}

const want = process.argv.slice(2);
const keys = want.length ? want : Object.keys(ARCHETYPES);
for (const key of keys) {
  const A = ARCHETYPES[key];
  if (!A || !A.build) continue;
  let built;
  try { built = A.build({ scale: A.scale }); } catch (e) { console.log(`${key}: build failed ${e.message}`); continue; }
  const rig = built.rig;
  const flag = [A.big && 'big', A.boss && 'boss', A.armored && 'armored', A.armorPlus && 'armorPlus',
    A.custom && A.custom].filter(Boolean).join(',');
  console.log(`\n── ${key}  (${A.label})  hp ${A.hp} mass ${A.mass ?? '?'} scale ${A.scale}  ${flag}`
    + `  base ${NAMES[A.toughness] ?? A.toughness}`);
  if (!rig) { console.log('   no rig'); continue; }
  const rows = [];
  for (const b of rig.list) {
    if (!b.parts.length) continue;
    const t = toughOf(A, b.name);
    const v = severanceOf(b);
    const chord = 2 * b.radius * 1.12;
    const w = passWork(t, 14, chord);
    rows.push([b.name, b.role, (b.radius).toFixed(3), (b.length).toFixed(2),
      (NAMES[t] ?? t), v.toFixed(3), (t / w).toFixed(2)]);
  }
  const uniq = new Set(rows.map((r) => r[4]));
  console.log(`   ${rows.length} bones, ${uniq.size} distinct toughness: ${[...uniq].join(' ')}`);
  const hdr = ['bone', 'role', 'r', 'len', 'tough', 'vital', 'passes@14'];
  const w = hdr.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  console.log('   ' + hdr.map((h, i) => h.padEnd(w[i])).join('  '));
  for (const r of rows) console.log('   ' + r.map((c, i) => String(c).padEnd(w[i])).join('  '));
}
