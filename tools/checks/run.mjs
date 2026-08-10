/**
 * A run with a shape, and a record that it happened. — src/game/Run.js, Progress.js
 *
 * Two absences, both structural rather than buggy, and both invisible from
 * inside the code because nothing was broken — there simply was no object.
 *
 *   `WaveDirector.update()` ends by calling `start(this.wave + 1)`. Forever.
 *   No win condition, no final wave, no ending. `gauntlet` has been in the
 *   mode list since the menu was written, promising "a fixed ladder of
 *   set-pieces, ending in a boss", with zero implementation behind it.
 *
 *   `World.loadLevel` opens with `unload()`, which disposes every player — so
 *   `boonMods`, `maxHp`, the taken boons and the score died with the level.
 *   There was nowhere to put a run, so every level was a separate arena.
 *
 * These pin the things that must stay true of the fix, and the first one is the
 * one that matters: a run must be able to cross a level change without losing
 * what it earned.
 */
import { Run, SPIRE, LANDING_HEAL } from '../../src/game/Run.js';
import { recordRun, loadProgress, clearProgress, progressLines } from '../../src/game/Progress.js';

export async function run({ check, assert }) {
  check('run: the Spire ends, and every rung is somewhere the game can go', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    assert(SPIRE.length >= 3, `a ladder of ${SPIRE.length} is not a climb`);
    for (const t of SPIRE) {
      assert(LEVELS[t.level], `rung "${t.id}" wants level "${t.level}", which does not exist`);
      assert(t.waves > 0, `rung "${t.id}" asks for no waves`);
      assert(t.brief && t.name, `rung "${t.id}" has no name or brief to show`);
    }
    // IT HAS TO END. That is the whole point.
    const r = new Run({ seed: 1 });
    let guard = 0;
    while (r.ascend() && guard++ < 500);
    assert(guard < 500, 'the climb never terminates — that is the endless wave spawner again');
    assert(r.done && r.won, 'finishing the last rung does not end the run as a win');
    return `${SPIRE.length} rungs, ${SPIRE.reduce((n, t) => n + t.waves, 0)} waves, and it finishes`;
  });

  check('run: the climb goes UP, and the air tells you so', () => {
    // The ascent is not geometry — terrain is a single heightfield and cannot
    // have floors. It is altitude, told by the weather, so the weather has to
    // actually change monotonically or the story is not being told.
    let lastAlt = -1, lastFog = Infinity, lastSun = -1;
    const rows = [];
    for (const t of SPIRE) {
      assert(t.altitude > lastAlt, `rung "${t.id}" is not above the one below it`);
      assert(t.air.fogDensity < lastFog,
        `rung "${t.id}" has thicker air than the rung below — you are climbing INTO the weather`);
      assert(t.air.sunIntensity > lastSun,
        `rung "${t.id}" gets less sun than the one below it`);
      lastAlt = t.altitude; lastFog = t.air.fogDensity; lastSun = t.air.sunIntensity;
      rows.push(`${t.id} ${t.altitude}m fog ${t.air.fogDensity} sun ${t.air.sunIntensity}`);
    }
    // and the top must actually break out of it
    const top = SPIRE[SPIRE.length - 1], bot = SPIRE[0];
    assert(bot.air.fogDensity / top.air.fogDensity > 3,
      `the foundations are only ${(bot.air.fogDensity / top.air.fogDensity).toFixed(1)}x the crown's air — `
      + 'the climb does not break through anything');
    return rows.join(' | ');
  });

  check('run: what you earned survives the rung you earned it on', () => {
    // The defect this exists for. A run carries BOON OBJECTS rather than the
    // derived boonMods, because re-applying them to a freshly built player is
    // what crossing a level change means — and a derived snapshot would drift
    // the first time a boon's effect changed.
    const r = new Run({ seed: 7 });
    r.take({ id: 'vaapad' }); r.take({ id: 'ataru' });
    r.take({ id: 'vaapad' });                       // a draft cannot be taken twice
    r.score = 900; r.kills = 12; r.hpFrac = 0.2;
    const before = r.boons.map((b) => b.id).join(',');
    r.ascend();
    assert(r.boons.map((b) => b.id).join(',') === before,
      'the boons did not survive the landing');
    assert(r.boons.length === 2, `taking the same boon twice produced ${r.boons.length} entries`);
    assert(r.score === 900 && r.kills === 12, 'score or kills reset at the landing');
    assert(r.tier === 1, 'the run did not move up a rung');
    return `2 boons, 900 score and 12 kills across a landing`;
  });

  check('run: a landing gives back some of you, not all of you', () => {
    // A full heal makes the rung you just survived irrelevant; nothing at all
    // ends a run four tiers later for reasons the player cannot see.
    assert(LANDING_HEAL > 0.15 && LANDING_HEAL < 0.85,
      `a landing heals ${LANDING_HEAL} — that is either free or pointless`);
    const r = new Run({ seed: 3 });
    r.hpFrac = 0.1; r.ascend();
    assert(r.hpFrac > 0.1 && r.hpFrac < 1, `a landing took hp from 0.1 to ${r.hpFrac}`);
    r.hpFrac = 0.95; r.ascend();
    assert(r.hpFrac <= 1, `a landing pushed hp to ${r.hpFrac}`);
    // and it is a FRACTION, because maxHp is a thing boons move: carrying a raw
    // number would silently undo Vitality across a landing.
    return `heals ${(LANDING_HEAL * 100).toFixed(0)}% of max, clamped, as a fraction`;
  });

  check('run: depth counts the whole climb, not the current rung', () => {
    const r = new Run({ seed: 5 });
    r.wave = 2;
    assert(r.depth === 2, `depth on the first rung reads ${r.depth}`);
    r.ascend(); r.wave = 1;
    assert(r.depth === SPIRE[0].waves + 1,
      `after one landing and one wave, depth reads ${r.depth} instead of ${SPIRE[0].waves + 1}`);
    return `depth spans rungs (${r.depth} after ${SPIRE[0].waves} + 1)`;
  });

  check('progress: a record, and specifically NOT a currency', async () => {
    // The design says runs are built and not saved, and that is right. But
    // refusing to sell progress is not the same as refusing to remember it,
    // and this project was doing the second by accident.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Progress.js', import.meta.url), 'utf8');
    for (const word of ['unlock', 'currency', 'purchase', 'xp']) {
      // the words appear in the header explaining what is NOT here; what must
      // not appear is a stored balance
      assert(!new RegExp(`\\b${word}s?\\s*[:=]`, 'i').test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
        `Progress.js stores a "${word}" — a record is not a currency`);
    }
    return 'stores depth, kills and history; stores nothing that buys power';
  });

  check('progress: it survives a run, and a broken store is a fresh start', () => {
    // A record is not worth a crash: anything malformed has to read as "no runs
    // yet", silently, or a number the player never saw stops the game opening.
    const store = {};
    // SAVE IT, do not delete it. The dom shim installs a localStorage that
    // other suites use, and these checks run concurrently — deleting the global
    // in a `finally` took it out from under two of them, which failed with
    // "localStorage is not defined" in files that had nothing to do with this.
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    try {
      clearProgress();
      assert(loadProgress().runs === 0, 'a cleared record is not empty');
      recordRun({ depth: 9, tier: 2, score: 400, kills: 30, won: false,
        boons: ['ataru'], identity: { order: 'grey', species: 'zabrak' } });
      recordRun({ depth: 16, tier: 3, score: 900, kills: 61, won: true,
        boons: ['ataru', 'vaapad'], identity: { order: 'sith', species: 'human' } });
      const p = loadProgress();
      assert(p.runs === 2, `two runs recorded as ${p.runs}`);
      assert(p.wins === 1 && p.bestDepth === 16 && p.kills === 91,
        `record reads wins ${p.wins}, depth ${p.bestDepth}, kills ${p.kills}`);
      assert(p.byOrder.grey === 9 && p.byOrder.sith === 16, 'the record does not track what you did it WITH');
      assert(progressLines(p).length >= 2, 'the record cannot be shown to anyone');
      // and the malformed case
      store['saber.progress.v1'] = '{not json';
      assert(loadProgress().runs === 0, 'a corrupt record throws instead of starting fresh');
    } finally {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
      else delete globalThis.localStorage;
    }
    return '2 runs, 1 ascent, deepest 16, tracked by order; corrupt store reads as empty';
  });

  check('run: a landing carries the run across loadLevel, which disposes players', async () => {
    // THE KEYSTONE, and the reason the Spire could not exist before. `unload()`
    // disposes every player and takes boonMods, maxHp, the taken boons and the
    // score with it — so a level change was a restart, and every level was a
    // separate arena rather than a place in a longer journey.
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');

    const i = world.indexOf('  loadLevel(key');
    assert(i > 0, 'loadLevel is gone');
    const head = world.slice(i, i + 900);
    // The run must be read BEFORE unload, or unload clears the thing that was
    // supposed to survive it.
    const readAt = head.indexOf('opts.run');
    const unloadAt = head.indexOf('this.unload()');
    assert(readAt > 0 && unloadAt > 0, 'loadLevel does not take a run at all');
    assert(readAt < unloadAt,
      'the run is read AFTER unload() — unload is allowed to clear the world, so it would be gone');

    // and it has to be re-applied, as boons rather than as a snapshot
    const j = world.indexOf('  spawnPlayer(');
    const body = world.slice(j, j + 2600);
    assert(/this\.run/.test(body), 'spawnPlayer never looks at the run');
    assert(/applyBoon\(/.test(body), 'the run\'s boons are not re-applied to the new player');
    assert(/hpFrac/.test(body), 'health does not carry across a landing');
    // order BEFORE boons: the order starts the numbers, a boon multiplies them
    const orderAt = body.indexOf('applyOrder(');
    const boonAt = body.indexOf('applyBoon(');
    assert(orderAt > 0 && orderAt < boonAt,
      'boons are applied before the order, so the order overwrites what the run earned');
    return 'run read before unload, boons re-applied after the order, hp as a fraction';
  });

  check('run: a rung borrows a level and changes only its air', async () => {
    // The Spire has no levels of its own — it takes an existing one and moves
    // it up. So the merge has to reach BOTH the atmosphere and the weather, or
    // the climb is four identical arenas with different names.
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    assert(/\.\.\.rung\.air/.test(world), 'a rung does not change the atmosphere it borrows');
    assert(/\.\.\.rung\.weather/.test(world), 'a rung does not change the weather it borrows');
    // and the merge must be OVER the level, not under it
    const k = world.indexOf('applyAtmosphere(');
    const line = world.slice(k, k + 140);
    assert(line.indexOf('L.atmosphere') < line.indexOf('rung.air'),
      'the level is merged over the rung, so the climb is overwritten by the place it borrowed');
    return 'air and weather both merged over the borrowed level';
  });
}
