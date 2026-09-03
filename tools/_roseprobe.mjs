/* scratch: is the rose's spread the unseeded Math.random in Combat.gradeCaught? */
import './dom-shim.mjs';
if (process.env.PIN_RANDOM) {
  let a = 12345 >>> 0;
  Math.random = () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
}
const B = await import('./_setbench.mjs');
const SH = await import('./checks/_shared.mjs');
const snap = await SH.snapshotShared();
for (const s of B.SETS) {
  const r = await B.rose(s, snap);
  console.log(`${s.padEnd(7)} ${r.landed}/${r.fired} landed · turned ${r.turned} · shoulder ${r.shoulder}`);
}
