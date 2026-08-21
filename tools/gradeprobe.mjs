/**
 * WHAT THE COMPOSITE GRADE DOES TO EACH LEVEL'S GROUND AND SKY.
 *
 * `NEXT.md` carried "the composite grade crushes dark levels — mustafar's near
 * ground ×0.49" as an open look call, and the number came from a note inside
 * `tools/checks/lighting.mjs` that measured three levels once and was never
 * re-run. This is that measurement as a repeatable instrument over the whole
 * roster, so a change to the tone curve can be argued from before-and-after
 * numbers on every shipped level rather than from one.
 *
 * It is a DIFFERENCE, not a threshold, which is what makes it immune to the
 * level, the exposure meter and the weather: the same pinned frame is shot
 * twice, once with the composite pass on and once with it bypassed (the
 * OutputPass becomes the screen pass, exactly as `tools/skyshot.mjs` does it),
 * and every ratio below is graded ÷ ungraded on the same pixels.
 *
 * The pose is the player's own eye height and bearing at the spawn, tipped 12°
 * down, and it is one pose rather than two on purpose: the bottom fifth is the
 * ground a third-person camera keeps under the player, the bottom half is
 * everything inside about eight metres, and the top tenth still clears the
 * horizon. Pitching all the way down onto the ground gives a cleaner ground
 * read and no sky at all, which is how the note in lighting.mjs came to carry
 * only half of the question.
 *
 *   node --import ./tools/register.mjs tools/gradeprobe.mjs --tag before
 *   node --import ./tools/register.mjs tools/gradeprobe.mjs --tag after --levels mustafar,colosseum
 *
 * Output: `.smoke/grade/<tag>.json` and, per level, `<tag>-<level>-full.png`
 * and `<tag>-<level>-nograde.png`. SwiftShader renders about one frame every
 * four seconds (HANDOFF §2.6), so this is ~90 s a level and the whole roster is
 * a coffee, not a video.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const TAG = flag('tag', 'now');
const W = parseInt(flag('width', '1024'), 10);
const H = parseInt(flag('height', '576'), 10);
const OUT = join(ROOT, '.smoke', 'grade');

/* The roster is read from the game, never listed here — HANDOFF §2.7's dead
 * level names are what happens when a tool keeps its own copy of LEVEL_ORDER,
 * and `World.loadLevel` substitutes LEVEL_ORDER[0] for a key it does not know
 * rather than complaining. */
const { LEVEL_ORDER } = await import('../src/game/Levels.js');
const LEVELS = (flag('levels', '') || LEVEL_ORDER.join(',')).split(',').filter(Boolean);
for (const k of LEVELS) if (!LEVEL_ORDER.includes(k)) throw new Error(`no such level: ${k}`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
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
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});

/** Region statistics off a PNG, decoded in the same browser. */
const REGIONS = (w, h) => ({
  // the ground the player is standing on: at a 12° dip the bottom half is
  // everything inside about eight metres
  ground: [0, Math.round(h * 0.5), w, h - Math.round(h * 0.5)],
  // the NEAREST ground, centre only — the patch a third-person camera keeps
  // under the player, and the region the ×0.49 in lighting.mjs came off
  near: [Math.round(w * 0.25), Math.round(h * 0.82), Math.round(w * 0.5), h - Math.round(h * 0.82)],
  sky: [0, 0, w, Math.round(h * 0.10)],
});

