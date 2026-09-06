/**
 * THE REGULARS AND THE FOLLOWER — V18 cool 10 and 13.
 *
 *   · Three talks make a regular, and the ledger survives the save fold.
 *   · A regular greets you first inside 4 m, once per visit, and the plate
 *     says so.
 *   · Today's curious one latches when you walk past, trails 2–4 m behind you
 *     for thirty seconds asking about the colour you actually carry, and stops
 *     when told to.
 *   · Neither module reads `Math.random`.
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

function put(world, x, y, z) {
  world.player.position.set(x, y, z);
  world.player.body?.position?.set?.(x, y, z);
}

export async function run({ check, assert }) {
  check('regulars: three talks make a regular, and it survives the save fold', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { talkTo } = await import('../../src/game/Station.js');
      const { isRegular, regularKey, REGULAR_AT } = await import('../../src/game/Regulars.js');
      const { regularsState, loadStation } = await import('../../src/game/StationSave.js');
      const log = [];
      world.onNotify = (t, s) => log.push([t, s]);
      step(world, 6, idle);
      const life = world._stationLife;
      const body = [...life.live.values()].find((b) => b?.stationSpecies && !b.stationKeeper && b.stationName && b.position && !b.wayR && b.standX !== undefined);
      assert(body, 'no resident to talk to on deck 40');
      const key = regularKey(body);
      for (let i = 1; i <= REGULAR_AT; i++) {
        assert(talkTo(world, body), `talk ${i} was not spent`);
        assert(regularsState()[key]?.n === i, `talk ${i}: the ledger says ${regularsState()[key]?.n}`);
        assert(isRegular(body) === (i >= REGULAR_AT), `talk ${i}: regular ${isRegular(body)}`);
      }
      const last = log[log.length - 1];
      assert(/A REGULAR/.test(last[0]), `the third talk's head is "${last[0]}"`);
      assert(/third|3 now/.test(last[1]), `the third talk does not say so: "${last[1]}"`);
      /* THE FOLD: what is on the disk is what the game will read back. */
      const raw = JSON.parse(localStorage.getItem('saber.station.v1'));
      assert(raw?.regulars?.[key]?.n === REGULAR_AT, `the save on disk carries ${JSON.stringify(raw?.regulars)}`);
      assert(loadStation().regulars[key].n === REGULAR_AT, 'loadStation() does not carry the regulars');
      /* Once more, so a fourth talk still counts. */
      talkTo(world, body);
      assert(regularsState()[key].n === REGULAR_AT + 1, 'the fourth talk did not count');
      world._regularsBody = body;
      /* ── THE GREETING: 3 m in front of them, once. ─────────────────── */
      log.length = 0;
      body.facing = 0.7; body.standFace = 0.7; body.standIn = 5;
      const px = body.position.x + Math.sin(body.facing) * 3, pz = body.position.z + Math.cos(body.facing) * 3;
      put(world, px, world.player.position.y, pz);
      step(world, 1, idle);
      const greets = log.filter(([t]) => t === `${String(body.stationNameBase || body.stationName).toUpperCase()} · A REGULAR`);
      assert(greets.length === 1, `${greets.length} greetings inside a second, want 1: ${JSON.stringify(log)}`);
      assert(/\S/.test(greets[0][1]) && !/undefined|NaN/.test(greets[0][1]), `an empty greeting: "${greets[0][1]}"`);
      const d = Math.hypot(world.player.position.x - body.position.x, world.player.position.z - body.position.z);
      assert(d <= 4.2, `greeted from ${d.toFixed(2)} m`);
      assert(/— a regular$/.test(body.stationRole), `the plate says "${body.stationRole}"`);
      step(world, 6, idle);
      const again = log.filter(([t]) => /A REGULAR/.test(t)).length;
      assert(again === 1, `${again} greetings over seven seconds standing there — want one per visit`);
      /* Somebody who is NOT a regular does not greet. */
      const other = [...life.live.values()].find((b) => b?.stationSpecies && !b.stationKeeper && b !== body && b.position && !b.wayR && b.standX !== undefined);
      if (other) {
        log.length = 0;
        other.facing = 0; other.standFace = 0; other.standIn = 5;
        put(world, other.position.x, world.player.position.y, other.position.z + 2.5);
        step(world, 2, idle);
        assert(!log.some(([t]) => /A REGULAR/.test(t)), 'a stranger greeted you as a regular');
      }
      console.log(`      regular after ${REGULAR_AT} talks; greeted at ${d.toFixed(2)} m: "${greets[0][1]}"`);
    } finally { try { world.dispose?.(); } catch {} }
  });

  check('follower: latches on the walk, trails 2–4 m for 30 s asking about your colour, and goes when told', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { talkTo } = await import('../../src/game/Station.js');
      const { stationDay } = await import('../../src/game/StationSave.js');
      const { curiousPoint, follower, saberFacts, FOLLOW } = await import('../../src/game/Follower.js');
      const log = [];
      world.onNotify = (t, s) => log.push([t, s]);
      const st = world._station, life = world._stationLife;
      const pick = curiousPoint(40, stationDay() | 0, st.hour);
      assert(pick, 'no walk on deck 40 to pick a curious one from');
      /* Stand at their slot so the pool seats it, then find the body. */
      put(world, pick.x, world.player.position.y, pick.z);
      let body = null;
      for (let i = 0; i < 12 && !body; i++) { step(world, 0.5, idle); body = life.live.get(pick.key); }
      assert(body?.position, `the curious slot ${pick.key} was never seated`);
      /* Walk past them. */
      put(world, body.position.x + 1.5, world.player.position.y, body.position.z + 1.5);
      step(world, 1.5, idle);
      const F = follower(world);
      assert(F && F.body === body, 'walking past the curious one did not latch them');
      assert(/asking about your saber/.test(body.stationRole), `the plate says "${body.stationRole}"`);
      /* Round the ring at a walk, for thirty seconds, measuring the gap. */
      const R = Math.hypot(world.player.position.x, world.player.position.z);
      let a = Math.atan2(world.player.position.x, world.player.position.z);
      const speed = 1.8, dt = 1 / 60;
      const gaps = [];
      for (let i = 0; i < 30 * 60; i++) {
        a += speed * dt / R;
        put(world, R * Math.sin(a), world.player.position.y, R * Math.cos(a));
        world.update(dt, idle);
        if (i >= 3 * 60) gaps.push(Math.hypot(world.player.position.x - body.position.x, world.player.position.z - body.position.z));
      }
      assert(follower(world)?.body === body, `they stopped following inside 30 s (${world._follower?.lastEnd || 'released'})`);
      const inBand = gaps.filter((g) => g >= 2 && g <= 4).length / gaps.length;
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      assert(inBand >= 0.9, `only ${(inBand * 100).toFixed(0)}% of frames inside 2–4 m (mean ${mean.toFixed(2)} m)`);
      const sp = body.velocity ? Math.hypot(body.velocity.x, body.velocity.z) : 0;
      assert(sp > 0.5, `the gait has no velocity to play: ${sp.toFixed(2)} m/s`);
      /* The questions name the colour you actually carry. */
      const colour = saberFacts(world).colour.toLowerCase();
      const asked = [...new Set(log.filter(([t]) => t === F.name.toUpperCase()).map(([, s]) => s))];
      assert(asked.length >= 2, `${asked.length} distinct questions in 30 s: ${JSON.stringify(asked)}`);
      const named = asked.filter((q) => q.includes(colour));
      assert(named.length >= 1, `no question names the ${colour} blade: ${JSON.stringify(asked)}`);
      /* "Go away." */
      log.length = 0;
      assert(talkTo(world, body), 'the interact key on the follower was not spent');
      assert(!follower(world), 'told to go away, they are still following');
      assert(log.length === 1 && log[0][0] === F.name.toUpperCase(), `the dismissal was ${JSON.stringify(log)}`);
      assert(!body.wayMission && body.standX !== undefined, 'a dismissed follower is not a standing body');
      assert(!/asking about/.test(body.stationRole), `the plate still says "${body.stationRole}"`);
      const here = { x: body.position.x, z: body.position.z };
      for (let i = 0; i < 5 * 60; i++) {
        a += speed * dt / R;
        put(world, R * Math.sin(a), world.player.position.y, R * Math.cos(a));
        world.update(dt, idle);
      }
      const drift = Math.hypot(body.position.x - here.x, body.position.z - here.z);
      assert(drift < 2.5, `dismissed, they still moved ${drift.toFixed(2)} m in five seconds`);
      assert(!follower(world), 'a second follower latched on the same visit');
      console.log(`      latched at ${FOLLOW.latch} m; gap mean ${mean.toFixed(2)} m, ${(inBand * 100).toFixed(0)}% in 2–4 m; asked ${asked.length}: ${JSON.stringify(asked)}`);
    } finally { try { world.dispose?.(); } catch {} }
  });

  check('follower: released at the tram', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { stationDay } = await import('../../src/game/StationSave.js');
      const { curiousPoint, follower } = await import('../../src/game/Follower.js');
      const st = world._station, life = world._stationLife;
      const pick = curiousPoint(40, stationDay() | 0, st.hour);
      put(world, pick.x, world.player.position.y, pick.z);
      let body = null;
      for (let i = 0; i < 12 && !body; i++) { step(world, 0.5, idle); body = life.live.get(pick.key); }
      assert(body, 'no curious one');
      put(world, body.position.x + 1.5, world.player.position.y, body.position.z + 1.5);
      step(world, 1.5, idle);
      assert(follower(world), 'did not latch');
      world._tramRide = { boardedAt: 0, from: 0 };
      step(world, 0.5, idle);
      assert(!follower(world), 'followed you onto the tram');
      world._tramRide = null;
    } finally { try { world.dispose?.(); } catch {} }
  });

  check('regulars/follower: no Math.random in either module', async () => {
    for (const f of ['Regulars.js', 'Follower.js']) {
      const src = await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8');
      assert(!/Math\.random/.test(src), `${f} reads Math.random`);
    }
  });
}
