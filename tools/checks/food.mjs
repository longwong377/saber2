/**
 * THE FOOD AND THE BARS — V16 Lane B5 and C2.
 *
 * *"you can buy food and there could be a small cutscene of it being cooked
 * then you can take it home and store it in your apartment and eat it for
 * buffs, droids charge instead of eating"* and *"one or two bars … a
 * casino/nightclub with troops on leave."*
 *
 * ── WHAT THIS SUITE IS FOR ────────────────────────────────────────────────
 *
 * Food is the first thing V16 has shipped that is a PROVISION in the sense
 * `Progress.js`'s amendment means it: a thing you pay credits for that changes
 * a number you fight with. The doctrine allows exactly that and only on three
 * conditions, and this file is where the three are held rather than promised:
 *
 *   A BUFF CANNOT OUTLIVE A DEATH.
 *   NO DISH MOVES A PERMANENT NUMBER.
 *   THE ECONOMY IS BOUNDED — every dish is a counter row, priced by the one
 *     table, so nothing here can invent a price or a second shop.
 *
 * The rest is the ask made measurable: the board is one board on a given day
 * and a different one tomorrow, the cook always terminates, a droid cannot eat
 * and a man cannot charge, and there are soldiers in the cantina at 22:00 and
 * none of them at 06:00.
 */

import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL('../../src/' + p, import.meta.url), 'utf8');
/* Comments are stripped before every scan, for `company.mjs`'s reason: a check
 * that reads prose finds the word "currency" in the paragraph explaining why
 * there is not one. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Everything on the disk, as one comparable string. See the first check. */
