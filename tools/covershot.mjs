/**
 * GROUND COVER, LOOKED AT.
 *
 * arena-lane's `frame` pins one pose — bowl centre, eye height, looking level
 * across the level — and it is the right pose for the question it was built
 * for (hue separation between sky, range and ground). It is the wrong pose for
 * this one: on the canyon it lands inside a hull wreck, and even where it does
 * not, a level horizon spends most of the frame on sky. Ground cover is judged
 * on the GROUND, at three ranges at once, so this takes three poses:
 *
 *   feet   eye 2.4 m, 34° down — is there a field at your boots, or spikes?
 *   walk   eye 1.75 m, 7° down — the handover from blades to cards to swathes
 *   vista  eye 7 m, 3° down    — does the cover reach, or stop in a circle?
 *
 * Everything else is arena-lane's boot, including FREEZING THE WEATHER, for
 * the same reason: the arena's calm-air unrest alone moves its fog 36% between
 * runs, so two shots of the same build are otherwise different atmospheres.
 * `grassScale` is left at 1 rather than the lane's 0.5, because the question
 * is what the player is given by default.
 *
 * It also prints the draw calls and triangles the level actually renders, so
 * the cost of a change is on the same page as the picture of it.
 *
 * `--diff` makes the plate a MEASUREMENT as well as a picture: see coverStats.
 *
 *   node tools/covershot.mjs --level canyon --tag after [--quality medium]
 *                            [--at x,z] [--yaw deg] [--diff] [--probe]
 */

import { readFile } from 'node:fs/promises';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

/** eye height, degrees below level, and how far ahead it is looking. */
const POSES = {
  feet: { y: 2.4, pitch: 34, reach: 9 },
  walk: { y: 1.75, pitch: 7, reach: 120 },
  vista: { y: 7.0, pitch: 3, reach: 400 },
};

const level = flag('level', 'canyon');
const tag = flag('tag', 'now');
const quality = flag('quality', 'medium');
const out = join(ROOT, '.smoke', 'cover');
mkdirSync(out, { recursive: true });

const { chromium } = await import('playwright-core');
const { createServer } = await import('node:http');
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
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(([lv, q]) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: lv, quality: q, resolutionScale: 0.7, difficulty: 'knight', mode: 'roguelite',
    volume: 0, music: 0, grassScale: 1, particleScale: 0.6 }));
}, [level, quality]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
await page.click('#btn-deploy', { timeout: 240000, noWaitAfter: true });
await page.waitForSelector('#hud:not(.hidden)', { timeout: 180000 });
await page.waitForTimeout(2500);

const frozen = await page.evaluate(async () => {
  const w = window.SABER.world;
  const W = w.atmosphere?.weather;
  if (W) { W.peak = 0; W.unrest = 0; W.update(0); }
  await new Promise((r) => requestAnimationFrame(r));
  return { intensity: W ? W.intensity : null, density: (w.scene.fog || {}).density };
});
console.log(`weather frozen: intensity ${frozen.intensity}, fog ${frozen.density?.toFixed(5)}`);

/* Where to stand. Left at the origin the canyon puts the camera in its own
 * river and the vista pose looks straight into a wall, so the level says. */
const at = (flag('at', '0,0')).split(',').map(Number);
const yaw = Number(flag('yaw', '180')) * Math.PI / 180;

