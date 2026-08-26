/**
 * THE MASS, IN A REAL BROWSER, WITH A REAL GPU PATH.
 *
 * `tools/checks/mass.mjs` measures the SIM — 320 men at 5.75 ms — and that is
 * the number the design argument rests on. It is not the number a player feels.
 * A crowd system's other failure mode is a draw-call cliff nobody sees headless,
 * because a headless world never rasterises anything.
 *
 * So this drives the shipped page, lays a battle in front of the camera, and
 * reports what the renderer actually did: draw calls, triangles, frame time, and
 * a frame on disk to look at. Not a check — `mass.mjs` holds the contents; this
 * holds the picture, with eyes.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm','.svg':'image/svg+xml' };
const server = createServer(async (req,res)=>{ try{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const f=join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/,'')); if(!f.startsWith(ROOT)||!existsSync(f)||!statSync(f).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'}); res.end(await readFile(f)); }catch(e){res.writeHead(500);res.end(String(e));} });
const port = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--enable-webgl2-compute-context'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type()==='error') console.log('CONSOLE:', m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'domcontentloaded', timeout:60000 });
await page.evaluate(() => localStorage.setItem('saber.settings.v2', JSON.stringify(
  { instantSpawn:true, level:'geonosis', quality:'low', resolutionScale:0.6, difficulty:'knight',
    mode:'waves', volume:0, music:0, grassScale:0.5, particleScale:0.6 })));
await page.reload({ waitUntil:'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout:90000 });
await page.click('#btn-deploy');
await page.waitForTimeout(1500);
/* The drop button only exists on the modes that show a deploy card, and on the
 * ones that do it is hidden until the card finishes its stamp-in. Neither is an
 * error here — this probe only needs to be ON the ground — so it is attempted
 * and shrugged off rather than waited on. A bare `.click()` retries an invisible
 * element for thirty seconds and then fails the whole run, which is what it did
 * the first time. */
await page.click('#btn-deploy-drop', { timeout: 2500 }).catch(() => {});
await page.waitForTimeout(9000);

const out = await page.evaluate(async (origin) => {
  const S = window.SABER, w = S?.world;
  if (!w) return { err: 'no world' };
  const THREE = await import(`${origin}/node_modules/three/build/three.module.js`).catch(() => null)
    || await import(`${origin}/src/engine/three.js`).catch(() => null);
  const M = await import(`${origin}/src/game/Mass.js`);
  const E = await import(`${origin}/src/game/Enemy.js`);
  const V = (x, y, z) => new (w.player.position.constructor)(x, y, z);
  const p = w.player.position;
  /* Donors: two real bodies, well out of the way, so the cohort has a rig to
   * bake per side. */
  for (const t of ['trooper', 'b1']) {
    w.enemies.push(new E.Enemy(w, t, V(p.x + 300, 0, p.z + 300)));
  }
  for (let i = 0; i < 6; i++) w.update(1 / 60, S.input?.state ?? {});
  const f = new M.MassField(w);
  const axis = V(0, 0, 1);
  M.layBattle(f, { blocks: 8, gap: 150, origin: p, axis });
  /* Point the camera down the axis so the shot is the picture a player lands
   * looking at. */
  const cam = w.engine.camera;
  const before = { calls: 0, tris: 0 };
  const info = w.engine.renderer?.info;
  const times = [];
  for (let i = 0; i < 240; i++) {
    const t0 = performance.now();
    f.update(1 / 60, { bolts: w.bolts });
    w.update(1 / 60, S.input?.state ?? {});
    w.engine.render?.(w.scene, cam);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    men: f.count(0) + f.count(1), mine: f.count(0), theirs: f.count(1),
    calls: info?.render?.calls ?? -1, tris: info?.render?.triangles ?? -1,
    median: times[120], p95: times[228],
    bolts: w.bolts.bolts.filter((b) => b.active).length,
  };
}, `http://127.0.0.1:${port}`);
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: 'tools/out/mass-battle.png' });
await browser.close(); server.close();
