/**
 * ══════════════════════════════════════════════════════════════════════════
 *  LANE F — CO-OP APARTMENTS. FOUR HOMES, ONE STATION, ONE OWNER EACH
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `V16.md` Lane F, in the player's own words:
 *
 * > *"when you play coop with your friends and they are on your station they
 * > should be able to have an apartment the host's game … you should be able
 * > to visit your friend's apartment/see their companion etc.; it should work
 * > with up to 4 players … each friend added in gets their apartment spawned
 * > in somewhere in the residence area … maybe convert some random npcs's
 * > house to a player's house when they get added in."*
 *
 * `Home.js`'s header argues at length that a home is A PLACE YOU MAKE rather
 * than a room you enter — a grid, real bodies you can knock over, an address
 * on the door, a record written on leaving. Nothing here may undo any of that,
 * and the way it is kept is that this file adds no second home system: it
 * hands `Home.dressHome` a door and a record, four times, and every rule about
 * what a home IS stays in the file that already argues for it.
 *
 * The four questions a second player in your living room asks, answered in
 * order, because each one is a decision and not a detail.
 *
 * ── 1. WHOSE APARTMENT IS IT ──────────────────────────────────────────────
 *
 * ONE ROOM, ONE OWNER, AND THE RECORD SAYS WHO. A room where four people's
 * furniture is authoritative is a room that desyncs on the first placement:
 * two machines each hold a list of pieces, both edit it, and there is no third
 * thing to ask. So every apartment on the station has exactly one owner —
 * the player whose saved `saber.home` dresses it — and that owner's copy is
 * the only copy that is true. Everybody else holds a DRAWING of it.
 *
 * WHICH DOOR IS WHOSE IS THE HOST'S TO SAY, and it rides the roster beside
 * `team`, `at` and `cmp` for the reason those three do: it is identity for the
 * length of a session, it changes about once, and two machines that disagreed
 * about whose door is whose would draw two different stations. `assignHomes`
 * below is PURE and deterministic on the roster, exactly as `assignSides` is,
 * so a client can verify the host's answer rather than having to trust it.
 *
 * THE HOST GETS `#27` and it is not a courtesy. `#27 Your cabin` is the only
 * room in the gazetteer whose builder declares a placement grid — its
 * footprint AND the four rectangles a piece may not be set down in — and it is
 * the door every existing save's `place` already names. Handing it to the
 * machine that owns the station is the assignment where nothing has to move.
 * Guests get residences (`GUEST_ROOMS`), which is the player's own proposal:
 * *"convert some random npcs's house to a player's house."*
 *
 * ── 2. WHAT CROSSES THE WIRE ──────────────────────────────────────────────
 *
 * THE RECORD, WHEN IT CHANGES. Not the grid, and not per frame.
 *
 * A dressing is `place` + three surface keys + up to `MAX_PIECES` rows of
 * furniture. Packed as compact rows (`["crate", 3, -8, 2]` — the id, the two
 * grid coordinates as WHOLE CELLS because `Home.snap` guarantees they are, and
 * the rotation notch) a full forty-piece home is about 0.7 KB and the four-
 * piece cabin a player starts with is about 0.1 KB. The same rows written as
 * objects are 1.9× that, measured in `coop-home.mjs`, which is the whole
 * reason the codec exists.
 *
 * Sent at the AVATAR rate it would cost 0.7 KB × 24 Hz × 3 peers ≈ 50 KB/s per
 * machine to repeat a fact that changes when somebody moves a chair. Sent on
 * change it costs 0.7 KB per chair. That is the same argument `LOOK_KEYS`,
 * `match` and `army` each make in `Net.js`, and it is why `home` is its own
 * message rather than four more fields on `packAvatar`.
 *
 * WHAT IS NOT ON IT: `store` (the larder) and `pad` (which companion lives
 * there). Neither has a reader on another machine — see question 4 — and a
 * field on the wire with no reader is the defect `co-op: no field is put on the
 * wire and read by nobody` exists to catch. It is also the honest answer about
 * a friend's fridge: nobody else's machine is told what is in it.
 *
 * A `seq` RIDES EVERY PACKET and a lower one is dropped. Two placements a
 * second apart, delivered out of order, would otherwise leave the second
 * machine drawing the older room for ever — a desync with no event to blame it
 * on. It is one integer and it makes the stream idempotent.
 *
 * ── 3. WHO MAY MOVE THE FURNITURE ─────────────────────────────────────────
 *
 * THE OWNER, AND ONLY THE OWNER, AND IT IS STRUCTURAL RATHER THAN A TEST.
 *
 * A guest who can rearrange your home is a griefing surface that OUTLIVES the
 * session: the record is written to the owner's disk on leaving, so a stranger
 * moving your bunk is a stranger editing a file on your machine that you will
 * find next week. A guest who can touch nothing is a spectator, and the point
 * of the lane is visiting.
 *
 * So the line is drawn at the RECORD, not at the room. A guest may walk in,
 * read the address on the door, see every piece exactly where its owner put
 * it, and shove the bodies about like any other prop in the game — `Home.js`
 * §1.3.1's "a home is still a sandbox" holds for visitors too. What a guest
 * cannot do is place, remove, rotate or recolour, because those five verbs in
 * `Home.js` all begin `const h = world._home`, and `world._home` is by
 * construction the one dressed apartment that is yours. There is no argument
 * that could name somebody else's room, so there is no permission check to
 * forget. `Home.leaveHome` tests `h.mine` anyway, because that is the single
 * line in the tree that turns a room into a durable record.
 *
 * AND THE SAME RULE ON THE WIRE: `noteApartment` refuses a packet whose
 * `place` is not the sender's own assigned door. Without it, one peer could
 * publish a dressing for a room that is not theirs and repaint a friend's home
 * on every machine but its owner's — the `_sender` forgery, one storey up.
 *
 * ── 4. WHAT A GUEST SEES OF THE OWNER'S THINGS ────────────────────────────
 *
 * THE ROOM, YES. THE CUPBOARD, NO — AND THE CUPBOARD IS THE SHARP CASE.
 *
 * `Home.larder` reads `homeStock()`, which reads the LOCAL station fold. There
 * is exactly one of those per machine and it is the local player's, so a guest
 * standing at a friend's galley and pressing the key would have opened THEIR
 * OWN cupboard while looking at somebody else's fridge: the rows would be
 * right, the room would be wrong, and eating from it would take a bowl out of
 * a larder forty metres away. That is not a desync anybody would report; it is
 * a screen that quietly lies.
 *
 * So the door is shut where the press is spent (`Home.homeKey`), not left to
 * whichever store answered first: in an apartment that is not yours the key
 * says whose it is and stops. `larderAt` below is the same fact as a function,
 * for anything that wants to ask rather than press. The owner's food never
 * crosses the wire at all, so there is nothing for a guest's screen to draw
 * even if one were written.
 *
 * ── 5. THE CAP IS FOUR, AND IT IS ENFORCED AT THE DOOR ────────────────────
 *
 * `SESSION_CAP` is `GUEST_ROOMS.length + 1` — the number of front doors that
 * exist — so the cap cannot drift away from the thing it is a cap on.
 * `Net._acceptConnection` applies it before the roster is broadcast and the
 * fifth player is answered with a sentence: a silent drop is indistinguishable
 * from a broken broker, and the person holding the code will simply try again.
 */

