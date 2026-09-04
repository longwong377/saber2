/**
 * THE JUMP — V16 Lane A1.
 *
 * *"there should absolutely not be a loading screen this is just for immersion
 * sake."* That sentence is the whole subject of this file, and it is testable:
 * a jump that loads a level cannot keep it, and a jump that rebuilds the world
 * cannot either. So what is asserted is that the sequence drives a SHADER and
 * a FLEET and nothing else, that it hands control back exactly as it found it,
 * and that it lands inside the five to ten seconds that were asked for.
 */

export async function run({ check, assert, near }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('warp: five to ten seconds, in five phases, and it lands', async () => {
    const W = await import('../../src/game/Warp.js');
    assert(W.WARP_SECONDS >= 5 && W.WARP_SECONDS <= 10,
      `the jump is ${W.WARP_SECONDS.toFixed(1)}s and the ask was five to ten`);
    assert(W.PHASES.length === 5, `${W.PHASES.length} phases; the sequence is five`);
    const ids = W.PHASES.map((p) => p.id);
    assert(ids.join(',') === 'order,call,turn,jump,arrive',
      `the sequence runs ${ids.join(' → ')} — a procedure reads as a ship and an effect does not`);
    for (const p of W.PHASES) assert(p.t > 0.5, `${p.id} is ${p.t}s, which is a cut rather than a beat`);

    /* IT LANDS, driven a frame at a time at a real frame length. */
    const to = { name: 'Geonosis' };
    const w = new W.Warp(to, {});
    let n = 0;
    while (!w.done && n < 4000) { w.step(1 / 60); n++; }
    assert(w.done, `the jump did not land in ${(n / 60).toFixed(1)}s`);
    near(n / 60, W.WARP_SECONDS, 0.1, 'the jump took');
    return `${W.WARP_SECONDS.toFixed(1)}s over ${ids.join(' → ')}, landed in ${(n / 60).toFixed(2)}s`;
  });

  check('warp: it reconfigures a sky and rebuilds a fleet — and loads nothing', async () => {
    /**
     * THE CLAIM THAT MAKES THE FEATURE POSSIBLE, held as a claim.
     *
     * If a jump ever grows a level load, this is where it shows: the sink is
     * the ONLY way out of the sequence, and `Warp.js` importing a level table,
     * a world or a renderer would be the first sign that it had stopped being
     * a clock. A source read, because there is no other way to assert the
     * absence of a dependency.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Warp.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(!/^\s*import\s/m.test(code),
      'Warp.js imports something — it is a clock and a state machine, and everything it drives '
      + 'is handed in, which is the only reason the whole sequence is drivable with no world');
    for (const bad of ['loadLevel', 'buildWorld', 'THREE', 'document', 'Screens', 'loading']) {
      assert(!new RegExp(`\\b${bad}\\b`).test(code),
        `Warp.js names ${bad} — "there should absolutely not be a loading screen" is only true `
        + 'while the jump is a shader reconfigure and a re-dress, and nothing else');
    }

    /* AND THE SINK IS DRIVEN, in order, once each where once is right. */
    const W = await import('../../src/game/Warp.js');
    const log = [];
    const to = { name: 'Felucia' };
    const seen = { lights: [], stars: [], quiet: [] };
    const w = new W.Warp(to, {
      orbit: (l) => log.push(['orbit', l === to]),
      fleet: (on, l) => log.push(['fleet', on, l === to || l === null]),
      arrived: (l) => log.push(['arrived', l === to]),
      say: (s) => log.push(['say', s]),
      lights: (k) => seen.lights.push(k),
      stars: (k, sw) => seen.stars.push([k, sw]),
      quiet: (k) => seen.quiet.push(k),
    });
    while (!w.done) w.step(1 / 60);

    const orbits = log.filter((r) => r[0] === 'orbit');
    assert(orbits.length === 1, `the sky was reconfigured ${orbits.length} times; once is right`);
    assert(orbits[0][1], 'the sky was reconfigured to a different theatre than the one ordered');
    const arrived = log.filter((r) => r[0] === 'arrived');
    assert(arrived.length === 1 && arrived[0][1], 'the world was never told where it now is');

    /* THE OLD FLEET IS STRUCK BEFORE THE NEW ONE IS DRESSED, and both happen. */
    const fleets = log.filter((r) => r[0] === 'fleet');
    assert(fleets.length >= 2, `the fleet outside was touched ${fleets.length} times`);
    assert(fleets[0][1] === false, 'the fleet you are leaving was never struck — those ships jump with you');
    assert(fleets[fleets.length - 1][1] === true, 'no fleet was dressed at the far end');
    const strike = log.findIndex((r) => r[0] === 'fleet' && r[1] === false);
    const dress = log.findIndex((r) => r[0] === 'fleet' && r[1] === true);
    assert(strike < dress, 'the new fleet was dressed before the old one was struck');

    /* THE SKY IS REBUILT WHILE NOTHING CAN BE SEEN. The star-lines are at
     * their peak at the jump/arrive seam, which is the one frame in the whole
     * sequence where a hitch is invisible. */
    const peak = Math.max(...seen.stars.map((s) => s[0]));
    near(peak, 1, 0.02, 'the star-lines peaked at');
    const orbitAt = log.findIndex((r) => r[0] === 'orbit');
    const saysBefore = log.slice(0, orbitAt).filter((r) => r[0] === 'say').length;
    assert(saysBefore >= 3, `only ${saysBefore} calls before the jump — the sequence is a procedure`);
    return `sky reconfigured once at the star-line peak (${peak.toFixed(2)}), old fleet struck before the new one dressed, ${log.filter((r) => r[0] === 'say').length} calls`;
  });

  check('warp: it hands the station back exactly as it found it', async () => {
    /**
     * A SEQUENCE THAT ENDS 3% AMBER leaves the station permanently the wrong
     * colour and nothing downstream would ever say so — which is the shape of
     * defect this tree keeps finding in transitions. So the last value of
     * every continuous channel is asserted to be its identity, and `finish()`
     * — the cut-short path a teardown takes — is held to the same thing.
     */
    const W = await import('../../src/game/Warp.js');
    const last = {};
    const sink = {
      lights: (k) => { last.lights = k; },
      quiet: (k) => { last.quiet = k; },
      stars: (k, sw) => { last.stars = k; last.swing = sw; },
      orbit: () => {}, fleet: () => {}, arrived: () => {}, say: () => {},
    };
    const w = new W.Warp({ name: 'Kashyyyk' }, sink);
    while (!w.done) w.step(1 / 60);
    for (const k of ['lights', 'quiet', 'stars', 'swing']) {
      assert(last[k] === 0, `${k} ended at ${last[k]} and not 0 — the station is left mid-jump`);
    }
    assert(w.progress === 1, `progress ended at ${w.progress}`);

    /* CUT SHORT: it still arrives, and it still tidies up. */
    const l2 = {};
    const s2 = { lights: (k) => { l2.lights = k; }, quiet: (k) => { l2.quiet = k; },
      stars: (k, sw) => { l2.stars = k; l2.swing = sw; },
      orbit: () => { l2.orbited = true; }, fleet: () => {}, arrived: () => { l2.told = true; }, say: () => {} };
    const w2 = new W.Warp({ name: 'Utapau' }, s2);
    w2.step(1 / 60); w2.step(1 / 60);
    w2.finish();
    assert(w2.done && l2.orbited && l2.told, 'a cut-short jump did not arrive anywhere');
    for (const k of ['lights', 'quiet', 'stars', 'swing']) {
      assert(l2[k] === 0, `${k} ended at ${l2[k]} after a cut-short jump`);
    }
    /* …and finishing twice is not two arrivals. */
    let again = 0;
    w2.sink.orbit = () => { again++; };
    w2.finish(); w2.step(1 / 60);
    assert(again === 0, 'finishing a landed jump reconfigured the sky again');
    return 'every channel back to its identity on the full path and on the cut-short one';
  });

  check('warp: a real station jumps, and comes back exactly as it was', async () => {
    /**
     * The three checks above drive the sequence with a hand-made sink, which
     * proves the clock. This drives it through `Station.orderJump` on a REAL
     * station, which proves the wiring — and the wiring is where the
     * equivalent feature on the flight deck was broken for the whole life of
     * it, because `configureOrbit` was called on an object that had no such
     * method and the optional chain ate it (see `hangar.mjs`).
     */
    const { readFile } = await import('node:fs/promises');
    if (!globalThis.fetch || !globalThis.__stationFetch) {
      const root = new URL('../../', import.meta.url);
      globalThis.__stationFetch = true;
      globalThis.fetch = async (u) => {
        const b = await readFile(new URL(String(u), root));
        return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
      };
    }
    const S = await import('../../src/game/Station.js');
    await S.prepareStation();
    const { bootWorld, idleInput, run } = await import('./_coop.mjs');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const from = LEVELS.geonosis || Object.values(LEVELS)[0];
    const { world } = await bootWorld({
      level: 'station',
      settings: { mode: 'station', level: 'station', allies: 0 },
      onWorld: (w) => { w._stationFloor = 48; w._pickedLevel = from; },
    });
    try {
      const idle = idleInput();
      const to = Object.values(LEVELS).find((l) => l && l !== from && l.name);
      assert(to, 'there is only one theatre in the game');
      const st = world._station;
      const was = {};
      for (const k of ['strip', 'screen']) was[k] = st.mats[k].color.getHex();

      assert(S.orderJump(world, to) === true, 'the plot table refused a legitimate order');
      assert(world._warp && !world._warp.done, 'ordering a jump started nothing');

      /* MID-JUMP THE STATION IS AMBER, and it is the deck's OWN material that
       * moved — not a tenth one, which §9.1 forbids and `station.mjs` measures. */
      run(world, 3.0, idle);
      let moved = 0;
      for (const k of ['strip', 'screen']) if (st.mats[k].color.getHex() !== was[k]) moved++;
      assert(moved > 0, 'the station did not change colour on the way — no deck knew a jump was ordered');
      assert(Object.keys(st.mats).length <= 12,
        `the jump left ${Object.keys(st.mats).length} materials on the deck — §9.1 is nine`);

      /* AND IT ARRIVES, AND PUTS ITSELF BACK. */
      run(world, 7.5, idle);
      assert(world._warp.done, `the jump was still in ${world._warp.phase} after 10.5s`);
      assert(world._pickedLevel === to,
        `the station thinks it is orbiting ${world._pickedLevel?.name} and it jumped to ${to.name}`);
      for (const k of ['strip', 'screen']) {
        assert(st.mats[k].color.getHex() === was[k],
          `${k} came out of the jump at ${st.mats[k].color.getHex().toString(16)} and went in at `
          + `${was[k].toString(16)} — the station is left permanently mid-transit`);
      }
      /* THE SKY IS THE NEW ONE, off the engine the game actually owns. */
      const dome = world.engine?.skyDome;
      assert(dome?._orbit?.level === to,
        'the dome is still showing the theatre the station left — the call went nowhere, which is '
        + 'exactly the shape of the bug hangar.mjs exists for');
      assert(world._deckBattle?.group?.parent, 'no fleet outside after the jump');
      assert(S.orderJump(world, to) === false, 'the station will jump to where it already is');
      return `${from.name} → ${to.name} in ${(10.5).toFixed(1)}s of frames; deck went amber and back; `
        + `dome and fleet both on the new theatre`;
    } finally { world.dispose?.(); }
  });

  check('warp: you cannot order one to where you are, or over one already running', async () => {
    const W = await import('../../src/game/Warp.js');
    const here = { name: 'Geonosis' }, there = { name: 'Felucia' };
    assert(!W.canJump({ _pickedLevel: here }, here).ok, 'the station will jump to where it already is');
    assert(W.canJump({ _pickedLevel: here }, there).ok, 'the station refuses a legitimate order');
    assert(!W.canJump({}, null).ok, 'the station will jump to nowhere');
    const running = new W.Warp(there, {});
    assert(!W.canJump({ _pickedLevel: here, _warp: running }, there).ok,
      'a second order was taken while the first was under way');
    running.finish();
    assert(W.canJump({ _pickedLevel: here, _warp: running }, there).ok,
      'a landed jump still blocks the next order');
    const why = W.canJump({ _pickedLevel: here }, here).why;
    assert(why && /orbit/i.test(why), `the refusal says "${why}", which does not tell the player why`);
    return `refuses "${why}" and refuses a second order under way; takes a real one`;
  });
}
