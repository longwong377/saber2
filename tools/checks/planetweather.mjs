/**
 * THE WEATHER ON THE PLANET BELOW — V18 cool 16: *"Weather on the planet
 * below, visible from the dome, changing the news."*
 *
 * `StationEvents.weatherAt(day, theatre)` was already in the news and on the
 * orbit chart; this suite is the half that puts it in the sky.
 *
 *   · THE SKY AND THE WORD ARE ONE CALL. On the station the SkyDome's
 *     `uWeather` is the row of `weatherAt(st.day, st.theatre)` — the same
 *     record the Holonet prints — and it moves when the day does. On the
 *     flight deck the same uniforms come off `stationDay()` and
 *     `outsideLevel(world).name`.
 *   · THE SHADER HAS THE BRANCH: eight weather ids read in the fragment, the
 *     three uniforms declared in the GLSL and on the material, braces balanced
 *     over the whole source, and the terminator (`day`) still multiplies it.
 *   · THE LINE, ONCE A DAY. Looking up at the disc from the dome or the
 *     promenade says one `world.notify` line; looking away says nothing;
 *     looking again the same day says nothing; the next day says it again.
 *   · NOTHING ROLLS.
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
async function station(deck = 60) {
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

/**
 * Point the player's eye down `dir`. `Player.syncAim` rebuilds `aimDir` from
 * the camera's yaw and pitch every frame (YXZ Euler), so a check that wrote
 * `aimDir` directly would be overwritten on the next update — the yaw and
 * pitch are the thing to set, and `syncAim` is called so the same frame reads
 * it too.
 */
function face(world, dir) {
  const cam = world.player.camera;
  cam.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  cam.yaw = Math.atan2(-dir.x, -dir.z);
  cam.syncAim();
  cam.aimDirection(world.player.aimDir);
}

