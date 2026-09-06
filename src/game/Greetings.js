/**
 * COMPANIONS GREETING EACH OTHER — V18 cool 18.
 *
 * *"Companions greeting each other; two massiffs meeting on the concourse."*
 * `StationLife` fields an animal at heel for the residents `Pits.handlerOf`
 * says have one, and each walks behind its own person and never notices
 * another. Two things here, both cheap and both off the bodies the pool
 * already owns:
 *
 *   THE ANIMALS. Two handlers' animals within `MEET.reach` of each other, on
 *   the same deck, and not met in the last `MEET.cool` seconds: the two
 *   trot to a point between them, circle each other once — a full turn of
 *   relative bearing, nose to tail — and their owners trade a bark
 *   (`StationCast.barkFor`, the same voice the talk key gets). Then the
 *   brains have them back and they go to heel. One meeting at a time; the
 *   positions are written after the bodies have stepped, so nothing fights.
 *
 *   THE PEOPLE. Two walkers who know each other — the same quarter
 *   (`homeFor`) and a seeded coin — passing within `NOD.reach` on a walkway
 *   each raise the near arm for `NOD.secs`: one arm, IK'd on the rig after
 *   the gait has written it (`Rig.solveIK` on `arm`/`fore`, blended by a
 *   slerp back to the gait's pose), and one line between them.
 *
 * Nothing rolls: the coin is a hash of the pair, the choreography is a
 * function of the meeting clock.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { barkFor, homeFor, residentLine } from './StationCast.js';
import { stationDay, stationHour } from './StationSave.js';
import { PLACE } from './StationPlan.js';
import { clamp, TAU } from '../engine/MathUtil.js';

export const MEET = { reach: 14, cool: 120, approach: 2.4, circleR: 1.15, circleSecs: 5.0, partSecs: 1.6 };
export const NOD = { reach: 2.0, secs: 0.8, cool: 60 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The record `barkFor` wants, off what the pool wrote on a body — `Station.whoOfBody`'s shape. */
function whoOf(body) {
  if (!body?.stationName) return null;
  const species = body.stationSpecies || 'human';
  const role = body.stationRole || 'visitor';
  let home = 38;
  try { home = homeFor(species, role); } catch { home = 38; }
  return {
    seed: (body.stationPlace != null && body.stationSlot != null) ? `p${body.stationPlace}s${body.stationSlot}` : String(body.stationName),
    name: body.stationName, species, role, faction: body.stationFaction || 'merchants', home,
  };
}

function state(world) {
  return world._greetings || (world._greetings = {
    time: 0, meet: null, cool: new Map(), waves: [], nodCool: new Map(),
    /** Ledger for the checks. */
    meetings: 0, nods: 0, last: null, lastNod: null, scan: 0,
    state: () => greetingsState(world),
  });
}

const alive = (b) => b && !b.dead && b.alive !== false && !b.disposed && b.position;
const key2 = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const idOf = (b) => `${b.stationPlace}:${b.stationSlot}:${b.stationName}`;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ANIMALS                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

function findMeeting(world, life, G) {
  const pets = [];
  for (const owner of life.live.values()) {
    const pet = owner?._stationAnimal;
    if (!alive(owner) || !alive(pet)) continue;
    pets.push({ owner, pet });
  }
  for (let i = 0; i < pets.length; i++) {
    for (let j = i + 1; j < pets.length; j++) {
      const A = pets[i], B = pets[j];
      const dx = A.pet.position.x - B.pet.position.x, dz = A.pet.position.z - B.pet.position.z;
      if (Math.abs(A.pet.position.y - B.pet.position.y) > 3) continue;
      if (dx * dx + dz * dz > MEET.reach * MEET.reach) continue;
      const k = key2(idOf(A.owner), idOf(B.owner));
      if ((G.cool.get(k) ?? -1e9) + MEET.cool > G.time) continue;
      G.cool.set(k, G.time);
      return startMeeting(A, B, k);
    }
  }
  return null;
}

function startMeeting(A, B, key) {
  const cx = (A.pet.position.x + B.pet.position.x) / 2;
  const cz = (A.pet.position.z + B.pet.position.z) / 2;
  const y = (A.pet.position.y + B.pet.position.y) / 2;
  /* Where each arrives on the circle: A on its own side, B opposite. */
  const a0 = Math.atan2(A.pet.position.x - cx, A.pet.position.z - cz);
  return {
    key, a: A.pet, b: B.pet, ownerA: A.owner, ownerB: B.owner,
    cx, cz, y, a0, t: 0, phase: 'approach', circleT: 0, sweep: 0, lastRel: null,
    barks: [], said: 0,
  };
}

