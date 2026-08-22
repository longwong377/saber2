/**
 * BATTLEFRONT BORZ — THE PLATES THE KILL TESTS ARE JUDGED ON.
 *
 * `tools/_flagship.mjs` produces the numbers. A number cannot answer either of
 * the two questions `FLAGSHIP.md` §14 actually asks — *"does visit two read as
 * the same ground after a battle, or as a level with holes in it?"* and *"put
 * these three in order"* — because both are questions about a picture, and both
 * are addressed to a PERSON. This file renders the pictures.
 *
 *   node --import ./tools/register.mjs tools/_frontshot.mjs step0 [--seed 7]
 *   node --import ./tools/register.mjs tools/_frontshot.mjs step1 [--seed 7]
 *
 * ── THREE THINGS ABOUT HOW IT SHOOTS, ALL OF THEM LOAD-BEARING ──────────
 *
 * ONE PAGE, EVERY PLATE. Both tests are comparisons of the same ground under
 * one change, so every plate in a set is taken from ONE boot of the game with
 * ONE camera that is set once and never touched again. Booting the page per
 * plate would put the framing, the sun, the exposure meter and the dressing
 * rng in the comparison alongside the thing under test — and the whole point
 * of §14's kill test is that the ONLY difference between the plates is the
 * front.
 *
 * THE CAMERA IS FROZEN BY DISABLING THE RIG, not by holding the mouse still.
 * `CameraRig.update` writes the camera's position and quaternion every frame
 * off the player's body, so the only way to keep a viewpoint to the pixel
 * across five renders is to stop it running (`p.camera.update = () => {}`) and
 * place `engine.camera` by hand. `enabled` on the rig looks like the knob for
 * this and is dead — it is written in the constructor and read nowhere.
 *
 * NOBODY IS ON THE FIELD. The mode is `sandbox` with `sandboxCount: 0`, so
 * what the plate contains is the GROUND and the dressing on it and nothing
 * else. That is deliberate and it is a limitation worth stating plainly: it
 * makes the test HARDER than the real thing, because a real engagement would
 * also put an army, a smoke screen and a firefight in the frame, and a player
 * asked to order three plates of a battle could order them by the size of the
 * battle rather than by the ground. If the front cannot be read off bare
 * ground it cannot be read at all — and if it CAN, everything the mode adds on
 * top is confirmation rather than the answer.
 *
 * SwiftShader renders about one frame every 3–4 seconds at this resolution
 * (HANDOFF §2.6), so `--settle` is counted in FRAMES and the whole of `step1`
 * is roughly six minutes. Budget for a handful of frames, never a video.
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, '.flagship', 'plates');
const argv = process.argv.slice(2);
const CMD = argv[0] || 'step0';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(flag('seed', '7'));
const QUALITY = flag('quality', 'medium');
const SETTLE = parseInt(flag('settle', '8'), 10);
const WIDTH = parseInt(flag('width', '1280'), 10);
const HEIGHT = parseInt(flag('height', '720'), 10);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
  '.webp': 'image/webp', '.wasm': 'application/wasm',
};

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

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(([quality]) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', quality, mode: 'sandbox', resolutionScale: 0.7,
    difficulty: 'knight', volume: 0, music: 0, sandboxCount: 0, sandboxFire: 0,
  }));
}, [QUALITY]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.click('#btn-deploy');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });

/**
 * FREEZE THE VIEWPOINT. Everything after this call renders from exactly the
 * same six numbers, whatever else changes in the world.
 *
 * The eye is put at `frontCamera`'s height above the ground rather than at a
 * body's eye level, and that is the one place this rig departs from what a
 * player sees. §4: at 2.1 m on a plain both armies compress into a 40-pixel
 * band at the horizon. Geonosis has no rise to stand on — the level's own
 * check asserts it is the flattest ground in the game out to 180 m — so a
 * plate shot from a standing man's eyes on this level is the picture §4 says
 * cannot show you a war. Both heights are shot, and the difference between
 * them is itself one of the findings.
 */
