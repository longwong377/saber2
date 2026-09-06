/**
 * WHAT A SEATED RESIDENT LOOKS LIKE — the cantina at 22:00, from its door.
 *
 * V18 hole 4's proof shot, and it takes its whole method from
 * `_stationshot.mjs`: serve the real tree, boot the shipped page, drive the
 * real door, resume the world by hand, then wind the clock to 22:00, stand
 * the player at #14's door and let the pool sit down. The sim is stepped by
 * hand — `world.update` in a loop inside the page — because a headless
 * swiftshader frame is a fraction of a second and sixty seconds of station
 * time would be ten minutes of wall clock at rAF pace.
 *
 *   node tools/_seatshot.mjs /tmp/seat
 *
 * Two frames: the door shot §13.1 asks for, and one from the lip of the well
 * a few metres in, aimed at the nearest sitter, so the pose can be judged.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || '/tmp/seat';
const PLACE_ID = Number(process.argv[3] || 14);
const HOUR = Number(process.argv[4] || 22);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.smesh': 'application/octet-stream' };

const say = (m) => process.stderr.write(`▸ ${m}\n`);
say(`start (tree ${ROOT})`);
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('seat');
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
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

const info = await page.evaluate(async (deck) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  if (!S?.enterStation) return { fail: 'no SABER.enterStation — is STATION_ENABLED off?' };
  S.enterStation({ n: deck, label: 'shot', level: 'station', deck }).catch((e) => { window.__stationFail = String(e); });
  for (let i = 0; i < 6000 && !(window.SABER?.world?._station); i++) await raf();
  const w = window.SABER?.world;
  if (!w?._station) return { fail: window.__stationFail || 'no station' };
  S.screens?.set?.('playing');
  S.resume?.();
  if (S.input) S.input.enabled = true;
  for (let i = 0; i < 60; i++) await raf();
  return { level: w.levelKey, deck: w._station.deck, props: w.props?.length };
}, 40);
say(`station ${JSON.stringify(info)}`);
console.log('station:', JSON.stringify(info));
if (info.fail) { await browser.close(); server.close(); process.exit(1); }

/* The evening: the clock, the door, and sixty seconds of the pool sitting
 * down, stepped by hand in slices so the page stays responsive. */
const sat = await page.evaluate(async ({ id, hour }) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER, w = S.world, st = w._station, life = w._stationLife;
  const rec = [...st.places.values()].find((r) => r.place.id === id);
  if (!rec) return { fail: `no place #${id}` };
  const p = rec.place;
  st.hour = hour;
  /* No event pulling the room out onto the ring for the length of the shot. */
  if (life) { life.event = null; life.eventFor = 0; life.eventIn = 1e6; }
  const pl = w.player;
  pl.position.set(p.door[0], 1.7, p.door[1]);
  pl.body?.position?.set?.(p.door[0], 1.7, p.door[1]);
  const hands = () => S.screens?.hands?.(S.input) || {};
  const steps = 60 * 90;
  for (let i = 0; i < steps; i++) {
    w.update(1 / 60, hands());
    if (i % 240 === 0) await raf();
  }
  const seated = [];
  for (const b of life?.live?.values() || []) {
    if (b?.seat?.state === 'sit' && b.seat.blend > 0.99) {
      const h = b.rig?.hipsBone?.obj.position;
      seated.push({ place: b.stationPlace, role: b.stationRole, x: +b.position.x.toFixed(2), y: +b.position.y.toFixed(2), z: +b.position.z.toFixed(2),
        hips: h ? +(h.y - b.position.y).toFixed(2) : null, kind: b.seat.prop.kind, cup: !!b.seat.cupObj, facing: +b.facing.toFixed(2) });
    }
  }
  const chairs = [];
  for (const q of w.props) if (q.kind === 'chair' || q.kind === 'stool' || q.kind === 'bench') {
    const d = Math.hypot(q.body.position.x - p.x, q.body.position.z - p.z);
    if (d < 14) chairs.push({ kind: q.kind, y: +q.body.position.y.toFixed(2), up: +new w.player.position.constructor(0, 1, 0).applyQuaternion(q.body.quaternion).y.toFixed(2) });
  }
  return { place: { id: p.id, name: p.name, x: p.x, z: p.z, door: p.door, yaw: p.yaw }, seated, chairs, live: life?.live?.size, hour: st.hour };
}, { id: PLACE_ID, hour: HOUR });
console.log('seated:', JSON.stringify(sat, null, 1));
if (sat.fail) { await browser.close(); server.close(); process.exit(1); }

const SHOT = { timeout: 180000 };
const shot = async (name, at) => {
  await page.evaluate(async (a) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const w = window.SABER?.world, p = w?.player;
    p.position.set(a.x, a.y, a.z);
    p.body?.position?.set?.(a.x, a.y, a.z);
    if (p.camera) { p.camera.yaw = a.yaw; p.camera.pitch = a.pitch || 0; }
    for (let i = 0; i < 4; i++) await raf();
  }, at);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT });
  say(`shot ${name}`);
};

/* The camera's forward at yaw θ is (−sin θ, −cos θ) — `_stationshot`. */
const P = sat.place;
const aim = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
/* Four metres in from the door along its line — the cantina's door shot proper
 * is a wall corner and the room's name plate over the bottom third. */
{
  const dx = P.x - P.door[0], dz = P.z - P.door[1], d = Math.hypot(dx, dz);
  const x = P.door[0] + dx / d * 4, z = P.door[1] + dz / d * 4;
  await shot('door', { x, y: 1.7, z, yaw: aim(x, z, P.x, P.z), pitch: -0.28 });
}
/* From inside: a few metres past the door toward the nearest sitter in the room. */
const mine = sat.seated.filter((b) => b.place === PLACE_ID);
if (mine.length) {
  const cx = mine.reduce((a, b) => a + b.x, 0) / mine.length, cz = mine.reduce((a, b) => a + b.z, 0) / mine.length;
  const cy = mine.reduce((a, b) => a + b.y, 0) / mine.length;
  const dx = cx - P.door[0], dz = cz - P.door[1], d = Math.hypot(dx, dz);
  const k = Math.max(0, d - 4.5) / d;
  const fx = P.door[0] + dx * k, fz = P.door[1] + dz * k;
  await shot('inside', { x: fx, y: cy + 1.6, z: fz, yaw: aim(fx, fz, cx, cz), pitch: -0.18 });
  const near = mine.reduce((a, b) => (Math.hypot(b.x - fx, b.z - fz) < Math.hypot(a.x - fx, a.z - fz) ? b : a));
  const ndx = near.x - fx, ndz = near.z - fz, nd = Math.hypot(ndx, ndz);
  const nk = Math.max(0, nd - 2.4) / nd;
  await shot('close', { x: fx + ndx * nk, y: near.y + 1.5, z: fz + ndz * nk, yaw: aim(fx + ndx * nk, fz + ndz * nk, near.x, near.z), pitch: -0.22 });
}

await browser.close();
server.close();
say('done');
