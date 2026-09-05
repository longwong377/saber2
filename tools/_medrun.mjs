/* HOSTILE AUDIT — does the ward heal ACROSS a run, and does #51 answer a droid? */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,200)));
await page.goto('file:///tmp/borz.html',{waitUntil:'domcontentloaded',timeout:180000});
await page.waitForSelector('#menu:not(.hidden)',{timeout:300000});
await page.evaluate(() => window.SABER.enterStation({ deck: 48 }));
await page.waitForFunction(()=>!!window.SABER.world?._station,null,{timeout:300000});

const a = await page.evaluate(() => ({
  hourNow: window.SABER.world._station.hour,
  saved: JSON.parse(localStorage.getItem('saber.station.v1')||'{}').hour,
}));
console.log('station hour on arrival:', JSON.stringify(a));

/* #43 medbay door */
const med = await page.evaluate(async () => {
  const W=window.SABER,w=W.world; let fired=null;
  const was=w.onMedbay; w.onMedbay=(id)=>{fired=id; return false;};
  const said=[]; const wasN=w.notify; w.notify=(h,l)=>said.push(h+': '+l);
  for (const id of [43,44,51]) {
    let row=null; for(const rec of w._station.places.values()) if(rec.place.id===id) row=rec.place;
    if(!row) { said.push(`#${id} not on this deck`); continue; }
    w.player.position.set(row.x,w.player.position.y,row.z);
    W.input.touchHitSet.add('focus'); w.update(1/60,W.input); W.input.end?.();
  }
  w.notify=wasN; if(was) w.onMedbay=was; else delete w.onMedbay;
  return { fired, said };
});
console.log('doors:', JSON.stringify(med).slice(0,600));

/* the clock across a run */
const run = await page.evaluate(async () => {
  const W=window.SABER;
  const h0 = JSON.parse(localStorage.getItem('saber.station.v1')||'{}').hour;
  W.screens.clear(); W.resume();
  W.settings.instantSpawn=true; W.settings.mode='skirmish';
  await W.deploy();
  const w=W.world; if(!w?.player) return { why:'no deploy' };
  W.screens.clear(); W.resume(); w.paused=false;
  /* six real minutes of run time, simulated: 360 s -> 3 station hours */
  for (let i=0;i<60*360;i++){ w.update(1/60,W.input); W.input.end?.(); if (i>60*340) w.player.hp=0; if (w.over) break; }
  const t = w.time;
  await new Promise(r=>setTimeout(r,3000));
  const h1 = JSON.parse(localStorage.getItem('saber.station.v1')||'{}').hour;
  return { why:null, h0, h1, runSeconds: t, over: !!w.over };
});
console.log('ACROSS THE RUN:', JSON.stringify(run));
if (!run.why) console.log(`  station hour ${run.h0} -> ${run.h1} for ${run.runSeconds?.toFixed(0)} s of run = expected +${(run.runSeconds/120).toFixed(2)} h`);
console.log(errs.length?'PAGE ERRORS: '+errs.slice(0,4).join(' | '):'no page errors');
await browser.close();