/** Brace balance of a GLSL string, and that no scope closes below zero. */
function bracesBalanced(src) {
  let depth = 0;
  for (const c of src) {
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

export async function run({ check, assert, THREE }) {
  const PW = await import('../../src/game/PlanetWeather.js');
  const { weatherAt, WEATHER } = await import('../../src/game/StationEvents.js');
  const Save = await import('../../src/game/StationSave.js');
  /* THE WORLDS BELOW SHARE ONE SAVE. `check` starts every body at once, and
   * three stations passing 24 hours on the same store would turn each other's
   * day mid-assertion — so the booting checks run one after another. */
  let gate = Promise.resolve();
  const serial = (fn) => { const p = gate.then(fn); gate = p.catch(() => {}); return p; };

  /* ════════════════════════════════════════════════════════════════════════
   *  THE SHADER
   * ════════════════════════════════════════════════════════════════════════ */

  check('planetweather: the sky fragment carries the weather branch, its uniforms declared in GLSL and on the material, braces balanced', async () => {
    const { SkyDome } = await import('../../src/engine/SkyDome.js');
    const dome = new SkyDome(new THREE.Scene());
    const fs = dome.mat.fragmentShader;
    for (const u of ['uWeather', 'uWeatherSeed', 'uWeatherT']) {
      assert(new RegExp(`uniform float ${u};`).test(fs), `${u} not declared in the GLSL`);
      assert(dome.mat.uniforms[u] && typeof dome.mat.uniforms[u].value === 'number', `${u} not on the material`);
    }
    assert(fs.includes('if (uWeather > 0.5 && uWeather < 8.5)'), 'no weather branch');
    /* eight ids, one branch each */
    for (const k of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]) assert(fs.includes(`wid < ${k}`), `no branch for id ${k - 0.5}`);
    for (const w of ['wTint', 'wSnow', 'wDust', 'wFlash']) assert(fs.includes(w), `no ${w}`);
    /* the terminator still multiplies the day's weather: the dust and the
     * cloud plate both carry `day`, the flash carries (1 - day) */
    assert(/wDust \* 0\.70 \* day/.test(fs), 'the dust ignores the terminator');
    assert(/uPlanetDark \* uAtmoCol \* 0\.10\) \* uOrbitKey \* wTint/.test(fs), 'the tint is not on the cloud plate');
    assert(fs.includes('uOrbitT * 0.0021'), 'the weather does not drift on uOrbitT');
    assert(bracesBalanced(fs), 'braces unbalanced in the sky fragment');
    /* three's own GLSL prelude can only be checked in a GL context; the
     * literal's own arithmetic is what this suite can read */
    const body = fs.slice(fs.indexOf('if (uWeather > 0.5'), fs.indexOf('cm = clamp(cm, 0.0, 1.0) * smoothstep(1.0, 0.90, s);'));
    assert(bracesBalanced(body + '}'), 'braces unbalanced inside the weather branch');
    assert(!/\bfloat wid\b.*\bfloat wid\b/s.test(body), 'wid declared twice');
    return `${WEATHER.length} words, 3 uniforms, ${fs.length} chars, balanced`;
  });

  check('planetweather: every word maps to its own id, the seed and the place change with the day and the theatre', () => {
    const ids = WEATHER.map((w) => PW.weatherId(w.word));
    assert(new Set(ids).size === WEATHER.length, `ids ${ids}`);
    assert(ids.every((i, k) => i === k + 1), `ids are not 1 + row: ${ids}`);
    assert(PW.weatherId('sleet') === 0, 'an unknown word is not 0');
    const seeds = new Set(), places = new Set();
    for (let d = 0; d < 12; d++) for (const t of ['Kessel', 'Geonosis', 'the line']) {
      const w = weatherAt(d, t);
      const s = PW.weatherSeed(w);
      assert(s >= 0 && s < 1000, `seed ${s} out of the float's comfort`);
      seeds.add(`${s}`); places.add(PW.weatherPlace(w));
      assert(PW.weatherSeed(weatherAt(d, t)) === s, 'the seed is not pure');
    }
    assert(seeds.size >= 30, `${seeds.size} distinct seeds over 36 (day, theatre) pairs`);
    assert(places.size === 3, `places seen: ${[...places]}`);
    const line = PW.weatherLine(weatherAt(3, 'Kessel'));
    assert(/^Kessel: .+ (the northern hemisphere|the southern hemisphere|the equator)$/.test(line), line);
    return `${seeds.size} seeds; e.g. "${line}"`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE STATION: THE SKY IS THE NEWS
   * ════════════════════════════════════════════════════════════════════════ */

  check('planetweather: on the station the sky\'s uniforms are weatherAt(day, theatre)\'s row, and they move with the day', () => serial(async () => {
    Save.clearStation();
    const { world, idle } = await station(60);
    try {
      const st = world._station;
      const sky = world.engine.skyDome;
      assert(sky?._orbit, 'no orbit in the window');
      world.update(1 / 60, idle);
      assert(st.weather, 'no weather stamped');
      const w0 = weatherAt(st.day, st.theatre);
      assert(st.weather.word === w0.word, `stamped ${st.weather.word}, weatherAt says ${w0.word}`);
      const u = sky.mat.uniforms;
      assert(u.uWeather.value === PW.weatherId(w0.word), `uWeather ${u.uWeather.value} for "${w0.word}" (${PW.weatherId(w0.word)})`);
      assert(u.uWeatherSeed.value === PW.weatherSeed(w0), 'seed differs');
      assert(u.uWeatherT.value === PW.weatherPhase(w0), 'phase differs');
      /* and the theatre is the one the window shows */
      const { outsideLevel } = await import('../../src/game/Hangar.js');
      assert(st.theatre === (outsideLevel(world)?.name || 'the line'), `theatre ${st.theatre}`);
      /* the day turns */
      const day0 = st.day;
      let moved = null;
      for (let d = 1; d <= 6 && !moved; d++) {
        Save.passStationHours(24);
        world.update(1 / 60, idle);
        assert(st.day === day0 + d, `day ${st.day} after ${d} passes`);
        const w = weatherAt(st.day, st.theatre);
        assert(st.weather.word === w.word, `day ${st.day}: stamped ${st.weather.word}, weatherAt ${w.word}`);
        assert(u.uWeather.value === PW.weatherId(w.word), `day ${st.day}: uWeather ${u.uWeather.value} for ${w.word}`);
        assert(u.uWeatherSeed.value === PW.weatherSeed(w), `day ${st.day}: seed`);
        if (w.word !== w0.word) moved = { d, word: w.word };
      }
      assert(moved, `six days and the word never changed from ${w0.word}`);
      return `day ${day0}: "${w0.word}" id ${PW.weatherId(w0.word)} → day ${day0 + moved.d}: "${moved.word}" id ${PW.weatherId(moved.word)} over ${st.theatre}`;
    } finally { world.dispose?.(); }
  }));

  check('planetweather: on the flight deck the same day and theatre give the same sky', () => serial(async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { outsideLevel } = await import('../../src/game/Hangar.js');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    try {
      const sky = world.engine.skyDome;
      assert(sky?._orbit, 'no orbit in the opening');
      const w = weatherAt(Save.stationDay(), outsideLevel(world)?.name || 'the line');
      const u = sky.mat.uniforms;
      assert(u.uWeather.value === PW.weatherId(w.word), `uWeather ${u.uWeather.value} for "${w.word}"`);
      assert(u.uWeatherSeed.value === PW.weatherSeed(w), 'seed differs');
      return `deck sees "${w.word}" over ${w.theatre} on day ${w.day}`;
    } finally { world.dispose?.(); }
  }));

  /* ════════════════════════════════════════════════════════════════════════
   *  THE LINE, ONCE A DAY
   * ════════════════════════════════════════════════════════════════════════ */

  check('planetweather: looking up at the disc from the dome says the line once a day; away says nothing; the next day says it again', () => serial(async () => {
    Save.clearStation();
    const { world, idle } = await station(60);
    try {
      const st = world._station;
      const u = world.engine.skyDome.mat.uniforms;
      const said = [];
      world.notify = (t, l) => { if (t === 'OBSERVATION DOME' || t === 'THE PROMENADE') said.push(`${t}: ${l}`); };
      world.update(1 / 60, idle);
      assert(st.deck === 60, `deck ${st.deck}`);
      /* away: straight down the drum, opposite the planet */
      face(world, u.uPlanetDir.value.clone().negate());
      assert(PW.stepPlanetLook(world, st) === null, 'said it facing away');
      for (let i = 0; i < 5; i++) world.update(1 / 60, idle);
      assert(said.length === 0, `said ${said} facing away`);
      /* at the planet, through the game's own step so the hook line is proven */
      face(world, u.uPlanetDir.value);
      world.update(1 / 60, idle);
      assert(said.length === 1, `said ${said.length}: ${said}`);
      const expect = `OBSERVATION DOME: ${PW.weatherLine(st.weather)}`;
      assert(said[0] === expect, `"${said[0]}" ≠ "${expect}"`);
      assert(Save.hasSeen(PW.lookKey(st.day)), 'not marked seen');
      /* again, same day: nothing */
      for (let i = 0; i < 5; i++) world.update(1 / 60, idle);
      assert(PW.stepPlanetLook(world, st) === null, 'said it twice in a day');
      assert(said.length === 1, `said ${said.length} the same day`);
      /* the fleet beside it counts as looking up too */
      face(world, u.uFleetDir.value);
      assert(PW.facingPlanet(world), 'the fleet beside the disc does not count');
      /* next day: once more, and with that day's word */
      Save.passStationHours(24);
      face(world, u.uPlanetDir.value);
      /* two frames: the first turns the clock, the second carries the stamp
       * — and the first must NOT say yesterday's line under today's key */
      world.update(1 / 60, idle);
      assert(said.length === 1, `said yesterday's line on the new day's first frame: ${said}`);
      world.update(1 / 60, idle);
      assert(said.length === 2, `said ${said.length} after the day turned: ${said}`);
      assert(said[1] === `OBSERVATION DOME: ${PW.weatherLine(st.weather)}`, said[1]);
      world.update(1 / 60, idle);
      assert(said.length === 2, 'said it twice on day two');
      return `"${said[0]}" then "${said[1]}"`;
    } finally { world.dispose?.(); }
  }));

  check('planetweather: the promenade says it under its own heading; the working deck does not say it at all', () => serial(async () => {
    Save.clearStation();
    const { world, idle } = await station(44);
    try {
      const st = world._station;
      const u = world.engine.skyDome.mat.uniforms;
      const said = [];
      world.notify = (t) => { if (t === 'OBSERVATION DOME' || t === 'THE PROMENADE') said.push(t); };
      world.update(1 / 60, idle);
      face(world, u.uPlanetDir.value);
      world.update(1 / 60, idle);
      assert(said.length === 1 && said[0] === 'THE PROMENADE', `said ${said}`);
      /* a deck with no glass onto the planet: nothing, even facing it */
      Save.passStationHours(24);
      st.deck = 48;
      world.update(1 / 60, idle);
      assert(said.length === 1, `deck 48 said ${said}`);
      assert(PW.stepPlanetLook(world, st) === null, 'deck 48 said it');
      return 'promenade heading; deck 48 silent';
    } finally { world.dispose?.(); }
  }));

  /* ════════════════════════════════════════════════════════════════════════
   *  NOTHING ROLLS
   * ════════════════════════════════════════════════════════════════════════ */

  check('planetweather: no Math.random in PlanetWeather.js, the hook lines, or the sky\'s weather branch', async () => {
    const pw = await readFile(new URL('../../src/game/PlanetWeather.js', import.meta.url), 'utf8');
    assert(!/Math\.random/.test(pw), 'Math.random in PlanetWeather.js');
    const sky = await readFile(new URL('../../src/engine/SkyDome.js', import.meta.url), 'utf8');
    const { functionBody } = await import('./_source.mjs');
    const branch = functionBody(sky, 'if (uWeather > 0.5');
    assert(!/Math\.random|uTime/.test(branch), 'the weather branch reads a clock that is not uOrbitT');
    for (const f of ['StationEvents.js', 'Station.js', 'Hangar.js']) {
      const s = await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8');
      assert(s.includes('weatherUniforms(') || s.includes('stepPlanetLook('), `${f} has no hook line`);
    }
    return 'seeded off (day, theatre) and uOrbitT only; three hook lines present';
  });
}
