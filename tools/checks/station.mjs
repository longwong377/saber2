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
}
