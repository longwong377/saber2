/**
 * THE AFTER-ACTION REPORT — PLAN.md §4.9, and the half of it that was never
 * drawn.
 *
 * "The after-action report — who killed whom, from what direction, at what
 * minute. No death is mysterious, so no death is the AI's fault."
 *
 * The RECORD was finished long before the screen: `CommandDirector._deathOf`
 * writes a killer, a bearing and a minute onto every `fell` entry, `fellLine`
 * renders one man, the interlude says one engagement and the death card says
 * the names. What nothing said was the RUN — and the thing a run says that no
 * single engagement can is WHAT HAS BEEN KILLING YOUR MEN.
 *
 * ── WHAT THESE CHECKS ARE FOR, AND IT IS NOT "THE SCREEN EXISTS" ────────
 *
 * §7: an element earns its place by changing a decision, and its check has to
 * demonstrate the decision changing. A casualty list does not change one; it is
 * owed to the player and it is already paid twice over. So the checks below are
 * about the CENSUS, and every one of them is written so that it goes red on a
 * report that draws the same list without counting it:
 *
 *   · two runs with the SAME number of dead and different killers have to read
 *     differently at the top, or the head of the screen is decoration;
 *   · a death your own side caused has to be separable from a death a droid
 *     caused, because that is the sentence §4.9's "no death is the AI's fault"
 *     is actually about;
 *   · a man who kills his own mate has to count as YOUR side even though his
 *     name is not "you" and not the fire mission's;
 *   · and the whole thing has to be a projection of the director's own log, so
 *     that no screen in this game can say a man died in a way the ledger does
 *     not record.
 *
 * The log fixtures below are hand-written rather than driven out of a world on
 * purpose: what is being asserted is a PROJECTION, its inputs are eight fields
 * on a plain object, and a fixture is the only way to put two runs side by side
 * that differ in exactly one of them. The one check that does drive the
 * director is the last, and it is there so the fixtures cannot drift away from
 * the shape the game actually writes.
 */
