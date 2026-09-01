/**
 * Pack the whole game into ONE self-contained HTML file.
 *
 * The game has no build step and does not need one: every module is already an
 * ES module, three and rapier are vendored, and rapier's WASM is base64 inside
 * its own .js. So there is nothing to compile — only to relocate.
 *
 * THE TRICK, and why it needs no bundler. A module served from a `data:` URL
 * cannot resolve a RELATIVE specifier, because a data: URL is an opaque path
 * with nothing to be relative to. But an import map resolves BARE specifiers
 * for every module in the document. So: rewrite every relative specifier in
 * every module to a bare key ('m:src/game/Enemy.js'), and give the import map
 * one entry per module pointing at that module's own data: URL. The browser's
 * own loader then does all the work — live bindings, circular imports, load
 * order — exactly as it does when the files are on disk. No bundler, no
 * re-implementation of ESM semantics, nothing to get subtly wrong.
 *
 * `import.meta.url` is the one thing that cannot survive the move: inside a
 * data: module it IS the data: URL, and `new URL(relative, dataURL)` throws.
 * src/main.js builds its music track list that way at module top level, so
 * left alone it takes the whole page down before the menu draws. It is
 * rewritten to `location.href`, which resolves and then simply 404s for the
 * one optional mp3 — the score is generated, so nothing depends on it.
 */
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, extname } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.argv[2] || `${ROOT}/borz-play.html`;
const MIN = process.argv.includes('--min');
const rel = (p) => relative(ROOT, p);
const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

const html = await readFile(`${ROOT}/index.html`, 'utf8');
const mapText = (html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/) || [])[1];
const vendorMap = mapText ? (JSON.parse(mapText).imports ?? {}) : {};

/** file path -> { key, source } for every module reachable from the entry. */
const mods = new Map();

function resolveSpec(spec, fromFile) {
  if (/^(https?|node|data):/.test(spec)) return null;
  if (spec.startsWith('.') || spec.startsWith('/')) return resolve(dirname(fromFile), spec);
  if (vendorMap[spec]) return resolve(ROOT, vendorMap[spec]);
  const prefix = Object.keys(vendorMap).find((k) => k.endsWith('/') && spec.startsWith(k));
  if (prefix) return resolve(ROOT, vendorMap[prefix] + spec.slice(prefix.length));
  return null;
}

