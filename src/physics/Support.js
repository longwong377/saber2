/**
 * BATTLEFRONT BORZ — what is under your feet?
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
 * ── EXCEPT WHAT SAYS IT IS CLIMBABLE ──────────────────────────────────────
 *
 * One `stepUp` for every surface in the game is a rule that reads well and is
 * wrong about one thing in particular: a FELLED TREE. `Trees.js` measured its
 * own wood — median trunk radius 0.27 m, so a log lying on the ground stands
 * 0.55 m off it — against a step of 0.45, and half the timber in the level is
 * therefore a wall by ten centimetres. That is the whole of the player's
 * "invisible walls… I think maybe only when you cut trees down".
 *
 * So a box may declare `userData.climb`: the height, in metres above the feet,
 * at which THAT box stops being a floor. Nothing else changes — a wall, a
 * crate, a hull, a standing trunk all keep the one rule — and a body that
 * cannot climb (see `stepUp` callers passing a smaller number) is unaffected,
 * because the allowance is only ever taken as the LARGER of the two.
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
      if (y <= best) continue;
      const climb = box.userData?.climb;
      if (y <= (climb > stepUp ? feetY + climb : ceil)) best = y;
    }
  }
  return topOfProps(props, x, z, feetY, radius, stepUp, best);
}

/**
 * The same question for a list of `{position, extent}` boxes, raised above a
 * floor you already have.
 *
 * Split out because more than one kind of thing answers it and they are not
 * interchangeable everywhere else: a crate is a body the player also shoves,
 * and the deck of a spider walker is a surface they can only stand on. Both are
 * floor; only one of them moves when you walk into it. See Player._gatherNear.
 */
export function topOfProps(props, x, z, feetY, radius, stepUp, best) {
  if (!props) return best;
  const ceil = feetY + stepUp;
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

/**
 * HOW FAST A BODY GETS OVER SOMETHING TALLER THAN A STEP, in m/s.
 *
 * Reached only for a surface that declared itself climbable — today a felled
 * trunk and nothing else, see the `climb` note above. The rate is what makes it
 * a clamber rather than a lift: the median log in the wood (0.55 m over the
 * ground) is under you in 0.16 s and the largest (1.26 m) in 0.37. Without it
 * the body arrives on top of the log in one frame, which in first person —
 * where the eye copies the body rather than damping toward it — is a jolt
 * straight up.
 *
 * Here rather than in Player.js because the droids climb the same logs, and a
 * second copy of this number is the shape of defect this repository keeps
 * deleting.
 */
export const CLIMB_RATE = 3.4;

/**
 * The BOTTOM of one static box in the column through (x, z), or +Infinity if
 * the column misses it. The mirror of `boxTopAt`, and built the same way for
 * the same reason: clamping a point far BELOW (x, z) into the box's own frame
 * and coming back out lands on the underside, which stays correct for a
 * rotated box where "the bottom" is not a single height.
 */
export function boxBottomAt(box, x, z, radius) {
  _p1.set(x, box.center.y - box.radius - 1, z).sub(box.center).applyQuaternion(box.invQuat);
  const h = box.halfExtents;
  _p2.set(clamp(_p1.x, -h.x, h.x), clamp(_p1.y, -h.y, h.y), clamp(_p1.z, -h.z, h.z));
  _p2.applyQuaternion(box.quat).add(box.center);
  const dx = _p2.x - x, dz = _p2.z - z;
  if (dx * dx + dz * dz > radius * radius) return Infinity;
  return _p2.y;
}

/**
 * WHAT IS OVER YOUR HEAD — and until this existed, nothing was.
 *
 * The file opened with "one question, asked by the player, by every enemy and
 * by the gait solver", and that question only ever pointed DOWN. Vertical
 * resolution therefore existed in one direction: Player._collide skips upward
 * faces because floors belong to `supportHeight` above, and then flattens what
 * is left with `_v5.y = 0` — which for a DOWNWARD face is the whole normal, so
 * the contact was computed and thrown away. Measured on a stub world with a
 * slab at y=3.5..4.5: a jump crossed the underside at f38, was 0.5 m inside
 * solid slab at f42, and STEP_UP snapped the body out onto the roof at f57.
 * Swept over the nine shipped levels the same jump entered 11 roofs from
 * underneath (scoria 3, mustafar 1, geonosis 3, hangar 4).
 *
 * A ceiling is the exact complement of a floor and is written as one: the
 * LOWEST downward face in the column, ignoring anything at or below
 * `feetY + stepUp`, because everything down there is floor or step and
 * `supportHeight` already owns it. Nothing above the column answers, so an
 * open sky is +Infinity and the caller does nothing.
 *
 * STATIC BOXES ONLY, on purpose. The dynamic-prop record does not describe its
 * own underside in one shape — a crate's `position` is its centre with
 * `extent` as half-extents, while `Enemy.platform()` hands back `position` at
 * the feet and `extent.y` as the height ABOVE them (see topOfProps, which only
 * ever needs the top and so never has to tell them apart). Guessing a bottom
 * from that would be one rule with two meanings, which is the defect this
 * project keeps deleting. Roofs are static boxes; when a walker's belly needs
 * to be solid, the record gets an honest underside first.
 */
export function ceilingHeight(boxes, x, z, feetY, radius, stepUp) {
  let best = Infinity;
  if (!boxes) return best;
  const floorLimit = feetY + stepUp;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box.disabled) continue;
    const y = boxBottomAt(box, x, z, radius);
    if (y < best && y > floorLimit) best = y;
  }
  return best;
}
