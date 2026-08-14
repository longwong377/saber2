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
import { sandMaps, rockMaps, metalMaps, clothMaps, armorMaps, duracreteMaps,
  soilMaps, snowMaps, skinMaps } from './engine/Textures.js';
import { World } from './game/World.js';
import { DIFFICULTY } from './game/Combat.js';
import { HUD } from './ui/HUD.js';
import { Menu, loadSettings, saveSettings, applyFeelSettings } from './ui/Menu.js';
import { Net, RemoteAvatar } from './net/Net.js';
import { boonById, drawBoons, BOSS_EVERY } from './game/Waves.js';
import { Run } from './game/Run.js';
import { recordRun, progressLines, loadProgress } from './game/Progress.js';
import { keyLabel } from './engine/Bindings.js';
import { guardZoneOf } from './game/Bolts.js';
import { clamp } from './engine/MathUtil.js';
import { Screens } from './ui/Screens.js';
import { SkillTree } from './ui/SkillTree.js';
import { Communion, shapeOf, constellationName, dominantAxis } from './game/Constellation.js';

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
 * WHAT THE PLAYER IS CALLED ON EVERY OTHER PLAYER'S SCREEN.
 *
 * One seam, because there were three call sites and all three passed
 * `net.name` back into the function that sets it — so the value could never be
 * anything but the constructor default and a four-player roster read 'Jedi'
 * four times. The fallback lives here rather than in the setting so that a
 * player who clears the field gets 'Jedi' back instead of an empty nameplate.
 */
