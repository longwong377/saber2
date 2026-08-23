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
 * HOW MUCH THE WEATHER IS WORTH, as optical depth per metre of air.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE STORM WAS ALREADY BUILT AND NOBODY COULD SEE IT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * PLAN.md §4.7 prices weather as "entirely unbuilt, five systems each of which
 * rewrites sight tests on both sides". Half of that is wrong and it is the
 * expensive half: `src/world/Scenery.js` ships a full `Weather` — squalls on a
 * period, an asymmetric envelope, a gust front that sweeps across the field, a
 * fog gain, a wind gain, a sun loss, a GLSL twin for the wall — and every one
 * of the seven grounds authors one (peaks 0.52 to 1.0). What was missing was
 * not the storm. It was that **nothing in the game ever asked whether you could
 * see through it**: the frame went brown, the visibility number went from 198 m
 * to 43 m, and every rifle on the field went on acquiring targets at ninety
 * metres as if the air were clear.
 *
 * So this is the whole of weather-as-a-rule: ONE number, written by the storm
 * that already exists, read by the model that already decides what a shooter
 * can see and what a bolt is worth when it arrives. There is no `Weather.js`
 * and there must not be one — a second storm beside the drawn one is two
 * answers to "how bad is it out there".
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY IT IS THE ADDED DENSITY AND NOT THE FOG
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every level authors a base fog for how it LOOKS — 0.0035 to 0.0050, a
 * half-light range of 170 to 240 m — and gating sight on that would silently
 * re-tune every archetype's band on every ground for the sake of a feature
 * about weather. So what bites is only what the SQUALL adds. In calm air the
 * term is zero and nothing anywhere behaves differently from the day before
 * this existed; at the peak of the dune sea's front it is 0.025, which is the
 * whole difference between a clear day and a brown-out.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AND A MAN IS HARDER TO PICK OUT THAN A HILLSIDE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Weather.visibility` is a half-light distance: how far a SURFACE keeps half
 * its light. That is a fact about a hillside filling the frame, and spotting a
 * man-sized target in blowing dust is a contrast problem that goes first —
 * which is why every real visibility standard quotes a different range for a
 * light, a landmark and a person. `SPOT_HARDER` is that ratio and it is the
 * one number this file invents: at 3, the peak of the dune sea's squall takes
 * a shooter's acquisition from ninety metres to about twenty, which is
 * PLAN.md's "kills ranged fire both ways" and is what the drawn frame at that
 * moment looks like it should do.
 */
export const SPOT_HARDER = 3;

/**
 * The live air, in optical depth per metre. Written once a frame by
 * `Scenery._applyWeather` — the one place that already knows both the fog the
 * level authored and the fog the storm is running — and zero everywhere else,
 * including every mode, level and check that never builds scenery.
 */
let air = 0;

/**
 * SET THE AIR. `extraDensity` is the exp2 fog density the squall has ADDED to
 * what the level authored.
 *
 * The conversion is one line and it is a change of curve, deliberately: the
 * renderer's fog is quadratic in distance (`1 - exp(-(dL)²)`) and this model is
 * Beer–Lambert, linear in depth, because a bolt accumulates depth frame by
 * frame along its own path and only a linear model sums (see `Bolts`' own note
 * on exactly that). The two curves are pinned to the same half-light distance —
 * `sqrt(ln2)/d` — and then divided by `SPOT_HARDER`, so the number this file
 * publishes is "how far a MAN stays visible in the air the frame is drawing".
 */
export function setAir(extraDensity) {
  const d = Math.max(0, extraDensity || 0);
  air = d > 0 ? Math.LN2 / (Math.sqrt(Math.LN2) / d / SPOT_HARDER) : 0;
}

/** What the air is worth per metre right now. 0 in calm air and in every mode. */
export function airDepth() { return air; }

/** Nothing outlives a level, and neither does the weather. See `clearSmoke`. */
export function clearAir() { air = 0; }

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
  if (!clouds.length && air <= 0) return 0;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return 0;
  const len = Math.sqrt(len2);
  /* THE WEATHER IS A CLOUD WITH NO EDGES. It is added here rather than in the
   * two readers because there is exactly one model of "what got through" in
   * this game and a shooter deciding whether it can see and a bolt deciding
   * what it is worth have to be answering out of it. See `setAir`. */
  let depth = air * len;
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
