/**
 * ══════════════════════════════════════════════════════════════════════════
 *  MELEE — hands and feet, for a Jedi with no blade in them
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE ASK, AND EVERY CLAUSE OF IT IS A CONSTRAINT ───────────────────────
 *
 * V15: *"you should have a melee move (combination of kicks and or punches,
 * make it look really cool like kung fu inspired) … imagine a scenario where
 * you've lost your lightsaber or maybe just for the hell of it you only want
 * to run melee and force powers … it obviously shouldn't be nearly as strong
 * as the lightsaber and wouldn't slice through stuff so make sure the
 * effect/physics of the attack make sense in game, it should be blunt damage,
 * and because of that I think it would look good to have noticeable knockback
 * on enemies, obviously uses up more stamina than the lightsaber attacks but
 * can be upgraded to actually be very effective."*
 *
 * Five numbers come straight out of that and they are the whole design:
 *
 *   NOT NEARLY AS STRONG   A saber cut SEVERS. Melee's best strike is 22 and
 *                          takes five to put a trooper down, against one clean
 *                          cut. Nothing here ever calls the slicer.
 *   BLUNT                  `damage(…, 'melee')` and an IMPULSE, never a cut.
 *                          Enemy.damage's shield branch already exempts
 *                          `'melee'`, which is the one place the engine already
 *                          knew blunt was different.
 *   NOTICEABLE KNOCKBACK   `addShove`, the same door a blast uses, at 3.5 to
 *                          13 m/s. A roundhouse puts a trooper on the floor.
 *   MORE STAMINA           5 to 14 a strike. A saber thrust is 6 and a sweep
 *                          costs at most 2.4 — so the cheapest punch costs
 *                          what the most expensive swing does.
 *   UPGRADED TO EFFECTIVE  `LivingForce`'s tree, which is where every other
 *                          piece of the player's power already comes from.
 *
 * ── AND IT NEEDS NO NEW KEY ───────────────────────────────────────────────
 *
 * `thrust` with the blade DOWN is a strike; with the blade lit it is the stab
 * it has always been. That is the pattern this codebase already uses four
 * times over — `Player.js`'s own note names `swap`, `drive`, `hurl` and
 * `throw` — and it is the only pattern `controls.mjs` allows, because a new
 * row in `Bindings.js` has been refused three times.
 *
 * It also says the right thing about the fantasy: **the blade goes down and
 * your hands come up.** You do not press a "melee button"; you put the saber
 * away.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { addShove } from './Enemy.js';
/* The material ladder, for the One Point's machine test. Combat.js owns it and
 * this reads it rather than restating a number. */
import { TOUGHNESS } from './Combat.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SET                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ FIVE STRIKES, AND THEY CHAIN ══════════════════════════════════════════
 *
 * *"kung fu inspired"* is a shape rather than a licence: the chain opens fast
 * and cheap and ends slow and heavy, so a player who keeps pressing is
 * committing further with every press. That is what makes a combination read
 * as a combination rather than as one move repeated.
 *
 *   jab         the opener. Fast, weak, cheap, and it does not commit you.
 *   cross       the other hand, twice the shove.
 *   hook        turns the shoulders in; the first strike that staggers.
 *   roundhouse  the finisher. Slow, expensive, and it puts a body down.
 *   front       the ONE strike outside the chain: a shove, thrown from
 *               standing. It is what you use to make room, not damage.
 *
 * Times are seconds. `wind` is the commitment, `hit` the window the strike is
 * live in, `rec` the recovery you cannot cancel. A strike lands at ONE moment
 * inside `hit` and not across it, so two enemies in the arc are two hits and a
 * body walking through the arc afterwards is not.
 */
export const MOVES = {
  jab: {
    label: 'jab', limb: 'handR', pole: 'armR', joint: 'foreR',
    wind: 0.06, hit: 0.05, rec: 0.13,
    reach: 1.55, arc: 0.55, damage: 9, impulse: 3.5, lift: 0.10, stamina: 5,
    stagger: 0, next: 'cross',
  },
  cross: {
    label: 'cross', limb: 'handL', pole: 'armL', joint: 'foreL',
    wind: 0.08, hit: 0.06, rec: 0.17,
    reach: 1.70, arc: 0.55, damage: 13, impulse: 5.5, lift: 0.12, stamina: 7,
    stagger: 0, next: 'hook',
  },
  hook: {
    label: 'hook', limb: 'handR', pole: 'armR', joint: 'foreR',
    wind: 0.11, hit: 0.07, rec: 0.22,
    reach: 1.60, arc: 0.95, damage: 16, impulse: 7.5, lift: 0.16, stamina: 9,
    stagger: 0.35, next: 'roundhouse',
  },
  roundhouse: {
    label: 'roundhouse', limb: 'footR', pole: 'thighR', joint: 'shinR',
    wind: 0.15, hit: 0.09, rec: 0.34,
    reach: 2.10, arc: 1.35, damage: 22, impulse: 13, lift: 0.34, stamina: 14,
    stagger: 0.9, next: null,
  },
  front: {
    label: 'front kick', limb: 'footL', pole: 'thighL', joint: 'shinL',
    wind: 0.10, hit: 0.07, rec: 0.26,
    reach: 1.95, arc: 0.60, damage: 8, impulse: 11, lift: 0.20, stamina: 8,
    stagger: 0.5, next: null,
  },
  /**
   * ══ THE ONE POINT — V16 Lane E, and it is not part of the chain ═════════
   *
   * *"a two finger death punch type move where you like thrust own your two
   * fingers/poke the enemy in front of you or whereever you're aiming at and
   * it completey dissassembles them just like your regular dissassmble move
   * but with melee … imagine you've like infused your chakra/force into your
   * finger and the effect is so strong it dissassmbles droids."*
   *
   * WHAT MAKES IT SAFE TO EXIST is everything about it that is bad. It is the
   * slowest thing in the set by a factor of two, its recovery is longer than
   * any other strike's whole duration, it costs Force ON TOP of stamina, it
   * has a cooldown nothing else in the set has, and its arc is narrow enough
   * that a moving target is a miss. A player who throws it speculatively is
   * on the floor; a player who throws it into a committed droid deletes it.
   *
   * `disassemble` is the flag `resolve` reads. Against anything with a
   * skeleton it is simply a very heavy blunt strike, which is what a finger
   * driven through a ribcage would be, and the fantasy stays where the fiction
   * put it: the trick works on machines.
   *
   * It is NOT reachable without `melee-point`, which sits two facets past the
   * end of the branch — see `FACETS`.
   */
  point: {
    label: 'the one point', limb: 'handR', pole: 'armR', joint: 'foreR',
    wind: 0.34, hit: 0.06, rec: 0.62,
    reach: 2.05, arc: 0.22, damage: 30, impulse: 16, lift: 0.30, stamina: 22,
    stagger: 1.4, next: null,
    /** Requires this facet, costs this much Force, and cannot be thrown again
     * for this long. No other move carries any of the three. */
    needs: 'melee-point', force: 30, cooldown: 9,
    /** Inorganics come apart. See `resolve`. */
    disassemble: true,
  },
};

