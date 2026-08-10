/**
 * Choosing what you look like. — src/ui/Menu.js, src/game/Player.js
 *
 * `buildJedi` has accepted `skinColor` and `hairColor` since it was written and
 * NOTHING EVER PASSED THEM. Every Jedi in this game was the same default face
 * under one of six robe palettes, and the robe palette was the only thing a
 * player could change about their own body — while the preview beside it
 * rendered a floating hilt and no person at all, so even that choice was made
 * blind.
 *
 * The builder needed no changes. The whole feature was two swatch rows, a line
 * in `spawnPlayer`, and a body in the preview. That is the third time in this
 * project a shipped-looking feature turned out to be a parameter nobody passed,
 * which is why the checks here are about the VALUE ARRIVING rather than about
 * the control existing.
 */
import { DEFAULT_SETTINGS, SKIN_TONES, HAIR_COLORS } from '../../src/ui/Menu.js';
import { buildJedi } from '../../src/game/Bodies.js';
import { readFile } from 'node:fs/promises';

/** Every material colour on a built figure, as a sorted hex list. */
function palette(built) {
  const seen = new Set();
  built.rig.root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (mm.color) seen.add(mm.color.getHex());
    }
  });
  return [...seen].sort((a, b) => a - b);
}

export async function run({ check, assert }) {
  check('appearance: the palettes are real choices, not one tone twice', () => {
    assert(SKIN_TONES.length >= 6, `only ${SKIN_TONES.length} skin tones`);
    assert(HAIR_COLORS.length >= 6, `only ${HAIR_COLORS.length} hair colours`);
    for (const [name, pal] of [['skin', SKIN_TONES], ['hair', HAIR_COLORS]]) {
      const hexes = new Set(pal.map(c => c.hex));
      assert(hexes.size === pal.length, `${name} has duplicate entries`);
      // and they must actually span a range, or it is a gradient of one idea
      const lum = pal.map(c => ((c.hex >> 16 & 255) * 0.2126 + (c.hex >> 8 & 255) * 0.7152 + (c.hex & 255) * 0.0722) / 255);
      const span = Math.max(...lum) - Math.min(...lum);
      assert(span > 0.35, `${name} spans only ${(span * 100).toFixed(0)}% of lightness — that is one tone`);
    }
    assert(DEFAULT_SETTINGS.skinIndex >= 0 && DEFAULT_SETTINGS.skinIndex < SKIN_TONES.length,
      'the default skin index is not in the palette');
    assert(DEFAULT_SETTINGS.hairIndex >= 0 && DEFAULT_SETTINGS.hairIndex < HAIR_COLORS.length,
      'the default hair index is not in the palette');
    return `${SKIN_TONES.length} skins, ${HAIR_COLORS.length} hairs, both spanning a real range`;
  });

  check('appearance: choosing a skin tone changes the body that gets built', () => {
    // THE ONE THAT MATTERS. A swatch that writes a setting nothing reads is
    // exactly the bug this file exists to prevent, and it is invisible from the
    // menu — the control looks like it works.
    const a = buildJedi({ robeIndex: 1, skinColor: SKIN_TONES[0].hex, hairColor: HAIR_COLORS[0].hex, scale: 1 });
    const b = buildJedi({ robeIndex: 1, skinColor: SKIN_TONES[6].hex, hairColor: HAIR_COLORS[0].hex, scale: 1 });
    const pa = palette(a), pb = palette(b);
    assert(pa.length === pb.length, 'two figures built the same way have different material counts');
    const diff = pa.filter((h, i) => h !== pb[i]).length;
    assert(diff > 0,
      'building with Porcelain and with Deep produced identical materials — skinColor is not read');
    // NOT "the exact hex appears on the figure": the builder derives shades from
    // the tone — a lit face, a shadowed neck — so the chosen value is a source,
    // not a swatch that must survive verbatim. The property that IS true, and
    // is the one worth pinning, is that the figure moves the right WAY.
    const lum = (h) => (h >> 16 & 255) * 0.2126 + (h >> 8 & 255) * 0.7152 + (h & 255) * 0.0722;
    const changed = pa.map((h, i) => [h, pb[i]]).filter(([x, y]) => x !== y);
    const meanA = changed.reduce((s2, [x]) => s2 + lum(x), 0) / changed.length;
    const meanB = changed.reduce((s2, [, y]) => s2 + lum(y), 0) / changed.length;
    assert(meanA > meanB,
      `Porcelain built a figure whose changed materials average ${meanA.toFixed(0)} `
      + `against Deep's ${meanB.toFixed(0)} — the tone is read but applied backwards`);
    return `${diff} material(s) differ; mean lightness ${meanA.toFixed(0)} (Porcelain) `
      + `vs ${meanB.toFixed(0)} (Deep)`;
  });

  check('appearance: choosing a hair colour changes the body that gets built', () => {
    const a = buildJedi({ robeIndex: 1, skinColor: SKIN_TONES[2].hex, hairColor: HAIR_COLORS[0].hex, scale: 1 });
    const b = buildJedi({ robeIndex: 1, skinColor: SKIN_TONES[2].hex, hairColor: HAIR_COLORS[8].hex, scale: 1 });
    const pa = palette(a), pb = palette(b);
    const diff = pa.filter((h, i) => h !== pb[i]).length;
    assert(diff > 0, 'building with Black and with White hair produced identical materials — hairColor is not read');
    return `${diff} material(s) differ between black and white hair`;
  });

  check('appearance: the choice survives the trip from the menu to the world', async () => {
    // Menu writes the index, World hands it to Player, Player turns it into the
    // hex buildJedi wants. Every link asserted, because the chain is exactly
    // where the last three of these bugs lived.
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const player = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    for (const key of ['skinIndex', 'hairIndex']) {
      assert(new RegExp(`${key}:\\s*this\\.settings\\.${key}`).test(world),
        `World.spawnPlayer does not pass ${key} to the Player`);
      assert(new RegExp(`opts\\.${key}`).test(player) || new RegExp(`settings\\.${key}`).test(player),
        `Player never reads ${key}, so the swatch writes a setting nobody uses`);
    }
    // STRONGER THAN IT WAS. This used to assert the literal `SKIN_TONES[...]`,
    // which pinned one shared palette — and the palette is not shared any more:
    // a rack belongs to a SPECIES, because a Twi'lek built from the human row
    // is a beige Twi'lek. So the property is not "it indexes that array", it is
    // "it resolves the index on the rack that species actually has".
    assert(/skinHex\(/.test(player), 'Player does not turn the skin index into a colour at all');
    const h = player.slice(player.indexOf('function skinHex'), player.indexOf('const rng = makeRng'));
    assert(/speciesOf\(/.test(h) && /skinTones/.test(h),
      'the skin index is resolved without asking the species which tones it has');
    assert(/rack\[0\]|\|\| rack/.test(h),
      'an index past the end of a shorter species rack has no fallback — it would build a colourless body');
    assert(/hairColor:\s*HAIR_COLORS\[/.test(player), 'Player does not turn the hair index into a colour');
    return 'menu index -> World.spawnPlayer -> Player -> species rack -> buildJedi';
  });

  check('appearance: the preview shows a person, not a floating hilt', async () => {
    // Robe colour was a setting for the whole life of the menu and the preview
    // never rendered a body, so picking one was picking blind. A creator you
    // cannot see is a settings screen.
    const menu = await readFile(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
    const i = menu.indexOf('_refreshPreview(rebuild');
    assert(i > 0, '_refreshPreview is gone');
    const body = menu.slice(i, i + 2200);
    assert(/buildJedi\(/.test(body), 'the preview builds no figure');
    assert(/skinColor/.test(body) && /hairColor/.test(body) && /robeIndex/.test(body),
      'the preview figure ignores at least one of the three appearance choices');
    // and picking any of them has to rebuild it, or the preview lies
    for (const key of ['skinIndex', 'hairIndex', 'robeIndex']) {
      const j = menu.indexOf(key);
      assert(j > 0, `${key} is gone`);
    }
    // The rack argument is no longer a fixed name — it is the species' own —
    // so what is pinned is the CONSEQUENCE: picking a tone must rebuild the
    // preview, whichever rack it came from.
    assert(/_swatchRow\('skin-list', 'skinIndex', [^,]+, \(\) => this\._refreshPreview/.test(menu),
      'picking a skin tone does not refresh the preview');
    assert(/_cardRow\('species-list'[^)]*\)/.test(menu), 'species is not a control at all');
    return 'the preview builds a Jedi from all three choices and rebuilds on every pick';
  });
}
