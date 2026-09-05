/* THROWAWAY. The Drum pressed in the real room: the key, the panel's own
   buttons, the panel's own clock.  node tools/pack.mjs /tmp/borz.html first.

   requestAnimationFrame NEVER FIRES in this headless chromium, so the frame
   loop is dead and every press must be stepped by hand — `world.update` is
   called here exactly as `frame()` would. `Input.touchHitSet.add('focus')` is
   the press itself (tools/_casinoprobe.mjs's pattern). setTimeout DOES fire,
   which is what makes the panel's own bell observable. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300)); });
await page.addInitScript(() => {
  localStorage.setItem('saber.credits.v1', JSON.stringify({ v: 1, purse: 5000, earned: 5000, spent: 0 }));
});
await page.goto('file:///tmp/claude-0/-home-user-saber2/2c88c71e-8985-5aff-85cf-baa467dd4021/scratchpad/drum.html', { waitUntil: 'domcontentloaded', timeout: 900000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 1500000 });
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 1500000 });

/* AN HOUR WHOSE NEXT TURN PAYS SOMEBODY, so the settle being proved is a
 * PAYMENT and not only a loss. `drumAt` is pure, so this is knowable here. */
const { drumTable, drumBets } = await import('../src/game/Casino.js');
const { drumPays } = await import('../src/game/Games.js');
let START = 9;
for (let h = 0; h < 24; h++) if (drumTable((h + 1) % 24, 0).deck !== null) { START = h; break; }

let bad = 0;
const say = (ok, label, detail) => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(44)} ${detail}`); };

/* ── 1. WALK TO #60 AND PRESS THE KEY, stepping the world by hand. */
const up = await page.evaluate((START) => {
  const W = window.SABER, w = W.world;
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === 60) row = rec.place;
  if (!row) return { why: '#60 is not on this deck' };
  w._station.hour = START + 0.2;               // an hour whose next turn pays
  w.player.position.set(row.x, w.player.position.y, row.z);
  W.input.touchHitSet.add('focus');
  w.update(1 / 60, W.input);                   // the frame the press is read on
  const el = document.getElementById('casino');
  return { why: null, state: W.screens.state, open: !!el && !el.classList.contains('hidden'),
    head: el?.querySelector('h2')?.textContent, hour: w._station.hour };
}, START);
if (up.why) { say(false, 'the key raises the Wheelhouse', up.why); }
else say(up.open && up.state === 'casino', 'the key raises the Wheelhouse',
  `${up.head} at hour ${up.hour.toFixed(2)}, screens.state=${up.state}`);

/* ── 2. THE WHEEL TURNS WHILE THE PLAYER STANDS IN THE ROOM. Nothing steps
 *      the world here — `Screens.take` paused it. Only the panel's bell. */
const before = await page.evaluate(() => window.SABER.world._station.hour);
await new Promise((r) => setTimeout(r, 3000));
const after = await page.evaluate(() => window.SABER.world._station.hour);
const moved = (after - before) * 120;   /* station hours -> real seconds at §3.4 */
say(after > before && moved > 2 && moved < 4.5, 'the clock runs with the panel up',
  `hour ${before.toFixed(4)} -> ${after.toFixed(4)} in 3.0 real s = ${moved.toFixed(2)} s of station time`);

/* ── 3. PLACE A REAL BET on the row that will win the next turn. */
const day = await page.evaluate(() => window.SABER.world._station.day ?? 0);
const bet = await page.evaluate(() => {
  const W = window.SABER;
  document.querySelector('#casino button.tab-t[data-tab="drum"]')?.click();
  const rows = [...document.querySelectorAll('#casino .row')]
    .filter((r) => r.querySelector('button.stake'))
    .map((r) => ({ label: r.querySelector('b').textContent, i: +r.querySelector('button.stake').dataset.i }));
  return { rows, hour: W.world._station.hour, purse: document.querySelector('#casino p.sub').textContent };
});
const turn = Math.floor(bet.hour) + 1;
const stop = drumTable(turn % 24, day).at;
const all = drumBets();
const winner = all.findIndex((b) => drumPays({ ...b, stake: 25 }, stop) > 0);
const loser = all.findIndex((b, i) => i !== winner && drumPays({ ...b, stake: 25 }, stop) === 0);
console.log(`  the ${String(turn % 24).padStart(2, '0')}:00 turn stops on segment ${stop} = `
  + `${drumTable(turn % 24, day).deck === null ? 'the house' : 'deck ' + drumTable(turn % 24, day).deck}; `
  + `the winning row is "${all[winner]?.label ?? 'none'}"`);

for (const [name, idx] of [['a winner', winner], ['a loser', loser]]) {
  if (idx < 0) { console.log(`  (no ${name} this turn)`); continue; }
  const placed = await page.evaluate((i) => {
    const W = window.SABER;
    const b = document.querySelector(`#casino button.stake[data-i="${i}"]`);
    if (!b) return { why: `row ${i} has no button` };
    const purseBefore = document.querySelector('#casino p.sub').textContent;
    b.click();
    const line = [...document.querySelectorAll('#casino p.sub')].map((p) => p.textContent).join(' | ');
    return { why: null, purseBefore, line, hour: W.world._station.hour };
  }, idx);
  if (placed.why) { say(false, `${name}: the stake button`, placed.why); continue; }
  say(/riding on the/.test(placed.line) && !/turn paid|turn took it/.test(placed.line),
    `${name}: the ticket rides, it does not settle`, placed.line.split('|').slice(1, 3).join('|').trim());

  /* THE CLOCK CROSSES THE TURN. Two real minutes is what the bell needs; the
   * hour is pushed instead and the bell's next beat is the one that reads it. */
  const done = await page.evaluate(async (t) => {
    const W = window.SABER;
    W.world._station.hour = t + 0.05;
    await new Promise((r) => setTimeout(r, 700));   // the panel's own next beat
    const line = [...document.querySelectorAll('#casino p.sub')].map((p) => p.textContent).join(' | ');
    return { line, purse: document.querySelector('#casino p.sub').textContent };
  }, turn % 24);
  say(/turn paid|turn took it/.test(done.line), `${name}: the turn settles it`,
    (done.line.match(/the \d\d:00 turn [^|]*/) || ['(nothing)'])[0].trim() + ` — ${done.purse.trim()}`);
}

console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 6).join('\n')}` : '\nno page errors');
console.log(`\n${bad ? `${bad} FAILED` : 'all clear'}`);
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
