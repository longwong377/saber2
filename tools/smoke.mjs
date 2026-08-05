/**
 * Headless smoke test: boot the game, deploy, play for a few seconds of
 * simulated input, and report every console error, page error and failed
 * request along the way. Also grabs screenshots so the frame can be eyeballed.
 *
 *   node tools/smoke.mjs [--shots] [--seconds 6] [--level dunes]
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = process.env.SMOKE_OUT || join(ROOT, '.smoke');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);

const SECONDS = parseFloat(flag('seconds', '6'));
const LEVEL = flag('level', 'dunes');
const QUALITY = flag('quality', 'medium');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const url = `http://127.0.0.1:${port}/`;
console.log('serving', ROOT, '→', url);

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--enable-webgl2-compute-context',
    '--disable-features=IsolateOrigins,site-per-process',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const warnings = [];
const logs = [];
page.on('console', (m) => {
  const text = `${m.type()}: ${m.text()}`;
  if (m.type() === 'error') errors.push(text);
  else if (m.type() === 'warning') warnings.push(text);
  else logs.push(text);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));

const step = async (name, fn) => {
  process.stdout.write(`▸ ${name} … `);
  try { const r = await fn(); console.log('ok'); return r; }
  catch (e) { console.log('FAILED'); errors.push(`step "${name}": ${e.message}`); return null; }
};

await step('load', async () => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
});

await step('preset settings', async () => {
  await page.evaluate(([level, quality]) => {
    localStorage.setItem('saber.settings.v1', JSON.stringify({
      level, quality, resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6,
    }));
  }, [LEVEL, QUALITY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
});

await step('boot completes', async () => {
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 60000 });
});

if (has('shots')) await page.screenshot({ path: join(OUT, '01-menu.png') });

await step('saber forge tab renders', async () => {
  await page.click('.tab[data-tab="saber"]');
  await page.waitForTimeout(900);
  if (has('shots')) await page.screenshot({ path: join(OUT, '02-forge.png') });
  await page.click('.tab[data-tab="play"]');
});

await step('deploy', async () => {
  await page.click('#btn-deploy');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(1600);
});

if (has('shots')) await page.screenshot({ path: join(OUT, '03-deployed.png') });

await step('report boot diagnostics', async () => {
  const info = await page.evaluate(() => {
    const w = window.SABER?.world;
    return {
      fps: window.SABER?.fps,
      hasWorld: !!w,
      enemies: w?.enemies.length ?? -1,
      props: w?.props.length ?? -1,
      bodies: w?.physics.bodies.length ?? -1,
      statics: w?.physics.staticBoxes.length ?? -1,
      terrainVerts: w?.terrain?.geometry.attributes.position.count ?? -1,
      drawCalls: window.SABER?.engine.renderer.info.render.calls,
      triangles: window.SABER?.engine.renderer.info.render.triangles,
      wave: w?.director.wave,
    };
  });
  console.log('   ', JSON.stringify(info));
});

await step('simulate combat', async () => {
  // The page is not pointer-locked in headless, so drive the sim directly:
  // feed the input layer synthetic mouse deltas and keys the way the browser would.
  await page.evaluate((secs) => {
    const S = window.SABER;
    S.input.locked = true;             // pretend we hold the pointer
    S.input.enabled = true;
    window.__SMOKE_T = 0;
    window.__SMOKE_ERR = null;
    window.__SMOKE_DONE = false;
    const tick = () => {
      try {
        const t = (window.__SMOKE_T += 1 / 60);
        S.input.mouse.dx += Math.sin(t * 5.1) * 26;
        S.input.mouse.dy += Math.sin(t * 3.3 + 1) * 16;
        if (Math.floor(t * 2) % 3 === 0) S.input.keys.add('KeyW'); else S.input.keys.delete('KeyW');
        if (Math.floor(t * 1.5) % 4 === 1) S.input.keys.add('KeyA'); else S.input.keys.delete('KeyA');
        if (t % 2.4 < 0.02) S.input.pressed.add('Space');
        if (t % 3.7 < 0.02) S.input.pressed.add('KeyF');
        if (t % 5.2 < 0.02) S.input.pressed.add('KeyR');
        if (t < secs) { requestAnimationFrame(tick); return; }
      } catch (e) {
        window.__SMOKE_ERR = (e && e.stack) || String(e);
      }
      S.input.keys.clear();
      window.__SMOKE_DONE = true;
    };
    tick();
  }, SECONDS);
  try {
    await page.waitForFunction(() => window.__SMOKE_DONE === true, { timeout: (SECONDS + 20) * 1000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      t: window.__SMOKE_T, err: window.__SMOKE_ERR, done: window.__SMOKE_DONE,
      fps: window.SABER?.fps, alive: !!window.SABER?.world?.player?.alive,
    })).catch(() => null);
    throw new Error(`${e.message} | diag=${JSON.stringify(diag)}`);
  }
  const err = await page.evaluate(() => window.__SMOKE_ERR);
  if (err) throw new Error('inside the sim loop: ' + err);
});

if (has('shots')) await page.screenshot({ path: join(OUT, '04-combat.png') });

await step('force a spawn wave and cut something', async () => {
  const res = await page.evaluate(async () => {
    const w = window.SABER.world;
    const p = w.player;
    const THREE = w.player.position.constructor;
    // put a droid inside the blade's reach and swing through it
    const spawn = p.position.clone();
    spawn.x += 1.1;
    const e = w.spawnEnemy('b1', spawn);
    await new Promise(r => setTimeout(r, 60));
    const before = { hp: e.hp, severed: e.actor?.severedCount ?? 0 };
    // drive the blade physically across the target for a second
    for (let i = 0; i < 90; i++) {
      window.SABER.input.mouse.dx += 60 * Math.sin(i * 0.4);
      window.SABER.input.mouse.dy += 40 * Math.cos(i * 0.31);
      await new Promise(r => requestAnimationFrame(r));
    }
    return {
      before, hpAfter: e.hp, dead: e.dead,
      severed: e.actor?.severedCount ?? 0,
      pieces: e.actor?.pieces.length ?? 0,
      ragdolled: !!e.actor?.ragdolled,
      bodies: w.physics.bodies.length,
    };
  });
  console.log('   ', JSON.stringify(res));
});

await step('bolts and deflection path', async () => {
  const res = await page.evaluate(async () => {
    const w = window.SABER.world;
    const p = w.player;
    const dir = p.chest.clone().sub(p.chest.clone()).set(0, 0, 0);
    // fire a volley straight at the player from a few metres out
    let fired = 0;
    for (let i = 0; i < 12; i++) {
      const from = p.chest.clone();
      from.x += Math.cos(i) * 7;
      from.z += Math.sin(i) * 7;
      const d = p.chest.clone().sub(from).normalize();
      if (w.bolts.fire(from, d, { speed: 26, damage: 5, team: 1 })) fired++;
    }
    const hp0 = p.hp;
    for (let i = 0; i < 70; i++) {
      window.SABER.input.mouse.dx += 55 * Math.sin(i * 0.5);
      window.SABER.input.mouse.dy += 45 * Math.cos(i * 0.37);
      await new Promise(r => requestAnimationFrame(r));
    }
    return { fired, deflects: p.deflects, hpLost: +(hp0 - p.hp).toFixed(1), flow: +p.flow.toFixed(2) };
  });
  console.log('   ', JSON.stringify(res));
});

await step('perf sample', async () => {
  const perf = await page.evaluate(async () => {
    const S = window.SABER;
    const samples = [];
    for (let i = 0; i < 90; i++) {
      const t = performance.now();
      await new Promise(r => requestAnimationFrame(r));
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    return {
      medianMs: +samples[45].toFixed(2),
      p95Ms: +samples[85].toFixed(2),
      physicsMs: +(S.world.physics.stats.ms).toFixed(2),
      bodies: S.world.physics.stats.bodies,
      contacts: S.world.physics.stats.contacts,
      drawCalls: S.engine.renderer.info.render.calls,
      triangles: S.engine.renderer.info.render.triangles,
      enemies: S.world.enemies.length,
    };
  });
  console.log('   ', JSON.stringify(perf));
});

if (has('shots')) await page.screenshot({ path: join(OUT, '05-final.png') });

await browser.close();
server.close();

console.log('\n──────── result ────────');
if (warnings.length) {
  console.log(`${warnings.length} warning(s):`);
  for (const w of [...new Set(warnings)].slice(0, 12)) console.log('  ⚠', w.slice(0, 300));
}
if (errors.length) {
  console.log(`\n${errors.length} ERROR(S):`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ✖', e.slice(0, 900));
  process.exit(1);
}
console.log('clean — no console errors, no page errors, no failed requests');
