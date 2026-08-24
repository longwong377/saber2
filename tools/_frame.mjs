/**
 * M4's READER — what a frame costs in a real browser, and whose fault it is.
 *
 *   node tools/_frame.mjs [--level geonosis] [--mode theline] [--quality high]
 *     [--frames 16] [--reinforce 40] [--scale 0.6] [--width 1280] [--height 720]
 *     [--no-ink] [--json .audit/frame.json]
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `src/engine/Profiler.js` has measured the frame, our own JS, real GPU time,
 * the p99 and the 1% low since it was written, and it is always on. PLAN §6's
 * M4 is therefore BUILT — and its numbers had never once left a player's
 * screen, because nothing in `tools/` starts a browser, plays, and reads
 * `profiler.stats()`. An instrument nobody reads is a budget with extra steps.
 *
 * PLAN §4.3 is the thing waiting on it. Its open question is exactly one
 * sentence — *is a low frame rate GPU-bound or JS-bound* — and the decision it
 * gates (per-object ink prepass materials, so the instanced cohort rung can be
 * animated) has been argued in DRAW CALLS for weeks because draw calls were the
 * only unit anyone could get. This prints the millisecond next to the draw call
 * so the two can be argued about together.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT IT MEASURES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * One boot, one deploy into a real level with real bodies, and then two or
 * three MEASURED WINDOWS on the same page. Each window zeroes the profiler's
 * ring, plays for a stated number of recorded frames with synthetic input on
 * the stick, and reads `stats()`. Everything in the table comes out of the
 * shipped instrument; nothing here re-implements a timer.
 *
 *   frame     wall clock rAF-to-rAF. The truth, browser included. Mean AND
 *             median, because at this sample count they are different numbers.
 *   JS        our own update + the draw calls we ISSUE — `Profiler.cpuMs`.
 *   GPU       `EXT_disjoint_timer_query_webgl2` around the draw only, polled
 *             asynchronously; a disjoint throws the sample away. Printed as
 *             `unavailable` if the query never comes back, never as 0.
 *   p99/1%low the worst frames. A build that averages fine and hitches four
 *             times a second is the player's actual complaint.
 *   draws/tris `renderer.info.render`, free, and the unit §4.3 reasons in.
 *
 * THE RUNGS, and why a ladder rather than one reading. One number tells you
 * where you are; two tell you which way the cliff is. The boot is by far the
 * most expensive part of a run here (a deploy is minutes on this box), so the
 * rungs share it and cost only their own frames:
 *
 *   1  as deployed      the population the mode actually fields.
 *   2  +N reinforcements the same frame with `--reinforce` more bodies spawned
 *                       at the level's own spawn radius — the population
 *                       gradient §4.3's "120 simultaneous bodies" needs.
 *   3  no ink prepass   rung 2 with `OutlinePass.prepass` skipped. The prepass
 *                       is a SECOND rasterisation of the scene and PLAN §4.3
 *                       says it is already 118 of the meadow's 214 draws, so
 *                       the delta between rungs 2 and 3 is the price tag on the
 *                       per-object-prepass decision itself. The composite
 *                       still runs and still samples the (now stale) target, so
 *                       the delta is the prepass and not the ink.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT IT IS NOT, AND THE ERROR BAR — READ THIS BEFORE QUOTING A NUMBER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `tools/checks/_cpuclock.mjs` gives this project's treatment of the problem:
 * a millisecond taken on a loaded shared box is not a slow result, it is no
 * result. Everything it says applies here and one thing more, which is worse.
 *
 * THERE IS NO GPU IN THIS CONTAINER. The renderer is ANGLE on SwiftShader —
 * a software rasteriser running on the same four cores as our JS. So:
 *
 *   · The GPU column is REAL — the timer query resolves here, which is the
 *     single most useful thing this run establishes, because it means the same
 *     tool answers §4.3 properly the moment it is pointed at a machine with a
 *     GPU in it. But what it is timing is a CPU rasteriser. It is not a
 *     prediction of anyone's graphics card.
 *   · JS and GPU are NOT independent resources here. They contend for the same
 *     cores, so the split is compressed toward whichever is bigger, and the
 *     absolute JS figure is inflated by the raster threads beside it.
 *   · Therefore the RATIO transfers as a direction and not as a number, and
 *     only when it is lopsided. "GPU is 80% of the frame under a software
 *     rasteriser" means the frame is dominated by rasterisation WORK — pixels,
 *     passes, overdraw — which is the same work a real GPU does faster. It does
 *     not license "the player is GPU-bound".
 *
 * WHAT DOES TRANSFER, unchanged, to a player's machine:
 *   · draw calls and submitted triangles. They are counts, identical on every
 *     machine, and they are what §4.3 is actually arguing about.
 *   · the SHAPE of the population curve — what N more bodies adds to draws, to
 *     triangles, and to our own JS.
 *   · that the timer query resolves, so the instrument works.
 *
 * The box's load average is printed with every run, per HANDOFF §2.6b, and the
 * renderer process's own CPU time is taken from CDP alongside the wall clock so
 * the contention factor is visible rather than assumed.
 *
 * A SECOND HONEST LIMIT: SAMPLE COUNT. One frame here costs on the order of a
 * second, so a window of a few hundred frames is not affordable and the default
 * is small. `Profiler._band` computes p99 and the 1% low over whatever it has —
 * and below about 100 samples both degenerate to the single worst frame in the
 * window. The table says so on its own face rather than letting three columns
 * of the same number read as three findings.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY tools/_frame.mjs AND NOT A MODE OF smoke.mjs
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The house split is that `tools/_*.mjs` are instruments that print a table for
 * a human and `tools/checks/*.mjs` are suites that assert. This prints a table,
 * so it is an instrument. Three concrete reasons it is not a `--perf` flag on
 * `smoke.mjs`:
 *
 *   · `smoke.mjs` is the boot probe. Its contract is an exit code and it is run
 *     to find out whether the page throws; hanging a multi-minute measuring
 *     mode off it puts the slowest thing in the tree behind the fastest
 *     question anyone asks.
 *   · smoke DRIVES THE GAME HARD on purpose — it fires volleys, spawns a droid
 *     inside the blade, severs it — because it is looking for throws. Every one
 *     of those is a perturbation of the frame this tool exists to measure.
 *   · smoke's own perf step already samples 15 rAF gaps and reports a median.
 *     That is a wall-clock spot check with no split in it; replacing it is not
 *     this tool's job, and duplicating it inside it would be a second timer.
 *
 * What IS reused rather than rewritten: `tools/serve.mjs`'s exported `handler`
 * (the same static server the game is played on, ranges and ETags included),
 * `tools/checks/_browser.mjs`'s `chromiumPath()` and `CHROME_ARGS` (the one
 * place that knows where the browser is and which flags make SwiftShader draw),
 * and smoke's bounded-`requestAnimationFrame` idea, which is the difference
 * between a failed step and a twelve-minute silent hang.
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadavg, cpus } from 'node:os';
import { handler } from './serve.mjs';
import { chromiumPath, CHROME_ARGS } from './checks/_browser.mjs';

const argv = process.argv.slice(2);
/* Both spellings, for smoke.mjs's reason: `--level=x` parsing as "not given"
 * is a silent wrong answer from a flag you did pass. */
