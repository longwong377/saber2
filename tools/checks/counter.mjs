/**
 * THE COUNTER — V16 Lane B, and the one check in this tree that guards a
 * DOCTRINE rather than a behaviour.
 *
 * `Progress.js` refuses unlocks, currency and cross-run power, and V16 asks
 * for a shop. The amendment at the top of that file is the argument: a run is
 * won by playing rather than by having played before, and credits do not touch
 * that IF AND ONLY IF the only things they buy are cosmetics that are
 * permanent and provisions that die with the run.
 *
 * "If and only if" is a thing a suite can hold, and this is where it is held.
 * Every other check in this file exists to make that one true.
 */

export async function run({ check, assert, near }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('counter: a keepsake is cosmetic — measured on the body, not promised', async () => {
    /**
     * ══ THE ONE THAT MATTERS ═════════════════════════════════════════════
     *
     * A cosmetic that buys power is the third category the doctrine forbids,
     * and it would not arrive labelled. So this does not read the label: it
     * takes a real Player, records every number the game has about him, buys
     * EVERY keepsake in the tree, and asserts nothing moved.
     *
     * `Counter.saneRow` refuses a keepsake carrying `grants`/`mods`/`effect`
     * at the door, so the only way to ship one is to lie about its kind — and
     * this is the check that catches the lie, because it never asks.
     */
    const V = await import('../../src/game/Vendors.js');
    const { defaultBoonMods } = await import('../../src/game/Player.js');
    const keeps = V.everyRow().filter((r) => r.kind === 'keepsake');
    assert(keeps.length >= 12, `only ${keeps.length} keepsakes in the tree`);

    /* THE WHOLE OF WHAT THE GAME KNOWS ABOUT A FIGHTER'S POWER. If a keepsake
     * moved anything at all, it moved one of these. */
    const p = {
      boonMods: defaultBoonMods(), maxHp: 100, hp: 100, maxForce: 100, force: 100,
      maxStamina: 100, stamina: 100, speed: 6, saber: { bladeLength: 1.4, coreWidth: 1 },
    };
    const before = JSON.stringify(p);
    for (const row of keeps) {
      /* A keepsake has no apply and cannot have one — that is the shape of the
       * guarantee. Anything that looks like a hook is the defect. */
      for (const hook of ['apply', 'grants', 'mods', 'effect', 'onTake', 'boon']) {
        assert(row[hook] === undefined,
          `${row.id} is a keepsake carrying "${hook}" — a cosmetic with a hook is permanent power `
          + 'wearing the one word the doctrine allows');
      }
      assert(row.slot && row.value !== undefined,
        `${row.id} is a keepsake that names no slot to change — it buys nothing at all`);
    }
    assert(JSON.stringify(p) === before, 'buying every keepsake in the game moved a number');

    /**
     * ══ AND EVERY ROW NAMES A SLOT *AND A VALUE* THE GAME CAN WEAR ═══════
     *
     * The clause here used to test the SLOT only, against a set unioned out of
     * the wardrobe's keys, the trooper kits, both paint vocabularies and the
     * home catalogue. It was green, and it was green over 23 of the 41 keepsake
     * rows in the tree, none of which could have been worn by anybody:
     *
     *   three of the four `slot:'home'` rows named furniture that is not one
     *     of `Home.CATALOGUE`'s ten ids — `cloth`, `banner`, `trophy-skull`;
     *   `cut-sith` named cape cut `'wrap'`, and `CAPE_CUTS` is cloak/none/
     *     mantle/travel/court;
     *   every armourer paint carried a raw hex where `wardrobe.armour` stores
     *     a `PAINTS` id, so `Cloth.armourSheet` would drop all of them;
     *   `pauldron`/`crest`/`brace`/`kama`/`gear`/`under`/`scorch` are TROOPER
     *     KIT fields — real names, on a table the PLAYER's wardrobe has no
     *     field for, so the union above accepted them and nothing could store
     *     one;
     *   `hilt-scav` and `hilt-old` named emitters against ten real
     *     `HILT_STYLES`.
     *
     * A slot with no value vocabulary behind it is half a test. So the union
     * is replaced by the one table that actually writes — `Keepsakes.WEARERS`,
     * whose `of()` reads `Cloth`, `Bodies`, `Saber`, `Home` and `Kennel`'s own
     * tables at import — and the assertion is `wearable()`, which is the
     * function the shop itself calls. Still read and not typed; now it covers
     * the half that shipped broken.
     */
    const KS = await import('../../src/game/Keepsakes.js');
    const orphan = keeps.filter((r) => !KS.wearable(r));
    assert(!orphan.length,
      'keepsakes the game cannot put on anybody: '
      + orphan.map((r) => `${r.id} (${KS.whyNotWearable(r)})`).join('; '));
    /* AND THE TABLE ITSELF IS LIVE. A `WEARERS` row whose vocabulary came back
     * empty would accept nothing and refuse everything, which reads as a clean
     * suite and is a dead table. */
    for (const [slot, w] of Object.entries(KS.WEARERS)) {
      if (w.tone || w.bool || w.patch) continue;
      assert(w.of().length >= 2, `WEARERS.${slot} offers ${w.of().length} values — that is not a vocabulary`);
    }
    return `${keeps.length} keepsakes bought against a live boonMods, ${Object.keys(JSON.parse(before)).length} `
      + `fields unmoved; every slot AND value one ${Object.keys(KS.WEARERS).length} wearers can write`;
  });

  check('counter: a keepsake you pay for is kept — and it is not a fourth durable key', async () => {
    /**
     * ══ THE DEFECT THIS IS THE PIN FOR, AND IT WAS THE WHOLE SHOP ═════════
     *
     * Driven in a real browser: 9000 credits, the clothier at #9, one click on
     * *Oiled leather* (`gloveTone`, 38 cr), all of `localStorage` snapshotted
     * either side. EXACTLY ONE KEY MOVED — `saber.credits.v1` `{purse:9000}` →
     * `{purse:8962, spent:38}`. `settings.wardrobe.gloveTone` was −1 before and
     * −1 after. There was no keepsake store anywhere in the tree: the `slot`
     * and `value` fields on every row were read by nobody, and `showCounter`'s
     * handler called `spend()`, raised a banner and re-rendered. You could
     * spend 3200 credits on Beskar plate and own nothing.
     *
     * So this buys one of each KIND of keepsake and asserts the record moved.
     * It fails on the tree as it was, at the first assertion, for every row.
     */
    const V = await import('../../src/game/Vendors.js');
    const KS = await import('../../src/game/Keepsakes.js');
    const C = await import('../../src/game/Cloth.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');

    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    assert(Array.isArray(s.keepsakes) && !s.keepsakes.length,
      'a fresh profile does not start with an empty keepsake ledger');

    /* A TONE. The exact row the browser was driven on. */
    const glove = V.CLOTHIER.stock.find((r) => r.id === 'tone-glove');
    assert(s.wardrobe.gloveTone === -1, `gloves start at ${s.wardrobe.gloveTone}, not -1`);
    const got = KS.takeKeepsake(s, glove);
    assert(got.ok, `the clothier could not sell his own row: ${got.why}`);
    assert(s.wardrobe.gloveTone === glove.value,
      `bought gloveTone ${glove.value} and the wardrobe says ${s.wardrobe.gloveTone}`);
    assert(s.keepsakes.includes('tone-glove'), 'the ledger does not say it was sold');

    /* A CUT, A HILT, AND A KIT — three different records reached by one door. */
    KS.takeKeepsake(s, V.CLOTHIER.stock.find((r) => r.id === 'cut-mantle'));
    assert(s.wardrobe.cape === 'mantle', `the cape is ${s.wardrobe.cape}`);
    KS.takeKeepsake(s, V.UNDERLIFT.stock.find((r) => r.id === 'hilt-old'));
    assert(s.hiltStyle === 'Archaic', `the hilt is ${s.hiltStyle}`);
    KS.takeKeepsake(s, V.ARMOURER.stock.find((r) => r.id === 'beskar'));
    assert(s.wardrobe.armour.plate === 'ice', `the plate is ${s.wardrobe.armour.plate}`);
    /* …AND A PAINT ON NO ARMOUR PUTS YOU IN ARMOUR, because otherwise 3200
     * credits of beskar goes onto a robe and shows nothing at all. */
    assert(s.wardrobe.armour.id !== 'none',
      'beskar was painted onto a figure wearing no plate — the player sees no change');

    /* EVERYTHING SURVIVES THE LAUNDERER, which is what "permanent" means: the
     * blob goes to disk and comes back through `wardrobeOf`. */
    const back = C.wardrobeOf(JSON.parse(JSON.stringify(s.wardrobe)));
    assert(back.gloveTone === glove.value && back.cape === 'mantle' && back.armour.plate === 'ice',
      'the wardrobe did not survive its own normaliser — the keepsake is not permanent');

    /* AND `owns` IS THE LEDGER'S READER, so a shelf can say what is yours. */
    assert(KS.owns(s, 'tone-glove') && !KS.owns(s, 'tone-vorlon'), 'the ledger does not read back');

    /* ══ AND THE ANIMAL, which had ZERO rows on any of the seven counters ══
     *
     * *"you can buy a bunch of shit for your compansions too."* There was not
     * a collar, a blanket or a mark in the whole tree. A `pet` row writes
     * through `Kennel.dressCompanion` — the one door the kennel allows a
     * screen, grep-pinned by `companions.mjs` to `name` and `look` — so this
     * lane opened no new way to edit an animal. */
    const Kn = await import('../../src/game/Kennel.js');
    Kn.clear();
    const pet = V.everyRow().find((r) => r.slot === 'pet');
    assert(pet, 'no counter sells anything for a companion at all');
    /* WITH NOTHING TO PUT IT ON IT IS REFUSED, AND IT SAYS SO — a shop that
     * takes the money for a collar you cannot wear is the defect again. */
    const nobody = KS.takeKeepsake(s, pet);
    assert(!nobody.ok && nobody.why, 'a collar was sold to a player with no animal, silently');
    assert(!KS.owns(s, pet.id), 'the refused row was written into the ledger anyway');
    Kn.adopt('massiff', 'Tam');
    const worn = KS.takeKeepsake(s, pet);
    assert(worn.ok, `the collar was refused with an animal in the kennel: ${worn.why}`);
    const [slot, value] = Object.entries(pet.value)[0];
    assert(Kn.load().live?.look?.[slot] === value,
      `${pet.id} said ${slot}=${value} and the animal wears ${JSON.stringify(Kn.load().live?.look)}`);
    Kn.clear();

    /* ══ AND IT IS NOT A FOURTH DURABLE KEY ═══════════════════════════════
     *
     * `session.mjs` counts `localStorage.setItem` writers across five named
     * files and refuses a fourth. A keepsake store of its own would have been
     * the easiest thing to write and would have been that fourth key.
     * `Progress.lessons` is the precedent this follows: a new durable FACT in
     * a record that already exists. So the file that owns keepsakes must not
     * touch storage at all — every write goes through a door somebody else
     * already opened.
     */
    const { readFile } = await import('node:fs/promises');
    /* COMMENTS STRIPPED FIRST. The file's own header ARGUES about localStorage
     * at length — which is the point of it — and a grep over the raw text would
     * fail on the paragraph explaining why the call is not there. Same `strip`
     * every other source-reading clause in this tree uses. */
    const raw = await readFile(new URL('../../src/game/Keepsakes.js', import.meta.url), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(!/localStorage/.test(code),
      'Keepsakes.js reaches localStorage — that is the fourth durable key session.mjs refuses');
    assert(!/makeStore/.test(code), 'Keepsakes.js opens a store of its own');
    return `gloveTone -1 → ${glove.value}, cape → mantle, hilt → Archaic, plate → ice, `
      + `${pet.id} → ${slot}=${value} on the animal (and refused with no animal); `
      + `${s.keepsakes.length} in the ledger; no store of its own`;
  });

  check('counter: a provision dies with the run, and says so or is refused', async () => {
    /**
     * The other half of the amendment. A provision that survived a death would
     * be permanent power under the other word, so `runOnly` is not a default —
     * `saneRow` refuses a provision without it, which means the failure mode
     * is a row that never reaches a shelf rather than a run that starts strong.
     */
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const provs = V.everyRow().filter((r) => r.kind === 'provision');
    assert(provs.length >= 8, `only ${provs.length} provisions`);
    for (const r of provs) {
      assert(r.runOnly === true, `${r.id} does not declare runOnly`);
      assert(r.effect && typeof r.effect === 'object', `${r.id} is a provision that does nothing`);
    }
    /* THE DOOR REFUSES ONE THAT FORGOT. */
    assert(!K.saneRow({ ...provs[0], runOnly: undefined }),
      'a provision without runOnly was accepted — that is permanent power wearing the other word');
    assert(!K.saneRow({ ...provs[0], runOnly: false }), 'runOnly: false was accepted');
    /* …AND A KEEPSAKE THAT GREW A NUMBER. */
    const keep = V.everyRow().find((r) => r.kind === 'keepsake');
    assert(!K.saneRow({ ...keep, effect: { cutPower: 2 } }),
      'a keepsake carrying an effect was accepted at the door');
    assert(!K.saneRow({ ...keep, kind: 'upgrade' }), 'a third kind was accepted');
    return `${provs.length} provisions, all run-only; the door refuses a missing flag, a false one, `
      + 'a keepsake with an effect and a third kind';
  });

  check('counter: every row in the earn table is a number the game actually keeps', async () => {
    /**
     * `Credits.EARN`'s own header: *"every row is a number some system already
     * keeps, which is what stops this becoming a second scoring system beside
     * the real one."* One of them was not kept by anybody.
     *
     * `saves` is priced at 14 under the sentence "pulling a man out, because
     * the roll is the point". `payForRun` read `stats?.saves ?? 0`, and
     * `World.runStats` — the one assembler every ending goes through — had no
     * such field. So the row paid ZERO on every run ever played, and the
     * sentence beside it described something the game did not measure.
     *
     * ── AND IT IS DRIVEN THROUGH A REAL MEND, NOT ASSERTED OFF A FIELD ───
     *
     * A clause that only checked `'saves' in runStats()` would pass the day
     * somebody wrote `saves: 0` there. So a real player mends a real ragdolled
     * ally in a real world, and the number this file prices is read off the
     * same `runStats` an ending hands to `payForRun`.
     */
    const C = await import('../../src/game/Credits.js');
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'colosseum', settings: { mode: 'waves' } });
    try {
      /* EVERY ROW OF THE TABLE REACHES THE ASSEMBLER. The two that are paid
       * from outside a run — a quest's fee and a pit purse — are named as such
       * in the header and are handed in by their own doors, so they are exempt
       * and the exemption is spelled out rather than assumed. */
      const OUTSIDE = new Set(['quest', 'bout']);
      const stats = world.runStats({ won: false });
      const missing = Object.keys(C.EARN).filter((k) => !OUTSIDE.has(k)
        && k !== 'depth' && k !== 'won' && !(k in stats));
      assert(!missing.length,
        `${missing.join(', ')} is priced in EARN and World.runStats does not report it — `
        + 'the row pays zero on every run ever played');

      /* NOW EARN ONE. A downed ally, stood up by the shipped mend. */
      const me = world.player;
      const mate = world.spawnEnemy?.('conscript', me.position.clone().add({ x: 2, y: 0, z: 2 }),
        { team: me.team });
      assert(mate, 'no ally could be spawned to save');
      const before = me.saves | 0;
      /* Down him the way the game downs a man, then complete the channel the
       * way `_endHeal` completes it — the one door `Command.reviveNear` uses
       * too, so a mend and a support pod count the same thing. */
      /* THE EXISTING ACTOR IS KEPT AND FLAGGED, never replaced: a stand-in
       * object loses `dispose`, and `world.unload()` calls it on the way out. */
      mate.actor = mate.actor || { dispose() {} };
      mate.actor.ragdolled = true;
      mate.recover = () => { mate.actor.ragdolled = false; };
      me.healTarget = mate;
      me._endHeal(true);
      assert((me.saves | 0) === before + 1,
        `standing a downed ally up moved saves ${before} → ${me.saves | 0}`);
      assert(world.runStats({}).saves >= 1, 'the save reached the player and not the run');

      /* AND IT IS WORTH WHAT THE TABLE SAYS. */
      const none = C.payForRun({ depth: 1, won: false, kills: 0, saves: 0 });
      const one = C.payForRun({ depth: 1, won: false, kills: 0, saves: 1 });
      assert(one.paid - none.paid === C.EARN.saves,
        `a save paid ${one.paid - none.paid} against a table that prices it at ${C.EARN.saves}`);
      return `${Object.keys(C.EARN).length} earn rows, ${OUTSIDE.size} paid by their own door; `
        + `a real mend on a downed ally moved saves ${before} → ${me.saves | 0} and paid `
        + `${one.paid - none.paid}`;
    } finally { world.unload(); }
  });

  check('counter: the purse is bounded, and the cap is not what a run pays', async () => {
    /**
     * THE THIRD GUARANTEE, AND THIS CHECK USED TO GET IT WRONG IN THE MOST
     * EXPENSIVE WAY A CHECK CAN.
     *
     * It divided every price by `Credits.PER_RUN_CAP` and printed the quotient
     * as "capped runs". That reads as an answer to "how many runs is this" and
     * is not one: the cap is the MOST a run can pay and no run has ever paid
     * it. At a cap of 900 a 3200-credit plate came out as 3.6 "runs", inside
     * the 1.5-to-6 band, green — while the same purchase measured through the
     * shipped ending against `balance.mjs`'s own middle skill setting was
     * TWENTY-THREE runs. The whole top of the shelf was unreachable and the
     * suite said the economy was bounded.
     *
     * A denominator nobody measured is the defect. So the runs-to-afford
     * question has moved to where the denominator can be measured — the
     * `balance: a run pays for the shelf it is measured against` check, which
     * drives `simulateRun` at three skill settings, pays every run through
     * `main.js`'s own `record()`, and holds the median and the dearest row in
     * stated bands against what those runs actually earned.
     *
     * WHAT STAYS HERE is what this file can answer without a simulation, and
     * every one of them is about the purse rather than about the tuning: the
     * cap is a cap, a broke player can afford SOMETHING, and the spend door
     * cannot be talked into paying twice or into going negative.
     */
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const C = await import('../../src/game/Credits.js');
    const prices = V.everyRow().map((r) => K.priceOf(r));
    const worst = Math.max(...prices), best = Math.min(...prices);

    /* A RUN CANNOT PAY MORE THAN THE CAP, however good it was — and the cap
     * has to sit above the dearest thing being reachable at all, or the game
     * has a shelf no purse can ever hold. */
    C.clearCredits();
    const monster = C.payForRun({ depth: 999, won: true, kills: 99999, saves: 999 });
    assert(monster.paid === C.PER_RUN_CAP && monster.capped,
      `a 999-deep run paid ${monster.paid} against a cap of ${C.PER_RUN_CAP}`);
    assert(worst <= C.PER_RUN_CAP * 6,
      `the dearest row is ${worst} against a per-run ceiling of ${C.PER_RUN_CAP} — even a capped run `
      + `${(worst / C.PER_RUN_CAP).toFixed(1)}x over is a shelf nobody reaches`);
    assert(best < C.PER_RUN_CAP / 8,
      'nothing in the game is cheap — a broke player has to be able to buy something');

    /* …and a purse cannot go negative, or be spent twice. */
    C.clearCredits();
    C.pay(100);
    assert(C.spend(60).ok && !C.spend(60).ok, 'the purse paid out twice for one balance');
    assert(C.purse() === 40, `the purse is ${C.purse()} after 100 in and 60 out`);
    assert(!C.spend(-50).ok && C.purse() === 40, 'a negative spend was accepted');
    C.clearCredits();
    return `${prices.length} rows from ${best} to ${worst} credits against a ${C.PER_RUN_CAP} ceiling; `
      + `a 999-deep run pays ${monster.paid} of ${monster.raw}; runs-to-afford is measured in balance.mjs`;
  });

  check('counter: the shelf rerolls with the day, and is the same for everyone on it', async () => {
    /**
     * *"the shops don't always have the same things"* — the cheapest sentence
     * in Lane B and the one that makes a counter worth walking to.
     *
     * Two properties and they pull against each other: it must CHANGE with the
     * day, and it must NOT change when you look away. A shelf drawn from the
     * run's seed would be the first without the second, which is a slot
     * machine.
     */
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const idsOn = (c, d) => K.shelfFor(c, d).map((r) => r.id).join(',');
    for (const c of V.COUNTERS) {
      const a = idsOn(c, 5);
      assert(a === idsOn(c, 5), `${c.id}'s shelf changed when nothing did`);
      assert(a.length, `${c.id} put nothing out at all`);
      const n = K.shelfFor(c, 5).length;
      assert(n >= Math.min(K.SHELF_MIN, c.stock.length) && n <= K.SHELF_MAX,
        `${c.id} put out ${n} rows`);
    }
    /* IT CHANGES ACROSS DAYS — measured, because a hash that ignored the day
     * would pass every assertion above. */
    let moved = 0;
    for (const c of V.COUNTERS) {
      const seen = new Set();
      for (let d = 0; d < 14; d++) seen.add(idsOn(c, d));
      if (seen.size > 3) moved++;
    }
    assert(moved === V.COUNTERS.length,
      `${V.COUNTERS.length - moved} counters put out nearly the same shelf every day of a fortnight`);
    /* AND THE DEAREST ROWS ARE RARE ON IT rather than absent from it. */
    let singularDays = 0;
    const sing = V.COUNTERS.find((c) => c.stock.some((r) => r.tier === 'singular'));
    for (let d = 0; d < 60; d++) {
      if (K.shelfFor(sing, d).some((r) => r.tier === 'singular')) singularDays++;
    }
    assert(singularDays > 3 && singularDays < 55,
      `a singular row appeared on ${singularDays} of 60 days — rare means rare, not never and not always`);
    return `${V.COUNTERS.length} counters, all rerolling over a fortnight; a singular row on `
      + `${singularDays} of 60 days`;
  });

  check('counter: standing is a price, and a shutter — its first real reader', async () => {
    /**
     * `standing` has been in the station fold since V15 §1.1. It falls when
     * you hurt a resident and until this lane NOTHING ANYWHERE READ IT — a
     * number the game maintained and never spent, which is the defect this
     * tree keeps finding under a different name each time.
     */
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const row = V.CLOTHIER.stock[0];
    const good = K.askingPrice(row, 40).price;
    const evens = K.askingPrice(row, 0).price;
    const bad = K.askingPrice(row, -20).price;
    assert(good < evens && evens < bad,
      `standing does not move a price: +40 ${good}, 0 ${evens}, -20 ${bad}`);
    assert(K.askingPrice(row, 0).price === K.priceOf(row), 'a neutral standing is not the list price');
    const shut = K.markupFor(-40);
    assert(!shut.open && shut.why, 'a hated player is served, or is refused without being told why');
    const o = K.offerFrom(V.CLOTHIER, { day: 0, standing: -40 });
    assert(!o.open && !o.rows.length && o.why, 'a shut counter still put stock out');

    /* THE FACTION GATES, and both of them SPEAK. A shutter with no line behind
     * it is indistinguishable from a bug. */
    const jedi = K.offerFrom(V.UNDERLIFT, { day: 0, order: 'jedi' });
    assert(!jedi.open && /robe|shutter/i.test(jedi.why || ''),
      `the black market served a Jedi, or refused without a line: ${jedi.why}`);
    const sith = K.offerFrom(V.UNDERLIFT, { day: 0, order: 'sith' });
    assert(sith.open && sith.rows.length, 'the black market refused the one order it deals with');
    /* …and a per-row gate, not just a per-counter one. */
    const sithOnly = V.everyRow().filter((r) => r.side === 'sith');
    assert(sithOnly.length, 'no row is gated to one side, so the per-item gate is untested');
    for (const c of V.COUNTERS) {
      const asJedi = K.offerFrom(c, { day: 3, order: 'jedi' });
      for (const r of asJedi.rows) {
        assert(!r.side || r.side === 'jedi', `${c.id} offered a Jedi the ${r.side}-only ${r.id}`);
      }
    }
    return `+40 pays ${good}, evens ${evens}, -20 pays ${bad}, -40 is refused with a line; `
      + `the black market turns a Jedi away and serves a Sith ${sith.rows.length} rows`;
  });

  check('counter: a shutter that is declared comes down, and a gate that is declared holds', async () => {
    /**
     * TWO PROMISES IN THE DATA, AND ONE OF THEM WAS NOT BEING KEPT.
     *
     * `UNDERLIFT` carries `openDays: 2/3` under a note reading "NOT OPEN EVERY
     * DAY — the shelf's own seed decides, so a day it is shut is the same day
     * for everyone and is not a roll you can re-take by walking out and back
     * in." Nothing anywhere read the field. Swept over a month it was open on
     * thirty days out of thirty, which is the dead control this tree keeps
     * deleting wearing a field name.
     *
     * Both halves are asserted from the DECLARATION rather than from a typed
     * number, so a counter that is given an `openDays` tomorrow is measured
     * against its own, and the black market cannot quietly lose the field.
     */
    const V = await import('../../src/game/Vendors.js');
    const { offerFrom } = await import('../../src/game/Counter.js');
    const DAYS = 120;
    for (const c of V.COUNTERS) {
      let open = 0;
      for (let d = 0; d < DAYS; d++) if (offerFrom(c, { day: d, order: 'sith' }).open) open++;
      const want = Number.isFinite(Number(c.openDays)) ? Number(c.openDays) : 1;
      if (want >= 1) {
        assert(open === DAYS, `${c.name} declares no shutter and was shut ${DAYS - open} days of ${DAYS}`);
        continue;
      }
      const got = open / DAYS;
      assert(Math.abs(got - want) < 0.09,
        `${c.name} declares it opens ${(want * 100).toFixed(0)}% of days and opened `
        + `${(got * 100).toFixed(0)}% over ${DAYS} — the field is not being read`);
      /* AND THE SAME DAY IS THE SAME ANSWER, which is the half of the note
       * that stops a player re-rolling a shut door by walking out and in. */
      const twice = [0, 1, 2, 3, 4, 5, 6, 7].every((d) =>
        offerFrom(c, { day: d, order: 'sith' }).open === offerFrom(c, { day: d, order: 'sith' }).open);
      assert(twice, `${c.name} answers differently to two readers on the same day`);
    }
    /* THE FACTION GATE, from the same declaration. `refuse` speaks or it is
     * indistinguishable from a bug — that is this file's own rule one deck up. */
    for (const c of V.COUNTERS.filter((x) => x.refuse?.length)) {
      for (const order of c.refuse) {
        const r = offerFrom(c, { day: 0, order });
        assert(!r.open, `${c.name} refuses ${order} in its table and served one anyway`);
        assert(typeof r.why === 'string' && r.why.length > 8,
          `${c.name} turned a ${order} away without saying why`);
      }
      const ok = [...Array(30).keys()].some((d) => offerFrom(c, { day: d, order: 'sith' }).open);
      assert(ok, `${c.name} refuses ${c.refuse.join('/')} and never opens for anybody else either`);
    }
    const shuttered = V.COUNTERS.filter((c) => Number(c.openDays) < 1);
    return `${V.COUNTERS.length} counters; ${shuttered.length} with a declared shutter `
      + `(${shuttered.map((c) => `${c.id} ${(Number(c.openDays) * 100).toFixed(0)}%`).join(', ')}); `
      + `${V.COUNTERS.filter((c) => c.refuse?.length).length} with a faction gate, every refusal in words`;
  });

  check('counter: every shop is in a room you can walk to', async () => {
    /**
     * THE DEFECT THIS IS A PIN FOR, and it shipped: `Vendors.UNDERLIFT` — the
     * black market, the one shop in the game gated on your order, with a
     * `refuse` list and nine rows nobody else carries — named `place: 58`, and
     * 58 was not in the gazetteer. `Station.stationKey` reaches a counter
     * through `countersAt(place.id)`, so a counter whose place does not exist
     * is a counter no press can ever raise: the whole shop was unreachable and
     * every check about it passed, because they all ask what it SELLS.
     *
     * So this asks the other question. A shop is a place plus a table, and a
     * table without a place is a table in a corridor nobody built.
     */
    const V = await import('../../src/game/Vendors.js');
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const rooms = new Map(PLACES.map((p) => [p.id, p]));
    const homeless = V.COUNTERS.filter((c) => !rooms.has(c.place));
    assert(!homeless.length,
      `${homeless.map((c) => `${c.name} stands in #${c.place}`).join('; ')} — and `
      + 'there is no such place, so nothing on the station can raise that counter');
    /* AND THE PLACE HAS TO BE ONE YOU CAN PRESS IN. A room with no `verb` is
     * skipped by `stationKey` before the counter branch is ever reached, which
     * is the same failure by a longer route. */
    const mute = V.COUNTERS.filter((c) => !rooms.get(c.place)?.verb);
    assert(!mute.length,
      `${mute.map((c) => `#${c.place} carries ${c.name}`).join('; ')} — and that place has no verb, `
      + 'so the interact key returns before the shop is offered');
    return `${V.COUNTERS.length} counters in ${new Set(V.COUNTERS.map((c) => c.place)).size} rooms: `
      + V.COUNTERS.map((c) => `#${c.place} ${rooms.get(c.place).name}`).join(', ');
  });

  check('counter: the wallet is one short file, and the doctrine names its exception', async () => {
    /**
     * `Kennel.js:22-32` calls a new file's invisibility to the currency scan
     * "a hazard, not a permission", and this lane is the one that finally
     * makes it a live question. So: the wallet is small enough to read, it is
     * the ONLY file that holds a balance, and the amendment that allows it to
     * exist is written where the rule is — not beside the exception.
     */
    const { readFile } = await import('node:fs/promises');
    const src = async (f) => readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    /* THE AMENDMENT IS IN THE FILE THAT STATES THE RULE. */
    const prog = await src('Progress.js');
    assert(/AMENDMENT\s+—\s+CREDITS/.test(prog),
      'Progress.js does not carry the credits amendment — a doctrine edited in silence is worse '
      + 'than one broken loudly, and this lane broke one');
    assert(/KEEPSAKE/.test(prog) && /PROVISION/.test(prog),
      'the amendment does not name the two categories it narrows the rule to');

    /* THE WALLET IS SMALL. Not a style rule: it is the file the currency scan
     * points at, and a scan over a thousand lines is a scan nobody re-reads. */
    const cred = strip(await src('Credits.js'));
    const lines = cred.split('\n').filter((l) => l.trim()).length;
    assert(lines < 90, `Credits.js is ${lines} lines of code — the one file that holds a balance has `
      + 'to be one somebody can be sure about in a minute');

    /* AND IT IS THE ONLY ONE. A second balance is a second economy. */
    const holders = [];
    for (const f of ['Counter.js', 'Vendors.js', 'Home.js', 'Kennel.js', 'Spectacle.js']) {
      let code = '';
      try { code = strip(await src(f)); } catch { continue; }
      if (/\bpurse\b\s*[:=]|\bbalance\b\s*[:=]|\bwallet\b/.test(code)) holders.push(f);
    }
    assert(!holders.length, `${holders.join(', ')} holds a balance — Credits.js is the only wallet`);

    /* NOTHING BOUGHT ENTERS THE DRAFT. The sentence the three refusals exist
     * to protect is that the hundredth run starts where the first did. */
    for (const f of ['Counter.js', 'Vendors.js', 'Credits.js']) {
      const code = strip(await src(f));
      assert(!/takenBoons|drawBoons|communion|Communion/.test(code),
        `${f} reaches the run's own ledger — nothing bought may enter the draft or the Holocron`);
    }
    return `the amendment is in Progress.js; Credits.js is ${lines} lines and the only wallet; `
      + 'nothing in the shop reaches takenBoons';
  });

  check('counter: the shop and the kiosk are two doors, and both open', async () => {
    /**
     * ══ THE DEFECT: TWO COUNTERS THAT NO PRESS COULD EVER RAISE ══════════
     *
     * `stationKey` raised the KIOSK branch before the counter branch, and the
     * counter branch took `countersAt(place.id)[0]` with no standing-at test
     * at all — while the comment over it claimed the opposite of both. Held
     * for 45 s per deck-40 room on the real key:
     *
     *     #10 The Forge            → onKiosk:hilt   the armourer never reached
     *     #11 Quartermaster's cage → onKiosk:kit    the QM never reached
     *
     * The Quartermaster is the only counter in the game carrying stims and
     * stratagem charges, so the whole of `Progress.js`'s second amended
     * category was behind a branch that never ran.
     *
     * This is the headless half: the branch order, and that the reach test
     * exists and discriminates. The other half is a body walking to the desk
     * and pressing the key — `tools/_shopprobe.mjs`, on `_casinoprobe`'s
     * shape, because a hook call cannot see a branch that never runs.
     */
    const { readFile } = await import('node:fs/promises');
    const st = await readFile(new URL('../../src/game/Station.js', import.meta.url), 'utf8');
    const iCounter = st.indexOf('const shop = counterHere(world, place);');
    const iKiosk = st.indexOf('if (place.kiosk && world.onKiosk)');
    assert(iCounter > 0, 'the counter branch no longer asks which counter you are standing at');
    assert(iKiosk > 0, 'the kiosk branch is gone');
    assert(iCounter < iKiosk,
      'the kiosk branch still runs before the counter branch — that is the shape that made the '
      + 'armourer and the quartermaster unreachable, and the comment over it claimed otherwise');

    /**
     * AND THE TEST DISCRIMINATES, IN THE DESK'S OWN FRAME.
     *
     * A `counterHere` that answered the ROOM would be the old bug wearing a
     * function name, and a `counterHere` that answered a CIRCLE round the desk
     * is the bug a browser found in the first cut of this fix — #10's desk
     * sits 0.4 m off the middle of its room, so a radius made the whole room
     * the shop and the hilt bench unreachable. So the dressing is fabricated
     * with the three world points `StationKit.counter` really records, and the
     * player is stood at four places round it.
     */
    const S = await import('../../src/game/Station.js');
    const V = await import('../../src/game/Vendors.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const forge = PLACE.get(10);
    /* A 10 m desk across the middle of the Forge, its face toward −Z. */
    const desk = {
      at: { x: forge.x, y: 0, z: forge.z }, front: { x: forge.x, y: 0, z: forge.z - 1 },
      behind: { x: forge.x, y: 0, z: forge.z + 1 }, w: 10, d: 0.9,
    };
    const world = {
      player: { position: { x: forge.x, y: 0, z: forge.z } },
      _station: { counters: new Map([[10, [desk]]]) },
    };
    const at = (dx, dz) => {
      world.player.position.x = forge.x + dx;
      world.player.position.z = forge.z + dz;
      return S.counterHere(world, forge)?.id || null;
    };
    assert(at(0, -1.2) === 'armourer', 'standing at the Forge\'s counter does not raise the armourer');
    assert(at(4.5, -1.2) === 'armourer', 'standing at the far end of the counter does not raise it');
    /* BEHIND IT IS THE WORKSHOP, and that is the half the hilt bench is in. */
    assert(at(0, 1.2) === null,
      'standing behind the counter still raises the shop — the Forge\'s hilt bench is unreachable '
      + 'behind it, which is the same defect one branch over');
    /* PAST THE END OF IT IS THE ROOM. */
    assert(at(7, -1.2) === null, 'three metres past the end of the desk still raises the shop');
    /* AND TOO FAR BACK IS THE ROOM TOO. */
    assert(at(0, -4) === null, 'four metres back from the counter still raises the shop');

    /* AND IT IS DECK-WIDE, NOT ROOM-SCOPED. #11's hatch is in its front wall,
     * so the customer stands OUTSIDE the cage — where `placeUnder` answers #9
     * — and a room-scoped test offered the CLOTHIER at the quartermaster's
     * hatch. Measured in a browser before this line existed. */
    const cage = PLACE.get(11);
    const hatch = {
      at: { x: cage.x, y: 0, z: cage.z - cage.d / 2 + 0.4 },
      front: { x: cage.x, y: 0, z: cage.z - cage.d / 2 - 0.6 },
      behind: null, w: 2.2, d: 0.8,
    };
    const outside = {
      player: { position: { x: cage.x, y: 0, z: cage.z - cage.d / 2 - 1.2 } },
      _station: { counters: new Map([[11, [hatch]]]) },
    };
    assert(S.counterHere(outside, PLACE.get(9))?.id === 'quarter',
      'standing at the cage\'s hatch while the room under you is the Concourse does not raise the '
      + 'quartermaster — which is the only counter carrying stims and stratagem charges');

    /* AND THE ROOMS THAT BUILD NO DESK STILL SELL. `#9` is an imported mesh,
     * `#32` is a stone floor and `#58` sells over a plank across a container —
     * its own shape says so in as many words. None carries a kiosk, so the
     * room being the counter shadows nothing. */
    const bare = { player: { position: { x: 0, y: 0, z: 0 } }, _station: { counters: new Map() } };
    for (const id of [9, 32, 58]) {
      const p = PLACE.get(id);
      assert(S.counterHere(bare, p), `#${id} builds no desk and now sells nothing at all`);
      assert(!p.kiosk, `#${id} has grown a kiosk — it needs a desk before it can have one`);
    }
    /* …and every room that DOES carry both is one where a desk gets built. */
    const both = V.COUNTERS.filter((c) => PLACE.get(c.place)?.kiosk);
    assert(both.length >= 2, `only ${both.length} counters share a room with a kiosk — the case is untested`);
    return `the counter branch is ${iKiosk - iCounter} chars ahead of the kiosk branch; `
      + 'at the face and at its end raise the armourer, behind it and past its ends do not; '
      + `the cage's hatch raises the quartermaster from inside #9; ${both.length} rooms carry both`;
  });

  check('counter: every counter has a keeper, and the Forge\'s is a Mandalorian', async () => {
    /**
     * `keeper` was declared on all seven counters, returned by `offerFrom`, and
     * READ BY NOBODY. `ARMOURER.keeper` said `{role:'smith', species:'human',
     * helm:true}` — V16 §A4's *"maybe a mandalorian"* — and no body was built,
     * no species, no helmet; #10's gazetteer row still said *"a Wookiee
     * smith"*, so the one thing the room promised contradicted the one thing
     * the table said.
     */
    const S = await import('../../src/game/Station.js');
    const V = await import('../../src/game/Vendors.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');
    for (const c of V.COUNTERS) {
      const k = S.keeperOf(c.id);
      assert(k && k.name, `${c.id} has nobody behind it`);
      assert(k.role, `${c.id}'s keeper has no job`);
    }
    const smith = S.keeperOf('armourer');
    assert(smith.mando && smith.helm,
      `the Forge's smith is ${JSON.stringify(smith)} — §A4 asks for a Mandalorian, and a `
      + 'Mandalorian keeps the bucket on');
    assert(smith.role === 'smith', `the Forge's keeper is a ${smith.role}`);
    /**
     * ── AND THE TWO LINES ABOVE USED TO BE THE WHOLE OF IT, WHICH IS THE
     *    DEFECT THIS CHECK WAS WRITTEN TO CATCH, WEARING A CHECK'S COAT ───
     *
     * `smith.mando && smith.helm` is `keeperOf` handing back the two fields
     * `ARMOURER.keeper` declared. It was true on the day the row was typed
     * and it stayed true for a whole lane while the man behind #10's counter
     * was `res_human` in robes: no plate, no bucket, 62 meshes. A guard that
     * reads a field back out of the row it was declared in asserts the bug.
     *
     * TWO CLAUSES INSTEAD, and neither of them can be satisfied by a table:
     *
     *   THE FIELDS REACH A BUILDER. `keeperArmour` is the reader `helm` and
     *   `mando` never had, and building `res_human` with and without its
     *   answer has to give two different bodies. (`station.mjs` takes this
     *   the rest of the way and measures the body actually standing in the
     *   room, which is the clause this file cannot afford to boot for.)
     *
     *   AND `keeperOf` HAS A CALLER THAT IS NOT THIS FILE. It described
     *   itself as "the panel's reader" while the counter panel printed the
     *   shop's name and the purse and nothing about the man over the counter
     *   — so its only caller in the tree was the check testing it, which is
     *   the same defect one level up. `main.showCounter` reads it now.
     */
    const armour = S.keeperArmour(V.ARMOURER.keeper);
    assert(armour && armour.helmet,
      `the Forge's row resolves to ${JSON.stringify(armour)} — a Mandalorian smith with nothing to wear`);
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const meshes = (o) => { let n = 0; o?.rig?.root?.traverse?.((m) => { if (m.isMesh) n++; }); return n; };
    const robed = meshes(ARCHETYPES.res_human.build({}));
    const clad = meshes(ARCHETYPES.res_human.build({ armour }));
    assert(robed !== clad && clad > 20,
      `a keeper in beskar and a keeper in robes are the same ${clad}-mesh body — the row reaches no builder`);
    const { readFile } = await import('node:fs/promises');
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    let callers = 0;
    for (const f of ['main.js', 'game/Station.js', 'game/Counter.js', 'ui/Menu.js']) {
      let code = '';
      try { code = strip(await readFile(new URL(`../../src/${f}`, import.meta.url), 'utf8')); } catch { continue; }
      callers += (code.match(/\bkeeperOf\s*\(/g) || []).length
        - (code.match(/export function keeperOf/g) || []).length;
    }
    assert(callers >= 1,
      'keeperOf has no caller in src/ — it calls itself "the panel\'s reader" and the only thing '
      + 'reading it is this check');
    /* AND HE IS THE MAN ON THE SIGN. The shop is "Bo Vhett, beskar and blade"
     * and #10's row names him too, so a seeded name would put a stranger
     * behind somebody else's sign — measured in a browser, it said "Bo
     * Connally". A row that names its keeper keeps him. */
    assert(smith.name === 'Bo Vhett' && V.ARMOURER.name.includes(smith.name),
      `the Forge's shop sign says "${V.ARMOURER.name}" and the man behind it is ${smith.name}`);
    /* Every OTHER keeper is a seed and turns over with the day, which is the
     * player's *"the same shop owner doesnt always look the same"*. */
    const rolled = new Set();
    for (let d = 0; d < 14; d++) rolled.add(S.keeperOf('clothier', null, d).name);
    assert(rolled.size >= 5,
      `the clothier is the same ${rolled.size} people over a fortnight — the keeper does not reroll`);
    /* AND THE ROOM SAYS THE SAME THING THE TABLE DOES. */
    const who = PLACE.get(10).who;
    assert(/mandalorian/i.test(who) && !/wookiee/i.test(who),
      `#10's gazetteer says "${who}" — the room and the table disagree about who is in it`);
    return `${V.COUNTERS.length} keepers, all named; the Forge's is ${smith.name}, a helmed `
      + `Mandalorian smith who does not reroll — ${clad} meshes in beskar against ${robed} in robes, `
      + `and keeperOf has ${callers} caller(s) in src/; the clothier is ${rolled.size} different people `
      + `over a fortnight; #10 reads "${who}"`;
  });

  check('counter: the shop\'s till is wired to the shipped build, not to a check', async () => {
    /**
     * ══ THE ONE CLAUSE THAT IS ABOUT THE PLAYER AND NOT ABOUT THE CODE ═══
     *
     * Every other clause in this file reaches `Keepsakes.js` with `import()`,
     * which is a statement about the FILE SYSTEM and not about the game. That
     * is exactly how `Games.js` and `Quests.js` shipped finished and
     * unreachable behind seven green checks, and `games.mjs` says of its own
     * version of this line: "if it ever goes red the answer is never to delete
     * it."
     *
     * The whole of Finding 1 is that the shop took money and wrote nothing.
     * `Keepsakes.js` fixes that ONLY if `showCounter`'s handler calls it, and
     * that handler is in `main.js`. So the walk `pack.mjs` does is the test,
     * and the importer has to actually USE the door: a file named in an import
     * and never called satisfies a graph and still leaves the shop a sink.
     */
    const { assertShipped } = await import('./_shipped.mjs');
    const by = await assertShipped(assert, 'src/game/Keepsakes.js',
      'a shop that takes 3200 credits for beskar and writes nothing is the defect this lane exists '
      + 'to fix, and the only line that fixes it is the one in showCounter that spends the row');
    const { readFile } = await import('node:fs/promises');
    let used = [];
    for (const f of by) {
      const code = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
      const m = code.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*Keepsakes\.js'/);
      if (m) used = used.concat(m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
      /* AND IT IS CALLED, on the same line the money moves. A `spend()` with
       * no `takeKeepsake` beside it is the shop exactly as it shipped. */
      if (/takeKeepsake\s*\(/.test(code)) used.push('called');
    }
    assert(used.includes('takeKeepsake') && used.includes('called'),
      `Keepsakes.js is imported by ${by.join(', ')} but nothing calls takeKeepsake — the row is `
      + 'still paid for and still not owned');
    return `Keepsakes.js is in the shipped build, imported by ${by.join(', ')}, and takeKeepsake is called`;
  });

  check('counter: standing has a writer now, in both directions', async () => {
    /**
     * `StationSave.setStanding` had ZERO CALLERS. `markupFor` works — 0 pays
     * 38 for the oiled leather, −20 pays 45, −35 is refused — but the number
     * it reads was 0 for every player for ever, so the vendor-remembers-you
     * half of the shop never fired once.
     *
     * The fall was already being computed and thrown away:
     * `StationLife.witness` does `life.standing -= hurt * 2` into a
     * SESSION-scoped object, and the durable fold beside it never moved.
     */
    const { readFile } = await import('node:fs/promises');
    const src = async (f) => readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const files = ['Station.js', 'StationSave.js', 'Home.js', 'Counter.js', 'Menu.js'];
    let callers = 0;
    for (const f of files) {
      let code = '';
      try { code = strip(await src(f)); } catch { continue; }
      callers += (code.match(/\bsetStanding\s*\(/g) || []).length;
    }
    /* The declaration in StationSave.js is not a call. */
    const decl = strip(await src('StationSave.js'));
    callers -= (decl.match(/export function setStanding/g) || []).length;
    assert(callers >= 2,
      `setStanding has ${callers} callers — a number the game maintains and never spends is the `
      + 'defect this tree keeps finding under a different name');

    /* BOTH DIRECTIONS, AND BOTH ARE ABOUT RESIDENTS. Down when you cut one
     * (`persistStanding` mirrors StationLife's own fall onto the fold); up
     * when you collect on one's job (`payForJob`). Not shopping: standing that
     * rose when you spent would be a loyalty ladder, which is a number that
     * grows by having played. */
    const stn = strip(await src('Station.js'));
    assert(/function persistStanding/.test(stn) && /_lifeStanding/.test(stn),
      'nothing carries StationLife\'s fall onto the durable fold');
    assert(/setStanding\(standing\(\) \+ 2\)/.test(stn),
      'nothing raises standing — markupFor\'s +40 rung is a dead branch');
    assert(!/setStanding[^;]*spend|spend[^;]*setStanding/.test(stn),
      'standing moves on a purchase — that is a loyalty ladder, not a reputation');

    /* AND THE PRICE REALLY MOVES WITH IT. */
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const row = V.CLOTHIER.stock.find((r) => r.id === 'tone-glove');
    const at = (n) => K.askingPrice(row, n).price;
    assert(at(40) < at(0) && at(0) < at(-20) && !K.askingPrice(row, -40).open,
      `standing does not price: +40 ${at(40)}, 0 ${at(0)}, -20 ${at(-20)}`);
    return `${callers} callers of setStanding; the oiled leather is ${at(40)} at +40, `
      + `${at(0)} at evens, ${at(-20)} at -20, refused at -40`;
  });
}
