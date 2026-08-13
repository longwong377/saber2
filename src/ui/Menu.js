/**
 * SABER — front end.
 *
 * Menus, the saber forge preview, the boon draft, and the settings that are
 * persisted between sessions.
 */

import * as THREE from 'three';
import { SABER_COLORS, HILT_STYLES, Saber } from '../game/Saber.js';
import { ROBE_COLORS, buildJedi, SPECIES, FACE_PRESETS, speciesOf,
         HAIR_STYLES, BEARD_STYLES } from '../game/Bodies.js';
import { BipedAnimator } from '../game/Rig.js';
// Player.js imports SKIN_TONES and HAIR_COLORS from this file, so this edge
// closes a cycle. It is safe and it is checked: nothing here reads a Player
// binding at module scope — `handPoseOnHilt` is a hoisted function declaration
// and GRIP_AT is only ever read inside poseSaberArm, long after both modules
// have finished evaluating, whichever of the two the browser reaches first.
import { handPoseOnHilt, GRIP_AT } from '../game/Player.js';
import { ORDERS, getOrder, crystalPalette, crystalForOrder, hiltsForOrder } from '../game/Order.js';
import { ROBE_CUTS, attachCloak, attachSkirt, attachLekku } from '../game/Cloth.js';
import { applyInjury } from '../game/Injury.js';
import { LEVELS, LEVEL_ORDER } from '../game/Levels.js';
import { DIFFICULTY } from '../game/Combat.js';
import { MODES, sandboxUnits, SANDBOX_MAX_ENEMIES, sandboxConfig } from '../game/Waves.js';
import { audio } from '../engine/Audio.js';
import { voiceAt, PLAYER_VOICES } from '../engine/Voice.js';
// The reticle's shape table and its painter live with the HUD that draws it;
// the options screen borrows both rather than keeping a second copy that could
// fall out of step with what is actually on screen.
import { applyReticle, shapeAt, colorAt, RETICLE_SHAPES, RETICLE_COLORS } from './HUD.js';
import { QUALITY } from '../engine/Engine.js';
import { ACTIONS, MOUSE, WHEEL, keyLabel, loadBindings, saveBindings, defaultBindings, resolveConflicts } from '../engine/Bindings.js';

// v2: the control scheme defaults changed, and a stored v1 blob would keep
// pinning returning players to the old blade-leads-camera scheme.
// v3: the training block below is new, and a v2 blob spread over these
// defaults would be fine — but `bladeLength` changed its legal range, and a
// stored 1.45 has to be re-read against a cap that now moves.
// v4: the same reason as v2, one scheme along. `scheme` now defaults to
// 'directional', and saveSettings writes the WHOLE object — so every player who
// has ever opened the options screen has `scheme: 'hold'` on disk whether they
// chose it or not, and would never see the new scheme at all.
//
// The legacy list is a CHAIN, oldest last, because drainLegacy spreads them in
// order and the last one wins: tools/smoke.mjs and tools/motion.mjs still preset
// a level by writing the v2 key, so v2 has to keep speaking or every `--level x`
// run would silently boot the dunes.
// Exported so the check that pins the adoption chain can READ the chain instead
// of naming it. It used to hardcode the current key, which meant every version
// bump silently turned "a blob under the current key survives" into "a blob
// under a legacy key is drained" — the assertion still ran, against the wrong
// slot, and reported the current blob as lost.
export const STORE_KEY = 'saber.settings.v6';
export const LEGACY_KEYS = ['saber.settings.v5', 'saber.settings.v4', 'saber.settings.v3', 'saber.settings.v2'];

/**
 * The blade length the forge slider stops at, and the length it stops at when
 * the training leash comes off.
 *
 * 4 m is not arbitrary. World.js culls blade-vs-body candidates at 6 m from the
 * blade's MIDPOINT (`distanceToSquared(bladeMid) > 36`) and props at 5 m, so
 * every metre of blade eats half a metre of that budget. Measured across
 * lengths, the slack left around the tip is:
 *
 *   1.15 m -> 5.42 m enemy / 4.42 m prop      4 m -> 4.00 / 3.00
 *   6.00 m -> 3.00 m / 2.00 m                 10 m -> 1.00 / 0.00
 *   12.0 m -> 0.00 m / -1.00 m  (the tip can no longer touch anything)
 *
 * At 4 m there are still three clear metres of slack on the tightest of those,
 * the capture window along the blade is +/-212 cm against the stock +/-70, and
 * the trail keeps 113 ms of its 150 ms span. Past about 6 m the trail starts
 * visibly shortening and past 10 the cull begins eating real hits.
 */
export const BLADE_CAP = 1.45;
export const BLADE_MAX = 4.0;

/**
 * WHAT A PLAYER CAN CHOOSE TO BE.
 *
 * `buildJedi` has accepted `skinColor` and `hairColor` since it was written and
 * NOTHING EVER PASSED THEM — every Jedi in the game was the one default face
 * under six robe palettes. The builder needed no changes at all; the whole
 * feature was two swatch rows and a line in spawnPlayer.
 *
 * Hex, not names, because that is what the builder takes. The spread is
 * deliberately wide rather than a gradient of one tone.
 */
export const SKIN_TONES = [
  { name: 'Porcelain', hex: 0xf0cdb4 }, { name: 'Fair',     hex: 0xe4b493 },
  { name: 'Warm',      hex: 0xc79a76 }, { name: 'Olive',    hex: 0xa87c52 },
  { name: 'Bronze',    hex: 0x8c5f3c }, { name: 'Umber',    hex: 0x6a462c },
  { name: 'Deep',      hex: 0x4a2f1d }, { name: 'Ashen',    hex: 0xbfae9c },
  { name: 'Zabrak',    hex: 0xb4463a }, { name: 'Twi\'lek',  hex: 0x6f8f6a },
];

export const HAIR_COLORS = [
  { name: 'Black',  hex: 0x1b1410 }, { name: 'Dark brown', hex: 0x2a1d14 },
  { name: 'Brown',  hex: 0x4a3220 }, { name: 'Auburn',     hex: 0x6b3418 },
  { name: 'Copper', hex: 0x92451c }, { name: 'Sand',       hex: 0xb08c56 },
  { name: 'Ash',    hex: 0x8b8578 }, { name: 'Silver',     hex: 0xc9c6bd },
  { name: 'White',  hex: 0xe6e2d8 }, { name: 'Shaven',     hex: 0x3a2e26 },
];

export const DEFAULT_SETTINGS = {
  level: 'dunes',
  order: 'jedi',
  difficulty: 'knight',
  mode: 'roguelite',
  colorIndex: 0,
  // 0x9fd8ff is what the Force has always come out at, so a player who never
  // touches the row keeps exactly the lightning they had. See LIGHTNING_COLORS.
  lightningColor: 0x9fd8ff,
  hiltStyle: 'Graflex',
  species: 'human',
  /**
   * THE CHARACTER SHEET, and it is ONE object on purpose.
   *
   * `face` used to be a preset id. It is now the whole of who the figure is
   * below the neck-up level — the preset's eight numbers, the cut, the beard,
   * the years and the muscle — because `face` is the ONLY appearance argument
   * that survives the trip World.spawnPlayer → new Player → buildJedi as an
   * object, and `faceOf()` in Bodies.js has always read FACE_KEYS out of a raw
   * object and ignored the rest. Six more top-level settings would each have
   * needed a line in two files this workstream does not own, and the one thing
   * this codebase is not short of is parameters nobody passes.
   *
   * The preset's numbers are SPREAD IN rather than referenced, so the object
   * that reaches the builder needs no lookup and a stale preset id cannot
   * silently change a saved character. `preset` is kept beside them only so the
   * card row knows which card to light.
   */
  face: { preset: FACE_PRESETS[0]?.id ?? 'even', hair: 'temple', beard: 'none', age: 0, muscle: 0.5 },
  robeCut: 'temple',
  robeIndex: 1,
  skinIndex: 2,
  hairIndex: 1,
  /**
   * FRAME — one continuum rather than two boxes.
   *
   * The torso is three lathe sections whose chest, waist, hip and shoulder
   * radii are already parameters, so a build is a set of numbers along a line
   * and not two modelled bodies. 0 is the narrowest frame the skeleton carries
   * and 1 the broadest; every body in the game stays the same HEIGHT, which is
   * what keeps one gait solver and one set of reach budgets honest.
   */
  build: 0.5,
  bladeLength: 1.15,
  // 0.7, not 1.0. At this width the halo lobe's amplitude falls to 0.735,
  // under UnrealBloomPass's 1.8 threshold, so the wide outer glow stops feeding
  // the bloom pass entirely rather than merely shrinking; the halo's sigma goes
  // 10.5 cm -> 7.35 cm and the quad's reach 36 cm -> 25 cm. The core keeps 87%
  // of its punch, because a lightsaber's centre is meant to be blown out.
  // Anyone who wants the old blade can put the slider back to 1.0, which is
  // still bit-for-bit what it always was.
  coreWidth: 0.7,
  // ── training ──────────────────────────────────────────────────────────
  // These bite in Sandbox mode and in the dojo, and nowhere else: they are
  // practice controls, not difficulty controls. Zero is legal for both
  // numbers — an empty arena and a room of droids that never fire are both
  // things a player asked for and could not have.
  sandboxCount: 5,
  sandboxFire: 1,
  sandboxType: 'mixed',
  unlimitedBlade: false,
  sensitivity: 1,
  camFollow: 0,
  fov: 60,
  invertY: false,
  firstPerson: false,
  // DIRECTIONAL is what the game ships. See SCHEMES, and the v4 bump above:
  // a stored v3 blob carries `scheme: 'hold'` whether or not its owner ever
  // chose it, so without the bump the new default would reach nobody who had
  // opened the menu once.
  scheme: 'directional',
  deflectAim: 'reticle',
  forcePower: 1,
  forceDrain: 1,
  quality: 'high',
  resolutionScale: 1,
  bloom: true,
  // Off by default: it is an instrument, not decoration. It exists because no
  // frame time in this project has ever been measured on real hardware — the
  // only renderer the build pipeline can reach is a software rasterizer, so
  // every performance claim here is a budget (draw calls, instances) and never
  // a millisecond.
  showPerf: false,
  grain: true,
  /**
   * WHAT A FIGHT LEAVES ON THE BODY.
   *
   * On, because it is the feature; the box is here to switch it OFF, for the
   * same reason `grain` has one. It is live on the same seam as shake and
   * hitstop — see applyInjury in game/Injury.js — so unticking it wipes the
   * marks already on the body rather than only stopping new ones.
   */
  injury: true,
  shake: true,
  slowmo: true,
  volume: 0.8,
  music: 0.45,
  /**
   * VOICES — the mixer, the archetype, and the two halves of who is allowed
   * to speak.
   *
   * `voiceIndex` is an index into PLAYER_VOICES rather than an id string
   * because it rides a slider, and a slider is the only kind of control the
   * options screen has that can carry a name and still be one input. Everything
   * here is read live off `world.settings` by src/ui/Announcer.js and
   * src/engine/Presence.js, so a box ticked on the pause card bites on the very
   * next frame — see SETTING_READERS below for where each one lands.
   */
  voiceIndex: 0,
  voiceLevel: 0.9,
  voiceLines: true,
  enemyVoices: true,
  enemyBody: true,
  /** Killstreak and event popups in the HUD's score column. */
  popups: true,
  /** The reticle, which was a hard-coded white ring for the whole project. */
  reticleShape: 0,
  reticleSize: 1,
  reticleColor: 0,
  grassScale: 1,
  particleScale: 1,
  // SaberController.holdPosition has been a real, per-frame-read behaviour
  // since it was written, World.spawnPlayer has always read
  // `this.settings.bladeHold` into it, and there has never been a key of that
  // name in this object or a control anywhere in the menu. So the reader read
  // `undefined` forever and the feature was unreachable from the game. A
  // reader with no setting is the same lie as a setting with no reader, just
  // pointing the other way.
  bladeHold: false,
};

/** The blade may only be long while the training leash is off. */
export function bladeCeiling(s) { return s.unlimitedBlade ? BLADE_MAX : BLADE_CAP; }

/**
 * Where every setting in DEFAULT_SETTINGS is actually READ.
 *
 * Three of them were read nowhere at all. `shake` and `slowmo` each had a
 * default here, a checkbox in index.html and no onChange, no hook and no
 * consumer anywhere in src/ — unticking either changed precisely nothing on
 * screen, and both read perfectly well as source. A setting that does nothing
 * is a lie to the player, and the only way that stops coming back is if adding
 * one without a reader FAILS.
 *
 * So each entry names the file that consumes the setting and a literal
 * substring of the line that consumes it. tools/checks/controls.mjs holds this
 * to both directions: every key here is in DEFAULT_SETTINGS and every key in
 * DEFAULT_SETTINGS is here, the named file exists, and it really does contain
 * that expression. Rename a reader and the check fails; add a setting and
 * forget to wire it and the check fails. It cannot be satisfied by writing an
 * entry, only by writing a reader.
 *
 * Two entries point back at this file on purpose. `unlimitedBlade` moves the
 * ceiling on the blade sliders and is a menu-scope number by nature, and the
 * feel gates below are the seam where `shake` and `slowmo` finally bite.
 */
/**
 * What the Force can be coloured, and why it is a list.
 *
 * Five that all clear the two-tone shading against every level's sky. Ivory is
 * first because it is what the game shipped with (0x9fd8ff), so a player who
 * never touches this row keeps exactly the lightning they had.
 */
