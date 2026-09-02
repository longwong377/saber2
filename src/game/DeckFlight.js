/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FLIGHT — the transport on the deck, boarding it, and the way out
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's words:
 *
 *   "this is where you board a ship and start any match with or without
 *    troops (you board, fly out through the same force field you see in the
 *    hangar and fly out towards the planet you see the capitol ship you just
 *    left getting smaller and smaller in distance and the planet getting
 *    larger and larger and then you enter the atmosphere and are in the same
 *    ship landing sequence the game already has, when you retreat/finish a
 *    mode/match you will board a ship, leave the atmosphere and do all that
 *    in reverse and land in the hanger."
 *
 * ── WHAT THIS FILE OWNS ────────────────────────────────────────────────────
 *
 * The army's REAL transport, standing on the near pad with its ramp down —
 * `Vehicles.buildTransport` through `Arrivals.transportModel`, the same hull
 * the insertion flies, because a ship you can walk into has to be a ship and
 * a silhouette under a real hull is two ships in one place. Its colliders,
 * so the player walks up the ramp and stands in the bay rather than through
 * it. And two sequences:
 *
 *   DEPART   the dwell at the ramp's foot (`Hangar.stepRamp`) is the order.
 *            The company leaves the line or the crowd and files up the ramp
 *            to the bay; the player walks in himself and is seated the moment
 *            he is inside (`Extraction._inBay`'s test, the same box the hull
 *            publishes); the ramp comes up and the doors stay OPEN for the run
 *            through the hangar's air, so the deck races past the door as the
 *            hull accelerates to the aperture; the field takes it on the way
 *            through; the doors shut in vacuum and the hangar shrinks behind
 *            them — and then `world.onDeckDeploy` is raised, which is main.js
 *            building the battlefield and running the insertion the player
 *            already has: in orbit, the capital ship astern and receding, the
 *            planet growing, the burn, the fall.
 *
 *   ARRIVE   the reverse, for a world built with `_deckArrival`: the hull
 *            comes in from far out through the aperture with the player and
 *            the company aboard, lands, turns to park nose-out, the ramp comes
 *            down, everybody walks off it into the crowd, and the deck is the
 *            deck again — with the after-action card waiting for him.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not fly the transport to the planet. The battlefield is a different
 * World with a different terrain under it, and the seam between the two is a
 * build that takes seconds; `Extraction.beginInsertion` already opens on the
 * far side of that seam in orbit with the capital ship astern, which is the
 * "getting smaller and smaller" the player described. What this adds in
 * front of it is the part that was missing: you walk into the ship on the
 * deck, and you leave through the field.
 *
 * Everything moving is driven off one clock per phase, every transition is a
 * `>=` on it, and nothing here allocates per frame.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { transportModel } from './Arrivals.js';
import { audio } from '../engine/Audio.js';
import { clamp, lerp, smoothstep } from '../engine/MathUtil.js';
import { launchSequence, damagedArrival } from './DeckAudio.js';
import { makeShovable } from '../physics/Shovable.js';
import { dressDeckExterior, setExteriorSeen, undressDeckExterior } from './DeckExterior.js';
/* Read inside functions only — Hangar.js imports this file. */
import { DECK, DEPLOY_RAMP, deckFaction } from './Hangar.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * THE BEATS, in seconds. The boarding has no fixed length: it waits for the
 * player, and after `lastCall` it pulls him aboard the way the extraction's
 * crew does, so a player who walked away from his own ramp is not left with
 * a company sitting in a hull for ever.
 */
export const FLIGHT = {
  /**
   * The hull's centre over the pad's top WHEN NOTHING BETTER IS KNOWN. The
   * parked hull is stood on its belly: `dressDeckFlight` measures the model
   * (its lowest hull mesh, ramp and doors hidden) and writes `st.hover` so the
   * belly touches the pad. This was `Extraction`'s 1.15, which put the belly
   * 0.9 m INTO the pad and the ramp's foot two metres under the deck.
   */
  hover: 2.1,
  /** The ramp leaf, hinge to foot. The transports' own 2.6. */
  ramp: 2.6,
  /** The pad's own height, so the ramp foot lands on something walkable. */
  padHeight: 0.45,
  seal: 1.6,
  lift: 2.6,
  run: 5.2,
  /**
   * BEYOND THE LIP, with the doors OPEN and the ship behind you. This was
   * 4.6 s with the doors shutting in the first 1.2, which is why the player
   * never saw the hull he had left: "all I see is a large rectangle getting
   * smaller". The hull now flies `outRange` metres out over `out` seconds with
   * the bay open, the capital ship standing round the deck behind
   * (`DeckExterior`), and the camera the player's — turn round and look.
   * The doors shut in the last `outSeal` seconds, and the same closed bay is
   * the first frame of the orbit on the far side of the build.
   */
  out: 11.0,
  outRange: 1400,
  outSeal: 1.6,
  lastCall: 26,
  /** The arrival: from far out to the pad, the turn, the ramp, the walk off. */
  approach: 10.0, turn: 3.2, open: 1.6, unload: 5.0,
  /** How far out the hull starts, beyond the lip. Far enough that the
   *  capital ship it is flying into fills the view first. */
  far: 1500,
};

export const PHASE = {
  PARKED: 'parked', BOARD: 'board', SEAL: 'seal', LIFT: 'lift', RUN: 'run', OUT: 'out',
  GONE: 'gone', APPROACH: 'approach', TURN: 'turn', OPEN: 'open', UNLOAD: 'unload',
};

/* The engine flame, shared. Two cones per nozzle, `Extraction`'s idiom. */
let _flameGeo = null, _coreGeo = null, _flameMat = null, _coreMat = null;
function flames() {
  if (_flameGeo) return;
  _flameGeo = new THREE.ConeGeometry(0.24, 1.0, 10, 1, true);
  _coreGeo = new THREE.ConeGeometry(0.12, 1.0, 8, 1, true);
  _flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.55,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  _coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.9,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  _flameMat.userData.saberNoInk = true; _coreMat.userData.saberNoInk = true;
}

/** Where the ship's pad is, in world space. */
function padAt() {
  return { x: DEPLOY_RAMP.x, y: FLIGHT.padHeight, z: DEPLOY_RAMP.padZ, yaw: DEPLOY_RAMP.yaw };
}

/**
 * Stand the transport on the pad. Called by `dressHangar` after the room is
 * built. `opts.arrival` starts it far out with everybody aboard instead.
 */
export function dressDeckFlight(world, opts = {}) {
  const prev = world._deckFlight;
  if (prev && prev.group?.parent) return prev;
  flames();
  const side = world._deckFaction || deckFaction(world);
  const group = new THREE.Group();
  group.name = 'deck-transport';
  group.frustumCulled = false;
  let model = null;
  try { model = transportModel(side); } catch { model = null; }
  /* THE SHIP ROUND THE ROOM, hidden until the camera is past the lip. */
  try { dressDeckExterior(world); } catch (e) { console.warn('deck exterior', e); }
  const fires = [];
  if (model) {
    group.add(model);
    for (const a of (model.userData?.engines || []).filter(Boolean)) {
      const fire = new THREE.Mesh(_flameGeo, _flameMat);
      fire.frustumCulled = false; fire.rotation.x = -Math.PI / 2; fire.position.z = 0.28;
      a.add(fire); fires.push(fire);
      const core = new THREE.Mesh(_coreGeo, _coreMat);
      core.frustumCulled = false; core.rotation.x = -Math.PI / 2; core.position.z = 0.16;
      a.add(core); fires.push(core);
    }
  }
  const pad = padAt();
  const st = {
    group, model, fires, side,
    /** The centre's height over the pad, so the belly sits on it. */
    hover: model ? hullBelly(model) + 0.04 : FLIGHT.hover,
    bay: model?.userData?.bay || { halfW: 1.2, floor: -0.95, roof: 1.1, front: -1.6, back: 3.3 },
    seats: model?.userData?.seats || [],
    pad,
    phase: opts.arrival ? PHASE.APPROACH : PHASE.PARKED,
    t: 0,
    open: opts.arrival ? 0 : 1,
    thrust: 0,
    solids: [],
    /** The men parented into the bay, with their local seat. */
    aboard: [],
    /** The player's ride, while he is in the bay. */
    seated: false,
    told: false,
    launched: false,
    arrived: !opts.arrival,
    /** True while a departure or an arrival is running: the ramp dwell waits. */
    get busy() { return this.phase !== PHASE.PARKED; },
    depart: () => depart(world),
  };
  world._deckFlight = st;
  world.scene.add(group);
  if (opts.arrival) {
    /* FAR OUT, on the aperture's axis, nose in. */
    group.position.set(0, 46, DECK.lip + FLIGHT.far);
    group.rotation.set(0, 0, 0);
    hatch(st, 0);
    setThrust(st, 0.6);
    /* The sound of a hull coming in, on the same clock. */
    try { damagedArrival(world, { x: pad.x, z: pad.z, speed: FLIGHT.far / FLIGHT.approach, mass: 1 }); } catch {}
  } else {
    parkAt(st);
    hatch(st, 1);
    setThrust(st, 0);
    solidify(world, st);
  }
  return st;
}

/** Put the hull on its pad, nose to the aperture. */
function parkAt(st) {
  const p = st.pad;
  st.group.position.set(p.x, p.y + st.hover, p.z);
  st.group.rotation.set(0, p.yaw, 0);
  st.group.updateMatrixWorld(true);
}

/**
 * The colliders a parked hull needs: the bay floor you stand on, its walls,
 * its roof, the nose, and the ramp leaf as a tilted plate. In the hull's own
 * frame, turned into the world by the group's transform. Removed the moment
 * the gear comes up: a static box does not fly.
 */
function solidify(world, st) {
  const P = world.physics;
  if (!P?.addStaticBox) return;
  unsolidify(world, st);
  const B = st.bay;
  const g = st.group;
  g.updateMatrixWorld(true);
  const box = (lx, ly, lz, hx, hy, hz, rx = 0) => {
    _v.set(lx, ly, lz);
    g.localToWorld(_v);
    _q.copy(g.quaternion);
    if (rx) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx));
    const rec = P.addStaticBox(_v.clone(), new THREE.Vector3(hx, hy, hz), _q.clone(), { friction: 0.7 });
    if (rec) st.solids.push(rec);
  };
  const mid = (B.front + B.back) / 2, half = (B.back - B.front) / 2;
  box(0, B.floor - 0.12, mid, B.halfW + 0.3, 0.12, half + 0.2);
  box(0, B.roof + 0.14, mid, B.halfW + 0.3, 0.12, half + 0.2);
  for (const s of [-1, 1]) box(s * (B.halfW + 0.34), (B.floor + B.roof) / 2, mid, 0.2, (B.roof - B.floor) / 2 + 0.2, half + 0.2);
  /* The nose and the tail masses, so he walks round the hull and not into it. */
  box(0, 0, B.front - 2.4, 1.5, 1.2, 2.2);
  /* The ramp, as a plate along the leaf: hinged at the floor at `back`, 2.6 m
   * long, dropped by the hatch's angle. */
  const a = rampAngle(st);
  const L = 2.6;
  box(0, B.floor - Math.sin(a) * L * 0.5, B.back + Math.cos(a) * L * 0.5, B.halfW + 0.2, 0.06, L * 0.5, a);
}

