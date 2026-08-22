/**
 * BATTLEFRONT BORZ — THE FLAGSHIP MODE, ON A SCREEN.
 *
 * ── WHY A SECOND BROWSER SUITE ──────────────────────────────────────────
 *
 * `theline.mjs` proves nineteen things about `MODES.theline` and every one of
 * them was measured HEADLESS. `frontdoor.mjs` is the only check in the tree
 * that boots the real page, and it presses Ignite on whatever the default
 * profile has selected — which is `roguelite`, never this mode. So on the day
 * this file was written the flagship mode had 1,517 green checks behind it and
 * had never been drawn.
 *
 * That gap matters more here than it would anywhere else, because this mode's
 * content is things the player is supposed to SEE. `FLAGSHIP.md` §3 calls the
 * front "the one-way visible variable"; §12.4 prices the wrecks as the biggest
 * draw-call item on Geonosis and says "wrecks belong on the fighting line"; §13
 * argues that if the front fails to read, the name list is the fallback spine.
 * A headless check cannot see a hull under the terrain, a front dressed behind
 * the player, a nameplate on nothing, or a mode card below the fold.
 *
 * ── WHAT IS HERE AND WHAT IS DELIBERATELY NOT ───────────────────────────
 *
 * Nothing in this file re-proves a headless claim. The two checks are the two
 * questions a real browser is the only witness to:
 *
 *   1. CAN IT BE PICKED. Layout. `front-screen.mjs` already holds the mode
 *      column's behaviour — the fade, the reveal, the Ignite button being
 *      outside the scroller — and it holds it against boxes TYPED INTO THE
 *      CHECK, because `_page.mjs` is a DOM and not a layout engine and says so.
 *      "a 368 px viewport on to 788 px of content, mode cards 65-79 px tall
 *      starting 367 px down" is a hand-maintained table beside its generated
 *      twin (HANDOFF §2.3) with the twin living in Chromium. This measures the
 *      twin. It grows with the mode list — the numbers above were taken when
 *      there were six modes and there are nine — so the drift is not
 *      hypothetical.
 *
 *   2. IS IT ON THE GROUND THE CARD PROMISED, WITH THE FRONT IN FRONT OF YOU.
 *      The whole route, with a mouse: the Mode list, the seed box, Ignite, the
 *      deploy card, Drop. Then the four facts the card printed are compared
 *      against the world that was actually built, and the five marks of
 *      `Front.marchFront` are looked for on the ground — including whether a
 *      hull is standing on it or buried in it, which is the one property in
 *      this whole system that only a real heightfield and a real placement can
 *      answer.
 *
 * ── EVERY WAIT IS IN FRAMES; NO LIBRARY DEFAULT SURVIVES ────────────────
 *
 * HANDOFF §2.6. One frame through swiftshader here is seconds, and Playwright's
 * own ceilings are wall-clock: `page.screenshot` defaults to 30 s and
 * `locator.click` to 30 s, and BOTH of them killed the probe this file grew out
 * of on a game that was working perfectly — a click waits for the element to be
 * "stable" across two animation frames, which on this box is over a minute. So
 * every action carries an explicit ceiling sized in frames, and the assertions
 * are about the game rather than about how loaded the box is.
 */

import { createServer } from 'node:http';
import { handler } from '../serve.mjs';
import { clocked } from './_shared.mjs';

/** Frames, not milliseconds — with one frame priced at the §2.6 figure. */
const FRAME_MS = 15000;
const act = { timeout: FRAME_MS * 8 };

/** The sizes the front screen has ever been measured at, plus the default. */
const SIZES = [[1280, 720], [1366, 768], [1920, 1080]];

async function open(size = SIZES[0]) {
  const { chromium } = await import('playwright-core');
  const { chromiumPath, CHROME_ARGS } = await import('./_browser.mjs');
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.setDefaultTimeout(FRAME_MS * 16);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(() => {
    window.__frame = (ms = 120000) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('the render loop has stopped')), ms);
      requestAnimationFrame(() => { clearTimeout(t); res(); });
    });
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  /* The two volume sliders and nothing else: everything the checks below are
   * about is picked with a mouse, because the route IS what is under test. */
  await page.evaluate(() => localStorage.setItem('saber.settings.v2',
    JSON.stringify({ volume: 0, music: 0 })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('boot')?.classList.contains('hidden')
      && document.querySelectorAll('.menu-tabs .tab').length >= 7, null, { timeout: 600000 });
  return { page, errs, close: async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
  } };
}

