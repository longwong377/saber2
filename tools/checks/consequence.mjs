/**
 * CONSEQUENCE — whether the station punishes the right person.
 *
 * SHARK §11 is one sentence and it names an act: *"CUT OR THROW ONE and the
 * nearest guards — real, armed bodies — come. You wake in the Brig (#47), your
 * station `standing` drops (one number in `Session`), the kiosks refuse you
 * for a day."*
 *
 * The failure this file exists to catch is not a crash and not a missing
 * feature. It is a consequence that fires on the WRONG CAUSE, which is the
 * worst kind because everything downstream of it works perfectly. Measured on
 * deck 40 with the player standing still and not one key pressed:
 *
 *     t= 5s  hurt  3   standing  -6   guards 2
 *     t=20s  hurt 26   standing -52   SHOPS SHUT
 *     t=40s  hurt 31   standing -62   IG BODYGUARD DROID: it has come for you
 *
 * and on decks 44 and 48 those guards killed the player inside a minute. Two
 * mechanisms stacked, and this file holds both ends of the repair:
 *
 *   THE CROWD BILLED ITSELF. `Impact.kineticContact` priced a shoulder brush
 *     at 0.21 damage — 479 contacts in 45 s, 102 damage over 31 of 35
 *     residents, none of it anybody's doing. `KINETIC_BODY.jostle` refuses it
 *     now. A resident who has been walked into is not a wounded resident.
 *
 *   THE ALARM DID NOT ASK WHO. `StationLife.witness` tested `hp < maxHp`,
 *     which is a latch that only ever grows on bodies that never heal. It
 *     reads `Enemy.hurtByPlayer` now, set at the one line where hit points are
 *     actually lost.
 *
 * BOTH DIRECTIONS ARE ASSERTED, because a fix that silences the guard is worse
 * than the bug it silenced: an idle player must be left alone, AND a player
 * who cuts somebody must still have the patrol on them. A check that only held
 * the first would pass on a station with no consequence at all.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';

/**
 * No `fetch` in node — the imported rooms are read off disk and handed to the
 * same decoder the browser uses, which is what `flightops.mjs` does and for
 * the same reason: the check then measures the shipped path.
 *
 * IT CHAINS RATHER THAN REPLACING, and that is the whole of a regression this
 * file caused. The gate runs every suite in ONE process, so a global `fetch`
 * swapped for a file-only reader is swapped for every suite that follows.
 * Three of them — `serve`, `keyart` and `music` — start a real dev server and
 * ask it for a real URL, and all three failed with "The URL must be of scheme
 * file", pointing at this line. A shim that answers the question it was
 * written for and hands everything else back to the previous implementation
 * cannot do that to a stranger.
 */
