/**
 * BATTLEFRONT BORZ — what does it look like when it MOVES?
 *
 * Every instrument in tools/ measures a still frame. That is why six rounds of
 * measured improvement produced a game the player called janky: the walk, the
 * blade arc, a hit landing and the first-person arms are all MOTION, and
 * nothing here could see motion. `verify.mjs` proves invariants, `pixels.mjs`
 * and `arena-lane.mjs` grade colour and composition, `leakwatch.mjs` watches
 * resources. None of them can tell you the legs look like a crab.
 *
 * The obstacle was assumed to be that headless GL is SwiftShader at ~1 fps.
 * It isn't. Frame RATE only matters if you let wall-clock drive the timestep —
 * and the game's own loop does, `dt = (now - last) / 1000` in main.js. So this
 * takes the loop away from the clock:
 *
 *   requestAnimationFrame is replaced with a queue. Nothing runs until we say.
 *   Then each step invokes the queued callback with a SYNTHETIC timestamp
 *   advanced by exactly 1/60 s. The game computes dt = 16.67 ms and cannot
 *   tell that the wall clock took a second and a half to get there.
 *
 * The result is a deterministic animation, sampled at whatever cadence we
 * choose, composited into ONE contact sheet — because reading twenty-four
 * separate PNGs costs more than reading one, and because a gait is only
 * legible as a strip.
 *
 * Frames are captured by drawing the WebGL canvas into a 2-D canvas in the
 * same task as the render, before the compositor can discard the drawing
 * buffer. That is why the capture lives inside the render wrapper rather than
 * in a screenshot call: a Playwright screenshot happens a task later, which is
 * a coin flip on whether the buffer still exists.
 *
 *   node tools/motion.mjs --clip walk   [--level arena] [--tag before]
 *   node tools/motion.mjs --clip slash  [--cols 6] [--rows 4] [--every 2]
 *   node tools/motion.mjs --clip fpidle
 *   node tools/motion.mjs --clip block
 *
 * Clips are declared in CLIPS below: a camera pose, and a function saying what
 * the player is doing on frame i. Adding one is a dozen lines.
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const CLIP = flag('clip', 'walk');
const LEVEL = flag('level', 'colosseum');
const TAG = flag('tag', 'now');
const COLS = Number(flag('cols', 6));
const ROWS = Number(flag('rows', 4));
const EVERY = Number(flag('every', 2));      // sim steps between captures
const CELL_W = Number(flag('cellw', 320));
const CELL_H = Number(flag('cellh', 180));
const STEP = 1 / 60;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The clips                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Each clip is evaluated INSIDE the page. `camera(i)` returns a pose or null
 * to leave the game's own camera alone; `input(i)` writes the input state for
 * the step about to run.
 *
 * They are strings because they cross into the browser. Keep them small.
 */
