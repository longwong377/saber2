/**
 * THE ONE LINE OF HISTORY THIS GAME KEEPS — and how it counted a run twice.
 *
 * `main.js` calls `record()` from two places, and both of them are on the same
 * path out of a death: `gameOver(stats)` records the run, and `quitToMenu()`
 * records it again — while `Menu.js` binds the death card's second button,
 * "Return to the Temple", to `onQuit`, which IS `quitToMenu`. So a player who
 * died and took the only button on the card that is not "Rise again" wrote the
 * same run to `saber.progress.v1` twice. Reproduced in a browser against the
 * real page with both localStorage keys removed so the game chose its own
 * defaults (scoria / knight / roguelite): the store read `{runs: 1,
 * recent: 1}` on death and `{runs: 2, recent: 2}` after that one click, and the
 * menu printed "2 runs, 0 felled · deepest 1 wave" after a single run.
 *
 * The Descent was immune, because `record()`'s Run branch returns on
 * `world.run.done` — a guard written for one mode out of six. `startRun` builds
 * a Run for the gauntlet alone, so roguelite (the shipped default), waves and
 * duel had nothing playing that part.
 *
 * WHY THIS IS DRIVEN AND NOT GREPPED. `src/main.js` cannot be imported under
 * Node — it dereferences the DOM at module scope — so `record` is LIFTED FROM
 * THE FILE and evaluated against the real `Progress.recordRun`, a real headless
 * World and a real Run. The lift refuses to run if the function stops matching,
 * which is what keeps this from decaying into a regex that passes on a file it
 * no longer describes. What is asserted is the number in the store after the
 * two calls the death card actually makes, computed by main.js's own body.
 *
 * Not every total doubled, which is why this was easy to look at and not see:
 * `Progress.recordRun` adds `runs`, `kills`, `communed`, the woken facets and
 * the forty-entry `recent` history, and takes `Math.max` for `bestDepth`,
 * `bestScore`, `bestTier` and the by-order/species/mode maps. Hence a record
 * line reading "2 runs" beside "roguelite 1".
 */

import { readFile } from 'node:fs/promises';

const mainSrc = () => readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

/**
 * `record` exactly as main.js declares it, given the four things main.js closes
 * it over. Nothing here is a paraphrase of its body: the text between the
 * declaration and its closing brace is compiled as written.
 *
 * `world` comes through a mutable `scope` because `record` reads it on every
 * call and the flow under test spans two different worlds — a death, and then
 * the next session.
 */
