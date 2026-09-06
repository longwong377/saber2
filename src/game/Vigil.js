/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE CHAPEL VIGIL, AND THE FUNERAL — V18 cool 7 and 14
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"Your company's names on the memorial wall read aloud at the chapel
 * vigil"* and *"a funeral you can attend, with the man's bunk stripped
 * after."*
 *
 * At 20:00 station time, in #22 the Chapel on deck 40, the dead of the
 * player's own company are read out one at a time, `VIGIL.gap` seconds
 * apart: as the tannoy banner (`world.notify`) and as a line off the
 * officiant standing before the shrine. The names are the casualty list
 * `Company.keep` writes — the men with `fate: 'kia'` — and they are the SAME
 * strings #45's wall carries (`memorialRows`), because a wall and a reading
 * that disagreed about who died would be two lists of one company.
 *
 * A man who died in the last run and has not yet been buried (his designation
 * is not in `StationSave.funeralsDone`) makes the next vigil his funeral: two
 * bearers carry a covered litter in from the ring to the chapel front, the
 * officiant reads his name, designation and kills, the company's men present
 * stand in a row before the mats, and when the rite is over the fold records
 * it — with the bunk in #29 that is his, so the barracks builder strips the
 * bedding and puts an effects box on the frame the next time deck 44 is
 * built. The record is what makes it run once.
 *
 * EVERYTHING HERE MOVES BODIES THROUGH `StationLife`'s OWN MACHINERY, handed
 * in as `T` (`eventTools()`): `missionWalker` lays the walk from the ring to
 * the door, a line leg carries a bearer from the door to the front, and
 * `standHere` turns him into a standing body that `stepStanding` holds.
 * Nothing here rolls dice — the seed is the day and the man's designation.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PLACE, floorOf } from './StationPlan.js';
import { companyOf } from './StationBoards.js';
import { funeralsDone, markFuneral } from './StationSave.js';
import { lookFor } from './StationCast.js';

export const VIGIL = Object.freeze({
  /** Station hour the vigil begins, and how long the window stays open. */
  hour: 20, mins: 45,
  /** Seconds between one name and the next. */
  gap: 4,
  /** The rooms: the chapel, the barracks the bunk is in. */
  chapel: 22, barracks: 29,
  /** #29's bunk count — five bays, two sides, two levels (`StationKit.bunkhall`). */
  bunks: 20,
  /** How many kneelers walk in off the ring, and how many of the company. */
  kneelers: 4, mourners: 4,
  /** Where things stand in the chapel's own frame: the shrine is at local
   *  +Z (`darkdrum` puts it at `r - 1.8`), the door at −Z. */
  shrineZ: 7.2, officiantZ: 5.2, litterZ: 3.6, rowZ: -0.6,
  /** Seconds of quiet after the last name before the room is let go — a
   *  vigil is kept, not announced, so the room stays a minute in silence. */
  tail: 60,
});

/** A string to a small integer — the shape `StationEvents.hashStr` has. */
function hashStr(s) {
  let h = 7;
  for (let i = 0; i < String(s).length; i++) h = (Math.imul(h, 31) + String(s).charCodeAt(i)) | 0;
  return h >>> 0;
}

/** How a dead man is named — his designation and what he answered to. */
export function deadName(f) {
  if (!f) return '';
  const called = f.callsign || f.nickname;
  return called ? `${f.designation} "${called}"` : String(f.designation);
}

/**
 * THE ROLL OF THE DEAD: the company's casualty list, the men killed in
 * action. A man `left` behind is on #45's reading too, but he was not killed
 * and a vigil does not read him — see `Company.FATES`.
 */
export function rollOfTheDead(co = null) {
  let c = co;
  if (!c) { try { c = companyOf(); } catch { c = null; } }
  return (c?.fallen || []).filter((f) => f && typeof f.designation === 'string' && (f.fate ?? 'kia') === 'kia');
}

/** Which of #29's twenty bunks was this man's. Off his designation, so it is
 *  the same bunk on every visit and in every check. */
export function bunkOf(designation) {
  return hashStr(designation) % VIGIL.bunks;
}

/** The first dead man nobody has buried yet, or null. */
export function funeralDue(co = null) {
  const done = new Set(funeralsDone().map((f) => f?.designation));
  return rollOfTheDead(co).find((f) => !done.has(f.designation)) || null;
}

