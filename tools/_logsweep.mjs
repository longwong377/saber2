/**
 * HOW DEEP INTO THE HILL IS A FELLED TRUNK WHEN THE SOLVER IS FIRST HANDED IT?
 *
 * `_logsink.mjs` catches the mechanism at one spot. This walks the player over
 * the whole wood, felling the nearest trees at each stop, and collects the
 * distribution of how far a realised log's UNDERSIDE is below the terrain on
 * the frame `_realise` builds its body — which is the number a bound on the
 * lift has to be chosen against.
 *
 *   node --import ./tools/register.mjs tools/_logsweep.mjs [--stops 12] [--per 14]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const STOPS = Number(flag('stops', '12'));
const PER = Number(flag('per', '14'));
const STEP = 1 / 60;
const F = { X: 0, Z: 1, Y: 2, H: 3, R: 4, N: 15 };

const { world } = await bootWorld({
  level: 'wood', settings: { mode: 'sandbox', level: 'wood', quality: 'high' }, runSeed: 7,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };
const f = world.forest;
if (!f) { console.log('no forest'); process.exit(0); }
const N = Math.floor(f.data.length / F.N);
const g = (x, z) => world.terrain?.height?.(x, z) ?? NaN;

const depths = [];
let lost = 0, realised = 0;
const r0 = f._realise.bind(f);
f._realise = (i) => {
  r0(i);
  const rec = f.real.get(i);
  if (!rec) return;
  realised++;
  const b = rec.prop.body;
  const r = f.data[i * F.N + F.R];
  const half = b.extent ? b.extent.y : 0;
  const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quaternion);
  let deepest = 0;
  for (let s = -6; s <= 6; s++) {
    const q = b.position.clone().addScaledVector(ax, (s / 6) * half);
    const d = g(q.x, q.z) - (q.y - r);
    if (d > deepest) deepest = d;
  }
  depths.push({ i, deepest, len: half * 2, r, settled: null });
};

/** The same measurement, on a log that has had time to lie down. */
const depthOf = (i, rec) => {
  const b = rec.prop.body;
  const r = f.data[i * F.N + F.R];
  const half = b.extent ? b.extent.y : 0;
  const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quaternion);
  let deep = 0;
  for (let s = -6; s <= 6; s++) {
    const q = b.position.clone().addScaledVector(ax, (s / 6) * half);
    const d = g(q.x, q.z) - (q.y - r);
    if (d > deep) deep = d;
  }
  return deep;
};

const P = world.player.position;
for (let s = 0; s < STOPS; s++) {
  const a = (s / STOPS) * Math.PI * 2;
  const rad = 40 + (s % 3) * 45;
  const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
  P.set(x, g(x, z) + 1, z);
  world.player.body?.position?.set(x, g(x, z) + 1, z);

  const order = [];
  for (let i = 0; i < N; i++) {
    const k = i * F.N;
    const dx = f.data[k + F.X] - x, dz = f.data[k + F.Z] - z;
    order.push([i, dx * dx + dz * dz]);
  }
  order.sort((p, q) => p[1] - q[1]);
  for (const [i] of order.slice(0, PER)) {
    const b = (i * 2.399963) % (Math.PI * 2);
    f.fell(i, Math.cos(b), Math.sin(b), 0.6);
  }
  run(12);
  /* Anything that has left the world while we were standing here, and where
   * the ones that stayed have come to rest. */
  for (const [i, rec] of f.real) {
    const b = rec.prop.body;
    if (b.position.y < -50 || b.dead) lost++;
    const e = depths.find((d) => d.i === i);
    if (e) e.settled = { deep: depthOf(i, rec), v: b.velocity.length() };
  }
}

depths.sort((a, b) => b.deepest - a.deepest);
const under = depths.filter((d) => d.deepest > 0.05);
const q = (p) => (depths.length ? depths[Math.floor((depths.length - 1) * p)].deepest : 0);
console.log(`${STOPS} stops, ${realised} logs realised`);
console.log(`born with the underside below the terrain: ${under.length} of ${depths.length}`);
console.log(`deepest ${q(0).toFixed(2)} m · p90 ${q(0.1).toFixed(2)} · median ${q(0.5).toFixed(2)}`);
for (const d of depths.slice(0, 10)) {
  console.log(`  tree ${d.i}: ${d.deepest.toFixed(2)} m under, log ${d.len.toFixed(1)} m x r${d.r.toFixed(2)}`);
}
const rest = depths.filter((d) => d.settled);
const restUnder = rest.filter((d) => d.settled.deep > 0.10);
rest.sort((a, b) => b.settled.deep - a.settled.deep);
console.log(`\nof ${rest.length} logs seen again after twelve seconds, ${restUnder.length} are more than `
  + `10 cm into the ground; deepest ${(rest[0]?.settled.deep ?? 0).toFixed(2)} m`);
for (const d of rest.slice(0, 6)) {
  console.log(`  tree ${d.i}: born ${d.deepest.toFixed(2)} → settled ${d.settled.deep.toFixed(2)} m `
    + `(|v| ${d.settled.v.toFixed(2)})`);
}
console.log(`logs that had left the world or been culled while we watched: ${lost}`);
process.exit(0);
