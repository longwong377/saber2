/**
 * WHERE THE TITLE SCREEN'S BACKDROP IS ACTUALLY SEEN.
 *
 * `.menu-bg` is `background-size:cover` behind a `.menu-wrap` of fixed pixel
 * size, so what a player sees of the plate is a RING — and both of its edges
 * move for reasons that have nothing to do with each other. The outer edge is
 * the cover crop, which depends on the viewport's ASPECT. The inner edge is
 * the panel, which is a fixed 1180x770 px box and therefore depends on the
 * viewport's absolute SIZE. Reasoning about that pair in your head produces
 * confident wrong numbers; this prints them.
 *
 *   node tools/_menubands.mjs [--plate 2520x1080]
 *
 * It loads the real index.html with every <script> removed and the menu shown.
 * No engine, no WebGL, no boot — the geometry under test is `.menu-wrap`,
 * `.menu-head` and the wordmark, and not one of them is written by JS. That is
 * what makes this a second-long tool instead of a four-minute one.
 *
 * Everything is reported twice: in CSS pixels, and as a FRACTION OF THE PLATE,
 * which is the space tools/keyart.mjs composes in and tools/checks/keyart.mjs
 * asserts in.
 */

import { readFile } from 'node:fs/promises';
import { bands, headBand, HEAD, REF_W, REF_H } from './_bands.mjs';
import { resolve, join, extname, normalize } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const [PW, PH] = (flag('plate', '2520x1080')).split('x').map(Number);

/** The viewports the ring has to survive, and why each one is on the list. */
const VIEWPORTS = [
  [1280, 720, '16:9, the smallest desktop anyone still uses'],
  [1366, 768, '16:9, the most common laptop panel there has ever been'],
  [1440, 1080, '4:3, the narrowest aspect the crop is specified over'],
  [1600, 900, '16:9'],
  [1920, 1080, '16:9, THE REFERENCE — every number in the CSS was measured here'],
  [2560, 1080, '21:9, the widest aspect the crop is specified over'],
  [2560, 1440, '16:9'],
  [3840, 2160, '16:9, where the panel stops covering much of anything'],
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
const { createServer } = await import('node:http');
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  let body = await readFile(file);
  // Every script goes. main.js would boot a renderer to answer a layout question.
  if (p === '/index.html') body = Buffer.from(String(body).replace(/<script[\s\S]*?<\/script>/g, ''), 'utf8');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(body);
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const rows = [];
for (const [w, h, why] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  /* NO ANIMATION, and this one cost a wrong answer before it was found. Every
   * panel in this interface arrives with `stampIn`, whose first keyframe is
   * `translateY(8px) scale(.985)` — and `getBoundingClientRect` reports the
   * TRANSFORMED box. Measured mid-flight, `.menu-wrap` came back 1162x757
   * instead of 1180x770, which is 0.985 of each and looks exactly like a real
   * layout number. Every band derived from it was ~0.4% out. */
  await page.addStyleTag({ content: '*{animation:none !important;transition:none !important}' });
  const r = await page.evaluate(([PW, PH]) => {
    document.getElementById('boot').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    /* THE RECORD LINE IS NOT PUT BACK ANY MORE, and that is the measurement
     * changing rather than the tool getting lazier. It used to be filled with a
     * representative `progressLines()` string before measuring, because
     * `.record:empty{display:none}` made a played profile's header taller than
     * a fresh one and the taller case is the one the backdrop has to survive.
     * That line was removed from the menu on instruction (see main.js), and its
     * only remaining writer is `deploy()`'s failure notice — a state no player
     * reaches on the way in. The header the plate is posed against is therefore
     * the wordmark alone, which is what is measured here. */
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    };
    /* The cover mapping, done the way the spec defines it: the plate is scaled
     * by whichever of the two ratios is larger, then centred. */
    const vw = innerWidth, vh = innerHeight;
    const s = Math.max(vw / PW, vh / PH);
    const dw = PW * s, dh = PH * s;
    const ox = (vw - dw) / 2, oy = (vh - dh) / 2;      // ≤ 0 on the cropped axis
    const toPlate = (b) => b && [
      +(((b[0] - ox) / dw)).toFixed(4), +(((b[1] - oy) / dh)).toFixed(4),
      +((b[2] / dw)).toFixed(4), +((b[3] / dh)).toFixed(4)];
    const visible = [+((-ox / dw)).toFixed(4), +((-oy / dh)).toFixed(4),
      +((vw / dw)).toFixed(4), +((vh / dh)).toFixed(4)];
    return {
      vw, vh, cover: +s.toFixed(4), visible,
      wrap: box('.menu-wrap'), wrapPlate: toPlate(box('.menu-wrap')),
      panel: box('.panel.active'), panelPlate: toPlate(box('.panel.active')),
      tabs: box('.menu-tabs'),
      logo: box('.menu-head .logo h1'), logoPlate: toPlate(box('.menu-head .logo h1')),
      record: box('#menu-record'),
      /* THE WORDMARK IS DRAWN NOW, so the number that sizes it is a WIDTH and
       * not a font-size — one <svg> with a fixed viewBox, whose height follows
       * from its aspect. tools/checks/keyart.mjs reads the same width out of
       * the `.logo.small .wordmark` rule in styles.css and fails if the two
       * stop agreeing, which is the guard that keeps the stated HEAD box below
       * from going stale (HANDOFF §2.3). */
      markPx: parseInt(getComputedStyle(document.querySelector('.logo.small .wordmark')).width, 10),
      head: box('.menu-head'), headPlate: toPlate(box('.menu-head')),
      foot: box('.menu-foot'),
    };
  }, [PW, PH]);
  rows.push({ why, ...r });
  /* `--shots` also writes the picture. The numbers below say whether the ring
   * is where it was designed to be; this says whether the front screen LOOKS
   * like the front of a game, which no statistic answers. The lists are empty
   * because the scripts are stripped — the subject here is the backdrop, the
   * header and the panel's outline, and not one of those is written by JS. */
  if (argv.includes('--shots')) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(ROOT, '.shots', 'menu'), { recursive: true });
    await page.screenshot({ path: join(ROOT, '.shots', 'menu', `menu-${w}x${h}.png`) });
  }
  await page.close();
}
await browser.close();
server.close();

