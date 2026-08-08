/**
 * SABER — entry point.
 *
 * Boot, warm the procedural content, then hand the frame to the World.
 */

import * as THREE from 'three';
import { Engine, QUALITY } from './engine/Engine.js';
import { Input } from './engine/Input.js';
import { audio } from './engine/Audio.js';
import { initPhysics } from './physics/Rapier.js';
import { sandMaps, rockMaps, metalMaps, clothMaps, armorMaps, duracreteMaps } from './engine/Textures.js';
import { World } from './game/World.js';
import { LEVELS } from './game/Levels.js';
import { DIFFICULTY } from './game/Combat.js';
import { HUD } from './ui/HUD.js';
import { Menu, loadSettings, saveSettings, applyFeelSettings } from './ui/Menu.js';
import { Net, RemoteAvatar } from './net/Net.js';
import { BOONS } from './game/Waves.js';
import { keyLabel } from './engine/Bindings.js';
import { clamp } from './engine/MathUtil.js';

const canvas = document.getElementById('view');

/* ── capability check ────────────────────────────────────────────────── */
{
  const test = document.createElement('canvas');
  const gl = test.getContext('webgl2');
  if (!gl) {
    document.getElementById('boot').classList.add('hidden');
    document.getElementById('unsupported').classList.remove('hidden');
    throw new Error('WebGL2 unavailable');
  }
}

const settings = loadSettings();
const engine = new Engine(canvas, settings.quality);
const input = new Input(canvas);
const hud = new HUD(document);
const net = new Net();

input.sensitivity = 1;      // the blade controller applies the user's scaling
input.invertY = settings.invertY;

engine.setResolutionScale(settings.resolutionScale);
engine.setBloom(settings.bloom);
engine.setGrain(settings.grain);
audio.setVolume(settings.volume);
audio.setMusicVolume(settings.music);

let world = null;
let state = 'boot';         // boot | menu | playing | paused | dead | draft
let last = performance.now();
let accum = 0;
let fpsSmooth = 60;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Menu                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

