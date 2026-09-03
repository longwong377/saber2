/**
 * WHOSE HEAD IS SPINNING — the player's V13 note, measured.
 *
 *   "a portion of my troops almost looked headless and I noticed a couple more
 *    had heads that would constantly spin so I think the headless ones just had
 *    heads that stopped rotating upside down"
 *
 * Watches every body's head bone in a real Command world and reports any whose
 * local quaternion keeps turning the same way frame after frame — which is what
 * a relative rotation applied to a bone nobody reset would look like.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'command', level: 'geonosis', order: 'jedi', allies: 12 }, runSeed: 5,
});
world.command?.start?.(1);
const STEP = 1 / 30;
for (let i = 0; i < 30; i++) world.update(STEP, idle);

const env = new Map();
const track = new Map();                       // id -> {last, turn, maxStep, frames}
const sample = () => {
  for (const e of world.enemies) {
    for (const b2 of (e.rig?.list || [])) {
      if (!b2.obj || b2.severed) continue;
      const k2 = b2.name;
      const cur = env.get(k2) || 0;
      const a = b2.restQuat ? b2.restQuat.angleTo(b2.obj.quaternion) : 0;
      if (a > cur) env.set(k2, a);
    }
    const b = e.rig?.get?.('head');
    if (!b || b.severed) continue;
    const q = b.obj.quaternion;
    const rec = track.get(e.id) || { last: q.clone(), turn: 0, maxStep: 0, frames: 0, arch: e.A?.label || e.type };
    const d = rec.last.angleTo(q);
    rec.turn += d; rec.maxStep = Math.max(rec.maxStep, d); rec.frames++;
    rec.last.copy(q);
    rec.upright = new THREE.Vector3(0, 1, 0).applyQuaternion(b.obj.getWorldQuaternion(new THREE.Quaternion())).y;
    track.set(e.id, rec);
  }
};
for (let i = 0; i < 60 * 20; i++) { world.update(STEP, idle); if (i % 2 === 0) sample(); }

const rows = [...track.entries()].map(([id, r]) => ({ id, ...r }))
  .sort((a, b) => b.turn - a.turn);
console.log('body                 arch                 total turn   worst step   head-up   frames');
for (const r of rows.slice(0, 14)) {
  console.log(`${String(r.id).padEnd(20)} ${String(r.arch).slice(0, 20).padEnd(20)} `
    + `${r.turn.toFixed(2).padStart(10)} ${r.maxStep.toFixed(3).padStart(12)} `
    + `${(r.upright ?? 0).toFixed(2).padStart(9)} ${String(r.frames).padStart(7)}`);
}
console.log('\nHEAD/NECK envelope from rest: head', (env.get('head')||0).toFixed(3), ' neck', (env.get('neck')||0).toFixed(3), ' chest', (env.get('chest')||0).toFixed(3));
console.log('\nMAX ANGLE FROM REST, by bone:');
for (const [k2,v] of [...env.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18)) console.log('  ', k2.padEnd(10), v.toFixed(3));
const spun = rows.filter((r) => r.turn > 20);
const upside = rows.filter((r) => (r.upright ?? 1) < 0);
console.log(`\n${rows.length} heads watched · ${spun.length} turned more than 20 rad in 20 s · `
  + `${upside.length} are upside down`);
