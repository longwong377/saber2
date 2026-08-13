/**
 * Run ONE checks file, for iteration. `node tools/_one.mjs sanctum`.
 * The real gate is tools/verify.mjs; this only exists so a single survey does
 * not cost a four-minute full run.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const name = process.argv[2];
const mod = await import(`./checks/${name}.mjs`);
let pass = 0, fail = 0;
const check = (label, fn) => {
  try {
    const d = fn();
    if (d && typeof d.then === 'function') return d.then((x) => { pass++; console.log('✓', label, '—', x); },
      (e) => { fail++; console.log('✗', label, '\n   ', e.message); });
    pass++; console.log('✓', label, '—', d);
  } catch (e) { fail++; console.log('✗', label, '\n   ', e.stack); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol = 1e-6, m = '') => assert(Math.abs(a - b) <= tol, `${m} ${a} != ${b}`);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x, y, z, w) => new THREE.Quaternion(x, y, z, w);
await mod.run({ check, assert, near, V, Q, THREE });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
