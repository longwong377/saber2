/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE LIFT — how you arrive on the deck, and how you leave it for the menu
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's words, and they are the whole design:
 *
 *   "right now you just teleport in the front of the hangar when you spawn in
 *    but I want a very short solo elevator ride (it has windows where you see
 *    you're going either up or down at immense speeds like the ground you're
 *    covering is insane) anywhere after a short ride the elevator door opens
 *    and you have to actually walk out of the elevator and into the hangar
 *    (the elevator door closes and leaves)"
 *
 *   "maybe when you're in the hangar calling for an elevator and getting in
 *    the elevator and doing the ride takes you back to the main menu"
 *
 * And then, of the first car, scoring it 3/10:
 *
 *   "the overall detail of the elevator needs to be significantly more
 *    detailed for god's sake two of the walls are just a bare slab of nothing
 *    like there's a bare grey wall and a bare white wall, what are we doing
 *    here? we need this to be immersive as fuck … there should be way more
 *    going on and also you should be seeing simulated stuff whizzing past you
 *    through the windows like obviously none of it has to be real but it has
 *    to look like you're whizzing through different parts of the ship … it
 *    doesn't even have doors when you're inside it's just a bare colour wall
 *    you just phase through"
 *
 * Every clause of that is a section of this file now.
 *
 * ── WHAT IT IS ─────────────────────────────────────────────────────────────
 *
 * A car set into the bulkhead's own thickness, its floor the deck plate, its
 * doors on the deck side. The spawn is INSIDE it. For `RIDE.ride` seconds the
 * shaft streams past THREE windows — both sides and the back — at a speed
 * that ramps up and back down, and then the car stops with a bump, chimes,
 * and the doors part. The player walks out on his own feet; nothing moves
 * him. When he is clear the doors close and the car goes: the call lamp goes
 * red.
 *
 * To leave, he walks back to the doors and presses the deck's one interact
 * key. The lamp goes amber, the car arrives, the doors open; he steps in, the
 * doors close, the shaft streams the OTHER way, and `world.onDeckLeave` is
 * raised — which `main.js` answers with the menu.
 *
 * ── THE CAR, EVERY SURFACE ────────────────────────────────────────────────
 *
 * "a bare grey wall and a bare white wall". The first car was six boxes. Now
 * each side wall is a dado band with ribs and a kick plate under a handrail,
 * a sill, two panes with a mullion and a wide post at each end, a pane-head
 * trim, and a light strip recessed between two lips under the ceiling. The
 * back wall is the same below and above, with a big pane between the stiles
 * and the faction's crest on a plate under the sill. The ceiling is coffered
 * — dark beams, six lit panels between them — with a hatch. The floor is a
 * tread plate with a lit strip round its edge. By the doors a control panel:
 * a column of lit buttons, a red status lamp, and a readout that counts the
 * decks as the shaft goes by and lands on FLIGHT DECK when the car does.
 *
 * All of it is composed into one mesh per material (`Bins`), so the car with
 * its four door leaves, three panes, readout and button column is thirty-odd
 * draws, not three hundred. `tools/checks/hangar.mjs` bounds the room at 320.
 *
 * ── THE DOORS, FROM BOTH SIDES ────────────────────────────────────────────
 *
 * "it doesn't even have doors when you're inside it's just a bare colour wall
 * you just phase through". It was worse than that: the lobby's shaft face
 * ran straight across the car's mouth, and the leaves were OUTSIDE the car.
 * The front is an assembly now, from the inside out: a reveal and a lintel
 * with an edge glow, the INNER leaves in a pocket, the lobby's mid plate,
 * the OUTER leaves — the shaft doors — in their pocket, and the door frame
 * proud of the bulkhead. Both pairs part together. Each leaf carries a seam
 * glow on its meeting edge, an inset panel, a kick plate and a dark window
 * slit, so it reads as a door from either side; and a closed lift from the
 * deck is a closed door in a frame, with the car somewhere behind it.
 *
 * ── THE SHAFT SCENE ───────────────────────────────────────────────────────
 *
 * "you should be seeing simulated stuff whizzing past you through the
 * windows … it has to look like you're whizzing through different parts of
 * the ship". Three layers at three depths behind each window, all streaming
 * together with `st.v` and wrapping over `SPAN`, so the speed reads as
 * parallax:
 *
 *   NEAR   the guide rails with their ties, and the light bars — which
 *          flare as they pass the window, the sweep of a lamp going by;
 *   MID    girders every three metres, pipe crossings, a ladder with its
 *          rungs, a cable tray, conduit with red status lamps;
 *   FAR    the ship: a deck level every `LEVEL` metres — a floor slab, a
 *          ceiling slab, and between them an opening onto a VIGNETTE: a
 *          medbay, a brig, a reactor gallery, a firefight, a burning deck,
 *          a cantina, a tram crossing, a bulkhead with its deck number lit
 *          in metre-high digits that count with the readout … fifty-odd
 *          of them (`vignettes()`), each with its own colour of light, its
 *          own furniture, people in poses (a head, a torso, legs, arms — not
 *          boxes), and something moving: fans turn, a tram slides across,
 *          bolts flash, fires flicker, a man on the landing raises a hand.
 *
 * Every kind of element is ONE `InstancedMesh` — nine kinds for the whole
 * strip, with `instanceColor` carrying each vignette's palette — whose
 * matrices are laid out each frame (`layScene`); nothing is allocated after
 * the build. THE FAR STRIP DOES NOT WRAP: it is laid for the whole ride in
 * plus the whole ride out, and each of the three faces shuffles the
 * vignettes in its own order, so no window shows the same level twice and
 * the three windows never show the same thing at once. The ride ends SNAPPED
 * to a level: the last 1.4 s of the ramp down nudges the scroll onto a
 * landing so the stopped car looks out on a lift landing with people
 * waiting for it rather than on half a girder.
 *
 * ── WHY THE CAR NEVER MOVES ────────────────────────────────────────────────
 *
 * The ride is entirely the windows. Moving a room the player is standing in
 * through a heightfield is a body falling out of it (see `Extraction`'s notes
 * on seats), and a lift that genuinely climbs 40 m needs 40 m of shaft over a
 * deck that has a ceiling. What sells a lift is the shaft going past, the
 * acceleration you feel in it, and the doors — so the scene moves and the car
 * does not, and the player's whole body is the ordinary walking body on the
 * ordinary deck for every frame of it. The one thing the car does is SWAY: a
 * few centimetres of low-frequency wobble, scaled by the speed so it is gone
 * at the stop, and it is the car GROUP that sways, never the floor he stands
 * on. The light dips when the car pulls away and again at the bump.
 *
 * ── WHERE THE SHAFT IS HIDDEN ──────────────────────────────────────────────
 *
 * Inside the bulkhead mass. The shaft is a closed box behind the lobby's
 * face — side walls at ±7.6, a back wall at −108.6 — and the only openings
 * in it are the car's panes and the doorway. From the deck there is no line
 * of sight into it while a door is shut, and with the doors open the only
 * way in is through the doorway itself, which is what a doorway is.
 * `tools/checks/decklift.mjs` fires the rays that prove both.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { audio } from '../engine/Audio.js';
import { clamp, smoothstep } from '../engine/MathUtil.js';
import { deckMats, insigniaPanel } from './DeckKit.js';
/* `DECK`/`LIFT` are read inside functions only: Hangar.js imports this file,
 * so at evaluation time both are in the temporal dead zone. See the note over
 * `frame()` in DeckLife.js for the trap. */
import { DECK, LIFT } from './Hangar.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _X = new THREE.Vector3(1, 0, 0);
/** The spin axis, for a car standing in a shaft that is not the deck's. */
const _Y = new THREE.Vector3(0, 1, 0);

/**
 * THE TIMINGS. `ride` is the number that decides how the room is entered:
 * long enough to look out of a window and read the speed, short enough that
 * a player who has been here before is not made to wait. Both rides are the
 * same length; the one out is the same lift.
 */
export const RIDE = {
  /** Seconds before the shaft starts to move: the doors have just shut. */
  settle: 0.5,
  /** Seconds of shaft going past: about thirty levels at cruise. */
  ride: 5.5,
  /** How long the doors take to open or close. */
  doors: 1.1,
  /** Seconds after the player is clear before the doors close behind him. */
  linger: 1.4,
  /** How long a called car takes to arrive. */
  arrive: 2.6,
  /** The shaft's cruising speed past the window, in metres a second. */
  speed: 46,
  /** How far from the doors the call key is listened for. */
  reach: 5.5,
  /** The last seconds of the ride, over which it decelerates and snaps to a landing. */
  brake: 1.4,
};

/** The states, in the order a visit meets them. */
export const STATE = {
  RIDE: 'ride', STOP: 'stop', OPENING: 'opening', OUT: 'out', CLOSING: 'closing',
  AWAY: 'away', CALLED: 'called', ARRIVING: 'arriving', WAIT: 'wait', SEAL: 'seal',
  LEAVE: 'leave', GONE: 'gone',
};

/**
 * THE DOORWAY. Narrower and lower than the car, so the leaves have a frame
 * to sit in and a pocket to slide into. `Hangar.liftLobby` builds the lobby
 * half of the assembly from the same two numbers — it cannot import this
 * file's constants without widening a circular import, so it derives them
 * from `LIFT` the same way: `halfW - 0.6` and `height - 0.7`. The check fires
 * a ray down each edge of the opening to prove the two still agree.
 */
export const DOOR = {
  get halfW() { return LIFT.halfW - 0.6; },
  get height() { return LIFT.height - 0.7; },
  /** The inner leaves' plane, aft of the lobby face. */
  get zIn() { return LIFT.door - 0.55; },
  /** The outer (shaft) leaves' plane, in the lobby's face. */
  get zOut() { return LIFT.door - 0.08; },
  /** How far a leaf slides outboard to open. */
  slide: 2.5,
  /** Each leaf's width: half the opening less the seam. */
  get leafW() { return this.halfW - 0.02; },
};

/** The shaft scene's pitch of deck levels: a room 6.25 m tall between slabs. */
export const LEVEL = 7;
/** The wrap of the NEAR and MID layers (rails, rungs, girders, light bars).
 * The FAR strip — the levels — does not wrap; see `buildShaft`. */
const SPAN = LEVEL * 7;
/** The number on the readout when the car stops on the flight deck. */
export const FLIGHT_DECK = 32;

/**
 * ══ THE FLOOR SELECTOR — SHARK §5.2, and it is the station's whole door ═══
 *
 * "First cut: two floors, FLIGHT DECK 32 and CONCOURSE 40; every vignette at a
 * real floor's number is that place." The readout has counted levels since the
 * day it was built and the button column has been six modelled buttons with
 * the fifth lit; this makes both of them mean something.
 *
 * THE LIST IS SET FROM OUTSIDE, and that is load-bearing rather than tidy.
 * This file cannot import `Station.js`: the lift is the hangar's and the
 * station is downstream of it, so an import here would be a cycle of exactly
 * the kind `Levels.js` records dying on one suite's import order after running
 * green for hours. `Levels.js` owns the roster, knows what floors exist, and
 * hands them down — the same direction the deck's own registration points.
 *
 * With the switch off (§9.2) nobody calls the setter, the list is one row, the
 * button column does nothing and the ride out ends on the menu exactly as it
 * does today. That is what `station.mjs`'s recorded trace holds.
 */
export const MENU_FLOOR = { n: 7, label: 'BRIDGE', level: null };
let FLOORS = [MENU_FLOOR];

/** Replace the floor list. Called from `Levels.js` behind `STATION_ENABLED`. */
export function setLiftFloors(rows) {
  FLOORS = (rows && rows.length) ? rows.slice() : [MENU_FLOOR];
}

/** The floors the car will stop at, in the order the button column cycles. */
export function liftFloors() { return FLOORS; }

/** The floor currently selected in the car. */
export function liftPick(world) {
  const st = world?._deckLift;
  return FLOORS[st ? (st.pick | 0) % FLOORS.length : 0];
}
/** Seven-segment digits: a b c d e f g, clockwise from the top, g the middle. */
const SEVEN = [
  [1, 1, 1, 1, 1, 1, 0], [0, 1, 1, 0, 0, 0, 0], [1, 1, 0, 1, 1, 0, 1], [1, 1, 1, 1, 0, 0, 1],
  [0, 1, 1, 0, 0, 1, 1], [1, 0, 1, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 0, 1, 1],
];
/** Where each segment sits on a digit `h` tall, `w` wide: [u, v, horizontal]. */
const SEG_AT = (w, h) => [
  [0, h / 2, 1], [w / 2, h / 4, 0], [w / 2, -h / 4, 0], [0, -h / 2, 1],
  [-w / 2, -h / 4, 0], [-w / 2, h / 4, 0], [0, 0, 1],
];

/* ══════════════════════════════════════════════════════════════════════════ */
/*  BINS — one mesh per material, so a detailed car is not a hundred draws    */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A pocket `DeckBuild`: collects box geometries per material and emits one
 * merged mesh per bin, named for the bin, onto a parent. Written here rather
 * than through the kit because the kit builds onto `world.scene` under one
 * name and never moves; the car's leaves slide and its whole group sways, so
 * every piece has to be a child of something that does. `insigniaPanel` only
 * needs `geoAt` and `faction` of a kit, so it draws into this too.
 */
class Bins {
  constructor(faction) { this.faction = faction; this.bins = new Map(); }
  geoAt(mat, geo, x, y, z) {
    geo.translate(x, y, z);
    if (!this.bins.has(mat)) this.bins.set(mat, []);
    this.bins.get(mat).push(geo);
    return this;
  }
  box(mat, x, y, z, w, h, d) { return this.geoAt(mat, new THREE.BoxGeometry(w, h, d), x, y, z); }
  /** Emit, naming each mesh `${prefix}-${material key}`. */
  build(parent, prefix, keyOf, out = []) {
    for (const [mat, geos] of this.bins) {
      if (!geos.length) continue;
      const m = new THREE.Mesh(mergeBoxes(geos), mat);
      m.name = `${prefix}-${keyOf(mat)}`;
      m.castShadow = false; m.receiveShadow = true;
      parent.add(m);
      out.push(m);
    }
    this.bins.clear();
    return out;
  }
}

/** Merge position/normal/uv geometries into one. `DeckKit.mergeFlat` is not
 * exported and this is the same twenty lines; the packer inlines both. */
function mergeBoxes(geos) {
  let verts = 0, idx = 0;
  for (const g of geos) { verts += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  const ind = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) ind[io + i] = gi[i] + vo;
    else for (let i = 0; i < p.count; i++) ind[io + i] = i + vo;
    io += gi ? gi.length : p.count;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}

