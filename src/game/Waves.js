/**
 * SABER — wave director and run boons.
 *
 * Waves are budgeted, not scripted: the director spends a threat budget on
 * whatever the level allows, so the composition changes every run and the
 * pressure curve stays honest. Every other wave the Force offers a choice —
 * runs are built, not saved.
 *
 * ── depth, not breadth ────────────────────────────────────────────────────
 *
 * Escalation used to be one number. `budgetFor` grew, a fixed unlock ladder
 * added a type every few waves and then stopped at wave 12, and that was all
 * depth ever changed — so a wave-25 trooper was a wave-2 trooper and wave 25
 * was wave 10 with more bodies. Three things carry it now, and each one has a
 * derivation written next to it rather than a number that felt right:
 *
 *   MODIFIERS   Enemy.MODIFIERS — elite variants applied on spawn, unlocking
 *               with depth and PAID FOR out of the same budget, so an elite
 *               wave is a wave of fewer, nastier bodies rather than a wave that
 *               is secretly three times the threat. See `_promote`.
 *   A BODY CAP  `bodyCap` — the count saturates around wave 18 and everything
 *               the budget can still afford goes on quality instead. At wave 30
 *               the budget is fifty times wave 1's and the body count is eight.
 *   A LADDER    `isBossWave` is a modulus, not a Set that ended at 30, and the
 *               set-piece is a share of the wave rather than one fixed unit.
 *
 * And the player grows with it: twenty-nine boons drafted every second wave,
 * weighted by rarity that moves with depth, with five masteries gated on
 * already having committed to an axis. `budgetFor`'s one constant is derived
 * from that draft rate, because the two are one decision.
 */

import * as THREE from 'three';
import { ARCHETYPES, MODIFIERS, MODIFIER_KEYS, modifierThreat, modifiersFor, applyModifier } from './Enemy.js';
import { segmentSegment } from '../physics/Physics.js';
import { makeRng, clamp, lerp, TAU } from '../engine/MathUtil.js';

const rng = makeRng((Math.random() * 1e9) | 0);

