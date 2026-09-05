/* Does the seam keep moving while the main thread is blocked? */
import { chromiumPath, CHROME_ARGS } from './checks/_browser.mjs';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
/* A 2x2 checker as the "still", so a drift of a few pixels is visible. */
const still = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">
   <rect width="8" height="8" fill="#204060"/><rect width="4" height="4" fill="#c0d8f0"/>
   <rect x="4" y="4" width="4" height="4" fill="#c0d8f0"/></svg>`).toString('base64');
await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
  <div id="loading" class="screen still seam" style="background-image:url('${still}')">
    <div class="seam-lights"></div><div class="load-wrap"><div class="boot-msg"></div></div>
  </div></body></html>`);
await page.waitForTimeout(300);
const anims = await page.evaluate(() => document.getAnimations().map((a) => ({
  name: a.animationName, state: a.playState })));
const a = await page.screenshot();
/* Block the main thread hard — nothing rAF-driven can run for this long. */
await page.evaluate(() => { const t = Date.now(); while (Date.now() - t < 1400); });
const b = await page.screenshot();
let diff = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
console.log('animations:', JSON.stringify(anims));
console.log('screenshot bytes differing across a 1.4 s main-thread block:', diff,
  diff > 0 ? '=> the seam kept moving' : '=> FROZEN');
await browser.close();
