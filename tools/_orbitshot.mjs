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
const PITCH = parseFloat(flag('pitch', '0'));
const FOV = parseFloat(flag('fov', '58'));
const SIZE = flag('size', '');
const EXTRA = flag('extra', '{}');
const AIM = flag('aim', 'planet');
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
await page.waitForSelector('#menu:not(.hidden)', { timeout: 600000 });
/* Under contention this box takes minutes to reach an interactive menu and
 * playwright's 30 s default fires while the page is still booting. */
await page.click('#btn-deploy', { timeout: 600000 });
await page.waitForSelector('#hud:not(.hidden)', { timeout: 300000 });

const info = await page.evaluate(async ([world, t, yaw, pitch, fov, size, extra, settle, aim]) => {
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
  for (const c of S.engine.camera.children) c.visible = false;
  p.saber?.retract?.();
  p.camera.firstPerson = true;
  S.input.enabled = false;
  S.hud.show(false);
  for (const el of document.querySelectorAll('body > *')) {
    if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.display = 'none';
  }

  const cam = S.engine.camera;
  const u0 = dome.mat.uniforms;
  cam.fov = fov; cam.updateProjectionMatrix();
  /* `home` aims at the UNDRIFTED placement, so two shots at different clocks
   * share one camera and the only thing that moved is the world. */
  const pd = aim === 'fleet' ? dome.mat.uniforms.uFleetDir.value
    : aim === 'home' ? dome._planetHome
    : dome.mat.uniforms.uPlanetDir.value;
  /* three's camera looks down -Z, so a rotation.y of t points it at
   * (-sin t, 0, -cos t). Getting this backwards puts the camera exactly 180
   * degrees from the subject and the shot comes back empty. */
  const yawTo = Math.atan2(-pd.x, -pd.z) + yaw;
  const pitchTo = Math.asin(Math.max(-1, Math.min(1, pd.y))) + pitch;
  /* Drive the RIG, not the camera. CameraRig writes yaw/pitch into the camera
   * every frame, so a rotation set here is gone before the next present and
   * the shot comes back looking wherever the player was facing. */
  for (let i = 0; i < settle; i++) {
    p.camera.yaw = yawTo; p.camera.pitch = pitchTo;
    p.saber?.retract?.();
    cam.fov = fov; cam.updateProjectionMatrix();
    for (const c of S.engine.scene.children) {
      if (c === dome.mesh) continue;
      if (c.isMesh || c.isPoints || c.isLine || c.isGroup) c.visible = false;
    }
    S.engine.scene.traverse((o) => {
      if (o !== dome.mesh && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) o.visible = false;
    });
    await new Promise((r) => requestAnimationFrame(r));
  }
  /* Read the presented frame back. Display luminance, not radiance — what is
   * being asked is what the player sees, and the tone curve is most of the
   * answer at both ends of the range. */
  const gl = S.engine.renderer.domElement;
  const c2 = document.createElement('canvas');
  c2.width = gl.width; c2.height = gl.height;
  const g2 = c2.getContext('2d');
  g2.drawImage(gl, 0, 0);
  const im = g2.getImageData(0, 0, c2.width, c2.height).data;
  const lumAt = (x, y) => { const i = ((y * c2.width) + x) * 4;
    return (0.2126 * im[i] + 0.7152 * im[i + 1] + 0.0722 * im[i + 2]) / 255; };
  const scan = [];
  for (let x = 0; x < c2.width; x += Math.round(c2.width / 32)) {
    scan.push(+lumAt(x, Math.round(c2.height * 0.48)).toFixed(3));
  }
  let hot = 0, mid = 0, dark = 0;
  for (let i = 0; i < im.length; i += 4 * 7) {
    const l = (0.2126 * im[i] + 0.7152 * im[i + 1] + 0.0722 * im[i + 2]) / 255;
    if (l > 0.90) hot++; else if (l > 0.06) mid++; else dark++;
  }
  const tot = hot + mid + dark;

  /* ── frame cost, orbit on against orbit off ────────────────────────────
   * Same scene, same camera, same everything: the only difference is the one
   * uniform the branch tests, so what comes out is the cost of the window and
   * nothing else. Sixteen frames a side because swiftshader's variance is
   * large and its first frame after a uniform change includes a flush. */
  const timeFrames = async (n) => {
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    return (performance.now() - t0) / n;
  };
  const onMs = await timeFrames(16);
  u0.uOrbit.value = 0;
  const offMs = await timeFrames(16);
  u0.uOrbit.value = 1;
  await timeFrames(2);

  const u = dome.mat.uniforms;
  const r = S.engine.renderer.info.render;
  return { onMs: +onMs.toFixed(1), offMs: +offMs.toFixed(1), scan, blown: +(hot / tot * 100).toFixed(2), lit: +(mid / tot * 100).toFixed(1),
    calls: r.calls, tris: r.triangles, orbit: u.uOrbit.value,
    key: +u.uOrbitKey.value.toFixed(3), planetDir: pd.toArray().map((v) => +v.toFixed(3)),
    cap: +u.uCapAmt.value.toFixed(3), seaAmt: u.uSeaAmt.value, seaGlow: u.uSeaGlow.value,
    land: u.uLandCol.value.getHexString(), sea: u.uSeaCol.value.getHexString(),
    atmo: u.uAtmoCol.value.getHexString(), t: +u.uOrbitT.value.toFixed(1) };
}, [WORLD, T, YAW, PITCH, FOV, SIZE, EXTRA, SETTLE, AIM]);

const file = join(OUT, `${NAME}.png`);
await page.screenshot({ path: file, timeout: 300000 });
console.log(JSON.stringify({ file, ...info, errors: errors.slice(0, 6) }));
await browser.close();
server.close();
