/**
 * THE STATION, AND WHETHER IT IS FIFTY BOXES.
 *
 * `SHARK.md` §5.3 lists what may kill each step, and §13.3 is blunt about the
 * one that matters most: *"Rule 4 is measured, not felt. Run the
 * distinguishability check on every pair before calling a deck done; a pair
 * over 0.85 is a place to redesign, not a threshold to raise."*
 *
 * That instruction exists because the other repo shipped 128 places out of 16
 * builders and every gate it had was green — *"every gate measured coverage or
 * correctness, and both are perfectly satisfied by one generic thing repeated
 * seventy-eight times."* Coverage is not the question. VARIETY is, and it is
 * the only thing in this file that is hard to measure, which is why it is
 * measured here rather than asserted in a comment.
 *
 * What this file holds, in §5.3's own order:
 *
 *   · every place is reachable on foot from a lift, and every door is crossable
 *   · the floor is at `floorAt`'s height everywhere a body can stand
 *   · rule 4's pairwise silhouette distinguishability, every pair, on every deck
 *   · draws and triangles under §12.2's bounds
 *   · §9.1: no loader material, no `saberNoInk` inside a room, and every
 *     material in a place is one of the engine's own
 *   · §9.2: the switch is real, and no station file names a mode
 */

import { readdir, readFile } from 'node:fs/promises';

/* No `fetch` in node. The rooms are read off disk and handed to the same
 * decoder the browser uses, so the check measures the shipped path rather
 * than a second copy of it. Idempotent, and its own function because the
 * last check in this file empties the room cache and has to fill it again. */
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/**
 * The station, booted through the same door the game uses.
 *
 * `quality` IS A PARAMETER BECAUSE THE POOL IS A FUNCTION OF IT. `bootWorld`
 * defaults every headless world to `low`, which is right for a check about
 * geometry and wrong for one about POPULATION: §12.3 scales the live pool
 * 30/45/60/60 across the tiers, so a clause counting bodies on a `low` world
 * is measuring the smallest station the game ships and calling it the station.
 * `Menu.DEFAULT_SETTINGS.quality` is `high`, which is what a player gets
 * unless they say otherwise, and the clauses that count people say so.
 */
