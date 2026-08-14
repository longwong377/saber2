/**
 * Headless smoke test: boot the game, deploy, play for a few seconds of
 * simulated input, and report every console error, page error and failed
 * request along the way. Also grabs screenshots so the frame can be eyeballed.
 *
 *   node tools/smoke.mjs [--shots] [--seconds 6] [--level alpine]
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = process.env.SMOKE_OUT || join(ROOT, '.smoke');
const args = process.argv.slice(2);
// Both spellings. `--level=alpine` used to parse as "no --level given" and take
// the default, which is a silent wrong answer from a flag you did pass.
const flag = (n, d) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const has = (n) => args.includes('--' + n);

const SECONDS = parseFloat(flag('seconds', '6'));
const FRAMES = parseInt(flag('frames', '40'), 10);
/**
 * Null means "whichever level the game lists first", resolved against the real
 * roster once the page is up (see the settings step). It was the literal
 * `'dunes'`, and it outlived that level: the harness went on writing a dead key
 * into the profile, the world quietly substituted a level it could load, and
 * the run failed several steps later somewhere else entirely. A harness that
 * names content is a harness that stops testing the game when the content
 * moves — and this one is the boot probe, so it is the last place that should
 * be reporting a phantom failure.
 */
const LEVEL = flag('level', null);
const QUALITY = flag('quality', 'medium');
const MODE = flag('mode', 'roguelite');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const url = `http://127.0.0.1:${port}/`;
console.log('serving', ROOT, '→', url);

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--enable-webgl2-compute-context',
    '--disable-features=IsolateOrigins,site-per-process',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

/**
 * A FRAME, OR AN ERROR — never a wait that does not end.
 *
 * Three probes below drive the game by spinning on `requestAnimationFrame`:
 * seventy frames of mouse for the deflection volley, ninety for the perf
 * sample. `await new Promise(r => requestAnimationFrame(r))` has no bound, and
 * if the frame loop ever stops — a throw inside `world.update`, a pause nobody
 * cleared, a lost WebGL context — that promise is simply never called back.
 *
 * Measured, because it happened: a run wrote four screenshots, entered the
 * deflection probe and never came out. Twelve minutes later it was still there,
 * had produced NO output at all, and the only evidence of where it stopped was
 * which screenshot was missing. That is the worst failure a smoke test can
 * have — the tool that exists to tell you the game is alive, hanging, silently,
 * in a way indistinguishable from being slow.
 *
 * Installed on `window` before any navigation so every probe can reach it.
 */
await page.addInitScript(() => {
  window.__frame = (ms = 8000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(
      `no animation frame in ${ms} ms — the render loop has stopped`)), ms);
    requestAnimationFrame(() => { clearTimeout(t); res(); });
  });

  /**
   * PLAY FOR A LENGTH OF GAME TIME, not for a number of rendered frames — and
   * the difference is the whole reason the probes below could not finish.
   *
   * They counted frames: 90 for the blade sweep, 70 for the deflection volley.
   * On a machine with a GPU that is about a second and a half of play at 60 Hz,
   * which is what they were written against and what they mean.
   *
   * There is no GPU in this container. Everything goes through swiftshader on
   * the CPU, and measured on an EMPTY field — 801 draw calls, 1.6 M triangles
   * at 1280x720 — one frame takes 4151 ms. So 90 frames is not a second and a
   * half, it is SIX AND A QUARTER MINUTES, and `main.js` clamps `dt` to 0.1 s,
   * so those 90 frames also hand the game nine seconds of play rather than one
   * and a half. The probe was wrong in both directions at once: far too slow to
   * finish, and testing something other than what it says.
   *
   * Frames are the wrong unit for a probe that means "play for a moment".
   * `world.time` is the right one, and it is correct in both environments: on a
   * GPU this runs ~90 frames for 1.5 s of play, here it runs ~15 for the same
   * 1.5 s. `maxFrames` is a backstop so a stalled clock cannot spin for ever.
   */
  window.__play = async (gameSeconds, onFrame, maxFrames = 300) => {
    const w = window.SABER?.world;
    if (!w) throw new Error('no world to play');
    const t0 = w.time;
    let n = 0;
    while (w.time - t0 < gameSeconds && n < maxFrames) {
      onFrame?.(n);
      await window.__frame();
      n++;
    }
    return { frames: n, played: +(w.time - t0).toFixed(2) };
  };
});

