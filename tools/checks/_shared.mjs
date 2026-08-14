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
 * USE IT IN A `finally`, in every check body that drives a World. The checks in
 * one file all start before any of them awaits, so they interleave; each of
 * them restoring the SAME snapshot means whichever finishes last leaves the
 * right value behind, and the suite after this one starts where it would have
 * started if this file did not exist.
 */

/** The module-scope clocks a suite is about to advance. */
export async function snapshotShared() {
  const { wind } = await import('../../src/world/Scenery.js');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { duelRng } = await import('../../src/game/Duel.js');
  return { wind, time: wind.time, enemyRng, duelRng };
}

/** The clock back exactly; the two generators back to their modules' seeds. */
export function restoreShared(snap) {
  if (!snap) return;
  snap.wind.time = snap.time;
  snap.enemyRng.seed(4711);                 // src/game/Enemy.js:41
  snap.duelRng.seed(8123);                  // src/game/Duel.js:33
}
