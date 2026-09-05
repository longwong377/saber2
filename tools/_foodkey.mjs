/**
 * ══════════════════════════════════════════════════════════════════════════
 *  A MEAL, COOKED, CARRIED, EATEN — AND THEN FOUGHT WITH.  V16 Lane B5
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player: *"you can buy food and there could be a small cutscene of it
 * being cooked then you can take it home and store it in your apartment and
 * eat it for buffs"*, and *"certain types of food even give you certain buffs
 * that last for a limited amount of time."*
 *
 * Every link of that was built and the LAST one did not exist. `Food.modsOf` —
 * the one function that says what a meal is doing to you — had zero callers in
 * `src/`; `fullUntil` was a module-local in `main.js` that only the larder's
 * own page read; `Home.js:452` said it outright, *"a meal's EFFECT is never
 * written anywhere at all."* Measured before the fix, exactly this walk: buy
 * Clear broth, watch the five cook lines, eat it — "Clear broth — 2 h of it" —
 * deploy, and `players[0].boonMods.staminaRegen` reads the baseline.
 *
 * `tools/checks/food.mjs` holds the arithmetic. THIS holds the walk, and every
 * step of it is the game's own:
 *
 *   THE COUNTER and THE GALLEY open with `Input.touchHitSet.add('focus')` —
 *     the edge set `actHit` reads, the way `tools/_casinoprobe.mjs` presses.
 *   BUYING and EATING are real `click()`s on the panes' own buttons.
 *   THE COOK is left to run on its own `setTimeout`, in real seconds.
 *   THE RUN is `SABER.deploy()`, and what is read is a fighter's `boonMods`.
 *
 * `world.update` is pumped by hand where a frame is needed: `requestAnimation
 * Frame` is throttled to about ONE TICK A SECOND in this headless Chromium
 * (measured), so waiting on frames is not available. It is the same call
 * `frame()` makes with the same input, which is the harness `_coop.mjs` uses
 * headless, run here against the shipped build.
 *
 *   node tools/pack.mjs /tmp/borz.html && node tools/_foodkey.mjs
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

let bad = 0;
const say = (ok, label, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${detail}`);
};

/**
 * A PURSE, WRITTEN BEFORE THE PAGE LOADS.
 *
 * `Credits.js` caches its record on the first read, so a purse written after
 * boot is a purse the shop never sees. This is the fold's own shape and the
 * game reads it exactly as it reads a saved one — the doctrine's cap is about
 * what a RUN may earn and is not this probe's subject.
 */
await page.addInitScript(() => {
  try {
    localStorage.setItem('saber.credits.v1',
      JSON.stringify({ v: 1, purse: 4000, earned: 4000, spent: 0 }));
  } catch { /* a private window; the shelf will refuse and the probe will say so */ }
});

await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
console.log('front screen up');

/* The three lines every block below uses. `pump` is `frame()`'s own pair. */
const install = () => page.evaluate(() => {
  window.__P = {
    pump(n = 1) {
      const W = window.SABER;
      for (let i = 0; i < n; i++) {
        if (!W.world) return;
        W.world.update(1 / 60, W.input);
        W.input.end?.();
      }
    },
    /* THE DECK'S OWN FLOOR, and it matters: every reach test on the station
     * is a 3-D distance, and a deck change leaves the body at the last deck's
     * height. Standing at the galley of a cabin on deck 44 with y still at 0
     * measures 12.50 m to a fixture 0 m away. */
    goto(x, z, y) {
      const w = window.SABER.world;
      const floor = Number.isFinite(y) ? y : (w._station?.deckY ?? w.player.position.y);
      w.player.position.set(x, floor, z);
    },
    /**
     * WALK TO THE DESK IF THE ROOM HAS ONE, and to the middle of the room if
     * it does not. `Station.counterHere` is a reach test on the counter's own
     * fixture — `st.counters` is where the dressing put every desk — so a
     * probe that stood in the middle of the food court is a probe standing in
     * the aisle, which is exactly what a player would be. The room centre is
     * the fallback for every room that has no desk in it.
     */
    at(id) {
      const w = window.SABER.world;
      const desks = w._station.counters?.get?.(id) || null;
      const desk = desks && desks.find((d) => d.front);
      if (desk) { window.__P.goto(desk.front.x, desk.front.z, desk.front.y); return true; }
      for (const rec of w._station.places.values()) {
        if (rec.place.id === id) { window.__P.goto(rec.place.x, rec.place.z); return true; }
      }
      return false;
    },
    press() {
      const W = window.SABER;
      W.world.paused = false; W.input.enabled = true;
      W.input.touchHitSet.add('focus');
      window.__P.pump(2);
    },
    said: [],
    listen() {
      const w = window.SABER.world;
      window.__P.said = [];
      w.notify = (h, l) => window.__P.said.push(`${h} :: ${l}`);
    },
  };
});

