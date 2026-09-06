/**
 * THE CHAPEL VIGIL, THE FUNERAL, AND THE PICKPOCKET — V18 cool 7, 14 and 5.
 *
 *   (a) at 20:00 in #22 the dead men's names are read, in order, four seconds
 *       apart, on the banner and off the officiant, and the residents in the
 *       room face the memorial;
 *   (b) a funeral runs once for a newly-dead man — the litter reaches the
 *       chapel front, the fold records it, deck 44's barracks builds his bunk
 *       bare with an effects box on it — and the next vigil does not run it
 *       again;
 *   (c) the pickpocket takes a cut of the purse on the ring, runs at better
 *       than 1.4× the walker's pace, and catching him pays it back with the
 *       bounty while #25's board names him;
 *   (d) none of it reads `Math.random`.
 *
 * The roll is a real one written through `Company.save`, in the shape
 * `station.mjs`'s "#56 cuts real names" check builds — two dead men on the
 * casualty list — and the folds are cleared through their own doors at the
 * top of every body. `clocked` serialises the bodies and puts the store back.
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

const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** A room-frame point in the world, the way `Vigil.toWorld` puts it. */
function toWorld(p, lx, lz) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const C = await import('../../src/game/Company.js');
  const { ARMY_IDS } = await import('../../src/game/Command.js');
  const S = await import('../../src/game/StationSave.js');
  const V = await import('../../src/game/Vigil.js');
  const K = await import('../../src/game/Pickpocket.js');
  const Cr = await import('../../src/game/Credits.js');
  const P = await import('../../src/game/StationPlan.js');
  const { run: step } = await import('./_coop.mjs');

  const army = ARMY_IDS[0];
  const DEAD = [
    { designation: 'CT-7712', callsign: 'Boots', type: 'trooper', kills: 14, runs: 4, fate: 'kia' },
    { designation: 'CT-4471', nickname: 'Hitch', type: 'trooper', kills: 6, runs: 2, fate: 'kia' },
  ];
  /** A real roll on disk: three standing, two dead, one left behind. */
  const seedRoll = () => {
    C.clear();
    C.save({
      ...C.blank(army),
      men: [
        { id: 'a', army, type: 'trooper', designation: 'CT-1500', kills: 41, runs: 6, xp: 300, look: { callsign: 'Ladder' } },
        { id: 'b', army, type: 'trooper', designation: 'CT-2210', nickname: 'Pip', kills: 22, runs: 3, xp: 120 },
        { id: 'c', army, type: 'trooper', designation: 'CT-3007', kills: 9, runs: 1, xp: 20 },
      ],
      fallen: [
        ...DEAD.map((f) => ({ ...f, callsign: C.cleanCallsign(f.callsign) })),
        { designation: 'CT-8890', nickname: 'Lag', type: 'trooper', kills: 1, runs: 1, fate: 'left' },
      ],
    });
    S.clearStation();
  };
  const names = DEAD.map(V.deadName);
  /** Hang a log on the banner: `[t, head, line]`. */
  const logOf = (world, clock) => {
    const log = [];
    world.onNotify = (h, l) => log.push([clock.t, h, l]);
    return log;
  };
  const chapel = P.PLACE.get(V.VIGIL.chapel);
  /** Stand the player in the chapel, off the line the bearers walk in on. */
  const standIn = (world) => { const q = toWorld(chapel, 3.5, -2.5); world.player.position.set(q.x, P.floorOf(chapel) + 1, q.z); };
  /** The day, through the fold — `tickStationClock` writes `st.day` off it every frame. */
  const setDay = (st, day, hour) => { S.setStationHour(hour + 24 * day); st.hour = hour; st.day = day; };
  const inChapel = (b) => {
    const dx = b.position.x - chapel.x, dz = b.position.z - chapel.z;
    return Math.hypot(dx, dz) < chapel.w / 2;
  };

  /* ════════════════════════════════════════════════════════════════════════
   *  (a) THE VIGIL
   * ════════════════════════════════════════════════════════════════════════ */

  check('vigil: at 20:00 in #22 the dead are read in order, 4 s apart, and the room faces the memorial', async () => {
    seedRoll();
    assert(V.rollOfTheDead().map(V.deadName).join('|') === names.join('|'), `the roll of the dead reads ${V.rollOfTheDead().map(V.deadName).join(', ')}`);
    /* Both already buried: tonight is a plain vigil. */
    for (const f of DEAD) S.markFuneral(f.designation, V.bunkOf(f.designation), 0);
    const { world, idle } = await station(40);
    try {
      const st = world._station, life = world._stationLife;
      const clock = { t: 0 };
      const log = logOf(world, clock);
      standIn(world);
      life.eventIn = 1e9;
      setDay(st, 0, 19.5);
      step(world, 6, idle);
      st.hour = V.VIGIL.hour;
      step(world, 30, idle, () => { clock.t += 1 / 60; });
      const read = log.filter((r) => r[1] === 'THE CHAPEL VIGIL');
      assert(read.length === 2, `${read.length} names read in 30 s; the roll has 2`);
      assert(read.map((r) => r[2]).join('|') === names.join('|'), `read as ${read.map((r) => r[2]).join(', ')} — not the roll's order`);
      const gap = read[1][0] - read[0][0];
      assert(Math.abs(gap - V.VIGIL.gap) < 0.1, `${gap.toFixed(2)} s between names, not ${V.VIGIL.gap}`);
      /* THE OFFICIANT, before the shrine, with the last name on his plate. */
      const off = life.live.get('vigil:officiant');
      assert(off?.position && inChapel(off), 'no officiant in the chapel');
      assert(off.stationRole === names[1], `the officiant's line is "${off.stationRole}"`);
      /* THE ROOM FACES THE MEMORIAL. */
      const shrine = toWorld(chapel, 0, V.VIGIL.shrineZ);
      const standing = [...life.live.values()].filter((b) => b?.position && b !== off && b.standX !== undefined && !b.wayR && inChapel(b));
      assert(standing.length >= 3, `${standing.length} standing in the chapel after 30 s`);
      let facing = 0, worst = 0;
      for (const b of standing) {
        const want = Math.atan2(shrine.x - b.position.x, shrine.z - b.position.z);
        const off_ = Math.abs(wrapPi(b.facing - want));
        worst = Math.max(worst, off_);
        if (off_ < 0.35) facing++;
      }
      assert(facing === standing.length, `${facing} of ${standing.length} face the shrine; the worst is ${(worst * 180 / Math.PI).toFixed(0)}° off`);
      /* AND THE WALL SAYS THE SAME. */
      const rows = V.memorialRows(7).flat();
      assert(rows.join('|') === names.join('|'), `#45's wall reads ${rows.join(', ')}`);
      return `${read.length} names ${gap.toFixed(2)} s apart, in the roll's order; ${standing.length} in the room all within ${(worst * 180 / Math.PI).toFixed(0)}° of the shrine; the wall carries the same ${rows.length}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (b) THE FUNERAL
   * ════════════════════════════════════════════════════════════════════════ */

  check('vigil: a funeral runs once for a newly-dead man — the litter reaches the chapel front, the bunk is stripped after, and it does not run twice', async () => {
    seedRoll();
    /* Hitch was buried last week; Boots died in the last run. */
    S.markFuneral(DEAD[1].designation, V.bunkOf(DEAD[1].designation), 0);
    assert(V.funeralDue()?.designation === DEAD[0].designation, `the funeral due is ${V.funeralDue()?.designation}`);
    let front, litterD, gap, readLine;
    {
      const { world, idle } = await station(40);
      try {
        const st = world._station, life = world._stationLife;
        const clock = { t: 0 };
        const log = logOf(world, clock);
        standIn(world);
        life.eventIn = 1e9;
        setDay(st, 1, 19.5);
        step(world, 6, idle);
        st.hour = V.VIGIL.hour;
        step(world, 2, idle, () => { clock.t += 1 / 60; });
        const L = (life.litters || []).find((l) => l.man?.designation === DEAD[0].designation);
        assert(L, 'no litter for the dead man');
        assert(L.mesh.parent === world.scene, 'the litter is not in the scene');
        front = life.live.get('vigil:bearer:a');
        const back = life.live.get('vigil:bearer:b');
        assert(front?.wayR && back?.wayR, 'the bearers are not walkers');
        assert(Math.abs(front.wayR - P.DRUM.ringR) < 2, `the front bearer starts at r=${front.wayR.toFixed(1)}, not on the ring`);
        step(world, 58, idle, () => { clock.t += 1 / 60; });
        const at = toWorld(chapel, 0, V.VIGIL.litterZ);
        litterD = Math.hypot(L.mesh.position.x - at.x, L.mesh.position.z - at.z);
        assert(litterD < 1.5, `the litter is ${litterD.toFixed(1)} m from the chapel front after 60 s`);
        assert(!front.wayR && front.standX !== undefined, 'the front bearer is still walking');
        const men = [...life.live.keys()].filter((k) => k.startsWith('vigil:man:'));
        assert(men.length >= 1, 'none of the company came');
        const row = men.map((k) => life.live.get(k)).filter((b) => b?.position && inChapel(b) && !b.wayR);
        assert(row.length === men.length, `${row.length} of ${men.length} of the company are standing in the chapel`);
        const read = log.filter((r) => r[1] === 'THE CHAPEL VIGIL');
        assert(read.length === 2, `${read.length} lines read; his and the other name`);
        readLine = read[0][2];
        assert(readLine.includes(names[0]) && readLine.includes(DEAD[0].designation) && /14 kills/.test(readLine), `the rite reads "${readLine}"`);
        assert(read[1][2] === names[1], `the second name is "${read[1][2]}"`);
        gap = read[1][0] - read[0][0];
        assert(Math.abs(gap - V.VIGIL.gap) < 0.1, `${gap.toFixed(2)} s between the rite and the roll`);
        const done = S.funeralsDone();
        assert(done.some((f) => f.designation === DEAD[0].designation && f.bunk === V.bunkOf(DEAD[0].designation)), 'the fold does not record the funeral');
        assert(done.length === 2, `${done.length} funerals in the fold`);
      } finally { world.dispose?.(); }
    }
    /* THE BUNK, on deck 44. */
    let stripped;
    {
      const { world } = await station(44);
      try {
        const B = world._station.bunks;
        assert(B?.total === V.VIGIL.bunks, `#29 built ${B?.total} bunks`);
        stripped = B.stripped;
        assert(stripped.length === 2, `${stripped.length} bunks stripped; two men are buried`);
        const his = stripped.find((b) => b.designation === DEAD[0].designation);
        assert(his && his.bunk === V.bunkOf(DEAD[0].designation), `his bunk is not among them`);
      } finally { world.dispose?.(); }
    }
    /* AND NOT TWICE. */
    {
      const { world, idle } = await station(40);
      try {
        const st = world._station, life = world._stationLife;
        standIn(world);
        life.eventIn = 1e9;
        setDay(st, 2, 19.5);
        step(world, 6, idle);
        st.hour = V.VIGIL.hour;
        step(world, 4, idle);
        assert(life.vigil?.on, 'no vigil on the second night');
        assert(!life.vigil.funeral && !(life.litters || []).length, 'the funeral ran a second time');
        assert(S.funeralsDone().length === 2, `${S.funeralsDone().length} funerals in the fold after the second night`);
      } finally { world.dispose?.(); }
    }
    return `litter set down ${litterD.toFixed(2)} m from the chapel front; rite "${readLine}" then the roll ${gap.toFixed(2)} s later; bunk ${V.bunkOf(DEAD[0].designation)} of ${V.VIGIL.bunks} bare on deck 44 (${stripped.length} stripped); no litter on night two`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (c) THE PICKPOCKET
   * ════════════════════════════════════════════════════════════════════════ */

  check('vigil: the pickpocket takes a cut on the ring, runs at >1.4× the walk, and catching him pays it back plus the bounty the board names', async () => {
    seedRoll();
    Cr.clearCredits();
    Cr.pay(1000);
    const day = 3;
    const B = K.bountyFor(day);
    const { noticesFor } = await import('../../src/game/Notices.js');
    const row = noticesFor(day, 13).find((n) => n.id === 'bounty');
    assert(row, 'no bounty row on #25');
    assert(row.say.includes(B.name) && row.say.includes(String(B.pay)), `the board says "${row.say}"`);
    const { talkTo } = await import('../../src/game/Station.js');
    const { world, idle } = await station(40);
    try {
      const st = world._station, life = world._stationLife;
      const clock = { t: 0 };
      const log = logOf(world, clock);
      const R = P.DRUM.ringR, a = 0.4;
      world.player.position.set(R * Math.sin(a), (P.DECK_Y[40] ?? 0) + 1, R * Math.cos(a));
      life.eventIn = 1e9;
      setDay(st, day, K.pickHour(day) + 0.05);
      step(world, 3, idle);
      const b = life.live.get('pickpocket');
      assert(b?.position, 'no pickpocket on the ring');
      assert(b.stationName === B.name, `the thief is ${b.stationName}; the board names ${B.name}`);
      /* HIS WALK, before the lift. */
      const p0 = b.position.clone();
      step(world, 1, idle);
      const walk = Math.hypot(b.position.x - p0.x, b.position.z - p0.z);
      /* THE BRUSH. */
      let lifted = null;
      for (let i = 0; i < 20 * 60 && !lifted; i++) {
        world.update(1 / 60, idle); clock.t += 1 / 60;
        if (life.pick?.lifted) lifted = life.pick.lifted;
      }
      assert(lifted, 'he never brushed past');
      assert(lifted >= 50 && lifted <= 150, `he took ${lifted} of 1000 — not 5–15 %`);
      assert(Cr.purse() === 1000 - lifted, `the purse is ${Cr.purse()}`);
      const said = log.find((r) => r[1] === 'PICKPOCKET');
      assert(said && said[2].includes(B.name) && said[2].includes(String(lifted)), `the banner says "${said?.[2]}"`);
      /* THE RUN. */
      const p1 = b.position.clone();
      step(world, 1, idle);
      const run_ = Math.hypot(b.position.x - p1.x, b.position.z - p1.z);
      assert(run_ > 1.4 * 1.35 * 0.95, `he runs at ${run_.toFixed(2)} m/s; the walk is 1.35`);
      assert(run_ > 1.4 * walk, `he runs at ${run_.toFixed(2)} m/s against a walk of ${walk.toFixed(2)}`);
      /* THE CATCH: out of reach, then in it. */
      world.player.position.set(b.position.x + 3, b.position.y, b.position.z);
      assert(talkTo(world, b), 'the key did nothing at 3 m');
      assert(Cr.purse() === 1000 - lifted, 'he was caught from 3 m');
      world.player.position.set(b.position.x + 0.8, b.position.y, b.position.z);
      assert(talkTo(world, b), 'the key did nothing at 0.8 m');
      assert(life.pick.caught, 'not caught');
      assert(Cr.purse() === 1000 + B.pay, `the purse is ${Cr.purse()}; expected ${1000 + B.pay}`);
      step(world, 0.2, idle);
      assert(!life.live.get('pickpocket'), 'he is still on the ring after the catch');
      assert(S.pickpocketState()?.caught && S.pickpocketState().day === day, 'the fold does not say he was caught');
      /* ONCE A DAY. */
      st.hour = K.pickHour(day) + 0.05;
      step(world, 3, idle);
      assert(!life.live.get('pickpocket'), 'a second thief the same day');
      return `${B.name} took ${lifted} of 1000 at ${K.pickHour(day)}:00, walked at ${walk.toFixed(2)} m/s and ran at ${run_.toFixed(2)} (${(run_ / walk).toFixed(2)}×); caught at 0.8 m for ${lifted} + ${B.pay} bounty; the board's row: "${row.say}"`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (d) NO DICE
   * ════════════════════════════════════════════════════════════════════════ */

  check('vigil: nothing in Vigil.js or Pickpocket.js reads Math.random', async () => {
    for (const f of ['Vigil.js', 'Pickpocket.js']) {
      const src = await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8');
      assert(!/Math\.random/.test(src), `${f} reads Math.random`);
    }
    return 'two files, seeded off the day and the man';
  });
}
