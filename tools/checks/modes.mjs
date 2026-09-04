/**
 * BATTLEFRONT BORZ — THE EIGHT MODES, END TO END, AND THE THREE THINGS THAT
 * GO WRONG BETWEEN A MODE AND THE REST OF THE GAME.
 *
 * Every mode in this game is assembled out of parts that belong to somebody
 * else — the composer, the muster, the record, the supply line — and every
 * defect this file was written for is a JOINT rather than a part. All three
 * were live when it was written and all three were invisible to the ~1830
 * checks around it, because every one of the parts was correct on its own.
 *
 *   A PICK THAT IS CLAMPED AND NEVER OFFERED. `Waves.skirmishConfig` normalises
 *     five fields and the Deploy panel had four controls, so `sk.waves` took
 *     its default on every battle ever fought and the mode's whole LENGTH —
 *     engagements × waves — was one slider with the other factor nailed down.
 *     `skirmish.mjs` asks that every number the panel OFFERS is a number the
 *     plan keeps, which cannot see a number the panel does not offer. This asks
 *     the question from the other end, off `skirmishConfig`'s own answer, so a
 *     sixth pick lights itself the day it is added.
 *
 *   A FIELD THE RECORD READS AND NOTHING PASSES. `Progress.recordRun` has read
 *     `summary.woken` since it was written — it is `p.communed`, "facets woken
 *     by communion, all-time", and `recent[].facets` — and no caller in `src/`
 *     ever set it, so both were structurally 0 for every player who has ever
 *     run this game. This is `seed` and `won` and `bestTier` again, which is
 *     three instances of one shape in one file, so it is asked here by DRIVING
 *     a purchase through the shipped Communion and the shipped `record()`
 *     rather than by reading either.
 *
 *   A COUNT A MODE'S CARD SAYS OUT LOUD. `claims.mjs` holds the training card's
 *     "ten lessons" and the duel's rung cadence; nothing held Command's "five
 *     areas", which sits in `fixedTheatre` rather than in `blurb` and is the
 *     one number on that card a player can check against the game.
 *
 * Every module is reached by `await import` inside a check body — a static edge
 * from a check to Engine.js burns its once-only ShaderChunk flags against the
 * wrong copy of three (HANDOFF §2.1).
 */

const KEY = 'saber.progress.v1';

/** Run `fn` against an empty store and put the player's own back afterwards. */
async function withCleanStore(fn) {
  const had = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
  try { return await fn(); }
  finally { if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had); }
}

const read = async (rel) => (await import('node:fs/promises'))
  .readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Words as far as any card in this game counts. */
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12 };

