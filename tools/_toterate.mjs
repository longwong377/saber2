/* HOSTILE AUDIT — how fast does the station clock run while you WATCH a race? */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
console.log('station up');

const out = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === 18) row = rec.place;
  if (!row) return { why: '#18 not on this deck' };
  w.player.position.set(row.x, w.player.position.y, row.z);
  W.input.touchHitSet.add('focus');
  /* one frame of the game's own loop, as _warpkey does */
  w.update(1/60, W.input); W.input.end?.();
  const state = W.screens.state;
  const h0 = w._station.hour;
  const t0 = performance.now();
  const seen = new Set();
  const html0 = document.querySelector('#tote-pane, .pane')?.textContent?.slice(0,120) || '';
  let renders = 0;
  const el = document.querySelector('#pane-tote') || document.body;
  await new Promise((r) => setTimeout(r, 12000));
  const h1 = w._station.hour;
  const t1 = performance.now();
  const html1 = document.querySelector('#tote-pane, .pane')?.textContent?.slice(0,120) || '';
  return { why: null, state, h0, h1, real: (t1 - t0) / 1000, html0, html1,
    same: html0 === html1 };
});
if (out.why) console.log('FAILED:', out.why);
else {
  const gameSecs = (out.h1 - out.h0) * 120;   // 1 station hour = 120 real s
  console.log(`screens.state after the key: ${out.state}`);
  console.log(`station hour ${out.h0.toFixed(5)} -> ${out.h1.toFixed(5)} over ${out.real.toFixed(2)} real s`);
  console.log(`  = ${gameSecs.toFixed(2)} s of station time for ${out.real.toFixed(2)} s of real time`);
  console.log(`  RATE: ${(gameSecs / out.real * 100).toFixed(1)}% of real time`);
  console.log(`panel text changed while watching: ${!out.same}`);
  console.log(`  before: ${out.html0}`);
  console.log(`  after : ${out.html1}`);
}
console.log(errs.length ? 'PAGE ERRORS: ' + errs.slice(0,4).join(' | ') : 'no page errors');
await browser.close();
