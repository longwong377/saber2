import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
const { chromiumPath, CHROME_ARGS } = await import('./checks/_browser.mjs');
const { handler } = await import('./serve.mjs');
const say = (...a) => process.stdout.write(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');
const server = createServer(handler);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => say('PAGE ERROR:', e.message, '|', (e.stack || '').split('\n')[1] || ''));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') say('CONSOLE', m.type(), m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => say('REQ FAILED', r.url().slice(-90), r.failure()?.errorText));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate(() => ({
      saber: !!window.SABER,
      boot: document.getElementById('boot')?.className,
      step: document.querySelector('#boot .bootstep, #boot-step, #boot .step')?.textContent
        || document.getElementById('boot')?.innerText?.split('\n').filter(Boolean).slice(-2).join(' / '),
    }));
    if (i % 5 === 0 || st.saber) say(`t+${i + 1}s`, JSON.stringify(st));
    if (st.saber) break;
  }
} catch (e) { say('THREW:', e.message); }
finally { await page?.close().catch(()=>{}); await browser.close().catch(()=>{}); server.close(); }
say('DONE');
