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
 * WHAT COUNTS AS NAMING A LEVEL. Five syntactic forms, chosen because each is
 * unambiguous — a level key and nothing else can appear there:
 *
 *     level: 'x'            a settings blob, a rung, a spawn descriptor
 *     flag('level', 'x')    a tool's default
 *     LEVELS.x              a member read, which is how the dead fallbacks read
 *     LEVELS['x']           the same by index
 *     .level === 'x'        a check asserting which level was loaded
 *
 * TERRAIN PRESETS ARE A DIFFERENT VOCABULARY that happens to share several
 * spellings — `new Terrain(scene, 'dunes', 0.7)` is still perfectly valid,
 * because the sand it describes did not stop existing when the level did. That
 * is why this scans for the four forms above rather than for the names: a
 * name-based scan cannot tell those two apart and would have to be taught to
 * ignore the presets, which is the same list-kept-by-hand problem one level up.
 *
 * The list of forms is itself a list kept by hand, and it will be short of one
 * again. That is fine and it is not the same failure: a form this does not know
 * is a violation that goes unreported, never a correct line reported as a
 * violation, and the first four caught seventeen of the eighteen on the day
 * they were written. The fifth was added within the hour, by this check
 * catching the rename that the first four missed.
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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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
];

export function run({ check, assert }) {
  check('roster: nothing in the tree names a level the game does not have', () => {
    const bad = [];
    let named = 0, files = 0;
    for (const file of [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'tools'))]) {
      const text = strip(readFileSync(file, 'utf8'));
      let hit = false;
      for (const [re, form] of FORMS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          named++;
          hit = true;
          if (LEVELS[m[1]]) continue;
          const line = text.slice(0, m.index).split('\n').length;
          bad.push(`${relative(ROOT, file)}:${line} ${form.replace('…', m[1])}`);
        }
      }
      if (hit) files++;
    }
    assert(named > 20, `only ${named} level keys found in the whole tree — the scan is not scanning`);
    assert(!bad.length, `${bad.length} reference(s) to a level that does not exist:\n    ` + bad.join('\n    '));
    return `${named} level keys across ${files} files, all of them in the roster of ${LEVEL_ORDER.length}`;
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
    assert(LEVEL_ORDER.length >= 8, `only ${LEVEL_ORDER.length} levels`);
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
}