/** A small deterministic hash in [0, 1), for jittering silhouettes. */
function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build the car and start the ride. Call after `dressHangar` (the lobby it
 * sits in is the kit's) and before the first frame. Returns the state that
 * `stepDeckLift` reads, also hung on `world._deckLift`.
 *
 * @param opts.arrive   the ride is skipped and the doors open at once — a
 *                      player who came in on a ship is not in the lift.
 */
export function dressDeckLift(world, opts = {}) {
  const prev = world._deckLift;
  if (prev && prev.car?.parent) return prev;
  const M = deckMats(world._deckFaction);
  const L = LIFT;
  const cx = L.x, cz = L.z, hw = L.halfW, hd = L.halfD, H = L.height;
  const car = new THREE.Group();
  car.name = 'deck-lift';
  const key = (mat) => mat.userData.key || (mat.name || '').replace(/^deck-\w+-/, '') || 'mat';

  /* ── THE CAR'S OWN MATERIALS: the ones the kit's palette does not carry.
   * The car's light is a clone of the kit's glow so it can DIP without
   * dimming the aperture rim; the panes are glass; the door slits are dark
   * glass you cannot see through (so the shaft stays hidden with the doors
   * shut, and so a slit is a slit and not a hole). */
  const lightMat = M.glow.clone(); lightMat.name = 'car-light'; lightMat.userData.saberNoInk = true;
  lightMat.userData.key = 'light';
  const glass = new THREE.MeshBasicMaterial({ color: 0x0c1220, transparent: true, opacity: 0.18,
    depthWrite: false, side: THREE.DoubleSide, name: 'car-pane' });
  glass.userData.saberNoInk = true; glass.userData.key = 'pane';
  const slitMat = new THREE.MeshBasicMaterial({ color: 0x0f1622, name: 'car-slit' });
  slitMat.userData.saberNoInk = true; slitMat.userData.key = 'slit';

  /* THE CAR'S WALLS ARE ITS OWN MATERIALS — clones of the kit's four — so
   * they can be DIMMED for the ride without dimming the deck: with the car
   * at full brightness the window was a small pale rectangle in a glaring
   * white box, and the ship going past lost to the room you stood in. */
  const CM = {};
  for (const k of ['hull', 'dark', 'deep', 'glowDim']) {
    const m = M[k].clone(); m.name = `car-${k}`; m.userData.key = k; m.userData.base = M[k].color.clone();
    if (m.emissive) m.userData.baseEm = m.emissive.clone();
    CM[k] = m;
  }
  const B = new Bins(M.faction);
  /* THE PANES: sill to ceiling strip, post to post. "The player must see the
   * passing ship, not the car." */
  const paneY0 = 0.9, paneY1 = 3.5;
  const inner = hw - 0.12;          /* the walls' inner face */
  const post = 0.3;                 /* the post at each end of a side pane */
  const zF = cz + hd, zA = cz - hd; /* the car's front (doors) and aft (back wall) */

  /* ── THE SIDE WALLS. */
  for (const s of [-1, 1]) {
    const x = cx + s * hw, f = cx + s * inner;
    B.box(CM.hull, x, paneY0 / 2, cz, 0.24, paneY0, hd * 2);
    B.box(CM.hull, x, (H + paneY1) / 2, cz, 0.24, H - paneY1, hd * 2);
    /* Posts at each end; one thin bar where the mullion was. */
    B.box(CM.hull, x, (paneY0 + paneY1) / 2, zF - post / 2, 0.26, paneY1 - paneY0, post);
    B.box(CM.hull, x, (paneY0 + paneY1) / 2, zA + post / 2, 0.26, paneY1 - paneY0, post);
    B.box(CM.dark, x, (paneY0 + paneY1) / 2, cz, 0.26, paneY1 - paneY0, 0.05);
    /* The pane head trim and the sill. */
    B.box(CM.dark, f - s * 0.015, paneY1 + 0.03, cz, 0.05, 0.06, hd * 2 - 0.2);
    B.box(CM.glowDim, f - s * 0.04, paneY0 - 0.04, cz, 0.08, 0.08, hd * 2 - 0.4);
    /* Under the sill: the dado band, its ribs, the kick plate, the handrail. */
    B.box(CM.dark, f - s * 0.02, 0.42, cz, 0.04, 0.44, hd * 2 - 0.3);
    for (let i = 0; i < 8; i++) B.box(CM.hull, f - s * 0.045, 0.42, zA + 0.5 + i * 0.72, 0.05, 0.4, 0.08);
    B.box(CM.dark, f - s * 0.015, 0.07, cz, 0.03, 0.14, hd * 2);
    B.box(CM.hull, f - s * 0.09, 0.76, cz, 0.06, 0.06, hd * 2 - 0.5);
    for (const dz of [-2.0, 0, 2.0]) B.box(CM.dark, f - s * 0.045, 0.76, cz + dz, 0.09, 0.04, 0.06);
    /* Over the pane: the light strip, recessed between two lips. */
    B.box(CM.deep, f - s * 0.025, 3.78, cz, 0.05, 0.03, hd * 2 - 0.5);
    B.box(CM.deep, f - s * 0.025, 3.56, cz, 0.05, 0.03, hd * 2 - 0.5);
    B.box(lightMat, f - s * 0.01, 3.67, cz, 0.02, 0.16, hd * 2 - 0.6);
    /* The panel lines on the upper wall. */
    for (const dz of [-1.5, 1.5]) B.box(CM.dark, f - s * 0.01, 3.98, cz + dz, 0.02, 0.24, 0.05);
  }

  /* ── THE BACK WALL, which is a window too. */
  {
    const z = zA, f = zA + 0.12;
    B.box(CM.hull, cx, paneY0 / 2, z, hw * 2 + 0.48, paneY0, 0.24);
    B.box(CM.hull, cx, (H + paneY1) / 2, z, hw * 2 + 0.48, H - paneY1, 0.24);
    for (const s of [-1, 1]) B.box(CM.hull, cx + s * (hw - 0.15), (paneY0 + paneY1) / 2, z, 0.3, paneY1 - paneY0, 0.3);
    B.box(CM.dark, cx, (paneY0 + paneY1) / 2, z, 0.05, paneY1 - paneY0, 0.26);
    B.box(CM.dark, cx, paneY1 + 0.03, f + 0.015, hw * 2 - 0.4, 0.06, 0.05);
    B.box(CM.glowDim, cx, paneY0 - 0.04, f + 0.04, hw * 2 - 0.6, 0.08, 0.08);
    /* Dado either side of the crest plate, ribs, kick, handrail. */
    for (const s of [-1, 1]) {
      B.box(CM.dark, cx + s * 1.9, 0.42, f + 0.02, 1.9, 0.44, 0.04);
      for (let i = 0; i < 2; i++) B.box(CM.hull, cx + s * (1.3 + i * 0.8), 0.42, f + 0.045, 0.08, 0.4, 0.05);
    }
    B.box(CM.dark, cx, 0.42, f + 0.03, 1.4, 0.56, 0.06);
    insigniaPanel(B, cx, 0.42, f + 0.075, 0.46, { faction: M.faction, thickness: 0.03 });
    B.box(CM.dark, cx, 0.07, f + 0.015, hw * 2, 0.14, 0.03);
    B.box(CM.hull, cx, 0.76, f + 0.09, hw * 2 - 0.5, 0.06, 0.06);
    for (const dx of [-2.0, 0, 2.0]) B.box(CM.dark, cx + dx, 0.76, f + 0.045, 0.06, 0.04, 0.09);
    B.box(CM.deep, cx, 3.78, f + 0.025, hw * 2 - 0.5, 0.03, 0.05);
    B.box(CM.deep, cx, 3.56, f + 0.025, hw * 2 - 0.5, 0.03, 0.05);
    B.box(lightMat, cx, 3.67, f + 0.01, hw * 2 - 0.6, 0.16, 0.02);
  }

  /* ── THE FRONT: reveal, lintel, and the glow along the frame's edge. */
  const DW = DOOR.halfW, DH = DOOR.height;
  B.box(CM.hull, cx, (H + DH) / 2, zF - 0.5, hw * 2, H - DH, 1.0);
  B.box(lightMat, cx, DH + 0.02, zF - 0.85, DW * 2 - 0.2, 0.04, 0.12);
  for (const s of [-1, 1]) {
    B.box(CM.hull, cx + s * (DW + 0.3), DH / 2, zF - 0.85, 0.6, DH, 0.3);
    B.box(CM.glowDim, cx + s * (DW + 0.02), DH / 2 - 0.1, zF - 0.85, 0.04, DH - 0.2, 0.12);
    B.box(CM.dark, cx + s * (DW + 0.3), 0.07, zF - 0.85, 0.6, 0.14, 0.32);
  }
  /* The threshold plate. */
  B.box(CM.hull, cx, 0.03, zF - 0.72, DW * 2, 0.06, 0.24);

  /* ── THE CEILING: the slab, coffer beams, six lit panels, a hatch. */
  const ceilD = hd * 2 - 0.24;
  const czC = cz - 0.12;
  B.box(CM.hull, cx, H + 0.12, czC, hw * 2 + 0.48, 0.24, ceilD + 0.48);
  for (const dx of [-1.05, 1.05]) B.box(CM.dark, cx + dx, H - 0.06, czC, 0.16, 0.12, ceilD);
  for (const dz of [-1.7, 0, 1.7]) B.box(CM.dark, cx, H - 0.06, czC + dz, hw * 2, 0.12, 0.16);
  for (const dx of [-2.0, 0, 2.0]) for (const dz of [-0.85, 0.85]) {
    if (dx === 0 && dz === -0.85) continue; /* the hatch's bay */
    B.box(lightMat, cx + dx, H - 0.015, czC + dz, 1.5, 0.03, 1.3);
  }
  B.box(CM.deep, cx, H - 0.02, czC - 0.85, 1.1, 0.04, 0.95);
  for (const s of [-1, 1]) {
    B.box(CM.hull, cx + s * 0.6, H - 0.04, czC - 0.85, 0.08, 0.08, 1.1);
    B.box(CM.hull, cx, H - 0.04, czC - 0.85 + s * 0.52, 1.28, 0.08, 0.08);
  }
  /* AND A LIGHT IN THE CAR. The panels are what you see; this is what they
   * do to the walls. The first frame of this room was a black box with a
   * pale strip on its lid, because the deck's lamps are twenty metres away
   * and the bulkhead is between them and the car. One point light, short
   * range, on the level's list so it goes with the level. */
  const glow = new THREE.PointLight(0xdbe6fb, 90, 12, 2);
  glow.position.set(cx, H - 0.5, cz);
  world.scene.add(glow);
  world.levelLights?.push(glow);

  /* ── THE FLOOR: tread plate, and a lit strip round its edge. */
  B.box(CM.dark, cx, 0.012, cz - 0.1, hw * 2 - 0.2, 0.024, hd * 2 - 0.4);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 8; j++) {
    const x = cx - 2.4 + i * 0.8 + (j % 2) * 0.4, z = zA + 0.55 + j * 0.66;
    B.box(CM.hull, x, 0.03, z, 0.34, 0.012, 0.06);
    B.box(CM.hull, x, 0.03, z + 0.14, 0.06, 0.012, 0.22);
  }
  B.box(CM.glowDim, cx, 0.02, zF - 0.30, DW * 2, 0.02, 0.10);
  B.box(CM.glowDim, cx, 0.02, zA + 0.30, hw * 2 - 0.5, 0.02, 0.08);
  for (const s of [-1, 1]) B.box(CM.glowDim, cx + s * (inner - 0.16), 0.02, cz, 0.08, 0.02, hd * 2 - 0.6);

  /* ── THE CONTROL PANEL, by the doors on the right. */
  const px = cx + inner - 0.05, pz = zF - 1.35;
  B.box(CM.dark, px, 1.75, pz, 0.08, 1.5, 0.5);
  B.box(CM.hull, px - 0.03, 1.75, pz, 0.04, 1.56, 0.56);
  const carMeshes = B.build(car, 'car', key);
  const buttons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.09, 0.09), M.glowDim, 6);
  buttons.frustumCulled = false;
  buttons.name = 'car-buttons';
  for (let i = 0; i < 6; i++) {
    _v.set(px - 0.055, 1.25 + i * 0.16, pz - 0.12);
    buttons.setMatrixAt(i, _m.compose(_v, _q.identity(), _s));
    buttons.setColorAt(i, _c.setScalar(i === 4 ? 1.0 : 0.45));
  }
  car.add(buttons);
  const status = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.08), M.status);
  status.name = 'car-status';
  status.position.set(px - 0.055, 1.08, pz + 0.14);
  car.add(status);
  const readout = makeReadout(M);
  readout.mesh.position.set(px - 0.075, 2.3, pz + 0.1);
  readout.mesh.rotation.y = -Math.PI / 2;
  car.add(readout.mesh);

  /* ── THE PANES: dark glass, transparent enough to see the shaft through.
   * Three planes, one mesh. */
  const paneGeos = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(hd * 2 - post * 2, paneY1 - paneY0);
    g.rotateY(s * Math.PI / 2);
    g.translate(cx + s * (hw - 0.02), (paneY0 + paneY1) / 2, cz);
    paneGeos.push(g);
  }
  paneGeos.push(new THREE.PlaneGeometry(hw * 2 - 0.6, paneY1 - paneY0).translate(cx, (paneY0 + paneY1) / 2, zA + 0.02));
  const paneMesh = new THREE.Mesh(mergeBoxes(paneGeos), glass);
  paneMesh.name = 'car-pane';
  car.add(paneMesh);
  const panes = [paneMesh];

  /* ── THE DOORS. Two inner leaves in the car, two outer in the lobby face.
   * Each leaf: body, inset panel, kick, seam glow, a dark window slit. */
  const leaf = (s, z, prefix, group) => {
    const g = new THREE.Group();
    g.position.set(cx + s * DOOR.leafW / 2, 0, z);
    const W = DOOR.leafW, T = 0.2;
    B.box(CM.hull, 0, DH / 2, 0, W, DH, T);
    B.box(CM.dark, -s * 0.15, DH / 2 + 0.25, 0, W - 0.7, DH - 1.3, T + 0.02);
    B.box(CM.dark, 0, 0.13, 0, W, 0.26, T + 0.02);
    B.box(CM.glowDim, -s * (W / 2 - 0.03), DH / 2, 0, 0.05, DH - 0.2, T + 0.02);
    B.box(CM.dark, -s * 0.45, 2.15, 0, 0.36, 1.3, T + 0.03);
    B.box(slitMat, -s * 0.45, 2.15, 0, 0.24, 1.14, T + 0.04);
    B.box(CM.hull, s * 0.5, 1.1, 0, 0.06, 0.4, T + 0.04);
    B.build(g, prefix, key);
    group.add(g);
    return g;
  };
  const doors = [], outerDoors = [];
  const outer = new THREE.Group();
  outer.name = 'deck-lift-outer';
  for (const s of [-1, 1]) {
    doors.push(leaf(s, DOOR.zIn, 'car-door', car));
    outerDoors.push(leaf(s, DOOR.zOut, 'lift-outer', outer));
  }

  /* ── THE CALL LAMP on the lobby's panel, red while the car is away. */
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x3adf7a, toneMapped: false });
  lampMat.userData.saberNoInk = true;
  const call = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.12), lampMat);
  call.name = 'lift-call';
  call.position.set(cx + hw + 1.6, 1.55, L.door + 0.68);
  outer.add(call);

  /* ── HOW FAR THE RIDE GOES, so it can end on a landing. The speed profile
   * is integrated once here at the frame rate the game steps at; the ride
   * length is rounded to whole levels and the last `brake` seconds nudge the
   * scroll onto it (see STATE.RIDE). The ride OUT is integrated the same way,
   * and the far strip is laid long enough for both plus the box's height at
   * each end, so no window shows a level twice. */
  let dist = 0, tail = 0;
  for (let t = 0; t < RIDE.ride; t += 1 / 60) {
    const k = smoothstep(0, 0.9, t) * (1 - smoothstep(RIDE.ride - RIDE.brake, RIDE.ride, t));
    dist += RIDE.speed * k / 60;
    if (t >= RIDE.ride - RIDE.brake) tail += RIDE.speed * k / 60;
  }
  const rideLen = Math.round(dist / LEVEL) * LEVEL;
  let leaveLen = 0;
  for (let t = 0; t < RIDE.ride * 0.62; t += 1 / 60) leaveLen += RIDE.speed * smoothstep(0, 0.9, t) / 60;
  const margin = Math.ceil(BOX_HALF / LEVEL) + 1;
  const layout = {
    lo: -margin,
    landing: Math.round(rideLen / LEVEL),
    hi: Math.round(rideLen / LEVEL) + Math.ceil(leaveLen / LEVEL) + margin,
  };

  /* ── THE SHAFT SCENE the panes look into. */
  const scene = buildShaft(world, M, lightMat, layout);
  /**
   * ══ WHERE THE CAR STANDS, WHICH USED TO BE ONE PLACE ══════════════════
   *
   * Everything above is built at `LIFT`'s own (x, z) with the doors facing
   * −Z, because for as long as this file has existed there has been exactly
   * one lift shaft in the game and it is in the flight deck's aft bulkhead.
   * The station has three (SHARK §3.1 rule 3) and none of them is there.
   *
   * So the assembly is built in LIFT SPACE and PLACED. Three groups and the
   * glow carry the whole car, its outer leaves and the shaft scene, so an
   * offset and a yaw on those four move all of it — and the four things that
   * ask "where is the player relative to the doors" transform into lift
   * space through `toLift` rather than each keeping its own copy of the
   * arithmetic. The default is the identity, so the deck is untouched.
   */
  const at = opts.at || null;
  const OX = at ? at.x - L.x : 0, OZ = at ? at.z - L.z : 0, OY = at?.y || 0;
  const OA = at?.yaw || 0;
  if (OX || OZ || OY || OA) {
    for (const g of [car, outer, scene.group, glow]) {
      /* Rotate about the car's own axis, then move: a group whose children
       * are at absolute coordinates has to be spun about the point those
       * coordinates are relative to, which is the shaft's centre. */
      g.position.set(
        L.x + OX - (L.x * Math.cos(OA) + L.z * Math.sin(OA)),
        OY,
        L.z + OZ - (-L.x * Math.sin(OA) + L.z * Math.cos(OA)),
      );
      g.rotation.y = OA;
    }
  }
  world.scene.add(car, outer, scene.group);
  world.statics.push(car, outer, scene.group);

  /* ── THE COLLIDERS. The car's walls, roof and the jambs either side of the
   * doorway are permanent; the door pair is one box that exists only while
   * the leaves are shut. */
  const P = world.physics;
  const q = new THREE.Quaternion().setFromAxisAngle(_Y, OA);
  const solids = [];
  /* Lift space → world: the same transform the groups got, applied to a point. */
  const place = (x, y, z, out = new THREE.Vector3()) => out.set(
    (x * Math.cos(OA) + z * Math.sin(OA)) + (L.x + OX - (L.x * Math.cos(OA) + L.z * Math.sin(OA))),
    y + OY,
    (-x * Math.sin(OA) + z * Math.cos(OA)) + (L.z + OZ - (-L.x * Math.sin(OA) + L.z * Math.cos(OA))),
  );
  if (P?.addStaticBox) {
    const box = (x, y, z, hx, hy, hz) => P.addStaticBox(place(x, y, z),
      new THREE.Vector3(hx, hy, hz), q, { friction: 0.7 });
    for (const s of [-1, 1]) solids.push(box(cx + s * (hw + 0.12), H / 2, cz, 0.16, H / 2 + 0.2, hd + 0.3));
    solids.push(box(cx, H / 2, zA - 0.12, hw + 0.4, H / 2 + 0.2, 0.16));
    solids.push(box(cx, H + 0.14, cz, hw + 0.4, 0.16, hd + 0.3));
    for (const s of [-1, 1]) solids.push(box(cx + s * (DW + 0.4), H / 2, zF - 0.2, 0.4, H / 2, 0.8));
  }

  const st = {
    car, outer, shaft: scene.group, scene, bars: scene.bars, doors, outerDoors, panes,
    /* Where this car stands, so `toLift` can undo it. Zero on the deck. */
    ox: OX, oy: OY, oz: OZ, yaw: OA, place,
    lamp: carMeshes.find((m) => m.material === lightMat) || null,
    lightMat, lightBase: M.glow.color, glow, lampMat, call, readout, buttons, status, solids,
    /** The car's own wall materials, dimmed for the ride. */
    carMats: Object.values(CM),
    /** How dim the car is, 0 lit to 1 riding; eased toward the speed. */
    dimK: 0,
    N: scene.barsPerFace, SPAN, rideLen, tail, leaveLen, layout,
    /** Game seconds since the build, for the scene's animations. */
    time: 0,
    /** The level last passed and when the last whoosh was, for the per-level cue. */
    lastLev: 0, whooshAt: -1,
    /** 0 shut, 1 open. */
    open: 0,
    /** The shaft's speed past the window this frame, signed: + is the car
     *  going up. */
    v: 0,
    /** Where the scene is in its wrap, metres. */
    scroll: 0,
    /** The scroll the scene was last laid at, so a still scene is not relaid. */
    laid: NaN,
    /** The scroll at which the car last stood on the flight deck. */
    stopScroll: -rideLen,
    /** The landing snap: the fix still to apply, and how much of it has been. */
    snapFix: 0, snapK: 0, snapped: false,
    /** The light's dip, 1 at a jolt, decaying. */
    dip: 0,
    state: opts.arrive ? STATE.OPENING : STATE.RIDE,
    /* Which floor the button column is showing. Zero is the menu's, which
     * is what the ride out has always done; §9.2's switch off leaves it the
     * only row and this field permanently 0. */
    pick: 0,
    t: 0,
    /** Set once the player has been told how to call the car. */
    told: false,
    /** True from the frame the leaving ride ends; `onDeckLeave` fires once. */
    left: false,
    doorBox: null,
    dir: 1,
  };
  world._deckLift = st;
  setDoors(world, st, 0);
  /* The doors start shut on a ride and the box goes with them. */
  if (!opts.arrive) shutDoors(world, st);
  else { st.scroll = -rideLen; }
  setReadout(st);
  layScene(st, st.scroll, 0, true);
  if (!opts.arrive) {
    /* The hum of a car in a shaft: a low band that lasts the ride. */
    audio.noise?.({ dur: RIDE.settle + RIDE.ride, gain: 0.09, type: 'lowpass', freq: 160, q: 0.6,
      pos: _v.set(cx, 1.6, cz) });
  }
  return st;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE READOUT — a small lit plate that counts decks                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A canvas texture on a plane: big digits and a caption. Redrawn only when
 * the text changes, which at cruise is about eight times a second. Under the
 * checks' DOM shim the canvas is a stub and nothing is drawn, which is fine:
 * the check reads `readout.text`, not pixels.
 */