export const MOVE_KEYS = Object.keys(MOVES);

/** How long after a strike lands the next press continues the chain. */
export const CHAIN_WINDOW = 0.42;

/**
 * Below this, you cannot throw one. Not a hard block on the whole set — a
 * player who is exhausted can still jab, because a fighter with nothing left
 * still has one arm and the alternative is an input that does nothing.
 */
export const MIN_STAMINA = 4;

/**
 * How long a struck body stays ballistic, before the strike's own `stagger` is
 * added to it. See the knockback note in `resolve`: `Enemy._move` damps a
 * shove away inside 0.2 s on any frame the body is free to steer, so a shove
 * with no window behind it is a number nobody can see. A fifth of a second is
 * the least that reads as taking a punch rather than leaning into one.
 */
export const KNOCK_MIN = 0.2;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE HOLOCRON BRANCH                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ "CAN BE UPGRADED TO ACTUALLY BE VERY EFFECTIVE" ═══════════════════════
 *
 * This is the clause that makes melee a BUILD rather than a fallback, and it
 * is why V15 asks for it in the Holocron: *"perhaps it would be worth updating
 * the holocron and incorporating melee in some way like that would make the
 * most sense right?"* — yes, because the Living Force tree is where every
 * other piece of the player's power already comes from, and a second
 * progression beside it would be a second thing to explain.
 *
 * Four facets, and each buys ONE of the five numbers above. Read through
 * `meleeMods`, which takes whatever the player has woken and answers with
 * multipliers — so a build with none of them is exactly the table above, and
 * `1×` is exact in IEEE float.
 */
export const FACETS = [
  { id: 'melee-form', name: 'Broken Gate', line: 'The set opens faster and the chain holds longer.',
    speed: 1.22, chain: 1.6 },
  { id: 'melee-weight', name: 'Falling Stone', line: 'Every strike hits harder and moves them further.',
    damage: 1.55, impulse: 1.4 },
  { id: 'melee-wind', name: 'Long Breath', line: 'Strikes cost a third less.',
    stamina: 0.66 },
  { id: 'melee-reach', name: 'Open Hand', line: 'You reach further, and what you hit stays down.',
    reach: 1.25, stagger: 1.8 },
  /**
   * ══ AND THE TOP OF THE BRANCH — V16 Lane E ══════════════════════════════
   *
   * Two facets past `melee-reach`, so a fighter reaches them only having built
   * the whole of the Open Hand. Neither multiplies a number in the table
   * above: each one adds a VERB the set did not have, which is what the top of
   * a branch should be — a fifth rank of Falling Stone is more of the same and
   * catching a bolt in your hand is not.
   *
   * `catches` is how many bolts the Still Hand can suspend at once. It is a
   * count and not a multiplier, so `meleeMods` carries it as one.
   */
  { id: 'melee-catch', name: 'The Still Hand', line: 'A bolt stops a foot from your palm, and goes back where it came from.',
    catches: 1 },
  { id: 'melee-point', name: 'The One Point', line: 'One finger, driven through a machine, and the machine comes apart.',
    /* It buys the move. The move's own numbers are in MOVES.point. */
    point: 1 },
];

/**
 * The multipliers a build carries.
 *
 * ── TWO SHAPES, ONE OF WHICH IS THE ONE THE GAME USES ─────────────────────
 *
 * `src` is normally a player's **`boonMods`** — the applied state, which is
 * what the four cards in `Waves.BOONS` multiply and what makes a SECOND rank
 * of `Falling Stone` worth anything. That is the path a real fighter takes.
 *
 * Handed a **set of facet ids** instead it reads the bare table above, which
 * is what a check wants ("what is the whole branch worth?") and what anything
 * holding only a woken set can answer. The two agree at one rank each and
 * diverge above it, on purpose: `grow` is where ranks diminish.
 *
 * Either way an empty build is exactly `1` in every field, and `1` is exact.
 */