const errors = [];
const warnings = [];
const logs = [];
page.on('console', (m) => {
  const text = `${m.type()}: ${m.text()}`;
  if (m.type() === 'error') errors.push(text);
  else if (m.type() === 'warning') warnings.push(text);
  else logs.push(text);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));

/**
 * A STEP THAT CANNOT RUN FOREVER, AND SAYS WHERE IT IS WHILE IT RUNS.
 *
 * Two things were wrong and they compounded. The deadline is the first: any
 * step could hang and the tool would sit there, so `Promise.race` turns a stuck
 * step into a failed step, which is a result.
 *
 * The second is why the hang was invisible. Progress went to `process.stdout`
 * with no newline, and Node BUFFERS stdout when it is a pipe — so `node
 * tools/smoke.mjs > out.txt` on a hung run produced a zero-byte file. Not a
 * truncated trace: nothing at all, for twelve minutes, with no way to tell
 * which step was stuck. Progress goes to stderr now, for the reason verify.mjs
 * puts its suite names there — the result table is what stdout is for, and a
 * trace you cannot see during the run is not a trace.
 */
const STEP_MS = parseInt(flag('step-timeout', '90000'), 10);
const step = async (name, fn) => {
  process.stderr.write(`▸ ${name} … `);
  let timer;
  try {
    const r = await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(
        new Error(`timed out after ${STEP_MS} ms`)), STEP_MS); }),
    ]);
    process.stderr.write('ok\n');
    return r;
  } catch (e) {
    process.stderr.write('FAILED\n');
    errors.push(`step "${name}": ${e.message}`);
    return null;
  } finally { clearTimeout(timer); }
};

await step('load', async () => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
});

/**
 * The roster, asked of the running game rather than kept in step with it by
 * hand. The page has the importmap, so this is the same module the game itself
 * loaded — no second copy of three, no loader flags on the harness.
 */
const ROSTER = await step('roster', () =>
  page.evaluate(() => import('/src/game/Levels.js').then((m) => m.LEVEL_ORDER))) || [];

await step('preset settings', async () => {
  // A named level must EXIST. Silently substituting for a typo is how you spend
  // an afternoon reading a screenshot of the wrong map.
  if (LEVEL && ROSTER.length && !ROSTER.includes(LEVEL)) {
    throw new Error(`no level "${LEVEL}" — the game lists ${ROSTER.join(', ')}`);
  }
  const level = LEVEL || ROSTER[0];
  await page.evaluate(([level, quality, mode]) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level, quality, resolutionScale: 0.6, difficulty: 'knight', mode,
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6,
    }));
  }, [level, QUALITY, MODE]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  return level;
});

await step('boot completes', async () => {
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 60000 });
});

if (has('shots')) await page.screenshot({ path: join(OUT, '01-menu.png') });

await step('saber forge tab renders', async () => {
  await page.click('.tab[data-tab="saber"]');
  await page.waitForTimeout(900);
  if (has('shots')) await page.screenshot({ path: join(OUT, '02-forge.png') });
  await page.click('.tab[data-tab="play"]');
});

await step('deploy', async () => {
  await page.click('#btn-deploy');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(1600);
});

if (has('shots')) await page.screenshot({ path: join(OUT, '03-deployed.png') });

