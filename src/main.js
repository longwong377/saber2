/**
 * BATTLEFRONT BORZ — entry point.
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
import { Menu, loadSettings, saveSettings, applyFeelSettings, VICTORY_TITLE } from './ui/Menu.js';
import { Net, RemoteAvatar, packLook } from './net/Net.js';
import { boonById, drawBoons, BOSS_EVERY, MODES } from './game/Waves.js';
// No `FORMATIONS` import any more: the orders reach this file as ordinary
// bindings through `ORDER_ACTIONS` below, which is the point of the seam.
import { recordRun, progressLines, loadProgress } from './game/Progress.js';
import { keyLabel, ORDER_ACTIONS } from './engine/Bindings.js';
import { guardZoneOf } from './game/Bolts.js';
import { clamp } from './engine/MathUtil.js';
import { Screens } from './ui/Screens.js';
import { SkillTree } from './ui/SkillTree.js';
import { Communion, shapeOf, livingForceName, dominantAxis } from './game/LivingForce.js';

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

/**
 * THE HOST'S CHOICES, KEPT OUT OF THE PLAYER'S SAVE FILE.
 *
 * Joining a friend's session used to write `settings.level`, `settings.difficulty`
 * and `settings.mode` straight onto the player's own settings object — which
 * `deploy()` then persisted to localStorage wholesale. So playing one round in
 * somebody else's Grandmaster Descent permanently rewrote your saved level,
 * difficulty and mode, and your next SOLO run silently started in theirs.
 *
 * A session is a different scope from a preference. Null outside co-op, so
 * `sessionOr` is the identity function for a solo player.
 */
let session = null;
const sessionOr = (key) => (session && session[key] !== undefined ? session[key] : settings[key]);
/** The settings a world is built from: the player's, with the host's overrides. */
const worldSettings = () => (session ? { ...settings, ...session } : settings);
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
  onDeploy: () => { deploy().catch((e) => console.error('deploy failed', e)); },
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
  onRetry: () => { cancelDeathCard(); menu.hideDeath(); deploy().catch((e) => console.error('deploy failed', e)); },
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
  onLeave: () => { leaveSession(); menu.netSession(null); },
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

