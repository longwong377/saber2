/**
 * BATTLEFRONT BORZ — the databank.
 *
 * ── the hole this was written for ──────────────────────────────────────
 *
 * The game fields thirty-one archetypes and told the player what none of them
 * was. The tab named "Codex" is a keybind reference; the HUD prints
 * `ARCHETYPES[t].label` and stops. So a player meets a droideka, a BX commando,
 * a hailfire droid, an acklay, a reek, a nexu and a rancor, kills several
 * thousand of them, and the product never once says what any of them is, whose
 * army it belongs to, or what it is carrying — while the research to say all
 * three is already written, in the comments that price them. The B1's E-5, the
 * Temple Guard's yellow crystal, the OG-9's four thin legs, the acklay's reach:
 * every one of those sentences existed in `src/` and none of it was visible.
 *
 * ── what this file holds ───────────────────────────────────────────────
 *
 * THE LIST IS ENUMERATED AND THE CHECK IS THE PROOF. `databankPages()` walks
 * `Object.keys(ARCHETYPES)`; the first clause below asserts a real Menu, built
 * on a real parse of index.html, renders one row per archetype and that the row
 * count IS the roster count. An archetype registered tomorrow gets a row
 * tomorrow and a red check until somebody writes its paragraph — which is the
 * entire point, and is what a hand-written list of thirty-one blocks of markup
 * could never do. HANDOFF §2.3 has now been paid nine times; this is the tenth
 * place it was about to be paid again.
 *
 * NOTHING ON A PAGE IS TYPED TWICE. The name, health, threat, pace, mass and
 * the levels a body is met on are read off `ARCHETYPES` and the level pools at
 * render time, so the clauses here compare the rendered page against those
 * tables rather than against a copy of the expected text. The one clause that
 * looks like style policing — no entry may restate its own archetype's label —
 * is the same rule stated at the only place a name could still be duplicated.
 *
 * AND IT IS DRAWN LIKE THE GAME. styles.css opens with four laws (ink, flat,
 * stamp, cut) and the last clause measures the databank's own block against
 * them, because a reference page that invented its own chrome would put a second
 * interface inside a product whose whole style file exists to have one.
 */

import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS, databankPages, databankGroups } from '../../src/ui/Menu.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { DATABANK, FACTIONS } from '../../src/game/Databank.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

let INDEX_HTML = '';

/** A real Menu on a real page — the same fixture menu.mjs uses, same rules. */
function menuOn() {
  const doc = makeDocument(INDEX_HTML);
  const restore = doc.install();
  try {
    const menu = new Menu(structuredClone(DEFAULT_SETTINGS), {});
    return { menu, doc, close: restore };
  } catch (e) { restore(); throw e; }
}

const rowsIn = (doc) => [...doc.getElementById('databank-list').querySelectorAll('.diff')];
const pageText = (doc) => doc.getElementById('databank-page').textContent.replace(/\s+/g, ' ').trim();

