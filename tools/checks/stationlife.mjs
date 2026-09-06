/**
 * THE STATION'S LIFE — the people, the tram, and §3.4's ten events.
 *
 * `SHARK.md` §5.3 names this file and lists what it must hold:
 *
 *   *"`stationlife.mjs`: every place's job table non-empty at its busy hour;
 *    routes walk end to end; the tram carries; events fire on the clock; step
 *    ≤ a wave's."*
 *
 * IT DID NOT EXIST. `station.mjs` was the only station suite and has no clause
 * for any of those five — and the one that mattered most was the event table:
 * §3.4's ten rows had, between them, ONE effect on the world, and that effect
 * was `world.notify`. `life.event` was written and read nowhere; `life.dip`
 * was written, decayed and read nowhere, so *"REACTOR SURGE — the lights dip
 * across the drum"* dipped no light in any file; `headcount` took no event, so
 * *"MARKET DAY — the Concourse is at its fullest"* left the Concourse at the
 * headcount it holds on any other day. Every gate in the tree was green.
 *
 * The clause that would have caught it is the fourth one below, and it is
 * deliberately not a list of field names: it READS `stepEvents` out of the
 * source, takes every field the function assigns, and asks whether anything in
 * `src/` ever reads it on a line that does not also write it. A row that grows
 * a new field tomorrow is held to the same bar without anybody editing this
 * file, which is the only kind of clause that survives contact with a table.
 */

import { readdir, readFile } from 'node:fs/promises';

/* No `fetch` in node — the rooms come off disk through the decoder the browser
 * uses. Same helper `station.mjs` and `flightops.mjs` carry. */
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/**
 * The station, booted through the door the game uses.
 *
 * `quality: 'high'` for the same reason `station.mjs` says so: §12.3 scales the
 * live pool 30/45/60/60 and a clause that counts BODIES on `bootWorld`'s `low`
 * default is measuring the smallest station the game ships.
 */
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

/** Every `.js` under `src/`. */
async function sources(dir = new URL('../../src/', import.meta.url), out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) await sources(u, out);
    else if (e.name.endsWith('.js')) out.push(u);
  }
  return out;
}

/** Source with its comments taken out, so a field NAMED in a comment is not
 *  mistaken for a field somebody reads. Line comments are left alone on a line
 *  carrying `://`, which is a URL and not a comment. */
function decomment(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => (l.includes('://') ? l : l.replace(/\/\/.*$/, ''))).join('\n');
}

