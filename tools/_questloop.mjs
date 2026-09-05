/* HOSTILE AUDIT — take a job through the panel, play a run, come back for the money. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,200)));
await page.goto('file:///tmp/borz.html',{waitUntil:'domcontentloaded',timeout:180000});
await page.waitForSelector('#menu:not(.hidden)',{timeout:300000});
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(()=>!!window.SABER.world?._station,null,{timeout:300000});

/* 1 — press the key in the room that is offering, and CLICK the take button */
const took = await page.evaluate(async () => {
  const W=window.SABER, w=W.world;
  let found=false;
  for (const rec of w._station.places.values()) {
    if (rec.place.id !== 7) continue;
    w.player.position.set(rec.place.x, w.player.position.y, rec.place.z);
    W.input.touchHitSet.add('focus'); w.update(1/60,W.input); W.input.end?.();
    found = W.screens.state === 'work';
  }
  if (!found) return { why:`state was '${W.screens.state}'` };
  const btn = document.querySelector('#work button.take');
  if (!btn) return { why:'no take button on the board', html: document.querySelector('#work')?.innerHTML?.slice(0,300) };
  btn.click();
  await new Promise(r=>setTimeout(r,80));
  const raw = JSON.parse(localStorage.getItem('saber.work.v1')||'null');
  return { why:null, raw, said: document.querySelector('#work')?.textContent?.slice(0,220) };
});
console.log('TAKE:', JSON.stringify(took).slice(0,700));
if (took.why) { await browser.close(); process.exit(1); }

/* 2 — leave the station, play a skirmish, and end it with a real death */
const ran = await page.evaluate(async () => {
  const W=window.SABER;
  W.screens.clear(); W.resume();
  W.settings.instantSpawn = true;
  W.settings.mode='skirmish';
  await W.deploy();
  const w=W.world;
  if (!w?.player) return { why:'the run did not deploy' };
  W.screens.clear(); W.resume(); w.paused=false;
  let kills=0;
  for (let i=0;i<3600 && !w.over;i++){ w.player.hp=0; w.update(1/60,W.input); W.input.end?.(); }
  kills = w.players.reduce((a,p)=>a+(p.kills||0),0);
  await new Promise(r=>setTimeout(r,3000));
  return { why:null, over:!!w.over, state:W.screens.state, kills, wave:w.director?.wave??null,
    work: JSON.parse(localStorage.getItem('saber.work.v1')||'null'),
    credits: JSON.parse(localStorage.getItem('saber.credits.v1')||'null') };
});
console.log('AFTER THE RUN:', JSON.stringify(ran).slice(0,900));

/* 3 — go back to the station and see whether anybody owes you anything */
const back = await page.evaluate(async () => {
  const W=window.SABER;
  await W.enterStation();
  await new Promise(r=>setTimeout(r,2500));
  const w=W.world;
  let board=null;
  w.onQuest = (b)=>{ board=b; return false; };
  for (const rec of w._station.places.values()) {
    if (rec.place.id!==7) continue;
    w.player.position.set(rec.place.x, w.player.position.y, rec.place.z);
    W.input.touchHitSet.add('focus'); w.update(1/60,W.input); W.input.end?.();
  }
  delete w.onQuest;
  return board ? { carrying: board.carrying.length, owed: board.owed.length, offers: board.offers.length }
    : { why:'the board did not open on the way back' };
});
console.log('BACK AT #7:', JSON.stringify(back));
console.log(errs.length?'PAGE ERRORS: '+errs.slice(0,4).join(' | '):'no page errors');
await browser.close();
