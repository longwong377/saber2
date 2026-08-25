/**
 * THE AFTER-ACTION PANEL, PAINTED BY A REAL BROWSER — PLAN.md §4.9.
 *
 * `tools/checks/report.mjs` drives the same card through `_page.mjs`, which has
 * no layout engine: it can say the rows are there and it cannot say whether the
 * card they are on fits the screen. THAT is what this answers, and it found the
 * one thing the shim could not — the pause card is 1051 px tall with the report
 * open in an 800 px window, so the button at the bottom of it opened a panel
 * entirely below the fold and read as a button that did nothing.
 *
 *   node --import ./tools/register.mjs tools/_reportshot.mjs
 *
 * Prints the census as the browser lays it out, the card's scroll height
 * against the viewport, and where the panel ends up after the click; writes
 * `.shots/report.png`. The log is a fixture rather than a run: what is being
 * looked at is the LAYOUT, and a run would give a different one every seed.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });

const info = await page.evaluate(async () => {
  const { runReport } = await import('/src/game/Session.js');
  const { Menu, DEFAULT_SETTINGS } = await import('/src/ui/Menu.js');
  const fell = (name, killer, at, area = 1) => ({ t: 'fell', name, unit: '2nd Squad', rank: 'CT',
    area, wave: 3, xp: 2, kills: 1, killer, bearing: 40 * area, at });
  const log = [
    fell('CT-4471', 'B2 Super Battle Droid', 61, 1),
    fell('CT-2209', 'B1 Battle Droid', 96, 1),
    { t: 'steps-up', name: 'CT-8813', after: 'CT-4471', area: 1 },
    { t: 'area', area: 1, name: 'The Foundry', strength: 8, fallen: 2 },
    { t: 'mission', grid: 'F42', lapsed: false, told: 6, verified: false, hostiles: 5,
      friendlies: 2, names: ['CT-3390', 'CT-1102'], at: 244 },
    fell('CT-3390', 'your own fire mission', 245, 2),
    fell('CT-1102', 'your own fire mission', 245, 2),
    fell('CT-6650', 'B2 Super Battle Droid', 260, 2),
    { t: 'promote', name: 'CT-8813', rank: 'VET', area: 2, wave: 5 },
    { t: 'area', area: 2, name: 'The Ridge', strength: 7, fallen: 5 },
    fell('CT-7724', 'Droideka', 402, 3),
  ];
  const menu = new Menu(structuredClone(DEFAULT_SETTINGS), {});
  menu.showPause([['Wave', 6], ['Score', '18,400'], ['Kills', 71]], false, runReport(log));
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('btn-pause-report').click();
  const box = document.getElementById('pause-report-box');
  const wrap = document.querySelector('#pause .pause-wrap');
  const r = box.getBoundingClientRect();
  return { open: !box.classList.contains('hidden'),
    boxTop: Math.round(r.top), boxBottom: Math.round(r.bottom),
    aria: document.getElementById('btn-pause-report').getAttribute('aria-expanded'),
    head: document.getElementById('report-head').textContent,
    census: document.getElementById('report-census').innerText,
    wrapH: wrap.scrollHeight, viewH: window.innerHeight,
    areasScroll: document.getElementById('report-areas').scrollHeight,
    areasClient: document.getElementById('report-areas').clientHeight,
    areasOffset: document.getElementById('report-areas').offsetWidth
      - document.getElementById('report-areas').clientWidth };
});
console.log(JSON.stringify(info, null, 1));
await mkdir(join(ROOT, '.shots'), { recursive: true });
await page.screenshot({ path: join(ROOT, '.shots', 'report.png'), fullPage: false });
console.log('errors:', errs.slice(0, 3));
await browser.close(); server.close();
