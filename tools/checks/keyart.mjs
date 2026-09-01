/**
 * THE TITLE SCREEN'S ART, AND THE WAYS IT COULD ROT SILENTLY.
 *
 * The front screen used to be a settings dialog on a three-gradient wash — the
 * player's note was "THE TITLE SCREEN HAS NO ART". It now carries a plate the
 * game rendered of itself (tools/keyart.mjs), and the failure modes of that
 * arrangement are all invisible from the outside:
 *
 *   IT 404s.      `background-image` is the quietest failure in CSS. A missing
 *                 file paints nothing, the wash underneath shows through, and
 *                 the screen looks exactly like it did before the work — which
 *                 is precisely the state somebody would be trying to fix.
 *   IT MOVES.     The plate is cropped by `cover` and covered by `.menu-wrap`,
 *                 so what a player sees is a RING whose two edges are set by
 *                 numbers in styles.css. Change the panel's size or the plate's
 *                 aspect and the composition is re-cropped around something
 *                 else, in silence.
 *   IT SPLITS.    The path is written in styles.css AND in index.html's
 *                 preload. Two copies of one string is HANDOFF §2.3.
 *   IT BLOATS.    It is the only binary picture in a product whose DESIGN.md
 *                 §7 says every asset but one licensed MP3 is generated in
 *                 code, and there is no compiler to notice it growing.
 *
 * ── WHY THE PIXELS ARE NOT MEASURED HERE, AND WHERE THEY ARE ─────────────
 *
 * The first version of this file decoded the plate and measured the
 * composition and the header band directly. That needs a PNG, because a WebP
 * can only be decoded by a browser and tools/verify.mjs runs eighty suites in
 * workers on four cores — HANDOFF §2.6 is a long record of what one heavy
 * suite does to that run, and a Chromium launch in the gate would also make
 * `npm run verify` depend on a browser binary. Measured on the shipped
 * 2560x1080 frame, the best PNG this repo's tooling can make (indexed,
 * median-cut to 256 colours, zlib level 9 with per-row filter selection) is
 * 628 KB against 96 KB for WebP q70. That is 532 KB of every player's
 * bandwidth, on a game whose whole pitch is that it opens at a URL, spent to
 * make a test more convenient.
 *
 * So the plate is a WebP and the four bounds that need pixels moved to the
 * point the artefact is MADE: `tools/keyart.mjs --ship` measures them on the
 * lossless render and refuses to write a plate that fails, printing every
 * number. That is a better place to measure a composition — before the lossy
 * codec rather than after it — and a worse place to keep a guarantee, because
 * nothing re-measures the committed file. Both halves are true and the trade
 * was made deliberately. The last check below is the tripwire on it.
 *
 * What survives without a decoder is more than it sounds, and it is all here:
 * the plate's dimensions come out of its own RIFF header, so the crop
 * geometry, the aspect and the upscale factor are still recomputed from
 * `.menu-wrap`'s own declaration through tools/_bands.mjs rather than typed.
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { webpInfo } from '../_png.mjs';
import { bands, HEAD, MAX_ASPECT, MIN_ASPECT, REF_W, REF_H } from '../_bands.mjs';
import { functionBody } from './_source.mjs';
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
 * 160 KB, against a shipped 96. The plate is fetched LAZILY — `#menu` is
 * `display:none` until the boot finishes and a background-image inside a
 * display:none subtree is never requested — so not one byte of it is on the
 * critical path to first paint, and the `<link rel=preload as=image
 * fetchpriority=low>` in index.html starts it early without competing with the
 * 76 ES modules and the Rapier WASM blob the boot is actually waiting on.
 *
 * The headroom is 1.7x rather than 1.05x on purpose: a future plate may be a
 * busier level or a wider aspect, and a bound that fires on every recomposition
 * is a bound somebody deletes. 160 KB is still a quarter of what the same
 * picture costs as the best PNG this repo can produce, and 0.5% of the one
 * asset already shipped (`assets/music/theme.mp3`, 29.4 MB).
 */
const BUDGET = 160 * 1024;

