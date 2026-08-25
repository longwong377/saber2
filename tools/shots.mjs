/**
 * BATTLEFRONT BORZ — REAL SCREENSHOTS FOR THE THEATRE CARDS.
 *
 * The player, more than once: "since I've asked you 10000000 times and it still
 * looks like shit I want you to scrap the current preview images for the
 * theater maps and instead use a real attractive cinematic unique screenshot
 * emblematic of the map from the actual map and use that as the placeholder
 * preview images instead of the bare garbage you have now".
 *
 * `Menu._levelArt` drew each card as a hand-made canvas illustration — a few
 * flat bands and a silhouette per level. Every one of them was somebody's idea
 * of what the level looks like rather than what it looks like.
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────
 *
 * The real page, the real deploy, the real engine. For each level this boots
 * the game, deploys into it, then moves `engine.camera` to a candidate pose,
 * calls `engine.render` — the SHIPPED path, so the shot carries the cel bands,
 * the ink outline, the bloom and the level's own sky — and reads the canvas
 * back in the same synchronous block, before the game's next frame overwrites
 * it.
 *
 * ── AND IT PICKS THE SHOT RATHER THAN BEING TOLD ─────────────────────────
 *
 * Authoring seven camera poses blind is how the hand-drawn art got here. So a
 * ring of candidates is rendered per level and each is SCORED, in page, on the
 * two things that separate a photograph of a place from a photograph of the
 * sky above it: how much of the frame is not flat, and how much of it is not
 * the same colour as the top row. The best-scoring pose wins and the score is
 * printed, so a level that can only produce a bad shot says so in the log
 * rather than shipping one quietly.
 *
 *   node tools/shots.mjs [--only geonosis] [--keep]
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'assets', 'previews');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ONLY = flag('only', null);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const url = `http://127.0.0.1:${port}/`;

const { LEVEL_ORDER } = await import('../src/game/Levels.js').catch(() => ({ LEVEL_ORDER: null }))
  .then((m) => m.LEVEL_ORDER ? m : { LEVEL_ORDER: ['scoria','mustafar','colosseum','wood','drifts','alpine','geonosis'] });
const levels = ONLY ? [ONLY] : LEVEL_ORDER;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader',
    '--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--enable-webgl2-compute-context'],
});
/* 1280x448 is the card's own 2.86:1 at a size that survives a wide card. See
 * `Menu._levelArt`'s note on why the aspect is what it is. */
const page = await browser.newPage({ viewport: { width: 1280, height: 448 } });
page.on('pageerror', (e) => console.log('  page error:', e.message.slice(0, 120)));