import { dressHome, undressApartment, cleanHome, homeUnder, homeAddress, larder,
  pieceKind, CELL, NOTCHES, MAX_PIECES } from './Home.js';
import { PLACES } from './StationPlan.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DOORS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The host's room. `#27 Your cabin` — see §1 above for why it is not shared
 * out with the rest and why the host is the machine that gets it.
 */
export const HOST_ROOM = 27;

/**
 * ══ THE ROOMS A GUEST IS GIVEN, IN THE ORDER THEY ARE GIVEN ═══════════════
 *
 * `V16.md` §1's table names two of them outright — *"co-op apartments | `#31`
 * Human residential, `#38` hostel"* — and Lane F widens it to the residential
 * rows generally. They are taken in that order and the Centauri quarter is
 * third, so a two- and a three-player session are the ones the spec names and
 * the fourth is the first thing added rather than a reshuffle of the first
 * three: an assignment that changes when somebody joins is an assignment that
 * moves a player's front door mid-session.
 *
 * EVERY ONE IS A ROOM THAT ALREADY STANDS. Nothing here builds a residence —
 * that is the whole saving V16 identifies, and `homeSpot` in `Home.js` derives
 * the placement grid from the gazetteer row the room was already built from.
 */
export const GUEST_ROOMS = [31, 38, 33];

