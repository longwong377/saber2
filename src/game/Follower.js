/**
 * THE FOLLOWER — V18 cool 13: *"a resident who follows you asking about your
 * saber, and can be told to go away."*
 *
 * One curious resident per deck visit, seeded on the day and the deck: a slot
 * on one of the deck's open walks. Walk past that body inside `LATCH` metres
 * and it latches — it stops being the pool's walker and becomes yours, two to
 * three metres behind you for up to `LIFE` seconds, asking four seeded
 * questions about the blade you actually carry (`Saber.SABER_COLORS` off
 * `player.saber.colorIndex`, `player.saber.hiltStyle`, `player.saberSet`). The
 * interact key on them is "go away": `Regulars.talkHook` routes it here and
 * they answer with a line and stop. The timer does the same. A lift car or the
 * tram releases them at the door — a child does not ride the tram after you.
 *
 * ── HOW IT MOVES, AND WHY NOTHING ELSE MOVES IT ──────────────────────────
 *
 * `StationLife` drives a body one of two ways: `stepWalkers` when `wayR` is
 * set, `stepStanding` when `standX` is. A latched follower has NEITHER — `wayR`
 * is zeroed and `standX` was never written for a walker — and carries a
 * `wayMission`, which is the flag `reseat` keeps its hands off. So this file
 * is the one writer: `standCx/standCz` is the authority on where it is, the
 * position is written from it every frame the way `stepStanding` does, the
 * velocity is handed to the gait so the legs play, and the facing is toward
 * you. On release it is stood where it stopped as an ordinary standing body
 * and the pool recycles it when you are far enough away.
 *
 * Nothing here rolls a die: the pick, the questions and the goodbye are `h2`/`hashF`
 * off the day, the deck and the person.
 */

import { SABER_COLORS } from './Saber.js';
import { wayPlacesOn, headcount, slotIn } from './StationLife.js';
import { liftState } from './DeckLift.js';
import { stationDay } from './StationSave.js';

export const FOLLOW = {
  /** Walk this close past the curious one and they latch. */
  latch: 3.0,
  /** The gap they keep: no step inside `near`, a run above `far`. */
  near: 2.4, far: 3.2,
  /** Metres a second at most — a run, not a sprint; you can lose them. */
  pace: 5.0,
  /** How fast the shoulders come round. */
  turn: 4.0,
  /** Seconds before they give up on their own. */
  life: 90,
  /** When each question comes, seconds after the latch. */
  askAt: [3, 16, 32, 50],
  /** A question waits until they are this close, so it is not shouted. */
  askReach: 5,
  /** Metres away before they stop trying and go home. */
  lose: 18,
};
const SCAN_EVERY = 0.5;

/** A stable 0..1 from two integers — `StationLife.h2`. */
function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function wrapPi(a) { return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; }

const _v = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHO, TODAY                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Today's curious one on this deck: a walk place and a slot on it, seeded on
 * the day and the deck. The slot is taken modulo the walk's headcount at the
 * hour, so there is always somebody in it while the walk has anybody.
 */
export function curiousSlot(deck, day, hour) {
  const walks = wayPlacesOn(deck).filter((p) => p.way === 'walk');
  if (!walks.length) return null;
  const place = walks[Math.floor(h2(day * 31 + deck, 7) * walks.length) % walks.length];
  const heads = Math.max(1, headcount(place, hour) | 0);
  const i = Math.floor(h2(day * 17 + 3, deck * 13 + place.id) * heads) % heads;
  return { place, i, key: `${place.id}:${i}` };
}

/** What they ask about: the blade you actually carry. */
export function saberFacts(world) {
  const s = world?.player?.saber;
  const c = SABER_COLORS[s?.colorIndex | 0] || SABER_COLORS[0];
  return {
    colour: c.name, key: c.key,
    hilt: s?.hiltStyle || 'Graflex',
    set: world?.player?.saberSet || 'single',
    lit: !!s?.lit,
  };
}

