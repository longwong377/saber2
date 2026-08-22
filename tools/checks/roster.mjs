/**
 * NOBODY MAY NAME A LEVEL THAT DOES NOT EXIST.
 *
 * Four levels were deleted at the player's request — the dune sea, the wash,
 * Hangar Bay Nine and the dojo — and deleting them was the easy half. The hard
 * half was that eighteen places across the source and the tool directory had
 * the string `'dunes'` in them, and not one of them raised its hand:
 *
 *   · `World.loadLevel` fell back to a level it could load and recorded the key
 *     it had been ASKED for, so `main.js` then indexed LEVELS with a key that is
 *     not in it and took the page down one line after the world had recovered;
 *   · `tools/smoke.mjs` — the boot probe, the one instrument whose whole job is
 *     to notice this — wrote the dead key into the profile itself and reported
 *     the resulting crash as a failure of the game;
 *   · five more browser drivers photographed and measured a map nobody asked
 *     for, silently, and looked completely normal doing it;
 *   · `tools/balance.mjs` had three `LEVELS[k] || LEVELS.dunes` guards, i.e. a
 *     fallback that had itself become undefined — a safety net with a hole in
 *     exactly the shape of the thing it was catching.
 *
 * None of that throws at import time and none of it shows up in a diff. The
 * only defence is to ask, mechanically, whether every level key written down
 * anywhere is a level the game actually has.
 *
 * WHAT COUNTS AS NAMING A LEVEL. Nine syntactic forms, chosen because each is
 * unambiguous — a level key and nothing else can appear there. The first five:
 *
 *     level: 'x'            a settings blob, a rung, a spawn descriptor
 *     flag('level', 'x')    a tool's default
 *     LEVELS.x              a member read, which is how the dead fallbacks read
 *     LEVELS['x']           the same by index
 *     .level === 'x'        a check asserting which level was loaded
 *
 * …and four more added one at a time, each by this file being short of one; the
 * note on each says what the blindness cost.
 *
 * TERRAIN PRESETS ARE A DIFFERENT VOCABULARY that happens to share several
 * spellings — `new Terrain(scene, 'dunes', 0.7)` is still perfectly valid,
 * because the sand it describes did not stop existing when the level did. That
 * is why this scans for the forms above rather than for the names: a name-based
 * scan cannot tell those two apart and would have to be taught to ignore the
 * presets, which is the same list-kept-by-hand problem one level up. The
 * presets get their OWN check below, against their own table, for the reason
 * every vocabulary in this file gets one: nine of the fifteen grounds are
 * reached by no level, so nothing else is looking at them.
 *
 * The list of forms is itself a list kept by hand, and it will be short of one
 * again. That is fine and it is not the same failure: a form this does not know
 * is a violation that goes unreported, never a correct line reported as a
 * violation, and the first four caught seventeen of the eighteen on the day
 * they were written. The fifth was added within the hour, by this check
 * catching the rename that the first four missed.
 *
 * THAT CLAIM WAS FALSE OF TWO OF THEM AND IS NOW ENFORCED. The two `LEVELS.…`
 * forms read a member off an IDENTIFIER, and an identifier is the one thing on
 * this list another file may bind to something else — see `SHADOWS_LEVELS`,
 * which is what stopped a GLSL parser's operator-precedence table from being
 * reported as a level called `length`.
 *
 * Comments and block comments are stripped first. This file's own prose names
 * three dead levels in the course of explaining them, and a scanner that reads
 * its own explanation as a violation is not a scanner.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { SET_PIECE, DOJO_MIX } from '../../src/game/Waves.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';

const ROOT = new URL('../..', import.meta.url).pathname;

/** Every .js/.mjs the repository actually ships or runs. */
function sources(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'vendor' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(js|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Comments out, string bodies kept.
 *
 * Crude on purpose — a `//` inside a string literal will take the rest of that
 * line with it. That direction of error is safe: it can only hide a violation
 * from a line that also contains a URL, never invent one.
 */
/**
 * Comments out, LINE NUMBERS INTACT.
 *
 * This collapsed each comment to a single space, which shifts every offset
 * after it — and the failure message is built from `text.slice(0, m.index)`, so
 * the line it printed was the line in the STRIPPED text, not in the file. The
 * first real defect the sixth form below caught was reported at
 * `src/toon/live.js:72`; it is at line 131, and line 72 is the middle of a
 * comment block about something else entirely. A check that names the wrong
 * line sends the next person somewhere there is nothing wrong, which is worse
 * than naming no line at all.
 *
 * Replacing each comment with the same number of characters — newlines kept,
 * everything else blanked — leaves every later index exactly where it was.
 */
const blank = (m) => m.replace(/[^\n]/g, ' ');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre, c) => pre + blank(c));