const playerName = () => (settings.playerName || '').trim().slice(0, 18) || 'Jedi';
/** A name from the wire, on its way into innerHTML. */
const escName = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/**
 * Bloom is on when the PLAYER wants it and the TIER allows it.
 *
 * `QUALITY[tier].bloom` is the last column of Engine's table with no reader in
 * src/. It is FALSE on the Performance tier (Engine.js: `low: { … bloom: false
 * … }`) and true on the other three, which is the point — a tier that wants to
 * drop the bloom pass on integrated graphics can, without a second switch
 * appearing somewhere else to fight the checkbox. The cost of that is a
 * checkbox which does nothing on one tier, and a control the player operates
 * and the game ignores is the exact thing SETTING_READERS exists to prevent —
 * so the Menu disables the box and says why while the tier overrules it (see
 * Menu._syncBloomBox). This comment used to claim the column was `true` on all
 * four tiers, which stopped being true the moment the table changed and is how
 * the dead checkbox went unnoticed.
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
  onBindings: (b) => { input.setBindings(b); refreshCoachKeys(); hud.setBindings(b); },
  // Force settings are read live off world.settings, so the sliders take effect
  // mid-fight without a reload.
  onForce: () => {
    if (!world) return;
    world.settings.forcePower = settings.forcePower;
    world.settings.forceDrain = settings.forceDrain;
  },
  onSaberChange: (s) => { if (world?.player) world.player.setSaberColor(s.colorIndex); },
  // Live, like every other appearance hook: the world reads it every time the
  // Force draws itself, so a colour picked mid-run lands on the next bolt.
  onLightning: (hex) => { if (world) world.settings.lightningColor = hex; },
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
  /**
   * EVERY ground a level can name, plus every material a body is built from.
   *
   * `materialFrom` caches the expensive half — the pixel bake — under the
   * texture's NAME, independent of the repeat, so warming with the default
   * repeat here makes the level-load call a cheap texture-object construction.
   * A generator missing from this list is not merely unwarmed: it bakes 512²
   * of procedural noise on the first frame that needs it.
   *
   * THREE WERE MISSING, and they were the three that had been added most
   * recently. `soil` and `snow` are what `Terrain.js`'s ground presets resolve
   * to for meadow, drifts and alpine — which are the Spire's crown, shoulders
   * and flanks, so three of the four rungs baked their ground on the first
   * frame after a landing, at the exact moment the player is looking hardest at
   * a new place. `skin` is every body in the game, baked on the first spawn.
   *
   * tools/checks/levels.mjs fails if a ground preset is not warmed here, so
   * the next preset cannot quietly repeat this.
   */
  const steps = [
    ['forging blade', () => { }],
    ['grinding sand', () => sandMaps()],
    ['weathering rock', () => rockMaps()],
    ['turning soil', () => soilMaps()],
    ['drifting snow', () => snowMaps()],
    ['milling durasteel', () => metalMaps()],
    ['weaving robes', () => clothMaps()],
    ['casting plastoid', () => armorMaps()],
    ['pouring duracrete', () => duracreteMaps()],
    ['warming flesh', () => skinMaps()],
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
  screens.set('menu');
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
  /**
   * A wave paid out. Said out loud, and a beat after WAVE CLEAR rather than on
   * top of it — the director notifies first, and a currency that silently
   * accumulates is a currency the player never learns they have.
   */
  world.onInsight = (n, ledger) => {
    communePrompt.insight = Math.floor(ledger.insight);
    setTimeout(() => {
      if (screens.state === 'playing') hud.message(`INSIGHT +${n}`, `${Math.floor(ledger.insight)} held — kneel to connect to the Force`);
    }, 1500);
  };

  world.loadLevel(levelKey, { run });
  const player = world.spawnPlayer({ name: playerName(), isLocal: true });
  player.control.sensitivity = settings.sensitivity;
  player.control.followStrength = settings.camFollow;
  player.camera.fovTarget = settings.fov;
  player.camera.fov = settings.fov;

  // After spawnPlayer: the shake gate goes on this player's camera rig, and
  // there is no rig until there is a player.
  applyFeelSettings(world, settings);

  // `world.level`, not `LEVELS[levelKey]`: loadLevel is allowed to substitute
  // a level for a key it does not know, and the world is the only thing that
  // knows which one it settled on.
  hud.setLevel(world.rung ? world.rung.name : world.level.name, world.difficulty.name);
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
  screens.clear();

  // A rung BORROWS a level; outside the Spire the player's own choice stands.
  const levelKey = run && !run.done ? run.rung.level : settings.level;
  buildWorld(levelKey, run);

  if (net.enabled && net.connected) {
    world.attachNet(net, net.isHost ? 'host' : 'client');
    // …and `world.levelKey` for the same reason: a host whose own key missed
    // and fell back would otherwise tell every client to load the key that
    // missed, and each of them would fall back independently. They would agree
    // today, by luck, because the fallback is deterministic — but "the host
    // sends the level it is standing in" is the thing that has to be true.
    if (net.isHost) net.broadcast({ t: 'start', level: world.levelKey, difficulty: settings.difficulty, mode: settings.mode });
  }

  hud.show(true);
  screens.state = 'playing';
  input.enabled = true;
  input.requestLock();

  if (world.netMode !== 'client' && !world.training) world.director.start(1);
  if (run) world.notify(run.rung.name.toUpperCase(), run.rung.brief);
  else world.notify('MAY THE FORCE BE WITH YOU', world.level.name);
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
  audio.ui('wave');

  const cleared = run.rung;
  const more = run.ascend();      // heals, and steps the tier if there is one
  if (!more) return crowned(run);

  const next = run.rung;
  const ascend = screens.guarded('going down a rung', () => { screens.overlay = null; deploy(run); });
  screens.take('landing', () => menu.showLanding({
    altitude: next.altitude,
    name: next.name,
    brief: next.brief,
    stats: [
      [`${cleared.name} cleared`, `${cleared.waves} wave${cleared.waves === 1 ? '' : 's'}`],
      ['Climbed so far', `${run.depth} waves`],
      ['Vitality', `${Math.round(run.hpFrac * 100)}%`],
      ['Score', Math.floor(run.score).toLocaleString()],
    ],
    onAscend: ascend,
  }));
}

