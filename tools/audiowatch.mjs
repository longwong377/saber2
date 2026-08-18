/**
 * BATTLEFRONT BORZ — why does the sound stop?
 *
 * "The sound is really buggy and totally silent in most situations, comes in
 * and out." That is not a thing you can read your way to. leakwatch.mjs proved
 * the renderer's resources by sampling the numbers that accumulate; this does
 * the same for the audio graph, and adds the one measurement that settles the
 * argument outright: the RMS and peak of what actually leaves `master`.
 *
 * A voice counter that never comes back down and a master output that reads
 * 0.000 are two different bugs; without a meter you cannot tell them apart, and
 * this file has been "fixed" twice by reading.
 *
 * What it samples, twice a second, over a real session:
 *   ctx/ctxT    context state and the audio clock — a frozen clock is silence
 *   live/peak   voices held out of the pool, and the high-water mark
 *   alloc/freed cumulative — these must converge, and `live` must return to ~0
 *   deny        one-shots refused because their band was full (starvation)
 *   threw       exceptions inside a voice, the historical source of leaks
 *   drop        sounds refused because the context was not running
 *   pan         panners built; anything above `alloc` is an orphan on the bus
 *   cull        sounds judged too far away to be worth a voice
 *   mast/sfx/…  every bus gain, because any one of them at 0 is total silence
 *   red         compressor gain reduction in dB — pumping reads as in-and-out
 *   rms/peak    the signal at master, measured continuously by a tap node
 *
 * The summary at the end is the part that settles it: how many of the sounds
 * the game asked for actually got a voice, broken down by which sound.
 *
 *   node tools/audiowatch.mjs [--level colosseum] [--seconds 40] [--hide 15]
 *
 * `--hide N` fakes a tab switch at N seconds (suspend + visibilitychange), the
 * exact event the player describes as the sound going away and not coming back.
 * `--fast` skips wall-clock pacing and hammers the pool as hard as it can; the
 * RMS column is meaningless there, the leak columns are not.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveLevel, installFrameHelper, deployAndWait, waitFramesFor } from './_level.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
/**
 * THE DEFAULT WAS `arena`, WHICH IS NOT A LEVEL AND HAS NOT BEEN FOR A WHILE.
 *
 * `World.loadLevel` resolves `LEVELS[key] ? key : LEVEL_ORDER[0]` — a safety
 * net for a player with a stale profile and a trap for an instrument (HANDOFF
 * §2.7). So every audiowatch run since the roster cull has measured the Ember
 * Shelf while printing `level arena` at the top of its own report, and
 * `Audio.js:31` still quotes "the arena run was worse, 1331 refusals" as the
 * evidence the current band layout was sized on. That number is from a level
 * that does not exist, measured on one that was never named.
 *
 * `null` here and the roster is asked at the page — see `_level.mjs`. A key
 * this build does not have is now refused OUT LOUD instead of substituted, and
 * with no `--level` the tool takes whatever the build opens with rather than a
 * name typed here that can rot the same way.
 *
 * `tools/checks/roster.mjs` could not have caught this: its scan has eight
 * syntactic forms for a level name and `opt('level', 'arena')` — a default
 * argument to this file's own flag parser — matched none of them. It matches
 * the eighth now.
 */
const LEVEL = opt('level', null);
const SECONDS = Number(opt('seconds', 40));
const HIDE_AT = Number(opt('hide', -1));
const HIDE_FOR = Number(opt('hide-for', 4));
const FAST = args.includes('--fast');
const PORT = 8131;

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)],
  { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    // Headless has no speakers, but it does have a full WebAudio graph running
    // against a null sink: currentTime advances, nodes render, and a tap node
    // sees exactly the samples a card would have been handed.
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=AudioServiceOutOfProcess'],
});
const page = await browser.newPage();
// `window.__frame()` before any navigation, so the deploy below waits in frames.
await installFrameHelper(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
const level0 = await resolveLevel(page, LEVEL);
await page.evaluate((level) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level, quality: 'low', resolutionScale: 0.4, difficulty: 'knight', mode: 'roguelite',
    // Full volume: this test is about whether sound comes out, so the one
    // setting that would trivially explain silence has to be ruled out.
    volume: 0.8, music: 0.45, grassScale: 0.5, particleScale: 0.6,
  }));
}, level0);
await page.reload({ waitUntil: 'domcontentloaded' });
/* IN FRAMES, NOT SECONDS — HANDOFF §2.6. One frame through swiftshader is up
 * to 4151 ms, so the 60 s this replaces was about fourteen frames and the
 * 800 ms was under one. */
await waitFramesFor(page, '#btn-deploy', { frames: 60 });
await deployAndWait(page, { settle: 2 });

/* ── instrument, from outside the file under test ──────────────────────
 * Counting from the harness rather than from Audio.js means the before and
 * after numbers are produced by the same instrument, and a "fix" cannot
 * accidentally be a change to the meter.
 */
