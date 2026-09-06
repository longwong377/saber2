/**
 * V20 LANE 2 — MOTION AND PARTICLES.
 *
 * The player: *"Motion everywhere. Doors that open, fans that turn, screens
 * that flicker, steam from the galley, litter that drifts in the atrium's
 * draught. Nothing static in view."*
 *
 * Every clause here drives the SHIPPED loop — `world.update` on a real station
 * — rather than calling `StationMotion` in isolation, because the failure this
 * lane can have is not "the function is wrong", it is "the function is never
 * called", which is the defect `stationlife.mjs`'s own header records against
 * the whole event table. The one exception is the litter's minute, which is
 * stepped through `stepStationMotion` directly: sixty seconds of a full world
 * is three thousand six hundred physics ticks and forty bodies for a fact
 * about twenty quads.
 */
import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** The station, through the door the game uses — `stationlife.mjs`'s own. */
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

/** Stand the player at a world point and hold him there for `secs`, stepping
 *  the real world. A station body is under physics and drifts otherwise. */
function stand(world, idle, x, y, z, secs) {
  const dt = 1 / 60;
  const n = Math.round(secs / dt);
  const p = world.player;
  for (let i = 0; i < n; i++) {
    if (p?.position) {
      p.position.set(x, y, z);
      p.body?.position?.set?.(x, y, z);
      p.velocity?.set?.(0, 0, 0);
    }
    world.update(dt, idle);
  }
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const MO = await import('../../src/game/StationMotion.js');
  const { DRUM, DECK_Y } = await import('../../src/game/StationPlan.js');

  /* ════════════════════════════════════════════════════════════════════════
   *  (a) THE DOORS
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: a door parts for a body at 2 m, shuts behind it, and its collider follows the leaves', async () => {
    /**
     * The whole contract in one walk. A door that opened but left its box
     * standing would be a wall the player can see through, which is worse
     * than no door; a door that opened and never put the box back would be a
     * room with no wall at all. So both ends are probed on the SAME door, in
     * the shipped loop, at the two moments that matter.
     */
    const { world, idle } = await station(44);
    try {
      const st = world._station;
      const mo = st.motion;
      assert(mo, 'no `st.motion` — `dressStationMotion` never ran');
      assert(mo.doors.length >= 6, `only ${mo.doors.length} doors on deck 44`);
      /* A DOOR NOBODY IS STANDING AT, chosen rather than named: the pool
       * seats residents where the day's table says, and on deck 44 somebody
       * lives 2.50 m from #27's reveal and holds it open all hour — which is
       * the door working, not the door broken. */
      stand(world, idle, 0, DECK_Y[44] + 1.0, 60, 3);
      const d = mo.doors.find((q) => q.open < 0.05 && q.box);
      assert(d, `every one of the ${mo.doors.length} doors on deck 44 had a body at it`);
      assert(d.open < 0.05, `#${d.id} is ${(d.open * 100) | 0}% open with nobody near it`);
      assert(d.box.disabled === false, `#${d.id}'s collider is disabled while the door is shut`);
      /* Two metres outside it, on the walk the door faces. */
      const inx = d.place.x - d.cx, inz = d.place.z - d.cz;
      const L = Math.hypot(inx, inz) || 1;
      const x = d.cx - (inx / L) * 2.0, z = d.cz - (inz / L) * 2.0;
      stand(world, idle, x, d.y + 1.0, z, 1.5);
      assert(d.open > 0.95, `#${d.id} is only ${(d.open * 100) | 0}% open with a body 2 m from it`);
      assert(d.box.disabled === true, `#${d.id}'s collider is still solid while the leaves are open`);
      /* And the leaves are where `open` says: the inner edge of a leaf is at
       * ±gap/2 when open, which is inside the wall beside the reveal. */
      const opened = d.open;
      /* Away again: it holds for DOOR_HOLD and then runs shut. */
      stand(world, idle, 0, DECK_Y[44] + 1.0, 60, 1.0);
      assert(d.open > 0.5, `#${d.id} started shutting inside ${MO.DOOR_HOLD} s of the body leaving`);
      stand(world, idle, 0, DECK_Y[44] + 1.0, 60, 2.0);
      assert(d.open < 0.05, `#${d.id} is still ${(d.open * 100) | 0}% open ${MO.DOOR_HOLD + 1} s after the body left`);
      assert(d.box.disabled === false, `#${d.id}'s collider did not come back when the leaves shut`);
      return `#${d.id} ${d.gap.toFixed(1)} m: shut→${(opened * 100) | 0}% at 2 m, box off; shut again after ${MO.DOOR_HOLD} s, box on; ${mo.doors.length} doors on deck 44`;
    } finally { world.dispose?.(); }
  });

  check('stationmotion: no door is hung where the kit cut no doorway, and none is wider than a door', async () => {
    /**
     * The rule the lane was given — open fronts, glazed shopfronts and tram
     * platforms get none — held against the kit's own record rather than
     * against a list in this file. `st.doorways` is written on the one line in
     * `StationKit.walls`/`arcFront` that cuts a reveal, so a room that never
     * reaches it cannot acquire leaves by accident.
     */
    const bad = [];
    let doors = 0, cut = 0;
    for (const deck of [40, 44, 48]) {
      const { world } = await station(deck);
      try {
        const st = world._station;
        cut += st.doorways?.size || 0;
        doors += st.motion.doors.length;
        for (const d of st.motion.doors) {
          if (d.gap > MO.DOOR_MAX_GAP) bad.push(`#${d.id} ${d.place.name} has a ${d.gap} m pair of leaves`);
          if (!st.doorways.has(d.id)) bad.push(`#${d.id} has leaves and no doorway`);
        }
        /* Nothing on a tram platform. */
        for (const rec of st.places.values()) {
          if (!rec.place.stop) continue;
          if (st.motion.doors.some((d) => d.id === rec.place.id)) bad.push(`#${rec.place.id} is a tram platform and has a door`);
        }
      } finally { world.dispose?.(); }
    }
    assert(doors >= 25, `only ${doors} doors on the three drum decks`);
    assert(bad.length === 0, `${bad.length} doors are wrong:\n      ${bad.join('\n      ')}`);
    return `${doors} sliding pairs hung in ${cut} cut doorways over three decks, none over ${MO.DOOR_MAX_GAP} m`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (b) THE FANS
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: every fan turns, and the ones that should be in a room are in it', async () => {
    const seen = [];
    const still = [];
    for (const deck of [40, 44, 48]) {
      const { world, idle } = await station(deck);
      try {
        const mo = world._station.motion;
        const was = mo.fans.map((f) => f.mesh.rotation.y);
        stand(world, idle, 0, DECK_Y[deck] + 1.0, 40, 1.0);
        for (let i = 0; i < mo.fans.length; i++) {
          if (Math.abs(mo.fans[i].mesh.rotation.y - was[i]) < 1e-3) still.push(`deck ${deck} fan ${i}`);
        }
        seen.push(`${deck}:${mo.fans.length}`);
        /* And each hangs inside the room's own group, so the door cull turns
         * it off with the room rather than drawing it across the drum. */
        for (const f of mo.fans) {
          assert(f.mesh.parent?.parent?.name?.startsWith('station-place-'),
            `a fan on deck ${deck} is parented to ${f.mesh.parent?.parent?.name || 'nothing'}`);
        }
      } finally { world.dispose?.(); }
    }
    assert(still.length === 0, `${still.length} fans stood still: ${still.join(', ')}`);
    const total = seen.reduce((a, s) => a + Number(s.split(':')[1]), 0);
    assert(total >= 10, `only ${total} fans on the three decks`);
    return `${total} fans turning (${seen.join(', ')})`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (c) THE SCREENS
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: every screen flickers frame to frame and drops out once a minute', async () => {
    const { world, idle } = await station(40);
    try {
      const st = world._station, mo = st.motion;
      assert(mo.screens.length >= 5, `only ${mo.screens.length} screens on deck 40 (${(st.tvs || []).length} holonet, ${(st.feeds || []).length} feeds)`);
      /* The level a screen is DRAWN at, read off the material, twice, a frame
       * apart — not off the record, which is what this is checking. */
      const read = (s) => (s.emissive ? s.mat.emissiveIntensity : s.mat.color.r);
      const a = mo.screens.map(read);
      world.update(1 / 60, idle);
      world.update(1 / 60, idle);
      const b = mo.screens.map(read);
      const flat = [];
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) < 1e-5) flat.push(mo.screens[i].name);
      assert(flat.length === 0, `${flat.length} screens did not change in two frames: ${flat.join(', ')}`);
      /* The swing is SUBTLE: ±5%, never more. Sampled over four seconds of
       * the real loop, which is forty cycles of the slowest screen. */
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 240; i++) {
        world.update(1 / 60, idle);
        for (const s of mo.screens) {
          if (s.level < 0.5) continue;              // a dropout is not a flicker
          lo = Math.min(lo, s.level); hi = Math.max(hi, s.level);
        }
      }
      assert(hi <= 1 + MO.FLICKER + 1e-6 && lo >= 1 - MO.FLICKER - 1e-6,
        `the flicker runs ${lo.toFixed(3)}..${hi.toFixed(3)}, outside ±${MO.FLICKER}`);
      assert(hi - lo > 0.04, `the flicker only spans ${(hi - lo).toFixed(4)} — it will not be seen`);
      /* THE DROPOUT. Driven on the lane's own clock rather than four real
       * minutes of a world: one screen, one minute, at the frame rate. */
      const s0 = mo.screens[0];
      let dark = 0;
      for (let i = 0; i < 60 * 60; i++) {
        MO.stepStationMotion(world, st, 1 / 60);
        if (s0.level < 0.5) dark++;
      }
      const secs = dark / 60;
      assert(secs > 0.1 && secs < 0.45,
        `screen 0 was dark for ${secs.toFixed(2)} s in a minute, against a ${MO.DROPOUT_S} s dropout`);
      return `${mo.screens.length} screens, swing ${lo.toFixed(3)}..${hi.toFixed(3)}, ${secs.toFixed(2)} s dark a minute`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (d) THE STEAM
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: the galley and the laundry have emitters and they emit into the engine\'s pools', async () => {
    /**
     * Two facts and they are different: the emitter EXISTS where the room is,
     * and something actually reached a pool. A count on the record alone would
     * be green with `world.particles` missing, which is exactly the state a
     * headless world used to be in.
     */
    const out = [];
    for (const [deck, want] of [[40, [15, 16]], [44, [39]]]) {
      const { world, idle } = await station(deck);
      try {
        const st = world._station, mo = st.motion;
        for (const id of want) {
          const e = mo.emitters.filter((q) => q.place === id && q.kind === 'steam');
          assert(e.length >= 1, `#${id} on deck ${deck} has no steam emitter`);
          const rec = st.places.get(id);
          for (const q of e) {
            const r = Math.hypot(q.x - rec.place.x, q.z - rec.place.z);
            assert(r < Math.max(rec.place.w, rec.place.d), `#${id}'s steam stands ${r.toFixed(1)} m from the room`);
          }
        }
        assert(world.particles?.smoke, 'the world has no smoke pool');
        /* Stand in the room so the door cull has it drawn, and count what the
         * pool draws before and after. */
        const rec = st.places.get(want[0]);
        const before = world.particles.smoke.mesh.geometry.instanceCount;
        stand(world, idle, rec.place.x, rec.place.y ?? (DECK_Y[deck] + 1.0), rec.place.z, 3);
        const after = world.particles.smoke.mesh.geometry.instanceCount;
        const puffs = mo.puffs.steam;
        assert(puffs > 0, `no steam asked for in three seconds on deck ${deck}`);
        assert(after > before || after > 0, `the smoke pool drew ${after} instances after ${puffs} puffs on deck ${deck}`);
        out.push(`deck ${deck}: ${puffs} puffs, ${after} live`);
      } finally { world.dispose?.(); }
    }
    return out.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (e) THE LITTER
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: twenty scraps drift in the draught and settle on the balcony inside a minute', async () => {
    const { world } = await station(40);
    try {
      const st = world._station, mo = st.motion, L = mo.litter;
      assert(L && L.n === MO.LITTER_N, `${L ? L.n : 'no'} scraps, against ${MO.LITTER_N}`);
      const x0 = Float32Array.from(L.x), z0 = Float32Array.from(L.z);
      /* A MINUTE, on the lane's own step. The player is elsewhere, so nothing
       * is kicked and what is measured is the draught alone. */
      for (let i = 0; i < 60 * 60; i++) MO.stepStationMotion(world, st, 1 / 60);
      let moved = 0, resting = 0, offBalcony = 0, far = 0;
      for (let i = 0; i < L.n; i++) {
        /* PATH AND NOT DISPLACEMENT: a scrap that settled eight seconds in
         * has drifted, and where it ended up is not the question. */
        const d = L.path[i];
        if (d > 1.0) moved++;
        far = Math.max(far, d);
        const r = Math.hypot(L.x[i], L.z[i]);
        if (L.rest[i]) {
          resting++;
          if (r < DRUM.atrium - 0.5 || r > DRUM.balcony + 1.5) offBalcony++;
        }
      }
      assert(moved === L.n, `only ${moved} of ${L.n} scraps drifted more than a metre of track in a minute`);
      assert(resting >= 5, `only ${resting} of ${L.n} scraps had settled after a minute`);
      assert(offBalcony === 0, `${offBalcony} scraps settled off the balcony band`);
      /* AND THE DRAUGHT KEEPS PICKING THEM UP. Twenty scraps that settle once
       * and never move again are stickers, not litter. */
      assert(L.lofts > 0, 'nothing was ever lofted off the balcony again in a minute');
      /* AND A BODY WALKING THROUGH KICKS THEM. Put the player on a scrap that
       * has come to rest and step the shipped loop. */
      const i0 = [...Array(L.n).keys()].find((i) => L.rest[i]);
      const kicks = L.kicks;
      const { idleInput } = await import('./_coop.mjs');
      stand(world, idleInput(), L.x[i0], L.y[i0] + 0.9, L.z[i0], 0.5);
      assert(L.kicks > kicks, 'a body standing on a scrap did not kick it');
      return `${L.n} scraps, all drifting (longest track ${far.toFixed(1)} m in 60 s), ${resting} settled on the balcony, ${L.lofts} lofted again, kicked by a body`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (f) THE BUDGET
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: the step is under 0.4 ms and the lane costs under 40 draws on every deck', async () => {
    const out = [];
    for (const deck of [40, 44, 48]) {
      const { world, idle } = await station(deck);
      try {
        const st = world._station, mo = st.motion;
        assert(mo.draws <= 40, `deck ${deck} adds ${mo.draws} draws — the lane's bound is 40`);
        /* Warm, then measured on the lane's own step so what is timed is this
         * file and not the forty bodies around it. */
        for (let i = 0; i < 120; i++) MO.stepStationMotion(world, st, 1 / 60);
        const t0 = process.hrtime.bigint();
        const n = 1200;
        for (let i = 0; i < n; i++) MO.stepStationMotion(world, st, 1 / 60);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
        assert(ms <= 0.4, `deck ${deck} steps in ${ms.toFixed(3)} ms — the lane's bound is 0.4`);
        /* And the whole station's draw bill is still inside §12.2's 400. */
        assert(st.draws <= 400, `deck ${deck} draws ${st.draws} with the motion up — §12.2's bound is 400`);
        out.push(`deck ${deck}: ${mo.draws} draws, ${ms.toFixed(3)} ms, ${st.draws} of 400 total`);
        /* One last hold: everything is one of the deck's own nine materials. */
        const nine = new Set(Object.values(st.mats).filter((m) => m && m.isMaterial));
        const strays = [];
        mo.group.traverse((o) => { if (o.isMesh && !nine.has(o.material)) strays.push(o.name); });
        assert(strays.length === 0, `deck ${deck} made materials of its own: ${strays.join(', ')}`);
      } finally { world.dispose?.(); }
    }
    return out.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (g) DETERMINISM, AND THE TEARDOWN
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationmotion: nothing in the lane rolls, and everything it made comes down', async () => {
    const src = await readFile(new URL('../../src/game/StationMotion.js', import.meta.url), 'utf8');
    assert(!/Math\.random/.test(src), 'StationMotion.js calls Math.random');
    assert(/makeRng/.test(src), 'StationMotion.js has no seeded stream');
    /* THE SAME STATION TWICE IS THE SAME LITTER. */
    const read = async () => {
      const { world } = await station(40);
      try {
        const st = world._station;
        for (let i = 0; i < 600; i++) MO.stepStationMotion(world, st, 1 / 60);
        const L = st.motion.litter;
        return [...L.x].concat([...L.z]).map((n) => n.toFixed(4)).join(',');
      } finally { world.dispose?.(); }
    };
    const a = await read(), b = await read();
    assert(a === b, 'two stations on the same seed drifted their litter differently');

    /* AND IT ALL GOES DOWN. `undressStation` calls the lane's undress; what is
     * measured is the scene and the physics after it, because a static box
     * left behind is an invisible wall in the next world. */
    const { world } = await station(44);
    const st = world._station;
    const doorBoxes = () => world.physics.staticBoxes.filter((b) => b.userData?.door !== undefined).length;
    const doors = st.motion.doors.length;
    assert(doorBoxes() === doors, `${doorBoxes()} door boxes for ${doors} doors`);
    const { undressStation } = await import('../../src/game/Station.js');
    undressStation(world);
    let left = 0;
    world.scene.traverse((o) => { if (/station-(door|fan|litter|motes|lamps|routeblips|chandelier|projector)/.test(o.name || '')) left++; });
    assert(left === 0, `${left} of the lane's meshes are still in the scene after the undress`);
    assert(doorBoxes() === 0, `${doorBoxes()} door colliders survived the undress`);
    world.dispose?.();
    return `seeded and identical over two builds; ${doors} door boxes and every mesh released`;
  });
}
