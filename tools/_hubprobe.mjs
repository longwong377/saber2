/**
 * THE HUB, DRIVEN END TO END IN A REAL BROWSER — and photographed.
 *
 * Ignite on a fighting mode has to put you on the flight deck; the transport
 * has to fly you out through the field with the ship you left standing round
 * the deck behind you; the seam into the battlefield has to be a still of
 * the sealed bay rather than a menu plate; and the orbit has to open on the
 * same ship the same distance astern with your look carried over. No check
 * can see whether that reads as one flight, so this drives it and shoots it:
 *
 *   00-deck          just out of the lift, the transport on its pad
 *   01-out-back      three seconds past the field, looking back at the ship
 *   02-out-far       near the end of the run out
 *   03-orbit-back    the first orbit frames, looking back
 *   04-orbit-late    the orbit's end, doors shutting
 *
 * Usage: node tools/_hubprobe.mjs [outdir] [mode]
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/hub';
const MODE = process.argv[3] || 'waves';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
const { hold } = await import('./_lock.mjs');
await hold('hubprobe');
say('lock held');
await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.play.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
let _pe = 0;
page.on('pageerror', (e) => { if (_pe++ < 3) { console.log('PAGE ERROR:', e.message); console.log((e.stack || '').split('\n').slice(0, 10).join('\n')); } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate((MODE) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({ level: 'geonosis', mode: MODE, quality: 'low', allies: 0 }));
}, MODE);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });
say('menu up');

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 180000 });
  say(`shot ${name}`);
};
const look = (yaw, pitch) => page.evaluate(([yaw, pitch]) => {
  const c = window.SABER?.world?.player?.camera; if (!c) return;
  if (yaw != null) c.yaw = yaw; if (pitch != null) c.pitch = pitch;
}, [yaw, pitch]);
const frames = (n) => page.evaluate(async (n) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < n; i++) await raf();
}, n);

/* 1. IGNITE → the deck. */
const deck = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  const first = S.hangarFirst?.();
  document.getElementById('btn-deploy')?.click();
  for (let i = 0; i < 6000 && !(S.world?.terrain); i++) await raf();
  const w = S.world;
  if (!w) return { fail: 'no world' };
  for (let i = 0; i < 200; i++) await raf();
  /* Watch the loading screen for the still. */
  window.__stillSeen = false;
  const el = document.getElementById('loading');
  new MutationObserver(() => { if (el.classList.contains('still') && !el.classList.contains('hidden')) window.__stillSeen = true; })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
  return { hangarFirst: first, mode: w.settings?.mode, picked: w._pickedMode, level: w.levelKey,
    exterior: !!w._deckExterior, exteriorSeen: !!w._deckExterior?.seen,
    lift: w._deckLift?.state, flight: w._deckFlight?.phase };
});
console.log('deck:', JSON.stringify(deck));
if (deck.fail) { await browser.close(); server.close(); process.exit(1); }
await page.evaluate(() => { const S = window.SABER; S.screens?.set?.('playing'); S.resume?.(); if (S.input) S.input.enabled = true; });
await frames(60);
await look(Math.PI, 0.02);
await shot('00-deck');

/* 2. DEPART, and look back through the run out. */
const out = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER; const w = S.world;
  const DF = await import('/src/game/DeckFlight.js');
  const p = w.player;
  DF.embarkCompany?.(w);
  const ok = DF.depart(w);
  let n = 0;
  while (DF.flightPhase(w) !== 'out' && n++ < 4000) await raf();
  const hull = w._deckFlight.group;
  /* Look AFT: the hull flies +Z, so aft is −Z, which is camera yaw 0. */
  p.camera.yaw = 0; p.camera.pitch = 0.05;
  for (let i = 0; i < 150; i++) await raf();
  return { ok, phase: DF.flightPhase(w), hullZ: +hull.position.z.toFixed(0), camFar: S.engine.camera.far,
    exteriorSeen: !!w._deckExterior?.seen, exteriorVisible: !!w._deckExterior?.group?.visible,
    riding: !!p.riding, yaw: +p.camera.yaw.toFixed(2), hullYaw: +hull.rotation.y.toFixed(2) };
});
console.log('out:', JSON.stringify(out));
await shot('01-out-back');
await frames(240);
const out2 = await page.evaluate(() => { const w = window.SABER.world; return { phase: w._deckFlight?.phase, hullZ: +w._deckFlight?.group.position.z.toFixed(0) }; });
console.log('out2:', JSON.stringify(out2));
await shot('02-out-far');

/* 3. THE SEAM → orbit. */
const orbit = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  const w0 = S.world;
  let n = 0;
  while ((S.world === w0 || !S.world?.extraction) && n++ < 9000) await raf();
  const w = S.world;
  if (!w || w === w0) return { fail: 'no new world', still: window.__stillSeen };
  for (let i = 0; i < 30; i++) await raf();
  const E = w.extraction;
  const cap = E._capital;
  const p = w.player;
  return { still: window.__stillSeen, mode: w.settings?.mode, level: w.levelKey, phase: E.phase,
    yaw: +p.camera.yaw.toFixed(2), shipYaw: +(E._yaw ?? 0).toFixed(2),
    capital: cap ? { scale: cap.scale.x, dist: +cap.position.length().toFixed(0), visible: cap.visible, hangars: cap.userData?.hangars?.length ?? 0 } : null,
    doorL: E._model?.userData?.doorL?.position.z, riding: !!p.riding };
});
console.log('orbit:', JSON.stringify(orbit));
if (!orbit.fail) {
  await page.evaluate(() => { const w = window.SABER.world; const p = w.player; p.camera.yaw = (w.extraction._yaw ?? 0) + Math.PI; p.camera.pitch = 0.04; });
  await frames(30);
  await shot('03-orbit-back');
  await frames(360);
  const late = await page.evaluate(() => { const w = window.SABER.world; const E = w.extraction; return { phase: E.phase, t: +E.t.toFixed(1), doorL: E._model?.userData?.doorL?.position.z, capDist: E._capital ? +E._capital.position.length().toFixed(0) : null }; });
  console.log('late:', JSON.stringify(late));
  await shot('04-orbit-late');
}
await browser.close();
server.close();
say('done');
