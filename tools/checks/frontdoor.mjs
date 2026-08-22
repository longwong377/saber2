/**
 * BATTLEFIELD BORZ — THE PAGE THE PLAYER ACTUALLY OPENS.
 *
 * ── WHY THIS EXISTS BESIDE `packed.mjs` ─────────────────────────────────
 *
 * `packed.mjs` boots the single-file build and deploys into it, and it is the
 * check that has caught the packer rewriting the game underneath itself. What
 * it cannot see is the SHIPPED TREE: the live link is GitHub Pages serving
 * `index.html` and `src/` and `assets/` exactly as they are in the repository,
 * and that is the artefact the player is holding when they write the notes in
 * `PLAYTEST.md`.
 *
 * The difference is not academic. Everything a browser needs and Node does not
 * lives in that gap: an `<img src>` that resolves, a stylesheet's `url()`, an
 * element id the HUD looks up by name, a module path with the wrong case. A
 * headless suite of 1,500 checks can be entirely green while the page shows a
 * broken image where the logo goes — and this session added three images, four
 * HUD elements and a loading screen, every one of which is invisible to a
 * check that never renders.
 *
 * ── WHAT IT ASSERTS, AND WHY EACH ONE IS HERE ───────────────────────────
 *
 *   NOTHING THREW. Console errors and page exceptions, collected from before
 *     navigation, through the menu, through a deploy, and through play. This
 *     is the one that catches an exception inside a frame, which kills the
 *     game with no message a player can report except "it froze".
 *   EVERY IMAGE THE FRONT END NAMES IS THERE. `naturalWidth > 0` per `<img>`,
 *     plus the menu plate, which is a CSS background and therefore invisible to
 *     that test — it is fetched and measured on its own. The player supplied
 *     both of those files themselves; shipping the page with either one 404ing
 *     is the worst possible way to answer that.
 *   THE HUD'S ELEMENTS EXIST BY NAME. `HUD` looks its nodes up by id and
 *     tolerates a missing one silently — a null it optional-chains past is a
 *     feature that draws nothing, which is exactly the defect that hid the
 *     enemy's Force reserve for a whole session.
 *   AND IT PLAYS. A deploy, a live world, the clock advancing, and the
 *     insertion actually running — because every match now begins in a
 *     transport leaving orbit, and a flight that throws on frame one would
 *     leave the player looking at a black screen with the level behind it.
 *
 * Everything is counted in FRAMES rather than seconds: SwiftShader renders a
 * dressed level at about a frame a second and a wall-clock budget would be
 * measuring the box rather than the game (HANDOFF §2.6).
 */

