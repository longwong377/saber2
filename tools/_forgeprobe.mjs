/**
 * ══════════════════════════════════════════════════════════════════════════
 *  #10 THE FORGE AND #25 THE NOTICE WALL, IN A REAL BROWSER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Two things the headless suite cannot answer, for the reason
 * `tools/_doorprobe.mjs`'s header gives at length: the check harness's DOM
 * double has no layout, so a scroll position is unmeasurable in it, and
 * `requestAnimationFrame` never fires in this headless Chromium, so the game's
 * own loop has to be driven rather than waited on.
 *
 *   THE FORGE LANDS YOU AT THE ANVIL. `onKiosk('hilt')` is what #10's bench
 *   raises. The menu bar drops a player at the top of the Jedi page, which is
 *   `Order`; V16 §A4's room has to do better than that, and "better" here is a
 *   scroll offset in pixels, which is exactly what nothing headless can see.
 *
 *   THE NOTICE WALL HAS WORDS ON IT. `station.mjs` counts textures on the
 *   room's meshes; this reads the canvas back and prints what is written,
 *   which is the only way to see that a panel is not thirteen black squares.
 *
 * ── WHAT IT READ, AND BOTH NUMBERS ARE THE POINT ─────────────────────────
 *
 *   door       column scroll   crystal   what-you-carry   face
 *   bar                    0     5550px          1643px   386px
 *   #10 hilt            5720        0px         -4026px  -5322px
 *   #46 loadout         1694     4026px             0px  -1296px
 *   #27 mirror           398     5322px          1296px     0px
 *
 * The menu bar puts the anvil five and a half thousand pixels below the fold.
 * Each room puts its own shelf at the top. That is the whole of what "the room
 * is the better door" means when it is measured rather than asserted.
 *
 *   node tools/pack.mjs /tmp/borz7.html
 *   node tools/_forgeprobe.mjs
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await page.goto('file:///tmp/borz7.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
console.log('front screen up');

/* THE STATION FIRST: `world.onKiosk` is the hook #10's bench and #46's counter
 * raise through `Station.stationKey`, and it is the same call `showKioskPanel`
 * is wired to in `main.js`. Driving the hook rather than the private function
 * is the point — it is the path the player's key actually takes. */
await page.evaluate(() => { window.SABER.enterStation(); });
try {
  await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 240000 });
  console.log('station up');
} catch (e) {
  console.log('STATION DID NOT COME UP:', String(e.message).split('\n')[0]);
  console.log('page errors:', errs.join('\n  ') || '(none)');
  await browser.close();
  process.exit(1);
}

/* ── 1. WHERE EACH DOOR LANDS ─────────────────────────────────────────── */
const scrolled = async (how) => page.evaluate(async (h) => {
  const col = document.querySelector('.panel[data-panel="saber"] .col.scroll');
  if (col) col.scrollTop = 0;
  window.SABER.screens.clear();
  if (h === 'bar') { window.SABER.menu.showMenu(); document.querySelector('.tab[data-tab="saber"]').click(); }
  else window.SABER.world.onKiosk(h);
  await new Promise((r) => setTimeout(r, 200));
  const cols = [...document.querySelectorAll('.panel[data-panel="saber"] .col')];
  const top = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const c = cols.find((x) => x.contains(el));
    return c ? Math.round(el.getBoundingClientRect().top - c.getBoundingClientRect().top) : null;
  };
  return { scroll: cols.map((c) => Math.round(c.scrollTop)),
    crystal: top('color-list'), carry: top('saberset-list'), face: top('face-list') };
}, how);

for (const how of ['bar', 'hilt', 'loadout', 'mirror']) {
  const r = await scrolled(how);
  console.log(`${String(how).padEnd(8)} col scroll ${JSON.stringify(r.scroll).padEnd(18)} `
    + `crystal ${String(r.crystal).padStart(6)}px  what-you-carry ${String(r.carry).padStart(6)}px  `
    + `face ${String(r.face).padStart(6)}px  (0 = at the top of the column)`);
}

/* ── 2. THE NOTICE WALL ───────────────────────────────────────────────── */
await page.evaluate(() => window.SABER.screens.clear());
const wall = await page.evaluate(() => {
  const st = window.SABER.world._station;
  const n = st.notices;
  if (!n) return { why: 'st.notices is null' };
  const rec = [...st.places.values()].find((r) => r.place.id === 25);
  let meshes = 0, texts = 0;
  rec.group.traverse((o) => { if (o.isMesh) { meshes++; if (o.material?.map) texts++; } });
  /* WHAT IS ACTUALLY PAINTED, off the canvas rather than off the strings — a
   * panel whose draw silently early-outed would read as blank here. */
  const ink = (p) => {
    const cv = p.material.map?.image;
    if (!cv?.getContext) return -1;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 90 || d[i + 1] > 90) lit++;
    return Math.round((lit / (d.length / 4)) * 1000) / 10;
  };
  return {
    meshes, texts, draws: st.draws, day: st.day,
    rows: (n.panels || []).map((p) => ({ t: (p.panel._rows || []).join(' / '), ink: ink(p.panel) })),
  };
});
console.log(`\n#25: ${wall.meshes} meshes, ${wall.texts} textured, deck 40 ${wall.draws} draws`);
for (const r of wall.rows || []) console.log(`  ${String(r.ink).padStart(5)}% ink  ${r.t}`);
console.log(errs.length ? `\nERRORS: ${errs.join('\n')}` : '\nno page errors');
await browser.close();
