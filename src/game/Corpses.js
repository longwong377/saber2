/**
 * BATTLEFRONT BORZ — how many of the dead the field is allowed to keep.
 *
 * Player note #15, second half: "sometimes for fun I'll spawn like 30 enemies
 * and then it gets really really laggy, framerate probably <10 once there are
 * that many DEAD AND ALIVE enemies on the map."
 *
 * They named the dead, and the dead were the half nothing in this repo had
 * ever counted. Measured with tools/_crowd.mjs — thirty acolytes on the
 * colosseum, alive, then the same thirty killed:
 *
 *                    meshes    triangles   rigid bodies   simulation
 *     empty             261    1 052 425              3      5.30 ms
 *     30 alive        2 713    1 392 673             33      6.76 ms
 *     30 DEAD         2 690    1 388 671            573     11.46 ms
 *
 * A corpse costs 11 208 triangles and 81 meshes against a live body's 11 342
 * and 81.7 — it keeps essentially everything — and it costs SEVENTEEN TIMES
 * the rigid bodies, because a ragdoll is nineteen loose bodies with colliders
 * and joints where a walking enemy is one capsule. Thirty corpses simulate
 * nearly twice as slowly as thirty live enemies fighting you.
 *
 * And nothing ever removed them. `grep -rn corpse src/` before this file
 * returned eight comments and no budget. A forty-wave run kills several
 * hundred bodies, every one of which stayed on the field with its meshes, its
 * materials and its nineteen colliders until the level unloaded.
 *
 * ── WHY A BUDGET AND NOT A TIMER ────────────────────────────────────────
 *
 * A timer ("corpses last 30 seconds") is the obvious design and it is wrong
 * twice. It deletes the evidence of a fight you are still standing in — the
 * pile you just cut down is the best thing on the screen — and it does not
 * bound anything, because thirty bodies can die inside one second.
 *
 * A budget bounds the cost exactly, and it spends what it has on the corpses
 * that are WORTH keeping. `worth()` below is the whole design: what is near
 * you, what is in front of you, and what died recently outranks what is
 * behind you at forty metres. So the heap at your feet stays and the one you
 * walked away from two rooms ago goes.
 *
 * ── WHAT "RETIRING" MEANS, in order of how much it takes away ───────────
 *
 * Retirement is graded rather than binary, because the expensive parts of a
 * corpse are not the parts you look at:
 *
 *   1. SETTLE — the ragdoll has stopped moving, so its nineteen rigid bodies
 *      are removed from the physics world and the meshes are frozen where
 *      they lie. This is most of the cost (573 bodies → 33) and takes NOTHING
 *      off the screen. Every corpse gets this; it is not rationed.
 *   2. SINK — past the budget, the oldest and least worthy fade and are
 *      disposed. This is the only step that removes anything visible, and it
 *      is deliberately last.
 *
 * So the budget is a budget on what is DRAWN, and the simulation cost is
 * gone for everybody regardless of it.
 */

import * as THREE from 'three';

/**
 * The one vector this file owns. `Actor.centre` writes into what it is handed,
 * and a corpse is asked where it is once a frame — so one module scratch, not
 * an allocation per corpse per frame.
 */
const _c = new THREE.Vector3();

/**
 * How many corpses stay on the field, per fidelity tier.
 *
 * Derived from the measurement above rather than chosen: a corpse is ~11 200
 * triangles and ~81 meshes, and `world-immersion` holds a level to 520 draw
 * calls with the level's own dressing already spending 200-400 of them. Twenty
 * corpses is ~224 000 triangles and 1 620 meshes — which is a fifth of the
 * empty colosseum's own triangle count and a real but affordable share of the
 * budget, at a number high enough that a whole wave's dead is still on the
 * floor when the next wave walks in.
 *
 * The low tier is not a smaller taste, it is the same argument at a smaller
 * budget: `QUALITY.low` exists for machines that were already struggling, and
 * this is the single biggest lever that does not change what the game looks
 * like while you are fighting.
 */
export const CORPSE_BUDGET = { low: 6, medium: 12, high: 20, ultra: 28 };

/** How long a retired corpse takes to fade, in seconds. */
const SINK_TIME = 1.1;

