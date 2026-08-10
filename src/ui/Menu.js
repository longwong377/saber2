/**
 * SABER — front end.
 *
 * Menus, the saber forge preview, the boon draft, and the settings that are
 * persisted between sessions.
 */

import * as THREE from 'three';
import { SABER_COLORS, HILT_STYLES, Saber } from '../game/Saber.js';
import { ROBE_COLORS, buildJedi, SPECIES, FACE_PRESETS, speciesOf } from '../game/Bodies.js';
import { ORDERS, getOrder, crystalPalette, crystalForOrder, hiltsForOrder } from '../game/Order.js';
import { ROBE_CUTS } from '../game/Cloth.js';
import { LEVELS, LEVEL_ORDER } from '../game/Levels.js';
import { DIFFICULTY } from '../game/Combat.js';
import { MODES, sandboxUnits, SANDBOX_MAX_ENEMIES, sandboxConfig } from '../game/Waves.js';
import { audio } from '../engine/Audio.js';
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
  hiltStyle: 'Graflex',
  species: 'human',
  face: FACE_PRESETS[0]?.id ?? 'even',
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
  shake: true,
  slowmo: true,
  volume: 0.8,
  music: 0.45,
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
export const SETTING_READERS = {
  level:           ['main.js', 'settings.level'],
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
  shake:           ['ui/Menu.js', 'if (rig._feelSettings.shake) addShake(v)'],
  slowmo:          ['ui/Menu.js', 'if (world._feelSettings.slowmo) addHitstop(t)'],
  volume:          ['main.js', 'audio.setVolume(settings.volume)'],
  music:           ['main.js', 'audio.setMusicVolume(settings.music)'],
  grassScale:      ['game/World.js', 'this.settings.grassScale'],
  particleScale:   ['game/World.js', 'this.settings.particleScale'],
  bladeHold:       ['game/World.js', 'this.settings.bladeHold'],
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
  return !!(world._feelGated && (!rig || rig._feelGated));
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

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const legacy = drainLegacy();
    if (!raw && !legacy) return { ...DEFAULT_SETTINGS };
    const s = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : null), ...legacy };
    // A blob written with the leash off and then read with it on would carry a
    // 4 m blade into a normal run without a single control saying so.
    s.bladeLength = Math.min(s.bladeLength, bladeCeiling(s));
    return s;
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
    this._cardRow('face-list', 'h-face', 'face', FACE_PRESETS, () => this._refreshPreview(true));
    // The cut is a CLOTH SIM, and the preview is a still frame — so it is
    // honest about that rather than pretending: no rebuild here, because
    // there is nothing a static pose can show about how a garment moves.
    this._cardRow('cut-list', 'h-cut', 'robeCut', ROBE_CUTS);
    this._swatchRow('skin-list', 'skinIndex', this._skinRack(), () => this._refreshPreview(true));
    this._swatchRow('hair-list', 'hairIndex', HAIR_COLORS, () => this._refreshPreview(true));

    this._slider('opt-build', 'build', (v) => (v < 0.34 ? 'slight' : v > 0.66 ? 'heavy' : 'even'),
      () => this._refreshPreview(true));
    this._slider('opt-bladelen', 'bladeLength', (v) => `${v.toFixed(2)}m`, () => this._refreshPreview(true));
    this._slider('opt-bladewidth', 'coreWidth', (v) => `${Math.round(v * 100)}%`, () => this._refreshPreview(true));
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

  /**
   * The forge shot is framed on the HILT: at the stock 1.15 m the tip already
   * projects to NDC y = 2.53, two and a half screens above the top of the
   * frame, and that crop is the intent — you are choosing a hilt here.
   *
   * An unlimited blade would simply crop identically (4 m puts the tip at NDC
   * 10.9) and the setting would be invisible in the one place that shows you
   * the weapon. So past the stock cap the camera walks back in proportion,
   * which holds the crop steady instead: 42% of the blade stays in frame at any
   * length, against 53% at 1.15 m, and the hilt shrinks by the same factor
   * rather than vanishing.
   */
  /** The skin tones of the chosen species, falling back to the shared row. */
  _skinRack() {
    const sp = speciesOf(this.s.species);
    return (sp && sp.skinTones && sp.skinTones.length) ? sp.skinTones : SKIN_TONES;
  }

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
    if (!p) return;
    // Framed on the whole figure now that there is one, and pulled back a
    // little further for a longer blade so the choice still reads.
    const pull = Math.max(1, this.s.bladeLength / BLADE_CAP);
    p.camera.position.set(1.15 * pull, 1.35 * pull, 2.55 * pull);
    p.camera.far = 40 * pull;
    p.camera.lookAt(0, 0.95, 0);
    p.camera.updateProjectionMatrix();
  }

  _refreshPreview(rebuild = false) {
    if (!this.preview) return;
    this._framePreview();
    const p = this.preview;
    if (rebuild || !p.saber) {
      if (p.saber) { p.saber.dispose(); }
      p.group.clear();
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
        p.group.add(built.rig.root);
        built.rig.updateMatrices();
      } catch { p.figure = null; }   // a stripped DOM in tests has no body kit
      p.saber = new Saber(p.group, {
        colorIndex: this.s.colorIndex,
        bladeLength: this.s.bladeLength,
        coreWidth: this.s.coreWidth,
        hiltStyle: this.s.hiltStyle,
        order: this.s.order,
      });
      // Held in the right hand rather than floating: parented to the bone, so
      // it stays put whatever the rest pose does.
      const hand = p.figure?.rig?.get('handR')?.obj;
      if (hand) {
        hand.add(p.saber.root);
        p.saber.root.position.set(0, 0.04, 0.02);
        p.saber.root.rotation.set(-Math.PI * 0.5, 0, 0);
      } else {
        p.saber.root.position.set(0, -0.05, 0);
      }
      p.saber.trail.visible = false;
      p.saber.ignite();
      p.saber.ignition = 1;
    } else {
      p.saber.setColor(this.s.colorIndex);
      p.saber.order = this.s.order;   // the hilt re-machines live
    }
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
      this._refreshPreview(true);
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
    this._check('opt-shake', 'shake', () => this.hooks.onFeel?.(this.s));
    this._check('opt-slowmo', 'slowmo', () => this.hooks.onFeel?.(this.s));
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
}
