/**
 * BATTLEFRONT BORZ — the title plate, rendered BY the game.
 *
 * The front screen had no art: a settings dialog on a three-gradient wash. The
 * one answer that does not break §7 of DESIGN.md ("Content — procedural apart
 * from the soundtrack") is to let the renderer draw its own key art, so this
 * tool boots the real page, poses the real world, and writes the plate that
 * `.menu-bg` ships. Nothing is painted by hand and nothing is downloaded: the
 * shipped file is the output of this file, and re-running it rebuilds it.
 *
 *   node tools/keyart.mjs --shot shelf --tag try1            # render + measure
 *   node tools/keyart.mjs --shot shelf --width 2520 --height 1080 --settle 44
 *   node tools/keyart.mjs --pack .shots/keyart/try1.png      # re-encode only
 *
 * WHY THE PLATE IS 21:9 AND NOT 16:9 — this is the whole geometry argument and
 * it was arithmetic, not taste. `.menu-bg` is `background-size:cover`, so the
 * source is cropped on ONE axis, and `.menu-wrap` (a fixed 1180x770 px panel)
 * covers the middle. What survives is a RING, and the ring's thickness depends
 * on the source aspect:
 *
 *              source 16:9              source 21:9
 *   sides      130 screen px            130 screen px
 *   top/bot     26 screen px            155 screen px
 *
 * measured at 1920x1080 against viewports from 4:3 to 21:9. The side band is
 * the same either way — it is set by (viewport width − panel width) and the
 * 4:3 crop, neither of which the source can change. The top/bottom band is
 * not: a 21:9 source is never cropped vertically anywhere in that range, so
 * the whole 14.3% above and below the panel is guaranteed instead of 2.4%.
 * Same pixels, six times the usable band. See tools/checks/keyart.mjs, which
 * recomputes all of it from styles.css rather than trusting this paragraph.
 *
 * WHY THE CAMERA IS OVERRIDDEN AND NOT DRIVEN. `Engine.render` is wrapped, the
 * same device tools/covershot.mjs uses, because the player camera is a spring
 * that chases a body: asking the game to look somewhere gets you an approach,
 * not a pose, and 40 SwiftShader frames is a slow way to discover that. The
 * wrapper writes the matrix immediately before the draw, so the pose is exact
 * on the first frame and every frame after it.
 *
 * NB SwiftShader renders this at roughly one frame a second at 1280x720 and
 * about four at 2520x1080, so a final plate is ten minutes. Run it detached.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize, basename } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

/* ── THE SHOTS ────────────────────────────────────────────────────────────
 *
 * A named pose is DATA, not a command line, because the shipped plate has to
 * be reproducible by somebody who was not here. `ship` names the one that is
 * in the product; everything else is a rejected candidate kept so the choice
 * can be re-argued without re-deriving the coordinates.
 *
 *   at/yaw    where the camera stands and which way it faces (degrees, 0 = +Z)
 *   eye       metres above the terrain at `at`
 *   pitch     degrees below level
 *   reach     how far ahead the look-at point is; with pitch it sets the horizon
 *   fov       vertical FOV. Wide reads as a place, narrow reads as a portrait.
 *   cast      bodies to place, in camera-relative polar: [type, forward, right]
 *   hero      where the player stands, same polar, or null to leave them home
 */
