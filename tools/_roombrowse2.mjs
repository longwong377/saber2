import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await page.goto('file:///tmp/roomprobe.html', { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
page.evaluate(() => { window.SABER.enterStation(); }).catch(() => {});
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 600000 });
console.log('station up');
await page.evaluate(() => {
  window.__raf = 0;
  const tick = () => { window.__raf++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.SABER.world.onHolodeck();
});
console.log('rAF while the pane is up:', JSON.stringify(await page.evaluate(async () => {
  const a = window.__raf; await new Promise((r) => setTimeout(r, 5000));
  return { frames: window.__raf - a, fps: window.SABER.fps };
})));
await page.evaluate(() => document.querySelector('#holodeck button.buy[data-id="ground:alpine"]').click());
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => ({ raf: window.__raf, fps: window.SABER.fps,
    level: window.SABER.world?.levelKey, state: window.SABER.screens?.state,
    sub: document.getElementById('holodeck')?.querySelector('.sub')?.textContent?.slice(0, 60),
    loading: !!document.querySelector('#loading:not(.hidden)') }));
  console.log(`t=${i * 15}s`, JSON.stringify(s));
  if (s.level === 'alpine') break;
  await page.waitForTimeout(15000);
}
console.log('errors:', errs.slice(0, 5));
await browser.close();