/**
 * How many may be in one session — and it is the number of front doors,
 * counted, rather than a 4 typed beside a list of three. `Net.js` imports it
 * and applies it at the door; see the block over its re-export there.
 */
export const SESSION_CAP = GUEST_ROOMS.length + 1;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ASSIGNMENT — pure, so a client can check the host's arithmetic         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHO LIVES BEHIND WHICH DOOR ═══════════════════════════════════════════
 *
 * Pure and deterministic on the roster, for `assignSides`' reason: the host
 * publishes the answer, and a client that can compute the same one from the
 * same roster can tell a mistake from a lie. No clock, no die, no world.
 *
 * The host takes `HOST_ROOM` wherever it sits in the list, and everybody else
 * takes `GUEST_ROOMS` in roster order — which is join order, because
 * `Net._refreshRoster` walks `conns` and a Map keeps insertion order. So a
 * player's door is fixed the moment they arrive and is not moved by anybody
 * joining after them.
 *
 * @returns `{ apts, refused }` — a Map of peer id → place id, and the entries
 *   there was no door for, each with the sentence that says so.
 */
export function assignHomes(roster) {
  const apts = new Map();
  const refused = [];
  const rows = Array.isArray(roster) ? roster : [];
  let next = 0;
  for (const r of rows) {
    if (!r || !r.id) continue;
    if (r.host) { apts.set(r.id, HOST_ROOM); continue; }
    if (next >= GUEST_ROOMS.length) {
      refused.push({ id: r.id, name: r.name || 'Jedi', why: fullSentence(r.name) });
      continue;
    }
    apts.set(r.id, GUEST_ROOMS[next++]);
  }
  return { apts, refused };
}

/** The one sentence a refused player is given. One wording, one place. */
export function fullSentence(name = null) {
  return `${name ? `${name} cannot join: ` : ''}this session is full — `
    + `${SESSION_CAP} players is the cap, and all ${SESSION_CAP} apartments are taken`;
}

/** Which door a player's home is behind, off the roster the host published. */
export function apartmentOf(roster, id) {
  const row = (roster || []).find((r) => r && r.id === id);
  if (Number.isFinite(row?.apt)) return row.apt;
  /* THE HOST HAS NOT SAID YET — which happens for exactly the window between a
   * peer connecting and the next roster refresh. The pure assignment is the
   * same answer the host is about to publish, so reading it here is not a
   * second opinion; it is the same one, early. */
  return assignHomes(roster || []).apts.get(id) ?? null;
}

/** The address on a place's door, without dressing a room. V16's whole point:
 *  *"V15's unique address becomes the thing that makes visiting possible."* */
export function addressOf(placeId) {
  const p = PLACES.find((q) => q.id === placeId);
  return p ? homeAddress(p) : '';
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE WIRE                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ A PIECE, AS FOUR THINGS IN AN ARRAY ═══════════════════════════════════
 *
 * `["crate", 3, -8, 2]` rather than `{"k":"crate","x":1.5,"z":-4,"r":2}`.
 *
 * The two coordinates are WHOLE CELLS and not metres, which is not a
 * compression trick: `Home.snap` guarantees every stored coordinate is a
 * multiple of `CELL`, so the cell index is the coordinate without loss, and
 * `1.5` costs three characters where `3` costs one. The rotation is already a
 * notch. Measured over a full home the row form is 1.9× the array form, and
 * the rows ARE the message — everything else on it is a dozen bytes.
 *
 * The kind stays a STRING rather than becoming an index into `CATALOGUE`,
 * which would be smaller again. An index is a wire format that depends on the
 * order of a table, and the one case where that matters is two machines on
 * slightly different builds — precisely the case where you want the packet to
 * say what it means.
 */
function packPieces(pieces) {
  const out = [];
  for (const p of pieces || []) {
    if (!p || !pieceKind(p.k)) continue;
    out.push([p.k, Math.round(p.x / CELL), Math.round(p.z / CELL), p.r | 0]);
    if (out.length >= MAX_PIECES) break;
  }
  return out;
}

function readPieces(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!Array.isArray(r) || r.length < 4) continue;
    out.push({ k: r[0], x: Number(r[1]) * CELL, z: Number(r[2]) * CELL,
      r: ((Number(r[3]) | 0) % NOTCHES + NOTCHES) % NOTCHES });
  }
  return out;
}