function unsolidify(world, st) {
  for (const b of st.solids) world.physics?.removeStaticBox?.(b);
  st.solids.length = 0;
}

/**
 * The ramp's angle: the leaf is hinged at the bay's floor and its foot RESTS
 * ON THE PAD, so the angle is whatever the drop from the hinge to the pad's
 * top asks for. `Extraction._hatch` derives its angle from the hover the same
 * way; the deck's difference is that the pad is a known height.
 */
function rampAngle(st) {
  const hinge = st.hover + (st.bay?.floor ?? -0.95) - 0.02;
  const drop = Math.max(0, hinge - 0.0);
  return clamp(Math.asin(clamp(drop / FLIGHT.ramp, 0, 0.98)), 0.12, 1.15);
}

/**
 * How far the model's hull hangs below its origin, ramp and doors hidden —
 * the number the hover is set from so a parked transport stands on the pad
 * rather than in it. Measured once per dress.
 */
function hullBelly(model) {
  const u = model.userData || {};
  const hide = [u.ramp, u.doorL, u.doorR].filter(Boolean);
  const was = hide.map((h) => h.visible);
  for (const h of hide) h.visible = false;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  hide.forEach((h, i) => { h.visible = was[i]; });
  return Number.isFinite(box.min.y) ? Math.max(0.6, -box.min.y) : FLIGHT.hover;
}