export async function run({ check, assert }) {
  INDEX_HTML = await read('index.html');
  const CSS = await read('styles.css');
  const MENU_SRC = await read('src/ui/Menu.js');
  const BANK_SRC = await read('src/game/Databank.js');

  /* ────────────────────────────────────────────────────────────────────
   * IT IS COMPLETE, AND IT IS GENERATED
   * ──────────────────────────────────────────────────────────────────── */

  check('databank: every body the game fields has a page, and the roster is enumerated', () => {
    const keys = Object.keys(ARCHETYPES);
    /* The table first, because a missing entry is the failure this whole file
     * exists to make loud, and it has to be loud whether or not a DOM builds. */
    const missing = keys.filter((k) => !DATABANK[k]);
    assert(!missing.length,
      `${missing.join(', ')} are archetypes with no databank entry — a body the player meets `
      + 'and the game never names');
    const ghosts = Object.keys(DATABANK).filter((k) => !ARCHETYPES[k]);
    assert(!ghosts.length, `${ghosts.join(', ')} have entries and are not archetypes`);

    /* …and then the page a player would actually see. `databankPages` walking
     * ARCHETYPES is only a claim until something renders it: the row count IS
     * the roster count, and no row may name a body twice or none. */
    const { doc, close } = menuOn();
    try {
      const rows = rowsIn(doc);
      const rendered = rows.map((r) => r.dataset.entry);
      assert(rendered.length === keys.length,
        `${rendered.length} rows rendered against ${keys.length} archetypes`);
      const dupes = rendered.filter((k, i) => rendered.indexOf(k) !== i);
      assert(!dupes.length, `rendered twice: ${dupes.join(', ')}`);
      const unrendered = keys.filter((k) => !rendered.includes(k));
      assert(!unrendered.length, `${unrendered.join(', ')} have entries and no row`);
      /* The whole roster is on the page, including the fifteen that Enemy.js
       * declares and the sixteen that Levels.js, Vehicles.js and Command.js
       * register afterwards — which is the temporal trap a module-scope table
       * would have walked into, showing 15 of 31 and looking finished. */
      assert(keys.length >= 31, `only ${keys.length} archetypes are registered at render time`);
      return `${rendered.length} pages from ${keys.length} archetypes across `
        + `${databankGroups().length} factions: `
        + databankGroups().map((g) => `${g.faction.short} ${g.pages.length}`).join(', ');
    } finally { close(); }
  });

  check('databank: no page, and no part of one, is typed by hand', () => {
    /**
     * THREE PLACES A NAME COULD BE DUPLICATED, and each is checked at its own
     * source rather than by reading the render:
     *
     *   index.html — the markup. `_buildTraining`'s own note says why the
     *     training panel is built in JS and not here; the same applies with
     *     thirty-one rows instead of one list.
     *   Menu.js — the renderer. It may interpolate a name, never contain one.
     *   Databank.js — the table. This is the subtle one: an entry sitting
     *     beside `ARCHETYPES[key].label` and repeating it is HANDOFF §2.3 in one
     *     line, and it would be wrong the first time a body is renamed. A
     *     cross-reference to ANOTHER body's name is prose and is allowed — the
     *     IG bodyguard's page names the MagnaGuard because they are the same
     *     chassis — so the rule is stated exactly: an entry may not restate its
     *     own.
     */
    const labels = Object.keys(ARCHETYPES).map((k) => ({ key: k, label: ARCHETYPES[k].label }))
      .filter((x) => typeof x.label === 'string' && x.label.length > 3);
    const inMarkup = labels.filter((x) => INDEX_HTML.includes(x.label));
    assert(!inMarkup.length,
      `index.html types unit names: ${inMarkup.map((x) => x.label).join(', ')} — `
      + 'markup that names a body is markup that is wrong when the body is renamed');
    const inMenu = labels.filter((x) => MENU_SRC.includes(`>${x.label}<`) || MENU_SRC.includes(`'${x.label}'`));
    assert(!inMenu.length,
      `Menu.js types unit names: ${inMenu.map((x) => x.label).join(', ')}`);
    const selfNamed = labels.filter((x) => DATABANK[x.key]
      && JSON.stringify(DATABANK[x.key]).includes(x.label));
    assert(!selfNamed.length,
      `${selfNamed.map((x) => `${x.key} restates "${x.label}"`).join('; ')} — `
      + 'the roster already holds the name; a second copy is one rename from being a lie');
    /* And the numbers, which are the other half of the same rule: an entry that
     * quotes its own health or threat would go stale on the next balance pass. */
    const quoted = Object.keys(DATABANK).filter((k) => {
      const A = ARCHETYPES[k]; if (!A) return false;
      const t = DATABANK[k].text;
      return new RegExp(`\\b${A.hp} (?:points|hp|health)`, 'i').test(t)
        || new RegExp(`\\bthreat ${A.threat}\\b`, 'i').test(t);
    });
    assert(!quoted.length,
      `${quoted.join(', ')} quote a stat the page already prints from the roster`);
    return `${labels.length} unit names, none of them typed in index.html, Menu.js or beside their own entry`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * WHAT A PAGE SAYS
   * ──────────────────────────────────────────────────────────────────── */

  check('databank: a page names the weapon the roster says it is holding', () => {
    /**
     * `ARCHETYPES` carries the weapon as a BUILDER KEY — `weapon: 'e5'` picks
     * the B1 carbine out of `buildBlaster`, `'dc15'` the clone rifle — and the
     * databank carries the real name. The two are the same claim in two
     * vocabularies, so they are pinned together: a body holding an E-5 whose
     * page says DC-15 is a page a player can catch the game out on.
     */
    const wrong = [];
    const RIFLE = { e5: /E-5/, dc15: /DC-15/ };
    let declared = 0;
    for (const [key, A] of Object.entries(ARCHETYPES)) {
      const e = DATABANK[key];
      if (!e) continue;
      const w = String(e.weapon || '');
      assert(w.length > 3, `${key} names no weapon at all`);
      /* NAMED IN THE WRONG DIRECTION, and that is the sharp one: a page may not
       * attribute a rifle to a body that is not carrying it. Written the other
       * way round — "a dc15 body must say DC-15" — it would be asserting that
       * every body holding a clone rifle IS holding a clone rifle, and two of
       * them are not (below). */
      for (const [kind, re] of Object.entries(RIFLE)) {
        if (re.test(w) && A.weapon !== kind) {
          wrong.push(`${key} is armed with ${A.weapon ?? 'nothing'} and its page names a ${kind}`);
        }
      }
      /**
       * …AND THE TWO BODIES WHOSE MODEL AND ARMAMENT DISAGREE SAY SO.
       *
       * `weapon` on an archetype is a builder key into `buildBlaster`, and
       * Command.js gives the clone heavy gunner `'dc15'` and the rocket droid
       * `'e5'` — a clone rifle for a unit whose cadence is a Z-6's, and a B1
       * carbine for one that fires a single 44-damage round on a telegraph.
       * `heldMesh` is the databank stating that mismatch instead of either
       * printing a weapon the model contradicts or quietly describing the wrong
       * gun.
       *
       * IT IS A TRIPWIRE, NOT AN EXEMPTION. It must equal the shipped builder
       * key, so the day somebody gives the heavy gunner a repeater this goes red
       * and the declaration is deleted along with the defect. A body that
       * declares one and does not need one fails too.
       */
      if (e.heldMesh !== undefined) {
        declared++;
        if (e.heldMesh !== A.weapon) {
          wrong.push(`${key} declares it holds a ${e.heldMesh} model and the archetype now says `
            + `${A.weapon ?? 'nothing'} — delete the declaration if the game was fixed`);
        }
        if (RIFLE[e.heldMesh] && RIFLE[e.heldMesh].test(w)) {
          wrong.push(`${key} declares a mesh mismatch and then names that same weapon`);
        }
      }
      /* A body with a blade must name a blade; the three arc-weapon bodies are
       * `saber: true` and carry an electrostaff or a vibrosword, which is a
       * distinction the source material makes and the game already models with
       * `saberColor: 5`. */
      if (A.saber && !/lightsaber|electrostaff|vibrosword/i.test(w)) {
        wrong.push(`${key} fights with a blade and its page says "${w}"`);
      }
      /* …and one that does not fight says so rather than being handed a name. */
      if (A.inert && !/none/i.test(w)) wrong.push(`${key} is inert and its page arms it with "${w}"`);
    }
    assert(!wrong.length, wrong.join('; '));
    const armed = Object.values(ARCHETYPES).filter((A) => A.weapon).length;
    return `${Object.keys(DATABANK).length} weapons named, ${armed} pinned to a builder key, `
      + `${declared} declaring a model their armament contradicts`;
  });

  check('databank: a page says where the body is met, and the pools are what it reads', () => {
    /**
     * The one thing on a page that no comment in the source already answers, and
     * the question a player actually has: where do I go to fight one of these.
     * Derived from the pools, so it is right on the day a level's roster changes
     * — and asserted against the SAME pools rather than against a stored list,
     * which would only prove this file agrees with itself.
     */
    const { doc, close } = menuOn();
    try {
      const rows = rowsIn(doc);
      const wrong = [];
      let withLevels = 0, dojo = 0;
      for (const p of databankPages()) {
        const want = LEVEL_ORDER.filter((k) => (LEVELS[k].pool || []).includes(p.key))
          .map((k) => LEVELS[k].name);
        rows.find((r) => r.dataset.entry === p.key).click();
        /**
         * THE CELL, NOT A WINDOW CUT OUT OF THE PAGE TEXT.
         *
         * The first cut of this clause sliced 260 characters after the words
         * "Met on" and looked for level names in it. The acklay's paragraph
         * begins "shipped to Geonosis to execute prisoners in the Petranaki
         * arena" — Geonosis is a place in the prose AND a theatre in the
         * roster — so the check reported the page sending players to a level
         * whose pool does not name the acklay. It was reading the paragraph.
         * Reading the cell instead makes the claim unambiguous, and it is the
         * §2.4 lesson in miniature: an instrument that approximates the thing it
         * measures will eventually manufacture a defect out of the difference.
         */
        const cell = [...doc.getElementById('databank-page').querySelectorAll('.databank-stats div')]
          .find((d) => d.querySelector('b')?.textContent === 'Met on');
        assert(cell, `${p.key} renders no "Met on" cell`);
        const met = cell.querySelector('span').textContent.trim();
        if (ARCHETYPES[p.key].training) {
          dojo++;
          if (!/dojo/i.test(met)) wrong.push(`${p.key} is a dojo body and its page does not say so`);
          continue;
        }
        assert(want.length, `${p.key} is in no pool at all — roster.mjs should have caught that first`);
        withLevels++;
        for (const name of want) {
          if (!met.includes(name)) wrong.push(`${p.key} is fielded on ${name} and its page omits it`);
        }
        /* …and the other direction: a page must not send a player to a theatre
         * that does not field the body. A claim about where to go is worse
         * wrong than absent. */
        for (const k of LEVEL_ORDER) {
          if (want.includes(LEVELS[k].name)) continue;
          if (met.includes(LEVELS[k].name)) wrong.push(`${p.key} points at ${LEVELS[k].name} and is not in its pool`);
        }
      }
      assert(!wrong.length, wrong.slice(0, 6).join('; '));
      return `${withLevels} bodies point at the theatres whose pools name them, ${dojo} name the dojo`;
    } finally { close(); }
  });

  check('databank: the prose is prose, and no two pages are the same page', () => {
    /**
     * NOT A STYLE OPINION — the failure this catches is real and it is the one a
     * generated page invites: thirty-one entries that are the same sentence with
     * a noun swapped, which reads as filler and tells the player nothing. So:
     * every entry is long enough to be a paragraph, none of them opens the same
     * way as another, and nothing is a placeholder.
     */
    const bad = [];
    const opens = new Map();
    let shortest = Infinity, shortestKey = '', total = 0;
    for (const [key, e] of Object.entries(DATABANK)) {
      const t = String(e.text || '');
      total += t.length;
      if (t.length < shortest) { shortest = t.length; shortestKey = key; }
      if (t.length < 240) bad.push(`${key} is ${t.length} characters — a caption, not a page`);
      if (t.length > 1000) bad.push(`${key} is ${t.length} characters — longer than the column`);
      const sentences = t.split(/[.!?]\s/).filter((s) => s.trim().length > 12);
      if (sentences.length < 3) bad.push(`${key} is ${sentences.length} sentence(s)`);
      if (!/[.!?]$/.test(t.trim())) bad.push(`${key} does not end in a full stop`);
      if (/\b(TODO|TBD|lorem|placeholder|coming soon)\b/i.test(t)) bad.push(`${key} is a placeholder`);
      const open = t.slice(0, 32).toLowerCase();
      if (opens.has(open)) bad.push(`${key} opens exactly as ${opens.get(open)} does`);
      opens.set(open, key);
      assert(FACTIONS[e.faction], `${key} names faction "${e.faction}", which does not exist`);
    }
    assert(!bad.length, bad.slice(0, 6).join('; '));
    /* Every faction's own note has to carry its weight too — it is what the
     * index page is made of. */
    for (const [id, f] of Object.entries(FACTIONS)) {
      assert(String(f.note || '').length > 100, `the ${id} banner has no note on it`);
      assert(typeof f.name === 'string' && f.name.length > 4, `${id} has no full name`);
    }
    return `${Object.keys(DATABANK).length} entries, ${Math.round(total / Object.keys(DATABANK).length)} `
      + `characters on average, shortest ${shortest} (${shortestKey}), no two opening alike`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * IT IS REACHABLE AND IT LOOKS LIKE THE GAME
   * ──────────────────────────────────────────────────────────────────── */

  check('databank: the tab reaches the page, and the Codex is still the Codex', () => {
    const { doc, close } = menuOn();
    try {
      const tabs = [...doc.querySelectorAll('.tab')];
      const tab = tabs.find((t) => t.dataset.tab === 'databank');
      assert(tab, `no Databank tab — the tabs are ${tabs.map((t) => t.dataset.tab).join(', ')}`);
      tab.click();
      const panels = [...doc.querySelectorAll('.panel')];
      const mine = panels.find((p) => p.dataset.panel === 'databank');
      assert(mine, 'the Databank tab has no panel behind it');
      assert(mine.classList.contains('active'), 'clicking Databank did not show its panel');
      const active = panels.filter((p) => p.classList.contains('active'));
      assert(active.length === 1, `${active.length} panels are on screen at once`);
      /* The index is what a player lands on, and it has to say what the page is
       * rather than opening on whichever body happens to be first. */
      const text = pageText(doc);
      assert(/pick one/i.test(text), 'the databank opens on nothing and explains nothing');
      /* …and the Codex was NOT repurposed. It is the keybind reference and it
       * stays one — the databank is a second page, not a replacement, and the
       * check that the Codex still renders its grid lives in menu.mjs. */
      /* `codex`, and it used to be `train` — one character from `training`,
       * which is a DIFFERENT tab built in Menu.js. The two reference pages also
       * moved in front of Options at the same time. Neither is a repurposing:
       * the clause below is the one that matters and it is unchanged. */
      const codex = tabs.find((t) => t.dataset.tab === 'codex');
      assert(codex, 'the Codex tab is gone');
      assert(doc.getElementById('codex-grid').children.length > 20, 'the Codex stopped rendering');
      /* A row opens a page: driven, not assumed. */
      const rows = rowsIn(doc);
      rows[0].click();
      assert(rows[0].classList.contains('sel'), 'a chosen body is not marked as chosen');
      assert(rows.filter((r) => r.classList.contains('sel')).length === 1, 'two bodies are selected at once');
      assert(pageText(doc).length > 400, 'a chosen body rendered a page with nothing on it');
      return `Databank tab → 1 of ${panels.length} panels, ${rows.length} rows, `
        + 'the Codex untouched at ' + doc.getElementById('codex-grid').children.length + ' rows';
    } finally { close(); }
  });

  check('databank: it obeys the four laws styles.css opens with', () => {
    /**
     * INK, FLAT, STAMP, CUT — the header of styles.css states them and says why:
     * "a player crossing from the menu into the game crossed between two
     * products". A new page is exactly where a fifth style gets in, so its own
     * block is measured rather than trusted.
     *
     * The block is cut out by its own comment banner, so this measures the rules
     * that were added and not the eleven hundred lines that were already there.
     */
    const a = CSS.indexOf('/* ── databank ─');
    assert(a > 0, 'the databank has no block in styles.css to measure');
    const b = CSS.indexOf('\n.menu-foot{', a);
    assert(b > a, 'the databank block has no end');
    const block = CSS.slice(a, b);

    const round = block.match(/border-radius\s*:\s*(?!0)/g) || [];
    assert(!round.length, `${round.length} rounded corners — law 4 is CUT`);
    const blur = block.match(/blur\(|backdrop-filter/g) || [];
    assert(!blur.length, `${blur.length} blurs — laws 2 and 3 forbid them`);
    const grad = block.match(/linear-gradient|radial-gradient/g) || [];
    assert(!grad.length, `${grad.length} gradients — law 2 is FLAT`);
    /* Law 1: every border is 2 px of the ink token, never a hairline and never
     * an alpha. `rgba(` in a border is the exact thing the header says the old
     * interface did. */
    const borders = block.match(/border(?:-top|-bottom|-left|-right)?\s*:[^;]+/g) || [];
    const thin = borders.filter((d) => !/\b2px\b/.test(d) && !/\bnone\b/.test(d) && !/\b0\b/.test(d));
    assert(!thin.length, `borders that are not 2 px: ${thin.join(' | ')}`);
    const alpha = borders.filter((d) => /rgba\(/.test(d));
    assert(!alpha.length, `alpha borders: ${alpha.join(' | ')}`);
    /* Law 4 in the positive: the page's own boxes are cut, using the shared
     * clip tokens rather than a polygon typed here at some other angle. */
    assert(/clip-path\s*:\s*var\(--cut/.test(block), 'nothing on the page is cut');
    assert(!/clip-path\s*:\s*polygon/.test(block), 'a polygon was typed instead of --cut');
    /* Law 3: depth is a stamp, and it is the shared one. */
    const shadows = block.match(/box-shadow\s*:[^;]+/g) || [];
    const soft = shadows.filter((d) => !/var\(--stamp/.test(d));
    assert(!soft.length, `shadows that are not the stamp: ${soft.join(' | ')}`);
    /* And the type is the interface's, not a browser default. */
    assert(/var\(--mono\)/.test(block), 'no label on the page uses the interface font');

    /* Finally: the block is real, i.e. every class the renderer emits is styled.
     * A rule set that has fallen out of step with the markup is a page painted
     * by nothing, which looks like an unstyled document and reads as a crash. */
    const emitted = ['databank-roster', 'databank-army', 'databank-name', 'databank-army-line',
      'databank-stats', 'databank-tags', 'databank-text', 'databank-foot', 'databank-page'];
    const unstyled = emitted.filter((c) => !new RegExp(`\\.${c}\\b`).test(block));
    assert(!unstyled.length, `classes the renderer emits and the sheet does not paint: ${unstyled.join(', ')}`);
    const used = emitted.filter((c) => MENU_SRC.includes(c));
    assert(used.length === emitted.length,
      `the sheet paints classes nothing emits: ${emitted.filter((c) => !MENU_SRC.includes(c)).join(', ')}`);
    return `${block.split('\n').filter((l) => l.includes('{')).length} rules, `
      + `${borders.length} borders all 2 px of ink, ${shadows.length} stamps, 0 gradients, 0 blurs, 0 rounded corners`;
  });

  check('databank: the source it was mined from is still the source', () => {
    /**
     * A LIGHT ANCHOR, and it is here because the prose above claims things about
     * the game that a balance pass can quietly falsify. Three of them are
     * checkable against the tables directly, and they are the three that would
     * be most embarrassing to have wrong on a page whose whole job is to be
     * believed.
     */
    const wrong = [];
    /* The Temple Guardian's yellow. Its page says nobody else in the Order
     * carries it; the roster is what decides that. */
    const gold = ARCHETYPES.guardian?.saberColor;
    const alsoGold = Object.entries(ARCHETYPES)
      .filter(([k, A]) => k !== 'guardian' && A.saber && A.saberColor === gold).map(([k]) => k);
    if (alsoGold.length) wrong.push(`the guardian's page claims its crystal is unique and ${alsoGold.join(', ')} share it`);
    /* The nexu's pace: its page says nothing else in the game is close.
     *
     * The clause this replaced claimed the acklay had the only reach that beats
     * the player's, and it was FALSE — the rancor's band is [3.0, 6.0] against
     * the acklay's [2.5, 5.0]. That sentence came straight out of the
     * Colosseum's own note, which is comparing three creatures and not the whole
     * roster, and it went into the databank unexamined. The check caught it on
     * its first run, which is the argument for writing a clause per superlative
     * rather than trusting prose that reads well. */
    const fastest = Object.entries(ARCHETYPES)
      .filter(([k, A]) => k !== 'stalker' && (A.speed ?? 0) >= ARCHETYPES.stalker.speed).map(([k]) => k);
    if (fastest.length) wrong.push(`the nexu's page claims nothing is close and ${fastest.join(', ')} match its pace`);
    /* The AT-TE's shell: its page calls it the heaviest single hit in the game. */
    const heavier = Object.entries(ARCHETYPES)
      .filter(([k, A]) => k !== 'atte' && (A.damage ?? 0) > ARCHETYPES.atte.damage).map(([k]) => k);
    if (heavier.length) wrong.push(`the AT-TE's page claims the heaviest hit and ${heavier.join(', ')} hit harder`);
    /* The rancor's bulk: its page calls it the heaviest body in the arena. */
    const arena = [...new Set(LEVELS.colosseum.pool)];
    const bigger = arena.filter((k) => k !== 'brute' && (ARCHETYPES[k]?.hp ?? 0) > ARCHETYPES.brute.hp);
    if (bigger.length) wrong.push(`the rancor's page claims the arena's heaviest body and ${bigger.join(', ')} beat it`);
    /**
     * THE FIFTH CLAUSE, AND IT IS A RATIO RATHER THAN A SUPERLATIVE — which is
     * the kind that goes stale quietly, because nothing about it reads wrong.
     *
     * The IG Bodyguard's page says it is the MagnaGuard's chassis "at four
     * times the health and half again the size". Measured off the shipped
     * archetypes: 1050/260 = 4.04x, so the first half holds; 1.30/1.18 = 1.10x,
     * which is a TENTH again, not a half. Both numbers are read here rather
     * than typed, and the tolerances are what "four times" and "half again"
     * mean as English — a claim that is out by a factor of five is not a
     * rounding.
     */
    const ig = ARCHETYPES.bodyguard, mg = ARCHETYPES.magna;
    if (ig && mg) {
      const hpX = ig.hp / mg.hp;
      const sizeX = (ig.scale ?? 1) / (mg.scale ?? 1);
      const page = DATABANK.bodyguard?.text || '';
      if (/four times the health/.test(page) && Math.abs(hpX - 4) > 0.25) {
        wrong.push(`the IG Bodyguard's page says four times the MagnaGuard's health and it is ${hpX.toFixed(2)}x`);
      }
      /**
       * THE SIZE HALF, AND THE PIN THAT USED TO BE HERE IS DISCHARGED.
       *
       * The page said "half again the size" against archetypes reading
       * 1.30/1.18 = 1.10x — a tenth, not a half, out by a factor of five. The
       * prose belonged to another lane, so this clause was written as a PINNED
       * measurement rather than a relaxed bound: it failed if either scale
       * moved AND it failed the moment the sentence was corrected, which is
       * what forced its own deletion. The sentence has been corrected and the
       * pin fired exactly as designed, so what is left is the live claim.
       *
       * READ OFF THE PAGE rather than compared to a typed 1.10, because the
       * next person to change either number should not have to remember this
       * file: the page names a fraction in words, the tables name a ratio, and
       * a mismatch between them is the whole defect this clause exists for.
       */
      const SAYS = [[/half again the size/, 1.5], [/a tenth again the size/, 1.1],
        [/a third again the size/, 1.333], [/twice the size/, 2]];
      const claim = SAYS.find(([re]) => re.test(page));
      if (claim && Math.abs(sizeX - claim[1]) > 0.05) {
        wrong.push(`the IG Bodyguard's page claims ${claim[1]}x the MagnaGuard's size and the `
          + `archetypes make it ${sizeX.toFixed(2)}x`);
      } else if (!claim && /the size/.test(page)) {
        wrong.push('the IG Bodyguard\'s page makes a size claim this check cannot read — add its '
          + 'wording to SAYS so the sentence and the tables stay tied together');
      }
    }
    assert(!wrong.length, wrong.join('; '));
    return `five quoted claims still hold: the Temple Guard's crystal, the nexu's `
      + `${ARCHETYPES.stalker.speed} m/s, the AT-TE's ${ARCHETYPES.atte.damage} damage, `
      + `the rancor's ${ARCHETYPES.brute.hp} hp across ${arena.length} arena bodies, and the `
      + `IG Bodyguard at ${(ARCHETYPES.bodyguard.hp / ARCHETYPES.magna.hp).toFixed(2)}x the `
      + `MagnaGuard's health and `
      + `${((ARCHETYPES.bodyguard.scale ?? 1) / (ARCHETYPES.magna.scale ?? 1)).toFixed(2)}x its size, `
      + 'both matching what its page says';
  });
}
