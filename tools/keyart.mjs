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
 *   # scout a level: one boot, a contact sheet of bearings, bands measured
 *   node tools/keyart.mjs --shot scout --level colosseum --yaws 0,60,120,180,240,300
 *
 *   # the shipped plate, exactly as it stands in the product
 *   node tools/keyart.mjs --shot ship --tag ship --settle 26 \
 *        --width 710 --height 300 --big 2560x1080 --bigsettle 4
 *   node tools/keyart.mjs --pack .shots/keyart/ship.png --levels 0    # size table
 *   node tools/keyart.mjs --pack .shots/keyart/ship.png \
 *        --ship assets/menu/title.webp --q 0.70
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
import { decodePng, encodePng, encodeIndexedPng, quantise, region } from './_png.mjs';
import { bands, headBand } from './_bands.mjs';
import { existsSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';

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
/* `.menu-wrap`, read from styles.css rather than typed, because it is the one
 * number the whole ring is measured against and it lives there. */
const CSSTEXT = await readFile(join(ROOT, 'styles.css'), 'utf8');
const wrapRule = /\.menu-wrap\{([^}]*)\}/.exec(CSSTEXT)?.[1] ?? '';
const wrapDims = /width:\s*min\((\d+)px[^)]*\);height:\s*min\((\d+)px/.exec(wrapRule);
if (!wrapDims) throw new Error('cannot read .menu-wrap width/height out of styles.css');
const PANEL_W = Number(wrapDims[1]), PANEL_H = Number(wrapDims[2]);

const SHOTS = {
  /**
   * THE ONE IN THE PRODUCT.
   *
   * The Ember Shelf, chosen against six other levels by shooting all of them
   * (`--yaws 0,60,120,180,240,300`) and reading the bands rather than the
   * pictures. It wins on one number that no amount of posing fixes elsewhere:
   * its ground is basalt at 0.02-0.05 luminance under a sky at 0.6, which is
   * the contrast a front end wants — the interface is ink outlines on lit
   * panels and it needs a dark field to sit on. Geonosis and the Colosseum are
   * the opposite shape (a bright floor filling two thirds of the frame, and
   * the Colosseum's crowd is a high-frequency speckle exactly where the
   * wordmark goes); Mustafar is close but muddier, its lower half a single
   * flat red. The Shelf is also the level whose sky the interface palette was
   * taken from — styles.css names `--danger` "EMBER" and says so.
   *
   * BEARING 300 because the compass sweep put two lit basalt stacks at u 0.10
   * and u 0.80 with an empty middle between them, which is the ring
   * composition arriving for free: the two things worth looking at are already
   * where the panel is not.
   *
   * A LOW CAMERA, AND THAT WAS MEASURED TOO. Elevated poses were tried first
   * (eye 12 and 24, pitched 16-20 down) on the theory that a high horizon puts
   * dark ground behind the wordmark instead of sky. It does — and it also
   * fills the band with this level's distance haze, a flat pale strip at 0.72
   * luminance and rising with altitude, which is worse than the sky it
   * replaced and has nothing in it. `.shots/keyart/v-y240-e24-p16.png` is the
   * record. So the camera stands on the shelf at eye height, the header sits
   * on open sky, and the sink layer in styles.css does the work instead.
   *
   * THE HERO AND THE RANK ARE PLACED IN NDC, NOT IN METRES. u = 0.246 and
   * u = 0.754 are the centres of the two side bands; the polar offsets below
   * are `right = ±forward · tan(22.5°)`, which is what puts a body there at
   * this fov. `marks` in the output re-projects them so the arithmetic is
   * checked against the renderer's own matrix and not against this comment.
   */
  ship: {
    level: 'scoria', at: [0, 0], yaw: 300, eye: 1.9, pitch: 3, reach: 140, fov: 38,
    hero: { fwd: 11, right: -5.22, faceYaw: -120, gx: 0.02, gy: 0.92 },
    cast: [
      { type: 'b1', fwd: 21, right: 8.7 }, { type: 'b1', fwd: 23.5, right: 9.1 },
      { type: 'b2', fwd: 26, right: 9.9 }, { type: 'b1', fwd: 19, right: 8.4 },
      { type: 'b1', fwd: 29, right: 11.3 },
    ],
  },

  /** The level scout. `--yaws`/`--eyes`/`--pitches` sweep it; `--level` moves
   *  it. Everything above was found with this. */
  scout: {
    level: 'scoria', at: [0, 0], yaw: 180, eye: 6, pitch: 6, reach: 140, fov: 46,
    hero: null, cast: [],
  },
};

const SHOT = flag('shot', 'ship');
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
        for (const gx of sweep('gxs', pose.hero ? pose.hero.gx : 0)) {
        const parts = [TAG];
        if (flag('yaws', null) !== null) parts.push('y' + yaw);
        if (flag('eyes', null) !== null) parts.push('e' + eye);
        if (flag('fovs', null) !== null) parts.push('f' + fov);
        if (flag('pitches', null) !== null) parts.push('p' + pitch);
        if (flag('gxs', null) !== null) parts.push('g' + gx);
        variants.push({ ...pose, yaw, eye, fov, pitch, tag: parts.join('-'),
          hero: pose.hero ? { ...pose.hero, gx } : null });
        }
      }
    }
  }
}

