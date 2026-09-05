/* THROWAWAY — §G4 crowd, driven through the shipped frame loop. Delete me. */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
globalThis.__stationFetch = true;
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), root));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const S = await import('../src/game/Station.js');
const T = await import('../src/game/Tote.js');
const P = await import('../src/game/StationPlan.js');
await S.prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const idle = idleInput();
const st = world._station;

for (const venueId of ['holo-theatre', 'the-pit', 'the-arena']) {
  const v = T.venueById(venueId);
  const place = P.PLACES.find((p) => p.id === v.place);
  world.player.position.set(place.x, st.deckY + 1.6, place.z);
  world.player.camera?.obj?.position?.set(place.x, st.deckY + 1.6, place.z);

  // find a day with a card and pick the first race
  let day = 0, races = [];
  while (!races.length && day < 40) { races = T.racesOn(venueId, day); if (!races.length) day++; }
  const race = races[0];
  st.day = day;
  st.hour = race.hour - 0.02;
  // let the pool seat itself
  for (let i = 0; i < 240; i++) { st.hour = race.hour - 0.02; world.update(1 / 60, idle); }

  const live = () => [...(world._stationLife?.live?.keys() || [])].filter((k) => k.startsWith(v.place + ':')).length;
  console.log(`\n=== ${venueId} (#${v.place}) day ${day}, race at ${race.hour.toFixed(2)}, runs ${race.runs} h ===`);
  console.log(`crowd row: size ${v.crowd.size} temper ${v.crowd.temper} "${v.crowd.says}"`);

  // DARK-ROOM BASELINE: wind the clock to an hour with no meet on.
  let quietHour = null;
  for (let h = 0; h < 24; h += 0.25) if (T.watch(venueId, day, h).phase === 'dark' || !T.meetAt(venueId, day, h)) { quietHour = h; break; }
  st.hour = quietHour;
  for (let i = 0; i < 200; i++) { st.hour = quietHour; world.update(1 / 60, idle); }
  console.log(`  between meets (h ${quietHour.toFixed(2)}): in ${st.crowd.in}  level ${st.crowd.level}  bodies seated in room ${live()}  roars ${st.crowd.roars}`);

  // THE RACE, at §3.4's real rate: 1 station hour per 120 real seconds.
  st.crowd.roars = 0; st.crowd.turned = 0;
  let peak = 0, peakSpec = null, dullSpec = null, frames = 0, seatedPeak = 0;
  const specs = []; let lastRoars = 0;
  st.hour = race.hour - 0.01;
  const perFrame = (1 / 60) / 120;
  const trace = [];
  while (st.hour < race.hour + race.runs + 0.05) {
    st.hour += perFrame;
    world.update(1 / 60, idle);
    frames++;
    const c = st.crowd;
    seatedPeak = Math.max(seatedPeak, live());
    if (c.swell > peak) { peak = c.swell; peakSpec = c.spec; }
    if (c.roars > lastRoars) { lastRoars = c.roars; specs.push({ swell: c.swell, moment: c.moment, ...c.spec }); }
    if (frames % 120 === 0) trace.push(`${st.hour.toFixed(3)} in=${c.in} lvl=${c.level} swell=${c.swell} ${c.moment || '-'} roars=${c.roars}`);
  }
  console.log(`  ${frames} frames of world.update(1/60) across the race`);
  for (const t of trace) console.log('   ', t);
  const L = await import('../src/game/StationLife.js');
  console.log(`  peak swell ${peak.toFixed(3)}  roars ${st.crowd.roars}  bodies turned ${st.crowd.turned}  bodies seated peak ${seatedPeak}`);
  console.log(`  gazetteer headcount at ${(race.hour + 0.15).toFixed(2)}h alone: ${L.headcount(place, race.hour + 0.15)}  + tote crowd ${T.crowdAt(venueId, day, race.hour + 0.15).in}`);
  if (specs.length) {
    specs.sort((a, b) => a.swell - b.swell);
    const lo = specs[0], hi = specs[specs.length - 1];
    console.log(`  quietest roar  swell ${lo.swell} → gain ${lo.gain} shout ${lo.shout} freq ${lo.freq} dur ${lo.dur}`);
    console.log(`  loudest roar   swell ${hi.swell} → gain ${hi.gain} shout ${hi.shout} freq ${hi.freq} dur ${hi.dur}`);
  }
}
process.exit(0);
