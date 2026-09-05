/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT IS ACTUALLY IN THE BUILD — the module graph, walked as pack.mjs walks
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────────
 *
 * `src/game/Games.js` — 21 KB of sabacc, the Dejarik Column and the Drum —
 * was finished, commented and 4/4 GREEN, and it was in no shipped build. So
 * was `src/game/Quests.js`, 3/3 green. Both suites reach their module with a
 * direct `import()`, which is a statement about the file system and not about
 * the game: `tools/pack.mjs` walks the module graph from `index.play.html`'s
 * entry script, and a module nothing on that graph imports is simply absent
 * from the manifest. Ninety-six `src/game/*.js` files were in the packed
 * build and those two were not.
 *
 * A CHECK THAT IMPORTS A MODULE CANNOT NOTICE THIS. That is the whole point.
 * Green over an orphan is worse than red, because nobody investigates green.
 *
 * ── AND IT DID NOT GENERALISE, WHICH IS WHY IT HAPPENED AGAIN ─────────────
 *
 * The first cut of this file exported one assertion and it was called with
 * THREE HAND-WRITTEN FILENAMES — `Games.js`, `Quests.js`, `Keepsakes.js`. A
 * list of the orphans somebody had already found cannot find the next one, and
 * a hostile pass found it in twenty seconds: `src/game/Starfury.js`, 325 lines,
 * the file `SHARK.md` §4 calls *"the one new system"*, with exactly one
 * importer in the whole tree — its own check. 96 of 97 `src/game/*.js` files
 * were in the manifest and that was the one.
 *
 * So the question is now asked of EVERY file under `src/` rather than of three
 * of them, and it is asked in the only form that can be answered honestly:
 * **which entry point reaches this module?** A repository with several pages in
 * it has several right answers — `meadow.html` and `toon.html` are shading labs
 * and the three files under `src/toon/` are theirs, which is not the same thing
 * as being dead — so `pageGraphs` walks every page and `unshipped` sorts the
 * result into "a lab page has it" and "nothing at all has it". Only the second
 * is a defect, and the check that reads this says which files they are.
 *
 * ── SO THIS ASKS THE SHIPPING QUESTION INSTEAD ────────────────────────────
 *
 * It walks the SAME graph `pack.mjs` walks, from the SAME entry, with the same
 * three specifier patterns — a copy of the walker would be a second opinion
 * about what ships, which is the defect this repo names most often. What it
 * hands back is the set of files a player's browser actually receives, and
 * who imports what, so a check can name the importer it lost.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

const ROOT = resolve(new URL('../../', import.meta.url).pathname);
const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

/** `pack.mjs`'s three specifier patterns, verbatim — static, bare, dynamic. */
const PATS = [
  /((?:^|[\s;}])(?:import|export)\s[^;'"()]*?from\s*)(['"])([^'"]+)\2/g,
  /((?:^|[\s;}])import\s*)(['"])([^'"]+)\2/g,
  /(\bimport\s*\(\s*)(['"])([^'"]+)\2/g,
];

let _graph = null;
let _pages = null;
let _tree = null;

/** Every specifier in a blob of text, by `pack.mjs`'s three patterns. */
function specifiersIn(raw) {
  const out = [];
  for (const p of PATS) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(raw))) out.push(m[3]);
  }
  return out;
}

/**
 * ══ ONE WALKER, AND EVERY GRAPH IN THIS FILE COMES OUT OF IT ══════════════
 *
 * Parameterised over the entry and the page's own import map rather than
 * copied per caller: a second walker is a second opinion about what ships,
 * which is the defect class this whole file exists for.
 *
 * @param entries  absolute paths to start from — a page can have several
 * @param vendorMap the page's importmap `imports`, for bare specifiers
 */
async function graphFrom(entries, vendorMap = {}) {
  const resolveSpec = (spec, fromFile) => {
    if (/^(https?|node|data):/.test(spec)) return null;
    if (spec.startsWith('.') || spec.startsWith('/')) return resolve(dirname(fromFile), spec);
    if (vendorMap[spec]) return resolve(ROOT, vendorMap[spec]);
    const prefix = Object.keys(vendorMap).find((k) => k.endsWith('/') && spec.startsWith(k));
    if (prefix) return resolve(ROOT, vendorMap[prefix] + spec.slice(prefix.length));
    return null;
  };
  const seen = new Set();
  const importers = new Map();
  const walk = async (file) => {
    const key = relative(ROOT, file);
    if (seen.has(key)) return;
    if (!await exists(file)) return;          // a missing module is pack.mjs's error to raise
    seen.add(key);
    const raw = await readFile(file, 'utf8');
    const deps = new Set();
    for (const spec of specifiersIn(raw)) { const t = resolveSpec(spec, file); if (t) deps.add(t); }
    for (const d of deps) {
      const dk = relative(ROOT, d);
      if (!importers.has(dk)) importers.set(dk, []);
      importers.get(dk).push(key);
    }
    for (const d of deps) await walk(d);
  };
  for (const e of entries) await walk(e);
  return { files: seen, importers };
}

/** A page's import map and its module entries — `<script src>` plus whatever
 *  an inline `<script type="module">` imports, which is how both labs boot. */
async function entriesOf(page) {
  const html = await readFile(`${ROOT}/${page}`, 'utf8');
  const mapText = (html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/) || [])[1];
  let vendorMap = {};
  try { vendorMap = mapText ? (JSON.parse(mapText).imports ?? {}) : {}; } catch { vendorMap = {}; }
  const entries = new Set();
  for (const m of html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) {
    if (!/^(https?|data):/.test(m[1])) entries.add(resolve(ROOT, m[1]));
  }
  /* The inline half. A lab page's whole entry is `import {X} from './src/…'`
   * inside its own `<script type="module">`, and a scan that only read `src=`
   * would call every file under `src/toon/` dead. Resolved against the ROOT
   * because that is where the document is. */
  for (const spec of specifiersIn(html)) {
    if (spec.startsWith('.') || spec.startsWith('/')) entries.add(resolve(ROOT, spec));
  }
  return { entries: [...entries], vendorMap };
}

