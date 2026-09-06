/**
 * THE TRAM'S INTERIOR — V18 cool 17.
 *
 * *"A tram interior you can sit in, with residents across from you."*
 * `StationLife.dressTram` built the car as one box with a lit band, because it
 * was a thing seen through the promenade glass at range; then `rideTram` let
 * you board it, and from inside a solid box is nothing at all (its faces are
 * culled from behind). So: a cabin INSIDE the box — a floor, two bench rows
 * facing each other across the aisle, poles, a lit soffit, window bands with
 * mullions, and a route map strip that lights the stop the car is leaving.
 *
 * And people: two to four residents seeded on the day and the trip, seated on
 * the bench across the aisle, each with a stop to get off at. They talk
 * (`StationCast.barkFor`, the same voice as everyone else) while you are
 * aboard, and they get off when the car dwells at their stop.
 *
 * The player sits on the near bench: `Player.sitOn` with the claim shape
 * `StationSit` established. `Player._move`'s seated branch pins the feet to
 * `S.feet` and `_poseSeat` reads `S.y`, so a seat that MOVES is a claim whose
 * `feet`, `pos` and `y` are rewritten from the car's transform every frame.
 * That is `stepTramCabin`'s whole job, and it is why this lives in its own
 * file: the claim is a moving one and nothing in `StationSit` knows that.
 *
 * Nothing rolls. Riders are `resident(seed)` off `tram:day:trip:i`.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { PLACE, DECK_Y } from './StationPlan.js';
import { resident, barkFor, residentLine } from './StationCast.js';
import { signPanel } from './StationKit.js';
import { stationDay, stationHour } from './StationSave.js';
import { clamp } from '../engine/MathUtil.js';

/** The four stops, in the car's order — `StationLife.STOPS`, copied rather than
 *  imported so this file does not pull the pool's module graph into the kit. */
const STOPS = [40, 40.2, 40.3, 40.4];
/** How long the car stands at a platform — `Station.TRAM_DWELL`. */
const DWELL = 4.5;
/** The car box is 4.2 × 3.0 × 16 about its origin, at DECK_Y[44] + 1.2. The
 *  floor of the cabin is at the deck's riding height (+0.1, where
 *  `stepTramRide` puts the player). */
const FLOOR_Y = (DECK_Y[44] + 0.1) - (DECK_Y[44] + 1.2);   // local −1.1
const SEAT_H = 0.45;
const BENCH_X = 1.45;
/** Where a sitter's FEET go: `Rig.poseSeated` puts the hips a tenth behind
 *  the feet point and the ankles a third ahead, so the point is the seat's
 *  front edge, a quarter in from the bench's centre line. */
const FEET_X = BENCH_X - 0.25;
/** The seats down the far bench, local z. */
const SEATS = [-5.2, -3.4, -1.6, 0.4, 2.2, 4.0];
/** The player's seat on the near bench. */
const PLAYER_SEAT = { x: FEET_X, z: -0.4 };
/** How far off the car the riders are made real. */
const LIVE = 48;

const _v = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A stable 0..1 off a string — `StationCast.hashF`'s method. */
function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CABIN                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

