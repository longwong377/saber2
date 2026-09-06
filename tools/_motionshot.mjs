/**
 * WHAT THE MOTION LANE ACTUALLY LOOKS LIKE — V20 lane 2.
 *
 * `_stationshot.mjs`'s method exactly: serve the real tree, boot the shipped
 * page, go through `SABER.enterStation`, resume the world by hand, then stand
 * the camera somewhere and shoot. What is different is that this tool has to
 * WAIT: a door takes half a second to run, a smoke pool takes three to fill,
 * and litter takes half a minute to settle. So every shot names how many
 * seconds of world to spend before it is taken.
 *
 * ONE CHROMIUM AT A TIME. `tools/_lock.mjs` is held for the whole run — the
 * other V20 lanes queue on the same lock — so this shoots ONCE, late, and
 * takes every plate in a single boot.
 *
 *   node tools/_motionshot.mjs /tmp/motion
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.argv[2] || '/tmp/motion';
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
await hold('motionshot');
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
    level: 'geonosis', mode: 'command', quality: 'high', instantSpawn: true, allies: 0,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

async function enter(deck) {
  const info = await page.evaluate(async (d) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const S = window.SABER;
    if (!S?.enterStation) return { fail: 'no SABER.enterStation' };
    S.enterStation({ n: d, label: 'motion', level: 'station', deck: d }).catch((e) => { window.__fail = String(e); });
    for (let i = 0; i < 9000 && !(window.SABER?.world?._station?.motion); i++) await raf();
    const w = window.SABER?.world;
    if (!w?._station?.motion) return { fail: window.__fail || 'no station motion' };
    S.screens?.set?.('playing');
    S.resume?.();
    if (S.input) S.input.enabled = true;
    for (let i = 0; i < 60; i++) await raf();
    const mo = w._station.motion;
    return {
      deck: w._station.deck, draws: mo.draws, doors: mo.doors.length, fans: mo.fans.length,
      screens: mo.screens.length, emitters: mo.emitters.length, litter: mo.litter?.n || 0,
      total: w._station.draws,
    };
  }, deck);
  say(`deck ${deck}: ${JSON.stringify(info)}`);
  if (info.fail) throw new Error(info.fail);
  return info;
}

/** Stand somewhere, spend `secs` of world there, then shoot. `hold` names a
 *  door to keep open (its own state machine runs; only the request is faked). */
async function shot(name, at) {
  const ok = await page.evaluate(async (a) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const w = window.SABER?.world, p = w?.player;
    if (!p) return false;
    const mo = w._station.motion;
    const secs = a.secs || 0.3;
    const n = Math.max(3, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      p.position.set(a.x, a.y, a.z);
      p.body?.position?.set?.(a.x, a.y, a.z);
      p.velocity?.set?.(0, 0, 0);
      if (p.camera) { p.camera.yaw = a.yaw; p.camera.pitch = a.pitch || 0; }
      /* A door held open while the camera stands back: the request is set,
       * the leaves and the collider still run their own state machine. */
      if (a.hold !== undefined) {
        const d = mo.doors.find((q) => q.id === a.hold);
        if (d) d.hold = 5;
      }
      await raf();
    }
    return true;
  }, at);
  if (!ok) { say(`shot ${name}: no player`); return; }
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  say(`shot ${name}`);
}

/** Where a place's door is, read out of the page. */
async function doorOf(id) {
  return page.evaluate((q) => {
    const mo = window.SABER.world._station.motion;
    const d = mo.doors.find((k) => k.id === q);
    if (!d) return null;
    const inx = d.place.x - d.cx, inz = d.place.z - d.cz;
    const L = Math.hypot(inx, inz) || 1;
    return { cx: d.cx, cz: d.cz, y: d.y, ux: inx / L, uz: inz / L, gap: d.gap, name: d.place.name };
  }, id);
}

/* ── DECK 40: the galley's door and its steam, and the atrium ───────────── */
await enter(40);

/* THE DOOR, SHUT AND OPEN, FROM ONE CAMERA. #16's is the galley's — the
 * kitchen behind the cantina's food, and the tightest 3.4 m pair on the deck.
 * The framing does not move between the two plates, which is the whole point:
 * what changes in the pair is the leaves and nothing else. */
const g = await doorOf(16);
if (g) {
  const yaw = Math.atan2(-g.ux, -g.uz);
  const cam = { x: g.cx - g.ux * 5.5, y: g.y + 1.7, z: g.cz - g.uz * 5.5, yaw, pitch: -0.03 };
  await shot('01-door-shut', { ...cam, secs: 2.5 });
  await shot('02-door-open', { ...cam, secs: 1.6, hold: 16 });
  say(`door #16 ${g.name} ${g.gap} m`);
}

