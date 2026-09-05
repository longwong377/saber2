/* HOSTILE AUDIT — can a race actually be WATCHED? */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = []; page.on('pageerror', e=>errs.push(e.message.slice(0,200)));
await page.goto('file:///tmp/borz.html', { waitUntil:'domcontentloaded', timeout:180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout:300000 });
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout:300000 });

const out = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === 19) row = rec.place;
  if (!row) return { why: '#19 not on this deck' };
  w._station.hour = 15.06;              /* just before the 15.11 race */
  w.player.position.set(row.x, w.player.position.y, row.z);
  W.input.touchHitSet.add('focus');
  w.update(1/60, W.input); W.input.end?.();
  if (W.screens.state !== 'tote') return { why: `key left the game in '${W.screens.state}'` };
  const grab = () => (document.querySelector('#pane-tote')||document.querySelector('.pane')||document.body).textContent.replace(/\s+/g,' ').trim();
  const frames = [];
  const t0 = performance.now(); const h0 = w._station.hour;
  for (let i=0;i<40;i++) {
    await new Promise(r=>setTimeout(r, 1500));
    frames.push({ t: +((performance.now()-t0)/1000).toFixed(1), hour: +w._station.hour.toFixed(4), txt: grab().slice(0,150) });
  }
  return { why:null, h0, frames, real:(performance.now()-t0)/1000, hEnd:w._station.hour };
});
if (out.why) console.log('FAILED:', out.why);
else {
  const seen = new Set();
  for (const f of out.frames) { if (!seen.has(f.txt)) { seen.add(f.txt); console.log(`t=${f.t}s h=${f.hour}  ${f.txt}`); } }
  console.log(`\ndistinct panel renderings over ${out.real.toFixed(0)} real s: ${seen.size}`);
  const gs = (out.hEnd-out.h0)*120;
  console.log(`clock: ${gs.toFixed(1)} s of station time in ${out.real.toFixed(1)} real s = ${(gs/out.real*100).toFixed(1)}%`);
}
console.log(errs.length ? 'PAGE ERRORS: '+errs.slice(0,4).join(' | ') : 'no page errors');
await browser.close();
