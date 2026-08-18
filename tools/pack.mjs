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
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, relative, extname } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.argv[2] || `${ROOT}/borz-play.html`;
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

const imports = {};
let bytes = 0;
for (const [file, src] of mods) {
  let s = src;
  if (file.endsWith('/Net.js') && peerData) {
    s = s.replace(/new URL\(\s*['"][^'"]*peerjs\.min\.js['"][^)]*\)\.href/, JSON.stringify(peerData));
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

let page = html
  .replace(/<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/,
    `<script type="importmap">${JSON.stringify({ imports })}</script>`)
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

// The page skeleton is supplied by the host, so hand it only the body content.
const body = (page.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, page])[1]
  // The file:// fallback tells a reader to start a web server. In a packed
  // build there is nothing to serve, so it would be advice for a situation
  // that cannot arise, given to someone whose actual problem is different.
  .replace(/<h2>Needs a web server<\/h2>/, '<h2>This build did not load</h2>')
  .replace(/Browsers refuse to load ES modules straight from disk\.[\s\S]*?address it prints\./,
    'Every module in this page is inline, so nothing was fetched and nothing can 404. '
    + 'A browser with WebGL2 and WebAssembly runs it; one without either stops here.');

const head = (page.match(/<head[^>]*>([\s\S]*?)<\/head>/) || [, ''])[1]
  .replace(/<meta[^>]*charset[^>]*>/i, '')
  /* …and the PRELOAD goes with the icon. It asks the browser to start fetching
   * the title plate early, and the plate is a data URI in the <style> above by
   * the time this runs — so the tag is a second, redundant request for a file
   * that is no longer fetched at all. */
  .replace(TAG, (m) => (/rel=["'](?:icon|preload)["']/i.test(m) ? '' : m));

await writeFile(OUT, `${head}\n${body}`);
const size = (await stat(OUT)).size;
console.log(`modules  : ${mods.size}`);
console.log(`module b64: ${(bytes / 1e6).toFixed(2)} MB`);
console.log(`written  : ${OUT}  ${(size / 1e6).toFixed(2)} MB`);
