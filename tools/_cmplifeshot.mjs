/**
 * THE LIFE LAYER, PHOTOGRAPHED — a real companion, in the poses the idle
 * system puts it in, from the range a player sees it at.
 *
 *   node tools/_cmplifeshot.mjs massiff
 *
 * `_beastshot.mjs` shoots the BODY: it spawns a bare enemy, stops its brain
 * and photographs the geometry. That is the right tool for a body plan and the
 * wrong one for this, because a bare enemy is not in the companion pack and
 * `CompanionLife` never sees it — every shot it takes is of the rest pose.
 *
 * So this fields a real companion through `fieldCompanion`, lets the world run
 * it, and then holds the layer at the moment worth looking at: each idle beat
 * at its peak, the breath at full and at empty, the head at rest and the head
 * turned. The beat is PINNED rather than waited for — a shot tool that waited
 * for a 6–17 s randomised timer to land on the frame the shutter opens would
 * take an hour and photograph the wrong thing.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { resolveLevel, installFrameHelper, deployAndWait, waitFramesFor } from './_level.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, '.smoke');
await mkdir(OUT, { recursive: true });
const KIND = process.argv[2] || 'massiff';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.play.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
await installFrameHelper(page);
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.addInitScript(() => {
  window.__errs = [];
  window.addEventListener('error', (e) => window.__errs.push(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => window.__errs.push(`rejection ${e.reason && e.reason.stack || e.reason}`));
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
const level = await resolveLevel(page, process.env.SHOT_LEVEL || null, { sky: true });
/* THE ANIMAL COMES THROUGH THE GAME'S OWN DOOR — `settings.companion`, which
 * `main.fieldFromKennel` reads at deploy and which adopts a Kennel record if
 * there is not one already. Writing the kennel key by hand instead was tried
 * and killed the render loop before the HUD came up; the setting is the door
 * the player uses and it is the door this uses. */
await page.evaluate(([lv, kind]) => localStorage.setItem('saber.settings.v2', JSON.stringify({
  level: lv, quality: 'low', resolutionScale: 1, difficulty: 'knight', mode: 'roguelite',
  volume: 0, music: 0, companion: kind })), [level, KIND]);
await page.reload({ waitUntil: 'domcontentloaded' });
/* A GENEROUS FRAME CEILING, AND IT IS NOT A GUESS. The default is 15 s and
 * this tool blew it at deploy with NO page error at all — `window.__errs` came
 * back empty — which is HANDOFF §2.6's point exactly: on swiftshader a frame
 * is not a frame, and one extra rigged body on the deploy frame is enough. */
const CEIL = 120000;
await waitFramesFor(page, '#btn-deploy', { frames: 60, ceil: CEIL });
try { await deployAndWait(page, { settle: 4, ceil: CEIL }); } catch (err) {
  console.log('DEPLOY FAILED:', err.message);
  console.log('page errors:', JSON.stringify(await page.evaluate(() => window.__errs), null, 1));
  await browser.close(); server.close(); process.exit(1);
}
await page.evaluate(() => {
  for (const el of document.body.children) if (el.tagName !== 'CANVAS') el.style.display = 'none';
});
await page.evaluate(() => {
  const S = window.SABER;
  S.input.locked = true; S.input.enabled = true;
  window.__shot = null;
  const eng = S.engine;
  const orig = eng.render.bind(eng);
  eng.render = (dt) => {
    const v = window.__shot;
    if (v) {
      const c = eng.camera;
      c.position.set(v.p[0], v.p[1], v.p[2]);
      c.lookAt(v.t[0], v.t[1], v.t[2]);
      c.fov = v.fov || 34; c.near = 0.02; c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
    }
    orig(dt);
  };
  S.world.player.cloak?.setVisible(false);
});

const info = await page.evaluate(async () => {
  const w = window.SABER.world;
  const e = w._companions?.body0 || null;
  if (!e) return { ok: false, why: 'the kennel record did not reach the field' };
  window.__cmp = e;
  /* THE SAME CACHED MODULE THE GAME IS RUNNING. `Companions.js` imports
   * './CompanionLife.js', which resolves to this exact URL, so this is a cache
   * hit and not a second copy — see HANDOFF §2.1 for why that distinction is
   * the difference between a photograph and a fiction. */
  window.__beats = (await import('/src/game/CompanionLife.js')).BEATS;
  /* PARKED. `_beastshot` stops the brain the same way and for the same reason:
   * an animal that is still walking gives a different pose by the time the
   * shutter opens. The LIFE layer is untouched — it is the subject. */
  /* STOOD ON OPEN GROUND AND FACING +Z, which is exactly where and how
   * `_beastshot` stands its subject — and the reason is the first run of this
   * tool: left at its owner's heel the animal is wherever the player spawned,
   * which on this level is beside a pillar, and the framed shot came back as a
   * photograph of the pillar. 26 m out on the diagonal is clear of everything
   * the level ships with. */
  const V = w.player.position.constructor;
  const spot = new V(w.player.position.x + 26, w.player.position.y, w.player.position.z + 26);
  spot.y = w.terrain?.height ? w.terrain.height(spot.x, spot.z) : spot.y;
  const park = () => {
    e.speed = 0; e.stunTimer = 1e9; e.attackTimer = 1e9;
    e.velocity.set(0, 0, 0); e.wish = null; e.facing = 0;
    e.position.copy(spot);
    for (const o of w.enemies) if (o !== e) { o.hp = 0; o.dead = true; }
    /* AND THE WAVE STOPS COMING. A frame through swiftshader is measured in
     * SECONDS (HANDOFF §2.6), so a settle loop that also has to re-kill a
     * fresh wave every second is a settle loop that runs for half an hour —
     * which is what the first cut of this tool did. */
    if (w.director) { w.director.nextAt = 1e9; w.director.pending = 0; }
  };
  window.__park = park;
  for (let i = 0; i < 45; i++) { park(); await window.__frame(120000); }
  return { ok: true, lod: e.lod, menu: (e._life?.menu || []).map((b) => b.id),
    breath: e._life ? e._life.breath * 60 : 0 };
});
if (!info.ok) { console.log('failed to field', KIND, info.why || ''); await browser.close(); server.close(); process.exit(1); }
console.log(KIND, 'lod', info.lod, 'menu', info.menu.join(','), 'breath', info.breath.toFixed(1), '/min');