/** Move a body to (x, z) at a pace, and face the way it went. */
function walkTo(body, x, z, y, pace, dt) {
  const p = body.position;
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  const step = Math.min(d, pace * dt);
  if (d > 1e-4) {
    p.x += dx / d * step; p.z += dz / d * step;
    body.facing = Math.atan2(dx, dz);
    if (body.rotation) body.rotation.y = body.facing;
    body.velocity?.set(dx / d * pace, 0, dz / d * pace);
  } else body.velocity?.set(0, 0, 0);
  p.y = y;
  body.body?.setTransform?.(p, null);
  return d - step;
}

function placeOn(body, x, z, y, facing, speed) {
  const p = body.position;
  p.x = x; p.z = z; p.y = y;
  body.facing = facing;
  if (body.rotation) body.rotation.y = facing;
  body.velocity?.set(Math.sin(facing) * speed, 0, Math.cos(facing) * speed);
  body.body?.setTransform?.(p, null);
}

function ownerBark(world, G, M, owner, other) {
  const who = whoOf(owner);
  const day = stationDay();
  const petName = other?._stationAnimal?.stationName || 'the other one';
  let said = null;
  if (who) {
    try {
      said = barkFor(who, day, { hour: world._station?.hour ?? stationHour(), place: owner.stationPlace != null ? PLACE.get(owner.stationPlace) : null,
        companion: owner._stationAnimal?.stationRole?.split(' —')[0] || null });
    } catch { said = null; }
  }
  if (!said) said = [String(who ? residentLine(who) : owner.stationName || 'A HANDLER').toUpperCase(), `${owner._stationAnimal?.stationName || 'mine'} likes ${petName}. That is rare`];
  M.barks.push(said);
  const pp = world.player?.position;
  if (pp && Math.hypot(pp.x - owner.position.x, pp.z - owner.position.z) < 30) world.notify?.(said[0], said[1]);
}

function stepMeeting(world, G, M, dt) {
  const { a, b } = M;
  if (!alive(a) || !alive(b) || !alive(M.ownerA) || !alive(M.ownerB)) return false;
  M.t += dt;
  /* The owners stand for it: their walk is held while the animals meet. */
  for (const o of [M.ownerA, M.ownerB]) {
    if (o.wayR && !(o.wayDwell > 0)) o.wayDwell = Math.max(o.wayDwell || 0, 0.2);
  }
  const R = MEET.circleR;
  if (M.phase === 'approach') {
    const ax = M.cx + Math.sin(M.a0) * R, az = M.cz + Math.cos(M.a0) * R;
    const bx = M.cx - Math.sin(M.a0) * R, bz = M.cz - Math.cos(M.a0) * R;
    const da = walkTo(a, ax, az, M.y, MEET.approach, dt);
    const db = walkTo(b, bx, bz, M.y, MEET.approach, dt);
    if ((da < 0.05 && db < 0.05) || M.t > 6) { M.phase = 'circle'; M.circleT = 0; }
    return true;
  }
  if (M.phase === 'circle') {
    M.circleT += dt;
    const k = clamp(M.circleT / MEET.circleSecs, 0, 1);
    const ang = M.a0 + k * TAU;
    /* Nose to tail: each faces along its own tangent. */
    const v = TAU * R / MEET.circleSecs;
    placeOn(a, M.cx + Math.sin(ang) * R, M.cz + Math.cos(ang) * R, M.y, ang + Math.PI / 2, v);
    placeOn(b, M.cx - Math.sin(ang) * R, M.cz - Math.cos(ang) * R, M.y, ang - Math.PI / 2, v);
    /* The relative bearing, accumulated, for the ledger. */
    const rel = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z);
    if (M.lastRel != null) M.sweep += Math.abs(Math.atan2(Math.sin(rel - M.lastRel), Math.cos(rel - M.lastRel)));
    M.lastRel = rel;
    if (M.said === 0 && k > 0.3) { M.said = 1; ownerBark(world, G, M, M.ownerA, M.ownerB); }
    if (M.said === 1 && k > 0.7) { M.said = 2; ownerBark(world, G, M, M.ownerB, M.ownerA); }
    if (k >= 1) { M.phase = 'part'; M.circleT = 0; }
    return true;
  }
  /* part: a beat, then the brains have them back. */
  M.circleT += dt;
  if (M.said < 2) { while (M.said < 2) { M.said++; ownerBark(world, G, M, M.said === 1 ? M.ownerA : M.ownerB, M.said === 1 ? M.ownerB : M.ownerA); } }
  return M.circleT < MEET.partSecs;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PEOPLE                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Two walkers who know each other, passing. */