/**
 * THE FLOOR UNDER A MAN ON THE RAMP OR IN THE BAY, in world height, or null
 * when the point is on neither. `Hangar.deckFloorAt` asks this first, so the
 * company walks UP the ramp rather than along the deck under it, and a man
 * put down in the bay stands on its floor. Only while the hull is on its pad:
 * a hull in the air has no floor anybody on the deck can stand on.
 */
export function hullFloorAt(world, x, z) {
  const st = world?._deckFlight;
  if (!st || !st.group?.parent) return null;
  if (![PHASE.PARKED, PHASE.BOARD, PHASE.OPEN, PHASE.UNLOAD].includes(st.phase)) return null;
  const B = st.bay;
  _v3.set(x, 0, z);
  st.group.worldToLocal(_v3);
  const lx = _v3.x, lz = _v3.z;
  if (Math.abs(lx) > B.halfW + 0.35) return null;
  const gy = st.group.position.y;
  if (lz >= B.front - 0.2 && lz <= B.back) return gy + B.floor + 0.02;
  const a = rampAngle(st);
  const reach = Math.cos(a) * FLIGHT.ramp;
  if (lz > B.back && lz <= B.back + reach + 0.05) {
    const d = Math.min(FLIGHT.ramp, (lz - B.back) / Math.cos(a));
    return Math.max(FLIGHT.padHeight, gy + B.floor - 0.02 - Math.sin(a) * d);
  }
  return null;
}