const flag = (n, d) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

const LEVEL = flag('level', 'geonosis');
const MODE = flag('mode', 'theline');
const QUALITY = flag('quality', 'high');
const SCALE = parseFloat(flag('scale', '0.6'));
const WIDTH = parseInt(flag('width', '1280'), 10);
const HEIGHT = parseInt(flag('height', '720'), 10);
/** RECORDED samples per window. The loop runs three more — see WARM. */
const FRAMES = parseInt(flag('frames', '16'), 10);
/** Frames run after a rung's change and before its ring is zeroed. A spawn
 *  batch builds colliders and skins on the frame it lands, and that frame is
 *  not what the rung costs. */
const WARM = parseInt(flag('warm', '3'), 10);
/**
 * FRAMES BURNED AFTER THE DEPLOY AND BEFORE THE FIRST RUNG, and this default is
 * a measurement rather than a guess.
 *
 * The first run of this tool put `--warm 3` in front of rung 1 and produced a
 * ladder that ran DOWNHILL: 5120 ms as deployed, 3345 ms with twelve more
 * bodies on the field. Nothing got cheaper. The deploy was still finishing —
 * shader programs still linking, textures still uploading, colliders still
 * settling — so rung 1 was measuring the tail of the load and the population
 * gradient was buried under it. Anything the ladder says is worthless until
 * this stage has flattened, which is why `--settle` is counted in frames, is
 * long by default, and REPORTS what the frame did while it ran.
 *
 * 14 IS NOT ALWAYS ENOUGH AND THE DEFAULT IS NOT RAISED TO HIDE THAT. At load
 * 5 on this four-core box, 14 settle frames left rung 1 drifting 5%; at load 8
 * the same 14 left it drifting 27%, and the run says so in its own error bar
 * rather than quietly averaging a deploy. A number that is right on a quiet box
 * and wrong on a loaded one wants the warning, not a bigger constant.
 */
const SETTLE = parseInt(flag('settle', '14'), 10);
const REINFORCE = parseInt(flag('reinforce', '40'), 10);
const JSON_OUT = flag('json', null);
/** One frame can be seconds here; this is the per-frame ceiling, not the run's. */
const FRAME_CEIL = parseInt(flag('frame-ceiling', '30000'), 10);
const DEPLOY_FRAMES = parseInt(flag('deploy-frames', '40'), 10);

