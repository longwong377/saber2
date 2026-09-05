/* Does the station have a second day — driven the way the GAME drives it.
 * `_dayprobe.mjs` pushes `st.hour += 4` and wraps it ITSELF, which is the one
 * thing the game never does: `tickStationClock` is the only writer of the hour
 * and the wrap is where the midnight is counted, so a probe that does its own
 * wrap eats the event before the game can see it. This drives the two shipped
 * doors instead: `world.update`, the frame loop, across a real midnight; and
 * `passStationHours`, which every ending calls with the run's own seconds. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,200)));
await page.goto('file:///tmp/borz8.html',{waitUntil:'domcontentloaded',timeout:180000});
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
  const fold = () => { try { const s=JSON.parse(localStorage.getItem('saber.station.v1')||'{}');
    return { hour:+(s.hour||0).toFixed(2), day:s.day, standing:s.standing }; } catch { return null; } };
  const rows = [];
  const at13 = () => { w._station.hour = 13; w.update(1/60, W.input); W.input.end?.(); };
  at13();
  rows.push({ how:'day as dressed, 13:00', fold:fold(), stHour:+w._station.hour.toFixed(2), stDay:w._station.day, shelf:shelf() });
  /* THREE MIDNIGHTS, each one crossed by the shipped frame loop. The hour is
   * then set back to 13:00 to read the shelf with the shop open — a clock set
   * BACK, which must not move the day, and does not. */
  for (let n=0;n<3;n++) {
    w._station.hour = 23.9;
    for (let i=0;i<900;i++) { w.update(1/60, W.input); W.input.end?.(); }
    const crossed = { day:w._station.day, hour:+w._station.hour.toFixed(3) };
    at13();
    rows.push({ how:`midnight ${n+1} (900 × world.update, then 13:00)`, fold:fold(),
      stHour:+w._station.hour.toFixed(2), stDay:w._station.day, shelf:shelf(),
      wrapped:`${crossed.hour} h at the wrap` });
  }
  return rows;
});
for (const r of out) console.log(`${String(r.how).padEnd(34)} fold ${JSON.stringify(r.fold)}  st.hour ${r.stHour}  st.day ${r.stDay}\n    shelf: ${r.shelf.slice(0,120)}`);
const shelves=out.map(r=>r.shelf); console.log('distinct shelves over 4 days:', new Set(shelves).size, 'of', shelves.length);

console.log(errs.length?'PAGE ERRORS: '+errs.slice(0,4).join(' | '):'no page errors');
await browser.close();
