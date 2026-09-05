/* HOSTILE AUDIT — does the station ever have a second day? */
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
  const W=window.SABER, w=W.world;
  const shelf = () => {
    let row=null; for(const rec of w._station.places.values()) if(rec.place.id===9) row=rec.place;
    w.player.position.set(row.x, w.player.position.y, row.z);
    W.input.touchHitSet.add('focus'); w.update(1/60,W.input); W.input.end?.();
    const t=(document.getElementById('counter')?.innerText||'').replace(/\s+/g,' ').slice(0,180);
    W.screens.clear(); W.resume(); w.paused=false; W.input.enabled=true;
    return t;
  };
  const readDay = () => { try { const s=JSON.parse(localStorage.getItem('saber.station.v1')||'{}');
    return { hour:s.hour, seen:(s.seen||[]).length }; } catch { return null; } };
  const a = { at: readDay(), shelf: shelf(), stHour: w._station.hour, stDay: w._station.day };
  /* drive the game's own loop for 72 station hours: 72*120 = 8640 s = 518400 frames.
     Cheaper: push the clock through tickStationClock the way the tote panel does. */
  for (let i=0;i<20;i++) {
    w._station.hour += 4;                    /* four hours a step */
    while (w._station.hour >= 24) w._station.hour -= 24;
    w.update(1/60, W.input); W.input.end?.();   /* lets stepStation publish st.day + save */
  }
  const b = { at: readDay(), shelf: shelf(), stHour: w._station.hour, stDay: w._station.day };
  return { a, b, same: a.shelf === b.shelf };
});
console.log('BEFORE 80 station hours:', JSON.stringify(out.a).slice(0,400));
console.log('AFTER  80 station hours:', JSON.stringify(out.b).slice(0,400));
console.log('shelf identical:', out.same);
console.log(errs.length?'PAGE ERRORS: '+errs.slice(0,4).join(' | '):'no page errors');
await browser.close();
