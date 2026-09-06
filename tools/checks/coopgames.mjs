/**
 * THE TWO-PLAYER THINGS — V19 addition 4 (hole 6): *"co-op guests get the
 * station but nothing on it is a two-player thing."*
 *
 * Every check here drives two real Worlds on two real `Net` endpoints over
 * the stub broker (`_coop.mjs`), the way `coop.mjs`'s station checks do, and
 * every credit is measured on a PURSE: the host's on `Credits.js`, the
 * guest's on the ledger `CoopGames.doorOf` reads off `world.purseDoor` —
 * because under node two Worlds share one store, and a check that read one
 * purse for two players would count the winner's take and the loser's stake
 * in the same number.
 */

import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), ROOT));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** Two players standing on the same deck of the same station, both real — `coop.mjs`'s own. */
async function coopStation(n = 2, deck = 40) {
  const { bootSession } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  return bootSession({
    n,
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
}

/** A purse of the guest's own: the three doors `Credits.js` has, on a number. */
function ledger(start = 300) {
  const L = { n: start,
    purse: () => L.n,
    pay: (k) => { const a = Math.max(0, Math.round(k)); L.n += a; return a; },
    spend: (k) => { const c = Math.round(k); if (L.n < c) return { ok: false, why: 'not enough credits', short: c - L.n }; L.n -= c; return { ok: true, why: null, short: 0, left: L.n }; },
  };
  return L;
}

/** Every `notify` a world raises, as "HEAD — line". */
function listen(world) {
  const lines = [];
  world.onNotify = (h, l) => lines.push(`${h} — ${l}`);
  return lines;
}

/** Stand a local player somewhere and let the other machine hear about it. */
function standAt(s, node, x, z) {
  const w = node.world;
  w.player.position.set(x, w.floorAt ? w.floorAt(x, z) : 0, z);
  w.player.velocity?.set?.(0, 0, 0);
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('coopgames: sabacc against your guest — one shared hand, two humans betting, the pot on both purses', async () => {
    /**
     * Both within 3 m of the same table in #18 the Pit. The host's key deals;
     * the guest is sent its own cards and nothing else; each key press is its
     * seat's verb (hold in the draw, bet or call in the round); the pot pays
     * the winner into THEIR purse. And with the guest away from the table the
     * same key at the same spot goes to the room's own branch — the
     * single-player table is the untouched path.
     */
    const CG = await import('../../src/game/CoopGames.js');
    const { stationKey } = await import('../../src/game/Station.js');
    const Cr = await import('../../src/game/Credits.js');
    const { SABACC } = await import('../../src/game/Games.js');
    const s = await coopStation(2, 40);
    try {
      const H = s.host.world, C = s.clients[0].world;
      const hl = listen(H), cl = listen(C);
      Cr.clearCredits(); Cr.pay(300);
      const L = ledger(300); C.purseDoor = L;
      const t = CG.tablesIn(H, 18)[0];
      assert(t && Math.hypot(t.x - 71.8, t.z - 17.9) < 12, 'no sabacc table found inside the Pit');
      standAt(s, s.host, t.x + 1.6, t.z + 0.4);
      standAt(s, s.clients[0], t.x - 1.6, t.z - 0.4);
      s.pump(0.6);
      assert(CG.sharedTable(H)?.other && CG.sharedTable(C)?.other, 'the two machines do not agree they are at one table');

      /* THE DEAL, off the host's key. */
      const p0 = Cr.purse(), g0 = L.purse();
      assert(stationKey(H) === true, 'the key at a shared table was not taken');
      s.pump(0.2);
      const hv = CG.sharedHand(H), gv = CG.sharedHand(C);
      assert(hv && gv, `no shared hand on ${!hv ? 'the host' : 'the guest'} after the deal`);
      assert(Cr.purse() === p0 - SABACC.ANTE && L.purse() === g0 - SABACC.ANTE, `the antes did not come off both purses (host ${p0}→${Cr.purse()}, guest ${g0}→${L.purse()})`);
      const seat1 = CG.tableView(H, 1);
      assert(JSON.stringify(gv.hand) === JSON.stringify(seat1.hand), `the guest holds ${JSON.stringify(gv.hand)} and the host dealt it ${JSON.stringify(seat1.hand)}`);
      assert(JSON.stringify(gv.hand) !== JSON.stringify(hv.hand) || hv.hand.length === 0, 'both seats hold the same cards');
      assert(hv.turn === 0 && gv.turn === 0 && hv.phase === 'draw', `the hand opens on seat ${hv.turn} in the ${hv.phase} phase`);

      /* THE DRAW, one press each, then THE BETTING ROUND: the host's press is
       * a BET (it may), the guest's a CALL (it owes) — two humans, alternating. */
      const press = (node) => { assert(stationKey(node.world) === true, `${node.name}'s press was not taken`); s.pump(0.2); };
      press(s.host);
      assert(CG.sharedHand(C)?.turn === 1, 'after the host held, the guest was not on turn');
      press(s.clients[0]);
      const before = CG.sharedHand(H);
      assert(before.phase === 'bet' && before.turn === 0, `after the draw the hand is at seat ${before.turn} in ${before.phase}`);
      press(s.host);
      const mid = CG.sharedHand(C);
      assert(mid.turn === 1 && mid.toCall === SABACC.UNIT && mid.pot === before.pot + SABACC.UNIT,
        `the host's bet did not reach the guest as a call of ${SABACC.UNIT} (turn ${mid.turn}, toCall ${mid.toCall}, pot ${before.pot}→${mid.pot})`);
      press(s.clients[0]);
      const after = CG.sharedHand(H) || CG.tableView(H, 0);
      const potAfter = after ? after.pot : null;
      assert(potAfter === null || potAfter === before.pot + 2 * SABACC.UNIT, `the guest's call did not put ${SABACC.UNIT} in (pot ${potAfter})`);

      /* PLAY IT OUT: whoever is on turn presses, until the showdown. */
      let n = 0;
      while (CG.sharedHand(H) && n++ < 40) {
        const v = CG.sharedHand(H);
        press(v.turn === 0 ? s.host : s.clients[0]);
      }
      assert(!CG.sharedHand(H) && !CG.sharedHand(C), 'the hand never finished');
      const res = CG.lastHand(H)?.result;
      assert(res && CG.lastHand(C)?.result?.pot === res.pot, 'the two machines do not hold the same showdown');
      const p1 = Cr.purse(), g1 = L.purse();
      const moved = (p1 - p0) + (g1 - g0);
      /* THE MIDDLE, LESS THE HOUSE: every credit either put in went to the
       * middle, and the middle went to the winner less the rake — so the two
       * purses together are down exactly the rake (or nothing, on a push). */
      assert(moved === res.owed[0] + res.owed[1] - res.pot,
        `the two purses together moved ${moved} on a pot of ${res.pot} paying ${res.owed.join('+')}`);
      assert(p1 - p0 === res.owed[0] - res.put[0] && g1 - g0 === res.owed[1] - res.put[1],
        `host ${p0}→${p1} put ${res.put[0]} owed ${res.owed[0]}; guest ${g0}→${g1} put ${res.put[1]} owed ${res.owed[1]}`);
      assert(hl.some((l) => /^SABACC — ALPHA/.test(l)) && cl.some((l) => /^SABACC — HOST/.test(l)), 'a machine was never told about the hand');
      const line = [...hl].reverse().find((l) => /takes the middle|nobody takes it/.test(l)) || '';
      assert(line, 'the host never saw the showdown');

      /* THE SINGLE-PLAYER PATH: the guest walks off, and the key goes to the room. */
      standAt(s, s.clients[0], t.x + 9, t.z + 5);
      s.pump(0.6);
      assert(!CG.sharedTable(H), 'the host still thinks the guest is at the table');
      let room = null; H.onTote = (id) => { room = id; return true; };
      const p2 = Cr.purse();
      assert(stationKey(H) === true && room === 'the-pit', `with no guest at the table the key went to ${room || 'nobody'}`);
      assert(!CG.sharedHand(H) && Cr.purse() === p2, 'the single-player key dealt a shared hand');
      return `dealt seat 1 ${JSON.stringify(seat1.hand)} to the guest; bet ${SABACC.UNIT} / call ${SABACC.UNIT}; ${line.replace(/^.*— /, '')}; purses host ${p0}→${p1}, guest ${g0}→${g1} (together ${moved}); ${n} presses`;
    } finally { s.close(); }
  });

  check('coopgames: a side bet against your guest settles the stake between the two purses, both told', async () => {
    /**
     * #19 the Holo-theatre, both within 3 m. The host's press offers "bet
     * against ALPHA" and picks runner 0; the guest's two presses pick runner
     * 1; the bet is struck at 20 a side and folded into `sidebets`. The clock
     * is run past the race and the host settles it off the tote's own result:
     * 40 to the winner, `notify` on both machines, the fold cleared.
     */
    const CG = await import('../../src/game/CoopGames.js');
    const { stationKey } = await import('../../src/game/Station.js');
    const Cr = await import('../../src/game/Credits.js');
    const SS = await import('../../src/game/StationSave.js');
    const T = await import('../../src/game/Tote.js');
    const s = await coopStation(2, 40);
    try {
      const H = s.host.world, C = s.clients[0].world;
      const hl = listen(H), cl = listen(C);
      Cr.clearCredits(); Cr.pay(300); SS.setSideBets([]);
      const L = ledger(300); C.purseDoor = L;
      const p = H._station.places.get(19).place;
      /* AT THE WINDOW: the theatre's door, a step inside, a metre apart. */
      const dx = p.x - p.door[0], dz = p.z - p.door[1], dl = Math.hypot(dx, dz) || 1;
      const wx = p.door[0] + (dx / dl) * 1.2, wz = p.door[1] + (dz / dl) * 1.2;
      standAt(s, s.host, wx + (dz / dl) * 0.7, wz - (dx / dl) * 0.7);
      standAt(s, s.clients[0], wx - (dz / dl) * 0.7, wz + (dx / dl) * 0.7);
      s.pump(0.6);
      assert(CG.sharedCounter(H)?.place === 19 && CG.sharedCounter(C)?.place === 19, 'the two are not at one counter');
      const race = CG.nextRaceAt(H, 19);
      assert(race && race.hour > H._station.hour, 'no race left on the Holo-theatre card');
      const rows = T.boardFor(race).runners;
      assert(rows.length >= 2, 'a card with one runner');
      const p0 = Cr.purse(), g0 = L.purse();
      assert(stationKey(H) === true, "the host's press at the counter was not taken");
      s.pump(0.2);
      assert(hl.some((l) => /^SIDE BET — ALPHA/.test(l)) && cl.some((l) => /^SIDE BET — HOST/.test(l) && /press to pick/.test(l)), 'the offer did not reach both machines');
      /* A SECOND HOST PRESS CYCLES ITS RUNNER to row 1; the guest's first press picks row 0 and strikes it. */
      assert(stationKey(H) === true, "the host's second press was not taken");
      s.pump(0.2);
      assert(Cr.purse() === p0 && L.purse() === g0, 'a stake came off before both had picked');
      assert(stationKey(C) === true, "the guest's press was not taken");
      s.pump(0.3);
      assert(Cr.purse() === p0 - CG.SIDE_STAKE && L.purse() === g0 - CG.SIDE_STAKE,
        `struck, and the stakes read host ${p0}→${Cr.purse()}, guest ${g0}→${L.purse()}`);
      const fold = SS.sideBets();
      const mine = fold.find((e) => e.role === 'host');
      assert(mine && mine.race === race.id && mine.on === rows[1].id && mine.against === rows[0].id,
        `the fold holds ${JSON.stringify(fold.map((e) => [e.role, e.on, e.against]))}`);
      assert(fold.some((e) => e.role === 'guest' && e.on === rows[0].id), "the guest's copy is not in the fold");

      /* THE RACE RUNS. The host's clock goes past it; the guest's follows on `sh`. */
      H._station.hour = race.hour + race.runs + 0.05;
      const res = T.resultOf(race);
      const pos = (id) => res.order.find((o) => o.id === id)?.position ?? 99;
      const hostWins = pos(rows[1].id) < pos(rows[0].id), tie = pos(rows[0].id) === pos(rows[1].id);
      s.pump(1.6);
      const p1 = Cr.purse(), g1 = L.purse();
      const expectH = hostWins ? 40 : tie ? 20 : 0, expectG = tie ? 20 : hostWins ? 0 : 40;
      assert(p1 - (p0 - 20) === expectH && g1 - (g0 - 20) === expectG,
        `settled: host purse ${p0}→${p1}, guest ${g0}→${g1}, on a race the ${hostWins ? 'host' : tie ? 'nobody' : 'guest'} won`);
      assert((p1 - p0) + (g1 - g0) === 0, `the stakes did not simply move: together ${(p1 - p0) + (g1 - g0)}`);
      assert(hl.some((l) => /^SIDE BET — ALPHA — .*(beat|dead heat)/.test(l)), 'the host was not told the result');
      assert(cl.some((l) => /^SIDE BET — HOST — .*(beat|dead heat)/.test(l)), 'the guest was not told the result');
      assert(SS.sideBets().length === 0, `${SS.sideBets().length} entries still in the fold after settling`);
      return `host ${rows[1].name} v guest ${rows[0].name} on ${race.id} at ${race.hour}: ${hostWins ? 'host' : tie ? 'dead heat' : 'guest'}; purses host ${p0}→${p1}, guest ${g0}→${g1}`;
    } finally { s.close(); }
  });

  check('coopgames: the two-carrier crate lifts under two grips and not one, rides the lift, and pays both', async () => {
    /**
     * A 2000 kg crate against a grip cap of 220 (1760 at the slider's top):
     * the Force refuses one player; two players' hands on it move it. From
     * #52 on deck 48 into the Arrivals shaft, and out of it on deck 40 to the
     * far end of #7 — two sessions, one crate, the carry outliving the World
     * the way it outlives a lift ride. Paid on both purses on arrival.
     */
    const CG = await import('../../src/game/CoopGames.js');
    const Q = await import('../../src/game/Quests.js');
    const Cr = await import('../../src/game/Credits.js');
    const { SHAFTS } = await import('../../src/game/StationPlan.js');
    Q.clearWork();
    Cr.clearCredits(); Cr.pay(100);
    const L = ledger(100);
    const shaft = SHAFTS.find((x) => x.id === 'arrivals');
    let s = await coopStation(2, 48);
    let out = '';
    try {
      const H = s.host.world, C = s.clients[0].world;
      C.purseDoor = L;
      const hl = listen(H), cl = listen(C);
      const day = H._station.day;
      assert(!Q.offersAt(52, day, { guest: false }).some((j) => j.shape === 'two-carrier'), 'the crate is offered with no guest');
      const job = Q.offersAt(52, day, { guest: true }).find((j) => j.shape === 'two-carrier');
      assert(job && job.pay > 0, 'no two-carrier job on #52 with a guest connected');
      assert(Q.takeJob(job).ok, 'the crate job could not be taken');
      s.pump(0.5);
      const crate = CG.crateOf(H);
      assert(crate && crate.body.mass === CG.CRATE.mass, 'no crate stood in the Cargo hold');
      const cap = H.player.liftCapacity;
      assert(crate.body.mass > cap && crate.body.mass > 220 * Math.pow(4, 1.5),
        `a ${crate.body.mass} kg crate against a ${cap} kg grip (1760 at the slider's top) — one player could lift it`);
      assert(CG.crateOf(C), 'the guest sees no crate');
      const q = crate.body.position;
      const y0 = q.y, floor = H.floorAt(q.x, q.z);
      standAt(s, s.host, q.x + 1.6, q.z);
      standAt(s, s.clients[0], q.x - 1.6, q.z);
      s.pump(0.6);

      /* ONE GRIP: the Force refuses it beside the crate, the hands go on, and nothing lifts. */
      H.player.lastGripRefusal = { mass: CG.CRATE.mass, cap, why: 'too heavy' };
      s.pump(2);
      assert(CG.carryState()?.hands.host === true && CG.carryState()?.hands.guest === false, `hands read ${JSON.stringify(CG.carryState()?.hands)}`);
      const rest = y0 - floor;
      const oneY = crate.body.position.y - floor;
      assert(oneY - rest < 0.15, `the crate rose ${(oneY - rest).toFixed(2)} m under one grip`);
      assert(hl.some((l) => /TOO HEAVY FOR ONE/.test(l)), 'the host was not told it takes two');

      /* TWO: the guest's refused press goes up the wire as an intent; the host drives the body. */
      C.player.lastGripRefusal = { mass: CG.CRATE.mass, cap, why: 'too heavy' };
      s.pump(0.3);
      assert(CG.carryState()?.hands.guest === true, "the guest's hands never reached the host");
      s.pump(2);
      const twoY = crate.body.position.y - floor;
      assert(twoY > 0.6, `under two grips the crate is ${twoY.toFixed(2)} m above the floor`);
      /* WALK IT the way the canyon is open: the first of four directions with six metres clear. */
      const THREE = await import('three');
      const from = crate.body.position.clone();
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => !H.physics.raycast(from, new THREE.Vector3(dx, 0, dz), 6, (b) => b !== crate.body)) || [1, 0];
      const x0 = from.x, z0 = from.z;
      for (let i = 0; i < 6; i++) {
        standAt(s, s.host, H.player.position.x + dir[0] * 0.5, H.player.position.z + dir[1] * 0.5);
        standAt(s, s.clients[0], C.player.position.x + dir[0] * 0.5, C.player.position.z + dir[1] * 0.5);
        s.pump(0.25);
      }
      const walked = (crate.body.position.x - x0) * dir[0] + (crate.body.position.z - z0) * dir[1];
      assert(walked > 1.5, `the crate followed the two carriers ${walked.toFixed(2)} m along ${dir}`);

      /* INTO THE CAR: carried to the Arrivals shaft on 48. */
      crate.body.position.set(shaft.x, H.floorAt(shaft.x, shaft.z + 4) + 1, shaft.z + 4);
      standAt(s, s.host, shaft.x + 1.5, shaft.z + 4); standAt(s, s.clients[0], shaft.x - 1.5, shaft.z + 4);
      s.pump(0.8);
      assert(CG.carryState()?.stage === 'aboard', `the crate is ${CG.carryState()?.stage} beside the shaft`);
      assert(!CG.crateOf(H) && !CG.crateOf(C), 'the crate is still on a deck it left');
      assert(hl.some((l) => /INTO THE CAR/.test(l)) && cl.some((l) => /INTO THE CAR/.test(l)), 'one machine was not told the crate is aboard');
      out = `at rest ${rest.toFixed(2)} m, one grip ${oneY.toFixed(2)} m (no rise), two grips ${twoY.toFixed(2)} m, followed ${walked.toFixed(2)} m`;
    } finally { s.close(); }

    /* DECK 40: the doors open on Arrivals and the crate is in the lobby. */
    s = await coopStation(2, 40);
    try {
      const H = s.host.world, C = s.clients[0].world;
      C.purseDoor = L;
      const hl = listen(H), cl = listen(C);
      s.pump(0.5);
      const crate = CG.crateOf(H);
      assert(crate, 'the crate did not come out of the car on deck 40');
      assert(Math.hypot(crate.body.position.x - shaft.x, crate.body.position.z - shaft.z) < 8, 'the crate is not at the Arrivals lobby');
      assert(CG.crateOf(C), 'the guest sees no crate on 40');
      const to = CG.deliverPoint(H);
      const p0 = Cr.purse(), g0 = L.purse();
      const q = crate.body.position;
      standAt(s, s.host, q.x + 1.6, q.z); standAt(s, s.clients[0], q.x - 1.6, q.z);
      s.pump(0.6);
      H.player.lastGripRefusal = { mass: CG.CRATE.mass, cap: 220, why: 'too heavy' };
      C.player.lastGripRefusal = { mass: CG.CRATE.mass, cap: 220, why: 'too heavy' };
      /* Two and a half seconds, not one: the avatar stream is stamped off the
       * wall clock, and on a loaded box the guest's body reaches the host a
       * beat late — the lift itself takes under a second once both hold. */
      s.pump(2.5);
      assert(CG.carryState()?.hands.host && CG.carryState()?.hands.guest, 'hands on 40 did not both go on');
      const y = crate.body.position.y - H.floorAt(q.x, q.z);
      assert(y > 0.6, `on 40 the crate is ${y.toFixed(2)} m up under two grips`);
      assert(Q.openJobs().length === 1 && Cr.purse() === p0, 'the job settled at the lobby, twenty metres short of the gates');
      crate.body.position.set(to.x, H.floorAt(to.x, to.z) + 1, to.z);
      standAt(s, s.host, to.x + 1.5, to.z); standAt(s, s.clients[0], to.x - 1.5, to.z);
      s.pump(0.8);
      assert(Q.openJobs().length === 0 && !CG.carryState(), 'the job is still open with the crate at the gates');
      const p1 = Cr.purse(), g1 = L.purse();
      assert(p1 - p0 === 160 && g1 - g0 === 160, `paid host ${p1 - p0}, guest ${g1 - g0}`);
      assert(hl.some((l) => /^DELIVERED/.test(l)) && cl.some((l) => /^DELIVERED/.test(l)), 'a machine was not told the crate arrived');
      assert(!CG.crateOf(H) && !CG.crateOf(C), 'the delivered crate is still standing');
      return `${out}; aboard at the shaft; on 40 at the gates ${to.x.toFixed(1)},${to.z.toFixed(1)}: host +${p1 - p0}, guest +${g1 - g0}`;
    } finally { s.close(); Q.clearWork(); }
  });

  check('coopgames: nothing in it draws from Math.random', async () => {
    const src = await readFile(new URL('src/game/CoopGames.js', ROOT), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(!/Math\.random/.test(code), 'CoopGames.js calls Math.random');
    assert(/hashOf\(`sabacc2:/.test(code), 'the shared hand is not seeded off the place, day and index');
    return 'seeded replay, seeded race, plan-placed crate';
  });
}
