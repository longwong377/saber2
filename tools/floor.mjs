/**
 * WHAT THE EMPTY WORLD COSTS, AND WHAT IT SPENDS IT ON.
 *
 *   node --import ./tools/register.mjs tools/floor.mjs [--level geonosis] [--bodies 0]
 *
 * `tools/scale.mjs` measures a sweep and reports one number nobody has ever
 * explained: **an empty world costs 5.74 ms of CPU, 34% of a 16.67 ms frame,
 * with no soldier standing in it.** Every scale ambition is downstream of that
 * figure and no instrument has ever asked what it is made of.
 *
 * This is that instrument. Same discipline as `scale.mjs` and `_ledger.mjs`:
 * `process.cpuUsage()` rather than wall clock, the load average printed beside
 * the result, quality `high`, and the mode that runs the cross-army pass.
 *
 * It wraps `World.update`'s callees rather than sampling, because the question
 * is "which subsystem" and not "which line" — and a subsystem that costs
 * nothing at zero bodies but everything at fifty is a different finding from one
 * that is expensive before anybody arrives. Run it at both.
 */
import '../tools/dom-shim.mjs';
import * as THREE from 'three';
import { loadavg, cpus } from 'node:os';

if ((await import('three')) !== THREE) {
  console.error('\n  floor.mjs needs its loader: node --import ./tools/register.mjs tools/floor.mjs\n');
  process.exit(2);
}
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const LEVEL = flag('level', 'geonosis');
const MODE = flag('mode', 'command');
const BODIES = parseInt(flag('bodies', '0'), 10);
const FRAMES = parseInt(flag('frames', '240'), 10);

const H = await import('./checks/_coop.mjs');
const { Enemy, ARCHETYPES, enemyRng } = await import('../src/game/Enemy.js');
const cpuMs = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };

enemyRng.seed(20260823);
const { world } = await H.bootWorld({
  level: LEVEL, settings: { quality: 'high', difficulty: 'knight', mode: MODE },
});
const input = H.idleInput();
world.update(1 / 60, input);
/* Settle the dressing before the soldiers land — see the note in scale.mjs. */
for (let i = 0; i < parseInt(flag('warm', '1200'), 10); i++) world.update(1 / 60, input);

if (BODIES) {
  const p = world.player, kinds = ['b1', 'b1', 'b2', 'trooper'];
  for (let i = 0; i < BODIES; i++) {
    const a = (i / BODIES) * Math.PI * 2, r = 14 + (i % 9) * 4;
    const x = p.position.x + Math.cos(a) * r, z = p.position.z + Math.sin(a) * r;
    const e = new Enemy(world, kinds[i % kinds.length],
      new THREE.Vector3(x, world.terrain.height(x, z), z));
    e.team = i % 2 ? p.team : (p.team === 0 ? 1 : 0);
    world.enemies.push(e);
  }
}
for (let i = 0; i < 60; i++) world.update(1 / 60, input);

/* Wrap, don't sample. The cost of `cpuUsage()` is ~3.7 µs a call, so this is
 * only honest on subsystems called once a frame — which is what these are. */
const acc = {};
const wrap = (label, obj, key) => {
  if (!obj || typeof obj[key] !== 'function') return;
  const orig = obj[key];
  acc[label] = 0;
  obj[key] = function (...a) {
    const t = cpuMs();
    try { return orig.apply(this, a); } finally { acc[label] += cpuMs() - t; }
  };
};

wrap('physics.step', Object.getPrototypeOf(world.physics || {}), 'step');
wrap('terrain', Object.getPrototypeOf(world.terrain || {}), 'update');
wrap('grass', Object.getPrototypeOf(world.grass || {}), 'update');
wrap('water', Object.getPrototypeOf(world.water || {}), 'update');
wrap('atmosphere', Object.getPrototypeOf(world.atmosphere || {}), 'update');
wrap('director', Object.getPrototypeOf(world.director || {}), 'update');
wrap('command', Object.getPrototypeOf(world.command || {}), 'update');
wrap('bolts', Object.getPrototypeOf(world.bolts || {}), 'update');
wrap('corpses', Object.getPrototypeOf(world.corpses || {}), 'update');
wrap('particles', Object.getPrototypeOf(world.particles || {}), 'update');
wrap('extraction', Object.getPrototypeOf(world.extraction || {}), 'update');
wrap('props', Object.getPrototypeOf(world.props || {}), 'update');
const P = (await import('../src/game/Player.js')).Player;
wrap('player', P.prototype, 'update');
const E = (await import('../src/game/Enemy.js')).Enemy;
wrap('enemies', E.prototype, 'update');
wrap('  _pose', E.prototype, '_pose');
wrap('  _think', E.prototype, '_think');
wrap('  _move', E.prototype, '_move');

const t0 = cpuMs();
for (let i = 0; i < FRAMES; i++) world.update(1 / 60, input);
const total = (cpuMs() - t0) / FRAMES;

const alive = world.enemies.filter((e) => !e.dead).length;
console.log(`\n  floor — ${MODE} · ${LEVEL} · quality high · ${alive} bodies · ${FRAMES} frames`);
console.log(`  loadavg ${loadavg().map((x) => x.toFixed(1)).join(' ')} on ${cpus().length} cores\n`);
const rows = Object.entries(acc).map(([k, v]) => ({ k, ms: v / FRAMES }))
  .sort((a, b) => b.ms - a.ms).filter((r) => r.ms > 0.005);
let named = 0;
for (const r of rows) {
  named += r.ms;
  console.log(`  ${r.k.padEnd(14)} ${r.ms.toFixed(3).padStart(7)} ms  ${(r.ms / total * 100).toFixed(1).padStart(5)}%`);
}
console.log(`  ${'residual'.padEnd(14)} ${(total - named).toFixed(3).padStart(7)} ms  ${((total - named) / total * 100).toFixed(1).padStart(5)}%`);
console.log(`  ${'FRAME'.padEnd(14)} ${total.toFixed(3).padStart(7)} ms  (${(total / 16.67 * 100).toFixed(0)}% of a 16.67 ms budget)\n`);
