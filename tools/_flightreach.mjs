/**
 * ══════════════════════════════════════════════════════════════════════════
 *  CAN A PLAYER ACTUALLY REACH SHARK §7? — the lift door, then the five keys
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Two questions, in the order a player asks them:
 *
 *   1. THE DOOR. Standing on the Concourse, cycle the car's button column onto
 *      the flight-ops rows, step in, ride, and see what `onDeckLift` raises.
 *      That row is what `main.js`'s `enterStation` turns into `_stationFloor`.
 *   2. THE KEYS. Boot the level at each of those decks — the same thing
 *      `enterStation(row)` does — walk to each of #2–#6 and press `focus`
 *      through `Player._readInput`, not through `stationKey` directly.
 *
 * `requestAnimationFrame` never fires in this headless Chromium, so the
 * browser probe is void here; this drives `world.update(1/60, input)`, which is
 * the same loop `main.js` drives.
 *
 * THE PRESS IS SHAPED LIKE `Input`, NOT LIKE A ONE-SHOT. `Input.actHit` is
 * IDEMPOTENT within a frame — the edge set is consulted and cleared by `end()`
 * — and `_readInput` reads `actHit('thrust')` twice. An input that consumed
 * itself on the first read would starve the second and make a working feature
 * look dead.
 *
 *   node --import ./tools/register.mjs tools/_flightreach.mjs
 */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

/* `Levels.js` FIRST: `setLiftFloors` runs inside its `STATION_ENABLED` block at
 * module load, so a `liftFloors()` read before it is the one-row default. */
await import('../src/game/Levels.js');
const { bootWorld, idleInput, run } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const { PLACE, floorOf } = await import('../src/game/StationPlan.js');
const { liftFloors, liftPick, RIDE, STATE, atTheDoors, liftKey, LEVEL } = await import('../src/game/DeckLift.js');
const { LIFT } = await import('../src/game/Hangar.js');

/* No `fetch` in node — the imported rooms come off disk through the same
 * decoder the browser uses. `station.mjs`'s shim. */
if (!globalThis.__stationFetch) {
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}
await prepareStation();

const station = async (deck) => (await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = deck; w._stationShaft = 'flight'; },
})).world;

/** One press of `focus`, in `Input`'s own shape: true for every read this
 *  frame, gone the next. */
function pressInput(action = 'focus') {
  const hits = new Set([action]);
  const i = idleInput();
  i.actHit = (a) => hits.has(a);
  i.act = (a) => hits.has(a);
  i.end = () => hits.clear();
  return i;
}

console.log('── THE FLOOR LIST ────────────────────────────────────────────');
for (const f of liftFloors()) {
  console.log(`   ${String(f.n).padStart(2, '0')}  ${String(f.label).padEnd(30)} level=${f.level ?? '(menu)'} deck=${f.deck ?? '-'}`);
}

