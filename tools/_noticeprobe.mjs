/**
 * #25 LOST & FOUND, MEASURED — what is actually on the wall.
 *
 * The audit's reading was `{"said":[["LOST & FOUND","read the notices"]],
 * "meshes":7,"texts":0}` — forty blank rectangles under a verb that promises
 * reading. This is the same measurement, driven through the same door the game
 * uses, plus deck 40's whole draw bill against §12.2's 400. After `Notices.js`:
 * `{"meshes":20,"texts":13,"deck40Draws":156}` and the press answers with the
 * board rather than with the verb.
 *
 *   node --import ./tools/register.mjs tools/_noticeprobe.mjs
 */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), root));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
await prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const st = world._station;
const rec = [...st.places.values()].find((r) => r.place.id === 25);
let meshes = 0, texts = 0;
const said = [];
rec?.group?.traverse?.((o) => {
  if (!o.isMesh) return;
  meshes++;
  const m = o.material;
  if (m?.map) texts++;
});
/* The room's own press, exactly as `Player._readInput` reaches it. */
world.notify = (a, b) => said.push([a, b]);
const p = world.player.position;
p.set(rec.place.x, p.y, rec.place.z);
const { stationKey } = await import('../src/game/Station.js');
stationKey(world);
console.log(JSON.stringify({
  said, meshes, texts,
  deck40Draws: st.draws, tris: Math.round(st.tris / 1000) + 'k',
  notices: (st.notices?.panels?.length ?? null),
}));
world.dispose?.();
process.exit(0);