export async function run({ check, assert }) {
  const CSS = await read('styles.css');
  const HTML = await read('index.html');

  /* ── what the stylesheet actually asks for ───────────────────────────── */
  const bg = rule(CSS, '.menu-bg');
  const urls = [...(bg ?? '').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  const src = urls[0] ?? null;
  const rel = src ? src.replace(/^\.\//, '') : null;

  let info = null, fileBytes = 0, decodeErr = null;
  if (rel) {
    try {
      const buf = await bytes(rel);
      fileBytes = buf.length;
      info = webpInfo(buf);
    } catch (e) { decodeErr = e.message; }
  }

  /* Every check past the first needs the plate's dimensions, and there are
   * none if the file is missing. They say so once, in the words of the check
   * that owns that failure, rather than each throwing a TypeError about
   * `null.width` — identical stack traces are how a real second failure hides. */
  const needPlate = () => assert(info,
    `${rel || ".menu-bg's url()"} is missing or is not a WebP (${decodeErr || 'no url'})`
    + ' — see "the menu names a backdrop"');

  /* `.menu-wrap` owns the panel size. Nothing here types 1180 or 770. */
  const wrap = rule(CSS, '.menu-wrap') ?? '';
  const dims = /width:\s*min\((\d+)px[^)]*\);\s*height:\s*min\((\d+)px/.exec(wrap);
  const PANEL_W = dims ? Number(dims[1]) : 0;
  const PANEL_H = dims ? Number(dims[2]) : 0;
  const B = () => bands({ plateW: info.width, plateH: info.height, panelW: PANEL_W, panelH: PANEL_H });

  check('keyart: the menu names a backdrop, and the backdrop is there', async () => {
    assert(bg, 'styles.css has no `.menu-bg` rule at all');
    assert(urls.length === 1,
      `.menu-bg carries ${urls.length} url() layers — the ring is specified against exactly one plate`);
    assert(!/^(https?:|\/\/|data:)/.test(src),
      `.menu-bg fetches "${src}" — this product ships no remote asset, and a data: URI would put the plate `
      + 'inside a render-blocking stylesheet, which is the one place it must not be');
    /*
     * THE POINT OF THIS WHOLE FILE. A background-image that 404s paints
     * nothing and falls back to the wash underneath, which is the exact
     * appearance of the defect the plate was made to fix. Nothing in a browser
     * reports it and nothing else in the suite would notice.
     */
    const s = await stat(new URL('../../' + rel, import.meta.url)).catch(() => null);
    assert(s && s.isFile(),
      `.menu-bg loads "${src}" and there is no such file — the title screen has silently gone back to a gradient`);
    assert(s.size > 4096, `${rel} is ${s.size} bytes, which cannot be a plate`);
    assert(info, `${rel} is not a WebP: ${decodeErr}`);
    return `${rel}, ${(s.size / 1024).toFixed(0)} KB, ${info.kind.trim()} ${info.width}x${info.height}`;
  });

  check('keyart: the sink is over the plate, so the interface is not sitting on a raw render', () => {
    /*
     * `.menu-head` has no background of its own — the wordmark and the record
     * line are painted straight onto the plate — so the only things between
     * warm off-white type and a lit ash sky are the ink halos they carry and
     * this layer. It is written as a two-stop gradient of one colour because
     * that is CSS's only way to spell "a flat field", which is law 2 of this
     * stylesheet's own header.
     *
     * tools/keyart.mjs reads this same alpha out of this same rule and refuses
     * to ship a plate whose header band does not clear 2.0:1 through it, so the
     * number is load-bearing rather than decorative: raise it and the art
     * sinks, drop it and the next plate is rejected at the door.
     */
    const sink = /linear-gradient\(\s*rgba?\(([\d.,\s]+)\)\s*,\s*rgba?\([\d.,\s]+\)\s*\)/.exec(bg ?? '');
    assert(sink, '.menu-bg has no flat sink layer over the plate — the type would sit on the raw render');
    const [r, g, b, a] = sink[1].split(',').map((n) => Number(n.trim()));
    assert(Number.isFinite(a) && a > 0.2 && a < 0.8,
      `the sink is rgba(${sink[1]}) — an alpha of ${a} is either invisible or an erasure`);
    /* Layer order in the shorthand is TOP first, so the url() must be last or
     * the plate is painted over its own grade. */
    assert(bg.lastIndexOf('url(') > bg.lastIndexOf('linear-gradient('),
      'the url() layer is not the last in `.menu-bg` — an earlier background layer paints ON TOP of a later '
      + 'one, so the plate would be covering the washes instead of sitting under them');
    return `rgba(${r},${g},${b},${a}) over the plate, url() last`;
  });

  check('keyart: the server sends it as an image, and the packed page can find it', async () => {
    needPlate();
    /*
     * `tools/serve.mjs` answers `MIME[extname] || 'application/octet-stream'`,
     * which is HANDOFF §2.3's other half — a missing thing answered with a
     * plausible default instead of an error. That file's own header records
     * this exact defect being found once already, for `.mp3`. It is silent
     * because every browser sniffs an image referenced from CSS and draws it
     * anyway, so it would only ever surface somewhere stricter.
     */
    const server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/${rel}`);
      assert(res.status === 200, `GET /${rel} answered ${res.status}`);
      const body = await res.arrayBuffer();
      assert(body.byteLength === fileBytes, `/${rel} served ${body.byteLength} of ${fileBytes} bytes`);
      const type = res.headers.get('content-type') || '';
      assert(type.startsWith('image/'),
        `/${rel} is served as "${type}" — tools/serve.mjs's MIME table has no entry for this extension. `
        + "Add `'.webp': 'image/webp',` beside its '.png' entry.");
      /*
       * And the SINGLE-FILE build. tools/pack.mjs inlines styles.css into a
       * <style> tag and tells the reader "nothing was fetched and nothing can
       * 404" — true of all 76 modules and no longer true of this one line. The
       * URL is relative, so a packed page written beside `assets/` still finds
       * it and one moved elsewhere falls back to the wash. That is a limit
       * rather than a defect only while this clause holds.
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
     * otherwise arrive as a visible pop the moment the menu appears.
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
    /*
     * MEASURED, and it is the whole reason the plate is 21:9. `cover` crops on
     * one axis and which axis depends on the viewport, so a plate at least as
     * wide as the widest viewport in range is only ever cropped horizontally —
     * and the bands above and below the panel, which are the two widest pieces
     * of the ring, are never cut. tools/_menubands.mjs in Chromium at
     * 1920x1080 against this panel, over viewports from 4:3 to 21:9:
     *
     *              source 16:9        source 21:9
     *   sides      130 screen px      130 screen px
     *   top         20 screen px      155 screen px
     *   bottom      20 screen px      155 screen px
     *
     * The sides are the same either way, because they are set by (viewport
     * width − panel width) and the 4:3 crop and neither of those knows what the
     * source aspect is. Seven and a half times the usable band, for one number
     * in the render size.
     */
    const b = B();
    assert(!b.cropsVertically,
      `the plate is ${b.aspect.toFixed(3)}:1 and the widest viewport in range is ${MAX_ASPECT.toFixed(3)}:1, `
      + 'so `cover` crops it vertically and the top and bottom bands stop being guaranteed');
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const r = b.ring[side];
      assert(r[2] > 0.005 && r[3] > 0.005,
        `the ${side} band is ${(r[2] * 100).toFixed(1)}% x ${(r[3] * 100).toFixed(1)}% of the plate — `
        + '`.menu-wrap` has grown past the crop-safe part of it and that band is gone');
    }
    const px = (r) => `${Math.round(r[2] * info.width)}x${Math.round(r[3] * info.height)}`;
    return `${b.aspect.toFixed(3)}:1 · crop-safe ${(b.safe[2] * 100).toFixed(1)}% x ${(b.safe[3] * 100).toFixed(1)}% `
      + `over ${MIN_ASPECT.toFixed(2)}…${MAX_ASPECT.toFixed(2)} · ring sides ${px(b.ring.left)}, `
      + `top ${px(b.ring.top)} plate px`;
  });

  check('keyart: it is not upscaled at the viewport every number here was measured at', () => {
    needPlate();
    /*
     * `cover` scales by max(vw/pw, vh/ph). At 1920x1080 a 2560x1080 plate
     * scales by exactly 1.0 and anything smaller is blown up — and the one
     * thing this art direction cannot survive being blown up is its ink
     * outline, which is a one-to-two pixel hard black line by construction.
     * Above the reference viewport it is upscaled and that is accepted; at and
     * below it, it is pixel for pixel.
     */
    const s = Math.max(REF_W / info.width, REF_H / info.height);
    assert(s <= 1.0001,
      `at ${REF_W}x${REF_H} the plate is drawn at ${s.toFixed(2)}x — every ink outline in it is soft`);
    return `${info.width}x${info.height}, drawn at ${s.toFixed(3)}x at ${REF_W}x${REF_H}`;
  });

  check('keyart: the plate costs what a page with no build step can spend', () => {
    needPlate();
    assert(fileBytes <= BUDGET,
      `${rel} is ${(fileBytes / 1024).toFixed(0)} KB against a ${(BUDGET / 1024).toFixed(0)} KB budget`);
    /* And it is a picture rather than a placeholder that happens to be cheap:
     * 2.8 megapixels of this renderer do not compress to nothing. */
    const perPx = fileBytes / (info.width * info.height);
    assert(perPx > 0.005,
      `${(perPx * 1000).toFixed(1)} millibytes per pixel — that is a flat fill, not a render of this game`);
    return `${(fileBytes / 1024).toFixed(0)} KB for ${(info.width * info.height / 1e6).toFixed(1)} Mpx `
      + `(${perPx.toFixed(3)} B/px) against a ${(BUDGET / 1024).toFixed(0)} KB budget`;
  });

  check('keyart: the header band the plate was posed against is the one the CSS paints', () => {
    /*
     * tools/keyart.mjs will not write a plate whose HEADER BAND fails its
     * bounds — mean luminance through the sink, and edge energy behind the
     * letterforms — and that band's rectangle is a stated geometry in
     * tools/_bands.mjs, measured in Chromium, for tools/checks/front-screen's
     * reason: this suite has a DOM and not a layout engine.
     *
     * A stated rectangle beside a live stylesheet is HANDOFF §2.3 exactly, so
     * this is the tripwire on the pair. Resize the wordmark and the stated box
     * is stale, the generator measures the wrong strip, and the next plate is
     * gated on a band the type does not occupy. Both directions are covered:
     * the base rule must agree, and no media query may move it at a height the
     * reference viewport satisfies.
     *
     * THE NUMBER IT READS IS A WIDTH NOW. The wordmark used to be two <span>s
     * of `ui-sans-serif` and the size that mattered was their `font-size`; it
     * is drawn geometry now — one <svg> with a fixed viewBox — so the single
     * number that sets it is `width` on `.logo.small .wordmark`, and the height
     * follows from the mark's 6.778:1 aspect. Same pairing, same failure mode,
     * one declaration further along.
     */
    const live = /\.logo\.small\s+\.wordmark\s*\{[^}]*width:\s*min\((\d+)px/.exec(CSS);
    assert(live, 'cannot find the `.logo.small .wordmark` width rule in styles.css');
    assert(Number(live[1]) === HEAD.markPx,
      `styles.css sets the menu wordmark at ${live[1]}px wide and tools/_bands.mjs states a header box measured `
      + `at ${HEAD.markPx}px — re-run \`node tools/_menubands.mjs\` and paste the line it prints`);
    let queries = 0;
    for (const m of CSS.matchAll(/@media\s*\(([^)]*)\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      if (!/\.logo(?:\.small)?\s+\.wordmark/.test(m[2])) continue;
      queries++;
      const min = /min-height:\s*(\d+)px/.exec(m[1]);
      const max = /max-height:\s*(\d+)px/.exec(m[1]);
      assert(!min || Number(min[1]) > REF_H,
        `@media (${m[1]}) resizes the wordmark and ${REF_H}px satisfies it — the stated header box was measured `
        + `at ${REF_W}x${REF_H} and is wrong there`);
      assert(!max || Number(max[1]) < REF_H,
        `@media (${m[1]}) resizes the wordmark and ${REF_H}px satisfies it — same problem from the other side`);
    }
    return `${live[1]}px of mark, ${queries} media override(s) clear of ${REF_H}px, matching the `
      + `${HEAD.w}x${HEAD.h} box tools/_bands.mjs states`;
  });

  /* ══════════════════════════════════════════════════════════════════
   *  THE FRONT SCREEN'S OTHER ART — the name, and the screen before the menu
   *
   *  Four things were asked for in one breath and every one of them is the
   *  kind that comes back:
   *
   *    THE WORDMARK   was `ui-sans-serif` at weight 800, which is to say it was
   *                   a different object on every operating system and belonged
   *                   to none of them. It is drawn now. The way that regresses
   *                   is somebody "simplifying" 2 KB of path data back into a
   *                   <span> with a font-size on it.
   *    THE GLYPH      the lit saber bar beside the name was removed from the
   *                   menu once already and stayed on the boot screen, which is
   *                   the screen a player meets FIRST. Removed from one of two
   *                   places is how it survived the first instruction.
   *    THE BOOT ART   is drawn rather than fetched, and the reason is a budget:
   *                   this screen is up while 79 modules and a WASM blob are in
   *                   flight. A later hand reaching for `.menu-bg`'s 96 KB
   *                   plate would look like an improvement and would put it on
   *                   the critical path.
   *    THE HISTORY    under the title is gone. `progressLines()` is still
   *                   exported and still tested, so nothing stops a future
   *                   caller from putting it back where it was.
   * ══════════════════════════════════════════════════════════════════ */

  /* THE PROSE IS NOT THE PAGE. Both files are heavily commented, and several of
   * those comments name the very things the checks below say must be gone —
   * that is the record of why they went, and it is exactly what a future reader
   * needs. So the "is it still here" questions are asked of the MARKUP and the
   * DECLARATIONS, with comments stripped; asking them of the raw text makes a
   * check that can only be satisfied by deleting the explanation. */
  const noComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const HTML_C = noComments(HTML), CSS_C = noComments(CSS);

  /** `#boot`'s markup alone — the screen, not the page it sits in. */
  const bootHtml = HTML_C.slice(HTML_C.indexOf('<div id="boot"'), HTML_C.indexOf('<div id="menu"'));

  check('keyart: the wordmark is the supplied file, on every screen, from one copy', () => {
    /*
     * THIS CHECK USED TO SAY "DRAWN GEOMETRY", and the thing it was guarding
     * has been superseded rather than broken. It held a stencil alphabet in
     * index.html to being defined once and <use>d twice — a real property, and
     * the right one while the mark was geometry this repository authored.
     *
     * The player supplied their own logo ("I hate your version") and it is a
     * PAINTING: brush strokes, a target reticle, soft edges. That is not
     * expressible as a handful of polygons, and a recreation of it — which was
     * built, and is still in `tools/wordmark.mjs` — is a second artefact that
     * drifts from the one the player actually drew. So the page loads the file.
     *
     * WHAT SURVIVES UNCHANGED is everything the old check was really about:
     *
     *   NO WEBFONT. Still the hard constraint, and still for the reason one
     *     file over: tools/checks/packed.mjs boots the single-file build from
     *     `file://` and fails on one byte fetched off-page.
     *   ONE COPY. Every screen that carries it names the same path, so the
     *     browser decodes it once; a second exported crop for one of them would
     *     be HANDOFF §2.3 with a bigger diff. The COUNT is not the property and
     *     was pinned at three until the Holocron took the menu's own plate and
     *     wordmark — see the note at that assertion.
     *   IT IS LOCAL. A logo on a CDN breaks the packed build exactly as a
     *     webfont does.
     *
     * And one is new, because an <img> can fail in a way a <use> cannot: the
     * intrinsic size has to be in the markup, or the header reflows when the
     * mark decodes and every band tools/_bands.mjs states is measured against
     * a layout that existed for one frame.
     */
    assert(!/@font-face/i.test(CSS_C), 'styles.css declares an @font-face — the packed build fetches nothing off-page');
    assert(!/fonts\.(googleapis|gstatic)\.com/i.test(HTML_C + CSS_C),
      'the front end names a Google Fonts host — see tools/checks/packed.mjs, which boots from file://');

    /* EVERY SCREEN THAT IS NOT THE GAME CARRIES IT, and the count is not the
     * property — ONE COPY is. The count was pinned at three (boot, menu,
     * loading) and went to four when the Holocron stopped having a backdrop of
     * its own: "when looking at the holocron in the main menu the background
     * should be the same background that the main menu has (game title still at
     * the top)". A fourth screen naming the same file is the rule working; a
     * fourth screen naming a second crop is HANDOFF §2.3 with a bigger diff,
     * and that is what the `srcs.size` line below has always been for. */
    const marks = [...HTML_C.matchAll(/<img[^>]*class="wordmark"[^>]*>/g)].map((m) => m[0]);
    assert(marks.length >= 3,
      `${marks.length} screen(s) carry the wordmark — the boot screen, the menu and the loading `
      + 'screen all do, and any non-game screen may');
    const srcs = new Set(marks.map((m) => /src="([^"]+)"/.exec(m)?.[1]));
    assert(srcs.size === 1,
      `${marks.length} marks name ${srcs.size} different files: ${[...srcs].join(', ')} — the `
      + 'browser must decode the painting once');
    const src = [...srcs][0];
    assert(src && src.startsWith('./'),
      `the wordmark is loaded from "${src}" — it must be a same-directory relative path, because `
      + 'tools/pack.mjs writes a page that can live anywhere and packed.mjs boots it from file://');
    assert(existsSync(new URL('../../' + src.replace(/^\.\//, ''), import.meta.url)),
      `the wordmark names "${src}" and there is no such file — every screen would show a broken image`);
    for (const m of marks) {
      assert(/\bwidth="\d+"/.test(m) && /\bheight="\d+"/.test(m),
        'a wordmark <img> has no intrinsic width/height in the markup — the header reflows as it decodes, '
        + 'and tools/_bands.mjs states a band measured against the settled layout');
    }
    for (const id of ['boot', 'menu', 'loading']) {
      assert(new RegExp(`<div id="${id}"[\\s\\S]*?class="wordmark"`).test(HTML_C),
        `the ${id} screen does not carry the wordmark`);
    }

    /* And the things this replaced are GONE rather than orphaned — an unused
     * selector is the thing that gets re-attached by accident, which is this
     * file's own note about the tagline and the byline. `wm-body` joins the
     * list: it was the generated geometry, and leaving 4.5 KB of dead path data
     * in the page is exactly that trap. */
    for (const dead of ['lg-a', 'lg-b', 'wm-body', 'wm-mark']) {
      assert(!HTML_C.includes(dead) && !CSS_C.includes(dead),
        `"${dead}" is still in the front end — that is a wordmark this replaced`);
    }
    return `${src}, one file on ${marks.length} screens, no @font-face`;
  });

  check('keyart: the lit saber glyph is gone from the boot screen too, not just the menu', () => {
    /*
     * IT WAS REMOVED ONCE ALREADY. The instruction was for the menu's header
     * and it was carried out there; `.logo-blade` stayed in the boot screen's
     * markup and in a `.logo.small` override beside it, so the glyph went on
     * appearing next to the name on the screen the player meets FIRST — "it
     * still eventually pops up next to the name at the beginning, which is
     * annoying". A removal that covers one of two call sites is the failure
     * this check exists for, so it asks about the whole front end and not
     * about `#boot`.
     */
    assert(!HTML_C.includes('logo-blade'),
      'the saber-line glyph is back in the front end\'s markup — it was removed from the menu and then from the '
      + 'boot screen, on instruction, twice');
    assert(!CSS_C.includes('logo-blade'), 'styles.css still styles `.logo-blade` — an unused selector gets re-attached');
    assert(!/@keyframes\s+ignite\b/.test(CSS_C), 'the `ignite` keyframe is back, which is the glyph growing out of nothing');
    return 'no .logo-blade, no @keyframes ignite';
  });

  check('keyart: the boot screen carries art, and the art costs no request', () => {
    /*
     * "The first loading screen before the main menu also needs an art
     * background like in the main menu, like right now it's bare nothing."
     *
     * Both halves are asserted, and the second is the one that will be argued
     * with. The obvious way to give this screen a backdrop is `.menu-bg`'s
     * plate — and everything styles.css says about that plate costing nothing
     * at first paint depends on `#menu` being display:none while the boot runs.
     * A VISIBLE element naming it puts 96 KB in front of the 79 modules and the
     * WASM blob the boot is actually waiting on, which is to say it makes the
     * wait longer in order to decorate it. So the boot's art is drawn: flat
     * polygons in the document that is already on the wire.
     */
    assert(/<svg class="boot-art"/.test(bootHtml), '`#boot` has no `.boot-art` — the first screen is bare again');
    assert(rule(CSS, '.boot-art'), 'styles.css has no `.boot-art` rule, so whatever is in the markup is not covering');
    const art = /<svg class="boot-art"[\s\S]*?<\/svg>/.exec(bootHtml)[0];
    for (const [what, re] of [['a url()', /url\(/], ['an <image>', /<image\b/i], ['a remote href', /href="(?:https?:)?\/\//i]]) {
      assert(!re.test(art),
        `the boot art names ${what} — this screen is what a player looks at while the modules load and it must `
        + 'not be waiting on anything itself');
    }
    /*
     * …AND THE PLATE IS ALLOWED ON TOP OF THE DRAWING, WHICH THIS USED TO BAN.
     *
     * The ban was `!/title\.webp/.test(bootHtml)`, and the argument for it was
     * sound: a VISIBLE element naming the plate puts 96 KB in front of the
     * modules the boot is waiting on. What the argument missed is that the
     * page ALREADY names it, on line 32, as `rel=preload fetchpriority=low` —
     * so those bytes are on the wire during the boot whether or not `#boot`
     * mentions them, and the only question left is whether anything WAITS on
     * them. Asked for twice by the player: "the background on the very first
     * loading screen is not the same as the one in the main menu — replace it
     * with the one in the main menu (I've said this to you before)."
     *
     * So the rule is no longer "do not name it". It is: the drawing must still
     * be there and must still be first (asserted above), and the plate may
     * only arrive as a layer that nothing blocks on. That means an <img> which
     * starts transparent and is faded in by its own load event — never a CSS
     * background, which cannot say when it is ready, and never on `.boot-art`
     * itself, which is the thing that has to paint immediately.
     */
    const plate = /<img[^>]*class="boot-plate"[^>]*>/.exec(bootHtml)?.[0] || '';
    if (/title\.webp/.test(bootHtml)) {
      assert(plate, 'the boot screen names the title plate somewhere other than the `.boot-plate` layer — '
        + 'the drawn art is what paints first and nothing else on this screen may reach for the network');
      assert(/\bonload=/.test(plate) && /classList\.add\('in'\)/.test(plate),
        'the boot plate does not fade itself in on load — without that it either pops or is timed, and a timed '
        + 'fade shows the half-decoded state');
      assert(/opacity:0/.test(CSS_C.replace(/\s+/g, '').replace(/;/g, ';')) || /\.boot-plate\{[^}]*opacity:0/.test(CSS_C.replace(/\s+/g, '')),
        '`.boot-plate` does not start transparent, so it is not layering over the drawing — it is replacing it');
      assert(/rel="preload"[^>]*title\.webp|title\.webp[^>]*rel="preload"/.test(HTML_C.replace(/\s+/g, ' ')),
        'the plate is shown on the boot screen without being preloaded, so it now IS a new request on the boot path');
    }
    /* And it is a picture rather than three rectangles: the plate next door has
     * a per-pixel floor for the same reason. */
    const shapes = (art.match(/<(path|rect|circle|polygon|use)\b/g) || []).length;
    assert(shapes >= 14, `the boot art is ${shapes} shapes — that is a wash, not a drawing of somewhere`);
    return `${shapes} shapes, ${(art.length / 1024).toFixed(1)} KB inline, nothing fetched`;
  });

  check('keyart: nothing writes a history line under the title, and the history still exists', async () => {
    /*
     * "Right now under the name of the game in the main menu you have a bunch
     * of little white text describing a bunch of bullshit like your progress
     * and a bunch of other useless shit — I want you to remove it completely."
     *
     * TWO ASSERTIONS AND THEY PULL AGAINST EACH OTHER ON PURPOSE. The readout
     * is gone from the menu: `showRecord()` is deleted and main.js no longer
     * imports `progressLines`. And the record itself is NOT gone — `recordRun`
     * still files every run and `progressLines` is still exported and still
     * held to its contents by tools/checks/progress.mjs, history.mjs,
     * runrules.mjs and progression.mjs. Deleting the store along with its one
     * display would have been the easy reading of the instruction and would
     * have quietly taken four suites' subject with it.
     *
     * `#menu-record` survives as the failure notice `deploy()`'s catch writes,
     * which tools/checks/session.mjs asserts is still said — "an invisible
     * failure is the same black screen". So the element keeps exactly one
     * writer and it is not this one.
     */
    const main = await read('src/main.js');
    const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/\bprogressLines\b/.test(code),
      'src/main.js still calls progressLines — the history is back under the title of the game');
    assert(!/\bshowRecord\b/.test(code), 'showRecord() is back in src/main.js');
    /**
     * EVERY WRITER IS A FAILURE NOTICE, WHICH IS THE PROPERTY — not "there is
     * one of them". The count was pinned at one and went to two when a second
     * door onto a world was built (`enterHangar`, which fails exactly the way
     * `deploy` does and has to say so on the same line, for
     * `tools/checks/session.mjs`'s reason: an invisible failure is the same
     * black screen). A third door would be a third writer and would be equally
     * correct; a writer on an unconditional path is the defect, at any count.
     *
     * INSIDE A CATCH, ESTABLISHED BY BRACE COUNTING and not by "a `catch`
     * token appears within nine hundred characters". `main.js` has eight
     * `catch` sites; the old regex asked only whether one of them happened to
     * sit nearby, so moving the write onto any unconditional path that follows
     * one — turning the failure notice into a permanent line under the title of
     * the game, which is the exact defect this check was written to end — left
     * it green.
     *
     * BACKWARDS TO THE ENCLOSING BLOCK is the only direction that survives the
     * `try { world.dispose(); } catch {}` nested inside these very catches: a
     * forward scan for "the last catch seen" loses the outer one the moment the
     * inner one closes.
     */
    const sites = [...code.matchAll(/getElementById\('menu-record'\)/g)].map((m) => m.index);
    assert(sites.length >= 1,
      'nothing writes #menu-record at all — the failure notice is gone, and a deploy that dies '
      + 'now says nothing anywhere the player can read it');
    /** The brace that opens the block this offset sits directly inside. */
    const blockAt = (at) => {
      let depth = 0;
      for (let i = at; i >= 0; i--) {
        if (code[i] === '}') depth++;
        else if (code[i] === '{') { if (depth === 0) return i; depth--; }
      }
      return -1;
    };
    const isCatch = (open) =>
      open > 0 && /catch\s*(\([^)]*\))?\s*$/.test(code.slice(Math.max(0, open - 80), open));

    for (const at of sites) {
      const open = blockAt(at);
      assert(open > 0, 'a #menu-record write is not inside any block');
      /**
       * ══ OR INSIDE A HELPER NOTHING BUT A CATCH CALLS ══════════════════
       *
       * The rule this check exists for is "main.js touches that element only
       * to report a failure". Lexically-inside-a-catch was the whole of it
       * while there was exactly one door that could fail. There are two now —
       * Ignite and the flight deck — and `pause-card.mjs` separately requires
       * that main.js keep exactly ONE writer, so that two inline copies is not
       * an available answer either.
       *
       * A named helper called only from catches satisfies both, and satisfies
       * the actual invariant better than a duplicated line does. So the rule
       * grows one clause rather than being weakened: if the write is in a
       * function, EVERY call site of that function must itself be inside a
       * catch. That is the same guarantee, established the same way.
       */
      if (!isCatch(open)) {
        const head = code.slice(Math.max(0, open - 200), open);
        const fn = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*$/.exec(head);
        assert(fn, `a #menu-record writer at ${at} is neither inside a catch nor inside a named `
          + 'function — there is nothing to establish that only a failure reaches it');
        const name = fn[1];
        const calls = [...code.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))]
          .map((m) => m.index)
          .filter((i) => i < open - 200 || i > at);
        assert(calls.length >= 1, `${name} writes #menu-record and nothing calls it`);
        for (const c of calls) {
          assert(isCatch(blockAt(c)),
            `${name} writes #menu-record and is called from outside a catch at ${c} — a writer `
            + 'reachable on an unconditional path is a permanent line under the title of the game');
        }
        continue;
      }
      assert(isCatch(open),
        `a #menu-record writer at ${at} is not inside a catch — see tools/checks/session.mjs, `
        + 'which requires a failed deploy to say so somewhere the player can read it, and ONLY a '
        + 'failed one. A writer on an unconditional path is a permanent line under the title.');
    }
    /**
     * AND `deploy` STILL SAYS SO WHEN IT FAILS, because that is the door
     * `session.mjs` names by name.
     *
     * It used to be enough to look for the `getElementById` inside `deploy`.
     * With the write moved into a helper — see the clause above, and the two
     * doors that can now fail — what has to be true is that deploy's own catch
     * still reaches it. So the question is asked of the call rather than of
     * the DOM lookup.
     */
    const body = functionBody(code, 'function deploy(');
    const writer = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[^}]{0,200}getElementById\('menu-record'\)/
      .exec(code);
    const reaches = body.includes("getElementById('menu-record')")
      || (writer && new RegExp(`\\b${writer[1]}\\s*\\(`).test(body));
    assert(reaches,
      'deploy() no longer says anything when it fails — neither a #menu-record write of its own '
      + `nor a call to the one that does${writer ? ` (${writer[1]})` : ''}. A deploy that dies in `
      + 'silence is the same black screen this notice exists to prevent');
    /* …and the thing it stopped displaying is still there to display. */
    const prog = await read('src/game/Progress.js');
    assert(/export function progressLines\b/.test(prog),
      'progressLines() was deleted along with its display — the instruction was to remove the line from the menu, '
      + 'not to stop counting runs');
    return `no progressLines in main.js; ${sites.length} #menu-record writer(s), every one of `
      + 'them inside a catch; Progress.js intact';
  });

  check('keyart: the plate can be rebuilt, and its bounds are still enforced where they live', async () => {
    /*
     * The two things that stop a rendered asset from becoming a hand-authored
     * one. DESIGN.md §7 says every piece of content in this game except the
     * score is generated in code; that stays true of this file only while the
     * generator is in the repo, still names it, and still refuses to write a
     * plate that fails its bounds. A picture somebody re-touched and dropped in
     * would pass every other measurement here.
     */
    const tool = await read('tools/keyart.mjs');
    assert(tool.includes(rel),
      `tools/keyart.mjs does not mention "${rel}" — the shipped plate has no generator that names it`);
    assert(/\n\s*ship:\s*\{/.test(tool),
      'tools/keyart.mjs has no `ship` entry in its SHOTS table — the pose is not recorded and cannot be re-run');
    assert(tool.includes('NOT SHIPPED'),
      'tools/keyart.mjs no longer refuses to write a plate that fails its bounds — with that gate gone, the '
      + "composition and the header's legibility are measured NOWHERE (see this file's header)");
    for (const k of ['headBand', 'bands(', 'cropsVertically']) {
      assert(tool.includes(k),
        `tools/keyart.mjs no longer uses \`${k}\` — the generator and this file have stopped sharing tools/_bands.mjs`);
    }
    return 'SHOTS.ship, the --ship gate, and tools/_bands.mjs shared with this file';
  });
}
