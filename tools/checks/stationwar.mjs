/**
 * THE WAR ON THE STATION, AND THE DIFFICULTY IN THE DRUM — V19 additions 1 and 10.
 *
 *   (a) a bad phase brings a bigger party than a quiet one, and the party walks;
 *   (b) an alert reddens the strips, posts two guards at the closed room's door
 *       within 5 s, the key at that door refuses with a line, and the room
 *       reopens after ten station-minutes;
 *   (c) #41's wall repaints, differently, when the front moves;
 *   (d) the five difficulty readers move the right way between Padawan and
 *       Grandmaster — three driven, two by value and by the line that reads it;
 *   (e) no Math.random in either module.
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

async function station(deck = 48) {
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

const decomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => (l.includes('://') ? l : l.replace(/\/\/.*$/, ''))).join('\n');

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const W = await import('../../src/game/StationWar.js');
  const D = await import('../../src/game/StationDifficulty.js');
  const P = await import('../../src/game/StationPlan.js');
  const { BATTLE } = await import('../../src/engine/SkyDome.js');
  const { run: drive } = await import('./_coop.mjs');

  /* Orbit clocks that land in a named phase. */
  const T = { quiet: BATTLE.arriveB + 20, broadside: BATTLE.fire + 30, lost: BATTLE.breakAt + 4, withdraw: BATTLE.withdraw + 4 };

  /* ── (a) pure ─────────────────────────────────────────────────────────── */
  check('stationwar: a hull breaking up brings litters; an approaching line brings nobody', () => {
    const bad = W.casualtyParty({ phase: 'breakup', victimSide: 'republic' }, 0);
    const worse = W.casualtyParty({ phase: 'breakup', victimSide: 'separatist' }, 0);
    const quiet = W.casualtyParty({ phase: 'approach', victimSide: 'republic' }, 0);
    const mid = W.casualtyParty({ phase: 'broadside', victimSide: 'republic' }, 0);
    assert(quiet.size === 0, `a quiet front sent ${quiet.size}`);
    assert(mid.size > 0 && mid.litters.length === 0, 'broadside is walking wounded only');
    assert(bad.size > mid.size, `breakup ${bad.size} is not bigger than broadside ${mid.size}`);
    assert(bad.litters.length > worse.litters.length, 'our own hull lost did not add a litter');
    assert(bad.every < mid.every, 'the bad phase is not more frequent');
    const again = W.casualtyParty({ phase: 'breakup', victimSide: 'republic' }, 0);
    assert(JSON.stringify(again) === JSON.stringify(bad), 'the party is not deterministic');
    return `quiet 0 · broadside ${mid.size} every ${mid.every} min · breakup ${bad.size} (${bad.litters.length} litters) every ${bad.every} min`;
  });

  /* ── the driven half: one deck-48 world for (a), (b) and (c) ──────────── */
  check('stationwar: driven on deck 48 — the party walks, the alert, the order, the wall', async () => {
    const { world, idle } = await station(48);
    const notes = [];
    world.notify = (h, l) => notes.push(`${h}: ${l}`);
    const st = world._station, life = world._stationLife;
    assert(st && life, 'no station');
    const M = st.mats;
    const strip0 = M.strip.emissive.getHex();
    const out = [];
    try {
      /* First frame under broadside: the key is set, nothing fires. */
      world._warT = T.broadside;
      drive(world, 0.2, idle);
      const war = life.war;
      assert(war && war.alerts === 0, 'the first frame raised an alert');
      assert(M.strip.emissive.getHex() === strip0, 'the strips changed with no alert');

      /* (b) THE ALERT fires on the turn into breakup. */
      world._warT = T.lost;
      drive(world, 0.1, idle);
      assert(war.alerts === 1, `alerts ${war.alerts}`);
      assert(M.strip.emissive.getHex() === 0xff2a1a, 'the strips are not red');
      assert(notes.some((n) => /BATTLE STATIONS/.test(n)), 'no klaxon line');
      const O = war.order;
      assert(O && O.deck === 48, 'no room was closed on deck 48');
      const room = P.PLACE.get(O.id);
      assert(room && !W.NEVER_CLOSED.has(room.id), `closed #${O.id}`);
      drive(world, 5, idle);
      const guards = O.guards.map((k) => life.live.get(k)).filter((g) => g?.position);
      assert(guards.length === 2, `${guards.length} guards at the door`);
      let far = 0;
      for (const g of guards) far = Math.max(far, Math.hypot(g.position.x - room.door[0], g.position.z - room.door[1]));
      assert(far <= 2.5, `a guard stands ${far.toFixed(1)} m from the door`);
      assert(guards.every((g) => g.stationGuard), 'the pair are not guards');
      assert(![...life.live.entries()].some(([k, b]) => !k.startsWith('war:') && b?.stationPlace === room.id && !b.wayR),
        'somebody is still standing inside the closed room');
      out.push(`#${O.id} ${room.name} closed, ${O.out} sent out, pair ≤ ${far.toFixed(1)} m of the door`);

      /* The key at the door refuses. */
      const { stationKey } = await import('../../src/game/Station.js');
      world.player.position.set(room.door[0], P.floorOf(room) + 1, room.door[1]);
      const n0 = notes.length;
      assert(stationKey(world) === true, 'the key was not spent at the closed door');
      const said = notes.slice(n0).find((n) => /closed by order/.test(n));
      assert(said, `the door said nothing: ${notes.slice(n0).join(' | ')}`);
      out.push(`key: "${said.slice(0, 60)}"`);

      /* (a) THE PARTY. The clock reaches the next party under the hull lost. */
      const before = [...life.live.keys()].filter((k) => /^(wounded|litter):CT-4/.test(k)).length;
      st.hour += (W.casualtyPlan({ phase: 'breakup' }).every + 0.5) / 60;
      drive(world, 0.5, idle);
      const keys = [...life.live.keys()].filter((k) => /^(wounded|litter):CT-4/.test(k));
      assert(keys.length > before, `no wounded came off the front (${keys.length})`);
      assert((life.litters || []).length >= 1, 'no litter was slung');
      assert(notes.some((n) => /off the front/.test(n)), 'the medbay did not say the party was on the ring');
      out.push(`party ${keys.length} bodies, ${life.litters.length} litters`);

      /* Ten station-minutes, and it reopens; twenty seconds, and the strips are back. */
      st.hour += (W.ORDER_MIN + 0.5) / 60;
      drive(world, W.ALERT_FOR + 1, idle);
      assert(!war.order, 'the order did not lift');
      assert(!life.live.has('war:guard:0') && !life.live.has('war:guard:1'), 'the pair did not stand down');
      /* NOT `strip0`, AND THAT IS A SECOND OWNER RATHER THAN A LOOSENING.
       * `StationLight` (V20 lane 1) tints the strips per room and per hour, so
       * the hex a world booted with is only what the strips are while the
       * player stands where he booted. `redden` saves the tint it FOUND and
       * puts that back; the light then writes the mood the player is standing
       * in now — which is the behaviour, and it is why the question this line
       * asks is the one it was always really asking: is the red off, and has
       * the alert let go. */
      assert(M.strip.emissive.getHex() !== 0xff2a1a, 'the strips are still red');
      assert(war.strip0 === null, 'the alert still holds the strips');
      assert(notes.some((n) => /open again/.test(n)), 'no reopening line');

      /* (c) THE WALL. */
      const wall = st.wall;
      assert(wall && wall.mesh && wall.stamp, 'no tactical wall in #41');
      const cic = P.PLACE.get(41);
      const dWall = Math.hypot(wall.mesh.position.x - cic.x, wall.mesh.position.z - cic.z);
      assert(dWall < cic.d, `the wall is ${dWall.toFixed(1)} m from the CIC`);
      const drawn = [];
      const ctx = wall.canvas.getContext('2d');
      const real = ctx.fillText.bind(ctx);
      ctx.fillText = (t, x, y) => { drawn.push(`${t}@${x | 0},${y | 0}`); real(t, x, y); };
      const realLine = ctx.lineTo.bind(ctx);
      ctx.lineTo = (x, y) => { drawn.push(`L${x | 0},${y | 0}`); realLine(x, y); };
      world.player.position.copy(wall.mesh.position);
      /* Under the hull lost the lines are on the station (sep 0); the front
       * is painted at its nearest. Then the round is over and they are far. */
      war.wallIn = 0;
      drive(world, 0.1, idle);
      const stampA = wall.stamp, opsA = drawn.slice(); drawn.length = 0;
      const F = W.campaignFront(world, st);
      assert(F.next && F.next.name && opsA.some((o) => o.includes(F.next.name)), `the next mission ${F.next?.name} is not on the wall`);
      assert(opsA.some((o) => o.includes(`${F.front.distance} m`)), 'the front distance is not on the wall');
      world._warT = T.quiet;
      war.wallIn = 0;
      drive(world, 0.1, idle);
      const stampB = wall.stamp, opsB = drawn.slice();
      assert(stampA !== stampB, `the front moved and the stamp did not: ${stampA}`);
      assert(opsB.length && opsA.join('|') !== opsB.join('|'), 'the front moved and the canvas drew the same thing');
      const dA = +stampA.match(/:(\d+)m@/)[1], dB = +stampB.match(/:(\d+)m@/)[1];
      assert(dB > dA, `the lines parted and the front did not fall back (${dA} → ${dB})`);
      out.push(`wall ${stampA} → ${stampB}`);
    } finally {
      try { world.unload?.(); } catch {}
    }
    return out.join(' · ');
  });

  /* ── (d) the five readers ─────────────────────────────────────────────── */
  check('stationdiff: prices, the brig, the guards, the pickpocket and the medbay all move the right way', async () => {
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const MB = await import('../../src/game/Medbay.js');
    const PK = await import('../../src/game/Pickpocket.js');
    const easy = { settings: { difficulty: 'padawan' } }, hard = { settings: { difficulty: 'grandmaster' } };
    const out = [];
    try {
      const row = V.everyRow().find((r) => K.saneRow(r) && r.base >= 20);
      D.bindStationDiff(easy); const pe = K.priceOf(row);
      D.bindStationDiff(hard); const ph = K.priceOf(row);
      assert(pe < ph, `prices: padawan ${pe} !< grandmaster ${ph}`);
      out.push(`price ${row.base} → ${pe}/${ph}`);

      const mend = (w) => {
        D.bindStationDiff(w);
        const c = { men: [{ designation: 'X-1', hp: 0.2 }], ward: { tanks: ['X-1', null, null, null, null] } };
        MB.advanceIn(c, 1);
        return c.men[0].hp;
      };
      const he = mend(easy), hh = mend(hard);
      assert(he > hh, `heal: padawan ${he} !> grandmaster ${hh}`);
      out.push(`mend/h ${(he - 0.2).toFixed(3)}/${(hh - 0.2).toFixed(3)}`);

      let se = 0, sh = 0, share = [0, 0];
      for (let d = 0; d < 60; d++) {
        const a = PK.pickPlan(d, easy), b = PK.pickPlan(d, hard);
        if (a.strikes) se++; if (b.strikes) sh++;
        share[0] += a.share; share[1] += b.share;
      }
      assert(se < sh, `pickpocket: padawan strikes ${se} !< grandmaster ${sh} of 60 days`);
      assert(share[0] < share[1], 'the take did not grow with the tier');
      out.push(`thief ${se}/${sh} days of 60, take ${(share[0] / 60 * 100).toFixed(1)}%/${(share[1] / 60 * 100).toFixed(1)}%`);

      const de = D.stationDiff(easy), dh = D.stationDiff(hard);
      assert(de.brigPatience < dh.brigPatience, 'the brig holds no longer on grandmaster');
      assert(de.guardPatience > dh.guardPatience, 'the guards are no quicker on grandmaster');
      const src = decomment(await readFile(new URL('../../src/game/StationLife.js', import.meta.url), 'utf8'));
      assert(/CELL_HOLD \* stationDiff\(world\)\.brigPatience/.test(src), 'the cell does not read brigPatience');
      assert(/GUARD_HOLD_FOR \* stationDiff\(world\)\.guardPatience/.test(src), 'the patrol does not read guardPatience');
      out.push(`cell ×${de.brigPatience}/${dh.brigPatience}, patience ×${de.guardPatience}/${dh.guardPatience}`);

      /* Monotonic across all four, every column. */
      const cols = ['prices', 'brigPatience', 'pickOdds'];
      for (const col of cols) {
        let last = -Infinity;
        for (const t of D.TIERS) { const v = D.STATION_DIFF[t][col]; assert(v > last, `${col} is not rising at ${t}`); last = v; }
      }
      for (const col of ['guardPatience', 'healRate']) {
        let last = Infinity;
        for (const t of D.TIERS) { const v = D.STATION_DIFF[t][col]; assert(v < last, `${col} is not falling at ${t}`); last = v; }
      }
    } finally { D.bindStationDiff(null); }
    return out.join(' · ');
  });

  /* ── (e) ──────────────────────────────────────────────────────────────── */
  check('stationwar: no Math.random in the war or the ladder', async () => {
    for (const f of ['StationWar.js', 'StationDifficulty.js', 'Pickpocket.js']) {
      const src = decomment(await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8'));
      assert(!/Math\.random/.test(src), `${f} rolls Math.random`);
    }
    return 'three files, none';
  });
}
