/**
 * ══════════════════════════════════════════════════════════════════════════
 *  VERBS — TEN THINGS TO DO WITH YOUR HANDS (V20 lane 6)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's complaint, in his own words: *"the verbs are still mostly
 * 'read a panel' or 'watch a thing'. Only a handful put your hands on
 * something."*
 *
 * He is right, and the count is the argument. `Station.stationKey` has
 * nineteen branches and seventeen of them raise a PAGE — a kiosk, a ward, a
 * card, a slate, a tote, a casino room. Two do something to the world: the
 * seat (`StationSit`) and the Forge's remote (`RemoteTest`). Everything else
 * in fifty-five rooms answers a press with words.
 *
 * So: ten verbs, one file, and every one of them has the same five parts,
 * because that is what makes a verb a verb rather than a sentence —
 *
 *   A THING THAT IS REALLY THERE   a crate, a lever, a cup, two dice, a bell,
 *       a fan, a washer, a bowl, a table, a remote. Bodies where a body is
 *       right (`Props.Prop`, thrown and cut like any other), meshes where a
 *       hinge is right.
 *   A PROMPT WHEN YOU ARE AT IT    one `notify` on the frame you come into
 *       reach and are looking at it, and not again until you leave — the
 *       `promptOnArrival` rule one scale down.
 *   FEEDBACK YOU CAN SEE OR HEAR   a moving part, a puff, a synthesised
 *       sound, a body that reacts.
 *   A PAY OR A RECORD              `Credits.pay`, or a counter in the
 *       `verbs` fold — see `StationSave.verbsState`.
 *   A LINE IN THE JOURNAL          `Journal.note`, so tomorrow you can read
 *       back what you did with your day.
 *
 * ── ONE HOOK LINE, AND WHERE IT SITS ──────────────────────────────────────
 *
 * `Station.stationKey` gains `if (verbKey(world)) return true;` immediately
 * after the seat branch. That position is the whole of the ordering argument:
 *
 *   BELOW the talk and the seat, because a person in front of you is more
 *     specific than a fixture beside you, and so is a chair.
 *   ABOVE every panel branch, because a fixture you are standing at and
 *     looking at is more specific than the ROOM — the same sentence
 *     `counterHere` makes about a desk. The cantina's bar panel still opens
 *     everywhere in #14 except with your hands on the back-bar column.
 *
 * And it claims a press ONLY when a spot is in reach, at your height and
 * inside the cone. Step back and every room answers exactly as it did:
 * `station.mjs`'s "no place answers the interact key by printing its own
 * verb" drives all sixty-two places at their centres and is unmoved.
 *
 * ── THE HEIGHT GATE IS NOT DECORATION ─────────────────────────────────────
 *
 * `#14`'s back-bar column stands at the bottom of a 2.2 m well one metre
 * from the room's own centre, so a reach test in XZ alone would have claimed
 * the press of anybody standing on the apron above it. Every spot therefore
 * asks `|player.y − spot.y| < 1.6`, which is "on the same floor as the
 * thing" and costs one subtraction.
 *
 * ── NOTHING HERE ROLLS ────────────────────────────────────────────────────
 *
 * No `Math.random`, no clock. The dice throw, the opponent's dice, the
 * arm-wrestler's strength and the fan's fault are all `hash2` off the station
 * day and the thing's own index — the same discipline `StationLife`'s slot
 * seeds keep, so two machines in a co-op session see one game.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { audio } from '../engine/Audio.js';
import { clamp } from '../engine/MathUtil.js';
import { Prop, makeCrate, makeBarrel, slabGeo, cylGeo } from '../world/Props.js';
import { floorOf } from './StationPlan.js';
import { sitKey } from './StationSit.js';
import { makeCup, cupInHand, seatTop } from './Bars.js';
import { buildRemote } from './Dojo.js';
import { pay, spend } from './Credits.js';
import { note } from './Journal.js';
import { verbsState, setVerbsState, stationDay } from './StationSave.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE TEN, AS DATA                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Which room each verb lives in. One table, so a reader can see the spread. */
export const VERB_PLACE = Object.freeze({
  carry: 52, lever: 53, pour: 14, dice: 35, bell: 22,
  fan: 39, wash: 39, feed: 28, arm: 18, spar: 21,
});

/** What each one pays. Small, because a station is not a payday. */
export const VERB_PAY = Object.freeze({ carry: 15, lever: 10, pour: 2, fan: 8, feed: 5 });

/** The two stakes. Doubled on a win, gone on a loss. */
export const STAKE = Object.freeze({ dice: 5, arm: 10 });

/** How long each of the timed ones takes. */
export const SECS = Object.freeze({ fan: 3, wash: 2, feedHead: 4, arm: 6, spar: 30, lever: 0.5 });

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SEEDS, FRAMES AND SMALL SOUNDS                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

