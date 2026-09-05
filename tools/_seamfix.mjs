/* THROWAWAY PROBE — station cold-build profile. Delete when done. */
import './dom-shim.mjs';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}
diskFetch();

const T = [];
function mark(label, ms) { T.push([label, ms]); }

async function main() {
  const t0 = performance.now();
  const { bootWorld } = await import('./checks/_coop.mjs');
  mark('import _coop + module graph', performance.now() - t0);

  const t1 = performance.now();
  const { prepareStation } = await import('../src/game/Station.js');
  mark('import Station.js', performance.now() - t1);

  const t2 = performance.now();
  await prepareStation();
  mark('prepareStation (cold)', performance.now() - t2);

  const t2b = performance.now();
  await prepareStation();
  mark('prepareStation (warm)', performance.now() - t2b);

  // Instrument World._loadSteps
  const { World } = await import('../src/game/World.js');
  const orig = World.prototype._loadSteps;
  let tag = 'cold';
  World.prototype._loadSteps = function (key, opts) {
    const steps = orig.call(this, key, opts);
    return steps.map((s) => ({ name: s.name, run: () => {
      const a = performance.now();
      s.run();
      mark(`  [${tag}] step: ${s.name}`, performance.now() - a);
    } }));
  };

  const t3 = performance.now();
  const { world } = await bootWorld({ level: 'station', settings: { mode: 'station', quality: 'low' },
    onWorld: (w) => { w._stationFloor = 40; w._stationShaft = 'arrivals'; } });
  mark('bootWorld station COLD (total)', performance.now() - t3);

  world.dispose?.();

  tag = 'warm';
  const t4 = performance.now();
  const { world: w2 } = await bootWorld({ level: 'station', settings: { mode: 'station', quality: 'low' },
    onWorld: (w) => { w._stationFloor = 40; w._stationShaft = 'arrivals'; } });
  mark('bootWorld station WARM (total)', performance.now() - t4);
  w2.dispose?.();

  const w = 46;
  console.log('\n' + 'label'.padEnd(w) + 'ms');
  console.log('-'.repeat(w + 10));
  for (const [l, ms] of T) console.log(l.padEnd(w) + ms.toFixed(1).padStart(9));
}
main().catch((e) => { console.error(e); process.exit(1); });
