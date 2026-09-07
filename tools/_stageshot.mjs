/**
 * WHAT THE STAGE LOOKS LIKE — V20 lane 5's own contact sheet.
 *
 * `_stationshot.mjs`'s method exactly, aimed at the five places this lane
 * built rather than at every room on a deck: the abandoned arc from the ring,
 * the inside of a derelict room, the warren from its spine exit, the reactor
 * hall from its door, and a closet. SHARK §13.1 — a place is not done until
 * somebody has LOOKED at a shot of it from its own door.
 *
 * One Chromium at a time: `_lock.mjs` is taken first and every other render
 * tool queues on the same lock.
 *
 *   node tools/_stageshot.mjs /tmp/stage
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.argv[2] || '/tmp/stage';
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
await hold('stageshot');
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
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

async function enter(deck) {
  const info = await page.evaluate(async (dk) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const S = window.SABER;
    if (!S?.enterStation) return { fail: 'no SABER.enterStation' };
    S.enterStation({ n: dk, label: 'stage', level: 'station', deck: dk }).catch((e) => { window.__stationFail = String(e); });
    for (let i = 0; i < 6000 && !(window.SABER?.world?._station?.deck === dk); i++) await raf();
    const w = window.SABER?.world;
    if (!w?._station) return { fail: window.__stationFail || 'no station' };
    S.screens?.set?.('playing');
    S.resume?.();
    if (S.input) S.input.enabled = true;
    for (let i = 0; i < 90; i++) await raf();
    const st = w._station;
    return {
      deck: st.deck, places: st.places.size, draws: st.draws, tris: Math.round(st.tris),
      flickers: st.stage?.flickers?.length ?? 0,
      dress: [...(st.stage?.dressKinds || [])].join(','),
      stash: st.stage?.stash ? [+st.stage.stash.x.toFixed(1), +st.stage.stash.z.toFixed(1)] : null,
    };
  }, deck);
  say(`deck ${deck}: ${JSON.stringify(info)}`);
  console.log(`deck ${deck}:`, JSON.stringify(info));
  return info;
}

const shot = async (name, a) => {
  await page.evaluate(async (at) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const p = window.SABER?.world?.player;
    if (!p) return;
    p.position.set(at.x, at.y, at.z);
    p.body?.position?.set?.(at.x, at.y, at.z);
    if (p.camera) { p.camera.yaw = at.yaw; p.camera.pitch = at.pitch || 0; }
    for (let i = 0; i < 5; i++) await raf();
  }, a);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  say(`shot ${name}`);
};

const D2R = Math.PI / 180;
await enter(48);
/* THE PLAN, read out of the page so a bearing moved in the gazetteer moves
 * the camera with it. Read AFTER the deck is dressed: there is no station on
 * the page until `enterStation` has been round. */
const P = await page.evaluate(() => {
  const st = window.SABER.world._station;
  const out = {};
  for (const rec of st.places.values()) {
    const p = rec.place;
    out[p.id] = { id: p.id, name: p.name, x: p.x, z: p.z, door: p.door, w: p.w, d: p.d, h: p.h, at: p.at, entry: p.entry || null };
  }
  return out;
});
const Y = 25;
const aim = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));