export const MODES = {
  waves:   { name: 'Trial of Waves', blurb: 'Endless escalation. Survive as long as the Force allows.' },
  roguelite: { name: 'Path of the Blade', blurb: 'Waves, boons and a run that ends when you do.' },
  duel:    { name: 'Duel', blurb: 'Acolytes only. No blasters, no crowd. Just blades.' },
  gauntlet: { name: 'Gauntlet', blurb: 'Fixed ladder of set-pieces, ending in a boss.' },
  sandbox: { name: 'Sandbox', blurb: 'You set the numbers. However many droids you say, firing as slowly as you say — including none of either.' },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Sandbox                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Practice was impossible because nothing in the game let you turn the horde
 * DOWN. The lowest difficulty still opens with a wave budget and every unit in
 * it shooting at its archetype cadence, so there was no way to stand in front
 * of one B1 and learn what a returned bolt feels like.
 *
 * The sandbox replaces the wave director's budget with two numbers the player
 * owns: how many enemies are alive, and how fast they shoot. Both go to zero,
 * because an empty arena to move around in is a legitimate practice setting and
 * so is a room full of droids that never pull a trigger.
 */
export const SANDBOX_MAX_ENEMIES = 40;

/**
 * How far out the sandbox drops a new opponent.
 *
 * Close enough to be fighting seconds after moving the slider, far enough that
 * a droideka does not materialise inside your guard. A training droid does not
 * come to you at all — speed 0 — so it goes where you can reach it.
 */
const SANDBOX_RING = [11, 19];
const SANDBOX_RING_INERT = [4.5, 8];

/** Order matters: the practice dummies first, then the things that hurt. */
const SANDBOX_ORDER = ['remote', 'dummy', 'sparring', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker', 'beast'];

/** What the dojo's "mixed" room rotates through — one of each, then repeat. */
export const DOJO_MIX = ['remote', 'dummy', 'sparring'];

function unitBlurb(A) {
  const how = A.inert ? 'stands still and takes it'
    : A.melee ? 'blade'
    : A.custom === 'remote' ? 'one slow bolt at a time'
    : 'blaster';
  return `${how} · ${A.hp} hp · threat ${A.threat}`;
}

/**
 * The archetype picker's rows. Built from ARCHETYPES rather than typed again,
 * so a new droid shows up here the day it is added instead of the day someone
 * remembers this list exists.
 *
 * Lazy, and that is not a style choice. Enemy.js imports Dojo.js (for the
 * remote's body) and Dojo.js imports this file, so whenever Enemy.js is the
 * module that starts the cycle — which is what World.js does, importing
 * Enemy.js one line before Waves.js — this file finishes evaluating while
 * ARCHETYPES is still in its temporal dead zone. Reading it at the top level
 * here is a ReferenceError on boot, not a warning.
 */
let _units = null;
export function sandboxUnits() {
  if (_units) return _units;
  _units = [
    { key: 'mixed', name: 'Mixed', blurb: 'Whatever this theatre fields, in the proportions it fields it.' },
    ...SANDBOX_ORDER.filter(k => ARCHETYPES[k]).map(k => ({
      key: k, name: ARCHETYPES[k].label, blurb: unitBlurb(ARCHETYPES[k]),
    })),
  ];
  return _units;
}

/** Read the practice knobs off a settings blob, clamped and defaulted. */
export function sandboxConfig(settings) {
  const s = settings || {};
  const raw = s.sandboxCount;
  const count = clamp(Math.round(typeof raw === 'number' && isFinite(raw) ? raw : 5), 0, SANDBOX_MAX_ENEMIES);
  const f = s.sandboxFire;
  const fire = clamp(typeof f === 'number' && isFinite(f) ? f : 1, 0, 2);
  const t = s.sandboxType;
  return { count, fire, type: (t === 'mixed' || ARCHETYPES[t]) ? t : 'mixed' };
}

/**
 * Stop an enemy shooting without touching its brain.
 *
 * Every ranged archetype decides to fire the same way — `attackTimer` counts
 * down, hits zero, and queues a burst — so pushing the fuse back up each frame
 * silences a B1, a sniper mid-telegraph, a droideka mid-burst and a training
 * remote with one rule. Zeroing burstLeft matters: a droideka that had six
 * rounds queued when you moved the slider would otherwise finish them.
 */
export function holdFire(e) {
  if (!e) return;
  e.burstLeft = 0;
  e.burstTimer = 0;
  if (!(e.attackTimer > 0.5)) e.attackTimer = 0.5;
  if (e.aimCharge > 0) { e.aimCharge = 0; e._endTelegraph?.(); }
}

/**
 * Slow an enemy down without silencing it.
 *
 * `DIFFICULTY.fireRate` already divides every ranged archetype's cooldown, so
 * the sandbox scales THAT rather than inventing a parallel cadence — bursts,
 * telegraphs and burst gaps all keep their character, only the gaps between
 * volleys stretch. The training remote is the one brain that reads its own
 * `trainingFireRate` instead of the difficulty, so it gets the same factor
 * applied to its period by hand.
 */
export function tuneFireRate(e, fire) {
  if (!e || fire <= 0) return;
  const A = e.A;
  if (A && A.custom === 'remote') e.trainingFireRate = (A.fireRate ?? 2.0) / fire;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The ramp                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The five numbers the escalation is made of, all in one place because they
 * are one decision. See `WaveDirector.budgetFor` for the arithmetic that ties
 * BOON_POWER to DRAFT_EVERY — they are not independent, and moving one without
 * the other is how a difficulty curve drifts.
 */
/** What one average card is worth as a throughput multiplier. */
export const BOON_POWER = 1.05;
/** A draft every this many waves. Was 3; see the note above BOONS. */
export const DRAFT_EVERY = 2;
/** A set-piece every this many waves — forever, not for the first thirty. */
export const BOSS_EVERY = 5;
/** How much of a boss wave's budget the set-piece itself is worth. */
export const BOSS_SHARE = 0.28;
/** From here on, the set-piece arrives promoted. */
export const CHAMPION_FROM = 15;
/** Where the body count stops being the escalation. See `bodyCap`. */
export const BODY_MAX = 42;
export const BODY_KNEE = 18;
export const BODY_CREEP = 1.6;

/**
 * The set-piece ladder, and the depth each rung needs.
 *
 * These are the old director's three hand-written branches — acklay at 20,
 * walker at 10, two acolytes otherwise — written as data so a fourth rung is a
 * line rather than another `else if`, and so a level's `pool` can veto one.
 */
export const SET_PIECE = [
  { type: 'beast', from: 20 },
  { type: 'walker', from: 10 },
  { type: 'droideka', from: 6 },
  { type: 'acolyte', from: 1 },
];

/**
 * Is this archetype one of the big ones?
 *
 * `big` and `boss` are separate flags — a walker is big, an acklay is a boss
 * and is not flagged big — and every rule that wants to limit the number of
 * enormous bodies on the field wants BOTH. Reading only `big` is what let a
 * wave field three acklays under a heavy limit of four.
 */
export function isHeavy(type) {
  const A = ARCHETYPES[type];
  return !!A && (!!A.big || !!A.boss);
}

/** Indices 0..n-1 in a random order — used to pick a queue slot to improve. */
function shuffledOrder(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Spawn entries                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A queued spawn is `"trooper"` or `"trooper|marksman"`.
 *
 * A string rather than a `{type, mod}` pair on purpose. Everything that looks
 * at a composed wave — the checks, a `console.log`, `new Set(spawnQueue)` —
 * gets something it can read and compare; a queue of objects turns "is this
 * wave monotonous?" into a question about object identity, which is always
 * false and therefore always passes. `"b1"` and `"b1|frenzied"` are two
 * different things to fight, and the encoding says so.
 */
export function spawnType(entry) {
  const i = entry.indexOf('|');
  return i < 0 ? entry : entry.slice(0, i);
}
export function spawnMod(entry) {
  const i = entry.indexOf('|');
  return i < 0 ? null : entry.slice(i + 1);
}
/** What one queued body costs the director, elite or not. */
export function spawnCost(entry) {
  const type = spawnType(entry), mod = spawnMod(entry);
  if (mod) return modifierThreat(type, mod);
  return ARCHETYPES[type]?.threat ?? 0;
}

export class WaveDirector {
  constructor(world, opts = {}) {
    this.world = world;
    this.wave = 0;
    this.active = false;
    this.pending = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.intermission = 0;
    this.mode = opts.mode ?? 'roguelite';
    this.pool = opts.pool || ['b1', 'b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte'];
    this.maxAlive = opts.maxAlive ?? 26;
    this.onWaveStart = null;
    this.onWaveClear = null;
    this.onDraft = null;
    this.totalSpawned = 0;
    // sandbox bookkeeping — see _sandboxUpdate
    this._fireApplied = null;
    this._diffBase = null;
  }

  get sandbox() { return this.mode === 'sandbox'; }

  /**
   * THE RAMP, RE-DERIVED — and the derivation is one line of arithmetic, not a
   * feeling about how wave 20 ought to go.
   *
   * The old curve, `4 + 2.6w + 0.65·w^1.62`, was tuned against a run that drew
   * boons every THIRD wave, so a player at wave w held about w/3 of them. The
   * draft now runs every DRAFT_EVERY = 2 waves (see `isDraftWave`, and the note
   * on BOONS about why 10 cards in 30 waves is not a build system), so the same
   * player holds w/2 — that is w/6 extra cards, every one of them multiplying
   * something.
   *
   * BOON_POWER is what one average card is worth as a throughput multiplier.
   * 1.08 is the working figure: the median card in BOONS is a single ~1.2–1.5×
   * on one of cutPower / deflectDamage / moveSpeed / staminaRegen, and no card
   * multiplies more than one axis of the same fight at once, so a run's power
   * compounds far more slowly than its face values suggest. It is stated HERE,
   * as one constant with a name, so that when tools/balance.mjs measures the
   * real per-card value the ramp moves by editing one number rather than by
   * re-tuning a polynomial.
   *
   * Multiply, do not re-fit: the opening is already tuned and 1.08^0 = 1 leaves
   * wave 1 exactly where it was. The extra pressure lands where the extra cards
   * do — ×1.15 at wave 10, ×1.31 at 20, ×1.47 at 30.
   */
  budgetFor(wave) {
    const base = 4 + wave * 2.6 + Math.pow(wave, 1.62) * 0.65;
    return Math.floor(base * Math.pow(BOON_POWER, (wave - 1) / 6));
  }

  /**
   * Set-pieces every fifth wave, FOREVER.
   *
   * This was a literal `Set([5,10,15,20,25,30])` in a mode whose whole promise
   * is "endless escalation" — so wave 35 and everything past it had no boss at
   * all, and the ladder the player had been climbing simply stopped having
   * rungs. A modulus cannot run out.
   */
  isBossWave(wave) { return wave > 0 && wave % BOSS_EVERY === 0; }

  /** A draft every other wave; boss waves are the big ones. See BOONS. */
  isDraftWave(wave) { return wave > 0 && wave % DRAFT_EVERY === 0; }
  draftSize(wave) { return this.isBossWave(wave) ? 4 : 3; }

  unlockedAt(wave) {
    const list = ['b1'];
    if (wave >= 2) list.push('b1', 'trooper');
    if (wave >= 3) list.push('b2');
    if (wave >= 4) list.push('sniper');
    if (wave >= 6) list.push('droideka');
    if (wave >= 7) list.push('acolyte');
    if (wave >= 12) list.push('walker');
    return list.filter(t => this.pool.includes(t));
  }

  /**
   * Which elite variants the depth has earned, and how often one shows up.
   *
   * This governs the FILL — the bodies the budget buys outright — and it is
   * capped well under half on purpose: an elite is a body you have to fight
   * DIFFERENTLY, and while a wave is still mostly about crowd control, most of
   * it should be crowd. Past the body cap (`bodyCap`, biting around wave 18)
   * `_upgrade` promotes on top of this, because at that point promotion is the
   * only thing left to spend on — so the measured elite share climbs from 0 at
   * wave 2 through ~45% at wave 20 to nearly all of it past wave 35. That is
   * the intended shape: late waves are not larger crowds, they are elite ones.
   */
  modifiersAt(wave) {
    return MODIFIER_KEYS.filter(k => wave >= MODIFIERS[k].since);
  }
  eliteChance(wave) { return clamp((wave - 2) * 0.022, 0, 0.40); }

  /**
   * HOW MANY BODIES A WAVE MAY BE, AND WHY THAT IS NOT THE BUDGET.
   *
   * The old director spent its whole budget on bodies, so escalation had
   * exactly one shape: more of them. Wave 30 was 58 units and wave 40 would
   * have been 121 — and `maxAlive` is 26, so past about forty queued the wave
   * stops being a fight and becomes a conveyor: twenty-six on the field and a
   * queue behind them feeding in one at a time for half a minute.
   *
   * So the count SATURATES at BODY_MAX — about 1.6 times what can be alive at
   * once, which is one full field plus a relief wave — and everything the
   * budget can still afford past that point is spent on QUALITY instead:
   * `_upgrade` promotes plain bodies to elites and trades light archetypes for
   * heavy ones until the budget is gone.
   *
   * The crossover lands around wave 18, which is where it should: up to there a
   * run is learning to handle a crowd, and after it the crowd stops growing and
   * starts getting better.
   */
  bodyCap(wave) {
    const knee = BODY_MAX - (BODY_MAX - 6) * Math.exp(-wave / 12);
    // Past the knee the count still creeps, because an endless mode must be
    // able to absorb an endless budget: threat per body is bounded by the
    // roster (nothing costs more than a shielded walker), so if the count
    // stopped dead the difficulty would stop with it and a run would never end.
    // It creeps at about one body a wave against a budget growing by twelve,
    // which is the whole statement: the extra pressure lands on quality.
    return Math.round(knee + Math.max(0, wave - BODY_KNEE) * BODY_CREEP);
  }

  /**
   * How hard the type pick leans on the heavy end of the roster.
   *
   * Type UNLOCKS stop at wave 12 — nothing new is ever fielded again — so
   * without this the mix at wave 30 is the mix at wave 12 and the only thing
   * depth changes is the count. Weighting each archetype by `threat^bias` with
   * a bias that climbs from 0 turns the same roster into a different army: at
   * wave 5 the field is B1s and troopers with the occasional heavy, at wave 25
   * it is droidekas, acolytes and walkers with the occasional B1.
   */
  heavyBias(wave) { return clamp((wave - 4) * 0.035, 0, 0.9); }

  /** How many `big` units a wave may field — a walker is 66 meshes. */
  heavyLimit(wave) { return 1 + Math.floor(wave / 10); }

  _pickType(types, wave, bigLeft) {
    const bias = this.heavyBias(wave);
    let total = 0;
    const w = types.map((t) => {
      const A = ARCHETYPES[t];
      if (!A || (isHeavy(t) && bigLeft <= 0)) return 0;
      const x = Math.pow(Math.max(A.threat, 0.5), bias);
      total += x;
      return x;
    });
    if (total <= 0) return null;
    let r = rng() * total;
    for (let i = 0; i < types.length; i++) { r -= w[i]; if (r <= 0) return types[i]; }
    return types[types.length - 1];
  }

  /**
   * Spend what the body cap left over on making the bodies worse.
   *
   * Two moves, tried in that order: promote a plain body to an elite, or trade
   * a light archetype for the heaviest one that fits. Both keep the queue the
   * same LENGTH — that is the whole point — and both cost exactly the threat
   * difference, so the wave's total spend still cannot exceed its budget.
   *
   * @returns the budget left after upgrading, which is stranded on purpose:
   *          it is what the wave could not turn into anything worth fighting.
   */
  _upgrade(queue, budget, wave, allowed) {
    let guard = 0;
    while (budget > 0 && guard++ < 300) {
      const spent = this._promoteOne(queue, budget, wave, allowed) || this._heavierOne(queue, budget, wave);
      if (!spent) break;
      budget -= spent;
    }
    return budget;
  }

  _promoteOne(queue, budget, wave, allowed) {
    if (!allowed.length) return 0;
    for (const i of shuffledOrder(queue.length)) {
      if (spawnMod(queue[i])) continue;
      const t = spawnType(queue[i]);
      const p = this._promote(t, budget, wave, allowed);
      if (p) { queue[i] = `${t}|${p.mod}`; return p.extra; }
    }
    return 0;
  }

  _heavierOne(queue, budget, wave) {
    const types = [...new Set(this.unlockedAt(wave))]
      .sort((a, b) => ARCHETYPES[b].threat - ARCHETYPES[a].threat);
    const bigLeft = this.heavyLimit(wave) - queue.filter(e => isHeavy(spawnType(e))).length;
    for (const i of shuffledOrder(queue.length)) {
      const entry = queue[i];
      const t = spawnType(entry), mod = spawnMod(entry);
      const now = spawnCost(entry);
      for (const k of types) {
        const A = ARCHETYPES[k];
        if (A.threat <= ARCHETYPES[t].threat) break;      // sorted: nothing lighter helps
        if (isHeavy(k) && !isHeavy(t) && bigLeft <= 0) continue;
        // A modifier only survives a swap if the new chassis can wear it;
        // dropping one would REFUND threat, which is not an upgrade.
        if (mod && !modifiersFor(k).includes(mod)) continue;
        const next = mod ? modifierThreat(k, mod) : A.threat;
        if (next - now <= budget) { queue[i] = mod ? `${k}|${mod}` : k; return next - now; }
      }
    }
    return 0;
  }

  start(wave = 1) {
    if (this.sandbox) {
      // No composition, no budget, no banner: the room is whatever the player
      // last dialled in, and it stays that way until they change it.
      this.wave = 1;
      this.spawnQueue.length = 0;
      this.pending = 0;
      this.active = true;
      this.intermission = 0;
      return;
    }
    this.wave = wave;
    this._compose();
    this.active = true;
    this.intermission = 0;
    // Per-wave boon charges come back here rather than on wave CLEAR, so a run
    // reloaded mid-ladder still starts its wave with them — see Second Wind.
    refreshWaveBoons(this.world);
    if (this.onWaveStart) this.onWaveStart(this.wave, this.pending);
  }

  /**
   * Try to promote one queued body to an elite, if the budget can carry it.
   *
   * The surcharge comes out of the SAME budget the plain bodies are bought
   * with, which is the whole reason modifiers are safe to add: an elite wave is
   * a wave with fewer, nastier bodies in it, not a wave that is secretly three
   * times the intended threat. `tools/checks/escalation.mjs` asserts the total.
   *
   * Weighted by DEPTH, not uniform: a modifier is picked in proportion to the
   * wave it unlocked at, so a run that has earned Leaders sees Leaders rather
   * than being handed the wave-3 Frenzied it has been fighting for twenty
   * waves. Uniform would make the newest, most expensive variant the rarest
   * thing in the wave that just unlocked it.
   *
   * @returns `{mod, extra}`, or 0 when nothing affordable will go on.
   */
  _promote(type, budget, wave, allowed) {
    const options = modifiersFor(type).filter(k => allowed.includes(k));
    if (!options.length) return 0;
    let total = 0;
    for (const k of options) total += MODIFIERS[k].since;
    let r = rng() * total;
    let pick = options[options.length - 1];
    for (const k of options) { r -= MODIFIERS[k].since; if (r <= 0) { pick = k; break; } }
    const extra = modifierThreat(type, pick) - (ARCHETYPES[type]?.threat ?? 0);
    if (extra > budget) return 0;
    return { mod: pick, extra };
  }

  /**
   * The set-piece, as a SHARE of the wave rather than a fixed body.
   *
   * A walker cost 12 out of wave 10's budget of 65 — a fifth of the wave, which
   * is what a boss should feel like. The same walker at wave 30 is 12 out of
   * 353, which is a rounding error wearing a health bar. So the set-piece takes
   * BOSS_SHARE of the budget and keeps buying the heaviest thing the level
   * fields until it has spent it, and from wave 15 the heavies come promoted —
   * a champion, not merely another walker.
   */
  _setPiece(wave, budget, allowed) {
    const out = [];
    let spend = budget * BOSS_SHARE;
    // The old gates, kept: an acklay at wave 5 is not a set-piece, it is the
    // end of the run. Two acolytes, then a walker, then the acklay.
    const ladder = SET_PIECE.filter(s => wave >= s.from && this.pool.includes(s.type)).map(s => s.type);
    if (!ladder.length) return out;
    // ONE OF EACH RUNG, heaviest first — not N copies of the heaviest. Two
    // acklays is not an escalation of one acklay, it is the same fight twice at
    // once; an acklay with a walker behind it is a different problem.
    const most = wave >= CHAMPION_FROM ? 3 : 2;
    // Never less than two of the lightest rung: at wave 5 that is exactly the
    // pair of acolytes the hand-written branch used to push, for exactly the
    // 12 threat it used to subtract.
    spend = Math.max(spend, ARCHETYPES[ladder[ladder.length - 1]].threat * 2);
    let bigLeft = this.heavyLimit(wave);
    for (const t of ladder) {
      if (out.length >= most) break;
      if (ARCHETYPES[t].threat > spend) continue;
      if (isHeavy(t) && bigLeft <= 0) continue;
      let cost = ARCHETYPES[t].threat;
      let entry = t;
      if (wave >= CHAMPION_FROM) {
        const p = this._promote(t, spend - cost, wave, allowed);
        if (p) { entry = `${t}|${p.mod}`; cost += p.extra; }
      }
      if (isHeavy(t)) bigLeft--;
      out.push(entry);
      spend -= cost;
    }
    // The earliest boss waves have only one rung to climb, so it comes twice.
    const last = ladder[ladder.length - 1];
    if (out.length === 1 && ladder.length === 1 && ARCHETYPES[last].threat <= spend) out.push(last);
    return out;
  }

  _compose() {
    const w = this.wave;
    let budget = this.budgetFor(w);
    const types = this.unlockedAt(w);
    const queue = [];

    if (this.mode === 'duel') {
      const n = Math.min(1 + Math.floor(w / 2), 6);
      const allowed = this.modifiersAt(w);
      for (let i = 0; i < n; i++) {
        // A duel ladder has no budget to spend, so its elites are gated on
        // depth alone — and only ever one of them, so the fight stays a duel.
        const elite = i === 0 && w >= 8 && allowed.length
          ? this._promote('acolyte', Infinity, w, allowed) : 0;
        queue.push(elite ? `acolyte|${elite.mod}` : 'acolyte');
      }
      this.spawnQueue = queue;
      this.pending = queue.length;
      return;
    }

    const allowed = this.modifiersAt(w);
    if (this.isBossWave(w)) {
      for (const entry of this._setPiece(w, budget, allowed)) {
        queue.push(entry);
        budget -= spawnCost(entry);
      }
    }

    const chance = this.eliteChance(w);
    const cap = this.bodyCap(w);
    let guard = 0;
    while (budget > 0 && queue.length < cap && guard++ < 400) {
      const bigLeft = this.heavyLimit(w) - queue.filter(e => isHeavy(spawnType(e))).length;
      const t = this._pickType(types, w, bigLeft);
      if (!t) break;
      let cost = ARCHETYPES[t].threat;
      if (cost > budget && queue.length > 0) break;
      let entry = t;
      if (allowed.length && rng() < chance) {
        const p = this._promote(t, budget - cost, w, allowed);
        if (p) { entry = `${t}|${p.mod}`; cost += p.extra; }
      }
      queue.push(entry);
      budget -= cost;
    }
    // Past the body cap the wave stops growing and starts improving.
    budget = this._upgrade(queue, budget, w, allowed);

    // shuffle so the dangerous ones aren't all last
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    this.spawnQueue = queue;
    this.pending = queue.length;
  }

  /* ── sandbox ─────────────────────────────────────────────────────── */

  /** Uniform pick from the level's pool, which is already weighted by repeats. */
  _sandboxType(cfg) {
    if (cfg.type !== 'mixed') return cfg.type;
    if (!this.pool.length) return 'b1';
    return this.pool[Math.floor(rng() * this.pool.length)];
  }

  /**
   * Somewhere on a ring you can walk to.
   *
   * `pickSpawn` uses the LEVEL's ring — 34 to 56 m on the dunes — which is
   * right for a wave marching in and wrong for practice, where the point is to
   * be fighting within a couple of seconds of moving the slider. Terrain bounds
   * and slope are still respected, and the level's own ring is the fallback.
   */
  _sandboxSpawn(ctx, type) {
    const t = this.world.terrain;
    const anchor = this.world.player ? this.world.player.position : null;
    const ring = ARCHETYPES[type]?.inert ? SANDBOX_RING_INERT : SANDBOX_RING;
    if (t && anchor) {
      for (let i = 0; i < 24; i++) {
        const a = rng() * TAU;
        const r = lerp(ring[0], ring[1], rng());
        const x = anchor.x + Math.cos(a) * r;
        const z = anchor.z + Math.sin(a) * r;
        if (!t.inBounds(x, z, 8)) continue;
        if (t.slopeAt(x, z) > 0.5) continue;
        return new THREE.Vector3(x, t.height(x, z), z);
      }
    }
    return ctx.pickSpawn(type);
  }

  /**
   * The whole sandbox: hold the population at `count`, hold the trigger at
   * `fire`. Both are re-read every frame off `world.settings`, which is the
   * same object the menu writes to — so a slider moved on the pause screen is
   * live the moment the game unpauses, with no restart and no reload.
   */
  _sandboxUpdate(dt, ctx) {
    const cfg = sandboxConfig(this.world.settings);

    // Fire rate rides the difficulty's own divisor. Cloned, never mutated in
    // place: DIFFICULTY entries are shared module constants and scaling one
    // would follow the player into their next run.
    if (this._fireApplied !== cfg.fire) {
      this._diffBase = this._diffBase || this.world.difficulty;
      if (this._diffBase) {
        // At 1× hand back the original object rather than an identical copy —
        // a run that never touches the slider should be indistinguishable from
        // one in a mode that has no slider.
        this.world.difficulty = cfg.fire === 1 ? this._diffBase
          : { ...this._diffBase, fireRate: (this._diffBase.fireRate ?? 1) * Math.max(cfg.fire, 1e-3) };
      }
      this._fireApplied = cfg.fire;
      for (const e of this.world.enemies) tuneFireRate(e, cfg.fire);
    }

    const alive = [];
    for (const e of this.world.enemies) if (!e.dead) alive.push(e);
    if (cfg.fire <= 0) for (const e of alive) holdFire(e);

    // Decide what STAYS, which is the only formulation that handles both ways
    // the room can be wrong at once: too many bodies, and bodies of a kind you
    // stopped asking for. Keep up to `count` of the right archetype, nearest
    // first — so switching the picker converges instead of waiting for you to
    // kill the old ones, and shrinking the count takes the far edge of the room
    // rather than the fight you are standing in.
    const anchor = this.world.player ? this.world.player.position : null;
    const right = cfg.type === 'mixed' ? alive.slice() : alive.filter(e => e.type === cfg.type);
    if (anchor) right.sort((a, b) => a.position.distanceToSquared(anchor) - b.position.distanceToSquared(anchor));
    const keep = new Set(right.slice(0, cfg.count));
    if (keep.size < alive.length) {
      for (const e of alive) {
        if (keep.has(e)) continue;
        const idx = this.world.enemies.indexOf(e);
        if (idx >= 0) this.world.enemies.splice(idx, 1);
        this.world.bladeSolver?.clearTarget?.(e.id);
        e.dispose();
      }
    }

    // Floored: a full room runs this every frame and an unclamped countdown
    // would be at -3600 after an hour, which is a spawn that never waits again.
    this.spawnTimer = Math.max(this.spawnTimer - dt, -1);
    if (keep.size < cfg.count && this.spawnTimer <= 0) {
      const type = this._sandboxType(cfg);
      const e = ctx.spawnEnemy(type, this._sandboxSpawn(ctx, type));
      tuneFireRate(e, cfg.fire);
      if (cfg.fire <= 0) holdFire(e);
      this.totalSpawned++;
      // Fast enough that dialling 0 → 20 fills the room in three seconds,
      // slow enough that twenty bodies do not all build their rigs on one frame.
      this.spawnTimer = 0.15;
    }
  }

  update(dt, ctx) {
    if (this.sandbox) { this._sandboxUpdate(dt, ctx); return; }
    if (!this.active) {
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.start(this.wave + 1);
      }
      return;
    }

    this.spawnTimer -= dt;
    const alive = ctx.enemies.filter(e => !e.dead).length;
    if (this.spawnQueue.length && alive < this.maxAlive && this.spawnTimer <= 0) {
      const entry = this.spawnQueue.shift();
      const type = spawnType(entry);
      const pos = ctx.pickSpawn(type);
      const e = ctx.spawnEnemy(type, pos);
      const mod = spawnMod(entry);
      // Promoted after construction because `World.spawnEnemy(type, pos)` is
      // the only door in and takes no options — see applyModifier.
      if (e && mod) applyModifier(e, mod);
      this.totalSpawned++;
      this.spawnTimer = lerp(0.85, 0.16, clamp(this.wave / 16, 0, 1)) * (0.6 + rng() * 0.8);
    }

    if (!this.spawnQueue.length && alive === 0) {
      this.active = false;
      const draft = this.mode === 'roguelite' && this.isDraftWave(this.wave);
      this.intermission = draft ? 999 : 5.5;
      if (this.onWaveClear) this.onWaveClear(this.wave);
      if (draft && this.onDraft) {
        this.onDraft(drawBoons(this.draftSize(this.wave), this.world.takenBoons, this.wave,
          // A set-piece cleared is worth more than a wave cleared: the boss
          // draft is one card wider AND cannot be three commons.
          { floor: this.isBossWave(this.wave) ? 'rare' : null }));
      }
    }
  }

  get remaining() {
    return this.spawnQueue.length + this.world.enemies.filter(e => !e.dead).length;
  }

  resumeAfterDraft() {
    this.intermission = 4.0;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Cleaving Throw                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The two numbers on the card, and why they are those numbers.
 *
 * `recall` — the outbound leg is capped at 1.5 s and the stock recall closes at
 * up to 34 m/s, so a throw across a wave leaves you unarmed for the better part
 * of three seconds. Doubling the recall clock brings the round trip back under
 * two, which is the difference between a technique you use IN a fight and one
 * you only use to open it. The card says "twice as fast" because this says 2.
 *
 * `speed` — the cut events a cleave produces carry a FIXED speed rather than
 * the disc's own. World._applyBladeEvent reads ev.speed for exactly two things:
 * the hitstop steps at 20 m/s (0.03 s below, 0.055 above) and the camera kick
 * is clamp(speed/60, 0.05, 0.3), which is already at its ceiling by 18. The
 * disc's real speed runs 26 m/s outbound and up to 68 on a doubled recall, so
 * reading it would make the same cut feel different depending on which leg of
 * the flight caught you — and both ends land on the identical kick anyway. 24
 * sits just over the hitstop step, because a blade going clean through a body
 * is the heavy version of a cut, not the glancing one.
 */
export const CLEAVE = { recall: 2.0, speed: 24 };

const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _cUp = new THREE.Vector3(0, 1, 0);

/**
 * Cleaving Throw, in full — because nothing else implements it.
 *
 * Every other boon on the list below is a number: multiply cutPower, add
 * stamina, set a flag Player.js already reads. This one is a MECHANIC, and it
 * shipped as `p.boonMods.throwPierce = true` with no reader anywhere in the
 * tree. The card promised a blade that passes through everything and comes back
 * faster; the throw behaved exactly as it did without it. So the technique is
 * installed on the player it is granted to, and each promise is one thing here.
 *
 * PASSES THROUGH. A held blade has to EARN a cut — BladeContactSolver
 * accumulates speed·dt·2.4 against the material's toughness, so plastoid (1.5)
 * parts in a frame and anything heavy (14 and up) has to be leaned on. A thrown
 * blade is never leaned on anything: at 26 m/s it crosses a body in about 40 ms,
 * two frames, roughly 3.4 of work. So the stock throw scores flesh and droid
 * plating and grinds uselessly off everything above them. Cleaving skips the
 * accumulator entirely — the disc's swept path is tested against every capsule
 * in reach and each body it meets is cut on the frame it is met, toughness
 * ignored, once per body per flight.
 *
 * The blade in flight is treated as a SPHERE of the blade's own radius, not as
 * the horizontal disc it is drawn as. That is the honest simplification: the
 * disc spins at 27 rad/s and translates at 26 m/s, so it sweeps its own
 * diameter in about 90 ms and there is no orientation a body can be in, on the
 * frame scale that matters, that the rim does not reach.
 *
 * It wraps Player._updateThrow because that is the only seam the throw has.
 * tools/checks/controls.mjs pins that seam: rename it in Player.js and the
 * check fails, rather than this boon quietly going back to doing nothing.
 *
 * @returns true if the technique is actually live on this player.
 */
export function cleavingThrow(p) {
  const base = p?._updateThrow;
  if (typeof base !== 'function') return false;

  p.throwCleaved = new Set();     // ids already met on THIS flight
  p.throwCleaves = 0;             // bodies passed through, this flight
  const from = new THREE.Vector3();

  p._updateThrow = function (dt, ctx) {
    // throwOrRecall zeroes the timer on the way out and never again, so this is
    // the one frame that is the start of a new flight. A manual recall must NOT
    // reset it — the way back is the same flight, and a body already parted on
    // the way out should not be parted a second time on the way home.
    if (this.throwTimer === 0) { this.throwCleaved.clear(); this.throwCleaves = 0; }
    from.copy(this.throwPos);
    // Scale dt rather than the recall's own speed clamp: the spin, the steering
    // lerp and the arrival test all read the same clock, so the blade still
    // lands in the hand at the end of a rotation instead of mid-turn.
    base.call(this, this.throwState === 'returning' ? dt * CLEAVE.recall : dt, ctx);
    if (this.boonMods.throwPierce) cleaveAlong(this, from, this.throwPos, dt);
  };
  return true;
}

/**
 * Everything the disc passed between `from` and `to`, cut once.
 *
 * The events go through World._applyBladeEvent rather than calling takeCut and
 * Prop.cut directly, because that function is where a cut's CONSEQUENCES live —
 * flow, combo, score, lifesteal, the hitmark, the kill credit. Duplicating that
 * policy here is how a technique drifts out of step with the rest of the game
 * one commit at a time.
 */
function cleaveAlong(p, from, to, dt) {
  const w = p.world;
  if (!w || typeof w._applyBladeEvent !== 'function') return;
  const reach = p.saber?.bladeLength ?? 1.15;
  const seen = p.throwCleaved;

  const meet = (id, caps, target) => {
    let best = null, bestGap = Infinity;
    for (const cap of caps) {
      const r = segmentSegment(from, to, cap.p0, cap.p1, _c1, _c2);
      const gap = Math.sqrt(r.distSq) - (cap.r ?? 0);
      if (gap < bestGap) { bestGap = gap; best = { cap, t: r.t }; }
    }
    if (!best || bestGap > reach) return;
    seen.add(id);
    p.throwCleaves++;

    // The disc cuts on the horizontal plane it is spinning in, so where it
    // crosses a limb is where that plane meets it — a thrown saber takes a leg
    // at the height it was flying, not always at the middle. When the plane
    // misses the limb's span entirely (a limb lying flat, or one the disc only
    // clipped the end of) that answer is meaningless and the closest point on
    // the limb is used instead.
    const cap = best.cap;
    const dy = cap.p1.y - cap.p0.y;
    const plane = Math.abs(dy) > 1e-3 ? (to.y - cap.p0.y) / dy : -1;
    const cutT = clamp(plane >= 0 && plane <= 1 ? plane : best.t, 0.06, 0.94);
    const point = cap.p0.clone().lerp(cap.p1, cutT);
    w._applyBladeEvent(p, {
      type: 'cut', target: { id, ...target }, cap, bone: cap.name,
      cutT, bladeT: 1, speed: CLEAVE.speed,
      point, impulse: p.throwVel.clone(), normal: _cUp.clone(),
    }, dt);
  };

  // One body at a time: Enemy.capsules() hands back a shared array it reuses,
  // so collecting them all first would leave every entry pointing at the last
  // enemy's bones.
  const enemies = w.enemies || [], props = w.props || [];
  for (let i = 0, n = enemies.length; i < n && i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.dead || seen.has(e.id)) continue;
    meet(e.id, e.capsules(), { enemy: e });
  }

  // Props need the loop bounded AND the offspring disowned, because cutting one
  // creates more of them: World._applyBladeEvent pushes the two halves onto
  // world.props, they carry new ids, and they are lying exactly where the disc
  // is. Unbounded, a for…of walks into them on the same frame; bounded but
  // unmarked, the NEXT frame finds them and cuts those, and their halves after
  // that — two crates measured 14 cleaves before this, a crate sawn to its
  // generation cap in the length of one flight.
  //
  // One pass means one pass. Anything the cut just produced is the same body in
  // two parts, and the disc has already been through it.
  for (let i = 0, n = props.length; i < n && i < props.length; i++) {
    const pr = props[i];
    if (!pr || pr.dead || seen.has(pr.id)) continue;
    const before = props.length;
    meet(pr.id, pr.capsules(), { prop: pr });
    for (let k = before; k < props.length; k++) if (props[k]) seen.add(props[k].id);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The technique layer                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Four seams, and every conditional boon below is built out of them.
 *
 * Cleaving Throw was the first card whose effect was a MECHANIC rather than a
 * number, and it shipped as a flag nothing read. The reason it could is that
 * there was nowhere for a mechanic to live: `apply(p)` runs once, at the draft
 * screen, and a boon that has to know what is happening THIS FRAME — whether
 * you are in a riposte, how many of them are around you, how close to death you
 * are — has nothing to hold on to. So it either got written into Player.js and
 * World.js as a special case, or it got written as a lie.
 *
 * These four give it somewhere to live, on the player, installed by the card
 * that needs it:
 *
 *   boonTick     run something every frame, after the player has updated and
 *                before World resolves blades — so a value written here is read
 *                by the same frame that produced the state it read.
 *   boonFactor   drive one boonMods multiplier from a changing number without
 *                fighting the other cards that multiply it. Divide by exactly
 *                what was applied last, multiply by what is wanted now: two
 *                cards can drive cutPower and a third can multiply it flat, and
 *                none of them stamps on the others.
 *   boonGuard    change or intercept a hit before it lands, and answer after.
 *   boonOnSever  hear about every limb this player takes off.
 *
 * All four DECLINE cleanly on anything that is not a live player, exactly as
 * cleavingThrow does, and all four return whether they actually installed — so
 * a card can set its own flag from the result and a dead seam shows up as a
 * card that reports itself dead rather than a card that quietly does nothing.
 */

/** Run `fn(dt, ctx)` on the player every frame. Idempotent per `name`. */
export function boonTick(p, name, fn) {
  if (!p || typeof p.update !== 'function' || typeof fn !== 'function') return false;
  if (!p._boonTicks) {
    p._boonTicks = new Map();
    const base = p.update;
    p._boonTickBase = base;
    p.update = function (dt, ctx) {
      base.call(this, dt, ctx);
      for (const f of this._boonTicks.values()) f.call(this, dt, ctx);
    };
  }
  p._boonTicks.set(name, fn);
  return true;
}

/**
 * Hold `boonMods[key]` at `want` times whatever the static cards left it at.
 *
 * The alternative — remembering a base at install time and writing
 * `base * want` — is wrong the moment a LATER card multiplies the same key,
 * because the next tick overwrites that card's contribution. Dividing out
 * exactly the factor previously applied composes with anything.
 */
export function boonFactor(p, key, name, want) {
  const mods = p?.boonMods;
  if (!mods || !isFinite(want) || want <= 0) return false;
  const dyn = p._boonDyn || (p._boonDyn = new Map());
  const slot = key + ':' + name;
  const applied = dyn.get(slot) ?? 1;
  if (Math.abs(want - applied) < 1e-4) return false;
  mods[key] = (mods[key] ?? 1) / applied * want;
  dyn.set(slot, want);
  return true;
}

/**
 * Sit in front of `Player.damage`.
 *
 * `before(amount, kind, source)` returns the amount that should actually land —
 * zero or less refuses the hit outright. `after(amount, kind, source)` runs
 * once the hit has resolved, which is the only place a card can raise `invuln`
 * without the base call seeing it and rejecting the blow it was supposed to
 * survive.
 */
export function boonGuard(p, name, before, after) {
  if (!p || typeof p.damage !== 'function') return false;
  if (!p._boonGuards) {
    p._boonGuards = new Map();
    p._boonAfterHit = new Map();
    const base = p.damage;
    p.damage = function (amount, point, source, kind) {
      let a = amount;
      for (const g of this._boonGuards.values()) a = g.call(this, a, kind, source);
      if (!(a > 0)) return false;
      const died = base.call(this, a, point, source, kind);
      for (const g of this._boonAfterHit.values()) g.call(this, a, kind, source);
      return died;
    };
  }
  if (before) p._boonGuards.set(name, before);
  if (after) p._boonAfterHit.set(name, after);
  return true;
}

/**
 * Hear about limbs this player takes off, by wrapping the World hook Enemy
 * already calls. Dispatch is filtered on `source`, so in co-op one player's
 * card does not fire on another player's cut.
 */
export function boonOnSever(p, name, fn) {
  const w = p?.world;
  if (!w || typeof fn !== 'function') return false;
  if (!w._boonSever) {
    w._boonSever = [];
    const base = w.onLimbSevered;
    w.onLimbSevered = function (enemy, bone, point, source) {
      if (typeof base === 'function') base.call(this, enemy, bone, point, source);
      for (const h of this._boonSever) if (h.p === source) h.fn.call(h.p, enemy, bone, point);
    };
  }
  if (!w._boonSever.some(h => h.p === p && h.name === name)) w._boonSever.push({ p, name, fn });
  return true;
}

/**
 * How many cards of one axis a holding contains.
 *
 * Takes the SET OF IDS, not a player, so the draft screen can ask the same
 * question of `world.takenBoons` that a mastery card asks of the player who is
 * about to be handed it.
 */
export function axisCountOf(taken, axis) {
  if (!taken) return 0;
  let n = 0;
  for (const b of BOONS) if (taken.has(b.id) && b.axes?.includes(axis)) n++;
  return n;
}

/** Per-wave boon charges, handed back at the top of every wave. */
export function refreshWaveBoons(world) {
  for (const p of (world?.players || [])) {
    if (p?.boonMods && p.boonMods.secondWind === 0) p.boonMods.secondWind = 1;
  }
}

/* ── the readers ─────────────────────────────────────────────────────── */

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
const _sUp = new THREE.Vector3(0, 1, 0);

/** Squared distance from a point to a capsule segment, minus the radius. */
function gapToCapsule(point, cap) {
  _s1.subVectors(cap.p1, cap.p0);
  const len2 = _s1.lengthSq();
  const t = len2 > 1e-9 ? clamp(_s2.subVectors(point, cap.p0).dot(_s1) / len2, 0, 1) : 0;
  _s2.copy(cap.p0).addScaledVector(_s1, t);
  return { gap: _s2.distanceTo(point) - (cap.r ?? 0), point: _s2.clone() };
}

/** Counterstroke — the riposte window is when your blade is worth the most. */
function riposteEdge() {
  const k = this.riposteTimer > 0 ? (this.boonMods.riposteCut ?? 1) : 1;
  boonFactor(this, 'cutPower', 'counterstroke', k);
}

/** Wellspring — the extra share of the Force's own regeneration. */
function wellspringFlow(dt) {
  const extra = (this.boonMods.forceRegen ?? 1) - 1;
  if (extra <= 0 || typeof this.force !== 'number') return;
  this.force = Math.min(this.maxForce ?? this.force, this.force + 7.5 * extra * dt);
}

/** Juyo — ferocity that compounds while you keep cutting, and cools when you stop. */
const JUYO_MAX = 6, JUYO_DECAY = 1.7;
function juyoEdge(dt) {
  const per = this.boonMods.ferocity ?? 0;
  const taken = this.limbsRemoved || 0;
  const prev = this._juyoLimbs ?? taken;
  let s = this._juyoStacks ?? 0;
  if (taken > prev) s = Math.min(JUYO_MAX, s + (taken - prev));
  this._juyoLimbs = taken;
  this._juyoStacks = Math.max(0, s - dt / JUYO_DECAY);
  boonFactor(this, 'cutPower', 'juyo', 1 + Math.floor(this._juyoStacks) * per);
}

/** Conduit — a kill hands back a measure of the Force that bought it. */
function conduitReturn() {
  const back = this.boonMods.conduit ?? 0;
  const kills = this.kills || 0;
  const prev = this._conduitKills ?? kills;
  this._conduitKills = kills;
  if (back <= 0 || kills <= prev || typeof this.force !== 'number') return;
  this.force = Math.min(this.maxForce ?? this.force, this.force + back * (kills - prev));
}

/** Fury — everything you have left, spent harder the less of it there is. */
function furyEdge() {
  const k = this.boonMods.fury ?? 0;
  if (k <= 0 || !(this.maxHp > 0)) return;
  const hurt = clamp(1 - this.hp / this.maxHp, 0, 1);
  boonFactor(this, 'cutPower', 'fury', 1 + k * hurt);
  boonFactor(this, 'moveSpeed', 'fury', 1 + 0.45 * hurt);
}

/** Encircled — a crowd is cover, if you are built for it. */
const ENCIRCLE_R2 = 7 * 7, ENCIRCLE_CAP = 0.42;
function encircleGuard(amount) {
  const per = this.boonMods.encircle ?? 0;
  if (per <= 0 || !this.position) return amount;
  let n = 0;
  for (const e of (this.world?.enemies || [])) {
    if (!e.dead && e.position.distanceToSquared(this.position) < ENCIRCLE_R2) n++;
  }
  return amount * (1 - Math.min(ENCIRCLE_CAP, per * n));
}

/** Steadfast — the big hits are the ones that get halved, and none of them move you. */
const STAGGER_AT = 14;
function steadfastGuard(amount) {
  const k = this.boonMods.steadfast ?? 1;
  const scale = this.world?.difficulty?.damageTaken ?? 1;
  return amount * scale > STAGGER_AT ? amount * k : amount;
}
function steadfastStance() { this.staggerTimer = 0; }

/** Second Wind — once a wave, the blow that would end it does not. */
function secondWindGuard(amount) {
  if (!(this.boonMods.secondWind > 0)) return amount;
  const scale = this.world?.difficulty?.damageTaken ?? 1;
  if (amount * scale < this.hp) return amount;
  this.boonMods.secondWind = 0;
  this._secondWindFired = true;
  return Math.max(0.01, (this.hp - 1) / scale);
}
function secondWindAfter() {
  if (!this._secondWindFired) return;
  this._secondWindFired = false;
  this.invuln = Math.max(this.invuln ?? 0, 1.6);
  this.heal?.(this.maxHp * 0.25);
  this.world?.notify?.('SECOND WIND', 'not this wave');
  this.world?.engine?.flash?.(0.16);
}

/** Bastion — a guard that pays for itself. See the honesty note under BOONS. */
function bastionGuardRefund() {
  const back = this.boonMods.guardRefund ?? 0;
  const n = this.deflects || 0;
  const prev = this._bastionDeflects ?? n;
  this._bastionDeflects = n;
  if (back <= 0 || n <= prev || typeof this.stamina !== 'number') return;
  this.stamina = Math.min(this.maxStamina ?? this.stamina, this.stamina + back * (n - prev));
}

/** Tempest — Flow is the fuel, so the deeper it runs the less the Force costs. */
function tempestDiscount() {
  const k = this.boonMods.tempest ?? 0;
  if (k <= 0) return;
  boonFactor(this, 'forceCost', 'tempest', Math.max(0.05, 1 - k * clamp(this.flow ?? 0, 0, 1)));
}

/** Undying — a body that mends itself once nothing has touched it for a while. */
const MEND_AFTER = 5;
function undyingMend(dt) {
  const rate = this.boonMods.mend ?? 0;
  if (rate <= 0 || !(this.maxHp > 0)) return;
  if (this.hp < (this._mendHp ?? this.hp)) this._mendClock = 0;
  this._mendHp = this.hp;
  this._mendClock = (this._mendClock ?? 0) + dt;
  if (this._mendClock > MEND_AFTER && this.hp < this.maxHp) this.heal?.(rate * dt);
}

/** Djem So — what you cut goes backwards. */
function severShove(enemy) {
  const k = this.boonMods.sunderShock ?? 0;
  if (k <= 0 || !enemy || enemy.dead || !enemy.position || !this.position) return;
  _s1.subVectors(enemy.position, this.position).setY(0.35);
  if (_s1.lengthSq() < 1e-6) _s1.set(0, 0.35, 1);
  _s1.normalize().multiplyScalar(k);
  enemy.applyKnockback?.(_s1.clone(), 0, this, false);
  enemy.stun?.(0.3);
}

/**
 * Sundering — the stroke carries into whatever stood behind the body it took.
 *
 * The second cut goes through `World._applyBladeEvent`, not through takeCut, so
 * it collects the same flow, score, lifesteal, hitmark and kill credit any
 * other cut does — the same reason Cleaving Throw routes that way. `_sundering`
 * bounds it to one generation: the second cut fires this same hook, and without
 * the latch a crowd would unzip itself in a single frame.
 */
function sunderThrough(enemy, bone, point) {
  const w = this.world;
  const reach = this.boonMods.sunderReach ?? 0;
  if (reach <= 0 || this._sundering || !w || typeof w._applyBladeEvent !== 'function') return;
  let best = null, bestGap = reach;
  for (const e of (w.enemies || [])) {
    if (!e || e.dead || e === enemy || !e.position) continue;
    if (e.position.distanceTo(point) > reach + 2.5) continue;
    // Enemy.capsules() recycles the ARRAY but mints fresh entries, so holding
    // on to one entry is safe; holding on to the array is not.
    for (const cap of e.capsules()) {
      if (cap.shield) continue;
      const hit = gapToCapsule(point, cap);
      if (hit.gap < bestGap) { bestGap = hit.gap; best = { e, cap, at: hit.point }; }
    }
  }
  if (!best) return;
  this._sundering = true;
  try {
    w._applyBladeEvent(this, {
      type: 'cut', target: { id: best.e.id, enemy: best.e }, cap: best.cap, bone: best.cap.name,
      cutT: 0.5, bladeT: 1, speed: 22,
      point: best.at, impulse: _s2.subVectors(best.at, point).normalize().multiplyScalar(9).clone(),
      normal: _sUp.clone(),
    }, 1 / 60);
  } finally { this._sundering = false; }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Boons                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Every clause on every card is a claim about code, and four of them were not.
 *
 *   Cleaving Throw   set a flag nothing read — see cleavingThrow above.
 *   Makashi          "ripostes last twice as long" set riposteWindow to 1.0,
 *                    and World reads it as `?? 1`. The identity value. The boon
 *                    and no boon produced the same 0.6 s window. It multiplies
 *                    by 2 now — multiplies, because Counterstroke lengthens the
 *                    same window and an assignment would silently eat it.
 *   Soresu           "blocked bolts cost no stamina" — World._creditDeflect
 *                    charges a flat 4 on a BLOCK and consults no boon.
 *   Celerity         "dashes cost less" — Player._tryDash charges a flat 18 and
 *                    consults no boon.
 *
 * The Soresu clause is BACK, on a different card. It needed a line in World.js,
 * which this lane does not own — but `boonTick` runs after the player updates
 * and `p.deflects` counts every bolt turned aside, so Bastion watches that
 * counter and hands the stamina back. The clause is true again because there is
 * finally somewhere for it to be true. Celerity's is still off the card: dash
 * cost is spent inside `_tryDash` and leaves no counter behind to watch.
 * Two more were simply overstated: Ataru's "cost nothing" is a 45% discount and
 * it applies to every Force power, not just jumps, and Focusing Crystal makes
 * the trail THICKER, not longer.
 *
 * ── on 16 cards, drafted 3 at a time, every third wave ────────────────────
 *
 * A thirty-wave run saw ten drafts and took ten of sixteen cards — five eighths
 * of the whole system, near enough every run, which is the opposite of variety.
 * Whatever you were offered, you ended up in roughly the same place.
 *
 * Three things changed, and they are the same change:
 *
 *   MORE, AND OFTENER. Twenty-nine cards, a draft every second wave. A run now
 *   takes about fifteen of twenty-nine — half, not five eighths — and two runs
 *   that both went thirty waves no longer hold mostly the same cards.
 *
 *   RARITY, WEIGHTED BY DEPTH. `RARITY` is not a label, it is the probability
 *   of being offered at all, and it moves with the wave: commons are flat, rares
 *   climb, epics are locked below wave 7 and then climb hard. So the wave-2
 *   draft is a choice between small things and the wave-25 draft is a choice
 *   between large ones, from the same table.
 *
 *   AXES, AND CARDS THAT READ THEM. Every card declares `axes` — blade, guard,
 *   force, body, dark. Five MASTERIES are gated on holding three of an axis
 *   already (`requires`, checked against the draft's own taken-set), so they
 *   cannot be offered to a player who has not committed, and taking one is the
 *   moment a pile of cards becomes a build. Around them sit the cards that
 *   MULTIPLY other cards rather than adding to them: Counterstroke wants
 *   Makashi's longer window, Juyo wants anything that severs, Fury wants Dark
 *   Sustenance to keep it alive at the health where it is strongest.
 *
 * Every effect below is a real reader. The numbers land on `boonMods` keys that
 * Player.js, World.js and Duel.js already consult; the conditional ones land on
 * keys read by the technique layer above, every frame, on the player they were
 * installed on. tools/checks/controls.mjs proves it card by card.
 *
 * ── on Shatterpoint and Djem So ───────────────────────────────────────────
 *
 * They were the same card. Both wrote `cutPower` and nothing else, ×1.9 against
 * ×1.55, at the same rarity, out of the same pool — so Shatterpoint strictly
 * dominated: same mechanism, bigger number, never a reason to take the other
 * one. Djem So is Form V, and the card already promised what it never did
 * ("stagger harder"), so that is what it is now: a smaller edge, and everything
 * you cut goes backwards off its feet. Shatterpoint keeps the raw number and
 * pays for it by being rare.
 */

/**
 * How likely a card of each rarity is to be offered, at a given wave.
 *
 * Weights, not gates — a gate makes the same card appear every run at the same
 * wave, which is the variability problem wearing a different hat. The one hard
 * gate is `minWave`, and it exists so that the third card of a run cannot be
 * the thing that ends the run's difficulty curve.
 */
export const RARITY = {
  common: { label: 'Common', weight: () => 1 },
  rare: { label: 'Rare', weight: (w) => clamp(0.18 + w * 0.035, 0, 0.9) },
  epic: { label: 'Epic', weight: (w) => clamp((w - 6) * 0.055, 0, 1.0) },
};
const RARITY_ORDER = ['common', 'rare', 'epic'];

/** A mastery needs this many cards of its axis already in hand, and this depth. */
export const MASTERY_NEEDS = 3;
export const MASTERY_AT = 12;
const mastery = (axis) => (taken) => axisCountOf(taken, axis) >= MASTERY_NEEDS;

export const BOONS = [
  {
    id: 'vaapad', icon: '⚡', name: 'Vaapad', tag: 'Form VII',
    rarity: 'rare', axes: ['guard'],
    text: 'Returned bolts strike for half again as much, and every return feeds your Flow.',
    apply(p) { p.boonMods.deflectDamage *= 1.5; p.boonMods.flowGain *= 1.35; },
  },
  {
    id: 'soresu', icon: '🛡', name: 'Soresu', tag: 'Form III',
    rarity: 'common', axes: ['guard'],
    text: 'A wider guard. Deflection is forgiven further along the blade, and your reserves run deeper.',
    apply(p) { p.boonMods.returnCone = 0.58; p.control.deadzone = 0.30; p.maxStamina += 25; p.stamina = p.maxStamina; },
  },
  {
    id: 'ataru', icon: '🌀', name: 'Ataru', tag: 'Form IV',
    rarity: 'rare', axes: ['force'],
    text: 'Acrobatic. Every Force power costs little over half, you leap higher, and you may leap a second time in the air.',
    apply(p) { p.boonMods.doubleJump = true; p.boonMods.forceCost *= 0.55; p.boonMods.jumpPower *= 1.18; },
  },
  {
    id: 'djemso', icon: '🗡', name: 'Djem So', tag: 'Form V',
    rarity: 'common', axes: ['blade'],
    text: 'Power over finesse. Cuts bite deeper, and whatever you cut is thrown off its feet.',
    // The shove is the half of this card that was only ever a sentence. It is
    // an impulse and a stun on the body that was cut, so Form V opens ground
    // where Shatterpoint only opens armour.
    apply(p) {
      p.boonMods.cutPower *= 1.4;
      p.boonMods.sunderShock = 9;
      boonOnSever(p, 'djemso', severShove);
    },
  },
  {
    id: 'makashi', icon: '🤺', name: 'Makashi', tag: 'Form II',
    rarity: 'common', axes: ['guard', 'blade'],
    text: 'Duellist. A steadier blade against another blade, and ripostes last twice as long.',
    apply(p) { p.boonMods.riposteWindow = (p.boonMods.riposteWindow ?? 1) * 2; p.control.sensitivity *= 1.06; },
  },
  {
    id: 'shatterpoint', icon: '💠', name: 'Shatterpoint', tag: 'Sight',
    rarity: 'rare', axes: ['blade'],
    text: 'You see where things want to break. Heavy materials part in half the time.',
    apply(p) { p.boonMods.cutPower *= 1.9; },
  },
  {
    id: 'tutaminis', icon: '🌡', name: 'Tutaminis', tag: 'Absorption',
    rarity: 'common', axes: ['force', 'guard'],
    text: 'Bolts that strike you feed the Force instead of only wounding.',
    apply(p) { p.boonMods.absorb = true; },
  },
  {
    id: 'repulse', icon: '💥', name: 'Force Repulse', tag: 'Impact',
    rarity: 'rare', axes: ['force'],
    text: 'Landing from a height blows everything nearby off its feet.',
    apply(p) { p.boonMods.repulse = true; },
  },
  {
    id: 'lightning', icon: '🗲', name: 'Force Lightning', tag: 'Dark',
    rarity: 'epic', minWave: 7, axes: ['force', 'dark'],
    // No key name. This card said "on Z" — a key typed into a run reward,
    // which is wrong for anyone who has rebound `lightning` and is a second
    // home for a name that lives in ACTIONS. The Codex prints the live key.
    text: 'Unlocks Force lightning, on its own key. It is not the Jedi way.',
    apply(p) { p.boonMods.lightning = true; },
  },
  {
    id: 'saberthrow', icon: '🪃', name: 'Cleaving Throw', tag: 'Technique',
    rarity: 'epic', minWave: 7, axes: ['blade'],
    text: 'The thrown blade cuts clean through everything it passes, and returns twice as fast.',
    // The flag is set from the RESULT, so it means "the technique is live on
    // this player" and not "somebody once ticked a box". cleavingThrow reads it
    // back every frame, which is also what makes it a setting with a reader.
    apply(p) { p.boonMods.throwPierce = cleavingThrow(p); },
  },
  {
    id: 'meditation', icon: '🧘', name: 'Meditation', tag: 'Discipline',
    rarity: 'common', axes: ['body'],
    text: 'Stamina returns half again as fast, and Flow bleeds away more slowly.',
    apply(p) { p.boonMods.staminaRegen *= 1.5; p.boonMods.flowGain *= 1.15; },
  },
  {
    id: 'vitality', icon: '❤', name: 'Vitality', tag: 'Body',
    rarity: 'common', axes: ['body'],
    text: 'Thirty more vitality, and a kill returns a little of it.',
    apply(p) { p.maxHp += 30; p.hp += 30; p.boonMods.healOnKill += 3; },
  },
  {
    id: 'celerity', icon: '💨', name: 'Celerity', tag: 'Speed',
    rarity: 'common', axes: ['body'],
    text: 'You move a fifth faster.',
    apply(p) { p.boonMods.moveSpeed *= 1.2; },
  },
  {
    id: 'longblade', icon: '📏', name: 'Extended Blade', tag: 'Crystal',
    rarity: 'common', axes: ['blade'],
    text: 'A longer blade. More reach, and a faster tip for the same swing.',
    apply(p) { p.saber.bladeLength += 0.24; },
  },
  {
    id: 'dualcrystal', icon: '💎', name: 'Focusing Crystal', tag: 'Crystal',
    rarity: 'rare', axes: ['blade'],
    text: 'A brighter, hotter blade. Cuts land more easily and the trail burns wider.',
    // Three promises, and for a long time one of them landed. The line is
    // unchanged — `coreWidth` is now an accessor on Saber, so writing it pushes
    // the new width into uWidth/uRadius and into trailThickness instead of
    // sitting in a field that only the constructor had ever read. Measured on a
    // live blade 60 frames after the draft: uWidth 0.0110/0.0330/0.1050 →
    // 0.0138/0.0413/0.1313, uRadius 0.360 → 0.450, trail half-thickness
    // 0.0528 → 0.0660. Before, all three were unchanged.
    apply(p) { p.saber.coreWidth *= 1.25; p.boonMods.cutPower *= 1.2; },
  },
  {
    id: 'lifesteal', icon: '🩸', name: 'Dark Sustenance', tag: 'Dark',
    rarity: 'rare', axes: ['dark'],
    text: 'Severing a limb returns vitality.',
    apply(p) { p.boonMods.lifesteal += 5; },
  },

  /* ── the conditional cards ──────────────────────────────────────────── */

  {
    id: 'counterstroke', icon: '↩', name: 'Counterstroke', tag: 'Riposte',
    rarity: 'common', axes: ['blade', 'guard'],
    text: 'A parry opens them up and you take the opening: while the riposte lasts your blade cuts twice as hard.',
    // Multiplies the window rather than setting it, so Makashi's doubling and
    // this card's stack instead of one overwriting the other.
    apply(p) {
      p.boonMods.riposteWindow = (p.boonMods.riposteWindow ?? 1) * 1.35;
      p.boonMods.riposteCut = 2.0;
      boonTick(p, 'counterstroke', riposteEdge);
    },
  },
  {
    id: 'wellspring', icon: '🔷', name: 'Wellspring', tag: 'Reservoir',
    rarity: 'common', axes: ['force'],
    text: 'A deeper well, and it fills back up half again as fast.',
    apply(p) {
      if (typeof p.maxForce === 'number') { p.maxForce += 45; p.force = p.maxForce; }
      p.boonMods.forceRegen = (p.boonMods.forceRegen ?? 1) * 1.6;
      boonTick(p, 'wellspring', wellspringFlow);
    },
  },
  {
    id: 'encircle', icon: '⭕', name: 'Encircled', tag: 'Bulwark',
    rarity: 'common', axes: ['guard', 'body'],
    text: 'A crowd is cover. Every one of them within reach of you takes a little of the sting out of all of them.',
    apply(p) {
      p.boonMods.encircle = 0.06;
      boonGuard(p, 'encircle', encircleGuard);
    },
  },
  {
    id: 'juyo', icon: '☄', name: 'Juyo', tag: 'Form VII',
    rarity: 'rare', axes: ['blade', 'dark'],
    text: 'Ferocity compounds. Every limb you take sharpens the next cut, and the edge cools the moment you stop.',
    apply(p) {
      p.boonMods.ferocity = 0.12;
      boonTick(p, 'juyo', juyoEdge);
    },
  },
  {
    id: 'conduit', icon: '🌊', name: 'Conduit', tag: 'Channel',
    rarity: 'rare', axes: ['force'],
    text: 'The fight feeds the Force: every body you put down hands a measure of it straight back.',
    apply(p) {
      p.boonMods.conduit = 22;
      boonTick(p, 'conduit', conduitReturn);
    },
  },
  {
    id: 'secondwind', icon: '🕊', name: 'Second Wind', tag: 'Endurance',
    rarity: 'rare', axes: ['body'],
    text: 'Once each wave, the blow that would finish you leaves you standing on a sliver instead.',
    apply(p) {
      p.boonMods.secondWind = 1;
      boonGuard(p, 'secondwind', secondWindGuard, secondWindAfter);
    },
  },
  {
    id: 'fury', icon: '🔥', name: 'Fury', tag: 'Dark',
    rarity: 'rare', axes: ['dark', 'blade'],
    text: 'Pain is a weapon. The nearer death you are, the harder you strike and the faster you move.',
    apply(p) {
      p.boonMods.fury = 0.7;
      boonTick(p, 'fury', furyEdge);
    },
  },
  {
    id: 'steadfast', icon: '🗿', name: 'Steadfast', tag: 'Stance',
    rarity: 'rare', axes: ['guard', 'body'],
    text: 'Nothing staggers you, and anything heavy enough to have tried lands for half.',
    apply(p) {
      p.boonMods.steadfast = 0.5;
      boonGuard(p, 'steadfast', steadfastGuard);
      boonTick(p, 'steadfast', steadfastStance);
    },
  },

  /* ── masteries: one per axis, and you must have committed ───────────── */

  {
    id: 'bastion', icon: '🏰', name: 'Bastion', tag: 'Mastery of Defence',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['guard'], requires: mastery('guard'),
    text: 'Everything you turn aside comes back twice as hard, and turning it aside costs you nothing.',
    apply(p) {
      p.boonMods.deflectDamage *= 2.0;
      p.boonMods.guardRefund = 4;
      boonTick(p, 'bastion', bastionGuardRefund);
    },
  },
  {
    id: 'tempest', icon: '🌪', name: 'Tempest', tag: 'Mastery of the Force',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['force'], requires: mastery('force'),
    text: 'Power feeds power. The deeper your Flow runs the less the Force asks, and at the flood it asks almost nothing.',
    apply(p) {
      p.boonMods.tempest = 0.85;
      boonTick(p, 'tempest', tempestDiscount);
    },
  },
  {
    id: 'sunder', icon: '⚔', name: 'Sundering', tag: 'Mastery of the Blade',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['blade'], requires: mastery('blade'),
    text: 'The stroke does not stop at one body. Whatever was standing behind it loses a limb too.',
    apply(p) {
      p.boonMods.sunderReach = 2.4;
      boonOnSever(p, 'sunder', sunderThrough);
    },
  },
  {
    id: 'undying', icon: '🌿', name: 'Undying', tag: 'Mastery of the Body',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['body'], requires: mastery('body'),
    text: 'Give it a few seconds without a wound and the wounds close by themselves.',
    apply(p) {
      p.boonMods.mend = 7;
      boonTick(p, 'undying', undyingMend);
    },
  },
  {
    id: 'darkside', icon: '⚫', name: 'The Dark Side', tag: 'Mastery of the Dark',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['dark'], requires: mastery('dark'),
    text: 'A third of your vitality, gone. Everything you take from them, doubled — and the blade bites deeper for it.',
    apply(p) {
      if (p.maxHp > 0) { p.maxHp = Math.round(p.maxHp * 0.66); p.hp = Math.min(p.hp, p.maxHp); }
      p.boonMods.lifesteal = (p.boonMods.lifesteal || 0) * 2 + 4;
      p.boonMods.healOnKill = (p.boonMods.healOnKill || 0) * 2 + 5;
      p.boonMods.cutPower *= 1.25;
    },
  },
];

/** Weighted pick without replacement. Weights are strictly positive. */
function weightedPick(pool, weightOf) {
  let total = 0;
  for (const b of pool) total += weightOf(b);
  let r = rng() * total;
  for (const b of pool) { r -= weightOf(b); if (r <= 0) return b; }
  return pool[pool.length - 1];
}

/**
 * One draft.
 *
 * @param n       how many cards to lay out
 * @param taken   ids already held — never offered twice, and the set a mastery
 *                asks about to decide whether it may be offered at all
 * @param wave    what depth is asking, which is what moves the rarity weights
 * @param opts.floor  lowest rarity the FIRST card may be, if one is available
 */
export function drawBoons(n, taken = new Set(), wave = 1, opts = {}) {
  const pool = BOONS.filter(b => !taken.has(b.id)
    && wave >= (b.minWave ?? 1)
    && (!b.requires || b.requires(taken)));
  const weightOf = (b) => Math.max(1e-4, (RARITY[b.rarity] ?? RARITY.common).weight(wave));
  const out = [];
  const take = (from) => {
    const pick = weightedPick(from, weightOf);
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  };
  if (opts.floor && pool.length) {
    const tier = RARITY_ORDER.indexOf(opts.floor);
    const strong = pool.filter(b => RARITY_ORDER.indexOf(b.rarity ?? 'common') >= tier);
    if (strong.length) take(strong);
  }
  while (out.length < n && pool.length) take(pool);
  return out;
}