const setup = await page.evaluate(({ fast }) => {
  const S = window.SABER, A = S.audio;
  if (!A.ctx) return { error: 'AudioContext was never created — init() never ran' };

  const M = { alloc: 0, freed: 0, deny: 0, threw: 0, panners: 0, pannerFreed: 0, culled: 0,
    byTag: {}, denyTag: {}, callTag: {}, peakLive: 0, stepDist: [] };
  window.__AM = M;
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  // Attribute every allocation to the top-level sound that asked for it, and
  // count the CALLS separately from the voices they won: the gap between the
  // two is the starvation.
  A.__tag = null;
  for (const name of ['swing', 'clash', 'deflect', 'cut', 'blaster', 'boltHit', 'explosion',
    'force', 'step', 'thud', 'ui', 'noise', 'tone']) {
    const f = A[name];
    if (typeof f !== 'function') continue;
    A[name] = function (...a) {
      const prev = A.__tag;
      A.__tag = prev || name;
      if (!prev) {
        bump(M.callTag, name);
        if (name === 'step' && a[0]) M.stepDist.push(A._listenerPos.distanceTo(a[0]));
      }
      try { return f.apply(this, a); } finally { A.__tag = prev; }
    };
  }

  // Forward every argument: the pool takes a priority now, and swallowing it
  // here would have measured a change that the game never made.
  const voice = A._voice.bind(A);
  A._voice = function (...a) {
    const ok = voice(...a);
    if (ok) { M.alloc++; bump(M.byTag, A.__tag || '?'); if (A.voices > M.peakLive) M.peakLive = A.voices; }
    else { M.deny++; bump(M.denyTag, A.__tag || '?'); }
    return ok;
  };
  const rel = A._release.bind(A);
  A._release = function () { if (A.voices > 0) M.freed++; return rel(); };

  // A panner built for a sound that never plays is invisible to the voice
  // counter but sits in the graph for the rest of the session. Counting them
  // at the constructor catches it wherever the ordering mistake is made.
  const pan = A._panner.bind(A);
  A._panner = function (...a) { M.panners++; return pan(...a); };
  const reach = A._reach ? A._reach.bind(A) : null;
  if (reach) A._reach = function (...a) { const r = reach(...a); if (r === 0) M.culled++; return r; };

  // Continuous meter on the master output. An AnalyserNode only sees the last
  // 2048 samples, which at two samples a second would miss 96% of the session;
  // a processor node sees every block that is rendered.
  let peak = 0, sumsq = 0, n = 0, blocks = 0;
  try {
    const tap = A.ctx.createScriptProcessor(4096, 1, 1);
    tap.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      blocks++;
      for (let i = 0; i < d.length; i++) { const v = d[i]; const a = v < 0 ? -v : v; if (a > peak) peak = a; sumsq += v * v; n++; }
    };
    A.master.connect(tap);
    // A processor with no output connection is not guaranteed to be pulled.
    const sink = A.ctx.createGain(); sink.gain.value = 0;
    tap.connect(sink); sink.connect(A.ctx.destination);
    window.__AMmeter = () => { const r = { peak, rms: n ? Math.sqrt(sumsq / n) : 0, blocks }; peak = 0; sumsq = 0; n = 0; blocks = 0; return r; };
  } catch (e) {
    window.__AMmeter = () => ({ peak: -1, rms: -1, blocks: -1 });
  }

  // Under SwiftShader a drawn frame costs about a second, which would make a
  // wall-clock audio test measure the renderer instead of the mixer. The game's
  // own loop still drives everything else, at real time.
  const realRender = S.engine.render.bind(S.engine);
  S.engine.render = () => {};
  window.__AMrestoreRender = () => { S.engine.render = realRender; };

  // Keep a fight going: the blade swinging, the trigger held half the time.
  const begin = S.input.begin.bind(S.input);
  let t = 0;
  S.input.begin = (dt) => {
    begin(dt);
    t += dt;
    S.input.mouse.dx += 40 * Math.sin(t * 7.3);
    S.input.mouse.dy += 22 * Math.cos(t * 5.1);
    S.input.buttons[0] = (Math.floor(t * 1.5) % 2) === 0;
  };

  if (fast) {
    // No pacing: run the sim as fast as the CPU allows, on top of the real loop.
    window.__AMfast = setInterval(() => {
      for (let i = 0; i < 60; i++) { try { S.world.update(1 / 60, S.input); } catch (e) {} }
    }, 0);
  }
  return { state: A.ctx.state, rate: A.ctx.sampleRate, maxVoices: A.maxVoices };
}, { fast: FAST });

if (setup.error) { console.log('\n  ' + setup.error + '\n'); await browser.close(); stop(); process.exit(1); }
console.log(`\n  level ${level0}  ctx ${setup.state} @ ${setup.rate}Hz  pool ${setup.maxVoices}${FAST ? '  [fast]' : ''}\n`);

