/**
 * ══════════════════════════════════════════════════════════════════════════
 *  #60 AND THE JOB BOARD, PRESSED IN A REAL BROWSER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS EXISTS AND WHY NOTHING HEADLESS REPLACES IT ─────────────────
 *
 * `Games.js` and `Quests.js` were both finished, both fully checked, and both
 * absent from every build this project has ever shipped: `tools/pack.mjs`
 * walks the module graph from `main.js`, nothing under `src/` imported either
 * file, and their suites reached them with a direct `import()`. Seven checks
 * green over two systems no player could touch.
 *
 * `tools/checks/_shipped.mjs` now walks that graph and fails if either loses
 * its importer, which catches the defect at the file level. This answers the
 * question that walk cannot: whether a person STANDING IN THE ROOM AND
 * PRESSING THE KEY gets a game.
 *
 * ── AND IT PRESSES THE KEY RATHER THAN CALLING THE HOOK ──────────────────
 *
 * `tools/_doorprobe.mjs` calls `world.onX(...)` directly, which is the right
 * instrument for "does the panel open". It is the wrong one here, because the
 * defect being guarded against is a BRANCH THAT NEVER RUNS — the audit found
 * exactly that shape one branch away, where the pit's door returned on its own
 * refusal and `#20`'s betting card was unreachable behind it. Calling the hook
 * would have been green over that too.
 *
 * So this walks the player to the door and puts a press into `Input`'s own
 * edge set, which is what `Player._readInput` reads and what `stationKey`
 * hangs off. Everything after that is the game's own path.
 *
 *   node tools/pack.mjs /tmp/borz.html
 *   node tools/_casinoprobe.mjs
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
console.log('front screen up');

await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
const where = await page.evaluate(() => ({
  deck: window.SABER.world._stationFloor,
  places: window.SABER.world._station.places?.size ?? 0,
}));
console.log(`station up — deck ${where.deck}, ${where.places} places`);

/**
 * ══ HOW A PRESS IS MADE, AND IT IS THE GAME'S OWN ════════════════════════
 *
 * Every block below ends with the same three lines:
 *
 *   W.input.touchHitSet.add('focus');
 *   await two animation frames
 *
 * `Input.touchHitSet` is the edge set `act`/`actHit` read beside the keyboard
 * and the pad, and `Input.end()` clears it at the end of every frame — so one
 * add is exactly one press on exactly one frame, which is what a tap is.
 * Nothing here fabricates a key code or reaches past a binding, and the path
 * from there is the game's: `Player._readInput` → `stationKey(world)` → the
 * branch. Two frames because the first is the one that reads it.
 *
 * AND `resume()` RATHER THAN `clear()` BETWEEN PRESSES. `Screens.take` sets
 * `world.paused` and drops `input.enabled`; `clear()` takes the card down and
 * restores neither, so after the first room that raises a panel the frame loop
 * stops calling `world.update` and no further press is ever READ. The first
 * cut of the sweep below pressed in forty rooms and was heard in one.
 */

let bad = 0;
const say = (ok, label, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(46)} ${detail}`);
};

/* ── 1. #60 THE WHEELHOUSE, THROUGH THE KEY ───────────────────────────── */

const spy = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  const P = w._station.places;
  let row = null;
  for (const rec of P.values()) if (rec.place.id === 60) row = rec.place;
  if (!row) return { why: '#60 is not built on this deck' };
  let got = null;
  w.onCasino = (room) => { got = room; return true; };
  w.player.position.set(row.x, w.player.position.y, row.z);
  W.input.touchHitSet.add('focus');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  delete w.onCasino;
  if (!got) return { why: 'the key raised nothing at #60' };
  return {
    why: null,
    name: got.name, hour: got.hour, day: got.day,
    tables: got.tables.map((t) => t.id),
    /* SABACC: a real hand, a real seat, a real decision to take. */
    hand: got.sabacc.hand, can: got.sabacc.can, round: got.sabacc.round,
    seats: got.sabacc.seats.map((s) => ({ name: s.name, species: s.species, push: s.push })),
    /* DEJARIK: a board with legal moves on it. */
    ring: got.dejarik.board.ring.filter(Boolean).length,
    moves: got.dejarik.moves.length,
    against: got.dejarik.against?.name,
    /* THE DRUM: where the wheel actually stands this hour. */
    drumAt: got.drum.at, drumDeck: got.drum.deck, drumPrev: got.drum.prev.length,
    door: [row.door[0], row.door[1]],
  };
});

if (spy.why) { say(false, '#60 The Wheelhouse raises the tables', spy.why); }
else {
  say(spy.tables.join(',') === 'sabacc,dejarik,drum', '#60 raises three tables', spy.tables.join(', '));
  say(spy.hand.length === 2 && spy.can.length === 3, 'sabacc is dealt and waiting on you',
    `hand [${spy.hand}] round ${spy.round}, ${spy.can.join('/')}`);
  say(spy.seats.length >= 2 && spy.seats.every((s) => s.name && s.species),
    'the opponents are named residents',
    spy.seats.map((s) => `${s.name} (${s.species}, push ${s.push.toFixed(1)})`).join('; '));
  say(spy.moves >= 8 && spy.ring === 10, 'the dejarik column has a board and legal moves',
    `${spy.ring} pieces, ${spy.moves} moves, against ${spy.against}`);
  say(spy.drumAt >= 0 && spy.drumPrev === 6, 'the drum stands somewhere and has a form book',
    `segment ${spy.drumAt} = ${spy.drumDeck === null ? 'the house' : 'deck ' + spy.drumDeck}, 6 hours of history`);
}

/**
 * ── AND THE ROOM WORKS WITH NO PANEL WIRED ───────────────────────────────
 *
 * `main.js` owns the overlay and does not have one yet. A room whose only
 * behaviour is a hook nobody installed is a room that ships looking built and
 * is not — which is the whole defect this file is about, one level up. So the
 * branch answers through `notify` when nothing takes it, and this is that.
 */
const said = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === 60) row = rec.place;
  const said = [];
  const was = w.notify;
  w.notify = (head, line) => { said.push([head, line]); };
  w.player.position.set(row.x, w.player.position.y, row.z);
  W.input.touchHitSet.add('focus');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  w.notify = was;
  return said;
});
say(said.some(([h, l]) => /WHEELHOUSE/.test(h) && /Drum/.test(l)),
  'with no panel wired the room still speaks', said.map((s) => s.join(' — ')).join(' | ') || '(silence)');

/* ── 2. THE JOB BOARD, THROUGH THE SAME KEY ───────────────────────────── */

/**
 * ══ THE ROOM IS CHOSEN HERE AND NOT SWEPT FOR IN THE PAGE ════════════════
 *
 * The first cut pressed in every room on the deck until something answered.
 * It is a worse instrument for two reasons and the second is fatal: a press at
 * `#13 The Databank` raises a KIOSK, which is the front screen with the saber
 * preview on it, and rendering that under swiftshader costs minutes a room —
 * the sweep did not finish. And a probe that finds the door by walking into
 * every door cannot say WHICH door it meant.
 *
 * `Quests.offersAt` is pure and the same function the branch calls, so the
 * room is worked out here, in node, off the station's own day — and the page
 * is asked exactly one question: standing in THAT room, does the key raise
 * that job.
 */
