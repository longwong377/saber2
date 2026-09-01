/**
 * WHAT THE FLIGHT DECK ACTUALLY LOOKS LIKE.
 *
 * The one question this feature lives or dies on cannot be answered by a check:
 * six interiors were deleted here for looking like a box and every one of them
 * passed its suites. So this boots the shipped page in Chromium, walks onto the
 * deck through the real door, and takes the shots a person would judge it by.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2';
const OUT = process.argv[2] || '/tmp/deck';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

/* PROGRESS ON STDERR, FROM THE FIRST LINE. `tools/smoke.mjs`'s own header
 * records this exact failure: a run that hangs before its first `console.log`
 * produces a ZERO-BYTE file, and there is no way to tell which step is stuck
 * from nothing at all. Twice here the answer was "waiting 1800 frames for a
 * global that does not exist", and twice it looked identical to a dead box. */
const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
/* THE LOCK IS TAKEN HERE and not by a wrapper script, because a wrapper only
 * works if every caller remembers it and measured they do not — four browser
 * jobs put this box at load 25 and a ninety-second shot took twenty minutes. */
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('deckshot');
say('lock held');
await mkdir(OUT, { recursive: true });
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
say(`serving on ${port}`);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
say('browser up');
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
/* THE STACK, NOT THE MESSAGE. A bare `e.message` on a per-frame throw is
 * "Cannot read properties of undefined" sixty times a second and names
 * nothing; the frame that matters is the first one, with its stack. */
let _pe = 0;
page.on('pageerror', (e) => {
  if (_pe++ > 2) return;
  console.log('PAGE ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 14).join('\n'));
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });

say('goto');
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
say('loaded');
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true, allies: 0,
  }));
  /* A ROLL TO STAND UP. The deck's whole subject is the player's own company
   * and a fresh profile has none, so the shot would be of an empty floor. */
  const men = Array.from({ length: 12 }, (_, i) => ({
    designation: 'CT-' + (1000 + i), name: 'CT-' + (1000 + i), type: 'trooper',
    army: 'republic', xp: i * 40, kills: i * 2, areas: 2, wounds: i % 3,
    look: { mark: null, band: null, kit: {}, paint: {} }, squad: null, alive: true,
  }));
  localStorage.setItem('saber.company.v1', JSON.stringify({
    v: 1, republic: { army: 'republic', men, fallen: [], runs: 1 },
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('reloaded, waiting for SABER');

/* WAIT THE WAY `smoke.mjs` WAITS, and for its reason. A `requestAnimationFrame`
 * spin inside `page.evaluate` is not a boot probe: the boot sequence itself
 * yields on rAF, so the spin competes with the thing it is waiting for, and
 * under swiftshader 1200 frames is minutes of that. Worse, this one waited for
 * `window.__hooks`, which has never existed on this page — the handle is
 * `window.SABER` (`main.js:2683`) — so it always fell through and then reported
 * that the button was missing, because the menu had not been built yet.
 *
 * `#menu:not(.hidden)` is the DOM saying the game is up, Playwright polls it out
 * of process, and `smoke.mjs` has used exactly this against a 60 s budget for as
 * long as it has existed. */
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });
const boot = await page.evaluate(() => ({
  saber: !!window.SABER,
  menu: !document.getElementById('menu')?.classList.contains('hidden'),
}));
say(`boot ${JSON.stringify(boot)}`);
console.log('boot:', JSON.stringify(boot));

const info = await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  /* THE COMPANY TAB HAS TO BE UP for its button to be reachable, which is also
   * how a player gets there. */
  document.querySelector('.tab[data-tab="company"]')?.click();
  await raf();
  const btn = document.getElementById('btn-hangar');
  if (!btn) return { fail: 'no #btn-hangar in the DOM' };
  btn.click();
  for (let i = 0; i < 6000 && !(window.SABER?.world?.terrain); i++) await raf();
  const w = window.SABER?.world;
  if (!w) return { fail: 'no world after clicking the door' };
  for (let i = 0; i < 240; i++) await raf();
  let meshes = 0;
  w.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes++; });
  return {
    mode: w.settings?.mode, level: w.levelKey, terrain: w.terrain?.size,
    meshes, statics: w.statics?.length, lights: w.levelLights?.length,
    director: w.director?.constructor?.name,
    command: !!w.command,
    player: w.player ? [w.player.position.x, w.player.position.y, w.player.position.z].map((n) => +n.toFixed(1)) : null,
    company: w._company ? w._company.men.length : 0,
    halted: w._company ? w._company.men.filter((r) => r.halted).length : 0,
    calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null,
    tris: window.SABER?.engine?.renderer?.info?.render?.triangles ?? null,
  };
});
say(`deck ${JSON.stringify(info)}`);
console.log('deck:', JSON.stringify(info));

