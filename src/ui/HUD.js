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
      perf: root.getElementById('hud-perf'),
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
      cursor: root.getElementById('blade-cursor'),
      flowVig: root.getElementById('flow-vignette'),
      dmgVig: root.getElementById('dmg-vignette'),
    };
    this.hpGhostValue = 1;
    this.centerTimer = 0;
    this._buildPowers();
    this._marks = [];
    this.whyTimer = 0;
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

    // ── wave, or lesson if we are in the dojo
    el.wave.textContent = world.director.wave;
    if (world.training) {
      el.wave.previousSibling && (el.wave.parentElement.firstChild.textContent = 'LESSON ');
      const st = world.director.state();
      el.remaining.textContent = st.need === Infinity ? 'free practice' : `${st.progress} of ${st.need}`;
    } else {
      const remaining = world.director.remaining;
      el.remaining.textContent = world.director.active
        ? `${remaining} remaining`
        : (world.director.intermission > 900 ? 'attune' : `next wave in ${Math.ceil(world.director.intermission)}`);
    }

    // ── powers
    this._power('push', player.cooldowns.push / 0.55, player.force >= 20);
    this._power('pull', player.cooldowns.pull / 0.6, player.force >= 16);
    this._power('grip', 0, player.force >= 10, !!(player.gripBody || player.gripEnemy));
    this._power('throw', player.cooldowns.throw / 0.4, player.force >= 14, player.throwState !== 'held');
    this._power('sense', 0, player.force >= 25, player.senseActive);

    // ── reticle & blade cursor
    const firstPerson = !!player.camera.firstPerson;
    const threat = world.enemies.some(e => !e.dead && e.position.distanceToSquared(player.position) < 25);
    el.reticle.classList.toggle('hot', threat);
    // full strength: a reticle you cannot see is not a reticle
    el.reticle.style.opacity = firstPerson ? 1 : 0.9;

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
  }

  _power(key, cd, affordable, active) {
    const p = this.powerEls[key];
    if (!p) return;
    p.cd.style.transform = `scaleY(${clamp(cd, 0, 1)})`;
    p.root.classList.toggle('ready', affordable && cd <= 0.01);
    p.root.classList.toggle('active', !!active);
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
