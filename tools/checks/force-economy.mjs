/**
 * BATTLEFRONT BORZ — THE FORCE ECONOMY, DRIVEN.
 *
 * `POWER_COST` is twelve numbers and `Player._spend` is one gate, and the whole
 * claim the pair makes is stated at the top of src/game/Powers.js: every power
 * goes through that gate, so the Force Drain slider and the `forceCost` boons
 * reach all of them and reach them to the same degree. That claim has now been
 * false twice, in two different ways, and both times the file went on asserting
 * it:
 *
 *   ROUND ONE — the ONE-SHOTS. `throwOrRecall` and `toggleSense` compared raw
 *     force against a literal and `forceLightning` applied the boon by hand but
 *     not the drain, so Force Drain 0 — the slider whose own label in
 *     index.html reads "Drain at 0 is unlimited Force" — freed six powers and
 *     kept charging for three. Fixed, and the header was updated.
 *
 *   ROUND TWO — the HOLDS, which nobody had looked at, because the header's
 *     sentence sounded like it covered them. Five of the twelve are channels
 *     that bill per frame; four go through `_spend`; Force Sense's was
 *     `this.force -= 22 * dt` in `_regen`, outside the economy entirely.
 *     Measured on a real World, holding it open from a full bar:
 *
 *         Force Drain 1 (default)            125 → 47.4, shut off at 5.67 s
 *         Force Drain 0 ("unlimited Force")  125 → 47.4, shut off at 5.67 s
 *         forceCost 0.05 (Tempest at flow 1) 125 → 47.4, shut off at 5.67 s
 *
 *     Three economies, one answer, and the one power on the wheel that a player
 *     leaves running was the one the settings could not reach.
 *
 * A grep cannot see either round: both are about what a number DOES, and both
 * versions read perfectly well as source. So nothing below reads Player.js as
 * text. Every check boots a real World, presses the real methods, and reads the
 * bar afterwards — and the arms are separated by ECONOMY rather than by power,
 * so a thirteenth power added tomorrow is measured by the same three arms
 * without this file being told it exists.
 *
 * ── AND A POWER THAT DECLINES SAYS WHY, WHICH IS MEASURED HERE AND NOT GREPPED
 *
 * tools/checks/force-feedback.mjs already asserts this and passed through the
 * whole of it: its structural half tests whether a method body CONTAINS
 * `_refuse(`, and `forceDisassemble` contained one — for its price — while four
 * other gates in the same method returned in silence. One sentence out of five
 * satisfies a substring and does not satisfy a player. The second half of this
 * file therefore drives each refusal STATE and counts the notices that arrive.
 */

import { clocked } from './_shared.mjs';

const STEP = 1 / 60;

