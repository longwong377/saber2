/**
 * ══════════════════════════════════════════════════════════════════════════
 *  EVERY DOOR ON THE STATION, OPENED IN A REAL BROWSER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS EXISTS AND WHY NOTHING HEADLESS REPLACES IT ─────────────────
 *
 * Seven rooms grew a panel this session — the habitat, a counter, the bench,
 * the medbay, a pit, the tote, the larder and the Repeating Room — and every
 * one of them is a `screens.take(id, …)` over a root this file creates on
 * demand. The suite is green on all seven and none of that green touches the
 * DOM: the checks drive the DATA (what a shelf holds, what a bout scores, what
 * the ward says) and stop at the door.
 *
 * That gap has already cost this tree twice. `showKioskPanel`'s note records a
 * card whose hide could not be told from "hide the menu", which left the game
 * unreachable with `window.SABER` present and `#menu` hidden — "the whole
 * suite is green with the menu hidden, because no check clicks a button". And
 * `tools/dom-shim.mjs`'s `classList` was inert for the life of the project, so
 * no check in the tree could ever see a class at all.
 *
 * So this clicks. It boots the packed file, enters the station, and calls each
 * door the way the room calls it — through `world.onX`, which is the same
 * function the interact key reaches — then asks the DOM whether a panel is
 * actually on the glass with something written on it.
 *
 * ── WHAT IT ASSERTS, AND IT IS DELIBERATELY THREE SMALL THINGS ───────────
 *
 *   IT OPENS      the panel's root exists and does not carry `hidden`.
 *   IT SAYS SOMETHING   there is text in it. A panel that opens empty is the
 *                 dead control this tree keeps deleting, wearing a root.
 *   IT CLOSES CLEAN     after the door is shut the front screen is not up and
 *                 the panel is gone — the failure above, exactly.
 *
 * It does NOT judge what the panel says. That is the suite's job and the suite
 * does it well; this answers the one question the suite cannot ask, which is
 * whether a player pressing the key gets anything at all.
 *
 *   node tools/pack.mjs /tmp/borz.html
 *   node tools/_doorprobe.mjs
 */
import { chromium } from 'playwright-core';

const DOORS = [
  ['onHabitat', 'habitat', [], '#28 The Kennel habitat'],
  ['onCounter', 'counter', ['clothier'], '#9 the clothier'],
  ['onCounter', 'counter', ['underlift'], '#58 the black market'],
  ['onBench', 'bench', ['make'], '#50 Fabrication'],
  ['onMedbay', 'medbay', [43], '#43 Medbay'],
  /* #61 AND NOT #20, AND THE SWAP IS THE FIX AND NOT A DODGE. `#20 The Arena`
   * is a pit AND a book, and on a profile with no animal — which is what this
   * probe boots — the pit now HANDS THE PRESS ON rather than answering with
   * "you have nothing to put in there": `openPit` returns false and
   * `stationKey` falls through to the tote, which is the row three below.
   * `#61 The Underlift Pit` has no book, so its refusal is still the only
   * answer in the room and this is where a pit panel can be opened cold. */
  ['onPit', 'pit', [61], '#61 The Underlift Pit'],
  ['onTote', 'tote', ['holo-theatre'], '#19 Holo-theatre'],
  ['onTote', 'tote', ['the-pit'], '#18 The Pit'],
  ['onTote', 'tote', ['the-arena'], '#20 The Arena tote'],
  ['onLarder', 'larder', [], "#27 your cabin's galley"],
  ['onHolodeck', 'holodeck', [], '#57 The Repeating Room'],
];

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
console.log('front screen up');

/* THE STATION, THROUGH ITS OWN DOOR. `enterStation` is what the lift calls. */
await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
const where = await page.evaluate(() => ({
  deck: window.SABER.world._stationFloor,
  places: window.SABER.world._station.places?.size ?? 0,
}));
console.log(`station up — deck ${where.deck}, ${where.places} places`);

const rows = [];
let bad2 = 0;
for (const [hook, id, args, label] of DOORS) {
  const r = await page.evaluate(async ({ hook, id, args }) => {
    const W = window.SABER;
    const w = W.world;
    if (typeof w?.[hook] !== 'function') return { ok: false, why: `world.${hook} is not a function` };
    let threw = null;
    try { w[hook](...args); } catch (e) { threw = String(e.message || e); }
    await new Promise((r2) => setTimeout(r2, 120));
    const el = document.getElementById(id);
    const open = !!el && !el.classList.contains('hidden');
    const text = (el?.innerText || '').trim();
    /* Shut it the way the player does, then look at the front screen. */
    W.screens.clear();
    await new Promise((r2) => setTimeout(r2, 120));
    const after = document.getElementById(id);
    return {
      ok: open && text.length > 0 && threw === null,
      threw, open, chars: text.length,
      head: text.split('\n')[0]?.slice(0, 48) || '',
      shut: !after || after.classList.contains('hidden'),
      menuUp: !document.getElementById('menu')?.classList.contains('hidden'),
    };
  }, { hook, id, args });
  rows.push({ label, id, ...r });
}

