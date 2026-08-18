/**
 * BATTLEFRONT BORZ — STRATAGEMS: the things you call down rather than do.
 *
 * Player note #29: support calls entered as a short WASD code, and abilities
 * directed at a unit.
 *
 * ── WHY A CODE AND NOT A KEY ────────────────────────────────────────────
 *
 * Every other verb in this game is one press, and that is right for every
 * other verb: a deflection is a reflex and a reflex cannot be spelled. A
 * stratagem is the opposite kind of decision. It is a thing you commit to
 * while somebody is shooting at you, it arrives seconds later, and the cost
 * of it is that you were not fighting while you called it. A code makes that
 * cost REAL and legible — four keystrokes with a rifle line 40 m away is a
 * risk you took, and the same call on a bound key is free.
 *
 * It also solves a problem this project already has and had no answer for:
 * the keyboard is out of keys and the pad is out of buttons (see
 * ORDER_PAD_POOL's note in Bindings.js, which retired six chords to make room
 * for one attack). A code costs ONE binding and scales to as many calls as
 * anyone cares to author, on both devices — the pad's D-pad spells the same
 * four letters the keyboard's WASD does, which is why the codes are stored as
 * directions and not as key names.
 *
 * ── WHAT DECIDES WHAT, and it is three owners and not one ───────────────
 *
 * This file owns WHEN a call fires and WHAT IT COSTS: the code table, the
 * entry state machine, the cooldowns, the refusals. It owns none of the
 * effects. Every effect is a call into the system that already owns that
 * verb — `ArrivalDirector.request` lands troops, `Terrain.crater` breaks
 * ground, `Player._shockwave` throws bodies, `Particles` draws — because a
 * stratagem that reimplemented any of those would be a second copy of a rule
 * that could disagree with the first, which is the defect this codebase keeps
 * removing (HANDOFF §2.3).
 *
 * The consequence to hold on to: adding a stratagem should be adding a ROW,
 * and if it ever needs more than a row plus a call into somebody else's
 * system, the effect belongs in that other system.
 */

import * as THREE from 'three';
import { audio } from '../engine/Audio.js';
import { clamp } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const TAU = Math.PI * 2;

/**
 * THE FOUR DIRECTIONS, AS DIRECTIONS.
 *
 * A code is `'WSAD'`, not `['KeyW','KeyS','KeyA','KeyD']`, and the difference
 * is the whole reason a pad can enter one. The letters name a DIRECTION; the
 * bindings table names the keys and the pad buttons that mean that direction,
 * and `Stratagems.feed` is handed the direction rather than reading either.
 * A player who has rebound movement to ESDF spells the same codes with the
 * same fingers, which a code written in key names could not survive.
 */
export const DIRS = ['W', 'A', 'S', 'D'];
/** The action id whose axis a direction is read off. One place, both devices. */
export const DIR_ACTION = { W: 'moveF', A: 'moveL', S: 'moveB', D: 'moveR' };

/**
 * HOW LONG A CODE MAY TAKE, in seconds since the last letter.
 *
 * Not since the FIRST letter: a timeout measured from the start would punish a
 * long code for being long, and the codes are not all the same length. What
 * this is for is abandoning an entry the player has walked away from — they
 * pressed W to dodge and never meant to call anything — and for that, silence
 * is the signal.
 *
 * 1.6 s is slow enough to spell four letters while strafing and fast enough
 * that a code cannot still be half-entered by the time the fight has moved.
 */
export const CODE_GAP = 1.6;

/**
 * THE TABLE. Every stratagem is a row and nothing else.
 *
 *   code      the letters, in order. Must be unique and must not be a PREFIX
 *             of another code — see `codeFaults`, which is what enforces it.
 *   cost      Force. Stratagems are a Force-user's calls, so they bill the
 *             same pool every power does rather than inventing a currency.
 *   cooldown  seconds, per stratagem. Each has its own, so a cheap smoke does
 *             not gate an orbital strike.
 *   lead      seconds between the call landing and the effect arriving. This
 *             is the whole texture of the mechanic: you are asking for
 *             something that is not here yet, and where the enemy will BE is
 *             your problem.
 *   at        'aim'  — lands where you are looking, on the ground.
 *             'self' — lands on you.
 *   fire      (ctx, site, S) → void. Runs when the lead expires.
 *
 * `commandOnly` marks the calls that only make sense with an army behind you.
 * The reinforcement drop is not a thing a lone Jedi in a horde run can ask
 * for, and offering it there would be a menu item that always refuses.
 */