/* 1. THE ABANDONED ARC, from the ring, looking along it. */
{
  const a = -20 * D2R, b = -50 * D2R, r = 85.5;
  const from = [r * Math.sin(a), r * Math.cos(a)], to = [r * Math.sin(b), r * Math.cos(b)];
  await shot('01-dark-arc', { x: from[0], y: Y + 1.7, z: from[1], yaw: aim(from, to), pitch: -0.02 });
}
/* 2. THE SEALED DOORS, from the ring, looking in at #63's welded plate. */
{
  const p = P[63];
  await shot('02-sealed-door', { x: p.door[0] * 1.045, y: Y + 1.7, z: p.door[1] * 1.045, yaw: aim([p.door[0] * 1.045, p.door[1] * 1.045], [p.x, p.z]), pitch: 0 });
}
/* 3. INSIDE A DERELICT ROOM — #62, the one whose front is cut open. */
{
  const p = P[62];
  await shot('03-derelict-in', { x: p.door[0] * 0.985, y: Y + 1.7, z: p.door[1] * 0.985, yaw: aim([p.door[0], p.door[1]], [p.x, p.z]), pitch: 0 });
}
/* 4. THE FALLEN SOFFIT, from its cut. */
{
  const p = P[64];
  if (p.entry) await shot('04-fallen-soffit', { x: p.entry[0], y: Y + 1.7, z: p.entry[1], yaw: aim(p.entry, [p.x, p.z]), pitch: 0 });
}
/* 5. THE WARREN, from its spine exit, looking in. */
{
  const p = P[65];
  await shot('05-warren', { x: p.door[0], y: Y + 1.7, z: p.door[1], yaw: aim(p.door, [p.x, p.z]), pitch: 0 });
}
/* 6. AND DEEPER IN IT, at the valve room. */
{
  const st = await page.evaluate(() => {
    const s = window.SABER.world._station.stage?.stash;
    return s ? [s.x, s.z] : null;
  });
  if (st) await shot('06-valve-room', { x: st[0] - 3.4, y: Y + 1.7, z: st[1] - 1.2, yaw: aim([st[0] - 3.4, st[1] - 1.2], st), pitch: -0.06 });
}
/* 7. THE REACTOR HALL, from its door. */
{
  const p = P[48];
  await shot('07-reactor', { x: p.door[0], y: Y + 1.7, z: p.door[1], yaw: aim(p.door, [p.x, p.z]), pitch: 0.18 });
}
/* 8. THE MAINTENANCE CLOSET — twice: from the walk, so the 2.6 m doorway is
 *    read against the ring's eight metres, and from just inside it. */
{
  const p = P[66];
  const back = 1.035, in2 = 0.975;
  await shot('08-closet', { x: p.door[0] * back, y: Y + 1.6, z: p.door[1] * back, yaw: aim([p.door[0] * back, p.door[1] * back], [p.x, p.z]), pitch: -0.04 });
  await shot('08b-closet-in', { x: p.door[0] * in2, y: Y + 1.5, z: p.door[1] * in2, yaw: aim([p.door[0] * in2, p.door[1] * in2], [p.x, p.z]), pitch: 0.02 });
}

/* AND THE OTHER TWO DECKS: the workers' street and the rich promenade. */
await enter(40);
{
  const r = 85.5, a = 30 * D2R, b = 60 * D2R;
  const from = [r * Math.sin(a), r * Math.cos(a)], to = [r * Math.sin(b), r * Math.cos(b)];
  await shot('09-workers-ring', { x: from[0], y: 1.7, z: from[1], yaw: aim(from, to), pitch: -0.02 });
}
{
  const q = await page.evaluate(() => {
    const st = window.SABER.world._station;
    for (const rec of st.places.values()) if (rec.place.id === 68) return { door: rec.place.door, x: rec.place.x, z: rec.place.z };
    return null;
  });
  if (q) await shot('10-ticket-booth', { x: q.door[0] * 1.032, y: 1.6, z: q.door[1] * 1.032, yaw: aim([q.door[0] * 1.032, q.door[1] * 1.032], [q.x, q.z]), pitch: -0.03 });
}
await enter(44);
{
  const r = 85.5, a = 213 * D2R, b = 243 * D2R;
  const from = [r * Math.sin(a), r * Math.cos(a)], to = [r * Math.sin(b), r * Math.cos(b)];
  await shot('11-rich-promenade', { x: from[0], y: 12.5 + 1.7, z: from[1], yaw: aim(from, to), pitch: -0.02 });
}
{
  const q = await page.evaluate(() => {
    const st = window.SABER.world._station;
    for (const rec of st.places.values()) if (rec.place.id === 67) return { door: rec.place.door, x: rec.place.x, z: rec.place.z };
    return null;
  });
  if (q) await shot('12-shrine-niche', { x: q.door[0] * 1.032, y: 12.5 + 1.6, z: q.door[1] * 1.032, yaw: aim([q.door[0] * 1.032, q.door[1] * 1.032], [q.x, q.z]), pitch: -0.03 });
}

await browser.close();
server.close();
say('done');
