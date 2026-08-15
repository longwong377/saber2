/**
 * BATTLEFRONT BORZ — what does the WIELDER see of their own arms?
 *
 * tools/motion.mjs can show first person moving, but not what the arms LOOK
 * like: with the blade lit, its own point light delivers ~10.8 units half a
 * metre from the hands against a shade budget near 1.2, so the gloves, the
 * sleeves and the hilt are one blown-out white column and the only thing
 * legible in the frame is the sky. The `walkdark` clip solves exactly that
 * problem for the third-person body; this is the first-person twin.
 *
 * It is also a different question from motion.mjs's. The complaint about first
 * person — "a jumbled mess" — is not about a cycle, it is about GEOMETRY: where
 * the arms enter the frame, whether they are sliced by the near plane, whether
 * anything of the torso pokes through the lens, and whether the hands are on
 * screen at all. That is answered by a handful of deliberately chosen poses,
 * not by a strip of consecutive frames, so this takes ONE boot and captures a
 * cell per pose: level gaze, pitched down, pitched up, mid-stride, crouched.
 *
 *   node tools/fpview.mjs [--level dunes] [--tag now] [--lit] [--cellw 480]
 *   node tools/fpview.mjs --only 'level gaze,down 35'      # a subset, when in a hurry
 *
 * COST. Nine poses at 46 settling steps each is ~420 SwiftShader frames, which
 * is twenty minutes wall clock on four cores plus the boot. The settle is not
 * padding — the gait needs to reach steady state, the blade spring needs to
 * reach its ready pose and the crouch damper runs at rate 12 — but if you only
 * want one answer, `--only` takes a comma-separated list matched as substrings
 * against the pose names and pays for only those.
 *
 * The stepper is motion.mjs's, and for motion.mjs's reason: requestAnimationFrame
 * is replaced by a queue so the game's `dt = (now - last)/1000` is fed a
 * synthetic clock and SwiftShader's 1 fps stops mattering.
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { resolveLevel } from './_roster.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

const LEVEL = flag('level', null);
const TAG = flag('tag', 'now');
const LIT = has('lit');
const CELL_W = Number(flag('cellw', 480));
const CELL_H = Number(flag('cellh', 270));
const COLS = 3;

/**
 * The poses. `pitch` is the camera's, in radians, negative looking down —
 * matching CameraRig, whose limits are -1.28 .. +1.16. `walk` holds forward for
 * the settle so the gait is in its steady state, and `at` picks which frame of
 * the stride to grab so two walk cells are not the same picture.
 */
const POSES = [
  { name: 'level gaze', pitch: 0, walk: false },
  { name: 'down 35°', pitch: -0.61, walk: false },
  { name: 'down 70° (feet)', pitch: -1.22, walk: false },
  { name: 'up 40°', pitch: 0.70, walk: false },
  { name: 'walking, level', pitch: 0, walk: true, at: 0 },
  { name: 'walking, mid-stride', pitch: 0, walk: true, at: 7 },
  { name: 'walking, down 35°', pitch: -0.61, walk: true, at: 3 },
  { name: 'crouched, level', pitch: 0, walk: false, crouch: true },
  { name: 'crouched, down 35°', pitch: -0.61, walk: false, crouch: true },
];

const ONLY = flag('only', '');
const POSE_SET = ONLY
  ? POSES.filter(p => ONLY.split(',').some(k => p.name.includes(k.trim())))
  : POSES;
if (!POSE_SET.length) { console.error(`--only "${ONLY}" matched no pose`); process.exit(1); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

async function boot(level) {
  const { chromium } = await import('playwright-core');
  const { createServer } = await import('node:http');
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
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
  level = await resolveLevel(page, level);
  await page.evaluate((lv) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6, firstPerson: true }));
  }, level);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
  await page.click('#btn-deploy', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(2200);
  await page.evaluate(async () => {
    const W = window.SABER.world.atmosphere?.weather;
    if (W) { W.peak = 0; W.unrest = 0; W.update(0); }
    await new Promise((r) => requestAnimationFrame(r));
  });
  await page.waitForTimeout(1200);
  return { page, browser, server, errors };
}

const out = join(ROOT, '.smoke', 'motion');
mkdirSync(out, { recursive: true });

const { page, browser, server, errors } = await boot(LEVEL);