const server = createServer(handler);
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

/**
 * A FRAME, OR AN ERROR — smoke.mjs's rule, and the reason it exists is that a
 * bare `await new Promise(r => requestAnimationFrame(r))` on a render loop that
 * has stopped is indistinguishable from a slow box, for ever.
 */
await page.addInitScript(() => {
  window.__frame = (ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(
      `no animation frame in ${ms} ms — the render loop has stopped`)), ms);
    requestAnimationFrame(() => { clearTimeout(t); res(); });
  });
});

const say = (s) => process.stderr.write(s);
const step = async (name, fn) => {
  say(`▸ ${name} … `);
  const t = Date.now();
  try {
    const r = await fn();
    say(`ok (${((Date.now() - t) / 1000).toFixed(1)} s)\n`);
    return r;
  } catch (e) { say('FAILED\n'); throw e; }
};

await step('load', () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }));

await step(`settings (${MODE} · ${LEVEL} · ${QUALITY})`, async () => {
  await page.evaluate(([level, quality, mode, scale]) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level, quality, mode, resolutionScale: scale, difficulty: 'knight',
      // Silent, and the perf overlay off: the HUD's own readout formats
      // `stats()` every frame and this tool reads `stats()` itself.
      volume: 0, music: 0, showPerf: false,
      /* NO DROPSHIP. `Extraction.beginInsertion` declines on `instantSpawn`,
       * and it is declined here for the same reason `_ledger.mjs` and
       * `_m6.mjs` set it: the first seconds of an insertion are a cinematic in
       * a bay two kilometres up, which is not the frame anybody complains
       * about. The measurement wants boots on the ground. */
      instantSpawn: true,
    }));
  }, [LEVEL, QUALITY, MODE, SCALE]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
});

await step('deploy', async () => {
  await page.click('#btn-deploy');
  /* Waited out in RENDERED FRAMES and not in seconds — smoke.mjs's finding:
   * a 30 s timeout is about fifteen frames on this box, and the frames just
   * after a deploy are the most expensive in the run. */
  return page.evaluate(async ([budget, ceil]) => {
    const shown = () => {
      const h = document.querySelector('#hud');
      return !!h && !h.classList.contains('hidden');
    };
    let f = 0;
    while (!shown()) {
      if (f >= budget) throw new Error(`the HUD was still hidden after ${f} rendered frames`);
      await window.__frame(ceil); f++;
    }
    /* …and the flagship modes stop the world behind a deploy card. A window
     * measured with the card up measures a paused world and reads beautifully. */
    /**
     * …AND THE POINTER LOCK THE GAME CANNOT HAVE, WHICH PAUSES IT ON ARRIVAL.
     *
     * `main.js` binds `input.onLockChange = (locked) => { if (!locked &&
     * screens.state === 'playing') pause(); }`. There is no pointer lock in a
     * headless browser, so `Screens.resume()`'s own `requestLock()` fails, the
     * change fires with a null element, and the game pauses ITSELF one frame
     * after Drop — the world stops on the pause card with no error anywhere and
     * `world.time` frozen at 0. Measured: four frames after Drop, `paused:
     * true`, `#pause` the only screen up, console clean. A window measured
     * there is a window measured on a stopped world, which is the failure mode
     * smoke.mjs names — identical screenshots, everything green, nothing
     * tested.
     *
     * smoke.mjs's answer to the same missing lock is `S.input.locked = true`,
     * "pretend we hold the pointer". This is that, one layer up: the handler
     * that exists to catch a player alt-tabbing out is muted for a harness that
     * can never have the lock in the first place. Nothing else about the pause
     * path is touched.
     */
    window.SABER.input.onLockChange = null;

    const btn = document.getElementById('btn-deploy-drop');
    const card = document.getElementById('deploy-card');
    if (btn && card && !card.classList.contains('hidden')) {
      btn.click();
      await window.__frame(ceil); f++;
    }
    /* THE WORLD IS RUNNING is asked as "does the clock advance", not as
     * `!world.paused`: `frame()` steps the world only while `screens.state ===
     * 'playing'`, and that state is not on `window.SABER`. The clock is. */
    const t0 = window.SABER.world.time;
    await window.__frame(ceil); f++;
    if (!(window.SABER.world.time > t0)) {
      throw new Error('the world clock did not advance after Drop — nothing would be measured');
    }
    return f;
  }, [DEPLOY_FRAMES, FRAME_CEIL]);
});

/**
 * The measuring loop, installed once and called per rung.
 *
 * It does not time anything itself. It zeroes the shipped profiler's ring,
 * spins frames with a hand on the controls, and hands back `stats()` — so what
 * is reported is the instrument PLAN §6 says is built, read where it lives.
 */