/** Every specifier position, so each can be rewritten in place. */
function eachSpecifier(src, fn) {
  /*
   * Every pattern has EXACTLY THREE capture groups, so the replacer's fourth
   * argument is always the offset and never a group. The first version gave
   * the dynamic-import pattern a fourth group and defaulted the parameter,
   * which meant the other two patterns appended `String.replace`'s offset —
   * a bare number — to two thirds of the specifiers in the build.
   */
  const pats = [
    /((?:^|[\s;}])(?:import|export)\s[^;'"()]*?from\s*)(['"])([^'"]+)\2/g,
    /((?:^|[\s;}])import\s*)(['"])([^'"]+)\2/g,
    /(\bimport\s*\(\s*)(['"])([^'"]+)\2/g,
  ];
  let out = src;
  for (const p of pats) out = out.replace(p, (m, pre, q, spec) => {
    const next = fn(spec);
    return next === null ? m : `${pre}${q}${next}${q}`;
  });
  return out;
}

async function walk(file) {
  if (mods.has(file)) return;
  if (!await exists(file)) throw new Error(`missing module: ${rel(file)}`);
  mods.set(file, null);                       // reserve first: circular imports are normal here
  const raw = await readFile(file, 'utf8');
  const deps = [];
  eachSpecifier(raw, (spec) => { const t = resolveSpec(spec, file); if (t) deps.push(t); return null; });
  for (const d of deps) await walk(d);
  const rewritten = eachSpecifier(raw, (spec) => {
    const t = resolveSpec(spec, file);
    return t ? `m:${rel(t)}` : null;
  /*
   * `import.meta.url` inside a data: module IS the data: URL, and a data: URL
   * is an opaque path that `new URL(relative, base)` refuses as a base. Two
   * call sites build a URL that way at module top level, so left alone the
   * whole page dies before the menu draws.
   *
   * `location.href` was the first substitution and it is wrong for the same
   * reason one level along: a page opened as about:blank or from a blob has no
   * usable base either, and the throw comes back. A literal absolute URL
   * always resolves; the two things built from it (an optional mp3 and the
   * peerjs script, which is separately inlined below) then simply fail to load
   * instead of taking the page with them.
   */
  }).replaceAll('import.meta.url', JSON.stringify(`https://packed.invalid/${rel(file)}`));
  mods.set(file, rewritten);
}

const entry = resolve(ROOT, (html.match(/<script[^>]*\bsrc=["']([^"']+)["']/) || [])[1]);
await walk(entry);

// peerjs is injected as a <script src> at runtime by src/net/Net.js. Inline it
// as a data: URL so multiplayer does not reach for a file that is not there.
const peer = `${ROOT}/vendor/peerjs/peerjs.min.js`;
const peerData = await exists(peer)
  ? `data:text/javascript;base64,${(await readFile(peer)).toString('base64')}` : null;

/**
 * ── AND THE ASSETS THE PAGE ASKS FOR AT RUNTIME, WHICH IT NEVER GOT ────────
 *
 * The promise a few lines down — "nothing was fetched and nothing can 404" —
 * was true of the modules and of `styles.css`, and false of everything else.
 * Two kinds of reference escaped:
 *
 *   THE `<img>` TAGS in index.html. The boot plate and the wordmark are
 *   `src="./assets/menu/…"` attributes, not CSS `url()`, so the loop above
 *   never saw them.
 *
 *   THE CARDS THE MENU BUILDS AT RUNTIME. `LEVEL_SHOT` and `HILT_SHOT` are
 *   template literals interpolated into `background-image:url(…)` inside an
 *   inline style, so the path does not exist until a tab is opened.
 *
 * Measured on the shipped packer, single-file build opened from disk: NINE
 * failed requests — the menu backdrop, the wordmark and all seven theatre
 * screenshots. The page still worked, which is what kept it invisible:
 * `_levelArt`'s drawn fallback sits under the screenshot by design, so the
 * cards fell back to the drawings the screenshots were commissioned to
 * replace. Anyone playing the packed file was looking at the old art and
 * anyone opening the hosted site was not.
 *
 * WHAT IS INLINED IS WHAT IS REFERENCED, discovered rather than listed: every
 * `assets/…` path named by index.html or by any module in the graph. A list
 * here would be a second copy of the level roster and would go stale the day a
 * level is added (§2.3). Audio is deliberately excluded — the soundtrack is
 * 28 MB and is streamed.
 */
const ASSET_IMG = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const assetData = new Map();
async function inlineAsset(relPath) {
  if (assetData.has(relPath)) return assetData.get(relPath);
  const type = ASSET_IMG[extname(relPath).toLowerCase()];
  if (!type) return null;
  const file = `${ROOT}/${relPath}`;
  if (!await exists(file)) return null;
  const uri = `data:${type};base64,${(await readFile(file)).toString('base64')}`;
  assetData.set(relPath, uri);
  return uri;
}

/* The paths named with no interpolation in them: every one is resolved here
 * and substituted in place, in the HTML and in the module sources alike. */
const STATIC_ASSET = /(?:\.\/)?(assets\/[A-Za-z0-9_\-./]+\.(?:png|webp|jpe?g|gif|svg))/g;
/* index.html names its own — the boot plate and the wordmarks — and they are
 * in no module, so the page is scanned alongside the graph. */
for (const m of [...html.matchAll(STATIC_ASSET)]) await inlineAsset(m[1]);
for (const [file, src] of mods) {
  let out = src, hit = false;
  for (const m of [...src.matchAll(STATIC_ASSET)]) {
    const uri = await inlineAsset(m[1]);
    if (uri) { out = out.replaceAll(m[0], uri); hit = true; }
  }
  if (hit) mods.set(file, out);
}

/**
 * …AND THE INTERPOLATED ONES GO THROUGH A MAP, because `assets/previews/${key}
 * .jpg` is not a path until it is evaluated. Every candidate file in the
 * directories the graph names is offered, and the lookup falls back to the
 * original string — so a build that somehow misses one degrades to exactly the
 * behaviour it has today rather than to a broken card.
 */
/**
 * …AND THE INTERPOLATED ONES ARE WRAPPED, not rewritten by name.
 *
 * A template literal that begins `assets/` is not a path until it runs, so it
 * cannot be substituted — it is handed to `__A` instead, which resolves it
 * against the map below at the moment the card is built. Wrapping every such
 * literal rather than naming `LEVEL_SHOT` and `HILT_SHOT` is the point: the
 * next one somebody writes is carried too, and a literal whose file is missing
 * falls through `__A` unchanged, which is exactly today's behaviour.
 *
 * Runs AFTER the static pass, so anything already turned into a `data:` URI no
 * longer starts with `assets/` and is left alone.
 */
const TEMPLATE_ASSET = /`((?:\.\/)?assets\/[^`]*\$\{[^`]*)`/g;
for (const [file, src] of mods) {
  if (!TEMPLATE_ASSET.test(src)) continue;
  TEMPLATE_ASSET.lastIndex = 0;
  mods.set(file, src.replace(TEMPLATE_ASSET, (m) => `__A(${m})`));
}

const dirs = new Set();
for (const [, src] of mods) {
  for (const m of src.matchAll(/(?:\.\/)?(assets\/[A-Za-z0-9_\-./]*)\$\{/g)) dirs.add(m[1]);
}
for (const d of dirs) {
  const dir = `${ROOT}/${d}`.replace(/\/[^/]*$/, '');
  try { if (!(await stat(dir)).isDirectory()) continue; } catch { continue; }
  for (const name of await readdir(dir)) {
    await inlineAsset(`${d.replace(/[^/]*$/, '')}${name}`);
  }
}

const imports = {};
let bytes = 0;
for (const [file, src] of mods) {
  let s = src;
  if (file.endsWith('/Net.js') && peerData) {
    s = s.replace(/new URL\(\s*['"][^'"]*peerjs\.min\.js['"][^)]*\)\.href/, JSON.stringify(peerData));
  }
  /**
   * `--min` MINIFIES EACH MODULE ON THE WAY IN, for the hosted build.
   *
   * The artifact host caps a page at 16 MB and the plain pack is over it —
   * this codebase is more comment than code by design, so the cut is large:
   * 16.1 MB of module base64 becomes 6.5. It is a flag on THIS packer rather
   * than a second script, because the second script was a copy and drifted
   * within the hour: it was still inlining nothing when this file had learned
   * to inline the menu art, and the build it produced was missing the same
   * nine images this pass exists to fix.
   *
   * esbuild's transform renames locals only. Export names, import specifiers
   * and every string — the GLSL the shader surgery patches included — come
   * through byte-identical, and the specifier self-check below re-reads all of
   * them out of the minified source.
   */
  if (MIN) {
    try {
      const { transformSync } = await import('esbuild');
      s = transformSync(s, {
        /* WHITESPACE AND COMMENTS ONLY. NOT IDENTIFIERS, AND THIS IS NOT
         * CAUTION — a renaming pass produces a build that boots and then
         * cannot start a match.
         *
         * `Props.assertOpts` is the reason. Every builder in Props.js opens
         * by handing ITSELF to a guard that reads what the function reads:
         * `collectKeys` calls `fn.toString()` and pulls the option names out
         * of the SOURCE TEXT, then finds the helpers it forwards to by
         * matching their names — 'emit', 'light', 'Prop', 'Crowd', 'Storm' —
         * against that same text. Rename the locals and the extracted set
         * comes back empty, so the guard rejects every option the builder
         * genuinely honours. Measured on a full-minify build: it booted
         * cleanly, showed no page errors, and every deploy died with
         * "zn: handed an option it does not read — mat. It reads: ." — the
         * empty tail of that sentence is the whole diagnosis.
         *
         * Stripping comments and whitespace leaves identifiers, property
         * accesses and helper names exactly where the guard looks for them,
         * and this codebase is far more comment than code, so it is where
         * nearly all of the saving was anyway. */
        minifyWhitespace: true, minifyIdentifiers: false, minifySyntax: false,
        format: 'esm', target: 'es2022',
      }).code;
    } catch (e) {
      throw new Error(`pack --min needs esbuild (npm i esbuild): ${e.message}`);
    }
  }
  const b64 = Buffer.from(s, 'utf8').toString('base64');
  bytes += b64.length;
  imports[`m:${rel(file)}`] = `data:text/javascript;base64,${b64}`;
}

/*
 * SELF-CHECK. Re-read every specifier out of the REWRITTEN source and demand
 * that each one is a key of the map that was just built. This is what would
 * have caught the offset bug on the first run instead of in a browser: a
 * specifier mangled in any way at all stops being a key, and the packer fails
 * loudly rather than emitting eleven megabytes of a page that cannot boot.
 */
for (const [file, src] of mods) {
  eachSpecifier(src, (spec) => {
    if (/^(https?|node|data):/.test(spec)) return null;
    if (!(spec in imports)) throw new Error(`${rel(file)} names '${spec}', which is not in the import map`);
    return null;
  });
}

/**
 * THE TITLE PLATE IS A `url()` IN THE STYLESHEET, and a stylesheet moved into a
 * `<style>` tag resolves it against the PAGE rather than against styles.css.
 *
 * The promise printed at the end of this file — "nothing was fetched and
 * nothing can 404" — was true of all 76 modules and stopped being true the day
 * the front screen gained a backdrop. A packed page written beside `assets/`
 * still finds it, because the URL is relative and `keyart` asserts it stays
 * relative; one moved anywhere else silently falls back to the wash it
 * replaced, which is the worst kind of failure — the page still works.
 *
 * So the picture comes with it. Anything named that this cannot inline throws
 * rather than being copied through, because a `url()` this does not understand
 * is exactly the 404 the promise is about.
 */
let css = await readFile(`${ROOT}/styles.css`, 'utf8');
const IMG = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
for (const m of [...css.matchAll(/url\(\s*["']?(\.\/[^"')]+)["']?\s*\)/g)]) {
  const file = `${ROOT}/${m[1].slice(2)}`;
  const type = IMG[extname(file).toLowerCase()];
  if (!type) throw new Error(`pack: styles.css names ${m[1]}, which is not an image this can inline`);
  css = css.replace(m[0], `url("data:${type};base64,${(await readFile(file)).toString('base64')}")`);
}

/**
 * THE PACKED PAGE ALWAYS CARRIES A MAP, EVEN THOUGH THE SOURCE PAGE NO LONGER
 * DOES — and a `.replace` that matched nothing used to silently drop it.
 *
 * index.html shipped an import map until the day it turned out to be the whole
 * browser floor (Chrome 89, Firefox 108, Safari 16.4) for a game that otherwise
 * runs on engines years older; `src/` and the vendored addons name their files
 * by relative path now and the tag is gone. This packer's own mechanism is a
 * different thing entirely — every module becomes a bare key over a data: URL,
 * which is what a single file can resolve — so it still needs one, and with
 * nothing to replace it emitted an 4.77 MB page whose modules were unreachable
 * instead of a 24.7 MB one that runs.
 *
 * So: replace a map if the page has one, and INSERT one if it does not.
 */
const MAP_TAG = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
const HAS_MAP = /<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/;
let page = html
  .replace(HAS_MAP.test(html) ? HAS_MAP : /(?=<\/head>)/, HAS_MAP.test(html) ? MAP_TAG : MAP_TAG + '\n')
  .replace(/<script([^>]*)\bsrc=["'][^"']+["']([^>]*)><\/script>/,
    `<script$1$2>import "m:${rel(entry)}";</script>`)
  .replace(/<link[^>]*\bhref=["']\.\/styles\.css["'][^>]*>/, `<style>\n${css}\n</style>`);

/*
 * The inline favicon is an SVG data URI, and an SVG contains `>` characters.
 * A `<link[^>]*>` pattern therefore matches only as far as the first `>`
 * INSIDE the href and leaves the rest of the SVG loose in the head as text.
 * Tag matching here is quote-aware for that reason.
 */
const TAG = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/**
 * EVERY SUBSTITUTION BELOW HAS TO LAND, so each one is asserted rather than
 * attempted. A `String.replace` whose pattern has drifted out of index.html
 * returns the input unchanged and says nothing — which is precisely how the
 * bug this block now fixes survived: the packer rewrote the WORDS of the
 * file:// notice and left the CONDITION that fires it, and the wording change
 * made a reader of this file believe the case was handled.
 */
const must = (text, pat, next, why) => {
  if (!pat.test(text)) throw new Error(`pack: ${why} — index.html no longer matches ${pat}`);
  return text.replace(pat, next);
};

/**
 * THE `file://` NOTICE TOOK THE PACKED BUILD DOWN, AND HAD SINCE THE DAY IT WAS
 * WRITTEN.
 *
 * index.html carries an inline script that replaces `#boot`'s innerHTML with
 * "Needs a web server" when `location.protocol === 'file:'`, because a browser
 * refuses ES modules off disk. A PACKED page is opened off disk — that is the
 * entire point of it — so the notice fired on every single-file build, and it
 * does not merely say the wrong thing: it destroys `#boot-fill` and `#boot-msg`
 * on the way past. `Menu.progress` then reads `.style` of a null and the boot
 * sequence dies before `hideBoot()`, leaving a title screen that never opens.
 * Measured in headless Chromium at `file:///tmp/borz.html`: `window.SABER`
 * present, all 79 modules evaluated, nothing fetched off the page, and
 * `TypeError: Cannot read properties of null (reading 'style') at
 * Menu.progress` with "THIS BUILD DID NOT LOAD" on screen.
 *
 * The previous version of this block rewrote the two message strings, which is
 * why the fault reads as intentional: the replacement text even describes the
 * capability check this now performs. The messages were right and the trigger
 * was wrong. So the trigger becomes the thing the message already claimed — a
 * browser without WebAssembly or WebGL2 stops here, and every other browser
 * gets its boot bar.
 */
const CAPABLE = "!(window.WebAssembly && document.createElement('canvas').getContext('webgl2'))";

// The page skeleton is supplied by the host, so hand it only the body content.
let body = (page.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, page])[1];
body = must(body, /<h2>Needs a web server<\/h2>/, '<h2>This build did not load</h2>',
  'the file:// notice heading is gone');
body = must(body, /Browsers refuse to load ES modules straight from disk\.[\s\S]*?address it prints\./,
  'Every module in this page is inline, so nothing was fetched and nothing can 404. '
  + 'A browser with WebGL2 and WebAssembly runs it; one without either stops here.',
  'the file:// notice body is gone');
body = must(body, /location\.protocol === 'file:'/, CAPABLE,
  'the file:// guard this build has to disarm is gone');

const head = (page.match(/<head[^>]*>([\s\S]*?)<\/head>/) || [, ''])[1]
  .replace(/<meta[^>]*charset[^>]*>/i, '')
  /* THE PRELOAD GOES. It asks the browser to start fetching the title plate
   * early, and the plate is a data URI in the <style> above by the time this
   * runs — so the tag is a second, redundant request for a file that is no
   * longer fetched at all.
   *
   * THE ICON STAYS, AND IT USED TO GO WITH IT. `rel="icon"` was swept up by
   * the same test, and index.html's icon is a self-contained `data:` SVG
   * (index.html:8) that costs no request at all — so stripping it bought
   * nothing and cost the packed build its tab icon plus a 404 on
   * `/favicon.ico` on EVERY load, which is the browser's fallback when a page
   * declares no icon. That 404 also made this build's own notice false: it
   * prints "nothing was fetched and nothing can 404" fourteen lines above.
   *
   * The `leftover` guard could not catch it — it only inspects `assets/`
   * paths, and this request is for a file the page never named.
   *
   * AN ICON THAT IS A FILE WOULD STILL HAVE TO GO, and this does not handle
   * that case because there is no such tag: the test is `data:`, so a future
   * icon that IS a request is stripped exactly as the preload is, rather than
   * being left to 404 in a single-file build. */
  .replace(TAG, (m) => {
    if (/rel=["']preload["']/i.test(m)) return '';
    if (/rel=["']icon["']/i.test(m)) return /href=["']data:/i.test(m) ? m : '';
    return m;
  });

/**
 * THE ASSET MAP AND ITS RESOLVER, ahead of the modules that read them.
 *
 * A plain `<script>` and not a module, so it has run before the first
 * `import` is evaluated. `__A` falls through to the path it was given when a
 * file is not in the map, which keeps a build that missed one behaving exactly
 * as the unpacked game does rather than painting a hole.
 */
const assetMap = `<script>window.__PACKED_ASSETS=${JSON.stringify(
  Object.fromEntries(assetData))};window.__A=function(p){return window.__PACKED_ASSETS[
  String(p).replace(/^\\.\\//,'')]||p};</script>`;
body = assetMap + body;

/**
 * …AND THE `<img>` TAGS THE HTML CARRIES ITSELF. `src="./assets/menu/…"` is an
 * attribute, so neither the stylesheet loop nor the module passes could see
 * it; the boot plate and all three wordmarks were fetched off disk and 404ed.
 */
for (const [relPath, uri] of assetData) {
  const pat = new RegExp(`(src|href)=(["'])\\.?/?${relPath.replace(/[.]/g, '\\.')}\\2`, 'g');
  body = body.replace(pat, (m, attr, q) => `${attr}=${q}${uri}${q}`);
}

/**
 * AND THE PROMISE IS CHECKED RATHER THAN MADE. The notice this build writes
 * says "nothing was fetched and nothing can 404", and it said so for weeks
 * while nine images were being fetched. Any `assets/` path still standing in
 * the finished page — outside a `data:` URI and outside the audio that is
 * streamed on purpose — fails the pack.
 */
const leftover = [...`${head}\n${body}`.matchAll(/(?:src|href)=["'](\.?\/?assets\/[^"']+)["']/g)]
  .map((m) => m[1])
  .filter((u) => !u.includes('assets/music/'));
if (leftover.length) {
  throw new Error(`pack: ${leftover.length} asset(s) would be fetched at runtime and 404: `
    + `${[...new Set(leftover)].slice(0, 6).join(', ')}`);
}

await writeFile(OUT, `${head}\n${body}`);
const size = (await stat(OUT)).size;
console.log(`modules  : ${mods.size}`);
console.log(`module b64: ${(bytes / 1e6).toFixed(2)} MB`);
console.log(`assets   : ${assetData.size} inlined`);
console.log(`written  : ${OUT}  ${(size / 1e6).toFixed(2)} MB`);
