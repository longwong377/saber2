/**
 * THE TITLE SCREEN'S ART, AND THE THREE WAYS IT COULD ROT SILENTLY.
 *
 * The front screen used to be a settings dialog on a three-gradient wash — the
 * player's note was "THE TITLE SCREEN HAS NO ART". It now carries a plate the
 * game rendered of itself (tools/keyart.mjs), and every failure mode of that
 * arrangement is invisible from the outside:
 *
 *   IT 404s.      `background-image` is the quietest failure in CSS. A missing
 *                 file paints nothing, the wash underneath shows through, and
 *                 the screen looks exactly like it did before the work — which
 *                 is precisely the state somebody would be trying to fix.
 *   IT MOVES.     The plate is cropped by `cover` and covered by `.menu-wrap`,
 *                 so what a player sees is a RING whose two edges are set by
 *                 numbers in styles.css. Change the panel's size and the
 *                 composition is silently re-cropped around something else.
 *   IT DROWNS.    The wordmark is drawn straight onto the plate. There is no
 *                 panel behind it, so the only thing between the type and a
 *                 lit ash sky is the ink halo and the sink layer.
 *
 * So nothing below is asserted about the CSS in isolation. Every geometric
 * claim is recomputed from `.menu-wrap`'s own declaration through
 * tools/_bands.mjs, and every claim about the picture is measured off THE
 * BYTES THE BROWSER WILL LOAD, decoded here by tools/_png.mjs. That is why the
 * plate is a PNG and not the 40%-smaller WebP it could be: a WebP can only be
 * decoded by a browser, tools/verify.mjs cannot afford to launch one (HANDOFF
 * §2.6), and the alternative — a committed table of statistics beside an image
 * nothing re-reads — is §2.3's signature defect with a picture in it.
 */

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { decodePng, region } from '../_png.mjs';
import { bands, headBand, HEAD, MAX_ASPECT, REF_W, REF_H } from '../_bands.mjs';
import { handler } from '../serve.mjs';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');
const bytes = (p) => readFile(new URL('../../' + p, import.meta.url));

/** One CSS declaration block, by selector, exactly as written. */
function rule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? null;
}

/**
 * THE PAGE WEIGHT BUDGET, and it is a judgement, so here is the whole of it.
 *
 * This game opens at a URL with no build step. It already fetches ~76 ES
 * modules, a vendored three.js and a Rapier WASM blob before the menu draws, so
 * the plate is not the thing that decides whether the page is heavy — but it IS
 * the only binary picture in the product, and DESIGN.md §7 is explicit that
 * everything except one licensed MP3 is generated in code. A plate that has to
 * be defended as "the renderer's own output" cannot also be 900 KB.
 *
 * 250 KB is about a fifth of `styles.css` + `index.html` uncompressed, it is
 * 0.8% of the one asset already shipped (`assets/music/theme.mp3`, 29.4 MB),
 * and — the part that actually matters — it is fetched LAZILY. `#menu` is
 * `display:none` until the boot finishes, and a background-image on a
 * display:none subtree is not requested, so not one byte of this is on the
 * critical path to first paint. The `<link rel=preload as=image>` in
 * index.html starts it early at low priority instead.
 */
const BUDGET = 250 * 1024;

/**
 * WHAT COUNTS AS A HIGHLIGHT, and why the number is not tuned to this plate.
 *
 * 0.90 display luminance. Measured over nine renders of this game — six of them
 * plain landscape scouts of five different levels — a frame with no lit blade
 * in it has ZERO pixels this bright and a frame with one has 150 to 300 at
 * 710x300. There is nothing else in this renderer that gets there: the hottest
 * cloud on the Ember Shelf tops out at 0.87, the Colosseum's sand at 0.83.
 * `HOT_SHARE` is that count as a fraction of the frame, floored well under the
 * measured 7e-4 so a smaller blade or a further hero still clears it.
 */
const HOT = 0.90;
const HOT_SHARE = 2e-4;

