/* THROWAWAY. Does the stall actually move? Boot the station, stand at the
 * food court counter, start a real cook, drive world.update, and print the
 * world-space travel of every piece and of the keeper's hand bones. */
import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
globalThis.__stationFetch = true;
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), root));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const Food = await import('../src/game/Food.js');
const { CookSet } = await import('../src/game/StationKit.js');
await prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const idle = idleInput();
const st = world._station;

const V = await import('../src/game/Vendors.js');
const wanted = process.argv[2] || 'f-noodle';
const counter = V.COUNTERS.find((c) => c.stock.some((r) => r.id === wanted));
const row = counter.stock.find((r) => r.id === wanted);
const desks = st.counters.get(counter.place);
const desk = desks[desks.length - 1];
/* stand the player a metre in front of the LAST desk in the room, so the
 * "he steps down the row" branch is the one under test */
world.player.position.set(desk.front.x, desk.front.y + 1.0, desk.front.z);
console.log(`# ${wanted} at ${counter.name}, desk ${desks.length - 1} of ${desks.length}`);

const said = [];
const cook = new Food.Cook(row, { say: (l) => said.push(l), done: () => said.push('[DONE]') });
const keeper = st.keepers.find((k) => k.id === counter.id);
const before = { x: keeper.body.position.x, z: keeper.body.position.z };
const set = new CookSet(world, counter, cook, Food.prepOf(row).id);
console.log('# set.done', set.done, 'parts', Object.keys(set.parts).join(','), 'puffs', set.puffs.length);
console.log(`# keeper moved ${Math.hypot(keeper.body.position.x - before.x, keeper.body.position.z - before.z).toFixed(2)} m to the stall`);
world._cook = set;

const names = [...Object.keys(set.parts), 'steam0'];
const meshOf = (n) => (n === 'steam0' ? set.puffs[0] : set.parts[n]);
const prev = new Map(), total = new Map(), maxv = new Map(), seen = new Map();
const snap = () => {
  world.scene.updateMatrixWorld(true);
  for (const n of names) {
    const m = meshOf(n);
    if (!m) continue;
    const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    const q = prev.get(n);
    if (q && m.visible && seen.get(n)) {
      const d = p.distanceTo(q);
      total.set(n, (total.get(n) || 0) + d);
      maxv.set(n, Math.max(maxv.get(n) || 0, d));
    }
    prev.set(n, p);
    seen.set(n, m.visible);
  }
};
const rig = keeper.body.rig;
const hand = (s) => rig.worldPos(`hand${s}`, new THREE.Vector3());
let handTotal = { L: 0, R: 0 };
let hprev = { L: hand('L'), R: hand('R') };
let hmax = 0;

