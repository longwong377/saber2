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
const step = async (name, fn, ms = STEP_MS) => {
  process.stderr.write(`▸ ${name} … `);
  let timer;
  try {
    const r = await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(
        new Error(`timed out after ${ms} ms`)), ms); }),
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

/**
 * DEPLOY IS WAITED OUT IN FRAMES, NOT IN SECONDS.
 *
 * This was `waitForSelector('#hud:not(.hidden)', { timeout: 30000 })` followed
 * by a flat 1600 ms. Thirty seconds is a generous wait on a machine with a GPU
 * and it is about FIFTEEN FRAMES here, where §2.6 measures one frame at up to
 * 4.1 s through swiftshader — and the frames just after a deploy are the most
 * expensive in the whole run, because that is where the terrain, the textures
 * and the instanced fields are built. So the step was not asking "did the game
 * deploy"; it was asking "is this box quiet", and under load it answered no.
 * Measured: four steps failed that way in one run while `tools/_deployprobe.mjs`
 * deployed the same build in 22.2 s with zero page errors.
 *
 * A timeout that fires on a loaded box reports a regression that is not there,
 * which is worse than no smoke test — HANDOFF §2.5 counts four of one day's
 * apparent defects as harnesses lying, and this is the fifth.
 *
 * The unit that means what this step means is a RENDERED FRAME. Two conditions
 * replace the clock, and each one is a real regression when it fires:
 *
 *   - the render loop stops producing frames at all (`__frame`'s own ceiling,
 *     which is per-frame and so does not accumulate with the box's slowness);
 *   - the HUD is still hidden after the game has had DEPLOY_FRAMES frames to
 *     show it, which is a deploy that did not happen however long it took.
 *
 * The outer `step` deadline is passed explicitly and sized so it cannot be the
 * thing that decides — it stays only as the backstop for a hang that neither
 * condition above can see.
 */
const DEPLOY_FRAMES = parseInt(flag('deploy-frames', '24'), 10);
const FRAME_CEIL_MS = parseInt(flag('frame-ceiling', '15000'), 10);
await step('deploy', async () => {
  await page.click('#btn-deploy');
  const n = await page.evaluate(async ([budget, ceil]) => {
    const shown = () => {
      const h = document.querySelector('#hud');
      return !!h && !h.classList.contains('hidden');
    };
    let f = 0;
    while (!shown()) {
      if (f >= budget) throw new Error(`the HUD was still hidden after ${f} rendered frames`);
      await window.__frame(ceil);
      f++;
    }
    /* Two settled frames before anything screenshots it — as frames, for the
     * same reason: the 1600 ms this replaces was under one frame here. */
    for (let i = 0; i < 2; i++) { await window.__frame(ceil); f++; }
    return f;
  }, [DEPLOY_FRAMES, FRAME_CEIL_MS]);
  return `HUD up after ${n} rendered frames`;
}, DEPLOY_FRAMES * FRAME_CEIL_MS + 30000);

if (has('shots')) await page.screenshot({ path: join(OUT, '03-deployed.png') });

/**
 * …AND THE DEPLOY CARD, WHICH STOPS THE WORLD ON PURPOSE.
 *
 * FLAGSHIP §5's 0:00 raises an overlay in front of the flagship mode — the
 * seed, the ground and your ten names, read before you land — and `Screens.take`
 * pauses the world behind it. Every step below this line measures a world that
 * is running, so a smoke run with the card up measures NOTHING and says so in
 * the friendliest possible way: identical screenshots, zero enemies, zero
 * damage, all green. Measured on `--mode command` before this: 03-deployed.png
 * and 04-combat.png came out byte-identical at 264 952 bytes.
 *
 * So the card is pressed, exactly as a player presses it, AFTER the screenshot
 * that exists to show it. Silent in every other mode — no card, no button, no
 * click — which is every mode this tool is normally run in.
 *
 * §2.6's rule applies here as everywhere: the settle is counted in RENDERED
 * FRAMES and not in milliseconds, because one frame on this box is four
 * seconds.
 */