/** `{ bunk → designation }` for the barracks builder: the bunks to strip. */
export function strippedBunks() {
  const out = new Map();
  for (const f of funeralsDone()) if (f && typeof f.designation === 'string') out.set(f.bunk | 0, f.designation);
  return out;
}

/**
 * THE WALL'S TEXT — #45's seven panels, one column of names each. The same
 * `deadName` the vigil reads, in the same order, so the wall and the reading
 * are one list. A panel with nobody on it is blank rather than padded.
 */
export function memorialRows(panels = 7, co = null) {
  const names = rollOfTheDead(co).map(deadName);
  const per = Math.max(1, Math.ceil(names.length / panels));
  const out = [];
  for (let i = 0; i < panels; i++) out.push(names.slice(i * per, (i + 1) * per));
  return out;
}

/* ── the chapel's frame ─────────────────────────────────────────────────── */

function toWorld(p, lx, lz, out = { x: 0, z: 0 }) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  out.x = p.x + lx * c + lz * s;
  out.z = p.z - lx * s + lz * c;
  return out;
}

/** The bearing a body at (x, z) faces to look at the shrine. */
function faceShrine(p, x, z) {
  const S = toWorld(p, 0, VIGIL.shrineZ);
  return Math.atan2(S.x - x, S.z - z);
}

/** Turn a walker into a standing body at a world point, facing `face`. */
function standAt(T, body, p, x, z, face) {
  body.wayR = 0; body.wayLegs = null; body.wayDwell = 0;
  body.position.x = x; body.position.z = z; body.position.y = floorOf(p) + 0.1;
  body.body?.setTransform?.(body.position, null);
  if (body.velocity) body.velocity.set(0, 0, 0);
  body.stillIn = true;
  T.standHere(body, p, body.position);
  body.facing = face; body.standFace = face;
  body.wayMission = { stand: true };
}

/** A straight leg from where a walker is to a world point. */
function lineTo(body, x1, z1) {
  const x0 = body.position.x, z0 = body.position.z;
  body.wayLegs = [{ line: true, x0, z0, x1, z1, len: Math.hypot(x1 - x0, z1 - z0) }];
  body.wayAt = 0; body.wayT = 0; body.wayDwell = 0;
}

/** Walk somebody in off the ring: to the door by `missionWalker`, then a
 *  straight leg to a point in the room, then stand there facing the shrine. */
function bringIn(world, st, life, T, key, type, dest, p, side, lx, lz, look, opts, onStand = null) {
  const a = dest.a + side * (0.12 + 0.03 * (opts.k | 0));
  const r = T.RING_WALK + ((opts.k | 0) % 3 - 1) * 0.6;
  const at = toWorld(p, lx, lz);
  const face = opts.face ?? faceShrine(p, at.x, at.z);
  const mission = {
    arrive: (b) => {
      lineTo(b, at.x, at.z);
      b.wayMission = {
        arrive: (bb) => { standAt(T, bb, p, at.x, at.z, face); onStand?.(bb); },
      };
    },
  };
  return T.missionWalker(world, st, life, key, type, { x: r * Math.sin(a), z: r * Math.cos(a) }, dest, mission, look, opts);
}

/* ── the vigil itself ───────────────────────────────────────────────────── */

function vigilOf(life) {
  return life.vigil || (life.vigil = {
    on: false, day: -1, t: 0, next: 0, i: 0, lines: [], keys: [], held: [],
    funeral: null, litter: null, rite: false, done: false, read: 0, ends: 0,
  });
}

function say(world, V, life, head, line) {
  world.notify?.(head, line);
  const off = life.live.get('vigil:officiant');
  if (off) {
    /* The bark: on his plate (`HUD` prints `stationRole` under the name) and
     * on the body for anything that listens. */
    off.stationRole = line;
    off.stationBark = { text: line, until: V.t + VIGIL.gap };
  }
  V.read++;
}