export const LIGHTNING_COLORS = [
  { name: 'Pale Ion',   hex: 0x9fd8ff },
  { name: 'Sith Gold',  hex: 0xffd070 },
  { name: 'Crimson',    hex: 0xff5a4a },
  { name: 'Verdant',    hex: 0x7cf0a0 },
  { name: 'Amethyst',   hex: 0xc08cff },
];

export const SETTING_READERS = {
  level:           ['main.js', 'settings.level'],
  lightningColor:  ['game/Player.js', 'this.world?.settings?.lightningColor'],
  order:           ['game/World.js', 'applyOrder(p, this.settings.order)'],
  difficulty:      ['main.js', 'DIFFICULTY[settings.difficulty]'],
  mode:            ['game/World.js', 'this.settings.mode'],
  colorIndex:      ['game/World.js', 'colorIndex: this.settings.colorIndex'],
  hiltStyle:       ['game/World.js', 'hiltStyle: this.settings.hiltStyle'],
  species:         ['game/World.js', 'species: this.settings.species'],
  face:            ['game/World.js', 'face: this.settings.face'],
  robeCut:         ['game/World.js', 'robeCut: this.settings.robeCut'],
  robeIndex:       ['game/World.js', 'robeIndex: this.settings.robeIndex'],
  skinIndex:       ['game/World.js', 'skinIndex: this.settings.skinIndex'],
  hairIndex:       ['game/World.js', 'hairIndex: this.settings.hairIndex'],
  build:           ['game/World.js', 'build: this.settings.build'],
  bladeLength:     ['game/World.js', 'bladeLength: this.settings.bladeLength'],
  coreWidth:       ['game/World.js', 'coreWidth: this.settings.coreWidth'],
  sandboxCount:    ['game/Waves.js', 's.sandboxCount'],
  sandboxFire:     ['game/Waves.js', 's.sandboxFire'],
  sandboxType:     ['game/Waves.js', 's.sandboxType'],
  unlimitedBlade:  ['ui/Menu.js', 's.unlimitedBlade ? BLADE_MAX : BLADE_CAP'],
  sensitivity:     ['game/World.js', 'sensitivity: this.settings.sensitivity'],
  camFollow:       ['game/World.js', 'followStrength: this.settings.camFollow'],
  fov:             ['main.js', 'settings.fov'],
  invertY:         ['main.js', 'input.invertY = settings.invertY'],
  firstPerson:     ['game/World.js', '!!this.settings.firstPerson'],
  scheme:          ['game/World.js', 'scheme: this.settings.scheme'],
  deflectAim:      ['game/World.js', 'this.settings.deflectAim'],
  forcePower:      ['game/Player.js', 'this.world.settings?.forcePower'],
  forceDrain:      ['game/Player.js', 'this.world.settings?.forceDrain'],
  quality:         ['main.js', 'new Engine(canvas, settings.quality)'],
  resolutionScale: ['main.js', 'engine.setResolutionScale(settings.resolutionScale)'],
  bloom:           ['main.js', '!!settings.bloom &&'],
  showPerf:        ['main.js', 'hud.perf(engine.profiler, settings.showPerf)'],
  grain:           ['main.js', 'engine.setGrain(settings.grain)'],
  injury:          ['game/Injury.js', 's.injury !== false'],
  shake:           ['ui/Menu.js', 'if (rig._feelSettings.shake) addShake(v)'],
  slowmo:          ['ui/Menu.js', 'if (world._feelSettings.slowmo) addHitstop(t)'],
  volume:          ['main.js', 'audio.setVolume(settings.volume)'],
  music:           ['main.js', 'audio.setMusicVolume(settings.music)'],
  grassScale:      ['game/World.js', 'this.settings.grassScale'],
  particleScale:   ['game/World.js', 'this.settings.particleScale'],
  bladeHold:       ['game/World.js', 'this.settings.bladeHold'],
  /**
   * The voice, the room and the reticle.
   *
   * Every one of these is read on a FRAME, off `world.settings`, by code that
   * runs behind HUD.update — not captured at construction and not applied at
   * deploy. That is what makes them all live from the pause card, and it is
   * also what makes each of these entries checkable: the named expression is
   * the line that actually consults the player's answer, once per frame.
   */
  voiceIndex:      ['ui/Announcer.js', 'settings?.voiceIndex ?? 0'],
  voiceLevel:      ['ui/Announcer.js', 'Number.isFinite(settings.voiceLevel)'],
  voiceLines:      ['ui/Announcer.js', 'settings.voiceLines !== false'],
  enemyVoices:     ['ui/Announcer.js', 'settings.enemyVoices !== false'],
  enemyBody:       ['engine/Presence.js', 's.enemyBody !== false'],
  popups:          ['ui/HUD.js', 'world.settings.popups !== false'],
  reticleShape:    ['ui/HUD.js', 'shapeAt(s.reticleShape)'],
  reticleSize:     ['ui/HUD.js', 'num(s.reticleSize, 1)'],
  reticleColor:    ['ui/HUD.js', 'colorAt(s.reticleColor)'],
};

/**
 * Make the two feel toggles mean something.
 *
 * Neither effect has a settings lookup at the point it FIRES, and there is no
 * one place to add one: nineteen `camera.addShake(…)` call sites across Player,
 * World, Duel and Enemy, and twelve `addHitstop(…)`. But every one of them
 * funnels through exactly one function on the way out — CameraRig.addShake is
 * the only writer of `rig.shake`, and World.addHitstop the only writer of
 * `world.hitstop` — so the toggle goes on the funnel. Both wrappers read
 * `settings` live rather than capturing it, so a box ticked on the pause screen
 * bites on the very next explosion with no redeploy.
 *
 * Gating the funnel and not the frame matters: zeroing `rig.shake` once a frame
 * from the game loop would still let one frame of full-amplitude jitter through
 * every time, because the rig applies the shake it was given inside the same
 * update that added it. Gating the funnel makes the deviation exactly zero.
 *
 * Deliberately NOT gated: Focus (hold M3) and Force sense, which also bend
 * time. Those are abilities the player spends Force on and holds a key for — a
 * graphics toggle that silently disabled a Force power would be a new lie in
 * place of the old one. "Cinematic" means the dilation the GAME applies without
 * being asked, which is hitstop, and hitstop is exactly what this gates.
 *
 * Idempotent: safe to call on every build and on every checkbox change.
 *
 * @returns true once both gates are in place on this world.
 */
export function applyFeelSettings(world, s = DEFAULT_SETTINGS) {
  if (!world) return false;
  const rig = world.player?.camera;
  // The blob is re-hung on every call rather than captured by the closure, so
  // a second call with a different settings object cannot leave the gates
  // silently answering to the first one.
  world._feelSettings = s;
  if (rig) rig._feelSettings = s;
  if (rig && !rig._feelGated && typeof rig.addShake === 'function') {
    const addShake = rig.addShake.bind(rig);
    rig.addShake = (v) => { if (rig._feelSettings.shake) addShake(v); };
    rig._feelGated = true;
  }
  if (!world._feelGated && typeof world.addHitstop === 'function') {
    const addHitstop = world.addHitstop.bind(world);
    world.addHitstop = (t) => { if (world._feelSettings.slowmo) addHitstop(t); };
    world._feelGated = true;
  }
  // Turning a toggle off has to bite NOW, not once the shake already in flight
  // has damped out (about 0.4 s) or the hitstop already running has expired.
  if (!s.shake && rig) rig.shake = 0;
  if (!s.slowmo) world.hitstop = 0;
  // "Blade holds position" is the same shape and rides the same seam.
  // SaberController reads `holdPosition` every frame, but the only line that
  // ever wrote it was World.spawnPlayer, so even once the setting existed the
  // box would not have bitten until the next deploy. Pushed here it lands on
  // the very next frame, on every player in the world.
  for (const p of world.players || []) if (p.control) p.control.holdPosition = !!s.bladeHold;
  // "Injuries show on the body" is the same shape again — a funnel gate on
  // Player.damage, installed once and reading its setting live — so it rides
  // the same call rather than needing a second hook in main.js. See
  // applyInjury() for why the funnel and not the frame.
  applyInjury(world, s);
  applyLekku(world);
  return !!(world._feelGated && (!rig || rig._feelGated));
}

/**
 * SIMULATE THE HEAD-TAILS, on the same seam and for the same reason.
 *
 * The species pass wrote it down as a known cost: "Lekku, montrals and
 * tentacles are RIGID geometry hung off the head object, not simulated:
 * Cloth.js belongs to another workstream". They are the same defect the rigid
 * skirt was — welded to a bone, moving zero millimetres relative to it, reading
 * as a prop — and the fix is the solver that is already here.
 *
 * It rides applyFeelSettings for the same reason the injury gate does: Player
 * builds its own cloak in `_makeCloak` and steps it in `update`, and neither
 * line is this workstream's to edit. So the garment is attached from out here
 * and stepped by wrapping the player's own `update` — which is not a
 * convenience, it is the only way it can be stepped on the right clock, with
 * the world's wind, inside the same frame the head it hangs from was posed in.
 * A separate rAF would be a frame behind the skull every frame.
 *
 * Idempotent: a player who already has one keeps it.
 */
export function applyLekku(world) {
  if (!world) return false;
  let n = 0;
  for (const p of world.players || []) {
    if (!p || p.lekku || !p.built || !p.built.lekku || !p.rig) continue;
    const mat = p.built.palette?.skin?.clone();
    if (mat) mat.side = THREE.DoubleSide;
    const lek = attachLekku(world.scene, p.rig, {
      roots: p.built.lekku, rigid: p.built.speciesMeshes, material: mat,
    });
    if (!lek) continue;
    p.lekku = lek;
    const update = p.update.bind(p);
    p.update = (dt, ctx) => {
      update(dt, ctx);
      // The head has just been posed by the animator inside that call, so the
      // anchors are this frame's. Wind comes from the world if it has any.
      // Optional: `die` below nulls it, and the wrapper outlives the garment.
      p.lekku?.update(dt, world.wind || undefined);
    };
    // A corpse's tails go with it: Player.die() disposes its own cloak and
    // skirt and knows nothing about this one, so the dispose is chained onto
    // the same call rather than polled for.
    const die = p.die.bind(p);
    p.die = (src) => { p.lekku?.dispose(); p.lekku = null; die(src); };
    n++;
  }
  return n > 0;
}

/**
 * THE CODEX — the game's own list of what the controls do.
 *
 * It was seventeen rows of markup in index.html with the key names typed into
 * them, and the round that moved Hurl off Mouse2 (where it collided with
 * Thrust) onto Y did not come back here: the grid went on telling a player on a
 * fresh profile "M2 to hurl it" while M2 thrusts. Parsed against
 * defaultBindings(), sixteen of the seventeen rows were right and that one was
 * a lie — and it was a lie no rebind could ever fix, because typed markup does
 * not read the table.
 *
 * So there are no key names here at all. A row names ACTIONS; the renderer asks
 * the live bindings what they are bound to. Rebind Hurl to Backslash and this
 * page says Backslash, in the leading key and in the middle of the sentence.
 *
 * `text` is a function of `k`, which turns an action id into its `<kbd>`
 * markup, so a key named INSIDE a sentence comes from the same place as one in
 * the margin — the M2 above was an inline one, and inline is where a typed key
 * hides longest.
 *
 * `device: 'Mouse'` is the one row with no action behind it: the mouse's own
 * MOTION is not a binding and cannot be rebound. It is declared rather than
 * written into the prose so that "everything else is generated" is checkable.
 *
 * Every id in ACTIONS must appear here — tools/checks/controls.mjs holds both
 * directions — which is how `stance` and `flourish`, invented two rounds ago
 * and documented on no screen a player ever sees, stop being invisible.
 */
export const CODEX = [
  { keys: ['blade'], hold: true,
    text: () => 'Raise the <b>guard</b>. Under Directional the camera keeps moving; under the '
      + 'other two schemes the mouse becomes the blade and the camera holds still.' },
  { device: 'Mouse',
    text: () => '<b>Flick</b> up, left, right or down to set the guard zone. It stays where you '
      + 'put it. Slow movement is pure aim.' },
  { device: 'Mouse',
    text: () => 'Flick into a zone as the bolt lands — inside 0.2 s — and it is a <b>parry</b>: '
      + 'the bolt goes back at whatever is under your reticle.' },
  { keys: ['attackOver'], text: () => 'Overhead attack — wind up over the head and cut down.' },
  { keys: ['attackStab'], text: () => 'Stab. Same lunge as the thrust, on the other half of the wheel.' },
  { keys: ['thrust'], text: () => 'Thrust — drive the hands forward along the blade.' },
  { keys: ['moveF', 'moveL', 'moveB', 'moveR'],
    text: k => `Move. ${k('sprint')} sprint, ${k('crouch')} crouch.` },
  { keys: ['jump'], text: () => 'Force jump — hold to leap higher. Landing sends out a shockwave.' },
  { keys: ['jump', 'jump'], text: () => 'Double jump. Hold on the way up to feed Force into the leap.' },
  { keys: ['dash'], text: () => 'Dash, in any direction you are holding. No direction = dash back.' },
  { keys: ['rollL', 'rollR'], text: () => 'Roll the wrist. Changes the plane your blade cuts on.' },
  // Kept to two or three lines each, like every other row: .codex-grid sizes a
  // grid ROW to its tallest cell, so one five-line entry opens a hole beside
  // the two-line cells next to it.
  { keys: ['stance'], hold: true,
    text: () => 'Lateral guard — the blade lies flat across you. Drift the cursor through the centre '
      + 'and the guard turns over.' },
  { keys: ['flourish'],
    text: () => 'Flourish — an idle twirl and nothing more. Any real intent cancels it.' },
  { keys: ['grip2'], hold: true,
    text: () => 'One-handed grip. A looser blade, and the free hand is yours.' },
  { keys: ['ignite'], text: () => 'Ignite / retract.' },
  { keys: ['focus'],
    text: () => '<b>Focus</b> — hold to bend time. The world slows to a third, you barely do. Burns '
      + 'Force fast, so pick your volleys.' },
  { keys: ['push'], text: () => 'Force push.' },
  { keys: ['pull'], text: () => 'Force pull.' },
  { keys: ['grip'],
    text: k => `Grip an object — then move the mouse to swing it, ${k('hurl')} to hurl it.` },
  { keys: ['throw'], text: () => 'Throw the saber. Press again to recall it.' },
  { keys: ['sense'], text: () => 'Force sense — see through walls.' },
  { keys: ['stasis'],
    text: k => `Stasis field — freeze what is near you, bolts included. ${k('hurl')} fires the whole field.` },
  { keys: ['heal'],
    text: () => 'Force heal — three seconds of standing still, and a hit breaks it. Press again to stop.' },
  { keys: ['rend'], text: () => 'Rend apart. Takes a mechanical enemy to pieces where it stands.' },
  { keys: ['lightning'],
    text: () => 'Force lightning, once the <b>Force Lightning</b> boon has been drafted.' },
  { keys: ['view'], text: () => 'Toggle first / third person.' },
  { keys: ['scoreboard'], hold: true, text: () => 'Scoreboard &amp; run boons.' },
  { keys: ['lessonNext', 'lessonBack', 'lessonRepeat'],
    text: () => 'In the <b>Dojo</b>: next lesson, previous lesson, start this one again.' },
];

