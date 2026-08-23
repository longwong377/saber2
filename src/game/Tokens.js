/**
 * BATTLEFRONT BORZ — HOW MANY OF THEM MAY BE ATTACKING YOU AT ONCE.
 *
 * ── THE PROBLEM, AND IT GETS WORSE WITH EVERY BODY ADDED ─────────────────
 *
 * Forty men can reach a Jedi standing in a crowd, and today all forty press at
 * once. That is not difficulty, it is noise: a deflection you cannot read, a
 * guard direction that means nothing because there are attacks from every
 * direction, and a fight whose outcome is decided by how many bodies happened to
 * be inside reach rather than by anything the player did. Every increase in
 * density makes it worse, so it has to be answered before density rises.
 *
 * ── THE ANSWER, WHICH IS OLDER THAN THIS GAME ────────────────────────────
 *
 * `Game AI Pro`, Michael Dawe, "Beyond the Kung-Fu Circle": every attack carries
 * a WEIGHT, every target has a CAPACITY, and the sum of the weights currently
 * committed against a target may not exceed it. Requests queue; the head of the
 * queue is considered first; a released token takes a moment to become available
 * again so attackers cannot fire back to back. DOOM (2016) uses the same shape.
 *
 * So the Jedi wading into forty bodies is SURROUNDED BY FORTY AND FACING FOUR.
 * The other thirty-six are still there, still walking, still in the way, still
 * shooting if they have rifles — they are simply not all swinging at once. That
 * is what makes a directional guard mean something and what makes deflection
 * legible rather than a dice roll.
 *
 * ── WHY IT IS NOT A CONSTANT ─────────────────────────────────────────────
 *
 * A fixed capacity reads as scripted: the crowd presses exactly as hard when it
 * is winning as when it is breaking. `capacityFor` scales it with the target's
 * own state — a commander whose line has collapsed is mobbed harder than one
 * standing in a formation — so the number moves for a reason the player can see
 * happening around them.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It does not stop a body MOVING, shooting, or being cut. It gates one thing:
 * whether a body may be committed to a melee attack this frame. A queued body
 * still walks at you, still gets in your way, and is still killed by a sweep —
 * which is the difference between a crowd that is throttled and a crowd that is
 * paused.
 */

/** What one attacker's commitment costs against a target's capacity. */
export const WEIGHT = {
  /* A saber duellist is the expensive one: his attack is the one the player has
   * to read, so two of them is already a hard fight and three is a bad one. */
  saber: 1.0,
  /* A melee droid or a beast is cheaper — its attack is telegraphed and its job
   * is pressure rather than a duel. */
  brute: 0.7,
  /* A butt-stroke from a rifleman who has been walked into contact. Cheap, and
   * it exists so that being surrounded by riflemen still feels like something. */
  jab: 0.45,
};

/**
 * HOW MANY WEIGHT-UNITS MAY BE COMMITTED AGAINST THIS TARGET AT ONCE.
 *
 * 3.0 is the resting number and it is chosen against `WEIGHT`: three sabers, or
 * two sabers and a brute, or four brutes and a jab. Enough that a crowd is
 * genuinely dangerous; few enough that every one of them is a thing the player
 * can point a guard at.
 *
 * It RISES when the target is isolated. A commander standing in his own line has
 * men beside him soaking attention; one who has run two hundred metres ahead of
 * his army has nobody, and the crowd closes. That is not a difficulty curve, it
 * is the same sentence `lineIsUp` makes about ground, said about attention — and
 * it means leaving your line is felt immediately, in the one place a player is
 * guaranteed to be looking.
 */
export const BASE_CAPACITY = 3.0;
export const ISOLATED_CAPACITY = 4.5;
/** How long a released token stays spent, so attacks cannot chain instantly. */
export const TOKEN_COOLDOWN = 0.55;
/** How many friendly bodies within `FRIEND_NEAR` count as "not isolated". */
export const FRIEND_NEAR = 14;

export function capacityFor(target, world) {
  if (!target) return BASE_CAPACITY;
  /* Isolation is read off the same radius everything else in this game reads —
   * `MORALE.NEAR` is 14 m and so is this. One distance, learned once. */
  let friends = 0;
  const team = target.team;
  for (const e of (world?.enemies || [])) {
    if (e.dead || e.team !== team) continue;
    const dx = e.position.x - target.position.x, dz = e.position.z - target.position.z;
    if (dx * dx + dz * dz <= FRIEND_NEAR * FRIEND_NEAR) { friends++; if (friends >= 3) break; }
  }
  return friends >= 3 ? BASE_CAPACITY : ISOLATED_CAPACITY;
}

/**
 * THE LEDGER. One per world.
 *
 * Keyed by target, holding the bodies currently committed against it and what
 * each is costing. A body asks once, holds until it releases, and cannot ask
 * again until its cooldown has run.
 */
export class TokenPool {
  constructor() {
    /** @type {Map<object, {held: Map<object, number>, spent: Map<object, number>}>} */
    this.rings = new Map();
  }

  _ring(target) {
    let r = this.rings.get(target);
    if (!r) { r = { held: new Map(), spent: new Map() }; this.rings.set(target, r); }
    return r;
  }

  /** What is committed against this target right now. */
  load(target) {
    const r = this.rings.get(target);
    if (!r) return 0;
    let n = 0;
    for (const w of r.held.values()) n += w;
    return n;
  }

  /** Is this body already holding a token against this target? */
  holds(target, body) {
    return !!this.rings.get(target)?.held.has(body);
  }

  /**
   * Ask to attack. Returns true if the body may commit this frame.
   *
   * A holder is answered yes without re-charging — asking twice is what a brain
   * does every frame it is still attacking, and it must not cost twice.
   */
  request(target, body, weight, world) {
    if (!target || !body) return true;
    const r = this._ring(target);
    if (r.held.has(body)) return true;
    if (r.spent.has(body)) return false;              // still cooling down
    const cap = capacityFor(target, world);
    if (this.load(target) + weight > cap) return false;
    r.held.set(body, weight);
    return true;
  }

  /** Give it back. The cooldown starts here. */
  release(target, body) {
    const r = this.rings.get(target);
    if (!r || !r.held.has(body)) return;
    r.held.delete(body);
    r.spent.set(body, TOKEN_COOLDOWN);
  }

  /** Drop everything this body holds, anywhere — for a death or a despawn. */
  forget(body) {
    for (const r of this.rings.values()) { r.held.delete(body); r.spent.delete(body); }
  }

  /**
   * One frame. Runs the cooldowns down and retires rings whose target is gone.
   *
   * A dead or missing target's ring is dropped whole rather than drained: the
   * bodies in it are about to ask about somebody else, and carrying their
   * cooldowns across would make the first attack on a new target arbitrarily
   * late for reasons nothing on screen explains.
   */
  update(dt) {
    for (const [target, r] of this.rings) {
      if (!target || target.dead || target.alive === false) { this.rings.delete(target); continue; }
      for (const [body, t] of r.spent) {
        const left = t - dt;
        if (left <= 0) r.spent.delete(body); else r.spent.set(body, left);
      }
      for (const body of r.held.keys()) {
        if (body.dead || body.alive === false) r.held.delete(body);
      }
    }
  }
}
