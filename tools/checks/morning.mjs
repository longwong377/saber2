/**
 * V18 cool 8, 11, 12 — A MORNING, SLEEPING IN THE CABIN, A WINDOW SEAT.
 *
 *   · `Morning.js`: at 05:00 the ring's shopfronts on deck 40 are shuttered
 *     and at 08:00 they are not; the strips' emissive rises between 06:00 and
 *     07:00, sector by sector; the first tram's tannoy goes out on the frame
 *     the clock crosses six.
 *   · `Sleep.js`: the key at the bunk at 22:00 winds the clock to 07:00 the
 *     next day inside 8 s of wall time, `stationDay` advances by one through
 *     the fold, and the player is upright and alive after.
 *   · `DomeSeat.js`: a promenade seat facing the glass drives the camera
 *     outside `DRUM.R` for as long as the player sits, and the rig has it
 *     back inside once they stand.
 *   · None of the three rolls.
 *
 * THE SCAFFOLD, said plainly: the promenade's one loose chair is dropped by
 * the way-kiosk's kit wherever it lands, so the seat clause stands it on the
 * floor facing the skin before it presses the key — which way a kiosk's chair
 * falls is the kit's, not the seat's.
 */

import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** The station, through the door the game uses — `seated.mjs`'s own helper. */
async function station(deck = 40) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, quality: 'high' },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

