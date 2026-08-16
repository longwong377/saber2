/**
 * WHAT A SUITE COSTS IN MEMORY, and whether it gives it back.
 *
 * Written for one question: `verify.mjs` hangs on `levels-quality.mjs` in both
 * orders while that suite passes alone in 74 s (HANDOFF 2.7). Two explanations
 * fit — a PEAK (that suite holds six fully-built Worlds at once, deliberately)
 * or a LEAK somewhere else that it merely tips over — and they want opposite
 * fixes, so guessing between them is worth nothing.
 *
 * This runs one named suite N times in a single process and prints RSS and
 * heap before, at peak, and after. Flat across repeats means the suite gives
 * back what it takes and the hang is not it. Climbing means it does not.
 *
 *   node --import ./tools/register.mjs --expose-gc tools/_memtrace.mjs levels-quality 3
 *
 * ── STATUS: WRITTEN, NOT YET ANSWERED ──────────────────────────────────
 *
 * I ran it against `levels-quality` and it produced no output at all in over
 * ten minutes — not even the `start` line, which is printed before any suite
 * work begins. So it is the TOOL that is wrong here, not the finding, and the
 * next person should not take an empty run as evidence about the game.
 *
 * The most likely cause, and where to look first: this harness calls the
 * suite's `run({ check, ... })` and then awaits `pending`, but `check` here
 * pushes a promise and returns immediately, while `verify.mjs`'s own runner
 * owns the concurrency. A suite whose checks assume the real runner's
 * sequencing can therefore have six worlds building at once instead of one,
 * which on this machine is exactly the condition being investigated — so the
 * tool may be reproducing the hang rather than measuring it. That is worth
 * knowing either way, but it is not what the header promises, so the header
 * says so.
 *
 * The cheaper next move is probably to instrument `verify.mjs` itself with a
 * `process.memoryUsage()` line per suite rather than to re-implement its
 * runner here — the second copy of a runner being the exact defect this
 * project keeps removing (HANDOFF 2.4).
 */
import './dom-shim.mjs';

const name = process.argv[2] || 'levels-quality';
const reps = Number(process.argv[3] || 3);

const MB = (n) => (n / 1048576).toFixed(0).padStart(5);
const now = () => process.memoryUsage();
const line = (tag, m) => console.log(`  ${tag.padEnd(16)} rss ${MB(m.rss)} MB   heap ${MB(m.heapUsed)} MB   ext ${MB(m.external)} MB`);

/* The suite's own contract: `run({ check, assert, near, THREE })`, where
 * `check` may be sync or async and the runner awaits what it returns. This is
 * the smallest harness that satisfies it — not a copy of verify.mjs's, because
 * a second copy of the runner is a second thing that can disagree with it, and
 * nothing here depends on how results are FORMATTED. */
const THREE = await import('three');
let passed = 0, failed = 0;
const pending = [];
const assert = (ok, msg) => { if (!ok) throw new Error(msg || 'assert'); };
const near = (a, b, eps = 1e-6, msg) => assert(Math.abs(a - b) <= eps, msg || `${a} vs ${b}`);
const check = (title, fn) => {
  const r = (async () => {
    try { await fn(); passed++; } catch (e) { failed++; console.log(`  ✗ ${title}: ${e.message}`); }
  })();
  pending.push(r);
  return r;
};

console.log(`\n  ${name} x${reps}\n`);
global.gc?.();
line('start', now());

let peak = 0;
for (let i = 1; i <= reps; i++) {
  const mod = await import(`./checks/${name}.mjs?rep=${i}`);
  pending.length = 0;
  await mod.run({ check, acheck: check, assert, near, THREE });
  await Promise.all(pending);
  const m = now();
  peak = Math.max(peak, m.rss);
  line(`after rep ${i}`, m);
  global.gc?.();
  await new Promise(r => setTimeout(r, 200));
  global.gc?.();
  line(`  collected`, now());
}
console.log(`\n  peak rss ${MB(peak)} MB · ${passed} passed, ${failed} failed\n`);