/**
 * The three control schemes. Their blurbs name keys, so their blurbs are
 * functions of the bindings like the Codex rows.
 *
 * The Free Blade card said "Hold RMB to look around", which was a typed key
 * name AND a description of an action rather than a button: what the free
 * scheme actually reads is `!input.act('thrust')` for the camera and
 * `actHit('blade')` for the stab, so the card was naming Mouse2's DEFAULT and
 * would have gone on saying RMB after a rebind moved thrust anywhere else.
 *
 * DIRECTIONAL ships first and by default because the other two share one
 * unresolvable flaw, and it is the flaw the player named: both of them buy a
 * steerable guard by taking the camera, and a deflection is aimed with the
 * camera. Their cards say so — a scheme's real cost belongs on its own card,
 * not in a patch note.
 */
export const SCHEMES = [
  { key: 'directional', name: 'Directional Guard',
    blurb: k => `Four guards — high, left, right, low. Hold ${k('blade')} and FLICK the mouse to `
      + `pick one; it stays there. The camera never stops moving, so you aim and block at once. `
      + `Flick as the bolt lands to parry it back. ${k('attackOver')} overhead, ${k('attackStab')} stab.` },
  { key: 'hold', name: 'Hold to Blade',
    blurb: k => `The mouse looks. Hold ${k('blade')} and the mouse IS the blade — while you hold it `
      + `the camera is frozen, so you cannot aim a return until you let go.` },
  { key: 'free', name: 'Free Blade',
    blurb: k => `The mouse always moves the blade and the camera follows it. Hold ${k('thrust')} `
      + `to look around; ${k('blade')} stabs. Chaotic.` },
];

// Key codes come from KeyboardEvent.code and cannot carry markup, but this is
// stored player data on its way into innerHTML and the cost of being sure is
// one replace.
const escKey = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * One action's `<kbd>`s: every key it answers to, alternatives joined by "/".
 *
 * Plural because a binding is a LIST — Focus ships on M3 and T, Dash on Alt and
 * M4 — and a legend that prints only the first would be telling half the truth
 * to anyone using the other one. `—` when an action has been cleared, which is
 * the honest answer and not a crash.
 */
export function keyChips(bindings, id, hold = false) {
  const list = (bindings[id] || []).map(keyLabel);
  if (!list.length) return '<kbd>—</kbd>';
  return list.map((label, i) => `<kbd>${escKey((hold && i === 0 ? 'Hold ' : '') + label)}</kbd>`).join(' / ');
}

/**
 * The Codex grid, as markup, from a bindings table.
 *
 * Pure and DOM-free so that the check can render it against a rebound table and
 * assert what a PLAYER would read, rather than re-deriving the answer with a
 * copy of this loop and agreeing with itself.
 */
export function codexHtml(bindings) {
  return CODEX.map((row) => {
    const lead = row.device ? `<kbd>${escKey(row.device)}</kbd>`
      : row.keys.map(id => keyChips(bindings, id, row.hold)).join(' ');
    return `<div>${lead}<span>${row.text(id => keyChips(bindings, id))}</span></div>`;
  }).join('');
}

/**
 * The pause card's legend.
 *
 * Esc is the one key here that is NOT read from the table, and that is not an
 * oversight: pausing is a raw keydown in main.js precisely so it still works
 * when a binding has gone wrong, so it is not in ACTIONS and there is nothing
 * to read. Declared here, once, instead of typed into index.html beside two
 * that ARE rebindable.
 */
export function pauseHintsHtml(bindings) {
  return ['<span><kbd>Esc</kbd> resume</span>']
    .concat([['view', 'camera'], ['scoreboard', 'boons']]
      .map(([id, what]) => `<span>${keyChips(bindings, id)} ${what}</span>`))
    .join('');
}

/**
 * An older blob speaks once, and then it is retired.
 *
 * Bumping the key without this would not only forget a returning player's
 * crystal — tools/smoke.mjs presets a level by writing the v2 key and
 * reloading, so `--level canyon` would have silently booted the dunes and every
 * screenshot in the project would have been of the wrong place. Reading the old
 * key last (it wins over anything already under the new one) and deleting it is
 * what makes that write-then-reload still mean what it says, exactly once.
 */
/**
 * Settings a given legacy blob is NOT allowed to carry forward.
 *
 * The reason the key was bumped at all is that a stored `scheme` would pin
 * every returning player to 'hold' — saveSettings writes the whole object, so
 * anybody who has opened the options screen once has that value on disk whether
 * they chose it or not. Dropping the WHOLE blob would answer that and also
 * forget their crystal, their level and their volume, which is the exact
 * complaint the comment above drainLegacy is about. So the bump retires one
 * key by name and keeps the rest.
 */
const RETIRED = {
  // v5 retires coreWidth for the same reason v4 retired scheme. The player has
  // now said twice that the blade "covers way too much of the screen", and the
  // default is what they are describing — the slider fix gave the setting real
  // authority over the bloom but deliberately left w = 1.0 identical, so anyone
  // who never touched it saw no change. saveSettings writes the whole object,
  // so a stored 1.0 sits on disk for everyone who has opened the options screen
  // once, chosen or not, and would pin them to the old blade forever.
  'saber.settings.v4': ['coreWidth'],
  'saber.settings.v3': ['scheme', 'coreWidth'],
  'saber.settings.v2': ['coreWidth'],
};

function drainLegacy() {
  let out = null;
  for (const k of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const blob = JSON.parse(raw);
        for (const dead of RETIRED[k] || []) delete blob[dead];
        out = { ...(out || {}), ...blob };
      }
      localStorage.removeItem(k);
    } catch {}
  }
  return out;
}

/**
 * Normalise anything that has ever been stored under `face` into a sheet.
 *
 * Accepts a preset id (every saved blob before the sheet existed), a raw
 * parameter object, a full sheet, or nothing. The preset's eight numbers are
 * spread in from FACE_PRESETS each time, so a sheet is self-contained by the
 * time it reaches the builder and re-picking a preset cannot leave the previous
 * preset's numbers behind it.
 */
export function characterSheet(face) {
  const D = DEFAULT_SETTINGS.face;
  const src = (face && typeof face === 'object') ? face : {};
  const id = typeof face === 'string' ? face : src.preset;
  const preset = FACE_PRESETS.find(f => f.id === id) || FACE_PRESETS[0];
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  const has = (list, v, d) => (list.some(x => x.id === v) ? v : d);
  return {
    ...preset.face,
    preset: preset.id,
    hair: has(HAIR_STYLES, src.hair, D.hair),
    beard: has(BEARD_STYLES, src.beard, D.beard),
    age: num(src.age, D.age),
    muscle: num(src.muscle, D.muscle),
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const legacy = drainLegacy();
    if (!raw && !legacy) return { ...DEFAULT_SETTINGS };
    const s = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : null), ...legacy };
    // A blob written with the leash off and then read with it on would carry a
    // 4 m blade into a normal run without a single control saying so.
    s.bladeLength = Math.min(s.bladeLength, bladeCeiling(s));
    // Every blob ever written carries `face: 'heavy'` — a preset ID string,
    // which is what the setting was. Spreading that over the object default
    // REPLACES it, so the sheet would come back as a string and the cut, the
    // beard, the years and the muscle would all be gone. Normalised rather than
    // version-bumped, because a bump does not help: drainLegacy spreads the old
    // key over the new default too, so the string arrives either way.
    s.face = characterSheet(s.face);
    return s;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

/* ══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE CHARACTER PREVIEW                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE THREE THINGS THE PREVIEW BOX GOT WRONG, AND WHAT EACH ONE MEASURED.
 *
 * All three were reported by a player, all three were invisible to the suite,
 * and all three lived in Menu methods that cannot be imported outside a
 * browser — which is why they survived a character creator's worth of checks
 * about the figure itself. The logic is out here as plain functions for the
 * same reason src/ui/Screens.js is a module: tools/checks/preview.mjs drives
 * every one of them with no DOM at all.
 *
 * 1. THE FIGURE HUNG BELOW THE FLOOR AND WAS CROPPED AT THE WAIST.
 *
 * `buildJedi` returns a rig whose ROOT IS THE HIPS. Nothing in the preview ran
 * the animator, so the root sat at the origin and the figure hung off it:
 * measured, its bounding box was y ∈ [-0.959, +0.779] — the feet a metre BELOW
 * the origin. The camera meanwhile aimed at (0, 0.95, 0), which is 17 cm above
 * the top of that figure's head. Projected through the shipped shot the whole
 * body landed at NDC y ∈ [-2.367, -0.119]: the top of the head just under the
 * centre line, and everything from the ribs down past the bottom of the frame.
 * 63% of the character was off screen. The screenshot is unambiguous.
 *
 * The fix is both halves. `standPreviewFigure` runs the same BipedAnimator the
 * game runs, which plants the feet on y = 0 (box y ∈ [0.000, 1.690]), and
 * `framePreviewCamera` derives the shot from the figure that is actually there
 * instead of from three typed constants. Measured over 9 figures at 3 aspect
 * ratios, 6 pitches and 24 bearings of the spin, the furthest anything now
 * reaches is NDC 0.873 of the 1.0 edge, and the figure fills 67% of the frame
 * height at the default view.
 *
 * 2. THE SABER WAS HELD BACKWARDS.
 *
 * The preview parented the hilt to `handR` with `rotation.set(-π/2, 0, 0)`,
 * which maps the blade's own +Y onto the hand's -Z. The figure faces +Z, so the
 * blade left the fist pointing at the wall BEHIND the character and the pommel
 * pointed forward — measured, the tip landed 1.29 m behind the pommel and 90.0°
 * off the direction the game holds it in.
 *
 * There is no room for taste here, because the game states the relationship
 * outright and now exports it: `handPoseOnHilt` in Player.js is where a fist
 * closes on a weapon, bore and all. `poseSaberArm` picks the guard, asks that
 * function where the hand goes, solves the arm to it with the rig's own IK and
 * the same elbow pole Player uses, and lets `attach` work out what that is in
 * the hand's frame. Nothing about the grip is typed in here twice.
 *
 * 3. THE ROBE CUT DID NOTHING AT ALL — IN THE PREVIEW.
 *
 * Measured in Chromium, cut by cut, on the preview box at 292×360: switching
 * between all six changed AT MOST ONE PIXEL of 105 120, and that one pixel was
 * the blade's own flicker. Not "too subtle" — the preview never asked for a cut
 * and had no cloth in it to ask with. A cut is a set of parameters for the
 * cloth solver, and what was on screen was the RIGID lathe under the
 * simulation: the garment `attachSkirt` hides the moment a real one exists.
 * The same shots taken again after the fix move 1 916-3 900 of those pixels.
 *
 * The in-game path was never broken. World.js:301 reads the setting, Player.js
 * hands it to `attachCloak`/`attachSkirt` as `cut`, and tools/checks/garments.mjs
 * measures what the six cuts do to a walking figure. What was missing was
 * anywhere to SEE it before deploying.
 *
 * And it is not subtle once it is on screen. Settled standing, this is the hem
 * of each cut above the floor, the widest the garment gets, where the cape
 * finishes, and how far out of level the hem is with itself:
 *
 *      cut          hem y     width     cape hem   hem level
 *      temple       0.238 m   0.559 m   0.454 m     20 mm
 *      cassock      0.415     0.550     0.476       21
 *      tabard       0.654     0.468     0.482       24
 *      ceremonial   0.411     0.749     0.422       51
 *      coat         0.466     0.488     0.476       28
 *      wrap         0.361     0.546     0.451      312
 *
 * 416 mm between the longest and the shortest hem and 280 mm between the
 * narrowest and the widest, on a figure 1.69 m tall. The wrap's hem finishes
 * 312 mm out of level with itself — that is `hemBias`, and it is the one cut
 * you can ONLY read standing still, which is what a preview is.
 */

