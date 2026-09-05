/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ENGINEERING MINIGAME, WORKED BY A PLAYER — V16 §A3
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The audit's reading of what shipped, and it was exact: *"opened both benches
 * (#50 Fabrication, #42 Comms). buttons: 0, inputs: 0, sliders: 0. Every row
 * reads `open` or `0/12 calls`, and it reads 0/12 FOR EVER."* `Bench.noteCall`,
 * `Bench.setTuning` and `Bench.tuningFor` had zero callers anywhere;
 * `Stratagems.js` and `FireMission.js` never imported `Bench.js`. It was a
 * printed price list of things that could not be bought.
 *
 * `tools/checks/bench.mjs` holds the arithmetic and the doctrine, and
 * `stratagems.mjs` holds the two seams headless. THIS walks it:
 *
 *   #42 THE COMMS ROOM opens with `Input.touchHitSet.add('focus')` — the edge
 *     set `actHit` reads — three dials are set with real `click`s and a real
 *     `input` value, and SEND is a real click.
 *   #50 FABRICATION fits a variant the same way.
 *   THE RUN then SPELLS A CODE with the keys: `stratagem` held in
 *     `Input.touchHeld` and the four directions tapped into `touchHitSet`,
 *     which is what `Player._stratagemInput` reads. The code is not looked up
 *     anywhere — it is FOUND by pressing, four letters at a time, exactly as a
 *     player who has forgotten it would.
 *
 * What is then read is the ledger on the disk and the cooldown on the call.
 *
 *   node tools/pack.mjs /tmp/borz.html && node tools/_benchkey.mjs
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
const bench = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('saber.bench.v1') || 'null'); } catch { return null; }
});

await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
console.log('front screen up');

await page.evaluate(() => window.SABER.enterStation({ deck: 48 }));
await page.waitForFunction(() => !!window.SABER.world?._station && !!window.SABER.world?.player,
  null, { timeout: 300000 });

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
    at(id) {
      const w = window.SABER.world;
      for (const rec of w._station.places.values()) {
        if (rec.place.id === id) {
          w.player.position.set(rec.place.x, w._station.deckY ?? w.player.position.y, rec.place.z);
          return true;
        }
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
    listen() { window.__P.said = []; window.SABER.world.notify = (h, l) => window.__P.said.push(`${h} :: ${l}`); },
  };
});
await install();

/* ══ 1. #42 THE COMMS ROOM — three dials, and they are real controls ═════ */

const opened = await page.evaluate(() => {
  const W = window.SABER, P = window.__P;
  if (!P.at(42)) return { why: '#42 Comms & sensor is not on this deck' };
  P.listen();
  P.press();
  const pane = document.getElementById('bench');
  if (!pane || pane.classList.contains('hidden')) {
    return { why: `the key at #42 raised no bench (state '${W.screens.state}')` };
  }
  return {
    why: null, state: W.screens.state,
    buttons: pane.querySelectorAll('button').length,
    inputs: pane.querySelectorAll('input').length,
    rows: pane.querySelectorAll('.row').length,
    text: pane.innerText.slice(0, 90).replace(/\n/g, ' / '),
  };
});
if (opened.why) say(false, '#42 opens a bench through the key', opened.why);
else say(opened.buttons > 0, '#42 opens a bench through the key',
  `state '${opened.state}', ${opened.rows} rows, ${opened.buttons} buttons, ${opened.inputs} inputs`);

const dialled = await page.evaluate(() => {
  const pane = document.getElementById('bench');
  const btn = [...pane.querySelectorAll('button[data-solve]')].find((b) => !b.disabled);
  if (!btn) return { why: `no call offers a solution: ${pane.innerText.slice(0, 200)}` };
  const id = btn.dataset.solve;
  btn.click();
  const el = document.getElementById('bench');
  const dials = [...el.querySelectorAll('input[type=range]')];
  const marks = [...el.querySelectorAll('[data-mark]')].map((m) => m.textContent);
  return { why: null, id, dials: dials.length, marks };
});
if (dialled.why) say(false, 'a firing solution opens with three dials on it', dialled.why);
else say(dialled.dials === 3 && dialled.marks.length === 3,
  'a firing solution opens with three dials on it',
  `${dialled.id}: ${dialled.dials} sliders, marks ${dialled.marks.join('/')}`);

/**
 * THE SOLUTION ITSELF, ON EVERY CALL THE ROOM OFFERS.
 *
 * Read where the marks are, put the dials there, send. One call at a time,
 * because the room takes one solution per call per hour — which is the point
 * of the gate, and this walks the whole board rather than asserting about one
 * row. It also means whatever code the run below happens to spell is a call
 * with a solution laid on it.
 */
