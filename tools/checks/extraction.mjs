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
/**
 * A COMMANDER WHO WALKS ABOARD — and it walks INTO THE BAY, not to a point
 * beside the hull.
 *
 * That change is the check-side half of the player's note: "you don't even walk
 * into the ship you touch it and teleport in I guess?". `BOARD_RADIUS` used to
 * be a 3.2 m sphere at the ramp's foot and anything inside it was snapped into
 * a seat, so a drive that stopped AT the ship boarded it. `_inBay` is a box the
 * ship publishes, so the only way to be aboard is to be inside — and the walk
 * has to climb the ramp to get there, tracking the deck height as it goes,
 * exactly as a real one does.
 */
function walkToRamp(world) {
  const X = world.extraction;
  if (!X || !X.group || !world.player) return;
  if (X.phase !== 'boarding' && X.phase !== 'opening') return;
  const p = world.player.position;
  /* Aim at the ramp's foot until we are behind the ship, then at the middle of
   * the bay — which is the two-leg path the troopers take. */
  const foot = X._ramp().clone();
  const inside = X._bayPoint().clone();
  const dFoot = Math.hypot(foot.x - p.x, foot.z - p.z);
  const to = dFoot > 1.6 ? foot : inside;
  const dx = to.x - p.x, dz = to.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const step = Math.min(d, 4.6 / 60);
  p.x += dx / d * step;
  p.z += dz / d * step;
  const deck = X._deckHeight(p);
  if (deck !== null) p.y += (deck - p.y) * 0.35;
  else if (world.terrain) p.y = world.terrain.height(p.x, p.z);
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
    /* ELEVEN BEATS NOW, AND TWO OF THEM HAPPEN TWICE. The player asked for the
     * ramp and the doors by name — "the transports land, you see a large ramp
     * come out, then the side doors slide open, the troops file in… then you
     * land, and can only disembark when the ramp comes back out, then the ramp
     * retracts once the troops are out, the side doors close, then the ships
     * leave" — so `opening` and `sealing` run on BOTH legs, which is what makes
     * "you cannot get out before the ramp is down" a phase rather than a hope.
     * They are named for what they do rather than for where they happen, and
     * `director.leg` is what says which side of the journey a given one is. */
    const seq = ['aftermath', 'called', 'inbound', 'opening', 'boarding', 'sealing',
      'liftoff', 'transit', 'descent', 'opening', 'unload', 'sealing', 'done'];
    for (const want of new Set(seq)) {
      assert(order.includes(want), `the '${want}' phase never happened — got ${order.join(' → ')}`);
    }
    assert(order.join(',') === seq.join(','), `phases out of order: ${order.join(' → ')}`);
    /* AND THE RAMP IS DOWN BEFORE ANYBODY USES IT, on both legs — the property
     * the two new phases exist for, stated as an ordering rather than as their
     * presence. */
    assert(order.indexOf('opening') < order.indexOf('boarding'),
      'boarding began before the ramp came out');
    assert(order.lastIndexOf('opening') < order.indexOf('unload'),
      'the bay unloaded before the ramp came back out — "you can only disembark when the ramp comes back out"');
    assert(order.indexOf('sealing') < order.indexOf('liftoff'),
      'the ship lifted with the bay still open');
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
    /* THE BOUND CARRIES THE SEAL NOW. An idle commander holds the ship twice:
     * `LAST_CALL` for the walk they never took, then `BLADE_WAIT` for the blade
     * they never put away — and the seal itself is `HATCH` of travel. Every one
     * of those is a bounded number and this is their sum, so a stall stays a
     * pause and cannot become a hang. */
    const bound = X.LAST_CALL + X.PULL + X.BLADE_WAIT + X.HATCH + 0.6;
    assert(waited <= bound,
      `the ship waited ${waited.toFixed(1)} s against a bound of ${bound.toFixed(1)} — the haul is not bounded`);
    return `an idle commander is hauled aboard after ${waited.toFixed(1)} s and the mode never stalls`;
  });

  /* ══ D — the withdrawal ════════════════════════════════════════════ */

  check('withdrawal: the ship is asked for by holding, and a bounce cannot ask', async () => {
    /**
     * THIS IS THE ONE ENDING THE PLAYER CHOOSES, and there is no undo on it.
     * Every other way a run stops happens TO you — you die, or you clear the
     * last wave. `withdraw` ends it on purpose and takes home whoever reached
     * the ramp, which is the whole reason a company can persist between runs
     * at all: a roster that is only ever wiped is a save file that reads zero.
     *
     * So it is HELD, and this asserts the three properties that makes it have:
     * a tap does nothing, letting go throws the progress away, and the hold is
     * the number `WITHDRAW_HOLD` names rather than one written here.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const W = await import('../../src/game/World.js');
    let holding = false;
    input.act = (id) => (id === 'withdraw' ? holding : false);

    // a tap: two frames, then let go
    holding = true;
    world.update(1 / 60, input); world.update(1 / 60, input);
    const afterTap = world.withdrawHold;
    holding = false;
    world.update(1 / 60, input);
    assert(world.withdrawHold === 0,
      `letting go left ${world.withdrawHold.toFixed(2)} of the hold banked — a run can be ended in two taps`);
    assert(!world.extraction.active, 'a two-frame tap called the ship');

    // most of the way, then let go
    holding = true;
    until(world, input, W.WITHDRAW_HOLD * 0.8, () => false);
    const nearly = world.withdrawHold;
    assert(nearly > 0.6 && nearly < 1,
      `${(W.WITHDRAW_HOLD * 0.8).toFixed(2)} s of a ${W.WITHDRAW_HOLD} s hold read ${nearly.toFixed(2)}`);
    assert(!world.extraction.active, 'the ship was called before the hold was finished');
    holding = false;
    world.update(1 / 60, input);
    assert(world.withdrawHold === 0, 'the hold survived a release');

    // and the whole way
    holding = true;
    const t = until(world, input, W.WITHDRAW_HOLD + 0.5, (w) => w.extraction.active);
    assert(world.extraction.active, `held for ${t.toFixed(2)} s and no ship was called`);
    assert(t >= W.WITHDRAW_HOLD - 0.05,
      `the ship came at ${t.toFixed(2)} s against a stated hold of ${W.WITHDRAW_HOLD} s`);

    /* AND IT OPENS ON THE CALL, NOT ON THE AFTERMATH. `AFTERMATH` is five
     * seconds of standing in a quiet field working out that you won. Nobody
     * withdrawing has won anything and people are still shooting. */
    const first = world.extraction.log[0];
    assert(first.phase === 'called',
      `a withdrawal opened on "${first.phase}" — the five-second aftermath is for a field you cleared`);
    assert(world.extraction.withdrawing, 'the sequence does not know it is a withdrawal');
    return `tap 0.00 · ${(W.WITHDRAW_HOLD * 0.8).toFixed(1)}s → ${nearly.toFixed(2)} released to 0 · called at ${t.toFixed(2)}s, on "${first.phase}"`;
  });

  check('withdrawal: the run ends on the climb, and the manifest is who got aboard', async () => {
    /**
     * THE MEN ON THE SHIP ARE THE OUTCOME. A withdrawal has no next ground —
     * `nextKey` is null, so `transit` and the rotate it carries are never
     * reached and the liftoff IS the ending. What it hands out is the passenger
     * list, and the layer that persists the company keeps that and nothing
     * else.
     *
     * A MAN LEFT BEHIND IS NOT A MAN KILLED, and this is the assertion that
     * matters most. He is simply not on the manifest. Writing a death for him
     * would put him on the memorial roll beside men who actually fell, which is
     * a different fact about a different afternoon.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const was = world.levelKey;
    let holding = true;
    input.act = (id) => (id === 'withdraw' ? holding : false);
    let ended = null;
    world.onGameOver = (st) => { ended = st; };

    until(world, input, 4, (w) => w.extraction.active);
    holding = false;

    /* ONE MAN SENT TO THE FAR END OF THE FIELD, and he is the control. He
     * cannot reach the ramp inside `LAST_CALL` from there, so if the manifest
     * counts him the manifest is counting the roster rather than the ship. */
    const team = world.player.team;
    const mine = world.enemies.filter((e) => !e.dead && e.team === team);
    const stranded = mine[mine.length - 1] || null;
    if (stranded) {
      stranded.position.set(160, world.terrain.height(160, 160), 160);
      stranded._syncBody?.();
    }

    const t = until(world, input, 140, (w) => w.over, walkToRamp);
    assert(world.over, `the withdrawal never ended the run — ${t.toFixed(0)} s, phase "${world.extraction.phase}"`);
    assert(world.levelKey === was,
      `a withdrawal rotated the ground to ${world.levelKey} — it has no next ground to go to`);
    assert(ended, 'the run ended and nothing was told');
    assert(ended.ended === 'withdrew',
      `the card was told the run ended as "${ended.ended}"`);
    assert(Array.isArray(world.manifest), 'no manifest was written');
    assert(ended.extracted === world.manifest.length,
      `the card says ${ended.extracted} extracted against a manifest of ${world.manifest.length}`);
    if (stranded) {
      assert(!stranded.dead,
        'the man who could not reach the ramp was marked DEAD — he was left behind, which is not the same thing');
      assert(!world.manifest.includes(stranded.trooper),
        'a man 160 m from the pad is on the passenger list');
    }
    /* AND THE MEN WHO COULD REACH IT DID. This is the assertion the feature is
     * for and it was absent while the feature did not work: driven on the
     * drifts, the colosseum and alpine the manifest is 10 of 10, and on
     * geonosis — whose spawn ring is 58-96 m against everybody else's 26-60 —
     * it is 6. So the bound is "most of a line that is with you", not "all of
     * any line anywhere", and the one ground that misses it misses it for a
     * reason a player can see: his men were further away when he called. */
    assert(world.manifest.length >= Math.min(4, mine.length),
      `${world.manifest.length} of ${mine.length} reached the ramp — the ship is leaving without the line again`);
    const lift = world.extraction.log.find((e) => e.phase === 'liftoff');
    assert(lift, 'the run ended without the ship ever lifting off');
    assert(!world.extraction.log.some((e) => e.phase === 'transit' || e.phase === 'swap'),
      'a withdrawal flew a cruise and asked for a ground swap');
    return `${t.toFixed(0)} s · ${ended.extracted} aboard, ${ended.leftBehind} left · ended "${ended.ended}" on ${world.levelKey}, no swap`;
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

  /* ══ E — what the player found by riding in it ══════════════════════ */

  check('transport: you WALK aboard — nothing is ever teleported into the bay', async () => {
    /**
     * THE PLAYER: "you don't even walk into the ship you touch it and teleport
     * in I guess? you need to do a lot better."
     *
     * They were describing two separate jumps and this measures both.
     *
     *   THE ADMISSION was `BOARD_RADIUS = 3.2` — a sphere at the ramp's foot,
     *     outside the hull. Anything inside it was aboard, so you never entered
     *     the ship, you brushed a bubble beside it. It is `_inBay` now: a box
     *     the ship itself publishes.
     *   THE SEAT was a fixed local offset the body SNAPPED to. `_seat` takes
     *     where the body already is, in the ship's frame, and eases it to the
     *     seat over SETTLE seconds.
     *
     * Stated as the property that covers both and cannot be satisfied by
     * either old path: NO BODY MOVES MORE THAN A WALKING PACE IN ONE FRAME,
     * from the moment the ramp comes out to the moment the bay is sealed.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const X = await import('../../src/game/Extraction.js');
    world._groundPending = 'drifts';
    const watched = new Map();
    let worst = 0, who = '', worstPhase = '';
    const jumps = [];
    until(world, input, 90, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      walkToRamp(w);
      const x = w.extraction;
      if (!x?.active) return;
      const phase = x.phase;
      const watching = phase === 'opening' || phase === 'boarding' || phase === 'sealing';
      /* THE HISTORY IS DROPPED BETWEEN WATCHED PHASES, and without this the
       * check manufactures its own defect (HANDOFF §2.4). `opening`/`boarding`/
       * `sealing` run on BOTH legs with a whole flight and a level change in
       * between, so a body's last watched position is on the OLD GROUND and the
       * first frame of the inbound `sealing` reads as a nine-metre jump that
       * nothing in the game did. */
      if (!watching) { watched.clear(); return; }
      const bodies = [...w.players, ...w.enemies.filter((e) => !e.dead && e.team === w.partyTeam)];
      for (const b of bodies) {
        if (!b) continue;
        const prev = watched.get(b);
        watched.set(b, b.position.clone());
        if (!prev || !watching) continue;
        /* A RIDING BODY MOVES WITH THE SHIP, so its world delta is the ship's.
         * The property is about bodies under their own power, which is every
         * body on the ground and the ones easing to a seat in the ship's own
         * frame — both of which `_flyPassengers` leaves stationary in world
         * terms while the ship is parked. */
        const d = prev.distanceTo(b.position);
        if (d > worst) { worst = d; who = b.name || b.type || 'body'; worstPhase = phase; }
        if (d > 0.35) jumps.push(`${b.name || b.type} ${d.toFixed(2)} m in ${phase}`);
      }
    });
    assert(world.levelKey === 'drifts', `the journey did not finish — still on ${world.levelKey}`);
    /* 0.35 m IN ONE FRAME is 21 m/s at 60 Hz, which is three times a sprint and
     * two orders below the three-metre snap the old seat performed. The bound
     * is a pace and not an epsilon because bodies are also being pushed apart
     * by the crowd solver while they queue. */
    assert(!jumps.length,
      `${jumps.length} body-frames jumped further than a walking pace: ${jumps.slice(0, 4).join('; ')}`);
    assert(X.BOARD_RADIUS < 2.5,
      `BOARD_RADIUS is ${X.BOARD_RADIUS} — a door's width, not a bubble you brush`);
    return `worst single frame ${worst.toFixed(3)} m (${who}, ${worstPhase || 'n/a'}) — nothing snapped`;
  });

  check('transport: it flies nose-first, and it does not fly through the ground', async () => {
    /**
     * TWO OF THE PLAYER'S NOTES, and both were true of every flight.
     *
     * "they fly backwards a lot" — every phase set the heading to
     * `padYaw + PI/2 + PI`, a constant off the bearing the PAD was picked on,
     * and then moved the hull along `-(cos padYaw, sin padYaw)`. Those are 180°
     * apart: the ship climbed out and cruised to the next planet tail first.
     *
     * "Also the ships fly straight through mountains a lot" — the paths are
     * lerps between two points chosen for their ground-level geometry and
     * nothing ever asked what was between them.
     *
     * Measured on the real flight, every frame the ship is moving: the angle
     * between the nose and the velocity, and the height of the hull over the
     * terrain under it.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    const X = await import('../../src/game/Extraction.js');
    world._groundPending = 'drifts';
    let prev = null, prevPhase = null, worstAngle = 0, backwards = 0, moving = 0;
    let lowest = Infinity, buried = 0;
    until(world, input, 90, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      walkToRamp(w);
      const x = w.extraction;
      if (!x?.active || !x.group) { prev = null; return; }
      const g = x.group;
      const p = g.position.clone();
      /* A PHASE BOUNDARY MAY PLACE THE HULL and a placement is not a course.
       * `_approach` puts the ship 150 m from where the cruise ended, and the
       * one frame across that jump has a "velocity" of a hundred metres in a
       * direction the ship never flew. The director resets its own heading
       * history at exactly the same points (see `_makeShip` and `_approach`),
       * so this is the check agreeing with the thing it measures rather than
       * excusing it. */
      if (x.phase !== prevPhase) { prevPhase = x.phase; prev = p; return; }
      if (prev) {
        const vx = p.x - prev.x, vz = p.z - prev.z;
        const sp = Math.hypot(vx, vz);
        /* Only while it is actually travelling — a parked ship has no heading
         * to be wrong about, and the flare has the nose deliberately up. */
        if (sp > 0.08) {
          moving++;
          const nose = Math.atan2(Math.sin(g.rotation.y + Math.PI), Math.cos(g.rotation.y + Math.PI));
          const course = Math.atan2(vx, vz);
          let d = Math.abs(((nose - course + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          worstAngle = Math.max(worstAngle, d);
          if (d > Math.PI / 2) backwards++;
        }
      }
      prev = p;
      /* NEAR ITS OWN PAD THE SHIP IS SUPPOSED TO BE LOW — it is landing on it,
       * parked on it, or leaving it, and `down` is deliberately 1.15 m off the
       * deck. `CLEARANCE` is about the ground BETWEEN two pads, which is where
       * the mountain the player flew through was. 60 m is past the flare and
       * past the climb-out at both ends. */
      if (w.terrain && (!x.down || p.distanceTo(x.down) > 60)) {
        const over = p.y - w.terrain.height(p.x, p.z);
        lowest = Math.min(lowest, over);
        if (over < X.CLEARANCE * 0.4) buried++;
      }
    });
    assert(world.levelKey === 'drifts', `the journey did not finish — still on ${world.levelKey}`);
    assert(moving > 60, `only ${moving} moving frames — the flight is too short to measure`);
    assert(!backwards,
      `${backwards} of ${moving} moving frames had the nose more than 90° off the course — that is "they `
      + 'fly backwards a lot", and it is what `_face` exists to stop');
    assert(!buried,
      `${buried} frames en route put the hull within ${(X.CLEARANCE * 0.4).toFixed(0)} m of the terrain `
      + `under it (lowest ${lowest.toFixed(1)} m) — the ship is flying through the ground`);
    assert(X.CLEARANCE >= 10, `CLEARANCE is ${X.CLEARANCE} m, which is inside the hull`);
    return `${moving} moving frames, worst nose-to-course ${(worstAngle * 180 / Math.PI).toFixed(0)}°, `
      + `lowest ${lowest.toFixed(0)} m over the ground`;
  });

  check('transport: the bay has an inside, a ramp, two doors and two pilots', async () => {
    /**
     * "the transports are closed at the sides, you can't see yourself or your
     * troops it's completely blocked… You should be able to see the pilots too."
     *
     * The old hull could not answer that: `buildGunship`'s troop bay is a 10 cm
     * dark PLATE between two rails, with no aperture and no volume. This holds
     * the replacement to having the four things the note asks for, and holds
     * the bay to being big enough to stand up in — because a bay with 1.1 m of
     * head clearance is a bay whose "you can either sit or stand" is a lie.
     */
    const THREE = await import('three');
    const { buildTransport } = await import('../../src/game/Vehicles.js');
    const g = buildTransport();
    const u = g.userData;
    assert(u.ramp, 'the transport has no ramp');
    assert(u.doorL && u.doorR, 'the transport has fewer than two doors');
    assert(g.getObjectByName('pilotL') && g.getObjectByName('pilotR'), 'nobody is flying it');
    assert(u.engines.length >= 4, `${u.engines.length} engine anchor(s) — the nacelles carry four nozzles`);
    const bay = u.bay;
    assert(bay, 'the transport publishes no bay, so Extraction has nothing to seat anybody in');
    assert(bay.roof - bay.floor >= 1.9,
      `the bay is ${(bay.roof - bay.floor).toFixed(2)} m from deck to roof — a trooper cannot stand up in it`);
    assert(bay.halfW * 2 >= 2.2, `the bay is ${(bay.halfW * 2).toFixed(2)} m wide`);
    assert(u.seats.length >= 8, `${u.seats.length} places in the bay`);
    assert(u.seats.some((x) => x.sit) && u.seats.some((x) => !x.sit),
      'every place in the bay is the same kind — "you can either sit or stand"');
    /* THE DOORS AND THE RAMP MOVE. They are separate groups precisely so they
     * can, and a hull that merged them back in would pass every assertion above
     * and be the closed box the player complained about. */
    const closed = new THREE.Box3().setFromObject(g).clone();
    u.ramp.rotation.x = 0.6;
    u.doorL.position.z = 2.0;
    u.doorR.position.z = 2.0;
    g.updateMatrixWorld(true);
    const open = new THREE.Box3().setFromObject(g);
    assert(!open.equals(closed), 'moving the ramp and the doors changed nothing — they are baked into the hull');
    return `bay ${(bay.halfW * 2).toFixed(1)} x ${(bay.roof - bay.floor).toFixed(1)} m, `
      + `${u.seats.filter((x) => x.sit).length} seated + ${u.seats.filter((x) => !x.sit).length} standing, `
      + `${u.engines.length} nozzles, ramp and 2 doors that move`;
  });

  check('insertion: every map opens in a transport, coming down from orbit', async () => {
    /**
     * THE PLAYER, TWICE: "You don't start any matches coming in on a transport
     * ship with your troops, I already told you that you should never just
     * appear, ON ANY MAP… you look behind the ship flying through space and you
     * see the capitol ship getting smaller and smaller and the planet getting
     * larger and larger as you enter the atmosphere and land on your
     * battlefield. Every mode/map should start like this."
     *
     * The extraction answered the journey BETWEEN two grounds. Every mode still
     * OPENED with the commander standing on the spawn point with the level
     * already built around them, which is the thing the note is about.
     *
     * Four properties, and each is one clause of the note:
     *   you start ABOARD, not on the ground;
     *   the capital ship is astern and it RECEDES;
     *   the atmosphere arrives — the stars go out and the altitude comes off;
     *   and you end up on the ground the level chose, off a ramp, with your
     *   line beside you.
     */
    const { world, input } = await boot('skirmish', 'geonosis');
    const X = await import('../../src/game/Extraction.js');
    const flew = world.extraction.beginInsertion({ name: 'Geonosis' });
    assert(flew, 'beginInsertion declined on a world that has a player, terrain and no instantSpawn');
    assert(world.player.riding, 'the commander did not start aboard');
    /* ONE FRAME FIRST. `riding` is set by `beginInsertion` and the body is
     * carried to its seat by `_flyPassengers`, which runs inside `World.update`
     * at the top of the NEXT frame — so reading the position here reads the
     * spawn point and calls a working sequence broken. The director is right
     * and the check was early. */
    world.update(1 / 60, input);
    const start = world.player.position.clone();
    const up = start.y - world.terrain.height(start.x, start.z);
    assert(up > 1000, `the commander opened ${up.toFixed(0)} m up — this is supposed to be orbit`);
    let capNear = 0, capFar = 0, starsLit = 0, starsOut = 0;
    const phases = [];
    until(world, input, 120, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      const x = w.extraction;
      if (!x?.active) return;
      if (phases[phases.length - 1] !== x.phase) phases.push(x.phase);
      if (x._capital) {
        const d = x._capital.position.length();
        if (!capNear) capNear = d;
        capFar = d;
      }
      if (x._stars) (x._stars.material.opacity > 0.5 ? starsLit++ : starsOut++);
    });
    assert(phases[0] === 'orbit' && phases[1] === 'entry',
      `the opening went ${phases.slice(0, 3).join(' → ')} — orbit then entry is the sequence`);
    assert(phases.includes('opening') && phases.includes('unload'),
      `no ramp on the far end: ${phases.join(' → ')}`);
    assert(capFar > capNear * 4,
      `the capital ship went from ${capNear.toFixed(0)} to ${capFar.toFixed(0)} — "smaller and smaller" `
      + 'is the shot, and that is not a recession');
    assert(starsLit > 30 && starsOut > 30,
      `stars lit on ${starsLit} frames and out on ${starsOut} — the atmosphere has to arrive`);
    assert(!world.player.riding, 'the commander is still in the bay after the sequence finished');
    const end = world.player.position;
    assert(Math.abs(end.y - world.terrain.height(end.x, end.z)) < 2.5,
      'the commander did not end up standing on the ground');
    const line = world.enemies.filter((e) => !e.dead && e.team === world.partyTeam).length;
    assert(line >= 6, `${line} of the line made it onto the ground`);
    return `${phases.join(' → ')} · capital ${capNear.toFixed(0)}→${capFar.toFixed(0)} m · ${line} of yours on the sand`;
  });

  check('insertion: it can be skipped, and it still lands you off a ramp', async () => {
    /**
     * THE COST OF MEANING IT. "Every mode/map should start like this" is 34 s
     * of every deploy, and a player restarting a run for the fifth time is
     * entitled to get on with it. The same key that skips the cruise skips the
     * orbit — and what it skips is the WAITING, not the arrival: the ship still
     * flies its descent, still puts its ramp out, and you still walk off it.
     */
    const { world, input } = await boot('skirmish', 'geonosis');
    world.extraction.beginInsertion({});
    /* Holding the jump key from the first frame, which is the honest shape of
     * an impatient player. The 1.5 s guard is what stops a keypress left over
     * from the menu eating the opening. */
    const held = { ...input, act: (a) => a === 'jump' };
    let sawOrbit = 0;
    const t = until(world, held, 120, (w, tt) => !w.extraction.active && tt > 1, (w) => {
      if (w.extraction?.phase === 'orbit') sawOrbit++;
    });
    const log = world.extraction.log.map((e) => e.phase);
    assert(sawOrbit > 60, 'the orbit was skipped before the player could see it');
    assert(log.includes('descent') && log.includes('opening') && log.includes('unload'),
      `a skipped insertion still has to land: ${log.join(' → ')}`);
    assert(!world.player.riding, 'the commander is still aboard');
    assert(t < 30, `a skipped insertion took ${t.toFixed(0)} s`);
    return `skipped in ${t.toFixed(1)} s, still ${log.join(' → ')}`;
  });
  check('insertion: everybody aboard is DRAWN in the bay, not at twice their own position', async () => {
    /*
     * "When you load into a map and are on the transport ship you see through
     * the inside, but everything inside — you and your troops — is invisible
     * other than my lightsaber."
     *
     * `_flyPassengers` carried the ride's per-frame delta into `rig.root` for
     * every passenger, on the reasoning that a rig root carries its body. In a
     * SEAT it does not: while a body is riding, the animator writes its bones in
     * WORLD space and nothing re-copies the root from `position` underneath
     * them, so the delta was a second full copy of the position — for the
     * player AND for all ten allies.
     *
     * Measured on a geonosis insertion before the fix: bodies at 2400 m, every
     * pelvis drawn at (-519, 4799, -357) against a body at (-261, 2399, -176).
     * Exactly double. Two and a half kilometres above the bay, off every
     * screen — while the saber, posed straight into world space from
     * `control.handPos`, stayed exactly where it belonged and was the one thing
     * left in shot. That is the whole report, including why the blade was the
     * exception.
     *
     * The bar is a metre and a bit because a pelvis sits about 0.9 m over the
     * feet its `position` is measured at; doubling puts it kilometres out, so
     * there is no version of this that squeaks past.
     */
    const { world, input } = await boot('skirmish', 'geonosis');
    assert(world.extraction.beginInsertion({ name: 'Geonosis' }), 'beginInsertion declined');
    for (let i = 0; i < 4; i++) world.update(1 / 60, input);

    const T = (await import('three'));
    const at = new T.Vector3();
    const drawnPelvis = (b) => {
      const bone = b.rig?.get?.('pelvis') || b.rig?.get?.('hips');
      if (!bone?.obj) return null;
      bone.obj.getWorldPosition(at);
      return at.clone();
    };

    const rows = [];
    let worst = 0, worstWho = '';
    const check1 = (b, who) => {
      const p = drawnPelvis(b);
      if (!p) return;
      // horizontal only: the vertical offset IS the pelvis height and is meant.
      const d = Math.hypot(p.x - b.position.x, p.z - b.position.z);
      rows.push(`${who} ${d.toFixed(2)} m`);
      if (d > worst) { worst = d; worstWho = who; }
    };
    check1(world.player, 'commander');
    let allies = 0;
    for (const e of world.enemies) {
      if (!e.riding) continue;
      allies++;
      check1(e, `ally${allies}`);
    }
    assert(allies > 0, 'nobody was seated — the insertion did not load the bay');
    assert(worst < 1.2,
      `${worstWho} is drawn ${worst.toFixed(1)} m from its own seat — the root is taking the ride delta again `
      + 'and the body is at twice its own position, which is the invisible-in-the-bay bug');
    /* AND THE ROOT ITSELF STAYS AT ZERO, which is the mechanism rather than the
     * symptom — a body could in principle be drawn correctly by luck. */
    const roots = [world.player, ...world.enemies.filter((e) => e.riding)]
      .map((b) => b.rig?.root).filter(Boolean);
    const moved = roots.filter((r) => r.position.lengthSq() > 1e-6).length;
    assert(moved === 0, `${moved} of ${roots.length} passengers have a non-zero rig root while seated`);
    return `${allies} allies + the commander, worst drawn offset ${worst.toFixed(2)} m, all ${roots.length} roots at zero`;
  });

  check('ground change: a flight nobody is riding does not follow you to the next level', async () => {
    /*
     * "In command mode I spawned into a map where the colosseum was
     * superimposed onto the geonosis map and had no physics, it was see
     * through… actually now there's a bug where the colosseum is superimposed
     * onto every map."
     *
     * It is not the colosseum, and it is not any level's geometry. The
     * extraction's ship is parented to `scene` rather than to `statics`
     * SPECIFICALLY so that `World.unload` cannot take it — which is right while
     * a transport is flying the party from one ground to the next, and wrong
     * every other time a level changes. Every other reason took the exemption
     * too: an insertion interrupted by a rotate, a run left mid-flight, a mode
     * change under a descent.
     *
     * Measured in a real browser across one rotate, before the fix: 46 meshes
     * from the old level still in the scene, 44 of them the ship — hull,
     * capital, both pilots, both doors, ramp — with no physics and no owner,
     * drawn over every level loaded afterwards. Exactly the described symptom.
     *
     * Both halves are asserted, because the fix is a discriminator and a
     * discriminator can be wrong in two directions: a stranded flight must be
     * cleared, and a flight that IS carrying the party across the swap must
     * survive it, or the extraction deletes the transport the player is
     * standing in.
     */
    const { world, input } = await boot('skirmish', 'colosseum');
    assert(world.extraction.beginInsertion({ name: 'Colosseum' }), 'beginInsertion declined');
    for (let i = 0; i < 12; i++) world.update(1 / 60, input);
    assert(world.extraction.active, 'the insertion ended before the rotate could interrupt it');
    assert(!world.extraction.carryingBetweenGrounds,
      'an INSERTION claims to be carrying the party between grounds — it starts over the ground it lands on');

    const shipsIn = (w) => {
      let n = 0;
      w.scene.traverse((o) => { if (o.name === 'extraction') n++; });
      return n;
    };
    assert(shipsIn(world) === 1, `expected one ship in the scene during the flight, found ${shipsIn(world)}`);

    world.rotateTo('geonosis');
    for (let i = 0; i < 4; i++) world.update(1 / 60, input);
    assert(shipsIn(world) === 0,
      `the transport survived a ground change nobody was riding it through — ${shipsIn(world)} ship(s) left in the `
      + 'scene, with no physics and no owner, on top of the new level');

    /* …AND THE OTHER DIRECTION. A real extraction lifts off one ground, the
     * world changes underneath it in `transit`, and it descends onto another.
     * Deleting the ship there would put the player in mid-air. */
    const X = await import('../../src/game/Extraction.js');
    const e = world.extraction;
    for (const phase of ['liftoff', 'transit', 'descent']) {
      e.phase = phase; e.leg = 'out';
      assert(e.carryingBetweenGrounds,
        `an outbound flight in '${phase}' does not claim to be carrying the party — unload would delete it`);
      e.leg = 'in';
      assert(!e.carryingBetweenGrounds, `an INBOUND flight in '${phase}' claims to be crossing grounds`);
    }
    e.phase = 'done';
    assert(X.PHASES.includes('transit'), 'the phase names moved; this check names three of them');
    return 'a stranded insertion is cleared on the ground change; an outbound liftoff/transit/descent survives it';
  });

  check('insertion: orbit is actually OUTSIDE the atmosphere, and the air comes back', async () => {
    /*
     * "You look behind the ship flying through space and you see the capital
     * ship getting smaller and smaller and the planet getting larger… right now
     * you start in the atmosphere and never are in space."
     *
     * The flight itself was right and had been for a while — 2400 m up, the
     * capital receding 520 → 5200 m, stars on, a heat-shield glow on entry.
     * None of it could be SEEN, and a screenshot of the real game at 2400 m
     * showed why: a lit daytime sky with cloud decks, no stars readable against
     * it, no capital ship, no planet.
     *
     * Three things, none of them the flight. The far plane is the quality
     * tier's viewDist — 380/520/700/900 m — so the capital spent its whole
     * recession clipped. The fog is the level's own, opaque long before 700 m.
     * And the sky dome is drawn at full brightness whatever altitude the camera
     * is at, so 900 stars sat behind a lit sky.
     *
     * What is asserted is that orbit is vacuum and that the level gets its air
     * back — both halves, because a sequence that takes the sky away and does
     * not hand it back is a worse bug than the one being fixed.
     */
    const { world, input } = await boot('skirmish', 'geonosis');
    const eng = world.engine;
    const far0 = eng.camera.far;
    const fog0 = eng.scene.fog ? eng.scene.fog.density : null;
    assert(world.extraction.beginInsertion({ name: 'Geonosis' }), 'beginInsertion declined');

    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    assert(world.extraction.phase === 'orbit', `expected orbit, got ${world.extraction.phase}`);
    assert(eng.camera.far > 6000,
      `the far plane is ${eng.camera.far} m in orbit — CAPITAL_FAR is 5200 m, so the ship the whole shot is `
      + 'about is clipped');
    if (fog0 !== null) {
      assert(eng.scene.fog.density < fog0 * 0.05,
        `there is haze in orbit — density ${eng.scene.fog.density} against the level's ${fog0}`);
    }

    /* …AND IT ALL COMES BACK. Driven to the ground rather than restored by
     * hand, because the restore has four doors — the clock, a skip, a lost ship
     * and a level change — and a check that calls one of them proves nothing
     * about the other three. */
    until(world, input, 60, (w) => !w.extraction.active);
    assert(!world.extraction.active, 'the insertion never finished');
    assert(Math.abs(eng.camera.far - far0) < 1,
      `the far plane was left at ${eng.camera.far} instead of the level's ${far0}`);
    if (fog0 !== null) {
      assert(Math.abs(eng.scene.fog.density - fog0) < fog0 * 0.02,
        `the haze came back as ${eng.scene.fog.density} instead of ${fog0}`);
    }
    assert((world.atmosphere?.fogScale ?? 1) === 1,
      `Atmosphere.fogScale was left at ${world.atmosphere?.fogScale} — the weather is scaling a level that landed`);
    return `orbit: far ${far0} → ${Math.round(6000)}+ m and haze off; on the ground: far ${far0}, haze restored`;
  });

  check('insertion: your own blade does not kill the stick riding with you', async () => {
    /*
     * A REGRESSION I CAUSED, AND THE FIX IS NOT WHERE I FIRST PUT THE BUG.
     *
     * `SEAL_NEEDS_BLADE_DOWN` made you put the blade away before the doors
     * closed, and its subject is close quarters: a 2.4 m bay, ten bodies, one
     * plasma blade. I narrowed it to the outbound leg because on the way IN it
     * was firing after the player had walked off the ramp and confiscating the
     * blade on a battlefield — right about the message, wrong about the hazard.
     * The hazard is being ABOARD, not which way the ship is pointing.
     *
     * It stayed hidden until the passengers started being drawn where they
     * actually sit: while their capsules were a body-length out of place the
     * blade could not reach them. With both fixed, up to four of ten troopers
     * were cut to death during the descent, by the player's own blade, before
     * the ramp had opened — `transports.mjs` read "10 rode, 6 on the sand".
     *
     * So the guard lives where the harm is decided rather than in a notice:
     * while you are riding, the men riding with you are not targets. The check
     * flies a real insertion with the blade LIT the whole way, because that is
     * the case that was killing them.
     */
    const { world, input } = await boot('skirmish', 'geonosis');
    assert(world.extraction.beginInsertion({ name: 'Geonosis' }), 'beginInsertion declined');
    const allies = world.enemies.filter((e) => e.team === world.partyTeam);
    assert(allies.length >= 6, `only ${allies.length} allies aboard — too few to measure a bay hazard`);
    const hp0 = allies.map((e) => e.hp);

    /**
     * ── AND IT IS ATTRIBUTED, BECAUSE "SOMEBODY GOT HURT" IS NOT THIS RULE ──
     *
     * The first cut of this counted hit points and nothing else, and it flaked:
     * green four runs in five, then red at "1 of 10", then red again at "1 of
     * 10 KILLED" after the count had been narrowed. Ten seeds run in isolation
     * came back 0 and 0 with no `damage()` call on an ally at all, so the
     * trigger was never the bay — it is that this is a 90-second window in a
     * live skirmish and the wave director puts hostiles on the ground under a
     * descending ship. A droid shooting a trooper through an open door is not
     * the defect this check is named after, and a check that cannot tell the
     * two apart reports the wrong one at random.
     *
     * So the ledger is on the SOURCE. `damage` is the one door harm goes
     * through for a body, and it carries who dealt it; anything billed to the
     * player is this rule's business and anything else is the battle. The
     * wrapper goes on before the flight and comes off after it, in a `finally`,
     * because a prototype left patched is the next suite's ghost.
     */
    const { Enemy: EN } = await import('../../src/game/Enemy.js');
    const real = EN.prototype.damage;
    const mine = [];
    EN.prototype.damage = function (amount, point, source, kind, ...rest) {
      const before = this.hp;
      const out = real.call(this, amount, point, source, kind, ...rest);
      if (allies.includes(this) && (source === world.player || source?.owner === world.player)) {
        mine.push(`${this.name || this.type} -${Math.max(0, before - this.hp).toFixed(1)}`
          + ` (${kind || 'blade'})`);
      }
      return out;
    };

    let t = 0;
    try {
      for (let i = 0; i < 60 * 90; i++) {
        // the blade stays lit for the whole flight, which is the player's own
        // default and was the case that killed them
        world.player.saber?.ignite?.();
        world.update(1 / 60, input);
        t += 1 / 60;
        if (!world.extraction.active && t > 1) break;
      }
    } finally { EN.prototype.damage = real; }

    /* THE RULE, and it is the whole of it: nothing the commander did reached
     * his own stick. Not "nobody was hurt" — men are shot at on the way in and
     * that is the mode working. */
    assert(mine.length === 0,
      `the commander's own blade billed ${mine.length} hit(s) to the men riding with him: `
      + `${mine.slice(0, 4).join(', ')}`);
    /* …and the ship is still not a meat grinder. A wave that killed the whole
     * stick in the bay would pass the clause above and be a different defect,
     * so the gross figure stays as a witness with a band on it rather than a
     * zero. */
    const dead = allies.filter((e) => e.dead).length;
    assert(dead <= 1,
      `${dead} of ${allies.length} of your own men died during the 90 s flight — none of it billed `
      + 'to the player, so this is the wave director putting a firefight under a descending ship');
    return `${allies.length} aboard, blade lit for the whole ${t.toFixed(0)} s flight, `
      + `0 hit points billed to the commander (${dead} lost to the battle)`;
  });

}
