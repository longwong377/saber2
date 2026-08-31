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
    /**
     * THE MAP IS GONE AND THE RULE SURVIVES IT, INVERTED.
     *
     * This asserted that index.html HAD an import map and that every bare
     * specifier was in it. Both halves were right while the game had one — and
     * the map turned out to be the whole browser floor: import maps are Chrome
     * 89, Firefox 108 and Safari 16.4, against a game that otherwise runs on
     * engines years older, and a player met it as "A file the game needs did
     * not load", because a resolve failure fires the same event a 404 does.
     *
     * `src/` and the vendored addons name their files by relative path now, so
     * the honest form of the same rule is that NOTHING the browser loads needs
     * a map at all. That is the check below this one; what stays here is the
     * half that is still this check's own: no specifier may be left unresolved.
     */
    assert(g.bare.length === 0,
      `${g.bare.length} bare specifier(s) in the graph, each of which resolves under node and needs `
      + `an import map in the browser — Chrome 89 / Firefox 108 / Safari 16.4:\n`
      + `${g.bare.map((b) => `      ${b.spec}  ← ${b.from}`).join('\n')}`);
    return `every specifier in the graph is a path the browser can follow with no map (${g.files ?? '?'} files)`;
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

  check('nothing the browser loads names a bare module specifier', async () => {
    /**
     * THE IMPORT MAP WAS THE WHOLE BROWSER FLOOR, and nothing said so.
     *
     * A player: "on my current browser it says… A file the game needs did not
     * load… but works fine on other browsers." It was not a file that failed to
     * load. For a `<script type="module">`, a RESOLVE failure anywhere in the
     * graph fires `error` on the element exactly as a 404 does — and
     * `import … from 'three'` resolves to nothing without an import map.
     *
     * Import maps are Chrome 89, FIREFOX 108 and SAFARI 16.4. Everything else
     * the game uses is years older, so one tag in the head decided which
     * browsers could run it, and the failure it produced was indistinguishable
     * from a missing file.
     *
     * `src/` and the vendored addons name their files by relative path now and
     * the tag is gone. This is what keeps it gone: a bare specifier
     * reintroduced later would work in a new browser and fail in an old one,
     * which is precisely how it went unnoticed for as long as it did.
     *
     * `tools/` is exempt and deliberately so — those run in node under
     * `register.mjs`, which maps `three` on purpose, and they never touch the
     * page.
     */
    const { readdir, readFile } = await import('node:fs/promises');
    const root = new URL('../../', import.meta.url);
    const files = [];
    const walk = async (dir) => {
      for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = `${dir}${e.name}`;
        if (e.isDirectory()) await walk(`${p}/`);
        else if (e.name.endsWith('.js')) files.push(p);
      }
    };
    await walk('src/');
    await walk('vendor/');
    /* A specifier is bare when it starts with neither a dot nor a slash nor a
     * scheme — the same test the loader applies. */
    const BARE = /(?:^|[\s;}(])(?:import|export)\s*(?:[^;'"()]*?\sfrom\s*)?(['"])([^'".\/][^'"]*)\1/g;
    const DYN = /\bimport\s*\(\s*(['"])([^'".\/][^'"]*)\1/g;
    const offenders = [];
    for (const f of files) {
      const src = await readFile(new URL(f, root), 'utf8');
      for (const re of [BARE, DYN]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
          if (/^(https?|node|data):/.test(m[2])) continue;
          offenders.push(`${f} names '${m[2]}'`);
        }
      }
    }
    assert(!offenders.length,
      `${offenders.length} bare specifier(s) in what the browser loads — each one needs an import `
      + `map, which is Chrome 89 / Firefox 108 / Safari 16.4:\n  ${offenders.slice(0, 10).join('\n  ')}`);
    /* …and the page must not carry a map either, or the next bare specifier is
     * invisible again in every browser that has one. */
    const html = await readFile(new URL('index.html', root), 'utf8');
    assert(!/<script[^>]*type=["']importmap["']/.test(html),
      'index.html carries an import map again — a bare specifier would then work in a new browser '
      + 'and fail in an old one, which is how this was missed the first time');
    return `${files.length} files the browser loads, no bare specifiers, no import map`;
  });

  check('no file the browser loads is named like something a content blocker eats', async () => {
    /**
     * THE GAME WAS UNPLAYABLE ON ONE PLAYER'S BROWSER BECAUSE OF A FILENAME.
     *
     * `src/engine/Fullscreen.js` shipped with the fullscreen feature and that
     * browser's content blocker — filter lists match URL substrings, and
     * "fullscreen" sits beside "popup" and "overlay" in the annoyance lists —
     * refused the request outright. One refused file takes the whole module
     * graph down, so the game worked in every other browser and died on that
     * one at "forging blade", from the day the file was added. The boot
     * doctor's verdict named it: "failed outright (Failed to fetch) —
     * something is blocking it before it reaches the site."
     *
     * A content blocker is part of the environment the game ships into, the
     * same as a small screen or an old GPU. So no file the BROWSER loads may
     * carry a name that reads as ad-tech or annoyance-tech. The list is the
     * words generic filter lists actually match, not every word that could
     * offend one; `tools/` is exempt because nothing in it crosses the wire.
     */
    const { readdir } = await import('node:fs/promises');
    const root = new URL('../../', import.meta.url);
    const BAIT = /(^|[-._])(ads?|advert\w*|banner|pop-?up|pop-?under|track(er|ing)?|analytics|telemetry|beacon|sponsor\w*|promo\w*|interstitial|overlay|fullscreen|adblock)([-._]|$)/i;
    const offenders = [];
    const walk = async (dir) => {
      for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = `${dir}${e.name}`;
        if (e.isDirectory()) { if (BAIT.test(e.name)) offenders.push(p + '/'); await walk(`${p}/`); }
        else if (BAIT.test(e.name.replace(/\.[a-z0-9]+$/i, ''))) offenders.push(p);
      }
    };
    await walk('src/');
    await walk('vendor/');
    await walk('assets/');
    assert(!offenders.length,
      `${offenders.length} file(s) named like blocker bait — a filter list will eat the request and `
      + `one refused module kills the whole boot: ${offenders.join(', ')}`);
    return 'every file the browser loads has a name no filter list matches';
  });
}
