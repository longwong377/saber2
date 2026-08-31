/**
 * THE COMPANY TAB, IN A REAL BROWSER, with a seeded roll on both armies.
 *
 * A roster page is the one screen in this game whose only job is to be READ, so
 * "the check passes" is not the bar — it has to be looked at. This seeds a
 * plausible roll into localStorage, opens the tab, picks the first man, and
 * puts frames on disk. Not a check: `tools/checks/attributes.mjs` holds
 * the contents; this holds the layout, with eyes.
 *
 * THE TAB IS THREE COLUMNS NOW — the roll (#company-list + #company-muster),
 * the parade ground (#company-stage, a lazily-created WebGL canvas), and the
 * page (#company-page) — so the harness stages all of it:
 *
 *   company-index.png    the whole panel on arrival, index page open.
 *   company-stage.png    the whole panel, clipped to its box, after the
 *                        staggered figure builds and a small drag (the stage
 *                        renders on demand; a drag marks it dirty).
 *   company-muster.png   the roll column scrolled to #company-muster, with a
 *                        recruit dressed through the real Muster.dressRecruit.
 *   company-recruit.png  a recruit's page, opened through his row.
 *   company-man.png      a veteran's page.
 *   company-droid.png    a droid's page — same page, different words.
 *   company-bars.png     the attr bars at 3x, where a 2 px line is visible.
 *   company-dressing.png the whole of a recruit's page at full scroll height — twelve
 *                        rows of kit and paint, the issue buttons and the ladder.
 *   company-page-full.png a veteran's whole page, same reason.
 *   company-licence.png  the five rungs and what each one is a licence for.
 *   company-fallen.png   the fallen page, with epitaphs seeded through the
 *                        real Company.keep (opts.roll carries killer + minute).
 *
 * The muster slate only mints when the mode fields an army, so the harness
 * writes `saber.settings.v6` with mode 'skirmish' before the reload — and the
 * republic roll is folded down to SEVEN men through the real `Company.keep`
 * (want is OPENING_STRENGTH = 10), so the slate has three recruits to name.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { decodePng } from './_png.mjs';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = (name) => join(ROOT, 'tools/out', name);
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
  const Mu = await import(`${origin}/src/game/Muster.js`);
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const NAMES = ['Rex','Cody','Boil','Waxer','Fives','Echo','Jesse','Kix','Hardcase','Tup','Dogma','Wolffe'];
  const out = {};
  /* The republic gets TEN men and the separatists fourteen: ten because the
   * plan's want is OPENING_STRENGTH (10) and the muster only mints recruits
   * for the shortfall — the fold below takes three of the ten, so the slate
   * has three names to show. */
  for (const [army, types, count] of [
      ['republic', ['trooper','heavy','sniper','arc','officer','jet'], 10],
      ['separatist', ['b1','b2','droideka','bx','magna','rocket'], 14]]) {
    const kind = A.kindOfArmy(army);
    const c = Co.blank(army);
    c.runs = 6; c.lost = 11; c.founded = 'Geonosis';
    for (let i = 0; i < count; i++) {
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
    c.fallen = [{ designation: kind === 'steel' ? 'B1-2317' : 'CT-2317',
      nickname: kind === 'steel' ? null : 'Slick', rank: 2, kills: 19, runs: 4, where: 'Felucia' }];
    Co.save(c);
    out[army] = c.men.length;
  }

  /**
   * FOLD ONE RUN INTO THE REPUBLIC through the real `Company.keep`, so the
   * fallen page's epitaphs are records the game itself wrote: seven of the
   * ten reach the ramp, three do not, and `opts.roll` — the run's own
   * casualty account — carries who got two of them and in which minute. The
   * man dressed "Vex" dies wearing the callsign, which is the whole claim
   * of the epitaph pass.
   */
  const before = Co.load('republic');
  const dead = new Set([before.men[4].designation, before.men[8].designation, before.men[9].designation]);
  Co.dress('republic', before.men[4].designation, { callsign: 'Vex', mark: 'blood' });
  const deployed = Co.load('republic').men;
  const manifest = deployed.filter((m) => !dead.has(m.designation));
  Co.keep(manifest, {
    army: 'republic', deployed, ground: 'Felucia', ended: 'withdrew',
    roll: [
      { name: `${before.men[4].designation} "Vex"`, killer: 'a droideka', at: 372 },
      { name: before.men[8].designation, killer: 'B2-0292', at: 705 },
    ],
  });
  const after = Co.load('republic');
  out.republic = after.men.length;
  out.fallen = after.fallen.map((f) => `${f.designation}${f.callsign ? ` "${f.callsign}"` : ''}${f.killer ? ` ← ${f.killer}@${f.at}` : ''}`);

  /**
   * THE MODE MUST FIELD AN ARMY or the slate never mints — the Menu reads
   * `saber.settings.v6` (its own STORE_KEY) and defaults to roguelite, which
   * is not an army mode. Skirmish is (`battles: true`), and order 'jedi'
   * leads the republic.
   */
  localStorage.setItem('saber.settings.v6', JSON.stringify({ mode: 'skirmish' }));

  /* Mint the slate NOW, through the same `ensure` the tab calls — the salt is
   * the company's own state, so the tab's render finds this slate true and
   * keeps it — and dress one recruit through the real `dressRecruit`, so a
   * named, marked recruit is on the parade before anybody clicks anything. */
  const plan = C.musterPlan({ mode: 'skirmish', order: 'jedi' });
  const slate = Mu.ensure(plan, Co.load('republic'));
  out.plan = plan;
  out.recruits = (slate?.recruits || []).map((r) => r.designation);
  if (slate?.recruits?.length) {
    Mu.dressRecruit('republic', slate.recruits[0].designation,
      { callsign: 'Digger', mark: 'sun', band: 'sky' });
  }
  return out;
}, `http://127.0.0.1:${port}`);
console.log('seeded', JSON.stringify(seeded));

