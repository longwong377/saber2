/**
 * BATTLEFRONT BORZ — does the page still DEPLOY, and does anything throw?
 *
 *   node tools/_deployprobe.mjs        (~40 s, no flags)
 *
 * WHY IT EXISTS. `smoke.mjs` is the real answer to "does the page boot and
 * render" and it takes five minutes. Its deploy step waits 30 s for the HUD,
 * and on this box a frame costs about two seconds (HANDOFF §2.6) — so that is
 * FIFTEEN FRAMES, and it times out on a loaded machine while the world builds
 * perfectly well. Measured: it failed four steps, and this probe deployed the
 * same build in 22.2 s with zero page errors on a quieter box.
 *
 * A timeout there therefore says nothing about the code, which is a bad
 * position to be in after touching the input layer. This asks the three
 * questions that DO separate a regression from contention, and nothing else:
 *
 *   did anything throw — every pageerror and console error, collected;
 *   does the world build at all, with a window long enough to be evidence;
 *   and the seams this round added, read out of the RUNNING page rather than
 *   out of a harness's module graph.
 *
 * It is not a check and it asserts nothing. Same rule as the two traces: the
 * moment an instrument scores something it becomes another bar to maintain.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve('/home/user/saber2');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0]));
  const file = join(ROOT, p === '/' ? 'index.play.html' : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('no'); }
});
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.play.html`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => localStorage.setItem('saber.settings.v2', JSON.stringify({
  level: 'scoria', quality: 'low', resolutionScale: 0.5, difficulty: 'knight',
  mode: 'roguelite', volume: 0, music: 0, grassScale: 0.3, particleScale: 0.3 })));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
console.log('menu up, errors so far:', errs.length);

// The pad map reaches the running page, and the glyph swap is real in a browser.
const glyphs = await page.evaluate(async () => {
  const B = await import('/src/engine/Bindings.js');
  const M = await import('/src/ui/Menu.js');
  const b = B.defaultBindings();
  const key = M.codexHtml(b);
  const pad = M.codexHtml(b, { device: 'pad', family: 'playstation' });
  const chip = (s) => [...s.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => m[1]);
  return { keyN: chip(key).length, padN: chip(pad).length,
    padHas: chip(pad).includes('L1+✕'), keyHas: chip(key).includes('F'),
    walkable: window.SABER?.menu?._padFocusable(window.SABER.menu._padHost()).length ?? -1 };
});
console.log('glyphs:', JSON.stringify(glyphs));

const t0 = Date.now();
await page.click('#btn-deploy');
let ok = false;
try {
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 180000 });
  ok = true;
} catch (e) { errs.push('deploy: ' + e.message.split('\n')[0]); }
console.log(`deploy ${ok ? 'OK' : 'FAILED'} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const info = await page.evaluate(() => {
  const w = window.SABER?.world;
  return { hasWorld: !!w, alive: w?.players?.length ?? 0, wave: w?.director?.wave ?? null,
    rumbleLevel: window.SABER?.engine?.rumbleLevel ?? 'unset',
    device: window.SABER?.input?.device, hudHidden: document.getElementById('hud')?.classList.contains('hidden') };
});
console.log('after deploy:', JSON.stringify(info));
console.log('errors:', errs.length ? errs.join('\n  ') : 'none');
await browser.close();
server.close();
