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
 *   node tools/keyart.mjs --shot shelf --width 2560 --height 1080 --settle 30
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
 *   top         20 screen px            155 screen px
 *   bottom      20 screen px            155 screen px
 *
 * measured by tools/_menubands.mjs in Chromium at 1920x1080, over viewports
 * from 4:3 to 21:9. The side band is the same either way — it is set by
 * (viewport width − panel width) and the 4:3 crop, and neither of those knows
 * what the source aspect is. The top and bottom bands are not: a 21:9 source
 * is never cropped vertically anywhere in that range, so the whole 14.3% above
 * and below the panel survives instead of 1.8%. Same pixel budget, SEVEN AND A
 * HALF TIMES the usable band, for one number in the render size.
 *
 * WHY THE CAMERA IS OVERRIDDEN AND NOT DRIVEN. `Engine.render` is wrapped, the
 * same device tools/covershot.mjs uses, because the player camera is a spring
 * that chases a body: asking the game to look somewhere gets you an approach,
 * not a pose, and 40 SwiftShader frames is a slow way to discover that. The
 * wrapper writes the matrix immediately before the draw, so the pose is exact
 * on the first frame and every frame after it.
 *
 * NB SwiftShader renders this at roughly a frame every two seconds at 710x300
 * and every twenty at 2560x1080, so a final plate is ten minutes and a scout
 * sweep is two. Run the big one detached.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { decodePng, region } from './_png.mjs';
import { bands, headBand } from './_bands.mjs';
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

/* `.menu-wrap`, read from styles.css rather than typed, because it is the one
 * number the whole ring is measured against and it lives there. */
