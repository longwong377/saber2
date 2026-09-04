/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE SHOPS, PRESSED IN A REAL BROWSER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS EXISTS AND WHY NOTHING HEADLESS REPLACES IT ─────────────────
 *
 * Two defects, both invisible to every suite in the tree, both found by
 * driving the game:
 *
 *   THE ARMOURER AND THE QUARTERMASTER HAD NO DOOR. `stationKey` raised the
 *   kiosk branch before the counter branch, so #10 The Forge only ever
 *   answered `onKiosk:hilt` and #11 only ever answered `onKiosk:kit`. The
 *   quartermaster is the only counter carrying stims and stratagem charges, so
 *   no provision in the game could be bought at all. `tools/_doorprobe.mjs`
 *   was green over it because it calls `world.onCounter('armourer')` DIRECTLY,
 *   which is exactly the instrument that cannot see a branch that never runs.
 *
 *   NOTHING YOU BOUGHT EXISTED. A 9000-credit purse, one click on a 38-credit
 *   dye, all of `localStorage` snapshotted either side: exactly one key moved,
 *   and it was the wallet.
 *
 * So this walks the player to each room, puts a press into `Input`'s own edge
 * set, and then CLICKS THE BUTTON in the panel that opens. Everything after
 * the press is the game's own path.
 *
 *   node tools/pack.mjs /tmp/borz.html
 *   node tools/_shopprobe.mjs
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

/* THE PURSE IS SEEDED BEFORE THE FIRST SCRIPT RUNS. `Credits.read` caches on
 * its first call, so writing the key after boot would be read by nothing. */
await page.addInitScript(() => {
  try {
    localStorage.setItem('saber.credits.v1', JSON.stringify({ v: 1, purse: 9000, earned: 9000, spent: 0 }));
  } catch { /* a browser with no storage is a different probe's problem */ }
});

await page.goto('file:///tmp/borz.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 300000 });
console.log('front screen up');

await page.evaluate(() => window.SABER.enterStation());
await page.waitForFunction(() => !!window.SABER.world?._station, null, { timeout: 300000 });
const where = await page.evaluate(() => ({
  deck: window.SABER.world._stationFloor,
  places: window.SABER.world._station.places?.size ?? 0,
  desks: [...(window.SABER.world._station.counters || new Map()).keys()],
  keepers: (window.SABER.world._station.keepers || []).map((k) => `${k.id}:${k.who.species}`),
}));
console.log(`station up — deck ${where.deck}, ${where.places} places`);
console.log(`  desks recorded in rooms: ${where.desks.join(', ') || 'none'}`);
console.log(`  keepers standing:        ${where.keepers.join(', ') || 'none'}`);

let bad = 0;
const say = (ok, label, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(44)} ${detail}`);
};

/**
 * ══ HOW A PRESS IS MADE, AND IT IS THE GAME'S OWN ════════════════════════
 *
 * `Input.touchHitSet` is the edge set `act`/`actHit` read beside the keyboard
 * and the pad, and `Input.end()` clears it at the end of every frame — so one
 * add is exactly one press on exactly one frame. `Player._readInput` →
 * `stationKey(world)` → the branch. `resume()` between presses because
 * `Screens.take` drops `input.enabled` and a card left up means no further
 * press is ever READ.
 */
async function pressAt(placeId, at) {
  return page.evaluate(async ({ id, at: p }) => {
    const W = window.SABER, w = W.world;
    W.resume?.();
    let heard = null;
    const k0 = w.onKiosk, c0 = w.onCounter;
    w.onKiosk = (panel) => { heard = `onKiosk:${panel}`; return true; };
    w.onCounter = (cid) => { heard = `onCounter:${cid}`; return true; };
    let row = null;
    for (const rec of w._station.places.values()) if (rec.place.id === id) row = rec.place;
    if (!row) return { why: `#${id} is not on this deck` };
    const spot = p || { x: row.x, z: row.z };
    w.player.position.set(spot.x, w.player.position.y, spot.z);
    W.input.touchHitSet.add('focus');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    w.onKiosk = k0; w.onCounter = c0;
    return { why: null, heard, name: row.name, kiosk: row.kiosk || null };
  }, { placeId, id: placeId, at });
}

