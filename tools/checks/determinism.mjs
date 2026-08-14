/**
 * SABER — the suite has to answer the same question twice.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `verify.mjs` runs eighty-odd suites one at a
 * time, in one process, in `readdir` order. Several things the game keeps at
 * module scope survive between them:
 *
 *   `enemyRng`, `duelRng`   the two stochastic streams (Enemy.js, Duel.js)
 *   the wave stream          (Waves.js, via seedWaves)
 *   `wind`                   one WindField for the process (Scenery.js)
 *   `ground`                 terrain, fx, clock, _scarAt (Scenery.js)
 *   Engine's ShaderChunk     once-only patch flags
 *
 * A suite that drives a World advances all of those for every suite after it,
 * and a suite that measures one without setting it first reads whatever the run
 * happened to leave. Alphabetical order is not a design — it is the order
 * `readdir` gave — and every check silently depends on it.
 *
 * What that costs, measured rather than argued:
 *
 *   • `escalation: a Leader multiplies the wave` compared two b1s whose speed
 *     jitter came off the shared stream, against a 5% bar on a 15% buff. It
 *     read 1.007x and failed on a pristine tree. Measuring the SAME body twice
 *     reads 1.150x, which is RALLY.speed exactly.
 *   • `masonry: what stands in sand is bedded into it` measured 0.827 forward
 *     and 1.56 backward — because `mapPeak` missed an identity-keyed cache and
 *     answered with a hard-coded 3, so the check measured its own fallback.
 *     Found by `SABER_CHECK_ORDER=reverse` on its first run.
 *   • `world-immersion`'s "snow: it FALLS" reads the live gust against a drift
 *     integrated over a flake's age. Four new World-driving suites moved the
 *     wind clock and it went red with the air at 1.9 m/s and the snow at 3.0 —
 *     nothing to do with snow.
 *
 * A harness that answers differently each time is worse than one that is red,
 * because the difference looks like whatever you changed last. It is the
 * mechanism by which a fixed cone survived several rounds of being fixed, and
 * by which three tautological checks got through an entire audit pass that had
 * two adversarial phases in it.
 *
 * WHAT IS ASSERTED HERE is the hygiene, not the outcome — a check cannot run
 * the whole suite from inside the suite. The outcome is checked by running
 * `SABER_CHECK_ORDER=reverse` and diffing; this file makes the conditions that
 * break it visible at the moment they are introduced, which is the only time
 * they are cheap to fix.
 */

import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('./', import.meta.url);

/** Every suite's source, minus its own name. */
async function suites() {
  const names = (await readdir(DIR)).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')
    && f !== 'determinism.mjs').sort();
  return Promise.all(names.map(async (n) => [n, await readFile(new URL(n, DIR), 'utf8')]));
}