/* ══ 1. #17 THE FOOD COURT — buy a dish, and watch it cooked ═════════════ */

await page.evaluate(() => window.SABER.enterStation({ deck: 40 }));
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
await install();

const shop = await page.evaluate(() => {
  const W = window.SABER, P = window.__P;
  if (!P.at(17)) return { why: '#17 The food court is not on this deck' };
  P.listen();
  P.press();
  window.__under = (() => {
    const w = W.world, p = w.player.position;
    let best = null, d2 = 1e9;
    for (const rec of w._station.places.values()) {
      const pl = rec.place;
      const dx = p.x - pl.x, dz = p.z - pl.z, d = dx * dx + dz * dz;
      if (d < d2) { d2 = d; best = { id: pl.id, name: pl.name, verb: pl.verb, dist: Math.sqrt(d) }; }
    }
    return best;
  })();
  const pane = document.getElementById('counter');
  if (!pane || pane.classList.contains('hidden')) {
    return { why: `the key at #17 raised no counter (state '${W.screens.state}', `
      + `standing over ${JSON.stringify(window.__under || null)})` };
  }
  const btns = [...pane.querySelectorAll('button.buy')].filter((b) => !b.disabled);
  if (!btns.length) return { why: `nothing on the shelf is affordable: ${pane.innerText.slice(0, 160)}` };
  const btn = btns[0];
  const label = btn.closest('.row')?.querySelector('b')?.textContent || '?';
  btn.click();
  return { why: null, label, rows: btns.length, state: W.screens.state };
});

if (shop.why) { say(false, 'the food court opens and sells through the key', shop.why); }
else say(true, 'the food court opens and sells through the key',
  `screens.state '${shop.state}', ${shop.rows} dishes out, bought "${shop.label}"`);

/* THE COOK RUNS ON ITS OWN CLOCK — three and a half to seven real seconds of
 * `setTimeout`, five lines in the banner, and the dish in the larder at the
 * end of it. Waited for through the FOLD, which is where it lands. */
const cooked = await page.waitForFunction(() => {
  try {
    const s = JSON.parse(localStorage.getItem('saber.station.v1') || '{}');
    return (s.home?.store?.food || []).length > 0;
  } catch { return false; }
}, null, { timeout: 30000 }).then(() => true).catch(() => false);

const larderRows = await page.evaluate(() => {
  try {
    const s = JSON.parse(localStorage.getItem('saber.station.v1') || '{}');
    return s.home?.store?.food || [];
  } catch { return []; }
});
say(cooked, 'it is cooked and it lands in the larder at home', JSON.stringify(larderRows));
const heard = await page.evaluate(() => window.__P.said);
say(heard.length >= 5, 'and the cook says every line of it out loud',
  heard.map((s) => s.split(' :: ')[1]).join(' · ').slice(0, 150) || '(silence)');

/**
 * A SECOND ONE, LEFT IN THE CUPBOARD.
 *
 * *"you can even buy food and take it to your apartment and save it for
 * later."* One dish is eaten below; this is the one that is saved, and what
 * happens to it at the end of a run is the decision the last block measures.
 * Bought after the first has landed rather than beside it, because
 * `cancelCook` gives the counter one man at a time — a second order while the
 * first is on the burner cancels it, which is right and is why they queue here.
 */
