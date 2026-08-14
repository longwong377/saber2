/**
 * SABER — heads-up display.
 *
 * DOM over the canvas: cheap, crisp at any resolution, and it keeps text out
 * of the render target where bloom would eat it.
 */

import * as THREE from 'three';
import { clamp, lerp } from '../engine/MathUtil.js';
import { Announcer } from './Announcer.js';
import { Presence } from '../engine/Presence.js';
import { keyLabel } from '../engine/Bindings.js';
import { POWER_COST, POWER_BOON } from '../game/Powers.js';

const _v = new THREE.Vector3();
const num = (v, d) => (Number.isFinite(v) ? v : d);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE RETICLE                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A reticle is a personal thing, and this one was a hard-coded ring.
 *
 * It sits in the exact centre of the screen for the entire game, so its shape,
 * its size and its colour are the settings a player is most likely to have an
 * opinion about — and the ring was drawn once in index.html with a white stroke
 * baked into styles.css, so there was nothing to have an opinion about.
 *
 * Each shape draws itself into the same 100×100 viewBox with the colour written
 * as a presentation attribute rather than a style. That is deliberate: an
 * attribute loses to a stylesheet rule, so `#reticle.hot .ret-*` still turns the
 * whole thing red when something is close enough to kill you. A custom colour
 * that could hide the threat state would be a customisation that removes
 * information, which is not a customisation.
 */
export const RETICLE_SHAPES = [
  {
    id: 'ring', name: 'Ring',
    draw: (c) => `<circle class="ret-ring" cx="50" cy="50" r="15" stroke="${c}"></circle>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.4" fill="${c}"></circle>`
      + `<path class="ret-tick" d="M50 26 v6 M50 68 v6 M26 50 h6 M68 50 h6" stroke="${c}"></path>`,
  },
  {
    id: 'dot', name: 'Dot',
    draw: (c) => `<circle class="ret-dot" cx="50" cy="50" r="2.6" fill="${c}"></circle>`,
  },
  {
    id: 'cross', name: 'Cross',
    draw: (c) => `<path class="ret-tick" d="M50 30 v11 M50 59 v11 M30 50 h11 M59 50 h11" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.2" fill="${c}"></circle>`,
  },
  {
    id: 'chevron', name: 'Chevron',
    draw: (c) => `<path class="ret-ring" d="M34 62 L50 44 L66 62" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.3" fill="${c}"></circle>`,
  },
  {
    id: 'brackets', name: 'Brackets',
    draw: (c) => `<path class="ret-ring" d="M32 40 v-8 h8 M68 40 v-8 h-8 M32 60 v8 h8 M68 60 v8 h-8" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.3" fill="${c}"></circle>`,
  },
  {
    id: 'pip', name: 'Pip',
    draw: (c) => `<path class="ret-tick" d="M50 32 v9" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.8" fill="${c}"></circle>`,
  },
  // Not an empty option for the sake of one: in first person with the blade
  // cursor on, the centre ring is genuinely redundant, and some players aim
  // down the blade.
  { id: 'none', name: 'None', draw: () => '' },
];

export const RETICLE_COLORS = [
  { name: 'Bone', hex: '#ffffff' },
  { name: 'Blade', hex: '#7fd6ff' },
  { name: 'Amber', hex: '#ffb64a' },
  { name: 'Verdant', hex: '#5dffa8' },
  { name: 'Violet', hex: '#b39dff' },
  { name: 'Crimson', hex: '#ff6b74' },
  { name: 'Ion', hex: '#66ff99' },
  { name: 'Ash', hex: '#9fb0c6' },
];

const pick = (list, i) => list[((Math.round(num(i, 0)) % list.length) + list.length) % list.length];
export const shapeAt = (i) => pick(RETICLE_SHAPES, i);
export const colorAt = (i) => pick(RETICLE_COLORS, i);

/** The base width of the reticle box in CSS pixels, at scale 1. */
export const RETICLE_BASE = 44;

/**
 * Repaint the reticle from the settings — and only when they have moved.
 *
 * Exported and given the element rather than owned by the HUD instance because
 * the OPTIONS SCREEN needs it too: the three controls live on a pause card
 * where `HUD.update` is not running, so without a shared entry point a player
 * would change the colour and see nothing until they resumed. One function, two
 * callers, no second copy of the shape table in Menu.js.
 *
 * @returns the signature it painted, or null if there was nothing to paint.
 */
