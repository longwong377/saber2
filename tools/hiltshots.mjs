/**
 * BATTLEFRONT BORZ — REAL PICTURES OF THE REAL HILTS.
 *
 * The player: "preview images for the jedi hilts all show the same image, also
 * I thnk most of them look the same in the preview too".
 *
 * Measured before touching anything: the ten cards are ten DISTINCT images —
 * `Menu._hiltArt` does draw each one from its own `HILT_SPECS` row. They are
 * distinct and they are also indistinguishable, which is the complaint. Each is
 * a 168x54 canvas holding a grey horizontal bar on a brown ground, and the
 * things that actually separate a Consular from a Crossguard — a flared shroud,
 * a curved grip, a crossguard, a ring pommel — are a handful of pixels at that
 * size. Ten technically-different pictures of the same grey bar.
 *
 * A drawing of the hilt was always going to lose to the hilt. The menu already
 * builds the real weapon in a real scene for its live preview, so this borrows
 * that: for each style it sets the hilt, reforges the preview through the
 * SHIPPED path, frames the camera on the hilt's own bounding box and reads the
 * canvas back. Every card is then a photograph of the object the game gives
 * you, lit the way the game lights it, and no two are alike because no two
 * hilts are.
 *
 *   node tools/hiltshots.mjs
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'assets', 'previews');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('  page error:', e.message.slice(0, 140)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
await page.click('.tab[data-tab="saber"]');
await page.waitForTimeout(3000);

const names = await page.evaluate(async () => {
  const S = await import('/src/game/Saber.js');
  return S.HILT_STYLES;
});

for (const name of names) {
  const shot = await page.evaluate(async (name) => {
    const m = window.SABER?.menu;
    const p = m?.preview;
    if (!p?.renderer) return { err: 'no preview' };
    m.s.hiltStyle = name;
    m._refreshPreview('saber');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const hilt = p.saber?.hilt;
    if (!hilt) return { err: 'no hilt built' };
    /* THE HILT ALONE. The live preview is a whole Jedi holding the weapon,
     * which is the right thing on the Forge tab and the wrong thing on a
     * 168 px card: at card size the figure is what you see and the hilt is a
     * speck in its fist. */
    const keep = new Set();
    hilt.traverse((o) => keep.add(o));
    for (let n = hilt.parent; n; n = n.parent) keep.add(n);
    const hidden = [];
    p.scene.traverse((o) => {
      if (keep.has(o) || !o.visible) return;
      if (o.isLight || o.isScene) return;
      if (o.isMesh || o.isSkinnedMesh || o.isPoints || o.isLine || o.isSprite) {
        hidden.push(o); o.visible = false;
      }
    });

    /**
     * REPARENTED TO THE SCENE ROOT, and it is safe because the preview rebuilds
     * the whole weapon on the next `_refreshPreview('saber')` call.
     *
     * The hilt hangs off the figure's hand, so it inherits a fist's pose, a
     * forearm's rotation and whatever the idle animation was doing that frame.
     * Framing a catalogue photograph through three inherited transforms is
     * guesswork; lifting it to the origin makes the pose an argument rather
     * than an accident.
     *
     * Laid along X and turned three-quarters: that is the angle a tool is
     * photographed at, because it shows the length, the round section and the
     * top face of the control box at once. Straight on hides the box, straight
     * down hides the length, and upright — which is how it hangs in the hand —
     * puts a long thin object across the short axis of a 3.12:1 card.
     */
    p.scene.add(hilt);
    hilt.position.set(0, 0, 0);
    hilt.rotation.set(0.30, 0.34, Math.PI / 2);
    hilt.scale.set(1, 1, 1);
    hilt.updateMatrixWorld(true);

    /* A KEY AND A FILL, cloned from whatever the preview already lights with,
     * so the metal reads. The scene's own lights are aimed at a standing
     * figure; an object alone at the origin sits in the dark between them. */
    const lamp = [];
    p.scene.traverse((o) => { if (o.isDirectionalLight && lamp.length < 1) lamp.push(o); });
    const added = [];
    if (lamp[0]) {
      const key = lamp[0].clone();
      key.position.set(0.5, 0.7, 1.0); key.intensity = (lamp[0].intensity || 1) * 2.1;
      key.castShadow = false;
      const fill = lamp[0].clone();
      fill.position.set(-0.8, 0.1, 0.4); fill.intensity = (lamp[0].intensity || 1) * 0.55;
      fill.castShadow = false;
      p.scene.add(key); p.scene.add(fill); added.push(key, fill);
    }
    // Bounding box without importing three: walk the geometry ourselves.
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    const v = { x: 0, y: 0, z: 0 };
    hilt.updateMatrixWorld(true);
    hilt.traverse((o) => {
      const g = o.geometry;
      if (!g || !g.attributes?.position) return;
      const pos = g.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 240));
      for (let i = 0; i < pos.count; i += step) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
        const e = o.matrixWorld.elements;
        const x = e[0]*v.x + e[4]*v.y + e[8]*v.z + e[12];
        const y = e[1]*v.x + e[5]*v.y + e[9]*v.z + e[13];
        const z = e[2]*v.x + e[6]*v.y + e[10]*v.z + e[14];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    });
    if (minX > maxX) return { err: 'empty hilt geometry' };
    const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2, czm = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    const cam = p.camera, r = p.renderer;
    const savedPos = cam.position.clone(), savedQ = cam.quaternion.clone();
    const savedFov = cam.fov, savedAspect = cam.aspect;
    const c = r.domElement;
    const savedW = c.width, savedH = c.height;
    const W = 512, H = 164;                      // the card's own 3.12:1
    r.setSize(W, H, false);
    cam.aspect = W / H;
    cam.fov = 26;
    /* Framed on the SPAN rather than on a fixed distance, so a 0.24 m Graflex
     * and a 0.34 m Warden both fill the card instead of one of them being a
     * speck and the other clipped. */
    /* Framed on the HORIZONTAL field, because a hilt is long and thin and the
     * card is 3.12:1: fitting it to the vertical field puts it a third of the
     * way across a very wide picture. */
    const vhalf = (cam.fov * Math.PI / 180) / 2;
    const hhalf = Math.atan(Math.tan(vhalf) * cam.aspect);
    const dist = (span * 0.80) / Math.tan(hhalf);
    cam.position.set(cxm, cym + dist * 0.16, czm + dist);
    cam.updateProjectionMatrix();
    cam.lookAt(cxm, cym, czm);
    cam.updateMatrixWorld(true);
    r.render(p.scene, cam);
    const data = c.toDataURL('image/jpeg', 0.88);

    r.setSize(savedW, savedH, false);
    cam.aspect = savedAspect; cam.fov = savedFov;
    cam.position.copy(savedPos); cam.quaternion.copy(savedQ);
    cam.updateProjectionMatrix();
    for (const o of added) p.scene.remove(o);
    for (const o of hidden) o.visible = true;
    return { data, span: +span.toFixed(3) };
  }, name);

  if (shot.err) { console.log(`${name.padEnd(12)} FAILED — ${shot.err}`); continue; }
  const buf = Buffer.from(shot.data.split(',')[1], 'base64');
  await writeFile(join(OUT, `hilt-${name}.jpg`), buf);
  console.log(`${name.padEnd(12)} ${(buf.length / 1024).toFixed(0)} kB  span ${shot.span} m`);
}
await browser.close(); server.close();