/** How open the ship is, 0..1: the ramp's hinge and the doors' travel. */
function hatch(st, k) {
  const u = st.model?.userData;
  st.open = clamp(k, 0, 1);
  if (!u) return;
  const e = smoothstep(0, 1, st.open);
  if (u.ramp) u.ramp.rotation.x = e * rampAngle(st);
  const slide = 2.0;
  if (u.doorL) u.doorL.position.z = e * slide;
  if (u.doorR) u.doorR.position.z = e * slide;
}

/** The doors alone, for the run through the air: ramp up, doors open. */
function doors(st, k) {
  const u = st.model?.userData;
  if (!u) return;
  const e = smoothstep(0, 1, clamp(k, 0, 1));
  if (u.doorL) u.doorL.position.z = e * 2.0;
  if (u.doorR) u.doorR.position.z = e * 2.0;
}

function setThrust(st, t) {
  st.thrust = t;
}

function stepFlames(st, total) {
  const flare = st.thrust * (1 + Math.sin(total * 31) * 0.14);
  for (const f of st.fires) {
    f.visible = flare > 0.02;
    f.scale.set(0.9 + flare * 0.3, 0.6 + flare * 2.6, 0.9 + flare * 0.3);
  }
}

/** The ramp's foot, in world space, on the deck behind the hull. */
export function rampFoot(world, out = new THREE.Vector3()) {
  const st = world?._deckFlight;
  const B = st?.bay || { back: 3.3 };
  const reach = st ? Math.cos(rampAngle(st)) * FLIGHT.ramp : 2.4;
  out.set(0, -1.15, B.back + reach + 0.25);
  if (st) st.group.localToWorld(out);
  else out.set(DEPLOY_RAMP.x, 0, DEPLOY_RAMP.z);
  out.y = FLIGHT.padHeight;
  return out;
}

/**
 * A SPOT ON THE APRON BEHIND THE RAMP, in world space: `back` metres further
 * from the hull than the ramp's foot, `side` metres across. Worked in the
 * hull's own frame and turned out, because "behind the ramp" is +Z in that
 * frame and the parked hull is yawed π — adding to the WORLD z put the whole
 * boarding file under the hull, where the floor query lifted them onto the
 * bay floor a metre at a time.
 */
export function rampSpot(world, back, side = 0, out = new THREE.Vector3()) {
  const st = world?._deckFlight;
  if (!st) { out.set(DEPLOY_RAMP.x + side, FLIGHT.padHeight, DEPLOY_RAMP.z - back); return out; }
  const B = st.bay;
  const reach = Math.cos(rampAngle(st)) * FLIGHT.ramp;
  out.set(side, -1.15, B.back + reach + 0.25 + back);
  st.group.localToWorld(out);
  out.y = FLIGHT.padHeight;
  return out;
}

/** A man's slot in the bay, in the hull's frame: the seats, benches first. */
function slotFor(st, i) {
  const seats = st.seats;
  if (seats.length) {
    const order = [...seats.filter((x) => x.sit), ...seats.filter((x) => !x.sit)];
    const s = order[i % order.length];
    /* STANDING on the bench's floor line: a parade figure has no seated pose,
     * so he stands where the bench is, against the wall, which reads as a
     * man in a troop bay from the door. */
    return { x: s.x, y: st.bay.floor + 0.02, z: s.z, yaw: s.yaw };
  }
  return { x: (i % 2 ? 0.55 : -0.55), y: st.bay.floor + 0.02, z: -0.9 + Math.floor(i / 2) * 0.7, yaw: 0 };
}

