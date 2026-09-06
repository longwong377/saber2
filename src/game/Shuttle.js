/**
 * THE SHUTTLE AT THE DOCKING THROAT — V18 cool 4.
 *
 * *"A shuttle at the docking throat that takes you to the flight deck the long
 * way, outside."* #8's gazetteer row has said "walk aboard a docked shuttle"
 * since the plan was written and the collar builder has stood a nose and a
 * ramp in the room for as long; the press at the ramp did nothing.
 *
 * So: the interact key at the foot of the ramp boards you. The ride is a
 * scripted vehicle-and-camera path — back out of the collar, round the
 * outside of the drum at the circuit's standoff, past the face the fleet
 * action is fought off (`DeckBattle` dresses it at +Z; `DRUM_FACE` is the
 * bearing the sights say the drum is seen from), then down and in through the
 * flight deck's mouth. It ends through the lift's own door: `world.onDeckLift`
 * with the deck-32 row `Levels.setLiftFloors` registered, which is exactly
 * what `DeckLift`'s GONE state calls. There is no second transition.
 *
 * While you ride, the player is `driving` the shuttle in the sense
 * `PlayerPilot` established: `Player.update` hands the frame to
 * `driving.update`, which puts the body in the cabin and the camera on a
 * chase boom. The blade is stowed, and `leave` refuses until the ride is done
 * — there is no climbing down from a shuttle 45 m off the hull. `dispose`
 * (why `null`) is always honoured.
 *
 * Nothing rolls. The path is a function of the plan and the ride clock.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { DRUM, DECK_Y, PLACE } from './StationPlan.js';
import { hullRadiusAt, mouthBearing, STANDOFF, DRUM_FACE } from './Outside.js';
import { deckBattleState } from './DeckBattle.js';
import { liftFloors } from './DeckLift.js';
import { clamp, smoothstep, damp } from '../engine/MathUtil.js';

/** How long the ride takes, seconds. The brief says 25–40. */
export const RIDE_SECS = 32;
/** How close to the ramp's foot the key means "board". */
export const RAMP_REACH = 3.2;
/** The deck the ride ends on — the flight deck's own row in the lift table. */
export const FLIGHT_DECK = 32;

const D2R = Math.PI / 180;
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/** The throat, in the world: its centre, its outward unit vector and the ramp's foot. */
function throatFrame() {
  const p = PLACE.get(8);
  if (!p) return null;
  const yaw = p.yaw || 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /* `StationKit.collar` puts the ramp's foot at local (0, −0.5) and the nose
   * at local +z, which the layout points OUT of the drum. */
  const local = (lx, lz) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
  const foot = local(0, -0.5);
  const out = local(0, 1);
  const ox = out.x - p.x, oz = out.z - p.z;
  const n = Math.hypot(ox, oz) || 1;
  return { place: p, x: p.x, z: p.z, y: DECK_Y[p.deck] ?? 0, ox: ox / n, oz: oz / n, foot };
}

/**
 * THE PATH. Waypoints in world metres, then an arc-length table so the ride
 * runs at one speed whatever the legs measure — `Outside.measure`'s method.
 */