/** The crown. The one way this game has ever had of being finished. */
function crowned(run) {
  recordRun(run.summary());
  showRecord();
  screens.take('dead', () => menu.showDeath([
    ['Waves climbed', run.depth],
    ['Score', Math.floor(run.score).toLocaleString()],
    ['Kills', run.kills],
    ['Boons held', run.boons.length],
  ], 'You stand above the storm'));
}

/**
 * THE FREEZE — the state machine that could strand the player lives in
 * src/ui/Screens.js now, with the whole story of the bug written above it and
 * tools/checks/screens.mjs driving it with a menu that throws on demand. What
 * is left here is the wiring: which world, which menu, which numbers go on the
 * pause card.
 */
const screens = new Screens({
  world: () => world,
  input,
  menu,
  sandboxLive: () => sandboxRoomLive(),
  pauseStats: () => {
    const p = world?.player;
    return [
      ['Wave', world?.director?.wave ?? '—'],
      ['Score', Math.floor((world?.score ?? 0) + (p?.score || 0)).toLocaleString()],
      ['Kills', p?.kills ?? 0],
      ['Deflections', p?.deflects ?? 0],
      ['Perfect returns', p?.perfects ?? 0],
      ['Limbs taken', p?.limbsRemoved ?? 0],
    ];
  },
});

const resume = () => screens.resume();
const pause = () => screens.pause();

/* ══════════════════════════════════════════════════════════════════════ */
/*  The meditation                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * CONNECT TO THE FORCE.
 *
 * The constellation is opened by KNEELING, and that is the whole design of the
 * entry point rather than a flourish on it. A key that opens a menu is a menu;
 * what this is meant to be is a thing you do in the world, at a moment when the
 * world allows it — so it asks for the three conditions a moment of quiet
 * actually has:
 *
 *    you are still        no movement input, and not sliding
 *    you are on the floor grounded, not mid-leap
 *    nothing is near you  no live enemy inside COMMUNE.clear metres
 *
 * and then for a full second of holding Crouch, drawn as a ring that fills. It
 * cannot be triggered by accident in a fight because a fight fails all three,
 * and it cannot be reached at all when an overlay already owns the screen.
 *
 * It uses `crouch`, which is already in ACTIONS and already rebindable, rather
 * than a new key: the bindings table lives in src/engine/Bindings.js, a raw
 * `e.code` listener beside it is this project's oldest recurring bug (see
 * lessonKeys below), and "kneel" is what crouch already means.
 */
const COMMUNE = { hold: 1.0, clear: 14, still: 0.6 };

const communePrompt = {
  el: document.getElementById('commune'),
  fill: document.getElementById('commune-fill'),
  key: document.getElementById('commune-key'),
  held: document.getElementById('commune-insight'),
  entry: document.getElementById('btn-commune'),
  charge: 0,
  shown: false,
  insight: 0,
};

const tree = new SkillTree(document, {
  onBuy: (id) => buyStar(id),
  onClose: () => closeMeditation(),
});
// Screens now knows how to take this card down, which is what makes a pause
// raised over a meditation (or a callback that threw inside one) recoverable
// instead of leaving a star map sitting on top of the pause menu.
screens.card('meditation', () => tree.hide());

/** Is a communion possible this frame? The three conditions, in order. */
function canCommune() {
  if (screens.state !== 'playing' || !world) return false;
  const p = world.player;
  if (!p || !p.alive || !p.grounded) return false;
  if (Math.hypot(p.velocity.x, p.velocity.z) > COMMUNE.still) return false;
  const r2 = COMMUNE.clear * COMMUNE.clear;
  for (const e of world.enemies) {
    if (!e.dead && e.position.distanceToSquared(p.position) < r2) return false;
  }
  return true;
}

