/* HOSTILE AUDIT — take a job, do a run, come back for the money. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,200)));
await page.goto('file:///tmp/borz.html',{waitUntil:'domcontentloaded',timeout:180000});
await page.waitForSelector('#menu:not(.hidden)',{timeout:300000});
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(()=>!!window.SABER.world?._station,null,{timeout:300000});
const out = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  const raw = () => { try { return JSON.parse(localStorage.getItem('saber.work.v1')||'null'); } catch { return 'unreadable'; } };
  /* find the room offering a job today, stand there, press the key */
  let got=null, at=null;
  w.onQuest = (b) => { got=b; return false; };  /* false so the panel does not take the screen */
  for (const rec of w._station.places.values()) {
    w.player.position.set(rec.place.x, w.player.position.y, rec.place.z);
    W.input.touchHitSet.add('focus');
    w.update(1/60, W.input); W.input.end?.();
    if (got) { at = rec.place.id; break; }
  }
  delete w.onQuest;
  if (!got) return { why: 'no room on this deck offered a job' };
  const before = raw();
  return { why:null, at, name:got.name, offers:got.offers.length, first:got.offers[0], before,
    keys: Object.keys(localStorage) };
});
console.log(JSON.stringify(out, null, 1).slice(0, 1200));
await browser.close();
