/**
 * WHAT A SUITE MUST HAND BACK.
 *
 * verify.mjs runs the suites one at a time, in name order, in ONE process, and
 * several things the game keeps at module scope survive between them. A suite
 * that drives a World advances those for every suite after it, and a suite that
 * measures one of them without setting it first reads whatever the run happened
 * to leave.
 *
 * The one that bit, measured: `wind` (src/world/Scenery.js:279) is a single
 * WindField for the whole process and `WindField.time` advances on every
 * `world.update`. tools/checks/world-immersion.mjs's "snow: it FALLS" reads the
 * live gust — `wind.strengthAt(0, 0)` — against a drift integrated over a
 * flake's age, with `gustiness: 0.6`, so the two agree or disagree depending on
 * where in the gust cycle the clock happens to be. Adding four suites that
 * drive real Worlds for a few thousand frames each moved that clock and the
 * check went from passing to failing with the air at 1.9 m/s and the snow at
 * 3.0 — nothing at all to do with snow.
 *
 * `makeRng`'s own note over `seed` records the same shape for the two random
 * streams, `enemyRng` and `duelRng`: "the same check reading 8 strikes in one
 * run and 3 in another purely because another suite had drawn from the stream
 * first." Both were caught doing it here — duelling.mjs's "an enemy blade draws
 * blood" seeds `duelRng` and not `enemyRng`, so a body's speed jitter comes off
 * whatever the run left, and escalation.mjs seeds neither.
 *
 * They cannot be put back EXACTLY: the generators expose `seed` and no way to
 * read the state out. What is available is to leave them at the seed their own
 * modules gave them, which makes a suite's footprint on them deterministic even
 * though it cannot be zero — a later suite then sees the same stream on every
 * run, and on any run where this file's internals change. The real fix belongs
 * in the suites that measure a stochastic system without seeding it; this is
 * the part a new file can do for itself.
 *
 * USE IT IN A `finally`, in every check body that drives a World — or, since
 * there are thirty-odd such files, hand this file the suite's `check` once and
 * let `clocked` below do it. The checks in one file all start before any of
 * them awaits, so they interleave; each of them restoring the SAME snapshot
 * means whichever finishes last leaves the right value behind, and the suite
 * after this one starts where it would have started if this file did not exist.
 *
 * ── THE WIND WAS PUT BACK ONE FIELD OUT OF SIX, and it took a measurement to
 * see it. `snapshotShared` recorded `wind.time` and nothing else, so a suite
 * that loaded a level handed the next one that level's ENTIRE wind. Measured,
 * `pvp` then anything, with `restoreShared` called between them exactly as the
 * gate calls it:
 *
 *     at start      heading 0.6200  strength 1.7000  gust 0.6200  wander 1.0000
 *     after pvp     heading 2.4784  strength 3.6044  gust 0.6061  wander 0.3600
 *     …restored     heading 2.4784  strength 3.6044  gust 0.6061  wander 0.3600
 *
 * — the restore moved the clock and left the weather. Worse, `heading` and
 * `dir` are DERIVED from `time` by `_refresh()`, so rewinding the clock under
 * them left the field pointing where it had been at the moved time: a wind
 * whose direction disagreed with its own clock, which is a state the game
 * itself cannot reach. The whole configuration goes back now and `_refresh()`
 * runs, which is what "the clock back exactly" was always claiming.
 *
 * ── AND THE AUDIO SINGLETON, which cost 38 checks across five suites. It is
 * module scope by the same argument the two generators are — `Enemy._jetFx`
 * calls the module's `audio`, so a check of it must drive the real one — and a
 * check that swapped in a fake context left `master` live beside a null `ctx`,
 * a pairing `AudioEngine.setVolume` reads straight through. Every later suite
 * that built a Menu died on its own Volume slider. tools/checks/audio.mjs holds
 * the same restore locally, in the `finally` of the one check that does the
 * damage, which is the right place to CONTAIN it; this is the boundary that
 * makes the class structurally impossible instead of fixed once. Neither lists
 * a field name — a graph node added to `init()` tomorrow is carried by both.
 *
 * ── AND THE PLAYER'S SAVED KEY BINDINGS, which are module scope wearing a
 * different coat: `localStorage`. `Menu`'s rebinder calls `saveBindings`, which
 * writes the whole table under one key, and `loadBindings` re-reads it on every
 * `new Input`. A suite that drives a rebind through a real Menu therefore hands
 * every later suite a keyboard the player never chose.
 *
 * Measured, `controls` then anything: the blob left behind binds every action
 * to PAD codes only, so `loadBindings().walk` comes back `["PadBack+PadL3"]`
 * against a default of `["KeyI", "PadBack+PadL3"]`. `spectacle` is 19/19 alone
 * and 15/19 after `controls` — pressing the walk key answers to nothing at all,
 * and its message reads `KeyI answers to  — one press, two systems`, an empty
 * list where the check expected a collision. Two of its other three failures
 * are the same cause wearing different words: a body that will not walk and a
 * free-camera key that does nothing.
 *
 * Every key is recorded, not just the bindings one — the same argument as the
 * audio singleton above: naming the key means the NEXT thing a screen persists
 * is uncovered on the day it is written.
 *
 * ── WHAT IS STILL NOT COVERED, and it is not an oversight in each case:
 * Scenery.js's own `rng` (module scope, private, drives every scatter), the
 * wave stream (`seedWaves` is a suite's own call, because the seed is part of
 * what it is measuring), `ground.clock` and `_scarAt` (they have to move
 * together or `ground.scar`'s throttle refuses every cut for the rest of the
 * run — see the note on `ground.clock`), and Engine's once-only ShaderChunk
 * flags. And the one nothing here can reach: a suite's own async checks
 * interleave, so two of them sharing a module-scope stream draw in an order
 * that depends on what ran before. That is `tools/_seq.mjs`'s fourth class and
 * it is fixed in the suite, not at the boundary.
 */

