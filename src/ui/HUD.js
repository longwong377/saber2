/**
 * SABER — heads-up display.
 *
 * DOM over the canvas: cheap, crisp at any resolution, and it keeps text out
 * of the render target where bloom would eat it.
 */

import * as THREE from 'three';
import { clamp, lerp } from '../engine/MathUtil.js';

const _v = new THREE.Vector3();

const POWER_ICONS = {
  push:  '<svg viewBox="0 0 24 24"><path d="M4 12h10M14 8l4 4-4 4M18 5v14"/></svg>',
  pull:  '<svg viewBox="0 0 24 24"><path d="M20 12H10M10 8l-4 4 4 4M6 5v14"/></svg>',
  grip:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/></svg>',
  throw: '<svg viewBox="0 0 24 24"><path d="M6 18L18 6M18 6h-5M18 6v5"/><circle cx="6" cy="18" r="2.2"/></svg>',
  sense: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
  jump:  '<svg viewBox="0 0 24 24"><path d="M12 20V6M8 10l4-4 4 4M5 21h14"/></svg>',
  lightning: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-2 7 8-11h-6z"/></svg>',
};

export class HUD {
  constructor(root = document) {
    this.el = {
      hud: root.getElementById('hud'),
      wave: root.getElementById('hud-wave'),
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
      boons: root.getElementById('boon-strip'),
      powers: root.getElementById('power-wheel'),
      reticle: root.getElementById('reticle'),
      cursor: root.getElementById('blade-cursor'),
      flowVig: root.getElementById('flow-vignette'),
      dmgVig: root.getElementById('dmg-vignette'),
    };
    this.hpGhostValue = 1;
    this.centerTimer = 0;
    this._buildPowers();
    this._marks = [];
  }

  _buildPowers() {
    const defs = [
      ['push', 'F'], ['pull', '⇧F'], ['grip', 'G'], ['throw', 'R'], ['sense', 'C'],
    ];
    this.powerEls = {};
    this.el.powers.innerHTML = '';
    for (const [key, label] of defs) {
      const d = document.createElement('div');
      d.className = 'pw';
      d.innerHTML = `${POWER_ICONS[key] || ''}<span>${label}</span><div class="cd"></div>`;
      this.el.powers.appendChild(d);
      this.powerEls[key] = { root: d, cd: d.querySelector('.cd') };
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

    // ── wave
    el.wave.textContent = world.director.wave;
    const remaining = world.director.remaining;
    el.remaining.textContent = world.director.active
      ? `${remaining} remaining`
      : (world.director.intermission > 900 ? 'attune' : `next wave in ${Math.ceil(world.director.intermission)}`);

    // ── powers
    this._power('push', player.cooldowns.push / 0.55, player.force >= 20);
    this._power('pull', player.cooldowns.pull / 0.6, player.force >= 16);
    this._power('grip', 0, player.force >= 10, !!(player.gripBody || player.gripEnemy));
    this._power('throw', player.cooldowns.throw / 0.4, player.force >= 14, player.throwState !== 'held');
    this._power('sense', 0, player.force >= 25, player.senseActive);

    // ── reticle & blade cursor
    const threat = world.enemies.some(e => !e.dead && e.position.distanceToSquared(player.position) < 25);
    el.reticle.classList.toggle('hot', threat);
    el.reticle.style.opacity = player.camera.firstPerson ? 0.75 : 0.45;

    if (player.control._grip) {
      const g = player.control.screenGuard(camera, player.chest, player.camera.aimQuat, _screen);
      const x = (g.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-g.y * 0.5 + 0.5) * window.innerHeight;
      el.cursor.style.transform = `translate(${x - window.innerWidth / 2}px, ${y - window.innerHeight / 2}px)`;
      const heat = clamp(player.saber.tipSpeed / 26, 0, 1);
      el.cursor.style.opacity = (0.25 + heat * 0.75).toFixed(2);
      el.cursor.firstElementChild.style.transform = `scale(${(0.7 + heat * 0.75).toFixed(2)})`;
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
  }

  _power(key, cd, affordable, active) {
    const p = this.powerEls[key];
    if (!p) return;
    p.cd.style.transform = `scaleY(${clamp(cd, 0, 1)})`;
    p.root.classList.toggle('ready', affordable && cd <= 0.01);
    p.root.classList.toggle('active', !!active);
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
    node.innerHTML = `<b>${who}</b> ${verb} ${what}`;
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