await step('drop in', async () => {
  const took = await page.evaluate(async (ceil) => {
    const btn = document.getElementById('btn-deploy-drop');
    const card = document.getElementById('deploy-card');
    if (!btn || !card || card.classList.contains('hidden')) return 'no card — not the flagship mode';
    btn.click();
    await window.__frame(ceil);
    if (!card.classList.contains('hidden')) throw new Error('Drop did not take the card down');
    if (window.SABER?.world?.paused) throw new Error('the world is still paused after Drop');
    return 'the card is down and the world is running';
  }, FRAME_CEIL_MS);
  return took;
}, FRAME_CEIL_MS * 3 + 20000);

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
  /**
   * WHAT MUST BE TRUE, AND WHAT MAY LEGITIMATELY BE ZERO.
   *
   * This step also printed zeros and passed — `severed: 0, pieces: 0` — and
   * unlike the volley below, two of those are fine. A B1 has 28 hp and a blade
   * kills it well before a blind swing happens to cross a limb with the speed
   * and the angle a sever wants; `tools/checks/severance.mjs` is where severing
   * is held to its own rules, with a fixture that aims. Asserting a limb here
   * would be a combat test on a boot probe, and a flaky one.
   *
   * What this step is FOR is that the blade reaches a real body in the real
   * page, and that is the assertion: a droid put inside the blade's reach and
   * swung through for a second and a half must take damage. It caught nothing
   * before because nothing could fail.
   */
  if (!(res.hpAfter < res.before.hp)) {
    throw new Error(`a droid stood 1.1 m inside the blade for 1.5 s and took no damage — `
      + `hp ${res.before.hp} → ${res.hpAfter}. The blade is not reaching bodies in the shipped page`);
  }
});

/**
 * ── ONE BOLT, AND A STEP THAT CAN FAIL ────────────────────────────────────
 *
 * THIS PROBE REPORTED `{"fired":12,"deflects":0,"hpLost":0,"flow":0}` AND WAS
 * CALLED OK. `step()` fails only on a thrown exception, so twelve bolts at a
 * standing player from seven metres could do nothing whatsoever and the run
 * still printed "clean". A diagnostic that can be all zeros and pass certifies
 * nothing, and this is the boot probe — the last place that should be quiet.
 *
 * ── AND THE TWELVE WERE THE DEFECT, NOT THE MEASUREMENT ───────────────────
 *
 * `Player.damage` opens `this.invuln = 0.18` on every hit, and `_boltHitTest`
 * skips a player with `invuln > 0`. `World.update` clamps `dt` to 1/24, so that
 * window is about four frames. Twelve bolts fired in ONE frame from ONE radius
 * all arrive in the same four, so eleven of them are skipped by construction:
 * the volley could never register more than one bolt however well it was aimed.
 *
 * Measured headless on a real World with nothing else on the field, to be sure
 * the aim was not also wrong: fired one at a time, **all twelve land, 4.25 hp
 * each**; fired together, exactly one lands. Two other explanations were tried
 * and disproved on the way — that the aim point `p.chest` sits off the body's
 * collision hull (it does, by 0.24-0.52 m depending on pose, and aiming at the
 * hull's own centre changes nothing), and that the bodies on the field were
 * absorbing the volley (they were cleared; nothing changed).
 *
 * So the probe asks for one bolt, which is the most this path can answer for,
 * and it ASSERTS. What it asserts is the weakest thing that would have caught
 * the zeros: a bolt sent at the player must be ANSWERED — felt as damage, or
 * turned — and never ignored. Not a damage figure and not a deflection count,
 * because the blade is being waved blind here and demanding a particular split
 * would make a combat balance test out of a boot probe.
 *
 * Stated in GAME time, so a slow machine cannot fail it for being slow:
 * `__play` counts `world.time`, and 0.8 game-seconds is ~19 clamped frames
 * whatever the wall clock is doing.
 */
await step('bolts and deflection path', async () => {
  const res = await page.evaluate(async () => {
    const w = window.SABER.world;
    const p = w.player;
    /* ONE ROUND, from the player's left, at the height the body is. */
    const aim = p.chest.clone();
    const from = aim.clone(); from.x += 7;
    const d = aim.clone().sub(from).normalize();
    const fired = w.bolts.fire(from, d, { speed: 26, damage: 5, team: 1 }) ? 1 : 0;
    const hp0 = p.hp, defl0 = p.deflects;
    /* 7 m at 26 m/s arrives in 0.27 s; 0.8 s is the shot plus the swing that
     * answers it, and comfortably inside the 0.18 s i-frame either way. */
    await window.__play(0.8, (i) => {
      window.SABER.input.mouse.dx += 55 * Math.sin(i * 0.5);
      window.SABER.input.mouse.dy += 45 * Math.cos(i * 0.37);
    });
    return { fired, deflects: p.deflects - defl0, hpLost: +(hp0 - p.hp).toFixed(1),
             flow: +p.flow.toFixed(2), invuln: +p.invuln.toFixed(2) };
  });
  console.log('   ', JSON.stringify(res));
  if (res.fired !== 1) throw new Error('the bolt pool refused a single round');
  if (!(res.hpLost > 0 || res.deflects > 0)) {
    throw new Error('a bolt sent at the player from 7 m was neither felt nor turned — '
      + `hpLost ${res.hpLost}, deflects ${res.deflects}. Either it is not arriving or nothing `
      + 'answers it, and both are the defect this step exists to see');
  }
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