/** The skin tones of a species, falling back to the shared row. */
export function skinRackFor(species) {
  const sp = speciesOf(species);
  return (sp && sp.skinTones && sp.skinTones.length) ? sp.skinTones : SKIN_TONES;
}

/**
 * How long the cloth is left to settle before the shot is taken, in frames of
 * 1/60 s.
 *
 * The preview is a STILL, so the garment has to have stopped moving before it
 * is looked at. The two garments settle at very different rates and the CAPE is
 * what sets this number — it is 860 mm of cloth falling from the shoulders,
 * against a skirt that is already pinned round the hips. Hem height in mm above
 * the floor, against its own 600-frame rest:
 *
 *          frame     15    30    45    60    90   120   180   600
 *   temple skirt    239   238   236   236   239   238   239   239
 *   temple cape     690   675   449   437   447   454   458   457
 *   cerem. cape     822   903   430   417   421   422   422   422
 *
 * The skirt is done by frame 15. The cape is still 8-12 mm out at 45 and inside
 * 3 mm of its rest by 120, on every cut. 120 frames of both garments cost about
 * 20-40 ms, which is a menu click nobody feels.
 */
export const PREVIEW_SETTLE = 120;

/**
 * A FIXED WRINKLE, which the game does not have and this does.
 *
 * Every Cloak draws its own seed out of a module-level stream, so two Jedi in
 * one shot do not crease identically — right for the game, wrong for a
 * portrait: it means the robe re-folds itself differently every time you touch
 * a swatch, and it means the same six cuts are a different picture on every
 * run. Measured on the silhouette at the box's own 290×357, one cut rendered
 * twice under two free seeds differs by 131-268 pixels depending on the
 * bearing — the same order as the 336 that separates the two CLOSEST cuts.
 * Pinned, that noise is exactly 0 at every bearing, and a pixel that moves in
 * the box is a choice the player made.
 *
 * The two numbers are tools/checks/garments.mjs's, so the wardrobe suite and
 * the preview are looking at the same two garments.
 */
export const PREVIEW_SEED = { cloak: 4242, skirt: 991, lekku: 7311 };

/**
 * The shot: 34° vertical, 24.3° round from the front and 8.1° up.
 *
 * The two angles are the direction the old camera looked from, kept to the
 * third decimal, because the framing was the fault and the angle never was.
 * What changed is that the DISTANCE is now solved rather than typed.
 */
export const PREVIEW_VIEW = { fov: 34, azimuth: 0.4232, elevation: 0.1418, margin: 0.06 };

/**
 * HOW A HAND HOLDS A HILT — the game's own statement of it, not a copy.
 *
 * `handPoseOnHilt` and `GRIP_AT` come out of Player.js, which is where the fist
 * closes on a weapon for real: GRIP_AT.R is the point on the hilt's axis the
 * right hand takes, the function returns the hand's world orientation for a
 * given hilt orientation, and the offset from that point back to the wrist
 * joint — which is NOT zero, because the bore of a closed fist is 65 mm up the
 * hand and 30 mm in front of it, and solving the arm straight to the hilt puts
 * the hilt through the middle of the palm.
 *
 * Imported rather than restated because the first version of this file DID
 * restate it, and Player.js's own note is worth repeating: a preview that
 * agrees with the game by having the same numbers typed into it stops agreeing
 * the day one of them is tuned. The check that keeps this honest imports the
 * same function.
 */

/**
 * Stand the figure up.
 *
 * The rig's root is the pelvis and its rest pose is a mannequin hanging off it.
 * This is the game's own solver, run to rest: 60 frames of standing still, and
 * the arm swing at zero speed for the shoulders. Afterwards the feet are on
 * y = 0 and the crown is at y = 1.690 — a figure standing on the floor, which
 * is what everything downstream measures against.
 */
export function standPreviewFigure(rig) {
  /**
   * `rig.scale`, not 1 — and this is the line that a small species turns from
   * a detail into a defect.
   *
   * BipedAnimator measures the LEGS it was handed but not the ankle: `ankleY =
   * 0.072 * s` is how far the ankle sits above the contact point, and the foot
   * under it is 0.062·(the rig's own scale) deep. Told scale 1 over a 0.40
   * rig, the solver plants the ankle at 72 mm and the boot's sole finishes at
   * 25 — measured, a 0.72 m figure standing 43 mm off the floor, which is 6% of
   * its own height. Every archetype in Enemy.js already passes `A.scale` for
   * exactly this reason; the preview had a 1 typed into it because every body
   * that had ever reached it was the same size.
   */
  const anim = new BipedAnimator(rig, { scale: rig.scale ?? 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const at = new THREE.Vector3(), vel = new THREE.Vector3();
  const ground = () => 0;
  for (let i = 0; i < 60; i++) {
    anim.update(1 / 60, { position: at, facing: 0, velocity: vel, grounded: true,
      groundAt: ground, crouch: 0, accelForward: 0, accelStrafe: 0 });
  }
  anim.swingArms(1 / 60, 0, 1);
  rig.updateMatrices();
  return anim;
}

/**
 * Put the saber in the right hand the way the game puts it there.
 *
 * In play the hilt is driven by the mouse and the arm follows it; here the
 * hilt is the thing being placed, so the order is reversed — pick the guard,
 * ask the game where a fist goes on a hilt held like that, solve the arm to
 * that wrist. The RELATIONSHIP that comes out is the game's own, because it is
 * the game's own function that produced it, and tools/checks/preview.mjs pins
 * that by calling the same one.
 *
 * The elbow pole is Player's, to the centimetre (`chest + right·0.75 -
 * up·0.75 - fwd·0.2`), because an elbow that folds through the ribs is the
 * other way this goes wrong and that pole is the tested answer to it.
 */
export function poseSaberArm(rig, saber, out = {}) {
  const chest = rig.worldPos('chest', new THREE.Vector3());
  // the figure faces +Z, so its own right hand is toward -X
  const right = new THREE.Vector3(-1, 0, 0), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1);
  // The guard: hilt in front of the right hip, blade up and 21.7° forward. Far
  // enough forward that the fist clears the robe — measured, 445 mm of air
  // between the pommel and the nearest cloth particle — and low enough that the
  // tip of a capped 1.45 m blade still lands inside the frame.
  const grip = chest.clone().addScaledVector(right, 0.28).addScaledVector(up, -0.16).addScaledVector(fwd, 0.26);
  const blade = new THREE.Vector3(0, 0.93, 0.37).normalize();
  // The hilt's frame: +Y up the blade, +Z as near the way the figure faces as
  // a blade at that angle allows. `x = y × ref` then `z = x × y` — the same
  // construction Rig.aimY makes, written out because the roll matters here.
  const bx = new THREE.Vector3().crossVectors(blade, fwd).normalize();
  const bz = new THREE.Vector3().crossVectors(bx, blade).normalize();
  const hiltQ = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(bx, blade, bz));
  // …and the hand's, from the game's own grip model. `back` is the offset from
  // the point on the hilt to the WRIST JOINT, which is not the same place.
  const handQ = new THREE.Quaternion(), back = new THREE.Vector3();
  handPoseOnHilt('R', hiltQ, null, handQ, back);
  const wrist = grip.clone().add(back);
  const pole = chest.clone().addScaledVector(right, 0.75).addScaledVector(up, -0.75).addScaledVector(fwd, -0.2);
  rig.solveIK('armR', 'foreR', wrist, pole);
  const hand = rig.get('handR');
  if (hand && hand.obj.parent) {
    const pq = new THREE.Quaternion();
    hand.obj.parent.getWorldQuaternion(pq);
    hand.obj.quaternion.copy(pq.invert()).multiply(handQ);
  }
  rig.updateMatrices();
  if (hand && saber) {
    // Put the hilt where it was decided to be and let `attach` work out what
    // that is in the hand's frame. This is the whole of the second bug: the
    // hilt used to be parented with a bare -90° about X and an offset typed in
    // centimetres, which put the blade out of the character's back.
    saber.root.quaternion.copy(hiltQ);
    saber.root.position.copy(grip).sub(new THREE.Vector3(0, GRIP_AT.R, 0).applyQuaternion(hiltQ));
    saber.root.updateMatrixWorld(true);
    hand.obj.attach(saber.root);
  }
  out.grip = grip; out.blade = blade; out.wrist = wrist; out.hiltQ = hiltQ;
  return out;
}

/**
 * Dress the figure in the chosen cut and settle it.
 *
 * Every number here is Player._makeCloak's, because the point of a preview is
 * that it is the same garment: width 0.36, length 0.86, 9 columns, 11 rows,
 * flare 1.0, the cape's live collision proxy fed from the skirt, and the rigid
 * lathe handed over so `attachSkirt` can hide it. tools/checks/preview.mjs
 * reads those constants back out of Player.js so this cannot drift from it in
 * silence.
 */
export function dressPreviewFigure(host, built, cut) {
  const rig = built.rig;
  const mat = built.palette.outer.clone();
  mat.side = THREE.DoubleSide;
  const cloak = attachCloak(host, rig, {
    material: mat, width: 0.36, length: 0.86, cols: 9, rows: 11, flare: 1.0, cut,
    seed: PREVIEW_SEED.cloak,
  });
  let skirt = null;
  if (built.robeSkirt) {
    const smat = (built.palette.over || built.palette.outer).clone();
    smat.side = THREE.DoubleSide;
    skirt = attachSkirt(host, rig, { material: smat, rigid: built.robeSkirt, cut, seed: PREVIEW_SEED.skirt });
    if (cloak) cloak.outer = skirt;
  }
  /**
   * THE HEAD-TAILS, if this species has any.
   *
   * On the same material family as the head — a lek is skin, so it takes the
   * skin material rather than the robe's — and it hides the rigid pair the
   * builder made, exactly as the skirt hides the rigid robe. `built.lekku` is
   * null for every species that has none, so this is a test of the FIGURE and
   * not of a species id.
   */
  let lekku = null;
  if (built.lekku) {
    const lmat = built.palette.skin.clone();
    lmat.side = THREE.DoubleSide;
    lekku = attachLekku(host, rig, { roots: built.lekku, rigid: built.speciesMeshes,
      material: lmat, seed: PREVIEW_SEED.lekku });
  }
  const wind = new THREE.Vector3();
  for (let i = 0; i < PREVIEW_SETTLE; i++) {
    if (skirt) skirt.update(1 / 60, skirt.refreshColliders(), wind);
    if (cloak) cloak.update(1 / 60, cloak.refreshColliders(), wind);
    if (lekku) lekku.update(1 / 60, wind);
  }
  return { cloak, skirt, lekku };
}

/**
 * What the shot has to contain: a cylinder about the figure's own axis.
 *
 * A cylinder rather than a box because the preview SPINS. A box fitted at one
 * yaw is the wrong box a quarter turn later, and the figure would breathe in
 * and out of the frame as it turned; a cylinder is invariant under the only
 * rotation the idle preview applies, so a shot that fits it fits at every yaw.
 */
export function previewContent(objects = [], points = []) {
  const box = new THREE.Box3();
  for (const o of objects) { o.updateMatrixWorld(true); box.expandByObject(o); }
  const v = new THREE.Vector3();
  for (const p of points) box.expandByPoint(v.copy(p));
  if (box.isEmpty()) return { y0: 0, y1: 1, radius: 0.5 };
  return {
    y0: box.min.y, y1: box.max.y,
    radius: Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
      Math.max(Math.abs(box.min.z), Math.abs(box.max.z))),
  };
}

/** Every particle of a settled garment, as points for previewContent. */
export function clothPoints(cloth, out = []) {
  if (!cloth || !cloth.pos) return out;
  const p = cloth.pos;
  for (let i = 0; i < p.length; i += 3) out.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
  return out;
}

/**
 * THE WHOLE FIGURE, ASSEMBLED — stood up, armed, dressed and measured.
 *
 * One function rather than four calls in a Menu method, because the check that
 * proves the shot is framed has to assemble the same figure the menu does, and
 * a check that re-implements the assembly is a check that agrees with itself.
 * The caller owns `built` and `saber`; everything after that is in here.
 */
export function assemblePreview(host, built, saber, s = {}) {
  const rig = built.rig;
  if (host && rig.root.parent !== host) host.add(rig.root);
  standPreviewFigure(rig);
  poseSaberArm(rig, saber);
  const { cloak, skirt, lekku } = dressPreviewFigure(host, built, s.robeCut);
  const pts = [];
  clothPoints(cloak, pts);
  clothPoints(skirt, pts);
  // A lek reaches 34 cm below the jaw and swings; leaving it out of the shot
  // would crop the one feature the species is chosen FOR.
  if (lekku) for (const l of lekku.parts) clothPoints(l, pts);
  if (saber) {
    /*
     * The blade counts toward the shot, CLAMPED at the training cap.
     *
     * Off the leash the slider reaches 4 m, and framing that honestly would put
     * a 1.69 m character at about a third of the frame height — the creator
     * would stop showing you the character in order to show you a strip light.
     * Measured: at the stock 1.15 m the tip lands 2.060 m up, 370 mm over the
     * crown, and the figure keeps 67.0% of the frame height; at the 1.45 m cap
     * 2.338 m and 59.2%; and 4 m is framed as 1.45 m, identically.
     */
    const len = Math.min(s.bladeLength ?? 1.15, BLADE_CAP);
    pts.push(saber.root.localToWorld(new THREE.Vector3(0, len, 0)));
    pts.push(saber.root.localToWorld(new THREE.Vector3(0, -0.16, 0)));
  }
  return { cloak, skirt, lekku, content: previewContent([rig.root], pts) };
}