export function applyReticle(el, s = {}) {
  if (!el || !s) return null;
  const shape = shapeAt(s.reticleShape);
  const col = colorAt(s.reticleColor);
  const size = clamp(num(s.reticleSize, 1), 0.45, 2.4);
  const sig = `${shape.id}|${col.hex}|${size.toFixed(3)}`;
  if (el._retSig === sig) return sig;
  el._retSig = sig;
  el.innerHTML = shape.draw(col.hex);
  const px = `${(RETICLE_BASE * size).toFixed(1)}px`;
  el.style.width = px;
  el.style.height = px;
  return sig;
}

/**
 * The wheel's slots, in order, each with the ACTION ID it is labelled from.
 * The two are not always the same word — the wheel calls it `throw` and the
 * bindings table calls the action `throw` too, but `grip` on the wheel is the
 * hold-to-grip action and there is a second `grip2` for the one-handed stance.
 * Naming them separately is what stops the next edit guessing.
 */
export const POWERS = [
  ['push', 'push'], ['pull', 'pull'], ['grip', 'grip'], ['throw', 'throw'],
  ['sense', 'sense'], ['lightning', 'lightning'], ['stasis', 'stasis'],
  ['heal', 'heal'], ['compel', 'compel'],
];

/**
 * WHAT EACH SLOT COSTS — IMPORTED, NOT COPIED.
 *
 * This file used to carry its own nine numbers, and it had already been burned
 * by them once: the copies had lightning at 14 against a real 30 and stasis at
 * 30 against a real 26. The stopgap was tools/checks/hud-events.mjs GREPPING
 * each spend out of Player.js and matching it here, which holds only for as
 * long as the regex recognises the shape of the line it is looking for.
 *
 * It also had to describe three DIFFERENT gates, because three of Player's
 * nine powers bypassed `_spend`/`_canSpend`: throw and sense compared raw
 * force against a literal, and lightning applied the boon multiplier by hand
 * but not the drain. So Force Drain at 0 — the Options slider whose own label
 * reads "unlimited Force" — freed six powers and left three still charging,
 * and this wheel had to state that rather than the rule.
 *
 * Both are fixed in Player. One table, one gate, one import — and the table
 * lives in a leaf module rather than in Player, because HUD → Player → Menu →
 * HUD is a real import cycle in this tree.
 */
export { POWER_COST, POWER_BOON };

/** A key label is drawn into innerHTML; three characters can break it. */
const escKey = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const POWER_ICONS = {
  push:  '<svg viewBox="0 0 24 24"><path d="M4 12h10M14 8l4 4-4 4M18 5v14"/></svg>',
  pull:  '<svg viewBox="0 0 24 24"><path d="M20 12H10M10 8l-4 4 4 4M6 5v14"/></svg>',
  grip:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/></svg>',
  throw: '<svg viewBox="0 0 24 24"><path d="M6 18L18 6M18 6h-5M18 6v5"/><circle cx="6" cy="18" r="2.2"/></svg>',
  sense: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
  jump:  '<svg viewBox="0 0 24 24"><path d="M12 20V6M8 10l4-4 4 4M5 21h14"/></svg>',
  lightning: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-2 7 8-11h-6z"/></svg>',
  // Stasis is a held bolt: a ring with the shot stopped inside it.
  stasis: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9 12h6"/><circle cx="12" cy="12" r="1.6"/></svg>',
  // Heal is the one power that gives rather than takes.
  heal: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/><circle cx="12" cy="12" r="8.5"/></svg>',
  // Compel turns a muzzle around: an arrow bent back on itself.
  compel: '<svg viewBox="0 0 24 24"><path d="M6 9h9a4 4 0 0 1 0 8H9"/><path d="M12 14l-3 3 3 3"/></svg>',
};