await page.evaluate(() => {
  window.__measure = async ({ frames, warm, ceil }) => {
    const S = window.SABER;
    const p = S.engine.profiler;

    /* A HAND ON THE CONTROLS, identical in every rung. An idle frame is not the
     * frame anyone complains about: the blade is lit, the camera is turning and
     * the player is walking, because all three cost draws. */
    S.input.locked = true; S.input.enabled = true;
    let t = 0;
    const drive = () => {
      t += 1 / 60;
      S.input.buttons[0] = (t % 1.7) < 1.1;
      S.input.mouse.dx += Math.sin(t * 5.1) * 22;
      S.input.mouse.dy += Math.sin(t * 3.3 + 1) * 12;
      if (Math.floor(t * 2) % 3 === 0) S.input.keys.add('KeyW'); else S.input.keys.delete('KeyW');
    };

    for (let i = 0; i < warm; i++) { drive(); await window.__frame(ceil); }

    /**
     * ZERO THE RING, don't build a second one.
     *
     * `stats()` reads `frames`/`cpus`/`gpus` over `min(n-3, 600)` samples from
     * index 0, so resetting the counters gives a clean window of exactly this
     * rung — and the `n > 2` gate then drops three more frames, which is why
     * the loop below runs `frames + 3`.
     *
     * `gpuMs` is deliberately NOT nulled. The GPU query is asynchronous by
     * construction and resolves several frames after it is issued, so the ring
     * records the last value that came back; nulling it would write zeros into
     * the head of the window and drag the GPU mean down with a number that
     * means "no answer yet", which is the one thing Profiler's header refuses
     * to do. The `warm` frames above are what make the carried-over value this
     * rung's own.
     */
    p.n = 0; p.i = 0; p.last = 0; p.worst = 0; p.worstAt = 0;
    p.frames.fill(0); p.cpus.fill(0); p.gpus.fill(0);

    const gpu0 = p.gpuMs;
    let moved = 0;
    /**
     * THE DRAW COUNTERS, AVERAGED — because `profiler.calls` is ONE FRAME.
     *
     * `Profiler.end()` copies `renderer.info.render` every frame and keeps the
     * latest; whatever the window's last frame happened to hold is not the
     * rung. Measured, and it is not a small effect: consecutive rungs of the
     * same scene reported 2767, 5708 and 5525 calls with the population
     * unchanged between the last two, because bolts, sparks, corpses and the
     * dust in front of the camera come and go. The counter is the shipped one
     * — this only stops reading it through a keyhole.
     */
    let calls = 0, tris = 0, k = 0, cMin = Infinity, cMax = 0;
    for (let i = 0; i < frames + 3; i++) {
      const before = p.gpuMs;
      drive();
      await window.__frame(ceil);
      if (p.gpuMs !== before) moved++;   // did a timer query actually come back?
      calls += p.calls; tris += p.triangles; k++;
      cMin = Math.min(cMin, p.calls); cMax = Math.max(cMax, p.calls);
    }
    S.input.keys.clear(); S.input.buttons[0] = false;

    const w = S.world;
    const s = p.stats();
    /* THE RAW SERIES, in order. With a window this small a percentile is one
     * observation wearing a statistic's name, and twelve numbers printed in a
     * row say everything a p99 was standing in for — including whether the
     * rung was still drifting, which is the one thing that invalidates the
     * whole ladder. The ring was zeroed at the top of this call and 600 samples
     * are not in reach here, so index order IS time order. */
    const count = Math.min(p.n - 3, p.frames.length);
    const series = Array.from(p.frames.subarray(0, Math.max(0, count)));
    const gseries = Array.from(p.gpus.subarray(0, Math.max(0, count)));
    return {
      stats: s, series, gseries,
      /* HOW MANY TIMES THE GPU NUMBER CHANGED in the window. `gpu: null` and
       * `gpuResolved: 0` is an honest "this machine will not answer"; a low
       * non-zero count is "it answers, but slower than the window" and the
       * percentile column has to be read with that in mind. */
      gpuResolved: moved, gpuOf: frames + 3,
      gpuFirst: gpu0,
      calls: calls / k, triangles: tris / k, callsMin: cMin, callsMax: cMax,
      programs: p.programs, geometries: p.geometries, textures: p.textures,
      enemies: w.enemies.length,
      alive: w.enemies.filter((e) => !e.dead).length,
      bodies: w.physics?.stats?.bodies ?? -1,
      awake: w.physics?.stats?.awake ?? -1,
      time: +w.time.toFixed(1),
    };
  };

  /** The renderer's own name, for the record — a number with no machine on it
   *  is not evidence of anything. */
  window.__gpuId = () => {
    try {
      const gl = window.SABER.engine.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked',
        ext: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
        drawing: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    } catch (e) { return { renderer: String(e), ext: false }; }
  };
});