import { createServer } from 'node:http';
import { handler } from '../serve.mjs';
import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  check('front door: the shipped page boots, draws, and can be played', async () => {
    const { chromium } = await import('playwright-core');
    const { chromiumPath, CHROME_ARGS } = await import('./_browser.mjs');
    const exe = chromiumPath();

    const server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
    const errs = [], missing = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => errs.push(String(e.message || e)));
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      /* A 404 on the live link is a broken image on the player's screen, and
       * the request log is the only place a browser says so out loud. */
      page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url().split('/').pop()}`); });

      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      /**
       * THE MENU, WAITED FOR BY THE BOOT SCREEN GOING AWAY.
       *
       * The first version waited for seven tabs in the strip, which is what
       * `front-screen.mjs` waits for and is right there: it is checking the
       * MARKUP. The tabs are built by `Menu`'s constructor, long before the
       * warm-up has finished, so this clicked Deploy while the boot screen was
       * still up — and reported the game unplayable because `RapierWorld`
       * threw on a module that was still instantiating. The instrument was
       * pressing a button no player can reach.
       *
       * `#boot` carrying `hidden` is the game's own statement that it is ready
       * to be played, written one line after the warm-up loop ends.
       */
      await page.waitForFunction(
        () => document.getElementById('boot')?.classList.contains('hidden')
          && document.querySelectorAll('.menu-tabs .tab').length >= 7, null, { timeout: 180000 });

      const front = await page.evaluate(async () => {
        /* Every `<img>` the page ships, by whether the browser got pixels. */
        const imgs = [...document.querySelectorAll('img')].map((i) => ({
          src: (i.getAttribute('src') || '').split('/').pop(),
          w: i.naturalWidth, h: i.naturalHeight,
          shown: !!(i.offsetWidth || i.offsetHeight || i.getClientRects().length),
        }));
        /* THE MENU PLATE IS A CSS BACKGROUND and no `<img>` test can see it.
         * Pull the url out of the computed style and fetch it. */
        const el = document.querySelector('.menu-bg') || document.body;
        const bg = getComputedStyle(el).backgroundImage || '';
        const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
        let plate = null;
        if (m) {
          try {
            const r = await fetch(m[1]);
            const b = await r.blob();
            plate = { url: m[1].split('/').pop(), status: r.status, bytes: b.size };
          } catch (e) { plate = { url: m[1], status: -1, bytes: 0, err: String(e) }; }
        }
        /* The ids the HUD looks up by name. A null here is a feature that
         * draws nothing and says nothing. */
        const IDS = ['hud', 'bossbar', 'boss-force', 'boss-cast', 'mend-cue', 'target-open',
          'bar-support', 'troopnames', 'loading', 'menu', 'btn-deploy'];
        const absent = IDS.filter((id) => !document.getElementById(id));
        return { imgs, plate, absent, tabs: document.querySelectorAll('.menu-tabs .tab').length };
      });

      assert(errs.length === 0, `the page threw before anything was clicked: ${errs.join(' · ')}`);
      assert(front.absent.length === 0,
        `the front end names ${front.absent.length} element(s) that are not in the markup: `
        + `${front.absent.join(', ')} — the HUD looks these up by id and passes over a null in silence`);
      const broken = front.imgs.filter((i) => !i.w);
      assert(broken.length === 0,
        `${broken.length} image(s) on the shipped page have no pixels: `
        + `${broken.map((i) => i.src).join(', ')}`);
      assert(front.imgs.length >= 3,
        `${front.imgs.length} images on the page — the wordmark is drawn on the boot screen, the menu `
        + 'and the loading screen, so fewer than three means one of those lost it');
      assert(front.plate && front.plate.status === 200 && front.plate.bytes > 10000,
        `the menu plate ${front.plate ? `answered ${front.plate.status} at ${front.plate.bytes} bytes`
          : 'is not set as a background at all'} — that is the player's own painting behind every `
        + 'screen in the game');

      /* ── AND IT PLAYS. */
      const play = await page.evaluate(async () => {
        const tick = () => new Promise((r) => requestAnimationFrame(r));
        const btn = document.querySelector('#btn-deploy');
        if (!btn) return { fail: 'no #btn-deploy on the front screen' };
        btn.click();
        let f = 0;
        for (let i = 0; i < 600; i++) { await tick(); f++; if (window.SABER?.world) break; }
        const w = window.SABER?.world;
        if (!w) return { fail: `no world ${f} frames after the deploy click` };
        const t0 = w.time;
        const phases = new Set();
        for (let i = 0; i < 40; i++) {
          await tick(); f++;
          if (w.extraction?.phase) phases.add(w.extraction.phase);
        }
        return {
          frames: f, advanced: +(w.time - t0).toFixed(3), level: w.levelKey ?? null,
          enemies: w.enemies.length, hp: w.player?.hp ?? null,
          draws: window.SABER.engine?.renderer?.info?.render?.calls ?? 0,
          phases: [...phases], flying: !!w.extraction?.active,
        };
      });
      assert(!play.fail, `${play.fail} — the shipped page opens and cannot be played`);
      assert(play.advanced > 0.2,
        `the world advanced ${play.advanced} s over 40 frames — it is built but not running`);
      assert(play.draws > 50, `${play.draws} draw calls in the deployed frame — nothing is being drawn`);
      /* THE JOURNEY IS THE OPENING NOW. "Every mode/map should start like
       * this" — see `ExtractionDirector.beginInsertion`. A deploy that lands
       * the player on the ground with no flight at all is the teleport the
       * player asked us to remove, and it would show up here as no phase. */
      assert(play.phases.length > 0,
        'the deploy put the player straight on the ground — every match is supposed to begin in a '
        + 'transport, and nothing was flying in the forty frames after the click');
      assert(errs.length === 0, `the page threw during play: ${errs.join(' · ')}`);
      assert(missing.length === 0, `the page asked for ${missing.length} thing(s) it did not get: `
        + `${[...new Set(missing)].join(', ')}`);
      return `menu with ${front.tabs} tabs, ${front.imgs.length} images all with pixels, plate `
        + `${(front.plate.bytes / 1024).toFixed(0)} KB; deployed onto ${play.level} by frame `
        + `${play.frames} — ${play.advanced} s, ${play.draws} draws, ${play.enemies} bodies, `
        + `phases [${play.phases.join(', ')}]`;
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  });
}
