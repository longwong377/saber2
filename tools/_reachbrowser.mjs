/**
 * REACH, REFUSAL, THE RUNNER AND THE SURVIVORS — IN A REAL BROWSER.
 *
 * Everything in tools/checks/reach.mjs runs headless against a stub world. This
 * boots the shipped page in Chromium, plays Command mode on Geonosis, and asks
 * the RUNNING GAME the same questions off its own director, its own bodies and
 * its own DOM. It is the only arm that can fail if the feature is in the source
 * and not in the game.
 */
import { createServer } from 'node:http';
import { readFile, stat as statP } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..', 'home/user/saber2');
const REAL = '/home/user/saber2';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(REAL, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(REAL) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', mode: 'command', quality: 'low', instantSpawn: true,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });

const out = await page.evaluate(async () => {
  const log = [];
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const spin = async (n) => { for (let i = 0; i < n; i++) await raf(); };

  // Start the game the way the menu does.
  const start = document.querySelector('#play, .menu-play, [data-action="play"]')
    || [...document.querySelectorAll('button')].find((b) => /play|start|deploy/i.test(b.textContent));
  if (start) start.click();
  for (let i = 0; i < 900 && !window.world?.command; i++) await raf();
  const w = window.world;
  if (!w) return { fail: 'the world never came up' };
  const d = w.command;
  if (!d) return { fail: 'command mode built no director' };

  await spin(180);
  const c = d.commander;
  const men = d.led(c).filter((t) => t.body && !t.body.dead);
  log.push(`mode ${w.settings?.mode} · level ${w.level?.id} · ${men.length} named men on the field`);
  log.push(`ORDER_REACH from the running module: ${d.constructor.name} — voices ${d._voices(c).length}`);

  // 1) an order at your feet lands.
  const near = d.order('line');
  log.push(`1) line, everybody formed up on me -> ${near} · refused ${d.orderRefused}`);

  // 2) walk a squad off the map and order it.
  const squads = d.squadsOf(c);
  const k = squads.length > 1 ? 1 : 0;
  const sq = squads[k];
  for (const t of sq) if (t.body) t.body.position.set(t.body.position.x + 200, t.body.position.y, t.body.position.z + 200);
  await spin(3);
  const far = d.order('charge', c, k);
  log.push(`2) charge to a squad 280 m out -> ${far} · "${d.orderRefused}"`);

  // 3) second press sends a man.
  w.time = (w.time || 0) + 1;
  const two = d.order('charge', c, k);
  const runner = d.led(c).find((t) => t.runner);
  log.push(`3) pressed again -> ${two} · runner ${runner ? runner.name + ' (' + runner.rankRec.short + ')' : 'NONE'}`);

  // 4) the notify actually reached the screen.
  const toast = document.body.innerText.match(/RUNNER AWAY|NOT TAKEN/g);
  log.push(`4) on screen: ${toast ? [...new Set(toast)].join(', ') : 'NOTHING'}`);

  // 5) the roster panel says who cannot hear me.
  d._earSig = null;
  await spin(40);
  const panel = document.querySelector('#rp-list, .rp-list')?.innerText
    || document.body.innerText;
  const ear = panel.match(/out of reach|\d+\/\d+ in earshot/gi);
  log.push(`5) roster panel: ${ear ? [...new Set(ear)].join(' · ') : 'says nothing about earshot'}`);

  // 6) circle always reaches.
  const back = d.order('circle');
  log.push(`6) circle with a squad 280 m out -> ${back} · formation now ${c.formation}`);

  // 7) survivors keep their bodies across a withdrawal.
  const before = d.led(c).filter((t) => t.body && !t.body.dead);
  const ids = before.map((t) => t.body.id ?? t.name);
  d.recall(null, { keepStanding: true });
  const after = d.led(c).filter((t) => t.body && !t.body.dead);
  log.push(`7) area-boundary withdrawal: ${before.length} standing -> ${after.length} standing, `
    + `same bodies ${after.every((t, i) => (t.body.id ?? t.name) === ids[i])}`);

  await spin(30);
  return { log, alive: !!w.player && w.player.alive !== false, frames: true };
});

console.log(out.fail ? 'FAILED: ' + out.fail : out.log.join('\n'));
if (out.log) console.log('player alive after all of it:', out.alive);
await page.screenshot({ path: '/tmp/reach-browser.png', timeout: 120000 }).catch((e) => console.log('shot:', e.message));
await browser.close();
server.close();
