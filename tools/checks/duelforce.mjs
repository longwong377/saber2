/**
 * BATTLEFIELD BORZ — FIGHTING SOMEBODY WHO HAS THE FORCE TOO.
 *
 * The player, having lost several fights to one:
 *
 *   "have you explained anywhere in the instructions or codex how force vs
 *    force user combat works? I still don't know how to counter or fight
 *    against other force users when they are using their force powers against
 *    me like I'm just being manipulated and thrown around like a ragdoll being
 *    unable to do anything… also they need to be subject to the same force
 *    resources and limitations that effect me based on how strong they are"
 *
 * ── WHAT WAS ACTUALLY WRONG, WHICH IS NOT WHAT IT LOOKS LIKE ─────────────
 *
 * Every counter this game has already existed. `forceResistance` blunts an
 * incoming power out of your own pool; a cast is declared `CAST_WIND` seconds
 * before it lands and dies if you beat the caster's guard inside that window;
 * the caster pays when the call goes up, so a broken cast is a wasted one; and
 * their pool is finite and slow to come back. Four answers, all shipped, ALL
 * INVISIBLE — none of them was written anywhere a player could read, and the
 * enemy's own pool was drawn nowhere on screen at all. A resource the other
 * side spends and you cannot see is not a resource you can play against; it is
 * weather, which is exactly the word "being thrown around unable to do
 * anything" describes.
 *
 * So this suite holds three things, and the first two are why the third is
 * worth teaching:
 *
 *   1. the counters WORK — measured, not asserted from source text;
 *   2. the enemy's limits scale with the body rather than being flat;
 *   3. the page that teaches them quotes the code's own numbers, so the lesson
 *      cannot outlive the tuning pass that changes them (HANDOFF §2.3).
 */

