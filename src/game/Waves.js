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
};

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
  }

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

  update(dt, ctx) {
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
