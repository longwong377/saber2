/* TWO SUITES IN ONE PROCESS, in the gate's order.
 *
 * `_runcheck.mjs` runs one suite and `verify.mjs` runs all 203; a red that is
 * green alone and red in the gate lives in the gap between them, and this is
 * the smallest thing that can hold it. Same `clocked` contract, same restore,
 * same process. */
import './dom-shim.mjs';
import * as THREE from 'three';
const names = process.argv.slice(2);
const only = process.env.ONLY || null;
let pass = 0, fail = 0;
const pending = [];
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m}: ${a} vs ${b} (±${tol})`); };
for (const name of names) {
  console.log(`\n=== ${name} ===`);
  const check = (label, fn) => {
    if (only && !only.split('|').some((o) => label.includes(o))) return Promise.resolve();
    const p = (async () => {
      try { const r = await fn(); pass++; console.log(`  ✓ ${label}${r ? ' — ' + r : ''}`); }
      catch (e) { fail++; console.log(`  ✗ ${label}\n      ${e.message}`); }
    })();
    pending.push(p);
    return p;
  };
  const mod = await import(`./checks/${name}.mjs`);
  await mod.run({ check, assert, THREE, near });
  await Promise.all(pending.splice(0));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