/** Is a world point inside the bay? `Extraction._inBay`, with the same slack. */
export function inBay(world, pos) {
  const st = world?._deckFlight;
  if (!st) return false;
  const B = st.bay;
  _v3.copy(pos);
  st.group.worldToLocal(_v3);
  return Math.abs(_v3.x) <= B.halfW + 0.55
    && _v3.z >= B.front - 0.2 && _v3.z <= B.back + 0.9
    && _v3.y >= B.floor - 1.4 && _v3.y <= B.roof + 0.6;
}

/**
 * ══ THE ORDER TO GO ═══════════════════════════════════════════════════════
 *
 * `Hangar.stepRamp` calls this at the end of the dwell. The company is sent
 * up the ramp — from the line if it is formed, from the crowd if not — and
 * the player is asked to board. Returns false if there is no flight to run,
 * so the caller falls back to asking main.js directly.
 */
export function depart(world) {
  const st = world?._deckFlight;
  if (!st || st.phase !== PHASE.PARKED) return false;
  const c = world._company;
  st.phase = PHASE.BOARD; st.t = 0;
  st.aboard.length = 0;
  if (c) {
    for (let i = 0; i < c.men.length; i++) {
      const row = c.men[i];
      const slot = slotFor(st, i);
      _v2.set(slot.x, slot.y, slot.z);
      st.group.localToWorld(_v2);
      /* Two legs: to the ramp's foot in file, then to his own place. */
      const spot = rampSpot(world, 1.2 + Math.floor(i / 2) * 1.1, (i % 2) ? 0.6 : -0.6, _v);
      row.path = [
        { x: spot.x, z: spot.z },
        { x: _v2.x, z: _v2.z },
      ];
      row.mark = row.path.shift();
      row.from.copy(row.pos);
      row.halted = false;
      row.start = c.t + i * 0.55;
      row.man.facing = Math.PI;
      row.slot = slot;
      /* HIS BODY COMES OFF FOR THE WALK. The file forms where the player is
       * standing — at the ramp's foot, by definition of the dwell — and a
       * dynamic box walked into his capsule is woken and shoved by
       * `Player._collide`, which put the first pair on their backs at the
       * foot of the ramp every time. `takeAboard` disposes it anyway;
       * `putAshore` stands a new one up. */
      try { row.shove?.dispose(); } catch {}
      row.shove = null;
    }
    c.mustered = false;
  }
  world.notify?.('BOARD THE TRANSPORT', 'walk up the ramp — your company is filing in');
  return true;
}

/**
 * A man who has reached his place in the bay is parented into the hull, so
 * he flies with it. `Hangar.stepRow` skips a row with `aboard` set.
 */
function takeAboard(world, st, row) {
  const c = world._company;
  row.aboard = true;
  try { row.shove?.dispose(); } catch {}
  row.shove = null;
  const fig = row.fig;
  st.group.add(fig.root);
  fig.root.position.set(row.slot.x, row.slot.y, row.slot.z);
  fig.root.quaternion.identity();
  row.man.facing = row.slot.yaw ?? 0;
  row.man.stance = 'attention';
  row.pos.set(row.slot.x, row.slot.y, row.slot.z);
  st.group.localToWorld(row.pos);
  st.aboard.push(row);
  void c;
}

/** …and off again, on the deck, at the ramp's foot. */
function putAshore(world, st, row, i) {
  const c = world._company;
  row.aboard = false;
  const fig = row.fig;
  world.scene.add(fig.root);
  const spot = rampSpot(world, 0.8 + Math.floor(i / 2) * 0.9, (i % 2) ? 0.6 : -0.6, _v);
  fig.root.position.set(spot.x, spot.y, spot.z);
  fig.root.quaternion.identity();
  row.pos.copy(fig.root.position);
  row.from.copy(row.pos);
  /* Back to his spot in the crowd. */
  row.path = [{ x: row.home.x, z: row.home.z }];
  row.mark = row.path.shift();
  row.halted = false;
  row.start = (c?.t ?? 0) + i * 0.7;
  row.man.facing = row.home.facing;
  /* And a body again, asleep, walked along by `stepRow` like everyone's. */
  try { makeShovable(world, [row]); row.shove?.retarget(row.pos); } catch {}
}

