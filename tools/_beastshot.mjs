/**
 * THE CREATURE BODIES, PHOTOGRAPHED FROM THE ANGLES THE FAULTS SHOW AT.
 *
 *   node tools/_beastshot.mjs massiff,tooka,acklay
 *   node tools/_beastshot.mjs all
 *
 * `portrait.mjs` exists and is kept; this is not a replacement for it. Two
 * things it does that a general portrait tool cannot, and both of them are
 * why a body defect survived being "looked at":
 *
 *   IT AIMS AT THE ANIMAL AND NOT AT THE SUN. portrait.mjs places its camera
 *   at a bearing derived from the sun so a HUMANOID is lit across the face,
 *   and an Enemy picks its own facing on spawn — so its "side" shot is the
 *   animal's side only by luck. Half the creature shots taken with it are
 *   three-quarter-rear views of a jumble. Here the animal is turned to face
 *   +Z and every camera bearing is stated relative to THAT.
 *
 *   IT FRAMES OFF THE BOX. Distance is solved from the bounding box and the
 *   field of view rather than from a multiple of the animal's radius, so a
 *   0.4 m tooka and a 7 m rancor arrive the same size in the frame and the
 *   `far` shot is genuinely the forty-metre read the complaint is about.
 *
 * Six views, chosen against the six things the bodies were reported for: the
 * flank (plates and ribs), the head close (the join), the back three-quarter
 * from above (whether the dorsal line follows the spine), the feet, the
 * tail, and the far read.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { resolveLevel, installFrameHelper, deployAndWait, waitFramesFor } from './_level.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, '.smoke');
const TAG = process.env.SHOT_TAG || '';
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
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
// One frame through swiftshader is measured at up to 4151 ms on an EMPTY
// field (HANDOFF 2.6), and a screenshot forces one — so the default 30 s
// action timeout kills this tool on its second shot. Same line portrait.mjs
// carries, for the same reason.
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
// A level with a sky: the hangar is white walls under white light, and a pale
// bone plate on a pale hide against a white wall is the one background on
// which none of these faults are visible.
const level = await resolveLevel(page, process.env.SHOT_LEVEL || null, { sky: true });
await page.evaluate((lv) => localStorage.setItem('saber.settings.v2', JSON.stringify({
  level: lv, quality: 'low', resolutionScale: 1, difficulty: 'knight', mode: 'roguelite', volume: 0, music: 0 })), level);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFramesFor(page, '#btn-deploy', { frames: 60 });
await deployAndWait(page, { settle: 4 });
/* EVERY OVERLAY, not a list of four ids. The game's coach line ("Hold L Ctrl
 * to kneel…") is none of them and sat across the middle of every shot the
 * first run took. Anything that is not the canvas is chrome, and a shot tool
 * wants none of it. */
await page.evaluate(() => {
  for (const el of document.body.children) if (el.tagName !== 'CANVAS') el.style.display = 'none';
});

// Drive the camera from a plain object the shot loop writes, exactly as
// portrait.mjs does: the engine owns the camera every frame and a camera set
// from outside the render loop is overwritten before it is photographed.
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
  const p = S.world.player;
  p.cloak?.setVisible(false);
  p.cloak && (p.cloak.setVisible = () => {});
});

const ALL = ['massiff', 'tooka', 'tuk', 'pup', 'taun', 'blurrg', 'varac', 'charger', 'stalker', 'brute', 'pouncer', 'beast'];
const arg = process.argv[2] || 'massiff';
const types = arg === 'all' ? ALL : arg.split(',');