export class HUD {
  constructor(root = document) {
    this.el = {
      hud: root.getElementById('hud'),
      perf: root.getElementById('hud-perf'),
      wave: root.getElementById('hud-wave'),
      // The word in front of the number. It is an element rather than the bare
      // text node the HUD used to reach for by position — see the wave block
      // in update() for the session-long 'LESSON' that cost.
      waveWord: root.getElementById('hud-wave-word'),
      level: root.getElementById('hud-level'),
      diff: root.getElementById('hud-diff'),
      remaining: root.getElementById('hud-remaining'),
      hp: root.getElementById('bar-hp'),
      hpGhost: root.getElementById('bar-hp-ghost'),
      force: root.getElementById('bar-force'),
      stam: root.getElementById('bar-stam'),
      flow: root.getElementById('hud-flow'),
      flowFill: root.querySelector('#hud-flow i'),
      combo: root.getElementById('hud-combo'),
      score: root.getElementById('hud-score'),
      center: root.getElementById('hud-center-msg'),
      hitmarks: root.getElementById('hitmarks'),
      killfeed: root.getElementById('killfeed'),
      coach: root.getElementById('coach'),
      coachTitle: root.getElementById('coach-title'),
      coachCount: root.getElementById('coach-count'),
      coachBrief: root.getElementById('coach-brief'),
      coachHint: root.getElementById('coach-hint'),
      coachFill: root.getElementById('coach-fill'),
      lock: root.getElementById('lockmeter'),
      lockFill: root.getElementById('lock-fill'),
      why: root.getElementById('deflect-why'),
      boss: root.getElementById('bossbar'),
      bossLabel: root.getElementById('boss-label'),
      bossPhase: root.getElementById('boss-phase'),
      bossFill: root.getElementById('boss-fill'),
      boons: root.getElementById('boon-strip'),
      powers: root.getElementById('power-wheel'),
      reticle: root.getElementById('reticle'),
      events: root.getElementById('event-feed'),
      cursor: root.getElementById('blade-cursor'),
      flowVig: root.getElementById('flow-vignette'),
      dmgVig: root.getElementById('dmg-vignette'),
    };
    this.hpGhostValue = 1;
    this.centerTimer = 0;
    this._buildPowers();
    this._marks = [];
    this.whyTimer = 0;
    /**
     * The two systems that make the fight audible, driven from the one place
     * that already gets the world, the player and the camera once a frame.
     *
     * They live behind the HUD rather than in World because World.js belongs to
     * another lane and because neither of them is simulation: the announcer
     * DIFFERENCES the same numbers this file already draws, and Presence reads
     * positions. Nothing here writes to the world.
     */
    this.announcer = new Announcer();
    this.presence = new Presence();
    this._pops = [];
    this.popupsOn = true;
  }

  /**
   * THE POWER WHEEL, LABELLED FROM THE BINDINGS TABLE.
   *
   * It used to carry five typed letters: `[['push','F'],['pull','⇧F'],
   * ['grip','G'],['throw','R'],['sense','C']]`, built once from the
   * constructor. Two of the five were wrong on a fresh install — pull is bound
   * to R and throw to H, so the wheel told the player to press R to throw and
   * pressing R Force-pulled instead — and none of the five followed a rebind,
   * ever. The wheel is on screen for the whole fight.
   *
   * `POWERS` is the list, in wheel order, with the action id each slot reads.
   * The label comes from `keyLabel(bindings[id][0])`, which is what the Codex
   * and the coaching panel already do; `setBindings` is called from main.js's
   * `onBindings` hook, beside the `refreshCoachKeys()` that exists for exactly
   * this reason.
   *
   * Nine slots, not five. The other four — lightning, stasis, heal, compel —
   * all carry a real cooldown in `Player.cooldowns` and a real Force cost, and
   * had no readout anywhere; `lightning` even had an icon sitting unused in
   * POWER_ICONS. A cooldown the player cannot see is a cooldown they learn by
   * pressing the key and getting nothing.
   */
  _buildPowers(bindings = null) {
    this.powerEls = {};
    this.el.powers.innerHTML = '';
    for (const [key, action] of POWERS) {
      const d = document.createElement('div');
      d.className = 'pw';
      const label = bindings ? keyLabel((bindings[action] || [])[0]) : '';
      d.innerHTML = `${POWER_ICONS[key] || ''}<span>${escKey(label)}</span><div class="cd"></div>`;
      this.el.powers.appendChild(d);
      this.powerEls[key] = { root: d, cd: d.querySelector('.cd'), label: d.querySelector('span') };
    }
    this._bindings = bindings;
  }