const setup = await page.evaluate(async ([seed, eyeHeight]) => {
  const S = window.SABER, w = S.world, p = w.player;
  const { frontAt, frontCamera } = await import('/src/world/Front.js');
  const front = frontAt(1, { seed });
  const cam = frontCamera(front, { height: eyeHeight });
  const ground = w.terrain.height(cam.pos.x, cam.pos.z);
  /* The body goes with the eye so the level's own streaming — the grass field,
   * the surface window, the LOD rings — is centred where the camera is looking
   * from rather than back at the spawn point. */
  p.position.set(cam.pos.x, ground, cam.pos.z);
  p.velocity.set(0, 0, 0);
  p.camera.yaw = cam.yaw; p.camera.pitch = cam.pitch;
  p.camera.update = () => {};
  const c = w.engine.camera;
  c.position.set(cam.pos.x, ground + eyeHeight, cam.pos.z);
  c.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
  c.updateMatrixWorld(true);
  /* The blade and the HUD are not the subject. `#hud` is hidden through the DOM
   * below; the sabre is put away here so a glow in the corner of five plates
   * cannot be what somebody orders them by. */
  p.saber?.retract?.();
  window.__front = { front, cam: { x: cam.pos.x, z: cam.pos.z, y: ground + eyeHeight,
    yaw: cam.yaw, pitch: cam.pitch }, ground };
  return { bearing: front.bearing, x: cam.pos.x, z: cam.pos.z, y: ground + eyeHeight };
}, [SEED, Number(flag('eye', '9'))]);

/* EVERY OVERLAY OFF. `#commune` is the one that caught this out — the kneel
 * prompt is its own top-level div rather than part of `#hud`, so the first pair
 * of plates carried a black toast across the bottom third of both. An overlay
 * that is in every plate cannot be what somebody orders them by, but it can
 * hide the ground that can. */
await page.addStyleTag({ content:
  '#hud, #crosshair, .hud, #commune, #notify, #subtitles, #announce, #orders, '
  + '#roster, #stratagem, #objective, #damage, #vignette { display: none !important; }' });

const shot = async (name) => {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, SETTLE);
  const file = join(OUT, name + '.png');
  await page.screenshot({ path: file, timeout: 240000 });
  return file;
};

/**
 * PIN THE CAMERA AGAIN. `World.update` runs a full frame between every shot —
 * the player is still a body, the rig is off but `Player.update` still writes
 * `engine.camera.fov` through the FOV kick and the death shot can still reach
 * it — so the six numbers are written back before every plate rather than once
 * at the top. It costs nothing and it removes the one way a set of plates could
 * silently drift apart.
 */
const repin = () => page.evaluate(() => {
  const w = window.SABER.world, f = window.__front;
  const c = w.engine.camera;
  c.position.set(f.cam.x, f.cam.y, f.cam.z);
  c.rotation.set(f.cam.pitch, f.cam.yaw, 0, 'YXZ');
  c.fov = 60; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
});

const manifest = { step: CMD, seed: SEED, quality: QUALITY, settle: SETTLE, camera: setup, plates: [] };

