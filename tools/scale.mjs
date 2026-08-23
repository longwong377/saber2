/**
 * BATTLEFRONT BORZ — WHAT A BODY COSTS, AND THEREFORE HOW MANY THERE CAN BE.
 *
 *   node --import ./tools/register.mjs tools/scale.mjs [--mode command] [--quality high]
 *                                       [--counts 20,40,80,160] [--level geonosis]
 *
 * ── WHY THIS FILE EXISTS, AND WHAT IT REPLACES ───────────────────────────
 *
 * A scale plan was written on a benchmark that lived in a scratch directory and
 * was never committed, taken at quality `low`, headless with no render pass, in
 * wall-clock, with no load average beside it, and in `waves` — a mode where the
 * cross-army pass at `World.js:2743` does not run at all. It reported 198 µs a
 * body and a ceiling of 63. `tools/checks/frame-ledger.mjs`, measuring the same
 * population properly, reads 29.35 ms CPU for 48 bodies. The two disagreed by
 * 2.7x and the plan cited the cheaper one.
 *
 * Four rules, and each answers one of those faults:
 *
 *   CPU TIME, NOT WALL TIME. `process.cpuUsage()` counts only the time this
 *     process was on a core, so a box shared with a dozen agent lanes reports
 *     the cost of the work rather than the cost of the queue. `_ledger.mjs`
 *     measured a contention factor of 6.33 on this box; every wall-clock figure
 *     taken here was six times the truth.
 *
 *   THE LOAD AVERAGE IS PART OF THE MEASUREMENT. HANDOFF §2.6b: "Before you
 *     quote a millisecond, run `uptime`… Put the number in the report next to
 *     the measurement." It is printed on every line below.
 *
 *   THE MODE IS ONE THAT FIGHTS ITSELF. `World.js:2743` is an O(bodies²)
 *     cross-army pass and it is gated on `this.command` — so `waves` skips it
 *     entirely and `command`, `skirmish` and `campaign` do not. A benchmark of
 *     two armies has to run in a mode that has two armies, or it measures a
 *     horde against one player and calls the result linear.
 *
 *   THE QUALITY IS THE ONE A PLAYER USES. `low` is the only tier with bloom
 *     off and cloth at zero metres; measuring there and planning for `high` is
 *     measuring a different game.
 *
 * ── WHAT IT DOES NOT MEASURE ─────────────────────────────────────────────
 *
 * The render pass. There is no GPU here (HANDOFF §2.6) and a headless frame is
 * swiftshader at seconds a frame, so nothing about draw calls, skinning or
 * shadow cascades is knowable from this file. It answers ONE question — what
 * the simulation costs — and the draw-call budget is a separate instrument that
 * has to run in a browser. Do not quote this file for anything but simulation.
 */
import '../tools/dom-shim.mjs';
import * as THREE from 'three';
import { loadavg, cpus } from 'node:os';