const result = await page.evaluate(async (cfg) => {
  const S = window.SABER;
  const realRAF = window.requestAnimationFrame.bind(window);
  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  await new Promise((r) => realRAF(r));

  const rows = Math.ceil(cfg.poses.length / cfg.cols);
  const sheet = document.createElement('canvas');
  sheet.width = cfg.cols * cfg.cellW;
  sheet.height = rows * cfg.cellH;
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#101014';
  sc.fillRect(0, 0, sheet.width, sheet.height);

  const gl = S.engine.renderer.domElement;
  const origRender = S.engine.render.bind(S.engine);
  let capture = -1;
  S.engine.render = (dt) => {
    origRender(dt);
    if (capture < 0) return;
    const col = capture % cfg.cols, row = (capture / cfg.cols) | 0;
    const x = col * cfg.cellW, y = row * cfg.cellH;
    sc.drawImage(gl, x, y, cfg.cellW, cfg.cellH);
    sc.strokeStyle = 'rgba(255,255,255,0.22)';
    sc.strokeRect(x + 0.5, y + 0.5, cfg.cellW - 1, cfg.cellH - 1);
    sc.font = '12px monospace';
    const label = cfg.poses[capture].name;
    sc.fillStyle = 'rgba(0,0,0,0.72)';
    sc.fillRect(x + 3, y + 3, 10 + label.length * 7, 16);
    sc.fillStyle = '#c8f0ff';
    sc.fillText(label, x + 7, y + 15);
    capture = -1;
  };
  document.querySelector('#hud')?.classList.add('hidden');

  const p = S.world.player;
  let clock = performance.now();
  const step = async () => {
    clock += cfg.stepMs;
    const pending = queue; queue = [];
    for (const cb of pending) { try { cb(clock); } catch (e) { return String(e && e.message || e); } }
    await new Promise((r) => realRAF(r));
    return null;
  };

  const probes = [];
  for (let pi = 0; pi < cfg.poses.length; pi++) {
    const pose = cfg.poses[pi];
    // Settle: the gait reaches steady state, the blade spring reaches its ready
    // pose, and the crouch damper (rate 12) reaches the bottom.
    const settle = 46 + (pose.at || 0);
    for (let i = 0; i < settle; i++) {
      S.input.keys.clear();
      if (pose.walk) S.input.keys.add('KeyW');
      if (pose.crouch) S.input.keys.add('ControlLeft');
      p.camera.pitch = pose.pitch;
      if (!cfg.lit) {
        const sb = p.saber;
        sb.lit = false; sb.ignition = 0;
        sb.light.intensity = 0; sb.tipLight.intensity = 0;
      }
      const err = await step();
      if (err) return { error: err, pose: pose.name, i };
    }
    // Where is everything, in the eye's own frame, on the captured frame?
    const V = p.position.constructor;
    const inv = S.engine.camera.quaternion.clone().invert();
    const rel = (v) => v.clone().sub(p.camera.pos).applyQuaternion(inv);
    const j = (n) => rel(p.rig.worldPos(n, new V()));
    const t = (n) => rel(p.rig.tipPos(n, new V()));
    probes.push({
      pose: pose.name,
      shoulderR: j('armR').toArray().map(v => +v.toFixed(3)),
      elbowR: t('armR').toArray().map(v => +v.toFixed(3)),
      wristR: t('foreR').toArray().map(v => +v.toFixed(3)),
      chest: j('chest').toArray().map(v => +v.toFixed(3)),
      hilt: rel(p.control.handPos.clone()).toArray().map(v => +v.toFixed(3)),
      near: S.engine.camera.near,
    });
    capture = pi;
    const err = await step();
    if (err) return { error: err, pose: pose.name, i: -1 };
  }

  S.engine.render = origRender;
  window.requestAnimationFrame = realRAF;
  return { png: sheet.toDataURL('image/png'), probes };
}, { poses: POSE_SET, cols: COLS, cellW: CELL_W, cellH: CELL_H, lit: LIT, stepMs: 1000 / 60 });

await browser.close(); server.close();

if (result.error) {
  console.error(`fpview threw on "${result.pose}" step ${result.i}: ${result.error}`);
  if (errors.length) console.error('page errors:', errors.slice(0, 6));
  process.exit(1);
}

const file = join(out, `${TAG}-${LEVEL}-fpview${LIT ? '-lit' : ''}.png`);
writeFileSync(file, Buffer.from(result.png.split(',')[1], 'base64'));
console.log(`fpview on ${LEVEL}: ${POSE_SET.length} poses, blade ${LIT ? 'lit' : 'retracted and unlit'}`);
console.log(`  ${file}`);
// The frustum test, printed rather than eyeballed: a 60° vertical FOV has a
// half-angle of 30°, so anything more than 30° off the view axis is off screen.
for (const p of result.probes) {
  const ang = (v) => (Math.atan2(Math.hypot(v[0], v[1]), Math.max(1e-6, -v[2])) * 180 / Math.PI);
  const front = (v) => -v[2];
  console.log(`  ${p.pose.padEnd(20)} shoulder ${front(p.shoulderR).toFixed(3)}m out `
    + `| wrist ${ang(p.wristR).toFixed(0)}° off axis | hilt ${ang(p.hilt).toFixed(0)}° `
    + `| nearest joint ${Math.min(front(p.shoulderR), front(p.elbowR), front(p.wristR)).toFixed(3)}m `
    + `(near ${p.near}) | chest ${front(p.chest) >= 0 ? '' : 'BEHIND '}${Math.abs(front(p.chest)).toFixed(3)}m`);
}
if (errors.length) console.log('  page errors:', errors.slice(0, 4));
