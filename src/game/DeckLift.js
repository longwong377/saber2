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
 *   FAR    the ship: a deck level every `LEVEL` metres — a floor slab edge
 *          and above it an opening. Some are lit corridors with two or
 *          three standing silhouettes, dark against the light. Some are
 *          hangar mouths with a parked fighter's shape in them. One is a
 *          bulkhead crossing — a huge dark beam with its deck number lit
 *          on it in metre-high digits, which count with the readout. One
 *          is a machinery bay with a turbine spinning behind a grille. One
 *          is a fuel main with a lamp on it.
 *
 * Every kind of element is ONE `InstancedMesh` whose matrices are laid out
 * along the wrap each frame (`layScene`, like the old `layBars`) — nothing
 * is allocated after the build. The three windows show the pattern at three
 * different phases, so the left, right and back never show the same thing
 * at once, and the ride ends SNAPPED to a level: the last 1.4 s of the ramp
 * down nudges the scroll onto a landing so the stopped car looks out on a
 * lit corridor with people in it rather than on half a girder.
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
const _X = new THREE.Vector3(1, 0, 0);

/**
 * THE TIMINGS. `ride` is the number that decides how the room is entered:
 * long enough to look out of a window and read the speed, short enough that
 * a player who has been here before is not made to wait. Both rides are the
 * same length; the one out is the same lift.
 */