const _moveAxis = { x: 0, y: 0 };
/** The kneel, read once a frame with everything else. */
function communeTick(dt) {
  const el = communePrompt.el;
  const ok = canCommune();
  if (!ok) {
    communePrompt.charge = 0;
    if (communePrompt.shown && el) { el.classList.add('hidden'); communePrompt.shown = false; }
    return;
  }
  if (!communePrompt.shown && el) {
    el.classList.remove('hidden');
    communePrompt.shown = true;
    // The label is read off the live binding, never typed in — the same rule
    // the coach panel and the scoreboard follow, and for the same reason.
    if (communePrompt.key) communePrompt.key.textContent = keyLabel((input.bindings.crouch || [])[0]);
    // …and the purse, so the prompt is a reason and not just an instruction.
    // Written when the prompt is raised rather than every frame: it only moves
    // on a wave clear, and this runs sixty times a second.
    const n = Math.floor(world?.communion?.insight ?? communePrompt.insight);
    if (communePrompt.held) communePrompt.held.textContent = n > 0 ? `${n} Insight` : '';
  }
  input.moveAxis(_moveAxis);
  const holding = input.act('crouch') && !_moveAxis.x && !_moveAxis.y;
  communePrompt.charge = holding
    ? communePrompt.charge + dt
    : Math.max(0, communePrompt.charge - dt * 2.5);
  if (communePrompt.fill) {
    communePrompt.fill.style.height = `${Math.round(100 * clamp(communePrompt.charge / COMMUNE.hold, 0, 1))}%`;
  }
  if (communePrompt.charge >= COMMUNE.hold) {
    communePrompt.charge = 0;
    if (el) { el.classList.add('hidden'); communePrompt.shown = false; }
    openMeditation();
  }
}

/**
 * The way in from the Temple, between runs.
 *
 * A button rather than a kneel, because there is no body to kneel with at the
 * menu — and it exists at all because a star map you can only see mid-fight is
 * one you can never study. What it opens there is read-only; see openMeditation.
 */
let _entryShown = null;
function setCommuneEntry(show) {
  const b = communePrompt.entry;
  if (!b || show === _entryShown) return;
  _entryShown = show;
  b.classList.toggle('hidden', !show);
}
communePrompt.entry?.addEventListener('click', () => { audio.ui('click'); openMeditation(); });

/** What the sky is being read with: the run's own alignment. */
function communeContext(live) {
  const taken = world ? world.takenBoons : new Set();
  const ledger = world ? world.communion : new Communion();
  // Between runs the chart is drawn over the RECORD: the stars this player has
  // ever held, in a fainter colour. It buys nothing and carries nothing into
  // the next run (see Progress.js) — it is the answer to "what have I actually
  // tried", which is the question a star map is for when you cannot spend.
  const history = live ? null : Object.entries(loadProgress().lit || {});
  return {
    taken, ledger, live,
    wave: world?.director?.wave ?? 1,
    order: settings.order || null,
    history: history ? new Map(history) : null,
    subtitle: live
      ? 'Insight is earned by surviving. A star may be lit if you already hold one joined to it.'
      : undefined,
  };
}

function openMeditation() {
  audio.ui('good');
  if (world) {
    // Through Screens, exactly as the draft goes: the world stops, the overlay
    // is remembered, and a throw anywhere inside lands on the pause card.
    screens.take('meditation', () => tree.show(communeContext(true)));
    return;
  }
  // Between runs there is no world to stop and no Insight to spend. The sky is
  // a chart you read and a plan you make — see the doctrine note in
  // Constellation.js about why it is deliberately not a shop.
  tree.show(communeContext(false));
}

function closeMeditation() {
  if (!world) { tree.hide(); return; }
  // The overlay is forgotten FIRST, or resume() would put the star map straight
  // back on the screen. Same idiom as answering a draft.
  tree.hide();
  screens.overlay = null;
  screens.state = 'paused';
  resume();
}

