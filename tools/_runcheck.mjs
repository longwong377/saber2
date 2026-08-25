import './dom-shim.mjs';
const name = process.argv[2];
let pass = 0, fail = 0;
const pending = [];
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
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
await mod.run({ check, assert });
await Promise.all(pending);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
