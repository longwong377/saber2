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
  check('packed: the single-file build boots from a bare file:// URL and can be played', async () => {
    const exe = chromiumPath();
    const dir = mkdtempSync(join(tmpdir(), 'borzpack-'));
    const out = join(dir, 'borz.html');
    try {
      /* The packer is run as the player's own command rather than imported,
       * because its failure modes include throwing on a substitution that no
       * longer matches — and a check that imported it would have to reproduce
       * argv to reach the same code. */
      const packed = spawnSync(process.execPath, [`${ROOT}/tools/pack.mjs`, out], { encoding: 'utf8' });
      assert(packed.status === 0,
        `node tools/pack.mjs exited ${packed.status}: ${(packed.stderr || '').trim().slice(0, 400)}`);
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
        page.on('request', (r) => {
          const u = r.url();
          if (!u.startsWith('data:') && !u.startsWith('file://') && !u.startsWith('blob:')) offpage.push(u.slice(0, 120));
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
        return `${(size / 1e6).toFixed(2)} MB, menu up in ${state.frames} frames at `
          + `${state.rect[0]}x${state.rect[1]} with ${state.tabs} tabs, boot bar intact, `
          + `nothing fetched off the page; deployed onto ${play.level} by frame ${play.frames} `
          + `— ${play.advanced} s of game time, ${play.enemies} enem${play.enemies === 1 ? 'y' : 'ies'}, `
          + `${play.draws} draw calls, player at ${play.hp} hp`;
      } finally { await browser.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