/** The text of a top-level `function NAME(...) { ... }`, brace-matched. */
function bodyOf(src, name) {
  const at = src.indexOf(`\nfunction ${name}(`);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const L = await import('../../src/game/StationLife.js');
  const P = await import('../../src/game/StationPlan.js');

  /* ════════════════════════════════════════════════════════════════════════
   *  §5.3 — "every place's job table non-empty at its busy hour"
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: every place holds somebody with a job at its own busy hour', () => {
    const empty = [], jobless = [];
    for (const p of P.PLACES) {
      if (p.external || !p.heads) continue;
      const hour = p.peak ?? 13;
      const n = L.headcount(p, hour, null);
      if (n < 1) { empty.push(`#${p.id} ${p.name}`); continue; }
      for (let i = 0; i < n; i++) {
        const r = L.occupant(p, i, { day: 0 });
        if (!r || !(r.role || r.borz?.job) || !r.name) jobless.push(`#${p.id}:${i}`);
      }
    }
    assert(!empty.length, `${empty.length} places are empty at their own busy hour: ${empty.slice(0, 6).join(', ')}`);
    assert(!jobless.length, `${jobless.length} residents stand in a room with no job: ${jobless.slice(0, 6).join(', ')}`);
    const heads = P.PLACES.filter((p) => !p.external && p.heads)
      .reduce((a, p) => a + L.headcount(p, p.peak ?? 13, null), 0);
    return `${heads} people over ${P.PLACES.filter((p) => !p.external && p.heads).length} places, each at its own peak, every one with a name and a role`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §3.4 — NOTHING `stepEvents` WRITES IS A FIELD NOTHING READS
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: no field the event table writes is a field nothing reads', async () => {
    /**
     * ── HOW A "READER" IS DECIDED, AND WHY IT IS NOT A LIST ──────────────
     *
     * The fields are taken out of `stepEvents` itself — every `life.X` it
     * assigns — so a row that grows a field tomorrow is held to this bar with
     * no edit here. A reader is an occurrence of `.X` on a line that does NOT
     * also assign `.X`, in `StationLife.js` or in a file that imports it.
     *
     * THE SAME-LINE RULE IS THE WHOLE POINT. `if (life.dip > 0) life.dip =
     * Math.max(0, life.dip - dt * 0.6)` is the line the old code decayed the
     * surge on, and it reads `life.dip` twice — but it is the field's own
     * bookkeeping and not a reader: nothing in the game was any different for
     * the number being 1.4 rather than 0. Counting it would have made this
     * clause green over a station whose lights did not dip.
     *
     * Comments are stripped first, because this file and that one both NAME
     * these fields in prose and a clause that reads its own documentation is
     * not a clause.
     */
    const url = new URL('../../src/game/StationLife.js', import.meta.url);
    const raw = decomment(await readFile(url, 'utf8'));
    const body = bodyOf(raw, 'stepEvents');
    assert(body, 'stepEvents is no longer a top-level function in StationLife.js');

    const written = [...new Set([...body.matchAll(/\blife\.([A-Za-z_$][\w$]*)\s*(?:=[^=>]|\+=|-=|\*=|\/=)/g)].map((m) => m[1]))];
    assert(written.length >= 2, `stepEvents assigns ${written.length} fields — the scan found nothing to hold`);

    /* StationLife.js and everything that imports it. Nothing else can be
     * holding a `life` that is this file's `life`. */
    const files = [];
    for (const u of await sources()) {
      const src = await readFile(u, 'utf8');
      if (u.href === url.href || src.includes("StationLife.js'")) files.push({ u, src: decomment(src) });
    }
    assert(files.length > 1, 'no file imports StationLife.js, so the scan is only one file wide');

    const orphans = [], where = [];
    for (const f of written) {
      const reads = new RegExp(`\\.${f}\\b`);
      const writes = new RegExp(`\\.${f}\\s*(?:=[^=>]|\\+=|-=|\\*=|\\/=)`);
      let found = null;
      for (const { u, src } of files) {
        const lines = src.split('\n');
        for (let i = 0; i < lines.length && !found; i++) {
          if (!reads.test(lines[i]) || writes.test(lines[i])) continue;
          found = `${u.pathname.split('/').pop()}:${i + 1}`;
        }
        if (found) break;
      }
      if (!found) orphans.push(f); else where.push(`${f}→${found}`);
    }
    assert(!orphans.length,
      `§3.4 writes ${orphans.map((f) => `life.${f}`).join(', ')} and nothing in src/ ever reads ${orphans.length === 1 ? 'it' : 'them'} — `
      + 'a row that sets a field with no reader is a banner, not an event');
    return `${written.length} fields written by stepEvents, every one read: ${where.join(', ')}`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §3.4 — THE TABLE IS EFFECTS, NOT PROSE
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: every row of the event table declares an effect, and headcount pays it', () => {
    const idle = [];
    for (const e of L.EVENTS) {
      assert(e.say?.length === 2 && e.say[1], `${e.id} has no banner`);
      assert(e.mins > 0, `${e.id} runs for no time at all`);
      const has = e.fill || e.stir || e.dim || e.halt;
      if (!has) idle.push(e.id);
      /* Every place a row names is a place. */
      for (const k of Object.keys(e.fill || {})) {
        assert(P.PLACE.get(Number(k)), `${e.id} fills #${k}, which is not in the gazetteer`);
      }
      for (const k of (Array.isArray(e.stirIn) ? e.stirIn : [])) {
        assert(P.PLACE.get(k), `${e.id} stirs #${k}, which is not in the gazetteer`);
      }
      if (e.stir) assert(e.stirIn, `${e.id} moves ${e.stir} people out of nowhere in particular`);
    }
    assert(!idle.length,
      `${idle.join(', ')} ${idle.length === 1 ? 'is' : 'are'} a banner and nothing else — §3.4 asks for `
      + 'something a player can go and look at');

    /* And the fill is the number the row says, at any hour, past the curve. */
    const bad = [];
    for (const e of L.EVENTS) {
      for (const [k, n] of Object.entries(e.fill || {})) {
        const p = P.PLACE.get(Number(k));
        for (const h of [0, 4, 8, 12, 16, 20]) {
          const d = L.headcount(p, h, e) - L.headcount(p, h, null);
          if (d !== n) bad.push(`${e.id} #${k} at ${h}:00 adds ${d}, not ${n}`);
        }
      }
    }
    assert(!bad.length, bad.slice(0, 4).join('; '));
    const rows = L.EVENTS.map((e) => `${e.id}${e.fill ? '+' + Object.values(e.fill).reduce((a, b) => a + b, 0) : ''}${e.stir ? '/' + e.stir + ' walk' : ''}${e.dim ? '/dim' : ''}${e.halt ? '/halt' : ''}`);
    return rows.join(', ');
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §5.3 — "events fire on the clock"
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: every row fires in the hour it names, at the gap the table declares', async () => {
    /**
     * THREE STATION DAYS, DRIVEN THROUGH THE REAL SCHEDULER.
     *
     * `tickStationClock` is the clock the game runs and `stepStationLife`
     * holds `stepEvents`; a day is 2880 real seconds, so this drives those two
     * rather than the whole frame — `world.update` would be half a million
     * physics steps to watch a table of ten rows, and the two functions this
     * calls are the two the shipped frame calls in the same order.
     */
    const { world } = await station(40);
    try {
      const { tickStationClock } = await import('../../src/game/Station.js');
      const { stepStationLife } = await import('../../src/game/StationLife.js');
      const st = world._station, life = world._stationLife;
      st.hour = 0;
      const fired = [];
      let was = null, ended = 0, t = 0;
      const DT = 0.25, DAYS = 3;
      for (let i = 0; i < (24 * 120 * DAYS) / DT; i++) {
        tickStationClock(world, DT);
        stepStationLife(world, DT);
        t += DT;
        const now = life.event;
        if (now && now !== was) fired.push({ id: now.id, hour: Math.floor(st.hour), gap: t - ended });
        if (!now && was) ended = t;
        assert(!(now && was && now !== was), `${was?.id} was still running when ${now?.id} started`);
        was = now;
      }
      const seen = new Set(fired.map((f) => f.id));
      const missing = L.EVENTS.filter((e) => !seen.has(e.id)).map((e) => e.id);
      assert(!missing.length, `${missing.join(', ')} never fired in ${DAYS} station days`);

      /* ON THE CLOCK: a row with an hour fires IN it and nowhere else. */
      const offClock = fired.filter((f) => {
        const e = L.EVENTS.find((x) => x.id === f.id);
        return e.at !== null && f.hour !== e.at;
      });
      assert(!offClock.length,
        `${offClock.length} firings were off the clock, e.g. ${offClock[0]?.id} at ${offClock[0]?.hour}:00`);

      /* AT THE RATE: the gap between one event ending and the next beginning
       * is the table's own `EVENT_GAP`, within a step of it. */
      const gaps = fired.slice(1).map((f) => f.gap);
      const lo = Math.min(...gaps), hi = Math.max(...gaps);
      assert(lo >= L.EVENT_GAP.min - DT - 1e-9,
        `an event followed the last by ${lo.toFixed(1)} s against the table's ${L.EVENT_GAP.min}`);
      assert(hi <= L.EVENT_GAP.min + L.EVENT_GAP.span + DT + 1e-9,
        `an event followed the last by ${hi.toFixed(1)} s against the table's ${L.EVENT_GAP.min + L.EVENT_GAP.span}`);
      return `${fired.length} firings over ${DAYS} station days, all ten rows seen, every timed row in its own hour, gaps ${lo.toFixed(0)}–${hi.toFixed(0)} s against ${L.EVENT_GAP.min}–${L.EVENT_GAP.min + L.EVENT_GAP.span}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §3.4 — EVERY ROW MOVES SOMETHING WHILE IT RUNS, AND STOPS
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: every row changes something measured while it runs, and stops when it ends', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const st = world._station, life = world._stationLife;
      step(world, 10, idle);
      assert(life.live.size > 8, `only ${life.live.size} bodies in the pool; the driven clauses need a station`);
      assert(st.rig, 'the deck published no light rig, so nothing can dip it');

      const TIMED = new Set(L.EVENTS.filter((e) => e.at !== null).map((e) => e.at));
      const OPEN = [...Array(24).keys()].filter((h) => !TIMED.has(h));
      /** Fire one named row through the real `stepEvents`. */
      const fire = (id) => {
        const e = L.EVENTS.find((x) => x.id === id);
        const hours = e.at !== null ? [e.at] : OPEN;
        for (let pass = 0; pass < 40; pass++) {
          for (const h of hours) {
            life.event = null; life.eventFor = 0; life.dip = 0; life.eventIn = 0;
            st.hour = h + 0.5;
            world.update(1 / 60, idle);
            if (life.event?.id === id) return true;
            if (life.event) { life.event = null; life.eventFor = 0; life.dip = 0; }
          }
          life.spawned++;
        }
        return false;
      };
      const stirred = () => [...life.live.values()].filter((b) => b.stationStir).length;
      const tramAt = () => life.tram.at * 1000 + life.tram.t;

      const said = [];
      for (const e of L.EVENTS) {
        life.event = null; life.eventFor = 0; life.dip = 0;
        step(world, 2, idle);
        assert(fire(e.id), `${e.id} could not be made to fire through stepEvents`);
        /* ONE FACT IN ONE PLACE. `life.event` is an accessor onto the module's
         * own running row — the same shape `life.standing` has — and it is
         * what `headcount` defaults to; two copies is how the two `standing`s
         * got out of step in the first place. */
        const hour = st.hour;
        const t0 = tramAt();
        step(world, 3, idle);
        const notes = [];

        /* FILL — the room holds the people the row says, and only while it does. */
        for (const [k, n] of Object.entries(e.fill || {})) {
          const p = P.PLACE.get(Number(k));
          const on = L.headcount(p, hour);
          assert(on === L.headcount(p, hour, null) + n,
            `${e.id}: #${k} holds ${on} while it runs, not ${L.headcount(p, hour, null) + n}`);
          notes.push(`#${k} ${L.headcount(p, hour, null)}→${on}`);
        }
        /* STIR — people who were standing are on a route, all of them. Only
         * the rows that move THIS deck are asked here: a row that empties one
         * named room can only be seen by somebody standing in it, and that is
         * the clause below, which goes to each of those rooms in turn. */
        if (e.stir && e.stirIn === 'deck') {
          const moved = [...life.live.values()].filter((b) => b.stationStir);
          assert(moved.length > 0, `${e.id} says ${e.stir} people get up and nobody did`);
          for (const b of moved) {
            assert(b.wayR > 0, `${e.id}: a body it moved is not on the ring`);
            assert(b.wayLegs || b.wayDwell > 0, `${e.id}: a body it moved has no route`);
          }
          notes.push(`${moved.length} walking`);
        }
        /* DIM — the deck's own key light is down. */
        if (e.dim) {
          assert(st.rig.key.intensity < st.rig.base[0] * 0.9,
            `${e.id}: the key light is ${st.rig.key.intensity.toFixed(2)} of ${st.rig.base[0]} — nothing dipped`);
          assert(st.mats.strip.emissiveIntensity < st.mats.strip.userData.dip0,
            `${e.id}: the strip lights did not dip`);
          notes.push(`key ${st.rig.base[0]}→${st.rig.key.intensity.toFixed(2)}`);
        }
        /* HALT — the car runs clear of the platform it last left and stands. */
        if (e.halt) {
          step(world, 9, idle);
          assert(life.tram.faulted, `${e.id}: the tram does not know it is faulted`);
          const a = tramAt();
          step(world, 4, idle);
          assert(tramAt() === a, `${e.id}: the tram moved ${(tramAt() - a).toFixed(1)} while the loop was down`);
          notes.push('tram stopped');
        } else if (e.halt === undefined) {
          assert(tramAt() !== t0, 'the tram is not running at all, so a fault would prove nothing');
        }

        /* ── AND IT STOPS. The row is wound out through its own countdown. ── */
        life.eventFor = 0.01;
        step(world, 3, idle);
        assert(!life.event, `${e.id} did not end when its ${e.mins} minutes ran out`);
        for (const [k, n] of Object.entries(e.fill || {})) {
          const p = P.PLACE.get(Number(k));
          assert(L.headcount(p, hour) === L.headcount(p, hour, null),
            `${e.id}: #${k} is still ${n} over the gazetteer after it ended`);
        }
        if (e.stir && e.stirIn === 'deck') {
          assert(stirred() === 0, `${e.id}: ${stirred()} people are still walking it off after it ended`);
        }
        if (e.dim) {
          assert(Math.abs(st.rig.key.intensity - st.rig.base[0]) < 1e-6,
            `${e.id}: the key light came back at ${st.rig.key.intensity} of ${st.rig.base[0]}`);
          assert(Math.abs(st.mats.strip.emissiveIntensity - st.mats.strip.userData.dip0) < 1e-6,
            `${e.id}: the strip lights came back dim`);
        }
        if (e.halt) {
          const a = tramAt();
          step(world, 2, idle);
          assert(tramAt() !== a, `${e.id}: the tram never started again`);
          assert(!life.tram.faulted, `${e.id}: the tram is still flagged faulted`);
        }
        said.push(`${e.id}: ${notes.join(', ')}`);
      }
      return said.join(' | ');
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §3.4 — THE ROWS THAT EMPTY ONE ROOM, MEASURED IN THAT ROOM
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: a row that says one room gets up empties that room into the corridor', async () => {
    /**
     * THE POOL IS ROUND THE PLAYER (§11: a resident within ~40 m is a real
     * body), so a row that moves the people in the Medbay can only be measured
     * by somebody standing in the Medbay. This walks to each of those rooms in
     * turn, on the deck it is actually on — the Medbay is #43 on deck 48, the
     * Cantina #14 on deck 40, the Drazi quarter #35 on deck 44 — because a
     * body only ever walks the deck it is standing on, and a check that fired
     * all three from one lift lobby would be measuring an empty room three
     * times.
     *
     * THE LAUNCH CYCLE IS NOT IN THIS LIST and the table says why: nobody
     * walks on decks 12 or 32 at all, so that row promises a fill and no
     * movement. If the flight decks ever grow routes, giving the row a `stir`
     * is what brings it in here — no edit to this clause.
     */
    const rows = L.EVENTS.filter((e) => e.stir && Array.isArray(e.stirIn));
    assert(rows.length, 'no row in the table names a room whose people get up');
    const TIMED = new Set(L.EVENTS.filter((x) => x.at !== null).map((x) => x.at));
    /* An hourless row can only be drawn in an hour no timed row owns — the
     * scheduler prefers the clock, exactly as §3.4 asks it to. */
    const hourFor = (e, room) => {
      if (e.at !== null) return e.at;
      let h = room.peak ?? 13;
      for (let i = 0; i < 24 && TIMED.has(h); i++) h = (h + 1) % 24;
      return h;
    };
    const said = [];
    for (const e of rows) {
      const room = P.PLACE.get(e.stirIn[0]);
      const HOUR = hourFor(e, room);
      const { world, idle } = await station(room.deck);
      try {
        const { run: step } = await import('./_coop.mjs');
        const st = world._station, life = world._stationLife;
        /* Stand in the doorway, and let the pool come to it. */
        world.player.position.set(room.door[0], P.floorOf(room) + 1, room.door[1]);
        st.hour = HOUR;
        step(world, 16, idle);
        const inRoom = [...life.live.values()].filter((b) => e.stirIn.includes(b.stationPlace));
        assert(inRoom.length > 0,
          `${e.id}: nobody is live in #${e.stirIn.join('/')} to get up — the pool never reached the room`);
        const standing = inRoom.filter((b) => !b.wayR).length;

        life.event = null; life.eventFor = 0; life.eventIn = 0;
        world.update(1 / 60, idle);
        /* The scheduler may pick another row for this hour; wind it until it
         * picks this one, the same way the clause above does. */
        for (let i = 0; i < 200 && life.event?.id !== e.id; i++) {
          /* A WRONG ROW IS WOUND OUT, NOT DROPPED. Clearing `life.event` by
           * hand skips `calm`, and a `'deck'` row that fired first (the tram
           * fault, on 48) would leave its ten walkers flagged `stationStir` —
           * which this clause then reads as people the named row moved out of
           * a corridor it never named. */
          if (life.event) { life.eventFor = 0.01; world.update(1 / 60, idle); }
          life.event = null; life.eventFor = 0; life.eventIn = 0; life.spawned++;
          st.hour = HOUR + 0.5;
          world.update(1 / 60, idle);
        }
        assert(life.event?.id === e.id, `${e.id} would not fire at ${st.hour.toFixed(1)}:00`);
        step(world, 2, idle);
        const moved = [...life.live.values()].filter((b) => b.stationStir);
        assert(moved.length > 0,
          `${e.id}: ${standing} people were standing in #${e.stirIn.join('/')} and none of them got up`);
        for (const b of moved) {
          assert(e.stirIn.includes(b.stationPlace),
            `${e.id} moved somebody out of #${b.stationPlace}, which it does not name`);
          assert(b.wayLegs || b.wayDwell > 0, `${e.id}: a body it moved has no route`);
        }
        /* AND THEY WALK IT: a route that is planned and never travelled is the
         * defect `stepWalkers` was rewritten for. */
        const at0 = moved.map((b) => [b.position.x, b.position.z]);
        step(world, 6, idle);
        const far = Math.max(...moved.map((b, i) => Math.hypot(b.position.x - at0[i][0], b.position.z - at0[i][1])));
        assert(far > 1.5, `${e.id}: the people it moved travelled ${far.toFixed(2)} m in 6 s`);

        life.eventFor = 0.01;
        step(world, 2, idle);
        const still = [...life.live.values()].filter((b) => b.stationStir).length;
        assert(!life.event, `${e.id} did not end`);
        assert(still === 0, `${e.id}: ${still} people are still walking it off after it ended`);
        said.push(`${e.id} on deck ${room.deck}: ${standing} standing in ${room.name} → ${moved.length} walked ${far.toFixed(0)} m, 0 left after`);
      } finally { world.dispose?.(); }
    }
    return said.join(' | ');
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §5.3 — "the tram carries" and "routes walk end to end"
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: the tram carries — four stops, and a leg is the time the plan says', async () => {
    const { world, idle } = await station(44);
    try {
      const { run: step } = await import('./_coop.mjs');
      const life = world._stationLife;
      assert(L.STOPS.length === 4, `${L.STOPS.length} stops; §3.2 #40 and its three make four`);
      for (const id of L.STOPS) assert(P.PLACE.get(id)?.stop, `#${id} is not a tram platform`);
      assert(life.tram.car, 'deck 44 dressed no car, so nothing runs the guideway');

      /* §3.2: "trams every 90 s" round four stops — a leg is a quarter of it. */
      const per = /every\s+(\d+)\s*s/i.exec(P.PLACE.get(40).idle || P.PLACE.get(40).who || '');
      const at0 = life.tram.at;
      const p0 = life.tram.car.position.clone();
      step(world, 12, idle);
      assert(!life.tram.car.position.equals(p0), 'the car did not move down the guideway');
      /* Twelve seconds is half a leg and no more: the stop must not have
       * turned over twice while a check was watching. */
      const moved = (life.tram.at - at0 + 4) % 4;
      assert(moved <= 1, `the car passed ${moved} stops in 12 s; a leg is 22.5 s`);
      step(world, 26, idle);
      assert((life.tram.at - at0 + 4) % 4 >= 1, 'the car has not reached the next stop in 38 s');
      return `four platforms${per ? `, §3.2 #40 says every ${per[1]} s` : ''}, car at stop ${life.tram.at} after 38 s`;
    } finally { world.dispose?.(); }
  });

  check('stationlife: routes walk end to end — a walker arrives somewhere', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const life = world._stationLife;
      step(world, 12, idle);
      const walkers = [...life.live.values()].filter((b) => b.wayR);
      assert(walkers.length > 2, `${walkers.length} people on the open stretches; §2.5 wants the between-space busy`);
      const legs = walkers.filter((b) => b.wayLegs?.length).length;
      assert(legs > 0, 'nobody on an open stretch has a route');
      step(world, 45, idle);
      const trips = [...life.live.values()].reduce((a, b) => a + (b.wayTrips | 0), 0);
      assert(trips > 0, 'no walker reached a destination in 57 s — a route that never ends is a pace, not a walk');
      return `${walkers.length} walkers, ${legs} on a planned route, ${trips} arrivals in 57 s`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  V18 — EVENTS THAT ARE SEEN, NOT ANNOUNCED
   * ════════════════════════════════════════════════════════════════════════ */

  /** Wind the clock to `HOUR` until the scheduler picks row `id`; a wrong row
   *  is wound out through its own countdown so `calm` puts its people back. */
  const fireRow = (world, idle, life, st, id, HOUR) => {
    for (let i = 0; i < 200; i++) {
      if (life.event) { life.eventFor = 0.01; world.update(1 / 60, idle); }
      life.event = null; life.eventFor = 0; life.eventIn = 0; life.dip = 0; life.spawned++;
      st.hour = HOUR + 0.5;
      world.update(1 / 60, idle);
      if (life.event?.id === id) return true;
    }
    return false;
  };
  /** Is `x,z` inside a place's footprint (yaw included)? */
  const inRoom = (p, x, z) => {
    const dx = x - p.x, dz = z - p.z;
    const c = Math.cos(-p.yaw), sn = Math.sin(-p.yaw);
    const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    return Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2;
  };
  const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const TIMED_HOURS = new Set(L.EVENTS.filter((x) => x.at !== null).map((x) => x.at));
  const openHour = (from) => { let h = from; for (let i = 0; i < 24 && TIMED_HOURS.has(h); i++) h = (h + 1) % 24; return h; };

  check('stationlife: market day — the Concourse, the Narn quarter, every platform and every desk hold double heads', () => {
    const e = L.EVENTS.find((x) => x.id === 'market');
    assert(e, 'no market row');
    const ids = [9, 32, 40, 40.2, 40.3, 40.4, ...P.PLACES.filter((p) => p.kiosk && p.heads).map((p) => p.id)];
    const said = [];
    for (const id of ids) {
      const p = P.PLACE.get(id);
      assert(p, `#${id} is not in the gazetteer`);
      const plain = L.headcount(p, p.peak ?? 13, null), on = L.headcount(p, p.peak ?? 13, e);
      assert(on - plain === p.heads, `#${id} ${p.name}: market day adds ${on - plain}, not its ${p.heads} heads`);
      assert(on >= 2 * p.heads, `#${id} ${p.name}: ${plain} → ${on} on market day is under twice its ${p.heads} heads`);
      said.push(`#${id} ${plain}→${on}`);
    }
    return `${ids.length} places at their own peak: ${said.join(', ')}`;
  });

  check('stationlife: the weather below is one word a day, the same all day and not the same every day', async () => {
    const E = await import('../../src/game/StationEvents.js');
    const words = new Set(E.WEATHER.map((w) => w.word));
    const seen = new Set();
    for (let d = 0; d < 8; d++) {
      const a = E.weatherAt(d, 'Kessel'), b = E.weatherAt(d, 'Kessel');
      assert(a.word === b.word && a.value === b.value, `day ${d} answered twice differently: ${a.line} / ${b.line}`);
      assert(words.has(a.word), `day ${d}: '${a.word}' is not a weather word`);
      assert(Number.isFinite(a.value), `day ${d}: value ${a.value}`);
      seen.add(a.word);
    }
    assert(seen.size >= 2, `eight days of Kessel were all '${[...seen][0]}'`);
    const other = [...Array(8).keys()].some((d) => E.weatherAt(d, 'Kessel').line !== E.weatherAt(d, 'Hoth').line);
    assert(other, 'two theatres had the same eight days of weather');
    return `8 days over Kessel: ${[...Array(8).keys()].map((d) => E.weatherAt(d, 'Kessel').line).join(' | ')}`;
  });

  check('stationlife: a blackout — near-black, everybody stops and turns to the void, two lamps walk the ring, and it comes back', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const E = await import('../../src/game/StationEvents.js');
      const st = world._station, life = world._stationLife;
      step(world, 10, idle);
      assert(st.rig, 'no light rig');
      assert(st.weather?.word && st.weather.line === E.weatherAt(st.day | 0, st.theatre).line,
        `st.weather is ${JSON.stringify(st.weather)} against weatherAt(${st.day | 0}, ${st.theatre})`);
      const e = L.EVENTS.find((x) => x.id === 'surge');
      assert(e?.black > 0, 'the surge row declares no blackout');
      assert(fireRow(world, idle, life, st, 'surge', openHour(3)), 'the surge would not fire');
      step(world, 3, idle);
      const base = st.rig.base[0];
      assert(st.rig.key.intensity < base * 0.02, `key light at ${st.rig.key.intensity.toFixed(3)} of ${base} — not near-black`);
      assert(st.rig.amb.intensity < st.rig.base[1] * 0.1, `ambient at ${st.rig.amb.intensity.toFixed(3)} of ${st.rig.base[1]} — the floor did not drop`);
      /* THE LAMPS: two guards on the ring, a lit slab in hand, walking. */
      const lamps = life.ev?.lamps || [];
      assert(lamps.length === 2, `${lamps.length} lamps on the ring, not 2`);
      for (const Lp of lamps) {
        assert(life.live.get(Lp.key) === Lp.body, `${Lp.key} is not in the pool`);
        const r = Math.hypot(Lp.body.position.x, Lp.body.position.z);
        assert(Math.abs(r - P.DRUM.ringR) < 2, `${Lp.key} is at r=${r.toFixed(1)}, not on the ring (${P.DRUM.ringR})`);
        assert(Lp.mesh.parent === world.scene, `${Lp.key}'s lamp is not in the scene`);
        assert(Math.abs(Lp.mesh.position.y - (Lp.body.position.y + 0.95)) < 0.05, `${Lp.key}'s lamp is at y=${Lp.mesh.position.y.toFixed(2)}, body ${Lp.body.position.y.toFixed(2)} — not hand height`);
        assert(Lp.mesh.material.emissive || Lp.mesh.material.isMeshBasicMaterial, `${Lp.key}'s lamp is not lit`);
        assert(Math.hypot(Lp.mesh.position.x - Lp.body.position.x, Lp.mesh.position.z - Lp.body.position.z) < 0.6, 'the lamp is not in hand');
      }
      const at0 = lamps.map((Lp) => [Lp.body.position.x, Lp.body.position.z]);
      /* EVERYBODY ELSE STOPS AND LOOKS AT THE VOID. */
      let stood = 0, held = 0, turned = 0;
      for (const b of life.live.values()) {
        if (!b?.position || b.wayMission || b.__stationTouched) continue;
        const toVoid = Math.atan2(-b.position.x, -b.position.z);
        if (b.wayR) { held++; assert(b.wayDwell > 0, 'a walker is still walking in the dark'); }
        else if (b.standX !== undefined) {
          stood++;
          assert(b.standTx === b.standCx && b.standTz === b.standCz, 'a stander still has a step to take in the dark');
          if (Math.abs(wrapPi(b.facing - toVoid)) < 0.08) turned++;
        }
      }
      assert(stood > 5, `${stood} standing bodies — not enough of a room to measure`);
      assert(turned >= stood * 0.8, `${turned} of ${stood} standers face the void`);
      step(world, 2, idle);
      const walked = lamps.map((Lp, i) => Math.hypot(Lp.body.position.x - at0[i][0], Lp.body.position.z - at0[i][1]));
      assert(walked.every((d) => d > 1.5), `the lamps walked ${walked.map((d) => d.toFixed(1)).join('/')} m in 2 s`);
      /* AND IT COMES BACK: the black runs out, the lamps go, the surge's own
       * brown-out is what is left, and the end of the row restores the rig. */
      step(world, e.black, idle);
      assert(!(life.ev.black > 0), 'the blackout is still on after its own seconds');
      assert(life.ev.lamps.length === 0, `${life.ev.lamps.length} lamps still out after the black`);
      assert(!life.live.has('lamp:0') && !life.live.has('lamp:1'), 'the watch is still on the ring');
      assert(st.rig.key.intensity > base * 0.3, `key light at ${st.rig.key.intensity.toFixed(2)} of ${base} after the black — never ramped back`);
      assert(Math.abs(st.rig.amb.intensity - st.rig.base[1]) < st.rig.base[1] * 0.75, 'the ambient floor did not come back up');
      life.eventFor = 0.01;
      step(world, 3, idle);
      assert(Math.abs(st.rig.key.intensity - base) < 1e-6, `key light came back at ${st.rig.key.intensity} of ${base}`);
      assert(Math.abs(st.rig.amb.intensity - st.rig.base[1]) < 1e-6, 'ambient came back wrong');
      return `key ${base}→0.00→${(base).toFixed(2)}, ${stood} stood and ${turned} faced the void, ${held} walkers held, 2 lamps walked ${walked.map((d) => d.toFixed(1)).join('/')} m, black ${e.black} s`;
    } finally { world.dispose?.(); }
  });

  check('stationlife: rain in the arboretum — 200 falling slabs inside #23 and people who walk there to stand in it', async () => {
    const room = P.PLACE.get(23);
    const e = L.EVENTS.find((x) => x.id === 'rain');
    assert(e?.rain && e.place === 23 && e.at !== null, 'no rain row on the Arboretum');
    const { world, idle } = await station(room.deck);
    try {
      const { run: step } = await import('./_coop.mjs');
      const st = world._station, life = world._stationLife;
      world.player.position.set(room.door[0], P.floorOf(room) + 1, room.door[1]);
      st.hour = e.at;
      step(world, 12, idle);
      assert(fireRow(world, idle, life, st, 'rain', e.at), 'the rain would not fire');
      const R = life.ev?.rain;
      assert(R?.mesh?.parent === world.scene, 'no rain sheet in the scene');
      assert(R.mesh.count === 200, `${R.mesh.count} slabs, not 200`);
      assert(Math.hypot(R.mesh.position.x - room.x, R.mesh.position.z - room.z) < 0.01, 'the sheet is not over the Arboretum');
      /* INSIDE THE WALLS, FALLING, RECYCLED. */
      const ys0 = Float32Array.from(R.ys);
      step(world, 1, idle);
      let moved = 0, out = 0;
      for (let i = 0; i < 200; i++) {
        if (R.ys[i] !== ys0[i]) moved++;
        if (R.ys[i] < 0 || R.ys[i] > R.H || Math.abs(R.xs[i]) > room.w / 2 || Math.abs(R.zs[i]) > room.d / 2) out++;
      }
      assert(moved === 200, `${moved} of 200 slabs moved in a second`);
      assert(out === 0, `${out} slabs are outside the room or the cut`);
      const wrapped = R.ys.reduce((n, y, i) => n + (y > ys0[i] ? 1 : 0), 0);
      assert(wrapped > 0, 'no slab reached the floor and went back to the top in a second');
      /* AND PEOPLE WALK THERE. */
      const keys = [...life.live.keys()].filter((k) => k.startsWith('rain:'));
      assert(keys.length >= 4 && keys.length <= 6, `${keys.length} people set out for the rain; the row says ${e.visit}`);
      const onRing = keys.filter((k) => life.live.get(k).wayR > 0 && life.live.get(k).wayLegs?.length).length;
      assert(onRing >= 4, `${onRing} of them are on a route`);
      step(world, 40, idle);
      const inside = keys.map((k) => life.live.get(k)).filter((b) => b?.position && inRoom(room, b.position.x, b.position.z));
      assert(inside.length >= 4, `${inside.length} of ${keys.length} are standing in the Arboretum after 40 s`);
      for (const b of inside) assert(!b.wayR && b.standX !== undefined, 'a visitor in the rain is still a walker');
      /* AND IT STOPS. */
      life.eventFor = 0.01;
      step(world, 2, idle);
      assert(!life.ev.rain && R.mesh.parent === null, 'the rain is still falling after the row ended');
      assert(![...life.live.keys()].some((k) => k.startsWith('rain:')), 'the visitors are still in the pool after the row ended');
      return `200 slabs over ${R.H} m, ${wrapped} recycled in 1 s; ${keys.length} set out, ${inside.length} standing inside #23 after 40 s`;
    } finally { world.dispose?.(); }
  });

  check('stationlife: a Drazi fight spills — two out onto the ring, shoving along it until the watch reaches them', async () => {
    const room = P.PLACE.get(35);
    const e = L.EVENTS.find((x) => x.id === 'drazifight');
    assert(e?.spill === 2, 'the Drazi row does not spill');
    const { world, idle } = await station(room.deck);
    try {
      const { run: step } = await import('./_coop.mjs');
      const st = world._station, life = world._stationLife;
      world.player.position.set(room.door[0], P.floorOf(room) + 1, room.door[1]);
      st.hour = e.at;
      step(world, 12, idle);
      assert(fireRow(world, idle, life, st, 'drazifight', e.at), 'the fight would not fire');
      step(world, 2, idle);
      const B = life.ev?.brawl;
      assert(B && B.keys.length === 2, `${B?.keys?.length ?? 0} Drazi came out`);
      const two = B.keys.map((k) => life.live.get(k));
      for (const b of two) {
        assert(b?.position, 'a brawler is not a body');
        assert(b.stationSpecies === 'drazi', `a brawler is ${b.stationSpecies}`);
        const r = Math.hypot(b.position.x, b.position.z);
        assert(Math.abs(r - P.DRUM.ringR) < 2.5, `a brawler is at r=${r.toFixed(1)}, not on the ring`);
        assert(!inRoom(room, b.position.x, b.position.z), 'a brawler is still inside the quarter');
      }
      const gap = Math.hypot(two[0].position.x - two[1].position.x, two[0].position.z - two[1].position.z);
      assert(gap < 2.5, `the two are ${gap.toFixed(1)} m apart — not a shoving match`);
      assert(!B.down, 'they stood down before the watch arrived');
      const a0 = B.a;
      step(world, 4, idle);
      const along = Math.abs(wrapPi(B.a - a0)) * P.DRUM.ringR;
      assert(along > 0.8, `the fight moved ${along.toFixed(2)} m along the ring in 4 s`);
      assert(B.guards.length === 2, `${B.guards.length} in the patrol`);
      step(world, 10, idle);
      assert(B.down, 'the watch never reached them');
      for (const g of B.guards) {
        const gb = life.live.get(g.key);
        assert(gb?.position, 'a guard is not a body');
        const d = Math.min(...two.map((b) => Math.hypot(b.position.x - gb.position.x, b.position.z - gb.position.z)));
        assert(d < 4, `a guard stood down ${d.toFixed(1)} m from the fight`);
      }
      life.eventFor = 0.01;
      step(world, 2, idle);
      assert(!life.ev.brawl, 'the brawl is still up after the row ended');
      assert(![...life.live.keys()].some((k) => k.startsWith('brawl')), 'the Drazi or the watch are still on the ring after the row ended');
      return `two Drazi ${gap.toFixed(1)} m apart on the ring outside #35, ${along.toFixed(1)} m along it in 4 s, stood down when the watch closed`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §12.2 — "step ≤ a wave's", WITH AN EVENT RUNNING
   * ════════════════════════════════════════════════════════════════════════ */

  check('stationlife: the step is inside §12.2\'s 2.5 ms with an event running', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const st = world._station, life = world._stationLife;
      step(world, 8, idle);
      const quiet = [];
      step(world, 4, idle, () => { quiet.push(life.stepMs); });
      /* The busiest row in the table: it fills two rooms, moves four people
       * and runs for two station hours. */
      life.event = null; life.eventFor = 0; life.eventIn = 0; st.hour = 10.5;
      world.update(1 / 60, idle);
      assert(life.event?.id === 'market', `the market did not fire at 10:00 (got ${life.event?.id})`);
      const busy = [];
      step(world, 6, idle, () => { busy.push(life.stepMs); });
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
      assert(mean(busy) <= 2.5, `the step averages ${mean(busy).toFixed(2)} ms with an event running, against §12.2's 2.5`);
      assert(p95(busy) <= 2.5, `the step is ${p95(busy).toFixed(2)} ms at p95 with an event running, against §12.2's 2.5`);
      return `quiet mean ${mean(quiet).toFixed(3)} ms / p95 ${p95(quiet).toFixed(3)}; market day mean ${mean(busy).toFixed(3)} ms / p95 ${p95(busy).toFixed(3)}; bound 2.5`;
    } finally { world.dispose?.(); }
  });
}
