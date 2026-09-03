/**
 * WHAT THE BATTLE OUTSIDE THE APERTURE ACTUALLY LOOKS LIKE.
 *
 * `tools/_deckshot.mjs` for the fleet action: boots the shipped page, walks
 * onto the deck, then stands the player at the muster line, mid-deck and the
 * lip and looks out — forward, left, right, up — at three points in the
 * round (the broadside, the burning, the reactor), seeking the dome's clock
 * between them. The pictures are the only judge this feature has.
 *
 *   node tools/_battleshot.mjs /tmp/battle
 *
 * Under swiftshader a frame is seconds; the whole run is ten to fifteen
 * minutes, under the render lock.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/* THE TREE THIS FILE IS IN, not the main clone: a worktree's probe has to
 * photograph the worktree's own source. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '/tmp/battle';
const TIMES = (process.argv[3] || '100,200,238').split(',').map(Number);
/* an optional station list, so a polish pass can re-shoot two frames and not twelve */
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

const say = (m) => process.stderr.write(`▸ ${m}\n`);
say(`start · root ${ROOT}`);
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('battleshot');
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
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)); });

say('goto');
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
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
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  document.querySelector('.tab[data-tab="company"]')?.click();
  await raf();
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar in the DOM' };
  btn.click();
  for (let i = 0; i < 5000 && !(window.SABER?.world?.terrain); i++) await raf();
  const w = window.SABER?.world;
  if (!w) return { fail: 'no world after clicking the door' };
  for (let i = 0; i < 60; i++) await raf();
  const st = w._deckBattle;
  return {
    battle: !!st, hulls: st?.hulls.length, draws: st?.group.children.length,
    fleet: window.SABER?.engine?.skyDome?.mat?.uniforms?.uFleet?.value,
    calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null,
    tris: window.SABER?.engine?.renderer?.info?.render?.triangles ?? null,
  };
});
say(`deck ${JSON.stringify(info)}`);
console.log('deck:', JSON.stringify(info));

const SHOT = { timeout: 180000 };
if (!info.fail) {
  await page.evaluate(() => {
    window.THREE_V3 = window.SABER?.world?.player?.position?.constructor || null;
    const S = window.SABER;
    S?.screens?.set?.('playing');
    S?.resume?.();
    if (S?.input) S.input.enabled = true;
  });
  const FWD = Math.PI;
  const stations = {
    'muster-fwd': { yaw: FWD, pitch: 0.06, x: 0, y: 1.7, z: -44 },
    'mid-fwd': { yaw: FWD, pitch: 0.10, x: 0, y: 1.7, z: 40 },
    'lip-fwd': { yaw: FWD, pitch: 0.14, x: 0, y: 1.7, z: 132 },
    'lip-left': { yaw: FWD - 0.55, pitch: 0.22, x: -20, y: 1.7, z: 132 },
    'lip-right': { yaw: FWD + 0.50, pitch: 0.10, x: 20, y: 1.7, z: 132 },
    'lip-up': { yaw: FWD + 0.30, pitch: 0.36, x: 0, y: 1.7, z: 138 },
    'lip-farleft': { yaw: FWD - 1.05, pitch: 0.12, x: -40, y: 1.7, z: 134 },
  };
  const plan = [];
  for (const T of TIMES) {
    const names = ONLY || (T === TIMES[0] ? Object.keys(stations) : ['lip-fwd', 'lip-right', 'mid-fwd']);
    for (const n of names) plan.push([`t${T}-${n}`, T, stations[n]]);
  }
  let lastT = -1;
  for (const [name, T, v] of plan) {
    const seek = T !== lastT;
    lastT = T;
    await page.evaluate(async ({ v, T, seek }) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const S = window.SABER;
      const p = S?.world?.player;
      if (seek) {
        /* THE DOME'S CLOCK is the battle's clock; DeckBattle follows it. */
        const sky = S?.engine?.skyDome;
        if (sky) sky._orbitT = T;
      }
      if (p) {
        p.position.set(v.x, v.y, v.z);
        p.velocity?.set?.(0, 0, 0);
        if (window.THREE_V3) p.body?.setTransform?.(new window.THREE_V3(v.x, v.y + 0.9, v.z), null);
        if (p.camera) { p.camera.yaw = v.yaw; p.camera.pitch = v.pitch; }
        if (p.control) { p.control.yaw = v.yaw; p.control.pitch = v.pitch; }
      }
      /* enough frames for the bolts to fill the sky again after a seek */
      for (let i = 0; i < (seek ? 18 : 8); i++) await raf();
    }, { v, T, seek });
    const at = await page.evaluate(() => {
      const c = window.SABER?.engine?.camera;
      const st = window.SABER?.world?._deckBattle;
      let shown = 0; for (const h of st?.hulls || []) if (h.shown) shown++;
      return {
        cam: c ? [c.position.x, c.position.y, c.position.z].map((n) => +n.toFixed(1)) : null,
        t: st ? +st.t.toFixed(1) : null, shown, bolts: st?.bolts.alive,
        calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null,
        far: c?.far,
      };
    });
    await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT }).catch((e) => console.log(name, 'shot:', e.message));
    say(`wrote ${name} · ${JSON.stringify(at)}`);
    console.log('wrote', `${OUT}/${name}.png`, JSON.stringify(at));
  }
}
await browser.close();
server.close();