async function station(deck = 40, quality = null) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, ROOM_FILES } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, ...(quality ? { quality } : {}) },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return { world, idle: idleInput() };
}

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the plan is a plan — nothing overlaps, nothing is through the skin', async () => {
    const P = await import('../../src/game/StationPlan.js');
    const { PLACES, DRUM } = P;
    assert(PLACES.length >= 55, `the gazetteer has ${PLACES.length} places; §3.2 has 55`);

    /* The four world corners of a place: `w` tangential, `d` radial. */
    const corners = (p) => {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), hw = p.w / 2, hd = p.d / 2, out = [];
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
        out.push([p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
      }
      return out;
    };
    /* Separating-axis on two convex quads — an AXIS-ALIGNED box round a yawed
     * room reaches far past its corners, and the first version of this check
     * reported nine rooms through the skin that were not. */
    const overlap = (A, B, slack = 0.5) => {
      let least = Infinity;
      for (const poly of [A, B]) {
        for (let i = 0; i < 4; i++) {
          const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4];
          const len = Math.hypot(x1 - x0, z1 - z0) || 1;
          const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
          let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
          for (const [x, z] of A) { const d = x * nx + z * nz; if (d < a0) a0 = d; if (d > a1) a1 = d; }
          for (const [x, z] of B) { const d = x * nx + z * nz; if (d < b0) b0 = d; if (d > b1) b1 = d; }
          const gap = Math.min(a1, b1) - Math.max(a0, b0);
          if (gap < least) least = gap;
          if (gap <= slack) return 0;
        }
      }
      return least;
    };

    const byDeck = new Map();
    for (const p of PLACES) {
      if (p.external || p.band === 'ring' || !p.w) continue;
      if (!byDeck.has(p.deck)) byDeck.set(p.deck, []);
      byDeck.get(p.deck).push(p);
    }
    const bad = [];
    for (const [deck, ps] of byDeck) {
      const C = new Map(ps.map((p) => [p.id, corners(p)]));
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const o = overlap(C.get(ps[i].id), C.get(ps[j].id));
          if (o > 0) bad.push(`deck ${deck}: #${ps[i].id} × #${ps[j].id} by ${o.toFixed(1)} m`);
        }
      }
      for (const p of ps) {
        if (['deck32', 'deck12', 'tram', 'skin'].includes(p.band)) continue;
        let r = 0, rmin = Infinity;
        for (const [x, z] of C.get(p.id)) { const d = Math.hypot(x, z); if (d > r) r = d; if (d < rmin) rmin = d; }
        if (r > DRUM.R + 0.01) bad.push(`deck ${deck}: #${p.id} ${p.name} reaches r=${r.toFixed(1)} through the skin`);
        if (p.band !== 'atrium' && p.band !== 'hub' && rmin < DRUM.atrium - 0.01) {
          bad.push(`deck ${deck}: #${p.id} ${p.name} juts into the atrium at r=${rmin.toFixed(1)}`);
        }
      }
    }
    assert(bad.length === 0, `${bad.length} plan faults:\n      ${bad.slice(0, 8).join('\n      ')}`);

    /* Every place a resident can be housed in exists, and every kiosk names a
     * panel. A row pointing at a place that is not built is a resident with
     * nowhere to sleep. */
    const ids = new Set(PLACES.map((p) => p.id));
    for (const p of PLACES) {
      if (p.external) continue;
      assert(Number.isFinite(p.x) && Number.isFinite(p.z),
        `#${p.id} ${p.name} has no position — its band '${p.band}' has no case in layout()`);
      assert(p.door && p.door.length === 2 && Number.isFinite(p.door[0]),
        `#${p.id} ${p.name} has no door, and the cull and the walk both measure from one`);
    }
    assert(ids.size === PLACES.length, 'two places share an id');
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: every place has its own builder, and no two share a shape (rule 4)', async () => {
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const { SHAPES } = await import('../../src/game/StationKit.js');
    const seen = new Map();
    const missing = [];
    for (const p of PLACES) {
      if (p.external || p.room || p.band === 'ring') continue;
      if (!SHAPES[p.shape]) missing.push(`#${p.id} ${p.name} → '${p.shape}'`);
      if (seen.has(p.shape)) {
        assert(false, `rule 4: #${p.id} ${p.name} and #${seen.get(p.shape)} both declare shape '${p.shape}'`);
      }
      seen.set(p.shape, p.id);
    }
    assert(missing.length === 0, `${missing.length} places have no builder: ${missing.join(', ')}`);
    /**
     * AND THE BUILDERS ARE NOT ONE BUILDER WITH A PARAMETER. Every one of them
     * is a distinct function object — a table mapping fifty names onto the same
     * closure would satisfy the loop above exactly, and is precisely the "78 of
     * 128 places from one generic kit" this whole rule exists against.
     */
    const fns = new Set();
    for (const k of Object.keys(SHAPES)) fns.add(SHAPES[k]);
    assert(fns.size === Object.keys(SHAPES).length,
      `${Object.keys(SHAPES).length} shapes share only ${fns.size} distinct builders`);
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  for (const deck of [40, 44, 48]) {
    check(`station: deck ${deck} stands up, inside §12.2's bounds`, async () => {
      const { world } = await station(deck);
      try {
        const st = world._station;
        assert(st, 'no station was dressed');
        assert(st.deck === deck, `asked for deck ${deck} and got ${st.deck}`);
        assert(st.places.size > 0, `deck ${deck} built no places`);

        /* §12.2: 400 draw calls with the ink pass, 3 M triangles at 1080p.
         * This is the WHOLE deck with nothing culled, which is stricter than
         * the bound — the cull only ever takes draws away. */
        assert(st.draws <= 400,
          `deck ${deck} draws ${st.draws} meshes uncalled — §12.2's bound is 400`);
        assert(st.tris <= 3e6,
          `deck ${deck} submits ${Math.round(st.tris / 1000)} k triangles — §12.2's bound is 3 M`);
        assert(st.solids > 100,
          `deck ${deck} has only ${st.solids} colliders — a room you can walk out of the back of is not a room`);

        /* §11: everything in the rooms is a body. A deck with no props is a
         * deck you cannot pick anything up in, which is the whole ask. */
        assert(world.props.length > 20,
          `deck ${deck} has ${world.props.length} grabbable bodies — §11 wants the furniture throwable`);

        /* §12.2: physics bodies ≤ 1100, the same cap `RapierWorld` is built
         * with, and props asleep unless touched. */
        assert(world.props.length <= 1100,
          `deck ${deck} has ${world.props.length} physics bodies against a cap of 1100`);
      } finally { world.dispose?.(); }
    });
  }

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: §9.1 — it is all cel-shaded Borz, and no loader material survives', async () => {
    const { world } = await station(40);
    try {
      const bad = [], ink = [], names = new Set();
      for (const rec of world._station.places.values()) {
        rec.group.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m) continue;
            names.add(m.name || '(unnamed)');
            /**
             * A material with no name is the tell. `deckMats` names all eleven
             * of its own and `stationMats` names all nine — "NAMED, ALL OF
             * THEM", as DeckKit's own note puts it, because a merged room is
             * a set of anonymous Meshes to a traverse and there is nothing
             * else to read. A `MeshStandardMaterial` a loader made would
             * arrive here nameless.
             */
            if (!m.name) bad.push(`#${rec.place.id} ${rec.place.name}: an unnamed ${m.type}`);
            else if (!/^(deck|station|prop|kit)-/.test(m.name)) {
              bad.push(`#${rec.place.id} ${rec.place.name}: '${m.name}' is not one of the engine's own`);
            }
            /* §9.1: "saberNoInk is allowed only where the deck already allows
             * it … Inside a room, nothing." */
            if (m.userData?.saberNoInk) ink.push(`#${rec.place.id} ${rec.place.name}: '${m.name}' is uninked`);
          }
        });
      }
      assert(bad.length === 0,
        `${bad.length} materials in a room are not the engine's:\n      ${bad.slice(0, 6).join('\n      ')}`);
      assert(ink.length === 0,
        `${ink.length} uninked materials inside a room:\n      ${ink.slice(0, 6).join('\n      ')}`);
      assert(names.size >= 6,
        `the whole deck uses only ${names.size} materials — a room of one colour is a box with the lights on`);
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: rule 4 measured — no pair of places reads the same from its own door', async () => {
    const { world } = await station(40);
    try {
      /**
       * ══ THE INSTRUMENT ══════════════════════════════════════════════════
       *
       * §3.1 rule 4 asks for "pairwise silhouette distinguishability of every
       * place from its own door (the IoU instrument `characters.mjs` uses on
       * bodies)". A body's silhouette is a rendered alpha; a room's is what
       * the geometry OCCUPIES from where you stand in the doorway, so this
       * projects every vertex of a place's meshes into the camera at its door
       * and fills a 64 × 40 occupancy raster. IoU over two rasters is the
       * same number `characters.mjs` computes, over the same range, and it
       * needs no GPU — which matters, because §12.4 says there isn't one.
       *
       * A pair over 0.85 is a PLACE TO REDESIGN. §13.3 says so in as many
       * words, and raising this number is the one response that is not
       * available.
       */
      /* THE RASTER ITSELF LIVES IN `_raster.mjs`, because the walkway rule
       * below measures the SAME question about different geometry and two
       * rasters would be two answers — a threshold tuned on one instrument
       * says nothing about a number read off the other. What stays here is
       * where a place's camera stands, which is what rule 4 actually
       * specifies: in its own door, looking at its centre.
       *
       * ── WHY IT STANDS BACK, AND THROUGH A WIDE LENS ────────────────────
       *
       * Both numbers were found by the instrument reporting seven rooms as
       * empty that are not. A camera exactly ON the doorway of a room that is
       * wide and shallow — the quartermaster's cage is 13 m across and 9 deep
       * — has half the room behind its own eye and the rest past 36° off
       * axis, so a 60° lens sees nothing at all. That is a fact about the
       * lens, not about the room, and an instrument that reports it as a fact
       * about the room is worse than none: it is §2.3b's check that cannot
       * fail, inverted into one that cannot pass.
       *
       * The stand-off is the distance at which the width subtends the frame,
       * which is what a person does before looking into a room. The DIRECTION
       * is still the door's. */
      const { rasterView, iou, W, H } = await import('./_raster.mjs');
      const raster = (rec) => {
        const p = rec.place;
        const fx0 = p.x - p.door[0], fz0 = p.z - p.door[1];
        const flen = Math.hypot(fx0, fz0) || 1;
        const dx = fx0 / flen, dz = fz0 / flen;
        const back = Math.max(1.5, p.w / 2 / Math.tan(Math.PI / 4) - p.d / 2);
        return rasterView(THREE, {
          objects: rec.group,
          eye: { x: p.door[0] - dx * back, y: rec.__y + 1.7, z: p.door[1] - dz * back },
          dir: { x: dx, z: dz },
        }).bits;
      };

      const { DECK_Y } = await import('../../src/game/StationPlan.js');
      const recs = [];
      for (const rec of world._station.places.values()) {
        if (rec.place.band === 'ring') continue;
        rec.__y = DECK_Y[rec.place.deck] ?? 0;
        const bits = raster(rec);
        let on = 0;
        for (let i = 0; i < bits.length; i++) on += bits[i];
        /**
         * A room that fills NOTHING from its own door is a room the player
         * walks into and sees empty space, which fails rule 4's spirit before
         * its arithmetic. It is also how a silent build failure looks.
         */
        assert(on > 40,
          `#${rec.place.id} ${rec.place.name} fills ${on} of ${W * H} cells from its own door — there is nothing there`);
        recs.push({ place: rec.place, bits, on });
      }

      let worst = 0, worstPair = '';
      const over = [];
      for (let i = 0; i < recs.length; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          const v = iou(recs[i].bits, recs[j].bits);
          if (v > worst) { worst = v; worstPair = `#${recs[i].place.id} ${recs[i].place.name} × #${recs[j].place.id} ${recs[j].place.name}`; }
          if (v > 0.85) over.push(`${v.toFixed(3)}  #${recs[i].place.id} ${recs[i].place.name} × #${recs[j].place.id} ${recs[j].place.name}`);
        }
      }
      assert(over.length === 0,
        `${over.length} pairs read the same from their own doors (over 0.85):\n      ${over.slice(0, 6).join('\n      ')}`);
      assert(worst < 0.85,
        `worst pair ${worst.toFixed(3)} — ${worstPair}`);
      /* And printed, because §13.3 wants the number looked at rather than
       * merely satisfied. */
      console.log(`      rule 4: ${recs.length} places on deck 40, worst pair ${worst.toFixed(3)} (${worstPair})`);
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ THE WALKWAYS, HELD TO RULE 4'S OWN NUMBER ═══════════════════════════
   *
   * Rule 4 measures the twenty places on a deck and says nothing whatever
   * about the space between them — which is most of the station and all of
   * the walking. The player's whole criticism was about that space:
   *
   *   *"the station really should not read as a series of connected rooms …
   *    it should feel like a place at large, the in-between places, the
   *    walkways, the transports … it can't just be an elevator selecting a
   *    level and that's the room."*
   *
   * `tools/_walkprobe.mjs` stood forty points on each deck's walkways — twenty
   * on the ring, three up each of the four spines, eight on the atrium rim,
   * one at each tram platform — and ran RULE 4'S OWN RASTER down them in both
   * directions. He was right, and by a distance:
   *
   *      deck 40 ring    worst pair 1.000    60 of 780 pairs over 0.85
   *      deck 44 ring    worst pair 1.000    57 of 780
   *      deck 40 spines  worst pair 1.000    26 of 276
   *      deck 40 rim     worst pair 1.000     9 of 120
   *
   * 1.000 is the same picture, cell for cell. `buildRing` was a 72-step loop
   * whose only variation was `i % 2`, `buildSpines` built one corridor four
   * times, the balcony rail was 64 identical slabs, and NOTHING in the whole
   * between-space took a bearing as an input — so the drum's own rotational
   * symmetry landed samples 90° and 180° apart on identical geometry.
   *
   * The fix is `StationPlan.WAYS`, `JUNCTIONS` and their sectors, built by
   * `StationKit.FIXTURES`. This is what holds it: the SHELL ALONE — no crowd,
   * no rooms behind it, just the corridor a person is standing in — measured
   * against 0.85, which is rule 4's number and not a softer one invented for
   * the easier case. Measured after the fix: 0.766 / 0.793 / 0.745.
   *
   * THE CROWD IS EXCLUDED ON PURPOSE. Sixty bodies seeded at random seats
   * decorrelate any two views on their own; with them in, the corridor scored
   * 0.674 while it was still literally copy-pasted. A check that measures the
   * people cannot see the architecture.
   */
  check('station: rule 4 on the WALKWAYS — no two stretches of the between-space read the same', async () => {
    const { rasterView, iou, walkPoints, W, H } = await import('./_raster.mjs');
    const { DRUM, DECK_Y, PLACES, waysOn, junctionsOn } = await import('../../src/game/StationPlan.js');
    const { FIXTURES } = await import('../../src/game/StationKit.js');

    /* First, the same anti-generic rule `SHAPES` is held to: ten named kinds
     * must be ten distinct function objects, or the table is one builder with
     * a parameter and the variety is a lie the loop above cannot see. */
    const kinds = Object.keys(FIXTURES);
    const fns = new Set(kinds.map((k) => FIXTURES[k]));
    assert(fns.size === kinds.length,
      `${kinds.length} fixture kinds share only ${fns.size} distinct builders`);

    const lines = [];
    for (const deck of [40, 44, 48]) {
      const { world } = await station(deck);
      try {
        const st = world._station;
        const y = DECK_Y[deck];
        /* THE SHELL IS THE BETWEEN-SPACE. `dressStation` keeps its merged
         * meshes on `st.shell` for exactly this: a traverse of the scene
         * cannot tell the drum from a crate, both being children of the root. */
        assert(st.shell?.length, `deck ${deck} kept no shell meshes to measure`);
        const pts = walkPoints(deck, DRUM, PLACES);
        assert(pts.length >= 36, `only ${pts.length} standing points on deck ${deck}`);

        const views = [];
        for (const p of pts) {
          for (const sgn of [1, -1]) {
            const r = rasterView(THREE, {
              objects: st.shell,
              eye: { x: p.x, y: y + 1.7, z: p.z },
              dir: { x: p.dx * sgn, z: p.dz * sgn },
              /* Beyond the cull radius (§12.3) nothing is drawn anyway. */
              far: 70,
            });
            views.push({ tag: `${p.tag}${sgn > 0 ? '+' : '-'}`, ...r });
          }
        }

        /* A view of NOTHING is how a silent build failure looks, and it would
         * also score 0 against everything and pass the pairwise test. */
        const empty = views.filter((v) => v.on < 30);
        assert(empty.length === 0,
          `deck ${deck}: ${empty.length} walkway views are empty — ${empty.slice(0, 4).map((v) => v.tag).join(', ')}`);

        let worst = 0, worstPair = '';
        const over = [];
        for (let i = 0; i < views.length; i++) {
          for (let j = i + 1; j < views.length; j++) {
            const v = iou(views[i].bits, views[j].bits);
            if (v > worst) { worst = v; worstPair = `${views[i].tag} × ${views[j].tag}`; }
            if (v > 0.85) over.push(`${v.toFixed(3)}  ${views[i].tag} × ${views[j].tag}`);
          }
        }
        assert(over.length === 0,
          `deck ${deck}: ${over.length} stretches of walkway read the same (over 0.85):\n      `
          + over.slice(0, 6).join('\n      '));

        /* AND IT HAS SOMETHING IN IT. A corridor can be un-repetitive and
         * still be four bare surfaces; before the fix every one of deck 40's
         * eighty views showed four materials or fewer, because the whole
         * between-space was four merged meshes. */
        const mats = views.map((v) => v.mats).sort((a, b) => a - b);
        const median = mats[mats.length >> 1];
        assert(median >= 6,
          `deck ${deck}: the median walkway view shows only ${median} materials — a tube with the lights on`);

        /* AND IT IS ADDRESSED. The fixtures and the junctions are the data
         * that makes the ring a street; a deck that lost them would still
         * pass the pairwise test on its rooms alone. */
        const ways = waysOn(deck), js = junctionsOn(deck);
        assert(ways.length >= 12, `deck ${deck} has only ${ways.length} walkway fixtures`);
        assert(js.length === 4, `deck ${deck} has ${js.length} junctions, not 4`);
        assert(st.ways?.length >= 12, `deck ${deck} built only ${st.ways?.length} of them`);
        assert(st.wayfinding?.length >= 12,
          `deck ${deck} hung only ${st.wayfinding?.length || 0} wayfinding panels — a junction with no sign is a corner`);

        /* AND NOTHING STANDS IN A DOORWAY. A fixture placed by bearing can be
         * put in front of a place's door by a typo, and the walk would still
         * pass every other check in this file. */
        const clash = [];
        for (const w of ways) {
          if (w.band === 'spine' || w.band === 'rim') continue;
          for (const p of PLACES) {
            if (p.deck !== deck || p.external || !p.door || p.band === 'ring') continue;
            /* The Promenade IS the ring (§3.2 #26): it has no door arc to block. */
            const dr = Math.hypot(p.door[0], p.door[1]);
            if (dr < 79) continue;                       // does not open on the ring
            const pa = Math.atan2(p.door[0], p.door[1]) * 180 / Math.PI;
            let gap = Math.abs(((w.at - pa + 540) % 360) - 180);
            const half = Math.atan2(p.w / 2, Math.hypot(p.x, p.z) || 1) * 180 / Math.PI;
            if (gap < half + (w.span || 4) / 2) clash.push(`${w.name} at ${w.at}° is in the door of #${p.id} ${p.name}`);
          }
        }
        assert(clash.length === 0, `${clash.length} fixtures block a door:\n      ${clash.slice(0, 5).join('\n      ')}`);

        lines.push(`      walkways: deck ${deck}, ${views.length} views, worst pair `
          + `${worst.toFixed(3)} (${worstPair}), median ${median} materials`);
      } finally { world.dispose?.(); }
    }
    /* Printed, for the same reason rule 4's is: §13.3 wants the number looked
     * at rather than merely satisfied. */
    for (const l of lines) console.log(l);
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the walkways carry people, not just the rooms', async () => {
    /**
     * `reseat` walked `st.places` and nothing else, and `dressStation` skips
     * the ring band — so before `wayPlacesOn` the corridors of this station
     * held zero people at every hour of every day on every deck, which is the
     * literal form of *"a series of connected rooms"*.
     */
    const { wayPlacesOn, headcount } = await import('../../src/game/StationLife.js');
    for (const deck of [40, 44, 48]) {
      const ways = wayPlacesOn(deck);
      assert(ways.length >= 30, `deck ${deck} has only ${ways.length} walkway stations`);
      /* At the deck's busiest, and at its quietest. A corridor that is full at
       * noon and dead at 03:00 is right; one that is dead at noon is not. */
      let busy = 0, quiet = 0;
      for (const p of ways) { busy += headcount(p, 13); quiet += headcount(p, 3); }
      assert(busy >= 40, `deck ${deck}: only ${busy} people on the walkways at 13:00`);
      assert(quiet >= 5, `deck ${deck}: ${quiet} people on the walkways at 03:00 — a dead station`);
      assert(quiet < busy, `deck ${deck}: the walkways are as full at 03:00 as at 13:00`);
      /* And they are not the gazetteer's. §3.2's rule is that a place not in
       * the table is not built, and these are not places. */
      const { PLACE } = await import('../../src/game/StationPlan.js');
      for (const p of ways) assert(!PLACE.has(p.id), `way station ${p.id} collides with a gazetteer id`);
    }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the people in the corridors are going somewhere', async () => {
    /**
     * §2.5's THIRD standing rule: *"in between places, the walkways … a real
     * shmorgesborg of activity"*, and the design note under it — *"People are
     * going somewhere … along desire lines between them."*
     *
     * ── WHAT WAS MEASURED, AND IT IS TWO DEFECTS ─────────────────────────
     *
     * Deck 40 at 13:00, twenty seconds of `world.update`, both quality tiers:
     *
     *     low   30 bodies — 15 in rooms, 15 on walkways,  4 on open stretches
     *     high  46 bodies — 28 in rooms, 18 on walkways,  4 on open stretches
     *
     * FORTY-FOUR WALK SLOTS DECLARED AND FOUR EVER ALIVE, on either setting,
     * because eight stretches at 45° put a 14 m patch of people every 67 m of
     * a 537 m ring and the pool only makes a body real inside 40 m. And the
     * four then advanced A BEARING AT A FIXED RADIUS — the walker's own comment
     * said "no pathfinding" — which is a circular pace: sixty seconds of
     * walking returned a body to where sixty seconds of walking started.
     *
     * ── SO IT IS FOUR ASSERTIONS AND NOT ONE ─────────────────────────────
     *
     * THE STRETCHES ARE FULL, against what the deck itself declares within the
     * radius the pool builds bodies in — a bar derived from the gazetteer
     * rather than typed, so widening a stretch cannot make this easier to
     * pass.
     *
     * THE WALK IS A JOURNEY AND NOT A LAP, which is NET displacement against
     * PATH LENGTH. A lap has a path of eighty metres and a net of nothing; the
     * ratio is the thing a circular pace cannot fake, and no bar on distance
     * alone can catch it.
     *
     * SOMEBODY ARRIVES. A destination that is never reached is a heading, so
     * the trips counter is read directly.
     *
     * AND THE BENCHES ARE STILL OCCUPIED. Everything else on a walkway is
     * somebody who has stopped on purpose — at a counter, on a bench, at the
     * rail, waiting at a crossing — and a fix that set every body walking would
     * pass the first three and delete the fixtures.
     */
    diskFetch();
    /* THE TIER A PLAYER ACTUALLY GETS — see `station()`: the pool is 30 at
     * `low` and 60 at `high`, and this clause counts bodies. */
    const { world, idle } = await station(40, 'high');
    try {
      const life = world._stationLife;
      /**
       * STAND ON THE RING, and that is not a convenience. The station seats
       * bodies within a drop radius of the PLAYER, and the lift lobby a world
       * boots at has fixtures near it — an overlook, a shrine, a stairhead —
       * and no open stretch inside the radius at all. Booting and looking
       * measured `{overlook: 2, room: 25, shrine: 2, stairhead: 1}` and zero
       * walkers, which says nothing about whether walkers walk.
       *
       * So the player is put where the walking is, on the first open stretch
       * the deck declares, and the world is given a moment to seat it.
       */
      const { wayPlacesOn, headcount, slotIn, LIVE_RADIUS, primeStationLife } =
        await import('../../src/game/StationLife.js');
      /* AT MIDDAY. Everything below is counted against what the deck DECLARES
       * at an hour, and the declaration is a curve over the day — so the hour
       * is named rather than left to whatever the boot happened to set. */
      world._station.hour = 13;
      const ways = wayPlacesOn(40);
      const open = ways.find((p) => p.way === 'walk');
      assert(open, 'deck 40 declares no open walking stretch at all');
      world.player.position.set(open.x, world.player.position.y, open.z);
      world.player.body?.setTransform?.(world.player.position, null);
      /**
       * AND THE POOL IS RE-SEATED WHERE HE IS NOW, THROUGH THE GAME'S OWN
       * DOOR. Every re-seat after the prime builds ONE body — a trickle of two
       * a second, which is a room populating just ahead of a walk and is right
       * — so a player teleported across the deck stands in a half-empty
       * corridor for half a minute and a check that measured there would be
       * measuring the trickle. `primeStationLife` is the slice `dressStation`
       * queues and `Station.finishStationBuild` drains in one go for a
       * screenshot; this is that same call, which is why it is not a poke at
       * private state.
       */
      life.priming = true;
      for (let i = 0; i < 60 && primeStationLife(world); i++) { /* fill it */ }
      for (let i = 0; i < 600; i++) world.update(1 / 60, idle);

      /* ── HOW MANY THE DECK DECLARES WITHIN REACH, AND HOW MANY ARE REAL ──
       *
       * The denominator is the gazetteer's own: every slot of every open
       * stretch whose SEAT — `slotIn`, the same function `reseat` places a
       * body with, imported rather than re-derived — falls inside the radius
       * the pool builds inside. Nothing here is a typed number, so the day a
       * stretch is widened or a head added the bar moves with it.
       */
      const V = new THREE.Vector3();
      const px = world.player.position.x, pz = world.player.position.z;
      let declared = 0;
      for (const p of ways) {
        if (p.way !== 'walk') continue;
        const n = headcount(p, world._station.hour);
        for (let i = 0; i < n; i++) {
          slotIn(p, i, V);
          if (Math.hypot(V.x - px, V.z - pz) <= LIVE_RADIUS) declared++;
        }
      }
      assert(declared >= 6,
        `deck 40 declares only ${declared} open-walk slots within ${LIVE_RADIUS} m of a stretch — `
        + 'the ring is a 537 m circle and the pool can only ever build what is in reach');
      let alive = 0;
      for (const [, b] of life.live) if (b.stationWay === 'walk') alive++;
      /* HALF, and the number is a fraction of the declaration rather than a
       * count: the pool is a BUDGET spent nearest-first, so a deck whose rooms
       * are full at this hour will always spend some of it on rooms. What is
       * being held is that the corridor gets most of what it asks for, not
       * that it gets all of it. Measured before the fix: 4 of 22. */
      assert(alive >= Math.ceil(declared * 0.5),
        `${alive} of the ${declared} open-walk slots inside the live radius are real bodies — `
        + 'the walkways are declared full and built empty');

      /* KEYED ON THE BODY AND NOT ON THE SLOT. `reseat` recycles a slot key —
       * a body can be dropped and a different one spawned into `p:i` inside
       * the window — and comparing those two is measuring a respawn and
       * calling it a walk. The first cut did that and read 5.92 m of
       * "movement" out of people standing at a counter. */
      const seen = new Map();
      for (const [, b] of life.live) {
        seen.set(b, {
          x: b.position.x, z: b.position.z, lx: b.position.x, lz: b.position.z,
          path: 0, net: 0, jPath: 0, jx: b.position.x, jz: b.position.z, legs: [],
          trips: b.wayTrips | 0, trips2: b.wayTrips | 0,
          way: b.stationWay || null, gone: false,
        });
      }
      assert(seen.size >= 6, `only ${seen.size} residents were up to watch`);

      /**
       * ══ SIXTY SIMULATED SECONDS, AND EACH BODY IS FROZEN WHERE IT LEFT ═══
       *
       * The audit's window, and the PATH is accumulated a frame at a time
       * because that is the only way to have a denominator for the ratio.
       *
       * A WALKER DOES NOT LAST THE WHOLE MINUTE, AND THAT IS THE FIX WORKING.
       * A body is real inside 40 m and dropped at 52; a walk is 1.35 m/s; so a
       * walker that sets off away from the player is culled somewhere around
       * forty seconds in and a fresh one is seated in the slot it left — the
       * corridor is a FLOW. Measured with the first cut of this loop, which
       * read `life.live` at the end: **0 of 5 walkers survived the minute**,
       * and the check would have concluded that nobody walked at all.
       *
       * So each body's numbers are frozen at the frame it leaves the pool. The
       * distance it covered before it went is a real distance it covered; what
       * would not be real is sampling `position` on a disposed body, and that
       * is exactly what the freeze stops.
       */
      for (let i = 0; i < 3600; i++) {
        world.update(1 / 60, idle);
        for (const [b, a] of seen) {
          if (a.gone) continue;
          if (b.disposed || b.alive === false) { a.gone = true; continue; }
          const step = Math.hypot(b.position.x - a.lx, b.position.z - a.lz);
          a.path += step;
          a.jPath += step;
          a.lx = b.position.x; a.lz = b.position.z;
          a.net = Math.hypot(b.position.x - a.x, b.position.z - a.z);
          /* AND WHEN IT ARRIVES, THE JOURNEY IS CLOSED AND MEASURED. The trip
           * counter goes up on the frame the last leg runs out, and the body
           * is standing on the destination at that moment — so this is the
           * displacement from where it set off to where it got to, against the
           * ground it covered doing it. */
          const t = b.wayTrips | 0;
          if (t > a.trips2) {
            a.legs.push({ net: Math.hypot(b.position.x - a.jx, b.position.z - a.jz), path: a.jPath });
            a.trips2 = t;
            a.jx = b.position.x; a.jz = b.position.z; a.jPath = 0;
          }
        }
      }
      const walk = [], stopped = [], journeys = [];
      let arrivals = 0;
      for (const [, a] of seen) {
        if (a.way === 'walk') {
          walk.push({ net: a.net, path: a.path });
          arrivals += (a.trips2 | 0) - a.trips;
          for (const j of a.legs) journeys.push(j);
        } else stopped.push(a.path);
      }
      assert(walk.length >= 2,
        `only ${walk.length} bodies were on the open stretches — nothing was measured`);
      const median = (v) => { const q = v.slice().sort((x, y) => x - y); return q[q.length >> 1]; };
      const m = median(walk.map((r) => r.net));
      const pathM = median(walk.map((r) => r.path));
      /* A MINUTE AT A WALK IS TENS OF METRES OF GROUND COVERED. The pace is
       * 1.35 m/s, so a minute is about eighty; the bar is set at a bit over a
       * third of that, so a body that spent part of the window standing at a
       * door it had reached still counts. Measured before the fix: 3.02 m. */
      assert(pathM >= 30,
        `the open walkways covered a median of ${pathM.toFixed(2)} m in sixty seconds — the ring `
        + 'is 537 m round, and this is a shuffle on the spot rather than a walk');
      /**
       * ── SOMEBODY GOT SOMEWHERE, AND THE JOURNEY IS THE UNIT ────────────
       *
       * THIS IS THE CLAUSE THE OLD WALKER FAILS. It advanced a bearing at a
       * fixed radius with no destination at all — its own comment said "no
       * pathfinding" — so it has no journeys to measure and cannot produce an
       * arrival however far it walks.
       *
       * AND NET-AGAINST-PATH IS MEASURED OVER A JOURNEY RATHER THAN OVER THE
       * MINUTE, because the minute is the wrong unit and the numbers say so.
       * Measured on the fixed walker, deck 40 at 13:00: 57.9 m of path, 9.1 m
       * of net, **0.16** — which looks exactly like a lap and is in fact THREE
       * COMPLETED CROSSINGS, out and back and out again, which is what a
       * concourse looks like. Per journey the same walkers read 0.9 and up.
       * The minute-long ratio cannot tell a body going nowhere from a body
       * going somewhere three times, and the old walker scored 0.96 on it —
       * a chord, because 81 m of an 537 m ring is barely a radian.
       */
      assert(arrivals >= 1,
        `${walk.length} people walked for a minute and none of them arrived anywhere`);
      assert(journeys.length >= 1, 'no journey was closed to measure');
      const jNet = median(journeys.map((j) => j.net));
      const jStraight = median(journeys.map((j) => (j.path > 0 ? j.net / j.path : 0)));
      assert(jNet >= 8,
        `a journey ended a median of ${jNet.toFixed(1)} m from where it started — that is a step, `
        + 'not a crossing between two places');
      assert(jStraight >= 0.5,
        `a journey covered ${(1 / Math.max(jStraight, 1e-6)).toFixed(1)} m of path for every metre `
        + 'it actually got — the route is wandering rather than going somewhere');
      const straight = pathM > 0 ? m / pathM : 0;
      /**
       * ── SOMEWHERE TO BE GOING, AND IT IS A PLACE THAT EXISTS ───────────
       *
       * The old walker had no destination field at all, so this fails on it by
       * construction rather than by a threshold.
       */
      const { PLACE: TABLE } = await import('../../src/game/StationPlan.js');
      /* A DESTINATION IS A PLACE THAT EXISTS, and there are two tables it can
       * be in: the gazetteer, and this deck's own walkway — the stalls, the
       * kiosks, the benches and the crossings `wayPlacesOn` declares, which is
       * where somebody crossing a concourse is usually crossing it to. An
       * OPEN STRETCH is not one of them: that is the corridor itself, and a
       * walker whose errand was a patch of floor is the pace this clause
       * exists to catch. */
      const stops = new Set();
      for (const p of ways) if (p.way !== 'walk') stops.add(p.id);
      const lost = [];
      let onFoot = 0;
      for (const [, b] of life.live) {
        if (b.stationWay !== 'walk' || !b.wayR) continue;
        onFoot++;
        if (!b.wayTo || !(TABLE.has(b.wayTo) || stops.has(b.wayTo))) lost.push(b.stationName || '?');
      }
      assert(lost.length === 0,
        `${lost.length} of ${onFoot} people on the open stretches are not going anywhere `
        + `(${lost.slice(0, 4).join(', ')}) — a walk with no destination is a pace`);
      /**
       * ── AND THE BENCHES ARE STILL OCCUPIED BY PEOPLE SITTING ON THEM ───
       *
       * A fix that set EVERY body walking would pass everything above and
       * delete the fixtures. It is a RATIO rather than an absolute because the
       * fixtures have never been perfectly still and this clause is not the
       * place to assert that they are; the ground COVERED is the fair
       * comparison, since a body that shuffles on the spot covers ground
       * without going anywhere.
       */
      if (stopped.length) {
        const sm = median(stopped);
        assert(pathM > sm * 3 + 1,
          `the open stretches covered ${pathM.toFixed(1)} m and the people who stopped somewhere on `
          + `purpose covered ${sm.toFixed(1)} m — the counters, the benches and the rails have been `
          + 'emptied into the corridor');
      }
      /**
       * ══ AND NOBODY IS INSIDE A ROOM THEY DID NOT WALK INTO ═════════════
       *
       * ── THE OLD GUARD HERE ASSERTED THE DEFECT ─────────────────────────
       *
       * It asserted `|hypot(x, z) - wayR| <= 0.05` — "0 walkers left the ring
       * they were walking" — and staying exactly on that circle is PRECISELY
       * what carried them through the rooms. The eight ring stretches sat on a
       * clear annulus, but the spine stretches sat mid-band, and a fifth of
       * that circle is inside a room footprint. Measured live over 240 samples:
       * a walker was inside #13 The Databank on 53 of them, #9 on 42, the
       * Cantina on 15. #13 walls all but 0.42 rad of itself, so that was a body
       * walking through a wall.
       *
       * So the property is THE ONE THE PLAYER WOULD SEE, and it survives the
       * route becoming a real route: whatever polyline `planRoute` emits, no
       * body may be standing inside a room's footprint. Tested against the same
       * yawed rectangles `the plan is a plan` uses, over a whole minute rather
       * than at the end of it.
       */
      const { PLACES: ALL, DRUM: D } = await import('../../src/game/StationPlan.js');
      /**
       * A ROOM THE RING PASSES THROUGH IS NOT A ROOM YOU WALKED INTO.
       *
       * `#9 The Concourse` is 67.4 m deep and reaches r = 86.4 — it CROSSES
       * the ring corridor at 85.5, which is what makes it the hall the station
       * opens into rather than a room off it. A body on the ring walk at that
       * bearing is inside its footprint by construction and is standing in the
       * Concourse, which is where the Concourse is.
       *
       * So the rooms tested are the ones the ring does NOT run through, which
       * is derived off `rIn`/`rOut` — the radial extent `layout()` itself
       * assigns — rather than named. #13, #14 and #17 all fail that test and
       * are still caught; the day another hall is dug out to the skin it drops
       * out of the list on its own arithmetic.
       */
      const rooms = ALL.filter((p) => p.deck === 40 && !p.external && p.band !== 'ring' && p.w
        && !(p.rIn <= D.ringR && p.rOut >= D.ringR));
      /* THE INVERSE OF `corners()`'s OWN TRANSFORM, and it has to be exactly
       * that: `corners` places a local point at `(x + lx*c + lz*s, z - lx*s +
       * lz*c)`, so recovering the local one is `lx = dx*c - dz*s`, `lz = dx*s
       * + dz*c`. A sign wrong here reports a body in a room it is nowhere
       * near, which is the first thing this clause did. */
      const inside = (p, x, z) => {
        const dx = x - p.x, dz = z - p.z;
        const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
        return Math.abs(dx * c - dz * sn) <= p.w / 2 && Math.abs(dx * sn + dz * c) <= p.d / 2;
      };
      const trespass = new Map();
      /* AND ON THE LEG IT SAYS IT IS ON. The cheap half, and it is worth
       * keeping beside the expensive one for a reason the old version did not
       * have: a route is now a POLYLINE, so "where should this body be" has an
       * exact answer — the point at `wayT` along leg `wayAt` — and a walker
       * that has drifted off its own plan is a walker whose position is coming
       * from somewhere other than the route. It is a check on the arithmetic
       * and NOT on the geometry; the trespass loop above is the geometry. */
      let strayed = 0;
      for (let f = 0; f < 600; f++) {
        world.update(1 / 60, idle);
        for (const [, b] of life.live) {
          if (!b.wayR) continue;
          for (const p of rooms) {
            if (!inside(p, b.position.x, b.position.z)) continue;
            trespass.set(p.id, (trespass.get(p.id) | 0) + 1);
          }
          const L = b.wayLegs ? b.wayLegs[b.wayAt] : null;
          if (!L) continue;
          const r = Math.hypot(b.position.x, b.position.z);
          const a = Math.atan2(b.position.x, b.position.z);
          const off = L.arc
            ? Math.abs(r - L.r)
            : Math.abs(((a - L.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * r;
          if (off > 0.05) strayed++;
        }
      }
      assert(trespass.size === 0,
        `a corridor walker was inside ${[...trespass].map(([id, n]) => `#${id} on ${n} samples`).join(', ')}`
        + ' — the between-space walks through the rooms');
      assert(strayed === 0, `${strayed} walker samples were off the leg the route says they are on`);
      return `${alive}/${declared} declared walk slots alive; ${walk.length} walkers covered a `
        + `median ${pathM.toFixed(1)} m in the minute and ARRIVED ${arrivals} times; `
        + `${journeys.length} journeys, median ${jNet.toFixed(1)} m end to end at `
        + `${jStraight.toFixed(2)} of their own path (${straight.toFixed(2)} over the whole `
        + `minute, which is three crossings); ${stopped.length} who stopped somewhere covered `
        + `${stopped.length ? median(stopped).toFixed(1) : '0'} m; 0 trespasses`;
    } finally { world.unload(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the lift doors open on a station with people moving in it', async () => {
    /**
     * ══ THE CLAUSE ABOVE CANNOT SEE THE DEFECT, AND SAYS SO IN ITS OWN NOTE ══
     *
     * It TELEPORTS the player onto the first open walk stretch the deck
     * declares and then FORCE-PRIMES the pool, and its comment admits why:
     * booting and looking measured *"zero walkers, which says nothing about
     * whether walkers walk"*. It says a great deal about what the player sees.
     *
     * MEASURED at `STATION_LEVEL.start` — the spot every player on this station
     * arrives at, where the lift doors open — booting, not moving, not priming,
     * and running frames the way the game runs them:
     *
     *     deck  hour  bodies  moved  ground   walkers  nearest walk slot
     *       40  08:00     20      0     0.0 m       0            48.6 m
     *       40  13:00     31      0     0.0 m       0            44.6 m
     *       40  22:00     21      0     0.0 m       0            48.6 m
     *
     * Thirty-one live bodies and not one of them moved a millimetre in sixty
     * seconds, at every hour of the day, because `World.pickTarget` stopped
     * residents walking at the player and only `stepWalkers` was ever given a
     * budget of motion — and because the nearest slot on any open stretch the
     * deck declared was outside `LIVE_RADIUS`, so no walker could be built
     * there however long you stood.
     *
     * ── SO THIS CLAUSE IS THE PLAYER'S OWN VIEW AND NOTHING ELSE ─────────
     *
     * It does not move him, it does not prime the pool, and it reads the same
     * three numbers a person standing in the lobby would: how many people are
     * there, how many of them are doing anything, and how much ground the
     * room covers between them. The clause above keeps the harder property —
     * that a walker completes a JOURNEY — and needs its teleport to isolate
     * it; this one is the one that would have caught the statues.
     *
     * THREE HOURS AND THREE WORLDS. `fullness` is a curve over the day and the
     * midday roll is the one that emptied the corridor, so the hour is a
     * parameter and each is booted fresh — winding the clock on a live world
     * measures the pool's re-seat trickle catching up rather than the station
     * at that hour.
     */
    diskFetch();
    const { STATION_LEVEL } = await import('../../src/game/Station.js');
    const { wayPlacesOn, headcount, slotIn, LIVE_RADIUS } =
      await import('../../src/game/StationLife.js');
    const [sx, sz] = STATION_LEVEL.start;
    const V0 = new THREE.Vector3();
    const said = [];
    for (const hour of [8, 13, 22]) {
      const { world, idle } = await station(40, 'high');
      try {
        const life = world._stationLife;
        /* WHERE THE LIFT PUT HIM, ASSERTED RATHER THAN ARRANGED. If the boot
         * ever stops leaving the player on the level's own start, this clause
         * has to know — measuring a spot nobody arrives at is the failure it
         * exists to end. */
        const p = world.player.position;
        assert(Math.hypot(p.x - sx, p.z - sz) < 3,
          `the world booted the player at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) and `
          + `STATION_LEVEL.start is (${sx}, ${sz}) — this clause is not standing where a player does`);
        world._station.hour = hour;

        /* ── AND THE GEOMETRY HAS TO ALLOW IT AT ALL ─────────────────────
         *
         * Derived off `slotIn` and `headcount` — the same two functions
         * `reseat` seats a body with — rather than typed, so the day a
         * stretch moves the bar moves with it. Measured before the balcony
         * stretches existed: 44.6 m, against a live radius of 40. */
        let nearest = Infinity;
        for (const w of wayPlacesOn(40)) {
          if (w.way !== 'walk') continue;
          const n = headcount(w, hour);
          for (let i = 0; i < n; i++) {
            slotIn(w, i, V0);
            nearest = Math.min(nearest, Math.hypot(V0.x - sx, V0.z - sz));
          }
        }
        assert(nearest < LIVE_RADIUS,
          `at ${hour}:00 the nearest slot on any open walking stretch is ${nearest.toFixed(1)} m `
          + `from where the lift puts the player and the pool only builds inside ${LIVE_RADIUS} m — `
          + 'no walker can ever be seated in the lobby, however long anybody stands in it');

        /* THE POOL FILLS THE WAY THE GAME FILLS IT: frames, and the prime
         * slices `dressStation` already queued. No `primeStationLife` here. */
        for (let i = 0; i < 360; i++) { world._station.hour = hour; world.update(1 / 60, idle); }

        /* Keyed on the BODY, frozen where it leaves the pool — the same rule
         * and the same reason as the clause above. */
        const seen = new Map();
        for (const [, b] of life.live) {
          seen.set(b, { lx: b.position.x, lz: b.position.z, path: 0,
            walk: b.stationWay === 'walk', gone: false });
        }
        for (let i = 0; i < 1200; i++) {
          world._station.hour = hour;
          world.update(1 / 60, idle);
          for (const [b, a] of seen) {
            if (a.gone) continue;
            if (b.disposed || b.alive === false) { a.gone = true; continue; }
            a.path += Math.hypot(b.position.x - a.lx, b.position.z - a.lz);
            a.lx = b.position.x; a.lz = b.position.z;
          }
        }
        let moved = 0, ground = 0, walkers = 0;
        for (const [, a] of seen) {
          if (a.path > 0.001) moved++;
          ground += a.path;
          if (a.walk) walkers++;
        }
        /* THE LOBBY IS NOT EMPTY. §11's pool is 60 at `high` and this is one
         * end of a 180 m drum, so a fifth of it is the floor. */
        assert(seen.size >= 12,
          `${seen.size} live bodies where the lift doors open at ${hour}:00 — the drum is empty`);
        /* AND FOUR IN FIVE OF THEM ARE DOING SOMETHING. A millimetre in twenty
         * seconds is the lowest bar there is and it is the right one: the
         * measurement it replaces read ZERO out of thirty-one. */
        assert(moved >= Math.ceil(seen.size * 0.8),
          `${moved} of ${seen.size} bodies in view at ${hour}:00 moved so much as a millimetre in `
          + 'twenty seconds — a room full of people is a room full of statues');
        /* AND THE ROOM COVERS GROUND BETWEEN THEM. A shuffle at a counter is
         * a few metres a minute and a crossing is tens, so a dozen bodies over
         * twenty seconds clears this without anybody having to be walking —
         * what it refuses is a room that twitches and stays put. */
        assert(ground >= 20,
          `the ${seen.size} people in view at ${hour}:00 covered ${ground.toFixed(1)} m of ground `
          + 'between them in twenty seconds');
        /* AND SOMEBODY IS CROSSING IT. §2.5: *"in between places, the
         * walkways"* — the lobby is one, and a lobby nobody walks through is a
         * waiting room. */
        assert(walkers >= 1,
          `nobody in view at ${hour}:00 is on an open walking stretch — ${seen.size} people are `
          + 'standing in the lift lobby and none of them is going anywhere');
        said.push(`${hour}:00 ${seen.size} bodies, ${moved} moved, ${ground.toFixed(0)} m, `
          + `${walkers} walking, nearest stretch ${nearest.toFixed(1)} m`);
      } finally { world.unload(); }
    }
    return said.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: somebody on the concourse has an animal with them', async () => {
    /**
     * V16 §G1: *"see a couple other people with companions of there own …
     * just milling about."*
     *
     * ── WHAT WAS MEASURED ────────────────────────────────────────────────
     *
     * `Pits.isHandler` and `Pits.handlerOf` — the two functions that decide
     * which residents walk with an animal and which animal it is — had **zero
     * callers outside `handlersOn`**, which is a roster the pit reads to fill a
     * card. No body on the station has ever carried a companion, on any deck,
     * at any hour: the roster knew, the card knew, and the drum was empty of
     * animals.
     *
     * ── AND IT IS THE SAME ROLL AS THE PIT'S ─────────────────────────────
     *
     * `handlerOf` is a pure function of the resident record, so the stranger
     * with a tuk'ata at heel on the morning concourse is the one the pit fields
     * that night. That is §G4's sentence and this asserts it rather than
     * trusting it: the animal on the deck is matched back to `handlerOf` on the
     * same census slot.
     */
    diskFetch();
    const { world, idle } = await station(40, 'high');
    try {
      const life = world._stationLife;
      const { wayPlacesOn, primeStationLife } = await import('../../src/game/StationLife.js');
      /* AT MIDDAY, and the hour is named rather than taken: `handlerOf` is a
       * function of WHO is in a slot and who is in a slot is a function of the
       * hour, so a check on a clock nobody set would pass or fail on whatever
       * time the boot happened to leave behind. 13:00 is `CENSUS_HOUR` — the
       * hour every other count in this file is taken at. */
      world._station.hour = 13;
      const open = wayPlacesOn(40).find((p) => p.way === 'walk');
      world.player.position.set(open.x, world.player.position.y, open.z);
      world.player.body?.setTransform?.(world.player.position, null);
      /* The pool, re-seated where he is now — see the clause above. */
      life.priming = true;
      for (let i = 0; i < 60 && primeStationLife(world); i++) { /* fill it */ }
      for (let i = 0; i < 900; i++) world.update(1 / 60, idle);

      const pairs = [];
      for (const [, b] of life.live) {
        if (!b._stationAnimal) continue;
        pairs.push([b, b._stationAnimal]);
      }
      assert(pairs.length >= 1,
        'not one resident on deck 40 has an animal with them — `isHandler` still has no caller '
        + 'that puts a body on the deck');
      /* AND IT IS AT HEEL, which is the whole of "with them". `HEEL.back` is
       * the companion machinery's own station distance and `LEASH` is how far
       * it may range off it; the bar is read out of that table rather than
       * typed, because a number here that drifted from the one the animal
       * actually walks to would pass while the dog stood in another room. */
      const { HEEL, LEASH } = await import('../../src/game/Companions.js');
      const far = [];
      for (const [b, a] of pairs) {
        assert(a.team === b.team, `${b.stationName}'s animal is on team ${a.team} against ${b.team}`);
        assert(a._cmpOwner === b, `${b.stationName}'s animal is not owned by them`);
        const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        const dy = Math.abs(a.position.y - b.position.y);
        if (d > HEEL.back + LEASH || dy > 4) far.push(`${b.stationName}'s ${a.stationName} at ${d.toFixed(1)} m (${dy.toFixed(1)} m below)`);
      }
      assert(far.length === 0, `an animal is not with its handler: ${far.join(', ')}`);
      /* THE PIT'S OWN ROLL AND NOT A SECOND ONE. */
      const { handlerOf } = await import('../../src/game/Pits.js');
      const { occupant, headcount } = await import('../../src/game/StationLife.js');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      /* THE SAME EVENING `spawnResident` HANDED IN. `occupant` takes the hour,
       * the day, the room's headcount and the player's company, and `barman`
       * reads three of the four — a call short of them draws a different
       * person out of the same slot. */
      const evening = (p) => ({
        hour: world._station.hour, day: world._station.day ?? 0,
        heads: headcount(p, world._station.hour), company: life.company || null,
      });
      for (const [b] of pairs) {
        const H = b.stationHandler;
        assert(H, `${b.stationName} has an animal and no handler record`);
        const p = PLACE.get(b.stationPlace) || wayPlacesOn(40).find((q) => q.id === b.stationPlace);
        if (!p) continue;
        /* Way pseudo-places are not in the gazetteer and `occupant` reads them
         * the same way `spawnResident` does — the same call, the same seed. */
        if (b.stationSlot == null) continue;
        const again = handlerOf(occupant(p, b.stationSlot, evening(p)));
        assert(again && again.kind === H.kind,
          `${b.stationName}'s animal is a ${H.kind} and the pit's own roll says `
          + `${again ? again.kind : 'they are not a handler at all'}`);
      }
      return `${pairs.length} handler${pairs.length === 1 ? '' : 's'} on deck 40 with an animal at `
        + `heel: ${pairs.map(([b, a]) => `${b.stationName}'s ${a.stationName} (${b.stationHandler?.kind})`).join(', ')}`;
    } finally { world.unload(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: every place is reachable on foot from a lift', async () => {
    const { PLACES, DRUM, DECK_Y } = await import('../../src/game/StationPlan.js');
    /**
     * ══ THE WALK ════════════════════════════════════════════════════════
     *
     * §5.3: "every place reachable on foot from a lift (a ray-walk of the
     * plan's doors)". The station's circulation is by construction — a ring
     * against the skin, a balcony round the void, four radial spines between
     * them — so the walk is: from the lift's lobby to the nearest spine, out
     * along it to the ring, round the ring to the place's bearing, in through
     * its door. What this asserts is that every place's door actually lands
     * on one of those three, because a room whose door opens onto structure
     * is a room you cannot get into and nothing else would say so.
     *
     * ══ AND IT USED TO ASK THE WRONG TABLE, AND SKIP THE ROOMS IT MATTERED
     *    MOST FOR ═══════════════════════════════════════════════════════
     *
     * Two defects in six lines, and together they made this check assert the
     * bug rather than catch it.
     *
     * IT ASKED `StationPlan.SHAFTS`, which is the plan's DECLARATION of which
     * shaft passes which deck — a comment with a data type. What the player
     * actually rides is `DeckLift.liftFloors()`, a list `Levels.js` hands down
     * at module scope, and the two have never been checked against each other.
     * `SHAFTS.atrium` has said `decks: [40, 44, 48, 60]` since the plan was
     * written; the floor list has never had a deck-60 row, so **#54 the
     * Observation dome — the "best seat", the room V16 §A1 nominates for
     * watching the warp from outside — has never been reachable by any means
     * in the shipped game**, and this check said it was. Measured: `SHAFTS`
     * serves decks 12, 32, 40, 44, 48, 60; `liftFloors()` stops at 12, 32, 40,
     * 44, 48. One deck, one room, twenty residents, no door.
     *
     * AND IT SKIPPED `deck32`/`deck12` OUTRIGHT — the `continue` was meant to
     * excuse those bands from the DOOR geometry, which is fair (they are the
     * hangar's frame and have no ring), but it took the lift clause with it.
     * So the five §7 flight-ops rooms were exempt from the one test that would
     * have found them unreachable, which is exactly the defect `Levels.js`'s
     * own header records having shipped: "five rooms and a traffic board no
     * player could reach", green 15/15 the whole time.
     *
     * SO: the lift clause runs on EVERY place and asks `liftFloors()`; the
     * door clause runs on the drum's three decks and is gated BY DECK, not by
     * band, so a new room cannot inherit an exemption by choosing a band.
     */
    /* The floor list is installed by `Levels.js` at module scope behind
     * `STATION_ENABLED`; read without importing it first, `liftFloors()` is
     * `DeckLift`'s one-row `[MENU_FLOOR]` default and this whole check would
     * pass or fail on import order. */
    await import('../../src/game/Levels.js');
    const { liftFloors } = await import('../../src/game/DeckLift.js');
    const floors = liftFloors().filter((f) => f.deck != null);
    const served = new Set(floors.map((f) => f.deck));
    assert(served.size >= 1, 'liftFloors() offers no station deck at all — Levels.js never installed the list');

    /* The drum IS decks 40/44/48 — ring, balcony, four spines. 12 and 32 are
     * the hangar's own frame and 60 is one room on the axis with the lift
     * opening straight into it; none of the three has a ring to stand a door
     * on, so the geometry below cannot be asked of them. Named by deck so the
     * exemption is a fact about the hull and not a spelling of `band`. */
    const DRUM_DECKS = new Set([40, 44, 48]);

    const unreachable = [];
    const offTheLift = [];
    for (const p of PLACES) {
      /* `external` is #1 the flight bay and #55 the outside: one is built by
       * `Hangar.js` and the other is a level, and neither is a room with a
       * door. Everything else in the gazetteer is tested, including the bands
       * that used to `continue` past this. */
      if (p.external) continue;
      if (!served.has(p.deck)) {
        offTheLift.push(`#${p.id} ${p.name} is on deck ${p.deck}, and the lift's floors are `
          + `${[...served].sort((a, b) => a - b).join(', ')}`);
      }
      if (!DRUM_DECKS.has(p.deck) || p.band === 'ring') continue;
      const r = Math.hypot(p.door[0], p.door[1]);
      const onRing = Math.abs(r - DRUM.roomR) < 1.5;
      const onBalcony = Math.abs(r - DRUM.balcony) < 1.5 || r < DRUM.balcony;
      const onSkin = Math.abs(r - (DRUM.R - 1)) < 1.5;
      /* A Concourse alcove's door is in the Concourse's own wall, which is a
       * place, and a place is walkable. */
      const inConcourse = p.band === 'concourse' && Math.abs(Math.abs(p.door[0]) - 10.7) < 1.0;
      if (!(onRing || onBalcony || onSkin || inConcourse)) {
        unreachable.push(`#${p.id} ${p.name}: door at r=${r.toFixed(1)}, and the ring is ${DRUM.roomR}, the balcony ${DRUM.balcony}`);
      }
    }
    assert(unreachable.length === 0,
      `${unreachable.length} places are not on the circulation:\n      ${unreachable.slice(0, 8).join('\n      ')}`);
    assert(offTheLift.length === 0,
      `${offTheLift.length} places are on a deck the lift does not stop at:\n      ${offTheLift.slice(0, 8).join('\n      ')}`);

    /* AND THE OTHER DIRECTION: a floor row for a deck with no rooms on it is a
     * button that opens onto an empty plate, which is the same defect read
     * backwards and nothing else asks it. */
    const rooms = new Set(PLACES.filter((p) => !p.external && p.deck != null).map((p) => p.deck));
    const empty = floors.filter((f) => !rooms.has(f.deck)).map((f) => `${f.n}`);
    assert(empty.length === 0, `the lift stops at floor(s) ${empty.join(', ')}, which the gazetteer has no rooms on`);

    /* Every deck the gazetteer uses has a height. */
    for (const d of rooms) assert(DECK_Y[d] !== undefined, `deck ${d} has places on it and no height in DECK_Y`);
    return `${PLACES.filter((p) => !p.external).length} rooms on decks `
      + `${[...rooms].sort((a, b) => a - b).join('/')}; the lift stops at `
      + `${[...served].sort((a, b) => a - b).join('/')}`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the floor is where floorAt says it is, everywhere you can stand', async () => {
    const { world } = await station(40);
    try {
      const { PLACES, DECK_Y } = await import('../../src/game/StationPlan.js');
      const bad = [];
      for (const p of PLACES) {
        if (p.deck !== 40 || p.external || !p.w) continue;
        const y = world.floorAt(p.x, p.z);
        /* A place either stands on its deck or declares a sunken floor; what
         * it may never do is float or be somewhere else entirely. */
        if (!(y <= DECK_Y[40] + 0.01 && y > DECK_Y[40] - 9)) {
          bad.push(`#${p.id} ${p.name}: floorAt is ${y.toFixed(2)} on a deck at ${DECK_Y[40]}`);
        }
      }
      assert(bad.length === 0, `${bad.length} places stand off their own deck:\n      ${bad.join('\n      ')}`);
      /* The sunken rooms really are sunk — §3.2 says the cantina is half a
       * deck down and the arena is a sunken ring, and a check that never sees
       * a negative has not seen one. */
      const sunk = world._station.sunk;
      assert(sunk.length >= 2, `only ${sunk.length} sunken floors on deck 40; §3.2 names the cantina and the arena`);
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: §9.2 — the switch is real, and no station file names a mode', async () => {
    const L = await import('../../src/game/Levels.js');
    assert(typeof L.STATION_ENABLED === 'boolean', 'STATION_ENABLED is not a boolean');
    assert(!!L.LEVELS.station === L.STATION_ENABLED,
      'LEVELS.station exists independently of the switch, so the switch does not switch it off');

    /* Everything the station is, is a new file. */
    const dir = new URL('../../src/game/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.startsWith('Station') || f === 'Starfury.js');
    assert(files.length >= 5, `only ${files.length} station files: ${files.join(', ')}`);

    /**
     * ══ NO STATION FILE LEARNS A MODE'S NAME (§10) ══════════════════════
     *
     * "A new mode is one world plus one manifest entry." The rule that keeps
     * that true is that nothing here switches on which mode contributed a
     * resident — the same "rows, not names" rule `CompanionKinds.js` keeps
     * over twelve kinds. A grep is the only way to hold it, because the
     * failure is a single `if` somebody adds in a hurry.
     */
    const MODES = ['command', 'theline', 'duel', 'training', 'sandbox', 'raid', 'blade', 'trial'];
    const hits = [];
    for (const f of files) {
      const src = await readFile(new URL(f, dir), 'utf8');
      /* Comments are prose and may name anything; code may not. */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const m of MODES) {
        /**
         * A COMPARISON, not a mention. `schedule.py` has a JOB called
         * `command` and `faction.py` a faction called `command`, and the
         * first version of this grep called both of those a mode — which is
         * §2.3c in miniature, a reader test that greps too wide and finds
         * somebody else's field. What §10 forbids is a station file BRANCHING
         * on which mode contributed something, so that is what is looked for.
         */
        const re = new RegExp(`(===?\\s*|!==?\\s*|MODES\\s*[.[]\\s*['"\`]?)['"\`]?${m}['"\`]?\\s*[)\\]}]?`);
        const modeish = new RegExp(`(settings\\.mode|_pickedMode|world\\.mode|\\bmode\\b\\s*===?)`);
        if (re.test(code) && modeish.test(code)) hits.push(`${f} branches on the mode '${m}'`);
      }
    }
    assert(hits.length === 0, `${hits.length} station files name a mode:\n      ${hits.join('\n      ')}`);

    /* §12.1: no external URL on any loading path. The single file has to work
     * from disk with the network off, and a CDN in a loader is how that stops
     * being true without anything going red. */
    const mesh = await readFile(new URL('StationMesh.js', dir), 'utf8');
    assert(!/https?:\/\//.test(mesh.replace(/\/\*[\s\S]*?\*\//g, '')),
      'StationMesh.js has an external URL in it, and the packed game must fetch nothing');
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the imported rooms decode to what §1.1 measured', async () => {
    const { decodeRoom } = await import('../../src/game/StationMesh.js');
    const { materialKeyFor } = await import('../../src/game/StationMesh.js');
    const root = new URL('../../assets/station/', import.meta.url);
    /* §1.1's own figures, and the check is that the geometry in the repo is
     * the geometry the plan was written against. */
    const want = {
      'zocalo.smesh': { tris: 98380, w: 22.0, h: 7.5, d: 67.4, parts: 44 },
      'corridor.smesh': { tris: 44404, w: 9.4, h: 7.6, d: 120.6, parts: 37 },
      'cnc.smesh': { tris: 18510, parts: 32 },
      'rotunda.smesh': { tris: 42156, parts: 35 },
      'starfury.smesh': { tris: 3968, parts: 16 },
    };
    let uncovered = 0;
    for (const [file, w] of Object.entries(want)) {
      const buf = await readFile(new URL(file, root));
      const room = decodeRoom(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), file);
      assert(room.tris === w.tris, `${file}: ${room.tris} triangles, §1.1 measured ${w.tris}`);
      assert(room.parts.size === w.parts, `${file}: ${room.parts.size} parts, expected ${w.parts}`);
      if (w.w) {
        const b = room.bounds;
        const dims = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
        assert(Math.abs(dims[0] - w.w) < 0.2 && Math.abs(dims[1] - w.h) < 0.2 && Math.abs(dims[2] - w.d) < 0.2,
          `${file}: ${dims.map((n) => n.toFixed(1)).join(' × ')} m, §1.1 measured ${w.w} × ${w.h} × ${w.d}`);
        assert(Math.abs(b.min[1]) < 0.01, `${file}: its floor is at y=${b.min[1]}, and §1.1 says put it at 0`);
      }
      /* Every part has a row in the §2 prefix table. A part that falls through
       * is a surface with no material, and the loader refuses a default. */
      for (const name of room.names) if (!materialKeyFor(name)) { uncovered++; console.log(`      UNCOVERED ${file}: ${name}`); }
      /* And nothing here made a material — §9.1's cheapest guarantee. */
      for (const g of room.parts.values()) assert(!g.material, `${file}: the decoder made a material`);
    }
    assert(uncovered === 0, `${uncovered} imported parts have no row in PART_MATERIAL`);
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: a face is the same all day and somebody else tomorrow', async () => {
    /**
     * *"the same shop owner doesnt always look the same like between runs …
     *  otherwise it would get stale seeing the same people always doing the
     *  same things."*
     *
     * ── WHAT WAS MEASURED, AND IT IS THE DEFECT THIS IS A PIN FOR ────────
     *
     * `occupant`'s seed was `p{place}s{slot}` and nothing else. Read on day 0,
     * day 1, day 5 and day 40 the Concourse's slot 0 handed back Vesbar Kolbar
     * the brakiri financier every single time. The shelves rerolled on
     * `(counter, day)`, the job board rerolled, the leave roll rerolled — and
     * the faces did not, because the day never reached that line. A station
     * where every shelf changes and no person does is worse than one where
     * neither does: it says the day is passing and shows you it is not.
     *
     * ── AND THE TWO HALVES ARE OPPOSITE, WHICH IS WHY BOTH ARE HERE ──────
     *
     * STABLE ALL DAY, because `spawnResident`'s own argument is that a slot
     * index is what makes a resident survive a despawn — a face that changed
     * while you crossed the room is a worse failure than one that never
     * changes at all.
     * SOMEBODY ELSE TOMORROW, which is the ask.
     * AND THE NAMED CAST IS EXEMPT: the Forge's Wookiee smith is a person, not
     * a slot, and a person who is somebody else on Tuesday is not a person.
     */
    const { occupant, headcount } = await import('../../src/game/StationLife.js');
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const rooms = PLACES.filter((p) => !p.external && p.heads >= 6).slice(0, 8);
    const DAYS = [0, 1, 2, 7, 30];

    /* ── STABLE WITHIN A DAY, across every hour the room is open ────────── */
    for (const p of rooms) {
      for (const day of DAYS) {
        const first = occupant(p, 3, { day, hour: 3 });
        for (const hour of [7, 11, 15, 19, 23]) {
          const again = occupant(p, 3, { day, hour });
          /* A bar seat legitimately changes with the hour — that is liberty,
           * and `food.mjs` holds it. What must not change is the CENSUS. */
          if (again.bar || first.bar) continue;
          assert(again.name === first.name && again.species === first.species,
            `#${p.id} slot 3 is ${first.name} at 03:00 and ${again.name} at `
            + `${hour}:00 on the same day — a face changed while you crossed the room`);
        }
      }
    }

    /* ── AND SOMEBODY ELSE TOMORROW ─────────────────────────────────────── */
    const stuck = [];
    for (const p of rooms) {
      const n = Math.min(headcount(p, 13), 12);
      let moved = 0, slots = 0;
      for (let i = 0; i < n; i++) {
        const seen = new Set(DAYS.map((day) => {
          const r = occupant(p, i, { day, hour: 13 });
          return r.borz ? 'BORZ' : `${r.name}|${r.species}`;
        }));
        if (seen.has('BORZ')) continue;          // a named character, exempt
        slots++;
        if (seen.size > 1) moved++;
      }
      if (slots && moved / slots < 0.5) {
        stuck.push(`#${p.id} ${p.name}: ${moved} of ${slots} census slots changed over ${DAYS.length} days`);
      }
    }
    assert(!stuck.length,
      `${stuck.length} rooms hold the same people for ever:\n      ${stuck.join('\n      ')}`);

    /* ── THE NAMED CAST IS THE SAME PERSON ON EVERY ONE OF THOSE DAYS ───── */
    const cast = [];
    for (const p of PLACES) {
      if (p.external || !p.heads) continue;
      const names = DAYS.map((day) => occupant(p, 0, { day, hour: 13 })).filter((r) => r.borz);
      if (names.length !== DAYS.length) continue;
      const one = new Set(names.map((r) => r.name));
      assert(one.size === 1,
        `#${p.id}'s named character is ${[...one].join(' / ')} across ${DAYS.length} days — `
        + 'a person who is somebody else on Tuesday is not a person');
      cast.push(`#${p.id} ${names[0].name}`);
    }

    /* ── AND THE MAN ACROSS THE PIT IS NOT THE SAME MAN FOR EVER ────────── */
    const { handlersOn, ROSTER_HOUR } = await import('../../src/game/Pits.js');
    const rosters = DAYS.map((day) => handlersOn(ROSTER_HOUR, day).map((h) => h.id).join(','));
    assert(new Set(rosters).size > 1,
      `the pit fields the same ${handlersOn(ROSTER_HOUR, 0).length} handlers on every one of `
      + `${DAYS.length} days — §G4's whole point is that it could be anyone on any day`);

    return `${rooms.length} rooms: a census face is fixed across 6 hours of its own day and `
      + `changes over ${DAYS.length} days; ${cast.length} named characters unchanged `
      + `(${cast.slice(0, 3).join(', ')}…); the pit's roster differs on `
      + `${new Set(rosters).size} of ${DAYS.length} days`;
  });

  check('station: the cast — fifteen species, each with a body, a name and a day', async () => {
    const C = await import('../../src/game/StationCast.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    assert(C.SPECIES_KEYS.length === 15, `${C.SPECIES_KEYS.length} species; body.py has 15`);
    const borz = /^(CT|CC)-\d|clone|trooper/i;
    for (const k of C.SPECIES_KEYS) {
      const A = ARCHETYPES[`res_${k}`];
      assert(A, `${k} has no archetype, so spawnEnemy cannot build one`);
      /* THE FENCE. §11: no wave may ever compose a resident. */
      assert(A.score === 0 && A.threat === 0 && A.unlockAt === 99 && A.resident === true,
        `${k}'s archetype is not fenced — a wave could compose it`);
      assert(!A.ranged && !A.weapon && !A.moves,
        `${k} is armed, and §3.3 says residents are off duty and unarmed`);
      assert(C.RHYTHMS[k], `${k} has no rhythm`);
      /* A name, and never a Borz one. */
      const names = new Set();
      for (let i = 0; i < 40; i++) {
        const n = C.nameFor(k, `check-${k}-${i}`);
        assert(typeof n === 'string' && n.length > 1, `${k}'s name generator returned ${JSON.stringify(n)}`);
        assert(!borz.test(n), `${k}'s generator returned a Borz name: ${n}`);
        names.add(n);
      }
      /* The Vorlon is a singleton with six attested names; everyone else's
       * grammar has to be wider than a handful. */
      assert(names.size >= (k === 'vorlon' ? 4 : 20),
        `${k}'s grammar made only ${names.size} distinct names in 40 draws`);
    }
    /* The manifest reader is the mode contract's only door (§10). */
    const rows = C.residents();
    assert(rows.length >= 15 + 5, `residents() returned ${rows.length} rows`);
    for (const r of rows) assert(r.builder && r.home, `a manifest row has no builder or no home: ${JSON.stringify(r)}`);
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the day — every place is populated at its own busy hour, every species is here', async () => {
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const { headcount, census } = await import('../../src/game/StationLife.js');
    const empty = [];
    for (const p of PLACES) {
      if (p.external || !p.heads) continue;
      const n = headcount(p, p.peak);
      if (n < 1) empty.push(`#${p.id} ${p.name} is empty at its own busy hour (${p.peak}:00)`);
    }
    assert(empty.length === 0,
      `${empty.length} places are empty when they are supposed to be busiest:\n      ${empty.join('\n      ')}`);

    /**
     * ══ §5.3: EIGHT OF EVERY SPECIES — ON EVERY DAY OF A YEAR ═════════════
     *
     * This asserted `census(13)` and nothing else, which is day 0, which is
     * the one day the faces do not reroll on. Swept, the floor was a fiction:
     * Grome and "other" stood at SEVEN on 222 days of 365, Vree and Abbai on
     * some, and the Minbari — whose quarter seats three at midday — fell to
     * six. The Vorlon stood at ZERO on all 365, and the line that skipped him
     * said he was "placed by hand at #37", where the gazetteer gave him no
     * head to stand on. A check that names the thing it is not checking.
     *
     * THE FLOOR IS THE ROSTER'S, NOT THIS FILE'S. `FLOOR` is the number
     * `StationLife` builds to, and the one exception is read off the species
     * row — `singleton` is what makes the Vorlon one — so a sixteenth species
     * added to `SPECIES` is swept here the day it lands, with no list to edit.
     */
    const { SPECIES_KEYS, SPECIES_BY } = await import('../../src/game/StationCast.js');
    const { FLOOR } = await import('../../src/game/StationLife.js');
    const floorFor = (k) => (SPECIES_BY.get(k).singleton ? 1 : FLOOR);
    const YEAR = 365;

    const worst = new Map(SPECIES_KEYS.map((k) => [k, [Infinity, -1]]));
    const vectors = new Set();
    const spread = new Map(SPECIES_KEYS.map((k) => [k, new Set()]));
    for (let day = 0; day < YEAR; day++) {
      const c = census(13, day);
      const v = [];
      for (const k of SPECIES_KEYS) {
        const n = c.bySpecies.get(k) || 0;
        v.push(n);
        spread.get(k).add(n);
        if (n < worst.get(k)[0]) worst.set(k, [n, day]);
      }
      vectors.add(v.join(','));
    }
    const thin = SPECIES_KEYS
      .filter((k) => worst.get(k)[0] < floorFor(k))
      .map((k) => `${k}: ${worst.get(k)[0]} on day ${worst.get(k)[1]} (floor ${floorFor(k)})`);
    assert(thin.length === 0,
      `over ${YEAR} days the 13:00 census falls under §5.3's floor for ${thin.length} species:\n      `
      + thin.join('\n      '));

    /**
     * AND EVERY SPECIES IS ON THE STATION AT EVERY HOUR, not only at midday.
     * The floor is a midday number because `occupant` may not read the clock;
     * PRESENCE is not, and a species that vanishes from the station between
     * 11:00 and 20:00 — which is what the Vorlon's curve did to him — is a
     * species the player cannot be shown.
     */
    const gone = [];
    for (const day of [0, 1, 7, 65, 199, 364]) {
      for (let hour = 0; hour < 24; hour++) {
        const c = census(hour, day);
        const miss = SPECIES_KEYS.filter((k) => !(c.bySpecies.get(k) > 0));
        if (miss.length) gone.push(`day ${day} ${hour}:00 — ${miss.join(', ')}`);
      }
    }
    assert(gone.length === 0,
      `${gone.length} hours hold fewer than all ${SPECIES_KEYS.length} species:\n      `
      + gone.slice(0, 8).join('\n      '));

    /**
     * AND THE FLOOR IS A FLOOR, NOT A QUOTA. The failure mode of any top-up is
     * that it flattens the thing it was fixing — every rare kind pinned at
     * exactly eight for ever, which is a census that has stopped being a
     * census. So: no two days of the year may read the same, and every kind
     * that is not a singleton must take more than one value across it.
     */
    assert(vectors.size === YEAR,
      `only ${vectors.size} distinct censuses over ${YEAR} days — the mix has stopped moving`);
    const flat = SPECIES_KEYS.filter((k) => !SPECIES_BY.get(k).singleton && spread.get(k).size < 2);
    assert(flat.length === 0,
      `${flat.join(', ')} read the same number on all ${YEAR} days — that is a quota, not a floor`);

    const line = SPECIES_KEYS.map((k) => {
      const a = [...spread.get(k)];
      return `${k} ${Math.min(...a)}–${Math.max(...a)}`;
    }).join(', ');
    console.log(`      census at 13:00 over ${YEAR} days: ${line}`);
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the sandbox — residents are real bodies, and the step is inside its budget', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const life = world._stationLife;
      assert(life, 'no station life was dressed');

      /* §11: every resident within ~40 m is a REAL body. */
      step(world, 2, idle);
      const live = [...life.live.values()];
      assert(live.length > 4, `only ${live.length} live residents round the player; §11 wants a pool`);
      const one = live[0];
      assert(one.hp > 0 && one.position, 'a resident is not a body');
      assert(one.stationName, 'a resident has no name, and §14 wants one on a nameplate');
      assert(one.team === (world.player?.team ?? 0), '§11 puts residents on the player\'s team');

      /* …and the player can actually harm one, which is the whole promise.
       * `canHarm` refuses a same-team victim unless friendly fire is on, and
       * the station turns it on for exactly this. */
      const { canHarm } = await import('../../src/game/Player.js');
      assert(canHarm(world.player, one),
        'the player cannot harm a resident — §11\'s ragdoll, limbs and hurl are all false');

      /**
       * ══ §12.2's 2.5 ms, MEASURED THE WAY THE DECK'S IS ══════════════════
       *
       * `decklife.mjs` holds `stepDeckLife` to an AVERAGE over 300 frames,
       * and this file is held the same way for the same reason. Measured over
       * 360 frames on this box: median 0.028 ms, p95 0.056 ms — and one frame
       * at 162 ms.
       *
       * That outlier is a garbage collection landing inside the span, not the
       * station's work: `process.cpuUsage` counts the whole process's CPU, a
       * spawn allocates a body's worth of it, and a major GC on a 2 GB heap
       * is a hundred milliseconds of real CPU wherever it happens to fall. A
       * bound on the single worst frame would be red for a reason nobody can
       * act on, which HANDOFF §2.6c is explicit is worse than no bound at all.
       * So: the average is the assertion, p95 is printed beside it, and the
       * worst is printed and named rather than asserted.
       */
      const samples = [];
      step(world, 6, idle, () => { samples.push(life.stepMs); });
      samples.sort((a, b) => a - b);
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const p95 = samples[Math.floor(samples.length * 0.95)];
      const worst = samples[samples.length - 1];
      assert(mean <= 2.5,
        `the station's step averages ${mean.toFixed(2)} ms over ${samples.length} frames against §12.2's 2.5`);
      assert(p95 <= 2.5,
        `the station's step is ${p95.toFixed(2)} ms at p95 against §12.2's 2.5`);
      console.log(`      station step over ${samples.length} frames: mean ${mean.toFixed(3)} ms, p95 ${p95.toFixed(3)}, worst ${worst.toFixed(1)} (a GC) — ${live.length} live bodies, bound 2.5`);
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the ride between the deck and the station shows no loading plate', async () => {
    /**
     * V15 §1.5: *"seemlessly should be able to go from our star wars hangar to
     * the station through just the elevator with no loading screens."*
     *
     * The world IS rebuilt — `World._loadSteps` is synchronous and nothing in
     * this feature may add a stage to it (§9.2) — so "no loading screen" is
     * not "no load". It is: what the player looks at while it happens is the
     * last frame he was looking at, which is the inside of the lift car with
     * its doors shut, and not the menu plate with the game's logo on it.
     *
     * `captureStill()` takes that frame and `Screens.loading` shows THAT with
     * a thin bar along the bottom. The mechanism already existed for the
     * deploy, built for the same complaint ("the transition is kind of janky
     * like it isn't seamless"); this asserts it is on BOTH directions of the
     * lift and that the plate is genuinely gone while it is.
     *
     * ── WHY A SOURCE READ AND NOT A DRIVEN RIDE ───────────────────────────
     *
     * A browser probe does drive it — `tools/_dbgride.mjs`, and it read
     * `class="screen still"` on the way in, which is the still and not the
     * plate. But it costs forty minutes on a software rasteriser rendering
     * 1.7 M triangles a frame, so it is a probe and not a gate. What can be
     * held cheaply and forever is the two things that actually break: a hand-
     * off that forgets to capture, and a `loading` call that ignores the
     * still it was handed.
     */
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    /* BOTH DIRECTIONS. There are two `onDeckLift` handlers — the flight deck's
     * and the station's — and each must capture before it tears the world
     * down, because the teardown disposes the renderer's last frame with it. */
    const handlers = [...code.matchAll(/onDeckLift\s*=\s*\(([^)]*)\)\s*=>\s*\{/g)];
    assert(handlers.length === 2,
      `${handlers.length} onDeckLift handlers in main.js; the deck has one and the station has one`);
    for (const h of handlers) {
      const body = code.slice(h.index, h.index + 1400);
      const cap = body.indexOf('captureStill()');
      const leave = body.search(/leave(Hangar|Station)\(/);
      assert(cap > 0, 'a lift handler rebuilds the world without capturing the frame first — '
        + 'the player gets the menu plate in the middle of a lift ride');
      assert(leave > 0 && cap < leave,
        'a lift handler captures AFTER the teardown, which disposes the renderer and the frame with it');
      assert(/\{\s*still\s*\}/.test(body) || /still\s*[,}]/.test(body),
        'a lift handler captures a still and does not hand it on');
    }
    /* AND THE FAR SIDE USES IT. `enterStation`/`enterHangar` take `opts.still`
     * and turn it into the `{ still }` bag `Screens.loading` reads. */
    assert((code.match(/opts\.still\s*\?\s*\{\s*still:\s*opts\.still\b/g) || []).length >= 2,
      'a door takes a still and never builds the bag Screens.loading reads');
    /* AND IT HANDS OVER A LINE IN THE FICTION rather than letting the loader's
     * own stage names through — see the clause below for what that is for. */
    assert((code.match(/say:\s*'[^']+'/g) || []).length >= 2,
      'a door builds the seam bag without a line for the car to say, so a long '
      + 'ride falls back to whatever the loader was calling its current stage');

    /**
     * ── AND THE SCREEN ITSELF, DRIVEN ─────────────────────────────────────
     *
     * The half above proves the still is handed along. This proves what the
     * screen does with one: the still goes on, the plate comes off, and
     * `hideLoading` puts it back — because a `still` class left on the
     * element is the menu wearing a screenshot of a lift for the rest of the
     * session.
     */
    const { Screens } = await import('../../src/ui/Screens.js');
    /* `tools/dom-shim.mjs` answers every `getElementById` with null, on
     * purpose — a headless suite has no page. The element is the subject here,
     * so it is lent to the lookup for the length of this one check and taken
     * back in the `finally`. Nothing else in the process sees it. */
    const el = document.createElement('div');
    el.className = 'screen hidden';
    /* The bar and the caption are the subject of the second half, so they are
     * real elements with a real parent — a null here would make the clause
     * pass by finding nothing to complain about. */
    const bar = document.createElement('div');
    const fill = document.createElement('div');
    bar.appendChild(fill);
    const msg = document.createElement('div');
    const was = document.getElementById;
    document.getElementById = (id) => (id === 'loading' ? el
      : id === 'load-fill' ? fill : id === 'load-msg' ? msg : null);
    try {
      const sc = new Screens();
      sc.loading(0.3, 'raising the ground', { still: 'data:image/png;base64,AA' });
      assert(el.classList.contains('still'),
        'a loading screen handed a still did not wear it — the player gets the plate mid-ride');
      assert(!el.classList.contains('hidden'), 'the loading screen stayed hidden');
      assert(/data:image/.test(el.style.backgroundImage || ''), 'the still was not painted');
      /**
       * ── AND THE STILL WAS ONLY HALF THE ANSWER ──────────────────────────
       *
       * *"no loading screens … should feel like just going to a different
       * place, not two separate games."* A hostile pass polled the DOM through
       * a real deck change and found, for 24.8 s: the photograph, correct —
       * and over it a 220 px progress bar and a caption reading "raising the
       * ground", "lighting the sky", "dressing the level". That is a loading
       * screen with a picture behind it, and the words are the names of engine
       * stages. This is the clause that says so.
       */
      assert(bar.style.display === 'none',
        'the progress bar draws over the seam — a bar on a photograph of a lift is a loading screen');
      assert(msg.textContent === '',
        `the seam says "${msg.textContent}" — the loader's own stage names are not what a `
        + 'player standing in a lift is looking at');
      /* AND IT DOES SAY SOMETHING IF THE RIDE OUTLASTS THE SHAFT, in the
       * fiction, and only then. The clock is the screen's own. */
      const { SEAM_QUIET } = await import('../../src/ui/Screens.js');
      sc._seamAt = Date.now() - (SEAM_QUIET + 1) * 1000;
      sc.loading(0.6, 'dressing the level', { still: 'data:image/png;base64,AA', say: 'the car is still moving' });
      assert(msg.textContent === 'the car is still moving',
        `after ${SEAM_QUIET}s the seam said "${msg.textContent}" rather than the line the door handed it`);
      /* AND AN ORDINARY LOAD IS UNTOUCHED — the menu deploy still gets its bar
       * and its stage names, because there is no fiction to be inside of. */
      sc.loading(0.5, 'lighting the sky', null);
      assert(bar.style.display !== 'none' && msg.textContent === 'lighting the sky',
        'the ordinary loading screen lost its bar — this is about the seam, not about loads');
      /**
       * ── AND IT IS NOT A PHOTOGRAPH ──────────────────────────────────────
       *
       * The plate and the bar were half the answer and were read as the whole
       * of it a second time: what was left was a STILL, and a still the player
       * stares at while the world is rebuilt is a load screen with a nicer
       * picture. The car has to look like it is still travelling.
       *
       * There is nothing to render at a seam — the old world is disposed, the
       * new one does not exist, and the thread that would draw a frame is the
       * thread building it — so the motion is CSS, and it is `transform` only
       * because that is the one kind of animation Chromium runs on the
       * compositor thread, off the main thread, and therefore the one kind
       * that keeps moving through a synchronous build. A keyframe that touched
       * `background-position`, `top` or `filter` would freeze with everything
       * else and would look exactly like the bug it was written to fix, which
       * is why this asserts the property list and not merely the presence of
       * an animation.
       */
      sc.loading(0.4, 'dressing the level', { still: 'data:image/png;base64,AA' });
      assert(el.classList.contains('seam'),
        'the seam still does not carry the class that moves it — the player is looking at a photograph');
      const band = el.children.find((c) => c.className === 'seam-lights');
      assert(band, 'no shaft-light band over the seam — the levels stopped going past the window');

      const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
      for (const sel of ['#loading.seam', '#loading .seam-lights']) {
        const rule = css.slice(css.indexOf(sel));
        assert(css.includes(sel), `styles.css has no rule for ${sel}, so the class does nothing`);
        assert(/animation:\s*seam/.test(rule.slice(0, 400)),
          `${sel} carries no seam animation`);
      }
      for (const name of ['seamRise', 'seamShaft']) {
        const at = css.indexOf(`@keyframes ${name}`);
        assert(at > 0, `styles.css declares no @keyframes ${name}`);
        const body = css.slice(at, css.indexOf('}}', at) + 2);
        const props = [...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
        const off = props.filter((k) => k !== 'transform');
        assert(props.length > 0 && !off.length,
          `@keyframes ${name} animates ${off.join(', ')} as well as transform — anything but `
          + 'transform is a main-thread animation, and the main thread is the one building the world, '
          + 'so it would stand as still as the picture it is drawn over');
      }

      sc.hideLoading();
      assert(!el.classList.contains('still') && !el.style.backgroundImage,
        'the still outlived the load — the menu now wears a photograph of a lift');
      assert(!el.classList.contains('seam') && !el.children.some((c) => c.className === 'seam-lights'),
        'the seam motion outlived the load — the menu is now drifting');
    } finally { document.getElementById = was; }
    return 'both lift handlers capture before teardown and hand it on; the screen wears it, shows no '
      + 'bar and no engine talk over it, says one line in the fiction if the ride runs long, moves on '
      + 'the compositor while the main thread builds, and gives it all back';
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the seam is a moment, and the rest of the build runs while the doors open', async () => {
    /**
     * ══ WHAT THE PLAYER IS FROZEN FOR, BOUNDED ═════════════════════════════
     *
     * The clause above holds that the seam shows no plate. This one holds the
     * only other thing that can make it read as a load: how long it lasts.
     *
     * ── THE MEASUREMENT THAT WAS WRONG, AND WHY ──────────────────────────
     *
     * An audit reported `buildWorld('station')` at 23.3 s and called the seam
     * a 23-second freeze-frame. It timed a station built as the FIRST world in
     * a fresh process. No player can reach one that way: `enterStation` is
     * called from `world.onDeckLift`, which only exists on a hangar world, so
     * by the time the lift button is pressed the flight deck has already been
     * built — and the flight deck has already paid for every procedural
     * texture in the game. Metered on this box: the hangar's own dress spends
     * about 7 s baking `src/engine/Textures.js` maps into a module-level cache
     * that `World.dispose` does not clear and nothing in play ever drops. The
     * station reuses all of it.
     *
     * So the hangar is built here FIRST, and it is not scaffolding — it is the
     * difference between measuring the seam and measuring a cold process.
     *
     * ── AND IT IS CPU, NOT WALL ──────────────────────────────────────────
     *
     * `_cpuclock.mjs`'s header has the numbers: on a box with peer lanes live,
     * wall time on the same fixed work varies 60x and CPU barely moves. The
     * contention factor is printed beside the reading so a slow gate can be
     * told from a slow build.
     *
     * ── THE CEILING IS DERIVED ───────────────────────────────────────────
     *
     * `Screens.SEAM_QUIET` is the game's own statement of how long a seam may
     * last before it stops being a transition: under it the car says nothing
     * at all, over it the screen prints "the car is still moving", which is a
     * line you write for somebody who is waiting. A build that outlasts it has
     * turned the seam into a wait by the game's own definition. That is the
     * bound — not a number read off today's run — and at the 23 s the audit
     * reported it is red by a factor of six.
     */
    const { cpuMs, loadPhrase } = await import('./_cpuclock.mjs');
    const { bootWorld, run: step, idleInput } = await import('./_coop.mjs');
    const { SEAM_QUIET } = await import('../../src/ui/Screens.js');
    const { RIDE } = await import('../../src/game/DeckLift.js');
    const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
    const { World } = await import('../../src/game/World.js');
    diskFetch();

    /* THE WORLD THE PLAYER IS STANDING IN WHEN HE PRESSES THE BUTTON. */
    const deck = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    /* …AND THE ROOMS, WHICH `main.warmStation` READS WHILE THE DECK IS UP. */
    await prepareStation();
    /**
     * THE DECK GOING AWAY IS MEASURED AND PRINTED, AND IT IS NOT ASSERTED.
     *
     * `buildWorld` disposes the old world before it builds the new one, so in
     * the game this is inside the seam too. It is not part of the bound below
     * because it is not the station's: what it costs is a fact about how much
     * the FLIGHT DECK built, and a bound here would go red for a change made
     * two files away with nothing this check could say about it. Printed
     * instead, beside the number it sits next to, so a deck that doubles its
     * teardown is visible here on the day it happens.
     */
    const dt0 = cpuMs();
    deck.world.dispose?.();
    const teardown = cpuMs() - dt0;

    /**
     * ── AND THE WINDOW IS ROUND THE SYNCHRONOUS BUILD, NOTHING ELSE ──────
     *
     * `cpuMs` counts the whole PROCESS, and this file runs its thirty checks
     * concurrently — a window opened round an `await` would bill this seam for
     * whatever the other twenty-nine were doing while it was suspended.
     * `World.loadLevel` is `for (const step of this._loadSteps(...)) step.run()`
     * and nothing else: one uninterruptible statement, which is exactly the
     * interval the player is frozen for, so a meter round THAT cannot be
     * charged for anybody else's work.
     *
     * `_cpuclock.meterCpu` is not used, for the same reason and one turn
     * further out: it sums EVERY call through the patched method, and the
     * peers building their own worlds in the same process go through the same
     * prototype. The world is identified instead — `onWorld` hands it over
     * before the build starts — so only this one's build is counted.
     *
     * The game reaches the same list through `loadLevelAsync`, which awaits a
     * frame between the seven stages. That yield does not make the work
     * cheaper; it is what lets the compositor keep the seam's own animation
     * running (see `Screens.seamMotion`), and the sum of the stages is the
     * same number either way.
     */
    let mine = null, cpu = 0;
    const real = World.prototype.loadLevel;
    World.prototype.loadLevel = function (...a) {
      const t0 = cpuMs();
      try { return real.apply(this, a); } finally { if (this === mine) cpu += cpuMs() - t0; }
    };
    let world;
    try {
      ({ world } = await bootWorld({
        level: 'station',
        settings: { mode: 'station', level: 'station', allies: 0 },
        onWorld: (w) => { mine = w; w._stationFloor = 40; },
      }));
    } finally { World.prototype.loadLevel = real; }
    const idle = idleInput();
    try {
      const t = { cpu };
      /* THE FROZEN INTERVAL, less the deck's teardown above: `World._loadSteps`
       * end to end, which is every stage of the build the player waits through
       * and the only part of the wait this file is the owner of. */
      assert(t.cpu <= SEAM_QUIET * 1000,
        `the seam freezes for ${(t.cpu / 1000).toFixed(2)} s of CPU against Screens.SEAM_QUIET's `
        + `${SEAM_QUIET} s — past that the screen itself starts telling the player the car is `
        + 'still moving, which is a thing you say to somebody who is waiting');

      /**
       * ── AND THE REST OF IT RUNS WHILE SOMETHING IS MOVING ───────────────
       *
       * Halving the freeze was done by taking the two biggest things out of
       * `dressStation` that nobody can see from inside a lift car with its
       * doors shut — the people and the fleet — and spending them on the
       * frames after the world is live. So there has to BE a remainder, or the
       * work has quietly gone back inside the seam.
       */
      assert(world._station.pending.length > 0,
        'dressStation left nothing on the deferred queue — the whole build is back inside the '
        + 'frozen interval, however fast it happens to be today');

      /**
       * AND IT FINISHES INSIDE THE DOOR ANIMATION. `dressDeckLift({arrive:
       * true})` starts the car in `STATE.OPENING`, which takes `RIDE.doors`
       * to part the leaves, and until they are parted there is no line of
       * sight out of the car at all. Everything deferred has to be standing
       * before then, or the player watches a room fill up.
       */
      const frames = Math.ceil(RIDE.doors * 60);
      const life = world._stationLife;
      let done = -1;
      for (let i = 0; i < frames; i++) {
        step(world, 1 / 60, idle);
        if (done < 0 && !world._station.pending.length && !life.priming) done = i + 1;
      }
      assert(done >= 0,
        `the deferred build was still running after ${frames} frames — the doors take `
        + `${RIDE.doors} s to open and the player is looking at an unfinished room behind them`);
      const seated = life.live.size;
      assert(seated > 4,
        `${seated} residents are standing after the doors opened; the slices are not filling the pool`);
      /* AND NOTHING IS LEFT OVER: a drain-it-all on a finished queue is a
       * no-op, which is what says the slicing terminates rather than looping. */
      assert(finishStationBuild(world) === 0, 'the deferred queue never empties');

      return `seam ${(t.cpu / 1000).toFixed(2)} s CPU + ${(teardown / 1000).toFixed(2)} s `
        + `putting the deck down (${await loadPhrase()}) against SEAM_QUIET's `
        + `${SEAM_QUIET} s; the rest finished on frame ${done} of the ${frames} the doors take, `
        + `${seated} residents standing`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: the window shows the same battle the flight deck sees', async () => {
    /**
     * V15 §1.3 asks for *"windows that look out on the same space battle the
     * hangar sees"*, and §1.6 asks for it again from a Starfury. It is one
     * thing, not two, and the way to keep it one thing is that both sides read
     * `outsideLevel(world)` — the resolver `main.js` feeds by stashing
     * `_pickedLevel` on the way in.
     *
     * ── AND THIS ASSERTS THE WIRING, BECAUSE THE WIRING IS WHAT BROKE ──────
     *
     * `hangar.mjs`'s own version of this check exists because `dressHangar`
     * called `engine.sky.configureOrbit(...)` — `sky` is three's Preetham mesh
     * and has no such method, the optional call swallowed it in silence, and
     * every bullet of the spec's PLANET and BATTLE sections described a shader
     * that had never run. `_coop.stubEngine` carries a real `SkyDome` now
     * precisely so a suite can see that. Same call, same hazard, same test.
     */
    const { world, idle } = await station(40);
    const { run: step } = await import('./_coop.mjs');
    try {
      const dome = world.engine?.skyDome;
      assert(dome, 'the stub engine has no skyDome, so this check cannot see the bug it exists for');
      assert(dome._orbit,
        'dressing the station left no orbit on engine.skyDome — the glazed walls look at a '
        + 'background colour, and #27\'s window onto the battle is a promise the code never keeps');
      assert(dome.mat?.uniforms?.uOrbit?.value === 1,
        'the orbit uniform is off, so nothing outside the glass is drawn whatever _orbit says');
      /* THE SAME RECORD ON BOTH SIDES OF THE LIFT. Not "an orbit" — the one
       * the deck would have shown, which is the whole of the ask. */
      const { outsideLevel } = await import('../../src/game/Hangar.js');
      assert(dome._orbit.level === outsideLevel(world),
        'the station published a different theatre than outsideLevel resolves — two skies that '
        + 'agree by coincidence do not stay agreeing');
      /* AND THE FLEET IN REAL GEOMETRY, not just the shader.
       *
       * FINISHED FIRST, because the fleet is no longer built inside the
       * dress: `dressStation` queues it and `drainStationBuild` spends it on
       * the frames after the world is live, so that fourteen instanced hulls
       * are not part of the interval the player is frozen for. It is behind
       * shut lift doors for 1.1 s and cannot be seen in that time. This check
       * is about the fleet existing, not about which frame it lands on, so it
       * asks for the station whole — which is the door `finishStationBuild`
       * exists for. Delete the call and the assertion below goes red, so the
       * queue cannot quietly stop draining. */
      const { finishStationBuild } = await import('../../src/game/Station.js');
      finishStationBuild(world);
      assert(world._deckBattle?.group?.parent,
        'no fleet action outside the station — the shader window is there and dressDeckBattle is not');
      const draws = world._deckBattle.group.children.length;
      assert(draws > 0 && draws <= 24,
        `the fleet outside is ${draws} draws; the deck's costs fourteen and the budget is §12.2's`);
      /* IT STEPS. A fleet that never moves is a painting. */
      const before = world._deckBattle.t;
      step(world, 0.5, idle);
      assert(world._deckBattle.t > before,
        'stepStation does not step the battle, so the ships outside are frozen');
      return `orbit on "${dome._orbit.level?.name || '?'}" · ${draws} instanced draws outside`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: an imported room that never arrives does not take the world with it', async () => {
    /**
     * THE FAILURE THIS EXISTS FOR WAS A THROWN ERROR ON THE BIGGEST SPACE IN
     * THE STATION.
     *
     * Three places carry a `room:` — #9 The Concourse, #41 Command / CIC and
     * #54 Observation dome — and `dressStation` stands a decoded `.smesh`
     * there. Between them that is about 1.5 MB fetched at the door, and
     * `placeRoom` answered a missing one with `throw`. A 404, a truncated
     * download, a cold cache or a harness that boots the level without
     * `prepareStation()` therefore did not degrade: it took the whole World
     * down, on the room every visit starts in. `living-force.mjs` boots every
     * mode the game has and this is what it found.
     *
     * So each of the three has a kit shape behind it — `vault`, `daispit`,
     * `glassdome` — and this builds all three decks with the room cache EMPTY
     * to prove they are reached and that they build something you can stand in.
     * Deliberately no `prepareStation()` anywhere in this check.
     */
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const { SHAPES } = await import('../../src/game/StationKit.js');
    const { roomOf, forgetRooms } = await import('../../src/game/Station.js');
    const { bootWorld } = await import('./_coop.mjs');
    /* The checks above this one prepared the rooms, and the cache is
     * session-lived. Empty it, or this proves nothing. */
    forgetRooms();
    const rooms = PLACES.filter((p) => p.room);
    assert(rooms.length >= 3, `only ${rooms.length} places carry a room:`);
    for (const p of rooms) {
      assert(SHAPES[p.shape], `#${p.id} ${p.name} imports '${p.room}' and has no kit shape `
        + `'${p.shape}' to fall back to — one missing file and the world does not build`);
    }
    const rows = [];
    for (const deck of [...new Set(rooms.map((p) => p.deck))]) {
      const { world } = await bootWorld({
        level: 'station',
        settings: { mode: 'station', level: 'station', allies: 0 },
        onWorld: (w) => { w._stationFloor = deck; },
      });
      try {
        const st = world._station;
        assert(st, `deck ${deck} built no station at all without its rooms`);
        for (const r of st.places.values()) {
          if (!r.place.room) continue;
          assert(!roomOf(r.place.room), `'${r.place.room}' is in the cache — this check proves nothing`);
          assert(r.group.children.length > 0,
            `#${r.place.id} ${r.place.name} is EMPTY without its mesh — you would walk into a hole`);
          rows.push(`#${r.place.id} ${r.place.name} → ${r.group.children.length} meshes from '${r.place.shape}'`);
        }
        /* And the deck is still a deck: the player can stand on it. */
        assert(st.draws > 0 && st.solids > 0, `deck ${deck} has ${st.draws} draws and ${st.solids} colliders`);
      } finally { world.dispose?.(); }
    }
    /* PUT THE SESSION BACK. The cache is session-lived and this check emptied
     * it; the gate runs every suite in one process and `SABER_CHECK_ORDER`
     * can run them backwards, so leaving it empty would hand the next reader a
     * station built from the kit and a measurement that is not the game's. */
    const { prepareStation } = await import('../../src/game/Station.js');
    diskFetch();
    await prepareStation();
    assert(roomOf('zocalo'), 'the rooms did not come back — the next suite would measure the fallback');
    return rows.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ V15 §1.2, FINDING 1: THE STANDING HAS NAMES ON IT ═══════════════════
   *
   * *"The names are cut into it, best at the top… Your own row is lit;
   * everyone else's is engraved."* and *"The dead are on it too… a name that
   * comes off the company goes onto the obelisk's fourth face."*
   *
   * Measured before the fix, deck 40, the four faces read:
   *   ["DEEPEST","NO RUN YET","—"]  ["SCORE","—","—"]
   *   ["THE ROLL","0 STANDING","0 FALLEN"]  ["RUNS","0","0 WON"]
   * — four counters and ZERO names, and the fourth face was RUNS rather than
   * the memorial. This asserts names, from the two stores that hold them.
   */
  check('station: #56 cuts real names into all four faces, and the last run is the lit row', async () => {
    const B = await import('../../src/game/StationBoards.js');
    const C = await import('../../src/game/Company.js');
    const { ARMY_IDS } = await import('../../src/game/Command.js');
    /**
     * THROUGH THE REAL WRITERS, AND WITHOUT TOUCHING THE STORE.
     *
     * The records here are the shape `Progress.recordRun` writes and the shape
     * `Company.load` hands back — every field read below is one of theirs —
     * but they are held in this check rather than written to `localStorage`.
     * The suite's checks run concurrently and half of them boot a station that
     * reads both folds; a check that cleared and reseeded the player's runs
     * and company underneath them would be measuring this and breaking those.
     * `rolls` is a pure function of the two records, which is what makes that
     * possible — and a first draft that did write the store cost this suite a
     * red in an unrelated check.
     */
    {
      const army = ARMY_IDS[0];
      /* THREE RUNS, filed in this order, so `recent[0]` is the GREY one and
       * the deepest and highest-scoring is the SITH one. Those are different
       * rows, which is the whole point: the lit row is not the top row. */
      const prog = { runs: 3, wins: 1, recent: [
        { depth: 7, score: 1200, won: null, order: 'grey', species: 'togruta', mode: 'skirmish' },
        { depth: 23, score: 9100, won: true, order: 'sith', species: 'zabrak', mode: 'skirmish' },
        { depth: 12, score: 4100, won: null, order: 'jedi', species: 'human', mode: 'skirmish' },
      ] };
      const co = {
        army,
        men: [
          { id: 'a', army, type: 'trooper', designation: 'CT-1500', kills: 41, runs: 6, xp: 300, look: { callsign: 'Ladder' } },
          { id: 'b', army, type: 'trooper', designation: 'CT-2210', nickname: 'Pip', kills: 22, runs: 3, xp: 120 },
          { id: 'c', army, type: 'trooper', designation: 'CT-3007', kills: 9, runs: 1, xp: 20 },
        ],
        fallen: [
          { designation: 'CT-7712', callsign: 'Boots', type: 'trooper', kills: 14, runs: 4, fate: 'kia' },
          { designation: 'CT-8890', nickname: 'Hitch', type: 'trooper', kills: 6, runs: 2, fate: 'left' },
        ],
      };
      /* THE STORE'S OWN SANITISERS STILL RUN OVER IT, so a name this check
       * invents cannot be a name the game could not hold: `Company.load`'s
       * `saneFallen` clamps every casualty field on the way off disk, and a
       * callsign is `cleanCallsign`'s. */
      co.fallen = co.fallen.map((f) => ({ ...f, callsign: C.cleanCallsign(f.callsign) }));

      const faces = B.rolls(prog, co);
      assert(faces.length === 4, `${faces.length} faces; §1.2 says four`);
      const heads = faces.map((f) => f.head);
      assert(heads.join('|') === 'DEEPEST|SCORE|THE ROLL|FALLEN',
        `the faces are ${heads.join(', ')} — §1.2's fourth is the memorial, not a second total`);

      const text = (r) => String(r && typeof r === 'object' ? r.t : r).toUpperCase();
      const all = faces.map((f) => f.rows.map(text).join(' | '));
      /* A NAME ON EVERY FACE. Not a count of rows — the actual strings the two
       * stores hold, which is the difference between a leaderboard and a stat
       * readout. */
      const wants = [
        [0, 'SITH ZABRAK'], [0, 'JEDI HUMAN'], [1, 'SITH ZABRAK'],
        [2, 'LADDER'], [2, 'PIP'], [3, 'BOOTS'], [3, 'HITCH'],
      ];
      const missing = wants.filter(([i, name]) => !all[i].includes(name));
      assert(missing.length === 0,
        `${missing.length} name(s) are not cut into the faces: `
        + missing.map(([i, n]) => `${n} (face ${heads[i]})`).join(', ')
        + `\n      faces: ${all.join('\n             ')}`);
      /* AND THE MEMORIAL'S SOURCE IS `Company.fallen` — the one list in the
       * tree that says who is dead, and the list #45's wall is about. */
      assert(all[3].includes('2 FALLEN'),
        `the fallen face says "${all[3]}" and Company.fallen holds 2`);

      /* YOUR OWN ROW IS LIT, AND IT IS THE RUN THAT FILED LAST. Exactly one
       * lit row per run face, and it is the GREY one — third of three by both
       * axes, so a check that only looked at the top row would pass on a bug. */
      for (const i of [0, 1]) {
        const lit = faces[i].rows.filter((r) => r && typeof r === 'object' && r.lit);
        assert(lit.length === 1, `face ${heads[i]} lights ${lit.length} rows; §1.2 lights your own`);
        assert(text(lit[0]).startsWith('GREY TOGRUTA'),
          `face ${heads[i]} lights "${text(lit[0])}" — the run that filed last was GREY TOGRUTA`);
      }
      /* …and the company's rows are ENGRAVED: no lit row on either of the two
       * faces that are not yours. */
      for (const i of [2, 3]) {
        const lit = faces[i].rows.filter((r) => r && typeof r === 'object' && r.lit);
        assert(lit.length === 0, `face ${heads[i]} lights ${lit.length} of the company's rows`);
      }

      /* AND THE VERB'S READING IS THE SAME READING — `myRow` is what #56's
       * key answers, so it cannot say a different thing from the stone. */
      const [head, line] = B.myRow(prog, co);
      assert(/GREY TOGRUTA/.test(head), `the key's reading heads "${head}"`);
      assert(/3rd of 3/.test(line),
        `the key's reading says "${line}" — the last run is 3rd of 3 by depth`);

      /* AND AN EMPTY GAME SAYS SO RATHER THAN LYING. Four heads, four rows,
       * no invented names — the state a fresh player walks into. */
      const bare = B.rolls(null, null);
      assert(bare.length === 4 && bare.every((f) => f.rows.length === 2),
        'a station with no runs and no company does not print four honest faces');

      return `4 faces: ${all.map((a, i) => `${heads[i]} ${a.split(' | ').length} rows`).join(', ')}; `
        + `7 names cut; 1 lit row per run face, 0 on the company's two`;
    }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ V15 §1.2, FINDING 2: THE COLUMN IS SEEN FROM THE DECKS ABOVE ════════
   *
   * *"you see the top of it from the Living deck's balcony and the whole of it
   * from the Concourse floor."* Measured before the fix: `deck 44: st.obelisk
   * NULL, 0 'station-obelisk' nodes`, and the same on 48 — the landmark
   * existed on one deck of three, which is the whole argument for an obelisk
   * over a screen undelivered.
   *
   * Two facts, both measured rather than asserted from the source: the column
   * is BUILT on each deck it passes, and the plate and soffit are actually CUT
   * — a raycast down the shaft that hits a floor is a column in a box.
   */
  check('station: the Standing rises through three decks, and the shaft is cut for it', async () => {
    const { PLACE, DECK_Y } = await import('../../src/game/StationPlan.js');
    const p56 = PLACE.get(56);
    assert(p56, 'the gazetteer has no #56 to raise a column in');
    /* The bearing arithmetic in `Station.standingWell` takes a min/max over
     * four corner bearings and cannot cross the ±π seam. Pin the assumption. */
    const bear = Math.atan2(p56.x, p56.z);
    assert(Math.abs(bear) < Math.PI - 0.6,
      `#56 stands at ${(bear * 180 / Math.PI).toFixed(0)}° — the well's min/max would wrap`);

    const rows = [];
    for (const deck of [40, 44, 48]) {
      const { world } = await station(deck);
      try {
        const st = world._station;
        assert(st.obelisk, `deck ${deck}: st.obelisk is NULL — no column on this deck`);
        const g = st.obelisk.group3;
        assert(g && g.children.length >= 2,
          `deck ${deck}: the column is ${g ? g.children.length : 0} meshes`);
        let nodes = 0;
        world.scene.traverse((o) => { if (o.name === 'station-obelisk') nodes++; });
        assert(nodes === 1, `deck ${deck}: ${nodes} 'station-obelisk' nodes in the scene`);
        /* IT IS THE SAME COLUMN. Same foot, same height, on all three decks —
         * three copies that drifted would be three different landmarks. */
        assert(Math.abs(st.obelisk.x - p56.x) < 0.01 && Math.abs(st.obelisk.z - p56.z) < 0.01,
          `deck ${deck}: the column stands at ${st.obelisk.x.toFixed(1)}, ${st.obelisk.z.toFixed(1)} `
          + `and #56 is at ${p56.x.toFixed(1)}, ${p56.z.toFixed(1)}`);
        assert(Math.abs(st.obelisk.h - (p56.h - 3)) < 0.01,
          `deck ${deck}: the column is ${st.obelisk.h} m and #56's hall says ${p56.h - 3}`);

        /**
         * THE CUT, MEASURED WITH A RAY. Down the shaft's centre from head
         * height on this deck: on 44 and 48 the plate is omitted there, so
         * nothing of the SHELL is under your feet; a control ray eight metres
         * along the same bearing must still hit, or the check would pass on a
         * deck with no floor at all.
         */
        const R = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        const y0 = DECK_Y[deck] + 2;
        R.set(new THREE.Vector3(p56.x, y0, p56.z), down);
        const through = R.intersectObjects(st.shell, false).length;
        const k = 1 + 9 / Math.hypot(p56.x, p56.z);
        R.set(new THREE.Vector3(p56.x * k, y0, p56.z * k), down);
        const control = R.intersectObjects(st.shell, false).length;
        assert(control > 0, `deck ${deck}: the control ray found no deck plate at all`);
        if (deck === 40) {
          assert(through > 0, `deck 40: the column's own hall has no floor under it`);
          /* …and the SOFFIT is cut, which is what "up through a cut in the
           * soffit" means: a ray up from the hall must leave the drum. */
          R.set(new THREE.Vector3(p56.x, DECK_Y[40] + 2, p56.z), new THREE.Vector3(0, 1, 0));
          const up = R.intersectObjects(st.shell, false).length;
          R.set(new THREE.Vector3(p56.x * k, DECK_Y[40] + 2, p56.z * k), new THREE.Vector3(0, 1, 0));
          const upControl = R.intersectObjects(st.shell, false).length;
          assert(up === 0 && upControl > 0,
            `deck 40: ${up} shell hits looking up the shaft (${upControl} beside it) — `
            + 'the soffit is not cut and the column ends in the ceiling');
        } else {
          assert(through === 0,
            `deck ${deck}: ${through} shell hits straight down the shaft — the plate is not cut`);
        }
        /**
         * ── AND IT STANDS OUT OF THE FLOOR IT ARRIVES AT ─────────────────
         *
         * V15 §1.2 wants the TOP of it seen from the decks above. Measured on
         * the shipped build: the cap's tip was at y = 25.00 against a deck-48
         * floor at y = 25.00 — the needle arrived exactly flush with the
         * plate, so the Working deck's landmark was a hole in the floor with a
         * point in it. The bar is two metres, which is a thing you see from
         * across a deck; #56's `h` is what sets it and this is measured off
         * the meshes rather than off `h`, because the cap is a cone on top of
         * a column on top of a plinth and only the geometry knows the sum.
         */
        const bb = new THREE.Box3();
        let tip = -Infinity;
        /* Headless, nothing renders, so nothing has updated `matrixWorld` —
         * and the column's group carries the plinth's 0.6 m in its own
         * position. Without this the box is 0.6 m short of the cap. */
        world.scene.updateMatrixWorld(true);
        g.traverse((o) => { if (o.isMesh) { bb.setFromObject(o); tip = Math.max(tip, bb.max.y); } });
        const proud = tip - DECK_Y[deck];
        if (deck !== 40) {
          assert(proud >= 2,
            `deck ${deck}: the column's tip is at y=${tip.toFixed(2)} against a floor at `
            + `y=${DECK_Y[deck].toFixed(2)} — ${proud.toFixed(2)} m of landmark on this deck`);
        }
        rows.push(`deck ${deck}: ${g.children.length} column meshes, `
          + `${st.obelisk.faces.length} faces, tip ${proud.toFixed(2)} m proud, shell ${st.shellDraws} draws`);
      } finally { world.dispose?.(); }
    }
    return rows.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ NOTHING STANDS ON AIR OVER THE WELL ═════════════════════════════════
   *
   * `Station.standingWell`'s own header says the rail "is the collider that
   * keeps anything from being over the void in the first place". It was false
   * for a third of the hole, and the fix that made the column visible on three
   * decks is what made it false: the CUT came from a polar bounding box that
   * `annulus` then quantised out to whole 5° segments (180.4 m² for a 132 m²
   * footprint), and the RAIL was laid on the original rectangle. Two
   * derivations of one region, so the hole was bigger than the fence by
   * construction, and `activeFloorAt` is a flat plane per deck — a body over
   * the hole does not fall, it STANDS ON AIR over a 25 m drop, which reads as
   * a bug in the world rather than as a mistake you made.
   *
   * ── AND IT IS A RAYCAST, BECAUSE THE FIX IS ARITHMETIC ───────────────────
   *
   * A clause that recomputed the cut and the rail from the same numbers the
   * builder uses would agree with itself on a build with no rail in it at all.
   * So this asks the SCENE: grid the cut and its margin, ray straight down at
   * every cell to find what is under the foot, then flood from the plate
   * OUTSIDE the region at knee height — which is the only thing a rail does —
   * and report every cell the flood reaches that has nothing under it.
   *
   * Measured before: deck 44 93.8 m² unfenced reaching 2.61 m out over a 12.5
   * m drop, deck 48 149.8 m² reaching 3.13 m over 25.0 m. After: 0.00 m² and
   * 0.00 m on both. `tools/_wellprobe.mjs floor` is the same measurement at a
   * finer grid and prints where the leftovers are.
   */
  check('station: no standable point over the well is unfenced', async () => {
    const { DECK_Y: DY, DRUM: D, PLACE: PL } = await import('../../src/game/StationPlan.js');
    const p56 = PL.get(56);
    const TAU2 = Math.PI * 2;
    /* The region asked for and the region a 72-segment ring can actually cut,
     * derived here ONLY to know where to point the rays. Nothing is asserted
     * off it — the assertion is what the rays found. */
    const c = Math.cos(p56.yaw), sn = Math.sin(p56.yaw);
    const C = [[-p56.w / 2, -p56.d / 2], [p56.w / 2, -p56.d / 2], [p56.w / 2, p56.d / 2], [-p56.w / 2, p56.d / 2]]
      .map(([lx, lz]) => [p56.x + lx * c + lz * sn, p56.z - lx * sn + lz * c]);
    let r1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of C) {
      r1 = Math.max(r1, Math.hypot(x, z));
      const a = Math.atan2(x, z); b0 = Math.min(b0, a); b1 = Math.max(b1, a);
    }
    let r0 = Infinity;
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = C[i], [x1, z1] = C[(i + 1) % 4];
      const dx = x1 - x0, dz = z1 - z0;
      const t = Math.max(0, Math.min(1, -(x0 * dx + z0 * dz) / (dx * dx + dz * dz)));
      r0 = Math.min(r0, Math.hypot(x0 + t * dx, z0 + t * dz));
    }
    const step = TAU2 / 72;
    const a0 = (Math.floor(b0 / step - 0.5) + 1) * step, a1 = (Math.ceil(b1 / step - 0.5)) * step;

    /**
     * A TRIANGLE INDEX. The deck is nine MERGED meshes — one per material for
     * the whole drum — so `Raycaster.intersectObjects` would test every one of
     * ~20 000 triangles against every one of ~20 000 rays. Same triangles,
     * same rays, binned by XZ so the search is not the measurement.
     */
    const index = (world, lo, hi) => {
      const CELL = 1.0, bins = new Map(), tris = [];
      const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const m = new THREE.Matrix4();
      const push = (o, mat) => {
        const g = o.geometry, pos = g?.attributes?.position;
        if (!pos) return;
        const idx = g.index, n = idx ? idx.count : pos.count;
        for (let i = 0; i + 2 < n; i += 3) {
          for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mat);
          const x0 = Math.min(v[0].x, v[1].x, v[2].x), x1 = Math.max(v[0].x, v[1].x, v[2].x);
          const z0 = Math.min(v[0].z, v[1].z, v[2].z), z1 = Math.max(v[0].z, v[1].z, v[2].z);
          if (x1 < lo.x || x0 > hi.x || z1 < lo.z || z0 > hi.z) continue;
          const id = tris.push([v[0].clone(), v[1].clone(), v[2].clone()]) - 1;
          for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
            for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
              const k2 = ix * 100000 + iz;
              let b = bins.get(k2); if (!b) bins.set(k2, b = []);
              b.push(id);
            }
          }
        }
      };
      world.scene.updateMatrixWorld(true);
      world.scene.traverse((o) => {
        if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); push(o, m.premultiply(o.matrixWorld)); } }
        else if (o.isMesh) push(o, o.matrixWorld);
      });
      const cellAt = (x, z) => bins.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) || [];
      const floorY = (x, z, yTop) => {
        let best = -Infinity;
        for (const id of cellAt(x, z)) {
          const [a, b, cc] = tris[id];
          const den = (b.z - cc.z) * (a.x - cc.x) + (cc.x - b.x) * (a.z - cc.z);
          if (Math.abs(den) < 1e-9) continue;
          const w0 = ((b.z - cc.z) * (x - cc.x) + (cc.x - b.x) * (z - cc.z)) / den;
          const w1 = ((cc.z - a.z) * (x - cc.x) + (a.x - cc.x) * (z - cc.z)) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const yy = w0 * a.y + w1 * b.y + w2 * cc.y;
          if (yy <= yTop && yy > best) best = yy;
        }
        return best;
      };
      const E1 = new THREE.Vector3(), E2 = new THREE.Vector3(), P = new THREE.Vector3(),
        T = new THREE.Vector3(), Q = new THREE.Vector3(), DD = new THREE.Vector3();
      const hitSeg = (x0, z0, x1, z1, y) => {
        DD.set(x1 - x0, 0, z1 - z0);
        const len = DD.length(); if (len < 1e-9) return false;
        DD.multiplyScalar(1 / len);
        const cells = new Set();
        for (let t = 0; t <= 1.0001; t += 0.25) cells.add(Math.floor((x0 + (x1 - x0) * t) / CELL) * 100000 + Math.floor((z0 + (z1 - z0) * t) / CELL));
        for (const k2 of cells) {
          for (const id of bins.get(k2) || []) {
            const [a, b, cc] = tris[id];
            E1.subVectors(b, a); E2.subVectors(cc, a);
            P.crossVectors(DD, E2);
            const det = E1.dot(P);
            if (Math.abs(det) < 1e-9) continue;
            const inv = 1 / det;
            T.set(x0 - a.x, y - a.y, z0 - a.z);
            const u = T.dot(P) * inv; if (u < 0 || u > 1) continue;
            Q.crossVectors(T, E1);
            const vv = DD.dot(Q) * inv; if (vv < 0 || u + vv > 1) continue;
            const dd = E2.dot(Q) * inv;
            if (dd > 1e-4 && dd < len) return true;
          }
        }
        return false;
      };
      return { floorY, hitSeg, tris: tris.length };
    };

    const CELL = 0.4, MARGIN = 4;
    const rows = [];
    for (const deck of [44, 48]) {
      const { world } = await station(deck);
      try {
        const y = DY[deck];
        const A0 = a0 - MARGIN / r1, A1 = a1 + MARGIN / r1;
        const R0 = Math.max(D.atrium + 0.2, r0 - MARGIN), R1 = Math.min(D.R - 0.2, r1 + MARGIN);
        let lox = Infinity, hix = -Infinity, loz = Infinity, hiz = -Infinity;
        for (const a of [A0, A1]) {
          for (const r of [R0, R1]) {
            const x = r * Math.sin(a), z = r * Math.cos(a);
            lox = Math.min(lox, x); hix = Math.max(hix, x); loz = Math.min(loz, z); hiz = Math.max(hiz, z);
          }
        }
        const ix = index(world, { x: lox - 2, z: loz - 2 }, { x: hix + 2, z: hiz + 2 });
        const nA = Math.ceil(((A1 - A0) * ((R0 + R1) / 2)) / CELL), nR = Math.ceil((R1 - R0) / CELL);
        const grid = [];
        for (let i = 0; i <= nA; i++) {
          const a = A0 + (A1 - A0) * (i / nA), row = [];
          for (let j = 0; j <= nR; j++) {
            const r = R0 + (R1 - R0) * (j / nR);
            const x = r * Math.sin(a), z = r * Math.cos(a);
            row.push({ x, z, drop: y - ix.floorY(x, z, y + 1.2) });
          }
          grid.push(row);
        }
        const area = ((A1 - A0) / nA) * ((R0 + R1) / 2) * ((R1 - R0) / nR);
        const floors = [];
        for (const row of grid) for (const p of row) if (p.drop < 0.6) floors.push(p);
        /* THE CONTROL. A grid that found no plate at all would report nothing
         * unfenced and pass, which is the shape of every check that measures
         * absence. */
        assert(floors.length > grid.length,
          `deck ${deck}: the grid found only ${floors.length} floored cells — it is not on the deck`);

        const key = (i, j) => i * 100000 + j;
        const seen = new Set(), q = [];
        for (let i = 0; i < grid.length; i++) {
          for (let j = 0; j < grid[i].length; j++) {
            const edge = i === 0 || i === grid.length - 1 || j === 0 || j === grid[i].length - 1;
            if (edge && grid[i][j].drop < 0.6) { seen.add(key(i, j)); q.push([i, j]); }
          }
        }
        assert(q.length > 0, `deck ${deck}: no floored cell on the border of the region to walk in from`);
        for (let head = 0; head < q.length; head++) {
          const [i, j] = q[head];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= grid.length || nj >= grid[0].length) continue;
            if (seen.has(key(ni, nj))) continue;
            const p = grid[i][j], t = grid[ni][nj];
            /* BOTH WAYS. A ray that starts inside a rail post leaves it through
             * a back face, and back faces are culled — so the reverse ray is
             * what catches a cell centre that landed in the balustrade. */
            if (ix.hitSeg(p.x, p.z, t.x, t.z, y + 0.5) || ix.hitSeg(t.x, t.z, p.x, p.z, y + 0.5)) continue;
            seen.add(key(ni, nj)); q.push([ni, nj]);
          }
        }
        const loose = [];
        for (let i = 0; i < grid.length; i++) {
          for (let j = 0; j < grid[i].length; j++) if (seen.has(key(i, j)) && grid[i][j].drop >= 0.6) loose.push(grid[i][j]);
        }
        let worst = 0, at = null;
        for (const v of loose) {
          let best = Infinity;
          for (const f of floors) { const d = Math.hypot(v.x - f.x, v.z - f.z); if (d < best) best = d; }
          if (best > worst) { worst = best; at = v; }
        }
        /* The message is built only when there is one, because `assert` takes
         * a string and a template literal is evaluated before the call. */
        assert(loose.length === 0, loose.length === 0 ? '' :
          `deck ${deck}: ${(loose.length * area).toFixed(1)} m² of the well is walkable and has nothing `
          + `under it — worst ${worst.toFixed(2)} m out at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}) `
          + `over ${at.drop.toFixed(2)} m of drop. The cut and the rail disagree.`);
        rows.push(`deck ${deck}: ${(grid.length * (nR + 1))} cells @ ${CELL} m over ${ix.tris} triangles, `
          + `0.0 m² unfenced`);
      } finally { world.dispose?.(); }
    }
    return rows.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ V15 §1.1, FINDING 3: THE NAME REACHES EVERY DECK ════════════════════
   *
   * *"shown everywhere the station names itself: the Arrivals departures board
   * (#7), the lift readout's caption, the tram platform signs (#40), the
   * Databank's station page, and the PA."*
   *
   * Measured before the fix: deck 40 → 1 board, deck 44 → 4 signs, deck 48 →
   * ZERO, and the lift's captions were the hardcoded 'Concourse' / 'Living
   * deck' / 'Working deck'. Four of §1.1's five places are asserted here; the
   * PA is the fifth and is declined with a reason — `DeckAudio`'s tannoy is a
   * formant synthesiser with no words in it by design, and giving it speech is
   * the narrator its own header refuses. See `Station.beginStationName`.
   */
  check('station: the name is on every deck, and the lift readout still matches its button', async () => {
    const { liftFloors, liftPick } = await import('../../src/game/DeckLift.js');
    const { FACTIONS } = await import('../../src/game/Databank.js');
    const S = await import('../../src/game/StationSave.js');
    const was = S.stationName();
    /* A name nothing else in the tree could produce, so a stale hardcoded
     * string cannot pass this by coincidence. */
    S.setStationName('Testport');
    try {
      const decks = liftFloors().filter((f) => f.deck);
      /* ── AND THE BAR IS THE GAZETTEER, NOT A NUMBER ──────────────────────
       *
       * This asserted `decks.length >= 3`, which the three drum decks satisfied
       * for ever: it could not tell a lift that reaches every deck from one
       * that reaches half of them, and it sat green through the whole of the
       * flight-ops decks and the observation dome being unreachable. The bar
       * is every deck the plan puts a room on — see the reachability check
       * above, which is the same statement from the room's side. */
      const { PLACES } = await import('../../src/game/StationPlan.js');
      const want = [...new Set(PLACES.filter((p) => !p.external && p.deck != null).map((p) => p.deck))];
      const missing = want.filter((d) => !decks.some((f) => f.deck === d));
      assert(missing.length === 0,
        `the lift reaches ${decks.length} station decks and the gazetteer has rooms on `
        + `${want.length}: nothing stops at deck ${missing.join(', ')}`);
      const blind = decks.filter((f) => !String(f.label).includes('Testport'));
      assert(blind.length === 0,
        `${blind.length} lift floors do not name the station: ${blind.map((f) => f.label).join(', ')}`);
      /* THE DATABANK'S STATION PAGE. */
      assert(FACTIONS.station.name === 'Testport',
        `the Databank's station page is headed "${FACTIONS.station.name}"`);
      assert(String(FACTIONS.station.note).includes('Testport'),
        'the Databank\'s station page never says the name in its paragraph');

      const { RIDE, STATE, atTheDoors, liftKey } = await import('../../src/game/DeckLift.js');
      const { run: step, idleInput } = await import('./_coop.mjs');
      const rows = [];
      for (const deck of [40, 44, 48]) {
        const { world, idle } = await station(deck);
        try {
          const st = world._station;
          const lift = world._deckLift;
          assert(lift, `deck ${deck} dressed no lift`);

          /**
           * CALL THE CAR AND READ WHAT IT SAYS. The station's car goes AWAY
           * once you have stepped out of it, and a car that is away prints the
           * flight deck; only a car WAITING with its doors open prints the
           * button column's answer, which is the caption V15 §1.1 is about.
           * The doors are found by asking `atTheDoors` rather than by
           * repeating `DeckLift`'s frame arithmetic here — a second copy of
           * that would be the hand-maintained twin HANDOFF §2.3 warns about.
           */
          const sh = st.shaft;
          let found = null;
          for (let dr = 0; dr <= 8 && !found; dr += 0.5) {
            for (let a = 0; a < 32 && !found; a++) {
              const th = (Math.PI * 2 * a) / 32;
              const x = sh.x + Math.cos(th) * dr, z = sh.z + Math.sin(th) * dr;
              world.player.position.set(x, st.deckY + 1.0, z);
              if (atTheDoors(world)) found = [x, z];
            }
          }
          assert(found, `deck ${deck}: no point within 8 m of the shaft is "at the doors"`);
          /* OUT OF THE DOORWAY FIRST, or the car never closes and never
           * leaves: it is still standing here with its doors open, which is
           * not the state whose caption this check is about. */
          world.player.position.set(sh.x * 0.6, st.deckY + 1.0, sh.z * 0.6);
          step(world, 8.0, idle);
          assert(lift.state === STATE.AWAY,
            `deck ${deck}: the car is ${lift.state} rather than away, so it cannot be called`);
          world.player.position.set(found[0], st.deckY + 1.0, found[1]);
          assert(liftKey(world), `deck ${deck}: the call key at the doors was not taken`);
          step(world, RIDE.arrive + RIDE.doors + 0.4, idle);
          assert(lift.state === STATE.WAIT, `deck ${deck}: the called car is ${lift.state}`);
          /**
           * ── AND IT ALREADY SAYS THIS DECK, WITHOUT BEING ASKED ─────────
           *
           * `st.pick` initialised to 0, which is `MENU_FLOOR` — so a car
           * standing open on deck 48 read `07 BRIDGE`, the hangar's word for
           * the main menu, on the one thing on that deck that carries the
           * station's name. Confirmed in the browser: `{"pick":0}`. The clause
           * below then SET the pick before reading the caption, which is how a
           * check that is about the name on every deck sat over this for a
           * whole lane. Read it first, then set it.
           */
          assert(lift.readout.number === deck,
            `deck ${deck}: the car you arrived in reads ${String(lift.readout.number).padStart(2, '0')} `
            + `"${lift.readout.caption}" — it is standing on ${deck}`);
          assert(lift.readout.caption.includes('TESTPORT'),
            `deck ${deck}: the arrived car reads "${lift.readout.caption}" and names no station`);
          /* The button column, on this deck's own floor. */
          const idx = liftFloors().findIndex((f) => f.deck === deck);
          lift.pick = idx;
          step(world, 0.05, idle);
          /* THE RULE `decklift.mjs` HOLDS, held here too: the readout is the
           * button column's answer. The name went in at the LABEL, which is
           * the one string both of them read, so they cannot disagree. */
          assert(lift.readout.caption === String(liftPick(world).label).toUpperCase(),
            `deck ${deck}: the readout says "${lift.readout.caption}" and the column is on `
            + `"${liftPick(world).label}"`);
          assert(lift.readout.caption.includes('TESTPORT'),
            `deck ${deck}: the lift readout reads "${lift.readout.caption}" and names no station`);

          /* AND HOW MANY THINGS IN THE ROOM SAY IT. A board, a platform sign,
           * the register, the caption — at least one on every deck, which is
           * the clause deck 48 failed with a zero. */
          const boards = (st.boards || []).filter((b) => (b.panel._rows || []).some(
            (r) => String(r && typeof r === 'object' ? r.t : r).includes('Testport'))).length;
          /* THE ZERO THIS CLAUSE PRINTED AND DID NOT ASSERT. Counted per deck:
           * 40 → 1, 44 → 4, 48 → 0. §1.1's rule is a board at the door of
           * every place you can leave from, and every door it had named was on
           * the two decks a passenger arrives through, so the Working deck got
           * nothing at all — see `StationBoards.dressBoards`. */
          assert(boards >= 1,
            `deck ${deck} carries ${boards} boards with the station's name on them — `
            + 'the deck never says where you are');
          const register = st.register ? 1 : 0;
          rows.push(`deck ${deck}: ${boards} board(s) + ${register} register + 1 lift caption `
            + `("${lift.readout.caption}")`);
        } finally { world.dispose?.(); }
      }
      return rows.join('; ');
    } finally { S.setStationName(was); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ THE CAR SAYS WHERE IT IS, AND STILL RIDES OUT TO THE MENU ═══════════
   *
   * Two facts that pull against each other, which is why they are asserted
   * together. The button column now starts on the deck the car is standing on,
   * so the readout names the station the moment the doors open instead of
   * saying `07 BRIDGE` — but the column is also what the ride out reads, and a
   * lift that takes you to the floor you are standing on would reload the room
   * you are in. `DeckLift.floorTarget` is the seam: the pick is what the
   * column shows, the menu is where an untouched car goes.
   *
   * A fix for either half alone breaks the other, and this is the clause that
   * says so.
   */
  check('station: the car you arrive in names the deck, and an untouched ride still ends on the menu', async () => {
    const { LIFT } = await import('../../src/game/Hangar.js');
    const { RIDE, STATE, liftPick, liftKey, atTheDoors } = await import('../../src/game/DeckLift.js');
    const { run: step, idleInput } = await import('./_coop.mjs');
    const S = await import('../../src/game/StationSave.js');
    const was = S.stationName();
    S.setStationName('Testport');
    const rows = [];
    try {
      for (const deck of [44, 48]) {
        const { world } = await station(deck);
        const idle = idleInput();
        try {
          const st = world._deckLift, sh = world._station.shaft;
          assert(st, `deck ${deck} dressed no lift`);
          /* THE FIRST THING THE PLAYER SEES: the doors part on the deck he
           * has arrived at. This read `32 FLIGHT DECK` — the deck he left. */
          step(world, RIDE.doors + 0.2, idle);
          assert(st.state === STATE.OUT || st.state === STATE.OPENING,
            `deck ${deck}: the arrived car is ${st.state}`);
          assert(st.readout.number === deck,
            `deck ${deck}: the car you stepped out of reads `
            + `${String(st.readout.number).padStart(2, '0')} "${st.readout.caption}"`);
          const arrival = `${String(st.readout.number).padStart(2, '0')} ${st.readout.caption}`;
          assert(st.readout.caption.includes('TESTPORT'),
            `deck ${deck}: the arrived car reads "${st.readout.caption}" and names no station`);

          /* OUT, AND LET IT GO. Then call it back, which is the state whose
           * caption `decklift.mjs` pins to the button column. */
          world.player.position.set(sh.x * 0.6, world._station.deckY + 1.0, sh.z * 0.6);
          world.player.body?.setTransform?.(world.player.position, null);
          step(world, 8.0, idle);
          assert(st.state === STATE.AWAY, `deck ${deck}: the car is ${st.state} rather than away`);
          let found = null;
          for (let dr = 0; dr <= 8 && !found; dr += 0.5) {
            for (let a = 0; a < 32 && !found; a++) {
              const th = (Math.PI * 2 * a) / 32;
              const x = sh.x + Math.cos(th) * dr, z = sh.z + Math.sin(th) * dr;
              world.player.position.set(x, world._station.deckY + 1.0, z);
              if (atTheDoors(world)) found = [x, z];
            }
          }
          assert(found && liftKey(world), `deck ${deck}: the call key at the doors was not taken`);
          step(world, RIDE.arrive + RIDE.doors + 0.4, idle);
          assert(st.state === STATE.WAIT, `deck ${deck}: the called car is ${st.state}`);
          assert(st.readout.caption === String(liftPick(world).label).toUpperCase(),
            `deck ${deck}: the readout says "${st.readout.caption}" and the column is on `
            + `"${liftPick(world).label}"`);
          assert(st.readout.number === deck,
            `deck ${deck}: the waiting car reads ${String(st.readout.number).padStart(2, '0')} `
            + `"${st.readout.caption}" — the button column has never been pressed and it is here`);

          /* AND NOW STEP IN AND TOUCH NOTHING. `place` is the lift's own
           * lift-space-to-world map, so this does not repeat the shaft's
           * transform; `assert` above has already proved the car is here. */
          let left = 0, lifted = null;
          world.onDeckLeave = () => { left++; };
          world.onDeckLift = (row) => { lifted = row; };
          const at = st.place(LIFT.x, 0, LIFT.z);
          world.player.position.set(at.x, at.y + 1.0, at.z);
          world.player.body?.setTransform?.(world.player.position, null);
          step(world, 1.4 + RIDE.doors + RIDE.settle + RIDE.ride, idle);
          assert(st.state === STATE.GONE, `deck ${deck}: after the ride the car is ${st.state}`);
          assert(left === 1 && !lifted,
            `deck ${deck}: an untouched car rode to ${lifted ? `"${lifted.label}"` : 'nowhere'} and `
            + `raised onDeckLeave ${left} times — stepping in with nothing pressed is the way out, `
            + 'and the column showing this deck must not make it a reload of this deck');
          rows.push(`deck ${deck}: arrived on "${arrival}", rode out to the menu unasked`);
        } finally { world.dispose?.(); }
      }
      return rows.join('; ');
    } finally { S.setStationName(was); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ V15 §1.1/§1.2, FINDING 4: THE VERB AND THE KEY AGREE ════════════════
   *
   * #56's prompt says *"read the rolls — find your own row"* and the key
   * answered NAME THE STATION. §1.1 says where naming belongs: *"the Databank
   * terminal (#13) and the plan table in your own cabin."*
   */
  check('station: the clock is a thing the panels can wind, and stepStation is its only other caller', async () => {
    /**
     * ══ THE CLOCK STOPPED BEHIND EVERY PANEL ═══════════════════════════
     *
     * `Screens.take` sets `world.paused`, and `main.js`'s frame loop calls
     * `world.update` only while the state is 'playing' or 'dead'. So with any
     * card up, `StationDirector.update` → `stepStation` → `st.hour += dt/120`
     * did not run and the station clock was frozen for as long as you looked
     * at the board. That is not cosmetic in the one room built to be watched:
     * a race is `runs: 0.3` h — 36 real seconds — so the tote was two stills.
     * Driven at #19 at 15:15 with a race live, before the fix:
     *
     *     hour before 15.25   hour after 15.25   (5400 × world.update(1/60))
     *
     * The fix is `tickStationClock` — the eight lines of clock at the top of
     * `stepStation`, split out so the tote's panel can wind the SAME number
     * rather than keeping an hour of its own. This holds both halves: that a
     * paused world's clock really does stand still through `update`, that the
     * split-out function moves it, and that the clock exists in exactly one
     * place. Two copies of `st.hour += dt / 120` would be the hand-maintained
     * twin, and the panel and the station would disagree by however much they
     * had drifted — which is the failure `Tote.watch`'s signature exists to
     * make impossible.
     */
    const St = await import('../../src/game/Station.js');
    assert(typeof St.tickStationClock === 'function',
      'Station.js exports no clock a panel can wind — a watched race cannot advance');
    const src = await readFile(new URL('../../src/game/Station.js', import.meta.url), 'utf8');
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const winds = (bare.match(/st\.hour\s*\+=/g) || []).length;
    assert(winds === 1, `${winds} places in Station.js advance st.hour — the clock must have one`);

    const { world } = await station(40);
    try {
      const st = world._station;
      st.hour = 15.25;
      /* A PANEL IS UP: paused, and the frame loop would not be calling this
       * at all. `update` is driven here anyway to show it is not the loop's
       * `if` alone doing the work — a paused world ignores the frame. */
      world.paused = true;
      const before = st.hour;
      for (let i = 0; i < 600; i++) world.update(1 / 60, null);
      assert(st.hour === before,
        `a paused world moved the clock ${before} → ${st.hour} — this check is measuring nothing`);
      /* AND THE PANEL'S OWN WINDING MOVES IT, at the rate §3.4 names: one game
       * hour per two real minutes, so ninety real seconds is 0.75 h. */
      for (let i = 0; i < 5400; i++) St.tickStationClock(world, 1 / 60);
      const moved = st.hour - before;
      assert(Math.abs(moved - 0.75) < 1e-6,
        `ninety real seconds moved the station clock ${moved.toFixed(4)} h and §3.4 says 0.75`);
      /* AND IT REPUBLISHES THE DAY AND WRAPS AT MIDNIGHT — everything seeded
       * off the date reads `st.day`, and a panel that wound the hour without
       * republishing it would hand `Tote.watch` a day the station is no longer
       * on. The wrap matters for the same reason: `stationDay` reads an hour
       * that `stepStation` keeps under 24, so a panel that let it run past
       * would break the invariant the whole calendar is derived through. */
      const S2 = await import('../../src/game/StationSave.js');
      st.hour = 23.9;
      for (let i = 0; i < 1500; i++) St.tickStationClock(world, 1 / 60);
      assert(st.hour < 1, `the clock did not wrap under 24: ${st.hour}`);
      assert(st.day === S2.stationDay(st.hour),
        `the panel wound the hour to ${st.hour.toFixed(2)} and left the day at ${st.day}`);
      return `paused: 600 frames moved the hour 0.0000; tickStationClock moved it ${moved.toFixed(4)} h `
        + `in ninety real seconds, wrapped at midnight and republished day ${st.day}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: a day actually passes, the game says so, and it survives a reload', async () => {
    /**
     * ══ THE STATION HAD ONLY EVER HAD ONE DAY ═══════════════════════════
     *
     * *"the shops don't always have the same things"*, and *"the same shop
     * owner doesnt always look the same … otherwise it would get stale seeing
     * the same people always doing the same things."*
     *
     * `StationSave.stationDay(h)` was `Math.floor(h / 24) + seen.length`, and
     * both terms were structurally zero: `setStationHour` wraps the hour into
     * [0, 24) on every write and `tickStationClock` wraps `st.hour` every
     * frame, so the quotient was 0; `markSeen` is the only writer of `seen`
     * and it has no callers anywhere in `src/` or `tools/`, so the sum was 0.
     * Measured before the fix — driving the shipped doors, in node:
     *
     *     +10 h → day 0    +24 h → day 0    +100 h → day 0
     *     +500 h → day 0   +1000 h → day 0
     *
     * That is 1634 station hours, 68 in-game days, some 33 real hours of play,
     * and the answer never moved. In the live build, 80 station hours on deck
     * 40 left `st.day` at 0 and the clothier's shelf came back byte-identical.
     * The shelves, the keepers, the residents' faces, the job board, the pit's
     * card, the tote programme, the casino seats and the bar's leave roll are
     * every one of them seeded off that number: six files thread a `day`
     * correctly and all six were being handed a constant.
     *
     * ══ WHY NOTHING CAUGHT IT, AND WHAT THIS CHECK DOES INSTEAD ═════════
     *
     * Every existing clause in this tree hands `day` in AS AN ARGUMENT —
     * `shelfFor(counter, day)`, `occupant(p, i, { day })`, `opponentAt(place,
     * day, seat)` — and then measures that two different arguments give two
     * different rooms. Which they do, and always did. Not one of them ever
     * asked whether the GAME advances the argument. So this check never passes
     * a day to anything: it drives the clock through the two doors the game
     * uses — `passStationHours`, which every ending calls with the run's own
     * seconds, and `world.update`, the shipped frame loop — and then reads the
     * day the GAME reports back, off `world._station.day` and off the fold.
     */
    const S = await import('../../src/game/StationSave.js');
    const C = await import('../../src/game/Counter.js');
    const V = await import('../../src/game/Vendors.js');
    const L = await import('../../src/game/StationLife.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');

    /* ── 1. A RUN IS THE SOMETHING ELSE, and it is hours, so it is days ────
     * `record()` calls this with `world.time * HOURS_PER_SECOND` on every
     * ending. Deltas rather than absolutes because the suite's checks run
     * concurrently and other station worlds are winding the same clock — the
     * day is monotone, so a delta is the only safe reading. */
    const d0 = S.stationDay();
    const h0 = S.stationHour();
    S.passStationHours(24);
    const d1 = S.stationDay();
    assert(d1 === d0 + Math.floor((h0 + 24) / 24),
      `+24 station hours from ${h0.toFixed(2)}:00 moved the day ${d0} → ${d1}`);
    const h1 = S.stationHour();
    S.passStationHours(100);
    const d2 = S.stationDay();
    assert(d2 === d1 + Math.floor((h1 + 100) / 24),
      `+100 station hours from ${h1.toFixed(2)}:00 moved the day ${d1} → ${d2}`);

    /* ── 2. AND IT NEVER GOES BACKWARDS ───────────────────────────────────
     * A screen setting the wall clock — `medbay.mjs` drives 23:00 then 01:00
     * to test the night — must not un-happen a day the player lived. */
    S.setStationHour(1);
    assert(S.stationDay() === d2, `setting the clock back to 01:00 moved the day ${d2} → ${S.stationDay()}`);
    S.setStationHour(-5);
    assert(S.stationDay() === d2, `a negative hour moved the day ${d2} → ${S.stationDay()}`);
    S.setStationHour(NaN);
    assert(S.stationDay() === d2, `a NaN hour moved the day ${d2} → ${S.stationDay()}`);

    /* ── 3. AND THE GAME'S OWN FRAME LOOP CROSSES MIDNIGHT ────────────────
     * Not `tickStationClock` called by hand: `world.update(1/60, idle)`, which
     * is what `main.js` runs, through `StationDirector` → `stepStation`. The
     * clock is set to 23.8 rather than run for 172 800 frames because the rate
     * is asserted to §3.4's digit by the check above this one; what is unknown
     * here is what happens AT the wrap, and that is thirty seconds away. */
    const { world } = await station(40);
    let frames = 0, beforeDay = 0, afterDay = 0, beforeHour = 0, afterHour = 0;
    try {
      const st = world._station;
      const idle = (await import('./_coop.mjs')).idleInput();
      st.hour = 23.8;
      beforeDay = S.stationDay();
      beforeHour = st.hour;
      /* Thirty real seconds = 0.25 station hours: enough to pass 24:00. */
      for (; frames < 1800; frames++) world.update(1 / 60, idle);
      afterHour = st.hour;
      afterDay = st.day;
      assert(afterHour < 1,
        `1800 frames of the shipped loop left the clock at ${afterHour.toFixed(3)} — it did not reach midnight`);
      assert(afterDay === beforeDay + 1,
        `the game crossed midnight and its own day went ${beforeDay} → ${afterDay}`);
      /* THE WORLD AND THE FOLD ARE ONE NUMBER. Two readers that disagreed
       * about the date would put two different stations in one hull. */
      assert(S.stationDay() === afterDay,
        `the world says day ${afterDay} and the fold says ${S.stationDay()}`);

      /* ── 4. AND THE ROOM IS A DIFFERENT ROOM FOR IT ────────────────────
       * The day the GAME reports, handed to the readers, must actually change
       * what they put out — otherwise the counter is turning over a number
       * nothing reads. Three of the six: the shelf, the keeper, the faces. */
      const clothier = V.COUNTERS.find((c) => (c.stock || []).length >= 8) || V.COUNTERS[0];
      const shelfWas = JSON.stringify(C.shelfFor(clothier, beforeDay).map((r) => r.id));
      const shelfNow = JSON.stringify(C.shelfFor(clothier, afterDay).map((r) => r.id));
      assert(shelfWas !== shelfNow,
        `${clothier.id}'s shelf is byte-identical on day ${beforeDay} and day ${afterDay}: ${shelfNow}`);
      const St = await import('../../src/game/Station.js');
      const keeperWas = St.keeperOf(clothier.id, null, beforeDay);
      const keeperNow = St.keeperOf(clothier.id, null, afterDay);
      assert(keeperWas.name !== keeperNow.name,
        `${clothier.id}'s keeper is ${keeperNow.name} on both day ${beforeDay} and day ${afterDay}`);
      const concourse = PLACE.get(9);
      const faceWas = L.occupant(concourse, 0, { day: beforeDay }).name;
      const faceNow = L.occupant(concourse, 0, { day: afterDay }).name;
      assert(faceWas !== faceNow,
        `slot 0 of the Concourse is ${faceNow} on both day ${beforeDay} and day ${afterDay}`);
    } finally { world.dispose?.(); }

    /* ── 5. AND IT SURVIVES A RELOAD ──────────────────────────────────────
     * *"the same day for everyone, and it changes tomorrow"* is worth nothing
     * if closing the tab puts the station back to Monday. A second module
     * instance is a reload: its own `_cache` is empty and it re-reads
     * `saber.station.v1` off the store, which is the path a fresh page takes.
     * NO FOURTH KEY — `session.mjs` counts the durable writers in this tree
     * and refuses one — so this asserts the day came back out of the station's
     * OWN record. */
    const fresh = await import(`../../src/game/StationSave.js?reload=${Date.now()}`);
    assert(fresh.stationDay() === afterDay,
      `a reload read day ${fresh.stationDay()} back out of saber.station.v1 and the game left it on ${afterDay}`);
    assert(Object.keys(fresh.loadStation()).includes('day'),
      'the reloaded fold has no day field — the day is being derived again rather than stored');

    return `+24 h: day ${d0}→${d1}; +100 h: →${d2}; a clock set back/negative/NaN: still ${d2}; `
      + `${frames} frames of world.update from ${beforeHour.toFixed(2)}:00 wrapped to `
      + `${afterHour.toFixed(2)}:00 and the game reported day ${beforeDay}→${afterDay}; `
      + `a reload read ${fresh.stationDay()}`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: #51 charges a droid, and hands a man the press back', async () => {
    /**
     * ══ V16 Lane B5's *"instead of"*, and it had no door ══════════════════
     *
     * *"droids charge instead of eating."* `Food.eat`'s refusal to a droid
     * names this room in as many words — *"there is a rack of posts at the
     * droid pool"* — and #51 dispatched to nothing at all, so `Food.CHARGES`
     * and `Food.offeredTo` had zero callers outside their own file and a
     * separatist roll could buy food, watch it cooked, carry it home, be
     * refused at the cupboard and be sent to an empty room. Measured before
     * this branch: the key at #51 answered with the gazetteer verb and no
     * hook was raised.
     *
     * AND THE BRANCH DOES NOT CLAIM A PRESS IT DID NOT USE, which is the
     * lesson of #20's pit door two branches along: `main.js` hands the press
     * back for anybody with a stomach, and the room answers him anyway.
     *
     * ── WHAT THE MAN GETS BACK IS NO LONGER THE VERB ──────────────────────
     *
     * This clause used to assert that a man at #51 was shown `place.verb` —
     * *"call the astromech"*, the interact prompt printed by the interact key.
     * That was the whole of §14's defect and it is gone: the fall-through now
     * lands on `StationCast.roomLine`, which says what is in the room off
     * §3.2's own `who` and `idle` columns. The PROPERTY the clause was written
     * for is unchanged and is what is measured — the rack is asked, it
     * refuses, and the press is not eaten — and the sibling clause "no place
     * answers the interact key by printing its own verb" now holds the other
     * half over all sixty-two rooms.
     */
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const St = await import('../../src/game/Station.js');
    const a = await station(48);
    try {
      const { world } = a;
      const st = world._station;
      const p51 = PLACE.get(51);
      assert(p51 && p51.deck === 48, '#51 is not on deck 48 any more');
      let said = null, charged = 0;
      world.notify = (h, l) => { said = `${h} :: ${l}`; };

      /* ── A DROID: the room takes the press. ─────────────────────────── */
      world.onCharge = (id) => { charged = id; return true; };
      world.player.position.set(p51.x, st.deckY + 1.6, p51.z);
      said = null;
      assert(St.stationKey(world), '#51 did not answer the key at all');
      assert(charged === 51, `the key at #51 raised ${charged || 'nothing'} — the rack has no door`);
      assert(said === null, 'the room both charged and printed its verb — one press, one answer');

      /* ── A MAN: the hook refuses and the room answers him anyway. ───── */
      charged = 0; said = null;
      world.onCharge = (id) => { charged = id; return false; };
      assert(St.stationKey(world), '#51 stopped answering the key when the rack refused');
      assert(charged === 51, 'the room was not even asked');
      assert(said && said.startsWith('DROID POOL'),
        `a man at #51 got "${said}" instead of the room's own answer — a branch that claims a press `
        + 'it did not use is the defect #20 was fixed for');
      assert(!said.endsWith(p51.verb),
        `#51 answered the key with its own prompt — "${said}"`);

      /* ── AND WITH NO PANEL WIRED AT ALL, nothing changes. ───────────── */
      delete world.onCharge;
      said = null;
      assert(St.stationKey(world), '#51 went dead with no handler installed');
      assert(said && said.startsWith('DROID POOL') && !said.endsWith(p51.verb),
        `#51 with no handler said "${said}"`);
      return `#51 raised the rack for a droid; refused, it fell through to "${said}"`;
    } finally { a.world.dispose?.(); }
  });

  /**
   * ══ #25 LOST & FOUND: THE WALL HAS WORDS ON IT ══════════════════════════
   *
   * THE DEFECT THIS CLAUSE IS WRITTEN AGAINST. `SHAPES.noticewall` laid forty
   * blank slabs under a verb that says *"read the notices"* and a look that
   * says *"notices change daily"*, and V15 §1.3.4 asks this room for the
   * home's address in as many words — *"printed on the door and on the notice
   * board (#25)"*. Driven through the real door before `Notices.js`:
   *
   *     {"said":[["LOST & FOUND","read the notices"]],"meshes":7,"texts":0}
   *
   * ZERO textures in the room and no address anywhere on it. So four things
   * are asserted and every one of them was false on the tree that shipped it:
   *
   *   THE WALL IS WRITTEN ON     `texts > 0` in the room's own group, counted
   *                              off the merged meshes exactly as a player's
   *                              eye counts them.
   *   THE ADDRESS IS ON IT       §1.3.4, and it is `Home.homeAddress`'s own
   *                              string rather than a second spelling of it.
   *   IT CHANGES DAILY           two different days are two different boards,
   *                              which is the gazetteer's own line for #25.
   *   IT IS THE SAME BOARD FOR EVERYBODY   one day is one board however many
   *                              times it is asked — `Counter.shelfFor`'s law,
   *                              and the reason none of this is `Math.random`.
   *
   * The draw cost is asserted with them, because §12.2's 400 is what stops the
   * answer to "the room is empty" being "put four hundred things in it".
   */
  check('station: #25 has notices on it, and one of them is your own address', async () => {
    const N = await import('../../src/game/Notices.js');
    const { homeAddress } = await import('../../src/game/Home.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const St = await import('../../src/game/Station.js');
    assert(/read the notices/.test(PLACE.get(25).verb), `#25's verb is "${PLACE.get(25).verb}"`);

    /* ── THE CONTENT, WITHOUT A WORLD ─────────────────────────────────── */
    const day0 = N.noticesFor(0, 13), day1 = N.noticesFor(1, 13);
    assert(day0.length > 4, `#25's board carries ${day0.length} notices on day 0`);
    const addr = homeAddress(PLACE.get(27));
    assert(day0.some((n) => n.rows.includes(addr)),
      `no notice on day 0 carries the home's address ${addr} — V15 §1.3.4 asks for it by name; `
      + `the board says ${JSON.stringify(day0.map((n) => n.rows[0]))}`);
    /* SAME DAY, SAME BOARD — twice, and it is the whole reason nothing here
     * touches `Math.random`. */
    assert(JSON.stringify(N.noticesFor(0, 13)) === JSON.stringify(day0),
      'the board is different the second time it is read on the same day');
    assert(JSON.stringify(day1) !== JSON.stringify(day0),
      '#25 reads the same on day 0 and day 1 — the gazetteer says "notices change daily"');
    /* NOTHING RUNS OFF THE SLAB. `signPanel` neither wraps nor measures, so a
     * row wider than its canvas is drawn off both edges of the panel; 300 days
     * of every writer is the sweep that keeps a new line honest. */
    let widest = 0, over = [];
    for (let d = 0; d < 300; d++) {
      for (const n of N.noticesFor(d, 13)) {
        for (let i = 0; i < n.rows.length; i++) {
          const w = N.rowWidth(n.rows.length, i === 0);
          widest = Math.max(widest, n.rows[i].length);
          if (n.rows[i].length > w) over.push(`day ${d} ${n.id}: "${n.rows[i]}" > ${w}`);
        }
      }
    }
    assert(!over.length, `${over.length} rows run off the slab: ${over.slice(0, 4).join('; ')}`);

    /* ── AND THE SAME THING, ON GEOMETRY, IN A REAL ROOM ──────────────── */
    const a = await station(40);
    try {
      const { world } = a;
      const st = world._station;
      assert(st.notices?.at?.length,
        'SHAPES.noticewall hands back no slab positions — nothing can write on the wall');
      const rec = [...st.places.values()].find((r) => r.place.id === 25);
      assert(rec, 'deck 40 built no #25');
      let meshes = 0, texts = 0;
      rec.group.traverse((o) => { if (o.isMesh) { meshes++; if (o.material?.map) texts++; } });
      assert(texts >= 8,
        `#25 has ${meshes} meshes and ${texts} of them carry a texture — the room was 7 and 0, `
        + 'which is forty blank rectangles under a verb that says "read the notices"');
      const printed = (st.notices.panels || []).flatMap((p) => p.panel._rows || []);
      assert(printed.includes(addr), `nothing on the wall reads ${addr}; it reads ${JSON.stringify(printed.slice(0, 6))}`);
      /* §12.2, and the room is charged for what it added. */
      assert(st.draws <= 400, `deck 40 draws ${st.draws} with the notices up — §12.2's bound is 400`);

      /* THE KEY READS THE WALL RATHER THAN RECITING THE VERB. */
      let said = null;
      world.notify = (h, l) => { said = `${h} :: ${l}`; };
      const p25 = PLACE.get(25);
      world.player.position.set(p25.x, st.deckY + 1.6, p25.z);
      assert(St.stationKey(world), '#25 did not answer the key at all');
      assert(said && said !== `LOST & FOUND :: ${p25.verb}`,
        `#25 still answers with its own verb: "${said}"`);
      assert(/LOST & FOUND/.test(said), `#25 answered "${said}"`);

      /* IT RE-CUTS WHEN THE DAY TURNS AND NEVER OTHERWISE — the stamp, which
       * is what keeps a canvas upload off the frame. */
      assert(!N.stepNotices(world, st), 'the wall re-cut itself on a day that had not turned');
      st.day = (st.day ?? 0) + 1;
      assert(N.stepNotices(world, st), 'the day turned and the wall did not change');
      return `#25: ${meshes} meshes, ${texts} written, ${st.notices.panels.length} notices, `
        + `address ${addr} on the wall, deck 40 ${st.draws} draws of 400, widest row ${widest} chars`;
    } finally { a.world.dispose?.(); }
  });

  check('station: #56 reads the rolls, and the station is named at #13 and at the plan table', async () => {
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const St = await import('../../src/game/Station.js');
    const S = await import('../../src/game/StationSave.js');
    assert(/read the rolls/.test(PLACE.get(56).verb), `#56's verb is "${PLACE.get(56).verb}"`);
    assert(/name the station/i.test(PLACE.get(13).verb),
      `#13's verb is "${PLACE.get(13).verb}" and §1.1 sets the name there`);
    assert(/name the station/i.test(PLACE.get(27).verb),
      `#27's verb is "${PLACE.get(27).verb}" and §1.1 sets the name at the plan table`);

    const was = S.stationName();
    const out = [];
    /* ── DECK 40: the obelisk reads, the register writes ─────────────── */
    const a = await station(40);
    try {
      const { world } = a;
      const st = world._station;
      let said = null, kiosk = null;
      world.notify = (h, l) => { said = `${h} :: ${l}`; };
      world.onKiosk = (id) => { kiosk = id; };

      const p56 = PLACE.get(56);
      world.player.position.set(p56.x, st.deckY + 1.6, p56.z);
      assert(St.stationKey(world), '#56 did not answer the key at all');
      assert(!St.namingStation(world),
        '#56 still opens the naming field — the verb says it reads the rolls');
      assert(said && /YOUR ROW|THE STANDING/.test(said), `#56 answered "${said}"`);
      out.push(`#56 → ${said.split(' :: ')[0]}`);

      /* THE REGISTER, which is one terminal of eight. */
      assert(st.register, '#13 dressed no register panel');
      said = null; kiosk = null;
      world.player.position.set(st.register.x, st.deckY + 1.6, st.register.z);
      assert(St.atRegister(world), 'standing on the register is not "at the register"');
      assert(St.stationKey(world), 'the register did not answer the key');
      assert(St.namingStation(world), 'the register did not open the naming field');
      assert(kiosk === null, `the register also raised the '${kiosk}' kiosk`);
      for (const ch of 'Borzport') St.typeStationName(world, ch);
      St.typeStationName(world, 'Enter');
      assert(S.stationName() === 'Borzport', `the register set the name to "${S.stationName()}"`);
      assert((st.register.panel._rows || [])[0] === 'Borzport',
        `the register panel still reads "${(st.register.panel._rows || [])[0]}"`);
      out.push('register → named');

      /* AND THE OTHER SEVEN TERMINALS STILL OPEN THE CODEX. */
      const p13 = PLACE.get(13);
      kiosk = null;
      world.player.position.set(p13.x, st.deckY + 1.6, p13.z);
      assert(!St.atRegister(world), 'the middle of the rotunda is "at the register"');
      assert(St.stationKey(world), '#13 did not answer the key');
      assert(kiosk === 'databank', `#13 raised '${kiosk}' rather than the codex`);
      out.push('#13 elsewhere → codex');
    } finally { a.world.dispose?.(); S.setStationName(was); }

    /* ── DECK 44: the plan table in your own cabin ────────────────────── */
    const b = await station(44);
    try {
      const { world } = b;
      const h = world._home;
      assert(h, 'deck 44 dressed no cabin');
      const table = (h.state.pieces || []).find((r) => r.k === 'table');
      assert(table, "the cabin's default layout has no plan table to name the station at");
      const x = h.spot.x + table.x * h.cos + table.z * h.sin;
      const z = h.spot.z - table.x * h.sin + table.z * h.cos;
      world.player.position.set(x, h.y + 1.6, z);
      assert(St.atPlanTable(world), 'standing on the plan table is not "at the plan table"');
      assert(St.stationKey(world), 'the plan table did not answer the key');
      assert(St.namingStation(world), 'the plan table did not open the naming field');
      St.typeStationName(world, 'Escape');
      /* …AND STEPPING BACK GIVES THE PRESS TO THE FURNITURE, which is the
       * trade the short reach buys: the table is still a thing you can move. */
      world.player.position.set(x + 3.0, h.y + 1.6, z);
      assert(!St.atPlanTable(world),
        'three metres from the table is still "at the plan table" — the furniture is unreachable');
      out.push('plan table → named, and released at 3 m');
    } finally { b.world.dispose?.(); S.setStationName(was); }
    return out.join('; ');
  });

  /* ══════════════════════════════════════════════════════════════════════ */

  check('station: every lift floor names the shaft its car stands in', async () => {
    /**
     * ══ THE DEFECT: A CAR EIGHTY-TWO METRES FROM THE MAN WHO GOT OUT ═════
     *
     * `Levels.setLiftFloors`'s rows are the one table that says which of the
     * drum's three shafts a floor's car is standing in — `main.enterStation`
     * copies `row.shaft` onto `world._stationShaft` and `dressStation` reads
     * it. Decks 12, 32 and 60 named theirs. Decks 40, 44 and 48 named none,
     * and `world._stationShaft || 'arrivals'` fell to the first row of
     * `SHAFTS` every time, on the three decks a player spends their whole
     * visit on. `STATION_LEVEL.start` puts them down in the ATRIUM lobby, so
     * the doors opened 82.8 m from the car.
     *
     * WHAT THIS ASSERTS, and it is deliberately not "the field is present":
     * a row's shaft has to SERVE that deck, `dressStation` has to dress the
     * one the row names, and the car it stands has to be within reach of
     * where the level puts the player down. A row could satisfy the first two
     * and still open its doors across the drum; the third clause is the one
     * that is about a player.
     */
    await import('../../src/game/Levels.js');
    const { liftFloors } = await import('../../src/game/DeckLift.js');
    const { SHAFTS } = await import('../../src/game/StationPlan.js');
    const St = await import('../../src/game/Station.js');
    const start = St.STATION_LEVEL.start;
    const rows = liftFloors().filter((f) => f.deck != null);
    assert(rows.length >= 5, `the floor list has ${rows.length} station decks — Levels.js never installed it`);
    const said = [];
    for (const f of rows) {
      assert(f.shaft, `the deck-${f.deck} floor row names no shaft, so the car falls to whichever `
        + 'row of SHAFTS happens to be first — which is exactly how it ended up 82.8 m from the player');
      const sh = SHAFTS.find((x) => x.id === f.shaft);
      assert(sh, `the deck-${f.deck} row rides shaft '${f.shaft}', which is not in SHAFTS`);
      assert(sh.decks.includes(f.deck),
        `the deck-${f.deck} row rides the ${f.shaft} shaft, which does not reach that deck`);
      said.push(`${f.deck}→${f.shaft}`);
    }
    /* AND THE DOORS OPEN WHERE THE PLAYER IS STANDING, on the three decks the
     * level's own `start` was authored for. 12 and 32 are the hangar's frame
     * and 60 is one room on the axis; the drum is what `start` describes. */
    const far = [];
    for (const f of rows.filter((x) => [40, 44, 48].includes(x.deck))) {
      const sh = SHAFTS.find((x) => x.id === f.shaft);
      const r = Math.hypot(sh.x, sh.z), k = (r + 3.2) / r;
      const d = Math.hypot(sh.x * k - start[0], sh.z * k - start[1]);
      if (d > 12) far.push(`deck ${f.deck}: the ${f.shaft} car stands ${d.toFixed(1)} m from [${start}]`);
    }
    assert(!far.length, `${far.length} decks put the player down nowhere near the car they arrived in:\n      `
      + far.join('\n      '));
    /* AND `dressStation` READS THE ROW. The table above is a declaration; this
     * is the station actually built through the door the game uses. */
    const a = await station(40);
    try {
      const want = rows.find((f) => f.deck === 40).shaft;
      assert(a.world._station.shaft?.id === want,
        `deck 40's row says ${want} and the deck dressed the ${a.world._station.shaft?.id} shaft`);
    } finally { a.world.dispose?.(); }
    return `${said.join(', ')}; the drum's cars all stand within 12 m of [${start}], and deck 40 dresses the one its row names`;
  });

  check('station: a keeper wears every field its row declares', async () => {
    /**
     * ══ THE SHAPE THIS CATCHES: A FIELD THAT ONLY A CHECK CAN SEE ════════
     *
     * `ARMOURER.keeper` said `{role:'smith', species:'human', helm:true,
     * mando:true, name:'Bo Vhett'}`. `helm` and `mando` reached exactly one
     * thing — `keeperOf`, which handed them straight back to `counter.mjs`,
     * which asserted `smith.mando && smith.helm` and went green. The body
     * actually standing behind #10's counter was `res_human` in robes, 62
     * meshes, no plate and no bucket, for a whole lane. A guard that reads a
     * field back out of the row it was declared in is not a guard.
     *
     * So this holds two things instead:
     *
     *   EVERY KEY A KEEPER ROW DECLARES CHANGES SOMETHING. Drop it and the
     *   pair (what he is wearing, who he is) has to move. A new field added
     *   to a `keeper` row with no reader fails here on the day it is written.
     *
     *   AND THE BODY IN THE ROOM IS THE ONE THE ROW ASKED FOR. Measured off a
     *   booted station, not off `keeperArmour` — the pure function could be
     *   perfect and still be called by nobody, which is the defect one level
     *   up. The armoured body carries paint the robed one does not.
     */
    const St = await import('../../src/game/Station.js');
    const V = await import('../../src/game/Vendors.js');
    const { resident } = await import('../../src/game/StationCast.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');

    /**
     * Everything downstream of a keeper row, as one string: what he has on,
     * what he is called, and the person the seed builds under it.
     *
     * TWENTY SEEDS AND NOT ONE. A keeper is a draw — `species` constrains a
     * distribution, so a single seed that happened to roll `human` anyway
     * would report `species: 'human'` as a field with no reader. The union
     * over a spread of seeds is what actually distinguishes "constrains the
     * draw" from "changes nothing".
     */
    const facts = (want) => {
      const rows = [];
      for (let i = 0; i < 20; i++) {
        rows.push(resident(`reader-probe:${i}`, {
          species: want.species && want.species !== 'any' ? want.species : undefined,
          role: want.role || undefined,
        }));
      }
      return JSON.stringify({ armour: St.keeperArmour(want), name: want.name || null, rows });
    };
    const dead = [];
    for (const c of V.COUNTERS) {
      const want = c.keeper || {};
      for (const key of Object.keys(want)) {
        /* `species: 'any'` IS "no constraint", spelt out. `dressKeepers` and
         * `keeperOf` both branch on it by name, so it is a value the code
         * reads and deliberately does nothing with — deleting it has to be a
         * no-op or the branch would be the lie instead. The KEY is still held
         * to account everywhere it names a species. */
        if (key === 'species' && want.species === 'any') continue;
        const without = { ...want };
        delete without[key];
        if (facts(want) === facts(without)) dead.push(`${c.id}.keeper.${key}`);
      }
    }
    assert(!dead.length, `${dead.length} keeper field(s) change nothing at all when deleted — `
      + `${dead.join(', ')}. A field nothing reads is a lie about the game.`);

    /* THE PAINT THE PLATE PUTS ON A BODY, measured off the builders rather
     * than named: a robed resident and the same seed in beskar. */
    const paints = (root) => { const out = new Set(); let n = 0;
      root?.traverse?.((o) => { if (!o.isMesh) return; n++;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (m?.color) out.add(m.color.getHexString());
        } });
      return { n, out }; };
    const robed = paints(ARCHETYPES.res_human.build({}).rig.root);
    const clad = paints(ARCHETYPES.res_human.build({ armour: St.keeperArmour(V.ARMOURER.keeper) }).rig.root);
    const bare = paints(ARCHETYPES.res_human.build({ armour: St.keeperArmour({ mando: true, helm: false }) }).rig.root);
    const plate = [...clad.out].filter((h) => !robed.out.has(h));
    const bucket = [...clad.out].filter((h) => !bare.out.has(h));
    assert(plate.length >= 3,
      `a Mandalorian keeper and a man in robes come out of the builder wearing the same ${plate.length} `
      + 'colours — `mando` reached the builder and changed nothing');
    assert(bucket.length >= 1,
      '`helm` on and `helm` off build the same head — the bucket is a field with no geometry behind it');

    /* AND NOW THE MAN IN THE ROOM. Booting the station is the whole point:
     * `keeperArmour` having the right answer proves nothing about whether
     * `dressKeepers` ever asks it. */
    const a = await station(40);
    try {
      const smith = (a.world._station.keepers || []).find((k) => k.id === 'armourer');
      assert(smith?.body, 'nobody is standing behind #10 The Forge');
      assert(smith.body.stationName === 'Bo Vhett',
        `#10's counter has ${smith.body.stationName} behind it and the sign says Bo Vhett`);
      const live = paints(smith.body.rig?.root);
      const missing = plate.filter((h) => !live.out.has(h));
      assert(!missing.length,
        `the smith at #10 is ${live.n} meshes and is missing ${missing.length} of the ${plate.length} `
        + 'colours the beskar plate is made of — the row asked for a Mandalorian and the room built a man in robes');
      const line = St.keeperOf('armourer', a.world).said;
      assert(/helmed/i.test(line) && /Mandalorian/i.test(line),
        `the counter panel would say "${line}", which says nothing about the bucket or the beskar`);
      return `${V.COUNTERS.length} keeper rows, every declared field moves something; the plate is `
        + `${plate.length} colours a robed resident does not have and the bucket adds ${bucket.length} more; `
        + `#10 stands a ${live.n}-mesh body wearing all of them, under "${line}"`;
    } finally { a.world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  §14 — THE ONE KEY, AND WHAT IT MAY NOT ANSWER WITH
   * ════════════════════════════════════════════════════════════════════════ */

  check('station: no place answers the interact key by printing its own verb', async () => {
    /**
     * ══ THE DEFECT, DRIVEN ACROSS THE WHOLE GAZETTEER ═════════════════════
     *
     * §14: *"The interact prompt. One key, one prompt style, on every verb in
     * §3.2 … Every verb row in §3.2 is a prompt string."* `Station.stationKey`
     * ended in `world.notify(place.name.toUpperCase(), place.verb)` — the key
     * answering with the prompt and doing nothing. Measured before the fix, by
     * standing at every one of the sixty-two places with a verb, on its own
     * deck, and pressing:
     *
     *     every panel hook wired      39 hooks · 7 lines · **16 verb echoes**
     *     every hook refusing          0 hooks · 9 lines · **37 verb echoes**
     *
     * The second row is the one that matters and is why this check drives BOTH
     * answers. A room whose only door is the job board echoes its verb on
     * every day the board has nothing for it, so "the panel exists" is not the
     * same question as "the room answers".
     *
     * ── WHAT IS ASSERTED, AND WHY IT IS DERIVED ──────────────────────────
     *
     * Not a list of rooms — a PROPERTY, compared against `place.verb` itself:
     * whatever the key says, it is not the string the gazetteer put in the
     * verb column. A room added to §3.2 tomorrow with nothing behind it fails
     * on the commit that adds it, and no list here needs editing for that to
     * be true.
     */
    const { stationKey, placeUnder } = await import('../../src/game/Station.js');
    const { PLACES, floorOf } = await import('../../src/game/StationPlan.js');

    /* EVERY DOOR `stationKey` CAN KNOCK ON. Stubbed to the SAME answer for one
     * whole sweep, which is the only way the two questions above stay separate
     * — a mixture would measure neither. */
    const HOOKS = ['onKiosk', 'onHabitat', 'onCounter', 'onBench', 'onMedbay', 'onPit',
      'onCasino', 'onQuest', 'onTote', 'onLarder', 'onCharge', 'onHolodeck', 'onLeave',
      'onBar', 'onCommune', 'onFlight', 'onCert', 'onLaunch', 'onSortie'];
    const decks = [...new Set(PLACES.map((p) => p.deck).filter((d) => d != null))].sort((a, b) => a - b);

    const echoes = [];
    const silent = [];
    const tally = { yes: { hooks: 0, lines: 0 }, no: { hooks: 0, lines: 0 } };
    let pressed = 0;
    for (const answer of [true, false]) {
      const t = tally[answer ? 'yes' : 'no'];
      for (const deck of decks) {
        const a = await station(deck);
        try {
          for (let i = 0; i < 90; i++) a.world.update(1 / 60, a.idle);
          for (const p of PLACES) {
            if (p.deck !== deck || !p.verb) continue;
            const said = [];
            let fired = 0;
            a.world.notify = (h, l) => said.push([h, l]);
            for (const h of HOOKS) a.world[h] = () => { fired++; return answer; };
            /* NOT RIDING between rooms: a press at one platform boards the car
             * and the next press anywhere would be the rider stepping off. */
            a.world._tramRide = null;
            a.world.player.position.set(p.x, floorOf(p) + 1, p.z);
            /* THE PLACE THE KEY ITSELF RESOLVED TO. A footprint may hold
             * another place's door — #26's centre stands inside #40.3's — and
             * the echo test has to be against the verb the KEY read. */
            const at = placeUnder(a.world, p.x, p.z) || p;
            pressed++;
            assert(stationKey(a.world) === true,
              `#${p.id} ${p.name} did not answer the interact key at all`);
            /* A HOOK THAT REFUSED IS NOT A ROOM THAT ANSWERED, so the tally
             * counts the panel only on the sweep where panels answer. */
            if (fired && answer) t.hooks++;
            else if (said.length) t.lines++;
            else silent.push(`#${p.id} ${p.name}`);
            for (const [head, line] of said) {
              if (line === at.verb) echoes.push(`#${at.id} ${at.name} → "${line}"`);
            }
          }
        } finally { a.world.dispose?.(); }
      }
    }
    assert(!echoes.length,
      `${echoes.length} place${echoes.length === 1 ? '' : 's'} answered the key with the verb column read `
      + `back at the player: ${echoes.slice(0, 6).join('; ')}`);
    /* A ROOM THAT SAYS NOTHING AND RAISES NOTHING is the same defect wearing a
     * quieter coat, so it is held here too — the only presses allowed to be
     * silent are the ones a hook took. */
    assert(!silent.length,
      `${silent.length} place${silent.length === 1 ? '' : 's'} spent the press and neither raised a panel `
      + `nor said anything: ${silent.slice(0, 6).join('; ')}`);
    return `${pressed} presses over ${decks.length} decks. Panels answering: `
      + `${tally.yes.hooks} raised one, ${tally.yes.lines} said something of their own. `
      + `Every panel refusing: ${tally.no.lines} answered out of the room's own state. `
      + '0 echoed the verb either way, 0 spent a press in silence';
  });

  check('station: a resident you look at has a name, and says something worth hearing', async () => {
    /**
     * ══ NOBODY COULD BE TALKED TO AND NOBODY HAD A NAME ON SCREEN ═════════
     *
     * §14 asks for talking. There was no bark table in `StationCast.js`, no
     * `onTalk` or `talkTo` in any file, and `HUD._nameplates` read
     * `roster.living` and never `body.stationName` — a field `spawnResident`
     * writes onto EVERY resident and `dressKeepers` onto every keeper, and
     * which was shown to the player nowhere.
     *
     * Three things are held here, and the second is the one that would rot:
     *
     *   THE TARGET IS THE PLATE'S TARGET. `HUD._residentPlate` and the key's
     *     talk branch both call `residentFacing`, so the frame the plate is up
     *     is the frame the key will talk. Driven by standing the player in
     *     front of a real spawned body and asking.
     *   THE BARK IS SEEDED ON (RESIDENT, DAY). Same person, same day, same
     *     line, from any caller — which is what makes it the same for both
     *     machines in a co-op session — and a different line tomorrow.
     *   IT IS BUILT FROM WHAT THE GAME KNOWS. Every topic reads a row this
     *     game already owns, so the assertion is that the sentence CONTAINS
     *     the fact rather than that it matches a string.
     */
    const St = await import('../../src/game/Station.js');
    const C = await import('../../src/game/StationCast.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');

    /* ── the table, off the seed, with no world at all ──────────────────── */
    const who = C.resident('p9s3');
    const a1 = C.barkFor(who, 0, { hour: 12, place: PLACE.get(9) });
    const a2 = C.barkFor(who, 0, { hour: 12, place: PLACE.get(9) });
    assert(a1 && a1[1], 'a resident with a species, a job and a rhythm had nothing to say');
    assert(a1[1] === a2[1], 'the same resident said two different things on the same day');
    assert(a1[0].includes(String(who.name).toUpperCase()),
      `the banner's head is "${a1[0]}" and does not name ${who.name}`);
    /* A DAY IS A DAY. Sweeping the days must actually move the line, or the
     * seed is not reaching the pick and every resident is a fixed sentence. */
    const overDays = new Set();
    for (let d = 0; d < 40; d++) overDays.add(C.barkFor(who, d, { hour: 12, place: PLACE.get(9) })[1]);
    assert(overDays.size >= 3,
      `forty days of ${who.name} produced ${overDays.size} distinct line(s) — the day is not in the seed`);
    /* AND TWO PEOPLE ARE TWO PEOPLE. */
    const others = new Set();
    for (let i = 0; i < 24; i++) {
      const r = C.resident(`p9s${i}`);
      const b = C.barkFor(r, 0, { hour: 12, place: PLACE.get(9) });
      if (b) others.add(b[1]);
    }
    assert(others.size >= 6,
      `twenty-four residents of the Concourse said ${others.size} distinct thing(s) between them`);

    /* NO `Math.random` ANYWHERE IN THE LANE. The whole station is seeded and a
     * bark drawn off the global stream would be the one thing in the drum two
     * machines in a session could disagree about. */
    const { readFile } = await import('node:fs/promises');
    /* COMMENTS STRIPPED FIRST — both files argue about `Math.random` in prose
     * and a grep over the raw text would be measuring the argument. */
    const bare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const f of ['StationCast.js', 'Station.js']) {
      const src = bare(await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8'));
      assert(!/Math\.random/.test(src), `${f} reaches for Math.random`);
    }

    /* ── and now the body in the room ──────────────────────────────────── */
    const a = await station(40, 'high');
    try {
      for (let i = 0; i < 240; i++) a.world.update(1 / 60, a.idle);
      const people = a.world.enemies.filter((e) => e && !e.dead && e.stationResident
        && e.stationName && !e.stationKeeper && e.stationSpecies);
      assert(people.length >= 5,
        `only ${people.length} named residents are standing on deck 40 — there is nobody to talk to`);
      const him = people[0];
      /* STAND IN FRONT OF HIM AND LOOK AT HIM, which is the only thing the
       * branch accepts — the aim is the game's own `aimDir` and the eye is the
       * game's own camera. TWO FRAMES AFTER THE MOVE, because `camera.pos` is
       * written by `Player.update` and a check that aimed off a stale eye
       * would be measuring nothing. */
      const p = a.world.player;
      const dx = Math.cos(0.6), dz = Math.sin(0.6);
      p.position.set(him.position.x - dx * 1.6, him.position.y, him.position.z - dz * 1.6);
      for (let i = 0; i < 2; i++) a.world.update(1 / 60, a.idle);
      const eye = p.camera?.pos || p.position;
      const ex = him.position.x - eye.x;
      const ey = him.position.y + (him.A?.hipHeight ?? 0.95) + 0.5 - eye.y;
      const ez = him.position.z - eye.z;
      const len = Math.hypot(ex, ey, ez);
      /* THE REACH IS OFF THE BODY, which is three metres from the eye in third
       * person — see `residentFacing`. The check stands the player next to him
       * and aims from wherever the camera ended up. */
      const reach = Math.hypot(him.position.x - p.position.x, him.position.z - p.position.z);
      assert(reach <= St.TALK_REACH, `the check stood ${reach.toFixed(2)} m away, outside the talk reach`);
      p.aimDir.set(ex / len, ey / len, ez / len);
      assert(St.residentFacing(a.world) === him,
        'standing a metre and a half in front of a resident and looking at him found nobody — '
        + 'the plate and the talk key are both dead');
      const said = [];
      a.world.notify = (h, l) => said.push([h, l]);
      for (const h of ['onKiosk', 'onCounter', 'onQuest', 'onBar', 'onTote', 'onPit']) a.world[h] = () => true;
      assert(St.stationKey(a.world) === true, 'the key did not answer in front of a resident');
      assert(said.length === 1, `talking to somebody raised ${said.length} banners`);
      assert(said[0][0].includes(String(him.stationName).toUpperCase()),
        `the key answered "${said[0][0]}" and the man in front of the player is ${him.stationName}`);
      /* AND IT IS THE SAME LINE THE ROW WOULD HAVE BEEN GIVEN — the body's
       * `station*` fields recover `occupant`'s seed, so a check can ask the
       * table the same question the room asked. */
      const row = St.whoOfBody(him);
      assert(row.name === him.stationName && row.species === him.stationSpecies,
        'a resident body no longer reads back as the row it was built from');
      /* LOOK AWAY AND THE ROOM HAS ITS DOOR BACK. This is the contract the
       * plate makes, and without it the talk branch would be shadowing every
       * panel in the game. */
      p.aimDir.set(-ex / len, 0, -ez / len).normalize();
      assert(St.residentFacing(a.world) === null,
        'turning your back on a resident still talks to him — the cone is not a cone');
      return `${people.length} named residents on deck 40; ${overDays.size} lines over forty days for one `
        + `man, ${others.size} across twenty-four of them; "${said[0][1].slice(0, 60)}…"`;
    } finally { a.world.dispose?.(); }
  });

  check('station: the tram carries you — §3.1 rule 3’s "cars you can ride"', async () => {
    /**
     * ══ IT CARRIED NOBODY ═════════════════════════════════════════════════
     *
     * §3.1 rule 3 asks for *"cars you can ride"*; §3.2 #40's verb is *"ride"*.
     * `life.tram` was `{t, at, car}` — no passenger list of any kind — and
     * nothing in the tree ever put the player or a resident on it. Pressing
     * the key on a platform printed the word "ride".
     *
     * Driven here through the real key at the real platform: board, be carried
     * round the rim by the guideway `StationLife.stepTram` owns, and be set
     * down on the NEXT platform in the loop. The two halves stay separate —
     * nothing under test reaches into `stepTram`, and `Station.stepTramRide`
     * reads `STOPS`, `tram.at` and `tram.t`, which are that file's own exports
     * and state.
     */
    const St = await import('../../src/game/Station.js');
    const { STOPS } = await import('../../src/game/StationLife.js');
    const { PLACE, floorOf } = await import('../../src/game/StationPlan.js');
    const a = await station(44);
    try {
      for (let i = 0; i < 60; i++) a.world.update(1 / 60, a.idle);
      const life = a.world._stationLife;
      assert(life?.tram?.car, 'no tram car was dressed on deck 44');
      /* WAIT FOR A CAR, exactly as a passenger does. The loop is 90 s over
       * four stops, so one is never more than 22.5 s away. */
      const first = PLACE.get(STOPS[0]);
      a.world.player.position.set(first.x, floorOf(first) + 1, first.z);
      let waited = 0;
      while (St.tramAtStop(a.world) !== STOPS[0] && waited < 100) { a.world.update(1 / 60, a.idle); waited += 1 / 60; }
      assert(St.tramAtStop(a.world) === STOPS[0],
        `no car reached ${first.name} in ${Math.round(waited)} s`);
      const said = [];
      a.world.notify = (h, l) => said.push(`${h} / ${l}`);
      a.world.onQuest = () => true;
      assert(St.stationKey(a.world) === true, 'the key did nothing on a platform with a car at it');
      assert(a.world._tramRide, `pressing at ${first.name} with a car standing there did not board it`);

      const start = [a.world.player.position.x, a.world.player.position.z];
      let moved = 0, rode = 0;
      while (a.world._tramRide && rode < 40) {
        a.world.update(1 / 60, a.idle); rode += 1 / 60;
        moved = Math.max(moved, Math.hypot(a.world.player.position.x - start[0],
          a.world.player.position.z - start[1]));
        /* THE RIDER IS ON THE CAR, not near it. */
        const car = life.tram.car.position;
        assert(Math.hypot(a.world.player.position.x - car.x, a.world.player.position.z - car.z) < 1.5,
          'the rider came off the car mid-leg');
      }
      assert(!a.world._tramRide, `the ride never ended — ${Math.round(rode)} s aboard`);
      assert(moved > 40, `the car carried the player ${moved.toFixed(1)} m, which is not a journey`);
      const next = PLACE.get(STOPS[1]);
      const off = Math.hypot(a.world.player.position.x - next.x, a.world.player.position.z - next.z);
      assert(off < 3, `set down ${off.toFixed(1)} m from ${next.name} rather than on it`);

      /* AND A PLATFORM WITH NO CAR AT IT HANDS THE PRESS ON. `rideTram`
       * answers false there, which is what keeps a job giver at #40 reachable
       * — the rule the pit branch states at length in `stationKey`. Driven
       * both ways: with a giver on the board the board opens, and with nothing
       * on it the press falls the whole way to the room's own line, which says
       * when the next car is. */
      a.world._tramRide = null;
      const third = PLACE.get(STOPS[2]);
      a.world.player.position.set(third.x, floorOf(third) + 1, third.z);
      while (St.tramAtStop(a.world) === STOPS[2]) a.world.update(1 / 60, a.idle);
      let took = 0;
      a.world.onQuest = () => { took++; return true; };
      said.length = 0;
      assert(St.stationKey(a.world) === true, 'a platform with no car did not answer at all');
      assert(!a.world._tramRide, 'the key boarded a car that was not at the platform');
      assert(said.length === 1 && /next car in \d+ s/.test(said[0]),
        `a platform with no car said "${said[0]}" rather than when the next one is due`);
      const due = St.tramDue(a.world, STOPS[2]);
      assert(due && due.secs > 0 && due.secs <= 90, `the next car is ${due?.secs} s away`);
      /* AND THE BOARD IS STILL BELOW THE RIDE AND ABOVE THE ROOM'S LINE, which
       * is the ordering that keeps a giver at a platform reachable. Asserted
       * on the source the way `work.mjs` asserts the same property, because
       * `offersAt` puts nobody on a platform on most days and waiting for one
       * would be a check that passes by luck. */
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(new URL('../../src/game/Station.js', import.meta.url), 'utf8');
      const key = src.slice(src.indexOf('export function stationKey('));
      const body = key.slice(0, key.indexOf('\n}'));
      assert(body.indexOf('rideTram(') < body.indexOf('offersAt(')
        && body.indexOf('offersAt(') < body.indexOf('roomLine('),
        'the ride, the job board and the room line are no longer in that order — '
        + 'a platform will either eat a giver\'s press or never board a car');
      assert(took === 0, 'the empty platform opened a board that had nobody on it');
      return `boarded at ${first.name}, carried ${moved.toFixed(0)} m round the rim in `
        + `${rode.toFixed(0)} s, set down ${off.toFixed(1)} m from ${next.name}; `
        + 'an empty platform hands the press to the board';
    } finally { a.world.dispose?.(); }
  });

}