const gpuId = await page.evaluate(() => window.__gpuId());

/**
 * The renderer process's own CPU time, from CDP, around each window.
 *
 * `_cpuclock.mjs`'s whole point: wall clock on a shared box measures the
 * scheduler as much as the work. In a browser we cannot call `process
 * .cpuUsage()`, but Chromium publishes `ProcessTime` (the renderer process's
 * CPU seconds) and `ScriptDuration` through the Performance domain, so the same
 * wall/CPU ratio is available and is printed instead of assumed. It is the
 * RENDERER process only — the GPU process, where SwiftShader rasterises, is not
 * in it, which is itself worth knowing when reading the JS column.
 */
let cdp = null;
try {
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
} catch { cdp = null; }
const metrics = async () => {
  if (!cdp) return null;
  try {
    const { metrics: m } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(m.map((x) => [x.name, x.value]));
  } catch { return null; }
};

/**
 * THE SETTLE, MEASURED RATHER THAN WAITED OUT.
 *
 * Same loop as a rung, reported as a trace instead of a row: if the frame is
 * still falling when rung 1 starts, every delta below it is the deploy
 * finishing rather than the population changing, and the ladder is unreadable.
 * Printing the trace is what lets a reader tell those two apart instead of
 * trusting a constant.
 */
const settle = await step(`settle (${SETTLE} frames)`, () => page.evaluate(
  (a) => window.__measure(a), { frames: SETTLE, warm: 0, ceil: FRAME_CEIL }));

const rungs = [];
const runRung = async (name, note, prepare) => {
  const before = await metrics();
  const t0 = Date.now();
  if (prepare) await page.evaluate(prepare.fn, prepare.arg);
  const r = await step(`rung "${name}"`, () => page.evaluate(
    (a) => window.__measure(a), { frames: FRAMES, warm: WARM, ceil: FRAME_CEIL }));
  const after = await metrics();
  const wall = (Date.now() - t0) / 1000;
  rungs.push({
    name, note, wall,
    cpuS: before && after ? after.ProcessTime - before.ProcessTime : null,
    scriptS: before && after ? after.ScriptDuration - before.ScriptDuration : null,
    load: loadavg()[0],
    ...r,
  });
};

await runRung('as deployed', `${MODE} fields it`, null);

if (REINFORCE > 0) {
  await runRung(`+${REINFORCE} bodies`, 'same frame, more men', {
    fn: (n) => {
      const w = window.SABER.world;
      /* The mode's OWN archetype, taken off a body already standing, so this
       * adds more of what the level fields rather than a droid the level never
       * spawns — and at the level's own spawn radius, so they are in the same
       * band of the frustum and the same LOD as the rest of the army. */
      const type = w.enemies.find((e) => !e.dead)?.type || 'b1';
      let made = 0;
      for (let i = 0; i < n; i++) {
        const at = w.pickSpawn?.(type);
        if (!at) break;
        w.spawnEnemy(type, at); made++;
      }
      return made;
    },
    arg: REINFORCE,
  });
}

if (!has('no-ink')) {
  await runRung('ink prepass off', 'the second rasterisation, removed', {
    fn: () => {
      /* THE PREPASS ONLY. `Engine.render` calls `outline.prepass(renderer)`
       * inside the GPU query bracket; stubbing it leaves the composite, the
       * ink composite pass and every other pass exactly where they were, still
       * sampling the target (now one rung stale — the picture is wrong and the
       * frame is the point). So the delta against the rung above is the price
       * of drawing the scene a second time, which is the number PLAN §4.3's
       * per-object prepass decision has never had. */
      const o = window.SABER.engine.outline;
      o.__prepass = o.prepass;
      o.prepass = () => {};
      return true;
    },
  });

  /**
   * …AND PUT IT BACK, WHICH IS THE ONLY THING THAT MAKES THE RUNG READABLE.
   *
   * The rungs run in sequence on a LIVE BATTLE: men die, corpses accumulate,
   * the dust in front of the camera thickens, and the frame drifts under the
   * whole ladder for reasons that have nothing to do with what a rung changed.
   * A one-way A→B says "the frame moved" and cannot say whether the prepass or
   * the ten seconds moved it. A→B→A can: if this row comes back to the rung
   * ABOVE the ink-off row, the difference between them is the prepass; if it
   * stays with the ink-off row, the difference was time passing and the ink
   * rung is not evidence of anything.
   */
  await runRung('ink prepass back', 'the A/B/A control', {
    fn: () => { const o = window.SABER.engine.outline; o.prepass = o.__prepass; return true; },
  });
}

await browser.close();
server.close();

/* ── the report ───────────────────────────────────────────────────────── */