export async function run({ check, assert, THREE }) {
  /* ════════════════════════════════════════════════════════════════════════
   *  THE SCHEDULE, PURE
   * ════════════════════════════════════════════════════════════════════════ */
  check('morning: the schedule — shut before six, open by seven, twelve sectors one at a time', async () => {
    const { morningPhase, SECTORS } = await import('../../src/game/Morning.js');
    const at5 = morningPhase(5), at6 = morningPhase(6), at630 = morningPhase(6.5), at7 = morningPhase(7), at8 = morningPhase(8), at2330 = morningPhase(23.6);
    assert(at5.shut === 1 && !at5.open, `05:00 shut ${at5.shut}`);
    assert(at8.shut === 0 && at8.open, `08:00 shut ${at8.shut}`);
    assert(at2330.shut === 1, `23:36 shut ${at2330.shut}`);
    assert(at5.lit < at6.lit + 1e-9 && at6.lit < at630.lit && at630.lit < at7.lit && at7.lit === 1, `lit ${at5.lit} ${at6.lit} ${at630.lit} ${at7.lit}`);
    assert(at5.sectors === 0 && at6.sectors === 1 && at630.sectors === 7 && at7.sectors === SECTORS, `sectors ${at5.sectors} ${at6.sectors} ${at630.sectors} ${at7.sectors}`);
    let last = -1;
    for (let h = 6; h <= 7; h += 1 / 60) { const n = morningPhase(h).sectors; assert(n >= last, `sectors fell at ${h}`); last = n; }
    return `05:00 shut, 06:30 ${at630.sectors}/${SECTORS} sectors at ${at630.lit.toFixed(2)}, 07:00 ${SECTORS}/${SECTORS}`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (a) THE SHUTTERS AND THE STRIPS, ON DECK 40
   * ════════════════════════════════════════════════════════════════════════ */
  check('morning: deck 40 — shuttered at 05:00, open at 08:00, the strips rise 06:00 → 07:00, the first tram is called', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const st = world._station, mo = st.morning;
      assert(mo, 'no st.morning — dressMorning did not run');
      const fronts = (st.ways || []).filter((w) => w.kind === 'shopfront');
      assert(fronts.length >= 3 && fronts.every((w) => w.shuttered), `${fronts.length} shopfronts on deck 40, ${fronts.filter((w) => w.shuttered).length} with a shutter`);
      assert(mo.shutters.length >= 3 && mo.sectors.length === 12, `${mo.shutters.length} shutters, ${mo.sectors.length} sectors`);
      const strip = st.mats.strip;
      const base = mo.base;
      /* Two frames: `stepDip` runs after the morning and writes the strips
       * ONCE on the first frame it ever sees (its rig has no floor yet); the
       * morning re-asserts on the next. */
      const at = (h) => { st.hour = h; step(world, 2 / 60, idle); };
      at(5);
      assert(mo.shutters.every((m) => m.visible), 'a shutter is hidden at 05:00');
      assert(mo.shut === 1, `shut ${mo.shut} at 05:00`);
      const i5 = strip.emissiveIntensity;
      assert(Math.abs(i5 - base * 0.3) < 1e-6, `strips at ${i5} at 05:00 for a base of ${base}`);
      assert(mo.sectors.every((m) => !m.visible), 'a sector run is lit at 05:00');
      at(6); const i6 = strip.emissiveIntensity; const s6 = mo.sectors.filter((m) => m.visible).length;
      at(6.5); const i65 = strip.emissiveIntensity; const s65 = mo.sectors.filter((m) => m.visible).length;
      assert(mo.shutters.every((m) => !m.visible) || mo.shut < 0.05, `shut ${mo.shut} at 06:30`);
      at(7); const i7 = strip.emissiveIntensity; const s7 = mo.sectors.filter((m) => m.visible).length;
      assert(i5 < i6 + 1e-9 && i6 < i65 && i65 < i7, `strips ${i5} → ${i6} → ${i65} → ${i7}`);
      assert(s6 < s65 && s65 < s7 && s7 === 12, `sectors ${s6} → ${s65} → ${s7}`);
      at(8);
      assert(mo.shutters.every((m) => !m.visible), 'a shutter is still down at 08:00');
      assert(mo.shut === 0, `shut ${mo.shut} at 08:00`);
      assert(Math.abs(strip.emissiveIntensity - base) < 1e-6, `strips at ${strip.emissiveIntensity} at 08:00`);
      /* The shutter is UP, not gone: at 05:00 it sat at its rest height. */
      const sh = mo.shutters[0];
      at(5);
      assert(Math.abs(sh.position.y - sh.userData.y0) < 1e-6, 'the shutter did not come back down');
      /* THE FIRST TRAM: run the clock across six. */
      at(5.995);
      assert(!mo.firstTram, 'the tram was called before six');
      let calls = 0, said = '';
      const notify = world.notify;
      world.notify = function (h, l) { if (/tram/i.test(l)) { calls++; said = `${h} — ${l}`; } return notify?.call(this, h, l); };
      step(world, 2, idle);
      world.notify = notify;
      assert(st.hour >= 6, `the clock did not cross six (${st.hour})`);
      assert(mo.firstTram && mo.firstTram.day === (st.day | 0), 'no first-tram call on the frame the clock crossed six');
      assert(calls === 1, `${calls} tram calls`);
      return `${fronts.length} shopfronts + ${mo.shutters.length - fronts.length} kiosk/stall shutters; strips ${i5.toFixed(2)} → ${i6.toFixed(2)} → ${i65.toFixed(2)} → ${i7.toFixed(2)} (base ${base}); sectors ${s6}/${s65}/${s7}; "${said}"`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (b) SLEEPING, FROM 22:00
   * ════════════════════════════════════════════════════════════════════════ */
  check('sleep: the key at the bunk at 22:00 → 07:00 next day inside 8 s, the day advances, the player stands', async () => {
    const { world, idle } = await station(44);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { homeKey } = await import('../../src/game/Home.js');
      const { bunkOf, atBed } = await import('../../src/game/Sleep.js');
      const { stationDay } = await import('../../src/game/StationSave.js');
      const st = world._station, pl = world.player, h = world._home;
      assert(h?.mine, 'no home dressed on deck 44');
      const b = bunkOf(h);
      assert(b, 'no bunk');
      st.hour = 22; st.day = stationDay(); st._savedHour = 22;
      const day0 = st.day | 0;
      /* Stand at the bedside, and press the key. */
      pl.position.set(b.side.x, b.side.y, b.side.z);
      step(world, 1 / 60, idle);
      pl.position.set(b.side.x, b.side.y, b.side.z);
      assert(atBed(world), `not at the bed: player ${pl.position.x.toFixed(1)},${pl.position.z.toFixed(1)} bunk ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
      assert(homeKey(world), 'the key was not spent at the bunk');
      assert(world._sleep?.active, 'no sleep began');
      const t0 = performance.now();
      let frames = 0, hourMid = null;
      while (world._sleep?.active && frames < 8 * 60) {
        step(world, 1 / 60, idle); frames++;
        if (frames === 150) hourMid = st.hour;
      }
      const wall = (performance.now() - t0) / 1000;
      const game = frames / 60;
      assert(!world._sleep, `still asleep after ${frames} frames`);
      assert(game <= 8, `the sequence took ${game.toFixed(1)} s of game time`);
      assert((st.day | 0) === day0 + 1, `day ${day0} → ${st.day} — the night did not roll the day`);
      assert(stationDay() === st.day, `the fold says day ${stationDay()}, the station day ${st.day}`);
      assert(Math.abs(st.hour - 7) < 0.1, `woke at ${st.hour.toFixed(2)}, not 07:00`);
      assert(pl.alive, 'the player is dead');
      assert(!pl.seat, 'the player is seated');
      assert(Math.abs(pl.position.y - b.side.y) < 0.6, `the player is at y ${pl.position.y.toFixed(2)}, the floor at ${b.side.y}`);
      assert(Math.hypot(pl.position.x - b.x, pl.position.z - b.z) < 2.5, 'the player did not wake by the bed');
      assert(st.slept && st.slept.hours >= 8.9, `slept ${st.slept?.hours}`);
      const cam = pl.camera?.camera;
      return `22:00 → ${st.hour.toFixed(2)} day ${day0} → ${st.day} in ${game.toFixed(2)} s game / ${wall.toFixed(2)} s wall (${frames} frames); at frame 150 the clock read ${hourMid?.toFixed(2)}; camera ${cam ? cam.position.toArray().map((v) => v.toFixed(1)).join(',') : 'none'}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (c) THE WINDOW SEAT
   * ════════════════════════════════════════════════════════════════════════ */
  check('dome seat: a promenade seat facing the glass takes the camera outside DRUM.R; standing brings it back', async () => {
    const { world, idle } = await station(44);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { DRUM } = await import('../../src/game/StationPlan.js');
      const { sitKey } = await import('../../src/game/StationSit.js');
      const { windowSeat } = await import('../../src/game/DomeSeat.js');
      const { SEAT_KINDS } = await import('../../src/game/Bars.js');
      const pl = world.player;
      const cam = pl.camera?.camera;
      assert(cam, 'no camera');
      /* The one seat on the ring. */
      const ring = world.props.filter((q) => SEAT_KINDS.has(q.kind) && Math.hypot(q.body.position.x, q.body.position.z) > DRUM.roomR);
      assert(ring.length, 'no seat on the promenade ring');
      const chair = ring[0];
      /* THE SCAFFOLD — see the header: on the floor, facing the skin. */
      const q = chair.body.position;
      const floorY = world.floorAt(q.x, q.z);
      const out = Math.atan2(q.x, q.z);
      chair.body.setTransform(new THREE.Vector3(q.x, floorY, q.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), out + Math.PI));
      chair.body.velocity.set(0, 0, 0); chair.body.angularVelocity.set(0, 0, 0);
      chair.mesh.position.copy(chair.body.position); chair.mesh.quaternion.copy(chair.body.quaternion);
      /* A metre inboard of it, and the key. */
      pl.position.set(q.x - Math.sin(out) * 1.0, floorY, q.z - Math.cos(out) * 1.0);
      step(world, 1 / 60, idle);
      pl.position.set(q.x - Math.sin(out) * 1.0, floorY, q.z - Math.cos(out) * 1.0);
      chair.body.velocity.set(0, 0, 0);
      assert(sitKey(world), 'the key did not sit the player');
      assert(pl.seat, 'no seat claim');
      const ws = windowSeat(world);
      assert(ws && ws.kind === 'promenade', `not a window seat: ${JSON.stringify(ws)} (seat yaw ${pl.seat.yaw.toFixed(2)}, bearing ${out.toFixed(2)})`);
      step(world, 1, idle);
      const rOut = Math.hypot(cam.position.x, cam.position.z);
      assert(world._domeShot, 'no dome shot while seated');
      assert(rOut > DRUM.R, `seated, the camera is at r ${rOut.toFixed(1)} — inside the drum (R ${DRUM.R})`);
      const a1 = Math.atan2(cam.position.x, cam.position.z);
      step(world, 2, idle);
      const a2 = Math.atan2(cam.position.x, cam.position.z);
      const turned = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
      assert(turned > 0.05, `the shot did not orbit (${turned.toFixed(3)} rad in 2 s)`);
      const state = world._domeShot.state;
      /* Stand. */
      pl.standUp();
      step(world, 1.5, idle);
      assert(!pl.seat, 'still seated after standing');
      assert(!world._domeShot, 'the dome shot outlived the seat');
      const rIn = Math.hypot(cam.position.x, cam.position.z);
      assert(rIn < DRUM.R, `standing, the camera is at r ${rIn.toFixed(1)} — still outside`);
      return `seated: camera at r ${rOut.toFixed(1)} (R ${DRUM.R}), orbiting ${(turned / 2).toFixed(3)} rad/s, battle ${state ? `${state.phase} ${state.shown}/${state.hulls} hulls` : 'none'}; standing: r ${rIn.toFixed(1)}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (d) NOTHING ROLLS
   * ════════════════════════════════════════════════════════════════════════ */
  check('morning/sleep/dome seat: no Math.random', async () => {
    const files = ['src/game/Morning.js', 'src/game/Sleep.js', 'src/game/DomeSeat.js'];
    for (const f of files) {
      const src = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
      assert(!/Math\.random/.test(src), `${f} calls Math.random`);
    }
    return files.join(', ');
  });
}
