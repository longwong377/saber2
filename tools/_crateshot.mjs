/**
 * THE ONE CLAIM THAT CANNOT BE MADE IN PROSE.
 *
 * "Pick up crates and ships, throw them at the shield." A check can assert that
 * a body left the hand at 40 m/s; it cannot show you a crate in the air over a
 * flight deck. So this boots the SHIPPED PAGE in Chromium, walks onto the deck
 * through the real door, and drives the real keys — KeyG to grip, KeyY to hurl
 * — with no direct call into any power, because the thing being proved is that
 * the input path works with the blade down.
 *
 * `tools/_deckshot.mjs` is the composition shot and this is the play one; the
 * server, the flags, the lock and the boot probe are its, deliberately, so the
 * two tools are looking at the same page in the same way.
 *
 *     node tools/_crateshot.mjs /tmp/deckplay
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/deckplay';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

/* PROGRESS ON STDERR, FROM THE FIRST LINE — `_deckshot.mjs`'s note, and this
 * file paid for it too: a run that hangs before its first buffered `console.log`
 * writes a zero-byte file, and a job stuck behind four other browsers looks
 * exactly like a dead box. */
const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
/* THE LOCK IS TAKEN HERE and not by a wrapper script — see tools/_lock.mjs. */
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('crateshot');
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => say(`PAGE ERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') say(`console: ${m.text().slice(0, 200)}`); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('reloaded, waiting for the menu');

/* `#menu:not(.hidden)` is the DOM saying the game is up, polled OUT OF PROCESS.
 * A `requestAnimationFrame` spin inside `page.evaluate` is not a boot probe —
 * the boot sequence itself yields on rAF, so the spin competes with the thing
 * it is waiting for. See `_deckshot.mjs`, which paid for that twice. */
await page.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
say('menu up');

/* ── onto the deck, through the button a player presses ─────────────────── */
const onDeck = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  /* THE COMPANY TAB HAS TO BE UP for its button to be reachable, which is also
   * how a player gets there. */
  document.querySelector('.tab[data-tab="company"]')?.click();
  await raf();
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar in the DOM' };
  btn.click();
  for (let i = 0; i < 6000 && !window.SABER?.world?.player; i++) await raf();
  const w = window.SABER?.world;
  if (!w?.player) return { fail: 'no world with a player after clicking the door' };
  /* AND WAIT FOR THE MENU TO GO DOWN, not merely for a world to exist: the
   * player is spawned inside `buildWorld` and `enterHangar` hides the menu
   * after it returns, so a probe that stops at the first is a probe that
   * photographs the Deploy tab. Measured, once, exactly that. */
  for (let i = 0; i < 3000 && !document.getElementById('menu')?.classList.contains('hidden'); i++) await raf();
  for (let i = 0; i < 60; i++) await raf();
  const p = w.player;
  return {
    menuDown: !!document.getElementById('menu')?.classList.contains('hidden'),
    mode: w.settings?.mode, hosting: p.hosting, scheme: p.control?.scheme,
    lit: p.saber?.lit, ignition: +(p.saber?.ignition ?? -1).toFixed(3),
    crates: w.props.filter((q) => q.kind === 'crate' && !q.dead).length,
    at: [p.position.x, p.position.y, p.position.z].map((n) => +n.toFixed(1)),
    calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null,
  };
});
say(`deck ${JSON.stringify(onDeck)}`);
if (onDeck.fail) { await browser.close(); server.close(); process.exit(1); }

const SHOT = { timeout: 180000 };
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT }).catch((e) => say(`${name}: ${e.message}`));
  say(`wrote ${OUT}/${name}.png`);
};

/* ── 1. THE LIP. Put him where the walk ends and look out ───────────────── */
const lip = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const w = window.SABER.world, p = w.player;
  /* 63.6 m is where 40 s of held W actually stopped in `deckplay.mjs`: the
   * field's barrier, 0.36 m inside the lip. Placed rather than walked, because
   * twenty-two seconds of held key under swiftshader is twenty minutes. */
  const y = w.terrain.height(9, 63.4);
  p.position.set(9, y, 63.4);
  p.velocity.set(0, 0, 0);
  p.body?.setTransform?.({ x: 9, y: y + 0.9, z: 63.4 }, null);
  p.camera.yaw = Math.PI; p.camera.pitch = 0.02;
  p.camera.firstPerson = false;
  for (let i = 0; i < 90; i++) await raf();
  return { z: +p.position.z.toFixed(2), y: +p.position.y.toFixed(2), lit: p.saber.lit };
});
say(`lip ${JSON.stringify(lip)}`);
await shot('at-the-lip');

