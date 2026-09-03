/**
 * BATTLEFIELD BORZ — TAKING THE CONTROLS.
 *
 * The player, in the V5 list:
 *
 *   "I think we should be able to drive the vehicles it makes sense to drive"
 *
 * ── WHAT THIS SUITE IS ACTUALLY GUARDING ────────────────────────────────
 *
 * "It makes sense" is the whole design and it is the thing a check can hold.
 * The roster splits along a line the source material already drew: an AT-TE
 * has six crew and a spotter's cupola, a Juggernaut has a driver's cabin at
 * each end, an AAT has four battle droids in a hull with a hatch, a SPHA has
 * twenty-five gunners. A hailfire droid, a dwarf spider, an Octuptarra
 * tri-droid and a Persuader snail tank have NOBODY IN THEM — the brain is the
 * machine, there is no seat to take and nobody to displace.
 *
 * So the first check below is that rule, read off the archetypes rather than
 * off a list typed in this file, and the rest are the three ways a driven
 * vehicle could quietly stop being the vehicle you were just fighting:
 *
 *   • it stops being a machine — a tank that no longer walks on its own legs,
 *     takes its own grade or loses them to a blade is a camera with a gun;
 *   • it stops being dangerous to you — armour that is really invulnerability
 *     deletes the encounter rather than winning it;
 *   • it never gives you back — a state you can enter and not leave is worse
 *     than one that does not exist.
 */

