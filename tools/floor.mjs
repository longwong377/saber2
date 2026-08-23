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
const { layoutNamed } = await import('./_layouts.mjs');
const LAYOUT = layoutNamed(flag('layout', 'ring'));

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
    /* THE SAME PLACEMENT `scale.mjs` USES, from the one module that states it.
     * A body's cost depends on where it stands — the ladder reads 30 m, 62 m
     * and 137.8 m — so two instruments that place bodies differently are
     * profiling two different games, and this file's whole job is to explain
     * the other one's numbers. */
    const { x, z } = LAYOUT(p, i, BODIES);
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
/* WHOSE ROW IS WHOSE, STATED AND NOT INDENTED. The tree used to be encoded in
 * leading spaces on the label, and the printer read `startsWith('    ')` as
 * "inside _pose" — which was already a lie about `pickTarget` (it is inside
 * `_think`) and became a second one the moment `_move` grew a child. A parent
 * is a fact about the call graph, so it is passed in. */
const parent = {};
const wrap = (label, obj, key, under = null) => {
  if (!obj || typeof obj[key] !== 'function') return;
  const orig = obj[key];
  acc[label] = 0;
  parent[label] = under;
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
wrap('_pose', E.prototype, '_pose', 'enemies');
wrap('_think', E.prototype, '_think', 'enemies');
wrap('_move', E.prototype, '_move', 'enemies');
/* INSIDE `_pose`, because at a battlefield's distances it is 44% of the frame
 * and "the animation is expensive" is not something you can act on. Four
 * terms, and each has a different answer if it is the one:
 *   `anim`    the skeletal solve itself — a rate cut is the lever
 *   `arms`    the IK that puts two hands on a weapon — a few pixels at 100 m
 *   `near`    the prop list a foot might stand on
 *   `ground`  the per-foot terrain height lookups
 * Nested one level further, so the sum still belongs to `_pose`. */
const BA = (await import('../src/game/Rig.js')).BipedAnimator;
wrap('anim', BA?.prototype, 'update', '_pose');
wrap('arms', E.prototype, '_poseArms', '_pose');
/* `_gatherNear` and `_groundAt` are called by BOTH `_pose` and `_move`, so
 * these two rows are the only ones in the table whose parent is a convenience
 * rather than a fact. They are filed under `_pose` because that is where the
 * eleven-queries-a-gait cost is; `_move` asks once. */
wrap('near', E.prototype, '_gatherNear', '_pose');
wrap('ground', E.prototype, '_groundAt', '_pose');
/* AND THE ONE INSIDE `_think`, which is the only O(bodies²) term in the frame:
 * every body walks every other body looking for the nearest hostile, so the
 * cost is a square and the row above it is a line. */
wrap('boxes', E.prototype, '_pushOutOfBoxes', '_move');
const W = (await import('../src/game/World.js')).World;
wrap('pickTarget', W.prototype, 'pickTarget', '_think');
wrap('hostilesFor', W.prototype, '_hostilesFor', '_think');

const t0 = cpuMs();
for (let i = 0; i < FRAMES; i++) world.update(1 / 60, input);
const total = (cpuMs() - t0) / FRAMES;

const alive = world.enemies.filter((e) => !e.dead).length;
console.log(`\n  floor — ${MODE} · ${LEVEL} · quality high · ${flag('layout', 'ring')} layout `
  + `· ${alive} bodies · ${FRAMES} frames`);
console.log(`  loadavg ${loadavg().map((x) => x.toFixed(1)).join(' ')} on ${cpus().length} cores\n`);
/**
 * Sorted by cost, EXCEPT that a child follows its parent — a `_pose` that
 * outweighs `physics.step` would otherwise be printed above the row it is a
 * part of, which reads as two independent costs.
 *
 * A NESTED ROW IS NOT A TERM OF THE SUM, and this printed a residual of
 * −17.3 ms until it was. `_pose`, `_think` and `_move` are called BY
 * `Enemy.update`, and `enemies` wraps `Enemy.update` — so every microsecond in
 * the three of them is already inside the one above. Adding all four gave a
 * `named` total larger than the frame and a negative residual, which is not a
 * small reporting slip: the residual is the number that says how much of the
 * frame this instrument cannot see, and a negative one says the instrument is
 * lying about the part it claims it can. Only roots are summed.
 */
const all = Object.entries(acc).map(([k, v]) => ({ k, ms: v / FRAMES, up: parent[k] || null }))
  .filter((r) => r.ms > 0.005);
const kids = (name) => all.filter((r) => r.up === name).sort((a, b) => b.ms - a.ms);
const rows = [];
const emit = (r, depth) => {
  rows.push({ ...r, depth });
  for (const c of kids(r.k)) emit(c, depth + 1);
};
for (const r of kids(null)) emit(r, 0);

let named = 0;
for (const r of rows) {
  if (r.depth === 0) named += r.ms;
  console.log(`  ${(' '.repeat(r.depth * 2) + r.k).padEnd(16)} ${r.ms.toFixed(3).padStart(7)} ms  `
    + `${(r.ms / total * 100).toFixed(1).padStart(5)}%`
    + (r.up ? `  (inside ${r.up})` : ''));
}
console.log(`  ${'residual'.padEnd(16)} ${(total - named).toFixed(3).padStart(7)} ms  ${((total - named) / total * 100).toFixed(1).padStart(5)}%`);
console.log(`  ${'FRAME'.padEnd(16)} ${total.toFixed(3).padStart(7)} ms  (${(total / 16.67 * 100).toFixed(0)}% of a 16.67 ms budget)\n`);
