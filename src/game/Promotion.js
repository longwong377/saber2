/**
 * ══════════════════════════════════════════════════════════════════════════
 *  PROMOTIONS AT THE MUSTER, AND REFUSALS — V19 addition 3
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"Company men have names and fates but no arc"* (V19 hole 5). Two things
 * give them one, and both are read off the roll `Company.js` already keeps:
 *
 * ── (a) THE STRIPE ───────────────────────────────────────────────────────
 *
 * A man's rank is `rankFor(xp)` — it derives, it is never stored — so a man
 * who crossed a bar on the last run already HAS the rank; what he does not
 * have is anybody having said so. `promoted` on his record is the highest
 * rank that has been READ to the company. At 08:00 station time in #29 the
 * Company barracks (deck 44), every man whose rank is above his `promoted`
 * mark is mustered: the pool's men in the room form a line (the standing
 * machinery — `standTx/standTz` targets, `standStill`, `standFace`), the
 * promotee is spawned into the line if the pool does not have him (as
 * `Vigil.js` spawns its officiant), the sergeant reads the promotion
 * `MUSTER.gap` seconds apart (`world.notify` and a bark on his plate),
 * `Company.promote` writes the mark, and a stripe — a small emissive slab on
 * the upper arm, on the rig's `armL` bone — goes onto his body. The mark is
 * what makes it run once per rank, on any visit, however many times the world
 * is rebuilt.
 *
 * ── (b) THE REFUSAL ──────────────────────────────────────────────────────
 *
 * A man with a bad fate refuses the next sortie. `unfit(man, company)` reads
 * the flags the roll and the ward keep — wounded twice or more, a squad-mate
 * on the casualty list, morale under `NERVE`, still
 * hurt by `Medbay.FIT` — and answers a reason and a SIGNATURE of the facts
 * that only go up (wounds, the dead he knew) plus the two that can come and
 * go. `refusalsOf(company, day)` is the roster's door: `Muster.lineup` skips
 * a refuser and hands the line back on `.refused`, the Company tab prints it
 * on the slate, and the record is written (`Company.markRefusal`) so that the
 * refusal lasts the day it was made and no longer: the next day he is fit
 * again — for that fate. A NEW wound or a new grave is a new signature and a
 * new refusal. On deck 44 he stands in the barracks instead, and talking to
 * him gets the reason (`StationCast`'s `refusal` topic).
 *
 * Nothing here rolls a die. The seeds are the day and the designation.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PLACE, floorOf } from './StationPlan.js';
import { RANKS, rankFor, ARMY_IDS } from './Command.js';
import * as Company from './Company.js';
import { companyOf } from './StationBoards.js';
import { FIT } from './Medbay.js';
import { lookFor } from './StationCast.js';
import { note } from './Journal.js';

export const MUSTER = Object.freeze({
  /** Station hour the muster is called, and how long the window stays open. */
  hour: 8, mins: 30,
  /** Seconds between one promotion and the next. */
  gap: 4,
  /** The room. */
  barracks: 29,
  /** Where things stand in #29's own frame: the sergeant before the line,
   *  the line across the hall, the refusers by the far bunks. */
  sergeantZ: 1.6, lineZ: -0.9, lineStep: 1.15, refuserZ: 3.6, refuserX0: -9, refuserStep: 2.4,
  /** Seconds the line is held after the last stripe. */
  tail: 20,
  /** The stripe on the arm. */
  stripe: { w: 0.055, h: 0.045, d: 0.095, up: 0.13, out: 0.045 },
});

/** Morale under this and a man's nerve is gone. */
export const NERVE = 0.35;

/* ── (a) who is due a stripe ─────────────────────────────────────────────── */

/** The men whose rank is above the rank last read to the company. */
export function promotionsDue(co = null) {
  let c = co;
  if (!c) { try { c = companyOf(); } catch { c = null; } }
  return (c?.men || []).filter((m) => m && m.alive !== false && rankFor(m.xp | 0) > (m.promoted | 0));
}