const CLIPS = {
  /* The gait, side-on, tracking. A walk cycle read from behind the player is
   * unjudgeable — the whole complaint ("legs like a crab") is about what the
   * knees and feet do in profile. */
  walk: {
    warmup: 30,
    note: 'holding forward, camera tracking side-on at hip height',
    input: `(i, S) => { S.input.keys.add('KeyW'); }`,
    // 2.1 m out and level with the hips. The first version of this sat at
    // 4.2 m and the figure was 90 px tall — you cannot judge a knee at 90 px,
    // which is exactly how a gait defect survives a screenshot review.
    camera: `(i, S) => {
      const p = S.world.player;
      const y = p.position.y;
      return { pos: [p.position.x + 2.1, y + 0.95, p.position.z], look: [p.position.x, y + 0.85, p.position.z] };
    }`,
  },

  /* The same walk with the blade RETRACTED — the control for one question:
   * how much of the wielder's colour is coming from their own saber?
   *
   * The light's hue is the crystal normalised to peak 1 IN LINEAR SPACE, and
   * 0x3ba7ff linear is (0.0034, 0.1236, 1.0), so it has a blue-to-red ratio of
   * 294:1. With decay 1 (1/r, deliberate) and intensity 5.4 it delivers about
   * 10.8 units half a metre from the chest, against a shade budget near 1.2. If
   * that is what is flattening the figure, retracting the blade is the one test
   * that says so without ambiguity. Compare per-pixel R/B on the silhouette.
   */
  walkdark: {
    warmup: 30,
    note: 'walking with the blade retracted — the control for the saber-light hypothesis',
    input: `(i, S) => {
      S.input.keys.add('KeyW');
      const sb = S.world.player.saber;
      sb.lit = false; sb.ignition = 0;
      sb.light.intensity = 0; sb.tipLight.intensity = 0;
    }`,
    camera: `(i, S) => {
      const p = S.world.player;
      const y = p.position.y;
      return { pos: [p.position.x + 2.1, y + 0.95, p.position.z], look: [p.position.x, y + 0.85, p.position.z] };
    }`,
  },

  /* Same, sprinting — a gait solver can look fine at a walk and fall apart at
   * a run, and the duty factor changes at 1.9 and 5.4 m/s. */
  sprint: {
    warmup: 40,
    note: 'forward + sprint, camera tracking side-on at hip height',
    input: `(i, S) => { S.input.keys.add('KeyW'); S.input.keys.add('ShiftLeft'); }`,
    camera: `(i, S) => {
      const p = S.world.player;
      const y = p.position.y;
      return { pos: [p.position.x + 5.0, y + 1.25, p.position.z], look: [p.position.x, y + 0.95, p.position.z] };
    }`,
  },

  /* A full slash. The blade is steered by holding Mouse1 and moving the mouse,
   * so the clip drives a real arc through the guard sphere rather than poking
   * at the saber transform directly — a synthetic pose would prove nothing
   * about what a player actually sees. */
  slash: {
    warmup: 24,
    note: 'blade held, mouse swept right-to-left through an overhead arc',
    input: `(i, S) => {
      S.input.buttons[0] = true;
      const t = i / 24;
      S.input.mouse.dx = Math.cos(t * Math.PI) * -34;
      S.input.mouse.dy = Math.sin(t * Math.PI) * -22;
    }`,
    camera: `(i, S) => {
      const p = S.world.player;
      const y = p.position.y;
      return { pos: [p.position.x + 3.6, y + 1.7, p.position.z + 1.4], look: [p.position.x, y + 1.4, p.position.z] };
    }`,
  },

  /* First person, standing still, doing nothing. This is the frame the player
   * called "a jumbled mess" — it should be judged with no motion confusing it,
   * and then again while walking, because the camera takes only half the
   * pelvis bob and none of the sway. */
  fpidle: {
    warmup: 20, firstPerson: true,
    note: 'first person, standing still, no input',
    input: `(i, S) => {}`,
    camera: `null`,
  },

  fpwalk: {
    warmup: 20, firstPerson: true,
    note: 'first person, walking forward — watch the arms swim against the camera',
    input: `(i, S) => { S.input.keys.add('KeyW'); }`,
    camera: `null`,
  },

  /* A bolt arriving. Fired down the player's own sightline from 18 m so it is
   * guaranteed to be in frame, with the blade held up in guard. */
  block: {
    warmup: 20,
    note: 'a bolt fired at the chest from 18 m, blade held in guard',
    input: `(i, S) => {
      S.input.buttons[0] = true;
      if (i === 4) {
        const w = S.world, p = w.player;
        const fwd = new (w.player.position.constructor)(0, 0, -1).applyQuaternion(p.camera.aimQuat);
        const from = p.chest.clone().addScaledVector(fwd, 18);
        w.bolts.fire(from, fwd.clone().negate(), { speed: 26, team: 9, damage: 8 });
      }
    }`,
    camera: `(i, S) => {
      const p = S.world.player;
      const y = p.position.y;
      return { pos: [p.position.x + 3.2, y + 1.8, p.position.z + 2.2], look: [p.position.x, y + 1.4, p.position.z - 2] };
    }`,
  },

  /* ── DIRECTIONAL BLOCKING ──────────────────────────────────────────────
   * A bolt from 55° to the player's LEFT, answered by flicking into the LEFT
   * guard while the camera keeps turning.
   *
   * Everything is driven through the real input path — the guard button is a
   * real button press and the zone comes from a real mouse delta of 70 px in
   * one frame, over the 1400 px/s flick gate — because poking
   * `control.setZone` would prove the renderer draws a pose and nothing about
   * whether a player can reach it. The steady 9 px/frame underneath is
   * ordinary tracking, and it is there to be VISIBLE: the whole claim of this
   * scheme is that the view is still moving while the block lands.
   */
  guard: {
    warmup: 24,
    note: 'a bolt from 55° left, answered by flicking into the LEFT guard — camera live throughout',
    input: `(i, S) => {
      S.input.buttons[0] = true;                 // hold the guard up
      S.input.mouse.dx = (i === 10) ? -70 : -9;  // one flick, on a bed of ordinary tracking
      if (i === 4) {
        const w = S.world, p = w.player;
        const V = p.position.constructor;
        const a = 55 * Math.PI / 180;
        const d = new V(-Math.sin(a), 0.08, -Math.cos(a)).applyQuaternion(p.camera.aimQuat).normalize();
        w.bolts.fire(p.chest.clone().addScaledVector(d, 11), d.clone().negate(), { speed: 22, team: 9, damage: 8 });
      }
    }`,
    camera: `(i, S) => {
      const p = S.world.player;
      const y = p.position.y;
      return { pos: [p.position.x + 1.0, y + 2.4, p.position.z + 3.4], look: [p.position.x - 0.5, y + 1.35, p.position.z - 0.6] };
    }`,
  },

  /* The same block from the player's own eyes, with the game's camera left
   * alone. This is the sheet that shows the horizon SLIDING while the bolt is
   * being answered — under 'hold' it could not, by construction. */
  guardaim: {
    warmup: 24,
    note: 'the same block down the player own camera — watch the horizon slide while it lands',
    input: `(i, S) => {
      S.input.buttons[0] = true;
      S.input.mouse.dx = (i === 10) ? -70 : -9;
      if (i === 4) {
        const w = S.world, p = w.player;
        const V = p.position.constructor;
        const a = 55 * Math.PI / 180;
        const d = new V(-Math.sin(a), 0.08, -Math.cos(a)).applyQuaternion(p.camera.aimQuat).normalize();
        w.bolts.fire(p.chest.clone().addScaledVector(d, 11), d.clone().negate(), { speed: 22, team: 9, damage: 8 });
      }
    }`,
    camera: `null`,
  },
};