/**
 * Where a customer stands at this room's desk, in world coordinates — the
 * point `StationKit.counter` records one metre out on the face, which is where
 * a person queues. Null if the room's shape builds no desk.
 */
async function deskOf(placeId) {
  return page.evaluate((id) => {
    const d = window.SABER.world._station.counters?.get(id);
    return d?.[0]?.front ? { x: d[0].front.x, z: d[0].front.z } : null;
  }, placeId);
}

/* ══ 1. THE DOOR — every deck-40 shop, at its desk and away from it ═════ */

console.log('\n1. the interact key, room by room');
const ROOMS = [
  { id: 9, shop: 'clothier' },
  { id: 10, shop: 'armourer' },
  { id: 11, shop: 'quarter' },
  { id: 15, shop: 'freshair' },
  { id: 17, shop: 'foodcourt' },
];
for (const r of ROOMS) {
  const desk = await deskOf(r.id);
  const atDesk = await pressAt(r.id, desk);
  if (atDesk.why) { say(false, `#${r.id}`, atDesk.why); continue; }
  say(atDesk.heard === `onCounter:${r.shop}`, `#${r.id} ${atDesk.name} at the desk`,
    `${atDesk.heard} ${desk ? `(desk at ${desk.x.toFixed(1)}, ${desk.z.toFixed(1)})` : '(no desk built)'}`);
  /* AND THE OTHER DOOR IN THE ROOM. A room with a kiosk must still reach it
   * from anywhere that is not the counter — otherwise the fix has only moved
   * the bug onto the other branch. */
  if (atDesk.kiosk && desk) {
    const away = await page.evaluate((id) => {
      let row = null;
      for (const rec of window.SABER.world._station.places.values()) if (rec.place.id === id) row = rec.place;
      return { x: row.x, z: row.z };
    }, r.id);
    const off = await pressAt(r.id, away);
    say(off.heard === `onKiosk:${atDesk.kiosk}`, `#${r.id} ${atDesk.name} away from the desk`,
      `${off.heard} (wanted onKiosk:${atDesk.kiosk})`);
  }
}

/* ══ 2. THE MONEY — a real click, and every key in localStorage watched ═ */

console.log('\n2. buying a keepsake, with the whole of localStorage watched');

/* WHICH OF THE CLOTHIER'S ROWS ARE KEEPSAKES, read off the table itself rather
 * than typed here — the shelf rerolls on the day, so the probe cannot know in
 * advance which ids will be out. */
const { CLOTHIER } = await import('../src/game/Vendors.js');
const KEEPS = Object.fromEntries(CLOTHIER.stock.filter((r) => r.kind === 'keepsake')
  .map((r) => [r.id, [r.slot, r.value]]));
await page.evaluate((k) => { window.__KEEPS = k; }, KEEPS);

