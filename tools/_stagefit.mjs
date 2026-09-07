/**
 * DOES THE STAGE FIT? — the plan's own two tests, run on a bearing sweep.
 *
 * V20 lane 5 had to move a room and site seven new ones on a ring whose gaps
 * are measured in single degrees, and the two rules that decide it are already
 * written down in `tools/checks/station.mjs`: the separating-axis test on the
 * yawed rectangles at 0.5 m slack, and the door-arc clearance of every
 * walkway fixture against every door on the ring. Both are copied here — the
 * check is the gate and this is the instrument you iterate a bearing with,
 * which is the same relationship `_wellprobe.mjs` has to the well.
 *
 *   node --import ./tools/register.mjs tools/_stagefit.mjs [deck]
 */
import { PLACES, WAYS, DRUM } from '../src/game/StationPlan.js';

const DECKS = process.argv[2] ? [Number(process.argv[2])] : [40, 44, 48];
const D2R = Math.PI / 180;

const corners = (p) => {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), hw = p.w / 2, hd = p.d / 2, out = [];
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    out.push([p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
  }
  return out;
};
const overlap = (A, B, slack = 0.5) => {
  let least = Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of A) { const d = x * nx + z * nz; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const [x, z] of B) { const d = x * nx + z * nz; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      const gap = Math.min(a1, b1) - Math.max(a0, b0);
      if (gap < least) least = gap;
      if (gap <= slack) return 0;
    }
  }
  return least;
};

let faults = 0;
for (const deck of DECKS) {
  const ps = PLACES.filter((p) => p.deck === deck && !p.external && p.band !== 'ring' && p.w);
  const C = new Map(ps.map((p) => [p.id, corners(p)]));
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const o = overlap(C.get(ps[i].id), C.get(ps[j].id));
      if (o > 0) { faults++; console.log(`  OVERLAP deck ${deck}: #${ps[i].id} ${ps[i].name} × #${ps[j].id} ${ps[j].name} by ${o.toFixed(2)} m`); }
    }
  }
  for (const p of ps) {
    if (['deck32', 'deck12', 'tram', 'skin'].includes(p.band)) continue;
    let r = 0, rmin = Infinity;
    for (const [x, z] of C.get(p.id)) { const d = Math.hypot(x, z); if (d > r) r = d; if (d < rmin) rmin = d; }
    if (r > DRUM.R + 0.01) { faults++; console.log(`  SKIN deck ${deck}: #${p.id} ${p.name} reaches r=${r.toFixed(2)}`); }
    if (p.band !== 'atrium' && p.band !== 'hub' && rmin < DRUM.atrium - 0.01) { faults++; console.log(`  ATRIUM deck ${deck}: #${p.id} ${p.name} at r=${rmin.toFixed(2)}`); }
  }
  /* Every fixture against every door on the ring — `station.mjs`'s clause. */
  for (const w of WAYS) {
    if (w.deck !== deck || w.band === 'spine' || w.band === 'rim') continue;
    for (const p of ps) {
      if (!p.door) continue;
      const dr = Math.hypot(p.door[0], p.door[1]);
      if (dr < 79) continue;
      const pa = Math.atan2(p.door[0], p.door[1]) / D2R;
      const gap = Math.abs(((w.at - pa + 540) % 360) - 180);
      const half = Math.atan2(p.w / 2, Math.hypot(p.x, p.z) || 1) / D2R;
      const want = half + (w.span || 4) / 2;
      if (gap < want) { faults++; console.log(`  DOOR deck ${deck}: ${w.name} at ${w.at}° is ${gap.toFixed(2)}° off #${p.id} ${p.name} (wants ${want.toFixed(2)}°)`); }
    }
  }
  /* And the arc each room's front occupies, printed, because a bearing is
   * chosen by reading this table and not by trying one. */
  const arcs = ps.filter((p) => p.band === 'outer').map((p) => {
    const half = Math.asin(Math.min(1, (p.w / 2) / DRUM.roomR)) / D2R;
    const at = ((p.at % 360) + 360) % 360;
    return { id: p.id, name: p.name, a0: at - half, a1: at + half };
  }).sort((a, b) => a.a0 - b.a0);
  console.log(`\n  deck ${deck} outer band:`);
  let prev = null;
  for (const a of arcs) {
    if (prev !== null && a.a0 - prev > 0.05) console.log(`      ── ${(a.a0 - prev).toFixed(1)}° clear ──`);
    console.log(`    ${a.a0.toFixed(1)} .. ${a.a1.toFixed(1)}  #${a.id} ${a.name}`);
    prev = Math.max(prev ?? -Infinity, a.a1);
  }
}
console.log(faults ? `\n  ${faults} faults` : '\n  clear');
process.exit(faults ? 1 : 0);
