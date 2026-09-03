/**
 * WHAT THE DECK'S MIRROR LOOKS LIKE, AND WHAT IT COSTS.
 *
 *   node tools/_mirrorprobe.mjs [/tmp/mirror] [--quality medium] [--frames 12]
 *
 * `tools/checks/deckmirror.mjs` drives the reflection hook with a fake
 * renderer and can say the camera is mirrored, the near plane is the deck and
 * the target is half the frame. It cannot say whether the rim, the strips and
 * the ships appear in the plate, and it cannot say what a second rasterisation
 * of the room costs. Both questions need a browser, so this boots the shipped
 * page in Chromium (`tools/_deckshot.mjs`'s pattern, in full), walks onto the
 * deck through the real door, stands at (0, 1.7, -60) looking forward and a
 * quarter radian down, and:
 *
 *   · reads the frame with the mirror ON, then OFF, then ON again — an A/B/A
 *     bracket, because on a software rasteriser a single window drifts by
 *     more than the effect being measured (see tools/_frame.mjs's error bar);
 *   · counts draw calls, triangles, compiled programs and textures on each,
 *     off the shipped `Profiler` and `renderer.info`, so a mirror that
 *     recompiled materials or leaked a target would show up as a number;
 *   · writes `mirror-on.png` and `mirror-off.png` for a person to look at.
 *
 * THERE IS NO GPU IN THIS CONTAINER. The renderer is ANGLE on SwiftShader and
 * a frame is seconds; the millisecond column is a CPU rasteriser's and is not
 * a prediction of anyone's graphics card. The DRAW CALL delta is exact.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !['low', 'medium', 'high', 'ultra'].includes(a)) || '/tmp/mirror';
const QUALITY = flag('--quality', 'medium');
const FRAMES = Number(flag('--frames', 12));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('mirrorprobe');
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
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
say('loaded');
await page.evaluate((quality) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality, instantSpawn: true, allies: 0,
  }));
  const men = Array.from({ length: 12 }, (_, i) => ({
    designation: 'CT-' + (1000 + i), name: 'CT-' + (1000 + i), type: 'trooper',
    army: 'republic', xp: i * 40, kills: i * 2, areas: 2, wounds: i % 3,
    look: { mark: null, band: null, kit: {}, paint: {} }, squad: null, alive: true,
  }));
  localStorage.setItem('saber.company.v1', JSON.stringify({
    v: 1, republic: { army: 'republic', men, fallen: [], runs: 1 },
  }));
}, QUALITY);
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
  return { level: w.levelKey, mirror: !!w._deckMirror, tier: w._deckMirror?.tier, scale: w._deckMirror?.scale };
});
say(`deck ${JSON.stringify(info)}`);
console.log('deck:', JSON.stringify(info));
if (info.fail) { await browser.close(); server.close(); process.exit(1); }

/* Resume the run (headless Chromium cannot take the pointer, and a paused
 * world neither steps nor recomposes its camera) and stand where the brief
 * says: (0, 1.7, -60), yaw pi (forward on this deck), pitch -0.25. */
await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  S?.screens?.set?.('playing');
  S?.resume?.();
  if (S?.input) S.input.enabled = true;
  const p = S.world.player;
  const V3 = p.position.constructor;
  const put = () => {
    p.position.set(0, 1.7, -60);
    p.velocity?.set?.(0, 0, 0);
    p.body?.setTransform?.(new V3(0, 1.7 + 0.9, -60), null);
    if (p.camera) { p.camera.yaw = Math.PI; p.camera.pitch = -0.25; }
    if (p.control) { p.control.yaw = Math.PI; p.control.pitch = -0.25; }
  };
  for (let i = 0; i < 30; i++) { put(); await raf(); }
});

