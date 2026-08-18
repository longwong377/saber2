/**
 * WHICH LEVEL A BROWSER TOOL SHOULD OPEN, AND HOW LONG IT SHOULD WAIT — and
 * NOTHING ELSE IN THIS FILE.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────
 *
 * Five instruments — `portrait.mjs`, `fpview.mjs`, `covershot.mjs`,
 * `_wielder.mjs` and `_depth.mjs` — opened with
 *
 *     import { resolveLevel } from './_roster.mjs';
 *
 * and `_roster.mjs` HAS NEVER EXPORTED THAT NAME. All five died with
 * `SyntaxError: The requested module './_roster.mjs' does not provide an export
 * named 'resolveLevel'` before a browser was ever launched. That is why nobody
 * has looked at a portrait: the instrument for "render every archetype and look
 * at it" has been dead since `_roster.mjs` was written.
 *
 * And `_roster.mjs` could not usefully provide it either, which is the part
 * worth keeping. It opens `import * as THREE from 'three'` and imports the
 * game, and these five tools run WITHOUT `--import ./tools/register.mjs` —
 * they are `node tools/portrait.mjs`, because their work happens in a browser.
 * Importing them into that graph is HANDOFF §2.1's two-copies-of-three trap
 * with the loader missing entirely. So a file the browser tools may import has
 * to be free of both, and this one is: no `three`, no `src/`, nothing at module
 * scope but two functions and a constant.
 *
 * ── WHERE THE ANSWER COMES FROM ───────────────────────────────────────────
 *
 * From the RUNNING PAGE, never from a list kept here (HANDOFF §2.3). Two
 * routes, in order, and the second is the one that means no game file has to
 * change: `window.SABER.LEVEL_ORDER` if the page publishes it, and otherwise a
 * dynamic `import()` of `Levels.js` **inside the page**. The page is served
 * over HTTP by each tool's own static server and the game is plain ES modules,
 * so that import resolves to the module instance the game itself is using —
 * not a second copy, and not a hand-copy of the roster living in `tools/`.
 *
 * A name this build does not have is refused OUT LOUD. `World.loadLevel`
 * substitutes `LEVEL_ORDER[0]` for an unknown key, deliberately and with a
 * comment calling it a safety net — right for a player with a stale profile,
 * and a trap for an instrument, which is the whole of HANDOFF §2.7. Four
 * checks once spent a session measuring the Ember Shelf while naming a level
 * that had been deleted.
 *
 * ── AND WHY THE WAITING IS HERE TOO ───────────────────────────────────────
 *
 * Because the five tools that could not start also could not have finished.
 * Every one of them waits for the HUD on a wall clock — `waitForSelector('#hud
 * :not(.hidden)', { timeout: 60000 })` — and HANDOFF §2.6 measures ONE FRAME
 * at up to 4151 ms through swiftshader on an empty field. Sixty seconds is
 * about fourteen frames, and the frames just after a deploy are the most
 * expensive in the run. `smoke.mjs` was already rewritten for exactly this and
 * its note says so; these five never were. The unit is a RENDERED FRAME, and
 * `deployAndWait` below is `smoke.mjs`'s deploy step with its own numbers.
 */

/** Frames a deploy is allowed before the HUD being hidden is a real failure. */
export const DEPLOY_FRAMES = 24;
/** Wall-clock ceiling for ONE frame. Per-frame, so it does not accumulate. */
export const FRAME_CEIL_MS = 15000;

/**
 * The level roster, read out of the page.
 *
 * `page.evaluate` with a dynamic import is the fallback rather than the first
 * try because `window.SABER` costs nothing when it is there, and because a
 * build that publishes the roster deliberately should be believed over one
 * inferred by reaching into `src/`.
 */
async function rosterOf(page) {
  return page.evaluate(async () => {
    let LEVELS = window.SABER?.LEVELS;
    let LEVEL_ORDER = window.SABER?.LEVEL_ORDER;
    if (!LEVEL_ORDER) {
      const m = await import(new URL('src/game/Levels.js', location.href).href);
      LEVELS = m.LEVELS; LEVEL_ORDER = m.LEVEL_ORDER;
    }
    const order = LEVEL_ORDER ? [...LEVEL_ORDER] : [];
    const outdoor = {};
    for (const k of order) {
      const L = LEVELS?.[k] || {};
      // "Can this level see the sky" is the only property a shot tool asks, and
      // it is asked of the level's own atmosphere block rather than of a list
      // of names kept here.
      outdoor[k] = L.atmosphere ? L.atmosphere.sky !== false : true;
    }
    return { order, outdoor };
  });
}

/**
 * @param page  a Playwright page that has at least reached `domcontentloaded`
 * @param want  a level key, or null for "whatever this build opens with"
 * @param opts  `{ sky: true }` to prefer a level with a sky in it
 */
