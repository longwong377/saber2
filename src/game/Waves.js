/**
 * SABER — wave director and run boons.
 *
 * Waves are budgeted, not scripted: the director spends a threat budget on
 * whatever the level allows, so the composition changes every run and the
 * pressure curve stays honest. Every third wave the Force offers a choice —
 * runs are built, not saved.
 */

import * as THREE from 'three';
import { ARCHETYPES } from './Enemy.js';
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
    this.bossWaves = new Set([5, 10, 15, 20, 25, 30]);
    // sandbox bookkeeping — see _sandboxUpdate
    this._fireApplied = null;
    this._diffBase = null;
  }

  get sandbox() { return this.mode === 'sandbox'; }

  budgetFor(wave) {
    // gentle ramp then steady escalation
    return Math.floor(4 + wave * 2.6 + Math.pow(wave, 1.62) * 0.65);
  }

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
    if (this.onWaveStart) this.onWaveStart(this.wave, this.pending);
  }

  _compose() {
    const w = this.wave;
    let budget = this.budgetFor(w);
    const types = this.unlockedAt(w);
    const queue = [];

    if (this.mode === 'duel') {
      const n = Math.min(1 + Math.floor(w / 2), 6);
      for (let i = 0; i < n; i++) queue.push('acolyte');
      this.spawnQueue = queue;
      this.pending = queue.length;
      return;
    }

    // set-piece heavies on boss waves
    if (this.bossWaves.has(w)) {
      if (w >= 20 && this.pool.includes('beast')) { queue.push('beast'); budget -= ARCHETYPES.beast.threat; }
      else if (w >= 10 && this.pool.includes('walker')) { queue.push('walker'); budget -= ARCHETYPES.walker.threat; }
      else if (this.pool.includes('acolyte')) { queue.push('acolyte'); queue.push('acolyte'); budget -= 12; }
    }

    let guard = 0;
    while (budget > 0 && guard++ < 400) {
      const t = types[Math.floor(rng() * types.length)];
      const cost = ARCHETYPES[t].threat;
      if (cost > budget && queue.length > 0) break;
      queue.push(t);
      budget -= cost;
    }
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
      const type = this.spawnQueue.shift();
      const pos = ctx.pickSpawn(type);
      ctx.spawnEnemy(type, pos);
      this.totalSpawned++;
      this.spawnTimer = lerp(0.85, 0.16, clamp(this.wave / 16, 0, 1)) * (0.6 + rng() * 0.8);
    }

    if (!this.spawnQueue.length && alive === 0) {
      this.active = false;
      this.intermission = this.mode === 'roguelite' && this.wave % 3 === 0 ? 999 : 5.5;
      if (this.onWaveClear) this.onWaveClear(this.wave);
      if (this.mode === 'roguelite' && this.wave % 3 === 0 && this.onDraft) {
        this.onDraft(drawBoons(3, this.world.takenBoons));
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
/*  Boons                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

export const BOONS = [
  {
    id: 'vaapad', icon: '⚡', name: 'Vaapad', tag: 'Form VII',
    text: 'Returned bolts strike for half again as much, and every return feeds your Flow.',
    apply(p) { p.boonMods.deflectDamage *= 1.5; p.boonMods.flowGain *= 1.35; },
  },
  {
    id: 'soresu', icon: '🛡', name: 'Soresu', tag: 'Form III',
    text: 'A wider guard. Deflection is forgiven further along the blade, and blocked bolts cost no stamina.',
    apply(p) { p.boonMods.returnCone = 0.58; p.control.deadzone = 0.30; p.maxStamina += 25; p.stamina = p.maxStamina; },
  },
  {
    id: 'ataru', icon: '🌀', name: 'Ataru', tag: 'Form IV',
    text: 'Acrobatic. Force jumps cost nothing and you may leap a second time in the air.',
    apply(p) { p.boonMods.doubleJump = true; p.boonMods.forceCost *= 0.55; p.boonMods.jumpPower *= 1.18; },
  },
  {
    id: 'djemso', icon: '🗡', name: 'Djem So', tag: 'Form V',
    text: 'Power over finesse. Cuts bite deeper and stagger harder.',
    apply(p) { p.boonMods.cutPower *= 1.55; },
  },
  {
    id: 'makashi', icon: '🤺', name: 'Makashi', tag: 'Form II',
    text: 'Duellist. A steadier blade against another blade, and ripostes last twice as long.',
    apply(p) { p.boonMods.riposteWindow = 1.0; p.control.sensitivity *= 1.06; },
  },
  {
    id: 'shatterpoint', icon: '💠', name: 'Shatterpoint', tag: 'Sight',
    text: 'You see where things want to break. Heavy materials part in half the time.',
    apply(p) { p.boonMods.cutPower *= 1.9; },
  },
  {
    id: 'tutaminis', icon: '🌡', name: 'Tutaminis', tag: 'Absorption',
    text: 'Bolts that strike you feed the Force instead of only wounding.',
    apply(p) { p.boonMods.absorb = true; },
  },
  {
    id: 'repulse', icon: '💥', name: 'Force Repulse', tag: 'Impact',
    text: 'Landing from a height blows everything nearby off its feet.',
    apply(p) { p.boonMods.repulse = true; },
  },
  {
    id: 'lightning', icon: '🗲', name: 'Force Lightning', tag: 'Dark',
    text: 'Unlocks lightning on Z. It is not the Jedi way.',
    apply(p) { p.boonMods.lightning = true; },
  },
  {
    id: 'saberthrow', icon: '🪃', name: 'Cleaving Throw', tag: 'Technique',
    text: 'The thrown blade passes through everything it meets and returns faster.',
    apply(p) { p.boonMods.throwPierce = true; },
  },
  {
    id: 'meditation', icon: '🧘', name: 'Meditation', tag: 'Discipline',
    text: 'Stamina returns half again as fast, and Flow bleeds away more slowly.',
    apply(p) { p.boonMods.staminaRegen *= 1.5; p.boonMods.flowGain *= 1.15; },
  },
  {
    id: 'vitality', icon: '❤', name: 'Vitality', tag: 'Body',
    text: 'Thirty more vitality, and a kill returns a little of it.',
    apply(p) { p.maxHp += 30; p.hp += 30; p.boonMods.healOnKill += 3; },
  },
  {
    id: 'celerity', icon: '💨', name: 'Celerity', tag: 'Speed',
    text: 'You move a fifth faster and dashes cost less.',
    apply(p) { p.boonMods.moveSpeed *= 1.2; },
  },
  {
    id: 'longblade', icon: '📏', name: 'Extended Blade', tag: 'Crystal',
    text: 'A longer blade. More reach, and a faster tip for the same swing.',
    apply(p) { p.saber.bladeLength += 0.24; },
  },
  {
    id: 'dualcrystal', icon: '💎', name: 'Focusing Crystal', tag: 'Crystal',
    text: 'A brighter, hotter blade. Cuts land more easily and the trail burns longer.',
    apply(p) { p.saber.coreWidth *= 1.25; p.boonMods.cutPower *= 1.2; },
  },
  {
    id: 'lifesteal', icon: '🩸', name: "Dark Sustenance", tag: 'Dark',
    text: 'Severing a limb returns vitality.',
    apply(p) { p.boonMods.lifesteal += 5; },
  },
];

export function drawBoons(n, taken = new Set()) {
  const pool = BOONS.filter(b => !taken.has(b.id));
  const out = [];
  const copy = pool.slice();
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}
