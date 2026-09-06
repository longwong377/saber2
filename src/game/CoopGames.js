/**
 * ══ TWO-PLAYER THINGS ON THE STATION — V19 addition 4 (hole 6) ═════════════
 *
 * *"Co-op guests get the station but nothing on it is a two-player thing."*
 * Three things that need a second human, all host-authoritative, all on the
 * existing wire (`Net.js`: the roster, `toPeer`/`toHost`, and the default
 * `_emit(msg.t, msg, sender)` case, which is what carries a message kind Net
 * has never heard of). Three small kinds, one a thing:
 *
 *   `sabacc2`   SABACC AGAINST YOUR GUEST. Both humans within 3 m of one
 *               table in #18 the Pit or #60 the Wheelhouse, and the key deals
 *               a shared hand: two seats, `Games.playSabacc` replayed off a
 *               seed and the verbs said so far — `Casino.sabaccTable`'s exact
 *               shape, with two act lists instead of one. Each machine's key
 *               press is its own seat's verb; the host resolves; the guest is
 *               sent its own cards and the table's state after every verb;
 *               the pot pays the winner into their own purse. With no guest
 *               at the table the key falls through to the room's own branch,
 *               so the single-player table is untouched.
 *
 *   `sidebet`   A RACE BET AGAINST EACH OTHER. In a tote room with the other
 *               human within 3 m, the key offers "bet against <name>" on the
 *               next race; each press cycles your runner; once both have
 *               picked the host strikes it, 20 a side, and the `sidebets`
 *               fold in `StationSave` holds it. When the race has run
 *               (`Tote.ticketRun`, the same arithmetic a window ticket
 *               settles on) the host reads the result the window reads
 *               (`Tote.resultOf`) and the better-placed runner's backer takes
 *               both stakes; both machines get a `notify`.
 *
 *   `carry`     A TWO-CARRIER CARGO JOB. `Quests` offers 'two-carrier' at
 *               #52 only while a guest is connected: a two-tonne crate — past
 *               the Force grip's cap at any slider (`Player.LIFT_AT_ONE` 220
 *               × 4^1.5 = 1760 kg at the slider's top) — to be carried to #7
 *               Arrivals by both players at once. A grip press the Force
 *               refuses as TOO HEAVY beside the crate is your hands going on
 *               it; the guest's hands go up the wire as an intent, the host
 *               owns the body and drives it to the midpoint between the two
 *               of you only while both hold. #52 is on deck 48 and #7 on 40,
 *               so the crate goes INTO the Arrivals lift: within reach of the
 *               shaft with both holding, it is aboard, and it stands in the
 *               deck-40 lobby when the host arrives there. Both are paid.
 *
 * NOTHING HERE DRAWS FROM `Math.random`. The hand is a seeded replay, the
 * race is the tote's own seeded sim, the crate is placed off the plan.
 *
 * THE PURSE HAS A DOOR. `Credits.js` is one store per machine; under node a
 * two-World session shares it, so every credit this file moves goes through
 * `doorOf(world)` — `world.purseDoor` when a harness hands one World its own
 * ledger, `Credits` otherwise. The game never sets it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { playSabacc, sabaccScore, sabaccOwed, SABACC } from './Games.js';
import { racesOn, raceById, resultOf, boardFor, ticketRun, venueAtPlace } from './Tote.js';
import { openJobs, settleRun, collect, CARRY_JOB } from './Quests.js';
import { pay, spend, purse } from './Credits.js';
import { stationDay, sideBets, setSideBets, standing, setStanding } from './StationSave.js';
import { makeCrate } from '../world/Props.js';
import { SHAFTS } from './StationPlan.js';

/** Arm's reach of a table, a counter, a crate. */
export const REACH = 3;
/** The side bet's stake, a side. */
export const SIDE_STAKE = 20;
/** The crate: two tonnes, and the Force's cap at the slider's top is 1760. */
export const CRATE = { mass: 2000, size: 1.15, lift: 1.1, pull: 5, speed: 4.5, shaft: 6 };
/** The rooms whose tables deal a shared hand. */
const TABLE_ROOMS = [18, 60];

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** A stable 32-bit hash — `Quests.js`'s idiom, for the same reason. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}

/* ── per-world state, and the one carry that outlives a deck ─────────────── */

const STATES = new WeakMap();
/** Which World a net's handlers speak to: the last one that stepped with it. */
const NETS = new WeakMap();
/**
 * THE CRATE'S JOURNEY, module-level on purpose: a lift ride rebuilds the
 * World and the crate has to be in the car when the doors open on 40.
 */
let CARRY = null;

function stOf(world) {
  let st = STATES.get(world);
  if (!st) {
    st = {
      sabacc: null, sabaccIndex: 0, tables: new Map(),
      side: null,
      crate: null, hands: false, lastRef: undefined, tick: 0, said: null, guestHands: false,
      last: null,
    };
    STATES.set(world, st);
  }
  return st;
}

