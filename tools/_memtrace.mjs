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
 * ── STATUS: ANSWERED, AND NOT BY THIS FILE ─────────────────────────────
 *
 * The question above is CLOSED and this tool is not what closed it. Keep the
 * record, because the way it failed is the reusable part.
 *
 * It produced no output at all in over ten minutes against `levels-quality` —
 * not even the `start` line, which is printed before any suite work begins. So
 * it was the TOOL that was wrong, not the finding, and an empty run from here
 * is not evidence about the game. The cause was diagnosed in this header and
 * the diagnosis was right: this harness calls the suite's `run({ check, ... })`
 * and then awaits `pending`, but `check` here returns immediately while
 * `verify.mjs`'s own runner owns the concurrency, so a suite written against
 * the real runner's sequencing builds six worlds at once instead of one. The
 * tool was reproducing the condition rather than measuring it.
 *
 * The next line of this header then named the right move — "instrument
 * `verify.mjs` itself with a `process.memoryUsage()` line per suite rather than
 * re-implement its runner here" — and that is what was done. `verify.mjs` now
 * prints RSS beside every suite's tally as it settles, from the runner that
 * actually runs, and it answers the peak-vs-leak question directly:
 *
 *     RSS climbs monotonically 366 MB → 1.8 GB across the whole run.
 *
 * Not a spike confined to two suites, so not the peak the cache was suspected
 * of; a slow accumulation across eighty. And it was not why either suite
 * stalled — that was one call site asking for 17.8 million particles a frame
 * (HANDOFF §2.7b). Both suites now finish, `cloth-cost` in 12.7 s and
 * `levels-quality` in 1 m 59 s, at unchanged memory.
 *
 * SO THE LESSON IS THE ONE THE FILE ALREADY GUESSED: a second copy of a runner
 * is a second thing that can disagree with the first, which is the exact defect
 * this project keeps removing (HANDOFF §2.4). It cost a tool and ten minutes to
 * learn a second time. This file is kept only because reaching for it again is
 * the natural mistake, and the header is where that gets stopped.
 *
 * If you want a per-suite memory reading, run the gate and read the RSS column.
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
