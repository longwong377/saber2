/**
 * Run ONE checks file, for iteration. `node tools/_one.mjs sanctum`.
 * The real gate is tools/verify.mjs; this only exists so a single survey does
 * not cost a four-minute full run.
 *
 * AND IT AWAITS THE ASYNC ONES, which it did not.
 *
 * `check` returned the promise for an async body and nothing ever held it, so
 * this exited the moment the synchronous checks were done. `tools/checks/coop.mjs`
 * — 27 real checks driving three live Net endpoints and two real Worlds —
 * reported `0 passed, 0 failed` through here and exited 0. So did every other
 * suite whose checks are async: session, lifecycle, answerable, beasts,
 * frame-budget, progression, levels-quality.
 *
 * That is worse than a broken tool. It is a tool that says the thing you just
 * changed is fine, in the file you reach for precisely BECAUSE you are
 * iterating and do not want to pay for the full run. `verify.mjs:56-74` drains
 * correctly, so the gate was never wrong — but nobody watches the gate while
 * they work.
 *
 * Found by the Audit 3 `notes` finder, which used it and got 0/0 on a suite it
 * could see 27 checks in.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const name = process.argv[2];
const mod = await import(`./checks/${name.replace(/\.mjs$/, '')}.mjs`);
let pass = 0, fail = 0;
const pending = [];
const lines = [];
const ok = (label, d) => { pass++; lines.push(`✓ ${label} — ${d ?? ''}`); };
const bad = (label, e) => { fail++; lines.push(`✗ ${label}\n    ${e && e.message ? e.message : String(e)}`); };
const check = (label, fn) => {
  try {
    const d = fn();
    // The promise goes on the list, not back to a caller that drops it.
    if (d && typeof d.then === 'function') pending.push(d.then((x) => ok(label, x), (e) => bad(label, e)));
    else ok(label, d);
  } catch (e) { bad(label, e); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol = 1e-6, m = '') => assert(Math.abs(a - b) <= tol, `${m} ${a} != ${b}`);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x, y, z, w) => new THREE.Quaternion(x, y, z, w);
const lerpN = (a, b, t) => a + (b - a) * t;
await mod.run({ check, assert, near, V, Q, THREE, lerpN });
await Promise.all(pending);
for (const l of lines) console.log(l);
/* A suite that ran nothing is a FAILURE, not a pass. This is the shape of the
 * defect above: a file with a typo in its name, or one whose checks all live
 * behind an import that threw, used to print "0 passed, 0 failed" and exit 0. */
if (pass + fail === 0) {
  console.log(`${name}: no checks ran at all`);
  process.exit(1);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
