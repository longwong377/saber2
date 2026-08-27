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
import { HUD, ordinal } from './ui/HUD.js';
import { Menu, loadSettings, saveSettings, applyFeelSettings, VICTORY_TITLE,
  LINE_LOST_TITLE } from './ui/Menu.js';
import { Net, RemoteAvatar, packLook, sessionPart } from './net/Net.js';
import { boonById, drawBoons, BOSS_EVERY, MODES } from './game/Waves.js';
import { theatreFor, LEVELS } from './game/Levels.js';
/* THE SHAPE OF ONE SITTING — FLAGSHIP §5. A leaf that imports nothing of the
 * game's, so the deploy card can be assembled here without this file reaching
 * into the director for anything but the record it already publishes. */
import { deployCard, runReport } from './game/Session.js';
// No `FORMATIONS` import any more: the orders reach this file as ordinary
// bindings through `ORDER_ACTIONS` below, which is the point of the seam.
import { recordRun, loadProgress } from './game/Progress.js';
/* THE COMPANY. Loaded here and folded here, for the same split `Progress.js`
 * keeps: this file owns localStorage and the game owns the game. `World` is
 * handed a plain list of records on its settings blob and hands back a
 * manifest; neither it nor Command.js knows a store exists. */
import * as Company from './game/Company.js';
import { armyToLead, commandConfig, OPENING_STRENGTH } from './game/Command.js';
import { keyLabel, ORDER_ACTIONS, codesFor } from './engine/Bindings.js';
import { guardZoneOf } from './game/Bolts.js';
import { clamp } from './engine/MathUtil.js';
import { Screens } from './ui/Screens.js';
import { SkillTree } from './ui/SkillTree.js';
import { Communion, shapeOf, currentName, dominantAxis, FACETS, LOCKED } from './game/LivingForce.js';

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
 * THE DEVICE, in one place, for every prompt this file paints.
 *
 * Three surfaces here print a live binding — the communion prompt, the
 * scoreboard's caption and the coach panel's three lesson keys — and all three
 * had `keyLabel((input.bindings.x || [])[0])` written out. A player on a
 * controller was told to press Ctrl to kneel. One helper, so the answer cannot
 * be right on two screens and wrong on the third; `padOf()` is the same
 * descriptor the Menu and the HUD are handed.
 */
const padOf = () => ({ device: input.device, family: input.padFamily });
const liveKey = (id) => keyLabel(codesFor(input.bindings, id, input.device)[0], input.padFamily);

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

/**
 * THE MEN THIS RUN IS FIELDING FROM A PREVIOUS ONE, or null.
 *
 * Resolved here rather than in `World` because it is a question about the
 * SAVE FILE — which army's roll, and how many of it — and `World.js` has never
 * been a localStorage module. `Company.fieldable` sorts by rank, then service,
 * then kills, so a roll that outgrew the deployment fields its veterans rather
 * than whoever was enlisted first.
 *
 * NULL IN A SESSION, AND THAT IS NOT A LIMITATION BEING APOLOGISED FOR. In
 * co-op the HOST's army is the one on the field — `command/net: the joining
 * player fights the host's army, not one it invented` is a check about exactly
 * that — so a client that folded its own veterans in would be adding names the
 * host has never heard of to a roster the host is authoritative for. A meeting
 * is the same argument from the other side: `beginVersus` deals an army per
 * commander out of `assignArmies`, and whose company that is, is a question
 * nobody has asked yet.
 *
 * The size is the same number the muster would have spent: a campaign's
 * `OPENING_STRENGTH` or the contingent the slider asked for. Handing over more
 * than that would put men on the roll the deployment cannot field, and
 * `_musterVeterans` would drop them silently.
 */
function veteransToField(levelKey = null) {
  if (session) return null;
  const mode = settings.mode;
  const campaign = !!MODES[mode]?.picksCampaign;
  const cfg = commandConfig(settings);
  const contingent = campaign ? 0 : cfg.contingent;
  if (!campaign && !(contingent > 0)) return null;
  /* THE SAME THREE-CLAUSE RESOLUTION THE DIRECTOR MAKES, called and not
   * restated: the choice only for a contingent (a campaign passes null, which
   * is what keeps `sideForOrder`'s veto intact), and the ground always,
   * because it only ever decides for a commander whose order leads neither
   * army. Getting a different answer here to the one the muster makes would
   * hand a Republic roll to a Separatist roster, and `_musterVeterans` would
   * drop every man of it in silence. */
  const army = armyToLead(settings.order, {
    choice: campaign ? null : cfg.allyArmy,
    ground: LEVELS[levelKey]?.armies,
  })?.id;
  if (!army) return null;
  const want = campaign ? OPENING_STRENGTH : contingent;
  const men = Company.fieldable(Company.load(army), want);
  return men.length ? men : null;
}

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
  onBindings: (b) => { input.setBindings(b); refreshCoachKeys(); hud.setBindings(b, padOf()); },
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
  /* THE HOOK THE NAME FIELD HAS ALWAYS RAISED INTO NOTHING. `Menu` has called
   * `hooks.onName` on every keystroke since the field was added and this
   * literal had no such key, so `net.name` kept whatever `host()`/`join()` read
   * at the moment the session opened. See `Net.setName`. */
  onName: () => net.setName(playerName()),
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

/**
 * THE RUN'S NUMBER, MINTED WHERE BOTH READERS CAN SEE IT — and it had one
 * reader too many for the place it used to live.
 *
 * `deploy()` reads the seed to resolve the GROUND (`theatreFor`, for a mode
 * whose theatre is a roll) and `buildWorld` reads it to seed the streams, and
 * the mint sat inside `buildWorld`. So `deploy` read `world.runSeed` off a
 * `world` that its very next line was about to build: on the first press after
 * boot `world` is null, and the whole deploy died in a TypeError caught by its
 * own guard, which put the menu back with a notice. Measured with
 * `tools/_deployprobe.mjs` — "deploy failed TypeError: Cannot read properties
 * of null (reading 'runSeed')", every time, from a cold page.
 *
 * One function, called once per deploy, and the number is then HANDED to the
 * build rather than fetched back out of it. Two mint sites would be worse than
 * the crash — the ground would be resolved on one roll and the waves seeded on
 * another, and nothing would ever say so.
 */