async function buildWorld(levelKey, onProgress = null) {
  if (world) { world.dispose(); world = null; }
  audio.init();
  audio.resume();

  // The player's settings, with whatever the host of this session decided
  // laid over them — and never the other way round. See `session` above.
  world = new World(engine, worldSettings());
  // The player's own difficulty — and then the host's over the top of it, if
  // this is their session. Two statements rather than one `sessionOr`, because
  // `settings.difficulty` is the named reader Menu.SETTING_READERS points at
  // and a setting whose only reader is behind an indirection is a setting the
  // "every control reaches the game" check can no longer see.
  world.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.knight;
  if (session?.difficulty) world.difficulty = DIFFICULTY[session.difficulty] || world.difficulty;

  world.onNotify = (t, s) => hud.message(t, s);
  world.onFloating = (p, text, color) => hud.floating(p, text, color);
  world.onHitmark = (p, kind, bone) => hud.hitmark(p, kind, bone);
  /**
   * A BODY WANTS TO SAY SOMETHING — player note #21, "I want to hear their
   * screams… as they get force thrown or killed".
   *
   * Enemy.js decides WHEN (see `Enemy.cry`) and deliberately decides nothing
   * else, because both of the other decisions already have exactly one owner
   * and duplicating either is the defect this project keeps removing:
   * `_enemySpec` derives the larynx from `bodyOf`, the roster's one body
   * classifier, and `_enemyLine` spends the shared budget that stops five
   * simultaneous deaths from talking over each other. So the event goes to the
   * announcer and the announcer answers both questions.
   *
   * The two methods are private today, which is the wart in this line and not
   * in the design: `Announcer` wants a public `enemyLine(enemy, kind)` that is
   * exactly these two calls, and it is owned by another pass this session.
   */
  world.onEnemyVoice = (enemy, kind) => {
    const a = hud.announcer;
    if (!a || !enemy?.position) return;
    a._enemyLine(a._enemySpec(enemy), kind, enemy.position, settings.enemyVoices !== false);
  };
  world.onKillFeed = (who, what, kind) => hud.killFeed(who, what, kind);
  world.onGameOver = (stats) => gameOver(stats);
  world.onDraftOffer = (boons) => offerDraft(boons);
  world.onDeflectFeedback = (grade, point, why) => {
    // grades: -1 wrong answer, 0..3 deflection quality, 4 chamber, 5 lock
    const colour = grade >= 4 ? '#ffd88a' : grade >= 2 ? '#8fe8ff' : grade < 0 ? '#ff8080' : '#9fb0c6';
    hud.explain(why, colour, grade < 0 ? 2.0 : 1.4);
  };

  /**
   * YOU ARE DOWN, and your friends are not.
   *
   * The card, the pointer release and `input.enabled = false` used to hang off
   * `onGameOver` alone, which requires every player in the session to be dead —
   * so the first person to fall in a co-op run got nothing whatsoever and lay
   * in a corpse with a live camera and a locked pointer until somebody else
   * died. This is the same exit, for one player, and it says what happens next
   * rather than offering to restart a run the others are still in.
   */
  world.onLocalDown = () => downed();
  world.onLocalRevive = () => rose();
  /**
   * A wave paid out. Said out loud, and a beat after WAVE CLEAR rather than on
   * top of it — the director notifies first, and a currency that silently
   * accumulates is a currency the player never learns they have.
   */
  world.onInsight = (n, ledger) => {
    communePrompt.insight = Math.floor(ledger.insight);
    setTimeout(() => {
      if (screens.state === 'playing') hud.message(`INSIGHT +${n}`, `${Math.floor(ledger.insight)} held — kneel to open the Holocron`);
    }, 1500);
  };

  /**
   * ASYNC, SO THE TAB DOES NOT SIMPLY STOP.
   *
   * This was `world.loadLevel(levelKey)` — one synchronous statement that built
   * a terrain heightfield, a Rapier world, every instanced field, the level's
   * textures and up to 224 hand-placed props on the main thread. Measured:
   * 352-1090 ms warm and 3821 ms on a cold first build, with no progress bar,
   * no spinner and no yield. The only feedback a player got was that the page
   * stopped responding and then the menu was gone.
   *
   * The boot sequence has done this properly all along — eleven named steps,
   * each awaiting a frame behind a progress bar — and deploy() never used it.
   * `loadLevelAsync` yields between seven named stages; `unload()` is its own,
   * because it is 2408 ms of a 3706 ms rebuild and hiding it would leave the
   * longest single pause unaccounted for.
   *
   * `loadLevel` stays synchronous for `toon/live.js` and the check suites.
   */
  await world.loadLevelAsync(levelKey, {}, onProgress);
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
  hud.setLevel(world.level.name, world.difficulty.name);
  hud.setBoons(heldBoons());

  if (world.training) {
    world.director.onLesson = (state) => hud.setCoach(state);
    world.director.start();
    hud.setCoach(world.director.state());
  } else hud.showCoach(false);

  /**
   * THE ARMY'S THREE WIRES — all three ends exist now, and none of them did.
   *
   * `CommandDirector` publishes everything the front end needs and reaches for
   * nothing: a roster summary when a name is promoted or lost, a muster offer
   * between areas, and the formation whenever an order is given. All three
   * calls were here and ALL THREE WENT NOWHERE. `hud.setRoster?.()` and
   * `hud.setOrder?.()` named methods that did not exist, so the optional-call
   * operator swallowed them silently on every promotion and every casualty for
   * the whole life of the mode; and `typeof screens.muster === 'function'` was
   * false, so `onMuster` was never installed and the director took its
   * documented fallback — `autoMuster()`, spending the player's reinforcement
   * points for them, between every area, with nothing on the screen.
   *
   * The `?.` stay. They are not decoration: this is the one place three
   * subsystems in three files meet, and a front end that cannot draw a roster
   * must still not be able to stop a campaign. What has changed is that they
   * now find something.
   */
  if (world.command) {
    const d = world.command;
    d.onRoster = (summary) => hud.setRoster?.(summary);
    if (typeof screens.muster === 'function') {
      d.onMuster = (offer) => screens.muster(offer, {
        /* Buy, then re-read. The director guards every refusal case itself and
         * puts the reason on `refused`, so the screen asks for the new offer
         * rather than adjusting a copy of the numbers — a screen keeping its
         * own points would disagree with the director the first time it was
         * told no, and a muster whose totals lie is worse than no muster. */
        recruit: (type) => {
          d.recruit(type);
          return { offer: d.musterOffer(), refused: d.refused };
        },
        done: () => {
          /* The overlay is forgotten FIRST — `resume()` would otherwise put the
           * muster the player has just finished straight back on the screen.
           *
           * But the state is moved to 'paused' AFTER `closeMuster`, and that
           * ordering is deliberate. `closeMuster` deploys the whole roster: it
           * builds a body per living trooper, and it is the riskiest call in
           * this file. It runs inside `guarded`, and `guarded`'s recovery is
           * `pause()` — which returns FALSE without showing anything when the
           * state is already 'paused'. So saying 'paused' before the throw
           * would cost the player the one card that can always resume or
           * abandon. Left at 'muster' it is an ordinary live overlay state and
           * the pause card arrives. */
          screens.overlay = null;
          d.closeMuster();
          screens.state = 'paused';        // so resume() takes the playing branch
          hud.setRoster?.(d.roster.summary());
          resume();
        },
      }) || fallbackMuster(d);
    }
    d.onOrder = (F, squads) => hud.setOrder?.(F.id, F.name, squads);
    d.onRoster(d.roster.summary());
    /* The formation you START in, which nothing announced. `order()` fires
     * `onOrder` and the opening formation is never ordered — it is configured
     * (settings.commandFormation, through commandConfig) — so without this the
     * indicator would read '—' until the player pressed a key, which is exactly
     * the question it exists to answer. `readout()` is the authority for both
     * the id and the name — and for the squad count too, which used to be
     * fetched separately off `roster.squads().length`. That was a second caller
     * deriving a number the readout had everything for, and it is unanswerable
     * on a joining player's machine, where the roster is a wire record rather
     * than a list of Troopers. */
    const r = d.readout();
    hud.setOrder?.(r.formation, r.formationName, r.squads);
    hud.setLevel(`${world.level.name} — ${d.area.name}`, world.difficulty.name);
  } else {
    // Every other mode. The panel is one flow with the bars, so leaving it up
    // in a Trial of Waves would push a stale army list into the corner of a
    // run that has no army — and `hidden` is the only thing that takes its
    // height back out of the column.
    hud.setRoster?.(null);
  }

  return world;
}

