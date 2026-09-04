/**
 * ══════════════════════════════════════════════════════════════════════════
 *  #27 — THE HOME, MEASURED
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `V15.md` §1.3 is five things and this suite is one check per thing, plus the
 * two laws the record has to keep:
 *
 *   1. the grid and the catalogue — a piece is placed, turned, bounded, and
 *      the bounds are the room's rather than a number typed twice
 *   2. the surfaces — every choice is a material `stationMats` already made
 *   3. the address — derived, unique, and readable without dressing a room
 *   4. the mirror — a fixture, and a door onto the panel the menu has
 *   5. persistence — written on LEAVING, survived by a re-dress, and never
 *      through `localStorage`
 *
 * Every check returns a MEASURED string. A check that returns `true` is
 * `HANDOFF` §2.3b's check that cannot fail.
 */

import { readFile } from 'node:fs/promises';

/* Verbatim from `station.mjs`: no `fetch` in node, so the imported rooms are
 * read off disk and handed to the same decoder the browser uses. */
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
async function station(deck = 44) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return { world, idle: idleInput() };
}

export async function run({ check, assert, near, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: the catalogue is a table of footprints, and every row builds', async () => {
    const H = await import('../../src/game/Home.js');
    assert(H.CATALOGUE.length >= 9,
      `the catalogue has ${H.CATALOGUE.length} pieces; V15 §1.3.1 names nine`);
    const ids = new Set();
    const bad = [];
    for (const c of H.CATALOGUE) {
      if (ids.has(c.id)) bad.push(`${c.id} twice`);
      ids.add(c.id);
      if (!(c.w > 0 && c.d > 0 && c.h > 0)) bad.push(`${c.id} has no footprint`);
      if (!(c.mass > 0)) bad.push(`${c.id} has no mass — §1.3.1 wants a real body`);
      if (!H.pieceKind(c.id)) bad.push(`${c.id} is not reachable through pieceKind`);
    }
    assert(bad.length === 0, bad.join('; '));

    /* THE FOOTPRINT IS THE THING THE GRID TESTS, so it has to turn with the
     * piece. A quarter turn swaps w and d; an eighth turn grows both. */
    const c = H.pieceKind('table');
    const [ex0, ez0] = H.extentsAt(c, 0);
    const [ex2, ez2] = H.extentsAt(c, 2);
    const [ex1] = H.extentsAt(c, 1);
    near(ex0, c.w / 2, 1e-6, 'unturned half-width');
    near(ex2, c.d / 2, 1e-6, 'quarter-turned half-width');
    assert(ex1 > ex0, `an eighth turn does not widen the footprint (${ex1.toFixed(2)} vs ${ex0.toFixed(2)})`);

    /* Every default is a catalogue id, or a fresh save furnishes nothing. */
    for (const r of H.DEFAULT_LAYOUT) {
      assert(H.pieceKind(r.k), `the default layout places a '${r.k}', which is not in the catalogue`);
    }
    return `${H.CATALOGUE.length} pieces, ${ids.size} ids, ${H.DEFAULT_LAYOUT.length} placed by default; `
      + `a ${c.w}×${c.d} table measures ${(ex0 * 2).toFixed(2)}×${(ez0 * 2).toFixed(2)} at 0° `
      + `and ${(ex2 * 2).toFixed(2)}×${(ez2 * 2).toFixed(2)} at 90°`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: the record clamps — a hand-edited save cannot reach the room', async () => {
    const H = await import('../../src/game/Home.js');
    const { clearStation, setHomeState, homeState } = await import('../../src/game/StationSave.js');
    clearStation();

    /* Everything wrong at once: a piece that is not a piece, a colour that is
     * not on the palette, coordinates a kilometre out, a rotation that is not
     * a notch, a store that is a string, and more pieces than a cabin holds. */
    setHomeState({
      v: 99,
      surfaces: { floor: 'saberNoInk', wall: 'hull', trim: 'nonsense' },
      pieces: [
        { k: 'wormhole', x: 0, z: 0, r: 0 },
        { k: 'chair', x: 1000, z: -1000, r: 999 },
        { k: 'table', x: 1.13, z: -2.4, r: -3 },
        ...Array.from({ length: 80 }, () => ({ k: 'crate', x: 0, z: 0, r: 0 })),
      ],
      store: { food: 'a sandwich', parcels: [{ id: 'x'.repeat(200), n: -4 }, 7] },
      pad: 12345,
    });
    const rec = H.loadHome();

    assert(rec.v === 1, `the version came back ${rec.v}; the migration hook is 1`);
    assert(!H.pieceKind('wormhole'), 'the fixture is wrong');
    assert(rec.pieces.every((p) => H.pieceKind(p.k)), 'a piece that is not in the catalogue survived');
    assert(rec.pieces.length <= H.MAX_PIECES,
      `${rec.pieces.length} pieces came back against a cap of ${H.MAX_PIECES}`);
    assert(rec.pieces.every((p) => p.r >= 0 && p.r < H.NOTCHES && Number.isInteger(p.r)),
      'a rotation came back off the notch');
    assert(rec.pieces.every((p) => Math.abs(p.x / H.CELL - Math.round(p.x / H.CELL)) < 1e-9),
      'a coordinate came back off the grid');
    for (const slot of H.SURFACE_SLOTS) {
      assert(H.SURFACES[slot].includes(rec.surfaces[slot]),
        `${slot} came back '${rec.surfaces[slot]}', which is not on the palette`);
    }
    assert(Array.isArray(rec.store.food) && Array.isArray(rec.store.parcels),
      'the store did not come back as two arrays — V16 B5 and §3.2 both write into it');
    assert(rec.store.parcels.every((r) => typeof r.id === 'string' && r.n >= 1),
      'a parcel came back with a negative count');
    assert(rec.pad === null, `pad came back ${rec.pad}; a companion id is a string or nothing`);

    /* AND AN ABSENT RECORD IS A FURNISHED CABIN, not a bare floor. */
    clearStation();
    assert(homeState() === null, 'a cleared fold still holds a home');
    const fresh = H.loadHome();
    assert(fresh.pieces.length === H.DEFAULT_LAYOUT.length,
      `a fresh home has ${fresh.pieces.length} pieces; the cabin §3.2 describes has ${H.DEFAULT_LAYOUT.length}`);
    return `80+3 rubbish rows clamped to ${rec.pieces.length}, ${H.SURFACE_SLOTS.length} surfaces forced back `
      + `onto the palette, store back as 2 arrays; an absent fold furnishes ${fresh.pieces.length} pieces`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: the address is derived, unique, and it is what Lane F assigns', async () => {
    const H = await import('../../src/game/Home.js');
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const cabin = PLACES.find((p) => p.id === 27);
    const a = H.homeAddress(cabin);
    assert(/^\d+-[A-L]-\d{2}$/.test(a), `#27's address reads '${a}', not deck-sector-door`);
    assert(a.startsWith(`${cabin.deck}-`), `'${a}' does not start with its own deck`);
    /* Derived and not stored: the same row twice is the same address. */
    assert(H.homeAddress(cabin) === a, 'the address is not a pure function of the row');

    /* V16 Lane F converts a residence into a joining player's apartment, so
     * every residential row has to answer with an address of its own. */
    const homes = PLACES.filter((p) => [27, 31, 32, 33, 34, 35, 38].includes(p.id));
    const set = new Set(homes.map((p) => H.homeAddress(p)));
    assert(set.size === homes.length,
      `${homes.length} residences share ${set.size} addresses — a co-op guest cannot be told from the host`);
    /* And every place in the gazetteer, not only the homes. */
    const all = new Set(PLACES.filter((p) => !p.external).map((p) => H.homeAddress(p)));
    return `#27 is ${a}; ${homes.length} residences → ${set.size} addresses, `
      + `${all.size} distinct over the whole gazetteer`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: the cabin dresses — surfaces off stationMats, an address on the door, a mirror', async () => {
    const H = await import('../../src/game/Home.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    clearStation();
    const { world } = await station(44);
    try {
      const h = world._home;
      assert(h, 'deck 44 dressed no home — nothing read `st.home`');
      assert(h.place.id === 27, `the home dressed #${h.place.id}`);
      assert(h.props.filter(Boolean).length === H.DEFAULT_LAYOUT.length,
        `${h.props.filter(Boolean).length} bodies for ${H.DEFAULT_LAYOUT.length} default pieces`);

      /* §1.3.1: everything placed is a REAL body, so it is in the world's own
       * prop list and the blade solver can reach it. */
      for (const p of h.props) {
        assert(p && world.props.includes(p), 'a placed piece is not a body in world.props');
        assert(p.body, 'a placed piece has no collider');
      }

      /* §9.1: no material inside this room was machined here. Every one of
       * them is a `stationMats` material, named, and inked. */
      const mats = new Set();
      const bad = [];
      const visit = (o) => {
        if (!o.isMesh || !o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          mats.add(m.name || '(unnamed)');
          if (!m.name || !/^(deck|station|prop|kit)-/.test(m.name)) bad.push(`'${m.name}' is not the engine's`);
          if (m.userData?.saberNoInk) bad.push(`'${m.name}' is uninked inside a room`);
        }
      };
      h.group.traverse(visit);
      for (const p of h.props) p.mesh.traverse(visit);
      assert(bad.length === 0, `${bad.length} bad materials: ${[...new Set(bad)].slice(0, 4).join(', ')}`);

      /* The surfaces are three meshes, one per slot, so a recolour is an
       * assignment. Changing one changes exactly one. */
      const before = H.SURFACE_SLOTS.map((s) => h.surfaces[s].material.name);
      const key = H.SURFACES.wall.find((k) => k !== h.state.surfaces.wall);
      assert(H.setSurface(world, 'wall', key) === key, 'setSurface refused a colour on its own list');
      assert(h.surfaces.wall.material.name.endsWith(key),
        `the wall wears '${h.surfaces.wall.material.name}' after being set to '${key}'`);
      assert(h.surfaces.floor.material.name === before[0], 'setting the wall moved the floor');
      assert(H.setSurface(world, 'wall', 'not-a-colour') === null, 'setSurface took a colour off the palette');

      /* The mirror is a fixture in the room, and the address is on the door. */
      assert(h.mirror?.at, 'there is no mirror in the cabin');
      assert(h.sign?._rows?.[0] === h.address,
        `the door reads '${h.sign?._rows?.[0]}' and the address is '${h.address}'`);

      const rec = H.homeRecord(world);
      assert(rec.address === h.address && rec.place === 27, 'homeRecord does not answer for the room it dressed');
      return `${h.props.length} bodies, ${h.draws} draws, ${mats.size} materials all stationMats'; `
        + `the door reads ${h.address}; wall ${before[1]} → ${h.surfaces.wall.material.name}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: place, turn, bound, remove — the grid is the room and not a number', async () => {
    const H = await import('../../src/game/Home.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    clearStation();
    const { world } = await station(44);
    try {
      const h = world._home;
      const n0 = h.state.pieces.length;

      /* ADD one, and it is held rather than dropped: §1.3.1's "place" is a
       * thing you carry to where you want it. */
      const held = H.addPiece(world, 'lamp');
      assert(held, 'the catalogue would not give up a lamp');
      assert(h.held === held && h.props[held.i] === null, 'a held piece is still a body');
      assert(h.state.pieces.length === n0 + 1, 'adding a piece did not add a row');

      /* SNAPPED. Anywhere you point, the piece lands on a cell. */
      H.movePiece(world, 1.13, -2.37);
      near(h.held.x, 1.0, 1e-9, 'x did not snap to the grid');
      near(h.held.z, -2.5, 1e-9, 'z did not snap to the grid');

      /* TURNED, in eighths, and it wraps. */
      const r0 = h.held.r;
      for (let i = 0; i < H.NOTCHES; i++) H.rotatePiece(world, 1);
      assert(h.held.r === r0, `${H.NOTCHES} notches did not come back round to ${r0}`);
      H.rotatePiece(world, -1);
      assert(h.held.r === (r0 + H.NOTCHES - 1) % H.NOTCHES, 'the wheel does not turn both ways');
      H.rotatePiece(world, 1);

      /* BOUNDED BY THE ROOM, and the bound is the room's own footprint — not a
       * number typed into this file. A cabin is 15 × 11, so a piece at 20 m is
       * outside it and a piece at the centre is not. */
      const lamp = H.pieceKind('lamp');
      /* The held piece's own row stays in the record while it is in your hands
       * — an interrupted pick must not be a deletion — so it is what `fits`
       * is told to ignore, exactly as the ghost's own legality read does. */
      const mine = h.held.row;
      assert(H.fits(h, lamp, 0, 0, 0, mine) === null, 'the middle of the floor is not a legal cell');
      assert(H.fits(h, lamp, h.spot.w, 0, 0, mine), 'a piece a room-width out of the room was allowed');
      assert(H.fits(h, lamp, 0, h.spot.d, 0, mine), 'a piece a room-depth out of the room was allowed');
      /* …and by the partition the shape declared. */
      const part = h.blockers[0];
      assert(H.fits(h, lamp, part.x, part.z, 0, mine), 'a piece inside the partition was allowed');
      /* …and by what is already down: the map table the cabin comes with. */
      const table = h.state.pieces.find((q) => q.k === 'table');
      assert(H.fits(h, lamp, table.x, table.z, 0, mine), 'a piece inside the map table was allowed');
      assert(h.blockers.length >= 4,
        `#27 declares ${h.blockers.length} blockers; the shape builds a partition, a rack, a stand and a bunk`);

      /* PUT DOWN: the row keeps the pose and a body appears at it. */
      H.movePiece(world, 2.0, -3.0);
      H.dropPiece(world);
      assert(!h.held, 'the piece is still in your hands');
      const row = h.state.pieces[held.i];
      near(row.x, 2.0, 1e-9, 'the row did not keep the x it was set down at');
      assert(h.props[held.i]?.body, 'setting a piece down made no body');
      const world_ = h.props[held.i].body.position;
      /* The body is where the row says, in the room's frame turned into the
       * drum's — which is the one piece of arithmetic this system does. */
      const c = Math.cos(h.spot.yaw), s = Math.sin(h.spot.yaw);
      near(world_.x, h.spot.x + row.x * c + row.z * s, 0.05, 'the body is not where its row says');
      near(world_.z, h.spot.z - row.x * s + row.z * c, 0.05, 'the body is not where its row says');

      /* REMOVED, and removal is the same key: carried out of the room and set
       * down, a piece is put away. */
      const n1 = h.state.pieces.length;
      H.takePiece(world, held.i);
      H.movePiece(world, 40, 40);
      assert(H.dropPiece(world) === null, 'a piece put down outside the room came back');
      assert(h.state.pieces.length === n1 - 1,
        `${h.state.pieces.length} pieces after a removal from ${n1}`);
      assert(world.props.filter((p) => p.kind === 'lamp').length === 0, 'the removed lamp is still a body');

      /* THE CAP HOLDS. A save that has been sat on cannot fill deck 44 with
       * bodies, so the cabin is filled one legal cell at a time until the
       * catalogue refuses — the cap has to be what stops it and not the floor
       * running out, so the crates are laid on a 1 m lattice. */
      let added = 0, tried = 0;
      for (let gx = -6; gx <= 6 && added < H.MAX_PIECES + 4; gx += 1) {
        for (let gz = -4; gz <= 4 && added < H.MAX_PIECES + 4; gz += 1) {
          tried++;
          if (!H.addPiece(world, 'crate')) { gx = 99; break; }
          H.movePiece(world, gx, gz);
          if (H.dropPiece(world)) added++;
        }
      }
      assert(added > 20, `only ${added} of ${tried} lattice cells took a crate — the floor ran out, not the cap`);
      assert(h.state.pieces.length <= H.MAX_PIECES,
        `${h.state.pieces.length} pieces against a cap of ${H.MAX_PIECES}`);
      assert(H.addPiece(world, 'crate') === null || h.state.pieces.length <= H.MAX_PIECES,
        'the catalogue kept giving pieces past the cap');
      return `snapped 1.13 → 1.0, ${H.NOTCHES} notches wrap, ${h.blockers.length} blockers refused, `
        + `body within 5 cm of its row, ${added} crates laid and the cap held at `
        + `${h.state.pieces.length}/${H.MAX_PIECES}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: the surfaces are painted with the key and the wheel, not with a function', async () => {
    /**
     * ── THE DEFECT THIS IS THE PIN FOR, AND THE CHECK WAS PART OF IT ──────
     *
     * `cycleSurface` shipped under a note calling it "what a fixture's verb
     * does" and there was no fixture and no verb: zero callers in `src/`. A
     * hostile pass drove it the way a player would — twelve wheel notches and
     * twelve presses inside a real cabin — and read the wall back as `hull`
     * before and `hull` after.
     *
     * The clause that was supposed to cover this called `setSurface(world,
     * slot, key)` DIRECTLY. A check reading a function the player has no key
     * for is a check that cannot see the only failure that matters, so this
     * one goes through `stationKey` and `homeWheel` and touches neither
     * `setSurface` nor `cycleSurface` by name.
     */
    const H = await import('../../src/game/Home.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    const { stationKey } = await import('../../src/game/Station.js');
    clearStation();
    const { world } = await station(44);
    try {
      const h = world._home;
      /* AT THE PANEL, which is a fixture and has to be stood at. */
      world.player.position.set(h.panel.at.x, h.y + 1.6, h.panel.at.z);
      assert(H.atPanel(world), 'standing on the swatch panel does not read as being at it');
      const before = { ...h.state.surfaces };

      /* THE WHEEL PAINTS THE SLOT THE KEY IS ON. Nothing else is touched —
       * a wheel at the panel that also dialled the catalogue would be the
       * same press meaning two things, which is what the room forbids. */
      const dial0 = h.dial;
      H.homeWheel(world, 1);
      assert(h.state.surfaces.floor !== before.floor,
        `a wheel notch at the panel left the floor on ${h.state.surfaces.floor}`);
      assert(h.dial === dial0, 'the wheel at the panel also dialled the furniture catalogue');

      /* THE KEY STEPS THE SLOT, and it is the SAME key the room is entered
       * with — `stationKey`, which is what `Player._readInput` calls. */
      stationKey(world);
      H.homeWheel(world, 1);
      assert(h.state.surfaces.wall !== before.wall,
        `the key did not move on to the wall — it is still ${h.state.surfaces.wall}`);
      stationKey(world);
      H.homeWheel(world, 1);
      assert(h.state.surfaces.trim !== before.trim,
        `the key did not reach the trim — it is still ${h.state.surfaces.trim}`);

      /* THE ROOM ACTUALLY WEARS IT: the wall mesh's material is the one the
       * record now names, not the one it was built with. */
      const wallMat = h.surfaces?.wall?.material;
      assert(wallMat === h.M[h.state.surfaces.wall],
        'the record says one wall colour and the mesh is wearing another');
      /* AND THE PANEL SAYS SO. A swatch that does not change is a swatch. */
      const chip = h.panel.chips[1];
      assert(chip.material === h.M[h.state.surfaces.wall],
        'the panel is still showing the old wall colour');

      /* IT IS DURABLE. A colour that does not survive the walk out is a
       * colour the player chose and the station forgot. */
      const painted = { ...h.state.surfaces };
      H.leaveHome(world);
      const { homeState } = await import('../../src/game/StationSave.js');
      const kept = homeState()?.surfaces || null;
      assert(kept && kept.wall === painted.wall && kept.floor === painted.floor
        && kept.trim === painted.trim,
        `the room was painted ${JSON.stringify(painted)} and the fold kept ${JSON.stringify(kept)}`);
      return `three slots painted through the key and the wheel: `
        + `${before.floor}/${before.wall}/${before.trim} → `
        + `${painted.floor}/${painted.wall}/${painted.trim}, `
        + 'the meshes and the panel wearing it, and it survived the walk out';
    } finally { world.unload(); clearStation(); }
  });

  check('home: the wheel means two things, and the key means four', async () => {
    const H = await import('../../src/game/Home.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    const { stationKey } = await import('../../src/game/Station.js');
    clearStation();
    const { world } = await station(44);
    try {
      const h = world._home;
      /* Stand in the middle of the cabin, looking down at the floor. */
      const at = h.place;
      world.player.position.set(at.x, h.y + 1.6, at.z);

      /* THE WHEEL, HOLDING NOTHING, dials the catalogue. */
      const d0 = h.dial;
      assert(H.homeWheel(world, 1), 'the wheel was not spent in the cabin');
      assert(h.dial === (d0 + 1) % H.CATALOGUE.length, 'the wheel did not step the catalogue');

      /* THE KEY, on bare floor, puts the dialled piece there and holds it. */
      const n0 = h.state.pieces.length;
      assert(H.homeKey(world, { at: [-5, -3] }), 'the key was not spent on bare floor');
      assert(h.held, 'the key on bare floor put nothing in your hands');
      assert(h.held.c.id === H.CATALOGUE[h.dial].id,
        `the key placed a ${h.held.c.id} while the wheel was on a ${H.CATALOGUE[h.dial].id}`);
      assert(h.state.pieces.length === n0 + 1, 'the key added no row');

      /* THE WHEEL, HOLDING SOMETHING, turns it instead. */
      const dial = h.dial, r = h.held.r;
      assert(H.homeWheel(world, 1), 'the wheel was not spent on a held piece');
      assert(h.dial === dial, 'turning a held piece also moved the catalogue');
      assert(h.held.r === (r + 1) % H.NOTCHES, 'the wheel did not turn the held piece');

      /* THE KEY AGAIN puts it down. */
      assert(H.homeKey(world, { at: [-5, -3] }), 'the key did not put the piece down');
      assert(!h.held, 'the piece is still held after a second press');

      /* THE KEY ON A PIECE picks it up. */
      assert(H.homeKey(world, { at: [-5, -3] }), 'the key on a placed piece was not spent');
      assert(h.held, 'the key on a placed piece did not pick it up');
      H.dropPiece(world);

      /* AND THE MIRROR RAISES THE CREATOR — through `onKiosk`, which is the
       * one door `main.js` opens a panel with. */
      let raised = null;
      world.onKiosk = (id) => { raised = id; };
      world.player.position.copy(h.mirror.at);
      world.player.position.y = h.y + 1.6;
      assert(H.homeKey(world), 'standing at the mirror spent nothing');
      assert(raised === 'mirror', `the mirror raised '${raised}' rather than the creator`);

      /* …and `main.js` knows what to do with that id. A kiosk that names no
       * tab opens the wrong page silently. */
      const src = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
      const tab = src.match(/const KIOSK_TAB = \{[\s\S]*?\n\};/)?.[0] || '';
      assert(/\bmirror:\s*'\w+'/.test(tab), 'KIOSK_TAB has no row for the mirror');

      /* OUTSIDE THE CABIN THE KEY AND THE WHEEL ARE NOT THE HOME'S. §14's one
       * key still belongs to whatever place you are standing in. */
      world.player.position.set(0, h.y + 1.6, 0);
      assert(H.homeKey(world) === false, 'the home claimed the key from outside its own walls');
      assert(H.homeWheel(world, 1) === false, 'the home claimed the wheel from outside its own walls');
      assert(typeof stationKey === 'function', 'the station has no interact key to defer to');
      return `wheel dials ${H.CATALOGUE.length} pieces held-empty and 8 notches held-full; `
        + `the key placed, turned, set down and picked up; the mirror raised '${raised}'`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('home: a parcel bought at a counter is standing in the cabin when you walk in', async () => {
    /**
     * ══ FINDING 4, AND THE ROWS NAMED FURNITURE THAT DID NOT EXIST ════════
     *
     * Four `slot:'home'` rows were on the counters — `cloth`, `banner`,
     * `crate`, `trophy-skull` — against `CATALOGUE`'s ten ids, and THREE OF
     * THE FOUR named nothing at all. A Narn banner was 240 credits for a
     * string. `Keepsakes.WEARERS` holds every row to the catalogue now; this
     * is the other half — that a row which does name a piece produces one.
     *
     * IT LANDS IN `store.parcels` AND THE ROOM UNPACKS IT, which is the field
     * this file's header reserved for V16 §3.2's *"delivers to your apartment
     * overnight"*. The reason is the partition: `fits()` needs `h.blockers`,
     * which only the room's own shape hands back at dress time, and a delivery
     * placed from the Concourse would put a locker in a wall — the four
     * declared blockers cover 19% of the cabin's 30 × 22 grid.
     */
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();

    /* THE COUNTER'S OWN ROW, not a hand-typed id — a row that stopped naming a
     * real piece would fail here rather than at the till. */
    const V = await import('../../src/game/Vendors.js');
    const KS = await import('../../src/game/Keepsakes.js');
    const row = V.everyRow().find((r) => r.slot === 'home');
    assert(row, 'no counter sells a piece of furniture at all');
    assert(KS.wearable(row), `${row.id} names ${JSON.stringify(row.value)}, which is not in CATALOGUE`);

    const before = H.loadHome().pieces.length;
    const sent = H.deliverPiece(row.value);
    assert(sent.ok, `the delivery was refused: ${sent.why}`);
    /* NOT ON THE FLOOR YET. It is a parcel, and the room has not been walked
     * into — putting it down from the shop is the thing that cannot be done. */
    assert(H.loadHome().pieces.length === before,
      'the piece went straight onto the floor from the counter, where nothing knows about the '
      + 'partition');
    assert(H.parcels().some((r) => r.id === row.value), 'nothing is waiting to be unpacked');

    /* AND NOW WALK IN. */
    let after = 0, waiting = 0, at = null;
    const one = await station(44);
    try {
      const h = one.world._home;
      after = h.state.pieces.length;
      waiting = (h.state.store.parcels || []).length;
      /* THE LAST ONE, not the first: `unpackParcels` pushes, and the shipped
       * `DEFAULT_LAYOUT` already contains a chair — the first cut of this line
       * found THAT one and reported the delivery at the default layout's
       * coordinates. */
      at = h.state.pieces[h.state.pieces.length - 1] || null;
      assert(after === before + 1,
        `${after} pieces in the cabin against ${before + 1} — the parcel was not unpacked`);
      assert(!waiting, `${waiting} parcels still in the box after walking in`);
      assert(at && at.k === row.value, `the last piece in the cabin is a ${at?.k}, not a ${row.value}`);
      /* WHERE THE PLAYER COULD HAVE PUT IT THEMSELVES. `fits` is the same rule
       * their own hands are held to, so a delivered piece can never stand
       * somewhere they could not have set it down. */
      assert(!H.fits(h, H.pieceKind(row.value), at.x, at.z, at.r, at),
        `the ${row.value} was delivered to ${at.x}, ${at.z}, which fits() refuses`);
      /* AND ONE BODY PER ROW, in step. `leaveHome` walks the two lists
       * together and a parcel pushed without a `Prop` beside it would put them
       * one apart for ever. */
      assert(h.props.length === h.state.pieces.length,
        `${h.props.length} bodies for ${h.state.pieces.length} rows — the two lists are apart`);
    } finally { one.world.dispose?.(); }

    /* AND THE BOX IS EMPTY ON DISK, so the next visit does not unpack it again.
     * `leaveHome` takes `store` from the DISK on the way out — correctly — so
     * an unpack that only emptied memory would re-deliver once per visit. */
    const disk = H.loadHome();
    assert(!(disk.store.parcels || []).length,
      'the parcel is still on disk — it will be unpacked again on every visit, for ever');
    assert(disk.pieces.some((p) => p.k === row.value), 'the delivered piece did not survive the leaving');
    S.clearStation();
    return `${row.id} → a ${row.value}: ${before} pieces + 1 parcel → ${after} pieces at `
      + `${at.x}, ${at.z} and 0 waiting; the box is empty on disk`;
  });

  check('home: saved on leaving, survived by a re-dress, and never a fourth durable key', async () => {
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();

    let placed = null, addr = null;
    const one = await station(44);
    try {
      const h = one.world._home;
      addr = h.address;
      H.setSurface(one.world, 'floor', 'mark');
      H.addPiece(one.world, 'plant');
      H.movePiece(one.world, -4.0, -3.5);
      H.rotatePiece(one.world, 2);
      H.dropPiece(one.world);
      placed = h.state.pieces.length;

      /* NOT WRITTEN YET. §1.3.5 is "saved on leaving" and `leaveDeck`'s reason
       * is that a home is edited by dozens of small movements: a write per
       * wheel notch is the thing this pattern exists to refuse. */
      assert(S.homeState() === null,
        'the fold was written during the visit — that is a localStorage write per placement');
    } finally { one.world.dispose?.(); }

    /* …and the dispose is what wrote it, through `undressStation`. */
    const saved = S.homeState();
    assert(saved && typeof saved === 'object', 'leaving the station wrote no home');
    assert(saved.v === 1, `the fold stored v=${saved.v}`);
    assert(saved.surfaces.floor === 'mark', `the floor came back '${saved.surfaces.floor}'`);
    assert(saved.pieces.length === placed, `${saved.pieces.length} pieces stored for ${placed} placed`);
    assert(saved.place === 27, `the record does not say which door it was behind (${saved.place})`);
    assert(saved.pieces.some((p) => p.k === 'plant'), 'the planter did not survive the leaving');

    /**
     * AND A VISIT WRITES ONLY WHAT THE ROOM OWNS. Food is bought at a counter
     * and a parcel is delivered overnight (V16 §2 B5, §3.2) — both while the
     * player is somewhere else — so a visit that ended by writing the copy it
     * started with would take the shopping back off the shelf.
     */
    S.clearStation();
    const three = await station(44);
    try {
      H.addPiece(three.world, 'crate');
      H.movePiece(three.world, -2, -4);
      H.dropPiece(three.world);
      /* …and the counter writes the store from outside the room, mid-visit. */
      H.setHomeStock('food', [{ id: 'nerf-stew', n: 2 }]);
    } finally { three.world.dispose?.(); }
    const after = S.homeState();
    assert(after.store.food.length === 1 && after.store.food[0].id === 'nerf-stew',
      'leaving the home wiped what was bought during the visit');
    assert(after.pieces.length === H.DEFAULT_LAYOUT.length + 1,
      `${after.pieces.length} pieces after adding one to ${H.DEFAULT_LAYOUT.length}`);

    /* Put the two-visit record back for the re-dress below. */
    S.setHomeState(saved);

    /* AND IT COMES BACK. A second visit is the same room. */
    const two = await station(44);
    let back;
    try {
      const h = two.world._home;
      back = h.state.pieces.length;
      assert(h.state.surfaces.floor === 'mark', 'the floor colour did not come back');
      assert(h.surfaces.floor.material.name.endsWith('mark'), 'the floor came back wearing the wrong material');
      const p = h.state.pieces.find((q) => q.k === 'plant');
      assert(p, 'the planter did not come back');
      near(p.x, -4.0, 1e-9, 'the planter came back somewhere else');
      assert(h.props.filter(Boolean).length === back, 'a stored piece came back without a body');
      assert(h.address === addr, `the address changed between visits (${addr} → ${h.address})`);
    } finally { two.world.dispose?.(); }

    /**
     * ══ AND NOT THROUGH `localStorage` ═════════════════════════════════════
     *
     * `session.mjs` counts the durable writers in this tree and asserts at most
     * three. The home is the `home` FIELD of the station's fold and is reached
     * only through `homeState`/`setHomeState` — so `Home.js` naming the browser
     * store at all is the defect, whatever it named it for.
     */
    const src = await readFile(new URL('../../src/game/Home.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(!/localStorage|sessionStorage|indexedDB/.test(code),
      'Home.js reaches durable storage itself — the home is a field of the station fold');
    assert(/setHomeState|saveHome/.test(code), 'Home.js has no writer at all');

    /* §9.2: no station-side file branches on a game mode. */
    for (const m of ['command', 'theline', 'duel', 'training', 'sandbox', 'raid', 'blade', 'trial']) {
      const re = new RegExp(`(===?\\s*|!==?\\s*)['"\`]${m}['"\`]`);
      assert(!re.test(code), `Home.js branches on the mode '${m}'`);
    }
    return `nothing written during the visit, ${saved.pieces.length} pieces + floor '${saved.surfaces.floor}' `
      + `written on leaving, ${back} came back at ${addr}; a visit kept ${after.store.food[0].n} `
      + `bowls of stew bought while it was in progress; 0 durable writers in Home.js`;
  });
}
