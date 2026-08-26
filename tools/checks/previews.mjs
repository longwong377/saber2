/**
 * EVERY CARD IN THE MENU IS A PICTURE OF THE THING IT OFFERS.
 *
 * The theatre cards and the hilt cards were hand-drawn canvases — a few flat
 * bands per level, a grey bar per hilt. The player asked for real screenshots
 * of the maps "10000000 times", and said of the hilts that they "all show the
 * same image". The first clause of that was measured and is false: the ten
 * hilt cards are ten distinct drawings. The second is true, and is worse — ten
 * DIFFERENT pictures that are indistinguishable at 168x54 is the same defect
 * with an alibi.
 *
 * `tools/shots.mjs` and `tools/hiltshots.mjs` render them from the running
 * game and commit the result. This file is what stops that from rotting.
 *
 * ── WHAT IT ASSERTS, AND WHY EACH ONE CAN FAIL ──────────────────────────
 *
 * The failure this guards against is not a broken image. It is a NEW LEVEL, or
 * a new hilt, added by somebody who does not know these files exist — and
 * because `Menu` lists the JPEG first and the drawn canvas second, that level
 * would fall back to the old drawing and look, on the menu, exactly like the
 * thing the player has complained about three times. Silent, and indefinitely
 * survivable. So the subject is DERIVED from `LEVEL_ORDER` and `HILT_STYLES`
 * rather than from a list beside them: a level that exists and has no picture
 * fails here on the day it is added.
 *
 * A file that is present but empty, or a 400-byte black rectangle, would
 * satisfy "exists" and satisfy nobody else, so size is asserted too — and the
 * upper bound matters as much as the lower, because these ship in the repo.
 */
import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  const { statSync, existsSync, readFileSync } = await import('node:fs');
  const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
  const { HILT_STYLES } = await import('../../src/game/Saber.js');
  const dir = new URL('../../assets/previews/', import.meta.url);
  const at = (f) => new URL(f, dir);

  /** The smallest a real screenshot can plausibly be, in bytes. */
  const FLOOR = 2500;
  /** …and the largest one may be before it is a problem the repo carries. */
  const LEVEL_CEIL = 320 * 1024;
  const HILT_CEIL = 64 * 1024;

  check('previews: every theatre on the roster has a screenshot of itself', () => {
    const missing = [], thin = [], fat = [];
    for (const key of LEVEL_ORDER) {
      const f = at(`${key}.jpg`);
      if (!existsSync(f)) { missing.push(key); continue; }
      const n = statSync(f).size;
      if (n < FLOOR) thin.push(`${key} ${n}B`);
      if (n > LEVEL_CEIL) fat.push(`${key} ${(n / 1024) | 0}kB`);
    }
    assert(LEVEL_ORDER.length > 0, 'LEVEL_ORDER is empty — this check is not looking at anything');
    assert(missing.length === 0,
      `${missing.length} of ${LEVEL_ORDER.length} theatres have no preview: ${missing.join(', ')}. `
      + 'The menu falls back to the drawn card, which is the thing the player has asked three times to '
      + 'be rid of, and nothing else would ever say so. Run `node tools/shots.mjs`');
    assert(thin.length === 0, `preview far too small to be a screenshot: ${thin.join(', ')}`);
    assert(fat.length === 0,
      `preview over ${(LEVEL_CEIL / 1024) | 0} kB: ${fat.join(', ')} — these are committed to the repo`);
    return `${LEVEL_ORDER.length} theatres, all shot`;
  });

  check('previews: every hilt in the forge has a picture of itself', () => {
    const missing = [], thin = [], fat = [];
    for (const name of HILT_STYLES) {
      const f = at(`hilt-${name}.jpg`);
      if (!existsSync(f)) { missing.push(name); continue; }
      const n = statSync(f).size;
      if (n < 1200) thin.push(`${name} ${n}B`);
      if (n > HILT_CEIL) fat.push(`${name} ${(n / 1024) | 0}kB`);
    }
    assert(HILT_STYLES.length > 0, 'HILT_STYLES is empty');
    assert(missing.length === 0,
      `${missing.length} of ${HILT_STYLES.length} hilts have no render: ${missing.join(', ')}. `
      + 'Run `node tools/hiltshots.mjs`');
    assert(thin.length === 0, `hilt render far too small: ${thin.join(', ')}`);
    assert(fat.length === 0, `hilt render over ${(HILT_CEIL / 1024) | 0} kB: ${fat.join(', ')}`);
    return `${HILT_STYLES.length} hilts, all rendered`;
  });

  check('previews: no two cards are the same picture', () => {
    /**
     * THE ACTUAL COMPLAINT, AS A PROPERTY. "all show the same image" was not
     * literally true of the drawings and would be catastrophically true of a
     * render pass that framed the camera on the wrong object and shot ten
     * identical black rectangles — which is exactly what the first run of
     * `hiltshots.mjs` did before the hilt was reparented out of the figure's
     * hand. Byte equality is a coarse test and it is the right one here: two
     * JPEGs of two different hilts cannot come out identical by accident.
     */
    const seen = new Map();
    const dupes = [];
    const files = [...LEVEL_ORDER.map((k) => `${k}.jpg`), ...HILT_STYLES.map((h) => `hilt-${h}.jpg`)];
    for (const f of files) {
      const u = at(f);
      if (!existsSync(u)) continue;
      const key = readFileSync(u).toString('base64');
      if (seen.has(key)) dupes.push(`${f} == ${seen.get(key)}`);
      else seen.set(key, f);
    }
    assert(seen.size > 0, 'no preview files at all — nothing was compared');
    assert(dupes.length === 0,
      `${dupes.length} card(s) are byte-identical to another: ${dupes.join(', ')}. Every card is supposed `
      + 'to be a picture of its own subject');
    return `${seen.size} distinct pictures`;
  });

  check('previews: the menu asks for the screenshot first and the drawing second', () => {
    /* The order is the fallback. If the drawn canvas were named first it would
     * be painted ON TOP of the screenshot and nothing would look different —
     * the assets would ship, the check above would pass, and the menu would
     * still show the old cards. That failure is invisible from every other
     * angle, which is why it is asserted on the source. */
    const src = readFileSync(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
    for (const [what, shot, drawn] of [['theatre', 'LEVEL_SHOT(key)', '_levelArt(key)'],
      ['hilt', 'HILT_SHOT(h)', '_hiltArt(h)']]) {
      const line = src.split('\n').find((l) => l.includes(shot) && l.includes(drawn));
      assert(line, `the ${what} card no longer names both ${shot} and ${drawn} on one line — the `
        + 'screenshot-over-drawing fallback has been taken apart');
      assert(line.indexOf(shot) < line.indexOf(drawn),
        `the ${what} card paints the DRAWING over the screenshot. background-image lists top layer `
        + 'first, so this shows the old card and hides the render');
    }
    return 'screenshot over drawing, both card sets';
  });
}