/** Seat the player where he stands in the bay; he eases to the door slot. */
function seatPlayer(world, st, instant) {
  const p = world.player;
  if (!p || p.riding) return;
  const stand = st.seats.filter((x) => !x.sit);
  const slot = stand[0] || { x: 0, y: st.bay.floor + 0.02, z: st.bay.front + 1.0, yaw: 0, sit: false };
  const to = new THREE.Vector3(slot.x, slot.y, slot.z);
  if (instant) {
    p.riding = { local: to.clone(), to, yaw: slot.yaw, sit: false, t: 1 };
  } else {
    _v3.copy(p.position);
    st.group.worldToLocal(_v3);
    p.riding = { local: _v3.clone(), to, yaw: slot.yaw, sit: false, t: 0 };
  }
  p._extracting = 'aboard';
  p.velocity?.set?.(0, 0, 0);
  p.grounded = true;
  st.seated = true;
  audio.thud?.(p.position, 0.35);
  world.notify?.('ABOARD', 'hold the rail');
}

function releasePlayer(world, st) {
  const p = world.player;
  if (!p) return;
  p.riding = null;
  p._extracting = null;
  const spot = rampSpot(world, 1.4, 0, _v);
  if (p.rig?.root) { p.rig.root.position.set(0, 0, 0); p.rig.root.quaternion.identity(); }
  p.position.set(spot.x, spot.y, spot.z);
  p.velocity?.set?.(0, 0, 0);
  p.grounded = true;
  p._syncBody?.();
  st.seated = false;
  /* The ramp's dwell waits for him to walk away first — see `Hangar.stepRamp`. */
  world._rampArmed = false;
  world._rampHold = 0;
}

/** Everybody riding, put where the hull says they are. `Extraction`'s move. */
function flyPassengers(world, st, dt) {
  const p = world.player;
  if (p?.riding) {
    const r = p.riding;
    if (r.to && r.t < 1) {
      r.t = Math.min(1, r.t + dt / 1.3);
      _v.subVectors(r.to, r.local);
      const left = _v.length();
      if (left <= 2.2 * dt) { r.local.copy(r.to); r.t = 1; }
      else r.local.addScaledVector(_v.multiplyScalar(1 / left), 2.2 * dt);
    }
    _v3.copy(r.local);
    st.group.localToWorld(_v3);
    p.position.copy(_v3);
    p.velocity?.set?.(0, 0, 0);
    p.grounded = true;
    p._syncBody?.();
  }
}

/**
 * ══ THE FRAME ═════════════════════════════════════════════════════════════
 */
