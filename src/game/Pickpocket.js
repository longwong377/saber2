/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE PICKPOCKET, AND THE BOUNTY THAT PAYS FOR HIM — V18 cool 5
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"A pickpocket to chase across the concourse, and a bounty board that pays
 * for him."*
 *
 * Once a station day, at an hour seeded off the day (`pickHour`), a resident
 * on deck 40's ring brushes past the player — within `PICK.brush` metres —
 * and `Credits.spend` takes five to fifteen per cent of the purse. The
 * banner says so and names the room he is running for, and he runs: a
 * walker at `PICK.pace` times `WALK_PACE`, on legs `planRoute` lays to a
 * hiding room, through `StationLife.stepWalkers` like everybody else in the
 * corridor. Catching him is getting within `PICK.grab` metres and pressing
 * the interact key — `Station.talkTo` asks this file first — which pays
 * the credits back plus the bounty #25's board posted for him. If he reaches
 * the room he is gone with them.
 *
 * V19 add 10: WHETHER HE STRIKES AT ALL TODAY, AND HIS CUT, READ THE TIER —
 * `pickPlan` below, off `StationDifficulty.pickOdds`: three days in ten on
 * Padawan, every day on Grandmaster, and the share scaled to the same number.
 *
 * ONE STRIKE A DAY, KEPT IN THE STATION FOLD (`StationSave.pick`), because a
 * lift ride rebuilds `StationLife` and a thief who struck again on every
 * deck change would be a tax rather than an event. His name and the bounty
 * are `bountyFor(day)`: the same row `Notices.sourcesFor` reads for the
 * board, so the man the wall names is the man on the ring.
 */

import { DRUM } from './StationPlan.js';
import { resident } from './StationCast.js';
import { purse, spend, pay } from './Credits.js';
import { pickpocketState, setPickpocketState } from './StationSave.js';
import { stationDiff } from './StationDifficulty.js';
import { note } from './Journal.js';

export const PICK = Object.freeze({
  /** The cut he takes: 5–15 % of the purse, seeded off the day. */
  share: { min: 0.05, span: 0.10 },
  /** His running pace, as a multiple of `WALK_PACE`. */
  pace: 1.6,
  /** How close he comes to lift the purse, and how close you must be to take it back. */
  brush: 1.5, grab: 1.2,
  /** The bounty the board posts: 40–100 credits, seeded off the day. */
  bounty: { min: 40, span: 60 },
  /** The strike hour: 09:00–20:00. */
  hours: { from: 9, span: 12 },
  /** How far from the ring walk the player may stand for the brush to happen. */
  onRing: 3.0,
  /** How far ahead on the ring he starts. */
  lead: 9,
  /** The rooms he hides in — deck 40's doors off the ring, by id. */
  hides: [9, 14, 15, 17, 19, 21, 23],
});

const KEY = 'pickpocket';
const KINDS = ['human', 'narn', 'centauri', 'drazi', 'brakiri', 'llort'];

function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The station hour today's thief strikes. */
export function pickHour(day) {
  return PICK.hours.from + Math.floor(h2(day | 0, 5) * PICK.hours.span);
}

/** Who he is today: a real resident row, so he has a face and a name. */
export function thiefFor(day) {
  const species = KINDS[Math.floor(h2(day | 0, 9) * KINDS.length) % KINDS.length];
  return resident(`thief:${day | 0}`, { species, role: 'visitor' });
}

/** The room he runs for today. */
export function hideFor(day) {
  return PICK.hides[Math.floor(h2(day | 0, 17) * PICK.hides.length) % PICK.hides.length];
}

/** The board's row: his name and what #25 pays for him, plus today's state. */
export function bountyFor(day) {
  const who = thiefFor(day);
  const bounty = PICK.bounty.min + Math.floor(h2(day | 0, 13) * PICK.bounty.span);
  const S = pickpocketState();
  const today = S && (S.day | 0) === (day | 0) ? S : null;
  return { name: who.name, pay: bounty, caught: !!today?.caught, gone: !!today?.gone, hides: hideFor(day) };
}

/**
 * V19 add 10: DOES HE STRIKE TODAY, AND FOR HOW MUCH. The tier's `pickOdds`
 * is the day's chance, drawn off the day; his cut is the day's share scaled
 * to the same number. One read, here, where it is decided.
 */
export function pickPlan(day, world = null) {
  const D = stationDiff(world);
  const strikes = h2(day | 0, 27) < D.pickOdds;
  const share = (PICK.share.min + h2(day | 0, 21) * PICK.share.span) * (0.5 + 0.5 * D.pickOdds);
  return { strikes, share, odds: D.pickOdds };
}

function pickOf(life) {
  return life.pick || (life.pick = { key: KEY, body: null, lifted: 0, caught: false, tries: 0, name: '', hide: 0, bounty: 0 });
}

function ringOf(world) {
  const p = world.player?.position;
  if (!p) return null;
  const r = Math.hypot(p.x, p.z);
  return Math.abs(r - DRUM.ringR) <= PICK.onRing ? { r, a: Math.atan2(p.x, p.z), x: p.x, z: p.z } : null;
}

function dropThief(world, life, T) {
  const P = pickOf(life);
  const b = life.live.get(P.key);
  if (b) { T.removeBody(world, b); life.live.delete(P.key); }
  P.body = null;
}

/** Legs along the ring to the player's bearing. */
function legsToPlayer(T, body, a1) {
  const legs = [];
  T.arcLeg(legs, T.RING_WALK, body.wayAngle, a1);
  body.wayLegs = legs; body.wayAt = 0; body.wayT = 0; body.wayDwell = 0;
  return legs.length > 0;
}