function foldSnapshot() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    out.push(`${k}=${localStorage.getItem(k)}`);
  }
  return out.sort().join('\n');
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: a meal is a provision — nothing it does reaches the disk', async () => {
    /**
     * ══ THE ONE THAT MATTERS ═════════════════════════════════════════════
     *
     * `Progress.js`: a provision is *"a run's worth of something, and gone
     * when the run ends."* The usual way to hold that is a routine that
     * clears the buff on death, and the usual way it fails is that somebody
     * adds a second death path and forgets to call it.
     *
     * So this measures the stronger property instead: THERE IS NOWHERE FOR A
     * BUFF TO LIVE. Every durable key in the process is recorded, twenty-one
     * dishes and two charges are eaten, and nothing on the disk moves by one
     * byte. A buff that cannot be written cannot be forgotten about.
     *
     * IT SNAPSHOTS THE WHOLE OF `localStorage` AND NOT FOUR NAMED KEYS. A
     * named list is exactly the silence `companions.mjs` calls "a hazard, not
     * a permission" — a key added tomorrow would be invisible to it.
     */
    const F = await import('../../src/game/Food.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    clearStation();
    /* Something in every fold, so the snapshot is of a populated disk rather
     * than of an empty one — a comparison of nothing to nothing passes. */
    const { loadProgress } = await import('../../src/game/Progress.js');
    loadProgress();
    const C = await import('../../src/game/Credits.js');
    C.pay(120, 'a purse, so the wallet is on the disk');
    const H = await import('../../src/game/Home.js');
    H.saveHome(H.loadHome());

    const before = foldSnapshot();
    assert(before.length > 40, 'the disk is empty — this check would pass on nothing');

    let ate = 0;
    for (const d of [...F.dishes(), ...F.CHARGES]) {
      const kind = F.isCharge(d) ? 'steel' : 'flesh';
      const r = F.eat(d, { kind, day: 0, hour: 12 });
      assert(r.ok, `${d.id} could not be eaten: ${r.why}`);
      assert(r.slot && Object.keys(r.slot.mods).length > 0, `${d.id} does nothing at all`);
      ate++;
    }
    assert(ate >= 23, `only ${ate} things are edible in the whole tree`);
    assert(foldSnapshot() === before,
      `eating ${ate} things changed the disk — a meal has found somewhere durable to live, `
      + 'and the doctrine\'s "gone when the run ends" is now a routine somebody has to remember to call');

    /* AND THE FILE ITSELF HOLDS NO PEN. `Food.js` may not learn how to write:
     * the moment it can, the guarantee above becomes an opinion about how it
     * is used rather than a fact about what it can do. */
    const code = strip(await src('game/Food.js'));
    for (const bad of ['localStorage', 'makeStore', 'setItem', 'setHomeState', 'sessionStorage']) {
      assert(!code.includes(bad), `Food.js reaches for ${bad} — it has grown a store`);
    }
    return `${ate} dishes and charges eaten, ${before.split('\n').length} durable keys unmoved, Food.js holds no pen`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: a buff cannot outlive a death, and neither can an uneaten dish', async () => {
    /**
     * Two halves of the same rule and they fail differently.
     *
     * THE BUFF expires off the station clock: a meal bought at 20:00 with
     * `hours: 3` does nothing at all at 23:01, and `modsOf` past `until` is
     * empty rather than faded. Driven over every dish in the tree, because a
     * single row with `hours` missing would be a permanent multiplier and
     * nothing else in the tree would say so.
     *
     * THE DISH is the half that needs a door: an uneaten bowl sitting in the
     * larder is still a provision, and `Home.emptyLarder` is what a death
     * calls. Driven through the REAL fold — stow, write, read back, kill,
     * read back — because the thing being asserted is about persistence and a
     * check that never wrote to a disk would be asserting about an array.
     */
    const F = await import('../../src/game/Food.js');
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();

    let widest = 0;
    for (const d of F.dishes()) {
      const at = F.clockOf(2, 20);
      const slot = F.eat(d, { kind: 'flesh', clock: at }).slot;
      const hours = d.effect.hours;
      widest = Math.max(widest, hours);
      assert(F.full(slot, at + hours - 0.01), `${d.id} is already over before its ${hours} h are up`);
      assert(!F.full(slot, at + hours), `${d.id} is still in you after its own ${hours} h`);
      assert(Object.keys(F.modsOf(slot, at + hours)).length === 0,
        `${d.id} still carries mods past ${hours} h — that is a permanent buff wearing an expiry`);
      assert(Object.keys(F.modsOf(slot, at + hours - 0.01)).length > 0,
        `${d.id} carries nothing while it is still in you`);
    }
    assert(widest <= 12, `a dish lasts ${widest} h — half a day is not a meal`);

    /* AND THE LARDER, THROUGH THE FOLD. */
    const now = F.clockOf(1, 9);
    for (const id of ['f-pickle', 'f-methane', 'f-stew']) {
      const r = H.stowFood(id, { clock: now, n: 2 });
      assert(r.ok, `${id} would not go in the larder: ${r.why}`);
    }
    assert(S.homeState()?.store?.food?.length === 3, 'the larder did not reach the fold');
    const stocked = H.larder(now);
    assert(stocked.length === 3 && stocked.every((r) => r.n === 2), 'the larder came back wrong');
    const dead = H.emptyLarder();
    assert(dead.lost === 6, `a death threw away ${dead.lost} of 6 stowed dishes`);
    assert(H.larder(now).length === 0, 'a dish survived a death');
    assert((S.homeState()?.store?.food || []).length === 0,
      'the fold still holds food after a death — the larder is a cross-run store');
    return `${F.dishes().length} dishes expire on their own hour (widest ${widest} h); `
      + `a death threw away ${dead.lost} stowed portions and the fold came back empty`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: no dish moves a permanent number', async () => {
    /**
     * The doctrine forbids a third category — permanent power — and the way
     * one would arrive is not labelled. `Counter.saneRow` refuses a provision
     * that does not declare `runOnly`, so this holds the two things that rule
     * cannot see:
     *
     *   EVERY DISH GOES THROUGH THAT DOOR. A row that `saneRow` rejects is a
     *     row that would never reach a shelf, and a food surface reading the
     *     table directly would be selling something the shop refuses.
     *   EVERY MOD IS ON THE SLOT AND NOWHERE ELSE. The effect's keys and the
     *     slot's mods are the same set minus `hours` — so there is no field a
     *     dish carries that goes somewhere the expiry does not reach.
     */
    const F = await import('../../src/game/Food.js');
    const K = await import('../../src/game/Counter.js');
    const P = await import('../../src/game/Progress.js');
    const before = JSON.stringify(P.loadProgress());
    let keys = 0;
    for (const d of [...F.dishes(), ...F.CHARGES]) {
      assert(d.kind === 'provision', `${d.id} is a ${d.kind}, not a provision`);
      assert(d.runOnly === true, `${d.id} does not declare runOnly`);
      assert(K.saneRow(d), `${d.id} is a row the counter itself would refuse`);
      const slot = F.eat(d, { kind: F.isCharge(d) ? 'steel' : 'flesh', clock: 0 }).slot;
      const want = Object.keys(d.effect).filter((k) => k !== 'hours').sort().join(',');
      const got = Object.keys(slot.mods).sort().join(',');
      assert(want === got, `${d.id} declares [${want}] and the slot carries [${got}]`);
      keys += slot.mods ? Object.keys(slot.mods).length : 0;
      /* AND THE SLOT'S OWN TABLE IS NEVER HANDED OUT. A caller that merged
       * mods in place would otherwise grow the meal it was reading. */
      const m = F.modsOf(slot, 0);
      m.__poison = 1;
      assert(!('__poison' in slot.mods), `${d.id} handed out its own mods table`);
    }
    assert(JSON.stringify(P.loadProgress()) === before, 'eating moved the record');
    return `${F.dishes().length + F.CHARGES.length} rows, all provisions the counter accepts, `
      + `${keys} mods between them and every one of them on the slot`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: the board is one board today and a different one tomorrow', async () => {
    /**
     * `Counter.js`'s reroll is *"the most important sentence in that paragraph
     * and the cheapest thing in it"*, and a menu that re-drew on its own would
     * disagree with the shelf standing behind it at the same counter on the
     * same day.
     *
     * So this asserts the menu IS the shelf, filtered: same board for two
     * readers on one day, a different board tomorrow, and never a tablecloth
     * on it.
     */
    const F = await import('../../src/game/Food.js');
    const V = await import('../../src/game/Vendors.js');
    const counters = [V.FOOD_COURT, V.FRESH_AIR, V.NARN_MARKET];
    let changes = 0, days = 0, worst = '';
    for (const c of counters) {
      for (let day = 0; day < 14; day++) {
        const a = F.menuAt(c, day).map((d) => d.id).join(',');
        const b = F.menuAt(c, day).map((d) => d.id).join(',');
        assert(a === b, `${c.id} showed two boards on day ${day}: ${a} / ${b}`);
        assert(a.length > 0, `${c.id} has nothing to eat on day ${day}`);
        assert(F.menuAt(c, day).every(F.isDish),
          `${c.id} put something on the board on day ${day} that is not food`);
        const t = F.menuAt(c, day + 1).map((d) => d.id).join(',');
        if (t !== a) changes++; else worst = `${c.id} day ${day}`;
        days++;
      }
    }
    /* NOT "IT SOMETIMES CHANGES" — most of the time, or the reroll is a
     * rounding artefact. A shelf of five drawn from nine that came back the
     * same on ten days running would satisfy a weaker bar than this. */
    assert(changes >= days * 0.75,
      `the board changed overnight on only ${changes} of ${days} days (last repeat: ${worst})`);
    /* AND WHICH COUNTERS COOK IS DERIVED. A surface with `[17, 15, 32]` in it
     * would be wrong the first time somebody put a soup on the quartermaster's
     * shelf, and nothing anywhere would say so. */
    const kitchens = F.kitchens().map((c) => c.id).sort().join(',');
    assert(kitchens === 'foodcourt,freshair,narnmarket',
      `the kitchens came back as ${kitchens} — either a counter grew food or one lost it`);
    assert(!F.isKitchen(V.QUARTERMASTER) && !F.isKitchen(V.CLOTHIER),
      'a stim or a bolt of cloth reads as something you can cook');

    /* And the shopping is struck out: `FRESH_AIR` sells a tablecloth. */
    const all = new Set(counters.flatMap((c) => Array.from({ length: 14 }, (_, d) => F.menuAt(c, d)).flat().map((r) => r.id)));
    assert(!all.has('home-cloth') && !all.has('home-banner'),
      'a piece of furniture reached a food board');
    return `${days} counter-days, ${changes} of them changed overnight, ${all.size} distinct dishes seen, no furniture`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: the cook always terminates, and it says every line once', async () => {
    /**
     * *"a small cutscene of it being cooked."* `Warp.js` is the precedent and
     * the argument is its: a sequence written as data can be DRIVEN, and a
     * check that can drive it can assert the only two things that matter
     * about a cutscene — that it ends, and that it ends having said what it
     * was for.
     *
     * Every dish, at five step sizes including one that is longer than the
     * whole sequence. The big `dt` is the one that catches the classic bug:
     * an advance of one phase per call leaves the last three lines unsaid on
     * a stalled frame and finishes silently.
     */
    const F = await import('../../src/game/Food.js');
    const rows = [...F.dishes(), ...F.CHARGES];
    let longest = 0, shortest = 1e9, runs = 0;
    for (const d of rows) {
      const c = F.cookFor(d);
      assert(c && c.steps.length >= 3, `${d.id} is cooked in ${c?.steps.length ?? 0} steps`);
      assert(c.steps.every((s) => s.t > 0 && typeof s.say === 'string' && s.say.length > 10),
        `${d.id} has a step with no time or no line on it`);
      const secs = F.cookSeconds(d);
      assert(secs >= 2 && secs <= 8, `${d.id} takes ${secs.toFixed(1)} s — "small" is between 2 and 8`);
      longest = Math.max(longest, secs); shortest = Math.min(shortest, secs);
      /* THE LAST LINE IS THE DISH. A cutscene that ends without naming what
       * you are holding is a cutscene about nothing. */
      const last = c.steps[c.steps.length - 1].say;
      assert(last.startsWith(d.name), `${d.id} hands over saying "${last}"`);

      for (const dt of [0.001, 1 / 60, 1 / 30, 0.25, 10]) {
        const said = [];
        let over = null;
        const ck = new F.Cook(d, { say: (l) => said.push(l), done: (id) => { over = id; } });
        let n = 0;
        while (!ck.done && n < 100000) { ck.step(dt); n++; }
        assert(ck.done, `${d.id} never finished cooking at dt=${dt}`);
        assert(over === d.id, `${d.id} finished without handing anything over at dt=${dt}`);
        assert(said.length === c.steps.length,
          `${d.id} said ${said.length} of ${c.steps.length} lines at dt=${dt} — a big step ate the ones it stepped over`);
        assert(said.join('|') === c.steps.map((s) => s.say).join('|'),
          `${d.id} said its lines out of order at dt=${dt}`);
        assert(ck.progress === 1, `${d.id} finished at ${ck.progress} progress at dt=${dt}`);
        runs++;
      }
      /* AND `finish()` LANDS IT WITHOUT LOSING THE REST. A player who walks
       * off mid-cook still gets the thing they paid for. */
      const said = [];
      const ck = new F.Cook(d, { say: (l) => said.push(l) });
      ck.step(0.2);
      ck.finish();
      assert(ck.done && said.length === c.steps.length,
        `${d.id} cut short said ${said.length} of ${c.steps.length} lines`);
    }
    return `${rows.length} dishes cooked ${runs} times over five step sizes, `
      + `${shortest.toFixed(1)}–${longest.toFixed(1)} s each, every line once and in order`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: a droid cannot eat and a man cannot charge', async () => {
    /**
     * *"droids charge instead of eating."* Two refusals, each the other's
     * mirror, and both SPEAK — `Counter.offerFrom`'s rule: a door that closes
     * without a line is indistinguishable from a defect.
     *
     * And the third clause of that sentence is *"instead of"*: a charge fills
     * the same slot a meal does, so a droid that has just charged is refused
     * a second charge on exactly the terms a man is refused a second dinner.
     */
    const F = await import('../../src/game/Food.js');
    const A = await import('../../src/game/Attributes.js');
    assert(A.kindOfArmy('separatist') === 'steel' && A.kindOfArmy('republic') === 'flesh',
      'the two words this file branches on are not the tree\'s own any more');
    assert(F.eaterKind('separatist') === 'steel', 'Food.eaterKind does not answer the army table');

    let refusedDroid = 0, refusedMan = 0;
    for (const d of F.dishes()) {
      if (F.isCharge(d)) continue;
      const r = F.eat(d, { kind: 'steel', clock: 0 });
      assert(!r.ok, `a droid ate ${d.name}`);
      assert(/droid|stomach|post/i.test(r.why), `the refusal for ${d.id} says "${r.why}"`);
      refusedDroid++;
    }
    for (const c of F.CHARGES) {
      const r = F.eat(c, { kind: 'flesh', clock: 0 });
      assert(!r.ok, `a man drank ${c.name}`);
      assert(r.why && r.why.length > 8, `the refusal for ${c.id} says nothing`);
      refusedMan++;
    }
    assert(refusedDroid >= 20 && refusedMan === F.CHARGES.length,
      `${refusedDroid} dishes refused a droid, ${refusedMan} charges refused a man`);

    /* A CHARGE IS FREE, and that is a decision rather than an oversight: a
     * separatist roll must not have to pay to do the one thing it can do. */
    assert(F.CHARGES.every((c) => c.free === true), 'a charge has been given a price');
    assert(F.offeredTo('steel').length === F.CHARGES.length, 'a droid was offered the food court');
    assert(F.offeredTo('flesh').length === F.dishes().length, 'a man was offered a socket');

    /* THE SAME SLOT. A charge blocks a charge exactly as a meal blocks a meal. */
    const c0 = F.eat('c-post', { kind: 'steel', clock: 0 });
    assert(c0.ok, `a droid could not charge: ${c0.why}`);
    const again = F.eat('c-trickle', { kind: 'steel', clock: 1, slot: c0.slot });
    assert(!again.ok && /full/i.test(again.why), `a droid charged twice: ${again.why}`);
    const later = F.eat('c-trickle', { kind: 'steel', clock: 7, slot: c0.slot });
    assert(later.ok, `a droid could not charge again after ${c0.slot.until} h: ${later.why}`);
    /* AND NOTHING A DROID DOES GOES IN A LARDER. */
    assert(!F.stow([], 'c-post', { clock: 0 }).ok, 'current went into a larder');
    return `${refusedDroid} dishes refused a droid, ${refusedMan} charges refused a man, `
      + 'a charge fills the same slot and cannot be carried home';
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: the larder keeps by the clock, and a poured glass does not travel', async () => {
    /**
     * *"take it home and store it in your apartment."*
     *
     * ONE CLASSIFICATION CARRIES BOTH FEATURES. `PREP` says how a dish is made
     * and how long it keeps, so a thing cooked over a burner cannot also keep
     * like a sealed jar — which is what two tables would allow, with nothing
     * anywhere to say so. This is the check that reads the consequence rather
     * than the table: the order of the keeping times is the order of the
     * cooking, and a sealed jar outlives a wok bowl by a day and a half.
     */
    const F = await import('../../src/game/Food.js');
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();

    /* NOTHING DEFAULTS. A dish nobody has classified is an error naming the
     * dish, not a bowl that quietly keeps for three days. */
    const orphans = F.dishes().filter((d) => !F.prepOf(d)).map((d) => d.id);
    assert(orphans.length === 0,
      `${orphans.length} dishes have no prep: ${orphans.join(', ')} — add one word to `
      + 'Food.PREP_OF saying how it is made; there is deliberately no default');

    assert(F.keepsFor('f-pickle') > F.keepsFor('f-bread'), 'a sealed jar does not outlast a plate of bread');
    assert(F.keepsFor('f-bread') > F.keepsFor('f-stew'), 'a cold plate does not outlast a pot');
    assert(F.keepsFor('f-stew') > F.keepsFor('f-noodle'), 'a pot does not outlast a wok bowl');
    assert(F.keepsFor('f-noodle') > F.keepsFor('f-wine'), 'a wok bowl does not outlast a poured glass');
    assert(F.keepsFor('f-pickle') - F.keepsFor('f-noodle') >= 36,
      'a sealed jar and a wok bowl keep for nearly the same time — the classification buys nothing');

    /* THE CLOCK IS ABSOLUTE. A jar stowed at 22:00 and read at 03:00 is five
     * hours old, not twenty-nine — which is the whole reason `t` is
     * `day * 24 + hour` and not an hour of the day. */
    const stowedAt = F.clockOf(3, 22);
    let r = H.stowFood('f-noodle', { clock: stowedAt });
    assert(r.ok, `a bowl would not go in: ${r.why}`);
    assert(H.larder(F.clockOf(4, 1)).length === 1, 'a bowl three hours old had gone off');
    assert(H.larder(F.clockOf(4, 3)).length === 0, 'a wok bowl survived five hours');
    assert((S.homeState()?.store?.food || []).length === 0,
      'the sweep did not write the spoiled row out of the fold');

    /* AND A ROW THAT IS THERE IS A ROW YOU CAN EAT. A list with dead entries
     * in it is a list that lies, and the player finds out at the moment they
     * were counting on a meal. */
    H.stowFood('f-methane', { clock: stowedAt, n: 3 });
    const shown = H.larder(F.clockOf(4, 12));
    assert(shown.length === 1 && shown[0].n === 3 && !shown[0].spoiled, 'the sealed row did not survive');
    const take = H.takeFood('f-methane', { clock: F.clockOf(4, 12) });
    assert(take.ok && take.dish && take.dish.id === 'f-methane', `taking it back out failed: ${take.why}`);
    assert(H.larder(F.clockOf(4, 12))[0].n === 2, 'taking one out did not take one out');
    assert(!H.takeFood('f-fish', { clock: 0 }).ok, 'took a dish that was never stowed');

    /* THE HAND-EDITED SAVE. `t` is clamped on the way in like every other
     * number in that record — `home.mjs`'s law, and this is the field this
     * lane added to it. */
    S.setHomeState({ store: { food: [{ id: 'f-pickle', n: 500, t: -99 }, { id: 'f-pickle', n: 1, t: 'soon' }] } });
    const clamped = H.loadHome().store.food;
    assert(clamped.every((x) => x.n >= 1 && x.n <= 99 && Number.isFinite(x.t) && x.t >= 0),
      `a hand-edited larder row came back ${JSON.stringify(clamped)}`);

    return `keeps run ${F.keepsFor('f-wine')}→${F.keepsFor('f-pickle')} h across ${Object.keys(F.PREP).length} preps; `
      + 'a wok bowl died in five hours and a sealed jar did not, through the real fold';
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: the bars fill with soldiers at their own hour and hold none at 06:00', async () => {
    /**
     * *"one or two bars … a casino/nightclub with troops on leave."*
     *
     * The station already had three bars and none of them had ever held a
     * soldier. This is the half that was missing, and it is a POPULATION at an
     * HOUR — so it is measured against `StationLife.headcount`, which is the
     * curve that already decides how full a room is, rather than against a
     * number this lane invented.
     *
     * THE 06:00 CLAUSE IS THE ONE THAT BITES. The cantina is not empty at
     * 06:00 — seven people work nights — so "empty" has to mean empty of
     * UNIFORMS, which is a different curve from fullness and is the whole
     * reason `libertyAt` exists beside it.
     */
    const B = await import('../../src/game/Bars.js');
    const L = await import('../../src/game/StationLife.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');

    /* EVERY BAR IS A ROOM THAT EXISTS. §15: a place not in §3.2 is not built,
     * and a bar pointing at nothing would seat an evening into nowhere. */
    for (const b of B.BARS) {
      const p = PLACE.get(b.id);
      assert(p, `bar #${b.id} is not in the gazetteer`);
      assert(/bar|sabacc|dice|cantina/i.test(p.look + p.name),
        `#${b.id} ${p.name} does not read as a place anybody drinks in: "${p.look}"`);
    }
    assert(Math.abs(B.BARS.reduce((a, b) => a + b.draw, 0) - 1) < 1e-9,
      'the three draws do not add to one — somebody is on leave nowhere');

    const company = {
      army: 'republic',
      men: Array.from({ length: 30 }, (_, i) => ({
        designation: `CT-${1000 + i * 7}`, nickname: i % 3 ? null : 'Ladder', kind: 'flesh',
      })),
      ward: { tanks: ['CT-1007'] },
    };

    /* THE MORNING. Nobody in uniform, in any bar, at any hour before liberty. */
    let morningHeads = 0;
    for (const b of B.BARS) {
      for (const h of [3, 6, 9, 12, 15, 17]) {
        const heads = L.headcount(PLACE.get(b.id), h);
        morningHeads += heads;
        const c = B.crowdOf(b.id, h, heads, { company, day: 0 });
        assert(c.leave.length === 0, `#${b.id} held ${c.leave.length} soldiers at ${h}:00`);
      }
    }
    assert(morningHeads > 60,
      `the bars held ${morningHeads} people all morning — "empty of soldiers" has to mean something `
      + 'other than "empty", or this check passes on a shut station');

    /* THE EVENING. Every bar has soldiers in it, and some of them are yours. */
    let mine = 0, seats = 0;
    for (const b of B.BARS) {
      const heads = L.headcount(PLACE.get(b.id), 22);
      const c = B.crowdOf(b.id, 22, heads, { company, day: 0 });
      assert(c.leave.length > 0, `#${b.id} held no soldiers at 22:00, with ${heads} people in it`);
      assert(c.leave.length <= heads, `#${b.id} held ${c.leave.length} soldiers in a room of ${heads}`);
      assert(c.locals === heads - c.leave.length, `#${b.id}'s arithmetic does not close`);
      mine += c.own; seats += c.leave.length;
    }
    assert(mine >= 3, `only ${mine} of ${seats} uniforms across three bars were men off the player's own roll`);

    /* NAMES OFF THE ROLL, and they are the roll's own. */
    const Co = await import('../../src/game/Company.js');
    const named = B.crowdOf(14, 22, L.headcount(PLACE.get(14), 22), { company, day: 0 })
      .leave.filter((r) => r.leave);
    assert(named.length > 0, 'nobody in the cantina was one of yours');
    for (const r of named) {
      const man = company.men.find((m) => m.designation === r.leave.designation);
      assert(man, `${r.name} is not on the roll`);
      assert(r.name === Co.nameOf(man),
        `the bar calls him "${r.name}" and the roster calls him "${Co.nameOf(man)}"`);
      assert(r.role === 'trooper' && r.species === 'human' && r.stature > 1,
        `${r.name} came out of the bar without a body`);
    }

    /* THE WOUNDED ARE NOT DRINKING. `Company.ward.tanks` is who is in the
     * glass at #44 and `Medbay.js` is mending him by the hour. */
    const everyone = B.BARS.flatMap((b) => B.crowdOf(b.id, 22, L.headcount(PLACE.get(b.id), 22), { company, day: 0 }).leave)
      .filter((r) => r.leave).map((r) => r.leave.designation);
    assert(!everyone.includes('CT-1007'), 'a man in a bacta tank was in a bar');

    /* A DROID DOES NOT TAKE LEAVE — the same rule `Food.js` draws, drawn once. */
    const steel = { ...company, army: 'separatist', men: company.men.map((m) => ({ ...m, kind: 'steel' })) };
    assert(B.onLeave(steel, 0).length === 0, 'a droid was granted an evening in the cantina');
    assert(B.crowdOf(14, 22, 26, { company: steel, day: 0 }).own === 0,
      'a separatist roll put its own men in a bar');

    /* AND WITH NO ROLL AT ALL THE STATION'S OWN GARRISON STANDS IN, because a
     * bar that emptied because you have not played the muster yet is a feature
     * punishing you for not having used another feature. */
    const alone = B.crowdOf(14, 22, L.headcount(PLACE.get(14), 22), {});
    assert(alone.leave.length > 0 && alone.own === 0,
      `with no company the cantina held ${alone.leave.length} soldiers, ${alone.own} of them named`);

    /* THE ROLL LASTS THE DAY AND CHANGES OVERNIGHT — `Counter.shelfFor`'s own
     * contract, for the same reason: a roll per visit is a room you can re-draw
     * by walking out and back in. */
    const d0 = B.onLeave(company, 0).map((r) => r.man.designation).join(',');
    assert(d0 === B.onLeave(company, 0).map((r) => r.man.designation).join(','), 'two readers saw two evenings');
    let moved = 0;
    for (let d = 0; d < 10; d++) {
      if (B.onLeave(company, d).map((r) => r.man.designation).join(',') !== d0) moved++;
    }
    assert(moved >= 8, `the same men had leave on ${10 - moved} of 10 days`);

    /* AND THE POOL ACTUALLY SEATS THEM. `StationLife.occupant` is what builds
     * a body, so a bar full of soldiers that the pool never asked about would
     * be a table nobody reads. */
    const p14 = PLACE.get(14);
    const heads22 = L.headcount(p14, 22);
    const seated = [];
    for (let i = 0; i < heads22; i++) {
      const r = L.occupant(p14, i, { hour: 22, day: 0, heads: heads22, company });
      if (r.role === 'trooper' || r.bar === 14) seated.push(r);
    }
    assert(seated.length > 0, 'the pool seated no soldiers into the cantina at 22:00');
    const dawn = [];
    for (let i = 0; i < L.headcount(p14, 6); i++) {
      const r = L.occupant(p14, i, { hour: 6, day: 0, heads: L.headcount(p14, 6), company });
      if (r.bar === 14) dawn.push(r);
    }
    assert(dawn.length === 0, `the pool seated ${dawn.length} soldiers into the cantina at 06:00`);
    /* …and a caller with no clock — `Pits.js` is one — gets the census it
     * always got, unchanged. */
    assert(!L.occupant(p14, 8).bar, 'occupant with no hour handed back a bar seat');

    return `3 bars, 0 uniforms across 18 morning readings of ${morningHeads} people, `
      + `${seats} at 22:00 of which ${mine} were named off a roll of ${company.men.length}; `
      + `the leave roll moved on ${moved} of 10 nights; the pool seated ${seated.length} into #14`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: neither new file has grown a shop, a wallet or a die', async () => {
    /**
     * `companions.mjs`'s scan, extended to the two files this lane created, ON
     * THE COMMIT THAT CREATES THEM — COMPANY.md's rule for exactly this class:
     * a new file is invisible to every existing scan and therefore legal by
     * default, and *"that silence is a hazard, not a permission."*
     *
     * `Food.js` is the one with the pull: it is about a thing you pay for, it
     * sits one import from `Credits.js`, and the easy mistake is a price table
     * of its own. It has none — `Counter.priceOf` is the only price in the
     * tree and `Vendors.js` is the only content.
     *
     * AND NO DIE. `determinism.mjs` refuses `Math.random` in shipped code and
     * this lane has two reasons of its own: two people standing at one counter
     * must see one board, and two people standing in one bar must see the same
     * men.
     */
    for (const f of ['game/Food.js', 'game/Bars.js']) {
      const code = strip(await src(f));
      for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
        assert(!new RegExp(`\\b${word}\\b`, 'i').test(code),
          `${f} has grown a "${word}" — the kitchen has become a shop`);
      }
      assert(!/Math\.random/.test(code), `${f} rolls a die — the board would change when you looked away`);
      assert(!/\bbase:\s*\d{2,}/.test(code), `${f} has grown a price table beside Vendors.js`);
    }
    /* AND `Food.js` PRICES NOTHING. Every dish's price comes off the counter,
     * which is what keeps `Progress.js`'s "the economy is bounded" true: a
     * second pricing authority would be a second economy. */
    const F = await import('../../src/game/Food.js');
    const K = await import('../../src/game/Counter.js');
    const C = await import('../../src/game/Credits.js');
    const dearest = F.dishes().reduce((a, d) => Math.max(a, K.priceOf(d)), 0);
    assert(dearest > 0 && dearest < C.PER_RUN_CAP,
      `the dearest dish is ${dearest} against a per-run cap of ${C.PER_RUN_CAP} — a meal costs a whole run`);
    const cheapest = F.dishes().reduce((a, d) => Math.min(a, K.priceOf(d)), Infinity);
    return `2 files clean of all six words and of Math.random; dishes run ${cheapest}–${dearest} `
      + `credits against a per-run cap of ${C.PER_RUN_CAP}`;
  });
}
