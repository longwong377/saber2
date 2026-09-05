/* THROWAWAY PROBE — station cold-build profile. Delete when done.
 * node --import ./tools/register.mjs tools/_seamfix.mjs [scenario]
 *   scenarios: cold | seam | warm | all  (default all)  */
import './dom-shim.mjs';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import * as inspector from 'node:inspector';

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
const mark = (l, ms) => { T.push([l, ms]); };

/* ── a CPU profile over one region, aggregated by file ───────────────── */
let sess = null;
async function post(m, p) { return new Promise((res, rej) => sess.post(m, p, (e, r) => e ? rej(e) : res(r))); }
async function profStart() {
  if (process.env.NOPROF) return;
  sess = new inspector.Session(); sess.connect();
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 200 });
  await post('Profiler.start');
}
async function profStop(title) {
  if (!sess) return;
  const { profile: p } = await post('Profiler.stop');
  sess.disconnect(); sess = null;
  const self = new Map(); const dt = p.timeDeltas, sm = p.samples;
  for (let i = 0; i < sm.length; i++) self.set(sm[i], (self.get(sm[i]) || 0) + (dt[i] || 0));
  const byFile = new Map(), byFn = new Map();
  for (const n of p.nodes) {
    const url = (n.callFrame.url || '(node)').split('/').slice(-2).join('/');
    byFile.set(url, (byFile.get(url) || 0) + (self.get(n.id) || 0));
    const k = `${n.callFrame.functionName || '(anon)'} @ ${(n.callFrame.url || '').split('/').slice(-1)[0]}:${n.callFrame.lineNumber + 1}`;
    byFn.set(k, (byFn.get(k) || 0) + (self.get(n.id) || 0));
  }
  console.log(`\n=== ${title} — self time by file (ms) ===`);
  for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 14)) if (v > 20000) console.log((v / 1000).toFixed(0).padStart(8), k);
  /* inclusive time for the named build entry points */
  const parent = new Map();
  for (const n of p.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const total = new Map();
  for (const [id, t] of self) { let cur = id; const seen = new Set();
    while (cur != null && !seen.has(cur)) { seen.add(cur); total.set(cur, (total.get(cur) || 0) + t); cur = parent.get(cur); } }
  const inc = new Map();
  for (const n of p.nodes) { const k = `${n.callFrame.functionName || '(anon)'} @ ${(n.callFrame.url || '').split('/').slice(-1)[0]}`;
    inc.set(k, Math.max(inc.get(k) || 0, total.get(n.id) || 0)); }
  console.log(`--- ${title} — inclusive time, station entry points ---`);
  for (const [k, v] of [...inc].sort((a, b) => b[1] - a[1])) if (/Station|dress|Cast|Life|Boards|Kit|Plan|Deck|Vendor|Keeper|Crowd|Quest/.test(k) && v > 30000) console.log((v / 1000).toFixed(0).padStart(8), k);
  console.log(`--- ${title} — top functions ---`);
  for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 14)) if (v > 20000) console.log((v / 1000).toFixed(0).padStart(8), k);
}

let stepTag = '';
async function instrumentSteps() {
  const { World } = await import('../src/game/World.js');
  if (World.prototype.__profiled) return;
  const orig = World.prototype._loadSteps;
  World.prototype.__profiled = true;
  World.prototype._loadSteps = function (key, opts) {
    return orig.call(this, key, opts).map((s) => ({ name: s.name, run: () => {
      const a = performance.now(); s.run(); mark(`  [${stepTag}] ${s.name}`, performance.now() - a);
    } }));
  };
}

async function buildStation(tag, boot) {
  stepTag = tag;
  const t = performance.now();
  const { world } = await boot({ level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = 40; w._stationShaft = 'arrivals'; } });
  mark(`buildWorld station [${tag}] TOTAL`, performance.now() - t);
  return world;
}

async function main() {
  const which = process.argv[2] || 'all';
  const { bootWorld } = await import('./checks/_coop.mjs');
  await instrumentSteps();
  const { prepareStation } = await import('../src/game/Station.js');

  if (which === 'seam' || which === 'all') {
    /* THE REAL PLAYER PATH: the flight deck exists, then the lift is pressed. */
    stepTag = 'hangar';
    const th = performance.now();
    const { world: h } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    mark('buildWorld hangar (cold, before the seam)', performance.now() - th);
    h.dispose?.();
  }

  const tp = performance.now(); await prepareStation(); mark('prepareStation (cold)', performance.now() - tp);
  const tp2 = performance.now(); await prepareStation(); mark('prepareStation (warm)', performance.now() - tp2);

  await profStart();
  const w1 = await buildStation(which === 'seam' || which === 'all' ? 'seam' : 'cold', bootWorld);
  await profStop('station build #1');
  w1.dispose?.();

  await profStart();
  const w2 = await buildStation('warm', bootWorld);
  await profStop('station build #2 (warm)');
  w2.dispose?.();

  const w = 48;
  console.log('\n' + 'label'.padEnd(w) + 'ms');
  console.log('-'.repeat(w + 9));
  for (const [l, ms] of T) console.log(l.padEnd(w) + ms.toFixed(0).padStart(8));
}
main().catch((e) => { console.error(e); process.exit(1); });