const second = await page.evaluate(() => {
  const pane = document.getElementById('counter');
  const btns = [...pane.querySelectorAll('button.buy')].filter((b) => !b.disabled);
  if (btns.length < 2) return { why: 'the shelf has only one thing on it today' };
  const btn = btns[1];
  const label = btn.closest('.row')?.querySelector('b')?.textContent || '?';
  btn.click();
  return { why: null, label };
});
const twoIn = await page.waitForFunction(() => {
  try {
    const s = JSON.parse(localStorage.getItem('saber.station.v1') || '{}');
    return (s.home?.store?.food || []).reduce((a, r) => a + (r.n | 0), 0) >= 2;
  } catch { return false; }
}, null, { timeout: 30000 }).then(() => true).catch(() => false);
say(twoIn, 'and a second one is bought and kept for later',
  second.why || `${second.label} — larder now ${JSON.stringify(await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('saber.station.v1')).home.store.food; } catch { return null; }
  }))}`);

/* ══ 2. #27 YOUR CABIN — the galley, and eating it ═══════════════════════ */

/* THE LIFT, which is how a player changes decks — `world.onDeckLift` is the
 * hook `liftKey` raises with the row the car was called to, and it tears the
 * old deck down through `leaveStation` on the way. Calling `enterStation`
 * again from inside a station skips that teardown and builds the new deck over
 * a world that is still standing. */
await page.evaluate(() => { window.SABER.world.onDeckLift({ deck: 44, level: 'station' }); });
await page.waitForFunction(
  () => window.SABER.world?._stationFloor === 44 && !!window.SABER.world?._station
    && !!window.SABER.world?.player,
  null, { timeout: 300000 });
await install();

const ate = await page.evaluate(() => {
  const W = window.SABER, P = window.__P;
  const h = W.world._home;
  if (!h?.galley) {
    return { why: `the cabin has no galley in it (home ${!!h}, homes ${(W.world._homes || []).length}, `
      + `deck ${W.world._stationFloor}, ids ${[...W.world._station.places.values()].map((r) => r.place.id).join(',')})` };
  }
  P.listen();
  P.goto(h.galley.at.x, h.galley.at.z, h.galley.at.y);
  P.press();
  const pane = document.getElementById('larder');
  if (!pane || pane.classList.contains('hidden')) {
    const p = W.world.player.position;
    return { why: `the key at the galley raised no larder (state '${W.screens.state}', `
      + `player ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} galley `
      + `${h.galley.at.x.toFixed(1)},${h.galley.at.y.toFixed(1)},${h.galley.at.z.toFixed(1)} `
      + `d=${p.distanceTo(h.galley.at).toFixed(2)} spot=${JSON.stringify(h.spot)} said=${JSON.stringify(P.said)})` };
  }
  const btn = [...pane.querySelectorAll('button.buy')][0];
  if (!btn) return { why: `the larder is empty: ${pane.innerText.slice(0, 160)}` };
  const label = btn.closest('.row')?.querySelector('b')?.textContent || '?';
  btn.click();
  return { why: null, label, said: P.said.slice(), text: document.getElementById('larder').innerText.slice(0, 120) };
});

if (ate.why) say(false, 'the larder opens at the galley and the meal goes down', ate.why);
else say(ate.said.some((s) => /THE LARDER/.test(s) && /h of it/.test(s)),
  'the larder opens at the galley and the meal goes down',
  `${ate.said.join(' | ') || '(silence)'}`);

/* ══ 3. AND THE RUN IS FOUGHT ON IT ══════════════════════════════════════ */

const run = await page.evaluate(async () => {
  const W = window.SABER;
  W.screens.clear(); W.resume();
  W.settings.mode = 'skirmish';
  W.settings.level = 'wood';
  /* STRAIGHT TO THE GROUND. `hangarFirst()` sends an ordinary deploy through
   * the flight deck first, and the deck is a room rather than a fight —
   * `Player._readInput` returns before the comm on it. `instantSpawn` is the
   * game's own setting for exactly that and is what the option means. */
  W.settings.instantSpawn = true;
  await W.deploy();
  const p = W.world?.players?.[0];
  if (!p) return { why: 'the skirmish did not deploy' };
  return {
    why: null,
    provisions: W.world.run?.provisions || null,
    mods: { staminaRegen: p.boonMods.staminaRegen, ward: p.boonMods.ward,
      flowGain: p.boonMods.flowGain, moveSpeed: p.boonMods.moveSpeed },
  };
});