function mintRunSeed() {
  const asked = session && session.seed !== undefined ? session.seed : settings.seed;
  return Number.isFinite(Number(asked)) && asked !== null && asked !== ''
    ? (Number(asked) | 0) >>> 0
    : (Math.random() * 0xffffffff) >>> 0;
}

async function buildWorld(levelKey, onProgress = null, runSeed = null) {
  if (world) { world.dispose(); world = null; }
  /**
   * PHYSICS BEFORE ANYTHING, AND IT IS AWAITED HERE RATHER THAN ASSUMED.
   *
   * `boot()` warms Rapier with the textures — see the `settling the world`
   * step — so by the time a player can press Deploy it is normally long ready,
   * and this call is then a resolved promise and free (`initPhysics` hands
   * every caller the same one).
   *
   * It is here because `RapierWorld`'s constructor THROWS on a null module and
   * the throw lands in `deploy()`'s catch, which puts the player back on the
   * menu with a notice and no game. Measured in a browser driving the shipped
   * page: a Deploy that reached this line before the warm-up had finished died
   * with "Rapier is not initialised — await initPhysics() first", and the
   * button did nothing for the rest of the session. One await removes the whole
   * class — the retry path, a slow first load, and any future caller that
   * builds a world without going through boot at all.
   */
  await initPhysics();
  audio.init();
  audio.resume();

  // The player's settings, with whatever the host of this session decided
  // laid over them — and never the other way round. See `session` above.
  world = new World(engine, worldSettings(), { veterans: veteransToField(levelKey) });
  /**
   * THE RUN'S NUMBER, BEFORE ANYTHING READS IT.
   *
   * `WaveDirector` picks this up in its constructor — which `loadLevel` runs a
   * few stages below — and puts the wave stream, the enemy stream, the duel
   * stream and the arrivals on it. Assigned here rather than inside World
   * because a seed is a fact about a SESSION, and this is the one place that
   * knows whether the session is the player's own or a host's.
   *
   * It used to be `world.run.seed`, and `Run.js` went with the Descent: for
   * every mode in the shipped game `WaveDirector.seed` was null, `seedWaves`
   * was called by nothing, and the whole "a run is a shareable number rather
   * than an unrepeatable accident" apparatus — the record's `seed` column, the
   * `· seed N` line in the menu — was unreachable. It is a number a player can
   * read off the record and type back in now, which is what makes a rule set
   * worth telling somebody about: beat THIS seed under NO GUNS.
   *
   * A stated seed is honoured; otherwise one is drawn, so two runs still differ
   * by default. In a session the host's number wins, exactly as the level and
   * the difficulty do — a co-op run has to be ONE run.
   */
  // Two statements rather than one `sessionOr`, for the reason the difficulty
  // line below gives: `settings.seed` is the named reader Menu.SETTING_READERS
  // points at, and a setting whose only reader is behind an indirection is a
  // setting the "every control reaches the game" check can no longer see.
  world.runSeed = runSeed ?? mintRunSeed();
  // The player's own difficulty — and then the host's over the top of it, if
  // this is their session. Two statements rather than one `sessionOr`, because
  // `settings.difficulty` is the named reader Menu.SETTING_READERS points at
  // and a setting whose only reader is behind an indirection is a setting the
  // "every control reaches the game" check can no longer see.
  world.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.knight;
  if (session?.difficulty) world.difficulty = DIFFICULTY[session.difficulty] || world.difficulty;

  world.onNotify = (t, s, kind) => hud.message(t, s, undefined, kind);
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
   */
  world.onEnemyVoice = (enemy, kind) =>
    hud.announcer?.enemyLine(enemy, kind, settings.enemyVoices !== false);
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
  /**
   * THE MOMENT A WAVE PAYS, AND WHAT THE NUMBER IS SHORT OF.
   *
   * The toast fired at the right instant and said "12 held", which is a
   * quantity and not a distance — and `living-force.mjs`'s own note recorded
   * that the system rewards saving and "nothing in the game tells the player
   * that". A held number only means something against a price.
   *
   * The cheapest REACHABLE facet is asked of the same ledger the Holocron
   * prices its lattice on, over the same set — the ones the purse ALONE stands
   * between the player and, which is `reasonLocked` returning either nothing
   * or `LOCKED.insight`. So the toast and the lattice cannot disagree about
   * what a wave was worth, because neither of them is deciding it.
   */
  world.onInsight = (n, ledger) => {
    communePrompt.insight = Math.floor(ledger.insight);
    setTimeout(() => {
      if (screens.state !== 'playing' || !world) return;
      const held = Math.floor(ledger.insight);
      const wave = world.director?.wave ?? 1;
      let cheapest = Infinity;
      for (const f of FACETS) {
        const why = ledger.reasonLocked(f.id, world.takenBoons, wave);
        if (why === null || why === LOCKED.insight) {
          cheapest = Math.min(cheapest, ledger.costOf(f.id, world.takenBoons));
        }
      }
      hud.message(`INSIGHT +${n}`,
        !isFinite(cheapest) ? `${held} held — kneel to open the Holocron`
          : held >= cheapest ? `${held} held — enough to wake a facet. Kneel.`
            : `${held} held · ${cheapest - held} more wakes a facet`);
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

  /**
   * THE GROUND CHANGES UNDER A RUN — Skirmish rotates between engagements and
   * Campaign between missions. World asks; this answers with the ASYNC door, so
   * the rebuild gets the same progress bar a deploy gets rather than freezing
   * the tab for a second, and the truthy return is the contract that tells
   * World not to take the synchronous one.
   */
  world.onRotate = (key) => world.rotateToAsync(key, (f, l) => screens.loading?.(f, l))
    .catch((e) => { console.error('rotate failed', e); });
  /* …AND WE HAVE ARRIVED. The handful of per-player things this file owns, put
   * back exactly as they are after the first `spawnPlayer` above — a landing is
   * a transition and not a restart, so everything that survives the rotation is
   * World's business and everything re-applied here is this file's. */
  world.onGround = (levelKey, level, player) => {
    player.camera.fovTarget = settings.fov;
    player.camera.fov = settings.fov;
    applyFeelSettings(world, settings);
    hud.setLevel(level.name, world.difficulty.name);
    hud.setBoons(heldBoons());
    screens.clear();
  };

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
        /* A COMMENDATION — PLAN §4.4's "promote a survivor", through the same
         * door and asking for the offer again rather than editing a copy of it.
         * `commend` pays experience into `Trooper.award`, so a promotion still
         * arrives the one way every other promotion in the game does. */
        commend: (name) => {
          d.commend(name);
          return { offer: d.musterOffer(), refused: d.refused };
        },
        /* THE ROAD — PLAN.md §4.6's branching route, through the identical
         * door and for the identical reason. `takeRoute` re-plans the tail so
         * the run stays the length the deploy card promised, and the screen
         * asks for the offer again rather than editing its own copy of it: the
         * ground you are walking into, what it pays and how heavy it is all
         * move together, and a card that patched one of them would print a
         * garrison band beside the wrong brief. */
        route: (id) => {
          d.takeRoute(id);
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
  /* THE SESSION'S MODE, NOT OURS. `worldSettings()` builds the World from the
   * host's mode, and this line read the player's own SAVED one — so a client
   * whose last solo game was Command deployed onto Geonosis whatever the host
   * sent, because `MODES.command.level` won the `??` before `sessionOr` was
   * ever consulted. Measured against the shipped expression: saved mode
   * `command` against a host on skirmish/drifts, roguelite/scoria and
   * campaign/wood all built geonosis. It is the one line between the `start`
   * handler and `loadLevel` that could still prefer its own idea of the ground
   * to the one on the wire, which is what the note over that handler promises
   * nothing does. */
  /* …AND A MODE THAT TAKES SOME OF THE ROSTER RATHER THAN ALL OR NONE OF IT.
   * `MODES[mode]?.level ?? sessionOr('level')` answered the mode that owns ONE
   * ground and nothing else, so a campaign deployed onto whatever the player
   * last picked and then rotated off it: measured, seven of the nine theatre
   * cards built a whole World, ran `beginCampaign`, fell through `campaignAt`
   * and moved the player to the Colosseum on the next frame. `theatreFor` is
   * the clamp for all three cases and it is the same list `_syncTheatre` bars
   * the column with, so the ground the card shows is the ground that loads. */
  /* THE RUN'S NUMBER IS THE THIRD ARGUMENT, and it has to be: a mode whose
   * ground is a seed roll cannot be resolved without the seed. `world.runSeed`
   * is minted above this line and before the level loads, which is the whole
   * reason it lives there — see its own note. */
  /* MINTED HERE, USED TWICE, BUILT ONCE. See `mintRunSeed`: this line used to
   * read `world.runSeed`, and `world` is not built until six lines below. */
  const runSeed = mintRunSeed();
  const levelKey = theatreFor(sessionOr('mode'), sessionOr('level'), runSeed);
  try {
    /* AWAITED, so the build yields between its stages instead of freezing the
     * tab. The progress callback is the same shape the boot sequence's bar
     * already takes; `screens.loading` renders it if it exists, and a build
     * that finishes before the first paint simply never shows one. */
    await buildWorld(levelKey, (frac, label) => screens.loading?.(frac, label), runSeed);
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
    if (net.isHost) net.broadcast({ t: 'start', ...sessionPart(settings), level: world.levelKey });
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
    /* A BATTLE IS STARTED WITH A PLAN, which is why `skirmishConfig` takes
     * picks rather than reading the settings blob itself — see its note. This
     * is the one place a preference becomes a plan. */
    else if (settings.mode === 'skirmish') {
      world.beginSkirmish({
        engagements: settings.skirmishEngagements,
        /* THE FIFTH PICK, and it was the missing one. `skirmishConfig` has
         * clamped `waves` since an engagement stopped being one cleared wave;
         * nothing passed it, so every skirmish ever fought took
         * `SKIRMISH.waves.def` and the mode's length was one slider instead of
         * two. See `DEFAULT_SETTINGS.skirmishWaves`. */
        waves: settings.skirmishWaves,
        strength: settings.skirmishStrength,
        pressure: settings.skirmishPressure,
        rotate: settings.skirmishRotate,
      });
    /* The theatre the player picked IS the campaign — see `Levels.campaignAt`,
     * which is the whole derivation and the reason neither campaign needs a
     * setting of its own. Off the declared field rather than the mode's name,
     * for the reason `battles` above is: the branch belongs to the property,
     * not to the one mode that has it today. */
    } else if (MODES[settings.mode]?.picksCampaign) world.beginCampaign();
    /**
     * …AND THIS ONE LINE IS ALSO WHAT STARTS THE NEAR HALF OF A MASS BATTLE.
     *
     * `MODES.thefront` is two fights at once — the wave director's real bodies
     * inside `Mass.PROMOTE` and hundreds of instanced men outside it — and this
     * is the line that starts the first of them. It needs no branch of its own:
     * the mode is an ordinary wave mode with a war behind it.
     *
     * THE MASS ITSELF IS NOT ARMED HERE. It was for one build, and that made
     * the battle a property of THIS deploy path rather than of the mode — a
     * world booted any other way, a check or a co-op client, had no front at
     * all. `World.loadLevel` arms it now off `MODES[mode].massBattle`, beside
     * `objectives` and `fireMissions`, which is where a branch gated on a
     * declared field belongs.
     */
    else world.director.start(1);
  }
  /**
   * AND YOU ARRIVE, RATHER THAN APPEAR.
   *
   * The player, twice: "you should never just appear, ON ANY MAP, you must
   * always arrive and leave via transport regardless of if you're with troops
   * or not… Every mode/map should start like this."
   *
   * This is the LAST line of the deploy path on purpose. Everything above it
   * has to have happened first — the world built, the commander spawned, the
   * army deployed by `beginSkirmish`/`beginCampaign`/`start(1)` — because
   * `beginInsertion` lifts whatever is standing on the ground into the bay, and
   * a line that has not been mustered yet is a line that walks on afterwards.
   *
   * It DECLINES rather than throws when it cannot fly: no player, no terrain, a
   * client, or `instantSpawn`. Every one of those falls through to the world
   * exactly as it was — a commander standing on a spawn point, which is what
   * every mode in this game did until now.
   */
  /**
   * 0:00 — THE DEPLOY CARD, and then 0:12, which is the gunship.
   *
   * FLAGSHIP §5 opens the session with "the seed, the ground, and your ten
   * names, readable before you land", and the mode had none of it: a Command
   * run began with a notify that faded in two seconds, over a roster panel in
   * the corner nobody had been told to read. The names are the mode's second
   * one-way variable and this is the only moment in a run when all ten of them
   * are still on it.
   *
   * IT IS RAISED FOR THE CROSSING AND NOTHING ELSE. `director.crossing` is the
   * field that means "this run is a session" — true for Command, false for a
   * skirmish, a campaign and a contingent, all of which are a bounded battle
   * with an army in it rather than a sitting with a length. A card in front of
   * every Trial of Waves would be a loading screen with prose on it.
   *
   * THE FLIGHT IS THE CALLBACK. `beginInsertion` is the last line of the deploy
   * path for the reason its own note gives — everything above it has to have
   * happened first — and the card goes in FRONT of it, not instead of it: the
   * world is stopped behind an overlay, the player reads their ten names, and
   * pressing Drop is what puts them in the air. A card that flew first would be
   * a card the player reads while the LAAT is already on approach.
   *
   * `screens.deploy` returns false when the markup is missing, which is the
   * same fallback the muster takes: drop without one rather than leave a
   * session stopped on a state with nothing on screen.
   */
  const insert = () => {
    const flew = world.extraction?.beginInsertion?.({ name: world.level.name });
    if (!flew) world.notify('MAY THE FORCE BE WITH YOU', world.level.name);
  };
  const cmd = world.command;
  if (cmd?.crossing && !world.training) {
    const card = deployCard({
      seed: world.runSeed,
      plan: cmd.plan,
      stages: cmd.stages,
      ground: world.level.name,
      roster: cmd.roster.summary(),
      networked: net.enabled && net.connected,
    });
    const up = screens.deploy(card, {
      drop: () => {
        screens.overlay = null;
        /* 'paused' so `resume()` takes the playing branch — the same ordering
         * the muster's Done uses, and the same reason: everything risky has
         * already run by the time the state moves. */
        screens.state = 'paused';
        resume();
        insert();
      },
    });
    if (!up) insert();
  } else insert();
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
  /* PLAN §4.9's report, off the director's own log and nothing else. Null
   * everywhere there is no army: `runReport` would happily project an empty
   * run, and a card offering "After-action report" in Survival would open onto
   * a screen with nothing on it. */
  report: () => (world?.command?.log ? runReport(world.command.log) : null),
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
 * The Holocron is opened by KNEELING, and that is the whole design of the
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
  onBuy: (id) => wakeFacet(id),
  onClose: () => closeMeditation(),
});
// Screens now knows how to take this card down, which is what makes a pause
// raised over a meditation (or a callback that threw inside one) recoverable
// instead of leaving the Holocron sitting on top of the pause menu.
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
    if (communePrompt.key) communePrompt.key.textContent = liveKey('crouch');
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
 * menu — and it exists at all because a Holocron you can only see mid-fight is
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

/** What the Holocron is being read with: the run's own alignment. */
function communeContext(live) {
  const taken = world ? world.takenBoons : new Set();
  const ledger = world ? world.communion : new Communion();
  // Between runs the chart is drawn over the RECORD: the facets this player
  // has ever held, in a fainter colour. It buys nothing and carries nothing
  // into the next run (see Progress.js) — it is the answer to "what have I
  // actually tried", which the Holocron is for when you cannot spend.
  const history = live ? null : Object.entries(loadProgress().woken || {});
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
  // Between runs there is no world to stop and no Insight to spend. It is a
  // chart you read and a plan you make — see the doctrine note in
  // LivingForce.js about why it is deliberately not a shop.
  tree.show(communeContext(false));
}

function closeMeditation() {
  if (!world) { tree.hide(); return; }
  // The overlay is forgotten FIRST, or resume() would put the Holocron straight
  // back on the screen. Same idiom as answering a draft.
  tree.hide();
  screens.overlay = null;
  screens.state = 'paused';
  resume();
}

/**
 * Spend Insight on a facet.
 *
 * The purchase itself is `Communion.buy`, which decides and charges; the EFFECT
 * goes through `World.applyBoon`, which is the only path that records the rank
 * on the taken-set, tells the Run, applies it to every local player and
 * re-derives what depends on it. A facet that applied its own boon would be a
 * second, divergent way of taking a card — and the first thing it would break
 * is a landing, which replays the Run's list into a freshly built player.
 */
const wakeFacet = (id) => screens.guarded('waking a facet', (facetId) => {
  if (!world) return;
  const boon = world.communion.buy(facetId, world.takenBoons, world.director?.wave ?? 1);
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
 * sandboxConfig every frame in any theatre. In the dojo it is the LAST lesson
 * of ten — `DojoDirector.inSandbox`, the one whose setup block says `sandbox` —
 * and the other nine build their own room out of the lesson and never look.
 *
 * That arm was unreachable by playing until the free-practice rung above it was
 * deleted: its `check` returned false forever, so `_advance` could never leave
 * it and nothing but the Skip button ever set `inSandbox`. See the note on the
 * sandbox lesson in Dojo.js.
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
  // And walking out is not a withdrawal — see `bank`. The men are gone.
  bank();
  if (world) { world.dispose(); world = null; }
  menu.showMenu();
  screens.set('menu');
}

/**
 * THE HISTORY LINE UNDER THE TITLE IS GONE, AND ONLY THE DISPLAY IS GONE.
 *
 * `showRecord()` used to write `progressLines().join('  ·  ')` into
 * `#menu-record` on load and again on every return to the menu: runs, kills,
 * deepest wave, best score, facets of the Holocron reached, boons carried to a
 * crown. It was removed on instruction — "under the name of the game in the
 * main menu you have a bunch of little white text describing a bunch of
 * bullshit like your progress … I want you to remove it completely."
 *
 * WHAT WAS CHECKED BEFORE CUTTING IT, because a line that is the only surface
 * for something real cannot just be deleted:
 *
 *   `recordRun` still runs on every path it ran on before — death, victory and
 *   walking out through `quitToMenu` — so nothing stops being counted or
 *   stored. `progressLines()` is still exported and is still held to its
 *   contents by tools/checks/progress.mjs, history.mjs, runrules.mjs and
 *   progression.mjs. Nothing in the game reads Progress to gate or unlock
 *   anything; it never did, which is what the record's own note meant by "a
 *   HISTORY, not a currency". So the only thing this deletion costs is the
 *   sight of it, which is precisely what was asked for.
 *
 * `#menu-record` itself stays and keeps one writer: `deploy()`'s catch, which
 * says "Could not deploy: …" there when a world fails to build, and which
 * tools/checks/session.mjs asserts is still said. `.record:empty{display:none}`
 * keeps the element out of the layout on every screen a player will ever see.
 */

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
 * `Progress.recordRun` adds `runs`, `kills`, `communed`, the woken facets and
 * the forty-entry `recent` history, but takes `Math.max` for `bestDepth`,
 * `bestScore`, `bestTier` and the by-order/species/mode maps. Hence a record
 * line reading "2 runs" beside "roguelite 1".
 */
/**
 * FOLD THE RUN INTO THE COMPANY — the other half of `record`, and the one that
 * costs something.
 *
 * `Progress.recordRun` writes a history. This writes a ROSTER, and the
 * difference is that a bad run subtracts from it. `world.manifest` is the men
 * who reached the ramp before it closed; everybody who went out and is not on
 * it is dead, permanently, and `Company.keep` is where that is enforced.
 *
 * ONCE PER WORLD, and off its own flag rather than `_recorded`. The two are
 * called from the same two places today — `gameOver` and `quitToMenu` — and
 * the day one of them stops being, a shared flag would silently stop the other
 * as well. `record`'s own note is an account of what one missing guard cost.
 *
 * A RUN WITH NO ARMY IN IT DOES NOTHING HERE. Waves without a contingent, the
 * duel, the dojo, the sandbox: `world.command` is null in all of them and
 * there is no roll to fold. Co-op and meetings are excluded on the same
 * grounds `veteransToField` refuses to load one — the host's army is the one
 * on the field, and whose company a meeting's second army is has not been
 * asked yet.
 *
 * AND QUITTING IS NOT A WITHDRAWAL. `quitToMenu` calls this with no stats, and
 * a player who walks out mid-run has not got anybody home: `ended` is absent,
 * the manifest is empty, and the whole roll is struck off exactly as a wipe
 * would strike it. That is the point of the mechanism the withdrawal exists
 * for — there is a door, it is held for a second and a half, and closing the
 * tab is not it.
 */
function bank(stats = null) {
  if (!world || world._banked) return;
  const d = world.command;
  if (!d || d.versus || session) return;
  world._banked = true;
  const roster = d.roster;
  if (!roster) return;
  const manifest = Array.isArray(world.manifest) ? world.manifest : [];
  Company.keep(manifest, {
    army: d.commander?.army?.id ?? roster.army?.id ?? roster.army,
    /* WHO WENT OUT. Without this `Company.keep` has no way to tell a man who
     * died on this run from a man who was never on it, and its own note says
     * it will not execute a roll it cannot prove was fielded. `all` and not
     * `living`: a name that fell in area two went out just as much as the one
     * who reached the ship. */
    deployed: roster.all,
    left: roster.all.filter((t) => !manifest.includes(t)),
    ground: world.levelKey ?? null,
    ended: stats?.ended ?? (world.over ? 'wiped' : 'quit'),
  });
}

function record(stats = null) {
  if (!world) return;
  if (world._recorded) return;
  world._recorded = true;
  recordRun({
    ...(stats || { wave: world.director?.wave ?? 0, score: world.score,
                   kills: world.players.reduce((a, p) => a + (p.kills || 0), 0) }),
    /**
     * THE VERDICT, AND A RUN NOBODY FINISHED HAS NONE.
     *
     * `quitToMenu` calls this with no stats at all, and `recordRun` stored
     * `!!summary.won` — so an ABANDONED run and a LOST one were the same byte.
     * Measured: quitting 25 s into mission 2 of a campaign, alive, with
     * `campaign {index:1, done:false, won:null}` and `world.over false`, wrote
     * `{depth:3, score:7460, won:false, mode:'campaign'}`. `recent[]` is the
     * one history a player reads and it was calling every walk-away a defeat.
     *
     * DERIVED, not passed: every ending in the game sets `world.over` —
     * `_checkWipe`, `_endSkirmish`, `_endMeeting` and `_endCampaign` all do —
     * so "did this run end" is a question the World already answers, and a
     * second flag threaded down from the quit button could disagree with it.
     * A summary that carries its own verdict keeps it; a run that is still
     * standing when the player walks out files `null`, which `recordRun` now
     * stores rather than flattening. §2.3's close relative, closed: a missing
     * thing answered with a plausible default.
     */
    won: stats?.won ?? (world.over ? false : null),
    mode: sessionOr('mode'),
    boons: [...(world.takenBoons || [])],
    /**
     * WHAT THE RUN WOKE IN THE HOLOCRON — and it was the third field
     * `recordRun` had always read and nothing had ever passed.
     *
     * `Progress.recordRun` does two things with `summary.woken`: it adds its
     * LENGTH to `p.communed` ("facets woken by communion, all-time"), which
     * `progressLines` prints as ", N woken in communion", and it stores the
     * same length on the run's own entry as `facets`. Neither could ever be
     * anything but zero: `World.runStats()` does not report it and this call
     * did not add it, so the clause never printed for any player who has ever
     * run this game, and every one of the forty entries in `recent[]` recorded
     * `facets: 0` on a run that may have bought six.
     *
     * `communion.bought` is the list — the ids woken with Insight, in order,
     * which is exactly "facets woken by communion" and is NOT `takenBoons`:
     * that set is fed by the order's grants and by the draft as well, and it is
     * already carried above as `boons`. The two answer different questions and
     * the record wants both. `seed` above is the same defect one field along,
     * fixed one commit earlier.
     */
    woken: [...(world.communion?.bought || [])],
    identity: { order: settings.order, species: settings.species },
    /**
     * …AND WHAT THE RUN WAS ACTUALLY FOUGHT UNDER.
     *
     * Both off the DIRECTOR rather than off `settings`, because the director is
     * what honoured them: `legalRuleSet` has already dropped anything the
     * theatre vetoed, so a record that read the settings would claim a run was
     * fought under THE HEAVY GUARD on a level that stations nothing enormous.
     *
     * `seed` has been carried by `Progress.recent[]` and printed by
     * `progressLines` since both were written and has been null on every run
     * ever recorded — the field it came from was deleted with the Descent. It
     * is the number above.
     */
    seed: world.runSeed ?? null,
    rules: world.director?.rules ? [...world.director.rules] : [],
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
  // …and the roll, which is the half of a finished run that can go DOWN.
  bank(stats);
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
  /**
   * THE CARD REPORTS WHAT THE RUN HANDED IT, AND NOTHING ELSE.
   *
   * Two of these six rows were FABRICATED: `stats.areas ?? 5` and
   * `stats.fallen ?? 0`, against four ending doors — `_endSkirmish`,
   * `_checkWipe`, `_endMeeting` and `CommandDirector._endCampaign` — not one of
   * which passed either field. So every won run ever played printed "Areas
   * taken 5", a literal, and meaningless in a skirmish or a campaign; and
   * "Troops lost 0" in the mode whose entire subject is named people dying for
   * good. `_endCampaign` logs `fallen: this.roster.fallen.length` into its own
   * log one line above the summary it did not put it on.
   *
   * Both now come off `World.runStats()` with the rest, and a row whose number
   * is ABSENT is left off the card rather than invented — §2.3's close
   * relative, "a missing thing answered with a plausible default", which is how
   * a literal 5 survived as a statistic. `taken` is one number with three
   * meanings and the mode is what names it; `tools/checks/skirmish.mjs` holds
   * every field read here to being a field `runStats` reports.
   */
  const TAKEN = { campaign: 'Missions taken', skirmish: 'Engagements won', command: 'Areas taken',
                  theline: 'Ground taken', duel: 'Forms faced' };
  const row = (label, v) => (v == null ? null : [label, v]);
  /**
   * A THIRD CARD, BECAUSE THE LINE HAS A THIRD ENDING.
   *
   * The two above are "you won" and "you died", and they were the only two
   * endings this game had. THE LINE has one neither describes: the run is over,
   * the army is gone, and **you are still standing there**. Telling a player
   * who is alive "You are one with the Force" over a row that reads "Wave
   * reached 4" is wrong twice — it reports a death that did not happen, and it
   * asks the endless modes' question of a mode that answers a different one.
   *
   * `stats.ended` is the discriminator and it is set by the two doors that know
   * — `CommandDirector._checkLine` and `_endCampaign` — rather than inferred
   * here from `won === false` plus a guess at whether the player is breathing.
   * The rows are the won card's rows: the ground you took and the men it cost
   * are the right questions whichever way the verdict went, and they are the
   * only rows on either card that are about the ARMY.
   */
  const lostLine = !won && stats.ended === 'line';
  const rows = (won || lostLine)
    ? [
      row(TAKEN[sessionOr('mode')] ?? 'Ground taken', stats.taken),
      ['Score', Math.floor(stats.score).toLocaleString()],
      ['Kills', stats.kills],
      row('Troops lost', stats.fallen),
      ['Deflections', stats.deflects],
      ['Limbs taken', stats.limbs],
    ].filter(Boolean)
    : [
      ['Wave reached', stats.wave],
      ['Score', Math.floor(stats.score).toLocaleString()],
      ['Kills', stats.kills],
      ['Deflections', stats.deflects],
      ['Perfect returns', stats.perfects],
      ['Limbs taken', stats.limbs],
    ];
  /* AND THE ROLL — PLAN §4.9. `stats.roll` is the run's fallen in the order they
   * fell, reported by `World.runStats()` beside the COUNT the card has always
   * printed; null in every mode with no army, and the card leaves the block off
   * rather than drawing a heading over nothing. Passed straight through, for
   * `runStats`' own stated reason: this decides what a card SAYS and that
   * decides what is true.
   *
   * NO `?? null` ON IT, and `skirmish.mjs` is right to forbid one: `?? 5` on an
   * absent field is what printed "Areas taken 5" on every won run ever played.
   * `runStats` reports `roll` on EVERY ending — null where there is no army —
   * which is exactly why it lives there and not in `extra`, so there is nothing
   * for a default to cover. */
  const card = () => menu.showDeath(rows,
    won ? VICTORY_TITLE : (lostLine ? LINE_LOST_TITLE : undefined), stats.roll, stats.report);
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
   * list, which is the flat readout the Holocron exists to replace: seven
   * chips tell you what you have and nothing about what you ARE. The two rows
   * added here are read straight off the same tree the meditation draws, so
   * they cannot describe a build the Holocron does not show.
   */
  const shape = shapeOf(world.takenBoons).filter((r) => r.woken > 0).sort((a, b) => b.ranks - a.ranks);
  const axis = dominantAxis(world.takenBoons);
  scoreEl.stats.innerHTML = [
    ['Wave', world.director?.wave ?? 1],
    ['Score', Math.floor(world.score + (p?.score || 0)).toLocaleString()],
    ['Kills', p?.kills ?? 0],
    ['Deflections', p?.deflects ?? 0],
    ['Perfect returns', p?.perfects ?? 0],
    ['Limbs taken', p?.limbsRemoved ?? 0],
    ['Insight', Math.floor(world.communion?.insight ?? 0)],
    ['Teaching', axis ? currentName(axis, settings.order) : '—'],
    ['Facets woken', shape.reduce((n, r) => n + r.woken, 0)],
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
  if (scoreEl.key) scoreEl.key.textContent = liveKey('scoreboard');
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
    /**
     * …AND OUT OF `commanders`, WHICH IS FLAGSHIP §9'S SECOND DEFECT.
     *
     * "`peer-left` removes the RemoteAvatar and nothing removes its
     * `Commander`, so its army goes on being steered off a disposed body."
     * Exactly that: the avatar is disposed two lines up and its Commander went
     * on sitting in the director's list, solving a formation in the frame of a
     * body nothing updates and measuring the follow speed of a corpse of a
     * drawing. `CommandDirector.census` carried a guard against the one
     * consequence anybody had noticed — a departed general's army could win the
     * match — which is the shape of the bug rather than a fix for it.
     *
     * `dismissCommander` is where what happens to their men is decided, and
     * with one roster the answer is mostly "nothing": their squads are re-dealt
     * to whoever is left on the same roll. See its note.
     */
    world.command?.dismissCommander?.(r);
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
    if (hostSettings) session = sessionPart(hostSettings);
    menu.netStatus('connected — waiting for the host to deploy', 'ok');
  });
  /**
   * THE HOST HAS DEPLOYED — AND WE GO, WHEREVER WE HAPPEN TO BE STANDING.
   *
   * This used to act only `if (screens.state === 'menu')`, so a client that was
   * playing, paused, drafting or dead when the host changed ground ignored the
   * message and stayed where it was, receiving snapshots of bodies at the new
   * level's coordinates. `packSnapshot` writes the host's ABSOLUTE positions
   * into whatever terrain the client happens to have, so the bodies all arrive
   * and land wrong: measured on two real Worlds a level apart, all 8 bodies
   * arrive, 5 buried in the client's hills and 3 hanging in its air, and the
   * level's own hazards exist on one machine only.
   *
   * THIS IS THE ONLY LEVEL KEY ON THE WIRE. There is no other message that can
   * move a joining player, which is why it is sent from `World._afterRotate` as
   * well as from `deploy` — a mission boundary and a skirmish's next ground are
   * both ground changes the client cannot work out for itself, since a client's
   * director never runs.
   *
   * A client keeps no run of its own and loses nothing by rebuilding: the score
   * it shows comes off the snapshot's `sc`, and the run fields are written only
   * in `onWaveClear`'s host half. Carrying a joining player's own build across
   * a ground change is a separate piece of work.
   *
   * (This note used to run four times as long, about `deploy()`'s default
   * argument beating `msg.level` with a fresh gauntlet Run's rung. `startRun`,
   * `run.rung.level` and DESCENT went with the Descent; `deploy` takes no
   * argument now and reads `MODES[settings.mode]?.level ?? sessionOr('level')`.
   * Left as one line rather than deleted because the fix it describes is still
   * load-bearing in shape: nothing between here and `loadLevel` may prefer its
   * own idea of the ground to the one on the wire.)
   */
  net.on('start', (msg) => {
    // THE GUARD COMES FIRST, and it did not. `session` was written before the
    // `isHost` return, so a packet the host should have ignored outright still
    // rewrote its level, difficulty, mode, pvp and commandVersus — and those
    // are what the NEXT `deploy()` reads, so a client's `start` chose the
    // host's next ground. Net now refuses a client's `start` on the host at
    // all; this stays because the order was wrong on its own terms — the line
    // that says "this is not ours" cannot run after the line that acts on it.
    if (net.isHost) return;                       // our own broadcast, coming back
    session = sessionPart(msg);
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
   * THE RULE MOVED INTO `World.applyHit`, AND THE MOVE IS THE POINT. This was
   * eight lines of policy — which boon answers a bolt, which door the blow goes
   * through, whose name is on it — living in a closure inside the entry point,
   * where no check in the repository could reach it. Every other message on
   * this wire is applied by a method on World and is driven by `coop.mjs`
   * against two real endpoints; this one was the exception, and it was the one
   * that spent the whole life of the protocol applying a shove as a bare number
   * from nobody. A handler in main.js should route and nothing else.
   */
  net.on('hit', (msg) => { world?.applyHit(msg); });
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
      /**
       * A NEW BODY ON THE FIELD IS A NEW COMMANDER TO BE GIVEN SOMETHING TO
       * LEAD, and there are two answers to what.
       *
       * A MEETING hands them an army of their own, 120 m away, facing you.
       * ANYTHING ELSE seats them on YOUR side, out of YOUR roster, holding one
       * of the squads that is already standing — FLAGSHIP §9's "four players
       * take four squads out of one roster of up to 24". Until this line a peer
       * joining a Command run got a blade and no army at all: nothing outside
       * `beginVersus` had ever called `enlistCommander`.
       *
       * Both are idempotent per player and both are the host's alone.
       */
      if (world.netMode === 'host') {
        if (world.command?.versus) world.beginVersus();
        else world.seatAlly?.(r);
      }
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
    const code = await net.host(playerName(), sessionPart(settings), localLook());
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
 * PICKING UP A CONTROLLER REPAINTS EVERY PROMPT IN THE GAME.
 *
 * Fired once per change rather than polled, so this is a handful of innerHTML
 * writes when the player swaps hands and nothing at all while they play. Every
 * surface that names a control is on this one line: the Codex grid, the pause
 * card, the three scheme cards and the bindings list (Menu.setDevice), the
 * power wheel, the map caption, the free camera's way back and the order
 * keycaps (HUD.setBindings), and this file's own three.
 */
input.onDevice = () => {
  menu.setDevice(input.device, input.padFamily);
  hud.setBindings(input.bindings, padOf());
  refreshCoachKeys();
  // The scoreboard's caption is painted when the overlay is RAISED, so a
  // device swapped while it is up would leave the one label whose whole job is
  // to name the key you are holding naming the other device's key.
  if (scoreEl.key) scoreEl.key.textContent = liveKey('scoreboard');
};

/**
 * START IS ESCAPE, and it is the same handler and not a second one.
 *
 * Pausing is deliberately not an ACTION — see pauseHintsHtml — because the way
 * out has to survive a binding that has gone wrong, and a pad player had NO way
 * out at all: Escape is a key, and a controller has none. So Start lands on the
 * same `screens.escape()` the keydown listener below calls, through the same
 * Holocron special case, and there is still exactly one rule for what the way
 * out does from each state. Input only raises it when no modifier is held, so
 * the Start chords in the pad map stay bindable.
 */
input.onMenu = () => {
  if (tree.open) { closeMeditation(); return; }
  screens.escape();
};

/**
 * A pad button, for whichever binding chip in the options list is listening.
 *
 * The answer matters: `true` means the rebinder took the press, and Input drops
 * the rest of the frame's pad handling so one button cannot both bind an action
 * and press whatever the focus ring was on.
 */
input.onPadCode = (code) => !!menu.padCode?.(code);

/**
 * THE FRONT END, WALKED WITH A PAD — and the policy is here rather than in
 * Input, because "is a menu on top of the game" is this file's question and
 * `screens.state` is where every other answer to it already lives.
 *
 * In a fight these do nothing: A is Force jump, B is dash and the D-pad is the
 * attack rose, and none of that may also be moving a focus ring. Off a fight
 * they are the whole reason a controller player can start a run at all — a pad
 * that could fight and not press Deploy is not a pad you can play with.
 */
const inMenu = () => screens.state !== 'playing' && !menu.isListeningForBind?.();
input.onNav = (dir) => { if (inMenu()) menu.padNav(dir); };
input.onConfirm = () => { if (inMenu()) menu.padConfirm(); };
// B is the way back, and it is the same rule Escape is: never a dead key.
input.onBack = () => { if (inMenu()) screens.escape(); };

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
    /**
     * …TO THE SQUAD YOU PICKED, AND THAT ARGUMENT WAS MISSING.
     *
     * `order(id, cmdr = null, squad = null)` defaults to the whole army, and
     * this call passed neither — so a player who opened the wheel, chose
     * TARGET, and stepped the selection to "2nd Squad only" could then press a
     * formation key and silently order all five squads. The wheel passed it
     * (`HUD.js`, `world.command.order?.(o.id, null, world.command.selectedSquad)`)
     * and the nine keys did not, which made the two doors to one verb disagree
     * about what the verb was for.
     *
     * Selecting a squad is the whole of "order individual troops", and it is
     * already the hardest thing on this HUD to find. A selection that the fast
     * path throws away is worse than no selection at all.
     */
    if (!cmd.order(o.id, null, cmd.selectedSquad ?? null)) continue;
    const only = cmd.selectedSquad == null ? o.blurb
      : `${ordinal(cmd.selectedSquad + 1)} Squad — ${o.blurb}`;
    hud.message(o.name.toUpperCase(), only);
    break;                       // one order a frame; two at once is neither
  }
}

/**
 * CLEARED TO FIRE — the one keypress PLAN.md §1 is about.
 *
 * Beside the order keys and not inside them: those are orders you give your own
 * men and this is an order somebody else gave you, and the two lists must not
 * share a loop that breaks after the first hit — a formation change and an
 * authorisation are not competing for the same frame.
 *
 * Everything it can refuse — no order standing, one already fired, no army —
 * is refused inside `FireMissionDirector.authorise`, which returns false and
 * says nothing. The HUD panel is what tells the player there is an order to
 * answer; a key that shouted "no fire mission" every time it was pressed would
 * be a key that punishes learning where it is.
 */
function missionKey() {
  if (screens.state !== 'playing') return;
  const fm = world?.fireMissions;
  if (!fm) return;
  if (!input.actHit('authorise')) return;
  fm.authorise();
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
  const k = liveKey;
  host.innerHTML = [
    [k('lessonNext'), 'next'], [k('lessonBack'), 'back'], [k('lessonRepeat'), 'again'],
  ].map(([key, what]) => `<span><kbd>${key}</kbd> ${what}</span>`).join('');
}
refreshCoachKeys();
// …and the power wheel, which carried five typed key letters before this, two
// of them wrong on a fresh install. It is on screen for the whole fight.
hud.setBindings(input.bindings, padOf());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && tree.open) {
    // The Holocron's own way out, and it is the same one the Return button
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
/**
 * THE SCORE IS ARMED AT LOAD AND UNLOCKED ON THE GESTURE — two steps, and it
 * used to be one.
 *
 * Everything here used to hang off the first pointerdown: the AudioContext was
 * built, the graph was wired, the element was created and only then did the
 * 28 MB file start coming down. So the first click bought a connection, a
 * decode and a buffer before it bought a note, and the score audibly arrived
 * late — "there's a lag with the soundtrack, it doesn't actually start playing
 * on the main menu until you click a button, it needs to play as early as you
 * can".
 *
 * WHAT IS ACTUALLY GESTURE-GATED IS NARROWER THAN THAT. A browser blocks
 * `play()` and it blocks `AudioContext.resume()`. It does not block
 * CONSTRUCTING a context — a fresh one is merely born suspended — and it does
 * not block fetching. So all of the slow work is legal before anyone touches
 * anything, and only the unlock has to wait.
 *
 * `armScore` therefore runs immediately: context, graph, element, and (with
 * `preload='auto'` in Audio._startMusic) the file already streaming while the
 * menu is being read. `_startMusic` tries `play()` once and, when the autoplay
 * gate refuses, re-arms itself on the first gesture — so on a page the player
 * has interacted with before, the music simply starts with the menu.
 *
 * `startScore` stays bound for the unlock, and is now cheap: resume the
 * context, and let the retry inside `_startMusic` do the rest. Both listeners
 * stay in the capture phase so no handler can swallow the gesture first.
 */
const armScore = () => {
  audio.init();
  audio.playMusic(TRACKS, { loop: true });
};
/* AND IT DOES NOT CALL playMusic AGAIN. `_startMusic` binds its own retry to
 * pointerdown/keydown when the autoplay gate refuses the first `play()`, so a
 * second start here is a second element and a second stream — two copies of a
 * 49-minute score running over each other, which is what music.mjs's "it starts
 * on the gesture that unlocks the context, ONCE" is counting. This handler had
 * one job the moment `armScore` moved to module load: unlock the context. */
const startScore = () => {
  audio.init(); audio.resume();
};
armScore();
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
  missionKey();
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