/**
 * PIN THE LAYER AT ONE MOMENT AND HOLD IT THERE.
 *
 * `hold` is re-applied every frame from inside the page, because
 * `stepCompanionLife` runs once a frame and would advance straight past a
 * value written once. Two frames are then rendered so the pose is the one the
 * shutter sees.
 */
async function pose(name, spec) {
  const box = await page.evaluate(async (spec) => {
    const w = window.SABER.world, e = window.__cmp;
    const B = window.__beats;
    for (let i = 0; i < 4; i++) {
      window.__park();
      const L = e._life;
      if (L) {
        if (spec.beat) { L.beat = B[spec.beat]; L.beatT = spec.beat_t * B[spec.beat].dur; L.beatW = 1; L.next = 99; L.beatSide = 1; }
        else { L.beat = null; L.beatW = 0; L.next = 99; }
        if (spec.tBreath != null) L.tBreath = spec.tBreath;
        if (spec.fl != null) { L.fl = spec.fl; L.flYaw = 0.8; }
        if (spec.yaw != null) { L.yaw = spec.yaw; L.pitch = spec.pitch || 0; }
      }
      await window.__frame(120000);
      const L2 = e._life;
      if (L2) {
        if (spec.beat) { L2.beat = B[spec.beat]; L2.beatT = spec.beat_t * B[spec.beat].dur; L2.beatW = 1; }
        if (spec.tBreath != null) L2.tBreath = spec.tBreath;
        if (spec.fl != null) L2.fl = spec.fl;
        if (spec.yaw != null) { L2.yaw = spec.yaw; L2.pitch = spec.pitch || 0; }
      }
    }
    const root = e.rig ? e.rig.root : e.group;
    root.updateMatrixWorld(true);
    let lo = Infinity, hi = -Infinity, xl = Infinity, xh = -Infinity, zl = Infinity, zh = -Infinity;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (const sx of [bb.min.x, bb.max.x]) {
        for (const sy of [bb.min.y, bb.max.y]) {
          for (const sz of [bb.min.z, bb.max.z]) {
            const p = o.localToWorld(new o.position.constructor(sx, sy, sz));
            lo = Math.min(lo, p.y); hi = Math.max(hi, p.y);
            xl = Math.min(xl, p.x); xh = Math.max(xh, p.x);
            zl = Math.min(zl, p.z); zh = Math.max(zh, p.z);
          }
        }
      }
    });
    return { lo, hi, xl, xh, zl, zh, facing: e.facing };
  }, spec);
  const H = Math.max(0.4, box.hi - box.lo), W = Math.max(0.4, box.xh - box.xl), D = Math.max(0.4, box.zh - box.zl);
  const cx = (box.xl + box.xh) / 2, cz = (box.zl + box.zh) / 2, cy = box.lo + H * 0.5;
  const fit = (span, fov, margin = 1.35) => (span * margin) / (2 * Math.tan((fov * Math.PI) / 180 / 2));
  const whole = Math.max(H, D, W);
  /* THE THREE-QUARTER FRONT, `_beastshot`'s own view and its own arithmetic:
   * the animal is pinned facing +Z, so the camera stands off +X and +Z and
   * looks back at it. Copied rather than re-derived because a shot tool that
   * invents its own bearing is a shot tool that photographs a wall. */
  const r = fit(whole, 34);
  const v = { p: [cx + r * 0.76, cy + whole * 0.42, cz + r * 0.66], t: [cx, cy, cz], fov: 34 };
  await page.evaluate((v) => { window.__shot = v; }, v);
  await page.evaluate(async () => { for (let i = 0; i < 2; i++) await window.__frame(120000); });
  await page.screenshot({ path: join(OUT, `life-${KIND}-${name}.png`) });
  console.log('wrote', name);
}

/* SIX, NOT EIGHT. A frame through swiftshader on a loaded box is seconds, and
 * a tool that takes forty minutes is a tool nobody runs. These are the five
 * that show a different channel each: the breath at both ends, the gaze, one
 * beat that moves the head and one that moves the whole spine. */
await pose('rest-in', { tBreath: Math.PI / 2 });
await pose('rest-out', { tBreath: -Math.PI / 2 });
await pose('look', { yaw: 0.55, pitch: 0.18 });
await pose('glance', { beat: 'glance', beat_t: 0.5 });
await pose('sniff', { beat: 'sniff', beat_t: 0.5 });
await pose('shake', { beat: 'shake', beat_t: 0.28 });

await browser.close();
server.close();
