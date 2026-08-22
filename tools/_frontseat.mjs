/**
 * DOES THE DRESSING STILL STAND ON THE GROUND WHEN THE GROUND IS GENERATED?
 *
 * `prop-seating` dresses every level on its AUTHORED heightfield. THE LINE
 * does not use that heightfield: `World._groundKeyFor` installs a
 * `front:<level>` preset off the run seed and raises the same dressing on it.
 * The seating rule is not restated here — this drives `prop-seating.seating()`
 * with a ground resolver and prints the same numbers the check asserts on.
 *
 *   node --import ./tools/register.mjs tools/_frontseat.mjs [seed...]
 *
 * NOTHING IS ASSERTED HERE. The bound is in tools/checks/prop-seating.mjs.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { seating } from './checks/prop-seating.mjs';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { battlefieldGround, installGround, removeGround } from '../src/world/Battlefield.js';

const seeds = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
const SEEDS = seeds.length ? seeds : [1, 3, 7];

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

function survey(label, rows) {
  const seats = rows.map((r) => r.seat).filter((n) => Number.isFinite(n));
  const air = rows.filter((r) => r.seat > 0.05);
  return { label, n: rows.length, p99: pct(seats, 0.99), worst: Math.max(...seats), air: air.length, airList: air };
}

const base = seating();
for (const key of LEVEL_ORDER) {
  const L = LEVELS[key];
  const a = survey('authored', base.get(key) || []);
  console.log(`\n══ ${key}  ${L.battlefield ? '(battlefield: yes)' : '(battlefield: NO — keeps authored)'}`);
  console.log(`   authored   n=${a.n}  p99 ${a.p99.toFixed(2)}  worst ${a.worst.toFixed(2)}  in-air ${a.air}`);
  if (!L.battlefield) continue;
  for (const seed of SEEDS) {
    let made = null;
    try {
      made = battlefieldGround(L.terrain, seed, { deploy: L.start, keep: L.spawnRadius?.[1] });
      installGround(made.key, made.preset);
    } catch (err) { console.log(`   seed ${seed}: refused — ${err.message}`); continue; }
    const rows = seating((k) => (k === key ? made.key : null)).get(key) || [];
    const g = survey('generated', rows);
    console.log(`   seed ${seed}   n=${g.n}  p99 ${g.p99.toFixed(2)}  worst ${g.worst.toFixed(2)}  in-air ${g.air}`);
    const by = new Map();
    for (const r of g.airList) by.set(r.maker, (by.get(r.maker) || 0) + 1);
    const top = [...by].sort((x, y) => y[1] - x[1]).slice(0, 8);
    if (top.length) console.log('       ' + top.map(([m, n]) => `${m}×${n}`).join('  '));
    const deep = g.airList.slice().sort((x, y) => y.seat - x.seat).slice(0, 4);
    for (const d of deep) console.log(`       ${d.maker} at (${d.bx0.toFixed(0)},${d.bz0.toFixed(0)}) hangs ${d.seat.toFixed(2)} m`);
    removeGround(made.key);
  }
}