export const STRATAGEMS = [
  {
    id: 'strike', name: 'Orbital strike', code: 'WSWD',
    cost: 34, cooldown: 26, lead: 3.2, at: 'aim',
    blurb: 'A lance from orbit, on the ground you marked. Three seconds of warning, '
      + 'for you and for them.',
    fire: (ctx, site, S) => S.blast(ctx, site, 7.5, 62, 150),
  },
  {
    id: 'barrage', name: 'Artillery barrage', code: 'SSWA',
    cost: 26, cooldown: 22, lead: 2.6, at: 'aim',
    blurb: 'Six shells walked across the position. Wider than the lance and much '
      + 'less certain about where anything is.',
    fire: (ctx, site, S) => {
      /* WALKED, not dropped in a ring. A battery firing at a map reference
       * has an error along its own line of fire and almost none across it,
       * so the pattern is a LINE with scatter, laid along the bearing from
       * the caller — which is also what makes it readable: the shells come
       * toward you or away from you, and standing to one side is a real
       * answer. */
      const bear = _v1.subVectors(site, S.owner.position).setY(0);
      if (bear.lengthSq() < 1e-4) bear.set(0, 0, 1);
      bear.normalize();
      for (let i = 0; i < 6; i++) {
        const t = (i - 2.5) * 4.2 + (S.rand() - 0.5) * 2.4;
        const across = (S.rand() - 0.5) * 3.6;
        const p = _v2.copy(site).addScaledVector(bear, t)
          .addScaledVector(_v3.set(-bear.z, 0, bear.x), across);
        S.after(i * 0.22, () => S.blast(ctx, p.clone(), 4.2, 30, 62));
      }
    },
  },
  {
    id: 'smoke', name: 'Smoke screen', code: 'ASAS',
    cost: 12, cooldown: 14, lead: 1.1, at: 'aim',
    blurb: 'A wall of smoke on the marked ground. Nothing on either side can '
      + 'shoot what it cannot see.',
    fire: (ctx, site, S) => S.smoke(ctx, site, 8.5, 11),
  },
  {
    id: 'reinforce', name: 'Reinforcements', code: 'WWSS', commandOnly: true,
    cost: 30, cooldown: 34, lead: 0.4, at: 'self',
    blurb: 'A gunship, and four more of yours off the ramp. They come down beside '
      + 'you, not at the edge of the field.',
    fire: (ctx, site, S) => S.reinforce(ctx, 4),
  },
  {
    id: 'rally', name: 'Rally', code: 'WAWD', commandOnly: true,
    cost: 18, cooldown: 20, lead: 0, at: 'self',
    blurb: 'Steady the line. Everyone of yours inside the shout stops breaking and '
      + 'stands up.',
    fire: (ctx, site, S) => S.rally(ctx, 22),
  },
  {
    id: 'resupply', name: 'Resupply', code: 'SASD',
    cost: 16, cooldown: 24, lead: 2.0, at: 'self',
    blurb: 'A pod on your position: health for you, and it wakes the wounded around '
      + 'you back onto their feet.',
    fire: (ctx, site, S) => S.resupply(ctx, site, 9),
  },
];

/** By id, for the HUD and the Codex. Derived, so a row cannot be missed. */
export const STRATAGEM_BY_ID = Object.fromEntries(STRATAGEMS.map(s => [s.id, s]));

/**
 * EVERYTHING WRONG WITH THE TABLE, as a list of sentences.
 *
 * Two faults are possible and both are silent at runtime, which is why they
 * are found here instead of being discovered in a fight:
 *
 *  · A DUPLICATE code. Two rows on one spelling means one of them can never
 *    fire and nothing would ever say so.
 *  · A PREFIX. If `WS` is a stratagem and `WSWD` is another, the short one
 *    fires the moment its last letter lands and the long one is unreachable.
 *    This is the failure that is easy to author by accident and impossible to
 *    diagnose from the outside — the player just finds that one call
 *    "sometimes does the wrong thing".
 *
 * Exported rather than asserted here so tools/checks can state it as a check
 * over the shipped table, and so a mod adding rows gets the same reading.
 */
