/**
 * ══════════════════════════════════════════════════════════════════════════
 *  LANE F — CO-OP APARTMENTS, MEASURED
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `src/game/Coop.js`'s header asks four questions and answers them; this file
 * is one check per answer plus the two laws they must not break.
 *
 *   1. WHOSE APARTMENT IS IT — four players, four distinct doors, four
 *      distinct addresses, and the fifth refused with a sentence.
 *   2. WHAT CROSSES THE WIRE — two machines agree about a room after a real
 *      placement, and the cost of saying so is measured against the cost of
 *      putting the grid in the avatar packet.
 *   3. WHO MAY MOVE THE FURNITURE — a guest may look and may not write, at
 *      the key AND on the wire.
 *   4. WHAT A GUEST SEES OF THE OWNER'S THINGS — the cupboard, which is the
 *      case where doing nothing quietly opens the wrong one.
 *   5. AND NO FOURTH DURABLE KEY — four apartments on one machine still write
 *      exactly one record, and it is the local player's.
 *
 * EVERYTHING IS DRIVEN. The session is `_coop.bootSession` — N real Worlds on
 * the real station, N real `Net` endpoints over the PeerJS stub — and every
 * placement goes through the shipped verbs in `Home.js` rather than being set
 * on a field. The ONE line this file adds that main.js will also have is the
 * `net.on('home', …)` route, which hands the packet straight to
 * `Coop.noteApartment`; that is the rule `_coop.mjs`'s own header sets out, and
 * the reason `applyHit` was moved out of a closure in main.js.
 *
 * A NOTE ON WHAT THE HARNESS CANNOT SIMULATE, said here rather than discovered
 * later: `localStorage` is ONE store per process, so the four simulated players
 * share a single station fold. That is why the larder check measures the door
 * (was your own cupboard opened while you stood in somebody else's kitchen?)
 * and what the wire carries (nothing), rather than trying to give four nodes
 * four different fridges. Each World's in-memory dressing IS its own, because
 * `dressHome` reads the fold once per room.
 */

import { readFile } from 'node:fs/promises';

/* Verbatim from `home.mjs`: no `fetch` in node, so the imported rooms are read
 * off disk and handed to the same decoder the browser uses. */
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
 * N players, all of them standing on deck 44 of the same station.
 *
 * `bootSession` is `_coop.mjs`'s real thing — a World and a `Net` per node over
 * one broker — with `onWorld` carrying the deck, which is a property of the
 * world rather than a preference and is why that door exists.
 */
async function coopStation(n = 2) {
  const { bootSession } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  const Coop = await import('../../src/game/Coop.js');
  diskFetch();
  await prepareStation();
  const s = await bootSession({
    n,
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = 44; },
  });
  /* THE ONE ROUTING LINE, and it is the line main.js gets. Straight to the
   * shipped reader; the refusals it returns are kept so a check can read the
   * sentence rather than only the outcome. */
  for (const nd of s.nodes) {
    nd.notes = [];
    nd.net.on('home', (from, msg) => nd.notes.push(Coop.noteApartment(nd.world, from, msg)));
  }
  /* Long enough for the host to seat the doors, everybody to publish, and the
   * relay to land the third player's room on the second player's machine. */
  s.pump(0.5);
  return s;
}

/** Stand a player at a point in the world, at eye height over the deck. */
function standAt(world, at, y) {
  world.player.position.set(at.x, y + 1.6, at.z);
  return world.player.position;
}

