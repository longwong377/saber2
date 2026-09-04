/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE REPEATING ROOM — is it actually a REPLACEMENT? (V16 Lane A2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The ask was *"a holodeck/dojo that replaces the training and sandbox menus"*,
 * and the one way this lane can fail while looking finished is by ADDING a
 * room and leaving the tab beside it. A player would never find the room; the
 * tab is two clicks from the title screen. So the first thing measured here is
 * absence, and the rest is that nothing was lost in the move:
 *
 *   · the Training tab and both mode cards are gone from the menu
 *   · every rung of `LESSONS` is a program, so the room teaches what the tab
 *     taught — counted against `Dojo.js` rather than against a memory of it
 *   · all seven dials the panel carried are on a program
 *   · a program run files nothing in `saber.progress.v1`, whatever it is
 *   · two readers of one program build the same room
 *   · nothing unheld can be run
 *   · #57's silhouette clears rule 4 on deck 48, on `station.mjs`'s own raster
 *
 * WHY THE LESSON COUNT IS DERIVED AND NEVER TYPED. `Holodeck.programs` takes
 * `LESSONS` as an argument precisely so there is no second list of rungs in
 * the tree (see that file's header); a check that asserted "there are ten
 * programs" would put the second list HERE instead, which is the same defect
 * one file further out.
 */

import { readFile } from 'node:fs/promises';
import { LESSONS } from '../../src/game/Dojo.js';
import { MODES, playableModes, SANDBOX_MAX_ENEMIES, sandboxConfig } from '../../src/game/Waves.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { LEVELS } from '../../src/game/Levels.js';
import { DEFAULT_SETTINGS } from '../../src/ui/Menu.js';
import { PLACE } from '../../src/game/StationPlan.js';
import { SHAPES } from '../../src/game/StationKit.js';
import * as H from '../../src/game/Holodeck.js';

const src = (f) => new URL(`../../src/${f}`, import.meta.url);
const read = (f) => readFile(src(f), 'utf8');
/* Comments are prose and may say anything; only code counts. The same strip
 * `station.mjs`'s §9.2 grep uses, and for its reason: this file's whole
 * subject is a deletion, and a deletion is normally recorded in a comment
 * right where the thing used to be. */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const KEY = 'saber.progress.v1';
/** Run `fn` against an empty store and put the player's own back afterwards. */
async function withCleanStore(fn) {
  const had = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
  try { return await fn(); }
  finally { if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had); }
}

/** Everything cleared: the hold a player has after walking the whole ladder. */
const fullHold = () => ({ cleared: LESSONS.map((l) => l.id) });

export async function run({ check, assert, THREE }) {

  /* ════════════════════════════════════════════════════════════════════════
   *  THE REPLACEMENT — the half that is a deletion
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: the Training tab and both mode cards are gone from the menu', async () => {
    const menu = code(await read('ui/Menu.js'));
    /* By the strings the panel was actually built out of. `_buildTraining`
     * assigned `dataset.tab = 'training'` and `dataset.panel = 'training'` and
     * created six controls; any one of them surviving means the tab survived,
     * because none of them exists anywhere else. */
    const gone = ['_buildTraining', "dataset.tab = 'training'", "dataset.panel = 'training'",
      'btn-lessons', 'btn-sandbox', 'opt-sandbox-count', 'opt-sandbox-fire',
      'opt-train-bladelen', 'opt-sandbox-type', 'opt-unlimited-blade', 'opt-unlimited-focus'];
    const left = gone.filter((g) => menu.includes(g));
    assert(left.length === 0,
      `the tab is still there: ${left.join(', ')} — a room beside the tab it replaces is a room nobody opens`);

    /* AND THE DEPLOY LIST. `playableModes` is the one derivation of "a mode a
     * player picks", so this is the same question the mode-card builder asks. */
    const picks = playableModes();
    for (const k of ['training', 'sandbox']) {
      assert(MODES[k], `MODES.${k} was deleted — the room needs the mode, only not the card`);
      assert(!picks.includes(k), `${k} is still a card on the Deploy panel`);
    }
    /* …and the rows themselves are intact, because the room deploys through
     * them. A mode hidden AND gutted is a mode that does not work. */
    assert(MODES.training.dojo === true, 'MODES.training stopped declaring the dojo');
    assert(MODES.sandbox.insertion === false && MODES.training.insertion === false,
      'a practice room grew a 28-second orbital descent again');
    return `${gone.length} tab artefacts gone; ${picks.length} cards on Deploy, neither of them training or sandbox`;
  });

  check('holodeck: the room is the only door, and it names no mode to be one', async () => {
    const st = code(await read('game/Station.js'));
    assert(/place\.id === 57 && world\.onHolodeck/.test(st),
      'stationKey has no branch for #57 — the room has no door');
    /* §9.2 again, locally: `station.mjs` greps every Station* file for a mode
     * comparison and this branch is new code in one of them. The room raises
     * an id; `Holodeck.programSettings` is what knows what a mode is, and it
     * is not a station file. */
    for (const m of ['training', 'sandbox']) {
      assert(!new RegExp(`mode\\s*===?\\s*['"\`]${m}`).test(st),
        `Station.js branches on the mode '${m}' — §9.2 forbids it`);
    }
    const place = PLACE.get(57);
    assert(place, 'there is no #57 in the gazetteer');
    assert(place.shape === 'latticecell' && SHAPES.latticecell,
      `#57 declares shape '${place.shape}' and StationKit has no builder for it`);
    assert(place.deck === 48, `#57 is on deck ${place.deck}`);
    assert(place.verb && /program/i.test(place.verb), `#57's verb is "${place.verb}"`);
    return `#57 ${place.name}, deck ${place.deck}, ${place.w}×${place.d}×${place.h} m, peak ${place.peak}:00`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE DOJO HALF — what the tab taught, the room must still teach
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: every lesson the training tab taught is a program in the rack', async () => {
    const rack = H.programs(LESSONS);
    const lessons = rack.filter((p) => p.kind === 'lesson');
    assert(lessons.length === LESSONS.length,
      `${LESSONS.length} rungs in Dojo.js and ${lessons.length} lesson programs in the rack`);
    for (const l of LESSONS) {
      const p = rack.find((r) => r.lesson === l.id);
      assert(p, `nothing in the room teaches '${l.id}' (${l.title}) — the tab did`);
      assert(p.mode === 'training',
        `'${l.id}' runs in mode '${p.mode}', which does not build a DojoDirector`);
      assert(LEVELS[p.ground], `'${l.id}' is set on '${p.ground}', which is not a level`);
      /* A ground chosen rather than defaulted. The table is keyed by lesson id
       * so a rung added to Dojo.js gets a deliberate ground on the commit that
       * adds it — this is the line that makes the silence fail. */
      assert(H.LESSON_GROUND[l.id],
        `'${l.id}' has no entry in LESSON_GROUND and fell to the fallback — pick its ground`);
    }
    /* AND THE ROOM CAN ACTUALLY OPEN ON THE RUNG IT NAMES, which is the half
     * that is not in this file: `DojoDirector.start` reads `settings.lesson`,
     * and a rack whose rows all opened at rung 0 would be a rack of one row. */
    assert('lesson' in DEFAULT_SETTINGS, 'settings has no `lesson` for a program to write');
    const dojo = code(await read('game/Dojo.js'));
    assert(/settings\?\.lesson/.test(dojo) && /LESSONS\.findIndex/.test(dojo),
      'DojoDirector.start does not open on the rung the room asked for');
    const grounds = new Set(lessons.map((p) => p.ground));
    return `${lessons.length} lessons, all reachable, over ${grounds.size} grounds (${[...grounds].join(', ')})`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE SANDBOX HALF — every dial the panel carried
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: every dial the sandbox tab exposed is on a program', () => {
    /* THE SEVEN, RE-DERIVED FROM THE SETTINGS RATHER THAN FROM THE PANEL,
     * because the panel is deleted and a check cannot read a deleted file.
     * These are the keys `sandboxConfig` reads plus the three the Blade column
     * carried, and every one of them is in DEFAULT_SETTINGS — so the list can
     * be held to something that still exists. */
    const WERE_ON_THE_TAB = ['sandboxCount', 'sandboxFire', 'sandboxType', 'sandboxMix',
      'bladeLength', 'unlimitedBlade', 'unlimitedFocus'];
    for (const k of WERE_ON_THE_TAB) {
      assert(k in DEFAULT_SETTINGS, `${k} is not a setting any more — the tab's dial was deleted, not moved`);
      assert(k in H.DIALS, `${k} was on the tab and is not a dial a program can name`);
    }
    assert(H.DIAL_KEYS.length === WERE_ON_THE_TAB.length,
      `the room names ${H.DIAL_KEYS.length} dials for the tab's ${WERE_ON_THE_TAB.length}`);

    const rack = H.programs(LESSONS);
    const open = rack.filter((p) => p.kind === 'open');
    assert(open.length >= 4, `only ${open.length} free-run programs — the sandbox half is thin`);
    /* Each dial has to be SET by at least one program, and set to something
     * other than the default at least once: a dial every program leaves at
     * stock is a dial that has been listed rather than moved. */
    const moved = new Set();
    for (const p of rack) {
      if (!p.dials) continue;
      for (const k of H.DIAL_KEYS) {
        if (!(k in p.dials)) continue;
        const a = JSON.stringify(p.dials[k]), b = JSON.stringify(DEFAULT_SETTINGS[k]);
        if (a !== b) moved.add(k);
      }
    }
    const inert = WERE_ON_THE_TAB.filter((k) => !moved.has(k));
    assert(inert.length === 0,
      `no program moves ${inert.join(', ')} off its default — the dial is named, not carried`);

    /* The one program that keeps the player's own numbers, which is what the
     * "Enter the sandbox" button actually did. */
    const own = rack.find((p) => p.dials === null);
    assert(own, 'no program hands the room back to the numbers the player left on it');
    const mine = { ...DEFAULT_SETTINGS, sandboxCount: 23, sandboxFire: 0.35, sandboxType: 'droideka' };
    const kept = H.programSettings(own, mine);
    assert(kept.sandboxCount === 23 && kept.sandboxFire === 0.35 && kept.sandboxType === 'droideka',
      'the free room overwrote the numbers it exists to preserve');

    /* AND A PROGRAM'S ROOM IS ONE `sandboxConfig` CAN ACTUALLY BUILD. */
    for (const p of open) {
      const cfg = sandboxConfig(H.programSettings(p, DEFAULT_SETTINGS));
      assert(cfg.count <= SANDBOX_MAX_ENEMIES, `${p.id} asks for ${cfg.count} bodies against a ceiling of ${SANDBOX_MAX_ENEMIES}`);
      const asked = p.dials ? Object.entries(p.dials.sandboxMix || {}) : [];
      for (const [k, n] of asked) {
        assert(ARCHETYPES[k], `${p.id} names '${k}', which is not a body in the game`);
        assert(cfg.mix.some((m) => m.type === k && m.n === n),
          `${p.id} asked for ${n} × ${k} and the room resolved to ${JSON.stringify(cfg.mix)}`);
      }
      assert(LEVELS[p.ground], `${p.id} is set on '${p.ground}', which is not a level`);
    }
    return `${H.DIAL_KEYS.length} dials, all moved by at least one of ${rack.length} programs; `
      + `${open.length} free rooms all resolve inside the ceiling`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE REFUSAL — a lesson taken in a room is still not a run
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: no program files a run in saber.progress.v1, however it is reached', async () => {
    const { recordRun, loadProgress } = await import('../../src/game/Progress.js');
    return withCleanStore(() => {
      const before = loadProgress();
      assert(before.runs === 0, 'the fixture did not start empty');
      const rack = H.programs(LESSONS);
      for (const p of rack) {
        const s = H.programSettings(p, DEFAULT_SETTINGS);
        /* The blob main.js would hand `recordRun` on the way out of a world
         * built from this program — a generous one, with a win and depth on
         * it, so the refusal is doing the work and not the numbers. */
        recordRun({ mode: s.mode, depth: 41, wave: 41, kills: 300, won: true, score: 99999,
          boons: [], identity: { order: 'jedi', species: 'human' } });
      }
      const after = loadProgress();
      assert(after.runs === 0 && after.kills === 0 && after.wins === 0 && after.bestDepth === 0,
        `${rack.length} programs filed ${after.runs} runs, ${after.kills} kills and a best depth of `
        + `${after.bestDepth} — Progress.js promises the lessons and the sandbox leave no record`);
      /* AND THE REASON IT HOLDS: only two mode names can ever come out of a
       * program, and `RECORDED` refuses both. A third would pass the loop
       * above only until somebody wrote a program on a mode that records. */
      const modes = new Set(rack.map((p) => H.programSettings(p, {}).mode));
      assert(modes.size === 2 && modes.has('training') && modes.has('sandbox'),
        `programs deploy into ${[...modes].join(', ')} — a mode outside those two can be lost, and would file`);
      return `${rack.length} programs, ${modes.size} modes, 0 runs recorded`;
    });
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  ONE VALUE, ONE ROOM
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: two readers of the same program get the same room', () => {
    const rack = H.programs(LESSONS);
    const base = { ...DEFAULT_SETTINGS, sandboxCount: 7, sandboxMix: { b1: 3 }, level: 'alpine', mode: 'roguelite' };
    for (const p of rack) {
      const a = H.programSettings(p, base);
      const b = H.programSettings(p, base);
      assert(JSON.stringify(a) === JSON.stringify(b), `${p.id} builds a different room on the second read`);
      /* …and a third from a FRESH rack, because the rack is regenerated at
       * every door — `programs()` is called by `rack`, `heldPrograms` and
       * `programById` — and a program that carried identity would make those
       * three different values with the same name. */
      const c = H.programSettings(H.programById(LESSONS, p.id), base);
      assert(JSON.stringify(a) === JSON.stringify(c), `${p.id} differs between two builds of the rack`);
      assert(a.level === p.ground, `${p.id} deployed onto '${a.level}' instead of its own ground`);
      assert(a.lesson === (p.lesson || null), `${p.id} carried lesson '${a.lesson}'`);
    }
    /* THE BASE IS NOT MUTATED, which is what lets main.js hold one settings
     * object and lets this check compare anything at all. */
    const snap = JSON.stringify(base);
    H.programSettings(rack[0], base);
    assert(JSON.stringify(base) === snap, 'programSettings wrote into the settings it was handed');
    /* And a lesson leaves the player's own room alone: `_applyLesson` rebuilds
     * the floor from the lesson's `setup` on the next line, so writing the
     * four room dials would cost the player their numbers for nothing. */
    const lesson = rack.find((p) => p.kind === 'lesson');
    const out = H.programSettings(lesson, base);
    for (const k of ['sandboxCount', 'sandboxFire', 'sandboxType', 'sandboxMix']) {
      assert(JSON.stringify(out[k]) === JSON.stringify(base[k]),
        `taking a lesson overwrote the player's ${k}`);
    }
    return `${rack.length} programs, each identical across three reads, base untouched`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE HOLD
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: nothing can be run that the player does not hold', () => {
    const blank = H.blankHold();
    const first = H.heldPrograms(LESSONS, blank);
    assert(first.length >= 1, 'a fresh player holds nothing at all — there is no way in');
    /* The ladder, walked one rung at a time, and every rung past the next one
     * is refused at every step. This is the assertion the whole gate rests on:
     * a `heldPrograms` that returned everything would pass every other line in
     * this check. */
    let hold = blank;
    const all = H.programs(LESSONS);
    for (let i = 0; i < LESSONS.length; i++) {
      const p = all.find((r) => r.lesson === LESSONS[i].id);
      assert(H.isHeld(p, hold), `rung ${i} ('${LESSONS[i].id}') is not held after clearing the ${i} before it`);
      for (let j = i + 1; j < LESSONS.length; j++) {
        const far = all.find((r) => r.lesson === LESSONS[j].id);
        assert(!H.isHeld(far, hold),
          `rung ${j} ('${LESSONS[j].id}') can be entered by a player who has not cleared rung ${j - 1}`);
      }
      const held = new Set(H.heldPrograms(LESSONS, hold).map((r) => r.id));
      assert(!held.has(all.find((r) => r.lesson === LESSONS[LESSONS.length - 1].id).id) || i === LESSONS.length - 1,
        'the last rung is in the held list before it has been earned');
      hold = H.clearLesson(hold, LESSONS[i].id);
    }
    /* Everything, once the ladder is walked. A gate that never opens is worse
     * than no gate. */
    assert(H.heldPrograms(LESSONS, hold).length === all.length,
      'a player who has cleared every lesson still cannot run every program');

    /* NOTHING THE TAB OFFERED HAS MOVED BEHIND THE GATE. The tab's two buttons
     * were "start the lessons at rung 0" and "enter the sandbox", both
     * available on a fresh profile, so both have to be in the blank hold. */
    const fresh = new Set(first.map((p) => p.id));
    assert(fresh.has(`lesson:${LESSONS[0].id}`), 'a fresh player cannot start the lessons');
    const freeOnFresh = first.filter((p) => p.kind === 'open');
    assert(freeOnFresh.length >= 2,
      `a fresh player gets ${freeOnFresh.length} free rooms — the sandbox used to be one button away`);
    assert(freeOnFresh.some((p) => p.dials === null),
      'the room built from the player\'s own numbers is behind a gate it never used to be behind');

    /* `clearLesson` is a ratchet and returns a new hold, so a caller cannot
     * lose one by holding a stale reference. */
    const once = H.clearLesson(blank, LESSONS[0].id);
    assert(blank.cleared.length === 0, 'clearLesson wrote into the hold it was handed');
    assert(H.clearLesson(once, LESSONS[0].id).cleared.length === 1, 'clearing twice counted twice');

    /* And the rack still PRINTS what is locked — a syllabus you cannot see is
     * not a syllabus. */
    const shown = H.rack(LESSONS, blank);
    assert(shown.length === all.length, 'the rack hides rows instead of marking them');
    assert(shown.some((r) => r.held === false), 'nothing at all is locked, so the gate proves nothing');
    return `${first.length} of ${all.length} held on a fresh profile, all ${all.length} after the ladder`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE CYCLE
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: the room runs a program in three phases and deploys exactly once', () => {
    const p = H.programById(LESSONS, 'lesson:feel');
    assert(p, 'the first lesson is not in the rack');
    const settings = H.programSettings(p, DEFAULT_SETTINGS);
    const said = [], phases = [], lit = [], painted = [];
    let lived = 0, gotten = null;
    const c = new H.Cycle(p, settings, {
      lattice: (k) => lit.push(k),
      paint: (g, k) => painted.push([g, k]),
      say: (l) => said.push(l),
      live: (s) => { lived++; gotten = s; },
    });
    /* 1/60 for four seconds — past `CYCLE_SECONDS`, so the tail is measured
     * too: a sequence that fires `live` again on every frame after it lands is
     * a deploy loop, and it would look exactly like this one until it shipped. */
    for (let i = 0; i < 240; i++) {
      const ph = c.step(1 / 60);
      if (!phases.length || phases[phases.length - 1] !== ph) phases.push(ph);
    }
    assert(phases.join('>') === 'set>paint>hold>done',
      `the room ran ${phases.join(' > ')} instead of set > paint > hold > done`);
    assert(lived === 1, `live fired ${lived} times — the room deployed ${lived === 0 ? 'never' : lived + ' times'}`);
    assert(gotten === settings, 'live handed out a different settings blob than the one it was given');
    assert(said.length === 2, `the room said ${said.length} things; two phases carry a line`);
    assert(painted.every(([g]) => g === p.ground), 'the room painted a ground that is not the program\'s');
    /* The lattice comes up, holds, and goes out — the last thing you see is
     * the ground on its own. */
    assert(Math.max(...lit) > 0.99 && lit[lit.length - 1] < 0.02,
      `the lattice ran ${Math.min(...lit).toFixed(2)}..${Math.max(...lit).toFixed(2)} and ended at ${lit[lit.length - 1].toFixed(2)}`);
    assert(c.done && c.progress === 1, 'the cycle never finished');

    /* WALKING AWAY IS NOT A DEPLOY. The difference between a sequence and a
     * loading screen is that this one can be left. */
    const c2 = new H.Cycle(p, settings, { live: () => { throw new Error('aborted cycle deployed'); } });
    c2.step(0.5);
    assert(c2.abort(), 'abort refused a running cycle');
    for (let i = 0; i < 240; i++) c2.step(1 / 60);
    assert(c2.phase === 'done', 'an aborted cycle kept running');

    assert(H.CYCLE_SECONDS > 2 && H.CYCLE_SECONDS < 5,
      `the room takes ${H.CYCLE_SECONDS.toFixed(1)} s to change — this happens every time you change your mind`);
    return `set>paint>hold>done in ${H.CYCLE_SECONDS.toFixed(1)} s, one deploy, abort deploys nothing`;
  });

  check('holodeck: the console reads a program back without inventing a number', () => {
    for (const p of H.programs(LESSONS)) {
      const lines = H.rackLines(p, LEVELS[p.ground]?.name);
      assert(lines.length >= 3, `${p.id} reads back as ${lines.length} lines`);
      assert(lines[0] === p.name.toUpperCase(), `${p.id}'s first line is "${lines[0]}"`);
      assert(lines[1] === LEVELS[p.ground].name, `${p.id} does not name its ground`);
      for (const l of lines) {
        assert(typeof l === 'string' && l.length > 0 && !/undefined|NaN|\[object/.test(l),
          `${p.id} reads back "${l}"`);
      }
    }
    /* The pike is the one program that takes the leash off, and the console
     * has to SAY so — an unlimited blade nothing on screen admits to is the
     * defect `_buildBladeCeiling`'s note is about. */
    const pike = H.programs(LESSONS).find((p) => p.dials && p.dials.unlimitedBlade);
    assert(pike, 'no program takes the blade off its leash — the dial moved nowhere');
    assert(H.rackLines(pike, 'x').some((l) => /leash/.test(l)),
      'the program that unleashes the blade does not say so on the console');
    return `${H.programs(LESSONS).length} programs read back, ground named on every one`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  RULE 4, ON THE ROOM'S OWN DECK
   * ════════════════════════════════════════════════════════════════════════ */

  check('holodeck: #57 clears rule 4 against every other place on deck 48', async () => {
    /**
     * `station.mjs` measures rule 4 on DECK 40 — `dressStation` builds one
     * deck per boot, so its check can only ever see the deck it asked for, and
     * a room added to 44 or 48 is not in that pairing at all. That is not a
     * gap in that check so much as the shape of the instrument, and the answer
     * is that a lane adding a room measures its own deck.
     *
     * The camera and the raster are `station.mjs`'s, imported rather than
     * rewritten: `_raster.mjs` exists precisely so a threshold tuned on one
     * instrument is not read off another. The stand-off and the direction are
     * the same lines, which is why the number below is comparable with the
     * 0.164 that check prints for deck 40's own worst pair.
     */
    const { rasterView, iou, W: RW, H: RH } = await import('./_raster.mjs');
    const { bootWorld } = await import('./_coop.mjs');
    const { prepareStation } = await import('../../src/game/Station.js');
    const { DECK_Y } = await import('../../src/game/StationPlan.js');

    /* No `fetch` in node; the imported rooms are read off disk, exactly as
     * `station.mjs`'s own `diskFetch` does it. Deck 48 has no imported room on
     * it, but `prepareStation` fetches the set. */
    if (!globalThis.__stationFetch) {
      const root = new URL('../../', import.meta.url);
      globalThis.__stationFetch = true;
      globalThis.fetch = async (url) => {
        const buf = await readFile(new URL(String(url), root));
        return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      };
    }
    await prepareStation();
    const { world } = await bootWorld({
      level: 'station',
      settings: { mode: 'station', level: 'station', allies: 0 },
      onWorld: (w) => { w._stationFloor = 48; },
    });
    try {
      const recs = [];
      for (const rec of world._station.places.values()) {
        const p = rec.place;
        if (p.band === 'ring') continue;
        const fx0 = p.x - p.door[0], fz0 = p.z - p.door[1];
        const flen = Math.hypot(fx0, fz0) || 1;
        const dx = fx0 / flen, dz = fz0 / flen;
        const back = Math.max(1.5, p.w / 2 / Math.tan(Math.PI / 4) - p.d / 2);
        const bits = rasterView(THREE, {
          objects: rec.group,
          eye: { x: p.door[0] - dx * back, y: (DECK_Y[p.deck] ?? 0) + 1.7, z: p.door[1] - dz * back },
          dir: { x: dx, z: dz },
        }).bits;
        let on = 0;
        for (let i = 0; i < bits.length; i++) on += bits[i];
        recs.push({ place: p, bits, on });
      }
      const mine = recs.find((r) => r.place.id === 57);
      assert(mine, '#57 was not built on deck 48 at all');
      assert(mine.on > 40,
        `#57 fills ${mine.on} of ${RW * RH} cells from its own door — there is nothing in there`);

      let worst = 0, worstPair = '', deckWorst = 0, deckPair = '';
      for (let i = 0; i < recs.length; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          const v = iou(recs[i].bits, recs[j].bits);
          const label = `#${recs[i].place.id} ${recs[i].place.name} × #${recs[j].place.id} ${recs[j].place.name}`;
          if (v > deckWorst) { deckWorst = v; deckPair = label; }
          if (recs[i].place.id !== 57 && recs[j].place.id !== 57) continue;
          if (v > worst) { worst = v; worstPair = label; }
        }
      }
      /* 0.85 is rule 4's number and §13.3 says raising it is the one response
       * that is not available. Both numbers are printed for the reason that
       * paragraph gives: the point is that somebody looks at them. */
      assert(worst < 0.85, `#57's worst pair is ${worst.toFixed(3)} — ${worstPair}`);
      assert(deckWorst < 0.85, `deck 48's worst pair is ${deckWorst.toFixed(3)} — ${deckPair}`);
      return `#57 fills ${mine.on}/${RW * RH} cells; worst pair with it ${worst.toFixed(3)} (${worstPair}); `
        + `deck 48 over ${recs.length} places ${deckWorst.toFixed(3)} (${deckPair})`;
    } finally { world.dispose?.(); }
  });
}