function buildPath(F) {
  const pts = [];
  const push = (x, y, z) => pts.push(new THREE.Vector3(x, y, z));
  const y0 = F.y + 3.2;
  /* 1. In the collar, then straight back out of it. */
  push(F.x + F.ox * 7, y0, F.z + F.oz * 7);
  push(F.x + F.ox * 30, y0 + 0.5, F.z + F.oz * 30);
  push(F.x + F.ox * 52, y0 + 2, F.z + F.oz * 52);
  /* 2. Round the drum at the circuit's standoff, the way that passes the
   * fleet's face (`DRUM_FACE`) and ends at the mouth's bearing. */
  const b0 = (Math.atan2(F.ox, F.oz) / D2R + 360) % 360;
  const mb = mouthBearing();
  const dirOf = (from, to, via) => {
    const cw = ((to - from) % 360 + 360) % 360;      // clockwise sweep
    const cwVia = ((via - from) % 360 + 360) % 360;
    return cwVia < cw ? 1 : -1;                        // go the way that meets `via`
  };
  const dir = dirOf(b0, mb, DRUM_FACE);
  let sweep = dir > 0 ? ((mb - b0) % 360 + 360) % 360 : ((b0 - mb) % 360 + 360) % 360;
  if (sweep < 90) sweep += 360;                       // a ride round, not a hop
  const R = DRUM.R + STANDOFF;
  const yMouth = (DECK_Y[FLIGHT_DECK] ?? -22) + 2;
  const n = Math.max(8, Math.round(sweep / 12));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const b = b0 + dir * sweep * k;
    const r = R + 6 * Math.sin(k * Math.PI);
    const y = y0 + 2 + (yMouth - y0 - 2) * smoothstep(0.35, 1, k) + 9 * Math.sin(k * Math.PI);
    push(r * Math.sin(b * D2R), y, r * Math.cos(b * D2R));
  }
  /* 3. Down the mouth's line and in. */
  const rm = hullRadiusAt(DECK_Y[FLIGHT_DECK] ?? -22);
  push((rm + 24) * Math.sin(mb * D2R), yMouth, (rm + 24) * Math.cos(mb * D2R));
  push((rm - 14) * Math.sin(mb * D2R), yMouth - 1, (rm - 14) * Math.cos(mb * D2R));
  /* The table. */
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const path = { pts, cum, len: cum[cum.length - 1], mb, dir, sweep, profile: null };
  buildProfile(path);
  return path;
}

/** A point `s` metres along the path, into `out`. Piecewise linear; the
 *  heading is damped on the vehicle so the corners never show. */
function pointAt(path, s, out) {
  const { pts, cum } = path;
  s = clamp(s, 0, path.len);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1];
  const k = seg > 0 ? (s - cum[i - 1]) / seg : 1;
  return out.copy(a).lerp(b, k);
}

/**
 * Distance along the path at ride time `t`. The speed profile is a smooth
 * start over the first eighth and a brake over the last sixth, integrated
 * once into a table at build time so `t = RIDE_SECS` lands exactly at the
 * path's end whatever the profile's area is.
 */
const PROFILE_N = 256;
function buildProfile(path) {
  const v = (k) => smoothstep(0, 0.12, k) * (1 - smoothstep(0.84, 1, k));
  const cum = new Float64Array(PROFILE_N + 1);
  for (let i = 1; i <= PROFILE_N; i++) cum[i] = cum[i - 1] + (v((i - 0.5) / PROFILE_N)) / PROFILE_N;
  const total = cum[PROFILE_N] || 1;
  for (let i = 0; i <= PROFILE_N; i++) cum[i] = cum[i] / total * path.len;
  path.profile = cum;
}
function progressAt(path, t) {
  const k = clamp(t / RIDE_SECS, 0, 1) * PROFILE_N;
  const i = Math.min(PROFILE_N - 1, Math.floor(k));
  const f = k - i;
  const P = path.profile;
  return P[i] + (P[i + 1] - P[i]) * f;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE VEHICLE                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

function buildVehicle(M) {
  const g = new THREE.Group();
  g.name = 'station-shuttle';
  const geos = [];
  const bins = new Map();
  const mesh = (geo, mat, x, y, z, ry = 0, rx = 0) => {
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    (bins.get(mat) || bins.set(mat, []).get(mat)).push(geo);
  };
  /* The hull, +z forward. */
  mesh(new THREE.BoxGeometry(3.4, 2.6, 9.0), M.wing, 0, 0, 0);
  mesh(new THREE.BoxGeometry(2.4, 1.6, 2.6), M.dark, 0, -0.2, 5.6);      // the nose
  mesh(new THREE.BoxGeometry(2.0, 0.9, 1.4), M.glass, 0, 0.9, 4.4);      // the cockpit glass
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(3.6, 0.22, 2.4), M.hull, s * 3.2, -0.4, -1.6, 0, 0); // the wings
    mesh(new THREE.BoxGeometry(0.6, 0.6, 1.8), M.dark, s * 4.6, -0.2, -2.2);      // the pods
    mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), M.strip, s * 4.6, -0.2, -3.2);     // the pod glow
    /* The window band down each side — what you look out of. */
    mesh(new THREE.BoxGeometry(0.06, 0.7, 6.0), M.glass, s * 1.72, 0.45, 0.4);
  }
  mesh(new THREE.BoxGeometry(2.2, 1.4, 0.9), M.dark, 0, -0.1, -4.9);    // the drive block
  mesh(new THREE.BoxGeometry(1.6, 1.0, 0.2), M.strip, 0, -0.1, -5.4);   // the drive glow
  mesh(new THREE.BoxGeometry(0.4, 1.4, 3.0), M.hull, 0, 1.6, -2.6);     // the fin
  mergeBins(g, bins, geos);
  g.visible = false;
  return { group: g, geos };
}

