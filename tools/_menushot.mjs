// The real front screen, booted: the plate, the panel and everything JS fills in.
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
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => localStorage.setItem('saber.settings.v2', JSON.stringify({ volume: 0, music: 0 })));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
for (const tab of (process.argv.slice(2).length ? process.argv.slice(2) : ['deploy'])) {
  const el = await page.$(`.tab[data-tab="${tab}"]`);
  if (el) { await el.click(); await page.waitForTimeout(600); }
  await mkdir(join(ROOT, '.shots', 'menu'), { recursive: true });
  await page.screenshot({ path: join(ROOT, '.shots', 'menu', `live-${tab}.png`) });
  const info = await page.evaluate((t) => {
    const panel = document.querySelector(`.panel[data-panel="${t}"]`) || document.getElementById(t);
    const grid = document.getElementById('codex-grid');
    const active = [...document.querySelectorAll('.tab')].find(x => x.classList.contains('active'));
    return { active: active?.dataset.tab ?? null, panel: !!panel, hidden: panel?.classList.contains('hidden') ?? null,
      gridRows: grid ? grid.children.length : -1 };
  }, tab);
  console.log('live-' + tab + '.png', JSON.stringify(info));
}
console.log('errors:', errs.slice(0, 3));
await browser.close(); server.close();
