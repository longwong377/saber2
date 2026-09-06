/**
 * THE RIDES AND THE MEETINGS — V18 cool 4, 17, 18, 19.
 *
 * Four things that move people about the station and one that shoots at
 * them, each driven through the door the game uses (`Station.stationKey` on a
 * real world) and measured rather than believed:
 *
 *   (a) the shuttle at the docking throat leaves the drum — the player's radius
 *       passes DRUM.R + 5 mid-ride — and hands him to the flight deck through
 *       `world.onDeckLift` inside 45 s of the press;
 *   (b) the tram car carries at least two seated residents on a ride, and the
 *       player's seat moves WITH the car — his feet track the bench within
 *       0.1 m over ten seconds of travel;
 *   (c) two handlers' animals meet, circle each other (relative bearing sweeps
 *       more than 300°) and their owners trade a bark;
 *   (d) the Forge's remote fires at least six bolts in 45 s, the blade meets at
 *       least one under a scripted swing, and the rating is saved to the fold;
 *   (e) none of it rolls: no `Math.random` in the four modules or in here.
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

/** The station, through the door the game uses — `stationlife.mjs`'s helper. */
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

/** Put the player somewhere, standing. */
function put(world, x, y, z, facing = 0) {
  const p = world.player;
  p.position.set(x, y, z);
  p.velocity?.set(0, 0, 0);
  p.facing = facing;
  /* The lens looks the other way from its yaw — see `Melee.catchBolts`'s `_d`. */
  if (p.camera) { p.camera.yaw = facing + Math.PI; p.camera.pitch = 0; p.camera.syncAim?.(); }
  p.body?.setTransform?.({ x, y: y + 0.9, z }, null);
  p._sweepFromY = y;
}

