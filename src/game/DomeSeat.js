/**
 * A WINDOW SEAT — V18 cool 12: *"a window seat in the dome: sitting swaps to
 * a cinematic camera of the battle."*
 *
 * `StationSit.sitKey` sits the player on any free chair and leaves the camera
 * theirs, which is right in a bar. On a seat AT THE GLASS it is the wrong
 * camera: the one thing that seat is for is the war outside, and the war
 * outside is `DeckBattle` — fourteen hulls and two hundred fighters in real
 * geometry, hundreds of metres past the skin, at an angle a third-person rig
 * pinned to a chair by a boom and five collision rays can never frame.
 *
 * So, while the player sits on a window seat, the camera is taken outside:
 * a slow orbit round the drum at `DRUM.R + 38` m, starting over the seat's
 * own bearing, looking at the fleet's centroid (`deckBattleState`'s hulls,
 * whichever are shown; the sky's `uFleetDir` when none is yet). It stands up
 * with the player — the rig writes the camera every frame and this file
 * writes it after (the station is stepped after the players), so the moment
 * the seat is released there is nothing to restore.
 *
 * WHICH SEATS: the Observation dome (#54, deck 60 — glass all round, so any
 * chair in it), and the Promenade's window wall (deck 44's ring, a seat past
 * `DRUM.roomR` that faces the skin). The Ascendant's glass rail is over the
 * atrium void, not space, and is not one.
 *
 * Nothing rolls. The orbit is a function of the seat's bearing and the time
 * in the chair.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { DRUM, DECK_Y } from './StationPlan.js';
import { deckBattleState } from './DeckBattle.js';

/** The camera's orbit, metres outside the axis, and its pace. */
export const SHOT_R = DRUM.R + 38;
export const SHOT_RATE = 0.06;   // rad/s — a turn every 105 s
/** A seat past this radius on the Living deck is on the window wall. */
const WINDOW_R = DRUM.roomR - 0.5;
/** How square to the skin a seat must face to count: cos of ~70°. */
const FACING = 0.3;
/** The dome. */
const DOME = 54;

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * The window seat the player is on, or null: `{ kind, bearing }` with
 * `kind` 'dome' or 'promenade'.
 */
export function windowSeat(world) {
  const pl = world?.player;
  const S = pl?.seat;
  const st = world?._station;
  if (!S || !st || S.state !== 'sit') return null;
  const q = S.pos || S.prop?.body?.position;
  if (!q) return null;
  const r = Math.hypot(q.x, q.z);
  const bearing = Math.atan2(q.x, q.z);
  if (st.deck === 60 && st.places?.has(DOME)) return { kind: 'dome', bearing };
  if (st.deck === 44 && r > WINDOW_R) {
    const out = (Math.sin(S.yaw) * q.x + Math.cos(S.yaw) * q.z) / Math.max(r, 1e-6);
    if (out > FACING) return { kind: 'promenade', bearing };
  }
  return null;
}

/**
 * Once a frame, at the end of `stepStation`. Drives the camera while a
 * window seat is held; one property read otherwise.
 */
export function stepDomeSeat(world, dt) {
  const pl = world?.player;
  const seat = pl?.seat ? windowSeat(world) : null;
  if (!seat) {
    if (world?._domeShot) world._domeShot = null;
    return;
  }
  const shot = world._domeShot || (world._domeShot = { t: 0, bearing: seat.bearing, kind: seat.kind });
  shot.t += Math.max(dt, 0);
  const st = world._station;
  const y0 = (DECK_Y[st.deck] ?? 0);
  /* THE ORBIT: out from the seat's own bearing, drifting clockwise, with a
   * slow rise and fall so the frame is never still. */
  const a = shot.bearing + shot.t * SHOT_RATE;
  const h = y0 + 22 + Math.sin(shot.t * 0.11) * 7;
  _p.set(SHOT_R * Math.sin(a), h, SHOT_R * Math.cos(a));
  /* WHAT IT LOOKS AT: the fleet's centroid, or where the sky says the fleet
   * is, or the planet. Eased so a hull arriving does not snap the frame. */
  const db = world._deckBattle;
  let n = 0;
  _c.set(0, 0, 0);
  if (db?.hulls) for (const hl of db.hulls) { if (hl.shown && hl.pos) { _c.add(hl.pos); n++; } }
  if (n) _c.multiplyScalar(1 / n);
  else {
    const dir = db?.sky?.mat?.uniforms?.uFleetDir?.value || db?.planetDir;
    if (dir) _c.copy(dir).multiplyScalar(700).add(_p);
    else { _c.copy(_p).multiplyScalar(4); _c.y = h + 80; }
  }
  /* A little of the drum in the frame: the look point leans back toward the
   * skin under the seat, so the glass the player is behind is in shot. */
  _t.set(DRUM.R * Math.sin(shot.bearing), y0 + 4, DRUM.R * Math.cos(shot.bearing));
  _c.lerp(_t, 0.12);
  if (!shot.look) shot.look = _c.clone();
  else shot.look.lerp(_c, Math.min(1, dt * 1.5));
  const rig = pl.camera;
  const cam = rig?.camera;
  if (!cam) return;
  cam.position.copy(_p);
  cam.lookAt(shot.look);
  cam.updateMatrixWorld?.();
  rig.pos?.copy(_p); rig.look?.copy(shot.look);
  shot.state = deckBattleState(world);
}
