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
import { boonById, drawBoons, BOSS_EVERY } from './game/Waves.js';
import { Run } from './game/Run.js';
import { recordRun, progressLines } from './game/Progress.js';
import { keyLabel } from './engine/Bindings.js';
import { guardZoneOf } from './game/Bolts.js';
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

/**
 * Bloom is on when the PLAYER wants it and the TIER allows it.
 *
 * `QUALITY[tier].bloom` is the last column of Engine's table with no reader in
 * src/ — it is `true` on all four tiers today, so this changes nothing on
 * screen, and it means a tier that wants to drop the bloom pass on integrated
 * graphics can, without a second switch appearing somewhere else to fight the
 * checkbox. A column nobody reads is a promise nobody keeps; this is the
 * reader, and tools/checks/controls.mjs fails if any column loses one.
 */
function qualityBloom() {
  return !!settings.bloom && (QUALITY[settings.quality] ?? QUALITY.high).bloom;
}

engine.setResolutionScale(settings.resolutionScale);
engine.setBloom(qualityBloom());
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
  // Context the raw numbers do not carry: which level, which tier, and how much
  // of the frame the player's own settings asked for. A report that says 24 ms
  // without saying "arena, ultra, grass 1.5" is not actionable.
  onPerfReport: () => engine.profiler.report({
    level: settings.level,
    quality: settings.quality,
    scale: settings.resolutionScale,
    grass: settings.grassScale,
    enemies: world ? world.enemies.length : 0,
    wave: world && world.director ? (world.director.wave ?? '-') : '-',
  }),
  onRetry: () => { menu.hideDeath(); deploy(); },
  // The renderer takes the tier immediately; the live world takes what it can
  // (see World.applyQuality — emission is live, buffers are next deploy).
  onQualityChange: (q) => { engine.setQuality(q); engine.setBloom(qualityBloom()); world?.applyQuality(q); },
  onResolution: (v) => engine.setResolutionScale(v),
  onBloom: () => engine.setBloom(qualityBloom()),
  onGrain: (v) => engine.setGrain(v),
  onInvert: (v) => { input.invertY = v; },
  onSensitivity: (v) => { if (world?.player) world.player.control.sensitivity = v; },
  onCamFollow: (v) => { if (world?.player) world.player.control.followStrength = v; },
  onFov: (v) => { if (world?.player) world.player.camera.fovTarget = v; },
  onSchemeChange: (v) => { if (world?.player) world.player.control.setScheme(v); },
  // Both are live: switch the deflection model or a keybind mid-fight and the
  // very next bolt uses it, which is the only honest way to compare them.
  onDeflectAim: (v) => { settings.deflectAim = v; if (world) world.settings.deflectAim = v; },
  onBindings: (b) => { input.setBindings(b); refreshCoachKeys(); },
  // Force settings are read live off world.settings, so the sliders take effect
  // mid-fight without a reload.
  onForce: () => {
    if (!world) return;
    world.settings.forcePower = settings.forcePower;
    world.settings.forceDrain = settings.forceDrain;
  },
  onSaberChange: (s) => { if (world?.player) world.player.setSaberColor(s.colorIndex); },
  // The training panel promised "a change lands on your next Ignite" and this
  // hook — declared in Menu, called by both blade-length sliders — had no
  // implementation, so it landed on nothing: build a Saber at 1.15, drag the
  // slider to 4.00, retract, re-ignite, still 1.150. The player who asked for
  // an unlimited training blade got a checkbox, a slider, a ceiling of 4 m and
  // a blade that never moved.
  //
  // Saber.update reads `this.bladeLength` every frame (`len = bladeLength *
  // ignition`, which is what drives the mesh, the wash, the trail and the
  // capture window), so writing it is live — better than the promise, and the
  // panel now says so. Same seam the Long Blade boon already uses.
  onBladeLength: (v) => { if (world?.player?.saber) world.player.saber.bladeLength = v; },
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

