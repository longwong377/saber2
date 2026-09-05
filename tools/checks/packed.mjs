/**
 * THE SINGLE-FILE BUILD, BOOTED.
 *
 * `tools/pack.mjs` writes the whole game into one HTML file with every module
 * inline as a `data:` URL, and HANDOFF §7 calls it "how this got play-tested at
 * all" — it is the artifact a player is handed and the only way to run the game
 * without a server. Nothing in the ~1450-check tree had ever opened one.
 *
 * What that hid: index.html carries an inline script that replaces `#boot`'s
 * innerHTML with "Needs a web server" when `location.protocol === 'file:'`,
 * because a browser refuses ES modules off disk. A packed page IS opened off
 * disk — that is its whole purpose — so the notice fired on every single-file
 * build, and it does not merely say the wrong thing: it destroys `#boot-fill`
 * and `#boot-msg` on the way past, `Menu.progress` reads `.style` of a null,
 * and the boot sequence dies before `hideBoot()`. Measured before the fix, in
 * this browser, at `file:///…/borz.html`: 79 modules evaluated, `window.SABER`
 * present, nothing fetched off the page, and a title screen reading "THIS BUILD
 * DID NOT LOAD" behind `TypeError: Cannot read properties of null (reading
 * 'style') at Menu.progress`.
 *
 * The packer had even rewritten the WORDS of that notice — which is why the
 * fault read as handled to anyone reading pack.mjs — while leaving the
 * condition that fires it. A replacement whose pattern lands and whose
 * CONSEQUENCE is wrong is invisible to every check that reads source.
 *
 * So this one does the only thing that could have caught it: pack the tree as
 * it stands and open the result the way a player does.
 */