const doorOf = (world) => world.purseDoor || { pay, spend, purse };
const say = (world, head, line) => world.notify?.(head, line);
const dayOf = (world) => world._station?.day ?? stationDay();
const hourOf = (world) => world._station?.hour ?? 0;

/** True while another human is in the session — host or guest side. */
export function coopGuest(world) {
  const net = world?.net;
  return !!(net && world.netMode && net.peers && net.peers.length > 0);
}
const isHost = (world) => world.netMode === 'host';
const myId = (world) => world.net?.peer?.id;
const nameOf = (world, id) => world.net?.roster?.find((r) => r.id === id)?.name || 'your guest';

/** The other human's body on this machine: the first remote within `r` of (x, z). */
function humanNear(world, x, z, r = REACH) {
  if (!world.remotes) return null;
  let best = null, bestD = r * r;
  for (const av of world.remotes.values()) {
    if (!av || !av.position) continue;
    const dx = av.position.x - x, dz = av.position.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = av; }
  }
  return best;
}
/** The other human's body, whichever it is — the host's on a guest, the first guest's on the host. */
function theOther(world) {
  if (!world.remotes) return null;
  if (isHost(world)) { for (const av of world.remotes.values()) return av; return null; }
  const hostId = world.net?.roster?.find((r) => r.host)?.id;
  return (hostId && world.remotes.get(hostId)) || null;
}

function placeOf(world, id) { return world._station?.places?.get(id)?.place || null; }
function inPlace(p, x, z) {
  if (!p) return false;
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2;
}
const near = (p, x, z, r = REACH) => p && Math.hypot(p.x - x, p.z - z) <= r;

