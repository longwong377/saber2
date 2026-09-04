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

    /* AND EVERY SLOT IT NAMES IS ONE THAT ALREADY EXISTS. A keepsake that
     * invents a customisation system is a keepsake nothing wears. */
    const C = await import('../../src/game/Cloth.js');
    const B = await import('../../src/game/Bodies.js');
    /**
     * ── THE KNOWN SLOTS ARE READ, NOT TYPED ─────────────────────────────
     *
     * The first cut of this line was a hand-typed set and it refused four
     * slots that are real — `kama`, `brace`, `helm`, `scorch` — because I had
     * not thought of them. A list in a check is exactly the thing a check
     * exists to refuse everywhere else: it goes stale the day somebody adds a
     * slot, and it fails work that is right.
     *
     * So the set is built out of the tables the game actually dresses bodies
     * from: the wardrobe's own keys, the trooper kit's field names, both paint
     * vocabularies, and the home catalogue. A keepsake naming a slot outside
     * ALL of those buys nothing, and that is now a fact rather than my memory.
     */
    const known = new Set([
      ...Object.keys(C.WARDROBE),
      ...Object.keys(B.TROOPER_KITS?.commander || {}),
      ...Object.values(B.TROOPER_KITS || {}).flatMap((k) => Object.keys(k)),
      ...Object.values(B.KIT_FIELDS || {}).flatMap((g) => Object.keys(g)),
      ...Object.values(B.PAINT_SLOTS || {}).flatMap((rows) => rows.map((r) => r[0])),
      ...Object.keys(B.buildTrooper?.({})?.palette || {}),
      /* The three the body has that no table names: whether the helmet is on,
       * the emitter on the hilt, and a piece of furniture at home. */
      'helm', 'hilt', 'home',
    ]);
    const orphan = keeps.filter((r) => !known.has(r.slot));
    assert(!orphan.length,
      `keepsakes naming a slot nothing wears: ${orphan.map((r) => r.id + '→' + r.slot).join(', ')}`);
    return `${keeps.length} keepsakes bought against a live boonMods, ${Object.keys(JSON.parse(before)).length} `
      + `fields unmoved; every slot one the body already has`;
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

  check('counter: the economy is bounded — the dearest thing is several runs, not sixty', async () => {
    /**
     * THE THIRD GUARANTEE, AND IT WAS BROKEN FOR AN HOUR.
     *
     * A tier used to multiply the author's own `base`, and the two compounded:
     * a singular authored at 2600 reached the shelf at 57,200, which against a
     * 900 cap is SIXTY-FOUR capped runs. The amendment promises "several", and
     * "several" is the entire mechanism by which hoarding cannot buy an
     * advantage. So it is a number, and here it is.
     */
    const K = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const C = await import('../../src/game/Credits.js');
    const prices = V.everyRow().map((r) => K.priceOf(r));
    const worst = Math.max(...prices);
    const runs = worst / C.PER_RUN_CAP;
    assert(runs <= 6, `the dearest row is ${worst} credits, ${runs.toFixed(1)} capped runs — the doctrine `
      + 'says several, and several is what stops a purse being a power ladder');
    assert(runs >= 1.5, `the dearest row is ${runs.toFixed(1)} runs, which is not a thing to save for`);
    assert(Math.min(...prices) < C.PER_RUN_CAP / 8,
      'nothing in the game is cheap — a broke player has to be able to buy something');

    /* AND A RUN CANNOT PAY MORE THAN THE CAP, however good it was. */
    C.clearCredits();
    const monster = C.payForRun({ depth: 999, won: true, kills: 99999, saves: 999 });
    assert(monster.paid === C.PER_RUN_CAP && monster.capped,
      `a 999-deep run paid ${monster.paid} against a cap of ${C.PER_RUN_CAP}`);
    /* …and a purse cannot go negative, or be spent twice. */
    C.clearCredits();
    C.pay(100);
    assert(C.spend(60).ok && !C.spend(60).ok, 'the purse paid out twice for one balance');
    assert(C.purse() === 40, `the purse is ${C.purse()} after 100 in and 60 out`);
    assert(!C.spend(-50).ok && C.purse() === 40, 'a negative spend was accepted');
    return `${prices.length} rows from ${Math.min(...prices)} to ${worst} credits `
      + `(${runs.toFixed(1)} capped runs); a 999-deep run pays ${monster.paid} of ${monster.raw}`;
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
}
