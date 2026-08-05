/**
 * SABER — front end.
 *
 * Menus, the saber forge preview, the boon draft, and the settings that are
 * persisted between sessions.
 */

import * as THREE from 'three';
import { SABER_COLORS, HILT_STYLES, Saber } from '../game/Saber.js';
import { ROBE_COLORS } from '../game/Bodies.js';
import { LEVELS, LEVEL_ORDER } from '../game/Levels.js';
import { DIFFICULTY } from '../game/Combat.js';
import { MODES } from '../game/Waves.js';
import { audio } from '../engine/Audio.js';

// v2: the control scheme defaults changed, and a stored v1 blob would keep
// pinning returning players to the old blade-leads-camera scheme.
const STORE_KEY = 'saber.settings.v2';

export const DEFAULT_SETTINGS = {
  level: 'dunes',
  difficulty: 'knight',
  mode: 'roguelite',
  colorIndex: 0,
  hiltStyle: 'Graflex',
  robeIndex: 1,
  bladeLength: 1.15,
  coreWidth: 1,
  sensitivity: 1,
  camFollow: 0,
  fov: 60,
  invertY: false,
  firstPerson: false,
  scheme: 'hold',
  quality: 'high',
  resolutionScale: 1,
  bloom: true,
  grain: true,
  shake: true,
  slowmo: true,
  volume: 0.8,
  music: 0.45,
  grassScale: 1,
  particleScale: 1,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

/* ══════════════════════════════════════════════════════════════════════ */

export class Menu {
  constructor(settings, hooks = {}) {
    this.s = settings;
    this.hooks = hooks;
    this.el = {
      menu: document.getElementById('menu'),
      boot: document.getElementById('boot'),
      bootFill: document.getElementById('boot-fill'),
      bootMsg: document.getElementById('boot-msg'),
      levels: document.getElementById('level-list'),
      diffs: document.getElementById('diff-list'),
      modes: document.getElementById('mode-list'),
      colors: document.getElementById('color-list'),
      hilts: document.getElementById('hilt-list'),
      robes: document.getElementById('robe-list'),
      preview: document.getElementById('saber-preview'),
      draft: document.getElementById('boon-draft'),
      draftCards: document.getElementById('draft-cards'),
      pause: document.getElementById('pause'),
      pauseStats: document.getElementById('pause-stats'),
      death: document.getElementById('death'),
      deathStats: document.getElementById('death-stats'),
      deathTitle: document.getElementById('death-title'),
      netStatus: document.getElementById('net-status'),
      netCode: document.getElementById('net-code'),
      netRoster: document.getElementById('net-roster'),
      gpu: document.getElementById('gpu-line'),
      build: document.getElementById('build-id'),
    };
    this._buildTabs();
    this._buildLevels();
    this._buildDifficulty();
    this._buildModes();
    this._buildSaber();
    this._buildOptions();
    this._buildButtons();
    this.el.build.textContent = 'r1.0';
  }

  /* ── boot ────────────────────────────────────────────────────────── */

  progress(fraction, message) {
    this.el.bootFill.style.width = `${Math.round(fraction * 100)}%`;
    if (message) this.el.bootMsg.textContent = message;
  }
  hideBoot() { this.el.boot.classList.add('hidden'); }
  showMenu() { this.el.menu.classList.remove('hidden'); }
  hideMenu() { this.el.menu.classList.add('hidden'); }

  setGpuLine(text) { this.el.gpu.textContent = text; }

  /* ── tabs ────────────────────────────────────────────────────────── */

  _buildTabs() {
    const tabs = [...document.querySelectorAll('.tab')];
    const panels = [...document.querySelectorAll('.panel')];
    for (const t of tabs) {
      t.addEventListener('click', () => {
        audio.ui('click');
        tabs.forEach(x => x.classList.toggle('active', x === t));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
        if (t.dataset.tab === 'saber') this._startPreview();
        else this._stopPreview();
      });
      t.addEventListener('mouseenter', () => audio.ui('hover'));
    }
  }

  /* ── level cards ─────────────────────────────────────────────────── */

  _levelArt(key) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 140;
    const g = c.getContext('2d');
    const L = LEVELS[key];
    const sky = { dunes: ['#cfe0f5', '#e8d0a0'], arena: ['#c0d4ee', '#d8b98a'],
                  hangar: ['#1b2430', '#0a0d13'], canyon: ['#a8c8f0', '#c08a60'],
                  dojo: ['#20293a', '#0b0f16'] }[key] || ['#20293a', '#0b0f16'];
    const grad = g.createLinearGradient(0, 0, 0, 140);
    grad.addColorStop(0, sky[0]); grad.addColorStop(1, sky[1]);
    g.fillStyle = grad; g.fillRect(0, 0, 320, 140);

    // silhouette
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.beginPath(); g.moveTo(0, 140);
    for (let x = 0; x <= 320; x += 8) {
      const y = key === 'hangar' ? 96 + (x % 64 < 32 ? 0 : -18)
        : key === 'dojo' ? 104 + (Math.abs(x - 160) > 118 ? -40 : 0)
        : 92 + Math.sin(x * 0.021 + (key === 'canyon' ? 2 : 0)) * (key === 'arena' ? 8 : 20)
             + Math.sin(x * 0.061) * 7;
      g.lineTo(x, y);
    }
    g.lineTo(320, 140); g.closePath(); g.fill();

    // a lone blade
    g.strokeStyle = 'rgba(120,215,255,0.95)';
    g.lineWidth = 3; g.shadowColor = 'rgba(90,200,255,0.95)'; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(170, 112); g.lineTo(186, 60); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(10,12,16,0.9)';
    g.fillRect(166, 110, 8, 16);
    return c.toDataURL();
  }

  _buildLevels() {
    this.el.levels.innerHTML = '';
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const card = document.createElement('div');
      card.className = 'card' + (this.s.level === key ? ' sel' : '');
      card.innerHTML = `
        <div class="art" style="background-image:url(${this._levelArt(key)});background-size:cover"></div>
        <div class="tagpill">${L.training ? 'start here' : `${L.pool.length} unit types`}</div>
        <div class="meta"><b>${L.name}</b><span>${L.blurb}</span></div>`;
      card.addEventListener('click', () => {
        audio.ui('click');
        this.s.level = key;
        [...this.el.levels.children].forEach(c => c.classList.toggle('sel', c === card));
        saveSettings(this.s);
      });
      card.addEventListener('mouseenter', () => audio.ui('hover'));
      this.el.levels.appendChild(card);
    }
  }

  _buildDifficulty() {
    this.el.diffs.innerHTML = '';
    for (const [key, D] of Object.entries(DIFFICULTY)) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.difficulty === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${D.name}</b><span>${D.blurb}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.difficulty = key;
        [...this.el.diffs.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
      });
      this.el.diffs.appendChild(d);
    }
  }

  _buildModes() {
    this.el.modes.innerHTML = '';
    for (const [key, M] of Object.entries(MODES)) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.mode === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${M.name}</b><span>${M.blurb}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.mode = key;
        [...this.el.modes.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
      });
      this.el.modes.appendChild(d);
    }
  }

  /* ── saber forge ─────────────────────────────────────────────────── */

  _buildSaber() {
    this.el.colors.innerHTML = '';
    SABER_COLORS.forEach((c, i) => {
      const sw = document.createElement('div');
      sw.className = 'sw' + (this.s.colorIndex === i ? ' sel' : '');
      const hex = '#' + c.hex.toString(16).padStart(6, '0');
      sw.style.background = `radial-gradient(circle at 35% 30%, #fff, ${hex} 62%)`;
      sw.style.boxShadow = `0 0 16px -2px ${hex}`;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        audio.ui('click');
        this.s.colorIndex = i;
        [...this.el.colors.children].forEach(x => x.classList.toggle('sel', x === sw));
        saveSettings(this.s);
        this._refreshPreview();
        this.hooks.onSaberChange?.(this.s);
      });
      this.el.colors.appendChild(sw);
    });

    this.el.hilts.innerHTML = '';
    for (const h of HILT_STYLES) {
      const card = document.createElement('div');
      card.className = 'card small' + (this.s.hiltStyle === h ? ' sel' : '');
      card.innerHTML = `<div class="art" style="background:linear-gradient(160deg,#20262f,#0b0e13)"></div>
                        <div class="meta"><b>${h}</b></div>`;
      card.addEventListener('click', () => {
        audio.ui('click');
        this.s.hiltStyle = h;
        [...this.el.hilts.children].forEach(c => c.classList.toggle('sel', c === card));
        saveSettings(this.s);
        this._refreshPreview(true);
      });
      this.el.hilts.appendChild(card);
    }

    this.el.robes.innerHTML = '';
    ROBE_COLORS.forEach((r, i) => {
      const sw = document.createElement('div');
      sw.className = 'sw' + (this.s.robeIndex === i ? ' sel' : '');
      sw.style.background = `linear-gradient(135deg, #${r.outer.toString(16).padStart(6, '0')} 50%, #${r.inner.toString(16).padStart(6, '0')} 50%)`;
      sw.title = r.name;
      sw.addEventListener('click', () => {
        audio.ui('click');
        this.s.robeIndex = i;
        [...this.el.robes.children].forEach(x => x.classList.toggle('sel', x === sw));
        saveSettings(this.s);
      });
      this.el.robes.appendChild(sw);
    });

    this._slider('opt-bladelen', 'bladeLength', (v) => `${v.toFixed(2)}m`, () => this._refreshPreview(true));
    this._slider('opt-bladewidth', 'coreWidth', (v) => `${Math.round(v * 100)}%`, () => this._refreshPreview(true));
  }

  _slider(id, key, fmt, onChange) {
    const input = document.getElementById(id);
    if (!input) return;
    const label = input.parentElement.querySelector('b');
    input.value = this.s[key];
    const apply = () => {
      const v = parseFloat(input.value);
      this.s[key] = v;
      if (label) label.textContent = fmt ? fmt(v) : v.toFixed(2);
      saveSettings(this.s);
      onChange?.(v);
    };
    input.addEventListener('input', apply);
    apply();
  }

  _check(id, key, onChange) {
    const input = document.getElementById(id);
    if (!input) return;
    input.checked = !!this.s[key];
    input.addEventListener('change', () => {
      this.s[key] = input.checked;
      saveSettings(this.s);
      onChange?.(input.checked);
    });
  }

  _startPreview() {
    if (this.preview) { this.preview.running = true; return; }
    const host = this.el.preview;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(host.clientWidth || 300, host.clientHeight || 260, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1.15, 0.05, 40);
    camera.position.set(0.55, 0.35, 1.1);
    camera.lookAt(0, 0.32, 0);
    scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x2a2418, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 1.6);
    rim.position.set(-2, 1, -2); scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);

    this.preview = { renderer, scene, camera, group, running: true, drag: false, yaw: 0.4, pitch: 0.1, t: 0 };
    this._refreshPreview(true);

    let lastX = 0, lastY = 0;
    host.addEventListener('pointerdown', (e) => { this.preview.drag = true; lastX = e.clientX; lastY = e.clientY; host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointerup', (e) => { this.preview.drag = false; host.releasePointerCapture?.(e.pointerId); });
    host.addEventListener('pointermove', (e) => {
      if (!this.preview.drag) return;
      this.preview.yaw += (e.clientX - lastX) * 0.01;
      this.preview.pitch = Math.max(-1.1, Math.min(1.1, this.preview.pitch + (e.clientY - lastY) * 0.008));
      lastX = e.clientX; lastY = e.clientY;
    });

    const loop = () => {
      if (!this.preview) return;
      requestAnimationFrame(loop);
      if (!this.preview.running) return;
      const p = this.preview;
      p.t += 0.016;
      if (!p.drag) p.yaw += 0.0042;
      p.group.rotation.set(p.pitch, p.yaw, 0);
      if (p.saber) p.saber.update(0.016, p.t);
      const w = host.clientWidth || 300, h = host.clientHeight || 260;
      if (p.renderer.domElement.width !== w || p.renderer.domElement.height !== h) {
        p.renderer.setSize(w, h, false);
        p.camera.aspect = w / h;
        p.camera.updateProjectionMatrix();
      }
      p.renderer.render(p.scene, p.camera);
    };
    loop();
  }

  _stopPreview() { if (this.preview) this.preview.running = false; }

  _refreshPreview(rebuild = false) {
    if (!this.preview) return;
    const p = this.preview;
    if (rebuild || !p.saber) {
      if (p.saber) { p.saber.dispose(); }
      p.group.clear();
      p.saber = new Saber(p.group, {
        colorIndex: this.s.colorIndex,
        bladeLength: this.s.bladeLength,
        coreWidth: this.s.coreWidth,
        hiltStyle: this.s.hiltStyle,
      });
      p.saber.root.position.set(0, -0.05, 0);
      p.saber.trail.visible = false;
      p.saber.ignite();
      p.saber.ignition = 1;
    } else {
      p.saber.setColor(this.s.colorIndex);
    }
  }

  /* ── options ─────────────────────────────────────────────────────── */

  _buildOptions() {
    const schemes = [
      ['hold', 'Hold to Blade', 'The mouse looks. Hold left mouse and the mouse IS the blade. Recommended.'],
      ['free', 'Free Blade', 'The mouse always moves the blade and the camera follows it. Hold RMB to look around. Chaotic.'],
    ];
    const host = document.getElementById('opt-scheme');
    host.innerHTML = '';
    for (const [key, name, blurb] of schemes) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.scheme === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.scheme = key;
        [...host.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
        this.hooks.onSchemeChange?.(key);
      });
      host.appendChild(d);
    }

    const qhost = document.getElementById('opt-quality');
    qhost.innerHTML = '';
    for (const [key, name, blurb] of [
      ['low', 'Performance', 'Small shadows, fewer particles. For laptops and integrated graphics.'],
      ['medium', 'Balanced', 'A good default on most machines.'],
      ['high', 'Fidelity', 'Full shadows, bloom, dense particles.'],
      ['ultra', 'Cinematic', 'Everything. Expects a discrete GPU.'],
    ]) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.quality === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.quality = key;
        [...qhost.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
        this.hooks.onQualityChange?.(key);
      });
      qhost.appendChild(d);
    }

    this._slider('opt-sens', 'sensitivity', v => `${v.toFixed(2)}×`, v => this.hooks.onSensitivity?.(v));
    this._slider('opt-camfollow', 'camFollow', v => v.toFixed(2), v => this.hooks.onCamFollow?.(v));
    this._slider('opt-fov', 'fov', v => `${Math.round(v)}°`, v => this.hooks.onFov?.(v));
    this._slider('opt-scale', 'resolutionScale', v => `${Math.round(v * 100)}%`, v => this.hooks.onResolution?.(v));
    this._slider('opt-vol', 'volume', v => `${Math.round(v * 100)}%`, v => audio.setVolume(v));
    this._slider('opt-music', 'music', v => `${Math.round(v * 100)}%`, v => audio.setMusicVolume(v));
    this._check('opt-invert', 'invertY', v => this.hooks.onInvert?.(v));
    this._check('opt-firstperson', 'firstPerson');
    this._check('opt-bloom', 'bloom', v => this.hooks.onBloom?.(v));
    this._check('opt-grain', 'grain', v => this.hooks.onGrain?.(v));
    this._check('opt-shake', 'shake');
    this._check('opt-slowmo', 'slowmo');
  }

  _buildButtons() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { audio.ui('click'); fn(); });
    };
    bind('btn-deploy', () => this.hooks.onDeploy?.(this.s));
    bind('btn-resume', () => this.hooks.onResume?.());
    bind('btn-restart', () => this.hooks.onRestart?.());
    bind('btn-quit', () => this.hooks.onQuit?.());
    bind('btn-retry', () => this.hooks.onRetry?.());
    bind('btn-menu', () => this.hooks.onQuit?.());
    bind('btn-host', () => this.hooks.onHost?.());
    bind('btn-join', () => {
      const code = document.getElementById('join-code').value.trim().toUpperCase();
      if (code) this.hooks.onJoin?.(code);
    });
    this.el.netCode.addEventListener('click', () => {
      const t = this.el.netCode.textContent;
      if (t && t !== '—') { navigator.clipboard?.writeText(t); this.netStatus('code copied', 'ok'); }
    });
  }

  /* ── net UI ──────────────────────────────────────────────────────── */

  netStatus(text, cls = '') {
    this.el.netStatus.textContent = text;
    this.el.netStatus.className = 'netstatus ' + cls;
  }
  netCode(code) { this.el.netCode.textContent = code || '—'; }
  netRoster(players) {
    this.el.netRoster.innerHTML = '';
    for (const p of players) {
      const d = document.createElement('div');
      d.className = 'p';
      d.innerHTML = `<i></i><span>${p.name}</span>${p.host ? '<em style="margin-left:auto;color:#8b98ad">host</em>' : ''}`;
      this.el.netRoster.appendChild(d);
    }
  }

  /* ── overlays ────────────────────────────────────────────────────── */

  showDraft(boons, onPick) {
    this.el.draftCards.innerHTML = '';
    for (const b of boons) {
      const card = document.createElement('div');
      card.className = 'dc';
      card.innerHTML = `<div class="ic">${b.icon}</div><b>${b.name}</b><span>${b.text}</span><em>${b.tag}</em>`;
      card.addEventListener('mouseenter', () => audio.ui('hover'));
      card.addEventListener('click', () => {
        audio.ui('good');
        this.el.draft.classList.add('hidden');
        onPick(b);
      });
      this.el.draftCards.appendChild(card);
    }
    this.el.draft.classList.remove('hidden');
  }

  showPause(stats) {
    this.el.pauseStats.innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.el.pause.classList.remove('hidden');
  }
  hidePause() { this.el.pause.classList.add('hidden'); }

  showDeath(stats, title) {
    if (title) this.el.deathTitle.textContent = title;
    this.el.deathStats.innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.el.death.classList.remove('hidden');
  }
  hideDeath() { this.el.death.classList.add('hidden'); }
}
