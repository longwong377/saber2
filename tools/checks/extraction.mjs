/**
 * BATTLEFRONT BORZ — NOTHING APPEARS OR DISAPPEARS INSTANTLY.
 *
 * Two player notes, made twice, the second time with the word "still" in it:
 *
 *   "in between rounds … you just teleport and it's really disorientating,
 *    first because it looks terrible and second you spawn with your allies in
 *    front of your saber so you end up killing them, also teleporting the
 *    second you kill the last enemy is insane"
 *
 *   "you should never just teleport."
 *
 * Two properties, and this file exists because both of them were false and
 * nothing in 1517 checks said so:
 *
 *   A. NO BODY IS EVER PLACED INSIDE THE COMMANDER'S SWING. `Spawn.bladeClear`
 *      is that sentence as a function. Measured on the shipped deployment ring
 *      before the fix — a full circle at 4 / 6.2 / 8.4 m — 70 of 400
 *      placements were inside the wedge, which is one man in six standing in
 *      front of a lit lightsaber at the moment an engagement opens.
 *
 *   B. A GROUND CHANGE IS NEVER INSTANT. Before the fix `World.update` read
 *      `_groundPending` and called `rotateTo` on the same frame: the last
 *      enemy fell and the planet changed inside 16 ms. Now
 *      `ExtractionDirector` owns it and the earliest the level key can move is
 *      `AFTERMATH + CALL + INBOUND + LIFT + SWAP_AT` seconds later, with a
 *      transport, a walk and a flight in between.
 *
 * BOTH ARE MEASURED AGAINST THE SHIPPED SEAMS AND NOT AGAINST A RESTATEMENT OF
 * THEM — HANDOFF §2.4. `_groundPending` is set here exactly as `_advanceMission`
 * and `_skirmishCleared` set it, `deploy` is the real method, `_sitePoint` is
 * the real site picker, and the phase ordering is read off the director's own
 * `log` rather than off a clock this file keeps.
 */

const V = (H, x, y, z) => { const T = H.THREE; return new T.Vector3(x, y, z); };

/** A world in a mode that changes ground, with a commander and a line. */
async function boot(mode = 'skirmish', level = 'colosseum', settings = {}) {
  const H = await import('./_coop.mjs');
  const { world } = await H.bootWorld({
    level, settings: { quality: 'low', difficulty: 'knight', mode, ...settings },
  });
  const input = H.idleInput();
  // one frame so the mode opens itself — `beginSkirmish` / `beginCampaign` are
  // called by `World.update` for the reason their own notes give.
  world.update(1 / 60, input);
  return { world, input, H };
}

/** Step until `done(world)` or `seconds` elapse. Returns seconds actually run. */
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

/** A commander who actually walks to the ramp, at an ordinary pace. */
function walkToRamp(world) {
  const X = world.extraction;
  if (!X || X.phase !== 'boarding' || !X.group || !world.player) return;
  const r = X._ramp().clone();
  const p = world.player.position;
  const dx = r.x - p.x, dz = r.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const step = Math.min(d, 4.6 / 60);
  p.x += dx / d * step;
  p.z += dz / d * step;
  if (world.terrain) p.y = world.terrain.height(p.x, p.z);
}