/**
 * Spend Insight on a star.
 *
 * The purchase itself is `Communion.buy`, which decides and charges; the EFFECT
 * goes through `World.applyBoon`, which is the only path that records the rank
 * on the taken-set, tells the Run, applies it to every local player and
 * re-derives what depends on it. A star that applied its own boon would be a
 * second, divergent way of taking a card — and the first thing it would break
 * is a landing, which replays the Run's list into a freshly built player.
 */
const buyStar = (id) => screens.guarded('lighting a star', (starId) => {
  if (!world) return;
  const boon = world.communion.buy(starId, world.takenBoons, world.director?.wave ?? 1);
  if (!boon) return;                       // not affordable / not reachable — the UI said so
  world.applyBoon(boon);
  hud.setBoons(heldBoons());
  tree.refresh();
})(id);

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
  screens.clear();
  hud.show(false);
  input.enabled = false;
  input.exitLock();
  // An abandoned climb still happened. Recording it is what stops "deepest
  // reached" from quietly meaning "deepest you happened to die on".
  if (world?.run && !world.run.done) { world.run.end(); recordRun(world.run.summary()); }
  if (world) { world.dispose(); world = null; }
  showRecord();
  menu.showMenu();
  screens.set('menu');
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
  screens.state = 'dead';
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
  // Remembered rather than shown and forgotten: 2.6 seconds is a long time for
  // the only exit from a state to be in flight, and if the call throws the
  // player is watching their own corpse with nothing on screen. Escape puts it
  // back — see the keydown handler.
  const card = () => menu.showDeath([
    ['Wave reached', stats.wave],
    ['Score', Math.floor(stats.score).toLocaleString()],
    ['Kills', stats.kills],
    ['Deflections', stats.deflects],
    ['Perfect returns', stats.perfects],
    ['Limbs taken', stats.limbs],
  ]);
  // Remembered before it is shown: 2.6 seconds is a long time for the only exit
  // from a state to be in flight, and a throw in there used to leave the player
  // watching their own corpse with nothing on screen. Escape asks for it again.
  screens.overlay = { state: 'dead', show: card };
  setTimeout(screens.guarded('the death card', () => { input.exitLock(); card(); }), 2600);
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
  const pick = screens.guarded('taking a boon', (b) => {
    // The overlay is forgotten FIRST: resume() would otherwise put the draft
    // the player has just answered straight back on the screen.
    screens.overlay = null;
    screens.state = 'paused';        // so resume() takes the playing branch
    world.applyBoon(b);
    hud.setBoons(heldBoons());
    resume();
  });
  screens.take('draft', () => menu.showDraft(boons, pick));
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
  /**
   * THE HOLDING, AS A SHAPE. `takenBoons` is a set and the chips below are a
   * list, which is the flat readout the constellation exists to replace: seven
   * chips tell you what you have and nothing about what you ARE. The two rows
   * added here are read straight off the same tree the meditation draws, so
   * they cannot describe a build the sky does not show.
   */
  const shape = shapeOf(world.takenBoons).filter((r) => r.lit > 0).sort((a, b) => b.ranks - a.ranks);
  const axis = dominantAxis(world.takenBoons);
  scoreEl.stats.innerHTML = [
    ['Wave', world.director?.wave ?? 1],
    ['Score', Math.floor(world.score + (p?.score || 0)).toLocaleString()],
    ['Kills', p?.kills ?? 0],
    ['Deflections', p?.deflects ?? 0],
    ['Perfect returns', p?.perfects ?? 0],
    ['Limbs taken', p?.limbsRemoved ?? 0],
    ['Insight', Math.floor(world.communion?.insight ?? 0)],
    ['Constellation', axis ? constellationName(axis, settings.order) : '—'],
    ['Stars lit', shape.reduce((n, r) => n + r.lit, 0)],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

  // Only in co-op. Solo, a one-row table of yourself is noise.
  const roster = net.enabled && net.connected ? net.roster : [];
  // The name is peer-supplied (Net.js reads it off `conn.metadata`), so it is
  // escaped here the way HUD.popup and the boon chips already escape theirs.
  scoreEl.roster.innerHTML = roster.map(r =>
    `<div class="p"><i></i><span>${escName(r.name)}</span>${r.host ? '<em style="margin-left:auto;color:#8b98ad">host</em>' : ''}</div>`).join('');

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
    if (screens.state === 'menu') deploy();
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
  /**
   * An ally's communion reached us.
   *
   * Applied through World.applyBond, which writes the same `_bondIn` slot a
   * same-machine ally's aura writes — so the co-op path and the solo-machine
   * path are one mechanism with one reader, and a bond card cannot work in a
   * test and be silently dead over the wire. This is the receiving half; the
   * sending half is World._bondTick, and Net.js relays a bond addressed to a
   * peer the sender cannot reach directly.
   */
  net.on('bond', (msg, peerId) => { world?.applyBond(msg, peerId); });
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
    const code = await net.host(playerName(), {
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
    await net.join(code, playerName());
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
  if (!locked && screens.state === 'playing') pause();
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
  if (screens.state !== 'playing' || !world?.training) return;
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
// …and the power wheel, which carried five typed key letters before this, two
// of them wrong on a fresh install. It is on screen for the whole fight.
hud.setBindings(input.bindings);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && tree.open) {
    // The star map's own way out, and it is the same one the Return button
    // uses. Not a special case in the state machine: closing it restores the
    // world through `resume()` exactly as answering a draft does, so Escape
    // still changes what is on the screen (rule 1) and still cannot leave the
    // world stopped with nothing on top of it.
    closeMeditation();
    return;
  }
  if (e.code === 'Escape') {
    // Never a dead key. From 'paused' it resumes; on a death card it puts the
    // card back (idempotent — the card is that state's only exit and a card
    // that failed to arrive is the only way to be stuck there); from every
    // other state with a live world it raises the pause card, which can always
    // resume or abandon. See pause().
    screens.escape();
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
 * to play, and nothing at all while the Music slider is at zero. Under the menu
 * is exactly where it should begin.
 *
 * Best-effort throughout: if the file is missing or the browser refuses the
 * codec, `playMusic` returns null and the game is simply silent. The one asset
 * in this project that is not generated in code is also the only one that can
 * fail to arrive.
 *
 * The list is the whole score, in order. A soundtrack split to get under
 * GitHub's 25 MB web-upload limit (see assets/music/README.md) adds
 * 'theme2.mp3' to this array and nothing else: playMusic chains a list on
 * `ended` and wraps back to the first. It is a list rather than a directory
 * scan because a static host has no directory listing to scan.
 */
const TRACKS = ['theme.mp3'].map(f => new URL(`../assets/music/${f}`, import.meta.url).href);
const startScore = () => {
  audio.init(); audio.resume();
  audio.playMusic(TRACKS, { loop: true });
};
window.addEventListener('pointerdown', startScore, true);
window.addEventListener('keydown', startScore, true);

canvas.addEventListener('pointerdown', () => {
  audio.init(); audio.resume();
  if (screens.state === 'playing' && !input.locked) input.requestLock();
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
  setScoreboard(screens.state === 'playing' && !!world && input.act('scoreboard'));
  lessonKeys();
  communeTick(dt);
  setCommuneEntry(screens.state === 'menu' && !tree.open);

  if (world && (screens.state === 'playing' || screens.state === 'dead')) {
    world.update(dt, input);
    if (world.remotes) for (const r of world.remotes.values()) {
      r.update(dt, { terrain: world.terrain, camera: engine.camera, time: world.time });
    }
    hud.update(dt, world, world.player, engine.camera);
    setGuardRose(world);
  } else if (world && screens.state !== 'menu') {
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