/** Everything at module scope that a suite is about to move. */
export async function snapshotShared() {
  const { wind } = await import('../../src/world/Scenery.js');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { duelRng } = await import('../../src/game/Duel.js');
  const { audio } = await import('../../src/engine/Audio.js');
  return {
    wind,
    time: wind.time,
    /* The four `configure` sets, which is the whole of a level's wind block.
     * `heading` and `dir` are derived and are not recorded: `_refresh()` builds
     * both out of these and the restored clock. */
    air: { heading: wind.baseHeading, strength: wind.strength, gustiness: wind.gustiness, wander: wind.wander },
    enemyRng,
    duelRng,
    audio,
    /* Every own property, by name at no point. */
    sound: { ...audio },
    /* The whole of persistent storage, likewise by no name. `null` on a box
     * with no shim rather than a throw: this runs before every suite. */
    store: readStore(),
  };
}

/** Every key `localStorage` holds, or null where there is no storage at all. */
function readStore() {
  const ls = globalThis.localStorage;
  if (!ls || typeof ls.key !== 'function' || typeof ls.getItem !== 'function') return null;
  const out = [];
  try {
    for (let i = 0; i < (ls.length ?? 0); i++) {
      const k = ls.key(i);
      if (k != null) out.push([k, ls.getItem(k)]);
    }
  } catch { return null; }
  return out;
}

/** The clock back exactly; the two generators back to their modules' seeds. */
export function restoreShared(snap) {
  if (!snap) return;
  const w = snap.wind;
  w.time = snap.time;
  w.baseHeading = snap.air.heading;
  w.strength = snap.air.strength;
  w.gustiness = snap.air.gustiness;
  w.wander = snap.air.wander;
  w._refresh();                             // heading and dir are derived from all five
  snap.enemyRng.seed(4711);                 // src/game/Enemy.js:41
  snap.duelRng.seed(8123);                  // src/game/Duel.js:33
  for (const k of Object.keys(snap.audio)) if (!(k in snap.sound)) delete snap.audio[k];
  Object.assign(snap.audio, snap.sound);
  if (snap.store) {
    const ls = globalThis.localStorage;
    try {
      const now = readStore() || [];
      for (const [k] of now) if (!snap.store.some((e) => e[0] === k)) ls.removeItem(k);
      for (const [k, v] of snap.store) ls.setItem(k, v);
    } catch { /* a shim that refuses writes is a shim nothing saved into */ }
  }
}

