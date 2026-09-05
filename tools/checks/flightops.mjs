/**
 * ══════════════════════════════════════════════════════════════════════════
 *  FLIGHT OPS — SHARK §7, measured (#2, #3, #4, #5, #6 and #55)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Five rooms and a level had been standing in the gazetteer with verbs on them
 * and nothing behind any of the verbs. What this suite is for is the two ways
 * that lane can look finished and not be:
 *
 *   A GATE THAT IS A FORMALITY. The cert is meant to make #2 and #4 matter.
 *     A cert one press satisfies would leave the tower and the pit exactly as
 *     decorative as they were, and every screenshot would look identical. So
 *     the ladder is DRIVEN and the rooms it forces you into are COUNTED.
 *
 *   A LAUNCH THAT IS A LOAD. V15 §1.5 — *"no loading screens"* — is the bar
 *     `station.mjs` already holds the lift to, and a launch is the obvious
 *     place to break it, because going outside looks like changing level. So
 *     the whole of §7's source is grepped for the loader and the sequence is
 *     driven frame by frame to prove the one swap it makes is a shader's.
 *
 * ── AND THE THIRD THING, WHICH IS THE HONEST ONE ──────────────────────────
 *
 * `Starfury.js` is a real 6-DOF Newtonian craft and it is NOT wired to any of
 * this. #55 is built as a PLACE — five named sights and a measured circuit
 * past all of them — and flown on a rail. That is stated here rather than
 * implied, and the check below measures the circuit rather than the flying,
 * because measuring the flying would mean there was some.
 */

import { readFile } from 'node:fs/promises';
import { PLACE, floorOf } from '../../src/game/StationPlan.js';
import { SHAPES, GANTRY_Y } from '../../src/game/StationKit.js';
import { stationMats } from '../../src/game/Station.js';
import { Kit } from '../../src/world/Props.js';
import * as F from '../../src/game/FlightOps.js';
import * as L from '../../src/game/Launch.js';
import * as O from '../../src/game/Outside.js';

const src = (f) => new URL(`../../src/game/${f}`, import.meta.url);
const read = (f) => readFile(src(f), 'utf8');
/** Comments are prose and may say anything; only code counts. `station.mjs`
 *  and `holodeck.mjs` strip the same way and for the same reason. */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const KEY = 'saber.progress.v1';

/** A fold the ladder has been walked with, for the checks downstream of it. */
function walkTheLadder() {
  let f = F.blankFlight();
  const rooms = new Set();
  /* #3, the ready room: the medical signs on its own. */
  let r = F.signCert(f, { hour: 12 });
  if (r.ok) { f = r.fold; rooms.add(3); }
  /* #4, the pit: three levels. */
  for (let i = 0; i < F.GANTRY_LEVELS; i++) { f = F.walkGantry(f, i, { day: 2, hour: 9 }).fold; rooms.add(4); }
  r = F.signCert(f, { hour: 12 });
  if (r.ok) { f = r.fold; rooms.add(3); }
  /* #2, the tower: read the board at an hour with traffic on it. */
  let readAt = null;
  for (let m = 0; m < 24 * 60 && readAt === null; m++) {
    if (F.traffic(2, m / 60).live > 0) readAt = m / 60;
  }
  f = { ...f, boards: f.boards + 1 };
  rooms.add(2);
  r = F.signCert(f, { hour: 12 });
  if (r.ok) { f = r.fold; rooms.add(3); }
  return { fold: f, rooms, readAt };
}

/* No `fetch` in node. The imported rooms are read off disk and handed to the
 * same decoder the browser uses — `station.mjs`'s shim, and its reason: the
 * check then measures the shipped path rather than a second copy of it. */
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** The station, booted through the same door the game uses — `station.mjs`'s
 *  own helper, copied rather than imported because that file exports a suite
 *  and not a fixture. */
