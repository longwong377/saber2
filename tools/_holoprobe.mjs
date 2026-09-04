/** TEMP probe: rule 4 on a deck. node --import ./tools/register.mjs tools/_holoprobe.mjs 48 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { rasterView, iou, W, H } from './checks/_raster.mjs';

function diskFetch() {
  if (globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}
const deck = Number(process.argv[2] || 48);
const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const { DECK_Y } = await import('../src/game/StationPlan.js');
diskFetch();
await prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = deck; },
});
const raster = (rec) => {
  const p = rec.place;
  const fx0 = p.x - p.door[0], fz0 = p.z - p.door[1];
  const flen = Math.hypot(fx0, fz0) || 1;
  const dx = fx0 / flen, dz = fz0 / flen;
  const back = Math.max(1.5, p.w / 2 / Math.tan(Math.PI / 4) - p.d / 2);
  return rasterView(THREE, {
    objects: rec.group,
    eye: { x: p.door[0] - dx * back, y: DECK_Y[p.deck] ?? 0, z: p.door[1] - dz * back },
    dir: { x: dx, z: dz },
  }).bits;
};
const recs = [];
for (const rec of world._station.places.values()) {
  if (rec.place.band === 'ring') continue;
  const p = rec.place;
  const fx0 = p.x - p.door[0], fz0 = p.z - p.door[1];
  const flen = Math.hypot(fx0, fz0) || 1;
  const dx = fx0 / flen, dz = fz0 / flen;
  const back = Math.max(1.5, p.w / 2 / Math.tan(Math.PI / 4) - p.d / 2);
  const bits = rasterView(THREE, {
    objects: rec.group,
    eye: { x: p.door[0] - dx * back, y: (DECK_Y[p.deck] ?? 0) + 1.7, z: p.door[1] - dz * back },
    dir: { x: dx, z: dz },
  }).bits;
  let on = 0; for (let i = 0; i < bits.length; i++) on += bits[i];
  recs.push({ place: p, bits, on });
}
recs.sort((a,b)=>a.place.id-b.place.id);
console.log(`deck ${deck}: ${recs.length} places`);
for (const r of recs) console.log(`  #${r.place.id} ${r.place.name} — ${r.on}/${W*H} cells`);
let worst = 0, worstPair = '';
const rows = [];
for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++) {
  const v = iou(recs[i].bits, recs[j].bits);
  rows.push([v, `#${recs[i].place.id} ${recs[i].place.name} × #${recs[j].place.id} ${recs[j].place.name}`]);
  if (v > worst) { worst = v; worstPair = `#${recs[i].place.id} × #${recs[j].place.id}`; }
}
rows.sort((a,b)=>b[0]-a[0]);
console.log(`worst ${worst.toFixed(3)} ${worstPair}`);
for (const [v, s] of rows.slice(0, 12)) console.log(`  ${v.toFixed(3)}  ${s}`);
const want = process.argv[3] ? Number(process.argv[3]) : null;
if (want != null) {
  console.log(`\n--- pairs involving #${want} ---`);
  for (const [v, s] of rows) if (s.includes(`#${want} `)) console.log(`  ${v.toFixed(3)}  ${s}`);
}
world.dispose?.();
process.exit(0);
