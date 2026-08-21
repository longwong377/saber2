/**
 * BATTLEFIELD BORZ — WHAT A STRATAGEM COSTS.
 *
 * "strategems should not cost force how does that even fucking make sense?
 *  maybe there's a bar and it shows the level of outside support and resources
 *  that have built up, and different strategems cost more obviously but when
 *  you use them it depletes your side's support resources so like carriers
 *  rearming, etc. does that make sense?"
 *
 * It made none. `Stratagems._open` called `player._spend(s.cost)` — the pool
 * that buys a Force push — so an orbital strike was paid for out of a Jedi's
 * connection to the Force. Past the fiction it cost something real in play:
 * the comm and the powers drew on one bar, so a run that leaned on stratagems
 * could not lift a walker, and two systems meant to be different ways of
 * fighting were one resource with two spouts.
 *
 * Four properties, and each is a clause of the note.
 */

export async function run({ check, assert }) {
  const boot = async () => {
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    return { world, player: world.player, input: H.idleInput() };
  };

  check('support: a call costs the side\'s supply line and not the player\'s Force', async () => {
    const { world, player } = await boot();
    const { STRATAGEMS, supportCost } = await import('../../src/game/Stratagems.js');
    const sup = world.support;
    assert(sup, 'the world has no war support pool');
    const heavy = [...STRATAGEMS].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0];
    const force0 = player.force;
    const pool0 = sup.value;
    const ok = player.stratagems._open(heavy, { world, enemies: [] });
    assert(ok, `the opening call (${heavy.id}) was refused on a full pool`);
    assert(player.force === force0,
      `calling ${heavy.id} took ${(force0 - player.force).toFixed(1)} Force — that is the defect`);
    assert(sup.value < pool0,
      `the supply line did not move: ${pool0.toFixed(1)} → ${sup.value.toFixed(1)}`);
    assert(Math.abs((pool0 - sup.value) - supportCost(heavy)) < 1e-6,
      `${heavy.id} charged ${(pool0 - sup.value).toFixed(1)} against a price of ${supportCost(heavy)}`);
    return `${heavy.id}: ${supportCost(heavy)} support, 0 Force (pool ${pool0.toFixed(0)} → ${sup.value.toFixed(0)})`;
  });

  check('support: the calls are priced apart, and the dearest is half the bar', async () => {
    /* "different strategems cost more obviously". Derived from each row's own
     * `cost` rather than a second table — that field also decides how long the
     * CODE is, so a hand-kept support price beside it is HANDOFF §2.3 in the one
     * file that can least afford one. */
    const { STRATAGEMS, supportCost } = await import('../../src/game/Stratagems.js');
    const { SUPPORT_MAX } = await import('../../src/game/Support.js');
    const rows = STRATAGEMS.map((s) => ({ id: s.id, force: s.cost ?? 0, sup: supportCost(s) }));
    const dear = rows.reduce((m, r) => (r.sup > m.sup ? r : m));
    const cheap = rows.reduce((m, r) => (r.sup < m.sup ? r : m));
    assert(dear.sup > cheap.sup * 2.5,
      `the dearest call is ${dear.sup} and the cheapest ${cheap.sup} — that is not "costs more obviously"`);
    assert(Math.abs(dear.sup - SUPPORT_MAX / 2) < 1,
      `the dearest call is ${dear.sup} of ${SUPPORT_MAX} — the bar is meant to hold two of them`);
    /* AND THE ORDER IS THE FORCE TABLE'S ORDER, because the balance of the whole
     * table was struck on those numbers and this is a change of currency. */
    const byForce = [...rows].sort((a, b) => a.force - b.force).map((r) => r.id);
    const bySup = [...rows].sort((a, b) => a.sup - b.sup).map((r) => r.id);
    assert(byForce.join() === bySup.join(),
      `the support prices reorder the table: ${byForce.join(',')} against ${bySup.join(',')}`);
    return `${cheap.id} ${cheap.sup} … ${dear.id} ${dear.sup} of ${SUPPORT_MAX}, same order as the Force table`;
  });

  check('support: carriers rearm — the bar does not start refilling the moment it is spent', async () => {
    /**
     * THE PHRASE IS THE MECHANIC. Without a rearm hold the pool is a second
     * cooldown with extra steps: spend, and it begins climbing again on the
     * same frame. With it, a big call puts the NEXT one further away than its
     * own cooldown says, and the decision is about the shape of the engagement
     * rather than about one button.
     */
    const { world, input } = await boot();
    const { STRATAGEMS, supportCost } = await import('../../src/game/Stratagems.js');
    const { REARM, SUPPORT_MAX } = await import('../../src/game/Support.js');
    const sup = world.support;
    const heavy = [...STRATAGEMS].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0];
    world.player.stratagems._open(heavy, { world, enemies: [] });
    const after = sup.value;
    assert(sup.rearming, 'the supply line is not rearming the frame after a heavy call');
    const want = REARM * (supportCost(heavy) / SUPPORT_MAX);
    assert(Math.abs(sup.rearm - want) < 0.05,
      `the rearm is ${sup.rearm.toFixed(2)} s against ${want.toFixed(2)} for a call of that size`);
    /* Halfway through the hold it has not moved. */
    for (let i = 0; i < Math.floor(want * 0.5 * 60); i++) world.update(1 / 60, input);
    assert(Math.abs(sup.value - after) < 1e-6,
      `the pool climbed ${(sup.value - after).toFixed(2)} while the ships were still turning round`);
    /* And past it, it does. */
    for (let i = 0; i < Math.ceil(want * 60) + 120; i++) world.update(1 / 60, input);
    assert(!sup.rearming, 'the rearm never ended');
    assert(sup.value > after + 1,
      `the pool is ${sup.value.toFixed(1)} against ${after.toFixed(1)} after the rearm — it never resumed`);
    return `${want.toFixed(1)} s of rearm held the pool flat, then it climbed to ${sup.value.toFixed(0)}`;
  });

  check('support: it builds off the side doing well, and it does not survive the run', async () => {
    /**
     * "the level of outside support and resources that have BUILT UP." A pool
     * that only trickles is a timer; one that answers what the side is doing is
     * a resource. Kills, cleared waves and held ground all credit it — and the
     * hooks are asserted where they are, because a credit hung on the wrong
     * event is invisible until somebody plays for an hour.
     *
     * AND IT DIES WITH THE RUN. `Progress.js` is the written law that this game
     * has no cross-run power, and a support pool you bank between runs is a
     * meta-progression wearing a supply metaphor.
     */
    const { readFile } = await import('node:fs/promises');
    const { WarSupport, SUPPORT_EARN, SUPPORT_START } = await import('../../src/game/Support.js');
    const s = new WarSupport();
    s.value = 10;
    const k = s.credit('kill');
    assert(k > 0, 'a kill credits nothing');
    const w = s.credit('wave');
    assert(w > k * 4, `a cleared wave is worth ${w} against a kill's ${k} — the events are not priced apart`);
    assert(s.credit('area') > w, 'holding ground is worth less than clearing one wave');
    /* It cannot overflow, and a credit past the ceiling reports what it
     * actually took rather than what it was offered. */
    s.value = s.max - 1;
    assert(s.credit('area') <= 1.0001, 'a credit past the ceiling reported more than it added');
    assert(s.value === s.max, 'the pool went past its own ceiling');

    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert(/support\?\.credit\('kill'\)/.test(code), 'nothing credits the pool on a kill');
    assert(/support\?\.credit\('wave'\)/.test(code), 'nothing credits the pool on a cleared wave');
    assert(/this\.support\?\.update\(/.test(code), 'World never steps the pool — it would never refill');
    const cmd = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/support\?\.credit\('area'\)/.test(cmd), 'nothing credits the pool for holding ground');

    /* A NEW BATTLE OPENS AT THE SAME NUMBER. Two pools, built fresh, agree. */
    assert(new WarSupport().value === SUPPORT_START && new WarSupport().value === new WarSupport().value,
      'a fresh pool does not open at SUPPORT_START — something is carrying between runs');
    const prog = await readFile(new URL('../../src/game/Progress.js', import.meta.url), 'utf8');
    assert(!/support/i.test(prog.replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'Progress.js mentions support — the pool is being written into the profile');
    return `kill ${SUPPORT_EARN.kill} · wave ${SUPPORT_EARN.wave} · area ${SUPPORT_EARN.area}; `
      + `every battle opens at ${SUPPORT_START}`;
  });

  check('smoke: the screen is a wall, and it blinds both sides by degrees', async () => {
    /**
     * "I like that the strategems are more deadly and impactful, one thing the
     *  smoke screen needs to be way bigger and more useful, it should effect
     *  your allies and your enemies ability to aim obviously if it does not
     *  right now."
     *
     * TWO HALVES, and only one of them was already true.
     *
     * IT DID BLIND, symmetrically: `Enemy._canSee` gates target acquisition at
     * `SMOKE_SEE` transmittance and the bolt loses damage crossing a cloud, and
     * neither knows who fired. That much was sound.
     *
     * WHAT WAS MISSING IS THE MIDDLE. Between "can see perfectly" and "cannot
     * acquire at all" there was nothing: a shooter looking through a thinning
     * bank, or clipping the edge of one, aimed exactly as well as one in clear
     * air right up to the frame it went blind. So the same integral now widens
     * the CONE, which is what "ability to aim" means.
     *
     * AND IT WAS SMALL. Four canisters at 8.5 m on a 7 m pitch is a 31 m bank
     * — narrower than the distance the lines in this game stand apart.
     */
    const THREE = await import('three');
    const Smoke = await import('../../src/game/Smoke.js');
    const { STRATAGEM_BY_ID, SMOKE_CANS } = await import('../../src/game/Stratagems.js');

    /* ── THE SIZE ─────────────────────────────────────────────────────── */
    assert(SMOKE_CANS >= 6, `${SMOKE_CANS} canisters — the screen is supposed to be a wall`);
    const row = STRATAGEM_BY_ID.smoke;
    assert(row.radius >= 20, `the designation ring is ${row.radius} m — it has to cover what it lays`);

    /* ── THE MIDDLE OF THE SCALE ──────────────────────────────────────── */
    Smoke.clearSmoke();
    const at = new THREE.Vector3(0, 0, 0);
    const c = Smoke.addSmoke(at, 12, 22);
    /* Aged past the bloom so it is at full density, which is the state the
     * measurement is about. */
    Smoke.updateSmoke(Smoke.BLOOM + 0.05);
    const eye = new THREE.Vector3(0, 1.2, -40);
    const thru = (x) => Smoke.seeThrough(eye, new THREE.Vector3(x, 1.2, 40));
    const dead = thru(0);        // straight through the middle
    const edge = thru(11.2);     // clipping the rim
    const clear = thru(60);      // nowhere near it
    assert(clear > 0.99, `a line nowhere near the cloud reads ${clear.toFixed(3)} — the integral is wrong`);
    assert(dead < 0.05, `the middle of a 12 m bank lets ${(dead * 100).toFixed(1)}% through — that is not a wall`);
    assert(edge > dead && edge < clear,
      `the rim reads ${edge.toFixed(3)} against ${dead.toFixed(3)} dead centre and ${clear.toFixed(3)} clear — `
      + 'there is no middle to the scale, which is the half that was missing');

    /* ── AND THE CONE OPENS WITH IT ───────────────────────────────────── */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8');
    const line = /const spread = [^;]*;/.exec(src.replace(/\n\s*/g, ' '));
    assert(line, "Enemy.js no longer computes a `spread` — this check describes a line that is gone");
    assert(/murk/.test(line[0]),
      `the firing spread does not read the smoke: ${line[0]} — a shooter half-blinded by the screen `
      + 'still aims perfectly, which is exactly the note');
    /* SYMMETRIC. Nothing in Smoke.js may know who fired — that is what makes
     * laying one a decision rather than a free win. */
    const smokeSrc = await readFile(new URL('../../src/game/Smoke.js', import.meta.url), 'utf8');
    const body = smokeSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert(!/\bteam\b|\bowner\b|\bfaction\b/.test(body),
      'Smoke.js knows who fired — the cloud has to be symmetric by construction');
    Smoke.clearSmoke();
    return `${SMOKE_CANS} cans × 12 m; centre ${(dead * 100).toFixed(1)}% through, rim `
      + `${(edge * 100).toFixed(0)}%, clear ${(clear * 100).toFixed(0)}%; spread reads the smoke`;
  });
}