const _RING = 16;
/**
 * Solve the camera distance instead of typing it.
 *
 * The old shot was `position.set(1.15·pull, 1.35·pull, 2.55·pull)` looking at
 * (0, 0.95, 0), with `pull` growing with the blade — three constants that
 * described a figure nobody had measured. This projects the content cylinder's
 * two rims at 16 bearings and walks the distance in until the worst of the 32
 * lands on the frame edge less the margin. Four iterations get it inside a
 * fifth of a percent.
 *
 * The pitch is an argument because dragging changes it: a figure tipped 63°
 * away projects differently from an upright one, and re-solving per frame is
 * ~200 vector projections, which is nothing beside the draw.
 *
 * The content is expected to be centred on the origin — see the pivot in
 * _startPreview.
 */
export function framePreviewCamera(camera, content, opts = {}) {
  const { pitch = 0, aspect = camera.aspect, margin = PREVIEW_VIEW.margin } = opts;
  camera.aspect = aspect || 1;
  camera.fov = PREVIEW_VIEW.fov;
  const half = Math.max(1e-3, (content.y1 - content.y0) / 2);
  const r = Math.max(1e-3, content.radius);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pts = [];
  for (let i = 0; i < _RING; i++) {
    const th = (i / _RING) * Math.PI * 2;
    const x = Math.sin(th) * r, z = Math.cos(th) * r;
    for (const y of [-half, half]) pts.push(new THREE.Vector3(x, y * cp - z * sp, y * sp + z * cp));
  }
  const dir = new THREE.Vector3(
    Math.sin(PREVIEW_VIEW.azimuth) * Math.cos(PREVIEW_VIEW.elevation),
    Math.sin(PREVIEW_VIEW.elevation),
    Math.cos(PREVIEW_VIEW.azimuth) * Math.cos(PREVIEW_VIEW.elevation));
  const want = 1 - margin;
  const v = new THREE.Vector3();
  // Place the camera, then say how close to the frame edge the worst of the 32
  // lands. The two are never separated: an earlier draft scaled the distance
  // one last time after the final measurement and returned a number the camera
  // was not actually at.
  const at = (d) => {
    camera.position.copy(dir).multiplyScalar(d);
    camera.near = Math.max(0.02, d * 0.02);
    camera.far = d * 3 + 8;
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let worst = 0;
    for (const p of pts) {
      v.copy(p).project(camera);
      worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
    }
    return worst;
  };
  const clamp40 = (d) => Math.min(40, Math.max(0.4, d));
  let d = clamp40((half + r) * 2.2);
  for (let it = 0; it < 6; it++) {
    const worst = at(d);
    // ndc ≈ k/d for a point near the axis, so this is Newton's method with the
    // derivative known: it converges in three or four passes from anywhere.
    if (Math.abs(worst - want) < 0.002) return { distance: d, fill: worst };
    d = clamp40(d * worst / want);
  }
  return { distance: d, fill: at(d) };
}