function buildWorld(levelKey, run = null) {
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

  world.onRungClear = (r) => landing(r);

  world.loadLevel(levelKey, { run });
  const player = world.spawnPlayer({ name: net.name || 'Jedi', isLocal: true });
  player.control.sensitivity = settings.sensitivity;
  player.control.followStrength = settings.camFollow;
  player.camera.fovTarget = settings.fov;
  player.camera.fov = settings.fov;

  // After spawnPlayer: the shake gate goes on this player's camera rig, and
  // there is no rig until there is a player.
  applyFeelSettings(world, settings);

  hud.setLevel(world.rung ? world.rung.name : LEVELS[levelKey].name, world.difficulty.name);
  hud.setBoons(heldBoons());

  if (world.training) {
    world.director.onLesson = (state) => hud.setCoach(state);
    world.director.start();
    hud.setCoach(world.director.state());
  } else hud.showCoach(false);

  return world;
}

/**
 * THE SPIRE, at last connected to something.
 *
 * `gauntlet` has been in the mode list since the menu was written, with a blurb
 * promising "a fixed ladder of set-pieces, ending in a boss", and had ZERO
 * implementation — it fell through to the generic path and was byte-identical
 * to the thing it claimed to be an alternative to. Run.js and Progress.js were
 * written, checked, and had no callers at all. This is the wire.
 *
 * A run is created ONLY for the gauntlet. Every other mode is still a place you
 * fight in rather than a climb, and giving them a Run would silently change
 * what `Esc → Abandon` means in all of them.
 */
function startRun() {
  if (settings.mode !== 'gauntlet') return null;
  return new Run({
    identity: { order: settings.order, species: settings.species },
    mode: 'spire',
  });
}

function deploy(run = startRun()) {
  saveSettings(settings);
  menu.hideMenu();
  menu.hideDeath();
  menu.hidePause();
  menu.hideLanding();

  // A rung BORROWS a level; outside the Spire the player's own choice stands.
  const levelKey = run && !run.done ? run.rung.level : settings.level;
  buildWorld(levelKey, run);

  if (net.enabled && net.connected) {
    world.attachNet(net, net.isHost ? 'host' : 'client');
    if (net.isHost) net.broadcast({ t: 'start', level: levelKey, difficulty: settings.difficulty, mode: settings.mode });
  }

  hud.show(true);
  state = 'playing';
  input.enabled = true;
  input.requestLock();

  if (world.netMode !== 'client' && !world.training) world.director.start(1);
  if (run) world.notify(run.rung.name.toUpperCase(), run.rung.brief);
  else world.notify('MAY THE FORCE BE WITH YOU', LEVELS[levelKey].name);
}

/**
 * A rung survived.
 *
 * The heal is applied by `Run.ascend` (LANDING_HEAL), so the card can report
 * the health the player will actually START the next rung on rather than the
 * sliver they finished this one with — which is the number that decides whether
 * they want to keep climbing.
 */
function landing(run) {
  state = 'landing';
  world.paused = true;
  input.enabled = false;
  input.exitLock();
  audio.ui('wave');

  const cleared = run.rung;
  const more = run.ascend();      // heals, and steps the tier if there is one
  if (!more) return crowned(run);

  const next = run.rung;
  menu.showLanding({
    altitude: next.altitude,
    name: next.name,
    brief: next.brief,
    stats: [
      [`${cleared.name} cleared`, `${cleared.waves} wave${cleared.waves === 1 ? '' : 's'}`],
      ['Climbed so far', `${run.depth} waves`],
      ['Vitality', `${Math.round(run.hpFrac * 100)}%`],
      ['Score', Math.floor(run.score).toLocaleString()],
    ],
    onAscend: () => deploy(run),
  });
}

/** The crown. The one way this game has ever had of being finished. */
function crowned(run) {
  state = 'dead';
  input.enabled = false;
  input.exitLock();
  recordRun(run.summary());
  showRecord();
  menu.showDeath([
    ['Waves climbed', run.depth],
    ['Score', Math.floor(run.score).toLocaleString()],
    ['Kills', run.kills],
    ['Boons held', run.boons.length],
  ], 'You stand above the storm');
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
  ], sandboxRoomLive());
}

/**
 * Do the three training numbers reach the room the player is standing in?
 *
 * Two different directors answer this, and only they can. In sandbox MODE the
 * WaveDirector's whole update is `_sandboxUpdate`, which re-reads
 * sandboxConfig every frame in any theatre. In the dojo it is one lesson out of
 * eleven — `DojoDirector.inSandbox`, the one whose setup block says `sandbox` —
 * and the other ten build their own room out of the lesson and never look.
 */
