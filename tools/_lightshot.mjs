/**
 * WHAT THE MOODS ACTUALLY LOOK LIKE — V20 lane 1's proof.
 *
 * `_stationshot.mjs`'s method exactly: serve the real tree, boot the shipped
 * page, go through `SABER.enterStation`, resume the world by hand, then stand
 * the camera where a player would stand and shoot. The only thing this adds is
 * the STATION CLOCK: the cantina is shot at 02:00, 12:00 and 20:00 from the
 * same eye, so the three frames differ by nothing but the hour, and the
 * reactor hall on deck 48 is shot for the red.
 *
 * The floor shot is the point of the emissive half: the camera looks DOWN at
 * the plate beside a strip, where a glow decal and a pooled point light are
 * the only things that can put any light at all.
 *
 *   node tools/_lightshot.mjs /tmp/light
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = '/home/user/saber2/.claude/worktrees/agent-a7aa929e3034feeb2';
const OUT = process.argv[2] || '/tmp/light';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.smesh': 'application/octet-stream' };

const say = (m) => process.stderr.write(`▸ ${m}\n`);
say('start');
const { hold } = await import('./_lock.mjs');
say('waiting for the render lock');
await hold('lightshot');
say('lock held');
await mkdir(OUT, { recursive: true });

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
say(`serving on ${port}`);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
say('browser up');
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
let _pe = 0;
page.on('pageerror', (e) => {
  if (_pe++ > 3) return;
  console.log('PAGE ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 12).join('\n'));
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 220)); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'high', instantSpawn: true, allies: 0,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
say('waiting for the menu');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 150000 });

const enter = async (deck) => page.evaluate(async (d) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SABER;
  if (!S?.enterStation) return { fail: 'no SABER.enterStation' };
  window.__stationFail = null;
  S.enterStation({ n: d, label: 'light', level: 'station', deck: d }).catch((e) => { window.__stationFail = String(e); });
  for (let i = 0; i < 9000 && !(window.SABER?.world?._station?.deck === d); i++) await raf();
  const w = window.SABER?.world;
  if (w?._station?.deck !== d) return { fail: window.__stationFail || 'no station' };
  S.screens?.set?.('playing');
  S.resume?.();
  if (S.input) S.input.enabled = true;
  for (let i = 0; i < 90; i++) await raf();
  const st = w._station;
  return { deck: st.deck, places: st.places.size, decals: st.light?.decalCount ?? null,
    fixtures: st.light?.fixtures?.length ?? null, lamps: st.light?.lamps?.length ?? null,
    shadows: !!st.light?.shadows, statics: st.light?.statics ?? null };
}, deck);

const shot = async (name, at) => {
  const info = await page.evaluate(async (a) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const w = window.SABER?.world, p = w?.player, st = w?._station;
    if (!p || !st) return null;
    if (a.hour !== undefined) st.hour = a.hour;
    p.position.set(a.x, a.y, a.z);
    p.body?.position?.set?.(a.x, a.y, a.z);
    if (p.camera) { p.camera.yaw = a.yaw; p.camera.pitch = a.pitch || 0; }
    /* THE FADE IS SKIPPED, NOT WAITED OUT. Two seconds of crossfade is two
     * seconds of wall clock in the browser and about a hundred and twenty
     * frames of software rasterising here — an hour of shots to photograph a
     * transition nobody is asking to see. Six frames let `stepStationLight`
     * pick the new room and the new hour up and start the fade; `t = 1` puts
     * it at its end; the frames after that are the mood, settled. */
    for (let i = 0; i < 6; i++) await raf();
    if (st.light) st.light.t = 1;
    for (let i = 0; i < (a.settle ?? 6); i++) await raf();
    const L = st.light, rig = st.rig;
    return {
      at: L?.at, band: L?.band,
      key: rig ? `#${rig.key.color.getHexString()} @ ${rig.key.intensity.toFixed(2)}` : null,
      amb: rig ? rig.amb.intensity.toFixed(2) : null,
      strip: st.mats?.strip ? `#${st.mats.strip.emissive.getHexString()} @ ${st.mats.strip.emissiveIntensity.toFixed(2)}` : null,
      lamps: L?.lamps?.filter((l) => l.intensity > 0).length,
      casters: L?.casterCount,
      calls: window.SABER?.engine?.renderer?.info?.render?.calls ?? null,
    };
  }, at);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  say(`shot ${name} ${JSON.stringify(info)}`);
  console.log(name, JSON.stringify(info));
};

/* ── DECK 40: THE CANTINA AT THREE HOURS, AND THE FLOOR BESIDE A STRIP ──── */
say('deck 40');
const i40 = await enter(40);
console.log('deck40:', JSON.stringify(i40));
if (i40.fail) { await browser.close(); server.close(); process.exit(1); }

/* #14's own numbers, read out of the plan so the framing cannot drift. */
const cantina = await page.evaluate(() => {
  const st = window.SABER.world._station;
  const rec = [...st.places.values()].find((r) => r.place.id === 14);
  const p = rec.place;
  const f = window.SABER.world.floorAt(p.x, p.z);
  return { x: p.x, z: p.z, door: p.door, floor: f, yaw: Math.atan2(-(p.x - p.door[0]), -(p.z - p.door[1])) };
});
const eye = { x: cantina.door[0], y: cantina.floor + 1.7, z: cantina.door[1], yaw: cantina.yaw };
const inside = {
  x: cantina.x + (cantina.door[0] - cantina.x) * 0.35,
  y: cantina.floor + 1.7,
  z: cantina.z + (cantina.door[1] - cantina.z) * 0.35,
  yaw: cantina.yaw,
};
for (const [h, tag] of [[2, '02'], [12, '12'], [20, '20']]) {
  await shot(`cantina-${tag}00`, { ...eye, hour: h, pitch: 0 });
  await shot(`cantina-${tag}00-in`, { ...inside, hour: h, pitch: -0.18 });
}
/* THE FLOOR. Looking down at the plate under the ring's soffit strips, which
 * is where a decal and a pooled lamp are the only light there is. */
await shot('floor-ring-0200', { x: 0, y: 1.7, z: 80, yaw: Math.PI / 2, pitch: -0.55, hour: 2 });
await shot('floor-ring-1200', { x: 0, y: 1.7, z: 80, yaw: Math.PI / 2, pitch: -0.55, hour: 12 });

/* ── DECK 48: THE REACTOR HALL ──────────────────────────────────────────── */
say('deck 48');
const i48 = await enter(48);
console.log('deck48:', JSON.stringify(i48));
if (!i48.fail) {
  const reactor = await page.evaluate(() => {
    const st = window.SABER.world._station;
    const rec = [...st.places.values()].find((r) => r.place.id === 48);
    if (!rec) return null;
    const p = rec.place;
    return { x: p.x, z: p.z, door: p.door, floor: window.SABER.world.floorAt(p.x, p.z),
      yaw: Math.atan2(-(p.x - p.door[0]), -(p.z - p.door[1])) };
  });
  if (reactor) {
    await shot('reactor-1200', { x: reactor.door[0], y: reactor.floor + 1.7, z: reactor.door[1], yaw: reactor.yaw, pitch: 0, hour: 12 });
    await shot('reactor-0200', { x: reactor.door[0], y: reactor.floor + 1.7, z: reactor.door[1], yaw: reactor.yaw, pitch: -0.4, hour: 2 });
  }
}

await browser.close();
server.close();
say('done');