const f = (v) => (v * 100).toFixed(1).padStart(5) + '%';
console.log(`plate ${PW}x${PH}  (${(PW / PH).toFixed(3)}:1)\n`);
for (const r of rows) {
  const [vx, vy, vwF, vhF] = r.visible;
  console.log(`${String(r.vw).padStart(4)}x${String(r.vh).padStart(4)}  ${(r.vw / r.vh).toFixed(3)}:1   ${r.why}`);
  console.log(`   visible plate      x ${f(vx)}…${f(vx + vwF)}   y ${f(vy)}…${f(vy + vhF)}`);
  const [px, py, pw, ph] = r.wrapPlate;
  console.log(`   wrap covers        x ${f(px)}…${f(px + pw)}   y ${f(py)}…${f(py + ph)}`);
  const left = Math.max(0, (px - Math.max(0, vx)) * PW), right = Math.max(0, (vx + vwF - (px + pw)) * PW);
  const top = Math.max(0, (py - Math.max(0, vy)) * PH), bot = Math.max(0, (vy + vhF - (py + ph)) * PH);
  console.log(`   ring, plate px     left ${left.toFixed(0)}  right ${right.toFixed(0)}  top ${top.toFixed(0)}  bottom ${bot.toFixed(0)}`);
  console.log(`   ring, screen px    left ${(left * r.cover).toFixed(0)}  right ${(right * r.cover).toFixed(0)}`
    + `  top ${(top * r.cover).toFixed(0)}  bottom ${(bot * r.cover).toFixed(0)}`);
  const [lx, ly, lw, lh] = r.logoPlate;
  console.log(`   wordmark on plate  x ${f(lx)}…${f(lx + lw)}   y ${f(ly)}…${f(ly + lh)}   (${r.logo[2]}x${r.logo[3]} css px)`);
  console.log('');
}

/* ── THE SPECIFICATION, and why it is two clauses and not one ────────────
 *
 * Intersecting "never cropped" with "never covered" over EVERY viewport above
 * yields an empty side band, and that is a true and useless answer: at
 * 1280x720 the wrap is 1180x662 against a 1280x720 screen, so it covers 92% of
 * the height and 69% of the plate's width, and no backdrop of any composition
 * shows through it. That is a property of a fixed 1180x770 px panel on a small
 * laptop, not something a picture can fix.
 *
 * So the ring is specified as the pair the brief states:
 *
 *   CROP-SAFE   over aspects 4:3 … 21:9 — the part of the plate that is on
 *               screen at every aspect ratio, whatever the resolution.
 *   UNCOVERED   at 1920x1080, the reference viewport every number in
 *               styles.css was measured at.
 *
 * Their intersection is the band a composition may rely on. Anything outside
 * CROP-SAFE is a bonus for wide screens; anything inside the 1080p panel is
 * seen only at 1440p and above.
 */
