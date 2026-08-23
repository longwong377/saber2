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

const REPEAT = parseInt(flag('repeat', '3'), 10);

/* THE ZERO ROW IS NOT OPTIONAL, and leaving it out is how the last version of
 * this file reported a "fixed overhead" that was an artefact of its own count
 * list. An empty world costs what it costs; measure it rather than extrapolating
 * back to it from a curve that is concave at the bottom. */
const SWEEP = [0, ...COUNTS];

const rows = [];
for (const n of SWEEP) {
  const takes = [];
  for (let r = 0; r < REPEAT; r++) takes.push(await measure(n));
  const cpu = takes.map((t) => t.cpu).sort((a, b) => a - b);
  const mid = cpu[Math.floor(cpu.length / 2)];
  const lo = cpu[0], hi = cpu[cpu.length - 1];
  const alive = Math.round(takes.reduce((a, t) => a + t.alive, 0) / takes.length);
  rows.push({ n: alive, cpu: mid, lo, hi });
  const spread = mid > 0 ? ((hi - lo) / mid * 100) : 0;
  console.log(`  ${String(alive).padStart(4)} alive   ${mid.toFixed(2).padStart(7)} ms CPU`
    + `   [${lo.toFixed(2)}–${hi.toFixed(2)}]   spread ${spread.toFixed(0)}%`
    + (spread > 25 ? '   <-- noisy' : ''));
}

/* ══ WHAT THIS FILE WILL AND WILL NOT CONCLUDE ═══════════════════════════
 *
 * The version before this one fitted a straight line to the sweep and printed a
 * fixed overhead, a marginal cost, a ceiling and a BEND. Re-run on a quiet box
 * it read a bend of 1.65, then 4.15, then 2.51, then 0.09 — four runs of one
 * tool on one tree. Every headline moved 40-150% and the ceiling additionally
 * depended on which `--counts` were passed.
 *
 * Two faults, and the second is the instructive one. The sweep is NOISY, which
 * `--repeat` answers. And the curve is the wrong SHAPE for a line: concave at
 * the bottom (the first few bodies are dear, because they wake systems the
 * empty world does not run) and convex at the top (the cross-army pass is
 * quadratic). A straight line through that reports two numbers that are both
 * artefacts of the count list, which is the same fault the note above rejects
 * `frame/bodies` for.
 *
 * So this prints the measured rows and the two conclusions the rows actually
 * support — the floor, and where the frame budget is crossed — and it refuses
 * to name a bend from fewer than three gaps.
 */
const floor = rows[0];
console.log(`\n  EMPTY WORLD ${floor.cpu.toFixed(2)} ms CPU — `
  + `${(floor.cpu / 16.67 * 100).toFixed(0)}% of a 16.67 ms frame with no soldier in it`);

const over = rows.find((r) => r.cpu > 16.67);
if (over) {
  const under = rows[rows.indexOf(over) - 1];
  console.log(`  OVER BUDGET between ${under ? under.n : 0} and ${over.n} bodies`
    + ` (${under ? under.cpu.toFixed(2) : '—'} → ${over.cpu.toFixed(2)} ms against 16.67)`);
} else {
  console.log(`  under 16.67 ms at every count measured (max ${rows[rows.length - 1].n})`);
}

const gaps = [];
for (let i = 1; i < rows.length; i++) {
  const dn = rows[i].n - rows[i - 1].n;
  if (dn > 0) gaps.push({ at: rows[i].n, us: (rows[i].cpu - rows[i - 1].cpu) / dn * 1000 });
}
console.log('  marginal by gap: ' + gaps.map((g) => `${g.us.toFixed(0)}µs@${g.at}`).join('  '));
if (gaps.length >= 3) {
  const a = gaps[0].us, z = gaps[gaps.length - 1].us;
  console.log(`  shape: ${a.toFixed(0)} µs at the bottom → ${z.toFixed(0)} µs at the top`
    + (z > a * 1.4 ? '   STEEPENING — superlinear, and a straight-line ceiling would flatter it' : ''));
} else {
  console.log('  shape: not stated — fewer than three gaps, and a bend from two points is not a bend');
}
console.log('');
