/* THROWAWAY. Delete when the lane closes. */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck = 12) {
  const { bootWorld } = await import('./checks/_coop.mjs');
  const { prepareStation } = await import('../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

/** An input we can drive: `hit` is edge-triggered for one frame, `held` level. */
export function stick() {
  const hit = new Set(), held = new Set();
  const ax = { x: 0, y: 0 };
  return {
    hit, held, ax,
    act: (id) => held.has(id) || hit.has(id),
    actHit: (id) => hit.has(id),
    actDown: (id) => held.has(id) || hit.has(id),
    moveAxis: (o) => { if (o) { o.x = ax.x; o.y = ax.y; return o; } return { x: ax.x, y: ax.y }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
    end() { hit.clear(); this.mouse.dx = 0; this.mouse.dy = 0; },
  };
}

const world = await station(12);
const { PLACE, floorOf } = await import('../src/game/StationPlan.js');
const { CERT } = await import('../src/game/FlightOps.js');

const st = world._station;
world._flight = { v: 1, cert: CERT.map((c) => c.id), gantries: [0, 1, 2], boards: 3, bells: [], sorties: 0 };

const bay = PLACE.get(5);
const p = world.player;
p.position.set(bay.door[0], floorOf(bay), bay.door[1]);
p.body?.position?.copy(p.position);

const input = stick();
const said = [];
const notify0 = world.notify?.bind(world);
world.notify = (t, l) => { said.push(`${t}: ${l}`); notify0?.(t, l); };

const dt = 1 / 60;
function step(n, each) { for (let i = 0; i < n; i++) { world.update(dt, input); each?.(i); input.end(); } }

console.log(`deck ${st.deck} hour ${st.hour.toFixed(3)} — standing at #5 door`);
step(6);
input.hit.add('focus');
step(1);
console.log('after the press:', said.slice(-3));
console.log('sortie?', world._sortie?.way, world._sortie?.phase, 'flying', !!world._flying);

const p0 = p.position.clone();
let maxD = 0;
step(60 * 12, () => { maxD = Math.max(maxD, p.position.distanceTo(p0)); });
console.log(`12 s in: flying=${!!world._flying} phase=${world._sortie?.phase} u=${(world._orbitU ?? 0).toFixed(3)} bodyMoved=${maxD.toFixed(3)} m`);
console.log('bay', JSON.stringify(st.bay));
console.log('driving?', !!p.driving, 'firstPerson', p.camera.firstPerson);
console.log('hour', st.hour.toFixed(4), 'sorties', world._flight.sorties);
console.log('said:', said.slice(-6));

/* ── (2) killed mid-flight ─────────────────────────────────────────────── */
const hourAtDeath = st.hour;
p.die?.('probe');
console.log(`\nkilled mid-flight at hour ${hourAtDeath.toFixed(4)} — over=${world.over}`);
step(60 * 60);
console.log(`60 s later: flying=${!!world._flying} sortie=${world._sortie?.way}/${world._sortie?.phase} done=${world._sortie?.done}`);
console.log(`  u=${(world._orbitU ?? 0).toFixed(3)} hour=${st.hour.toFixed(4)} (advanced ${(st.hour - hourAtDeath).toFixed(4)})`);
console.log(`  sorties=${world._flight.sorties} mine=${JSON.stringify(st.mine)} playerAt=${p.position.toArray().map(n=>n.toFixed(1)).join(',')}`);