function begin(world, st, life, T) {
  const V = vigilOf(life);
  const p = PLACE.get(VIGIL.chapel);
  const dest = T.destsOn(life.deck).find((d) => d.id === p.id);
  if (!p || !dest) return false;
  V.on = true; V.day = st.day | 0; V.t = 0; V.next = 0; V.i = 0; V.rite = false; V.done = false; V.read = 0; V.ends = 0;
  V.keys.length = 0; V.held.length = 0;
  const dead = rollOfTheDead();
  V.lines = dead.map(deadName);
  V.funeral = funeralDue();
  V.litter = null;

  /* THE OFFICIANT, before the shrine, facing the mats. */
  const O = toWorld(p, 0, VIGIL.officiantZ);
  try {
    const body = world.spawnEnemy?.('res_human', new THREE.Vector3(O.x, floorOf(p) + 0.1, O.z), {
      team: world.player?.team ?? 0, person: lookFor('vigil:officiant', 'human', 1),
    });
    if (body) {
      body.team = world.player?.team ?? 0;
      body.stationResident = true; body.noAmbientHarm = true;
      body.stationName = 'the officiant'; body.stationRole = 'chaplain'; body.stationSpecies = 'human';
      body.stationPlace = p.id; body.stationSlot = 0;
      if (body.brain) body.brain.idle = true;
      standAt(T, body, p, O.x, O.z, p.yaw + Math.PI);
      life.live.set('vigil:officiant', body);
      V.keys.push('vigil:officiant');
    }
  } catch { /* no body is a vigil with no voice; the banner still reads */ }

  /* KNEELERS OFF THE RING, onto the mats, facing the shrine. */
  const KINDS = ['human', 'minbari', 'narn', 'centauri'];
  for (let k = 0; k < VIGIL.kneelers; k++) {
    const key = `vigil:kneel:${k}`;
    const lx = ((k % 2) ? 1 : -1) * (0.9 + 0.9 * (k >> 1)), lz = -1.5 + 1.0 * (k % 2);
    const species = KINDS[k % KINDS.length];
    const b = bringIn(world, st, life, T, key, `res_${species}`, dest, p, (k % 2) ? 1 : -1, lx, lz,
      lookFor(`vigil:${V.day}:${k}`, species, 1), { name: 'somebody come to the vigil', role: 'visitor', species, pace: 0.9, k })
      || bringIn(world, st, life, T, key, 'res_human', dest, p, (k % 2) ? 1 : -1, lx, lz, null,
        { name: 'somebody come to the vigil', role: 'visitor', pace: 0.9, k });
    if (b) V.keys.push(key);
  }

  /* THE FUNERAL: the litter and its two bearers, and the company in a row. */
  const F = V.funeral;
  if (F && world.netMode !== 'client') {
    const nameF = deadName(F);
    const co = companyOf();
    const men = (co?.men || []).filter((m) => m && m.alive !== false).slice(0, VIGIL.mourners + 2);
    const bearerName = (i) => (men[i] ? (men[i].designation) : `bearer ${i + 1}`);
    let standing = 0;
    const onStand = () => { standing++; if (standing >= 2) V.rite = true; };
    const front = bringIn(world, st, life, T, 'vigil:bearer:a', 'res_borz_crew', dest, p, -1, 0, VIGIL.litterZ,
      lookFor(`b:${bearerName(0)}`, 'human', 1), { name: bearerName(0), role: 'trooper', pace: 0.7, k: 0 }, onStand);
    const back = bringIn(world, st, life, T, 'vigil:bearer:b', 'res_borz_crew', dest, p, -1, 0, VIGIL.litterZ - 1.8,
      lookFor(`b:${bearerName(1)}`, 'human', 1), { name: bearerName(1), role: 'trooper', pace: 0.7, k: 0 }, onStand);
    if (front && back) {
      /* The back bearer walks a step behind on the same line. */
      back.wayAngle = front.wayAngle + 0.022; back.wayR = front.wayR;
      back.wayLegs = null;
      {
        const legs = [];
        T.radLeg(legs, back.wayAngle, back.wayR, T.RING_WALK);
        const a1 = T.arcLeg(legs, T.RING_WALK, back.wayAngle, dest.a);
        T.radLeg(legs, a1, T.RING_WALK, dest.r + 1.6);
        back.wayLegs = legs; back.wayAt = 0; back.wayT = 0;
      }
      back.wayPace = front.wayPace;
      V.keys.push('vigil:bearer:a', 'vigil:bearer:b');
      const mesh = T.buildLitter(world, F);
      (life.litters || (life.litters = [])).push({ front, back, mesh, man: F });
      V.litter = mesh;
      world.notify?.('THE CHAPEL', `a funeral — ${nameF} is carried in from the ring`);
    } else {
      /* No bearers means no rite tonight; the man stays due. */
      if (front) { T.removeBody(world, front); life.live.delete('vigil:bearer:a'); }
      if (back) { T.removeBody(world, back); life.live.delete('vigil:bearer:b'); }
      V.funeral = null;
    }
    /* THE COMPANY'S MEN, in a row before the mats. */
    if (V.funeral) {
      const row = men.slice(2, 2 + VIGIL.mourners);
      for (let k = 0; k < row.length; k++) {
        const m = row[k];
        const key = `vigil:man:${m.designation}`;
        const b = bringIn(world, st, life, T, key, 'res_borz_crew', dest, p, 1, (k - (row.length - 1) / 2) * 1.2, VIGIL.rowZ,
          lookFor(`w:${m.designation}`, 'human', 1), { name: m.designation, role: 'trooper', pace: 0.8, k: k + 1 });
        if (b) V.keys.push(key);
      }
    }
  }
  if (!V.funeral) world.notify?.('THE CHAPEL', V.lines.length ? 'the vigil — the names are read at the shrine' : 'the vigil — no name of yours to read');
  return true;
}

