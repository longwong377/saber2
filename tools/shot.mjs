/**
 * BATTLEFRONT BORZ — look at the game.
 *
 * `smoke.mjs` proves the page does not throw. This one exists to answer the
 * other kind of question, which no assertion in tools/checks can: does it look
 * right? Several of the bugs on the current list — the cone under the robe, the
 * hilt buried in the palm, the bloom washing out snow, props hovering — are
 * things you can only find by putting the camera somewhere and looking.
 *
 * So: boot the real game, run a snippet of your own inside the page to pose it
 * however you like, and write a PNG.
 *
 *   node tools/shot.mjs --level meadow --out fp \
 *     --pose "p.camera.firstPerson = true; p.saber.ignite()"
 *
 * Everything the snippet needs is in scope: `S` (window.SABER), `w` (the world),
 * `p` (the player), `THREE`. It may be async. `--settle N` runs N frames after
 * the pose before the shutter, because a pose that has not been through the
 * animator yet is not the pose the player sees.
 *
 * NB: SwiftShader renders this at about one frame a second, so `--settle` is
 * counted in FRAMES and 30 is already half a minute.
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

const LEVEL = flag('level', 'colosseum');
const MODE = flag('mode', 'sandbox');
const QUALITY = flag('quality', 'medium');
const POSE = flag('pose', '');
const SETTLE = parseInt(flag('settle', '20'), 10);
const NAME = flag('out', 'shot');
const WIDTH = parseInt(flag('width', '1280'), 10);
const HEIGHT = parseInt(flag('height', '720'), 10);
const SCALE = parseFloat(flag('scale', '0.7'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const url = `http://127.0.0.1:${port}/`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(([level, quality, mode, scale, saberSet]) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level, quality, mode, resolutionScale: scale, difficulty: 'knight',
    volume: 0, music: 0, sandboxCount: 0, sandboxFire: 0,
    /* `--set` so the two new weapons can be LOOKED at. They are a setting like
     * any other and this is the only door a shot has into the settings blob. */
    saberSet,
  }));
}, [LEVEL, QUALITY, MODE, SCALE, flag('set', 'single')]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
await page.click('#btn-deploy');
/* SIXTY SECONDS IS ABOUT FOURTEEN FRAMES (HANDOFF §2.6 measures one at up to
 * 4151 ms through swiftshader) and a deploy costs more than that on a level
 * that dresses seven thousand instances: the colosseum timed out here twice
 * with nothing wrong but the clock. `_level.mjs` says the same about the five
 * tools that wait on a wall clock. Raised rather than re-plumbed onto
 * `waitFramesFor`, because this tool's whole contract is one screenshot. */
await page.waitForSelector('#hud:not(.hidden)', { timeout: 300000 });

const applied = await page.evaluate(async ([pose, settle]) => {
  const S = window.SABER, w = S.world, p = w.player;
  // the REAL module, from vendor/ — the same copy the game is running. `p.position
  // .constructor` is Vector3 alone, which is not enough for a pose that wants a Box3.
  const THREE = await import('/vendor/three/three.module.js');
  S.input.locked = true; S.input.enabled = true;
  let err = null;
  if (pose) {
    try {
      // eslint-disable-next-line no-new-func
      await new Function('S', 'w', 'p', 'THREE', `return (async () => { ${pose} })()`)(S, w, p, THREE);
    } catch (e) { err = String(e && e.stack || e); }
  }
  for (let i = 0; i < settle; i++) await new Promise((r) => requestAnimationFrame(r));
  return { err, out: window.__shotOut ?? null,
           firstPerson: !!p.camera?.firstPerson, lit: !!p.saber?.lit,
           pos: p.position.toArray().map((v) => +v.toFixed(2)) };
}, [POSE, SETTLE]);

const file = join(OUT, `${NAME}.png`);
await page.screenshot({ path: file, timeout: 180000 });
console.log(JSON.stringify({ file, ...applied, errors: errors.slice(0, 4) }, null, 2));

await browser.close();
server.close();
