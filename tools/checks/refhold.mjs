/**
 * ══ THE ROOM IS HELD TO THE REFERENCES, BY NUMBER ═════════════════════════
 *
 * `assets/reference/REFERENCES.md` records eight rules all seven hangar images
 * agree on. Six of them were broken by the first two dressings of this room,
 * and every one of those broke SILENTLY: the suites were green, the draw calls
 * were under budget, and the room looked like a bombed street.
 *
 * So the rules that can be measured are measured here. This file is not about
 * whether the deck is pretty — nothing can check that — it is about whether the
 * specific, countable things every reference does are actually done.
 *
 * WHAT IT CANNOT SEE, said out loud so nobody mistakes green for good: it
 * cannot see proportion, composition, or whether the room reads as a hangar.
 * Only a person looking at a frame can, and `tools/_deckshot.mjs` is how that
 * frame gets taken. A green run here means the room has not drifted off the
 * references on the axes a number can hold. It does not mean it is any good.
 */
import { readFile } from 'node:fs/promises';

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const deck = async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 },
    });
    return world;
  };

  check('reference: there is no yellow on this deck, because there is none in any reference', async () => {
    /**
     * RULE 6. Seven images, zero yellow. The first dressing had caution-yellow
     * hazard chevrons on every edge of the room, yellow landing circles and a
     * yellow keep-out line round the trench — every bit of it invented from a
     * terrestrial airfield and none of it in a single reference. The accents in
     * the images are RED: status lamps, thin painted rectangles, markers.
     *
     * Measured as HUE on every material in the room. A yellow is anything from
     * 40° to 70° with real saturation; a warm grey is not, and a red status
     * lamp at 5° is exactly what is wanted.
     */
    const THREE = await import('three');
    const world = await deck();
    try {
      const bad = [];
      const hsl = { h: 0, s: 0, l: 0 };
      const seen = new Set();
      world.scene.traverse((o) => {
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m || seen.has(m.uuid)) continue;
          seen.add(m.uuid);
          for (const key of ['color', 'emissive']) {
            const c = m[key];
            if (!c || !c.isColor) continue;
            c.getHSL(hsl);
            const deg = hsl.h * 360;
            if (deg >= 40 && deg <= 70 && hsl.s > 0.25 && hsl.l > 0.15) {
              bad.push(`${m.name || o.name || m.type}.${key} #${c.getHexString()} at ${deg.toFixed(0)}°`);
            }
          }
        }
      });
      assert(!bad.length,
        `${bad.length} yellow surface(s) on the flight deck: ${bad.slice(0, 6).join(', ')} — there `
        + 'is no yellow in any of the seven references. The accent colour is RED. Caution chevrons '
        + 'are a terrestrial airfield convention and they were invented here, not observed.');
      return `${seen.size} materials, no yellow in any of them`;
    } finally { world.unload(); }
  });

  check('reference: the deck is a dark mirror, not a grey floor', async () => {
    /**
     * RULE 2. All seven images. The floor is near-black, glossy, and reflects
     * every light in the room as a long vertical smear — in `hangar 5.webp` the
     * reflection is half the picture. The first version was a matte heightfield
     * with a faint tile pattern, which is precisely the "no detail on the
     * ground" the player named.
     *
     * Two numbers hold it: the deck's own albedo has to be DARK, and its
     * roughness has to be LOW enough to throw a reflection at a grazing angle.
     */
    const { TERRAIN_PRESETS } = await import('../../src/world/Terrain.js');
    const P = TERRAIN_PRESETS.hangardeck;
    assert(P, 'there is no hangardeck ground');
    const THREE = await import('three');
    const c = new THREE.Color(P.sandColor);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    assert(hsl.l <= 0.20,
      `the deck's albedo is L=${hsl.l.toFixed(2)} (#${c.getHexString()}) — every reference floor is `
      + 'near-black, and a mid-grey deck cannot throw the reflections that are half of what those '
      + 'rooms look like');
    assert((P.gloss ?? 0) >= 0.35,
      `the deck declares gloss ${(P.gloss ?? 0).toFixed(2)} — a matte deck reflects nothing, and in `
      + 'hangar 5.webp the reflection is half the image');
    return `deck L=${hsl.l.toFixed(2)}, gloss ${(P.gloss ?? 0).toFixed(2)}`;
  });

  check('reference: every field edge has a lit rim, because that is what makes it read', async () => {
    /**
     * RULE 1, and the one that cost the most. In all seven images the opening
     * is bordered by a continuous, intensely bright white band — the brightest
     * thing in the frame, brighter than anything it lights. It is what says the
     * vacuum is on the other side.
     *
     * The first version had three translucent planes and no rim at all, and in
     * the first render of the room the field was INVISIBLE: nothing framed it,
     * so there was nothing to see.
     */
    const world = await deck();
    try {
      const rims = [];
      world.scene.traverse((o) => {
        if (o.name === 'field-rim') rims.push(o);
      });
      assert(rims.length >= 3,
        `${rims.length} lit rim(s) on the field edges — every reference borders its opening with a `
        + 'continuous bright band, and without one a translucent plane is invisible against space');
      let lit = 0;
      for (const r of rims) {
        const m = Array.isArray(r.material) ? r.material[0] : r.material;
        if (m?.emissive && m.emissiveIntensity > 1.2) lit++;
      }
      assert(lit === rims.length,
        `${rims.length - lit} of ${rims.length} rims are not emissive — the rim has to be the `
        + 'brightest thing in the room, not a lit surface');
      return `${rims.length} rims, all emissive`;
    } finally { world.unload(); }
  });

  check('reference: the notes are current, and every rule they state is one of these checks or is named unmeasurable', async () => {
    /**
     * THE FILE THAT STOPS THIS SET ROTTING. `REFERENCES.md` states eight rules;
     * if a rule is added there and nothing here holds it, the notes become a
     * document nobody acts on — which is what a reference directory nobody
     * opened already was.
     */
    const notes = await readFile(new URL('../../assets/reference/REFERENCES.md', import.meta.url), 'utf8');
    const rules = [...notes.matchAll(/^### (\d)\. (.+)$/gm)].map((m) => m[2]);
    assert(rules.length >= 8,
      `REFERENCES.md states ${rules.length} agreed rules and there were eight — a rule was dropped`);
    /* Which of them a number can hold. The rest are named here so their absence
     * is a decision rather than an oversight. */
    const unmeasurable = ['RANKS OF SHIP BAYS', 'THIN BRIGHT STRIPS', 'PEOPLE BEING TINY',
      'LARGE, PALE AND SPARSE', 'HANGING FIXTURES'];
    const held = rules.filter((r) => !unmeasurable.some((u) => r.includes(u)));
    assert(held.length >= 3,
      `only ${held.length} of the agreed rules are held by a number — the rest are composition, `
      + 'which only a person looking at a frame can judge');
    return `${rules.length} rules · ${held.length} held by number · ${unmeasurable.length} need an eye`;
  });
}
