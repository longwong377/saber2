/**
 * BATTLEFIELD BORZ — THE SABER OFF THE HAND.
 *
 * The player, on the three things a lightsabre could not do:
 *
 *   "if you force picked up the saber off the ground and called it back to you
 *    even at the closest distance you could not pick it up in the air so I
 *    think it could be cool that once you bring it and retract it as close to
 *    yourself as possible you just pick it up from the air I think that would
 *    be really cool, in that same vein it should be possible to pick up the
 *    lightsaber with the force, turn it on or off using the force, and then
 *    with the force being able your turn/maniulate the saber anywhere you want
 *    on the battlefield within a certain distance (uses a lot of force power up
 *    etc. obviously)"
 *
 * …and on how you come to be without it in the first place:
 *
 *   "maybe if you get hit when you're out of stamina you get staggered and drop
 *    your lightsaber"
 *
 * ── THE ONE WORTH READING TWICE ─────────────────────────────────────────
 *
 * The catch was not a missing feature. Every piece of it shipped: hilts are
 * real props, the Force can grip them, the pick-up key works, and the reach is
 * a generous 1.6 m. It could not happen because the pick-up measured to
 * `player.position` — the FEET — while `_updateGrip` clamps what it holds to a
 * floor of 1.4 m in front of the CHEST. Two correct numbers, in two files,
 * describing two different points on the same body, and the gap between them
 * was 38 cm of permanent, silent failure.
 *
 * So the first check below is arithmetic on the shipped constants rather than a
 * behaviour test, because the bug was arithmetic. The rest drive a real World.
 */

