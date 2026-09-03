/**
 * WHAT THE LIFT RIDE ACTUALLY LOOKS LIKE.
 *
 * The player: "when you're using the elevator you still don't see imagined
 * scenes from the rest of the station/ship you only see machinery buzzing
 * by". No check can answer that. This boots the shipped page in Chromium the
 * way `_deckshot.mjs` does, and photographs the ride from inside the car
 * through each window at a few points of it, then the landing at the stop.
 *
 *   node tools/_liftshot.mjs /tmp/lift
 *
 * Under swiftshader a frame is most of a second and `main.js` clamps `dt`
 * to 0.1 s, so the ride is advanced by reading the lift's own clock
 * (`world._deckLift.t`) rather than counting frames.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.env.SABER_ROOT || new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.argv[2] || '/tmp/lift';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

const say = (m) => process.stderr.write(`▸ ${m}\n`);
say(`start, root ${ROOT}`);
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('liftshot');
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
let _pe = 0;
page.on('pageerror', (e) => {
  if (_pe++ > 2) return;
  console.log('PAGE ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 14).join('\n'));
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });

say('goto');
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
say('loaded');
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0, volume: 0, music: 0,
  }));
  const men = Array.from({ length: 12 }, (_, i) => ({
    designation: 'CT-' + (1000 + i), name: 'CT-' + (1000 + i), type: 'trooper',
    army: 'republic', xp: i * 40, kills: i * 2, areas: 2, wounds: i % 3,
    look: { mark: null, band: null, kit: {}, paint: {} }, squad: null, alive: true,
  }));
  localStorage.setItem('saber.company.v1', JSON.stringify({
    v: 1, republic: { army: 'republic', men, fallen: [], runs: 1 },
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('reloaded, waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  document.querySelector('.tab[data-tab="company"]')?.click();
  await raf();
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar in the DOM' };
  btn.click();
  for (let i = 0; i < 5000 && !(window.SABER?.world?._deckLift); i++) await raf();
  const w = window.SABER?.world;
  if (!w?._deckLift) return { fail: 'no lift after clicking the door' };
  const S = window.SABER;
  S?.screens?.set?.('playing');
  S?.resume?.();
  if (S?.input) S.input.enabled = true;
  return { state: w._deckLift.state, t: w._deckLift.t, calls: S?.engine?.renderer?.info?.render?.calls ?? null };
});
say(`deck ${JSON.stringify(info)}`);
console.log('deck:', JSON.stringify(info));

const SHOT = { timeout: 180000 };
if (!info.fail) {
  /* FIRST PERSON — the third-person body stood over the middle of the pane.
   * Yaw π is forward (the doors); π/2 and 3π/2 are the side panes; 0 the back. */
  const shots = [
    ['01-ride-1.5s-left', { at: 1.5, yaw: Math.PI / 2, pitch: 0.0 }],
    ['02-ride-2.5s-right', { at: 2.5, yaw: -Math.PI / 2, pitch: 0.0 }],
    ['03-ride-3.5s-back', { at: 3.5, yaw: 0, pitch: 0.0 }],
    ['04-ride-4.5s-left', { at: 4.5, yaw: Math.PI / 2, pitch: 0.0 }],
    ['05-stop-left', { stop: true, yaw: Math.PI / 2, pitch: 0.0 }],
    ['06-stop-right', { stop: true, yaw: -Math.PI / 2, pitch: 0.0 }],
  ];
  for (const [name, v] of shots) {
    const at = await page.evaluate(async (v) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const w = window.SABER?.world;
      const st = w?._deckLift;
      const p = w?.player;
      if (p) {
        if (p.camera) { p.camera.firstPerson = true; p.camera.yaw = v.yaw; p.camera.pitch = v.pitch; }
        if (p.control) { p.control.yaw = v.yaw; p.control.pitch = v.pitch; }
      }
      /* Advance the lift's own clock to the moment asked for. */
      const settle = 0.5;
      for (let i = 0; i < 400; i++) {
        if (v.stop ? st.state !== 'ride' && st.state !== 'stop' : (st.state !== 'ride' || st.t >= settle + v.at)) break;
        await raf();
      }
      await raf();
      return { state: st.state, t: +st.t.toFixed(2), v: +st.v.toFixed(1), scroll: +st.scroll.toFixed(1), deck: st.readout?.number,
        calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null, tris: window.SABER?.engine?.renderer?.info?.render?.triangles ?? null };
    }, v);
    await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT }).catch((e) => console.log(name, 'shot:', e.message));
    say(`wrote ${name} · ${JSON.stringify(at)}`);
    console.log('wrote', `${OUT}/${name}.png`, JSON.stringify(at));
  }
}
await browser.close();
server.close();