const CSSTEXT = await readFile(join(ROOT, 'styles.css'), 'utf8');
const wrapRule = /\.menu-wrap\{([^}]*)\}/.exec(CSSTEXT)?.[1] ?? '';
const wrapDims = /width:\s*min\((\d+)px[^)]*\);height:\s*min\((\d+)px/.exec(wrapRule);
if (!wrapDims) throw new Error('cannot read .menu-wrap width/height out of styles.css');
const PANEL_W = Number(wrapDims[1]), PANEL_H = Number(wrapDims[2]);

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

/* `--yaws 0,60,120` / `--eyes 4,12` / `--fovs 34,46` turn one boot into a
 * contact sheet. Anything not swept keeps the table's value. */
const sweep = (n, v) => (flag(n, null) === null ? [v] : flag(n).split(',').map(Number));
const variants = [];
for (const yaw of sweep('yaws', pose.yaw)) {
  for (const eye of sweep('eyes', pose.eye)) {
    for (const fov of sweep('fovs', pose.fov)) {
      for (const pitch of sweep('pitches', pose.pitch)) {
        const parts = [TAG];
        if (flag('yaws', null) !== null) parts.push('y' + yaw);
        if (flag('eyes', null) !== null) parts.push('e' + eye);
        if (flag('fovs', null) !== null) parts.push('f' + fov);
        if (flag('pitches', null) !== null) parts.push('p' + pitch);
        variants.push({ ...pose, yaw, eye, fov, pitch, tag: parts.join('-') });
      }
    }
  }
}

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

  /* ── ONE BOOT, MANY POSES ────────────────────────────────────────────
   *
   * Building the world is the expensive half: on this box the Ember Shelf
   * costs about 40 s to boot and a settled 840x360 frame about 8 s, so a
   * six-bearing compass shot as six invocations pays the 40 s six times over
   * for nothing. The render hook reads `window.__P`, so a pose is a write and
   * a re-settle. Scouting a level went from ~6 min to ~2. */
  await page.evaluate(async () => {
    const S = window.SABER, w = S.world, e = S.engine;
    const THREE = await import('/vendor/three/three.module.js');
    S.input.locked = true; S.input.enabled = true;
    window.__THREE = THREE;

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
    for (const el of document.body.children) if (el.id !== 'view') el.style.display = 'none';

    const rad = (d) => (d * Math.PI) / 180;
    const p = w.player;

    /* ── THE POSE IS RE-ASSERTED EVERY FRAME, and it has to be ────────────
     *
     * `Player.facing` eases toward `camera.yaw + PI` at 13 e-folds a second
     * and `SaberController` eases its guard point toward whatever the locked,
     * silent input is asking for, which is neutral. Set either one once and
     * the settle frames quietly undo it: the first attempt produced a Jedi
     * facing the camera with the blade at rest, which is a photograph of the
     * idle animation and not a pose. Written here, immediately before the
     * draw, they are the pose in every frame that is captured. */
    const orig = e.render.bind(e);
    e.render = (dt) => {
      const P = window.__P;
      if (!P) return orig(dt);
      const c = e.camera, H = P.hero;
      if (H) {
        p.camera.yaw = rad(H.faceYaw);
        p.facing = rad(H.faceYaw) + Math.PI;
        if (p.control) { p.control.gx = H.gx; p.control.gy = H.gy; }
        if (!p.saber?.lit) p.saber?.ignite?.();
      }
      c.fov = P.fov; c.updateProjectionMatrix();
      const ya = rad(P.yaw), pr = rad(P.pitch);
      const fx = Math.sin(ya), fz = Math.cos(ya);
      const ey = P.groundY + P.eye;
      c.position.set(P.at[0], ey, P.at[1]);
      c.lookAt(P.at[0] + fx * Math.cos(pr) * P.reach, ey - Math.sin(pr) * P.reach,
        P.at[1] + fz * Math.cos(pr) * P.reach);
      c.updateMatrixWorld(true);
      orig(dt);
    };
  });

  const shots = [];
  for (const P of variants) {
    const info = await page.evaluate(async ([P, settle]) => {
      const S = window.SABER, w = S.world, e = S.engine, p = w.player;
      const THREE = window.__THREE;
      const rad = (d) => (d * Math.PI) / 180;
      const ya = rad(P.yaw);
      const fwd = { x: Math.sin(ya), z: Math.cos(ya) };
      const rgt = { x: Math.cos(ya), z: -Math.sin(ya) };
      P.groundY = w.terrain ? w.terrain.height(P.at[0], P.at[1]) : 0;
      const place = (f, r) => {
        const x = P.at[0] + fwd.x * f + rgt.x * r;
        const z = P.at[1] + fwd.z * f + rgt.z * r;
        return new THREE.Vector3(x, (w.terrain ? w.terrain.height(x, z) : 0) + 0.05, z);
      };

      /* Every body from the previous pose goes first. A sweep that kept them
       * would be measuring an accumulating crowd, not a pose. */
      for (const b of [...w.enemies]) b.remove?.() ?? b.dispose?.();
      if (w.enemies.length) w.enemies.length = 0;

      const H = P.hero;
      if (H) { p.position.copy(place(H.fwd, H.right)); p.velocity.set(0, 0, 0); p.saber?.ignite?.(); }
      else {
        /* Out of shot rather than hidden: a hidden player still lights the
         * ground under itself (the blade is a real point light) and the bright
         * patch it leaves has no cause in the picture. */
        p.position.copy(place(-60, 0));
      }
      const cast = [];
      for (const c of (P.cast || [])) {
        try {
          const b = w.spawnEnemy(c.type, place(c.fwd, c.right));
          if (b && c.face !== undefined) b.facing = rad(c.face);
          cast.push([c.type, b ? 'ok' : 'nil']);
        } catch (err) { cast.push([c.type, String(err)]); }
      }

      window.__P = P;
      for (let i = 0; i < settle; i++) await new Promise((r) => requestAnimationFrame(r));

      /* WHERE EVERYTHING LANDED, IN THE FRAME. Composing a ring by eye against
       * a slow render is how a day goes; these are the numbers the ring is
       * specified in, so a pose can be corrected arithmetically instead. `u` is
       * the fraction across the plate, `v` the fraction down it. */
      const uv = (v3) => {
        const q = v3.clone().project(e.camera);
        return [+(q.x * 0.5 + 0.5).toFixed(4), +(-q.y * 0.5 + 0.5).toFixed(4)];
      };
      const marks = {};
      if (H) {
        marks.feet = uv(p.position.clone());
        marks.head = uv(p.position.clone().setY(p.position.y + (p.height || 1.8)));
        if (p.saber?.tip) marks.tip = uv(p.saber.tip.clone());
        if (p.saber?.base) marks.hilt = uv(p.saber.base.clone());
      }
      w.enemies.forEach((b, i) => { marks['cast' + i] = uv(b.position.clone()); });
      return {
        ground: +P.groundY.toFixed(2), cast, marks,
        calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles,
        sun: e.sun ? [+e.sun.intensity.toFixed(2), '#' + e.sun.color.getHexString()] : null,
      };
    }, [P, SETTLE]);
    const f = join(OUT, `${P.tag}.png`);
    await page.screenshot({ path: f, timeout: 900000 });
    shots.push(f);
    console.log(JSON.stringify({ plate: f, yaw: P.yaw, at: P.at, eye: P.eye, pitch: P.pitch,
      fov: P.fov, ...info, errors: errors.slice(0, 4) }));
    console.log(measure(await readFile(f)));
  }
  plate = shots[shots.length - 1];
  await page.close();
}

/**
 * THE RING, MEASURED OFF THE PLATE — printed after every shot in a sweep, so a
 * pose is chosen by reading a table rather than by squinting at six pictures.
 *
 * `lum` is what the band is worth to a wordmark sitting on it and `edge` is
 * what it is worth to look at; the whole composition problem is that the ring
 * wants `edge` high and the wordmark band wants both low. `panel` is the part
 * the interface hides at 1920x1080 — a composition that scores highest there
 * has put its picture behind a wall.
 */