/** Boxes binned by material and merged, so the shuttle is five draws
 *  rather than fifteen — `Hangar.mergeGeometries`'s method, local. */
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

/* ══════════════════════════════════════════════════════════════════════════ */
/*  DRESS / STEP / KEY / UNDRESS                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Stand the shuttle up. A no-op on any deck but the throat's. */
export function dressShuttle(world, st, M) {
  const F = throatFrame();
  if (!F || !st || st.deck !== F.place.deck || !world?.scene) return null;
  const path = buildPath(F);
  const veh = buildVehicle(M || st.mats);
  world.scene.add(veh.group);
  const S = {
    deck: st.deck, frame: F, path, vehicle: veh.group, geos: veh.geos,
    ride: null, rides: 0, last: null, prompted: false,
    heading: Math.atan2(F.ox, F.oz), pitch: 0,
    state: () => shuttleState(world),
    atRamp: () => atShuttleRamp(world),
  };
  world._shuttle = S;
  return S;
}

/** Where the ride is, for the HUD and the checks — `world._shuttle.state()`. */
function shuttleState(world) {
  const S = world?._shuttle;
  if (!S) return null;
  const r = S.ride;
  const p = r ? r.pos : null;
  return {
    riding: !!r, t: r ? r.t : 0, T: RIDE_SECS, rides: S.rides, last: S.last,
    pos: p ? { x: p.x, y: p.y, z: p.z } : null,
    radius: p ? Math.hypot(p.x, p.z) : null,
    u: r ? clamp(r.t / RIDE_SECS, 0, 1) : 0,
    phase: !r ? 'docked' : r.t < 4 ? 'undocking' : r.t < RIDE_SECS - 5 ? 'outside' : 'approach',
    /* The window shows the deck's battle — the same state the deck reads. */
    battle: deckBattleState(world),
    foot: S.frame.foot,
    path: { len: S.path.len, points: S.path.pts.length, mouthBearing: S.path.mb, sweep: S.path.sweep, dir: S.path.dir, secs: RIDE_SECS },
  };
}

/** True when the player stands at the ramp's foot. */
function atShuttleRamp(world) {
  const S = world?._shuttle;
  const p = world?.player?.position;
  if (!S || !p || S.ride) return false;
  return Math.hypot(p.x - S.frame.foot.x, p.z - S.frame.foot.z) < RAMP_REACH
    && Math.abs(p.y - S.frame.y) < 2.5;
}

/** The key. True when the press was spent boarding at the ramp. */
export function shuttleKey(world) {
  const S = world?._shuttle;
  if (!S) return false;
  /* Aboard, the key never reaches here — `Player._readInput` returns early
   * while `driving` — so a press that does is a check's, and the room answers. */
  if (S.ride) return false;
  if (!atShuttleRamp(world)) return false;
  return board(world, S);
}