/* ── 2. THE GRIP. Stand off a crate, look at it, press KeyG ─────────────── */
const aimed = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const w = window.SABER.world, p = w.player;
  const c = w.props.filter((q) => q.kind === 'crate' && !q.dead)[0];
  window.__crate = c;
  const to = { x: c.body.position.x, z: c.body.position.z + 4 };
  const y = w.terrain.height(to.x, to.z);
  p.position.set(to.x, y, to.z);
  p.velocity.set(0, 0, 0);
  p.body?.setTransform?.({ x: to.x, y: y + 0.9, z: to.z }, null);
  p.camera.firstPerson = false;
  /* `aimDir` is (0,0,-1) through YXZ(pitch, yaw), so the yaw that looks along a
   * horizontal d is atan2(-dx, -dz). Iterated, because the grip ray leaves
   * `camera.pos` — three metres behind the head in third person, and it moves
   * as the yaw does. */
  const look = () => {
    const e = p.camera.pos ?? p.headPos;
    const d = { x: c.body.position.x - e.x, y: c.body.position.y - e.y, z: c.body.position.z - e.z };
    const n = Math.hypot(d.x, d.y, d.z);
    p.camera.yaw = Math.atan2(-d.x, -d.z);
    p.camera.pitch = Math.asin(Math.max(-1, Math.min(1, d.y / n)));
  };
  for (let i = 0; i < 4; i++) { look(); for (let k = 0; k < 8; k++) await raf(); }
  look();
  for (let k = 0; k < 4; k++) await raf();
  return { crate: [c.body.position.x, c.body.position.y, c.body.position.z].map((n) => +n.toFixed(2)) };
});
say(`aimed ${JSON.stringify(aimed)}`);

await page.keyboard.press('g');
const held = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const p = window.SABER.world.player, c = window.__crate;
  const y0 = c.body.position.y;
  /* AND A HELD THING FOLLOWS THE AIM — looking up is what takes it off the
   * deck, which is also how a player winds up to throw one. */
  for (let i = 0; i < 20; i++) await raf();
  p.camera.pitch = 0.42;
  for (let i = 0; i < 80; i++) await raf();
  return {
    gripped: !!p.gripBody, isThisCrate: p.gripBody === c.body,
    rose: +(c.body.position.y - y0).toFixed(2),
    refusal: p.lastGripRefusal ? p.lastGripRefusal.why : null,
    lit: p.saber.lit,
  };
});
say(`grip ${JSON.stringify(held)}`);
await shot('crate-held');

/* ── 3. THE THROW. Press KeyY and photograph it on the way up ───────────── */
await page.keyboard.press('y');
const flight = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const w = window.SABER.world, c = window.__crate;
  const y0 = c.body.position.y;
  let peak = y0, speed = 0;
  /* Fly until it is well clear of the deck. `dt` is capped at 0.1 s a frame in
   * `main.js`, so under swiftshader the world runs SLOWER than wall clock and a
   * four-second arc is comfortably long enough to photograph. */
  for (let i = 0; i < 600; i++) {
    await raf();
    speed = Math.max(speed, c.body.velocity.length());
    peak = Math.max(peak, c.body.position.y);
    if (c.body.position.y > y0 + 6 && c.body.velocity.y < 1) break;
  }
  return {
    y0: +y0.toFixed(2), now: +c.body.position.y.toFixed(2), peak: +peak.toFixed(2),
    topSpeed: +speed.toFixed(1), stillHeld: !!w.player.gripBody, lit: w.player.saber.lit,
  };
});
say(`flight ${JSON.stringify(flight)}`);
await shot('crate-in-the-air');
await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 10; i++) await raf();
});
await shot('crate-in-the-air-2');

/* ── 4. THE REFUSALS. KeyX ignite, KeyH throw the saber, KeyJ the barrier ── */
await page.evaluate(() => {
  const w = window.SABER.world;
  window.__said = [];
  const real = w.notify?.bind(w);
  w.notify = (t, why) => { window.__said.push(`${t}: ${why}`); real?.(t, why); };
});
for (const key of ['x', 'h', 'j']) { await page.keyboard.press(key); await page.waitForTimeout(1200); }
const said = await page.evaluate(() => ({
  said: window.__said,
  lit: window.SABER.world.player.saber.lit,
  throwState: window.SABER.world.player.throwState,
  shield: window.SABER.world.player.shield.up,
}));
say(`refusals ${JSON.stringify(said)}`);

await browser.close();
server.close();
say('done');