export function codeFaults(rows = STRATAGEMS) {
  const out = [];
  for (const s of rows) {
    if (!s.code || !s.code.length) { out.push(`${s.id} has no code`); continue; }
    for (const c of s.code) if (!DIRS.includes(c)) out.push(`${s.id}: '${c}' is not a direction`);
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const a = rows[i], b = rows[j];
      if (a.code === b.code && i < j) out.push(`${a.id} and ${b.id} share the code ${a.code}`);
      else if (a.code !== b.code && b.code.startsWith(a.code)) {
        out.push(`${a.id} (${a.code}) is a prefix of ${b.id} (${b.code}), so ${b.id} can never fire`);
      }
    }
  }
  return out;
}

/**
 * THE CALLER.
 *
 * One per player. `feed(dir)` takes a direction the input layer resolved,
 * `update(dt, ctx)` runs the pending calls, and `entry` is what the HUD paints.
 */
export class Stratagems {
  constructor(owner) {
    this.owner = owner;
    /** Letters entered so far, as a string. Empty when nothing is being spelled. */
    this.entry = '';
    /** Seconds since the last letter, for CODE_GAP. */
    this.since = 0;
    /** Is the player holding the stratagem key? Entry only accumulates while true. */
    this.arming = false;
    /** id → seconds remaining. */
    this.cooldowns = {};
    /** Calls that have been made and have not landed. */
    this.pending = [];
    /** Deferred effects inside a single call — the barrage's six shells. */
    this._timers = [];
    /** What the last entry did, for the HUD's one line of feedback. */
    this.said = '';
    this.saidT = 0;
    this._seed = 0x9e3779b9;
  }