function lift(world, st, life, T, body) {
  const P = pickOf(life);
  const day = st.day | 0;
  const have = purse();
  const share = pickPlan(day, world).share;
  const amount = Math.max(1, Math.round(have * share));
  const r = spend(amount, 'pickpocket');
  if (!r.ok) return false;
  P.lifted = amount;
  const dests = T.destsOn(life.deck);
  const dest = dests.find((d) => d.id === P.hide) || dests[0];
  const legs = T.planRoute(life.deck, body.wayR, body.wayAngle, dest, [], body);
  body.wayLegs = legs.length ? legs : null;
  body.wayAt = 0; body.wayT = 0; body.wayDwell = 0;
  body.wayPace = PICK.pace;
  body.wayTo = dest.id;
  body.wayMission = {
    arrive: (b, w) => {
      /* HE IS GONE, with the credits. */
      const S = pickpocketState() || { day };
      setPickpocketState({ ...S, day, gone: true, taken: P.lifted });
      w.notify?.('PICKPOCKET', `${P.name} is gone into ${dest.p?.name || 'the crowd'} with your ${P.lifted} credits`);
      T.removeBody(w, b); life.live.delete(P.key); P.body = null;
    },
  };
  setPickpocketState({ day, taken: amount, caught: false, gone: false, bounty: P.bounty, name: P.name });
  note('pickpocket', `${P.name} lifted ${amount} credits off you on the ring`, world); // V19: the journal
  world.notify?.('PICKPOCKET', `${P.name} brushed past you — ${amount} credits lighter, and he is running for ${dest.p?.name || 'cover'}`);
  return true;
}

function begin(world, st, life, T) {
  const P = pickOf(life);
  const day = st.day | 0;
  const at = ringOf(world);
  if (!at) return false;
  const who = thiefFor(day);
  const B = bountyFor(day);
  P.name = who.name; P.hide = hideFor(day); P.bounty = B.pay; P.lifted = 0; P.caught = false; P.tries = 0;
  const side = h2(day, 3) < 0.5 ? 1 : -1;
  const a0 = at.a + side * (PICK.lead / T.RING_WALK);
  const x = T.RING_WALK * Math.sin(a0), z = T.RING_WALK * Math.cos(a0);
  const dest = { id: 0, a: at.a, r: T.RING_WALK, on: 'ring' };
  const mission = {
    along: (b, w) => {
      const p = w.player?.position;
      if (!p || P.lifted) return;
      if (Math.hypot(b.position.x - p.x, b.position.z - p.z) <= PICK.brush) lift(w, st, life, T, b);
    },
    arrive: (b, w) => {
      if (P.lifted) return;
      /* Missed you: come round again, three times, then give up. */
      const now = ringOf(w);
      if (now && P.tries++ < 3 && legsToPlayer(T, b, now.a)) { b.wayMission = mission; return; }
      T.removeBody(w, b); life.live.delete(P.key); P.body = null;
    },
  };
  const body = T.missionWalker(world, st, life, P.key, `res_${who.species}`, { x, z }, dest, mission, who.look,
    { name: who.name, role: 'visitor', species: who.species, pace: 1.0 })
    || T.missionWalker(world, st, life, P.key, 'res_human', { x, z }, dest, mission, null,
      { name: who.name, role: 'visitor', pace: 1.0 });
  if (!body) return false;
  /* The legs `missionWalker` laid are radial-arc-radial; the thief is already
   * on the ring, so it is one arc to where you are. */
  legsToPlayer(T, body, at.a);
  P.body = body;
  setPickpocketState({ day, taken: 0, caught: false, gone: false, bounty: P.bounty, name: P.name });
  return true;
}

/**
 * ONE FRAME. Deck 40, the strike hour, once a day; then the chase runs on
 * the walker step and this only tidies — a caught thief is taken off the
 * ring the frame after `catchPickpocket` said so.
 */
export function stepPickpocket(world, st, life, dt, T) {
  if (!st || !life || life.deck !== 40 || !(dt > 0) || world.netMode === 'client') return;
  const P = pickOf(life);
  if (P.caught && P.body) { dropThief(world, life, T); return; }
  if (P.body) return;
  const day = st.day | 0;
  const S = pickpocketState();
  if (S && (S.day | 0) === day) {
    /* Struck today already. A chase the lift ride interrupted is over. */
    if (S.taken > 0 && !S.caught && !S.gone) setPickpocketState({ ...S, gone: true });
    return;
  }
  if (Math.floor(Number(st.hour) || 0) !== pickHour(day)) return;
  if (!pickPlan(day, world).strikes) return;
  if (purse() <= 0) return;
  begin(world, st, life, T);
}

/**
 * THE GRAB — `Station.talkTo`'s first question. True when the press was
 * spent on the thief: within `PICK.grab` he is caught and the purse and the
 * bounty are paid; further off the key says so and is still spent.
 */
export function catchPickpocket(world, body) {
  const life = world?._stationLife;
  const P = life?.pick;
  if (!P || !body || body !== P.body || !P.lifted || P.caught) return false;
  const p = world.player?.position;
  if (!p) return false;
  const d = Math.hypot(body.position.x - p.x, body.position.z - p.z);
  if (d > PICK.grab) { world.notify?.('PICKPOCKET', `${P.name} is ${d.toFixed(1)} m off — get closer`); return true; }
  const back = P.lifted;
  const got = pay(back + P.bounty, 'bounty');
  P.caught = true;
  const S = pickpocketState() || {};
  setPickpocketState({ ...S, day: world._station?.day | 0, caught: true, taken: back, paid: got });
  world.notify?.('PICKPOCKET CAUGHT', `${P.name} — your ${back} credits back, and #25's ${P.bounty}-credit bounty`);
  return true;
}