if ((await import('three')) !== THREE) {
  console.error('\n  scale.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/scale.mjs\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (n, d) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const LEVEL = flag('level', 'geonosis');
const MODE = flag('mode', 'command');
const QUALITY = flag('quality', 'high');
const COUNTS = flag('counts', '20,40,80,160').split(',').map(Number);
const WARM = parseInt(flag('warm', '90'), 10);
const FRAMES = parseInt(flag('frames', '200'), 10);

const H = await import('./checks/_coop.mjs');
const { Enemy, ARCHETYPES, enemyRng } = await import('../src/game/Enemy.js');

const cpuMs = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };
const load = () => loadavg().map((x) => x.toFixed(1)).join(' ');

/* The kinds a real order of battle fields, not one archetype repeated: a wave
 * of identical bodies shares every branch and every cache line, which is the
 * cheapest possible population and not the one the game composes. */
const KINDS = ['b1', 'b1', 'b2', 'trooper', 'conscript', 'sniper'];

async function measure(n) {
  enemyRng.seed(20260823);
  const { world } = await H.bootWorld({
    level: LEVEL,
    settings: { quality: QUALITY, difficulty: 'knight', mode: MODE },
  });
  const input = H.idleInput();
  world.update(1 / 60, input);
  const p = world.player;
  if (!p) throw new Error('no player');

  /* HALF AND HALF, AND BOTH SIDES REAL. The point of running in `command` is
   * the cross-army pass, and it only costs anything if there is another army
   * for it to walk. A ring of hostiles around one player is the configuration
   * that made the old benchmark look linear. */
  let made = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 14 + (i % 9) * 4;
    const x = p.position.x + Math.cos(a) * r;
    const z = p.position.z + Math.sin(a) * r;
    const key = KINDS[i % KINDS.length];
    if (!ARCHETYPES[key]) continue;
    const y = world.terrain ? world.terrain.height(x, z) : 0;
    const e = new Enemy(world, key, new THREE.Vector3(x, y, z));
    e.team = i % 2 ? p.team : (p.team === 0 ? 1 : 0);
    world.enemies.push(e);
    made++;
  }

  for (let i = 0; i < WARM; i++) world.update(1 / 60, input);
  const alive = world.enemies.filter((e) => !e.dead).length;

  const c0 = cpuMs(), w0 = Date.now();
  for (let i = 0; i < FRAMES; i++) world.update(1 / 60, input);
  const cpu = (cpuMs() - c0) / FRAMES;
  const wall = (Date.now() - w0) / FRAMES;

  world.dispose?.();
  return { made, alive, cpu, wall, contention: wall / Math.max(cpu, 1e-6) };
}

console.log(`\n  scale — ${MODE} · ${LEVEL} · quality ${QUALITY} · ${FRAMES} frames after ${WARM} warm`);
console.log(`  loadavg ${load()} on ${cpus().length} cores\n`);

const rows = [];
for (const n of COUNTS) {
  const r = await measure(n);
  rows.push({ n: r.alive, ...r });
  console.log(`  ${String(r.alive).padStart(4)} alive   ${r.cpu.toFixed(2).padStart(7)} ms CPU`
    + `   ${r.wall.toFixed(1).padStart(7)} ms wall   contention x${r.contention.toFixed(2)}`);
}

/* THE MARGINAL COST IS A SLOPE, NOT A DIVISION. Dividing a frame by its body
 * count charges every body a share of the world's fixed overhead — terrain,
 * grass, the player, the physics step's own floor — and reports a per-body cost
 * that falls as the population rises, which is an artefact and not a finding.
 * Least squares over the whole sweep instead. */
if (rows.length >= 2) {
  const N = rows.length;
  const sx = rows.reduce((a, r) => a + r.n, 0);
  const sy = rows.reduce((a, r) => a + r.cpu, 0);
  const sxx = rows.reduce((a, r) => a + r.n * r.n, 0);
  const sxy = rows.reduce((a, r) => a + r.n * r.cpu, 0);
  const slope = (N * sxy - sx * sy) / (N * sxx - sx * sx);
  const base = (sy - slope * sx) / N;
  console.log(`\n  fixed overhead ${base.toFixed(2)} ms · marginal ${(slope * 1000).toFixed(0)} µs/body`);
  const room = 16.7 - base;
  console.log(`  ceiling at a 16.7 ms frame, SIMULATION ONLY: ${Math.floor(room / slope)} bodies`);
  /* Curvature, because the cross-army pass is quadratic and a straight line
   * through a curve reports a slope nobody's frame will see. If the last gap
   * is meaningfully steeper than the first, say so rather than averaging it
   * away. */
  const first = (rows[1].cpu - rows[0].cpu) / Math.max(1, rows[1].n - rows[0].n);
  const last = (rows[N - 1].cpu - rows[N - 2].cpu) / Math.max(1, rows[N - 1].n - rows[N - 2].n);
  const bend = last / Math.max(first, 1e-9);
  console.log(`  marginal at the bottom ${(first * 1000).toFixed(0)} µs · at the top ${(last * 1000).toFixed(0)} µs · bend x${bend.toFixed(2)}`
    + (bend > 1.4 ? '   <-- NOT LINEAR; the straight-line ceiling above is optimistic' : ''));
}
console.log('');