const menu = new Menu(settings, {
  onDeploy: () => deploy(),
  onResume: () => resume(),
  onRestart: () => { menu.hidePause(); restartWave(); },
  onQuit: () => quitToMenu(),
  onRetry: () => { menu.hideDeath(); deploy(); },
  onQualityChange: (q) => { engine.setQuality(q); },
  onResolution: (v) => engine.setResolutionScale(v),
  onBloom: (v) => engine.setBloom(v),
  onGrain: (v) => engine.setGrain(v),
  onInvert: (v) => { input.invertY = v; },
  onSensitivity: (v) => { if (world?.player) world.player.control.sensitivity = v; },
  onCamFollow: (v) => { if (world?.player) world.player.control.followStrength = v; },
  onFov: (v) => { if (world?.player) world.player.camera.fovTarget = v; },
  onSchemeChange: (v) => { if (world?.player) world.player.control.setScheme(v); },
  // Both are live: switch the deflection model or a keybind mid-fight and the
  // very next bolt uses it, which is the only honest way to compare them.
  onDeflectAim: (v) => { settings.deflectAim = v; if (world) world.settings.deflectAim = v; },
  onBindings: (b) => { input.setBindings(b); },
  // Force settings are read live off world.settings, so the sliders take effect
  // mid-fight without a reload.
  onForce: () => {
    if (!world) return;
    world.settings.forcePower = settings.forcePower;
    world.settings.forceDrain = settings.forceDrain;
  },
  onSaberChange: (s) => { if (world?.player) world.player.setSaberColor(s.colorIndex); },
  // Camera shake and cinematic slow-motion. The gates themselves are installed
  // once per world in buildWorld and read `settings` live; this only exists so
  // that unticking a box also kills the shake or the hitstop already in flight.
  onFeel: () => applyFeelSettings(world, settings),
  onHost: () => hostSession(),
  onJoin: (code) => joinSession(code),
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Boot                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

async function boot() {
  const steps = [
    ['forging blade', () => { }],
    ['grinding sand', () => sandMaps()],
    ['weathering rock', () => rockMaps()],
    ['milling durasteel', () => metalMaps()],
    ['weaving robes', () => clothMaps()],
    ['casting plastoid', () => armorMaps()],
    ['pouring duracrete', () => duracreteMaps()],
    ['tuning the hum', () => { }],
    ['settling the world', null],     // async: see below
  ];
  for (let i = 0; i < steps.length; i++) {
    const [msg, fn] = steps[i];
    menu.progress(i / steps.length, msg);
    await new Promise(r => requestAnimationFrame(() => r()));
    // The physics engine is WASM and has to finish instantiating before any
    // level can build a body, so it is warmed up here with the textures rather
    // than raced at level load.
    if (fn === null) { await initPhysics(); continue; }
    try { fn(); } catch (e) { console.warn('warm-up step failed:', msg, e); }
  }
  menu.progress(1, 'ready');

  const gl = engine.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
  menu.setGpuLine(String(name).slice(0, 62));

  await new Promise(r => setTimeout(r, 260));
  menu.hideBoot();
  menu.showMenu();
  state = 'menu';
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Session control                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

function buildWorld(levelKey) {
  if (world) { world.dispose(); world = null; }
  audio.init();
  audio.resume();

  world = new World(engine, settings);
  world.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.knight;

  world.onNotify = (t, s) => hud.message(t, s);
  world.onFloating = (p, text, color) => hud.floating(p, text, color);
  world.onHitmark = (p, kind, bone) => hud.hitmark(p, kind, bone);
  world.onKillFeed = (who, what, kind) => hud.killFeed(who, what, kind);
  world.onGameOver = (stats) => gameOver(stats);
  world.onDraftOffer = (boons) => offerDraft(boons);
  world.onDeflectFeedback = (grade, point, why) => {
    // grades: -1 wrong answer, 0..3 deflection quality, 4 chamber, 5 lock
    const colour = grade >= 4 ? '#ffd88a' : grade >= 2 ? '#8fe8ff' : grade < 0 ? '#ff8080' : '#9fb0c6';
    hud.explain(why, colour, grade < 0 ? 2.0 : 1.4);
  };

  world.loadLevel(levelKey);
  const player = world.spawnPlayer({ name: net.name || 'Jedi', isLocal: true });
  player.control.sensitivity = settings.sensitivity;
  player.control.followStrength = settings.camFollow;
  player.camera.fovTarget = settings.fov;
  player.camera.fov = settings.fov;

  // After spawnPlayer: the shake gate goes on this player's camera rig, and
  // there is no rig until there is a player.
  applyFeelSettings(world, settings);

  hud.setLevel(LEVELS[levelKey].name, world.difficulty.name);
  hud.setBoons([]);

  if (world.training) {
    world.director.onLesson = (state) => hud.setCoach(state);
    world.director.start();
    hud.setCoach(world.director.state());
  } else hud.showCoach(false);

  return world;
}

function deploy() {
  saveSettings(settings);
  menu.hideMenu();
  menu.hideDeath();
  menu.hidePause();

  const levelKey = settings.level;
  buildWorld(levelKey);

  if (net.enabled && net.connected) {
    world.attachNet(net, net.isHost ? 'host' : 'client');
    if (net.isHost) net.broadcast({ t: 'start', level: levelKey, difficulty: settings.difficulty, mode: settings.mode });
  }

  hud.show(true);
  state = 'playing';
  input.enabled = true;
  input.requestLock();

  if (world.netMode !== 'client' && !world.training) world.director.start(1);
  world.notify('MAY THE FORCE BE WITH YOU', LEVELS[levelKey].name);
}

function resume() {
  menu.hidePause();
  state = 'playing';
  world.paused = false;
  input.enabled = true;
  input.requestLock();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  world.paused = true;
  input.enabled = false;
  input.exitLock();
  const p = world.player;
  menu.showPause([
    ['Wave', world.director.wave],
    ['Score', Math.floor(world.score + (p?.score || 0)).toLocaleString()],
    ['Kills', p?.kills ?? 0],
    ['Deflections', p?.deflects ?? 0],
    ['Perfect returns', p?.perfects ?? 0],
    ['Limbs taken', p?.limbsRemoved ?? 0],
  ]);
}

function restartWave() {
  if (!world) return;
  for (const e of world.enemies) e.dispose();
  world.enemies.length = 0;
  const p = world.player;
  if (p) { p.hp = p.maxHp; p.force = p.maxForce; p.stamina = p.maxStamina; }
  world.director.start(Math.max(1, world.director.wave));
  resume();
}

function quitToMenu() {
  menu.hidePause();
  menu.hideDeath();
  hud.show(false);
  input.enabled = false;
  input.exitLock();
  if (world) { world.dispose(); world = null; }
  menu.showMenu();
  state = 'menu';
}

function gameOver(stats) {
  state = 'dead';
  input.enabled = false;
  setTimeout(() => {
    input.exitLock();
    menu.showDeath([
      ['Wave reached', stats.wave],
      ['Score', Math.floor(stats.score).toLocaleString()],
      ['Kills', stats.kills],
      ['Deflections', stats.deflects],
      ['Perfect returns', stats.perfects],
      ['Limbs taken', stats.limbs],
    ]);
  }, 2600);
}

function offerDraft(boons) {
  if (!boons || !boons.length) { world.director.resumeAfterDraft(); return; }
  state = 'draft';
  world.paused = true;
  input.enabled = false;
  input.exitLock();
  menu.showDraft(boons, (b) => {
    world.applyBoon(b);
    hud.setBoons([...world.takenBoons].map(id =>
      BOONS.find(x => x.id === id) || { icon: '•', name: id }));
    resume();
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Scoreboard                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Tab.
 *
 * `scoreboard` has been in ACTIONS since bindings existed, the Codex lists it
 * as "Scoreboard & run boons", the pause card prints `Tab boons` — and nothing
 * anywhere handled it. The only mention of Tab in this file was a
 * preventDefault stopping the browser moving focus, which is what made it read
 * as handled. A bound, listed, documented key that does nothing is the same lie
 * as a dead checkbox.
 *
 * Read as an ACTION and not off `e.code`, so it rebinds like everything else,
 * and it is a HOLD (Bindings.js marks it so) rather than a toggle: you glance
 * at the standing mid-fight and let go. The DOM is rebuilt on the frame it
 * OPENS and not while it is held — sixty relayouts a second for numbers that
 * move once a kill is a real cost for nothing.
 */
const scoreEl = {
  root: document.getElementById('scoreboard'),
  stats: document.getElementById('score-stats'),
  roster: document.getElementById('score-roster'),
  boons: document.getElementById('score-boons'),
  key: document.getElementById('score-key'),
};
let scoreOpen = false;

function setScoreboard(open) {
  if (!scoreEl.root || open === scoreOpen) return;
  scoreOpen = open;
  scoreEl.root.classList.toggle('hidden', !open);
  if (!open || !world) return;

  const p = world.player;
  scoreEl.stats.innerHTML = [
    ['Wave', world.director?.wave ?? 1],
    ['Score', Math.floor(world.score + (p?.score || 0)).toLocaleString()],
    ['Kills', p?.kills ?? 0],
    ['Deflections', p?.deflects ?? 0],
    ['Perfect returns', p?.perfects ?? 0],
    ['Limbs taken', p?.limbsRemoved ?? 0],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

  // Only in co-op. Solo, a one-row table of yourself is noise.
  const roster = net.enabled && net.connected ? net.roster : [];
  scoreEl.roster.innerHTML = roster.map(r =>
    `<div class="p"><i></i><span>${r.name}</span>${r.host ? '<em style="margin-left:auto;color:#8b98ad">host</em>' : ''}</div>`).join('');

  const taken = [...(world.takenBoons || [])].map(id =>
    BOONS.find(x => x.id === id) || { icon: '•', name: id });
  scoreEl.boons.innerHTML = taken.length
    ? taken.map(b => `<div class="bn">${b.icon} ${b.name}</div>`).join('')
    : '<div class="bn">no boons yet</div>';

  // The one label in the game that has to track a rebind, because it is the
  // label for the key you are holding to read it.
  if (scoreEl.key) scoreEl.key.textContent = keyLabel((input.bindings.scoreboard || [])[0]);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Multiplayer                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

function wireNet() {
  net.on('roster', (roster) => menu.netRoster(roster));
  net.on('error', (err) => menu.netStatus(String(err.message || err), 'err'));
  net.on('peer-joined', (id, name) => menu.netStatus(`${name || 'a Jedi'} joined`, 'ok'));
  net.on('peer-left', (id) => {
    menu.netStatus('a Jedi left', '');
    const r = world?.remotes?.get(id);
    if (r) { r.dispose(); world.remotes.delete(id); }
  });
  net.on('welcome', (hostSettings) => {
    if (hostSettings) {
      settings.level = hostSettings.level;
      settings.difficulty = hostSettings.difficulty;
      settings.mode = hostSettings.mode;
    }
    menu.netStatus('connected — waiting for the host to deploy', 'ok');
  });
  net.on('start', (msg) => {
    settings.level = msg.level;
    settings.difficulty = msg.difficulty;
    settings.mode = msg.mode;
    if (state === 'menu') deploy();
  });
  net.on('snapshot', (msg) => world?.applySnapshot(msg));
  net.on('claim', (peerId, msg) => world?.applyClaim(peerId, msg));
  net.on('avatar', (peerId, msg) => {
    if (!world) return;
    if (!world.remotes) world.remotes = new Map();
    let r = world.remotes.get(peerId);
    if (!r) {
      const entry = net.roster.find(x => x.id === peerId);
      r = new RemoteAvatar(world, {
        id: peerId, name: entry?.name || 'Jedi',
        colorIndex: (net.roster.findIndex(x => x.id === peerId) + 1) % 8,
        robeIndex: (net.roster.findIndex(x => x.id === peerId) + 1) % 6,
      });
      world.remotes.set(peerId, r);
      world.players.push(r);
    }
    r.push(msg, performance.now() / 1000);
  });
}
wireNet();

async function hostSession() {
  menu.netStatus('opening a session…');
  try {
    const code = await net.host(net.name || 'Jedi', {
      level: settings.level, difficulty: settings.difficulty, mode: settings.mode,
    });
    menu.netCode(code);
    menu.netStatus('session open — share the code, then Ignite', 'ok');
  } catch (e) {
    menu.netStatus(`could not open a session: ${e.message || e}`, 'err');
  }
}

async function joinSession(code) {
  menu.netStatus(`connecting to ${code}…`);
  try {
    await net.join(code, net.name || 'Jedi');
    menu.netCode(code);
    menu.netStatus('connected — the host starts the run', 'ok');
  } catch (e) {
    menu.netStatus(`could not join: ${e.message || e}`, 'err');
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Frame                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

input.onLockChange = (locked) => {
  if (!locked && state === 'playing') pause();
};

window.addEventListener('keydown', (e) => {
  // dojo lesson navigation — only where it cannot cost you anything
  if (state === 'playing' && world?.training) {
    const d = world.director;
    if (e.code === 'KeyN') { d.skip(); hud.setCoach(d.state()); }
    else if (e.code === 'KeyB') { d.back(); hud.setCoach(d.state()); }
    else if (e.code === 'KeyY') { d.repeat(); hud.setCoach(d.state()); }
  }
  if (e.code === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  }
  // NOT the scoreboard — that is the `scoreboard` action, read once a frame in
  // frame() so it stays rebindable. This only stops the browser walking focus
  // off the canvas while a menu is up; Input.js already swallows every key once
  // a run is running.
  if (e.code === 'Tab') e.preventDefault();
});

// The menu sits in a fixed, full-screen overlay above the canvas, so a click
// in it never reached the canvas listener below — which was the only thing that
// called audio.init(). Every menu blip was a no-op and the game was silent
// until the first Ignite. Arm the context on any pointer down, anywhere.
window.addEventListener('pointerdown', () => { audio.init(); audio.resume(); }, true);
window.addEventListener('keydown', () => { audio.init(); audio.resume(); }, true);

canvas.addEventListener('pointerdown', () => {
  audio.init(); audio.resume();
  if (state === 'playing' && !input.locked) input.requestLock();
});

// A hidden tab suspends the context; nothing re-armed it on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) audio.resume();
});

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.1);
  fpsSmooth += (1 / dt - fpsSmooth) * 0.04;

  input.begin(dt);

  // Held, and only while a run is live: the menus, the draft and the death card
  // own the screen otherwise, and this would sit on top of all three.
  setScoreboard(state === 'playing' && !!world && input.act('scoreboard'));

  if (world && (state === 'playing' || state === 'dead')) {
    world.update(dt, input);
    if (world.remotes) for (const r of world.remotes.values()) {
      r.update(dt, { terrain: world.terrain, camera: engine.camera, time: world.time });
    }
    hud.update(dt, world, world.player, engine.camera);
  } else if (world && (state === 'paused' || state === 'draft')) {
    // keep the camera alive behind the overlay
    world.player?.camera.update(dt, world.player.position, { physics: world.physics, terrain: world.terrain });
  }

  engine.render(dt);
  input.end();
}

/* ── go ──────────────────────────────────────────────────────────────── */

boot().then(() => requestAnimationFrame(frame));

// Handy for tuning from the console.
window.SABER = { engine, input, audio, get world() { return world; }, settings, net, menu, hud,
  get fps() { return Math.round(fpsSmooth); } };
