/**
 * BATTLEFRONT BORZ — YOU LAND INTO A BATTLE, NOT INTO AN EMPTY FIELD.
 *
 * The player, across many sessions and in these words:
 *
 *   "When I spawn onto geonosis I still have no enemies spawn in."
 *
 * They were right, and the thing they were describing was not a spawner that
 * had failed. It was a gate. `World.update` held the wave director on
 * `!extraction.active`, `active` is `phase !== 'done'`, and `beginInsertion` is
 * the last line of deploy — so the whole arrival flight ran with the horde
 * switched off. Measured on a geonosis skirmish before the fix, off the
 * director's own phase log:
 *
 *     orbit@0  entry@7.0  descent@13.5  opening@22.5  unload@24.3
 *     sealing@26.3  done@28.0
 *
 * Twenty-eight seconds. ZERO hostiles alive on any frame of it, under a HUD
 * already printing "50 HOSTILES LEFT" — and the first body of the wave then
 * arrived by march, from 137 m, on ground the player had been stood on for
 * half a minute.
 *
 * ── WHAT THIS FILE MEASURES ───────────────────────────────────────────────
 *
 * BEHAVIOUR, at the two instants the player actually experiences:
 *
 *   A  how many hostiles are ALIVE the moment the ramp comes down, and where
 *      they are, and where they are five and fifteen seconds after the
 *      commander's boots reach the sand.
 *   C  that not one body is PLACED on the pad the transport is coming down on
 *      — driven on a level whose spawn ring is INSIDE the pad, because a
 *      placement law that is only true at the radii the shipped levels happen
 *      to use is not a law. (The Dojo's ring is [5, 8].)
 *   D  that the horde still waits while the army is being flown OFF a ground,
 *      which is what the old gate was for and is the half a fix must not lose.
 *   E  that `instantSpawn` still means what it has always meant.
 *
 * Nothing here restates a rule src/ owns. The phases are read off
 * `ExtractionDirector.log` and `.phase`, the pad and its radius off
 * `lzPoint`/`lzRadius`, "is this body one of the horde" off the director's own
 * `blocksWaveEnd`, and every placement is caught at `World.spawnEnemy` — the
 * one door every body in the game comes through.
 */

/** A world in a fighting mode, with a commander, one frame in. */
async function boot(mode = 'skirmish', level = 'geonosis', settings = {}, runSeed = null) {
  const H = await import('./_coop.mjs');
  const { world } = await H.bootWorld({
    level, runSeed,
    settings: { quality: 'low', difficulty: 'knight', mode, ...settings },
  });
  const input = H.idleInput();
  // one frame so the mode opens itself — `beginSkirmish` is called by
  // `World.update` for the reason its own note gives.
  world.update(1 / 60, input);
  return { world, input };
}

/** Step until `done(world, t)` or `seconds` elapse. Returns seconds run. */
function until(world, input, seconds, done, each = null) {
  const dt = 1 / 60;
  let t = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    each?.(world, t);
    world.update(dt, input);
    t += dt;
    if (done(world, t)) return t;
  }
  return t;
}

/** The horde, as the director itself counts it — allies live in `enemies` too. */
function horde(world) {
  const d = world.director;
  return world.enemies.filter((e) => d?.blocksWaveEnd?.(e));
}

/** Sorted ground ranges from a point, in metres. */
function ranges(bodies, at) {
  return bodies
    .map((e) => Math.hypot(e.position.x - at.x, e.position.z - at.z))
    .sort((a, b) => a - b);
}

const say = (d) => d.length
  ? `${d.length} at ${d[0].toFixed(0)}/${d[Math.floor(d.length / 2)].toFixed(0)}/${d[d.length - 1].toFixed(0)} m`
  : 'none';

/**
 * EVERY PLACEMENT, CAUGHT AT THE DOOR.
 *
 * `World.spawnEnemy` is where every body in the game is made — the director's
 * direct path, every gunship's `_deliver`, the sandbox — so wrapping it is the
 * whole census, and it records what the caller ASKED for as well as where the
 * body ended up. The difference between those two is the LZ guard working.
 */
