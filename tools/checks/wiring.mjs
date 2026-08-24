/**
 * BATTLEFRONT BORZ — the module graph the BROWSER walks, and whether it holds.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every other suite in this directory imports the two or three modules it
 * needs and measures them. That is the right shape for a check and it has one
 * blind spot, which is total: NOTHING IMPORTS THE WHOLE GAME. A module that no
 * probe reaches can name a file that does not exist and the entire harness
 * stays green — 1139 checks, all passing, and the page is blank.
 *
 * The page is the one reader that walks all of it. `index.html` pulls
 * `src/main.js`, the browser follows every static specifier from there, and it
 * stops at the FIRST one that 404s with nothing rendered and one line in a
 * console the player does not have open. There is no partial failure and no
 * degraded mode; a single bad specifier is the whole game.
 *
 * This branch has renamed modules twice — `Constellation.js` → `LivingForce.js`
 * being the larger one, 107 mentions across 14 files — and both times the risk
 * was the same: a rename that misses one import site. §2.3 of HANDOFF.md is the
 * general form of it (a hand-maintained list beside a generated twin), and an
 * import graph is exactly that shape: the list of names is maintained by hand,
 * in seventy-six separate files, and the twin is the filesystem.
 *
 * ── WHAT IT READS, AND WHY IT READS RATHER THAN IMPORTS ───────────────────
 *
 * It resolves specifiers off disk instead of importing them, for three
 * reasons. Importing `src/main.js` would run the game's top-level side effects
 * under node, which is what `tools/dom-shim.mjs` exists to survive and is a
 * far larger surface than this needs. Importing would also stop at the first
 * failure, and the useful report is ALL the broken specifiers at once. And a
 * module that throws for an unrelated reason would be indistinguishable here
 * from one that is missing, which is the opposite of a diagnosis.
 *
 * It follows three kinds of specifier, because the browser follows three:
 * `import … from 'x'`, bare `import 'x'` for side effects, and literal
 * `import('x')`. A COMPUTED dynamic import — `import(base + name)` — cannot be
 * resolved statically by anything, including this, and the count of them is
 * reported rather than hidden, because that count is the exact size of what
 * this suite does not cover.
 *
 * Bare specifiers resolve through the import map in `index.html`. That map is
 * why `three` works in the browser at all, and §2.1 of HANDOFF.md is what
 * happens when the map and node's resolution disagree about which copy of it
 * is loaded — so the map is read from the page rather than assumed.
 */
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const rel = (p) => relative(ROOT, p);
const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

/**
 * Every specifier a source file names, by the three forms the browser follows.
 *
 * Deliberately regex and not a parser: a parser would need the dependency this
 * repo does not have, and the failure mode of a regex here is a FALSE POSITIVE
 * (a specifier found inside a string or a comment), which shows up as a loud
 * unresolved path rather than a quiet miss. The one form it cannot see is the
 * computed dynamic import, which is counted separately and reported.
 */
