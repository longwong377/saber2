/**
 * THE ROOM, IN THE GAME — a probe, not a check.
 *
 *   node tools/pack.mjs /tmp/roomprobe.html && node tools/_roombrowse.mjs
 *
 * Opens #57 through `world.onHolodeck`, reads the rack it draws, moves a dial
 * on the console, presses the row for a ground NO featured room names, and
 * waits for the world to be that ground.
 */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 200)); });
await page.goto('file:///tmp/roomprobe.html', { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
console.log('front screen up');
page.evaluate(() => { window.SABER.enterStation(); }).catch(() => {});
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 600000 });
console.log('station up, deck', await page.evaluate(() => window.SABER.world._stationFloor));

const shown = await page.evaluate(() => {
  const ok = window.SABER.world.onHolodeck?.();
  const el = document.getElementById('holodeck');
  return {
    ok, hidden: el.classList.contains('hidden'),
    heads: [...el.querySelectorAll('h2,h3')].map((h) => h.textContent),
    sub: el.querySelector('.sub')?.textContent,
    dials: [...el.querySelectorAll('input[data-dial],input[data-flag]')].map((i) => i.dataset.dial || i.dataset.flag),
    units: el.querySelectorAll('button[data-unit]:not([data-step])').length,
    rows: [...el.querySelectorAll('.row button.buy')].map((b) => ({
      id: b.dataset.id, off: b.disabled,
      title: b.parentElement.querySelector('b')?.textContent,
      say: b.parentElement.querySelector('span')?.textContent })),
  };
});
console.log('pane open:', shown.ok, '· hidden:', shown.hidden);
console.log('heads:', shown.heads.join(' | '));
console.log('sub:', shown.sub);
console.log('dials:', shown.dials.join(','), '· unit rows:', shown.units);
for (const r of shown.rows) console.log(`  ${r.off ? 'lock' : 'run '} ${String(r.id).padEnd(18)} ${r.title} — ${r.say}`);

const after = await page.evaluate(async () => {
  const el = document.getElementById('holodeck');
  const c = el.querySelector('input[data-dial="sandboxCount"]');
  c.value = '14';
  c.dispatchEvent(new Event('input', { bubbles: true }));
  c.dispatchEvent(new Event('change', { bubbles: true }));
  const row = document.getElementById('holodeck').querySelector('button.buy[data-id="ground:alpine"]');
  const line = row.parentElement.querySelector('span')?.textContent;
  row.click();
  return { count: window.SABER.settings.sandboxCount, line,
    level: window.SABER.settings.level, mode: window.SABER.settings.mode };
});
console.log('slider to 14, then press THE WHITE PASS:', JSON.stringify(after));
try {
  await page.waitForFunction(() => window.SABER.world?.levelKey === 'alpine', null, { timeout: 600000 });
  const built = await page.evaluate(() => ({ level: window.SABER.world.levelKey,
    mode: window.SABER.world.settings.mode, state: window.SABER.screens?.state,
    enemies: window.SABER.world.enemies?.length ?? -1 }));
  console.log('world built:', JSON.stringify(built));
  await page.waitForTimeout(30000);
  console.log('after 30 s:', JSON.stringify(await page.evaluate(() => ({
    level: window.SABER.world.levelKey,
    alive: (window.SABER.world.enemies || []).filter((e) => !e.dead).length,
    kinds: (window.SABER.world.enemies || []).reduce((a, e) => { const k = e.type || e.kind || '?'; a[k] = (a[k] || 0) + 1; return a; }, {}),
  }))));
} catch (e) { console.log('never reached alpine:', e.message.slice(0, 120)); }
console.log('errors:', errs.slice(0, 6));
await browser.close();
