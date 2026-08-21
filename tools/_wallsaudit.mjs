/**
 * AUDIT PROBE — is a felled wood still a set of walls?
 *
 * `tools/_walls3.mjs` counts STALLS (under 0.6 m/s for half a second) and
 * tools/checks/forest.mjs's note claims 3 of them are logs. It measures 21 —
 * but a log you CLIMB is under 0.6 m/s while you climb it, so a successful
 * crossing is scored as a stall by that instrument. The player's complaint is
 * not "I slowed down", it is "I was blocked". So this asks the blunt question:
 * over a ten-second walk through a felled stand, does the walk get through, and
 * is any single stop longer than a crossing takes?
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');

const FELL = Number(process.argv[2] || 40);
const { world } = await bootWorld({ level: 'wood', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const F = world.forest, P = world.player;
const STRIDE = 15;

const input = { ...idleInput() };
let wish = { x: 0, y: -1 };
input.moveAxis = (o) => { if (o) { o.x = wish.x; o.y = wish.y; return o; } return { ...wish }; };
const step = (n) => { for (let i = 0; i < n; i++) { P.hp = P.maxHp; P.alive = true; world.update(1 / 60, input); } };

const near = [];
for (let i = 0; i < F.count; i++) near.push([i, Math.hypot(F.data[i * STRIDE] - P.position.x, F.data[i * STRIDE + 1] - P.position.z)]);
near.sort((a, b) => a[1] - b[1]);
let felled = 0;
for (const [i] of near) {
  if (felled >= FELL) break;
  const before = F.stats.felled;
  F.fell(i, Math.cos(i * 1.7), Math.sin(i * 1.7), 0.6);
  if (F.stats.felled > before) felled++;
  step(8);
}
step(60 * 12);

const boxDist = (b, p) => {
  const q = new THREE.Vector3().subVectors(p, b.center).applyQuaternion(b.invQuat);
  return Math.hypot(Math.max(0, Math.abs(q.x) - b.halfExtents.x),
                    Math.max(0, Math.abs(q.y) - b.halfExtents.y),
                    Math.max(0, Math.abs(q.z) - b.halfExtents.z));
};
const blockerAt = (foot) => {
  let who = 'nothing', gap = Infinity, top = 0;
  for (const [i, b] of F.live) { const d = boxDist(b, foot); if (d < gap) { gap = d; who = `standing #${i}`; top = b.center.y + b.halfExtents.y; } }
  for (const [i, arr] of F.logs) for (const b of arr) { const d = boxDist(b, foot); if (d < gap) { gap = d; who = `log #${i}`; top = b.center.y + b.halfExtents.y; } }
  for (const b of world.physics.staticBoxes) { const d = boxDist(b, foot); if (d < gap) { gap = d; who = 'level box'; top = b.center.y + b.halfExtents.y; } }
  return `${who} ${gap.toFixed(2)} m away, top ${(top - world.terrain.height(foot.x, foot.z)).toFixed(2)} m over ground`;
};

const home = P.position.clone();
const rows = [];
let worstStall = 0, stuck = 0;
const secs = {};
for (let w = 0; w < 24; w++) {
  const a = (w / 24) * Math.PI * 2;
  P.position.set(home.x + Math.cos(a) * 16, home.y + 3, home.z + Math.sin(a) * 16);
  P.velocity.set(0, 0, 0);
  P.aimDir.set(-Math.cos(a), 0, -Math.sin(a)).normalize();
  P.yaw = Math.atan2(-P.aimDir.x, -P.aimDir.z);
  if (P.camera) { P.camera.yaw = P.yaw; P.camera.pitch = 0; }
  wish = { x: 0, y: -1 };
  step(30);
  const start = P.position.clone();
  let last = P.position.clone(), stallT = 0, worst = 0, path = 0, who = '—';
  for (let f = 0; f < 60 * 10; f++) {
    step(1);
    const moved = P.position.distanceTo(last);
    path += moved;
    last.copy(P.position);
    if (moved * 60 < 0.6 && P.grounded) {
      stallT += 1 / 60;
      const k = blockerAt(P.position).split(' ')[0];
      secs[k] = (secs[k] || 0) + 1 / 60;
      if (stallT > worst) { worst = stallT; who = blockerAt(P.position); }
    } else stallT = 0;
  }
  const net = P.position.distanceTo(start);
  worstStall = Math.max(worstStall, worst);
  if (net < 4) stuck++;
  rows.push({ w, net, path, worst, who });
}
rows.sort((x, y) => y.worst - x.worst);
console.log(`felled ${felled} (chained to ${F.stats.felled})`);
console.log(`24 ten-second walks: median net travel ${rows.map(r=>r.net).sort((a,b)=>a-b)[12].toFixed(1)} m, `
  + `worst net ${Math.min(...rows.map(r=>r.net)).toFixed(1)} m, walks that got under 4 m: ${stuck}`);
console.log('seconds stopped, by what stopped you, over 240 s of walking:',
  Object.fromEntries(Object.entries(secs).map(([k,v])=>[k,+v.toFixed(1)])));
console.log(`longest single unbroken stop: ${worstStall.toFixed(2)} s`);
for (const r of rows.slice(0, 5)) {
  console.log(`  walk ${r.w}: net ${r.net.toFixed(1)} m, path ${r.path.toFixed(1)} m, longest stop ${r.worst.toFixed(2)} s against ${r.who}`);
}
