/**
 * WHERE ARE THE ENEMIES — the real page, the real deploy, the real camera.
 *
 * "command mode never has any enemies show up?" The headless harness spawns
 * them 3 m from the player, and the browser HUD says "49 HOSTILES LEFT" over a
 * frame with nothing in it. Both cannot be right about what the player sees.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm','.svg':'image/svg+xml' };
const server = createServer(async (req,res)=>{ try{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.play.html';
  const f=join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/,'')); if(!f.startsWith(ROOT)||!existsSync(f)||!statSync(f).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'}); res.end(await readFile(f)); }catch(e){res.writeHead(500);res.end(String(e));} });
const port = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--enable-webgl2-compute-context'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const mode = process.argv[2] || 'command';
const arg3 = process.argv[3] || '';
const instant = arg3 !== 'fly';
const pure = arg3 === 'pure';
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'domcontentloaded', timeout:45000 });
await page.evaluate(([mode,instant,pure])=>{ localStorage.setItem('saber.settings.v2', JSON.stringify(
  pure ? { mode, volume:0, music:0 }
       : { instantSpawn:instant, level:'geonosis', quality:'low', resolutionScale:0.6, difficulty:'knight', mode,
           volume:0, music:0, grassScale:0.5, particleScale:0.6 })); }, [mode,instant,pure]);
await page.reload({ waitUntil:'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout:60000 });
await page.click('#btn-deploy');
await page.waitForTimeout(1500);
const drop = await page.$('#btn-deploy-drop');
if (drop) { await drop.click(); }
await page.waitForTimeout(instant ? 6000 : 45000);
const report = await page.evaluate(async () => {
  const S = window.SABER;
  const w = S?.world;
  if (!w) return { err: 'no world on window.SABER' };
  const cam = w.engine?.camera;
  const p = w.player;
  const live = w.enemies.filter((e) => !e.dead);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const ds = live.map((e) => dist(e.position, p.position)).sort((a, b) => a - b);
  /* Plain arithmetic rather than THREE, which the page does not export: how
   * many live bodies are in FRONT of the camera and inside its horizontal fov. */
  let onScreen = 0;
  if (cam) {
    cam.updateMatrixWorld(true);
    const m = cam.matrixWorld.elements;
    const cx = m[12], cy = m[13], cz = m[14];
    const fx = -m[8], fy = -m[9], fz = -m[10];            // camera forward
    const halfV = (cam.fov * Math.PI / 180) / 2;
    const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
    for (const e of live) {
      const vx = e.position.x - cx, vy = e.position.y - cy, vz = e.position.z - cz;
      const len = Math.hypot(vx, vy, vz) || 1;
      const cosA = (vx * fx + vy * fy + vz * fz) / len;
      if (cosA > Math.cos(Math.max(halfH, halfV))) onScreen++;
    }
  }
  return {
    mode: w.settings?.mode, wave: w.director?.wave, active: w.director?.active,
    liveEnemies: live.length, everSpawned: w.enemies.length,
    nearest: ds.slice(0, 5).map((d) => +d.toFixed(1)),
    median: ds.length ? +ds[(ds.length / 2) | 0].toFixed(1) : null,
    farthest: ds.length ? +ds[ds.length - 1].toFixed(1) : null,
    onScreen,
    playerPos: p ? [p.position.x, p.position.y, p.position.z].map((n) => +n.toFixed(1)) : null,
    commandVersus: !!w.settings?.commandVersus,
    hasCommand: !!w.command, versus: !!w.command?.versus,
    campaign: !!w.campaign, skirmish: !!w.skirmish,
    riding: !!(p?.riding || p?.aboard), instantSpawn: !!w.settings?.instantSpawn,
    allies: (w.company?.troops?.length ?? w.company?.roster?.length ?? null),
    cohorts: w.cohorts ? (w.cohorts.count ?? w.cohorts.total ?? w.cohorts.figures ?? 'present') : null,
    fallen: w.fallen ? (w.fallen.count ?? 'present') : null,
    front: !!w.front,
    drawCalls: w.engine?.renderer?.info?.render?.calls ?? null,
    triangles: w.engine?.renderer?.info?.render?.triangles ?? null,
    level: w.levelKey, wavesLeft: w.director?.left ?? null,
    hud: (document.querySelector('#hud')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
  };
});
console.log(JSON.stringify(report, null, 1));
await page.screenshot({ path: join(ROOT, '.smoke', `where-${mode}-${instant?'instant':'fly'}.png`) });
await browser.close(); server.close();