function board(world, S) {
  const p = world.player;
  if (!p || p.alive === false) return false;
  const F = S.frame;
  const ride = {
    t: 0, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
    stepped: false, ended: false,
    left: false, player: p, world,
    was: null, wasLit: false,
    /* `Player.update` hands the frame here — see `PlayerPilot`. */
    update: (dt, ctx) => rideFrame(world, S, dt, ctx),
    /* `Player.dispose` calls this with no reason; the vehicle key calls it
     * with one. Only the first is honoured mid-ride. */
    leave: (why) => {
      if (why != null && !ride.ended) {
        world.notify?.('THE SHUTTLE', 'there is no way off until it docks');
        return false;
      }
      return unseat(world, S, ride);
    },
    vehicle: { damage() {} },
  };
  pointAt(S.path, 0, ride.pos);
  ride.prev.copy(ride.pos);
  /* Stow the blade, remember the lens. */
  const cam = p.camera;
  ride.was = cam ? {
    fp: cam.firstPerson, dist: cam.targetDistance, height: cam.height, shoulder: cam.shoulder,
    yaw: cam.yaw, pitch: cam.pitch, fov: cam.fovTarget, roll: cam.roll, rollTarget: cam.rollTarget,
  } : null;
  ride.wasLit = !!p.saber?.lit;
  p.saber?.retract?.();
  p.saber?.setVisible?.(false);
  p.hum?.retract?.();
  p.releaseGrip?.();
  if (p.seat) p.standUp?.();
  p.driving = ride;
  if (cam) {
    cam.firstPerson = false;
    cam.targetDistance = 18;
    cam.height = 3.0;
    cam.shoulder = 0;
    cam.eyeOffset?.set?.(0, 0, 0);
  }
  p._applyViewMode?.();
  S.vehicle.visible = true;
  S.ride = ride;
  S.heading = Math.atan2(F.ox, F.oz);
  world.notify?.('THE SHUTTLE', `aboard — the flight deck, the long way round. ${RIDE_SECS} seconds`);
  return true;
}

/** One frame of the ride: the vehicle along the path, the body in the cabin,
 *  the camera on the boom looking where a passenger would. */
function rideFrame(world, S, dt, ctx) {
  const r = S.ride;
  if (!r || r.ended) return false;
  r.stepped = true;
  advance(world, S, r, dt);
  const p = r.player;
  if (!p) return true;
  /* The body rides in the cabin, a little below the hull's centre. */
  p.position.set(r.pos.x, r.pos.y - 0.9, r.pos.z);
  p.velocity.copy(r.vel);
  p.grounded = true;
  p.coyote = 0.14;
  p.fallSpeed = 0;
  p.facing = S.heading;
  p.body?.setTransform?.(_v.set(p.position.x, p.position.y + 0.9, p.position.z), null);
  const cam = p.camera;
  if (cam) {
    /* Look along the travel, swung toward the hull through the middle of the
     * ride so the drum's window walls go past the glass, and toward the
     * mouth on the way in. */
    const k = clamp(r.t / RIDE_SECS, 0, 1);
    const toHull = Math.atan2(-r.pos.x, -r.pos.z);
    let d = toHull - S.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const swing = Math.sin(k * Math.PI) * 0.55;
    const yaw = S.heading + Math.PI + d * swing;   // the boom trails: yaw is where the lens looks FROM
    cam.yaw = damp(cam.yaw, unwrapTo(cam.yaw, yaw), 2.2, dt);
    cam.pitch = damp(cam.pitch, -0.10 - 0.08 * Math.sin(k * Math.PI), 2.0, dt);
    cam.roll = 0; cam.rollTarget = 0;
    cam.syncAim?.();
    cam.targetDistance = 18;
    cam.height = 3.0;
    cam.fovTarget = (world?.settings?.fov ?? 60) + 6 * Math.sin(k * Math.PI);
    cam.update(dt, p.position, { physics: null, terrain: null, eyeHeight: 0.9, pelvis: null });
  }
  if (r.t >= RIDE_SECS) arrive(world, S, r);
  return true;
}

const unwrapTo = (near, a) => near + Math.atan2(Math.sin(a - near), Math.cos(a - near));

