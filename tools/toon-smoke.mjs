/**
 * Boot check for the cel-shading experiment page.
 *
 *   node tools/toon-smoke.mjs [--frames 8] [--shot]
 *
 * `tools/smoke.mjs` cannot do this job: it is coupled to the GAME's boot
 * sequence — it writes `saber.settings.v2`, waits for the loading screen to
 * finish, deploys a level and drives the wave director. toon.html has none of
 * that. It is a different page with a different lifecycle, so it gets its own
 * short check rather than a pile of flags on the other one.
 *
 * What this proves, and it is exactly what a headless run CAN prove: the module
 * graph resolves, every import exists, the shaders compile, and nothing throws
 * across a few frames of the real animation loop. What it cannot prove is
 * whether the result looks good — that needs eyes, which is the whole reason
 * the page exists.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const FRAMES = parseInt(flag('frames', '8'), 10);
const SHOT = args.includes('--shot');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/toon.html';
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
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));
// A 404 is a SUCCESSFUL response with a failing status, so `requestfailed`
// never sees it and the console only says "Failed to load resource" with no
// URL. Naming the file is the entire value of this listener.
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(`http://127.0.0.1:${port}/toon.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait for the loop to actually be running rather than for a fixed delay: the
// scene builds real bodies and bakes real 512² textures, and under SwiftShader
// that takes as long as it takes.
const ran = await page.waitForFunction(() => {
  const el = document.getElementById('fps');
  return el && el.textContent !== '—';
}, { timeout: 180000 }).then(() => true).catch(() => false);
if (!ran) errors.push('the render loop never produced a frame');

/**
 * Exercise every path, because a shader that only compiles when you flip to it
 * is a shader that is broken for the player and not for the test. Split mode in
 * particular is the only path that runs the scissor + both material sets in one
 * frame, and the outline pass only compiles when it is first drawn.
 */
for (const [label, fn] of [
  ['toon', () => { window.__app = null; }],
  ['pbr', () => document.querySelector('#mode button[data-v="pbr"]').click()],
  ['split', () => document.querySelector('#mode button[data-v="wipe"]').click()],
  ['toon again', () => document.querySelector('#mode button[data-v="toon"]').click()],
  ['outlines off', () => document.getElementById('outline').click()],
  ['outlines on', () => document.getElementById('outline').click()],
  ['dune palette', () => document.querySelector('#pal button[data-v="dune"]').click()],
  ['storm palette', () => document.querySelector('#pal button[data-v="storm"]').click()],
  ['6 bands', () => {
    const s = document.getElementById('bands'); s.value = '6';
    s.dispatchEvent(new Event('input'));
  }],
]) {
  await page.evaluate(fn).catch((e) => errors.push(`${label}: ${e.message}`));
  await page.waitForTimeout(400);
}

// let a few real frames go by on the last configuration
await page.waitForTimeout(Math.max(600, FRAMES * 120));

if (SHOT) {
  await mkdir(join(ROOT, '.smoke'), { recursive: true });
  await page.screenshot({ path: join(ROOT, '.smoke', 'toon.png') });
  console.log('shot → .smoke/toon.png');
}

const fps = await page.evaluate(() => document.getElementById('fps')?.textContent).catch(() => '?');

await browser.close();
server.close();

console.log('');
if (errors.length) {
  console.log(`✗ ${errors.length} error(s):`);
  for (const e of errors.slice(0, 12)) console.log('  ' + e);
  process.exit(1);
}
console.log(`clean — every mode, palette and toggle exercised, no console or page errors (${fps})`);