const REF = rows.find((r) => r.vw === 1920 && r.vh === 1080);
const asp = (r) => r.vw / r.vh;
const cropped = rows.filter((r) => asp(r) >= 4 / 3 - 1e-6 && asp(r) <= 21 / 9 + 0.05);
const safeX0 = Math.max(...cropped.map((r) => r.visible[0]));
const safeX1 = Math.min(...cropped.map((r) => r.visible[0] + r.visible[2]));
const safeY0 = Math.max(...cropped.map((r) => r.visible[1]));
const safeY1 = Math.min(...cropped.map((r) => r.visible[1] + r.visible[3]));
const [wx, wy, ww, wh] = REF.wrapPlate;
console.log('CROP-SAFE (4:3…21:9)   x %s…%s   y %s…%s', f(safeX0), f(safeX1), f(safeY0), f(safeY1));
console.log('COVERED AT 1920x1080   x %s…%s   y %s…%s', f(wx), f(wx + ww), f(wy), f(wy + wh));
console.log('THE RING               left %s…%s (%d px)   right %s…%s (%d px)',
  f(safeX0), f(wx), Math.round((wx - safeX0) * PW), f(wx + ww), f(safeX1), Math.round((safeX1 - wx - ww) * PW));
console.log('                       top  %s…%s (%d px)   bottom %s…%s (%d px)',
  f(safeY0), f(wy), Math.round((wy - safeY0) * PH), f(wy + wh), f(safeY1), Math.round((safeY1 - wy - wh) * PH));
const [lx, ly, lw, lh] = REF.logoPlate;
console.log('WORDMARK ALONE         x %s…%s   y %s…%s   (%dx%d css px at 1920x1080)',
  f(lx), f(lx + lw), f(ly), f(ly + lh), REF.logo[2], REF.logo[3]);

/* ── AND DOES tools/_bands.mjs AGREE? ─────────────────────────────────────
 *
 * The rectangles above are what a browser did. The ones below are what the
 * module every other file imports COMPUTES, from the panel size and the cover
 * rule alone. Nothing downstream measures a browser, so this is the only place
 * the arithmetic is confronted with the thing it models — HANDOFF §2.4's
 * "never restate a rule; call it", answered by making the restatement testable
 * rather than by pretending there is only one copy.
 */
const panelW = 1180, panelH = 770;                    // `.menu-wrap`, from styles.css
const calc = bands({ plateW: PW, plateH: PH, panelW, panelH });
const wm = headBand({ plateW: PW, plateH: PH, panelH });
const d = (a, b) => (Math.abs(a - b) * 100).toFixed(2) + ' pt';
console.log('');
console.log('_bands.mjs  safe     x %s…%s   y %s…%s', f(calc.safe[0]), f(calc.safe[0] + calc.safe[2]),
  f(calc.safe[1]), f(calc.safe[1] + calc.safe[3]));
console.log('_bands.mjs  covered  x %s…%s   y %s…%s', f(calc.covered[0]), f(calc.covered[0] + calc.covered[2]),
  f(calc.covered[1]), f(calc.covered[1] + calc.covered[3]));
console.log('_bands.mjs  head     x %s…%s   y %s…%s', f(wm[0]), f(wm[0] + wm[2]), f(wm[1]), f(wm[1] + wm[3]));
console.log('DISAGREEMENT with the browser: safe x %s y %s · covered x %s y %s · head x %s y %s',
  d(calc.safe[0], safeX0), d(calc.safe[1], safeY0), d(calc.covered[0], wx), d(calc.covered[1], wy),
  d(wm[0], REF.headPlate[0]), d(wm[1], REF.headPlate[1]));
console.log('HEAD BAND              x %s…%s   y %s…%s   (%dx%d css px, wordmark %dx%d, record %dx%d)',
  f(REF.headPlate[0]), f(REF.headPlate[0] + REF.headPlate[2]),
  f(REF.headPlate[1]), f(REF.headPlate[1] + REF.headPlate[3]),
  REF.head[2], REF.head[3], REF.logo[2], REF.logo[3], REF.record[2], REF.record[3]);
console.log('');
console.log('  export const HEAD = { w: %d, h: %d, markPx: %d };   ← paste into tools/_bands.mjs',
  REF.head[2], REF.head[3], REF.markPx);