export async function run({ check, assert }) {
  /* Every body here drives a real World, which advances the wind clock and both
   * seeded streams. See _shared.mjs. */
  check = await clocked(check);

  const { POWER_COST, SENSE_DRAIN } = await import('../../src/game/Powers.js');
  const H = await import('./_coop.mjs');

  /**
   * A player on a real level with a bar we can watch, plus a ledger of what the
   * economy actually charged.
   *
   * The ledger wraps `_spend` rather than diffing `player.force`, because
   * `_regen` refills 7.5 a second and would hide most of a one-shot inside two
   * frames of standing still — measured before it existed: a push read as
   * costing 0.0.
   *
   * `notify` is captured too, so the refusal half of the file needs no second
   * fixture.
   */
  const boot = async (settings = {}, mods = {}) => {
    const { world } = await H.bootWorld({
      level: 'colosseum',
      settings: { mode: 'sandbox', quality: 'low', forcePower: 1, forceDrain: 1, ...settings },
    });
    const p = world.player;
    const input = H.idleInput();
    for (let i = 0; i < 6; i++) world.update(STEP, input);
    /* The ORDER a Jedi is built with multiplies `forceCost` (Order.js), so a
     * bench that wants a stated multiplier has to write it rather than assume
     * the default is 1 — measured, the sandbox default arrives at 0.78. */
    Object.assign(p.boonMods, mods);
    p.force = p.maxForce;
    p.hp = p.maxHp;
    p.charged = 0;
    const spend = p._spend.bind(p);
    p._spend = function (cost, partial = false) {
      const before = this.force;
      const ok = spend(cost, partial);
      p.charged += Math.max(0, before - this.force);
      return ok;
    };
    p.notices = [];
    const notify = world.notify?.bind(world);
    world.notify = (t, s) => { p.notices.push({ t, s }); return notify?.(t, s); };
    const step = (n) => { for (let i = 0; i < n; i++) world.update(STEP, input); };
    return { world, p, input, step };
  };

  /* ────────────────────────────────────────────────────────────────────
   * THE HOLDS ARE INSIDE THE ECONOMY, NOT BESIDE IT
   * ──────────────────────────────────────────────────────────────────── */

  check('force-economy: Force Sense is billed by the same gate as everything else', async () => {
    /**
     * The regression test for round two, stated over the THREE things that are
     * allowed to move a price and driven one arm per fresh World (HANDOFF §2.5:
     * two arms in one process share a stream and a pool).
     *
     * `_regen` is stepped directly rather than through `world.update` so the
     * only thing moving the bar is the hold itself; the shutdown that ends it
     * is the game's own, called from inside `_regen`.
     */
    const hold = async (settings, mods) => {
      const b = await boot(settings, mods);
      const { p } = b;
      p.toggleSense(b.world);
      assert(p.senseActive, `Force Sense would not open at ${p.force.toFixed(0)} Force`);
      let off = null, min = Infinity;
      for (let i = 0; i < 60 * 12; i++) {
        p._regen(STEP);
        min = Math.min(min, p.force);
        if (!p.senseActive && off === null) off = i / 60;
      }
      return { charged: p.charged, off, min, cost: p.boonMods.forceCost };
    };

    const base = await hold({ forceDrain: 1 }, { forceCost: 1 });
    assert(base.off !== null, 'a Sense held for twelve seconds never ran the bar out');
    assert(base.min >= 0, `the pool reached ${base.min.toFixed(4)} — the bar goes below empty`);

    /* HALF THE PRICE, HALF AS FAST. `forceCost` is the multiplier the Consular
     * order, Tempest and two boon cards all move, and it reached eleven of the
     * twelve powers. The property is on the RATE rather than on a duration, so
     * it does not restate `SENSE_DRAIN`. */
    const half = await hold({ forceDrain: 1 }, { forceCost: 0.5 });
    const rate = (r) => r.charged / (r.off ?? 1);
    assert(Math.abs(rate(half) / rate(base) - 0.5) < 0.06,
      `forceCost 0.5 charged ${rate(half).toFixed(2)}/s against a full-price ${rate(base).toFixed(2)}/s `
      + '— the boon multiplier does not reach the Sense hold');

    /* AND AT DRAIN 0 IT IS FREE, which is what the slider's own label promises.
     * This is the arm the shipped build failed: it shut itself off at 5.67 s
     * with the setting that says "unlimited Force". */
    const free = await hold({ forceDrain: 0 }, { forceCost: 1 });
    assert(free.charged === 0,
      `Force Drain 0 still charged ${free.charged.toFixed(1)} for a held Sense`);
    assert(free.off === null,
      `at Force Drain 0 — "unlimited Force" — Sense shut itself off after ${free.off?.toFixed(2)}s`);

    return `full price ${rate(base).toFixed(1)}/s (out at ${base.off.toFixed(2)}s, floor ${base.min.toFixed(3)}), `
      + `forceCost 0.5 ${rate(half).toFixed(1)}/s, drain 0 free and open`;
  });

  check('force-economy: every power is billed at drain 1 and none of them at drain 0', async () => {
    /**
     * THE WHOLE TABLE, not a list typed here: the arms are derived from
     * `POWER_COST`, so a thirteenth entry is covered the day it is added. That
     * is the only version of this check that can fail on a power nobody
     * remembered to add to it.
     *
     * TWO ARMS, AND THE FIRST ONE IS WHAT MAKES THE SECOND MEAN ANYTHING. At
     * drain 0 `_spend` returns true and deducts nothing, so "nothing was
     * charged" is also what a fixture that refused every power would report —
     * which is the shape of green HANDOFF §2.5 is a section about. So the
     * identical loop is run at drain 1 first and every power has to be charged
     * SOMETHING there; only then is the drain-0 arm evidence about the economy
     * rather than about an empty arena.
     *
     * Each power is CAST and then stepped for a second of real frames, so a
     * channel's per-frame bill is inside the measurement and not just its
     * opening. Fresh World per arm — two arms in one process share a pool and a
     * seeded stream.
     */
    const drive = async (drain) => {
      const b = await boot({ forceDrain: drain });
      const { p, world } = b;
      p.boonMods.lightning = true;
      p.boonMods.compel = true;
      /* A droid in the cone, so the aimed powers have something to answer. Rend
       * needs a MECHANICAL body specifically and compel needs a body carrying a
       * blaster; a b1 is both, which is why the whole loop can share one. */
      const fwd = p.aimDir.clone().setY(0).normalize();
      const at = p.position.clone().addScaledVector(fwd, 4);
      at.y = world.terrain.height(at.x, at.z);
      let droid = null;
      /* ONE FRESH BODY PER POWER, and the reason is a green check that was not.
       * Run against a single droid, push and pull and unleash throw it out of
       * every other power's cone before their turn comes, so grip, compel and
       * rend all read "never charged" — a fact about where the body ended up
       * and not about the economy. Standing it back up is not enough either: a
       * limp or stunned body answers half of these differently. */
      const restand = () => {
        if (droid) { droid.dead = true; const i = world.enemies.indexOf(droid); if (i >= 0) world.enemies.splice(i, 1); }
        droid = world.spawnEnemy('b1', at.clone());
        assert(droid, 'the bench could not spawn a body for the aimed powers to answer');
        for (let i = 0; i < 2; i++) b.step(1);
      };
      const aim = () => { if (droid) p.aimDir.copy(p._enemyPoint(droid, at.clone())).sub(p.chest).normalize(); };
      const fire = {
        push: () => p.forcePush(world),
        pull: () => p.forcePull(world),
        grip: () => p.toggleGrip(world),
        throw: () => p.throwOrRecall(world),
        sense: () => p.toggleSense(world),
        lightning: () => p.forceLightning(world),
        stasis: () => p.toggleStasis(world),
        heal: () => { p.hp = p.maxHp * 0.5; p.forceHeal(world); },
        shield: () => p.forceShield(world),
        compel: () => p.forceCompel(world),
        rend: () => p.forceDisassemble(world),
        unleash: () => p.forceUnleash(world),
      };
      const undriven = Object.keys(POWER_COST).filter(k => !fire[k]);
      assert(!undriven.length, `this check has no way to fire ${undriven.join(', ')}`);

      const bill = {};
      for (const key of Object.keys(POWER_COST)) {
        /* Back to a state every power can be cast from. A barrier already up
         * makes `forceShield` a toggle-DOWN, which spends nothing — the same
         * trap force-voice.mjs's `rearm` documents. */
        for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
        p.channel = null; p.healing = null; p.healTarget = null;
        p.senseActive = false; p.shield.up = false; p.shield.power = 0;
        p.gripBody = null; p.gripEnemy = null;
        p.stasis.active = false; p.stasis.held.length = 0; p.stasis.firing.length = 0;
        p.stasis.bodies.clear();
        p.throwState = 'held'; p.saberDown = false; p.saber.lit = true;
        restand();
        world.time += 1;
        p.force = p.maxForce;
        p.charged = 0;
        aim();
        fire[key]();
        for (let i = 0; i < 60; i++) { aim(); b.step(1); }
        p._regen(STEP);                     // the one hold that is billed there
        bill[key] = p.charged;
      }
      return bill;
    };

    const paid = await drive(1);
    const unbilled = Object.keys(POWER_COST).filter(k => !(paid[k] > 0));
    assert(!unbilled.length,
      `at Force Drain 1 these were never charged at all, so the drain-0 arm below would prove `
      + `nothing about them: ${unbilled.join(', ')}`);

    const free = await drive(0);
    const guilty = Object.entries(free).filter(([, v]) => v > 1e-9).map(([k, v]) => `${k} ${v.toFixed(2)}`);
    assert(!guilty.length,
      `Force Drain 0 says "unlimited Force" and these were charged anyway: ${guilty.join(', ')}`);

    const total = Object.values(paid).reduce((a, v) => a + v, 0);
    return `${Object.keys(POWER_COST).length} powers, ${total.toFixed(0)} Force at drain 1 `
      + `(${Object.entries(paid).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ')}), 0 at drain 0`;
  });

  check('force-economy: no boon makes a held channel pay for itself', async () => {
    /**
     * `_regen` pauses the base 7.5 a second while the barrier or Force sense is
     * up, and its own note says why: measured before that line existed, a raised
     * barrier with nothing shooting at it ran a NET GAIN of 2.82 Force a second,
     * and a power that refills the bar it is draining has no decision in it.
     *
     * The rule was a local `const` inside `_regen`, which made it a rule with
     * one obeyer — and there are two writers of this pool's regeneration. The
     * other is `wellspringFlow`, a boon tick in Waves.js adding
     * `7.5 × (forceRegen − 1)` a second, which never asked. Driven on a real
     * World, net Force per second with the barrier up and nothing shooting:
     *
     *     no cards                      −4.25/s
     *     Wellspring                    −0.18/s
     *     Wellspring + Attunement ×4    +6.15/s
     *     Attunement of the Force ×8    +6.26/s
     *
     * The property is the SIGN, over the worst stack the run can reach, and it
     * is stated for both channels. It deliberately does not name a slope: the
     * numbers above are what the tuning happens to be, and the thing that must
     * never be true is that holding one of these makes you richer.
     */
    const { BOONS, ATTUNEMENTS } = await import('../../src/game/Waves.js');
    const card = (id) => BOONS.find(c => c.id === id) || ATTUNEMENTS.find(c => c.id === id);
    /* The two Force-regeneration cards, and both are `stack: Infinity` or
     * stackable epics offered on every set-piece — so this stack is a late run
     * rather than a corner. Read from the tables so a third such card is
     * covered without this check being told about it. */
    const givers = [...BOONS, ...ATTUNEMENTS].filter(c => /forceRegen/.test(String(c.apply)));
    assert(givers.length, 'nothing in the boon tables writes forceRegen — this check is looking at the wrong field');

    const rows = [];
    for (const which of ['barrier', 'sense']) {
      const b = await boot();
      const { p, world } = b;
      /* Every regeneration card the tables carry, four deep, which is what a
       * long run with a Force build actually holds. */
      for (const c of givers) for (let i = 0; i < 4; i++) c.apply(p, 1);
      p.force = p.maxForce * 0.5;
      for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
      if (which === 'barrier') p.forceShield(world); else p.toggleSense(world);
      assert(which === 'barrier' ? p.shield.up : p.senseActive, `the ${which} would not come up`);
      const f0 = p.force;
      b.step(240);
      const slope = (p.force - f0) / 4;
      assert(which === 'barrier' ? p.shield.up : p.senseActive,
        `the ${which} came down inside four seconds; the slope below is about the wrong thing`);
      assert(slope < 0,
        `holding the ${which} with every Force-regeneration card in the game ran `
        + `${slope >= 0 ? '+' : ''}${slope.toFixed(2)} Force a second — it pays for itself, `
        + 'so there is no decision left in how long you hold it');
      rows.push(`${which} ${slope.toFixed(2)}/s at forceRegen ×${(p.boonMods.forceRegen ?? 1).toFixed(2)}`);
    }
    return rows.join(', ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * A POWER THAT DECLINES SAYS WHY — DRIVEN, NOT GREPPED
   * ──────────────────────────────────────────────────────────────────── */

  check('force-economy: rend names every one of the five ways it can decline', async () => {
    /**
     * Four of these five were bare `return`s, in the method whose price refusal
     * made force-feedback.mjs's substring test pass. Each arm below puts the
     * player in exactly one of the states and asserts a sentence arrives.
     *
     * The interesting one is the last: rend is the only power in the file whose
     * "it did not work" is discovered AFTER the Force is taken, because whether
     * a joint comes off is `Enemy.takeCut`'s answer. It used to keep the 38 and
     * the 2.4 s lockout and produce no sound, no spark and no word.
     */
    const b = await boot();
    const { p, world } = b;
    const rows = [];
    const said = () => p.notices.length ? p.notices[p.notices.length - 1] : null;

    // 1 — nothing mechanical under the aim. A live World's arena is empty here.
    p.notices.length = 0;
    p.cooldowns.rend = 0;
    p.force = p.maxForce;
    const beforeAim = p.force;
    p.forceDisassemble(world);
    assert(p.notices.length === 1,
      `pressing rend at nothing produced ${p.notices.length} notices — the key is silent`);
    assert(/droid|mechanic/i.test(said().s),
      `the refusal says "${said().s}" without saying what rend is for`);
    assert(p.force === beforeAim, 'a rend that found no target still took Force');
    rows.push(`no target → "${said().s}"`);

    // 2 — the cooldown, which is 2.4 s and the longest on any aimed power.
    p.notices.length = 0;
    p.cooldowns.rend = 1.7;
    world.time += 1;                       // past `_refuse`'s own 0.7 s rate limit
    p.forceDisassemble(world);
    assert(p.notices.length === 1, 'pressing rend during its own cooldown said nothing');
    assert(/recover/i.test(said().s) && /\d/.test(said().s),
      `the cooldown refusal says "${said().s}" without saying how long`);
    rows.push(`cooldown → "${said().s}"`);

    /* 3, 4 and 5 need a real droid under the aim, and it is a REAL one —
     * `world.spawnEnemy` — because `_pickMechanical` gates on `bodyOf(e).droid`
     * and then on a 0.93 cone measured to `_enemyPoint`, i.e. the body's chest.
     * A hand-built stand-in got past neither, and the three arms went green
     * quoting the "nothing in your sights" sentence from arm 1 — three checks
     * measuring the same miss and reporting it as three properties. */
    const fwd = p.aimDir.clone().setY(0).normalize();
    const at = p.position.clone().addScaledVector(fwd, 4);
    at.y = world.terrain.height(at.x, at.z);
    const droid = world.spawnEnemy('b1', at);
    assert(droid, 'the bench could not spawn a droid to rend');
    b.step(2);
    p.aimDir.copy(p._enemyPoint(droid, at.clone())).sub(p.chest).normalize();

    // 3 — the price, which was the one gate that already spoke.
    p.notices.length = 0;
    p.cooldowns.rend = 0;
    p.force = 1;
    world.time += 1;
    p.forceDisassemble(world);
    assert(p.notices.length === 1, 'pressing rend on an empty bar said nothing');
    assert(/Force needed/.test(said().s),
      `the price refusal says "${said().s}" — it must name the price and the pool`);
    rows.push(`refusal at 1 Force → "${said().s}"`);

    /* 4 and 5 — the two states that need the droid to answer differently. The
     * BODY is the real one and only its two answers are replaced, so the pick,
     * the cone, the mass gate and the whole of the method above these gates is
     * still the shipping code. */
    const caps = droid.capsules();
    const core = caps.filter(c => /hips|spine|chest|body|core|pelvis/.test(c.name));
    assert(core.length, 'the b1 rig has no core capsule for the "nothing left" arm');

    // 4 — a droid with no severable joints left.
    p.notices.length = 0;
    p.cooldowns.rend = 0;
    p.force = p.maxForce;
    world.time += 1;
    droid.capsules = () => core;
    let before = p.force;
    p.forceDisassemble(world);
    assert(p.notices.length === 1, 'a droid with nothing left to take off refused in silence');
    assert(/nothing left/i.test(said().s), `it said "${said().s}"`);
    assert(p.force === before, `it cost ${(before - p.force).toFixed(1)} Force to be told no`);
    rows.push(`stripped → "${said().s}"`);

    // 5 — joints present, and every pass turned.
    p.notices.length = 0;
    p.cooldowns.rend = 0;
    p.force = p.maxForce;
    world.time += 1;
    droid.capsules = () => caps;
    droid.takeCut = () => 'turned';
    before = p.force;
    p.forceDisassemble(world);
    assert(p.notices.length === 1,
      'a rend where nothing came off said nothing at all — and it had already taken the Force');
    assert(/held together|came away/i.test(said().s), `it said "${said().s}"`);
    assert(p.force === before,
      `a rend that took nothing off kept ${(before - p.force).toFixed(1)} Force`);
    assert(p.cooldowns.rend === 0,
      `a rend that took nothing off still started a ${p.cooldowns.rend}s lockout`);
    rows.push(`nothing came away → "${said().s}", refunded`);

    return rows.join('; ');
  });

  check('force-economy: the aimed holds say why when there is nothing to take hold of', async () => {
    /**
     * `toggleGrip` and `throwOrRecall` each carried a bare `return` for the
     * state a player meets most often — pointing at nothing, and pressing throw
     * with the blade retracted. `forceCompel` has answered the first of those
     * out loud since it was written, which is the whole argument: two aimed
     * holds asking the same question must not answer it differently.
     */
    const b = await boot();
    const { p, world } = b;
    const rows = [];

    p.notices.length = 0;
    p.cooldowns.grip = 0;
    p.force = p.maxForce;
    p.toggleGrip(world);
    assert(!p.gripBody && !p.gripEnemy, 'the bench found something to grip; it must find nothing');
    assert(p.notices.length === 1,
      `gripping empty air produced ${p.notices.length} notices — the key is silent`);
    assert(/sight|reach/i.test(p.notices[0].s),
      `the refusal says "${p.notices[0].s}"`);
    rows.push(`grip at nothing → "${p.notices[0].s}"`);

    p.notices.length = 0;
    world.time += 1;
    p.throwState = 'held';
    p.saberDown = false;
    p.saber.lit = false;
    p.cooldowns.throw = 0;
    const before = p.force;
    p.throwOrRecall(world);
    assert(p.throwState === 'held', 'an unlit blade was thrown anyway');
    assert(p.notices.length === 1, 'throwing an unlit blade said nothing');
    assert(/ignite|blade/i.test(p.notices[0].s), `the refusal says "${p.notices[0].s}"`);
    assert(p.force === before, 'a refused throw took Force');
    rows.push(`unlit throw → "${p.notices[0].s}"`);

    /**
     * AND A FIELD THAT CAUGHT NOTHING SOUNDS LIKE ONE.
     *
     * `releaseStasis` played its falling note only on the DROP — the bar
     * running out — and the other way into the same branch is a field the
     * player FIRED that had caught nothing. That path made no sound, raised no
     * gesture and threw nothing: you paid 26, stood in it, pressed the key, and
     * the game did not respond. Same silence, different door.
     */
    const { audio } = await import('../../src/engine/Audio.js');
    const heard = [];
    const tone = audio.tone.bind(audio);
    audio.tone = (...a) => { heard.push('tone'); return tone(...a); };
    try {
      p.notices.length = 0;
      world.time += 1;
      for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
      p.force = p.maxForce;
      p.stasis.active = false; p.stasis.held.length = 0; p.stasis.firing.length = 0;
      p.toggleStasis(world);
      assert(p.stasis.active, 'the field would not go up');
      assert(!p.stasis.held.length, 'the bench caught something; this arm needs an empty field');
      heard.length = 0;
      p.toggleStasis(world);                     // fire it, with nothing in it
      assert(!p.stasis.active, 'the field would not come down');
      assert(heard.length > 0,
        'a stasis field fired with nothing in it made no sound at all — 26 Force and no answer');
      rows.push(`empty field fired → ${heard.length} sound(s)`);
    } finally { audio.tone = tone; }

    return rows.join('; ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * AND A CAST YOU CANNOT SEE IS A CAST THAT DID NOT HAPPEN
   * ──────────────────────────────────────────────────────────────────── */

  check('force-economy: every aimed power puts something on the screen', async () => {
    /**
     * Driven with every emitter counted, one cast each, before this check
     * existed:
     *
     *     push      45 particles  shake 0.30  1 radial
     *     unleash   26            0.62        2
     *     stasis    26            0.14        1
     *     rend      20            0.34        0
     *     compel    14            0.00        0
     *     pull       0            0.00        0
     *
     * Force pull is the only aimed power that emitted NOTHING — no dust, no
     * shake, no lens squeeze — so a pull with nothing inside its cone was a
     * grunt and an arm, while its opposite number spent sixteen Force and threw
     * up a wall of dust and a crater. The two read as different kinds of thing
     * rather than as two directions of one thing.
     *
     * The property is stated over the SPENDERS THAT REACH OUTWARD rather than
     * over all twelve, because four of them are deliberately quiet at the cast
     * and loud afterwards: the grip, the throw and the mend all emit from their
     * own per-frame tick, and the barrier's whole visual is a mesh. Those are
     * covered by their own suites. What is asserted here is that a power the
     * player aims and fires ONCE cannot be invisible.
     */
    const b = await boot();
    const { p, world } = b;
    p.boonMods.lightning = true;
    const counted = { n: 0 };
    for (const pool of ['dust', 'plasma', 'spark']) {
      const s = world.particles?.[pool]?.spawn;
      if (s) world.particles[pool].spawn = function (...a) { counted.n++; return s.apply(this, a); };
    }
    const sb = world.particles?.sparkBurst;
    if (sb) world.particles.sparkBurst = function (...a) { counted.n++; return sb.apply(this, a); };
    const shake = { n: 0 };
    const add = p.camera.addShake.bind(p.camera);
    p.camera.addShake = (v) => { shake.n += v; return add(v); };

    const AIMED = {
      push: () => p.forcePush(world),
      pull: () => p.forcePull(world),
      unleash: () => p.forceUnleash(world),
      stasis: () => p.toggleStasis(world),
    };
    const rows = [];
    const silent = [];
    for (const [key, fire] of Object.entries(AIMED)) {
      for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
      p.stasis.active = false; p.stasis.held.length = 0; p.stasis.firing.length = 0;
      p.force = p.maxForce;
      counted.n = 0; shake.n = 0;
      fire();
      rows.push(`${key} ${counted.n}p/${shake.n.toFixed(2)}s`);
      if (counted.n === 0 && shake.n === 0) silent.push(key);
    }
    assert(!silent.length,
      `these cost Force and put nothing on the screen: ${silent.join(', ')}`);
    return rows.join(' ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE ONE NUMBER THAT USED TO BE THREE
   * ──────────────────────────────────────────────────────────────────── */

  check('force-economy: the Sense drain has one home and the pages read it', async () => {
    /**
     * `22` lived in `Player._regen` and as prose in two places that teach the
     * power — HUD.MINIMAP's note on the linger and the Codex row — which is
     * §2.3's hand-maintained twin with a number small enough to look harmless.
     * The rule is the one this project keeps applying: the page quotes the
     * constant or it is not allowed to quote a number.
     */
    const { readFile } = await import('node:fs/promises');
    const player = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const menu = await readFile(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');

    const regen = player.slice(player.indexOf('  _regen(dt) {'));
    const body = regen.slice(0, regen.indexOf('\n  addFlow('));
    assert(/SENSE_DRAIN/.test(body),
      'Player._regen no longer reads SENSE_DRAIN — the drain has been typed back in by hand');

    /* The Codex row has to carry BOTH numbers, because the two are different
     * kinds of thing and saying only one teaches the wrong half: 25 is a
     * threshold that is never taken, SENSE_DRAIN is a charge that is. */
    const row = menu.slice(menu.indexOf("{ keys: ['sense']"));
    const card = row.slice(0, row.indexOf("{ keys: ['stasis']"));
    assert(/SENSE_DRAIN/.test(card) && /POWER_COST\.sense/.test(card),
      'the Codex row for Force sense states a price without reading it from the table');
    assert(!/\b22\b/.test(card.replace(/\/\*[\s\S]*?\*\//g, '')),
      'the Codex row for Force sense has a hand-typed 22 in it again');

    return `SENSE_DRAIN = ${SENSE_DRAIN}, read by _regen and by the Codex row; `
      + `POWER_COST.sense = ${POWER_COST.sense} is the threshold beside it`;
  });
}
