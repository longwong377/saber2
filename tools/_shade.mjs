/**
 * The tone lane's instrument — WHAT COLOUR IS SHADE, and HOW SOFT IS ITS EDGE.
 *
 * Both questions need a shadow you can find twice. A real level does not give
 * you one: tools/arena-lane.mjs's "sand shadowed" box measured hue 36.3° / lum
 * 0.533 against a "sand sunlit" box at hue 36.3° / lum 0.655 on the arena — the
 * same hue to a tenth of a degree, because the dressing moved and the box is
 * no longer in the colossus's shadow at all. A hand-placed box in a level that
 * other people are editing is not an instrument, it is a coincidence.
 *
 * So: build the shadow. One sand plane, one blocker of the SAME material, the
 * engine's own light rig and the level's own atmosphere, exposure, grade and
 * post stack. Four samples of one material in one frame — sunlit ground,
 * ground in cast shadow, a sunlit horizontal face, a vertical face turned away
 * from the sun — which is precisely the comparison the complaint is about, and
 * it is reproducible because the geometry is ours.
 *
 * Six cameras, because the claims want different framings and one of them
 * needs its own control:
 *
 *   chart   fov 60, oblique. The vertical faces, lit and shaded. Sample points
 *           are PROJECTED in the page and the pixel boxes come back with the
 *           shot, so a box cannot drift off the thing it is named after.
 *   micro   fov 20, straight down on the shadow's far edge in a fixed 6 m
 *           frame. The lit/shaded ground pair is read either side of the edge,
 *           symmetric about frame centre so the vignette cancels.
 *   macro   the same view with the frame scaled by 1/sin(elevation), because
 *           everything a low sun paints on the ground is stretched by that and
 *           a fixed frame saturates: the canyon's penumbra measured 0.36 m in
 *           the 6 m frame and 1.66 m in its own, and only the second is real.
 *   flat    macro with the cascades' penumbra slope forced to 0, which clamps
 *           the filter to one texel — the shipped edge, through the same
 *           camera and the same analysis. The control.
 *   storm   micro with half the key gone, exactly as Scenery dims it at the
 *           peak of a front.
 *   eye     fov 60 at 1.75 m, 8 m back from the edge: the terminator in
 *           DEGREES OF SCREEN, which is the number the complaint quoted.
 *
 *   node tools/_shade.mjs chart [--levels arena,dunes,canyon,hangar,dojo] [--tag before]
 *   node tools/_shade.mjs read  --tag before        # re-measure existing shots
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, normalize, basename } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, '.smoke', 'lane-tone');
const argv = process.argv.slice(2);
const CMD = argv[0] || 'chart';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const LEVELS = flag('levels', 'arena,dunes,canyon,hangar,dojo').split(',');
const TAG = flag('tag', 'now');
const W = parseInt(flag('w', '1200'), 10), H = parseInt(flag('h', '1200'), 10);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx <= 1e-9 ? 0 : d / mx, v: mx };
}
/** Signed difference between two hues, −180…180. */
const hueDelta = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return d; };

/* ── PNG (same decoder as the other lane tools; deliberately a copy, so a tool
 *    cannot be broken by an edit to a tool in someone else's lane) ────────── */
function decodePng(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 8, colour = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colour = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNGs');
  const bpp = colour === 6 ? 4 : colour === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const A = i >= bpp ? cur[i - bpp] : 0, B = prev ? prev[i] : 0, C = i >= bpp && prev ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += A; else if (ft === 2) v += B; else if (ft === 3) v += (A + B) >> 1;
      else if (ft === 4) { const pp = A + B - C, pa = Math.abs(pp - A), pb = Math.abs(pp - B), pc = Math.abs(pp - C); v += (pa <= pb && pa <= pc) ? A : (pb <= pc ? B : C); }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, bpp, data: out };
}

function patch(png, cx, cy, half = 11) {
  const { width, height, bpp, data } = png;
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = Math.max(0, cy - half); j <= Math.min(height - 1, cy + half); j++) {
    for (let i = Math.max(0, cx - half); i <= Math.min(width - 1, cx + half); i++) {
      const o = (j * width + i) * bpp;
      r += data[o] / 255; g += data[o + 1] / 255; b += data[o + 2] / 255; n++;
    }
  }
  if (!n) return null;
  r /= n; g /= n; b /= n;
  return { rgb: [r, g, b], lum: LUM(r, g, b), ...hsv(r, g, b) };
}

