/**
 * scratch: point the camera out of a notional hangar aperture and photograph
 * the orbit dome. Boots the real game, swaps the atmosphere for an interior
 * with a window, names a theatre, and shoots.
 *
 *   node tools/_orbitshot.mjs --world alpine --out planet-ice --t 40 --yaw 0
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = process.env.SHOT_OUT || join(ROOT, '.shots');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const WORLD = flag('world', 'alpine');
const NAME = flag('out', 'orbit');
const T = parseFloat(flag('t', '40'));
const YAW = parseFloat(flag('yaw', '0'));
const PITCH = parseFloat(flag('pitch', '0.10'));
const FOV = parseFloat(flag('fov', '58'));
const SIZE = flag('size', '');
const EXTRA = flag('extra', '{}');
const SETTLE = parseInt(flag('settle', '4'), 10);
const WIDTH = parseInt(flag('width', '1280'), 10);
const HEIGHT = parseInt(flag('height', '720'), 10);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg' };
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
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'colosseum', quality: 'medium', mode: 'sandbox', resolutionScale: 0.7,
    difficulty: 'knight', volume: 0, music: 0, sandboxCount: 0, sandboxFire: 0,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
await page.click('#btn-deploy');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 300000 });

const info = await page.evaluate(async ([world, t, yaw, pitch, fov, size, extra, settle]) => {
  const S = window.SABER, w = S.world, p = w.player;
  const { LEVELS } = await import('/src/game/Levels.js');
  const { TERRAIN_PRESETS } = await import('/src/world/Terrain.js');
  const dome = S.engine.skyDome;
  /* The Flight Deck's own atmosphere, transcribed from src/game/Hangar.js so
   * the shot is exposed the way the room will be. */
  S.engine.applyAtmosphere({
    sky: false, bgColor: 0x05070c, fog: true, fogColor: 0x0a0f18, fogDensity: 0.004,
    sunColor: 0xbcd8ff, sunIntensity: 3.2, ambient: 0.42,
    skyColor: 0x6e88b8, groundColor: 0x22262c, elevation: 12, azimuth: 0,
    fillColor: 0xffb070, fillIntensity: 0.35,
    exposure: 1.2, bloom: 0.75, saturation: 1.02,
    lift: [0.004, 0.006, 0.012], gain: [0.98, 1.0, 1.08],
    orbit: true,
  });
  const L = LEVELS[world];
  dome.configureOrbit(Object.assign({
    level: L, terrain: TERRAIN_PRESETS[L.terrain], faction: 'republic', time: t,
  }, size ? { size: parseFloat(size) } : {}, JSON.parse(extra)));

  // Hide the world so only the view is in frame: this shot is about the dome.
  for (const c of S.engine.scene.children) {
    if (c === dome.mesh) continue;
    if (c.isMesh || c.isPoints || c.isLine || c.isGroup) c.visible = false;
  }
  S.hud.show(false);
  document.getElementById('hud')?.classList.add('hidden');

  const cam = S.engine.camera;
  cam.fov = fov; cam.updateProjectionMatrix();
  const pd = dome.mat.uniforms.uPlanetDir.value;
  // Look between the planet and the fleet, which is where the composition is.
  const yawTo = Math.atan2(pd.x, pd.z) + yaw;
  cam.position.set(0, 2, 0);
  cam.rotation.set(0, 0, 0, 'YXZ');
  cam.rotation.y = yawTo; cam.rotation.x = pitch;
  cam.updateMatrixWorld();
  dome.mesh.position.copy(cam.position);

  for (let i = 0; i < settle; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.rotation.set(pitch, yawTo, 0, 'YXZ'); cam.updateMatrixWorld();
    dome.mesh.position.copy(cam.position);
  }
  const u = dome.mat.uniforms;
  const r = S.engine.renderer.info.render;
  return { calls: r.calls, tris: r.triangles, orbit: u.uOrbit.value,
    key: +u.uOrbitKey.value.toFixed(3), planetDir: pd.toArray().map((v) => +v.toFixed(3)),
    cap: +u.uCapAmt.value.toFixed(3), seaAmt: u.uSeaAmt.value, seaGlow: u.uSeaGlow.value,
    land: u.uLandCol.value.getHexString(), sea: u.uSeaCol.value.getHexString(),
    atmo: u.uAtmoCol.value.getHexString(), t: +u.uOrbitT.value.toFixed(1) };
}, [WORLD, T, YAW, PITCH, FOV, SIZE, EXTRA, SETTLE]);

const file = join(OUT, `${NAME}.png`);
await page.screenshot({ path: file, timeout: 300000 });
console.log(JSON.stringify({ file, ...info, errors: errors.slice(0, 6) }));
await browser.close();
server.close();
