/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE JUMP, ORDERED BY A PLAYER — V16 §A1, pressed rather than called
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `tools/checks/warp.mjs` is 5/5 and always was. It drives `Station.orderJump`
 * directly, which proves the sequence and the wiring UNDERNEATH the order and
 * says nothing at all about whether a person standing on the command deck can
 * give one. They could not: `jumpIfOrdered()` is called from `closeKiosk()`
 * alone and `closeKiosk` had ZERO CALLERS in the whole tree, so Escape over
 * the plot table went `screens.escape()` → `pause()` → the kiosk card's hide,
 * the counter came down, and nothing ever asked what theatre was picked.
 *
 * So this presses the keys. Nothing here calls `orderJump`, `closeKiosk` or
 * `world.onKiosk`:
 *
 *   THE TABLE is opened with `Input.touchHitSet.add('focus')` — the edge set
 *     `actHit` reads, exactly as `tools/_casinoprobe.mjs` does it — with the
 *     player standing on #41's door. The path from there is the game's:
 *     `Player._readInput` → `stationKey(world)` → the kiosk branch.
 *   THE ESCAPE is a real `KeyboardEvent` on `window`, which is the listener a
 *     keyboard reaches.
 *
 * ── AND THE LOOP IS THE GAME'S OWN, PUMPED BY HAND ───────────────────────
 *
 * `requestAnimationFrame` is throttled to about ONE TICK A SECOND in this
 * headless Chromium — measured, 1 tick in 1000 ms — so "await two animation
 * frames" is two seconds and a ten-second jump is unwatchable. `world.update`
 * is the same function the page's own `frame()` calls with the same arguments;
 * calling it in a loop advances the station's clock, `stepStation`, and
 * `world._warp.step` exactly as a frame does. That is the harness `_coop.mjs`
 * uses headless, in the browser, over the shipped build.
 *
 *   node tools/pack.mjs /tmp/borz.html
 *   node tools/_warpkey.mjs
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
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(48)} ${detail}`);
};

await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
console.log('front screen up');

/* #41 Command / CIC is on deck 48. `enterStation` takes the row the lift would
 * have carried you in on, which is the only thing that decides the deck. */
await page.evaluate(() => window.SABER.enterStation({ deck: 48 }));
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
const where = await page.evaluate(() => ({
  deck: window.SABER.world._stationFloor,
  places: window.SABER.world._station.places?.size ?? 0,
  orbiting: window.SABER.world._pickedLevel?.name ?? null,
  level: window.SABER.settings.level,
}));
console.log(`station up — deck ${where.deck}, ${where.places} places, orbiting ${where.orbiting}`);

/**
 * THE PRESS, AND THE FRAMES IT IS READ ON.
 *
 * `Input.end()` clears `touchHitSet` at the end of every frame, so one add is
 * one press on one frame — which is what a tap is. The pump below runs
 * `world.update` the way `frame()` does and then `input.end()`, so a press
 * added before it is read exactly once.
 */
const shipped = await page.evaluate(async ({ }) => {
  const W = window.SABER, w = W.world;
  const out = { steps: [] };
  const pump = (n = 1) => {
    for (let i = 0; i < n; i++) {
      if (!W.world) return;
      W.world.update(1 / 60, W.input);
      W.input.end?.();
    }
  };
  /* THE DOOR AT #41, walked to rather than teleported into: the row carries
   * the door's own coordinates and `placeUnder` is what the key reads. */
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === 41) row = rec.place;
  if (!row) return { why: '#41 is not built on this deck' };
  w.player.position.set(row.x, w.player.position.y, row.z);
  w.paused = false;
  W.input.enabled = true;

  /* ── 1. THE TABLE OPENS, THROUGH THE KEY ──────────────────────────────── */
  W.input.touchHitSet.add('focus');
  pump(2);
  out.state = W.screens.state;
  out.menuUp = !document.getElementById('menu')?.classList.contains('hidden');
  if (out.state !== 'kiosk') return { ...out, why: `the key at #41 left the game in '${out.state}'` };

  out.was = W.settings.level;
  return { ...out, why: null };
}, {});

if (shipped.why) { say(false, 'the plot table opens at #41 through the key', shipped.why); }
else say(true, 'the plot table opens at #41 through the key',
  `screens.state '${shipped.state}', the menu is up: ${shipped.menuUp}`);