export const RIDE = {
  /** Seconds before the shaft starts to move: the doors have just shut. */
  settle: 0.5,
  /** Seconds of shaft going past. */
  ride: 4.4,
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

/** The shaft scene's pitch of deck levels, and its wrap: eight levels. */
export const LEVEL = 6;
const SPAN = 48;
/** The number on the readout when the car stops on the flight deck. */
export const FLIGHT_DECK = 32;
/** What a level is: a lit corridor, a hangar mouth, a bulkhead crossing, a
 * machinery bay, a fuel main. Eight over the wrap, rotated per face. */
const ROOM = 0, HANGAR = 1, BULK = 2, MACH = 3, FUEL = 4;
const LEVELS = [ROOM, HANGAR, BULK, ROOM, MACH, HANGAR, ROOM, FUEL];
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
  const glass = new THREE.MeshBasicMaterial({ color: 0x0c1220, transparent: true, opacity: 0.32,
    depthWrite: false, side: THREE.DoubleSide, name: 'car-pane' });
  glass.userData.saberNoInk = true; glass.userData.key = 'pane';
  const slitMat = new THREE.MeshBasicMaterial({ color: 0x0f1622, name: 'car-slit' });
  slitMat.userData.saberNoInk = true; slitMat.userData.key = 'slit';

  const B = new Bins(M.faction);
  const paneY0 = 1.05, paneY1 = 3.45;
  const inner = hw - 0.12;          /* the walls' inner face */
  const post = 0.7;                 /* the wide post at each end of a side pane */
  const zF = cz + hd, zA = cz - hd; /* the car's front (doors) and aft (back wall) */

  /* ── THE SIDE WALLS. */
  for (const s of [-1, 1]) {
    const x = cx + s * hw, f = cx + s * inner;
    B.box(M.hull, x, paneY0 / 2, cz, 0.24, paneY0, hd * 2);
    B.box(M.hull, x, (H + paneY1) / 2, cz, 0.24, H - paneY1, hd * 2);
    /* Posts: a wide one at each end, a mullion between two panes. */
    B.box(M.hull, x, (paneY0 + paneY1) / 2, zF - post / 2, 0.26, paneY1 - paneY0, post);
    B.box(M.hull, x, (paneY0 + paneY1) / 2, zA + post / 2, 0.26, paneY1 - paneY0, post);
    B.box(M.hull, x, (paneY0 + paneY1) / 2, cz, 0.26, paneY1 - paneY0, 0.2);
    /* The pane head trim and the sill. */
    B.box(M.dark, f - s * 0.015, paneY1 + 0.03, cz, 0.05, 0.06, hd * 2 - 0.2);
    B.box(M.glowDim, f - s * 0.04, paneY0 + 0.06, cz, 0.08, 0.08, hd * 2 - 0.4);
    /* Under the sill: the dado band, its ribs, the kick plate, the handrail. */
    B.box(M.dark, f - s * 0.02, 0.62, cz, 0.04, 0.6, hd * 2 - 0.3);
    for (let i = 0; i < 8; i++) B.box(M.hull, f - s * 0.045, 0.62, zA + 0.5 + i * 0.72, 0.05, 0.56, 0.08);
    B.box(M.dark, f - s * 0.015, 0.07, cz, 0.03, 0.14, hd * 2);
    B.box(M.hull, f - s * 0.09, 0.98, cz, 0.06, 0.06, hd * 2 - 0.5);
    for (const dz of [-2.0, 0, 2.0]) B.box(M.dark, f - s * 0.045, 0.98, cz + dz, 0.09, 0.04, 0.06);
    /* Over the pane: the light strip, recessed between two lips. */
    B.box(M.deep, f - s * 0.025, 3.78, cz, 0.05, 0.03, hd * 2 - 0.5);
    B.box(M.deep, f - s * 0.025, 3.56, cz, 0.05, 0.03, hd * 2 - 0.5);
    B.box(lightMat, f - s * 0.01, 3.67, cz, 0.02, 0.16, hd * 2 - 0.6);
    /* The panel lines on the upper wall. */
    for (const dz of [-1.5, 1.5]) B.box(M.dark, f - s * 0.01, 3.98, cz + dz, 0.02, 0.24, 0.05);
  }

  /* ── THE BACK WALL, which is a window too. */
  {
    const z = zA, f = zA + 0.12;
    B.box(M.hull, cx, paneY0 / 2, z, hw * 2 + 0.48, paneY0, 0.24);
    B.box(M.hull, cx, (H + paneY1) / 2, z, hw * 2 + 0.48, H - paneY1, 0.24);
    for (const s of [-1, 1]) B.box(M.hull, cx + s * (hw - 0.2), (paneY0 + paneY1) / 2, z, 0.4, paneY1 - paneY0, 0.3);
    B.box(M.hull, cx, (paneY0 + paneY1) / 2, z, 0.2, paneY1 - paneY0, 0.26);
    B.box(M.dark, cx, paneY1 + 0.03, f + 0.015, hw * 2 - 0.4, 0.06, 0.05);
    B.box(M.glowDim, cx, paneY0 + 0.06, f + 0.04, hw * 2 - 0.6, 0.08, 0.08);
    /* Dado either side of the crest plate, ribs, kick, handrail. */
    for (const s of [-1, 1]) {
      B.box(M.dark, cx + s * 1.9, 0.62, f + 0.02, 1.9, 0.6, 0.04);
      for (let i = 0; i < 2; i++) B.box(M.hull, cx + s * (1.3 + i * 0.8), 0.62, f + 0.045, 0.08, 0.56, 0.05);
    }
    B.box(M.dark, cx, 0.62, f + 0.03, 1.4, 0.7, 0.06);
    insigniaPanel(B, cx, 0.62, f + 0.075, 0.56, { faction: M.faction, thickness: 0.03 });
    B.box(M.dark, cx, 0.07, f + 0.015, hw * 2, 0.14, 0.03);
    B.box(M.hull, cx, 0.98, f + 0.09, hw * 2 - 0.5, 0.06, 0.06);
    for (const dx of [-2.0, 0, 2.0]) B.box(M.dark, cx + dx, 0.98, f + 0.045, 0.06, 0.04, 0.09);
    B.box(M.deep, cx, 3.78, f + 0.025, hw * 2 - 0.5, 0.03, 0.05);
    B.box(M.deep, cx, 3.56, f + 0.025, hw * 2 - 0.5, 0.03, 0.05);
    B.box(lightMat, cx, 3.67, f + 0.01, hw * 2 - 0.6, 0.16, 0.02);
  }

  /* ── THE FRONT: reveal, lintel, and the glow along the frame's edge. */
  const DW = DOOR.halfW, DH = DOOR.height;
  B.box(M.hull, cx, (H + DH) / 2, zF - 0.5, hw * 2, H - DH, 1.0);
  B.box(lightMat, cx, DH + 0.02, zF - 0.85, DW * 2 - 0.2, 0.04, 0.12);
  for (const s of [-1, 1]) {
    B.box(M.hull, cx + s * (DW + 0.3), DH / 2, zF - 0.85, 0.6, DH, 0.3);
    B.box(M.glowDim, cx + s * (DW + 0.02), DH / 2 - 0.1, zF - 0.85, 0.04, DH - 0.2, 0.12);
    B.box(M.dark, cx + s * (DW + 0.3), 0.07, zF - 0.85, 0.6, 0.14, 0.32);
  }
  /* The threshold plate. */
  B.box(M.hull, cx, 0.03, zF - 0.72, DW * 2, 0.06, 0.24);

  /* ── THE CEILING: the slab, coffer beams, six lit panels, a hatch. */
  const ceilD = hd * 2 - 0.24;
  const czC = cz - 0.12;
  B.box(M.hull, cx, H + 0.12, czC, hw * 2 + 0.48, 0.24, ceilD + 0.48);
  for (const dx of [-1.05, 1.05]) B.box(M.dark, cx + dx, H - 0.06, czC, 0.16, 0.12, ceilD);
  for (const dz of [-1.7, 0, 1.7]) B.box(M.dark, cx, H - 0.06, czC + dz, hw * 2, 0.12, 0.16);
  for (const dx of [-2.0, 0, 2.0]) for (const dz of [-0.85, 0.85]) {
    if (dx === 0 && dz === -0.85) continue; /* the hatch's bay */
    B.box(lightMat, cx + dx, H - 0.015, czC + dz, 1.5, 0.03, 1.3);
  }
  B.box(M.deep, cx, H - 0.02, czC - 0.85, 1.1, 0.04, 0.95);
  for (const s of [-1, 1]) {
    B.box(M.hull, cx + s * 0.6, H - 0.04, czC - 0.85, 0.08, 0.08, 1.1);
    B.box(M.hull, cx, H - 0.04, czC - 0.85 + s * 0.52, 1.28, 0.08, 0.08);
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
  B.box(M.dark, cx, 0.012, cz - 0.1, hw * 2 - 0.2, 0.024, hd * 2 - 0.4);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 8; j++) {
    const x = cx - 2.4 + i * 0.8 + (j % 2) * 0.4, z = zA + 0.55 + j * 0.66;
    B.box(M.hull, x, 0.03, z, 0.34, 0.012, 0.06);
    B.box(M.hull, x, 0.03, z + 0.14, 0.06, 0.012, 0.22);
  }
  B.box(M.glowDim, cx, 0.02, zF - 0.30, DW * 2, 0.02, 0.10);
  B.box(M.glowDim, cx, 0.02, zA + 0.30, hw * 2 - 0.5, 0.02, 0.08);
  for (const s of [-1, 1]) B.box(M.glowDim, cx + s * (inner - 0.16), 0.02, cz, 0.08, 0.02, hd * 2 - 0.6);

  /* ── THE CONTROL PANEL, by the doors on the right. */
  const px = cx + inner - 0.05, pz = zF - 1.35;
  B.box(M.dark, px, 1.75, pz, 0.08, 1.5, 0.5);
  B.box(M.hull, px - 0.03, 1.75, pz, 0.04, 1.56, 0.56);
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
  paneGeos.push(new THREE.PlaneGeometry(hw * 2 - 0.8, paneY1 - paneY0).translate(cx, (paneY0 + paneY1) / 2, zA + 0.02));
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
    B.box(M.hull, 0, DH / 2, 0, W, DH, T);
    B.box(M.dark, -s * 0.15, DH / 2 + 0.25, 0, W - 0.7, DH - 1.3, T + 0.02);
    B.box(M.dark, 0, 0.13, 0, W, 0.26, T + 0.02);
    B.box(M.glowDim, -s * (W / 2 - 0.03), DH / 2, 0, 0.05, DH - 0.2, T + 0.02);
    B.box(M.dark, -s * 0.45, 2.15, 0, 0.36, 1.3, T + 0.03);
    B.box(slitMat, -s * 0.45, 2.15, 0, 0.24, 1.14, T + 0.04);
    B.box(M.hull, s * 0.5, 1.1, 0, 0.06, 0.4, T + 0.04);
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
   * scroll onto it (see STATE.RIDE). Which level then sits in each window at
   * the stop is fixed by that length, so the scene's phases are chosen from
   * it: a lit corridor on the left (`LEVELS[0]`), another on the right
   * (`LEVELS[3]`), a hangar mouth through the back (`LEVELS[5]`). */
  let dist = 0, tail = 0;
  for (let t = 0; t < RIDE.ride; t += 1 / 60) {
    const k = smoothstep(0, 0.9, t) * (1 - smoothstep(RIDE.ride - RIDE.brake, RIDE.ride, t));
    dist += RIDE.speed * k / 60;
    if (t >= RIDE.ride - RIDE.brake) tail += RIDE.speed * k / 60;
  }
  const rideLen = Math.round(dist / LEVEL) * LEVEL;
  const nLev = SPAN / LEVEL;
  /* The wrap puts the window at residue SPAN/2, not 0 — see `layScene` —
   * so the level in the window at the stop is the ride's level count plus
   * half a wrap. */
  const landing = (Math.round(rideLen / LEVEL) + nLev / 2) % nLev;
  const phases = [0, 3, 5].map((w) => ((w - landing) % nLev + nLev) % nLev);

  /* ── THE SHAFT SCENE the panes look into. */
  const scene = buildShaft(world, M, lightMat, phases);
  world.scene.add(car, outer, scene.group);
  world.statics.push(car, outer, scene.group);

  /* ── THE COLLIDERS. The car's walls, roof and the jambs either side of the
   * doorway are permanent; the door pair is one box that exists only while
   * the leaves are shut. */
  const P = world.physics;
  const q = new THREE.Quaternion();
  const solids = [];
  if (P?.addStaticBox) {
    const box = (x, y, z, hx, hy, hz) => P.addStaticBox(new THREE.Vector3(x, y, z),
      new THREE.Vector3(hx, hy, hz), q, { friction: 0.7 });
    for (const s of [-1, 1]) solids.push(box(cx + s * (hw + 0.12), H / 2, cz, 0.16, H / 2 + 0.2, hd + 0.3));
    solids.push(box(cx, H / 2, zA - 0.12, hw + 0.4, H / 2 + 0.2, 0.16));
    solids.push(box(cx, H + 0.14, cz, hw + 0.4, 0.16, hd + 0.3));
    for (const s of [-1, 1]) solids.push(box(cx + s * (DW + 0.4), H / 2, zF - 0.2, 0.4, H / 2, 0.8));
  }

  const st = {
    car, outer, shaft: scene.group, scene, bars: scene.bars, doors, outerDoors, panes,
    lamp: carMeshes.find((m) => m.material === lightMat) || null,
    lightMat, lightBase: M.glow.color, glow, lampMat, call, readout, buttons, status, solids,
    N: scene.barsPerFace, SPAN, rideLen, tail,
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
  layScene(st, st.scroll);
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
      ctx.font = 'bold 24px "Courier New", monospace';
      ctx.fillText(caption, 128, 106);
      if (tex) tex.needsUpdate = true;
    },
  };
  return r;
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
    n = FLIGHT_DECK + Math.round(Math.abs(st.scroll - st.stopScroll) / LEVEL);
    cap = 'DECK  ▲';
  }
  st.readout.draw(n, cap);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SHAFT — three faces, three depths, one instanced mesh per kind         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every element lives in a FACE's local frame: `d` outward from the pane,
 * `a` along it, `w` up, where `w` is the wrap coordinate (world y less half
 * the car's height). A face is a quaternion that takes local +x to outward
 * and local +z to along, so one canonical geometry serves all three.
 *
 * Each kind is `{ mesh, slots }`: slots are laid out at build (nothing after)
 * and `layScene` writes one matrix per slot per frame.
 */
function buildShaft(world, M, lightMat, phases) {
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
    { q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), o: new THREE.Vector3(cx - hw, H / 2, cz - 0.2), half: 2.4, far: FAR, phase: phases[0] },
    { q: new THREE.Quaternion(), o: new THREE.Vector3(cx + hw, H / 2, cz - 0.2), half: 2.4, far: FAR, phase: phases[1] },
    { q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), o: new THREE.Vector3(cx, H / 2, cz - hd), half: 3.0, far: 1.0, phase: phases[2] },
  ];
  for (const f of faces) {
    f.out = new THREE.Vector3(1, 0, 0).applyQuaternion(f.q);
    f.along = new THREE.Vector3(0, 0, 1).applyQuaternion(f.q);
    f.k = f.far / FAR;
  }
  /** A depth on a face: the side faces' figure scaled to this face, never
   * nearer the pane than `lo` nor inside the far wall. */
  const dep = (f, d, lo = 0.2, margin = 0.06) => Math.max(lo, Math.min(d * f.k, f.far - margin));

  /* ── THE BOX, static: far walls, guide rails, ladder rails, cable trays,
   * vertical pipe runs. Merged per material. */
  const B = new Bins(M.faction);
  const tall = SPAN + 12;
  const at = (f, d, a, y) => _v.copy(f.o).addScaledVector(f.out, d).addScaledVector(f.along, a).setY(y);
  const stat = (mat, f, d, a, y, wd, h, wa) => {
    const g = new THREE.BoxGeometry(wd, h, wa);
    g.applyQuaternion(f.q);
    at(f, d, a, y);
    B.geoAt(mat, g, _v.x, _v.y, _v.z);
  };
  for (const f of faces) {
    for (const a of [-2.2, 2.2]) stat(M.hull, f, dep(f, 0.55), a, 0, 0.16, tall, 0.16);
    for (const a of [-0.3, 0.3]) stat(M.dark, f, dep(f, 1.5, 0.3), a, 0, 0.06, tall, 0.06);
    stat(M.dark, f, dep(f, 2.9, 0.4), -2.2, 0, 0.12, tall, 0.5);
    for (const a of [2.35, 2.65]) stat(M.hull, f, dep(f, 2.9, 0.4), a, 0, 0.18, tall, 0.18);
  }
  /* The box: its walls are the far walls of all three faces, their inner
   * faces exactly `FAR` out from the panes so the lit plates sit on them.
   * The side walls run aft past the back face to close the corners, and
   * stop short of the lobby face at the front — nothing in the box reaches
   * z = LIFT.door, where the deck could see it. */
  const backFar = faces[2].far;
  const zBack = cz - hd - backFar - 0.15;
  const zFront = L.door - 0.4;
  const zPillar = cz - 0.2 - faces[0].half; /* the side scenes' aft end */
  for (const s of [-1, 1]) {
    B.box(M.deep, cx + s * (hw + FAR + 0.15), 0, (zBack - 0.15 + zFront) / 2, 0.3, tall, zFront - zBack + 0.15);
    /* The corner pillar: from the side scene's aft end to the back wall,
     * the full width between the car's wall and the far wall. */
    B.box(M.deep, cx + s * (hw + 0.12 + (FAR + 0.03) / 2), 0, (zPillar + zBack - 0.15) / 2, FAR + 0.03, tall, zPillar - zBack + 0.15);
  }
  B.box(M.deep, cx, 0, zBack, hw * 2 + FAR * 2 + 0.6, tall, 0.3);
  /* The back face's plinth: a dark sill housing across the foot of the back
   * shaft, up to 1.45 m, which is the height of the ground wedge at the far
   * wall; the back window looks out over it. */
  B.box(M.deep, cx, (1.45 - 30) / 2, (cz - hd - 0.04 + zBack) / 2, hw * 2 + 0.3, 31.45, (cz - hd - 0.04) - zBack + 0.15);
  B.box(M.hull, cx, 1.47, (cz - hd - 0.04 + zBack) / 2, hw * 2 + 0.3, 0.06, (cz - hd - 0.04) - zBack + 0.15);
  const key = (mat) => (mat.name || '').replace(/^deck-\w+-/, '') || 'mat';
  B.build(group, 'shaft', key);

  /* ── THE KINDS. */
  const figMat = new THREE.MeshBasicMaterial({ color: 0x05070b, side: THREE.DoubleSide, name: 'shaft-figure' });
  figMat.userData.saberNoInk = true;
  const barMat = new THREE.MeshBasicMaterial({ color: 0xbfd4ee, toneMapped: false, name: 'shaft-bar' });
  barMat.userData.saberNoInk = true;
  const plateMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, name: 'shaft-plate' });
  plateMat.userData.saberNoInk = true;
  const digitMat = new THREE.MeshBasicMaterial({ color: M.glow.color, toneMapped: false, name: 'shaft-digit' });
  digitMat.userData.saberNoInk = true;

  const kinds = [];
  const kind = (name, geo, mat, slots, opts = {}) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, slots.length));
    mesh.name = `shaft-${name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
    const k = { name, mesh, slots, ...opts };
    kinds.push(k);
    return k;
  };
  /** A slot: face, wrap base, depth, along, scale, and an optional kind of level. */
  const slot = (f, base, d, a, sx = 1, sy = 1, sz = 1, extra = null) => ({ f, base, d, a, sx, sy, sz, ...(extra || {}) });

  const nLevels = SPAN / LEVEL;
  const levelAt = (f, i) => LEVELS[(i + f.phase) % nLevels];
  const slabW = -1.3; /* a level's slab centre, in wrap metres, when scroll is a multiple of LEVEL */

  /* FAR: the ship. */
  const slabs = [], plates = [], figures = [], fighters = [], beams = [], digits = [], lamps = [], pipes = [], girders = [];
  const turbines = [];
  for (const f of faces) {
    for (let i = 0; i < nLevels; i++) {
      const base = i * LEVEL + slabW;
      const t = levelAt(f, i);
      const seed = faces.indexOf(f) * 16 + i;
      slabs.push(slot(f, base, dep(f, FAR - 0.7, 0.5, 0.1), 0, f.k, 1, f.half / 2.9));
      if (t === ROOM || t === HANGAR || t === MACH) {
        /* The lit opening. Rooms are bright and warm-white; a hangar mouth
         * is dimmer and bluer, a machinery bay dimmer still. */
        const lit = t === ROOM ? 1.0 : t === HANGAR ? 0.55 : 0.35;
        plates.push(slot(f, base + 1.75, f.far - 0.05, 0, 1, t === HANGAR ? 1.1 : 1, f.half / 2.9, { lit }));
      }
      if (t === ROOM) {
        const n = 2 + (hash(seed, 1) > 0.45 ? 1 : 0);
        for (let j = 0; j < n; j++) {
          const a = -1.4 + j * 1.15 + (hash(seed, 2 + j) - 0.5) * 0.5;
          const h = 0.92 + hash(seed, 7 + j) * 0.14;
          figures.push(slot(f, base + 0.25 + 0.875 * h, dep(f, FAR - 0.35 - hash(seed, 12 + j) * 0.3, 0.5, 0.16), a, 1, h, 1));
        }
      }
      if (t === HANGAR) {
        fighters.push(slot(f, base + 1.55, dep(f, FAR - 0.4, 0.5, 0.12), 0.2, 1, 1, f.half / 2.9));
        figures.push(slot(f, base + 0.25 + 0.85, dep(f, FAR - 0.3, 0.5, 0.16), -2.1 + hash(seed, 3) * 0.4, 1, 0.97, 1));
      }
      if (t === BULK) {
        /* The bulkhead crossing: a huge dark beam close in, with its deck
         * number lit on the face nearest the window. Two digits of seven
         * segments each; which are lit is decided per frame. */
        beams.push(slot(f, base + 1.6, dep(f, 2.8, 0.4), 0, f.k, 1, f.half / 2.9));
        for (let dgt = 0; dgt < 2; dgt++) {
          for (let sgm = 0; sgm < 7; sgm++) {
            const [u, v, horiz] = SEG_AT(0.6, 1.1)[sgm];
            digits.push(slot(f, base + 1.6 + v, dep(f, 1.45, 0.4) - 1.35 * f.k - 0.05, (dgt === 0 ? -0.45 : 0.45) + u,
              1, horiz ? 1 : 5.5, horiz ? 5.5 : 1, { digit: dgt, seg: sgm }));
          }
        }
        lamps.push(slot(f, base + 2.6, dep(f, 1.45, 0.4) - 1.35 * f.k - 0.08, -1.6));
        lamps.push(slot(f, base + 2.6, dep(f, 1.45, 0.4) - 1.35 * f.k - 0.08, 1.6));
      }
      if (t === MACH) {
        /* The machinery bay: a turbine spinning in the opening. Its slot
         * carries a spin the frame advances; `layScene` composes it. */
        turbines.push(slot(f, base + 2.2, dep(f, FAR - 0.9, 0.5, 0.25), 0, 1, 1, 1, { spin: hash(seed, 5) * 6 }));
        lamps.push(slot(f, base + 0.6, dep(f, FAR - 0.5, 0.4, 0.15), -2.2));
        lamps.push(slot(f, base + 0.6, dep(f, FAR - 0.5, 0.4, 0.15), 2.2));
      }
      if (t === FUEL) {
        pipes.push(slot(f, base + 2.0, dep(f, 3.0, 0.6), 0, 3.6 * f.k, 3.6, f.half / 2.9 + 0.1));
        pipes.push(slot(f, base + 3.4, dep(f, 3.4, 0.7), 0, 1.6 * f.k, 1.6, f.half / 2.9 + 0.1));
        lamps.push(slot(f, base + 2.75, dep(f, 2.45, 0.5), -1.2));
      }
      /* Conduit junction lamps, one a level, on the mid layer's tray. */
      lamps.push(slot(f, base + 4.6, dep(f, 2.5, 0.5), -1.9));
    }
    /* MID: girders every three metres, pipe crossings every four. */
    for (let j = 0; j < SPAN / 3; j++) girders.push(slot(f, j * 3 + 0.5, dep(f, 2.0, 0.45), 0, 1, 1, f.half / 2.9));
    for (let j = 0; j < SPAN / 4; j++) pipes.push(slot(f, j * 4 + 2.3, dep(f, 2.6, 0.6), 0, 1, 1, f.half / 2.9 + 0.1));
  }
  /* NEAR: the ladder's rungs, the rails' ties, and the light bars. */
  const rungs = [], ties = [], bars = [];
  const barsPerFace = 30;
  for (const f of faces) {
    for (let j = 0; j < SPAN / 0.4; j++) rungs.push(slot(f, j * 0.4, dep(f, 1.5, 0.3), 0));
    for (let j = 0; j < SPAN / 2; j++) ties.push(slot(f, j * 2 + 1, dep(f, 0.55), 0, 1, 1, 1));
    for (let j = 0; j < barsPerFace; j++) bars.push(slot(f, j * (SPAN / barsPerFace), dep(f, 0.85, 0.3), 0, 1, 1, f.half / 2.9));
  }

  /* Geometries, canonical: x out, z along, sized for a 2.9 half face; a slot's
   * `sz` stretches them to the back face. */
  const fightG = fighterGeometry(M.faction);
  kind('slab', new THREE.BoxGeometry(1.4, 0.5, 5.8), M.hull, slabs);
  const plateK = kind('plate', new THREE.BoxGeometry(0.1, 3.0, 4.6), plateMat, plates);
  kind('figure', new THREE.BoxGeometry(0.3, 1.75, 0.46), figMat, figures);
  kind('fighter', fightG, figMat, fighters);
  kind('beam', new THREE.BoxGeometry(2.6, 1.6, 6.2), M.deep, beams);
  kind('digit', new THREE.BoxGeometry(0.06, 0.1, 0.1), digitMat, digits, { digits: true });
  kind('lamp', new THREE.BoxGeometry(0.14, 0.14, 0.14), M.status, lamps);
  kind('girder', new THREE.BoxGeometry(0.36, 0.5, 5.8), M.dark, girders);
  kind('pipe', new THREE.BoxGeometry(0.26, 0.26, 5.8), M.hull, pipes);
  kind('rung', new THREE.BoxGeometry(0.05, 0.05, 0.62), M.hull, rungs);
  kind('tie', new THREE.BoxGeometry(0.14, 0.14, 4.7), M.hull, ties);
  const barsK = kind('bar', new THREE.BoxGeometry(0.34, 0.16, 5.6), barMat, bars, { sweep: true });
  const turbK = kind('turbine', turbineGeometry(), M.dark, turbines, { spins: true });
  /* Plate brightness is fixed per slot; bars are recoloured per frame. */
  plates.forEach((p, i) => plateK.mesh.setColorAt(i, _c.set(lightMat.color).multiplyScalar(p.lit)));
  bars.forEach((_, i) => barsK.mesh.setColorAt(i, _c.setScalar(1)));

  return { group, faces, kinds, turbines: turbK, bars: barsK.mesh, barsPerFace, slabW };
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

/** A turbine: a ring, a hub, six blades; normal along local x so it faces the pane. */
function turbineGeometry() {
  const parts = [];
  const ring = new THREE.TorusGeometry(1.25, 0.1, 5, 28);
  parts.push(ring);
  const hub = new THREE.CylinderGeometry(0.28, 0.28, 0.3, 12); hub.rotateX(Math.PI / 2);
  parts.push(hub);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.BoxGeometry(0.34, 1.05, 0.08);
    b.translate(0, 0.72, 0);
    b.rotateZ((i / 6) * Math.PI * 2);
    parts.push(b);
  }
  const g = mergeBoxes(parts);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Lay every kind at scroll `s`, wrapped over SPAN. Allocates nothing. */
function layScene(st, s) {
  const sc = st.scene;
  const H2 = LIFT.height / 2;
  const nAt = st.readout.number;
  const wrap = (base) => ((base + s) % SPAN + SPAN) % SPAN - SPAN / 2;
  for (const k of sc.kinds) {
    const mesh = k.mesh, slots = k.slots;
    for (let i = 0; i < slots.length; i++) {
      const o = slots[i], f = o.f;
      const w = wrap(o.base);
      _v.copy(f.o).addScaledVector(f.out, o.d).addScaledVector(f.along, o.a);
      _v.y = H2 + w;
      let sx = o.sx, sy = o.sy, sz = o.sz;
      if (k.digits) {
        /* The number on this crossing: the readout's, plus the levels above the window. */
        const m = Math.round((w - sc.slabW - 1.6) / LEVEL);
        const num = Math.max(0, nAt + m);
        const d = o.digit === 0 ? Math.floor(num / 10) % 10 : num % 10;
        if (!SEVEN[d][o.seg]) sx = sy = sz = 0;
      }
      _s.set(sx, sy, sz);
      if (k.spins) mesh.setMatrixAt(i, _m.compose(_v, _q.copy(f.q).multiply(_q2.setFromAxisAngle(_X, o.spin)), _s));
      else mesh.setMatrixAt(i, _m.compose(_v, f.q, _s));
      if (k.sweep) {
        /* The lamp's sweep: a bar brightens as it crosses the window and
         * flares at the sill line. */
        const g = Math.exp(-(w * w) / 1.8);
        mesh.setColorAt(i, _c.setScalar(0.45 + 1.4 * g));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (k.sweep && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  _s.set(1, 1, 1);
  st.laid = s;
}

/** Spin the turbines, whatever the car is doing: advance the spins, and
 * when the scene is otherwise still, recompose just their matrices. */
function spinTurbines(st, dt) {
  const k = st.scene.turbines;
  for (const o of k.slots) o.spin += dt * 4.5;
  if (st.scroll === st.laid) {
    const H2 = LIFT.height / 2, s = st.scroll;
    for (let i = 0; i < k.slots.length; i++) {
      const o = k.slots[i], f = o.f;
      const w = ((o.base + s) % SPAN + SPAN) % SPAN - SPAN / 2;
      _v.copy(f.o).addScaledVector(f.out, o.d).addScaledVector(f.along, o.a);
      _v.y = H2 + w;
      k.mesh.setMatrixAt(i, _m.compose(_v, _q.copy(f.q).multiply(_q2.setFromAxisAngle(_X, o.spin)), _s));
    }
    k.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DOORS                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Put the door-pair collider in: one box between the inner and outer leaves. */
function shutDoors(world, st) {
  if (st.doorBox || !world.physics?.addStaticBox) return;
  const L = LIFT;
  st.doorBox = world.physics.addStaticBox(new THREE.Vector3(L.x, L.height / 2, (DOOR.zIn + DOOR.zOut) / 2),
    new THREE.Vector3(DOOR.halfW + 0.1, L.height / 2 + 0.2, 0.45), new THREE.Quaternion(), { friction: 0.6 });
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

/** Is the player standing inside the car, clear of the leaves? */
function inCar(world) {
  const p = world.player?.position;
  if (!p) return false;
  const L = LIFT;
  return Math.abs(p.x - L.x) < L.halfW - 0.1 && p.z > L.z - L.halfD && p.z < DOOR.zIn - 0.45;
}

/** Is the player near enough to the doors, on the deck side, to call the car? */
export function atTheDoors(world) {
  const p = world.player?.position;
  if (!p) return false;
  const L = LIFT;
  return Math.abs(p.x - L.x) < L.halfW + 2.5 && p.z > L.door - 0.2 && p.z < L.door + RIDE.reach;
}

/**
 * The deck's interact key, at the doors. Returns true when it was spent here,
 * so the caller (DeckEdit.focusKey) does not also try to pick a man.
 */
export function liftKey(world) {
  const st = world?._deckLift;
  if (!st || !atTheDoors(world)) return false;
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
      const clear = p && (p.z > L.door + 1.2 || Math.abs(p.x - L.x) > L.halfW + 1.0);
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
      st.v = -st.dir * RIDE.speed * k;
      st.scroll -= st.v * dt;
      if (t >= T && !st.left) {
        st.left = true;
        st.state = STATE.GONE;
        world.onDeckLeave?.();
      }
      break;
    }
    default: break;
  }

  /* ── WHAT EVERY STATE SHARES: the scene is relaid when it has moved, the
   * turbines turn, the car sways with its speed, the light dips and
   * recovers, and the readout counts. */
  setReadout(st);
  spinTurbines(st, dt);
  if (st.scroll !== st.laid) layScene(st, st.scroll);
  const k = Math.min(1, Math.abs(st.v) / RIDE.speed);
  const tt = st.t;
  st.car.position.set(
    k * (0.022 * Math.sin(tt * 2.3) + 0.008 * Math.sin(tt * 9.1)),
    k * (0.010 * Math.sin(tt * 5.7) + 0.004 * Math.sin(tt * 13.3)),
    k * 0.006 * Math.sin(tt * 3.1));
  st.dip *= Math.exp(-dt * 5.5);
  if (st.dip < 1e-3) st.dip = 0;
  const lit = 1 - 0.55 * st.dip;
  st.glow.intensity = 90 * lit;
  st.lightMat.color.copy(st.lightBase).multiplyScalar(lit);
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