/** The four questions, in order — two of them always name the colour. */
export function questionsFor(world, seed) {
  const F = saberFacts(world);
  const col = `the ${F.colour.toLowerCase()} one`;
  const always = [
    `is that a real one? ${col} — I've never seen a ${F.key} blade up close.`,
    `why ${F.key}? is ${F.key} for the good ones or the bad ones?`,
    `does it hum when it's off? ${col}, I mean.`,
  ];
  const rest = [
    `what's the hilt? my brother says the ${F.hilt} ones are the old kind.`,
    F.set === 'staff' ? 'two blades on one shaft — how do you not cut your own leg?'
      : F.set === 'pair' ? 'two of them! do you swing both at once?'
        : 'just the one blade? I thought you lot carried two.',
    `can I hold it? no? the ${F.hilt} looks heavy.`,
    'have you cut a droid with it? a real droid?',
    'do they let you carry that in the cantina?',
    `is it hot? ${col}. it looks hot.`,
  ];
  /* Two colour lines and two others, each picked off the seed without repeats. */
  const out = [];
  const a = Math.floor(hashF(seed, 'c1') * always.length) % always.length;
  let b = Math.floor(hashF(seed, 'c2') * (always.length - 1)) % (always.length - 1);
  if (b >= a) b++;
  out.push(always[a], always[b]);
  const r1 = Math.floor(hashF(seed, 'r1') * rest.length) % rest.length;
  let r2 = Math.floor(hashF(seed, 'r2') * (rest.length - 1)) % (rest.length - 1);
  if (r2 >= r1) r2++;
  out.push(rest[r1], rest[r2]);
  /* The colour question comes first so the check — and the player — hear it. */
  const q1 = out[0];
  const order = [q1, out[2], out[1], out[3]];
  return order;
}

const BYES = [
  'fine. bye then.', 'all right, all right. I was only asking.', 'okay. my mum said you\'d say that.',
  'fine — but I saw it. I did.',
];
const GIVEUPS = [
  'I have to go. bye! mind the blade.', 'you walk fast. bye.', 'that\'s enough for one day, I think.',
];

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STATE                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

function memo(world) {
  return world._follower || (world._follower = { in: 0, visit: null, done: false, F: null });
}

/** The one following you now, or null. */
export function follower(world) { return world?._follower?.F || null; }

/** The lift states in which YOU are in the car with the doors shut — `seal`
 *  onward is the ride out; `ride`/`stop` is the ride in. `closing`/`away` is
 *  the empty car leaving after you stepped off, and is not a ride. */
const CAR_SHUT = new Set(['ride', 'stop', 'seal', 'leave', 'gone']);

function latch(world, st, body, key) {
  const M = memo(world);
  const day = stationDay() | 0;
  const seed = `${key}|${day}|${st.deck}`;
  /* OUT OF THE POOL'S HANDS: no walk, no stand, a mission. */
  body.wayR = 0; body.wayLegs = null; body.wayDwell = 0;
  body.wayMission = { follow: true };
  body.standCx = body.position.x; body.standCz = body.position.z;
  if (!body.stationRoleBase) body.stationRoleBase = body.stationRole;
  body._followRole = true;
  body.stationRole = `${body.stationRoleBase} — asking about your saber`;
  M.F = {
    key, body, t: 0, asked: 0, ask: [], seed,
    questions: questionsFor(world, seed),
    name: String(body.stationName || 'somebody'),
  };
  M.visit = `${day}:${st.deck}`;
  return M.F;
}

/** Stand them where they are, as an ordinary standing body, and let go. */
export function release(world, why = 'timer') {
  const M = memo(world);
  const F = M.F;
  if (!F) return false;
  const b = F.body;
  M.F = null;
  M.done = true;
  if (!b) return true;
  b.wayMission = null;
  b._followRole = false;
  if (b.stationRoleBase) b.stationRole = b.stationRoleBase;
  if (b.position && b.alive !== false && !b.dead) {
    b.standX = b.position.x; b.standZ = b.position.z;
    b.standCx = b.position.x; b.standCz = b.position.z;
    b.standTx = b.position.x; b.standTz = b.position.z;
    b.standYaw = b.facing ?? 0; b.standFace = b.facing ?? 0;
    b.standStill = false; b.standN = 0; b.standIn = 2.5;
    b.velocity?.set?.(0, 0, 0);
  }
  F.endedBy = why; M.lastEnd = why;
  return true;
}

/**
 * `Regulars.talkHook`'s first line: the interact key on the follower is "go
 * away". True when the press was spent here.
 */