function send(world, msg) {
  const net = world.net;
  if (!net) return;
  if (isHost(world)) { for (const r of net.peers) net.toPeer(r.id, msg); }
  else net.toHost(msg);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  1. SABACC AGAINST YOUR GUEST
 * ══════════════════════════════════════════════════════════════════════════ */

/** The tables of a room, in world space: every 'table' prop inside its footprint. */
export function tablesIn(world, placeId) {
  const st = stOf(world);
  if (st.tables.has(placeId)) return st.tables.get(placeId);
  const p = placeOf(world, placeId);
  const out = [];
  if (p) {
    for (const prop of world.props || []) {
      if (!prop || prop.kind !== 'table' || !prop.body) continue;
      const q = prop.body.position;
      if (inPlace(p, q.x, q.z)) out.push({ x: q.x, y: q.y, z: q.z });
    }
    /* A room with no table prop (the Wheelhouse is a wheel) deals at its centre. */
    if (!out.length) out.push({ x: p.x, y: 0, z: p.z });
  }
  st.tables.set(placeId, out);
  return out;
}

/**
 * The table both humans are at, or null. Within REACH of the same table, in
 * one of the two rooms — measured on this machine's own idea of where the
 * other one stands, which is the avatar stream.
 */
export function sharedTable(world) {
  const me = world.player?.position;
  if (!me || !coopGuest(world)) return null;
  for (const id of TABLE_ROOMS) {
    const p = placeOf(world, id);
    if (!p || !inPlace(p, me.x, me.z)) continue;
    for (const t of tablesIn(world, id)) {
      if (!near(t, me.x, me.z)) continue;
      const other = humanNear(world, t.x, t.z);
      if (other) return { place: id, table: t, other };
    }
  }
  return null;
}

/** One shared hand, replayed: two seats, two act lists, the first unanswered ask is the turn. */
export function dealShared(seed, acts, ante) {
  const asks = [];
  const counts = [0, 0];
  const seat = (k) => (view) => {
    const n = counts[k]++;
    asks.push({ seat: k, n, view });
    return acts[k][n] ?? (view.phase === 'bet' ? (view.toCall > 0 ? 'call' : 'check') : 'hold');
  };
  const r = playSabacc([seat(0), seat(1)], seed, { ante });
  const pending = asks.find((a) => a.n >= acts[a.seat].length) || null;
  return { r, asks, pending };
}

/** What one seat may see of the hand: its own cards, the turn, the middle. */
export function seatView(h, seat, meta = {}) {
  const { r, asks, pending } = h;
  const done = !pending;
  const mine = asks.filter((a) => a.seat === seat);
  const view = pending && pending.seat === seat ? pending.view : (mine.length ? mine[mine.length - 1].view : null);
  const hand = done || !view ? r.hands[seat] : view.hand;
  return {
    ...meta, seat, done,
    turn: pending ? pending.seat : null,
    phase: pending ? pending.view.phase : null,
    can: pending && pending.seat === seat ? pending.view.can.slice() : [],
    round: pending ? pending.view.round : SABACC.ROUNDS,
    hand: hand.slice(), score: sabaccScore(hand),
    others: pending ? pending.view.others : null,
    pot: pending ? pending.view.pot : r.pot,
    put: pending ? pending.view.put : r.put[seat],
    toCall: pending && pending.seat === seat ? pending.view.toCall : 0,
    result: done ? {
      winner: r.winner, pure: r.pure, pot: r.pot, put: r.put.slice(), hands: r.hands.map((x) => x.slice()),
      owed: [sabaccOwed(r, 0), sabaccOwed(r, 1)],
    } : null,
  };
}

/** The verb one key press means: stay in, and put money in when you may. */
export function keyVerb(view) {
  if (!view || view.turn !== view.seat) return null;
  if (view.phase === 'bet') return view.can.includes('bet') ? 'bet' : view.can.includes('call') ? 'call' : 'check';
  return 'hold';
}

function handOf(world) {
  const st = stOf(world);
  const s = st.sabacc;
  if (!s) return null;
  return dealShared(s.seed, s.acts, s.ante);
}

function shareHand(world, kind = 'state') {
  const st = stOf(world);
  const s = st.sabacc;
  const h = handOf(world);
  const meta = { place: s.place, index: s.index, ante: s.ante, against: s.guestName, seat: 0 };
  st.view = seatView(h, 0, meta);
  send(world, { t: 'sabacc2', k: kind, charge: s.charge || 0, ...seatView(h, 1, { ...meta, against: s.hostName }) });
  s.charge = 0;
  const v = st.view;
  if (!v.done) {
    say(world, `SABACC — ${s.guestName.toUpperCase()}`,
      `hand ${v.score.total}, pot ${v.pot} — ${v.turn === 0 ? `your ${v.phase}: ${v.can.join(' / ')}` : `${s.guestName} to ${v.phase}`}`);
  }
  return h;
}

/** Host: deal a shared hand at a table both are at. */
function hostDeal(world, at) {
  const st = stOf(world);
  const ante = SABACC.ANTE;
  const paid = doorOf(world).spend(ante, 'sabacc');
  if (!paid.ok) { say(world, 'SABACC', paid.why); return true; }
  const index = st.sabaccIndex++;
  const seed = hashOf(`sabacc2:${at.place}:${dayOf(world)}:${index}`);
  st.sabacc = {
    place: at.place, index, seed, ante, acts: [[], []],
    guestId: at.other.id, guestName: at.other.name || nameOf(world, at.other.id), hostName: world.net?.name || 'the host',
  };
  shareHand(world, 'deal');
  return true;
}

/** Host: a verb said by seat `seat`. Resolves the hand when it is over. */
function hostSay(world, seat, verb) {
  const st = stOf(world);
  const s = st.sabacc;
  if (!s) return false;
  const h = handOf(world);
  if (!h.pending || h.pending.seat !== seat) return false;
  const can = h.pending.view.can;
  if (!can.includes(verb)) verb = keyVerb(seatView(h, seat, { seat })) || can[0];
  const prevPut = h.pending.view.put;
  s.acts[seat].push(verb);
  /* THE BET IS PAID AS IT IS SAID, not at the showdown: what this seat has in
   * the middle at its next ask (or at the end) less what it had before. The
   * host's from its purse here; the guest's on the state message. */
  const next = dealShared(s.seed, s.acts, s.ante);
  const again = next.asks.find((a) => a.seat === seat && a.n >= s.acts[seat].length);
  const charge = (again ? again.view.put : next.r.put[seat]) - prevPut;
  if (charge > 0) {
    if (seat === 0) { const paid = doorOf(world).spend(charge, 'sabacc'); if (!paid.ok) say(world, 'SABACC', `${paid.why} — ${charge} owed to the middle`); }
    else s.charge = charge;
  }
  const after = shareHand(world);
  if (after.pending) return true;
  /* THE SHOWDOWN: the middle to the winner, less the house's cut; a push
   * hands each seat back what it put in; a fold forfeits. Each purse is its
   * owner's — the host's here, the guest's on its machine off `over`. */
  const owed = [sabaccOwed(after.r, 0), sabaccOwed(after.r, 1)];
  const w = after.r.winner;
  const line = w < 0 ? 'nobody takes it — the middle comes back'
    : w === 0 ? `you take the middle — ${owed[0]} credits` : `${s.guestName} takes the middle`;
  if (owed[0] > 0) doorOf(world).pay(owed[0], 'sabacc');
  say(world, `SABACC — ${s.guestName.toUpperCase()}`, line);
  st.last = { ...st.view, line };
  send(world, { t: 'sabacc2', k: 'over', pay: owed[1], winner: w, result: st.view.result, line: w < 0 ? line : w === 1 ? `you take the middle — ${owed[1]} credits` : `${s.hostName} takes the middle` });
  st.sabacc = null;
  return true;
}

/**
 * Say a verb into the shared hand — THE one verb door, for the key and for
 * any panel (`Casino.sabaccAct`'s shape for the single-player table). The
 * host's own seat resolves here; a guest's verb goes up as an `act`.
 */
export function sabaccSay(world, verb) {
  if (isHost(world)) return hostSay(world, 0, verb);
  const st = stOf(world);
  if (!st.sabacc || st.sabacc.turn !== 1) return false;
  send(world, { t: 'sabacc2', k: 'act', act: verb });
  return true;
}

/** The shared hand as this machine sees it, for a HUD: null when none is live. */
export function sharedHand(world) { return stOf(world).sabacc && (isHost(world) ? stOf(world).view : stOf(world).sabacc) || null; }
/** The last shared hand this machine saw finish: seat 0's view with `result` and the line, or the guest's `over`. */
export function lastHand(world) { return stOf(world).last; }
/** Host only: what seat `seat` may see of the live hand — the view the guest is sent. */
export function tableView(world, seat) { const h = handOf(world); return h ? seatView(h, seat, { seat }) : null; }

function sabaccKey(world) {
  const live = sharedHand(world);
  /* A LIVE HAND OWNS THE KEY on both machines: the press is this seat's verb
   * — hold in the draw, bet or call in the round — and a press off-turn is
   * spent rather than handed to the room under the table. */
  if (live) return sabaccSay(world, keyVerb(live) || 'hold') || true;
  const at = sharedTable(world);
  if (!at) return false;
  if (isHost(world)) return hostDeal(world, at);
  send(world, { t: 'sabacc2', k: 'key' });
  return true;
}

function onSabacc(world, msg, from) {
  const st = stOf(world);
  if (isHost(world)) {
    const s = st.sabacc;
    if (msg.k === 'key' && !s) {
      const at = sharedTable(world);
      if (at && at.other.id === from) hostDeal(world, at);
    } else if (msg.k === 'act' && s && s.guestId === from) hostSay(world, 1, String(msg.act || ''));
    else if (msg.k === 'out' && s && s.guestId === from) {
      /* The guest could not ante: the hand is void and the host's ante comes back. */
      doorOf(world).pay(s.ante, 'sabacc');
      say(world, 'SABACC', `${s.guestName} cannot cover the ante`);
      st.sabacc = null;
    }
    return;
  }
  /* The guest: the state as the host dealt it, and the money when it is over. */
  if (msg.k === 'deal') {
    const paid = doorOf(world).spend(msg.ante | 0, 'sabacc');
    if (!paid.ok) { send(world, { t: 'sabacc2', k: 'out' }); say(world, 'SABACC', paid.why); return; }
    st.sabacc = { ...msg };
    say(world, `SABACC — ${String(msg.against || 'the host').toUpperCase()}`,
      `dealt: hand ${msg.score?.total}, pot ${msg.pot} — ${msg.turn === 1 ? `your ${msg.phase}` : `${msg.against} first`}`);
  } else if (msg.k === 'state') {
    if ((msg.charge | 0) > 0) { const paid = doorOf(world).spend(msg.charge | 0, 'sabacc'); if (!paid.ok) say(world, 'SABACC', `${paid.why} — ${msg.charge | 0} owed to the middle`); }
    st.sabacc = { ...msg };
    say(world, `SABACC — ${String(msg.against || 'the host').toUpperCase()}`,
      `hand ${msg.score?.total}, pot ${msg.pot} — ${msg.turn === 1 ? `your ${msg.phase}: ${(msg.can || []).join(' / ')}` : `${msg.against} to ${msg.phase}`}`);
  } else if (msg.k === 'over') {
    if ((msg.pay | 0) > 0) doorOf(world).pay(msg.pay | 0, 'sabacc');
    st.last = { ...msg };
    st.sabacc = null;
    say(world, `SABACC — ${String(msg.against || st.last.against || 'the host').toUpperCase()}`, String(msg.line || ''));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  2. A RACE BET AGAINST EACH OTHER
 * ══════════════════════════════════════════════════════════════════════════ */

/** The next race on this room's card whose book is still open. */
export function nextRaceAt(world, placeId) {
  const v = venueAtPlace(placeId);
  if (!v) return null;
  const hour = hourOf(world);
  return racesOn(v.id, dayOf(world)).find((r) => r.hour > hour) || null;
}

/**
 * The window both humans are at: a tote room's DOOR — the window is at the
 * door, where the room's own key already answers — with you and the other
 * human both within REACH of it. Not the whole room: #19 is sixty seats and
 * a room-wide claim would take the key off every one of them.
 */
export function sharedCounter(world) {
  const me = world.player?.position;
  if (!me || !coopGuest(world)) return null;
  for (const rec of world._station?.places?.values() || []) {
    const p = rec.place;
    if (!venueAtPlace(p.id) || !p.door) continue;
    const w = { x: p.door[0], z: p.door[1] };
    if (!near(w, me.x, me.z)) continue;
    const other = humanNear(world, w.x, w.z);
    if (other) return { place: p.id, window: w, other };
  }
  return null;
}

function sidePublic(s) {
  return { venue: s.venue, race: s.race, day: s.day, hour: s.hour, runs: s.runs, stake: s.stake,
    runners: s.runners.slice(), hostPick: s.hostPick, guestPick: s.guestPick, hostName: s.hostName, guestName: s.guestName };
}

const pickLine = (s, mine, theirs, them) =>
  `you back ${s.runners[mine]?.name ?? '—'} against ${them}${theirs == null ? ' (they have not picked)' : ` on ${s.runners[theirs].name}`} — ${s.stake} a side`;

/** Host: a press by `who` ('host' | 'guest') at the counter. */
function hostSidePress(world, who, at) {
  const st = stOf(world);
  let s = st.side;
  if (!s) {
    const race = nextRaceAt(world, at.place);
    if (!race) { say(world, 'SIDE BET', 'no race left on the card today'); return true; }
    const rows = boardFor(race).runners;
    s = st.side = {
      venue: race.venue, race: race.id, day: race.day, hour: race.hour, runs: race.runs, stake: SIDE_STAKE,
      runners: rows.map((r) => ({ id: r.id, name: String(r.name || r.id) })),
      hostPick: null, guestPick: null,
      hostId: myId(world), guestId: at.other.id,
      hostName: world.net?.name || 'the host', guestName: at.other.name || nameOf(world, at.other.id),
    };
  }
  if (who === 'host') s.hostPick = ((s.hostPick ?? -1) + 1) % s.runners.length;
  else s.guestPick = ((s.guestPick ?? -1) + 1) % s.runners.length;
  if (s.hostPick == null || s.guestPick == null) {
    say(world, `SIDE BET — ${s.guestName.toUpperCase()}`, s.hostPick == null ? `${s.guestName} backs ${s.runners[s.guestPick].name} — pick yours` : pickLine(s, s.hostPick, s.guestPick, s.guestName));
    send(world, { t: 'sidebet', k: 'offer', ...sidePublic(s) });
    return true;
  }
  /* BOTH HAVE PICKED: struck. The host's stake now; the guest's on its machine. */
  const paid = doorOf(world).spend(s.stake, 'sidebet');
  if (!paid.ok) { say(world, 'SIDE BET', paid.why); st.side = null; send(world, { t: 'sidebet', k: 'void' }); return true; }
  const entry = { ...sidePublic(s), role: 'host', on: s.runners[s.hostPick].id, against: s.runners[s.guestPick].id, other: s.guestName };
  setSideBets([...sideBets(), entry]);
  say(world, `SIDE BET — ${s.guestName.toUpperCase()}`, `struck: ${pickLine(s, s.hostPick, s.guestPick, s.guestName)}`);
  send(world, { t: 'sidebet', k: 'strike', ...sidePublic(s) });
  st.side = null;
  return true;
}

function sideKey(world) {
  const at = sharedCounter(world);
  if (!at) return false;
  if (isHost(world)) return hostSidePress(world, 'host', at);
  send(world, { t: 'sidebet', k: 'key' });
  return true;
}

function onSideBet(world, msg, from) {
  const st = stOf(world);
  if (isHost(world)) {
    if (msg.k === 'key') {
      const at = sharedCounter(world);
      if (at && at.other.id === from) hostSidePress(world, 'guest', at);
    } else if (msg.k === 'out') {
      /* The guest could not cover it: the host's stake comes back and the entry goes. */
      const mine = sideBets().filter((e) => e.role === 'host' && e.race === msg.race && e.day === msg.day);
      if (mine.length) { doorOf(world).pay(mine[0].stake, 'sidebet'); setSideBets(sideBets().filter((e) => !mine.includes(e))); say(world, 'SIDE BET', 'off — they cannot cover it'); }
    }
    return;
  }
  if (msg.k === 'offer') {
    st.side = { ...msg };
    say(world, `SIDE BET — ${String(msg.hostName).toUpperCase()}`,
      msg.guestPick == null ? `${msg.hostName} backs ${msg.runners[msg.hostPick]?.name ?? '—'} — press to pick yours` : pickLine(msg, msg.guestPick, msg.hostPick, msg.hostName));
  } else if (msg.k === 'strike') {
    const paid = doorOf(world).spend(msg.stake | 0, 'sidebet');
    if (!paid.ok) { send(world, { t: 'sidebet', k: 'out', race: msg.race, day: msg.day }); say(world, 'SIDE BET', paid.why); st.side = null; return; }
    const entry = { ...msg, t: undefined, k: undefined, role: 'guest', on: msg.runners[msg.guestPick].id, against: msg.runners[msg.hostPick].id, other: msg.hostName };
    delete entry.t; delete entry.k;
    setSideBets([...sideBets(), entry]);
    st.side = null;
    say(world, `SIDE BET — ${String(msg.hostName).toUpperCase()}`, `struck: ${pickLine(msg, msg.guestPick, msg.hostPick, msg.hostName)}`);
  } else if (msg.k === 'void') { st.side = null; }
  else if (msg.k === 'settled') {
    if ((msg.pay | 0) > 0) doorOf(world).pay(msg.pay | 0, 'sidebet');
    setSideBets(sideBets().filter((e) => !(e.role === 'guest' && e.race === msg.race && e.day === msg.day)));
    say(world, `SIDE BET — ${String(msg.other || 'the host').toUpperCase()}`, String(msg.line || ''));
  }
}

/** The position a runner finished in; one not in the order is last. */
const finishOf = (result, id) => result?.order?.find((o) => o.id === id)?.position ?? 99;

/** Host: settle every struck side bet whose race has run. */
function settleSideBets(world) {
  const all = sideBets();
  const day = dayOf(world), hour = hourOf(world);
  let left = all;
  for (const e of all) {
    if (e.role !== 'host' || !ticketRun(e, day, hour)) continue;
    const race = raceById(e.venue, e.day, e.race);
    const res = race ? resultOf(race) : null;
    const mine = finishOf(res, e.on), theirs = finishOf(res, e.against);
    const won = mine < theirs, tie = mine === theirs;
    const hostPay = won ? e.stake * 2 : tie ? e.stake : 0;
    const guestPay = tie ? e.stake : won ? 0 : e.stake * 2;
    if (hostPay > 0) doorOf(world).pay(hostPay, 'sidebet');
    const nameOfRunner = (id) => e.runners.find((r) => r.id === id)?.name || id;
    say(world, `SIDE BET — ${String(e.other).toUpperCase()}`,
      tie ? 'a dead heat — stakes back' : won ? `${nameOfRunner(e.on)} beat ${nameOfRunner(e.against)} — you take ${hostPay}` : `${nameOfRunner(e.against)} beat ${nameOfRunner(e.on)} — ${e.other} takes ${e.stake * 2}`);
    send(world, { t: 'sidebet', k: 'settled', race: e.race, day: e.day, pay: guestPay, other: e.hostName,
      line: tie ? 'a dead heat — stakes back' : won ? `${nameOfRunner(e.on)} beat ${nameOfRunner(e.against)} — ${e.hostName} takes ${e.stake * 2}` : `${nameOfRunner(e.against)} beat ${nameOfRunner(e.on)} — you take ${guestPay}` });
    left = left.filter((x) => x !== e);
  }
  if (left !== all) setSideBets(left);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE TWO-CARRIER CRATE
 * ══════════════════════════════════════════════════════════════════════════ */

/** The two-carrier job this machine is carrying, if any. Host-side only. */
export function carryJob() { return openJobs().find((j) => j.shape === CARRY_JOB.id) || null; }
/** Where the crate is on its journey, for a HUD: `{ jobId, stage }` or null. */
export function carryState() { return CARRY ? { ...CARRY, hands: { ...CARRY.hands } } : null; }
/** The crate body on this machine, or null. */
export function crateOf(world) { return stOf(world).crate; }

function spawnCrate(world, x, z, y = null) {
  const st = stOf(world);
  if (st.crate) return st.crate;
  const fy = y ?? (world.floorAt ? world.floorAt(x, z) : 0);
  const prop = makeCrate(world, new THREE.Vector3(x, fy + CRATE.size * 0.5, z), CRATE.size, { exactSize: true });
  /* TWO TONNES. The Force grip reads `body.mass` against `liftCapacity`
   * (`Player._pickGripTarget` / `toggleGrip`), and 2000 is past the cap at
   * every slider, so one player's grip is refused with TOO HEAVY — which is
   * the press this file reads as a hand going on. */
  prop.body.mass = CRATE.mass;
  prop.body.invMass = 1 / CRATE.mass;
  prop.hp = prop.maxHp = 100000;
  prop.coopCrate = true;
  st.crate = prop;
  return prop;
}

function dropCrate(world) {
  const st = stOf(world);
  if (!st.crate) return;
  try { st.crate.destroy(true); } catch {}
  st.crate = null;
  st.hands = false;
}

/**
 * A spot with ROOM ROUND IT: the first candidate from which four horizontal
 * rays at chest height meet nothing within `clear` metres. #52 is a canyon of
 * container stacks and the first point tried, five metres in from the door,
 * stood 0.63 m from a stack — the crate rose under two grips and could not
 * be walked an inch. Measured, so the placement is probed and not assumed.
 */
function freeSpot(world, candidates, clear = 2.2) {
  const phys = world.physics;
  for (const c of candidates) {
    if (!phys?.raycast) return c;
    const y = (world.floorAt ? world.floorAt(c.x, c.z) : 0) + 0.8;
    _a.set(c.x, y, c.z);
    let blocked = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      _b.set(dx, 0, dz);
      const hit = phys.raycast(_a, _b, clear, (b) => !b?.userData?.enemy);
      if (hit) { blocked = true; break; }
    }
    if (!blocked) return c;
  }
  return candidates[0] || null;
}

/** The crate's rest point in #52: along the line from the door to the room's centre, the first clear spot. */
function holdPoint(world) {
  const p = placeOf(world, CARRY_JOB.from);
  if (!p) return null;
  const [dx, dz] = p.door || [p.x, p.z];
  const vx = p.x - dx, vz = p.z - dz;
  const l = Math.hypot(vx, vz) || 1;
  const ux = vx / l, uz = vz / l;
  const cands = [];
  for (const d of [4, 6, 8, 10, 12, 3]) for (const side of [0, 3, -3, 6, -6]) cands.push({ x: dx + ux * d - uz * side, z: dz + uz * d + ux * side });
  return freeSpot(world, cands);
}
/** The Arrivals lift, which serves 40, 44 and 48; the car's lobby is inboard of it. */
const SHAFT = SHAFTS.find((s) => s.id === 'arrivals') || SHAFTS[0];
const lobbyPoint = (world) => {
  const inward = SHAFT.z < 0 ? 1 : -1;
  const cands = [];
  for (const d of [5, 7, 9, 4]) for (const side of [0, 3, -3]) cands.push({ x: SHAFT.x + side, z: SHAFT.z + inward * d });
  return freeSpot(world, cands);
};
/**
 * WHERE IN ARRIVALS IT GOES: the far end of the hall, a third of its width
 * along from the centre. The Arrivals shaft stands INSIDE #7's footprint
 * (the hall wraps its own lift lobby), so "in the room" would be true the
 * moment the doors opened; the customs gates are twenty metres away.
 */
export function deliverPoint(world) {
  const p = placeOf(world, CARRY_JOB.to);
  if (!p) return null;
  const a = p.w / 3;
  return { x: p.x + Math.cos(p.yaw) * a, z: p.z - Math.sin(p.yaw) * a, r: 4 };
}

/**
 * Your hands on the crate: a grip press the Force refused beside it. Every
 * refusal is a fresh object on `player.lastGripRefusal`, so identity is the
 * press. Both machines run this for their own player.
 */
function watchHands(world, st) {
  const p = world.player;
  const ref = p?.lastGripRefusal;
  if (ref === st.lastRef) return;
  st.lastRef = ref;
  if (!ref || !st.crate || !p?.position) return;
  if (p.position.distanceTo(st.crate.body.position) > REACH + 0.5) return;
  setHands(world, !st.hands);
}

/** Put your hands on the crate, or take them off — the thing the refused grip press does. */
export function setHands(world, on) {
  const st = stOf(world);
  if (!st.crate) return false;
  st.hands = !!on;
  if (isHost(world)) {
    if (CARRY) CARRY.hands.host = st.hands;
  } else send(world, { t: 'carry', k: 'hands', on: st.hands });
  say(world, 'THE CRATE', st.hands ? 'your hands are on it — it takes two' : 'you let go');
  return true;
}

function bothNear(world, st) {
  const c = st.crate?.body.position;
  const me = world.player?.position;
  const other = theOther(world);
  if (!c || !me || !other?.position) return null;
  if (me.distanceTo(c) > REACH + 1.5 || other.position.distanceTo(c) > REACH + 1.5) return null;
  return { me, other: other.position };
}

/** Host: the crate is driven to the midpoint of the two carriers while both hold. */
function driveCrate(world, st, dt) {
  const b = st.crate.body;
  const both = CARRY.hands.host && CARRY.hands.guest ? bothNear(world, st) : null;
  if (!both) {
    if (b.gravityScale !== 1) { b.gravityScale = 1; b.wake?.(); }
    if (CARRY.hands.host !== CARRY.hands.guest && st.said !== 'one') {
      st.said = 'one';
      say(world, 'TOO HEAVY FOR ONE', `${Math.round(CRATE.mass / 1000)} tonnes — ${CARRY.hands.host ? nameOf(world, world.net?.peers?.[0]?.id) + ' needs to take the other end' : 'take the other end'}`);
    }
    return false;
  }
  st.said = null;
  _a.addVectors(both.me, both.other).multiplyScalar(0.5);
  _a.y = Math.max(both.me.y, both.other.y) + CRATE.lift;
  _b.subVectors(_a, b.position).multiplyScalar(CRATE.pull).clampLength(0, CRATE.speed);
  b.gravityScale = 0;
  b.velocity.copy(_b);
  b.angularVelocity.set(0, 0, 0);
  b.wake?.();
  return true;
}

function finishCarry(world, job) {
  settleRun({ carried: [job.id] });
  const got = collect(job.id);
  const n = got.ok ? got.pay : Math.max(1, Math.round(job.pay || 100));
  const paid = doorOf(world).pay(n, 'work');
  setStanding(standing() + 2);
  say(world, 'DELIVERED', `the crate is in Arrivals — ${paid} credits each`);
  send(world, { t: 'carry', k: 'paid', n, line: `the crate is in Arrivals — ${n} credits each` });
  send(world, { t: 'carry', k: 'gone' });
  dropCrate(world);
  CARRY = null;
}

function stepCarryHost(world, st, dt) {
  const job = carryJob();
  if (!job) {
    if (CARRY) { CARRY = null; dropCrate(world); send(world, { t: 'carry', k: 'gone' }); }
    return;
  }
  if (!CARRY || CARRY.jobId !== job.id) CARRY = { jobId: job.id, stage: 'hold', hands: { host: false, guest: false } };
  const deck = world._station?.deck;
  if (!st.crate) {
    if (!coopGuest(world)) return;
    let at = null;
    if (CARRY.stage === 'hold' && deck === placeOf(world, CARRY_JOB.from)?.deck) at = holdPoint(world);
    else if (CARRY.stage === 'aboard' && deck === placeOf(world, CARRY_JOB.to)?.deck) at = lobbyPoint(world);
    if (!at) return;
    const c = spawnCrate(world, at.x, at.z);
    const q = c.body.position;
    send(world, { t: 'carry', k: 'spawn', p: [q.x, q.y, q.z] });
    say(world, 'THE CRATE', CARRY.stage === 'hold' ? `${Math.round(CRATE.mass / 1000)} tonnes in the Cargo hold — it takes both of you` : 'out of the car — to the customs gates at the far end of the hall');
    return;
  }
  const lifted = driveCrate(world, st, dt);
  const q = st.crate.body.position;
  st.tick += dt;
  if (st.tick >= 0.1) {
    st.tick = 0;
    const r = st.crate.body.quaternion;
    send(world, { t: 'carry', k: 'at', p: [q.x, q.y, q.z], q: [r.x, r.y, r.z, r.w] });
  }
  if (!lifted) return;
  if (CARRY.stage === 'hold' && Math.hypot(q.x - SHAFT.x, q.z - SHAFT.z) <= CRATE.shaft) {
    CARRY.stage = 'aboard';
    CARRY.hands = { host: false, guest: false };
    dropCrate(world);
    send(world, { t: 'carry', k: 'gone' });
    send(world, { t: 'carry', k: 'word', head: 'INTO THE CAR', line: `ride the Arrivals lift to deck ${placeOf(world, CARRY_JOB.to)?.deck ?? 40}` });
    say(world, 'INTO THE CAR', `ride the Arrivals lift to deck ${placeOf(world, CARRY_JOB.to)?.deck ?? 40}`);
    return;
  }
  const to = deliverPoint(world);
  if (CARRY.stage === 'aboard' && to && Math.hypot(q.x - to.x, q.z - to.z) <= to.r) finishCarry(world, job);
}

function stepCarryGuest(world, st, dt) {
  const c = st.crate;
  if (!c || !st.at) return;
  /* The host's body, followed: the guest's copy is a picture of the crate. */
  const b = c.body;
  b.gravityScale = 0;
  _a.set(st.at[0], st.at[1], st.at[2]);
  _b.subVectors(_a, b.position).multiplyScalar(8).clampLength(0, 12);
  b.velocity.copy(_b);
  b.angularVelocity.set(0, 0, 0);
  b.wake?.();
}

function onCarry(world, msg, from) {
  const st = stOf(world);
  if (isHost(world)) {
    if (msg.k === 'hands' && CARRY) { CARRY.hands.guest = !!msg.on; st.guestHands = !!msg.on; }
    return;
  }
  if (msg.k === 'spawn') {
    dropCrate(world);
    spawnCrate(world, msg.p[0], msg.p[2], msg.p[1] - CRATE.size * 0.5);
    st.at = msg.p.slice();
    say(world, 'THE CRATE', `${Math.round(CRATE.mass / 1000)} tonnes — it takes both of you`);
  } else if (msg.k === 'at') { st.at = msg.p.slice(); }
  else if (msg.k === 'gone') { dropCrate(world); st.at = null; }
  else if (msg.k === 'word') say(world, String(msg.head || ''), String(msg.line || ''));
  else if (msg.k === 'paid') { if ((msg.n | 0) > 0) doorOf(world).pay(msg.n | 0, 'work'); say(world, 'DELIVERED', String(msg.line || '')); dropCrate(world); st.at = null; }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE HOOKS — one line each in Station.js
 * ══════════════════════════════════════════════════════════════════════════ */

function wire(world) {
  const net = world.net;
  if (!net) return;
  NETS.set(net, world);
  if (net._coopGames) return;
  net._coopGames = true;
  /* Dispatched to whichever World last stepped with this net, so a lift ride
   * (which rebuilds the World and re-attaches the same net) does not leave
   * the old one answering. */
  net.on('sabacc2', (msg, from) => { const w = NETS.get(net); if (w) onSabacc(w, msg, from); });
  net.on('sidebet', (msg, from) => { const w = NETS.get(net); if (w) onSideBet(w, msg, from); });
  net.on('carry', (msg, from) => { const w = NETS.get(net); if (w) onCarry(w, msg, from); });
}

/** Every frame, from `stepStation`. */
export function stepCoopGames(world, dt) {
  if (!world?.net || !world.netMode) return;
  const st = stOf(world);
  wire(world);
  watchHands(world, st);
  if (isHost(world)) {
    stepCarryHost(world, st, dt);
    st.sideTick = (st.sideTick || 0) + dt;
    if (st.sideTick >= 1) { st.sideTick = 0; settleSideBets(world); }
  } else stepCarryGuest(world, st, dt);
}

/**
 * The key, from `stationKey`: a shared table first, then a shared counter.
 * False whenever the other human is not within reach of the same thing, so
 * the single-player branches below it see exactly the press they always did.
 */
export function coopGamesKey(world) {
  if (!coopGuest(world)) return false;
  if (sabaccKey(world)) return true;
  return sideKey(world);
}