/**
 * IGNITE — and the order of these lines is the whole of a MAJOR failure.
 *
 * It used to be: hide the menu, clear the screens, THEN do the work that can
 * throw. `screens.state` is only set to 'playing' after the build, and
 * `Screens.pause()` returns false for state 'menu' by construction — so on any
 * machine where the Rapier WASM never instantiated (blocked by CSP, a failed
 * vendor fetch, an OOM on the 1.4 MB module), the documented path is: reach the
 * menu exactly as `initPhysics`'s own comment promises, press Ignite, and watch
 * the menu vanish into a black screen with a dead Escape key and no way back
 * but a page reload. `RapierWorld`'s constructor throws by design there, and
 * `grep -n 'try' src/main.js` found nothing anywhere on this path. The same
 * void swallowed any throw out of Terrain, a level's dress() or Scenery.
 *
 * BUILD FIRST, REVEAL SECOND. Nothing the player can see changes until there is
 * a world to show them, and a failure puts the menu back with the reason on it.
 */
async function deploy() {
  // The PLAYER's settings, never the session's. `session` is a separate object
  // for exactly this line: this used to persist the host's level, difficulty
  // and mode into the joining player's save.
  saveSettings(settings);

  /* The player's own choice stands — or the host's, in a session — UNLESS the
   * mode owns its ground. `MODES.command` declares `level: 'geonosis'`, which
   * is the machine-readable half of the `fixedTheatre` sentence the menu prints
   * while greying the Theatre column. Without this line the menu said Geonosis
   * and the army deployed onto whatever was last picked, which for a fresh
   * profile is the Ember Shelf. */
  const levelKey = MODES[settings.mode]?.level ?? sessionOr('level');
  try {
    /* AWAITED, so the build yields between its stages instead of freezing the
     * tab. The progress callback is the same shape the boot sequence's bar
     * already takes; `screens.loading` renders it if it exists, and a build
     * that finishes before the first paint simply never shows one. */
    await buildWorld(levelKey, (frac, label) => screens.loading?.(frac, label));
  } catch (e) {
    console.error('deploy failed', e);
    if (world) { try { world.dispose(); } catch {} world = null; }
    hud.show(false);
    input.enabled = false;
    menu.showMenu();
    screens.set('menu');
    // Said out loud on the one line of the main menu this file already owns,
    // because a failure the player cannot see is the same black screen.
    const el = document.getElementById('menu-record');
    if (el) el.textContent = `Could not deploy: ${e.message || e}`;
    return;
  }

  // Only now is the menu allowed to go: from here on there is a world behind
  // it, so Escape has somewhere to land.
  cancelDeathCard();
  menu.hideMenu();
  menu.hideDeath();
  screens.clear();

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

  /* A MEETING STARTS ITSELF DIFFERENTLY, and it is the same one line either
   * way. `beginVersus` hands out the sides, the armies and the two anchors and
   * then starts the director itself — a meeting has no wave to compose, so
   * `start(1)` alone would deploy one army into the middle of an empty plain
   * with nothing on the other side of it. It runs again when a peer's body
   * arrives (see the avatar handler), which is when their commander gets
   * somebody to lead. */
  if (world.netMode !== 'client' && !world.training) {
    if (world.command?.versus) world.beginVersus();
    else world.director.start(1);
  }
  world.notify('MAY THE FORCE BE WITH YOU', world.level.name);
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
 * The livingForce is opened by KNEELING, and that is the whole design of the
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
      ? 'Insight is earned by surviving. A facet wakes only if you already hold one joined to it.'
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
  // LivingForce.js about why it is deliberately not a shop.
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

/**
 * RESTART THE WAVE — a single-player affordance, on an always-visible button.
 *
 * On a co-op CLIENT it was catastrophic and permanent: it disposed every enemy
 * and emptied `world.enemies` without touching `world._netEnemyIndex`, and
 * `applySnapshot` only spawns a body for an id that is NOT already in that map.
 * So every id the host was still sending resolved to a disposed Enemy that
 * could never be recreated: measured four net-driven enemies before, zero
 * after, with all four ids still held. The arena stayed empty for the rest of
 * the host's wave while `hit` messages kept arriving from bodies that no longer
 * existed on screen — and it started a second, local wave director on a machine
 * that is supposed to have none.
 *
 * The horde is not this machine's to restart. Say so instead of doing it.
 */
function restartWave() {
  if (!world) return;
  if (!world.restartWave()) world.notify('THE HOST OWNS THE HORDE', 'the wave cannot be restarted from here');
  resume();
}

function quitToMenu() {
  // Before anything else: a card scheduled 2.6 s ago must not land on the menu.
  cancelDeathCard();
  menu.hideDeath();
  screens.clear();
  hud.show(false);
  input.enabled = false;
  input.exitLock();
  // AND LEAVE THE SESSION. `Net.close` was complete and had zero callers in the
  // repository, so quitting to the menu did not leave a co-op game: the
  // connection stayed up, the other machines kept a frozen body of you in
  // `world.players` that enemies went on targeting, and the next Ignite
  // re-attached you as a client of the same host. Solo play was unreachable
  // without reloading the tab.
  leaveSession();
  // An abandoned session still happened. Recording it is what stops "deepest
  // reached" from quietly meaning "deepest you happened to die on".
  record();
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

/**
 * THE DEATH CARD'S TIMER, WHICH NOBODY OWNED.
 *
 * The card lands 2.6 s after death so the collapse can play. That timeout was
 * scheduled with no handle and no state test — and Screens.escape() invites the
 * player to ask for the card early ("a corpse cannot be resumed, so Escape asks
 * for the card again instead"). So: die, press Escape, click Rise again, and
 * 2.6 seconds into the NEW fight the stale timer fires. `input.exitLock()`
 * drops the pointer lock, `onLockChange` pauses the live run, and `card()` — a
 * closure over the DEAD run's stats — un-hides #death over the pause card.
 * `screens.overlay` was cleared by deploy(), so Screens has no record of it and
 * `resume()` cannot take it down. The same timer re-raises the card over the
 * main menu if the player quits instead.
 *
 * One handle, cancelled by every transition out of the dead state.
 */
let deathTimer = null;
function cancelDeathCard() {
  if (deathTimer !== null) { clearTimeout(deathTimer); deathTimer = null; }
  document.getElementById('btn-retry')?.classList.remove('hidden');
}

/**
 * Show a card after a delay, and only if the player is still where they were.
 * The state test is the belt to the clearTimeout's braces: a timer that has
 * already been dispatched cannot be cancelled, only refused.
 */
function cardAfter(ms, what, show) {
  cancelDeathCard();
  deathTimer = setTimeout(screens.guarded(what, () => {
    deathTimer = null;
    if (screens.state !== 'dead') return;
    input.exitLock();
    show();
  }), ms);
}

/**
 * WHAT A FINISHED SESSION LEAVES BEHIND, whatever mode it was.
 *
 * A Run is still the CLIMB's alone — `startRun` builds one only for the
 * gauntlet, tools/checks/run.mjs pins that, and giving every mode a Run would
 * silently change what "Abandon" means in all of them. But the RECORD is
 * everyone's: all three `recordRun` calls used to be gated on `world.run`, so
 * the shipped default mode left no trace at all and the menu's one line of
 * history stayed empty however long you played.
 *
 * `Progress.recordRun` decides which modes count; training and the sandbox are
 * refused there rather than here.
 *
 * ONCE PER WORLD, AND IT WAS ONCE PER CALLER.
 *
 * `gameOver` records, and `quitToMenu` records — and the death card's second
 * button IS `quitToMenu` (Menu.js binds `#btn-menu` to `onQuit`). So the very
 * first thing a new player does after their very first death, on the shipped
 * default mode, wrote the same run to the store twice. Driven in a browser
 * against the real page with both localStorage keys removed so the game chose
 * its own defaults (scoria / knight / roguelite): kill the player and the
 * store reads `{runs: 1, recent: 1}`; click "Return to the Temple" on that same
 * card, with no other input, and it reads `{runs: 2, recent: 2}` and the menu
 * prints "2 runs, 0 felled · deepest 1 wave" after one run.
 *
 * The Descent was immune because `Run.end()` sets `done` and the branch below
 * returns on it — which is exactly this guard, written for one mode out of six.
 * `startRun` builds a Run for the gauntlet alone, so roguelite (the default),
 * waves and duel had nothing playing that part. The flag lives on the WORLD
 * rather than in a module-level variable for the same reason `run.done` does: a
 * world is one session, and the next Ignite builds a new one.
 *
 * Not every total doubled, which is why this was easy to look at and not see:
 * `Progress.recordRun` adds `runs`, `kills`, `communed`, the lit stars and the
 * forty-entry `recent` history, but takes `Math.max` for `bestDepth`,
 * `bestScore`, `bestTier` and the by-order/species/mode maps. Hence a record
 * line reading "2 runs" beside "roguelite 1".
 */
function record(stats = null) {
  if (!world) return;
  if (world._recorded) return;
  world._recorded = true;
  recordRun({
    ...(stats || { wave: world.director?.wave ?? 0, score: world.score,
                   kills: world.players.reduce((a, p) => a + (p.kills || 0), 0) }),
    mode: sessionOr('mode'),
    boons: [...(world.takenBoons || [])],
    identity: { order: settings.order, species: settings.species },
  });
}

function gameOver(stats) {
  screens.state = 'dead';
  input.enabled = false;
  // A session that ended is a session that happened. `gameOver` used to reduce
  // it to a card and throw it away — the only two localStorage keys in the tree
  // were settings and keybinds, so you could play for an hour and the game
  // would not know you had ever played. This is a record, not a currency:
  // nothing here unlocks anything (see Progress.js).
  record(stats);
  // Remembered rather than shown and forgotten: 2.6 seconds is a long time for
  // the only exit from a state to be in flight, and if the call throws the
  // player is watching their own corpse with nothing on screen. Escape puts it
  // back — see the keydown handler.
  /**
   * A WON RUN AND A LOST RUN ARE NOT THE SAME CARD.
   *
   * `showDeath` has always taken a title and nothing has ever passed one, so a
   * player who finished the Geonosis campaign — the one completable thing in
   * this game — was told "You are one with the Force" over a table of their own
   * casualties. The campaign now sets `won` (Command.js raises it the moment the
   * advance is over, and `world.onGameOver` carries it), so the discriminator
   * exists and this is the one place that has to read it.
   *
   * The stat rows change with it. "Wave reached" is the right question for an
   * endless mode and the wrong one for a campaign you have just finished; a
   * won run reports the ground it took instead.
   */
  const won = !!stats.won;
  const rows = won
    ? [
      ['Areas taken', stats.areas ?? 5],
      ['Score', Math.floor(stats.score).toLocaleString()],
      ['Kills', stats.kills],
      ['Troops lost', stats.fallen ?? 0],
      ['Deflections', stats.deflects],
      ['Limbs taken', stats.limbs],
    ]
    : [
      ['Wave reached', stats.wave],
      ['Score', Math.floor(stats.score).toLocaleString()],
      ['Kills', stats.kills],
      ['Deflections', stats.deflects],
      ['Perfect returns', stats.perfects],
      ['Limbs taken', stats.limbs],
    ];
  const card = () => menu.showDeath(rows, won ? VICTORY_TITLE : undefined);
  // Remembered before it is shown: 2.6 seconds is a long time for the only exit
  // from a state to be in flight, and a throw in there used to leave the player
  // watching their own corpse with nothing on screen. Escape asks for it again.
  screens.overlay = { state: 'dead', show: card };
  cardAfter(2600, 'the death card', card);
}

/**
 * DOWN, WITH THE RUN STILL GOING.
 *
 * Everything `gameOver` does about the SESSION — end the run, record it, offer
 * to redeploy — is wrong here: the run has not ended, and "Rise again" would
 * tear down a world your friends are still standing in. What is right is
 * everything it does about the PLAYER: stop reading input, give the pointer
 * back, and put something on the screen that says what is happening. The
 * revive is `World._reviveDowned`, at the next wave the party survives.
 */
function downed() {
  if (screens.state === 'dead') return;
  screens.state = 'dead';
  input.enabled = false;
  const card = () => {
    // The retry button restarts a RUN. There is no run to restart while the
    // others are still in it — the way back is the next wave they clear.
    document.getElementById('btn-retry')?.classList.add('hidden');
    menu.showDeath([
      ['Wave', world?.director?.wave ?? 1],
      ['Kills', world?.player?.kills ?? 0],
      ['Allies standing', (world?.players || []).filter((p) => p.alive).length],
    ], 'You have fallen — your allies fight on');
  };
  screens.overlay = { state: 'dead', show: card };
  cardAfter(1400, 'the downed card', card);
}

/** …and back up, because the party survived the wave. */
function rose() {
  cancelDeathCard();
  menu.hideDeath();
  screens.overlay = null;
  screens.state = 'playing';
  input.enabled = true;
  input.requestLock();
  hud.show(true);
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
   * list, which is the flat readout the livingForce exists to replace: seven
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
    ['Teaching', axis ? livingForceName(axis, settings.order) : '—'],
    ['Facets lit', shape.reduce((n, r) => n + r.lit, 0)],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

  // Only in co-op. Solo, a one-row table of yourself is noise.
  const roster = net.enabled && net.connected ? net.roster : [];
  // The name is peer-supplied (Net.js reads it off `conn.metadata`), so it is
  // escaped here the way HUD.popup and the boon chips already escape theirs.
  //
  // …and the connection, which the game measured every two seconds with a ping
  // and showed to nobody. `Net.latency` had no reader in the entire tree, so a
  // player whose friend was lagging had no way to know that was what they were
  // looking at. Shown on the local row, because it is our round trip.
  const ping = net.latency > 0 ? `<em style="margin-left:auto;color:#8b98ad">${Math.round(net.latency)} ms</em>` : '';
  scoreEl.roster.innerHTML = roster.map(r =>
    `<div class="p"><i></i><span>${escName(r.name)}</span>${r.host ? '<em style="margin-left:auto;color:#8b98ad">host</em>' : (r.id === net.peer?.id ? ping : '')}</div>`).join('');

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
  net.on('roster', (roster) => {
    menu.netRoster(roster);
    /* …AND OUR OWN SEAT AT IT. The host writes a side and, in a meeting, the
     * ground that side forms up on; both ride the roster because both are
     * identity for the length of a match. Nothing read either of them before
     * this line — every remote body in every session was on side 0 whatever the
     * host had decided. See World.applySeat. */
    world?.applySeat?.(roster.find((r) => r.id === net.peer?.id));
  });
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
    // Into the SESSION, not into the save file. See `session` at the top.
    if (hostSettings) {
      session = { level: hostSettings.level, difficulty: hostSettings.difficulty, mode: hostSettings.mode };
    }
    menu.netStatus('connected — waiting for the host to deploy', 'ok');
  });
  /**
   * THE HOST HAS DEPLOYED — AND WE GO, WHEREVER WE HAPPEN TO BE STANDING.
   *
   * This used to act only `if (screens.state === 'menu')`. In a co-op Descent
   * the host clears rung 1 and re-deploys into the Foundry, broadcasting a
   * fresh `start` — and every client that was playing, paused, drafting or dead
   * ignored it and stayed in the Intake, receiving snapshots of bodies at
   * Foundry coordinates. Enemies spawned inside walls or in mid-air and the run
   * was unrecoverable. A client's own Run can never ascend either (the rung
   * signal is host-only, by design), so this message is the ONLY thing that can
   * take a joining player down the ladder.
   *
   * …AND ONLY THE `screens.state === 'menu'` GATE CAME OFF. The level did not.
   *
   * `deploy()` fell through to its default argument, `startRun()`, which builds
   * a BRAND NEW gauntlet Run at tier 0 — and `deploy`'s own next line is
   * `const levelKey = run && !run.done ? run.rung.level : sessionOr('level')`,
   * so that fresh run's rung won over `msg.level`, which the line above has
   * just put into `session`. Evaluated against the real Run and DESCENT
   * (`0:intake 1:foundry 2:deeps 3:deeps`): the host sends intake and the
   * client builds intake; the host sends foundry, then deeps, then deeps, and
   * the client builds intake, intake, intake. THREE OF FOUR RUNGS, and every
   * one of them puts the joining player in a different building from everyone
   * else while snapshots keep arriving at the host's coordinates — measured on
   * two real Worlds, a host on the foundry and a client on the intake: all 8
   * bodies arrive, 5 buried and 3 floating against the client's own terrain,
   * and the foundry's 58 dps melt hazard does not exist over there at all. The
   * atmosphere follows the client's tier too (`SPIRE[run.tier]`), so the bottom
   * of the ladder is lit like the top of it.
   *
   * `deploy(null)` and not `deploy()`, and the difference is the whole fix: a
   * default parameter fires on `undefined` only, so passing an explicit null
   * makes `levelKey` fall through to `sessionOr('level')` — which is `msg.level`
   * one line up. Nothing else can carry it; there is no level key on the wire
   * anywhere else, and `packSnapshot` writes the host's absolute coordinates
   * into whatever terrain the client happens to have.
   *
   * A client has no ladder of its own to keep, so it loses nothing by not
   * holding a Run: the score it shows comes off the snapshot's `sc`, and
   * `run.wave`/`kills`/`hpFrac` are written only in `onWaveClear`'s host half.
   * What a client's Run did hold is its drafted boons, and those did not
   * survive a landing before this either — the Run was rebuilt from scratch on
   * every one. Carrying a joining player's build down the ladder is a separate
   * piece of work and wants a run that accumulates without ever ascending.
   *
   * Only in the gauntlet, note: in every other mode `startRun()` already
   * returns null and the client already loaded the host's level correctly.
   */
  net.on('start', (msg) => {
    session = { level: msg.level, difficulty: msg.difficulty, mode: msg.mode };
    if (net.isHost) return;                       // our own broadcast, coming back
    if (world) {
      // A world already stands, in some level that is no longer the session's.
      // Tear it down without leaving the session — quitToMenu would close the
      // connection — and land in the new one.
      cancelDeathCard();
      menu.hideDeath();
      screens.clear();
      world.dispose(); world = null;
    }
    deploy();
  });
  net.on('snapshot', (msg) => world?.applySnapshot(msg));
  net.on('claim', (peerId, msg) => world?.applyClaim(peerId, msg));
  /**
   * COMMAND, WHICH HAD NO WIRE AT ALL.
   *
   * Nothing about the army crossed: not a name, not a rank, not the area, not
   * the formation, not who had fallen. A joining player's roster panel was fed
   * by a director that had mustered ten strangers of its own and deployed none
   * of them. `army` is the host's `readout()` verbatim; `order` is the one
   * message that travels the other way, because the six formation keys are
   * bound on whichever machine pressed them and the bodies are on the host.
   * Both are routed here for the reason every other message is — the world a
   * packet applies to is the one standing when it arrives, not the one that was
   * standing when the connection opened.
   */
  net.on('army', (msg) => world?.applyArmy(msg));
  net.on('order', (peerId, msg) => world?.applyOrder(peerId, msg));
  /* The meeting's own state — rounds, clock, who took the field. Host → peers
   * only; `Net` refuses it on the host for the reason its own note gives. */
  net.on('match', (rec) => world?.applyMatch(rec));
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
  /**
   * A PACKET FROM A PARTICULAR PERSON.
   *
   * `peerId` is `msg.from ?? conn.peer` now (see Net._sender), and that is the
   * whole of the three-and-four-player bug: on a client every packet in the
   * session arrives on the one host connection, so the key used to be a
   * constant. Every remote player collapsed into ONE body fed by all of their
   * position streams — measured 840 m of travel and a 1200 m/s peak with two
   * players standing still — wearing whoever the roster's first entry was.
   *
   * The appearance comes off the ROSTER, where it crossed the wire with the
   * player who built it, instead of being invented here from a roster index.
   */
  net.on('avatar', (peerId, msg) => {
    if (!world) return;
    if (!world.remotes) world.remotes = new Map();
    let r = world.remotes.get(peerId);
    if (!r) {
      const entry = net.roster.find(x => x.id === peerId);
      /* THE SIDE, WHICH THE ROSTER HAS CARRIED ALL ALONG AND NOTHING READ.
       * `Net._refreshRoster` writes `team` on every entry through `_sideOf`,
       * `RemoteAvatar`'s constructor takes `opts.team` and its own note calls
       * that field "the one a duel is made of" — and this, the only place in
       * the tree that builds one, did not pass it. Every remote body in every
       * session was on side 0 whatever the host had assigned. */
      r = new RemoteAvatar(world, { id: peerId, name: entry?.name || 'Jedi',
        look: entry?.look || null, team: entry?.team });
      world.remotes.set(peerId, r);
      world.players.push(r);
      /* A new body on the field is a new commander to be given an army, if this
       * is a meeting. Idempotent — see World.beginVersus. */
      if (world.command?.versus && world.netMode === 'host') world.beginVersus();
    }
    r.push(msg, performance.now() / 1000);
  });
}
wireNet();