const n2 = (v, w = 8, d = 2) => (v == null || Number.isNaN(v) ? '—'.padStart(w) : v.toFixed(d).padStart(w));
const int = (v, w) => (v == null || v < 0 ? '—'.padStart(w) : String(Math.round(v)).padStart(w));

const anyGpu = rungs.some((r) => r.stats?.gpu);
const samples = rungs[0]?.stats?.frames ?? 0;
/** Below this many samples the 1% low IS the single worst frame — `_band`
 *  takes `round(n * 0.01)` samples, so it stays 1 until n reaches 150. */
const DEGENERATE = samples < 150;

console.log('');
console.log('  M4 — the browser frame, read out of a real Chromium   (PLAN.md §6 M4 · §4.3)');
console.log('');
console.log(`  ${MODE} · ${LEVEL} · quality ${QUALITY} · ${WIDTH}x${HEIGHT} × ${SCALE.toFixed(2)}`
  + ` → ${gpuId.drawing ? gpuId.drawing.join('x') : '?'} drawing buffer`);
console.log(`  renderer: ${gpuId.renderer}`);
console.log(`  EXT_disjoint_timer_query_webgl2: ${gpuId.ext ? 'present' : 'ABSENT'}`
  + ` · a query came back on ${rungs.map((r) => `${r.gpuResolved}/${r.gpuOf}`).join(', ')} frames`);
console.log(`  ${samples} recorded frames per rung · load ${loadavg()[0].toFixed(2)} on ${cpus().length} cores`);
console.log('');

/* MEDIANS for the JS and GPU columns, and the split below is taken from them.
 * At sixteen samples a mean is one stall away from being a different number:
 * this run's "as deployed" rung contains a single 7750 ms frame in a window of
 * 2800 ms ones, and it alone moved that rung's mean JS from 88 ms to 532 and
 * its share of the frame from 3% to 17%. The mean of the FRAME is kept because
 * `fps` is derived from it and because that is the number `stats()` leads with;
 * everything used to make a comparison is the median. */
console.log('  rung                 alive  bodies   draws     ktris    frame ms   median     fps'
  + '    JS med   GPU med     p99    1% low');
for (const r of rungs) {
  const s = r.stats;
  if (!s) { console.log(`  ${r.name.padEnd(20)}  — no statistics (fewer than 8 recorded frames)`); continue; }
  console.log(`  ${r.name.padEnd(20)} ${int(r.alive, 5)} ${int(r.bodies, 7)} ${int(r.calls, 7)} `
    + `${int(Math.round(r.triangles / 1000), 9)} ${n2(s.mean, 11)} ${n2(s.median, 8, 0)} ${n2(s.fps, 7)} `
    + `${n2(s.cpu?.median, 9)} ${s.gpu ? n2(s.gpu.median, 9) : 'unavail'.padStart(9)} `
    + `${n2(s.p99, 7, 0)} ${n2(s.low1, 9, 0)}`);
}
console.log('');

/* ── the series, which at this window size is the honest statistic ─────── */
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
/** Second half against first half, as a fraction of the rung's own mean. A rung
 *  still warming up is not a rung, and this is how that is visible. */
const driftOf = (ser) => {
  if (!ser || ser.length < 4) return null;
  const h = Math.floor(ser.length / 2);
  const m = mean(ser);
  return m ? (mean(ser.slice(h)) - mean(ser.slice(0, h))) / m : null;
};
/**
 * THE NOISE FLOOR, so a delta can be said to be a delta.
 *
 * Twelve samples on a box at load 5 on four cores, with one frame in this very
 * run reading 100 ms in the middle of a rung of 3000 ms ones. A mean over that
 * is not a number to subtract two of. So the ladder's deltas are taken on the
 * MEDIAN, and the scale they are judged against is the standard error OF the
 * median estimated from the median absolute deviation — the point of which is
 * that no single wild frame can set either one. A difference smaller than that
 * band is reported as unresolved rather than as a finding, which is the whole
 * of HANDOFF §2.4's rule applied to a number instead of to a claim.
 */
const medianOf = (a) => {
  const x = [...a].sort((p, q) => p - q);
  return x.length ? x[Math.min(x.length - 1, Math.round(0.5 * (x.length - 1)))] : NaN;
};
/** 1.4826 puts the MAD on the same scale as a standard deviation; 1.253 is the
 *  median's efficiency penalty against the mean. */
