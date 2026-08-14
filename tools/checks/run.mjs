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
import { Run, DESCENT, SPIRE, LANDING_HEAL } from '../../src/game/Run.js';
import { recordRun, loadProgress, clearProgress, progressLines } from '../../src/game/Progress.js';

export async function run({ check, assert }) {
  check('run: the Descent ends, and every rung is somewhere the game can go', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    assert(SPIRE === DESCENT, 'the alias World.js and main.js import no longer points at the ladder');
    assert(DESCENT.length >= 3, `a ladder of ${DESCENT.length} is not a descent`);
    for (const t of DESCENT) {
      assert(LEVELS[t.level], `rung "${t.id}" wants level "${t.level}", which does not exist`);
      assert(t.waves > 0, `rung "${t.id}" asks for no waves`);
      assert(t.brief && t.name, `rung "${t.id}" has no name or brief to show`);
    }
    // IT HAS TO END. That is the whole point.
    const r = new Run({ seed: 1 });
    let guard = 0;
    while (r.ascend() && guard++ < 500);
    assert(guard < 500, 'the ladder never terminates — that is the endless wave spawner again');
    assert(r.done && r.won, 'finishing the last rung does not end the run as a win');
    return `${DESCENT.length} rungs, ${DESCENT.reduce((n, t) => n + t.waves, 0)} waves, and it finishes`;
  });

  check('run: the descent goes DOWN, and the light tells you so', () => {
    /* RE-DERIVED, and it is a strictly stronger statement than the one it
     * replaces — which is what a check has to be when the thing it measures
     * genuinely changes direction.
     *
     * The old form was "the climb goes UP, and the air tells you so": altitude
     * rising, fog thinning, sun strengthening, and the bottom rung's air at
     * least 3× the top's. Every one of those is a monotonicity claim about the
     * ladder's atmosphere, and every one of them survives here with its sign
     * flipped — depth deepening, air thickening, sun failing.
     *
     * What is ADDED, and could not be asked of the Spire at all, is the last
     * two assertions. A climb has no equivalent of them: however bright the
     * crown got, the foundations were still a lit place, so "the story is
     * told" was never falsifiable beyond the ordering. A descent's story ends
     * somewhere specific — a room where the player's own weapon is the only
     * light in it — and that is a NUMBER: the whole authored light budget of
     * the last rung, key plus ambient plus fill, against the first rung's. If
     * anybody ever quietly raises the bottom's key to make it easier to see,
     * this fails, which is the entire reason it is here.
     */
    let lastAlt = Infinity, lastFog = -Infinity, lastSun = Infinity, lastAmb = Infinity;
    const rows = [];
    for (const t of DESCENT) {
      assert(t.altitude < lastAlt, `rung "${t.id}" is not below the one above it`);
      assert(t.air.fogDensity > lastFog,
        `rung "${t.id}" has clearer air than the rung above — the deeper room is the better ventilated one`);
      assert(t.air.sunIntensity < lastSun,
        `rung "${t.id}" gets more of somebody else's light than the one above it`);
      assert(t.air.ambient <= lastAmb,
        `rung "${t.id}" has more ambient than the rung above it`);
      lastAlt = t.altitude; lastFog = t.air.fogDensity;
      lastSun = t.air.sunIntensity; lastAmb = t.air.ambient;
      rows.push(`${t.id} ${t.altitude}m fog ${t.air.fogDensity} sun ${t.air.sunIntensity}`);
    }
    const top = DESCENT[0], bot = DESCENT[DESCENT.length - 1];
    assert(bot.air.fogDensity / top.air.fogDensity > 2,
      `the deeps' air is only ${(bot.air.fogDensity / top.air.fogDensity).toFixed(1)}x the intake's — `
      + 'the descent does not get into anything');
    // THE BOTTOM IS LIT BY YOU. Everything the level authors is counted, so a
    // rung cannot pass this by moving its light from `sunIntensity` to
    // `ambient` or into the fill.
    const budget = (t) => t.air.sunIntensity + t.air.ambient * 3 + (t.air.fillIntensity ?? 0);
    assert(budget(bot) / budget(top) < 0.06,
      `the deepest rung carries ${(budget(bot) / budget(top) * 100).toFixed(0)}% of the top's `
      + 'light budget — that is a dim room, not a dark one');
    assert(bot.air.sunIntensity < 0.25 && bot.air.ambient < 0.06,
      `the bottom of the descent still runs a key of ${bot.air.sunIntensity} and ${bot.air.ambient} `
      + 'of ambient — nothing down there is being lit by a lightsaber');
    // …and the exposure is what keeps it readable, rather than the key being
    // raised back up. A dark room whose curve was not opened is a black frame.
    assert((bot.air.exposure ?? 1) > (top.air.exposure ?? 1) * 1.3,
      'the deepest rung did not open its tone curve, so nothing in it will read at all');
    return rows.join(' | ') + ` | light budget ${(budget(bot) / budget(top) * 100).toFixed(1)}%`;
  });

  check('run: the descent is one building, and two rungs prove it', async () => {
    /* The claim the Spire could never make and the reason this ladder reads.
     * Altitude cannot be seen from inside a place; DEPTH can, if the places
     * are the same place. Two properties, both structural:
     *
     *   the rooms share a palette and a shell, which here means they share a
     *   terrain preset family — the intake and the foundry stand on the same
     *   poured floor with the same colours, so arriving in the second is
     *   evidence of having gone down rather than of having travelled;
     *
     *   and at least one level is entered TWICE at different depths, which is
     *   the mechanism the ladder is built on ("a rung borrows a level and
     *   changes only its air") used for the one thing it is uniquely good at.
     */
    const { LEVELS } = await import('../../src/game/Levels.js');
    const { TERRAIN_PRESETS } = await import('../../src/world/Terrain.js');
    const seen = new Map();
    for (const t of DESCENT) seen.set(t.level, (seen.get(t.level) ?? 0) + 1);
    const repeated = [...seen.values()].filter((n) => n > 1).length;
    assert(repeated >= 1,
      'no room in the descent is revisited deeper — the light story has nothing to act on');
    // every rung is indoors: a descent that surfaces is not a descent
    for (const t of DESCENT) {
      assert(LEVELS[t.level].atmosphere.sky === false,
        `rung "${t.id}" draws a sky dome — you are not underground`);
    }
    // and the ground is the same ground: same base colour family, so the
    // rooms read as one building rather than as a tour of four places
    const base = DESCENT.map((t) => TERRAIN_PRESETS[LEVELS[t.level].terrain].sandColor);
    const hue = (c) => {
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 1e-6) return 0;
      const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return h * 60;
    };
    const hs = base.map(hue);
    const spread = Math.max(...hs) - Math.min(...hs);
    assert(spread < 30,
      `the descent's floors span ${spread.toFixed(0)}° of hue (${hs.map((h) => h.toFixed(0)).join(', ')}) — `
      + 'four unrelated grounds in a row is a tour, not one building');
    return `${seen.size} rooms over ${DESCENT.length} rungs, ${spread.toFixed(0)}° of hue between their floors`;
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

  /* ══ the wire — everything above existed with no callers ═══════════════ */

  check('run: something actually STARTS a run, ascends it, and records it', async () => {
    // The whole of Run.js and Progress.js shipped with zero callers. `new Run`
    // appeared nowhere, `recordRun` appeared nowhere, and World imported only
    // SPIRE — so the climb existed as a data structure and could not be played.
    // Every assertion here fails on that tree.
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    assert(/new Run\(/.test(main), 'nothing in main.js ever constructs a Run — the Spire is unreachable');
    assert(/recordRun\(/.test(main), 'no run is ever recorded, so a finished climb leaves nothing behind');
    assert(/onRungClear/.test(main), 'nothing listens for a rung being cleared, so there is no landing');
    assert(/\.ascend\(\)/.test(main), 'nothing ever ascends, so the climb has one tier');
    // …and the mode has to mean it. `gauntlet` fell straight through to the
    // generic path for the whole life of the menu.
    assert(/gauntlet/.test(main), 'main.js never mentions the gauntlet, so the mode still falls through');
    // A run is created for the SPIRE only: handing every mode a Run silently
    // changes what "abandon" means in all of them.
    const i = main.indexOf('function startRun');
    assert(i > 0, 'there is no single place a run begins');
    /* The mode may be read off `settings` or through a session accessor, so the
     * pattern is on the COMPARISON and not on the expression in front of it —
     * the co-op lane changed `settings.mode` to `sessionOr('mode')` and this
     * went red for a rename. What must stay true is that the climb is the only
     * mode that gets a Run. */
    assert(/mode'?\)?\s*!== 'gauntlet'/.test(main.slice(i, i + 400)),
      'a run is created for every mode, not only the climb');
    return 'main.js starts a run, lands between rungs, ascends, and records the result';
  });

  check('run: the world says when a rung is done, and only the host says it', async () => {
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const i = world.indexOf('onWaveClear = ');
    assert(i > 0, 'onWaveClear is gone');
    const body = world.slice(i, i + 1600);
    assert(/onRungClear/.test(body), 'clearing the last wave of a rung signals nothing');
    // The ladder lives on one side. A client reconstructing "was that the last
    // wave of this tier" from a wave number and a table is a second copy of it.
    assert(/rung\?\.waves|rung\.waves/.test(body),
      'the rung length is not consulted where the rung is judged complete');
    assert(/netMode !== 'client'/.test(body),
      'a joining client can declare the rung cleared, so two peers would climb the ladder twice');
    return 'the host alone fires onRungClear, off the rung\'s own length';
  });

  check('run: a landing carries health forward as a fraction of a moving maximum', () => {
    // maxHp is itself a thing boons move, so carrying a raw number silently
    // undoes Vitality at every landing. And a landing must heal SOME but not
    // ALL, or the rung just survived stops mattering to the one above it.
    assert(LANDING_HEAL > 0 && LANDING_HEAL < 1,
      `LANDING_HEAL is ${LANDING_HEAL} — at 0 a bad rung ends a run four tiers later, at 1 no rung costs anything`);
    const r = new Run({ seed: 7 });
    r.hpFrac = 0.10;
    r.ascend();
    const after = r.hpFrac;
    assert(after > 0.10, 'a landing healed nothing');
    assert(after < 1, 'a landing is a full heal, so the tier below it was free');
    // …and it must never exceed full, however many landings there are.
    for (let i = 0; i < 20; i++) r.hpFrac = Math.min(1, r.hpFrac + LANDING_HEAL);
    assert(r.hpFrac <= 1, `health carried past full: ${r.hpFrac}`);
    return `0.10 → ${after.toFixed(2)} on a landing, clamped at 1.0 across twenty of them`;
  });

  check('run: winning counts the tier you won on', () => {
    // `ascend` zeroed `wave` before deciding whether there was another rung, so
    // the crown's own waves fell out of `depth` — a full climb recorded itself
    // as the sum of every tier BUT the last, on the one screen whose whole job
    // is to say how far you got. Caught by walking a climb, not by reading it.
    const total = SPIRE.reduce((n, t) => n + t.waves, 0);
    const r = new Run({ seed: 11 });
    let guard = 0;
    while (guard++ < 50) {
      r.wave = r.rung.waves;
      if (!r.ascend()) break;
    }
    assert(r.won, 'the climb did not finish');
    assert(r.depth === total,
      `a full climb of ${total} waves recorded depth ${r.depth} — the crown's ${SPIRE[SPIRE.length - 1].waves} waves are missing`);
    // and a run that dies partway still counts what it did climb
    const d = new Run({ seed: 12 });
    d.wave = d.rung.waves; d.ascend();
    d.wave = 2;
    assert(d.depth === SPIRE[0].waves + 2, `a partial climb reported ${d.depth}`);
    return `full climb = ${r.depth} waves (all ${SPIRE.length} rungs), partial = ${d.depth}`;
  });

  check('run: ranks survive a landing exactly, instead of being refunded or doubled', () => {
    // THE ONE THAT WOULD HAVE BITTEN. `Run.boons` is replayed into a freshly
    // built player at every landing, and `Player.applyBoon` counts its own
    // ranks as it goes. So the run's list must keep REPEATS: deduplicating it
    // would hand back rank 1 four rungs running, and `unload()` not clearing
    // World.takenBoons would have counted every carried rank again per rung.
    const r = new Run({ seed: 3 });
    const vit = { id: 'vitality', stack: 4 };
    for (let i = 0; i < 6; i++) r.take(vit);
    assert(r.rank('vitality') === 4,
      `six takes of a 4-stack card left ${r.rank('vitality')} ranks — the cap is not enforced on the run`);
    assert(r.boons.length === 4, `the run stored ${r.boons.length} entries for 4 ranks — replay would drift`);
    const unranked = { id: 'lightning' };
    r.take(unranked); r.take(unranked);
    assert(r.rank('lightning') === 1, 'an unranked card stacked, so a second Force Lightning is a card');
    return '4 ranks kept as 4 entries, capped, and unranked cards still take once';
  });

  check('run: the taken-set is rebuilt on a level change, not appended to', async () => {
    // `unload()` disposes the world; the taken-set is not part of the world, so
    // it survived and spawnPlayer re-added every carried boon to a set that
    // already held it. Harmless while ids could only be present once. Fatal
    // with ranks: a four-rung climb counted a rank-2 Vitality as rank 8.
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const i = world.indexOf('  loadLevel(');
    const body = world.slice(i, i + 1800);
    assert(/takenBoons = new RankSet\(\)/.test(body),
      'loadLevel does not rebuild takenBoons, so every carried rank is counted again on every landing');
    const unloadAt = body.indexOf('this.unload()');
    const resetAt = body.indexOf('takenBoons = new RankSet()');
    assert(unloadAt >= 0 && resetAt > unloadAt,
      'the taken-set is rebuilt before unload, which is the wrong side of the thing that clears the world');
    return 'takenBoons rebuilt after unload, refilled from the order and the run';
  });
}