const WIDTH = parseInt(flag('width', '1260'), 10);
const HEIGHT = parseInt(flag('height', '540'), 10);
const SETTLE = parseInt(flag('settle', '14'), 10);
const QUALITY = flag('quality', 'high');
const BIG = flag('big', null) ? flag('big').split('x').map(Number) : null;
const BIG_SETTLE = parseInt(flag('bigsettle', '4'), 10);
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

/* The browser is the renderer AND the only WebP encoder in reach, so `--pack`
 * skips launching it only when neither is wanted. */
let plate0 = flag('pack', null);
const wantsWebp = has('webp') || (flag('ship', '') || '').endsWith('.webp') || !flag('ship', null);
const browser = plate0 && !wantsWebp ? null : await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});

let plate = plate0;

if (!plate) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(([lv, q, n]) => {
    /* `sandboxCount` IS THE CAST SIZE, and the first attempt got an empty
     * frame for leaving it at 0. The sandbox director does not top a room up
     * to a count — it decides what STAYS: "keep up to `count` of the right
     * archetype, nearest first" (Waves.js), and disposes the rest every frame.
     * At 0 it therefore deleted all five bodies this tool had just placed,
     * reported nothing, and rendered a landscape. Setting it to the cast size
     * means the room is already the size it asked for, so nothing is culled
     * and nothing extra is summoned. `instantSpawn` for the same reason: an
     * arrival is a dropship, and a dropship is not in the composition. */
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: q, mode: 'sandbox', resolutionScale: 1, difficulty: 'knight',
      volume: 0, music: 0, sandboxCount: n, sandboxFire: 1, sandboxType: 'mixed',
      instantSpawn: true, grassScale: 1,
    }));
  }, [pose.level, QUALITY, Math.max(...variants.map((v) => (v.cast || []).length))]);
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

    /* ── THE ONE-LSB DITHER COMES OUT, AND IT IS WORTH 3.5x ──────────────
     *
     * Engine's composite pass ends with an unconditional triangular dither of
     * one least-significant bit — `col += (hash(...) - hash(...)) / 255.0` —
     * and its own comment says why: an 8-bit framebuffer bands in the
     * highlights and this is invisible. It is invisible ON A SCREEN. It is not
     * invisible to a compressor, because it makes every single pixel differ
     * from its neighbour, which is precisely the input PNG cannot pack.
     * Measured on the same 710x300 frame: 403 KB with it, 116 KB without, and
     * the two are indistinguishable at 1:1.
     *
     * It is patched HERE, in the page, and not in src/. The dither is right
     * for a live frame and wrong for a still, `.screen::after` lays an SVG
     * paper tooth over the whole menu anyway, and a still that has been
     * banded on purpose is the house look rather than a compromise.
     */
    const cm = e.composite?.material;
    if (cm && cm.fragmentShader.includes('hash(gl_FragCoord.xy + 17.0)')) {
      cm.fragmentShader = cm.fragmentShader.replace(
        /col \+= \(hash\(gl_FragCoord\.xy \+ 17\.0\) - hash\(gl_FragCoord\.xy \+ 71\.0\)\) \* \(1\.0\/255\.0\);/,
        '// dither removed for the title plate — see tools/keyart.mjs');
      cm.needsUpdate = true;
      window.__flat = true;
    }

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
        /* THE HERO DOES NOT DIE FOR A PHOTOGRAPH. Five droids with line of
         * sight put real bolts in the air over the settle, and a plate whose
         * subject is on the floor is not the plate. The bolts stay — they are
         * the best thing in the frame — but the body they are aimed at is
         * held whole. */
        p.hp = p.maxHp; p.invuln = Math.max(p.invuln, 1); p.stagger = 0;
      }
      /* AND THE RANK STAYS WHERE IT WAS PUT. The AI walks: over 30 settle
       * frames at a clamped 0.1 s each, a droid closes three seconds of ground
       * and the composition that was measured is not the one that is shot.
       * Position is pinned and nothing else is, so they still TURN to face the
       * player and their legs still stride — which is what a still wants. */
      for (const [b, at] of (window.__PINS || [])) { if (b.alive !== false) b.position.copy(at); }
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
      window.__PINS = [];
      for (const c of (P.cast || [])) {
        try {
          const at = place(c.fwd, c.right);
          const b = w.spawnEnemy(c.type, at);
          if (b) window.__PINS.push([b, at.clone()]);
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
    /* ── SETTLE SMALL, SHOOT BIG ──────────────────────────────────────────
     *
     * SwiftShader is fill-rate bound, so a frame costs what its pixels cost:
     * about 12 s at 710x300 and about 13 times that at 2560x1080. Settling the
     * pose at the final size is therefore a 40-minute render for 30 frames of
     * a spring converging, and 29 of those frames are thrown away.
     *
     * The pose does not depend on the viewport. The camera override sets a
     * VERTICAL fov and the two sizes are 2.367:1 and 2.370:1, so the framing
     * survives the resize to three decimal places; everything that needs time
     * — the saber's angular spring, the gait, the cloth, the bolts in the air —
     * has already converged. Four frames after the resize is enough for the
     * engine's own onResize to rebuild its targets and redraw. Measured: 11
     * minutes instead of 70, and the two frames are the same picture.
     */
    if (BIG) {
      await page.setViewportSize({ width: BIG[0], height: BIG[1] });
      await page.evaluate(async (n) => {
        for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
      }, BIG_SETTLE);
    }
    const f = join(OUT, `${P.tag}.png`);
    await page.screenshot({ path: f, timeout: 1800000 });
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
  /* Step 1, not a subsample. The --ship gate measures these same bands at
   * step 1, and two numbers for one band in one printout is how a reading gets
   * quoted against the wrong bound. 2.8 M pixels is a fifth of a second. */
  const one = (n, r) => {
    const s = region(img, r[0], r[1], r[2], r[3], 1);
    return `  ${n.padEnd(9)} lum ${s.lum.toFixed(3)}  sd ${s.sd.toFixed(3)}  edge ${s.edge.toFixed(4)}`
      + `  max ${s.lmax.toFixed(2)}  rgb ${s.rgb.join('/')}`;
  };
  return [`  ${img.width}x${img.height}  ${(img.width / img.height).toFixed(3)}:1`,
    one('left', B.ring.left), one('right', B.ring.right), one('top', B.ring.top),
    one('bottom', B.ring.bottom), one('panel', B.covered), one('HEAD', wm)].join('\n');
}

/* ── ENCODE, AND THE FORMAT ARGUMENT ──────────────────────────────────────
 *
 * The shipped plate is a WebP. Measured on the 2560x1080 frame this file
 * renders, every number produced by the code in this repo:
 *
 *   PNG truecolour, straight out of Chromium's canvas       ~5.5 MB
 *   PNG truecolour, tools/_png.mjs at zlib 9, adaptive       2783 KB
 *   PNG truecolour, 24 levels per channel                     749 KB
 *   PNG indexed, median-cut to 256 colours                    628 KB
 *   PNG indexed, 64 colours (visibly banded)                  360 KB
 *   WebP q60 / q70 / q80                                86 / 96 / 130 KB
 *
 * That is the whole argument. A PNG is the format tools/checks/keyart.mjs can
 * read without a browser, and the composition and legibility bounds would then
 * live in the gate rather than here — which is what was built first. It costs
 * 532 KB of the player's bandwidth, on a game whose entire pitch is that it
 * opens at a URL, to make a test more convenient. WebP is the same picture at
 * a sixth of the weight and every browser that can run this game (WebGL2 and
 * WebAssembly) has decoded WebP since 2020.
 *
 * SO THE BOUNDS MOVED HERE INSTEAD OF BEING DROPPED, and they are `--ship`'s
 * gate: a plate that fails them is not written. Measuring them here is in one
 * way strictly better — it is done on the lossless render rather than through
 * a lossy codec — and in one way worse, which is stated rather than hidden:
 * nothing re-measures the file after it is committed. tools/checks/keyart.mjs
 * carries everything that survives without a decoder, which is more than it
 * sounds: existence, format, the plate's own dimensions out of its RIFF header,
 * the crop geometry, the upscale factor, the byte budget, the MIME type, and
 * the two places the path is written.
 *
 * The lossless intermediate is kept in `.shots/keyart/` (gitignored) so the
 * encode can be re-run, re-measured and re-argued without paying for the
 * eleven-minute render again.
 *
 *   --levels 0                    print the size table and write nothing
 *   --ship assets/menu/title.webp [--q 0.70]
 *   --ship assets/menu/title.png  [--levels 24] [--colours 256]   (the PNG path,
 *                                 kept because it is what the table was made with)
 */
const LEVELS = parseInt(flag('levels', '0'), 10);
const COLOURS = parseInt(flag('colours', '256'), 10);
const QUALITY_W = parseFloat(flag('q', '0.70'));
const SHIP = flag('ship', null);
if (LEVELS || SHIP || has('pack')) {
  const src = decodePng(await readFile(plate));
  const post = (n) => {
    if (!n) return src;
    const d = new Uint8Array(src.rgba);
    const q = 255 / (n - 1);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(Math.round(d[i] / q) * q);
      d[i + 1] = Math.round(Math.round(d[i + 1] / q) * q);
      d[i + 2] = Math.round(Math.round(d[i + 2] / q) * q);
    }
    return { ...src, rgba: d };
  };
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  const webp = async (q) => {
    const b64 = (await readFile(plate)).toString('base64');
    const pg = await browser.newPage({ viewport: { width: 64, height: 64 } });
    const out = await pg.evaluate(async ([b, quality]) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      c.getContext('2d').drawImage(im, 0, 0);
      return c.toDataURL('image/webp', quality).split(',')[1];
    }, [b64, q]);
    await pg.close();
    return Buffer.from(out, 'base64');
  };

  console.log(`  ${src.width}x${src.height}  ${(src.width / src.height).toFixed(3)}:1`);
  if (!SHIP) {
    for (const n of (LEVELS ? [LEVELS] : [0, 32, 24])) {
      console.log(`  png ${String(n || 256).padStart(3)} levels   ${kb(encodePng(post(n)).length).padStart(9)}`);
    }
    console.log(`  png indexed ${COLOURS}   ${kb(encodeIndexedPng(quantise(post(LEVELS), COLOURS)).length).padStart(9)}`);
    if (browser) for (const q of [0.6, 0.7, 0.8]) console.log(`  webp q${q * 100}       ${kb((await webp(q)).length).padStart(9)}`);
  }

  if (SHIP) {
    /* ── THE GATE ────────────────────────────────────────────────────────
     *
     * The four bounds that need pixels, checked before the file is written and
     * not after — because the shipped plate is a WebP and nothing downstream
     * can decode one without a browser (see the format argument above). This
     * is their only home; tools/checks/keyart.mjs owns everything that survives
     * without a decoder and carries a tripwire that fails if this gate is ever
     * removed. Every number below has a distribution under it.
     *
     * 1. THE SHAPE. A plate narrower than the widest viewport in range is
     *    cropped vertically by `cover`, which is what takes the top and bottom
     *    bands from 155 screen px to 20. tools/_bands.mjs computes it.
     *
     * 2. THE SUBJECT IS IN THE OPEN. DESIGN.md's presentation bar is "bloom
     *    that makes the blade the brightest thing in your life", and that is
     *    literally true of the pixels: over 35 renders of this game — seven
     *    levels, six bearings, five pitches, four elevations — every frame
     *    WITHOUT a lit blade in it has exactly zero pixels at or above 0.90
     *    display luminance, and every frame with one has 150 to 300 at
     *    710x300. Nothing else in this renderer reaches it; the hottest cloud
     *    on the Ember Shelf tops out at 0.87 and the Colosseum's sand at 0.83.
     *    So the count answers "is the subject of this game in this picture" and
     *    the split answers "can it be seen". The first pose this was run
     *    against scored 13% and it was a real defect — the hero was posed with
     *    the blade sweeping toward the middle of the frame, so nine tenths of
     *    it was behind `.menu-wrap` at 1920x1080. The shipped plate is 100%.
     *
     * 3. NO DEAD BAND. Each quarter of the ring against the plate's own mean
     *    edge energy. Over the same 35 renders the four bands run 0.14x to
     *    2.40x; the bottom is systematically weakest (median ~0.55) because the
     *    near foreground is one continuous surface with the fewest silhouettes
     *    crossing it. Every band under 0.4x was a frame whose band is literally
     *    a black cut-out or an empty sky — comp-y180 bottom 0.14, comp-y120
     *    bottom 0.27 and left 0.39, mustafar bottom 0.29 — so 0.4 separates
     *    "there is nothing there" from "there is less there", which is the only
     *    distinction this clause is entitled to make. The shipped plate's
     *    weakest band is 0.71x.
     *
     *    A FIFTH CLAUSE WAS WRITTEN AND DELETED, and it is worth the paragraph.
     *    The obvious test of "nothing you care about behind the panel" is to
     *    compare edge energy in the ring against the region the panel hides and
     *    demand the ring win. Measured over nine plates, six of them plain
     *    landscape scouts with no composition in them: colosseum 0.67,
     *    geonosis 0.64, mustafar 0.80, shelf@0 0.83, shelf@300 0.93, shelf
     *    elevated 1.18, the composed candidates 0.71-0.85. The uncomposed
     *    frames span the composed ones on both sides — the ratio is measuring
     *    WHERE THE HORIZON IS, not where the subject is, because a horizon
     *    crosses the full width at one height and that height is in the middle
     *    third unless the camera is pitched down into the dirt. Any bound in
     *    that range would have passed and failed plates for a reason unrelated
     *    to its own name, which is HANDOFF §2.4's instrument that manufactures
     *    defects. Clause 2 is what replaced it.
     *
     * 4. THE HEADER HOLDS. `.menu-head` has no background, so the wordmark and
     *    the record line are painted straight onto this plate. Measured through
     *    the sink layer parsed out of styles.css, over the whole header box
     *    (tools/_bands.mjs's stated geometry, 1180x83 at 1920x1080 — the box
     *    and not the letters, because a played profile puts a second line of
     *    10 px mono there that a fresh one does not).
     *
     *    `--ink` is #f4ecdc, luminance 0.884, so WCAG's ratio against a ground
     *    of luminance L is (0.884 + 0.05) / (L + 0.05); 2.0 is L = 0.42. That
     *    is deliberately not the 4.5 a body-copy bound would use — the four-
     *    offset ink halo, not the fill, is what separates these letters from
     *    their ground, and 4.5 would forbid every sky this game has and leave a
     *    backdrop nobody can see. `edge` is the one that bites: the shipped
     *    pose reads 0.0048 through the sink, the same band with the camera
     *    pitched 7 degrees further down — which drags the cloud deck into it —
     *    reads 0.0147, and the raw plate before the sink reads 0.0099. 0.020
     *    admits a cloudy sky seen through the sink and refuses one without it.
     */
    const B = bands({ plateW: src.width, plateH: src.height, panelW: PANEL_W, panelH: PANEL_H });
    const whole = region(src, 0, 0, 1, 1);
    const sink = /linear-gradient\(\s*rgba?\(([\d.,\s]+)\)/.exec(
      /\.menu-bg\{([^}]*)\}/.exec(CSSTEXT)?.[1] ?? '')?.[1]?.split(',').map(Number);
    if (!sink) throw new Error('cannot read the sink layer out of `.menu-bg` in styles.css');
    const [sr, sg, sb, sa] = sink;
    const dim = new Uint8Array(src.rgba);
    for (let i = 0; i < dim.length; i += 4) {
      dim[i] = dim[i] * (1 - sa) + sr * sa;
      dim[i + 1] = dim[i + 1] * (1 - sa) + sg * sa;
      dim[i + 2] = dim[i + 2] * (1 - sa) + sb * sa;
    }
    const head = region({ ...src, rgba: dim }, ...headBand({ plateW: src.width, plateH: src.height, panelH: PANEL_H }));

    const [cx, cy, cw, ch] = B.covered;
    const x0 = Math.round(cx * src.width), x1 = Math.round((cx + cw) * src.width);
    const y0 = Math.round(cy * src.height), y1 = Math.round((cy + ch) * src.height);
    let lit = 0, hid = 0;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const k = (y * src.width + x) * 4;
        const l = (0.2126 * src.rgba[k] + 0.7152 * src.rgba[k + 1] + 0.0722 * src.rgba[k + 2]) / 255;
        if (l < 0.90) continue;
        lit++;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) hid++;
      }
    }
    const open = lit ? 1 - hid / lit : 0;
    const bad = [];
    if (B.cropsVertically) bad.push(`the plate is ${B.aspect.toFixed(3)}:1 — cover will crop it vertically`);
    if (lit < src.width * src.height * 2e-4) bad.push(`${lit} px at or above 0.90 luminance — no lit blade in frame`);
    else if (open < 0.6) bad.push(`only ${(open * 100).toFixed(0)}% of ${lit} highlight px fall outside the panel`);
    for (const k of ['left', 'right', 'top', 'bottom']) {
      const r = region(src, ...B.ring[k]);
      if (r.edge < whole.edge * 0.4) {
        bad.push(`the ${k} band is ${(r.edge / whole.edge).toFixed(2)}x the plate's edge energy — nothing drawn in it`);
      }
    }
    const ratio = (0.884 + 0.05) / (head.lum + 0.05);
    if (ratio < 2.0) bad.push(`the header band reads ${head.lum.toFixed(3)} through the sink — ${ratio.toFixed(2)}:1`);
    if (head.edge > 0.020) bad.push(`the header band carries ${head.edge.toFixed(4)} of edge energy through the sink`);
    console.log(measure(await readFile(plate)));
    console.log(`  highlights ${lit} px, ${(open * 100).toFixed(0)}% outside the panel`);
    console.log(`  header through the sink: lum ${head.lum.toFixed(3)} (${ratio.toFixed(2)}:1), edge ${head.edge.toFixed(4)}`);
    if (bad.length) {
      console.error('\n  NOT SHIPPED — the plate fails its own bounds:\n    ' + bad.join('\n    ') + '\n');
      process.exitCode = 1;
    } else {
      const out = resolve(ROOT, SHIP);
      await mkdir(resolve(out, '..'), { recursive: true });
      const buf = SHIP.endsWith('.webp') ? await webp(QUALITY_W)
        : (LEVELS || COLOURS < 256 ? encodeIndexedPng(quantise(post(LEVELS), COLOURS)) : encodePng(src));
      await writeFile(out, buf);
      console.log(`  wrote ${SHIP} — ${kb(buf.length)} (${buf.length} bytes)`);
    }
  }
}

if (browser) await browser.close();
server.close();