/* THE GALLEY'S STEAM. Inside #16, at the pass end, looking down the ranges —
 * five seconds of world so the smoke pool has filled. */
const g16 = await page.evaluate(() => {
  const p = window.SABER.world._station.places.get(16).place;
  return { x: p.x, z: p.z, yaw: p.yaw, d: p.d, w: p.w, y: window.SABER.world.floorAt(p.x, p.z) };
});
{
  const c = Math.cos(g16.yaw), s = Math.sin(g16.yaw);
  const lz = -g16.d / 2 + 2.2;
  await shot('03-galley-steam', {
    x: g16.x + lz * s, y: g16.y + 1.65, z: g16.z + lz * c,
    yaw: g16.yaw + Math.PI, pitch: 0.06, secs: 6,
  });
}

/* THE ATRIUM: the litter drifting over the balcony, and the beam. Thirty
 * seconds of world first, so the draught has moved every scrap off its seed
 * and some of them have come down on the balcony. */
await shot('04-atrium-litter', { x: 0, y: 1.7, z: 24, yaw: Math.PI, pitch: -0.22, secs: 30 });
await shot('05-atrium-up', { x: 0, y: 1.7, z: 24, yaw: Math.PI, pitch: 0.42, secs: 1 });
await shot('06-atrium-wide', { x: 14, y: 1.7, z: 22, yaw: Math.PI * 0.82, pitch: -0.05, secs: 1 });

/* THE CANTINA'S FANS — #14's front is a 22 m open arc and gets no leaves, so
 * what moves in this room is the pair of ceiling fans over the bar. */
const c14 = await page.evaluate(() => {
  const p = window.SABER.world._station.places.get(14).place;
  return { x: p.x, z: p.z, yaw: p.yaw, d: p.d, y: window.SABER.world.floorAt(p.door[0], p.door[1]) };
});
{
  const c = Math.cos(c14.yaw), s = Math.sin(c14.yaw);
  const lz = -c14.d / 2 + 1.5;
  await shot('07-cantina-fans', {
    x: c14.x + lz * s, y: c14.y + 1.7, z: c14.z + lz * c,
    yaw: c14.yaw + Math.PI, pitch: 0.22, secs: 3,
  });
}

/* ── DECK 44: the laundry's steam and a residential door ────────────────── */
await enter(44);
const l39 = await page.evaluate(() => {
  const p = window.SABER.world._station.places.get(39).place;
  return { x: p.x, z: p.z, yaw: p.yaw, d: p.d, y: window.SABER.world.floorAt(p.x, p.z) };
});
{
  const c = Math.cos(l39.yaw), s = Math.sin(l39.yaw);
  const lz = -l39.d / 2 + 1.6;
  await shot('08-laundry-steam', {
    x: l39.x + lz * s, y: l39.y + 1.65, z: l39.z + lz * c,
    yaw: l39.yaw + Math.PI, pitch: 0.02, secs: 6,
  });
}
const q = await doorOf(31);
if (q) {
  const yaw = Math.atan2(-q.ux, -q.uz);
  const cam = { x: q.cx - q.ux * 5.0, y: q.y + 1.7, z: q.cz - q.uz * 5.0, yaw, pitch: -0.02 };
  await shot('09-quarter-shut', { ...cam, secs: 2.5 });
  await shot('10-quarter-open', { ...cam, secs: 1.6, hold: 31 });
}

/* ── DECK 48: the reactor's wall fan and #49's spray ────────────────────── */
await enter(48);
const r48 = await page.evaluate(() => {
  const p = window.SABER.world._station.places.get(48).place;
  return { x: p.x, z: p.z, yaw: p.yaw, d: p.d, y: window.SABER.world.floorAt(p.x, p.z) };
});
{
  const c = Math.cos(r48.yaw), s = Math.sin(r48.yaw);
  const lz = 2.0, lx = 8.0;
  await shot('11-reactor-fan', {
    x: r48.x + lx * c + lz * s, y: r48.y + 1.7, z: r48.z - lx * s + lz * c,
    yaw: r48.yaw - Math.PI / 2, pitch: 0.42, secs: 3,
  });
}
const w49 = await page.evaluate(() => {
  const p = window.SABER.world._station.places.get(49).place;
  return { x: p.x, z: p.z, yaw: p.yaw, d: p.d, y: window.SABER.world.floorAt(p.x, p.z) };
});
{
  const c = Math.cos(w49.yaw), s = Math.sin(w49.yaw);
  const lz = -w49.d / 2 + 2.2;
  await shot('12-coolant-spray', {
    x: w49.x + lz * s, y: w49.y + 1.65, z: w49.z + lz * c,
    yaw: w49.yaw + Math.PI, pitch: 0.14, secs: 6,
  });
}

await browser.close();
server.close();
say('done');
