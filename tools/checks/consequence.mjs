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

/** No `fetch` in node — the imported rooms are read off disk and handed to the
 *  same decoder the browser uses, which is what `flightops.mjs` does and for
 *  the same reason: the check then measures the shipped path. */
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

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

  check('consequence: cut one and the patrol still comes', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const world = await station(40);
    const input = idleInput();
    for (let f = 0; f < 60 * 6; f++) world.update(1 / 60, input);
    const victim = world.enemies.find((e) => e.stationName);
    assert(victim, 'no resident on deck 40 to cut');
    const before = world._stationLife.standing;
    /* Through the shipped damage door with the player as the source — the same
     * call a blade lands. Nothing here is hand-set: `hurtByPlayer` and the
     * standing fall are both the production path's own work. */
    victim.damage(25, victim.position.clone(), world.player, 'saber');
    assert(victim.hurtByPlayer === true, 'a cut by the player did not mark the resident');
    for (let f = 0; f < 60 * 3; f++) world.update(1 / 60, input);
    const life = world._stationLife;
    assert(life.standing < before, `standing did not fall after a cut (${before} -> ${life.standing})`);
    assert(life.alarm > 0, 'no alarm was raised by a cut');
    assert(life.guards.length === 2,
      `${life.guards.length} guards came — faction.py says a patrol unit is two, always`);
    return `cut ${victim.stationName} for 25 — standing ${before} -> ${life.standing}, `
      + `alarm ${life.alarm.toFixed(1)}, ${life.guards.length} guards`;
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

  check('consequence: a resident is hurt by somebody who meant it, and nothing else', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const world = await station(40);
    const input = idleInput();
    for (let f = 0; f < 60 * 6; f++) world.update(1 / 60, input);
    const res = world.enemies.filter((e) => e.stationName);
    assert(res.length > 4, `only ${res.length} residents — this proves nothing`);
    assert(res.every((e) => e.noAmbientHarm === true),
      'a station resident is not marked noAmbientHarm, so a crowd can still bill it');
    const one = res[0];
    const before = one.hp;
    /* Unauthored — a crowd, a door, a passing droid. It must pass through. */
    one.damage(12, one.position.clone(), null, 'force');
    assert(one.hp === before, `an unauthored contact took ${(before - one.hp).toFixed(1)} off a resident`);
    /* Authored — a hand that meant it. It must land in full. */
    one.damage(12, one.position.clone(), world.player, 'force');
    assert(one.hp < before, 'a blow the player meant did not land on a resident');
    return `unauthored 12 -> no change at ${before.toFixed(0)} hp; the player's 12 -> ${one.hp.toFixed(0)} hp`;
  });
}