export async function run({ check, assert }) {

  /* ══ A — the swing arc ═════════════════════════════════════════════ */

  check('placement: no body is deployed inside the commander\'s swing arc', async () => {
    /**
     * THE MEASUREMENT THAT WAS NEVER TAKEN. `CommandDirector.deploy` is the one
     * method in the game that puts a dozen bodies within ten metres of the
     * player, and it fanned them over a full circle — so whichever way the
     * commander happened to be facing, about one man in six was placed in the
     * wedge a lightsaber sweeps through, holding a blaster, on the frame an
     * area opened.
     *
     * Forty facings, the whole roster each time, through the real `deploy`.
     */
    const { world } = await boot('command', 'colosseum');
    const { inSwingArc, SWING_REACH, SWING_HALF_ARC } = await import('../../src/game/Spawn.js');
    const d = world.command;
    assert(d && d.roster.living.length >= 4,
      `the command mode booted with ${d?.roster?.living?.length ?? 0} troopers — nothing to place`);
    const p = world.player;
    let placed = 0, inside = 0, closest = Infinity;
    for (let trial = 0; trial < 40; trial++) {
      p.facing = trial * (Math.PI * 2 / 40);
      for (const t of d.roster.living) { if (t.body) { t.body.dead = true; t.body = null; } }
      d.deploy(d.commander, { byShip: false });
      for (const t of d.roster.living) {
        if (!t.body) continue;
        placed++;
        const q = t.body.position;
        if (inSwingArc(p, q.x, q.z)) inside++;
        closest = Math.min(closest, Math.hypot(q.x - p.position.x, q.z - p.position.z));
      }
    }
    assert(placed >= 200, `only ${placed} bodies were placed — the sweep is not measuring anything`);
    assert(inside === 0,
      `${inside} of ${placed} deployed troopers stand inside the commander's swing — `
      + `within ${SWING_REACH} m and ${(SWING_HALF_ARC * 2 * 180 / Math.PI).toFixed(0)}° of their facing. `
      + 'That is the player\'s "you spawn with your allies in front of your saber".');
    return `${placed} placements across 40 facings, 0 in the swing arc, nearest ${closest.toFixed(2)} m`;
  });

  check('placement: an arrival never picks a landing site inside the blade', async () => {
    /* The other door every body in the game comes through. `near` is the
     * Command mode's own reinforcement flight at 18 m, which is far outside a
     * swing — so this drives it at 8, which is not, because a placement law
     * that is only true at the ranges the current callers happen to use is not
     * a law. `_sitePoint` is the shipped picker; nothing is restated. */
    const { world } = await boot('skirmish', 'colosseum');
    const { inSwingArc } = await import('../../src/game/Spawn.js');
    const air = world.director.arrivals;
    assert(air, 'the wave director has no ArrivalDirector');
    const THREE = await import('three');
    const p = world.player;
    let n = 0, inside = 0;
    for (let trial = 0; trial < 30; trial++) {
      p.facing = trial * 0.21;
      for (let k = 0; k < 20; k++) {
        const out = new THREE.Vector3();
        air._sitePoint(4.4, 8.0, out);
        n++;
        if (inSwingArc(p, out.x, out.z)) inside++;
      }
    }
    assert(inside === 0, `${inside} of ${n} landing sites were inside the commander's swing`);
    return `${n} landing sites drawn at 4.4–8.0 m from the commander, 0 in the swing arc`;
  });

  check('placement: the law itself has teeth — a full circle at 4 m does not pass it', async () => {
    /**
     * THE CONTROL, and it is the check on the check.
     *
     * A predicate that answers "clear" to everything would make both checks
     * above pass and would be worse than no check at all. This is the ring the
     * game USED to deploy on — `(i / n) * TAU`, r = 4 + (i % 3) * 2.2 — and the
     * property must be false of it. If this ever passes, `bladeClear` has been
     * widened into a tautology and the two checks above are decoration.
     */
    const { inSwingArc, SWING_REACH } = await import('../../src/game/Spawn.js');
    const p = { position: { x: 0, y: 0, z: 0 }, facing: 0, alive: true };
    let n = 0, inside = 0;
    for (let trial = 0; trial < 40; trial++) {
      p.facing = trial * (Math.PI * 2 / 40);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = 4 + (i % 3) * 2.2;
        n++;
        if (inSwingArc(p, Math.sin(a) * r, Math.cos(a) * r)) inside++;
      }
    }
    assert(inside > n * 0.08,
      `the old full-circle ring put only ${inside} of ${n} bodies in the swing — `
      + `bladeClear has been widened until it refuses nothing (reach ${SWING_REACH} m)`);
    return `${inside} of ${n} on the pre-fix ring are inside the wedge — the predicate discriminates`;
  });

  /* ══ B — a ground change is never instant ══════════════════════════ */

  check('the ground does not change on the frame the last enemy dies', async () => {
    /**
     * THE DEFECT, EXACTLY AS THE PLAYER MET IT. `_groundPending` is written by
     * `_skirmishCleared` and `_advanceMission` and read by `World.update` at
     * the top of the next frame; before this work that read called `rotateTo`
     * and the planet changed inside one 16 ms step.
     *
     * Set here the same way both producers set it — that is the seam, not a
     * restatement of one — and then stepped for a whole second, which is sixty
     * chances for something to teleport.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const was = world.levelKey;
    world._groundPending = 'drifts';
    world.update(1 / 60, input);
    assert(world.levelKey === was,
      `the ground changed from ${was} to ${world.levelKey} on the frame after the clear — `
      + 'this is the instant teleport the player reported, unchanged');
    assert(world.extraction?.active, 'no extraction started; the change was simply dropped');
    assert(world.extraction.phase === 'aftermath',
      `the sequence opened in '${world.extraction.phase}' rather than standing in the aftermath`);
    const t = until(world, input, 1.0, () => world.levelKey !== was);
    assert(world.levelKey === was,
      `the ground changed ${t.toFixed(2)} s after the clear — there is no beat`);
    return `60 frames after the last enemy fell the commander is still on ${world.levelKey}, in the aftermath`;
  });

  check('the aftermath is empty — nothing is in the sky for the first seconds', async () => {
    const { world, input } = await boot('skirmish', 'colosseum');
    const X = await import('../../src/game/Extraction.js');
    world._groundPending = 'drifts';
    let sawShip = -1;
    until(world, input, X.AFTERMATH - 0.2, () => false, (w, t) => {
      if (sawShip < 0 && w.extraction.group) sawShip = t;
    });
    assert(sawShip < 0,
      `a transport existed ${sawShip.toFixed(2)} s in, before the ${X.AFTERMATH} s aftermath was over`);
    assert(world.extraction.phase === 'aftermath',
      `the aftermath ended early, in '${world.extraction.phase}'`);
    return `${X.AFTERMATH.toFixed(1)} s of aftermath with no ship, no rotation and the field to yourself`;
  });

  check('extraction: the whole journey is played, and the level change happens inside it', async () => {
    /**
     * ONE FULL EXTRACTION, END TO END, WITH A COMMANDER WHO WALKS.
     *
     * The phase order is read off `ExtractionDirector.log`, which the director
     * writes as it enters each phase and which carries the level key at the
     * moment of the swap. Three separate things are asserted about it and each
     * one is a different way the feature could be a lie:
     *
     *   the phases happen, in order, and none is skipped;
     *   the SWAP is inside `transit` — not before boarding (a teleport with a
     *     ship in front of it) and not after landing (a teleport with a ship
     *     behind it);
     *   the run survives, which is `rotateTo`'s own contract and is the thing
     *     that would break first if the rotate were moved somewhere new.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const X = await import('../../src/game/Extraction.js');
    world.score = 4321;
    world.player.kills = 7;
    const was = world.levelKey;
    world._groundPending = 'drifts';
    const t = until(world, input, 90, (w, tt) => !w.extraction.active && tt > 1, walkToRamp);
    const log = world.extraction.log;
    const order = log.filter(e => X.PHASES.includes(e.phase)).map(e => e.phase);
    for (const want of ['aftermath', 'called', 'inbound', 'boarding', 'liftoff', 'transit', 'descent', 'unload', 'done']) {
      assert(order.includes(want), `the '${want}' phase never happened — got ${order.join(' → ')}`);
    }
    const seq = ['aftermath', 'called', 'inbound', 'boarding', 'liftoff', 'transit', 'descent', 'unload', 'done'];
    assert(order.join(',') === seq.join(','), `phases out of order: ${order.join(' → ')}`);
    const swap = log.find(e => e.phase === 'swap');
    const transit = log.find(e => e.phase === 'transit');
    const descent = log.find(e => e.phase === 'descent');
    assert(swap, 'the level never changed inside the flight');
    assert(swap.at > transit.at && swap.at < descent.at,
      `the ground changed at ${swap.at.toFixed(2)} s, outside the cruise `
      + `(${transit.at.toFixed(2)}–${descent.at.toFixed(2)} s) — that is a teleport with an aircraft near it`);
    assert(world.levelKey === 'drifts',
      `the journey finished on ${world.levelKey} rather than the ground it was flying to`);
    assert(world.levelKey !== was, 'the ground never changed at all');
    assert(world.score === 4321, `the run did not survive the flight: score ${world.score}`);
    assert(world.player && world.player.alive, 'no commander came off the ramp');
    const beats = log.map(e => `${e.phase}@${e.at.toFixed(1)}`).join(' ');
    return `${t.toFixed(1)} s, ${was}→${world.levelKey}, swap at ${swap.at.toFixed(1)} s inside the cruise · ${beats}`;
  });

  check('extraction: the commander is aboard the transport for the whole journey', async () => {
    /**
     * "get transported out (seeing the whole time in the trooper carrier etc.)"
     *
     * Three things, measured every frame of the three airborne phases: the
     * commander is RIDING (so `Player._move` is not walking them), the
     * commander is inside the hull (so they are in the bay and not towed behind
     * it), and the commander is well clear of the ground (so the flight is a
     * flight). The last one is also what proves the ship is not simply parked:
     * a stationary prop would satisfy the first two.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    world._groundPending = 'drifts';
    let frames = 0, notRiding = 0, offShip = 0, maxAlt = 0, worst = 0;
    until(world, input, 90, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      const X = w.extraction;
      if (!X.aboard || !w.player || !X.group) return;
      frames++;
      if (!w.player.riding) { notRiding++; return; }
      const d = w.player.position.distanceTo(X.group.position);
      if (d > 5) { offShip++; worst = Math.max(worst, d); }
      const alt = w.terrain ? w.player.position.y - w.terrain.height(w.player.position.x, w.player.position.z) : 0;
      maxAlt = Math.max(maxAlt, alt);
    });
    assert(frames > 600, `only ${frames} airborne frames — the flight is too short to be a journey`);
    assert(notRiding === 0, `${notRiding} of ${frames} airborne frames had the commander not riding anything`);
    assert(offShip === 0, `${offShip} airborne frames had the commander ${worst.toFixed(1)} m from the hull`);
    assert(maxAlt > 30, `the transport never got above ${maxAlt.toFixed(1)} m — that is not a journey`);
    return `${frames} frames in the bay, never more than 5 m off the hull, ${maxAlt.toFixed(0)} m up at the top`;
  });

  check('extraction: your line rides with you and walks off the ramp, not into your blade', async () => {
    /**
     * "your reinforcements still teleport in next to you, they don't arrive via
     * transport" — and the other half of the same sentence, which is where they
     * end up standing when they get there.
     *
     * `_release` fans them off the ramp and `nudgeFromSwing` is the backstop.
     * The assertion is on the FINAL positions, on the new ground, after the
     * sequence has finished: this is the exact moment the player described.
     */
    const { world, input } = await boot('command', 'geonosis');
    const { inSwingArc } = await import('../../src/game/Spawn.js');
    world._groundPending = 'drifts';
    let rode = 0;
    until(world, input, 90, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      if (w.extraction.phase === 'transit' && w.extraction._seated.length) rode = Math.max(rode, w.extraction._seated.length);
      walkToRamp(w);
    });
    const p = world.player;
    assert(p && p.alive, 'no commander came off the ramp');
    const mine = world.enemies.filter(e => !e.dead && e.team === p.team);
    assert(mine.length > 0, 'the line did not survive the journey — nobody is on the new ground');
    const inside = mine.filter(e => inSwingArc(p, e.position.x, e.position.z));
    assert(inside.length === 0,
      `${inside.length} of ${mine.length} of your own men are standing in your swing arc `
      + 'the moment you get off the transport');
    for (const e of mine) {
      assert(!e.riding, 'a trooper is still riding a transport that has gone');
      assert(e.speed > 0, 'a trooper came off the ramp with its legs still switched off');
    }
    return `${rode} men rode the bay, ${mine.length} standing on the new ground, 0 in the commander's swing`;
  });

  check('extraction: the cruise cannot be skipped into a stall', async () => {
    /**
     * The skip is the answer to "a long unskippable cutscene every round is its
     * own failure mode", and its gate is the whole reason it is safe: the
     * cruise may only be collapsed once the rotate has LANDED, so pressing the
     * key early can never put the player in front of the rebuild it was there
     * to hide. Driven with the key held from the first frame.
     */
    const { world, H } = await boot('skirmish', 'colosseum');
    const X = await import('../../src/game/Extraction.js');
    const held = { ...H.idleInput(), act: (a) => a === 'jump' };
    world._groundPending = 'drifts';
    let skipAt = null, swapAt = null;
    until(world, held, 90, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      const L = w.extraction.log;
      if (skipAt === null) skipAt = L.find(e => e.phase === 'skip')?.at ?? null;
      if (swapAt === null) swapAt = L.find(e => e.phase === 'swap')?.at ?? null;
      walkToRamp(w);
    });
    const L = world.extraction.log;
    const skip = L.find(e => e.phase === 'skip');
    const swap = L.find(e => e.phase === 'swap');
    assert(skip, 'the jump key was held through the whole cruise and the skip never took');
    assert(swap, 'the ground never changed');
    assert(skip.at >= swap.at,
      `the cruise was skipped at ${skip.at.toFixed(2)} s, before the swap landed at ${swap.at.toFixed(2)} s — `
      + 'the player can put themselves in front of the rebuild');
    assert(world.levelKey === 'drifts', `a skipped journey finished on ${world.levelKey}`);
    const done = L.find(e => e.phase === 'done');
    return `held from frame one: skip took at ${skip.at.toFixed(1)} s, after the swap at ${swap.at.toFixed(1)} s, `
      + `whole sequence ${done.at.toFixed(1)} s`;
  });

  check('extraction: nobody is left on the ground when the ship will not wait forever', async () => {
    /**
     * THE CO-OP RULE AND THE SOLO ANTI-STALL ARE ONE MECHANISM. A commander who
     * never walks holds the transport for `LAST_CALL` seconds and is then
     * HAULED aboard over `PULL` seconds — a slide at walking pace, which is the
     * only way this file is allowed to end a stall, because it is the only one
     * you can watch happen to you.
     *
     * Driven with a commander who does nothing at all, which is also the shape
     * of a disconnected co-op peer.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const X = await import('../../src/game/Extraction.js');
    world._groundPending = 'drifts';
    const t = until(world, input, 120, (w, tt) => !w.extraction.active && tt > 1);
    assert(world.levelKey === 'drifts',
      `an idle commander stalled the whole mode: still on ${world.levelKey} after ${t.toFixed(0)} s`);
    const board = world.extraction.log.find(e => e.phase === 'boarding');
    const lift = world.extraction.log.find(e => e.phase === 'liftoff');
    const waited = lift.at - board.at;
    assert(waited >= X.LAST_CALL,
      `the ship left after ${waited.toFixed(1)} s of waiting, before its own last call at ${X.LAST_CALL} s`);
    assert(waited <= X.LAST_CALL + X.PULL + 0.5,
      `the ship waited ${waited.toFixed(1)} s — the haul is not bounded`);
    return `an idle commander is hauled aboard after ${waited.toFixed(1)} s and the mode never stalls`;
  });

  check('extraction: instantSpawn is the one opt-out, and it restores the old door', async () => {
    /* The same single reader `Waves.instantSpawn` gives. A second setting
     * meaning "I want things to simply appear" is the hand-maintained twin
     * HANDOFF §2.3 is about, so there is not one. */
    const { world, input } = await boot('skirmish', 'colosseum', { instantSpawn: true });
    const was = world.levelKey;
    world._groundPending = 'drifts';
    world.update(1 / 60, input);
    assert(!world.extraction.active, 'instantSpawn was set and a journey was flown anyway');
    assert(world.levelKey === 'drifts',
      `instantSpawn was set and the ground did not change on the frame: still ${world.levelKey}`);
    return `instantSpawn: ${was}→${world.levelKey} in one frame, exactly as before`;
  });

  check('extraction: the beat sheet is derived, and this is it', async () => {
    /**
     * THE NUMBER THE BRIEF ASKED FOR, printed by the game rather than typed
     * into a report. `beatSheet()` is built from the same exported constants
     * the director runs on, so a retune moves this line and a report that
     * quotes it stays true — which is the whole of HANDOFF §2.3.
     */
    const X = await import('../../src/game/Extraction.js');
    const full = X.beatSheet();
    const skipped = X.beatSheet({ skip: true });
    const total = X.extractionSeconds();
    assert(total > 25 && total < 55, `one extraction is ${total} s, which is not a journey or is a film`);
    assert(X.SWAP_AT + X.VEIL_HOLD < X.TRANSIT_MIN,
      `the shortest cruise (${X.TRANSIT_MIN}s) cannot contain the swap and its cloud `
      + `(${(X.SWAP_AT + X.VEIL_HOLD).toFixed(1)}s) — a skipped journey would show the rebuild`);
    const line = full.map(r => `${r.phase} ${r.at.toFixed(1)}–${r.until.toFixed(1)}`).join(' · ');
    return `${total.toFixed(1)} s full, ${X.extractionSeconds({ skip: true }).toFixed(1)} s skipped — ${line}`;
  });
}
