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

export async function run({ check, assert, THREE }) {
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

  check('food: a meal reaches the fighter, and so does a stim', async () => {
    /**
     * ══ THE ONE THE WHOLE LANE WAS FOR, AND IT HAD NO READER ═════════════
     *
     * *"certain types of food even give you certain buffs that last for a
     * limited amount of time."* Every clause above this one measures that a
     * meal is BOUNDED — it expires, it writes nothing durable, it moves no
     * permanent number. None of them measured that it does anything at all,
     * and it did not: `Food.modsOf` — the one function that says what a meal
     * is doing to you — had ZERO CALLERS in `src/`, and the slot it reads
     * lived in a module-local in `main.js` that only the larder's own page
     * looked at. Measured before this clause, through the whole shipped path:
     * buy Clear broth, watch the five cook lines land, eat it in the larder,
     * deploy a skirmish, read `world.players[0].boonMods` — `staminaRegen`
     * 1.000, the baseline, not 1.000 x 1.08. The "temporary powerups that do
     * not survive death" contract was vacuously true because nothing started.
     *
     * The Quartermaster's provisions were the same hole: `{flowGain: 1.25}`,
     * `{ward: 0.86}` and `{stratagem: 1}` were priced, sold, charged for and
     * dropped.
     *
     * ONE WORLD, TWO BODIES. The provisions ride on `world.run`, so the same
     * world can spawn a fed fighter and then a plain one with nothing else
     * different about them — a second `bootWorld` would differ by a level
     * build as well and could not attribute what moved.
     */
    const F = await import('../../src/game/Food.js');
    const { everyRow } = await import('../../src/game/Vendors.js');
    const { bootWorld } = await import('./_coop.mjs');

    /* THE MEAL, through the same two functions the larder calls. */
    const at = F.clockOf(3, 20);
    const broth = F.dishById('f-broth');
    const ate = F.eat(broth, { kind: 'flesh', clock: at });
    assert(ate.ok, `Clear broth would not go down: ${ate.why}`);
    const meal = F.modsOf(ate.slot, at);
    assert(meal.staminaRegen > 1, `Clear broth carries ${JSON.stringify(meal)}`);

    /* AND A STIM AND A COMM CHARGE, off the shelf they are actually sold on. */
    const stim = everyRow().find((r) => r.id === 'stim-focus');
    const charge = everyRow().find((r) => r.id === 'charge-second');
    assert(stim && charge, 'the Quartermaster no longer stocks the two rows this measures');
    const provisions = { ...meal };
    for (const [k, v] of Object.entries({ ...stim.effect, ...charge.effect })) provisions[k] = v;

    const { world } = await bootWorld({ run: { provisions } });
    try {
      const fed = world.players[0];
      /* The same world, with the bag taken away: everything else about the two
       * bodies is identical by construction. */
      world.run.provisions = null;
      const plain = world.spawnPlayer({ name: 'Unfed', isLocal: false });

      assert(Math.abs(fed.boonMods.staminaRegen - plain.boonMods.staminaRegen * meal.staminaRegen) < 1e-9,
        `a bowl of Clear broth left staminaRegen at ${fed.boonMods.staminaRegen} against an unfed `
        + `${plain.boonMods.staminaRegen} — the meal reached nothing`);
      assert(Math.abs(fed.boonMods.flowGain - plain.boonMods.flowGain * stim.effect.flowGain) < 1e-9,
        `70 credits of Focus stim left flowGain at ${fed.boonMods.flowGain}`);
      /* THE COMM CHARGE IS NOT A BODY'S NUMBER and is deliberately dropped by
       * the boonMods path — it is calls, and `Stratagems` is what holds them. */
      assert(!('stratagem' in fed.boonMods),
        'a comm charge was written onto boonMods, where nothing reads it');
      assert(fed.stratagems.charges === charge.effect.stratagem,
        `the Second charge bought ${fed.stratagems.charges} free calls and says ${charge.effect.stratagem}`);
      assert(plain.stratagems.charges === 0, 'an unfed fighter starts with free calls');

      /* AND NOTHING ELSE MOVED. A provision that quietly touched a key nobody
       * bought is the shape this whole file is written against. */
      const touched = Object.keys(provisions).filter((k) => k !== 'stratagem');
      let drifted = [];
      for (const k of Object.keys(plain.boonMods)) {
        if (typeof plain.boonMods[k] !== 'number' || touched.includes(k)) continue;
        if (fed.boonMods[k] !== plain.boonMods[k]) drifted.push(k);
      }
      assert(!drifted.length, `eating and buying moved ${drifted.join(', ')}, which nothing paid for`);

      /* AND AN EXPIRED MEAL IS NOT A MEAL. `modsOf` past the hour is empty, so
       * a run deployed after the broth has worn off carries nothing from it —
       * nobody has to remember to expire anything. */
      assert(Object.keys(F.modsOf(ate.slot, at + broth.effect.hours)).length === 0,
        'the slot still carries mods past its own hours');
      return `broth x${meal.staminaRegen} reached staminaRegen `
        + `(${plain.boonMods.staminaRegen} → ${fed.boonMods.staminaRegen.toFixed(3)}), `
        + `Focus stim reached flowGain (${plain.boonMods.flowGain} → ${fed.boonMods.flowGain.toFixed(3)}), `
        + `the Second charge reached ${fed.stratagems.charges} free calls, and ${drifted.length} other keys moved`;
    } finally { world.dispose?.(); }
  });

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

  check('food: the cook MOVES — every stall, measured in millimetres', async () => {
    /**
     * ══ THE CLAUSE THIS FILE DID NOT HAVE ════════════════════════════════
     *
     * The check above drives the whole of every cook and asserts that it ends
     * having said its lines. It passed, unchanged, on a build where NOTHING
     * ANYWHERE MOVED: `Food.Cook` was five sentences in a banner, the counter
     * pane held `world.paused` true behind it, and the lane's own promise of
     * *"one animation loop per stall"* was zero loops. A cutscene check that
     * only reads the script cannot tell a cutscene from a subtitle.
     *
     * So this one measures the geometry. The real `CookSet` is built on a
     * fabricated desk — the four world fields `StationKit.counter()` really
     * records — with a real `Rig` behind it, every dish in the tree is cooked
     * at 1/60, and what is asserted is DISTANCE TRAVELLED by meshes and by
     * hand bones. There is no field to set and no flag to return: a build
     * where the pan does not move fails here in millimetres.
     *
     * ── AND IT REFUSES THE THREE WAYS A MOTION CHECK LIES ────────────────
     *
     *   A TELEPORT IS NOT AN ANIMATION. The biggest single frame is bounded,
     *   so a piece that jumps to its final place on frame one and sits there
     *   cannot pass on total travel.
     *   NEITHER IS ONE BUSY FRAME. Motion has to be spread — most frames of
     *   the cook must move something — so a shiver on the hand-over is not a
     *   cook either.
     *   AND IT HAS TO BE THE THING THE LINE SAYS. The step whose `move` is
     *   `toss` must move the pan further than the step whose `move` is
     *   `still` does, per cook, which is the whole claim of putting `move` on
     *   the step rather than in a table beside it.
     */
    const F = await import('../../src/game/Food.js');
    const { CookSet } = await import('../../src/game/StationKit.js');
    const { Rig, humanoidSkeleton } = await import('../../src/game/Rig.js');
    /* THE SAME COPY THE GAME LOADS, by the path `src/` itself imports — the
     * loader maps the bare specifier onto this file, so a check that reached
     * for `three` and a module that reached for the vendor path would be one
     * module instance either way. Taken here rather than off `run`'s argument
     * so this clause does not depend on which harness invoked it. */
    const THREE = await import('../../vendor/three/three.module.js');

    /* The nine materials a deck publishes, by the keys `CookSet` names. Real
     * materials rather than stubs, because a mesh is what is being measured. */
    const mats = {};
    for (const k of ['hull', 'dark', 'deep', 'wing', 'mark', 'strip', 'status', 'screen', 'glass']) {
      mats[k] = new THREE.MeshStandardMaterial({ name: `station-40-${k}` });
    }
    /* #17's own stall, to the centimetre: 1.1 m deep, a 1.15 m top, its face
     * toward −Z. `at`, `front`, `behind`, `w`, `d` and `h` are exactly the six
     * fields the emit records — see `StationKit.counter`. */
    const DESK = {
      at: { x: 0, y: 0, z: 0 }, front: { x: 0, y: 0, z: -1.55 }, behind: { x: 0, y: 0, z: 1.1 },
      w: 6.7, d: 1.1, h: 1.15,
    };
    const counter = { id: 'foodcourt', place: 17, name: 'The food court' };

    const fresh = () => {
      const rig = new Rig(humanoidSkeleton(1));
      rig.hipsBone.obj.position.set(DESK.behind.x, 0.95, DESK.behind.z);
      const body = {
        position: new THREE.Vector3(DESK.behind.x, 0, DESK.behind.z),
        velocity: new THREE.Vector3(), facing: Math.PI, dead: false, lod: 3, rig,
      };
      return {
        scene: new THREE.Scene(), statics: [],
        player: { position: new THREE.Vector3(DESK.front.x, 0, DESK.front.z) },
        _station: { mats, counters: new Map([[17, [DESK]]]), keepers: [{ id: 'foodcourt', body }] },
        body,
      };
    };

    const rows = [...F.dishes(), ...F.CHARGES];
    const DT = 1 / 60;
    const worst = { jump: 0, id: null };
    let leastTravel = Infinity, leastId = null, leastBusy = 1, leastAny = 1, poorestHand = Infinity;
    let farthestTouch = 0;
    let cooked = 0, piecesSeen = 0;

    for (const d of rows) {
      const prep = F.prepOf(d);
      assert(prep && F.GEAR[prep.id], `${d.id} is made by '${prep?.id}' and no gear says what stands on the stall`);
      const world = fresh();
      const rig = world.body.rig;
      const cook = new F.Cook(d, { say: () => {}, done: () => {} });
      const set = new CookSet(world, counter, cook, prep.id);
      assert(!set.done, `${d.id} built no cook set at a desk that exists`);
      /* HELD BY REFERENCE, because the last frame of a cook DISPOSES the set —
       * `parts` is empty by the time the loop ends, which is the whole point
       * of it, and the meshes are still readable. */
      const pieces = [...Object.values(set.parts), ...set.puffs];
      const dishMesh = set.parts.dish;
      /**
       * EVERY PIECE THE GEAR NAMES WAS ACTUALLY BUILT. The renderer matches
       * `vessel`, `tool` and `lid` against ids it knows and silently builds
       * nothing for one it does not — which is how `grill` shipped naming a
       * 'grate' the builder had never heard of: the skewer over the coals was
       * missing, and every bound in this check still passed on the tool and
       * the dish alone. A word in one file and a branch in another is exactly
       * the pair §2.3 says must fail loudly.
       */
      const gear = F.GEAR[prep.id];
      for (const k of ['vessel', 'tool']) {
        if (gear[k]) {
          assert(set.parts[k], `${d.id} is made with a ${k} called '${gear[k]}' and the stall built none`);
        }
      }
      assert(!gear.lid || set.parts.lid, `${d.id}'s prep has a lid and the stall built none`);
      assert(pieces.length >= 3, `${d.id} put ${pieces.length} pieces on the counter`);
      piecesSeen += pieces.length;

      const at = (m) => { m.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(m.matrixWorld); };
      const prev = new Map(pieces.map((m) => [m, at(m)]));
      /* A PIECE THAT IS NOT DRAWN CANNOT POP. The steam recycles at the top of
       * its climb and the dish does not exist until it is made, so both are
       * hidden across the frame they jump on; counting a delta the player
       * could not see would be this check inventing its own defect. */
      const seen = new Map(pieces.map((m) => [m, m.visible]));
      let hL = rig.worldPos('handL', new THREE.Vector3());
      let hR = rig.worldPos('handR', new THREE.Vector3());
      let travel = 0, handTravel = 0, frames = 0, busy = 0, busyAny = 0, jump = 0;
      /* HOW CLOSE HIS HANDS EVER GET TO THE THING HE IS COOKING WITH. See the
       * assertion below — this is the one number that says the man and the
       * stall are the same event rather than two animations side by side. */
      let touch = Infinity;
      /* Per MOVE, so the last clause can ask whether the pan moved where the
       * line said it would. */
      const byMove = new Map();
      while (!set.done && frames < 2000) {
        const move = cook.move;
        set.step(DT);
        frames++;
        let thisFrame = 0;
        for (const m of pieces) {
          const p = at(m);
          const dd = m.visible && seen.get(m) ? p.distanceTo(prev.get(m)) : 0;
          prev.set(m, p);
          seen.set(m, m.visible);
          thisFrame += dd;
          if (dd > jump) jump = dd;
        }
        const nL = rig.worldPos('handL', new THREE.Vector3());
        const nR = rig.worldPos('handR', new THREE.Vector3());
        const hands = nL.distanceTo(hL) + nR.distanceTo(hR);
        if (set.parts.vessel) {
          const v = at(set.parts.vessel);
          touch = Math.min(touch, v.distanceTo(nL), v.distanceTo(nR));
        }
        handTravel += hands;
        hL = nL; hR = nR;
        travel += thisFrame;
        if (thisFrame > 0.0001) busy++;
        if (thisFrame + hands > 0.0001) busyAny++;
        byMove.set(move, (byMove.get(move) || 0) + thisFrame);
      }
      assert(cook.done, `${d.id} never finished`);
      cooked++;
      /* THE DISH ARRIVED, AND IT ARRIVED ON YOUR SIDE OF THE TOP. `serve` is
       * the one move that crosses the middle, and a bowl that ends up behind
       * the counter is a bowl the cook kept. */
      assert(set.made > 0.98, `${d.id} finished with the dish ${(set.made * 100) | 0}% made`);
      const dish = at(dishMesh);
      const toward = dish.z - DESK.at.z;
      assert(toward < -0.1, `${d.id}'s dish finished ${toward.toFixed(2)} m from the middle of the top, on the cook's side`);

      if (travel < leastTravel) { leastTravel = travel; leastId = d.id; }
      if (handTravel < poorestHand) poorestHand = handTravel;
      if (touch < Infinity) farthestTouch = Math.max(farthestTouch, touch);
      leastBusy = Math.min(leastBusy, busy / frames);
      leastAny = Math.min(leastAny, busyAny / frames);
      if (jump > worst.jump) { worst.jump = jump; worst.id = d.id; }

      assert(travel > 0.5, `${d.id} moved ${(travel * 1000).toFixed(0)} mm of geometry over ${frames} frames — the stall stood still`);
      assert(handTravel > 0.4, `${d.id} moved the cook's hands ${(handTravel * 1000).toFixed(0)} mm — nobody made it`);
      /**
       * SPREAD, AND IT IS TWO BOUNDS BECAUSE ONE OF THE ELEVEN PREPS IS QUIET
       * ON PURPOSE. `pass` is the kitchen behind #15's hatch — its own line is
       * *"you can hear more of it than you can see"* — so for 1.8 s of it the
       * only thing moving is the man at the pass, and a single 75% bound over
       * the meshes would be a check demanding that a deliberately still step
       * fidget. So: something the player can see moves on nearly every frame,
       * counting his hands, which are geometry too — they drive the merged
       * skin — and the counter itself is working for at least a third of it.
       */
      assert(busyAny / frames > 0.9,
        `${d.id} moved nothing at all on ${frames - busyAny} of ${frames} frames`);
      assert(busy / frames > 0.45,
        `${d.id} moved a piece of the stall on only ${busy} of ${frames} frames — a cook is not one busy frame`);
      /* AND NO FRAME CARRIES THE COOK. Measured across the table the worst
       * single frame is 1.7% of its own cook's travel; a piece that arrived
       * in one jump and sat still would be most of it. */
      assert(jump / travel < 0.08,
        `${d.id} did ${(jump / travel * 100).toFixed(0)}% of its whole travel in one frame`);
      /* 150 mm AND NOT 450. The measured worst frame in the whole table is
       * 105 mm — the droid's cable, easing across the counter — so this is
       * the real number with headroom rather than a bound nothing could ever
       * hit. It is what caught the eleven step boundaries that used to cut
       * from one move straight into the next: 155 to 884 mm, in a frame. */
      assert(jump < 0.15, `${d.id} moved a piece ${(jump * 1000).toFixed(0)} mm in one frame — that is a teleport, not a cook`);

      /**
       * AND HIS HANDS ACTUALLY REACH IT. Two animations that never meet — a
       * pan tossing itself while a man waves half a metre behind it — would
       * pass every bound above, and it is the failure this is most likely to
       * ship: the cook is stood where `dressKeepers` put him, 0.55 m clear of
       * the desk, and an arm is 0.55 m long. So the solve is asked for the
       * closest a hand ever gets to the vessel over the whole cook.
       */
      if (gear.vessel) {
        assert(touch < 0.30,
          `${d.id}: the cook's nearest hand never got closer than ${(touch * 100).toFixed(0)} cm to `
          + 'the thing he is cooking in — the man and the stall are two animations, not one');
      }

      /* AND THE MOTION IS WHERE THE LINE IS. Every prep has at least one step
       * that does something and the doing steps beat the standing ones. */
      const still = byMove.get('still') || 0;
      const busiest = [...byMove.entries()].sort((a, b) => b[1] - a[1])[0];
      assert(busiest && busiest[0] !== 'still' && busiest[1] > still,
        `${d.id}'s busiest step is '${busiest?.[0]}' — the stall is at its liveliest while the banner says nothing is happening`);
    }

    /* AND THE KEEPER IS AT HIS OWN COUNTER, which is what makes the hands
     * reach the pan at all: `dressKeepers` stands him 0.55 m clear of the back
     * edge and an arm is 0.55 m long. */
    const w2 = fresh();
    const c2 = new F.Cook('f-noodle', { say: () => {} });
    const s2 = new CookSet(w2, counter, c2, 'wok');
    s2.step(DT);
    const gap = Math.abs(w2.body.position.z - DESK.at.z) - DESK.d / 2;
    assert(gap > 0 && gap < 0.45, `the cook works ${gap.toFixed(2)} m back from the edge of his own counter`);
    s2.dispose();
    assert(w2.scene.children.length === 0 && w2.statics.length === 0,
      'the cook set left its meshes on the station after the hand-over');

    return `${cooked} cooks driven at 1/60 on a real desk and a real skeleton; `
      + `${piecesSeen} pieces built between them; the quietest (${leastId}) still travelled `
      + `${(leastTravel * 1000).toFixed(0)} mm with ${(poorestHand * 1000).toFixed(0)} mm of hand, `
      + `the stall itself worked on ${(leastBusy * 100).toFixed(0)}% of frames and something moved on `
      + `${(leastAny * 100).toFixed(0)}% of them; the worst single frame was `
      + `${(worst.jump * 1000).toFixed(0)} mm; the worst stall for it still put a hand `
      + `${(farthestTouch * 100).toFixed(0)} cm from what it was cooking in`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: the cook runs in the room, on the world\'s own clock', async () => {
    /**
     * ══ THE CONSTRAINT THE ANIMATION HAD TO GET PAST ═════════════════════
     *
     * `Screens.take` sets `world.paused = true`, and `frame()` steps the world
     * only while the state is 'playing'. The counter is raised through `take`,
     * so for as long as the pane was up NOTHING on the station could move —
     * an animation built behind it would have been unreachable code with a
     * check passing over the top of it.
     *
     * Two lines hold the fix, and both are read here rather than promised:
     * `cookAtCounter` gives the screen back before the first line lands, and
     * `stepStation` — not a `setTimeout` — is what steps the cook. A timer
     * would put us back where we started: lines arriving over a still room.
     */
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i0 = main.indexOf('function cookAtCounter(');
    assert(i0 > 0, 'nothing in main.js starts a cook any more');
    const region = strip(main.slice(i0, main.indexOf('\n}\n', i0)));
    assert(/\bresume\(\)/.test(region) && /closePane\('counter'\)/.test(region),
      'ordering a dish no longer hands the screen back — the world is paused behind the pane '
      + 'and the stall cannot move a millimetre, which is the defect this lane was opened on');
    assert(/new CookSet\(/.test(region), 'main.js orders a dish without building a stall to cook it on');

    const st = strip(await src('game/Station.js'));
    const iStep = st.indexOf('export function stepStation');
    assert(iStep > 0 && st.indexOf('stepCook(world, dt)', iStep) > iStep,
      'stepStation no longer steps the cook — the animation has no clock but a timer');

    /* AND EVERY STEP IN THE TABLE NAMES A MOVE THE RENDERER KNOWS. A prep
     * added tomorrow with no `move` on a step would stand still through it
     * with nothing to say so — §2.3's "a missing thing gets an error". */
    const F = await import('../../src/game/Food.js');
    let steps = 0;
    for (const [id, prep] of Object.entries(F.PREP)) {
      for (const s of prep.steps) {
        assert(F.MOVES.includes(s.move),
          `${id}.${s.id} moves by '${s.move}', which is not one of the ${F.MOVES.length} moves a stall can make`);
        /* AND NO STEP MAY SPELL ITSELF LIKE THE SENTINEL. `Cook.step` hands
         * back the step's id and reserves 'done' for "it is over the counter",
         * so `PREP.live`'s fourth step — which really was called `done` — ended
         * every loop driving it three quarters of the way through: live spoo
         * said four of five lines and never reached anybody's larder. */
        assert(s.id !== 'done',
          `${id} has a step called 'done', which is the string Cook.step returns when a cook is OVER`);
        steps++;
      }
    }
    return `the pane is handed back before the first line, stepStation drives the cook, `
      + `and all ${steps} steps across ${Object.keys(F.PREP).length} preps name one of ${F.MOVES.length} moves`;
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

  check('food: the bars fill with soldiers at their own hour, through the pool that seats them', async () => {
    /**
     * *"one or two bars … a casino/nightclub with troops on leave."*
     *
     * ── AND THIS CHECK USED TO BE THE DEFECT IT WAS GUARDING ──────────────
     *
     * Every reading here was `Bars.crowdOf(...)` and `Bars.libertyAt(...)`,
     * called straight off the module — and the V16 audit found that
     * `crowdOf` had NO CALLER ANYWHERE UNDER `src/`. So this file was the
     * only thing in the building that had ever run the function it was
     * asserting about: eight green readings over a room no player could see,
     * with the flavour line in `BARS[].line` reachable through the same dead
     * door. A check that calls a function nothing else calls proves the
     * function works, not that the game does.
     *
     * So the crowd is read through `StationLife.occupant` now, which is the
     * one thing in the tree that turns a slot in a room into a body — it asks
     * `Bars.barman`, `barman` asks `leaveHeads` and `soldierIn`, and if any of
     * that stops being wired the readings below go to zero. The panel that
     * shows it to a person is `main.js`'s `showBar`, and the last clause here
     * holds the door open for it.
     */
    const B = await import('../../src/game/Bars.js');
    const L = await import('../../src/game/StationLife.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const Co = await import('../../src/game/Company.js');

    /* EVERY BAR IS A ROOM THAT EXISTS. §15: a place not in §3.2 is not built,
     * and a bar pointing at nothing would seat an evening into nowhere. */
    for (const b of B.BARS) {
      const p = PLACE.get(b.id);
      assert(p, `bar #${b.id} is not in the gazetteer`);
      assert(/bar|sabacc|dice|cantina/i.test(p.look + p.name),
        `#${b.id} ${p.name} does not read as a place anybody drinks in: "${p.look}"`);
      assert(b.ease > 0 && b.mend > 0,
        `#${b.id} ${p.name} pays a man nothing for an evening in it`);
    }
    assert(Math.abs(B.BARS.reduce((a, b) => a + b.draw, 0) - 1) < 1e-9,
      'the draws do not add to one — somebody is on leave nowhere');
    /* THE CONTRAST THE PLAYER ASKED FOR, AS A NUMBER: *"some being really
     * fancy and incredibly upscale and others being incredibly grimy."* An
     * evening at the fancy end has to be worth visibly more than one at the
     * grimy end or the two rooms are one room with different furniture. */
    const fancy = B.BARS.find((b) => b.rope > 0);
    const grimy = B.BARS.reduce((a, b) => (b.ease < a.ease ? b : a));
    assert(fancy, 'no room on this station turns anybody away — there is no upscale end');
    assert(fancy.ease > grimy.ease * 2,
      `the fanciest room pays ${fancy.ease}/h and the grimiest ${grimy.ease}/h — that is not a contrast`);

    const company = {
      army: 'republic',
      men: Array.from({ length: 30 }, (_, i) => ({
        designation: `CT-${1000 + i * 7}`, nickname: i % 3 ? null : 'Ladder', kind: 'flesh',
        xp: 1, morale: 0.6,
      })),
      ward: { tanks: ['CT-1007'] },
    };

    /**
     * THE POOL IS THE READING. `occupant` is what `StationLife` calls to build
     * every body in every room; a soldier it does not hand back is a soldier
     * no player will ever stand next to.
     */
    const uniforms = (placeId, hour) => {
      const p = PLACE.get(placeId);
      const heads = L.headcount(p, hour);
      const out = [];
      for (let i = 0; i < heads; i++) {
        const r = L.occupant(p, i, { hour, day: 0, heads, company });
        if (r && r.bar === placeId) out.push(r);
      }
      return { heads, out };
    };

    /* THE MORNING. Nobody in uniform, in any bar, at any hour before liberty
     * — and the rooms are NOT empty, which is what makes the clause mean
     * something. `libertyAt` is the curve underneath; it is asserted here by
     * its consequence rather than by being called. */
    let morningHeads = 0;
    for (const b of B.BARS) {
      for (const h of [3, 6, 9, 12, 15, 17]) {
        const r = uniforms(b.id, h);
        morningHeads += r.heads;
        assert(r.out.length === 0, `#${b.id} held ${r.out.length} soldiers at ${h}:00`);
      }
    }
    assert(morningHeads > 60,
      `the bars held ${morningHeads} people all morning — "empty of soldiers" has to mean something `
      + 'other than "empty", or this check passes on a shut station');

    /* THE EVENING. Every bar has soldiers in it, and some of them are yours. */
    let mine = 0, seats = 0;
    for (const b of B.BARS) {
      const r = uniforms(b.id, 22);
      assert(r.out.length > 0, `#${b.id} held no soldiers at 22:00, with ${r.heads} people in it`);
      assert(r.out.length <= r.heads, `#${b.id} held ${r.out.length} soldiers in a room of ${r.heads}`);
      seats += r.out.length;
      mine += r.out.filter((x) => x.leave).length;
    }
    assert(mine >= 3, `only ${mine} of ${seats} uniforms across the bars were men off the player's own roll`);

    /* NAMES OFF THE ROLL, and they are the roll's own. */
    const named = uniforms(14, 22).out.filter((r) => r.leave);
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
    const everyone = B.BARS.flatMap((b) => uniforms(b.id, 22).out)
      .filter((r) => r.leave).map((r) => r.leave.designation);
    assert(!everyone.includes('CT-1007'), 'a man in a bacta tank was in a bar');

    /* A DROID DOES NOT TAKE LEAVE — the same rule `Food.js` draws, drawn once. */
    const steel = { ...company, army: 'separatist', men: company.men.map((m) => ({ ...m, kind: 'steel' })) };
    const p14 = PLACE.get(14);
    const h22 = L.headcount(p14, 22);
    let steelSeats = 0;
    for (let i = 0; i < h22; i++) {
      const r = L.occupant(p14, i, { hour: 22, day: 0, heads: h22, company: steel });
      if (r?.leave) steelSeats++;
    }
    assert(steelSeats === 0, 'a separatist roll put its own men in a bar');

    /* AND WITH NO ROLL AT ALL THE STATION'S OWN GARRISON STANDS IN, because a
     * bar that emptied because you have not played the muster yet is a feature
     * punishing you for not having used another feature. */
    let alone = 0, aloneNamed = 0;
    for (let i = 0; i < h22; i++) {
      const r = L.occupant(p14, i, { hour: 22, day: 0, heads: h22 });
      if (r?.bar === 14) { alone++; if (r.leave) aloneNamed++; }
    }
    assert(alone > 0 && aloneNamed === 0,
      `with no company the cantina held ${alone} soldiers, ${aloneNamed} of them named`);

    /* …and a caller with no clock — `Pits.js` is one — gets the census it
     * always got, unchanged. */
    assert(!L.occupant(p14, 8).bar, 'occupant with no hour handed back a bar seat');

    /**
     * ── AND THE ROOM SAYS ITS LINE TO A PERSON ────────────────────────────
     *
     * `BARS[].line` — *"the band is loud enough that nobody has to talk"* —
     * was reachable only through `crowdOf`, which nothing called. The panel
     * that prints it is `main.js`'s `showBar`, raised by `Station.stationKey`
     * off `world.onBar`, and if that chain breaks the lines go back to being
     * three strings in a table.
     */
    const station = strip(await src('game/Station.js'));
    const main = strip(await src('main.js'));
    assert(/isBar\(place\.id\)\s*&&\s*world\.onBar/.test(station),
      'stationKey no longer raises a bar panel — the rooms are silent again');
    assert(/world\.onBar\s*=/.test(main) && /crowdOf\(/.test(main) && /row\?\.line/.test(main),
      'main.js no longer answers onBar with the crowd and the room’s own line');

    return `${B.BARS.length} bars, 0 uniforms across 24 morning readings of ${morningHeads} people, `
      + `${seats} at 22:00 of which ${mine} were named off a roll of ${company.men.length}; `
      + `every reading through StationLife.occupant, the pool that builds the body`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: leave is assigned by the player, and a man on it cannot be fielded', async () => {
    /**
     * *"you can assign troops to go on leave."*
     *
     * MEASURED BEFORE THIS LANE: there was no assignment control anywhere in
     * the game. Leave was `hashF(designation, day)` — the player could not
     * choose who went, could not see who was out, and nothing marked a man
     * unavailable while he was on it. `Bars.onLeave` and `Bars.takesLeave`
     * had no caller under `src/` at all.
     *
     * Everything below goes through the doors a person presses: `grantLeave`
     * is what `main.js`'s liberty board writes and `recallLeave` is its
     * Recall button, and the run's own resolver is asked whether it can still
     * see the man.
     */
    const B = await import('../../src/game/Bars.js');
    const Co = await import('../../src/game/Company.js');
    const Muster = await import('../../src/game/Muster.js');

    Co.clear('republic');
    const men = Array.from({ length: 12 }, (_, i) => ({
      type: 'clone', designation: `CT-${1000 + i * 7}`, kind: 'flesh',
      /* THREE SERGEANTS AND NINE TROOPERS — `Command.RANKS` puts the third
       * rung at 10 xp — because the velvet rope below is a rank. */
      xp: i < 3 ? 22 : 1, morale: 0.5, joined: 1,
    }));
    Co.save({ ...Co.blank('republic'), men });
    const fancy = B.BARS.find((b) => b.rope > 0);
    const open = B.BARS.find((b) => !b.rope);

    /* THE BOARD READS THE ROLL. One row per man, with the two numbers the
     * evening moves on it, and which of the rooms would have him. */
    const rows = B.leaveRows(Co.load('republic'));
    assert(rows.length === 12, `the liberty board shows ${rows.length} of 12 men`);
    assert(rows.filter((r) => r.may.includes(fancy.id)).length === 3,
      'the fancy room would take somebody it should not, or nobody it should');
    assert(rows.every((r) => r.may.includes(open.id)), 'a room with no rope turned somebody away');

    /* THE GRANT, AND THE THREE REFUSALS. Each of them is something a player
     * can act on, which is why they carry a reason and not a false. */
    const at = 100;
    assert(B.grantLeave('republic', 'CT-1000', fancy.id, at).granted.length === 1,
      'a sergeant was refused the room his rank admits him to');
    assert(B.grantLeave('republic', 'CT-1000', open.id, at).refused[0]?.why === 'already out',
      'a man with a pass was handed a second one');
    assert(B.grantLeave('republic', 'CT-1021', fancy.id, at).refused[0]?.why === 'not admitted',
      'a trooper walked into the fancy room');
    assert(B.grantLeave('republic', 'CT-1021', 999, at).refused[0]?.why === 'no such room',
      'a pass was written to a room that does not exist');

    /* AND THE BERTHS RUN OUT, WHICH IS WHAT MAKES IT A CHOICE. A third of the
     * roll, `Bars.LEAVE_SHARE`'s own share — the same size evening the hash
     * used to draw, so using the board never empties a bar. */
    const room = B.berths(Co.load('republic'));
    assert(room === 4, `a roll of 12 has ${room} berths; a third of it is 4`);
    const rest = men.slice(1).map((m) => m.designation);
    const spree = B.grantLeave('republic', rest, open.id, at);
    assert(spree.granted.length === room - 1,
      `the board sent ${spree.granted.length + 1} men out with ${room} berths`);
    assert(spree.refused.some((r) => r.why === 'no berth'), 'nobody was turned back for want of a berth');

    /**
     * ── HE IS GENUINELY UNAVAILABLE, THROUGH BOTH DOORS A RUN USES ───────
     *
     * `Company.fieldable` is the single choke point and `Muster.lineup` is
     * `main.js`'s `veteransToField`. A pick BY NAME is the second door and
     * the one that matters: `lineup` builds its pick map out of `fieldable`
     * too, so a saved slate naming a man on leave must not smuggle him back.
     */
    const out = new Set(Co.load('republic').men.filter((m) => m.leave).map((m) => m.designation));
    assert(out.size === room, `${out.size} men are out and the roll has ${room} berths`);
    const field = Co.fieldable(Co.load('republic')).map((m) => m.designation);
    assert(field.length === 12 - room, `fieldable offers ${field.length} of ${12 - room} men in barracks`);
    for (const name of out) assert(!field.includes(name), `${name} is on leave and still fieldable`);

    /* THE MUSTER FILLS THE GAP WITH RECRUITS, which is the right behaviour and
     * is why this counts NAMES rather than heads: a line of twelve is still a
     * line of twelve, and not one of the men in it is on leave. */
    const plan = { army: 'republic', want: 12, armyMode: true };
    const line = (Muster.lineup(plan, Co.load('republic')) || []).map((m) => m.designation);
    for (const name of out) assert(!line.includes(name), `${name} was fielded while he was on leave`);
    assert(line.filter((d) => field.includes(d)).length === 12 - room,
      `the muster took ${line.filter((d) => field.includes(d)).length} of the ${12 - room} veterans in barracks`);
    Muster.setPicks('republic', [...out]);
    const picked = (Muster.lineup(plan, Co.load('republic')) || []).map((m) => m.designation);
    for (const name of out) {
      assert(!picked.includes(name), `${name} was picked by name off a slate while he was on leave`);
    }
    Muster.clearPicks('republic');

    /* AND THE PASS CAN BE TORN UP. `Medbay.discharge`'s twin: he comes back in,
     * he keeps what he was credited, and the berth goes to somebody else. */
    const back = B.recallLeave('republic', [...out][0], at);
    assert(back.length === 1, 'Recall did not bring anybody in');
    assert(Co.fieldable(Co.load('republic')).some((m) => m.designation === back[0]),
      `${back[0]} was recalled and is still not fieldable`);
    assert(B.recallLeave('republic', null, at).length === room - 1, 'recalling everybody left somebody out');

    /* IT SURVIVES A RELOAD, through `Company`'s one door and no new key. */
    B.grantLeave('republic', 'CT-1000', fancy.id, at);
    const reread = Co.load('republic').men.find((m) => m.designation === 'CT-1000');
    assert(reread.leave?.bar === fancy.id && reread.leave.since === at,
      `the pass did not survive the fold: ${JSON.stringify(reread.leave)}`);
    const sess = strip(await src('game/Bars.js'));
    assert(!/localStorage/.test(sess), 'Bars.js has grown a durable key of its own');
    Co.clear('republic');

    return `12 men, ${room} berths; the rope on #${fancy.id} admits 3 of 12; `
      + 'fieldable and Muster.lineup both refuse a man with a pass, by default and by name';
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: an evening off actually moves a man’s nerve and mends him', async () => {
    /**
     * *"they will get increased morale and will heal over time."*
     *
     * MEASURED BEFORE THIS LANE: zero hits for `morale` in `Bars.js`,
     * `StationLife.js` and `Medbay.js`'s leave path. Nothing wrote anything. A
     * man came back from an evening in the cantina with exactly the nerve and
     * the wound he left with.
     *
     * DRIVEN THROUGH `stepLeave`, which is the shipped entry — `stepStation`
     * calls it once a frame beside `stepMedbay` — rather than through the
     * arithmetic underneath it. What is handed in is what the station hands
     * in: a world with a clock on it and a frame's `dt`.
     */
    const B = await import('../../src/game/Bars.js');
    const Co = await import('../../src/game/Company.js');
    const M = await import('../../src/game/Medbay.js');
    const S = await import('../../src/game/StationSave.js');

    /* THE CALL SITE FIRST, because a ledger nothing steps is a ledger that
     * only runs in this check — which is the exact defect this lane found. */
    const station = strip(await src('game/Station.js'));
    assert(/stepLeave\(world,\s*dt\)/.test(station),
      'stepStation no longer steps the leave ledger — nothing rests unless a check says so');

    S.clearStation();
    S.setStationHour(18);
    Co.clear('republic');
    /* NINE MEN, so `berths` is three and the two passes below both fit. A roll
     * of three has ONE berth and the second grant would be refused — which is
     * the ceiling working, and would have looked here like a ledger that
     * credited nothing. */
    const men = Array.from({ length: 9 }, (_, i) => ({
      type: 'clone', designation: `CT-${1000 + i * 7}`, kind: 'flesh',
      xp: i === 0 ? 22 : 1, morale: 0.50, hp: 0.40, joined: 1,
    }));
    Co.save({ ...Co.blank('republic'), men });
    const fancy = B.BARS.find((b) => b.rope > 0);
    const grimy = B.BARS.filter((b) => !b.rope).reduce((a, b) => (b.ease < a.ease ? b : a));

    const day0 = S.stationDay();
    B.grantLeave('republic', 'CT-1000', fancy.id, day0 * 24 + 18);
    B.grantLeave('republic', 'CT-1007', grimy.id, day0 * 24 + 18);

    const read = (name) => {
      const m = Co.load('republic').men.find((x) => x.designation === name);
      return { morale: m.morale, hp: M.hpOf(m) };
    };
    const was = { sgt: read('CT-1000'), trp: read('CT-1007'), home: read('CT-1014') };
    assert(Co.load('republic').men.filter((m) => m.leave).length === 2,
      'both passes did not take — the fixture has fewer berths than it grants');
    assert(was.sgt.morale === 0.5 && was.sgt.hp === 0.4, 'the fixture did not take');

    /**
     * EIGHT STATION HOURS, the whole of `Bars.LIBERTY`'s window, at the
     * station's own rate — one hour per two real minutes. The world is the
     * shape `stepStation` hands `stepLeave`: a clock and nothing else.
     */
    const world = { _station: { hour: 18 } };
    /**
     * THE CLOCK IS WOUND THE WAY `tickStationClock` WINDS IT, and the first cut
     * of this check did not: it called `setStationHour` with the raw hour every
     * frame, so at midnight the store folded a day AND the world's hour reset,
     * and `stepLeave`'s `day * 24 + hour` jumped twenty-four hours in one
     * settle. Both men went straight to the ceiling and the check read the two
     * ends of the station as equally good. The game's own rule is that the
     * UNWRAPPED hour goes into the fold and the wrapped remainder comes back.
     */
    const wind = (secs) => {
      for (let i = 0; i < 60 * secs; i++) {
        world._station.hour += (1 / 60) / 120;
        if (world._station.hour >= 24) world._station.hour = S.setStationHour(world._station.hour);
        B.stepLeave(world, 1 / 60);
      }
    };
    wind(120 * 8);
    const now = { sgt: read('CT-1000'), trp: read('CT-1007'), home: read('CT-1014') };

    /* THE NERVE MOVED, AND IT MOVED BY THE ROOM. */
    assert(now.sgt.morale > was.sgt.morale + 0.2,
      `eight hours at the fancy end moved a man's nerve ${(now.sgt.morale - was.sgt.morale).toFixed(3)}`);
    assert(now.trp.morale > was.trp.morale + 0.05,
      `eight hours at the grimy end moved nothing: ${(now.trp.morale - was.trp.morale).toFixed(3)}`);
    assert(now.sgt.morale - was.sgt.morale > (now.trp.morale - was.trp.morale) * 2,
      'the two ends of the station are worth the same, which is not a contrast');
    assert(now.home.morale === was.home.morale,
      'a man who never left the barracks was credited an evening out');

    /* AND SO DID THE WOUND. Never past `Medbay.FIT`, which is where a patient
     * stops being one, and the field is DROPPED there rather than pinned —
     * `Company.readMan` reads an absent `hp` as a whole man. */
    assert(now.sgt.hp > was.sgt.hp, 'eight hours in the best room on the station mended nothing');
    assert(now.trp.hp > was.trp.hp, 'eight hours anywhere mended nothing');
    assert(now.sgt.hp - was.sgt.hp > (now.trp.hp - was.trp.hp) * 1.5,
      'the fancy room mends no better than the grimy one');
    assert(now.home.hp === was.home.hp, 'a man in the barracks was mended by a bar he never entered');
    assert(now.sgt.hp <= 1 && now.trp.hp <= 1, 'a man came out of a bar with more health than he has');

    /* THE CAP IS THE FIELD'S OWN. `MORALE.PRESENCE_CAP` is where standing
     * beside your commander under fire tops a man out; a night off may steady
     * him that far and no further, or a bar is stronger than a battle. */
    const { MORALE } = await import('../../src/game/Morale.js');
    wind(120 * 40);
    const long = read('CT-1000');
    assert(long.morale <= MORALE.PRESENCE_CAP + 1e-9,
      `two days in a bar carried a man to ${long.morale.toFixed(3)} against a cap of ${MORALE.PRESENCE_CAP}`);
    assert(long.hp === 1, 'forty-eight hours of rest never took the wound off the record');

    Co.clear('republic');
    S.clearStation();
    return `8 h at #${fancy.id}: nerve ${was.sgt.morale.toFixed(2)}→${now.sgt.morale.toFixed(3)}, `
      + `health ${was.sgt.hp.toFixed(2)}→${now.sgt.hp.toFixed(3)}; at #${grimy.id}: `
      + `${was.trp.morale.toFixed(2)}→${now.trp.morale.toFixed(3)} / ${now.trp.hp.toFixed(3)}; `
      + `the man who stayed in: ${now.home.morale.toFixed(2)} / ${now.home.hp.toFixed(2)}`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('food: every function Bars.js exports is called by something else in src/', async () => {
    /**
     * ══ THE SHAPE OF DEFECT THIS EXISTS FOR ══════════════════════════════
     *
     * The V16 audit counted EIGHT exports of `Bars.js` with no caller anywhere
     * under `src/` — `onLeave`, `takesLeave`, `ownHeads`, `crowdOf`, `isBar`,
     * `barPlaces`, plus two constants — while this very file called two of
     * them directly. Every one was green. `_shipped.mjs` walks the module
     * graph and would not have found it either: `StationLife.js` imports
     * `barman`, so the FILE was in the build and eleven-twelfths of it was
     * not.
     *
     * DERIVED AND NOT LISTED. The names come off the source, so a function
     * added tomorrow is in this check tomorrow without anybody remembering to
     * add it — a hard-coded list is a list that goes stale in the direction
     * that hides the defect.
     *
     * A CALLER IN ANOTHER FILE, which is the whole point: `onLeave` used to be
     * called by `ownHeads` and `crowdOf`, both inside `Bars.js`, and all three
     * were dead together. A file that only calls itself is a file nothing
     * calls.
     */
    const { readdir } = await import('node:fs/promises');
    const code = strip(await src('game/Bars.js'));
    const exported = [...code.matchAll(/^export function ([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]);
    assert(exported.length >= 8,
      `only ${exported.length} exported functions found in Bars.js — the scan has stopped scanning`);

    /* Every .js under src/, except the file itself. */
    const root = new URL('../../src/', import.meta.url);
    const files = [];
    const walk = async (dir) => {
      for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(`${dir}${e.name}/`);
        else if (e.name.endsWith('.js') && `${dir}${e.name}` !== 'game/Bars.js') files.push(`${dir}${e.name}`);
      }
    };
    await walk('');
    const bodies = new Map();
    for (const f of files) bodies.set(f, strip(await readFile(new URL(f, root), 'utf8')));

    const orphans = [];
    const where = [];
    for (const name of exported) {
      /* A CALL AND NOT A MENTION. `\bname(` — an import line names it without
       * calling it, and a file that imports a function and never runs it is
       * the same silence in a longer form. */
      const call = new RegExp(`\\b${name}\\s*\\(`);
      const hit = [...bodies.entries()].filter(([, b]) => call.test(b)).map(([f]) => f);
      if (!hit.length) orphans.push(name);
      else where.push(`${name}→${hit[0].replace(/^game\//, '')}`);
    }
    assert(orphans.length === 0,
      `${orphans.length} of Bars.js's ${exported.length} exported functions have no caller anywhere else `
      + `under src/: ${orphans.join(', ')} — a room nobody can reach is not built`);

    return `${exported.length} exports, every one called from another file: ${where.join(', ')}`;
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