await page.evaluate(() => {
  window.__frame = (ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no animation frame in ${ms} ms`)), ms);
    requestAnimationFrame(() => { clearTimeout(t); res(); });
  });
  window.__measure = async ({ frames, on }) => {
    const S = window.SABER;
    const p = S.engine.profiler;
    const r = S.engine.renderer;
    const M = S.world._deckMirror;
    M.enabled = on;
    /* Two frames for the switch to take (the step hides or shows the mesh
     * and the next render reads it). */
    for (let i = 0; i < 3; i++) await window.__frame(60000);
    p.n = 0; p.i = 0; p.last = 0; p.worst = 0; p.worstAt = 0;
    p.frames.fill(0); p.cpus.fill(0); p.gpus.fill(0);
    const programs0 = r.info.programs.length;
    const renders0 = M.renders;
    let calls = 0, tris = 0, k = 0, cMin = Infinity, cMax = 0;
    for (let i = 0; i < frames + 3; i++) {
      await window.__frame(60000);
      calls += p.calls; tris += p.triangles; k++;
      cMin = Math.min(cMin, p.calls); cMax = Math.max(cMax, p.calls);
    }
    const s = p.stats();
    const c = S.engine.camera.position;
    return {
      on, frames: s?.frames ?? 0,
      ms: s ? { mean: +s.mean.toFixed(0), median: +s.median.toFixed(0), p99: +s.p99.toFixed(0) } : null,
      cpu: s?.cpu ? { mean: +s.cpu.mean.toFixed(0), median: +s.cpu.median.toFixed(0) } : null,
      gpu: s?.gpu ? { mean: +s.gpu.mean.toFixed(0), median: +s.gpu.median.toFixed(0) } : null,
      calls: { mean: Math.round(calls / k), min: cMin, max: cMax },
      tris: Math.round(tris / k),
      programs: [programs0, r.info.programs.length],
      textures: r.info.memory.textures,
      mirror: { renders: M.renders - renders0, skipped: M.skipped, visible: M.mesh.visible,
        target: [M.target.width, M.target.height], tier: M.tier, scale: M.scale, below: M.below },
      cam: [c.x, c.y, c.z].map((n) => +n.toFixed(1)),
      drawing: (() => { const v = r.getDrawingBufferSize(new c.constructor()); return [v.x, v.y]; })(),
    };
  };
});

const rows = [];
for (const [label, on] of [['A: mirror on', true], ['B: mirror off', false], ['A2: mirror on', true]]) {
  say(`${label} …`);
  const row = await page.evaluate((o) => window.__measure(o), { frames: FRAMES, on });
  row.label = label;
  rows.push(row);
  console.log(label, JSON.stringify(row));
  const shot = on ? (label.startsWith('A2') ? null : `${OUT}/mirror-on.png`) : `${OUT}/mirror-off.png`;
  if (shot) {
    await page.screenshot({ path: shot, timeout: 180000 }).catch((e) => console.log('shot:', e.message));
    say(`wrote ${shot}`);
  }
}
/* A second station, closer to the wall, so the strips' smears can be judged
 * where they are long. */
await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const p = window.SABER.world.player;
  const V3 = p.position.constructor;
  for (let i = 0; i < 12; i++) {
    p.position.set(-30, 1.7, -20); p.velocity?.set?.(0, 0, 0);
    p.body?.setTransform?.(new V3(-30, 2.6, -20), null);
    if (p.camera) { p.camera.yaw = -Math.PI / 2; p.camera.pitch = -0.18; }
    if (p.control) { p.control.yaw = -Math.PI / 2; p.control.pitch = -0.18; }
    await raf();
  }
});
await page.screenshot({ path: `${OUT}/mirror-wall.png`, timeout: 180000 }).catch((e) => console.log('shot:', e.message));
say(`wrote ${OUT}/mirror-wall.png`);

await writeFile(`${OUT}/mirror.json`, JSON.stringify({ quality: QUALITY, frames: FRAMES, rows }, null, 2));
const on = rows[0], off = rows[1], on2 = rows[2];
console.log(`\nmirror ${QUALITY}: calls on/off/on ${on.calls.mean}/${off.calls.mean}/${on2.calls.mean} `
  + `(+${on.calls.mean - off.calls.mean}) · frame ms median on/off/on ${on.ms?.median}/${off.ms?.median}/${on2.ms?.median} `
  + `· programs ${on.programs} → ${off.programs} → ${on2.programs} · textures ${on.textures}/${off.textures}/${on2.textures} `
  + `· target ${on.mirror.target.join('×')} of ${on.drawing.join('×')} · renders per window ${on.mirror.renders}/${off.mirror.renders}/${on2.mirror.renders}`);
await browser.close();
server.close();
