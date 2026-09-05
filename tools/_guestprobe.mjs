import './dom-shim.mjs';
/* HOSTILE AUDIT — what a co-op GUEST actually gets on the station. Read-only. */
import { bootSession } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';
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
await prepareStation();
const s = await bootSession({
  n: 2,
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const snap = (w) => ({
  netMode: w.netMode,
  station: !!w._station,
  hour: w._station?.hour ?? null,
  places: w._station?.places?.size ?? 0,
  drawn: w._station ? [...w._station.places.values()].filter((r) => r.group?.parent).length : 0,
  bodies: (w.enemies || []).filter((e) => e && !e.dead).length,
  lift: w._lift ? { y: w._lift.y ?? w._lift.car?.position?.y ?? null, phase: w._lift.phase ?? null } : null,
  keepers: w._station?.keepers?.length ?? null,
});
const h0 = snap(s.host.world), c0 = snap(s.clients[0].world);
console.log('t=0   host', JSON.stringify(h0));
console.log('t=0   peer', JSON.stringify(c0));
s.pump(60);   // 60 simulated seconds = half a station hour
const h1 = snap(s.host.world), c1 = snap(s.clients[0].world);
console.log('t=60s host', JSON.stringify(h1));
console.log('t=60s peer', JSON.stringify(c1));
console.log('');
console.log(`clock advanced?   host ${h0.hour} -> ${h1.hour} (${(h1.hour - h0.hour).toFixed(4)})`);
console.log(`                  peer ${c0.hour} -> ${c1.hour} (${(c1.hour - c0.hour).toFixed(4)})`);
console.log(`bodies alive      host ${h1.bodies}   peer ${c1.bodies}`);
console.log(`places drawn      host ${h1.drawn}/${h1.places}   peer ${c1.drawn}/${c1.places}`);

/* Do residents MOVE on each side? */
const posOf = (w) => (w.enemies || []).filter((e) => e && !e.dead).slice(0, 40)
  .map((e) => `${e.position.x.toFixed(2)},${e.position.z.toFixed(2)}`).join(';');
const hA = posOf(s.host.world), cA = posOf(s.clients[0].world);
s.pump(10);
const hB = posOf(s.host.world), cB = posOf(s.clients[0].world);
console.log(`residents moved   host ${hA !== hB}   peer ${cA !== cB}`);

/* The lift: does pressing the call button take a guest anywhere? */
const { stepDeckLift } = await import('../src/game/DeckLift.js').catch(() => ({}));
console.log('lift object       host', !!s.host.world._lift, ' peer', !!s.clients[0].world._lift);
for (const nd of s.nodes) {
  const L = nd.world._lift;
  if (L) console.log(`   ${nd.name} lift keys: ${Object.keys(L).slice(0, 14).join(',')}`);
}
s.close();
process.exit(0);
