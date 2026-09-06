/**
 * THE REGULARS — V18 cool 10: *"people you talk to three times remember you
 * and greet you first."*
 *
 * Three parts, each one small:
 *
 *   · THE LEDGER. `StationSave`'s `regulars` fold — `{ [key]: { n, lastDay,
 *     firstDay } }`, keyed on the PERSON (`species:name`) rather than the slot.
 *     `occupant` reseeds a census slot every day, so a slot key would make the
 *     regular somebody else tomorrow; the name is what the player actually
 *     remembers, and `nameFor` is deterministic on the same seed the face is.
 *   · THE TALK. `Station.talkTo` hands every press to `talkHook` before it
 *     barks. It counts the talk; from the third one on, it answers with the
 *     warm line instead of the room's, and the count is in the line.
 *   · THE GREETING. `stepRegulars` runs in `stepStation`: a regular who can
 *     see you inside `GREET_REACH` turns to you and says something real — the
 *     hour, your standing, the job you are carrying — ONCE per deck visit.
 *     The plate names them a regular while they are one.
 *
 * Nothing here rolls a die: every pick is `hashF` off the person, the
 * day and the hour, so the same regular says the same thing to a check that
 * asks twice.
 */

import { regularsState, setRegularsState, standing, stationDay } from './StationSave.js';
import { openJobs, owedJobs } from './Quests.js';
import { PLACE } from './StationPlan.js';
import { barkFor, homeFor, RHYTHMS } from './StationCast.js';
import { dismissFollower } from './Follower.js';

/** Talks before somebody is a regular. */
export const REGULAR_AT = 3;
/** Metres inside which a regular greets you first. */
export const GREET_REACH = 4;
/** cos 75°: how far off their own nose you can be and still be "seen". */
export const GREET_COS = 0.2588;
/** How often the deck is scanned for a regular in reach. */
const SCAN_EVERY = 0.25;

/** FNV-1a on a string, to 0..1 — the same one `StationCast` uses. */
function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (arr, seed, salt) => arr[Math.floor(hashF(seed, salt) * arr.length) % arr.length];

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
export function ordinal(n) { return ORD[n - 1] || `${n}th`; }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LEDGER                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/** A body that can be remembered: a resident with a species and a name, not
 *  a keeper behind a counter and not somebody's dog. */
function talkable(body) {
  return !!(body && body.stationResident && body.stationName && body.stationSpecies && !body.stationKeeper);
}

/** The person, not the slot. `stationRoleBase`/`stationNameBase` survive the
 *  plate's own rewrite below. */
export function regularKey(body) {
  if (!talkable(body)) return null;
  return `${body.stationSpecies}:${body.stationNameBase || body.stationName}`;
}

export function regularOf(body) {
  const k = regularKey(body);
  if (!k) return null;
  const r = regularsState()[k];
  return r && typeof r === 'object' ? r : null;
}

export function isRegular(body) {
  const r = regularOf(body);
  return !!r && (r.n | 0) >= REGULAR_AT;
}

/** One talk more. Returns the record, or null for a body that cannot be one. */
export function recordTalk(body, day = stationDay()) {
  const k = regularKey(body);
  if (!k) return null;
  const all = { ...regularsState() };
  const was = all[k] && typeof all[k] === 'object' ? all[k] : { n: 0, firstDay: day | 0, lastDay: day | 0 };
  const rec = { n: (was.n | 0) + 1, firstDay: was.firstDay ?? (day | 0), lastDay: day | 0 };
  all[k] = rec;
  setRegularsState(all);
  return rec;
}

