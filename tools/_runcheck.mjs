/**
 * Run ONE check suite instead of the full thirteen minutes.
 *
 *   node --import ./tools/register.mjs tools/_runcheck.mjs <suite> [label substring|a|b]
 *
 * MUST go through the loader, for the reason HANDOFF 2.1 gives: without it
 * `three` resolves out of node_modules and the suite silently measures the
 * wrong copy. This is a development convenience and NOT the gate --
 * `npm run verify` is, and it passes suites context this file may not.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const name = process.argv[2];
let pass = 0, fail = 0;
const pending = [];
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
/* Verbatim from verify.mjs — a second definition that drifts would report
 * differently from the gate, which is worse than not having one. */
const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) throw new Error(`${msg}: ${a} vs ${b} (±${tol})`); };
const only = process.argv[3];
const check = (label, fn) => {
  if (only && !only.split("|").some((o) => label.includes(o))) return Promise.resolve();
  const p = (async () => {
    try { const r = await fn(); pass++; console.log(`  ✓ ${label}${r ? ' — ' + r : ''}`); }
    catch (e) { fail++; console.log(`  ✗ ${label}\n      ${e.message}`); }
  })();
  pending.push(p);
  return p;
};
const mod = await import(`./checks/${name}.mjs`);
await mod.run({ check, assert, THREE, near });
await Promise.all(pending);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