/**
 * WRAP A SUITE'S `check` ONCE, INSTEAD OF WRITING THE PAIR IN EVERY BODY.
 *
 * `snapshotShared` + `restoreShared` in a `finally` is five lines, and the two
 * clauses in tools/checks/determinism.mjs found 26 suites driving a World's
 * frames without them and 13 building enemies without ever seeding the stream
 * they draw from. Twenty-six hand-rolled copies of a five-line rule is HANDOFF
 * §2.4 waiting to happen — one of them will eventually restore something the
 * others do not, and it will be a suite nobody re-reads. So the rule lives
 * here and a suite CALLS it:
 *
 *     import { clocked } from './_shared.mjs';
 *     export async function run({ check, assert }) {
 *       check = await clocked(check);
 *       …
 *     }
 *
 * Three things about the shape, each of which was the alternative:
 *
 * ONE SNAPSHOT FOR THE WHOLE SUITE, not one per check. The header above says
 * why: a file's checks all start before any of them awaits, so they interleave,
 * and each restoring the SAME snapshot means whichever finishes last leaves the
 * right value behind. Snapshotting per check would have the second check record
 * the clock the first one had already moved, and the suite would hand its
 * successor a number that depends on which body won the race.
 *
 * SEEDING IS THE RESTORE, called before the body instead of after it. Not a
 * second function that has to be kept in step with it: `restoreShared` already
 * says what a quiescent stream is (`enemyRng` 4711, `duelRng` 8123, the wind
 * clock where the suite found it), and a separate `seedShared` would be a
 * second copy of that statement — §2.3's hand-maintained table beside its
 * generated twin, in the one file whose whole subject is that class.
 *
 * A SYNCHRONOUS BODY STAYS SYNCHRONOUS. Every runner tells a sync check from an
 * async one by whether the body handed back a thenable, and wrapping every body
 * in an `async` function would push all of them onto the pending list — which
 * changes the interleaving this file exists to make predictable, in every suite
 * at once, as a side effect of a hygiene fix.
 *
 * WHAT IT DOES NOT COVER, measured rather than assumed. `ground` (Scenery.js)
 * carries a monotonic `clock` and a `_scarAt` stamp that no runner puts back —
 * HANDOFF §6.2's "the one piece of shared state the runner does not restore
 * between suites" — and the pair has to move together or not at all, because
 * `ground.scar`'s throttle compares them and a clock rolled back under a stamp
 * that was not refuses every scar for the rest of the run. That is the defect
 * the note on `ground.clock` records, and rewinding one half here would put it
 * back. Also uncovered: Waves.js's stream (`seedWaves` is a suite's own call,
 * because the seed is part of what it is measuring) and Engine's once-only
 * ShaderChunk flags.
 */
/**
 * ── AND THEY HAVE TO RUN ONE AT A TIME, WHICH IS THE OTHER HALF ─────────
 *
 * `restoreShared` before the body and after it is only sound if nothing else
 * is running in between. Checks are not run that way: `check()` pushes every
 * async body onto one `Promise.all` — `tools/_seq.mjs`'s own header says so —
 * so a clocked suite's checks INTERLEAVE, and the moment check B starts it
 * calls `restoreShared` and rewinds the streams underneath check A, halfway
 * through A's forty seconds of driven world.
 *
 * That is not a theory. It is what three separate lanes lost time to in one
 * session:
 *
 *   `blast-door` failed a DIFFERENT check on nearly every run of identical
 *     code — a tight loop that opened a door in 17 s on one run and saturated
 *     at 840 of 901 texels on the next;
 *   `extraction` passes 17/17 alone, twice, and fails "2 body-frames jumped
 *     further than a walking pace" when it is run after three other suites;
 *   an `escalation` composition check failed inside a sequence and passed
 *     alone, on the same commit, and was written off as a flake.
 *
 * Pinning the module seeds (`tools/register.mjs`) made every process deal the
 * same deck and did not touch this: the deck was never the problem, the
 * SHUFFLING MID-DEAL was.
 *
 * So a clocked body takes a lock. One chain for the whole process rather than
 * one per suite, because `verify.mjs` runs suites concurrently too and a
 * per-suite lock would leave exactly the same defect between files. It costs
 * wall-clock on the clocked suites and buys a gate whose answer does not
 * depend on what else happened to be running.
 */
let _lock = Promise.resolve();

export async function clocked(check) {
  const snap = await snapshotShared();
  return (label, fn) => check(label, () => {
    /* Queue behind whatever clocked body is running, and hand the lock on when
     * this one is done however it ends. */
    const run = _lock.then(async () => {
      restoreShared(snap);                      // the body draws from a stated phase
      try {
        return await fn();
      } finally {
        restoreShared(snap);
      }
    });
    /* The chain must not break on a failing check, or every check after it
     * runs unlocked — so the lock follows the SETTLED promise. */
    _lock = run.then(() => {}, () => {});
    return run;
  });
}