/** The line the sergeant reads for one man. */
export function promotionLine(m) {
  const r = RANKS[rankFor(m.xp | 0)];
  return `${Company.nameOf(m)} — ${r.title}. ${m.kills | 0} kill${(m.kills | 0) === 1 ? '' : 's'}, ${m.runs | 0} run${(m.runs | 0) === 1 ? '' : 's'}. The company stands for him.`;
}

/** Which army a company record is — by its first man, as `StationLife` does. */
export function armyOf(co) {
  if (co?.army && ARMY_IDS.includes(co.army)) return co.army;
  const first = co?.men?.[0]?.designation;
  for (const a of ARMY_IDS) if (Company.load(a).men.some((m) => m.designation === first)) return a;
  return null;
}

/**
 * THE STRIPE ON HIS ARM: a small emissive slab on the upper-arm bone. Returns
 * the mesh, or null when the body has no rig. Idempotent — one stripe, the
 * highest rank's colour.
 */
export function addStripe(body, rank) {
  const r = RANKS[Math.max(0, Math.min(RANKS.length - 1, rank | 0))];
  const arm = body?.rig?.obj?.('armL') || null;
  if (!arm) return null;
  if (body.stripe) { body.stripe.parent?.remove(body.stripe); body.stripe.geometry?.dispose?.(); body.stripe = null; }
  const S = MUSTER.stripe;
  const mat = new THREE.MeshBasicMaterial({ color: r.color ?? 0xf0e8dc, toneMapped: false });
  mat.name = `station-sign-stripe-${r.short.toLowerCase()}`;
  mat.userData.key = 'sign';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(S.w, S.h, S.d), mat);
  mesh.name = `rank-stripe-${r.short}`;
  mesh.position.set(S.out, S.up, 0);
  arm.add(mesh);
  body.stripe = mesh;
  body.stripeRank = rank | 0;
  return mesh;
}

/* ── (b) who refuses ─────────────────────────────────────────────────────── */

/**
 * UNFIT: WHY THIS MAN WILL NOT DROP — or null when he is fit. `sign` is the
 * signature of the facts;
 * see the header for which of them only go up.
 */
export function unfit(m, co = null) {
  if (!m) return null;
  /* THE DEAD OF HIS SQUAD. Bonds settle among the living (`Company.settleBonds`),
   * so a dead partner's bond is gone by the time the roll is read; the
   * fallen record carries the squad he died in instead. */
  const buried = m.squad != null
    ? (co?.fallen || []).filter((f) => f && f.squad === m.squad && f.designation !== m.designation).map((f) => f.designation) : [];
  const wounds = m.wounds | 0;
  const nerve = Number.isFinite(m.morale) && m.morale < NERVE;
  const hurt = Number.isFinite(m.hp) && m.hp < FIT;
  const why = [];
  if (buried.length) why.push(buried.length === 1 ? `he buried ${buried[0]} yesterday` : `he buried ${buried.length} of his squad`);
  if (wounds >= 2) why.push(`he has been wounded ${wounds === 2 ? 'twice' : `${wounds} times`}`);
  if (hurt) why.push('he is still hurt');
  if (nerve) why.push('his nerve is gone');
  if (!why.length) return null;
  return {
    why: why.join(' and '),
    sign: `${wounds}|${buried.length}|${nerve ? 'm' : ''}${hurt ? 'h' : ''}`,
  };
}

/** The line the launch panel prints for a refusal. */
export function refusalLine(m, fate) {
  return `${Company.nameOf(m)} refused the drop — ${fate.why}`;
}

/**
 * WHO REFUSES TODAY: `[{ designation, name, why, line, day }]`. A refusal is
 * written to the roll the first time it is made (`Company.markRefusal`) and
 * holds for the day; a day later, for the same fate, he is fit again.
 * `opts.write === false` reads without writing (the tab's redraw).
 */