import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  const D = await import('../../src/game/Driving.js');
  /* VEHICLES FIRST. The vehicle rows are added to `ARCHETYPES` by an
   * `Object.assign` inside src/game/Vehicles.js, so a suite that imports the
   * roster without importing that file reads a roster with no vehicles in it —
   * and the first check reported "0 machines declare a crew" for a roster that
   * declares four. */
  await import('../../src/game/Vehicles.js');
  const { ARCHETYPES } = await import('../../src/game/Enemy.js');
  const { DRIVE, crewOf, isCrewed, whyNotDrive, drivableNear } = D;

  const boot = async () => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(19);
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const p = world.player;
    const input = H.idleInput();
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    p.force = p.maxForce; p.hp = p.maxHp;
    const ctx = { input, terrain: world.terrain, physics: world.physics,
      particles: world.particles, bolts: world.bolts, camera: world.engine.camera,
      time: world.time, enemies: world.enemies, players: world.players };
    const step = (n = 30) => { for (let i = 0; i < n; i++) world.update(1 / 60, input); };
    /** Put a machine of `type` next to the player and hand it back. */
    const park = (type, out = 3) => {
      const at = new THREE.Vector3(p.position.x + out, p.position.y, p.position.z);
      const e = world.spawnEnemy(type, at);
      assert(e, `setup: nothing spawned for ${type}`);
      step(4);
      e.position.copy(at);
      return e;
    };
    return { world, p, ctx, input, THREE, step, park };
  };

  /* ────────────────────────────────────────────────────────────────────
   * 1. WHICH ONES, AND IT IS ONE FIELD
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: a machine with a crew can be driven and a droid cannot', () => {
    /**
     * DERIVED, both halves. A list of drivable names typed here would be the
     * second copy of `crew` on the archetypes and one roster change from being
     * a lie — HANDOFF §2.3 — so what is asserted is the SHAPE of the split:
     * every machine that declares a crew is drivable, no machine without one
     * is, and the four droid vehicles the player can walk up to are all on the
     * dark side of that line.
     */
    const crewed = Object.keys(ARCHETYPES).filter(k => crewOf(k) > 0);
    assert(crewed.length >= 4,
      `only ${crewed.length} machines declare a crew — the roster lost its drivable hardware`);
    for (const k of crewed) {
      assert(isCrewed({ type: k }), `${k} declares ${crewOf(k)} crew and is not drivable`);
      assert(Number.isInteger(crewOf(k)) && crewOf(k) > 0,
        `${k} declares a crew of ${crewOf(k)}, which is not a number of bodies`);
    }
    /* THE DROIDS, BY NAME, because this is the half of the rule that is a
     * statement about the source material and not about the code: there is
     * nobody inside any of these to displace. */
    for (const k of ['dwarfspider', 'hailfire', 'tridroid', 'snailtank']) {
      if (!ARCHETYPES[k]) continue;
      assert(!isCrewed({ type: k }),
        `${k} is a droid — the brain IS the machine — and something declared a crew in it`);
    }
    /**
     * …AND EVERY CREWED BODY IS ONE OF EXACTLY TWO THINGS, WHICH IS THE RULE
     * THAT REPLACED "IT IS BIG".
     *
     * This asserted `ARCHETYPES[k].big` on every crewed row, on the argument
     * that "a crewed B1 would pass every check above and be a joke" — and the
     * argument is right while the only seated things are hulls. Three mounts
     * arrived and are deliberately NOT `big`: the tauntaun's row argues that
     * at length, because `A.big` also picks the movement proxy, counts against
     * Waves' `heavyLimit` and forces `armourClass`/STRATAGEM_ONLY, none of
     * which belongs on an animal a player owns.
     *
     * So the shape held is the PARTITION: a body with a seat in it is a
     * VEHICLE (`big`) or a MOUNT (`mount`), never neither and never both. That
     * still refuses the crewed B1 the old line was written to refuse, and it is
     * the same partition `Menu.js` derives its two lists from — so a row that
     * fell out of it would be a row the controls card silently omits.
     */
    const vehicles = crewed.filter(k => ARCHETYPES[k].big);
    const mounts = crewed.filter(k => ARCHETYPES[k].mount);
    for (const k of crewed) {
      assert(ARCHETYPES[k].big || ARCHETYPES[k].mount,
        `${k} declares a crew and is neither a vehicle nor a mount — there is nothing to sit on`);
      assert(!(ARCHETYPES[k].big && ARCHETYPES[k].mount),
        `${k} is both a vehicle and a mount; A.big and A.mount decide four other things each`);
    }
    /**
     * AND THE BINDING RUNS THE OTHER WAY TOO, which is the half that catches a
     * mount added without a seat. `mount: true` on a kind row is what the
     * Kennel card reads to print "You can ride this one."; `crew` is what
     * `whyNotDrive` reads to let you. For four months those were the same claim
     * made in two places with only one of them true, and the card was the one
     * telling the player.
     */
    for (const k of Object.keys(ARCHETYPES)) {
      if (!ARCHETYPES[k].mount) continue;
      assert(crewOf(k) > 0,
        `${k} says it is a mount and declares no crew — every surface that offers it a rider is lying`);
      assert(ARCHETYPES[k].steer > 0,
        `${k} is a mount with no turn rate; it would come round at a Juggernaut's 0.9 rad/s`);
    }
    assert(mounts.length >= 3,
      `only ${mounts.length} rideable animals on the roster — the player asked for three by name`);
    return `${crewed.length} seated: ${vehicles.length} machines `
      + `(${vehicles.map(k => `${k}×${crewOf(k)}`).join(' ')}) and ${mounts.length} mounts `
      + `(${mounts.map(k => `${k}@${ARCHETYPES[k].steer}rad/s`).join(' ')}); `
      + 'four droid vehicles refused';
  });

  check('driving: a droid is refused BY NAME, not in silence', async () => {
    const b = await boot();
    const { p } = b;
    const droid = b.park('hailfire');
    droid.team = p.team;                       // …even one of yours
    const why = whyNotDrive(b.world, p, droid);
    assert(why, 'a hailfire droid was offered as drivable');
    assert(/droid|seat|brain/i.test(why), `the refusal reads "${why}" and never says why`);
    /* AND THE PROMPT FINDS IT ANYWAY. `drivableNear` deliberately does not
     * filter the refusable ones out, so the HUD can print the reason instead
     * of leaving the player next to a machine with nothing on screen. */
    /* CAUGHT AT THE DOOR EVERY REFUSAL GOES THROUGH. `world.notices` is a
     * bench field and this is a real World, so the notice is taken where it is
     * raised rather than from a list this World does not keep. */
    const said = [];
    const inner = b.world.notify.bind(b.world);
    b.world.notify = (t, sub) => { said.push(`${t} — ${sub}`); return inner(t, sub); };
    p.takeControls(b.ctx);
    b.world.notify = inner;
    assert(!p.driving, 'the player is driving a droid');
    assert(said.length, 'pressing the key at a droid did nothing and said nothing');
    assert(said.some(n => /droid|seat|brain/i.test(n)),
      `the refusal on screen reads ${JSON.stringify(said)} and never says it is a droid`);
    return `refused: "${why}"`;
  });

  check('driving: an enemy machine has to be crippled first; your own does not', async () => {
    const b = await boot();
    const { p } = b;
    const foe = b.park('aat');
    foe.team = p.team === 0 ? 1 : 0;
    foe.hp = foe.maxHp;
    const why = whyNotDrive(b.world, p, foe);
    assert(why && /crew|%/i.test(why),
      `a full-health ENEMY tank was takeable: ${why === null ? 'no refusal at all' : why}`);

    /* CRIPPLED, and it is a share of the hull rather than a flat number: this
     * roster spans 340 hp on a dwarf spider and 4 400 on a SPHA. */
    foe.hp = foe.maxHp * DRIVE.wreck * 0.9;
    assert(!whyNotDrive(b.world, p, foe),
      `a tank at ${Math.round(foe.hp / foe.maxHp * 100)}% is still refused`);

    /* …and one of yours, at full health, any time. */
    const mine = b.park('atte', -3);
    mine.team = p.team;
    mine.hp = mine.maxHp;
    assert(!whyNotDrive(b.world, p, mine),
      `your own AT-TE at full health was refused: ${whyNotDrive(b.world, p, mine)}`);
    return `enemy at 100% refused, at ${Math.round(DRIVE.wreck * 90)}% taken; your own always`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * 2. AND IT IS STILL THE MACHINE YOU WERE FIGHTING
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: you steer it, it moves on its own legs, and it fires its own gun', async () => {
    const b = await boot();
    const { p } = b;
    const tank = b.park('aat');
    tank.team = p.team;
    assert(p.takeControls(b.ctx), 'could not take the controls of my own tank');
    assert(p.driving && tank.driven === p.driving, 'the two halves of the state disagree');
    assert(tank.team === p.team, 'a tank you are driving is not on your side');

    /* THROTTLE. The move axis is the tank's, so a held forward is the machine
     * travelling under its own `_move` — grade limit, legs and all — and not a
     * position being written by the crew. */
    const from = tank.position.clone();
    b.input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
    b.input.act = () => false;
    b.step(90);
    const drove = tank.position.distanceTo(from);
    assert(drove > 2, `a second and a half of full throttle moved the tank ${drove.toFixed(2)} m`);

    /* …AND THE DRIVER CAME WITH IT. `Crew.ride` runs in the enemy's own tick,
     * after the hull has moved, so the seat is never a frame behind. */
    const off = Math.hypot(p.position.x - tank.position.x, p.position.z - tank.position.z);
    assert(off < 2.5, `the driver is ${off.toFixed(2)} m from the hull they are sitting on`);

    /* STEERING. Left on the axis swings the hull, at the driver's rate rather
     * than the AI's. */
    const facing0 = tank.facing;
    b.input.moveAxis = (o) => { if (o) { o.x = 1; o.y = 0; return o; } return { x: 1, y: 0 }; };
    b.step(60);
    const turned = Math.abs(((tank.facing - facing0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    assert(turned > 0.4, `a second of full steer swung the hull ${turned.toFixed(2)} rad`);

    /* THE GUN. Its own damage, its own colour, its own muzzle — through the
     * machine's `_shoot`, which is why a taken AAT is an AAT. */
    /* COUNTED AT THE POOL'S OWN DOOR. `BoltPool` has no live count to read —
     * it is a ring of slots with an `active` flag — and a check that invented
     * one would be measuring a field nothing else in the game has. */
    b.input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; };
    b.input.act = (id) => id === 'thrust';
    const shells = [];
    const innerFire = b.world.bolts.fire.bind(b.world.bolts);
    b.world.bolts.fire = (o, d, opts = {}) => { shells.push(opts); return innerFire(o, d, opts); };
    p.driving.fireT = 0;
    p.driving.fire(b.ctx);
    b.world.bolts.fire = innerFire;
    assert(shells.length > 0, 'pulling the trigger in a tank fired nothing');
    /* …AND IT IS THE TANK'S SHELL, not a generic bolt. Its damage, its colour
     * and its owner all come off the archetype through the machine's own
     * `_shoot`, which is the whole reason a taken AAT is an AAT. */
    const shell = shells[0];
    assert(shell.owner === tank, 'the shell was not fired by the machine');
    assert(shell.team === p.team, `the shell went out on team ${shell.team}, not the driver's`);
    assert(shell.damage > 30, `the tank's shell does ${shell.damage} — that is a rifle`);
    assert(shell.big, "the tank's shell is not a big bolt");
    const fired = shells.length;
    return `drove ${drove.toFixed(1)} m, swung ${turned.toFixed(2)} rad, fired ${fired} shell(s)`;
  });

  check('driving: every machine that declares a crew actually drives', async () => {
    /**
     * FOUR MACHINES, NOT ONE. The steering check above drives an AT-TE and
     * proves the mechanism; this one proves the ROSTER, because each of these
     * bodies carries its own movement rules and two of them have a reason to
     * refuse. The SPHA "remains motionless to fire" and declares `plant`; the
     * Juggernaut is ten wheels on a 25 m wheelbase with a grade limit of 0.17.
     * A machine that says it is drivable and then does not move under a driver
     * is worse than one that was never offered.
     *
     * `plant` is handled inside `_rangedBrain`, which the driven branch of
     * `Enemy.update` skips — so a driven siege gun should walk. That is an
     * argument, and this is the measurement of it.
     */
    const drivable = Object.keys(ARCHETYPES).filter(k => crewOf(k) > 0);
    assert(drivable.length >= 4, `only ${drivable.length} machines declare a crew`);
    const rows = [];
    for (const type of drivable) {
      const b = await boot();
      const { p } = b;
      const v = b.park(type, 4);
      v.team = p.team;
      const why = whyNotDrive(b.world, p, v);
      assert(!why, `${type} declares ${crewOf(type)} crew and refuses a driver: ${why}`);
      assert(p.takeControls(b.ctx), `${type}: takeControls said no with no reason`);
      const from = v.position.clone();
      b.input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
      b.input.act = () => false;
      b.step(120);
      const moved = v.position.distanceTo(from);
      /* Two seconds of full throttle. The slowest of these is the SPHA at 1.1
       * m/s, so a metre is a floor that nothing honest can fail. */
      assert(moved > 1,
        `${type} (${v.A?.label}) moved ${moved.toFixed(2)} m under two seconds of full throttle`);
      assert(p.driving, `${type} threw its driver out while being driven`);
      rows.push(`${type} ${moved.toFixed(1)}m`);
      b.world.unload?.();
    }
    return rows.join(' · ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * 3. THE ARMOUR IS A TRADE, NOT AN IMMUNITY
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: hits land on the hull, and the hull dying puts you out', async () => {
    const b = await boot();
    const { p } = b;
    const tank = b.park('aat');
    tank.team = p.team;
    p.takeControls(b.ctx);
    assert(p.driving, 'setup: not driving');

    const hp0 = p.hp, hull0 = tank.hp;
    p.invuln = 0;
    p.damage(80, p.chest, null, 'bolt');
    assert(p.hp === hp0, `the driver took ${(hp0 - p.hp).toFixed(1)} hp through the armour`);
    assert(tank.hp < hull0,
      'the blow reached neither the driver nor the hull — that is invulnerability, not armour');
    assert(Math.abs((hull0 - tank.hp) - 80 * (tank.dmgScale ?? 1)) < 80,
      `the hull took ${(hull0 - tank.hp).toFixed(1)} of an 80-point blow`);

    /* AND WHEN THE HULL IS FINISHED YOU ARE ON THE GROUND. Not dead with it:
     * the trade for the armour is that you cannot heal it and everything on
     * the field is aiming at a fourteen-metre target you are sitting on. */
    tank.hp = 1;
    p.damage(400, p.chest, null, 'bolt');
    b.step(4);
    assert(!p.driving, 'the tank died and the player is still at its controls');
    assert(p.alive, 'the driver died with the machine');
    const clear = p.position.distanceTo(tank.position);
    assert(clear > 1, `the player was put down ${clear.toFixed(2)} m from the wreck — inside it`);
    return `80-point bolt: driver 0, hull ${(hull0 - tank.hp).toFixed(0)}; wreck puts you out ${clear.toFixed(1)} m clear`;
  });

  check('driving: the same key gets you out, and everything you borrowed goes back', async () => {
    const b = await boot();
    const { p } = b;
    const tank = b.park('atte');
    const wasTeam = tank.team = p.team === 0 ? 1 : 0;
    tank.hp = tank.maxHp * 0.1;                   // crippled, so it is takeable
    const wasSpeed = tank.speed;
    p.saber.ignite(); p.saber.ignition = 1;
    assert(p.takeControls(b.ctx), `could not board: ${whyNotDrive(b.world, p, tank)}`);
    assert(!p.saber.lit, 'both hands are on the controls and the blade is still lit');

    p.takeControls(b.ctx);
    assert(!p.driving && !tank.driven, 'pressing the key again did not get the player out');
    /* THE BORROWED FIELDS. A tank you sit in for a second must not become
     * yours, and a pace written for a driver must not stay on the body — the
     * same trap `Enemy.update`'s own note describes for a reaction's speed. */
    assert(tank.team === wasTeam, `the machine kept the player's side after they climbed down`);
    assert(Math.abs(tank.speed - wasSpeed) < 1e-6,
      `it walks at ${tank.speed.toFixed(2)} now against ${wasSpeed.toFixed(2)} before`);
    assert(p.saber.lit || p.saber.ignition > 0, 'the blade did not come back lit');
    const clear = p.position.distanceTo(tank.position);
    assert(clear > 1, `climbing down put the player ${clear.toFixed(2)} m away — inside the hull`);

    /* AND THE MACHINE GOES BACK TO FIGHTING. Its brain was skipped while it was
     * driven; nothing may have broken on the way through. */
    b.step(60);
    assert(!tank.dead, 'the machine died the moment it was handed back');
    return `out on the same key, side ${wasTeam} restored, pace restored, ${clear.toFixed(1)} m clear`;
  });

  check('driving: both hands are on the controls — no Force, no blade, no saber throw', async () => {
    /**
     * `Player.update` reads the input BEFORE it hands the frame to `Crew`,
     * because the crew needs the aim and the move axis that read writes. Which
     * meant, until `_readInput` learned to return early, that every key in the
     * game was live inside a hull: you could throw your saber out of a driven
     * AT-TE, raise a Force barrier in a cockpit, or grip a crate while
     * steering.
     *
     * The throw is the one that is worse than silly rather than merely wrong:
     * `_updateThrow` poses the saber at `throwPos` while `Crew.ride` pins the
     * player to the seat, so the blade and the man whose blade it is would be
     * in two places at once.
     *
     * Driven through `Player.update` with the keys HELD DOWN, rather than by
     * calling the methods — calling them would measure the methods, and what
     * is being asserted is that the input never reaches them.
     */
    const b = await boot();
    const { p } = b;
    const tank = b.park('aat');
    tank.team = p.team;
    p.saber.ignite(); p.saber.ignition = 1;
    p.force = p.maxForce;
    assert(p.takeControls(b.ctx), 'setup: could not board');

    /* Every action a player could press, held, for a second. `drive` and `view`
     * are the two that are meant to answer; everything else must not. */
    const pressed = [];
    b.input.actHit = (id) => { pressed.push(id); return id !== 'drive' && id !== 'view'; };
    b.input.act = (id) => id !== 'drive' && id !== 'view';
    b.step(60);

    assert(p.driving, 'a key press while driving got the player out of the tank');
    assert(!p.shield.up, 'a Force barrier went up inside a hull');
    assert(p.throwState === 'held', `the saber was thrown from inside a tank: ${p.throwState}`);
    assert(!p.gripBody && !p.gripEnemy, 'the Force gripped something while both hands were on the controls');
    assert(!p.stasis.active, 'a stasis field opened from the driver\'s seat');
    assert(p.healing == null, 'a mend was channelled while driving');
    assert(!p.senseActive, 'Force sense came on inside a tank');
    /* NOT "the bar did not move" — the pool ALSO answers what is thrown AT
     * you (`resistForce`), and a colosseum with a live wave in it throws
     * things. What is being asserted is that no power FIRED, and every power
     * in the file stamps its own cooldown on the way out, so the cooldown
     * table is the honest reader. */
    const fired = Object.entries(p.cooldowns).filter(([, v]) => v > 0).map(([k]) => k);
    assert(!fired.length, `these powers went off from the driver's seat: ${fired.join(', ')}`);
    /* …and the keys really were being offered, or this passes on an input that
     * was never asked anything. */
    assert(pressed.length > 30,
      `only ${pressed.length} actions were polled in a second — the check is not pressing anything`);
    return `${new Set(pressed).size} distinct actions held for a second inside a hull, `
      + '0 powers fired, blade in its hand, barrier down';
  });

  /* ────────────────────────────────────────────────────────────────────
   * 4. AND THE THING WITH THE SADDLE
   *
   * The player asked for three mounts by name — *"a Tauntaun you ride/mount"*,
   * *"a Blurgg you ride/mount"*, *"a Varactyl you ride/mount"* — and for four
   * months three separate surfaces said you could while `whyNotDrive` answered
   * "Tauntaun is a droid — the brain is the machine, and there is no seat in
   * it". These checks drive the whole loop on a live world rather than reading
   * the flags: a real companion, boarded from the ground, ridden further than
   * the same player's own legs carry him over the same line, got off, and still
   * his afterwards.
   * ──────────────────────────────────────────────────────────────────── */

  /** A geonosis world with one of YOUR OWN animals fielded beside you. */
  const rideBoot = async (kind, level = 'geonosis') => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { fieldCompanion } = await import('../../src/game/Companions.js');
    const { world } = await H.bootWorld({
      level,
      settings: { mode: 'waves', level, allies: 0, quality: 'low' },
      runSeed: 21,
    });
    const p = world.player;
    /** An input whose throttle and steering this check owns. */
    const stick = { fwd: 0, steer: 0 };
    const input = {
      act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { const v = o || {}; v.x = stick.steer; v.y = stick.fwd; return v; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
    };
    const STEP = 1 / 30;
    const step = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp; world.update(STEP, input); } };
    step(40);
    const e = fieldCompanion(world, p, kind, { rec: { id: `k-${kind}`, xp: 99 } });
    assert(e, `setup: no ${kind} was fielded`);
    step(40);
    const ctx = { input, terrain: world.terrain };
    /** Stand it an arm's length off, which is where a player boards from. */
    const alongside = () => { e.position.set(p.position.x + 1.5, e.position.y, p.position.z); };
    return { world, p, e, input, stick, step, ctx, THREE, alongside, STEP };
  };

  check('driving: you get on your own tauntaun, and it carries you further than your legs do', async () => {
    /**
     * ── THE MEASUREMENT IS A RACE OVER THE SAME LINE ─────────────────────
     *
     * "Faster than walking" is easy to assert and easy to satisfy by accident,
     * because the number a mount is CLAMPED to (`paceOf`, 0.82 of your sprint
     * for this kind) is not the number it TRAVELS at: the animal takes the
     * grade term, the wall slide and the stuck commit that `_move` gives every
     * body, and the player does not take the same ones. So this runs the player
     * on foot from a point along a heading for ten seconds, notes the line he
     * actually took, and then puts him back and sends the ANIMAL down that same
     * line for the same ten seconds. Same ground, same start, same bearing.
     *
     * The floor is the honest one: further on its back than on his feet, which
     * is the whole of what a mount is for. It is not "faster than a sprint" and
     * must not become that — a sprint is 7.45 m/s for as long as the stamina
     * lasts, and COMPANIONS.md's pace cap exists precisely so that no companion
     * ever outruns you.
     *
     * FOUR SECONDS AND NOT TEN, because ten runs the animal into the far side
     * of the level: measured, the ride is a clean straight line at its full
     * 5.90 m/s for about 25 m and then meets something, and a race whose second
     * leg ends against a rock measures the rock. Four seconds is 23 m of ride
     * against 18 of walk with room to spare on every level tried.
     */
    const b = await rideBoot('taun');
    const { p, e, stick, step, THREE } = b;

    /* ── on foot, ten seconds of the ordinary run. */
    const from = p.position.clone();
    stick.fwd = 1;
    step(120);
    const footLine = p.position.clone().sub(from).setY(0);
    const foot = footLine.length();
    const heading = Math.atan2(footLine.x, footLine.z);

    /* ── the same start, the same bearing, on the animal. */
    stick.fwd = 0;
    p.position.copy(from);
    p.body?.position?.copy(p.position);
    p.velocity.set(0, 0, 0);
    e.position.set(from.x + 1.5, e.position.y, from.z);
    step(2);
    const why = whyNotDrive(b.world, p, e);
    assert(!why, `standing 1.5 m off your own tauntaun and it refuses you: ${why}`);
    assert(p.takeControls(b.ctx), 'takeControls said no with no reason at all');
    assert(p.driving && e.driven, 'the key was accepted and nobody is in the saddle');
    /* Pointed down the line the legs took, or this measures two different
     * pieces of ground and calls one of them a mount. */
    e.facing = heading;
    const rideFrom = p.position.clone();
    stick.fwd = 1;
    step(120);
    const ride = p.position.clone().sub(rideFrom).setY(0).length();

    assert(p.driving, 'it threw its rider off during an ordinary four-second run');
    assert(ride > foot * 1.1,
      `four seconds down the same line: ${ride.toFixed(1)} m on its back against `
      + `${foot.toFixed(1)} m on foot — the mount is not carrying you anywhere`);
    /* AND THE PLAYER IS ON THE ANIMAL, not being towed beside it. */
    const gap = new THREE.Vector3().subVectors(p.position, e.position).setY(0).length();
    const up = p.position.y - e.position.y;
    assert(gap < 2, `the rider ended ${gap.toFixed(2)} m to one side of the animal he is on`);
    assert(up > 1, `the rider is ${up.toFixed(2)} m above it — that is not a back`);

    /* ── and getting off gives you back an animal that is still yours. */
    p.takeControls(b.ctx);
    assert(!p.driving && !e.driven, 'the same key did not get the rider down');
    assert(!e.dead && e.hp > 0, 'the animal did not survive being ridden');
    assert(e.team === p.team, 'it changed sides when its rider got off');
    assert(e._cmpOwner === p, 'it stopped being his companion');
    assert(e._cmpKind === 'taun', 'the kind record did not survive the ride');
    /* AND IT COMES BACK TO HEEL, which is the whole of "it is still yours":
     * the move wrap deferred to the driver for 300 frames and has to pick the
     * station back up on the frame after. */
    stick.fwd = 0;
    step(90);
    const heel = e.position.distanceTo(p.position);
    assert(heel < 8, `three seconds after the dismount it is ${heel.toFixed(1)} m away, not at your heel`);
    return `4 s down one line: ${ride.toFixed(1)} m ridden vs ${foot.toFixed(1)} m on foot `
      + `(+${(100 * (ride / foot - 1)).toFixed(0)}%); rider ${gap.toFixed(2)} m over its centre and `
      + `${up.toFixed(2)} m up; dismounted, still yours, back at ${heel.toFixed(1)} m`;
  });

  check('driving: the saddle is the animal\'s measured back, not a number off its nose', async () => {
    /**
     * `_measurePlatform` returns immediately on `if (!this.A.big || !this.rig)`
     * and no mount is `big` — so before this pass every mount published
     * `platformTop` 0 and `platform()` null, and `Crew.seat` had nothing to sit
     * on but `chestY`. This drives the gate: the platform is measured, the seat
     * IS it, and `chestY` is far enough away that the two cannot be confused.
     *
     * BREAK EITHER HALF AND THIS GOES RED. Put `A.big` back in the gate and
     * `platform()` is null on all three; leave the gate open and take the
     * `plat` branch out of `seat()` and the rider sits at `chestY`, which the
     * last assertion measures as a real distance rather than trusting it.
     */
    const rows = [];
    for (const kind of ['taun', 'blurrg', 'varac']) {
      const b = await rideBoot(kind);
      const { p, e, step } = b;
      const plat = e.platform();
      assert(plat, `${kind}: no deck was measured, so there is nothing to sit on`);
      assert(e.platformTop > 0.2 && e.platformRadius > 0.2,
        `${kind}: a deck ${e.platformTop.toFixed(2)} m high and ${e.platformRadius.toFixed(2)} m across`);
      b.alongside();
      step(2);
      assert(p.takeControls(b.ctx), `${kind}: ${whyNotDrive(b.world, p, e)}`);
      step(4);
      const back = plat.position.y + plat.extent.y;
      const off = Math.abs(p.position.y - back);
      assert(off < 0.35,
        `${kind}: the rider is ${off.toFixed(2)} m off the back that was measured for him`);
      /* …AND `chestY` IS A DIFFERENT ANSWER, or the branch above proves nothing. */
      const chest = Math.abs(p.position.y - (e.chestY ?? 0));
      assert(chest > 0.15,
        `${kind}: the measured back and chestY are ${chest.toFixed(2)} m apart — `
        + 'this check cannot tell which one the seat used');
      rows.push(`${kind} back ${(back - e.position.y).toFixed(2)} m, rider ${off.toFixed(2)} off it, `
        + `chestY ${chest.toFixed(2)} away`);
      b.world.unload?.();
    }
    return rows.join(' · ');
  });

  check('driving: an animal is not a gun platform, and it says so', async () => {
    /**
     * `Crew.fire` goes through the machine's own `_shoot` — its damage, its
     * bolt colour, its muzzle. A tauntaun has none of those, and the trade
     * riding IS is that your blade goes on your belt and you arrive unarmed.
     * A trigger that silently did nothing would be the defect `Player._refuse`
     * exists to stop, so this asserts the REFUSAL and not the silence.
     */
    const b = await rideBoot('taun');
    const { p, e, step } = b;
    b.alongside();
    step(2);
    p.saber.ignite(); p.saber.ignition = 1;
    assert(p.takeControls(b.ctx), `setup: ${whyNotDrive(b.world, p, e)}`);
    assert(!p.saber.lit, 'you are on an animal with both hands on the reins and the blade is lit');

    const said = [];
    const was = b.world.notify;
    b.world.notify = (t, m) => { said.push(`${t}: ${m}`); return was?.call(b.world, t, m); };
    const bolts0 = b.world.bolts?.count ?? b.world.bolts?.list?.length ?? 0;
    const fired = p.driving.fire(b.ctx);
    step(30);
    b.world.notify = was;
    assert(fired === false, 'a tauntaun fired something');
    const bolts1 = b.world.bolts?.count ?? b.world.bolts?.list?.length ?? 0;
    assert(bolts1 <= bolts0, `${bolts1 - bolts0} bolts came out of an animal with no gun`);
    assert(said.some(l => /FIRE/i.test(l)),
      `the trigger did nothing and said nothing: ${said.join(' | ') || '(silence)'}`);
    /* AND THE BLADE COMES BACK, so the trade is a trade and not a confiscation. */
    p.takeControls(b.ctx);
    assert(p.saber.lit || p.saber.ignition > 0, 'the blade did not come back lit after the dismount');
    return `fire() refused with "${said.find(l => /FIRE/i.test(l))}", 0 bolts, blade back on the dismount`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * AND A GUEST SEES IT
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: a tank the host is driving is a tank the guest sees moving, on the right side', async () => {
    /**
     * The grenades needed a new event on the wire because a grenade is not a
     * STATE. A driven vehicle is the opposite case and it is worth pinning
     * rather than assuming: it stays an ordinary `Enemy`, so its position, its
     * facing, its hp and — the one that matters — its TEAM are already in every
     * snapshot. Taking the controls flips `vehicle.team` to the driver's, which
     * is what stops your own line shooting at it, and that flip has to reach
     * the far end or a guest watches their host's tank being shot to pieces by
     * their own troops.
     *
     * If this ever fails, the fix is not a new packet — it is that something
     * stopped packing `e.team`.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump, input } = await H.bootPair({ level: 'colosseum' });
    const p = host.player;
    const at = new THREE.Vector3(p.position.x + 3, p.position.y, p.position.z);
    const tank = host.spawnEnemy('aat', at);
    assert(tank, 'setup: no tank on the host');
    pump(1 / 60);
    tank.position.copy(at);
    const foeTeam = tank.team;

    const mirror = () => client.enemies.find(e => e.id === tank.id) || null;
    for (let i = 0; i < 40; i++) pump(1 / 60);
    assert(mirror(), 'the tank never reached the guest at all');
    assert(mirror().team === foeTeam, 'the guest has the tank on the wrong side before anybody boards it');

    tank.team = p.team;                       // …so it is takeable
    assert(p.takeControls({ input, enemies: host.enemies, players: host.players,
      terrain: host.terrain, physics: host.physics, bolts: host.bolts,
      camera: host.engine.camera, particles: host.particles, time: host.time }),
    `the host could not board: ${whyNotDrive(host, p, tank)}`);

    const from = mirror().position.clone();
    /* Drive it. `pump` closes over ONE input object and both worlds read it, so
     * the throttle goes on that object rather than on a second one handed to a
     * parameter `pump` does not have — which is how this first read 0.63 m of
     * drift and reported it as a wire fault. The host's own input is what moves
     * the tank either way: this is the shipped path, not a position written by
     * the check. */
    input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
    pump(2);
    input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; };
    pump(0.5);

    const moved = mirror().position.distanceTo(from);
    assert(moved > 1.5,
      `the host drove its tank ${tank.position.distanceTo(at).toFixed(1)} m and the guest saw it move `
      + `${moved.toFixed(2)} m`);
    assert(mirror().team === p.team,
      'the guest still has the tank on the enemy side while a player is driving it — their own line '
      + 'will shoot it to pieces');
    const line = `guest saw ${moved.toFixed(1)} m of driving, side ${foeTeam} → ${mirror().team}`;
    host.unload(); client.unload();
    return line;
  });

  return;
}
