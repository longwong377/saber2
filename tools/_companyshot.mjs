/**
 * THE COMPANY TAB, IN A REAL BROWSER, with a seeded roll on both armies.
 *
 * A roster page is the one screen in this game whose only job is to be READ, so
 * "the check passes" is not the bar — it has to be looked at. This seeds a
 * plausible roll into localStorage, opens the tab, picks the first man, and
 * puts three frames on disk. Not a check: `tools/checks/attributes.mjs` holds
 * the contents; this holds the layout, with eyes.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm','.svg':'image/svg+xml' };
const server = createServer(async (req,res)=>{ try{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const f=join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/,'')); if(!f.startsWith(ROOT)||!existsSync(f)||!statSync(f).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'}); res.end(await readFile(f)); }catch(e){res.writeHead(500);res.end(String(e));} });
const port = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor: 3 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type()==='error') console.log('CONSOLE:', m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'domcontentloaded', timeout:45000 });

/* Seed through the real modules, so the roll on disk is a roll the game would
 * have written — a hand-typed JSON blob would be testing my typing. */
const seeded = await page.evaluate(async (origin) => {
  const A = await import(`${origin}/src/game/Attributes.js`);
  const C = await import(`${origin}/src/game/Command.js`);
  const Co = await import(`${origin}/src/game/Company.js`);
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const NAMES = ['Rex','Cody','Boil','Waxer','Fives','Echo','Jesse','Kix','Hardcase','Tup','Dogma','Wolffe'];
  const out = {};
  for (const [army, types] of [['republic', ['clone_trooper','clone_heavy','clone_sniper','clone_commander']],
                               ['separatist', ['b1_battle_droid','b2_super_droid','droideka','b1_sniper']]]) {
    const kind = A.kindOfArmy(army);
    const c = Co.blank(army);
    c.runs = 6; c.lost = 11; c.founded = 'Geonosis';
    for (let i = 0; i < 14; i++) {
      const type = types[i % types.length];
      const s = A.rollSoldier(rng, kind, { type });
      c.men.push({
        id: `m${i}`, army, type,
        designation: kind === 'steel' ? `B1-${1000 + i * 37}` : `CT-${2000 + i * 41}`,
        nickname: kind === 'steel' ? null : (i < NAMES.length ? NAMES[i] : null),
        kind, attrs: s.attrs, traits: s.traits,
        squad: i % 4, xp: (i * 137) % 900, kills: (i * 7) % 40, wounds: i % 3,
        morale: 1, areas: i % 5, joined: 'Geonosis', runs: i % 7, since: 'Geonosis',
        story: i % 3 === 0 ? ['Held the east gantry on Geonosis after his squad broke.'] : [],
        look: {},
      });
    }
    c.fallen = [{ designation: 'CT-2317', nickname: 'Slick', rank: 2, kills: 19, runs: 4, where: 'Felucia' }];
    Co.save(c);
    out[army] = c.men.length;
  }
  return out;
}, `http://127.0.0.1:${port}`);
console.log('seeded', seeded);

await page.reload({ waitUntil:'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout:60000 });
await page.click('.tab[data-tab="company"]');
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/out/company-index.png' });
const rows = await page.$$('#company-list .diff');
console.log('rows on the roll:', rows.length);
if (rows[0]) { await rows[0].click(); await page.waitForTimeout(350); }
await page.screenshot({ path: 'tools/out/company-man.png' });
/* …and a droid, because the whole point of `kind` is that the same page says
 * different words for the same eight numbers. */
const droid = rows.find ? null : null;
for (const r of rows) {
  const t = await r.textContent();
  if (t && t.includes('B1-')) { await r.click(); await page.waitForTimeout(350); break; }
}
await page.screenshot({ path: 'tools/out/company-droid.png' });
/* THE BARS AT 3x, because the whole claim of this layout is a 2 px line and a
   1280-wide frame is not where you find out whether a 2 px line is there. */
const list = await page.$('.attr-list');
if (list) await list.screenshot({ path: 'tools/out/company-bars.png', scale: 'css' });

const probe = await page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const bar = document.querySelector('.attr-bar .fill');
  const mid = document.querySelector('.attr-bar .mid');
  const names = [...document.querySelectorAll('.attr-name')].map((e) => e.textContent);
  return {
    tab: !!document.querySelector('.tab[data-tab="company"]'),
    panelActive: !!document.querySelector('.panel[data-panel="company"].active'),
    chips: q('.man-chips .attr-chip'), rows: q('.attr-row'), traits: q('.trait'),
    names,
    fillW: bar ? bar.getBoundingClientRect().width : -1,
    midW: mid ? mid.getBoundingClientRect().width : -1,
    barW: bar ? bar.parentElement.getBoundingClientRect().width : -1,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close(); server.close();
