/** Why does the shipped page not produce a world after Deploy? Diagnostics. */
import { createServer } from 'node:http';
import { handler } from './serve.mjs';
import { chromium } from 'playwright-core';
import { chromiumPath, CHROME_ARGS } from './checks/_browser.mjs';

const server = createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.menu-tabs .tab').length >= 7, null, { timeout: 120000 });
console.log('menu up. SABER keys:', await page.evaluate(() => Object.keys(window.SABER || {})));
console.log('physics at menu time:', JSON.stringify(await page.evaluate(async () => {
  const m = await import('/src/physics/Rapier.js');
  const before = m.physicsReady();
  const again = await m.initPhysics();
  return { before, afterAwait: m.physicsReady(), got: again ? 'module' : String(again) };
})));
const out = await page.evaluate(async () => {
  const tick = () => new Promise((r) => requestAnimationFrame(r));
  const btn = document.querySelector('#btn-deploy');
  const log = [];
  if (!btn) return { log: ['no #btn-deploy'] };
  btn.click();
  for (let i = 0; i < 90; i++) {
    await tick();
    if (i % 30 === 0 || window.SABER?.world) {
      const l = document.getElementById('loading');
      log.push(`f${i} world=${!!window.SABER?.world} loading=${l ? !l.classList.contains('hidden') : 'none'}`
        + ` menuHidden=${document.getElementById('menu')?.classList.contains('hidden')}`
        + ` bootHidden=${document.getElementById('boot')?.classList.contains('hidden')}`
        + ` keys=${Object.keys(window.SABER || {}).join('|')}`);
    }
    if (window.SABER?.world) break;
  }
  return { log };
});
for (const l of out.log) console.log(l);
console.log('errors:', errs.slice(0, 8).join('\n  ') || 'none');
await browser.close();
await new Promise((r) => server.close(r));
