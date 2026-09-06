/**
 * ══ STATION EVENTS THAT ARE SEEN, NOT ANNOUNCED (V18) ══════════════════════
 *
 * `StationLife.EVENTS` is the table and `stepEvents` is the clock; every row
 * already fills a room, moves the people standing in it, dips the rig or
 * halts the tram. This file is what four of the rows DO on top of that — the
 * part a player standing in the room can watch happen:
 *
 *   BLACKOUT   (`surge`, field `black`): the deck's lights go to near-black
 *              for `black` real seconds and ramp back. Everybody standing
 *              stops and turns to the atrium void; everybody walking stops
 *              where they are. Two guards come onto the ring, one from each
 *              side of the player, each with a lit lamp in hand, and walk it.
 *   RAIN       (`rain`): a sheet of two hundred falling slabs inside #23's
 *              walls, recycled from the top of the cut to the floor, and
 *              `visit` residents walk the ring to the Arboretum's door and go
 *              in and stand in it.
 *   THE SPILL  (`drazifight`, field `spill`): two Drazi come out of #35 onto
 *              the ring and shove each other along it until a patrol of two
 *              reaches them, at which point they stand down.
 *   WEATHER    a per-day word and value on `st.weather`, seeded off the day
 *              and the theatre outside the window. `weatherAt` is the pure
 *              function; the Holonet's news can read `st.weather` or call it.
 *
 * ── THE RULES THIS FILE KEEPS ────────────────────────────────────────────
 *
 * NOTHING HERE ROLLS `Math.random`. Every number is `h2` off the slot, the
 * day or the frame's own clock, so two machines in one session see the same
 * two Drazi shove the same way.
 *
 * NOTHING HERE IS A SECOND WALKER OR A SECOND POOL. A body this file makes
 * is keyed into `life.live` with a `wayMission`, which is the flag `reseat`
 * already uses to keep its hands off a body on an errand; the Arboretum's
 * visitors are `missionWalker`s and arrive through `stepWalkers`. The
 * helpers come in through `T` — `StationLife`'s own `setOut`, `removeBody`,
 * `standHere`, `missionWalker` and the ring's leg builders — rather than
 * through a second import of that file, which would be a cycle.
 *
 * EVERYTHING OWNS ITS OWN END. Each effect ends when its row is no longer
 * the running one, whichever way the row stopped — `calm`, a check that
 * cleared `life.event` by hand, or a deck change — so nothing lingers on a
 * deck the row has left.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PLACE, DRUM, DECK_Y, floorOf, apronOn } from './StationPlan.js';
import { disarmKinetic } from './Impact.js';

/** The same stable 0..1 from two integers `StationLife` uses. */
function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A string to a small integer, for seeding the weather off a theatre's name. */
function hashStr(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WEATHER ON THE PLANET BELOW                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The eight words the sky below can be, and the band of degrees each runs. */
export const WEATHER = [
  { word: 'clear', lo: 12, hi: 34 },
  { word: 'high cloud', lo: 8, hi: 28 },
  { word: 'overcast', lo: 2, hi: 20 },
  { word: 'rain', lo: 4, hi: 18 },
  { word: 'storm', lo: 6, hi: 24 },
  { word: 'dust', lo: 20, hi: 41 },
  { word: 'fog', lo: -2, hi: 12 },
  { word: 'snow', lo: -18, hi: 1 },
];

/**
 * The weather over the theatre on a station day. Pure, and the same answer
 * for the same day and name on every machine — the Holonet reads it for the
 * news, the station stamps it on `st.weather` once a day.
 */
export function weatherAt(day, theatre) {
  const d = day | 0;
  const t = hashStr(String(theatre || 'the line'));
  const W = WEATHER[Math.floor(h2(d + 101, t) * WEATHER.length) % WEATHER.length];
  const value = Math.round(W.lo + h2(d + 211, t ^ 0x5bd1) * (W.hi - W.lo));
  return { day: d, theatre: String(theatre || 'the line'), word: W.word, value, unit: '°C', line: `${W.word}, ${value}°` };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STATE, HUNG ON `life.ev`                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

function evOf(life) {
  return life.ev || (life.ev = {
    /** Seconds of near-black left, and how long the black was. */
    black: 0, blackT: 0, lamps: [],
    /** The Arboretum's sheet and the people who went to stand in it. */
    rain: null, visitors: [],
    /** The Drazi on the ring, and the patrol on its way to them. */
    brawl: null,
    /** Which day `st.weather` was stamped for. */
    weatherDay: null, weatherFor: null,
  });
}

/** Take a body this file made out of the pool and out of the world. */
function drop(world, life, T, key) {
  const b = life.live.get(key);
  if (b) { T.removeBody(world, b); life.live.delete(key); }
}

/** Spawn a body this file drives itself: keyed, on an errand, off the pool. */
function ownBody(world, life, T, key, type, x, z, opts = {}) {
  if (world.netMode === 'client' || !world.spawnEnemy) return null;
  const deck = life.deck;
  _v.set(x, (DECK_Y[deck] ?? 0) + 0.1, z);
  let b = null;
  try {
    b = world.spawnEnemy(type, _v.clone(), { team: world.player?.team ?? 0, person: opts.look || null, armour: opts.armour || undefined });
  } catch { return null; }
  if (!b) return null;
  b.team = world.player?.team ?? 0;
  b.stationResident = true;
  b.noAmbientHarm = true;
  b.stationName = opts.name || key;
  b.stationRole = opts.role || 'visitor';
  b.stationSpecies = opts.species || 'human';
  b.stationPlace = opts.place ?? 0;
  b.stationSlot = 0;
  /* On the ring, held there by `stepWalkers`' wait branch; this file writes
   * the position after it every frame. */
  b.wayAngle = Math.atan2(x, z);
  b.wayR = Math.hypot(x, z);
  b.wayPace = 1;
  b.wayLegs = [];
  b.wayAt = 0; b.wayT = 0; b.wayTo = 0; b.wayTrips = 0; b.wayDwell = 0;
  b.wayMission = { wait: () => true };
  if (b.brain) b.brain.idle = true;
  disarmKinetic(b.body);
  life.live.set(key, b);
  return b;
}

/** Put a driven body at a ring bearing and give the gait its velocity. */
function placeOnRing(b, deck, a, r, dt, face = null) {
  const x = r * Math.sin(a), z = r * Math.cos(a);
  const p = b.position;
  if (!p) return;
  const dx = x - p.x, dz = z - p.z;
  p.x = x; p.z = z; p.y = (DECK_Y[deck] ?? 0) + 0.1;
  b.body?.setTransform?.(p, null);
  b.wayAngle = a; b.wayR = r;
  if (b.velocity && dt > 0) b.velocity.set(dx / dt, 0, dz / dt);
  b.facing = face ?? ((dx * dx + dz * dz) > 1e-8 ? Math.atan2(dx, dz) : b.facing);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  BLACKOUT                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/** How fast the lights go and how long they take to come back, real seconds. */
const BLACK = { down: 1.5, up: 4, lampY: 0.95, walk: 0.5 };

function beginBlackout(world, st, life, e, T) {
  const ev = evOf(life);
  ev.black = e.black; ev.blackT = e.black;
  if (apronOn(life.deck) || world.netMode === 'client') return;
  const p = world.player?.position;
  const a0 = p ? Math.atan2(p.x, p.z) : 0;
  const R = T.RING_WALK;
  for (let g = 0; g < 2; g++) {
    const side = g ? 1 : -1;
    const a = a0 + side * 0.4;
    const b = ownBody(world, life, T, `lamp:${g}`, 'res_human', R * Math.sin(a), R * Math.cos(a),
      { armour: T.GUARD_KIT, name: 'the watch', role: 'security', place: 24 });
    if (!b) continue;
    b.stationGuard = true;
    /* The lamp: a small lit slab, carried at hand height. `strip` is the
     * deck's own emissive material (§9.1: no new material for an event). */
    const mat = st.mats?.strip || new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.34), mat);
    lamp.name = `lamp-${g}`;
    world.scene.add(lamp);
    ev.lamps.push({ key: `lamp:${g}`, body: b, mesh: lamp, dir: -side, a });
  }
}

function endBlackout(world, life, T) {
  const ev = evOf(life);
  ev.black = 0;
  for (const L of ev.lamps) {
    L.mesh.parent?.remove(L.mesh);
    L.mesh.geometry?.dispose?.();
    drop(world, life, T, L.key);
  }
  ev.lamps.length = 0;
}

/**
 * The dip the blackout wants this frame, or null when there is none: down
 * to 1.0 over `BLACK.down`, held, and back to the surge's own level over the
 * last `BLACK.up` seconds. `stepDip` reads `ev.black` to drop its floor.
 */
export function blackoutDip(life, dim) {
  const ev = life.ev;
  if (!ev || !(ev.black > 0)) return null;
  const t = ev.blackT - ev.black;
  let k = Math.min(1, t / BLACK.down);
  k = Math.min(k, ev.black / BLACK.up);
  return dim + (1 - dim) * Math.max(0, k);
}

function stepBlackout(world, st, life, dt, T) {
  const ev = life.ev;
  if (!ev || !(ev.black > 0)) return;
  ev.black -= dt;
  if (ev.black <= 0) { endBlackout(world, life, T); return; }
  /* EVERYBODY STOPS AND LOOKS AT THE VOID. A stander's targets are its own
   * feet and its face is the atrium; a walker is held at its door (the dwell
   * branch pins it and zeroes its velocity) and turned the same way. */
  for (const b of life.live.values()) {
    if (!b?.position || b.wayMission || b.__stationTouched || b.alive === false || b.dead) continue;
    const x = b.position.x, z = b.position.z;
    const toVoid = Math.atan2(-x, -z);
    if (b.wayR) {
      b.wayDwell = Math.max(b.wayDwell || 0, BLACK.walk);
      b.facing = toVoid;
    } else if (b.standX !== undefined) {
      b.standTx = b.standCx; b.standTz = b.standCz;
      b.standFace = toVoid;
      b.standIn = Math.max(b.standIn, 1);
    }
  }
  /* THE WATCH WALKS THE RING, LAMPS IN HAND. */
  const R = T.RING_WALK;
  for (const L of ev.lamps) {
    const b = L.body;
    if (!b?.position || b.disposed) continue;
    L.a += L.dir * (T.GUARD_PACE * BLACK.walk) / R * dt;
    placeOnRing(b, life.deck, L.a, R, dt);
    const f = b.facing;
    L.mesh.position.set(
      b.position.x + Math.sin(f) * 0.3 + Math.cos(f) * 0.3,
      b.position.y + BLACK.lampY,
      b.position.z + Math.cos(f) * 0.3 - Math.sin(f) * 0.3);
    L.mesh.rotation.y = f;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  RAIN IN THE ARBORETUM                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

const RAIN = { n: 200, fall: { min: 7, span: 3 }, slab: [0.03, 0.7, 0.03] };

function beginRain(world, st, life, e, T) {
  const p = PLACE.get(e.place);
  if (!p || p.deck !== life.deck) return;
  const ev = evOf(life);
  const mat = st.mats?.glass || new THREE.MeshBasicMaterial({ color: 0xa8c6d8 });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...RAIN.slab), mat, RAIN.n);
  mesh.name = 'rain-23';
  mesh.frustumCulled = false;
  const H = p.h || 20;
  const xs = new Float32Array(RAIN.n), zs = new Float32Array(RAIN.n), ys = new Float32Array(RAIN.n), vs = new Float32Array(RAIN.n);
  for (let i = 0; i < RAIN.n; i++) {
    xs[i] = (h2(i, 1) - 0.5) * (p.w - 2);
    zs[i] = (h2(i, 2) - 0.5) * (p.d - 2);
    ys[i] = h2(i, 3) * H;
    vs[i] = RAIN.fall.min + h2(i, 4) * RAIN.fall.span;
  }
  mesh.position.set(p.x, floorOf(p), p.z);
  mesh.rotation.y = p.yaw;
  world.scene.add(mesh);
  ev.rain = { mesh, xs, zs, ys, vs, H, place: p };
  stepRain(life, 0);

  /* AND PEOPLE GO TO STAND IN IT. From the ring either side of the door,
   * through `missionWalker`, into the room on arrival. */
  if (world.netMode === 'client') return;
  const dest = T.destsOn(life.deck).find((d) => d.id === p.id);
  if (!dest) return;
  const n = e.visit | 0;
  const KINDS = ['human', 'narn', 'minbari', 'centauri', 'human', 'brakiri'];
  for (let k = 0; k < n; k++) {
    const side = (k % 2) ? 1 : -1;
    const a = dest.a + side * (0.16 + 0.05 * (k >> 1));
    const r = T.RING_WALK + ((k % 3) - 1) * 0.8;
    const local = { lx: (h2(k, 7) - 0.5) * (p.w - 6), lz: (h2(k, 8) - 0.5) * (p.d - 6) };
    const arrive = (b) => {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      _v.set(p.x + local.lx * c + local.lz * s, floorOf(p) + 0.1, p.z - local.lx * s + local.lz * c);
      b.wayR = 0; b.wayLegs = null; b.wayDwell = 0;
      b.position.copy(_v);
      b.body?.setTransform?.(b.position, null);
      if (b.velocity) b.velocity.set(0, 0, 0);
      T.standHere(b, p, _v);
      b.standFace = b.facing;
      /* Off the pool's hands while it stands in the rain. */
      b.wayMission = { stand: true };
    };
    const species = KINDS[k % KINDS.length];
    const b = T.missionWalker(world, st, life, `rain:${k}`, `res_${species}`,
      { x: r * Math.sin(a), z: r * Math.cos(a) }, dest, { arrive }, null,
      { name: 'somebody come to see the rain', role: 'visitor', species, pace: 0.9 + 0.05 * (k % 3) })
      || T.missionWalker(world, st, life, `rain:${k}`, 'res_human',
        { x: r * Math.sin(a), z: r * Math.cos(a) }, dest, { arrive }, null,
        { name: 'somebody come to see the rain', role: 'visitor', pace: 0.9 });
    if (b) ev.visitors.push(`rain:${k}`);
  }
}

function endRain(world, life, T) {
  const ev = evOf(life);
  if (ev.rain) {
    ev.rain.mesh.parent?.remove(ev.rain.mesh);
    ev.rain.mesh.geometry?.dispose?.();
    ev.rain = null;
  }
  for (const key of ev.visitors) drop(world, life, T, key);
  ev.visitors.length = 0;
}

function stepRain(life, dt) {
  const R = life.ev?.rain;
  if (!R) return;
  const { mesh, xs, zs, ys, vs, H } = R;
  for (let i = 0; i < RAIN.n; i++) {
    let y = ys[i] - vs[i] * dt;
    if (y < 0) y += H;
    ys[i] = y;
    _m.compose(_v.set(xs[i], y, zs[i]), _q, _s);
    mesh.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DRAZI FIGHT THAT SPILLS ONTO THE RING                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

const BRAWL = { drift: 0.35, apart: 0.9, shove: 0.55, beat: 1.1, from: 0.35, reach: 2.5 };

function beginBrawl(world, st, life, e, T) {
  const p = PLACE.get(e.place);
  if (!p || p.deck !== life.deck || apronOn(life.deck) || world.netMode === 'client') return;
  const ev = evOf(life);
  const R = T.RING_WALK;
  const a = Math.atan2(p.door[0], p.door[1]);
  const dir = h2(e.place, st.day | 0) < 0.5 ? -1 : 1;
  const B = { a, dir, t: 0, down: false, keys: [], guards: [] };
  for (let i = 0; i < 2; i++) {
    const ai = a + (i ? 1 : -1) * (BRAWL.apart / 2) / R;
    const b = ownBody(world, life, T, `brawl:${i}`, 'res_drazi', R * Math.sin(ai), R * Math.cos(ai),
      { name: i ? 'a purple Drazi' : 'a green Drazi', role: 'brawler', species: 'drazi', place: p.id });
    if (b) B.keys.push(`brawl:${i}`);
  }
  for (let g = 0; g < 2; g++) {
    const ag = a + dir * BRAWL.from + (g ? 0.012 : -0.012);
    const b = ownBody(world, life, T, `brawlguard:${g}`, 'res_human', R * Math.sin(ag), R * Math.cos(ag),
      { armour: T.GUARD_KIT, name: 'the watch', role: 'security', place: 24 });
    if (b) { b.stationGuard = true; B.guards.push({ key: `brawlguard:${g}`, a: ag }); }
  }
  ev.brawl = B;
}

function endBrawl(world, life, T) {
  const ev = evOf(life);
  const B = ev.brawl;
  if (!B) return;
  for (const k of B.keys) drop(world, life, T, k);
  for (const g of B.guards) drop(world, life, T, g.key);
  ev.brawl = null;
}

function stepBrawl(world, st, life, dt, T) {
  const B = life.ev?.brawl;
  if (!B) return;
  const R = T.RING_WALK;
  B.t += dt;
  const A = life.live.get(B.keys[0]), C = life.live.get(B.keys[1]);
  if (!B.down) {
    /* Along the ring, a shove at a time: the one being shoved is thrown half
     * a metre ahead on the beat and comes back to arm's length. */
    B.a += B.dir * (BRAWL.drift / R) * dt;
    const beat = Math.floor(B.t / BRAWL.beat);
    const frac = (B.t - beat * BRAWL.beat) / BRAWL.beat;
    const push = Math.sin(Math.PI * Math.min(1, frac * 2)) * BRAWL.shove;
    const shoved = beat % 2;
    const half = (BRAWL.apart / 2) / R;
    const aA = B.a - half + (shoved === 0 ? B.dir * push / R : 0);
    const aC = B.a + half + (shoved === 1 ? B.dir * push / R : 0);
    if (A?.position) placeOnRing(A, life.deck, aA, R, dt, Math.atan2(R * Math.sin(aC) - R * Math.sin(aA), R * Math.cos(aC) - R * Math.cos(aA)));
    if (C?.position) placeOnRing(C, life.deck, aC, R, dt, Math.atan2(R * Math.sin(aA) - R * Math.sin(aC), R * Math.cos(aA) - R * Math.cos(aC)));
    /* The patrol closes along the ring at the guards' own pace. */
    let nearest = Infinity;
    for (const g of B.guards) {
      const b = life.live.get(g.key);
      if (!b?.position) continue;
      const d = T.wrapPi(B.a - g.a);
      const step = Math.min(Math.abs(d), (T.GUARD_PACE / R) * dt);
      g.a += Math.sign(d) * step;
      placeOnRing(b, life.deck, g.a, R, dt);
      nearest = Math.min(nearest, Math.abs(T.wrapPi(B.a - g.a)) * R);
    }
    if (nearest <= BRAWL.reach) {
      B.down = true;
      world.notify?.('THE DRAZI QUARTER', 'the watch is on them — green and purple stand down');
    }
    return;
  }
  /* STOOD DOWN: the two stand where they are and face the watch; the watch
   * stands a stride off. */
  const ga = B.a + B.dir * (BRAWL.reach - 0.8) / R;
  for (const [i, g] of B.guards.entries()) {
    const b = life.live.get(g.key);
    if (!b?.position) continue;
    placeOnRing(b, life.deck, ga + (i ? 0.012 : -0.012), R, dt, Math.atan2(R * Math.sin(B.a) - b.position.x, R * Math.cos(B.a) - b.position.z));
  }
  const faceGuard = (b) => Math.atan2(R * Math.sin(ga) - b.position.x, R * Math.cos(ga) - b.position.z);
  const half = (BRAWL.apart / 2) / R;
  if (A?.position) placeOnRing(A, life.deck, B.a - half, R, dt, faceGuard(A));
  if (C?.position) placeOnRing(C, life.deck, B.a + half, R, dt, faceGuard(C));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE THREE DOORS `StationLife` CALLS                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

/** A row has just fired. */
export function beginStationEvents(world, st, life, e, T) {
  if (e.black) beginBlackout(world, st, life, e, T);
  if (e.rain) beginRain(world, st, life, e, T);
  if (e.spill) beginBrawl(world, st, life, e, T);
}

/** The running row is over — put down whatever it had out. */
export function calmStationEvents(world, life, T) {
  const ev = life.ev;
  if (!ev) return;
  if (ev.black > 0 || ev.lamps.length) endBlackout(world, life, T);
  if (ev.rain || ev.visitors.length) endRain(world, life, T);
  if (ev.brawl) endBrawl(world, life, T);
}

/**
 * One frame. Runs whether or not a row is up: the weather is stamped for the
 * day, and an effect whose row is no longer the running one is ended here —
 * a check that clears `life.event` by hand never calls `calm`.
 */
export function stepStationEvents(world, st, life, dt, T) {
  const day = st.day | 0;
  const ev = life.ev;
  if (!ev || ev.weatherDay !== day || ev.weatherFor !== st.theatre) {
    const E = evOf(life);
    E.weatherDay = day; E.weatherFor = st.theatre;
    st.weather = weatherAt(day, st.theatre);
  }
  if (!ev) return;
  if ((ev.black > 0 || ev.lamps.length) && !life.event?.black) endBlackout(world, life, T);
  if ((ev.rain || ev.visitors.length) && !life.event?.rain) endRain(world, life, T);
  if (ev.brawl && !life.event?.spill) endBrawl(world, life, T);
  stepBlackout(world, st, life, dt, T);
  stepRain(life, dt);
  stepBrawl(world, st, life, dt, T);
}