function end(world, life, T) {
  const V = vigilOf(life);
  for (const key of V.keys) {
    const b = life.live.get(key);
    if (b) { T.removeBody(world, b); life.live.delete(key); }
  }
  V.keys.length = 0;
  for (const b of V.held) if (b) b.standStill = false;
  V.held.length = 0;
  V.on = false; V.litter = null; V.rite = false;
}

/**
 * ONE FRAME. Deck 40 only, off the station clock: opens the vigil at 20:00
 * once a day, reads a name every `gap` seconds, runs the rite when the
 * litter has been set down, and lets the room go when the last name has had
 * its silence.
 */
export function stepVigil(world, st, life, dt, T) {
  if (!st || !life || life.deck !== 40 || !(dt > 0)) return;
  const V = vigilOf(life);
  const hour = Number(st.hour) || 0;
  const open = hour >= VIGIL.hour && hour < VIGIL.hour + VIGIL.mins / 60;
  if (!V.on) {
    if (open && V.day !== (st.day | 0) && world.netMode !== 'client') begin(world, st, life, T);
    return;
  }
  V.t += dt;
  const p = PLACE.get(VIGIL.chapel);
  /* THE ROOM FACES THE MEMORIAL. Everybody standing in #22 — the pool's own
   * kneelers and the ones this file walked in — turns to the shrine and
   * stays turned; `stepStanding` lerps `facing` onto `standFace` and
   * `posture` will not roll a shuffle on a `standStill` body. */
  for (const body of life.live.values()) {
    if (!body || body.stationPlace !== p.id || body.wayR || body.standX === undefined) continue;
    if (body.dead || body.alive === false || body.stationName === 'the officiant') continue;
    if (!body.standStill) { body.standStill = true; V.held.push(body); }
    body.standTx = body.standCx; body.standTz = body.standCz;
    body.standFace = faceShrine(p, body.standCx, body.standCz);
  }
  /* THE READING. A funeral waits for the litter; a plain vigil starts at once. */
  const waiting = V.funeral && !V.rite;
  if (!waiting && !V.done && V.t >= V.next) {
    if (V.funeral && V.i === 0 && V.read === 0) {
      const F = V.funeral;
      say(world, V, life, 'THE CHAPEL VIGIL', `${deadName(F)} — ${F.designation}, ${F.kills | 0} kill${(F.kills | 0) === 1 ? '' : 's'} — the company stands for him`);
      V.next = V.t + VIGIL.gap;
      /* His name is the one just read; the roll goes on from the others. */
      V.lines = V.lines.filter((n) => n !== deadName(F));
    } else if (V.i < V.lines.length) {
      say(world, V, life, 'THE CHAPEL VIGIL', V.lines[V.i]);
      V.i++;
      V.next = V.t + VIGIL.gap;
    } else {
      V.done = true;
      V.ends = V.t + VIGIL.tail;
      if (V.funeral) {
        const F = V.funeral;
        markFuneral(F.designation, bunkOf(F.designation), st.day | 0);
        world.notify?.('THE CHAPEL', `${deadName(F)} is at rest — his bunk in #29 is stripped tonight`);
        V.funeral = null;
      }
    }
  }
  /* A funeral whose litter never arrives is not held: the man stays due. */
  if (waiting && V.t > 120) { V.funeral = null; }
  if ((V.done && V.t >= V.ends) || !open) end(world, life, T);
}
