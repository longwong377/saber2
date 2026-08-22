/**
 * DO THE DEAD LIE ON THE GROUND, OR IN IT?
 *
 * `tools/_bodyaudit.mjs` reports 3–5 rigid bodies more than 0.6 m below the
 * terrain height under them whenever corpses are on the field, and none when
 * there are not. This asks the question one body at a time: kill bodies on
 * open ground, let them settle, and measure every bone against the surface it
 * fell onto.
 *
 *   node --import ./tools/register.mjs tools/_sinkbone.mjs [--level drifts] [--n 8]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const LEVEL = flag('level', 'drifts');
const N = Number(flag('n', '8'));
const TYPE = flag('type', 'b1');
const STEP = 1 / 30;

const { world } = await bootWorld({
  level: LEVEL, settings: { mode: 'sandbox', level: LEVEL, quality: 'high' }, runSeed: 7,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };

const made = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2;
  const p = new THREE.Vector3(Math.cos(a) * 14, 0, Math.sin(a) * 14);
  p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
  const e = world.spawnEnemy(TYPE, p);
  if (e) made.push(e);
}
run(1);
for (const e of made) { e.hp = 0; e.die?.(null, 'probe'); }
run(30);

let worst = 0, worstName = '', sunk = 0, total = 0;
for (const e of made) {
  const a = e.actor;
  if (!a?.bodies) continue;
  for (const [name, b] of a.bodies) {
    if (!b.position || !Number.isFinite(b.position.y)) { console.log(`  ${e.type}/${name} NON-FINITE`); continue; }
    total++;
    const g = world.terrain?.height?.(b.position.x, b.position.z);
    if (!Number.isFinite(g)) continue;
    const r = b.extent ? Math.max(b.extent.x, b.extent.z) : 0.08;
    const depth = g - (b.position.y - r);      // how far the bone's underside is under the surface
    if (depth > 0.25) { sunk++; if (depth > worst) { worst = depth; worstName = `${e.type}/${name}`; } }
  }
}
console.log(`${LEVEL}: ${made.length} corpses, ${total} bones, ${sunk} more than 25 cm under the surface`);
console.log(`deepest: ${worstName} at ${worst.toFixed(2)} m below`);
console.log(`settled=${world.corpses?.settled} retired=${world.corpses?.retired} inLedger=${world.corpses?.list.length}`);
process.exit(0);