  /* A stratagem's own scatter must not touch the world's RNG stream: an
   * artillery pattern is cosmetic variation and the world's seed is a
   * reproducibility contract. Own generator, own state. */
  rand() {
    this._seed = (this._seed * 1664525 + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  /** Which rows are offerable at all right now. Command-only calls need an army. */
  available(ctx) {
    const army = !!(ctx?.world?.command || this.owner?.world?.command);
    return STRATAGEMS.filter(s => !s.commandOnly || army);
  }

  /** The rows still consistent with what has been typed. The HUD's whole job. */
  candidates(ctx) {
    if (!this.entry) return this.available(ctx);
    return this.available(ctx).filter(s => s.code.startsWith(this.entry));
  }

  /**
   * ARM OR DISARM. Letting go abandons a half-entered code rather than leaving
   * it to time out — the key going up is a clearer statement of "I changed my
   * mind" than any timer, and a code left standing would fire on the next W
   * the player pressed to walk.
   */
  setArming(on) {
    if (on === this.arming) return;
    this.arming = on;
    if (!on && this.entry) { this.entry = ''; this.since = 0; }
    if (on) audio.ui('hover');
  }

  /**
   * ONE LETTER.
   *
   * Returns the stratagem it completed, `false` if the letter took the entry
   * nowhere (which clears it — a wrong letter is a failed code, not a
   * character to backspace), and `null` while a code is still being spelled.
   */
  feed(dir, ctx) {
    if (!this.arming || !DIRS.includes(dir)) return null;
    const next = this.entry + dir;
    const live = this.available(ctx).filter(s => s.code.startsWith(next));
    if (!live.length) {
      this.entry = '';
      this.since = 0;
      this._say('no such call');
      audio.ui('bad');
      return false;
    }
    this.entry = next;
    this.since = 0;
    audio.ui('click');
    const done = live.find(s => s.code === next);
    if (!done) return null;
    this.entry = '';
    this._call(done, ctx);
    return done;
  }

  /** Say something, briefly, to whoever is painting the HUD. */
  _say(text) { this.said = text; this.saidT = 2.2; }

  /**
   * THE CALL ITSELF — charged, cooled and queued.
   *
   * The Force is spent through the OWNER's own spender, not by subtracting
   * from a pool here: `_spend` is where the difficulty's drain multiplier and
   * the boon cost modifier are applied, and a caller that did its own
   * arithmetic would be a stratagem that ignored both.
   */
  _call(s, ctx) {
    const p = this.owner;
    if ((this.cooldowns[s.id] ?? 0) > 0) {
      this._say(`${s.name}: ${this.cooldowns[s.id].toFixed(0)}s`);
      audio.ui('bad');
      return false;
    }
    if (p?._spend && !p._spend(s.cost)) {
      this._say(`${s.name}: not enough Force`);
      audio.ui('bad');
      return false;
    }
    this.cooldowns[s.id] = s.cooldown;
    const site = new THREE.Vector3();
    if (s.at === 'aim') this._aimSite(ctx, site);
    else site.copy(p.position);
    /* THE MARK IS PART OF THE MECHANIC and not decoration. A call with a lead
     * that landed with no warning would be a delayed instant-kill; a ring on
     * the ground is what makes standing somewhere else the counter-play — for
     * the player, and for anything that learns to read it. Carried on the
     * pending record rather than as a separate list, because it is a property
     * of the inbound call and dies with it. */
    this.pending.push({ s, site, t: s.lead, mark: s.lead > 0.4 ? s.lead : 0 });
    this._say(s.lead > 0.2 ? `${s.name} — ${s.lead.toFixed(1)}s` : s.name);
    audio.force(p.chest ?? p.position, 'push');
    return true;
  }

  /**
   * WHERE YOU ARE LOOKING, ON THE GROUND.
   *
   * Walked forward in steps and stopped at the first sample under the terrain,
   * rather than solved: the terrain is a heightfield with no closed form, and
   * the alternative — a physics raycast — answers a different question (it
   * would stop on a crate, and a stratagem is called on GROUND). Capped at
   * `AIM_REACH`, and a call aimed at the sky lands at the cap, which is the
   * honest answer to "there is nothing there".
   */
  _aimSite(ctx, out) {
    const p = this.owner;
    const terrain = ctx?.terrain;
    const from = p.chest ?? p.position;
    const dir = p.aimDir;
    const STEP = 1.2, REACH = 90;
    out.copy(from).addScaledVector(dir, REACH);
    for (let d = STEP; d <= REACH; d += STEP) {
      _v1.copy(from).addScaledVector(dir, d);
      const h = terrain ? terrain.height(_v1.x, _v1.z) : 0;
      if (_v1.y <= h) { out.copy(_v1).setY(h); return out; }
    }
    out.y = terrain ? terrain.height(out.x, out.z) : 0;
    return out;
  }

  /** Run `fn` in `t` seconds. Cleared with everything else on unload. */
  after(t, fn) { this._timers.push({ t, fn }); }

  update(dt, ctx) {
    for (const id in this.cooldowns) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    }
    if (this.saidT > 0) this.saidT = Math.max(0, this.saidT - dt);
    if (this.entry) {
      this.since += dt;
      if (this.since > CODE_GAP) { this.entry = ''; this.since = 0; }
    }
    for (let i = this._timers.length - 1; i >= 0; i--) {
      const T = this._timers[i];
      T.t -= dt;
      if (T.t <= 0) { this._timers.splice(i, 1); T.fn(); }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const P = this.pending[i];
      P.t -= dt;
      if (P.mark && ctx?.particles) this._paintMark(ctx, P);
      if (P.t <= 0) { this.pending.splice(i, 1); P.s.fire(ctx, P.site, this); }
    }
  }

  /** The warning ring, tightening. Drawn every frame a call is inbound. */
  _paintMark(ctx, P) {
    const k = clamp(P.t / P.mark, 0, 1);
    const r = 1.6 + k * 5.4;
    for (let i = 0; i < 4; i++) {
      const a = ((i / 4) + (1 - k) * 1.7) * TAU;
      _v1.set(P.site.x + Math.cos(a) * r, P.site.y + 0.12, P.site.z + Math.sin(a) * r);
      ctx.particles.sparks.spawn(_v1, _v2.set(0, 0.4, 0),
        { life: 0.16, size: 0.1, drag: 2, gravity: 0, color: 0xffb020, alpha: 0.9 });
    }
  }

  /** Nothing outlives a level. */
  reset() { this.entry = ''; this.pending.length = 0; this._timers.length = 0; this.cooldowns = {}; }

  /* ── the effects, and every one of them is somebody else's verb ────── */

  /**
   * A HOLE IN THE GROUND AND EVERYTHING NEAR IT THROWN.
   *
   * `Player._shockwave` is centred on the player and this is not, so it cannot
   * be that call — but it must not be a second copy of it either. What it
   * shares is the RULE: `applyKnockback(impulse, damage, source)` is the one
   * door a blast goes through, it is what answers the target's own Force pool,
   * and it is called here exactly as the landing shockwave calls it.
   */
  blast(ctx, site, radius, force, damage) {
    const p = this.owner;
    if (ctx?.terrain?.crater) ctx.terrain.crater(site.x, site.z, radius * 0.5, 0.34);
    audio.explosion(site, clamp(radius / 5, 0.6, 2.2));
    for (const e of (ctx?.enemies || [])) {
      if (e.dead) continue;
      const d = e.position.distanceTo(site);
      if (d > radius) continue;
      const k = 1 - d / radius;
      _v1.subVectors(e.position, site).setY(0.7).normalize().multiplyScalar(force * k);
      e.applyKnockback(_v1, damage * k, p);
    }
    /* AND IT DOES NOT SPARE YOU. A support call that could not hurt its caller
     * is a button with no downside, and the lead time only means something if
     * standing in the marked circle is a mistake. Halved, because the caller
     * knew it was coming — the enemy did not. */
    if (p && !p.dead) {
      const d = p.position.distanceTo(site);
      if (d < radius) p.damage?.(damage * (1 - d / radius) * 0.5, site, null, 'explosion');
    }
    if (ctx?.physics) {
      for (const b of ctx.physics.bodies) {
        if (b.invMass === 0) continue;
        const d = b.position.distanceTo(site);
        if (d > radius) continue;
        const k = 1 - d / radius;
        _v1.subVectors(b.position, site).setY(0.6).normalize();
        b.applyImpulse(_v1.multiplyScalar(force * k * b.mass * 0.5), b.position);
      }
    }
    const P = ctx?.particles;
    if (!P) return;
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU;
      _v1.set(Math.cos(a), 0.35 + this.rand() * 0.8, Math.sin(a)).multiplyScalar(radius * 1.7);
      P.dust.spawn(_v2.copy(site).setY(site.y + 0.15), _v1,
        { life: 1.5, size: 0.7, drag: 2.0, gravity: 0.5,
          color: ctx.groundColor ?? 0xd8c8a8, alpha: 0.3, floor: site.y });
    }
    P.sparkBurst?.(site, null, 40, { speed: 16, color: 0xffb877 });
  }

