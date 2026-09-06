/**
 * ONE PORTRAIT PER STATION SPECIES, in a bare scene, from the game's own tree.
 *
 * Boots the shipped page to the menu (so Engine's cel rewrite of three's
 * shader chunks is in), then in-page imports Bodies.js and StationCast.js off
 * the same origin — the same module instances the game runs — builds every
 * species' resident body through the archetype seam (`buildPlayerBody` with
 * the row, the robe and the cut), stands it with the game's own animator, and
 * shoots two frames each: a head-and-torso close-up at eye height and a full
 * figure. Not a check — the pictures are for the Read tool.
 *
 *   node tools/_speciesshot.mjs /tmp/species [key,key,...] [seed,seed,...]
 *
 * The third argument is a list of resident seeds: each one is shot as a
 * HUMAN built with `StationCast.lookFor(seed, 'human')` spread over the row —
 * the same `person` sheet `Enemy._build` spreads — so three seeds are three
 * residents and the pictures say whether the sheet reaches the face. A
 * `key:seed` entry (`other:3033`) shoots that species with that resident's
 * sheet instead.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = process.argv[2] || '/tmp/species';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const SEEDS = process.argv[4] ? process.argv[4].split(',') : [];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
const say = (m) => process.stderr.write(`▸ ${m}\n`);

say(`tree ${ROOT}`);
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('faces');
say('lock held');
await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.play.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
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
say('browser up');
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.setDefaultTimeout(600000);
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.setItem('saber.settings.v2', JSON.stringify({ volume: 0, music: 0, quality: 'low' })));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 480000 });
say('menu up — building');

const shots = await page.evaluate(async ({ only, seeds }) => {
  const THREE = await import('/vendor/three/three.module.js');
  const B = await import('/src/game/Bodies.js');
  const C = await import('/src/game/StationCast.js');
  const M = await import('/src/ui/Menu.js');
  const W = 640, H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a4048);
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x2a2418, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 3, 2); key.castShadow = true; scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 1.6);
  rim.position.set(-2, 1, -2); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.5, 32),
    new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 40);
  const out = [];
  const keys = (only || C.SPECIES_KEYS).filter((k) => C.SPECIES_BY.has(k)).map((k) => ({ key: k, sp: k, person: null }));
  for (const sd of seeds) {
    const [sp, seed] = sd.includes(':') ? sd.split(':') : ['human', sd];
    if (!C.SPECIES_BY.has(sp)) continue;
    keys.push({ key: `${sp}-${seed}`, sp, person: C.lookFor(Number(seed), sp) });
  }
  for (const { key: k, sp, person } of keys) {
    const S = C.SPECIES_BY.get(sp);
    let built, err = null;
    try {
      built = B.buildPlayerBody({ species: S.row, robe: S.robe, top: S.wear, hood: false, ...(person || {}) });
      M.standPreviewFigure(built.rig);
    } catch (e) { err = String(e && e.stack || e); }
    if (err) { out.push({ key: k, err }); continue; }
    const root = built.rig.root;
    scene.add(root);
    root.updateMatrixWorld(true);
    let tris = 0, meshes = 0;
    root.traverse((o) => { if (o.isMesh && o.geometry) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
    const box = new THREE.Box3().setFromObject(root);
    const head = built.rig.bones.get('head').obj;
    const hp = new THREE.Vector3(); head.getWorldPosition(hp);
    const eye = hp.y + 0.09 * (built.headScale || 1);
    const frames = [
      // head and torso, eye height, a little off the front axis
      { view: 'face', at: [0, eye - 0.16, 0], from: [0.55, eye + 0.02, 1.45], fov: 30 },
      // the whole figure, from a standing observer 3.5 m off
      { view: 'full', at: [0, (box.min.y + box.max.y) / 2, 0], from: [1.4, 1.5, 3.6], fov: 34 },
    ];
    for (const f of frames) {
      camera.fov = f.fov; camera.updateProjectionMatrix();
      camera.position.set(...f.from); camera.lookAt(...f.at);
      renderer.render(scene, camera);
      out.push({ key: k, view: f.view, png: canvas.toDataURL('image/png'),
        tris: Math.round(tris), meshes, top: +box.max.y.toFixed(3), bottom: +box.min.y.toFixed(3) });
    }
    scene.remove(root);
  }
  return out;
}, { only: ONLY, seeds: SEEDS });

for (const s of shots) {
  if (s.err) { console.log(`${s.key}: BUILD FAILED\n${s.err}`); continue; }
  const file = join(OUT, `${s.key}-${s.view}.png`);
  await writeFile(file, Buffer.from(s.png.split(',')[1], 'base64'));
  console.log(`${s.key} ${s.view}: ${s.tris} tris / ${s.meshes} meshes, y ${s.bottom}..${s.top} → ${file}`);
}
await browser.close();
server.close();
say('done');