import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  const P = await import('../../src/game/Player.js');
  const D = await import('../../src/game/Dropped.js');
  const { TK, HOLD_COST } = P;

  /**
   * A player on the colosseum floor with a full bar, and a droid seven metres
   * out to cut. `bootWorld` gives the real World, so `_updateGrip`, the blade
   * and the damage path are all the shipped ones.
   */
  const boot = async (opts = {}) => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(7);
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const p = world.player;
    const input = H.idleInput();
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    p.force = p.maxForce; p.hp = p.maxHp; p.stamina = p.maxStamina;
    p.aimDir.set(0, 0, -1);
    const ctx = { input, terrain: world.terrain, physics: world.physics,
      particles: world.particles, bolts: world.bolts, camera: world.engine.camera,
      time: world.time, enemies: world.enemies, players: world.players };
    const step = (n = 30) => { for (let i = 0; i < n; i++) world.update(1 / 60, input); };
    /**
     * Put the hilt in the Force directly rather than through `toggleGrip`.
     *
     * `toggleGrip` picks off the aim ray, and a check that had to line a 25 cm
     * cylinder up under the reticle would be measuring the aim cone. The pick
     * is exercised where it belongs — tools/checks/force.mjs — and what is
     * being measured here is what happens ONCE the Force has hold of a hilt.
     */
    const grab = (prop) => {
      p.gripBody = prop.body;
      p.gripDistance = p.camera.pos.distanceTo(prop.body.position);
      p._holdT = 0;
      prop.body.gravityScale = 0;
    };
    return { world, p, ctx, input, THREE, step, grab, H };
  };

  /* ────────────────────────────────────────────────────────────────────
   * 1. THE 38 CENTIMETRES
   * ──────────────────────────────────────────────────────────────────── */

  check('telekinesis: the closest the Force can hold a hilt is inside the catch, and was not', () => {
    /**
     * The two numbers that never met. `_updateGrip` clamps the hold point to
     * `out = clamp(out, 1.4, forceReach)` where `out` is measured IN FRONT OF
     * THE CHEST; the pick-up measured from the feet. So the reeled-in hilt sits
     * at the hypotenuse of (1.4 m out, 1.35 m up) from the boots.
     */
    const CHEST = 1.35, FLOOR = 1.4;
    const fromFeet = Math.hypot(FLOOR, CHEST);
    assert(fromFeet > D.PICKUP_REACH,
      `the arithmetic that made this a bug no longer holds: a reeled-in hilt is ${fromFeet.toFixed(2)} m `
      + `from the feet against a ${D.PICKUP_REACH} m reach, so it was already catchable`);
    // …and the standing-axis measure is what closes it.
    const actor = { position: { x: 0, y: 0, z: 0 }, chest: { y: CHEST } };
    const hilt = { body: { position: { x: 0, y: CHEST, z: -FLOOR } } };
    const axis = Math.sqrt(D.hiltDistanceSq(hilt, actor));
    assert(Math.abs(axis - FLOOR) < 1e-6,
      `measured to the standing axis a hilt at chest height and ${FLOOR} m out is ${axis.toFixed(2)} m away`);
    assert(axis <= TK.reach,
      `the catch reach is ${TK.reach} m and the closest the Force can bring a hilt is ${axis.toFixed(2)} m — `
      + 'still out of reach, which is the whole bug');
    // and a hilt lying at the boots is still catchable, which the old measure got right
    const onFloor = Math.sqrt(D.hiltDistanceSq({ body: { position: { x: 0.4, y: 0.1, z: 0 } } }, actor));
    assert(onFloor <= TK.reach, `a hilt at the boots measures ${onFloor.toFixed(2)} m — the floor case broke`);
    return `feet ${fromFeet.toFixed(2)} m vs reach ${D.PICKUP_REACH}; axis ${axis.toFixed(2)} m vs catch ${TK.reach}`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * 2. YOU CATCH IT OUT OF THE AIR
   * ──────────────────────────────────────────────────────────────────── */

  check('telekinesis: reeling your own hilt in with an empty hand catches it', async () => {
    const b = await boot();
    const { p } = b;
    p.swapSaber(b.ctx);                                   // put it down
    assert(p.saberDown, 'setup: the saber is still in the hand');
    const hilt = b.world.props.find(x => x.saber && !x.dead);
    assert(hilt, 'setup: nothing was dropped');
    hilt.dropAge = 9;                                     // past PICKUP_DELAY

    /* Held out at eight metres and then reeled all the way in, which is the
     * gesture the note describes: "bring it and retract it as close to yourself
     * as possible". */
    hilt.body.position.copy(p.chest).addScaledVector(p.aimDir, 8);
    b.grab(hilt);
    p.gripDistance = p.camera.pos.distanceTo(p.chest) + 1.4;   // all the way in
    for (let i = 0; i < 120 && p.saberDown; i++) { p._updateGrip(1 / 60, b.ctx); b.step(1); }

    assert(!p.saberDown, 'the hilt was reeled to the closest the Force can hold it and never reached the hand');
    assert(!p.gripBody, 'the hand took it and the Force is still paying to hold it');
    assert(hilt.dead || !b.world.props.includes(hilt), 'the hilt is in the hand AND on the ground');
    return 'reeled in from 8 m, caught out of the air, grip released';
  });

  check('telekinesis: a hilt your Force holds comes to the hand at any distance', async () => {
    const b = await boot();
    const { p } = b;
    p.swapSaber(b.ctx);
    const hilt = b.world.props.find(x => x.saber && !x.dead);
    hilt.dropAge = 9;
    hilt.body.position.copy(p.chest).addScaledVector(p.aimDir, 14);
    b.grab(hilt);
    /* Fourteen metres is well outside `TK.reach`, so the auto-catch will not
     * fire — this is the KEY doing it, which is the case where the player has
     * decided rather than the game noticing. */
    assert(Math.sqrt(D.hiltDistanceSq(hilt, p)) > TK.reach, 'setup: the hilt is already within the catch');
    p.swapSaber(b.ctx);
    assert(!p.saberDown, 'pressing the key on a hilt the Force was holding 14 m out did nothing');
    assert(!p.gripBody, 'the grip is still holding a hilt that is in the hand');
    return 'taken from 14 m out, in one press';
  });

  /* ────────────────────────────────────────────────────────────────────
   * 3. YOU LIGHT IT WITHOUT TOUCHING IT
   * ──────────────────────────────────────────────────────────────────── */

  check('telekinesis: the Force lights the hilt it is holding, and pays to keep it burning', async () => {
    const b = await boot();
    const { p } = b;
    p.swapSaber(b.ctx);
    const hilt = b.world.props.find(x => x.saber && !x.dead);
    hilt.dropAge = 9;
    hilt.body.position.copy(p.chest).addScaledVector(p.aimDir, 6);
    b.grab(hilt);
    assert(!hilt.saberLit, 'setup: the dropped hilt is already lit');

    const before = p.force;
    assert(p.igniteHeldHilt(b.ctx), 'the ignite key did nothing to a hilt the Force was holding');
    assert(hilt.saberLit, 'the hilt did not light');
    assert(hilt.saberBlade && hilt.saberBlade.visible, 'it is "lit" and there is no blade drawn');
    const paid = before - p.force;
    assert(Math.abs(paid - p._priceOf(TK.ignite)) < 0.51,
      `striking it cost ${paid.toFixed(1)} against a quoted ${p._priceOf(TK.ignite)}`);

    /* AND IT DRAINS. One second of holding a burning hilt against one second of
     * holding a dark one, same distance, same clock — the difference is the
     * surcharge and nothing else. */
    p.force = p.maxForce;
    const litFrom = p.force;
    for (let i = 0; i < 60; i++) p._updateGrip(1 / 60, b.ctx);
    const litCost = litFrom - p.force;

    p.igniteHeldHilt(b.ctx);
    assert(!hilt.saberLit, 'a second press did not put it out');
    assert(!hilt.saberBlade.visible, 'it is out and the blade is still drawn');
    p.force = p.maxForce;
    p._holdT = 0;
    const darkFrom = p.force;
    for (let i = 0; i < 60; i++) p._updateGrip(1 / 60, b.ctx);
    const darkCost = darkFrom - p.force;

    assert(litCost > darkCost * 1.5,
      `a burning hilt cost ${litCost.toFixed(1)} a second against ${darkCost.toFixed(1)} for a dark one — `
      + 'the note asks for "uses a lot of force power up" and this is a rounding error');

    /* AND RUNNING DRY PUTS THE LIGHT OUT RATHER THAN DROPPING THE HILT. */
    p.igniteHeldHilt(b.ctx);
    assert(hilt.saberLit, 'setup: it did not relight');
    /* RUN IT DRY rather than guessing a number: hold it, paying for both, until
     * one of the two prices cannot be met. `TK.lit` is the larger of the two
     * and is charged first, so the light must be what goes — see the note in
     * `_updateGrip`. A frame count and not a hand-picked balance, because the
     * balance is exactly what a tuning pass moves. */
    p.force = 6;
    /* THE HOLD'S OWN CLOCK BACK TO ZERO. `_holdT` has been running through
     * three drain passes above and `wear` is 1.75 at six seconds, which makes
     * one frame's charge large enough to cross BOTH thresholds at once — so
     * the douse and the drop land on the same frame and the ordering this is
     * about becomes unmeasurable. A fresh grip is the case being described. */
    p._holdT = 0;
    let frames = 0;
    while (hilt.saberLit && frames < 900) { p._updateGrip(1 / 60, b.ctx); frames++; }
    assert(!hilt.saberLit, 'the blade never went out at all');
    assert(p.gripBody, 'the grip ran out of Force before the blade did — a burning hilt fell to the floor');
    // …and the grip does go, after: the ordering is what matters, not that the
    // hold is free.
    let more = 0;
    while (p.gripBody && more < 900) { p._updateGrip(1 / 60, b.ctx); more++; }
    assert(!p.gripBody, 'the hilt hung in the air on an empty bar for ever');
    return `strike ${paid.toFixed(1)}; burning ${litCost.toFixed(1)}/s vs dark ${darkCost.toFixed(1)}/s; `
      + 'empty bar douses it';
  });

  check('telekinesis: a blade flown on the Force cuts, and a dark hilt does not', async () => {
    /**
     * TWO RUNS, TWO WORLDS, ONE DIFFERENCE.
     *
     * The first version of this did both passes in one world, dark then lit,
     * and measured the lit pass at zero — because sixty frames of flying the
     * dark hilt had already carried it past the droid, so what it recorded was
     * a blade nowhere near anybody rather than a blade that does not cut. Same
     * seed, same geometry, same frame count; the only thing that differs
     * between the two numbers below is whether the hilt is burning.
     *
     * A SECOND HILT, and the player keeps their own: dropping theirs would fire
     * the auto-catch on the first frame — a drop leaves it 25 cm from the hand,
     * inside `TK.reach` — and this would measure a pick-up. It is also the more
     * interesting case, which is somebody else's fallen blade flown by your
     * Force at the man standing next to it.
     */
    const run = async (light) => {
      const b = await boot();
      const { p, THREE } = b;
      const foe = b.world.spawnEnemy('b1', new THREE.Vector3(p.position.x, p.position.y, p.position.z - 7));
      assert(foe, 'setup: no droid');
      b.step(10);
      const D2 = await import('../../src/game/Dropped.js');
      const chest = foe.position.clone().setY(foe.position.y + 0.9);
      p.aimDir.copy(chest).sub(p.camera.pos).normalize();
      const hilt = D2.dropSaber(b.world, { position: chest.clone(), colorIndex: 2, hiltStyle: 'graflex' });
      assert(hilt, 'setup: no hilt on the ground');
      hilt.dropAge = 9;
      b.grab(hilt);
      if (light) {
        assert(p.igniteHeldHilt(b.ctx), 'setup: the hilt would not light');
        assert(hilt.saberLit, 'setup: it is not lit');
      }
      const hp0 = foe.hp;
      /* Held ON the droid by the GRIP, frame by frame — `_updateGrip` flies it
       * to the hold point and `Prop._syncMesh` carries the mesh with it, which
       * is what `hiltBlade` reads off. Teleporting the body instead leaves the
       * mesh behind and measures a blade at the world origin. */
      for (let i = 0; i < 60; i++) {
        p.gripDistance = p.camera.pos.distanceTo(chest);
        b.step(1);
        p.force = p.maxForce;
      }
      return { took: hp0 - foe.hp, dead: foe.dead, lit: hilt.saberLit };
    };

    /* …DARK IS NOT ZERO, ON PURPOSE. A hilt driven through a droid at speed is
     * `_sweepHeld`, the shove every held object gives, and its own note caps it
     * at 18 so that waving furniture at a rank staggers rather than kills. What
     * this measures is that lighting the thing is a different order of event. */
    const dark = await run(false);
    assert(dark.took <= 20,
      `an UNLIT hilt did ${dark.took.toFixed(1)} hp in a second — past the sweep's own 18 cap, so `
      + 'something is cutting with a torch handle');

    const lit = await run(true);
    assert(lit.took > dark.took * 3,
      `lighting it took the damage from ${dark.took.toFixed(1)} to ${lit.took.toFixed(1)} — a lightsabre `
      + 'and a thrown hilt should not be the same event');
    /* ONE CUT PER `TK.cutGap`, not one a frame. A second at a 0.4 s gap is two
     * or three landings, and the ceiling is what stops a parked blade being
     * sixty times a lightsabre. */
    const most = TK.cut * (1 / TK.cutGap + 1) * 1.35;
    assert(lit.took <= most,
      `a second of a flown blade did ${lit.took.toFixed(0)} damage — over the ${most.toFixed(0)} that `
      + `${TK.cutGap}s between cuts allows, so it is billing per frame`);
    return `dark ${dark.took.toFixed(0)} hp, lit ${lit.took.toFixed(0)} hp in a second `
      + `(cap ${most.toFixed(0)}${lit.dead ? ', and it killed it' : ''})`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * 4. AND YOU FLY THE ONE IN YOUR HAND
   * ──────────────────────────────────────────────────────────────────── */

  check('telekinesis: the thrown blade can be taken hold of and parked at the reticle', async () => {
    const b = await boot();
    const { p } = b;
    p.saber.ignite(); p.saber.ignition = 1;
    p.throwOrRecall(b.ctx);
    assert(p.throwState === 'flying', `the throw did not leave: ${p.throwState}`);

    p.force = p.maxForce;
    assert(p.pilotThrown(b.ctx), 'pressing grip on a blade in flight did nothing');
    assert(p.throwState === 'piloted', `grip left the blade in ${p.throwState}`);

    /* IT STAYS OUT. `flying` returns on its own after 1.5 s; this must not —
     * that is the entire difference between the two states. */
    for (let i = 0; i < 180; i++) { p._updateThrow(1 / 60, b.ctx); p.force = p.maxForce; }
    assert(p.throwState === 'piloted', `three seconds in, the held blade went to ${p.throwState}`);

    /* AND IT FOLLOWS THE SIGHTLINE. Look somewhere else; the blade goes there. */
    const was = p.throwPos.clone();
    p.aimDir.set(1, 0, 0).normalize();
    for (let i = 0; i < 90; i++) { p._updateThrow(1 / 60, b.ctx); p.force = p.maxForce; }
    const moved = was.distanceTo(p.throwPos);
    assert(moved > 3, `the blade moved ${moved.toFixed(1)} m for a 90° turn — it is not steering`);
    const want = p.camera.pos.clone().addScaledVector(p.aimDir, p.throwDist);
    assert(p.throwPos.distanceTo(want) < 1.5,
      `it settled ${p.throwPos.distanceTo(want).toFixed(1)} m off the point it is being held at`);

    /* IT COSTS. One second of holding it out there against nothing else moving. */
    p.force = p.maxForce;
    const from = p.force;
    for (let i = 0; i < 60; i++) p._updateThrow(1 / 60, b.ctx);
    const cost = from - p.force;
    assert(cost > (TK.lit + HOLD_COST.prop.base) * 0.4,
      `a second of holding your own blade across the arena cost ${cost.toFixed(1)} Force`);

    /* AND AN EMPTY BAR BRINGS IT HOME rather than dropping it on the floor. */
    p.force = 0;
    p._updateThrow(1 / 60, b.ctx);
    assert(p.throwState === 'returning', `an empty bar left the blade ${p.throwState}`);
    return `held ${'3'}s at the reticle, steered 90°, ${cost.toFixed(1)} Force a second, empty bar recalls`;
  });

  check('telekinesis: the recall still works from the held state, and grip throws it on', async () => {
    const b = await boot();
    const { p } = b;
    p.saber.ignite(); p.saber.ignition = 1;
    p.throwOrRecall(b.ctx);
    p.force = p.maxForce;
    p.pilotThrown(b.ctx);
    assert(p.throwState === 'piloted', 'setup: not piloted');

    /* THE CONTROL THE PLAYER ALREADY HAS MUST NOT STOP WORKING. `throw` means
     * recall from every state that is not `held`, and adding a third state is
     * exactly the sort of change that quietly makes one of them an exception. */
    p.throwOrRecall(b.ctx);
    assert(p.throwState === 'returning', `throw from piloted gave ${p.throwState}`);

    // …and grip again, from piloted, sends it on rather than recalling it.
    p.throwState = 'piloted';
    p.pilotThrown(b.ctx);
    assert(p.throwState === 'flying', `a second grip gave ${p.throwState}, not a throw`);

    // it comes home in the end, from wherever it is
    let f = 0;
    while (p.throwState !== 'held' && f < 1200) { p._updateThrow(1 / 60, b.ctx); f++; }
    assert(p.throwState === 'held', 'the blade never came home');
    return `piloted → recall; piloted → thrown on; home in ${(f / 60).toFixed(1)}s`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * 5. AND THIS IS HOW YOU COME TO BE WITHOUT IT
   * ──────────────────────────────────────────────────────────────────── */

  check('telekinesis: a real blow on an empty stamina bar takes the weapon out of your hand', async () => {
    const b = await boot();
    const { p } = b;

    /* THE CONTROL. The same blow with stamina in the bar keeps the weapon,
     * because otherwise this check passes on a game that disarms you on every
     * hit — which is not a mechanic, it is a bug. */
    p.stamina = p.maxStamina; p.invuln = 0;
    p.damage(30, p.chest, null, 'saber');
    assert(!p.saberDown, 'a hit with a full stamina bar disarmed the player');

    p.stamina = 2; p.invuln = 0; p.hp = p.maxHp;
    p.damage(30, p.chest, null, 'saber');
    assert(p.saberDown, 'a solid blow on an empty stamina bar left the weapon in the hand');
    assert(p.staggerTimer > 0.4, `the disarm staggered for ${p.staggerTimer.toFixed(2)}s`);
    const hilt = b.world.props.find(x => x.saber && !x.dead);
    assert(hilt, 'the player is disarmed and there is no hilt on the ground');

    /* AND NOT TWICE. A disarm you cannot walk back from is a death with extra
     * steps, so the gap is longer than it takes to reach the hilt. */
    p.saberDown = false;
    p.invuln = 0;
    p.damage(30, p.chest, null, 'saber');
    assert(!p.saberDown, `disarmed twice inside ${TK.disarmGap}s — there is no recovering from that`);

    /* A FALL IS NOT A DISARM: nobody knocked it out of your hand. */
    b.world.time += TK.disarmGap + 1;
    p.invuln = 0; p.hp = p.maxHp; p.stamina = 1;
    p.damage(40, null, null, 'fall');
    assert(!p.saberDown, 'falling over knocked the weapon out of the player\'s own hand');
    return `full bar keeps it; empty bar drops it and staggers ${p.staggerTimer.toFixed(2)}s; `
      + `no second inside ${TK.disarmGap}s; a fall never`;
  });

  return;
}
