/**
 * WHAT THE STATION ACTUALLY LOOKS LIKE.
 *
 * SHARK §13.1: *"A place is done when it has its geometry, its colliders, its
 * bodies, its life table, its verb, AND a screenshot at eye height from its
 * door that the builder has looked at with the Read tool and judged against
 * §3.2's look line."* §13.2: the player is sent a CONTACT SHEET per deck.
 *
 * A sibling of `_deckshot.mjs` and it takes its whole method from it: serve
 * the real tree, boot the shipped page, drive the real door, resume the world
 * by hand (headless Chromium cannot take the pointer, and a paused world does
 * not step, so every station renders the same frozen frame), then walk the
 * camera to each place's DOOR and shoot from eye height.
 *
 *   node tools/_stationshot.mjs /tmp/station [deck]
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/station';
const DECK = Number(process.argv[3] || 40);
const ONLY = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.smesh': 'application/octet-stream' };

const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('stationshot');
say('lock held');
await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.play.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
say(`serving on ${port}`);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
say('browser up');
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
let _pe = 0;
page.on('pageerror', (e) => {
  if (_pe++ > 3) return;
  console.log('PAGE ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 12).join('\n'));
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 220)); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
  }));
  localStorage.setItem('saber.station.v1', JSON.stringify({ v: 1, hour: 15.14, day: 0, seen: ['station:guide'] }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });


const info = await page.evaluate(async (deck) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  S.enterStation({ n: deck, label: 'shot', level: 'station', deck }).catch((e) => { window.__stationFail = String(e); });
  for (let i = 0; i < 6000 && !(window.SABER?.world?._station); i++) await raf();
  const w = window.SABER?.world;
  if (!w?._station) return { fail: window.__stationFail || 'no station' };
  S.screens?.set?.('playing'); S.resume?.(); if (S.input) S.input.enabled = true;
  for (let i = 0; i < 60; i++) await raf();
  const st = w._station;
  const f = (st.feeds || []).find((x) => x.id === 19);
  if (!f?.mesh) return { fail: 'no feed at #19', feeds: (st.feeds || []).map((x) => x.id) };
  const p = w.player;
  const m = f.mesh;
  const dir = new (p.position.constructor)(Math.sin(m.rotation.y), 0, Math.cos(m.rotation.y));
  p.position.set(m.position.x + dir.x * 7, st.deckY, m.position.z + dir.z * 7);
  p.body?.position?.set?.(p.position.x, p.position.y, p.position.z);
  if (p.camera) { p.camera.yaw = Math.atan2(m.position.x - p.position.x, m.position.z - p.position.z); p.camera.pitch = 0.12; }
  for (let i = 0; i < 240; i++) await raf();
  /* THE PICTURE ITSELF, off the render target. */
  try {
    const live = f.live, r = window.SABER.engine.renderer;
    const W = live.target.width, H = live.target.height;
    const buf = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(live.target, 0, 0, W, H, buf);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'); const img = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; img.data[d] = buf[s]; img.data[d + 1] = buf[s + 1]; img.data[d + 2] = buf[s + 2]; img.data[d + 3] = 255; }
    cx.putImageData(img, 0, 0);
    window.__feedPng = cv.toDataURL('image/png');
    window.__capPng = f.canvas?.toDataURL?.('image/png') || null;
  } catch (e) { window.__feedErr = String(e); }
  return { err: window.__feedErr || null, hour: st.hour, phase: f.phase, mode: f.shot?.mode, runners: f.shot?.runners?.length, live: !!f.live, on: f.live?.on, frames: f.live?.frames, mat: m.material?.name, dist: Math.hypot(p.position.x - m.position.x, p.position.z - m.position.z).toFixed(1) };
}, DECK);
console.log('feed:', JSON.stringify(info));
await page.screenshot({ path: `${OUT}/feed.png`, timeout: 180000 });
const png = await page.evaluate(() => window.__feedPng || null);
if (png) { const { writeFile } = await import('node:fs/promises'); await writeFile(`${OUT}/target.png`, Buffer.from(png.split(',')[1], 'base64')); say('wrote target.png'); }
const cap = await page.evaluate(() => window.__capPng || null);
if (cap) { const { writeFile } = await import('node:fs/promises'); await writeFile(`${OUT}/caption.png`, Buffer.from(cap.split(',')[1], 'base64')); }
say('shot feed');
await browser.close(); server.close(); process.exit(0);