export function stepDeckFlight(world, dt) {
  const st = world?._deckFlight;
  if (!st || !(dt > 0) || !st.group?.parent) return;
  st.t += dt;
  st.total = (st.total || 0) + dt;
  const c = world._company;
  const g = st.group;
  const pad = st.pad;

  /* AN ARRIVAL SEATS THE PLAYER THE FRAME HE EXISTS. `embarkCompany` runs
   * from `dressHangar`, and `World.loadLevel` spawns the player AFTER the
   * level is dressed — so the seat it offered was to nobody, and the man
   * flew in standing in the lift car at the far end of the deck. */
  if (!st.seated && world.player && !world.player.riding
    && (st.phase === PHASE.APPROACH || st.phase === PHASE.TURN)) seatPlayer(world, st, true);

  switch (st.phase) {
    case PHASE.PARKED: break;

    case PHASE.BOARD: {
      /* The men reaching their slots are taken aboard by `Hangar.stepRow`
       * calling back through `row.path` — here the ones who have halted on
       * their last mark are parented in. */
      if (c) {
        for (const row of c.men) {
          if (row.aboard || !row.slot) continue;
          if (row.halted && !row.path?.length) takeAboard(world, st, row);
        }
      }
      const p = world.player;
      if (p && !p.riding && inBay(world, p.position)) seatPlayer(world, st, false);
      if (!st.told && st.t > 6 && !st.seated) {
        st.told = true;
        world.notify?.('THE TRANSPORT IS WAITING', 'walk up the ramp into the bay');
      }
      const menIn = !c || c.men.every((r) => r.aboard || !r.slot);
      if (st.seated && menIn) { st.phase = PHASE.SEAL; st.t = 0; world.notify?.('LIFTING', 'hold on'); }
      else if (st.t >= FLIGHT.lastCall) {
        /* LAST CALL: the crew pulls him aboard, and any man still walking is
         * simply put in his place. */
        if (!st.seated) { world.notify?.('LAST CALL', 'the crew is pulling you aboard'); seatPlayer(world, st, true); }
        if (c) for (const row of c.men) if (!row.aboard && row.slot) takeAboard(world, st, row);
        st.phase = PHASE.SEAL; st.t = 0;
      }
      break;
    }

    case PHASE.SEAL: {
      /* The ramp comes up. The doors stay open: the run is through air. */
      const u = st.model?.userData;
      if (u?.ramp) u.ramp.rotation.x = (1 - smoothstep(0, 1, st.t / FLIGHT.seal)) * rampAngle(st);
      setThrust(st, 0.2);
      if (st.t >= FLIGHT.seal) {
        st.phase = PHASE.LIFT; st.t = 0;
        unsolidify(world, st);
        try { launchSequence(world, { x: pad.x, z: pad.z, speed: (DECK.lip - pad.z) / FLIGHT.run }); } catch {}
        audio.noise?.({ dur: 2.2, gain: 0.13, type: 'bandpass', freq: 190, q: 0.8, pos: g.position });
      }
      break;
    }

    case PHASE.LIFT: {
      const k = clamp(st.t / FLIGHT.lift, 0, 1);
      setThrust(st, 0.4 + k * 0.6);
      g.position.y = pad.y + st.hover + smoothstep(0, 1, k) * 3.6;
      g.rotation.x = -0.03 * k;
      if (k >= 1) { st.phase = PHASE.RUN; st.t = 0; st.runFrom = g.position.clone(); }
      break;
    }

    case PHASE.RUN: {
      /* From the pad to the aperture: a quadratic run-up along the deck's
       * axis, drifting onto the centreline, nose lifting a shade. The player
       * stands in the open door and the deck goes past it. */
      const k = clamp(st.t / FLIGHT.run, 0, 1);
      const e = k * k;
      const z = lerp(st.runFrom.z, DECK.lip + 12, e);
      const x = lerp(st.runFrom.x, 0, smoothstep(0, 1, k));
      const y = st.runFrom.y + smoothstep(0, 1, k) * 6;
      g.position.set(x, y, z);
      g.rotation.x = -0.06 * smoothstep(0, 0.6, k);
      setThrust(st, 1);
      /* THE FIELD TAKES IT, once, on the frame the nose crosses the lip. */
      if (!st.punched && z >= DECK.lip - 3) {
        st.punched = true;
        const fx = world.particles;
        _v.set(x, y, DECK.lip);
        fx?.plasma?.spawn?.(_v, _v2.set(0, 0, 0),
          { life: 0.32, size: 6.0, drag: 1, gravity: 0, color: 0xbfe6ff, alpha: 0.9, hdr: 3.2 });
        fx?.sparkBurst?.(_v, _v2.set(0, 0, 1), 22, { speed: 18, color: 0xd8f0ff, hdr: 3.4 });
        world.engine?.lightUp?.(_v, 0xbfe6ff, 40, 30, 0);
        world.player?.camera?.addShake?.(0.18);
        world.notify?.('THROUGH THE FIELD', 'sealing for vacuum');
      }
      if (k >= 1) { st.phase = PHASE.OUT; st.t = 0; st.outFrom = g.position.clone(); }
      break;
    }

    case PHASE.OUT: {
      /* Beyond the lip: the bay stays OPEN and the hull keeps accelerating
       * away from the ship it left, which now stands round the deck at real
       * scale — the deck is one lit mouth in a flank of them. The doors shut
       * only in the last `outSeal` seconds, and the same shut bay is the
       * first frame of the orbit after main.js has built the battlefield
       * behind a still of this one. */
      /* AND YOU CAN SKIP IT, the way the cruise and the orbit can: the same
       * key, after two and a half seconds so a press left over from the ramp
       * cannot eat the look back. The run jumps to its last `outSeal` seconds
       * — the doors still shut before the seam. REVIEW-V12 item 37. */
      const skip = st.t > 2.5 && st.t < FLIGHT.out - FLIGHT.outSeal
        && world._deckInput?.act?.('jump');
      if (skip) st.t = FLIGHT.out - FLIGHT.outSeal;
      if (!st.toldSkip && st.t > 2.5) {
        st.toldSkip = true;
        world.notify?.('CLEAR OF THE SHIP', 'look back — or jump to press on', 'flavour');
      }
      const k = clamp(st.t / FLIGHT.out, 0, 1);
      const sealT = clamp((st.t - (FLIGHT.out - FLIGHT.outSeal)) / FLIGHT.outSeal, 0, 1);
      doors(st, 1 - sealT);
      const d = lerp(0, FLIGHT.outRange, k * k);
      g.position.set(st.outFrom.x, st.outFrom.y + k * 60, st.outFrom.z + d);
      g.rotation.x = -0.08;
      setThrust(st, 1);
      if (k >= 1 && !st.launched) {
        st.launched = true;
        st.phase = PHASE.GONE;
        world.onDeckDeploy?.();
      }
      break;
    }

    case PHASE.GONE: break;

    /* ── THE ARRIVAL ────────────────────────────────────────────────────── */
    case PHASE.APPROACH: {
      const k = clamp(st.t / FLIGHT.approach, 0, 1);
      const e = 1 - Math.pow(1 - k, 2.2);
      const z = lerp(DECK.lip + FLIGHT.far, pad.z, e);
      const y = lerp(70, pad.y + st.hover + 3.0, Math.pow(e, 0.8));
      const x = lerp(0, pad.x, smoothstep(0.5, 1, k));
      g.position.set(x, y, z);
      g.rotation.set(0.10 * (1 - e), 0, 0);
      setThrust(st, 0.6 + 0.3 * (1 - k));
      if (!st.punched && z <= DECK.lip + 3) {
        st.punched = true;
        const fx = world.particles;
        _v.set(x, y, DECK.lip);
        fx?.plasma?.spawn?.(_v, _v2.set(0, 0, 0),
          { life: 0.32, size: 6.0, drag: 1, gravity: 0, color: 0xbfe6ff, alpha: 0.9, hdr: 3.2 });
        world.engine?.lightUp?.(_v, 0xbfe6ff, 40, 30, 0);
        world.player?.camera?.addShake?.(0.16);
      }
      if (k >= 1) { st.phase = PHASE.TURN; st.t = 0; }
      break;
    }

    case PHASE.TURN: {
      /* Over the pad: turn nose-out while settling onto it, which is how a
       * transport parks — ready to leave. */
      const k = clamp(st.t / FLIGHT.turn, 0, 1);
      const e = smoothstep(0, 1, k);
      g.rotation.set(0, e * pad.yaw, 0);
      g.position.y = lerp(pad.y + st.hover + 3.0, pad.y + st.hover, e);
      setThrust(st, 0.5 * (1 - e) + 0.1);
      if (k >= 1) {
        parkAt(st);
        st.phase = PHASE.OPEN; st.t = 0;
        audio.thud?.(g.position, 0.9);
        world.notify?.('ON THE DECK', 'stand by — ramp coming down');
        solidify(world, st);
      }
      break;
    }

    case PHASE.OPEN: {
      setThrust(st, 0.05);
      hatch(st, st.t / FLIGHT.open);
      if (st.t >= FLIGHT.open) {
        hatch(st, 1);
        st.phase = PHASE.UNLOAD; st.t = 0;
        releasePlayer(world, st);
        let i = 0;
        for (const row of st.aboard.slice()) putAshore(world, st, row, i++);
        st.aboard.length = 0;
        st.arrived = true;
        world.onDeckArrived?.();
      }
      break;
    }

    case PHASE.UNLOAD: {
      setThrust(st, 0);
      if (st.t >= FLIGHT.unload) { st.phase = PHASE.PARKED; st.t = 0; }
      break;
    }
    default: break;
  }
  stepFlames(st, st.total);
  if (st.phase !== PHASE.PARKED && st.phase !== PHASE.BOARD) flyPassengers(world, st, dt);
  else if (st.seated) flyPassengers(world, st, dt);
  /* The ship round the room is drawn while the eye is past the lip. */
  const camZ = world.engine?.camera?.position?.z;
  setExteriorSeen(world, camZ !== undefined && camZ > DECK.lip - 2);
}

/**
 * For an arrival: the company is already in the hull. Called by
 * `Hangar.dressHangar` after `callTheCompany`, before the first frame.
 */
export function embarkCompany(world) {
  const st = world?._deckFlight;
  const c = world?._company;
  if (!st || !c) return 0;
  let i = 0;
  for (const row of c.men) {
    row.slot = slotFor(st, i++);
    takeAboard(world, st, row);
  }
  seatPlayer(world, st, true);
  return i;
}

/** The phase name, for a HUD or a check. */
export function flightPhase(world) { return world?._deckFlight?.phase ?? null; }

export function undressDeckFlight(world) {
  undressDeckExterior(world);
  const st = world?._deckFlight;
  if (!st) return;
  unsolidify(world, st);
  st.group.parent?.remove(st.group);
  world._deckFlight = null;
}
