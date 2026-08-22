/**
 * BATTLEFRONT BORZ — is this somewhere a body can arrive?
 *
 * A leaf module, and a leaf on purpose. This test belongs beside the level
 * data that motivates it, but `Levels.js` imports `Arrivals.js` for
 * `ARRIVAL_BY_TERRAIN`, so `Arrivals.js` cannot import `Levels.js` back — and
 * `Arrivals._sitePoint` is the second of the two places in the game that pick
 * a spot for a body to appear in. A predicate that only one of the two callers
 * can reach is a predicate half the spawns skip.
 *
 * WHAT IT IS FOR. `World.pickSpawn` tested exactly two things —
 * `inBounds(x, z, 10)` and `slopeAt(x, z) > 0.5` — and so did
 * `Arrivals._sitePoint`. Neither looked at anything the LEVEL had put on the
 * ground. Measured, 5,400 spawn picks per level from six anchors, each spawn's
 * chest point (y + 1.0) tested against every enabled static box: 11.9% of
 * temple spawns and 12.7% of arena spawns arrived INSIDE solid masonry — a
 * column, a machine, a tank, the aisle walls — and 8.7% on the warship.
 * Underwater was worse and quieter: 94.3% of spawns on the deeps and 20.3% on
 * the wood landed under the level's own water sheet.
 *
 * Both halves have teeth. A body spawned under a hazard sheet is a body
 * spawned in lava. And a body embedded in a collider used never to be pushed
 * out of it at all — Enemy's push-out skipped a chest point strictly inside a
 * box, so it walked out through the wall it was born in.
 *
 * WHAT IT DOES NOT TEST, deliberately: `world._siteTaken`. Those radii are
 * DRESSING exclusion radii — up to 7 m around a boulder cluster — not body
 * radii, and rejecting a 7 m disc round every dressed object would refuse most
 * of a dressed level. The collider list is what "inside something" means.
 */

import * as THREE from 'three';

const _sp = new THREE.Vector3(), _sq = new THREE.Vector3();

/**
 * THE LOWEST GROUND THIS LEVEL'S OWN SHEET WILL ACCEPT ANYTHING ON, in the
 * same metres a heightfield returns. `-Infinity` where there is no sheet.
 *
 * Never in a hazard; never deeper than the shallows anywhere else — the wood's
 * ankle-deep channels stay usable, which is most of that level. That was one
 * expression inside `spawnClear` and it has a SECOND caller now:
 * `Front.marchFront` lays craters, a burnt swath, smoke columns, a band of the
 * fallen and wreck clusters at a distance the march schedule chose, and the
 * schedule knows nothing about what is at that distance. On the Ember Shelf,
 * engagement 1 is 180 m out over ground 38-45 m BELOW a lava sheet at +0.55:
 * measured before this, 12 of 12 hull pieces and the whole band of the dead
 * were laid on the sea floor, inside a hazard that charges 52 HP a second.
 *
 * Exported as a FLOOR rather than as a second predicate so the two callers
 * cannot disagree about where the shallows end (HANDOFF §2.4).
 */
export function dryFloor(world) {
  const w = world?.level?.water;
  if (!w) return -Infinity;
  return (w.level ?? 0) - (w.damage > 0 ? 0 : Math.min(w.wade ?? 0.45, 0.45));
}

export function spawnClear(world, x, y, z, radius = 0.45) {
  if (y < dryFloor(world)) return false;
  const boxes = world.physics?.staticBoxes;
  if (boxes) {
    _sp.set(x, y + 1.0, z);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.disabled) continue;
      const rr = b.radius + radius;
      if (_sp.distanceToSquared(b.center) > rr * rr) continue;
      _sq.copy(_sp).sub(b.center).applyQuaternion(b.invQuat);
      const h = b.halfExtents;
      if (Math.abs(_sq.x) - h.x < radius && Math.abs(_sq.y) - h.y < radius
        && Math.abs(_sq.z) - h.z < radius) return false;
    }
  }
  return true;
}