for (const key of levels) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.evaluate((level) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level, mode: 'waves', quality: 'high', resolutionScale: 1, difficulty: 'knight',
      instantSpawn: true, volume: 0, music: 0,
    }));
  }, key);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
  await page.click('#btn-deploy');
  await page.waitForTimeout(1200);
  const drop = await page.$('#btn-deploy-drop');
  if (drop) await drop.click().catch(() => {});
  // let the level dress itself: grass, props, the sky and the first bodies
  await page.waitForTimeout(9000);

  const best = await page.evaluate(async () => {
    const S = window.SABER, w = S?.world, e = S?.engine;
    if (!w || !e?.camera || !e.renderer) return { err: 'no engine' };
    const cam = e.camera, gl = e.renderer.domElement;
    const savedPos = cam.position.clone(), savedQ = cam.quaternion.clone();
    const savedFov = cam.fov;
    const t = w.terrain;
    const p = w.player?.position || { x: 0, y: 0, z: 0 };
    const groundAt = (x, z) => (t?.height ? t.height(x, z) : 0);

    /* A 2D scratch to score on. 160x56 is enough to tell a landscape from a
     * wall of sky and cheap enough to run forty times. */
    const sc = document.createElement('canvas'); sc.width = 160; sc.height = 56;
    const s2 = sc.getContext('2d', { willReadFrequently: true });
    const score = () => {
      s2.drawImage(gl, 0, 0, sc.width, sc.height);
      const d = s2.getImageData(0, 0, sc.width, sc.height).data;
      // the top row is "sky" by definition; anything unlike it is content
      let sr = 0, sg = 0, sb = 0;
      for (let x = 0; x < sc.width; x++) { const i = x * 4; sr += d[i]; sg += d[i+1]; sb += d[i+2]; }
      sr /= sc.width; sg /= sc.width; sb /= sc.width;
      let content = 0, n = 0, mean = 0;
      const lum = new Float32Array(sc.width * sc.height);
      for (let i = 0, k = 0; i < d.length; i += 4, k++) {
        const r = d[i], g = d[i+1], b = d[i+2];
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lum[k] = L; mean += L; n++;
        if (Math.abs(r - sr) + Math.abs(g - sg) + Math.abs(b - sb) > 46) content++;
      }
      mean /= n;
      let varsum = 0;
      for (let k = 0; k < lum.length; k++) { const dv = lum[k] - mean; varsum += dv * dv; }
      const contrast = Math.sqrt(varsum / lum.length);
      /* Local detail: how much neighbouring pixels differ. A flat orange dune
       * scores badly here and a colonnade scores well, which is the whole
       * difference between the two shots this is choosing between. */
      let edge = 0;
      for (let y = 1; y < sc.height; y++) {
        for (let x = 1; x < sc.width; x++) {
          const k = y * sc.width + x;
          edge += Math.abs(lum[k] - lum[k - 1]) + Math.abs(lum[k] - lum[k - sc.width]);
        }
      }
      edge /= lum.length;
      const fill = content / n;
      // a frame that is ALL content is usually a camera inside a rock
      const framing = fill > 0.97 ? 0.35 : fill;
      return { total: framing * 60 + contrast * 0.9 + edge * 2.4, fill: +fill.toFixed(3),
        contrast: +contrast.toFixed(1), edge: +edge.toFixed(2) };
    };

    const shots = [];
    /* A ring around where the player stands, at three heights and two pitches.
     * The player's own spawn is the one place every level guarantees is worth
     * looking at — it is where the level puts you. */
    for (let b = 0; b < 8; b++) {
      const bearing = (b / 8) * Math.PI * 2;
      for (const [dist, up, pitch] of [[34, 11, 0.10], [62, 20, 0.16], [22, 5, 0.02]]) {
        const cx = p.x + Math.cos(bearing) * dist;
        const cz = p.z + Math.sin(bearing) * dist;
        const cy = groundAt(cx, cz) + up;
        cam.position.set(cx, cy, cz);
        cam.fov = 52; cam.updateProjectionMatrix();
        const tx = p.x, tz = p.z;
        const ty = groundAt(tx, tz) + 2 + (dist * pitch);
        cam.lookAt(tx, ty, tz);
        cam.updateMatrixWorld(true);
        e.render(1 / 60);
        const sc2 = score();
        shots.push({ bearing: +bearing.toFixed(2), dist, up, ...sc2 });
      }
    }
    shots.sort((a, b2) => b2.total - a.total);
    const win = shots[0];
    // re-render the winner and take it
    const cx = p.x + Math.cos(win.bearing) * win.dist;
    const cz = p.z + Math.sin(win.bearing) * win.dist;
    cam.position.set(cx, groundAt(cx, cz) + win.up, cz);
    cam.fov = 52; cam.updateProjectionMatrix();
    cam.lookAt(p.x, groundAt(p.x, p.z) + 2 + win.dist * 0.13, p.z);
    cam.updateMatrixWorld(true);
    e.render(1 / 60);
    const data = gl.toDataURL('image/jpeg', 0.86);
    cam.position.copy(savedPos); cam.quaternion.copy(savedQ);
    cam.fov = savedFov; cam.updateProjectionMatrix();
    return { data, win, tried: shots.length, worst: shots[shots.length - 1].total.toFixed(1) };
  });

  if (best.err) { console.log(`${key.padEnd(10)} FAILED — ${best.err}`); continue; }
  const b64 = best.data.split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  await writeFile(join(OUT, `${key}.jpg`), buf);
  console.log(`${key.padEnd(10)} ${(buf.length / 1024).toFixed(0)} kB  score ${best.win.total.toFixed(1)}`
    + ` (worst of ${best.tried}: ${best.worst})  fill ${best.win.fill} contrast ${best.win.contrast}`
    + ` edge ${best.win.edge}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close(); server.close();