/** A room's pieces as one comparable string — kind, cell, notch, in order. */
const layout = (pieces) => (pieces || [])
  .map((p) => `${p.k}@${p.x},${p.z}/${p.r}`).join(' | ');

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════ */

  check('co-op home: four players get four doors, and the fifth is refused with a sentence', async () => {
    const C = await import('../../src/game/Coop.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    clearStation();
    const s = await coopStation(4);
    try {
      assert(s.host.net.roster.length === 4,
        `${s.host.net.roster.length} on the roster for a four-player session`);

      /* FOUR DOORS, AND NO TWO THE SAME. Two players behind one door is one
       * player's furniture standing inside another's. */
      const doors = s.nodes.map((nd) => C.myApartment(nd.world));
      assert(doors.every((d) => Number.isFinite(d)), `a player was given no door: ${doors.join(', ')}`);
      assert(new Set(doors).size === 4, `four players share ${new Set(doors).size} doors: ${doors.join(', ')}`);
      assert(doors[0] === C.HOST_ROOM, `the host was given #${doors[0]} rather than the cabin #${C.HOST_ROOM}`);

      /* AND EACH MACHINE'S OWN DRESSING IS BEHIND ITS OWN DOOR — which is
       * `reseatMine` doing its job, because the roster arrived after the level
       * was built and every home started behind #27. */
      for (let i = 0; i < s.nodes.length; i++) {
        const h = s.nodes[i].world._home;
        assert(h && h.mine, `${s.nodes[i].name} has no home of their own`);
        assert(h.place.id === doors[i],
          `${s.nodes[i].name}'s own dressing is behind #${h.place.id} and their door is #${doors[i]}`);
      }

      /* FOUR ADDRESSES, because V16's whole claim is that V15's unique address
       * is what makes visiting possible. */
      const addrs = doors.map((d) => C.addressOf(d));
      assert(new Set(addrs).size === 4, `four doors read as ${new Set(addrs).size} addresses: ${addrs.join(', ')}`);

      /* THE CAP IS THE NUMBER OF DOORS, COUNTED. Not a 4 typed beside a list
       * of three, which is the pair that eventually disagrees. */
      assert(C.SESSION_CAP === C.GUEST_ROOMS.length + 1,
        `the cap is ${C.SESSION_CAP} and there are ${C.GUEST_ROOMS.length} guest rooms`);

      /* AND THE FIFTH IS TOLD WHY. A silent drop is indistinguishable from a
       * broken broker and the player will try the code again. */
      const { Net } = await import('../../src/net/Net.js');
      const fifth = new Net();
      let why = null;
      fifth.on('full', (w) => { why = w; });
      const joining = fifth.join(s.code, 'DELTA');
      for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 0)); s.fake.flush(); }
      await joining.catch(() => {});
      for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); s.fake.flush(); }

      assert(typeof why === 'string' && why.length > 20,
        `the fifth player was refused with ${JSON.stringify(why)} — a refusal has to be a sentence`);
      assert(/full/.test(why) && /4/.test(why),
        `the refusal does not say the session is full or how many the cap is: '${why}'`);
      assert(s.host.net.roster.length === 4,
        `the roster grew to ${s.host.net.roster.length} after a refused join`);
      assert(s.host.net.conns.size === 3,
        `the host holds ${s.host.net.conns.size} connections after refusing the fifth`);
      assert(fifth.connected === false && fifth.enabled === false,
        'the refused player is still attached — the next Ignite would silently re-join');

      return `4 players → doors ${doors.join('/')} = ${addrs.join(', ')}; cap ${C.SESSION_CAP} `
        + `= ${C.GUEST_ROOMS.length} guest rooms + the host; the fifth got "${why}" and the roster stayed at `
        + `${s.host.net.roster.length}`;
    } finally {
      for (const nd of s.nodes) nd.world.dispose?.();
      s.close();
    }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('co-op home: three machines agree about a room after a placement, and the record crosses on change', async () => {
    const C = await import('../../src/game/Coop.js');
    const H = await import('../../src/game/Home.js');
    const { clearStation } = await import('../../src/game/StationSave.js');
    clearStation();
    const s = await coopStation(3);
    try {
      const host = s.host;
      const hostId = host.net.peer.id;

      /* Everybody already holds everybody else's room — this is the join, not
       * the placement. */
      for (const nd of s.clients) {
        assert(C.apartment(nd.world, hostId), `${nd.name} holds no copy of the host's apartment`);
      }
      /* …including the third player's, which reached the second one THROUGH
       * the host. A client cannot reach another client directly. */
      const c2 = s.clients[1];
      assert(C.apartment(s.clients[0].world, c2.net.peer.id),
        'the second player never received the third player\'s apartment — the relay is not carrying it');

      /* A REAL PLACEMENT, through the shipped verbs. */
      const before = host.world._home.state.pieces.length;
      assert(H.addPiece(host.world, 'plant'), 'the catalogue would not give up a planter');
      H.movePiece(host.world, -4.0, -3.5);
      H.rotatePiece(host.world, 2);
      assert(H.dropPiece(host.world), 'the planter would not go down');
      const want = layout(host.world._home.state.pieces);
      assert(host.world._home.state.pieces.length === before + 1, 'the placement added no row');

      const sends0 = C.coopState(host.world).sends;
      s.pump(1.0);

      /* AGREEMENT, piece for piece, on both other machines — and the room is
       * DRESSED there, with a body per row, behind the host's own door. */
      for (const nd of s.clients) {
        const row = C.apartment(nd.world, hostId);
        assert(layout(row.rec.pieces) === want,
          `${nd.name} draws\n  ${layout(row.rec.pieces)}\nand the host has\n  ${want}`);
        assert(row.place === C.HOST_ROOM, `${nd.name} put the host's cabin behind #${row.place}`);
        assert(row.h && row.h.spot.id === C.HOST_ROOM, `${nd.name} dressed no room for the host`);
        assert(row.h.props.filter(Boolean).length === row.rec.pieces.length,
          `${nd.name} drew ${row.h.props.filter(Boolean).length} bodies for ${row.rec.pieces.length} rows`);
        assert(row.h.mine === false && row.h.owner?.id === hostId,
          `${nd.name} thinks the host's cabin is their own`);
      }

      /* ══ AND WHAT IT COST ══════════════════════════════════════════════
       *
       * One packet for the placement, and nothing at all for the second of
       * pumping after it. The alternative this measurement exists to refuse is
       * the grid in `packAvatar`, which is 24 Hz per peer, for ever.
       */
      const st = C.coopState(host.world);
      const sent = st.sends - sends0;
      /* AND STANDING STILL SENDS NOTHING, which is the other half of "on
       * change" and the half a timer would quietly break. Measured rather than
       * asserted from the design: two more seconds of every machine stepping
       * and nobody touching anything. */
      const quiet0 = st.sends;
      const frames = Math.round(2 * 60);
      s.pump(2.0);
      assert(st.sends === quiet0,
        `${st.sends - quiet0} packets sent over ${frames} frames of nobody touching a chair`);
      assert(sent >= 1 && sent <= 2,
        `${sent} packets for one placement plus a second of standing still`);

      /* The size of the thing, at both ends of the range, and against the
       * encoding it is not. */
      const full = H.cleanHome({
        pieces: Array.from({ length: H.MAX_PIECES }, (_, i) => (
          { k: 'crate', x: ((i % 12) - 6), z: (Math.floor(i / 12) - 2), r: i % H.NOTCHES })),
      });
      const packedFull = JSON.stringify(C.packHome(full, 1)).length;
      const naiveFull = JSON.stringify({ t: 'home', seq: 1, a: full.place,
        s: [full.surfaces.floor, full.surfaces.wall, full.surfaces.trim], f: full.pieces }).length;
      const packedNow = JSON.stringify(C.packHome(host.world._home.state, 1)).length;
      assert(packedFull < naiveFull,
        `the compact rows are ${packedFull} B and the object rows ${naiveFull} B — the codec earns nothing`);
      assert(packedFull < 1200, `a full ${H.MAX_PIECES}-piece home packs to ${packedFull} B`);

      /* THE COMPARISON THAT DECIDED THE DESIGN. Three peers, 24 Hz, for ever
       * — against a whole session of three players joining, seating, publishing
       * and placing, which has to come in under ONE full-home packet. */
      const perSecond = packedFull * 24 * (s.nodes.length - 1);
      assert(st.bytes < packedFull,
        `the whole session sent ${st.bytes} B of home, which is more than one full-home packet `
        + `(${packedFull} B) — something is publishing on a timer`);

      /**
       * AND NO LARDER AND NO PERCH ON THE WIRE, and the two are off it for
       * different reasons now.
       *
       * `store` is off it because nothing at the far end could read it:
       * `larder()` reads the LOCAL fold and a guest's food is their own.
       *
       * `pad` HAS a reader since V15 §1.3 landed — `Home.dressPad` builds the
       * fixture and stands the small companion on it — but the reader is fed
       * from the record the apartment is dressed with, and a guest's record
       * crosses `packHome`, which is `Coop.js`'s codec and another lane's
       * file. So a friend's cabin gets their furniture and not their perch,
       * and the missing metre of wire is stated here rather than left as a
       * blank room: `Home.homeCompanion` says the ANIMAL can never cross at
       * all (there is one Kennel per machine and it is yours), so what is
       * absent from a visit is one fixture and not an animal.
       */
      const msg = C.packHome(host.world._home.state, 1);
      assert(!('store' in msg) && !('pad' in msg) && !JSON.stringify(msg).includes('store'),
        'the home packet carries the larder or the companion — nothing reads either');

      return `a plant placed on the host is ${want.split(' | ').length} pieces on all 3 machines, `
        + `piece for piece; ${sent} packet for the placement and ${st.sends} in the whole session `
        + `(${st.bytes} B). A ${H.MAX_PIECES}-piece home packs to ${packedFull} B against ${naiveFull} B `
        + `as object rows (${(naiveFull / packedFull).toFixed(2)}×); the same record in the 24 Hz avatar `
        + `packet would be ${(perSecond / 1024).toFixed(1)} KB/s to ${s.nodes.length - 1} peers, and `
        + `${frames} frames of standing still sent ${st.sends - quiet0}. The default cabin is `
        + `${packedNow} B`;
    } finally {
      for (const nd of s.nodes) nd.world.dispose?.();
      s.close();
    }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('co-op home: a guest may look and may not write — at the key and on the wire', async () => {
    const C = await import('../../src/game/Coop.js');
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();
    const s = await coopStation(2);
    try {
      const host = s.host, guest = s.clients[0];
      const hostId = host.net.peer.id, guestId = guest.net.peer.id;

      /* The host's cabin, as the guest's machine has dressed it. */
      const row = C.apartment(guest.world, hostId);
      assert(row?.h, 'the guest never dressed the host\'s apartment');
      const theirs = row.h;
      assert(theirs.mine === false, 'the guest thinks the host\'s cabin is their own');
      assert(guest.world._homes.filter((h) => h.mine).length === 1,
        `${guest.world._homes.filter((h) => h.mine).length} of the dressed apartments are "mine"`);

      /* STAND IN IT. `homeUnder` is the question a co-op key has to ask and
       * `inHome` is the one it already asked. */
      standAt(guest.world, theirs.spot, theirs.y);
      assert(H.homeUnder(guest.world) === theirs, 'the guest is not standing in the host\'s cabin');
      assert(H.inHome(guest.world) === false, 'the guest\'s own home claims a room forty metres away');

      const theirsBefore = theirs.state.pieces.length;
      const mineBefore = guest.world._home.state.pieces.length;
      let said = null;
      guest.world.notify = (a, b) => { said = `${a} — ${b}`; };
      let kiosk = null, larderRaised = 0;
      guest.world.onKiosk = (id) => { kiosk = id; };
      guest.world.onLarder = () => { larderRaised++; };

      /* THE PRESS IS SPENT ON A SENTENCE. Not passed through to `placeUnder`,
       * whose verb for a residence is "walk". */
      assert(H.homeKey(guest.world) === true, 'the key was not spent in a friend\'s cabin');
      assert(said && /HOST/i.test(said),
        `standing in the host's cabin, the key said ${JSON.stringify(said)} — it has to name whose it is`);
      const refusal = said;
      assert(theirs.state.pieces.length === theirsBefore,
        'the guest\'s press changed the owner\'s room');
      assert(guest.world._home.state.pieces.length === mineBefore,
        'the guest\'s press put a piece in their OWN room forty metres away');
      assert(kiosk === null && larderRaised === 0,
        `a friend's mirror or galley answered the guest (kiosk=${kiosk}, larder=${larderRaised})`);

      /* AND THE VERBS CANNOT NAME IT AT ALL. This is the structural half: they
       * all start `world._home`, so a piece bought while standing in a
       * friend's kitchen goes into YOUR cabin, which is the only room the
       * argument list can reach. */
      assert(H.addPiece(guest.world, 'crate'), 'the catalogue would not give up a crate');
      H.movePiece(guest.world, 0, 3.0);
      H.dropPiece(guest.world);
      assert(theirs.state.pieces.length === theirsBefore,
        'a guest added a crate to the owner\'s record');
      assert(guest.world._home.state.pieces.length === mineBefore + 1,
        'the crate did not land in the guest\'s own cabin either');

      /* ON THE WIRE, THE SAME RULE. A forged dressing for #27 published by the
       * guest is refused by name, on the host's own machine. */
      const forged = C.packHome({ place: C.HOST_ROOM,
        surfaces: { floor: 'mark', wall: 'mark', trim: 'status' },
        pieces: [{ k: 'bunk', x: 0, z: 0, r: 0 }] }, 999);
      const hostPieces = host.world._home.state.pieces.length;
      const r = C.noteApartment(host.world, guestId, forged);
      assert(r.ok === false, 'a peer published a dressing for the host\'s own cabin and it was taken');
      assert(/not their door/.test(r.why), `the refusal reads '${r.why}'`);
      assert(host.world._home.state.pieces.length === hostPieces,
        'the forged packet reached the host\'s own room');
      assert(C.apartment(host.world, guestId).place !== C.HOST_ROOM,
        'the host now believes the guest lives in #27');

      /* …and a stale packet is dropped too, or two placements delivered out of
       * order leave a machine drawing the older room for ever. */
      const held = C.apartment(host.world, guestId);
      const stale = C.packHome(held.rec, Math.max(0, held.seq - 1));
      stale.a = held.place;
      const r2 = C.noteApartment(host.world, guestId, stale);
      assert(r2.ok === false && /not newer/.test(r2.why), `a stale packet was taken: ${r2.why}`);

      /* AND NOTHING HAS REACHED THE DISK. §1.3.5 is "saved on leaving", and a
       * guest's visit is not a leaving of anything. */
      assert(S.homeState() === null,
        'the station fold was written during a visit — that is a durable write per press');

      return `the guest stands in ${theirs.address} and the key answers "${refusal}"; `
        + `${theirs.state.pieces.length} pieces in the owner's room before and after, a bought crate `
        + `landed in the guest's own (${mineBefore} → ${mineBefore + 1}); a forged #27 packet refused `
        + `("${r.why}") and a stale one refused ("${r2.why}"); 0 durable writes`;
    } finally {
      for (const nd of s.nodes) nd.world.dispose?.();
      s.close();
    }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('co-op home: a guest\'s cupboard is their own, and a friend\'s is not opened by standing at it', async () => {
    const C = await import('../../src/game/Coop.js');
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();
    /* Something in the larder before anybody boots, so every dressing in the
     * process reads a stocked fold. */
    H.setHomeStock('food', [{ id: 'f-stew', n: 3, t: 0 }]);
    const s = await coopStation(2);
    try {
      const host = s.host, guest = s.clients[0];
      const theirs = C.apartment(guest.world, host.net.peer.id)?.h;
      assert(theirs?.galley, 'the host\'s apartment was dressed without a galley');

      let larderRaised = 0;
      guest.world.onLarder = () => { larderRaised++; };
      guest.world.notify = () => {};

      /* ══ AT THE FRIEND'S GALLEY ═══════════════════════════════════════
       *
       * This is the case the whole answer is written for: `Home.larder` reads
       * the LOCAL fold, so with nothing stopping it the guest opens their own
       * cupboard while looking at somebody else's fridge — right rows, wrong
       * room, and eating from it takes a bowl out of a larder forty metres
       * away. Standing at it must not open anything.
       */
      standAt(guest.world, theirs.galley.at, theirs.y);
      assert(guest.world.player.position.distanceTo(theirs.galley.at) < 2.4,
        'the guest is not standing at the friend\'s galley at all — the test proves nothing');
      assert(H.homeKey(guest.world) === true, 'the key was not spent at a friend\'s galley');
      assert(larderRaised === 0,
        'standing at a friend\'s galley opened the guest\'s OWN larder — the exact confusion');

      const at = C.larderAt(guest.world);
      assert(at.ok === false, 'larderAt hands a guest rows while they stand in somebody else\'s kitchen');
      assert(at.whose === 'HOST', `the refusal names '${at.whose}' rather than the owner`);
      assert(at.rows.length === 0, `${at.rows.length} rows handed out of a cupboard that is not the reader's`);

      /* ══ AND AT THEIR OWN ═════════════════════════════════════════════ */
      const mine = guest.world._home;
      standAt(guest.world, mine.galley.at, mine.y);
      assert(H.homeKey(guest.world) === true, 'the key was not spent at the guest\'s own galley');
      assert(larderRaised === 1,
        `the guest's own galley raised the larder ${larderRaised} times`);
      const own = C.larderAt(guest.world);
      assert(own.ok === true && own.whose === null, 'the guest\'s own cupboard refused them');
      assert(own.rows.length === 1 && own.rows[0].id === 'f-stew' && own.rows[0].n === 3,
        `the guest's own larder came back as ${JSON.stringify(own.rows.map((r) => `${r.id}×${r.n}`))}`);

      /* ══ AND THE OWNER'S FOOD NEVER CROSSED AT ALL ════════════════════
       *
       * The strongest form of the answer: there is nothing on the guest's
       * machine that COULD be mistaken for the host's cupboard, because the
       * host's cupboard is not on the wire. The local fold has three bowls in
       * it and the guest's copy of the host's record has none.
       */
      const rec = C.apartment(guest.world, host.net.peer.id).rec;
      assert(rec.store.food.length === 0,
        `the guest holds ${rec.store.food.length} rows of the host's food — it is not sent and must not be`);
      assert(H.homeStock().food.length === 1, 'the local fold lost its stew');
      assert(theirs.state.store.food.length === 0,
        'the dressed copy of a friend\'s cabin carries their larder');

      return `at ${theirs.address} the key spent a sentence and raised the larder 0 times; at the guest's `
        + `own galley it raised it once and answered ${own.rows[0].n}× ${own.rows[0].name}; the local fold `
        + `holds ${H.homeStock().food.length} row and the wire copy of the owner's larder holds `
        + `${rec.store.food.length}`;
    } finally {
      for (const nd of s.nodes) nd.world.dispose?.();
      s.close();
    }
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('co-op home: two apartments on one machine still write one record, and it is yours', async () => {
    const C = await import('../../src/game/Coop.js');
    const H = await import('../../src/game/Home.js');
    const S = await import('../../src/game/StationSave.js');
    S.clearStation();
    const s = await coopStation(2);
    let saved = null, doors = null, mineCount = 0;
    try {
      const host = s.host, guest = s.clients[0];

      /* The host puts a BUNK in their own cabin and the guest puts a RUG in
       * theirs, so the two records are told apart by a word rather than by a
       * count. */
      H.addPiece(host.world, 'bunk'); H.movePiece(host.world, -5.0, 2.0); H.dropPiece(host.world);
      H.addPiece(guest.world, 'rug'); H.movePiece(guest.world, 0, 0); H.dropPiece(guest.world);
      s.pump(0.6);

      doors = [C.myApartment(host.world), C.myApartment(guest.world)];
      assert(guest.world._homes.length === 2,
        `${guest.world._homes.length} apartments dressed on the guest's machine, not 2`);
      mineCount = guest.world._homes.filter((h) => h.mine).length;
      assert(mineCount === 1, `${mineCount} of them are "mine"`);
      const theirs = C.apartment(guest.world, host.net.peer.id);
      assert(theirs.rec.pieces.some((p) => p.k === 'bunk'),
        'the guest never received the bunk the host put down');
      assert(!guest.world._home.state.pieces.some((p) => p.k === 'bunk'),
        'the host\'s bunk landed in the guest\'s own record');

      /* AND THE LEAVING WRITES ONE ROOM. Two homes standing, one fold. */
      assert(S.homeState() === null, 'the fold was written before anybody left');
      guest.world.dispose?.();
      saved = S.homeState();
    } finally {
      for (const nd of s.nodes) nd.world.dispose?.();
      s.close();
    }

    assert(saved && typeof saved === 'object', 'leaving with two apartments up wrote nothing');
    assert(saved.place === doors[1],
      `the fold says the record is behind #${saved.place} and the player's door was #${doors[1]}`);
    assert(saved.pieces.some((p) => p.k === 'rug'), 'the player\'s own rug did not survive the leaving');
    assert(!saved.pieces.some((p) => p.k === 'bunk'),
      'a friend\'s furniture was written to this machine\'s durable record');

    /* ══ AND NO FOURTH DURABLE KEY ═════════════════════════════════════════
     *
     * `session.mjs` counts the writers in this tree and asserts at most three.
     * A co-op session holds up to four homes in memory and writes exactly one,
     * through `StationSave` — so `Coop.js` naming the browser store at all is
     * the defect, whatever it named it for.
     */
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of ['src/game/Coop.js', 'src/game/Home.js']) {
      const code = strip(await readFile(new URL(`../../${f}`, import.meta.url), 'utf8'));
      assert(!/localStorage|sessionStorage|indexedDB/.test(code),
        `${f} reaches durable storage itself — a home is a field of the station fold`);
    }
    const keys = new Set();
    for (const f of ['src/game/Progress.js', 'src/ui/Menu.js', 'src/main.js',
      'src/engine/Bindings.js', 'src/game/World.js', 'src/game/Coop.js', 'src/net/Net.js']) {
      const text = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
      for (const m of text.matchAll(/localStorage\.setItem\(\s*([A-Za-z_$][\w$]*|['"][^'"]+['"])/g)) {
        keys.add(m[1].replace(/['"]/g, ''));
      }
    }
    assert(keys.size <= 3,
      `${keys.size} things write to durable storage (${[...keys].join(', ')}) — Lane F added one`);

    return `2 apartments dressed on one machine, ${mineCount} of them "mine"; leaving wrote 1 record, `
      + `behind #${saved.place}, with the player's own rug and none of the host's bunk; `
      + `${keys.size} durable writers in the tree`;
  });
}