export class Menu {
  constructor(settings, hooks = {}) {
    this.s = settings;
    // Not every caller comes through loadSettings — the check suites build a
    // Menu straight off DEFAULT_SETTINGS or off a hand-written blob, and a
    // `face` that is still a preset id would give every row `undefined` to
    // light and every slider `undefined` to paint. One line, and the sheet is
    // an object from here on.
    this.s.face = characterSheet(this.s.face);
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
      lightning: document.getElementById('lightning-list'),
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
      landing: document.getElementById('landing'),
      landingAlt: document.getElementById('landing-alt'),
      landingTitle: document.getElementById('landing-title'),
      landingBrief: document.getElementById('landing-brief'),
      landingStats: document.getElementById('landing-stats'),
      netStatus: document.getElementById('net-status'),
      netCode: document.getElementById('net-code'),
      netRoster: document.getElementById('net-roster'),
      gpu: document.getElementById('gpu-line'),
      build: document.getElementById('build-id'),
    };
    // Blade length is reachable from the forge AND from the training panel, so
    // every control bound to a setting is registered and they all refresh
    // together. Two inputs quietly disagreeing about one number is exactly the
    // kind of bug this codebase specialises in.
    this._bound = new Map();
    this._buildTraining();          // must exist before the tab wiring runs
    this._buildTabs();
    this._buildLevels();
    this._buildDifficulty();
    this._buildModes();
    this._buildSaber();
    this._buildOptions();
    this._buildButtons();
    // Belt and braces: _buildOptions reaches this through _buildBindings, but
    // that bails out early when #bind-list is absent (a stripped DOM), and the
    // Codex must still be built in that case rather than left empty.
    this._buildKeyLegends();
    // after _buildSaber, so the forge's own Length slider gets the ceiling too
    this._applyBladeCeiling?.(this.s.unlimitedBlade);
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
                  drifts: ['#dcd0b4', '#c8a870'], meadow: ['#bcd8f4', '#7f9440'],
                  alpine: ['#c8dcfa', '#aebfd4'],
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
    this._modeCards = new Map();
    for (const [key, M] of Object.entries(MODES)) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.mode === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${M.name}</b><span>${M.blurb}</span></div>`;
      d.addEventListener('click', () => { audio.ui('click'); this.selectMode(key); });
      this._modeCards.set(key, d);
      this.el.modes.appendChild(d);
    }
  }

  /** Set the mode from anywhere and leave the Deploy panel telling the truth. */
  selectMode(key) {
    if (!MODES[key]) return;
    this.s.mode = key;
    if (this._modeCards) {
      for (const [k, card] of this._modeCards) card.classList.toggle('sel', k === key);
    }
    saveSettings(this.s);
  }

  /**
   * The colour the Force comes out at.
   *
   * A row rather than a free picker because the whole palette is authored: an
   * arbitrary hex would let a player choose a lightning that vanishes against
   * their own level's sky, and this game's colours are picked to survive the
   * two-tone shading rather than to be any colour at all.
   *
   * It sits under the crystals because it is the same kind of choice, and it
   * writes `settings.lightningColor`, which Player._lightningColor reads for
   * all three places the Force draws itself — the arc, the plasma flash and the
   * stasis burst were three copies of one constant, so a player who picked a
   * colour would have got it in one of the three.
   */
  _buildLightningRow() {
    const host = this.el.lightning;
    if (!host) return;
    host.innerHTML = '';
    for (const l of LIGHTNING_COLORS) {
      const sw = document.createElement('div');
      sw.className = 'sw' + ((this.s.lightningColor ?? LIGHTNING_COLORS[0].hex) === l.hex ? ' sel' : '');
      const hex = '#' + l.hex.toString(16).padStart(6, '0');
      sw.style.background = `radial-gradient(circle at 35% 30%, #fff, ${hex} 62%)`;
      sw.style.boxShadow = `0 0 16px -2px ${hex}`;
      sw.title = l.name;
      sw.addEventListener('click', () => {
        audio.ui('click');
        this.s.lightningColor = l.hex;
        [...host.children].forEach((x) => x.classList.toggle('sel', x === sw));
        saveSettings(this.s);
        if (this.hooks.onLightning) this.hooks.onLightning(l.hex);
      });
      host.appendChild(sw);
    }
  }

  /* ── saber forge ─────────────────────────────────────────────────── */

  _buildSaber() {
    this.el.colors.innerHTML = '';
    crystalPalette(this.s.order).forEach((c, i) => {
      const sw = document.createElement('div');
      sw.className = 'sw' + (this.s.colorIndex === c.index ? ' sel' : '');
      const hex = '#' + c.hex.toString(16).padStart(6, '0');
      sw.style.background = `radial-gradient(circle at 35% 30%, #fff, ${hex} 62%)`;
      sw.style.boxShadow = `0 0 16px -2px ${hex}`;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        audio.ui('click');
        this.s.colorIndex = c.index;   // the rack is filtered; position is not the index
        [...this.el.colors.children].forEach(x => x.classList.toggle('sel', x === sw));
        saveSettings(this.s);
        this._refreshPreview();
        this.hooks.onSaberChange?.(this.s);
      });
      this.el.colors.appendChild(sw);
    });

    this._buildLightningRow();

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
        this._refreshPreview('saber');       // a hilt is not a body either
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
        this._refreshPreview(true);
      });
      this.el.robes.appendChild(sw);
    });

    /**
     * THE ORDER, and it re-homes what depends on it.
     *
     * A Sith rack has no Cerulean in it. Switching order while holding a
     * crystal that order does not carry would leave the setting pointing at a
     * swatch no longer on screen — the control would look fine and the blade
     * would be something the player never chose. `crystalForOrder` moves it to
     * the nearest legal one; the hilt and robe defaults follow the same rule.
     */
    this._cardRow('order-list', 'h-order', 'order', ORDERS, (o) => {
      this.s.colorIndex = crystalForOrder(o.id, this.s.colorIndex);
      if (!hiltsForOrder(o.id).includes(this.s.hiltStyle)) this.s.hiltStyle = o.hiltDefault ?? this.s.hiltStyle;
      if (o.robes && !o.robes.includes(this.s.robeIndex)) this.s.robeIndex = o.robeDefault ?? this.s.robeIndex;
      this._buildSaber();
      this._refreshPreview(true);
    });

    /**
     * SPECIES AND FACE.
     *
     * The skin rack belongs to the SPECIES, not to the menu: a Twi'lek built
     * from the human row is a beige Twi'lek. Changing species therefore
     * re-homes the tone the same way changing order re-homes the crystal —
     * clamped, because the racks are different lengths and a stale index would
     * point past the end of a shorter one.
     */
    this._cardRow('species-list', 'h-species', 'species', SPECIES, () => {
      const tones = this._skinRack();
      if (this.s.skinIndex >= tones.length) this.s.skinIndex = 0;
      this._buildForge();
      this._refreshPreview(true);
    });
    /**
     * THE SHEET'S OWN CONTROLS.
     *
     * Four rows and two sliders that write INTO `this.s.face` rather than into
     * a setting of their own — see DEFAULT_SETTINGS.face for why there is one
     * object and not six settings. Each writes through `_sheet`, which is the
     * single place the object is rebuilt and saved, so a control cannot half-
     * update it and the preset spread happens exactly once.
     */
    this._sheetCardRow('face-list', 'h-face', 'preset', FACE_PRESETS);
    this._sheetCardRow('hairstyle-list', 'h-hairstyle', 'hair', HAIR_STYLES);
    this._sheetCardRow('beard-list', 'h-beard', 'beard', BEARD_STYLES);
    this._sheetSlider('sheet-muscle', 'muscle',
      (v) => (v < 0.34 ? 'wiry' : v > 0.66 ? 'powerful' : 'even'));
    // Years, shown as years. A slider labelled 0.62 is a number; a slider
    // labelled 62 is a person, and the range is what a Jedi's career is.
    this._sheetSlider('sheet-age', 'age', (v) => `${Math.round(18 + v * 62)}`);
    /*
     * THE CUT, WHICH USED TO BE THE ONE DEAD CARD IN THE CREATOR.
     *
     * This row was written with no handler at all, on the argument that a cut
     * is a cloth sim and a preview is a still frame. Measured in the browser,
     * that cost at most ONE changed pixel of 105 120 across all six cuts, and
     * that pixel was the blade flickering — the player reported it, correctly,
     * as "choosing a robe cut does nothing".
     *
     * The argument was wrong twice over. The preview had no cloth in it to be
     * still, so what was on screen was the rigid lathe the simulation replaces;
     * and a cut is mostly not a motion at all — it is a length, a silhouette,
     * a fold count and a hem line, which is exactly what a still frame shows.
     * Settled standing, the six hems sit between 0.238 m and 0.654 m off the
     * floor and the widths run 0.468 m to 0.749 m. See the preview note above.
     */
    this._cardRow('cut-list', 'h-cut', 'robeCut', ROBE_CUTS, () => this._refreshPreview(true));
    this._swatchRow('skin-list', 'skinIndex', this._skinRack(), () => this._refreshPreview(true));
    this._swatchRow('hair-list', 'hairIndex', HAIR_COLORS, () => this._refreshPreview(true));

    this._slider('opt-build', 'build', (v) => (v < 0.34 ? 'slight' : v > 0.66 ? 'heavy' : 'even'),
      () => this._refreshPreview(true));
    // 'saber', not true: neither of these is a new body. See _reforgeSaber.
    this._slider('opt-bladelen', 'bladeLength', (v) => `${v.toFixed(2)}m`, () => this._refreshPreview('saber'));
    this._slider('opt-bladewidth', 'coreWidth', (v) => `${Math.round(v * 100)}%`, () => this._refreshPreview('saber'));
  }

  _slider(id, key, fmt, onChange) {
    const input = document.getElementById(id);
    if (!input) return;
    const entry = this._bound.get(key) || { inputs: [], fmt, onChange };
    // First registration owns the formatter and the side effect; later ones are
    // extra handles on the same number.
    if (fmt && !entry.fmt) entry.fmt = fmt;
    if (onChange && !entry.onChange) entry.onChange = onChange;
    entry.inputs.push(input);
    this._bound.set(key, entry);
    input.addEventListener('input', () => this._set(key, parseFloat(input.value)));
    // The first paint runs onChange on purpose — that is what pushes the stored
    // volume into the mixer and the stored resolution into the renderer.
    this._set(key, this.s[key]);
  }

  /** Write a setting and bring every control bound to it back in step. */
  _set(key, value, silent = false) {
    const entry = this._bound.get(key);
    this.s[key] = value;
    if (entry) {
      for (const input of entry.inputs) {
        if (parseFloat(input.value) !== value) input.value = value;
        const label = input.parentElement?.querySelector('b');
        if (label) label.textContent = entry.fmt ? entry.fmt(value) : Number(value).toFixed(2);
      }
    }
    saveSettings(this.s);
    if (!silent) entry?.onChange?.(value);
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
    // Placed by framePreviewCamera from the figure that ends up in the box —
    // the aspect and the distance here are only what it starts from.
    const camera = new THREE.PerspectiveCamera(PREVIEW_VIEW.fov, 1.15, 0.05, 40);
    scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x2a2418, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 1.6);
    rim.position.set(-2, 1, -2); scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    /**
     * THE PIVOT, and it is not the group.
     *
     * The drag rotates `group`, and a group whose origin is the figure's FEET
     * swings the head through an arc 1.7 m long the moment you tilt — which is
     * the crop coming back by another route. `pivot` carries the whole figure
     * down by the content's own centre height, so both drag axes turn about the
     * middle of the shot and the camera can keep looking at the origin.
     */
    const pivot = new THREE.Group();
    group.add(pivot);

    this.preview = { renderer, scene, camera, group, pivot, running: true, drag: false,
      yaw: 0.4, pitch: 0.1, t: 0, content: null, cloth: [], w: 0, h: 0 };
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
      // Compared against the size we last ASKED for, not against the drawing
      // buffer: setPixelRatio makes those two different numbers on any HiDPI
      // screen, so `domElement.width !== w` was true every single frame and the
      // renderer was resized 60 times a second forever.
      if (p.w !== w || p.h !== h) { p.w = w; p.h = h; p.renderer.setSize(w, h, false); }
      // Re-framed every frame: dragging changes the pitch, and the pitch
      // changes how tall the figure projects. ~200 projections, against a draw.
      this._framePreview();
      p.renderer.render(p.scene, p.camera);
    };
    loop();
  }

  _stopPreview() { if (this.preview) this.preview.running = false; }

  /** The skin tones of the chosen species, falling back to the shared row. */
  _skinRack() { return skinRackFor(this.s.species); }

  /** Redraw every row whose contents depend on another row's choice. */
  _buildForge() { this._buildSaber(); }

  /**
   * One row of cards bound to an id setting — orders, species, cuts, faces.
   * Hides its own heading when the list is empty, so a module that exports
   * nothing yet leaves no titled empty box behind it.
   */
  _cardRow(hostId, headId, key, list, onPick) {
    const host = document.getElementById(hostId);
    const head = headId && document.getElementById(headId);
    if (!host) return;
    host.innerHTML = '';
    const empty = !list || !list.length;
    if (head) head.style.display = empty ? 'none' : '';
    host.style.display = empty ? 'none' : '';
    if (empty) return;
    for (const it of list) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s[key] === it.id ? ' sel' : '');
      const sub = it.epithet || it.blurb || '';
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${it.name}</b><span>${sub}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s[key] = it.id;
        [...host.children].forEach(x => x.classList.toggle('sel', x === d));
        onPick?.(it);
        saveSettings(this.s);
      });
      host.appendChild(d);
    }
  }

  /**
   * A card row bound to a key of the CHARACTER SHEET rather than to a setting.
   *
   * Identical in behaviour to _cardRow — it is deliberately not folded into it,
   * because _cardRow's contract is "writes `this.s[key]`" and that is the exact
   * string tools/checks/controls.mjs matches to prove a picked setting has a
   * control. A helper that wrote sometimes one and sometimes the other would
   * make that check unable to tell the two apart.
   */
  _sheetCardRow(hostId, headId, key, list) {
    const host = document.getElementById(hostId), head = headId && document.getElementById(headId);
    if (!host) return;
    host.innerHTML = '';
    const empty = !list || !list.length;
    if (head) head.style.display = empty ? 'none' : '';
    host.style.display = empty ? 'none' : '';
    if (empty) return;
    for (const it of list) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.face[key] === it.id ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${it.name}</b><span>${it.blurb || ''}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this._sheet(key, it.id);
        [...host.children].forEach(x => x.classList.toggle('sel', x === d));
      });
      host.appendChild(d);
    }
  }

  /** A slider bound to a key of the character sheet. */
  _sheetSlider(id, key, fmt) {
    const input = document.getElementById(id);
    if (!input) return;
    const paint = (v) => {
      if (parseFloat(input.value) !== v) input.value = v;
      const label = input.parentElement?.querySelector('b');
      if (label) label.textContent = fmt ? fmt(v) : Number(v).toFixed(2);
    };
    // Keyed by element id, because _buildForge re-runs whenever the species
    // changes and a list would grow a duplicate painter every time.
    this._sheetInputs = this._sheetInputs || new Map();
    this._sheetInputs.set(id, { key, paint });
    if (!input.dataset.sheetBound) {
      input.dataset.sheetBound = '1';
      input.addEventListener('input', () => this._sheet(key, parseFloat(input.value)));
    }
    paint(this.s.face[key]);
  }

  /**
   * Write one field of the character sheet, rebuild it, save it, and rebuild
   * the figure. The ONE place the sheet is written.
   */
  _sheet(key, value) {
    this.s.face = characterSheet({ ...this.s.face, [key]: value });
    for (const e of (this._sheetInputs || new Map()).values()) e.paint(this.s.face[e.key]);
    saveSettings(this.s);
    this._refreshPreview(true);
  }

  /** One row of colour swatches bound to an index setting. */
  _swatchRow(hostId, key, palette, onPick) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';
    palette.forEach((c, i) => {
      const sw = document.createElement('div');
      sw.className = 'sw' + (this.s[key] === (c.index ?? i) ? ' sel' : '');
      sw.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      sw.title = c.name;
      sw.addEventListener('click', () => {
        audio.ui('click');
        // `c.index ?? i` — a FILTERED rack (an order's crystals) is a subset, so
        // its array position is not the index the game stores. Skin, hair and
        // robe palettes carry no `index` and keep behaving exactly as before.
        this.s[key] = c.index ?? i;
        [...host.children].forEach(x => x.classList.toggle('sel', x === sw));
        saveSettings(this.s);
        onPick?.();
      });
      host.appendChild(sw);
    });
  }

  _framePreview() {
    const p = this.preview;
    if (!p || !p.content) return;
    const host = this.el.preview;
    const w = host?.clientWidth || p.w || 300, h = host?.clientHeight || p.h || 260;
    framePreviewCamera(p.camera, p.content, { pitch: p.pitch, aspect: w / h });
  }

  _refreshPreview(rebuild = false) {
    if (!this.preview) return;
    const p = this.preview;
    // A BLADE IS NOT A BODY. Measured in Chromium, a full rebuild — a Jedi, two
    // garments and 120 frames of cloth — costs 73-234 ms, and the length and
    // width sliders fire on every pointer move: that is 8 frames a second of
    // drag for a change that touches nothing but the weapon. 2.7-11.7 ms this
    // way. See _reforgeSaber.
    if (rebuild === 'saber' && p.saber && p.figure) return this._reforgeSaber();
    if (rebuild || !p.saber) {
      this._clearPreview();
      /*
       * ASSEMBLED WITH THE SPIN TAKEN OFF, and that is not tidiness.
       *
       * A Cloak writes WORLD positions straight into a mesh that carries no
       * transform of its own, so the frame it is settled in is the frame its
       * vertices are read back in. Settled while the box was mid-rotation, the
       * robe would be laid out sideways and then rotated a second time by the
       * group it hangs in. The pivot goes back to the origin for the same
       * reason: it is offset by a content height that has not been measured yet.
       */
      const spin = p.group.rotation.clone();
      p.group.rotation.set(0, 0, 0);
      p.pivot.position.set(0, 0, 0);
      p.group.updateMatrixWorld(true);
      // THE FIGURE, not just the blade. Robe colour has been a setting since
      // the menu was written and the preview never showed it, so choosing one
      // was choosing blind — and skin and hair were not choices at all. A
      // character creator you cannot see is a settings screen.
      try {
        const built = buildJedi({
          robeIndex: this.s.robeIndex ?? 1,
          skinColor: (this._skinRack()[this.s.skinIndex] || this._skinRack()[0]).hex,
          hairColor: (HAIR_COLORS[this.s.hairIndex] || HAIR_COLORS[1]).hex,
          build: this.s.build,
          species: this.s.species,
          face: this.s.face,
          scale: 1,
        });
        p.figure = built;
      } catch { p.figure = null; }   // a stripped DOM in tests has no body kit
      p.saber = new Saber(p.pivot, {
        colorIndex: this.s.colorIndex,
        bladeLength: this.s.bladeLength,
        coreWidth: this.s.coreWidth,
        hiltStyle: this.s.hiltStyle,
        order: this.s.order,
      });
      // On the floor, held in the right hand the way the game holds it, and
      // wearing the cut that was chosen. The hilt used to be parented with a
      // -90° roll that pointed the blade out of the back of the figure, and
      // there was no cloth on the body at all for a cut to change.
      if (p.figure) {
        const a = assemblePreview(p.pivot, p.figure, p.saber, this.s);
        if (a.cloak) p.cloth.push(a.cloak);
        if (a.skirt) p.cloth.push(a.skirt);
        if (a.lekku) for (const l of a.lekku.parts) p.cloth.push(l);
        p.content = a.content;
        // the drag turns about the middle of the shot — see the pivot
        p.pivot.position.y = -(p.content.y0 + p.content.y1) / 2;
        p.pivot.updateMatrixWorld(true);
      } else {
        p.saber.root.position.set(0, -0.05, 0);
        p.content = { y0: -0.2, y1: this.s.bladeLength ?? 1.15, radius: 0.2 };
      }
      p.saber.trail.visible = false;
      p.saber.ignite();
      p.saber.ignition = 1;
      p.group.rotation.copy(spin);
      p.group.updateMatrixWorld(true);
    } else {
      p.saber.setColor(this.s.colorIndex);
      p.saber.order = this.s.order;   // the hilt re-machines live
    }
    this._framePreview();
  }

  /**
   * A new weapon in the same hand — the cheap half of a rebuild.
   *
   * The figure, its clothes and their settled fold pattern all survive; only
   * the hilt is re-machined and the shot re-measured, because a longer blade is
   * a taller thing to frame. `poseSaberArm` is re-run rather than the old local
   * transform copied, so the one statement of how a hand holds a hilt stays the
   * only one.
   */
  _reforgeSaber() {
    const p = this.preview;
    const spin = p.group.rotation.clone();
    p.group.rotation.set(0, 0, 0);
    p.pivot.position.set(0, 0, 0);
    p.group.updateMatrixWorld(true);
    // removeFromParent BEFORE dispose: Saber.dispose only unhooks the root from
    // the scene it was built in, and this one has been re-homed onto a hand
    // bone since — left to itself it would stay in the fist and the new hilt
    // would be the second one in there.
    p.saber.root.removeFromParent();
    p.saber.dispose();
    p.saber = new Saber(p.pivot, {
      colorIndex: this.s.colorIndex,
      bladeLength: this.s.bladeLength,
      coreWidth: this.s.coreWidth,
      hiltStyle: this.s.hiltStyle,
      order: this.s.order,
    });
    poseSaberArm(p.figure.rig, p.saber);
    p.saber.trail.visible = false;
    p.saber.ignite();
    p.saber.ignition = 1;
    const pts = [];
    for (const c of p.cloth) clothPoints(c, pts);
    const len = Math.min(this.s.bladeLength ?? 1.15, BLADE_CAP);
    pts.push(p.saber.root.localToWorld(new THREE.Vector3(0, len, 0)));
    pts.push(p.saber.root.localToWorld(new THREE.Vector3(0, -0.16, 0)));
    p.content = previewContent([p.figure.rig.root], pts);
    p.pivot.position.y = -(p.content.y0 + p.content.y1) / 2;
    p.pivot.updateMatrixWorld(true);
    p.group.rotation.copy(spin);
    p.group.updateMatrixWorld(true);
    this._framePreview();
  }

  /** Everything the last build put in the box, disposed and forgotten. */
  _clearPreview() {
    const p = this.preview;
    if (!p) return;
    if (p.saber) { p.saber.dispose(); p.saber = null; }
    // Cloak.dispose leaves a material it was HANDED alone, because in the game
    // the wearer owns it. Here the preview cloned it for this one figure, so
    // the preview is the owner and nothing else will ever free it.
    for (const c of p.cloth) { c.dispose?.(); c.mat?.dispose?.(); }
    p.cloth.length = 0;
    p.pivot.clear();
    p.figure = null;
    p.content = null;
  }

  /* ── training ────────────────────────────────────────────────────── */

  /**
   * The practice panel.
   *
   * It is built here rather than in index.html for the same reason the boon
   * cards and the key bindings are: the archetype list has to come from
   * ARCHETYPES, and a hand-written copy of it in the markup would be wrong the
   * first time somebody adds a droid.
   *
   * It has to exist before _buildTabs runs — that is what collects .tab and
   * .panel — hence the call order in the constructor.
   */
  _buildTraining() {
    const tabs = document.querySelector('.menu-tabs');
    const wrap = document.querySelector('.menu-wrap');
    if (!tabs || !wrap) return;                       // stripped DOM (tests)

    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.tab = 'training';
    tab.textContent = 'Training';
    // second, right after Deploy: this is where a player who is being shot to
    // pieces goes looking, and the last tab is where nobody looks.
    tabs.insertBefore(tab, tabs.children[1] || null);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.panel = 'training';
    panel.innerHTML = `
      <div class="col">
        <h3>The room</h3>
        <p class="hint" style="margin-bottom:14px">Two numbers you own outright. They apply in
          <b>Sandbox</b> mode in any theatre and in <b>the Dojo</b>, and nowhere else —
          they are practice controls, not a difficulty.</p>
        <label class="slider">Enemies <input type="range" id="opt-sandbox-count"
          min="0" max="${SANDBOX_MAX_ENEMIES}" step="1" value="5"><b></b></label>
        <label class="slider">Incoming fire <input type="range" id="opt-sandbox-fire"
          min="0" max="2" step="0.05" value="1"><b></b></label>
        <p class="hint">Zero enemies is an empty arena to move around in. Zero fire is a room
          full of droids that walk, dodge and never pull a trigger — the two are independent on
          purpose, because reading a swing and reading a bolt are different lessons.</p>
        <p class="hint" style="margin-top:14px">All three are <b>live</b>: they are repeated on the
          pause screen, and the room reshapes itself the moment you resume — change the opponent
          and the wrong droids are retired, no kills required.</p>
      </div>
      <div class="col">
        <h3>Opponent</h3>
        <p class="hint" style="margin-bottom:14px">Practise against exactly one kind of droid.</p>
        <div id="opt-sandbox-type" class="difflist"></div>
      </div>
      <div class="col narrow">
        <h3>Blade</h3>
        <label class="check"><input type="checkbox" id="opt-unlimited-blade"> Unlimited blade length</label>
        <label class="slider">Length <input type="range" id="opt-train-bladelen"
          min="0.85" max="${BLADE_CAP}" step="0.01" value="1.15"><b></b></label>
        <p class="hint">Off the leash the blade reaches ${BLADE_MAX.toFixed(2)} m instead of
          ${BLADE_CAP.toFixed(2)}. The capture window along the blade grows with it — ±70 cm at
          the stock 1.15 m, ±212 cm at 4 m — which is the point: a bolt you cannot yet meet with
          a hand-span of plasma, you can meet with a pike, and then shorten it back.</p>
        <p class="hint">The same slider lives in <b>Saber</b>; they are one number, and like the
          two above it, it is <b>live</b>: the blade you are holding grows or shortens as you drag
          it. It used to say it landed on your next Ignite, and it did not land at all — nothing
          read it after the blade was built.</p>
        <p class="hint" style="margin-top:auto">Deploys the theatre picked under <b>Deploy</b>,
          in Sandbox mode. The Dojo is the quiet one.</p>
        <button id="btn-sandbox" class="primary">Enter the sandbox</button>
      </div>`;
    wrap.insertBefore(panel, document.querySelector('.menu-foot'));

    this._slider('opt-sandbox-count', 'sandboxCount',
      v => (v <= 0 ? 'empty' : String(Math.round(v))));
    this._slider('opt-sandbox-fire', 'sandboxFire',
      v => (v <= 0 ? 'held' : `${v.toFixed(2)}×`));
    this._slider('opt-train-bladelen', 'bladeLength', v => `${v.toFixed(2)}m`, (v) => {
      // This registration is the FIRST for `bladeLength` — _buildTraining runs
      // before _buildSaber — so it is this handler that both sliders fire, and
      // the forge's own is never reached. Which is why 'saber' has to be here
      // too: on the full rebuild, dragging either one is 8 fps.
      this._refreshPreview('saber');
      // The seam for making length live. World.spawnPlayer reads bladeLength
      // once, at construction, so today this lands on the next Ignite — but the
      // Saber itself reads this.bladeLength every frame, so one line in main.js
      // (`onBladeLength: v => world.player?.saber && (…bladeLength = v)`) is the
      // whole fix, and it belongs on that side of the wall.
      this.hooks.onBladeLength?.(v);
    });

    this._buildSandboxUnits();
    this._buildUnlimitedBlade();

    const go = document.getElementById('btn-sandbox');
    if (go) go.addEventListener('click', () => {
      audio.ui('click');
      this.selectMode('sandbox');
      this.hooks.onDeploy?.(this.s);
    });
  }

  _buildSandboxUnits() {
    const host = document.getElementById('opt-sandbox-type');
    if (!host) return;
    const cfg = sandboxConfig(this.s);
    host.innerHTML = '';
    for (const u of sandboxUnits()) {
      const d = document.createElement('div');
      d.className = 'diff' + (cfg.type === u.key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${u.name}</b><span>${u.blurb}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.sandboxType = u.key;
        [...host.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
      });
      host.appendChild(d);
    }
  }

  /**
   * The leash.
   *
   * There is only ONE blade length setting; the checkbox moves the ceiling on
   * every control bound to it. Turning it back off has to shorten a blade that
   * is already past the stock cap, or the setting would be a one-way door that
   * left a 4 m blade in a ranked run with nothing on screen admitting it.
   */
  _buildUnlimitedBlade() {
    const box = document.getElementById('opt-unlimited-blade');
    if (!box) return;
    const apply = (on) => {
      const cap = on ? BLADE_MAX : BLADE_CAP;
      for (const input of this._bound.get('bladeLength')?.inputs || []) input.max = String(cap);
      if (this.s.bladeLength > cap) this._set('bladeLength', cap);
      else this._set('bladeLength', this.s.bladeLength, true);   // re-sync the labels
    };
    box.checked = !!this.s.unlimitedBlade;
    box.addEventListener('change', () => {
      audio.ui('click');
      this.s.unlimitedBlade = box.checked;
      saveSettings(this.s);
      apply(box.checked);
      this._refreshPreview(true);
    });
    this._applyBladeCeiling = apply;
  }

  /* ── options ─────────────────────────────────────────────────────── */

  /**
   * The three deflection aiming models, live-switchable so they can be
   * compared back to back in the same fight rather than argued about.
   */
  _buildDeflectModes() {
    const host = document.getElementById('opt-deflect');
    if (!host) return;
    const modes = [
      ['reticle', 'Reticle',
       'Where you LOOK decides where the bolt goes; the blade decides IF it goes. Two skills at once.'],
      ['physical', 'Physical',
       'The bolt mirrors off the blade\u2019s real surface. Utterly honest, brutally hard to place.'],
      ['sweep', 'Sweep',
       'The bolt goes where you SWUNG. Drag left, it flies left.'],
    ];
    host.innerHTML = '';
    for (const [key, name, blurb] of modes) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.deflectAim === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}</span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.deflectAim = key;
        [...host.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
        this.hooks.onDeflectAim?.(key);
      });
      host.appendChild(d);
    }
  }

  /**
   * Key bindings. Clicking a key listens for the next keypress or mouse button
   * and takes it, warning if it is already spoken for. Escape cancels.
   */
  _buildBindings() {
    const host = document.getElementById('bind-list');
    if (!host) return;
    this.bindings = this.bindings || loadBindings();
    const hint = document.getElementById('bind-hint');

    const render = () => {
      host.innerHTML = '';
      let group = null;
      for (const a of ACTIONS) {
        if (a.group !== group) {
          group = a.group;
          const g = document.createElement('div');
          g.className = 'grp'; g.textContent = group;
          host.appendChild(g);
        }
        const row = document.createElement('div');
        row.className = 'bindrow';
        const label = document.createElement('span');
        label.textContent = a.label;
        const keys = document.createElement('div');
        keys.className = 'keys';
        const bound = this.bindings[a.id] || [];
        // always offer one empty slot so a second key can be added
        for (let i = 0; i < Math.min(bound.length + 1, 3); i++) {
          const b = document.createElement('b');
          b.textContent = keyLabel(bound[i]);
          b.title = bound[i] ? 'Click to rebind, right-click to clear' : 'Click to add a key';
          b.addEventListener('click', (e) => { e.preventDefault(); listen(a, i, b); });
          b.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!bound[i] || bound.length < 2) return;   // never leave it unbound
            audio.ui('click');
            this.bindings[a.id] = bound.filter((_, j) => j !== i);
            saveBindings(this.bindings); this.hooks.onBindings?.(this.bindings); render();
          });
          keys.appendChild(b);
        }
        row.appendChild(label); row.appendChild(keys);
        host.appendChild(row);
      }
      // Every OTHER surface that prints a key reads the same table, so a
      // rebind lands on all of them in the same frame it lands here.
      this._buildKeyLegends();
    };

    const listen = (action, slot, el) => {
      if (this._listening) return;
      this._listening = true;
      el.classList.add('listening');
      el.textContent = '…';
      if (hint) hint.textContent = 'press a key or mouse button — Esc to cancel';

      const finish = (code) => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onMouse, true);
        window.removeEventListener('wheel', onWheel, true);
        this._listening = false;
        if (hint) hint.textContent = '';
        if (code) {
          // EVERY other action loses the key, not just the first one found.
          // The shipped defaults had thrust and hurl both on Mouse2, so the
          // single-clash version took it off one of them and wrote a binding
          // that was still a duplicate — the resolver could not settle the one
          // table that came out of the box needing it.
          const { refused } = resolveConflicts(this.bindings, code, action.id);
          if (refused.length && hint) {
            hint.textContent = `${keyLabel(code)} is the last key on `
              + `${refused.map(id => ACTIONS.find(a => a.id === id)?.label || id).join(', ')} — `
              + 'it is bound to both. Give that one another key first.';
          }
          const list = (this.bindings[action.id] || []).slice();
          list[slot] = code;
          this.bindings[action.id] = list.filter(Boolean).slice(0, 3);
          saveBindings(this.bindings);
          this.hooks.onBindings?.(this.bindings);
          audio.ui('click');
        }
        render();
      };
      const onKey = (e) => {
        e.preventDefault(); e.stopPropagation();
        finish(e.code === 'Escape' ? null : e.code);
      };
      const onMouse = (e) => {
        e.preventDefault(); e.stopPropagation();
        finish(MOUSE[e.button] || null);
      };
      // The wheel is a bindable code now, so the thing that captures codes has
      // to be able to hear one — otherwise "Overhead attack" would be the only
      // row in the table you could not rebind ONTO, which is half a control.
      const onWheel = (e) => {
        e.preventDefault(); e.stopPropagation();
        finish(e.deltaY < 0 ? WHEEL.up : WHEEL.down);
      };
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    };

    const reset = document.getElementById('btn-bind-reset');
    if (reset && !reset._wired) {
      reset._wired = true;
      reset.addEventListener('click', () => {
        audio.ui('click');
        this.bindings = defaultBindings();
        saveBindings(this.bindings);
        this.hooks.onBindings?.(this.bindings);
        render();
      });
    }
    render();
  }

  /**
   * Every key name the player reads, printed from the live bindings.
   *
   * Two surfaces, one source. The Codex grid used to be seventeen rows of typed
   * markup and the pause card three typed keys, and both were wrong the moment
   * anything moved — the Codex was already wrong on a FRESH profile, telling
   * the player M2 hurls a gripped object when M2 thrusts and Y hurls.
   *
   * Called from _buildBindings' render(), so a rebind repaints the Codex and
   * the pause card in the same frame it repaints the bindings list.
   */
  _buildKeyLegends() {
    this.bindings = this.bindings || loadBindings();
    const grid = document.getElementById('codex-grid');
    if (grid) grid.innerHTML = codexHtml(this.bindings);
    const hints = document.getElementById('pause-hints');
    if (hints) hints.innerHTML = pauseHintsHtml(this.bindings);

    // The control-scheme cards name the key you hold to hand the camera back.
    for (const s of SCHEMES) {
      const el = document.querySelector(`#opt-scheme [data-scheme="${s.key}"] .txt span`);
      if (el) el.innerHTML = s.blurb(id => keyChips(this.bindings, id));
    }
  }

  _buildOptions() {
    this._buildDeflectModes();
    this._buildBindings();
    const host = document.getElementById('opt-scheme');
    host.innerHTML = '';
    for (const s of SCHEMES) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.scheme === s.key ? ' sel' : '');
      // The blurb is left empty and filled by _buildKeyLegends, because it
      // names keys and therefore has to be repainted on every rebind.
      d.dataset.scheme = s.key;
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${s.name}</b><span></span></div>`;
      d.addEventListener('click', () => {
        audio.ui('click');
        this.s.scheme = s.key;
        [...host.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
        this.hooks.onSchemeChange?.(s.key);
      });
      host.appendChild(d);
    }
    // _buildBindings ran before the cards existed, so its repaint found nothing.
    this._buildKeyLegends();

    // Every card states the tier's OWN numbers, straight off Engine's QUALITY,
    // because the previous four sentences promised things nothing read: the
    // Performance card said "fewer particles… for laptops and integrated
    // graphics" while World.loadLevel handed every tier Cinematic's particle
    // and grass budgets — 19,800 pooled particles and 11,000 blades at `low`
    // exactly as at `ultra`. A card that quotes the table cannot drift from it.
    const qhost = document.getElementById('opt-quality');
    qhost.innerHTML = '';
    for (const [key, name, blurb] of [
      ['low', 'Performance', 'Smallest shadows, shortest view. For laptops and integrated graphics.'],
      ['medium', 'Balanced', 'A good default on most machines.'],
      ['high', 'Fidelity', 'Full shadows and a deep view.'],
      ['ultra', 'Cinematic', 'Everything. Expects a discrete GPU.'],
    ]) {
      const q = QUALITY[key];
      const budget = `${Math.round(q.particles * 100)}% particles · ${Math.round(q.grass * 100)}% grass `
        + `· ${q.viewDist} m view · ${q.shadow}px shadows`;
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.quality === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}<br>${budget}</span></div>`;
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
    this._slider('opt-forcepower', 'forcePower', v => `${v.toFixed(2)}\u00d7`, v => this.hooks.onForce?.());
    this._slider('opt-forcedrain', 'forceDrain', v => (v <= 0 ? 'unlimited' : `${v.toFixed(2)}\u00d7`),
      v => this.hooks.onForce?.());
    this._slider('opt-scale', 'resolutionScale', v => `${Math.round(v * 100)}%`, v => this.hooks.onResolution?.(v));
    // The two multipliers on top of the tier. They have been keys of
    // DEFAULT_SETTINGS with real readers in World.loadLevel since the tier
    // ladder was fixed — and no control anywhere, so both were pinned at 1
    // forever while World's own comment described "the player's own two
    // sliders". These are those sliders.
    //
    // Grass reaches zero and particles do not: an empty field is a legitimate
    // thing to ask a slow laptop for, whereas the particle budget also carries
    // sparks, impact puffs and blood — the feedback that tells you a hit
    // landed — so the floor is the Performance tier's own 0.4 rather than
    // nothing at all.
    this._slider('opt-grass', 'grassScale', v => (v <= 0 ? 'bare' : `${Math.round(v * 100)}%`));
    this._slider('opt-particles', 'particleScale', v => `${Math.round(v * 100)}%`,
      // Emission is re-read from the settings every time the tier is applied,
      // and applyQuality is the one seam that does it, so the existing hook is
      // exactly the right one: it means "the fidelity budget moved, go and
      // read it again". Pool capacity and the grass instance budget are
      // allocated at level load and follow on the next deploy.
      () => this.hooks.onQualityChange?.(this.s.quality));
    this._slider('opt-vol', 'volume', v => `${Math.round(v * 100)}%`, v => audio.setVolume(v));
    this._slider('opt-music', 'music', v => `${Math.round(v * 100)}%`, v => audio.setMusicVolume(v));
    this._check('opt-invert', 'invertY', v => this.hooks.onInvert?.(v));
    this._check('opt-firstperson', 'firstPerson');
    // Live on the same seam as shake and slowmo: applyFeelSettings pushes it
    // onto every player's controller, so it bites on the next frame instead of
    // on the next deploy.
    this._check('opt-bladehold', 'bladeHold', () => this.hooks.onFeel?.(this.s));
    this._check('opt-bloom', 'bloom', v => this.hooks.onBloom?.(v));
    this._check('opt-showperf', 'showPerf');
    this._check('opt-grain', 'grain', v => this.hooks.onGrain?.(v));
    // Both toggles are live: applyFeelSettings re-reads `this.s` on every
    // shake and every hitstop, so the hook exists only to kill what is already
    // in flight the moment the box is unticked.
    // Same hook as shake and slow-motion: onFeel re-runs applyFeelSettings,
    // which is where the injury gate is re-armed and the marks wiped.
    this._check('opt-injury', 'injury', () => this.hooks.onFeel?.(this.s));
    this._check('opt-shake', 'shake', () => this.hooks.onFeel?.(this.s));
    this._check('opt-slowmo', 'slowmo', () => this.hooks.onFeel?.(this.s));

    /* ── voices ──────────────────────────────────────────────────────────
     *
     * The mixer slider is wired straight into the engine on every move AND on
     * the first paint (that is what `_slider` does with `_set`), so a stored
     * level reaches the speech bus before a single line is spoken. Everything
     * else is read live by the announcer off `world.settings` — the same object
     * this menu is writing — so no hook is needed and none is faked: a toggle
     * here is not a message to the game, it IS the game's answer next frame.
     */
    /* Three of these sliders index a TABLE, and the tables can grow. Their
     * `max` is taken from the table rather than typed into index.html, so
     * adding a sixth voice or an eighth reticle shape cannot leave the new one
     * unreachable behind a stale attribute. */
    const cap = (id, n) => { const el = document.getElementById(id); if (el) el.max = String(n - 1); };
    cap('opt-voice', PLAYER_VOICES.length);
    cap('opt-ret-shape', RETICLE_SHAPES.length);
    cap('opt-ret-color', RETICLE_COLORS.length);

    this._slider('opt-voicelevel', 'voiceLevel', v => (v <= 0 ? 'off' : `${Math.round(v * 100)}%`),
      v => audio.setVoiceLevel(v));
    this._slider('opt-voice', 'voiceIndex', v => voiceAt(v).name, (v) => {
      const el = document.getElementById('voice-blurb');
      if (el) el.textContent = voiceAt(v).blurb;
      // Hearing it is the only way to choose one, and a slider you cannot
      // audition is a slider you set once and never touch again.
      this._auditionVoice(v);
    });
    this._check('opt-voicelines', 'voiceLines');
    this._check('opt-enemyvoices', 'enemyVoices');
    this._check('opt-enemybody', 'enemyBody');
    this._check('opt-popups', 'popups');
    const test = document.getElementById('btn-voice-test');
    if (test) test.addEventListener('click', () => this._auditionVoice(this.s.voiceIndex));

    /* ── the reticle ─────────────────────────────────────────────────────
     *
     * Painted through the HUD's own applyReticle so the preview box and the
     * thing in the middle of the screen cannot disagree — one shape table, one
     * painter. It also has to be applied HERE and not left to HUD.update,
     * because these three controls are reachable from the pause card, where the
     * HUD's frame loop is not running: without this, a player would drag the
     * colour slider and see nothing until they resumed.
     */
    const repaintReticle = () => {
      applyReticle(document.getElementById('reticle'), this.s);
      applyReticle(document.getElementById('ret-demo'), this.s);
    };
    this._slider('opt-ret-shape', 'reticleShape', v => shapeAt(v).name, repaintReticle);
    this._slider('opt-ret-size', 'reticleSize', v => `${Math.round(v * 100)}%`, repaintReticle);
    this._slider('opt-ret-color', 'reticleColor', v => colorAt(v).name, repaintReticle);
    repaintReticle();
    const blurb = document.getElementById('voice-blurb');
    if (blurb) blurb.textContent = voiceAt(this.s.voiceIndex).blurb;
    // Everything above has had its first paint; from here a change is a
    // PLAYER's change and may be answered out loud.
    this._optionsReady = true;
  }

  /**
   * Play the chosen voice, once, without a fight around it.
   *
   * `speak` needs a live context, and the options screen is often the first
   * thing a player touches — so the context is armed here exactly as the menu
   * blips arm it. 'streak' rather than 'effort' because a three-syllable rising
   * line carries the cadence and the pitch contour, which is most of what makes
   * one archetype different from another; a single grunt does not.
   */
  _auditionVoice(index) {
    // NOT during the build. `_slider` fires its onChange on the first paint —
    // that is what pushes the stored volume into the mixer — and doing it here
    // would create an AudioContext while the page is still assembling, before
    // any gesture, which every browser complains about and none will start.
    if (!this._optionsReady) return;
    // Dragging the slider walks every archetype on the way past. One line at a
    // time is an audition; five overlapping is the mud this whole round is
    // about, and the engine's cap would hide it rather than fix it.
    if (audio.speaking > 0) return;
    audio.init();
    audio.resume();
    audio.setVoiceLevel(this.s.voiceLevel);
    audio.speak(voiceAt(index), 'streak', { gain: 1, self: true });
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
    // The whole point of the profiler is that the numbers have to leave the
    // player's machine — nothing in this project's build pipeline can reach a
    // real GPU, so a frame time only exists if someone plays and sends it back.
    // Clipboard first, with a select-all fallback, because clipboard writes are
    // refused outside a secure context and a button that silently does nothing
    // is worse than no button.
    bind('btn-perfcopy', async () => {
      const text = this.hooks.onPerfReport?.();
      if (!text) return;
      const btn = document.getElementById('btn-perfcopy');
      try {
        await navigator.clipboard.writeText(text);
        if (btn) { btn.textContent = 'Copied — paste it back'; setTimeout(() => { btn.textContent = 'Copy frame report'; }, 2600); }
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,80vw);height:190px;z-index:99;font:12px monospace';
        document.body.appendChild(ta);
        ta.select();
        if (btn) btn.textContent = 'Select and copy, then click again';
        const close = () => { ta.remove(); if (btn) btn.textContent = 'Copy frame report'; };
        ta.addEventListener('blur', close, { once: true });
      }
    });
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
      // An attunement is permanent and repeatable and a card is neither, so it
      // reads differently rather than hiding among them.
      card.className = b.attune ? 'dc att' : 'dc';
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
  hideDraft() { this.el.draft.classList.add('hidden'); }

  /**
   * The two sandbox numbers, repeated where you can actually reach them.
   *
   * "Live" is worth nothing if the only copy of the control is behind Abandon
   * Run. Both directors re-read world.settings every frame and the menu writes
   * to that same object, so a slider moved here has already taken effect by the
   * time the fade finishes.
   */
  _buildPauseTraining() {
    if (this._pauseTraining !== undefined) return this._pauseTraining;
    const host = this.el.pause?.querySelector('.pause-wrap');
    if (!host || !this.el.pauseStats) { this._pauseTraining = null; return null; }
    const box = document.createElement('div');
    box.style.cssText = 'text-align:left;margin:18px 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)';
    // The opponent picker is a dozen rows of prose in the menu, which does not
    // fit a 400 px pause card — but the room converges on whatever is chosen,
    // so it has to be reachable without abandoning the run. Same setting, one
    // line instead of twelve.
    box.innerHTML = `
      <label class="slider">Enemies <input type="range" id="opt-pause-count"
        min="0" max="${SANDBOX_MAX_ENEMIES}" step="1" value="5"><b></b></label>
      <label class="slider">Incoming fire <input type="range" id="opt-pause-fire"
        min="0" max="2" step="0.05" value="1"><b></b></label>
      <label class="slider">Opponent <select id="opt-pause-type" style="flex:1;min-width:0;
        background:#10151d;color:#dfe6f0;border:1px solid rgba(255,255,255,.14);border-radius:6px;
        padding:4px 6px;font:inherit;font-size:11.5px"></select></label>`;
    this.el.pauseStats.after(box);
    this._slider('opt-pause-count', 'sandboxCount');
    this._slider('opt-pause-fire', 'sandboxFire');

    const sel = box.querySelector('#opt-pause-type');
    for (const u of sandboxUnits()) {
      const o = document.createElement('option');
      o.value = u.key; o.textContent = u.name;
      // the popup list is drawn by the OS and does not inherit the select's
      // colours everywhere, so each row carries them
      o.style.cssText = 'background:#10151d;color:#dfe6f0';
      sel.appendChild(o);
    }
    sel.value = sandboxConfig(this.s).type;
    sel.addEventListener('change', () => {
      this.s.sandboxType = sel.value;
      saveSettings(this.s);
      this._buildSandboxUnits();          // keep the menu's own picker in step
    });
    this._pauseType = sel;
    this._pauseTraining = box;
    return box;
  }

  /**
   * @param {boolean} [sandboxLive]  does the room the player is standing in
   *   actually read sandboxCount / sandboxFire / sandboxType this frame? Only
   *   the caller can know: main.js asks the live director. Left out (a test, a
   *   pause with no world) it falls back to the settings, which is the best
   *   guess available and no worse than what this used to do.
   */
  showPause(stats, sandboxLive) {
    this.el.pauseStats.innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    // Only where the numbers actually bite; everywhere else they would be two
    // sliders that do nothing, which is worse than no sliders at all.
    //
    // `level === 'dojo'` was not that test. The dojo runs eleven lessons and
    // exactly ONE of them — the last, Dojo.inSandbox — is the sandbox room that
    // reads these three numbers; the other ten place their own remotes, dummies
    // and sparring partner from the lesson's own setup block and ignore them
    // entirely. So the sliders showed for all eleven and bit on one, and a
    // player pausing on lesson three could drag "Enemies" from 5 to 0 and watch
    // nothing at all happen. The live director is the only thing that knows.
    const live = sandboxLive !== undefined
      ? !!sandboxLive
      : (this.s.mode === 'sandbox' || this.s.level === 'dojo');
    const box = this._buildPauseTraining();
    if (box) {
      box.style.display = live ? '' : 'none';
      if (this._pauseType) this._pauseType.value = sandboxConfig(this.s).type;
    }
    this.el.pause.classList.remove('hidden');
  }
  hidePause() { this.el.pause.classList.add('hidden'); }

  showDeath(stats, title) {
    if (title) this.el.deathTitle.textContent = title;
    this.el.deathStats.innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.el.death.classList.remove('hidden');
  }
  hideDeath() { this.el.death.classList.add('hidden'); }

  /**
   * The landing between rungs of the Spire.
   *
   * `next` is the rung about to be climbed INTO, so the altitude and the brief
   * describe where the player is going rather than where they have been — the
   * card is a threshold, not a receipt. On the crown there is no next rung and
   * the caller shows the death card with a different title instead.
   */
  showLanding({ altitude, name, brief, stats = [], onAscend }) {
    this.el.landingAlt.textContent = `${Math.round(altitude).toLocaleString()} m`;
    this.el.landingTitle.textContent = name;
    this.el.landingBrief.textContent = brief || '';
    this.el.landingStats.innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const btn = document.getElementById('btn-ascend');
    // Replaced rather than added to: this screen is shown once per rung and a
    // listener per landing would fire the fourth ascent four times.
    btn.onclick = () => { audio.ui('good'); this.hideLanding(); onAscend?.(); };
    this.el.landing.classList.remove('hidden');
  }
  hideLanding() { this.el.landing.classList.add('hidden'); }
}
