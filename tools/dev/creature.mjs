// node tools/dev/creature.mjs OUTDIR kind [kind...]  — renders each kind from 3 angles.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
const ROOT = new URL('../../', import.meta.url).pathname;
const [OUT, ...KINDS] = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); } });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/tools/dev/creature.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const VIEWS = [['34', 0.7, 0.22], ['side', Math.PI / 2, 0.08], ['front', 0.0, 0.15]];
for (const kind of KINDS) {
  for (const [name, az, el] of VIEWS) {
    const info = await page.evaluate(([k, a, e]) => window.__show(k, a, e), [kind, az, el]);
    await page.screenshot({ path: join(OUT, `${kind}-${name}.png`) });
    if (name === '34') console.log(kind, JSON.stringify(info));
  }
}
await browser.close(); server.close();
