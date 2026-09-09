import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/cmp';
const KIND = process.argv[3] || 'massiff';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.wasm':'application/wasm', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.play.html';
    const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end(); } });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.addInitScript(() => { window.__frame = (ms=20000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no frame')), ms); requestAnimationFrame(() => { clearTimeout(t); res(); }); }); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate((kind) => { localStorage.setItem('saber.settings.v2', JSON.stringify({ instantSpawn: true, quality: 'low', resolutionScale: 1.0, difficulty: 'knight', mode: 'roguelite', volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6, companion: kind })); }, KIND);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
// companion select screen
const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab')].map(t => t.dataset.tab));
console.log('tabs', tabs);
for (const t of tabs) { const has = await page.evaluate((t) => { const el = document.querySelector(`.tab[data-tab="${t}"]`); el?.click(); return !!document.querySelector('#companion-list')?.offsetParent; }, t); if (has) { console.log('companion list on tab', t); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/select-${t}.png` }); break; } }
const cardHtml = await page.evaluate(() => document.querySelector('#companion-list')?.children[1]?.outerHTML.slice(0, 300));
console.log('card', cardHtml);
await page.evaluate(() => document.querySelector('.tab[data-tab="play"]')?.click());
await page.click('#btn-deploy');
await page.evaluate(async () => { let f = 0; while (document.querySelector('#hud')?.classList.contains('hidden')) { if (f++ > 40) throw new Error('no hud'); await window.__frame(); } for (let i = 0; i < 6; i++) await window.__frame(); });
const probe = () => page.evaluate(() => {
  const w = window.SABER.world, p = w.player; const cam = w.camera || w.cam || window.SABER.camera;
  const c = w.enemies.find(e => e._cmpKind) || (w.allies || []).find(e => e._cmpKind);
  const all = [...w.enemies].filter(e => e._cmpKind || e.team === p.team).map(e => ({ kind: e._cmpKind, team: e.team, label: e.A?.label, d: +e.position.distanceTo(p.position).toFixed(1) }));
  const plate = document.querySelector('#companion-plate');
  let rel = null;
  if (c && cam) { const T = window.THREE || null; const d = c.position.clone().sub(cam.position); const f = new (d.constructor)(); cam.getWorldDirection(f); const dist = d.length(); const dot = d.clone().normalize().dot(f); rel = { camDist: +dist.toFixed(1), ahead: +dot.toFixed(2), fromPlayer: +c.position.distanceTo(p.position).toFixed(1), hp: c.hp, hpMax: c.hpMax || c.maxHp } }
  return { companion: !!c, kind: c?._cmpKind, rel, teammates: all, plateHidden: plate?.classList.contains('hidden'), plateText: plate?.textContent, camKeys: Object.keys(w).filter(k=>/cam/i.test(k)) };
});
console.log('t0', JSON.stringify(await probe()));
await page.screenshot({ path: `${OUT}/t0.png` });
// walk forward for a while then stop and look
await page.mouse.click(640, 360);
await page.keyboard.down('KeyW');
for (let i = 0; i < 10; i++) await page.evaluate(() => window.__frame());
await page.keyboard.up('KeyW');
for (let i = 0; i < 8; i++) await page.evaluate(() => window.__frame());
console.log('t1 after walk+stop', JSON.stringify(await probe()));
await page.screenshot({ path: `${OUT}/t1.png` });
// turn around 180
await page.mouse.move(640, 360); await page.mouse.move(1900, 360, { steps: 4 });
for (let i = 0; i < 6; i++) await page.evaluate(() => window.__frame());
console.log('t2 after turn', JSON.stringify(await probe()));
for (let i = 0; i < 30; i++) await page.evaluate(() => window.__frame());
// walk toward it a little so it fills the frame, then hold still
await page.evaluate(() => { const w = window.SABER.world, p = w.player, c = w.enemies.find(e => e._cmpKind); if (c) { const d = c.position.clone().sub(p.position); d.y = 0; d.normalize(); p.aimDir?.copy?.(d); } });
for (let i = 0; i < 10; i++) await page.evaluate(() => window.__frame());
console.log('t2c close', JSON.stringify(await probe()));
await page.screenshot({ path: `${OUT}/t2c.png` });
await browser.close(); server.close();