snap();
const dt = 1 / 60;
let f = 0;
const cpu0 = process.cpuUsage();
while (world._cook && f < 900) {
  world.update(dt, idle);
  f++;
  snap();
  for (const s of ['L', 'R']) {
    const h = hand(s);
    const dd = h.distanceTo(hprev[s]);
    if (dd > hmax) hmax = dd;
    handTotal[s] += dd;
    hprev[s] = h;
  }
  if (f >= 100 && f < 112) {
    console.log(`   running handR total=${handTotal.R.toFixed(2)} maxd=${(hmax||0).toFixed(3)}`);
    const want = set.at(set._lastP.hand.R.x, set._lastP.hand.R.y, set._lastP.hand.R.z, new THREE.Vector3());
    const sh = rig.worldPos('armR', new THREE.Vector3());
    console.log(`   f${f} handR=${hprev.R.toArray().map(v=>v.toFixed(3)).join(',')} want=${want.toArray().map(v=>v.toFixed(3)).join(',')} sh=${sh.toArray().map(v=>v.toFixed(3)).join(',')} reach=${sh.distanceTo(want).toFixed(3)}`);
  }
  if (f % 20 === 0) {
    const kp = keeper.body.position;
    const want = set.at(set._lastP.hand.R.x, set._lastP.hand.R.y, set._lastP.hand.R.z, new THREE.Vector3());
    console.log(`     keeper @${kp.x.toFixed(2)},${kp.z.toFixed(2)} facing=${keeper.body.facing.toFixed(2)} lod=${keeper.body.lod} vel=${keeper.body.velocity.length().toFixed(2)} handR=${hprev.R.x.toFixed(3)},${hprev.R.z.toFixed(3)} want=${want.x.toFixed(3)},${want.y.toFixed(3)},${want.z.toFixed(3)}`);
    const v = set.parts.vessel ? new THREE.Vector3().setFromMatrixPosition(set.parts.vessel.matrixWorld) : null;
    console.log(`f${String(f).padStart(3)} ${String(cook.stepId).padEnd(6)} ${String(cook.move).padEnd(7)} u=${cook.within.toFixed(2)}`
      + (v ? ` vessel y=${v.y.toFixed(3)} x=${v.x.toFixed(3)}` : '')
      + ` handR=${hprev.R.y.toFixed(3)} made=${set.made.toFixed(2)}`);
  }
}
const cpu = process.cpuUsage(cpu0);
console.log(`# ${f} frames, cook done=${cook.done}, lines said=${said.length}`);
console.log('# travel per piece over the whole cook, mm (and biggest single frame, mm):');
for (const n of names) {
  if (!total.has(n)) continue;
  console.log(`#   ${n.padEnd(8)} ${(total.get(n) * 1000).toFixed(1).padStart(9)}   ${(maxv.get(n) * 1000).toFixed(2).padStart(7)}`);
}
console.log(`#   handL    ${((handTotal.L - hmax) * 1000).toFixed(1).padStart(9)}  (first frame's ${(hmax * 1000).toFixed(0)} mm teleport taken off)`);
console.log(`#   handR    ${((handTotal.R - hmax) * 1000).toFixed(1).padStart(9)}`);

/* ── WHAT IT COSTS. Baseline, then the same world with one long cook on it,
 *    with the build of the set measured separately so the steady frame is a
 *    steady frame. */
const bench = (label, n, fn) => {
  for (let i = 0; i < 30; i++) fn();
  const t0 = process.cpuUsage();
  for (let i = 0; i < n; i++) fn();
  const c = process.cpuUsage(t0);
  const ms = (c.user + c.system) / 1000 / n;
  console.log(`# ${label}: ${ms.toFixed(4)} ms/frame over ${n}`);
  return ms;
};
const mk = () => new CookSet(world, counter, new Food.Cook(row, { say: () => {}, done: () => {} }), Food.prepOf(row).id);
const run = (n, fn) => { const t0 = process.cpuUsage(); for (let i = 0; i < n; i++) fn(); const c = process.cpuUsage(t0); return (c.user + c.system) / 1000 / n; };
const held = mk();
const cooking = () => {
  held.done = false; held.cook.done = false;
  if (held.cook.i >= held.cook.steps.length - 1) { held.cook.i = 0; held.cook.t = 0; held.cook._said = -1; }
  world._cook = held;
  world.update(dt, idle);
};
const idleFrame = () => { world._cook = null; world.update(dt, idle); };
for (let i = 0; i < 6; i++) { idleFrame(); cooking(); }
const As = [], Bs = [];
for (let i = 0; i < 8; i++) { As.push(run(120, idleFrame)); Bs.push(run(120, cooking)); }
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log(`# world.update, no cook : median ${med(As).toFixed(3)} ms/frame over 8 x 120`);
console.log(`# world.update, cooking : median ${med(Bs).toFixed(3)} ms/frame over 8 x 120`);
console.log(`# the cook costs ${((med(Bs) - med(As)) * 1000).toFixed(0)} us on a steady frame (medians)`);
const C = run(4000, () => { held.done = false; held.cook.done = false; if (held.cook.i >= held.cook.steps.length - 1) { held.cook.i = 0; held.cook.t = 0; held.cook._said = -1; } held.step(dt); });
console.log(`# CookSet.step alone: ${(C * 1000).toFixed(0)} us/frame over 4000`);
held.dispose();
world._cook = null;
const t0 = process.cpuUsage();
const N = 40;
for (let i = 0; i < N; i++) { const s2 = mk(); s2.dispose(); }
const cb = process.cpuUsage(t0);
console.log(`# building and disposing one set: ${((cb.user + cb.system) / 1000 / N).toFixed(2)} ms, once per order`);