const site = await page.evaluate(([ax, az, ya]) => {
  const S = window.SABER, e = S.engine, w = S.world;
  S.__pose = { y: 1.75, pitch: 7, reach: 100 };
  S.__at = { x: ax, z: az, yaw: ya };
  const orig = e.render.bind(e);
  e.render = (dt) => {
    const c = e.camera;
    const a = S.__at, p = S.__pose;
    const gy = w.terrain ? w.terrain.height(a.x, a.z) : 0;
    const rad = (p.pitch * Math.PI) / 180;
    c.position.set(a.x, gy + p.y, a.z);
    c.lookAt(a.x + Math.sin(a.yaw) * Math.cos(rad) * p.reach,
      gy + p.y - Math.sin(rad) * p.reach,
      a.z + Math.cos(a.yaw) * Math.cos(rad) * p.reach);
    c.updateMatrixWorld(true);
    orig(dt);
  };
  document.querySelector('#hud')?.classList.add('hidden');
  const t = w.terrain, g = w.grass;
  const u = t._uniforms;
  const probe = [];
  for (const d of [0, 10, 30, 80, 200]) {
    const x = ax + Math.sin(ya) * d, z = az + Math.cos(ya) * d;
    probe.push(`${d}m cover ${g ? g.cover.at(x, z).toFixed(2) : '-'} slope ${t.slopeAt(x, z).toFixed(2)} y ${t.height(x, z).toFixed(1)}`);
  }
  return {
    coverAmount: u.uCover.value.x, coverUv: u.uCover.value.y,
    coverMap: u.uCoverMap.value?.image?.width,
    litter: '#' + u.uCoverCol.value.getHexString(),
    waterLevel: u.uGround.value.x,
    probe,
  };
}, [at[0], at[1], yaw]);
console.log('site', JSON.stringify(site));

/* ── WHAT THE COVER IS ACTUALLY WORTH IN THE FRAME ──────────────────────
 *
 * A plate answers "does this look right" and nothing else, which is a poor
 * return on six minutes of software rasterising. `--diff` shoots each pose
 * TWICE — once as it renders and once with the BLADES AND CARDS hidden — and
 * the pixels that changed are, exactly and by construction, the cover. No
 * segmentation, no threshold on greenness, no guessing.
 *
 * The contact quads stay visible in both, deliberately: they are painted on the
 * GROUND, and hiding them would move the very baseline the cover is measured
 * against. What is being compared is a blade and the ground it stands in front
 * of, not two different grounds.
 *
 * That one trick answers the two questions this lane exists for:
 *
 *   HOW MUCH OF THE FRAME IS COVER? A field that measures 100% cover in the
 *   scatter and paints 1% of the frame is a field of spikes seen edge-on. Two
 *   thresholds, because they say different things: `frac` counts every pixel
 *   the cover touched at all, and `solid` counts only the ones it substantially
 *   OWNS. A field of sub-pixel needles scores on the first and not the second.
 *
 *   AND DOES IT GO BLACK IN SHADE? The bare plate gives the ground each grass
 *   pixel is standing in front of, so the blade and the ground beside it are
 *   the same measurement. Split by the ground's own value — its darker third
 *   is the shadowed ground — and "grass goes black in shadow and the sand next
 *   to it does not" stops being a description and becomes a ratio. Measured on
 *   the solid pixels, where the reading is a blade and not a blend.
 *
 * Both plates are written out, so the arithmetic can be redone from a pair
 * without paying for the render again.
 *
 * Screenshots are display-referred, after tonemap and grade, which is the right
 * space for this: the complaint is about the picture, not the radiance.
 */
async function coverStats(a, b) {
  const p = await browser.newPage({ viewport: { width: 64, height: 64 } });
  const r = await p.evaluate(async ({ A, B }) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, img.width, img.height).data;
    };
    const da = await load(A), db = await load(B);
    const L = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    // every pixel the cover touched, and the ones it substantially owns
    const touched = [], hit = [];
    for (let i = 0; i < da.length; i += 4) {
      const dl = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (dl > 6) touched.push(i);
      if (dl > 60) hit.push(i);                             // ≥ 8% of full range
    }
    if (!hit.length) return { frac: touched.length / (da.length / 4), solid: 0 };
    const ground = hit.map((i) => L(db, i)).sort((x, y) => x - y);
    const shadeCut = ground[(ground.length / 3) | 0];       // the darker third
    const sunCut = ground[((ground.length * 2) / 3) | 0];
    const band = (lo, hi) => {
      let gl = 0, bl = 0, n = 0, r = 0, g = 0, bb = 0;
      for (const i of hit) {
        const bv = L(db, i);
        if (bv < lo || bv >= hi) continue;
        gl += L(da, i); bl += bv; n++;
        r += da[i]; g += da[i + 1]; bb += da[i + 2];
      }
      return n ? { n, grass: gl / n, ground: bl / n, ratio: gl / bl,
        rgb: [r / n / 255, g / n / 255, bb / n / 255] } : null;
    };
    return {
      frac: touched.length / (da.length / 4),
      solid: hit.length / (da.length / 4),
      shade: band(-1, shadeCut), sun: band(sunCut, 2), all: band(-1, 2),
    };
  }, { A: a.toString('base64'), B: b.toString('base64') });
  await p.close();
  return r;
}

