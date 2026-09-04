/**
 * ══════════════════════════════════════════════════════════════════════════
 *  CAN YOU WATCH A RACE? — driven in a real browser, with the panel up
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you should be able to watch the entire battle."*
 *
 * A hostile pass found you could not, and the reason was two bugs stacked,
 * either one sufficient:
 *
 *   1. `Screens.take` sets `world.paused`, and `main.js`'s frame loop calls
 *      `world.update` only while `screens.state` is 'playing' or 'dead'. With
 *      the panel up, `stepStation` — and with it `st.hour += dt / 120` — never
 *      ran. Measured at #19 at 15:15 with a race live: 5400 × `world.update
 *      (1/60)`, ninety simulated seconds, moved the hour 15.25 → 15.25.
 *   2. `showTote` was called from `openTote` and two click handlers. Nothing
 *      re-rendered, so even against a running clock the page was a photograph.
 *
 * A race is `runs: 0.3` h — 36 real seconds. So the room the player was told
 * he could stand in for nothing was two stills with a walk between them.
 *
 * WHAT THIS PROBE ASSERTS, and it is deliberately the thing the suite cannot:
 * the panel is opened ONCE, nothing is clicked, and after eight real seconds
 * of sitting still the text on the glass has CHANGED and the gate number has
 * gone UP. A source read cannot see that and a headless check cannot either —
 * the clock this now runs on is a `setTimeout` in a live document.
 *
 * It also drives the second finding in the same lane: at `#20 The Arena`, on a
 * profile with no animal, the interact key must reach the BETTING CARD. The
 * Arena is a pit and a book; the pit used to answer every press and the tote
 * branch below it was unreachable, so the whole room was one line — "you have
 * nothing to put in there" — at every hour of every day.
 *
 *   node tools/pack.mjs /tmp/borz.html
 *   node tools/_toteprobe.mjs
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 200)); });

await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
console.log('station up');

/* ── 1. AN HOUR WITH A RACE ACTUALLY RUNNING ON IT ──────────────────────
 *
 * Found rather than assumed. `Tote.watch` is on the page through the packed
 * bundle's own module, so the hour is chosen by asking the reading which hour
 * is 'running' — a probe that hard-coded 15:15 would report a frozen panel on
 * any day the card is dark, which is one night in seven at #19. */
