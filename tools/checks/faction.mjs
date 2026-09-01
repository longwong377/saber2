/**
 * ══ ONE ARMY IN THE ROOM, AND NOTHING FROM THE OTHER ONE ══════════════════
 *
 * The player's brief for this deck, in his words:
 *
 *   "Ship classes, trooper models, deck insignia, PA voice, lighting colour
 *    temperature, and the enemy capital ships in the battle outside all swap
 *    together. Never mix — if the player sees one wrong-faction asset the
 *    whole illusion dies."
 *
 * ── THE DEFECT THIS FILE WAS WRITTEN FOR ──────────────────────────────────
 *
 * `grep -c faction src/game/DeckKit.js` returned 0. The file that builds every
 * surface, every light and every ship in the hangar had no idea there were two
 * armies. `parkedFighter` is documented in it as "the TIE read" and
 * `Hangar.dressStructure` racks a HUNDRED AND FORTY of them on the walls, three
 * tiers a side plus the outer faces — so a Republic player stood in a room
 * whose single dominant visual element was a wall of Separatist fighters.
 *
 * That is not a wrong-faction asset, it is a wrong-faction ROOM, and every
 * existing suite was green on it: `refhold` measured the palette (which was
 * legal), `deckcost` measured the draw calls (which were fine), and neither has
 * any notion of whose deck it is. A rule nothing measures is a rule that gets
 * broken the first time somebody is busy.
 *
 * ── WHAT IS MEASURED, AND WHY EACH CLAUSE IS SEPARATE ─────────────────────
 *
 * The palettes are two palettes and both are still reference-legal.
 *   Rule 6 of `assets/reference/REFERENCES.md` binds both armies: monochrome
 *   blue-grey, white light, RED accents, and no yellow anywhere in any of the
 *   seven images. So the armies cannot be separated by inventing a colour, and
 *   this holds both ends: they must DIFFER, and neither may drift warm, yellow
 *   or saturated while differing.
 *
 * The material cache is keyed by army.
 *   It was a module-level singleton with a `if (_mats.hull) return` guard,
 *   which with a faction in it means the first room built in a process decides
 *   the palette of every room after it — and nothing anywhere would report it.
 *
 * The ships are different SHAPES.
 *   Measured on geometry with the materials thrown away, because a recolour is
 *   not a faction swap: at rack distance under 0.011 fog a fighter is an
 *   outline and the colour is nearly gone. If the Republic set is the TIE set
 *   in a lighter grey then the audit's finding is not fixed, it is painted over.
 *
 * A built room is one army's room throughout.
 *   The unit checks above can all pass on a file that Hangar.js then calls with
 *   the default for everything. So the room is booted, for each army, and every
 *   deck material in it is asked whose it is.
 */

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const kitFor = async () => (await import('../../src/game/DeckKit.js'));

  /**
   * HUE AND CHROMA, NOT HSL SATURATION — and the difference is the whole
   * measurement. A strip white of #dae8ff has an HSL saturation of 1.0 because
   * HSL saturation explodes near white, so "nothing saturated" measured that
   * way fails every light in every reference. What the eye calls saturation on
   * a near-white is chroma against value: (max−min)/max, which puts that same
   * white at 0.15 and the red status lamp at 0.91.
   */
  const tone = (hex) => {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
      h *= 60;
    }
    return { h, chroma: mx ? d / mx : 0, value: mx / 255, lum: (mx + mn) / 510 };
  };
  const isRed = (t) => t.h < 20 || t.h > 340;
  const isCool = (t) => t.h >= 168 && t.h <= 268;

  check('faction: two palettes, and both of them still obey the references', async () => {
    const { FACTIONS, FACTION_PALETTE, deckMats } = await kitFor();
    const bad = [];
    const seen = [];
    for (const f of FACTIONS) {
      const M = deckMats(f);
      for (const [key, m] of Object.entries(M)) {
        if (!m || !m.isMaterial) continue;
        for (const ch of ['color', 'emissive']) {
          const c = m[ch];
          if (!c || !c.isColor) continue;
          const hex = c.getHex();
          if (!hex) continue;                     // pure black states nothing
          const t = tone(hex);
          seen.push(`${f}.${key}.${ch}`);
          /* RULE 6, FIRST CLAUSE. Seven images, zero yellow. */
          if (t.h >= 40 && t.h <= 70 && t.chroma > 0.15) {
            bad.push(`${f}.${key}.${ch} #${c.getHexString()} is YELLOW at ${t.h.toFixed(0)}°`);
            continue;
          }
          /* RULE 6, SECOND CLAUSE: cool, or neutral, or the red accent. A warm
           * grey is fine; a warm HUE with chroma on it is a lamp temperature
           * this genre does not have. */
          if (!isRed(t) && !isCool(t) && t.chroma > 0.06) {
            bad.push(`${f}.${key}.${ch} #${c.getHexString()} is WARM at ${t.h.toFixed(0)}° `
              + `(chroma ${t.chroma.toFixed(2)})`);
            continue;
          }
          /* RULE 6, THIRD CLAUSE: nothing saturated but the red. */
          if (!isRed(t) && t.chroma > 0.42) {
            bad.push(`${f}.${key}.${ch} #${c.getHexString()} at chroma ${t.chroma.toFixed(2)} — `
              + 'the only saturated thing in any reference is a status lamp');
          }
        }
      }
    }
    assert(!bad.length,
      `${bad.length} surface(s) break rule 6: ${bad.slice(0, 6).join('; ')}. The palette is `
      + 'monochrome blue-grey with RED accents; the two armies differ by temperature and value, '
      + 'never by a colour the references do not contain.');

    /* AND THEY ACTUALLY DIFFER. A faction seam that resolves to one palette is
     * a seam that has not been wired, and it looks identical from here. */
    const R = FACTION_PALETTE.republic, S = FACTION_PALETTE.separatist;
    const keys = Object.keys(R).filter((k) => k !== 'status');
    const same = keys.filter((k) => R[k] === S[k]);
    assert(same.length === 0,
      `${same.length} of ${keys.length} palette entries are identical in both armies (${same.join(', ')}) `
      + '— the two rooms have to read as two rooms');
    /* THE AXES THEY DIFFER ON ARE THE TWO THE REFERENCES VARY ACROSS: the
     * Republic end is paler and nearer neutral, the Separatist end colder and
     * darker. Stated as a number so a later re-tint cannot quietly cross them. */
    const rh = tone(R.hull), sh = tone(S.hull);
    assert(rh.lum > sh.lum + 0.05,
      `republic hull L=${rh.lum.toFixed(2)} against separatist L=${sh.lum.toFixed(2)} — the pale `
      + 'end and the dark end have converged');
    assert(sh.h > rh.h + 8,
      `republic hull ${rh.h.toFixed(0)}° against separatist ${sh.h.toFixed(0)}° — the cold end is `
      + 'not colder, so temperature is not doing the separating and nothing else is allowed to');
    /* The red lamp is the same red on both decks: every reference has one. */
    assert(R.status === S.status, 'the two armies have different status lamps — every one of the '
      + 'seven references has the same red lamp on its overhead gear, whoever owns the ship');
    return `${seen.length} channels legal · hull ${rh.h.toFixed(0)}°/L${rh.lum.toFixed(2)} vs `
      + `${sh.h.toFixed(0)}°/L${sh.lum.toFixed(2)} · ${keys.length} entries all differ`;
  });

  check('faction: the material cache is keyed by army, not by whoever booted first', async () => {
    const { deckMats, FACTIONS } = await kitFor();
    const a = deckMats('republic'), b = deckMats('separatist');
    assert(deckMats('republic') === a, 'deckMats is not memoising — a hangar is five draw calls '
      + 'because five materials serve the whole room, and a fresh set per call is a fresh draw '
      + 'call per part');
    assert(a !== b, 'deckMats returned the SAME material set for both armies — this is the '
      + 'module-level singleton, and with a faction in it the first room built in a process '
      + 'decides the palette of every room after it');
    /* Not one material object may be shared: a shared object means a change to
     * one room's steel silently changes the other's, across worlds. */
    const ids = new Set();
    for (const M of [a, b]) for (const m of Object.values(M)) if (m?.isMaterial) ids.add(m.uuid);
    const total = [a, b].reduce((n, M) => n + Object.values(M).filter((m) => m?.isMaterial).length, 0);
    assert(ids.size === total,
      `${total - ids.size} material object(s) are shared between the two armies — one room's `
      + 'steel is the other room\'s steel and either can change it');
    /* NAMED WITH THEIR ARMY, because a merged room is anonymous meshes to a
     * traverse and the name is the only thing left to ask. */
    for (const f of FACTIONS) {
      const M = deckMats(f);
      assert(M.faction === f, `deckMats('${f}') reports faction '${M.faction}'`);
      const unnamed = Object.entries(M)
        .filter(([, m]) => m?.isMaterial && !String(m.name).startsWith(`deck-${f}-`))
        .map(([k]) => k);
      assert(!unnamed.length,
        `${unnamed.length} of ${f}'s materials do not carry their army in the name `
        + `(${unnamed.join(', ')}) — nothing can then tell whose room a built deck is`);
    }
    return `${total} materials, ${ids.size} distinct, both sets named and memoised`;
  });

  /**
   * A SHAPE SIGNATURE WITH THE MATERIALS THROWN AWAY.
   *
   * Primitive type, vertex count and world-space bounding box per part, sorted
   * so emission order does not matter. Taken off `kit.bins` BEFORE `build`,
   * because `mergeFlat` disposes every source geometry it consumes.
   */
  const shapeOf = (kit) => {
    const parts = [];
    for (const geos of kit.bins.values()) {
      for (const g of geos) {
        g.computeBoundingBox();
        const b = g.boundingBox;
        parts.push(`${g.type}:${g.attributes.position.count}:`
          + `${(b.max.x - b.min.x).toFixed(2)}x${(b.max.y - b.min.y).toFixed(2)}x${(b.max.z - b.min.z).toFixed(2)}`
          + `@${b.min.x.toFixed(2)},${b.min.y.toFixed(2)},${b.min.z.toFixed(2)}`);
      }
    }
    return parts.sort().join('|');
  };

  check('faction: the racked ships are different ships, not the same ship repainted', async () => {
    const K = await kitFor();
    const built = new Map();
    for (const f of K.FACTIONS) {
      for (const kind of [0, 1, 2]) {
        const kit = new K.DeckBuild(f);
        K.parkedFighter(kit, 0, 12, 0, 1, { kind });
        built.set(`${f}:${kind}`, kit);
      }
    }
    /* ACROSS THE ARMIES. This is the audit's finding: a hundred and forty
     * fighters on the walls, and they were the other side's. */
    for (const kind of [0, 1, 2]) {
      const r = shapeOf(built.get(`republic:${kind}`));
      const s = shapeOf(built.get(`separatist:${kind}`));
      assert(r !== s,
        `hull ${kind} is the SAME GEOMETRY for both armies — a recolour is not a faction swap. `
        + 'At rack distance under fog a fighter is an outline; the colour is nearly gone and the '
        + 'shape is all the player ever reads.');
    }
    /* WITHIN AN ARMY. "Rows and rows of different ships" is the brief, and a
     * wall of one mesh ninety times is a wall of one mesh whichever side owns
     * it — the eye finds the repeat in about a second. */
    for (const f of K.FACTIONS) {
      const sigs = [0, 1, 2].map((k) => shapeOf(built.get(`${f}:${k}`)));
      const uniq = new Set(sigs);
      assert(uniq.size === 3,
        `${f} has ${uniq.size} distinct hulls across kinds 0/1/2 — the racks alternate on both `
        + 'axes and a repeat at that pitch reads as wallpaper');
    }
    /* THE BUDGET. A hundred and forty of these merge into one mesh and the
     * whole argument for drawing them at all is that they are cheap. */
    const fat = [...built].filter(([, kit]) => kit.count > 8).map(([k, kit]) => `${k}=${kit.count}`);
    assert(!fat.length,
      `${fat.length} hull(s) over the seven-primitive budget (${fat.join(', ')}) — there are 140 of `
      + 'these on the walls');
    /* AND EVERY PART OF A SHIP IS ITS OWN ARMY'S MATERIAL. One borrowed
     * material is exactly the "one wrong-faction asset" the brief is about,
     * and a merged mesh will never show it to anybody reading the source. */
    for (const [key, kit] of built) {
      const f = key.split(':')[0];
      const own = new Set(Object.values(K.deckMats(f)).filter((m) => m?.isMaterial).map((m) => m.uuid));
      const alien = [...kit.bins.keys()].filter((m) => !own.has(m.uuid)).map((m) => m.name);
      assert(!alien.length, `${key} is built out of ${alien.join(', ')} — another army's material`);
    }
    const counts = [...built].map(([k, kit]) => `${k}=${kit.count}`).join(' ');
    return `6 hulls, all distinct, all in budget · ${counts}`;
  });

  check('faction: the biggest craft in the room swaps with the room', async () => {
    /**
     * The shuttle on the pad is the one object in the middle distance at a
     * readable size — `hangar 7.jpg`'s focal object and `hangar 5.webp`'s. If
     * it is the other army's, the illusion dies at the exact object the
     * composition sends the eye to.
     */
    const K = await kitFor();
    const box = (f) => {
      const kit = new K.DeckBuild(f);
      K.shuttlePad(kit, 0, 0, { radius: 16, yaw: 0 });
      /* THE PAD IS EXCLUDED FROM THE PROPORTION. It is 33 m of disc and it is
       * the same disc on both decks, so leaving it in makes every craft wide
       * and hides the one axis this check is about. Anything above the kerb. */
      let minY = Infinity, maxY = -Infinity, ext = 0;
      for (const geos of kit.bins.values()) for (const g of geos) {
        g.computeBoundingBox();
        const b = g.boundingBox;
        if (b.max.y < 2.0) continue;
        minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y);
        ext = Math.max(ext, Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
      }
      return { kit, w: ext * 2, h: maxY - minY, sig: shapeOf(kit) };
    };
    const r = box('republic'), s = box('separatist');
    assert(r.sig !== s.sig, 'both armies park the same craft on the pad');
    /**
     * AND THE DIFFERENCE IS THE OUTLINE. At 90 m through fog at density 0.011
     * the only thing left of this ship is its proportion, so the two are held
     * apart on the one axis that survives: the Separatist shuttle is TALL —
     * three folded blades — and the Republic gunship is WIDE.
     */
    assert(s.h / s.w > r.h / r.w * 1.25,
      `separatist pad craft ${s.h.toFixed(1)}m tall × ${s.w.toFixed(1)}m against republic's `
      + `${r.h.toFixed(1)}×${r.w.toFixed(1)} — the two silhouettes have converged, and proportion `
      + 'is the only thing that survives the haze at that distance');
    return `separatist ${s.h.toFixed(0)}×${s.w.toFixed(0)} (tall) vs republic `
      + `${r.h.toFixed(0)}×${r.w.toFixed(0)} (wide) · ${r.kit.count}/${s.kit.count} primitives`;
  });

  check('faction: the deck insignia is one large pale shape, and the two marks are two shapes', async () => {
    /**
     * RULE 7: deck markings are LARGE, PALE AND SPARSE, and **no numeral
     * appears anywhere in any of the seven references**. The first dressing had
     * 2.6 m stencilled bay numerals and the notes name them as pure invention —
     * which is why `Paint.digit` and `Paint.number` exist with zero callers and
     * must keep zero on a deck.
     */
    const K = await kitFor();
    const marks = new Map();
    for (const f of K.FACTIONS) {
      const p = new K.Paint(f);
      p.insignia(0, 0, 22);
      marks.set(f, p);
    }
    for (const [f, p] of marks) {
      assert(p.byColor.size === 1,
        `${f}'s insignia is painted in ${p.byColor.size} colours — rule 7 is one large pale mark, `
        + 'not a device with a livery');
      const [hex, geos] = [...p.byColor][0];
      const t = tone(hex);
      assert(t.lum >= 0.45,
        `${f}'s mark is #${hex.toString(16)} at L=${t.lum.toFixed(2)} — rule 7 says PALE, and a `
        + 'dark mark on a black mirror deck is not a mark');
      assert(!isRed(t) && t.chroma < 0.42,
        `${f}'s mark is #${hex.toString(16)} at ${t.h.toFixed(0)}° chroma ${t.chroma.toFixed(2)} — `
        + 'the deck paint in the references is pale grey, with red reserved for keep-out lines');
      assert(geos.length >= 5 && geos.length <= 16,
        `${f}'s mark is ${geos.length} pieces — under five is not a device and over sixteen is the `
        + '"busy" rule 7 bans');
      /* ONE MARK AND NOT A SCATTERING. Every piece inside the circle the mark
       * declares, so an insignia cannot quietly become deck furniture spread
       * over half the plate. */
      let far = 0, reach = 0;
      for (const g of geos) {
        g.computeBoundingBox();
        const b = g.boundingBox;
        /* Axis-wise, not the bbox corner: a ring's corner is √2 of its radius
         * and measuring that would fail a mark that fits its own circle. */
        const d = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
        reach = Math.max(reach, d);
        if (d > 22 * 0.62) far++;
      }
      assert(!far, `${far} of ${geos.length} pieces of ${f}'s mark reach ${reach.toFixed(1)} m from `
        + 'its centre, outside its own 22 m circle — rule 7 is ONE large mark, not a device that '
        + 'has spread across the plate');
    }
    /* THE TWO MARKS ARE DIFFERENT SHAPES. The cog is round and closed; the
     * Confederate mark is a hexagon with a chevron through it and has no ring
     * and no hub anywhere in it. Measured on primitive types, because that is
     * the difference an eye reads at 60 m and a recolour would not survive. */
    const types = (p) => {
      const out = new Set();
      for (const geos of p.byColor.values()) for (const g of geos) out.add(g.type);
      return out;
    };
    const rt = types(marks.get('republic')), st = types(marks.get('separatist'));
    assert([...rt].sort().join(',') !== [...st].sort().join(','),
      `both marks are built from the same primitives (${[...rt].join(',')}) — at deck-marking `
      + 'scale the colour is nearly gone, so a mark that differs only in tint does not differ');
    assert(rt.has('RingGeometry') && !st.has('RingGeometry'),
      'the republic cog has lost its ring, or the confederate mark has grown one — those are the '
      + 'two shapes and they are meant to be unmistakable at any distance');
    /**
     * AND NO NUMERALS ANYWHERE. `digit` lays seven-segment bars and `number`
     * lays rows of them; the references have no numeral in any of the seven
     * and the notes name the bay numerals as pure invention. So an insignia
     * must not BE one — measured by laying a real number and asserting no
     * faction's mark is that shape. Cheap, and it is the specific mistake
     * this room already made once.
     */
    const numeral = new K.Paint('republic');
    numeral.number(K.DECK_PAINT.stencil, 12, 0, 0, 22 * 0.4);
    const nsig = shapeOf({ bins: numeral.byColor });
    for (const [f, p] of marks) {
      assert(shapeOf({ bins: p.byColor }) !== nsig,
        `${f}'s insignia is a painted number. Rule 7: no numeral appears in any of the seven `
        + 'references, and the 2.6 m bay numerals the first dressing had are named in the notes '
        + 'as invented.');
    }
    const rsig = [...marks.get('republic').byColor.values()][0].length;
    return `republic ${rsig} pieces (${[...rt].join('+')}) vs separatist `
      + `${[...marks.get('separatist').byColor.values()][0].length} pieces (${[...st].join('+')}) · `
      + 'neither is a numeral';
  });

  check('faction: the room Hangar.js dresses is one army\'s room, wall to wall', async () => {
    /**
     * EVERYTHING ABOVE PASSES ON A `DeckKit.js` THAT NOBODY CALLS WITH A
     * FACTION — which is the state the audit found, one layer down. So this
     * builds the real dressing pass into a bare kit, for each army, and reads
     * back which materials it actually reached for. No World, no renderer, no
     * physics: `dressStructure` takes a kit and a paint shop and nothing else,
     * so it costs milliseconds and cannot be blocked by anything else in the
     * room being mid-repair.
     */
    const H = await import('../../src/game/Hangar.js');
    const K = await import('../../src/game/DeckKit.js');
    const rows = [];
    for (const f of K.FACTIONS) {
      const kit = new K.DeckBuild(f);
      const paint = new K.Paint(f);
      H.__deckParts.structure(kit, paint);
      const armies = new Map();
      for (const m of kit.bins.keys()) {
        const hit = /^deck-(republic|separatist)-/.exec(String(m.name || ''));
        const who = hit ? hit[1] : '(unmarked)';
        if (!armies.has(who)) armies.set(who, []);
        armies.get(who).push(m.name || m.type);
      }
      assert(armies.size === 1 && armies.has(f),
        `a DeckBuild('${f}') came back holding ${[...armies].map(([w, ms]) => `${w}×${ms.length}`).join(' + ')}`
        + ` — ${[...armies].filter(([w]) => w !== f).flatMap(([, ms]) => ms).slice(0, 5).join(', ')}`
        + ' are the other army\'s.\n'
        + '      `Hangar.dressStructure` opens with a bare `deckMats()`, which always answers\n'
        + `      '${K.DEFAULT_FACTION}', and its rackBay/shuttlePad/overheadRig/catwalk/crates/smear/\n`
        + '      deckLamp calls inherit whatever that kit was made with. Take the faction as a\n'
        + '      parameter and read it from the kit:\n'
        + '          function dressStructure(kit, paint) {\n'
        + '            const M = deckMats(kit.faction);\n'
        + '      and build the kit and the paint shop with it in dressHangar:\n'
        + '          const faction = factionOf(world);\n'
        + '          const kit = new DeckBuild(faction);\n'
        + '          const paint = new Paint(faction);');
      rows.push(`${f}=${kit.count} prims / ${armies.get(f).length} materials`);
    }
    return rows.join(' · ');
  });

  check('faction: the room wears its army\'s mark, on the deck and on the bulkhead', async () => {
    /**
     * AN EXPORT WITH NO CALLER IS THE DEFECT THIS ROOM ALREADY HAS ONCE.
     * `Paint.digit` and `Paint.number` have been written, complete and correct,
     * with zero callers since the file was made — and the reason is that they
     * were built for a marking rule 7 forbids. An insignia that nothing paints
     * is the same shape of failure with the opposite cause: the mark is right
     * and it is simply not in the room, which no palette check and no cost
     * check can see.
     *
     * The brief names deck insignia in the same breath as the ship classes, so
     * it is held the same way: it has to be THERE, and it has to be the army's.
     */
    const H = await import('../../src/game/Hangar.js');
    const K = await import('../../src/game/DeckKit.js');
    const rows = [];
    for (const f of K.FACTIONS) {
      const kit = new K.DeckBuild(f);
      const paint = new K.Paint(f);
      H.__deckParts.structure(kit, paint);
      const wall = [...kit.bins.keys()].some((m) => m.name === `deck-${f}-mark`);
      const deck = paint.byColor.has(K.FACTION_PALETTE[f].mark);
      assert(wall || deck,
        `a ${f} deck carries no insignia anywhere. \`Paint.insignia(x, z, size)\` lays the mark on `
        + 'the plate and `insigniaPanel(kit, x, y, z, size)` stands it on the bulkhead; both are '
        + 'exported from DeckKit.js and neither has a caller, which is exactly the state `digit` '
        + 'and `number` have been in since this file was written.');
      assert(wall,
        `a ${f} deck paints its mark on the floor but not on the bulkhead. The aft face is the one `
        + 'solid surface in the room and the only thing a player standing anywhere can read — '
        + 'call `insigniaPanel(kit, 0, y, bz + 3, size)`.');
      assert(deck,
        `a ${f} deck marks its bulkhead but not its plate. Rule 7's markings are the deck's, and `
        + 'the muster ground is what the player looks down at — call `paint.insignia(x, z, size)`.');
      rows.push(`${f}: deck + bulkhead`);
    }
    return rows.join(' · ');
  });

  /**
   * ══ AND THE ROOM THE PLAYER ACTUALLY WALKS INTO ═══════════════════════
   *
   * The check above holds `dressStructure` to whatever kit it is handed. This
   * one holds the SEAM: that the kit is made with the army whose men are about
   * to march in, not with a default. They fail separately because they are
   * separate mistakes and the fixes are in different lines.
   */
  const deck = async (army) => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'hangar',
      settings: { mode: 'hangar', level: 'hangar', allies: 0, army },
    });
    return world;
  };

  /** Whose materials are actually in a built scene, by the name they carry. */
  const armiesIn = (world) => {
    const found = new Map();
    const seen = new Set();
    world.scene.traverse((o) => {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        const hit = /^deck-(republic|separatist)-/.exec(String(m.name || ''));
        if (!hit) continue;
        if (!found.has(hit[1])) found.set(hit[1], []);
        found.get(hit[1]).push(m.name);
      }
    });
    return found;
  };

  for (const army of ['republic', 'separatist']) {
    check(`faction: a ${army} deck is a ${army} deck throughout`, async () => {
      const world = await deck(army);
      try {
        const found = armiesIn(world);
        assert(found.size > 0,
          'no deck material in the built room carries an army at all — `Hangar.dressStructure` is '
          + 'not going through `deckMats(faction)`, so nothing can say whose room this is');
        assert(found.size === 1,
          `the room mixes ${found.size} armies: `
          + [...found].map(([f, ms]) => `${f}(${ms.length}: ${ms.slice(0, 3).join(',')})`).join(' + ')
          + ' — "if the player sees one wrong-faction asset the whole illusion dies"');
        const [built, mats] = [...found][0];
        assert(built === army,
          `booted as ${army} and got a ${built} deck (${mats.length} materials). Hangar.js has to `
          + 'resolve the army ONCE at the top of `dressHangar` and pass it in:\n'
          + "        const faction = factionOf(world);   // from DeckKit.js\n"
          + '        const kit = new DeckBuild(faction);\n'
          + '        const paint = new Paint(faction);\n'
          + '      and `dressStructure` must take it too — its own `deckMats()` call and its\n'
          + '      `rackBay`/`shuttlePad`/`overheadRig` calls default to '
          + `'${'republic'}' otherwise.`);
        return `${mats.length} deck materials, all ${built}`;
      } finally { world.unload(); }
    });
  }
}