/** The character sheet this player carries into a session. See Net.LOOK_KEYS. */
const localLook = () => packLook(settings);

async function hostSession() {
  menu.netStatus('opening a session…');
  try {
    const code = await net.host(playerName(), {
      level: settings.level, difficulty: settings.difficulty, mode: settings.mode,
    }, localLook());
    menu.netCode(code);
    menu.netStatus('session open — share the code, then Ignite', 'ok');
    menu.netSession('host');
  } catch (e) {
    menu.netStatus(`could not open a session: ${e.message || e}`, 'err');
  }
}

/**
 * LEAVE. Idempotent, and safe to call when there is no session.
 *
 * `Net.close` existed, was complete, and had zero callers anywhere in the
 * repository — there was no way out of a co-op game at all.
 */
function leaveSession() {
  if (!net.enabled && !net.connected) return false;
  net.close();
  session = null;
  menu.netStatus('you have left the session', '');
  menu.netCode('—');
  menu.netSession(null);
  return true;
}

async function joinSession(code) {
  menu.netStatus(`connecting to ${code}…`);
  try {
    await net.join(code, playerName(), localLook());
    menu.netCode(code);
    menu.netStatus('connected — the host starts the run', 'ok');
    // A client does not own the wave, so the pause card stops offering to
    // restart it — see Menu.netSession.
    menu.netSession('client');
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
 * GIVING AN ORDER — player note #30, read once a frame beside the lessons.
 *
 * "you can order your troops into different formations, circle around you,
 * behind you, in front idk you know better than me."
 *
 * `FORMATIONS` carries the key each order wants, so this loop is derived from
 * the same table the director steers off and there is no second list of six
 * keys anywhere. That is deliberate and it is the difference between this and
 * the raw `e.code === 'KeyN'` listener the note above records: one table, one
 * reader, and a formation added tomorrow is bound the day it is authored.
 *
 * READ THROUGH THE TABLE NOW, AND THAT WAS THE WHOLE OF THE GAP. This loop used
 * to be `input.hit(F.key)` — raw `KeyboardEvent.code`s, straight off the
 * formation record, past `ACTIONS` entirely. Six of the game's controls were
 * therefore not rebindable, on no controls card, in no Codex row, and INVISIBLE
 * TO `findConflicts`: Digit6-Digit0 and Minus all reported as free, so the
 * options screen would hand one of them to something else and produce a
 * collision it could not warn about and no rebind could separate. That is the
 * KeyB/KeyN disease — see the notes on `stasis` and `rend` in Bindings.js — in
 * the one mode where a mis-press is an order to your own army.
 *
 * The fix is a SEAM and not six new literal rows beside `FORMATIONS`, because a
 * hand-written table next to the generated one it copies is this repository's
 * signature defect (HANDOFF §2.3). `Menu.js` pushes `FORMATIONS` through
 * `registerOrders` at module scope; `ORDER_ACTIONS` is what comes back, in
 * declaration order, and this reads it. Every key name, label and blurb still
 * has exactly one author: Command.js.
 *
 * Guarded on `world.command` so the keys are inert in every other mode, rather
 * than being six more things that can happen while you are duelling.
 */
/**
 * THE MUSTER SCREEN DID NOT COME UP, AND THE ADVANCE CARRIES ON ANYWAY.
 *
 * `Screens.muster` answers false when the card could not be raised — no markup,
 * a stripped DOM, a Menu built against a page that does not have it. Installing
 * `onMuster` at all takes the director OFF its own fallback, so without this
 * that failure would be a campaign stopped forever on an area boundary with
 * nothing on screen and no button to press. This is Command.js's own fallback,
 * called by name from the one place that took it away: spend sensibly, deploy,
 * press on. It is a floor, not a feature — the screen exists and this should
 * never run — and it is exactly what the mode did for its whole life before it.
 */
function fallbackMuster(d) {
  console.warn('the muster screen could not be raised — mustering automatically');
  d.autoMuster();
  d.closeMuster();
  hud.setRoster?.(d.roster.summary());
}

function orderKeys() {
  if (screens.state !== 'playing') return;
  const cmd = world?.command;
  if (!cmd) return;
  for (const o of ORDER_ACTIONS) {
    if (!input.actHit(o.action)) continue;
    if (!cmd.order(o.id)) continue;
    hud.message(o.name.toUpperCase(), o.blurb);
    break;                       // one order a frame; two at once is neither
  }
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

  /* Held, and only while a run is live: the menus, the draft and the death card
   * own the screen otherwise, and this would sit on top of all three.
   *
   * …AND NOT OVER A PHOTO. The free camera hides the HUD with `hud.show(false)`,
   * but `#scoreboard` is a top-level `.screen` at z-index 38 and is deliberately
   * not part of #hud — the same reason `#freecam-bar` is not — so it was outside
   * everything the free camera turns off. `screens.state` stays 'playing' the
   * whole time it is up, so holding the scoreboard key in photo mode dropped a
   * full-screen 72%-opaque panel over the shot the mode exists to take. */
  setScoreboard(screens.state === 'playing' && !!world && !world.freeCamera
    && input.act('scoreboard'));
  lessonKeys();
  orderKeys();
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