export function dressTramCabin(world, st, M, car) {
  if (!car || !world?.scene) return null;
  const geos = [];
  const bins = new Map();
  const bin = (mat, g) => { (bins.get(mat) || bins.set(mat, []).get(mat)).push(g); };
  const box = (mat, w, h, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    bin(mat, g);
  };
  const y0 = FLOOR_Y;
  /* Floor and soffit. */
  box(M.deep, 4.0, 0.08, 15.6, 0, y0 - 0.04, 0);
  box(M.mark, 3.6, 0.04, 15.0, 0, y0 + 0.001, 0);
  box(M.dark, 4.0, 0.08, 15.6, 0, y0 + 2.55, 0);
  for (let i = -3; i <= 3; i++) box(M.strip, 1.2, 0.05, 0.12, 0, y0 + 2.5, i * 2.2);
  /* The side walls: a dado, a window band with mullions, a header. */
  for (const s of [-1, 1]) {
    const x = s * 2.02;
    box(M.wing, 0.08, 0.95, 15.6, x, y0 + 0.475, 0);
    box(M.dark, 0.08, 0.5, 15.6, x, y0 + 2.3, 0);
    box(M.glass, 0.03, 1.1, 15.4, x, y0 + 1.5, 0);
    for (let i = -4; i <= 4; i++) box(M.dark, 0.1, 1.1, 0.1, x, y0 + 1.5, i * 1.9);
    /* The bench: seat, back, a lit strip under the lip. */
    box(M.wing, 0.6, 0.08, 13.2, s * BENCH_X, y0 + SEAT_H - 0.04, 0);
    box(M.deep, 0.5, SEAT_H - 0.08, 13.2, s * BENCH_X, y0 + (SEAT_H - 0.08) / 2, 0);
    box(M.wing, 0.08, 0.6, 13.2, s * (BENCH_X + 0.42), y0 + SEAT_H + 0.32, 0);
    box(M.strip, 0.04, 0.03, 13.0, s * (BENCH_X - 0.3), y0 + SEAT_H - 0.02, 0);
    for (let i = 0; i < 7; i++) box(M.dark, 0.5, 0.06, 0.04, s * BENCH_X, y0 + SEAT_H + 0.005, -6.0 + i * 2.0);
  }
  /* The end walls, with a door frame in each. */
  for (const s of [-1, 1]) {
    box(M.wing, 4.0, 2.6, 0.08, 0, y0 + 1.3, s * 7.75);
    box(M.dark, 1.3, 2.2, 0.12, 0, y0 + 1.1, s * 7.7);
    box(M.strip, 1.1, 0.06, 0.06, 0, y0 + 2.22, s * 7.66);
  }
  /* The poles, and the grab rail along the soffit. */
  for (const z of [-4.5, -1.5, 1.5, 4.5]) {
    const g = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8);
    g.translate(0, y0 + 1.25, z);
    bin(M.wing, g);
  }
  for (const s of [-1, 1]) box(M.wing, 0.04, 0.04, 14, s * 0.7, y0 + 2.2, 0);
  mergeBins(car, bins, geos);
  /* The route map strip: one long panel over each bench, lit at the stop the
   * car is leaving. */
  const panel = signPanel(mapRows(0), { px: 1024, pyx: 128, name: 'tram-map', align: 'left', head: false, bg: '#0b0e12', ink2: '#7d8aa0', lit1: '#ffe6bd' });
  const maps = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(3.6, 0.42);
    geos.push(g);
    const m = new THREE.Mesh(g, panel.material);
    m.position.set(s * 1.96, y0 + 2.1, 0);
    m.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
    car.add(m);
    maps.push(m);
  }
  const cabin = {
    car, geos, panel, maps, mapAt: 0,
    riders: [], trip: 0, seededTrip: -1,
    /** The player's claim, while he sits. */
    claim: null, sitIn: 0, wasCrouch: false,
    /** For the checks: how many riders spoke, how many got off. */
    spoke: 0, alighted: 0, seatedFrames: 0,
    fakeProp: null,
  };
  cabin.state = () => tramCabinState(world);
  world._tramCabin = cabin;
  return cabin;
}

/** Boxes binned by material and merged, so the cabin is a handful of draws
 *  rather than seventy — `Hangar.mergeGeometries`'s method, local. */