import { readFile } from 'node:fs/promises';
import { runReport, fellLine } from '../../src/game/Session.js';
import { killerName } from '../../src/game/Command.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/** Every .js under src/, so "does anybody still do this" is a whole-tree question. */
async function srcFiles(dir = 'src', out = []) {
  const { readdir } = await import('node:fs/promises');
  for (const e of await readdir(new URL('../../' + dir, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) await srcFiles(`${dir}/${e.name}`, out);
    else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
  }
  return out;
}

/** One `fell` entry, in the shape `_deathOf` writes. */
const fell = (name, killer, at, area = 1, extra = {}) => ({
  t: 'fell', name, unit: 'A Company', rank: 'CT', area, wave: 1,
  xp: 0, kills: 0, killer, bearing: 90, at, ...extra,
});
const area = (n, name, strength, fallen) => ({ t: 'area', area: n, name, strength, fallen });

export async function run({ check, assert }) {

  check('report: two runs that lost the same men to different things read differently', () => {
    /**
     * THE WHOLE CLAIM, AND THE ONLY ONE THAT MATTERS. A screen that says "you
     * lost four men" over a run that lost them to armour and over a run that
     * lost them to its own artillery has told the player nothing he can act on
     * — and "four" is what every other surface in this game already says.
     *
     * The two logs below differ in ONE field per entry, so a projection that
     * merely counted, sorted or listed would return the same head for both and
     * this check would be red.
     */
    const droids = runReport([fell('CT-1', 'B2 Super Battle Droid', 60),
                              fell('CT-2', 'B2 Super Battle Droid', 70),
                              fell('CT-3', 'B2 Super Battle Droid', 80),
                              fell('CT-4', 'B1 Battle Droid', 90), area(1, 'The Foundry', 6, 4)]);
    const ownGuns = runReport([fell('CT-1', 'your own fire mission', 60),
                               fell('CT-2', 'your own fire mission', 70),
                               fell('CT-3', 'your own fire mission', 80),
                               fell('CT-4', 'B1 Battle Droid', 90), area(1, 'The Foundry', 6, 4)]);

    assert(droids.lost === ownGuns.lost && droids.lost === 4,
      `${droids.lost} and ${ownGuns.lost} — the two runs must lose the same number or nothing is isolated`);
    assert(droids.census[0].killer === 'B2 Super Battle Droid' && droids.census[0].n === 3,
      `the armour run reads "${droids.census[0]?.killer} ${droids.census[0]?.n}"`);
    assert(ownGuns.census[0].killer === 'your own fire mission' && ownGuns.census[0].n === 3,
      `the artillery run reads "${ownGuns.census[0]?.killer} ${ownGuns.census[0]?.n}"`);
    assert(droids.own === 0 && ownGuns.own === 3,
      `your own side killed ${droids.own} and ${ownGuns.own} — the split is what the player acts on`);
    return `same 4 dead: "3 to ${droids.census[0].killer}" against "3 to ${ownGuns.census[0].killer}", `
      + `own side ${droids.own} against ${ownGuns.own}`;
  });

  check('report: the man who shot his own mate counts as your side, and is not on a name list', () => {
    /**
     * `killerName` returns a TROOPER'S OWN DESIGNATION for a man killed by one
     * of yours — not "you" and not the fire mission's constant — so the two
     * constants alone would file a friendly-fire death among the droids, which
     * is exactly the death §4.9's sentence is sharpest about.
     *
     * RECOGNISED BY BEING ON THIS RUN'S ROLL, and the check is written to fail
     * a name pattern: `CT-9` is one of yours and `CT-9` is ALSO what a
     * name-shaped rule would call the Separatist below, which is deliberately
     * given a designation of the same form. Only the log knows the difference.
     *
     * AND THE ROLL IS READ IN FULL BEFORE ANY AREA IS: CT-9 is not enlisted
     * until area two's muster, and the man he kills falls in area one. A single
     * forward pass would call his killer a droid.
     */
    const log = [
      fell('CT-1', 'CT-9', 60, 1),
      fell('CT-2', 'CT-77', 62, 1),          // not on the roll — an enemy trooper
      area(1, 'The Foundry', 8, 2),
      { t: 'enlist', name: 'CT-9', unit: 'A Company', area: 2 },
      area(2, 'The Ridge', 8, 2),
    ];
    const r = runReport(log);
    const ours = r.census.find((c) => c.killer === 'CT-9');
    const theirs = r.census.find((c) => c.killer === 'CT-77');
    assert(ours?.own === true, 'a man on your own roll is not counted as your side');
    assert(theirs?.own === false,
      'a name that is merely SHAPED like one of yours is counted as yours — the rule is a pattern, not the roll');
    assert(r.own === 1, `${r.own} attributed to your own side, and exactly one man was`);
    return 'CT-9 (enlisted in area 2, killed in area 1) is yours; CT-77 is not';
  });

  check('report: a death with nothing to name is said, and never invented', () => {
    /* The honest answer is the whole point: a report that guessed would be the
     * mystery §4.9 removes, wearing the costume of the thing that removes it. */
    const r = runReport([fell('CT-1', null, 60), fell('CT-2', 'B1 Battle Droid', 61),
                         area(1, 'The Foundry', 8, 2)]);
    assert(r.unknown === 1, `${r.unknown} unattributed, and one death had no source`);
    assert(r.census.length === 1 && r.census[0].killer === 'B1 Battle Droid',
      'the unattributed death invented a killer to sit under');
    assert(r.lost === 2, `${r.lost} on the list — the man is still counted, he is just not attributed`);
    assert(!fellLine(r.fell[0]).includes('by '),
      `"${fellLine(r.fell[0])}" names a killer for a death that had none`);
    return `2 lost, 1 attributed, 1 "${fellLine(r.fell[0])}"`;
  });

  check('report: the census is stable, so the same run reads the same way twice', () => {
    /* A table that reshuffles between two openings of the same card is a table
     * the player stops trusting. Ties are broken on the name and not on
     * insertion order, so the ordering is a property of the RUN. */
    const rows = [fell('CT-1', 'droideka', 60), fell('CT-2', 'B1 Battle Droid', 61),
                  fell('CT-3', 'B1 Battle Droid', 62), fell('CT-4', 'droideka', 63),
                  area(1, 'The Foundry', 6, 4)];
    const a = runReport(rows).census.map((c) => `${c.killer}:${c.n}`).join(',');
    const b = runReport([rows[1], rows[0], rows[3], rows[2], rows[4]]).census
      .map((c) => `${c.killer}:${c.n}`).join(',');
    assert(a === b, `"${a}" against "${b}" — the same two-two run sorts two ways`);
    assert(a === 'B1 Battle Droid:2,droideka:2', `the tie broke as "${a}"`);
    return a;
  });

  check('report: the run is areas, and the engagement being fought is not a lost one', () => {
    /**
     * THREE STATES AND NOT TWO. The pause card is opened DURING an area far
     * more often than between them, and an open engagement drawn as `held:
     * false` would tell a player he had lost ground he is still standing on.
     */
    const r = runReport([
      fell('CT-1', 'B2 Super Battle Droid', 60, 1), area(1, 'The Foundry', 9, 1),
      fell('CT-2', 'B2 Super Battle Droid', 200, 2),
      { t: 'lost', area: 2, name: 'The Ridge', strength: 0, fallen: 2, why: 'the line was wiped out' },
      fell('CT-3', 'B1 Battle Droid', 300, 3),
    ]);
    assert(r.areas.length === 3, `${r.areas.length} areas off three engagements`);
    assert(r.areas[0].held === true && r.areas[1].held === false && r.areas[2].held === null,
      `held reads ${r.areas.map((a) => a.held).join('/')} — the open engagement is not a third state`);
    assert(r.areas[1].why === 'the line was wiped out', 'a lost area drops the reason it was lost');
    assert(r.held === 1, `${r.held} areas held`);
    assert(r.areas[0].fell.length === 1 && r.areas[2].fell.length === 1,
      'a man fell into the wrong engagement');
    assert(r.ended === null, `the run reads as "${r.ended}" while it is still being fought`);
    return 'held / lost / in progress, and the open one keeps its dead';
  });

  check('report: a fire mission lands in the engagement that called it, though it carries no area', () => {
    /**
     * `FireMission._log` writes what was in the mark and nothing about where
     * the run had got to — it is the ONE entry in the ledger with no `area`
     * field. So an implementation that grouped on that field would drop every
     * fire mission out of the report, which is precisely the entry §4.9 is
     * sharpest about, and this check is what makes the cut-on-terminators
     * reading a requirement instead of a preference.
     */
    const mission = { t: 'mission', grid: 'F42', lapsed: false, told: 4, verified: false,
                      hostiles: 4, friendlies: 1, names: ['CT-2'], at: 70 };
    const r = runReport([
      fell('CT-1', 'B1 Battle Droid', 60, 1), area(1, 'The Foundry', 9, 1),
      mission, fell('CT-2', 'your own fire mission', 71, 2), area(2, 'The Ridge', 8, 2),
    ]);
    assert(r.areas[1].missions.length === 1,
      `the fire mission landed in ${r.areas.findIndex((a) => a.missions.length)} — it carries no area number`);
    assert(!r.areas[0].missions.length, 'it landed in the engagement before the one that called it');
    assert(r.own === 1, 'the man it killed is not counted against your own side');
    return 'GRID F42 sits in area 2 with the man it killed';
  });

  check('report: an empty log reports an empty run rather than throwing', () => {
    for (const bad of [[], null, undefined, [{}, { t: null }]]) {
      const r = runReport(bad);
      assert(r && Array.isArray(r.areas) && Array.isArray(r.census),
        `runReport(${JSON.stringify(bad)}) did not report a run`);
      assert(r.lost === 0 && r.own === 0 && r.held === 0 && r.ended === null,
        'an empty run reports something happened in it');
    }
    return 'four empty inputs, four empty runs';
  });

  check('report: the killer is the name the game says out loud, not the key it files it under', async () => {
    /**
     * THE DEFECT THIS FOUND. `killerName` ended `source.A?.name || source.type`,
     * and an archetype has no `name` — the field is `label` — so the first half
     * was ALWAYS undefined and every death in every report the game has ever
     * drawn was attributed to `b2` and `droideka`. A report written in the
     * spawn table's internal keys reads as debug output, which is its own way
     * of being the mystery §4.9 exists to remove.
     */
    assert(ARCHETYPES.b2 && !('name' in ARCHETYPES.b2) && ARCHETYPES.b2.label,
      'an archetype has a `name` now — the fallback below is reading the wrong field');
    assert(killerName({ A: ARCHETYPES.b2, type: 'b2' }) === ARCHETYPES.b2.label,
      `a B2 is reported as "${killerName({ A: ARCHETYPES.b2, type: 'b2' })}"`);
    /* A body carrying only its key — the flight modes build their own — still
     * resolves, because the table is the same table. */
    assert(killerName({ type: 'droideka' }) === ARCHETYPES.droideka.label,
      `a bare key reports "${killerName({ type: 'droideka' })}"`);
    /* And a type with no archetype at all is said as itself rather than as
     * nothing: it is the only thing that can be said about that body. */
    assert(killerName({ type: 'gunship' }) === 'gunship', 'a body outside the table reports nothing at all');
    assert(killerName(null) === null && killerName({ isPlayer: true }) === 'you',
      'the two constants moved');

    /**
     * AND NOWHERE ELSE IN THE TREE EITHER. `killerName` was not the only one:
     * the Foundry's own banner read `ARCHETYPES[up]?.name || up` and told a
     * player who had just held a building that "the next one up is a arc". One
     * `.name` on this table is always this defect, because the field does not
     * exist — so the rule is asserted over `src/` rather than over the two
     * lines that happened to have it.
     */
    const bad = [];
    for (const f of await srcFiles()) {
      const text = (await read(f)).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      for (const m of text.matchAll(/ARCHETYPES\s*\[[^\]]+\]\s*\??\.?\s*\??\.\s*(\w+)/g)) {
        if (m[1] === 'name') bad.push(`${f}: ${m[0]}`);
      }
      for (const m of text.matchAll(/\bA\s*\?\.\s*(\w+)/g)) if (m[1] === 'name') bad.push(`${f}: ${m[0]}`);
    }
    assert(!bad.length,
      `an archetype has no \`name\` — the field is \`label\` — so these read undefined and fall through `
      + `to the spawn key: ${bad.join(', ')}`);
    return `A.label → "${ARCHETYPES.b2.label}", bare key → "${ARCHETYPES.droideka.label}", `
      + 'and no `.name` on that table anywhere in src/';
  });

  check('report: nothing in the tree renders the census twice', async () => {
    /**
     * TWO RENDERINGS OF ONE RECORD EVENTUALLY DISAGREE — it is the argument
     * `fellLine` is exported under, and the census is now said on two cards
     * (the pause panel and the death card). Both read `runReport`'s own output;
     * neither counts anything itself. A `filter(e => e.t === 'fell')` in the UI
     * layer is the shape this forbids, and `World.runStats` no longer has one
     * either — `roll` is a map over the report's own list.
     */
    const menu = await read('src/ui/Menu.js');
    const world = await read('src/game/World.js');
    for (const [name, text] of [['Menu.js', menu], ['World.js', world]]) {
      const strip = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      assert(!/t\s*===\s*'fell'/.test(strip),
        `${name} filters the log for the fallen itself — that is a second answer to who is on the list`);
    }
    assert(/runReport\(/.test(world), 'World.js no longer projects the log through runReport');
    assert(/report\?\.census/.test(menu), 'the death card no longer reads the census it is given');
    return 'one projection, two readers';
  });

  check('report: the pause card can open it, fold it away, and never keeps it open', async () => {
    /**
     * THE PANEL IS A DISCLOSURE AND NOT A SCREEN, and that is the reason it is
     * safe: src/ui/Screens.js exists because of an overlay a player could be
     * stranded in, and a report raised as its own state would need its own
     * hider, its own Escape rule and its own place in `resume`. As a box on the
     * pause card it needs none of them.
     *
     * Read rather than driven, because what is asserted is that the report
     * joins the SAME fold-away table the other two panels are in — a panel that
     * remembered being open is a panel that hides Resume behind a list you
     * opened once, twenty minutes ago, and that is a property of the table.
     */
    const html = await read('index.play.html');
    const menu = await read('src/ui/Menu.js');
    const screens = await read('src/ui/Screens.js');
    assert(/id="btn-pause-report"[\s\S]{0,200}aria-controls="pause-report-box"/.test(html),
      'the pause card has no button for the report, or it controls nothing');
    assert(/id="pause-report-box"[^>]*class="pause-binds hidden"/.test(html),
      'the report box does not start folded away');
    const fold = menu.match(/for \(const \[btn, panel\] of \[([\s\S]{0,220}?)\]\) \{/);
    assert(fold && /btn-pause-report/.test(fold[1]) && /btn-pause-bind/.test(fold[1])
      && /btn-pause-opts/.test(fold[1]),
      'the report is not in the table that folds the pause card\'s panels away between pauses');
    assert(/showPause\([\s\S]{0,120}?this\.io\.report\?\.\(\)/.test(screens),
      'Screens asks for the report at the moment of the pause, or does not ask at all');
    /* And the three toggles are ONE wiring: the third copy is what made it
     * worth extracting, and a fourth typed by hand is the drift this stops. */
    const wired = [...menu.matchAll(/_wirePauseToggle\('/g)].length;
    assert(wired >= 3, `${wired} uses of the shared toggle for three panels — one is wiring its own listener again`);
    /* AND THE PANEL YOU OPENED IS ON SCREEN. Measured in Chromium by
     * `tools/_reportshot.mjs`: the card is 1051 px with the report open in an
     * 800 px window and `#pause .pause-wrap` is a 92vh scroller, so a button at
     * the bottom of it opened a panel entirely below the fold and read as a
     * button that did nothing. Asserted as source because a DOM with no layout
     * engine cannot answer it and pretending otherwise would be the same lie in
     * a new place — the same split menu.mjs's own header describes. */
    assert(/scrollIntoView\?\.\(\{ block: 'nearest' \}\)/.test(menu),
      'an opened pause panel is no longer scrolled into view — on a 800 px window it opens below the fold');
    return 'button, box, one fold table, one toggle wiring';
  });

  check('report: the button says whether the panel is open, in both directions', async () => {
    /**
     * `aria-expanded` IS THE STATE, and it was written off an inverted reading:
     * `classList.toggle('hidden')` returns true when the class was ADDED — that
     * is, when the panel just went AWAY — and the old line called that value
     * `open`. It happened to set the right string, and the next person to read
     * the variable would not have. Driven both ways here so the name and the
     * attribute have to agree.
     */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const doc = makeDocument(await read('index.play.html'));
    const restore = doc.install();
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS) }, {});
      const r = runReport([fell('CT-1', 'B1 Battle Droid', 60), area(1, 'The Foundry', 9, 1)]);
      menu.showPause([['Wave', '3']], false, r);
      const btn = doc.getElementById('btn-pause-report');
      const box = doc.getElementById('pause-report-box');
      const state = () => `${btn.getAttribute('aria-expanded')}/${box.classList.contains('hidden') ? 'shut' : 'open'}`;
      assert(state() === 'false/shut', `a fresh pause reads ${state()}`);
      btn.click();
      assert(state() === 'true/open', `after one click the button says ${state()}`);
      btn.click();
      assert(state() === 'false/shut', `after two clicks the button says ${state()}`);
      /* AND A SECOND PAUSE FOLDS IT AWAY AGAIN, attribute and all: a card that
       * remembers being open is a card that hides Resume behind a list. */
      btn.click();
      menu.showPause([['Wave', '4']], false, r);
      assert(state() === 'false/shut', `the panel survived the next pause as ${state()}`);
      return 'shut → open → shut, and shut again on the next pause';
    } finally { restore(); }
  });

  check('report: the census is drawn, and your own side is drawn differently', async () => {
    /**
     * DRIVEN THROUGH A REAL MENU on a real parse of index.html, because "the
     * screen says it" is not a fact about a string in Menu.js — `_drawReport`
     * returns silently if any host is missing, and every id in it is a second
     * copy of an id in the markup.
     *
     * The decision this demonstrates changing: the same four casualties, drawn
     * twice, once caused by armour and once by the player's own artillery. The
     * card has to SAY the difference and has to mark the friendly rows apart,
     * or it is a list with a heading.
     */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const doc = makeDocument(await read('index.play.html'));
    const restore = doc.install();
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS) }, {});
      const stats = [['Wave', '3']];

      const droids = runReport([fell('CT-1', 'B2 Super Battle Droid', 60),
                                fell('CT-2', 'B2 Super Battle Droid', 70),
                                area(1, 'The Foundry', 8, 2)]);
      menu.showPause(stats, false, droids);
      const btn = doc.getElementById('btn-pause-report');
      const box = doc.getElementById('pause-report-box');
      assert(!btn.classList.contains('hidden'), 'the report button is hidden on a run that has one');
      assert(box.classList.contains('hidden'), 'the panel is open before anybody asked for it');
      const clean = doc.getElementById('report-census').innerHTML;
      assert(/B2 Super Battle Droid/.test(clean) && />2</.test(clean),
        `the census does not say what killed them: ${clean}`);
      assert(!/rc own/.test(clean), 'a run with no friendly fire marks a row as your own side');
      assert(/2 men lost/.test(doc.getElementById('report-head').textContent),
        `the head reads "${doc.getElementById('report-head').textContent}"`);
      assert(/The Foundry/.test(doc.getElementById('report-areas').innerHTML), 'the ledger lost the ground');

      const ownGuns = runReport([fell('CT-1', 'your own fire mission', 60),
                                 fell('CT-2', 'your own fire mission', 70),
                                 area(1, 'The Foundry', 8, 2)]);
      menu.showPause(stats, false, ownGuns);
      const dirty = doc.getElementById('report-census').innerHTML;
      assert(/rc own/.test(dirty),
        `the same two deaths by your own guns read identically to two by a droid: ${dirty}`);

      /**
       * AND A DESIGNATION IS THE ROW THAT NEEDS THE WORDS.
       *
       * "your own fire mission" and "you" say whose they were in the killer's
       * own name, and repeating it is the sentence twice — but `CT-4471` reads
       * exactly like a droid to anybody who has not memorised the roll, and
       * that is the row the suffix exists for. Both must carry the class; only
       * the designation must carry the words.
       */
      const mate = runReport([{ t: 'muster', area: 1, names: ['CT-1', 'CT-2', 'CT-4471'] },
                              fell('CT-1', 'CT-4471', 60), area(1, 'The Foundry', 8, 1)]);
      assert(mate.own === 1, 'a man on the roll killing his own mate is not counted as your side');
      menu.showPause(stats, false, mate);
      const byMate = doc.getElementById('report-census').innerHTML;
      assert(/rc own/.test(byMate) && /one of yours/.test(byMate),
        `a death by one of your own troopers reads as a droid kill: ${byMate}`);
      assert(!/one of yours/.test(dirty),
        `"by your own fire mission" is told it is yours twice: ${dirty}`);

      /* AND OUTSIDE COMMAND THERE IS NOTHING TO REPORT, so the button goes with
       * it: a control that opens an empty screen is worse than no control. */
      menu.showPause(stats, false, null);
      assert(btn.classList.contains('hidden'), 'Survival offers an after-action report of an army it has not got');
      assert(box.classList.contains('hidden'), 'the panel survived the mode that has no log');
      return 'droids → plain rows; your own guns → marked rows; no army → no button';
    } finally { restore(); }
  });

  check('report: the death card leads with the census, off the same list it prints', async () => {
    /* The one screen the pause card cannot reach — the run is over and there is
     * nothing left to pause — so the sentence a player carries into the next
     * run has to be said here or nowhere. */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const doc = makeDocument(await read('index.play.html'));
    const restore = doc.install();
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS) }, {});
      const log = [fell('CT-1', 'B2 Super Battle Droid', 60), fell('CT-2', 'your own fire mission', 70),
                   area(1, 'The Foundry', 8, 2)];
      const r = runReport(log);
      menu.showDeath([['Waves', '3']], undefined, r.fell, r);
      const host = doc.getElementById('death-roll');
      assert(!host.classList.contains('hidden'), 'the roll is hidden on a run that has one');
      const html = host.innerHTML;
      assert(/1 to B2 Super Battle Droid/.test(html), `the census is not on the card: ${html}`);
      assert(/1 of them by your own side/.test(html), 'the card does not say how many you killed yourself');
      assert(/CT-1/.test(html) && /CT-2/.test(html), 'the names went with it');

      /**
       * …AND "OF THEM" MEANS THE ROWS IT PRINTED.
       *
       * The sentence is the top THREE of the census and `report.own` is the
       * whole of it, so a run whose own-side deaths were all below the fold
       * read "8 to B2 · 6 to B1 · 5 to Droideka — 3 of them by your own side"
       * about nineteen deaths, not one of which was yours. There is only one
       * line of room here, so the rest are counted separately rather than
       * silently folded into a number about three rows.
       */
      const many = runReport([
        { t: 'muster', area: 1, names: ['CT-9'] },
        ...Array.from({ length: 8 }, (_, i) => fell(`A${i}`, 'B2 Super Battle Droid', 60 + i)),
        ...Array.from({ length: 6 }, (_, i) => fell(`B${i}`, 'B1 Battle Droid', 80 + i)),
        ...Array.from({ length: 5 }, (_, i) => fell(`C${i}`, 'Droideka', 100 + i)),
        fell('D0', 'CT-9', 130), fell('D1', 'CT-9', 131), fell('D2', 'your own fire mission', 132),
        area(1, 'The Foundry', 0, 22),
      ]);
      assert(many.own === 3, `${many.own} by your own side in a run with three`);
      menu.showDeath([['Waves', '9']], undefined, many.fell, many);
      const deep = host.innerHTML;
      assert(!/3 of them by your own side/.test(deep),
        `the card claims three of the three rows it printed were yours, and none were: ${deep}`);
      assert(/3 more further down the roll/.test(deep),
        `the card does not say the own-side deaths are below the fold: ${deep}`);

      /* A run with no army sends null on both and the block stays hidden — the
       * distinction `runStats` reports null rather than [] to preserve. */
      menu.showDeath([['Waves', '9']], undefined, null, null);
      assert(host.classList.contains('hidden'), 'a mode with no army draws a roll anyway');
      return 'census sentence over the roll, and neither without the other';
    } finally { restore(); }
  });

  check('report: the men a campaign is HANDED are on the roll the report reads', () => {
    /**
     * `recruit` logs an `enlist` and it was the ONLY thing that did — so the
     * men bought between areas were on the ledger and the ten a campaign opens
     * with were not: `_musterOpening` calls `roster.enlist` directly,
     * `_musterVeterans` logs a count with no names, `_musterJoin` enlists a
     * squad in silence.
     *
     * The cost was the first friendly-fire death of every run. An opening
     * trooper who kills his own mate in area one is on nobody's list yet, so
     * the census filed him among the droids and reported nought by your own
     * side — the one death §4.9 is sharpest about, missed for exactly the man
     * most likely to cause it.
     */
    const before = runReport([fell('CT-2', 'CT-1', 60), area(1, 'The Foundry', 9, 1)]);
    assert(before.own === 0,
      'a killer nothing in the log has ever named is being counted as yours on a guess');
    const after = runReport([{ t: 'muster', area: 1, names: ['CT-1', 'CT-2'] },
                             fell('CT-2', 'CT-1', 60), area(1, 'The Foundry', 9, 1)]);
    assert(after.own === 1,
      'the opening roll is on the ledger and the report still does not know CT-1 is one of yours');
    assert(after.census[0].own === true, 'the row is not marked');
    return 'without the roll: 0 by your own side; with it: 1';
  });

  check('report: in a meeting it is YOUR dead, and their trooper is not one of yours', () => {
    /**
     * `onDeath` routes EVERY commander's dead into one log — `commanderOf(e)`
     * — and `formUp` builds a second commander for the other army. So in a
     * meeting the ledger holds both rolls, and a report reading it flat counts
     * the enemy's casualties as yours and marks an enemy trooper who kills one
     * of your men as YOUR OWN SIDE, in red, on the line that exists to say the
     * player did it to himself.
     *
     * `mine` is written where the death happens, because only there is the
     * commander still in hand. Absent — every mode with one army, and every
     * log written before the field existed — reads as ours, which is right.
     */
    const log = [
      { t: 'muster', area: 1, mine: true, names: ['CT-1', 'CT-2'] },
      { t: 'muster', area: 1, mine: false, names: ['BX-9'] },
      fell('CT-1', 'BX-9', 60, 1, { mine: true }),
      fell('BX-9', 'you', 61, 1, { mine: false }),
      area(1, 'The Ridge', 1, 1),
    ];
    const r = runReport(log);
    assert(r.lost === 1, `${r.lost} on your roll, and exactly one of your men died`);
    assert(r.own === 0, 'an enemy trooper is being counted against your own side');
    assert(r.census.length === 1 && r.census[0].killer === 'BX-9' && r.census[0].own === false,
      `the census reads ${JSON.stringify(r.census)}`);
    /* AND A LOG WITH NO SUCH FIELD IS ALL YOURS, which is every one-army mode. */
    const plain = runReport([{ t: 'muster', area: 1, names: ['CT-1'] },
                             fell('CT-2', 'CT-1', 60), area(1, 'The Foundry', 9, 1)]);
    assert(plain.own === 1, 'a log with no `mine` field stopped being read as your own army');
    return 'both rolls in one ledger: 1 of yours lost, 0 by your own side';
  });

  check('report: the engagement being fought shows before anybody has died in it', () => {
    /**
     * The pause card is opened DURING an area far more often than between them,
     * and for the first minute of one there is nothing on the ledger but orders
     * and a dug position — none of which this report draws. Keyed on the drawn
     * lists, that whole row vanished: the ledger stopped at the last area HELD
     * and the "in progress" state written three paragraphs above it could never
     * appear. `saw` is set by any entry at all, drawn or not.
     */
    const r = runReport([fell('CT-1', 'B1 Battle Droid', 60), area(1, 'The Foundry', 9, 1),
                         { t: 'order', formation: 'line', area: 2, wave: 1 },
                         { t: 'dug', squad: 0, area: 2, wave: 1 }]);
    assert(r.areas.length === 2, `${r.areas.length} areas — the engagement being fought was dropped`);
    assert(r.areas[1].held === null && r.areas[1].n === 2,
      `the open engagement reads held=${r.areas[1]?.held}, area ${r.areas[1]?.n}`);
    assert(r.ended === null, `a run still being fought reports it ended "${r.ended}"`);
    /* AND AN EMPTY LOG STILL REPORTS NOTHING, rather than one blank row. */
    assert(runReport([]).areas.length === 0, 'an empty run grew an area');
    return '1 held + 1 in progress off a log whose second area has only orders in it';
  });

  check('report: the run ending does not add a nameless area to the end of it', () => {
    /**
     * `_endCampaign` pushes `{t:'won'}` or `{t:'lost'}` the instant after
     * `_areaClear` has pushed the last area's own entry, and both carry an area
     * number and no name. Cut on naively they open and close a second bucket
     * over the same ground, and every finished campaign ends with a blank row.
     * `won` was not a terminator at all, which was the other half: with the fix
     * above it it would have left one open instead.
     */
    const won = runReport([fell('CT-1', 'B2 Super Battle Droid', 60),
                           area(1, 'The Foundry', 9, 1),
                           { t: 'won', area: 1, strength: 9, fallen: 1 }]);
    assert(won.areas.length === 1,
      `${won.areas.length} areas off one engagement — ${JSON.stringify(won.areas.map((a) => a.name))}`);
    assert(won.ended === 'held', `a won campaign reports "${won.ended}"`);
    const lost = runReport([area(1, 'The Foundry', 9, 1),
                            { t: 'lost', area: 1, strength: 0, fallen: 10,
                              why: 'the line did not survive the crossing' }]);
    assert(lost.areas.length === 1, `${lost.areas.length} areas off one lost crossing`);
    return 'won and lost both close the run without opening a row over ground already reported';
  });

  check('report: the shape the director actually writes is the shape this reads', async () => {
    /**
     * THE FIXTURES ABOVE ARE HAND-WRITTEN, and the risk in that is a projection
     * that reads a ledger the game stopped keeping. So this one reads the
     * director's own source and requires every field the report projects to be
     * written where the death happens — which is the same guarantee the log's
     * own note claims ("the three facts are written where the death happens, in
     * the units the report will read them in").
     */
    const cmd = await read('src/game/Command.js');
    const fellPush = cmd.slice(cmd.indexOf("this.log.push({ t: 'fell'"));
    const body = fellPush.slice(0, fellPush.indexOf('});'));
    for (const f of ['name', 'unit', 'rank', 'area', 'killer', 'bearing', 'at']) {
      assert(new RegExp(`\\b${f}\\b`).test(body), `the \`fell\` entry no longer carries \`${f}\``);
    }
    /* WHOSE MAN HE WAS, written where the death happens — the projection above
     * reads it and cannot derive it, because by the time the log is read the
     * commander is long gone. */
    assert(/mine:\s*c === this\.commander/.test(body),
      'the `fell` entry no longer says whose commander lost the man, so a meeting counts the '
      + "enemy's dead as yours and marks their trooper as your own side");

    /**
     * AND THE ROLL IS ON THE LEDGER AT ALL. `recruit` logs an `enlist`; the men
     * a campaign is HANDED go through `roster.enlist` directly and used to log
     * nothing, so the report could not tell an opening trooper from a droid
     * until he died. Every place a body joins the roll without being bought has
     * to reach `_logRoll`.
     */
    assert(/_logRoll\(c\)\s*\{[\s\S]{0,400}?t: 'muster'[\s\S]{0,200}?names:/.test(cmd)
           || /t: 'muster'[\s\S]{0,200}?names: c\.roster\.living/.test(cmd),
      '`_logRoll` no longer writes the roll\'s names onto the ledger');
    assert(/mine: c === this\.commander/.test(cmd.slice(cmd.indexOf("t: 'muster'") - 200,
                                                         cmd.indexOf("t: 'muster'") + 200)),
      'the muster entry does not say whose roll it is');
    const rolls = [...cmd.matchAll(/this\._logRoll\(c\)/g)].length;
    assert(rolls >= 3,
      `only ${rolls} call(s) to _logRoll — the campaign's opening, the contingent's and a joining `
      + 'player\'s squad are three separate doors onto the roll and each has to say so');
    const fm = await read('src/game/FireMission.js');
    const fmPush = fm.slice(fm.indexOf("t: 'mission'"));
    const fmBody = fmPush.slice(0, fmPush.indexOf('});'));
    for (const f of ['grid', 'lapsed', 'told', 'hostiles', 'friendlies', 'names']) {
      assert(new RegExp(`\\b${f}\\b`).test(fmBody), `the \`mission\` entry no longer carries \`${f}\``);
    }
    /**
     * AND THE ONE ENTRY WITH NO AREA ON IT STAYS ACCOUNTED FOR — as a PAIR,
     * because the first cut of this asserted `mission` carries no area, which
     * goes red the day somebody ADDS one. A check that fails on an improvement
     * is the check people delete. So: either the entry has no area and
     * `runReport` cuts on terminators, or it grows one and `runReport` is
     * allowed to use it — what may not happen is the field appearing while the
     * projection still ignores it.
     */
    const projection = await read('src/game/Session.js');
    const hasArea = /\barea\b\s*:/.test(fmBody);
    const cutsOnTerminators = /e\.t === 'area' \|\| e\.t === 'lost'/.test(projection);
    assert(hasArea || cutsOnTerminators,
      'a fire mission carries no area number and `runReport` no longer cuts on terminators — '
      + 'every fire mission has just dropped out of the report');
    return `7 fields on \`fell\`, 6 on \`mission\`; mission ${hasArea ? 'carries' : 'carries no'} area, `
      + `and runReport ${cutsOnTerminators ? 'cuts on terminators' : 'groups on the field'}`;
  });
}