export function meleeMods(src) {
  /* `catches` and `point` are COUNTS rather than multipliers and their
   * identity is 0, not 1: a fighter who has not bought the Still Hand catches
   * nothing, and 0 is what "nothing" is. Every other field's identity is 1. */
  const m = { speed: 1, chain: 1, damage: 1, impulse: 1, stamina: 1, reach: 1, stagger: 1,
    catches: 0, point: 0 };
  if (!src) return m;
  /* A boonMods declares every key it owns (see `Player.defaultBoonMods`), so
   * one of them being a number is what tells the two shapes apart.
   *
   * READ BY NAME, one line each, rather than through a key table. A computed
   * lookup is invisible to `controls.mjs`, whose whole subject is a card that
   * writes a number nothing reads — and a table that can only be checked by
   * running it is the shape that check exists to refuse. `?? 1` states the
   * identity at the reader as well as at the declaration. */
  if (typeof src.meleeDamage === 'number') {
    const boonMods = src;
    m.speed = boonMods.meleeSpeed ?? 1;
    m.chain = boonMods.meleeChain ?? 1;
    m.damage = boonMods.meleeDamage ?? 1;
    m.impulse = boonMods.meleeImpulse ?? 1;
    m.stamina = boonMods.meleeStamina ?? 1;
    m.reach = boonMods.meleeReach ?? 1;
    m.stagger = boonMods.meleeStagger ?? 1;
    /* The two counts ACCUMULATE rather than multiply — a second rank of the
     * Still Hand catches a second bolt, and 1 x 1 would be one forever. */
    m.catches = boonMods.meleeCatches ?? 0;
    m.point = boonMods.meleePoint ?? 0;
    return m;
  }
  const has = (id) => (src.has ? src.has(id) : (Array.isArray(src) ? src.includes(id) : !!src[id]));
  for (const f of FACETS) {
    if (!has(f.id)) continue;
    for (const k of ['speed', 'chain', 'damage', 'impulse', 'stamina', 'reach', 'stagger']) {
      if (f[k] !== undefined) m[k] *= f[k];
    }
    if (f.catches !== undefined) m.catches += f.catches;
    if (f.point !== undefined) m.point += f.point;
  }
  return m;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  ONE FIGHTER'S STATE                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _d = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _pole = new THREE.Vector3();
/* The Still Hand's own scratch — allocated once with the rest, because the
 * catch runs every frame the hand is up. */
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _r = new THREE.Vector3();

/**
 * The set, as carried by one body. Held on `Player._melee`; nothing else has
 * one, and `Enemy` deliberately does not — an AI that punched would need the
 * whole brain taught a second weapon, and V15 asks for a way for the PLAYER
 * to fight.
 */
export class MeleeSet {
  constructor() {
    /** The move running, or null. */
    this.move = null;
    /** Seconds into it. */
    this.t = 0;
    /** Which move the next press continues into, and how long that lasts. */
    this.chain = null;
    this.chainT = 0;
    /** Has the live frame of this strike already been resolved? */
    this.spent = false;
    /** What the last strike hit, for the HUD and for a check. */
    this.lastHits = 0;
    /** Total strikes thrown and landed this life — the ledger's melee row. */
    this.thrown = 0;
    this.landed = 0;
    /**
     * ── V16 LANE E ────────────────────────────────────────────────────────
     *
     * `caught` are the live bolts suspended at the palm — the pool's own
     * objects, held through `Bolts.holdAt`, not copies. `hold` is how long the
     * hand has been up, and `cool` bills the moves that have a cooldown (only
     * the One Point so far).
     */
    this.caught = [];
    this.hold = 0;
    this.cool = {};
  }

  /** Is a strike running? While it is, movement is committed and input is not read. */
  get busy() { return !!this.move; }

  /** How far through the running strike, 0..1. For the pose. */
  get phase() {
    if (!this.move) return 0;
    const M = MOVES[this.move];
    return Math.min(1, this.t / (M.wind + M.hit + M.rec));
  }

  /** Which of the three parts of a strike we are in. */
  get part() {
    if (!this.move) return 'idle';
    const M = MOVES[this.move];
    if (this.t < M.wind) return 'wind';
    if (this.t < M.wind + M.hit) return 'hit';
    return 'recover';
  }
}

/**
 * Throw one. Returns the move's name, or null if it was refused — and the
 * refusals are as much of the design as the table is:
 *
 *   a strike is already running   you cannot cancel a commitment
 *   the blade is lit              the whole seam: put it away first
 *   no stamina                    below MIN_STAMINA, nothing comes out
 */
export function strike(player, mods = null, want = null) {
  const set = player._melee || (player._melee = new MeleeSet());
  if (set.busy) return null;
  if (player.saber?.lit) return null;
  if ((player.stamina ?? 0) < MIN_STAMINA) return null;

  const m = mods || meleeMods(player.boonMods || player.takenBoons || player.world?.takenBoons);
  /**
   * ── A HAND FULL OF BOLTS THROWS THEM, AND THROWS NOTHING ELSE ──────────
   *
   * The Still Hand and the strike share one key, the same way `thrust` already
   * means two things depending on the blade. Holding bolts is the third
   * meaning and it wins while it is true, because a fighter with a blaster
   * bolt suspended at his palm pressing the punch button means the bolt.
   */
  if (set.caught.length) return release(player, m) ? 'return' : null;

  /* The chain, if the window is still open; the opener otherwise. A caller may
   * NAME a move instead — the One Point is not in the chain and is reached by
   * asking for it, which is what `want` is. */
  let name = (set.chain && set.chainT > 0) ? set.chain : 'jab';
  if (want && MOVES[want]) name = want;
  const M = MOVES[name];
  if (!M) return null;
  /**
   * A MOVE MAY HAVE A PRICE THE CHAIN DOES NOT. `MOVES.point` is the only one
   * so far and it carries all three: a facet that must be woken, Force on top
   * of stamina, and a cooldown. Stated on the row rather than as a branch here,
   * so a second such move is a row.
   */
  if (M.needs && !(m[M.needs.replace('melee-', '')] > 0)) return null;
  if (M.cooldown && (set.cool[name] ?? 0) > 0) return null;
  if (M.force) {
    if ((player.force ?? 0) < M.force) return null;
    player.force -= M.force;
  }
  if (M.cooldown) set.cool[name] = M.cooldown;

  set.move = name;
  set.t = 0;
  set.spent = false;
  set.lastHits = 0;
  set.thrown++;
  set.chain = null;
  set.chainT = 0;
  player.stamina = Math.max(0, player.stamina - M.stamina * m.stamina);
  return name;
}

/**
 * One frame. Advances the running strike, resolves its live moment, and runs
 * the chain window down.
 *
 * ── THE LIVE MOMENT IS A MOMENT ───────────────────────────────────────────
 *
 * A strike resolves ONCE, on the first frame inside its `hit` window, not on
 * every frame of it. Resolving per frame makes damage a function of frame rate
 * — which is the oldest bug in melee combat and the one that turns a 22-damage
 * kick into 130 on a fast machine.
 */
export function stepMelee(player, dt, ctx = null, mods = null) {
  const set = player._melee;
  if (!set) return;
  if (set.chainT > 0) set.chainT = Math.max(0, set.chainT - dt);
  /* The cooldowns, which only the One Point has so far. Ticked whether or not
   * a strike is running, because a cooldown that only ran down while you were
   * punching would never run down at all. */
  for (const k in set.cool) if (set.cool[k] > 0) set.cool[k] = Math.max(0, set.cool[k] - dt);
  if (!set.move) return;

  const m = mods || meleeMods(player.boonMods || player.takenBoons || player.world?.takenBoons);
  const M = MOVES[set.move];
  const speed = m.speed;
  set.t += dt * speed;

  if (!set.spent && set.t >= M.wind) {
    set.spent = true;
    set.lastHits = resolve(player, M, m, ctx);
    if (set.lastHits) set.landed++;
  }
  if (set.t >= M.wind + M.hit + M.rec) {
    /* The chain opens on the way OUT of the recovery, so a player who presses
     * during it is queuing rather than cancelling. */
    set.chain = M.next;
    set.chainT = M.next ? CHAIN_WINDOW * m.chain : 0;
    set.move = null;
    set.t = 0;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STILL HAND — V16 LANE E                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ A BOLT, STOPPED A FOOT FROM YOUR PALM ═════════════════════════════════
 *
 * *"at higher levels of upgrading melee you can even deflect bolts back
 * (albiet at a much less effective rate and way than with a saber but you can
 * do it) so basically you block with your arm/hand suspending one or more
 * bolts maybe a foot or two away from you and then sending them back … lore/
 * physics whise you are combining the power of the force and your enhanced
 * melee skills to do what the lightsaber does."*
 *
 * ── IT IS NOT A DEFLECTION AND IT MUST NOT BECOME ONE ─────────────────────
 *
 * The blade's deflect is a CONTACT: a sweep meets a bolt, it is graded on a
 * ladder, and the return leaves on the same frame. That is a reflex, it is
 * fast, and it is what a lightsaber is for. This is the opposite in every
 * respect and the player asked for it that way — *"a much less effective rate
 * and way"*:
 *
 *   IT CATCHES, IT DOES NOT RETURN.  The bolt stops and hangs there. Sending
 *     it back is a SECOND press, and between the two you are standing still
 *     with your hand up.
 *   IT CATCHES ONE.  A rank buys one more, to three. A blade answers everything
 *     that reaches it.
 *   IT COSTS BOTH BARS.  Force to hold and stamina to throw, where a deflect
 *     costs neither.
 *   IT IS INACCURATE.  A returned bolt carries `SCATTER` off the aim, so it is
 *     a threat at ten metres and a coin toss at thirty. A blade's return is
 *     graded and can be perfect.
 *
 * So the fantasy lands whole and the blade is still the better tool, which is
 * the entire brief.
 *
 * `Bolts.holdAt` is the mechanism, and it is the SAME mechanism the saber's
 * catch window already uses — a bolt that does not fly, does not hit anything
 * and does not age is a state of the pool, and a second file holding bolts
 * still would be a second answer to what an arrested bolt is.
 */

/** How far in front of the palm a caught bolt hangs. A foot, as asked. */
const CATCH_STAND = 0.34;
/** The cone the hand covers, and how far up the line it can reach. */
const CATCH_ARC = 0.62, CATCH_RANGE = 3.2;
/** Force a second, while the hand is up and holding. */
const CATCH_DRAIN = 9;
/** How wide a returned bolt scatters. A blade's return does not do this. */
const RETURN_SCATTER = 0.085;
/** What a returned bolt costs to throw, on top of what holding it cost. */
const RETURN_STAMINA = 6;

/**
 * ══ WHAT THE ONE POINT IS WORTH AGAINST A MACHINE THAT WILL NOT COME APART ═
 *
 * It is the FALLBACK now and not the move. It used to be the whole of it —
 * `dmg *= 8` and an ordinary `e.damage(...)` — which measured, on a b1, as
 * hp 28 -> -212 with `dead=true` and `actor.severedCount` still 0: a blunt
 * death with nothing off it, on the move whose own brief is *"it completely
 * dissassembles them just like your regular dissassmble move but with melee."*
 * An 8x multiplier wearing the name.
 *
 * So the machine branch now goes through `Player.disassembleBody`, which is
 * the SAME `Enemy.takeCut` path `forceDisassemble` uses, with the same budget
 * off `forceScale`. This number survives for the case that path answers zero —
 * a chassis with no capsules, or a droid already rent to the core — because a
 * finger driven into something that cannot shed a joint still has to land like
 * a truck rather than like a jab.
 */
const DISASSEMBLE = 8;

/**
 * Run the hand for one frame: hold what is held, catch what arrives, and drop
 * everything if the fighter cannot pay for it.
 *
 * `up` is whether the player is asking — the guard input, with the blade down.
 */
export function stepCatch(player, dt, up, mods = null) {
  const set = player._melee || (player._melee = new MeleeSet());
  const m = mods || meleeMods(player.boonMods || player.takenBoons || player.world?.takenBoons);
  const cap = m.catches | 0;
  const pool = player.world?.bolts;
  /* Nothing woken, no pool, or a lit blade: the hand is not a thing that
   * exists. Anything already held is dropped rather than left hanging. */
  if (!cap || !pool || player.saber?.lit) { dropCaught(set); set.hold = 0; return 0; }

  if (set.caught.length) {
    set.hold += dt;
    /* HOLDING COSTS FORCE, and running out is what makes a long hold a
     * decision. The bolts go out rather than dropping live at your feet. */
    player.force = Math.max(0, (player.force ?? 0) - CATCH_DRAIN * dt);
    if ((player.force ?? 0) <= 0) { dropCaught(set); return 0; }
    /* One that has gone stale — a holder that dropped it, a pool reset — is
     * pruned so the count is the count. */
    for (let i = set.caught.length - 1; i >= 0; i--) {
      const b = set.caught[i];
      if (!b.active || !b.held || b.held.hand !== set._hand) set.caught.splice(i, 1);
    }
  } else set.hold = 0;

  if (!up || set.busy || set.caught.length >= cap) return set.caught.length;

  /* THE HAND, as the pool sees it: a point in front of the fighter and a
   * question about whether the hold is still on. One object for the life of
   * the set, because the pool holds the reference. */
  if (!set._hand) {
    set._hand = {
      set, player,
      at(out) {
        const s = this.set, p = this.player;
        if (!s.caught.length || p.saber?.lit) return false;
        const yaw = p.camera?.yaw ?? p.yaw ?? 0;
        const i = s.caught.indexOf(out.__b);
        out.set(p.position.x - Math.sin(yaw) * CATCH_STAND,
          p.position.y + (p.hipHeight ?? 0.95) * 1.15,
          p.position.z - Math.cos(yaw) * CATCH_STAND);
        return true;
      },
    };
  }

  const yaw = player.camera?.yaw ?? player.yaw ?? 0;
  _d.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  const cosArc = Math.cos(CATCH_ARC);
  const eye = _p.copy(player.position); eye.y += (player.hipHeight ?? 0.95) * 1.15;
  for (const b of pool.bolts) {
    if (set.caught.length >= cap) break;
    if (!b.active || b.held) continue;
    /* Hostile fire only. Your own returns must be free to leave, which is the
     * same rule the blade's guards keep. */
    if (b.team === (player.team ?? 0)) continue;
    _v.subVectors(b.pos, eye);
    const dist = _v.length();
    if (dist > CATCH_RANGE || dist < 1e-4) continue;
    _v.multiplyScalar(1 / dist);
    if (_v.dot(_d) < cosArc) continue;
    /* AND IT HAS TO BE COMING AT YOU. A bolt crossing the cone on its way past
     * is not one you caught; it is one you waved at. */
    if (b.vel.lengthSq() > 1e-6 && _v2.copy(b.vel).normalize().dot(_v) > -0.35) continue;
    _r.set((set.caught.length - 1) * 0.09, (set.caught.length % 2) * 0.07, 0);
    pool.holdAt(b, set._hand, _r);
    set.caught.push(b);
  }
  return set.caught.length;
}

/** Throw them all back down the line the fighter is looking. */
export function release(player, mods = null) {
  const set = player._melee;
  if (!set?.caught.length) return 0;
  const pool = player.world?.bolts;
  const yaw = player.camera?.yaw ?? player.yaw ?? 0;
  const pitch = player.camera?.pitch ?? 0;
  const n = set.caught.length;
  player.stamina = Math.max(0, (player.stamina ?? 0) - RETURN_STAMINA * n);
  for (const b of set.caught) {
    if (!b.active || !b.held) continue;
    /* INACCURATE ON PURPOSE — see the header. The scatter is per bolt, so a
     * hand full of three sprays rather than firing a volley. */
    const j = () => (Math.random() * 2 - 1) * RETURN_SCATTER;
    _v.set(-Math.sin(yaw + j()) * Math.cos(pitch), Math.sin(pitch) + j(), -Math.cos(yaw + j()) * Math.cos(pitch));
    pool?.release(b, _v, b.speed || 90);
    /* It is YOURS now, and it can hurt what fired it. `deflected` is what
     * `World._boltHitTest` reads to let a team-1 bolt hit a team-1 body. */
    b.team = player.team ?? 0;
    b.deflected = true;
    b.deflector = player;
    b.owner = player;
  }
  set.caught.length = 0;
  set.hold = 0;
  return n;
}

/** Let go of everything without throwing it. The bolts simply go out. */
function dropCaught(set) {
  if (!set?.caught?.length) return;
  for (const b of set.caught) { b.held = null; b.active = false; }
  set.caught.length = 0;
}

/** How many bolts are hanging at the palm right now. For the HUD and a check. */
export function caughtCount(player) { return player?._melee?.caught?.length || 0; }

/**
 * ══ HAS THIS FIGHTER WOKEN THE ONE POINT? ═════════════════════════════════
 *
 * Asked by `Player._readInput` BEFORE it decides what the attack key means,
 * which is the whole of finding 5. The old wiring asked for the point
 * unconditionally and let `strike` refuse it, and a refused `want` comes back
 * null — so a fighter without the facet who happened to be holding the guard
 * got an attack key that did nothing at all. One reader, here, so the key's
 * meaning and the move's own gate cannot drift apart.
 */
export function hasPoint(player, mods = null) {
  const m = mods || meleeMods(player?.boonMods || player?.takenBoons || player?.world?.takenBoons);
  return m.point > 0;
}

/**
 * WHY THE ONE POINT DID NOT COME OUT, in the player's own units, or null if it
 * did or if there is nothing to say.
 *
 * `_refuse`'s rule — "a bound key that does nothing and does not say why is the
 * same lie as a dead checkbox" — applies hardest to a move with a nine-second
 * cooldown and a 30-Force price, because both of the reasons it refuses are
 * invisible: the bar is on screen but the threshold is not, and the cooldown is
 * on nothing at all. Said HERE rather than in Player.js so the numbers come off
 * `MOVES.point` and cannot be retyped.
 */
export function pointRefusal(player) {
  const set = player?._melee;
  const M = MOVES.point;
  /* Mid-strike is not a refusal, it is a commitment — and it already reads on
   * screen, because the fighter is visibly swinging. */
  if (!set || set.busy) return null;
  const cd = set.cool?.point ?? 0;
  if (cd > 0) return `recovering — ${cd.toFixed(1)}s`;
  if ((player.force ?? 0) < M.force) {
    return `${M.force} Force needed, you have ${Math.round(player.force ?? 0)}`;
  }
  if ((player.stamina ?? 0) < MIN_STAMINA) return 'nothing left to throw it with';
  return null;
}

/**
 * ══ WHAT A STRIKE HITS ════════════════════════════════════════════════════
 *
 * A cone in front of the fighter: everything inside `reach`, inside `arc` of
 * where they are looking, and not behind them. Not a swept capsule off the
 * limb, deliberately — a capsule sweep on a bone that is being IK'd to a
 * target is a test against the animation rather than against the intent, and
 * it makes a strike that visibly connects miss because the pose was a frame
 * behind. The cone is what the player aimed.
 *
 * EVERYTHING IN THE CONE IS HIT. A roundhouse through three troopers hits
 * three troopers, which is what a kick through three troopers should do and is
 * also what makes the heavy end of the chain worth its stamina.
 */
function resolve(player, M, mods, ctx) {
  const world = player.world;
  if (!world) return 0;
  const from = player.position;
  /* Where they are looking, flattened — a strike is thrown at the horizon, not
   * at the sky, however the camera is pitched. */
  const yaw = player.camera?.yaw ?? player.yaw ?? 0;
  _d.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  const reach = M.reach * mods.reach;
  const cosArc = Math.cos(M.arc);
  let hits = 0;

  const list = world.enemies || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e.dead || !e.position) continue;
    /* A resident is a body you can hit — §11 is explicit — so nothing is
     * excluded here by kind. What decides it is `canHarm`, which the damage
     * door asks for itself. */
    _p.copy(e.position).sub(from);
    /* Against the body's middle rather than its feet: a punch thrown at a
     * standing man is thrown at his chest, and a foot-height test misses
     * everything on a step. */
    _p.y -= (e.hipHeight ?? 0.95) * 0.6;
    const dist = _p.length();
    if (dist > reach + (e.radius ?? 0.4)) continue;
    _q.copy(_p); _q.y = 0;
    if (_q.lengthSq() < 1e-6) continue;
    _q.normalize();
    if (_q.dot(_d) < cosArc) continue;

    /* BLUNT. `'melee'` is the kind, and `Enemy.damage`'s shield branch already
     * exempts it — the one place the engine already knew blunt was different
     * from a bolt. Nothing in the CHAIN reaches the slicer, so nothing comes
     * off it; the One Point is the one declared exception and it goes through
     * the Force's own disassembly rather than through a cut. See below. */
    _tgt.copy(e.position); _tgt.y += (e.hipHeight ?? 0.95) * 0.6;
    /**
     * ── AND THE ONE POINT COMES APART A MACHINE ─────────────────────────
     *
     * V16 Lane E: *"if aimed at an inorganic enemy it just one shots most of
     * them probably and looks really cool."* So it is a MULTIPLIER against a
     * machine and not an instant kill flag — a B1 and a remote are deleted, a
     * droideka is nearly, and an AT-TE is very badly hurt and still standing,
     * which is the honest reading of "most of them".
     *
     * WHAT COUNTS AS A MACHINE is the engine's own material ladder and not a
     * list of names: `TOUGHNESS.droid` and above. Measured across every
     * archetype in the tree at the time of writing, that set is exactly the
     * droids and the vehicles — the lowest rung on it, `conscript` at 2.0, is
     * the Conscript DROID — and there are no organic bodies in it at all.
     * `melee.mjs` asserts that, so an organic archetype authored at droid
     * toughness makes a check go red rather than making a finger take a person
     * apart in silence.
     *
     * Against flesh it is simply the heaviest blunt strike in the set, which
     * is what a finger driven through a ribcage would be, and the fiction
     * stays where the fiction put it: the trick works on machines.
     */
    let dmg = M.damage * mods.damage;
    const machine = (e.A?.toughness ?? e.toughness ?? TOUGHNESS.flesh) >= TOUGHNESS.droid;
    /**
     * AND HERE IS WHERE IT ACTUALLY COMES APART. `disassembleBody` is
     * `Player.forceDisassemble`'s own severing loop, lifted so both moves run
     * it: extremities first, legs last, `Enemy.takeCut` with `force: true`, one
     * budget off `forceScale`. Duck-typed rather than imported — Player.js
     * imports this file, so the arrow only points one way, and a fighter that
     * cannot disassemble anything simply does not carry the method.
     *
     * Measured, one press each at default Force power (budget 2), against the
     * flat 0 every one of them read before: 2 joints off a b1 — which is what
     * kills it, at hp 28 -> -4 rather than -212 — 2 off a b2, 2 off a
     * dwarfspider, 2 off a tridroid, 2 off a droideka, and 0 off a clone
     * trooper, which is where the fiction put it.
     *
     * The tridroid was 1 and the droideka read 0 for a whole lane, and
     * `melee.mjs`'s clause could not tell either from a pass, because it
     * asserted `parts > 0`. It asserts the BUDGET per archetype now; the two
     * defects were in `Enemy.js` and are named at their call sites.
     */
    let cut = 0;
    if (M.disassemble && machine) cut = player.disassembleBody?.(e, ctx) ?? 0;
    /* Nothing came away — see DISASSEMBLE. Then it is the heavy blunt strike it
     * always was, and the player is not charged 30 Force for a poke. */
    if (M.disassemble && machine && !cut) dmg *= DISASSEMBLE;
    e.damage?.(dmg, _tgt, player, 'melee');

    /**
     * ══ KNOCKBACK, AND IT IS THE THING V15 ASKS FOR BY NAME ═══════════════
     *
     * *"it would look good to have noticeable knockback on enemies."* Along
     * the strike, with a lift in it so a body goes over rather than sliding —
     * `addShove` is the same door a blast uses and it bounds its own sum, so
     * three strikes in a second cannot launch anybody into orbit.
     *
     * ── IT WAS APPLIED TO THE WRONG OBJECT AND MOVED NOBODY ──────────────
     *
     * This read `addShove(e.body, _imp)`. `e.body` is the enemy's KINEMATIC
     * collision proxy — `Enemy` builds it with `kinematic: true` and copies
     * the enemy's own position into it every frame in `_syncBody` — so a
     * velocity written there is read by nothing and overwritten by the next
     * frame. EVERY OTHER CALLER PASSES THE BODY THAT MOVES: `Enemy.js`'s
     * `applyKnockback` passes `this`, and `Player.js`'s knockback passes
     * `this`. Measured on a real b1 with a roundhouse, driven through
     * `world.update`:
     *
     *   before   the impulse landed on `body.velocity`, `e.velocity` never
     *            moved, displacement over 90 frames 0.00 m
     *   after    2.4 m, and a jab moves a trooper half a metre
     *
     * ── AND A SHOVE ALONE IS ERASED BY THE BODY'S OWN LEGS ───────────────
     *
     * `Enemy._move` damps `velocity` toward its `wish` at rate 8 — or toward
     * zero at 6 with no wish — on every frame `canMove` is true, and `canMove`
     * is `stunTimer <= 0 && knockTimer <= 0`. So a shove with no `knockTimer`
     * behind it is gone inside 0.2 s and the body walks out of it as though
     * nothing had touched it. `knockTimer` is what `applyKnockback` sets for
     * exactly this reason, and it is the same window a blast gets.
     *
     * `KNOCK_MIN` is that window and it is SHORT — a fifth of a second, which
     * is the ride and not the recovery. A window as long as the stagger was
     * tried first and measured: `knockTimer` suppresses the damping entirely,
     * so a roundhouse at 13.6 m/s held for 1.1 s threw a trooper **15.8 m**.
     * That is a launch, not a blow. At 0.2 s the same kick moves him 2.4 m
     * and a jab moves him half a metre, which is what the table's 3.5–13 m/s
     * was authored to mean.
     *
     * ── AND THE STAGGER IS A STUN, WHICH IS WHERE IT STOPPED BEING DEAD ──
     *
     * `M.stagger` used to run only through `e.duel.stagger`, which exists on
     * DUELLISTS — `trooper`, `b1`, `b2`, `clone` and `droideka` all carry
     * `duel.stagger === undefined` — so `roundhouse`'s 0.9 and the whole of
     * the Open Hand's `stagger: 1.8` were inert against every ordinary enemy
     * in the game. `Enemy.stun` is the door that answers for both kinds of
     * body: it holds `stunTimer`, it breaks whatever the guard was holding
     * together, and it hands a duellist its own reel on the way past. One
     * call, so the two cannot come apart, and nothing here has a second idea
     * of what a stagger is.
     */
    if (e.velocity) {
      _imp.copy(_q).multiplyScalar(M.impulse * mods.impulse);
      _imp.y += M.lift * M.impulse * mods.impulse;
      addShove(e, _imp);
      e.knockTimer = Math.max(e.knockTimer ?? 0, KNOCK_MIN);
      e.grounded = false;
      const stagger = M.stagger * mods.stagger;
      if (stagger > 0) { try { e.stun?.(stagger, _q, 1.0); } catch {} }
    }
    /**
     * A BODY IN THE CONE IS A HIT, and the damage call cannot say so.
     * `Enemy.damage` returns TRUE ONLY WHEN THE BLOW KILLS — measured, a jab
     * that took a b1 from 28 to 19 answered `false` — so `dealt !== false`
     * counted a hit only on the frame something died. `set.landed`, the HUD's
     * melee row and `meleePrompt` all read this, and every non-fatal punch in
     * the game reported itself as a miss. What was hit is what the cone
     * caught: everything above this line has already been damaged and shoved.
     */
    hits++;
    /* The hit's report: a thump rather than a hum, and dust rather than
     * sparks. `Impact` is the door every striker in the game already uses. */
    ctx?.hitSpark?.(_tgt, 'blunt');
  }
  return hits;
}

/**
 * ══ THE POSE ══════════════════════════════════════════════════════════════
 *
 * The striking limb is IK'd to a point in front of the fighter, which is the
 * same `solveIK` the saber grip uses — so the arm reaches the way an arm
 * reaches, the elbow goes where an elbow goes, and nothing here has its own
 * idea of anatomy.
 *
 * The target travels: at the wind it is drawn back and low, at the strike it
 * is out at full reach on the aim line, and through the recovery it comes
 * home. Three points and a smooth step between them is a punch; a single
 * keyframe is a hand appearing at arm's length.
 *
 * ── WHERE IT IS CALLED FROM, AND IT WAS THROWN AWAY ON THE SAME FRAME ────
 *
 * Called AFTER the animator, which is what `applySalute` does and for the same
 * reason — the gait puts the body where it is and one limb is then taken off
 * it. That was true and it was not enough. `Player._updateBody` runs two lines
 * after the gait and RE-SOLVES BOTH ARMS onto the hilt every frame, and it had
 * no idea this file existed. Measured, blade down, through a real
 * `world.update`:
 *
 *   poseMelee called alone                  handR travels 0.40 m at once
 *   through a normal frame                  handR travels 0.0032 m
 *   through a frame with the hilt IK stubbed handR travels 0.91 m
 *
 * i.e. THE KICKS ANIMATED AND NOT ONE PUNCH DID, because `_updateBody` only
 * owns the arms. What a player saw on a punch was the saber's own stab
 * envelope with an empty fist in it.
 *
 * So this is called from `_updateBody` itself now, AFTER the spine and the
 * girdle — which are ancestors of the arm, and solving a limb before its own
 * parent is written drags the result off by up to 18 cm, a defect that file
 * already has a paragraph about — and INSTEAD of the hilt solve for whichever
 * limb `strikingPole` names. `stepMelee` stays where it was: advancing the
 * clock and resolving the live moment are not pose work and must not move
 * inside the frame.
 */
export function poseMelee(player, mods = null) {
  const set = player._melee;
  if (!set?.move || !player.rig) return false;
  const M = MOVES[set.move];
  const rig = player.rig;
  const upper = rig.get(M.pole), lower = rig.get(M.joint);
  if (!upper || !lower) return false;

  const m = mods || meleeMods(player.boonMods || player.takenBoons || player.world?.takenBoons);
  const total = M.wind + M.hit + M.rec;
  const u = Math.min(1, set.t / total);
  const wEnd = M.wind / total;
  const hEnd = (M.wind + M.hit) / total;

  /* 0 at rest, 1 at full extension, back to 0. The strike is FAST out and slow
   * back, which is the whole read of a punch: `u**0.4` on the way out. */
  let ext;
  if (u < wEnd) ext = -0.35 * (u / wEnd);                       // drawn back
  else if (u < hEnd) ext = Math.pow((u - wEnd) / (hEnd - wEnd), 0.4);
  else ext = 1 - Math.pow((u - hEnd) / (1 - hEnd), 1.6);

  const yaw = player.camera?.yaw ?? player.yaw ?? 0;
  _d.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  const kick = M.limb.startsWith('foot');
  const shoulderY = (player.hipHeight ?? 0.95) + (kick ? -0.55 : 0.42);
  const side = M.limb.endsWith('L') ? 1 : -1;

  /* The target, in world space: out along the aim by `ext × reach`, at the
   * limb's own height, offset to the limb's own side so a cross crosses. */
  _tgt.copy(player.position);
  _tgt.y += shoulderY + (kick ? ext * 0.45 : 0);
  _tgt.addScaledVector(_d, ext * M.reach * m.reach * 0.82);
  /* A hook swings ACROSS: its target sweeps from outside to inside, which is
   * one term rather than a second animation. */
  const across = M.arc > 0.8 ? (1 - ext) * 0.5 - 0.25 : 0;
  _q.set(-_d.z, 0, _d.x);
  _tgt.addScaledVector(_q, side * (0.22 + across));

  /* The pole: elbows point down and out, knees point forward. */
  _pole.copy(_q).multiplyScalar(side * 0.6);
  _pole.y += kick ? 0.2 : -0.8;
  _pole.add(player.position);
  _pole.y += shoulderY;

  rig.solveIK(M.pole, M.joint, _tgt, _pole);
  return true;
}

/**
 * WHICH LIMB A RUNNING STRIKE OWNS THIS FRAME, or null when none does.
 *
 * The ONE reader is `Player._updateBody`, which must not solve that limb onto
 * the hilt while `poseMelee` is driving it — see the note above. It answers
 * with the bone `MOVES[…].pole` names (`armR`, `armL`, `thighR`, `thighL`), so
 * the table stays the only place that says which limb throws which strike and
 * Player.js does not get a second copy of it.
 */
export function strikingPole(player) {
  const move = player?._melee?.move;
  return move ? MOVES[move].pole : null;
}

/**
 * ══ WHAT THE HUD SAYS WHILE THE BLADE IS DOWN ═════════════════════════════
 *
 * *"a player who cannot see the chain cannot use it"* — this function's own
 * header, written before it had a caller. It had none for two rounds: nothing
 * in `HUD.js` mentioned melee, punch or kick, `caughtCount` was called only by
 * a check, and the binding screen filed the attack key under **Blade** as
 * "Attack (thrust)". A player who never happened to click with the saber down
 * had no way at all to find out the set existed. `HUD._meleePrompt` is the
 * caller now and `melee.mjs` fails if it goes away again.
 *
 * IT ANSWERS EVEN WHEN NOTHING IS HAPPENING, which is the change that makes it
 * teach rather than narrate. Returning null on an idle fighter — which it did —
 * means the line only ever appears to somebody who is already punching.
 *
 * NO KEY NAMES IN HERE. What the player must press is the HUD's business,
 * because a key is a binding and `controls.mjs` refuses a typed one anywhere in
 * `src/`. This says what the hands are doing; the HUD puts the player's own
 * keycaps in front of it.
 */
export function meleePrompt(player) {
  if (!player || player.saber?.lit) return null;
  const set = player._melee;
  /* Before the first punch of a life there is no set at all, and that is
   * exactly the fighter this line is for. */
  if (!set) return 'strike — hands and feet';
  const n = set.caught.length;
  if (n) return n > 1 ? `send ${n} bolts back` : 'send it back';
  if (set.move) return MOVES[set.move].label;
  if (set.chain && set.chainT > 0) return `→ ${MOVES[set.chain].label}`;
  return 'strike — hands and feet';
}