for (const type of types) {
  const box = await page.evaluate(async (type) => {
    const w = window.SABER.world;
    for (const e of w.enemies.slice()) e.dispose?.();
    w.enemies.length = 0;
    const P = w.player.position;
    const V3 = P.constructor;
    // Well clear of the player, and 30 m up the +X axis so nothing the level
    // ships with is standing in the shot.
    const e = w.spawnEnemy(type, new V3(P.x + 26, P.y, P.z + 26));
    if (!e) return { ok: false };
    /* FACING +Z AND HELD THERE. `Enemy` turns toward its target every tick,
     * so pinning the facing once and letting the brain run gives a different
     * bearing by the time the shutter opens. The brain is stopped instead —
     * speed 0, both timers parked — and the facing written after it. */
    e.speed = 0; e.stunTimer = 1e9; e.attackTimer = 1e9;
    e.velocity.set(0, 0, 0);
    e.facing = 0;
    window.__pin = e;
    for (let i = 0; i < 6; i++) { e.facing = 0; await window.__frame(); }
    e.facing = 0;
    /**
     * …AND IT IS PINNED AT LOD 0, BECAUSE EVERY PICTURE THIS TOOL HAS EVER
     * TAKEN WAS OF A CULLED BODY.
     *
     * `Enemy.update` picks the rung off `ctx.camera.position` — the GAME
     * camera, sitting on the player — and this tool spawns the animal 26 m up
     * each of two axes, which is 36.8 m, and `> 30` is LOD 1. The shot camera
     * is a different camera and moving it does not re-enter that line, so the
     * body stays culled however close the lens gets. Proved by forcing it: the
     * same wookiee goes from bare arms and legs to a full coat.
     *
     * That is not a small defect in a screenshot tool. Every in-engine
     * creature photograph in this repository has had its non-silhouette detail
     * removed, and at least one verdict written off these pictures — "the
     * shins and feet are nearly bare" — was a reading of a coat that was
     * there. A body photographed at the distance the lens is actually at
     * should be at the rung a player at that distance would see, and the lens
     * here is metres away.
     *
     * The rung is applied once and then the property is pinned, because
     * `Enemy.update`'s write is edge-triggered on `lod !== this.lod`: setting
     * the field alone would be undone on the next frame, and letting the field
     * climb while the meshes stay would leave `_poseWalker` skipping the limb
     * solve on a body whose limbs are visible. A getter that answers 0 keeps
     * the two agreeing.
     */
    e._applyLod(0);
    Object.defineProperty(e, 'lod', { get: () => 0, set: () => {}, configurable: true });
    await window.__frame();
    const root = e.rig ? e.rig.root : e.group;
    root.updateMatrixWorld(true);
    let lo = Infinity, hi = -Infinity, xl = Infinity, xh = -Infinity, zl = Infinity, zh = -Infinity;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (const sx of [bb.min.x, bb.max.x]) for (const sy of [bb.min.y, bb.max.y]) for (const sz of [bb.min.z, bb.max.z]) {
        const p = o.localToWorld(new o.position.constructor(sx, sy, sz));
        lo = Math.min(lo, p.y); hi = Math.max(hi, p.y);
        xl = Math.min(xl, p.x); xh = Math.max(xh, p.x);
        zl = Math.min(zl, p.z); zh = Math.max(zh, p.z);
      }
    });
    // where the head bone actually ended up, so the head shot aims at a head
    /* THE SKULL'S CENTRE, NOT THE HEAD BONE'S ORIGIN. `buildCreatureHead`
     * sweeps a neck FORWARD out of that bone and hangs the skull at the far
     * end of it, so the bone itself sits between the shoulder blades — a
     * camera aimed there is inside the animal, which is exactly where the
     * first run's head shots were taken from. Averaging the head mesh's own
     * world-space corners lands on the skull. */
    const hb = e.rig?.get?.('head');
    let head = null;
    if (hb?.obj) {
      const V = window.SABER.world.player.position.constructor;
      let n = 0, ax = 0, ay = 0, az = 0;
      hb.obj.updateMatrixWorld(true);
      hb.obj.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const sx of [bb.min.x, bb.max.x]) for (const sy of [bb.min.y, bb.max.y]) for (const sz of [bb.min.z, bb.max.z]) {
          const q = o.localToWorld(new V(sx, sy, sz));
          ax += q.x; ay += q.y; az += q.z; n++;
        }
      });
      if (n) head = [ax / n, ay / n, az / n];
      else { const v = new V(); hb.obj.getWorldPosition(v); head = [v.x, v.y, v.z]; }
    }
    const tb = e.rig?.get?.('tarsus0');
    let foot = null;
    if (tb?.obj) { const v = new (window.SABER.world.player.position.constructor)(); tb.obj.getWorldPosition(v); foot = [v.x, v.y, v.z]; }
    return { ok: true, x: e.position.x, y: e.position.y, z: e.position.z, lo, hi, xl, xh, zl, zh, head, foot };
  }, type).catch((e) => ({ ok: false, err: String(e) }));
  if (!box.ok) { console.log('spawn failed for', type, box.err || ''); continue; }

  const H = Math.max(0.4, box.hi - box.lo);
  const W = Math.max(0.4, box.xh - box.xl);          // across the animal
  const D = Math.max(0.4, box.zh - box.zl);          // nose to tail (it faces +Z)
  const cx = (box.xl + box.xh) / 2, cz = (box.zl + box.zh) / 2, cy = box.lo + H * 0.5;
  /** Distance that fits `span` metres vertically at `fov`, with a margin. */
  const fit = (span, fov, margin = 1.30) => (span * margin) / (2 * Math.tan((fov * Math.PI) / 180 / 2));
  /* THE SPAN IS THE WHOLE ANIMAL, both ways. The viewport is square, so the
   * horizontal field equals the vertical one and a 2.1 m long massiff framed
   * on its 1.25 m height is cropped at both ends — which is what the first
   * run produced. max(H, D) with a 1.30 margin is the smallest frame that
   * cannot cut the subject whichever way round it is. */
  const whole = Math.max(H, D, W);
  const head = box.head || [cx, box.hi - H * 0.15, box.zh - D * 0.1];
  const foot = box.foot || [cx, box.lo, cz];
  const headSpan = Math.max(0.35, H * 0.42);

  const views = [
    // the flank: the animal faces +Z, so its side is along ±X
    ['flank', { p: [cx + fit(whole, 34), cy, cz], t: [cx, cy, cz], fov: 34 }],
    // three-quarter front high, which is the read a player standing over a
    // companion actually gets
    ['three', { p: [cx + fit(whole, 34) * 0.76, cy + whole * 0.42, cz + fit(whole, 34) * 0.66],
      t: [cx, cy, cz], fov: 34 }],
    ['head', { p: [head[0] + fit(headSpan, 30) * 0.78, head[1] + headSpan * 0.28, head[2] + fit(headSpan, 30) * 0.64],
      t: head, fov: 30 }],
    // over the spine from behind and above: the one view a dorsal ridge or a
    // row of scutes can be judged from at all
    ['back', { p: [cx + whole * 0.30, box.hi + whole * 0.60, cz - fit(whole, 34) * 0.85],
      t: [cx, box.hi - H * 0.18, cz], fov: 34 }],
    ['feet', { p: [foot[0] + fit(H * 0.55, 32) * 0.82, box.lo + H * 0.34, foot[2] + fit(H * 0.55, 32) * 0.58],
      t: [foot[0], box.lo + H * 0.16, foot[2]], fov: 32 }],
    ['far', { p: [cx + 30, box.lo + H * 0.55, cz + 18], t: [cx, box.lo + H * 0.45, cz], fov: 26 }],
  ];
  for (const [name, v] of views) {
    await page.evaluate((v) => { window.__shot = v; }, v);
    await page.evaluate(async () => { for (let i = 0; i < 2; i++) await window.__frame(); });
    await page.screenshot({ path: join(OUT, `b-${type}${TAG}-${name}.png`) });
  }
  console.log('wrote', type, `${W.toFixed(2)}w × ${D.toFixed(2)}l × ${H.toFixed(2)}h m`);
}
await browser.close();
server.close();
process.exit(0);