export async function resolveLevel(page, want = null, opts = {}) {
  const { order, outdoor } = await rosterOf(page);
  if (!order.length) {
    throw new Error('the page publishes no level roster — neither window.SABER.LEVEL_ORDER '
      + 'nor an importable src/game/Levels.js. A browser tool cannot pick a level it cannot see.');
  }
  if (want) {
    if (!order.includes(want)) {
      throw new Error(`--level ${want} is not a level this build has: ${order.join(', ')}`);
    }
    return want;
  }
  if (opts.sky) {
    const out = order.filter((k) => outdoor[k]);
    if (out.length) return out[0];
  }
  return order[0];
}

/**
 * The same question in Node, for a tool that DOES run under the loader.
 *
 * Dynamic import inside the function body, never a static one: a static edge
 * from here to the game would drag `three` into the graph of every tool that
 * imports this file, which is the thing the header says this file must not do.
 */
export async function nodeLevel(want = null, opts = {}) {
  const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
  if (want) {
    if (!LEVEL_ORDER.includes(want)) {
      throw new Error(`${want} is not a level this build has: ${LEVEL_ORDER.join(', ')}`);
    }
    return want;
  }
  if (opts.sky) {
    const out = LEVEL_ORDER.filter((k) => {
      const A = LEVELS[k]?.atmosphere;
      return A ? A.sky !== false : true;
    });
    if (out.length) return out[0];
  }
  return LEVEL_ORDER[0];
}

/**
 * `window.__frame()` in the page, installed before any navigation.
 *
 * A promise that resolves on the next animation frame and REJECTS if one does
 * not arrive — so a stopped render loop is a failure with a message instead of
 * a tool that sits there. Copied in shape from `smoke.mjs`, whose note records
 * a run that hung for twelve minutes and produced no output at all.
 */
export async function installFrameHelper(page) {
  await page.addInitScript(() => {
    window.__frame = (ms = 15000) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(
        `no animation frame in ${ms} ms — the render loop has stopped`)), ms);
      requestAnimationFrame(() => { clearTimeout(t); res(); });
    });
  });
}

/**
 * Click deploy and wait for the HUD IN FRAMES.
 *
 * The wall-clock waits this replaces were asking "is this box quiet", not "did
 * the game deploy", and on a loaded container they answered no — HANDOFF §2.5
 * counts harnesses lying as four of one day's apparent defects.
 *
 * `settle` extra frames afterwards, because the first frame with the HUD up is
 * the frame the terrain and the instanced fields were built on and nothing in
 * it has been shaded twice yet.
 */
export async function deployAndWait(page, { settle = 2, frames = DEPLOY_FRAMES,
  ceil = FRAME_CEIL_MS, selector = '#hud', button = '#btn-deploy' } = {}) {
  if (button) await page.click(button);
  return page.evaluate(async ([budget, ms, sel, extra]) => {
    const shown = () => {
      const h = document.querySelector(sel);
      return !!h && !h.classList.contains('hidden');
    };
    let f = 0;
    while (!shown()) {
      if (f >= budget) throw new Error(`${sel} was still hidden after ${f} rendered frames`);
      await window.__frame(ms);
      f++;
    }
    for (let i = 0; i < extra; i++) { await window.__frame(ms); f++; }
    return f;
  }, [frames, ceil, selector, settle]);
}

/**
 * Wait for a selector in FRAMES rather than in seconds. Same argument.
 *
 * "Shown" is present AND not `.hidden`, in that order, and the order matters:
 * `#menu` carries no `hidden` class until the game has booted enough to hide
 * it, so `waitForSelector('#menu:not(.hidden)')` — what all five tools used —
 * matched on the first frame and waited for nothing at all. Wait on the
 * BUTTON you are about to click.
 */
export async function waitFramesFor(page, selector, { frames = DEPLOY_FRAMES,
  ceil = FRAME_CEIL_MS } = {}) {
  return page.evaluate(async ([sel, budget, ms]) => {
    /* PRESENT, NOT `.hidden`, AND LAID OUT. The third clause is the one that
     * matters and it is the one `waitForSelector('#menu:not(.hidden)')` never
     * asked: `#btn-deploy` exists in the markup from the first byte, inside a
     * panel the boot sequence has not shown yet, so both of the first two
     * clauses pass on frame 0 and the click that follows then spends its own
     * wall-clock timeout on an element that is there and invisible. Asked as
     * `offsetParent` rather than as a class name for the reason `menu.mjs`
     * gives: it is the browser's own answer, not a restatement of the CSS. */
    const shown = () => {
      const h = document.querySelector(sel);
      return !!h && !h.classList.contains('hidden') && h.offsetParent !== null;
    };
    let f = 0;
    while (!shown()) {
      if (f >= budget) throw new Error(`${sel} never appeared in ${f} rendered frames`);
      await window.__frame(ms);
      f++;
    }
    return f;
  }, [selector, frames, ceil]);
}
