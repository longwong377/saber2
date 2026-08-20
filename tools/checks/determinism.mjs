/**
 * BATTLEFRONT BORZ — the suite has to answer the same question twice.
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
 *
 * THE OUTCOME, ONCE THE EXPERIMENT WAS FINALLY RUN PROPERLY — on a quiet tree,
 * both directions, both through the module loader:
 *
 *   forward   1139 passed, 0 failed
 *   reverse   1139 passed, 0 failed
 *   1099 of 1139 result lines identical, character for character
 *
 * The verdict is order-independent. The residue is 40 passing checks whose
 * measured numbers move with the phase of a shared stream — `escalation` (5),
 * `props` (4), `presence` and `co-op` (3 each), then singles. They pass both
 * ways because they have margin, not because they are pinned.
 *
 * AND A WARNING THAT BELONGS WITH IT. The first two attempts at that
 * experiment were run as plain `node tools/verify.mjs`, without the loader that
 * `npm run verify` passes. That puts two copies of three in one process and
 * produced two failures that were pure fiction — including "56 of 56
 * geometries survived the corpse", which reads as every corpse in the game
 * leaking, and was a patched prototype on the copy nobody was using. An
 * afternoon went into bisecting for order-dependence that was never there.
 * `verify.mjs` now refuses to start that way.
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
     * `_shared.mjs` snapshots the wind and returns both random streams to their
     * modules' own seeds. It exists because four new World-driving suites
     * flipped three unrelated checks; it was written with that fix and adopted
     * by the four suites in that pass, which was 4 of the 29 that boot a World.
     *
     * The property that matters is that a suite driving a World either RESTORES
     * what it moved or does not move anything a later suite reads. This asserts
     * the first half, because it is the half a machine can see, and it is
     * scoped to the suites that actually run frames: booting a World costs
     * nothing, `world.update` in a loop is what moves a clock.
     *
     * THE OTHER 26 WERE SWEPT ONTO `clocked`, one line in each `run()`, and
     * what that sweep is worth was measured BEFORE it was made rather than
     * argued. Every one of the 26 was run under a harness that restores nothing
     * between suites, and the footprint it left read out:
     *
     *   twelve of the 26 leave NOTHING AT ALL — catch, controls, cutting,
     *     deflection, directional, frame-budget, grooming, living-force, order,
     *     training, vitals, arrivals: zero on the wind clock, zero on
     *     `ground.clock`, zero draws from either stream;
     *   seven move the wind clock — command 335.4 s, coop 238.5 s, force
     *     121.2 s, pvp 31.4 s, lifecycle 18.6 s, forest 4.0 s, garments 1.7 s;
     *   the rest only draw — severance 67 289 values out of `duelRng`,
     *     answerable 385/314, compel 121, audio 73.
     *
     * AND UNDER THE GATE ALL OF IT IS ALREADY NEUTRALISED, because
     * `verify.mjs` calls `restoreShared(baseline)` BEFORE every suite. Measured
     * both ways: `catch` after `coop`, and `telekinesis` after `severance`, are
     * byte-identical to the same suite run alone even with no restore between
     * them at all. So this clause is HYGIENE at the gate's boundary — what it
     * buys is inside a file. A suite's checks interleave, so the second one to
     * run reads whatever the first left, and three of these answered a
     * different number the second time they ran in one process:
     *
     *   compel      the muzzle is behind the chest for a self-shot
     *                 firing 70° up → 69° up
     *   force       a held body does not advance
     *                 free: 9.30 m closed → 10.97 m; the bar runs dry after
     *                 54 frames → 37
     *   duelling    a duellist holds its blade between itself and its target
     *                 blade 0.60 → 0.75 toward the target, tip 0.90 → 0.71 m,
     *                 and a beaten guard driven 104° wide → 64°
     *
     * Wrapped, all three are the same number on both runs.
     *
     * AND SIX ARE NOT, WHICH IS THE HALF WORTH WRITING DOWN. `characters`
     * (a heavy's bore 0.9° → 0.4° off aim), `arrivals` (2.50 → 2.40 bodies per
     * gunship), `pvp` (a shove at 0.94 m and then 0.33 m), `audio`, `vehicles`
     * and `garments` all answer differently on the second pass, wrapped or not.
     * Seeding at the top of a body does not reach them: their checks
     * interleave across an await, so a SIBLING body's seed lands between one
     * body's seed and its draws. That is `tools/_seq.mjs`'s fourth class — the
     * scheduling of a suite's own async checks — and no boundary can fix it;
     * the suite has to stop sharing a stream across its own awaits.
     *
     * So the sweep did not close a red in the gate and does not close this
     * class either. Saying otherwise would make the next reader distrust the
     * rest of this file.
     */
    const drivers = files.filter(([, t]) => {
      const src = strip(t);
      return /game\/World\.js/.test(src) && /\.update\(\s*(1 \/ 60|dt|1\/60)/.test(src);
    });
    assert(drivers.length > 4, `only ${drivers.length} suites were detected as driving frames — the detector is wrong`);
    const bare = drivers.filter(([, t]) => !/_shared\.mjs/.test(t)).map(([n]) => n);
    /* The bar was 25 when this was written and it may only fall; the sweep took
     * it to nought, so nought is what it holds at. A new suite that drives
     * frames without restoring is a new source of the non-determinism above,
     * and this is where it gets noticed — while it is still two lines. */
    assert(bare.length === 0,
      `${bare.length} suites drive a World's frames without restoring the module clocks `
      + `(${bare.slice(0, 6).join(', ')}${bare.length > 6 ? ', …' : ''}) — each one shifts `
      + 'the wind clock and both random streams for every suite that follows it. Two lines: '
      + "import { clocked } from './_shared.mjs', then `check = await clocked(check)` at the "
      + 'top of run()');
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
     *
     * THE THIRTEEN THAT DID NOT are swept onto `clocked` as well, which seeds
     * both streams before every check body — so a suite reads the same phase
     * whether it runs first, last, or twice. It is the same one line as the
     * clause above and for most of the thirteen it is the same suite.
     *
     * What it moved, measured by running a suite TWICE in one process, which is
     * the cheapest way to hand a suite the phase it leaves: `compel` read the
     * self-shot firing 70° up on the first pass and 69° on the second, and
     * `force` measured a released body closing 9.30 m and then 10.97 m. Neither
     * is a bound anybody had written down — they are printed numbers, which is
     * exactly why nobody had noticed. Both are stable now; the clause above
     * lists the five that are not, and why a seed cannot reach them.
     *
     * AND ONE THING NO SEED HERE REACHES AT ALL. `arrivals` and `vehicles`
     * answer differently from one PROCESS to the next — arrivals read 1.78
     * bodies per gunship and then 2.31 — because `Waves.js` and `MathUtil.js`
     * each seed a module-scope stream with `Math.random()` at load, and
     * `Combat.js`, `Duel.js` and `Dropped.js` call `Math.random()` outright.
     * Seeding both streams was tried and does not settle `vehicles`. A suite
     * that wants a repeatable wave still has to call `seedWaves` itself, which
     * is why that is one of the three things this clause accepts.
     */
    const spawners = files.filter(([, t]) => {
      const src = strip(t);
      return /new Enemy\(|spawnEnemy\(/.test(src);
    });
    assert(spawners.length > 5, `only ${spawners.length} suites construct enemies — the detector is wrong`);
    const unseeded = spawners
      .filter(([, t]) => !/enemyRng\.seed|seedWaves\(|_shared\.mjs/.test(t))
      .map(([n]) => n);
    /* 12 when this was written; nought since the sweep, and it may only fall. */
    assert(unseeded.length === 0,
      `${unseeded.length} suites build enemies without ever seeding the stream they draw from `
      + `(${unseeded.slice(0, 6).join(', ')}${unseeded.length > 6 ? ', …' : ''}) — seed it, or take `
      + "the pair for the whole file with `check = await clocked(check)` from './_shared.mjs'");
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

  check('determinism: no check reads a function by guessing how long it is', () => {
    /**
     * FOUND BY RUNNING THE WHOLE SUITE ON A TREE WITH NOTHING ELSE MOVING IN IT,
     * which is the run this file exists to make meaningful. Two checks were red
     * and both were wrong:
     *
     *   ✗ living force: a communion crosses the wire and lands on the receiver
     *   ✗ run: a landing carries the run across loadLevel
     *
     * `World.spawnPlayer` runs 89 lines and contains every line both checks
     * demand. They read it as `world.slice(indexOf('  spawnPlayer('), … + 2600)`
     * and the function is 4262 characters long. The window was a property of
     * nothing, was correct on the day it was typed, and expired in silence when
     * somebody added a line — reporting the growth of a function as the absence
     * of its contents.
     *
     * NINETEEN of these were in the suite, across nine files, from 140 to 3600
     * characters. Two were red; the rest were not safe, only unexpired. And the
     * other direction is worse: `net.on('peer-left'` is 15 lines and was read
     * with a 900-character window that ran 180 lines past the end of the
     * handler, so a check could have passed on a line belonging to a completely
     * different function — and nobody investigates a green check.
     *
     * THE PART THAT MAKES THIS MORE THAN A CHECK BUG. Three comments in
     * `src/game/World.js` explain that shipped code was moved OUT of the
     * `onWaveClear` callback to fit the check's window: "the callback had 16
     * characters of that budget left". A magic number in the harness became a
     * constraint on the structure of the game. That is the strongest argument
     * available for why this shape has to be forbidden rather than tidied.
     *
     * `tools/checks/_source.mjs` replaces all nineteen: `functionBody` counts
     * braces to the real end of the function and throws if it cannot find it,
     * and `lines` takes a neighbourhood in lines — a unit the reader can see —
     * for the handful of sites that genuinely want one.
     */
    const bad = [];
    for (const [name, text] of files) {
      const src = strip(text);
      for (const m of src.matchAll(/\.slice\(\s*(\w+)\s*,\s*(\w+)\s*\+\s*(\d+)\s*\)/g)) {
        if (m[1] !== m[2]) continue;            // not an offset from a found index
        if (Number(m[3]) < 100) continue;       // a short fixed field, not a function
        bad.push(`${name}: ${m[0].trim()}`);
      }
    }
    assert(bad.length === 0,
      `a check reads source by slicing a fixed number of characters from an index: ${bad.join('; ')} `
      + '— use functionBody() from _source.mjs, which reads to the real end of the function. A window '
      + 'is correct only until somebody adds a line, and it fails silently in both directions');
    return `${files.length} suites, none guesses the length of a function`;
  });

  check('determinism: neither harness will start with two copies of three', async () => {
    /**
     * `dom-shim.mjs` registers the loader that maps `three` onto `vendor/three`
     * — but it does so while it evaluates, and a harness's static graph is
     * linked before any of it runs. So `node tools/verify.mjs`, which is the
     * obvious thing to type and what the file's own header used to show, loads
     * BOTH copies and neither crashes.
     *
     * What it does instead is report. Measured back to back on a clean tree:
     * with the loader 1139/0, without it 1137/2 — and both failures fiction.
     * The loudest read "56 of 56 geometries survived the corpse", which is
     * every corpse in the game leaking its materials, from a patched prototype
     * on the copy nobody was using.
     *
     * Asserted on the source, because a check cannot start the harness it is
     * running inside. The test both guards use is namespace identity: two
     * module namespace objects are the same object iff they are the same
     * instance, which is the question, and unlike `import.meta.resolve` it
     * cannot be fooled by WHEN it is asked — resolve answers vendor either way,
     * because by the time anything can ask, dom-shim has installed the hook.
     */
    for (const f of ['../verify.mjs', '../_one.mjs']) {
      const s = await readFile(new URL(f, DIR), 'utf8');
      assert(/await import\('three'\)\s*\)?\s*!==\s*THREE|\(await import\('three'\)\) !== THREE|dynamic !== THREE/.test(s),
        `${f} no longer checks that its static three is the same module everything else gets — `
        + 'run it without the loader and it will report fictional failures instead of refusing');
      assert(/process\.exit\(2\)/.test(s), `${f} detects the second copy of three and carries on anyway`);
    }
    return 'verify.mjs and _one.mjs both refuse to run against a second copy of three';
  });

  check('determinism: every suite file in tools/checks/ exports a run()', async () => {
    /**
     * THE DURABLE FORM OF "A SUITE CANNOT VANISH".
     *
     * `verify.mjs` used to invoke a suite behind a bare
     * `if (typeof mod.run === 'function')` with no `else`, so a suite whose
     * export was renamed, removed, or lost to a merge printed as
     * `✓ animation.mjs 0/0` and its checks left the gate in silence. That is
     * fixed in the runner — it fails the suite now — but a runner-side fix only
     * fires on the day somebody runs the gate and reads the line, and it is one
     * `else` away from regressing.
     *
     * This is the same rule stated where it cannot be lost: IMPORT EVERY SUITE
     * AND ASK. `_`-prefixed files are shared helpers by the same convention
     * verify.mjs and this file's other checks use, so they are excluded here by
     * the same rule and by no other.
     *
     * It also refuses an EMPTY list, which is the shape HANDOFF §2.3 files
     * under "a missing thing answered with a plausible default": a readdir that
     * silently returned nothing would make this the greenest check in the tree.
     */
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
    assert(files.length > 40,
      `only ${files.length} suite files found under tools/checks/ — this check is not reading the tree`);
    const bad = [];
    for (const f of files) {
      const mod = await import(new URL(f, DIR).href);
      if (typeof mod.run !== 'function') bad.push(f);
    }
    assert(!bad.length,
      `${bad.join(', ')} export no run() — every check in ${bad.length === 1 ? 'it' : 'them'} is `
      + 'absent from the gate, and the gate has no way to know how many that was');

    // …and the runner still refuses one rather than printing a green 0/0.
    const v = await readFile(new URL('../verify.mjs', DIR), 'utf8');
    assert(/typeof mod\.run !== 'function'/.test(v) && /exports no run\(\)/.test(v),
      'verify.mjs is back to invoking a suite behind a bare `if (typeof mod.run === \'function\')` '
      + 'with no else, so a suite with no export is a silent green 0/0 again');
    return `${files.length} suite files, every one exporting run(); verify.mjs fails the ones that do not`;
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