const found = await page.evaluate(() => {
  const W = window.SABER, st = W.world._station;
  const KEY = 'saber.station.v1';
  const wasSave = localStorage.getItem(KEY);
  for (let day = 0; day < 10; day++) {
    try {
      const save = JSON.parse(wasSave || '{}');
      save.seen = Array.from({ length: day }, (_, i) => 900 + i);
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch { /* private browsing */ }
    for (let h = 10; h < 23; h += 0.05) {
      st.hour = Math.round(h * 100) / 100;
      W.world.onTote('holo-theatre');
      const txt = (document.getElementById('tote')?.innerText || '');
      W.screens.clear();
      if (/gate \d+ of \d+/.test(txt)) {
        const m = /gate (\d+) of (\d+)/.exec(txt);
        /* Early in the race, so there is room for it to advance. */
        if (Number(m[1]) <= 3) return { day, hour: st.hour, gate: Number(m[1]), of: Number(m[2]) };
      }
    }
  }
  return null;
});
if (!found) { console.log('no running race found in ten days — the card cannot be watched'); process.exit(1); }
console.log(`found a race running: day ${found.day}, ${found.hour.toFixed(2)}h, gate ${found.gate} of ${found.of}\n`);

/* ── 2. OPEN IT ONCE, TOUCH NOTHING, WAIT ───────────────────────────────── */
const WATCH_MS = 8000;
const watched = await page.evaluate(async ({ hour, ms }) => {
  const W = window.SABER, st = W.world._station;
  st.hour = hour;
  const read = () => {
    const el = document.getElementById('tote');
    const t = (el?.innerText || '').trim();
    return { text: t, gate: Number(/gate (\d+) of/.exec(t)?.[1] ?? -1), hour: st.hour, paused: !!W.world.paused };
  };
  W.world.onTote('holo-theatre');
  await new Promise((r) => setTimeout(r, 60));
  const before = read();
  /* NOTHING IS CLICKED AND NOTHING IS STEPPED. The only thing running is the
   * panel's own bell. */
  await new Promise((r) => setTimeout(r, ms));
  const after = read();
  /* AND THE HANDLE IS CANCELLED ON THE WAY OUT: after the card is shut, wait
   * longer than a beat and the panel must still be down. A timer that outlives
   * its screen raises its last frame over whatever the player walked into. */
  W.screens.clear();
  await new Promise((r) => setTimeout(r, 900));
  const el = document.getElementById('tote');
  return { before, after, stayedShut: !el || el.classList.contains('hidden') };
}, { hour: found.hour, ms: WATCH_MS });

const b = watched.before, a = watched.after;
console.log(`  world.paused while the panel is up   ${b.paused}`);
console.log(`  runningHour  ${b.hour.toFixed(4)} → ${a.hour.toFixed(4)}   (+${((a.hour - b.hour) * 120).toFixed(1)} real s)`);
console.log(`  gate         ${b.gate} → ${a.gate}`);
console.log(`  panelChanged ${b.text !== a.text}`);
console.log(`  shut clean   ${watched.stayedShut}`);
console.log('\n── BEFORE ──────────────────────────────────────────────');
console.log(b.text);
console.log('\n── AFTER ' + (WATCH_MS / 1000) + 's ───────────────────────────────────');
console.log(a.text);

/* ── 3. #20: THE BETTING CARD, WITH NO ANIMAL ON THE ROLL ────────────────
 *
 * The chain `stationKey` runs at a room that is both a pit and a book, driven
 * link by link the way the key runs it: the pit is offered the press FIRST and
 * must hand it back — `openPit` returns false when there is no bout for you
 * and a book shares the room — and the book must then open with a card on it.
 *
 * The branch itself, inside `stationKey`, is held by `tools/checks/pits.mjs`,
 * which stands a real player at #20's door and drives the real function with
 * both answers out of the pit. What CANNOT be held there is what the player
 * ends up looking at, which is what this reads off the glass.
 */
const arena = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  const tookPit = w.onPit(20);
  await new Promise((r) => setTimeout(r, 120));
  const pitEl = document.getElementById('pit');
  const pitUp = !!pitEl && !pitEl.classList.contains('hidden');
  W.screens.clear();
  /* THE PRESS FALLS THROUGH, exactly as `stationKey` now lets it. */
  w.onTote('the-arena');
  await new Promise((r) => setTimeout(r, 120));
  const el = document.getElementById('tote');
  const text = (el?.innerText || '').trim();
  const up = !!el && !el.classList.contains('hidden');
  W.screens.clear();
  return { tookPit, pitUp, up, text };
});
console.log('\n── #20 THE ARENA, no animal on the roll ───────────────────');
console.log(`  world.onPit(20) returned ${arena.tookPit} (false = the press is handed on), pit panel up: ${arena.pitUp}`);
console.log(`  the betting card is up: ${arena.up}`);
console.log(arena.text.split('\n').map((l) => '  | ' + l).join('\n'));

console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 8).join('\n')}` : '\nno page errors');

const bad = [];
if (b.text === a.text) bad.push('THE PANEL DID NOT CHANGE');
if (!(a.gate > b.gate)) bad.push(`THE GATE DID NOT ADVANCE (${b.gate} → ${a.gate})`);
if (!(a.hour > b.hour)) bad.push('THE CLOCK DID NOT RUN BEHIND THE PANEL');
if (!watched.stayedShut) bad.push('THE TIMER RAISED THE PANEL AFTER IT WAS SHUT');
if (arena.tookPit !== false) bad.push('#20 THE PIT ATE THE PRESS AGAIN');
if (arena.pitUp) bad.push('#20 RAISED THE PIT PANEL ON A PROFILE WITH NO ANIMAL');
if (!arena.up || arena.text.length < 60) bad.push('#20 DID NOT REACH THE BETTING CARD');
if (!/in the sand tonight/i.test(arena.text)) bad.push("#20's CARD DOES NOT NAME THE PEOPLE WHO LIVE HERE");
console.log(bad.length ? `\n✗ ${bad.join('\n✗ ')}` : '\n✓ a race can be watched, and #20 reaches its card');
await browser.close();
process.exit(bad.length || errs.length ? 1 : 0);