/**
 * A luminance profile down a column band, and the 10→90% width of the single
 * biggest monotone step in it. Averaged over `band` columns because the grain
 * is ±0.02 and a one-pixel profile is mostly grain.
 */
function terminator(png, x0, x1, y0, y1) {
  const { width, bpp, data } = png;
  const prof = [];
  for (let j = y0; j <= y1; j++) {
    let s = 0, n = 0;
    for (let i = x0; i <= x1; i++) {
      const o = (j * width + i) * bpp;
      s += LUM(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255); n++;
    }
    prof.push(s / n);
  }
  // The edge: the steepest run. Find the extremes of the profile's central
  // half, then walk out from the steepest single-row gradient until the
  // profile leaves the 10% / 90% levels.
  let lo = Infinity, hi = -Infinity;
  for (const v of prof) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = hi - lo;
  if (span < 0.02) return { width: NaN, span, prof };
  let best = 0, bi = 1;
  for (let i = 1; i < prof.length; i++) { const d = Math.abs(prof[i] - prof[i - 1]); if (d > best) { best = d; bi = i; } }
  const t10 = lo + span * 0.10, t90 = lo + span * 0.90;
  const rising = prof[Math.min(prof.length - 1, bi + 1)] > prof[Math.max(0, bi - 2)];
  let a = bi, b = bi;
  const inBand = (v) => v > t10 && v < t90;
  while (a > 0 && inBand(prof[a - 1])) a--;
  while (b < prof.length - 1 && inBand(prof[b + 1])) b++;
  // sub-pixel: interpolate where the profile crosses t10 and t90
  const cross = (i0, i1, t) => {
    const v0 = prof[i0], v1 = prof[i1];
    return Math.abs(v1 - v0) < 1e-6 ? i0 : i0 + (t - v0) / (v1 - v0);
  };
  const lowEnd = rising ? cross(Math.max(0, a - 1), a, t10) : cross(Math.max(0, a - 1), a, t90);
  const hiEnd = rising ? cross(b, Math.min(prof.length - 1, b + 1), t90) : cross(b, Math.min(prof.length - 1, b + 1), t10);
  return { width: Math.abs(hiEnd - lowEnd), span, lo, hi, prof, at: y0 + bi };
}

/* ══ the page ═════════════════════════════════════════════════════════════ */

const PAGE = (levels) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/","rapier":"/vendor/rapier/rapier.es.js"}}<\/script>
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}canvas{display:block}</style>
</head><body><canvas id="view"></canvas>
<script type="module">
import * as THREE from 'three';
import { Engine } from '/src/engine/Engine.js';
import { LEVELS } from '/src/game/Levels.js';

const engine = new Engine(document.getElementById('view'), 'high');
engine.setGrain(false);           // grain is ±0.02 and every number here is smaller than that

// ONE material, four ways of being lit. The ground swatch is the level's own.
const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
engine.scene.add(ground);
const BOX = { w: 14, h: 6, d: 6 };
const blocker = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d), mat);
blocker.castShadow = true; blocker.receiveShadow = true;
engine.scene.add(blocker);