function liftRecord(src, assert, { scope, recordRun, mode, settings }) {
  const i = src.indexOf('\nfunction record(stats = null) {');
  assert(i > 0,
    'main.js no longer declares `function record(stats = null)`, so this check describes a file that is gone');
  const end = src.indexOf('\n}\n', i);
  assert(end > i, 'the body of record() could not be delimited');
  const body = src.slice(i + 1, end + 2);
  assert(/recordRun\(/.test(body), 'the lifted record() does not call recordRun at all — the lift is wrong');
  /* It used to consult `world.run.done` too, and the whole point of this file
   * is that the guard was written for one mode out of six. There is no Run at
   * all now — the Descent was the only mode that made one, and it is deleted —
   * so the dedupe is `world._recorded`, which is on the world for the same
   * reason `run.done` was rather than in a module-level variable: it must not
   * survive into the next world. */
  assert(/world\._recorded\b/.test(body),
    'the lifted record() no longer consults world._recorded — nothing stops a death and its own '
    + 'card writing the same run twice');
  // eslint-disable-next-line no-new-func
  const make = new Function('scope', 'recordRun', 'sessionOr', 'settings',
    `const world = scope.world;\n${body}\nreturn record;`);
  // Rebuilt per call so `const world = scope.world` re-reads the live world,
  // exactly as main.js's own module-level `world` binding does.
  return { body, record: (...a) => make(scope, recordRun, () => mode, settings)(...a) };
}

export async function run({ check, assert }) {
  check('history: dying and taking the death card\'s own exit records one run, not two', async () => {
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'colosseum', settings: { mode: 'roguelite', difficulty: 'knight' } });
    world.director.start(1);
    for (let i = 0; i < 60; i++) world.update(1 / 60, H.idleInput());

    const written = [];
    const scope = { world };
    // The real store is not touched: `recordRun` is where the += lives, and
    // what it is handed is what the store would get.
    const { record } = liftRecord(await mainSrc(), assert, {
      scope,
      recordRun: (s) => { written.push(s); },
      mode: 'roguelite',
      settings: { order: 'jedi', species: 'human' },
    });

    /**
     * A RUN IS AN OBJECT WITH A LADDER IN IT, NOT A FIELD CALLED `run`.
     *
     * This read `!world.run`, and it went stale the day `World`'s constructor
     * gained `this.run = run || {}` — run-scoped inputs, "never persisted",
     * which is a bag of settings and not the `Run.js` that was deleted with
     * the Descent. An empty object is truthy, so the check had been red on a
     * tree where nothing was wrong, and the sentence it failed with sent every
     * reader looking for a resurrection that had not happened.
     *
     * What the dedupe actually has to work without is the LADDER: `_setPiece`
     * is the one reader of a real one and it asks for `run.rung.boss` and
     * `run.done`, so those two are what "a Run is back" means. Asked of the
     * shape rather than of the name, which is also what makes this survive the
     * next field somebody hangs there.
     */
    assert(!world.run?.rung && world.run?.done === undefined,
      'a Run with a ladder in it is back: this check is about the dedupe that has to work '
      + 'without one, and `_setPiece` is what reads `rung`/`done`');

    // gameOver's call, then the death card's "Return to the Temple" → quitToMenu.
    record({ wave: 3, score: 4200, kills: 11 });
    const afterDeath = written.length;
    record();
    assert(afterDeath === 1, `the death itself wrote ${afterDeath} record(s)`);
    assert(written.length === 1,
      `dying and then clicking "Return to the Temple" on that same card wrote ${written.length} runs to `
      + 'the store — the menu\'s only line of history says "2 runs" after a player\'s first, and the '
      + 'forty-entry recent list holds two copies of it');

    // …and it is not simply refusing to record: a NEW world is a new session.
    const { world: second } = await H.bootWorld({ level: 'colosseum', settings: { mode: 'roguelite', difficulty: 'knight' } });
    scope.world = second;
    record({ wave: 5, score: 900, kills: 2 });
    assert(written.length === 2,
      'the next session left no trace at all — the guard is on the process rather than on the world, '
      + 'so a player only ever gets one run in their history');
    assert(written[0].wave === 3 && written[1].wave === 5, 'the two records are not the two sessions');
    world.unload(); world.dispose?.();
    second.unload(); second.dispose?.();
    return `two calls on one world → ${afterDeath} record; a second world → ${written.length} records`;
  });

  check('history: the real store counts what it is handed once per session', async () => {
    /**
     * The half above proves main.js calls `recordRun` once. This proves what
     * `recordRun` does with two calls, because the finding's headline is a
     * number the player reads off the menu — and only some of those totals
     * double. Driven against the real Progress module and a real localStorage
     * shim so the arithmetic is the shipped arithmetic.
     */
    const { recordRun, progressLines } = await import('../../src/game/Progress.js');
    const KEY = 'saber.progress.v1';
    const had = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    try {
      const summary = { wave: 1, score: 300, kills: 4, mode: 'roguelite',
        identity: { order: 'jedi', species: 'human' }, boons: [] };
      const once = recordRun({ ...summary });
      assert(once.runs === 1, `one run recorded as ${once.runs}`);
      const twice = recordRun({ ...summary });
      assert(twice.runs === 2,
        'recordRun is idempotent by itself, so the guard in main.js is not what stops the double count');
      assert(twice.recent.length === 2, `${twice.recent.length} entries in recent for one run recorded twice`);
      assert(twice.byMode.roguelite === 1,
        `byMode took ${twice.byMode.roguelite} for a depth of 1 — it is a Math.max and must not add`);
      const line = progressLines(twice)[0];
      assert(/2 runs/.test(line),
        `the menu line reads "${line}" — this check is calibrated on it saying "2 runs" for two records`);
      return `recordRun doubles runs/kills/recent and maxes byMode: "${line}"`;
    } finally {
      if (had === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    }
  });
}
