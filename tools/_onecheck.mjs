/**
 * ONE CHECK, OUT OF ONE SUITE — for proving a guard goes red.
 *
 * `tools/_one.mjs <suite>` runs a whole file. `theline.mjs` is twenty-one
 * driven engagements and twenty-five minutes, so establishing that a single
 * assertion in it fails on the code it replaces — which is what this project
 * requires of every new guard — cost most of an hour per attempt, twice: once
 * to see it red and once to see it green again.
 *
 *   node --import ./tools/register.mjs tools/_onecheck.mjs <suite> <substring>
 *
 * Every check whose NAME contains the substring runs; the rest are skipped
 * before their body is entered, which is where the time is.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────
 *
 * NOT A GATE, and it must never be mistaken for one. Two things it does not do
 * that `verify.mjs` and `_one.mjs` both do:
 *
 *   IT DOES NOT RESTORE SHARED STATE between checks — `_shared.mjs`'s
 *     snapshot/restore is applied by the runner, and suites that wrap their own
 *     `check` (`clocked`) get it and suites that do not, do not. A run of two
 *     checks here is not the same run as those two inside the gate.
 *   IT DOES NOT REPORT A SUITE. "1 ran, 0 failed" says one assertion behaved,
 *     never that the file passes.
 *
 * So: use it to watch ONE assertion move, then run the suite properly. Anything
 * you would put in a commit message has to come from `_one.mjs` or the gate.
 */
import './dom-shim.mjs';

const [suite, needle] = process.argv.slice(2);
if (!suite || !needle) {
  console.error('\n  usage: node --import ./tools/register.mjs tools/_onecheck.mjs <suite> <name substring>\n');
  process.exit(2);
}

const mod = await import(`./checks/${suite}.mjs`);
if (typeof mod.run !== 'function') {
  console.error(`\n  tools/checks/${suite}.mjs exports no run()\n`);
  process.exit(2);
}

let ran = 0, failed = 0;
/**
 * EVERY CHECK'S PROMISE, KEPT — and this was wrong in the first cut of this
 * file, in the direction that reports success.
 *
 * A suite's `run()` calls `check(name, fn)` and DOES NOT AWAIT IT: menu.mjs's
 * own header says so out loud ("the runner starts every check as soon as the
 * one before it suspends"). So `await mod.run(...)` returns while an async
 * check body is still inside its first `await` — `ran` has already been
 * incremented, the `try` has not reached its `catch`, and the `process.exit`
 * at the foot of this file then killed the process before either could happen.
 *
 * Measured: an assertion made to fail on purpose printed "1 ran, 0 failed" and
 * no verdict line at all. A tool for proving a check goes red that reports
 * GREEN on a red check is worse than no tool, and it is the same "0 passed, 0
 * failed reads as success" defect this repo has been bitten by before.
 */
const pending = [];
/* The runner's own `assert`, in the one shape every suite is written against. */
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const check = (name, fn) => {
  if (!String(name).includes(needle)) return;
  ran++;
  const p = (async () => {
    try {
      const out = await fn();
      console.log('✓', name, out ? `— ${out}` : '');
    } catch (e) {
      failed++;
      console.log('✗', name, `\n    ${e && e.message}`);
    }
  })();
  pending.push(p);
  return p;
};

await mod.run({ check, assert });
await Promise.all(pending);
/* A substring that matches nothing is the "0 passed, 0 failed" defect this
 * repo has already been bitten by — it reads as success. It is not. */
if (!ran) {
  console.error(`\n  no check in ${suite}.mjs has ${JSON.stringify(needle)} in its name — nothing ran\n`);
  process.exit(2);
}
console.log(`${ran} ran, ${failed} failed`);
process.exit(failed ? 1 : 0);