const { PLACES } = await import('../src/game/StationPlan.js');
const { offersAt } = await import('../src/game/Quests.js');
const { countersAt } = await import('../src/game/Vendors.js');
const { venueAtPlace } = await import('../src/game/Tote.js');
const { pitAtPlace } = await import('../src/game/Pits.js');
const CLAIMED = new Set([13, 28, 41, 42, 43, 44, 50, 56, 57, 60, 2, 3, 4, 5, 6]);
const day = await page.evaluate(() => {
  /* The station's own day, read the way the branch reads it. */
  try { return JSON.parse(localStorage.getItem('saber.station.v1') || '{}').seen?.length || 0; } catch { return 0; }
});
const target = PLACES.find((p) => p.deck === 40 && !p.external && p.verb && !CLAIMED.has(p.id)
  && !p.kiosk && !countersAt(p.id).length && !pitAtPlace(p.id) && !venueAtPlace(p.id)
  && offersAt(p.id, day).length);

const quest = target ? await page.evaluate(async ({ id }) => {
  const W = window.SABER, w = W.world;
  W.screens.clear(); W.resume();
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === id) row = rec.place;
  if (!row) return { why: `#${id} is not built on this deck` };
  let got = null;
  w.onQuest = (board) => { got = board; return true; };
  w.player.position.set(row.x, w.player.position.y, row.z);
  W.input.touchHitSet.add('focus');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  delete w.onQuest;
  if (!got) return { why: `the key raised nothing at #${id}` };
  return {
    why: null, place: got.place, name: got.name, day: got.day,
    offers: got.offers.map((o) => ({ shape: o.shape, line: o.line, giver: o.giver, pay: o.pay })),
    carrying: got.carrying.length, owed: got.owed.length,
  };
}, { id: target.id }) : { why: `nothing on deck 40 is offering a job on day ${day}` };

if (quest.why) say(false, 'a room on deck 40 offers a job', quest.why);
else {
  say(quest.offers.length > 0 && quest.offers.every((o) => o.line && o.giver && o.pay > 0),
    'the job board opens with a real job in it',
    `#${quest.place} ${quest.name} day ${quest.day}: "${quest.offers[0].line}" `
    + `(${quest.offers[0].shape}, ${quest.offers[0].pay} cr, giver ${quest.offers[0].giver})`);
}

/* ── 3. AND NOTHING ELSE MOVED. The two branches are the last two in
 *      `stationKey`, so a room that had a door before must still have it. */
const doors = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  W.screens.clear(); W.resume();
  const out = {};
  for (const [id, hook] of [[18, 'onTote'], [20, 'onPit'], [22, null]]) {
    let row = null;
    for (const rec of w._station.places.values()) if (rec.place.id === id) row = rec.place;
    if (!row) { out[id] = 'not on this deck'; continue; }
    let fired = null;
    const was = hook ? w[hook] : null;
    if (hook) w[hook] = (...a) => { fired = hook; return true; };
    const said = [];
    const wasN = w.notify; w.notify = (h, l) => said.push(h);
    w.player.position.set(row.x, w.player.position.y, row.z);
    W.input.touchHitSet.add('focus');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    w.notify = wasN;
    if (hook) { if (was) w[hook] = was; else delete w[hook]; }
    out[id] = fired || said.join('/') || '(nothing)';
    W.screens.clear();
    W.resume();
    await new Promise((r) => requestAnimationFrame(r));
  }
  return out;
});
say(doors[18] === 'onTote', "#18 The Pit still reaches its card", String(doors[18]));
say(doors[20] === 'onPit', '#20 The Arena still reaches the pit', String(doors[20]));

console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 8).join('\n')}` : '\nno page errors');
console.log(`\n${bad ? `${bad} FAILED` : 'all clear'}`);
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