async function station(deck) {
  const { bootWorld } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════
   *  #2 — THE BOARD
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: the tower board runs at the rate the gazetteer promises', () => {
    /**
     * §3.2 #7 Arrivals hall says *"20 movements an hour"* and §3.2 #8 Docking
     * throat says *"a shuttle every 6 min"*. Both numbers are READ OUT OF THE
     * TABLE here rather than typed, because a board that drifted from the row
     * promising it would be invisible — which is exactly the defect
     * `StationPlan.js`'s header is about.
     */
    const per = /(\d+)\s+movements an hour/i.exec(PLACE.get(7).who);
    assert(per, "§3.2 #7's `who` no longer states a movement rate");
    const throat = /every\s+(\d+)\s*min/i.exec(PLACE.get(8).idle);
    assert(throat, "§3.2 #8's `idle` no longer states the throat's interval");

    assert(F.MOVEMENTS_AN_HOUR === Number(per[1]),
      `the board runs at ${F.MOVEMENTS_AN_HOUR}/hr against §3.2 #7's ${per[1]}`);
    const gate = F.GATES.find((g) => g.id === 'THROAT');
    assert(gate.every === Number(throat[1]),
      `the throat runs every ${gate.every} min against §3.2 #8's ${throat[1]}`);

    /* And it is not just arithmetic: count what a day actually produces.
     * BY IDENTITY, not by summing windows — a movement on the boundary of two
     * hours is in both windows and the first version of this line read 552
     * against 480 for exactly that reason, which is the check catching itself
     * rather than the board. */
    const day = new Set();
    for (let h = 0; h < 24; h++) {
      for (const m of F.movementsIn(0, h + 0.5, { back: 0.5, fore: 0.5 })) {
        if (m.due >= 0 && m.due < 24) day.add(`${m.gate}:${m.n}`);
      }
    }
    const n = day.size;
    assert(Math.abs(n - 24 * F.MOVEMENTS_AN_HOUR) <= 3,
      `a station day produced ${n} distinct movements against ${24 * F.MOVEMENTS_AN_HOUR}`);
    /* Every gate is a place in the gazetteer. A fourth door would be §15's
     * "a place not in §3.2 is not built" with a shuttle coming out of it. */
    for (const g of F.GATES) assert(PLACE.get(g.place), `gate ${g.id} names place #${g.place}, which is not in §3.2`);
    return `${F.MOVEMENTS_AN_HOUR}/hr from §3.2 #7, throat every ${gate.every} min from #8, ${n} movements in a day over ${F.GATES.length} gates`;
  });

  check('flightops: the board is the station clock, and nobody can re-roll it', () => {
    /**
     * `Games.js`'s Drum makes the argument in full: *"a casino game a player
     * can re-roll is a save-scum; one that runs on a clock the player does not
     * own is a thing that happens to them."* A traffic board you could re-roll
     * by walking out of the tower and back in would be a random-number
     * generator with consoles in front of it.
     */
    let same = 0, rows = 0;
    for (let d = 0; d < 7; d++) {
      for (let m = 0; m < 24 * 60; m += 7) {
        const h = m / 60;
        const a = F.boardAt(d, h, { theatre: 'Geonosis' }).map(F.boardLine).join('|');
        const b = F.boardAt(d, h, { theatre: 'Geonosis' }).map(F.boardLine).join('|');
        assert(a === b, `two readings of the board at day ${d} ${h.toFixed(2)} differ`);
        same++; rows += a.split('|').length;
      }
    }
    /* AND IT MOVES. A board that is stable because it is constant would pass
     * the paragraph above and be furniture. */
    const morning = F.boardAt(3, 9).map(F.boardLine).join('|');
    const evening = F.boardAt(3, 19).map(F.boardLine).join('|');
    assert(morning !== evening, 'the board reads the same at 09:00 and 19:00 — it is not on a clock');

    /* How often the board is genuinely clear, which is what makes #3's deck
     * check a second trip rather than a formality. */
    let quiet = 0, n = 0;
    for (let d = 0; d < 7; d++) for (let m = 0; m < 24 * 60; m += 3) { n++; if (F.traffic(d, m / 60).live === 0) quiet++; }
    assert(quiet > 0, 'the board is never clear — the deck check can be signed at any hour');
    assert(quiet / n < 0.4, `the board is clear ${(100 * quiet / n).toFixed(0)}% of the time, which is a tower with no traffic`);
    return `${same} readings over a station week identical, ${(rows / same).toFixed(1)} rows each; clear ${(100 * quiet / n).toFixed(1)}% of ${n} minutes sampled`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  #3 — THE CERT, AND WHETHER IT IS A GATE
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: the cert is a gate, and it is three rooms wide', () => {
    /**
     * THE FAILURE THIS IS AGAINST: a cert that signs three times in a row in
     * the ready room. That satisfies "there is a cert", leaves #2 and #4 as
     * decorative as they were, and reads identically in a screenshot.
     */
    let f = F.blankFlight();
    assert(!F.certified(f), 'a fresh pilot is already certified');

    /* Press three times in the ready room and nothing else. */
    let signed = 0;
    for (let i = 0; i < 6; i++) { const r = F.signCert(f, { hour: 12 }); if (r.ok) { f = r.fold; signed++; } }
    assert(signed === 1,
      `${signed} of ${F.CERT.length} rungs signed without leaving #3 — the cert is a formality`);
    assert(!F.certified(f), 'certified without ever leaving the ready room');

    /* Now walk it properly and count the rooms it forced. */
    const walked = walkTheLadder();
    assert(F.certified(walked.fold), 'the full ladder does not certify');
    assert(walked.rooms.size === 3,
      `the ladder was walked through ${walked.rooms.size} rooms, not 3 — ${[...walked.rooms].join(', ')}`);
    /* And the rooms it forced are the ones §3.2 names on the rungs. */
    for (const c of F.CERT) assert(walked.rooms.has(c.room), `rung ${c.id} names room #${c.room} and the ladder never went there`);

    /* THE PIT IS NOT ONE PRESS EITHER: two of three levels is not a rating. */
    let g = F.blankFlight();
    g = F.signCert(g, { hour: 12 }).fold;
    for (let i = 0; i < F.GANTRY_LEVELS - 1; i++) g = F.walkGantry(g, i, { day: 1, hour: 9 }).fold;
    assert(!F.signCert(g, { hour: 12 }).ok, 'the type rating signed on two of three gantries');
    /* And walking the same level five times is still one level. */
    for (let i = 0; i < 5; i++) g = F.walkGantry(g, 0, { day: 1, hour: 9 }).fold;
    assert(!F.signCert(g, { hour: 12 }).ok, 'the type rating signed on one gantry walked five times');
    return `1 of ${F.CERT.length} rungs reachable from #3 alone; the full ladder crosses ${walked.rooms.size} rooms (#${[...walked.rooms].sort().join(', #')})`;
  });

  check('flightops: the ready room briefs, and nobody signs during a briefing', () => {
    /* §3.2 #3: "briefings before a launch cycle". A room with a rhythm rather
     * than a counter that is always open. */
    let refused = 0, open = 0;
    for (let m = 0; m < 24 * 60; m++) {
      const h = m / 60;
      (F.briefing(h).on ? (refused++, 0) : (open++, 0));
      const r = F.signCert(F.blankFlight(), { hour: h });
      assert(r.ok !== F.briefing(h).on, `signing at ${h.toFixed(2)} disagrees with the briefing board`);
    }
    const share = refused / (refused + open);
    assert(Math.abs(share - (F.CYCLES.length * F.BRIEF_MINUTES) / (24 * 60)) < 0.01,
      `the room briefs ${(100 * share).toFixed(1)}% of the day, which is not ${F.CYCLES.length} × ${F.BRIEF_MINUTES} min`);
    return `${F.CYCLES.length} cycles a day, ${F.BRIEF_MINUTES} min of briefing each — shut ${(100 * share).toFixed(1)}% of 1440 minutes`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  #4 — THE PIT, AND WHETHER ALL THREE LEVELS EXIST TO WALK
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: all three gantries are reachable on foot, measured off the geometry', () => {
    /**
     * THE DEFECT THIS CAUGHT. As first built the pit had three catwalks at
     * −5.4, −2.8 and −0.2 m off its floor, a kerb, and NO WAY DOWN: the top one
     * was a step off the floor and the other two were eight metres of air. The
     * verb *"walk the gantries"* reached one of three, and the type rating
     * built on it would have been unopenable.
     *
     * So this measures the actual colliders `StationKit.deeppit` emits, in the
     * strip of the pit the stair runs down, and asserts a walkable chain: no
     * step between consecutive surfaces taller than `STEP`, and a surface
     * within 250 mm of each of the three levels.
     */
    const STEP = 0.45;
    const p = PLACE.get(4);
    const M = stationMats(32);
    const kit = new Kit(1029);
    SHAPES.deeppit(kit, M, p, { sunk: [], trees: [] });
    /* The stair's own strip: `deeppit` runs it at x = −(w−8)/2 + 1.1. */
    const sx = -(p.w - 8) / 2 + 1.1;
    const tops = kit.boxes
      .filter((b) => Math.abs(b.c.x - sx) < 1.6 && b.c.y < 0.4 && b.c.y > -7)
      .map((b) => ({ y: b.c.y + b.he.y, z: b.c.z }))
      .sort((a, b) => b.y - a.y);
    assert(tops.length > 10, `only ${tops.length} surfaces in the stair's strip — there is no stair`);

    let worst = 0, worstAt = 0;
    for (let i = 1; i < tops.length; i++) {
      const d = tops[i - 1].y - tops[i].y;
      if (d > worst) { worst = d; worstAt = tops[i].y; }
    }
    assert(worst <= STEP, `a ${worst.toFixed(2)} m drop at y=${worstAt.toFixed(2)} in the pit's stair — that is a fall, not a step`);
    assert(tops[0].y >= -0.45, `the stair's top surface is at ${tops[0].y.toFixed(2)}, not at the pit's lip`);
    assert(tops[tops.length - 1].y <= GANTRY_Y[0] + 0.25,
      `the stair stops at ${tops[tops.length - 1].y.toFixed(2)} and the bottom gantry is at ${GANTRY_Y[0]}`);

    /* And each named level has something to stand on within 250 mm. */
    for (const y of GANTRY_Y) {
      const near = kit.boxes.reduce((a, b) => Math.min(a, Math.abs((b.c.y + b.he.y) - y)), Infinity);
      assert(near <= 0.25, `gantry level ${y} has no surface within 250 mm of it (nearest ${near.toFixed(2)})`);
    }
    /* The three levels are one table. A second copy is the defect the
     * gazetteer's header exists for. */
    assert(GANTRY_Y.length === F.GANTRY_LEVELS,
      `StationKit builds ${GANTRY_Y.length} gantries and FlightOps counts ${F.GANTRY_LEVELS}`);
    return `${tops.length} surfaces down the stair strip, worst step ${worst.toFixed(2)} m (bound ${STEP}); all ${GANTRY_Y.length} levels stood on`;
  });

  check('flightops: the pit rebuilds an airframe across the day, and everyone sees the same one', () => {
    const seen = new Set();
    for (let m = 0; m < 24 * 60; m += 5) seen.add(F.gantryStage(4, m / 60).id);
    assert(seen.size === F.STRIP.length,
      `${seen.size} of ${F.STRIP.length} stages of the strip are ever visible in a day`);
    /* Same hour, same aeroplane — twice, and on the tail number too. */
    const a = F.gantryStage(4, 13.2), b = F.gantryStage(4, 13.2);
    assert(a.id === b.id && a.tail === b.tail, 'two looks into the pit at the same hour see different work');
    assert(F.gantryStage(4, 13.2).tail !== F.gantryStage(5, 13.2).tail, 'the pit rebuilds the same airframe every day');
    return `${seen.size} stages across a day, stable within an hour, a new tail number each day`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  #6 — THE BELL
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: a bell is cracked before you throw it, and a soft throw says nothing', () => {
    /* The verb grades the BELL, not the throw. A verb whose outcome moved with
     * how hard you threw would be a strength meter with a foundry around it. */
    let cracked = 0, n = 0;
    for (let d = 0; d < 400; d++) for (let i = 0; i < F.BELL.count; i++) { n++; if (!F.bellSound(d, i)) cracked++; }
    const rate = cracked / n;
    assert(Math.abs(rate - F.BELL.cracked) < 0.05,
      `${(100 * rate).toFixed(1)}% of bells are cracked against a declared ${(100 * F.BELL.cracked).toFixed(0)}%`);

    /* The same bell, thrown at four speeds, gives one answer. */
    for (let d = 0; d < 40; d++) {
      for (let i = 0; i < F.BELL.count; i++) {
        const answers = new Set([6, 9, 14, 30].map((v) => F.ringBell(d, i, v).sound));
        assert(answers.size === 1, `bell ${i} on day ${d} answered differently at different speeds`);
      }
    }
    /* Under the threshold it is a nudge and reveals nothing. */
    let mute = 0;
    for (let v = 0; v < F.BELL.ring; v += 0.25) { mute++; assert(!F.ringBell(3, 0, v).heard, `a ${v} m/s nudge rang the bell`); }
    assert(F.ringBell(3, 0, F.BELL.ring).heard, 'a throw at the threshold did not ring');

    /* And a found bell is a spare; an untested one is not. */
    let f = F.blankFlight();
    assert(F.spares(f, 7) === 0, 'an untouched rack already has spares');
    let good = 0;
    for (let i = 0; i < F.BELL.count; i++) { const r = F.throwBell(f, i, 12, { day: 7 }); f = r.fold; if (r.sound) good++; }
    assert(F.spares(f, 7) === good, `${F.spares(f, 7)} spares recorded against ${good} sound bells thrown`);
    assert(F.spares(f, 8) === 0, "yesterday's spares are still on today's rack");
    return `${(100 * rate).toFixed(1)}% cracked over ${n} bells; ${mute} sub-threshold throws silent; verdict stable across 4 speeds × ${40 * F.BELL.count} bells`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  #5 — THE LAUNCH
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: the launch is a sequence with one swap in it, and it puts the bay back', () => {
    const seen = { say: [], outside: [], sortie: 0, done: [] };
    const last = { canopy: 0, lights: 0, rams: 0, shaft: 0, scroll: 0 };
    const sink = {
      say: (l) => seen.say.push(l),
      outside: (on) => seen.outside.push(on),
      sortie: () => { seen.sortie++; },
      done: (w) => seen.done.push(w),
      canopy: (k) => { last.canopy = k; }, lights: (k) => { last.lights = k; },
      rams: (k) => { last.rams = k; }, shaft: (k, m) => { last.shaft = k; last.scroll = m; },
    };
    const out = new L.Sortie('out', sink, { well: PLACE.get(5).h, at: 13.5 });
    const phases = [];
    let t = 0;
    while (!out.done && t < 60) {
      const p = out.step(1 / 60); t += 1 / 60;
      if (!phases.length || phases[phases.length - 1] !== p) phases.push(p);
    }
    assert(Math.abs(t - L.OUT_SECONDS) < 0.05, `the launch ran ${t.toFixed(2)} s against a schedule of ${L.OUT_SECONDS}`);
    assert(phases.join('>') === [...L.OUT.map((p) => p.id), 'done'].join('>'),
      `phases ran ${phases.join('>')}`);
    assert(seen.outside.length === 1 && seen.outside[0] === true,
      `the outside was swapped ${seen.outside.length} times on one launch`);
    assert(seen.sortie === 1, `${seen.sortie} movements filed for one launch`);
    /* THE FRAME IT SWAPS ON. It has to be inside the sequence and not on the
     * first or last phase — see the note in `Launch.js` about why. */
    const swapAt = L.OUT.findIndex((p) => p.id === 'mouth');
    assert(swapAt > 0 && swapAt < L.OUT.length - 1, 'the swap is on the first or last phase of the launch');
    /* And the bay is put back exactly: the lights are off, not 3% amber. */
    assert(last.lights === 0, `the bay was left at ${last.lights} amber`);
    assert(last.shaft === 1 && Math.abs(last.scroll - PLACE.get(5).h) < 0.01,
      'the well did not finish at the top of its own travel');

    /* And back. */
    const back = new L.Sortie('in', sink, { well: PLACE.get(5).h, at: 13.9 });
    let t2 = 0;
    seen.outside.length = 0;
    while (!back.done && t2 < 60) { back.step(1 / 60); t2 += 1 / 60; }
    assert(Math.abs(t2 - L.IN_SECONDS) < 0.05, `the recovery ran ${t2.toFixed(2)} s against ${L.IN_SECONDS}`);
    assert(seen.outside.length === 1 && seen.outside[0] === false, 'the recovery did not put the bay back in the window');
    assert(last.lights === 0 && last.canopy === 0 && last.shaft === 0, 'the bay was left mid-recovery');

    /* A teardown mid-sequence still lands. */
    const cut = new L.Sortie('out', sink, {});
    cut.step(0.5); cut.finish();
    assert(cut.done && cut.outside, 'an interrupted launch left the player in a well that is no longer there');
    return `out ${L.OUT_SECONDS.toFixed(1)} s over ${L.OUT.length} phases, in ${L.IN_SECONDS.toFixed(1)} s over ${L.IN.length}; one swap each, ${seen.say.length} calls, bay restored`;
  });

  check('flightops: the launch refuses for the right reasons and only those', () => {
    assert(!L.canLaunch({ cert: false }).ok, 'an uncertified pilot launched');
    assert(!L.canLaunch({ cert: true, flying: true }).ok, 'launched while already outside');
    assert(!L.canLaunch({ cert: true, busy: true }).ok, 'launched into a cycling bay');
    assert(!L.canLaunch({ cert: true, recovering: true }).ok, 'launched into a recovery');
    assert(L.canLaunch({ cert: true }).ok, 'a certified pilot on an idle bay was refused');
    /* The refusal a player actually sees names the rung and counts them. */
    const short = F.shortLine(F.blankFlight());
    assert(/0 of 3/.test(short) && /medical/i.test(short), `the refusal reads "${short}"`);
    assert(F.shortLine(walkTheLadder().fold) === null, 'a certified pilot is still told what is short');
    return `4 refusals, 1 pass; the short line reads "${short}"`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  #55 — THE OUTSIDE
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: #55 is five named sights and a circuit that passes all of them', () => {
    /**
     * §3.2 #55: *"from the Starfury: the hull, the drum, the flight deck's
     * mouth, the docking throat, the dome"*. Five, named in the table, so the
     * table is what they are read out of — a sixth sight or a missing one is a
     * §15 violation ("a place not in §3.2 is not built") and would otherwise
     * never be noticed, because nobody can count the things in a starfield.
     */
    const words = PLACE.get(55).look.toLowerCase();
    const ids = O.sights().map((s) => s.id);
    assert(ids.length === 5, `${ids.length} sights against §3.2 #55's five`);
    for (const key of ['hull', 'drum', 'mouth', 'throat', 'dome']) {
      assert(words.includes(key), `§3.2 #55 no longer names the ${key}`);
      assert(ids.includes(key), `the ${key} is in §3.2 #55 and not in Outside.sights()`);
    }

    const sv = O.survey(4000);
    assert(sv.tight >= O.CLEAR,
      `the circuit comes within ${sv.tight.toFixed(1)} m of the hull at u=${sv.tightAt.toFixed(3)}, against ${O.CLEAR}`);
    for (const [id, d] of sv.closest) {
      assert(d <= O.VIEW, `the circuit never gets closer than ${d.toFixed(0)} m to the ${id}, against ${O.VIEW}`);
    }
    /* It closes. A track that does not is a track with a jump in it. */
    const a = O.sample(0), b = O.sample(0.99999);
    assert(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.0, 'the circuit does not close');
    /* It starts where the launch leaves you. */
    assert(a.near === 'mouth', `the circuit starts nearest the ${a.near}, not the flight deck's mouth`);
    /* And every sight but the hull is the nearest thing at some point on it —
     * the hull is in frame the whole way and is excluded by construction. */
    const passed = [];
    for (let i = 0; i < 2000; i++) { const n = O.sample(i / 2000).near; if (passed[passed.length - 1] !== n) passed.push(n); }
    for (const id of ids) {
      if (id === 'hull') continue;
      assert(passed.includes(id), `the circuit never passes the ${id} — it passed ${passed.join(' > ')}`);
    }
    return `${sv.legs} legs, ${sv.length.toFixed(0)} m, tightest ${sv.tight.toFixed(1)} m off the hull; `
      + `closest approach ${[...sv.closest].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')} m; passes ${passed.join(' > ')}`;
  });

  check('flightops: the outside is derived off the gazetteer, not typed beside it', () => {
    /* Move a room and the mouth moves with it. That is the property four
     * readers of `StationPlan` were given in the first place, and the only way
     * to hold it is to prove the derivation is live. */
    const rooms = [2, 3, 4, 5, 6];
    const before = O.mouthBearing();
    const p = PLACE.get(4);
    const was = { x: p.x, z: p.z };
    p.x += 40; p.z -= 40;
    const after = O.mouthBearing();
    p.x = was.x; p.z = was.z;
    assert(Math.abs(after - before) > 0.5,
      `moving #4 forty metres moved the flight deck's mouth by ${Math.abs(after - before).toFixed(2)}° — it is typed, not derived`);
    assert(Math.abs(O.mouthBearing() - before) < 1e-9, 'the mouth did not come back');

    /* The throat and the dome are the gazetteer's rows, to the metre. */
    const throat = O.SIGHT.get('throat'), t8 = PLACE.get(8);
    assert(Math.abs(Math.hypot(throat.at[0], throat.at[2]) - (Math.hypot(t8.x, t8.z) + t8.d / 2)) < 0.01,
      'the docking throat sight is not where §3.2 #8 is');
    const dome = O.SIGHT.get('dome'), d54 = PLACE.get(54);
    assert(dome.at[0] === d54.x && dome.at[2] === d54.z, 'the dome sight is not where §3.2 #54 is');
    /* And the envelope covers every deck the station has places on. */
    const bands = O.hullBands();
    assert(bands.length >= 6, `${bands.length} bands in the hull envelope against six decks`);
    assert(O.hullRadiusAt(floorOf(PLACE.get(5))) > 0, 'the launch well is outside the hull');
    assert(O.hullRadiusAt(O.HULL.y1 + 10) === 0, 'the hull has no top');
    return `mouth derived at ${before.toFixed(1)}° from ${rooms.length} flight rooms; `
      + `${bands.length} envelope bands, widest ${O.HULL.r.toFixed(0)} m, from ${O.HULL.y0.toFixed(0)} to ${O.HULL.y1.toFixed(0)} m`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE TWO BARS THE WHOLE LANE IS HELD TO
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: nothing in the launch path can put up a loading plate', async () => {
    /**
     * V15 §1.5: *"seemlessly should be able to go from our star wars hangar to
     * the station through just the elevator with no loading screens."*
     * `station.mjs` holds the lift to it by reading `main.js`'s two handlers.
     * The launch is where it would be easiest to break, because going outside
     * LOOKS like changing level — and the whole design of `Launch.js` is that
     * it is not one. So: the three §7 files and the §7 region of `Station.js`
     * may not name the loader at all.
     */
    const LOADER = ['Screens', 'loading', 'captureStill', 'enterStation', 'leaveStation',
      'enterHangar', 'leaveHangar', 'new World', '_loadSteps'];
    const files = ['FlightOps.js', 'Launch.js', 'Outside.js'];
    for (const f of files) {
      const c = code(await read(f));
      for (const bad of LOADER) {
        assert(!c.includes(bad), `${f} names ${bad} — §7 is one frame of shader, not a load`);
      }
    }
    /* And the seam in `Station.js`: everything between the flight-ops banner
     * and the end of `stepBells`. */
    const stn = code(await read('Station.js'));
    const from = stn.indexOf('const FLIGHT_PLACES');
    const to = stn.indexOf('function promptOnArrival');
    assert(from > 0 && to > from, "the flight-ops seam is not where this check looks for it");
    const seam = stn.slice(from, to);
    for (const bad of LOADER) assert(!seam.includes(bad), `Station.js's flight-ops seam names ${bad}`);
    /* The one thing it MAY do, and does: re-configure the shader that is
     * already running, which is the deck's own call. */
    assert(/configureOrbit/.test(seam), 'the sortie never re-configures the window — then what changes?');

    /* IMPORTS, COUNTED. `Launch.js` reaches nothing at all, like `Warp.js`. */
    const imports = async (f) => [...(await read(f)).matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    const li = await imports('Launch.js');
    assert(li.length === 0, `Launch.js imports ${li.join(', ')} — it is a clock and a clock reaches nothing`);
    const fi = await imports('FlightOps.js');
    assert(fi.length === 1 && /MathUtil/.test(fi[0]), `FlightOps.js imports ${fi.join(', ')}`);
    const oi = await imports('Outside.js');
    assert(oi.length === 1 && /StationPlan/.test(oi[0]), `Outside.js imports ${oi.join(', ')}`);
    /* And none of the three touches a world, a canvas or an unseedable stream. */
    for (const f of files) {
      const c = code(await read(f));
      for (const bad of ['THREE', 'document', 'localStorage', 'Math\\.random']) {
        assert(!new RegExp(`\\b${bad}`).test(c), `${f} names ${bad}`);
      }
    }
    return `${files.length} pure files (imports: 1, 0, 1), ${LOADER.length} loader symbols absent from all of them and from Station.js's seam`;
  });

  check('flightops: the loop runs in a real station, and nothing is loaded to fly it', async () => {
    /**
     * EVERY CHECK ABOVE DRIVES A PURE FILE. This one is the seam: a real
     * station on deck 12, the player standing in #5, and the same key press
     * `Player._readInput` makes. It is here because the pure half being right
     * is not the claim — the claim is that you can walk into the Cobra bay and
     * launch, and that doing so does not rebuild the world.
     *
     * THE NUMBER THAT MATTERS is `world.props.length` and the identity of
     * `world._station` across the whole round trip. If either moved, something
     * was torn down and built again, which is what a loading plate is FOR and
     * is the thing V15 §1.5 forbids.
     */
    const { stationKey, stepStation } = await import('../../src/game/Station.js');
    const world = await station(12);
    try {
      const said = [];
      world.notify = (a, b) => said.push(`${a}: ${b}`);
      const st = world._station;
      const bay = PLACE.get(5);
      const stand = () => world.player.position.set(bay.x, floorOf(bay) + 1, bay.z);
      stand();

      /* UNCERTIFIED. The bay refuses and names the rung. */
      world._flight = F.blankFlight();
      assert(stationKey(world) === true, 'the Cobra bay did not answer the key at all');
      assert(/0 of 3/.test(said.join('|')), `the refusal read "${said[said.length - 1]}"`);

      /* CERTIFIED, and the same press launches. */
      world._flight = walkTheLadder().fold;
      said.length = 0;
      const props = world.props.length;
      const places = st.places.size;
      assert(stationKey(world) === true, 'the certified press was not spent');
      assert(world._sortie && !world._sortie.done, 'the press did not start a sortie');

      let frames = 0, outAt = -1, home = -1;
      while (frames < 60 * 40) {
        stepStation(world, 1 / 60);
        stand();
        frames++;
        if (outAt < 0 && world._flying) outAt = frames;
        if (outAt > 0 && !world._flying && world._sortie?.done) { home = frames; break; }
      }
      assert(outAt > 0, 'the launch never put the player outside');
      assert(home > outAt, 'the sortie never came home on its own');
      assert(world._station === st, 'the world was re-dressed to go outside — that is a load');
      assert(world.props.length === props, `props went ${props} → ${world.props.length} across a sortie`);
      assert(st.places.size === places, `places went ${places} → ${st.places.size} across a sortie`);
      assert(world._flight.sorties === 1, `${world._flight.sorties} sorties filed for one round trip`);
      /* The five sights were named on the way round, and the bay was put back. */
      const named = said.filter((l) => l.startsWith('OUTSIDE:')).length;
      assert(named >= 3, `${named} sights named on a lap of the circuit`);
      assert(st.bay.lights === 0 && st.bay.canopy === 0, 'the bay was left mid-cycle');

      /**
       * AND #6'S BELLS, IN THE SAME WORLD. The verb is a grip and a throw and
       * the game already owns both, so what is measured is the LISTENING:
       * `stepBells` finds the four `kind: 'engine'` bodies `StationKit.cellar`
       * stands up, and a body that was moving and has just stopped is a strike.
       * A fake velocity is the honest way to drive it — the alternative is
       * running the Force grip in a headless check, which measures Powers.js.
       */
      const bells = world.props.filter((p) => p?.kind === 'engine');
      assert(bells.length === F.BELL.count,
        `${bells.length} engine bells in #6 against FlightOps' ${F.BELL.count}`);
      said.length = 0;
      const b = bells[0];
      b.body.velocity.set(0, 0, 14);
      stepStation(world, 1 / 60);
      b.body.velocity.set(0, 0, 0);
      stepStation(world, 1 / 60);
      const rang = said.filter((l) => l.startsWith('ENGINE BELL:'));
      assert(rang.length === 1, `${rang.length} bells rang on one strike — "${said.join(' / ')}"`);
      /* And a nudge is silent, which is `ringBell`'s threshold reaching the
       * world rather than only the unit test. */
      said.length = 0;
      b.body.velocity.set(0, 0, 1.5);
      stepStation(world, 1 / 60);
      b.body.velocity.set(0, 0, 0);
      stepStation(world, 1 / 60);
      assert(!said.some((l) => l.startsWith('ENGINE BELL:')), 'a 1.5 m/s nudge rang the bell in the world');

      return `deck 12: refused uncertified, launched at frame 1, outside by ${outAt}, home at ${home} `
        + `(${(home / 60).toFixed(1)} s); ${named} sights named; props ${props} → ${world.props.length}, `
        + `places ${places} → ${st.places.size}, one station object throughout; `
        + `${bells.length} bells, 1 rang on a ${14} m/s strike and 0 on a nudge`;
    } finally { world.dispose?.(); }
  });

  check('flightops: the glass in the tower and the line it says are one board', async () => {
    /**
     * TWO READERS OF ONE FUNCTION, which is the point of `boardAt` being pure.
     * `StationBoards.trafficRows` prints the panel in the room and
     * `Station.readTower` says the banner; if either had built its own view of
     * the traffic they would disagree at the minute a movement changed state,
     * and nobody would ever catch it because the two are never on screen
     * together.
     */
    const { trafficRows } = await import('../../src/game/StationBoards.js');
    let checked = 0;
    for (let d = 0; d < 3; d++) {
      for (let m = 0; m < 24 * 60; m += 11) {
        const st = { day: d, hour: m / 60, theatre: 'Geonosis', name: 'CROSSROADS' };
        const glass = trafficRows(st).slice(1);
        const mine = F.boardAt(d, m / 60, { theatre: 'Geonosis', rows: F.BOARD.rows }).map(F.boardLine);
        assert(glass.join('|') === mine.join('|'), `the glass and the board differ at day ${d} ${(m / 60).toFixed(2)}`);
        assert(glass.length <= F.BOARD.rows, `${glass.length} rows on a board that holds ${F.BOARD.rows}`);
        checked++;
      }
    }
    /* And your own launch goes up on it. */
    const mine = { n: 9, gate: 'COBRA', craft: 'Aurora Starfury', call: 'your own', kind: 'out', due: 13.5, at: 13.5, held: false, mine: true };
    const with_ = trafficRows({ day: 1, hour: 13.5, theatre: 'x', name: 'X', mine });
    assert(with_.some((r) => /COBRA/.test(r)), 'a launch you flew is not on the tower board');
    return `${checked} minutes sampled: the glass and the banner are the same ${F.BOARD.rows} rows, and a sortie appears on it`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE DOOR — and it is the thing this whole suite was green without
   * ════════════════════════════════════════════════════════════════════════ */

  check('flightops: the lift stops at every deck §7 lives on, and the car raises the row', async () => {
    /**
     * ══ WHAT THIS SUITE COULD NOT SEE, AND WAS 15/15 OVER ═══════════════════
     *
     * Every check above this one reaches the rooms by calling `station(12)` or
     * `station(32)` — booting the level at a deck directly, which is what
     * `main.js` does AFTER the lift has handed it a floor row. Nothing asked
     * whether a floor row exists. Measured:
     *
     *   liftFloors()   BRIDGE | station 40 | station 44 | station 48
     *   decks §7 needs 32 (#2 #3 #4) and 12 (#5 #6)
     *
     * So the five rooms, their five verbs, the cert ladder, the launch and the
     * tower's traffic board were unreachable by any player, and this file was
     * green throughout — the same instrument defect `_casinoprobe.mjs`'s header
     * describes for `Games.js`, one layer up: there the module had no importer,
     * here the deck had no door.
     *
     * THE DECKS ARE DERIVED FROM THE GAZETTEER, never typed. The five ids are
     * §7's own — the same five `Station.FLIGHT_PLACES` dispatches — and their
     * DECKS are read off `StationPlan.PLACE`, so moving the ready room down a
     * deck fails this the day it moves rather than the day somebody notices.
     */
    const { liftFloors } = await import('../../src/game/DeckLift.js');
    await import('../../src/game/Levels.js');   // `setLiftFloors` runs on its import
    const rows = liftFloors();
    const need = new Set([2, 3, 4, 5, 6].map((id) => PLACE.get(id).deck));
    const blind = [...need].filter((d) => !rows.some((f) => f.deck === d && f.level === 'station'));
    assert(blind.length === 0,
      `§7's rooms live on decks ${[...need].join(' and ')} and the lift stops at `
      + `${rows.filter((f) => f.deck).map((f) => f.deck).join(', ')} — deck(s) ${blind.join(', ')} `
      + 'have no floor row, so nothing in this file is reachable by a player');

    /**
     * AND THE CAR ACTUALLY GOES THERE. A row in a table is not a door: the
     * column has to be able to land on it, the readout has to agree with the
     * button, and the ride has to raise `onDeckLift` with THAT row — which is
     * the object `main.js` turns into `_stationFloor`. Driven from the
     * Concourse, with `liftKey` doing the pressing, because that is the key a
     * player has.
     */
    const { RIDE, atTheDoors, liftKey, liftPick } = await import('../../src/game/DeckLift.js');
    const { LIFT } = await import('../../src/game/Hangar.js');
    const { run: step, idleInput } = await import('./_coop.mjs');
    const said = [];
    for (const deck of [...need].sort((a, b) => a - b)) {
      const world = await station(40);
      try {
        const idle = idleInput();
        const car = world._deckLift, sh = world._station.shaft;
        /* Out of the doorway and let it go, then call it back: a car standing
         * open never leaves. `station.mjs` does the same dance for the same
         * reason. */
        world.player.position.set(sh.x * 0.6, world._station.deckY + 1.0, sh.z * 0.6);
        world.player.body?.setTransform?.(world.player.position, null);
        step(world, 8.0, idle);
        let found = null;
        for (let dr = 0; dr <= 8 && !found; dr += 0.5) {
          for (let a = 0; a < 32 && !found; a++) {
            const th = (Math.PI * 2 * a) / 32;
            const x = sh.x + Math.cos(th) * dr, z = sh.z + Math.sin(th) * dr;
            world.player.position.set(x, world._station.deckY + 1.0, z);
            if (atTheDoors(world)) found = [x, z];
          }
        }
        assert(found && liftKey(world), `deck ${deck}: the call key at the doors was not taken`);
        step(world, RIDE.arrive + RIDE.doors + 0.4, idle);

        const at = car.place(LIFT.x, 0, LIFT.z);
        const stand = () => {
          world.player.position.set(at.x, at.y + 1.0, at.z);
          world.player.body?.setTransform?.(world.player.position, null);
        };
        stand();
        let taps = 0;
        while (liftPick(world).deck !== deck && taps <= liftFloors().length) {
          liftKey(world); taps++; step(world, 1 / 60, idle);
        }
        assert(liftPick(world).deck === deck,
          `the button column never landed on deck ${deck} in ${taps} taps`);
        /* THE RULE `decklift.mjs` HOLDS, held here too — the readout is the
         * button column's answer and the two cannot disagree. */
        assert(car.readout.caption === String(liftPick(world).label).toUpperCase(),
          `deck ${deck}: the readout says "${car.readout.caption}" and the column is on `
          + `"${liftPick(world).label}"`);
        /* Read while the car is WAITING. Once it is riding the plate counts
         * decks and says `DECK ▲`, which is the right answer to a different
         * question. */
        const showed = `${String(car.readout.number).padStart(2, '0')} ${car.readout.caption}`;

        let row = null, left = 0;
        world.onDeckLift = (r) => { row = r; };
        world.onDeckLeave = () => { left++; };
        step(world, 1.4 + RIDE.doors + RIDE.settle + RIDE.ride, idle, stand);
        assert(row && row.deck === deck,
          `the ride to deck ${deck} raised onDeckLift(${row ? row.deck : 'nothing'}) `
          + `and onDeckLeave ${left} times — that hook is what \`main.js\` turns into \`_stationFloor\``);
        assert(row.level === 'station',
          `deck ${deck}'s row names level '${row.level}', which \`enterStation\` will not build`);
        assert(left === 0, `a chosen floor also raised onDeckLeave ${left} times — that is the menu`);
        said.push(`${taps} tap(s) → "${showed}" (shaft ${row.shaft ?? 'arrivals'})`);
      } finally { world.dispose?.(); }
    }
    return said.join('; ');
  });

  check('flightops: all five rooms answer the real key, and the tower board builds', async () => {
    /**
     * ══ THE PRESS, NOT THE CALL ═════════════════════════════════════════════
     *
     * `stationKey(world)` is what every other check in this file reaches for,
     * and it is the wrong instrument for this one: the defect being guarded
     * against is a BRANCH THAT NEVER RUNS, and the audit found exactly that
     * shape one file over — `Station.js`'s counter branch sat below the kiosk
     * branch and two shops were unreachable while `_doorprobe.mjs`, which
     * calls the hook, was green over it. So this presses `focus` into a real
     * frame and lets `Player._readInput` → `stationKey` → `flightKey` be the
     * path.
     *
     * THE PRESS IS SHAPED LIKE `Input`, AND THAT MATTERS. `Input.actHit` is
     * IDEMPOTENT within a frame — the edge set is read as many times as
     * anything asks and `end()` clears it — while `_readInput` reads
     * `actHit('thrust')` twice on the melee path. A "genuine one-shot" input
     * that consumed itself on the first read would starve the second and make
     * a working feature look dead.
     *
     * THE DECKS COME OFF THE FLOOR LIST, not off a literal, so this measures
     * the rooms a player can actually stand in. With no row for a deck there
     * is nothing to boot and the assertion below names the room.
     *
     * TWO PRESSES PER ROOM, AND THE SECOND IS THE ONE MEASURED. `stepStation`
     * raises the arrival prompt — `notify(place.name, place.verb)` — the first
     * frame you are in a new place, so the first press comes with the prompt
     * beside it. The second is the room alone.
     *
     * AND WHAT IT MUST NOT SAY IS THE VERB. `stationKey`'s last line is
     * `notify(place.name.toUpperCase(), place.verb)` — the fallback for a room
     * with nothing behind it, and it is exactly what all five of these printed
     * before `flightKey` existed. A press that answers with the prompt text is
     * a press that reached no branch.
     */
    const { liftFloors } = await import('../../src/game/DeckLift.js');
    await import('../../src/game/Levels.js');
    const { idleInput } = await import('./_coop.mjs');
    /** One press, in `Input`'s own shape: true for every read this frame. */
    const press = () => {
      const hits = new Set(['focus']);
      const i = idleInput();
      i.act = (a) => hits.has(a);
      i.actHit = (a) => hits.has(a);
      i.end = () => hits.clear();
      return i;
    };

    const byDeck = new Map();
    for (const id of [2, 3, 4, 5, 6]) {
      const d = PLACE.get(id).deck;
      const row = liftFloors().find((f) => f.deck === d && f.level === 'station');
      assert(row, `#${id} ${PLACE.get(id).name} is on deck ${d} and no lift floor reaches it`);
      if (!byDeck.has(d)) byDeck.set(d, []);
      byDeck.get(d).push(id);
    }

    const out = [];
    for (const [deck, ids] of [...byDeck].sort((a, b) => a[0] - b[0])) {
      const world = await station(deck);
      try {
        const st = world._station;
        st.hour = 13.5;                       // an hour with traffic and a shift in the pit
        const said = [];
        world.notify = (a, b) => said.push([a, b]);
        for (const id of ids) {
          const p = PLACE.get(id);
          const put = (y) => {
            world.player.position.set(p.x, floorOf(p) + y, p.z);
            world.player.body?.setTransform?.(world.player.position, null);
          };
          put(1.0);
          world.update(1 / 60, press());       // press 1: the arrival prompt rides along
          said.length = 0;
          world.update(1 / 60, press());       // press 2: the room, alone
          assert(said.length >= 1,
            `#${id} ${p.name}: one press of \`focus\` on the deck said NOTHING — the key never `
            + 'reached the room');
          const [head, line] = said[said.length - 1];
          assert(line !== p.verb,
            `#${id} ${p.name}: the press answered with the gazetteer's prompt ("${line}"), which is `
            + '`stationKey`\'s fallback for a room with nothing behind it');
          out.push(`#${id} "${head}: ${String(line).slice(0, 44)}"`);
        }
        /* ── AND THE TOWER'S BOARD IS A THING IN THE ROOM ──────────────────
         *
         * `st.traffic` is what `StationBoards.dressFlightBoard` hangs on the
         * glass, and it was null on every deck a player could reach, so
         * `trafficRows` had never run in a game. It is asserted on the deck
         * #2 is on and asserted ABSENT everywhere else, because a board on a
         * deck with no tower would be a second copy of the room. */
        const hasTower = ids.includes(2);
        assert(!!st.traffic === hasTower,
          `deck ${deck} ${st.traffic ? 'has' : 'has no'} traffic board and ${hasTower ? 'has' : 'has no'} tower`);
        if (hasTower) {
          const { trafficRows } = await import('../../src/game/StationBoards.js');
          const glass = trafficRows({ day: st.day ?? 0, hour: st.hour, theatre: st.theatre, name: st.name });
          assert(glass.length === F.BOARD.rows + 1,
            `the glass printed ${glass.length} lines against ${F.BOARD.rows} rows and a header`);
          assert(String(glass[0]).includes(st.name), `the board's header reads "${glass[0]}"`);
          out.push(`board ${glass.length - 1} rows under "${glass[0]}"`);
        }
      } finally { world.dispose?.(); }
    }
    return out.join('; ');
  });

  check('flightops: the lap is flown by a real Starfury, not advanced by a number', async () => {
    /**
     * ══ THE ORPHAN THIS CHECK EXISTS FOR ══════════════════════════════════
     *
     * `src/game/Starfury.js` — 325 lines, `SHARK.md` §4's *"the one new
     * system"*, 6-DOF Newtonian, ported clause for clause, and held green by
     * `starfury.mjs` — **was in no shipped build.** `pack.mjs` walks the module
     * graph from `index.play.html`'s entry and NOTHING under `src/` imported
     * it: 96 of the 97 `src/game/*.js` files were in the manifest and that was
     * the one. Its own suite reached it with `await import`, which is a
     * statement about the file system and not about the game, so 264 lines of
     * check passed over a file no player's browser ever received.
     *
     * `packed.mjs` now asks that of every file under `src/`. THIS asks the
     * other half, which no import graph can: is the craft actually FLYING the
     * thing, or is it imported and ignored? So every number below is read off
     * the craft's own integrated position — `Starfury.step`, which has no
     * damping term, through `Starfury.allocate`, which refuses to invent
     * thrust the airframe does not have.
     *
     * The old lap was `_orbitU += ORBIT_SPEED * dt / CIRCUIT_LENGTH`. Every
     * assertion here is unfailable against that line, which is the point: a
     * parameter that is added to cannot miss a corner, cannot fly wide of a
     * sight, and cannot be measured for clearance, because it is never
     * anywhere except exactly on the track.
     */
    const { CircuitPilot, TOP_SPEED } = await import('../../src/game/Pilot.js');
    const { Starfury } = await import('../../src/game/Starfury.js');

    /* ── ONE LAP, FLOWN ──────────────────────────────────────────────────── */
    const pilot = new CircuitPilot({ radius: 90 });
    assert(pilot.craft instanceof Starfury, 'the pilot is flying something that is not a Starfury');
    /**
     * THE LAUNCH IS THE DRUM'S THROW. `Starfury.launchFromDrum` had no caller
     * anywhere in the tree — the one function in that file whose whole subject
     * is this station — and the craft now leaves the mouth carrying the rim
     * speed of a drum spinning to make a g at 90 m: sqrt(9.81/90) × 90.
     */
    const rim = Math.sqrt(9.81 / 90) * 90;
    assert(Math.abs(pilot.speed - rim) < 0.05,
      `the craft leaves the mouth at ${pilot.speed.toFixed(1)} m/s against the drum's ${rim.toFixed(1)}`);

    let t = 0, tight = Infinity, wide = 0, top = 0;
    const named = [];
    const closest = new Map(O.sights().map((x) => [x.id, Infinity]));
    while (t < 90 && pilot.lap < 1) {
      pilot.step(1 / 60);
      t += 1 / 60;
      const [x, y, z] = pilot.craft.position;
      const here = { x, y, z };
      tight = Math.min(tight, O.clearanceAt(here));
      top = Math.max(top, pilot.speed);
      const on = O.sample(pilot.progress);
      wide = Math.max(wide, Math.hypot(on.x - x, on.y - y, on.z - z));
      for (const sgt of O.sights()) {
        const d = Math.max(0, Math.hypot(x - sgt.at[0], y - sgt.at[1], z - sgt.at[2]) - sgt.r);
        if (d < closest.get(sgt.id)) closest.set(sgt.id, d);
      }
      const n = O.nearest(here).sight.id;
      if (named[named.length - 1] !== n) named.push(n);
    }
    assert(pilot.lap === 1, `the craft did not get round: ${(pilot.travelled * 100).toFixed(0)}% in ${t.toFixed(0)} s`);

    /**
     * ── IT NEVER TOUCHES THE STATION ──────────────────────────────────────
     *
     * `Outside.CLEAR` is the bar the TRACK is held to and this holds the FLOWN
     * PATH to the same one, which is the harder question: the track is a
     * polyline through eleven waypoints and a craft with 18.4 m/s² cannot
     * corner on a polyline, so the difference between the two is the whole
     * cost of making this real.
     */
    assert(tight >= O.CLEAR,
      `the flown lap came within ${tight.toFixed(1)} m of the hull, against Outside.CLEAR's ${O.CLEAR}`);
    /**
     * ── AND IT IS FLYING THE TRACK, NOT ITS OWN ORBIT ─────────────────────
     *
     * The bar is `STANDOFF`: a pilot that wanders further off the line than
     * the line itself stands off the hull is not following it, it is going
     * round the station near it. The first cut of this pilot integrated its
     * track parameter instead of projecting onto it and finished 500 m wide
     * with the lap reading complete — this is the clause that says so.
     */
    assert(wide < O.STANDOFF,
      `the craft flew ${wide.toFixed(0)} m off the line, against a standoff of ${O.STANDOFF} m`);
    /**
     * ── THE FOUR SIGHTS ARE STILL NAMED, IN ORDER ─────────────────────────
     *
     * §3.2 #55's whole verb. `nearest` never answers `hull`, so four is all of
     * them, and the ORDER is the circuit's — a lap that named them in a
     * different order would be a craft flying the loop backwards.
     */
    assert(named.join('>') === 'mouth>throat>drum>dome>mouth',
      `the flown lap named ${named.join(' > ')}`);
    /**
     * ── AND THE SPEED IS THE AIRFRAME'S ANSWER, NOT A CONSTANT ────────────
     *
     * `TOP_SPEED` is a ceiling the corner law is allowed to come nowhere near.
     * If the craft ever held it exactly, the corner law would be doing nothing
     * and this would be a rail again with a Starfury bolted to the side of it.
     */
    assert(top <= TOP_SPEED + 1e-6, `the craft exceeded its own ceiling: ${top.toFixed(1)} m/s`);
    assert(top < TOP_SPEED - 2,
      `the craft held ${top.toFixed(1)} of a ${TOP_SPEED} m/s ceiling — the corner law is not biting`);

    /* ── AND THE SORTIE IN A REAL STATION IS FLOWN BY ONE ─────────────────── */
    const { stationKey, stepStation } = await import('../../src/game/Station.js');
    const world = await station(12);
    let sawCraft = null, sawSpeed = 0;
    try {
      world.notify = () => {};
      const bay = PLACE.get(5);
      world.player.position.set(bay.x, floorOf(bay) + 1, bay.z);
      world._flight = walkTheLadder().fold;
      assert(stationKey(world) === true, 'the certified press was not spent');
      for (let i = 0; i < 60 * 40; i++) {
        stepStation(world, 1 / 60);
        world.player.position.set(bay.x, floorOf(bay) + 1, bay.z);
        if (world._pilot) { sawCraft = world._pilot.craft; sawSpeed = Math.max(sawSpeed, world._pilot.speed); }
        if (sawCraft && !world._flying && world._sortie?.done) break;
      }
    } finally { world.dispose?.(); }
    assert(sawCraft instanceof Starfury,
      'a launch out of the Cobra bay put no Starfury outside — the lap is a number again');
    assert(sawSpeed > 20, `the craft in the real sortie never got above ${sawSpeed.toFixed(1)} m/s`);

    const sightList = [...closest].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    return `${t.toFixed(1)} s round ${O.CIRCUIT_LENGTH.toFixed(0)} m, peak ${top.toFixed(1)} m/s of a `
      + `${TOP_SPEED} ceiling; clearance ${tight.toFixed(1)} m (bar ${O.CLEAR}), ${wide.toFixed(0)} m off `
      + `the line (bar ${O.STANDOFF}); closest ${sightList}; the real sortie flew a Starfury at `
      + `${sawSpeed.toFixed(0)} m/s`;
  });

  check('flightops: a sortie is not a run, and files nothing', async () => {
    /**
     * §14 and `Progress.js`: `station` is already on the refusal list and a
     * visit is not a run. A sortie is a visit to the outside of the building
     * you are standing in.
     */
    const had = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    try {
      /* The whole lane, driven: the ladder, the launch, a lap, the recovery. */
      let f = walkTheLadder().fold;
      const sink = { outside: () => {}, sortie: () => {}, say: () => {}, done: () => {} };
      const out = new L.Sortie('out', sink, {});
      for (let t = 0; t < 20 && !out.done; t += 1 / 60) out.step(1 / 60);
      const back = new L.Sortie('in', sink, {});
      for (let t = 0; t < 20 && !back.done; t += 1 / 60) back.step(1 / 60);
      f = F.flew(f);
      for (let i = 0; i < F.BELL.count; i++) f = F.throwBell(f, i, 14, { day: 3 }).fold;
      assert(f.sorties === 1, `${f.sorties} sorties recorded for one round trip`);
      assert(localStorage.getItem(KEY) === null,
        'a sortie wrote to saber.progress.v1 — a visit is not a run');
      /* And the fold that survives is the station's, with no run-shaped field
       * anywhere in it. */
      const keys = Object.keys(f).sort().join(',');
      assert(!/score|depth|wave|kills|won/.test(keys), `the flight fold carries run fields: ${keys}`);
      return `ladder + launch + lap + recovery + ${F.BELL.count} bells: ${KEY} untouched, fold is {${keys}}`;
    } finally { if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had); }
  });
}