export async function run({ check, assert }) {
  check = await clocked(check);

  check('lineseen.1 every mode the game offers can be brought fully into view with a mouse', async () => {
    const { page, errs, close } = await open();
    try {
      const out = [];
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate(() => window.__frame());
        const m = await page.evaluate(() => {
          const menu = window.SABER.menu;
          const list = document.getElementById('mode-list');
          const box = list.closest('.col-scroll');
          const col = box.parentElement;
          const cards = [...list.children];
          const keys = [...menu._modeCards.keys()];
          const FADE = 26;                    /* Menu.SCROLL_FADE, and styles.css */
          const rows = [];
          const was = menu.s.mode;
          for (const key of keys) {
            /* THE SHIPPED REVEAL, not a re-implementation of it: `selectMode`
             * is what a click on the card calls, and `_revealMode` inside it is
             * the thing under test (HANDOFF §2.4). */
            menu.selectMode(key);
            const card = menu._modeCards.get(key);
            const cr = card.getBoundingClientRect();
            const br = box.getBoundingClientRect();
            /* Does the mouse actually land on it? A card revealed under the
             * Ignite button's gradient is revealed and unclickable, which is
             * the defect index.html's own note measured at 0.00 hit rate. */
            let hit = 0, n = 0;
            for (let iy = 1; iy <= 3; iy++) {
              for (let ix = 1; ix <= 5; ix++) {
                n++;
                const el = document.elementFromPoint(
                  cr.left + (cr.width * ix) / 6, cr.top + (cr.height * iy) / 4);
                if (el && (el === card || card.contains(el))) hit++;
              }
            }
            rows.push({ key, name: card.querySelector('b')?.textContent ?? key,
              inBand: cr.top >= br.top - 0.5 && cr.bottom <= br.bottom - FADE + 0.5,
              top: Math.round(cr.top - br.top), bottom: Math.round(cr.bottom - br.top),
              hit: +(hit / n).toFixed(2) });
          }
          menu.selectMode(was);
          return { band: Math.round(box.clientHeight), content: Math.round(box.scrollHeight),
            more: col.classList.contains('more'), less: col.classList.contains('less'),
            gutter: box.offsetWidth - box.clientWidth, cards: cards.length, rows };
        });
        out.push({ w, h, ...m });
      }

      assert(errs.length === 0, `the front screen threw: ${errs.join(' · ')}`);
      for (const s of out) {
        const off = s.rows.filter((r) => !r.inBand);
        assert(off.length === 0,
          `${s.w}x${s.h}: choosing ${off.map((r) => r.name).join(', ')} leaves the card `
          + `outside the ${s.band} px column (${off.map((r) => `${r.top}..${r.bottom}`).join(', ')}) `
          + '— the mode you are about to deploy into is off the list you are reading');
        const cold = s.rows.filter((r) => r.hit < 1);
        assert(cold.length === 0,
          `${s.w}x${s.h}: ${cold.map((r) => `${r.name} ${Math.round(r.hit * 100)}%`).join(', ')} `
          + '— revealed and not clickable, which is what a button painted over a scroller does');
        /* THE SCROLLBAR IS THE AFFORDANCE and styles.css reserves a gutter for
         * it by name. A column that overflows and reserves nothing is the
         * 0-pixel overlay sliver that note is about. */
        assert(s.content <= s.band || s.gutter > 0,
          `${s.w}x${s.h}: ${s.content} px of modes in a ${s.band} px column with a ${s.gutter} px `
          + 'scrollbar gutter — nothing on screen says the list goes on');
      }
      const d = out[0];
      return out.map((s) => `${s.w}x${s.h} ${s.content}px of ${s.cards} modes in ${s.band}px`)
        .join(' · ') + ` · ${d.rows.find((r) => r.key === 'theline')
          ? 'theline reachable' : 'THE LINE IS NOT IN THE LIST'}`;
    } finally { await close(); }
  });

  check('lineseen.2 the flagship mode deploys onto the seed\'s ground with the front in front of you', async () => {
    /**
     * THE WHOLE ROUTE, WITH A MOUSE, AND THEN A LOOK AT THE GROUND.
     *
     * `theline.mjs` proves the win rule, the roll, the generated heightfield
     * and the levy headlessly. None of that is repeated. What is asserted here
     * is only what needs a browser to be false:
     *
     *   THE CARD IS RAISED AT ALL on the shipped page for this mode, and the
     *     four facts it prints are the world's own. `session.mjs` builds the
     *     same card against `_page.mjs`, which is a DOM and not a game — it
     *     cannot tell you that pressing Ignite in Chromium reaches it.
     *   THE GROUND IS THE SEED'S AND IT IS GENERATED. Through the front door,
     *     off a seed the player typed into the box, rather than a `lineWorld`
     *     fixture that was handed the level key.
     *   THE FRONT IS DRESSED IN FRONT OF YOU. `marchTo` lays five marks and
     *     none of them is on the world in a form a headless check reads: they
     *     are craters in a heightfield, an instanced field of prone bodies,
     *     smoke meshes and hulls in `world.statics`. The one that cannot be
     *     checked any other way is whether a hull is STANDING on the ground or
     *     buried in it, which needs the real heightfield under the real
     *     placement.
     *
     * INSTANT ARRIVALS IS TICKED, in the Options tab, with a mouse. It makes
     * `Extraction.beginInsertion` decline (Extraction.js:423) so the run opens
     * on the ground instead of 2 400 m over it. Thirty game-seconds of
     * insertion is three hundred rendered frames here — `frontdoor.mjs` already
     * asserts the flight happens, and this check's frames belong to the ground.
     */
    const SEED = '5';                     /* rolls geonosis — see Session.rollGround */
    const { page, errs, close } = await open();
    try {
      /* Instant arrivals, then the mode, then the seed: the order a player
       * would use, and every one of them a real click. */
      await page.click('.tab[data-tab="opts"]', act);
      const box = page.locator('#opt-instant-spawn');
      await box.scrollIntoViewIfNeeded(act);
      await box.check(act);
      await page.click('.tab[data-tab="play"]', act);
      const card = page.locator('#mode-list .diff', { hasText: 'The Line' }).first();
      assert(await card.count() === 1, 'there is no card called The Line in the Mode list');
      await card.scrollIntoViewIfNeeded(act);
      await card.click(act);
      await page.fill('#opt-seed', SEED, act);
      await page.click('#btn-deploy', act);

      await page.waitForFunction(() => {
        const c = document.getElementById('deploy-card');
        return c && !c.classList.contains('hidden');
      }, null, { timeout: FRAME_MS * 60 });

      const shown = await page.evaluate(() => {
        const w = window.SABER.world, cmd = w?.command;
        const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
        return {
          seed: t('deploy-seed'), ground: t('deploy-ground'), plan: t('deploy-plan'),
          strength: t('deploy-strength'), stages: document.querySelectorAll('#deploy-stages li').length,
          names: [...document.querySelectorAll('#deploy-list .dep-row b')].map((b) => b.textContent),
          world: { runSeed: w?.runSeed ?? null, level: w?.level?.name ?? null,
            levelKey: w?.levelKey ?? null, plan: cmd?.plan ?? null,
            stages: cmd?.stages?.length ?? null, holdTheLine: !!cmd?.holdTheLine,
            roll: cmd?.roster?.all?.map((t2) => t2.name) ?? null,
            generated: w?._genGround ?? null, battlefield: w?.battlefield?.reason ?? null },
        };
      });
      const W = shown.world;
      assert(String(W.runSeed) === SEED,
        `the seed box said ${SEED} and the run was built on ${W.runSeed}`);
      assert(shown.seed === String(W.runSeed),
        `the card printed seed ${shown.seed} over a run seeded ${W.runSeed}`);
      assert(shown.ground === W.level,
        `the card printed "${shown.ground}" and the world loaded "${W.level}"`);
      assert(W.plan && shown.plan && shown.plan.includes(W.plan.name ?? W.plan),
        `the card printed "${shown.plan}" for a session plan of ${JSON.stringify(W.plan)}`);
      assert(shown.names.length === W.roll.length && shown.names.every((n, i) => n === W.roll[i]),
        `the card printed ${shown.names.length} names and the roster holds ${W.roll.length}`
        + ` — ${shown.names.slice(0, 3).join(', ')} against ${W.roll.slice(0, 3).join(', ')}`);
      assert(W.holdTheLine, 'the mode that was deployed is not the one that is won by its line');
      assert(W.generated === `front:${W.levelKey}`,
        `the run is standing on "${W.generated}" — the ground the seed rolled was not generated`);
      assert(W.battlefield, 'there is no battle plan under a run whose ground is meant to be one');

      /* ── DROP, and then look at what the mode put on the ground. */
      await page.click('#btn-deploy-drop', act);
      const ground = await page.evaluate(async () => {
        const S = window.SABER, w = S.world;
        /* Two frames so the first deployed frame's numbers are the settled
         * ones, counted as frames for §2.6's reason. */
        for (let i = 0; i < 2; i++) await window.__frame();
        const F = await import('/src/world/Front.js');
        const P = await import('/src/world/Props.js');
        const hull = P.propMaterials().hull;
        const front = F.engagementFront(w, w.command?.areaNumber ?? 1);
        const line = F.frontLine(front);
        const p = w.player.position;
        let fallen = 0, fallenMeshes = 0, smoke = 0;
        S.engine.scene.traverse((o) => {
          if (o.name === 'fallen') { fallen += o.count ?? 0; fallenMeshes++; }
          if (o.name === 'smoke-columns') smoke++;
        });
        const wrecks = w.statics.filter((m) => m.material === hull);
        const sunk = wrecks.filter((m) => m.position.y + 0.5 < w.terrain.height(m.position.x, m.position.z));
        return {
          paused: !!w.paused, cardUp: !document.getElementById('deploy-card').classList.contains('hidden'),
          hudHidden: document.getElementById('hud').classList.contains('hidden'),
          rosterHidden: document.getElementById('roster').classList.contains('hidden'),
          rosterRows: document.querySelectorAll('#rp-list .rp-row').length,
          front: { distance: +front.distance.toFixed(1), bearing: +front.bearing.toFixed(3) },
          me: +line.side(p.x, p.z).d.toFixed(1),
          fallen, fallenMeshes, smoke,
          wrecks: wrecks.length, sunk: sunk.length,
          strewWrecks: typeof w.strewWrecks,
          draws: S.engine.renderer.info.render.calls,
          tris: S.engine.renderer.info.render.triangles,
          bodies: w.enemies.length,
        };
      });

      assert(!ground.cardUp && !ground.paused,
        'Drop left the card up or the world stopped behind it');
      assert(!ground.hudHidden, 'the HUD is hidden on a mode that is played through it');
      /* §13's fallback spine: the name list. A roster panel that is not on
       * screen is the mode's second one-way variable with nowhere to be read. */
      assert(!ground.rosterHidden && ground.rosterRows >= 8,
        `the roster panel is ${ground.rosterHidden ? 'hidden' : `showing ${ground.rosterRows} rows`}`
        + ' — §13 makes the name list the mode\'s fallback spine and it is not on the screen');
      /* THE PLAYER IS ON THE CLEAN SIDE, LOOKING AT IT. `side().d > 0` is
       * burnt ground, and a player standing on the burnt side has the whole
       * dressing behind them: the one-way visible variable, dressed where they
       * cannot see it. */
      assert(ground.me < 0,
        `the run opens ${ground.me.toFixed(1)} m ON THE BURNT SIDE of its own front — `
        + 'every mark the engagement laid is behind the player');
      assert(ground.fallen > 0 && ground.fallenMeshes > 0,
        'no prone figures on the line — §12.4\'s "the dead mark the front" drew nothing');
      assert(ground.smoke > 0, 'no smoke columns on the burnt side');
      assert(ground.sunk === 0,
        `${ground.sunk} of ${ground.wrecks} hull pieces are under the terrain they stand on`);
      assert(ground.wrecks > 0,
        `the front laid no hulls (world.strewWrecks is ${ground.strewWrecks}) — §12.4 says `
        + '"wrecks belong on the fighting line" and CommandDirector.marchTo passes '
        + '`w.strewWrecks ?? null`, which only LEVELS.geonosis publishes');
      assert(ground.draws > 200, `${ground.draws} draw calls on a deployed field`);
      assert(errs.length === 0, `the page threw: ${errs.slice(0, 4).join(' · ')}`);

      return `seed ${SEED} → ${W.level} (${W.generated}, ${W.battlefield}), plan ${shown.plan}, `
        + `${shown.names.length} names on the card; front at ${ground.front.distance} m, player `
        + `${ground.me} m off it; ${ground.fallen} fallen in ${ground.fallenMeshes} draws, `
        + `${ground.smoke} smoke, ${ground.wrecks} hull pieces (${ground.sunk} sunk); `
        + `${ground.draws} draws / ${(ground.tris / 1e6).toFixed(2)} M tris over ${ground.bodies} bodies`;
    } finally { await close(); }
  });
}