const SHOTS = {
  shelf: {
    level: 'scoria', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
  mustafar: {
    level: 'mustafar', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
  geonosis: {
    level: 'geonosis', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
  colosseum: {
    level: 'colosseum', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
  drifts: {
    level: 'drifts', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
  alpine: {
    level: 'alpine', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
  wood: {
    level: 'wood', at: [0, 0], yaw: 180, eye: 3.2, pitch: 6, reach: 140, fov: 34,
    hero: null, cast: [],
  },
};

const SHOT = flag('shot', 'shelf');
const spec = SHOTS[SHOT];
if (!spec) { console.error(`unknown shot "${SHOT}" — have ${Object.keys(SHOTS).join(', ')}`); process.exit(1); }

/* Every knob the table sets can be overridden on the command line, because
 * finding a pose is a hundred small nudges and editing a literal between each
 * one loses the record of what was tried. */
const num = (n, d) => (flag(n, null) === null ? d : Number(flag(n)));
const pose = {
  level: flag('level', spec.level),
  at: (flag('at', null) || spec.at.join(',')).split(',').map(Number),
  yaw: num('yaw', spec.yaw),
  eye: num('eye', spec.eye),
  pitch: num('pitch', spec.pitch),
  reach: num('reach', spec.reach),
  fov: num('fov', spec.fov),
  hero: spec.hero,
  cast: spec.cast,
};

const TAG = flag('tag', SHOT);
const WIDTH = parseInt(flag('width', '1260'), 10);
const HEIGHT = parseInt(flag('height', '540'), 10);
const SETTLE = parseInt(flag('settle', '14'), 10);
const QUALITY = flag('quality', 'high');
const OUT = join(ROOT, '.shots', 'keyart');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.map': 'application/json', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
};

const { chromium } = await import('playwright-core');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

await mkdir(OUT, { recursive: true });

const { createServer } = await import('node:http');
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

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});

let plate = flag('pack', null);

if (!plate) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(([lv, q]) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: q, mode: 'sandbox', resolutionScale: 1, difficulty: 'knight',
      volume: 0, music: 0, sandboxCount: 0, sandboxFire: 0, grassScale: 1,
    }));
  }, [pose.level, QUALITY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 240000 });
  await page.click('#btn-deploy', { timeout: 240000, noWaitAfter: true });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 240000 });

  const info = await page.evaluate(async ([P, settle]) => {
    const S = window.SABER, w = S.world, e = S.engine;
    const THREE = await import('/vendor/three/three.module.js');
    S.input.locked = true; S.input.enabled = true;

    /* THE WEATHER IS FROZEN, for tools/covershot.mjs's reason: the arena's
     * calm-air unrest alone moves its fog 36% between runs, so two renders of
     * the same build are otherwise two different atmospheres — and a plate
     * that cannot be reproduced cannot be re-measured. */
    const W = w.atmosphere?.weather;
    if (W) { W.peak = 0; W.unrest = 0; W.update(0); }

    /* No interface in the plate. The HUD is the thing the backdrop sits
     * BEHIND; leaving it in would bake one interface into another.
     *
     * EVERY sibling of the canvas goes, not `#hud` alone. The first scout came
     * back with "Hold L Ctrl to kneel and connect to the Force" printed across
     * the bottom third: `.coach` is a peer of `#hud`, not a child of it, and so
     * is the boot screen and every overlay. Enumerating the ones known today is
     * the hand-maintained-list defect (HANDOFF §2.3) — the rule is "the plate
     * is the canvas", so everything that is not the canvas is hidden. */
    for (const el of document.body.children) {
      if (el.id !== 'view') el.style.display = 'none';
    }

    const rad = (d) => (d * Math.PI) / 180;
    const ya = rad(P.yaw);
    const fwd = { x: Math.sin(ya), z: Math.cos(ya) };
    const rgt = { x: Math.cos(ya), z: -Math.sin(ya) };
    const gy = w.terrain ? w.terrain.height(P.at[0], P.at[1]) : 0;
    const place = (f, r) => {
      const x = P.at[0] + fwd.x * f + rgt.x * r;
      const z = P.at[1] + fwd.z * f + rgt.z * r;
      return new THREE.Vector3(x, (w.terrain ? w.terrain.height(x, z) : 0) + 0.1, z);
    };

    const p = w.player;
    if (P.hero) {
      const at = place(P.hero[1], P.hero[2]);
      p.position.copy(at);
      p.velocity.set(0, 0, 0);
      p.saber?.ignite?.();
    } else {
      /* Out of shot rather than hidden: a hidden player still lights the
       * ground under itself (the blade is a real point light) and the bright
       * patch it leaves has no cause in the picture. */
      p.position.copy(place(-40, 0));
    }
    const cast = [];
    for (const [type, f, r] of (P.cast || [])) {
      try { cast.push([type, w.spawnEnemy(type, place(f, r)) ? 'ok' : 'nil']); }
      catch (err) { cast.push([type, String(err)]); }
    }

    const orig = e.render.bind(e);
    e.render = (dt) => {
      const c = e.camera;
      c.fov = P.fov; c.updateProjectionMatrix();
      c.position.set(P.at[0], gy + P.eye, P.at[1]);
      const pr = rad(P.pitch);
      c.lookAt(P.at[0] + fwd.x * Math.cos(pr) * P.reach,
        gy + P.eye - Math.sin(pr) * P.reach,
        P.at[1] + fwd.z * Math.cos(pr) * P.reach);
      c.updateMatrixWorld(true);
      orig(dt);
    };

    for (let i = 0; i < settle; i++) await new Promise((r) => requestAnimationFrame(r));
    return {
      ground: +gy.toFixed(2), cast,
      calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles,
      sun: e.sun ? [+e.sun.intensity.toFixed(2), '#' + e.sun.color.getHexString()] : null,
      fog: w.scene.fog ? +(w.scene.fog.density ?? 0).toFixed(5) : null,
    };
  }, [pose, SETTLE]);

  plate = join(OUT, `${TAG}.png`);
  await page.screenshot({ path: plate, timeout: 600000 });
  console.log(JSON.stringify({ plate, shot: SHOT, pose, ...info, errors: errors.slice(0, 4) }, null, 2));
  await page.close();
}

/* ── ENCODE AND MEASURE ───────────────────────────────────────────────────
 *
 * Both happen in the browser's own codecs, for tools/pixels.mjs's reason: the
 * decoder that matters is the one the player's browser will use, and a second
 * implementation of it in Node is a second thing to be wrong.
 */
if (has('pack') || !has('no-pack')) {
  const qs = (flag('q', '0.62,0.70,0.78,0.86')).split(',').map(Number);
  const b64 = (await readFile(plate)).toString('base64');
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  const res = await page.evaluate(async ({ b64, qs }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const bytes = (url) => Math.round((url.length - url.indexOf(',') - 1) * 3 / 4);
    const out = { size: [img.width, img.height], png: bytes(c.toDataURL('image/png')), webp: {} };
    for (const q of qs) out.webp[q] = bytes(c.toDataURL('image/webp', q));
    if (window.__want) out.data = c.toDataURL('image/webp', window.__want).split(',')[1];
    return out;
  }, { b64, qs });
  console.log(JSON.stringify({ plate, ...res }, null, 2));
}

await browser.close();
server.close();