/** A stable 0..1 out of two integers. No clock, no `Math.random`. */
export function hash2(a, b) {
  let h = ((a | 0) * 374761393 + (b | 0) * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A point in a place's own frame, in world coordinates.
 *
 * `StationKit.buildPlace` emits every room through one `pos + quat` — the
 * place's centre and a Y rotation of `place.yaw` — so this is that transform
 * and not a second opinion about where a room is. It is the inverse of the
 * one `Station.placeUnder` runs to decide which room you are standing in.
 */
export function toWorld(p, lx, lz) {
  const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/** The same transform the other way: a world point in the room's own frame. */
export function toLocal(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

function thump(pos, f = 90, gain = 0.3) {
  audio.tone({ freq: f, freqEnd: f * 0.4, dur: 0.3, gain, type: 'sawtooth', pos });
  audio.noise({ dur: 0.28, gain: gain * 0.6, type: 'lowpass', freq: 520, freqEnd: 120, pos, pink: true });
}
function clack(pos, f = 380, gain = 0.18) {
  audio.tone({ freq: f, freqEnd: f * 0.6, dur: 0.09, gain, type: 'square', pos });
}
function hiss(pos, dur = 0.7, gain = 0.16) {
  audio.noise({ dur, gain, type: 'bandpass', freq: 2600, freqEnd: 900, q: 0.7, pos, pink: false });
}

/** The puff a crushed drum, a steam door or a scoop of feed makes. */
function puff(world, at, power = 1, colour = 0xd8d0c4) {
  world.particles?.sandPuff?.(_v.set(at.x, at.y, at.z), power, at.y, colour);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE FOLD                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Read the whole verb record. Never null — an untouched station is `{}`. */
export function verbsFold() { return verbsState(); }

/** Fold one field, through the one door. Returns the new record. */
function fold(patch) {
  const f = { ...verbsState(), ...patch };
  try { setVerbsState(f); } catch { /* the fold refused; the verb still happened */ }
  return f;
}
function bump(key, by = 1) {
  const f = verbsState();
  return fold({ [key]: ((Number(f[key]) || 0) + by) });
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SPOTS — reach, height and a cone                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Are you at this spot: inside its reach, on its floor, and looking at it.
 *
 * `StationSit.seatAtHand`'s test, generalised — a press on the way past a
 * thing is not a press on the thing, and the 70° cone is what lets two verbs
 * share a room (#39's fan and its washers stand eleven metres apart on
 * opposite hands).
 */
export function atSpot(world, s) {
  const pl = world?.player;
  const p = pl?.position;
  if (!p || !s) return false;
  const dx = s.at.x - p.x, dz = s.at.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > s.reach) return false;
  if (Math.abs(p.y - s.at.y) > 1.6) return false;
  if (d < 0.5) return true;
  const fx = Math.sin(pl.facing || 0), fz = Math.cos(pl.facing || 0);
  return (dx * fx + dz * fz) / d > 0.34;
}

/** The spot the key would answer right now, or null. The HUD could read this. */
export function spotAtHand(world) {
  const V = world?._verbs;
  if (!V) return null;
  const p = world.player?.position;
  if (!p) return null;
  let best = null, bd = Infinity;
  for (const s of V.spots) {
    if (!atSpot(world, s)) continue;
    const d = Math.hypot(s.at.x - p.x, s.at.z - p.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  DRESSING                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

function meshOf(V, group, geo, mat, at, ry = 0, name = 'verb') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(at.x, at.y, at.z);
  m.rotation.y = ry;
  m.name = name;
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  V.geo.push(geo);
  V.meshes.push(m);
  return m;
}

function spot(V, id, place, lx, lz, y, reach, head, prompt) {
  const w = toWorld(place, lx, lz);
  const s = { id, place: place.id, at: new THREE.Vector3(w.x, y, w.z), reach, head, prompt };
  V.spots.push(s);
  V.spot[id] = s;
  return s;
}

/** A prop this file made, so `undressVerbs` can take it away again. */
function own(V, prop) { if (prop) { prop.__verb = true; V.props.push(prop); } return prop; }

/**
 * Everything the ten verbs need, on whichever deck is being built.
 *
 * A no-op for every room that is not on this deck — `st.places` holds only
 * the rooms that were dressed, which is `dressRemoteTest`'s own guard and for
 * the same reason: a station is one deck at a time.
 */
export function dressVerbs(world, st) {
  if (!world?.scene || !st?.places) return null;
  const M = st.mats;
  const V = {
    deck: st.deck, spots: [], spot: {}, meshes: [], geo: [], props: [], pets: [],
    near: null, held: false, holdEdge: false,
    carry: null, lever: null, pour: null, dice: null, bell: null,
    fan: null, wash: null, feed: null, arm: null, spar: null,
    /** What has happened, for the checks and for a HUD that wants to say so. */
    log: [],
  };
  world._verbs = V;
  const rec = (id) => st.places.get(id) || null;
  const floor = (p, lx, lz) => {
    const w = toWorld(p, lx, lz);
    return world.floorAt ? world.floorAt(w.x, w.z) : floorOf(p);
  };

  /* ── 1. #52 CARGO HOLD: a marked crate and a marked shelf ─────────────── */
  let R = rec(52);
  if (R) {
    const p = R.place;
    const cy = floor(p, 3, 6), sy = floor(p, -3, 6);
    const cw = toWorld(p, 3, 6);
    const crate = own(V, makeCrate(world, new THREE.Vector3(cw.x, cy + 0.05, cw.z), 0.6, { exactSize: true }));
    /* THE MARK IS ON THE THING, so "the marked crate" is a sentence a player
     * can act on rather than one only this file can read. */
    meshOf(V, R.group, new THREE.BoxGeometry(0.64, 0.05, 0.64), M.status,
      { x: cw.x, y: cy + 0.60, z: cw.z }, 0, 'verb-crate-mark');
    const shelfW = toWorld(p, -3, 6);
    for (const sx of [-0.7, 0.7]) {
      meshOf(V, R.group, new THREE.BoxGeometry(0.12, 0.9, 0.12), M.dark,
        { x: shelfW.x + sx, y: sy + 0.45, z: shelfW.z }, 0, 'verb-shelf-leg');
    }
    meshOf(V, R.group, new THREE.BoxGeometry(1.9, 0.09, 0.8), M.wing,
      { x: shelfW.x, y: sy + 0.94, z: shelfW.z }, 0, 'verb-shelf');
    /* AND THE BOARD IS SOLID. A shelf you cannot put a crate down on is a
     * picture of a shelf: `roomColliders`' own door, one box. */
    world.physics?.addStaticBox?.(new THREE.Vector3(shelfW.x, sy + 0.94, shelfW.z),
      new THREE.Vector3(0.95, 0.045, 0.4), new THREE.Quaternion(), { friction: 0.9 });
    meshOf(V, R.group, new THREE.BoxGeometry(1.9, 0.04, 0.06), M.status,
      { x: shelfW.x, y: sy + 1.00, z: shelfW.z - 0.37 }, 0, 'verb-shelf-mark');
    V.carry = {
      crate, held: null, done: 0, dirty: false,
      shelf: new THREE.Vector3(shelfW.x, sy + 0.99, shelfW.z),
      home: new THREE.Vector3(cw.x, cy + 0.05, cw.z),
    };
    spot(V, 'carry', p, 3, 6, cy, 1.5, 'CARGO HOLD', 'take the marked crate — the marked shelf is across the aisle');
    spot(V, 'shelf', p, -3, 6, sy, 1.5, 'CARGO HOLD', 'the marked shelf. Set it down here');
  }

  /* ── 2. #53 WASTE & RECYCLING: the lever, the face and the junk ────────── */
  R = rec(53);
  if (R) {
    const p = R.place;
    const ly = floor(p, 0, 6.4);
    const lw = toWorld(p, 0, 6.4);
    meshOf(V, R.group, new THREE.BoxGeometry(0.34, 1.0, 0.34), M.dark,
      { x: lw.x, y: ly + 0.5, z: lw.z }, p.yaw, 'verb-lever-post');
    /* The arm is a GROUP so the throw is a rotation of a hinge and not a
     * position somebody has to keep in step with a mesh. */
    const arm = new THREE.Group();
    arm.name = 'verb-lever';
    arm.position.set(lw.x, ly + 0.95, lw.z);
    arm.rotation.y = p.yaw;
    const shaftGeo = cylGeo(0.045, 0.045, 0.8, 6, 1);
    shaftGeo.translate(0, 0.4, 0);
    const knobGeo = new THREE.SphereGeometry(0.09, 8, 6);
    knobGeo.translate(0, 0.82, 0);
    arm.add(new THREE.Mesh(shaftGeo, M.wing), new THREE.Mesh(knobGeo, M.status));
    R.group.add(arm);
    V.geo.push(shaftGeo, knobGeo); V.meshes.push(arm);
    /* The face: a slab that really travels across the throat. */
    const W = { w: p.w - 6, d: p.d - 6, depth: 3.4 };
    const fy = floor(p, 0, 0);
    const f0 = toWorld(p, W.w / 2 - 0.6, 0);
    const face = meshOf(V, R.group, new THREE.BoxGeometry(0.6, 2.6, W.d - 0.6), M.wing,
      { x: f0.x, y: fy + 1.3, z: f0.z }, p.yaw, 'verb-compactor-face');
    const barrels = [];
    for (let i = 0; i < 4; i++) {
      const bl = toWorld(p, -1.2 + (i % 2) * 1.6, -1.4 + Math.floor(i / 2) * 2.8);
      barrels.push(own(V, makeBarrel(world, new THREE.Vector3(bl.x, fy + 0.06, bl.z))));
    }
    V.lever = {
      arm, face, barrels, well: W, place: p, throwT: -1, slamT: -1, crushed: 0,
      faceHome: face.position.clone(), faceTo: toWorld(p, -W.w / 2 + 1.0, 0), floorY: fy,
    };
    spot(V, 'lever', p, 0, 6.4, ly, 1.5, 'WASTE & RECYCLING', "pull the compactor's lever");
  }

  /* ── 3. #14 THE LONG NIGHT: the back-bar column ───────────────────────── */
  R = rec(14);
  if (R) {
    const p = R.place;
    const y = floor(p, 0, 1);
    const cw = toWorld(p, 0, 1);
    meshOf(V, R.group, new THREE.BoxGeometry(0.5, 0.16, 0.5), M.status,
      { x: cw.x, y: y + 2.72, z: cw.z }, p.yaw, 'verb-bar-tap');
    V.pour = { cup: null, taker: null, t: 0, poured: 0, at: new THREE.Vector3(cw.x, y, cw.z) };
    spot(V, 'pour', p, 0, 1, y, 1.3, 'BEHIND THE BAR', 'pour one');
  }

  /* ── 4. #35 THE DRAZI QUARTER: two dice at the kerb ──────────────────── */
  R = rec(35);
  if (R) {
    const p = R.place;
    const y = floor(p, 0, 8.6);
    const dice = [];
    for (let i = 0; i < 2; i++) {
      const w = toWorld(p, -0.3 + i * 0.6, 8.6);
      const g = slabGeo(0.17, 0.17, 0.17, { bevel: 0.02 });
      g.translate(0, 0.085, 0);
      dice.push(own(V, new Prop(world, {
        mesh: new THREE.Mesh(g, M.mark), position: new THREE.Vector3(w.x, y + 0.02, w.z),
        mass: 0.25, kind: 'die', hp: 20, weather: false,
      })));
    }
    const kw = toWorld(p, 0, 8.6);
    V.dice = { dice, state: 'idle', t: 0, rolls: 0, home: new THREE.Vector3(kw.x, y, kw.z), last: null };
    spot(V, 'dice', p, 0, 8.6, y, 1.6, 'THE DRAZI QUARTER', `throw the bones — ${STAKE.dice} credits the stake`);
  }

  /* ── 5. #22 THE CHAPEL: the bell ─────────────────────────────────────── */
  R = rec(22);
  if (R) {
    const p = R.place;
    const y = floor(p, 0, 6.2);
    const w = toWorld(p, 0, 6.2);
    meshOf(V, R.group, new THREE.BoxGeometry(2.2, 0.14, 0.14), M.dark,
      { x: w.x, y: y + 3.4, z: w.z }, p.yaw, 'verb-bell-beam');
    const bell = new THREE.Group();
    bell.name = 'verb-bell';
    bell.position.set(w.x, y + 3.34, w.z);
    const bg = cylGeo(0.34, 0.16, 0.62, 12, 1);
    bg.translate(0, -0.62, 0);
    const cg = new THREE.SphereGeometry(0.07, 8, 6);
    cg.translate(0, -0.98, 0);
    bell.add(new THREE.Mesh(bg, M.wing), new THREE.Mesh(cg, M.dark));
    R.group.add(bell);
    V.geo.push(bg, cg); V.meshes.push(bell);
    V.bell = { bell, swing: 0, t: 0, rings: 0, turned: 0, at: new THREE.Vector3(w.x, y + 2.6, w.z) };
    spot(V, 'bell', p, 0, 6.2, y, 1.5, 'THE CHAPEL', 'ring the bell');
  }

  /* ── 6 & 7. #39 LAUNDRY: a stopped fan on one hand, a washer on the other ─ */
  R = rec(39);
  if (R) {
    const p = R.place;
    const fy = floor(p, -6, -3.4);
    const fw = toWorld(p, -6, -4.4);
    const ring = meshOf(V, R.group, new THREE.TorusGeometry(0.52, 0.07, 6, 14), M.dark,
      { x: fw.x, y: fy + 2.1, z: fw.z }, p.yaw, 'verb-fan-ring');
    ring.rotation.set(0, p.yaw, 0);
    const blades = new THREE.Group();
    blades.name = 'verb-fan';
    blades.position.set(fw.x, fy + 2.1, fw.z);
    blades.rotation.y = p.yaw;
    for (let i = 0; i < 4; i++) {
      const g = slabGeo(0.86, 0.02, 0.16, { bevel: 0.01 });
      const m = new THREE.Mesh(g, M.wing);
      m.rotation.z = i * Math.PI / 2;
      blades.add(m);
      V.geo.push(g);
    }
    R.group.add(blades);
    V.meshes.push(blades);
    V.fan = { blades, spin: 0, hold: 0, holding: false, angle: 0, at: new THREE.Vector3(fw.x, fy + 2.1, fw.z) };
    spot(V, 'fan', p, -6, -3.4, fy, 1.4, 'LAUNDRY & SHOWERS', 'the extractor is dead. Hold the key on it');

    const wy = floor(p, 5, -3.0);
    const ww = toWorld(p, 5, -4.0);
    meshOf(V, R.group, new THREE.BoxGeometry(1.2, 1.1, 0.9), M.deep,
      { x: ww.x, y: wy + 0.55, z: ww.z }, p.yaw, 'verb-washer');
    const door = meshOf(V, R.group, cylGeo(0.31, 0.31, 0.08, 12, 1), M.glass,
      { x: ww.x, y: wy + 0.66, z: ww.z + 0.48 }, 0, 'verb-washer-door');
    door.rotation.x = Math.PI / 2;
    V.wash = { door, t: -1, washes: 0, at: new THREE.Vector3(ww.x, wy + 0.7, ww.z + 0.5) };
    spot(V, 'wash', p, 5, -3.0, wy, 1.4, 'LAUNDRY & SHOWERS', 'run a cycle — get the deck off you');
  }

  /* ── 8. #28 THE KENNEL HABITAT: a bin, a bowl and two animals ─────────── */
  R = rec(28);
  if (R) {
    const p = R.place;
    const by = floor(p, -8, -6);
    const bw = toWorld(p, -8, -6);
    meshOf(V, R.group, new THREE.BoxGeometry(1.0, 1.2, 0.8), M.deep,
      { x: bw.x, y: by + 0.6, z: bw.z }, p.yaw, 'verb-feedbin');
    meshOf(V, R.group, new THREE.BoxGeometry(0.9, 0.06, 0.7), M.status,
      { x: bw.x, y: by + 1.23, z: bw.z }, p.yaw, 'verb-feedbin-lid');
    const ow = toWorld(p, -4, -6);
    const bowl = meshOf(V, R.group, cylGeo(0.46, 0.36, 0.16, 12, 1), M.wing,
      { x: ow.x, y: by + 0.08, z: ow.z }, 0, 'verb-bowl');
    const fillGeo = cylGeo(0.40, 0.34, 0.10, 12, 1);
    const fill = new THREE.Mesh(fillGeo, M.mark);
    fill.position.set(ow.x, by + 0.13, ow.z);
    fill.visible = false;
    fill.name = 'verb-bowl-feed';
    R.group.add(fill);
    V.geo.push(fillGeo); V.meshes.push(fill);
    V.feed = {
      bowl, fill, t: -1, fed: 0, paid: false, pets: [], eating: 0,
      at: new THREE.Vector3(ow.x, by, ow.z), floorY: by,
      spawnAt: [toWorld(p, 0, -5), toWorld(p, 2, -5)],
    };
    spot(V, 'feed', p, -8, -4.6, by, 1.4, 'THE KENNEL HABITAT', 'scoop a measure into the bowl');
  }

  /* ── 9. #18 THE PIT: a table, two stools, and somebody's elbow ────────── */
  R = rec(18);
  if (R) {
    const p = R.place;
    const y = floor(p, -6.5, -5.0);
    const tw = toWorld(p, -6.5, -5.0);
    const tg = slabGeo(1.0, 0.78, 0.9, { bevel: 0.02 });
    tg.translate(0, 0.39, 0);
    const table = own(V, new Prop(world, {
      mesh: new THREE.Mesh(tg, M.deep), position: new THREE.Vector3(tw.x, y, tw.z),
      mass: 60, kind: 'table', hp: 40, weather: false,
    }));
    const stools = [];
    for (const dz of [-1.0, 1.0]) {
      const sw = toWorld(p, -6.5, -5.0 + dz);
      const sg = slabGeo(0.4, 0.62, 0.4, { bevel: 0.02 });
      sg.translate(0, 0.31, 0);
      stools.push(own(V, new Prop(world, {
        mesh: new THREE.Mesh(sg, M.dark), position: new THREE.Vector3(sw.x, y, sw.z),
        mass: 6, kind: 'stool', hp: 24, weather: false,
      })));
    }
    V.arm = {
      table, theirs: stools[0], mine: stools[1], bout: null, won: 0, lost: 0,
      at: new THREE.Vector3(tw.x, y, tw.z),
      /* WHERE THE TWO STOOLS BELONG. They are real bodies in a room full of
       * people who sit on things and throw things, so a bout puts them back
       * on their feet where they started before it seats anybody. */
      home: stools.map((q) => q.body.position.clone()),
    };
    spot(V, 'arm', p, -4.6, -5.0, y, 1.3, 'THE PIT', `put your elbow down — ${STAKE.arm} credits`);
  }

  /* ── 10. #21 THE GYM: a remote on a rack ─────────────────────────────── */
  R = rec(21);
  if (R) {
    const p = R.place;
    const y = floor(p, -8, -4.0);
    const w = toWorld(p, -8, -4.0);
    meshOf(V, R.group, new THREE.BoxGeometry(0.9, 1.0, 0.5), M.dark,
      { x: w.x, y: y + 0.5, z: w.z }, p.yaw, 'verb-remote-rack');
    meshOf(V, R.group, new THREE.SphereGeometry(0.16, 10, 8), M.strip,
      { x: w.x, y: y + 1.16, z: w.z }, 0, 'verb-remote-rest');
    V.spar = { round: null, at: new THREE.Vector3(w.x, y + 1.16, w.z), rounds: 0, last: null };
    spot(V, 'spar', p, -8, -4.0, y, 1.4, 'THE GYM', `take a round with the remote — ${SECS.spar} seconds`);
  }

  return V;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE KEY                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * `Station.stationKey`'s one line, after the seat branch.
 *
 * True only when the press was SPENT on a verb. Everything else — no spot in
 * reach, the wrong floor, looking the other way — hands the press straight
 * back, which is the rule the pit branch states at length eighty lines below
 * the hook: a branch that claims a press it did not use is the defect.
 */
export function verbKey(world) {
  const V = world?._verbs;
  if (!V || world.player?.alive === false) return false;
  /* A round already running answers first, wherever you have walked to: the
   * remote is in the air and the press is what stops it. */
  if (V.spar?.round) { endSpar(world, V, 'stopped'); return true; }
  const s = spotAtHand(world);
  if (!s) return false;
  switch (s.id) {
    case 'carry': return takeCrate(world, V);
    case 'shelf': return dropCrate(world, V, true);
    case 'lever': return pullLever(world, V);
    case 'pour': return pourOne(world, V);
    case 'dice': return throwDice(world, V);
    case 'bell': return ringBell(world, V);
    case 'fan': return startFan(world, V);
    case 'wash': return startWash(world, V);
    case 'feed': return scoopFeed(world, V);
    case 'arm': return startBout(world, V);
    case 'spar': return startSpar(world, V);
    default: return false;
  }
}

/* ── 1. THE CRATE ──────────────────────────────────────────────────────── */

/** True while the player has this crate, by either hand — ours or the Force. */
function carrying(world, V) {
  const C = V.carry;
  if (!C || C.crate?.dead) return false;
  if (C.held) return true;
  return world.player?.gripBody === C.crate.body;
}

function takeCrate(world, V) {
  const C = V.carry;
  if (!C || C.crate.dead) return false;
  if (carrying(world, V)) return dropCrate(world, V, false);
  C.held = C.crate;
  C.crate.body.gravityScale = 0;
  C.crate.body.wake?.();
  world.notify?.('CARGO HOLD', 'you have it. The marked shelf is across the aisle');
  return true;
}

function dropCrate(world, V, atShelf) {
  const C = V.carry;
  if (!C || !carrying(world, V)) return false;
  const b = C.crate.body;
  if (C.held) { C.held = null; b.gravityScale = 1; }
  if (world.player?.gripBody === b) world.player.releaseGrip?.();
  b.wake?.();
  if (atShelf) landCrate(world, V);
  else world.notify?.('CARGO HOLD', 'you set it down');
  return true;
}

/**
 * OVER THE BOARD: within 0.6 m of the mark in PLAN and roughly at its height.
 *
 * In plan and not as a sphere, because a crate held at the height of the
 * hands is 0.6 m above a shelf you are standing right in front of, and a
 * sphere test would have refused the delivery for being carried properly.
 */
function overShelf(C) {
  const b = C.crate.body;
  const dxz = Math.hypot(b.position.x - C.shelf.x, b.position.z - C.shelf.z);
  const dy = b.position.y - C.shelf.y;
  return dxz < 0.6 && dy > -0.5 && dy < 0.8;
}

/** The delivery: over the shelf, and it pays every trip. */
function landCrate(world, V) {
  const C = V.carry;
  const b = C.crate.body;
  if (!overShelf(C)) {
    world.notify?.('CARGO HOLD', 'not on the shelf. It goes on the marked one');
    return;
  }
  /* Put down square on the board: `Prop`'s body is CENTRED, and `C.shelf` is
   * the board's top, so the half-height comes off the crate's own bounds. */
  const bb = C.crate.mesh.geometry?.boundingBox;
  const half = bb ? bb.max.y : 0.27;
  b.setTransform?.(_v.set(C.shelf.x, C.shelf.y + half + 0.01, C.shelf.z), null);
  b.velocity.set(0, 0, 0); b.angularVelocity?.set?.(0, 0, 0);
  C.crate.mesh.position.copy(b.position);
  C.done++;
  const paid = pay(VERB_PAY.carry, 'a crate on the shelf at the cargo hold');
  bump('crates');
  thump(b.position, 70, 0.26);
  puff(world, b.position, 0.7);
  note('job', `stowed the marked crate at the cargo hold — ${paid} credits`, world);
  world.notify?.('THE FOREMAN', `that is where it goes. ${paid} credits`);
  V.log.push({ verb: 'carry', paid });
}

/* ── 2. THE LEVER ──────────────────────────────────────────────────────── */

function pullLever(world, V) {
  const L = V.lever;
  if (!L || L.throwT >= 0) return false;
  L.throwT = 0;
  L.slamT = -1;
  clack(L.arm.position, 220, 0.24);
  world.notify?.('WASTE & RECYCLING', 'the throat closes');
  return true;
}

/* ── 3. THE BAR ────────────────────────────────────────────────────────── */

/** The nearest resident within `r`, who has not just been served. */
function drinkerNear(world, at, r = 3) {
  const life = world?._stationLife;
  if (!life?.live) return null;
  let best = null, bd = r;
  for (const b of life.live.values()) {
    if (!b || b.dead || b.alive === false || !b.position || b.__verbCup) continue;
    const d = Math.hypot(b.position.x - at.x, b.position.z - at.z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function pourOne(world, V) {
  const P = V.pour;
  const pl = world.player;
  if (!P || P.cup) return false;
  const cup = makeCup();
  world.scene.add(cup);
  cupInHand(cup, pl.rig, 'R');
  P.cup = cup; P.t = 0; P.taker = null;
  hiss(P.at, 0.45, 0.12);
  clack(P.at, 700, 0.1);
  world.notify?.('BEHIND THE BAR', 'you pour one. Somebody is always waiting');
  return true;
}

/* ── 4. THE DICE ───────────────────────────────────────────────────────── */

/** Which number is up: the local axis nearest the world's up, off the body. */
export function upFace(die) {
  const AX = [[0, 1, 0, 1], [0, -1, 0, 6], [1, 0, 0, 2], [-1, 0, 0, 5], [0, 0, 1, 3], [0, 0, -1, 4]];
  let best = 1, bd = -2;
  _q.copy(die.body.quaternion);
  for (const [x, y, z, n] of AX) {
    const up = _v2.set(x, y, z).applyQuaternion(_q).y;
    if (up > bd) { bd = up; best = n; }
  }
  return best;
}

function throwDice(world, V) {
  const D = V.dice;
  if (!D || D.state === 'rolling') return false;
  const st = world._station;
  const day = st?.day ?? stationDay();
  const s = spend(STAKE.dice, 'the Drazi bones');
  if (!s.ok) { world.notify?.('THE DRAZI QUARTER', `${s.why} — you are ${s.short} short of the stake`); return true; }
  const pl = world.player;
  const f = pl.facing || 0;
  D.state = 'rolling'; D.t = 0; D.rolls++;
  for (let i = 0; i < 2; i++) {
    const die = D.dice[i];
    if (die.dead) continue;
    const b = die.body;
    const a = hash2(day * 31 + D.rolls, i * 7 + 1);
    const c = hash2(day * 31 + D.rolls, i * 7 + 2);
    const e = hash2(day * 31 + D.rolls, i * 7 + 3);
    b.gravityScale = 1;
    b.setTransform?.(_v.set(pl.position.x + Math.sin(f) * 0.5 + (i - 0.5) * 0.25,
      pl.position.y + 1.2, pl.position.z + Math.cos(f) * 0.5), null);
    b.velocity.set(Math.sin(f) * (2.6 + a * 1.4) + (c - 0.5) * 0.8, 1.8 + c * 0.8,
      Math.cos(f) * (2.6 + a * 1.4) + (e - 0.5) * 0.8);
    b.angularVelocity?.set?.((a - 0.5) * 26, (c - 0.5) * 26, (e - 0.5) * 26);
    b.wake?.();
  }
  clack(D.home, 520, 0.16);
  world.notify?.('THE DRAZI QUARTER', `${STAKE.dice} down. Throw`);
  return true;
}

/* ── 5. THE BELL ───────────────────────────────────────────────────────── */

function ringBell(world, V) {
  const B = V.bell;
  if (!B) return false;
  const st = world._station;
  const day = st?.day ?? stationDay();
  const hour = Math.floor(st?.hour ?? 0);
  const stamp = day * 24 + hour;
  const f = verbsState();
  if (Number(f.bellHour) === stamp) {
    world.notify?.('THE CHAPEL', 'it has been rung this hour. Let it hang');
    return true;
  }
  fold({ bellHour: stamp });
  B.swing = 1; B.t = 0; B.rings++;
  /* A bell is a fundamental and its partials, which is why this is four
   * tones and not one: a single sine is a hum, not a bell. */
  for (const [mul, gain, dur] of [[1, 0.30, 4.2], [2.0, 0.13, 2.6], [2.76, 0.09, 2.0], [5.4, 0.05, 1.2]]) {
    audio.tone({ freq: 116 * mul, dur, gain, type: 'sine', pos: B.at });
  }
  /* Everybody in the room turns to it — `standFace` is `stepStanding`'s own
   * bearing and `standIn` is what stops the next posture roll turning them
   * straight back. */
  let turned = 0;
  const life = world._stationLife;
  for (const b of life?.live?.values?.() || []) {
    if (!b || b.dead || b.stationPlace !== VERB_PLACE.bell || b.wayR) continue;
    b.standFace = Math.atan2(B.at.x - b.position.x, B.at.z - b.position.z);
    b.standIn = Math.max(b.standIn || 0, 4);
    b.attendUntil = (world.time ?? 0) + 4;               // `Gestures.eligible` honours it
    if (b.__gesture?.g) { b.__gesture.g = null; b.__gesture.wait = 4; }
    turned++;
  }
  B.turned = turned;
  note('note', `rang the chapel bell — ${turned} turned to it`, world);
  world.notify?.('THE CHAPEL', turned ? `it carries. ${turned} turn to it` : 'it carries');
  V.log.push({ verb: 'bell', turned });
  return true;
}

/* ── 6. THE FAN ────────────────────────────────────────────────────────── */

/** True when today's extractor is out. Seeded on the day; fixing it is a day. */
export function fanStopped(world) {
  const st = world?._station;
  const day = st?.day ?? stationDay();
  const f = verbsState();
  if (Number(f.fanDay) === day) return false;
  /* Not every day, and which days is the station's own seed. */
  return hash2(day, 39) < 0.82;
}

function startFan(world, V) {
  const F = V.fan;
  if (!F) return false;
  if (!fanStopped(world)) {
    world.notify?.('LAUNDRY & SHOWERS', 'it is turning. Leave it alone');
    return true;
  }
  F.hold = 0;
  F.holding = true;
  world.notify?.('LAUNDRY & SHOWERS', `hold it — ${SECS.fan} seconds on the seized bearing`);
  return true;
}

function fanFixed(world, V) {
  const F = V.fan;
  const st = world._station;
  const day = st?.day ?? stationDay();
  F.holding = false; F.hold = 0; F.spin = 1;
  fold({ fanDay: day });
  bump('fans');
  const paid = pay(VERB_PAY.fan, 'the laundry extractor');
  hiss(F.at, 1.1, 0.14);
  audio.tone({ freq: 60, freqEnd: 190, dur: 1.4, gain: 0.16, type: 'sawtooth', pos: F.at });
  note('job', `freed the laundry's extractor — ${paid} credits`, world);
  world.notify?.('THE LAUNDRY KEEPER', `it has been dead a day. ${paid} credits`);
  V.log.push({ verb: 'fan', paid });
}

/* ── 7. THE WASHER ─────────────────────────────────────────────────────── */

function startWash(world, V) {
  const W = V.wash;
  if (!W || W.t >= 0) return false;
  W.t = 0;
  hiss(W.at, 0.9, 0.18);
  world.notify?.('LAUNDRY & SHOWERS', 'a short cycle');
  return true;
}

/**
 * THE SOOT, AND THE OUTFIT READS IT.
 *
 * There was no such flag in `Player.js` or `Cloth.js` — measured: no `soot`,
 * `grime` or `dirt` on a garment anywhere in `src/`. So this owns one:
 * `player.grubby`, 0..1, which the two dirty verbs raise (a crate on your
 * shoulder, a scoop of feed) and the washer clears.
 *
 * It is applied to the player's own CLONE of each garment material, marked on
 * `userData`, because the wardrobe's materials are shared with anybody else
 * wearing the same cut — dirtying the shared one would put every man on the
 * deck in your overalls.
 */
function applySoot(world) {
  const pl = world?.player;
  const root = pl?.rig?.root;
  if (!root) return 0;
  const g = clamp(Number(pl.grubby) || 0, 0, 1);
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    let m = o.material;
    if (!m.userData?.__verbSoot) {
      if (!m.color) return;
      m = o.material = m.clone();
      m.userData = { ...(m.userData || {}), __verbSoot: true, __verbBase: m.color.clone() };
    }
    const base = m.userData.__verbBase;
    if (!base) return;
    m.color.copy(base).multiplyScalar(1 - 0.55 * g);
    n++;
  });
  return n;
}

/** Dirty the player a little. The two verbs that get on your hands call it. */
export function soil(world, by = 0.34) {
  const pl = world?.player;
  if (!pl) return 0;
  pl.grubby = clamp((Number(pl.grubby) || 0) + by, 0, 1);
  applySoot(world);
  return pl.grubby;
}

function washDone(world, V) {
  const W = V.wash;
  const pl = world.player;
  W.t = -1; W.washes++;
  const was = Number(pl.grubby) || 0;
  pl.grubby = 0;
  const n = applySoot(world);
  puff(world, W.at, 1.2, 0xe8e8ee);
  hiss(W.at, 1.2, 0.2);
  bump('washes');
  note('note', was > 0 ? 'washed the deck out of my clothes at the laundry' : 'ran a cycle at the laundry; nothing much to wash', world);
  world.notify?.('LAUNDRY & SHOWERS', was > 0 ? 'clean. It will not last' : 'clean enough already');
  V.log.push({ verb: 'wash', was, materials: n });
}

/* ── 8. THE KENNEL ─────────────────────────────────────────────────────── */

/** The animals in this room: the handlers' own, or the two the bin keeps. */
function kennelAnimals(world, V) {
  const F = V.feed;
  const out = [];
  const life = world?._stationLife;
  for (const b of life?.live?.values?.() || []) {
    const pet = b?._stationAnimal;
    if (pet && !pet.dead && pet.stationPlace === VERB_PLACE.feed) out.push(pet);
  }
  for (const p of F?.pets || []) if (p && !p.dead) out.push(p);
  return out;
}

function scoopFeed(world, V) {
  const F = V.feed;
  if (!F || F.t >= 0) return false;
  /* NOBODY TO FEED IS NOT A REASON FOR NOTHING TO HAPPEN — the bin keeps two
   * of its own, spawned the first time somebody scoops, exactly as
   * `StationLife.stepHandlers` fields an animal beside its handler. */
  if (!kennelAnimals(world, V).length) spawnKennelPair(world, V);
  F.t = 0; F.fed = 0; F.paid = false;
  F.fill.visible = true;
  F.fill.scale.set(1, 1, 1);
  hiss(F.at, 0.5, 0.1);
  puff(world, F.at, 0.5, 0xbfa87a);
  soil(world, 0.22);
  const pets = kennelAnimals(world, V);
  for (const p of pets) p.__verbFeed = { t: 0, at: false, paid: false };
  world.notify?.('THE KENNEL HABITAT', pets.length ? 'they heard the bin' : 'the bowl is full; nobody is home');
  return true;
}

function spawnKennelPair(world, V) {
  const F = V.feed;
  F.pets = F.pets || [];
  for (let i = 0; i < 2 && F.pets.length < 2; i++) {
    const at = F.spawnAt[i] || F.spawnAt[0];
    let pet = null;
    try {
      pet = world.spawnEnemy?.('massiff', new THREE.Vector3(at.x, F.floorY + 0.1, at.z),
        { team: world.player?.team ?? 0 });
    } catch { pet = null; }
    if (!pet) return;
    pet.team = world.player?.team ?? 0;
    pet.stationResident = true;
    pet.noAmbientHarm = true;
    pet.stationPlace = VERB_PLACE.feed;
    pet.stationName = i ? 'Cass' : 'Bantha';
    pet.stationRole = "the kennel's own";
    pet.__verbPet = true;
    F.pets.push(pet);
    V.pets.push(pet);
  }
}

/* ── 9. THE ARM WRESTLE ────────────────────────────────────────────────── */

/** The seat claim `StationSit` and `StationLife` both build — one shape. */
function claimFor(prop, yaw, table) {
  const q = prop.body.position;
  return {
    prop, table, yaw, state: 'sit', blend: 1,
    pos: q.clone(), quat: prop.body.quaternion.clone(),
    y: q.y + seatTop(prop),
    tableY: table ? table.body.position.y + 0.78 : null,
    cup: false, cupObj: null,
    feet: { x: q.x + Math.sin(yaw) * 0.10, z: q.z + Math.cos(yaw) * 0.10 },
  };
}

function startBout(world, V) {
  const A = V.arm;
  if (!A || A.bout) return false;
  const pl = world.player;
  const life = world._stationLife;
  /* SOMEBODY HAS TO SIT ACROSS FROM YOU, and it is a person the room already
   * has rather than a body this file invents — the pit is never empty at an
   * hour anybody would be in it. */
  let foe = null, bd = 9;
  for (const b of life?.live?.values?.() || []) {
    if (!b || b.dead || b.alive === false || !b.position) continue;
    if (b.stationPlace !== VERB_PLACE.arm || b.wayR || b.__verbFoe) continue;
    const d = Math.hypot(b.position.x - A.at.x, b.position.z - A.at.z);
    if (d < bd) { bd = d; foe = b; }
  }
  if (!foe) { world.notify?.('THE PIT', 'nobody will put an elbow down with you'); return true; }
  /* THE STOOLS, BACK ON THEIR FEET AND FREE. A drinker may be sitting on one
   * and either may have been knocked over — `Bars.seatAtHand` refuses a seat
   * that is claimed, tumbled or still moving, so a bout that did not do this
   * charged the stake and then failed to sit anybody down. */
  for (let i = 0; i < 2; i++) {
    const st0 = i ? A.mine : A.theirs;
    const sitter = life?.seats?.get(st0);
    if (sitter) {
      life.seats.delete(st0);
      if (sitter.seat?.prop === st0) { sitter.seat = null; sitter.standIn = 0; }
    }
    st0.body.setTransform?.(A.home[i], new THREE.Quaternion());
    st0.body.velocity.set(0, 0, 0);
    st0.body.angularVelocity?.set?.(0, 0, 0);
    st0.mesh.position.copy(st0.body.position);
    st0.mesh.quaternion.copy(st0.body.quaternion);
  }

  /* HIM: on the far stool, facing the table, held there. */
  const tq = A.table.body.position;
  const sq = A.theirs.body.position;
  const yawT = Math.atan2(tq.x - sq.x, tq.z - sq.z);
  foe.__verbFoe = true;
  foe.standX = sq.x + Math.sin(yawT) * 0.10; foe.standZ = sq.z + Math.cos(yawT) * 0.10;
  foe.standCx = foe.standX; foe.standCz = foe.standZ;
  foe.standTx = foe.standX; foe.standTz = foe.standZ;
  foe.standFace = yawT; foe.facing = yawT;
  foe.standIn = 1e6;
  foe.position.set(foe.standX, sq.y, foe.standZ);
  foe.body?.setTransform?.(foe.position, null);
  if (life && !life.seats) life.seats = new Map();
  life?.seats?.set(A.theirs, foe);
  foe.seat = claimFor(A.theirs, yawT, A.table);

  /* YOU: beside your own stool, and `StationSit.sitKey` puts you on it. */
  const mq = A.mine.body.position;
  const yawM = Math.atan2(tq.x - mq.x, tq.z - mq.z);
  const fy = world.floorAt ? world.floorAt(mq.x, mq.z) : mq.y;
  pl.position.set(mq.x - Math.sin(yawM) * 0.25, fy, mq.z - Math.cos(yawM) * 0.25);
  pl.body?.setTransform?.(_v.set(pl.position.x, pl.position.y + 0.9, pl.position.z), null);
  pl.facing = yawM;
  /* AND THE PLAYER SITS THROUGH `StationSit`, which is the module that owns
   * what a seat claim is. It answers false for a seat it will not take, and a
   * bout you cannot sit down for is not a bout — nothing is charged for it. */
  const sat = sitKey(world);
  if (!sat) { world.notify?.('THE PIT', 'you cannot get a stool at that table'); return true; }
  const s = spend(STAKE.arm, 'an arm at the Pit');
  if (!s.ok) {
    pl.standUp?.();
    foe.__verbFoe = false; foe.standIn = 0; foe.seat = null;
    if (life?.seats?.get(A.theirs) === foe) life.seats.delete(A.theirs);
    world.notify?.('THE PIT', `${s.why} — you are ${s.short} short`);
    return true;
  }

  const st = world._station;
  const day = st?.day ?? stationDay();
  /* HIS STRENGTH IS HIS, and it is the same arm tomorrow: seeded on the day
   * and on where he stands, never on a clock. */
  const seed = hash2(day * 17 + (foe.stationSlot | 0), 18);
  A.bout = {
    t: 0, lean: 0, presses: 0, foe, seed,
    strength: 0.16 + seed * 0.16, sat, seat: pl.seat || null, done: false,
  };
  clack(A.at, 300, 0.14);
  world.notify?.(String(foe.stationName || 'THE PIT').toUpperCase(), `${SECS.arm} seconds. Press`);
  return true;
}

function endBout(world, V, won) {
  const A = V.arm, B = A?.bout;
  if (!B || B.done) return;
  B.done = true;
  A.bout = null;
  const foe = B.foe;
  const life = world._stationLife;
  if (foe) {
    foe.__verbFoe = false;
    foe.standIn = 0;
    if (life?.seats?.get(A.theirs) === foe) life.seats.delete(A.theirs);
    foe.seat = null;
    poseArm(foe, 0);
  }
  poseArm(world.player, 0);
  if (won) { A.won++; bump('armWon'); } else { A.lost++; bump('armLost'); }
  const purse = won ? pay(STAKE.arm * 2, 'an arm at the Pit') : 0;
  thump(A.at, won ? 140 : 80, 0.24);
  const name = foe?.stationName || 'the house';
  note('bet', won ? `took ${name}'s arm at the Pit — ${purse} credits`
    : `${name} put my arm down at the Pit — ${STAKE.arm} gone`, world);
  world.notify?.('THE PIT', won ? `down. ${purse} credits` : `he had you. ${STAKE.arm} gone`);
  V.log.push({ verb: 'arm', won, purse, presses: B.presses });
}

/** The forearm on the table, leaning by `k` in −1..1. Both rigs, one call. */
function poseArm(body, k) {
  const rig = body?.rig;
  if (!rig?.get) return;
  for (const [name, sign] of [['armR', 1], ['foreR', 1.6]]) {
    const b = rig.get(name);
    if (!b?.obj || !b.restQuat) continue;
    b.obj.quaternion.copy(b.restQuat).multiply(
      _q.setFromAxisAngle(_v2.set(0, 0, 1), -k * sign * 0.55));
  }
}

/* ── 10. THE GYM'S REMOTE ──────────────────────────────────────────────── */

const SPAR = Object.freeze({ secs: SECS.spar, shots: 16, first: 2.2, speed: 17, damage: 2, hover: 4.4, high: 1.4 });

function startSpar(world, V) {
  const S = V.spar;
  const pl = world.player;
  if (!S || S.round || !world.bolts?.fire) return false;
  if (!pl?.saber?.lit) { world.notify?.('THE GYM', 'light it first. It fires whether you are ready or not'); return true; }
  let built = null;
  try { built = buildRemote({ scale: 1.4 }); } catch { built = null; }
  if (!built) return false;
  const g = built.group;
  g.name = 'gym-remote';
  g.position.set(S.at.x, S.at.y, S.at.z);
  world.scene.add(g);
  const f = pl.facing || 0;
  const hover = new THREE.Vector3(pl.position.x + Math.sin(f) * SPAR.hover,
    pl.position.y + SPAR.high, pl.position.z + Math.cos(f) * SPAR.hover);
  S.round = {
    t: 0, g, built, hover, shots: 0, judged: 0, met: 0, bolts: [],
    nextAt: SPAR.first, gap: (SPAR.secs - SPAR.first - 4) / Math.max(1, SPAR.shots - 1),
    proxy: {
      remote: true, team: 1, dead: false, alive: true, isLocal: false, score: 0,
      position: g.position, stationName: 'gym remote', noAmbientHarm: true,
    },
  };
  world.notify?.('THE GYM', `${SPAR.shots} bolts over ${SPAR.secs} seconds. Meet them`);
  return true;
}

function sparRating(met, n) {
  const r = n > 0 ? met / n : 0;
  if (r >= 1) return 'every one — nothing to teach you here';
  if (r >= 0.75) return 'a good round';
  if (r >= 0.5) return 'half of them. Watch the low ones';
  if (r > 0) return 'come back tomorrow';
  return 'not one. Try it with the blade up';
}

function endSpar(world, V, why) {
  const S = V.spar, R = S?.round;
  if (!R) return;
  S.round = null;
  R.g.parent?.remove(R.g);
  R.g.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  for (const e of R.bolts) if (e.b.active && !e.b.held && !e.b.deflected) e.b.active = false;
  const st = world._station;
  const day = st?.day ?? stationDay();
  const f = verbsState();
  const prev = f.spar && typeof f.spar === 'object' ? f.spar : null;
  const rec = { best: Math.max(prev?.best | 0, R.met), last: R.met, n: SPAR.shots, day };
  fold({ spar: rec });
  S.rounds++;
  S.last = { met: R.met, judged: R.judged, fired: R.shots, why, t: R.t };
  note('test', `sparred the gym's remote — ${R.met} of ${SPAR.shots} met${why !== 'done' ? ` (${why})` : ''}`, world);
  world.notify?.('THE GYM', `${R.met} of ${SPAR.shots} — ${sparRating(R.met, SPAR.shots)}${rec.best > R.met ? ` (best ${rec.best})` : ''}`);
  V.log.push({ verb: 'spar', met: R.met, n: SPAR.shots, why });
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * One frame of all ten. Called from `stepStation`, after the bodies, so a
 * bone this file writes is the last word on it — the same slot
 * `StationLife.stepStanding` writes its residents' facings in.
 */
export function stepVerbs(world, st, dt) {
  const V = world?._verbs;
  if (!V || !(dt > 0)) return;
  /* The interact key's HELD state, put on the world by `Player._readInput`.
   * `stationKey` only ever sees the edge, and the fan is a hold. */
  const held = !!world._verbHold;
  V.holdEdge = held && !V.held;
  V.held = held;
  /**
   * ── AND ONE CLOCK IS THE PLAYER'S, NOT THE WORLD'S ─────────────────────
   *
   * The interact key IS the focus key (`World.update` reads `act('focus')`
   * for the deep Focus dip), so HOLDING it slows the world — measured here:
   * three seconds of hold on #39's bearing advanced the world's clock by
   * 0.94 s over 230 frames, because `dt *= timeScale * focus.scale` had it
   * down at a fifth.
   *
   * Two of the ten are gestures the PLAYER makes rather than events the world
   * has — a hold on a seized bearing and six seconds across a table — and
   * both are counted on the wall clock, recovered by dividing the dilation
   * back out. Everything else here (a lever, a bell, a cup, a bowl) is a
   * thing happening in the room and stays on the room's clock, which is what
   * makes it slow down with the room.
   */
  const scale = Math.max(0.02, (world.timeScale ?? 1) * (world.focus?.scale ?? 1));
  V.raw = dt / scale;

  promptVerbs(world, V);
  stepCarry(world, V, dt);
  stepLever(world, V, dt);
  stepPour(world, V, dt);
  stepDice(world, V, dt);
  stepBell(world, V, dt);
  stepFan(world, V, dt);
  stepWash(world, V, dt);
  stepFeed(world, V, dt);
  stepArm(world, V, dt);
  stepSpar(world, V, dt);
}

/** One line, on the frame you come into reach of a thing, and not again. */
function promptVerbs(world, V) {
  const s = spotAtHand(world);
  if (s === V.near) return;
  V.near = s;
  if (!s) return;
  /* A verb already in your hands does not need telling what to do, and a
   * shelf is not a prompt until there is something to put on it. */
  if (s.id === 'carry' && carrying(world, V)) return;
  if (s.id === 'shelf' && !carrying(world, V)) return;
  world.notify?.(s.head, s.prompt);
}

function stepCarry(world, V, dt) {
  const C = V.carry;
  if (!C || !C.held || C.crate.dead) return;
  const pl = world.player;
  if (!pl || pl.alive === false) { C.held = null; C.crate.body.gravityScale = 1; return; }
  const b = C.crate.body;
  const f = pl.facing || 0;
  /* Where a carried crate hangs: in front of the chest, at the height of the
   * hands — the point `Player._updateGrip` drives its own hold to, and driven
   * the same way, on the velocity, so it is still a body that hits things. */
  _v.set(pl.position.x + Math.sin(f) * 0.95, pl.position.y + 1.05, pl.position.z + Math.cos(f) * 0.95);
  if (_v.distanceTo(b.position) > 3.2) {
    C.held = null; b.gravityScale = 1;
    world.notify?.('CARGO HOLD', 'it got away from you');
    return;
  }
  b.wake?.();
  b.gravityScale = 0;
  _v2.subVectors(_v, b.position);
  b.velocity.copy(_v2).multiplyScalar(11).clampLength(0, 9);
  b.angularVelocity?.multiplyScalar?.(1 - Math.min(1, dt * 6));
  if (!C.dirty) { C.dirty = true; soil(world, 0.30); }
  /* On the shelf and let go of by itself: a delivery is arriving, not pressing. */
  if (overShelf(C)) { C.held = null; b.gravityScale = 1; landCrate(world, V); }
}

function stepLever(world, V, dt) {
  const L = V.lever;
  if (!L || L.throwT < 0) return;
  L.throwT += dt;
  const k = clamp(L.throwT / SECS.lever, 0, 1);
  /* 60° over half a second, and back over the second after the slam. */
  const back = clamp((L.throwT - 2.4) / 0.8, 0, 1);
  L.arm.rotation.x = (Math.PI / 3) * (k - back);
  if (L.slamT < 0 && k >= 1) {
    L.slamT = 0;
    crush(world, V);
  }
  if (L.slamT >= 0) {
    L.slamT += dt;
    const s = L.slamT < 0.35 ? L.slamT / 0.35 : clamp(1 - (L.slamT - 1.1) / 0.9, 0, 1);
    L.face.position.x = L.faceHome.x + (L.faceTo.x - L.faceHome.x) * s;
    L.face.position.z = L.faceHome.z + (L.faceTo.z - L.faceHome.z) * s;
  }
  if (L.throwT > 3.4) { L.throwT = -1; L.slamT = -1; L.arm.rotation.x = 0; L.face.position.copy(L.faceHome); }
}

/** The face crosses the throat and whatever was in it is not there any more. */
function crush(world, V) {
  const L = V.lever;
  const p = L.place;
  let n = 0;
  for (const drum of L.barrels) {
    if (!drum || drum.dead) continue;
    const q = drum.body.position;
    const l = toLocal(p, q.x, q.z);
    if (Math.abs(l.x) > L.well.w / 2 || Math.abs(l.z) > L.well.d / 2) continue;
    puff(world, q, 1.3, 0xa89880);
    world.particles?.sparkBurst?.(_v.copy(q), null, 10, { color: 0xffb060 });
    drum.destroy?.();
    n++;
  }
  L.crushed += n;
  thump(L.face.position, 54, 0.42);
  audio.noise({ dur: 0.9, gain: 0.24, type: 'lowpass', freq: 900, freqEnd: 90, pos: L.face.position, pink: true });
  world.player?.camera?.addShake?.(0.2);
  if (n > 0) {
    bump('crushed', n);
    const paid = pay(VERB_PAY.lever, 'a load through the compactor');
    note('job', `put ${n} drum${n === 1 ? '' : 's'} through the compactor — ${paid} credits`, world);
    world.notify?.('WASTE & RECYCLING', `${n} gone. ${paid} credits`);
    V.log.push({ verb: 'lever', crushed: n, paid });
  } else {
    world.notify?.('WASTE & RECYCLING', 'nothing in the throat. It closes on air');
  }
}

function stepPour(world, V, dt) {
  const P = V.pour;
  if (!P?.cup) return;
  const pl = world.player;
  P.t += dt;
  if (!P.taker) {
    const who = drinkerNear(world, pl.position, 3);
    if (who && P.t > 0.8) {
      P.taker = who;
      who.standFace = Math.atan2(pl.position.x - who.position.x, pl.position.z - who.position.z);
      who.standIn = Math.max(who.standIn || 0, 3);
    }
    cupInHand(P.cup, pl.rig, 'R');
    if (P.t > 12) {
      P.cup.parent?.remove(P.cup); P.cup = null;
      world.notify?.('BEHIND THE BAR', 'nobody came. You pour it away');
    }
    return;
  }
  const who = P.taker;
  if (who.dead || who.alive === false) { P.taker = null; return; }
  cupInHand(P.cup, who.rig, 'R');
  if (P.t < 2.0) return;
  /* Taken, drunk, tipped. */
  who.__verbCup = true;
  P.cup.parent?.remove(P.cup);
  P.cup = null; P.taker = null; P.poured++;
  bump('poured');
  const paid = pay(VERB_PAY.pour, 'a tip at the cantina bar');
  clack(P.at, 900, 0.1);
  note('paid', `served ${who.stationName || 'a drinker'} at the Long Night — ${paid} credits over the bar`, world);
  world.notify?.(String(who.stationName || 'A DRINKER').toUpperCase(), `keep it — ${paid}`);
  V.log.push({ verb: 'pour', paid, who: who.stationName || null });
}

function stepDice(world, V, dt) {
  const D = V.dice;
  if (!D || D.state !== 'rolling') return;
  D.t += dt;
  let moving = false;
  for (const die of D.dice) {
    if (die.dead) continue;
    if (die.body.velocity.lengthSq() > 0.02) moving = true;
  }
  if (D.t < 1.0) return;
  if (moving && D.t < 8) return;
  D.state = 'idle';
  const mine = D.dice.map((d) => (d.dead ? 1 : upFace(d)));
  const total = mine.reduce((a, b) => a + b, 0);
  const st = world._station;
  const day = st?.day ?? stationDay();
  /* HIS BONES ARE SEEDED, not thrown: the house's roll is the same for both
   * machines in a co-op session, on the same day, on the same throw. */
  const a = 1 + Math.floor(hash2(day * 91 + D.rolls, 101) * 6);
  const b = 1 + Math.floor(hash2(day * 91 + D.rolls, 202) * 6);
  const his = a + b;
  const won = total > his;
  D.last = { mine, total, his: [a, b], hisTotal: his, won };
  clack(D.home, 380, 0.14);
  if (won) {
    const purse = pay(STAKE.dice * 2, 'the Drazi bones');
    bump('diceWon');
    note('bet', `threw ${total} against ${his} at the Drazi pit — ${purse} credits`, world);
    world.notify?.('THE DRAZI QUARTER', `${total} against ${his}. ${purse} credits`);
    V.log.push({ verb: 'dice', total, his, won: true, purse });
  } else {
    bump('diceLost');
    note('bet', `threw ${total} against ${his} at the Drazi pit — ${STAKE.dice} gone`, world);
    world.notify?.('THE DRAZI QUARTER', `${total} against ${his}. Green takes it`);
    V.log.push({ verb: 'dice', total, his, won: false, purse: 0 });
  }
}

function stepBell(world, V, dt) {
  const B = V.bell;
  if (!B || B.swing <= 0) return;
  B.t += dt;
  B.swing = Math.max(0, 1 - B.t / 3.4);
  B.bell.rotation.z = Math.sin(B.t * 7.4) * 0.42 * B.swing;
  if (B.swing <= 0) B.bell.rotation.z = 0;
}

function stepFan(world, V, dt) {
  const F = V.fan;
  if (!F) return;
  if (F.holding) {
    const at = V.spot.fan && atSpot(world, V.spot.fan);
    if (!at || !V.held) {
      if (F.hold > 0.2) world.notify?.('LAUNDRY & SHOWERS', 'you let go of it');
      F.holding = false; F.hold = 0;
    } else {
      F.hold += V.raw;
      if (F.hold >= SECS.fan) fanFixed(world, V);
    }
  }
  if (!F.holding && F.spin <= 0 && !fanStopped(world)) F.spin = 1;
  if (F.spin > 0) {
    F.angle += dt * 7.5;
    F.blades.rotation.z = F.angle;
  }
}

function stepWash(world, V, dt) {
  const W = V.wash;
  if (!W || W.t < 0) return;
  W.t += dt;
  W.door.rotation.z = Math.sin(W.t * 9) * 0.35;
  if (W.t >= SECS.wash) washDone(world, V);
}

function stepFeed(world, V, dt) {
  const F = V.feed;
  if (!F || F.t < 0) return;
  F.t += dt;
  let eating = 0;
  for (const pet of kennelAnimals(world, V)) {
    const E = pet.__verbFeed;
    if (!E) continue;
    const dx = F.at.x - pet.position.x, dz = F.at.z - pet.position.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (!E.at) {
      if (d > 0.9) {
        /* Driven on the position, like every other station body: the pool
         * writes `standCx`, a walker writes `wayAngle`, and an animal called
         * to a bowl walks. */
        const step = Math.min(d - 0.6, 1.7 * dt);
        pet.position.x += (dx / d) * step;
        pet.position.z += (dz / d) * step;
        pet.body?.setTransform?.(pet.position, null);
        pet.facing = Math.atan2(dx, dz);
        pet.velocity?.set?.((dx / d) * 1.7, 0, (dz / d) * 1.7);
        continue;
      }
      E.at = true; E.t = 0;
      pet.velocity?.set?.(0, 0, 0);
    }
    E.t += dt;
    if (E.t <= SECS.feedHead) {
      eating++;
      /* HEAD DOWN, and it is the head bone: `Rig.walkerSkeleton` gives every
       * beast one, and this runs after the animator so it is the last word. */
      const head = pet.rig?.get?.('head');
      if (head?.obj && head.restQuat) {
        head.obj.quaternion.copy(head.restQuat).multiply(_q.setFromAxisAngle(_v2.set(1, 0, 0), 0.85));
      }
      if (!E.paid) {
        E.paid = true;
        F.fed++;
        if (!F.paid) {
          F.paid = true;
          bump('feeds');
          const paid = pay(VERB_PAY.feed, 'feeding the kennel');
          note('job', `fed the kennel — ${paid} credits from the handler`, world);
          world.notify?.('THE HANDLER', `they eat for you. ${paid} credits`);
          V.log.push({ verb: 'feed', paid });
        }
      }
    } else {
      pet.__verbFeed = null;
    }
  }
  F.eating = eating;
  /* The bowl empties as they eat it. */
  const left = clamp(1 - (F.t - 1) / (SECS.feedHead + 2), 0, 1);
  F.fill.scale.set(1, Math.max(0.05, left), 1);
  if (F.t > SECS.feedHead + 4) { F.t = -1; F.fill.visible = false; }
}

function stepArm(world, V, dt) {
  const A = V.arm, B = A?.bout;
  if (!B) return;
  const pl = world.player;
  if (!pl || pl.alive === false) { endBout(world, V, false); return; }
  B.t += V.raw;
  /**
   * THE MASH READS THE KEY DIRECTLY, and it has to: `stationKey`'s seat
   * branch sits ABOVE the hook and claims every press while you are on a
   * stool, so a shove counted through `verbKey` would never arrive. The edge
   * this reads is the same edge `actHit` is — one press, one shove.
   *
   * And you are not getting up in the middle of it. The seat branch stands
   * you; this puts you straight back down, which is what a hand locked
   * across a table means and is the only thing it could mean.
   */
  if (B.seat) {
    if (!pl.seat) { pl.sitOn(B.seat); world._stationLife?.seats?.set?.(A.mine, pl); }
    pl.seat.state = 'sit';
    pl.seat.blend = Math.min(1, pl.seat.blend + dt * 4);
  }
  /* The drain first and the shove second, so a shove that reaches the pin
   * WINS on the frame it lands. The other order costs the opponent's tenth of
   * a second back off the top and the lean sticks at 0.99 for ever — measured:
   * a bout mashed flat out ran the full six seconds with the pin never once
   * reached. */
  B.lean = clamp(B.lean - B.strength * V.raw, -1, 1);
  if (V.holdEdge) { B.presses++; B.lean = clamp(B.lean + 0.16, -1, 1); clack(A.at, 260, 0.1); }
  poseArm(pl, B.lean);
  poseArm(B.foe, -B.lean);
  if (B.lean >= 1) { endBout(world, V, true); return; }
  if (B.lean <= -1) { endBout(world, V, false); return; }
  if (B.t >= SECS.arm) endBout(world, V, B.lean > 0);
}

function stepSpar(world, V, dt) {
  const S = V.spar, R = S?.round;
  if (!R) return;
  const pl = world.player;
  if (!pl || pl.alive === false) { endSpar(world, V, 'the blade is down'); return; }
  R.t += dt;
  const g = R.g;
  const k = clamp(R.t / 2.0, 0, 1);
  const hx = R.hover.x + Math.sin(R.t * 0.8) * 0.6, hz = R.hover.z + Math.cos(R.t * 0.6) * 0.5;
  const hy = R.hover.y + Math.sin(R.t * 1.2) * 0.2;
  const rate = Math.min(1, dt * (2.4 + k * 2));
  g.position.x += (hx - g.position.x) * rate;
  g.position.y += (hy - g.position.y) * rate;
  g.position.z += (hz - g.position.z) * rate;
  g.rotation.y += dt * 1.6;
  if (R.built.halo) R.built.halo.intensity = 1.1 + 0.7 * Math.max(0, Math.sin(R.t * 8));

  if (R.shots < SPAR.shots && R.t >= R.nextAt && k >= 1) {
    _v.set(pl.position.x, pl.position.y + 1.25, pl.position.z);
    _v2.subVectors(_v, g.position);
    const dist = _v2.length() || 1;
    _v2.multiplyScalar(1 / dist);
    const b = world.bolts.fire(g.position, _v2, {
      speed: SPAR.speed, team: 1, owner: R.proxy, damage: SPAR.damage, color: 0x8fe0ff, big: true,
      life: Math.max(2.5, dist / SPAR.speed + 1.5),
    });
    if (b) {
      R.bolts.push({ b, met: false, judged: false });
      R.shots++;
      R.nextAt = SPAR.first + R.shots * R.gap;
    }
  }
  for (const e of R.bolts) {
    if (e.judged) continue;
    const b = e.b;
    if (b.deflected || b.held || (b.deflector && b.deflector === pl)) e.met = true;
    if (!b.active || e.met) {
      e.judged = true; R.judged++;
      if (e.met) R.met++;
      world.notify?.('THE GYM', `${R.met} of ${R.judged}`);
    }
  }
  if ((R.shots >= SPAR.shots && R.judged >= R.shots) || R.t >= SPAR.secs) endSpar(world, V, 'done');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  UNDRESS                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

export function undressVerbs(world) {
  const V = world?._verbs;
  if (!V) return;
  if (V.spar?.round) {
    const R = V.spar.round; V.spar.round = null;
    R.g.parent?.remove(R.g);
    R.g.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  if (V.arm?.bout) { V.arm.bout.done = true; V.arm.bout = null; }
  if (V.pour?.cup) { V.pour.cup.parent?.remove(V.pour.cup); V.pour.cup = null; }
  for (const m of V.meshes) m.parent?.remove(m);
  for (const g of V.geo) g.dispose?.();
  for (const p of V.props) { if (p && !p.dead) p.destroy?.(); }
  V.meshes.length = 0; V.geo.length = 0; V.props.length = 0;
  world._verbs = null;
}