import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  /* Several checks here drive a real World, which advances the wind clock and
   * both seeded streams — see `determinism.mjs`. */
  check = await clocked(check);

  const boot = async () => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(41);
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const p = world.player;
    const at = new THREE.Vector3(p.position.x, p.position.y, p.position.z - 7);
    const foe = world.spawnEnemy('acolyte', at);
    assert(foe, 'no acolyte spawned');
    const input = H.idleInput();
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    return { world, p, foe, input, THREE };
  };

  check('force duel: a full pool blunts what is thrown at you, and a beaten guard does not', async () => {
    /**
     * THE FIRST ANSWER, AND THE ONE NOTHING TOLD THE PLAYER ABOUT. Two
     * identical blows, one against a full pool and one against an empty one,
     * measured in the only terms that matter: how much health it took and how
     * far it moved you.
     *
     * `RESIST_CAP` is the ceiling and `RESIST_BEATEN` is what is left of it
     * while you are already staggered — which is the mechanical content of
     * "the throw that hurts is always the second one".
     */
    const { world, p, foe, input, THREE } = await boot();
    const blow = () => new THREE.Vector3(0, 4, 18);
    const measure = (force, staggered) => {
      p.hp = p.maxHp; p.force = force; p.maxForce = 100;
      p.velocity.set(0, 0, 0);
      p.invuln = 0;
      p.staggerTimer = staggered ? 0.2 : 0;
      const before = p.hp;
      p.applyKnockback(blow(), 30, foe);
      return { took: before - p.hp, speed: p.velocity.length(), left: p.force };
    };
    const full = measure(100, false);
    const empty = measure(0, false);
    const beaten = measure(100, true);
    assert(full.took < empty.took - 1,
      `a full pool took ${full.took.toFixed(1)} hp and an empty one ${empty.took.toFixed(1)} — holding `
      + 'Force bought nothing, so the first counter in the Codex is a lie');
    assert(full.speed < empty.speed - 0.5,
      `the shove moved a full pool ${full.speed.toFixed(1)} m/s and an empty one ${empty.speed.toFixed(1)} `
      + '— resistance blunts the damage and not the throw, which is half a counter');
    assert(full.left < 100, 'the resistance was free — it is supposed to be paid for out of the pool');
    assert(beaten.took > full.took + 0.5,
      `staggered, a full pool still took ${beaten.took.toFixed(1)} hp against ${full.took.toFixed(1)} `
      + 'standing — RESIST_BEATEN is doing nothing');
    return `full ${full.took.toFixed(1)} hp / ${full.speed.toFixed(1)} m/s · empty `
      + `${empty.took.toFixed(1)} / ${empty.speed.toFixed(1)} · staggered ${beaten.took.toFixed(1)}`;
  });

  check('force duel: breaking a call costs them the power, and they had already paid for it', async () => {
    /**
     * THE SECOND ANSWER. `powers.mjs` proves a stagger BREAKS a wind-up; this
     * asks the question the player asks, which is what breaking it is WORTH.
     * The price leaves the pool when the call goes up — see `_castPower` — so
     * a cast you interrupt is Force they will not get back, and that is the
     * whole reason baiting one is a tactic rather than a delay.
     */
    const { world, p, foe, input } = await boot();
    /* A CLEAN SLATE FIRST, and this cost a wrong answer to find: by the time
     * the fixture had stepped the world twenty frames the acolyte had ALREADY
     * declared a lightning and paid for it, so a snapshot taken here and
     * compared after the next `_castTimer > 0` was comparing a pool against
     * itself and reporting that the price was never charged. Clearing the cast
     * in flight is what makes the next one a fresh one. */
    foe._castTimer = 0; foe._castKey = null; foe.casting = null;
    for (const k in foe.powerCd) foe.powerCd[k] = 0;
    foe.force = foe.forceMax;
    const before = foe.force;
    let armed = 0;
    for (let i = 0; i < 60 * 10 && !armed; i++) {
      world.update(1 / 60, input);
      if (foe._castTimer > 0) armed = i;
    }
    assert(armed, 'the acolyte never declared a power in ten seconds — this check measured nothing');
    assert(foe.force < before,
      'the call went up and the pool did not move — the price is supposed to be paid at the telegraph, '
      + 'which is what makes an interrupt worth something');
    const paid = before - foe.force;
    const key = foe._castKey;
    foe.stun(0.5, null, 1);
    world.update(1 / 60, input);
    assert(foe._castTimer <= 0 && foe.casting !== key,
      `a stagger did not break the ${key} that was already declared`);
    assert(foe.force < before,
      'the broken cast was refunded — an interrupt that costs the caster nothing is not a counter');
    return `${key} declared at frame ${armed}, ${paid.toFixed(0)} Force spent and lost to one stagger`;
  });

  check('force duel: the reserve empties, and an empty one cannot touch you', async () => {
    /* THE THIRD ANSWER, which is the one the new bar on screen is for: a body
     * with nothing left is a body you can walk up to. */
    const { world, p, foe, input } = await boot();
    const { ENEMY_POWERS, forceRegenFor } = await import('../../src/game/Enemy.js');
    /* Same clean slate as above — a cast already in flight is one that was paid
     * for while the pool was full. */
    foe._castTimer = 0; foe._castKey = null; foe.casting = null;
    foe.force = 0;
    /* HOW LONG THE EMPTY WINDOW ACTUALLY IS, derived rather than picked: the
     * pool comes back, so the claim is only true until they can afford their
     * cheapest verb. For an acolyte that is the 10-point choke against a
     * 3.4/s recovery — under three seconds, and a check that watched for four
     * would be failing on the reserve doing exactly what it should. */
    const cheapest = Math.min(...foe.powers.map((k) => ENEMY_POWERS[k].cost));
    const window = (cheapest / forceRegenFor(foe.forceMax)) * 0.8;
    let cast = 0;
    for (let i = 0; i < Math.round(window * 60); i++) {
      world.update(1 / 60, input);
      if (foe._castTimer > 0 || foe.casting) cast++;
    }
    assert(cast === 0,
      `an acolyte with an empty reserve declared ${cast} frames of power inside the `
      + `${window.toFixed(1)} s it takes to afford its cheapest verb (${cheapest})`);
    /* …and it does come back, or the counter would be a kill switch. */
    const after = foe.force;
    assert(after > 0, 'the pool never recovers at all');
    return `0 casts while the pool was under its cheapest verb; it recovered to ${after.toFixed(0)}`;
  });

  check('force duel: a stronger body holds more, not recovers faster', async () => {
    /**
     * THE PLAYER'S OWN CLAUSE: "based on how strong they are". They were
     * subject to a pool, a price, a cooldown and a telegraph — but the REGEN
     * was one flat number for the whole roster, so measured across the five
     * force users the time to refill an empty pool ran 13 s for a sentinel and
     * 50 s for a Master. The strongest body in the game had the longest road
     * back to being able to act, which is the opposite of what the sentence
     * asks for and, worse, made "strong" read from the outside as "quiet for
     * longer".
     *
     * A fraction of their own pool puts everyone on one clock. Strength then
     * means what you can spend before the clock starts — a thing the player can
     * watch on the bar and plan against.
     */
    const { ARCHETYPES, forceRegenFor, FORCE_REGEN_FRAC } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');
    await import('../../src/game/Command.js');
    const users = Object.entries(ARCHETYPES).filter(([, A]) => A.force > 0);
    assert(users.length >= 4, `only ${users.length} archetypes carry a Force pool`);
    const rows = users.map(([k, A]) => {
      const r = forceRegenFor(A.force);
      return { k, pool: A.force, regen: r, refill: A.force / r };
    });
    const refills = rows.map((r) => r.refill);
    const spread = Math.max(...refills) / Math.min(...refills);
    assert(spread < 1.6,
      `the roster's refill times span ${Math.min(...refills).toFixed(0)}–${Math.max(...refills).toFixed(0)} s `
      + `(${spread.toFixed(1)}×) — the pool is still a flat rate wearing a fraction`);
    /* AND STRENGTH IS STILL WORTH SOMETHING: the biggest pool must be a real
     * multiple of the smallest, or "how strong they are" means nothing. */
    const pools = rows.map((r) => r.pool);
    assert(Math.max(...pools) / Math.min(...pools) > 2,
      'every force user carries about the same reserve — strength is not expressed anywhere');
    const big = rows.reduce((a, b) => (b.pool > a.pool ? b : a));
    const small = rows.reduce((a, b) => (b.pool < a.pool ? b : a));
    assert(big.regen > small.regen,
      `${big.k} holds ${big.pool} and recovers at ${big.regen.toFixed(1)}/s while ${small.k} holds `
      + `${small.pool} and recovers at ${small.regen.toFixed(1)}/s`);
    return rows.map((r) => `${r.k} ${r.pool}@${r.regen.toFixed(1)}/s=${r.refill.toFixed(0)}s`).join(' · ')
      + ` (${Math.round(FORCE_REGEN_FRAC * 100)}%/s)`;
  });

  check('force duel: the Codex teaches the four answers, in the code\'s own numbers', async () => {
    /**
     * THE PAGE THE PLAYER ASKED FOR — and the reason it is checked rather than
     * trusted is HANDOFF §2.3: a hand-maintained table beside its generated
     * twin. A Codex that teaches a counter the game no longer has is worse
     * than one that teaches nothing, because a player will practise it.
     */
    const { codexTeaching } = await import('../../src/ui/Menu.js');
    const { RESIST_CAP, RESIST_BEATEN, RESIST_PER_FORCE, CAST_WIND,
            FORCE_REGEN_FRAC } = await import('../../src/game/Enemy.js');
    const html = codexTeaching({ difficulty: 'knight' });
    const has = (needle, what) => assert(html.includes(needle),
      `the Codex does not state ${what} ("${needle}" is not on the page)`);
    assert(/force user/i.test(html), 'the Codex has no section about fighting a Force user at all');
    has(`${Math.round(RESIST_CAP * 100)}%`, 'how much of a blow a full pool blunts (RESIST_CAP)');
    has(`${RESIST_PER_FORCE}`, 'what a point of Force buys in blunting (RESIST_PER_FORCE)');
    has(`${Math.round(RESIST_CAP * RESIST_BEATEN * 100)}%`,
      'what is left of your resistance while staggered (RESIST_BEATEN)');
    has(`${CAST_WIND.toFixed(2)}`, 'how long the telegraph lasts (CAST_WIND)');
    has(`${Math.round(FORCE_REGEN_FRAC * 100)}%`, 'how fast their reserve comes back (FORCE_REGEN_FRAC)');
    /* AND IT SAYS THE THING THAT MAKES THE INTERRUPT WORTH DOING. */
    assert(/already paid|paid for it/i.test(html),
      'the Codex never says the caster pays when the call goes up, which is the whole value of '
      + 'breaking one');
    return 'four answers, five figures, all read off Enemy.js';
  });

  check('force duel: their reserve is on screen while they are using it', async () => {
    /**
     * THE HALF THAT IS NOT A NUMBER. Every counter above is timed against
     * something the enemy is doing, and until this bar existed a duellist that
     * was not `boss` or `big` put NONE of it on screen — a Sith acolyte
     * throwing you across a room was, from the player's side, a body with no
     * state at all. The markup and the HUD are checked together because either
     * one alone is a feature that does not draw.
     */
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const hud = await readFile(new URL('../../src/ui/HUD.js', import.meta.url), 'utf8');
    assert(/id="boss-force"/.test(html), 'there is no element for an enemy\'s Force reserve');
    assert(/id="boss-cast"/.test(html), 'there is no element for what they are casting');
    assert(/bossForce\b/.test(hud) && /forceMax/.test(hud),
      'the HUD never reads an enemy\'s pool, so the track it owns is decoration');
    /* THE FILTER IS THE POINT: a force user has to reach the bar. */
    const { makeDocument } = await import('./_page.mjs');
    const doc = makeDocument(html);
    assert(doc.getElementById('boss-force-track'), 'the reserve track is not in the shipped markup');
    assert(/isCaster/.test(hud),
      'the boss bar still only picks `boss` or `big` bodies, so an acolyte with a full kit shows '
      + 'the player nothing to play against');
    return 'reserve track, cast readout, and a caster reaches the bar';
  });
}
