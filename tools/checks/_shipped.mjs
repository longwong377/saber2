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
 * ── SO THIS ASKS THE SHIPPING QUESTION INSTEAD ────────────────────────────
 *
 * It walks the SAME graph `pack.mjs` walks, from the SAME entry, with the same
 * three specifier patterns — a copy of the walker would be a second opinion
 * about what ships, which is the defect this repo names most often. What it
 * hands back is the set of files a player's browser actually receives, and
 * who imports what, so a check can name the importer it lost.
 */

import { readFile, stat } from 'node:fs/promises';
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
  const html = await readFile(`${ROOT}/index.play.html`, 'utf8');
  const mapText = (html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/) || [])[1];
  const vendorMap = mapText ? (JSON.parse(mapText).imports ?? {}) : {};

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
  const entryFile = resolve(ROOT, (html.match(/<script[^>]*\bsrc=["']([^"']+)["']/) || [])[1]);

  const walk = async (file) => {
    const key = relative(ROOT, file);
    if (seen.has(key)) return;
    if (!await exists(file)) return;          // a missing module is pack.mjs's error to raise
    seen.add(key);
    const raw = await readFile(file, 'utf8');
    const deps = new Set();
    for (const p of PATS) {
      p.lastIndex = 0;
      let m;
      while ((m = p.exec(raw))) { const t = resolveSpec(m[3], file); if (t) deps.add(t); }
    }
    for (const d of deps) {
      const dk = relative(ROOT, d);
      if (!importers.has(dk)) importers.set(dk, []);
      importers.get(dk).push(key);
    }
    for (const d of deps) await walk(d);
  };
  await walk(entryFile);
  _graph = { files: seen, importers, entry: relative(ROOT, entryFile) };
  return _graph;
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
