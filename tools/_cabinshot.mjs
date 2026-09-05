/**
 * THROWAWAY — what #27 looks like with a perch in it and a mirror that works.
 *   node tools/_cabinshot.mjs /tmp/cabin
 * Method taken verbatim from tools/_stationshot.mjs. Delete with _homefix.mjs.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/cabin';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.smesh': 'application/octet-stream' };
const say = (m) => process.stderr.write(`▸ ${m}\n`);
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('cabinshot');
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
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
let pe = 0;
page.on('pageerror', (e) => { if (pe++ > 3) return; console.log('PAGE ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 10).join('\n')); });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 220)); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'medium', instantSpawn: true, allies: 0,
  }));
  /* A hawk on the roll and a perch in the cabin, written the way the habitat
   * writes them — through the shipped module, before the station is dressed. */
  localStorage.removeItem('saber.kennel.v1');
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
const seeded = await page.evaluate(async () => {
  const K = await import('/src/game/Kennel.js');
  const HAB = await import('/src/game/Habitat.js');
  K.clear();
  K.adopt('hawk', 'KITE');
  HAB.choosePad('perch');
  const H = await import('/src/game/Home.js');
  return { pad: H.homePad(), live: K.load().live?.kind || null };
});
say(`seeded ${JSON.stringify(seeded)}`);
const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  if (!S?.enterStation) return { fail: 'no SABER.enterStation' };
  S.enterStation({ n: 44, label: 'shot', level: 'station', deck: 44 }).catch((e) => { window.__f = String(e); });
  for (let i = 0; i < 8000 && !(window.SABER?.world?._station); i++) await raf();
  const w = window.SABER?.world;
  if (!w?._station) return { fail: window.__f || 'no station' };
  S.screens?.set?.('playing'); S.resume?.();
  if (S.input) S.input.enabled = true;
  for (let i = 0; i < 60; i++) await raf();
  const h = w._home, M = h?.mirror;
  return {
    address: h?.address, pad: h?.pad?.id || null, seated: !!h?.pad?.root,
    glass: !!M?.S, scale: M?.S?.scale ?? null, quality: w.engine?.quality ?? w.settings?.quality,
    mirrorAt: M?.S ? [M.S.plane.x, M.S.plane.y, M.S.plane.z] : null,
    normal: M?.S ? [M.S.normal.x, M.S.normal.y, M.S.normal.z] : null,
    padAt: h?.pad ? [h.pad.at.x, h.pad.at.y, h.pad.at.z] : null,
    floor: h?.y,
  };
});
console.log('cabin:', JSON.stringify(info));
if (info.fail) { await browser.close(); server.close(); process.exit(1); }

const shot = async (name, at) => {
  const r = await page.evaluate(async (a) => {
    const raf = () => new Promise((r2) => requestAnimationFrame(r2));
    const w = window.SABER.world, p = w.player;
    p.position.set(a.x, a.y, a.z);
    p.body?.position?.set?.(a.x, a.y, a.z);
    if (p.camera) { p.camera.yaw = a.yaw; p.camera.pitch = a.pitch || 0; if (a.fp != null) p.camera.firstPerson = a.fp; }
    for (let i = 0; i < 8; i++) await raf();
    const S = w._home?.mirror?.S;
    return S ? { renders: S.renders, skipped: S.skipped, uOn: S.material.uniforms.uOn.value,
      target: `${S.target.width}x${S.target.height}` } : null;
  }, at);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  say(`shot ${name} ${JSON.stringify(r)}`);
};

const [mx, my, mz] = info.mirrorAt;
const [nx, , nz] = info.normal;
/* Stand 2.2 m off the glass on the room side, looking straight at it. Camera
 * forward at yaw θ is (−sin θ, −cos θ), so aim it along −normal. */
const yawAt = Math.atan2(nx, nz);
await shot('01-mirror-third', { x: mx + nx * 2.4, y: info.floor + 1.7, z: mz + nz * 2.4, yaw: yawAt, pitch: -0.05, fp: false });
await shot('02-mirror-first', { x: mx + nx * 1.4, y: info.floor + 1.7, z: mz + nz * 1.4, yaw: yawAt, pitch: -0.05, fp: true });
const [px, , pz] = info.padAt;
await shot('03-perch', { x: px + (mx - px) * 0.28, y: info.floor + 1.7, z: pz + (mz - pz) * 0.28,
  yaw: Math.atan2(-(px - (px + (mx - px) * 0.28)), -(pz - (pz + (mz - pz) * 0.28))), pitch: -0.08, fp: true });
await browser.close();
server.close();
say('done');
