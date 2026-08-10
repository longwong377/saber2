/**
 * SABER — what is under your feet?
 *
 * One question, asked by the player, by every enemy, and by the gait solver on
 * behalf of each foot. It used to have two different answers depending on who
 * asked, and the cheap wrong one won: a terrain heightfield sample, which on
 * top of a boulder is metres below you.
 *
 * The consequences were the player's own bug report, verbatim — "you like
 * repeatedly hop over and over and over and kind of slide off, and phase into
 * it" — plus enemies that could not stand on anything at all and legs drawn
 * through the rock the body was standing on. `tools/checks/standing.mjs` has
 * the full account.
 *
 * So it lives here, once, and terrain, static boxes and dynamic props all
 * answer it in the same units. Whoever is asking cannot tell them apart, which
 * is the point: neither can the player.
 */
import * as THREE from 'three';

const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * The top of one static box in the column through (x, z), or -Infinity if the
 * column misses it.
 *
 * Clamping a point high above (x, z) into the box's own frame and coming back
 * out lands on the top face, and — unlike `center.y + halfExtents.y` — it stays
 * correct for a ROTATED box, where "the top" is not a single height. `radius`
 * is the standing body's own, so a foot planted a little past the lip still
 * finds the surface; erring that way makes ledges sticky rather than slippery,
 * which is the right side to be wrong on.
 */
export function boxTopAt(box, x, z, radius) {
  _p1.set(x, box.center.y + box.radius + 1, z).sub(box.center).applyQuaternion(box.invQuat);
  const h = box.halfExtents;
  _p2.set(clamp(_p1.x, -h.x, h.x), clamp(_p1.y, -h.y, h.y), clamp(_p1.z, -h.z, h.z));
  _p2.applyQuaternion(box.quat).add(box.center);
  const dx = _p2.x - x, dz = _p2.z - z;
  if (dx * dx + dz * dz > radius * radius) return -Infinity;
  return _p2.y;
}

/**
 * The highest surface under (x, z) that a body with its feet at `feetY` could
 * be standing on.
 *
 * Anything above `feetY + stepUp` is a wall, not a floor, and is ignored — or
 * jumping past a ledge would snatch you onto it in mid-air.
 *
 * @param {object|null} terrain   anything with height(x, z)
 * @param {Array}  boxes  static boxes; pass a pre-filtered short list if you have one
 * @param {Array}  props  dynamic bodies carrying `position` and `extent`
 */
export function supportHeight(terrain, boxes, props, x, z, feetY, radius, stepUp) {
  let best = terrain ? terrain.height(x, z) : 0;
  const ceil = feetY + stepUp;
  if (boxes) {
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.disabled) continue;
      const y = boxTopAt(box, x, z, radius);
      if (y > best && y <= ceil) best = y;
    }
  }
  if (props) {
    for (let i = 0; i < props.length; i++) {
      const b = props[i];
      const e = b.extent;
      if (!e) continue;
      const dx = b.position.x - x, dz = b.position.z - z;
      const rr = Math.max(e.x, e.z) + radius;
      if (dx * dx + dz * dz > rr * rr) continue;
      const top = b.position.y + e.y;
      if (top > best && top <= ceil) best = top;
    }
  }
  return best;
}

/**
 * How far a floor may be above the feet and still be a step rather than a wall,
 * and how far below and still count as contact. The second is small on purpose:
 * enough to hold the surface walking down a slope, not enough to feel magnetic
 * when you step off a ledge.
 */
export const STEP_UP = 0.45;
export const GROUND_SNAP = 0.12;
