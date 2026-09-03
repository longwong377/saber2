/**
 * THE COMPANION ON THE DECK, PHOTOGRAPHED — walking beside you and sat.
 *
 *   node tools/_cmpdeckshot.mjs [kind] [outdir]
 *
 * `_deckshot.mjs` photographs the ROOM and never adopts an animal, so it has
 * never once had a companion in frame; `_cmplifeshot.mjs` fields the FIELD
 * body on a level and cannot see the deck's sit at all. This is the third
 * case and it is the one the player looks at longest.
 *
 * TWO THINGS IT DOES THAT ARE WORTH KNOWING. It adopts through `Kennel.adopt`
 * inside the page — the same module instance the game is running, reached by
 * importing the same URL — rather than hand-writing the record into
 * localStorage, so a schema change breaks this loudly instead of quietly.
 * And it moves the animal in FRONT of the player by writing `DECK_HEEL.back`
 * negative on that same live module, because the whole design of the station
 * is that the animal stands behind you where a first-person camera cannot
 * see it.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const KIND = process.argv[2] || 'massiff';
const OUT = process.argv[3] || `/tmp/cmpdeck-${KIND}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
const { hold } = await import('./_lock.mjs');
await hold('cmpdeckshot');
say('lock held');
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
let _pe = 0;
page.on('pageerror', (e) => {
  if (_pe++ > 2) return;
  console.log('PAGE ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 14).join('\n'));
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
  }));
  const men = Array.from({ length: 4 }, (_, i) => ({
    designation: 'CT-' + (1000 + i), name: 'CT-' + (1000 + i), type: 'trooper',
    army: 'republic', xp: i * 40, kills: 0, areas: 2, wounds: 0,
    look: { mark: null, band: null, kit: {}, paint: {} }, squad: null, alive: true,
  }));
  localStorage.setItem('saber.company.v1', JSON.stringify({
    v: 1, republic: { army: 'republic', men, fallen: [], runs: 1 },
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });
/* THE ANIMAL, THROUGH THE SAME MODULE THE GAME IS RUNNING. */
const adopted = await page.evaluate(async (kind) => {
  const Kn = await import('/src/game/Kennel.js');
  Kn.clear();
  const rec = Kn.adopt(kind, 'Borz');
  return rec ? { id: rec.id, kind: rec.kind } : null;
}, KIND);
say(`adopted ${JSON.stringify(adopted)}`);
const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  document.querySelector('.tab[data-tab="company"]')?.click();
  await raf();
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar' };
  btn.click();
  for (let i = 0; i < 5000 && !(window.SABER?.world?.terrain); i++) await raf();
  const w = window.SABER?.world;
  if (!w) return { fail: 'no world' };
  for (let i = 0; i < 240; i++) await raf();
  /* IN FRONT, NOT BEHIND — see the header. */
  const M = await import('/src/game/CompanionDeck.js');
  M.DECK_HEEL.back = -3.4;
  M.DECK_HEEL.side = 0;
  for (let i = 0; i < 200; i++) await raf();
  const fig = w._companionDeck;
  return {
    fig: !!fig, path: fig?.path, sit: fig ? +fig.sit.toFixed(2) : null,
    pos: fig ? [fig.pos.x, fig.pos.y, fig.pos.z].map((n) => +n.toFixed(2)) : null,
    player: w.player ? [w.player.position.x, w.player.position.y, w.player.position.z].map((n) => +n.toFixed(2)) : null,
  };
});
say(`deck ${JSON.stringify(info)}`);
console.log('deck:', JSON.stringify(info));
await page.evaluate(() => {
  const S = window.SABER;
  S?.screens?.set?.('playing');
  S?.resume?.();
  if (S?.input) S.input.enabled = true;
  for (const el of document.body.children) if (el.tagName !== 'CANVAS') el.style.display = 'none';
});
const shoot = async (name, pitch, frames, drag) => {
  await page.evaluate(async ([pitch, frames, drag]) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const p = window.SABER?.world?.player;
    for (let i = 0; i < frames; i++) {
      if (p) {
        if (p.camera) p.camera.pitch = pitch;
        if (p.control) p.control.pitch = pitch;
        if (drag) p.position.x += 0.10;
      }
      await raf();
    }
  }, [pitch, frames, drag]);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  const st = await page.evaluate(() => {
    const f = window.SABER?.world?._companionDeck;
    return f ? { sit: +f.sit.toFixed(2), phase: +f.phase.toFixed(2) } : null;
  });
  say(`wrote ${name} ${JSON.stringify(st)}`);
};
await shoot('00-sat', 0.10, 60, false);
await shoot('01-sat-down', 0.30, 12, false);
await shoot('02-walking', 0.12, 40, true);
await shoot('03-walking-2', 0.12, 6, true);
await shoot('04-sat-again', 0.12, 90, false);
await browser.close();
server.close();
