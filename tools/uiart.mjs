/**
 * BATTLEFIELD BORZ — the player's own front-end art, prepared for shipping.
 *
 * Two files arrived in `assets/reference/ui/` and neither can be used as it
 * stands. This turns each into the thing the interface actually loads, and it
 * is a TOOL rather than a one-off command because both conversions have a
 * reason attached that would otherwise be lost the first time somebody
 * re-exported the source:
 *
 * ── THE BACKGROUND, 1672x941 (16:9) → 2560x1080 (21:9) ──────────────────
 *
 * `.menu-bg` is `background-size:cover` behind a fixed 1180x770 panel, so what
 * a player sees of the plate is a RING, and the ring's top and bottom edges
 * exist ONLY if the source is at least as wide as the widest viewport in range.
 * `tools/checks/keyart.mjs` states that as a refusal — a plate that crops
 * vertically fails the suite — and tools/keyart.mjs's header has the
 * measurement: a 16:9 source leaves 20 screen px above and below the panel, a
 * 21:9 source leaves 155.
 *
 * So the picture is fitted to the WIDTH and the extra height is taken off. It
 * is a crop and not a squeeze, because the alternative is a battlefield with
 * the wrong proportions, and it is taken 39/61 rather than evenly: the top of
 * the source is open sky and the bottom is the near rock shelf, and of the two
 * the shelf is the one the player never sees behind the panel anyway.
 *
 * ── THE LOGO, white background → straight alpha ─────────────────────────
 *
 * The mark is drawn on white. Laid over the plate that is a white box; the
 * usual answers are `mix-blend-mode:multiply`, which is exact on a light
 * backdrop and erases the mark on the dark boot screen, or a hand-cut mask,
 * which is a second artefact to maintain.
 *
 * This UNPREMULTIPLIES against white instead, which is the same arithmetic a
 * compositor does and is exact for both of the mark's inks:
 *
 *     a = 1 − min(r,g,b)              c = (src − (1−a)) / a
 *
 * Black caps come back at a=1 unchanged. The coral, (207,127,102) on white,
 * comes back as a=0.60 over (175,42,0) — composited on white that is the
 * original pixel to the byte, and on any other backdrop it is what a real
 * 60%-opaque ink of that colour would do. The anti-aliased edges come back as
 * partial alpha, which is what makes the result a cut-out rather than a
 * silhouette with a white fringe.
 *
 * `--thresh` is the one judgement in it: pixels within that distance of pure
 * white are forced fully transparent, so the paper's own off-white noise does
 * not ship as a haze of 2% ink over the whole rectangle.
 *
 *   node tools/uiart.mjs                 # write both
 *   node tools/uiart.mjs --only logo
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ONLY = flag('only', null);

const SRC_BG = 'assets/reference/ui/background.png';
const SRC_LOGO = 'assets/reference/ui/Battlefield Borz official logo.png';
const OUT_BG = 'assets/menu/title.webp';
const OUT_LOGO = 'assets/menu/logo.webp';

/** The plate's shipped geometry. See the header, and tools/_bands.mjs. */
const PLATE_W = 2560, PLATE_H = 1080;
/** Where the vertical crop is taken from. 0 = all off the bottom. */
const CROP_BIAS = 0.39;
/* 0.70, and it is measured rather than chosen. `tools/checks/keyart.mjs`
 * bounds the plate at 160 KB — a judgement written out in full there — and the
 * player's own painting is a far busier picture than the render it replaces:
 * at q0.84 it is 200 KB, at q0.78 it is 173, at q0.70 it is 138. Flat ochre
 * with soft ink lines is exactly what WebP is good at, and the artefacts at
 * this quality are invisible behind a 34% cream sink. */
const Q = parseFloat(flag('q', '0.70'));
/* 0.90. The source is a painted raster rather than flat vector ink, so
 * lossless is not the bargain it would be for a clean two-colour mark: 480 KB
 * as a PNG, 369 lossless WebP, 141 at q0.90 and 121 at q0.72. The mark is
 * displayed at 430 CSS px against a 1729 px source — a quarter scale — so the
 * ringing q0.72 puts on the brush edges is four times smaller than a pixel by
 * the time anybody sees it, and q0.90 is chosen anyway because the boot screen
 * shows it at 620 px and this is the one image in the product a player is
 * asked to look AT rather than through. */
const LOGO_Q = parseFloat(flag('logoq', '0.90'));
const THRESH = parseInt(flag('thresh', '6'), 10);

const b64 = async (p) => `data:image/png;base64,${(await readFile(resolve(ROOT, p))).toString('base64')}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
await page.setContent('<body></body>');

const write = async (rel, dataUrl) => {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  await writeFile(resolve(ROOT, rel), buf);
  return buf.length;
};

if (ONLY !== 'logo') {
  const out = await page.evaluate(async ({ src, W, H, bias, q }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    /* Fit to WIDTH — see the header. The overflow is taken off top and bottom
     * on `bias`, so the sky loses a little and the near shelf loses more. */
    const s = W / img.width;
    const dh = img.height * s;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, -(dh - H) * bias, W, dh);
    return { url: c.toDataURL('image/webp', q), w: img.width, h: img.height, cut: Math.round(dh - H) };
  }, { src: await b64(SRC_BG), W: PLATE_W, H: PLATE_H, bias: CROP_BIAS, q: Q });
  const n = await write(OUT_BG, out.url);
  console.error(`${OUT_BG}  ${out.w}x${out.h} → ${PLATE_W}x${PLATE_H}  (${out.cut}px of height taken)  ${(n / 1024).toFixed(1)} KB`);
}

if (ONLY !== 'bg') {
  const out = await page.evaluate(async ({ src, thresh, lq }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    let inked = 0;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gg = p[i + 1], b = p[i + 2];
      const m = Math.min(r, gg, b);
      if (m >= 255 - thresh) { p[i + 3] = 0; continue; }
      const a = 1 - m / 255;
      p[i] = Math.max(0, Math.min(255, Math.round((r - (1 - a) * 255) / a)));
      p[i + 1] = Math.max(0, Math.min(255, Math.round((gg - (1 - a) * 255) / a)));
      p[i + 2] = Math.max(0, Math.min(255, Math.round((b - (1 - a) * 255) / a)));
      p[i + 3] = Math.round(a * 255);
      inked++;
      const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width);
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    g.putImageData(d, 0, 0);
    /* TRIMMED to the ink. The source is a mark on a page with a wide white
     * margin, and a margin baked into the file is a margin every CSS rule that
     * sizes the mark then has to guess at. */
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
    return { url: t.toDataURL('image/webp', lq), w: img.width, h: img.height, tw, th, inked };
  }, { src: await b64(SRC_LOGO), thresh: THRESH, lq: LOGO_Q });
  const n = await write(OUT_LOGO, out.url);
  console.error(`${OUT_LOGO}  ${out.w}x${out.h} → ${out.tw}x${out.th} trimmed  ${out.inked} inked px  ${(n / 1024).toFixed(1)} KB`);
}

await browser.close();
