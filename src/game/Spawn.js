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

export function spawnClear(world, x, y, z, radius = 0.45) {
  const w = world.level?.water;
  if (w) {
    const depth = (w.level ?? 0) - y;
    // Never in a hazard; never deeper than the shallows anywhere else. The
    // wood's ankle-deep channels stay usable, which is most of that level.
    if (depth > 0 && (w.damage > 0 || depth > Math.min(w.wade ?? 0.45, 0.45))) return false;
  }
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
