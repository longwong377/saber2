/**
 * THE PLAYER SITS DOWN — V18 hole 4's other half.
 *
 * `StationLife.stepStanding` puts every resident on the station's chairs and
 * benches (`Rig.poseSeated` on a claim from `Bars.seatsNear`), and the one
 * body in the game that could not sit on any of them was the player's. §3.2
 * #14 asks for "sit, drink (a beat), talk to a resident" and the talk was the
 * only one of the three built.
 *
 * So the interact key, pressed beside a free upright seat, sits you on it:
 * the same claim the residents make — into `life.seats`, so nobody sits on
 * you — the same feet point (the seat's centre plus a tenth of a metre along
 * its facing), the same pose (`Player._poseSeat` runs `poseSeated` at the
 * end of the body pass). A move key, the jump, or the key again stands you
 * up. The camera stays yours the whole time, which is what a seat in a bar
 * is for.
 *
 * ONE MODULE, because `Station.stationKey` is the only caller and
 * `StationLife`'s seat code is about bodies the pool owns. Nothing here
 * rolls; the seat chosen is the nearest, off the world.
 */
import { seatsNear, seatTop, seatYaw, seatUpright, tableBefore, tableTop } from './Bars.js';
import { placeUnder } from './Station.js';

/** How far a seat may be from the player for the key to mean "sit". */
export const SIT_REACH = 1.6;

/** The seat the key would take right now, or null — the HUD's hint reads this. */
export function seatAtHand(world) {
  const pl = world?.player;
  const p = pl?.position;
  if (!p || !world?.props?.length || pl.seat) return null;
  const life = world._stationLife;
  const near = seatsNear(world, p.x, p.y, p.z, SIT_REACH, life?.seats).filter(seatUpright);
  return near.length ? near[0] : null;
}

/**
 * The key. True when the press was spent — sat down, or stood up.
 */
export function sitKey(world) {
  const pl = world?.player;
  if (!pl) return false;
  if (pl.seat) { pl.standUp(); return true; }
  const prop = seatAtHand(world);
  if (!prop) return false;
  const life = world._stationLife;
  if (life && !life.seats) life.seats = new Map();
  const q = prop.body.position;
  let yaw = seatYaw(prop), table = null;
  if (yaw === null) {
    /* No back to read: face the nearest table, or the room's middle, or
     * the way you were already looking. */
    let bd = 1.6;
    for (const t of world.props) {
      if (t.kind !== 'table' || t.dead) continue;
      const d = Math.hypot(t.body.position.x - q.x, t.body.position.z - q.z);
      if (d < bd) { bd = d; table = t; }
    }
    const room = placeUnder(world, q.x, q.z);
    if (table) yaw = Math.atan2(table.body.position.x - q.x, table.body.position.z - q.z);
    else if (room && room.w) yaw = Math.atan2(room.x - q.x, room.z - q.z);
    else yaw = pl.facing;
  } else table = tableBefore(world, q.x, q.z, yaw);
  const claim = {
    prop, table, yaw, state: 'sit', blend: 0,
    pos: q.clone(), quat: prop.body.quaternion.clone(),
    y: q.y + seatTop(prop),
    tableY: table ? tableTop(table) : null,
    cup: false, cupObj: null,
    /* where the feet go: the seat's centre, a tenth of a metre along its facing */
    feet: { x: q.x + Math.sin(yaw) * 0.10, z: q.z + Math.cos(yaw) * 0.10 },
  };
  life?.seats?.set(prop, pl);
  pl.sitOn(claim);
  const room = placeUnder(world, q.x, q.z);
  world.notify?.((room?.name || 'A SEAT').toUpperCase(), 'you sit. Move, or press the key, to get up');
  return true;
}

/** Let the seat go — on a stand-up, a room change, a death, a dispose. */
export function releaseSeat(world, pl = world?.player) {
  const S = pl?.seat;
  if (!S) return;
  const life = world?._stationLife;
  if (life?.seats?.get(S.prop) === pl) life.seats.delete(S.prop);
  if (S.prop?.body && !S.prop.dead) S.prop.body.wake?.();
  pl.seat = null;
}