const sent = await page.evaluate(async () => {
  const P = window.__P;
  P.listen();
  const done = [];
  for (let i = 0; i < 12; i++) {
    /* The block above left the pane on a dial view; Back is how a player gets
     * out of one, and it is the room's own button. */
    document.getElementById('bench').querySelector('button[data-do="back"]')?.click();
    const list = document.getElementById('bench');
    const open = [...list.querySelectorAll('button[data-solve]')].find((b) => !b.disabled);
    if (!open) break;
    const id = open.dataset.solve;
    open.click();
    const el = document.getElementById('bench');
    const at = {};
    for (const m of el.querySelectorAll('[data-mark]')) at[m.dataset.mark] = Number(m.textContent);
    for (const d of el.querySelectorAll('input[type=range]')) {
      d.value = String(at[d.dataset.dial] ?? 0.5);
      d.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.querySelector('button[data-do="send"]').click();
    done.push(id);
  }
  return { done, said: P.said.slice(), text: document.getElementById('bench').innerText.slice(0, 200) };
});
const afterSolve = await bench();
say(!!afterSolve?.tuned && Object.keys(afterSolve.tuned).length > 0,
  'sending it lays a tuning that a run will read',
  `${sent.done.length} calls solved; ${sent.said[0] || '(silence)'} — `
  + `store.tuned = ${JSON.stringify(afterSolve?.tuned)}`);
say(!!afterSolve?.solved && Object.keys(afterSolve.solved).length > 0,
  'and the hour is spent — the room does not take a second one',
  `store.solved = ${JSON.stringify(afterSolve?.solved)}`);
const reOpen = await page.evaluate(() => {
  const pane = document.getElementById('bench');
  const rows = [...pane.querySelectorAll('button[data-solve]')];
  const spent = rows.filter((b) => b.disabled).map((b) => b.dataset.solve);
  return { spent, total: rows.length };
});
say(reOpen.spent.length > 0, 'and the panel says so rather than offering it again',
  `${reOpen.spent.length} of ${reOpen.total} calls are spent for this hour`);

/* ══ 2. #50 FABRICATION — fit a shell ════════════════════════════════════ */

const fitted = await page.evaluate(() => {
  const W = window.SABER, P = window.__P;
  W.screens.clear(); W.resume();
  if (!P.at(50)) return { why: '#50 Fabrication is not on this deck' };
  P.press();
  const pane = document.getElementById('bench');
  if (!pane || pane.classList.contains('hidden')) {
    return { why: `the key at #50 raised no bench (state '${W.screens.state}')` };
  }
  const btn = [...pane.querySelectorAll('button[data-fit]')].find((b) => !b.disabled && b.dataset.v);
  if (!btn) return { why: `nothing is open to fit: ${pane.innerText.slice(0, 200)}` };
  const id = btn.dataset.fit, v = btn.dataset.v;
  btn.click();
  return { why: null, id, v, text: document.getElementById('bench').innerText.slice(0, 160).replace(/\n/g, ' / ') };
});
const afterFit = await bench();
if (fitted.why) say(false, '#50 fits a variant through the key', fitted.why);
else say(afterFit?.picked?.[fitted.id] === fitted.v, '#50 fits a variant through the key',
  `${fitted.id} → ${fitted.v}; store.picked = ${JSON.stringify(afterFit?.picked)}`);

/* ══ 3. AND A RUN SPELLS A CODE, WITH THE KEYS ═══════════════════════════ */

const called = await page.evaluate(async () => {
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
  const w = W.world;
  if (!w?.player?.stratagems) return { why: 'the skirmish did not deploy' };
  const S = w.player.stratagems;
  const I = W.input;
  const pump = (n = 1) => { for (let i = 0; i < n; i++) { w.update(1 / 60, I); I.end?.(); } };
  /**
   * OFF THE DEPLOY CARD AND ONTO THE GROUND FIRST.
   *
   * `deploy()` ends on FLAGSHIP §5's 0:00 card with the world stopped, and the
   * insertion flight runs after it — a body still in the drop reads no input
   * at all, so a code spelled into it is a code nobody hears. The card is
   * dropped through `Screens` and then five seconds of the game's own frames
   * are run, which is the flight.
   */
  W.screens.clear(); W.resume();
  w.paused = false; I.enabled = true;
  pump(300);
  /**
   * A FULL SUPPLY LINE, because the search below spells codes it does not know.
   *
   * A completed code that cannot be paid for is refused inside `_open` and
   * `feed` answers `false` — indistinguishable, from outside, from a wrong
   * letter. The line builds by itself in a real fight; this hands it what four
   * minutes of one would, so the walk of the code tree is measuring the tree
   * and not the wallet.
   */
  if (w.support) w.support.value = 400;
  const DIRS = ['moveF', 'moveL', 'moveB', 'moveR'];

  /**
   * FIND THE CODE BY PRESSING IT. `rollCodes` deals a new code off the run's
   * own seed, so there is no table to look it up in — and a probe that read one
   * would not be pressing anything. A wrong letter clears the entry (that is
   * `feed`'s own rule), so each attempt re-spells the prefix and tries the next
   * direction, which is exactly what a player who has forgotten the code does.
   */
  const spell = (letters) => {
    I.touchHeld.add('stratagem');
    pump(1);
    for (const d of letters) { I.touchHitSet.add(d); pump(1); }
  };
  const release = () => { I.touchHeld.delete('stratagem'); pump(2); };

  /**
   * A DEPTH-FIRST WALK OF THE CODE TREE, WITH BACKTRACKING.
   *
   * A greedy walk stalls, and the reason is worth writing down: a completed
   * code that is REFUSED — no support, or a cooldown — makes `feed` answer
   * `false` and clear the entry, which from outside is indistinguishable from a
   * wrong letter. So a branch that ends in a call this run cannot afford looks
   * like a dead end at depth 6 and the whole search gives up. Backing up and
   * trying the next direction is what a player does, and it is what this does.
   */
  const prefix = [];
  const tried = [];
  let row = null;
  for (let step = 0; step < 60 && !row; step++) {
    if (!tried[prefix.length]) tried[prefix.length] = new Set();
    const seen = tried[prefix.length];
    let took = null;
    for (const d of DIRS) {
      if (seen.has(d)) continue;
      seen.add(d);
      release();
      S.entry = '';
      spell([...prefix, d]);
      if (S.designating) { row = { ...S.designating.s }; took = d; break; }
      if (S.entry.length === prefix.length + 1) { took = d; break; }
    }
    if (row) break;
    if (took) { prefix.push(took); continue; }
    /* Nothing here. Back up, and the level above will take its next letter. */
    tried[prefix.length] = null;
    if (!prefix.length) break;
    prefix.pop();
  }
  if (!row) {
    /* Diagnostics, and they are the three things that can be wrong: the key is
     * not being read as held, the letters are not being read as taps, or the
     * call is being refused before the entry can grow. */
    I.touchHeld.add('stratagem');
    pump(1);
    const arming = S.arming;
    I.touchHitSet.add('moveF');
    pump(1);
    return { why: `no code could be spelled in ${prefix.length} letters (entry '${S.entry}', `
      + `arming ${arming}, act('stratagem') ${I.act('stratagem')}, held ${[...I.touchHeld].join('/')}, `
      + `prefix '${prefix.join('')}', mode ${w.settings.mode}, `
      + `after one tap '${S.entry}', said '${S.said}', `
      + `support ${w.support?.value?.toFixed?.(0) ?? 'none'}, alive ${w.player.alive})` };
  }
  const cooldownAtOpen = S.cooldowns[row.id];
  release();
  const pending = S.pending.length;
  return {
    why: null, id: row.id, name: row.name, letters: prefix.length,
    stockCooldown: row.cooldown, stockRadius: row.radius ?? null,
    cooldown: cooldownAtOpen, pending,
    markRadius: S.pending[0]?.radius ?? null,
  };
});

if (called.why) say(false, 'a call spelled with the keys is counted on the bench', called.why);
else {
  const store = await bench();
  const n = store?.called?.[called.id] ?? 0;
  say(n >= 1, 'a call spelled with the keys is counted on the bench',
    `${called.name} spelled in ${called.letters} letters; ledger ${called.id} = ${n}`);
  const t = store?.tuned?.[called.id];
  const v = store?.picked?.[called.id];
  /* ONE FRAME OF TOLERANCE, and it is a real frame: the cooldown is set inside
   * `_open` on the same frame `Stratagems.update` then ticks it, so a wait read
   * on the frame it was started is one dt short of the number that was set. */
  const want = called.stockCooldown * (t?.cooldown ?? 1) * (t ? 1 : 1);
  say(Math.abs(called.cooldown - want) < 0.02 && (!t || want < called.stockCooldown - 0.5),
    'and the wait it starts is the bench\'s, not the table\'s',
    `${called.id} stock ${called.stockCooldown}s → ${called.cooldown}s`
    + `${t ? ` (tuning x${t.cooldown.toFixed(3)})` : ''}${v ? ` (fitted ${v})` : ''}`);
}

console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 8).join('\n')}` : '\nno page errors');
console.log(`\n${bad ? `${bad} FAILED` : 'all clear'}`);
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
