import './dom-shim.mjs';
import * as THREE from 'three';
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
const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const H = await import('../src/game/Home.js');
const HAB = await import('../src/game/Habitat.js');
const K = await import('../src/game/Kennel.js');
const S = await import('../src/game/StationSave.js');
diskFetch();
await prepareStation();
const station = async () => (await bootWorld({ level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 44; } })).world;

const count = (r) => { let d = 0, t = 0; r?.traverse?.((o) => { if (o.isMesh && o.geometry) { d++; const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { d, t: Math.round(t) }; };

S.clearStation(); K.clear();
console.log('— WHAT SUITS WHAT —');
const { COMPANION_ORDER, COMPANION_KINDS } = await import('../src/game/CompanionKinds.js');
for (const id of COMPANION_ORDER) console.log(' ', id.padEnd(8), String(H.padSuit(id)));

console.log('\n— THE CHOICE, AT THE HABITAT —');
K.adopt('hawk', 'KITE');
let p = HAB.habitatPanel();
console.log('  live         ', p.rec?.kind, p.rec?.name);
console.log('  pad.who      ', JSON.stringify(p.pad.who));
console.log('  pad.chosen   ', JSON.stringify(p.pad.chosen));
console.log('  rows         ', p.pad.rows.map((r) => `${r.id}${r.fits ? '*' : ''}`).join(' '));
HAB.choosePad('perch');
console.log('  after choose ', JSON.stringify(H.homePad()), 'fold=', JSON.stringify(S.homeState()?.pad));

console.log('\n— IN THE ROOM —');
let w = await station();
let h = w._home;
console.log('  state.pad    ', JSON.stringify(h.state.pad));
console.log('  h.pad        ', h.pad && { id: h.pad.id, rest: h.pad.rest, meshes: h.pad.meshes.length, seated: !!h.pad.root });
if (h.pad?.root) {
  h.pad.root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(h.pad.root);
  const s = b.getSize(new THREE.Vector3());
  console.log('  bird bbox    ', `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m, feet at y=${b.min.y.toFixed(3)} (floor ${h.y}, rest ${h.pad.rest})`);
  console.log('  bird cost    ', JSON.stringify(count(h.pad.root)));
}
console.log('  homeRecord   ', JSON.stringify(H.homeRecord(w)));
w.dispose?.();
console.log('  after leave  ', JSON.stringify(S.homeState()?.pad));

console.log('\n— RELOAD —');
w = await station(); h = w._home;
console.log('  state.pad    ', JSON.stringify(h.state.pad), 'fixture', !!h.pad, 'seated', !!h.pad?.root);
console.log('\n— SWITCH FROM THE HABITAT WITH THE ROOM UP —');
HAB.choosePad('basket', w);
console.log('  h.pad        ', w._home.pad && { id: w._home.pad.id, seated: !!w._home.pad.root });
HAB.choosePad(null, w);
console.log('  taken out    ', w._home.pad, 'fold=', JSON.stringify(S.homeState()?.pad));
w.dispose?.();
