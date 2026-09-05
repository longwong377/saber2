/* THROWAWAY PROBE — walkway occupancy, journeys, arrivals, handlers at heel.
 * One boot per (deck, quality); the hour is moved on the live world, which is
 * what `Station.js` itself does, so nine measurements cost three worlds. */
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

const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const idle = idleInput();
const SL = await import('../src/game/StationLife.js');
const { wayPlacesOn, headcount, slotIn, LIVE_RADIUS, primeStationLife } = SL;
const { Vector3 } = await import('three');

async function station(deck, quality) {
  const { prepareStation } = await import('../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, quality },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

const med = (v) => { const q = v.slice().sort((a, c) => a - c); return q.length ? q[q.length >> 1] : 0; };

async function sweep(deck, quality, hours) {
  const world = await station(deck, quality);
  try {
    const life = world._stationLife;
    const ways = wayPlacesOn(deck);
    const open = ways.find((p) => p.way === 'walk');
    world.player.position.set(open.x, world.player.position.y, open.z);
    world.player.body?.setTransform?.(world.player.position, null);
    for (const hour of hours) {
      world._station.hour = hour;
      life.priming = true;
      for (let i = 0; i < 60 && primeStationLife(world); i++) { /* fill */ }
      for (let i = 0; i < 900; i++) world.update(1 / 60, idle);
      const px = world.player.position.x, pz = world.player.position.z;
      /* Declared open-walk slots inside the live radius — the honest denominator. */
      let declared = 0;
      const V = new Vector3();
      for (const p of ways) {
        if (p.way !== 'walk') continue;
        const n = headcount(p, hour);
        for (let i = 0; i < n; i++) {
          slotIn(p, i, V);
          if (Math.hypot(V.x - px, V.z - pz) <= LIVE_RADIUS) declared++;
        }
      }
      let rooms = 0, fixture = 0, walkers = 0, handlers = 0, heel = 0;
      for (const [, b] of life.live) {
        if (b.stationWay === 'walk') walkers++;
        else if (b.stationWay) fixture++;
        else rooms++;
        const a = b._stationAnimal;
        if (a) { handlers++; if (!a.dead && Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= 8) heel++; }
      }
      const seen = new Map();
      for (const [, b] of life.live) {
        if (b.stationWay !== 'walk') continue;
        seen.set(b, { x: b.position.x, z: b.position.z, path: 0, net: 0, lx: b.position.x, lz: b.position.z, t0: b.wayTrips | 0, t1: b.wayTrips | 0, gone: false });
      }
      for (let i = 0; i < 3600; i++) {
        world.update(1 / 60, idle);
        for (const [b, s] of seen) {
          if (s.gone) continue;
          if (b.disposed || b.alive === false) { s.gone = true; continue; }
          s.path += Math.hypot(b.position.x - s.lx, b.position.z - s.lz);
          s.lx = b.position.x; s.lz = b.position.z;
          s.net = Math.hypot(b.position.x - s.x, b.position.z - s.z);
          s.t1 = b.wayTrips | 0;
        }
      }
      const rows = [];
      for (const [, s] of seen) rows.push({ net: s.net, path: s.path, trips: s.t1 - s.t0 });
      const netM = med(rows.map((r) => r.net)), pathM = med(rows.map((r) => r.path));
      const arrivals = rows.reduce((a, r) => a + r.trips, 0);
      console.log(
        `${quality.padEnd(4)} d${deck} h${String(hour).padStart(2)}  live=${String(life.live.size).padStart(2)}`
        + ` rooms=${String(rooms).padStart(2)} fixture=${String(fixture).padStart(2)} OPEN=${String(walkers).padStart(2)}/${declared}`
        + `  net=${netM.toFixed(1)}m path=${pathM.toFixed(1)}m straight=${(pathM ? netM / pathM : 0).toFixed(2)}`
        + ` arrived=${arrivals} tracked=${rows.length}  handlers=${handlers} heel=${heel}`
        + `  stepMs=${(life.stepMs || 0).toFixed(2)}`);
    }
  } finally { world.unload(); }
}

for (const deck of [40, 44, 48]) await sweep(deck, 'high', [8, 13, 21]);
await sweep(40, 'low', [13]);
await sweep(40, 'ultra', [13]);