/** The row the bark is built from, with the role the plate has not rewritten. */
function whoOf(body) {
  const species = body.stationSpecies || 'human';
  const role = body.stationRoleBase || body.stationRole || 'visitor';
  return {
    seed: (body.stationPlace != null && body.stationSlot != null)
      ? `p${body.stationPlace}s${body.stationSlot}` : String(body.stationNameBase || body.stationName),
    name: body.stationNameBase || body.stationName,
    species, role,
    faction: body.stationFaction || 'merchants',
    home: homeFor(species, role),
    rhythm: RHYTHMS[species] || RHYTHMS.human,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHAT THEY KNOW ABOUT YOU                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

function hourWord(h) {
  const t = ((h % 24) + 24) % 24;
  if (t < 5) return 'the middle of the night';
  if (t < 9) return 'early';
  if (t < 12) return 'the morning';
  if (t < 14) return 'midday';
  if (t < 18) return 'the afternoon';
  if (t < 22) return 'the evening';
  return 'late';
}

/** The job you are carrying, or the one you are owed for, as a phrase. */
function jobWord() {
  try {
    const open = openJobs();
    if (open.length) {
      const j = open[open.length - 1];
      const at = PLACE.get(j.place)?.name;
      return { line: j.line || 'that job', at: at ? at.toLowerCase() : null, open: true };
    }
    const owed = owedJobs();
    if (owed.length) {
      const j = owed[owed.length - 1];
      const at = PLACE.get(j.place)?.name;
      return { line: j.line || 'that job', at: at ? at.toLowerCase() : null, open: false };
    }
  } catch { /* the wall is not worth a crash */ }
  return null;
}

/** Everything a greeting can mention, read once per line. */
function facts(world, rec) {
  const s = standing();
  return {
    hour: hourWord(world?._station?.hour ?? 12),
    standing: s, standWord: `${s > 0 ? '+' : ''}${s}`,
    job: jobWord(),
    n: rec?.n | 0,
    today: (rec?.lastDay | 0) === (stationDay() | 0),
  };
}

/**
 * The line a regular calls out when you come into reach. Seeded on the person,
 * the day and the hour, so it changes across a day and not across a glance.
 */
export function greetingFor(body, world, rec = regularOf(body)) {
  const F = facts(world, rec);
  const name = body.stationNameBase || body.stationName;
  const seed = `${regularKey(body)}|${stationDay() | 0}|${Math.floor(world?._station?.hour ?? 0)}`;
  const opens = [
    `there you are.`, `back again!`, `I thought that was you.`, `you again —`, `knew I'd see you today.`,
  ];
  const lines = [
    `${F.hour} and you're still walking the ring. ${F.standing >= 0 ? `standing ${F.standWord} — they say it at the post.` : `standing ${F.standWord}. mind the guards.`}`,
    `${F.n} talks now, by my count. ${F.hour}'s a good time for a ${ordinal(F.n + 1)}.`,
    F.job ? `still ${F.job.open ? 'carrying' : 'owed for'} ${F.job.line}${F.job.at ? `, the one from ${F.job.at}` : ''}?` : `no job on you today? the boards are full.`,
    `${F.standing > 0 ? `people talk about the ${F.standWord}.` : `they'll serve you at ${F.standWord}, just.`} sit with us sometime — it's ${F.hour}.`,
    `you're the one with the saber. ${F.hour} — you eaten?`,
  ];
  const o = pick(opens, seed, 'open');
  const l = pick(lines, seed, 'line');
  return [`${String(name).toUpperCase()} · A REGULAR`, `${o} ${l}`];
}

/** The warm answer to the interact key, with the count in it. */
export function regularTalkLine(body, world, rec) {
  const who = whoOf(body);
  const day = stationDay() | 0;
  const F = facts(world, rec);
  const seed = `${regularKey(body)}|${day}|${rec.n | 0}`;
  const sameWeek = (day - (rec.firstDay | 0)) < 7;
  const counts = [
    `${ordinal(rec.n)} time${sameWeek ? ' this week' : ''}, and I'm glad of it.`,
    `that's ${rec.n} now. ${F.today ? 'twice in a day —' : ''} you do come round.`,
    `${ordinal(rec.n)} time we've talked. I keep count; it's ${F.hour}, nobody else does.`,
  ];
  const warm = pick(counts, seed, 'count');
  const said = barkFor(who, day, {
    hour: world?._station?.hour ?? 12,
    place: body.stationPlace != null ? PLACE.get(body.stationPlace) : null,
    companion: body._stationAnimal?.stationRole?.split(' —')[0] || null,
    standing: F.standing,
  });
  return [`${String(who.name).toUpperCase()} · A REGULAR`, said ? `${warm} ${said[1]}` : warm];
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE HOOKS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The plate: `HUD._nameplates` prints `stationRole`, so a regular's says so. */
function plate(body, regular) {
  if (!body.stationNameBase) body.stationNameBase = body.stationName;
  /* Only a REGULAR's plate is this module's to write. Other modules put
   * lines on `stationRole` — the vigil's officiant reads the roll on his,
   * the follower asks on theirs — and a writer that "restored" every plate
   * to what it first saw wiped those every frame. */
  if (!regular) {
    if (body._regularRole && body.stationRole === body._regularRole) body.stationRole = body.stationRoleBase;
    body._regularRole = null;
    return;
  }
  if (!body.stationRoleBase) body.stationRoleBase = body.stationRole;
  const want = `${body.stationRoleBase} — a regular`;
  if (body.stationRole !== want && !body._followRole) { body.stationRole = want; body._regularRole = want; }
}

/**
 * `Station.talkTo`'s one line. True when the press was spent here: the
 * follower told to go, or a regular answered warmly. False hands the press
 * back to the room's own bark, with the talk counted.
 */
export function talkHook(world, body) {
  if (dismissFollower(world, body)) return true;
  if (!talkable(body)) return false;
  const rec = recordTalk(body);
  if (!rec) return false;
  if (rec.n < REGULAR_AT) return false;
  plate(body, true);
  const [head, line] = regularTalkLine(body, world, rec);
  world?.notify?.(head, line);
  return true;
}

/** Deck-visit memory: who has greeted you since this world came up. */
function memo(world) {
  return world._regulars || (world._regulars = { in: 0, greeted: new Set() });
}

/**
 * `stepStation`'s one line. Regulars in reach and looking your way greet you,
 * once each per deck visit, and turn to face you while they do.
 */
export function stepRegulars(world, st, dt) {
  const life = world?._stationLife;
  const P = world?.player?.position;
  if (!life || !P || !st) return;
  const M = memo(world);
  M.in -= dt;
  if (M.in > 0) return;
  M.in = SCAN_EVERY;
  const ledger = regularsState();
  for (const body of life.live.values()) {
    if (!talkable(body) || body.dead || body.alive === false) continue;
    const k = regularKey(body);
    const rec = ledger[k];
    const regular = !!rec && (rec.n | 0) >= REGULAR_AT;
    plate(body, regular);
    if (!regular) continue;
    const gk = `${st.deck}:${k}`;
    if (M.greeted.has(gk)) continue;
    const dx = P.x - body.position.x, dz = P.z - body.position.z;
    const d = Math.hypot(dx, dz);
    if (d > GREET_REACH || d < 1e-3) continue;
    /* CAN THEY SEE YOU: inside 75° of their own nose. `facing` is the yaw
     * `stepStanding` writes, forward = (sin, cos). */
    const f = body.facing ?? 0;
    const dot = (Math.sin(f) * dx + Math.cos(f) * dz) / d;
    if (dot < GREET_COS) continue;
    M.greeted.add(gk);
    /* Turn to you and hold it — a standing body's `standFace` is the pose's
     * bearing, and `standIn` is how long the pose is kept. */
    if (body.standX !== undefined) { body.standFace = Math.atan2(dx, dz); body.standIn = Math.max(body.standIn || 0, 4); }
    const [head, line] = greetingFor(body, world, rec);
    body._regGreetedAt = st.hour;
    world.notify?.(head, line);
  }
}