function mergeBins(parent, bins, geos) {
  for (const [mat, list] of bins) {
    if (!list.length) continue;
    let n = 0, idx = 0;
    for (const g of list) { n += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const index = new Uint32Array(idx);
    let o = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
      pos.set(p.array, o * 3); if (nn) nor.set(nn.array, o * 3); if (u) uv.set(u.array, o * 2);
      if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.array[i] + o;
      else for (let i = 0; i < p.count; i++) index[io++] = i + o;
      o += p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    geos.push(out);
    const m = new THREE.Mesh(out, mat);
    m.castShadow = false; m.receiveShadow = false;
    m.name = `${parent.name}-${mat.userData?.key || mat.name || 'mat'}`;
    parent.add(m);
  }
  bins.clear();
}

function mapRows(at) {
  return STOPS.map((id, i) => {
    const p = PLACE.get(id);
    const name = p ? String(p.name).replace('Tram station — ', '') : String(id);
    return { t: `${i === at ? '●' : '○'} ${name}`, lit: i === at };
  });
}

/** Let the player's seat go at once — `Player._releaseSeat`, which is what
 *  `StationSit.releaseSeat` does; that module is not imported here because it
 *  reaches `Station.js`, and `StationLife` → here → `Station` → `StationLife`
 *  is a cycle that trips `Station`'s top-level read of `STOPS`. */
function releaseSeat(world, pl) {
  if (!pl?.seat) return;
  if (pl._releaseSeat) pl._releaseSeat();
  else pl.seat = null;
}

/** A seat prop that is nowhere in `world.props`: `Player._poseSeat` reads
 *  `prop.dead` and `prop.body.velocity`, and both must say "still". */
function fakeProp(cabin) {
  if (cabin.fakeProp) return cabin.fakeProp;
  cabin.fakeProp = {
    kind: 'bench', dead: false, tram: true,
    body: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), wake() {} },
  };
  return cabin.fakeProp;
}

/** A local cabin point → world, and the facing across the aisle from it. */
function seatWorld(car, lx, lz, out) {
  out.pos.set(lx, FLOOR_Y, lz).applyMatrix4(car.matrixWorld);
  _f.set(lx > 0 ? -1 : 1, 0, 0).applyQuaternion(car.getWorldQuaternion(_q));
  out.yaw = Math.atan2(_f.x, _f.z);
  out.seatY = out.pos.y + SEAT_H;
  return out;
}
const _sw = { pos: new THREE.Vector3(), yaw: 0, seatY: 0 };

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE RIDERS                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

const SPECIES = ['human', 'human', 'narn', 'centauri', 'minbari', 'drazi', 'brakiri', 'pakmara', 'abbai', 'llort', 'human'];

/** Seed the trip's riders: who, which seat, which stop they get off at. */
function seedRiders(cabin, life, day) {
  const trip = cabin.trip;
  const key = `tram:${day}:${trip}`;
  const n = 2 + Math.floor(hashF(key, 'n') * 3);            // 2..4
  const from = life.tram.at % STOPS.length;
  const seats = SEATS.slice();
  const riders = [];
  for (let i = 0; i < n; i++) {
    const seed = `${key}:${i}`;
    const species = SPECIES[Math.floor(hashF(seed, 'sp') * SPECIES.length) % SPECIES.length];
    const who = resident(seed, { species });
    const si = Math.floor(hashF(seed, 'seat') * seats.length) % seats.length;
    const z = seats.splice(si, 1)[0];
    const legs = 1 + Math.floor(hashF(seed, 'to') * (STOPS.length - 1));
    riders.push({
      who, z, from, to: (from + legs) % STOPS.length, body: null,
      talkIn: 3 + hashF(seed, 'talk') * 8, said: 0, off: false, blend: 0, rising: false,
    });
  }
  cabin.riders = riders;
  cabin.seededTrip = trip;
}

function spawnRider(world, cabin, r) {
  if (!world?.spawnEnemy || r.body) return;
  seatWorld(cabin.car, -FEET_X, r.z, _sw);
  let body = null;
  try {
    body = world.spawnEnemy(`res_${r.who.species}`, _sw.pos.clone(), { team: world.player?.team ?? 0, person: r.who.look || null });
  } catch { body = null; }
  if (!body) return;
  body.team = world.player?.team ?? 0;
  body.stationResident = true;
  body.stationName = r.who.name;
  body.stationRole = r.who.role;
  body.stationSpecies = r.who.species;
  body.stationFaction = r.who.faction;
  body.stationPlace = STOPS[r.from];
  body.noAmbientHarm = true;
  body.tramRider = true;
  if (body.brain) body.brain.idle = true;
  body.seat = {
    prop: fakeProp(cabin), table: null, yaw: _sw.yaw, state: 'sit', blend: 0,
    pos: _sw.pos.clone(), quat: new THREE.Quaternion(), y: _sw.seatY, tableY: null,
    cup: false, cupObj: null, hold: 1e9, tram: true,
  };
  r.body = body;
}

