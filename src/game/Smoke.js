/**
 * BATTLEFRONT BORZ — SMOKE, as a thing a bolt has to get through.
 *
 * The smoke-screen stratagem's card says "Nothing on either side can shoot
 * what it cannot see", and what shipped was sixty dust particles. A card that
 * promises a mechanic the game does not have is worse than no card: the player
 * spends Force on it, stands behind it, and is shot.
 *
 * ── WHY THIS IS A FILE AND NOT A FIELD ON THE WORLD ─────────────────────
 *
 * Three systems have to agree about where the clouds are and none of them owns
 * the others: the stratagem that lays one, the bolt that crosses one, and — the
 * day whoever owns Enemy.js wants it — the shooter deciding whether it can see
 * its target at all. A registry on the World would be reachable by all three
 * and would also be one more thing a level teardown has to remember; a module
 * with its own list is reachable by all three, has one `clear()`, and cannot be
 * half-torn-down.
 *
 * ── WHAT SMOKE DOES TO A BOLT, AND WHY IT IS NOT AN ON/OFF WALL ─────────
 *
 * A blaster bolt is a plasma packet, not a photon: it does not stop at smoke,
 * it is degraded by it. So the model is OPTICAL DEPTH — how much cloud the
 * bolt's own path this frame passed through — and everything downstream reads
 * that one number:
 *
 *   · the bolt loses damage exponentially with depth, so a glancing pass
 *     through the edge costs a little and the middle of a bank costs nearly
 *     everything;
 *   · it is deflected slightly, because a scattered bolt should MISS as well
 *     as sting less — a bolt that arrived on target for 3 damage would still
 *     be a hit, and being hit is most of what a player is trying to avoid;
 *   · past `OPAQUE` it is absorbed outright, which is what makes a thick bank
 *     genuinely a wall rather than a tax.
 *
 * IT IS SYMMETRIC BY CONSTRUCTION. Nothing here knows who fired. The player
 * standing in their own smoke is as hard to hit and as blind as the line
 * shooting into it, which is the only version of this that is a decision
 * rather than a free win.
 *
 * ── THE INTEGRAL ────────────────────────────────────────────────────────
 *
 * A cloud is a sphere of uniform density, so the depth a segment takes through
 * one is the length of the segment ∩ sphere — a closed form, no marching. Two
 * overlapping clouds add, which is right: two smoke rounds on the same ground
 * are twice the smoke. Density falls off toward the end of a cloud's life so
 * it thins rather than vanishing, and rises over `BLOOM` at the start so a
 * round that has just landed is not instantly a wall.
 */

import * as THREE from 'three';
import { clamp } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

/**
 * Optical depth per metre through a cloud at full density.
 *
 * Set from the stratagem it exists for: `ASAS` lays an 8.5 m cloud, so a bolt
 * crossing the middle of one travels 17 m of it. At 0.16 that is a depth of
 * 2.7 — `exp(-2.7)` is 6.7% of the damage through, and past `OPAQUE` it is
 * nothing at all. Clipping the edge for 4 m costs 47%. Those two numbers are
 * the whole feel: the middle is cover and the edge is a gamble.
 */
export const DENSITY = 0.16;
/** Past this optical depth a bolt does not come out. See DENSITY. */
export const OPAQUE = 2.2;
/** Seconds a cloud takes to reach full density. A round is not instantly a wall. */
export const BLOOM = 0.9;
/** How much of its remaining life a cloud spends thinning out. */
export const FADE = 0.35;
/**
 * How far a bolt is scattered, in radians per unit of optical depth.
 *
 * Small on purpose. This is not meant to turn shots away from the cloud — it
 * is meant to make a degraded bolt MISS, and at 30 m a milliradian is 3 cm, so
 * 0.06 rad of depth-1 scatter is most of a body's width at range and almost
 * nothing across a room. A bolt fired into smoke at point-blank still hits.
 */
export const SCATTER = 0.06;

/** Every cloud on the field. See the note at the top for why it lives here. */
const clouds = [];

/** How dense a cloud is right now: blooms in, holds, thins out. */
function densityOf(c) {
  const age = c.life0 - c.life;
  const inK = clamp(age / BLOOM, 0, 1);
  const outK = clamp(c.life / (c.life0 * FADE), 0, 1);
  return Math.min(inK, outK);
}

/** Lay one. `life` is seconds; the cloud manages its own bloom and fade. */
export function addSmoke(pos, radius = 8.5, life = 11) {
  clouds.push({ pos: pos.clone(), r: radius, life, life0: life });
  return clouds[clouds.length - 1];
}

export function updateSmoke(dt) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    clouds[i].life -= dt;
    if (clouds[i].life <= 0) clouds.splice(i, 1);
  }
}

/** Nothing outlives a level. One call, so a teardown cannot half-do it. */
export function clearSmoke() { clouds.length = 0; }

/** For the checks and for anything that wants to draw them. Live, not a copy. */
export function smokeClouds() { return clouds; }

/**
 * OPTICAL DEPTH ALONG A SEGMENT — the one question every reader asks.
 *
 * Closed form per cloud: substitute the parametrised segment into the sphere
 * and solve the quadratic for the two crossings, clamp them into [0,1], and
 * the chord is what is left. Summed over clouds, so overlapping banks add.
 *
 * Returns 0 when there is no smoke at all, which is the common case and costs
 * one length check.
 */
export function depthAlong(from, to) {
  if (!clouds.length) return 0;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return 0;
  const len = Math.sqrt(len2);
  let depth = 0;
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    const d = densityOf(c);
    if (d <= 0) continue;
    const ox = from.x - c.pos.x, oy = from.y - c.pos.y, oz = from.z - c.pos.z;
    const b = ox * dx + oy * dy + oz * dz;
    const cc = ox * ox + oy * oy + oz * oz - c.r * c.r;
    const disc = b * b - len2 * cc;
    if (disc <= 0) continue;                    // the line misses the sphere
    const s = Math.sqrt(disc);
    const t0 = clamp((-b - s) / len2, 0, 1);
    const t1 = clamp((-b + s) / len2, 0, 1);
    if (t1 <= t0) continue;                     // the crossing is behind or ahead
    depth += (t1 - t0) * len * DENSITY * d;
  }
  return depth;
}

/**
 * WHAT A LINE OF SIGHT IS WORTH THROUGH THE SMOKE — 1 clear, 0 blind.
 *
 * The same integral read as transmittance rather than as depth, so a shooter
 * asking "can I see it" and a bolt asking "what am I worth when I arrive" are
 * answering out of one model and cannot disagree. Nothing calls this yet — the
 * body brain is another owner's file — and it is here rather than in the
 * caller for exactly that reason.
 */
export function seeThrough(from, to) {
  return Math.exp(-depthAlong(from, to));
}