/**
 * A home, as it crosses. `place`, the three surfaces and the furniture — and
 * NOT `store` or `pad`, which are the owner's and have no reader anywhere else
 * (see §2 and §4 above).
 */
export function packHome(state, seq = 0) {
  if (!state) return null;
  return {
    t: 'home',
    seq: seq | 0,
    /* Which door it is behind. It is on the packet as well as on the roster
     * because it is what `noteApartment` tests the sender's claim against —
     * a dressing that does not say which room it is for cannot be refused for
     * naming the wrong one. */
    a: state.place | 0,
    s: [state.surfaces?.floor, state.surfaces?.wall, state.surfaces?.trim],
    f: packPieces(state.pieces),
  };
}

/**
 * …and back, through `Home.cleanHome` — the same clamp a hand-edited save off
 * disk meets. A packet is that threat with a shorter wire: a peer that sends
 * 4000 pieces at coordinates a kilometre out is spawning bodies into deck 44
 * on somebody else's machine, and restating those clamps here would be the
 * manufactured second copy `HANDOFF` §2.4 names. One validator.
 */
export function readHome(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const rec = cleanHome({
    place: msg.a,
    surfaces: { floor: msg.s?.[0], wall: msg.s?.[1], trim: msg.s?.[2] },
    pieces: readPieces(msg.f),
  });
  return { seq: Math.max(0, msg.seq | 0), place: rec.place, rec };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LEDGER                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * EVERY APARTMENT THIS MACHINE KNOWS ABOUT, AND IT IS NOT DURABLE.
 *
 * `homes` is peer id → `{ name, place, rec, seq, h }`, held for the life of
 * the world and written to nothing. That is the answer to "does a co-op
 * session add a durable key": it cannot, because a friend's furniture is not a
 * fact about this machine and `StationSave` is the only writer in this tree —
 * `session.mjs` counts them and asserts at most three. A guest's record
 * arriving over the wire never touches `setHomeState`, and the only path from
 * a room to the disk is `Home.leaveHome`, which refuses anything but yours.
 */
export function coopState(world) {
  if (!world._coop) {
    world._coop = {
      homes: new Map(),
      /** Our own publishing counter — see §2 on why a `seq` rides the wire. */
      seq: 0,
      /** The last dressing we sent, so an unchanged home sends nothing. */
      sent: null,
      /** `h.edits` at the last publish. One integer compare per frame. */
      edits: -1,
      /** Which roster we last seated, so the host assigns on change only. */
      seated: null,
      /** Measured: packets out, bytes out, packets refused. Read by checks. */
      sends: 0, bytes: 0, refused: 0,
    };
  }
  return world._coop;
}

/**
 * ══ THE HOST HANDS OUT THE DOORS ══════════════════════════════════════════
 *
 * On a roster change only — the comparison is the joined id list, which is a
 * string of five-character ids and is the cheapest thing that actually detects
 * a join or a departure. `setHomes` refuses on a client, so this is a no-op
 * there rather than a rule with two authors.
 */
export function seatApartments(world) {
  const net = world?.net;
  if (!net?.connected || world.netMode !== 'host' || !net.setHomes) return null;
  const st = coopState(world);
  const key = (net.roster || []).map((r) => r.id).join(',');
  if (key === st.seated) return null;
  st.seated = key;
  const out = assignHomes(net.roster || []);
  net.setHomes(out.apts);
  return out;
}

/**
 * ══ PUBLISH MINE, WHEN IT HAS CHANGED ═════════════════════════════════════
 *
 * `h.edits` is bumped by every verb in `Home.js` that changes the record, so
 * the common frame — a player standing in their own cabin doing nothing — is
 * one integer compare. The packet is built and stringified only when that
 * integer has moved, which is a few times a minute at the very worst.
 *
 * WHAT DOES NOT TRIGGER ONE, AND IT IS A REAL LIMIT: a piece SHOVED by a body
 * rather than placed. `Home.leaveHome` snaps a knocked chair back onto the grid
 * on the way out, so the shove is in the next session's record, but during the
 * visit a chair somebody kicked is where each machine's own physics put it —
 * the same divergence every prop in a co-op level already has, and the thing
 * that would fix it is a prop stream, not a home packet at 24 Hz.
 */
export function publishApartment(world, force = false) {
  const h = world?._home;
  const net = world?.net;
  if (!h || !h.mine || !net?.connected) return null;
  const st = coopState(world);
  if (!force && h.edits === st.edits) return null;
  st.edits = h.edits;
  const msg = packHome(h.state, st.seq + 1);
  const body = JSON.stringify([msg.a, msg.s, msg.f]);
  if (!force && body === st.sent) return null;
  st.sent = body;
  msg.seq = ++st.seq;
  st.sends++;
  st.bytes += JSON.stringify(msg).length;
  net.broadcast(msg);
  return msg;
}

/**
 * ══ SOMEBODY ELSE'S APARTMENT HAS ARRIVED ═════════════════════════════════
 *
 * Three refusals, and each of them is a different lie a packet can tell.
 *
 *   NOT ON THE ROSTER — a dressing from a peer nobody is connected to. There
 *     is no room to put it in and no name to write on the door.
 *   NOT YOUR DOOR — the ownership rule of §3, on the wire. A peer that could
 *     publish a dressing for `#27` could repaint the host's own cabin on every
 *     machine except the one that owns it, and the owner would never see it.
 *   OLD NEWS — a `seq` no higher than the one already held. Two placements
 *     delivered out of order would otherwise leave this machine drawing the
 *     first one for the rest of the session.
 *
 * @returns `{ ok, why }` — a refusal speaks, because `st.refused` climbing with
 *   no reason attached is the shape of a bug nobody can find.
 */
export function noteApartment(world, from, msg) {
  const st = coopState(world);
  const net = world?.net;
  const row = (net?.roster || []).find((r) => r && r.id === from);
  if (!row) { st.refused++; return { ok: false, why: `${from} is not on the roster` }; }
  const seat = apartmentOf(net?.roster || [], from);
  const rec = readHome(msg);
  if (!rec) { st.refused++; return { ok: false, why: 'the packet is not a dressing' }; }
  if (seat == null || rec.place !== seat) {
    st.refused++;
    return { ok: false, why: `${row.name || from} published #${rec.place}, which is not their door (#${seat})` };
  }
  const held = st.homes.get(from);
  if (held && rec.seq <= held.seq) {
    st.refused++;
    return { ok: false, why: `seq ${rec.seq} is not newer than ${held.seq}` };
  }
  st.homes.set(from, { name: row.name || 'Jedi', place: seat, rec: rec.rec, seq: rec.seq,
    h: held?.h || null, drawn: held?.drawn ?? -1 });
  return { ok: true, why: null, place: seat, seq: rec.seq };
}

/** What this machine believes about one player's home. Null if it has none. */
export function apartment(world, id) { return coopState(world).homes.get(id) || null; }

/** Every apartment on the station, yours included, for a screen or a check. */
export function apartments(world) {
  const st = coopState(world);
  const out = [];
  const mine = world?._home;
  if (mine?.mine) {
    out.push({ id: world.net?.peer?.id || 'local', name: world.net?.name || 'you', mine: true,
      place: mine.place.id, address: mine.address, pieces: mine.state.pieces.length });
  }
  for (const [id, row] of st.homes) {
    out.push({ id, name: row.name, mine: false, place: row.place,
      address: addressOf(row.place), pieces: row.rec.pieces.length });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ROOMS, PUT UP                                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Which door MY dressing goes behind. `#27` when there is no session, which is
 * every solo game, so `dressStation` is byte for byte what it was off the wire.
 */
export function myApartment(world) {
  const net = world?.net;
  const me = net?.peer?.id;
  if (!net?.connected || !me) return null;
  return apartmentOf(net.roster || [], me);
}

/**
 * ══ EVERY GUEST'S APARTMENT, DRESSED FROM WHAT THEY SENT ══════════════════
 *
 * Idempotent, and called every station frame through `stepCoop`: a home whose
 * `seq` has not moved since it was drawn is skipped on one integer compare,
 * and one whose has is taken down and put back up. Taking it down and putting
 * it up rather than diffing the two lists is deliberate — a home changes a few
 * times a minute and a diff is a second implementation of `dressHome` that
 * would have to be kept agreeing with it.
 *
 * `undressApartment` frees the fixtures, the surfaces, the sign's canvas and
 * every body, which is what makes re-dressing safe to do repeatedly.
 */
export function dressApartments(world) {
  const stn = world?._station;
  if (!stn || !stn.mats) return 0;
  const st = coopState(world);
  const me = world.net?.peer?.id;
  let n = 0;
  for (const [id, row] of st.homes) {
    if (id === me) continue;
    if (row.h && row.drawn === row.seq && row.h.spot.id === row.place) continue;
    if (row.h) { undressApartment(world, row.h); row.h = null; }
    row.h = dressHome(world, stn, stn.mats, {
      place: row.place, state: row.rec, owner: { id, name: row.name },
    });
    row.drawn = row.seq;
    if (row.h) n++;
  }
  return n;
}

/**
 * ══ AND OUR OWN DRESSING FOLLOWS THE DOOR WE WERE GIVEN ═══════════════════
 *
 * The assignment can arrive AFTER the station is built, and in a real session
 * it usually does not — you join, the welcome brings the roster, the level is
 * built — but "usually" is not a guarantee and the failure is the worst one
 * this lane has: two dressings behind one door, one player's furniture
 * standing inside another's, on the machine that thinks both are right.
 *
 * So the door is checked rather than assumed, and a dressing behind the wrong
 * one is MOVED. The record goes across in memory rather than through the fold:
 * a player who shifted a chair in the first three seconds has shifted it, and
 * re-reading the disk here would take it back — and, worse, writing the disk
 * here would be a durable write in the middle of a visit, which is the thing
 * `leaveHome`'s "saved on leaving" exists to refuse.
 */
function reseatMine(world) {
  const stn = world?._station;
  const h = world?._home;
  const want = myApartment(world);
  if (!stn || !stn.mats || !h || want == null || h.place.id === want) return false;
  const state = h.state;
  undressApartment(world, h);
  const next = dressHome(world, stn, stn.mats, { place: want, state });
  /* The room changed, so what everybody else is holding is now wrong about
   * WHERE as well as what. −1 is "nothing has been published", which forces the
   * next `publishApartment` to send whatever `h.edits` happens to be. */
  coopState(world).edits = -1;
  return !!next;
}

/**
 * One line of `stepStation`, and it costs one property read on a station with
 * nobody else on it: seat the doors if the roster moved, move our own dressing
 * if the door we were given is not the one it is behind, publish our own room
 * if it changed, put up anything new that has arrived.
 */
export function stepCoop(world) {
  if (!world?.net?.connected) return;
  seatApartments(world);
  reseatMine(world);
  publishApartment(world);
  dressApartments(world);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CUPBOARD                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHOSE LARDER THE PLAYER IS STANDING AT ════════════════════════════════
 *
 * §4 as a function rather than as a press. `Home.larder` reads the local fold
 * and can only ever answer with YOUR food; the question a co-op station makes
 * askable is whether the cupboard in front of you is the one that fold
 * describes. In somebody else's apartment it is not, and the honest answer is
 * a refusal with their name on it — not your own rows drawn under their
 * address, which is a screen that lies about which fridge is open.
 *
 * @returns `{ ok, whose, rows }`.
 */
export function larderAt(world, clock = 0) {
  const here = homeUnder(world);
  if (here && !here.mine) {
    return { ok: false, whose: here.owner?.name || 'a resident', rows: [] };
  }
  return { ok: true, whose: null, rows: larder(clock) };
}