/* ── 1. THE DOOR: ride from the Concourse to each flight-ops floor ─────── */
console.log('\n── THE DOOR: the lift, from deck 40 ──────────────────────────');
for (const want of [32, 12]) {
  const world = await station(40);
  try {
    const idle = idleInput();
    const st = world._deckLift, sh = world._station.shaft;
    /* Out of the doorway, let the car go, then call it back — the same
     * sequence `station.mjs` uses, because a car standing open never leaves. */
    world.player.position.set(sh.x * 0.6, world._station.deckY + 1.0, sh.z * 0.6);
    world.player.body?.setTransform?.(world.player.position, null);
    run(world, 8.0, idle);
    let found = null;
    for (let dr = 0; dr <= 8 && !found; dr += 0.5) {
      for (let a = 0; a < 32 && !found; a++) {
        const th = (Math.PI * 2 * a) / 32;
        const x = sh.x + Math.cos(th) * dr, z = sh.z + Math.sin(th) * dr;
        world.player.position.set(x, world._station.deckY + 1.0, z);
        if (atTheDoors(world)) found = [x, z];
      }
    }
    liftKey(world);
    run(world, RIDE.arrive + RIDE.doors + 0.4, idle);

    /* THE BUTTON COLUMN, pressed the way a player presses it: `liftKey` from
     * inside the car cycles the pick one row at a time. */
    const at = st.place(LIFT.x, 0, LIFT.z);
    world.player.position.set(at.x, at.y + 1.0, at.z);
    world.player.body?.setTransform?.(world.player.position, null);
    let taps = 0;
    while (liftPick(world).deck !== want && taps < 12) { liftKey(world); taps++; run(world, 1 / 60, idle); }
    const caption = st.readout.caption, number = st.readout.number;

    let row = null, left = 0;
    world.onDeckLift = (r) => { row = r; };
    world.onDeckLeave = () => { left++; };
    run(world, 1.4 + RIDE.doors + RIDE.settle + RIDE.ride, idle, () => {
      world.player.position.set(at.x, at.y + 1.0, at.z);
    });
    console.log(`   → ${taps} tap(s) on the column: readout ${String(number).padStart(2, '0')} "${caption}"`
      + `  ·  the ride raised onDeckLift(${row ? `${row.n} "${row.label}" deck ${row.deck} shaft ${row.shaft}` : 'NOTHING'})`
      + `  onDeckLeave ${left}`);
  } finally { world.dispose?.(); }
}

/* ── 2. THE KEYS: press `focus` at each of #2 … #6 ────────────────────── */
console.log('\n── THE KEYS: one press of `focus` at each room ───────────────');
const { CERT } = await import('../src/game/FlightOps.js');

for (const [deck, ids] of [[32, [2, 3, 4]], [12, [5, 6]]]) {
  const world = await station(deck);
  try {
    const st = world._station;
    console.log(`\n   deck ${deck}: places ${[...st.places.keys()].join(', ')}`
      + `  ·  traffic board ${st.traffic ? 'BUILT' : 'null'}`);
    const said = [];
    world.notify = (a, b) => said.push([a, b]);
    /* The station clock at an hour with traffic on it and the pit working. */
    st.hour = 13.5;
    for (const id of ids) {
      const p = PLACE.get(id);
      for (const pass of [0, 1, 2, 3]) {
        /* #4 is a pit and its verb is the gantries, so the presses walk DOWN
         * it — `walkThePit` reads the player's height against `GANTRY_Y`. */
        const { GANTRY_Y } = await import('../src/game/StationKit.js');
        const y = id === 4 && pass > 0 ? floorOf(p) + GANTRY_Y[pass - 1] : floorOf(p) + 1.0;
        world.player.position.set(p.x, y, p.z);
        world.player.body?.setTransform?.(world.player.position, null);
        said.length = 0;
        world.update(1 / 60, pressInput('focus'));
        const line = said.map(([a, b]) => `${a}: ${b}`).join(' | ');
        console.log(`     #${id} ${p.name.padEnd(26)} press ${pass}  →  ${line || '(SILENCE — the key did nothing)'}`);
        if (id !== 4 && pass >= 1) break;
        if (id === 4 && pass >= 3) break;
      }
    }
    /* THE CERT, after those presses — the ladder is the thing the rooms are
     * load-bearing for. */
    const f = world._flight;
    console.log(`     cert: ${(f?.cert ?? []).join(', ') || 'nothing signed'}`
      + `  boards read ${f?.boards ?? 0}  gantries ${(f?.gantries ?? []).join('') || '-'}`);
    if (st.traffic) {
      const { trafficRows } = await import('../src/game/StationBoards.js');
      const rows = trafficRows({ day: st.day ?? 0, hour: st.hour, theatre: st.theatre, name: st.name });
      console.log('     THE TOWER BOARD, as the glass prints it:');
      for (const r of rows) console.log(`       ${typeof r === 'object' ? r.t : r}`);
    }
  } finally { world.dispose?.(); }
}
