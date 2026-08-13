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
}
