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
  page.on('pageerror', (e) => say('PAGE ERROR:', e.message));
  page.on('requestfailed', (r) => say('REQ FAILED', r.url().slice(-70), r.failure()?.errorText));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SABER, null, { timeout: 120000 });
  say('booted ok; error box shown?', await page.evaluate(() => !document.getElementById('boot-err').hidden));
  say('import map still in page:', await page.evaluate(() => !!document.querySelector('script[type=importmap]')));
  say('three loaded from:', await page.evaluate(() => {
    const s = [...document.querySelectorAll('script')].map(x => x.src).filter(Boolean);
    return s.length + ' script tags';
  }));
} catch (e) { say('THREW:', e.message); }
finally { await page?.close().catch(()=>{}); await browser.close().catch(()=>{}); server.close(); }
say('DONE');