/**
 * How still a ragdoll has to be, and for how long, before its bodies are
 * taken out of the physics world.
 *
 * ── THE TEST THAT WAS HERE COULD NOT PASS, AND NOTHING SAID SO ──────────
 *
 * It was `SETTLE_SPEED = 0.05` m/s against `ragdollSpeed`, which is the MAXIMUM
 * over all nineteen of a ragdoll's bodies. Its comment called 4 cm/s "generous"
 * and warned against "waiting for a solver that never quite gets there" — which
 * is exactly what it then did, because one twitching hand holds the maximum up
 * and a corpse has nineteen chances to have one.
 *
 * MEASURED in `theline` on geonosis, seed 7, `high`, 300 frames after 45 s of a
 * real engagement (`tools/_ledger.mjs`): **15 of 21 corpses had never settled**,
 * the oldest 33.7 seconds after it fell, and the physics world carried 386 rigid
 * bodies of which 383 were awake and 269 joints — against 40 living enemies. The
 * fastest bone of each unsettled corpse, sorted:
 *
 *     0.03  0.20  0.25  0.26  0.27  0.28  0.56  1.11  1.24  1.72  2.26  3.76
 *     4.00  5.74  108.37   m/s
 *
 * The cluster at 0.20-0.28 is the defect in one line: five bodies lying on the
 * ground, going nowhere, reading five times the threshold for ever. And the
 * consequence is the largest single line in the frame ledger — `physics` was
 * **47% of `world.update`**, spent almost entirely on the dead.
 *
 * ── THE TEST NOW, AND WHY IT IS A DISPLACEMENT AND NOT A SPEED ──────────
 *
 * How far the body's CENTRE has moved, over how long. A verlet-ish solver
 * settling a nineteen-body articulation leaves residual velocity that averages
 * to nothing: a bone jittering in place reads 0.25 m/s and travels 0. Net
 * displacement is the quantity that actually distinguishes "lying in the sand"
 * from "sliding down a slope", and it is the same quantity `RapierWorld._stepOnce`
 * already uses for its own sleep decision (`SLEEP_MOVE` / `SLEEP_TURN`) — so
 * this is not a second opinion about rest, it is the existing one applied to
 * the body rather than to each bone.
 *
 * `SETTLE_MOVE` is 6 cm, which is under the width of a hand: nothing a player
 * can see a corpse do. `SETTLE_HOLD` is unchanged and still means what it
 * always did — it stops a body being shoved by a crowd from settling mid-shove.
 *
 * ── AND A CAP, BECAUSE THERE WAS NO UPPER BOUND AT ALL ──────────────────
 *
 * Stillness was the ONLY route out. A body that never stops — the 108 m/s
 * reading above is one falling off the world, and a corpse wedged under a
 * walker's foot is the commoner case — simulated for as long as the budget kept
 * it, which on a busy field is minutes. `SETTLE_CAP` bounds that: past it a
 * corpse stops being simulated whatever the solver thinks.
 *
 * A corpse that reaches the cap still MOVING is sunk rather than frozen, and
 * that distinction is the only reason the cap is safe to have. Freezing a body
 * mid-tumble stops it dead in the air, which is the one thing a player would
 * see; fading it out over `SINK_TIME` is what the budget already does to a
 * corpse it cannot afford, and it looks like what it is. Twelve seconds because
 * that is comfortably past every settle this was measured making (the slowest
 * real one took 4.1 s) while still being a bound.
 */
const SETTLE_MOVE = 0.06;
const SETTLE_HOLD = 0.75;
const SETTLE_CAP = 12.0;

/**
 * Kept because it is the honest name for "is this thing still travelling", and
 * the cap above asks exactly that once. It is no longer the settle test.
 */
const MOVING_AT = 0.5;

/**
 * The field's undertaker.
 *
 * One per world. It is handed corpses as they are made and given a frame at a
 * time; it owns nothing else and reads nothing off the world but the player's
 * position and facing, which is what `worth` is computed against.
 */
export class Corpses {
  constructor(world, opts = {}) {
    this.world = world;
    this.budget = opts.budget ?? CORPSE_BUDGET.high;
    /** @type {{e:object, t:number, still:number, settled:boolean, sink:number}[]} */
    this.list = [];
    this.settled = 0;
    this.retired = 0;
    /** How many corpses the cap had to end, rather than stillness. */
    this.capped = 0;
  }

  /** A body has died. It is ours now. */
  take(enemy) {
    if (!enemy || this.list.some((c) => c.e === enemy)) return;
    /* `mark` is where the body's centre was when the current still window
     * opened — see SETTLE_MOVE. Allocated with the record and never again. */
    this.list.push({ e: enemy, t: 0, still: 0, settled: false, sink: 0,
      mark: new THREE.Vector3(), marked: false });
  }

  /**
   * WHAT A CORPSE IS WORTH KEEPING, and it is the whole of the design.
   *
   * Three terms, and each answers a way the naive versions get it wrong:
   *
   *   RECENCY — a body that fell a second ago is the one the player is
   *     looking at. Without it the budget evicts the kill you just made
   *     because it happens to be furthest away, which reads as bodies
   *     vanishing under your blade.
   *   NEARNESS — 1/(1+d) rather than a cliff, so there is no radius at which
   *     corpses pop.
   *   IN FRONT — a corpse behind you cannot be seen and is the cheapest thing
   *     to spend. Half weight rather than zero, because turning round should
   *     not find an empty floor.
   */
  worth(c, eye, fwd) {
    const p = c.e.position;
    if (!p) return 0;
    const dx = p.x - eye.x, dz = p.z - eye.z;
    const d = Math.hypot(dx, dz);
    const near = 1 / (1 + d * 0.08);
    const recent = 1 / (1 + c.t * 0.35);
    const ahead = d > 0.001 ? (dx * fwd.x + dz * fwd.z) / d : 1;
    return near * recent * (ahead > 0 ? 1 : 0.5);
  }