const clip = CLIPS[CLIP];
if (!clip) {
  console.error(`unknown clip "${CLIP}". known: ${Object.keys(CLIPS).join(', ')}`);
  process.exit(1);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Booting — same shape as arena-lane.mjs, deliberately                  */
/* ══════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

async function boot(level, firstPerson) {
  const { chromium } = await import('playwright-core');
  const { createServer } = await import('node:http');
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.play.html';
      const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(([lv, fp]) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6, instantSpawn: true, firstPerson: !!fp }));
  }, [level, firstPerson]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
  await page.click('#btn-deploy', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(2200);
  // Freeze the weather for the same reason arena-lane does: a squall is worth
  // 3x the authored fog and would make two runs of the same build different
  // pictures. Reached through the live object graph, never a fresh import().
  await page.evaluate(async () => {
    const W = window.SABER.world.atmosphere?.weather;
    if (W) { W.peak = 0; W.unrest = 0; W.update(0); }
    await new Promise((r) => requestAnimationFrame(r));
  });
  await page.waitForTimeout(1200);
  return { page, browser, server, errors };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Run                                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

const out = join(ROOT, '.smoke', 'motion');
mkdirSync(out, { recursive: true });

const { page, browser, server, errors } = await boot(LEVEL, !!clip.firstPerson);

const result = await page.evaluate(async (cfg) => {
  const S = window.SABER;
  const inputFn = eval(cfg.inputSrc);
  const cameraFn = cfg.cameraSrc === 'null' ? null : eval(cfg.cameraSrc);

  // ── take the loop away from the wall clock ─────────────────────────────
  // main.js does `dt = (now - last) / 1000` off the rAF timestamp, so owning
  // the timestamp owns the timestep. Queue the callbacks instead of scheduling
  // them and nothing advances until step() says so.
  const realRAF = window.requestAnimationFrame.bind(window);
  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  // Let the already-scheduled callback land in the queue rather than running.
  await new Promise((r) => realRAF(r));

  // ── the sheet ──────────────────────────────────────────────────────────
  const sheet = document.createElement('canvas');
  sheet.width = cfg.cols * cfg.cellW;
  sheet.height = cfg.rows * cfg.cellH;
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#101014';
  sc.fillRect(0, 0, sheet.width, sheet.height);

  const gl = S.engine.renderer.domElement;
  const total = cfg.cols * cfg.rows;
  let captured = 0;

  // Capture INSIDE the render wrapper. A screenshot one task later is a coin
  // flip on whether the drawing buffer still exists; drawImage in the same
  // task as the draw is not.
  const origRender = S.engine.render.bind(S.engine);
  let wantCapture = false, frameIdx = 0, simT = 0;
  S.engine.render = (dt) => {
    if (cameraFn) {
      const pose = cameraFn(frameIdx, S);
      if (pose) {
        const c = S.engine.camera;
        c.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        c.lookAt(pose.look[0], pose.look[1], pose.look[2]);
        c.updateMatrixWorld(true);
      }
    }
    origRender(dt);
    if (!wantCapture || captured >= total) return;
    const col = captured % cfg.cols, row = (captured / cfg.cols) | 0;
    const x = col * cfg.cellW, y = row * cfg.cellH;
    sc.drawImage(gl, x, y, cfg.cellW, cfg.cellH);
    sc.strokeStyle = 'rgba(255,255,255,0.22)';
    sc.strokeRect(x + 0.5, y + 0.5, cfg.cellW - 1, cfg.cellH - 1);
    sc.font = '11px monospace';
    sc.fillStyle = 'rgba(0,0,0,0.72)';
    sc.fillRect(x + 3, y + 3, 74, 15);
    sc.fillStyle = '#c8f0ff';
    sc.fillText(`${captured}  ${simT.toFixed(2)}s`, x + 6, y + 14);
    captured++;
  };

  document.querySelector('#hud')?.classList.add('hidden');

  // ── the stepper ────────────────────────────────────────────────────────
  let clock = performance.now();
  async function step(capture) {
    wantCapture = capture;
    clock += cfg.stepMs;
    simT += cfg.stepMs / 1000;
    const pending = queue; queue = [];
    for (const cb of pending) {
      try { cb(clock); } catch (e) { return String(e && e.message || e); }
    }
    // Give the compositor a turn so SwiftShader actually finishes the frame.
    await new Promise((r) => realRAF(r));
    return null;
  }

  // Warm up so the gait is in its steady state rather than its first stride.
  for (let i = 0; i < cfg.warmup; i++) {
    inputFn(i, S);
    const err = await step(false);
    if (err) return { error: err, phase: 'warmup', i };
  }

  frameIdx = 0;
  const stepsNeeded = total * cfg.every;
  for (let i = 0; i < stepsNeeded && captured < total; i++) {
    frameIdx = i;
    inputFn(i, S);
    const err = await step(i % cfg.every === 0);
    if (err) return { error: err, phase: 'clip', i };
  }

  S.engine.render = origRender;
  window.requestAnimationFrame = realRAF;

  return {
    captured,
    simSeconds: simT,
    png: sheet.toDataURL('image/png'),
    fps: S.fps,
  };
}, {
  inputSrc: clip.input, cameraSrc: clip.camera,
  cols: COLS, rows: ROWS, cellW: CELL_W, cellH: CELL_H,
  every: EVERY, warmup: clip.warmup ?? 20, stepMs: STEP * 1000,
});

await browser.close(); server.close();

if (result.error) {
  console.error(`clip threw during ${result.phase} step ${result.i}: ${result.error}`);
  if (errors.length) console.error('page errors:', errors.slice(0, 6));
  process.exit(1);
}

const file = join(out, `${TAG}-${LEVEL}-${CLIP}.png`);
writeFileSync(file, Buffer.from(result.png.split(',')[1], 'base64'));
console.log(`${CLIP} on ${LEVEL}: ${result.captured} frames, `
  + `${(EVERY * STEP * 1000).toFixed(1)} ms apart, ${result.simSeconds.toFixed(2)} s of simulation`);
console.log(`  ${clip.note}`);
console.log(`  ${file}`);
if (errors.length) console.log('  page errors:', errors.slice(0, 4));
