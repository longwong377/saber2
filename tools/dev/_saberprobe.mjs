// node tools/dev/_saberprobe.mjs OUT set   — deploy with a saber set, shoot TP/FP idle and swing frames.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const ROOT = new URL('../../', import.meta.url).pathname;
const [OUT, SET = 'staff', SPECIES = 'human'] = process.argv.slice(2);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.wasm':'application/wasm', '.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.play.html';
    const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); } });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.addInitScript(() => { window.__frame = (ms = 20000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no frame')), ms); requestAnimationFrame(() => { clearTimeout(t); res(); }); }); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([set, sp]) => { localStorage.setItem('saber.settings.v2', JSON.stringify({ instantSpawn: true, quality: 'low', resolutionScale: 1.0, difficulty: 'knight', mode: 'sandbox', volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6, companion: 'none', saberSet: set, species: sp, sandboxCount: 0 })); }, [SET, SPECIES]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.click('#btn-deploy');
await page.evaluate(async () => { let f = 0; while (document.querySelector('#hud')?.classList.contains('hidden')) { if (f++ > 40) throw new Error('no hud'); await window.__frame(); } for (let i = 0; i < 8; i++) await window.__frame(); });
const frames = async (n) => { for (let i = 0; i < n; i++) await page.evaluate(() => window.__frame()); };
const info = () => page.evaluate(() => { const p = window.SABER.world.player; return { fp: !!p.camera.firstPerson, eye: +(p.eyeHeight ?? 0).toFixed(2), camY: +(p.camera.pos.y - p.position.y).toFixed(2), set: p.saberSet || p.set || null }; });
await page.mouse.click(640, 360);
await frames(6);
console.log('tp idle', JSON.stringify(await info()));
await page.screenshot({ path: `${OUT}/${SET}-tp-idle.png` });
// a swing: drag the mouse across
await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(300, 420, { steps: 3 }); await frames(2);
await page.screenshot({ path: `${OUT}/${SET}-tp-swing.png` });
await page.mouse.move(900, 300, { steps: 3 }); await frames(2); await page.mouse.up();
await page.screenshot({ path: `${OUT}/${SET}-tp-swing2.png` });
await frames(10);
await page.keyboard.press('KeyV'); await frames(6);
console.log('fp idle', JSON.stringify(await info()));
await page.screenshot({ path: `${OUT}/${SET}-fp-idle.png` });
await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(300, 420, { steps: 3 }); await frames(2);
await page.screenshot({ path: `${OUT}/${SET}-fp-swing.png` });
await page.mouse.up();
// walk a little in FP
await page.keyboard.down('KeyW'); await frames(6); await page.screenshot({ path: `${OUT}/${SET}-fp-walk.png` }); await page.keyboard.up('KeyW');
await browser.close(); server.close();