/**
 * ── AND IS IT SOMEWHERE THE PLAYER IS ABOUT TO SWING? ─────────────────────
 *
 * The player's words: "you spawn with your allies in front of your saber so
 * you end up killing them."
 *
 * That is a placement defect and not a combat one. `spawnClear` above answers
 * "is this point inside the level", and every caller that places a body near
 * the player was asking only that — so `CommandDirector.deploy` fanned the
 * whole roster over a full circle at 4 m, which puts two or three men in the
 * one wedge of ground a lightsaber sweeps through. Nothing about friendly fire
 * needed fixing; the men were standing in the blade.
 *
 * ── WHY THE REACH IS 6 m AND NOT 2.6 ─────────────────────────────────────
 *
 * The blade is the small number here and it is the wrong one to build the law
 * on. A one-handed sweep reaches about 2.6 m from the shoulder, and
 * `Command.BLADE_ROOM` is 3.0 — the ring a trooper is SHOVED back out to every
 * frame, described in its own note as "the margin is a step, because a trooper
 * that is exactly at the edge of the swing is one the player has to think
 * about."
 *
 * Now follow a body placed 4 m directly in front of a commander. Its formation
 * pulls it inward, `_clearBlade` pushes it back out, and it settles at exactly
 * 3.0 m — in front, seven tenths of a metre off the edge of the swing, for the
 * rest of the engagement. A placement law with a 3.6 m radius says that is
 * fine, and it is what the player is describing.
 *
 * So the radius is THE SWING PLUS THE STEP THAT CLOSES IT: 6.0 m, which is 3.0
 * of shove ring plus about a second of a trooper's walk. Anything placed inside
 * that wedge is a body that will be in the blade shortly, whatever it was
 * told to do. Measured on the shipped deployment ring (4 / 6.2 / 8.4 m, a full
 * circle): 60 of 400 placements were inside it.
 *
 * `SWING_HALF_ARC` is 80°, i.e. a 160° wedge. A saber arc in this game is a
 * horizontal sweep of a bit over a right angle plus wherever the camera swings
 * to mid-swing, and 160° is that plus the turn. Behind you is safe; beside you
 * is safe; in front of you is not, at any range that can close in a step.
 *
 * Both halves are exported because tools/checks/extraction.mjs measures the
 * property rather than the call sites — anything that ever places a body near
 * the player is answerable to `bladeClear`.
 */
export const SWING_REACH = 6.0;
export const SWING_HALF_ARC = 1.396;           // 80°, in radians

/**
 * Is (x, z) inside ONE body's swing wedge?
 *
 * `facing` is the yaw the player's own animator poses to, and a body facing
 * `f` looks along `(sin f, 0, cos f)` — Player._move builds its forward vector
 * exactly that way from `camera.yaw`, so this is the game's own forward and
 * not a second opinion about it. Falls back to the camera yaw for a body that
 * has not been posed yet, which is the case on the frame after `spawnPlayer`.
 */
export function inSwingArc(p, x, z) {
  if (!p || !p.position || p.alive === false) return false;
  const dx = x - p.position.x, dz = z - p.position.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > SWING_REACH * SWING_REACH) return false;
  // Directly on top of the player is inside every arc there is.
  if (d2 < 1e-6) return true;
  const f = p.facing ?? ((p.camera?.yaw ?? 0) + Math.PI);
  const fx = Math.sin(f), fz = Math.cos(f);
  const inv = 1 / Math.sqrt(d2);
  return (dx * inv * fx + dz * inv * fz) > Math.cos(SWING_HALF_ARC);
}

/**
 * Is (x, z) clear of every LOCAL player's swing?
 *
 * Local only, and that is a co-op decision rather than an oversight: a remote
 * commander's blade is not the one that will cut this body, their facing on
 * this machine is a wire value that is up to a round trip stale, and refusing
 * ground around every peer in a four-player session would leave nowhere at all
 * to put a squad. The invariant this file is holding is "the person holding
 * the camera does not kill their own men".
 */
export function bladeClear(world, x, z) {
  const ps = world?.players;
  if (ps) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p && p.isLocal !== false && inSwingArc(p, x, z)) return false;
    }
    return true;
  }
  return !inSwingArc(world?.player, x, z);
}

/** Both questions at once, for a caller placing a body near the player. */
export function placementClear(world, x, y, z, radius = 0.45) {
  return spawnClear(world, x, y, z, radius) && bladeClear(world, x, z);
}

/**
 * MOVE A POINT OUT OF THE SWING, rather than refusing it.
 *
 * A rejection loop is wrong for the two callers that matter. Both of them are
 * placing a KNOWN number of bodies in a ring whose radius they chose — a squad
 * disembarking, a line deploying — so "try again" means "try the same ring
 * again", and the wedge does not move between tries.
 *
 * Reflecting the offset through the player is the one nudge that cannot fail:
 * the mirror of a point inside a cone of half-angle < 90° is outside it, by
 * construction, for any facing and any radius. The body ends up the same
 * distance away, behind you instead of in front of you, which is also where a
 * squad forming up on its commander belongs.
 *
 * `out` is mutated and returned. `y` is left alone — the caller owns grounding,
 * because only the caller knows whether it has a heightfield.
 */
export function nudgeFromSwing(world, out) {
  if (!out || bladeClear(world, out.x, out.z)) return out;
  const ps = world?.players;
  const list = ps && ps.length ? ps : (world?.player ? [world.player] : []);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.isLocal === false || !inSwingArc(p, out.x, out.z)) continue;
    out.x = p.position.x - (out.x - p.position.x);
    out.z = p.position.z - (out.z - p.position.z);
  }
  return out;
}