function sandboxRoomLive() {
  if (!world) return false;
  if (world.training) return !!world.director?.inSandbox;
  return !!world.director?.sandbox;
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
  menu.hideLanding();
  hud.show(false);
  input.enabled = false;
  input.exitLock();
  // An abandoned climb still happened. Recording it is what stops "deepest
  // reached" from quietly meaning "deepest you happened to die on".
  if (world?.run && !world.run.done) { world.run.end(); recordRun(world.run.summary()); }
  if (world) { world.dispose(); world = null; }
  showRecord();
  menu.showMenu();
  state = 'menu';
}

/** The one line of history the main menu carries. See Progress.js. */
function showRecord() {
  const el = document.getElementById('menu-record');
  if (!el) return;
  const lines = progressLines();
  el.textContent = lines.length && lines[0] !== 'No runs yet.' ? lines.join('  ·  ') : '';
}
showRecord();

function gameOver(stats) {
  state = 'dead';
  input.enabled = false;
  // A run that ended is a run that happened. `gameOver` used to reduce it to a
  // card and throw it away — the only two localStorage keys in the tree were
  // settings and keybinds, so you could play for an hour and the game would not
  // know you had ever played. This is a record, not a currency: nothing here
  // unlocks anything (see Progress.js).
  if (world?.run && !world.run.done) {
    world.run.end();
    recordRun(world.run.summary());
  }
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

/**
 * What the run is holding, as cards the HUD and the scoreboard can draw.
 *
 * Ranks are shown as a suffix rather than as repeated entries — five separate
 * "Vitality" chips is a list, "Vitality ×4" is a build. `boonById` is used
 * instead of `BOONS.find` because attunements are not in BOONS and would
 * otherwise all render as a bullet with a raw id under them.
 */
function heldBoons() {
  const taken = world?.takenBoons;
  if (!taken) return [];
  return [...taken].map((id) => {
    const b = boonById(id) || { icon: '•', name: id };
    const n = typeof taken.rank === 'function' ? taken.rank(id) : 1;
    return n > 1 ? { ...b, name: `${b.name} ×${n}` } : b;
  });
}

function offerDraft(boons) {
  if (!boons || !boons.length) { world.director.resumeAfterDraft(); return; }
  state = 'draft';
  world.paused = true;
  input.enabled = false;
  input.exitLock();
  menu.showDraft(boons, (b) => {
    world.applyBoon(b);
    hud.setBoons(heldBoons());
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

  const taken = heldBoons();
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
    if (!r) return;
    r.dispose();
    world.remotes.delete(id);
    // …and out of `world.players`, which is where it was ALSO pushed and was
    // never removed from. A departed peer stayed a live entry in every loop
    // over the player list forever: enemies kept picking it as a target and
    // walking to a body that no longer updated, the blade loop kept testing
    // against it, and `damage` kept addressing a closed connection.
    const i = world.players.indexOf(r);
    if (i >= 0) world.players.splice(i, 1);
    world.notify('A JEDI HAS FALLEN AWAY', `${r.name} left the fight`);
  });
  /**
   * The host is gone.
   *
   * There is no host migration, and there is not going to be one here — the
   * host owns the wave director, the enemy list and every spawn, and electing a
   * new one mid-run means transferring all of it. What there IS now is being
   * TOLD. This event had no handler at all, so the host closing the tab left a
   * joining player in a world where enemies stopped arriving, nothing could
   * hurt them and nothing ever said why. Saying so out loud is the smallest
   * honest thing, and it beats a silent, unwinnable room.
   */
  net.on('closed', () => {
    menu.netStatus('the host left — this run cannot continue', 'err');
    if (world && world.netMode === 'client') {
      // Nothing to stop: a client's director never started (main.js only calls
      // `start` when netMode !== 'client'), and the waves it was fighting came
      // from the host's snapshots. They simply stop arriving.
      world.notify('THE HOST HAS LEFT', 'no more waves will come — abandon when ready');
    }
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
  /**
   * The host says we were hit.
   *
   * Until this existed a joining player was INVULNERABLE, and not by half
   * measures: a client's enemies are `netDriven`, which returns before
   * `_think`, so they never fire a bolt and never run a duel strike — there was
   * nothing on this machine that could hurt us. Meanwhile the host skipped
   * remote avatars in its own blade loop and threw a TypeError when a bolt
   * reached one. Co-op had two players and one of them could not lose.
   *
   * Applied through OUR OWN Player.damage, so every boon that lives in the
   * damage path is consulted here where it actually exists: Second Wind,
   * Steadfast, Encircled, the difficulty's damageTaken. Tutaminis is the one
   * exception — `absorb` is applied at World's call site rather than inside
   * `damage`, so it has to be repeated here or a peer would silently lose it.
   */
  // A draft is open on the host. Draw OUR hand, from OUR taken-set.
  net.on('draft', (msg) => {
    if (!world || world.netMode !== 'client') return;
    offerDraft(drawBoons(msg.boss ? 4 : 3, world.takenBoons, msg.w || 1, {
      floor: msg.boss ? 'rare' : null,
      attune: !!msg.boss && (msg.w || 0) >= BOSS_EVERY,
    }));
  });
  net.on('hit', (msg) => {
    const p = world?.player;
    if (!p || !p.alive || !(msg.d > 0)) return;
    let d = msg.d;
    if (msg.k === 'bolt' && p.boonMods.absorb) {
      p.force = Math.min(p.maxForce, p.force + d * 0.8);
      d *= 0.45;
    }
    p.damage(d, null, null, msg.k || 'bolt');
  });
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

/**
 * The dojo's lesson navigation, read as ACTIONS once a frame.
 *
 * It used to be a raw `e.code === 'KeyN'` listener sitting right here, beside
 * a bindings table that had just been given `stasis` on KeyB and `rend` on
 * KeyN for the express purpose of making that collision visible. So in the
 * level the menu tags "start here", with a fresh profile, B threw a stasis
 * field AND stepped the lesson back, and N tore an enemy apart AND skipped it.
 * findConflict could not see it — a raw listener is not in the table — and no
 * rebind could separate them, for the same reason.
 *
 * Read in frame() rather than off a listener so it goes through the same
 * `input.actHit` every other verb uses, obeys `input.enabled`, and can be
 * rebound from the options screen like everything else.
 */
function lessonKeys() {
  if (state !== 'playing' || !world?.training) return;
  const d = world.director;
  if (!d) return;
  if (input.actHit('lessonNext')) { d.skip(); hud.setCoach(d.state()); }
  else if (input.actHit('lessonBack')) { d.back(); hud.setCoach(d.state()); }
  else if (input.actHit('lessonRepeat')) { d.repeat(); hud.setCoach(d.state()); }
}

/**
 * The coach panel's key legend, from the bindings rather than from the markup.
 *
 * index.html shipped `N next / B back / R etry with Y` baked in, which was
 * wrong the moment those keys were taken and would be wrong again after any
 * rebind. Same treatment as the scoreboard's key label below.
 */
function refreshCoachKeys() {
  const host = document.querySelector('#coach .coach-keys');
  if (!host) return;
  const k = (id) => keyLabel((input.bindings[id] || [])[0]);
  host.innerHTML = [
    [k('lessonNext'), 'next'], [k('lessonBack'), 'back'], [k('lessonRepeat'), 'again'],
  ].map(([key, what]) => `<span><kbd>${key}</kbd> ${what}</span>`).join('');
}
refreshCoachKeys();

window.addEventListener('keydown', (e) => {
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
/**
 * THE SCORE starts on the same gesture that unlocks the context, and only once.
 *
 * It is a 49-minute stream rather than a decoded buffer — see audio.playMusic —
 * so starting it early costs nothing: the browser fetches only what it is about
 * to play. Under the menu is exactly where it should begin.
 *
 * Best-effort throughout: if the file is missing or the browser refuses the
 * codec, `playMusic` returns null and the game is simply silent. The one asset
 * in this project that is not generated in code is also the only one that can
 * fail to arrive.
 */
const startScore = () => {
  audio.init(); audio.resume();
  audio.playMusic(new URL('../assets/music/theme.mp3', import.meta.url).href, { loop: true });
};
window.addEventListener('pointerdown', startScore, true);
window.addEventListener('keydown', startScore, true);

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
  // Before anything else: the gap since the last rAF is the only honest frame
  // time there is, and it has to be read before we spend any of this one.
  engine.profiler.begin(now);
  let dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.1);
  fpsSmooth += (1 / dt - fpsSmooth) * 0.04;

  input.begin(dt);

  // Held, and only while a run is live: the menus, the draft and the death card
  // own the screen otherwise, and this would sit on top of all three.
  setScoreboard(state === 'playing' && !!world && input.act('scoreboard'));
  lessonKeys();

  if (world && (state === 'playing' || state === 'dead')) {
    world.update(dt, input);
    if (world.remotes) for (const r of world.remotes.values()) {
      r.update(dt, { terrain: world.terrain, camera: engine.camera, time: world.time });
    }
    hud.update(dt, world, world.player, engine.camera);
    setGuardRose(world);
  } else if (world && (state === 'paused' || state === 'draft' || state === 'landing')) {
    // keep the camera alive behind the overlay
    world.player?.camera.update(dt, world.player.position, { physics: world.physics, terrain: world.terrain });
  }

  engine.render(dt);
  engine.profiler.end();
  hud.perf(engine.profiler, settings.showPerf);
  input.end();
}

/* ── the guard rose ──────────────────────────────────────────────────── */

/**
 * Light the petal for the guard the player is holding.
 *
 * Directional blocking is a DISCRETE STATE, and a discrete state the player
 * cannot see is one they cannot play: the whole scheme comes down to knowing
 * which of four zones you are in without having to look at your own blade. So
 * the rose is the readout for the mechanic rather than an ornament, and it is
 * read straight off the controller's own fields — `zone` and `guard.parry` —
 * so it cannot describe a guard the game is not actually holding.
 *
 * It lives here rather than in HUD.js because it is driven by the same round
 * that added the controller state, and because everything it needs is one
 * property lookup: routing it through the HUD's update signature would mean
 * teaching that layer about the blade to no purpose.
 */
const roseEl = document.getElementById('guard-rose');
const rosePetals = roseEl ? [...roseEl.querySelectorAll('.pet')] : [];
const roseThreat = { zone: null };
let roseZone = null, roseParry = null, roseWant = null;
function setGuardRose(world) {
  if (!roseEl) return;
  const control = world && world.player ? world.player.control : null;
  const on = !!control && control.scheme === 'directional';
  const zone = on ? control.zone : 'none';
  const parry = !!(on && control.guard && control.guard.parry);

  /**
   * The petal the NEXT bolt wants, so the mapping from "where it is coming
   * from" to "which way to flick" is something the player learns by looking
   * rather than by dying. Read through the same classifier the block itself
   * uses, off the same guard descriptor, so the hint cannot promise a zone that
   * would not actually answer.
   *
   * threatsNear() already returns the bolts closing on you sorted by time to
   * impact, so the first hostile one IS the next thing to answer. Its `point`
   * is a LIVE reference to bolt.pos and must never be kept — everything wanted
   * here is consumed inside this call.
   */
  let want = null;
  if (on && control.guard.active && world.bolts && world.player.chest) {
    const threats = world.bolts.threatsNear(world.player.chest, 30, roseThreats);
    for (const t of threats) {
      if (!t.bolt || t.bolt.team === world.player.team) continue;
      const vel = t.bolt.vel;
      _roseA.copy(t.point);
      _roseB.copy(t.point).addScaledVector(vel, 1 / 60);
      const z = guardZoneOf(_roseA, _roseB, control.guard, roseThreat).zone;
      // 'centre' is a bolt on your own centreline — every guard answers it, so
      // there is nothing to hint and pointing at one of the four would be a lie.
      if (z && z !== 'centre') want = z;
      break;
    }
  }

  // Repaint only on a change: this runs every frame, and a class write per
  // petal per frame is 240 style invalidations a second for a picture that
  // changes a handful of times in a fight.
  if (zone === roseZone && parry === roseParry && want === roseWant) return;
  roseZone = zone; roseParry = parry; roseWant = want;
  const up = on && zone !== 'none';
  roseEl.classList.toggle('on', up);
  roseEl.classList.toggle('parry', up && parry);
  for (const p of rosePetals) {
    p.classList.toggle('sel', p.dataset.zone === zone);
    p.classList.toggle('want', p.dataset.zone === want && p.dataset.zone !== zone);
  }
}
const roseThreats = [];
const _roseA = new THREE.Vector3(), _roseB = new THREE.Vector3();

/* ── go ──────────────────────────────────────────────────────────────── */

boot().then(() => requestAnimationFrame(frame));

// Handy for tuning from the console.
window.SABER = { engine, input, audio, get world() { return world; }, settings, net, menu, hud,
  get fps() { return Math.round(fpsSmooth); } };