await page.reload({ waitUntil:'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout:60000 });
/* HARNESS-ONLY STYLE: in this headless profile the panel's columns inflate to
 * their CONTENT height (the ground column measured ~2231px against a 495px
 * panel) instead of stretching to the panel row, dragging #company-stage and
 * its canvas with them — the parade renders into a buffer 4.5× too tall and
 * the compositor shows the empty top strip of it. Bounding the columns to the
 * panel makes the stage's box the painted box; a browser whose layout already
 * agrees is unaffected. Injected before the tab click so `_startStage` sizes
 * the renderer off the true box from its first frame. */
await page.addStyleTag({ content:
  '.panel[data-panel="company"] .col{max-height:100%}' });
await page.click('.tab[data-tab="company"]');
await page.waitForTimeout(400);

/**
 * THE STAGE BUILDS ONE BODY PER rAF, and renders only when dirty — so wait for
 * the build queue to actually drain (the page exposes the Menu on SABER), then
 * dispatch a small drag (pointerdown / pointermove / pointerup, more than the
 * 4 px that would read as a pick) to force real renders under swiftshader.
 * The stage renders on demand and the compositor keeps no promise about a
 * frame nobody dirtied, so a keepalive marks it dirty for the whole
 * screenshot window — and a GL readback right after an explicit render says
 * what the canvas actually holds, whatever the PNG later shows.
 */
let stage = null;
try { stage = await page.waitForSelector('#company-stage canvas', { timeout: 20000 }); }
catch { console.log('STAGE: no canvas appeared — GL refused; DOM shots continue.'); }
if (stage) {
  await page.waitForFunction(() => {
    const p = globalThis.SABER?.menu?.barracks;
    return p && p.queue.length === 0 && p.figures.length > 0 && p.lineContent;
  }, { timeout: 30000 }).catch(() => console.log('STAGE: build queue never drained.'));
  const diag = await page.evaluate(() => {
    const p = globalThis.SABER?.menu?.barracks;
    if (!p) return { barracks: false };
    const host = document.getElementById('company-stage');
    const r = host.getBoundingClientRect();
    const layers = [];
    for (let el = host; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.transform !== 'none' || (cs.zoom && cs.zoom !== '1' && cs.zoom !== 'normal')) {
        layers.push({ el: el.id || el.className, transform: cs.transform, zoom: cs.zoom });
      }
    }
    const panelEl = document.querySelector('.panel[data-panel="company"]');
    const pc = getComputedStyle(panelEl);
    const gc = getComputedStyle(document.querySelector('.company-ground'));
    const layout = { client: [host.clientWidth, host.clientHeight],
      rect: [Math.round(r.width), Math.round(r.height)], layers,
      panel: { display: pc.display, dir: pc.flexDirection, align: pc.alignItems,
        h: Math.round(panelEl.getBoundingClientRect().height) },
      ground: { h: gc.height, maxH: gc.maxHeight, flex: gc.flex, overflowY: gc.overflowY } };
    try { globalThis.SABER.menu._frameStage(); p.renderer.render(p.scene, p.camera); } catch (e) { return { layout, renderThrew: e.message }; }
    const gl = p.renderer.getContext();
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels((cw - 64) >> 1, (ch - 64) >> 1, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lit = 0, sum = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 0) lit++; sum += px[i] + px[i + 1] + px[i + 2]; }
    return {
      layout,
      figures: p.figures.length, queue: p.queue.length, running: p.running,
      lineContent: p.lineContent && { y0: +p.lineContent.y0.toFixed(2), y1: +p.lineContent.y1.toFixed(2), radius: +p.lineContent.radius.toFixed(2) },
      cam: [...p.camera.position].map((n) => +n.toFixed(2)), camNaN: [...p.camera.position].some(Number.isNaN),
      buffer: `${cw}x${ch}`, contextLost: gl.isContextLost(),
      centerLitPct: +(100 * lit / 4096).toFixed(1), centerMean: +(sum / (3 * 4096)).toFixed(1),
    };
  });
  console.log('STAGE DIAG', JSON.stringify(diag));
  /**
   * THE ONE CORRECTION, measured before it is applied: in this headless
   * profile `#company-stage.clientHeight` reads several times the painted
   * rect (run 2 measured 2241 against 471), so the stage's own loop sizes
   * the drawing buffer ~4.8× too tall and the compositor never shows it —
   * the GL readback above proves the image is IN the buffer. Shadowing the
   * two instance getters with the rect hands the loop the truth through its
   * own resize path; a page where layout and paint agree skips this.
   */
  const fixed = await page.evaluate(() => {
    const p = globalThis.SABER?.menu?.barracks;
    const host = document.getElementById('company-stage');
    const panel = document.querySelector('.panel[data-panel="company"]');
    if (!p || !host || !panel) return null;
    if (host.clientHeight <= panel.getBoundingClientRect().height) return { corrected: false };
    /* Dynamic, not frozen: while the layout is inflated the getters answer
     * with the panel's paint window, and once it settles they answer with
     * the element's real box — so the loop's own resize path always lands
     * on a buffer the compositor will actually display. */
    Object.defineProperty(host, 'clientWidth', { get: () => Math.max(1, Math.round(host.getBoundingClientRect().width) - 4) });
    Object.defineProperty(host, 'clientHeight', { get: () => {
      const h = host.getBoundingClientRect().height;
      const ph = panel.getBoundingClientRect().height;
      return Math.max(1, Math.round(Math.min(h, ph - 110)) - 4);
    } });
    p.dirty = true;
    return { corrected: true, now: [host.clientWidth, host.clientHeight] };
  });
  console.log('STAGE SIZE FIX', JSON.stringify(fixed));
  await page.waitForTimeout(1200);
  console.log('STAGE POST', JSON.stringify(await page.evaluate(() => {
    const p = globalThis.SABER?.menu?.barracks;
    if (!p) return null;
    const gl = p.renderer.getContext();
    return { buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` };
  })));
  const box = await stage.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(cx + i * 12, cy + i * 3);
    await page.mouse.up();
    await page.waitForTimeout(1500);                     // let the dirty frames actually render
  }
}
/* Keep the stage rendering through both shots — a demand-driven canvas that
 * went quiet before the capture composites as its own stale (possibly blank)
 * frame under swiftshader, and a screenshot is exactly a new composite. */
await page.evaluate(() => {
  const p = globalThis.SABER?.menu?.barracks;
  if (p) globalThis.__stageKeepalive = setInterval(() => { p.dirty = true; }, 30);
});
await page.waitForTimeout(400);
await page.screenshot({ path: OUT('company-index.png') });

/* THE STAGE SHOT IS THE WHOLE PANEL, clipped to the panel's own box — the
 * parade means nothing without the roll beside it and the caption under it. */
const panelBox = await page.evaluate(() => {
  const r = document.querySelector('.panel[data-panel="company"]')?.getBoundingClientRect();
  const s = document.getElementById('company-stage')?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height,
    stage: s ? { x: s.x, y: s.y, w: s.width, h: s.height } : null } : null;
});
if (panelBox) {
  /* The first screenshot can be what finally settles the inflated layout —
   * give the render loop a beat to see the settled box, resize the buffer
   * through its own path and redraw, before the clipped shot is taken. */
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT('company-stage.png'),
    clip: { x: panelBox.x, y: panelBox.y, width: panelBox.w, height: panelBox.h } });
}
await page.evaluate(() => { clearInterval(globalThis.__stageKeepalive); });

/* WHAT DID THE CANVAS ACTUALLY PUT ON IT? Measured off the PNG rather than
 * asserted: the ground disc is one flat brown, so bodies show up as luminance
 * spread and near-white armour pixels inside the stage's own box. */
if (panelBox?.stage) {
  try {
    const png = decodePng(await readFile(OUT('company-stage.png')));
    const dpr = png.width / panelBox.w;
    const sx = Math.max(0, Math.round((panelBox.stage.x - panelBox.x) * dpr));
    const sy = Math.max(0, Math.round((panelBox.stage.y - panelBox.y) * dpr));
    const sw = Math.min(png.width - sx, Math.round(panelBox.stage.w * dpr));
    const sh = Math.min(png.height - sy, Math.round(panelBox.stage.h * dpr));
    let n = 0, sum = 0, sum2 = 0, bright = 0;
    const colors = new Set();
    for (let y = sy; y < sy + sh; y += 2) {
      for (let x = sx; x < sx + sw; x += 2) {
        const i = (y * png.width + x) * 4;
        const r = png.rgba[i], g = png.rgba[i + 1], b = png.rgba[i + 2];
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        n++; sum += L; sum2 += L * L;
        if (L > 170) bright++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    console.log('STAGE PIXELS', JSON.stringify({
      region: `${sw}x${sh}`, meanLum: +mean.toFixed(1), sdLum: +sd.toFixed(1),
      brightPct: +(100 * bright / n).toFixed(2), quantColors: colors.size,
    }));
  } catch (e) { console.log('STAGE PIXELS: unmeasurable —', e.message); }
}

/* THE MUSTER, IN THE ROLL COLUMN. The column scrolls internally (`.col` is
 * overflow-y:auto), so the slate sits below the fold until it is brought up. */
await page.evaluate(() => document.getElementById('company-muster')
  ?.scrollIntoView({ block: 'end' }));
await page.waitForTimeout(300);
const rollCol = await page.$('.company-roll');
if (rollCol) await rollCol.screenshot({ path: OUT('company-muster.png') });

/* A RECRUIT'S PAGE — the dressed one is the first row on the slate. */
const recruitRow = await page.$('#company-muster .diff.recruit');
if (recruitRow) {
  await recruitRow.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT('company-recruit.png') });
  /**
   * …AND THE WHOLE OF HIS PAGE, which the viewport shot cannot show.
   *
   * A recruit's page is the tallest thing in this tab now — twelve rows of
   * kit and paint, the two issue buttons, the squad chips and the five rungs
   * of the ladder — and every one of those is below the fold at 1280x800. An
   * element screenshot captures the full scroll height, which is the only way
   * to LOOK at the thing this tab was rebuilt to be.
   */
  const rPage = await page.$('#company-page');
  if (rPage) await rPage.screenshot({ path: OUT('company-dressing.png') });
} else console.log('NO RECRUIT ROWS — the slate did not mint.');

/* Back to the roll for the veteran pages: man rows carry dataset.man and the
 * fallen row shares the class, so exclude it by class rather than by index. */
await page.evaluate(() => document.getElementById('company-list')
  ?.scrollIntoView({ block: 'start' }));
const rows = await page.$$('#company-list .diff:not(.company-fallen-row)');
console.log('rows on the roll:', rows.length);
if (rows[0]) { await rows[0].click(); await page.waitForTimeout(350); }
await page.screenshot({ path: OUT('company-man.png') });
/* …and a droid, because the whole point of `kind` is that the same page says
 * different words for the same eight numbers. */
for (const r of rows) {
  const t = await r.textContent();
  if (t && t.includes('B1-')) { await r.click(); await page.waitForTimeout(350); break; }
}
await page.screenshot({ path: OUT('company-droid.png') });
/* THE BARS AT 3x, because the whole claim of this layout is a 2 px line and a
   1280-wide frame is not where you find out whether a 2 px line is there. */
const list = await page.$('.attr-list');
if (list) await list.screenshot({ path: OUT('company-bars.png'), scale: 'css' });

/* THE LICENCE AND THE SEAT, on a veteran, at full height — the panel that says
   what a rank is FOR now that the numbers a rung buys are small. */
if (rows[0]) { await rows[0].click(); await page.waitForTimeout(350); }
const vPage = await page.$('#company-page');
if (vPage) await vPage.screenshot({ path: OUT('company-page-full.png') });
const duties = await page.$('.duty-list');
if (duties) await duties.screenshot({ path: OUT('company-licence.png'), scale: 'css' });

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
    /* the new layout, censused */
    recruitRows: q('#company-muster .diff.recruit'),
    dressedRecruit: [...document.querySelectorAll('#company-muster .diff.recruit b')]
      .some((b) => b.textContent.includes('"Digger"')),
    stageCanvas: q('#company-stage canvas'),
    shotButtons: q('#company-shots .shot'),
    caption: document.getElementById('company-stage-caption')?.textContent || null,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
console.log(JSON.stringify(probe, null, 2));

/* THE FALLEN PAGE LAST — it replaces the man page, so the bar probe above has
 * already had its subject. The first fallen row is the republic's, and the
 * republic's list carries the kept epitaphs (callsign, killer, minute). */
const fallenRow = await page.$('#company-list .company-fallen-row');
if (fallenRow) {
  await fallenRow.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT('company-fallen.png') });
  const fp = await page.evaluate(() => ({
    entries: document.querySelectorAll('#company-page .company-fallen > div').length,
    fellLines: [...document.querySelectorAll('#company-page .fell')].map((e) => e.textContent),
    named: [...document.querySelectorAll('#company-page .company-fallen b')].map((e) => e.textContent),
  }));
  console.log('FALLEN', JSON.stringify(fp, null, 2));
} else console.log('NO FALLEN ROW on the roll.');

await browser.close(); server.close();
