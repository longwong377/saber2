/**
 * THE LOADER EVERY CHECK RUNS UNDER — and it does two things now.
 *
 * The first is the one HANDOFF §2.1 is about: it maps the bare specifier
 * `three` onto the vendored build, and without it a check gets a SECOND copy
 * of three.js and every measurement it takes is fiction.
 *
 * The second is `__SABER_SEED`. Two module-level random streams — `rand` in
 * MathUtil.js and `rng` in World.js — are seeded once at import and were
 * seeded from `Math.random()`, which is right in a browser and ruinous in a
 * gate: every process started a different stream, so a check that touched
 * either gave a different answer each run. Measured cost so far: an escalation
 * check that failed in a sequence and passed alone, a blast-door suite where a
 * different check failed on each of four consecutive runs of the same code,
 * and a corpse-fade suspicion that could never be reproduced.
 *
 * Set BEFORE any import, because both streams are seeded at module scope. The
 * value is arbitrary and only has to be constant; `SABER_SEED` in the
 * environment overrides it, which is how you re-roll deliberately to find a
 * bound that only holds on one stream.
 */
globalThis.__SABER_SEED = Number(process.env.SABER_SEED ?? 20260821);

import { register } from 'node:module';
register('./three-resolver.mjs', import.meta.url);