/** Comments stripped, so a note ABOUT a pattern is not read as the pattern. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export async function run({ check, assert }) {
  const files = await suites();

  check('determinism: a suite that drives a World hands the module clocks back', async () => {
    /**
     * `_shared.mjs` snapshots the wind clock and returns both random streams to
     * their modules' own seeds. It exists because four new World-driving suites
     * flipped three unrelated checks; it was written with that fix and adopted
     * by the four suites in that pass, which is 4 of the 29 that boot a World.
     *
     * The other 25 are not a backlog of bugs — most of them measure things no
     * clock touches. The property that matters is that a suite driving a World
     * either RESTORES what it moved or does not move anything a later suite
     * reads. This asserts the first half, because it is the half a machine can
     * see, and it is scoped to the suites that actually run frames: booting a
     * World costs nothing, `world.update` in a loop is what moves a clock.
     */
    const drivers = files.filter(([, t]) => {
      const src = strip(t);
      return /game\/World\.js/.test(src) && /\.update\(\s*(1 \/ 60|dt|1\/60)/.test(src);
    });
    assert(drivers.length > 4, `only ${drivers.length} suites were detected as driving frames — the detector is wrong`);
    const bare = drivers.filter(([, t]) => !/_shared\.mjs/.test(t)).map(([n]) => n);
    // The bar is the count at the time this was written, and it may only fall.
    // A new suite that drives frames without restoring is a new source of the
    // exact non-determinism above, and this is where it gets noticed.
    assert(bare.length <= 25,
      `${bare.length} suites drive a World's frames without restoring the module clocks `
      + `(${bare.slice(0, 6).join(', ')}${bare.length > 6 ? ', …' : ''}) — each one shifts `
      + 'the wind clock and both random streams for every suite that follows it');
    return `${drivers.length} suites drive frames, ${drivers.length - bare.length} restore the clocks`;
  });

  check('determinism: nothing measures a stochastic system without seeding it', () => {
    /**
     * The two streams are module-scope and shared. A check that spawns bodies
     * and then compares them is reading speed jitter, strafe sides and spawn
     * offsets from wherever the previous suite left the generator.
     *
     * `escalation` did exactly this and read a 15% buff as 1.007x. The fix was
     * not the seed — it was measuring one body twice instead of two bodies once
     * — but the seed is what makes the number the same on every run, and a
     * measurement that is not reproducible is not a measurement.
     *
     * Scoped to suites that CONSTRUCT enemies, because those are the ones that
     * draw: importing `ARCHETYPES` to read a label does not touch the stream.
     */
    const spawners = files.filter(([, t]) => {
      const src = strip(t);
      return /new Enemy\(|spawnEnemy\(/.test(src);
    });
    assert(spawners.length > 5, `only ${spawners.length} suites construct enemies — the detector is wrong`);
    const unseeded = spawners
      .filter(([, t]) => !/enemyRng\.seed|seedWaves\(|_shared\.mjs/.test(t))
      .map(([n]) => n);
    assert(unseeded.length <= 12,
      `${unseeded.length} suites build enemies without ever seeding the stream they draw from `
      + `(${unseeded.slice(0, 6).join(', ')}${unseeded.length > 6 ? ', …' : ''})`);
    return `${spawners.length} suites construct enemies, ${spawners.length - unseeded.length} seed the stream`;
  });

  check('determinism: no check answers a cache miss with a magic number', () => {
    /**
     * THE SHAPE THAT COST THE MOST, three times in one session:
     *
     *   `PEAK.get(tex) ?? 3`     measured the fallback, not the map — 1.56
     *                            against a 0.95 bar, and the 3 was invisible
     *   `tools/_one.mjs`         printed "0 passed, 0 failed" and exited 0 for
     *                            a suite of 27 checks whose promises it dropped
     *   a 12-slot wire record    against a 13-slot packer, so the field that
     *                            mattered arrived `undefined` and the path it
     *                            gated was silently never exercised
     *
     * All three are one defect: a missing thing answered with a plausible
     * default instead of an error. In a CHECK it is worse than anywhere else,
     * because the default is what gets asserted against and the assertion still
     * reads as evidence.
     *
     * NARROWED, AND THE NARROWING IS THE INTERESTING PART. The first version of
     * this check flagged every `?? <number>` after a lookup and immediately
     * caught two pieces of correct code:
     *
     *   `perAz.get(k) ?? -1e9`      the identity element for a Math.max fold,
     *                               exactly as `?? 0` is for a sum
     *   `MAX_MEDIAN[name] ?? 4.0`   a default BAR with a two-entry exception
     *                               table beside it — the 4.0 is the rule and
     *                               the table is the exception list
     *
     * Neither is a guess about a missing thing; both are stated defaults. A
     * check that fires on correct code gets loosened until it catches nothing,
     * which is the tautological-check failure mode this whole file is about —
     * so it is narrowed to the shape that actually bit:
     *
     *   a `.get()` on a Map, with a numeric fallback that is not a fold
     *   identity
     *
     * Map lookups are where "I could not identify my subject" lives, because
     * the key is usually an object built somewhere else. Bracket indexing into
     * a literal table in the same file is a stated default and is left alone.
     * It may well catch nothing today; it is a tripwire for the next one, and
     * the next one has already cost this project three separate defects.
     */
    const FOLD_IDENTITY = /^-?(0|1|1e9|1e-9|Infinity)$/;
    const bad = [];
    for (const [name, text] of files) {
      const src = strip(text);
      for (const m of src.matchAll(/(\w+\.get\([^)]*\))\s*\?\?\s*(-?[\d.e]+)/g)) {
        if (FOLD_IDENTITY.test(m[2])) continue;
        bad.push(`${name}: ${m[0].trim()}`);
      }
    }
    assert(bad.length === 0,
      `a lookup falls back to a magic number in a check: ${bad.join('; ')} — the check then measures `
      + 'the fallback and reports it as a measurement of the real thing');
    return `${files.length} suites, no lookup answers a miss with a guess`;
  });

  check('determinism: verify.mjs can still be told to run backwards', async () => {
    /* The switch that found the `mapPeak` fallback on its first run. If it is
     * removed, the only tool for this class goes with it and the next instance
     * is found by somebody wondering why their unrelated change turned a check
     * red. Asserted on the source rather than by running it: this check runs
     * INSIDE the run it would have to start. */
    const v = await readFile(new URL('../verify.mjs', DIR), 'utf8');
    assert(/SABER_CHECK_ORDER/.test(v), 'verify.mjs can no longer be asked to run its suites in a different order');
    assert(/files\.reverse\(\)/.test(v), 'the reverse-order switch no longer reverses anything');
    return 'SABER_CHECK_ORDER=reverse still reverses the suite order';
  });
}