const shots = [];
const measured = [];
for (const [name, pose] of Object.entries(POSES)) {
  await page.evaluate((p) => { window.SABER.__pose = p; }, pose);
  await page.waitForTimeout(2200);
  const file = join(out, `${tag}-${level}-${name}.png`);
  const lit = await page.screenshot({ path: file });
  shots.push(file);
  if (argv.includes('--diff')) {
    // the blades and cards only; the contact quads belong to the ground
    await page.evaluate(() => {
      const g = window.SABER.world.grass;
      window.__hidden = g.rings.map((r) => r.mesh).filter((m) => m && m.visible);
      for (const m of window.__hidden) m.visible = false;
    });
    await page.waitForTimeout(2200);
    const bareFile = join(out, `${tag}-${level}-${name}-bare.png`);
    const bare = await page.screenshot({ path: bareFile });
    await page.evaluate(() => { for (const m of window.__hidden) m.visible = true; });
    const s = await coverStats(lit, bare);
    const pc = (v) => (v * 100).toFixed(1);
    measured.push(`${name}: cover touches ${pc(s.frac)}% of frame, owns ${pc(s.solid)}%`
      + (s.all ? `; grass/ground ${s.all.ratio.toFixed(2)}×`
        + ` (in shade ${s.shade.ratio.toFixed(2)}×, in sun ${s.sun.ratio.toFixed(2)}×)`
        + `; shaded blade L ${s.shade.grass.toFixed(3)} over ground ${s.shade.ground.toFixed(3)}`
        + `; mean rgb ${s.all.rgb.map((v) => v.toFixed(2)).join('/')}` : ''));
  }
}
if (measured.length) console.log('cover in frame:\n  ' + measured.join('\n  '));

/* THE DECISIVE TEST for the ground tone: force the litter colour to magenta
 * and the amount to 1, and shoot again. If the ground does not go magenta in
 * patches, the mask is not reaching the shader at all and no amount of tuning
 * the tint is going to show up. If it does, the plumbing is fine and the
 * question is only how strong the tone should be. */
if (argv.includes('--probe')) {
  await page.evaluate(() => {
    const u = window.SABER.world.terrain._uniforms;
    u.uCoverCol.value.setRGB(1, 0, 1);
    u.uCover.value.x = 1;
    window.SABER.__pose = { y: 6, pitch: 22, reach: 90 };
  });
  await page.waitForTimeout(2500);
  const f = join(out, `${tag}-${level}-probe.png`);
  await page.screenshot({ path: f });
  shots.push(f);
  await page.evaluate(() => {
    const u = window.SABER.world.terrain._uniforms;
    u.uCoverCol.value.setHex(0x404126);
  });
}

const perf = await page.evaluate(() => {
  const S = window.SABER, r = S.engine.renderer, g = S.world.grass;
  const samples = [];
  return (async () => {
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      await new Promise((res) => requestAnimationFrame(res));
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    return {
      drawCalls: r.info.render.calls, triangles: r.info.render.triangles,
      medianMs: +samples[6].toFixed(1), p90Ms: +samples[10].toFixed(1),
      grass: g ? {
        budget: g.count, reach: g.reach, cover: +g.cover.amount.toFixed(3),
        rings: g.rings.map((x) => `${x.tier.name} ${x.count}`),
        meshes: g.meshes.length,
      } : null,
    };
  })();
});
console.log(JSON.stringify({ level, quality, ...perf }));
if (errors.length) console.log('ERRORS', [...new Set(errors)].slice(0, 6));
console.log(shots.join('\n'));
await browser.close();
server.close();