await step('report boot diagnostics', async () => {
  const info = await page.evaluate(() => {
    const w = window.SABER?.world;
    return {
      fps: window.SABER?.fps,
      hasWorld: !!w,
      enemies: w?.enemies.length ?? -1,
      props: w?.props.length ?? -1,
      bodies: w?.physics.bodies.length ?? -1,
      statics: w?.physics.staticBoxes.length ?? -1,
      terrainVerts: w?.terrain?.geometry.attributes.position.count ?? -1,
      drawCalls: window.SABER?.engine.renderer.info.render.calls,
      triangles: window.SABER?.engine.renderer.info.render.triangles,
      wave: w?.director.wave,
    };
  });
  console.log('   ', JSON.stringify(info));
});

await step('simulate combat', async () => {
  // The page is not pointer-locked in headless, so drive the sim directly:
  // feed the input layer synthetic mouse deltas and keys the way the browser would.
  await page.evaluate((frames) => {
    const S = window.SABER;
    S.input.locked = true;             // pretend we hold the pointer
    S.input.enabled = true;
    window.__SMOKE_T = 0;
    window.__SMOKE_FRAMES = 0;
    window.__SMOKE_ERR = null;
    window.__SMOKE_DONE = false;
    const tick = () => {
      try {
        window.__SMOKE_FRAMES = (window.__SMOKE_FRAMES || 0) + 1;
        const t = (window.__SMOKE_T += 1 / 60);
        // hold-to-blade is the shipped scheme: without the button down the
        // mouse only turns the camera and the blade is never exercised
        S.input.buttons[0] = (t % 1.7) < 1.1;
        S.input.mouse.dx += Math.sin(t * 5.1) * 26;
        S.input.mouse.dy += Math.sin(t * 3.3 + 1) * 16;
        if (Math.floor(t * 2) % 3 === 0) S.input.keys.add('KeyW'); else S.input.keys.delete('KeyW');
        if (Math.floor(t * 1.5) % 4 === 1) S.input.keys.add('KeyA'); else S.input.keys.delete('KeyA');
        if (t % 2.4 < 0.02) S.input.pressed.add('Space');
        if (t % 3.7 < 0.02) S.input.pressed.add('KeyF');
        if (t % 5.2 < 0.02) S.input.pressed.add('KeyR');
        if (window.__SMOKE_FRAMES < frames) { requestAnimationFrame(tick); return; }
      } catch (e) {
        window.__SMOKE_ERR = (e && e.stack) || String(e);
      }
      S.input.keys.clear();
      S.input.buttons[0] = false;
      window.__SMOKE_DONE = true;
    };
    tick();
  }, FRAMES);
  try {
    // NB: waitForFunction is (fn, arg, options) — passing options second makes
    // them the argument and silently leaves the 30s default in place.
    await page.waitForFunction(() => window.__SMOKE_DONE === true, null,
      { timeout: FRAMES * 3000 + 20000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      frames: window.__SMOKE_FRAMES, err: window.__SMOKE_ERR, done: window.__SMOKE_DONE,
      fps: window.SABER?.fps, alive: !!window.SABER?.world?.player?.alive,
    })).catch(() => null);
    throw new Error(`${e.message} | diag=${JSON.stringify(diag)}`);
  }
  const err = await page.evaluate(() => window.__SMOKE_ERR);
  if (err) throw new Error('inside the sim loop: ' + err);
});

if (has('shots')) await page.screenshot({ path: join(OUT, '04-combat.png') });

