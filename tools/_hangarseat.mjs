/* scratch probe — what the hangar's assemblies are and what holds them up. */
import './dom-shim.mjs';
import { seating, carried } from './checks/prop-seating.mjs';

const rows = seating().get('hangar');
const near = (a, b) => {
  const dx = Math.max(0, Math.max(a.bx0 - b.bx1, b.bx0 - a.bx1));
  const dz = Math.max(0, Math.max(a.bz0 - b.bz1, b.bz0 - a.bz1));
  return Math.hypot(dx, dz);
};
for (const r of rows) {
  if (!/Gantry|Cable|Buttress|Stanchion/i.test(r.maker)) continue;
  const by = carried(r, rows);
  let best = null, bd = Infinity;
  for (const o of rows) { if (o === r) continue; const d = near(r, o); if (d < bd) { bd = d; best = o; } }
  console.log(`${r.maker.padEnd(14)} x[${r.bx0.toFixed(1)},${r.bx1.toFixed(1)}] z[${r.bz0.toFixed(1)},${r.bz1.toFixed(1)}] y[${r.minY.toFixed(2)},${r.maxY.toFixed(2)}]`
    + ` seat=${r.seat.toFixed(2)} carriedBy=${by ? by.maker : 'NOTHING'} nearest=${best ? best.maker : '-'}@${bd.toFixed(2)}m`);
}
const bad = rows.filter((r) => !r.lamp && r.seat > 0.05 && !carried(r, rows));
console.log('floating and uncarried:', bad.length, bad.map((b) => `${b.maker}+${b.seat.toFixed(2)}`).join(', '));
console.log('assemblies total:', rows.length);