async function statsOf(page, buf, w, h) {
  return page.evaluate(async ({ b64, regions }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const out = {};
    for (const [name, [x, y, rw, rh]] of Object.entries(regions)) {
      const d = ctx.getImageData(x, y, rw, rh).data;
      let r = 0, g = 0, b = 0, n = 0, dark = 0, black = 0;
      const ls = [];
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
        r += R; g += G; b += B; n++;
        const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        ls.push(l);
        if (l < 24 / 255) dark++;
        /* "black" is the crush — the code values the curve maps onto zero.
         * The threshold is 2 and not 0 because the last line of the composite
         * adds a triangular dither of one LSB to kill banding in the sky, so a
         * pixel the curve sent to exactly zero arrives as 0 or 1 at random and
         * an equality test undercounts it by about half. */
        if (Math.max(d[i], d[i + 1], d[i + 2]) <= 2) black++;
      }
      ls.sort((p, q) => p - q);
      const mr = r / n, mg = g / n, mb = b / n;
      const mx = Math.max(mr, mg, mb), mn = Math.min(mr, mg, mb);
      out[name] = {
        rgb: [mr, mg, mb],
        lum: 0.2126 * mr + 0.7152 * mg + 0.0722 * mb,
        p10: ls[Math.floor(n * 0.1)], p50: ls[Math.floor(n * 0.5)], p90: ls[Math.floor(n * 0.9)],
        // chroma as a fraction of the brightest channel: what "it kept its
        // colour" means for a flat cel band, and it is scale-free, so a band
        // that is only darker still reads the same here
        sat: mx > 1e-6 ? (mx - mn) / mx : 0,
        darkFrac: dark / n, blackFrac: black / n, n,
      };
    }
    return out;
  }, { b64: buf.toString('base64'), regions: REGIONS(w, h) });
}