const rows = [];
const t0 = Date.now();
let hidden = false;
while ((Date.now() - t0) / 1000 < SECONDS) {
  await page.waitForTimeout(500);
  const t = (Date.now() - t0) / 1000;
  if (HIDE_AT > 0 && !hidden && t >= HIDE_AT) {
    hidden = true;
    // The real thing a tab switch does: the context is suspended by the browser
    // and a visibilitychange is delivered. Nothing else changes.
    await page.evaluate(() => { window.SABER.audio.ctx.suspend(); document.dispatchEvent(new Event('visibilitychange')); });
  }
  if (hidden && t >= HIDE_AT + HIDE_FOR && hidden !== 'done') {
    hidden = 'done';
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  }
  rows.push(await page.evaluate((wall) => {
    const A = window.SABER.audio, M = window.__AM, m = window.__AMmeter();
    const gv = (g) => (g && g.gain ? +g.gain.value.toFixed(3) : -1);
    return {
      t: +wall.toFixed(1),
      ctx: A.ctx.state[0],                       // r(unning) | s(uspended) | c(losed)
      ctxT: +A.ctx.currentTime.toFixed(1),
      live: A.voices,
      peakLive: M.peakLive,
      alloc: M.alloc, freed: M.freed, deny: M.deny,
      threw: A.stats ? A.stats.threw : -1,
      drop: A.stats ? A.stats.dropped : -1,
      pan: M.panners,
      cull: M.culled,
      mast: gv(A.master), sfx: gv(A.sfxBus), mus: gv(A.musicBus),
      // How hard the bus compressor is squeezing, in dB. A mix that is being
      // ducked 15 dB by a burst of footsteps sounds exactly like sound that
      // "comes in and out", and no voice counter would show it.
      red: A.comp ? +A.comp.reduction.toFixed(1) : 0,
      en: window.SABER.world ? window.SABER.world.enemies.filter((e) => !e.dead).length : -1,
      // Footstep CALLS since the last sample, against the number of bodies that
      // could be making them. A walking biped puts down about two feet a
      // second; anything near that per enemy is the mixer's problem, and
      // anything an order of magnitude above it is the animator's.
      stp: (() => { const n = M.callTag.step || 0, d = n - (M._lastStep || 0); M._lastStep = n; return d; })(),
      rms: +m.rms.toFixed(5), peak: +m.peak.toFixed(4), blk: m.blocks,
    };
  }, t));
}

if (FAST) await page.evaluate(() => clearInterval(window.__AMfast));

// Let everything in flight retire, then read the pool again. A healthy pool
// drains to zero here; a leaking one is exactly as full as it was.
await page.waitForTimeout(3000);
const drained = await page.evaluate(() => {
  const A = window.SABER.audio, M = window.__AM;
  const d = M.stepDist.slice().sort((a, b) => a - b);
  return { live: A.voices, alloc: M.alloc, freed: M.freed, deny: M.deny,
    byTag: M.byTag, denyTag: M.denyTag, callTag: M.callTag, orph: M.panners,
    stepMed: d.length ? +d[d.length >> 1].toFixed(1) : -1,
    stepP90: d.length ? +d[Math.floor(d.length * 0.9)].toFixed(1) : -1,
    stepMax: d.length ? +d[d.length - 1].toFixed(1) : -1 };
});

const cols = Object.keys(rows[0]);
const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
console.log('  ' + cols.map((c, i) => c.padStart(w[i])).join(' '));
for (const r of rows) console.log('  ' + cols.map((c, i) => String(r[c]).padStart(w[i])).join(' '));

console.log(`\n  after 3s of quiet: live=${drained.live}  alloc=${drained.alloc}  freed=${drained.freed}` +
  `  leaked=${drained.alloc - drained.freed}  denied=${drained.deny}` +
  `  panners=${drained.orph} (${drained.orph - drained.alloc} more than voices)`);
const heard = rows.filter((r) => r.peak > 0.0005).length;
console.log(`  audible samples: ${heard}/${rows.length}   loudest peak ${Math.max(...rows.map((r) => r.peak)).toFixed(4)}` +
  `   silent stretch ${(() => { let m = 0, c = 0; for (const r of rows) { if (r.peak <= 0.0005) { c++; if (c > m) m = c; } else c = 0; } return (m * 0.5).toFixed(1); })()}s`);

const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ');
console.log(`\n  asked for, by sound:   ${top(drained.callTag) || '(none)'}`);
console.log(`  got a voice:           ${top(drained.byTag) || '(none)'}`);
console.log(`  refused (pool full):   ${top(drained.denyTag) || '(none)'}`);
const asked = Object.values(drained.callTag).reduce((a, b) => a + b, 0);
console.log(`  ${asked} requests in ${SECONDS}s = ${(asked / SECONDS).toFixed(0)}/s` +
  `   footstep range: median ${drained.stepMed} m, p90 ${drained.stepP90} m, max ${drained.stepMax} m`);

if (errors.length) {
  console.log(`\n  ${errors.length} page error(s):`);
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('   x ' + e.slice(0, 300));
}

await browser.close();
stop();
