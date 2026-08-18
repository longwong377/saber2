/**
 * Close-up portraits of the character rigs, for eyeballing body work.
 *
 *   node tools/portrait.mjs                 the player
 *   node tools/portrait.mjs --enemy b1      one enemy archetype, held still
 *   node tools/portrait.mjs --enemy all     every archetype in turn
 *
 * Enemy shots land in .smoke/ as e-<type>-<view>.png. The unit is spawned in
 * front of the player, its AI is pinned so it neither walks off nor shoots,
 * and the camera is placed from its OWN world position and height so the
 * framing survives archetypes that are four metres tall.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
/* `./_level.mjs` AND NOT `./_roster.mjs`, WHICH HAS NEVER EXPORTED THIS NAME.
 * This import was a SyntaxError and this tool has never run — see the header of
 * `_level.mjs` for why `_roster.mjs` could not have provided it either (it
 * imports `three`, and this file runs without the module loader). */
import { resolveLevel, installFrameHelper, deployAndWait, waitFramesFor } from './_level.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, '.smoke');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
// `window.__frame()`, before any navigation, so every wait below is in frames.
await installFrameHelper(page);
/* AND THE SCREENSHOT ITSELF IS A FRAME. Playwright's default action timeout is
 * 30 s; a screenshot forces a render, and HANDOFF 2.6 measures one frame here
 * at up to 4151 ms on an EMPTY field and more with a body and a level in it.
 * So every shot this tool tried to take timed out: it got as far as writing one
 * portrait and died on the second. The other four tools already set this. */
page.setDefaultTimeout(300000);
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
const level = await resolveLevel(page, null);
await page.evaluate((lv) => localStorage.setItem('saber.settings.v2', JSON.stringify({
  level: lv, quality: 'low', resolutionScale: 1, difficulty: 'knight', mode: 'roguelite', volume: 0, music: 0 })), level);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFramesFor(page, '#btn-deploy', { frames: 60 });
/* DEPLOY IS WAITED OUT IN FRAMES, NOT IN SECONDS — HANDOFF 2.6. One frame
 * through swiftshader takes up to 4151 ms on an EMPTY field, and the frames
 * just after a deploy are the most expensive in the run, so a wall-clock wait
 * here asks "is this box quiet" and not "did the game deploy". Measured: the
 * 60 s below is about fourteen frames, and `waitForTimeout(4000)` is under one.
 * `smoke.mjs` was rewritten for exactly this; these five never were. */
await deployAndWait(page, { settle: 4 });
await page.evaluate(() => { for (const el of document.querySelectorAll('#hud, .overlay, #title, .banner')) el.style.display = 'none'; });

// hold the blade up so the arms are actually working, then freeze
await page.evaluate(() => {
  const S = window.SABER;
  S.input.locked = true; S.input.enabled = true;
  window.__portrait = null;
  const eng = S.engine;
  const orig = eng.render.bind(eng);
  eng.render = (dt) => {
    const v = window.__portrait;
    if (v) {
      const c = eng.camera;
      c.position.set(v.p[0], v.p[1], v.p[2]);
      c.lookAt(v.t[0], v.t[1], v.t[2]);
      c.fov = v.fov || 40; c.near = 0.02; c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
    }
    orig(dt);
  };
});

// stand 90 degrees off the sun so the figure is lit but not blown out, and
// drop the cloak, which otherwise hides the entire body
const A = parseFloat(process.env.PORTRAIT_ANGLE || await page.evaluate(() => {
  const p = window.SABER.world.player;
  p.cloak?.setVisible(false);
  p.cloak && (p.cloak.setVisible = () => {});
  const s = window.SABER.engine.sun.position;
  return String(Math.atan2(s.x, s.z) + Math.PI * 0.5);
}));
const dir = (r, h) => [Math.sin(A) * r, h, Math.cos(A) * r];