  /** Repaint the wheel's key labels. Called on boot and after any rebind. */
  setBindings(bindings) {
    this._bindings = bindings;
    for (const [key, action] of POWERS) {
      const p = this.powerEls[key];
      if (p && p.label) p.label.textContent = keyLabel((bindings[action] || [])[0]);
    }
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  setLevel(name, difficulty) {
    this.el.level.textContent = name;
    this.el.diff.textContent = difficulty;
  }

  update(dt, world, player, camera) {
    if (!player) return;
    const el = this.el;

    // ── bars
    const hp = player.hp / player.maxHp;
    el.hp.style.transform = `scaleX(${clamp(hp, 0, 1)})`;
    this.hpGhostValue = Math.max(hp, this.hpGhostValue - dt * 0.35);
    el.hpGhost.style.transform = `scaleX(${clamp(this.hpGhostValue, 0, 1)})`;
    el.hp.parentElement.classList.toggle('low', hp < 0.3);
    el.force.style.transform = `scaleX(${clamp(player.force / player.maxForce, 0, 1)})`;
    // Focus reads on the Force bar itself — it is Force being spent, and
    // showing it anywhere else would hide the trade the ability is built on.
    const fs = world?.focus;
    if (fs) el.force.parentElement.classList.toggle('focus', fs.held > 0.05);
    el.stam.style.transform = `scaleX(${clamp(player.stamina / player.maxStamina, 0, 1)})`;
    el.stam.parentElement.classList.toggle('low', player.stamina / player.maxStamina < 0.25);

    // ── flow
    el.flowFill.style.width = `${clamp(player.flow, 0, 1) * 100}%`;
    el.flow.classList.toggle('max', player.flow > 0.92);
    el.flowVig.style.opacity = (player.flow * 0.55).toFixed(3);
    el.dmgVig.style.opacity = clamp(1 - hp * 1.6, 0, 0.75).toFixed(3);

    // ── combo / score
    if (player.combo > 1) {
      el.combo.textContent = `${player.combo}×`;
      el.combo.classList.add('on');
    } else el.combo.classList.remove('on');
    el.score.textContent = Math.floor(world.score + player.score).toLocaleString();

    /* ── wave, or lesson in Training ──────────────────────────────────
     *
     * THE WORD IS WRITTEN ON EVERY FRAME, IN BOTH DIRECTIONS.
     *
     * It used to be written in one: the training branch reached through
     * `el.wave.previousSibling` into the bare text node in front of the number
     * and typed 'LESSON ' into it, and the else branch below touched only
     * `#hud-remaining`. The HUD is a module-scope singleton built once against
     * markup that is never rebuilt, and Training is an ordinary selectable
     * mode, so ONE training deploy renamed the counter for the rest of the
     * session: pick Training, deploy, Abandon, deploy Trial of Waves, and the
     * top-left reads 'LESSON 7' for that fight and every fight after it, until
     * the page is reloaded. Measured on the real HUD against the real page:
     * "WAVE 3" -> "LESSON 3" -> "LESSON 3", where the third should have been
     * "WAVE 3" again.
     *
     * The word has its own element now (index.html, `#hud-wave-word`) rather
     * than the HUD reaching into an anonymous text node by position — a node
     * found by `firstChild` is a node any edit to that line can move, and two
     * check harnesses had already stubbed `previousSibling` to null, which
     * short-circuited the whole branch and hid this.
     */
    el.wave.textContent = world.director.wave;
    if (el.waveWord) el.waveWord.textContent = world.training ? 'LESSON' : 'WAVE';
    if (world.training) {
      const st = world.director.state();
      el.remaining.textContent = st.need === Infinity ? 'free practice' : `${st.progress} of ${st.need}`;
    } else {
      const remaining = world.director.remaining;
      el.remaining.textContent = world.director.active
        ? `${remaining} remaining`
        : (world.director.intermission > 900 ? 'attune' : `next wave in ${Math.ceil(world.director.intermission)}`);
    }

    // ── powers
    //
    // Cooldowns go in as SECONDS REMAINING, not as a fraction of a divisor
    // typed in here — see _power for the measurement that replaced the four
    // wrong divisors. Affordability goes through _afford, which asks the
    // player's own economy rather than comparing against a literal.
    const cd = player.cooldowns;
    this._power('push', cd.push, this._afford(player, 'push'));
    this._power('pull', cd.pull, this._afford(player, 'pull'));
    this._power('grip', 0, this._afford(player, 'grip'), !!(player.gripBody || player.gripEnemy));
    this._power('throw', cd.throw, this._afford(player, 'throw'), player.throwState !== 'held');
    this._power('sense', 0, this._afford(player, 'sense'), player.senseActive);
    // The four that had no readout at all until recently, and had a wrong one
    // until this edit. `lightning` has no "on" state to show — it is a single
    // discharge, and the flag the wheel used to read (`player.lightningOn`)
    // exists nowhere in src/, so that slot's active border could never light.
    this._power('lightning', cd.lightning, this._afford(player, 'lightning'));
    this._power('stasis', cd.stasis, this._afford(player, 'stasis'), player.stasis?.bodies?.size > 0);
    // `healing` is elapsed seconds or null (`Player.forceHeal` sets it to 0), so it is `0`
    // on the first frame of a heal — `!!player.healing` would blink the border
    // off at exactly the moment the power starts.
    this._power('heal', cd.heal, this._afford(player, 'heal'), player.healing != null);
    this._power('compel', cd.compel, this._afford(player, 'compel'));

    // ── reticle & blade cursor
    const firstPerson = !!player.camera.firstPerson;
    const threat = world.enemies.some(e => !e.dead && e.position.distanceToSquared(player.position) < 25);
    el.reticle.classList.toggle('hot', threat);
    // full strength: a reticle you cannot see is not a reticle
    el.reticle.style.opacity = firstPerson ? 1 : 0.9;
    // Shape, size and colour, repainted only when one of the three has moved.
    applyReticle(el.reticle, world.settings);

    /* THE BLADE CURSOR IS A FIRST-PERSON INSTRUMENT AND NOTHING ELSE.
     *
     * It answers one question — where is the blade pointing, as distinct from
     * where am I looking — and that question only exists when the blade is not
     * on screen. In third person it IS on screen: screenGuard projects the
     * guard point, which is the base of the blade, so the ring lands ON the
     * blade every frame of every third-person game and reads as a second
     * reticle stuck to the weapon. Reported as exactly that. The answer is not
     * to move it, it is that in third person the blade is its own cursor.
     *
     * Hidden with the class rather than by leaving it transparent: `opacity`
     * is written below out of the steering branch, so an invisible-by-opacity
     * cursor comes back the moment the player grips, and a display:none node
     * costs no layout either. The centre reticle is untouched — it is the AIM,
     * a different instrument, and it is drawn in both views. */
    if (el.cursor) {
      el.cursor.classList.toggle('hidden', !firstPerson);
      // and mark the blade cursor while the player is actually driving the blade
      el.cursor.classList.toggle('steering', firstPerson && !!player.control?.steering);
    }

    if (firstPerson && el.cursor && player.control._grip) {
      const g = player.control.screenGuard(camera, player.chest, player.camera.aimQuat, _screen);
      const x = (g.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-g.y * 0.5 + 0.5) * window.innerHeight;
      el.cursor.style.transform = `translate(${x - window.innerWidth / 2}px, ${y - window.innerHeight / 2}px)`;
      const heat = clamp(player.saber.tipSpeed / 26, 0, 1);
      el.cursor.style.opacity = (0.25 + heat * 0.75).toFixed(2);
      el.cursor.firstElementChild.style.transform = `scale(${(0.7 + heat * 0.75).toFixed(2)})`;
    }

    // ── boss bar: whichever boss is alive and nearest
    let boss = null;
    for (const e of world.enemies) {
      if (e.dead || !e.A.boss && !e.A.big) continue;
      if (!boss || e.position.distanceToSquared(player.position) < boss.position.distanceToSquared(player.position)) boss = e;
    }
    if (boss) {
      el.boss.classList.remove('hidden');
      el.bossLabel.textContent = boss.A.label;
      el.bossPhase.textContent = boss.bossPhase ? `PHASE ${boss.bossPhase}` : '';
      el.bossFill.style.transform = `scaleX(${clamp(boss.hp / boss.maxHp, 0, 1)})`;
    } else el.boss.classList.add('hidden');

    // ── blade lock: a bar that runs out from the centre either way
    const lock = player.lockState;
    if (lock && !lock.done) {
      el.lock.classList.remove('hidden');
      const p01 = clamp(lock.pressure, -1, 1);
      const halfPct = Math.abs(p01) * 50;
      el.lockFill.style.width = `${halfPct}%`;
      el.lockFill.style.left = p01 >= 0 ? '50%' : `${50 - halfPct}%`;
      el.lockFill.classList.toggle('losing', p01 < 0);
    } else if (!el.lock.classList.contains('hidden')) {
      el.lock.classList.add('hidden');
    }

    // ── the line that says why the last deflection graded as it did
    if (this.whyTimer > 0) {
      this.whyTimer -= dt;
      if (this.whyTimer <= 0) el.why.classList.remove('on');
    }

    // ── center message
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) el.center.classList.remove('on');
    }