const DT = 1 / 60;

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const { DRUM, PLACE, floorOf } = await import('../../src/game/StationPlan.js');
  const { stationKey, tramAtStop } = await import('../../src/game/Station.js');

  /* ── (a) the shuttle ─────────────────────────────────────────────────── */
  check('rides: the shuttle at the throat leaves the drum and docks on the flight deck inside 45 s', async () => {
    const { world, idle } = await station(40);
    try {
      const S = world._shuttle;
      assert(S, 'deck 40 dressed no shuttle at the docking throat');
      const st0 = S.state();
      assert(st0.path.len > 300, `the ride is only ${st0.path.len.toFixed(0)} m long — that is not round the drum`);
      put(world, S.frame.foot.x, S.frame.y + 0.1, S.frame.foot.z, Math.atan2(-S.frame.foot.x, -S.frame.foot.z));
      world.update(DT, idle);
      assert(!S.ride, 'a ride began before the key was pressed');
      let arrived = null, arrivedAt = null;
      world.onDeckLift = (row) => { arrived = row; };
      const took = stationKey(world);
      assert(took, 'the key at the ramp was not taken');
      assert(S.ride, 'the key was taken but no ride began');
      assert(world.player.driving === S.ride, 'the player is not riding the shuttle');
      let maxR = 0, maxAt = 0, minY = 1e9, t = 0, outsideFor = 0;
      for (let i = 0; i < 60 * 45 && !arrived; i++) {
        world.update(DT, idle);
        t += DT;
        const p = world.player.position;
        const r = Math.hypot(p.x, p.z);
        if (r > maxR) { maxR = r; maxAt = t; }
        if (r > DRUM.R + 5) outsideFor += DT;
        if (p.y < minY) minY = p.y;
        if (arrived) arrivedAt = t;
      }
      assert(arrived, `no deck transition inside 45 s (t=${t.toFixed(1)}, radius now ${Math.hypot(world.player.position.x, world.player.position.z).toFixed(1)})`);
      assert(arrived.deck === 32, `the shuttle handed the player to deck ${arrived.deck}, not the flight deck`);
      assert(maxR > DRUM.R + 5, `the ride never left the drum: max radius ${maxR.toFixed(1)} m against ${DRUM.R + 5}`);
      assert(outsideFor > 10, `only ${outsideFor.toFixed(1)} s spent outside the drum`);
      assert(arrivedAt >= 25 && arrivedAt <= 45, `the ride took ${arrivedAt.toFixed(1)} s; the brief says 25–40`);
      const st1 = S.state();
      return `${st1.path.len.toFixed(0)} m in ${arrivedAt.toFixed(1)} s, max radius ${maxR.toFixed(0)} m at ${maxAt.toFixed(0)} s, `
        + `${outsideFor.toFixed(0)} s outside, down to y=${minY.toFixed(0)}; docked → deck ${arrived.deck} (${arrived.label}); `
        + `battle in the window: ${st1.battle ? `${st1.battle.hulls} hulls, phase ${st1.battle.phase}` : 'none dressed headless'}`;
    } finally { world.dispose(); }
  });

  /* ── (b) the tram cabin ──────────────────────────────────────────────── */
  check('rides: the tram carries two seated residents and the player\'s bench moves with the car', async () => {
    const { world, idle } = await station(44);
    try {
      const life = world._stationLife;
      const cabin = world._tramCabin;
      assert(cabin, 'deck 44 dressed no tram cabin');
      const stop = PLACE.get(40);
      /* On the platform, but 3.5 m inboard of its benches — a bench in reach
       * would make the key a seat (`StationSit`), which sits above the tram. */
      const sr = Math.hypot(stop.x, stop.z);
      put(world, stop.x * (1 - 3.5 / sr), floorOf(stop) + 0.1, stop.z * (1 - 3.5 / sr));
      /* Wait for a car at this platform. */
      let waited = 0;
      while (tramAtStop(world) !== 40 && waited < 120) { world.update(DT, idle); waited += DT; }
      assert(tramAtStop(world) === 40, 'no car stood at the Arrivals platform in two minutes');
      assert(stationKey(world), 'the key at the platform did not board the car');
      assert(world._tramRide, 'boarded, but no ride is recorded');
      /* Ride: wait for the seat, then measure ten seconds of it. */
      let seatedT = 0, maxErr = 0, maxRiders = 0, moved = 0, t = 0, first = null, last = null, maxDrift = 0, spoke = 0;
      const car = life.tram.car;
      let ref = null;
      for (let i = 0; i < 60 * 20 && world._tramRide && seatedT < 10; i++) {
        world.update(DT, idle);
        t += DT;
        const s = cabin.state();
        maxRiders = Math.max(maxRiders, s.seated);
        spoke = s.spoke;
        if (!s.playerSeated) continue;
        const p = world.player.position;
        const err = Math.hypot(p.x - s.feet.x, p.z - s.feet.z);
        if (err > maxErr) maxErr = err;
        /* The feet in the car's own frame must not wander. */
        const lx = (s.feet.x - car.position.x) * Math.cos(car.rotation.y) - (s.feet.z - car.position.z) * Math.sin(car.rotation.y);
        const lz = (s.feet.x - car.position.x) * Math.sin(car.rotation.y) + (s.feet.z - car.position.z) * Math.cos(car.rotation.y);
        if (!ref) ref = { lx, lz, x: car.position.x, z: car.position.z };
        maxDrift = Math.max(maxDrift, Math.hypot(lx - ref.lx, lz - ref.lz));
        moved = Math.hypot(car.position.x - ref.x, car.position.z - ref.z);
        if (!first) first = { x: p.x, z: p.z };
        last = { x: p.x, z: p.z };
        seatedT += DT;
      }
      assert(seatedT >= 10, `the player sat for only ${seatedT.toFixed(1)} s of the ride (ride ${world._tramRide ? 'still on' : 'ended'} at t=${t.toFixed(1)})`);
      assert(maxRiders >= 2, `only ${maxRiders} residents seated in the car`);
      assert(maxErr <= 0.1, `the player's feet drifted ${maxErr.toFixed(3)} m off the bench`);
      assert(maxDrift <= 0.1, `the bench moved ${maxDrift.toFixed(3)} m inside the car`);
      assert(moved > 5, `the car moved only ${moved.toFixed(1)} m in ten seated seconds — the seat is not being carried`);
      const travelled = Math.hypot(last.x - first.x, last.z - first.z);
      const s = cabin.state();
      return `${maxRiders} riders across the aisle (${s.aboard.map((r) => `${r.name} → #${r.to}`).join(', ')}), `
        + `player seated ${seatedT.toFixed(1)} s, feet within ${(maxErr * 100).toFixed(1)} cm of the bench while the car carried him ${travelled.toFixed(1)} m; `
        + `${spoke} rider lines said`;
    } finally { world.dispose(); }
  });

  /* ── (c) the animals ─────────────────────────────────────────────────── */
  check('rides: two animals meet on the concourse, circle each other, and their owners trade a bark', async () => {
    const { world, idle } = await station(40);
    try {
      const life = world._stationLife;
      const { fieldCompanion } = await import('../../src/game/Companions.js');
      /* Two standing residents in the Concourse, made handlers the way the pool does it. */
      const conc = PLACE.get(9);
      put(world, conc.x, floorOf(conc) + 0.1, conc.z);
      for (let i = 0; i < 60 * 3; i++) world.update(DT, idle);
      const standing = [...life.live.values()].filter((b) => b && !b.wayR && b.standX !== undefined && b.position && !b._stationAnimal && b.stationPlace === 9);
      assert(standing.length >= 2, `only ${standing.length} residents standing in the Concourse to hand animals to`);
      const owners = standing.slice(0, 2);
      const pets = owners.map((o, i) => {
        const pet = fieldCompanion(world, o, 'massiff', { mine: false, side: i ? 1 : -1 });
        assert(pet, `no massiff could be fielded for ${o.stationName}`);
        pet.position.set(o.position.x + (i ? 2.5 : -2.5), o.position.y, o.position.z);
        pet.body?.setTransform?.(pet.position, null);
        pet.noAmbientHarm = true;
        pet.stationName = i ? 'Vorn the Red' : 'Grask Ironjaw';
        pet.stationRole = `massiff — ${o.stationName}'s`;
        o._stationAnimal = pet;
        return pet;
      });
      const d0 = Math.hypot(pets[0].position.x - pets[1].position.x, pets[0].position.z - pets[1].position.z);
      let t = 0, G = null;
      for (let i = 0; i < 60 * 30; i++) {
        world.update(DT, idle);
        t += DT;
        G = world._greetings?.state();
        if (G?.meetings >= 1) break;
      }
      assert(G, 'no greetings state on the world');
      assert(G.meetings >= 1, `the two animals ${d0.toFixed(1)} m apart never met in 30 s (${G.meeting ? `stuck in ${G.meeting.phase}` : 'never started'})`);
      const L = G.last;
      const deg = L.sweep * 180 / Math.PI;
      assert(deg > 300, `the circle swept only ${deg.toFixed(0)}° of relative bearing`);
      assert(L.barks.length === 2, `${L.barks.length} owner barks, not two`);
      return `${L.a} and ${L.b} met at t=${t.toFixed(1)} s, circled ${deg.toFixed(0)}°; `
        + `${L.barks.map((b) => `${b[0]}: "${b[1]}"`).join(' / ')}; ${G.nods} walker nods so far`;
    } finally { world.dispose(); }
  });

  /* ── (d) the remote ──────────────────────────────────────────────────── */
  check('rides: the Forge remote fires six bolts in 45 s, the blade meets one, and the rating is saved', async () => {
    const { world, idle } = await station(40);
    const { forgeTest, setForgeTest } = await import('../../src/game/StationSave.js');
    const { TEST } = await import('../../src/game/RemoteTest.js');
    try {
      const st = world._station;
      const R = world._remoteTest;
      assert(R, 'the Forge dressed no remote test');
      const desk = st.counters.get(10)[0];
      const ux = desk.front.x - desk.at.x, uz = desk.front.z - desk.at.z, ul = Math.hypot(ux, uz);
      const sx = desk.at.x + ux / ul * (desk.d / 2 + 0.7), sz = desk.at.z + uz / ul * (desk.d / 2 + 0.7);
      const facing = Math.atan2(-ux, -uz);
      put(world, sx, desk.at.y + 0.1, sz, facing);
      const p = world.player;
      /* Blade dark: the press is the shop's. */
      p.saber.retract?.(); p.saber.lit = false;
      world.update(DT, idle);
      const before = R.state().running;
      const shopHad = stationKey(world);
      assert(!R.state().running && !before, 'the test began with the blade dark');
      void shopHad;
      /* Blade lit: the press is Bo's. */
      p.saberDown = false; p.saber.setVisible?.(true); p.saber.ignite(); p.hum?.ignite?.();
      world.update(DT, idle);
      assert(p.saber.lit, 'the blade would not light');
      setForgeTest(null);
      assert(stationKey(world), 'the key at the desk with the blade lit was not taken');
      assert(R.state().running, 'the key was taken but no test is running');
      /* The scripted swing: the guard held, the blade swept across the line
       * every half second — the dojo's own instruction. */
      const input = { ...idle, act: (id) => id === 'blade', mouse: { dx: 0, dy: 0, wheel: 0, left: true, right: false } };
      let t = 0, firedMax = 0, met = 0, running = true;
      for (let i = 0; i < 60 * 46 && running; i++) {
        input.mouse.dx = Math.sin(t * Math.PI * 4) * 28;
        input.mouse.dy = Math.cos(t * Math.PI * 2) * 6;
        world.update(DT, input);
        t += DT;
        const s = R.state();
        firedMax = Math.max(firedMax, s.fired);
        if (s.running) met = s.met;
        running = s.running;
      }
      const s = R.state();
      assert(!running, `the test was still running at ${t.toFixed(1)} s`);
      assert(firedMax >= 6, `the remote fired only ${firedMax} bolts in ${t.toFixed(1)} s`);
      const last = s.last;
      assert(last && last.why === 'done', `the test ended with "${last?.why}"`);
      assert(last.met >= 1, `the blade met none of ${last.fired} bolts under the scripted swing`);
      const saved = forgeTest();
      assert(saved && saved.last === last.met && saved.best >= last.met && saved.n === TEST.shots, `the fold holds ${JSON.stringify(saved)} for a ${last.met} of ${TEST.shots}`);
      assert(R.plaque?._rows?.some((r) => String(r?.t ?? r).includes(`best ${saved.best}`)), 'the plaque on the counter does not show the best');
      return `${last.fired} bolts in ${last.t.toFixed(1)} s, ${last.met} met, saved best ${saved.best}/${saved.n} day ${saved.day}; plaque: ${R.plaque._rows.map((r) => r?.t ?? r).join(' | ')}`;
    } finally { world.dispose(); }
  });

  /* ── (e) no dice ─────────────────────────────────────────────────────── */
  check('rides: nothing in the four modules or this file rolls dice', async () => {
    const DICE = ['Math', 'random'].join('.');   // spelt in pieces so this file does not fail itself
    const files = ['../../src/game/Shuttle.js', '../../src/game/TramCabin.js', '../../src/game/Greetings.js', '../../src/game/RemoteTest.js', './rides.mjs'];
    const bad = [];
    let lines = 0;
    for (const f of files) {
      const src = await readFile(new URL(f, import.meta.url), 'utf8');
      lines += src.split('\n').length;
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      if (code.includes(DICE)) bad.push(f);
    }
    assert(!bad.length, `${DICE} in ${bad.join(', ')}`);
    return `${files.length} files, ${lines} lines, no ${DICE}`;
  });
}