  update(dt) {
    if (!(dt > 0)) return;
    const p = this.world.player;
    const eye = p ? p.position : { x: 0, y: 0, z: 0 };
    const fwd = p && p.aimDir ? p.aimDir : { x: 0, z: -1 };

    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const e = c.e;
      if (!e || e.disposed || !e.dead) { this.list.splice(i, 1); continue; }
      c.t += dt;

      /* ── 1. SETTLE. Free, unrationed, and where the simulation cost is. */
      if (!c.settled) {
        const a = e.actor;
        if (!a || !a.ragdolled) {
          /* Nothing to simulate: a body that never ragdolled is already as
           * settled as it is going to get, and the old speed test answered 0
           * for it and settled it on the next frame. Same outcome, said once. */
          c.still += dt;
        } else {
          a.centre(_c);
          if (!c.marked) { c.mark.copy(_c); c.marked = true; }
          if (_c.distanceToSquared(c.mark) > SETTLE_MOVE * SETTLE_MOVE) {
            c.still = 0;
            c.mark.copy(_c);
          } else c.still += dt;
        }
        if (c.still > SETTLE_HOLD) {
          if (a?.freeze) a.freeze();
          else if (a?.ragdolled) sleepBodies(a, this.world);
          c.settled = true;
          this.settled++;
        } else if (c.t > SETTLE_CAP) {
          /**
           * THE CAP. A corpse gets twelve seconds of solver and no more.
           *
           * Which of the two endings it gets depends on whether it is still
           * travelling, for the reason the note over SETTLE_CAP gives: a body
           * that has stopped is frozen where it lies and nothing on screen
           * changes, and a body still in motion is faded out rather than
           * stopped dead in view.
           */
          if (a?.ragdolled && ragdollSpeed(a) > MOVING_AT) {
            if (c.sink <= 0) { c.sink = SINK_TIME; this.capped++; }
          } else {
            if (a?.freeze) a.freeze();
            else if (a?.ragdolled) sleepBodies(a, this.world);
            c.settled = true;
            this.settled++;
            this.capped++;
          }
        }
      }

      /* ── 2. SINK, once one has been chosen. */
      if (c.sink > 0) {
        c.sink -= dt;
        const k = Math.max(0, c.sink / SINK_TIME);
        fade(e, k);
        if (c.sink <= 0) {
          try { e.dispose?.(); } catch { /* a corpse that cannot be disposed is still gone from here */ }
          this.list.splice(i, 1);
          this.retired++;
        }
      }
    }

    /* ── 3. and only then, the budget. Chosen once a frame over the whole
     * list rather than at the moment of death, because worth changes as the
     * player moves and the right corpse to spend is the right one NOW. */
    const live = this.list.filter((c) => c.sink <= 0);
    if (live.length > this.budget) {
      live.sort((a, b) => this.worth(a, eye, fwd) - this.worth(b, eye, fwd));
      for (let i = 0; i < live.length - this.budget; i++) live[i].sink = SINK_TIME;
    }
  }

  /** Everything, at once — a level change. */
  clear() { this.list.length = 0; }
}

/** The fastest bone in a ragdoll, which is how still the whole thing is. */
function ragdollSpeed(actor) {
  let m = 0;
  if (!actor.bodies) return 0;
  for (const b of actor.bodies.values()) {
    const v = b.velocity;
    if (!v) continue;
    const s = v.x * v.x + v.y * v.y + v.z * v.z;
    if (s > m) m = s;
  }
  return Math.sqrt(m);
}

/**
 * Take a settled ragdoll's bodies out of the physics world.
 *
 * Fallback for an actor with no `freeze` of its own. The meshes are left
 * exactly where they are — this removes the SIMULATION and nothing else,
 * which is the whole point of separating settling from retirement.
 */
function sleepBodies(actor, world) {
  const phys = world.physics;
  if (!phys || !actor.bodies) return;
  for (const b of actor.bodies.values()) {
    b.invMass = 0;
    b.velocity?.set?.(0, 0, 0);
    if (typeof phys.remove === 'function') { try { phys.remove(b); } catch { /* already gone */ } }
    else if (Array.isArray(phys.bodies)) {
      const i = phys.bodies.indexOf(b);
      if (i >= 0) phys.bodies.splice(i, 1);
    }
  }
  actor.slept = true;
}

/** Fade every material a corpse owns. `k` runs 1 → 0. */
function fade(enemy, k) {
  const root = enemy.rig?.root || enemy.group || enemy.actor?.root;
  if (!root) return;
  root.traverse?.((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (!m.transparent) { m.transparent = true; m.depthWrite = true; }
      m.opacity = k;
    }
  });
}