await step('force a spawn wave and cut something', async () => {
  const res = await page.evaluate(async () => {
    const w = window.SABER.world;
    const p = w.player;
    const THREE = w.player.position.constructor;
    // put a droid inside the blade's reach and swing through it
    const spawn = p.position.clone();
    spawn.x += 1.1;
    const e = w.spawnEnemy('b1', spawn);
    await new Promise(r => setTimeout(r, 60));
    const before = { hp: e.hp, severed: e.actor?.severedCount ?? 0 };
    // drive the blade physically across the target for a second
    // 1.5 s of blade across the target — the same play the 90-frame loop meant
    // on a GPU, expressed in the unit that survives not having one.
    await window.__play(1.5, (i) => {
      window.SABER.input.mouse.dx += 60 * Math.sin(i * 0.4);
      window.SABER.input.mouse.dy += 40 * Math.cos(i * 0.31);
    });
    return {
      before, hpAfter: e.hp, dead: e.dead,
      severed: e.actor?.severedCount ?? 0,
      pieces: e.actor?.pieces.length ?? 0,
      ragdolled: !!e.actor?.ragdolled,
      bodies: w.physics.bodies.length,
    };
  });
  console.log('   ', JSON.stringify(res));
});

await step('bolts and deflection path', async () => {
  const res = await page.evaluate(async () => {
    const w = window.SABER.world;
    const p = w.player;
    const dir = p.chest.clone().sub(p.chest.clone()).set(0, 0, 0);
    // fire a volley straight at the player from a few metres out
    let fired = 0;
    for (let i = 0; i < 12; i++) {
      const from = p.chest.clone();
      from.x += Math.cos(i) * 7;
      from.z += Math.sin(i) * 7;
      const d = p.chest.clone().sub(from).normalize();
      if (w.bolts.fire(from, d, { speed: 26, damage: 5, team: 1 })) fired++;
    }
    const hp0 = p.hp;
    // A bolt fired from 7 m at 26 m/s arrives in 0.27 s, so 1.2 s is the whole
    // volley plus the swing that answers it.
    await window.__play(1.2, (i) => {
      window.SABER.input.mouse.dx += 55 * Math.sin(i * 0.5);
      window.SABER.input.mouse.dy += 45 * Math.cos(i * 0.37);
    });
    return { fired, deflects: p.deflects, hpLost: +(hp0 - p.hp).toFixed(1), flow: +p.flow.toFixed(2) };
  });
  console.log('   ', JSON.stringify(res));
});

await step('perf sample', async () => {
  const perf = await page.evaluate(async () => {
    const S = window.SABER;
    /* FRAMES ARE THE RIGHT UNIT HERE — this is the one probe that genuinely
     * measures what a frame costs, so it cannot be expressed in game time.
     * What changes is the SAMPLE COUNT: 90 was six minutes in a software
     * renderer, and the median of 15 is the same answer for a distribution
     * this tight. The percentile is named p87 rather than p95 because that is
     * what index 13 of 15 is; the old code took index 85 of 90 and called it
     * p95, which it also was not. */
    const N = 15;
    const samples = [];
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      await window.__frame();
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    return {
      medianMs: +samples[Math.floor(N / 2)].toFixed(2),
      p87Ms: +samples[Math.floor(N * 0.87)].toFixed(2),
      physicsMs: +(S.world.physics.stats.ms).toFixed(2),
      bodies: S.world.physics.stats.bodies,
      // Rapier has no global contact count, and a level at rest should have
      // almost nothing awake — that is the number worth watching.
      awake: S.world.physics.stats.awake,
      colliders: S.world.physics.stats.colliders,
      drawCalls: S.engine.renderer.info.render.calls,
      triangles: S.engine.renderer.info.render.triangles,
      enemies: S.world.enemies.length,
    };
  });
  console.log('   ', JSON.stringify(perf));
});

if (has('shots')) await page.screenshot({ path: join(OUT, '05-final.png') });

await browser.close();
server.close();

console.log('\n──────── result ────────');
if (warnings.length) {
  console.log(`${warnings.length} warning(s):`);
  for (const w of [...new Set(warnings)].slice(0, 12)) console.log('  ⚠', w.slice(0, 300));
}
if (errors.length) {
  console.log(`\n${errors.length} ERROR(S):`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ✖', e.slice(0, 900));
  process.exit(1);
}
console.log('clean — no console errors, no page errors, no failed requests');
