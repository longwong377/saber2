/**
 * Sky-lane frame probe. Boots a level, pins the camera to a deterministic pose
 * looking across the bowl at the rim, and shoots the same frame three ways —
 * full stack, grade off, and everything off — so a claim about the grade can be
 * proved by differencing rather than asserted.
 *
 * Also dumps the numbers the frame is built from: metered exposure, the fog
 * radiance every material converges to, the aerial-perspective uniforms, and
 * the cloud-deck uniforms.
 *
 *   node tools/skyshot.mjs --level arena --tag before
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const LEVEL = flag('level', 'arena');
const TAG = flag('tag', 'now');
// 0 = level across the bowl at the rim; 1 = tipped up into the cloud deck.
const PITCH = parseFloat(flag('pitch', '0'));
const OUT = join(ROOT, '.smoke', 'lane-sky');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// SwiftShader runs the whole stack at about a frame a second, and there are
// usually other headless browsers competing for the same cores. Every default
// 30 s timeout in playwright is far too tight for that.
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate((level) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
    volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6 }));
}, LEVEL);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 60000 });
// noWaitAfter: the deploy click kicks off level generation, which on
// SwiftShader can stall the main thread past playwright's default action
// timeout while it waits for "scheduled navigations" that never come.
await page.click('#btn-deploy', { timeout: 120000, noWaitAfter: true });
await page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
await page.waitForTimeout(2200);

// Pin the camera. Bowl centre, eye height, looking level at the rim — sand in
// the bottom third, rim across the middle, sky and cloud deck above it.
const info = await page.evaluate((pitch) => {
  const S = window.SABER, e = S.engine, w = S.world;
  const THREE = e.camera.position.constructor.prototype.constructor;
  const gy = w.terrain ? w.terrain.height(0, 0) : 0;
  const eye = { x: 0, y: gy + 1.75, z: 30 };
  // pitch 0 puts the rim across the middle; pitch 1 tips 30° up so the frame
  // is mostly deck, which is the only way to judge whether a cloud has form.
  const look = { x: 0, y: gy + 8 + pitch * 122, z: -180 };
  const orig = e.render.bind(e);
  e.render = (dt) => {
    const c = e.camera;
    c.position.set(eye.x, eye.y, eye.z);
    c.lookAt(look.x, look.y, look.z);
    c.updateMatrixWorld(true);
    orig(dt);
  };
  // hide the HUD so nothing overlays the regions being measured
  document.querySelector('#hud')?.classList.add('hidden');
  const L = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const fog = w.scene?.fog || e.scene.fog;
  const su = e.skyDome.mat.uniforms;
  return {
    exposure: e.renderer.toneMappingExposure,
    meter: e.meter && { key: e.meter.key, irradiance: e.meter.irradiance, direct: e.meter.direct,
      skyFull: e.meter.skyFull, envI: e.meter.envI },
    fog: fog && { rgb: [fog.color.r, fog.color.g, fog.color.b], lum: L(fog.color), density: fog.density },
    aerial: JSON.parse(JSON.stringify(e.aerial)),
    sky: {
      coverage: su.uCoverage.value, hdr: su.uHdr.value,
      cloudSun: su.uCloudSun?.value, cloudAmb: su.uCloudAmb?.value,
      shoulder: e.skyDisplay,
      skyKnee: e.sky.material.uniforms.uSkyKnee?.value,
      skyCeil: e.sky.material.uniforms.uSkyCeil?.value,
      lit: su.uCloudLit.value.toArray(), dark: su.uCloudDark.value.toArray(),
      amb: su.uSkyAmb.value.toArray(), haze: su.uHazeColor.value.toArray(),
      horizon: su.uHorizonColor.value.toArray(),
    },
    bloom: { strength: e.bloom.strength, radius: e.bloom.radius, threshold: e.bloom.threshold, enabled: e.bloom.enabled },
    grade: {
      saturation: e.composite.uniforms.uSaturation.value,
      lift: e.composite.uniforms.uLift.value.toArray(),
      gain: e.composite.uniforms.uGain.value.toArray(),
      vignette: e.composite.uniforms.uVignette.value,
      aberration: e.composite.uniforms.uAberration.value,
      grain: e.composite.uniforms.uGrain.value,
      sharpen: e.composite.uniforms.uSharpen.value,
      radial: e.composite.uniforms.uRadial.value,
      heatCount: e.composite.uniforms.uHeatCount.value,
    },
  };
}, PITCH);
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, `${TAG}-full.png`) });

// deck off, everything else shipped — the only way to tell whether a bright
// shape in the sky is cloud or dome
await page.evaluate(() => { window.SABER.engine.skyDome.mesh.visible = false; });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, `${TAG}-nocloud.png`) });
await page.evaluate(() => { window.SABER.engine.skyDome.mesh.visible = true; });

// grade off: OutputPass becomes the screen pass, composite is skipped
await page.evaluate(() => {
  const e = window.SABER.engine;
  e.composite.enabled = false; e.outputPass.renderToScreen = true;
});
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, `${TAG}-nograde.png`) });

// and with bloom off too — the only remaining thing between scene and screen
await page.evaluate(() => { window.SABER.engine.bloom.enabled = false; });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, `${TAG}-nopost.png`) });

// restore, so anything shot afterwards is the shipped stack
await page.evaluate(() => {
  const e = window.SABER.engine;
  e.bloom.enabled = true; e.composite.enabled = true; e.outputPass.renderToScreen = false;
});

info.errors = errors.slice(0, 8);
await writeFile(join(OUT, `${TAG}.json`), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
await browser.close();
server.close();