function diskFetch() {
  if (globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  const prev = globalThis.fetch;
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url, ...rest) => {
    const s = String(url);
    /* Anything with a scheme that is not `file:` belongs to somebody else. */
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith('file:')) {
      if (prev) return prev(url, ...rest);
      throw new TypeError(`no fetch for ${s}`);
    }
    const buf = await readFile(new URL(s, root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck) {
  const { bootWorld } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  const { clearStation } = await import('../../src/game/StationSave.js');
  diskFetch();
  /**
   * A CLEAN FOLD PER WORLD, because standing is now ONE number and that number
   * is durable. The gate runs every suite in one process and `makeStore` keeps
   * the fold in memory under node, so a clause that cuts somebody would hand
   * the next clause a station that already remembers it — and the first clause
   * here asserts that an idle player's standing is exactly 0. Clearing is the
   * honest isolation: it is the same door `clearStation`'s own note reserves
   * for a check.
   */
  clearStation();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

export async function run({ check, assert }) {
  check = await clocked(check);

  check('consequence: standing on the concourse is not an assault', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const world = await station(40);
    const input = idleInput();
    /* Sixty seconds is chosen off the measurement, not off taste: the shipped
     * fault reached "every shop shut" at 20 s and dispatched the patrol at 5.
     * A window that did not cover both would pass on the defect. */
    for (let f = 0; f < 60 * 60; f++) world.update(1 / 60, input);
    const life = world._stationLife;
    const res = world.enemies.filter((e) => e.stationName);
    const blamed = res.filter((e) => e.hurtByPlayer).length;
    assert(res.length > 4, `only ${res.length} residents — the deck is not populated, so this proves nothing`);
    assert(blamed === 0, `${blamed} of ${res.length} residents are marked as hurt by a player who pressed nothing`);
    assert(life.standing === 0, `standing fell to ${life.standing} with no input`);
    assert(life.guards.length === 0, `${life.guards.length} guards dispatched at an idle player`);
    assert(world.player.hp >= world.player.maxHp * 0.99,
      `the station took the idle player to ${world.player.hp.toFixed(0)} hp`);
    /* The crowd must also not be grinding itself down, which is the half that
     * would still be wrong if only the attribution were fixed. */
    const worst = res.reduce((a, e) => Math.min(a, e.hp / e.maxHp), 1);
    assert(worst > 0.9, `a resident is down to ${(worst * 100).toFixed(0)}% of health from being walked into`);
    return `60 s idle on deck 40 — ${res.length} residents, worst ${(worst * 100).toFixed(0)}%, `
      + `standing ${life.standing}, ${life.guards.length} guards, player ${world.player.hp.toFixed(0)} hp`;
  });

  check('consequence: the patrol crosses the ground and takes you', async () => {
    /**
     * ══ THE CLAUSE THIS FILE USED TO ASSERT WAS THE SPAWN ═════════════════
     *
     * It read `life.guards.length === 2` three seconds after the cut, and that
     * is TWO BODIES EXISTING. §11 says they COME. Measured against the code
     * that passed it, cutting a resident in the Concourse — the same deck as
     * the security post, its best case:
     *
     *     0s  guards 2  alarm 12.0  nearest 47.4 m
     *     10s guards 2  alarm  2.4  nearest 45.0 m
     *     15s guards 0  alarm   0    (deleted)
     *     closest approach over the whole alarm: 43.1 m
     *
     * A 12 s alarm and a 47 m spawn: the arrival was not slow, it was
     * arithmetically impossible, and off deck 40 it was worse — the post is a
     * deck-40 room, so both bodies were put on `DECK_Y[40] = 0` whatever deck
     * the player was on, 25 m under the feet of anyone in the Reactor hall.
     *
     * So this asserts the VERB. A closing distance, measured every frame,
     * against §5.3's own gate — *"attacking a resident summons a guard within
     * 10 s"* — and the vertical separation, which is the deck bug's own
     * signature and cannot be seen in a horizontal number.
     */
    const { idleInput } = await import('./_coop.mjs');
    const { servedHere } = await import('../../src/game/StationLife.js');
    const world = await station(40);
    const input = idleInput();
    for (let f = 0; f < 60 * 6; f++) world.update(1 / 60, input);
    const victim = world.enemies.find((e) => e.stationName);
    assert(victim, 'no resident on deck 40 to cut');
    const life = world._stationLife;
    const before = life.standing;
    /* THE SHIPPED DOOR FOR A DECK CHANGE, recorded rather than taken: the
     * Brig is on deck 48 and `main.js` rebuilds the world to get there. */
    let asked = null;
    world.onDeckLift = (row) => { asked = row; };
    victim.damage(25, victim.position.clone(), world.player, 'saber');
    assert(victim.hurtByPlayer === true, 'a cut by the player did not mark the resident');

    let spawned = 0, first = null, closest = Infinity, worstY = 0, took = null;
    for (let f = 0; f < 60 * 15 && took === null; f++) {
      world.update(1 / 60, input);
      spawned = Math.max(spawned, life.guards.length);
      const p = world.player.position;
      for (const g of life.guards) {
        const d = Math.hypot(p.x - g.position.x, p.z - g.position.z);
        if (first === null) first = d;
        closest = Math.min(closest, d);
        worstY = Math.max(worstY, Math.abs(g.position.y - p.y));
      }
      if (life.arrest) took = (f + 1) / 60;
    }
    assert(spawned === 2, `${spawned} guards came — faction.py says a patrol unit is two, always`);
    assert(worstY < 1.5, `a guard stood ${worstY.toFixed(1)} m above or below the player — it is on another deck`);
    assert(first > 8, `the patrol was put down ${first.toFixed(1)} m away, which is on top of the player`);
    assert(closest <= 3.5, `the patrol's closest approach was ${closest.toFixed(1)} m — it never reached you`);
    assert(first - closest > 6,
      `the patrol closed ${(first - closest).toFixed(1)} m of ${first.toFixed(1)} — it did not come, it stood there`);
    assert(took !== null && took <= 10,
      `nobody had hands on the player ${took === null ? 'at all' : `until ${took.toFixed(1)} s`} — §5.3 allows ten seconds`);
    assert(life.standing < before, `standing did not fall after a cut (${before} -> ${life.standing})`);
    assert(servedHere(world) === false, 'the kiosks still serve a player the patrol has just arrested');
    assert(asked && asked.deck === 48 && asked.level === 'station',
      `the arrest asked the lift for ${asked ? JSON.stringify(asked) : 'nothing'} — the Brig is #47 on deck 48`);
    return `cut ${victim.stationName}: 2 guards in from ${first.toFixed(1)} m, closest ${closest.toFixed(1)} m, `
      + `hands on at ${took.toFixed(1)} s (§5.3 allows 10), dy ${worstY.toFixed(2)} m, `
      + `standing ${before} -> ${life.standing}, transfer to deck ${asked.deck} asked`;
  });

  check('consequence: you wake in the Brig, and the kiosks are shut for a day', async () => {
    /**
     * §11's second and third clauses, neither of which existed: `grep -rni
     * brig src/` answered with the plan row that BUILDS #47 and a comment
     * quoting the sentence. Nothing arrested you, nothing moved you, and "for
     * a day" was `standing > -6` — not a duration at all, so two collected
     * jobs put the shutter straight back up.
     *
     * Deck 48 is the Brig's own deck, so the whole of an arrest happens in
     * one world here and the check can stand in the cell and measure it. The
     * transfer from another deck is the clause above: it asserts the lift is
     * asked, which is the only half of it that exists before the world is
     * rebuilt.
     */
    const { idleInput } = await import('./_coop.mjs');
    const { servedHere } = await import('../../src/game/StationLife.js');
    const SS = await import('../../src/game/StationSave.js');
    const { PLACE, floorOf } = await import('../../src/game/StationPlan.js');
    const world = await station(48);
    const input = idleInput();
    for (let f = 0; f < 60 * 6; f++) world.update(1 / 60, input);
    const victim = world.enemies.find((e) => e.stationName);
    assert(victim, 'no resident on deck 48 to cut');
    const hour0 = SS.stationHour();
    victim.damage(25, victim.position.clone(), world.player, 'saber');
    const life = world._stationLife;
    for (let f = 0; f < 60 * 15 && !life.arrest?.woke; f++) world.update(1 / 60, input);
    assert(life.arrest?.woke === true, 'the patrol reached the player on the Brig\'s own deck and nothing happened');

    /* IN THE ROOM, on its own floor — the footprint test `Station.placeUnder`
     * uses, so "in the Brig" means what the gazetteer means by it. */
    const cell = PLACE.get(47);
    const p = world.player.position;
    const dx = p.x - cell.x, dz = p.z - cell.z;
    const c = Math.cos(-cell.yaw), sn = Math.sin(-cell.yaw);
    const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    assert(Math.abs(lx) <= cell.w / 2 && Math.abs(lz) <= cell.d / 2,
      `the player woke ${Math.hypot(dx, dz).toFixed(1)} m from #47's middle, outside a ${cell.w}x${cell.d} m room`);
    assert(Math.abs(p.y - floorOf(cell)) < 1.5,
      `the player woke ${(p.y - floorOf(cell)).toFixed(1)} m off the Brig's own floor`);
    assert(SS.brigPending() === false, 'the arrest is still pending after the player was put in the cell');

    /* THE HOURS IN THE CELL, and the day the counters open again. */
    const slept = ((SS.stationHour() - hour0) + 24) % 24;
    assert(slept > 1, `no time passed in the cell (${hour0.toFixed(1)} -> ${SS.stationHour().toFixed(1)})`);
    assert(servedHere(world) === false, 'the kiosks serve a player who is in the cell');
    assert(SS.kiosksShut() === true, 'the fold does not think the counters are shut');
    /* AND IT IS A DAY AND NOT FOR EVER. The standing fall alone is -2, which
     * is inside the -6 gate, so what is refusing service here is the day. */
    SS.passStationHours(24);
    assert(SS.kiosksShut() === false, 'the shutter is still down a day later');
    assert(servedHere(world) === true,
      `the counters refuse a player at standing ${life.standing} a day after the arrest`);
    return `arrested on deck 48: woke inside #47 (${Math.hypot(dx, dz).toFixed(1)} m from its middle), `
      + `${slept.toFixed(1)} station hours in the cell, kiosks shut until day ${SS.loadStation().shut} `
      + `and serving again the day after`;
  });

  check('consequence: standing is one number, and it moves both ways inside a visit', async () => {
    /**
     * §11: *"your station `standing` drops (ONE NUMBER in `Session`)"*. It was
     * two. `life.standing` was seeded from `world.run?.stationStanding`,
     * `main.js` builds a fresh run bag per world and a deck is a world:
     *
     *     VISIT 1                      life.standing -10   fold -10   served no
     *     VISIT 2 (after a lift ride)  life.standing   0    fold -10   served YES
     *
     * so the refusal lasted one visit while `Counter.markupFor` — which
     * defaults to the FOLD — went on pricing the brawl. And the rise was
     * broken the other way: `payForJob` wrote +2 to the fold only, so within
     * a visit the number the kiosk door read could never go up.
     *
     * The three readers are asserted TOGETHER because agreement is the whole
     * property: the counters, the pits and the kiosk door.
     */
    const { idleInput } = await import('./_coop.mjs');
    const SL = await import('../../src/game/StationLife.js');
    const SS = await import('../../src/game/StationSave.js');
    const { markupFor } = await import('../../src/game/Counter.js');
    const world = await station(40);
    const input = idleInput();
    for (let f = 0; f < 60 * 3; f++) world.update(1 / 60, input);
    const life = world._stationLife;

    /* THE FALL, through the shipped path. */
    const victim = world.enemies.find((e) => e.stationName);
    assert(victim, 'no resident on deck 40 to cut');
    victim.damage(25, victim.position.clone(), world.player, 'saber');
    world.update(1 / 60, input);
    assert(life.standing === SS.standing(),
      `two numbers again: life ${life.standing}, fold ${SS.standing()}`);
    assert(life.standing < 0, `the cut did not reach the durable fold (${life.standing})`);
    const priced = markupFor().mul;
    assert(priced > 1, `the counters price at ${priced.toFixed(3)} for a player who has just cut somebody`);

    /* THE RISE, through `payForJob`'s own door — `setStanding` — and it must
     * be felt by the kiosk door in this same visit. */
    const low = life.standing;
    SS.setStanding(SS.standing() + 6);
    assert(life.standing === low + 6,
      `work moved the fold to ${SS.standing()} and the station's own number stayed at ${life.standing}`);
    assert(markupFor().mul < priced, 'the counters did not notice the standing coming back up');

    /* AND NOTHING SEEDS IT OFF THE RUN BAG ANY MORE, which is the mechanism
     * the ride used to throw it away. */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/StationLife.js', import.meta.url), 'utf8');
    const live = src.replace(/\/\*[\s\S]*?\*\//g, '');
    assert(!/stationStanding/.test(live),
      'StationLife still reads or writes run.stationStanding — that is the second number');
    return `one number: cut -> ${low} (fold ${SS.standing()}, markup x${priced.toFixed(3)}), `
      + `+6 of work -> ${life.standing} and the counters see it at once`;
  });

  check('consequence: a jostle buys nothing and a heavy striker still lands', async () => {
    const { KINETIC_BODY, KINETIC, KINETIC_THROWN, KINETIC_MIN_APPROACH } = await import('../../src/game/Impact.js');
    const { impactDamage } = await import('../../src/game/Combat.js');
    assert(KINETIC_BODY.jostle > 0, 'KINETIC_BODY declares no jostle floor');
    /**
     * The curve is `m·v²·k`, and BOTH bounds are read off it rather than
     * typed. The tuning note above `KINETIC_MIN_APPROACH` prices its example
     * at "a walker reads 8.6 at 4 m/s" — that is the 900 kg WALKER, the
     * vehicle, not a person walking, and reading it the other way is what
     * this clause got wrong the first time it was written. A person is 80 kg
     * and reads 0.77 at the same speed.
     */
    const PERSON = 80, WALKER = 900;
    const brush = impactDamage(PERSON, KINETIC_MIN_APPROACH, KINETIC_BODY);
    const heavy = impactDamage(WALKER, 4, KINETIC_BODY);
    assert(brush < KINETIC_BODY.jostle,
      `a person at the approach gate reads ${brush.toFixed(2)}, which the floor of ${KINETIC_BODY.jostle} lets through`);
    assert(heavy > KINETIC_BODY.jostle,
      `a 900 kg walker at 4 m/s reads ${heavy.toFixed(2)} and the floor of ${KINETIC_BODY.jostle} eats it`);
    /* It is on the body tune ALONE. A crate is not a shoulder, and a thrown
     * thing has KINETIC_THROWN's floor of 8 precisely because you meant it. */
    assert(!KINETIC.jostle, 'the crate tune grew a jostle floor — a dropped crate is not a shoulder brush');
    assert(!KINETIC_THROWN.jostle, 'the throw tune grew a jostle floor — a throw is an act, not a contact');
    return `person-brush ${brush.toFixed(2)} refused, 900 kg walker ${heavy.toFixed(2)} lands, floor ${KINETIC_BODY.jostle}`;
  });

  check('consequence: a resident carries the mark, and a blow that is meant still lands', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const world = await station(40);
    const input = idleInput();
    for (let f = 0; f < 60 * 6; f++) world.update(1 / 60, input);
    const res = world.enemies.filter((e) => e.stationName);
    assert(res.length > 4, `only ${res.length} residents — this proves nothing`);
    assert(res.every((e) => e.noAmbientHarm === true),
      'a station resident is not marked noAmbientHarm, so a crowd can still bill it');
    /**
     * ONLY THE MARK AND THE AUTHORED HALF ARE TESTED HERE, and the omission is
     * deliberate. `noAmbientHarm` is read in `Impact.kineticContact`, which is
     * where an unauthored blow actually comes from — so calling `damage(…,
     * null, …)` by hand would not go through the rule at all, and asserting on
     * it would be asserting a behaviour nothing implements. The first clause
     * in this file already proves the unauthored direction the only way it can
     * be proved honestly: sixty seconds of a real crowd on a real deck, with
     * the worst resident still at full health.
     */
    const one = res[0];
    const before = one.hp;
    one.damage(12, one.position.clone(), world.player, 'force');
    assert(one.hp < before, 'a blow the player meant did not land on a resident');
    assert(one.hurtByPlayer === true, 'a blow the player meant did not mark the resident');
    return `${res.length} residents all marked; the player's 12 took ${before.toFixed(0)} -> ${one.hp.toFixed(0)} hp`;
  });

  check('consequence: nobody on the concourse is hunting you', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const world = await station(40);
    const input = idleInput();
    for (let f = 0; f < 60 * 5; f++) world.update(1 / 60, input);
    const res = world.enemies.filter((e) => e.stationName);
    assert(res.length > 4, `only ${res.length} residents — this proves nothing`);
    /**
     * THE ASYMMETRY, AND WHY A TEAM CANNOT HOLD IT.
     *
     * `world.rules` on a station is `{pvp:false, friendlyFire:true}`, and the
     * friendly fire is load-bearing: §11's "cut or throw one" REQUIRES the
     * player to be able to harm a resident. But `canHarm` is symmetric, so the
     * same rule that lets you cut a shopkeeper let the shopkeeper come for
     * you — `hostileTo` handed `pickTarget` the player and all 28 bodies on
     * deck 40 walked at them at 2.7 m/s, on 292 of 300 frames.
     *
     * Both halves are asserted because either alone is satisfiable by a
     * broken game: turning friendly fire off would pass the first and silently
     * delete §11, and the guard clause above would pass on a station where
     * nothing can be harmed at all.
     */
    assert(world.rules?.friendlyFire === true,
      'friendly fire is off on the station — §11\'s "cut or throw one" cannot happen');
    const hunting = res.filter((e) => e.target === world.player);
    assert(hunting.length === 0,
      `${hunting.length} of ${res.length} residents have the player as their target`);
    /* And they are not merely target-less — they must not be COMING. A body
     * that picked nobody but still walks at you would pass the clause above. */
    const at = res.map((e) => e.position.clone());
    const was = res.map((e) => e.position.distanceTo(world.player.position));
    for (let f = 0; f < 60 * 3; f++) world.update(1 / 60, input);
    let worst = 0;
    const closed = [];
    res.forEach((e, i) => {
      if (!world.enemies.includes(e)) return;
      worst = Math.max(worst, e.position.distanceTo(at[i]));
      closed.push(was[i] - e.position.distanceTo(world.player.position));
    });
    closed.sort((a, b) => a - b);
    const median = closed.length ? closed[closed.length >> 1] : 0;
    const nearest = closed.length ? closed[closed.length - 1] : 0;
    /**
     * ── IT IS THE CLOSING AND NOT THE TRAVEL, AND THAT IS THE PROPERTY ───
     *
     * This asserted `travel < 3 m in 3 s`, which is 1 m/s — UNDER a walking
     * pace. `WALK_PACE` times a walker's own 0.86–1.14 is about 1.53 m/s, so
     * a corridor walker doing exactly what §2.5 asks of it covers 4.6 m in
     * three seconds and failed a check about hunting. Measured on deck 40
     * with nobody chasing anybody: the six busiest bodies moved 4.29–4.61 m
     * and their closing on the player ran +4.46 to −4.31 — people walking
     * past, half of them toward and half away, which is a crowd.
     *
     * The defect this clause exists to catch measured differently and that is
     * the whole point: all 28 bodies carried the player as `target` and closed
     * a MEDIAN 4.86 m in five seconds, on 292 of 300 frames. A crowd going
     * about its business has a median closing of about zero however fast its
     * feet move, so the median is what is asserted, with a cap on the single
     * worst body — a real charge at 2.7 m/s closes eight metres in three
     * seconds and cannot hide inside either number.
     */
    assert(Math.abs(median) < 1.5,
      `the crowd closed a median ${median.toFixed(2)} m on the player in 3 s — it is coming for you`);
    assert(nearest < 6,
      `a resident closed ${nearest.toFixed(2)} m on the player in 3 s with nobody to chase`);
    return `${res.length} residents, 0 hunting, worst travel ${worst.toFixed(2)} m in 3 s, `
      + `median closing ${median.toFixed(2)} m (worst ${nearest.toFixed(2)}), `
      + 'friendly fire still on so §11 can happen';
  });
}