export function run({ check, assert }) {
  check('modes: every pick a battle is clamped for is a pick the player can make', async () => {
    /**
     * DERIVED FROM `skirmishConfig` ITSELF, in both directions.
     *
     * The function is the authority on what a battle's plan consists of: it
     * takes free-form picks and answers with the normalised set, so the KEYS of
     * its answer are the mode's dials. Every one of them has to be reachable —
     * a default in `DEFAULT_SETTINGS`, a control in index.html, a declared
     * reader, and a line in the `beginSkirmish` call `main.js` makes — or it is
     * a constant wearing a clamp, which is what `waves` was: `SKIRMISH.waves`
     * says in its own note that it is "a pick rather than a constant so a
     * player who wants a long grind on one map can have one", and no player
     * could.
     *
     * `rotate` is a checkbox and the rest are ranges, so the control test is
     * for the id and not for its type. The ids are `opt-sk-<pick>` by
     * convention and the convention is asserted here, because a pick whose
     * control is named something else is a pick this check cannot find.
     */
    const { skirmishConfig, SKIRMISH } = await import('../../src/game/Waves.js');
    const { DEFAULT_SETTINGS, SETTING_READERS } = await import('../../src/ui/Menu.js');
    const html = await read('index.play.html');
    const main = await read('src/main.js');

    const picks = Object.keys(skirmishConfig(null));
    assert(picks.length >= 5,
      `skirmishConfig answers with ${picks.length} picks — this check describes a plan that has changed shape`);

    /* The one call in the game that turns the preferences into a plan. */
    const call = /world\.beginSkirmish\(\{([\s\S]*?)\}\);/.exec(main);
    assert(call, 'src/main.js no longer builds a skirmish plan with an object literal — the lift is wrong');

    const rows = [];
    for (const pick of picks) {
      const key = 'skirmish' + pick[0].toUpperCase() + pick.slice(1);
      assert(key in DEFAULT_SETTINGS,
        `skirmishConfig clamps '${pick}' and DEFAULT_SETTINGS has no '${key}' — the pick has no default, `
        + 'so it is a constant the clamp is hiding');
      assert(SETTING_READERS[key],
        `'${key}' has no declared reader — tools/checks/controls.mjs cannot see a setting nobody declares`);
      const id = `opt-sk-${pick.toLowerCase()}`;
      assert(html.includes(`id="${id}"`),
        `there is no control '${id}' in index.html, so '${pick}' cannot be chosen — it takes `
        + 'its default on every battle ever fought');
      assert(new RegExp(`${pick}:\\s*settings\\.${key}`).test(call[1]),
        `main.js's beginSkirmish plan does not pass '${pick}' — the control writes a setting nothing reads`);
      rows.push(pick);
    }

    /* …AND THE TWO THAT DECIDE HOW LONG THE MODE IS ARE BOTH REAL RANGES.
     * A dial whose travel is one position is the same defect with a control in
     * front of it. */
    for (const [pick, band] of [['engagements', SKIRMISH.engagements], ['waves', SKIRMISH.waves]]) {
      assert(band.max > band.min,
        `SKIRMISH.${pick} offers one position (${band.min}..${band.max}) — the length of the mode is fixed`);
      const m = new RegExp(`id="opt-sk-${pick}"[^>]*min="(\\d+)"[^>]*max="(\\d+)"`).exec(html);
      assert(m, `the '${pick}' control declares no travel`);
    }
    /**
     * …AND EVERY POSITION OF EVERY NUMERIC PICK IS HONOURED.
     *
     * `skirmish.mjs` walks three controls through `_planSkirmish` and its list
     * of three is typed out beside the panel — so the fourth numeric pick was
     * invisible to it in exactly the way it was invisible to the panel. This
     * walks whatever bands `SKIRMISH` declares, through `skirmishConfig`, which
     * is where the clamp lives; a fifth band is walked on the day it is added.
     *
     * The edges are pushed as well, for the reason that check gives: a range
     * that merely MATCHES the table proves nothing, because the two could be
     * wrong together. One step outside has to come back clamped to the bound.
     */
    for (const [pick, band] of Object.entries(SKIRMISH)) {
      if (typeof band?.min !== 'number' || typeof band?.max !== 'number') continue;
      for (let v = band.min; v <= band.max; v++) {
        assert(skirmishConfig({ [pick]: v })[pick] === v,
          `the panel offers ${pick} ${v} and the plan comes back `
          + `${skirmishConfig({ [pick]: v })[pick]} — that position of the control is a number `
          + 'no battle will ever be fought at');
      }
      assert(skirmishConfig({ [pick]: band.min - 1 })[pick] === band.min,
        `${pick} ${band.min - 1} planned as ${skirmishConfig({ [pick]: band.min - 1 })[pick]}`);
      assert(skirmishConfig({ [pick]: band.max + 1 })[pick] === band.max,
        `${pick} ${band.max + 1} planned as ${skirmishConfig({ [pick]: band.max + 1 })[pick]}`);
    }

    const longest = SKIRMISH.engagements.max * SKIRMISH.waves.max;
    const shipped = SKIRMISH.engagements.def * SKIRMISH.waves.def;
    assert(longest > shipped * 4,
      `the longest battle the panel can ask for is ${longest} waves against a shipped ${shipped} — `
      + 'the two dials are not buying the player a different evening');
    return `${rows.length} picks, all defaulted, offered, declared and passed: ${rows.join(', ')}; `
      + `battle is ${shipped}..${longest} waves`;
  });

  check('modes: the record is handed every field it reads, the woken facets included', async () => {
    /**
     * DRIVEN, THROUGH THE SHIPPED PURCHASE AND THE SHIPPED `record()`.
     *
     * `recordRun` is correct and was correct: it reads `summary.woken`, adds
     * its length to `p.communed` and stores it on the run's entry as `facets`.
     * Nothing in `src/` ever passed it — `World.runStats()` does not report it
     * and `main.js`'s `record()` did not add it — so the defect is only visible
     * from the CALL SITE, which is exactly why the two checks in progress.mjs
     * that exercise `recordRun` directly could both be green while the field
     * was dead. Same reason those checks drive `won`.
     *
     * The facet is bought the way the meditation buys one — `Communion.buy`
     * decides and charges, `World.applyBoon` applies — rather than by pushing
     * an id onto `bought`, so a purchase that stopped going through the ledger
     * would fail here too.
     *
     * `record()` is LIFTED out of main.js rather than paraphrased, the way
     * history.mjs and progress.mjs lift it: main.js cannot be imported under
     * Node, and a paraphrase of the function under test is a check that agrees
     * with itself (HANDOFF §2.4).
     */
    const src = await read('src/main.js');
    const i = src.indexOf('\nfunction record(stats = null) {');
    assert(i > 0, 'main.js no longer declares `function record(stats = null)`');
    const end = src.indexOf('\n}\n', i);
    assert(end > i, 'the body of record() could not be delimited');
    const body = src.slice(i + 1, end + 2);

    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({
      level: 'colosseum', runSeed: 4242,
      settings: { mode: 'waves', level: 'colosseum', order: 'jedi', quality: 'low' },
    });
    /* THE TRIAL OF WAVES, because it is the mode whose whole progression this
     * field is about: it drafts nothing, so every card in the run's holding
     * that is not the order's grant was woken in the Holocron. */
    const ledger = world.communion;
    ledger.insight = 400;
    /* THE WAVE THE PURCHASE IS MADE AT, and it must be a real one: a facet
     * inherits its card's `minWave`, so asking at `director.wave` on a world
     * nobody has started is asking at wave 0 and every facet in the lattice
     * answers LOCKED.depth. `start(1)` is what a deployment does. */
    world.director.start(1);
    const wave = world.director.wave;
    assert(wave >= 1, `the director reports wave ${wave} after start(1)`);
    const { FACETS } = await import('../../src/game/LivingForce.js');
    let bought = 0;
    const why = [];
    for (const f of FACETS) {
      if (bought >= 2) break;
      const boon = ledger.buy(f.id, world.takenBoons, wave);
      if (!boon) { why.push(`${f.id}:${ledger.reasonLocked(f.id, world.takenBoons, wave)}`); continue; }
      world.applyBoon(boon);
      bought++;
    }
    assert(bought === 2,
      `only ${bought} facets could be woken with a full purse at wave ${wave} — the ledger, not the `
      + `record, is the problem (${why.slice(0, 4).join(', ')})`);
    assert(ledger.bought.length === 2, 'Communion.buy did not write the purchase to its own list');

    const { recordRun, loadProgress } = await import('../../src/game/Progress.js');
    const store = await withCleanStore(() => {
      let handed = null;
      /* `record` closes over `foldCompanion` as well now — the companion's
       * durable fold, which it calls BEFORE filing the run because the fold
       * reads the outcome that filing is what writes. This lift compiles the
       * body verbatim, so the name has to be supplied or the whole check dies
       * on a ReferenceError; a no-op is right HERE because this check is about
       * the woken facets the record is handed, and `history.mjs` is where the
       * fold's own ordering is asserted. */
      // eslint-disable-next-line no-new-func
      const make = new Function('scope', 'recordRun', 'sessionOr', 'settings', 'foldCompanion', 'emptyLarder',
        'payForRun', 'clearTuning',
        `const world = scope.world;\n${body}\nreturn record;`);
      const rec = make({ world }, (s) => { handed = s; return recordRun(s); },
        () => 'waves', { order: 'jedi', species: 'human' }, () => {}, () => {}, () => {}, () => {});
      rec({ wave: 12, score: 9000, kills: 40, won: false });
      assert(handed, 'the lifted record() never called recordRun');
      assert(Array.isArray(handed.woken),
        'main.js hands the store no `woken` — `p.communed` and `recent[].facets` are pinned at 0 '
        + 'for every player, which is what they were');
      assert(handed.woken.length === 2,
        `the record was handed ${handed.woken.length} woken facets after two purchases`);
      return loadProgress();
    });
    assert(store.communed === 2,
      `the store counts ${store.communed} facets woken in communion after a run that woke two`);
    assert(store.recent[0].facets === 2,
      `the run's own entry says ${store.recent[0].facets} facets`);

    /* …AND `recent[].facets` HAS A READER. Storage nothing displays is a
     * write-only log, which is the thing Progress.js's header refuses to be —
     * and this field had no reader anywhere in the tree on the day it was
     * given a value. */
    const { progressLines } = await import('../../src/game/Progress.js');
    const lines = progressLines(store).join('\n');
    assert(/2 woken/.test(lines),
      `nothing prints the run's woken facets: "${lines.split('\n').pop()}"`);
    assert(/woken in communion/.test(lines),
      'the all-time communion count is not on the record line');
    world.unload();
    return `two facets bought through the ledger → handed 2, store communed 2, entry facets 2, both printed`;
  });

  check('modes: every mode whose run TAKES something has a word for what it took', async () => {
    /**
     * `World._taken()` answers "how much of the run is behind you" with ONE
     * number and four meanings, and `main.js`'s `TAKEN` map is the five labels
     * that name it — "Missions taken", "Engagements won", "Areas taken",
     * "Ground taken", "Forms faced". A hand-written map of mode names beside
     * the method that decides them is HANDOFF §2.3's shape, and it is wearing
     * §2.3's close relative on top: the reader is `TAKEN[mode] ?? 'Ground
     * taken'`, so a ninth mode does not get a missing label, it gets a plausible
     * wrong one. That is exactly how `stats.areas ?? 5` printed "Areas taken 5"
     * on every won run in the game for the life of the death card.
     *
     * WHICH MODES OWE A LABEL IS DERIVED, off the same three fields `_taken`
     * branches on: `battles` (a campaign or a skirmish), `crossing` (Command or
     * The Line) and `ladder` (the duel). A mode that takes nothing owes nothing
     * and is not asked.
     */
    const { MODES } = await import('../../src/game/Waves.js');
    const src = await read('src/main.js');
    const m = /const TAKEN = \{([\s\S]*?)\};/.exec(src);
    assert(m, 'src/main.js no longer declares the TAKEN label map — this check describes a file that is gone');
    const labelled = new Set([...m[1].matchAll(/(\w+):\s*'/g)].map((x) => x[1]));
    const owes = Object.entries(MODES)
      .filter(([, M]) => M.battles || M.crossing || M.ladder)
      .map(([k]) => k);
    assert(owes.length >= 5, `${owes.length} modes take something — the fields this is derived from have moved`);
    for (const k of owes) {
      assert(labelled.has(k),
        `${MODES[k].name} reports a count off World._taken() and main.js has no label for it, so the `
        + `card falls through to the default and prints somebody else's noun`);
    }
    /* …AND NOTHING ELSE IS IN THE MAP. A label for a mode that takes nothing is
     * a row that can never be printed, which is the write-only half of the same
     * defect. */
    for (const k of labelled) {
      assert(owes.includes(k),
        `main.js labels '${k}' in TAKEN and that mode takes nothing — the row is unreachable`);
    }
    return `${owes.length} modes take something, all named: ${owes.join(', ')}`;
  });

  check('modes: a count a mode\'s card states out loud is a count the code holds', async () => {
    /**
     * `claims.mjs` holds the training card's "ten lessons" and the duel card's
     * rung cadence. Command's card carries a number too — "five areas, one
     * crossing" — and it lives in `fixedTheatre` rather than in `blurb`, which
     * is why the sweep that found the others walked past it. A mode's CARD is
     * every string the menu prints off the mode, so that is what is read.
     *
     * Held over `MODES` rather than over a list typed here: a ninth mode whose
     * card names a count of areas is caught on the day it is written, and a
     * mode that names none is not required to.
     */
    const { MODES } = await import('../../src/game/Waves.js');
    const { AREAS } = await import('../../src/game/Command.js');
    const { CAMPAIGNS } = await import('../../src/game/Levels.js');
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const num = (w) => WORDS[String(w).toLowerCase()] ?? (/^\d+$/.test(w) ? +w : null);

    const said = [];
    for (const [key, M] of Object.entries(MODES)) {
      const card = [M.blurb, M.fixedTheatre, M.fixedRules, M.theatreVeto].filter(Boolean).join(' ');
      for (const m of card.matchAll(/(\w+)\s+areas\b/gi)) {
        const n = num(m[1]);
        if (n == null) continue;
        assert(n === AREAS.length,
          `the ${M.name} card says "${m[0]}" and AREAS holds ${AREAS.length}`);
        said.push(`${key}: ${m[0]}`);
      }
      for (const m of card.matchAll(/(\w+)\s+grounds\b/gi)) {
        const n = num(m[1]);
        if (n == null) continue;
        assert(n === LEVEL_ORDER.length,
          `the ${M.name} card says "${m[0]}" and LEVEL_ORDER holds ${LEVEL_ORDER.length}`);
        said.push(`${key}: ${m[0]}`);
      }
    }
    assert(said.length > 0,
      'no mode card states a count any more — this check has lost its subject and should be deleted, '
      + 'not quietly passed');

    /* AND THE CAMPAIGN'S CARD PROMISES A BRIEF ON EACH GROUND, which is a claim
     * about the table rather than about a number: a mission with no brief is a
     * ground the mode's own card says will explain itself and does not. */
    if (/brief on each/i.test(MODES.campaign.blurb)) {
      for (const id of Object.keys(CAMPAIGNS)) {
        for (const m of CAMPAIGNS[id].missions) {
          assert(m.brief && m.brief.length > 20,
            `the ${CAMPAIGNS[id].name} mission on ${m.level} has no brief, and the mode card promises one on each`);
        }
      }
      said.push(`campaign: a brief on every mission of ${Object.keys(CAMPAIGNS).length} campaign(s)`);
    }
    return said.join('; ');
  });
}