/* ── enemy portraits ─────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const enemyArg = argv.includes('--enemy') ? argv[argv.indexOf('--enemy') + 1] : null;
if (enemyArg) {
  const types = enemyArg === 'all'
    ? ['b1', 'b2', 'trooper', 'sniper', 'acolyte', 'droideka', 'walker', 'beast']
    : enemyArg.split(',');
  for (const type of types) {
    // Spawn one, pin it, and measure how big it actually is — a walker is
    // three times a trooper and one framing cannot serve both.
    const info = await page.evaluate((type) => {
      const w = window.SABER.world;
      for (const e of w.enemies.slice()) e.dispose?.();
      w.enemies.length = 0;
      const p = w.player.position;
      const e = w.spawnEnemy(type, new window.THREE_V3
        ? new window.THREE_V3(p.x, p.y, p.z + 6) : { x: p.x, y: p.y, z: p.z + 6 });
      return { ok: !!e };
    }, type).catch((e) => ({ ok: false, err: String(e) }));
    if (!info.ok) { console.log('spawn failed for', type, info.err || ''); continue; }
    // hold it still, facing the camera, and let a few frames settle the gait
    await page.evaluate(() => {
      const w = window.SABER.world;
      const e = w.enemies[0];
      e.speed = 0; e.stunTimer = 1e9; e.attackTimer = 1e9;
      e.velocity.set(0, 0, 0);
      window.__pin = e;
    });
    // Settled in FRAMES: 1600 ms is under one frame here, so the gait had not
    // moved at all before the body was measured.
    await page.evaluate(async () => { for (let i = 0; i < 6; i++) await window.__frame(); });
    const box = await page.evaluate(() => {
      const e = window.__pin;
      const THREE = window.SABER.engine.scene.constructor === Object ? null : null;
      const root = e.rig ? e.rig.root : e.group;
      let lo = Infinity, hi = -Infinity, wide = 0;
      root.updateMatrixWorld(true);
      root.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const sx of [bb.min.x, bb.max.x]) for (const sy of [bb.min.y, bb.max.y]) for (const sz of [bb.min.z, bb.max.z]) {
          const v = { x: sx, y: sy, z: sz };
          const p = o.localToWorld(new o.position.constructor(v.x, v.y, v.z));
          lo = Math.min(lo, p.y); hi = Math.max(hi, p.y);
          wide = Math.max(wide, Math.hypot(p.x - e.position.x, p.z - e.position.z));
        }
      });
      return { x: e.position.x, y: e.position.y, z: e.position.z, lo, hi, wide, facing: e.facing };
    });
    const H = Math.max(0.6, box.hi - box.lo);
    const R = Math.max(H * 0.95, box.wide * 2.6);
    const views = [
      ['full', { r: R, h: box.lo + H * 0.55, look: H * 0.5, fov: 40 }],
      ['upper', { r: R * 0.5, h: box.lo + H * 0.82, look: H * 0.78, fov: 38 }],
      ['head', { r: R * 0.26, h: box.lo + H * 0.95, look: H * 0.93, fov: 36 }],
      ['back', { r: -R, h: box.lo + H * 0.55, look: H * 0.5, fov: 40 }],
      ['side', { r: R, h: box.lo + H * 0.55, look: H * 0.5, fov: 40, yaw: Math.PI / 2 }],
      ['legs', { r: R * 0.62, h: box.lo + H * 0.34, look: H * 0.22, fov: 42 }],
      ['far', { r: R * 3.4, h: box.lo + H * 0.6, look: H * 0.5, fov: 30 }],
    ];
    for (const [name, v] of views) {
      const a = A + (v.yaw || 0);
      await page.evaluate(({ box, v, a }) => {
        window.__portrait = {
          p: [box.x + Math.sin(a) * v.r, v.h, box.z + Math.cos(a) * v.r],
          t: [box.x, box.lo + v.look, box.z],
          fov: v.fov,
        };
      }, { box, v, a });
      await page.evaluate(async () => { for (let i = 0; i < 2; i++) await window.__frame(); });
      await page.screenshot({ path: join(OUT, `e-${type}-${name}.png`) });
    }
    console.log('wrote', type, `(height ${H.toFixed(2)}m, radius ${box.wide.toFixed(2)}m)`);
  }
  await browser.close();
  server.close();
  process.exit(0);
}

const shots = [
  ['40-torso',   { d: dir(1.9, 1.30), look: [0, 1.10, 0], fov: 36 }],
  ['41-arms',    { d: dir(0.95, 1.35), look: [0.12, 1.22, 0.12], fov: 44 }],
  ['42-hands',   { d: dir(0.46, 1.34), look: [0.16, 1.24, 0.24], fov: 44 }],
  ['43-back',    { d: dir(-1.9, 1.25), look: [0, 1.05, 0], fov: 36 }],
  ['44-head',    { d: dir(0.72, 1.56), look: [0, 1.48, 0.02], fov: 34 }],
  ['46-face',    { face: true, r: 0.62, h: 1.52, look: [0, 1.47, 0], fov: 34 }],
  ['45-legs',    { d: dir(1.5, 0.72), look: [0, 0.52, 0], fov: 40 }],
];
for (const [name, s] of shots) {
  await page.evaluate((s) => {
    const p = window.SABER.world.player;
    // aim the blade up and to the right so the arms are lifted
    p.control.handPos.set(p.position.x + 0.3, p.position.y + 1.25, p.position.z + 0.35);
    const d = s.face ? [Math.sin(p.facing) * s.r, s.h, Math.cos(p.facing) * s.r] : s.d;
    window.__portrait = {
      p: [p.position.x + d[0], p.position.y + d[1] + 0.0, p.position.z + d[2]],
      t: [p.position.x + s.look[0], p.position.y + s.look[1], p.position.z + s.look[2]],
      fov: s.fov,
    };
  }, s);
  await page.evaluate(async () => { for (let i = 0; i < 2; i++) await window.__frame(); });
  await page.screenshot({ path: join(OUT, name + '.png') });
  console.log('wrote', name);
}
await browser.close();
server.close();
