/**
 * "The middle of the screen is always blurry, almost like there was water
 * condensation."
 *
 * That is a claim about the POST STACK, and it is answerable with numbers
 * rather than opinion. Two measurements, both here:
 *
 *   1. A SHARPNESS MAP. Mean |Laplacian| of luminance over a 4x4 grid of
 *      tiles, on the same frame shot with the full stack and with nothing but
 *      the tonemap. A post effect that softens the middle shows up as the
 *      centre tiles losing acutance relative to the corners — the ratio
 *      centre/edge dropping between the two shots. If it holds, the middle is
 *      not being blurred by post, whatever else it is doing.
 *
 *   2. WHAT THE COMPOSITE IS ACTUALLY DOING THERE, sampled every frame for
 *      several seconds while the player stands still: the heat-haze source
 *      count and strength, the radial-blur amount, and the aberration. The
 *      heat haze is the one effect that lives at screen centre by construction
 *      — it is pinned to the blade, and a third-person blade is dead centre —
 *      and it is a refractive noise warp, which is what condensation on a lens
 *      looks like.
 *
 *   node tools/postprobe.mjs [--level arena]
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
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate((level) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
    volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6 }));
}, LEVEL);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 60000 });
await page.click('#btn-deploy', { timeout: 120000, noWaitAfter: true });
await page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
await page.waitForTimeout(2200);

// Record what the composite is being handed, every frame, while nobody
// touches the controls.
await page.evaluate(() => {
  const S = window.SABER, e = S.engine;
  window.__POST = [];
  const orig = e.render.bind(e);
  e.render = (dt) => {
    const u = e.composite.uniforms;
    const h = u.uHeat.value;
    let worst = 0;
    for (let i = 0; i < u.uHeatCount.value; i++) {
      // distance of this source from screen centre, and its strength
      const d = Math.hypot(h[i].x - 0.5, h[i].y - 0.5);
      if (h[i].w > worst) worst = h[i].w;
      window.__POSTLAST = { d, w: h[i].w, r: h[i].z };
    }
    window.__POST.push([u.uHeatCount.value, worst, u.uRadial.value, u.uSense.value]);
    if (window.__POST.length > 400) window.__POST.shift();
    orig(dt);
  };
  document.querySelector('#hud')?.classList.add('hidden');
});
await page.waitForTimeout(14000);
const idle = await page.evaluate(() => {
  const p = window.__POST;
  const n = p.length || 1;
  return {
    frames: p.length,
    framesWithHeat: p.filter((r) => r[0] > 0).length,
    maxHeatStrength: Math.max(0, ...p.map((r) => r[1])),
    maxRadial: Math.max(0, ...p.map((r) => r[2])),
    maxSense: Math.max(0, ...p.map((r) => r[3])),
    lastSource: window.__POSTLAST || null,
    swing: window.SABER.world?.player?.saber?.tipSpeed ?? null,
  };
});

// Same again while the blade is actually being swung, so the gate can be seen
// to open as well as to stay shut.
await page.evaluate(() => {
  const S = window.SABER;
  window.__POST.length = 0;
  S.input.locked = true; S.input.enabled = true;
  // COUNT frames, not seconds: SwiftShader runs at about 1 fps, so a
  // five-second wall-clock loop is five minutes of real time.
  let t = 0;
  const tick = () => {
    t += 1;
    S.input.buttons[0] = true;
    S.input.mouse.dx += Math.sin(t * 0.9) * 40;
    S.input.mouse.dy += Math.cos(t * 0.6) * 24;
    if (t < 24) requestAnimationFrame(tick);
    else { S.input.buttons[0] = false; window.__SWUNG = true; }
  };
  tick();
});
await page.waitForFunction(() => window.__SWUNG === true, null, { timeout: 240000 });
const swinging = await page.evaluate(() => {
  const p = window.__POST;
  return {
    frames: p.length,
    framesWithHeat: p.filter((r) => r[0] > 0).length,
    maxHeatStrength: Math.max(0, ...p.map((r) => r[1])),
    lastSource: window.__POSTLAST || null,
  };
});

// Freeze a deterministic pose with plenty of high-frequency detail dead centre
// and shoot it twice.
await page.evaluate(() => {
  const S = window.SABER, e = S.engine, w = S.world;
  S.input.locked = false;
  const gy = w.terrain ? w.terrain.height(0, 0) : 0;
  const orig = e.render;
  e.render = (dt) => {
    const c = e.camera;
    c.position.set(0, gy + 1.75, 30);
    c.lookAt(0, gy + 2.2, -180);
    c.updateMatrixWorld(true);
    orig(dt);
  };
});
await page.waitForTimeout(3000);
await page.screenshot({ path: join(OUT, 'post-full.png') });
await page.evaluate(() => {
  const e = window.SABER.engine;
  e.composite.enabled = false; e.outputPass.renderToScreen = true;
});
await page.waitForTimeout(3000);
await page.screenshot({ path: join(OUT, 'post-nograde.png') });
await page.evaluate(() => { window.SABER.engine.bloom.enabled = false; });
await page.waitForTimeout(3000);
await page.screenshot({ path: join(OUT, 'post-nopost.png') });

// ── sharpness map, decoded in the same browser
const sharp = async (name) => {
  const b64 = (await readFile(join(OUT, name))).toString('base64');
  return page.evaluate(async (b) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const L = new Float32Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      L[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    // 4x4 tiles of mean |Laplacian| — acutance, i.e. how much fine detail
    // survives in that part of the frame
    const tiles = [];
    for (let ty = 0; ty < 4; ty++) {
      const row = [];
      for (let tx = 0; tx < 4; tx++) {
        const x0 = Math.floor(tx * W / 4) + 2, x1 = Math.floor((tx + 1) * W / 4) - 2;
        const y0 = Math.floor(ty * H / 4) + 2, y1 = Math.floor((ty + 1) * H / 4) - 2;
        let s = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          s += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W]);
          n++;
        }
        row.push(+(s / n).toFixed(5));
      }
      tiles.push(row);
    }
    const centre = (tiles[1][1] + tiles[1][2] + tiles[2][1] + tiles[2][2]) / 4;
    const corners = (tiles[0][0] + tiles[0][3] + tiles[3][0] + tiles[3][3]) / 4;
    return { tiles, centre: +centre.toFixed(5), corners: +corners.toFixed(5),
      ratio: +(centre / Math.max(corners, 1e-6)).toFixed(3) };
  }, b64);
};

const out = {
  idle, swinging,
  acutance: {
    full: await sharp('post-full.png'),
    nograde: await sharp('post-nograde.png'),
    nopost: await sharp('post-nopost.png'),
  },
  errors: errors.slice(0, 6),
};
await writeFile(join(OUT, 'post.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