function makeReadout(M) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = 256; canvas.height = 128; }
  const ctx = canvas?.getContext?.('2d') || null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x9fb4d0, toneMapped: false, name: 'car-readout' });
  mat.userData.saberNoInk = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), mat);
  mesh.name = 'car-readout';
  const glowHex = '#' + M.glow.color.getHexString();
  const r = {
    mesh, text: '', number: 0, caption: '',
    draw(number, caption) {
      const text = `${number}|${caption}`;
      if (text === r.text) return;
      r.text = text; r.number = number; r.caption = caption;
      if (!ctx) return;
      ctx.fillStyle = '#0a0e15';
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = glowHex;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 74px "Courier New", monospace';
      ctx.fillText(String(number).padStart(2, '0'), 128, 50);
      /**
       * THE CAPTION IS FITTED, NOT TRUNCATED.
       *
       * It was a fixed 24 px, which holds about seventeen Courier characters
       * on a 256-wide canvas — enough for `CONCOURSE` and nothing else. V15
       * §1.1 puts the STATION'S NAME in this caption (`Levels.js`'s floor
       * rows), and a name is up to 18 characters on its own, so a fixed size
       * would print `CROSSROADS · CONCOU` off the edge of the screen. The
       * type steps down until the string fits inside the bezel and stops at
       * 13 px, which is the smallest that is still legible on the plane's 0.42
       * m at arm's length; a name longer than that is cut by `NAME_MAX` at
       * the one place it is set rather than silently here.
       */
      let px = 24;
      for (; px > 13; px--) {
        ctx.font = `bold ${px}px "Courier New", monospace`;
        if (ctx.measureText(caption).width <= 236) break;
      }
      ctx.font = `bold ${px}px "Courier New", monospace`;
      ctx.fillText(caption, 128, 106);
      if (tex) tex.needsUpdate = true;
    },
  };
  return r;
}

/**
 * The button column, lit for the current pick. Six modelled buttons; the one
 * that is chosen is bright and the rest are dim, which is the same instanced
 * colour attribute the column was built with.
 */
function lightButtons(st) {
  const b = st.buttons;
  if (!b?.setColorAt) return;
  const lit = FLOORS.length > 1 ? (st.pick % FLOORS.length) % 6 : 4;
  for (let i = 0; i < 6; i++) b.setColorAt(i, _c.setScalar(i === lit ? 1.0 : 0.45));
  if (b.instanceColor) b.instanceColor.needsUpdate = true;
}

