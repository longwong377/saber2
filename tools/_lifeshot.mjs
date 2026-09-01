/**
 * WHAT THE DECK LOOKS LIKE WITH THE WORK RUNNING ON IT.
 *
 * `_deckshot.mjs` shoots the room. This shoots the room ALIVE: it boots the
 * same shipped page through the same door, then calls `dressDeckLife` and
 * drives `stepDeckLife` off its own rAF loop — because the wiring into
 * `Hangar.js` belongs to another lane and a screenshot is not allowed to wait
 * on it. It also reports the meshes, the draw calls and the per-frame cost
 * this file adds, before and after, on the same world.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { hold } from './_lock.mjs';

/* ONE HEAVY JOB AT A TIME, TAKEN HERE RATHER THAN AROUND HERE. `_render.sh`
 * only works if every caller remembers it; measured on this box, four
 * concurrent Chromium jobs put four cores at load 25 and a ninety-second
 * screenshot took twenty minutes without ever failing. */
await hold('lifeshot');

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/deck-life';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
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
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 220)); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });

const boot = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  /* SIX THOUSAND FRAMES, NOT TWELVE HUNDRED. This box serialises render jobs
   * through tools/_render.sh for a reason — measured at load 17 with 33
   * Chromium processes alive, the shipped page took past 1200 rAF just to
   * publish `__hooks`, and the run reported "no #btn-hangar" for a page that
   * was merely still booting. */
  for (let i = 0; i < 6000 && !window.__hooks; i++) await raf();
  for (let i = 0; i < 3000 && !document.getElementById('btn-hangar'); i++) await raf();
  return { hooks: !!window.__hooks, door: !!document.getElementById('btn-hangar') };
});
console.log('boot:', JSON.stringify(boot));

const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar in the DOM' };
  btn.click();
  for (let i = 0; i < 9000 && !(window.world && window.world.terrain); i++) await raf();
  const w = window.world;
  if (!w) return { fail: 'no world after clicking the door' };
  for (let i = 0; i < 180; i++) await raf();

  const count = () => { let n = 0; w.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) n++; }); return n; };
  const before = { meshes: count(), calls: window.engine?.renderer?.info?.render?.calls ?? null,
    tris: window.engine?.renderer?.info?.render?.triangles ?? null,
    fog: w.scene.fog?.density ?? null };

  const M = await import('/src/game/DeckLife.js');
  const t0 = performance.now();
  M.dressDeckLife(w);
  const buildMs = performance.now() - t0;

  /* Drive the stepper off the page's own frame loop, since nothing in the
   * shipped world calls it yet. */
  window.__lifeCost = 0; window.__lifeN = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const s = performance.now();
    M.stepDeckLife(w, dt);
    window.__lifeCost += performance.now() - s; window.__lifeN++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (let i = 0; i < 240; i++) await raf();

  const after = { meshes: count(), calls: window.engine?.renderer?.info?.render?.calls ?? null,
    tris: window.engine?.renderer?.info?.render?.triangles ?? null,
    fog: w.scene.fog?.density ?? null };
  return { before, after, buildMs: +buildMs.toFixed(1),
    stepMs: +(window.__lifeCost / Math.max(1, window.__lifeN)).toFixed(3),
    frames: window.__lifeN,
    statics: w.statics.length, props: w.props.length };
});
console.log('life:', JSON.stringify(info, null, 1));

const SHOT = { timeout: 180000 };
if (!info.fail) {
  const shots = [
    ['01-forward', { yaw: 0, pitch: -0.04, x: 0, y: 1.7, z: -34 }],
    ['02-port-job', { yaw: -0.95, pitch: 0.02, x: -6, y: 1.7, z: -26 }],
    ['03-droid-near', { yaw: -1.15, pitch: -0.06, x: -9, y: 1.7, z: -22 }],
    ['04-droid-close', { yaw: -2.0, pitch: -0.10, x: -23.5, y: 1.7, z: -9.5 }],
    ['05-tech', { yaw: -1.35, pitch: 0.16, x: -17, y: 1.7, z: -13 }],
    ['06-far-deck', { yaw: 0.15, pitch: 0.0, x: 0, y: 1.7, z: 6 }],
    ['07-crew', { yaw: 0.35, pitch: -0.01, x: -4, y: 1.7, z: 4 }],
    ['08-lip', { yaw: 0, pitch: 0.03, x: 0, y: 1.7, z: 54 }],
    ['09-trolley', { yaw: -1.5, pitch: 0.42, x: -22, y: 1.7, z: -14 }],
    ['10-starboard', { yaw: 1.25, pitch: -0.02, x: 6, y: 1.7, z: -22 }],
    ['11-aft', { yaw: Math.PI, pitch: 0.04, x: 0, y: 1.7, z: -14 }],
    ['12-field-side', { yaw: -1.55, pitch: 0.18, x: -30, y: 1.7, z: 20 }],
  ];
  for (const [name, v] of shots) {
    await page.evaluate(async (v) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const p = window.world?.player;
      if (p) {
        p.position.set(v.x, v.y, v.z);
        if (p.camera) { p.camera.yaw = v.yaw; p.camera.pitch = v.pitch; }
        if (p.control) { p.control.yaw = v.yaw; p.control.pitch = v.pitch; }
      }
      for (let i = 0; i < 34; i++) await raf();
    }, v);
    await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT }).catch((e) => console.log(name, 'shot:', e.message));
    console.log('wrote', `${OUT}/${name}.png`);
  }
}
await browser.close();
server.close();
