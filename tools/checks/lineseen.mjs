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

/**
 * ONE FRAME, PRICED HONESTLY, AND EVERY CEILING IN THIS FILE IS A MULTIPLE OF
 * IT.
 *
 * §2.6 measures one frame on an EMPTY field at 4 151 ms. This mode's field is
 * not empty — the levy is forty extra bodies on top of a composed wave — and
 * the probe this check grew out of took OVER SIXTY SECONDS a frame at 1280x720
 * while a dozen other lanes held the box at a load average of 40. So the number
 * here is the worst frame that has actually been seen and not the typical one:
 * a ceiling exists to stop a stopped render loop hanging for ever, and any
 * ceiling tight enough to also measure the box is a check that fails for the
 * wrong reason.
 */
const FRAME_MS = 90000;
const act = { timeout: FRAME_MS * 6 };

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
    window.__frame = (ms = 300000) => new Promise((res, rej) => {
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
    /* THE FADE IS THE MENU'S NUMBER, imported rather than typed — a 26 in this
     * file beside the 26 in `Menu.SCROLL_FADE` and the `calc(100% - 26px)` in
     * styles.css would be a third copy of one decision, which is the defect
     * this check exists to measure in the file next door. Dynamically, inside
     * the body, for the reason HANDOFF §2.1 gives about static edges. */
    const { SCROLL_FADE } = await import('../../src/ui/Menu.js');
    const { page, errs, close } = await open();
    try {
      const out = [];
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate(() => window.__frame());
        const m = await page.evaluate((FADE) => {
          const menu = window.SABER.menu;
          const list = document.getElementById('mode-list');
          const box = list.closest('.col-scroll');
          const col = box.parentElement;
          const cards = [...list.children];
          const keys = [...menu._modeCards.keys()];
          const rows = [];
          const was = menu.s.mode;
          for (const key of keys) {
            /* THE SHIPPED REVEAL, not a re-implementation of it — AND IT IS
             * NOT INSIDE `selectMode`, which is where this check first looked
             * for it. `selectMode` writes the setting and re-paints the `sel`
             * class; the only caller of `_revealMode` in the whole file is
             * `_onPanelShown`. So the property a player actually has is "the
             * mode I am about to deploy into is on screen WHEN THE PANEL IS
             * SHOWN", and driving `selectMode` alone would have measured a
             * column nobody had asked to scroll and reported seven modes off
             * the list — an instrument restating a rule and manufacturing a
             * defect out of the difference (HANDOFF §2.4). */
            menu.selectMode(key);
            menu._onPanelShown();
            const card = menu._modeCards.get(key);
            const cr = card.getBoundingClientRect();
            const br = box.getBoundingClientRect();
            /* Does the mouse actually land on it? A card revealed under the
             * Ignite button's gradient is revealed and unclickable, which is
             * the defect index.html's own note measured at 0.00 hit rate. */
            let hit = 0, n = 0;
            const on = (x, y) => {
              const el = document.elementFromPoint(x, y);
              return !!(el && (el === card || card.contains(el)));
            };
            for (let iy = 1; iy <= 3; iy++) {
              for (let ix = 1; ix <= 5; ix++) {
                n++;
                if (on(cr.left + (cr.width * ix) / 6, cr.top + (cr.height * iy) / 4)) hit++;
              }
            }
            /* THE CENTRE IS THE BAR, and the grid is the reading beside it. A
             * card whose top rows sit under the sticky section heading is still
             * a card the mouse can press — the heading is 24 px and scrolls
             * with nothing. What is NOT acceptable is a card whose middle is
             * covered, which is what a button painted over a scroller does and
             * what index.html's own note measured at 0.00. */
            const centre = on(cr.left + cr.width / 2, cr.top + cr.height / 2);
            rows.push({ key, name: card.querySelector('b')?.textContent ?? key,
              inBand: cr.top >= br.top - 0.5 && cr.bottom <= br.bottom - FADE + 0.5,
              top: Math.round(cr.top - br.top), bottom: Math.round(cr.bottom - br.top),
              centre, hit: +(hit / n).toFixed(2) });
          }
          menu.selectMode(was);
          menu._onPanelShown();
          return { band: Math.round(box.clientHeight), content: Math.round(box.scrollHeight),
            more: col.classList.contains('more'), less: col.classList.contains('less'),
            gutter: box.offsetWidth - box.clientWidth, cards: cards.length, rows };
        }, SCROLL_FADE);
        out.push({ w, h, ...m });
      }

      assert(errs.length === 0, `the front screen threw: ${errs.join(' · ')}`);
      for (const s of out) {
        const off = s.rows.filter((r) => !r.inBand);
        assert(off.length === 0,
          `${s.w}x${s.h}: choosing ${off.map((r) => r.name).join(', ')} leaves the card `
          + `outside the ${s.band} px column (${off.map((r) => `${r.top}..${r.bottom}`).join(', ')}) `
          + '— the mode you are about to deploy into is off the list you are reading');
        const cold = s.rows.filter((r) => !r.centre);
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
      }, null, { timeout: FRAME_MS * 20 });

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
      /* `front:<TERRAIN>` and not `front:<LEVEL>` — the wood stands on `bog`,
       * so the level key is not the ground key and asserting the pair would be
       * a second copy of `LEVELS[*].terrain`. What matters is that the run is
       * standing on a ground this build GENERATED. */
      assert(String(W.generated).startsWith('front:'),
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
        /* `frontLine` is Battlefield.js's and Front.js does not re-export it —
         * it re-exports the four schedule constants and nothing else. Reaching
         * for `F.frontLine` throws "frontLine is not a function" and takes the
         * whole check with it. */
        const B = await import('/src/world/Battlefield.js');
        const P = await import('/src/world/Props.js');
        const hull = P.propMaterials().hull;
        const front = F.engagementFront(w, w.command?.areaNumber ?? 1);
        const line = B.frontLine(front);
        const p = w.player.position;
        let fallen = 0, fallenMeshes = 0, smoke = 0;
        S.engine.scene.traverse((o) => {
          if (o.name === 'fallen') { fallen += o.count ?? 0; fallenMeshes++; }
          if (o.name === 'smoke-columns') smoke++;
        });
        /* THE HULLS, AND WHICH OF THEM ARE THE FRONT'S.
         *
         * `LEVELS.geonosis.dress` strews fourteen clusters of its own at any
         * bearing out to 235 m, so a bare count of hull pieces would pass on a
         * ground whose front laid NONE — the false pass that matters, because
         * `CommandDirector.marchTo` passes `w.strewWrecks ?? null` and only
         * that one level publishes the builder. `marchFront` sites its hulls
         * within 40 m of a point ON the line (`line.place(u, 0)`, rmax 40), so
         * distance from the front is what separates the two populations. */
        const wrecks = w.statics.filter((m) => m.material === hull);
        const onLine = wrecks.filter((m) => Math.abs(line.side(m.position.x, m.position.z).d) <= 45);
        const sunk = wrecks.filter((m) => m.position.y + 0.5 < w.terrain.height(m.position.x, m.position.z));
        return {
          paused: !!w.paused, cardUp: !document.getElementById('deploy-card').classList.contains('hidden'),
          hudHidden: document.getElementById('hud').classList.contains('hidden'),
          rosterHidden: document.getElementById('roster').classList.contains('hidden'),
          rosterRows: document.querySelectorAll('#rp-list .rp-row').length,
          front: { distance: +front.distance.toFixed(1), bearing: +front.bearing.toFixed(3) },
          me: +line.side(p.x, p.z).d.toFixed(1),
          /* HOW FAR THE PLAYER HAS TO TURN TO SEE IT — reported, not asserted.
           *
           * `Player`'s rig opens at `yaw = Math.PI` and nothing on the solo
           * path writes it again; the front's bearing is a seed roll. Measured
           * over the 169 seeds of 200 that roll a ground with a plan on it,
           * **38 open with the front inside the frame** — 22% — and the rest
           * open looking at clean ground with §5's 0:24 behind them. That is a
           * design decision with an owner (turn the player, or turn the front)
           * and not a regression this check can hold a bar on, so the number
           * rides in the message where a gate run will keep printing it.
           * `frontCamera` owns the yaw conversion; nothing here restates it. */
          offBy: (() => {
            let d = (w.player.camera?.yaw ?? 0) - F.frontCamera(front).yaw;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            return Math.round(d * 180 / Math.PI);
          })(),
          fallen, fallenMeshes, smoke,
          wrecks: wrecks.length, onLine: onLine.length, sunk: sunk.length,
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
      /* THE PRECONDITION, ASSERTED SEPARATELY FROM THE RESULT, because the two
       * fail for different reasons and one of them is a whole class: a ground
       * that does not publish the builder lays no hulls and says nothing —
       * HANDOFF §2.3's missing thing answered with a plausible default, spelled
       * `w.strewWrecks ?? null`. */
      assert(ground.strewWrecks === 'function',
        `${W.levelKey} does not publish strewWrecks, so CommandDirector.marchTo passed null and `
        + 'the front laid no hulls at all — §12.4 says "wrecks belong on the fighting line" and '
        + 'prices them as the biggest draw-call item on this ground');
      assert(ground.onLine > 0,
        `${ground.wrecks} hull pieces on this ground and none of them within 45 m of the front `
        + '— the level dressed itself and the engagement dressed nothing');
      assert(ground.draws > 200, `${ground.draws} draw calls on a deployed field`);
      assert(errs.length === 0, `the page threw: ${errs.slice(0, 4).join(' · ')}`);

      return `seed ${SEED} → ${W.level} (${W.generated}, ${W.battlefield}), plan ${shown.plan}, `
        + `${shown.names.length} names on the card; front at ${ground.front.distance} m, player `
        + `${ground.me} m off it and ${ground.offBy}° from facing it; `
        + `${ground.fallen} fallen in ${ground.fallenMeshes} draws, `
        + `${ground.smoke} smoke, ${ground.onLine} of ${ground.wrecks} hull pieces on the line `
        + `(${ground.sunk} sunk); `
        + `${ground.draws} draws / ${(ground.tris / 1e6).toFixed(2)} M tris over ${ground.bodies} bodies`;
    } finally { await close(); }
  });
}
