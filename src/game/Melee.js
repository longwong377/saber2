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
  const m = { speed: 1, chain: 1, damage: 1, impulse: 1, stamina: 1, reach: 1, stagger: 1 };
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
    return m;
  }
  const has = (id) => (src.has ? src.has(id) : (Array.isArray(src) ? src.includes(id) : !!src[id]));
  for (const f of FACETS) {
    if (!has(f.id)) continue;
    for (const k of Object.keys(m)) if (f[k] !== undefined) m[k] *= f[k];
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
export function strike(player, mods = null) {
  const set = player._melee || (player._melee = new MeleeSet());
  if (set.busy) return null;
  if (player.saber?.lit) return null;
  if ((player.stamina ?? 0) < MIN_STAMINA) return null;

  const m = mods || meleeMods(player.boonMods || player.takenBoons || player.world?.takenBoons);
  /* The chain, if the window is still open; the opener otherwise. */
  const name = (set.chain && set.chainT > 0) ? set.chain : 'jab';
  const M = MOVES[name];
  if (!M) return null;

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
     * from a bolt. Nothing here reaches the slicer, so nothing comes off. */
    _tgt.copy(e.position); _tgt.y += (e.hipHeight ?? 0.95) * 0.6;
    const dealt = e.damage?.(M.damage * mods.damage, _tgt, player, 'melee');

    /* KNOCKBACK, and it is the thing V15 asks for by name. Along the strike,
     * with a lift in it so a body goes over rather than sliding — `addShove`
     * is the same door a blast uses and it bounds its own sum, so three
     * strikes in a second cannot launch anybody into orbit. */
    if (e.body) {
      _imp.copy(_q).multiplyScalar(M.impulse * mods.impulse);
      _imp.y += M.lift * M.impulse * mods.impulse;
      addShove(e.body, _imp);
    }
    /* …and it STAGGERS, which is what separates the heavy end of the chain
     * from the light. A jab does not; a roundhouse does. */
    if (M.stagger > 0 && e.duel?.stagger) {
      try { e.duel.stagger(M.stagger * mods.stagger, _q, 1.0); } catch {}
    }
    if (dealt !== false) hits++;
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
 * Called AFTER the animator, so the gait has already put the body where it is
 * and this overrides one limb of it — the same order `applySalute` uses.
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
 * What the HUD says while the blade is down. One line, and it is the chain —
 * a player who cannot see the chain cannot use it.
 */
export function meleePrompt(player) {
  const set = player?._melee;
  if (!set) return null;
  if (set.move) return MOVES[set.move].label;
  if (set.chain && set.chainT > 0) return `→ ${MOVES[set.chain].label}`;
  return null;
}
