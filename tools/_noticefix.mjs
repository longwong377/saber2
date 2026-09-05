/**
 * THROWAWAY PROBE — #25's reading, pressed, and the four dead exports.
 *
 *   node --experimental-loader ./tools/dom-shim.mjs tools/_noticefix.mjs
 * (or just `node tools/_noticefix.mjs`, which imports the shim first).
 */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
function diskFetch() {
  if (globalThis.__stationFetch) return;
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck) {
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

const DAYS = [0, 1, 2, 7, 30];

const St = await import('../src/game/Station.js');
const { PLACE } = await import('../src/game/StationPlan.js');

const world = await station(40);
const st = world._station;
const p25 = PLACE.get(25);

console.log('\n== #25, PRESSED, three presses a day ==');
for (const d of DAYS) {
  st.day = d;
  for (let k = 0; k < 3; k++) {
    let said = null;
    world.notify = (h, l) => { said = [h, l]; };
    world.player.position.set(p25.x, st.deckY + 1.6, p25.z);
    const took = St.stationKey(world);
    console.log(`day ${String(d).padStart(2)} press ${k + 1}: took=${took} ${JSON.stringify(said)}`);
  }
}
world.dispose?.();