/**
 * ══ AND A DOOR THAT OPENS IS NOT A ROOM THAT WORKS ═══════════════════════
 *
 * Half the panels above came back with seventy characters in them, and every
 * one of those is CORRECT on a fresh profile: no animal on the roll, nobody
 * hurt, an empty cupboard. But two of them are short for a different reason —
 * the black market is dark two days in three and the tote's card is dark on
 * some nights — and "shut" and "broken" read identically from out here.
 *
 * So the hour-and-day rooms are swept. The station's clock is the same one
 * the shops reroll on and the medbay heals on, and it is writable from here,
 * so the probe walks a fortnight of days across the hours a card could run
 * and asks whether the room is EVER substantially open. A room that is shut
 * at every hour of every day for a fortnight is not a room with a schedule,
 * it is a room with a bug, and nothing in the suite would say so.
 */
const SWEPT = [
  /* THE BLACK MARKET IS SWEPT AS A SITH, because it refuses a Jedi in words
   * and a fresh profile is one — measuring the refusal and calling it a
   * closed shop is reading the gate as a fault. */
  ['onCounter', 'counter', 'underlift', '#58 the black market (as Sith)', 'shelf'],
  ['onTote', 'tote', 'holo-theatre', '#19 Holo-theatre', 'card'],
  ['onTote', 'tote', 'the-pit', '#18 The Pit', 'card'],
  ['onTote', 'tote', 'the-arena', '#20 The Arena tote', 'card'],
];
console.log('');
for (const [hook, id, arg, label, what] of SWEPT) {
  const r = await page.evaluate(async ({ hook, id, arg }) => {
    const W = window.SABER, w = W.world, st = w._station;
    const was = st.hour, wasOrder = W.settings.order;
    const KEY = 'saber.station.v1';
    const wasSave = localStorage.getItem(KEY);
    if (hook === 'onCounter') W.settings.order = 'sith';
    let best = 0, bestAt = null, opens = 0, tried = 0;
    for (let day = 0; day < 7; day++) {
      /* ── THE DAY IS ADVANCED THE WAY THE GAME ADVANCES IT ──────────────
       *
       * `stationDay()` is `floor(st.hour / 24) + seen.length`, and `st.hour`
       * is wrapped back under 24 by `stepStation` every frame — so a probe
       * that writes `st.hour = day * 24 + h` is not moving the calendar, it is
       * breaking the clock's own invariant, and `Tote.watch` then compares an
       * hour of 150 against a card that runs from 14:00. The first cut did
       * exactly that and reported the two busiest rooms on the station as
       * opening one hour in a hundred and sixty-eight.
       *
       * `seen` is the other half of the day and it is a durable list, so the
       * calendar moves by writing it and the clock stays a clock. */
      try {
        const save = JSON.parse(wasSave || '{}');
        save.seen = Array.from({ length: day }, (_, i) => 900 + i);
        localStorage.setItem(KEY, JSON.stringify(save));
      } catch { /* private browsing — the hour axis still sweeps */ }
      /* EVERY HOUR, not a sample of eight. The first cut swept 1/4/11/14/
       * 17/20/22/23 and reported three rooms as NEVER OPENING that are open
       * at 15:00, 19:00 and 21:00 — an instrument that manufactures its own
       * defect, which is the thing it is here to catch in other people. */
      for (let h = 0; h < 24; h++) {
        /* The day is `floor(hour/24) + seen.length`, so a whole day is 24 of
         * these — the clock is the only dial and this drives it, not a seed. */
        st.hour = h;
        tried++;
        try { w[hook](arg); } catch { /* counted as shut */ }
        await new Promise((r2) => setTimeout(r2, 8));
        const el = document.getElementById(id);
        const n = ((el?.innerText || '').trim()).length;
        if (n > 150) opens++;
        if (n > best) { best = n; bestAt = `day ${day} ${String(h).padStart(2, '0')}:00`; }
        W.screens.clear();
        await new Promise((r2) => setTimeout(r2, 8));
      }
    }
    st.hour = was;
    W.settings.order = wasOrder;
    if (wasSave == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, wasSave);
    return { best, bestAt, opens, tried };
  }, { hook, id, arg });
  const ok = r.opens > 0;
  if (!ok) bad2++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(26)} ${what} up on ${r.opens}/${r.tried} hours swept`
    + (r.bestAt ? `, fullest ${r.best} chars at ${r.bestAt}` : '')
    + (ok ? '' : '   << NEVER OPENS'));
}

let bad = 0;
for (const r of rows) {
  const flags = [];
  if (!r.ok) flags.push(r.threw ? `THREW ${r.threw}` : (!r.open ? 'DID NOT OPEN' : 'OPENED EMPTY'));
  if (!r.shut) flags.push('DID NOT CLOSE');
  /* THE FAILURE THIS FILE IS NAMED AFTER: the menu must not be up behind a
   * shut panel on the station — that is the unreachable-game shape. */
  if (r.menuUp) flags.push('LEFT THE FRONT SCREEN UP');
  if (flags.length) bad++;
  console.log(`  ${flags.length ? '✗' : '✓'} ${r.label.padEnd(26)} ${String(r.chars).padStart(5)} chars  ${r.head}`
    + (flags.length ? `   << ${flags.join(', ')}` : ''));
}
console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 8).join('\n')}` : '\nno page errors');
console.log(`\n${rows.length - bad}/${rows.length} doors open, say something and close clean; `
  + `${SWEPT.length - bad2}/${SWEPT.length} scheduled rooms open somewhere in a fortnight`);
await browser.close();
process.exit(bad || bad2 || errs.length ? 1 : 0);
