/**
 * WHAT THE FLIGHT DECK ACTUALLY LOOKS LIKE.
 *
 * The one question this feature lives or dies on cannot be answered by a check:
 * six interiors were deleted here for looking like a box and every one of them
 * passed its suites. So this boots the shipped page in Chromium, walks onto the
 * deck through the real door, and takes the shots a person would judge it by.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/deck';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
  }));
  /* A ROLL TO STAND UP. The deck's whole subject is the player's own company
   * and a fresh profile has none, so the shot would be of an empty floor. */
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

const boot = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 1200 && !window.__hooks; i++) await raf();
  return { hooks: !!window.__hooks, keys: window.__hooks ? Object.keys(window.__hooks).length : 0 };
});
console.log('boot:', JSON.stringify(boot));

const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar in the DOM' };
  btn.click();
  for (let i = 0; i < 3000 && !(window.world && window.world.terrain); i++) await raf();
  const w = window.world;
  if (!w) return { fail: 'no world after clicking the door' };
  for (let i = 0; i < 240; i++) await raf();
  let meshes = 0;
  w.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes++; });
  return {
    mode: w.settings?.mode, level: w.levelKey, terrain: w.terrain?.size,
    meshes, statics: w.statics?.length, lights: w.levelLights?.length,
    director: w.director?.constructor?.name,
    command: !!w.command,
    player: w.player ? [w.player.position.x, w.player.position.y, w.player.position.z].map((n) => +n.toFixed(1)) : null,
    calls: window.engine?.renderer?.info?.render?.calls ?? null,
    tris: window.engine?.renderer?.info?.render?.triangles ?? null,
  };
});
console.log('deck:', JSON.stringify(info));

const SHOT = { timeout: 180000 };
if (!info.fail) {
  const shots = [
    ['deck-forward', { yaw: 0, pitch: -0.05, x: 0, y: 1.7, z: -34 }],
    ['deck-line', { yaw: 0, pitch: -0.02, x: 0, y: 1.7, z: -26 }],
    ['deck-line-close', { yaw: 0, pitch: 0, x: -6, y: 1.7, z: -17 }],
    ['deck-lip', { yaw: 0, pitch: 0.02, x: 0, y: 1.7, z: 54 }],
    ['deck-port', { yaw: -1.35, pitch: -0.02, x: 0, y: 1.7, z: -14 }],
    ['deck-aft', { yaw: Math.PI, pitch: 0.05, x: 0, y: 1.7, z: -14 }],
    ['deck-up', { yaw: 0, pitch: 0.85, x: 0, y: 1.7, z: 0 }],
  ];
  for (const [name, v] of shots) {
    await page.evaluate(async (v) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const p = window.world?.player;
      if (p) {
        p.position.set(v.x, v.y, v.z);
        if (p.camera) { p.camera.yaw = v.yaw; p.camera.pitch = v.pitch; }
        if (p.control) { p.control.yaw = v.yaw; p.control.pitch = v.pitch; }
      }
      for (let i = 0; i < 40; i++) await raf();
    }, v);
    await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT }).catch((e) => console.log(name, 'shot:', e.message));
    console.log('wrote', `${OUT}/${name}.png`);
  }
}
await browser.close();
server.close();