/**
 * WHEN A BAND OF THE RING IS DEAD, as a fraction of the plate's own mean edge
 * energy — and the number comes from a distribution, not from taste.
 *
 * Measured over 35 renders of this game (seven levels, six bearings, five
 * pitches, four elevations) the four bands run from 0.14x to 2.40x of the whole
 * plate. The bottom band is systematically the weakest, median around 0.55,
 * because the near foreground is one continuous surface with the fewest
 * silhouettes crossing it. Every band that scored under 0.4 was a frame whose
 * band is literally a black cut-out or an empty sky — `comp-y180` bottom 0.14,
 * `comp-y120` bottom 0.27 and left 0.39, `scout-mustafar` bottom 0.29. So 0.4
 * separates "there is nothing there" from "there is less there", which is the
 * only distinction this clause is entitled to make. The shipped plate's weakest
 * band is 0.5x.
 */
const DEAD_BAND = 0.4;

export async function run({ check, assert }) {
  const CSS = await read('styles.css');
  const HTML = await read('index.html');

  /* ── what the stylesheet actually asks for ───────────────────────────── */
  const bg = rule(CSS, '.menu-bg');
  const urls = [...(bg ?? '').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  const src = urls[0] ?? null;
  const rel = src ? src.replace(/^\.\//, '') : null;

  /**
   * THE SINK — the flat field between the plate and the interface.
   *
   * It is parsed rather than assumed because every luminance below is measured
   * THROUGH it: what a player reads type against is not the plate, it is the
   * plate composited under this. Written as a two-stop gradient of one colour
   * because that is CSS's only way to spell "a flat layer", and it is a flat
   * colour field, which is law 2 of this stylesheet's own header.
   */
  const sink = /linear-gradient\(\s*rgba?\(([\d.,\s]+)\)\s*,\s*rgba?\([\d.,\s]+\)\s*\)/.exec(bg ?? '');
  const sinkRgba = sink ? sink[1].split(',').map((n) => Number(n.trim())) : null;

  let img = null, fileBytes = 0;
  if (rel) {
    try {
      const buf = await bytes(rel);
      fileBytes = buf.length;
      img = decodePng(buf);
    } catch { /* the checks below report it properly */ }
  }

  /** The plate as a player sees it: under the sink, over nothing. */
  function composited() {
    if (!img || !sinkRgba) return img;
    const [r, g, b, a = 1] = sinkRgba;
    const out = new Uint8Array(img.rgba);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = out[i] * (1 - a) + r * a;
      out[i + 1] = out[i + 1] * (1 - a) + g * a;
      out[i + 2] = out[i + 2] * (1 - a) + b * a;
    }
    return { ...img, rgba: out };
  }

  /* Every check below this point measures pixels, and there are none if the
   * file is missing. They say so once, in the words of the check that owns
   * that failure, rather than each throwing a TypeError about `null.width` —
   * seven identical stack traces are how a real second failure hides. */
  const needPlate = () => assert(img,
    `${rel || '.menu-bg\'s url()'} is missing or does not decode — see "the menu names a backdrop"`);

  /* `.menu-wrap` owns the panel size. Nothing here types 1180 or 770. */
  const wrap = rule(CSS, '.menu-wrap') ?? '';
  const dims = /width:\s*min\((\d+)px[^)]*\);\s*height:\s*min\((\d+)px/.exec(wrap);
  const PANEL_W = dims ? Number(dims[1]) : 0;
  const PANEL_H = dims ? Number(dims[2]) : 0;

  check('keyart: the menu names a backdrop, and the backdrop is there', async () => {
    assert(bg, 'styles.css has no `.menu-bg` rule at all');
    assert(urls.length === 1,
      `.menu-bg carries ${urls.length} url() layers — the ring is specified against exactly one plate`);
    assert(!/^(https?:|\/\/|data:)/.test(src),
      `.menu-bg fetches "${src}" — this product ships no remote asset and inlines no picture`);
    /*
     * THE POINT OF THIS WHOLE FILE. A background-image that 404s paints
     * nothing and falls back to the wash underneath, which is the exact
     * appearance of the defect the plate was made to fix. Nothing in a browser
     * reports it and nothing in the rest of the suite would notice.
     */
    const s = await stat(new URL('../../' + rel, import.meta.url)).catch(() => null);
    assert(s && s.isFile(),
      `.menu-bg loads "${src}" and there is no such file — the title screen has silently gone back to a gradient`);
    assert(s.size > 4096, `${rel} is ${s.size} bytes, which cannot be a plate`);
    assert(img, `${rel} does not decode as a PNG`);
    return `${rel}, ${(s.size / 1024).toFixed(0)} KB, ${img.width}x${img.height}`;
  });

  check('keyart: the server sends it as an image, and the packed page can find it', async () => {
    /*
     * `tools/serve.mjs` answers `MIME[extname] || application/octet-stream`,
     * so a plate in a format its table has never heard of is served as a
     * download. That is the `.mp3` defect the file's own header records,
     * one extension along, and it is silent: Chromium sniffs the bytes and
     * draws it anyway, so it would only ever break on a stricter browser.
     */
    const server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/${rel}`);
      assert(res.status === 200, `GET /${rel} answered ${res.status}`);
      const type = res.headers.get('content-type') || '';
      assert(type.startsWith('image/'),
        `/${rel} is served as "${type}" — tools/serve.mjs's MIME table does not know this extension`);
      const body = await res.arrayBuffer();
      assert(body.byteLength === fileBytes, `/${rel} served ${body.byteLength} of ${fileBytes} bytes`);
      /*
       * And the SINGLE-FILE build. tools/pack.mjs inlines styles.css into a
       * <style> tag and says in its own output that "nothing was fetched and
       * nothing can 404" — which is true of every module and is now not true
       * of this one line. The URL is relative, so a packed page sitting beside
       * `assets/` still finds it and one moved elsewhere falls back to the
       * wash. That is a documented limit rather than a defect, and the clause
       * that keeps it a limit is this one: the reference must stay RELATIVE,
       * so it resolves against wherever the page was written.
       */
      assert(!src.startsWith('/'),
        `.menu-bg names "${src}" from the site root — tools/pack.mjs writes a page that can live anywhere`);
      return `${type}, ${fileBytes} bytes, relative`;
    } finally { server.close(); }
  });

  check('keyart: the preload and the stylesheet name one file, not two', () => {
    /*
     * `#menu` is display:none until the boot finishes, and a background image
     * inside a display:none subtree is never requested — which is the reason
     * the plate costs nothing at first paint, and also the reason it would
     * otherwise arrive as a visible pop the moment the menu appears. The
     * preload starts it early at low priority. Two copies of one path in two
     * files is HANDOFF §2.3, so they are compared rather than trusted.
     */
    const link = /<link[^>]*rel=["']preload["'][^>]*>/i.exec(HTML)?.[0] ?? '';
    assert(link, 'index.html has no <link rel=preload> for the title plate');
    const href = /href=["']([^"']+)["']/.exec(link)?.[1] ?? '';
    assert(href === src, `the preload asks for "${href}" and .menu-bg asks for "${src}"`);
    assert(/as=["']image["']/.test(link), 'the preload does not declare as="image", so it is fetched twice');
    assert(/fetchpriority=["']low["']/i.test(link),
      'the preload does not declare fetchpriority="low" — it would compete with the modules the boot is waiting on');
    return href;
  });

  check('keyart: the plate is shaped so that `cover` never crops it vertically', () => {
    needPlate();
    const B = bands({ plateW: img.width, plateH: img.height, panelW: PANEL_W, panelH: PANEL_H });
    /*
     * MEASURED, and it is the whole reason the plate is 21:9. `cover` crops on
     * one axis; which axis depends on the viewport. A plate at least as wide as
     * the widest viewport in range is cropped on the horizontal only, so the
     * bands above and below the panel — the two widest pieces of the ring — are
     * never cut. tools/_menubands.mjs, 1920x1080, against this panel: a 16:9
     * plate leaves 20 px of top band and 20 of bottom, a 21:9 plate leaves 155
     * and 155. The sides are 130 px either way.
     */
    assert(!B.cropsVertically,
      `the plate is ${B.aspect.toFixed(3)}:1 and the widest viewport in range is ${MAX_ASPECT.toFixed(3)}:1, `
      + 'so `cover` crops it vertically and the top and bottom bands stop being guaranteed');
    const px = (r, w, h) => `${Math.round(r[2] * w)}x${Math.round(r[3] * h)}`;
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const r = B.ring[side];
      assert(r[2] > 0 && r[3] > 0,
        `the ${side} band has no area — .menu-wrap is now wider than the crop-safe part of the plate`);
    }
    return `${B.aspect.toFixed(3)}:1, ring ${px(B.ring.left, img.width, img.height)} / `
      + `${px(B.ring.top, img.width, img.height)} plate px, safe `
      + `${(B.safe[2] * 100).toFixed(1)}% x ${(B.safe[3] * 100).toFixed(1)}%`;
  });

  check('keyart: it is not upscaled at the viewport every number here was measured at', () => {
    needPlate();
    /*
     * `cover` scales by max(vw/pw, vh/ph). At 1920x1080 a 2560x1080 plate
     * scales by exactly 1.0 and a smaller one is blown up — and the one thing
     * this art direction cannot survive being blown up is its ink outline,
     * which is a 1-2 px hard black line by construction. Above the reference
     * viewport it is upscaled and that is accepted; at and below it, it is
     * pixel for pixel.
     */
    const s = Math.max(REF_W / img.width, REF_H / img.height);
    assert(s <= 1.0001,
      `at ${REF_W}x${REF_H} the plate is drawn at ${s.toFixed(2)}x — every ink outline in it is soft`);
    assert(img.height >= REF_H, `the plate is ${img.height} px tall against a ${REF_H} px reference viewport`);
    return `${img.width}x${img.height}, drawn at ${s.toFixed(3)}x at ${REF_W}x${REF_H}`;
  });

  check('keyart: the plate costs what a page with no build step can spend', () => {
    needPlate();
    assert(fileBytes <= BUDGET,
      `${rel} is ${(fileBytes / 1024).toFixed(0)} KB against a ${(BUDGET / 1024).toFixed(0)} KB budget`);
    /* And it is a real picture, not a placeholder fill that happens to be
     * cheap: a flat colour would sail through every byte bound above. */
    const whole = region(img, 0, 0, 1, 1, 3);
    assert(whole.sd > 0.05, `the whole plate has a luminance sd of ${whole.sd} — that is a fill, not a render`);
    return `${(fileBytes / 1024).toFixed(0)} KB for ${(img.width * img.height / 1e6).toFixed(1)} Mpx `
      + `(${(fileBytes / (img.width * img.height)).toFixed(3)} B/px), whole-frame sd ${whole.sd}`;
  });

  check('keyart: the brightest thing in the game is not behind the interface', () => {
    needPlate();
    /*
     * THE COMPOSITION CLAIM, and it took two attempts because the first metric
     * did not measure what it was named after.
     *
     * WHAT WAS TRIED AND REJECTED. The obvious test of "interest in the outer
     * band, nothing you care about behind the panel" is to compare edge energy
     * — the mean absolute luminance step between neighbours, which is what a
     * hard ink outline scores on — inside the ring against the region the panel
     * hides, and demand the ring win. It was written, and then measured against
     * nine plates, six of which are plain landscape scouts with no composition
     * in them at all:
     *
     *     colosseum 0.67   geonosis 0.64   mustafar 0.80   shelf@0 0.83
     *     shelf@300 0.93   shelf elevated 1.18   the composed candidates 0.71-0.85
     *
     * The uncomposed frames span the composed ones on both sides. The ratio is
     * not measuring composition, it is measuring WHERE THE HORIZON IS: a
     * horizon crosses the full width of the frame at one height, and unless the
     * camera is pitched down far enough to fill the plate with dirt that height
     * is in the middle third. A bound anywhere in that range would have passed
     * and failed plates for a reason with no relation to its own name — HANDOFF
     * §2.4's instrument that manufactures defects. It is gone.
     *
     * WHAT REPLACED IT is specific to this game and discriminates cleanly.
     * DESIGN.md's presentation bar is "bloom that makes the blade the brightest
     * thing in your life", and that is literally true of the pixels: over the
     * same nine plates, every frame WITHOUT a lit blade in it has exactly ZERO
     * pixels at or above 0.90 luminance, and every frame with one has 150-300
     * at 710x300. So "how many pixels are that bright" answers "is the subject
     * of this game in this picture", and "where are they" answers "can it be
     * seen" — and the first time it was run it returned 13%, which was a real
     * defect: the hero was posed with the blade sweeping toward the middle of
     * the frame, so nine tenths of it was behind the panel at 1920x1080.
     *
     * The dead-band clause below is the other half. It cannot discriminate
     * composition either, and it is not trying to: it is the regression guard
     * that catches a band of the ring going flat.
     *
     * All of it is raised together rather than as separate asserts, for
     * `cel: a shadow is READABLE`'s reason (HANDOFF §6.1b): with one assert per
     * clause the first failure is the only one anybody ever sees.
     */
    const B = bands({ plateW: img.width, plateH: img.height, panelW: PANEL_W, panelH: PANEL_H });
    const whole = region(img, 0, 0, 1, 1);
    const seen = ['left', 'right', 'top', 'bottom'].map((k) => [k, region(img, ...B.ring[k])]);

    const [px0, py0, pw0, ph0] = B.covered;
    const x0 = Math.round(px0 * img.width), x1 = Math.round((px0 + pw0) * img.width);
    const y0 = Math.round(py0 * img.height), y1 = Math.round((py0 + ph0) * img.height);
    let lit = 0, litHidden = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const k = (y * img.width + x) * 4;
        const l = (0.2126 * img.rgba[k] + 0.7152 * img.rgba[k + 1] + 0.0722 * img.rgba[k + 2]) / 255;
        if (l < HOT) continue;
        lit++;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) litHidden++;
      }
    }
    const open = lit ? 1 - litHidden / lit : 0;
    const floor = Math.round(img.width * img.height * HOT_SHARE);

    const bad = [];
    if (lit < floor) {
      bad.push(`${lit} px of ${img.width * img.height} are at or above ${HOT} luminance, against a floor of `
        + `${floor} — there is no lit blade in this plate, and a title screen for this game without one is a `
        + 'landscape photograph');
    } else if (open < 0.6) {
      bad.push(`${(open * 100).toFixed(0)}% of the plate's ${lit} brightest pixels fall outside `
        + '`.menu-wrap` at 1920x1080 — the blade is behind the interface');
    }
    for (const [k, s2] of seen) {
      if (s2.edge < whole.edge * DEAD_BAND) {
        bad.push(`the ${k} band carries ${s2.edge.toFixed(4)} of edge energy against a whole-plate `
          + `${whole.edge.toFixed(4)} — ${(s2.edge / whole.edge).toFixed(2)}x, and that band of the ring `
          + 'has nothing drawn in it');
      }
    }
    assert(bad.length === 0, bad.join('\n    '));
    return `${(open * 100).toFixed(0)}% of ${lit} highlight px in the open · `
      + seen.map(([k, s2]) => `${k} ${s2.edge.toFixed(4)}`).join(' · ')
      + ` vs whole ${whole.edge.toFixed(4)}`;
  });

  check('keyart: the header has something quiet to sit on', () => {
    needPlate();
    /*
     * `.menu-head` has no background. The wordmark and the record line are
     * painted straight onto the plate, and the only things defending them are
     * the ink halos they carry — four offsets on `.logo .lg-a`, a lighter set
     * added to `.record` when this backdrop landed — and the sink layer parsed
     * above. So this measures `.menu-head`'s WHOLE box rather than the letters,
     * because the record line is what a played profile puts there and it is
     * 10 px mono in `--dim`. Two different questions of it:
     *
     *   lum   can warm off-white type hold against it at all
     *   edge  is there drawn detail crossing the letterforms — a cloud edge or
     *         an ink outline behind a stroke is what makes type unreadable
     *         long before mean luminance does
     *
     * The box is a stated geometry measured in Chromium (tools/_bands.mjs), for
     * tools/checks/front-screen.mjs's reason: this suite has a DOM and not a
     * layout engine. `fontPx` is the guard on that pair — change the type size
     * and the stated box is stale, so the check says so instead of measuring
     * the wrong strip.
     */
    const live = /\.logo\.small\s+\.lg-a\s*,\s*\.logo\.small\s+\.lg-b\s*\{[^}]*font-size:\s*(\d+)px/.exec(CSS);
    assert(live, 'cannot find the `.logo.small` font-size rule in styles.css');
    assert(Number(live[1]) === HEAD.fontPx,
      `styles.css sets the menu wordmark at ${live[1]}px and tools/_bands.mjs states a box measured at `
      + `${HEAD.fontPx}px — re-run \`node tools/_menubands.mjs\` and paste the line it prints`);

    assert(sinkRgba, '.menu-bg has no flat sink layer over the plate, so the type sits on the raw render');
    const shown = composited();
    const band = headBand({ plateW: img.width, plateH: img.height, panelH: PANEL_H });
    const s = region(shown, ...band, 1);

    /* THE BOUNDS, and where each comes from.
     *
     * `--ink` is #f4ecdc, luminance 0.884. WCAG's contrast ratio against a
     * background of luminance L is (0.884 + 0.05) / (L + 0.05); at L = 0.42
     * that is exactly 2.0, which is the floor for 800-weight 40 px type that
     * also carries a 2 px ink outline on all four sides. It is deliberately not
     * the 4.5 a body-copy bound would use: the halo, not the fill, is what
     * separates these letters from their ground, and a 4.5 bound would forbid
     * every sky this game has and leave a backdrop nobody can see.
     *
     * `edge` is the one that actually bites, and it is measured THROUGH the
     * sink because that is what a player looks at. Measured on the candidates:
     * the shipped pose reads 0.0095, the same band with the camera pitched 7°
     * further down — which drags the cloud deck into it — reads 0.0147, and the
     * raw plate before the sink reads 0.0231. 0.020 admits a cloudy sky seen
     * through the sink and refuses one seen without it.
     */
    const INK = 0.884;
    const ratio = (INK + 0.05) / (s.lum + 0.05);
    assert(ratio >= 2.0,
      `the header band reads ${s.lum.toFixed(3)} through the sink — warm off-white on that is only ${ratio.toFixed(2)}:1`);
    assert(s.edge <= 0.020,
      `the header band carries ${s.edge.toFixed(4)} of edge energy through the sink — there is drawn detail behind the letters`);
    return `lum ${s.lum.toFixed(3)} (${ratio.toFixed(2)}:1 against --ink), sd ${s.sd.toFixed(3)}, `
      + `edge ${s.edge.toFixed(4)}, sink rgba(${sinkRgba.join(',')})`;
  });

  check('keyart: the plate can be rebuilt, and the tool says how', async () => {
    /*
     * The one thing that stops a rendered asset from becoming a hand-authored
     * one. DESIGN.md §7 says every piece of content in this game except the
     * score is generated in code; that is only true of this file while the
     * generator is in the repo and still names it. A plate somebody re-touched
     * and dropped in would pass every measurement above and quietly break the
     * claim the whole approach rests on.
     */
    const tool = await read('tools/keyart.mjs');
    assert(tool.includes(rel),
      `tools/keyart.mjs does not mention "${rel}" — the shipped plate has no generator that names it`);
    const shot = /ship:\s*\{[^}]*\}/.exec(tool);
    assert(shot, 'tools/keyart.mjs has no `ship` entry in its SHOTS table — the pose is not recorded');
    return `tools/keyart.mjs ${shot[0].replace(/\s+/g, ' ').slice(0, 96)}`;
  });
}