const rows = [];
for (const level of LEVELS) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate((lv) => {
      localStorage.setItem('saber.settings.v2', JSON.stringify({
        level: lv, quality: 'medium', resolutionScale: 1, difficulty: 'knight', mode: 'sandbox',
        volume: 0, music: 0, grassScale: 0.5, particleScale: 0.5,
        /* WITHOUT THIS, EVERY LEVEL MEASURES THE SAME ROOM. Every mode now
         * opens with the insertion — the player leaves a capital ship in orbit
         * and rides a transport down (src/game/Extraction.js's header quotes
         * the instruction that asked for it), which is forty-odd game seconds
         * of flight before the ramp drops. On SwiftShader that is minutes, and
         * a probe that shoots as soon as the HUD appears photographs the BAY:
         * the first run came back with the Ember Shelf and the Ember Fields as
         * near-identical frames of the same dark deck plating, and the ×0.55
         * and ×0.54 it reported for their near ground were the ship's floor
         * both times. `instantSpawn` is the shipped setting that puts the
         * player on the ground instead, and it has exactly one reader
         * (`Waves.instantSpawn`), so it cannot mean something else here. */
        instantSpawn: true }));
    }, level);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
    await page.click('#btn-deploy', { timeout: 180000, noWaitAfter: true });
    await page.waitForSelector('#hud:not(.hidden)', { timeout: 90000 });
    await page.waitForTimeout(2500);

    const info = await page.evaluate(() => {
      const S = window.SABER, e = S.engine, w = S.world;
      /* THE POSE. Player's own eye height, the player's own bearing, tipped
       * 12° down: the bottom half is the ground inside about eight metres —
       * the surface the complaint is about — and the top tenth still clears
       * the horizon, so ONE frame carries both halves of the question. World
       * origin was tried first and put the camera inside a lava wall on the
       * Ember Shelf; the spawn is the only place in a level that is guaranteed
       * to be somewhere a player can stand. */
      const p = w.player.position;
      const yaw = w.player.camera?.yaw ?? 0;
      const eye = { x: p.x, y: p.y + 1.7, z: p.z };
      const pitch = -12 * Math.PI / 180;
      const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      /* THE EVENTS ARE NOT THE GRADE. uBars, uPunch, uFlash, uHurt, uSense,
       * uDrain and uRadial are all things the game DOES to the frame for a
       * moment — a kill, a hit, a cinematic — and they ride on top of the
       * level's own grade rather than being part of it (the note on uPunch in
       * Engine.js makes that split explicit: composition is uVignette, the
       * event is uPunch, and a check reading one must not see the other).
       *
       * They are cleared here because one of them wrecked a reading and it
       * took a screenshot to see why: the Colosseum's opening beat drops the
       * LETTERBOX, so the after run photographed a frame with black bars over
       * the top tenth and the bottom fifth — exactly the two regions this
       * measures — and reported the sky at ×0.49 and a quarter of the near
       * field pure black on a level whose ground had not moved at all. A
       * number that damning from a change that provably cannot touch anything
       * above the knee is the signal to go and look at the picture. */
      const EVENTS = ['uBars', 'uPunch', 'uFlash', 'uHurt', 'uSense', 'uDrain', 'uRadial'];
      const orig = e.render.bind(e);
      e.render = (dt) => {
        const c = e.camera;
        c.position.set(eye.x, eye.y, eye.z);
        c.lookAt(eye.x + dir.x * 40, eye.y + dir.y * 40, eye.z + dir.z * 40);
        c.updateMatrixWorld(true);
        for (const k of EVENTS) e.composite.uniforms[k].value = 0;
        e.composite.uniforms.uHeatCount.value = 0;
        orig(dt);
      };
      /* No interface in the shot, and not `#hud` alone: `.coach`, the commune
       * prompt and the boot screen are all PEERS of #hud, so enumerating the
       * ones known today is HANDOFF §2.3's hand-maintained list. The rule is
       * "the frame is the canvas" — tools/keyart.mjs makes the same argument. */
      for (const el of document.body.children) if (el.id !== 'view') el.style.display = 'none';
      /* FREEZE THE WORLD. The two shots are three seconds apart on a renderer
       * that takes four of them a frame, and anything that moves in between —
       * an enemy walking in, grass under wind, a particle — lands in the ratio
       * as if the grade had done it. With `update` stubbed the two frames are
       * the same scene twice and the only difference left is the pass. */
      w.update = () => {};
      const u = e.composite.uniforms;
      return {
        exposure: e.renderer.toneMappingExposure,
        pose: { eye, yaw },
        meter: e.meter && { key: e.meter.key, trim: e.meter.trim, rawTrim: e.meter.rawTrim,
          irradiance: e.meter.irradiance },
        grade: { black: u.uBlack.value, curve: u.uCurve.value, contrast: u.uContrast.value,
          knee: u.uKnee ? u.uKnee.value : null, vignette: u.uVignette.value,
          saturation: u.uSaturation.value, lift: u.uLift.value.toArray(), gain: u.uGain.value.toArray() },
      };
    });
    await page.waitForTimeout(3500);
    const full = await page.screenshot({ path: join(OUT, `${TAG}-${level}-full.png`) });

    await page.evaluate(() => {
      const e = window.SABER.engine;
      e.composite.enabled = false; e.outputPass.renderToScreen = true;
    });
    await page.waitForTimeout(3500);
    const raw = await page.screenshot({ path: join(OUT, `${TAG}-${level}-nograde.png`) });

    const a = await statsOf(page, full, W, H);
    const b = await statsOf(page, raw, W, H);
    rows.push({ level, ...info, graded: a, ungraded: b, errors: errors.slice(0, 4) });
    const line = (k) => `${k} ${(b[k].lum * 255).toFixed(1)}→${(a[k].lum * 255).toFixed(1)} `
      + `(${(a[k].lum / Math.max(b[k].lum, 1e-6)).toFixed(2)}x)`;
    console.log(`${level.padEnd(10)} ${line('near')}  ${line('ground')}  ${line('sky')}`
      + `  sat ${b.near.sat.toFixed(2)}→${a.near.sat.toFixed(2)}`
      + `  black ${(a.near.blackFrac * 100).toFixed(1)}%`);
  } finally {
    await page.close();
  }
}

await writeFile(join(OUT, `${TAG}.json`), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} levels → ${join(OUT, `${TAG}.json`)}`);
await browser.close();
server.close();