function removeRider(world, r) {
  const b = r.body;
  r.body = null;
  if (!b) return;
  try { b.dispose?.(); } catch { /* gone */ }
  const i = world.enemies?.indexOf(b) ?? -1;
  if (i >= 0) world.enemies.splice(i, 1);
}

/** Pin a rider to his seat this frame. */
function holdRider(cabin, r, dt) {
  const b = r.body;
  if (!b?.position) return;
  seatWorld(cabin.car, -FEET_X, r.z, _sw);
  b.position.copy(_sw.pos);
  b.facing = _sw.yaw;
  if (b.rotation) b.rotation.y = _sw.yaw;
  b.velocity?.set(0, 0, 0);
  b.grounded = true;
  b.body?.setTransform?.(b.position, null);
  const S = b.seat;
  if (S) {
    S.pos.copy(_sw.pos); S.y = _sw.seatY; S.yaw = _sw.yaw;
    if (r.rising) S.blend = Math.max(0, S.blend - dt / 0.5);
    else S.blend = Math.min(1, S.blend + dt / 0.6);
    r.blend = S.blend;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP — from `StationLife.stepTram`, after the car has moved          */
/* ══════════════════════════════════════════════════════════════════════════ */

export function stepTramCabin(world, st, life, dt) {
  const cabin = world?._tramCabin;
  const t = life?.tram;
  if (!cabin || !t?.car || !(dt > 0)) return;
  const car = cabin.car;
  car.updateMatrixWorld(true);
  const p = world.player;
  const riding = !!world._tramRide;
  const day = stationDay();

  /* ── the map strip lights the stop the car is leaving ────────────────── */
  const at = t.at % STOPS.length;
  if (cabin.mapAt !== at) { cabin.mapAt = at; cabin.panel.draw(mapRows(at)); }

  /* ── the trip: a new set of riders seeded each time the car leaves #40 ─ */
  if (at !== cabin.lastAt && at === 0 && cabin.seededTrip >= 0) cabin.trip++;
  cabin.lastAt = at;
  if (cabin.seededTrip !== cabin.trip) {
    for (const r of cabin.riders) removeRider(world, r);
    seedRiders(cabin, life, day);
  }

  /* ── who is real: riders within `LIVE` of the player, or while he rides ─ */
  const pp = p?.position;
  const near = riding || (pp && Math.hypot(pp.x - car.position.x, pp.z - car.position.z) < LIVE);
  const dwelling = t.t <= DWELL;
  for (const r of cabin.riders) {
    if (r.off) continue;
    /* Getting off: the car is standing at his stop — rise, and go when it leaves. */
    if (dwelling && at === r.to) r.rising = true;
    if (r.rising && !dwelling) {
      r.off = true;
      cabin.alighted++;
      removeRider(world, r);
      continue;
    }
    /* Boarding: he is aboard from his `from` stop — if the car has passed it
     * he is simply aboard; the trip seeds him seated. */
    if (near && !r.body) spawnRider(world, cabin, r);
    else if (!near && r.body && !riding) removeRider(world, r);
    if (r.body) {
      if (r.body.dead || r.body.alive === false || r.body.disposed) { r.body = null; r.off = true; continue; }
      holdRider(cabin, r, dt);
      /* Talk, while you are aboard to hear it. */
      if (riding) {
        r.talkIn -= dt;
        if (r.talkIn <= 0) {
          r.talkIn = 9 + hashF(`${r.who.seed}`, `t${r.said}`) * 7;
          r.said++;
          cabin.spoke++;
          const said = barkFor(r.who, day, { hour: world._station?.hour ?? stationHour(), place: PLACE.get(STOPS[r.to]) })
            || [residentLine(r.who).toUpperCase(), `is getting off at ${String(PLACE.get(STOPS[r.to])?.name || 'the next stop').replace('Tram station — ', '').toLowerCase()}`];
          world.notify?.(said[0], said[1]);
        }
      }
    }
  }

  /* ── the player's seat ────────────────────────────────────────────────── */
  if (!p) return;
  const claim = cabin.claim;
  if (!riding) {
    /* The ride ended — `setDownFromTram` has already put him on the platform. */
    if (claim && p.seat === claim) releaseSeat(world, p);
    cabin.claim = null;
    cabin.sitIn = 0;
    return;
  }
  if (claim && p.seat === claim) {
    /* THE SEAT MOVES WITH THE CAR: the claim is rewritten from the car's
     * transform, and the body with it (Player has already run this frame). */
    seatWorld(car, PLAYER_SEAT.x, PLAYER_SEAT.z, _sw);
    claim.feet.x = _sw.pos.x; claim.feet.z = _sw.pos.z;
    claim.pos.copy(_sw.pos); claim.y = _sw.seatY; claim.yaw = _sw.yaw;
    cabin.fakeProp.body.position.copy(_sw.pos);
    p.position.set(_sw.pos.x, _sw.pos.y, _sw.pos.z);
    p.facing += Math.atan2(Math.sin(_sw.yaw - p.facing), Math.cos(_sw.yaw - p.facing)) * Math.min(1, dt * 6);
    p.velocity?.set(0, 0, 0);
    p.fallSpeed = 0;
    p._sweepFromY = _sw.pos.y;
    p.body?.setTransform?.(_v.set(p.position.x, p.position.y + 0.9, p.position.z), null);
    cabin.seatedFrames++;
    return;
  }
  cabin.claim = null;
  /* Standing in the aisle: sit on boarding, and again on the crouch key. */
  const input = world._deckInput;
  const crouch = !!input?.act?.('crouch');
  const hit = crouch && !cabin.wasCrouch;
  cabin.wasCrouch = crouch;
  cabin.sitIn += dt;
  if (!p.seat && p.alive !== false && (cabin.sitIn > 0.6 && cabin.sitIn - dt <= 0.6 || hit)) sitPlayer(world, cabin);
}

function sitPlayer(world, cabin) {
  const p = world.player;
  seatWorld(cabin.car, PLAYER_SEAT.x, PLAYER_SEAT.z, _sw);
  const prop = fakeProp(cabin);
  prop.body.position.copy(_sw.pos);
  const claim = {
    prop, table: null, yaw: _sw.yaw, state: 'sit', blend: 0,
    pos: _sw.pos.clone(), quat: new THREE.Quaternion(),
    y: _sw.seatY, tableY: null, cup: false, cupObj: null,
    feet: { x: _sw.pos.x, z: _sw.pos.z },
    tram: true,
  };
  p.sitOn(claim);
  if (p.seat !== claim) return;
  cabin.claim = claim;
  /* On the bench from this frame, not the next: `stepTramRide` has already
   * been told to leave a seated player alone. */
  p.position.set(_sw.pos.x, _sw.pos.y, _sw.pos.z);
  p.body?.setTransform?.(_v.set(p.position.x, p.position.y + 0.9, p.position.z), null);
  world.notify?.('THE TRAM', 'you sit. Move to stand; crouch to sit again');
}

/** True while the player sits on the car's bench — `Station.stepTramRide`
 *  leaves the pin to this file then. */
export function seatedOnTram(world) {
  const c = world?._tramCabin;
  return !!(c?.claim && world.player?.seat === c.claim);
}

/** For the HUD and the checks — `world._tramCabin.state()`. */
function tramCabinState(world) {
  const c = world?._tramCabin;
  if (!c) return null;
  return {
    riders: c.riders.filter((r) => !r.off).length,
    seated: c.riders.filter((r) => r.body && !r.off).length,
    aboard: c.riders.filter((r) => r.body && !r.off).map((r) => ({ name: r.who.name, species: r.who.species, to: STOPS[r.to], blend: clamp(r.blend, 0, 1) })),
    playerSeated: seatedOnTram(world),
    feet: c.claim ? { ...c.claim.feet } : null,
    seatY: c.claim ? c.claim.y : null,
    spoke: c.spoke, alighted: c.alighted, trip: c.trip, seatedFrames: c.seatedFrames,
  };
}

export function undressTramCabin(world) {
  const c = world?._tramCabin;
  if (!c) return;
  if (c.claim && world.player?.seat === c.claim) releaseSeat(world, world.player);
  for (const r of c.riders) removeRider(world, r);
  for (const g of c.geos) g.dispose?.();
  c.panel?.texture?.dispose?.();
  world._tramCabin = null;
}
