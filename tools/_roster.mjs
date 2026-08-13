/**
 * WHICH LEVEL A HARNESS OPENS, asked of the game instead of typed into the
 * harness.
 *
 * Every browser-driving instrument in this directory had a literal level key as
 * its default — `'dunes'` in five of them, `'canyon'` in a sixth. Those two
 * levels were deleted at the player's request, and nothing complained: the
 * harness wrote the dead key into the profile, `World.loadLevel` substituted a
 * level it could actually load, and the instrument photographed, measured and
 * reported on a map nobody asked for. A silent wrong answer from a measuring
 * instrument is worse than a crash, because you believe it.
 *
 * So: no defaults in the tools. Ask the page. It has the importmap, so this is
 * the same module the running game loaded — no second copy of three, no loader
 * flags on the harness, and no list to keep in step by hand.
 *
 * A named level that does not exist THROWS. Substituting for a typo is the
 * same failure as substituting for a deleted level, one afternoon later.
 */

/**
 * @param {import('playwright-core').Page} page  after goto, before the settings write
 * @param {string|null} named                    whatever `--level` gave, or null
 * @param {{ sky?: boolean }} [want]             `sky: true` for outdoor only
 * @returns {Promise<string>} a level key that exists
 */
export async function resolveLevel(page, named, want = {}) {
  const roster = await page.evaluate(() => import('/src/game/Levels.js').then((m) => ({
    order: m.LEVEL_ORDER,
    sky: Object.fromEntries(m.LEVEL_ORDER.map((k) => [k, m.LEVELS[k]?.atmosphere?.sky !== false])),
  })));
  if (named) {
    if (!roster.order.includes(named)) {
      throw new Error(`no level "${named}" — the game lists ${roster.order.join(', ')}`);
    }
    return named;
  }
  const pool = want.sky ? roster.order.filter((k) => roster.sky[k]) : roster.order;
  if (!pool.length) throw new Error('the game lists no levels this instrument can use');
  return pool[0];
}

/**
 * The same question with no browser in the room, for the instruments that read
 * the level tables directly under `tools/register.mjs`.
 *
 * The import is dynamic on purpose: Levels.js pulls in three, and this module
 * is also imported by pure Playwright drivers that must not drag the engine
 * into their process. Nothing loads until something actually asks.
 *
 * @param {string|null} named   whatever `--level` gave, or null
 * @param {{ sky?: boolean }} [want]
 * @returns {Promise<string>} a level key that exists
 */
export async function nodeLevel(named, want = {}) {
  const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
  if (named) {
    if (!LEVELS[named]) throw new Error(`no level "${named}" — the game lists ${LEVEL_ORDER.join(', ')}`);
    return named;
  }
  const pool = want.sky
    ? LEVEL_ORDER.filter((k) => LEVELS[k]?.atmosphere?.sky !== false)
    : LEVEL_ORDER;
  if (!pool.length) throw new Error('the game lists no levels this instrument can use');
  return pool[0];
}