if (run.why) say(false, 'the run is fought on what was eaten', run.why);
else {
  const P = run.provisions || {};
  const keys = Object.keys(P);
  say(keys.length > 0, 'the meal reaches the run as a provision',
    `run.provisions = ${JSON.stringify(P)}`);
  /* THE NUMBER ITSELF. Whatever the day's shelf sold, the mod it carries has
   * to be ON the fighter — not the baseline the audit measured. */
  const moved = keys.filter((k) => P[k] !== 1 && run.mods[k] !== undefined);
  say(moved.length > 0 && moved.every((k) => Math.abs(run.mods[k] - (run.mods[k] / P[k]) * P[k]) < 1e-9),
    "and it is on the fighter's own numbers",
    moved.map((k) => `${k} ${run.mods[k].toFixed(3)} (x${P[k]})`).join(', ') || 'nothing moved');
}

/* ══ 4. AND THE CUPBOARD SURVIVES THE RUN IT WAS NOT EATEN IN ════════════ */

/**
 * *"you can even buy food and take it to your apartment and save it for
 * later."*
 *
 * `record()` — the funnel EVERY ending goes through, a win, a wipe and a
 * walk-away alike — called `emptyLarder()` unconditionally, so the cupboard
 * was destroyed by the next run whether you ate out of it or not. Measured
 * before the change, exactly this walk: two dishes stowed, deploy, quit at
 * 25 s — larder 0 rows, and nothing said why.
 *
 * It is emptied by a DEATH now, which is where the player's own words put it:
 * *"powerups … that do not persist when you die."* The two halves are the two
 * blocks below, and the walk-away is pressed rather than called — Escape to
 * the pause card, and the card's own Menu button.
 */
const larderNow = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('saber.station.v1') || '{}').home?.store?.food || []; }
  catch { return []; }
});
const before = await larderNow();
const walked = await page.evaluate(async () => {
  const W = window.SABER;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  /* `#btn-quit` IS the pause card's "Abandon run" — `Menu.js` binds it to
   * `onQuit`, which is `quitToMenu`, which is the funnel `record()` sits in. */
  const btn = document.getElementById('btn-quit');
  if (!btn) return { why: `the pause card has no abandon button (state '${W.screens.state}')` };
  btn.click();
  return { why: null, state: W.screens.state, label: btn.textContent.trim() };
});
const afterWalk = await larderNow();
if (walked.why) say(false, 'walking away from a run keeps what you saved', walked.why);
else say(JSON.stringify(afterWalk) === JSON.stringify(before),
  'walking away from a run keeps what you saved',
  `"${walked.label}" on the pause card; larder ${JSON.stringify(before)} → ${JSON.stringify(afterWalk)}`);

/* AND A DEATH TAKES IT. The doctrine's own sentence, and the half that has to
 * stay true — a cupboard that survived a wipe would be the permanent buy the
 * amendment refuses. */
const died = await page.evaluate(async () => {
  const W = window.SABER;
  W.settings.instantSpawn = true;
  W.settings.mode = 'skirmish';
  await W.deploy();
  const w = W.world;
  if (!w?.player) return { why: 'the second run did not deploy' };
  W.screens.clear(); W.resume();
  w.paused = false;
  /* A MINUTE OF FRAMES. A body on nought is DOWN and not dead — `onLocalDown`
   * raises the card and the bleed-out runs on the world's own clock — so the
   * wipe is a thing you wait for rather than a thing you assert on the frame
   * you cause it. */
  for (let i = 0; i < 3600 && !w.over; i++) {
    w.player.hp = 0;
    w.update(1 / 60, W.input);
    W.input.end?.();
  }
  return { why: null, over: !!w.over, downed: !!w.player.downed, state: W.screens.state };
});
const afterDeath = await larderNow();
if (died.why) say(false, 'and a death takes it', died.why);
else say(died.over && afterDeath.length === 0, 'and a death takes it',
  `world.over ${died.over}; larder ${JSON.stringify(afterWalk)} → ${JSON.stringify(afterDeath)}`);

console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 8).join('\n')}` : '\nno page errors');
console.log(`\n${bad ? `${bad} FAILED` : 'all clear'}`);
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
