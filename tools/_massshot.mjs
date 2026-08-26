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

/**
 * THE BATTLE IS HOOKED INTO THE GAME'S OWN FRAME, not driven from here.
 *
 * The first version called `world.update(1/60, {})` in a loop and died on
 * `input?.act is not a function` — correctly. The page already has a running
 * rAF loop with the real input object in it, and a second driver would be a
 * second clock: every body would be stepped twice a frame and every number
 * taken off it would be about a world nobody is playing. So the probe installs
 * one hook and then simply waits, exactly as a player does.
 */
/**
 * …AND THE RUN HAS TO STILL BE RUNNING WHEN WE MEASURE IT.
 *
 * `main.js` pauses the game the moment pointer lock is lost, which is right for
 * a player alt-tabbing and fatal for a headless probe: the first run of this
 * file collected FOUR frames in ten seconds and reported a 45 ms median off
 * them. A number taken from a paused game is not a slow number, it is not a
 * number at all — and it is the same artifact that silently froze an earlier
 * investigation at `world.time = 0` with a full spawn queue.
 *
 * Unpaused from the page rather than by editing the game: the probe holds the
 * run open the way a played session does.
 */
await page.evaluate(() => {
  const S = window.SABER;
  if (S?.input) S.input.onLockChange = () => {};
  S?.menu?.resume?.();
  document.getElementById('pause')?.classList.add('hidden');
});

/**
 * WHAT THE RENDERER ACTUALLY DID, WITH AND WITHOUT THE BATTLE.
 *
 * Two earlier shapes of this probe tried to measure a FRAME TIME and both
 * failed honestly: the page collected three or four frames in ten seconds,
 * because a headless run without pointer lock is not a running game. A median
 * taken off four frames is not a slow number, it is not a number.
 *
 * So this measures the thing that is trustworthy off a single drawn frame and
 * is the one the design argument actually rests on: DRAW CALLS. The claim for
 * the instanced tier is that its cost stops depending on how many men there
 * are, and a draw-call count before and after laying three hundred and twenty
 * of them is exactly that claim, stated in the renderer's own numbers.
 *
 * Frame time on this box is swiftshader — software rasterisation with no GPU
 * behind it — so it would not be a number about a player's machine even if the
 * loop were running. `tools/checks/mass.mjs` holds the SIM cost, which is CPU
 * and is comparable.
 */
const read = () => page.evaluate(() => {
  const r = window.SABER?.world?.engine?.renderer?.info?.render;
  return { calls: r?.calls ?? -1, tris: r?.triangles ?? -1 };
});

const before = await read();

await page.evaluate(async (origin) => {
  const S = window.SABER, w = S.world;
  const M = await import(`${origin}/src/game/Mass.js`);
  const E = await import(`${origin}/src/game/Enemy.js`);
  const p = w.player.position;
  const V = (x, y, z) => new (p.constructor)(x, y, z);
  /* Donors: one real body per side, parked far out, so the cohort has a rig to
   * bake a merged skin from. See `MassField._donorFor`. */
  for (const t of ['trooper', 'b1']) w.enemies.push(new E.Enemy(w, t, V(p.x + 300, 0, p.z + 300)));
  const f = new M.MassField(w);
  window.__mass = f;
  M.layBattle(f, { blocks: 8, gap: 150, origin: p, axis: V(0, 0, 1) });
  /* One step, so the cohort joins land and the instances are written before
   * anything is counted. */
  f.update(1 / 60, { bolts: w.bolts });
}, `http://127.0.0.1:${port}`);

await page.waitForTimeout(2500);
const after = await read();

const out = await page.evaluate(() => {
  const f = window.__mass;
  const w = window.SABER.world;
  const bins = [...w.cohorts.cohorts.values()].filter(Boolean)
    .reduce((a, c) => a + c.meshes.length, 0);
  return {
    men: f.count(0) + f.count(1),
    ranks: f.ranks.length,
    instanced: f.ranks.reduce((a, r) => a + r.men.filter((m) => m._l3).length, 0),
    cohortBins: bins,
    realBodies: w.enemies.filter((e) => !e.dead).length,
  };
});
console.log(JSON.stringify({
  ...out,
  drawCalls: { before: before.calls, after: after.calls, added: after.calls - before.calls },
  triangles: { before: before.tris, after: after.tris, added: after.tris - before.tris },
}, null, 2));

await page.screenshot({ path: 'tools/out/mass-battle.png' });
await browser.close(); server.close();