export function dismissFollower(world, body) {
  const F = follower(world);
  if (!F || !body || F.body !== body) return false;
  const line = BYES[Math.floor(hashF(F.seed, 'bye') * BYES.length) % BYES.length];
  world?.notify?.(F.name.toUpperCase(), line);
  release(world, 'dismissed');
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * `stepStation`'s one line. Looks for today's curious one while nobody is
 * following; drives the follower while somebody is.
 */
export function stepFollower(world, st, dt) {
  const life = world?._stationLife;
  const P = world?.player?.position;
  if (!life || !P || !st || !(dt > 0)) return;
  const M = memo(world);
  const F = M.F;

  if (!F) {
    M.in -= dt;
    if (M.in > 0) return;
    M.in = SCAN_EVERY;
    const visit = `${stationDay() | 0}:${st.deck}`;
    if (M.visit !== visit) { M.visit = visit; M.done = false; }
    if (M.done) return;
    if (world._tramRide || CAR_SHUT.has(liftState(world))) return;
    const pick = curiousSlot(st.deck, stationDay() | 0, st.hour);
    if (!pick) return;
    const body = life.live.get(pick.key);
    if (!body?.position || body.dead || body.alive === false || body.__stationTouched) return;
    if (!body.wayR || body.wayMission) return;
    const d = Math.hypot(P.x - body.position.x, P.z - body.position.z);
    if (d > FOLLOW.latch) return;
    latch(world, st, body, pick.key);
    return;
  }

  const b = F.body;
  /* Gone: dead, hurt, recycled, or the pool lost it. */
  if (!b?.position || b.dead || b.alive === false || b.__stationTouched || life.live.get(F.key) !== b) {
    release(world, 'gone'); return;
  }
  /* Not into a lift car or the tram. */
  if (world._tramRide || CAR_SHUT.has(liftState(world))) {
    world.notify?.(F.name.toUpperCase(), 'I\'m not allowed on that. bye!');
    release(world, 'door'); return;
  }
  F.t += dt;
  const dx = P.x - b.standCx, dz = P.z - b.standCz;
  const d = Math.hypot(dx, dz);
  if (F.t >= FOLLOW.life || d > FOLLOW.lose) {
    const line = GIVEUPS[Math.floor(hashF(F.seed, 'giveup') * GIVEUPS.length) % GIVEUPS.length];
    world.notify?.(F.name.toUpperCase(), line);
    release(world, d > FOLLOW.lose ? 'lost' : 'timer'); return;
  }

  /* ── THE TRAIL: a step toward you when the gap is more than `near`, faster
   * the wider it is, capped at a run. Nothing inside the gap. ─────────── */
  let mx = 0, mz = 0;
  if (d > FOLLOW.near) {
    const want = Math.min(FOLLOW.pace, (d - FOLLOW.near) * 2.5 + (d > FOLLOW.far ? 0.8 : 0));
    const step = Math.min(d - FOLLOW.near, want * dt);
    mx = dx / d * step; mz = dz / d * step;
    b.standCx += mx; b.standCz += mz;
  }
  const p = b.position;
  p.x = b.standCx; p.z = b.standCz;
  b.body?.setTransform?.(p, null);
  if (b.velocity) b.velocity.set(mx / dt, 0, mz / dt);
  /* Face you — along the step while there is one, straight at you when not. */
  const want = (mx * mx + mz * mz) > 1e-9 ? Math.atan2(mx, mz) : Math.atan2(dx, dz);
  b.facing = (b.facing ?? 0) + wrapPi(want - (b.facing ?? 0)) * Math.min(1, dt * FOLLOW.turn);

  /* ── THE QUESTIONS, on the clock and only when close enough to be heard. */
  if (F.asked < F.questions.length && F.t >= FOLLOW.askAt[F.asked] && d <= FOLLOW.askReach) {
    const q = F.questions[F.asked++];
    F.ask.push({ t: F.t, q });
    world.notify?.(F.name.toUpperCase(), q);
  }
}

/** For checks: today's slot on a deck, as a world point. */
export function curiousPoint(deck, day, hour, out = _v) {
  const pick = curiousSlot(deck, day, hour);
  if (!pick) return null;
  slotIn(pick.place, pick.i, out);
  return { ...pick, x: out.x, z: out.z };
}