/**
 * Every module the packed build contains, and who imports each.
 *
 * Returns `{ files, importers, entry }`:
 *   files      a Set of repo-relative paths, e.g. 'src/game/Games.js'
 *   importers  path -> array of the paths that import it
 *   entry      the entry the walk started from
 *
 * Cached: the walk reads about two hundred files and four suites ask for it.
 */
export async function shippedGraph() {
  if (_graph) return _graph;
  const { entries, vendorMap } = await entriesOf('index.play.html');
  const g = await graphFrom(entries, vendorMap);
  _graph = { ...g, entry: relative(ROOT, entries[0]) };
  return _graph;
}

/**
 * Every `*.html` in the repo root that boots a module, and what each reaches.
 *
 * `index.html` boots nothing (it is a stood-down notice) and `borz-play.html`
 * is a packed single-file build whose importmap is all `data:` URIs, so both
 * fall out of this with an empty graph rather than needing to be named. What
 * is left is the shipped page and the two shading labs.
 */
export async function pageGraphs() {
  if (_pages) return _pages;
  const names = (await readdir(ROOT)).filter((f) => f.endsWith('.html')).sort();
  const out = new Map();
  for (const page of names) {
    const { entries, vendorMap } = await entriesOf(page);
    if (!entries.length) continue;
    const g = await graphFrom(entries, vendorMap);
    if (g.files.size) out.set(page, g);
  }
  _pages = out;
  return out;
}

/** Every `.js` under `src/`, as repo-relative paths. */
export async function sourceTree() {
  if (_tree) return _tree;
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(`${ROOT}/${dir}`, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  await walk('src');
  _tree = out.sort();
  return _tree;
}

/**
 * ══ THE SHIPPING QUESTION, ASKED OF EVERY FILE UNDER `src/` ═══════════════
 *
 * Returns `{ shipped, lab, dead }`, all repo-relative paths:
 *
 *   shipped  in the packed build — a player's browser receives it
 *   lab      not in the build, but some other page in the repo boots it.
 *            `[{ file, pages }]`, so a report can name the page. Not a defect:
 *            `src/toon/` is `meadow.html` and `toon.html`, which is what those
 *            pages are FOR.
 *   dead     no page in the repository reaches it at all. Either it is dead
 *            code or it is finished work nobody can run, and the two look
 *            identical from here — which is exactly why the answer has to be
 *            a filename and not a count.
 *
 * The question is deliberately about PAGES and not about checks: `tools/`
 * reaches everything by `await import`, so a graph that counted the gate would
 * report every file as reachable and this file would be a no-op.
 */
export async function unshipped() {
  const build = await shippedGraph();
  const pages = await pageGraphs();
  const files = await sourceTree();
  const shipped = [], lab = [], dead = [];
  for (const f of files) {
    if (build.files.has(f)) { shipped.push(f); continue; }
    const by = [...pages].filter(([, g]) => g.files.has(f)).map(([p]) => p);
    if (by.length) lab.push({ file: f, pages: by });
    else dead.push(f);
  }
  return { shipped, lab, dead };
}

/**
 * Assert that `path` is in the build, and say who put it there.
 *
 * The message is the important half: "nothing under src/ imports it" is the
 * exact sentence the audit wrote about these two files, and a check that fails
 * with it tells the next person what to do about it.
 */
export async function assertShipped(assert, path, why) {
  const { files, importers, entry } = await shippedGraph();
  const by = importers.get(path) || [];
  assert(files.has(path),
    `${path} is NOT in the shipped build — ${why}\n      `
    + `nothing reachable from ${entry} imports it, so tools/pack.mjs will not put it in the manifest `
    + 'and no player can reach it, however green its own suite is');
  assert(by.length > 0, `${path} is in the graph with no importer, which cannot happen`);
  return by;
}