const FORMS = [
  [/\blevel:\s*'([a-z][a-z0-9_]*)'/g, "level: '…'"],
  [/\bflag\(\s*'level'\s*,\s*'([a-z][a-z0-9_]*)'\s*\)/g, "flag('level', '…')"],
  [/\bLEVELS\.([a-z][a-z0-9_]*)\b/g, 'LEVELS.…'],
  [/\bLEVELS\[\s*'([a-z][a-z0-9_]*)'\s*\]/g, "LEVELS['…']"],
  // A fifth, added the moment the first four missed one: renaming a level key
  // inside a settings-migration check left `assert(b.level === 'dunes')`
  // behind, which is a level name in every sense that matters and is not an
  // assignment.
  [/\.level\s*===\s*'([a-z][a-z0-9_]*)'/g, ".level === '…'"],
  /**
   * A SIXTH, and it is the one that cost the most to be missing.
   *
   * `level('deeps')` and `loadLevel('temple')` are the two ways a check ASKS
   * FOR a world, and neither matched any form above — the file's own note two
   * paragraphs up predicted exactly this ("the list of forms is itself a list
   * kept by hand, and it will be short of one"). The consequence was not a
   * missing warning, it was the §2.7 hang: `World.loadLevel` substitutes
   * `LEVEL_ORDER[0]` for a key it does not know, which is right for a player
   * with a stale profile and a trap in a check. So every dead name silently
   * BUILT ANOTHER FULL WORLD, cached it under the dead key, and then measured a
   * property of a room that no longer exists against a copy of the Ember Shelf.
   * `levels-quality.mjs` alone carried nine of them across three checks — five
   * extra Worlds in one check — which is why that suite was the one holding the
   * most alive at once, and why adding an eighth real level took it from slow to
   * never finishing.
   *
   * Two suites had it independently (`levels-quality`, `cloth-cost`), found by
   * two people who were each sure they had found a one-off. That is what makes
   * it a class rather than a pair, and a class belongs in this table.
   */
  [/\b(?:load)?[Ll]evel\(\s*'([a-z][a-z0-9_]*)'/g, "level('…') / loadLevel('…')"],

  /**
   * THE SEVENTH FORM, and this file predicted its own gap.
   *
   * The note above says "the list of forms is itself a list kept by hand, and it
   * will be short of one". It was. `tools/checks/_coop.mjs` wrote the dead level
   * `arena` as a DESTRUCTURING DEFAULT — `bootWorld({ level = 'arena' })` — which
   * has no colon and no call, so every pattern above walked straight past it.
   *
   * What the blindness cost is the argument for adding it: `bootWorld` and
   * `bootPair` are how most of this harness stands a world up, so one unseen
   * default put an unknown number of checks on a level they did not name, and
   * `coop`'s marksman check spent its life measuring a sniper with no line of
   * sight and blaming the network for it.
   *
   * This form is deliberately narrow — `level` or `levelKey` immediately
   * followed by `=` and a quoted key — because a wide one would match every
   * assignment in the tree and the failures would stop being read.
   */
  [/\blevel(?:Key)?\s*=\s*'([a-z][a-z0-9_]*)'/g, "level = '…' (default / assignment)"],

  /**
   * THE EIGHTH, and the note above is right a third time.
   *
   * The second form here is `flag('level', '…')`, which is the argument parser
   * `tools/trace.mjs` and friends use. `tools/audiowatch.mjs` has its own, and
   * calls it `opt` — `const LEVEL = opt('level', 'arena')` — so the default
   * naming a level deleted in the roster cull went unseen by every pattern
   * above, including the flag one it is a spelling of.
   *
   * What it cost is the reason it is here rather than in a commit message:
   * `World.loadLevel` substituted `LEVEL_ORDER[0]`, so every audiowatch run
   * since the cull measured the Ember Shelf while printing `level arena`, and
   * `Audio.js`'s note over the voice bands quoted a number from that run — "the
   * arena run was worse, 1331 refusals" — as the evidence the band layout was
   * sized on. A dead level name reached a design argument.
   *
   * Written over the NAME of the flag rather than the name of the function, so
   * a ninth parser spelt `arg('level', …)` or `param('level', …)` is covered
   * the day it is written. That is the difference between this entry and the
   * two above it, both of which named a caller and were then short of one.
   */
  [/\b[A-Za-z_$][\w$]*\(\s*'level'\s*,\s*'([a-z][a-z0-9_]*)'\s*\)/g, "…('level', '…')"],

  /**
   * THE NINTH, AND IT IS THE EIGHTH'S OWN BLIND SPOT — the flag is PLURAL.
   *
   * The form above is written over the name of the flag rather than the name
   * of the parser, so any `arg('level', 'x')` is covered. A tool that sweeps
   * SEVERAL levels does not spell it that way: `tools/_shade.mjs` opens with
   * `flag('levels', 'arena,dunes,canyon,hangar,dojo')` and loops over the
   * split, so one string named four levels the roster cull deleted and one
   * that survives. Every pattern above walked past it — plural name, and the
   * value is a list rather than a key.
   *
   * What it cost is the same thing the eighth cost, one tool along: the page
   * `_shade.mjs` serves indexes `LEVELS[key]` for each name, so four fifths of
   * a default run measured `undefined` and the tone chart it exists to draw
   * was built from one level pretending to be five.
   *
   * `split: true` because the capture is a LIST — the arm checks every key in
   * it, so a list with one dead name in the middle is not hidden by four live
   * ones on either side.
   */
  [/\b[A-Za-z_$][\w$]*\(\s*'levels'\s*,\s*'([a-z][a-z0-9_]*(?:,[a-z][a-z0-9_]*)*)'\s*\)/g,
    "…('levels', '…')", { split: true }],
];

/**
 * …AND TWO OF THE FORMS ONLY MEAN A LEVEL WHERE `LEVELS` IS THE GAME'S TABLE.
 *
 * `LEVELS.…` and `LEVELS['…']` are member reads on an IDENTIFIER, which is the
 * one thing on this list that another file is free to bind to something else.
 * `tools/checks/_glsl.mjs` does: its GLSL expression parser holds the operator
 * precedence table in `const LEVELS = [['||'], ['&&'], …]` and asks it for
 * `LEVELS.length`, and this check reported that as a reference to a level
 * called `length`.
 *
 * That is worse than a missed violation and the header above says so in as
 * many words — "a form this does not know is a violation that goes unreported,
 * never a correct line reported as a violation". It was true of the first
 * eight and it was not true of these two, so the claim is now enforced rather
 * than asserted: the two member forms are skipped in a file that binds its own
 * `LEVELS` and never mentions the module the real one comes from.
 *
 * `let LEVELS = null` beside a dynamic `import('…/Levels.js')` is how
 * `runrules.mjs` holds the real table — it declares the name AND names the
 * module — so the second half of the test is what keeps that file in scope.
 * The third clause is for the table's own home: `Levels.js` declares
 * `export const LEVELS` and has no reason to mention its own filename, so the
 * first two clauses between them dropped the file that names three levels by
 * member read. A guard that silences the source of truth is not a guard.
 * Every file skipped is NAMED in the result line, because a scan that quietly
 * stops scanning is the defect this whole file exists to catch.
 */
const SHADOWS_LEVELS = (text) =>
  /\b(?:const|let|var)\s+LEVELS\b/.test(text)
  && !/Levels\.js/.test(text) && !/\bexport\s+const\s+LEVELS\b/.test(text);
const NEEDS_TABLE = new Set(['LEVELS.…', "LEVELS['…']"]);

/**
 * The form with the offending key written into it.
 *
 * The LAST ellipsis, not the first: two of the labels carry two — `…('level',
 * '…')` names the parser as well as the value — and a plain `replace` put the
 * key where the function name goes, so the eighth form reported the dead level
 * `arena` as `arena('level', '…')`. The message is the whole product of a
 * scanner and one that reads backwards is one nobody trusts twice.
 */
const nameIn = (form, key) => form.replace(/…(?=[^…]*$)/, key);

export function run({ check, assert }) {
  check('roster: nothing in the tree names a level the game does not have', () => {
    const bad = [], shadowed = [];
    let named = 0, files = 0;
    for (const file of [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'tools'))]) {
      const text = strip(readFileSync(file, 'utf8'));
      const ownsName = !SHADOWS_LEVELS(text);
      let hit = false;
      for (const [re, form, opts] of FORMS) {
        if (!ownsName && NEEDS_TABLE.has(form)) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          hit = true;
          const line = text.slice(0, m.index).split('\n').length;
          for (const key of opts?.split ? m[1].split(',') : [m[1]]) {
            named++;
            if (LEVELS[key]) continue;
            bad.push(`${relative(ROOT, file)}:${line} ${nameIn(form, key)}`);
          }
        }
      }
      if (!ownsName) shadowed.push(relative(ROOT, file));
      if (hit) files++;
    }
    assert(named > 20, `only ${named} level keys found in the whole tree — the scan is not scanning`);
    assert(!bad.length, `${bad.length} reference(s) to a level that does not exist:\n    ` + bad.join('\n    '));
    return `${named} level keys across ${files} files, all of them in the roster of ${LEVEL_ORDER.length}`
      + (shadowed.length ? `; the member forms skipped ${shadowed.length} file(s) binding their own `
        + `LEVELS: ${shadowed.join(', ')}` : '');
  });

  check('roster: every dressing function Levels.js exports is one a room can reach', () => {
    /**
     * A LEVEL DELETED TAKES ITS VOCABULARY WITH IT, AND NOTHING SAYS SO.
     *
     * The checks above ask whether anything NAMES a room that is gone. This one
     * asks the other half: what did the room leave BEHIND. An exported function
     * with no caller is not a syntax error, does not fail to import, does not
     * show in a diff, and keeps a header written in the present tense arguing
     * for its own necessity — which is how this file found three:
     *
     *   cluster           "this is the workhorse", 0 call sites
     *   run               "a line of things", 0 call sites, and its one likely
     *                     caller is the next row
     *   templeColonnade   126 lines of instanced order whose own note says
     *                     "the rule is written out over the Temple below" and
     *                     "the foundry already spends 386". Both rooms were
     *                     deleted in the roster cull.
     *
     * This is the same class as the 130-line blast-door path and `works()`,
     * which had "no caller at all" for a whole session before anybody looked.
     *
     * THE BAR IS NOT "DELETE IT". Placement vocabulary is worth keeping — the
     * argument shape is the paid-for part and §4's list of permitted interiors
     * has not shrunk. The bar is that an orphan must SAY it is one, in its own
     * doc comment, where the next reader of that function is already looking.
     * A list of orphan names in this file would be HANDOFF §2.3: a table beside
     * its generated twin, and it would rot the same way the headers did.
     *
     * WHAT COUNTS AS REACHED. A call inside `Levels.js` itself, or a named
     * import of it by any module under `src/`. Not a bare word: `run`, `drift`,
     * `bay` and `cluster` are all ordinary English and a word count says
     * `run` is referenced 862 times in `src/`, none of them this function.
     */
    const LEVELS_JS = join(ROOT, 'src/game/Levels.js');
    const src = readFileSync(LEVELS_JS, 'utf8');
    /* Every name any module under src/ takes out of Levels.js by name. */
    const imported = new Set();
    for (const file of sources(join(ROOT, 'src'))) {
      if (file === LEVELS_JS) continue;
      const text = readFileSync(file, 'utf8');
      const re = /import\s*\{([^}]*)\}\s*from\s*'[^']*Levels\.js'/g;
      let m;
      while ((m = re.exec(text))) {
        for (const part of m[1].split(',')) {
          const n = part.trim().split(/\s+as\s+/)[0].trim();
          if (n) imported.add(n);
        }
      }
    }
    const orphans = [], undeclared = [], reached = [];
    const re = /^export function ([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1];
      /* One of them IS the declaration, so a function called nowhere scores 0. */
      const calls = (src.match(new RegExp('\\b' + name + '\\s*\\(', 'g')) || []).length - 1;
      if (calls > 0 || imported.has(name)) { reached.push(name); continue; }
      orphans.push(name);
      /* The declaration lives in the doc comment over the function — within
       * reach of the eye that is reading the signature, and nowhere else.
       *
       * The comment is found by its own delimiters and NOT by a fixed window
       * back from the signature. The first cut looked back 2 200 characters and
       * missed `templeColonnade`, whose header is longer than that: HANDOFF
       * §2.3's twin again, a hand-written span standing in for something the
       * machine can compute, and it fails in the direction that manufactures a
       * defect (`tools/checks/_source.mjs` was written for the same bug). */
      const head = src.slice(0, m.index);
      const end = head.lastIndexOf('*/');
      const open = end < 0 ? -1 : head.lastIndexOf('/**', end);
      /* …and the comment has to be THIS function's: anything but whitespace
       * between the end of the comment and the `export` means the doc belongs
       * to something else and this signature is bare. */
      const attached = end >= 0 && head.slice(end + 2).trim() === '';
      if (!attached || open < 0 || !head.slice(open, end).includes('ORPHANED')) undeclared.push(name);
    }
    assert(reached.length >= 10,
      `only ${reached.length} of Levels.js's exports resolve at all — the scan is not scanning`);
    assert(!undeclared.length,
      `${undeclared.join(', ')} — exported by Levels.js, called by nothing in src/, and the doc `
      + 'comment over it does not say ORPHANED. Either a room lost its vocabulary when it was '
      + 'deleted, or the function was written for a caller that never landed. Say which, over the '
      + 'function, so the next reader of that header is not being argued at in the present tense');
    return `${reached.length} reached, ${orphans.length} declared orphaned`
      + (orphans.length ? ` (${orphans.join(', ')})` : '');
  });

  check('roster: nothing in the tree names a ground the game does not have', () => {
    /**
     * THE SAME QUESTION IN THE OTHER VOCABULARY, and the header above is the
     * reason it is a separate check rather than four more rows in `FORMS`.
     *
     * "TERRAIN PRESETS ARE A DIFFERENT VOCABULARY that happens to share several
     * spellings" — `new Terrain(scene, 'dunes', 0.7)` is valid where
     * `level: 'dunes'` is not, because the sand did not stop existing when the
     * level did. So the presets need their own arm validating against their own
     * table, and the arm is worth having for exactly the reason the level one
     * is: nine of the fifteen presets are reached by no level in `LEVEL_ORDER`,
     * so a rename or a cull there breaks callers nothing else looks at.
     *
     * WHAT IS AND IS NOT COVERED BY THE RUNTIME. `Terrain`'s constructor now
     * THROWS on a name its table does not hold, rather than substituting the
     * dunes — so a bad name in a line that RUNS is loud, and that is not what
     * this is for. It is for the one that does not run: a preset named in a
     * branch no check exercises, in a lane tool nobody has opened this month,
     * or in a level record whose `dress` is the only thing anybody drives. Two
     * forms, chosen the same way the level forms were — a preset key and
     * nothing else can appear there:
     *
     *     new Terrain(…, 'x')   every construction of a ground
     *     terrain: 'x'          how a LEVEL declares which ground it stands on
     *
     * The second is what `LEVELS[k].terrain` reads, and `roster: the list the
     * menu walks…` already asserts that field is a string. A string is not a
     * ground; this is the half that says which strings are.
     */
    const T_FORMS = [
      [/\bnew\s+Terrain\(\s*[^,]*,\s*'([a-z][a-z0-9_]*)'/g, "new Terrain(…, '…')"],
      [/\bterrain:\s*'([a-z][a-z0-9_]*)'/g, "terrain: '…'"],
    ];
    const bad = [];
    let named = 0;
    for (const file of [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'tools'))]) {
      const text = strip(readFileSync(file, 'utf8'));
      for (const [re, form] of T_FORMS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          named++;
          if (TERRAIN_PRESETS[m[1]]) continue;
          const line = text.slice(0, m.index).split('\n').length;
          bad.push(`${relative(ROOT, file)}:${line} ${nameIn(form, m[1])}`);
        }
      }
    }
    assert(named > 10, `only ${named} terrain names found in the whole tree — the scan is not scanning`);
    assert(!bad.length,
      `${bad.length} reference(s) to a ground the table does not hold:\n    ` + bad.join('\n    '));
    /* And the level table's own half, which is the one a player reaches: every
     * shipped level stands on a preset that exists. Asked here rather than
     * left to the scan, because a level's `terrain` can be built rather than
     * written and the scan can only see the written ones. */
    for (const k of LEVEL_ORDER) {
      assert(TERRAIN_PRESETS[LEVELS[k].terrain],
        `${k} stands on '${LEVELS[k].terrain}', which is not a terrain preset`);
    }
    return `${named} terrain names across the tree, all in the table of `
      + `${Object.keys(TERRAIN_PRESETS).length}; ${LEVEL_ORDER.length} levels all on a real ground`;
  });

  check('roster: the list the menu walks and the table it indexes are the same set', () => {
    /* The other half of the same failure, and the cheaper one to state. Every
     * key in LEVEL_ORDER must resolve, and every level in the table must be
     * reachable from the menu — a level present in LEVELS but missing from
     * LEVEL_ORDER is content that shipped and cannot be chosen. */
    const missing = LEVEL_ORDER.filter((k) => !LEVELS[k]);
    const orphan = Object.keys(LEVELS).filter((k) => !LEVEL_ORDER.includes(k));
    assert(!missing.length, `LEVEL_ORDER names ${missing.join(', ')}, which LEVELS does not have`);
    assert(!orphan.length, `${orphan.join(', ')} exist but are not in LEVEL_ORDER — unreachable content`);
    /* SEVEN, and the floor is here to catch an accidental deletion rather than
     * a deliberate one. It was 8 against a roster of 13; six were cut on the
     * player's word — the ground broke the art direction, or the room was a
     * box, or it was simply weaker than the rest. A menu is judged by what a
     * player can pick WRONG, so the number going down is not a regression. */
    assert(LEVEL_ORDER.length >= 6, `only ${LEVEL_ORDER.length} levels`);
    /* And every one of them has to have the two things a caller assumes without
     * checking: a display name (main.js puts it in the HUD) and a terrain key
     * (World builds the ground from it before anything else runs). */
    for (const k of LEVEL_ORDER) {
      assert(typeof LEVELS[k].name === 'string' && LEVELS[k].name.length > 0, `${k} has no display name`);
      assert(typeof LEVELS[k].terrain === 'string', `${k} names no terrain`);
    }
    return `${LEVEL_ORDER.length} levels, all named and all reachable: ${LEVEL_ORDER.join(', ')}`;
  });

  check('roster: every archetype the game has is an archetype a player can meet', () => {
    /**
     * THE SAME FAILURE, ONE LAYER DOWN — and this file's second check already
     * has the sentence for it: "a level present in LEVELS but missing from
     * LEVEL_ORDER is content that shipped and cannot be chosen".
     *
     * An enemy archetype has exactly three doors onto a field, and an archetype
     * that is through none of them is a body somebody built, priced, gave a
     * silhouette and a duel form to, and that no player will ever see:
     *
     *   a LEVEL'S POOL, which is how the fill reaches it (`unlockedAt` filters
     *     the ladder by `pool.includes`, and an `unlockAt` archetype enters the
     *     fill only on the levels that name it);
     *   a SET-PIECE RUNG, which is the only door a `boss` has — and `_setPiece`
     *     ALSO filters by the pool, so a rung whose type no pool names is a
     *     rung that can never fire;
     *   the DOJO, for the three training bodies, which are `training: true` and
     *     deliberately never in a wave.
     *
     * This is not hypothetical. Four Jedi archetypes were added to Enemy.js in
     * the same pass as the temple's pool, and a Master that had been given a
     * set-piece rung but NOT a pool slot fired on zero waves — silently,
     * because `_setPiece` skips a rung it cannot match rather than complaining.
     * Measured before the pool named it: boss waves 5 through 40 on the temple
     * fielded two Sith Acolytes each and no Master ever.
     *
     * Derived from ARCHETYPES rather than from a list kept here, so the next
     * body somebody registers is checked the day it is added.
     */
    const named = new Set();
    for (const key of LEVEL_ORDER) for (const t of (LEVELS[key]?.pool || [])) named.add(t);
    for (const s of SET_PIECE) if (named.has(s.type)) named.add(s.type);
    for (const t of DOJO_MIX) named.add(t);
    /* A mount brings its rider whether or not any pool names one, so a saddle
     * is a door too — read off the archetype rather than hard-coded. */
    for (const t of Object.keys(ARCHETYPES)) {
      if (ARCHETYPES[t].saddle && named.has(t)) named.add(ARCHETYPES[t].saddle);
    }
    const orphan = Object.keys(ARCHETYPES)
      .filter((t) => !ARCHETYPES[t].training && !named.has(t));
    assert(!orphan.length,
      `${orphan.join(', ')} exist but no level's pool, set-piece rung or saddle names them — `
      + 'content that shipped and cannot be met');

    /* …and the other direction, which is the levels check's first half: a rung
     * on the set-piece ladder that no pool can satisfy never fires, and fails
     * by doing nothing rather than by throwing. */
    const dead = SET_PIECE.filter((s) =>
      !LEVEL_ORDER.some((k) => LEVELS[k]?.pool?.includes(s.type)));
    assert(!dead.length,
      `${dead.map((s) => s.type).join(', ')} have set-piece rungs no level's pool names, `
      + 'so the rung can never fire');

    const training = Object.keys(ARCHETYPES).filter((t) => ARCHETYPES[t].training);
    return `${Object.keys(ARCHETYPES).length} archetypes: ${named.size} named by a pool, a rung or a `
      + `saddle, ${training.length} dojo-only (${training.join(', ')}); ${SET_PIECE.length} rungs all live`;
  });

  check('roster: every field an archetype declares is a field something reads', () => {
    /**
     * THE THIRD TIME A FIELD WAS WRITTEN ON A BODY AND READ BY NOTHING.
     *
     * `Run.bestTier` was generated every run and read by nothing.
     * `Enemy.grippable` was `!A.big && !A.boss` — a size wall the mass cap had
     * overturned — and claimed an Acklay could never be lifted while the game
     * lifted one. Both were found by hand, both were the same shape, and the
     * shape has a mechanical test: a declaration is a promise that something
     * acts on it, and a promise nothing acts on is indistinguishable in a diff
     * from a feature.
     *
     * The third was `grenades: true` on the clone trooper. Nothing in `src/`
     * read it — not `Enemy`, not `Waves`, not `Command` — and the Databank was
     * SELLING it to the player, naming "grenades, cover, and the judgement to
     * use both" as the thing that separates a clone from a droid. So the codex
     * described a verb no body in the game has, and the field is what made that
     * look supported.
     *
     * `src/` AND NOT `tools/`, deliberately. A field only the harness reads is
     * a field the GAME does not act on, which is exactly the defect: this check
     * would be blind to its own subject if a check counted as a reader.
     *
     * Three shapes of read, because the tree uses all three — `A.field`,
     * `A['field']` and a destructure — and the direction of error is the safe
     * one: a read this pattern cannot see makes a live field look dead, which
     * is a loud failure somebody reads, never a dead field passing quietly.
     */
    const src = sources(join(ROOT, 'src')).map((f) => strip(readFileSync(f, 'utf8')));
    const fields = new Set();
    for (const A of Object.values(ARCHETYPES)) for (const k of Object.keys(A)) fields.add(k);
    const dead = [];
    for (const f of fields) {
      const re = new RegExp(`\\.${f}\\b|\\[\\s*'${f}'\\s*\\]|\\{[^{}\\n]*\\b${f}\\b[^{}\\n]*\\}\\s*=`);
      if (!src.some((t) => re.test(t))) dead.push(f);
    }
    assert(fields.size > 20, `only ${fields.size} archetype fields found — the scan is not scanning`);
    assert(!dead.length,
      `${dead.join(', ')} — declared on an archetype and read by nothing in src/. A field the game `
      + 'never asks about is not a feature, and the databank has sold one of these to a player before');
    return `${fields.size} distinct fields across ${Object.keys(ARCHETYPES).length} archetypes, `
      + 'every one of them read by the game';
  });
}