/** What the readout says in this state. */
function setReadout(st) {
  const s = st.state;
  let n = FLIGHT_DECK, cap = 'FLIGHT DECK';
  if (s === STATE.RIDE) {
    const travelled = Math.abs(st.scroll);
    n = FLIGHT_DECK - Math.round(Math.max(0, st.rideLen - travelled) / LEVEL);
    cap = st.t > RIDE.settle ? 'DECK  ▲' : 'DECK';
  } else if (s === STATE.LEAVE || s === STATE.GONE) {
    /* Counting toward the floor that was CHOSEN, and stopping there. It used
     * to count up for ever from 32 because there was nowhere to arrive. */
    const target = FLOORS[st.pick % FLOORS.length];
    const gone = Math.round(Math.abs(st.scroll - st.stopScroll) / LEVEL);
    const up = (target?.n ?? FLIGHT_DECK) >= FLIGHT_DECK;
    n = up ? Math.min(target?.n ?? FLIGHT_DECK + gone, FLIGHT_DECK + gone)
      : Math.max(target.n, FLIGHT_DECK - gone);
    cap = up ? 'DECK  ▲' : 'DECK  ▼';
  } else if (FLOORS.length > 1 && s === STATE.WAIT) {
    /* Waiting with the doors open, the readout is the button column's answer:
     * where this car will take you if you step back and let it seal. */
    const f = FLOORS[st.pick % FLOORS.length];
    n = f.n; cap = String(f.label).toUpperCase();
  }
  st.readout.draw(n, cap);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SHAFT — three faces, three depths, one instanced mesh per kind         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every element lives in a FACE's local frame: `d` outward from the pane,
 * `a` along it, `w` up, where `w` is the strip coordinate (world y less half
 * the car's height, plus the scroll). A face is a quaternion that takes local
 * +x to outward and local +z to along, so one canonical geometry serves all
 * three.
 *
 * NINE KINDS, and everything in the shaft is an instance of one of them:
 *
 *   box     a unit box, lit (standard) — slabs, girders, beams, ties, rungs,
 *           and every piece of furniture; `instanceColor` tints it
 *   plate   a unit box, unlit and bright — the coloured wall at the back of
 *           every opening, which is the vignette's light
 *   glow    a unit box, unlit — lamps, screens, bolts, flames, the light
 *           bars, the deck digits: anything that shines
 *   glass   a unit box, translucent — tanks, holograms, water, steam
 *   cyl     a cylinder along `a` — pipes, warheads, drums, trunks
 *   figure  a unit box, dark — a person's torso, legs and arms
 *   head    a sphere, dark — a person's head, a droid's dome
 *   fighter the parked fighter's outline
 *   fan     a turbine — anything that spins
 *
 * A slot is laid once at build with its face, its `base` on the strip, its
 * depth, its along, its scale, an optional rotation about the face's outward
 * axis, its colour, and an ANIM code; `layScene` writes one matrix (and,
 * when the anim asks for it, one colour) per slot per frame. Nothing is
 * allocated after the build.
 *
 * THE FAR STRIP DOES NOT WRAP. Its levels run from a few below the start of
 * the ride to a few past the end of the ride OUT, so no window ever shows a
 * level twice; slots outside the box's height are collapsed to nothing. The
 * near and mid layers — rails, rungs, ties, girders, light bars — wrap over
 * `SPAN`, because a rung is a rung.
 */

/** Animation codes a slot can carry. */
const A = {
  NONE: 0,
  /** The light bars: brighten as they cross the window. */
  SWEEP: 1,
  /** A seven-segment digit: hidden unless its segment is lit for the number here. */
  DIGIT: 2,
  /** Turn about the outward axis at `rate`. */
  SPIN: 3,
  /** Slide along the opening, wrapping over `span`; hidden past `edge`. */
  SLIDE: 4,
  /** Step-noise brightness (and a little height jitter): fire, sparks, a bad lamp. */
  FLICKER: 5,
  /** Square-wave on/off. */
  STROBE: 6,
  /** Sine brightness. */
  PULSE: 7,
  /** Random on/off per half-second. */
  BLINK: 8,
  /** Visible for a flash of each period: a blaster bolt, an arc. */
  BOLT: 9,
  /** Height wobble: water, steam. */
  WOBBLE: 10,
  /** Two poses swapped on a slow square wave: an arm going up. */
  ARM: 11,
  /** Sweep along on a sine: a searchlight, a swinging pot. */
  SWAY: 12,
  /** Hue cycling: a cantina. */
  CYCLE: 13,
};

/** The slab's centre in strip metres for level 0 when the scroll is 0. */
const SLAB_W = -1.3;
/** The half-height of the shaft box the far strip is drawn inside. */
const BOX_HALF = SPAN / 2 + 6;

/** The figure's parts for a pose, in metres for a 1.75 m person, feet at 0:
 * [part, along, up, width(along), height, rot]. `part` is T torso, L leg,
 * A arm; the head is added by `fig` itself at `headY`. */
const POSES = {
  stand: { headY: 1.62, parts: [['T', 0, 1.15, 0.42, 0.62, 0], ['L', -0.1, 0.42, 0.16, 0.84, 0], ['L', 0.1, 0.42, 0.16, 0.84, 0], ['A', -0.28, 1.12, 0.12, 0.6, 0], ['A', 0.28, 1.12, 0.12, 0.6, 0]] },
  walk: { headY: 1.62, parts: [['T', 0, 1.15, 0.42, 0.62, 0], ['L', -0.14, 0.42, 0.16, 0.84, 0.35], ['L', 0.14, 0.42, 0.16, 0.84, -0.35], ['A', -0.28, 1.12, 0.12, 0.6, -0.4], ['A', 0.28, 1.12, 0.12, 0.6, 0.4]] },
  sit: { headY: 1.27, parts: [['T', 0, 0.8, 0.42, 0.62, 0], ['L', 0.22, 0.5, 0.5, 0.16, 0], ['L', 0.44, 0.24, 0.16, 0.48, 0], ['A', -0.26, 0.8, 0.12, 0.5, 0], ['A', 0.26, 0.85, 0.12, 0.4, 0.6]] },
  lie: { headY: 0.14, headA: -0.5, parts: [['T', 0, 0.14, 0.62, 0.28, 0], ['L', 0.72, 0.1, 0.84, 0.2, 0], ['A', 0.05, 0.3, 0.5, 0.1, 0]] },
  kneel: { headY: 1.27, parts: [['T', 0, 0.85, 0.42, 0.62, 0], ['L', -0.05, 0.3, 0.16, 0.5, 0], ['L', 0.3, 0.08, 0.6, 0.14, 0], ['A', -0.24, 0.8, 0.12, 0.5, 0], ['A', 0.24, 0.8, 0.12, 0.5, 0]] },
  raise: { headY: 1.62, parts: [['T', 0, 1.15, 0.42, 0.62, 0], ['L', -0.1, 0.42, 0.16, 0.84, 0], ['L', 0.1, 0.42, 0.16, 0.84, 0], ['A', -0.28, 1.12, 0.12, 0.6, 0], ['A', 0.34, 1.52, 0.12, 0.6, -0.3, 'up']] },
  hang: { headY: 1.62, parts: [['T', 0, 1.15, 0.42, 0.62, 0], ['L', -0.1, 0.42, 0.16, 0.84, 0], ['L', 0.1, 0.42, 0.16, 0.84, 0], ['A', -0.2, 1.55, 0.12, 0.6, 0.15], ['A', 0.2, 1.55, 0.12, 0.6, -0.15]] },
};

function buildShaft(world, M, lightMat, layout) {
  const L = LIFT;
  const cx = L.x, cz = L.z, hw = L.halfW, hd = L.halfD, H = L.height;
  const group = new THREE.Group();
  group.name = 'deck-lift-shaft';
  /**
   * HOW DEEP EACH FACE IS. The side faces look 4.6 m out to the far wall.
   * The back face cannot: the deck's heightfield rises steeply behind
   * `DECK.aft` (1.35 m up at one metre behind the car, 7.8 m at four), so a
   * back shaft that deep would be drawn inside rock. It is ONE metre deep,
   * with every layer's depth scaled by `k` and a plinth across its foot that
   * hides the wedge of ground — the back window shows the same ship going
   * by, closer, above a dark sill. The side scenes stop at z = −103.6, where
   * the ground is still flat, behind a corner pillar at each aft end.
   */
  const FAR = 4.6;
  const faces = [
    { q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), o: new THREE.Vector3(cx - hw, H / 2, cz - 0.2), half: 2.4, far: FAR },
    { q: new THREE.Quaternion(), o: new THREE.Vector3(cx + hw, H / 2, cz - 0.2), half: 2.4, far: FAR },
    { q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), o: new THREE.Vector3(cx, H / 2, cz - hd), half: 3.0, far: 1.0 },
  ];
  faces.forEach((f, i) => {
    f.i = i;
    f.out = new THREE.Vector3(1, 0, 0).applyQuaternion(f.q);
    f.along = new THREE.Vector3(0, 0, 1).applyQuaternion(f.q);
    f.k = f.far / FAR;
    f.ka = f.half / 2.4;
  });
  /** A depth on a face: the side faces' figure scaled to this face, never
   * nearer the pane than `lo` nor inside the far wall. */
  const dep = (f, d, lo = 0.2, margin = 0.06) => Math.max(lo, Math.min(d * f.k, f.far - margin));

  /* ── THE BOX, static: far walls, guide rails, ladder rails, cable trays,
   * vertical pipe runs. Merged per material. */
  const B = new Bins(M.faction);
  const tall = BOX_HALF * 2;
  const at = (f, d, a, y) => _v.copy(f.o).addScaledVector(f.out, d).addScaledVector(f.along, a).setY(y);
  const stat = (mat, f, d, a, y, wd, h, wa) => {
    const g = new THREE.BoxGeometry(wd, h, wa);
    g.applyQuaternion(f.q);
    at(f, d, a, y);
    B.geoAt(mat, g, _v.x, _v.y, _v.z);
  };
  for (const f of faces) {
    for (const a of [-2.2, 2.2]) stat(M.hull, f, dep(f, 0.55), a, 0, 0.16, tall, 0.16);
    /* The ladder stands at the aft end of the pane, not across the middle of it. */
    for (const a of [-2.05, -1.45]) stat(M.dark, f, dep(f, 1.5, 0.3), a, 0, 0.06, tall, 0.06);
    stat(M.dark, f, dep(f, 2.9, 0.4), -2.2, 0, 0.12, tall, 0.5);
    for (const a of [2.35, 2.65]) stat(M.hull, f, dep(f, 2.9, 0.4), a, 0, 0.18, tall, 0.18);
  }
  const backFar = faces[2].far;
  const zBack = cz - hd - backFar - 0.15;
  const zFront = L.door - 0.4;
  const zPillar = cz - 0.2 - faces[0].half;
  for (const s of [-1, 1]) {
    B.box(M.deep, cx + s * (hw + FAR + 0.15), 0, (zBack - 0.15 + zFront) / 2, 0.3, tall, zFront - zBack + 0.15);
    B.box(M.deep, cx + s * (hw + 0.12 + (FAR + 0.03) / 2), 0, (zPillar + zBack - 0.15) / 2, FAR + 0.03, tall, zPillar - zBack + 0.15);
  }
  B.box(M.deep, cx, 0, zBack, hw * 2 + FAR * 2 + 0.6, tall, 0.3);
  B.box(M.deep, cx, (1.45 - 30) / 2, (cz - hd - 0.04 + zBack) / 2, hw * 2 + 0.3, 31.45, (cz - hd - 0.04) - zBack + 0.15);
  B.box(M.hull, cx, 1.47, (cz - hd - 0.04 + zBack) / 2, hw * 2 + 0.3, 0.06, (cz - hd - 0.04) - zBack + 0.15);
  const key = (mat) => (mat.name || '').replace(/^deck-\w+-/, '') || 'mat';
  B.build(group, 'shaft', key);

  /* ── THE MATERIALS. All white, so `instanceColor` is the colour. */
  const basic = (name, extra = {}) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, name, ...extra });
    m.userData.saberNoInk = true;
    return m;
  };
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.3, name: 'shaft-box' });
  const plateMat = basic('shaft-plate', { toneMapped: false });
  const glowMat = basic('shaft-glow', { toneMapped: false });
  const glassMat = basic('shaft-glass', { toneMapped: false, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const cylMat = basic('shaft-cyl');
  const figMat = basic('shaft-figure', { side: THREE.DoubleSide });

  /* ── THE KINDS. */
  const kinds = [];
  const kindOf = {};
  const kind = (name, geo, mat) => {
    const k = { name, geo, mat, slots: [], mesh: null, anims: [], colour: false };
    kinds.push(k); kindOf[name] = k;
    return k;
  };
  kind('box', new THREE.BoxGeometry(1, 1, 1), boxMat);
  kind('plate', new THREE.BoxGeometry(1, 1, 1), plateMat);
  kind('glow', new THREE.BoxGeometry(1, 1, 1), glowMat);
  kind('glass', new THREE.BoxGeometry(1, 1, 1), glassMat);
  kind('cyl', new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2), cylMat);
  kind('figure', new THREE.BoxGeometry(1, 1, 1), figMat);
  kind('head', new THREE.SphereGeometry(0.5, 8, 6), figMat);
  kind('fighter', fighterGeometry(M.faction), figMat);
  kind('fan', turbineGeometry(), figMat);

  /** Push a slot. `d` is a canonical depth (side-face metres out from the
   * pane); `a` and `sa` are canonical along (scaled to the back face);
   * `sd` is the depth extent. `col` is a hex. */
  const put = (k, f, base, d, a, sd, sw, sa, col, o) => {
    const s = {
      f, base, d: dep(f, d, o?.lo ?? 0.2, o?.margin ?? 0.06), a: a * f.ka,
      sx: Math.max(0.02, sd * f.k), sy: sw, sz: sa * f.ka,
      rot: o?.rot || 0, col, anim: o?.anim || A.NONE, rate: o?.rate || 1, ph: o?.ph || 0,
      amp: o?.amp || 0, span: o?.span || 0, edge: o?.edge || 0, wrap: !!o?.wrap,
      base2: o?.base2 ?? base, rot2: o?.rot2 ?? (o?.rot || 0), col2: o?.col2 ?? col,
      digit: o?.digit ?? 0, seg: o?.seg ?? 0, hue: o?.hue ?? col,
    };
    k.slots.push(s);
    return s;
  };

  /* ── THE STRIP: one authored vignette per level per face. */
  const V = vignettes();
  /* The ones a level is FORCED to (the landing, the bulkheads) stay out of
   * the shuffle, so a landing is only ever the one the car stops at. */
  const FORCED = new Set(['landing', 'landing-warm', 'hangar-mouth', 'bulkhead']);
  const bulkEvery = 8;
  const perFace = [];
  /* One shuffled order of the vignettes; each face reads it from a third of
   * the way further round, so the three windows never agree and nothing on
   * one face repeats inside `order.length` levels. */
  const order = V.map((_, i) => i).filter((i) => !FORCED.has(V[i].name));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i, 77) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const third = Math.floor(order.length / 3);
  for (const f of faces) {
    const names = [];
    for (let lev = layout.lo; lev <= layout.hi; lev++) {
      const base = lev * LEVEL + SLAB_W;
      const seed = f.i * 1000 + lev;
      let v;
      if (lev === layout.landing) v = V[V.findIndex((x) => x.name === (f.i === 2 ? 'hangar-mouth' : f.i === 0 ? 'landing' : 'landing-warm'))];
      else if (((lev - layout.lo) % bulkEvery) === 3) v = V[V.findIndex((x) => x.name === 'bulkhead')];
      else v = V[order[(lev - layout.lo + f.i * third) % order.length]];
      names.push(v.name);
      /* Every level: the floor slab, the ceiling slab. */
      const floorSlab = put(kindOf.box, f, base, FAR - 0.7, 0, 1.4, 0.5, 4.7, 0x8a8f96, { lo: 0.5, margin: 0.1 });
      const ceilSlab = put(kindOf.box, f, base + LEVEL - 0.25, FAR - 0.5, 0, 1.0, 0.5, 4.7, 0x4a4e55, { lo: 0.5, margin: 0.1 });
      const p0 = kindOf.plate.slots.length;
      const ctx = makeCtx(f, base, seed, put, kindOf, FAR);
      v.build(ctx, seed);
      /* THE COLOUR HAS TO REACH THE WINDOW. The first frames showed the
       * plate as a sliver behind pale slabs and rails: so the level's
       * slabs take the plate's tint, and a strip of the same hue, lifted,
       * runs under the ceiling close in — the room's light, not its wall. */
      const plate = kindOf.plate.slots[p0];
      if (plate) {
        _c.setHex(plate.hue);
        floorSlab.col = _c.clone().lerp(_c2.setHex(0x8a8f96), 0.35).getHex();
        ceilSlab.col = _c.clone().lerp(_c2.setHex(0x2a2d33), 0.5).getHex();
        _c.getHSL(_hsl);
        _c.setHSL(_hsl.h, Math.max(_hsl.s, 0.55), Math.max(_hsl.l, 0.6));
        const hue = _c.getHex();
        put(kindOf.glow, f, base + LEVEL - 0.56, FAR - 1.5, 0, 0.3, 0.1, 4.5, hue, { lo: 0.4 });
        /* And a lit jamb each side of the opening, full height, so the
         * colour is in the window whatever part of the room is. */
        for (const a of [-2.36, 2.36]) put(kindOf.glow, f, base + LEVEL / 2, FAR - 0.9, a, 0.12, LEVEL - 0.9, 0.08, hue, { lo: 0.4 });
        put(kindOf.glow, f, base + 0.28, FAR - 1.3, 0, 0.6, 0.02, 4.5, _c.multiplyScalar(0.6).getHex(), { lo: 0.4 });
        /* DENSITY: a few pieces of the room's own clutter — crates, a
         * console, a duct — in its tint, seeded, so no glimpse is a bare
         * plate with one thing in front of it. */
        _c2.setHex(plate.hue).multiplyScalar(0.35);
        const tint = _c2.getHex();
        for (let j = 0; j < 3; j++) {
          const ra = -2.1 + hash(seed, 900 + j) * 4.2, rh = 0.4 + hash(seed, 910 + j) * 1.2, rw = 0.4 + hash(seed, 920 + j) * 0.9;
          put(kindOf.box, f, base + 0.25 + rh / 2, FAR - 0.5 - hash(seed, 930 + j) * 1.2, ra, 0.5, rh, rw, j === 0 ? 0x1a1c22 : tint, { lo: 0.3 });
        }
        put(kindOf.cyl, f, base + LEVEL - 0.9, FAR - 0.7, 0, 0.18, 0.18, 4.6, 0x2a2d33, { lo: 0.4 });
        /* PARALLAX: something right at the glass on every level — a
         * railing, and by turns a door frame or a person leaning on it —
         * dark, close, and moving four times as fast as the far wall. */
        put(kindOf.box, f, base + 0.25 + 1.05, 1.15, 0, 0.06, 0.06, 4.4, 0x14161c, { lo: 0.25 });
        for (const a of [-2.0, -0.7, 0.7, 2.0]) put(kindOf.box, f, base + 0.25 + 0.55, 1.15, a, 0.05, 1.05, 0.05, 0x14161c, { lo: 0.25 });
        const near = (lev - layout.lo) % 3;
        if (near === 1) {
          for (const a of [-1.3, 1.3]) put(kindOf.box, f, base + 0.25 + 1.6, 0.95, a, 0.16, 3.2, 0.18, 0x0e1014, { lo: 0.25 });
          put(kindOf.box, f, base + 0.25 + 3.25, 0.95, 0, 0.16, 0.22, 2.8, 0x0e1014, { lo: 0.25 });
        } else if (near === 2 && lev !== layout.landing) {
          ctx.fig(hash(seed, 940) > 0.5 ? 'stand' : 'walk', (hash(seed, 950) - 0.5) * 2.6 / ctx.W, { d: 1.0, col: 0x000000, h: 1.0 });
        }
      }
    }
    perFace.push(names);
  }

  /* MID: girders at the slab line, pipe crossings between, wrapped. */
  const nLev = SPAN / LEVEL;
  for (const f of faces) {
    for (let j = 0; j < nLev; j++) put(kindOf.box, f, j * LEVEL + SLAB_W, 2.0, 0, 0.36, 0.5, 3.8, 0x2a2d33, { wrap: true, lo: 0.45 });
    for (let j = 0; j < nLev / 2; j++) put(kindOf.cyl, f, j * LEVEL * 2 + SLAB_W + 3.4, 2.6, 0, 0.26, 0.26, 4.0, 0x6a6e76, { wrap: true, lo: 0.6 });
    for (let j = 0; j < nLev; j++) put(kindOf.glow, f, j * LEVEL + 4.6, 2.5, -1.9, 0.14, 0.14, 0.14, 0xff3a2a, { wrap: true, lo: 0.5 });
  }
  /* NEAR: the ladder's rungs, the rails' ties, and the light bars. */
  const barsPerFace = 30;
  for (const f of faces) {
    for (let j = 0; j < SPAN / 0.4; j++) put(kindOf.box, f, j * 0.4, 1.5, -1.75 / f.ka, 0.05, 0.05, 0.62 / f.ka, 0x3a3e46, { wrap: true, lo: 0.3 });
    for (let j = 0; j < SPAN / 2; j++) put(kindOf.box, f, j * 2 + 1, 0.55, 0, 0.14, 0.14, 4.7, 0x3a3e46, { wrap: true });
    for (let j = 0; j < barsPerFace; j++) put(kindOf.glow, f, j * (SPAN / barsPerFace), 0.85, 0, 0.34, 0.16, 5.6 / f.ka, 0xbfd4ee, { wrap: true, lo: 0.3, anim: A.SWEEP });
  }

  /* ── THE MESHES, sized to their slots; colours written once, the animated
   * slots listed so a still scene relays only those. */
  for (const k of kinds) {
    const n = Math.max(1, k.slots.length);
    const mesh = new THREE.InstancedMesh(k.geo, k.mat, n);
    mesh.name = `shaft-${k.name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    if (k.slots.length === 0) mesh.setMatrixAt(0, _m.makeScale(0, 0, 0));
    k.slots.forEach((s, i) => {
      mesh.setColorAt(i, _c.setHex(s.col));
      if (s.anim !== A.NONE && s.anim !== A.DIGIT) k.anims.push(i);
      if (s.anim === A.DIGIT || s.anim === A.SWEEP) k.scrollColour = true;
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    k.mesh = mesh;
    group.add(mesh);
  }
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  return { group, faces, kinds, kindOf, bars: kindOf.glow.mesh, barsPerFace, slabW: SLAB_W, perFace, vignettes: V.map((v) => v.name), zeroM };
}

/**
 * A vignette's drawing context: helpers bound to one face and one level, in
 * room metres — `a` along the opening (±1.9 fits), `y` up from the room's
 * floor, `d` out from the pane (4.6 is the far wall). Everything is pushed
 * as slots of the nine kinds.
 */
function makeCtx(f, base, seed, put, K, FAR) {
  const floor = base + 0.25;
  const roomH = LEVEL - 0.75;
  const rnd = (i) => hash(seed, i);
  /* The opening is 4.7 m wide now (the panes are), authored at 3.8: every
   * along and along-size is widened by this. */
  const W = 4.7 / 3.8;
  const c = {
    f, seed, floor, roomH, FAR, rnd, W,
    /** The lit back wall, full opening, or a band `y0..y1` of it. */
    plate(col, y0 = 0, y1 = roomH, o) {
      /* A dark plate is black through the pane in this renderer — the first
       * frames read as machinery again — so every plate keeps its hue but
       * is lifted to a floor of lightness and saturation: deep colour, not
       * black. `col` stays the vignette's own for the slabs and strips. */
      _c.setHex(col).getHSL(_hsl);
      const lifted = _c.setHSL(_hsl.h, _hsl.l < 0.7 ? Math.max(_hsl.s, 0.7) : _hsl.s, Math.max(_hsl.l, 0.4)).getHex();
      return put(K.plate, f, floor + (y0 + y1) / 2, FAR - 0.05, 0, 0.1, y1 - y0, 4.7, lifted, { ...(o || {}), hue: col });
    },
    box(col, a, y, sa, sh, sd = 0.6, d = FAR - 0.6, o) { return put(K.box, f, floor + y, d, a * W, sd, sh, sa * W, col, o); },
    glow(col, a, y, sa, sh, sd = 0.08, d = FAR - 0.3, o) { return put(K.glow, f, floor + y, d, a * W, sd, sh, sa * W, col, o); },
    glass(col, a, y, sa, sh, sd = 0.6, d = FAR - 0.9, o) { return put(K.glass, f, floor + y, d, a * W, sd, sh, sa * W, col, o); },
    /** A cylinder `len` along, radius `r`; `rot` π/2 stands it up. */
    cyl(col, a, y, len, r, d = FAR - 0.8, o) { return put(K.cyl, f, floor + y, d, a * W, r * 2, r * 2, len * W, col, o); },
    fan(col, a, y, s, rate, d = FAR - 1.0, o) { return put(K.fan, f, floor + y, d, a * W, s, s, s, col, { anim: A.SPIN, rate, ph: rnd(91), ...(o || {}) }); },
    fighter(col, a, y, s, d = FAR - 0.4) { return put(K.fighter, f, floor + y, d, a * W, 1, s, s * W, col, { lo: 0.5, margin: 0.12 }); },
    /** A person: pose, along, options {col, h, d, anim (for the arm), rate}. */
    fig(pose, a, o = {}) {
      const P = POSES[pose] || POSES.stand;
      const h = (o.h ?? 1.0) * (0.94 + rnd(7 + Math.round(a * 10)) * 0.12);
      const col = o.col ?? 0x05070b;
      const d = o.d ?? FAR - 0.5 - rnd(3) * 0.4;
      const y0 = o.y ?? 0;
      a *= W;
      for (const [part, pa, py, pw, ph, prot, tag] of P.parts) {
        const opts = { rot: prot, lo: 0.3, margin: 0.14 };
        if (o.slide) Object.assign(opts, { anim: A.SLIDE, ph: rnd(11) }, o.slide);
        else if (tag === 'up' && o.anim) { opts.anim = A.ARM; opts.rate = o.rate || 0.4; opts.ph = rnd(5); opts.base2 = floor + y0 + 1.12 * h; opts.rot2 = 0; }
        put(K.figure, f, floor + y0 + py * h, d, a + pa * h, part === 'T' ? 0.26 : 0.16, ph * h, pw * h, col, opts);
      }
      put(K.head, f, floor + y0 + P.headY * h, d, a + (P.headA || 0) * h, 0.26 * h, 0.26 * h, 0.26 * h, col,
        o.slide ? { anim: A.SLIDE, ph: rnd(11), ...o.slide, lo: 0.3, margin: 0.14 } : { lo: 0.3, margin: 0.14 });
      return c;
    },
    /** A droid on wheels: a drum body, a dome, one lit eye. */
    astro(col, a, o = {}) {
      const d = o.d ?? FAR - 0.7;
      a *= W;
      put(K.cyl, f, floor + 0.5, d, a, 0.6, 0.6, 0.8, col, { rot: Math.PI / 2, lo: 0.3, margin: 0.2 });
      put(K.head, f, floor + 0.95, d, a, 0.6, 0.6, 0.6, o.dome ?? 0xc0c6cc, { lo: 0.3, margin: 0.2 });
      put(K.glow, f, floor + 0.95, d - 0.3 * f.k, a + 0.1, 0.08, 0.08, 0.08, o.eye ?? 0xff3020, { anim: A.BLINK, rate: 1.5 + rnd(9), ph: rnd(10), lo: 0.28, margin: 0.1 });
      return c;
    },
    /** A slot's animation options, for brevity. */
    an(anim, rate = 1, extra = {}) { return { anim, rate, ph: rnd(40 + anim), ...extra }; },
  };
  return c;
}

/**
 * THE VIGNETTES — one per level, each a themed glimpse with its own colour,
 * its own furniture, and something moving where it makes sense. The player:
 * "imagine passing dozens and dozens of levels all unique and you catch a
 * glimpse of them as they go by … Take advantage of colors/themes."
 *
 * Each is a name and a builder over the context above. `y` is up from the
 * room floor; the room is `roomH` (6.25 m) tall and the far wall is 4.6 m
 * out, so anything at `d` < 4 stands in front of the coloured plate.
 */
function vignettes() {
  const R = [];
  const v = (name, build) => R.push({ name, build });

  v('landing', (c) => {
    c.plate(0xdfe8f0);
    c.box(0x2a2e36, 0, 5.4, 3.8, 0.4, 0.3);
    c.glow(0x3adf7a, 1.7, 1.6, 0.14, 0.14, 0.06, c.FAR - 0.1);
    c.glow(0x9fb4d0, 0, 5.0, 1.6, 0.16, 0.1, c.FAR - 0.2);
    c.fig('raise', -1.0, { anim: true, rate: 0.35 }).fig('stand', 0.1).fig('walk', 1.0, { h: 0.95 });
    c.box(0x1e2228, 0, 0.0, 3.6, 0.06, 1.4, c.FAR - 1.0);
  });
  v('landing-warm', (c) => {
    c.plate(0xf2dcc0);
    c.box(0x2a2e36, 0, 5.4, 3.8, 0.4, 0.3);
    c.box(0x3a3028, -1.2, 0.25, 1.3, 0.1, 0.4);
    c.fig('sit', -1.35, { d: c.FAR - 0.7 }).fig('raise', 0.6, { anim: true, rate: 0.3 }).fig('stand', 1.3, { h: 0.9 });
    c.glow(0xffb347, 1.7, 1.6, 0.14, 0.14, 0.06, c.FAR - 0.1);
  });
  v('hangar-mouth', (c) => {
    c.plate(0x4a5870);
    c.fighter(0x05070b, 0.2, 2.6, 1.0);
    c.cyl(0xc0b070, -1.4, 0.4, 1.6, 0.06, c.FAR - 0.6);
    c.cyl(0xc0b070, -1.9, 0.9, 0.12, 0.06, c.FAR - 0.6, { rot: Math.PI / 2 });
    c.fig('stand', -1.6, { h: 0.95 });
    c.glow(0xfff0d0, -1.2, 5.6, 0.5, 0.12, 0.2, c.FAR - 1.2);
    c.glow(0xff3020, 1.6, 4.6, 0.14, 0.14, 0.14, c.FAR - 0.3, c.an(A.BLINK, 1.2));
  });
  v('bulkhead', (c) => {
    /* The bulkhead crossing: a huge dark beam close in, its deck number lit
     * on the face nearest the window in metre-high seven-segment digits,
     * which count with the readout (`A.DIGIT`). */
    const yB = 2.95;
    c.plate(0x1a1c22);
    c.box(0x14161c, 0, yB, 3.8, 2.4, 2.6, 2.8, { lo: 0.4 });
    for (let dgt = 0; dgt < 2; dgt++) {
      for (let sgm = 0; sgm < 7; sgm++) {
        const [u, w, horiz] = SEG_AT(0.7, 1.3)[sgm];
        c.glow(0x9fd0ff, (dgt === 0 ? -0.55 : 0.55) + u, yB + w, horiz ? 0.66 : 0.1, horiz ? 0.1 : 0.66, 0.06, 1.45,
          { anim: A.DIGIT, digit: dgt, seg: sgm, lo: 0.3 });
      }
    }
    c.glow(0xff3a2a, -1.6, yB + 1.4, 0.14, 0.14, 0.14, 1.4, { lo: 0.3 });
    c.glow(0xff3a2a, 1.6, yB + 1.4, 0.14, 0.14, 0.14, 1.4, { lo: 0.3 });
  });
  v('medbay', (c) => {
    c.plate(0xd6f0ea);
    for (const a of [-1.2, 0.4]) {
      c.box(0xc4ccd4, a, 0.4, 1.9, 0.22, 0.8);
      c.box(0x5a6068, a, 0.15, 0.3, 0.3, 0.3);
      c.fig('lie', a - 0.4, { y: 0.5, col: 0x141a22 });
      c.glow(0x30d0b0, a + 0.6, 2.1, 0.5, 0.3, 0.06, c.FAR - 0.1, c.an(A.BLINK, 2));
    }
    c.fig('stand', 1.5, { col: 0xe0e6ee, h: 0.98 });
    c.glow(0xffffff, 0, 5.3, 3.0, 0.1, 0.4, c.FAR - 0.8);
  });
  v('bacta', (c) => {
    c.plate(0x0c2a24);
    for (const a of [-1.1, 0.9]) {
      c.glass(0x30ff9a, a, 1.7, 0.9, 2.6, 0.9);
      c.cyl(0x2a3a38, a, 0.2, 0.4, 0.5, c.FAR - 0.9, { rot: Math.PI / 2 });
      c.cyl(0x2a3a38, a, 3.2, 0.3, 0.5, c.FAR - 0.9, { rot: Math.PI / 2 });
      c.fig('hang', a, { y: 0.6, h: 0.85, col: 0x061a14, d: c.FAR - 0.9 });
      c.glow(0x60ffb0, a, 0.5, 0.7, 0.1, 0.7, c.FAR - 0.9, c.an(A.PULSE, 1.6));
    }
    c.glow(0x30d0a0, 0, 5.2, 0.6, 0.12, 0.06, c.FAR - 0.1, c.an(A.BLINK, 1));
  });
  v('barracks', (c) => {
    c.plate(0x6a5e46);
    for (const a of [-1.2, 0.9]) for (let i = 0; i < 3; i++) {
      c.box(0x2a2620, a, 0.5 + i * 1.5, 1.9, 0.14, 0.8);
      c.box(0x3a3630, a - 0.95, 0.5 + i * 1.5, 0.08, 1.3, 0.8);
    }
    c.fig('lie', -1.5, { y: 2.08, col: 0x100e0a });
    c.fig('sit', 0.4, { y: 0.55, h: 0.95 });
    c.fig('lie', 0.5, { y: 3.58, col: 0x100e0a });
    c.glow(0xffc070, 0, 5.4, 0.3, 0.1, 0.3, c.FAR - 0.6);
  });
  v('mess', (c) => {
    c.plate(0xffd9a0);
    for (const a of [-1.0, 1.0]) {
      c.box(0x5a4632, a, 0.85, 1.7, 0.08, 0.9);
      c.box(0x4a3a2a, a, 0.4, 0.1, 0.8, 0.1);
      c.fig('sit', a - 0.85, { h: 0.9, d: c.FAR - 0.9 });
      c.fig('sit', a + 0.35, { h: 0.9, d: c.FAR - 0.9 });
      c.glass(0xfff4e0, a, 1.5, 0.5, 0.6, 0.3, c.FAR - 0.9, c.an(A.WOBBLE, 1.2, { amp: 0.4 }));
      c.glow(0xffc070, a, 4.2, 0.6, 0.12, 0.3, c.FAR - 1.0);
      c.box(0x2a2018, a, 4.9, 0.04, 1.4, 0.04, c.FAR - 1.0);
    }
  });
  v('armoury', (c) => {
    c.plate(0x8a9099);
    for (const a of [-1.4, -0.2, 1.0]) {
      c.box(0x2a2c30, a, 1.6, 1.0, 3.0, 0.3, c.FAR - 0.4);
      for (let i = 0; i < 4; i++) c.box(0x0a0b0e, a - 0.38 + i * 0.25, 1.6, 0.06, 1.2, 0.1, c.FAR - 0.7);
    }
    c.box(0x3a3c40, 1.5, 0.5, 0.9, 1.0, 0.8, c.FAR - 1.4);
    c.fig('stand', 1.5, { d: c.FAR - 0.9 });
    c.glow(0xff3020, -1.7, 4.0, 0.14, 0.14, 0.1, c.FAR - 0.2, c.an(A.BLINK, 0.8));
  });
  v('brig', (c) => {
    c.plate(0x3a0c0c);
    for (let i = 0; i < 7; i++) c.glow(0xff3030, -1.5 + i * 0.5, 2.0, 0.06, 4.0, 0.06, c.FAR - 1.3);
    c.box(0x1a1010, 0, 0.6, 3.8, 0.06, 1.0, c.FAR - 1.3);
    c.fig('sit', -0.9, { col: 0x000000, d: c.FAR - 0.6 });
    c.fig('stand', 1.6, { d: c.FAR - 1.7, col: 0x0a0a10 });
    c.glow(0xff8060, 0, 5.0, 0.3, 0.1, 0.3, c.FAR - 0.5, c.an(A.FLICKER, 6));
  });
  v('reactor', (c) => {
    c.plate(0x061a3a);
    c.glass(0x4090ff, 0, 3.0, 1.6, 4.4, 1.2, c.FAR - 1.2, c.an(A.PULSE, 1.2));
    c.glow(0x80c0ff, 0, 3.0, 0.5, 3.6, 0.5, c.FAR - 1.2, c.an(A.PULSE, 1.2, { ph: 0.5 }));
    for (const y of [1.2, 2.8, 4.4]) c.cyl(0x2a3a5a, 0, y, 2.2, 0.12, c.FAR - 1.2);
    c.box(0x1a2030, 0, 1.0, 3.8, 0.08, 1.2, c.FAR - 2.0);
    c.box(0x1a2030, 0, 3.6, 3.8, 0.08, 1.2, c.FAR - 2.0);
    c.fig('stand', -1.5, { h: 0.8, d: c.FAR - 2.0 }).fig('walk', 1.4, { h: 0.8, y: 3.64, d: c.FAR - 2.0 });
  });
  v('foundry', (c) => {
    c.plate(0x3a1a05);
    c.cyl(0x2a2220, 0, 5.4, 3.8, 0.1, c.FAR - 1.0);
    for (let i = 0; i < 4; i++) {
      c.fig('hang', 0, { y: 3.4, h: 0.9, col: 0x2a2018, d: c.FAR - 1.0, slide: { rate: 0.09, span: 4.2, edge: 2.0, ph: i * 0.25 } });
    }
    for (let i = 0; i < 5; i++) c.glow(i % 2 ? 0xffa030 : 0xffe080, -1.4 + i * 0.7, 0.9 + c.rnd(20 + i) * 0.8, 0.12, 0.12, 0.12, c.FAR - 1.2 - c.rnd(30 + i), c.an(A.FLICKER, 14 + i, { ph: i * 0.3 }));
    c.glow(0xff6010, 0, 0.3, 2.8, 0.3, 1.0, c.FAR - 1.1, c.an(A.FLICKER, 5));
    c.fig('stand', 1.6, { d: c.FAR - 1.6 });
  });
  v('hydroponics', (c) => {
    c.plate(0x2c1f2a);
    for (let i = 0; i < 3; i++) c.glow(0xff5aa0, 0, 1.6 + i * 1.6, 3.6, 0.06, 0.2, c.FAR - 0.6, { lo: 0.3 });
    for (let i = 0; i < 3; i++) {
      c.box(0x2f9a3a, 0, 0.9 + i * 1.6, 3.4, 0.4, 0.8, c.FAR - 0.7);
      c.box(0x4a4a50, 0, 0.6 + i * 1.6, 3.6, 0.1, 0.9, c.FAR - 0.7);
    }
    c.fig('kneel', 1.2, { d: c.FAR - 1.4 });
  });
  v('firefight', (c) => {
    c.plate(0x5a3a2a);
    c.fig('walk', -1.7, { d: c.FAR - 0.6 }).fig('kneel', -1.0, { d: c.FAR - 1.0 });
    c.fig('walk', 1.5, { d: c.FAR - 0.8 }).fig('stand', 1.0, { d: c.FAR - 1.2, h: 0.95 });
    c.fig('lie', 0.0, { col: 0x100c0a });
    c.box(0x2a2018, 0.2, 0.4, 0.9, 0.8, 0.6, c.FAR - 1.0);
    for (let i = 0; i < 6; i++) {
      const left = i % 2 === 0;
      c.glow(left ? 0xff2a1a : 0x3aa0ff, -0.6 + i * 0.25, 1.0 + c.rnd(50 + i) * 0.8, 1.0, 0.06, 0.06, c.FAR - 0.9 - c.rnd(60 + i) * 0.5,
        { anim: A.BOLT, rate: 1.4 + c.rnd(70 + i), ph: c.rnd(80 + i), rot: (c.rnd(90 + i) - 0.5) * 0.3 });
    }
    c.glow(0xff9040, 0, 5.2, 0.4, 0.2, 0.2, c.FAR - 0.5, c.an(A.STROBE, 2.5));
  });
  v('breach', (c) => {
    c.plate(0x02040c);
    for (let i = 0; i < 16; i++) c.glow(0xffffff, -1.8 + c.rnd(100 + i) * 3.6, 0.3 + c.rnd(120 + i) * 5.5, 0.05, 0.05, 0.02, c.FAR - 0.08);
    c.box(0x30343a, -1.6, 1.2, 1.2, 2.4, 0.3, c.FAR - 0.4, { rot: 0.5 });
    c.box(0x30343a, 1.6, 4.4, 1.2, 2.8, 0.3, c.FAR - 0.4, { rot: -0.6 });
    c.box(0x30343a, -0.4, 5.6, 2.0, 1.0, 0.3, c.FAR - 0.4, { rot: 0.2 });
    for (let i = 0; i < 4; i++) c.box(0x8a8f96, -1.5 + i * 0.9, 2.0 + c.rnd(140 + i) * 2.5, 0.3, 0.3, 0.3, c.FAR - 1.4, { anim: A.SLIDE, rate: 0.12 + c.rnd(150 + i) * 0.1, span: 6, edge: 2.0, ph: c.rnd(160 + i), rot: c.rnd(170 + i) * 3 });
    c.fig('hang', 0.5, { y: 2.0, h: 0.9, d: c.FAR - 1.6, col: 0x0a0c10 });
    c.glow(0xffb020, -1.8, 5.8, 0.2, 0.2, 0.2, c.FAR - 1.0, c.an(A.STROBE, 1.5));
    c.glow(0xffb020, 1.8, 5.8, 0.2, 0.2, 0.2, c.FAR - 1.0, c.an(A.STROBE, 1.5, { ph: 0.5 }));
  });
  v('fire', (c) => {
    c.plate(0x3a1408);
    for (let i = 0; i < 6; i++) c.glow(i % 2 ? 0xff7a20 : 0xffd040, -1.5 + i * 0.6, 0.6, 0.5, 1.2, 0.4, c.FAR - 0.5, c.an(A.FLICKER, 12 + i, { ph: i * 0.17 }));
    for (let i = 0; i < 3; i++) c.glass(0x3a3030, -1.2 + i * 1.1, 3.6, 1.4, 2.2, 0.8, c.FAR - 0.9, c.an(A.WOBBLE, 0.6 + i * 0.2, { amp: 0.3, ph: i * 0.4 }));
    c.fig('walk', 1.4, { d: c.FAR - 1.6 }).fig('walk', 0.7, { d: c.FAR - 1.8, h: 0.95 });
    c.cyl(0x8a2a20, 0.4, 0.5, 2.4, 0.06, c.FAR - 1.7);
    c.glow(0xa0d0ff, 0.0, 1.0, 0.7, 0.08, 0.08, c.FAR - 1.7, c.an(A.WOBBLE, 3, { amp: 0.5 }));
  });
  v('chapel', (c) => {
    c.plate(0x2a1f3a);
    c.glow(0xffe2b0, 0, 3.2, 0.4, 5.0, 0.1, c.FAR - 0.15);
    for (let i = 0; i < 8; i++) c.glow(0xffc070, -1.6 + i * 0.45, 0.9 + (i % 2) * 0.3, 0.06, 0.12, 0.06, c.FAR - 0.4, c.an(A.FLICKER, 8 + i));
    c.box(0x1a1420, 0, 0.6, 1.8, 0.8, 0.8, c.FAR - 0.5);
    c.fig('kneel', -0.3, { d: c.FAR - 1.5 });
    for (const a of [-1.4, 1.3]) c.box(0x1a1420, a, 0.3, 1.0, 0.5, 0.5, c.FAR - 1.6);
  });
  v('dojo', (c) => {
    c.plate(0xe8e0c8);
    c.box(0x6a3a2a, 0, 0.05, 3.6, 0.1, 1.6, c.FAR - 1.2);
    c.fig('walk', -0.8, { d: c.FAR - 1.2 }).fig('walk', 0.8, { d: c.FAR - 1.2 });
    c.glow(0x40c0ff, -0.35, 1.7, 0.08, 1.3, 0.08, c.FAR - 1.3, { anim: A.ARM, rate: 0.9, rot: 0.9, rot2: -0.5, base2: c.floor + 1.9 });
    c.glow(0x60ff60, 0.35, 1.7, 0.08, 1.3, 0.08, c.FAR - 1.3, { anim: A.ARM, rate: 0.9, ph: 0.5, rot: -0.9, rot2: 0.5, base2: c.floor + 1.9 });
    c.fig('sit', 1.7, { h: 0.9, d: c.FAR - 0.6 });
  });
  v('briefing', (c) => {
    c.plate(0x0e1a2c);
    c.box(0x1a2230, 0, 0.5, 2.0, 1.0, 1.2, c.FAR - 1.4);
    c.glass(0x40a0ff, 0, 2.0, 1.6, 1.6, 1.0, c.FAR - 1.4, c.an(A.PULSE, 0.8));
    c.glow(0x80d0ff, 0, 2.0, 0.6, 0.6, 0.6, c.FAR - 1.4, c.an(A.SPIN, 0.7));
    c.fig('stand', -1.5, { d: c.FAR - 1.4 }).fig('stand', 1.5, { d: c.FAR - 1.4 }).fig('raise', -0.9, { d: c.FAR - 2.2, anim: true, rate: 0.5 });
    c.glow(0x3a90ff, 0, 4.4, 2.6, 1.0, 0.06, c.FAR - 0.1, c.an(A.BLINK, 0.6));
  });
  v('magazine', (c) => {
    c.plate(0x2a0a0a);
    for (let r = 0; r < 3; r++) {
      c.box(0x3a3a40, 0, 0.6 + r * 1.7, 3.6, 0.1, 1.0, c.FAR - 0.7);
      for (let i = 0; i < 4; i++) c.cyl(0xb0b4bc, -1.35 + i * 0.9, 1.0 + r * 1.7, 0.8, 0.22, c.FAR - 0.7);
    }
    c.glow(0xff2020, -1.7, 5.4, 0.2, 0.2, 0.2, c.FAR - 0.3, c.an(A.BLINK, 0.5));
    c.glow(0xff2020, 1.7, 5.4, 0.2, 0.2, 0.2, c.FAR - 0.3, c.an(A.BLINK, 0.5, { ph: 0.5 }));
  });
  v('kennel', (c) => {
    c.plate(0x8a5a20);
    c.box(0xc8a040, 0, 0.1, 3.6, 0.2, 1.4, c.FAR - 0.9);
    for (let i = 0; i < 6; i++) c.box(0x1a1410, -1.7 + i * 0.68, 1.8, 0.06, 3.2, 0.06, c.FAR - 1.7);
    for (const a of [-1.1, 0.6]) {
      c.box(0x0a0806, a, 0.6, 1.3, 0.6, 0.5, c.FAR - 1.0);
      c.box(0x0a0806, a + 0.7, 0.95, 0.5, 0.5, 0.4, c.FAR - 1.0);
      c.glow(0xffd040, a + 0.85, 1.0, 0.08, 0.05, 0.04, c.FAR - 1.22, c.an(A.BLINK, 0.3));
    }
    c.glow(0xffb060, 0, 5.4, 0.4, 0.1, 0.3, c.FAR - 0.6, c.an(A.FLICKER, 3));
  });
  v('cargo', (c) => {
    c.plate(0x5a5a48);
    const cols = [0x6a5a3a, 0x4a4a5a, 0x7a4a2a, 0x5a6a4a];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
      if (i === 2 && j > 2) continue;
      c.box(cols[(i + j) % 4], -1.45 + i * 0.95, 0.5 + j * 1.05, 0.9, 1.0, 0.9, c.FAR - 0.6);
    }
    c.box(0x2a2a30, 1.5, 1.2, 0.6, 2.4, 0.6, c.FAR - 1.6, c.an(A.SLIDE, 0.08, { span: 5, edge: 2.0 }));
    c.box(0x2a2a30, 1.5, 2.6, 1.4, 0.15, 0.4, c.FAR - 1.6, c.an(A.SLIDE, 0.08, { span: 5, edge: 2.0 }));
    c.glow(0xffb020, 1.5, 2.55, 0.1, 0.1, 0.1, c.FAR - 1.9, c.an(A.SLIDE, 0.08, { span: 5, edge: 2.0 }));
  });
  v('command', (c) => {
    c.plate(0x101c30);
    for (let r = 0; r < 2; r++) {
      c.box(0x1a2230, 0, 0.5 + r * 1.2, 3.6, 0.9, 0.8, c.FAR - 0.8 - r * 1.0);
      for (let i = 0; i < 5; i++) c.glow(i % 3 ? 0x3a90ff : 0x60ffd0, -1.5 + i * 0.75, 1.15 + r * 1.2, 0.5, 0.3, 0.04, c.FAR - 1.2 - r * 1.0, c.an(A.BLINK, 0.8 + c.rnd(200 + i + r * 5)));
      for (let i = 0; i < 3; i++) c.fig('sit', -1.4 + i * 1.3, { y: r * 1.2, h: 0.85, d: c.FAR - 1.6 - r * 1.0 });
    }
    c.glow(0x2a70ff, 0, 4.6, 3.0, 1.2, 0.06, c.FAR - 0.1, c.an(A.PULSE, 0.4));
  });
  v('observation', (c) => {
    c.plate(0x03060f);
    c.glow(0xd8a060, 0, 1.0, 3.8, 2.4, 0.06, c.FAR - 0.1);
    c.glow(0xffd0a0, 0, 2.25, 3.8, 0.12, 0.06, c.FAR - 0.12);
    for (let i = 0; i < 12; i++) c.glow(0xffffff, -1.8 + c.rnd(300 + i) * 3.6, 2.6 + c.rnd(320 + i) * 3.2, 0.05, 0.05, 0.02, c.FAR - 0.08);
    c.box(0x2a2e36, 0, 1.1, 3.8, 0.06, 0.06, c.FAR - 1.6);
    c.fig('stand', -1.2, { d: c.FAR - 1.9 }).fig('stand', 0.2, { d: c.FAR - 1.9, h: 0.9 }).fig('raise', 1.3, { d: c.FAR - 1.9, anim: true, rate: 0.25 });
  });
  v('coolant', (c) => {
    c.plate(0x0a3a3a);
    c.glass(0x30d0d0, 0, 0.6, 3.8, 1.2, 4.0, c.FAR - 2.2, c.an(A.WOBBLE, 1.5, { amp: 0.08 }));
    for (let i = 0; i < 3; i++) c.glow(0x80ffff, -1.2 + i * 1.2, 1.22, 1.0, 0.03, 0.4, c.FAR - 2.0 - i * 0.4, c.an(A.WOBBLE, 1.0 + i * 0.3, { amp: 0.8, ph: i * 0.3 }));
    for (const a of [-1.4, 1.4]) c.cyl(0x4a5a5a, a, 3.4, 4.6, 0.25, c.FAR - 0.8, { rot: Math.PI / 2 });
    c.box(0x3a4a4a, 0, 1.4, 1.6, 0.1, 0.8, c.FAR - 1.0);
    c.fig('stand', 0.2, { y: 1.45, h: 0.9, d: c.FAR - 1.0 });
  });
  v('fuel-main', (c) => {
    c.plate(0x1a1a20);
    c.cyl(0xa0905a, 0, 2.4, 3.8, 1.1, c.FAR - 1.6);
    c.cyl(0x6a6058, 0, 4.6, 3.8, 0.4, c.FAR - 1.0);
    for (const a of [-1.2, 0.8]) c.box(0x3a3a40, a, 2.4, 0.3, 2.6, 2.6, c.FAR - 1.6);
    c.cyl(0x8a3a30, 0.2, 3.9, 0.6, 0.3, c.FAR - 1.6, { rot: Math.PI / 2 });
    c.glow(0xffb020, -1.6, 4.0, 0.14, 0.14, 0.14, c.FAR - 2.6);
    c.glow(0x30ff60, 1.6, 1.0, 0.14, 0.14, 0.14, c.FAR - 2.6, c.an(A.BLINK, 1));
  });
  v('tram', (c) => {
    c.plate(0x202838);
    c.cyl(0x50545c, 0, 0.5, 3.8, 0.08, c.FAR - 1.4);
    c.cyl(0x50545c, 0, 5.4, 3.8, 0.08, c.FAR - 1.4);
    const slide = { anim: A.SLIDE, rate: 0.55, span: 9, edge: 2.3, ph: c.rnd(400) };
    c.box(0x4a5a70, 0, 1.6, 2.6, 1.8, 1.0, c.FAR - 1.6, slide);
    c.box(0x2a3040, 0, 2.7, 2.7, 0.3, 1.0, c.FAR - 1.6, slide);
    for (let i = 0; i < 3; i++) c.glow(0xffe0a0, -0.8 + i * 0.8, 1.8, 0.5, 0.6, 0.04, c.FAR - 2.14, slide);
    c.glow(0xff3020, 1.35, 1.0, 0.06, 0.2, 0.2, c.FAR - 1.6, slide);
    c.fig('stand', 1.7, { d: c.FAR - 0.6, h: 0.9 });
  });
  v('crawlway', (c) => {
    c.plate(0x2a2418);
    c.box(0x1a1814, 0, 4.4, 3.8, 3.7, 4.0, c.FAR - 2.0);
    c.cyl(0x3a3630, 0, 2.2, 3.8, 0.12, c.FAR - 0.6);
    c.cyl(0x3a3630, 0, 1.9, 3.8, 0.08, c.FAR - 0.8);
    c.box(0x1a1c22, 0.4, 0.5, 0.6, 0.6, 0.5, c.FAR - 1.0);
    c.box(0x1a1c22, 0.75, 0.9, 0.1, 0.6, 0.1, c.FAR - 1.0, { rot: 0.5 });
    c.glow(0xa0d0ff, 0.95, 1.1, 0.16, 0.16, 0.16, c.FAR - 1.1, c.an(A.FLICKER, 18));
    c.glow(0xffffff, 0.95, 1.1, 0.6, 0.6, 0.02, c.FAR - 0.2, c.an(A.FLICKER, 18, { ph: 0.1 }));
  });
  v('laundry', (c) => {
    c.plate(0xc0c8d0);
    for (let i = 0; i < 4; i++) {
      c.box(0x6a7078, -1.35 + i * 0.9, 0.7, 0.8, 1.4, 0.8, c.FAR - 0.6);
      c.glow(0xe0f0ff, -1.35 + i * 0.9, 0.8, 0.4, 0.4, 0.04, c.FAR - 1.02, c.an(A.SPIN, 3 + i));
    }
    for (let i = 0; i < 3; i++) c.glass(0xffffff, -1.0 + i * 1.0, 3.6, 1.2, 1.6, 0.8, c.FAR - 1.0, c.an(A.WOBBLE, 0.5 + i * 0.2, { amp: 0.4, ph: i * 0.3 }));
    c.fig('walk', 1.4, { d: c.FAR - 1.5 });
    c.box(0xe0e4ea, 1.4, 1.2, 0.5, 0.4, 0.4, c.FAR - 1.5);
  });
  v('cells', (c) => {
    c.plate(0x3a3020);
    for (let i = 0; i < 4; i++) {
      const a = -1.45 + i * 0.95;
      c.box(0x2a2620, a, 1.3, 0.75, 2.6, 0.2, c.FAR - 0.4);
      c.glow(0xff3020, a, 2.0, 0.4, 0.06, 0.06, c.FAR - 0.5);
      if (i === 1) c.fig('stand', a, { d: c.FAR - 0.5, col: 0x000000, h: 0.9 });
      else c.glow(0xff3020, a, 1.3, 0.06, 0.6, 0.06, c.FAR - 0.5);
    }
    c.fig('walk', 0, { d: c.FAR - 1.6, slide: { rate: 0.07, span: 4.4, edge: 1.8 } });
    c.glow(0xffc070, 0, 5.4, 0.5, 0.1, 0.3, c.FAR - 0.6);
  });
  v('morgue', (c) => {
    c.plate(0x9fb0b8);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      c.box(0x7a8a90, -1.5 + i * 0.85, 0.5 + j * 0.85, 0.8, 0.8, 0.5, c.FAR - 0.5);
      c.glow(0xe0e8ea, -1.5 + i * 0.85, 0.5 + j * 0.85, 0.3, 0.05, 0.02, c.FAR - 0.77);
    }
    c.box(0xb0bcc4, 1.2, 0.6, 1.6, 0.1, 0.7, c.FAR - 1.2);
    c.fig('lie', 0.8, { y: 0.65, col: 0xd0d8dc, d: c.FAR - 1.2 });
    c.glow(0xdff4ff, 1.2, 4.8, 1.4, 0.08, 0.3, c.FAR - 1.2, c.an(A.FLICKER, 20));
  });
  v('kitchen', (c) => {
    c.plate(0xffc890);
    c.box(0x4a4a50, 0, 0.5, 3.6, 1.0, 1.0, c.FAR - 0.6);
    for (let i = 0; i < 6; i++) c.cyl(0x808890, -1.5 + i * 0.6, 3.8, 0.3, 0.2, c.FAR - 1.0, { rot: Math.PI / 2, anim: A.SWAY, rate: 1.5 + i * 0.2, amp: 0.06, ph: i * 0.4 });
    c.cyl(0x2a2a30, 0, 4.2, 3.6, 0.03, c.FAR - 1.0);
    c.glow(0x60a0ff, -0.6, 1.05, 0.4, 0.1, 0.4, c.FAR - 0.6, c.an(A.FLICKER, 10));
    c.glass(0xfff4e0, -0.6, 1.8, 0.6, 1.0, 0.4, c.FAR - 0.6, c.an(A.WOBBLE, 1.2, { amp: 0.4 }));
    c.fig('stand', -0.6, { d: c.FAR - 1.5, col: 0x0a0a0c }).fig('walk', 1.3, { d: c.FAR - 1.6, h: 0.95 });
  });
  v('data-vault', (c) => {
    c.plate(0x04101a);
    for (let i = 0; i < 5; i++) {
      const a = -1.5 + i * 0.75;
      c.box(0x101820, a, 2.2, 0.6, 4.4, 0.7, c.FAR - 0.5);
      for (let j = 0; j < 4; j++) c.glow(j % 2 ? 0x40ff80 : 0x40a0ff, a, 0.6 + j * 1.0, 0.3, 0.05, 0.02, c.FAR - 0.87, c.an(A.BLINK, 3 + c.rnd(500 + i * 4 + j) * 4));
    }
    c.fig('sit', 1.5, { d: c.FAR - 1.6, h: 0.9 });
    c.glow(0x40a0ff, 1.9, 1.3, 0.5, 0.3, 0.04, c.FAR - 2.2, c.an(A.BLINK, 1));
  });
  v('plenum', (c) => {
    c.plate(0x2a2a30);
    c.fan(0x1a1c22, -1.0, 3.1, 1.15, 5, c.FAR - 0.9);
    c.fan(0x1a1c22, 1.1, 3.1, 0.9, -7, c.FAR - 0.9);
    c.cyl(0x4a4e56, -1.0, 3.1, 1.2, 1.55, c.FAR - 0.3);
    c.cyl(0x4a4e56, 1.1, 3.1, 1.2, 1.25, c.FAR - 0.3);
    for (let i = 0; i < 5; i++) c.box(0x3a3e46, 0, 0.6 + i * 1.3, 3.8, 0.06, 0.06, c.FAR - 1.5);
    c.glow(0x80ffb0, 0, 5.6, 0.14, 0.14, 0.14, c.FAR - 1.0, c.an(A.BLINK, 0.7));
  });
  v('officers-mess', (c) => {
    c.plate(0xffe0a0, 2.0, c.roomH);
    c.plate(0x3a2a10, 0, 2.0);
    c.box(0x3a2410, 0, 0.85, 2.8, 0.1, 1.0, c.FAR - 1.0);
    for (let i = 0; i < 3; i++) c.fig('sit', -1.5 + i * 1.1, { d: c.FAR - 1.4, h: 0.92 });
    for (let i = 0; i < 3; i++) c.glow(0xffd070, -0.5 + i * 0.5, 4.2 - Math.abs(i - 1) * 0.2, 0.2, 0.4, 0.2, c.FAR - 1.0, c.an(A.FLICKER, 2, { ph: i * 0.3 }));
    c.box(0x6a4a20, 1.4, 3.6, 1.0, 1.4, 0.1, c.FAR - 0.15);
    c.box(0x2a4a8a, 1.4, 3.6, 0.8, 1.2, 0.08, c.FAR - 0.1);
  });
  v('machine-shop', (c) => {
    c.plate(0x6a6a60);
    c.box(0x3a3c40, -0.6, 0.5, 2.4, 1.0, 0.8, c.FAR - 0.8);
    c.cyl(0x8a8e96, -0.6, 1.3, 1.6, 0.15, c.FAR - 0.8);
    c.fan(0x2a2c30, 0.2, 1.3, 0.35, 12, c.FAR - 0.8);
    c.glow(0xffd080, 0.25, 1.3, 0.1, 0.1, 0.1, c.FAR - 1.1, c.an(A.FLICKER, 20));
    c.fig('stand', -1.5, { d: c.FAR - 1.6 });
    for (let i = 0; i < 3; i++) c.box(0x2a2c30, 1.5, 0.6 + i * 1.2, 0.8, 0.08, 0.6, c.FAR - 0.5);
    c.glow(0xffffff, 0, 5.3, 2.0, 0.08, 0.3, c.FAR - 1.0);
  });
  v('shield-generator', (c) => {
    c.plate(0x1a0a30);
    for (const a of [-1.2, 1.2]) c.cyl(0x3a2a50, a, 2.2, 3.6, 0.6, c.FAR - 1.0, { rot: Math.PI / 2 });
    c.glow(0xc080ff, 0, 2.2, 0.5, 0.5, 0.5, c.FAR - 1.0, c.an(A.PULSE, 2));
    for (let i = 0; i < 6; i++) c.glow(0xb060ff, 0, 1.0 + i * 0.5, 2.2, 0.05, 0.05, c.FAR - 1.0, { anim: A.BOLT, rate: 2 + c.rnd(600 + i) * 3, ph: c.rnd(620 + i), rot: (c.rnd(640 + i) - 0.5) * 0.6 });
    c.glow(0x8040ff, 0, 5.2, 3.0, 0.08, 0.06, c.FAR - 0.1, c.an(A.PULSE, 2, { ph: 0.3 }));
  });
  v('escape-pods', (c) => {
    c.plate(0x30363c);
    for (let i = 0; i < 4; i++) {
      const a = -1.35 + i * 0.9;
      c.cyl(0x9aa0a8, a, 1.4, 2.4, 0.38, c.FAR - 0.7, { rot: Math.PI / 2 });
      c.box(0x50565e, a, 0.2, 0.9, 0.3, 0.9, c.FAR - 0.7);
      c.glow(0x30ff60, a, 3.0, 0.3, 0.1, 0.1, c.FAR - 0.7, c.an(A.BLINK, 0.5 + i * 0.2));
    }
    c.glow(0xff3020, 0, 5.4, 0.6, 0.12, 0.06, c.FAR - 0.1, c.an(A.STROBE, 1));
  });
  v('gunnery', (c) => {
    c.plate(0x3a2a1a);
    c.cyl(0x505860, 0.3, 2.4, 2.8, 0.7, c.FAR - 1.0);
    c.box(0x3a3e46, 0.3, 1.0, 1.4, 2.0, 1.4, c.FAR - 1.0);
    c.fig('sit', -1.4, { y: 0.6, d: c.FAR - 1.6 }).fig('stand', 1.6, { d: c.FAR - 1.5 });
    for (let i = 0; i < 3; i++) c.cyl(0xb0b4bc, -1.5 + i * 0.3, 0.4, 0.9, 0.12, c.FAR - 0.5);
    c.glow(0xff2020, 0, 5.2, 0.3, 0.14, 0.14, c.FAR - 0.6, c.an(A.BLINK, 1.5));
  });
  v('dark-level', (c) => {
    c.plate(0x0a0a0c);
    c.glow(0xd0d0c0, 0, 5.4, 0.6, 0.08, 0.2, c.FAR - 0.6, c.an(A.FLICKER, 9));
    c.glow(0x3a3a34, 0, 3.0, 2.0, 3.0, 0.06, c.FAR - 0.1, c.an(A.FLICKER, 9));
    c.fig('stand', 0.1, { col: 0x000000, d: c.FAR - 1.4 });
  });
  v('cantina', (c) => {
    c.plate(0x2a1030);
    for (let i = 0; i < 6; i++) c.glow(0xff40a0, -1.6 + i * 0.64, 5.0, 0.3, 0.3, 0.3, c.FAR - 0.8, c.an(A.CYCLE, 0.4, { ph: i / 6 }));
    c.box(0x3a1a30, -0.4, 0.5, 2.6, 1.0, 0.6, c.FAR - 0.7);
    for (let i = 0; i < 5; i++) c.glow(i % 2 ? 0x60ff80 : 0xffd040, -1.4 + i * 0.5, 1.2, 0.08, 0.3, 0.08, c.FAR - 0.5);
    c.fig('stand', -1.6, { d: c.FAR - 1.4 }).fig('raise', -0.6, { d: c.FAR - 1.5, anim: true, rate: 0.8 }).fig('sit', 0.5, { d: c.FAR - 1.4 }).fig('walk', 1.5, { d: c.FAR - 1.6 });
  });
  v('droid-pool', (c) => {
    c.plate(0x203040);
    const cols = [0x3a5aaa, 0xaa3a3a, 0x3aaa5a, 0xc8c8c8, 0xaa7a2a, 0x5a3aaa];
    for (let i = 0; i < 6; i++) c.astro(cols[i], -1.6 + i * 0.64, { d: c.FAR - 0.7 - (i % 2) * 0.6, dome: i % 3 ? 0xc0c6cc : 0x2a2e36 });
    c.glow(0x40a0ff, 0, 5.2, 2.6, 0.1, 0.06, c.FAR - 0.1);
  });
  v('arboretum', (c) => {
    c.plate(0x8fd0ff);
    for (const a of [-1.3, 0.1, 1.4]) {
      c.cyl(0x4a3a20, a, 1.3, 2.6, 0.12, c.FAR - 1.0, { rot: Math.PI / 2 });
      c.box(0x2f8a3a, a, 3.2, 1.3, 1.6, 1.2, c.FAR - 1.0);
      c.box(0x3aa04a, a + 0.2, 3.9, 0.8, 0.8, 0.8, c.FAR - 1.0);
    }
    c.box(0x3a7a30, 0, 0.1, 3.8, 0.2, 1.6, c.FAR - 1.0);
    c.fig('walk', 0.7, { d: c.FAR - 1.7 });
  });
  v('capacitor', (c) => {
    c.plate(0x101a2a);
    c.cyl(0x2a3040, 0, 3.0, 5.6, 0.7, c.FAR - 1.0, { rot: Math.PI / 2 });
    for (let i = 0; i < 4; i++) c.glow(0x40ffe0, 0, 1.0 + i * 1.3, 1.8, 0.1, 1.8, c.FAR - 1.0, c.an(A.PULSE, 3, { ph: i * 0.25 }));
    c.glow(0x40ffe0, 0, 5.6, 0.3, 0.3, 0.3, c.FAR - 1.0, c.an(A.PULSE, 3));
  });
  v('range', (c) => {
    c.plate(0x505a50);
    for (let i = 0; i < 3; i++) c.box(0x1a1c1a, 1.0 + i * 0.4, 1.3, 0.3, 1.8, 0.1, c.FAR - 0.3 + i * 0.05);
    c.fig('kneel', -1.4, { d: c.FAR - 1.4 });
    c.box(0x0a0a0c, -0.9, 0.95, 0.7, 0.07, 0.07, c.FAR - 1.4);
    for (let i = 0; i < 3; i++) c.glow(0x40ff60, 0.2 + i * 0.4, 1.0, 0.8, 0.05, 0.05, c.FAR - 1.4, { anim: A.BOLT, rate: 1.2, ph: i * 0.33 });
    c.glow(0xff3020, 1.4, 4.6, 0.14, 0.14, 0.14, c.FAR - 0.3, c.an(A.BLINK, 1));
  });
  v('cryo', (c) => {
    c.plate(0x9ad0ff);
    for (let i = 0; i < 4; i++) {
      const a = -1.35 + i * 0.9;
      c.glass(0x80c0ff, a, 1.4, 0.7, 2.2, 0.7, c.FAR - 0.7, { rot: 0.25 });
      c.fig('hang', a, { y: 0.4, h: 0.8, col: 0x102030, d: c.FAR - 0.7 });
      c.glow(0xffffff, a, 2.7, 0.2, 0.05, 0.05, c.FAR - 0.7, c.an(A.BLINK, 0.3 + i * 0.1));
    }
    c.glass(0xe0f0ff, 0, 0.4, 3.8, 0.5, 2.0, c.FAR - 1.5, c.an(A.WOBBLE, 0.4, { amp: 0.3 }));
  });
  v('comm-array', (c) => {
    c.plate(0x0a1420);
    c.fan(0x1a2030, 0.6, 3.4, 1.0, 0.6, c.FAR - 0.8);
    c.cyl(0x3a4050, 0.6, 1.4, 2.8, 0.15, c.FAR - 0.8, { rot: Math.PI / 2 });
    c.box(0x101820, -1.3, 2.0, 0.8, 4.0, 0.7, c.FAR - 0.5);
    for (let j = 0; j < 5; j++) c.glow(0xff4030, -1.3, 0.5 + j * 0.8, 0.3, 0.05, 0.02, c.FAR - 0.87, c.an(A.BLINK, 2 + j));
    c.glow(0xff4030, 0.6, 5.8, 0.1, 0.1, 0.1, c.FAR - 0.8, c.an(A.STROBE, 0.7));
  });
  v('muster', (c) => {
    c.plate(0xb0c0d0);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) c.fig('stand', -1.5 + i * 0.8 + r * 0.3, { col: 0xdde2ea, d: c.FAR - 0.5 - r * 0.8, h: 0.95 });
    c.fig('raise', 1.7, { d: c.FAR - 1.9, anim: true, rate: 0.4 });
    c.glow(0xff3020, 0, 5.3, 2.4, 0.1, 0.06, c.FAR - 0.1, c.an(A.STROBE, 0.5));
  });
  v('incinerator', (c) => {
    c.plate(0x2a0c04);
    c.cyl(0x3a3034, 0, 2.6, 3.0, 1.2, c.FAR - 1.0);
    c.glow(0xff4010, 0, 2.6, 0.9, 0.9, 1.6, c.FAR - 1.0, c.an(A.FLICKER, 10));
    c.glow(0xffa030, 0, 2.6, 0.5, 0.5, 1.7, c.FAR - 1.0, c.an(A.FLICKER, 13, { ph: 0.4 }));
    c.box(0x2a2428, 0, 4.8, 1.0, 1.6, 1.0, c.FAR - 1.0);
    c.fig('stand', -1.7, { d: c.FAR - 1.7 });
  });
  v('specimen-lab', (c) => {
    c.plate(0x083030);
    for (let i = 0; i < 3; i++) {
      const a = -1.2 + i * 1.2;
      c.glass(0x30a0c0, a, 2.4, 1.0, 2.0, 1.0, c.FAR - 0.7);
      c.box(0x0a1a18, a + (i - 1) * 0.1, 2.0 + c.rnd(700 + i) * 0.8, 0.6, 0.3, 0.3, c.FAR - 0.7, c.an(A.SWAY, 0.5 + i * 0.2, { amp: 0.25, ph: i * 0.4 }));
      c.box(0x1a2a2a, a, 1.2, 1.0, 0.4, 1.0, c.FAR - 0.7);
    }
    c.fig('stand', 1.7, { col: 0xe0e6ee, d: c.FAR - 1.6, h: 0.95 });
  });
  v('winch-room', (c) => {
    c.plate(0x262a30);
    c.fan(0x0e1014, -0.6, 3.6, 1.4, 2.5, c.FAR - 1.0);
    c.fan(0x0e1014, 1.2, 3.6, 0.9, -3.8, c.FAR - 1.0);
    for (const a of [-0.9, -0.3, 0.9, 1.5]) c.cyl(0x8a8e96, a, 1.5, 3.0, 0.04, c.FAR - 1.0, { rot: Math.PI / 2 });
    c.box(0x3a3e46, 0, 0.6, 3.6, 1.2, 1.2, c.FAR - 0.8);
    c.glow(0xffb020, -1.7, 1.0, 0.14, 0.14, 0.14, c.FAR - 1.5, c.an(A.BLINK, 0.8));
  });
  v('compactor', (c) => {
    c.plate(0x2a2a20);
    for (let i = 0; i < 9; i++) c.box(i % 2 ? 0x4a4a40 : 0x5a5040, -1.3 + (i % 3) * 0.9, 0.5 + Math.floor(i / 3) * 0.9, 0.7 + c.rnd(800 + i) * 0.4, 0.6, 0.7, c.FAR - 0.9, { rot: c.rnd(820 + i) * 1.2 });
    c.box(0x30343a, 1.9, 1.6, 0.3, 3.0, 3.6, c.FAR - 1.9, c.an(A.SWAY, 0.25, { amp: 0.5 }));
    c.glow(0xff2020, 0, 5.2, 0.2, 0.2, 0.2, c.FAR - 0.6, c.an(A.STROBE, 0.8));
  });
  v('searchlight', (c) => {
    /* A dark maintenance level with a lamp sweeping it. */
    c.plate(0x14161c);
    c.glow(0xfff0d0, 0, 2.6, 0.7, 5.0, 0.1, c.FAR - 0.2, c.an(A.SWAY, 0.5, { amp: 1.5 }));
    c.glow(0xfff0d0, 0, 5.6, 0.3, 0.3, 0.3, c.FAR - 1.0, c.an(A.SWAY, 0.5, { amp: 0.3 }));
    for (let i = 0; i < 3; i++) c.box(0x2a2c30, -1.2 + i * 1.2, 1.2, 0.8, 2.4, 0.8, c.FAR - 0.6);
    c.fig('walk', 0.4, { d: c.FAR - 1.5, col: 0x000000 });
  });
  v('turbine-hall', (c) => {
    c.plate(0x3a3a44);
    c.fan(0x1a1c22, 0, 3.0, 2.0, 4.5, c.FAR - 1.0);
    c.cyl(0x6a6e76, 0, 3.0, 0.6, 2.4, c.FAR - 0.4);
    c.box(0x2a2d33, 0, 0.6, 3.8, 0.08, 1.0, c.FAR - 1.8);
    c.fig('stand', -1.6, { d: c.FAR - 1.8, h: 0.9 });
    c.glow(0xff3a2a, -1.8, 0.9, 0.14, 0.14, 0.14, c.FAR - 2.0, c.an(A.BLINK, 1));
    c.glow(0xff3a2a, 1.8, 0.9, 0.14, 0.14, 0.14, c.FAR - 2.0, c.an(A.BLINK, 1, { ph: 0.5 }));
  });
  v('bridge-corridor', (c) => {
    c.plate(0xdde4ee);
    for (let i = 0; i < 4; i++) c.glow(0xffffff, -1.5 + i * 1.0, 5.4, 0.7, 0.08, 0.3, c.FAR - 0.6);
    c.fig('walk', -1.2, { d: c.FAR - 0.8 }).fig('walk', 0.2, { d: c.FAR - 1.2, h: 0.95 }).fig('stand', 1.5, { d: c.FAR - 0.6, col: 0xdde2ea });
    c.box(0x2a2e36, 0, 0.0, 3.6, 0.06, 1.4, c.FAR - 1.0);
    c.glow(0x40a0ff, -1.85, 1.6, 0.06, 0.4, 0.3, c.FAR - 0.2, c.an(A.BLINK, 0.7));
  });
  return R;
}

/** A parked fighter's shape, flat, in the along/up plane, ~3.6 m across. */
function fighterGeometry(faction) {
  const s = new THREE.Shape();
  if (faction === 'separatist') {
    /* A vulture's read: a narrow body, two long wings hooked down. */
    s.moveTo(-0.25, 0.9); s.lineTo(0.25, 0.9); s.lineTo(0.35, -0.2); s.lineTo(1.9, 0.5); s.lineTo(1.7, -0.9);
    s.lineTo(0.3, -0.7); s.lineTo(0, -1.0); s.lineTo(-0.3, -0.7); s.lineTo(-1.7, -0.9); s.lineTo(-1.9, 0.5);
    s.lineTo(-0.35, -0.2); s.closePath();
  } else {
    /* A wedge with engine nacelles either side: the Republic's fighters. */
    s.moveTo(0, 1.1); s.lineTo(0.45, -0.6); s.lineTo(1.3, -0.5); s.lineTo(1.35, 0.4); s.lineTo(1.7, 0.4);
    s.lineTo(1.7, -1.0); s.lineTo(0.5, -1.0); s.lineTo(0.3, -0.85); s.lineTo(-0.3, -0.85); s.lineTo(-0.5, -1.0);
    s.lineTo(-1.7, -1.0); s.lineTo(-1.7, 0.4); s.lineTo(-1.35, 0.4); s.lineTo(-1.3, -0.5); s.lineTo(-0.45, -0.6);
    s.closePath();
  }
  const g = new THREE.ShapeGeometry(s);
  /* Shape x → along (local z), shape y stays up; normal ends along local x. */
  g.rotateY(-Math.PI / 2);
  return g;
}

/** A turbine: a ring, a hub, six blades; normal along local x so it faces the pane. Unit radius. */
function turbineGeometry() {
  const parts = [];
  const ring = new THREE.TorusGeometry(1.0, 0.08, 5, 28);
  parts.push(ring);
  const hub = new THREE.CylinderGeometry(0.22, 0.22, 0.24, 12); hub.rotateX(Math.PI / 2);
  parts.push(hub);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.BoxGeometry(0.27, 0.84, 0.06);
    b.translate(0, 0.58, 0);
    b.rotateZ((i / 6) * Math.PI * 2);
    parts.push(b);
  }
  const g = mergeBoxes(parts);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Step noise in [0, 1) that changes `rate` times a second. */
const stepNoise = (t, rate, ph) => hash(Math.floor(t * rate + ph * 977), 3);

/**
 * Lay every kind at scroll `s` and time `t`. With `full` false only the
 * animated slots are recomposed — the scene is still, but its fans turn and
 * its fires burn. Allocates nothing.
 */
function layScene(st, s, t, full = true) {
  const sc = st.scene;
  const H2 = LIFT.height / 2;
  const nAt = st.readout.number;
  const zeroM = sc.zeroM;
  for (const k of sc.kinds) {
    const mesh = k.mesh, slots = k.slots;
    if (!slots.length) continue;
    const list = full ? null : k.anims;
    const n = full ? slots.length : list.length;
    let colour = false;
    for (let j = 0; j < n; j++) {
      const i = full ? j : list[j];
      const o = slots[i], f = o.f;
      let w = o.wrap ? ((o.base + s) % SPAN + SPAN) % SPAN - SPAN / 2 : o.base + s;
      if (w < -BOX_HALF + 0.6 || w > BOX_HALF - 0.6) { mesh.setMatrixAt(i, zeroM); continue; }
      let a = o.a, sx = o.sx, sy = o.sy, sz = o.sz, rot = o.rot, bright = -1;
      switch (o.anim) {
        case A.SWEEP: { const g = Math.exp(-(w * w) / 1.8); _c.setHex(o.col).multiplyScalar(0.45 + 1.4 * g); bright = 1; break; }
        case A.DIGIT: {
          /* The number on this crossing: the readout's, plus the levels above the window. */
          const m = Math.round((w - SLAB_W - 3.2) / LEVEL);
          const num = Math.max(0, nAt + m);
          const d = o.digit === 0 ? Math.floor(num / 10) % 10 : num % 10;
          if (!SEVEN[d][o.seg]) sx = sy = sz = 0;
          break;
        }
        case A.SPIN: rot += t * o.rate; break;
        case A.SLIDE: {
          const u = ((t * o.rate + o.ph) % 1 + 1) % 1;
          a += (u - 0.5) * o.span * f.ka;
          if (Math.abs(a) > o.edge * f.ka) sx = sy = sz = 0;
          break;
        }
        case A.FLICKER: {
          const nz = stepNoise(t, o.rate, o.ph);
          _c.setHex(o.col).multiplyScalar(0.45 + 0.75 * nz); bright = 1;
          sy *= 0.75 + 0.5 * nz;
          break;
        }
        case A.STROBE: { const on = ((t * o.rate + o.ph) % 1) < 0.18; _c.setHex(o.col).multiplyScalar(on ? 1.6 : 0.12); bright = 1; break; }
        case A.PULSE: { _c.setHex(o.col).multiplyScalar(0.55 + 0.5 * Math.sin((t * o.rate + o.ph) * Math.PI * 2)); bright = 1; break; }
        case A.BLINK: { const on = stepNoise(t, o.rate, o.ph) > 0.5; _c.setHex(o.col).multiplyScalar(on ? 1.4 : 0.15); bright = 1; break; }
        case A.BOLT: { const u = ((t * o.rate + o.ph) % 1 + 1) % 1; if (u > 0.09) sx = sy = sz = 0; break; }
        case A.WOBBLE: { const g = Math.sin((t * o.rate + o.ph) * Math.PI * 2); sy *= 1 + 0.1 * o.amp * g; sz *= 1 + 0.05 * o.amp * g; _c.setHex(o.col).multiplyScalar(0.85 + 0.25 * g); bright = 1; break; }
        case A.ARM: {
          const up = ((t * o.rate + o.ph) % 1) < 0.5;
          if (up) { w += o.base2 - o.base; rot = o.rot2; }
          break;
        }
        case A.SWAY: { const g = Math.sin((t * o.rate + o.ph) * Math.PI * 2); a += o.amp * g * f.ka; rot += 0.15 * o.amp * g; break; }
        case A.CYCLE: { _c.setHSL(((t * o.rate * 0.25 + o.ph) % 1 + 1) % 1, 0.9, 0.6); bright = 1; break; }
        default: break;
      }
      _v.copy(f.o).addScaledVector(f.out, o.d).addScaledVector(f.along, a);
      _v.y = H2 + w;
      _s.set(sx, sy, sz);
      if (rot) mesh.setMatrixAt(i, _m.compose(_v, _q.copy(f.q).multiply(_q2.setFromAxisAngle(_X, rot)), _s));
      else mesh.setMatrixAt(i, _m.compose(_v, f.q, _s));
      if (bright > 0) { mesh.setColorAt(i, _c); colour = true; }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colour && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  _s.set(1, 1, 1);
  st.laid = s;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DOORS                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Put the door-pair collider in: one box between the inner and outer leaves. */
function shutDoors(world, st) {
  if (st.doorBox || !world.physics?.addStaticBox) return;
  const L = LIFT;
  st.doorBox = world.physics.addStaticBox(
    st.place ? st.place(L.x, L.height / 2, (DOOR.zIn + DOOR.zOut) / 2)
      : new THREE.Vector3(L.x, L.height / 2, (DOOR.zIn + DOOR.zOut) / 2),
    new THREE.Vector3(DOOR.halfW + 0.1, L.height / 2 + 0.2, 0.45),
    new THREE.Quaternion().setFromAxisAngle(_Y, st.yaw || 0), { friction: 0.6 });
}

/** …and take it out. */
function freeDoors(world, st) {
  if (!st.doorBox) return;
  world.physics?.removeStaticBox?.(st.doorBox);
  st.doorBox = null;
}

/** Slide all four leaves to `k` (0 shut, 1 open). */
function setDoors(world, st, k) {
  st.open = clamp(k, 0, 1);
  const e = smoothstep(0, 1, st.open);
  const L = LIFT;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const x = L.x + s * (DOOR.leafW / 2 + e * DOOR.slide);
    st.doors[i].position.x = x;
    st.outerDoors[i].position.x = x;
  }
}

/**
 * A world point in LIFT SPACE — the frame everything in this file is written
 * in, whichever shaft the car is actually standing in. One function, so the
 * four tests below cannot drift from the placement above (HANDOFF §2.4:
 * never restate a rule; call it).
 */
const _lp = new THREE.Vector3();
function toLift(world, p) {
  const st = world?._deckLift;
  if (!st || (!st.ox && !st.oz && !st.yaw && !st.oy)) return p;
  const L = LIFT;
  const bx = L.x + st.ox - (L.x * Math.cos(st.yaw) + L.z * Math.sin(st.yaw));
  const bz = L.z + st.oz - (-L.x * Math.sin(st.yaw) + L.z * Math.cos(st.yaw));
  const dx = p.x - bx, dz = p.z - bz;
  const c = Math.cos(-st.yaw), sn = Math.sin(-st.yaw);
  return _lp.set(dx * c + dz * sn, p.y - st.oy, -dx * sn + dz * c);
}

/** Is the player standing inside the car, clear of the leaves? */
function inCar(world) {
  const raw = world.player?.position;
  if (!raw) return false;
  const p = toLift(world, raw);
  const L = LIFT;
  return Math.abs(p.x - L.x) < L.halfW - 0.1 && p.z > L.z - L.halfD && p.z < DOOR.zIn - 0.45;
}

/** Is the player near enough to the doors, on the deck side, to call the car? */
export function atTheDoors(world) {
  const raw = world.player?.position;
  if (!raw) return false;
  const p = toLift(world, raw);
  const L = LIFT;
  return Math.abs(p.x - L.x) < L.halfW + 2.5 && p.z > L.door - 0.2 && p.z < L.door + RIDE.reach;
}

/**
 * The deck's interact key, at the doors. Returns true when it was spent here,
 * so the caller (DeckEdit.focusKey) does not also try to pick a man.
 */
export function liftKey(world) {
  const st = world?._deckLift;
  if (!st) return false;
  /**
   * ══ THE BUTTON COLUMN ═════════════════════════════════════════════════
   *
   * Inside the car, the interact key cycles the floor rather than calling a
   * car that is already here. `atTheDoors` is false in the car by
   * construction (it tests the deck side of the threshold), so the two
   * meanings of one key can never both fire on one press.
   *
   * Only while the doors are open: pressing it after the seal would change
   * where a ride already under way was going, and a lift that changes its
   * mind mid-shaft is a bug report and not a feature.
   */
  if (FLOORS.length > 1 && inCar(world)
      && (st.state === STATE.WAIT || st.state === STATE.OUT || st.state === STATE.OPENING)) {
    st.pick = (st.pick + 1) % FLOORS.length;
    const f = FLOORS[st.pick];
    lightButtons(st);
    world.notify?.(String(f.label).toUpperCase(), `deck ${f.n} — step back to ride`);
    audio.tone?.({ freq: 540, freqEnd: 700, dur: 0.09, gain: 0.10, pos: _v.set(LIFT.x, 1.6, LIFT.z) });
    return true;
  }
  if (!atTheDoors(world)) return false;
  if (st.state === STATE.AWAY) {
    st.state = STATE.CALLED; st.t = 0;
    st.lampMat.color.setHex(0xffb347);
    world.notify?.('LIFT CALLED', 'the car is on its way');
    audio.tone?.({ freq: 660, freqEnd: 720, dur: 0.14, gain: 0.12, pos: _v.set(LIFT.x, 1.6, LIFT.door) });
    return true;
  }
  if (st.state === STATE.WAIT) {
    world.notify?.('STEP IN', 'the car takes you to the bridge');
    return true;
  }
  return false;
}

/** Whether the lift is currently the thing holding the player. For checks and the HUD. */
export function liftBusy(world) {
  const s = world?._deckLift?.state;
  return s === STATE.RIDE || s === STATE.STOP || s === STATE.SEAL || s === STATE.LEAVE;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE FRAME                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * One frame. Allocates nothing.
 */
export function stepDeckLift(world, dt) {
  const st = world?._deckLift;
  if (!st || !(dt > 0) || !st.car?.parent) return;
  st.t += dt;
  const L = LIFT;
  const pos = _v.set(L.x, 1.6, L.z);

  switch (st.state) {
    case STATE.RIDE: {
      /* The speed profile: nothing while the doors settle, a hard ramp up, a
       * cruise, and a longer ramp down — a lift decelerates for longer than it
       * accelerates because the stop has to be gentle enough to stand
       * through. */
      const t = st.t - RIDE.settle;
      const T = RIDE.ride;
      let k = 0;
      if (t > 0) k = smoothstep(0, 0.9, t) * (1 - smoothstep(T - RIDE.brake, T, t));
      if (t > 0 && t - dt <= 0) st.dip = 1;
      st.v = st.dir * RIDE.speed * k;
      /* The shaft goes DOWN past the window when the car goes up. */
      st.scroll -= st.v * dt;
      /* THE LANDING. The moment the brake begins, the remaining travel is
       * known (`tail`), so the difference between where the ride will end
       * and the level it should end on is spread over the brake as an
       * easing — a few centimetres a frame on top of forty metres a second,
       * invisible, and the car stops on a landing every time. */
      if (t >= T - RIDE.brake && !st.snapped) {
        st.snapped = true;
        const projected = st.scroll - st.dir * st.tail;
        st.snapFix = -st.dir * st.rideLen - projected;
        st.snapK = 0;
      }
      if (st.snapped) {
        const e = smoothstep(T - RIDE.brake, T, t);
        st.scroll += st.snapFix * (e - st.snapK);
        st.snapK = e;
      }
      st.lampMat.color.setHex(0x3adf7a);
      if (t >= T) {
        st.scroll = -st.dir * st.rideLen;
        st.stopScroll = st.scroll;
        st.state = STATE.STOP; st.t = 0; st.v = 0; st.dip = 1;
        audio.thud?.(pos, 0.5);
        world.player?.camera?.addShake?.(0.22);
        /* The chime: two notes, a fifth apart. */
        audio.tone?.({ freq: 784, dur: 0.16, gain: 0.14, pos });
        setTimeout(() => audio.tone?.({ freq: 1175, dur: 0.22, gain: 0.12, pos }), 170);
      }
      break;
    }
    case STATE.STOP: {
      if (st.t >= 0.55) {
        st.state = STATE.OPENING; st.t = 0;
        freeDoors(world, st);
        audio.noise?.({ dur: RIDE.doors, gain: 0.07, type: 'bandpass', freq: 420, q: 1.2, pos });
        world.notify?.('THE FLIGHT DECK', 'walk out — your company is on the deck', 'flavour');
      }
      break;
    }
    case STATE.OPENING: {
      setDoors(world, st, st.t / RIDE.doors);
      if (st.t >= RIDE.doors) { setDoors(world, st, 1); st.state = STATE.OUT; st.t = 0; }
      break;
    }
    case STATE.OUT: {
      /* Doors open; waiting for him to be clear of the threshold. `t` is
       * reset while he stands in the car, so a player who lingers is not shut
       * in. */
      const p = world.player?.position;
      const q = p ? toLift(world, p) : null;
    const clear = q && (q.z > L.door + 1.2 || Math.abs(q.x - L.x) > L.halfW + 1.0);
      if (!clear) st.t = 0;
      else if (st.t >= RIDE.linger) {
        st.state = STATE.CLOSING; st.t = 0;
        audio.noise?.({ dur: RIDE.doors, gain: 0.07, type: 'bandpass', freq: 420, q: 1.2, pos });
      }
      break;
    }
    case STATE.CLOSING: {
      setDoors(world, st, 1 - st.t / RIDE.doors);
      if (st.t >= RIDE.doors) {
        setDoors(world, st, 0);
        shutDoors(world, st);
        st.state = STATE.AWAY; st.t = 0;
        /* The car goes: the lamp goes red and the shaft streams behind the
         * shut doors, which nobody can see and which is why the lamp is the
         * tell. */
        st.lampMat.color.setHex(0xff3418);
        audio.noise?.({ dur: 2.6, gain: 0.06, type: 'lowpass', freq: 150, q: 0.6, pos });
      }
      break;
    }
    case STATE.AWAY: {
      /* The shaft keeps moving for a while behind the doors, then rests. */
      st.v = st.t < 2.6 ? st.dir * RIDE.speed * smoothstep(0, 0.6, st.t) * (1 - smoothstep(1.8, 2.6, st.t)) : 0;
      st.scroll -= st.v * dt;
      /* Tell him once how to leave, when he first comes back to the doors. */
      if (!st.told && atTheDoors(world)) {
        st.told = true;
        world.notify?.('THE LIFT', 'inspect key at the doors calls the car — it takes you to the bridge');
      }
      break;
    }
    case STATE.CALLED: {
      if (st.t >= RIDE.arrive) {
        st.state = STATE.ARRIVING; st.t = 0;
        /* The car is back on the flight deck: the scene rests on the landing it left. */
        st.scroll = st.stopScroll; st.v = 0; st.dip = 1;
        st.lampMat.color.setHex(0x3adf7a);
        audio.thud?.(pos, 0.35);
        audio.tone?.({ freq: 784, dur: 0.16, gain: 0.12, pos });
        freeDoors(world, st);
      } else {
        /* The car coming: the shaft streams the other way behind the doors. */
        st.v = -st.dir * RIDE.speed * smoothstep(0, 0.5, st.t) * (1 - smoothstep(RIDE.arrive - 1.0, RIDE.arrive, st.t));
        st.scroll -= st.v * dt;
      }
      break;
    }
    case STATE.ARRIVING: {
      setDoors(world, st, st.t / RIDE.doors);
      if (st.t >= RIDE.doors) { setDoors(world, st, 1); st.state = STATE.WAIT; st.t = 0; }
      break;
    }
    case STATE.WAIT: {
      if (inCar(world)) {
        if (st.t >= 0.6) {
          st.state = STATE.SEAL; st.t = 0;
          world.notify?.('TO THE BRIDGE', 'hold on');
          audio.noise?.({ dur: RIDE.doors, gain: 0.07, type: 'bandpass', freq: 420, q: 1.2, pos });
        }
      } else st.t = 0;
      break;
    }
    case STATE.SEAL: {
      setDoors(world, st, 1 - st.t / RIDE.doors);
      if (st.t >= RIDE.doors) {
        setDoors(world, st, 0);
        shutDoors(world, st);
        st.state = STATE.LEAVE; st.t = 0;
        st.stopScroll = st.scroll;
        audio.noise?.({ dur: RIDE.settle + RIDE.ride, gain: 0.09, type: 'lowpass', freq: 160, q: 0.6, pos });
      }
      break;
    }
    case STATE.LEAVE: {
      /* The same ride, the other way, and it ends on the menu rather than on
       * a door: main.js takes the world down under the streaming shaft. */
      const t = st.t - RIDE.settle;
      const T = RIDE.ride * 0.62;
      let k = 0;
      if (t > 0) k = smoothstep(0, 0.9, t);
      if (t > 0 && t - dt <= 0) st.dip = 1;
      /* The same way as the ride in — the bridge is above the flight deck —
       * so the strip carries on past the landing into levels not yet seen. */
      st.v = st.dir * RIDE.speed * k;
      st.scroll -= st.v * dt;
      if (t >= T && !st.left) {
        st.left = true;
        st.state = STATE.GONE;
        /* SHARK §5.2: `onDeckLift(floor)` when a floor other than the menu's
         * was chosen, and `onDeckLeave` otherwise. `main.js` answers both;
         * with the switch off there is only one floor and only the second can
         * ever fire, which is today's behaviour exactly. */
        const f = FLOORS[st.pick % FLOORS.length];
        if (f && f.level) world.onDeckLift?.(f);
        else world.onDeckLeave?.();
      }
      break;
    }
    default: break;
  }

  /* ── WHAT EVERY STATE SHARES: the scene is relaid when it has moved, the
   * turbines turn, the car sways with its speed, the light dips and
   * recovers, and the readout counts. */
  setReadout(st);
  st.time += dt;
  /* A faint whoosh as each level goes by, at speed. */
  const lev = Math.floor(st.scroll / LEVEL);
  if (lev !== st.lastLev) {
    st.lastLev = lev;
    if ((st.state === STATE.RIDE || st.state === STATE.LEAVE) && Math.abs(st.v) > RIDE.speed * 0.35 && st.time - st.whooshAt > 0.11) {
      st.whooshAt = st.time;
      audio.noise?.({ dur: 0.09, gain: 0.04, type: 'bandpass', freq: 700 + hash(lev, 9) * 700, q: 1.8, pos: _v.set(L.x, 1.6, L.z) });
    }
  }
  /* The scene: relaid whole when it has moved, its animated slots only when it has not. */
  layScene(st, st.scroll, st.time, st.scroll !== st.laid);
  const k = Math.min(1, Math.abs(st.v) / RIDE.speed);
  const tt = st.t;
  st.car.position.set(
    k * (0.022 * Math.sin(tt * 2.3) + 0.008 * Math.sin(tt * 9.1)),
    k * (0.010 * Math.sin(tt * 5.7) + 0.004 * Math.sin(tt * 13.3)),
    k * 0.006 * Math.sin(tt * 3.1));
  st.dip *= Math.exp(-dt * 5.5);
  if (st.dip < 1e-3) st.dip = 0;
  /* THE CAR GOES DARK FOR THE RIDE. Eased toward 1 while the shaft moves,
   * back to 0 at the stop, so the lit openings outside own the window and
   * the car is a dim box you look out of. The readout and the buttons are
   * the kit's materials and stay lit. */
  const want = Math.abs(st.v) > 0.5 ? 1 : 0;
  st.dimK += (want - st.dimK) * Math.min(1, dt * (want ? 2.2 : 3.5));
  const dim = 1 - 0.6 * st.dimK;
  const lit = (1 - 0.55 * st.dip) * dim;
  st.glow.intensity = 90 * lit;
  st.lightMat.color.copy(st.lightBase).multiplyScalar(lit);
  for (const m of st.carMats) {
    m.color.copy(m.userData.base).multiplyScalar(dim);
    if (m.emissive && m.userData.baseEm) m.emissive.copy(m.userData.baseEm).multiplyScalar(dim);
  }
}

/** The state name, for a HUD or a check. */
export function liftState(world) { return world?._deckLift?.state ?? null; }

/**
 * Tear the car down without waiting for `World.unload`: the meshes are on
 * `statics` and go with the level, but the door collider is a static box the
 * level does not know about.
 */
export function undressDeckLift(world) {
  const st = world?._deckLift;
  if (!st) return;
  freeDoors(world, st);
  for (const b of st.solids) world.physics?.removeStaticBox?.(b);
  st.solids.length = 0;
  world._deckLift = null;
}