function findNods(world, life, G) {
  const walkers = [];
  for (const b of life.live.values()) if (alive(b) && b.wayR && !(b.wayDwell > 0) && b.stationName && b.rig?.get?.('armR')) walkers.push(b);
  for (let i = 0; i < walkers.length; i++) {
    for (let j = i + 1; j < walkers.length; j++) {
      const A = walkers[i], B = walkers[j];
      const dx = A.position.x - B.position.x, dz = A.position.z - B.position.z;
      if (dx * dx + dz * dz > NOD.reach * NOD.reach || Math.abs(A.position.y - B.position.y) > 2) continue;
      const wa = whoOf(A), wb = whoOf(B);
      if (!wa || !wb || wa.home !== wb.home) continue;
      const k = key2(idOf(A), idOf(B));
      if (hashF(k, 'know') > 0.6) continue;
      if ((G.nodCool.get(k) ?? -1e9) + NOD.cool > G.time) continue;
      G.nodCool.set(k, G.time);
      /* The near arm: the side the other is on, in each one's own frame. */
      const sideOf = (me, other) => {
        const f = me.facing || 0;
        const lx = Math.cos(f), lz = -Math.sin(f);           // left
        return ((other.position.x - me.position.x) * lx + (other.position.z - me.position.z) * lz) >= 0 ? 'L' : 'R';
      };
      G.waves.push({ body: A, side: sideOf(A, B), t: 0 }, { body: B, side: sideOf(B, A), t: 0 });
      G.nods++;
      const said = [String(residentLine(wa)).toUpperCase(), `raises a hand to ${wb.name}`];
      G.lastNod = { a: wa.name, b: wb.name, said, at: G.time };
      const pp = world.player?.position;
      if (pp && Math.hypot(pp.x - A.position.x, pp.z - A.position.z) < 18) world.notify?.(said[0], said[1]);
      return;
    }
  }
}

/** One arm up, on the rig, after the gait. */
function poseWave(w, dt) {
  const b = w.body;
  const rig = b?.rig;
  if (!alive(b) || !rig?.get) return false;
  w.t += dt;
  if (w.t >= NOD.secs) return false;
  const side = w.side;
  const up = rig.get('arm' + side), fore = rig.get('fore' + side);
  if (!up || !fore) return false;
  const blend = Math.sin(clamp(w.t / NOD.secs, 0, 1) * Math.PI);
  const s = rig.scale ?? 1;
  const f = b.facing || 0;
  const sx = side === 'L' ? 1 : -1;
  const fx = Math.sin(f), fz = Math.cos(f), lx = Math.cos(f), lz = -Math.sin(f);
  const o = b.position;
  const at = (px, py, pz, out) => out.set(o.x + (lx * px + fx * pz) * s, o.y + py * s, o.z + (lz * px + fz * pz) * s);
  _qa.copy(up.obj.quaternion); _qb.copy(fore.obj.quaternion);
  rig.solveIK('arm' + side, 'fore' + side, at(sx * 0.42, 1.62, 0.22, _a), at(sx * 0.75, 1.05, -0.25, _b));
  up.obj.quaternion.slerp(_qa, 1 - blend);
  fore.obj.quaternion.slerp(_qb, 1 - blend);
  rig.updateMatrices?.();
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

export function stepGreetings(world, life, dt) {
  if (!world || !life?.live || !(dt > 0)) return;
  const G = state(world);
  G.time += dt;
  /* The animals. */
  if (G.meet) {
    if (!stepMeeting(world, G, G.meet, dt)) {
      G.meetings++;
      G.last = { key: G.meet.key, sweep: G.meet.sweep, barks: G.meet.barks.slice(), a: G.meet.a?.stationName, b: G.meet.b?.stationName, at: G.time };
      G.meet = null;
    }
  } else {
    G.scan += dt;
    if (G.scan >= 0.5) { G.scan = 0; G.meet = findMeeting(world, life, G); }
  }
  /* The people. */
  findNods(world, life, G);
  for (let i = G.waves.length - 1; i >= 0; i--) if (!poseWave(G.waves[i], dt)) G.waves.splice(i, 1);
}

/** For the checks and the HUD — `world._greetings.state()`. */
function greetingsState(world) {
  const G = world?._greetings;
  if (!G) return null;
  return {
    meeting: G.meet ? { phase: G.meet.phase, t: G.meet.t, sweep: G.meet.sweep, barks: G.meet.barks.length } : null,
    meetings: G.meetings, last: G.last, nods: G.nods, lastNod: G.lastNod, waving: G.waves.length,
  };
}

export function undressGreetings(world) {
  if (!world) return;
  world._greetings = null;
}