function watchSpawns(world) {
  const log = [];
  const inner = world.spawnEnemy.bind(world);
  world.spawnEnemy = (type, pos) => {
    const asked = { x: pos.x, z: pos.z };
    const e = inner(type, pos);
    const X = world.extraction;
    const pad = X?.lzPoint;
    log.push({
      type, phase: X?.active ? X.phase : 'done',
      /* WHOSE BODY IT IS, asked of the director rather than of the team number:
       * an ally is an `Enemy` on your team living in the same array, and
       * `blocksWaveEnd` is the one place the game states which of them the
       * horde is. A line deployed onto new ground mid-flight is not a wave. */
      hostile: !!world.director?.blocksWaveEnd?.(e),
      pad: pad ? { x: pad.x, z: pad.z } : null,
      askedAt: pad ? Math.hypot(asked.x - pad.x, asked.z - pad.z) : null,
      putAt: pad ? Math.hypot(e.position.x - pad.x, e.position.z - pad.z) : null,
    });
    return e;
  };
  return log;
}

export async function run({ check, assert }) {
  /* THE SHARED CLOCKS GO BACK BETWEEN CHECKS. Every clause below drives a real
   * World for twenty to fifty game-seconds, which moves the wind clock and both
   * random streams further than anything but extraction.mjs. `determinism.mjs`
   * is the check that says so. It also serialises, which suites that boot a
   * world per clause want anyway. */
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ══ A — the ramp comes down on a fight ════════════════════════════ */

  check('landing: the enemy is on the ground before the ramp is', async () => {
    /**
     * THE DEFECT, AT THE INSTANT THE PLAYER MEETS IT.
     *
     * `beginInsertion` is the real one — the same call `main.js` makes as the
     * last line of deploy — and the two instants are read off the sequence
     * rather than off a stopwatch this file keeps: the ramp is the frame
     * `descent` hands over to `opening`, and the landing is the frame
     * `player.riding` clears, which is `_release` putting the commander on the
     * sand.
     *
     * MEASURED ON GEONOSIS, thirteen seeds, hostiles alive at those instants:
     *
     *              ramp-open      +5 s        +15 s
     *     before       0          4–7         19–36
     *     after      10–29       25–45        37–50
     *
     * The median range at ramp-open is about one march band — geonosis marches
     * its horde in from ~137 m, which is the level's own arrival and not this
     * file's opinion — and the nearest is inside 30 m by +15 s. That is a field
     * closing on the LZ instead of an empty one.
     */
    const { world, input } = await boot('skirmish', 'geonosis', {}, 7);
    const X = world.extraction;
    assert(X.beginInsertion({ name: 'Geonosis' }), 'beginInsertion declined a geonosis skirmish');
    const spawns = watchSpawns(world);

    let ramp = null, boots = null, wasRiding = true;
    const marks = [];
    let claimed = 0;
    until(world, input, 70, () => boots !== null && boots.after >= 15, (w, t) => {
      const x = w.extraction;
      if (ramp === null && x.active && x.phase === 'opening' && x.log.some((r) => r.phase === 'descent')) {
        /* WHAT THE HUD IS PROMISING AT THAT MOMENT, taken here so the count
         * below is compared with the number the player is actually reading. */
        claimed = w.director?.remaining ?? 0;
        ramp = { t, d: ranges(horde(w), x.lzPoint), n: horde(w).length };
      }
      if (boots === null) {
        const riding = !!w.player?.riding;
        if (wasRiding && !riding) boots = { t, at: w.player.position.clone(), after: 0 };
        wasRiding = riding;
      } else {
        boots.after = t - boots.t;
        for (const [i, want] of [[0, 5], [1, 15]]) {
          if (marks.length === i && boots.after >= want) {
            marks.push({ want, d: ranges(horde(w), w.player.position) });
          }
        }
      }
    });

    assert(ramp, 'the ramp never opened on the far end of the descent');
    assert(boots, 'the commander never got off the ship');
    assert(claimed > 0, `the HUD promised ${claimed} hostiles — nothing was being counted, so nothing is being tested`);
    /* THE HEADLINE, and it is the player's sentence: the field is not empty
     * when you can see it. The floor is well under the 21 the worst of three
     * measured seeds gave, because the wave's composition is the director's
     * business and this is a check about a GATE. */
    assert(ramp.n > 0,
      `${ramp.n} hostiles alive when the ramp came down, with the HUD printing ${claimed} — `
      + 'that is the whole of "I still have no enemies spawn in"');
    assert(ramp.n >= 8,
      `only ${ramp.n} hostiles were on the field at ramp-open against ${claimed} promised `
      + '(10–29 measured across thirteen seeds) — the director is being let run too late to matter');
    assert(marks.length === 2, 'never reached +15 s after touchdown');
    assert(marks[1].d.length > 0 && marks[1].d[0] < 60,
      `fifteen seconds after landing the nearest hostile was ${marks[1].d[0]?.toFixed(0)} m away — `
      + 'they are supposed to be closing on you');

    /* AND NOT ONE OF THEM ON THE PAD. The census is every placement made while
     * a flight was up, measured against that flight's own keep-out. */
    const onPad = spawns.filter((s) => s.putAt !== null && s.putAt < X.lzRadius - 1e-6);
    assert(onPad.length === 0,
      `${onPad.length} of ${spawns.length} bodies were put down inside the ${X.lzRadius} m landing zone`);

    return `ramp-open ${say(ramp.d)} of ${claimed} promised · +5 s ${say(marks[0].d)} · +15 s ${say(marks[1].d)} `
      + `(count/nearest/median/furthest, from the pad then from the commander)`;
  });

  /* ══ C — and the pad stays empty when the ring is inside it ════════ */

  check('landing: nothing is set down on the pad, on a level whose ring is inside it', async () => {
    /**
     * THE GUARD, DRIVEN WHERE IT CAN ACTUALLY FIRE.
     *
     * Every shipped fighting level draws its wave from a ring that starts well
     * outside the pad — 26 m on the tightest, 58 on geonosis, against a 20 m
     * keep-out — so on those levels the guard rejects nothing and a check run
     * on them would be decoration. HANDOFF §2.3: a check that cannot fail is
     * worse than no check. The Dojo ships `spawnRadius: [5, 8]`, so a ring
     * inside the pad is a real configuration, and this is one: the level's own
     * table is narrowed for the length of the clause and put back afterwards.
     *
     * Two assertions and the second is the one that keeps the first honest —
     * the guard must have had something to do. Measured at [6, 14]: 8 of 42
     * placements arrived inside the pad and every one of them was moved out.
     */
    const { world, input } = await boot('skirmish', 'geonosis', {}, 11);
    const X = world.extraction;
    const was = world.level.spawnRadius;
    let spawns = [];
    try {
      world.level.spawnRadius = [6, 14];
      spawns = watchSpawns(world);
      assert(X.beginInsertion({ name: 'Geonosis' }), 'beginInsertion declined');
      until(world, input, 60, (w, t) => !w.extraction.active && t > 1);
    } finally {
      world.level.spawnRadius = was;
    }
    const inFlight = spawns.filter((s) => s.putAt !== null);
    const onPad = inFlight.filter((s) => s.putAt < X.lzRadius - 1e-6);
    const moved = inFlight.filter((s) => s.askedAt < X.lzRadius - 1e-6);
    assert(inFlight.length >= 10,
      `only ${inFlight.length} bodies were placed during the flight — nothing was measured`);
    assert(moved.length > 0,
      `not one of ${inFlight.length} placements was even asked for inside the ${X.lzRadius} m pad, `
      + 'so this clause proves nothing — the ring it drives with is not tight enough any more');
    assert(onPad.length === 0,
      `${onPad.length} of ${inFlight.length} bodies were set down inside the pad, the closest at `
      + `${Math.min(...inFlight.map((s) => s.putAt)).toFixed(1)} m of a ${X.lzRadius} m keep-out`);
    return `ring [6, 14] against a ${X.lzRadius} m pad: ${inFlight.length} placements, `
      + `${moved.length} asked for inside it, 0 left there`;
  });

  /* ══ D — and the ground you are LEAVING is still left alone ════════ */

  check('landing: the horde still waits while the army is flown off a ground', async () => {
    /**
     * THE HALF THE FIX MUST NOT LOSE, and the reason the gate could not simply
     * be deleted. An extraction is up to forty seconds and
     * `WaveDirector.intermission` is 5.5, so a director left running through
     * one opens the next engagement's first wave on the pad you are walking
     * away from, with the commander sat in an aircraft — and steers your line
     * with `CommandDirector._troops` while `Extraction._walkTroops` is trying
     * to file the same men up the ramp.
     *
     * So: a real extraction, and the director's own ledgers must not move for
     * as long as it holds the horde. `totalSpawned` is what it counts every
     * time it takes an entry off the queue and `arrivals.log` is every body any
     * ship, gate or march has actually put down, so between them nothing the
     * director owns can move without one of them saying so. The clause is only
     * worth anything if it HAD something to deliver, which is what the
     * `promised` assertion is for.
     *
     * NOT a census at `spawnEnemy`, and that is the interesting part: the level
     * swap happens inside the cruise, and `_afterRotate` → `CommandDirector.
     * start` → `deploy` puts both armies on the new ground while the phase
     * still reads `transit`. Ten bodies, every time, and none of them the
     * director's. A gate check that counted them would be measuring the ground
     * change, which is a different thing that already works.
     */
    const { world, input } = await boot('skirmish', 'colosseum', {}, 13);
    // `_groundPending` is written by `_skirmishCleared` and `_advanceMission`
    // exactly like this; `World.update` hands it to `extraction.begin`.
    world._groundPending = 'drifts';
    let held = 0, promised = 0, moved = 0;
    const heldPhases = new Set();
    let ledger = null;
    until(world, input, 90, (w, t) => !w.extraction.active && t > 2, (w) => {
      const x = w.extraction, d = w.director;
      if (!x.active || !x.holdsHorde(w.level?.spawnRadius?.[1]) || !d) { ledger = null; return; }
      held++;
      heldPhases.add(x.phase);
      promised = Math.max(promised, d.remaining ?? 0);
      /* INCREASES ONLY. `_afterRotate` calls `CommandDirector.start` on the far
       * side of the swap, which puts `totalSpawned` back to zero — a counter
       * going DOWN is a new engagement being composed, not a body being
       * delivered, and only the delivery is what this clause is about. */
      const now = [d.totalSpawned, d.arrivals?.log?.length ?? 0];
      if (ledger && (now[0] > ledger[0] || now[1] > ledger[1])) moved++;
      ledger = now;
    });
    assert(held > 600, `only ${held} frames were spent with the horde held — no extraction ran`);
    assert(promised > 0,
      `the director had ${promised} left to deliver during the whole withdrawal — `
      + 'an empty queue cannot prove a gate');
    assert(moved === 0,
      `the director's ledgers moved on ${moved} of ${held} held frames — it is delivering a wave `
      + 'onto the ground the army is being flown off');
    return `${held} frames held across ${[...heldPhases].sort().join(', ')} with ${promised} still to deliver, `
      + 'and not one taken off the queue';
  });

  /* ══ E — the opt-out ═══════════════════════════════════════════════ */

  check('landing: instantSpawn still skips the flight and starts the fight', async () => {
    /**
     * `settings.instantSpawn` is the one reader of "does this player want
     * things to simply appear", and the sandbox, the dojo and every headless
     * check that is measuring something else set it. It must still decline the
     * flight outright — and, because the gate is now a question about a flight
     * that is not happening, the director must be running from the first frame.
     */
    const { world, input } = await boot('skirmish', 'geonosis', { instantSpawn: true }, 17);
    const X = world.extraction;
    assert(X.beginInsertion({ name: 'Geonosis' }) === false,
      'beginInsertion flew a commander who asked for instant spawns');
    assert(!X.active, 'the extraction director is running with instantSpawn set');
    let first = null;
    until(world, input, 30, (w, t) => { if (first === null && horde(w).length) first = t; return first !== null; });
    assert(first !== null, 'no hostile arrived in thirty seconds with instantSpawn set');
    assert(first < 12, `the first hostile took ${first.toFixed(1)} s with no flight in the way`);
    return `no flight, first hostile at ${first.toFixed(1)} s, ${horde(world).length} on the field`;
  });
}
