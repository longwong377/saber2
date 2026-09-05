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
      /**
       * Stand in the middle of the OUTER ROOM, looking down at the floor.
       *
       * Not the middle of the CABIN, which is where this stood: the shape's
       * partition is at z = 0.6 in the room's own frame, so the room's centre
       * is 45 cm from the face of a wall and V15 §1.3.3's wheel — which slides
       * the partition you are standing at — correctly claimed the notch. A
       * check about the catalogue has to stand somewhere the catalogue is the
       * only thing the wheel can mean. 3.5 m back from the middle, which is
       * `toWorld(h, 0, -3.5)` written out because that function is the room's
       * and not this file's.
       */
      const at = h.place;
      const lz = -3.5;
      world.player.position.set(at.x + lz * Math.sin(h.spot.yaw), h.y + 1.6,
        at.z + lz * Math.cos(h.spot.yaw));

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

  /**
   * ══ V15 §1.3.3, BOTH HALVES, THROUGH THE KEY AND THE WHEEL ══════════════
   *
   * *"Make the partition movable and let a third be unlocked — the address is
   * what pays for it."*
   *
   * WHAT WAS THERE: a static blocker. `SHAPES.twinroom` lays one slab and
   * hands its rectangle over, and the only line in `Home.js` that had ever
   * read it was `fits`, to REFUSE a piece. Nothing moved it and there was no
   * second one.
   *
   * DRIVEN THE WAY A PLAYER DRIVES IT, and that is not a preference — the
   * clause above (`the surfaces are painted with the key and the wheel, not
   * with a function`) exists because a check that called `setSurface` directly
   * shipped a dead control for four weeks. So this touches neither `moveWall`
   * nor `toggleWall` by name: it stands the player at the wall and spends
   * `homeWheel` and `stationKey`, which is what `Player._readInput` calls.
   */
  check('home: the partition MOVES, and it moves the wall, the collider and the rule together', async () => {
    const H = await import('../../src/game/Home.js');
    const { clearStation, homeState } = await import('../../src/game/StationSave.js');
    clearStation();
    const { world } = await station(44);
    try {
      const h = world._home;
      assert(h.wallWhy === null && h.walls.length === 1,
        `the shape's partition was not taken over: ${h.wallWhy || `${h.walls.length} walls`}. `
        + 'Everything below is inert without it and the room is a static blocker again');

      /* Where the room's own frame puts a point, written out because `toWorld`
       * belongs to Home.js and a second copy of it here would be the twin. */
      const stand = (lx, lz) => world.player.position.set(
        h.place.x + lx * Math.cos(h.spot.yaw) + lz * Math.sin(h.spot.yaw), h.y + 1.6,
        h.place.z - lx * Math.sin(h.spot.yaw) + lz * Math.cos(h.spot.yaw));

      const was = h.walls[0].rect.z;
      const kitZ = h.spot.blockers[0].z;
      assert(was === kitZ, `a fresh cabin's partition stands at ${was} and the shape built it at ${kitZ}`);

      /* WHERE THE SLAB'S OWN VERTICES ARE, read out of the room's merged mesh
       * — the thing that actually has to move, and the thing a blocker-only
       * implementation would leave standing while the rule walked away. */
      const slabZ = () => {
        const p = h.kitWall.mesh.geometry.attributes.position;
        let lo = Infinity, hi = -Infinity;
        for (const j of h.kitWall.idx) { const z = p.getZ(j); lo = Math.min(lo, z); hi = Math.max(hi, z); }
        return (lo + hi) / 2;
      };
      const slab0 = slabZ();
      const box0 = h.walls[0].box;
      assert(box0, 'the shape\'s partition has no collider — the wall would be scenery');
      const boxZ0 = box0.center.z;

      /* THE WHEEL, STANDING AT IT. Four notches is two metres. */
      stand(0, was + 0.7);
      assert(H.wallAt(world) === 0, 'standing beside the partition does not read as being at it');
      for (let i = 0; i < 4; i++) assert(H.homeWheel(world, 1), 'a notch at the partition was not spent');
      /**
       * FOUR CELLS FROM THE GRID LINE UNDER IT, not four cells from where it
       * was. `twinroom` builds the partition at 0.6 and `CELL` is 0.5, so the
       * shape's own position is OFF the grid — deliberately, see `dressWalls`
       * — and the first notch is what puts it on. A wall a player has touched
       * lands where the furniture lands and nowhere else.
       */
      const now = h.walls[0].rect.z;
      near(now, Math.round(was / H.CELL) * H.CELL + 4 * H.CELL, 1e-9,
        'four notches did not take the wall four cells past the grid line under it');
      assert(Math.abs(now / H.CELL - Math.round(now / H.CELL)) < 1e-9,
        `the wall came to rest at ${now}, which is not on the ${H.CELL} m grid the furniture is on`);

      /* …AND ALL THREE THINGS MOVED WITH IT. */
      near(slabZ() - slab0, now - was, 1e-4, 'the slab in the room\'s mesh did not follow the record');
      assert(h.walls[0].box !== box0,
        'the collider was edited in place rather than removed and re-added — `physics.boxVersion` and '
        + 'BoxIndex\'s buckets would be stale and six hand-rolled sweeps would find the old wall');
      near(Math.abs(h.walls[0].box.center.z - boxZ0), Math.abs(now - was), 1e-4,
        'the static box did not move with the wall');
      assert(!world.physics.staticBoxes.includes(box0),
        'the shape\'s original collider is still standing where the wall used to be — the cabin is '
        + 'solid in two places and only one of them has a wall drawn at it');
      assert(world.physics.staticBoxes.filter((b) =>
        Math.abs(b.halfExtents.x - h.walls[0].rect.w / 2) < 1e-6
        && Math.abs(b.halfExtents.z - h.walls[0].rect.d / 2) < 1e-6).length === 1,
        'there is more than one partition-shaped collider in the room');
      assert(H.pieceKind('chair') && H.fits(h, H.pieceKind('chair'), 0, now, 0) === 'in the partition',
        'the grid still lets a chair stand where the partition now is');
      assert(H.fits(h, H.pieceKind('chair'), 0, was, 0) === null,
        'the grid still refuses a chair where the partition used to be');

      /* THE SHAPE'S OWN DECLARATION IS UNTOUCHED. `spot.blockers` is
       * `st.home`'s array and this room is re-dressed while the station
       * stands; a wall that walked it would move the room for everybody. */
      near(h.spot.blockers[0].z, kitZ, 1e-9, 'sliding the wall edited the shape\'s own blocker');

      /* IT WILL NOT GO THROUGH THE FURNITURE, which is the rule the furniture
       * is under, applied to the wall. The map table is at z = −1.5. */
      const before = h.walls[0].rect.z;
      stand(0, before + 0.7);
      for (let i = 0; i < 12; i++) H.homeWheel(world, -1);
      const stopped = h.walls[0].rect.z;
      assert(stopped > -1.5, `the wall slid to ${stopped} and the map table is at −1.5 — it went through it`);

      /* AND IT IS DURABLE. */
      const kept = h.walls[0].rect.z;
      H.leaveHome(world);
      const saved = homeState();
      assert(Array.isArray(saved.walls) && saved.walls.length === 1,
        `the fold stored ${JSON.stringify(saved.walls)} for one partition`);
      near(saved.walls[0], kept, 1e-9, 'the wall came off the record somewhere else');
      return `the shape built it at ${kitZ}; four notches took it to ${now} — slab, collider and `
        + `\`fits\` all moved together, the shape's own blocker stayed at ${kitZ}, the wheel stopped `
        + `at ${stopped} rather than crossing the map table, and ${saved.walls[0]} survived the walk out`;
    } finally { world.unload(); clearStation(); }
  });

  /**
   * ══ THE THIRD ROOM, AND THAT NOTHING IS CHARGED FOR IT ══════════════════
   *
   * *"…let a third be unlocked — the address is what pays for it."*
   *
   * The argument is in `Home.js`'s partition chapter: an address is a DEED and
   * a deed already covers the floor, so a third room adds not one square metre
   * and costs nothing — what it adds is a wall, and what entitles you to put a
   * wall up in a room is that the room is yours. `Progress.js`'s own doctrine
   * is the reason a price was refused: *"a creator you have to earn is a
   * creator you cannot use"*, and a room is worse.
   *
   * SO THE ASSERTION IS THAT NOTHING MOVES BUT THE ROOM. Credits and the run
   * record are read either side of the press and have to be identical — the
   * same standard `counter.mjs` holds a keepsake to, run the other way round.
   */
  check('home: a third room is unlocked by the address, and nothing is charged for it', async () => {
    const H = await import('../../src/game/Home.js');
    const { clearStation, homeState } = await import('../../src/game/StationSave.js');
    const { stationKey } = await import('../../src/game/Station.js');
    const Credits = await import('../../src/game/Credits.js');
    const Progress = await import('../../src/game/Progress.js');
    clearStation();
    const { world } = await station(44);
    let rooms = 0, bays = '';
    try {
      const h = world._home;
      assert(h.walls.length === 1, 'the cabin did not start as two rooms');
      const stand = (lx, lz) => world.player.position.set(
        h.place.x + lx * Math.cos(h.spot.yaw) + lz * Math.sin(h.spot.yaw), h.y + 1.6,
        h.place.z - lx * Math.sin(h.spot.yaw) + lz * Math.cos(h.spot.yaw));

      const purse0 = Credits.purse();
      const rec0 = JSON.stringify(Progress.loadProgress());
      const door0 = h.sign._rows.map(String).join('|');

      /* THE KEY, STANDING AT THE PARTITION — `stationKey`, which is the one
       * key the station has and what `Player._readInput` spends. */
      stand(0, h.walls[0].rect.z + 0.7);
      assert(stationKey(world) === true, 'the key at the partition was not spent');
      assert(h.walls.length === 2,
        `the key at the partition left ${h.walls.length} wall(s) — there is no third room`);
      rooms = h.walls.length + 1;

      /* A REAL WALL: a mesh in the room's group and a collider in the world. */
      const W = h.walls[1];
      assert(W.mesh && h.group.children.includes(W.mesh),
        'the third room is a rectangle in a list with nothing standing there');
      assert(W.box && world.physics.staticBoxes.includes(W.box),
        'the second partition has no collider — you would walk through the wall');
      assert(H.fits(h, H.pieceKind('chair'), W.rect.x, W.rect.z, 0) === 'in the partition',
        'the grid does not know about the second partition');
      assert(h.blockers.length === h.spot.blockers.length + 1,
        `the grid reads ${h.blockers.length} blockers for ${h.walls.length} walls + `
        + `${h.spot.blockers.length - 1} fittings`);

      /* THREE BAYS, all of them a room you can stand in. */
      const edges = [-h.spot.d / 2, ...h.walls.map((q) => q.rect.z).sort((a, b) => a - b), h.spot.d / 2];
      const depths = [];
      for (let i = 1; i < edges.length; i++) depths.push(edges[i] - edges[i - 1]);
      assert(depths.length === 3 && depths.every((d) => d >= H.MIN_ROOM),
        `the three bays measure ${depths.map((d) => d.toFixed(1)).join(' / ')} m against a `
        + `${H.MIN_ROOM} m minimum`);
      bays = depths.map((d) => d.toFixed(1)).join(' / ');

      /* THE ADDRESS IS WHAT PAID FOR IT, SO THE ADDRESS IS WHAT SAYS SO. */
      const door1 = h.sign._rows.map(String).join('|');
      assert(door1 !== door0 && /THREE/i.test(door1),
        `the door still reads ${JSON.stringify(door1)} — the visible half of "the address is what `
        + 'pays for it" is that the door says how many rooms are behind it');
      assert(door1.includes(h.address), 'the door stopped printing the address');

      /* AND NOTHING WAS CHARGED. */
      assert(Credits.purse() === purse0,
        `the purse went ${purse0} → ${Credits.purse()}. A room is not a keepsake you buy — see the `
        + 'partition chapter in Home.js and the AMENDMENT — CREDITS in Progress.js');
      assert(JSON.stringify(Progress.loadProgress()) === rec0, 'putting a wall up wrote to the run record');

      /* AND THE KEY TAKES IT DOWN AGAIN, which is what makes it one press with
       * one meaning rather than a one-way door. */
      stand(0, W.rect.z + 0.7);
      assert(stationKey(world) === true, 'the key at the second partition was not spent');
      assert(h.walls.length === 1, 'the second partition would not come down');
      assert(!h.group.children.includes(W.mesh), 'the wall came out of the record and stayed in the room');
      assert(!world.physics.staticBoxes.includes(W.box), 'the wall came down and left its collider standing');
      assert(h.sign._rows.map(String).join('|') === door0, 'the door still claims a third room');

      /* Put it back up and walk out. */
      stand(0, h.walls[0].rect.z + 0.7);
      stationKey(world);
      assert(h.walls.length === 2, 'the third room would not go back up');
      H.leaveHome(world);
      const saved = homeState();
      assert(saved.walls.length === 2, `the fold stored ${JSON.stringify(saved.walls)} for three rooms`);
    } finally { world.unload(); }

    /* IT COMES BACK. A room that has to be re-made every visit is a menu. */
    const two = await station(44);
    try {
      const h = two.world._home;
      assert(h.walls.length === 2, `a second visit dressed ${h.walls.length + 1} rooms`);
      assert(h.walls[1].mesh && h.walls[1].box, 'the third room came back as a number with no wall in it');
      assert(/THREE/i.test(h.sign._rows.map(String).join('|')), 'the door forgot the third room');
    } finally { two.world.unload(); clearStation(); }

    /**
     * ══ AND IT IS REFUSED WHERE THE ADDRESS IS NOT YOURS ══════════════════
     *
     * That is the whole of "the address is what pays for it" as an
     * enforcement: every verb starts at `world._home`, which `dressHome`
     * assigns only under `mine`, so "you may divide your own cabin and not
     * your friend's" is not a permission test that can be forgotten — it is
     * the absence of a way to say it, exactly as `Coop.js` §WHO MAY MOVE THE
     * FURNITURE relies on for the placement verbs.
     *
     * An ABSENCE is checked by grep and not by driving, because driving can
     * only ever show that the ways you thought of are shut. `world._homes` is
     * the list of EVERY dressed apartment; a wall verb that reached it would
     * be a way to name somebody else's room.
     */
    const src = await readFile(new URL('../../src/game/Home.js', import.meta.url), 'utf8');
    for (const fn of ['wallAt', 'moveWall', 'toggleWall']) {
      const at = src.indexOf(`export function ${fn}(`);
      assert(at > 0, `Home.js exports no ${fn}`);
      const body = src.slice(at, src.indexOf('\n}\n', at));
      assert(/world\s*&&\s*world\._home/.test(body),
        `${fn} does not start at \`world._home\` — a wall verb that found a room any other way `
        + "could divide a friend's cabin");
      assert(!/_homes|homeUnder/.test(body),
        `${fn} reaches every dressed apartment. The one home the verbs may name is yours`);
    }

    return `the key at the partition made ${rooms} rooms of ${bays} m, with a mesh, a collider and a `
      + 'blocker each; the door reads THREE ROOMS; the purse and the run record did not move; '
      + 'the same key took it down and put it back, and it came back on the next visit; '
      + '3 wall verbs, all of them fenced by `world._home` and none of them able to name another';
  });

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
  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ A FIELD THE RECORD DECLARES AND NOTHING KEEPS ═══════════════════════
   *
   * `state.pad` was sanitised, carried through `leaveHome` and written to the
   * fold for two whole versions with NO fixture, NO writer and NO reader
   * anywhere in `src/`. Every check in this file was green throughout, because
   * every one of them asks about something the record DOES: this one asks
   * about the record itself.
   *
   * ── DERIVED FROM THE SHAPE, NEVER FROM A LIST ─────────────────────────────
   *
   * The fields come from `cleanHome({})` — the sanitised record itself — so a
   * field added tomorrow is in this check tomorrow, and a check that names its
   * own fields (which is what a hard-coded list is) could never have caught
   * `pad` in the first place: nobody would have added `pad` to it.
   *
   * ── AND A COPY IS NOT A READ, WHICH IS THE WHOLE DIFFICULTY ───────────────
   *
   * The naive test — "does anything mention `.pad`" — passes on the defect.
   * Measured against the record as it shipped, `pad` had exactly two mentions
   * and both were copies of it into a slot of its own name:
   *
   *     h.state.pad = now.pad;            (leaveHome, carrying the fold across)
   *     store: h.state.store, pad: h.state.pad,      (homeRecord, reporting it)
   *
   * A field that is only ever moved from one copy of the record to another is
   * exactly the field with no reader. So both shapes are struck out of the
   * corpus before the reads are counted, and on the shipped record `pad` then
   * counts ZERO and this goes red — which is the only proof that a check of
   * this kind is worth having.
   *
   * ── WHAT COUNTS AS A READ ────────────────────────────────────────────────
   *
   * A property access on a record-shaped receiver (`state`, `rec`, `now`,
   * `saved`, a call's result) that is not itself an assignment, anywhere in
   * `src/` — not only in this lane, because `Coop.js` is the only reader of
   * `place` and a check scoped to `Home.js` would demand a reader be added
   * beside a reader that already exists.
   *
   * A NESTED KEY (`surfaces.floor`, `store.parcels`) is allowed a second door:
   * its parent is indexed by a variable somewhere (`surfaces[slot]`) and the
   * key is named as a string literal somewhere. That is weaker than the
   * top-level rule and it is stated rather than hidden — a dynamic index is
   * genuinely how those two are read, and demanding `.floor` would demand the
   * three-slot loop be unrolled.
   *
   * ── THE ONE EXEMPTION, AND IT IS DECLARED IN THE RECORD ───────────────────
   *
   * `@noreader <field> — <why>` in `clean`'s own source exempts a field, and
   * the reason is printed in this check's result, so an exemption is a
   * sentence in the gate's output rather than a name buried in a check file.
   * There is one: `v`, the migration hook.
   */
  check('home: every field of the record has a reader, and a copy is not one', async () => {
    const H = await import('../../src/game/Home.js');
    const { functionBody } = await import('./_source.mjs');
    const { readdir } = await import('node:fs/promises');

    const root = new URL('../../src/', import.meta.url);
    const walk = async (dir) => {
      const out = [];
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) out.push(...await walk(u));
        else if (e.name.endsWith('.js')) out.push(u);
      }
      return out;
    };
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const files = await walk(root);
    const homeUrl = files.find((u) => String(u).endsWith('/game/Home.js'));
    assert(homeUrl, 'src/game/Home.js is not in src/ any more');
    const homeRaw = await readFile(homeUrl, 'utf8');
    /* `clean` is the DECLARATION and can never be its own reader — `raw.pad`
     * inside the sanitiser is the line that made the field exist. */
    const cleanBody = functionBody(homeRaw, 'function clean(v) {');
    let corpus = '';
    for (const u of files) {
      const t = await readFile(u, 'utf8');
      corpus += `\n${strip(u === homeUrl ? t.replace(cleanBody, ' ') : t)}`;
    }

    /* The fields, off the sanitised record and nowhere else. */
    const fields = [];
    const add = (o, path) => {
      for (const [k, v] of Object.entries(o)) {
        fields.push({ k, path: [...path, k].join('.'), parent: path[path.length - 1] || null });
        if (v && typeof v === 'object' && !Array.isArray(v) && path.length < 1) add(v, [...path, k]);
      }
    };
    add(H.cleanHome({}), []);
    assert(fields.length >= 7, `the record has ${fields.length} fields — cleanHome returned nothing`);

    /* The declared exemptions, off `clean`'s own comments. */
    const exempt = new Map();
    for (const m of cleanBody.matchAll(/@noreader\s+(\w+)\s*—\s*([^\n*]{16,})/g)) {
      exempt.set(m[1], m[2].trim());
    }

    const RECV = String.raw`(?:state|rec|record|now|saved|home|out|next|\))`;
    const dead = [];
    const how = [];
    for (const f of fields) {
      if (exempt.has(f.k)) { how.push(`${f.path} exempt`); continue; }
      /* Strike out the two shapes of a copy-through before counting. */
      const lean = corpus
        .replace(new RegExp(String.raw`\.${f.k}\s*=\s*[\w.?()]*\.${f.k}\b`, 'g'), ' ')
        .replace(new RegExp(String.raw`\b${f.k}\s*:\s*[\w.?()[\]]*\.${f.k}\b`, 'g'), ' ');
      const hits = (lean.match(new RegExp(`${RECV}\\s*\\.${f.k}\\b(?!\\s*=[^=])`, 'g')) || []).length;
      if (hits) { how.push(`${f.path}×${hits}`); continue; }
      if (f.parent
        && new RegExp(String.raw`\.${f.parent}\s*\[`).test(corpus)
        && new RegExp(`['"\`]${f.k}['"\`]`).test(corpus)) {
        how.push(`${f.path} via ${f.parent}[…]`);
        continue;
      }
      dead.push(f.path);
    }
    assert(dead.length === 0,
      `${dead.join(', ')} — declared by the record and read by nobody. Either something reads `
      + `it or it does not belong in the record; a field that is only copied from one copy of `
      + `the record to another is the defect this check exists for. A deliberate exception says `
      + `so with '@noreader <field> — <why>' in clean().`);

    /* AND THE CHECK CAN FAIL. A name the record does not have must come back
     * dead, or this is nine regular expressions that always pass. */
    const canary = ['state.nosuchfield', 'rec.nosuchfield'].every((s) => !corpus.includes(s));
    assert(canary, 'the corpus already mentions the canary');

    return `${fields.length} fields off cleanHome(), ${files.length} files of src/ read: `
      + `${how.join(', ')}${exempt.size ? ` — ${[...exempt].map(([k, w]) => `${k}: ${w}`).join('; ')}` : ''}`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ V15 §1.3's LAST CLAUSE, DRIVEN FROM THE ROOM IT IS CHOSEN IN ═════════
   *
   * *"a cabin gets a perch, a basket or a charge pad for one small companion,
   * and which one is a choice you make at the habitat."*
   *
   * Four things, and the check refuses to touch `Home.setPad` by name for the
   * reason `the surfaces are painted with the key and the wheel` gives: the
   * door the player uses is `Habitat.choosePad`, and a check that reaches past
   * it can ship a dead control. So the choice is made at the habitat, and
   * everything after that is read off the room.
   */
  check('home: the cabin gets a perch, a basket or a charge pad, chosen at the habitat', async () => {
    const H = await import('../../src/game/Home.js');
    const HAB = await import('../../src/game/Habitat.js');
    const KEN = await import('../../src/game/Kennel.js');
    const S = await import('../../src/game/StationSave.js');
    const { COMPANION_ORDER, COMPANION_KINDS, COMPANION_UNITS } = await import('../../src/game/CompanionKinds.js');
    S.clearStation();
    KEN.clear();

    /* THREE FIXTURES, BECAUSE THE SENTENCE NAMES THREE THINGS. */
    assert(H.PADS.length === 3, `${H.PADS.length} fixtures for "a perch, a basket or a charge pad"`);
    const suits = new Set(H.PADS.map((p) => p.suits));
    assert(suits.size === 3, `the three fixtures suit ${suits.size} kinds of animal, not three`);

    /**
     * ── WHO IS SMALL, AND THE ANSWER IS THE ARCHETYPE TABLE'S ─────────────
     *
     * `PAD_MASS` has to PARTITION the companions, and the check asserts the
     * shape of the partition rather than the names in it: everything the
     * cabin holds is under the bar, everything the kennel holds is over it,
     * and the small ones between them cover all three fixtures — which is why
     * three fixtures is the right number and not two or five.
     */
    const small = COMPANION_ORDER.filter((id) => H.padSuit(id));
    const covered = new Set(small.map((id) => H.padSuit(id)));
    assert(small.length >= 3, `${small.length} companions are small enough to live in a cabin`);
    assert(covered.size === 3,
      `the ${small.length} cabin-sized companions between them want ${covered.size} of the 3 fixtures`);
    for (const id of COMPANION_ORDER) {
      const A = COMPANION_UNITS[COMPANION_KINDS[id].archetype];
      const under = !!A && A.mass > 0 && A.mass <= H.PAD_MASS;
      assert(!!H.padSuit(id) === under,
        `${id} is ${under ? 'under' : 'over'} ${H.PAD_MASS} kg and padSuit says ${H.padSuit(id)}`);
    }

    /* A HAND-EDITED SAVE CANNOT PUT A FIXTURE IN THE ROOM THAT DOES NOT EXIST. */
    S.setHomeState({ pad: 'hammock' });
    assert(H.loadHome().pad === null, `a save asking for a 'hammock' came back ${H.loadHome().pad}`);
    S.clearStation();

    /* THE CHOICE, MADE AT THE HABITAT AND NOWHERE ELSE. */
    KEN.adopt('hawk', 'KITE');
    const before = HAB.habitatPanel();
    assert(before.pad, 'the habitat panel offers no cabin fixture at all');
    assert(before.pad.rows.length === 3, `${before.pad.rows.length} rows offered`);
    assert(before.pad.chosen === null, `a fresh cabin already has a '${before.pad.chosen}'`);
    assert(before.pad.who && before.pad.who.suit === 'flier',
      'the habitat does not know the hawk is a flier that lives at home');
    const fits = before.pad.rows.filter((r) => r.fits).map((r) => r.id);
    assert(fits.length === 1 && fits[0] === 'perch',
      `the habitat says ${JSON.stringify(fits)} suits a hawk`);
    /* …AND `fits` IS A LABEL AND NOT A GATE, which is proved further down by
     * choosing a BASKET for a bird and reading the basket back out of the
     * room — not by an assertion on a field the row does not carry. */

    HAB.choosePad('perch');
    assert(S.homeState()?.pad === 'perch',
      `the habitat's choice reached the fold as ${JSON.stringify(S.homeState()?.pad)}`);

    /* AND THE ROOM BUILDS IT, WITH THE ANIMAL ON IT. */
    let seatY = 0, span = 0, padDraws = 0, birdDraws = 0;
    const one = await station(44);
    try {
      const h = one.world._home;
      assert(h.pad, 'the cabin dressed no fixture for a record that names one');
      assert(h.pad.id === 'perch', `the record says perch and the room built a ${h.pad.id}`);
      assert(h.pad.meshes.length > 0, 'the fixture is a name and no geometry');
      padDraws = h.pad.meshes.length;
      for (const m of h.pad.meshes) {
        assert(m.parent === h.group, 'the fixture was not put in the room\'s own group');
        assert(h.built.includes(m), 'the fixture is not on the teardown list — it would outlive the room');
      }
      /* THE ANIMAL IS ACTUALLY USING IT: a body, in the room, with its feet on
       * the fixture's own rest height, and not merely a flag. */
      assert(h.pad.root, 'the perch is empty — the small companion is not on it');
      assert(h.pad.root.parent === h.group, 'the companion is not in the room');
      h.pad.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(h.pad.root);
      seatY = box.min.y;
      span = box.max.x - box.min.x > box.max.z - box.min.z
        ? box.max.z - box.min.z : box.max.x - box.min.x;
      near(seatY, h.y + h.pad.rest, 0.02, 'the companion\'s feet are not on the fixture');
      h.pad.root.traverse((o) => { if (o.isMesh) birdDraws++; });
      assert(birdDraws > 8, `the companion is ${birdDraws} meshes — it is not a body`);
      /* A FLIER AT REST HAS ITS WINGS IN. Unfolded the hawk is 1.83 m across. */
      assert(span < 0.9, `the perched hawk is ${span.toFixed(2)} m across with its wings out`);
      const R = H.homeRecord(one.world);
      assert(R.pad === 'perch' && R.padded && R.resident, `homeRecord says ${JSON.stringify(R.pad)}`);
    } finally { one.world.dispose?.(); }

    /* IT SURVIVES LEAVING, AND THE ROOM IS THE SAME ROOM NEXT TIME. */
    assert(S.homeState()?.pad === 'perch', 'leaving the station forgot the fixture');
    const two = await station(44);
    let back = null;
    try {
      back = two.world._home.pad?.id || null;
      assert(back === 'perch', `the fixture came back as ${JSON.stringify(back)}`);
      /* AND THE HABITAT CAN CHANGE IT WITH THE ROOM STANDING — the player is
       * two decks away when they choose, so the write has to reach a dressed
       * cabin as well as the fold. */
      HAB.choosePad('basket', two.world);
      assert(two.world._home.pad?.id === 'basket',
        `the room still holds a ${two.world._home.pad?.id} after the habitat chose a basket`);
      assert(two.world._home.pad.root, 'the basket is empty');
      /* AND TAKING IT OUT IS THE OTHER HALF OF A CHOICE. */
      HAB.choosePad(null, two.world);
      assert(!two.world._home.pad, 'the fixture is still standing after it was taken out');
      const stray = [];
      two.world._home.group.traverse((o) => { if (/home-pad-/.test(o.name || '')) stray.push(o.name); });
      assert(stray.length === 0, `${stray.join(', ')} left standing in the room`);
    } finally { two.world.dispose?.(); }

    /* A COMPANION TOO BIG FOR A CABIN GETS THE FIXTURE AND NO ANIMAL. */
    KEN.clear();
    KEN.adopt('blurrg', 'HEAVY');
    HAB.choosePad('basket');
    const three = await station(44);
    let bigWhy = null;
    try {
      const h = three.world._home;
      assert(h.pad && h.pad.id === 'basket', 'the fixture is the player\'s choice and not the animal\'s');
      assert(!h.pad.root, 'a 640 kg blurrg is asleep in a cabin basket');
      bigWhy = HAB.padChoice().why;
      assert(bigWhy && /\d/.test(bigWhy), 'the habitat refuses without saying why or how heavy');
    } finally { three.world.dispose?.(); }
    KEN.clear();
    S.clearStation();

    return `${H.PADS.length} fixtures, ${small.length} of ${COMPANION_ORDER.length} companions under `
      + `${H.PAD_MASS} kg covering all 3; the habitat chose a perch, the fold stored it, the room `
      + `built ${padDraws} meshes and put a ${birdDraws}-mesh hawk on them at ${span.toFixed(2)} m `
      + `across (1.83 m with its wings out), feet on the bar; it came back a '${back}', the habitat `
      + `swapped it for a basket with the room standing and took it out again; a blurrg gets the `
      + `basket and no animal — "${bigWhy}"`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  /**
   * ══ THE GLASS, AND WHAT IT COSTS ════════════════════════════════════════
   *
   * §1.3's *"a real mirror in the cabin"*. It was dark glass and the game
   * printed *"your own body in the glass"* over it.
   *
   * DRIVEN THROUGH THE HOOK THE ENGINE CALLS, against a recording renderer —
   * `deckmirror.mjs`'s method, because a reflection's questions ("how many
   * draws, from which camera, into which target, how many times a frame") are
   * all answerable without a GPU and none of them is answerable from source
   * text.
   */
  check('home: the mirror reflects this room and the body in it, and nothing else', async () => {
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();
    /* The tier gate is real: `low` is no reflection at all, which is what the
     * rest of this suite boots at and why it sees none. */
    assert(H.glassScale('low') === 0, 'the lowest tier still pays for a reflection');
    assert(H.glassScale('high') > 0, 'the reflection is off at every tier');

    const { bootWorld } = await import('./_coop.mjs');
    const { prepareStation } = await import('../../src/game/Station.js');
    diskFetch();
    await prepareStation();
    const { world } = await bootWorld({
      level: 'station',
      settings: { mode: 'station', level: 'station', allies: 0, quality: 'high' },
      onWorld: (w) => { w._stationFloor = 44; },
    });
    try {
      const h = world._home;
      const M = h.mirror;
      assert(M?.S, 'the cabin\'s glass has no reflection at the high tier');
      const G = M.S;
      const glass = M.glass;
      assert(typeof glass.onBeforeRender === 'function', 'the glass has no render hook');

      /* Everything in the scene, and everything the beauty pass would draw. */
      let all = 0, drawn = 0, drawnTris = 0;
      const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      world.scene.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        all++;
        if (!shown(o)) return;
        drawn++;
        const g = o.geometry;
        drawnTris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });

      /* A RENDERER THAT REMEMBERS. `deckmirror.mjs`'s, plus a count of what
       * was actually visible when `render` was called — which is the only way
       * to say what a reflection costs without a card. */
      const fake = (fw, fh) => {
        const R = {
          calls: [], target: null, autoClear: false, cleared: 0,
          xr: { enabled: false },
          shadowMap: { autoUpdate: true, needsUpdate: false },
          state: { buffers: { depth: { setMask() {} } }, viewport() {} },
          getDrawingBufferSize(v) { v.set(fw, fh); return v; },
          getRenderTarget() { return R.target; },
          setRenderTarget(t) { R.target = t; },
          clear() { R.cleared++; },
          render(scene, camera) {
            let draws = 0, tris = 0;
            scene.traverse((o) => {
              if (!o.isMesh || !o.geometry || !shown(o)) return;
              draws++;
              const g = o.geometry;
              tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
            });
            R.calls.push({ target: R.target, camera, draws, tris: Math.round(tris),
              shadowAuto: R.shadowMap.autoUpdate });
          },
        };
        return R;
      };

      const cam = world.engine.camera;
      const stand = (m) => {
        cam.position.copy(G.plane).addScaledVector(G.normal, m);
        cam.lookAt(G.plane);
        cam.updateMatrixWorld(true);
      };

      /* Standing at it, and the visibility of every object recorded first so
       * that "the mask put everything back" is a measurement. */
      const was = new Map();
      world.scene.traverse((o) => was.set(o, o.visible));
      stand(2.5);
      world.time = 1;
      const R1 = fake(1920, 1080);
      glass.onBeforeRender(R1, world.scene, cam);
      glass.onBeforeRender(R1, world.scene, cam);
      glass.onBeforeRender(R1, world.scene, cam);
      assert(R1.calls.length === 1, `three hooks in one frame rendered ${R1.calls.length} reflections`);
      assert(R1.calls[0].target === G.target, 'the reflection went somewhere other than its own target');
      assert(G.target.width === 960 && G.target.height === 540,
        `a 1920×1080 buffer sized the target ${G.target.width}×${G.target.height}`);
      assert(R1.calls[0].shadowAuto === false, 'the shadow cascades were re-rendered for the reflection');
      assert(R1.shadowMap.autoUpdate === true, 'shadow auto-update was not restored');
      assert(R1.target === null, 'the render target was not restored');
      assert(G.material.uniforms.uOn.value === 1, 'the glass rendered and then showed nothing');

      let moved = 0;
      world.scene.traverse((o) => { if (was.get(o) !== o.visible) moved++; });
      assert(moved === 0, `${moved} objects were left hidden after the reflection`);

      /* THE COST, AND IT IS THE ROOM AND THE PLAYER AND NOT THE STATION. */
      const ref = R1.calls[0];
      assert(ref.draws < drawn * 0.25,
        `the reflection drew ${ref.draws} of the scene's ${drawn} visible meshes — it is not masked`);
      let room = 0;
      h.group.traverse((o) => { if (o.isMesh && shown(o)) room++; });
      let body = 0;
      world.player?.rig?.root?.traverse((o) => { if (o.isMesh) body++; });
      assert(body > 0, 'the player has no body to put in the glass');
      assert(ref.draws >= body,
        `the reflection is ${ref.draws} draws and the player's own body is ${body} — it is not in the glass`);

      /* A SECOND FRAME IS A SECOND REFLECTION, and the clock is world.time. */
      world.time = 2;
      const R2 = fake(1920, 1080);
      glass.onBeforeRender(R2, world.scene, cam);
      assert(R2.calls.length === 1, 'the next frame did not reflect');

      /* AND IT COSTS NOTHING WHERE NOBODY IS LOOKING. */
      stand(40);
      world.time = 3;
      const R3 = fake(1920, 1080);
      glass.onBeforeRender(R3, world.scene, cam);
      assert(R3.calls.length === 0, 'the glass reflected the room from 40 m away');
      assert(G.material.uniforms.uOn.value === 0, 'a stale reflection is still on the glass');

      /* BEHIND THE GLASS THERE IS NOTHING TO REFLECT. */
      stand(-1);
      world.time = 4;
      const R4 = fake(1920, 1080);
      glass.onBeforeRender(R4, world.scene, cam);
      assert(R4.calls.length === 0, 'the glass reflected the room from behind itself');

      /* AND THE INK PREPASS RENDERS THROUGH A CLONE, WHICH IS NOT THE FRAME. */
      stand(2.5);
      world.time = 5;
      const R5 = fake(1920, 1080);
      glass.onBeforeRender(R5, world.scene, cam.clone());
      assert(R5.calls.length === 0, 'a second camera got a second reflection');

      /* THE SENTENCE ON SCREEN. It said "your own body in the glass" over a
       * mirror that reflected nothing; whatever it says now, it may not claim
       * the creator draws your body until the creator does. */
      const src = await readFile(new URL('../../src/game/Home.js', import.meta.url), 'utf8');
      const key = src.slice(src.indexOf('export function homeKey'), src.indexOf('export function homeWheel'));
      const said = [...key.matchAll(/notify\?\.\((.*?)\);/gs)].map((m) => m[1]).join(' ');
      assert(!/your own body in the glass/.test(said),
        'the room still prints "your own body in the glass" — the creator does not draw one');
      assert(/glass/.test(said), 'the mirror says nothing about the glass at all');

      return `the target is ${G.target.width}×${G.target.height} of a 1920×1080 buffer at the high `
        + `tier; standing 2.5 m off, the glass draws ${ref.draws} meshes / ${ref.tris} triangles — `
        + `the room's ${room} and the player's ${body} — against ${drawn} / ${Math.round(drawnTris)} `
        + `in the scene (${(100 * ref.draws / drawn).toFixed(1)}% of the draws, `
        + `${(100 * ref.tris / drawnTris).toFixed(1)}% of the triangles), once a frame, and 0 from `
        + `40 m, 0 from behind it and 0 through a cloned camera; every object put back`;
    } finally { world.dispose?.(); S.clearStation(); }
  });
}
