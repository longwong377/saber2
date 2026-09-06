/**
 * V19 additions 2 and 3: THE JOURNAL IN THE CABIN, and PROMOTIONS AND
 * REFUSALS at the barracks muster.
 *
 *   (a) five different events, through their own doors, write five lines with
 *       the right day and hour; the page caps at 40 and the book at 30 days;
 *       the fold survives a round trip through the store.
 *   (b) the key at the cabin's desk opens the page, and the page carries
 *       today's lines; the key again turns back a day; walking off closes it.
 *   (c) a man over his rank's bar is promoted once at 08:00 in #29: the line
 *       read, the mark persisted, a stripe on his arm, and no second reading.
 *   (d) an unfit man is skipped by the sortie roster with a line on the slate,
 *       stands in the barracks with his reason, and is fit the next day.
 *   (e) no Math.random in either file.
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

async function station(deck = 44) {
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

function toWorld(p, lx, lz) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const J = await import('../../src/game/Journal.js');
  const S = await import('../../src/game/StationSave.js');
  const C = await import('../../src/game/Company.js');
  const Cr = await import('../../src/game/Credits.js');
  const Q = await import('../../src/game/Quests.js');
  const { payAtTote } = await import('../../src/game/Station.js');
  const T = await import('../../src/game/Tote.js');
  const R = await import('../../src/game/Regulars.js');
  const P = await import('../../src/game/Promotion.js');
  const M = await import('../../src/game/Muster.js');
  const Pl = await import('../../src/game/StationPlan.js');
  const { ARMY_IDS, RANKS, rankFor } = await import('../../src/game/Command.js');
  const { run: step } = await import('./_coop.mjs');

  const army = ARMY_IDS[0];
  /* The fold's day only goes forward — `setStationHour` ADDS whole days — so
   * the helper hands it the difference. */
  const setDay = (st, day, hour) => { S.setStationHour(hour + 24 * Math.max(0, day - S.stationDay())); if (st) { st.hour = hour; st.day = day; } };

  check('journal: five doors write five lines stamped with the day and hour; the caps hold; the fold round-trips', () => {
    S.clearStation(); Cr.clearCredits(); Q.clearWork();
    setDay(null, 3, 14.5);
    const world = { notify() {}, _station: { day: 3, hour: 14.5 } };
    /* 1 a talk — Regulars.talkHook */
    const body = { stationResident: true, stationName: 'Teela Vor', stationSpecies: 'human', stationRole: 'trader' };
    R.talkHook(world, body);
    /* 2 a purchase — Credits.spend with a reason */
    Cr.pay(500, 'purse');
    const bought = Cr.spend(40, 'the clothier');
    assert(bought.ok, 'the purchase was refused');
    /* 3 a job taken — Quests.takeJob */
    const offers = Q.offersAt(20, 3).concat(Q.offersAt(21, 3), Q.offersAt(23, 3), Q.offersAt(24, 3), Q.offersAt(25, 3));
    assert(offers.length, 'no job on any board on day 3');
    assert(Q.takeJob(offers[0]).ok, 'the job was not taken');
    /* 4 a bet and its result — `Station.payAtTote`, the purse's side of the
     * tote (Tote.js is a pure library and writes no journal) */
    payAtTote([{ kind: 'win', on: 'a', stake: 10, price: 3 }], { winner: 'a', order: [{ id: 'a', position: 1 }, { id: 'b', position: 2 }] });
    /* 5 a man's fate — Company.keep */
    C.clear();
    C.save({ ...C.blank(army), men: [{ id: 'a', army, type: 'trooper', designation: 'CT-1500', kills: 3, runs: 1, xp: 2 }] });
    C.keep([], { army, deployed: C.fieldable(C.load(army), 1), ground: 'Geonosis' });
    const page = J.pageOf(3);
    const kinds = page.map((l) => l.k);
    assert(page.length >= 5, `${page.length} lines on day 3, wanted five: ${kinds.join(', ')}`);
    for (const k of ['talk', 'buy', 'job', 'bet', 'fate']) assert(kinds.includes(k), `no '${k}' line: ${kinds.join(', ')}`);
    for (const l of page) assert(Math.abs(l.h - 14.5) < 1.01, `a line stamped ${l.h}, not 14:30`);
    assert(page.find((l) => l.k === 'talk').t.includes('Teela Vor'), 'the talk line does not name her');
    assert(page.find((l) => l.k === 'buy').t.includes('40'), 'the purchase line has no price');
    assert(page.find((l) => l.k === 'bet').t.includes('30 back'), `the bet line is "${page.find((l) => l.k === 'bet').t}"`);
    assert(page.find((l) => l.k === 'fate').t.includes('CT-1500'), 'the fate line does not name him');
    /* THE CAPS. */
    const before = page.length;
    for (let i = 0; i < 60; i++) J.note('note', `filler ${i}`, { day: 3, hour: 15 });
    assert(J.pageOf(3).length === J.LINES_A_DAY, `${J.pageOf(3).length} lines on the page after 60 more; the cap is ${J.LINES_A_DAY}`);
    assert(J.pageOf(3)[before].t === 'filler 0', 'the cap kept the evening and dropped the morning');
    for (let d = 4; d < 4 + 40; d++) J.note('note', `day ${d}`, { day: d, hour: 9 });
    const days = J.daysWritten();
    assert(days.length === J.DAYS_KEPT, `${days.length} days kept; the book keeps ${J.DAYS_KEPT}`);
    assert(days[0] === 43 && !days.includes(3), `the newest day kept is ${days[0]} and day 3 ${days.includes(3) ? 'survived' : 'was dropped'}`);
    /* THE ROUND TRIP: what the store holds is what the book reads. */
    const raw = JSON.parse(globalThis.localStorage.getItem('saber.station.v1'));
    assert(raw?.journal?.days && Object.keys(raw.journal.days).length === J.DAYS_KEPT, 'the store does not hold the journal');
    assert(JSON.stringify(raw.journal.days['43']) === JSON.stringify(J.pageOf(43)), 'the store and the book disagree on day 43');
    return `five doors, five kinds (${kinds.slice(0, 5).join(', ')}) at 14:30 on day 3; ${J.LINES_A_DAY}-line cap and ${J.DAYS_KEPT}-day book hold; the fold round-trips`;
  });

  check('journal: no Math.random in Journal.js or Promotion.js', async () => {
    for (const f of ['Journal', 'Promotion']) {
      const src = await readFile(new URL(`../../src/game/${f}.js`, import.meta.url), 'utf8');
      assert(!/Math\.random/.test(src), `${f}.js rolls Math.random`);
    }
    return 'neither file rolls a die';
  });

  check('journal: the key at the cabin desk opens the page with today\'s lines; the key turns back a day; walking off closes it', async () => {
    S.clearStation();
    setDay(null, 5, 10);
    J.note('talk', 'talked to somebody on the ring', { day: 5, hour: 9.25 });
    J.note('buy', 'spent 12 credits — the food court', { day: 5, hour: 9.5 });
    J.note('sleep', 'slept 8 hours', { day: 4, hour: 7 });
    const H = await import('../../src/game/Home.js');
    const { world, idle } = await station(44);
    try {
      const st = world._station;
      setDay(st, 5, 10);
      const h = world._home;
      assert(h?.desk?.at, 'the cabin dressed no desk');
      const log = [];
      world.onNotify = (a, b) => log.push([a, b]);
      /* Stand a step off the desk, inside the room. */
      const p = h.desk.at;
      world.player.position.set(p.x - Math.cos(h.spot.yaw) * 1.0, p.y + 1, p.z + Math.sin(h.spot.yaw) * 1.0);
      const d0 = world.player.position.distanceTo(p);
      assert(d0 < 2.0, `the player stands ${d0.toFixed(2)} m off the desk`);
      assert(H.homeKey(world) === true, 'the key at the desk was not spent');
      assert(J.journalOpen(world), 'the journal did not open');
      const Jn = world._journal;
      assert(Jn.mesh && Jn.mesh.parent === world.scene, 'no page mesh in the scene');
      assert(Jn.day === 5, `the page opened on day ${Jn.day}`);
      assert(Jn.lines.length === 2, `${Jn.lines.length} lines on today's page`);
      assert(Jn.rows.some((r) => r.includes('0915') && r.includes('somebody on the ring')), `the painted rows are ${Jn.rows.join(' | ')}`);
      assert(log.some((l) => l[0] === 'THE JOURNAL' && /turns back a day/.test(l[1])), 'the first open did not say how to flip');
      assert(S.hasSeen('journal'), 'hasSeen was not marked');
      const cam = world.player.camera?.camera;
      if (cam) {
        const dCam = Jn.mesh.position.distanceTo(cam.position);
        assert(Math.abs(dCam - J.PAGE.ahead) < 0.05, `the page is ${dCam.toFixed(2)} m from the eye`);
      }
      /* The key again: back a day. */
      assert(H.homeKey(world) === true, 'the second key was not spent');
      assert(world._journal.day === 4, `the second key turned to day ${world._journal.day}`);
      assert(world._journal.lines.length === 1 && world._journal.lines[0].k === 'sleep', 'day 4 does not carry the sleep line');
      /* The wheel forward again. */
      assert(H.homeWheel(world, -1) && world._journal.day === 5, 'the wheel did not turn forward');
      /* Walk off: the page closes on the next frame. */
      world.player.position.set(p.x - Math.cos(h.spot.yaw) * 4.0, p.y + 1, p.z + Math.sin(h.spot.yaw) * 4.0);
      step(world, 0.2, idle);
      assert(!J.journalOpen(world), 'the journal stayed open after walking off');
      assert(!world.scene.children.includes(Jn.mesh), 'the page mesh is still in the scene');
      return `desk at ${d0.toFixed(2)} m; opened on day 5 with 2 lines (${Jn.rows.length} rows painted); key → day 4, wheel → day 5; closed at 4 m`;
    } finally { world.dispose?.(); }
  });

  check('journal: a man over the bar is promoted once at 08:00 in #29 — the line read, the rank persisted, a stripe on his arm', async () => {
    S.clearStation();
    C.clear();
    C.save({
      ...C.blank(army),
      men: [
        { id: 'a', army, type: 'trooper', designation: 'CT-1500', kills: 41, runs: 6, xp: 12, look: { callsign: 'Ladder' }, promoted: 1 },
        { id: 'b', army, type: 'trooper', designation: 'CT-2210', nickname: 'Pip', kills: 2, runs: 1, xp: 1 },
      ],
    });
    const due0 = P.promotionsDue(C.load(army));
    assert(due0.length === 1 && due0[0].designation === 'CT-1500', `${due0.length} due; wanted Ladder alone`);
    assert(rankFor(12) === 2, 'xp 12 is not the Sergeant bar');
    const { world, idle } = await station(44);
    try {
      const st = world._station, life = world._stationLife;
      const clock = { t: 0 };
      const log = [];
      world.onNotify = (a, b) => log.push([clock.t, a, b]);
      const room = Pl.PLACE.get(P.MUSTER.barracks);
      const q = toWorld(room, 4, -4);
      world.player.position.set(q.x, Pl.floorOf(room) + 1, q.z);
      life.eventIn = 1e9;
      setDay(st, 2, 7.9);
      step(world, 4, idle);
      assert(!life.muster?.on, 'the muster began before 08:00');
      st.hour = P.MUSTER.hour;
      step(world, 12, idle, () => { clock.t += 1 / 60; });
      const read = log.filter((r) => r[1] === 'THE MUSTER');
      const line = read.find((r) => /Ladder.*Sergeant/.test(r[2]));
      assert(line, `no promotion read; the muster said: ${read.map((r) => r[2]).join(' | ') || 'nothing'}`);
      assert(Math.abs(line[0] - P.MUSTER.gap) < 0.2, `the line was read at ${line[0].toFixed(1)} s, not ${P.MUSTER.gap}`);
      const sgt = life.live.get('muster:sergeant');
      assert(sgt && sgt.stationPlace === room.id, 'no sergeant in the barracks');
      assert(sgt.stationRole === line[2], `the sergeant's bark is "${sgt.stationRole}"`);
      const man = life.live.get('muster:man:CT-1500');
      assert(man, 'the promotee was not spawned into the line');
      const dm = Math.hypot(man.position.x - room.x, man.position.z - room.z);
      assert(dm < room.w / 2, `the promotee stands ${dm.toFixed(1)} m from the room's centre`);
      assert(man.stripe && man.stripeRank === 2, `no stripe on his arm (rank ${man.stripeRank})`);
      assert(man.stripe.parent === man.rig.obj('armL'), 'the stripe is not on the upper arm');
      const rec = C.load(army).men.find((m) => m.designation === 'CT-1500');
      assert(rec.promoted === 2, `the roll carries promoted = ${rec.promoted}`);
      assert(rankFor(rec.xp) === 2 && rec.xp === 12, 'the promotion touched his xp');
      const dueAfter = P.promotionsDue(C.load(army));
      assert(dueAfter.length === 0, `${dueAfter.length} still due after the reading`);
      /* THE LINE: everybody the pool has in the room and the promotee face the sergeant. */
      const inLine = [...life.live.values()].filter((b) => b && b.stationPlace === room.id && b.standStill && b !== sgt && !b.seat);
      assert(inLine.length >= 1, 'nobody stands in the line');
      const dismissed = read.find((r) => r[2] === 'dismissed');
      assert(dismissed, 'the muster was never dismissed');
      /* ONCE: the window is still open; the day is marked; a second begin does nothing. */
      step(world, P.MUSTER.tail + 2, idle, () => { clock.t += 1 / 60; });
      assert(!life.muster.on, 'the muster is still on after its tail');
      assert(!life.live.get('muster:sergeant'), 'the sergeant is still standing after the dismissal');
      step(world, 2, idle, () => { clock.t += 1 / 60; });
      assert(!life.muster.on && log.filter((r) => r[1] === 'THE MUSTER' && /Ladder/.test(r[2])).length === 1, 'the promotion was read twice');
      const journal = J.pageOf(2).filter((l) => l.k === 'muster');
      assert(journal.length === 1 && /Ladder.*Sergeant/.test(journal[0].t), 'the journal did not get the muster line');
      return `read at ${line[0].toFixed(1)} s: "${line[2]}"; promoted = ${rec.promoted} on the roll; stripe on armL; ${inLine.length} in the line; read once; dismissed`;
    } finally { world.dispose?.(); }
  });

  check('journal: an unfit man is skipped by the sortie roster with a line, stands in the barracks with his reason, and is fit the next day', async () => {
    S.clearStation();
    C.clear();
    C.save({
      ...C.blank(army),
      men: [
        { id: 'a', army, type: 'trooper', designation: 'CT-1500', kills: 41, runs: 6, xp: 12, look: { callsign: 'Ladder' }, promoted: 2 },
        { id: 'b', army, type: 'trooper', designation: 'CT-2210', nickname: 'Pip', kills: 22, runs: 3, xp: 5, squad: 1 },
        { id: 'c', army, type: 'trooper', designation: 'CT-3007', kills: 9, runs: 1, xp: 1, wounds: 2 },
        { id: 'd', army, type: 'trooper', designation: 'CT-4040', kills: 1, runs: 1, xp: 0 },
      ],
      fallen: [{ designation: 'CT-7712', callsign: 'Boots', type: 'trooper', kills: 14, runs: 4, fate: 'kia', squad: 1 }],
    });
    const plan = { army, want: 4, armyMode: true };
    const c = C.load(army);
    const line = M.lineup(plan, c, { versus: true, day: 6 });
    const names = line.map((m) => m.designation);
    assert(!names.includes('CT-2210') && !names.includes('CT-3007'), `the roster fields ${names.join(', ')}`);
    assert(names.includes('CT-1500') && names.includes('CT-4040'), `the fit men were dropped: ${names.join(', ')}`);
    assert(line.refused.length === 2, `${line.refused.length} refusals`);
    const pip = line.refused.find((r) => r.designation === 'CT-2210');
    assert(pip && pip.line === 'CT-2210 "Pip" refused the drop — he buried CT-7712 yesterday', `Pip's line is "${pip?.line}"`);
    const wounded = line.refused.find((r) => r.designation === 'CT-3007');
    assert(wounded && /wounded twice/.test(wounded.line), `the wounded man's line is "${wounded?.line}"`);
    /* Persisted, with the day. */
    const rec = C.load(army).men.find((m) => m.designation === 'CT-2210');
    assert(rec.refused && rec.refused.day === 6, `the roll carries refused = ${JSON.stringify(rec.refused)}`);
    /* The same day again: still refused, not re-written. */
    assert(M.lineup(plan, C.load(army), { versus: true, day: 6 }).refused.length === 2, 'the refusal did not hold for the day');
    /* The next day: fit again. */
    const next = M.lineup(plan, C.load(army), { versus: true, day: 7 });
    assert(next.refused.length === 0 && next.map((m) => m.designation).includes('CT-2210'), `on day 7 the roster is ${next.map((m) => m.designation).join(', ')} with ${next.refused.length} refusals`);
    /* A new wound is a new refusal. */
    const c2 = C.load(army);
    c2.men.find((m) => m.designation === 'CT-2210').wounds = 2;
    C.save(c2);
    assert(M.lineup(plan, C.load(army), { versus: true, day: 7 }).refused.some((r) => r.designation === 'CT-2210'), 'a new wound did not make a new refusal');
    /* AND HE STANDS IN THE BARRACKS, with his reason. */
    S.clearStation();
    C.save({ ...c, men: c.men.map((m) => ({ ...m, refused: undefined })) });
    setDay(null, 6, 12);
    const { world, idle } = await station(44);
    try {
      const st = world._station, life = world._stationLife;
      setDay(st, 6, 12);
      life.eventIn = 1e9;
      step(world, 1, idle);
      const b = life.live.get('muster:refused:CT-2210');
      assert(b, 'Pip does not stand in the barracks');
      const room = Pl.PLACE.get(P.MUSTER.barracks);
      const d = Math.hypot(b.position.x - room.x, b.position.z - room.z);
      assert(d < room.w / 2, `he stands ${d.toFixed(1)} m from #29's centre`);
      const { talkTo } = await import('../../src/game/Station.js');
      const log = [];
      world.onNotify = (a, bb) => log.push([a, bb]);
      assert(talkTo(world, b), 'talking to him spent nothing');
      const said = log[log.length - 1];
      assert(/buried CT-7712/.test(said[1]), `he said "${said[1]}"`);
      return `roster ${names.join(', ')}; refused: "${pip.line}" and "${wounded.line}"; day 7 fields him again; a new wound refuses again; he stands ${d.toFixed(1)} m into #29 and says "${said[1]}"`;
    } finally { world.dispose?.(); }
  });
}