if (CMD === 'step0') {
  /* ── AND THE SAME PAIR FROM A MAN'S HEIGHT, LOOKING AT HIS OWN FEET.
   *
   * The wide plate is the deployment's first impression and it is where §14's
   * question is really aimed. But a wide plate of a 500 m plain can hide a
   * 2.6 m crater in one pixel, so a "no visible difference" from it alone
   * would be a fact about the framing. This pair is 1.7 m up, pitched down at
   * the ground the fight was actually on — the median crater in this log is
   * 46 m from the origin — so if the marks are there at all this is where they
   * show. Two plates, four extra frames, and it removes the one way the wide
   * pair could be wrong. */
  const near = () => page.evaluate(() => {
    const w = window.SABER.world, f = window.__front, c = w.engine.camera;
    const d = f.front.dir;
    /* Stand ON the ground the battle was fought over rather than behind it:
     * 30 m along the axis of advance from the origin, at eye height, looking
     * back down at the near ground. */
    const x = d.x * 30, z = d.z * 30;
    const y = w.terrain.height(x, z) + 1.7;
    c.position.set(x, y, z);
    c.rotation.set(-0.42, Math.atan2(-d.x, -d.z) + Math.PI, 0, 'YXZ');
    c.fov = 60; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    return { x: +x.toFixed(1), z: +z.toFixed(1), y: +y.toFixed(2) };
  });

  /* ── PLATE A: the ground as the deployment finds it, before anything has
   * happened on it. */
  await repin();
  manifest.plates.push({ file: await shot(`step0-a-visit-one-arrival`), state: 'pristine' });

  /* ── PLATE C: AND THE NEAR HALF OF THE PRISTINE PAIR, SHOT NOW.
   *
   * THIS USED TO BE TAKEN LAST, BY REPLAYING THE LOG WITH THE DEPTHS NEGATED
   * — `Terrain.crater` takes a negative depth by design, so the inverse of a
   * bowl-plus-lip is a mound-plus-moat and the ground came back to within the
   * accumulation clamp. That trick was sound while the only thing a crater did
   * was move the heightfield, and it is UNSOUND NOW: a crater also lays soot
   * and turned ground into `Terrain.scars`, which is a stacking record with no
   * inverse, so a negated replay does not lift the marks — it lays a second
   * set on top of the first. The "pristine" plate would have been the most
   * cratered one in the set, and the near delta would have been measuring the
   * instrument.
   *
   * Shooting it before the replay costs one camera move and is exact. The
   * ordering rule the old trick existed to protect — one boot, one exposure
   * meter, one dressing rng — is untouched, because nothing about the world
   * has changed between this plate and plate A either. */
  manifest.nearCamera = await near();
  manifest.plates.push({ file: await shot('step0-c-near-pristine'), state: 'pristine, eye height' });

  /* ── PLATE B: the same ground, on a second visit, with the crater log of one
   * fought Command area replayed onto it. Nothing else about the world has
   * changed — same seed, same dressing, same camera, same second. */
  const res = await page.evaluate(async ([seed]) => {
    const w = window.SABER.world;
    const { CraterLog } = await import('/src/world/CraterLog.js');
    const r = await fetch(`/.flagship/step0-seed${seed}.log.json`);
    if (!r.ok) return { error: `no crater log for seed ${seed} — run _flagship.mjs step0 first` };
    const log = CraterLog.fromJSON(await r.json());
    const out = log.replay(w.terrain);
    return { craters: out.craters, ms: +out.ms.toFixed(1), res: w.terrain.res };
  }, [SEED]);
  if (res.error) { console.error(res.error); process.exit(2); }
  manifest.replay = res;
  await repin();
  manifest.plates.push({ file: await shot(`step0-b-visit-two-arrival`), state: 'after one area',
    craters: res.craters });

  await near();
  manifest.plates.push({ file: await shot('step0-d-near-after'), state: 'after one area, eye height' });

  /* ── PLATE E: TWENTY SORTIES, which is FLAGSHIP §4's own saturation
   * experiment run as a picture rather than as a walkability statistic.
   *
   * §4 says persistence saturates — 20 sorties × 400 craters moves walkability
   * 0.2 points and cratered coverage stops growing by sortie 10 — and
   * concludes "ruined ground is a superb texture and a dead spine". The first
   * half of that sentence is the one this plate tests: after twenty sorties of
   * real battle, IS it a superb texture? If one area is invisible and twenty
   * are too, the problem is not the dose. */
  manifest.twenty = await page.evaluate(async ([seed]) => {
    const w = window.SABER.world;
    const { CraterLog } = await import('/src/world/CraterLog.js');
    const r = await fetch(`/.flagship/step0-seed${seed}-two-sorties.log.json`);
    if (!r.ok) return { error: 'no two-sortie log' };
    const log = CraterLog.fromJSON(await r.json());
    let n = 0, ms = 0;
    /* Ten replays of a two-sortie log is twenty sorties on the same ground.
     * The craters land in exactly the same places each time, which is a
     * FAVOURABLE approximation of twenty different battles — repeated marks
     * deepen instead of spreading, so if this does not read, twenty genuinely
     * different sorties would read less. */
    for (let i = 0; i < 10; i++) { const o = log.replay(w.terrain); n += o.craters; ms += o.ms; }
    const T = w.terrain;
    let moved = 0, deepest = 0;
    for (let i = 0; i < T.deform.length; i++) {
      if (Math.abs(T.deform[i]) > 0.005) moved++;
      deepest = Math.min(deepest, T.deform[i]);
    }
    return { craters: n, ms: +ms.toFixed(0), cellsMoved: moved,
      cellsMovedPct: +(100 * moved / T.deform.length).toFixed(2),
      deepestM: +deepest.toFixed(3), res: T.res, cellM: +T.step.toFixed(2) };
  }, [SEED]);
  await near();
  manifest.plates.push({ file: await shot('step0-e-near-twenty-sorties'), state: 'twenty sorties, eye height' });
} else if (CMD === 'step1') {
  /**
   * FIVE ENGAGEMENTS, CUMULATIVE, ONE CAMERA.
   *
   * Between each: replay that engagement's crater log, re-dress at
   * `seed + engagement`, march the columns in on §14's schedule, grow wrecks on
   * the burnt side. All of that is `marchFront` — see src/world/Front.js, which
   * says which parts of it already existed in the tree and which did not.
   *
   * THE PLATE NAMES ARE NEUTRAL AND THE ORDER IS SHUFFLED, because §14's test
   * is "shuffle them, hand them to the player, they put them in order" and a
   * file called `engagement-5.png` answers the question for them. The mapping
   * is decided BEFORE the march so each plate is written straight to its
   * neutral name — a rename afterwards leaves the true order in the file
   * modification times, which is the same leak wearing a hat.
   *
   * The shuffle is seeded off the deployment seed rather than off `Math.random`
   * so that a re-run reproduces both the plates and the key. A key that no
   * longer matches the plates on disk is worse than no key.
   */
  const PICK = [1, 3, 5];
  const NAMES = ['plate-alpha', 'plate-bravo', 'plate-charlie'];
  let s0 = (SEED * 2654435761) % 2147483647;
  const rnd = () => (s0 = (s0 * 48271) % 2147483647) / 2147483647;
  const slots = NAMES.slice();
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const nameFor = new Map(PICK.map((n, i) => [n, slots[i]]));

  const march = [];
  for (let n = 1; n <= 5; n++) {
    const r = await page.evaluate(async ([seed, engagement]) => {
      const w = window.SABER.world;
      const { CraterLog } = await import('/src/world/CraterLog.js');
      const { marchFront } = await import('/src/world/Front.js');
      const { strewWrecks, beginDressing } = await import('/src/game/Levels.js');
      let log = null;
      const res = await fetch(`/.flagship/step1-seed${seed}-e${engagement}.log.json`);
      if (res.ok) log = CraterLog.fromJSON(await res.json());
      /* THE CRATERS ARE NOT REPLAYED TWICE even though the logs are cumulative:
       * engagement 3's file already contains engagements 1 and 2, so only the
       * new tail is put down. Replaying the whole file each time would deepen
       * engagement 1's holes three times over and the plates would be ordered
       * by an artefact of the harness. */
      const already = window.__replayed || 0;
      if (log) log.entries.splice(0, already * 6);
      window.__replayed = already + (log ? log.length : 0);
      /* Re-dress at `seed + engagement`, which is §14's own words. This reseeds
       * the module-local dressing rng AND resets the occupancy grid, so the new
       * wrecks and columns can stand where the previous pass had reserved
       * space. */
      beginDressing(w, seed + engagement);
      const out = marchFront(w, { engagement, seed, log, strewWrecks, wrecks: 5 });
      out.statics = w.statics.length;
      return out;
    }, [SEED, n]);
    await repin();
    const name = nameFor.get(n);
    if (name) r.file = await shot(name);
    march.push(r);
    console.log(`  engagement ${n}: front ${r.distance} m · +${r.replayed} craters `
      + `(${r.replayMs.toFixed(1)} ms) · barrage ${r.barrage} · columns ${r.smoke} · `
      + `wrecks ${r.wrecks}${name ? ' → ' + name + '.png' : ''}`);
  }
  manifest.march = march;
  /* THE KEY IS ITS OWN FILE and it is the only place the mapping is written.
   * Whoever runs the test hands over the three PNGs and keeps this. */
  const key = { note: 'ANSWER KEY for FLAGSHIP.md §14 Step 1 — do not show this to the person '
    + 'being asked to order the plates.', seed: SEED,
    order: PICK.map((n) => ({ plate: nameFor.get(n) + '.png', engagement: n,
      frontDistanceM: march[n - 1].distance })),
    correctSequence: PICK.map((n) => nameFor.get(n) + '.png') };
  await writeFile(join(OUT, `step1-seed${SEED}-ANSWER-KEY.json`), JSON.stringify(key, null, 2));
  manifest.plates = PICK.map((n) => ({ file: nameFor.get(n) + '.png', engagement: n }));
}