export function refusalsOf(co, day = 0, opts = {}) {
  const out = [];
  if (!co) return out;
  const army = opts.write === false ? null : armyOf(co);
  for (const m of (co.men || [])) {
    if (!m || m.alive === false) continue;
    const F = unfit(m, co);
    if (!F) continue;
    const R = m.refused;
    if (R && R.sign === F.sign && (R.day | 0) < (day | 0)) continue;
    if (!R || R.sign !== F.sign) {
      m.refused = { day: day | 0, sign: F.sign };
      if (army) Company.markRefusal(army, m.designation, m.refused);
    }
    out.push({ designation: m.designation, name: Company.nameOf(m), why: F.why, line: refusalLine(m, F), day: day | 0 });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CEREMONY                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

function toWorld(p, lx, lz, out = { x: 0, z: 0 }) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  out.x = p.x + lx * c + lz * s;
  out.z = p.z - lx * s + lz * c;
  return out;
}

function musterOf(life) {
  return life.muster || (life.muster = {
    on: false, day: -1, t: 0, next: 0, i: 0, due: [], keys: [], held: [], done: false, ends: 0, read: 0,
    refusersUp: -1, refusers: [],
  });
}

/** Spawn one of the company standing at a world point in #29, facing `face`. */
function standMan(world, life, T, p, key, name, look, x, z, face, role = 'trooper') {
  let body = null;
  try {
    body = world.spawnEnemy?.('res_borz_crew', new THREE.Vector3(x, floorOf(p) + 0.1, z), {
      team: world.player?.team ?? 0, person: look,
    });
  } catch { body = null; }
  if (!body) return null;
  body.team = world.player?.team ?? 0;
  body.stationResident = true; body.noAmbientHarm = true;
  body.stationName = name; body.stationRole = role; body.stationSpecies = 'human';
  body.stationPlace = p.id; body.stationSlot = 0;
  if (body.brain) body.brain.idle = true;
  body.wayR = 0; body.wayLegs = null; body.wayDwell = 0;
  body.position.x = x; body.position.z = z; body.position.y = floorOf(p) + 0.1;
  body.body?.setTransform?.(body.position, null);
  if (body.velocity) body.velocity.set(0, 0, 0);
  body.stillIn = true;
  T.standHere(body, p, body.position);
  body.facing = face; body.standFace = face;
  body.wayMission = { stand: true };
  life.live.set(key, body);
  return body;
}

function say(world, M, life, line) {
  world.notify?.('THE MUSTER', line);
  const sgt = life.live.get('muster:sergeant');
  if (sgt) { sgt.stationRole = line; sgt.stationBark = { text: line, until: M.t + MUSTER.gap }; }
  M.read++;
}

function begin(world, st, life, T) {
  const M = musterOf(life);
  const p = PLACE.get(MUSTER.barracks);
  if (!p) return false;
  const co = (() => { try { return companyOf(); } catch { return null; } })();
  const due = promotionsDue(co);
  M.on = true; M.day = st.day | 0; M.t = 0; M.next = MUSTER.gap; M.i = 0; M.done = false; M.ends = 0; M.read = 0;
  M.due = due.map((m) => ({ m, key: `muster:man:${m.designation}` }));
  M.army = armyOf(co);
  M.keys.length = 0; M.held.length = 0;
  if (!due.length) { M.on = false; return false; }

  /* THE SERGEANT, before the line, facing it. */
  const S = toWorld(p, 0, MUSTER.sergeantZ);
  const faceLine = Math.atan2(toWorld(p, 0, MUSTER.lineZ).x - S.x, toWorld(p, 0, MUSTER.lineZ).z - S.z);
  if (standMan(world, life, T, p, 'muster:sergeant', 'the sergeant', lookFor('muster:sergeant', 'human', 1), S.x, S.z, faceLine, 'sergeant')) {
    M.keys.push('muster:sergeant');
  }

  /* THE LINE: the pool's men in the room first, then the promotees, spawned
   * if the pool does not have them. Everybody faces the sergeant. */
  const faceSgt = (x, z) => Math.atan2(S.x - x, S.z - z);
  const present = [...life.live.values()].filter((b) => b && b.stationPlace === p.id && b.standX !== undefined
    && !b.wayR && !b.seat && !b.dead && b.alive !== false && b.stationName !== 'the sergeant');
  const n = present.length + M.due.length;
  const lx0 = -((n - 1) / 2) * MUSTER.lineStep;
  let k = 0;
  for (const b of present) {
    const at = toWorld(p, lx0 + k * MUSTER.lineStep, MUSTER.lineZ);
    b.standTx = at.x; b.standTz = at.z;
    b.standFace = faceSgt(at.x, at.z);
    if (!b.standStill) { b.standStill = true; M.held.push(b); }
    k++;
  }
  for (const d of M.due) {
    const at = toWorld(p, lx0 + k * MUSTER.lineStep, MUSTER.lineZ);
    const b = standMan(world, life, T, p, d.key, Company.nameOf(d.m), lookFor(`w:${d.m.designation}`, 'human', 1), at.x, at.z, faceSgt(at.x, at.z));
    if (b) { M.keys.push(d.key); if ((d.m.promoted | 0) > 0) addStripe(b, d.m.promoted | 0); }
    k++;
  }
  world.notify?.('THE MUSTER', `08:00 — the company falls in; ${due.length} promotion${due.length === 1 ? '' : 's'} to read`);
  return true;
}

function end(world, life, T) {
  const M = musterOf(life);
  for (const key of M.keys) {
    const b = life.live.get(key);
    if (b) { T.removeBody(world, b); life.live.delete(key); }
  }
  M.keys.length = 0;
  for (const b of M.held) if (b) { b.standStill = false; b.standTx = b.standX; b.standTz = b.standZ; }
  M.held.length = 0;
  M.on = false;
}

/**
 * THE REFUSERS STAND IN THE BARRACKS: once per world on deck 44, today's
 * refusers are spawned by the far bunks with their reason on their plate.
 */
function standRefusers(world, st, life, T) {
  const M = musterOf(life);
  if (M.refusersUp === (st.day | 0)) return;
  M.refusersUp = st.day | 0;
  const p = PLACE.get(MUSTER.barracks);
  const co = (() => { try { return companyOf(); } catch { return null; } })();
  if (!p || !co) return;
  const list = refusalsOf(co, st.day | 0);
  M.refusers = list;
  let k = 0;
  for (const r of list) {
    const key = `muster:refused:${r.designation}`;
    if (life.live.has(key)) continue;
    const m = co.men.find((x) => x.designation === r.designation);
    const at = toWorld(p, MUSTER.refuserX0 + k * MUSTER.refuserStep, MUSTER.refuserZ);
    const b = standMan(world, life, T, p, key, r.name, lookFor(`w:${r.designation}`, 'human', 1), at.x, at.z, p.yaw + Math.PI, r.why);
    if (b) {
      b.stationRefusal = `not today. ${r.why[0].toUpperCase()}${r.why.slice(1)}. Ask me tomorrow.`;
      if (m && (m.promoted | 0) > 0) addStripe(b, m.promoted | 0);
    }
    k++;
  }
}

/**
 * ONE FRAME. Deck 44 only, off the station clock: the muster at 08:00 once a
 * day reads the promotions due, `gap` seconds apart, writes each to the roll
 * and puts the stripe on; the refusers stand by the bunks all day.
 */
export function stepMuster(world, st, life, dt, T) {
  if (!st || !life || life.deck !== 44 || !(dt > 0) || world.netMode === 'client') return;
  standRefusers(world, st, life, T);
  const M = musterOf(life);
  const hour = Number(st.hour) || 0;
  const open = hour >= MUSTER.hour && hour < MUSTER.hour + MUSTER.mins / 60;
  if (!M.on) {
    if (open && M.day !== (st.day | 0)) { M.day = st.day | 0; begin(world, st, life, T); }
    return;
  }
  M.t += dt;
  if (!M.done && M.t >= M.next) {
    const d = M.due[M.i];
    if (d) {
      const rank = rankFor(d.m.xp | 0);
      say(world, M, life, promotionLine(d.m));
      if (M.army) Company.promote(M.army, d.m.designation, rank);
      d.m.promoted = rank;
      const b = life.live.get(d.key);
      if (b) addStripe(b, rank);
      note('muster', `${Company.nameOf(d.m)} made ${RANKS[rank].title} at the muster`, world);
      M.i++;
      M.next = M.t + MUSTER.gap;
    } else {
      M.done = true;
      M.ends = M.t + MUSTER.tail;
      world.notify?.('THE MUSTER', 'dismissed');
    }
  }
  if ((M.done && M.t >= M.ends) || !open) end(world, life, T);
}