  /**
   * SMOKE, AND IT ACTUALLY BLINDS.
   *
   * The particles are the visible half; the half that matters is that a body
   * inside the cloud cannot see through it. Rather than teach every shooter
   * about smoke, the cloud is registered on the world as an OCCLUDER and the
   * one place that already asks "can I see my target" reads it — see
   * `world.smokeBlocks`. One question, one answer, both sides subject to it.
   */
  smoke(ctx, site, radius, life) {
    const w = ctx?.world || this.owner?.world;
    if (w?.addSmoke) w.addSmoke(site.clone(), radius, life);
    audio.noise({ dur: 0.9, gain: 0.3, type: 'lowpass', freq: 1400, freqEnd: 300,
      pink: true, attack: 0.02, pos: site });
    const P = ctx?.particles;
    if (!P) return;
    for (let i = 0; i < 60; i++) {
      const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * radius;
      _v1.set(site.x + Math.cos(a) * r, site.y + 0.2, site.z + Math.sin(a) * r);
      _v2.set((this.rand() - 0.5) * 1.2, 0.5 + this.rand(), (this.rand() - 0.5) * 1.2);
      P.dust.spawn(_v1, _v2, { life: life * (0.6 + this.rand() * 0.6), size: 2.6, drag: 1.1,
        gravity: -0.06, color: 0xb9c2cc, alpha: 0.34, floor: site.y });
    }
  }

  /** More of yours, through the director that already knows how to land them. */
  reinforce(ctx, n) {
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (!cmd?.reinforce) { this._say('no line to reinforce'); return; }
    cmd.reinforce(n, { byShip: true });
  }

  /** Steady the line — the commander's own morale verb, not a new one. */
  rally(ctx, radius) {
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (!cmd?.rallyNear) { this._say('nobody to rally'); return; }
    const n = cmd.rallyNear(this.owner.position, radius);
    this._say(n ? `rallied ${n}` : 'nobody in earshot');
  }

  /** A pod: health for the caller, and the wounded around them back up. */
  resupply(ctx, site, radius) {
    const p = this.owner;
    audio.thud(site, 1.4);
    if (p && !p.dead) p.heal?.(45);
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (cmd?.reviveNear) cmd.reviveNear(site, radius);
    const P = ctx?.particles;
    if (!P) return;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      _v1.set(Math.cos(a), 0.6, Math.sin(a)).multiplyScalar(3.4);
      P.sparks.spawn(_v2.copy(site).setY(site.y + 0.3), _v1,
        { life: 0.7, size: 0.09, drag: 1.6, gravity: 0.3, color: 0x8fffc0, alpha: 0.9 });
    }
  }
}