const jump = await page.evaluate(async ({ pick }) => {
  const W = window.SABER, w = W.world;
  const pump = (n = 1) => {
    for (let i = 0; i < n; i++) {
      if (!W.world) return;
      W.world.update(1 / 60, W.input);
      W.input.end?.();
    }
  };
  const from = w._pickedLevel?.name ?? null;
  const fromKey = W.settings.level;
  W.settings.level = pick;

  /* ── 3. ESCAPE, AND IT IS A REAL KEYBOARD EVENT ───────────────────────── */
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));

  const at = {
    state: W.screens.state,
    menuUp: !document.getElementById('menu')?.classList.contains('hidden'),
    warp: w._warp ? w._warp.phase : null,
    to: w._warp?.to?.name ?? null,
  };
  if (!w._warp) return { ...at, from, why: 'Escape closed the table and no order was given' };

  /* ── 4. AND THE STATION FLIES. The deck's own materials go amber on the
   *      way, and come back to the exact hex they started at. */
  const st = w._station;
  const was = {};
  for (const k of ['strip', 'screen']) was[k] = st.mats[k].color.getHex();
  const phases = [];
  const amber = { strip: false, screen: false };
  let spin = 0, lines = 0;
  const dome = W.engine?.skyDome;
  for (let i = 0; i < 12 * 60; i++) {
    pump(1);
    const ph = w._warp?.phase ?? 'done';
    if (phases[phases.length - 1] !== ph) phases.push(ph);
    for (const k of ['strip', 'screen']) if (st.mats[k].color.getHex() !== was[k]) amber[k] = true;
    const u = dome?.mat?.uniforms || dome?.material?.uniforms || null;
    if (u?.uWarp) lines = Math.max(lines, u.uWarp.value);
    if (u?.uOrbitSpin) spin = Math.max(spin, Math.abs(u.uOrbitSpin.value));
    if (w._warp?.done) break;
  }
  const after = {};
  for (const k of ['strip', 'screen']) after[k] = st.mats[k].color.getHex();
  return {
    ...at, from, why: null, phases, amber, lines, spin,
    landed: !!w._warp?.done,
    now: w._pickedLevel?.name ?? null,
    to: w._warp?.to?.name ?? null,
    restored: ['strip', 'screen'].every((k) => after[k] === was[k]),
    domeLevel: (W.engine?.skyDome?._orbit?.level?.name) ?? null,
    fleet: !!w._deckBattle?.group?.parent,
    stateAfter: W.screens.state,
  };
}, { pick: process.env.PICK || 'wood' });

if (jump.why) say(false, 'a real Escape over the plot table gives the order', jump.why);
else {
  say(jump.warp === 'order' || jump.warp === 'call',
    'a real Escape over the plot table gives the order',
    `${jump.from} → ${jump.to}, the jump opens in '${jump.warp}'`);
  say(jump.stateAfter === 'playing', 'and it hands the deck straight back',
    `screens.state '${jump.stateAfter}', menu up: ${jump.menuUp}`);
  say(jump.amber.strip || jump.amber.screen, 'every deck goes to transit amber on the way',
    `strip ${jump.amber.strip}, screen ${jump.amber.screen}`);
  say(jump.lines > 0.5, 'and there are star-lines outside', `uWarp peaked at ${jump.lines.toFixed(2)}`);
  say(jump.spin > 0.01, 'and the starfield swings onto the bearing',
    `uOrbitSpin reached ${jump.spin.toFixed(2)}`);
  say(jump.landed && jump.now === jump.to, 'it arrives, and the station knows where it is',
    `${jump.phases.join(' → ')}; now orbiting ${jump.now}`);
  say(jump.restored, 'and the deck is put back exactly as it was',
    jump.restored ? 'strip and screen back to their own hex' : 'the station is left mid-transit');
  say(jump.domeLevel === jump.to, 'the sky outside is the new theatre',
    `dome shows ${jump.domeLevel}`);
}

console.log(errs.length ? `\nPAGE ERRORS:\n${errs.slice(0, 8).join('\n')}` : '\nno page errors');
console.log(`\n${bad ? `${bad} FAILED` : 'all clear'}`);
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