function advance(world, S, r, dt) {
  if (!(dt > 0)) return;
  r.t += dt;
  r.prev.copy(r.pos);
  pointAt(S.path, progressAt(S.path, r.t), r.pos);
  r.vel.subVectors(r.pos, r.prev).multiplyScalar(1 / dt);
  const sp = r.vel.length();
  if (sp > 0.05) {
    const h = Math.atan2(r.vel.x, r.vel.z);
    S.heading = damp(S.heading, unwrapTo(S.heading, h), 3, dt);
    S.pitch = damp(S.pitch, Math.asin(clamp(r.vel.y / sp, -1, 1)) * 0.6, 3, dt);
  }
  const g = S.vehicle;
  g.position.copy(r.pos);
  _e.set(-S.pitch, S.heading, 0, 'YXZ');
  g.quaternion.setFromEuler(_e);
  /* A little bank into the turn, a little sway. */
  g.rotateZ(Math.sin(r.t * 0.7) * 0.03);
}

/** The ride is over: the lift's own door, and the same row the car uses. */
function arrive(world, S, r) {
  if (r.ended) return;
  r.ended = true;
  S.rides++;
  S.last = { t: r.t, deck: FLIGHT_DECK };
  const row = (liftFloors() || []).find((f) => f && f.deck === FLIGHT_DECK && f.level === 'station')
    || { n: FLIGHT_DECK, label: 'Flight ops', level: 'station', deck: FLIGHT_DECK, shaft: 'flight' };
  world.notify?.('THE SHUTTLE', 'docked — the flight deck');
  if (world.onDeckLift) {
    /* The transition disposes this world; `Player.dispose` will call
     * `leave(null)`, which is honoured. The vehicle stays where it docked. */
    S.ride = null;
    r.player.driving = null;
    world.onDeckLift(row);
    return;
  }
  /* No door (headless): put him down at the ramp again. */
  unseat(world, S, r);
}

function unseat(world, S, r) {
  if (r.left) return true;
  r.left = true; r.ended = true;
  const p = r.player;
  if (p) {
    if (p.driving === r) p.driving = null;
    p.velocity.set(0, 0, 0);
    const cam = p.camera, w = r.was;
    if (cam && w) {
      cam.firstPerson = w.fp; cam.targetDistance = w.dist; cam.height = w.height;
      cam.shoulder = w.shoulder; cam.pitch = w.pitch; cam.fovTarget = w.fov;
      cam.roll = w.roll; cam.rollTarget = w.rollTarget;
    }
    if (p.saber) {
      p.saber.setVisible?.(!p.saberDown);
      if (r.wasLit && !p.saberDown && p.alive !== false) { p.saber.ignite?.(); p.hum?.ignite?.(); }
    }
    p._applyViewMode?.();
    /* Back on the plate. */
    const F = S.frame;
    p.position.set(F.foot.x, F.y + 0.1, F.foot.z);
    p.body?.setTransform?.(_v.set(p.position.x, p.position.y + 0.9, p.position.z), null);
    p.grounded = true;
  }
  if (S.ride === r) S.ride = null;
  S.vehicle.visible = false;
  return true;
}

/** Every frame from `stepStation`. The prompt at the ramp, and the ride when
 *  there is no player to hand the frame to. */
export function stepShuttle(world, dt) {
  const S = world?._shuttle;
  if (!S) return;
  const r = S.ride;
  if (r) {
    if (!r.stepped && !r.ended) {
      advance(world, S, r, dt);
      if (r.t >= RIDE_SECS) arrive(world, S, r);
    }
    r.stepped = false;
    return;
  }
  const p = world.player?.position;
  if (!p) return;
  const near = Math.hypot(p.x - S.frame.foot.x, p.z - S.frame.foot.z) < 7 && Math.abs(p.y - S.frame.y) < 2.5;
  if (near && !S.prompted) {
    S.prompted = true;
    world.notify?.('DOCKING THROAT', 'the key at the ramp boards the shuttle — the flight deck, outside');
  } else if (!near && S.prompted) S.prompted = false;
}

/** Everything down, and the player off it if he was aboard. */
export function undressShuttle(world) {
  const S = world?._shuttle;
  if (!S) return;
  if (S.ride) unseat(world, S, S.ride);
  S.vehicle.parent?.remove(S.vehicle);
  for (const g of S.geos) g.dispose?.();
  world._shuttle = null;
}
