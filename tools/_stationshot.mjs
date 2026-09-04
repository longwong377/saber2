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
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

/* THE REAL DOOR. `enterStation` is what `onDeckLift` calls when the button
 * column was set to a floor — the same function, with the lift ride skipped
 * because a shot tool does not need seven seconds of shaft. */
const info = await page.evaluate(async (deck) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  if (!S?.enterStation) return { fail: 'no SABER.enterStation — is STATION_ENABLED off?' };
  S.enterStation({ n: deck, label: 'shot', level: 'station', deck }).catch((e) => { window.__stationFail = String(e); });
  for (let i = 0; i < 6000 && !(window.SABER?.world?._station); i++) {
    await raf();
    if (i % 100 === 0) window.__wait = i;
  }
  const w = window.SABER?.world;
  if (!w?._station) return { fail: window.__stationFail || `no station after ${window.__wait} frames` };
  S.screens?.set?.('playing');
  S.resume?.();
  if (S.input) S.input.enabled = true;
  window.THREE_V3 = w.player?.position?.constructor || null;
  for (let i = 0; i < 60; i++) await raf();
  const st = w._station;
  let meshes = 0;
  w.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes++; });
  return {
    level: w.levelKey, deck: st.deck, places: st.places.size,
    draws: st.draws, tris: Math.round(st.tris), colliders: st.solids,
    props: w.props?.length, meshes,
    calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null,
    rtris: window.SABER?.engine?.renderer?.info?.render?.triangles ?? null,
    player: w.player ? [w.player.position.x, w.player.position.y, w.player.position.z].map((n) => +n.toFixed(1)) : null,
  };
}, DECK);
say(`station ${JSON.stringify(info)}`);
console.log('station:', JSON.stringify(info));
if (info.fail) { await browser.close(); server.close(); process.exit(1); }

/* THE PLAN, read out of the page so the sheet cannot drift from the gazetteer. */
const places = await page.evaluate((deck) => {
  const st = window.SABER.world._station;
  const out = [];
  for (const rec of st.places.values()) {
    const p = rec.place;
    if (p.deck !== deck) continue;
    out.push({ id: p.id, name: p.name, shape: p.shape, look: p.look, door: p.door, x: p.x, z: p.z, h: p.h, d: p.d });
  }
  return out.sort((a, b) => a.id - b.id);
}, DECK);

const SHOT = { timeout: 180000 };
const shot = async (name, at) => {
  const ok = await page.evaluate(async (a) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const w = window.SABER?.world, p = w?.player;
    if (!p) return false;
    /* Stand at the door, eye height, looking into the room. Every place's
     * door is in the plan and its yaw points at its centre, so a sheet is
     * fifty-five identical framings and the only variable is the room. */
    p.position.set(a.x, a.y, a.z);
    p.body?.position?.set?.(a.x, a.y, a.z);
    if (p.camera) { p.camera.yaw = a.yaw; p.camera.pitch = a.pitch || 0; }
    /* Three frames: one to move, one for the camera rig to settle on the new
     * yaw, one to render it. One is a picture of where the camera WAS. */
    for (let i = 0; i < 4; i++) await raf();
    return true;
  }, at);
  if (!ok) return;
  await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT });
  say(`shot ${name}`);
};

/* The overview first: the atrium from the balcony, which is the one shot that
 * answers §3.1 rule 1 — can you see two other decks and the people on them. */
const Y = { 40: 0, 44: 12.5, 48: 25 }[DECK] ?? 0;
await shot('00-atrium', { x: 0, y: Y + 1.7, z: 24, yaw: Math.PI, pitch: -0.05 });
await shot('01-atrium-up', { x: 0, y: Y + 1.7, z: 24, yaw: Math.PI, pitch: 0.35 });
await shot('02-ring', { x: 0, y: Y + 1.7, z: 82, yaw: Math.PI / 2, pitch: 0 });
await shot('03-spine', { x: 0, y: Y + 1.7, z: -50, yaw: Math.PI, pitch: 0 });

for (const p of places) {
  if (ONLY && !ONLY.includes(p.id)) continue;
  /* From the door, facing the room's centre. The camera's forward at yaw θ is
   * (−sin θ, −cos θ) — `_deckshot`'s own read-back settles it: yaw π looks
   * toward +z. So one atan2 aims every shot down its own room. */
  const yaw = Math.atan2(-(p.x - p.door[0]), -(p.z - p.door[1]));
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await shot(`${String(p.id).padStart(2, '0')}-${slug}`,
    { x: p.door[0], y: Y + 1.7, z: p.door[1], yaw, pitch: 0 });
}

await browser.close();
server.close();
say('done');