function specifiersIn(src) {
  const out = [];
  for (const m of src.matchAll(/(?:^|[\s;}])(?:import|export)\s[^;'"()]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/** Dynamic imports whose target is built at runtime — the uncoverable residue. */
function computedImports(src) {
  return [...src.matchAll(/\bimport\s*\(\s*(?!['"])[^)]{1,80}\)/g)].map((m) => m[0]);
}

/** Walk from the page's entry scripts the way the browser does. */
async function graph() {
  const html = await readFile(`${ROOT}/index.html`, 'utf8');

  const mapText = (html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/) || [])[1];
  const map = mapText ? (JSON.parse(mapText).imports ?? {}) : {};

  // A stylesheet href can be a data: URI (the inline favicon is one), and a
  // data: URI is not a file. Only real paths are claims about the disk.
  const isPath = (s) => !/^(https?:|data:|#|mailto:)/.test(s);
  const entries = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]).filter(isPath);
  const assets = [...html.matchAll(/<link[^>]*\bhref=["']([^"']+)["']/g)].map((m) => m[1]).filter(isPath);

  const seen = new Set(), missing = [], bare = [];
  let computed = 0;

  async function walk(file, from) {
    if (seen.has(file)) return;
    seen.add(file);
    if (!await exists(file)) { missing.push({ spec: rel(file), from: rel(from) }); return; }
    if (!/\.m?js$/.test(file)) return;
    const src = await readFile(file, 'utf8');
    computed += computedImports(src).length;
    for (const spec of specifiersIn(src)) {
      if (/^(https?|node):/.test(spec)) continue;
      let target = null;
      if (spec.startsWith('.') || spec.startsWith('/')) target = resolve(dirname(file), spec);
      else if (map[spec]) target = resolve(ROOT, map[spec]);
      else {
        const prefix = Object.keys(map).find((k) => k.endsWith('/') && spec.startsWith(k));
        if (prefix) target = resolve(ROOT, map[prefix] + spec.slice(prefix.length));
      }
      if (!target) { bare.push({ spec, from: rel(file) }); continue; }
      await walk(target, file);
    }
  }

  for (const e of entries) await walk(resolve(ROOT, e), `${ROOT}/index.html`);
  for (const a of assets) {
    const p = resolve(ROOT, a);
    if (!await exists(p)) missing.push({ spec: rel(p), from: 'index.html' });
  }
  return { entries, assets, modules: seen.size, missing, bare, computed, map };
}

export async function run({ check, assert }) {
  const g = await graph();

  check('wiring: every specifier the page follows resolves to a file', () => {
    /**
     * The whole suite in one assertion. A rename that misses an import site
     * lands here and nowhere else, because no other check imports enough of
     * the game to notice, and the browser's own report of it is a blank page.
     */
    assert(g.entries.length > 0, 'index.html names no entry script — the page loads nothing at all');
    assert(g.modules > 50,
      `only ${g.modules} modules reachable from ${g.entries.join(', ')} — the walk stopped early, `
      + 'which means this suite is measuring a fraction of the graph and reporting it as the whole');
    assert(g.missing.length === 0,
      `${g.missing.length} specifier(s) name a file that is not there — the page stops dead at the `
      + `first one:\n${g.missing.map((m) => `      ${m.spec}  ← imported by ${m.from}`).join('\n')}`);
    return `${g.modules} modules from ${g.entries.join(', ')}, every specifier resolved`;
  });

  check('wiring: no bare specifier the import map cannot answer', () => {
    /**
     * A bare specifier works under node whenever node_modules happens to hold
     * it, and fails in the browser unless the import map names it. That gap is
     * how two copies of three came to be loadable at once (§2.1), so the map
     * is the authority here and node's resolution is not consulted.
     */
    assert(Object.keys(g.map).length > 0,
      'index.html has no import map — every bare specifier in the game is then a browser 404');
    assert(g.bare.length === 0,
      `${g.bare.length} bare specifier(s) with no import-map entry, each of which resolves under node `
      + `and 404s in the browser:\n${g.bare.map((b) => `      ${b.spec}  ← ${b.from}`).join('\n')}`);
    return `import map answers all bare specifiers (${Object.keys(g.map).join(', ')})`;
  });

  check('wiring: the page\'s own assets are on disk', () => {
    assert(g.assets.length > 0, 'index.html links no stylesheet — the game renders unstyled');
    return `${g.assets.length} linked asset(s) present: ${g.assets.join(', ')}`;
  });

  check('wiring: what this suite cannot see is counted, not hidden', () => {
    /**
     * A computed `import(expr)` is unresolvable by construction. Reporting the
     * number is the point: it is the exact size of the uncovered residue, and a
     * silent zero here would be the same lie as a hand-maintained list that has
     * drifted from its twin.
     *
     * AND IT IS ASSERTED, NOT ONLY PRINTED. This check had no assertion in it
     * at all — it could not fail under any change to the game, which made it a
     * report line occupying a slot in the count and a slot in the gate. The
     * number is zero today: every specifier in the tree is a literal, so the
     * walk above genuinely covers the whole graph, and the sibling check's
     * "every module resolves" means what it says. The first computed import
     * added is a hole in that coverage and has to be an explicit decision —
     * this is what makes somebody make it.
     */
    assert(g.computed === 0,
      `${g.computed} computed dynamic import(s) are outside this walk by construction, so `
      + '"every specifier resolves" no longer covers the whole graph. If one is genuinely needed, '
      + 'raise this ceiling deliberately and say here what is behind it');
    return 'no computed dynamic imports — the static walk covers the whole graph';
  });
}