const SHOT = { timeout: 180000 };
if (!info.fail) {
  const shots = [
    /**
     * AND THE FIRST ONE IS WHERE THE GAME ACTUALLY PUTS HIM.
     *
     * Every station here used to be a teleport to `DECK.start`, a constant no
     * file in `src/` read — the level record declared no spawn, so the engine
     * dropped the player 82 m away facing the other way, and every frame this
     * room has ever been judged by was taken from a place the game does not
     * put anyone. `00-spawn` takes no position at all: it is whatever the
     * player was handed. The rest are the walk.
     */
    ['00-spawn', { keep: true }],
    ['01-start-left', { yaw: -0.7, pitch: 0.02, keep: true }],
    ['02-start-right', { yaw: 0.7, pitch: 0.02, keep: true }],
    ['03-aft', { yaw: Math.PI, pitch: 0.10, keep: true }],
    ['04-line', { yaw: 0, pitch: -0.02, x: 0, y: 1.7, z: -60 }],
    ['05-mid', { yaw: 0, pitch: 0.02, x: 0, y: 1.7, z: -10 }],
    ['06-port', { yaw: Math.PI / 2, pitch: 0.10, x: 0, y: 1.7, z: -30 }],
    ['07-port-close', { yaw: Math.PI / 2, pitch: 0.14, x: -34, y: 1.7, z: 0 }],
    ['08-apron', { yaw: 0, pitch: 0.02, x: 0, y: 1.7, z: 86 }],
    ['09-lip', { yaw: 0, pitch: 0.04, x: 0, y: 1.7, z: 138 }],
    ['10-up', { yaw: 0, pitch: 1.2, x: 0, y: 1.7, z: -30 }],
    /* TWO FROM ABOVE, because "rows and rows" is a claim about the plan of the
     * room and no eye-level shot can confirm or refute it. */
    ['11-over', { yaw: 0, pitch: -0.5, x: 0, y: 52, z: -120, fly: true }],
    ['12-over-wide', { yaw: 0.5, pitch: -0.38, x: -100, y: 40, z: -110, fly: true }],
  ];

  for (const [name, v] of shots) {
    await page.evaluate(async (v) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const p = window.SABER?.world?.player;
      if (p) {
        /* `keep` LEAVES HIM WHERE THE GAME PUT HIM. See the note on the list. */
        if (!v.keep) p.position.set(v.x, v.y, v.z);
        if (p.camera) { p.camera.yaw = v.yaw; p.camera.pitch = v.pitch; }
        if (p.control) { p.control.yaw = v.yaw; p.control.pitch = v.pitch; }
      }
      /* A SHOT FROM 46 M UP IS NOT SOMEWHERE THE PLAYER CAN STAND: gravity
       * puts him back on the deck inside two frames and the plan shot comes
       * back as a picture of the floor. There is no noclip flag on this body,
       * so the position is simply re-pinned every frame for the fly stations. */
      for (let i = 0; i < 40; i++) {
        await raf();
        if (v.fly) {
          const q = window.SABER?.world?.player;
          if (q) { q.position.set(v.x, v.y, v.z); if (q.velocity) q.velocity.set(0, 0, 0); }
        }
      }
    }, v);
    await page.screenshot({ path: `${OUT}/${name}.png`, ...SHOT }).catch((e) => console.log(name, 'shot:', e.message));
    say(`wrote ${name}`);
    console.log('wrote', `${OUT}/${name}.png`);
  }
}
await browser.close();
server.close();
