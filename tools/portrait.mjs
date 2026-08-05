/**
 * Close-up portraits of the character rig, for eyeballing body work.
 *   node tools/portrait.mjs [--fp]
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

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
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('saber.settings.v2', JSON.stringify({
  level: 'dunes', quality: 'low', resolutionScale: 1, difficulty: 'knight', mode: 'roguelite', volume: 0, music: 0 })));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
await page.click('#btn-deploy');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
await page.waitForTimeout(4000);
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

const A = parseFloat(process.env.PORTRAIT_ANGLE || '2.4');
const dir = (r, h) => [Math.sin(A) * r, h, Math.cos(A) * r];
const shots = [
  ['40-torso',   { d: dir(1.9, 0.30), look: [0, 1.15, 0], fov: 34 }],
  ['41-arms',    { d: dir(0.95, 0.28), look: [0.10, 1.20, 0.10], fov: 42 }],
  ['42-hands',   { d: dir(0.50, 0.16), look: [0.14, 1.22, 0.22], fov: 42 }],
  ['43-back',    { d: dir(-1.9, 0.35), look: [0, 1.10, 0], fov: 34 }],
  ['44-head',    { d: dir(0.75, 0.32), look: [0, 1.46, 0.03], fov: 32 }],
  ['45-legs',    { d: dir(1.4, 0.05), look: [0, 0.52, 0], fov: 38 }],
];
for (const [name, s] of shots) {
  await page.evaluate((s) => {
    const p = window.SABER.world.player;
    // aim the blade up and to the right so the arms are lifted
    p.control.handPos.set(p.position.x + 0.3, p.position.y + 1.25, p.position.z + 0.35);
    window.__portrait = {
      p: [p.position.x + s.d[0], p.position.y + s.d[1] + 0.0, p.position.z + s.d[2]],
      t: [p.position.x + s.look[0], p.position.y + s.look[1], p.position.z + s.look[2]],
      fov: s.fov,
    };
  }, s);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(OUT, name + '.png') });
  console.log('wrote', name);
}
await browser.close();
server.close();