const buy = await page.evaluate(async () => {
  const W = window.SABER, w = W.world;
  W.resume?.();
  /* Stand at the clothier's desk and press the key. Nothing here calls
   * `onCounter` — the panel that opens is the one the branch opened. */
  const desks = w._station.counters?.get(9);
  let row = null;
  for (const rec of w._station.places.values()) if (rec.place.id === 9) row = rec.place;
  const at = desks?.[0]?.at || { x: row.x, z: row.z };
  w.player.position.set(at.x, w.player.position.y, at.z);
  W.input.touchHitSet.add('focus');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pane = document.getElementById('counter');
  if (!pane || pane.classList.contains('hidden')) return { why: 'the key raised no counter at #9' };

  const snap = () => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      o[k] = localStorage.getItem(k);
    }
    return o;
  };
  const before = snap();
  const btns = [...pane.querySelectorAll('button.buy')].filter((b) => !b.disabled);
  if (!btns.length) return { why: 'the shelf has nothing on it that can be pressed' };
  /* The cheapest row on the shelf that is a keepsake. The panel does not say
   * which is which, so the ids are matched against the clothier's own table,
   * which the probe passes down below. */
  const pick = btns.find((b) => window.__KEEPS[b.dataset.id]) || btns[0];
  const id = pick.dataset.id, price = Number(pick.dataset.price);
  pick.click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = snap();
  const moved = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] !== after[k]) moved.push(k);
  }
  let ward = null, kept = null, hilt = null;
  try {
    const s = JSON.parse(after['saber.settings.v6'] || '{}');
    ward = s.wardrobe || null;
    kept = s.keepsakes || null;
    hilt = s.hiltStyle || null;
  } catch { /* reported as null */ }
  return {
    why: null, id, price, hilt, moved: moved.sort(),
    purse: JSON.parse(after['saber.credits.v1'] || '{}'),
    ward, kept,
    shelf: btns.map((b) => b.dataset.id),
  };
});

if (buy.why) say(false, 'a keepsake reaches the disk', buy.why);
else {
  say(buy.moved.includes('saber.credits.v1'), 'the wallet moved', JSON.stringify(buy.purse));
  say(buy.moved.includes('saber.settings.v6'),
    'the profile moved too', `keys that changed: ${buy.moved.join(', ')}`);
  say(Array.isArray(buy.kept) && buy.kept.includes(buy.id),
    'the ledger says what was sold', `keepsakes: ${JSON.stringify(buy.kept)}`);
  say(!!buy.ward, 'the wardrobe came back', buy.ward
    ? `tunicTone ${buy.ward.tunicTone}, gloveTone ${buy.ward.gloveTone}, capeTone ${buy.ward.capeTone}, `
      + `cape ${buy.ward.cape}, hood ${buy.ward.hood}, tabard ${buy.ward.tabard}, sash ${buy.ward.sash}, `
      + `plate ${buy.ward.armour?.plate}, kit ${buy.ward.armour?.id}, hilt ${buy.hilt}`
    : 'no wardrobe in the blob');
  /* AND IT IS THE FIELD THE ROW NAMED, not merely "the blob changed". */
  const [slot, value] = KEEPS[buy.id] || [];
  say(slot ? buy.ward?.[slot] === value : false, `the ${slot} the row named really moved`,
    `${slot} is ${JSON.stringify(buy.ward?.[slot])}, the row said ${JSON.stringify(value)}`);
  console.log(`     bought ${buy.id} for ${buy.price}; shelf was ${buy.shelf.join(', ')}`);
}

/* ══ 3. THE KEEPERS — real bodies, in the rooms, with species ═══════════ */

console.log('\n3. who is behind the counters');
const keepers = await page.evaluate(() => {
  const w = window.SABER.world;
  const out = [];
  for (const k of w._station.keepers || []) {
    const b = k.body;
    out.push({
      id: k.id, name: k.who.name, species: k.who.species, role: k.who.role,
      mando: k.mando, helm: k.helm,
      alive: !!b && b.alive !== false,
      inWorld: w.enemies.includes(b),
      x: b?.position?.x ?? null, z: b?.position?.z ?? null,
      team: b?.team, sameTeam: b?.team === w.player?.team,
    });
  }
  return out;
});
for (const k of keepers) {
  say(k.alive && k.inWorld && k.sameTeam, `${k.id} is a body in the room`,
    `${k.name} (${k.species}, ${k.role})${k.mando ? ' — Mandalorian, helmed' : ''} `
    + `at ${k.x?.toFixed(1)}, ${k.z?.toFixed(1)}, team ${k.team}`);
}
say(keepers.length >= 5, 'every deck-40 counter has somebody behind it', `${keepers.length} keepers`);

console.log(`\n${errs.length} page errors${errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''}`);
console.log(bad ? `\nFAILED — ${bad}` : '\nALL GREEN');
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