const seMedian = (a) => {
  if (!a || a.length < 3) return NaN;
  const m = medianOf(a);
  return 1.253 * 1.4826 * medianOf(a.map((v) => Math.abs(v - m))) / Math.sqrt(a.length);
};
/**
 * …AND THE STANDARD ERROR ALONE IS TOO NARROW A BAND, MEASURED.
 *
 * A standard error assumes independent draws. These are not: a rung's sixteen
 * frames are consecutive seconds of one battle on one loaded box, so they
 * TREND, and the error on a trending series is dominated by where the trend was
 * when the window opened rather than by the scatter inside it. Two runs of this
 * tool an hour apart, same flags, disagreed in SIGN on what forty more bodies
 * cost — +10.0 ms a body against −3.7 — and both cleared a ±121 and a ±152 ms
 * band computed this way. A band that certifies a negative cost per body is not
 * a band.
 *
 * So the wander a rung shows ACROSS ITS OWN WINDOW is added to it. That is a
 * lower bound on the wander between two rungs measured a minute apart, it is
 * already being computed for the drift column, and it costs nothing. It is not
 * a confidence interval and is not called one.
 */
const bandOf = (a, b) => {
  const scatter = 2 * Math.hypot(seMedian(a.series), seMedian(b.series));
  const wander = (arr = []) => Math.abs((driftOf(arr) || 0) * mean(arr));
  return { scatter, wander: (wander(a.series) + wander(b.series)) / 2 };
};
const drifts = [];
console.log('  frame ms in order — the ladder is only readable while these are flat');
for (const r of [{ name: `settle (${SETTLE})`, isSettle: true, ...settle }, ...rungs]) {
  const d = driftOf(r.series);
  if (!r.isSettle) drifts.push({ name: r.name, d });
  console.log(`    ${r.name.padEnd(20)} ${r.series.map((v) => String(Math.round(v)).padStart(5)).join('')}`
    + `   drift ${d == null ? '—' : `${(100 * d).toFixed(0)}%`}`
    + `   draws ${r.callsMin}–${r.callsMax}`);
}
console.log('');

/* ── the split, which is the whole question ────────────────────────────── */
console.log('  where the frame goes');
for (const r of rungs) {
  const s = r.stats;
  if (!s) continue;
  const js = s.cpu.median, gpu = s.gpu?.median ?? null, frame = s.median;
  const pct = (v) => (v == null ? '   —  ' : `${(100 * v / frame).toFixed(1).padStart(5)}%`);
  const verdict = gpu == null ? 'no GPU time — cannot say'
    : gpu > js * 1.5 ? 'RASTER-BOUND — the draw dominates our JS'
      : js > gpu * 1.5 ? 'JS-BOUND — our own code dominates the draw'
        : 'BALANCED — neither dominates';
  console.log(`    ${r.name.padEnd(20)} JS ${pct(js)}   GPU ${pct(gpu)}`
    + `   unaccounted ${pct(frame - js - (gpu ?? 0))}   ${verdict}`);
}
console.log('    "unaccounted" is the browser between our end() and the next rAF: compositing,');
console.log('    the page, and on this box the raster threads our JS is waiting behind.');
console.log('    A NEGATIVE unaccounted is not a paradox, it is the GPU query\'s lag: the answer');
console.log('    arrives several frames after it is asked, so `gpus[i]` is an OLDER frame\'s draw');
console.log('    recorded against this frame\'s wall clock. It only shows up while the frame time');
console.log('    is moving, which is the same condition the drift column reports.');
console.log('');

/* The deltas. The point of a ladder is the slope, and a slope typed out by
 * hand from the table above is a number typed twice. */
if (rungs.length > 1) {
  console.log('  what each rung changed — the draw counts are WINDOW MEANS, and the per-frame');
  console.log('  range on the series line above is the width of the thing they are the mean of');
  for (let i = 1; i < rungs.length; i++) {
    const a = rungs[i - 1], b = rungs[i];
    if (!a.stats || !b.stats) continue;
    const d = (x, y) => (y == null || x == null ? null : y - x);
    const sign = (v, f = 0) => `${v >= 0 ? '+' : ''}${v.toFixed(f)}`;
    const bodies = d(a.alive, b.alive);
    /* Medians, not means — see the note on seMedian above. */
    const dFrame = medianOf(b.series) - medianOf(a.series);
    const { scatter, wander } = bandOf(a, b);
    const band = scatter + wander;
    const resolved = Math.abs(dFrame) > band;
    console.log(`    ${a.name} → ${b.name}:  ${sign(bodies)} alive, `
      + `${sign(d(a.calls, b.calls))} draws, ${sign(d(a.triangles, b.triangles) / 1000)}k tris`);
    console.log(`      frame ${sign(dFrame, 0)} ms against ±${band.toFixed(0)} ms `
      + `(scatter ${scatter.toFixed(0)} + wander ${wander.toFixed(0)}) — `
      + (resolved
        ? `RESOLVED${bodies > 0 ? `, ${(dFrame / bodies).toFixed(2)} ms per body` : ''}`
        : 'INSIDE THE NOISE, so this run does not measure it')
      + `   (JS ${sign(d(a.stats.cpu.median, b.stats.cpu.median), 1)} ms)`);
  }
  console.log('');
}

