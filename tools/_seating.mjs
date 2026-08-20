/**
 * WHAT IS OFF THE GROUND ON A LEVEL, AND WHAT THE CHECK THINKS IS HOLDING IT.
 *
 * Iteration aid over `tools/checks/prop-seating.mjs`'s own survey — imported,
 * not rebuilt, so this cannot disagree with the check about what "seated"
 * means. Prints every assembly whose lowest vertex is clear of what is under
 * it, the exemption that saves it (or does not), and the nearest thing to it.
 *
 *   node --import ./tools/register.mjs tools/_seating.mjs geonosis [minSeat]
 */
import './dom-shim.mjs';
import { seating, carried, nearestTo } from './checks/prop-seating.mjs';

const key = process.argv[2];
const min = +(process.argv[3] || 0.05);
const all = seating();
for (const [k, rows] of all) {
  if (key && k !== key) continue;
  const off = rows.filter((r) => r.seat > min && !r.lamp).sort((a, b) => b.seat - a.seat);
  console.log(`\n══ ${k}: ${off.length} of ${rows.length} assemblies more than ${min} m clear of their support`);
  for (const r of off.slice(0, 24)) {
    const by = carried(r, rows);
    const n = nearestTo(r, rows);
    console.log(`  ${r.maker.padEnd(16)} +${r.seat.toFixed(2).padStart(6)} m  `
      + `${(r.bx1 - r.bx0).toFixed(2)}×${(r.maxY - r.minY).toFixed(2)}×${(r.bz1 - r.bz0).toFixed(2)} `
      + `at (${r.cx0.toFixed(0)}, ${r.minY.toFixed(1)}, ${r.cz0.toFixed(0)})  `
      + (by ? `held by ${by.maker} [${by.bx0.toFixed(0)}..${by.bx1.toFixed(0)}, y ${by.minY.toFixed(1)}..${by.maxY.toFixed(1)}, ${by.bz0.toFixed(0)}..${by.bz1.toFixed(0)}]`
            : `FLOATS — nearest ${n.at ? n.at.maker : 'nothing'} ${n.d.toFixed(2)} m`));
  }
}