const V = (x, y, z) => new THREE.Vector3(x, y, z);
window.__shot = async (key, cam) => {
  const L = LEVELS[key];
  engine.applyAtmosphere(L.atmosphere);
  mat.color.set(L.groundColor ?? 0xcfae82);
  const sun = engine.sunDir.clone().normalize();
  const el = Math.max(Math.asin(Math.max(sun.y, 0.02)), 0.02);
  // f: the direction the shadow runs. r: across it.
  const f = V(-sun.x, 0, -sun.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1); else f.normalize();
  const r = V(0, 1, 0).cross(f).normalize();
  blocker.position.set(0, BOX.h / 2, 0);
  blocker.quaternion.setFromUnitVectors(V(0, 0, 1), f);
  const shadowLen = BOX.h / Math.tan(el);          // from the box's far face
  const tip = f.clone().multiplyScalar(BOX.d / 2 + shadowLen);
  const c = engine.camera;
  const marks = [];
  let extent = 6;
  if (cam === 'chart') {
    // Far enough back that a 14 m blocker is an object in a frame rather than
    // a wall across it — the first version sat 11 m from it and measured its
    // own foreground.
    c.fov = 60; c.up.set(0, 1, 0);
    c.position.copy(f).multiplyScalar(BOX.d / 2 + shadowLen * 0.5 + 30).setY(14)
      .addScaledVector(r, 4);
    c.lookAt(f.x * (BOX.d / 2 + shadowLen * 0.35), 2, f.z * (BOX.d / 2 + shadowLen * 0.35));
    marks.push(['face sunlit  ', V(0, BOX.h, 0).addScaledVector(f, BOX.d * 0.25)],
      ['face shaded  ', f.clone().multiplyScalar(BOX.d / 2 + 0.02).setY(BOX.h * 0.55)],
      ['sand sunlit  ', r.clone().multiplyScalar(BOX.w / 2 + 6).addScaledVector(f, BOX.d / 2 + shadowLen * 0.5)],
      ['sand shadowed', f.clone().multiplyScalar(BOX.d / 2 + shadowLen * 0.5)]);
  } else if (cam === 'micro' || cam === 'storm' || cam === 'macro' || cam === 'flat') {
    // A FULL FRONT, exactly as Scenery drives one: half the key gone
    // (sunLoss 0.5 at peak intensity). Nothing else is touched, so any change
    // in the edge is the engine reading the key it has left.
    if (cam === 'storm') engine.sun.intensity = (LEVELS[key].atmosphere.sunIntensity ?? 3.6) * 0.5;
    // Straight down on the shadow's far edge. 6 m of ground across the frame,
    // so a 2 cm penumbra is four pixels and a 50 cm one is a hundred.
    //
    // camera up is f, NOT r: the frame's vertical axis has to run ALONG the shadow
    // so the terminator lies across the rows. With up = r the first version put
    // the edge down the middle of the image as a COLUMN and the row profile
    // measured the vignette — 0.72 m of "penumbra" on every level, which is the
    // giveaway that a number is measuring the frame instead of the subject.
    // 6 m of ground across the frame — except where the blocker itself would
    // be inside that, which it is on a 70 deg sun (the dojo's shadow is only
    // 2.2 m long). The first version measured the dojo's own silhouette and
    // reported 0.78 m of penumbra for it.
    // 6 m of ground for the fixed frame; for the wide one, 6 m MEASURED ACROSS
    // THE LIGHT, which is 6/sin(el) once it lands on the ground. Everything a
    // low sun paints is stretched by that factor and a fixed frame quietly
    // saturates: the canyon's 14 deg key puts 1.3 m of penumbra inside a 6 m
    // window with no plateau either side of it, and the 10-90 walk then reads
    // 0.36 m — a number produced entirely by the frame.
    extent = (cam === 'macro' || cam === 'flat')
      ? Math.min(shadowLen * 1.8, 6 / Math.max(Math.sin(el), 0.18))
      : Math.min(6, shadowLen * 1.8);
    c.fov = 20; c.up.copy(f);
    c.position.copy(tip).setY(extent / (2 * Math.tan(THREE.MathUtils.degToRad(10))));
    c.lookAt(tip.x, 0, tip.z);
  } else {
    // The gameplay view of the same edge: eye height, 8 m back, the game's fov.
    c.fov = 60; c.up.set(0, 1, 0);
    c.position.copy(tip).addScaledVector(f, 8).setY(1.75);
    c.lookAt(tip.x, 0.0, tip.z);
  }
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  engine.fitShadows(cam === 'chart' ? V(0, 0, 0) : tip);
  // THE CONTROL. Slope 0 clamps saberSoftShadow to one texel, which is exactly
  // the width three's PCF_SOFT path filtered at — so 'flat' is the shipped edge
  // measured through the same camera, the same frame and the same analysis as
  // the new one, which is the only way the two numbers mean anything together.
  if (cam === 'flat') for (const L of engine.cascades) L.shadow.radius = 0;
  engine.render(0.016);
  engine.render(0.016);
  const toPx = (p) => {
    const q = p.clone().project(c);
    return [Math.round((q.x * 0.5 + 0.5) * window.innerWidth), Math.round((-q.y * 0.5 + 0.5) * window.innerHeight)];
  };
  const px = marks.map(([n, p]) => [n, ...toPx(p)]);
  return {
    marks: px, tipPx: toPx(tip), elevation: THREE.MathUtils.radToDeg(el), shadowLen,
    metrePerPx: cam === 'chart' || cam === 'eye' ? null : extent / window.innerHeight,
    degPerPx: c.fov / window.innerHeight,
    exposure: engine.renderer.toneMappingExposure,
    penumbraUV: engine.cascades.map((L) => L.shadow.radius),
    boxes: engine.cascades.map((L) => (L.shadow.camera.right - L.shadow.camera.left) / 2),
    depth: engine.cascades.map((L) => L.shadow.camera.far - L.shadow.camera.near),
    map: engine.cascades[0].shadow.mapSize.x,
    boxH: 6,
  };
};
window.__ready = true;
<\/script></body></html>`;

async function run() {
  const { chromium } = await import('playwright-core');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE(LEVELS)); return;
      }
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
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
  mkdirSync(OUT, { recursive: true });
  const meta = {};
  for (const key of LEVELS) {
    for (const cam of ['chart', 'micro', 'eye', 'storm', 'macro', 'flat']) {
      const info = await page.evaluate(([k, c]) => window.__shot(k, c), [key, cam]);
      const file = join(OUT, `${TAG}-${key}-${cam}.png`);
      await page.screenshot({ path: file });
      meta[`${key}-${cam}`] = info;
      process.stdout.write(`  shot ${key}/${cam}\n`);
    }
  }
  await browser.close(); server.close();
  if (errors.length) console.log('ERRORS', errors.slice(0, 8));
  return meta;
}

/* ══ reporting ════════════════════════════════════════════════════════════ */

function report(meta) {
  const fmt = (v, n = 3, w = 6) => (Number.isFinite(v) ? v.toFixed(n) : '  —  ').padStart(w);
  const maxch = (rgb) => (rgb[0] >= rgb[1] && rgb[0] >= rgb[2] ? 'R' : rgb[1] >= rgb[2] ? 'G' : 'B');

  /* ── ground: taken off the MICRO shot, which is nothing but ground, half of
   *    it in the blocker's shadow and half in the sun, at the same range and
   *    the same radius from frame centre so the vignette cancels. No box can
   *    slide off the thing it is named after because there is nothing else in
   *    the picture. ─────────────────────────────────────────────────────── */
  console.log(`\n════ SAND, LIT AND SHADED  (${TAG}) ════`);
  console.log('  level     sample          R     G     B     lum    hue    sat  max   Δhue   Δ(B/R)  tonal');
  for (const key of LEVELS) {
    const mi = meta[`${key}-micro`];
    if (!mi) continue;
    const png = decodePng(join(OUT, `${TAG}-${key}-micro.png`));
    // Symmetric about frame centre ALONG THE SHADOW (rows), so the two
    // patches sit at the same radius and take the same vignette.
    const cx = Math.round(png.width * 0.5), dy = Math.round(png.height * 0.32);
    const A = patch(png, cx, Math.round(png.height * 0.5) - dy, 60);
    const B = patch(png, cx, Math.round(png.height * 0.5) + dy, 60);
    if (!A || !B) continue;
    const shd = A.lum <= B.lum ? A : B, lit = A.lum <= B.lum ? B : A;
    const row = (n, s) => `  ${key.padEnd(8)} ${n} ${s.rgb.map((v) => fmt(v, 3, 5)).join(' ')} ${fmt(s.lum)} ${fmt(s.h, 1)} ${fmt(s.s)}   ${maxch(s.rgb)}`;
    console.log(row('sand sunlit ', lit));
    console.log(row('sand shaded ', shd)
      + `  ${fmt(Math.abs(hueDelta(lit.h, shd.h)), 1, 6)}  ${fmt(shd.rgb[2] / shd.rgb[0] - lit.rgb[2] / lit.rgb[0], 3, 6)}  ${fmt(lit.lum / Math.max(1e-4, shd.lum), 2, 5)}:1`);

  }

  /* ── the vertical faces, off the oblique chart ─────────────────────────── */
  console.log(`\n════ ONE MATERIAL, FOUR ORIENTATIONS  (${TAG}) ════`);
  console.log('  level     sample          R     G     B     lum    hue    sat  max');
  for (const key of LEVELS) {
    const info = meta[`${key}-chart`];
    if (!info) continue;
    const png = decodePng(join(OUT, `${TAG}-${key}-chart.png`));
    for (const [name, x, y] of info.marks) {
      const s = patch(png, x, y, 9);
      if (!s) { console.log(`  ${key.padEnd(8)} ${name} — off frame`); continue; }
      console.log(`  ${key.padEnd(8)} ${name} ${s.rgb.map((v) => fmt(v, 3, 5)).join(' ')} ${fmt(s.lum)} ${fmt(s.h, 1)} ${fmt(s.s)}   ${maxch(s.rgb)}`);
    }
  }

  /* ── the edge ──────────────────────────────────────────────────────────── */
  console.log(`\n════ TERMINATOR  (${TAG}) ════`);
  console.log('  level    sun el  penumbra on ground   implied source ø   on-screen (fov 60, 1.75 m eye)');
  for (const key of LEVELS) {
    const mi = meta[`${key}-micro`], ei = meta[`${key}-eye`];
    if (!mi) continue;
    let line = `  ${key.padEnd(8)} ${fmt(mi.elevation, 1, 5)}° `;
    const mp = decodePng(join(OUT, `${TAG}-${key}-micro.png`));
    // Scan only around the geometric tip: the vignette across a whole frame is
    // a 0.04 ramp and will happily present itself as a metre of penumbra.
    const w0 = Math.max(0, mi.tipPx[1] - Math.round(mp.height * 0.30));
    const w1 = Math.min(mp.height - 1, mi.tipPx[1] + Math.round(mp.height * 0.30));
    const t = terminator(mp, Math.floor(mp.width * 0.35), Math.floor(mp.width * 0.65), w0, w1);
    const metres = t.width * mi.metrePerPx;
    // Invert the geometry: an edge cast by a top edge `boxH` above the ground
    // lands boxH/sin(el) from its blocker ALONG THE RAY, and the penumbra it
    // paints on the ground is stretched by another 1/sin(el).
    const s = Math.sin(mi.elevation * Math.PI / 180);
    const srcDeg = Math.atan(metres * s * s / mi.boxH) * 180 / Math.PI;
    line += `${fmt(metres, 3, 7)} m       ${fmt(srcDeg, 3, 6)}°      `;
    if (ei) {
      const ep = decodePng(join(OUT, `${TAG}-${key}-eye.png`));
      const e0 = Math.max(0, ei.tipPx[1] - 90), e1 = Math.min(ep.height - 1, ei.tipPx[1] + 90);
      const te = terminator(ep, Math.floor(ep.width * 0.35), Math.floor(ep.width * 0.65), e0, e1);
      line += `${fmt(te.width * ei.degPerPx, 3, 6)}°  (${te.width.toFixed(1)} px, step ${fmt(te.span, 3, 5)})`;
    }
    for (const [tagName, label] of [['flat', 'shipped-edge'], ['macro', 'new-edge']]) {
      const w = meta[`${key}-${tagName}`];
      if (!w) continue;
      const wp = decodePng(join(OUT, `${TAG}-${key}-${tagName}.png`));
      const a0 = Math.max(0, w.tipPx[1] - Math.round(wp.height * 0.30));
      const a1 = Math.min(wp.height - 1, w.tipPx[1] + Math.round(wp.height * 0.30));
      const tw = terminator(wp, Math.floor(wp.width * 0.35), Math.floor(wp.width * 0.65), a0, a1);
      const m2 = tw.width * w.metrePerPx;
      line += `\n            ${label.padEnd(12)} ${fmt(m2, 3, 7)} m = ${fmt(Math.atan(m2 * s * s / w.boxH) * 180 / Math.PI, 3, 6)}° source  (frame ${(w.metrePerPx * wp.height).toFixed(1)} m)`;
    }
    const st = meta[`${key}-storm`];
    if (st) {
      const sp = decodePng(join(OUT, `${TAG}-${key}-storm.png`));
      const s0 = Math.max(0, st.tipPx[1] - Math.round(sp.height * 0.30));
      const s1 = Math.min(sp.height - 1, st.tipPx[1] + Math.round(sp.height * 0.30));
      const ts = terminator(sp, Math.floor(sp.width * 0.35), Math.floor(sp.width * 0.65), s0, s1);
      const sm = ts.width * st.metrePerPx;
      line += `\n            ${'storm-edge'.padEnd(12)} ${fmt(sm, 3, 7)} m = ${fmt(Math.atan(sm * s * s / st.boxH) * 180 / Math.PI, 3, 6)}° source  (fixed 6 m frame)`;
    }
    console.log(line);
  }
  const m0 = meta[`${LEVELS[0]}-micro`];
  console.log(`\n  shadow.radius per cascade: ${JSON.stringify(m0?.penumbraUV)}   boxes ${JSON.stringify(m0?.boxes)}   map ${m0?.map}`);
}

if (CMD === 'read') {
  const meta = JSON.parse(readFileSync(join(OUT, `${TAG}-meta.json`), 'utf8'));
  report(meta);
} else {
  const meta = await run();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(OUT, `${TAG}-meta.json`), JSON.stringify(meta, null, 1));
  report(meta);
}