/* ── the one number §4.3 asked for, read off the A/B/A ─────────────────── */
const iOff = rungs.findIndex((r) => r.name === 'ink prepass off');
if (iOff > 0 && rungs[iOff + 1]) {
  const off = rungs[iOff], on = [rungs[iOff - 1], rungs[iOff + 1]];
  const mOff = medianOf(off.series);
  const mOn = mean(on.map((r) => medianOf(r.series)));
  const b1 = bandOf(on[0], off), b2 = bandOf(off, on[1]);
  const band = (b1.scatter + b1.wander + b2.scatter + b2.wander) / 2;
  const cost = mOn - mOff;
  const drawCost = mean(on.map((r) => r.calls)) - off.calls;
  console.log('  the ink prepass, bracketed');
  console.log(`    ${on[0].name} ${medianOf(on[0].series).toFixed(0)} ms  →  ink off `
    + `${mOff.toFixed(0)} ms  →  ${on[1].name} ${medianOf(on[1].series).toFixed(0)} ms`);
  console.log(`    the second rasterisation costs ${cost.toFixed(0)} ms of a `
    + `${mOn.toFixed(0)} ms frame (${(100 * cost / mOn).toFixed(0)}%) and ${drawCost.toFixed(0)} draw calls`
    + `, ±${band.toFixed(0)} ms`);
  console.log(`    ${Math.abs(cost) > band
    ? 'The bracket holds: the frame came back when the pass did, so this is the pass and not the clock.'
    : 'INSIDE THE BAND — this run cannot price the prepass. The bracket is what says so;\n'
      + '    a one-way A→B would have printed the drift as a finding.'}`);
  console.log('');
}

/* ── the error bar, stated by the instrument and not left to the reader ── */
console.log('  what this run is, and is not, evidence for');
console.log(`    · There is no GPU in this container. The "GPU ms" column is ANGLE-on-SwiftShader,`);
console.log('      a software rasteriser on the same cores as our JS, so the two contend and the');
console.log('      absolute figures do not predict a player\'s machine. The DIRECTION of a lopsided');
console.log('      split, the draw calls and the triangles do transfer; the milliseconds do not.');
console.log(`    · ${gpuId.ext && anyGpu
  ? 'The timer query RESOLVED here, so this same tool answers §4.3 properly on real hardware.'
  : 'The timer query did NOT resolve here — the GPU column is honestly empty, not zero.'}`);
if (DEGENERATE) {
  console.log(`    · ${samples} samples per rung. Profiler._band takes round(n×0.01) worst samples, so`);
  console.log('      at this window size the 1% low and the p99 are BOTH the single worst frame in');
  console.log('      the rung — one observation printed three times, not three findings. Raise');
  console.log('      --frames past 150 on a machine where a frame is not a second to separate them.');
}
for (const w of drifts) {
  if (w.d != null && Math.abs(w.d) > 0.15) {
    console.log(`    · rung "${w.name}" drifted ${(100 * w.d).toFixed(0)}% ACROSS ITS OWN WINDOW. It had not`);
    console.log('      settled, so its row is a moving average and the delta either side of it is not');
    console.log('      a population effect. Raise --settle and --warm before quoting that row.');
  }
}
for (const r of rungs) {
  if (r.cpuS == null) continue;
  console.log(`    · rung "${r.name}": ${r.wall.toFixed(1)} s wall, ${r.cpuS.toFixed(1)} s renderer CPU`
    + ` (×${(r.cpuS / r.wall).toFixed(2)} of one core, script ${r.scriptS.toFixed(1)} s)`
    + `, load ${r.load.toFixed(2)}.`);
}
if (rungs.some((r) => r.cpuS != null)) {
  console.log('      Renderer process only: SwiftShader rasterises in the GPU process and is not in');
  console.log('      that figure, which is why it is well under the wall clock on a frame this slow.');
}
if (errors.length) {
  console.log('');
  console.log(`  ${errors.length} page error(s) during the run — the frame was measured anyway:`);
  for (const e of [...new Set(errors)].slice(0, 5)) console.log(`    ✖ ${e.slice(0, 160)}`);
}
console.log('');

if (JSON_OUT) {
  await mkdir(dirname(JSON_OUT), { recursive: true });
  await writeFile(JSON_OUT, JSON.stringify({
    level: LEVEL, mode: MODE, quality: QUALITY, scale: SCALE, width: WIDTH, height: HEIGHT,
    frames: FRAMES, settleFrames: SETTLE, gpuId, load: loadavg(), cores: cpus().length,
    settle, rungs, errors,
  }, null, 2));
  console.log(`  wrote ${JSON_OUT}`);
}