/**
 * HOW MUCH OF THE FRAME ACTUALLY CHANGED, because "they look the same to me"
 * is exactly the kind of claim that should not be left to the person writing
 * the report. Two plates from a frozen camera differ only where the world
 * differs, and SwiftShader is deterministic frame to frame, so any pixel that
 * moved is a pixel the craters moved.
 *
 * The threshold is 6 levels out of 255 per channel. Below that is dither and
 * the cel band's own edge noise; above it is something a person can see.
 */
async function frameDelta(a, b) {
  const { decodePng } = await import('./_png.mjs');
  const { readFile } = await import('node:fs/promises');
  const A = decodePng(await readFile(a)), B = decodePng(await readFile(b));
  if (A.width !== B.width || A.height !== B.height) return null;
  let moved = 0, worst = 0;
  for (let i = 0; i < A.rgba.length; i += 4) {
    const d = Math.max(Math.abs(A.rgba[i] - B.rgba[i]), Math.abs(A.rgba[i + 1] - B.rgba[i + 1]),
      Math.abs(A.rgba[i + 2] - B.rgba[i + 2]));
    if (d > worst) worst = d;
    if (d > 6) moved++;
  }
  const px = A.width * A.height;
  return { pixels: px, changed: moved, changedPct: +(100 * moved / px).toFixed(3), worstChannelDelta: worst };
}

if (CMD === 'step0' && manifest.plates.length >= 2) {
  /* BY NAME, NOT BY INDEX. The order the plates are shot in changed when the
   * near-pristine one moved to the front of the run, and three of these four
   * comparisons were positional — so the reorder would have silently started
   * measuring a different pair and reported it under the same key. */
  const plate = (n) => manifest.plates.find((p) => p.file.includes(n))?.file;
  manifest.wideDelta = await frameDelta(plate('a-visit-one'), plate('b-visit-two'));
  if (plate('c-near-pristine') && plate('d-near-after')) {
    manifest.nearDelta = await frameDelta(plate('d-near-after'), plate('c-near-pristine'));
  }
  if (plate('e-near-twenty')) {
    manifest.twentyDelta = await frameDelta(plate('d-near-after'), plate('e-near-twenty'));
  }
}

manifest.errors = errors.slice(0, 6);
await writeFile(join(OUT, `${CMD}-seed${SEED}-manifest.json`), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
await browser.close();
server.close();
