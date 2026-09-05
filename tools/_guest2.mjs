import './dom-shim.mjs';
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
import { bootSession } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';
await prepareStation();
const s = await bootSession({
  n: 2, level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const H = s.host.world, C = s.clients[0].world;
const own = (w) => (w.enemies || []).filter((e) => e && !e.dead && !e.netId && !e._net);
const net = (w) => (w.enemies || []).filter((e) => e && !e.dead && (e.netId || e._net));
const tag = (w) => (w.enemies || []).filter((e)=>e&&!e.dead).map((e)=>`${e.netId??e.id??'?'}`).slice(0,4);
console.log('enemy fields sample:', Object.keys(C.enemies?.[0] || {}).filter(k=>/net|remote|id/i.test(k)).join(','));
const mark = (w) => (w.enemies||[]).filter(e=>e&&!e.dead).map(e=>`${e.position.x.toFixed(2)}|${e.position.z.toFixed(2)}`);
const m0h = mark(H), m0c = mark(C);
s.pump(30);
const m1h = mark(H), m1c = mark(C);
let frozenC = 0; for (let i=0;i<Math.min(m0c.length,m1c.length);i++) if (m0c[i]===m1c[i]) frozenC++;
let frozenH = 0; for (let i=0;i<Math.min(m0h.length,m1h.length);i++) if (m0h[i]===m1h[i]) frozenH++;
console.log(`host bodies ${m0h.length} -> ${m1h.length}, of the first ${Math.min(m0h.length,m1h.length)} still at the exact same spot: ${frozenH}`);
console.log(`peer bodies ${m0c.length} -> ${m1c.length}, of the first ${Math.min(m0c.length,m1c.length)} still at the exact same spot: ${frozenC}`);
console.log('lift host', !!H._deckLift, ' peer', !!C._deckLift);
if (H._deckLift) console.log('  host lift floor', H._deckLift.floor ?? H._deckLift.n, 'phase', H._deckLift.phase, 'y', (H._deckLift.car?.position?.y ?? '?'));
if (C._deckLift) console.log('  peer lift floor', C._deckLift.floor ?? C._deckLift.n, 'phase', C._deckLift.phase, 'y', (C._deckLift.car?.position?.y ?? '?'));
/* Drive the lift on both sides: does the car move? */
const carY = (w) => w._deckLift?.car?.position?.y ?? w._deckLift?.y ?? null;
console.log('car y before  host', carY(H), 'peer', carY(C));
for (const w of [H, C]) { if (w._deckLift) { w._deckLift.want = 48; w._deckLift.target = 48; } }
s.pump(20);
console.log('car y after   host', carY(H), 'peer', carY(C));
console.log('lift phase    host', H._deckLift?.phase, 'peer', C._deckLift?.phase);
/* medbay / passStationHours reachable on a guest? */
const M = await import('../src/game/Medbay.js');
console.log('Medbay exports:', Object.keys(M).join(','));
s.close(); process.exit(0);
