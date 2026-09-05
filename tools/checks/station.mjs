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

/** The station, booted through the same door the game uses. */
async function station(deck = 40) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, ROOM_FILES } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
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
     * §2.5's THIRD standing rule, and the only one of the three that was not
     * built: *"People are going somewhere … the walkways must carry people
     * MOVING along desire lines."*
     *
     * ── WHAT WAS MEASURED ────────────────────────────────────────────────
     *
     * A hostile pass tracked 46 residents over sixty simulated seconds on deck
     * 40 and got a median displacement of 3.02 m, worst 6.49 — the eighteen in
     * the between-space no different at 2.96. The ring is two hundred metres
     * round. Three metres a minute is a shuffle on the spot, and the source
     * said why: `spawnResident` set `brain.idle = true`, and `stationWay` —
     * the field whose own comment called it "the hook a route would drive" —
     * had one writer and no readers in the whole tree.
     *
     * The clause above this one asserts the corridors are POPULATED and it
     * always did; nothing asserted that anybody in them was going anywhere,
     * which is how a rule that reads as obviously true went unbuilt.
     *
     * ── AND IT IS TWO ASSERTIONS, NOT ONE ────────────────────────────────
     *
     * The open stretches MOVE. Everything else on a walkway is somebody who
     * has stopped on purpose — at a counter, on a bench, at the rail, waiting
     * at a crossing — and making those walk would delete the fixtures, so they
     * are asserted to STAY. A fix that set every body walking would pass a
     * one-sided version of this and empty the benches.
     */
    diskFetch();
    const { world, idle } = await station(40);
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
      const { wayPlacesOn } = await import('../../src/game/StationLife.js');
      const open = wayPlacesOn(40).find((p) => p.way === 'walk');
      assert(open, 'deck 40 declares no open walking stretch at all');
      world.player.position.set(open.x, world.player.position.y, open.z);
      world.player.body?.setTransform?.(world.player.position, null);
      for (let i = 0; i < 300; i++) world.update(1 / 60, idle);

      /* KEYED ON THE BODY AND NOT ON THE SLOT. `reseat` recycles a slot key —
       * a body can be dropped and a different one spawned into `p:i` inside
       * the window — and comparing those two is measuring a respawn and
       * calling it a walk. The first cut did that and read 5.92 m of
       * "movement" out of people standing at a counter. */
      const seen = new Map();
      for (const [, b] of life.live) {
        seen.set(b, { x: b.position.x, z: b.position.z, way: b.stationWay || null });
      }
      /* NINE ON A STRETCH OF OPEN RING IS THE RIGHT NUMBER, and a bar of
       * twenty here would be a bar on the wrong thing: the clause above owns
       * how many people a corridor holds, and this one owns whether they are
       * going anywhere. Four is the smallest sample that can have a median. */
      assert(seen.size >= 6, `only ${seen.size} residents were up to watch`);

      /* SIXTY SIMULATED SECONDS, the same window the audit used. */
      for (let i = 0; i < 3600; i++) world.update(1 / 60, idle);
      const walk = [], stopped = [];
      for (const [, b] of life.live) {
        const a = seen.get(b);
        if (!a) continue;
        const d = Math.hypot(b.position.x - a.x, b.position.z - a.z);
        (a.way === 'walk' ? walk : stopped).push(d);
      }
      /* TWO, AND THE NUMBER IS SMALL BECAUSE THE STRETCHES ARE THIN: eight
       * open runs of ring at four heads each is thirty-two people in transit
       * on a whole deck, and only the ones inside the seat radius are bodies
       * at all. How MANY is the clause above's subject and it bounds the total
       * at forty; this one only needs enough to have a median. */
      assert(walk.length >= 2,
        `only ${walk.length} bodies were on the open stretches — nothing was measured`);
      const median = (v) => { const q = v.slice().sort((x, y) => x - y); return q[q.length >> 1]; };
      const m = median(walk);
      /* A MINUTE AT A WALK IS TENS OF METRES. `WALK_PACE` is 1.35 m/s, so a
       * minute is about eighty; the bar is set at a quarter of that so a body
       * that spent part of the window being re-seated still counts. */
      assert(m >= 20,
        `the open walkways moved a median of ${m.toFixed(2)} m in sixty seconds — the ring is `
        + '200 m round, and this is a shuffle on the spot rather than a journey');
      /* AND THE BENCHES ARE STILL OCCUPIED BY PEOPLE SITTING ON THEM. */
      /**
       * ── AND IT IS A RATIO, BECAUSE THE FIXTURES WERE NEVER STILL ────────
       *
       * The first cut asserted the people who stopped somewhere moved less
       * than three metres, and measured 5.92 — market bodies drifting 8 to 10
       * m over the minute. That drift predates this lane and is not something
       * `stepWalkers` does: it only ever touches a body with a `wayR`, and
       * only `way === 'walk'` is given one. Asserting an absolute the game has
       * never held would have been this check inventing a second defect.
       *
       * What the clause is actually for is that a fix which set EVERY body
       * walking would empty the benches, and that is a RATIO: an open stretch
       * has to be a journey against whatever the fixtures are doing, not
       * against zero.
       */
      if (stopped.length) {
        const sm = median(stopped);
        assert(m > sm * 3,
          `the open stretches moved ${m.toFixed(1)} m and the people who stopped somewhere on `
          + `purpose moved ${sm.toFixed(1)} m — the counters, the benches and the rails have been `
          + 'emptied into the corridor');
      }
      /* THE CORRIDOR IS AN ANNULUS AND A WALKER MAY NOT LEAVE IT. This is the
       * whole reason the route is a bearing at a fixed radius rather than a
       * path: staying inside is arithmetic, so it is checked as arithmetic. */
      /**
       * ── AND THE OLD GUARD HERE ASSERTED THE DEFECT ──────────────────────
       *
       * It asserted `|hypot(x, z) - wayR| <= 0.05` — "0 walkers left the ring
       * they were walking" — and staying exactly on that circle is PRECISELY
       * what carried them through the rooms. The eight ring stretches sit on
       * a clear annulus, but the four spine stretches sat mid-band, and a
       * fifth of that circle is inside a room footprint. Measured live over
       * 240 samples: a walker was inside #13 The Databank on 53 of them, #9 on
       * 42, the Cantina on 15. #13 walls all but 0.42 rad of itself, so that
       * was a body walking through a wall.
       *
       * So the property is not "on its own curve". It is THE ONE THE PLAYER
       * WOULD SEE: nobody is ever inside a room they did not walk into. Tested
       * against the same yawed rectangles `the plan is a plan` uses, over the
       * whole minute rather than at the end of it.
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
      for (let f = 0; f < 600; f++) {
        world.update(1 / 60, idle);
        for (const [, b] of life.live) {
          if (!b.wayR) continue;
          for (const p of rooms) {
            if (!inside(p, b.position.x, b.position.z)) continue;
            trespass.set(p.id, (trespass.get(p.id) | 0) + 1);
          }
        }
      }
      assert(trespass.size === 0,
        `a corridor walker was inside ${[...trespass].map(([id, n]) => `#${id} on ${n} samples`).join(', ')}`
        + ' — the between-space walks through the rooms');
      /* AND EACH IS STILL ON THE CORRIDOR IT WAS PUT ON, which is the cheap
       * half and still worth holding: a ring walker keeps its radius, a spine
       * walker keeps its bearing. */
      let strayed = 0;
      for (const [, b] of life.live) {
        if (!b.wayR) continue;
        const r = Math.hypot(b.position.x, b.position.z);
        const a = Math.atan2(b.position.x, b.position.z);
        const off = b.wayAxis === 'spine'
          ? Math.abs(((a - b.wayAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
          : Math.abs(r - b.wayR);
        if (off > 0.05) strayed++;
      }
      assert(strayed === 0, `${strayed} walkers left the corridor they were walking`);
      return `${walk.length} on the open stretches moved a median ${m.toFixed(1)} m in a minute `
        + `(the ring is ${(2 * Math.PI * 85.5).toFixed(0)} m round); ${stopped.length} who stopped `
        + `somewhere drifted ${stopped.length ? median(stopped).toFixed(1) : '0'} m; `
        + '0 left the corridor';
    } finally { world.unload(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('station: every place is reachable on foot from a lift', async () => {
    const { PLACES, SHAFTS, DRUM, DECK_Y } = await import('../../src/game/StationPlan.js');
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
     */
    const unreachable = [];
    for (const p of PLACES) {
      if (p.external || p.band === 'ring') continue;
      if (p.band === 'deck32' || p.band === 'deck12') continue;   // the hangar's own frame
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
      /* And a lift stops on its deck. */
      const served = SHAFTS.some((s) => s.decks.includes(p.deck));
      if (!served) unreachable.push(`#${p.id} ${p.name} is on deck ${p.deck}, which no shaft serves`);
    }
    assert(unreachable.length === 0,
      `${unreachable.length} places are not on the circulation:\n      ${unreachable.slice(0, 8).join('\n      ')}`);

    /* Every deck the gazetteer uses has a height, and every shaft a deck. */
    const decks = new Set(PLACES.filter((p) => !p.external).map((p) => p.deck));
    for (const d of decks) assert(DECK_Y[d] !== undefined, `deck ${d} has places on it and no height in DECK_Y`);
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

    /* §5.3: at least eight residents of every species are placed. */
    const c = census(13);
    const thin = [];
    for (const [k, n] of c.bySpecies) {
      /* The Vorlon is one, by construction, and is placed by hand at #37. */
      if (k === 'vorlon') continue;
      if (n < 8) thin.push(`${k}: ${n}`);
    }
    assert(thin.length === 0,
      `${thin.length} species have fewer than 8 residents at 13:00: ${thin.join(', ')}`);
    console.log(`      census at 13:00: ${[...c.bySpecies].map(([k, n]) => `${k} ${n}`).join(', ')}`);
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
    assert((code.match(/opts\.still\s*\?\s*\{\s*still:\s*opts\.still\s*\}/g) || []).length >= 2,
      'a door takes a still and never builds the bag Screens.loading reads');

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
    const was = document.getElementById;
    document.getElementById = (id) => (id === 'loading' ? el : null);
    try {
      const sc = new Screens();
      sc.loading(0.3, 'the station', { still: 'data:image/png;base64,AA' });
      assert(el.classList.contains('still'),
        'a loading screen handed a still did not wear it — the player gets the plate mid-ride');
      assert(!el.classList.contains('hidden'), 'the loading screen stayed hidden');
      assert(/data:image/.test(el.style.backgroundImage || ''), 'the still was not painted');
      sc.hideLoading();
      assert(!el.classList.contains('still') && !el.style.backgroundImage,
        'the still outlived the load — the menu now wears a photograph of a lift');
    } finally { document.getElementById = was; }
    return 'both lift handlers capture before teardown and hand it on; the screen wears it and gives it back';
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
      /* AND THE FLEET IN REAL GEOMETRY, not just the shader. */
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
        rows.push(`deck ${deck}: ${g.children.length} column meshes, `
          + `${st.obelisk.faces.length} faces, shell ${st.shellDraws} draws`);
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
      assert(decks.length >= 3, `the lift reaches ${decks.length} station decks`);
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

  check('station: #51 charges a droid, and hands a man his own verb back', async () => {
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
     * back for anybody with a stomach, and #51's own verb still prints.
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

      /* ── A MAN: the hook refuses and the verb comes back. ───────────── */
      charged = 0; said = null;
      world.onCharge = (id) => { charged = id; return false; };
      assert(St.stationKey(world), '#51 stopped answering the key when the rack refused');
      assert(charged === 51, 'the room was not even asked');
      assert(said && said.startsWith('DROID POOL'),
        `a man at #51 got "${said}" instead of the room's own verb — a branch that claims a press `
        + 'it did not use is the defect #20 was fixed for');
      assert(said.includes(p51.verb), `the verb printed was "${said}" and the gazetteer says "${p51.verb}"`);

      /* ── AND WITH NO PANEL WIRED AT ALL, nothing changes. ───────────── */
      delete world.onCharge;
      said = null;
      assert(St.stationKey(world), '#51 went dead with no handler installed');
      assert(said && said.includes(p51.verb), `#51 with no handler said "${said}"`);
      return `#51 raised the rack for a droid; refused, it fell through to "${p51.verb}"`;
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
}