    // ── floating marks
    for (let i = this._marks.length - 1; i >= 0; i--) {
      const m = this._marks[i];
      m.t += dt;
      if (m.t > 1.05) { m.node.remove(); this._marks.splice(i, 1); continue; }
      _v.copy(m.pos).project(camera);
      if (_v.z > 1) { m.node.style.display = 'none'; continue; }
      m.node.style.display = '';
      m.node.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
      m.node.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
    }

    /**
     * ── the room, and what it has to say about itself
     *
     * Last, and after the early return above, so both systems see a frame the
     * HUD has already agreed is drawable. `popups` is read here rather than
     * inside popup() so that the gate is one property read per frame instead of
     * one per event, and so the reader named in SETTING_READERS is on the
     * element that owns the feed.
     */
    this.popupsOn = world.settings ? world.settings.popups !== false : true;
    this.announcer.update(dt, world, player, this);
    this.presence.update(dt, world);
  }

  /**
   * ONE EVENT, IN THE HUD'S OWN VOICE.
   *
   * Not a banner across the middle of the screen: that space belongs to
   * `message()`, which the wave director already uses, and a killstreak
   * competing with "WAVE 7" is two things shouting. The feed sits under the
   * score in the top-right corner — where the combo counter and the score
   * already are, which is where the eye goes after a kill — in the same mono
   * face and the same letter-spacing as everything else in that column, so it
   * reads as the score block saying something rather than as an overlay
   * arriving on top of the game.
   */
  popup(title, sub = '', kind = 'event') {
    if (!this.popupsOn) return null;
    const host = this.el.events;
    if (!host) return null;
    const node = document.createElement('div');
    node.className = `ev ev-${kind}`;
    node.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    host.appendChild(node);
    this._pops.push(node);
    // Four at once is already a wall; the oldest leaves rather than the newest
    // being refused, because the newest is the one that just happened.
    while (this._pops.length > 4) drop(this._pops.shift(), host);
    setTimeout(() => { drop(node, host); const i = this._pops.indexOf(node); if (i >= 0) this._pops.splice(i, 1); }, 2800);
    return node;
  }

  /**
   * ONE SLOT OF THE WHEEL: A SHUTTER THAT IS MEASURED, AND A GATE THAT ASKS.
   *
   * `cd` is SECONDS REMAINING. It used to be a fraction the caller computed by
   * dividing by a cooldown constant typed into HUD.update, and four of the nine
   * divisors disagreed with the power they described: lightning divided by 0.35
   * against a real 1.5 s (`Player.forceLightning`), stasis by 0.8 against 1.4, heal by 8
   * against 9, compel by 6 against 7. Since `clamp(cd, 0, 1)` pins anything
   * over 1 to a full shutter, Force Lightning read "just used" for 1.15 s of
   * its 1.5 s wait and then emptied in the last 0.35 s — the bar said nothing
   * for three quarters of the countdown it exists to show.
   *
   * The fix is not a better table. It is that the HUD does not need to know any
   * cooldown at all: it watches the number it is given, remembers the highest
   * value of the current wait, and draws the ratio. That is right for every
   * power automatically, including heal, whose cooldown is 9 s when it
   * completes and 3 s when it is interrupted (`Player._endHeal`) — a constant
   * divisor cannot be right for both, and a peak is right for both. Change a
   * cooldown in Player and this follows it in the same frame, with no second
   * copy of the number anywhere.
   *
   * The peak is captured within one frame of the power firing (the wheel runs
   * after the player's update, so the worst case is a 60th of a second of decay
   * already applied — 1.6% of a 1 s cooldown) and is cleared the moment the
   * wait reaches zero, so nothing leaks between uses.
   */
  _power(key, cd, affordable, active) {
    const p = this.powerEls[key];
    if (!p) return;
    const peaks = this._cdPeak || (this._cdPeak = {});
    const left = Math.max(0, num(cd, 0));
    if (left <= 0) peaks[key] = 0;
    else if (left > (peaks[key] || 0)) peaks[key] = left;
    const shutter = peaks[key] > 0 ? left / peaks[key] : 0;
    p.cd.style.transform = `scaleY(${clamp(shutter, 0, 1)})`;
    p.root.classList.toggle('ready', !!affordable && left <= 0.01);
    p.root.classList.toggle('active', !!active);
  }

  /**
   * CAN THE PLAYER ACTUALLY PAY FOR THIS, IN THE GAME AS CONFIGURED.
   *
   * The wheel used to compare `player.force` against a literal per slot, and
   * two of the nine literals were simply the wrong price — lightning was gated
   * at 14 against a real 30 (`Player.forceLightning`), so the slot said READY and the
   * key answered "30 FORCE NEEDED, YOU HAVE 20"; stasis was gated at 30 against
   * a real 26, so the slot dimmed for four Force it did not need. On top of
   * that, a raw comparison cannot see either of the two things that move the
   * price: `forceDrain`, whose own label in index.html reads "unlimited Force"
   * at 0 — with it there, every power is free and the wheel greyed them all out
   * anyway — and the `forceCost` boons.
   *
   * So the gate asks the player's own economy: `_canSpend` is the single
   * function Player uses to decide, and it reads drain and the boon multiplier
   * live. Three powers do NOT go through it in Player and are marked here
   * accordingly, because the HUD's job is to state the game that exists rather
   * than the one it would prefer: `throwOrRecall` and `toggleSense` compare raw
   * force against a literal and so ignore drain entirely, and `forceLightning`
   * applies the boon multiplier by
   * hand but not the drain. Those three are a real inconsistency in Player's
   * Force economy and are worth fixing THERE; until they are, this wheel tells
   * the truth about them. See tools/checks/hud-events.mjs, which pins every
   * number below to the line of Player.js it came from.
   */
  _afford(player, key) {
    const cost = POWER_COST[key];
    if (cost == null || !player) return true;
    // Force Lightning is drafted, not learned: without the boon the key
    // refuses no matter how much Force is in the bar.
    const boon = POWER_BOON[key];
    if (boon && !player.boonMods?.[boon]) return false;
    // ONE gate for all nine — `_canSpend` is the single function Player uses to
    // decide, and it reads the drain slider and the boon multiplier live. There
    // used to be three gates here because three powers bypassed it; they do not
    // any more, so the wheel no longer has to describe an exception.
    return typeof player._canSpend === 'function'
      ? player._canSpend(cost)
      : player.force >= cost * (player.boonMods?.forceCost ?? 1);
  }

  /** Dojo coaching panel. */
  setCoach(state) {
    const el = this.el;
    if (!state) { el.coach.classList.add('hidden'); return; }
    el.coach.classList.remove('hidden');
    el.coachTitle.textContent = state.title;
    el.coachCount.textContent = state.need === Infinity
      ? `${state.index + 1}/${state.total}`
      : `${state.progress}/${state.need}`;
    el.coachBrief.textContent = state.brief;
    el.coachHint.textContent = state.form ? `${state.hint}  ·  sparring: ${state.form}` : state.hint;
    const frac = state.need === Infinity ? 1 : clamp(state.progress / state.need, 0, 1);
    el.coachFill.style.width = `${frac * 100}%`;
  }
  showCoach(on) { this.el.coach.classList.toggle('hidden', !on); }

  /** One short line explaining the last deflection or clash. */
  explain(text, colour = '#9fb0c6', duration = 1.6) {
    if (!text) return;
    this.el.why.textContent = text;
    this.el.why.style.color = colour;
    this.el.why.classList.add('on');
    this.whyTimer = duration;
  }

  message(title, sub, duration = 2.4) {
    this.el.center.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.el.center.classList.add('on');
    this.centerTimer = duration;
  }

  floating(worldPos, text, color = '#fff') {
    const node = document.createElement('div');
    node.className = 'hm';
    node.textContent = text;
    node.style.color = color;
    this.el.hitmarks.appendChild(node);
    this._marks.push({ node, pos: worldPos.clone(), t: 0 });
    if (this._marks.length > 26) { const m = this._marks.shift(); m.node.remove(); }
  }

  /**
   * The frame cost, on screen, in the corner.
   *
   * Refreshed four times a second rather than every frame: at 60 Hz a number
   * that changes 60 times a second is unreadable, and — worse — reading it
   * would then be a measurement of the profiler. The values shown are the
   * WINDOW's statistics, not this frame's, for the same reason.
   *
   * The 1% low is deliberately given equal billing to the mean. A build that
   * averages 8 ms and hitches to 40 four times a second reads as "smooth" in
   * an average and feels broken to play, and "it runs like shit and gets worse"
   * is a complaint about the second number, never the first.
   */
  perf(profiler, show) {
    const el = this.el.perf;
    if (!el) return;
    if (!show) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this._perfAt = (this._perfAt || 0) + 1;
    if (this._perfAt % 15) return;
    const s = profiler.stats();
    if (!s) { el.textContent = 'measuring…'; return; }
    const gpu = profiler.gpuMs == null ? 'n/a' : profiler.gpuMs.toFixed(1);
    el.textContent =
      `${s.mean.toFixed(1)} ms  ${s.fps.toFixed(0)} fps\n`
      + `1% low ${s.low1.toFixed(1)}  p99 ${s.p99.toFixed(1)}\n`
      + `cpu ${profiler.cpuMs.toFixed(1)}  gpu ${gpu}\n`
      + `${profiler.calls} calls  ${(profiler.triangles / 1000).toFixed(0)}k tris`;
  }

  hitmark(worldPos, kind, bone) {
    const map = {
      hit: ['·', '#dfe8f5'],
      cut: [bone ? SEVER_LABEL[bone] || 'CUT' : 'CUT', '#8fe8ff'],
      sever: [SEVER_LABEL[bone] || 'SEVERED', '#a8f0ff'],
      kill: ['KILL', '#ffd88a'],
    }[kind] || ['·', '#fff'];
    this.floating(worldPos, map[0], map[1]);
  }

  killFeed(who, what, kind) {
    const node = document.createElement('div');
    node.className = 'kf';
    const verb = kind === 'cut' ? 'cut down' : kind === 'bolt' ? 'returned fire on' : 'destroyed';
    // `who` is a player name, which in co-op arrives from another machine
    // (Net.js reads it off `conn.metadata`). The popup feed and the boon chips
    // in this file already escape; this line did not.
    node.innerHTML = `<b>${esc(who)}</b> ${verb} ${esc(what)}`;
    this.el.killfeed.appendChild(node);
    setTimeout(() => node.remove(), 4200);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
  }

  setBoons(boons) {
    this.el.boons.innerHTML = '';
    for (const b of boons) {
      const d = document.createElement('div');
      d.className = 'bn';
      d.textContent = `${b.icon} ${b.name}`;
      this.el.boons.appendChild(d);
    }
  }
}

const SEVER_LABEL = {
  head: 'DECAPITATED', neck: 'DECAPITATED',
  chest: 'BISECTED', spine: 'BISECTED', hips: 'BISECTED', body: 'BISECTED',
  armL: 'ARM', armR: 'ARM', foreL: 'ARM', foreR: 'ARM', handL: 'HAND', handR: 'HAND',
  thighL: 'LEG', thighR: 'LEG', shinL: 'LEG', shinR: 'LEG', footL: 'FOOT', footR: 'FOOT',
  clavL: 'SHOULDER', clavR: 'SHOULDER',
};

const _screen = new THREE.Vector2();

/** Titles come from archetype labels, which are data. Data goes in as text. */
const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/** Detach a node whether it is a real one or a test double. */
function drop(node, host) {
  if (!node) return;
  try { if (typeof node.remove === 'function') { node.remove(); return; } } catch {}
  try { host?.removeChild?.(node); } catch {}
}
