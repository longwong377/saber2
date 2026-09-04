/* Does the packed single file actually reach the front screen? A pack that
 * writes 29 MB and throws on load is a build nobody can play, and the pack
 * tool cannot tell — it never runs what it wrote. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 200)); });
await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 240000 });
  console.log('FRONT SCREEN UP');
} catch (e) { console.log('NO FRONT SCREEN:', e.message.split('\n')[0]); }
const info = await page.evaluate(() => ({
  saber: !!window.SABER, station: typeof window.SABER?.enterStation,
  menuHidden: document.getElementById('menu')?.classList.contains('hidden'),
  boot: document.getElementById('loading')?.className || '',
}));
console.log(JSON.stringify(info));
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 6).join('\n') : 'no page errors');
await browser.close();
