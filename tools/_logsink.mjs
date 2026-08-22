/**
 * A FELLED TRUNK THAT SETTLED BELOW THE GROUND IT FELL ON.
 *
 * NEXT.md, still open: "Of nine trunks realised in the wood, four had surfaces
 * under the terrain and one had fallen to −179 m. The floor query is right
 * about all of them; the solver put them there."
 *
 * The fall is a hinge that does not know about the ground — `_layLog`'s own
 * note measures the consequence, "34 of the 83 had some part of themselves
 * buried and one was 90% of the way into a hillside, 13.2 m under at the deep
 * end". `_realise` then hands that pose to a DYNAMIC body.
 *
 * This hooks `_realise` and `_release` so every log is caught at both ends,
 * and it checks the durable damage as well as the frame: a log whose body ends
 * up more than 2 m from where it was born is marked `moved`, and `_release`
 * writes that position back into the tree record — so a trunk that fell out of
 * the world takes its tree with it, permanently.
 *
 *   node --import ./tools/register.mjs tools/_logsink.mjs [--trees 40] [--seconds 40]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const TREES = Number(flag('trees', '40'));
const SECONDS = Number(flag('seconds', '40'));
const STEP = 1 / 60;
const F = { X: 0, Z: 1, Y: 2, H: 3, R: 4, CUT: 11 };   // Trees.js's own layout

const { world } = await bootWorld({
  level: 'wood', settings: { mode: 'sandbox', level: 'wood', quality: 'high' }, runSeed: 7,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };

const f = world.forest;
if (!f) { console.log('no forest on this level'); process.exit(0); }
const N = Math.floor(f.data.length / 15);
const g = (x, z) => world.terrain?.height?.(x, z) ?? NaN;

/* Catch every realisation and release, whenever they happen. */
const born = new Map();
const r0 = f._realise.bind(f), rel0 = f._release.bind(f);
f._realise = (i) => {
  r0(i);
  const rec = f.real.get(i);
  if (!rec) return;
  const b = rec.prop.body;
  /* The log's LOWEST point, sampled along its own axis — `extent` is in the
   * body's local frame and a lying rod's long axis is its local +Y. */
  const r = f.data[i * 15 + F.R];
  const half = b.extent ? b.extent.y : 0;
  const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quaternion);
  let low = Infinity, deepest = 0;
  for (let s2 = -4; s2 <= 4; s2++) {
    const q = b.position.clone().addScaledVector(ax, (s2 / 4) * half);
    const y = q.y - r;
    if (y < low) low = y;
    const d = g(q.x, q.z) - y;
    if (d > deepest) deepest = d;
  }
  born.set(i, { y: b.position.y, ground: g(b.position.x, b.position.z), r, low, deepest,
    released: null, last: null });
};
f._release = (i, destroyed) => {
  const rec = f.real.get(i), e = born.get(i);
  if (rec && e) {
    const b = rec.prop.body;
    e.released = { y: b.position.y, ground: g(b.position.x, b.position.z), moved: rec.moved,
      dead: b.dead, inWorld: world.physics.bodies.includes(b) };
  }
  return rel0(i, destroyed);
};

const P = world.player.position;
const order = [];
for (let i = 0; i < N; i++) {
  const k = i * 15;
  const dx = f.data[k + F.X] - P.x, dz = f.data[k + F.Z] - P.z;
  order.push([i, dx * dx + dz * dz]);
}
order.sort((a, b) => a[1] - b[1]);
let felled = 0;
for (const [i] of order.slice(0, TREES)) {
  const a = (i * 2.399963) % (Math.PI * 2);          // a fixed spread of bearings
  if (f.fell(i, Math.cos(a), Math.sin(a), 0.6)) felled++;
}
console.log(`wood: ${N} trees, felled ${felled} of the ${TREES} nearest the player`);

for (let t = 0; t < SECONDS; t++) {
  run(1);
  for (const [i, rec] of f.real) {
    const e = born.get(i);
    if (!e) continue;
    const b = rec.prop.body;
    e.last = { t, y: b.position.y, ground: g(b.position.x, b.position.z), v: b.velocity.length(),
      dead: b.dead, inWorld: world.physics.bodies.includes(b) };
  }
}

console.log(`\n${born.size} logs were realised at some point; ${f.real.size} are real now`);
let bornUnder = 0, lost = 0;
for (const [i, e] of born) {
  const under = e.deepest;
  if (under > 0.05) bornUnder++;
  const end = e.last || e.released;
  const fell = end && (end.y < -50 || end.dead === true || end.inWorld === false);
  if (fell) lost++;
  if (under > 0.05 || fell) {
    console.log(`log ${i}: born y=${e.y.toFixed(2)} low=${e.low.toFixed(2)} ground=${e.ground.toFixed(2)} `
      + `→ ${under > 0.05 ? `BORN ${under.toFixed(2)} m INSIDE THE GROUND` : 'clear'}`
      + (end ? `  now y=${end.y.toFixed(2)} dead=${end.dead} inWorld=${end.inWorld}` : ''));
  }
}
console.log(`${bornUnder} of ${born.size} were born with their underside below the terrain; ${lost} left the world`);

/* THE DURABLE DAMAGE: the tree record itself. `_release` writes a moved log's
 * position back into `data`, so a trunk that fell out of the world takes its
 * tree with it for the rest of the level. */
let recBad = 0, worst = 0, worstAt = -1;
for (let i = 0; i < N; i++) {
  const k = i * 15;
  const y = f.data[k + F.Y];
  if (!Number.isFinite(y)) { recBad++; continue; }
  const gh = g(f.data[k + F.X], f.data[k + F.Z]);
  if (!Number.isFinite(gh)) continue;
  const d = gh - y;
  if (d > 3) { recBad++; if (d > worst) { worst = d; worstAt = i; } }
}
console.log(`\ntree records below their own ground by more than 3 m: ${recBad}`
  + (worstAt >= 0 ? `, worst tree ${worstAt} at ${worst.toFixed(1)} m under` : ''));
process.exit(0);
