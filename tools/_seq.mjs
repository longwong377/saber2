/**
 * BATTLEFRONT BORZ — SEVERAL SUITES IN ONE PROCESS, IN ORDER.
 *
 * The gap between `_one.mjs` and `verify.mjs`, and it is where a whole class of
 * failure lives. `_one.mjs` runs a suite in a clean process; `verify.mjs` runs
 * all ninety in one process and takes thirteen minutes. A check that passes
 * alone and fails in the full run is therefore expensive to even LOOK at, and
 * §6.4's own advice — "a red line in a full run is not a finding until it has
 * been re-run alone" — sends you to the tool that cannot reproduce it.
 *
 *     node --import ./tools/register.mjs tools/_seq.mjs cleave cloth-cost
 *
 * Two suites, one process, in the order given. That is usually enough: the
 * carrier is nearly always the suite immediately before, because what carries
 * is module-scope state (`enemyRng` and `duelRng`, the wave stream, `wind` and
 * `ground` in Scenery.js, Engine's once-only ShaderChunk flags) or, as in the
 * case this was written for, the SCHEDULING of a suite's own async checks.
 *
 * ── THE CASE IT WAS WRITTEN FOR, because it is the one nobody expects ────
 *
 * `check()` pushes every async check onto one `Promise.all`, so a suite's
 * checks INTERLEAVE. `cloth-cost` built one 31-body world behind a shared
 * promise and tore it down in one check's `finally`; a later check awaited the
 * same promise and read `world.player` off it. Alone, it happened to read
 * first. With `cleave` ahead of it — three checks' worth of different await
 * timing — it read second and got null. Nothing about cloth was wrong and
 * nothing about `cleave` was wrong. Only `_seq` made that visible in 40
 * seconds instead of thirteen minutes.
 *
 * Only failures are printed, with four frames of stack, because the point is
 * the one line that differs from the clean run. Exits non-zero if any fail.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const names = process.argv.slice(2);
if (!names.length) {
  console.error('\n  Run: node --import ./tools/register.mjs tools/_seq.mjs <suite> [suite...]\n');
  process.exit(2);
}
/* THE LOADER IS NOT OPTIONAL, and this is `_one.mjs`'s guard verbatim in
 * behaviour: two namespace objects are the same object iff they are the same
 * module instance, which is the whole question and cannot be fooled by when it
 * is asked. Without the loader there are two copies of three in the process and
 * every measurement is taken against whichever one the suite did not import. */
if ((await import('three')) !== THREE) {
  console.error('\n  tools/_seq.mjs was started without its module loader — two copies of three\n'
    + '  are loaded and the checks will measure the wrong one.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/_seq.mjs <suite> [suite...]\n');
  process.exit(2);
}

let pass = 0, fail = 0;
for (const raw of names) {
  const name = raw.replace(/\.mjs$/, '');
  const mod = await import(`./checks/${name}.mjs`);
  const pending = [], bad = [];
  let p0 = pass, f0 = fail;
  const ok = () => { pass++; };
  const no = (label, e) => {
    fail++;
    const stack = e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : String(e);
    bad.push(`✗ ${name}: ${label}\n    ${stack}`);
  };
  const check = (label, fn) => {
    try {
      const d = fn();
      if (d && typeof d.then === 'function') pending.push(d.then(ok, (e) => no(label, e)));
      else ok();
    } catch (e) { no(label, e); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
  const near = (a, b, tol = 1e-6, m = '') => assert(Math.abs(a - b) <= tol, `${m} ${a} != ${b}`);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const Q = (x, y, z, w) => new THREE.Quaternion(x, y, z, w);
  const lerpN = (a, b, t) => a + (b - a) * t;
  await mod.run({ check, assert, near, V, Q, THREE, lerpN });
  await Promise.all(pending);
  for (const l of bad) console.log(l);
  console.log(`  ${name.padEnd(22)} ${pass - p0} passed, ${fail - f0} failed`);
}
console.log(`\n${pass} passed, ${fail} failed across ${names.length} suite(s) in one process`);
process.exit(fail ? 1 : 0);