function measure(buf) {
  const img = decodePng(buf);
  const B = bands({ plateW: img.width, plateH: img.height, panelW: PANEL_W, panelH: PANEL_H });
  const wm = headBand({ plateW: img.width, plateH: img.height, panelH: PANEL_H });
  const step = Math.max(1, Math.round(img.width / 900));
  const one = (n, r) => {
    const s = region(img, r[0], r[1], r[2], r[3], step);
    return `  ${n.padEnd(9)} lum ${s.lum.toFixed(3)}  sd ${s.sd.toFixed(3)}  edge ${s.edge.toFixed(4)}`
      + `  max ${s.lmax.toFixed(2)}  rgb ${s.rgb.join('/')}`;
  };
  return [`  ${img.width}x${img.height}  ${(img.width / img.height).toFixed(3)}:1`,
    one('left', B.ring.left), one('right', B.ring.right), one('top', B.ring.top),
    one('bottom', B.ring.bottom), one('panel', B.covered), one('HEAD', wm)].join('\n');
}

/* ── ENCODE, AND THE FORMAT ARGUMENT ──────────────────────────────────────
 *
 * The shipped plate is a POSTERISED PNG, and both halves of that were measured
 * rather than assumed.
 *
 * PNG rather than WebP costs bytes and buys a check. tools/verify.mjs runs
 * eighty suites in workers on four cores; launching Chromium inside the gate to
 * decode one image is the shape HANDOFF §2.6 spends a page on. A WebP can only
 * be measured by a browser, so a WebP plate would have to be asserted against a
 * committed table of statistics somebody promised were true of it — §2.3's
 * signature defect with a picture in it. tools/_png.mjs is ninety lines of
 * zlib and unfiltering, and with it tools/checks/keyart.mjs measures the actual
 * bytes the browser will load.
 *
 * POSTERISED because this renderer is cel-shaded and a PNG of a cel frame is
 * mostly paying for the three things that are NOT flat: the sky's gradient, the
 * bloom halo and the fog ramp. Rounding every channel to N levels turns those
 * into bands — which is the house look, not a compromise: `styles.css`'s own
 * header says fills are solid and a gradient is allowed only where it is
 * depicting light. It is applied in linear-ish display space with no dither on
 * purpose; dithering is per-pixel noise, and per-pixel noise is exactly what
 * PNG cannot compress. The grain a cel frame wants is put back live by
 * `.screen::after`, which is an SVG turbulence and costs nothing.
 *
 * `--levels 0` prints the whole size table instead of writing anything.
 */
const LEVELS = parseInt(flag('levels', '0'), 10);
const SHIP = flag('ship', null);
if (LEVELS || SHIP || has('pack')) {
  const b64 = (await readFile(plate)).toString('base64');
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  const res = await page.evaluate(async ({ b64, levels, want }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const base = ctx.getImageData(0, 0, img.width, img.height);
    const bytes = (url) => Math.round((url.length - url.indexOf(',') - 1) * 3 / 4);
    const post = (n) => {
      const d = new ImageData(new Uint8ClampedArray(base.data), img.width, img.height);
      if (n) {
        const q = 255 / (n - 1);
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i] = Math.round(Math.round(d.data[i] / q) * q);
          d.data[i + 1] = Math.round(Math.round(d.data[i + 1] / q) * q);
          d.data[i + 2] = Math.round(Math.round(d.data[i + 2] / q) * q);
        }
      }
      ctx.putImageData(d, 0, 0);
    };
    const table = [];
    for (const n of (levels ? [levels] : [0, 64, 48, 32, 24, 20, 16, 12])) {
      post(n);
      const row = { levels: n || 256, png: bytes(c.toDataURL('image/png')) };
      if (!levels) row.webp70 = bytes(c.toDataURL('image/webp', 0.7));
      table.push(row);
    }
    let data = null;
    if (want) { post(levels); data = c.toDataURL('image/png').split(',')[1]; }
    return { size: [img.width, img.height], table, data };
  }, { b64, levels: LEVELS, want: !!SHIP });
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`  ${res.size[0]}x${res.size[1]}`);
  for (const r of res.table) {
    console.log(`  levels ${String(r.levels).padStart(3)}   png ${kb(r.png).padStart(8)}`
      + (r.webp70 === undefined ? '' : `   webp q70 ${kb(r.webp70).padStart(8)}`));
  }
  if (SHIP) {
    const out = resolve(ROOT, SHIP);
    await mkdir(resolve(out, '..'), { recursive: true });
    await writeFile(out, Buffer.from(res.data, 'base64'));
    const n = (await readFile(out)).length;
    console.log(`  wrote ${SHIP} — ${kb(n)} (${n} bytes) at ${LEVELS} levels`);
    console.log(measure(await readFile(out)));
  }
  await page.close();
}

await browser.close();
server.close();