/* `playwright-core` IS IMPORTED IN THE BODY, not here, and that is not a style
 * preference — it is what the other five browser-driving suites already do
 * (`frontdoor`, `lighting`, `lineseen`, `front-screen`, and every `tools/_*`
 * shot tool), and this file was the one that did not.
 *
 * A static import makes the MODULE unloadable on a machine with no browser
 * package, and `determinism.mjs`'s "every suite file in tools/checks/ exports a
 * run()" imports every file to ask that question — so one absent dependency
 * failed a structural check about a completely unrelated property, on a tree
 * where nothing was wrong. A suite that cannot RUN here should fail when it is
 * run, not when it is looked at. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromiumPath, CHROME_ARGS } from './_browser.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

export async function run({ check, assert }) {
  check('packed: every module names three by the path a browser can follow', async () => {
    /**
     * ══ THE ONE-WORD BUG THAT IS INVISIBLE TO EVERY OTHER CHECK ═══════════
     *
     * `import * as THREE from 'three'` works perfectly in `verify.mjs`.
     * `tools/register.mjs` maps the bare specifier onto `vendor/three`, so a
     * module that writes it loads, links and passes its whole suite. It is also
     * **broken in every browser and in every packed build**: the page has no
     * import map for it, so the module fails to resolve, the page throws
     * `Failed to resolve module specifier "three"` before `main.js` ever runs,
     * and the game is a black screen.
     *
     * HANDOFF §2.1 records the mirror of this — running verify WITHOUT the
     * loader resolves `three` out of `node_modules` and reports two fictional
     * failures — and the lesson is the same one from the other side: the bare
     * specifier is a Node-only convenience and `src/` may never use it.
     *
     * MEASURED, and it is why this check exists: a new module written with
     * `from 'three'` booted 2 200 checks green, built its scene headless, and
     * showed nothing at all in Chromium. The suite that would eventually have
     * caught it is the one below — a full pack, launch and play, minutes long,
     * which reports "the build does not boot" and names no cause.
     *
     * 37 of 38 files in `src/game` already write the literal path. This is that
     * convention, enforced, in the place that owns what the shipped build can
     * resolve.
     */
    const { readdir, readFile } = await import('node:fs/promises');
    const dirs = ['src', 'src/game', 'src/engine', 'src/ui', 'src/world', 'src/physics', 'src/toon'];
    const bad = [];
    let files = 0, good = 0;
    for (const d of dirs) {
      let names = [];
      try { names = await readdir(join(ROOT, d)); } catch { continue; }
      for (const n of names) {
        if (!n.endsWith('.js') && !n.endsWith('.mjs')) continue;
        const rel = `${d}/${n}`;
        const src = await readFile(join(ROOT, rel), 'utf8');
        files++;
        /* Every `from '…'` in the file, and the only ones that matter are the
         * ones that are not a path: a browser resolves `./`, `../` and `/` and
         * nothing else without an import map, and this page ships none. */
        for (const m of src.matchAll(/\bfrom\s+'([^']+)'/g)) {
          const spec = m[1];
          if (spec.startsWith('.') || spec.startsWith('/')) continue;
          if (/^(node:|https?:)/.test(spec)) continue;
          bad.push(`${rel} → '${spec}'`);
        }
        if (/from '\.\.?\/[^']*three\.module\.js'/.test(src)) good++;
      }
    }
    assert(bad.length === 0,
      `${bad.length} bare module specifier(s) under src/ — every one of them loads under `
      + `tools/register.mjs and fails to resolve in a browser, which is a black screen with a `
      + `console error and no failing check: ${bad.slice(0, 6).join(', ')}`);
    assert(good > 20,
      `only ${good} of ${files} modules import three by a literal relative path — this check has `
      + 'stopped being able to see the convention it enforces');
    return `${files} modules under src/, ${good} of them naming three by path, 0 bare specifiers`;
  });

  check('packed: every file under src/ is reachable from a page somebody can open', async () => {
    /**
     * ══ THE ORPHAN QUESTION, ASKED OF THE WHOLE TREE ══════════════════════
     *
     * `tools/checks/_shipped.mjs` was written for exactly this and was then
     * called with THREE HAND-WRITTEN FILENAMES. A list of the orphans somebody
     * already found cannot find the next one, and there was a next one:
     * `src/game/Starfury.js` — 325 lines, `SHARK.md` §4's *"the one new
     * system"*, 264 lines of green check over it — with a single importer in
     * the entire tree, which was its own check. 96 of the 97 `src/game/*.js`
     * files were in the packed manifest and that was the one that was not.
     *
     * WHY A CHECK COULD NOT SEE IT. Every suite reaches its module with
     * `await import`, which is a statement about the file system. `pack.mjs`
     * walks the module graph from `index.play.html`'s entry, so a module
     * nothing on that graph imports is simply absent from the manifest: green,
     * finished, commented, and in nobody's browser. Green over an orphan is
     * worse than red, because nobody investigates green.
     *
     * SO THE BAR IS A PAGE AND NOT A CHECK. `unshipped()` walks every `*.html`
     * in the repository, not just the shipped one, because two of them are
     * shading labs and the three files under `src/toon/` are theirs — that is
     * unshipped and it is not dead, and a bar that could not tell those apart
     * would either fail on work that is exactly where it belongs or pass on
     * work nobody can run. What is asserted is the third bucket: a file no
     * page in the repository reaches by any path.
     *
     * It names the files. A count is unactionable and this is a defect whose
     * whole difficulty is finding out WHICH file.
     */
    const { unshipped } = await import('./_shipped.mjs');
    const { shipped, lab, dead } = await unshipped();
    assert(shipped.length > 100,
      `only ${shipped.length} modules reachable from the shipped entry — this check is measuring nothing`);
    assert(dead.length === 0,
      `${dead.length} module(s) under src/ are in NO page's import graph — not the game, not a lab, `
      + 'nothing: no player and no developer can reach a line of them, however green their own '
      + `suite is. ${dead.join(', ')}`);
    const labs = lab.map((l) => `${l.file} (${l.pages.join('+')})`).join(', ');
    return `${shipped.length} shipped, ${lab.length} lab-only [${labs}], 0 unreachable`;
  });

  /**
   * BOTH BUILDS, because only one of them was ever driven and the other is the
   * one people are handed.
   *
   * `--min` is what fits the hosted play link under its 16 MB cap, and it was
   * shipped broken: it booted, showed the menu, drew the front screen, threw no
   * page error — and every deploy died with "handed an option it does not read
   * — mat. It reads: ." `Props.assertOpts` derives a builder's legal options by
   * reading the builder's own SOURCE with `fn.toString()`, so an identifier
   * rename empties the set and the guard refuses everything the builder
   * honours. Nothing short of pressing Ignite could have found it, and this
   * check pressed Ignite only on the build that was fine.
   *
   * So the arms are the two commands a person actually runs.
   */
  for (const [arm, FLAGS] of [['plain', []], ['--min', ['--min']]])
  check(`packed: the ${arm} single-file build boots from a bare file:// URL and can be played`, async () => {
    const exe = chromiumPath();
    const dir = mkdtempSync(join(tmpdir(), 'borzpack-'));
    const out = join(dir, 'borz.html');
    try {
      /* The packer is run as the player's own command rather than imported,
       * because its failure modes include throwing on a substitution that no
       * longer matches — and a check that imported it would have to reproduce
       * argv to reach the same code. */
      const packed = spawnSync(process.execPath, [`${ROOT}/tools/pack.mjs`, out, ...FLAGS], { encoding: 'utf8' });
      assert(packed.status === 0,
        `node tools/pack.mjs ${FLAGS.join(' ')} exited ${packed.status}: `
        + `${(packed.stderr || '').trim().slice(0, 400)}`);
      const size = statSync(out).size;
      assert(size > 2e6, `the packed page is ${(size / 1e6).toFixed(2)} MB — that is not the whole game`);

      const { chromium } = await import('playwright-core');
      const browser = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        /* SwiftShader renders this at about a frame a second, so every wait
         * here is counted in FRAMES. A wall-clock timeout on this box measures
         * the box (HANDOFF §2.6). */
        page.setDefaultTimeout(300000);
        const errs = [], offpage = [];
        page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
        /**
         * EVERY REQUEST THAT IS NOT THE PAGE ITSELF, and `file://` used to be
         * on the free list.
         *
         * That exemption is how nine missing images survived in the shipped
         * packer: the boot plate, the wordmark and all seven theatre
         * screenshots were fetched as `file:///tmp/assets/…`, 404ed, and were
         * waved through here because they were not "off-page" by this test's
         * own definition. The build's promise is that NOTHING is fetched, so
         * the only address allowed is the page's own.
         */
        const self = `file://${out}`;
        page.on('request', (r) => {
          const u = r.url();
          if (u.startsWith('data:') || u.startsWith('blob:') || u === self) return;
          offpage.push(u.slice(0, 120));
        });
        await page.goto(`file://${out}`, { waitUntil: 'load' });
        const state = await page.evaluate(async () => {
          const tick = () => new Promise((r) => requestAnimationFrame(r));
          const shown = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            /* `offsetParent` is null for a `position: fixed` element whatever
             * its state, and `.screen` is fixed — asking it would have made
             * this check fail on a page that boots. The box is the question. */
            return getComputedStyle(el).display !== 'none' && r.width > 100 && r.height > 100;
          };
          let f = 0;
          for (let i = 0; i < 120; i++) {
            await tick(); f++;
            const menu = document.querySelector('#menu');
            if (shown(menu)) {
              return { frames: f, up: true, bootHidden: !!document.querySelector('#boot.hidden'),
                bootBar: !!document.querySelector('#boot-fill'), saber: !!window.SABER,
                tabs: document.querySelectorAll('.menu-tabs .tab').length,
                rect: [Math.round(menu.getBoundingClientRect().width),
                  Math.round(menu.getBoundingClientRect().height)] };
            }
          }
          return { frames: f, up: false, saber: !!window.SABER,
            bootBar: !!document.querySelector('#boot-fill'),
            said: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) };
        });

        assert(errs.length === 0, `the packed page threw: ${errs.join(' · ')}`);
        assert(state.saber, 'the packed page evaluated no modules — window.SABER is absent');
        assert(state.bootBar,
          'the boot bar is gone from the packed page before the game could drive it — '
          + `something rewrote #boot. The page says: "${state.said || ''}"`);
        assert(state.up,
          `the packed page never reached the menu in ${state.frames} frames. It says: "${state.said || ''}"`);
        assert(state.tabs >= 7,
          `the front screen came up with ${state.tabs} tabs — the two built at runtime are missing`);
        assert(offpage.length === 0,
          `a page whose whole promise is that nothing is fetched asked for ${[...new Set(offpage)].join(', ')}`);
        /**
         * AND IT CAN BE DEPLOYED INTO, which is the half a boot check does not
         * cover and the half the player is actually here for. The whole point
         * of the packed build is that it is the artifact somebody plays; a
         * title screen that comes up over a game that cannot start is the same
         * failure one screen later.
         *
         * Everything is counted in FRAMES. SwiftShader renders this at about a
         * frame a second under load and a wall-clock budget would be measuring
         * the box (HANDOFF §2.6) — a frame count is the same number on a quiet
         * box and a loaded one. Measured when this was written: menu at frame
         * 17, a live world one frame after the click, 2.2 s of game time in the
         * 60 frames after that, 747 draw calls on the Ember Shelf.
         */
        const play = await page.evaluate(async () => {
          const tick = () => new Promise((r) => requestAnimationFrame(r));
          const btn = document.querySelector('#btn-deploy');
          if (!btn) return { fail: 'there is no #btn-deploy on the packed front screen' };
          btn.click();
          let f = 0;
          for (let i = 0; i < 400; i++) { await tick(); f++; if (window.SABER?.world) break; }
          const w = window.SABER?.world;
          if (!w) return { fail: `no world ${f} frames after the deploy click` };
          /* Thirty frames, not sixty. Under SwiftShader a frame of a dressed
           * level is the most expensive thing in the gate, and the question —
           * is the clock running and is the level being drawn — is answered by
           * the first handful. Sixty cost three minutes and bought nothing. */
          const t0 = w.time;
          for (let i = 0; i < 30; i++) { await tick(); f++; }
          return { frames: f, advanced: +(w.time - t0).toFixed(3), level: w.levelKey ?? null,
            enemies: w.enemies.length, hp: w.player?.hp ?? null,
            draws: window.SABER.engine?.renderer?.info?.render?.calls ?? 0 };
        });
        assert(!play.fail, `${play.fail} — the packed page opens and cannot be played`);
        assert(play.advanced > 0.2,
          `the packed world advanced ${play.advanced} s over 30 frames — it is built but not running`);
        assert(play.draws > 50,
          `${play.draws} draw calls in the deployed frame — the packed page is not drawing a level`);
        assert(errs.length === 0, `the packed page threw during play: ${errs.join(' · ')}`);
        return `${arm}: ${(size / 1e6).toFixed(2)} MB, menu up in ${state.frames} frames at `
          + `${state.rect[0]}x${state.rect[1]} with ${state.tabs} tabs, boot bar intact, `
          + `nothing fetched off the page; deployed onto ${play.level} by frame ${play.frames} `
          + `— ${play.advanced} s of game time, ${play.enemies} enem${play.enemies === 1 ? 'y' : 'ies'}, `
          + `${play.draws} draw calls, player at ${play.hp} hp`;
      } finally { await browser.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
